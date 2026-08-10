'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createBuilderApprovedPlanContinuationAdmission,
} = require('../electron/builder-approved-plan-continuation-admission.cjs');
const {
  BuilderExecutionApprovalError,
  createBuilderExecutionApproval,
  sanitizeBuilderExecutionApproval,
} = require('../electron/builder-execution-approval.cjs');
const {
  BuilderProgrammingRunAdmissionError,
  createBuilderProgrammingRunAdmission,
  sanitizeBuilderProgrammingRunAdmission,
} = require('../electron/builder-programming-run-admission.cjs');
const {
  createBuilderProjectSourceTree,
} = require('../electron/builder-project-source-tree.cjs');
const {
  builderProjectUnderstandingSnapshotDigest,
  createBuilderProjectUnderstandingSnapshot,
} = require('../electron/builder-project-understanding.cjs');
const {
  createBuilderRunContextSnapshot,
} = require('../electron/builder-run-context-snapshot.cjs');

const PROJECT_UUID = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = `builder-project:${PROJECT_UUID}`;
const CONVERSATION_ID = `builder-conversation:${PROJECT_UUID}`;
const PLAN_TURN_ID = 'builder-turn:22222222-2222-4222-8222-222222222222';
const PLAN_TASK_ID = 'builder-task:33333333-3333-4333-8333-333333333333';
const PLAN_RUN_ID = 'builder-run:44444444-4444-4444-8444-444444444444';
const TURN_ID = 'builder-turn:55555555-5555-4555-8555-555555555555';
const TASK_ID = 'builder-task:66666666-6666-4666-8666-666666666666';
const RUN_ID = 'builder-run:77777777-7777-4777-8777-777777777777';
const MESSAGE_ID = 'builder-message:88888888-8888-4888-8888-888888888888';
const SOURCE_TREE = createBuilderProjectSourceTree({
  files: [{ path: 'index.html', content: '<main>Before</main>\n' }],
});

function continuation() {
  return createBuilderApprovedPlanContinuationAdmission({
    approved_plan: {
      result_version: 'builder-conversation-approved-plan-read-result.v1',
      project_id: PROJECT_ID,
      conversation_id: CONVERSATION_ID,
      turn_id: PLAN_TURN_ID,
      task_id: PLAN_TASK_ID,
      run_id: PLAN_RUN_ID,
      decision: 'approved',
      plan_result_digest: `sha256:${'a'.repeat(64)}`,
      conversation_head: {
        sequence: 7,
        event_id: `builder-conversation-event:${'b'.repeat(64)}`,
        event_digest: `sha256:${'c'.repeat(64)}`,
      },
      authority: {
        conversation: 'sqlite_replay_current_head_verified',
        plan_review: 'approved_current_head',
        renderer_authority: 'not_present',
        provider_dispatch: false,
        tool_dispatch: 'not_performed',
        source_mutation: 'not_performed',
        git_authority: 'not_present',
        revision_admission: 'not_created',
      },
    },
    continuation_id: 'builder-approved-plan-continuation:99999999-9999-4999-8999-999999999999',
    admitted_at_ms: 1_000,
  });
}

function permissionDecision(overrides = {}) {
  return {
    decision_version: 'builder-permission-decision.v1',
    policy_version: 'builder-permission-policy.v1',
    actor_id: 'builder-user:00000000-0000-4000-8000-000000000001',
    action: 'project.edit',
    resource: { resource_kind: 'project', project_id: PROJECT_ID, resource_id: 'project:self' },
    evaluated_at_ms: 1_005,
    decision: 'allowed',
    reason: 'matching_active_grant',
    permission_id: `builder-permission:${'d'.repeat(64)}`,
    permission_authority: 'builder_permission_facts_deny_by_default_v1',
    ui_selection_authority: 'not_permission',
    ...overrides,
  };
}

function understandingRecord() {
  const snapshot = createBuilderProjectUnderstandingSnapshot({
    project_id: PROJECT_ID,
    root_digest: `sha256:${'e'.repeat(64)}`,
    source_tree: SOURCE_TREE,
    previous_successful_check_runs: [],
    updated_at_ms: 1_010,
  });
  return {
    snapshot_digest: builderProjectUnderstandingSnapshotDigest(snapshot),
    project_understanding_snapshot: snapshot,
  };
}

function executionApproval(overrides = {}) {
  return createBuilderExecutionApproval({
    approved_plan_continuation: continuation(),
    write_permission_decision: permissionDecision(),
    provider_config_digest: `sha256:${'f'.repeat(64)}`,
    source_tree_digest: SOURCE_TREE.source_tree_digest,
    project_understanding: understandingRecord(),
    approved_at_ms: 1_020,
    expires_at_ms: 31_020,
    ...overrides,
  });
}

