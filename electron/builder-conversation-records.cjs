'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

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
  isPublicBuilderRouteDecisionSignal,
} = require('./builder-route-decision-signals.cjs');
const {
  sanitizeBuilderRunContextSnapshot,
} = require('./builder-run-context-snapshot.cjs');
const {
  sanitizeBuilderAgentStepProgressConversationAdmission,
} = require('./builder-agent-step-progress-conversation-admission.cjs');

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
  route_decision: /^builder-route-decision:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
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
const REVISION_REFERENCE_KEYS = Object.freeze(['revision_receipt_digest', 'revision_number']);
const WORKING_BRIEF_VERSION = 'builder-working-brief.v1';
const WORKING_BRIEF_KEYS = Object.freeze([
  'brief_version', 'source', 'latest_user_goal', 'assistant_proposal',
  'approved_plan', 'use_when_instruction_is_contextual',
]);
const WORKING_BRIEF_SOURCES = Object.freeze(['task_capsule_update']);
const TASK_CAPSULE_VERSION = 'builder-task-capsule.v1';
const TASK_CAPSULE_KEYS = Object.freeze([
  'capsule_version', 'task_id', 'project_id', 'title', 'goal', 'status',
  'current_brief', 'last_route_decision_id', 'updated_at_ms',
]);
const TASK_CAPSULE_STATUSES = Object.freeze(['discussing', 'ready']);
const ROUTE_DECISION_VERSION = 'builder-composer-route-decision.v1';
const ROUTE_DECISION_KEYS = Object.freeze([
  'decision_id', 'decision_version', 'project_id', 'message_id', 'task_id',
  'route', 'confidence', 'matched_signals', 'downgraded_from',
  'downgrade_reason', 'required_permissions', 'permission_result', 'dispatch',
  'decided_at_ms',
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
const CANDIDATE_RESULT_KEYS = Object.freeze([
  'draft_id', 'title', 'summary', 'git_candidate_receipt',
]);
const PLAN_ADMISSION_INPUT_KEYS = Object.freeze([
  'admission_version', 'admission_kind', 'admission_authority',
  'project_id', 'conversation_id', 'turn_id', 'task_id', 'run_id', 'attempt_number',
  'plan_record_digest', 'source_context_result_version', 'collector_authority',
  'context_digest', 'context_status', 'file_count', 'total_content_bytes',
  'head_sequence', 'head_digest', 'tool_reads',
]);
const PLAN_ADMISSION_KEYS = Object.freeze([...PLAN_ADMISSION_INPUT_KEYS, 'admission_digest']);
const PLAN_TOOL_READ_KEYS = Object.freeze([
  'resource_id', 'tool_call_id', 'tool_call_record_digest',
  'tool_result_record_digest', 'result_summary_digest', 'result_status',
]);
const PLAN_REVIEW_KEYS = Object.freeze([
  'turn_id', 'run_id', 'plan_result_digest', 'review_id',
  'reviewer_id', 'reviewed_at_ms', 'decision',
]);
const PAYLOAD_KEYS = Object.freeze({
  turn_submitted: Object.freeze([
    'message', 'turn_id', 'mode', 'task', 'base_revision', 'route_decision',
  ]),
  turn_steered: Object.freeze(['turn_id', 'run_id', 'message']),
  task_brief_updated: Object.freeze(['turn_id', 'run_id', 'message_id', 'task_capsule']),
  run_context_snapshot_recorded: Object.freeze(['turn_id', 'run_id', 'snapshot']),
  candidate_rejected: Object.freeze([
    'turn_id', 'run_id', 'draft_id', 'review_id', 'reviewer_id', 'reviewed_at_ms', 'decision',
  ]),
  candidate_accepted: Object.freeze([
    'turn_id', 'run_id', 'draft_id', 'review_id', 'reviewer_id', 'reviewed_at_ms',
    'decision', 'revision',
  ]),
  plan_reviewed: PLAN_REVIEW_KEYS,
  run_started: Object.freeze([
    'turn_id', 'run_id', 'task_id', 'attempt_number', 'retry_of_run_id', 'input_digest',
  ]),
  run_progress_recorded: Object.freeze(['turn_id', 'run_id', 'stage']),
  run_interrupt_requested: Object.freeze(['turn_id', 'run_id', 'request_id']),
  run_cancel_requested: Object.freeze(['turn_id', 'run_id', 'request_id']),
  tool_call_requested: Object.freeze(['tool_call_record']),
  tool_call_result_recorded: Object.freeze(['tool_result_record']),
  agent_step_progress_recorded: Object.freeze(['progress_admission']),
  run_completed: Object.freeze([
    'turn_id', 'run_id', 'terminal_status', 'result_kind', 'result_digest',
    'assistant_message', 'candidate_result', 'plan_admission',
  ]),
  turn_completed: Object.freeze(['turn_id', 'run_id', 'outcome']),
});
const EVENT_TYPES = Object.freeze(Object.keys(PAYLOAD_KEYS));
const EVENT_TYPE_SET = new Set(EVENT_TYPES);
const RUN_PROGRESS_STAGES = Object.freeze([
  'context_ready',
  'provider_request_started',
  'provider_response_received',
  'result_preparing',
]);
const PLAN_ADMISSION_VERSION = 'builder-conversation-plan-admission.v1';
const PLAN_ADMISSION_KIND = 'builder_conversation_plan_admission';
const PLAN_ADMISSION_AUTHORITY = 'trusted_conversation_main_service_complete_plan_v1';
const SOURCE_CONTEXT_RESULT_VERSION = 'builder-tool-source-context-result.v1';
const SOURCE_CONTEXT_COLLECTOR_AUTHORITY = 'main_tool_source_context_collector_v1';
const PLAN_RESOURCE_ID_PATTERN = /^project:\/[a-z0-9._/@-]{1,120}$/u;
const MAX_PLAN_CONTEXT_FILES = 8;
const MAX_PLAN_CONTEXT_TOTAL_BYTES = MAX_PLAN_CONTEXT_FILES * 16 * 1024;

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
function safeRouteDecisionId(value) { return safePattern(value, ID_PATTERNS.route_decision, 96); }
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

function safeRevisionNumber(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 1_024) fail();
  return value;
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail();
  return value;
}

function safePlanFileCount(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_PLAN_CONTEXT_FILES) fail();
  return value;
}

