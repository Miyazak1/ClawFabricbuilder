'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const {
  sanitizeBuilderGitCandidateReceipt,
} = require('./builder-git-receipt-contract.cjs');

const CONVERSATION_EVENT_VERSION = 'builder-conversation-event.v2';
const CONVERSATION_EVENT_KIND = 'builder_conversation_event';
const MAX_EVENT_SEQUENCE = 4_096;
const MAX_EVENT_RECORD_BYTES = 24 * 1_024;
const MAX_MESSAGE_CODE_POINTS = 8_192;
const MAX_MESSAGE_UTF8_BYTES = 16 * 1_024;

const CONVERSATION_AUTHORITY = Object.freeze({
  context_authority: 'project_local_conversation',
  permission_admission: 'not_granted',
  execution_admission: 'not_granted',
  revision_admission: 'not_created',
});

const PROJECT_ID_PATTERN = /^builder-project:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const GIT_OID_PATTERN = /^[0-9a-f]{40}$/u;
const DRAFT_ID_PATTERN = /^builder-generation-draft:[0-9a-f]{64}$/u;
const ID_PATTERNS = Object.freeze({
  conversation: /^builder-conversation:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
  event: /^builder-conversation-event:[0-9a-f]{64}$/u,
  command: /^builder-command:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
  message: /^builder-message:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
  turn: /^builder-turn:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
  task: /^builder-task:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
  run: /^builder-run:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
  review: /^builder-review:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
  actor: /^(?:builder-user|builder-agent):[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
  interrupt_request: /^builder-interrupt-request:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
  cancel_request: /^builder-cancel-request:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
});
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const UNSAFE_UNICODE_FORMAT_PATTERN = /[\p{Cf}\p{Bidi_Control}]/u;
const LOCAL_PATH_PATTERN = /(?:file:\/{1,3}|\\\\|(?:^|[\s"'`=(,:])(?:[A-Za-z]:[\\/]|~[\\/]|\/(?!\/)[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*))/iu;
const CREDENTIAL_PATTERN = /(?:["'`]?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|password|secret|credential|client[_-]?secret|private[_-]?key)["'`]?\s*[:=]\s*(?!["'`]?\s*(?:null|undefined)\b)\S|\b(?:basic|bearer)\s+[A-Za-z0-9._~+/=-]{16,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|https?:\/\/[^\s/:@]+:[^\s/@]+@|\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16})\b)/iu;

const UNSIGNED_KEYS = Object.freeze([
  'record_version', 'record_kind', 'project_id', 'conversation_id', 'sequence', 'event_id',
  'command_id', 'command_digest', 'event_type', 'previous_event', 'payload', 'authority',
]);
const CREATE_KEYS = Object.freeze([
  'record_version', 'record_kind', 'project_id', 'conversation_id', 'sequence', 'command_id',
  'event_type', 'previous_event', 'payload', 'authority',
]);
const RECORD_KEYS = Object.freeze([...UNSIGNED_KEYS, 'event_digest']);
const PREVIOUS_KEYS = Object.freeze(['sequence', 'event_id', 'event_digest']);
const AUTHORITY_KEYS = Object.freeze([
  'context_authority', 'permission_admission', 'execution_admission', 'revision_admission',
]);
const MESSAGE_KEYS = Object.freeze(['message_id', 'text']);
const TASK_KEYS = Object.freeze(['task_id', 'title']);
const ASSISTANT_MESSAGE_KEYS = Object.freeze(['message_id', 'text']);
const BASE_REVISION_KEYS = Object.freeze(['revision_receipt_digest', 'commit_oid']);
const CANDIDATE_RESULT_KEYS = Object.freeze([
  'draft_id', 'title', 'summary', 'git_candidate_receipt',
]);
const PAYLOAD_KEYS = Object.freeze({
  turn_submitted: Object.freeze(['message', 'turn_id', 'mode', 'task', 'base_revision']),
  turn_steered: Object.freeze(['turn_id', 'run_id', 'message']),
  candidate_rejected: Object.freeze([
    'turn_id', 'run_id', 'draft_id', 'review_id', 'reviewer_id', 'reviewed_at_ms', 'decision',
  ]),
  run_started: Object.freeze([
    'turn_id', 'run_id', 'task_id', 'attempt_number', 'retry_of_run_id', 'input_digest',
  ]),
  run_interrupt_requested: Object.freeze(['turn_id', 'run_id', 'request_id']),
  run_cancel_requested: Object.freeze(['turn_id', 'run_id', 'request_id']),
  run_completed: Object.freeze([
    'turn_id', 'run_id', 'terminal_status', 'result_kind', 'result_digest',
    'assistant_message', 'candidate_result',
  ]),
  turn_completed: Object.freeze(['turn_id', 'run_id', 'outcome']),
});
const EVENT_TYPES = Object.freeze(Object.keys(PAYLOAD_KEYS));
const EVENT_TYPE_SET = new Set(EVENT_TYPES);

class BuilderConversationRecordError extends Error {
  constructor() {
    super('The local conversation event could not be verified.');
    this.name = 'BuilderConversationRecordError';
    this.code = 'builder_conversation_record_invalid';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() { throw new BuilderConversationRecordError(); }

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || utilTypes.isProxy(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertExactObject(value, keys) {
  if (!isPlainObject(value)) fail();
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== keys.length
    || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))) fail();
  for (const key of ownKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  }
}

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
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
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map(
      (key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`,
    ).join(',')}}`;
  }
  fail();
}

function sha256Canonical(value) {
  return `sha256:${nodeCrypto.createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')}`;
}

function hasUnpairedSurrogate(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return true;
  }
  return false;
}

function hasControl(value, allowFormatting) {
  if (UNSAFE_UNICODE_FORMAT_PATTERN.test(value)) return true;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0x7f && code <= 0x9f) return true;
    if (code <= 0x1f && (!allowFormatting || ![9, 10, 13].includes(code))) return true;
  }
  return false;
}

