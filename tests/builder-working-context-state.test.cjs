'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  BUILDER_WORKING_BRIEF_VERSION,
  BUILDER_TASK_CAPSULE_VERSION,
} = require('../electron/builder-task-capsule-contract.cjs');
const {
  BUILDER_WORKING_CONTEXT_STATE_VERSION,
  WORKING_CONTEXT_STATE_AUTHORITY,
  BuilderWorkingContextStateError,
  createBuilderWorkingContextState,
  sanitizeBuilderWorkingContextState,
} = require('../electron/builder-working-context-state.cjs');

const PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174200';
const OTHER_PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174299';
const SESSION_ID = 'builder-session:123e4567-e89b-42d3-a456-426614174201';
const TASK_ADDRESS_ID = 'builder-task-address:123e4567-e89b-42d3-a456-426614174202';
const CONVERSATION_ID = 'builder-conversation:123e4567-e89b-42d3-a456-426614174203';
const TASK_ID = 'builder-task:123e4567-e89b-42d3-a456-426614174204';
const ROUTE_DECISION_ID = 'builder-route-decision:123e4567-e89b-42d3-a456-426614174205';

function digest(char) {
  return `sha256:${char.repeat(64)}`;
}

function sourceRef(overrides = {}) {
  return {
    source_kind: 'task_capsule_update',
    source_digest: digest('a'),
    ...overrides,
  };
}

function workingBrief(overrides = {}) {
  return {
    brief_version: BUILDER_WORKING_BRIEF_VERSION,
    source: 'task_capsule_update',
    latest_user_goal: 'Build a portfolio homepage for a photographer.',
    assistant_proposal: 'Use a focused gallery, concise introduction, and contact section.',
    approved_plan: null,
    use_when_instruction_is_contextual: true,
    ...overrides,
  };
}

function taskCapsule(overrides = {}) {
  return {
    capsule_version: BUILDER_TASK_CAPSULE_VERSION,
    task_id: TASK_ID,
    project_id: PROJECT_ID,
    title: 'Portfolio homepage',
    goal: 'Create a polished portfolio homepage from the current discussion.',
    status: 'ready',
    current_brief: workingBrief(),
    last_route_decision_id: ROUTE_DECISION_ID,
    updated_at_ms: 1_200,
    ...overrides,
  };
}

function input(overrides = {}) {
  return {
    project_id: PROJECT_ID,
    session_id: SESSION_ID,
    task_address_id: TASK_ADDRESS_ID,
    conversation_id: CONVERSATION_ID,
    objective_summary: 'Build a portfolio homepage for a photographer.',
    confirmed_constraints: ['Use a focused gallery.', 'Keep the copy concise.'],
    rejected_constraints: [],
    open_questions: [],
    latest_user_intent: 'Use the direction we discussed.',
    source_refs: [sourceRef()],
    latest_task_capsule: taskCapsule(),
    approved_plan_ref: null,
    base_revision_ref: null,
    invalidated_by: null,
    updated_at_ms: 1_300,
    ...overrides,
  };
}

function assertStateError(fn) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof BuilderWorkingContextStateError);
    assert.equal(error.code, 'builder_working_context_state_invalid');
    assert.doesNotMatch(
      `${error.name}:${error.message}:${error.stack}`,
      /secret-value|credential|Authorization|Bearer|provider|source_tree|C:\\Users|api[_-]?key/iu,
    );
    return true;
  });
}

test('creates a deterministic ready Working Context State from a current task capsule', () => {
  const state = createBuilderWorkingContextState(input());
  const sameState = createBuilderWorkingContextState(input());

  assert.deepEqual(state, sameState);
  assert.equal(state.state_version, BUILDER_WORKING_CONTEXT_STATE_VERSION);
  assert.match(state.state_id, /^builder-working-context-state:[0-9a-f]{64}$/u);
  assert.equal(state.state, 'ready');
  assert.equal(state.project_id, PROJECT_ID);
  assert.equal(state.session_id, SESSION_ID);
  assert.equal(state.task_address_id, TASK_ADDRESS_ID);
  assert.equal(state.conversation_id, CONVERSATION_ID);
  assert.equal(state.task_capsule_ref.task_id, TASK_ID);
  assert.equal(state.task_capsule_ref.status, 'ready');
  assert.match(state.task_capsule_ref.update_digest, /^builder-task-capsule-ref:[0-9a-f]{64}$/u);
  assert.deepEqual(state.approved_plan_ref, null);
  assert.deepEqual(state.authority, WORKING_CONTEXT_STATE_AUTHORITY);
  assert.equal(state.authority.working_context_authority, 'main_working_context_state_contract_v1');
  assert.equal(state.authority.context_compaction, 'not_authoritative_for_readiness');
  assert.equal(state.authority.sqlite_write, 'not_performed');
  assert.equal(state.authority.provider_dispatch, 'not_performed');
  assert.equal(state.authority.source_mutation, 'not_performed');
  assert.equal(state.authority.git_mutation, 'not_performed');
  assert.equal(state.authority.permission_grant, 'not_performed');
  assert.equal(Object.isFrozen(state), true);
  assert.equal(Object.isFrozen(state.source_refs), true);
  assert.deepEqual(sanitizeBuilderWorkingContextState(structuredClone(state)), state);
  assert.doesNotMatch(
    JSON.stringify(state),
    /contact section|source_tree|commit_oid|tree_oid|api[_-]?key|secret-value/iu,
  );
});

