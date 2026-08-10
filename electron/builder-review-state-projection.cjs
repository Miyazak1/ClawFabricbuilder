'use strict';

const { types: utilTypes } = require('node:util');

const {
  sanitizeBuilderDraftCheckpointStatusProjection,
} = require('./builder-draft-checkpoint-status-projection.cjs');
const {
  sanitizeBuilderCheckRunStatusProjection,
} = require('./builder-check-run-status-projection.cjs');

const BUILDER_REVIEW_STATE_PROJECTION_VERSION = 'builder-review-state-projection.v1';
const INPUT_KEYS = Object.freeze([
  'candidate_state',
  'project_id',
  'candidate_id',
  'draft_id',
  'draft_checkpoint_status_projection',
  'check_run_status_projection',
]);
const PROJECTION_KEYS = Object.freeze([
  'projection_version',
  'draft_id',
  'status',
  'label',
  'summary',
  'checkpoint_status',
  'preview_status',
  'check_status',
  'changed_file_count',
  'can_save',
  'can_discard',
  'blocking_reasons',
  'authority',
]);
const AUTHORITY_KEYS = Object.freeze([
  'projection_authority',
  'candidate_evidence',
  'checkpoint_evidence',
  'check_evidence',
  'renderer_authority',
  'ipc_authority',
  'provider_dispatch',
  'tool_dispatch',
  'source_read',
  'source_write',
  'git_write',
  'sqlite_write',
  'permission_grant',
  'revision_admission',
  'save_authority',
  'publication',
]);
const DRAFT_ID_PATTERN = /^builder-generation-draft:[0-9a-f]{64}$/u;
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const PROJECT_ID_PATTERN = new RegExp(`^builder-project:${UUID_SOURCE}$`, 'u');
const CANDIDATE_ID_PATTERN = /^builder-code-change-candidate:[0-9a-f]{64}$/u;

class BuilderReviewStateProjectionError extends Error {
  constructor() {
    super('Builder review state is unavailable.');
    this.name = 'BuilderReviewStateProjectionError';
    this.code = 'builder_review_state_projection_invalid';
    this.retryable = false;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderReviewStateProjectionError();
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

function safeDraftId(value) {
  if (typeof value !== 'string' || !DRAFT_ID_PATTERN.test(value)) fail();
  return value;
}

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freezeDeep(nested);
    Object.freeze(value);
  }
  return value;
}

function authority(checkpointReady, checkRecorded) {
  return freezeDeep({
    projection_authority: 'main_owned_review_state_projection_v1',
    candidate_evidence: 'sqlite_conversation_replay_current_unreviewed_candidate',
    checkpoint_evidence: checkpointReady
      ? 'verified_latest_candidate_checkpoint'
      : 'missing_or_unverified',
    check_evidence: checkRecorded
      ? 'verified_current_candidate_check_projection'
      : 'not_present',
    renderer_authority: 'not_present',
    ipc_authority: 'projection_only',
    provider_dispatch: false,
    tool_dispatch: false,
    source_read: 'not_present',
    source_write: 'not_present',
    git_write: false,
    sqlite_write: false,
    permission_grant: false,
    revision_admission: 'not_created',
    save_authority: false,
    publication: false,
  });
}

function denseBlockingReasons(value, expectedReasons) {
  if (
    !Array.isArray(value)
    || utilTypes.isProxy(value)
    || Object.getPrototypeOf(value) !== Array.prototype
    || Reflect.ownKeys(value).length !== value.length + 1
  ) fail();
  if (
    value.length !== expectedReasons.length
    || value.some((reason, index) => reason !== expectedReasons[index])
  ) fail();
  return Object.freeze([...expectedReasons]);
}

function reviewCopy(checkpointReady, checkStatus) {
  if (!checkpointReady) {
    return Object.freeze({
      label: 'Review not ready',
      summary: 'Waiting for a verified draft checkpoint before saving.',
    });
  }
  if (checkStatus === 'failed') {
    return Object.freeze({
      label: 'Review not ready',
      summary: 'The latest project check failed. Review it before saving.',
    });
  }
  if (checkStatus === 'incomplete') {
    return Object.freeze({
      label: 'Review not ready',
      summary: 'The latest project check did not finish. Run it again before saving.',
    });
  }
  return Object.freeze({
    label: 'Ready to review',
    summary: checkStatus === 'passed'
      ? 'A recoverable draft is checked and ready to inspect and save.'
      : 'A recoverable draft is ready to inspect and save.',
  });
}

