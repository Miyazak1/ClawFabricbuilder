'use strict';

const { types: utilTypes } = require('node:util');

const {
  sanitizeBuilderDraftCheckpoint,
} = require('./builder-draft-checkpoint.cjs');

const BUILDER_DRAFT_CHECKPOINT_TIMELINE_PROJECTION_VERSION =
  'builder-draft-checkpoint-timeline-projection.v1';
const BUILDER_DRAFT_CHECKPOINT_STORE_READ_RESULT_VERSION =
  'builder-draft-checkpoint-store-read-result.v1';
const MAX_PROJECTED_CHECKPOINTS = 12;
const INPUT_KEYS = Object.freeze(['checkpoint_list_result', 'current_candidate_id']);
const LIST_RESULT_KEYS = Object.freeze([
  'result_version',
  'checkpoint_authority',
  'status',
  'draft_checkpoints',
  'truncated',
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
  'entries',
  'truncated',
  'authority',
]);
const TIMELINE_ENTRY_KEYS = Object.freeze([
  'checkpoint_sequence',
  'created_at_ms',
  'label',
  'changed_file_count',
  'verification_status',
  'is_current',
]);
const AUTHORITY_KEYS = Object.freeze([
  'projection_authority',
  'checkpoint_store_read',
  'checkpoint_facts',
  'renderer_authority',
  'ipc_authority',
  'provider_dispatch',
  'tool_dispatch',
  'source_read',
  'source_write',
  'git_read',
  'git_write',
  'sqlite_write',
  'restore_authority',
  'revision_admission',
  'save_authority',
  'publication',
]);
const CANDIDATE_ID_PATTERN = /^builder-code-change-candidate:[0-9a-f]{64}$/u;

class BuilderDraftCheckpointTimelineProjectionError extends Error {
  constructor() {
    super('Builder draft checkpoint timeline is unavailable.');
    this.name = 'BuilderDraftCheckpointTimelineProjectionError';
    this.code = 'builder_draft_checkpoint_timeline_projection_invalid';
    this.retryable = false;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderDraftCheckpointTimelineProjectionError();
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

function safeCandidateId(value) {
  if (typeof value !== 'string' || !CANDIDATE_ID_PATTERN.test(value)) fail();
  return value;
}

function safeCheckpointSequence(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 1_000_000) fail();
  return value;
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 8_640_000_000_000_000) fail();
  return value;
}

