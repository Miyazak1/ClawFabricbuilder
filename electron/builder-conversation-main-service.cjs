'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const {
  CONVERSATION_AUTHORITY,
  createBuilderConversationPlanAdmission,
  createBuilderConversationEvent,
  sanitizeBuilderConversationEvent,
} = require('./builder-conversation-records.cjs');
const {
  replayBuilderConversation,
} = require('./builder-conversation-replay.cjs');
const {
  sanitizeBuilderGitCandidateReceipt,
} = require('./builder-git-receipt-contract.cjs');
const {
  sanitizeBuilderToolCallRecord,
} = require('./builder-tool-call-records.cjs');
const {
  sanitizeBuilderToolResultRecord,
} = require('./builder-tool-result-records.cjs');
const {
  sanitizeBuilderPlanProposalSourceContextResult,
  sanitizeBuilderPlanProposalRecord,
} = require('./builder-plan-proposal-records.cjs');
const {
  createBuilderToolDispatchAdmission,
} = require('./builder-tool-dispatch-admission.cjs');
const {
  FILESYSTEM_READ_TOOL_ADAPTER_ID,
  createBuilderToolAdapterSelectionAdmission,
  sanitizeBuilderToolAdapterSelectionAdmission,
} = require('./builder-tool-adapter-selection-admission.cjs');
const {
  FILESYSTEM_READ_TOOL_RUNTIME_ID,
  createBuilderToolRuntimeInvocationAdmission,
  sanitizeBuilderToolRuntimeInvocationAdmission,
} = require('./builder-tool-runtime-invocation-admission.cjs');
const {
  admitBuilderToolCallSessionState,
  admitBuilderToolResultSessionState,
} = require('./builder-tool-session-state-gate.cjs');
const {
  BuilderTaskStreamProjectionError,
  projectBuilderTaskStream,
} = require('./builder-task-stream-projection.cjs');
const {
  createBuilderApprovedPlanContinuationAdmission,
} = require('./builder-approved-plan-continuation-admission.cjs');
const {
  sanitizeBuilderDraftContinuationAdmission,
} = require('./builder-draft-continuation-admission.cjs');
const {
  isPublicBuilderRouteDecisionSignal,
} = require('./builder-route-decision-signals.cjs');
const {
  createBuilderRunContextSnapshot,
} = require('./builder-run-context-snapshot.cjs');
const {
  sanitizeBuilderAgentStepProgressConversationAdmission,
} = require('./builder-agent-step-progress-conversation-admission.cjs');

const BUILDER_CONVERSATION_MAIN_SERVICE_VERSION = 'builder-conversation-main-service.v1';
const AUTHORITY_RESULT_VERSION = 'builder-conversation-authority-result.v1';
const APPROVED_PLAN_READ_RESULT_VERSION = 'builder-conversation-approved-plan-read-result.v1';
const REQUIRED_OPTION_KEYS = Object.freeze(['metadataAuthority', 'createUuid', 'nowMs']);
const OPTION_KEYS = Object.freeze([...REQUIRED_OPTION_KEYS, 'onTaskStreamChanged']);
const TASK_STREAM_CHANGED_EVENT_VERSION = 'builder-task-stream-changed.v1';
const ROUTE_DECISION_VERSION = 'builder-composer-route-decision.v1';
const ROUTE_DECISION_HINT_KEYS = Object.freeze([
  'route', 'confidence', 'matched_signals', 'downgraded_from',
  'downgrade_reason', 'required_permissions', 'permission_result', 'dispatch',
]);
const ROUTE_DECISION_ROUTES = Object.freeze(['answer', 'clarify', 'update_brief', 'plan', 'build']);
const ROUTE_DECISION_CONFIDENCES = Object.freeze(['low', 'medium', 'high']);
const ROUTE_DECISION_DOWNGRADE_REASONS = Object.freeze([
  'ambiguous_build_intent',
  'missing_prior_build_context',
  'workspace_required',
]);
const ROUTE_DECISION_PERMISSIONS = Object.freeze(['project_read', 'write_project']);
const ROUTE_DECISION_PERMISSION_RESULTS = Object.freeze([
  'not_required',
  'allowed',
  'ask',
  'denied',
]);
const ROUTE_DECISION_DISPATCHES = Object.freeze([
  'reply',
  'brief_update',
  'plan',
  'build',
  'ask_workspace',
  'ask_permission',
  'blocked',
]);
const RUN_PROGRESS_STAGES = Object.freeze([
  'context_ready',
  'provider_request_started',
  'provider_response_received',
  'result_preparing',
]);
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const UUID_PATTERN = new RegExp(`^${UUID_SOURCE}$`, 'u');
const PROJECT_ID_PATTERN = new RegExp(`^builder-project:(${UUID_SOURCE})$`, 'u');
const CONVERSATION_ID_PATTERN = new RegExp(`^builder-conversation:${UUID_SOURCE}$`, 'u');
const TURN_ID_PATTERN = new RegExp(`^builder-turn:${UUID_SOURCE}$`, 'u');
const TASK_ID_PATTERN = new RegExp(`^builder-task:${UUID_SOURCE}$`, 'u');
const RUN_ID_PATTERN = new RegExp(`^builder-run:${UUID_SOURCE}$`, 'u');
const MESSAGE_ID_PATTERN = new RegExp(`^builder-message:${UUID_SOURCE}$`, 'u');
const TOOL_CALL_ID_PATTERN = new RegExp(`^builder-tool-call:${UUID_SOURCE}$`, 'u');
const REVIEW_ID_PATTERN = new RegExp(`^builder-review:${UUID_SOURCE}$`, 'u');
const ACTOR_ID_PATTERN = new RegExp(`^(?:builder-user|builder-agent):${UUID_SOURCE}$`, 'u');
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

function safeMessageId(value) {
  return safePattern(value, MESSAGE_ID_PATTERN);
}

function safeRunProgressStage(value) {
  if (!RUN_PROGRESS_STAGES.includes(value)) fail();
  return value;
}

function safeRevisionNumber(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 1_024) fail();
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

function routeDecisionIdForMessage(messageId) {
  const prefix = 'builder-message:';
  if (typeof messageId !== 'string' || !messageId.startsWith(prefix)) fail();
  return `builder-route-decision:${safeUuid(messageId.slice(prefix.length))}`;
}

function taskBriefCommandIdForMessage(messageId) {
  const prefix = 'builder-message:';
  if (typeof messageId !== 'string' || !messageId.startsWith(prefix)) fail();
  return `builder-command:${safeUuid(messageId.slice(prefix.length))}`;
}

function taskBriefIdForMessage(messageId) {
  const prefix = 'builder-message:';
  if (typeof messageId !== 'string' || !messageId.startsWith(prefix)) fail();
  return `builder-task:${safeUuid(messageId.slice(prefix.length))}`;
}

function compactTaskBriefText(value, maximumCodePoints = 1_000) {
  const normalized = value.normalize('NFC').replace(/\s+/gu, ' ').trim();
  const codePoints = Array.from(normalized);
  if (codePoints.length <= maximumCodePoints) return normalized;
  return `${codePoints.slice(0, maximumCodePoints - 3).join('').trimEnd()}...`;
}

function defaultRouteDecisionHint(mode) {
  if (mode === 'work') {
    return freezeDeep({
      route: 'build',
      confidence: 'high',
      matched_signals: ['clear_build'],
      downgraded_from: null,
      downgrade_reason: null,
      required_permissions: ['write_project'],
      permission_result: 'allowed',
      dispatch: 'build',
    });
  }
  return freezeDeep({
    route: 'answer',
    confidence: 'high',
    matched_signals: ['read_only'],
    downgraded_from: null,
    downgrade_reason: null,
    required_permissions: [],
    permission_result: 'not_required',
    dispatch: 'reply',
  });
}

function routeDecisionEvidence({ decisionId, projectId, messageId, taskId, mode, decidedAtMs, hint }) {
  const normalizedHint = hint === null ? defaultRouteDecisionHint(mode) : hint;
  if (mode === 'question' && ['build', 'plan'].includes(normalizedHint.route)) fail();
  if (mode === 'work' && !['build', 'plan'].includes(normalizedHint.route)) fail();
  if (normalizedHint.required_permissions.includes('write_project') !== (normalizedHint.route === 'build')) fail();
  if (normalizedHint.required_permissions.includes('project_read') && normalizedHint.route !== 'plan') fail();
  if (normalizedHint.route === 'build' && !['build', 'ask_workspace', 'ask_permission', 'blocked'].includes(normalizedHint.dispatch)) fail();
  if (normalizedHint.route === 'plan' && !['plan', 'ask_permission', 'blocked'].includes(normalizedHint.dispatch)) fail();
  if (normalizedHint.route === 'update_brief' && !['reply', 'brief_update'].includes(normalizedHint.dispatch)) fail();
  if ((normalizedHint.route === 'answer' || normalizedHint.route === 'clarify') && normalizedHint.dispatch !== 'reply') fail();
  return freezeDeep({
    decision_id: decisionId,
    decision_version: ROUTE_DECISION_VERSION,
    project_id: projectId,
    message_id: messageId,
    task_id: taskId,
    route: normalizedHint.route,
    confidence: normalizedHint.confidence,
    matched_signals: [...normalizedHint.matched_signals],
    downgraded_from: normalizedHint.downgraded_from,
    downgrade_reason: normalizedHint.downgrade_reason,
    required_permissions: [...normalizedHint.required_permissions],
    permission_result: normalizedHint.permission_result,
    dispatch: normalizedHint.dispatch,
    decided_at_ms: decidedAtMs,
  });
}

function turnSubmittedEventFromContext(context) {
  const submitted = context.events.find((event) => (
    event.event_type === 'turn_submitted'
    && event.payload.turn_id === context.ids.turn_id
  )) ?? null;
  if (
    submitted === null
    || submitted.payload.turn_id !== context.ids.turn_id
    || submitted.payload.message.message_id !== context.ids.message_id
  ) fail();
  return submitted;
}

function routeDecisionFromContext(context) {
  return turnSubmittedEventFromContext(context).payload.route_decision;
}

function userMessageTextFromContext(context) {
  return turnSubmittedEventFromContext(context).payload.message.text;
}

function shouldRecordTaskBrief(context) {
  const routeDecision = routeDecisionFromContext(context);
  return context.mode === 'question'
    && context.ids.task_id === null
    && routeDecision.route === 'update_brief'
    && routeDecision.dispatch === 'brief_update';
}

function isTaskBriefCorrection(context) {
  return routeDecisionFromContext(context).matched_signals.includes('brief_correction');
}

function taskBriefCapsule(context, assistantText, updatedAtMs) {
  const routeDecision = routeDecisionFromContext(context);
  const latestUserGoal = compactTaskBriefText(userMessageTextFromContext(context));
  const assistantProposal = compactTaskBriefText(assistantText, 2_000);
  const ready = !isTaskBriefCorrection(context);
  return freezeDeep({
    capsule_version: 'builder-task-capsule.v1',
    task_id: taskBriefIdForMessage(context.ids.message_id),
    project_id: context.project.project_id,
    title: 'Current project brief',
    goal: latestUserGoal,
    status: ready ? 'ready' : 'discussing',
    current_brief: {
      brief_version: 'builder-working-brief.v1',
      source: 'task_capsule_update',
      latest_user_goal: latestUserGoal,
      assistant_proposal: assistantProposal,
      approved_plan: null,
      use_when_instruction_is_contextual: ready,
    },
    last_route_decision_id: routeDecision.decision_id,
    updated_at_ms: updatedAtMs,
  });
}

