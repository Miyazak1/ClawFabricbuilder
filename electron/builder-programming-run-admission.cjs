'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const {
  sanitizeBuilderExecutionApproval,
} = require('./builder-execution-approval.cjs');
const {
  sanitizeBuilderRunContextSnapshot,
} = require('./builder-run-context-snapshot.cjs');

const BUILDER_PROGRAMMING_RUN_ADMISSION_VERSION = 'builder-programming-run-admission.v1';
const BUILDER_PROGRAMMING_RUN_ADMISSION_KIND = 'builder_programming_run_admission';
const INPUT_KEYS = Object.freeze(['execution_approval', 'run_context_snapshot', 'admitted_at_ms']);
const RECORD_KEYS = Object.freeze([
  'admission_version',
  'admission_kind',
  'admission_id',
  'project_id',
  'conversation_id',
  'turn_id',
  'task_id',
  'run_id',
  'execution_approval_id',
  'execution_approval_digest',
  'approved_plan_turn_id',
  'approved_plan_task_id',
  'approved_plan_run_id',
  'context_snapshot_id',
  'context_digest',
  'source_tree_digest',
  'provider_config_digest',
  'status',
  'admitted_at_ms',
  'lifecycle',
  'authority',
  'admission_digest',
]);
const LIFECYCLE_KEYS = Object.freeze([
  'execution_approval',
  'run_context_snapshot',
  'provider_dispatch',
  'source_mutation',
  'draft_checkpoint',
  'save_version',
]);
const AUTHORITY_KEYS = Object.freeze([
  'admission_authority',
  'execution_approval_authority',
  'run_context_authority',
  'renderer_authority',
  'provider_dispatch',
  'source_mutation',
  'save_version_authority',
]);
const LIFECYCLE = Object.freeze({
  execution_approval: 'fresh_digest_verified',
  run_context_snapshot: 'current_run_digest_verified',
  provider_dispatch: 'admitted_once',
  source_mutation: 'not_performed',
  draft_checkpoint: 'not_created',
  save_version: 'not_authorized',
});
const AUTHORITY = Object.freeze({
  admission_authority: 'main_programming_run_admission_contract_v1',
  execution_approval_authority: 'main_execution_approval_contract_v1',
  run_context_authority: 'sqlite_run_context_snapshot_event',
  renderer_authority: 'not_present',
  provider_dispatch: true,
  source_mutation: 'not_performed',
  save_version_authority: 'not_present',
});
const PROJECT_ID_PATTERN = /^builder-project:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CONVERSATION_ID_PATTERN = /^builder-conversation:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const TURN_ID_PATTERN = /^builder-turn:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const TASK_ID_PATTERN = /^builder-task:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const RUN_ID_PATTERN = /^builder-run:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const APPROVAL_ID_PATTERN = /^builder-execution-approval:[0-9a-f]{64}$/u;
const SNAPSHOT_ID_PATTERN = /^builder-run-context-snapshot:[0-9a-f]{64}$/u;
const ADMISSION_ID_PATTERN = /^builder-programming-run-admission:[0-9a-f]{64}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;

class BuilderProgrammingRunAdmissionError extends Error {
  constructor() {
    super('The programming run could not be admitted.');
    this.name = 'BuilderProgrammingRunAdmissionError';
    this.code = 'builder_programming_run_admission_invalid';
    this.retryable = false;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() { throw new BuilderProgrammingRunAdmissionError(); }

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || utilTypes.isProxy(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactObject(value, keys) {
  if (!isPlainObject(value)) fail();
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== keys.length || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))) fail();
  for (const key of keys) {
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

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freezeDeep(nested);
    Object.freeze(value);
  }
  return value;
}

function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(valueAt(value, key))}`).join(',')}}`;
  }
  fail();
}

function sha256Canonical(value) {
  return `sha256:${nodeCrypto.createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')}`;
}

function digestHex(value) { return sha256Canonical(value).slice('sha256:'.length); }

function safePattern(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) fail();
  return value;
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail();
  return value;
}

function sanitizeLifecycle(value) {
  const source = exactObject(value, LIFECYCLE_KEYS);
  for (const key of LIFECYCLE_KEYS) if (valueAt(source, key) !== LIFECYCLE[key]) fail();
  return freezeDeep({ ...LIFECYCLE });
}

function sanitizeAuthority(value) {
  const source = exactObject(value, AUTHORITY_KEYS);
  for (const key of AUTHORITY_KEYS) if (valueAt(source, key) !== AUTHORITY[key]) fail();
  return freezeDeep({ ...AUTHORITY });
}

function admissionBody(value) {
  const body = { ...value };
  delete body.admission_id;
  delete body.admission_digest;
  return body;
}

function assertSnapshotMatchesApproval(snapshot, approval, admittedAtMs) {
  const understandingRef = snapshot.project_understanding_ref;
  const expectedUnderstandingRef = approval.project_understanding_ref;
  if (
    snapshot.project_id !== approval.project_id
    || snapshot.conversation_id !== approval.conversation_id
    || snapshot.created_at_ms > admittedAtMs
    || snapshot.route_decision.route !== 'build'
    || snapshot.route_decision.dispatch !== 'build'
    || snapshot.permissions.permission_result !== 'allowed'
    || !snapshot.permissions.required_permissions.includes('write_project')
    || (understandingRef === null) !== (expectedUnderstandingRef === null)
  ) fail();
  if (understandingRef !== null && (
    understandingRef.snapshot_digest !== expectedUnderstandingRef.snapshot_digest
    || understandingRef.source_tree_digest !== approval.source_tree_digest
  )) fail();
}