function sanitizeEvidence(value, status) {
  exactObject(value, EVIDENCE_KEYS);
  if (
    valueAt(value, 'database_id') !== 'builder-draft-checkpoint-store.v1'
    || valueAt(value, 'schema_version') !== 'builder-draft-checkpoint-store-schema.v1'
    || !Number.isSafeInteger(valueAt(value, 'user_version'))
    || !/^sha256:[0-9a-f]{64}$/u.test(valueAt(value, 'schema_fingerprint_digest'))
    || valueAt(value, 'transaction') !== `draft_checkpoints_${status}_read`
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
}

function authority(status) {
  return freezeDeep({
    projection_authority: 'main_owned_draft_checkpoint_timeline_projection_v1',
    checkpoint_store_read: status === 'ready'
      ? 'verified_task_checkpoint_list'
      : 'verified_absent_task_checkpoint_list',
    checkpoint_facts: status === 'ready' ? 'bounded_safe_projection' : 'none',
    renderer_authority: 'not_present',
    ipc_authority: 'not_present',
    provider_dispatch: false,
    tool_dispatch: false,
    source_read: 'not_present',
    source_write: 'not_present',
    git_read: 'not_present',
    git_write: false,
    sqlite_write: false,
    restore_authority: false,
    revision_admission: 'not_created',
    save_authority: false,
    publication: false,
  });
}

function sanitizeListResult(value) {
  exactObject(value, LIST_RESULT_KEYS);
  if (
    valueAt(value, 'result_version') !== BUILDER_DRAFT_CHECKPOINT_STORE_READ_RESULT_VERSION
    || valueAt(value, 'checkpoint_authority') !== 'main_owned_draft_checkpoint_store'
    || typeof valueAt(value, 'truncated') !== 'boolean'
  ) fail();
  const status = valueAt(value, 'status');
  const entries = valueAt(value, 'draft_checkpoints');
  if (
    (status !== 'absent' && status !== 'ready')
    || !Array.isArray(entries)
    || entries.length > 128
    || (status === 'absent') !== (entries.length === 0)
  ) fail();
  sanitizeEvidence(valueAt(value, 'checkpoint_evidence'), status);

  if (status === 'absent') {
    return freezeDeep({ status, checkpoints: [], truncated: valueAt(value, 'truncated') });
  }

  const checkpoints = entries.map((entry) => {
    exactObject(entry, CHECKPOINT_ENTRY_KEYS);
    const checkpoint = sanitizeBuilderDraftCheckpoint(valueAt(entry, 'draft_checkpoint'));
    return checkpoint;
  });
  for (let index = 1; index < checkpoints.length; index += 1) {
    if (checkpoints[index - 1].checkpoint_sequence >= checkpoints[index].checkpoint_sequence) fail();
  }
  return freezeDeep({ status, checkpoints, truncated: valueAt(value, 'truncated') });
}

function assertTimelineEntry(value) {
  exactObject(value, TIMELINE_ENTRY_KEYS);
  safeCheckpointSequence(valueAt(value, 'checkpoint_sequence'));
  safeTimestamp(valueAt(value, 'created_at_ms'));
  if (valueAt(value, 'label') !== 'Automatic checkpoint') fail();
  const changedFileCount = valueAt(value, 'changed_file_count');
  if (!Number.isSafeInteger(changedFileCount) || changedFileCount < 0 || changedFileCount > 50_000) fail();
  if (!['candidate_verified', 'candidate_verified_with_warnings'].includes(
    valueAt(value, 'verification_status'),
  )) fail();
  if (typeof valueAt(value, 'is_current') !== 'boolean') fail();
  return value;
}

function assertProjection(value) {
  exactObject(value, PROJECTION_KEYS);
  if (valueAt(value, 'projection_version') !== BUILDER_DRAFT_CHECKPOINT_TIMELINE_PROJECTION_VERSION) fail();
  const status = valueAt(value, 'status');
  if (status !== 'absent' && status !== 'ready') fail();
  const entries = valueAt(value, 'entries');
  if (!Array.isArray(entries) || entries.length > MAX_PROJECTED_CHECKPOINTS) fail();
  entries.forEach(assertTimelineEntry);
  if (
    (status === 'absent') !== (entries.length === 0)
    || typeof valueAt(value, 'truncated') !== 'boolean'
  ) fail();
  if (status === 'ready' && entries.filter((entry) => entry.is_current).length !== 1) fail();
  for (let index = 1; index < entries.length; index += 1) {
    if (entries[index - 1].checkpoint_sequence <= entries[index].checkpoint_sequence) fail();
  }
  const expectedAuthority = authority(status);
  const projectedAuthority = valueAt(value, 'authority');
  exactObject(projectedAuthority, AUTHORITY_KEYS);
  for (const key of AUTHORITY_KEYS) {
    if (valueAt(projectedAuthority, key) !== valueAt(expectedAuthority, key)) fail();
  }
  return value;
}

function projectBuilderDraftCheckpointTimeline(rawInput) {
  try {
    exactObject(rawInput, INPUT_KEYS);
    const list = sanitizeListResult(valueAt(rawInput, 'checkpoint_list_result'));
    const rawCandidateId = valueAt(rawInput, 'current_candidate_id');
    if (list.status === 'absent') {
      if (rawCandidateId !== null || list.truncated !== false) fail();
      return freezeDeep(assertProjection({
        projection_version: BUILDER_DRAFT_CHECKPOINT_TIMELINE_PROJECTION_VERSION,
        status: 'absent',
        entries: [],
        truncated: false,
        authority: authority('absent'),
      }));
    }

    const currentCandidateId = safeCandidateId(rawCandidateId);
    const current = list.checkpoints.at(-1);
    if (current.candidate_ref.candidate_id !== currentCandidateId) fail();
    const projectedCheckpoints = list.checkpoints.slice(-MAX_PROJECTED_CHECKPOINTS).reverse();
    return freezeDeep(assertProjection({
      projection_version: BUILDER_DRAFT_CHECKPOINT_TIMELINE_PROJECTION_VERSION,
      status: 'ready',
      entries: projectedCheckpoints.map((checkpoint) => ({
        checkpoint_sequence: checkpoint.checkpoint_sequence,
        created_at_ms: checkpoint.created_at_ms,
        label: 'Automatic checkpoint',
        changed_file_count: checkpoint.source_scope.changed_file_count,
        verification_status: checkpoint.verification_summary.status,
        is_current: checkpoint.candidate_ref.candidate_id === currentCandidateId,
      })),
      truncated: list.truncated || list.checkpoints.length > MAX_PROJECTED_CHECKPOINTS,
      authority: authority('ready'),
    }));
  } catch (error) {
    if (error instanceof BuilderDraftCheckpointTimelineProjectionError) throw error;
    fail();
  }
}

function sanitizeBuilderDraftCheckpointTimelineProjection(value) {
  try {
    return freezeDeep(assertProjection(value));
  } catch {
    fail();
  }
}

module.exports = freezeDeep({
  BUILDER_DRAFT_CHECKPOINT_TIMELINE_PROJECTION_VERSION,
  BuilderDraftCheckpointTimelineProjectionError,
  projectBuilderDraftCheckpointTimeline,
  sanitizeBuilderDraftCheckpointTimelineProjection,
});
