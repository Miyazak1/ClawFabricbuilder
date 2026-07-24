'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const {
  CONVERSATION_AUTHORITY,
  createBuilderConversationEvent,
  sanitizeBuilderConversationEvent,
} = require('./builder-conversation-records.cjs');
const {
  replayBuilderConversation,
} = require('./builder-conversation-replay.cjs');
const {
  sanitizeBuilderGitCandidateReceipt,
} = require('./builder-git-receipt-contract.cjs');

const BUILDER_CONVERSATION_MAIN_SERVICE_VERSION = 'builder-conversation-main-service.v1';
const AUTHORITY_RESULT_VERSION = 'builder-conversation-authority-result.v1';
const OPTION_KEYS = Object.freeze(['metadataAuthority', 'createUuid', 'nowMs']);
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const UUID_PATTERN = new RegExp(`^${UUID_SOURCE}$`, 'u');
const PROJECT_ID_PATTERN = new RegExp(`^builder-project:(${UUID_SOURCE})$`, 'u');
const CONVERSATION_ID_PATTERN = new RegExp(`^builder-conversation:${UUID_SOURCE}$`, 'u');
const TURN_ID_PATTERN = new RegExp(`^builder-turn:${UUID_SOURCE}$`, 'u');
const TASK_ID_PATTERN = new RegExp(`^builder-task:${UUID_SOURCE}$`, 'u');
const RUN_ID_PATTERN = new RegExp(`^builder-run:${UUID_SOURCE}$`, 'u');
const EVENT_ID_PATTERN = /^builder-conversation-event:[0-9a-f]{64}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const OID_PATTERN = /^[0-9a-f]{40}$/u;
const DRAFT_ID_PATTERN = /^builder-generation-draft:[0-9a-f]{64}$/u;
const TRUSTED_CONTEXTS = new WeakSet();

class BuilderConversationMainServiceError extends Error {
  constructor() {
    super('The project activity could not be recorded.');
    this.name = 'BuilderConversationMainServiceError';
    this.code = 'builder_conversation_main_service_unavailable';
    this.retryable = true;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderConversationMainServiceError();
}

function isPlainObject(value) {
  if (
    value === null
    || typeof value !== 'object'
    || Array.isArray(value)
    || utilTypes.isProxy(value)
  ) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactObject(value, keys) {
  if (!isPlainObject(value)) fail();
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== keys.length
    || actual.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) fail();
  for (const key of actual) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  }
  return value;
}

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  return descriptor.value;
}

function ownMethod(value, key) {
  if (value === null || typeof value !== 'object' || utilTypes.isProxy(value)) fail();
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') fail();
  return descriptor.value;
}

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freezeDeep(nested);
    Object.freeze(value);
  }
  return value;
}

function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number' && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map(
      (key) => `${JSON.stringify(key)}:${canonicalJson(valueAt(value, key))}`,
    ).join(',')}}`;
  }
  fail();
}

function sha256Canonical(value) {
  return `sha256:${nodeCrypto.createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')}`;
}

function safePattern(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) fail();
  return value;
}

function safeUuid(value) {
  return safePattern(value, UUID_PATTERN);
}

function safeProjectId(value) {
  return safePattern(value, PROJECT_ID_PATTERN);
}

function safeDigest(value) {
  return safePattern(value, DIGEST_PATTERN);
}

function safeHead(value) {
  exactObject(value, ['sequence', 'event_id', 'event_digest']);
  const sequence = valueAt(value, 'sequence');
  if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence > 1_024) fail();
  return freezeDeep({
    sequence,
    event_id: safePattern(valueAt(value, 'event_id'), EVENT_ID_PATTERN),
    event_digest: safeDigest(valueAt(value, 'event_digest')),
  });
}

function safeOid(value) {
  if (value === null) return null;
  return safePattern(value, OID_PATTERN);
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail();
  return value;
}

function hasUnpairedSurrogate(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xD800 && code <= 0xDBFF) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xDC00 && next <= 0xDFFF)) return true;
      index += 1;
    } else if (code >= 0xDC00 && code <= 0xDFFF) return true;
  }
  return false;
}

function hasForbiddenControl(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (
      code === 0x7F
      || (code <= 0x1F && code !== 0x09 && code !== 0x0A && code !== 0x0D)
    ) return true;
  }
  return false;
}

