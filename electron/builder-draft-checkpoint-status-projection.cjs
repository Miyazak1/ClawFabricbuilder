'use strict';

const { types: utilTypes } = require('node:util');

const {
  sanitizeBuilderDraftCheckpoint,
} = require('./builder-draft-checkpoint.cjs');

const BUILDER_DRAFT_CHECKPOINT_STATUS_PROJECTION_VERSION =
  'builder-draft-checkpoint-status-projection.v1';
const BUILDER_DRAFT_CHECKPOINT_STORE_READ_RESULT_VERSION =
  'builder-draft-checkpoint-store-read-result.v1';

const INPUT_KEYS = Object.freeze(['latest_draft_checkpoint_read_result']);
const READ_RESULT_KEYS = Object.freeze([
  'result_version',
  'checkpoint_authority',
  'status',
  'draft_checkpoint',
  'checkpoint_evidence',
]);
const CHECKPOINT_ENTRY_KEYS = Object.freeze(['draft_checkpoint']);
const EVIDENCE_KEYS = Object.freeze([
  'database_id',
  'schema_version',
  'user_version',
  'schema_fingerprint_digest',
  'runtime_pragmas',
  'transaction',
  'checkpoint_authority',
  'checkpoint_contract_authority',
  'renderer_authority',
  'ipc_authority',
  'conversation_append',
  'provider_dispatch',
  'model_dispatch',
  'source_read',
  'source_write',
  'git_mutation',
  'permission_grant_authority',
  'review_authority',
  'revision_authority',
  'save_authority',
  'artifact_authority',
  'command_execution',
  'network_access',
  'publication',
  'work_capsule_authority',
  'recovery_model',
]);
const PROJECTION_KEYS = Object.freeze([
  'projection_version',
  'status',
  'label',
  'tone',
  'next_action_hint',
  'can_compare',
  'can_restore',
  'can_save_version',
  'changed_file_count',
  'verification_status',
  'authority',
]);
const AUTHORITY_KEYS = Object.freeze([
  'projection_authority',
  'checkpoint_store_read',
  'checkpoint_fact',
  'renderer_authority',
  'ipc_authority',
  'provider_dispatch',
  'tool_dispatch',
  'source_read',
  'source_write',
  'git_read',
  'git_write',
  'sqlite_write',
  'permission_grant',
  'revision_admission',
  'save_authority',
  'publication',
]);
const READY_TRANSACTIONS = Object.freeze([
  'draft_checkpoint_ready_read',
  'latest_draft_checkpoint_ready_read',
]);
const ABSENT_TRANSACTIONS = Object.freeze([
  'draft_checkpoint_absent_read',
  'latest_draft_checkpoint_absent_read',
]);
const COPY = Object.freeze({
  absent: Object.freeze({
    label: 'No draft checkpoint yet',
    tone: 'neutral',
    next_action_hint: 'Make a draft before restore or compare is available.',
    can_compare: false,
    can_restore: false,
    can_save_version: false,
  }),
  ready: Object.freeze({
    label: 'Checkpoint saved',
    tone: 'success',
    next_action_hint: 'You can compare, restore, continue, or save a version.',
    can_compare: true,
    can_restore: true,
    can_save_version: true,
  }),
});

class BuilderDraftCheckpointStatusProjectionError extends Error {
  constructor() {
    super('Builder draft checkpoint status is unavailable.');
    this.name = 'BuilderDraftCheckpointStatusProjectionError';
    this.code = 'builder_draft_checkpoint_status_projection_invalid';
    this.retryable = false;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderDraftCheckpointStatusProjectionError();
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
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== keys.length
    || actual.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) fail();
  for (const key of actual) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  }
}

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  return descriptor.value;
}

function safeDigest(value) {
  if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value)) fail();
  return value;
}

function sanitizeEvidence(value, expectedStatus) {
  exactObject(value, EVIDENCE_KEYS);
  if (
    valueAt(value, 'database_id') !== 'builder-draft-checkpoint-store.v1'
    || valueAt(value, 'schema_version') !== 'builder-draft-checkpoint-store-schema.v1'
    || !Number.isSafeInteger(valueAt(value, 'user_version'))
    || valueAt(value, 'checkpoint_authority') !== 'main_owned_draft_checkpoint_store'
    || valueAt(value, 'checkpoint_contract_authority') !== 'main_draft_checkpoint_contract_v1'
    || valueAt(value, 'renderer_authority') !== 'not_present'
    || valueAt(value, 'ipc_authority') !== 'not_present'
    || valueAt(value, 'conversation_append') !== false
    || valueAt(value, 'provider_dispatch') !== false
    || valueAt(value, 'model_dispatch') !== false
    || valueAt(value, 'source_read') !== 'not_present'
    || valueAt(value, 'source_write') !== 'not_present'
    || valueAt(value, 'git_mutation') !== false
    || valueAt(value, 'permission_grant_authority') !== false
    || valueAt(value, 'review_authority') !== false
    || valueAt(value, 'revision_authority') !== false
    || valueAt(value, 'save_authority') !== false
    || valueAt(value, 'artifact_authority') !== false
    || valueAt(value, 'command_execution') !== false
    || valueAt(value, 'network_access') !== false
    || valueAt(value, 'publication') !== false
    || valueAt(value, 'work_capsule_authority') !== false
    || valueAt(value, 'recovery_model') !== 'idempotent_store_replay'
  ) fail();
  safeDigest(valueAt(value, 'schema_fingerprint_digest'));
  const transaction = valueAt(value, 'transaction');
  if (expectedStatus === 'ready' && !READY_TRANSACTIONS.includes(transaction)) fail();
  if (expectedStatus === 'absent' && !ABSENT_TRANSACTIONS.includes(transaction)) fail();
  return transaction;
}