function createBuilderProgrammingRunAdmission(rawInput) {
  try {
    const input = exactObject(rawInput, INPUT_KEYS);
    const approval = sanitizeBuilderExecutionApproval(valueAt(input, 'execution_approval'));
    const snapshot = sanitizeBuilderRunContextSnapshot(valueAt(input, 'run_context_snapshot'));
    const admittedAtMs = safeTimestamp(valueAt(input, 'admitted_at_ms'));
    if (admittedAtMs < approval.approved_at_ms || admittedAtMs >= approval.expires_at_ms) fail();
    assertSnapshotMatchesApproval(snapshot, approval, admittedAtMs);
    const unsigned = freezeDeep({
      admission_version: BUILDER_PROGRAMMING_RUN_ADMISSION_VERSION,
      admission_kind: BUILDER_PROGRAMMING_RUN_ADMISSION_KIND,
      project_id: snapshot.project_id,
      conversation_id: snapshot.conversation_id,
      turn_id: snapshot.turn_id,
      task_id: snapshot.task_id,
      run_id: snapshot.run_id,
      execution_approval_id: approval.approval_id,
      execution_approval_digest: approval.approval_digest,
      approved_plan_turn_id: approval.approved_plan_turn_id,
      approved_plan_task_id: approval.approved_plan_task_id,
      approved_plan_run_id: approval.approved_plan_run_id,
      context_snapshot_id: snapshot.snapshot_id,
      context_digest: snapshot.context_digest,
      source_tree_digest: approval.source_tree_digest,
      provider_config_digest: approval.provider_config_digest,
      status: 'admitted',
      admitted_at_ms: admittedAtMs,
      lifecycle: { ...LIFECYCLE },
      authority: { ...AUTHORITY },
    });
    return freezeDeep({
      ...unsigned,
      admission_id: `builder-programming-run-admission:${digestHex(unsigned)}`,
      admission_digest: sha256Canonical(unsigned),
    });
  } catch (error) {
    if (error instanceof BuilderProgrammingRunAdmissionError) throw error;
    fail();
  }
}

function sanitizeBuilderProgrammingRunAdmission(rawValue) {
  try {
    const source = exactObject(rawValue, RECORD_KEYS);
    const normalized = freezeDeep({
      admission_version: valueAt(source, 'admission_version'),
      admission_kind: valueAt(source, 'admission_kind'),
      admission_id: safePattern(valueAt(source, 'admission_id'), ADMISSION_ID_PATTERN),
      project_id: safePattern(valueAt(source, 'project_id'), PROJECT_ID_PATTERN),
      conversation_id: safePattern(valueAt(source, 'conversation_id'), CONVERSATION_ID_PATTERN),
      turn_id: safePattern(valueAt(source, 'turn_id'), TURN_ID_PATTERN),
      task_id: safePattern(valueAt(source, 'task_id'), TASK_ID_PATTERN),
      run_id: safePattern(valueAt(source, 'run_id'), RUN_ID_PATTERN),
      execution_approval_id: safePattern(valueAt(source, 'execution_approval_id'), APPROVAL_ID_PATTERN),
      execution_approval_digest: safePattern(valueAt(source, 'execution_approval_digest'), DIGEST_PATTERN),
      approved_plan_turn_id: safePattern(valueAt(source, 'approved_plan_turn_id'), TURN_ID_PATTERN),
      approved_plan_task_id: safePattern(valueAt(source, 'approved_plan_task_id'), TASK_ID_PATTERN),
      approved_plan_run_id: safePattern(valueAt(source, 'approved_plan_run_id'), RUN_ID_PATTERN),
      context_snapshot_id: safePattern(valueAt(source, 'context_snapshot_id'), SNAPSHOT_ID_PATTERN),
      context_digest: safePattern(valueAt(source, 'context_digest'), DIGEST_PATTERN),
      source_tree_digest: safePattern(valueAt(source, 'source_tree_digest'), DIGEST_PATTERN),
      provider_config_digest: safePattern(valueAt(source, 'provider_config_digest'), DIGEST_PATTERN),
      status: valueAt(source, 'status'),
      admitted_at_ms: safeTimestamp(valueAt(source, 'admitted_at_ms')),
      lifecycle: sanitizeLifecycle(valueAt(source, 'lifecycle')),
      authority: sanitizeAuthority(valueAt(source, 'authority')),
      admission_digest: safePattern(valueAt(source, 'admission_digest'), DIGEST_PATTERN),
    });
    if (
      normalized.admission_version !== BUILDER_PROGRAMMING_RUN_ADMISSION_VERSION
      || normalized.admission_kind !== BUILDER_PROGRAMMING_RUN_ADMISSION_KIND
      || normalized.status !== 'admitted'
      || normalized.conversation_id.slice('builder-conversation:'.length)
        !== normalized.project_id.slice('builder-project:'.length)
      || normalized.admission_id !== `builder-programming-run-admission:${digestHex(admissionBody(normalized))}`
      || normalized.admission_digest !== sha256Canonical(admissionBody(normalized))
    ) fail();
    return normalized;
  } catch (error) {
    if (error instanceof BuilderProgrammingRunAdmissionError) throw error;
    fail();
  }
}

module.exports = Object.freeze({
  BUILDER_PROGRAMMING_RUN_ADMISSION_VERSION,
  BUILDER_PROGRAMMING_RUN_ADMISSION_KIND,
  BuilderProgrammingRunAdmissionError,
  createBuilderProgrammingRunAdmission,
  sanitizeBuilderProgrammingRunAdmission,
});
