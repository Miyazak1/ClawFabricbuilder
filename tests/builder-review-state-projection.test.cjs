'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  BUILDER_REVIEW_STATE_PROJECTION_VERSION,
  BuilderReviewStateProjectionError,
  projectBuilderReviewState,
  sanitizeBuilderReviewStateProjection,
} = require('../electron/builder-review-state-projection.cjs');
const {
  projectBuilderCheckRunStatus,
} = require('../electron/builder-check-run-status-projection.cjs');
const {
  checkRun,
  PROJECT_ID,
} = require('./helpers/builder-check-run-fixture.cjs');
const DRAFT_ID = `builder-generation-draft:${'5'.repeat(64)}`;
const CANDIDATE_ID = `builder-code-change-candidate:${'a'.repeat(64)}`;

function reviewInput(overrides = {}) {
  return {
    candidate_state: 'proposed',
    project_id: PROJECT_ID,
    candidate_id: CANDIDATE_ID,
    draft_id: DRAFT_ID,
    draft_checkpoint_status_projection: checkpointStatus(),
    check_run_state: 'not_run',
    check_run_status_projection: null,
    ...overrides,
  };
}

function checkpointStatus() {
  return {
    projection_version: 'builder-draft-checkpoint-status-projection.v1',
    status: 'ready',
    label: 'Checkpoint saved',
    tone: 'success',
    next_action_hint: 'You can compare, restore, continue, or save a version.',
    can_compare: true,
    can_restore: true,
    can_save_version: true,
    changed_file_count: 4,
    verification_status: 'candidate_verified',
    authority: {
      projection_authority: 'main_owned_draft_checkpoint_status_projection_v1',
      checkpoint_store_read: 'verified_latest_read_result',
      checkpoint_fact: 'verified_not_exposed',
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
    },
  };
}

function projectionError(error) {
  assert.ok(error instanceof BuilderReviewStateProjectionError);
  assert.equal(error.code, 'builder_review_state_projection_invalid');
  assert.doesNotMatch(JSON.stringify(error), /private|credential|sha256|candidate/u);
  return true;
}

test('blocks an unchecked checkpoint without exposing a user-facing check action', () => {
  const result = projectBuilderReviewState(reviewInput());

  assert.equal(result.projection_version, BUILDER_REVIEW_STATE_PROJECTION_VERSION);
  assert.equal(result.draft_id, DRAFT_ID);
  assert.equal(result.status, 'blocked');
  assert.equal(result.changed_file_count, 4);
  assert.equal(result.can_save, false);
  assert.equal(result.can_discard, true);
  assert.deepEqual(result.blocking_reasons, ['check_not_run']);
  assert.equal(result.authority.save_authority, false);
  assert.equal(result.authority.check_evidence, 'verified_absence');
  assert.equal(sanitizeBuilderReviewStateProjection(structuredClone(result)).status, 'blocked');
  assert.doesNotMatch(
    JSON.stringify(result),
    /builder-draft-checkpoint:|builder-code-change-candidate:|builder-task-address:|builder-conversation:|sha256:|candidate_digest|commit_oid|tree_oid|source_tree/iu,
  );
});

test('blocks saving while preserving discard when the checkpoint is missing', () => {
  const result = projectBuilderReviewState(reviewInput({
    draft_checkpoint_status_projection: null,
  }));

  assert.equal(result.status, 'blocked');
  assert.equal(result.checkpoint_status, 'missing');
  assert.equal(result.changed_file_count, null);
  assert.equal(result.can_save, false);
  assert.equal(result.can_discard, true);
  assert.deepEqual(result.blocking_reasons, ['checkpoint_missing', 'check_not_run']);
});

test('projects an explicit skip into a renderer-safe ready Review State', () => {
  const result = projectBuilderReviewState(reviewInput({ check_run_state: 'skipped' }));
  assert.equal(result.status, 'ready');
  assert.equal(result.check_status, 'skipped');
  assert.equal(result.can_save, true);
  assert.deepEqual(result.blocking_reasons, []);
  assert.equal(result.authority.check_evidence, 'verified_explicit_skip_decision');
  assert.equal(
    result.summary,
    'You chose to save this recoverable draft without running a project check.',
  );
});

