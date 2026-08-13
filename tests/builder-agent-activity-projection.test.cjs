'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  BuilderAgentActivityProjectionError,
  projectBuilderAgentActivity,
  sanitizeBuilderAgentActivityProjection,
} = require('../electron/builder-agent-activity-projection.cjs');

const UUID = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = `builder-project:${UUID}`;
const CONVERSATION_ID = `builder-conversation:${UUID}`;
const TURN_ID = 'builder-turn:22222222-2222-4222-8222-222222222222';
const RUN_ID = 'builder-run:33333333-3333-4333-8333-333333333333';

function latestRun(overrides = {}) {
  return {
    turn_id: TURN_ID,
    run_id: RUN_ID,
    status: 'running',
    terminal_status: null,
    result_kind: null,
    route: 'build',
    dispatch: 'build',
    programming_run_admitted: true,
    latest_progress_stage: 'provider_request_started',
    active_tool_action: null,
    control: null,
    plan_review: null,
    candidate_review: null,
    ...overrides,
  };
}

function input(overrides = {}) {
  return {
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    head_sequence: 4,
    active_turn_id: TURN_ID,
    latest_run: latestRun(),
    review_state_projection: null,
    candidate_activity: null,
    ...overrides,
  };
}

function reviewState(overrides = {}) {
  return {
    projection_version: 'builder-review-state-projection.v1',
    draft_id: `builder-generation-draft:${'a'.repeat(64)}`,
    status: 'ready',
    label: 'Ready to review',
    summary: 'A recoverable draft is checked and ready to inspect and save.',
    checkpoint_status: 'ready',
    preview_status: 'not_recorded',
    check_status: 'passed',
    changed_file_count: 3,
    can_save: true,
    can_discard: true,
    blocking_reasons: [],
    authority: {
      projection_authority: 'main_owned_review_state_projection_v1',
      candidate_evidence: 'sqlite_conversation_replay_current_unreviewed_candidate',
      checkpoint_evidence: 'verified_latest_candidate_checkpoint',
      check_evidence: 'verified_current_candidate_check_projection',
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
    },
    ...overrides,
  };
}

test('projects active build phases into plain user-facing work status', () => {
  const reading = projectBuilderAgentActivity(input({
    latest_run: latestRun({ active_tool_action: 'filesystem.read' }),
  }));
  assert.deepEqual(reading.current, {
    phase: 'reading_project',
    status: 'active',
    label: 'Reading project',
    summary: 'Looking through the project files and current context.',
    turn_id: TURN_ID,
    run_id: RUN_ID,
  });

  const editing = projectBuilderAgentActivity(input());
  assert.equal(editing.current.phase, 'editing');
  assert.equal(editing.current.label, 'Changing files');
  assert.equal(editing.authority.consumer_role, 'read_only');
  assert.equal(editing.authority.side_effect_authority, 'none');
});

test('projects plans and permission waits without claiming execution', () => {
  const planning = projectBuilderAgentActivity(input({
    latest_run: latestRun({
      route: 'plan',
      dispatch: 'plan',
      programming_run_admitted: false,
      latest_progress_stage: 'provider_request_started',
    }),
  }));
  assert.equal(planning.current.phase, 'planning');
  assert.equal(planning.current.label, 'Planning');

  const waiting = projectBuilderAgentActivity(input({
    latest_run: latestRun({
      dispatch: 'ask_permission',
      programming_run_admitted: false,
      latest_progress_stage: null,
    }),
  }));
  assert.equal(waiting.current.phase, 'waiting_for_permission');
  assert.equal(waiting.current.status, 'waiting');
});

