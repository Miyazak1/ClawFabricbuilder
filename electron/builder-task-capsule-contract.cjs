'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const BUILDER_WORKING_BRIEF_VERSION = 'builder-working-brief.v1';
const BUILDER_TASK_CAPSULE_VERSION = 'builder-task-capsule.v1';
const BUILDER_TASK_CAPSULE_UPDATE_VERSION = 'builder-task-capsule-update.v1';

const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const PROJECT_ID_PATTERN = new RegExp(`^builder-project:${UUID_SOURCE}$`, 'u');
const CONVERSATION_ID_PATTERN = new RegExp(`^builder-conversation:${UUID_SOURCE}$`, 'u');
const TURN_ID_PATTERN = new RegExp(`^builder-turn:${UUID_SOURCE}$`, 'u');
const RUN_ID_PATTERN = new RegExp(`^builder-run:${UUID_SOURCE}$`, 'u');
const MESSAGE_ID_PATTERN = new RegExp(`^builder-message:${UUID_SOURCE}$`, 'u');
const TASK_ID_PATTERN = new RegExp(`^builder-task:${UUID_SOURCE}$`, 'u');
const ROUTE_DECISION_ID_PATTERN = new RegExp(`^builder-route-decision:${UUID_SOURCE}$`, 'u');

const UNSAFE_UNICODE_FORMAT_PATTERN = /[\p{Cf}\p{Bidi_Control}]/u;
const LOCAL_PATH_PATTERN = /(?:file:\/{1,3}|\\\\|(?:^|[\s"'`=(,:])(?:[A-Za-z]:[\\/]|~[\\/]|\/(?!\/)[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*))/iu;
const CREDENTIAL_PATTERN = /(?:["'`]?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|password|secret|credential|client[_-]?secret|private[_-]?key)["'`]?\s*[:=]\s*(?!["'`]?\s*(?:null|undefined)\b)\S|\b(?:basic|bearer)\s+[A-Za-z0-9._~+/=-]{16,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|https?:\/\/[^\s/:@]+:[^\s/@]+@|\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16})\b)/iu;

const WORKING_BRIEF_KEYS = Object.freeze([
  'brief_version',
  'source',
  'latest_user_goal',
  'assistant_proposal',
  'approved_plan',
  'use_when_instruction_is_contextual',
]);
const TASK_CAPSULE_KEYS = Object.freeze([
  'capsule_version',
  'task_id',
  'project_id',
  'title',
  'goal',
  'status',
  'current_brief',
  'last_route_decision_id',
  'updated_at_ms',
]);
const TASK_CAPSULE_UPDATE_INPUT_KEYS = Object.freeze([
  'project_id',
  'conversation_id',
  'turn_id',
  'run_id',
  'message_id',
  'route_decision_id',
  'task_capsule',
  'updated_at_ms',
]);
const TASK_CAPSULE_UPDATE_RECORD_KEYS = Object.freeze([
  'record_version',
  'update_id',
  ...TASK_CAPSULE_UPDATE_INPUT_KEYS,
  'authority',
]);
const WORKING_BRIEF_SOURCES = Object.freeze(['task_capsule_update']);
const TASK_CAPSULE_STATUSES = Object.freeze(['discussing', 'ready']);
const TASK_CAPSULE_UPDATE_AUTHORITY = Object.freeze({
  task_capsule_authority: 'main_task_capsule_contract_v1',
  conversation_append: 'not_performed',
  sqlite_write: 'not_performed',
  provider_dispatch: 'not_performed',
  source_mutation: 'not_performed',
  git_mutation: 'not_performed',
  permission_grant: 'not_performed',
  review_admission: 'not_created',
  revision_admission: 'not_created',
  renderer_authority: 'not_present',
});
const ERROR_MESSAGE = 'Builder task capsule could not be verified.';

class BuilderTaskCapsuleContractError extends Error {
  constructor() {
    super(ERROR_MESSAGE);
    this.name = 'BuilderTaskCapsuleContractError';
    this.code = 'builder_task_capsule_invalid';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderTaskCapsuleContractError();
}

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freezeDeep(nested);
    Object.freeze(value);
  }
  return value;
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
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== keys.length
    || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) fail();
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

function safePattern(value, pattern, maximum) {
  if (typeof value !== 'string' || value.length > maximum || !pattern.test(value)) fail();
  return value;
}

function safeProjectId(value) {
  return safePattern(value, PROJECT_ID_PATTERN, 64);
}

function safeConversationId(value) {
  return safePattern(value, CONVERSATION_ID_PATTERN, 96);
}

function safeTurnId(value) {
  return safePattern(value, TURN_ID_PATTERN, 80);
}

function safeRunId(value) {
  return safePattern(value, RUN_ID_PATTERN, 80);
}

function safeMessageId(value) {
  return safePattern(value, MESSAGE_ID_PATTERN, 96);
}

function safeTaskId(value) {
  return safePattern(value, TASK_ID_PATTERN, 80);
}

function safeRouteDecisionId(value) {
  return safePattern(value, ROUTE_DECISION_ID_PATTERN, 96);
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail();
  return value;
}

function safeEnum(value, options) {
  if (typeof value !== 'string' || !options.includes(value)) fail();
  return value;
}

function hasUnpairedSurrogate(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function hasControl(value, allowFormatting) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (
      code <= 0x1f
      && !(allowFormatting && (code === 0x09 || code === 0x0a || code === 0x0d))
    ) return true;
    if (code === 0x7f) return true;
  }
  return UNSAFE_UNICODE_FORMAT_PATTERN.test(value);
}

function safeText(value, maximumCodePoints, maximumBytes, allowFormatting) {
  if (
    typeof value !== 'string'
    || value.length > maximumCodePoints * 2
    || value.length === 0
    || value.trim() !== value
    || value.normalize('NFC') !== value
    || hasUnpairedSurrogate(value)
    || hasControl(value, allowFormatting)
    || Array.from(value).length > maximumCodePoints
    || Buffer.byteLength(value, 'utf8') > maximumBytes
    || LOCAL_PATH_PATTERN.test(value.normalize('NFKC'))
    || CREDENTIAL_PATTERN.test(value.normalize('NFKC'))
  ) fail();
  return value;
}

function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(valueAt(value, key))}`
    )).join(',')}}`;
  }
  fail();
}

function digestId(prefix, body) {
  return `${prefix}:${nodeCrypto.createHash('sha256').update(canonicalJson(body), 'utf8').digest('hex')}`;
}

function createBuilderWorkingBrief(rawInput) {
  exactObject(rawInput, WORKING_BRIEF_KEYS);
  if (
    valueAt(rawInput, 'brief_version') !== BUILDER_WORKING_BRIEF_VERSION
    || valueAt(rawInput, 'approved_plan') !== null
    || typeof valueAt(rawInput, 'use_when_instruction_is_contextual') !== 'boolean'
  ) fail();
  const contextual = valueAt(rawInput, 'use_when_instruction_is_contextual');
  return freezeDeep({
    brief_version: BUILDER_WORKING_BRIEF_VERSION,
    source: safeEnum(valueAt(rawInput, 'source'), WORKING_BRIEF_SOURCES),
    latest_user_goal: safeText(valueAt(rawInput, 'latest_user_goal'), 1_024, 4_096, true),
    assistant_proposal: safeText(valueAt(rawInput, 'assistant_proposal'), 2_048, 8_192, true),
    approved_plan: null,
    use_when_instruction_is_contextual: contextual,
  });
}

function createBuilderTaskCapsule(rawInput) {
  exactObject(rawInput, TASK_CAPSULE_KEYS);
  const status = safeEnum(valueAt(rawInput, 'status'), TASK_CAPSULE_STATUSES);
  const currentBrief = createBuilderWorkingBrief(valueAt(rawInput, 'current_brief'));
  if ((status === 'ready') !== (currentBrief.use_when_instruction_is_contextual === true)) fail();
  return freezeDeep({
    capsule_version: safeEnum(valueAt(rawInput, 'capsule_version'), [BUILDER_TASK_CAPSULE_VERSION]),
    task_id: safeTaskId(valueAt(rawInput, 'task_id')),
    project_id: safeProjectId(valueAt(rawInput, 'project_id')),
    title: safeText(valueAt(rawInput, 'title'), 160, 1_024, false),
    goal: safeText(valueAt(rawInput, 'goal'), 1_024, 4_096, true),
    status,
    current_brief: currentBrief,
    last_route_decision_id: safeRouteDecisionId(valueAt(rawInput, 'last_route_decision_id')),
    updated_at_ms: safeTimestamp(valueAt(rawInput, 'updated_at_ms')),
  });
}

function createBuilderTaskCapsuleUpdate(rawInput) {
  exactObject(rawInput, TASK_CAPSULE_UPDATE_INPUT_KEYS);
  const projectId = safeProjectId(valueAt(rawInput, 'project_id'));
  const routeDecisionId = safeRouteDecisionId(valueAt(rawInput, 'route_decision_id'));
  const updatedAtMs = safeTimestamp(valueAt(rawInput, 'updated_at_ms'));
  const taskCapsule = createBuilderTaskCapsule(valueAt(rawInput, 'task_capsule'));
  if (
    taskCapsule.project_id !== projectId
    || taskCapsule.status !== 'ready'
    || taskCapsule.last_route_decision_id !== routeDecisionId
    || taskCapsule.updated_at_ms !== updatedAtMs
  ) fail();
  const body = freezeDeep({
    project_id: projectId,
    conversation_id: safeConversationId(valueAt(rawInput, 'conversation_id')),
    turn_id: safeTurnId(valueAt(rawInput, 'turn_id')),
    run_id: safeRunId(valueAt(rawInput, 'run_id')),
    message_id: safeMessageId(valueAt(rawInput, 'message_id')),
    route_decision_id: routeDecisionId,
    task_capsule: taskCapsule,
    updated_at_ms: updatedAtMs,
    authority: { ...TASK_CAPSULE_UPDATE_AUTHORITY },
  });
  return freezeDeep({
    record_version: BUILDER_TASK_CAPSULE_UPDATE_VERSION,
    update_id: digestId('builder-task-capsule-update', body),
    ...body,
  });
}

function sanitizeBuilderWorkingBrief(value) {
  return createBuilderWorkingBrief(value);
}

function sanitizeBuilderTaskCapsule(value) {
  return createBuilderTaskCapsule(value);
}

function sanitizeBuilderTaskCapsuleUpdate(value) {
  exactObject(value, TASK_CAPSULE_UPDATE_RECORD_KEYS);
  if (valueAt(value, 'record_version') !== BUILDER_TASK_CAPSULE_UPDATE_VERSION) fail();
  const rebuilt = createBuilderTaskCapsuleUpdate({
    project_id: valueAt(value, 'project_id'),
    conversation_id: valueAt(value, 'conversation_id'),
    turn_id: valueAt(value, 'turn_id'),
    run_id: valueAt(value, 'run_id'),
    message_id: valueAt(value, 'message_id'),
    route_decision_id: valueAt(value, 'route_decision_id'),
    task_capsule: valueAt(value, 'task_capsule'),
    updated_at_ms: valueAt(value, 'updated_at_ms'),
  });
  if (
    valueAt(value, 'update_id') !== rebuilt.update_id
    || canonicalJson(valueAt(value, 'authority')) !== canonicalJson(rebuilt.authority)
  ) fail();
  return rebuilt;
}

module.exports = Object.freeze({
  BUILDER_WORKING_BRIEF_VERSION,
  BUILDER_TASK_CAPSULE_VERSION,
  BUILDER_TASK_CAPSULE_UPDATE_VERSION,
  TASK_CAPSULE_UPDATE_AUTHORITY,
  BuilderTaskCapsuleContractError,
  createBuilderWorkingBrief,
  createBuilderTaskCapsule,
  createBuilderTaskCapsuleUpdate,
  sanitizeBuilderWorkingBrief,
  sanitizeBuilderTaskCapsule,
  sanitizeBuilderTaskCapsuleUpdate,
});