test('separates approved-plan readiness, stale corrections, and clarification state', () => {
  const approvedPlan = createBuilderWorkingContextState(input({
    latest_task_capsule: null,
    approved_plan_ref: {
      plan_result_digest: digest('b'),
      conversation_head_digest: digest('c'),
      approved_at_ms: 1_250,
    },
    source_refs: [sourceRef({ source_kind: 'approved_plan', source_digest: digest('b') })],
  }));
  assert.equal(approvedPlan.state, 'approved_plan_ready');
  assert.equal(approvedPlan.task_capsule_ref, null);
  assert.equal(approvedPlan.approved_plan_ref.plan_result_digest, digest('b'));

  const stale = createBuilderWorkingContextState(input({
    approved_plan_ref: {
      plan_result_digest: digest('b'),
      conversation_head_digest: digest('c'),
      approved_at_ms: 1_250,
    },
    invalidated_by: {
      source: 'brief_correction',
      route_decision_id: ROUTE_DECISION_ID,
      invalidated_at_ms: 1_260,
    },
    source_refs: [
      sourceRef({ source_kind: 'approved_plan', source_digest: digest('b') }),
      sourceRef({ source_kind: 'brief_correction', source_digest: digest('d') }),
    ],
  }));
  assert.equal(stale.state, 'stale');
  assert.equal(stale.invalidated_by.source, 'brief_correction');

  const needsClarification = createBuilderWorkingContextState(input({
    latest_task_capsule: null,
    approved_plan_ref: null,
    open_questions: ['Should the homepage include pricing?'],
    source_refs: [sourceRef({ source_kind: 'user_message', source_digest: digest('e') })],
  }));
  assert.equal(needsClarification.state, 'needs_clarification');
});

test('keeps compaction summaries separate from execution readiness', () => {
  const compactedOnly = createBuilderWorkingContextState(input({
    objective_summary: null,
    confirmed_constraints: [],
    rejected_constraints: [],
    open_questions: [],
    latest_user_intent: null,
    source_refs: [sourceRef({ source_kind: 'compaction_summary', source_digest: digest('f') })],
    latest_task_capsule: null,
    approved_plan_ref: null,
    invalidated_by: null,
  }));
  assert.equal(compactedOnly.state, 'empty');

  const discussing = createBuilderWorkingContextState(input({
    objective_summary: 'Discussing a possible landing page.',
    confirmed_constraints: [],
    latest_task_capsule: taskCapsule({
      status: 'discussing',
      current_brief: workingBrief({ use_when_instruction_is_contextual: false }),
    }),
    approved_plan_ref: null,
  }));
  assert.equal(discussing.state, 'discussing');
});

test('fails closed on malformed input, stale timestamps, accessors, and forged state output', () => {
  assertStateError(() => createBuilderWorkingContextState({
    ...input(),
    source_tree: { files: [] },
  }));
  assertStateError(() => createBuilderWorkingContextState(input({
    latest_task_capsule: taskCapsule({ project_id: OTHER_PROJECT_ID }),
  })));
  assertStateError(() => createBuilderWorkingContextState(input({
    objective_summary: 'Read C:\\Users\\Admin\\secret.txt',
  })));
  assertStateError(() => createBuilderWorkingContextState(input({
    latest_user_intent: 'api_key: secret-value',
  })));
  assertStateError(() => createBuilderWorkingContextState(input({
    approved_plan_ref: {
      plan_result_digest: digest('b'),
      conversation_head_digest: digest('c'),
      approved_at_ms: 9_999,
    },
  })));
  assertStateError(() => createBuilderWorkingContextState(input({
    approved_plan_ref: {
      plan_result_digest: digest('b'),
      conversation_head_digest: digest('c'),
      approved_at_ms: 1_250,
    },
    open_questions: ['Should this still run?'],
  })));
  assertStateError(() => createBuilderWorkingContextState(new Proxy(input(), {})));

  const accessor = input();
  Object.defineProperty(accessor, 'objective_summary', {
    enumerable: true,
    get() { throw new Error('secret-value'); },
  });
  assertStateError(() => createBuilderWorkingContextState(accessor));

  const ready = createBuilderWorkingContextState(input());
  assertStateError(() => sanitizeBuilderWorkingContextState({
    ...structuredClone(ready),
    state: 'approved_plan_ready',
  }));
  assertStateError(() => sanitizeBuilderWorkingContextState({
    ...structuredClone(ready),
    authority: {
      ...ready.authority,
      provider_dispatch: 'performed',
    },
  }));
  assertStateError(() => sanitizeBuilderWorkingContextState({
    ...structuredClone(ready),
    task_capsule_ref: {
      ...ready.task_capsule_ref,
      update_digest: digest('f'),
    },
  }));
});

test('source remains a pure main-side state contract without runtime authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-working-context-state.cjs'),
    'utf8',
  );

  assert.match(source, /builder-working-context-state\.v1/u);
  assert.match(source, /not_authoritative_for_readiness/u);
  assert.doesNotMatch(
    source,
    /ipcMain|ipcRenderer|contextBridge|BrowserWindow|safeStorage|fetch\s*\(|child_process|execFile|spawn|run_command|CREATE TABLE|INSERT INTO|UPDATE\s+\w+|DELETE FROM/u,
  );
});
