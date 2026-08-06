'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const {
  sanitizeBuilderTaskCapsule,
} = require('./builder-task-capsule-contract.cjs');

const BUILDER_WORKING_CONTEXT_STATE_VERSION = 'builder-working-context-state.v1';

const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const PROJECT_ID_PATTERN = new RegExp(`^builder-project:${UUID_SOURCE}$`, 'u');
const SESSION_ID_PATTERN = new RegExp(`^builder-session:${UUID_SOURCE}$`, 'u');
const TASK_ADDRESS_ID_PATTERN = new RegExp(`^builder-task-address:${UUID_SOURCE}$`, 'u');
const CONVERSATION_ID_PATTERN = new RegExp(`^builder-conversation:${UUID_SOURCE}$`, 'u');
const ROUTE_DECISION_ID_PATTERN = new RegExp(`^builder-route-decision:${UUID_SOURCE}$`, 'u');
const TASK_ID_PATTERN = new RegExp(`^builder-task:${UUID_SOURCE}$`, 'u');
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const UNSAFE_UNICODE_FORMAT_PATTERN = /[\p{Cf}\p{Bidi_Control}]/u;
const LOCAL_PATH_PATTERN = /(?:file:\/{1,3}|\\\\|(?:^|[\s"'`=(,:])(?:[A-Za-z]:[\\/]|~[\\/]|\/(?!\/)[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*))/iu;
const CREDENTIAL_PATTERN = /(?:["'`]?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|password|secret|credential|client[_-]?secret|private[_-]?key)["'`]?\s*[:=]\s*(?!["'`]?\s*(?:null|undefined)\b)\S|\b(?:basic|bearer)\s+[A-Za-z0-9._~+/=-]{16,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|https?:\/\/[^\s/:@]+:[^\s/@]+@|\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16})\b)/iu;

const INPUT_KEYS = Object.freeze([
  'project_id',
  'session_id',
  'task_address_id',
  'conversation_id',
  'objective_summary',
  'confirmed_constraints',
  'rejected_constraints',
  'open_questions',
  'latest_user_intent',
  'source_refs',
  'compaction_refs',
  'handoff_refs',
  'latest_task_capsule',
  'approved_plan_ref',
  'base_revision_ref',
  'invalidated_by',
  'updated_at_ms',
]);
const STATE_KEYS = Object.freeze([
  'state_version',
  'state_id',
  'project_id',
  'session_id',
  'task_address_id',
  'conversation_id',
  'state',
  'objective_summary',
  'confirmed_constraints',
  'rejected_constraints',
  'open_questions',
  'latest_user_intent',
  'source_refs',
  'compaction_refs',
  'handoff_refs',
  'task_capsule_ref',
  'approved_plan_ref',
  'base_revision_ref',
  'invalidated_by',
  'updated_at_ms',
  'authority',
]);
const SOURCE_REF_KEYS = Object.freeze(['source_kind', 'source_digest']);
const COMPACTION_REF_KEYS = Object.freeze(['summary_digest', 'source_range_digest', 'compacted_at_ms']);
const HANDOFF_REF_KEYS = Object.freeze(['packet_digest', 'inserted_at_ms', 'adopted_at_ms']);
const TASK_CAPSULE_REF_KEYS = Object.freeze(['task_id', 'status', 'update_digest', 'updated_at_ms']);
const APPROVED_PLAN_REF_KEYS = Object.freeze(['plan_result_digest', 'conversation_head_digest', 'approved_at_ms']);
const BASE_REVISION_REF_KEYS = Object.freeze(['revision_receipt_digest']);
const INVALIDATION_REF_KEYS = Object.freeze(['source', 'route_decision_id', 'invalidated_at_ms']);
const AUTHORITY_KEYS = Object.freeze([
  'working_context_authority',
  'context_compaction',
  'renderer_authority',
  'sqlite_read',
  'sqlite_write',
  'provider_dispatch',
  'tool_dispatch',
  'source_mutation',
  'git_mutation',
  'permission_grant',
  'revision_admission',
]);

const STATES = Object.freeze([
  'empty',
  'discussing',
  'ready',
  'stale',
  'approved_plan_ready',
  'needs_clarification',
]);
const SOURCE_KINDS = Object.freeze([
  'task_capsule_update',
  'approved_plan',
  'brief_correction',
  'compaction_summary',
  'user_message',
  'assistant_message',
]);
const INVALIDATION_SOURCES = Object.freeze(['brief_correction', 'user_correction']);
const AUTHORITY = Object.freeze({
  working_context_authority: 'main_working_context_state_contract_v1',
  context_compaction: 'not_authoritative_for_readiness',
  renderer_authority: 'not_present',
  sqlite_read: 'not_performed',
  sqlite_write: 'not_performed',
  provider_dispatch: 'not_performed',
  tool_dispatch: 'not_performed',
  source_mutation: 'not_performed',
  git_mutation: 'not_performed',
  permission_grant: 'not_performed',
  revision_admission: 'not_created',
});

const ERROR_MESSAGE = 'Builder working context state could not be verified.';

class BuilderWorkingContextStateError extends Error {
  constructor() {
    super(ERROR_MESSAGE);
    this.name = 'BuilderWorkingContextStateError';
    this.code = 'builder_working_context_state_invalid';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderWorkingContextStateError();
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

function safeSessionId(value) {
  return safePattern(value, SESSION_ID_PATTERN, 96);
}

function safeTaskAddressId(value) {
  return safePattern(value, TASK_ADDRESS_ID_PATTERN, 96);
}

function safeConversationId(value) {
  return safePattern(value, CONVERSATION_ID_PATTERN, 96);
}

function safeRouteDecisionId(value) {
  return safePattern(value, ROUTE_DECISION_ID_PATTERN, 96);
}

function safeTaskId(value) {
  return safePattern(value, TASK_ID_PATTERN, 80);
}

function safeDigest(value) {
  return safePattern(value, DIGEST_PATTERN, 80);
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail();
  return value;
}

function safeEnum(value, allowed) {
  if (typeof value !== 'string' || !allowed.includes(value)) fail();
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

function safeNullableText(value, maximumCodePoints, maximumBytes, allowFormatting) {
  if (value === null) return null;
  return safeText(value, maximumCodePoints, maximumBytes, allowFormatting);
}

function safeTextArray(value, maximumItems, maximumCodePoints, maximumBytes) {
  if (!Array.isArray(value) || utilTypes.isProxy(value) || value.length > maximumItems) fail();
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key === 'symbol') || keys.length !== value.length + 1) fail();
  const items = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
    items.push(safeText(descriptor.value, maximumCodePoints, maximumBytes, true));
  }
  return Object.freeze(items);
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

function sanitizeSourceRef(value) {
  exactObject(value, SOURCE_REF_KEYS);
  return freezeDeep({
    source_kind: safeEnum(valueAt(value, 'source_kind'), SOURCE_KINDS),
    source_digest: safeDigest(valueAt(value, 'source_digest')),
  });
}

function sanitizeSourceRefs(value) {
  if (!Array.isArray(value) || utilTypes.isProxy(value) || value.length > 8) fail();
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key === 'symbol') || keys.length !== value.length + 1) fail();
  const refs = [];
  const seen = new Set();
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
    const ref = sanitizeSourceRef(descriptor.value);
    const key = `${ref.source_kind}:${ref.source_digest}`;
    if (seen.has(key)) fail();
    seen.add(key);
    refs.push(ref);
  }
  return freezeDeep(refs);
}

function sanitizeCompactionRef(value, updatedAtMs) {
  exactObject(value, COMPACTION_REF_KEYS);
  const compactedAtMs = safeTimestamp(valueAt(value, 'compacted_at_ms'));
  if (compactedAtMs > updatedAtMs) fail();
  return freezeDeep({
    summary_digest: safeDigest(valueAt(value, 'summary_digest')),
    source_range_digest: safeDigest(valueAt(value, 'source_range_digest')),
    compacted_at_ms: compactedAtMs,
  });
}

function sanitizeCompactionRefs(value, updatedAtMs) {
  if (!Array.isArray(value) || utilTypes.isProxy(value) || value.length > 4) fail();
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key === 'symbol') || keys.length !== value.length + 1) fail();
  const refs = [];
  const seen = new Set();
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
    const ref = sanitizeCompactionRef(descriptor.value, updatedAtMs);
    const key = `${ref.summary_digest}:${ref.source_range_digest}`;
    if (seen.has(key)) fail();
    seen.add(key);
    refs.push(ref);
  }
  return freezeDeep(refs);
}

function sanitizeHandoffRef(value, updatedAtMs) {
  exactObject(value, HANDOFF_REF_KEYS);
  const insertedAtMs = safeTimestamp(valueAt(value, 'inserted_at_ms'));
  const adoptedAtMs = safeTimestamp(valueAt(value, 'adopted_at_ms'));
  if (insertedAtMs > updatedAtMs || adoptedAtMs > updatedAtMs || adoptedAtMs < insertedAtMs) fail();
  return freezeDeep({
    packet_digest: safeDigest(valueAt(value, 'packet_digest')),
    inserted_at_ms: insertedAtMs,
    adopted_at_ms: adoptedAtMs,
  });
}

function sanitizeHandoffRefs(value, updatedAtMs) {
  if (!Array.isArray(value) || utilTypes.isProxy(value) || value.length > 4) fail();
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key === 'symbol') || keys.length !== value.length + 1) fail();
  const refs = [];
  const seen = new Set();
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
    const ref = sanitizeHandoffRef(descriptor.value, updatedAtMs);
    if (seen.has(ref.packet_digest)) fail();
    seen.add(ref.packet_digest);
    refs.push(ref);
  }
  return freezeDeep(refs);
}

function sanitizeTaskCapsuleRef(value, projectId) {
  if (value === null) return null;
  const taskCapsule = sanitizeBuilderTaskCapsule(value);
  if (taskCapsule.project_id !== projectId) fail();
  return freezeDeep({
    task_id: taskCapsule.task_id,
    status: taskCapsule.status,
    update_digest: digestId('builder-task-capsule-ref', taskCapsule),
    updated_at_ms: taskCapsule.updated_at_ms,
  });
}

function sanitizeApprovedPlanRef(value, updatedAtMs) {
  if (value === null) return null;
  exactObject(value, APPROVED_PLAN_REF_KEYS);
  const approvedAtMs = safeTimestamp(valueAt(value, 'approved_at_ms'));
  if (approvedAtMs > updatedAtMs) fail();
  return freezeDeep({
    plan_result_digest: safeDigest(valueAt(value, 'plan_result_digest')),
    conversation_head_digest: safeDigest(valueAt(value, 'conversation_head_digest')),
    approved_at_ms: approvedAtMs,
  });
}

function sanitizeBaseRevisionRef(value) {
  if (value === null) return null;
  exactObject(value, BASE_REVISION_REF_KEYS);
  return freezeDeep({
    revision_receipt_digest: safeDigest(valueAt(value, 'revision_receipt_digest')),
  });
}

function sanitizeInvalidationRef(value, updatedAtMs) {
  if (value === null) return null;
  exactObject(value, INVALIDATION_REF_KEYS);
  const invalidatedAtMs = safeTimestamp(valueAt(value, 'invalidated_at_ms'));
  if (invalidatedAtMs > updatedAtMs) fail();
  return freezeDeep({
    source: safeEnum(valueAt(value, 'source'), INVALIDATION_SOURCES),
    route_decision_id: safeRouteDecisionId(valueAt(value, 'route_decision_id')),
    invalidated_at_ms: invalidatedAtMs,
  });
}

function hasDiscussionFacts(objectiveSummary, confirmedConstraints, rejectedConstraints, latestUserIntent, sourceRefs) {
  return objectiveSummary !== null
    || confirmedConstraints.length > 0
    || rejectedConstraints.length > 0
    || latestUserIntent !== null
    || sourceRefs.some((ref) => ref.source_kind === 'user_message' || ref.source_kind === 'assistant_message');
}

function selectState({
  objectiveSummary,
  confirmedConstraints,
  rejectedConstraints,
  openQuestions,
  latestUserIntent,
  sourceRefs,
  taskCapsuleRef,
  approvedPlanRef,
  invalidatedBy,
}) {
  if (invalidatedBy !== null) return 'stale';
  if (approvedPlanRef !== null) {
    if (openQuestions.length > 0) fail();
    return 'approved_plan_ready';
  }
  if (openQuestions.length > 0) return 'needs_clarification';
  if (taskCapsuleRef !== null && taskCapsuleRef.status === 'ready') return 'ready';
  if (
    taskCapsuleRef !== null
    || hasDiscussionFacts(objectiveSummary, confirmedConstraints, rejectedConstraints, latestUserIntent, sourceRefs)
  ) return 'discussing';
  return 'empty';
}

function createBuilderWorkingContextState(rawInput) {
  exactObject(rawInput, INPUT_KEYS);
  const updatedAtMs = safeTimestamp(valueAt(rawInput, 'updated_at_ms'));
  const projectId = safeProjectId(valueAt(rawInput, 'project_id'));
  const objectiveSummary = safeNullableText(valueAt(rawInput, 'objective_summary'), 1_024, 4_096, true);
  const confirmedConstraints = safeTextArray(valueAt(rawInput, 'confirmed_constraints'), 16, 512, 2_048);
  const rejectedConstraints = safeTextArray(valueAt(rawInput, 'rejected_constraints'), 16, 512, 2_048);
  const openQuestions = safeTextArray(valueAt(rawInput, 'open_questions'), 8, 512, 2_048);
  const latestUserIntent = safeNullableText(valueAt(rawInput, 'latest_user_intent'), 512, 2_048, true);
  const sourceRefs = sanitizeSourceRefs(valueAt(rawInput, 'source_refs'));
  const compactionRefs = sanitizeCompactionRefs(valueAt(rawInput, 'compaction_refs'), updatedAtMs);
  const handoffRefs = sanitizeHandoffRefs(valueAt(rawInput, 'handoff_refs'), updatedAtMs);
  const taskCapsuleRef = sanitizeTaskCapsuleRef(valueAt(rawInput, 'latest_task_capsule'), projectId);
  const approvedPlanRef = sanitizeApprovedPlanRef(valueAt(rawInput, 'approved_plan_ref'), updatedAtMs);
  const baseRevisionRef = sanitizeBaseRevisionRef(valueAt(rawInput, 'base_revision_ref'));
  const invalidatedBy = sanitizeInvalidationRef(valueAt(rawInput, 'invalidated_by'), updatedAtMs);
  const body = freezeDeep({
    project_id: projectId,
    session_id: safeSessionId(valueAt(rawInput, 'session_id')),
    task_address_id: safeTaskAddressId(valueAt(rawInput, 'task_address_id')),
    conversation_id: safeConversationId(valueAt(rawInput, 'conversation_id')),
    state: selectState({
      objectiveSummary,
      confirmedConstraints,
      rejectedConstraints,
      openQuestions,
      latestUserIntent,
      sourceRefs,
      taskCapsuleRef,
      approvedPlanRef,
      invalidatedBy,
    }),
    objective_summary: objectiveSummary,
    confirmed_constraints: confirmedConstraints,
    rejected_constraints: rejectedConstraints,
    open_questions: openQuestions,
    latest_user_intent: latestUserIntent,
    source_refs: sourceRefs,
    compaction_refs: compactionRefs,
    handoff_refs: handoffRefs,
    task_capsule_ref: taskCapsuleRef,
    approved_plan_ref: approvedPlanRef,
    base_revision_ref: baseRevisionRef,
    invalidated_by: invalidatedBy,
    updated_at_ms: updatedAtMs,
    authority: { ...AUTHORITY },
  });
  return freezeDeep({
    state_version: BUILDER_WORKING_CONTEXT_STATE_VERSION,
    state_id: digestId('builder-working-context-state', body),
    ...body,
  });
}

function sanitizeAuthority(value) {
  exactObject(value, AUTHORITY_KEYS);
  if (canonicalJson(value) !== canonicalJson(AUTHORITY)) fail();
  return { ...AUTHORITY };
}

function sanitizeBuilderWorkingContextState(value) {
  exactObject(value, STATE_KEYS);
  if (valueAt(value, 'state_version') !== BUILDER_WORKING_CONTEXT_STATE_VERSION) fail();
  const updatedAtMs = safeTimestamp(valueAt(value, 'updated_at_ms'));
  const objectiveSummary = safeNullableText(valueAt(value, 'objective_summary'), 1_024, 4_096, true);
  const confirmedConstraints = safeTextArray(valueAt(value, 'confirmed_constraints'), 16, 512, 2_048);
  const rejectedConstraints = safeTextArray(valueAt(value, 'rejected_constraints'), 16, 512, 2_048);
  const openQuestions = safeTextArray(valueAt(value, 'open_questions'), 8, 512, 2_048);
  const latestUserIntent = safeNullableText(valueAt(value, 'latest_user_intent'), 512, 2_048, true);
  const sourceRefs = sanitizeSourceRefs(valueAt(value, 'source_refs'));
  const compactionRefs = sanitizeCompactionRefs(valueAt(value, 'compaction_refs'), updatedAtMs);
  const handoffRefs = sanitizeHandoffRefs(valueAt(value, 'handoff_refs'), updatedAtMs);
  const taskCapsuleRef = sanitizeTaskCapsuleRefFromState(valueAt(value, 'task_capsule_ref'));
  const approvedPlanRef = sanitizeApprovedPlanRef(valueAt(value, 'approved_plan_ref'), updatedAtMs);
  const invalidatedBy = sanitizeInvalidationRef(valueAt(value, 'invalidated_by'), updatedAtMs);
  const expectedState = selectState({
    objectiveSummary,
    confirmedConstraints,
    rejectedConstraints,
    openQuestions,
    latestUserIntent,
    sourceRefs,
    taskCapsuleRef,
    approvedPlanRef,
    invalidatedBy,
  });
  const state = safeEnum(valueAt(value, 'state'), STATES);
  if (state !== expectedState) fail();
  const body = freezeDeep({
    project_id: safeProjectId(valueAt(value, 'project_id')),
    session_id: safeSessionId(valueAt(value, 'session_id')),
    task_address_id: safeTaskAddressId(valueAt(value, 'task_address_id')),
    conversation_id: safeConversationId(valueAt(value, 'conversation_id')),
    state,
    objective_summary: objectiveSummary,
    confirmed_constraints: confirmedConstraints,
    rejected_constraints: rejectedConstraints,
    open_questions: openQuestions,
    latest_user_intent: latestUserIntent,
    source_refs: sourceRefs,
    compaction_refs: compactionRefs,
    handoff_refs: handoffRefs,
    task_capsule_ref: taskCapsuleRef,
    approved_plan_ref: approvedPlanRef,
    base_revision_ref: sanitizeBaseRevisionRef(valueAt(value, 'base_revision_ref')),
    invalidated_by: invalidatedBy,
    updated_at_ms: updatedAtMs,
    authority: sanitizeAuthority(valueAt(value, 'authority')),
  });
  if (
    valueAt(value, 'state_id') !== digestId('builder-working-context-state', body)
  ) fail();
  return freezeDeep({
    state_version: BUILDER_WORKING_CONTEXT_STATE_VERSION,
    state_id: valueAt(value, 'state_id'),
    ...body,
  });
}

function sanitizeTaskCapsuleRefFromState(value) {
  if (value === null) return null;
  exactObject(value, TASK_CAPSULE_REF_KEYS);
  return freezeDeep({
    task_id: safeTaskId(valueAt(value, 'task_id')),
    status: safeEnum(valueAt(value, 'status'), ['discussing', 'ready']),
    update_digest: safePattern(valueAt(value, 'update_digest'), /^builder-task-capsule-ref:[0-9a-f]{64}$/u, 96),
    updated_at_ms: safeTimestamp(valueAt(value, 'updated_at_ms')),
  });
}

module.exports = Object.freeze({
  BUILDER_WORKING_CONTEXT_STATE_VERSION,
  WORKING_CONTEXT_STATE_AUTHORITY: AUTHORITY,
  BuilderWorkingContextStateError,
  createBuilderWorkingContextState,
  sanitizeBuilderWorkingContextState,
});