function safePattern(value, pattern, maximum) {
  if (typeof value !== 'string' || value.length > maximum || !pattern.test(value)) fail();
  return value;
}

function safeProjectId(value) { return safePattern(value, PROJECT_ID_PATTERN, 64); }
function safeConversationId(value) { return safePattern(value, ID_PATTERNS.conversation, 96); }
function safeEventId(value) { return safePattern(value, ID_PATTERNS.event, 128); }
function safeCommandId(value) { return safePattern(value, ID_PATTERNS.command, 96); }
function safeMessageId(value) { return safePattern(value, ID_PATTERNS.message, 88); }
function safeTurnId(value) { return safePattern(value, ID_PATTERNS.turn, 88); }
function safeTaskId(value) { return safePattern(value, ID_PATTERNS.task, 88); }
function safeRunId(value) { return safePattern(value, ID_PATTERNS.run, 88); }
function safeReviewId(value) { return safePattern(value, ID_PATTERNS.review, 91); }
function safeActorId(value) { return safePattern(value, ID_PATTERNS.actor, 96); }
function safeInterruptRequestId(value) {
  return safePattern(value, ID_PATTERNS.interrupt_request, 104);
}
function safeCancelRequestId(value) {
  return safePattern(value, ID_PATTERNS.cancel_request, 104);
}
function safeDigest(value) { return safePattern(value, DIGEST_PATTERN, 71); }
function safeGitOid(value) { return safePattern(value, GIT_OID_PATTERN, 40); }

function safeSequence(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_EVENT_SEQUENCE) fail();
  return value;
}

function safeAttemptNumber(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 16) fail();
  return value;
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail();
  return value;
}

function safeText(value, maximumCodePoints, maximumBytes, allowFormatting) {
  if (typeof value !== 'string'
    || value.length > maximumCodePoints * 2
    || value.length === 0
    || value.trim() !== value
    || value.normalize('NFC') !== value
    || hasUnpairedSurrogate(value)
    || hasControl(value, allowFormatting)
    || Array.from(value).length > maximumCodePoints
    || Buffer.byteLength(value, 'utf8') > maximumBytes
    || LOCAL_PATH_PATTERN.test(value.normalize('NFKC'))
    || CREDENTIAL_PATTERN.test(value.normalize('NFKC'))) fail();
  return value;
}