test('shows current-candidate check evidence and blocks save after failed or incomplete checks', () => {
  const passed = projectBuilderReviewState(reviewInput({
    check_run_state: 'completed',
    check_run_status_projection: projectBuilderCheckRunStatus({ check_run: checkRun('passed') }),
  }));
  assert.equal(passed.status, 'ready');
  assert.equal(passed.check_status, 'passed');
  assert.equal(passed.can_save, true);
  assert.equal(passed.summary, 'A recoverable draft is checked and ready to inspect and save.');
  assert.equal(passed.authority.check_evidence, 'verified_current_candidate_check_projection');

  for (const [terminalStatus, expectedStatus, reason] of [
    ['failed', 'failed', 'check_failed'],
    ['timed_out', 'incomplete', 'check_incomplete'],
  ]) {
    const result = projectBuilderReviewState(reviewInput({
      check_run_state: 'completed',
      check_run_status_projection: projectBuilderCheckRunStatus({
        check_run: checkRun(terminalStatus),
      }),
    }));
    assert.equal(result.status, 'blocked');
    assert.equal(result.check_status, expectedStatus);
    assert.equal(result.can_save, false);
    assert.deepEqual(result.blocking_reasons, [reason]);
    assert.equal(result.changed_file_count, 4);
  }
});

test('blocks save while checks run or their status cannot be verified', () => {
  for (const [state, status, reason, evidence] of [
    ['running', 'running', 'check_running', 'main_owned_candidate_activity_registry'],
    ['unavailable', 'unavailable', 'check_unavailable', 'status_unavailable'],
  ]) {
    const result = projectBuilderReviewState(reviewInput({ check_run_state: state }));
    assert.equal(result.status, 'blocked');
    assert.equal(result.check_status, status);
    assert.equal(result.can_save, false);
    assert.deepEqual(result.blocking_reasons, [reason]);
    assert.equal(result.authority.check_evidence, evidence);
  }
});

test('rejects a valid CheckRun projection from a different candidate or project', () => {
  const projection = projectBuilderCheckRunStatus({ check_run: checkRun() });
  assert.throws(() => projectBuilderReviewState(reviewInput({
    candidate_id: `builder-code-change-candidate:${'f'.repeat(64)}`,
    check_run_state: 'completed',
    check_run_status_projection: projection,
  })), projectionError);
  assert.throws(() => projectBuilderReviewState(reviewInput({
    project_id: 'builder-project:223e4567-e89b-42d3-a456-426614174000',
    check_run_state: 'completed',
    check_run_status_projection: projection,
  })), projectionError);
});

test('fails closed on forged checkpoint capability, extras, accessors, and proxies', () => {
  const forged = checkpointStatus();
  forged.can_save_version = false;
  assert.throws(() => projectBuilderReviewState(reviewInput({
    draft_checkpoint_status_projection: forged,
  })), projectionError);
  assert.throws(() => projectBuilderReviewState(reviewInput({
    draft_checkpoint_status_projection: null,
    private: true,
  })), projectionError);
  assert.throws(() => projectBuilderReviewState(new Proxy({}, {
    ownKeys() { throw new Error('private-marker'); },
  })), projectionError);
  let getterCalls = 0;
  const accessor = reviewInput();
  delete accessor.draft_checkpoint_status_projection;
  Object.defineProperty(accessor, 'draft_checkpoint_status_projection', {
    enumerable: true,
    get() { getterCalls += 1; return checkpointStatus(); },
  });
  assert.throws(() => projectBuilderReviewState(accessor), projectionError);
  assert.equal(getterCalls, 0);
});

test('source remains a pure projection without save, Git, SQLite, provider, or IPC runtime authority', () => {
  const source = require('node:fs').readFileSync(
    require.resolve('../electron/builder-review-state-projection.cjs'),
    'utf8',
  );
  assert.doesNotMatch(source, /electron|ipcMain|fetch\(|child_process|spawn\(|exec\(|safeStorage/u);
  assert.doesNotMatch(
    source,
    /builder-project-save-authority|builder-git-project-repository|node:sqlite|DatabaseSync/u,
  );
});