function eventHead(record) {
  return freezeDeep({
    sequence: record.sequence,
    event_id: record.event_id,
    event_digest: record.event_digest,
  });
}

function headDigest(head) {
  return sha256Canonical({
    event_digest: head.event_digest,
    event_id: head.event_id,
    sequence: head.sequence,
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
  if (!isPlainObject(value)) fail();
  const keys = Reflect.ownKeys(value);
  if (
    keys.length < REQUIRED_OPTION_KEYS.length
    || keys.length > OPTION_KEYS.length
    || keys.some((key) => typeof key !== 'string' || !OPTION_KEYS.includes(key))
    || REQUIRED_OPTION_KEYS.some((key) => !keys.includes(key))
  ) fail();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  }
  const metadataAuthority = valueAt(value, 'metadataAuthority');
  const createUuid = valueAt(value, 'createUuid');
  const nowMs = valueAt(value, 'nowMs');
  const onTaskStreamChanged = keys.includes('onTaskStreamChanged')
    ? valueAt(value, 'onTaskStreamChanged')
    : null;
  if (
    typeof createUuid !== 'function'
    || utilTypes.isProxy(createUuid)
    || typeof nowMs !== 'function'
    || utilTypes.isProxy(nowMs)
    || (
      onTaskStreamChanged !== null
      && (typeof onTaskStreamChanged !== 'function' || utilTypes.isProxy(onTaskStreamChanged))
    )
  ) fail();
  return Object.freeze({
    metadataAuthority,
    appendEvents: ownMethod(metadataAuthority, 'append_conversation_events'),
    loadConversation: ownMethod(metadataAuthority, 'load_conversation'),
    loadCandidateByDraft: ownMethod(metadataAuthority, 'load_conversation_candidate_by_draft'),
    loadProjectIdentity: ownMethod(metadataAuthority, 'load_project_identity'),
    createUuid,
    nowMs,
    onTaskStreamChanged,
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

function sanitizeRevisionReference(value) {
  exactObject(value, ['revision_receipt_digest', 'revision_number']);
  return freezeDeep({
    revision_receipt_digest: safeDigest(valueAt(value, 'revision_receipt_digest')),
    revision_number: safeRevisionNumber(valueAt(value, 'revision_number')),
  });
}

function safeEnum(value, allowed) {
  if (typeof value !== 'string' || !allowed.includes(value)) fail();
  return value;
}

function sanitizeRouteDecisionSignalList(value) {
  if (!Array.isArray(value) || utilTypes.isProxy(value) || value.length < 1 || value.length > 8) fail();
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || keys.some((key) => typeof key === 'symbol')) fail();
  const seen = new Set();
  const signals = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
    const signal = descriptor.value;
    if (!isPublicBuilderRouteDecisionSignal(signal)) fail();
    if (seen.has(signal)) fail();
    seen.add(signal);
    signals.push(signal);
  }
  return freezeDeep(signals);
}

function sanitizeRouteDecisionPermissionList(value) {
  if (!Array.isArray(value) || utilTypes.isProxy(value) || value.length > 2) fail();
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || keys.some((key) => typeof key === 'symbol')) fail();
  const seen = new Set();
  const permissions = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
    const permission = safeEnum(descriptor.value, ROUTE_DECISION_PERMISSIONS);
    if (seen.has(permission)) fail();
    seen.add(permission);
    permissions.push(permission);
  }
  return freezeDeep(permissions);
}

function sanitizeRouteDecisionHint(value) {
  if (value === null) return null;
  exactObject(value, ROUTE_DECISION_HINT_KEYS);
  const route = safeEnum(valueAt(value, 'route'), ROUTE_DECISION_ROUTES);
  const requiredPermissions = sanitizeRouteDecisionPermissionList(valueAt(value, 'required_permissions'));
  const permissionResult = safeEnum(valueAt(value, 'permission_result'), ROUTE_DECISION_PERMISSION_RESULTS);
  const dispatch = safeEnum(valueAt(value, 'dispatch'), ROUTE_DECISION_DISPATCHES);
  const downgradedFrom = valueAt(value, 'downgraded_from') === null
    ? null
    : safeEnum(valueAt(value, 'downgraded_from'), ROUTE_DECISION_ROUTES);
  const downgradeReason = valueAt(value, 'downgrade_reason') === null
    ? null
    : safeEnum(valueAt(value, 'downgrade_reason'), ROUTE_DECISION_DOWNGRADE_REASONS);
  if ((downgradedFrom === null) !== (downgradeReason === null)) fail();
  if (downgradedFrom !== null && downgradedFrom === route) fail();
  if ((requiredPermissions.length === 0) !== (permissionResult === 'not_required')) fail();
  return freezeDeep({
    route,
    confidence: safeEnum(valueAt(value, 'confidence'), ROUTE_DECISION_CONFIDENCES),
    matched_signals: sanitizeRouteDecisionSignalList(valueAt(value, 'matched_signals')),
    downgraded_from: downgradedFrom,
    downgrade_reason: downgradeReason,
    required_permissions: requiredPermissions,
    permission_result: permissionResult,
    dispatch,
  });
}

function sanitizeBeginRequest(value) {
  const keys = Reflect.ownKeys(value);
  const hasRouteDecisionHint = keys.includes('route_decision_hint');
  exactObject(value, hasRouteDecisionHint
    ? ['project_id', 'instruction', 'request_digest', 'base_revision', 'route_decision_hint']
    : ['project_id', 'instruction', 'request_digest', 'base_revision']);
  return freezeDeep({
    project_id: safeProjectId(valueAt(value, 'project_id')),
    instruction: safeText(valueAt(value, 'instruction'), 12_000, 48_000),
    request_digest: safeDigest(valueAt(value, 'request_digest')),
    base_revision: sanitizeBaseRevision(valueAt(value, 'base_revision')),
    route_decision_hint: hasRouteDecisionHint
      ? sanitizeRouteDecisionHint(valueAt(value, 'route_decision_hint'))
      : null,
  });
}

function sanitizeQueuedFollowupReference(value) {
  exactObject(value, ['turn_id', 'run_id', 'message_id']);
  return freezeDeep({
    turn_id: safePattern(valueAt(value, 'turn_id'), TURN_ID_PATTERN),
    run_id: safePattern(valueAt(value, 'run_id'), RUN_ID_PATTERN),
    message_id: safeMessageId(valueAt(value, 'message_id')),
  });
}

function sanitizeQuestionRequest(value) {
  const keys = Reflect.ownKeys(value);
  const hasRouteDecisionHint = keys.includes('route_decision_hint');
  exactObject(value, hasRouteDecisionHint
    ? ['project_id', 'question', 'request_digest', 'base_revision', 'route_decision_hint']
    : ['project_id', 'question', 'request_digest', 'base_revision']);
  return freezeDeep({
    project_id: safeProjectId(valueAt(value, 'project_id')),
    question: safeText(valueAt(value, 'question'), 12_000, 48_000),
    request_digest: safeDigest(valueAt(value, 'request_digest')),
    base_revision: sanitizeBaseRevision(valueAt(value, 'base_revision')),
    route_decision_hint: hasRouteDecisionHint
      ? sanitizeRouteDecisionHint(valueAt(value, 'route_decision_hint'))
      : null,
  });
}

function sanitizeQueuedFollowupBeginRequest(value, textKey) {
  const keys = Reflect.ownKeys(value);
  const hasRouteDecisionHint = keys.includes('route_decision_hint');
  exactObject(value, hasRouteDecisionHint
    ? ['project_id', textKey, 'request_digest', 'base_revision', 'queued_followup', 'route_decision_hint']
    : ['project_id', textKey, 'request_digest', 'base_revision', 'queued_followup']);
  return freezeDeep({
    project_id: safeProjectId(valueAt(value, 'project_id')),
    [textKey]: safeText(valueAt(value, textKey), 12_000, 48_000),
    request_digest: safeDigest(valueAt(value, 'request_digest')),
    base_revision: sanitizeBaseRevision(valueAt(value, 'base_revision')),
    queued_followup: sanitizeQueuedFollowupReference(valueAt(value, 'queued_followup')),
    route_decision_hint: hasRouteDecisionHint
      ? sanitizeRouteDecisionHint(valueAt(value, 'route_decision_hint'))
      : null,
  });
}

function sanitizeActiveRunMessageRequest(value) {
  exactObject(value, ['context', 'message']);
  return freezeDeep({
    context: trustedContext(valueAt(value, 'context')),
    message: safeText(valueAt(value, 'message'), 12_000, 48_000),
  });
}

function sanitizePlanRunReference(value) {
  exactObject(value, ['project_id', 'conversation_id', 'turn_id', 'run_id']);
  const projectId = safeProjectId(valueAt(value, 'project_id'));
  const conversationId = safePattern(valueAt(value, 'conversation_id'), CONVERSATION_ID_PATTERN);
  if (conversationId !== `builder-conversation:${projectUuid(projectId)}`) fail();
  return freezeDeep({
    project_id: projectId,
    conversation_id: conversationId,
    turn_id: safePattern(valueAt(value, 'turn_id'), TURN_ID_PATTERN),
    run_id: safePattern(valueAt(value, 'run_id'), RUN_ID_PATTERN),
  });
}

function sanitizeApprovedPlanWorkRequest(value) {
  exactObject(value, [
    'project_id',
    'conversation_id',
    'turn_id',
    'run_id',
    'instruction',
    'request_digest',
    'base_revision',
  ]);
  const reference = sanitizePlanRunReference({
    project_id: valueAt(value, 'project_id'),
    conversation_id: valueAt(value, 'conversation_id'),
    turn_id: valueAt(value, 'turn_id'),
    run_id: valueAt(value, 'run_id'),
  });
  return freezeDeep({
    ...reference,
    instruction: safeText(valueAt(value, 'instruction'), 12_000, 48_000),
    request_digest: safeDigest(valueAt(value, 'request_digest')),
    base_revision: sanitizeBaseRevision(valueAt(value, 'base_revision')),
  });
}

function sanitizeDraftContinuationWorkRequest(value) {
  exactObject(value, ['admission', 'instruction', 'request_digest']);
  return freezeDeep({
    admission: sanitizeBuilderDraftContinuationAdmission(valueAt(value, 'admission')),
    instruction: safeText(valueAt(value, 'instruction'), 12_000, 48_000),
    request_digest: safeDigest(valueAt(value, 'request_digest')),
  });
}

function sanitizeAcceptCandidateRequest(value) {
  exactObject(value, ['draft_id', 'review_id', 'reviewer_id', 'reviewed_at_ms', 'revision']);
  return freezeDeep({
    draft_id: safePattern(valueAt(value, 'draft_id'), DRAFT_ID_PATTERN),
    review_id: safePattern(valueAt(value, 'review_id'), REVIEW_ID_PATTERN),
    reviewer_id: safePattern(valueAt(value, 'reviewer_id'), ACTOR_ID_PATTERN),
    reviewed_at_ms: safeTimestamp(valueAt(value, 'reviewed_at_ms')),
    revision: sanitizeRevisionReference(valueAt(value, 'revision')),
  });
}