function sanitizeMessage(value, assistant = false) {
  assertExactObject(value, assistant ? ASSISTANT_MESSAGE_KEYS : MESSAGE_KEYS);
  return {
    message_id: safeMessageId(valueAt(value, 'message_id')),
    text: safeText(valueAt(value, 'text'), MAX_MESSAGE_CODE_POINTS, MAX_MESSAGE_UTF8_BYTES, true),
  };
}

function sanitizeTask(value) {
  if (value === null) return null;
  assertExactObject(value, TASK_KEYS);
  return {
    task_id: safeTaskId(valueAt(value, 'task_id')),
    title: safeText(valueAt(value, 'title'), 200, 1_024, false),
  };
}

function sanitizeBaseRevision(value) {
  if (value === null) return null;
  assertExactObject(value, BASE_REVISION_KEYS);
  return {
    revision_receipt_digest: safeDigest(valueAt(value, 'revision_receipt_digest')),
    commit_oid: safeGitOid(valueAt(value, 'commit_oid')),
  };
}

function sanitizeCandidateResult(value, turnId, runId, resultDigest) {
  assertExactObject(value, CANDIDATE_RESULT_KEYS);
  const receipt = sanitizeBuilderGitCandidateReceipt(valueAt(value, 'git_candidate_receipt'));
  if (
    receipt.turn_id !== turnId
    || receipt.run_id !== runId
    || receipt.candidate_digest !== resultDigest
  ) fail();
  return {
    draft_id: safePattern(valueAt(value, 'draft_id'), DRAFT_ID_PATTERN, 96),
    title: safeText(valueAt(value, 'title'), 160, 1_024, false),
    summary: safeText(valueAt(value, 'summary'), 2_000, 8_192, true),
    git_candidate_receipt: receipt,
  };
}

function nullable(value, sanitizer) { return value === null ? null : sanitizer(value); }