function sanitizeReadResult(value) {
  exactObject(value, READ_RESULT_KEYS);
  if (
    valueAt(value, 'result_version') !== BUILDER_DRAFT_CHECKPOINT_STORE_READ_RESULT_VERSION
    || valueAt(value, 'checkpoint_authority') !== 'main_owned_draft_checkpoint_store'
  ) fail();
  const status = valueAt(value, 'status');
  if (status !== 'absent' && status !== 'ready') fail();
  const transaction = sanitizeEvidence(valueAt(value, 'checkpoint_evidence'), status);
  const rawEntry = valueAt(value, 'draft_checkpoint');
  if (status === 'absent') {
    if (rawEntry !== null) fail();
    return freezeDeep({ status, checkpoint: null, transaction });
  }
  exactObject(rawEntry, CHECKPOINT_ENTRY_KEYS);
  return freezeDeep({
    status,
    checkpoint: sanitizeBuilderDraftCheckpoint(valueAt(rawEntry, 'draft_checkpoint')),
    transaction,
  });
}

function authority(status) {
  return freezeDeep({
    projection_authority: 'main_owned_draft_checkpoint_status_projection_v1',
    checkpoint_store_read: status === 'ready' ? 'verified_latest_read_result' : 'verified_absent_read_result',
    checkpoint_fact: status === 'ready' ? 'verified_not_exposed' : 'none',
    renderer_authority: 'not_present',
    ipc_authority: 'not_present',
    provider_dispatch: false,
    tool_dispatch: false,
    source_read: 'not_present',
    source_write: 'not_present',
    git_read: 'not_present',
    git_write: false,
    sqlite_write: false,
    permission_grant: false,
    revision_admission: 'not_created',
    save_authority: false,
    publication: false,
  });
}

function assertProjection(value) {
  exactObject(value, PROJECTION_KEYS);
  const status = valueAt(value, 'status');
  if (status !== 'absent' && status !== 'ready') fail();
  const copy = COPY[status];
  if (
    valueAt(value, 'projection_version') !== BUILDER_DRAFT_CHECKPOINT_STATUS_PROJECTION_VERSION
    || valueAt(value, 'label') !== copy.label
    || valueAt(value, 'tone') !== copy.tone
    || valueAt(value, 'next_action_hint') !== copy.next_action_hint
    || valueAt(value, 'can_compare') !== copy.can_compare
    || valueAt(value, 'can_restore') !== copy.can_restore
    || valueAt(value, 'can_save_version') !== copy.can_save_version
  ) fail();
  const changedFileCount = valueAt(value, 'changed_file_count');
  const verificationStatus = valueAt(value, 'verification_status');
  if (status === 'absent') {
    if (changedFileCount !== null || verificationStatus !== null) fail();
  } else if (
    !Number.isSafeInteger(changedFileCount)
    || changedFileCount < 0
    || changedFileCount > 50_000
    || !['candidate_verified', 'candidate_verified_with_warnings'].includes(verificationStatus)
  ) fail();
  const expectedAuthority = authority(status);
  const projectedAuthority = valueAt(value, 'authority');
  exactObject(projectedAuthority, AUTHORITY_KEYS);
  for (const key of AUTHORITY_KEYS) {
    if (valueAt(projectedAuthority, key) !== valueAt(expectedAuthority, key)) fail();
  }
  return value;
}

function projectBuilderDraftCheckpointStatus(rawInput) {
  try {
    exactObject(rawInput, INPUT_KEYS);
    const read = sanitizeReadResult(valueAt(rawInput, 'latest_draft_checkpoint_read_result'));
    const copy = COPY[read.status];
    return freezeDeep(assertProjection({
      projection_version: BUILDER_DRAFT_CHECKPOINT_STATUS_PROJECTION_VERSION,
      status: read.status,
      label: copy.label,
      tone: copy.tone,
      next_action_hint: copy.next_action_hint,
      can_compare: copy.can_compare,
      can_restore: copy.can_restore,
      can_save_version: copy.can_save_version,
      changed_file_count: read.checkpoint === null ? null : read.checkpoint.source_scope.changed_file_count,
      verification_status: read.checkpoint === null ? null : read.checkpoint.verification_summary.status,
      authority: authority(read.status),
    }));
  } catch (error) {
    if (error instanceof BuilderDraftCheckpointStatusProjectionError) throw error;
    fail();
  }
}

function sanitizeBuilderDraftCheckpointStatusProjection(value) {
  try {
    return freezeDeep(assertProjection(value));
  } catch {
    fail();
  }
}

module.exports = freezeDeep({
  BUILDER_DRAFT_CHECKPOINT_STATUS_PROJECTION_VERSION,
  BuilderDraftCheckpointStatusProjectionError,
  projectBuilderDraftCheckpointStatus,
  sanitizeBuilderDraftCheckpointStatusProjection,
});