function runContextSnapshot(overrides = {}) {
  return createBuilderRunContextSnapshot({
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    turn_id: TURN_ID,
    run_id: RUN_ID,
    task_id: TASK_ID,
    message_id: MESSAGE_ID,
    route_decision: {
      decision_id: 'builder-route-decision:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      decision_version: 'builder-composer-route-decision.v1',
      project_id: PROJECT_ID,
      message_id: MESSAGE_ID,
      task_id: TASK_ID,
      route: 'build',
      confidence: 'high',
      matched_signals: ['approved_plan_continuation'],
      downgraded_from: null,
      downgrade_reason: null,
      required_permissions: ['write_project'],
      permission_result: 'allowed',
      dispatch: 'build',
      decided_at_ms: 1_021,
    },
    latest_task_capsule: null,
    working_context_state: null,
    project_understanding: understandingRecord(),
    context_assembly: null,
    provider_context_projection: null,
    provider_context_prompt_egress_gate: null,
    base_revision: null,
    created_at_ms: 1_022,
    ...overrides,
  });
}

test('binds an approved plan, current write permission, provider config, and source state', () => {
  const approval = executionApproval();
  assert.equal(approval.approval_version, 'builder-execution-approval.v1');
  assert.equal(approval.project_id, PROJECT_ID);
  assert.equal(approval.approved_plan_task_id, PLAN_TASK_ID);
  assert.equal(approval.approved_subject_digest, `sha256:${'a'.repeat(64)}`);
  assert.equal(approval.source_tree_digest, SOURCE_TREE.source_tree_digest);
  assert.equal(approval.permission_decision_ref.permission_id, `builder-permission:${'d'.repeat(64)}`);
  assert.equal(approval.provider_config_digest, `sha256:${'f'.repeat(64)}`);
  assert.equal(approval.authority.provider_dispatch, false);
  assert.equal(Object.isFrozen(approval), true);
  assert.deepEqual(sanitizeBuilderExecutionApproval(approval), approval);
});

test('fails execution approval closed for denied, cross-project, stale, or forged inputs', () => {
  const invalid = [
    () => executionApproval({ write_permission_decision: permissionDecision({ decision: 'denied' }) }),
    () => executionApproval({
      write_permission_decision: permissionDecision({
        resource: {
          resource_kind: 'project',
          project_id: 'builder-project:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          resource_id: 'project:self',
        },
      }),
    }),
    () => executionApproval({ expires_at_ms: 1_020 }),
    () => sanitizeBuilderExecutionApproval({ ...executionApproval(), provider_config_digest: `sha256:${'0'.repeat(64)}` }),
  ];
  for (const create of invalid) assert.throws(create, BuilderExecutionApprovalError);
});

test('admits exactly the new programming run bound to its run context snapshot', () => {
  const admission = createBuilderProgrammingRunAdmission({
    execution_approval: executionApproval(),
    run_context_snapshot: runContextSnapshot(),
    admitted_at_ms: 1_023,
  });
  assert.equal(admission.admission_version, 'builder-programming-run-admission.v1');
  assert.equal(admission.status, 'admitted');
  assert.equal(admission.project_id, PROJECT_ID);
  assert.equal(admission.turn_id, TURN_ID);
  assert.equal(admission.task_id, TASK_ID);
  assert.equal(admission.run_id, RUN_ID);
  assert.equal(admission.approved_plan_run_id, PLAN_RUN_ID);
  assert.equal(admission.context_snapshot_id, runContextSnapshot().snapshot_id);
  assert.equal(admission.authority.provider_dispatch, true);
  assert.equal(admission.authority.source_mutation, 'not_performed');
  assert.deepEqual(sanitizeBuilderProgrammingRunAdmission(admission), admission);
});

test('fails programming run admission closed on expiry or mismatched run context', () => {
  const invalid = [
    () => createBuilderProgrammingRunAdmission({
      execution_approval: executionApproval(),
      run_context_snapshot: runContextSnapshot(),
      admitted_at_ms: 31_020,
    }),
    () => createBuilderProgrammingRunAdmission({
      execution_approval: executionApproval(),
      run_context_snapshot: runContextSnapshot({ project_understanding: null }),
      admitted_at_ms: 1_023,
    }),
  ];
  for (const create of invalid) assert.throws(create, BuilderProgrammingRunAdmissionError);
});