function safeText(value, maximumCodePoints, maximumBytes) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.trim() !== value
    || value.length > maximumCodePoints * 2
    || hasUnpairedSurrogate(value)
    || Array.from(value).length > maximumCodePoints
    || Buffer.byteLength(value, 'utf8') > maximumBytes
    || hasForbiddenControl(value)
  ) fail();
  return value;
}

function projectUuid(projectId) {
  const match = PROJECT_ID_PATTERN.exec(projectId);
  if (!match) fail();
  return match[1];
}

function newId(createUuid, prefix) {
  return `${prefix}:${safeUuid(Reflect.apply(createUuid, undefined, []))}`;
}

function eventHead(record) {
  return freezeDeep({
    sequence: record.sequence,
    event_id: record.event_id,
    event_digest: record.event_digest,
  });
}

function sameHead(left, right) {
  if (left === null || right === null) return left === right;
  return left.sequence === right.sequence
    && left.event_id === right.event_id
    && left.event_digest === right.event_digest;
}

function previousEvent(head) {
  return head === null ? null : { ...head };
}

function eventAt({
  projectId,
  conversationId,
  sequence,
  commandId,
  eventType,
  previous,
  payload,
}) {
  return createBuilderConversationEvent({
    record_version: 'builder-conversation-event.v2',
    record_kind: 'builder_conversation_event',
    project_id: projectId,
    conversation_id: conversationId,
    sequence,
    command_id: commandId,
    event_type: eventType,
    previous_event: previousEvent(previous),
    payload,
    authority: CONVERSATION_AUTHORITY,
  });
}

function denseEvents(value) {
  if (!Array.isArray(value) || utilTypes.isProxy(value) || value.length < 1 || value.length > 1_024) fail();
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || keys.some((key) => typeof key === 'symbol')) fail();
  return freezeDeep(value.map((event) => sanitizeBuilderConversationEvent(event)));
}

function sanitizeAuthorityResult(value, expectedProjectId, expectedConversationId) {
  exactObject(value, [
    'result_version',
    'operation',
    'conversation',
    'action_events',
    'current_head',
    'events',
    'snapshot',
    'metadata_evidence',
  ]);
  if (
    valueAt(value, 'result_version') !== AUTHORITY_RESULT_VERSION
    || !['events_appended', 'events_replayed', 'conversation_loaded'].includes(valueAt(value, 'operation'))
  ) fail();
  const conversation = exactObject(valueAt(value, 'conversation'), [
    'project_id', 'conversation_id', 'created_at_ms',
  ]);
  if (
    safeProjectId(valueAt(conversation, 'project_id')) !== expectedProjectId
    || valueAt(conversation, 'conversation_id') !== expectedConversationId
  ) fail();
  const events = denseEvents(valueAt(value, 'events'));
  const snapshot = replayBuilderConversation(events);
  const currentHead = valueAt(value, 'current_head');
  if (!sameHead(snapshot.head, currentHead)) fail();
  return freezeDeep({
    conversation: {
      project_id: expectedProjectId,
      conversation_id: expectedConversationId,
      created_at_ms: safeTimestamp(valueAt(conversation, 'created_at_ms')),
    },
    head: { ...snapshot.head },
    events,
    snapshot,
  });
}

function ownCode(error) {
  if (!error || typeof error !== 'object' || utilTypes.isProxy(error)) return null;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(error, 'code');
    return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : null;
  } catch {
    return null;
  }
}

function sanitizeOptions(value) {
  exactObject(value, OPTION_KEYS);
  const metadataAuthority = valueAt(value, 'metadataAuthority');
  const createUuid = valueAt(value, 'createUuid');
  const nowMs = valueAt(value, 'nowMs');
  if (
    typeof createUuid !== 'function'
    || utilTypes.isProxy(createUuid)
    || typeof nowMs !== 'function'
    || utilTypes.isProxy(nowMs)
  ) fail();
  return Object.freeze({
    metadataAuthority,
    appendEvents: ownMethod(metadataAuthority, 'append_conversation_events'),
    loadConversation: ownMethod(metadataAuthority, 'load_conversation'),
    loadProjectIdentity: ownMethod(metadataAuthority, 'load_project_identity'),
    createUuid,
    nowMs,
  });
}

function sanitizeBaseRevision(value) {
  if (value === null) return null;
  exactObject(value, ['revision_receipt_digest', 'commit_oid']);
  return freezeDeep({
    revision_receipt_digest: safeDigest(valueAt(value, 'revision_receipt_digest')),
    commit_oid: safeOid(valueAt(value, 'commit_oid')),
  });
}