function trustedContext(value) {
  if (!value || typeof value !== 'object' || !TRUSTED_CONTEXTS.has(value)) fail();
  return value;
}

function assertToolRecordContext(context, record) {
  if (
    context.mode !== 'work'
    || context.ids.task_id === null
    || context.run_terminal_failure_code !== null
    || context.cancel_requested
    || record.project_id !== context.project.project_id
    || record.conversation_id !== context.conversation.conversation_id
    || record.turn_id !== context.ids.turn_id
    || record.task_id !== context.ids.task_id
    || record.run_id !== context.ids.run_id
  ) fail();
}

function assertAgentStepProgressContext(context, admission) {
  if (
    context.mode !== 'work'
    || context.ids.task_id === null
    || context.run_terminal_failure_code !== null
    || context.cancel_requested
    || admission.project_id !== context.project.project_id
    || admission.conversation_id !== context.conversation.conversation_id
    || admission.turn_id !== context.ids.turn_id
    || admission.task_id !== context.ids.task_id
    || admission.run_id !== context.ids.run_id
  ) fail();
}

function compactToolSessionCalls(toolCalls) {
  return toolCalls.map((toolCall) => ({
    step_id: toolCall.step_id,
    tool_call_id: toolCall.tool_call_id,
    tool_call_record: toolCall.tool_call_record,
    tool_result_record: toolCall.tool_result_record,
  }));
}