function sanitizePayload(eventType, value) {
  const expected = PAYLOAD_KEYS[eventType];
  if (!expected) fail();
  assertExactObject(value, expected);
  switch (eventType) {
    case 'turn_submitted': {
      const mode = valueAt(value, 'mode');
      if (mode !== 'question' && mode !== 'work') fail();
      const task = sanitizeTask(valueAt(value, 'task'));
      if ((mode === 'work') !== (task !== null)) fail();
      return {
        message: sanitizeMessage(valueAt(value, 'message')),
        turn_id: safeTurnId(valueAt(value, 'turn_id')),
        mode,
        task,
        base_revision: sanitizeBaseRevision(valueAt(value, 'base_revision')),
      };
    }
    case 'turn_steered':
      return {
        turn_id: safeTurnId(valueAt(value, 'turn_id')),
        run_id: nullable(valueAt(value, 'run_id'), safeRunId),
        message: sanitizeMessage(valueAt(value, 'message')),
      };
    case 'candidate_rejected':
      if (valueAt(value, 'decision') !== 'rejected') fail();
      return {
        turn_id: safeTurnId(valueAt(value, 'turn_id')),
        run_id: safeRunId(valueAt(value, 'run_id')),
        draft_id: safePattern(valueAt(value, 'draft_id'), DRAFT_ID_PATTERN, 96),
        review_id: safeReviewId(valueAt(value, 'review_id')),
        reviewer_id: safeActorId(valueAt(value, 'reviewer_id')),
        reviewed_at_ms: safeTimestamp(valueAt(value, 'reviewed_at_ms')),
        decision: 'rejected',
      };
    case 'run_started':
      return {
        turn_id: safeTurnId(valueAt(value, 'turn_id')),
        run_id: safeRunId(valueAt(value, 'run_id')),
        task_id: nullable(valueAt(value, 'task_id'), safeTaskId),
        attempt_number: safeAttemptNumber(valueAt(value, 'attempt_number')),
        retry_of_run_id: nullable(valueAt(value, 'retry_of_run_id'), safeRunId),
        input_digest: safeDigest(valueAt(value, 'input_digest')),
      };
    case 'run_interrupt_requested':
      return {
        turn_id: safeTurnId(valueAt(value, 'turn_id')),
        run_id: safeRunId(valueAt(value, 'run_id')),
        request_id: safeInterruptRequestId(valueAt(value, 'request_id')),
      };
    case 'run_cancel_requested':
      return {
        turn_id: safeTurnId(valueAt(value, 'turn_id')),
        run_id: safeRunId(valueAt(value, 'run_id')),
        request_id: safeCancelRequestId(valueAt(value, 'request_id')),
      };
    case 'run_completed': {
      const terminalStatus = valueAt(value, 'terminal_status');
      const resultKind = valueAt(value, 'result_kind');
      if (!['succeeded', 'failed', 'interrupted', 'cancelled'].includes(terminalStatus)
        || !['explanation', 'plan', 'candidate', 'failure'].includes(resultKind)
        || (terminalStatus === 'succeeded') !== (resultKind !== 'failure')) fail();
      const assistantMessage = nullable(
        valueAt(value, 'assistant_message'), (item) => sanitizeMessage(item, true),
      );
      if (assistantMessage === null && !['interrupted', 'cancelled'].includes(terminalStatus)) fail();
      const turnId = safeTurnId(valueAt(value, 'turn_id'));
      const runId = safeRunId(valueAt(value, 'run_id'));
      const resultDigest = safeDigest(valueAt(value, 'result_digest'));
      const candidateResult = valueAt(value, 'candidate_result') === null
        ? null
        : sanitizeCandidateResult(
          valueAt(value, 'candidate_result'),
          turnId,
          runId,
          resultDigest,
        );
      if ((resultKind === 'candidate') !== (candidateResult !== null)) fail();
      return {
        turn_id: turnId,
        run_id: runId,
        terminal_status: terminalStatus,
        result_kind: resultKind,
        result_digest: resultDigest,
        assistant_message: assistantMessage,
        candidate_result: candidateResult,
      };
    }
    case 'turn_completed': {
      const outcome = valueAt(value, 'outcome');
      if (![
        'answered', 'responded', 'plan_proposed', 'candidate_ready',
        'failed', 'interrupted', 'cancelled',
      ].includes(outcome)) fail();
      return {
        turn_id: safeTurnId(valueAt(value, 'turn_id')),
        run_id: nullable(valueAt(value, 'run_id'), safeRunId),
        outcome,
      };
    }
    default:
      fail();
  }
}

function sanitizePrevious(value, sequence) {
  if (value === null) {
    if (sequence !== 1) fail();
    return null;
  }
  if (sequence === 1) fail();
  assertExactObject(value, PREVIOUS_KEYS);
  const previousSequence = safeSequence(valueAt(value, 'sequence'));
  if (previousSequence !== sequence - 1) fail();
  return {
    sequence: previousSequence,
    event_id: safeEventId(valueAt(value, 'event_id')),
    event_digest: safeDigest(valueAt(value, 'event_digest')),
  };
}

function sanitizeAuthority(value) {
  assertExactObject(value, AUTHORITY_KEYS);
  for (const key of AUTHORITY_KEYS) {
    if (valueAt(value, key) !== CONVERSATION_AUTHORITY[key]) fail();
  }
  return { ...CONVERSATION_AUTHORITY };
}

function expectedConversationId(projectId) {
  return `builder-conversation:${projectId.slice('builder-project:'.length)}`;
}

function deriveEventId(projectId, commandId) {
  const digest = nodeCrypto.createHash('sha256')
    .update(`builder-conversation-event\0${projectId}\0${commandId}`, 'utf8').digest('hex');
  return `builder-conversation-event:${digest}`;
}

function commandBody(core) {
  return {
    command_id: core.command_id,
    conversation_id: core.conversation_id,
    event_type: core.event_type,
    payload: core.payload,
    project_id: core.project_id,
  };
}