function sanitizeBeginRequest(value) {
  exactObject(value, ['project_id', 'instruction', 'request_digest', 'base_revision']);
  return freezeDeep({
    project_id: safeProjectId(valueAt(value, 'project_id')),
    instruction: safeText(valueAt(value, 'instruction'), 12_000, 48_000),
    request_digest: safeDigest(valueAt(value, 'request_digest')),
    base_revision: sanitizeBaseRevision(valueAt(value, 'base_revision')),
  });
}

function trustedContext(value) {
  if (!value || typeof value !== 'object' || !TRUSTED_CONTEXTS.has(value)) fail();
  return value;
}

function createBuilderConversationMainService(rawOptions) {
  const options = sanitizeOptions(rawOptions);

  function load(projectId, conversationId) {
    try {
      const result = Reflect.apply(options.loadConversation, options.metadataAuthority, [{
        project_id: projectId,
        conversation_id: conversationId,
      }]);
      return sanitizeAuthorityResult(result, projectId, conversationId);
    } catch (error) {
      if (ownCode(error) === 'builder_product_metadata_not_found') return null;
      fail();
    }
  }

  function append({ project, conversation, expectedHead, events, recordedAtMs }) {
    try {
      const result = Reflect.apply(options.appendEvents, options.metadataAuthority, [{
        project,
        conversation,
        expected_head: expectedHead,
        events,
        recorded_at_ms: recordedAtMs,
      }]);
      return sanitizeAuthorityResult(result, project.project_id, conversation.conversation_id);
    } catch {
      fail();
    }
  }

  function projectCreatedAt(projectId, baseRevision, now) {
    if (baseRevision === null) return now;
    try {
      const loaded = Reflect.apply(options.loadProjectIdentity, options.metadataAuthority, [{
        project_id: projectId,
      }]);
      exactObject(loaded, ['result_version', 'operation', 'project', 'metadata_evidence']);
      if (
        valueAt(loaded, 'result_version') !== 'builder-product-metadata-result.v3'
        || valueAt(loaded, 'operation') !== 'project_identity_loaded'
      ) fail();
      const project = exactObject(valueAt(loaded, 'project'), ['project_id', 'created_at_ms']);
      if (valueAt(project, 'project_id') !== projectId) fail();
      return safeTimestamp(valueAt(project, 'created_at_ms'));
    } catch {
      fail();
    }
  }

function recoverActive(state, project, conversation, recordedAtMs) {
    if (state === null || state.snapshot.active_turn_id === null) return state;
    const turn = state.snapshot.turns.find((item) => item.turn_id === state.snapshot.active_turn_id);
    const run = turn?.runs.at(-1);
    if (!turn || !run || run.status !== 'running') fail();
    const events = [];
    let previous = state.head;
    let terminalStatus;
    if (run.cancel_request_id !== null) {
      terminalStatus = 'cancelled';
    } else if (run.interrupt_request_id !== null) {
      terminalStatus = 'interrupted';
    } else {
      terminalStatus = 'interrupted';
      const requested = eventAt({
        projectId: project.project_id,
        conversationId: conversation.conversation_id,
        sequence: previous.sequence + 1,
        commandId: newId(options.createUuid, 'builder-command'),
        eventType: 'run_interrupt_requested',
        previous,
        payload: {
          turn_id: turn.turn_id,
          run_id: run.run_id,
          request_id: newId(options.createUuid, 'builder-interrupt-request'),
        },
      });
      events.push(requested);
      previous = eventHead(requested);
    }
    const completed = eventAt({
      projectId: project.project_id,
      conversationId: conversation.conversation_id,
      sequence: previous.sequence + 1,
      commandId: newId(options.createUuid, 'builder-command'),
      eventType: 'run_completed',
      previous,
      payload: {
        turn_id: turn.turn_id,
        run_id: run.run_id,
        terminal_status: terminalStatus,
        result_kind: 'failure',
        result_digest: sha256Canonical({
          recovery_version: BUILDER_CONVERSATION_MAIN_SERVICE_VERSION,
          run_id: run.run_id,
          prior_head: state.head,
        }),
        assistant_message: null,
        candidate_result: null,
      },
    });
    events.push(completed);
    const turnCompleted = eventAt({
      projectId: project.project_id,
      conversationId: conversation.conversation_id,
      sequence: completed.sequence + 1,
      commandId: newId(options.createUuid, 'builder-command'),
      eventType: 'turn_completed',
      previous: eventHead(completed),
      payload: { turn_id: turn.turn_id, run_id: run.run_id, outcome: terminalStatus },
    });
    events.push(turnCompleted);
    return append({
      project,
      conversation,
      expectedHead: state.head,
      events,
      recordedAtMs,
    });
  }

  function beginWork(rawRequest) {
    const request = sanitizeBeginRequest(rawRequest);
    const recordedAtMs = safeTimestamp(Reflect.apply(options.nowMs, undefined, []));
    const conversationId = `builder-conversation:${projectUuid(request.project_id)}`;
    const project = freezeDeep({
      project_id: request.project_id,
      created_at_ms: projectCreatedAt(
        request.project_id,
        request.base_revision,
        recordedAtMs,
      ),
    });
    let state = load(request.project_id, conversationId);
    if (state === null && request.base_revision !== null) fail();
    const conversation = freezeDeep({
      project_id: request.project_id,
      conversation_id: conversationId,
      created_at_ms: state?.conversation.created_at_ms ?? project.created_at_ms,
    });
    state = recoverActive(state, project, conversation, recordedAtMs);
    const priorHead = state?.head ?? null;
    const ids = freezeDeep({
      turn_command_id: newId(options.createUuid, 'builder-command'),
      run_command_id: newId(options.createUuid, 'builder-command'),
      terminal_command_id: newId(options.createUuid, 'builder-command'),
      turn_terminal_command_id: newId(options.createUuid, 'builder-command'),
      cancel_command_id: newId(options.createUuid, 'builder-command'),
      cancel_request_id: newId(options.createUuid, 'builder-cancel-request'),
      interrupt_command_id: newId(options.createUuid, 'builder-command'),
      interrupt_request_id: newId(options.createUuid, 'builder-interrupt-request'),
      message_id: newId(options.createUuid, 'builder-message'),
      assistant_message_id: newId(options.createUuid, 'builder-message'),
      turn_id: newId(options.createUuid, 'builder-turn'),
      task_id: newId(options.createUuid, 'builder-task'),
      run_id: newId(options.createUuid, 'builder-run'),
    });
    const first = eventAt({
      projectId: request.project_id,
      conversationId,
      sequence: (priorHead?.sequence ?? 0) + 1,
      commandId: ids.turn_command_id,
      eventType: 'turn_submitted',
      previous: priorHead,
      payload: {
        message: { message_id: ids.message_id, text: request.instruction },
        turn_id: ids.turn_id,
        mode: 'work',
        task: {
          task_id: ids.task_id,
          title: request.base_revision === null ? 'Create Builder project' : 'Update Builder project',
        },
        base_revision: request.base_revision,
      },
    });
    const second = eventAt({
      projectId: request.project_id,
      conversationId,
      sequence: first.sequence + 1,
      commandId: ids.run_command_id,
      eventType: 'run_started',
      previous: eventHead(first),
      payload: {
        turn_id: ids.turn_id,
        run_id: ids.run_id,
        task_id: ids.task_id,
        attempt_number: 1,
        retry_of_run_id: null,
        input_digest: request.request_digest,
      },
    });
    const appended = append({
      project,
      conversation,
      expectedHead: priorHead,
      events: [first, second],
      recordedAtMs,
    });
    const context = freezeDeep({
      context_version: 'builder-conversation-run-context.v1',
      project,
      conversation,
      request_digest: request.request_digest,
      start_head: { ...appended.head },
      events: appended.events,
      ids,
      cancel_requested: false,
    });
    TRUSTED_CONTEXTS.add(context);
    return context;
  }

  function completeCandidate(rawRequest) {
    exactObject(rawRequest, ['context', 'candidate_result', 'assistant_text']);
    const context = trustedContext(valueAt(rawRequest, 'context'));
    const candidateResult = exactObject(valueAt(rawRequest, 'candidate_result'), [
      'draft_id', 'title', 'summary', 'git_candidate_receipt',
    ]);
    const gitCandidateReceipt = sanitizeBuilderGitCandidateReceipt(
      valueAt(candidateResult, 'git_candidate_receipt'),
    );
    const draftId = safePattern(valueAt(candidateResult, 'draft_id'), DRAFT_ID_PATTERN);
    const title = safeText(valueAt(candidateResult, 'title'), 160, 1_024);
    const summary = safeText(valueAt(candidateResult, 'summary'), 2_000, 8_192);
    if (
      gitCandidateReceipt.project_id !== context.project.project_id
      || gitCandidateReceipt.conversation_id !== context.conversation.conversation_id
      || gitCandidateReceipt.turn_id !== context.ids.turn_id
      || gitCandidateReceipt.task_id !== context.ids.task_id
      || gitCandidateReceipt.run_id !== context.ids.run_id
    ) fail();
    const assistantText = safeText(valueAt(rawRequest, 'assistant_text'), 2_000, 8_192);
    const recordedAtMs = safeTimestamp(Reflect.apply(options.nowMs, undefined, []));
    const first = eventAt({
      projectId: context.project.project_id,
      conversationId: context.conversation.conversation_id,
      sequence: context.start_head.sequence + 1,
      commandId: context.ids.terminal_command_id,
      eventType: 'run_completed',
      previous: context.start_head,
      payload: {
        turn_id: context.ids.turn_id,
        run_id: context.ids.run_id,
        terminal_status: 'succeeded',
        result_kind: 'candidate',
        result_digest: gitCandidateReceipt.candidate_digest,
        assistant_message: {
          message_id: context.ids.assistant_message_id,
          text: assistantText,
        },
        candidate_result: {
          draft_id: draftId,
          title,
          summary,
          git_candidate_receipt: gitCandidateReceipt,
        },
      },
    });
    const second = eventAt({
      projectId: context.project.project_id,
      conversationId: context.conversation.conversation_id,
      sequence: first.sequence + 1,
      commandId: context.ids.turn_terminal_command_id,
      eventType: 'turn_completed',
      previous: eventHead(first),
      payload: {
        turn_id: context.ids.turn_id,
        run_id: context.ids.run_id,
        outcome: 'candidate_ready',
      },
    });
    return append({
      project: context.project,
      conversation: context.conversation,
      expectedHead: context.start_head,
      events: [first, second],
      recordedAtMs,
    });
  }

  function requestCancel(rawRequest) {
    exactObject(rawRequest, ['context']);
    const context = trustedContext(valueAt(rawRequest, 'context'));
    if (context.cancel_requested) return context;
    const recordedAtMs = safeTimestamp(Reflect.apply(options.nowMs, undefined, []));
    const requested = eventAt({
      projectId: context.project.project_id,
      conversationId: context.conversation.conversation_id,
      sequence: context.start_head.sequence + 1,
      commandId: context.ids.cancel_command_id,
      eventType: 'run_cancel_requested',
      previous: context.start_head,
      payload: {
        turn_id: context.ids.turn_id,
        run_id: context.ids.run_id,
        request_id: context.ids.cancel_request_id,
      },
    });
    const appended = append({
      project: context.project,
      conversation: context.conversation,
      expectedHead: context.start_head,
      events: [requested],
      recordedAtMs,
    });
    const cancelledContext = freezeDeep({
      ...context,
      start_head: { ...appended.head },
      events: appended.events,
      cancel_requested: true,
    });
    TRUSTED_CONTEXTS.add(cancelledContext);
    return cancelledContext;
  }

  function completeFailure(rawRequest) {
    exactObject(rawRequest, ['context', 'failure_code']);
    const context = trustedContext(valueAt(rawRequest, 'context'));
    const failureCode = safeText(valueAt(rawRequest, 'failure_code'), 80, 160);
    const recordedAtMs = safeTimestamp(Reflect.apply(options.nowMs, undefined, []));
    const cancelled = failureCode === 'builder_generation_cancelled';
    const interrupted = failureCode === 'builder_generation_timeout';
    const events = [];
    let previous = context.start_head;
    if ((cancelled && !context.cancel_requested) || interrupted) {
      const requested = eventAt({
        projectId: context.project.project_id,
        conversationId: context.conversation.conversation_id,
        sequence: previous.sequence + 1,
        commandId: cancelled ? context.ids.cancel_command_id : context.ids.interrupt_command_id,
        eventType: cancelled ? 'run_cancel_requested' : 'run_interrupt_requested',
        previous,
        payload: {
          turn_id: context.ids.turn_id,
          run_id: context.ids.run_id,
          request_id: cancelled ? context.ids.cancel_request_id : context.ids.interrupt_request_id,
        },
      });
      events.push(requested);
      previous = eventHead(requested);
    }
    const terminalStatus = cancelled ? 'cancelled' : interrupted ? 'interrupted' : 'failed';
    const completed = eventAt({
      projectId: context.project.project_id,
      conversationId: context.conversation.conversation_id,
      sequence: previous.sequence + 1,
      commandId: context.ids.terminal_command_id,
      eventType: 'run_completed',
      previous,
      payload: {
        turn_id: context.ids.turn_id,
        run_id: context.ids.run_id,
        terminal_status: terminalStatus,
        result_kind: 'failure',
        result_digest: sha256Canonical({
          failure_version: BUILDER_CONVERSATION_MAIN_SERVICE_VERSION,
          request_digest: context.request_digest,
          run_id: context.ids.run_id,
          failure_code: failureCode,
        }),
        assistant_message: cancelled || interrupted ? null : {
          message_id: context.ids.assistant_message_id,
          text: 'The draft could not be made.',
        },
        candidate_result: null,
      },
    });
    events.push(completed);
    const turnCompleted = eventAt({
      projectId: context.project.project_id,
      conversationId: context.conversation.conversation_id,
      sequence: completed.sequence + 1,
      commandId: context.ids.turn_terminal_command_id,
      eventType: 'turn_completed',
      previous: eventHead(completed),
      payload: {
        turn_id: context.ids.turn_id,
        run_id: context.ids.run_id,
        outcome: terminalStatus,
      },
    });
    events.push(turnCompleted);
    return append({
      project: context.project,
      conversation: context.conversation,
      expectedHead: context.start_head,
      events,
      recordedAtMs,
    });
  }

  function verifyCandidate(rawRequest) {
    exactObject(rawRequest, [
      'project_id',
      'conversation_id',
      'turn_id',
      'task_id',
      'run_id',
      'candidate_digest',
      'conversation_head',
    ]);
    const projectId = safeProjectId(valueAt(rawRequest, 'project_id'));
    const conversationId = safePattern(
      valueAt(rawRequest, 'conversation_id'),
      CONVERSATION_ID_PATTERN,
    );
    const turnId = safePattern(valueAt(rawRequest, 'turn_id'), TURN_ID_PATTERN);
    const taskId = safePattern(valueAt(rawRequest, 'task_id'), TASK_ID_PATTERN);
    const runId = safePattern(valueAt(rawRequest, 'run_id'), RUN_ID_PATTERN);
    const candidateDigest = safeDigest(valueAt(rawRequest, 'candidate_digest'));
    const expectedHead = safeHead(valueAt(rawRequest, 'conversation_head'));
    if (conversationId.slice('builder-conversation:'.length) !== projectUuid(projectId)) fail();
    const state = load(projectId, conversationId);
    if (state === null || expectedHead.sequence > state.events.length) fail();
    const selectedEvent = state.events[expectedHead.sequence - 1];
    if (!sameHead(eventHead(selectedEvent), expectedHead)) fail();
    const selectedSnapshot = replayBuilderConversation(
      state.events.slice(0, expectedHead.sequence),
    );
    const turn = selectedSnapshot.turns.find((item) => item.turn_id === turnId);
    const run = turn?.runs.find((item) => item.run_id === runId);
    if (
      !turn
      || turn.status !== 'completed'
      || turn.outcome !== 'candidate_ready'
      || turn.task?.task_id !== taskId
      || !run
      || run !== turn.runs.at(-1)
      || run.status !== 'completed'
      || run.terminal_status !== 'succeeded'
      || run.result_kind !== 'candidate'
      || run.result_digest !== candidateDigest
      || run.candidate_result === null
      || run.candidate_result.git_candidate_receipt.task_id !== taskId
    ) fail();
    return freezeDeep({
      verification_version: 'builder-conversation-candidate-verification.v1',
      project_id: projectId,
      conversation_id: conversationId,
      turn_id: turnId,
      task_id: taskId,
      run_id: runId,
      candidate_digest: candidateDigest,
      conversation_head: { ...expectedHead },
      candidate_result: {
        ...run.candidate_result,
        git_candidate_receipt: { ...run.candidate_result.git_candidate_receipt },
      },
      verification_admission: 'sqlite_replay_verified',
    });
  }

  return Object.freeze({
    service_version: BUILDER_CONVERSATION_MAIN_SERVICE_VERSION,
    begin_work: beginWork,
    complete_candidate: completeCandidate,
    complete_failure: completeFailure,
    request_cancel: requestCancel,
    verify_candidate: verifyCandidate,
    authority: Object.freeze({
      storage: 'sqlite_conversation_event_chain',
      provider_dispatch: false,
      renderer_exposure: false,
      restart_running_recovery: 'interrupted_without_provider_redispatch',
    }),
  });
}

module.exports = Object.freeze({
  BUILDER_CONVERSATION_MAIN_SERVICE_VERSION,
  BuilderConversationMainServiceError,
  createBuilderConversationMainService,
});