function safePlanByteCount(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_PLAN_CONTEXT_TOTAL_BYTES) fail();
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

function safeEnum(value, options) {
  if (typeof value !== 'string' || !options.includes(value)) fail();
  return value;
}

function sanitizeRouteDecisionSignals(value) {
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
  return signals;
}

function sanitizeRouteDecisionPermissions(value) {
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
  return permissions;
}

function sanitizeNullableRoute(value) {
  return value === null ? null : safeEnum(value, ROUTE_DECISION_ROUTES);
}

function sanitizeNullableDowngradeReason(value) {
  return value === null ? null : safeEnum(value, ROUTE_DECISION_DOWNGRADE_REASONS);
}

function sanitizeRouteDecision(value, projectId, messageId, taskId, mode) {
  assertExactObject(value, ROUTE_DECISION_KEYS);
  const project = safeProjectId(valueAt(value, 'project_id'));
  const message = safeMessageId(valueAt(value, 'message_id'));
  const task = nullable(valueAt(value, 'task_id'), safeTaskId);
  const route = safeEnum(valueAt(value, 'route'), ROUTE_DECISION_ROUTES);
  const requiredPermissions = sanitizeRouteDecisionPermissions(valueAt(value, 'required_permissions'));
  const permissionResult = safeEnum(valueAt(value, 'permission_result'), ROUTE_DECISION_PERMISSION_RESULTS);
  const dispatch = safeEnum(valueAt(value, 'dispatch'), ROUTE_DECISION_DISPATCHES);
  const downgradedFrom = sanitizeNullableRoute(valueAt(value, 'downgraded_from'));
  const downgradeReason = sanitizeNullableDowngradeReason(valueAt(value, 'downgrade_reason'));
  if (project !== projectId || message !== messageId || task !== taskId) fail();
  if ((downgradedFrom === null) !== (downgradeReason === null)) fail();
  if (downgradedFrom !== null && downgradedFrom === route) fail();
  if ((requiredPermissions.length === 0) !== (permissionResult === 'not_required')) fail();
  if (requiredPermissions.includes('write_project') !== (route === 'build')) fail();
  if (requiredPermissions.includes('project_read') && route !== 'plan') fail();
  if (mode === 'question' && (task !== null || ['build', 'plan'].includes(route))) fail();
  if (mode === 'work' && (task === null || !['build', 'plan'].includes(route))) fail();
  if (route === 'build' && !['build', 'ask_workspace', 'ask_permission', 'blocked'].includes(dispatch)) fail();
  if (route === 'plan' && !['plan', 'ask_permission', 'blocked'].includes(dispatch)) fail();
  if (route === 'update_brief' && !['reply', 'brief_update'].includes(dispatch)) fail();
  if ((route === 'answer' || route === 'clarify') && dispatch !== 'reply') fail();
  return {
    decision_id: safeRouteDecisionId(valueAt(value, 'decision_id')),
    decision_version: valueAt(value, 'decision_version') === ROUTE_DECISION_VERSION
      ? ROUTE_DECISION_VERSION
      : fail(),
    project_id: project,
    message_id: message,
    task_id: task,
    route,
    confidence: safeEnum(valueAt(value, 'confidence'), ROUTE_DECISION_CONFIDENCES),
    matched_signals: sanitizeRouteDecisionSignals(valueAt(value, 'matched_signals')),
    downgraded_from: downgradedFrom,
    downgrade_reason: downgradeReason,
    required_permissions: requiredPermissions,
    permission_result: permissionResult,
    dispatch,
    decided_at_ms: safeTimestamp(valueAt(value, 'decided_at_ms')),
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

function sanitizeRevisionReference(value) {
  assertExactObject(value, REVISION_REFERENCE_KEYS);
  return {
    revision_receipt_digest: safeDigest(valueAt(value, 'revision_receipt_digest')),
    revision_number: safeRevisionNumber(valueAt(value, 'revision_number')),
  };
}

function sanitizeWorkingBrief(value) {
  assertExactObject(value, WORKING_BRIEF_KEYS);
  if (
    valueAt(value, 'brief_version') !== WORKING_BRIEF_VERSION
    || valueAt(value, 'approved_plan') !== null
    || valueAt(value, 'use_when_instruction_is_contextual') !== true
  ) fail();
  return {
    brief_version: WORKING_BRIEF_VERSION,
    source: safeEnum(valueAt(value, 'source'), WORKING_BRIEF_SOURCES),
    latest_user_goal: safeText(valueAt(value, 'latest_user_goal'), 1_024, 4_096, true),
    assistant_proposal: safeText(valueAt(value, 'assistant_proposal'), 2_048, 8_192, true),
    approved_plan: null,
    use_when_instruction_is_contextual: true,
  };
}

function sanitizeTaskCapsule(value, projectId) {
  assertExactObject(value, TASK_CAPSULE_KEYS);
  const project = safeProjectId(valueAt(value, 'project_id'));
  if (project !== projectId || valueAt(value, 'capsule_version') !== TASK_CAPSULE_VERSION) fail();
  return {
    capsule_version: TASK_CAPSULE_VERSION,
    task_id: safeTaskId(valueAt(value, 'task_id')),
    project_id: project,
    title: safeText(valueAt(value, 'title'), 160, 1_024, false),
    goal: safeText(valueAt(value, 'goal'), 1_024, 4_096, true),
    status: safeEnum(valueAt(value, 'status'), TASK_CAPSULE_STATUSES),
    current_brief: sanitizeWorkingBrief(valueAt(value, 'current_brief')),
    last_route_decision_id: safeRouteDecisionId(valueAt(value, 'last_route_decision_id')),
    updated_at_ms: safeTimestamp(valueAt(value, 'updated_at_ms')),
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

function sanitizePlanToolRead(value) {
  assertExactObject(value, PLAN_TOOL_READ_KEYS);
  const resultStatus = valueAt(value, 'result_status');
  if (resultStatus !== 'succeeded') fail();
  return {
    resource_id: safePattern(valueAt(value, 'resource_id'), PLAN_RESOURCE_ID_PATTERN, 132),
    tool_call_id: sanitizePlanToolCallId(valueAt(value, 'tool_call_id')),
    tool_call_record_digest: safeDigest(valueAt(value, 'tool_call_record_digest')),
    tool_result_record_digest: safeDigest(valueAt(value, 'tool_result_record_digest')),
    result_summary_digest: safeDigest(valueAt(value, 'result_summary_digest')),
    result_status: 'succeeded',
  };
}

function sanitizePlanToolCallId(value) {
  return safePattern(value, /^builder-tool-call:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u, 96);
}

function sanitizePlanToolReads(value, expectedFileCount) {
  if (!Array.isArray(value) || utilTypes.isProxy(value) || value.length !== expectedFileCount) fail();
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key === 'symbol') || keys.length !== value.length + 1) fail();
  const seenResources = new Set();
  const seenToolCalls = new Set();
  const reads = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
    const read = sanitizePlanToolRead(descriptor.value);
    const toolCallId = sanitizePlanToolCallId(read.tool_call_id);
    if (seenResources.has(read.resource_id) || seenToolCalls.has(toolCallId)) fail();
    seenResources.add(read.resource_id);
    seenToolCalls.add(toolCallId);
    reads.push({ ...read, tool_call_id: toolCallId });
  }
  return reads;
}

function planAdmissionDigestBody(value) {
  return {
    admission_authority: value.admission_authority,
    admission_kind: value.admission_kind,
    admission_version: value.admission_version,
    attempt_number: value.attempt_number,
    collector_authority: value.collector_authority,
    context_digest: value.context_digest,
    context_status: value.context_status,
    conversation_id: value.conversation_id,
    file_count: value.file_count,
    head_digest: value.head_digest,
    head_sequence: value.head_sequence,
    plan_record_digest: value.plan_record_digest,
    project_id: value.project_id,
    run_id: value.run_id,
    source_context_result_version: value.source_context_result_version,
    task_id: value.task_id,
    tool_reads: value.tool_reads,
    total_content_bytes: value.total_content_bytes,
    turn_id: value.turn_id,
  };
}

function sanitizePlanAdmission(value) {
  assertExactObject(value, PLAN_ADMISSION_KEYS);
  const projectId = safeProjectId(valueAt(value, 'project_id'));
  const conversationId = safeConversationId(valueAt(value, 'conversation_id'));
  const fileCount = safePlanFileCount(valueAt(value, 'file_count'));
  const admission = {
    admission_version: valueAt(value, 'admission_version'),
    admission_kind: valueAt(value, 'admission_kind'),
    admission_authority: valueAt(value, 'admission_authority'),
    project_id: projectId,
    conversation_id: conversationId,
    turn_id: safeTurnId(valueAt(value, 'turn_id')),
    task_id: safeTaskId(valueAt(value, 'task_id')),
    run_id: safeRunId(valueAt(value, 'run_id')),
    attempt_number: safeAttemptNumber(valueAt(value, 'attempt_number')),
    plan_record_digest: safeDigest(valueAt(value, 'plan_record_digest')),
    source_context_result_version: valueAt(value, 'source_context_result_version'),
    collector_authority: valueAt(value, 'collector_authority'),
    context_digest: safeDigest(valueAt(value, 'context_digest')),
    context_status: valueAt(value, 'context_status'),
    file_count: fileCount,
    total_content_bytes: safePlanByteCount(valueAt(value, 'total_content_bytes')),
    head_sequence: safeSequence(valueAt(value, 'head_sequence')),
    head_digest: safeDigest(valueAt(value, 'head_digest')),
    tool_reads: sanitizePlanToolReads(valueAt(value, 'tool_reads'), fileCount),
  };
  if (
    admission.conversation_id !== expectedConversationId(admission.project_id)
    || admission.admission_version !== PLAN_ADMISSION_VERSION
    || admission.admission_kind !== PLAN_ADMISSION_KIND
    || admission.admission_authority !== PLAN_ADMISSION_AUTHORITY
    || admission.source_context_result_version !== SOURCE_CONTEXT_RESULT_VERSION
    || admission.collector_authority !== SOURCE_CONTEXT_COLLECTOR_AUTHORITY
    || admission.context_status !== 'succeeded'
  ) fail();
  const digest = safeDigest(valueAt(value, 'admission_digest'));
  if (digest !== sha256Canonical(planAdmissionDigestBody(admission))) fail();
  return {
    ...admission,
    admission_digest: digest,
  };
}

function createBuilderConversationPlanAdmission(rawInput) {
  assertExactObject(rawInput, PLAN_ADMISSION_INPUT_KEYS);
  const fileCount = safePlanFileCount(valueAt(rawInput, 'file_count'));
  const admission = {
    admission_version: valueAt(rawInput, 'admission_version'),
    admission_kind: valueAt(rawInput, 'admission_kind'),
    admission_authority: valueAt(rawInput, 'admission_authority'),
    project_id: safeProjectId(valueAt(rawInput, 'project_id')),
    conversation_id: safeConversationId(valueAt(rawInput, 'conversation_id')),
    turn_id: safeTurnId(valueAt(rawInput, 'turn_id')),
    task_id: safeTaskId(valueAt(rawInput, 'task_id')),
    run_id: safeRunId(valueAt(rawInput, 'run_id')),
    attempt_number: safeAttemptNumber(valueAt(rawInput, 'attempt_number')),
    plan_record_digest: safeDigest(valueAt(rawInput, 'plan_record_digest')),
    source_context_result_version: valueAt(rawInput, 'source_context_result_version'),
    collector_authority: valueAt(rawInput, 'collector_authority'),
    context_digest: safeDigest(valueAt(rawInput, 'context_digest')),
    context_status: valueAt(rawInput, 'context_status'),
    file_count: fileCount,
    total_content_bytes: safePlanByteCount(valueAt(rawInput, 'total_content_bytes')),
    head_sequence: safeSequence(valueAt(rawInput, 'head_sequence')),
    head_digest: safeDigest(valueAt(rawInput, 'head_digest')),
    tool_reads: sanitizePlanToolReads(valueAt(rawInput, 'tool_reads'), fileCount),
  };
  return sanitizePlanAdmission({
    ...admission,
    admission_digest: sha256Canonical(planAdmissionDigestBody(admission)),
  });
}

function nullable(value, sanitizer) { return value === null ? null : sanitizer(value); }

function sanitizePayload(eventType, value, projectId, conversationId) {
  const expected = PAYLOAD_KEYS[eventType];
  if (!expected) fail();
  assertExactObject(value, expected);
  switch (eventType) {
    case 'turn_submitted': {
      const mode = valueAt(value, 'mode');
      if (mode !== 'question' && mode !== 'work') fail();
      const message = sanitizeMessage(valueAt(value, 'message'));
      const task = sanitizeTask(valueAt(value, 'task'));
      if ((mode === 'work') !== (task !== null)) fail();
      return {
        message,
        turn_id: safeTurnId(valueAt(value, 'turn_id')),
        mode,
        task,
        base_revision: sanitizeBaseRevision(valueAt(value, 'base_revision')),
        route_decision: sanitizeRouteDecision(
          valueAt(value, 'route_decision'),
          projectId,
          message.message_id,
          task?.task_id ?? null,
          mode,
        ),
      };
    }
    case 'turn_steered':
      return {
        turn_id: safeTurnId(valueAt(value, 'turn_id')),
        run_id: nullable(valueAt(value, 'run_id'), safeRunId),
        message: sanitizeMessage(valueAt(value, 'message')),
      };
    case 'task_brief_updated':
      return {
        turn_id: safeTurnId(valueAt(value, 'turn_id')),
        run_id: safeRunId(valueAt(value, 'run_id')),
        message_id: safeMessageId(valueAt(value, 'message_id')),
        task_capsule: sanitizeTaskCapsule(valueAt(value, 'task_capsule'), projectId),
      };
    case 'run_context_snapshot_recorded': {
      const turnId = safeTurnId(valueAt(value, 'turn_id'));
      const runId = safeRunId(valueAt(value, 'run_id'));
      const snapshot = sanitizeBuilderRunContextSnapshot(valueAt(value, 'snapshot'), {
        project_id: projectId,
        conversation_id: conversationId,
        turn_id: turnId,
        run_id: runId,
        task_id: valueAt(valueAt(value, 'snapshot'), 'task_id'),
      });
      return {
        turn_id: turnId,
        run_id: runId,
        snapshot,
      };
    }
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
    case 'candidate_accepted':
      if (valueAt(value, 'decision') !== 'accepted') fail();
      return {
        turn_id: safeTurnId(valueAt(value, 'turn_id')),
        run_id: safeRunId(valueAt(value, 'run_id')),
        draft_id: safePattern(valueAt(value, 'draft_id'), DRAFT_ID_PATTERN, 96),
        review_id: safeReviewId(valueAt(value, 'review_id')),
        reviewer_id: safeActorId(valueAt(value, 'reviewer_id')),
        reviewed_at_ms: safeTimestamp(valueAt(value, 'reviewed_at_ms')),
        decision: 'accepted',
        revision: sanitizeRevisionReference(valueAt(value, 'revision')),
      };
    case 'plan_reviewed': {
      const decision = valueAt(value, 'decision');
      if (decision !== 'approved' && decision !== 'rejected') fail();
      return {
        turn_id: safeTurnId(valueAt(value, 'turn_id')),
        run_id: safeRunId(valueAt(value, 'run_id')),
        plan_result_digest: safeDigest(valueAt(value, 'plan_result_digest')),
        review_id: safeReviewId(valueAt(value, 'review_id')),
        reviewer_id: safeActorId(valueAt(value, 'reviewer_id')),
        reviewed_at_ms: safeTimestamp(valueAt(value, 'reviewed_at_ms')),
        decision,
      };
    }
    case 'run_started':
      return {
        turn_id: safeTurnId(valueAt(value, 'turn_id')),
        run_id: safeRunId(valueAt(value, 'run_id')),
        task_id: nullable(valueAt(value, 'task_id'), safeTaskId),
        attempt_number: safeAttemptNumber(valueAt(value, 'attempt_number')),
        retry_of_run_id: nullable(valueAt(value, 'retry_of_run_id'), safeRunId),
        input_digest: safeDigest(valueAt(value, 'input_digest')),
      };
    case 'run_progress_recorded': {
      const stage = valueAt(value, 'stage');
      if (!RUN_PROGRESS_STAGES.includes(stage)) fail();
      return {
        turn_id: safeTurnId(valueAt(value, 'turn_id')),
        run_id: safeRunId(valueAt(value, 'run_id')),
        stage,
      };
    }
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
    case 'tool_call_requested': {
      const toolCallRecord = sanitizeBuilderToolCallRecord(valueAt(value, 'tool_call_record'));
      if (
        toolCallRecord.project_id !== projectId
        || toolCallRecord.conversation_id !== conversationId
      ) fail();
      return {
        tool_call_record: toolCallRecord,
      };
    }
    case 'tool_call_result_recorded': {
      const toolResultRecord = sanitizeBuilderToolResultRecord(valueAt(value, 'tool_result_record'));
      if (
        toolResultRecord.project_id !== projectId
        || toolResultRecord.conversation_id !== conversationId
      ) fail();
      return {
        tool_result_record: toolResultRecord,
      };
    }
    case 'agent_step_progress_recorded': {
      const progressAdmission = sanitizeBuilderAgentStepProgressConversationAdmission(
        valueAt(value, 'progress_admission'),
      );
      if (
        progressAdmission.project_id !== projectId
        || progressAdmission.conversation_id !== conversationId
      ) fail();
      return {
        progress_admission: progressAdmission,
      };
    }
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
      const planAdmission = nullable(valueAt(value, 'plan_admission'), sanitizePlanAdmission);
      if (
        (resultKind === 'candidate') !== (candidateResult !== null)
        || (resultKind === 'plan') !== (planAdmission !== null)
        || (planAdmission !== null && (
          terminalStatus !== 'succeeded'
          || planAdmission.project_id !== projectId
          || planAdmission.conversation_id !== conversationId
          || planAdmission.turn_id !== turnId
          || planAdmission.run_id !== runId
          || planAdmission.plan_record_digest !== resultDigest
        ))
      ) fail();
      return {
        turn_id: turnId,
        run_id: runId,
        terminal_status: terminalStatus,
        result_kind: resultKind,
        result_digest: resultDigest,
        assistant_message: assistantMessage,
        candidate_result: candidateResult,
        plan_admission: planAdmission,
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

function conversationHeadDigest(head) {
  return sha256Canonical({
    event_digest: head.event_digest,
    event_id: head.event_id,
    sequence: head.sequence,
  });
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
  const previousEvent = sanitizePrevious(valueAt(value, 'previous_event'), sequence);
  const payload = sanitizePayload(eventType, valueAt(value, 'payload'), projectId, conversationId);
  if (
    eventType === 'run_completed'
    && payload.candidate_result !== null
    && (
      payload.candidate_result.git_candidate_receipt.project_id !== projectId
      || payload.candidate_result.git_candidate_receipt.conversation_id !== conversationId
    )
  ) fail();
  if (
    eventType === 'run_completed'
    && payload.plan_admission !== null
    && (
      previousEvent === null
      || payload.plan_admission.head_sequence !== previousEvent.sequence
      || payload.plan_admission.head_digest !== conversationHeadDigest(previousEvent)
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
    previous_event: previousEvent,
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
  createBuilderConversationPlanAdmission: safeBoundary(createBuilderConversationPlanAdmission),
  createBuilderConversationEvent: safeBoundary(createBuilderConversationEvent),
  sanitizeBuilderConversationEvent: safeBoundary(sanitizeBuilderConversationEvent),
  serializeBuilderConversationEvent: safeBoundary(serializeBuilderConversationEvent),
});