test('projects terminal plan and review facts into waiting, ready, and blocked states', () => {
  const plan = projectBuilderAgentActivity(input({
    active_turn_id: null,
    latest_run: latestRun({
      status: 'completed',
      terminal_status: 'succeeded',
      result_kind: 'plan',
      route: 'plan',
      dispatch: 'plan',
      programming_run_admitted: false,
      latest_progress_stage: 'result_preparing',
    }),
  }));
  assert.equal(plan.current.phase, 'waiting_for_approval');

  const ready = projectBuilderAgentActivity(input({
    active_turn_id: null,
    latest_run: latestRun({
      status: 'completed',
      terminal_status: 'succeeded',
      result_kind: 'candidate',
      latest_progress_stage: 'result_preparing',
    }),
    review_state_projection: reviewState(),
  }));
  assert.equal(ready.current.phase, 'ready_for_review');
  assert.equal(ready.current.summary, reviewState().summary);

  const notChecked = projectBuilderAgentActivity(input({
    active_turn_id: null,
    latest_run: latestRun({
      status: 'completed',
      terminal_status: 'succeeded',
      result_kind: 'candidate',
      latest_progress_stage: 'result_preparing',
    }),
    review_state_projection: reviewState({
      status: 'blocked',
      label: 'Review not ready',
      summary: 'Builder has not finished checking this draft yet.',
      check_status: 'not_run',
      can_save: false,
      blocking_reasons: ['check_not_run'],
      authority: {
        ...reviewState().authority,
        check_evidence: 'verified_absence',
      },
    }),
  }));
  assert.equal(notChecked.current.phase, 'waiting_for_check');
  assert.equal(notChecked.current.status, 'waiting');
  assert.equal(notChecked.current.label, 'Checks pending');
  assert.equal(notChecked.current.summary, 'Builder has not finished checking this draft yet.');

  const checkRunning = projectBuilderAgentActivity(input({
    active_turn_id: null,
    latest_run: latestRun({
      status: 'completed',
      terminal_status: 'succeeded',
      result_kind: 'candidate',
      latest_progress_stage: 'result_preparing',
    }),
    review_state_projection: reviewState({
      status: 'blocked',
      label: 'Review not ready',
      summary: 'The project check is still running.',
      check_status: 'running',
      can_save: false,
      blocking_reasons: ['check_running'],
      authority: {
        ...reviewState().authority,
        check_evidence: 'main_owned_candidate_activity_registry',
      },
    }),
  }));
  assert.equal(checkRunning.current.phase, 'running_checks');
  assert.equal(checkRunning.current.status, 'active');
  assert.equal(checkRunning.current.label, 'Running checks');
  assert.equal(checkRunning.current.summary, 'The project check is still running.');

  const blocked = projectBuilderAgentActivity(input({
    active_turn_id: null,
    latest_run: latestRun({
      status: 'completed',
      terminal_status: 'succeeded',
      result_kind: 'candidate',
      latest_progress_stage: 'result_preparing',
    }),
    review_state_projection: reviewState({
      status: 'blocked',
      label: 'Review not ready',
      summary: 'The latest project check failed. Review it before saving.',
      check_status: 'failed',
      can_save: false,
      blocking_reasons: ['check_failed'],
    }),
  }));
  assert.equal(blocked.current.phase, 'blocked');
  assert.equal(blocked.current.label, 'Needs attention');
});

test('keeps a retryable failed run blocked while its turn remains active', () => {
  const projection = projectBuilderAgentActivity(input({
    latest_run: latestRun({
      status: 'completed',
      terminal_status: 'failed',
      result_kind: 'failure',
      latest_progress_stage: 'provider_request_started',
    }),
  }));

  assert.equal(projection.current.phase, 'blocked');
  assert.equal(projection.current.status, 'blocked');
  assert.equal(projection.current.turn_id, TURN_ID);
});

test('projects an active candidate check ahead of ready review state', () => {
  const projection = projectBuilderAgentActivity(input({
    active_turn_id: null,
    latest_run: latestRun({
      status: 'completed',
      terminal_status: 'succeeded',
      result_kind: 'candidate',
      latest_progress_stage: 'result_preparing',
    }),
    review_state_projection: reviewState(),
    candidate_activity: 'check_run',
  }));

  assert.equal(projection.current.phase, 'running_checks');
  assert.equal(projection.current.label, 'Running checks');
  assert.equal(projection.current.status, 'active');
});

test('sanitizer accepts exact projections and fails closed on authority or identity changes', () => {
  const projected = projectBuilderAgentActivity(input());
  assert.deepEqual(sanitizeBuilderAgentActivityProjection(projected), projected);
  assert.throws(
    () => sanitizeBuilderAgentActivityProjection({
      ...projected,
      authority: { ...projected.authority, side_effect_authority: 'write' },
    }),
    BuilderAgentActivityProjectionError,
  );
  assert.throws(
    () => projectBuilderAgentActivity({ ...input(), renderer_source_tree: [] }),
    BuilderAgentActivityProjectionError,
  );
});
