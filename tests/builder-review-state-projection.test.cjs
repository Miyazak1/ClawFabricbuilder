'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  BUILDER_REVIEW_STATE_PROJECTION_VERSION,
  BuilderReviewStateProjectionError,
  projectBuilderReviewState,
  sanitizeBuilderReviewStateProjection,
} = require('../electron/builder-review-state-projection.cjs');
const DRAFT_ID = `builder-generation-draft:${'5'.repeat(64)}`;

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

test('projects a verified checkpoint into a renderer-safe ready Review State', () => {
  const result = projectBuilderReviewState({
    candidate_state: 'proposed',
    draft_id: DRAFT_ID,
    draft_checkpoint_status_projection: checkpointStatus(),
  });

  assert.equal(result.projection_version, BUILDER_REVIEW_STATE_PROJECTION_VERSION);
  assert.equal(result.draft_id, DRAFT_ID);
  assert.equal(result.status, 'ready');
  assert.equal(result.changed_file_count, 4);
  assert.equal(result.can_save, true);
  assert.equal(result.can_discard, true);
  assert.deepEqual(result.blocking_reasons, []);
  assert.equal(result.authority.save_authority, false);
  assert.equal(sanitizeBuilderReviewStateProjection(structuredClone(result)).status, 'ready');
  assert.doesNotMatch(
    JSON.stringify(result),
    /builder-draft-checkpoint:|builder-code-change-candidate:|builder-task-address:|builder-conversation:|sha256:|candidate_digest|commit_oid|tree_oid|source_tree/iu,
  );
});

test('blocks saving while preserving discard when the checkpoint is missing', () => {
  const result = projectBuilderReviewState({
    candidate_state: 'proposed',
    draft_id: DRAFT_ID,
    draft_checkpoint_status_projection: null,
  });

  assert.equal(result.status, 'blocked');
  assert.equal(result.checkpoint_status, 'missing');
  assert.equal(result.changed_file_count, null);
  assert.equal(result.can_save, false);
  assert.equal(result.can_discard, true);
  assert.deepEqual(result.blocking_reasons, ['checkpoint_missing']);
});

test('fails closed on forged checkpoint capability, extras, accessors, and proxies', () => {
  const forged = checkpointStatus();
  forged.can_save_version = false;
  assert.throws(() => projectBuilderReviewState({
    candidate_state: 'proposed',
    draft_id: DRAFT_ID,
    draft_checkpoint_status_projection: forged,
  }), projectionError);
  assert.throws(() => projectBuilderReviewState({
    candidate_state: 'proposed',
    draft_id: DRAFT_ID,
    draft_checkpoint_status_projection: null,
    private: true,
  }), projectionError);
  assert.throws(() => projectBuilderReviewState(new Proxy({}, {
    ownKeys() { throw new Error('private-marker'); },
  })), projectionError);
  let getterCalls = 0;
  const accessor = { candidate_state: 'proposed' };
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