function sanitizeCore(value, keys) {
  assertExactObject(value, keys);
  if (valueAt(value, 'record_version') !== CONVERSATION_EVENT_VERSION
    || valueAt(value, 'record_kind') !== CONVERSATION_EVENT_KIND) fail();
  const sequence = safeSequence(valueAt(value, 'sequence'));
  const eventType = valueAt(value, 'event_type');
  if (typeof eventType !== 'string' || !EVENT_TYPE_SET.has(eventType)) fail();
  if (sequence === 1 && eventType !== 'turn_submitted') fail();
  const projectId = safeProjectId(valueAt(value, 'project_id'));
  const conversationId = safeConversationId(valueAt(value, 'conversation_id'));
  if (conversationId !== expectedConversationId(projectId)) fail();
  const payload = sanitizePayload(eventType, valueAt(value, 'payload'));
  if (
    eventType === 'run_completed'
    && payload.candidate_result !== null
    && (
      payload.candidate_result.git_candidate_receipt.project_id !== projectId
      || payload.candidate_result.git_candidate_receipt.conversation_id !== conversationId
    )
  ) fail();
  return {
    record_version: CONVERSATION_EVENT_VERSION,
    record_kind: CONVERSATION_EVENT_KIND,
    project_id: projectId,
    conversation_id: conversationId,
    sequence,
    command_id: safeCommandId(valueAt(value, 'command_id')),
    event_type: eventType,
    previous_event: sanitizePrevious(valueAt(value, 'previous_event'), sequence),
    payload,
    authority: sanitizeAuthority(valueAt(value, 'authority')),
  };
}

function createBuilderConversationEvent(value) {
  const core = sanitizeCore(value, CREATE_KEYS);
  const unsigned = {
    ...core,
    event_id: deriveEventId(core.project_id, core.command_id),
    command_digest: sha256Canonical(commandBody(core)),
  };
  return freezeDeep({ ...unsigned, event_digest: sha256Canonical(unsigned) });
}

function sanitizeBuilderConversationEvent(value) {
  const core = sanitizeCore(value, RECORD_KEYS);
  const eventId = safeEventId(valueAt(value, 'event_id'));
  const commandDigest = safeDigest(valueAt(value, 'command_digest'));
  if (eventId !== deriveEventId(core.project_id, core.command_id)
    || commandDigest !== sha256Canonical(commandBody(core))) fail();
  const unsigned = { ...core, event_id: eventId, command_digest: commandDigest };
  const eventDigest = safeDigest(valueAt(value, 'event_digest'));
  if (sha256Canonical(unsigned) !== eventDigest) fail();
  const record = freezeDeep({ ...unsigned, event_digest: eventDigest });
  if (Buffer.byteLength(canonicalJson(record), 'utf8') + 1 > MAX_EVENT_RECORD_BYTES) fail();
  return record;
}

function serializeBuilderConversationEvent(value) {
  const serialized = `${canonicalJson(sanitizeBuilderConversationEvent(value))}\n`;
  if (Buffer.byteLength(serialized, 'utf8') > MAX_EVENT_RECORD_BYTES) fail();
  return serialized;
}

function safeBoundary(fn) {
  return (...args) => {
    try { return fn(...args); } catch (error) {
      if (error instanceof BuilderConversationRecordError) throw error;
      fail();
    }
  };
}

module.exports = Object.freeze({
  CONVERSATION_EVENT_VERSION,
  CONVERSATION_EVENT_KIND,
  CONVERSATION_AUTHORITY,
  CONVERSATION_EVENT_TYPES: EVENT_TYPES,
  MAX_EVENT_SEQUENCE,
  MAX_EVENT_RECORD_BYTES,
  BuilderConversationRecordError,
  createBuilderConversationEvent: safeBoundary(createBuilderConversationEvent),
  sanitizeBuilderConversationEvent: safeBoundary(sanitizeBuilderConversationEvent),
  serializeBuilderConversationEvent: safeBoundary(serializeBuilderConversationEvent),
});