function assertProjection(value) {
  exactObject(value, PROJECTION_KEYS);
  const status = valueAt(value, 'status');
  if (status !== 'ready' && status !== 'blocked') fail();
  const ready = status === 'ready';
  const checkpointStatus = valueAt(value, 'checkpoint_status');
  const checkpointReady = checkpointStatus === 'ready';
  if (!checkpointReady && checkpointStatus !== 'missing') fail();
  const checkStatus = valueAt(value, 'check_status');
  if (!['not_run', 'passed', 'failed', 'incomplete'].includes(checkStatus)) fail();
  const checkBlocksSave = checkStatus === 'failed' || checkStatus === 'incomplete';
  if (ready !== (checkpointReady && !checkBlocksSave)) fail();
  const copy = reviewCopy(checkpointReady, checkStatus);
  const blockingReasons = [];
  if (!checkpointReady) blockingReasons.push('checkpoint_missing');
  if (checkStatus === 'failed') blockingReasons.push('check_failed');
  if (checkStatus === 'incomplete') blockingReasons.push('check_incomplete');
  if (
    valueAt(value, 'projection_version') !== BUILDER_REVIEW_STATE_PROJECTION_VERSION
    || safeDraftId(valueAt(value, 'draft_id')) !== valueAt(value, 'draft_id')
    || valueAt(value, 'label') !== copy.label
    || valueAt(value, 'summary') !== copy.summary
    || valueAt(value, 'preview_status') !== 'not_recorded'
    || valueAt(value, 'can_save') !== ready
    || valueAt(value, 'can_discard') !== true
  ) fail();
  const changedFileCount = valueAt(value, 'changed_file_count');
  if (
    checkpointReady
      ? (!Number.isSafeInteger(changedFileCount) || changedFileCount < 1 || changedFileCount > 50_000)
      : changedFileCount !== null
  ) fail();
  denseBlockingReasons(valueAt(value, 'blocking_reasons'), blockingReasons);
  const projectedAuthority = valueAt(value, 'authority');
  const expectedAuthority = authority(checkpointReady, checkStatus !== 'not_run');
  exactObject(projectedAuthority, AUTHORITY_KEYS);
  for (const key of AUTHORITY_KEYS) {
    if (valueAt(projectedAuthority, key) !== valueAt(expectedAuthority, key)) fail();
  }
  return value;
}

function projectBuilderReviewState(rawInput) {
  try {
    exactObject(rawInput, INPUT_KEYS);
    if (valueAt(rawInput, 'candidate_state') !== 'proposed') fail();
    const projectId = valueAt(rawInput, 'project_id');
    const candidateId = valueAt(rawInput, 'candidate_id');
    if (
      typeof projectId !== 'string'
      || !PROJECT_ID_PATTERN.test(projectId)
      || typeof candidateId !== 'string'
      || !CANDIDATE_ID_PATTERN.test(candidateId)
    ) fail();
    const draftId = safeDraftId(valueAt(rawInput, 'draft_id'));
    const rawCheckpoint = valueAt(rawInput, 'draft_checkpoint_status_projection');
    const checkpoint = rawCheckpoint === null
      ? null
      : sanitizeBuilderDraftCheckpointStatusProjection(rawCheckpoint);
    const rawCheckRun = valueAt(rawInput, 'check_run_status_projection');
    const checkRun = rawCheckRun === null
      ? null
      : sanitizeBuilderCheckRunStatusProjection(rawCheckRun);
    if (
      checkRun !== null
      && (checkRun.project_id !== projectId || checkRun.candidate_id !== candidateId)
    ) fail();
    const checkpointReady = checkpoint?.status === 'ready';
    const checkStatus = checkRun?.status ?? 'not_run';
    const ready = checkpointReady && checkStatus !== 'failed' && checkStatus !== 'incomplete';
    const copy = reviewCopy(checkpointReady, checkStatus);
    const blockingReasons = [];
    if (!checkpointReady) blockingReasons.push('checkpoint_missing');
    if (checkStatus === 'failed') blockingReasons.push('check_failed');
    if (checkStatus === 'incomplete') blockingReasons.push('check_incomplete');
    return freezeDeep(assertProjection({
      projection_version: BUILDER_REVIEW_STATE_PROJECTION_VERSION,
      draft_id: draftId,
      status: ready ? 'ready' : 'blocked',
      label: copy.label,
      summary: copy.summary,
      checkpoint_status: checkpointReady ? 'ready' : 'missing',
      preview_status: 'not_recorded',
      check_status: checkStatus,
      changed_file_count: checkpointReady ? checkpoint.changed_file_count : null,
      can_save: ready,
      can_discard: true,
      blocking_reasons: blockingReasons,
      authority: authority(checkpointReady, checkRun !== null),
    }));
  } catch (error) {
    if (error instanceof BuilderReviewStateProjectionError) throw error;
    fail();
  }
}

function sanitizeBuilderReviewStateProjection(value) {
  try {
    return freezeDeep(assertProjection(value));
  } catch {
    fail();
  }
}

module.exports = freezeDeep({
  BUILDER_REVIEW_STATE_PROJECTION_VERSION,
  BuilderReviewStateProjectionError,
  projectBuilderReviewState,
  sanitizeBuilderReviewStateProjection,
});