function createBuilderConversationMainService(rawOptions) {
  const options = sanitizeOptions(rawOptions);

  function notifyTaskStreamChanged(projectId) {
    if (options.onTaskStreamChanged === null) return;
    try {
      Reflect.apply(options.onTaskStreamChanged, undefined, [freezeDeep({
        event_version: TASK_STREAM_CHANGED_EVENT_VERSION,
        project_id: projectId,
      })]);
    } catch {
      // Activity notifications are a renderer refresh hint, not Conversation authority.
    }
  }

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

  function loadCandidateConversation(draftId) {
    try {
      const result = Reflect.apply(options.loadCandidateByDraft, options.metadataAuthority, [{
        draft_id: draftId,
      }]);
      exactObject(result, [
        'result_version',
        'operation',
        'conversation',
        'action_events',
        'current_head',
        'events',
        'snapshot',
        'metadata_evidence',
      ]);
      const conversation = exactObject(valueAt(result, 'conversation'), [
        'project_id', 'conversation_id', 'created_at_ms',
      ]);
      const projectId = safeProjectId(valueAt(conversation, 'project_id'));
      const conversationId = safePattern(
        valueAt(conversation, 'conversation_id'),
        CONVERSATION_ID_PATTERN,
      );
      if (conversationId.slice('builder-conversation:'.length) !== projectUuid(projectId)) fail();
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
      const appended = sanitizeAuthorityResult(result, project.project_id, conversation.conversation_id);
      notifyTaskStreamChanged(project.project_id);
      return appended;
    } catch {
      fail();
    }
  }

  function activeRunFromContext(context) {
    let snapshot;
    try {
      snapshot = replayBuilderConversation(context.events);
    } catch {
      fail();
    }
    const turn = snapshot.turns.find((item) => item.turn_id === context.ids.turn_id) ?? null;
    const run = turn?.runs.at(-1) ?? null;
    if (
      turn === null
      || run === null
      || turn.task === null
      || turn.task.task_id !== context.ids.task_id
      || run.run_id !== context.ids.run_id
    ) fail();
    return run;
  }

  function latestTaskCapsuleFromEvents(events) {
    let capsule = null;
    for (const event of events) {
      if (event.event_type === 'task_brief_updated') {
        const taskCapsule = event.payload.task_capsule;
        capsule = (
          taskCapsule.status === 'ready'
          && taskCapsule.current_brief.use_when_instruction_is_contextual === true
        )
          ? {
            message_id: event.payload.message_id,
            task_capsule: taskCapsule,
          }
          : null;
      }
    }
    return capsule;
  }

  function openRunFromContext(context) {
    let snapshot;
    try {
      snapshot = replayBuilderConversation(context.events);
    } catch {
      fail();
    }
    const turn = snapshot.turns.find((item) => item.turn_id === context.ids.turn_id) ?? null;
    const run = turn?.runs.at(-1) ?? null;
    if (
      turn === null
      || run === null
      || snapshot.active_turn_id !== context.ids.turn_id
      || turn.mode !== context.mode
      || (context.mode === 'work' && turn.task?.task_id !== context.ids.task_id)
      || (context.mode === 'question' && (turn.task !== null || context.ids.task_id !== null))
      || run.run_id !== context.ids.run_id
      || run.status !== 'running'
    ) fail();
    return freezeDeep({ snapshot, turn, run });
  }

  function admitToolCallState(context, record, admittedAtMs) {
    const run = activeRunFromContext(context);
    try {
      Reflect.apply(admitBuilderToolCallSessionState, undefined, [{
        project_id: context.project.project_id,
        conversation_id: context.conversation.conversation_id,
        turn_id: context.ids.turn_id,
        task_id: context.ids.task_id,
        run_id: context.ids.run_id,
        run_status: run.status,
        interrupt_requested: run.interrupt_request_id !== null,
        cancel_requested: run.cancel_request_id !== null,
        existing_tool_calls: compactToolSessionCalls(run.tool_calls),
        tool_call_record: record,
        admitted_at_ms: admittedAtMs,
      }]);
    } catch {
      fail();
    }
  }

  function admitToolResultState(context, record, admittedAtMs) {
    const run = activeRunFromContext(context);
    try {
      Reflect.apply(admitBuilderToolResultSessionState, undefined, [{
        project_id: context.project.project_id,
        conversation_id: context.conversation.conversation_id,
        turn_id: context.ids.turn_id,
        task_id: context.ids.task_id,
        run_id: context.ids.run_id,
        run_status: run.status,
        interrupt_requested: run.interrupt_request_id !== null,
        cancel_requested: run.cancel_request_id !== null,
        existing_tool_calls: compactToolSessionCalls(run.tool_calls),
        tool_result_record: record,
        admitted_at_ms: admittedAtMs,
      }]);
    } catch {
      fail();
    }
  }

  function projectCreatedAt(projectId, baseRevision, now, loadedState) {
    if (loadedState !== null) return safeTimestamp(loadedState.conversation.created_at_ms);
    try {
      const loaded = Reflect.apply(options.loadProjectIdentity, options.metadataAuthority, [{
        project_id: projectId,
      }]);
      exactObject(loaded, ['result_version', 'operation', 'project', 'metadata_evidence']);
      if (
        valueAt(loaded, 'result_version') !== 'builder-product-metadata-result.v4'
        || valueAt(loaded, 'operation') !== 'project_identity_loaded'
      ) fail();
      const project = exactObject(valueAt(loaded, 'project'), [
        'project_id',
        'created_at_ms',
        'current_revision_receipt_digest',
        'current_revision_number',
      ]);
      if (valueAt(project, 'project_id') !== projectId) fail();
      return safeTimestamp(valueAt(project, 'created_at_ms'));
    } catch {
      if (baseRevision === null) return now;
      fail();
    }
  }

  function recoverActive(state, project, conversation, recordedAtMs) {
    if (state === null || state.snapshot.active_turn_id === null) return state;
    const turn = state.snapshot.turns.find((item) => item.turn_id === state.snapshot.active_turn_id);
    const run = turn?.runs.at(-1);
    if (!turn || !run) fail();
    if (run.status === 'completed') {
      if (!['failed', 'interrupted', 'cancelled'].includes(run.terminal_status)) fail();
      const completed = eventAt({
        projectId: project.project_id,
        conversationId: conversation.conversation_id,
        sequence: state.head.sequence + 1,
        commandId: newId(options.createUuid, 'builder-command'),
        eventType: 'turn_completed',
        previous: state.head,
        payload: {
          turn_id: turn.turn_id,
          run_id: run.run_id,
          outcome: run.terminal_status,
        },
      });
      return append({
        project,
        conversation,
        expectedHead: state.head,
        events: [completed],
        recordedAtMs,
      });
    }
    if (run.status !== 'running') fail();
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
        plan_admission: null,
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

  function beginTurn(request, mode) {
    const recordedAtMs = safeTimestamp(Reflect.apply(options.nowMs, undefined, []));
    const conversationId = `builder-conversation:${projectUuid(request.project_id)}`;
    let state = load(request.project_id, conversationId);
    if (state === null && request.base_revision !== null) fail();
    if (request.queued_followup !== undefined && state?.snapshot.active_turn_id !== null) fail();
    const project = freezeDeep({
      project_id: request.project_id,
      created_at_ms: projectCreatedAt(
        request.project_id,
        request.base_revision,
        recordedAtMs,
        state,
      ),
    });
    const conversation = freezeDeep({
      project_id: request.project_id,
      conversation_id: conversationId,
      created_at_ms: state?.conversation.created_at_ms ?? project.created_at_ms,
    });
    state = recoverActive(state, project, conversation, recordedAtMs);
    const priorHead = state?.head ?? null;
    const taskId = mode === 'work' ? newId(options.createUuid, 'builder-task') : null;
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
      task_id: taskId,
      run_id: newId(options.createUuid, 'builder-run'),
    });
    const followupConsumptionCommandId = request.queued_followup === undefined
      ? null
      : newId(options.createUuid, 'builder-command');
    const first = eventAt({
      projectId: request.project_id,
      conversationId,
      sequence: (priorHead?.sequence ?? 0) + 1,
      commandId: ids.turn_command_id,
      eventType: 'turn_submitted',
      previous: priorHead,
      payload: {
        message: {
          message_id: ids.message_id,
          text: mode === 'work' ? request.instruction : request.question,
        },
        turn_id: ids.turn_id,
        mode,
        task: mode === 'work'
          ? {
            task_id: ids.task_id,
            title: request.base_revision === null ? 'Create Builder project' : 'Update Builder project',
          }
          : null,
        base_revision: request.base_revision,
        route_decision: routeDecisionEvidence({
          decisionId: routeDecisionIdForMessage(ids.message_id),
          projectId: request.project_id,
          messageId: ids.message_id,
          taskId: mode === 'work' ? ids.task_id : null,
          mode,
          decidedAtMs: recordedAtMs,
          hint: request.route_decision_hint,
        }),
      },
    });
    const followupConsumption = request.queued_followup === undefined
      ? null
      : eventAt({
        projectId: request.project_id,
        conversationId,
        sequence: first.sequence + 1,
        commandId: followupConsumptionCommandId,
        eventType: 'turn_followup_consumed',
        previous: eventHead(first),
        payload: {
          turn_id: request.queued_followup.turn_id,
          run_id: request.queued_followup.run_id,
          message_id: request.queued_followup.message_id,
          consuming_turn_id: ids.turn_id,
          consuming_message_id: ids.message_id,
        },
      });
    const second = eventAt({
      projectId: request.project_id,
      conversationId,
      sequence: (followupConsumption ?? first).sequence + 1,
      commandId: ids.run_command_id,
      eventType: 'run_started',
      previous: eventHead(followupConsumption ?? first),
      payload: {
        turn_id: ids.turn_id,
        run_id: ids.run_id,
        task_id: mode === 'work' ? ids.task_id : null,
        attempt_number: 1,
        retry_of_run_id: null,
        input_digest: request.request_digest,
      },
    });
    const appended = append({
      project,
      conversation,
      expectedHead: priorHead,
      events: followupConsumption === null ? [first, second] : [first, followupConsumption, second],
      recordedAtMs,
    });
    const context = freezeDeep({
      context_version: 'builder-conversation-run-context.v1',
      mode,
      project,
      conversation,
      request_digest: request.request_digest,
      start_head: { ...appended.head },
      attempt_number: 1,
      events: appended.events,
      run_terminal_failure_code: null,
      ids,
      cancel_requested: false,
    });
    TRUSTED_CONTEXTS.add(context);
    return context;
  }

  function beginWork(rawRequest) {
    return beginTurn(sanitizeBeginRequest(rawRequest), 'work');
  }

  function beginQuestion(rawRequest) {
    return beginTurn(sanitizeQuestionRequest(rawRequest), 'question');
  }

  function beginQueuedFollowupWork(rawRequest) {
    return beginTurn(sanitizeQueuedFollowupBeginRequest(rawRequest, 'instruction'), 'work');
  }

  function beginQueuedFollowupQuestion(rawRequest) {
    return beginTurn(sanitizeQueuedFollowupBeginRequest(rawRequest, 'question'), 'question');
  }

  function sameConversationHead(left, right) {
    return left.sequence === right.sequence
      && left.event_id === right.event_id
      && left.event_digest === right.event_digest;
  }

  function createContinuationWorkIds() {
    const taskId = newId(options.createUuid, 'builder-task');
    return freezeDeep({
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
      task_id: taskId,
      run_id: newId(options.createUuid, 'builder-run'),
    });
  }

  function beginApprovedPlanWork(rawRequest) {
    try {
      const request = sanitizeApprovedPlanWorkRequest(rawRequest);
      const approvedPlan = readApprovedPlan({
        project_id: request.project_id,
        conversation_id: request.conversation_id,
        turn_id: request.turn_id,
        run_id: request.run_id,
      });
      if (request.instruction !== approvedPlan.approved_plan_public_text) fail();
      const state = load(request.project_id, request.conversation_id);
      if (
        state === null
        || state.snapshot.active_turn_id !== null
        || !sameConversationHead(state.head, approvedPlan.conversation_head)
      ) fail();
      const recordedAtMs = safeTimestamp(Reflect.apply(options.nowMs, undefined, []));
      const project = freezeDeep({
        project_id: request.project_id,
        created_at_ms: projectCreatedAt(request.project_id, request.base_revision, recordedAtMs, state),
      });
      const conversation = freezeDeep({
        project_id: request.project_id,
        conversation_id: request.conversation_id,
        created_at_ms: state.conversation.created_at_ms,
      });
      const ids = createContinuationWorkIds();
      const first = eventAt({
        projectId: request.project_id,
        conversationId: request.conversation_id,
        sequence: state.head.sequence + 1,
        commandId: ids.turn_command_id,
        eventType: 'turn_submitted',
        previous: state.head,
        payload: {
          message: {
            message_id: ids.message_id,
            text: request.instruction,
          },
          turn_id: ids.turn_id,
          mode: 'work',
          task: {
            task_id: ids.task_id,
            title: 'Apply approved plan',
          },
          base_revision: request.base_revision,
          route_decision: routeDecisionEvidence({
            decisionId: routeDecisionIdForMessage(ids.message_id),
            projectId: request.project_id,
            messageId: ids.message_id,
            taskId: ids.task_id,
            mode: 'work',
            decidedAtMs: recordedAtMs,
            hint: null,
          }),
        },
      });
      const second = eventAt({
        projectId: request.project_id,
        conversationId: request.conversation_id,
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
        expectedHead: state.head,
        events: [first, second],
        recordedAtMs,
      });
      const context = freezeDeep({
        context_version: 'builder-conversation-run-context.v1',
        mode: 'work',
        project,
        conversation,
        request_digest: request.request_digest,
        start_head: { ...appended.head },
        attempt_number: 1,
        events: appended.events,
        run_terminal_failure_code: null,
        ids,
        cancel_requested: false,
      });
      TRUSTED_CONTEXTS.add(context);
      return context;
    } catch {
      fail();
    }
  }

  function assertDraftContinuationAdmissionMatches(admission, draft, state) {
    const receipt = draft.candidate_result.git_candidate_receipt;
    const turn = state.snapshot.turns.find((item) => item.turn_id === draft.turn_id) ?? null;
    const run = turn?.runs.find((item) => item.run_id === draft.run_id) ?? null;
    if (
      admission.project_id !== draft.project_id
      || admission.conversation_id !== draft.conversation_id
      || admission.draft_id !== draft.draft_id
      || admission.previous_turn_id !== draft.turn_id
      || admission.previous_task_id !== draft.task_id
      || admission.previous_run_id !== draft.run_id
      || admission.candidate_id !== receipt.candidate_id
      || admission.candidate_digest !== receipt.candidate_digest
      || admission.resulting_tree_digest !== receipt.resulting_tree_digest
      || !sameHead(admission.conversation_head, draft.conversation_head)
      || !sameHead(admission.conversation_head, state.head)
      || turn === null
      || turn.task === null
      || turn.task.task_id !== draft.task_id
      || run === null
      || (
        admission.previous_request_digest !== null
        && run.input_digest !== admission.previous_request_digest
      )
      || run.candidate_review !== null
    ) fail();
  }

  function beginDraftContinuationWork(rawRequest) {
    try {
      const request = sanitizeDraftContinuationWorkRequest(rawRequest);
      const admission = request.admission;
      const draft = readCandidateDraft({ draft_id: admission.draft_id });
      const state = load(admission.project_id, admission.conversation_id);
      if (
        state === null
        || state.snapshot.active_turn_id !== null
        || !sameHead(state.head, admission.conversation_head)
      ) fail();
      assertDraftContinuationAdmissionMatches(admission, draft, state);
      const recordedAtMs = safeTimestamp(Reflect.apply(options.nowMs, undefined, []));
      const project = freezeDeep({
        project_id: admission.project_id,
        created_at_ms: projectCreatedAt(admission.project_id, draft.base_revision, recordedAtMs, state),
      });
      const conversation = freezeDeep({
        project_id: admission.project_id,
        conversation_id: admission.conversation_id,
        created_at_ms: state.conversation.created_at_ms,
      });
      const ids = createContinuationWorkIds();
      const first = eventAt({
        projectId: admission.project_id,
        conversationId: admission.conversation_id,
        sequence: state.head.sequence + 1,
        commandId: ids.turn_command_id,
        eventType: 'turn_submitted',
        previous: state.head,
        payload: {
          message: {
            message_id: ids.message_id,
            text: request.instruction,
          },
          turn_id: ids.turn_id,
          mode: 'work',
          task: {
            task_id: ids.task_id,
            title: 'Revise unsaved draft',
          },
          base_revision: draft.base_revision,
          route_decision: routeDecisionEvidence({
            decisionId: routeDecisionIdForMessage(ids.message_id),
            projectId: admission.project_id,
            messageId: ids.message_id,
            taskId: ids.task_id,
            mode: 'work',
            decidedAtMs: recordedAtMs,
            hint: null,
          }),
        },
      });
      const second = eventAt({
        projectId: admission.project_id,
        conversationId: admission.conversation_id,
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
        expectedHead: state.head,
        events: [first, second],
        recordedAtMs,
      });
      const context = freezeDeep({
        context_version: 'builder-conversation-run-context.v1',
        mode: 'work',
        project,
        conversation,
        request_digest: request.request_digest,
        start_head: { ...appended.head },
        attempt_number: 1,
        events: appended.events,
        run_terminal_failure_code: null,
        ids,
        cancel_requested: false,
        draft_continuation: {
          admission_digest: admission.admission_digest,
          draft_id: admission.draft_id,
          previous_turn_id: admission.previous_turn_id,
          previous_task_id: admission.previous_task_id,
          previous_run_id: admission.previous_run_id,
          previous_candidate_digest: admission.candidate_digest,
        },
      });
      TRUSTED_CONTEXTS.add(context);
      return context;
    } catch {
      fail();
    }
  }

  function latestRunProgressStage(context) {
    for (const event of [...context.events].reverse()) {
      if (
        event.event_type === 'run_progress_recorded'
        && event.payload.turn_id === context.ids.turn_id
        && event.payload.run_id === context.ids.run_id
        && typeof event.payload.stage === 'string'
      ) {
        return event.payload.stage;
      }
    }
    return null;
  }

  function failureAssistantMessage(mode, failureCode, lastProgressStage) {
    if (failureCode === 'builder_generation_provider_unavailable') {
      return 'AI is not configured yet.';
    }
    if (failureCode === 'builder_generation_provider_transport_error') {
      return 'The AI service could not be reached.';
    }
    if (failureCode === 'builder_generation_provider_http_error') {
      return 'The AI service could not complete this request.';
    }
    if (failureCode === 'builder_generation_timeout') {
      return mode === 'question'
        ? 'Answering took too long.'
        : 'Making this draft took too long.';
    }
    if (failureCode === 'builder_generation_structured_response_invalid') {
      return mode === 'question'
        ? 'The answer could not be prepared.'
        : 'The draft could not be prepared.';
    }
    if (lastProgressStage === 'provider_request_started') {
      return mode === 'question'
        ? 'The AI request ended before it returned a usable answer.'
        : 'The AI request ended before it returned a usable draft.';
    }
    return mode === 'question'
      ? 'The answer could not be prepared.'
      : 'The draft could not be made.';
  }

  function failureEvents(context, failureCode, completeTurn) {
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
          text: failureAssistantMessage(context.mode, failureCode, latestRunProgressStage(context)),
        },
        candidate_result: null,
        plan_admission: null,
      },
    });
    events.push(completed);
    if (completeTurn) {
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
    }
    return freezeDeep({
      completed_head: eventHead(completed),
      events,
    });
  }

  function retryAfterFailure(rawRequest) {
    exactObject(rawRequest, ['context', 'failure_code']);
    const context = trustedContext(valueAt(rawRequest, 'context'));
    const failureCode = safeText(valueAt(rawRequest, 'failure_code'), 80, 160);
    const recordedAtMs = safeTimestamp(Reflect.apply(options.nowMs, undefined, []));
    const failed = context.run_terminal_failure_code === failureCode
      ? freezeDeep({ completed_head: context.start_head, events: [] })
      : failureEvents(context, failureCode, false);
    const retryIds = freezeDeep({
      ...context.ids,
      run_command_id: newId(options.createUuid, 'builder-command'),
      terminal_command_id: newId(options.createUuid, 'builder-command'),
      turn_terminal_command_id: newId(options.createUuid, 'builder-command'),
      cancel_command_id: newId(options.createUuid, 'builder-command'),
      cancel_request_id: newId(options.createUuid, 'builder-cancel-request'),
      interrupt_command_id: newId(options.createUuid, 'builder-command'),
      interrupt_request_id: newId(options.createUuid, 'builder-interrupt-request'),
      assistant_message_id: newId(options.createUuid, 'builder-message'),
      run_id: newId(options.createUuid, 'builder-run'),
    });
    const retryStarted = eventAt({
      projectId: context.project.project_id,
      conversationId: context.conversation.conversation_id,
      sequence: failed.completed_head.sequence + 1,
      commandId: retryIds.run_command_id,
      eventType: 'run_started',
      previous: failed.completed_head,
      payload: {
        turn_id: context.ids.turn_id,
        run_id: retryIds.run_id,
        task_id: context.mode === 'work' ? context.ids.task_id : null,
        attempt_number: context.attempt_number + 1,
        retry_of_run_id: context.ids.run_id,
        input_digest: context.request_digest,
      },
    });
    const appended = append({
      project: context.project,
      conversation: context.conversation,
      expectedHead: context.start_head,
      events: [...failed.events, retryStarted],
      recordedAtMs,
    });
    const retryContext = freezeDeep({
      ...context,
      start_head: { ...appended.head },
      attempt_number: context.attempt_number + 1,
      events: appended.events,
      run_terminal_failure_code: null,
      ids: retryIds,
      cancel_requested: false,
    });
    TRUSTED_CONTEXTS.add(retryContext);
    return retryContext;
  }

  function recordRetryableFailure(rawRequest) {
    exactObject(rawRequest, ['context', 'failure_code']);
    const context = trustedContext(valueAt(rawRequest, 'context'));
    if (context.run_terminal_failure_code !== null) fail();
    const failureCode = safeText(valueAt(rawRequest, 'failure_code'), 80, 160);
    const recordedAtMs = safeTimestamp(Reflect.apply(options.nowMs, undefined, []));
    const failed = failureEvents(context, failureCode, false);
    const appended = append({
      project: context.project,
      conversation: context.conversation,
      expectedHead: context.start_head,
      events: failed.events,
      recordedAtMs,
    });
    const failedContext = freezeDeep({
      ...context,
      start_head: { ...appended.head },
      events: appended.events,
      run_terminal_failure_code: failureCode,
    });
    TRUSTED_CONTEXTS.add(failedContext);
    return failedContext;
  }

  function recordRunProgress(rawRequest) {
    exactObject(rawRequest, ['context', 'stage']);
    const context = trustedContext(valueAt(rawRequest, 'context'));
    if (
      context.run_terminal_failure_code !== null
      || context.cancel_requested
    ) fail();
    const stage = safeRunProgressStage(valueAt(rawRequest, 'stage'));
    const recordedAtMs = safeTimestamp(Reflect.apply(options.nowMs, undefined, []));
    const progress = eventAt({
      projectId: context.project.project_id,
      conversationId: context.conversation.conversation_id,
      sequence: context.start_head.sequence + 1,
      commandId: newId(options.createUuid, 'builder-command'),
      eventType: 'run_progress_recorded',
      previous: context.start_head,
      payload: {
        turn_id: context.ids.turn_id,
        run_id: context.ids.run_id,
        stage,
      },
    });
    const appended = append({
      project: context.project,
      conversation: context.conversation,
      expectedHead: context.start_head,
      events: [progress],
      recordedAtMs,
    });
    const progressedContext = freezeDeep({
      ...context,
      start_head: { ...appended.head },
      events: appended.events,
    });
    TRUSTED_CONTEXTS.add(progressedContext);
    return progressedContext;
  }

  function recordAgentStepProgress(rawRequest) {
    exactObject(rawRequest, ['context', 'progress_admission']);
    const context = trustedContext(valueAt(rawRequest, 'context'));
    const admission = sanitizeBuilderAgentStepProgressConversationAdmission(
      valueAt(rawRequest, 'progress_admission'),
    );
    assertAgentStepProgressContext(context, admission);
    const recordedAtMs = safeTimestamp(Reflect.apply(options.nowMs, undefined, []));
    if (admission.admitted_at_ms > recordedAtMs) fail();
    openRunFromContext(context);
    const recorded = eventAt({
      projectId: context.project.project_id,
      conversationId: context.conversation.conversation_id,
      sequence: context.start_head.sequence + 1,
      commandId: newId(options.createUuid, 'builder-command'),
      eventType: 'agent_step_progress_recorded',
      previous: context.start_head,
      payload: {
        progress_admission: admission,
      },
    });
    const appended = append({
      project: context.project,
      conversation: context.conversation,
      expectedHead: context.start_head,
      events: [recorded],
      recordedAtMs,
    });
    const progressedContext = freezeDeep({
      ...context,
      start_head: { ...appended.head },
      events: appended.events,
    });
    TRUSTED_CONTEXTS.add(progressedContext);
    return progressedContext;
  }

  function recordRunContextSnapshot(rawRequest) {
    exactObject(rawRequest, ['context']);
    const context = trustedContext(valueAt(rawRequest, 'context'));
    if (
      context.run_terminal_failure_code !== null
      || context.cancel_requested
    ) fail();
    const { run } = openRunFromContext(context);
    if (
      run.context_snapshot !== null
      || run.progress_stages.length > 0
      || run.tool_calls.length > 0
      || run.interrupt_request_id !== null
      || run.cancel_request_id !== null
    ) fail();
    const submitted = turnSubmittedEventFromContext(context);
    const recordedAtMs = safeTimestamp(Reflect.apply(options.nowMs, undefined, []));
    const snapshot = createBuilderRunContextSnapshot({
      project_id: context.project.project_id,
      conversation_id: context.conversation.conversation_id,
      turn_id: context.ids.turn_id,
      run_id: context.ids.run_id,
      task_id: context.ids.task_id,
      message_id: submitted.payload.message.message_id,
      route_decision: submitted.payload.route_decision,
      latest_task_capsule: latestTaskCapsuleFromEvents(context.events),
      base_revision: submitted.payload.base_revision,
      created_at_ms: recordedAtMs,
    });
    const recorded = eventAt({
      projectId: context.project.project_id,
      conversationId: context.conversation.conversation_id,
      sequence: context.start_head.sequence + 1,
      commandId: newId(options.createUuid, 'builder-command'),
      eventType: 'run_context_snapshot_recorded',
      previous: context.start_head,
      payload: {
        turn_id: context.ids.turn_id,
        run_id: context.ids.run_id,
        snapshot,
      },
    });
    const appended = append({
      project: context.project,
      conversation: context.conversation,
      expectedHead: context.start_head,
      events: [recorded],
      recordedAtMs,
    });
    const snapshottedContext = freezeDeep({
      ...context,
      start_head: { ...appended.head },
      events: appended.events,
    });
    TRUSTED_CONTEXTS.add(snapshottedContext);
    return snapshottedContext;
  }

  function completeCandidate(rawRequest) {
    exactObject(rawRequest, ['context', 'candidate_result', 'assistant_text']);
    const context = trustedContext(valueAt(rawRequest, 'context'));
    if (context.mode !== 'work' || context.ids.task_id === null) fail();
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
        plan_admission: null,
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

  function publicPlanMessage(planRecord) {
    const lines = [
      planRecord.title,
      '',
      planRecord.summary,
      '',
      'Plan:',
      ...planRecord.steps.map((step, index) => `${index + 1}. ${step.title}`),
    ];
    return safeText(lines.join('\n'), 4_000, 16_000);
  }

  function sameContextBinding(left, right) {
    return left.source_context_result_version === right.source_context_result_version
      && left.collector_authority === right.collector_authority
      && left.context_digest === right.context_digest
      && left.context_status === right.context_status
      && left.file_count === right.file_count
      && left.total_content_bytes === right.total_content_bytes
      && left.head_sequence === right.head_sequence
      && left.head_digest === right.head_digest;
  }

  function planToolReadEvidence(run, sourceContext) {
    if (
      run.tool_calls.length < 1
      || sourceContext.reads.length !== run.tool_calls.length
      || sourceContext.context_binding.file_count !== sourceContext.reads.length
    ) fail();
    const byToolCallId = new Map();
    for (const toolCall of run.tool_calls) {
      if (byToolCallId.has(toolCall.tool_call_id)) fail();
      byToolCallId.set(toolCall.tool_call_id, toolCall);
    }
    const seenToolCalls = new Set();
    return freezeDeep(sourceContext.reads.map((read) => {
      const toolCall = byToolCallId.get(read.tool_call_id) ?? null;
      const resultRecord = toolCall?.tool_result_record ?? null;
      if (
        toolCall === null
        || resultRecord === null
        || seenToolCalls.has(read.tool_call_id)
        || read.status !== 'succeeded'
        || toolCall.tool_name !== 'filesystem.read'
        || toolCall.action !== 'filesystem.read'
        || toolCall.resource.resource_kind !== 'filesystem'
        || toolCall.resource.project_id !== sourceContext.project_id
        || toolCall.resource.resource_id !== read.resource_id
        || toolCall.tool_call_record.tool_call_id !== read.tool_call_id
        || toolCall.tool_call_record.record_digest !== resultRecord.tool_call_record.record_digest
        || resultRecord.tool_call_id !== read.tool_call_id
        || resultRecord.action !== 'filesystem.read'
        || resultRecord.resource_kind !== 'filesystem'
        || resultRecord.result.status !== 'succeeded'
      ) fail();
      seenToolCalls.add(read.tool_call_id);
      return {
        resource_id: read.resource_id,
        tool_call_id: read.tool_call_id,
        tool_call_record_digest: toolCall.tool_call_record.record_digest,
        tool_result_record_digest: resultRecord.record_digest,
        result_summary_digest: resultRecord.result.summary_digest,
        result_status: 'succeeded',
      };
    }));
  }

  function completePlan(rawRequest) {
    exactObject(rawRequest, ['context', 'source_context_result', 'plan_proposal_record']);
    const context = trustedContext(valueAt(rawRequest, 'context'));
    if (
      context.mode !== 'work'
      || context.ids.task_id === null
      || context.run_terminal_failure_code !== null
      || context.cancel_requested
    ) fail();
    const run = activeRunFromContext(context);
    if (
      run.status !== 'running'
      || run.cancel_request_id !== null
      || run.interrupt_request_id !== null
      || run.tool_calls.some((toolCall) => (
        toolCall.tool_result_record === null
        || toolCall.tool_result_record.result.status !== 'succeeded'
      ))
    ) fail();
    let sourceContext;
    let planRecord;
    try {
      sourceContext = sanitizeBuilderPlanProposalSourceContextResult(
        valueAt(rawRequest, 'source_context_result'),
      );
      planRecord = sanitizeBuilderPlanProposalRecord(
        valueAt(rawRequest, 'plan_proposal_record'),
      );
    } catch {
      fail();
    }
    if (
      planRecord.project_id !== context.project.project_id
      || planRecord.conversation_id !== context.conversation.conversation_id
      || planRecord.turn_id !== context.ids.turn_id
      || planRecord.task_id !== context.ids.task_id
      || planRecord.run_id !== context.ids.run_id
      || planRecord.attempt_number !== context.attempt_number
      || planRecord.plan_state !== 'proposed'
      || planRecord.result_kind !== 'plan'
      || planRecord.context_binding.head_sequence !== context.start_head.sequence
      || planRecord.context_binding.head_digest !== headDigest(context.start_head)
      || sourceContext.project_id !== context.project.project_id
      || sourceContext.conversation_id !== context.conversation.conversation_id
      || sourceContext.turn_id !== context.ids.turn_id
      || sourceContext.task_id !== context.ids.task_id
      || sourceContext.run_id !== context.ids.run_id
      || sourceContext.attempt_number !== context.attempt_number
      || sourceContext.request_digest !== context.request_digest
      || !sameContextBinding(sourceContext.context_binding, planRecord.context_binding)
      || planRecord.authority.conversation_event !== 'not_admitted_by_record_contract'
      || planRecord.authority.provider_dispatch !== false
      || planRecord.authority.renderer_authority !== 'not_present'
      || planRecord.authority.git_authority !== 'not_present'
      || planRecord.authority.revision_admission !== 'not_created'
    ) fail();
    const recordedAtMs = safeTimestamp(Reflect.apply(options.nowMs, undefined, []));
    if (planRecord.proposed_at_ms > recordedAtMs) fail();
    const planAdmission = createBuilderConversationPlanAdmission({
      admission_version: 'builder-conversation-plan-admission.v1',
      admission_kind: 'builder_conversation_plan_admission',
      admission_authority: 'trusted_conversation_main_service_complete_plan_v1',
      project_id: context.project.project_id,
      conversation_id: context.conversation.conversation_id,
      turn_id: context.ids.turn_id,
      task_id: context.ids.task_id,
      run_id: context.ids.run_id,
      attempt_number: context.attempt_number,
      plan_record_digest: planRecord.record_digest,
      source_context_result_version: planRecord.context_binding.source_context_result_version,
      collector_authority: planRecord.context_binding.collector_authority,
      context_digest: planRecord.context_binding.context_digest,
      context_status: planRecord.context_binding.context_status,
      file_count: planRecord.context_binding.file_count,
      total_content_bytes: planRecord.context_binding.total_content_bytes,
      head_sequence: planRecord.context_binding.head_sequence,
      head_digest: planRecord.context_binding.head_digest,
      tool_reads: planToolReadEvidence(run, sourceContext),
    });
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
        result_kind: 'plan',
        result_digest: planRecord.record_digest,
        assistant_message: {
          message_id: context.ids.assistant_message_id,
          text: publicPlanMessage(planRecord),
        },
        candidate_result: null,
        plan_admission: planAdmission,
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
        outcome: 'plan_proposed',
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

  function recordToolCallRequest(rawRequest) {
    exactObject(rawRequest, ['context', 'tool_call_record']);
    const context = trustedContext(valueAt(rawRequest, 'context'));
    const record = sanitizeBuilderToolCallRecord(valueAt(rawRequest, 'tool_call_record'));
    assertToolRecordContext(context, record);
    const recordedAtMs = safeTimestamp(Reflect.apply(options.nowMs, undefined, []));
    if (record.requested_at_ms > recordedAtMs) fail();
    admitToolCallState(context, record, record.requested_at_ms);
    const requested = eventAt({
      projectId: context.project.project_id,
      conversationId: context.conversation.conversation_id,
      sequence: context.start_head.sequence + 1,
      commandId: newId(options.createUuid, 'builder-command'),
      eventType: 'tool_call_requested',
      previous: context.start_head,
      payload: {
        tool_call_record: record,
      },
    });
    const appended = append({
      project: context.project,
      conversation: context.conversation,
      expectedHead: context.start_head,
      events: [requested],
      recordedAtMs,
    });
    const updatedContext = freezeDeep({
      ...context,
      start_head: { ...appended.head },
      events: appended.events,
    });
    TRUSTED_CONTEXTS.add(updatedContext);
    return updatedContext;
  }

  function recordToolResult(rawRequest) {
    exactObject(rawRequest, ['context', 'runtime_invocation_admission', 'tool_result_record']);
    const context = trustedContext(valueAt(rawRequest, 'context'));
    let runtimeAdmission;
    let record;
    try {
      runtimeAdmission = sanitizeBuilderToolRuntimeInvocationAdmission(
        valueAt(rawRequest, 'runtime_invocation_admission'),
      );
      record = sanitizeBuilderToolResultRecord(valueAt(rawRequest, 'tool_result_record'));
      assertToolRecordContext(context, record);
      if (
        record.runtime_invocation_digest !== runtimeAdmission.admission_digest
        || JSON.stringify(record.runtime_invocation_admission) !== JSON.stringify(runtimeAdmission)
        || runtimeAdmission.project_id !== context.project.project_id
        || runtimeAdmission.conversation_id !== context.conversation.conversation_id
        || runtimeAdmission.turn_id !== context.ids.turn_id
        || runtimeAdmission.task_id !== context.ids.task_id
        || runtimeAdmission.run_id !== context.ids.run_id
        || runtimeAdmission.tool_call_id !== record.tool_call_id
        || runtimeAdmission.record_digest !== record.tool_call_record.record_digest
        || runtimeAdmission.policy_digest !== record.tool_call_record.session_policy.policy_digest
      ) fail();
    } catch {
      fail();
    }
    const recordedAtMs = safeTimestamp(Reflect.apply(options.nowMs, undefined, []));
    if (record.observed_at_ms > recordedAtMs) fail();
    admitToolResultState(context, record, record.observed_at_ms);
    const recorded = eventAt({
      projectId: context.project.project_id,
      conversationId: context.conversation.conversation_id,
      sequence: context.start_head.sequence + 1,
      commandId: newId(options.createUuid, 'builder-command'),
      eventType: 'tool_call_result_recorded',
      previous: context.start_head,
      payload: {
        tool_result_record: record,
      },
    });
    const appended = append({
      project: context.project,
      conversation: context.conversation,
      expectedHead: context.start_head,
      events: [recorded],
      recordedAtMs,
    });
    const updatedContext = freezeDeep({
      ...context,
      start_head: { ...appended.head },
      events: appended.events,
    });
    TRUSTED_CONTEXTS.add(updatedContext);
    return updatedContext;
  }

  function admitToolDispatch(rawRequest) {
    exactObject(rawRequest, ['context', 'tool_call_id']);
    const context = trustedContext(valueAt(rawRequest, 'context'));
    const toolCallId = safePattern(valueAt(rawRequest, 'tool_call_id'), TOOL_CALL_ID_PATTERN);
    const run = activeRunFromContext(context);
    const toolCall = run.tool_calls.find((item) => item.tool_call_id === toolCallId) ?? null;
    if (toolCall === null || toolCall.tool_result_record !== null) fail();
    const admittedAtMs = safeTimestamp(Reflect.apply(options.nowMs, undefined, []));
    try {
      return createBuilderToolDispatchAdmission({
        project_id: context.project.project_id,
        conversation_id: context.conversation.conversation_id,
        turn_id: context.ids.turn_id,
        task_id: context.ids.task_id,
        run_id: context.ids.run_id,
        run_status: run.status,
        interrupt_requested: run.interrupt_request_id !== null,
        cancel_requested: run.cancel_request_id !== null,
        existing_tool_calls: compactToolSessionCalls(run.tool_calls),
        tool_call_record: toolCall.tool_call_record,
        dispatch_request_id: newId(options.createUuid, 'builder-tool-dispatch-request'),
        admitted_at_ms: admittedAtMs,
      });
    } catch {
      fail();
    }
  }

  function selectToolAdapter(rawRequest) {
    exactObject(rawRequest, ['context', 'tool_call_id', 'adapter_id']);
    const context = trustedContext(valueAt(rawRequest, 'context'));
    const toolCallId = safePattern(valueAt(rawRequest, 'tool_call_id'), TOOL_CALL_ID_PATTERN);
    const adapterId = valueAt(rawRequest, 'adapter_id');
    if (adapterId !== FILESYSTEM_READ_TOOL_ADAPTER_ID) fail();
    const run = activeRunFromContext(context);
    const toolCall = run.tool_calls.find((item) => item.tool_call_id === toolCallId) ?? null;
    if (toolCall === null || toolCall.tool_result_record !== null) fail();
    let dispatchAdmission;
    try {
      dispatchAdmission = createBuilderToolDispatchAdmission({
        project_id: context.project.project_id,
        conversation_id: context.conversation.conversation_id,
        turn_id: context.ids.turn_id,
        task_id: context.ids.task_id,
        run_id: context.ids.run_id,
        run_status: run.status,
        interrupt_requested: run.interrupt_request_id !== null,
        cancel_requested: run.cancel_request_id !== null,
        existing_tool_calls: compactToolSessionCalls(run.tool_calls),
        tool_call_record: toolCall.tool_call_record,
        dispatch_request_id: newId(options.createUuid, 'builder-tool-dispatch-request'),
        admitted_at_ms: safeTimestamp(Reflect.apply(options.nowMs, undefined, [])),
      });
      return createBuilderToolAdapterSelectionAdmission({
        dispatch_admission: dispatchAdmission,
        tool_call_record: toolCall.tool_call_record,
        adapter_id: adapterId,
        adapter_selection_id: newId(options.createUuid, 'builder-tool-adapter-selection'),
        selected_at_ms: safeTimestamp(Reflect.apply(options.nowMs, undefined, [])),
      });
    } catch {
      fail();
    }
  }

  function admitToolRuntimeInvocation(rawRequest) {
    exactObject(rawRequest, ['context', 'tool_call_id', 'adapter_selection_admission', 'runtime_id']);
    const context = trustedContext(valueAt(rawRequest, 'context'));
    const toolCallId = safePattern(valueAt(rawRequest, 'tool_call_id'), TOOL_CALL_ID_PATTERN);
    const runtimeId = valueAt(rawRequest, 'runtime_id');
    if (runtimeId !== FILESYSTEM_READ_TOOL_RUNTIME_ID) fail();
    const run = activeRunFromContext(context);
    const toolCall = run.tool_calls.find((item) => item.tool_call_id === toolCallId) ?? null;
    if (toolCall === null || toolCall.tool_result_record !== null) fail();
    try {
      const selectionAdmission = sanitizeBuilderToolAdapterSelectionAdmission(
        valueAt(rawRequest, 'adapter_selection_admission'),
      );
      if (
        selectionAdmission.project_id !== context.project.project_id
        || selectionAdmission.conversation_id !== context.conversation.conversation_id
        || selectionAdmission.turn_id !== context.ids.turn_id
        || selectionAdmission.task_id !== context.ids.task_id
        || selectionAdmission.run_id !== context.ids.run_id
        || selectionAdmission.tool_call_id !== toolCallId
        || selectionAdmission.step_id !== toolCall.tool_call_record.step_id
        || selectionAdmission.record_digest !== toolCall.tool_call_record.record_digest
        || selectionAdmission.policy_digest !== toolCall.tool_call_record.session_policy.policy_digest
        || selectionAdmission.adapter_id !== FILESYSTEM_READ_TOOL_ADAPTER_ID
      ) fail();
      return createBuilderToolRuntimeInvocationAdmission({
        adapter_selection_admission: selectionAdmission,
        tool_call_record: toolCall.tool_call_record,
        runtime_id: runtimeId,
        runtime_invocation_id: newId(options.createUuid, 'builder-tool-runtime-invocation'),
        runtime_admitted_at_ms: safeTimestamp(Reflect.apply(options.nowMs, undefined, [])),
      });
    } catch {
      fail();
    }
  }

  function completeExplanation(rawRequest) {
    exactObject(rawRequest, ['context', 'assistant_text']);
    const context = trustedContext(valueAt(rawRequest, 'context'));
    if (context.mode !== 'question' || context.ids.task_id !== null) fail();
    const assistantText = safeText(valueAt(rawRequest, 'assistant_text'), 8_000, 32_000);
    const recordedAtMs = safeTimestamp(Reflect.apply(options.nowMs, undefined, []));
    const resultDigest = sha256Canonical({
      explanation_version: BUILDER_CONVERSATION_MAIN_SERVICE_VERSION,
      request_digest: context.request_digest,
      run_id: context.ids.run_id,
      assistant_text: assistantText,
    });
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
        result_kind: 'explanation',
        result_digest: resultDigest,
        assistant_message: {
          message_id: context.ids.assistant_message_id,
          text: assistantText,
        },
        candidate_result: null,
        plan_admission: null,
      },
    });
    const terminalEvents = [first];
    let previous = eventHead(first);
    let nextSequence = first.sequence + 1;
    if (shouldRecordTaskBrief(context)) {
      const briefUpdated = eventAt({
        projectId: context.project.project_id,
        conversationId: context.conversation.conversation_id,
        sequence: nextSequence,
        commandId: taskBriefCommandIdForMessage(context.ids.message_id),
        eventType: 'task_brief_updated',
        previous,
        payload: {
          turn_id: context.ids.turn_id,
          run_id: context.ids.run_id,
          message_id: context.ids.message_id,
          task_capsule: taskBriefCapsule(context, assistantText, recordedAtMs),
        },
      });
      terminalEvents.push(briefUpdated);
      previous = eventHead(briefUpdated);
      nextSequence += 1;
    }
    const second = eventAt({
      projectId: context.project.project_id,
      conversationId: context.conversation.conversation_id,
      sequence: nextSequence,
      commandId: context.ids.turn_terminal_command_id,
      eventType: 'turn_completed',
      previous,
      payload: {
        turn_id: context.ids.turn_id,
        run_id: context.ids.run_id,
        outcome: 'answered',
      },
    });
    terminalEvents.push(second);
    return append({
      project: context.project,
      conversation: context.conversation,
      expectedHead: context.start_head,
      events: terminalEvents,
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

  function recordSteering(rawRequest) {
    const request = sanitizeActiveRunMessageRequest(rawRequest);
    const context = request.context;
    if (context.run_terminal_failure_code !== null || context.cancel_requested) fail();
    const recordedAtMs = safeTimestamp(Reflect.apply(options.nowMs, undefined, []));
    const steered = eventAt({
      projectId: context.project.project_id,
      conversationId: context.conversation.conversation_id,
      sequence: context.start_head.sequence + 1,
      commandId: newId(options.createUuid, 'builder-command'),
      eventType: 'turn_steered',
      previous: context.start_head,
      payload: {
        turn_id: context.ids.turn_id,
        run_id: context.ids.run_id,
        message: {
          message_id: newId(options.createUuid, 'builder-message'),
          text: request.message,
        },
      },
    });
    const appended = append({
      project: context.project,
      conversation: context.conversation,
      expectedHead: context.start_head,
      events: [steered],
      recordedAtMs,
    });
    const steeredContext = freezeDeep({
      ...context,
      start_head: { ...appended.head },
      events: appended.events,
    });
    TRUSTED_CONTEXTS.add(steeredContext);
    return steeredContext;
  }

  function recordQueuedFollowup(rawRequest) {
    const request = sanitizeActiveRunMessageRequest(rawRequest);
    const context = request.context;
    if (context.run_terminal_failure_code !== null || context.cancel_requested) fail();
    const recordedAtMs = safeTimestamp(Reflect.apply(options.nowMs, undefined, []));
    const queued = eventAt({
      projectId: context.project.project_id,
      conversationId: context.conversation.conversation_id,
      sequence: context.start_head.sequence + 1,
      commandId: newId(options.createUuid, 'builder-command'),
      eventType: 'turn_followup_queued',
      previous: context.start_head,
      payload: {
        turn_id: context.ids.turn_id,
        run_id: context.ids.run_id,
        message: {
          message_id: newId(options.createUuid, 'builder-message'),
          text: request.message,
        },
      },
    });
    const appended = append({
      project: context.project,
      conversation: context.conversation,
      expectedHead: context.start_head,
      events: [queued],
      recordedAtMs,
    });
    const queuedContext = freezeDeep({
      ...context,
      start_head: { ...appended.head },
      events: appended.events,
    });
    TRUSTED_CONTEXTS.add(queuedContext);
    return queuedContext;
  }

  function completeFailure(rawRequest) {
    exactObject(rawRequest, ['context', 'failure_code']);
    const context = trustedContext(valueAt(rawRequest, 'context'));
    const failureCode = safeText(valueAt(rawRequest, 'failure_code'), 80, 160);
    const recordedAtMs = safeTimestamp(Reflect.apply(options.nowMs, undefined, []));
    const failed = failureEvents(context, failureCode, true);
    return append({
      project: context.project,
      conversation: context.conversation,
      expectedHead: context.start_head,
      events: failed.events,
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
    const latestSnapshot = replayBuilderConversation(state.events);
    const latestTurn = latestSnapshot.turns.find((item) => item.turn_id === turnId);
    const latestRun = latestTurn?.runs.find((item) => item.run_id === runId);
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
      || !latestTurn
      || !latestRun
      || latestRun.candidate_review !== null
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

  function readCandidateDraft(rawRequest) {
    exactObject(rawRequest, ['draft_id']);
    const draftId = safePattern(valueAt(rawRequest, 'draft_id'), DRAFT_ID_PATTERN);
    const state = loadCandidateConversation(draftId);
    if (state === null) fail();
    let match = null;
    for (const turn of state.snapshot.turns) {
      if (turn.mode !== 'work' || turn.task === null) continue;
      for (const run of turn.runs) {
        if (run.candidate_result?.draft_id !== draftId) continue;
        if (match !== null) fail();
        match = { turn, run };
      }
    }
    if (match === null) fail();
    const { turn, run } = match;
    const candidateResult = run.candidate_result;
    const receipt = candidateResult.git_candidate_receipt;
    if (
      turn.status !== 'completed'
      || turn.outcome !== 'candidate_ready'
      || run.status !== 'completed'
      || run.terminal_status !== 'succeeded'
      || run.result_kind !== 'candidate'
      || run.candidate_review !== null
      || run.result_digest !== receipt.candidate_digest
      || receipt.project_id !== state.conversation.project_id
      || receipt.conversation_id !== state.conversation.conversation_id
      || receipt.turn_id !== turn.turn_id
      || receipt.task_id !== turn.task.task_id
      || receipt.run_id !== run.run_id
    ) fail();
    const completed = state.events.find((event) => (
      event.event_type === 'run_completed'
      && event.payload.turn_id === turn.turn_id
      && event.payload.run_id === run.run_id
      && event.payload.candidate_result?.draft_id === draftId
    ));
    const turnCompleted = completed === undefined
      ? null
      : state.events[completed.sequence];
    if (
      !completed
      || !turnCompleted
      || turnCompleted.event_type !== 'turn_completed'
      || turnCompleted.payload.turn_id !== turn.turn_id
      || turnCompleted.payload.run_id !== run.run_id
      || turnCompleted.payload.outcome !== 'candidate_ready'
    ) fail();
    return freezeDeep({
      result_version: 'builder-conversation-candidate-draft-read-result.v1',
      draft_id: draftId,
      project_id: state.conversation.project_id,
      conversation_id: state.conversation.conversation_id,
      turn_id: turn.turn_id,
      task_id: turn.task.task_id,
      run_id: run.run_id,
      candidate_digest: receipt.candidate_digest,
      base_revision: turn.base_revision === null ? null : { ...turn.base_revision },
      conversation_head: eventHead(turnCompleted),
      candidate_result: {
        draft_id: candidateResult.draft_id,
        title: candidateResult.title,
        summary: candidateResult.summary,
        git_candidate_receipt: { ...receipt },
      },
      verification_admission: 'sqlite_replay_verified',
    });
  }

  function rejectCandidate(rawRequest) {
    try {
      exactObject(rawRequest, ['draft_id']);
      const draftId = safePattern(valueAt(rawRequest, 'draft_id'), DRAFT_ID_PATTERN);
      const draft = readCandidateDraft({ draft_id: draftId });
      const state = load(draft.project_id, draft.conversation_id);
      if (state === null || !sameHead(state.head, draft.conversation_head)) fail();
      const recordedAtMs = safeTimestamp(Reflect.apply(options.nowMs, undefined, []));
      const project = freezeDeep({
        project_id: draft.project_id,
        created_at_ms: projectCreatedAt(
          draft.project_id,
          draft.base_revision,
          recordedAtMs,
          state,
        ),
      });
      const rejected = eventAt({
        projectId: draft.project_id,
        conversationId: draft.conversation_id,
        sequence: state.head.sequence + 1,
        commandId: newId(options.createUuid, 'builder-command'),
        eventType: 'candidate_rejected',
        previous: state.head,
        payload: {
          turn_id: draft.turn_id,
          run_id: draft.run_id,
          draft_id: draftId,
          review_id: newId(options.createUuid, 'builder-review'),
          reviewer_id: newId(options.createUuid, 'builder-user'),
          reviewed_at_ms: recordedAtMs,
          decision: 'rejected',
        },
      });
      append({
        project,
        conversation: state.conversation,
        expectedHead: state.head,
        events: [rejected],
        recordedAtMs,
      });
      return freezeDeep({
        result_version: 'builder-conversation-candidate-reject-result.v1',
        draft_id: draftId,
        project_id: draft.project_id,
        conversation_id: draft.conversation_id,
        rejection_admission: 'sqlite_recorded',
      });
    } catch {
      fail();
    }
  }

  function acceptCandidate(rawRequest) {
    try {
      const request = sanitizeAcceptCandidateRequest(rawRequest);
      const draft = readCandidateDraft({ draft_id: request.draft_id });
      const state = load(draft.project_id, draft.conversation_id);
      if (state === null || !sameHead(state.head, draft.conversation_head)) fail();
      const recordedAtMs = safeTimestamp(Reflect.apply(options.nowMs, undefined, []));
      const project = freezeDeep({
        project_id: draft.project_id,
        created_at_ms: projectCreatedAt(
          draft.project_id,
          draft.base_revision,
          recordedAtMs,
          state,
        ),
      });
      const accepted = eventAt({
        projectId: draft.project_id,
        conversationId: draft.conversation_id,
        sequence: state.head.sequence + 1,
        commandId: newId(options.createUuid, 'builder-command'),
        eventType: 'candidate_accepted',
        previous: state.head,
        payload: {
          turn_id: draft.turn_id,
          run_id: draft.run_id,
          draft_id: request.draft_id,
          review_id: request.review_id,
          reviewer_id: request.reviewer_id,
          reviewed_at_ms: request.reviewed_at_ms,
          decision: 'accepted',
          revision: { ...request.revision },
        },
      });
      append({
        project,
        conversation: state.conversation,
        expectedHead: state.head,
        events: [accepted],
        recordedAtMs,
      });
      return freezeDeep({
        result_version: 'builder-conversation-candidate-accept-result.v1',
        draft_id: request.draft_id,
        project_id: draft.project_id,
        conversation_id: draft.conversation_id,
        acceptance_admission: 'sqlite_recorded',
      });
    } catch {
      fail();
    }
  }

  function readApprovedPlan(rawRequest) {
    try {
      const request = sanitizePlanRunReference(rawRequest);
      const state = load(request.project_id, request.conversation_id);
      if (state === null || state.snapshot.active_turn_id !== null) fail();
      const reviewEvent = state.events.at(-1) ?? null;
      const reviewPayload = reviewEvent?.payload ?? null;
      const turn = state.snapshot.turns.find((item) => item.turn_id === request.turn_id) ?? null;
      const run = turn?.runs.find((item) => item.run_id === request.run_id) ?? null;
      if (
        reviewEvent === null
        || reviewEvent.event_type !== 'plan_reviewed'
        || reviewPayload === null
        || valueAt(reviewPayload, 'turn_id') !== request.turn_id
        || valueAt(reviewPayload, 'run_id') !== request.run_id
        || valueAt(reviewPayload, 'decision') !== 'approved'
        || turn === null
        || turn.status !== 'completed'
        || turn.outcome !== 'plan_proposed'
        || turn.mode !== 'work'
        || turn.task === null
        || run === null
        || run.status !== 'completed'
        || run.terminal_status !== 'succeeded'
        || run.result_kind !== 'plan'
        || run.result_digest === null
        || run.plan_review === null
        || run.plan_review.decision !== 'approved'
        || run.plan_review.plan_result_digest !== run.result_digest
        || valueAt(reviewPayload, 'plan_result_digest') !== run.result_digest
      ) fail();
      const publicPlanMessages = turn.messages.filter((message) => (
        message.role === 'assistant'
        && message.kind === 'run_result'
      ));
      if (publicPlanMessages.length !== 1) fail();
      return freezeDeep({
        result_version: APPROVED_PLAN_READ_RESULT_VERSION,
        project_id: request.project_id,
        conversation_id: request.conversation_id,
        turn_id: request.turn_id,
        task_id: turn.task.task_id,
        run_id: request.run_id,
        decision: 'approved',
        plan_result_digest: run.result_digest,
        approved_plan_public_text: safeText(publicPlanMessages[0].text, 4_000, 16_000),
        conversation_head: { ...state.head },
        authority: {
          conversation: 'sqlite_replay_current_head_verified',
          plan_review: 'approved_current_head',
          renderer_authority: 'not_present',
          provider_dispatch: false,
          tool_dispatch: 'not_performed',
          source_mutation: 'not_performed',
          git_authority: 'not_present',
          revision_admission: 'not_created',
        },
      });
    } catch {
      fail();
    }
  }

  function approvedPlanAdmissionInput(approvedPlan) {
    return freezeDeep({
      result_version: approvedPlan.result_version,
      project_id: approvedPlan.project_id,
      conversation_id: approvedPlan.conversation_id,
      turn_id: approvedPlan.turn_id,
      task_id: approvedPlan.task_id,
      run_id: approvedPlan.run_id,
      decision: approvedPlan.decision,
      plan_result_digest: approvedPlan.plan_result_digest,
      conversation_head: { ...approvedPlan.conversation_head },
      authority: { ...approvedPlan.authority },
    });
  }

  function admitApprovedPlanContinuation(rawRequest) {
    try {
      const request = sanitizePlanRunReference(rawRequest);
      const approvedPlan = readApprovedPlan(request);
      return createBuilderApprovedPlanContinuationAdmission({
        approved_plan: approvedPlanAdmissionInput(approvedPlan),
        continuation_id: newId(options.createUuid, 'builder-approved-plan-continuation'),
        admitted_at_ms: safeTimestamp(Reflect.apply(options.nowMs, undefined, [])),
      });
    } catch {
      fail();
    }
  }

  function reviewPlan(rawRequest) {
    try {
      exactObject(rawRequest, ['project_id', 'conversation_id', 'turn_id', 'run_id', 'decision']);
      const projectId = safeProjectId(valueAt(rawRequest, 'project_id'));
      const conversationId = safePattern(valueAt(rawRequest, 'conversation_id'), CONVERSATION_ID_PATTERN);
      if (conversationId !== `builder-conversation:${projectUuid(projectId)}`) fail();
      const turnId = safePattern(valueAt(rawRequest, 'turn_id'), TURN_ID_PATTERN);
      const runId = safePattern(valueAt(rawRequest, 'run_id'), RUN_ID_PATTERN);
      const decision = valueAt(rawRequest, 'decision');
      if (decision !== 'approved' && decision !== 'rejected') fail();
      const state = load(projectId, conversationId);
      if (state === null || state.snapshot.active_turn_id !== null) fail();
      const turn = state.snapshot.turns.find((item) => item.turn_id === turnId) ?? null;
      const run = turn?.runs.find((item) => item.run_id === runId) ?? null;
      if (
        turn === null
        || turn.status !== 'completed'
        || turn.outcome !== 'plan_proposed'
        || turn.mode !== 'work'
        || turn.task === null
        || run === null
        || run.status !== 'completed'
        || run.terminal_status !== 'succeeded'
        || run.result_kind !== 'plan'
        || run.result_digest === null
        || run.plan_review !== null
      ) fail();
      const recordedAtMs = safeTimestamp(Reflect.apply(options.nowMs, undefined, []));
      const project = freezeDeep({
        project_id: projectId,
        created_at_ms: projectCreatedAt(projectId, turn.base_revision, recordedAtMs, state),
      });
      const reviewed = eventAt({
        projectId,
        conversationId,
        sequence: state.head.sequence + 1,
        commandId: newId(options.createUuid, 'builder-command'),
        eventType: 'plan_reviewed',
        previous: state.head,
        payload: {
          turn_id: turnId,
          run_id: runId,
          plan_result_digest: run.result_digest,
          review_id: newId(options.createUuid, 'builder-review'),
          reviewer_id: newId(options.createUuid, 'builder-user'),
          reviewed_at_ms: recordedAtMs,
          decision,
        },
      });
      append({
        project,
        conversation: state.conversation,
        expectedHead: state.head,
        events: [reviewed],
        recordedAtMs,
      });
      return freezeDeep({
        result_version: 'builder-conversation-plan-review-result.v1',
        project_id: projectId,
        conversation_id: conversationId,
        turn_id: turnId,
        run_id: runId,
        decision,
        review_admission: 'sqlite_recorded_no_execution',
      });
    } catch {
      fail();
    }
  }

  function readStream(rawRequest) {
    try {
      exactObject(rawRequest, ['project_id']);
      const projectId = safeProjectId(valueAt(rawRequest, 'project_id'));
      const conversationId = `builder-conversation:${projectUuid(projectId)}`;
      const state = load(projectId, conversationId);
      return projectBuilderTaskStream({
        project_id: projectId,
        conversation: state === null ? null : {
          conversation_id: state.conversation.conversation_id,
          created_at_ms: state.conversation.created_at_ms,
          events: state.events,
        },
      });
    } catch {
      throw new BuilderTaskStreamProjectionError();
    }
  }

  return Object.freeze({
    service_version: BUILDER_CONVERSATION_MAIN_SERVICE_VERSION,
    begin_question: beginQuestion,
    begin_work: beginWork,
    begin_queued_followup_question: beginQueuedFollowupQuestion,
    begin_queued_followup_work: beginQueuedFollowupWork,
    record_retryable_failure: recordRetryableFailure,
    record_run_context_snapshot: recordRunContextSnapshot,
    record_run_progress: recordRunProgress,
    record_agent_step_progress: recordAgentStepProgress,
    retry_after_failure: retryAfterFailure,
    begin_approved_plan_work: beginApprovedPlanWork,
    begin_draft_continuation_work: beginDraftContinuationWork,
    complete_candidate: completeCandidate,
    complete_explanation: completeExplanation,
    complete_plan: completePlan,
    complete_failure: completeFailure,
    record_tool_call_request: recordToolCallRequest,
    record_tool_result: recordToolResult,
    admit_tool_dispatch: admitToolDispatch,
    select_tool_adapter: selectToolAdapter,
    admit_tool_runtime_invocation: admitToolRuntimeInvocation,
    record_steering: recordSteering,
    record_queued_followup: recordQueuedFollowup,
    request_cancel: requestCancel,
    verify_candidate: verifyCandidate,
    read_candidate_draft: readCandidateDraft,
    accept_candidate: acceptCandidate,
    reject_candidate: rejectCandidate,
    read_approved_plan: readApprovedPlan,
    admit_approved_plan_continuation: admitApprovedPlanContinuation,
    review_plan: reviewPlan,
    read_stream: readStream,
    authority: Object.freeze({
      storage: 'sqlite_conversation_event_chain',
      provider_dispatch: false,
      renderer_exposure: false,
      restart_running_recovery: 'interrupted_without_provider_redispatch',
      candidate_draft_restore: 'sqlite_index_replay_verified',
      question_explanation: 'sqlite_event_chain_without_git_revision',
      run_context_snapshot_recording: 'main_only_digest_bound_event',
      run_progress_recording: 'main_only_fixed_stage_event',
      agent_step_progress_recording: 'main_only_admitted_progress_event',
      run_steering_recording: 'main_only_active_run_message_no_provider_mutation',
      run_followup_queue_recording: 'main_only_active_run_message_no_provider_mutation',
      run_followup_consumption_start: 'main_only_replay_verified_followup_starts_normal_turn',
      tool_call_recording: 'main_only_pre_dispatch_event',
      tool_result_recording: 'main_only_fixed_code_event',
      tool_dispatch_admission: 'main_only_open_call_no_dispatch',
      tool_adapter_selection: 'main_only_static_adapter_no_dispatch',
      tool_runtime_invocation: 'main_only_runtime_envelope_no_execution',
      plan_proposal_recording: 'main_only_digest_terminal_event',
      plan_review_recording: 'main_only_review_fact_no_execution',
      approved_plan_read: 'main_only_current_head_approval_gate',
      approved_plan_continuation_admission: 'main_only_fresh_approved_plan_no_execution',
      approved_plan_work_start: 'main_only_current_head_approved_plan_starts_new_work_run',
      draft_continuation_work_start: 'main_only_pending_draft_current_head_starts_new_work_run',
      task_stream_change_notification: 'project_id_only_after_append',
    }),
  });
}

module.exports = Object.freeze({
  APPROVED_PLAN_READ_RESULT_VERSION,
  BUILDER_CONVERSATION_MAIN_SERVICE_VERSION,
  TASK_STREAM_CHANGED_EVENT_VERSION,
  BuilderConversationMainServiceError,
  createBuilderConversationMainService,
});
