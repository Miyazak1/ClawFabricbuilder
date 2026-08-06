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
  createBuilderWorkingContextState,
} = require('../electron/builder-working-context-state.cjs');
const {
  BUILDER_CONTEXT_STATUS_PROJECTION_VERSION,
  BuilderContextStatusProjectionError,
  projectBuilderContextStatus,
} = require('../electron/builder-context-status-projection.cjs');

const PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174200';
const SESSION_ID = 'builder-session:123e4567-e89b-42d3-a456-426614174201';
const TASK_ADDRESS_ID = 'builder-task-address:123e4567-e89b-42d3-a456-426614174202';
const CONVERSATION_ID = 'builder-conversation:123e4567-e89b-42d3-a456-426614174203';
const TASK_ID = 'builder-task:123e4567-e89b-42d3-a456-426614174204';
const ROUTE_DECISION_ID = 'builder-route-decision:123e4567-e89b-42d3-a456-426614174205';

function digest(char) {
  return `sha256:${char.repeat(64)}`;
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

function sourceRef(overrides = {}) {
  return {
    source_kind: 'task_capsule_update',
    source_digest: digest('a'),
    ...overrides,
  };
}

function stateInput(overrides = {}) {
  return {
    project_id: PROJECT_ID,
    session_id: SESSION_ID,
    task_address_id: TASK_ADDRESS_ID,
    conversation_id: CONVERSATION_ID,
    objective_summary: 'Build a portfolio homepage for a photographer.',
    confirmed_constraints: ['Use a focused gallery.'],
    rejected_constraints: [],
    open_questions: [],
    latest_user_intent: 'Use the direction we discussed.',
    source_refs: [sourceRef()],
    compaction_refs: [],
    handoff_refs: [],
    latest_task_capsule: taskCapsule(),
    approved_plan_ref: null,
    base_revision_ref: null,
    invalidated_by: null,
    updated_at_ms: 1_300,
    ...overrides,
  };
}

function state(overrides = {}) {
  return createBuilderWorkingContextState(stateInput(overrides));
}

function pendingHandoff(overrides = {}) {
  return {
    status: 'absent',
    count: 0,
    first_handoff_id: null,
    ...overrides,
  };
}

function projection(overrides = {}, handoff = pendingHandoff()) {
  return projectBuilderContextStatus({
    working_context_state: state(overrides),
    pending_handoff_packets: handoff,
  });
}

function assertProjectionError(fn) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof BuilderContextStatusProjectionError);
    assert.equal(error.code, 'builder_context_status_projection_invalid');
    assert.equal(error.message, 'Builder context status is unavailable.');
    assert.equal(error.retryable, false);
    assert.equal(error.stack, `${error.name}: ${error.message}`);
    assert.doesNotMatch(
      `${error.name}:${error.message}:${error.stack}`,
      /secret-value|credential|Authorization|Bearer|provider|source_tree|C:\\Users|api[_-]?key|sha256:/iu,
    );
    return true;
  });
}

test('projects executable working context into ordinary renderer-safe status copy', () => {
  const result = projection();

  assert.equal(result.projection_version, BUILDER_CONTEXT_STATUS_PROJECTION_VERSION);
  assert.equal(result.label, 'Ready to execute current direction');
  assert.equal(result.tone, 'success');
  assert.equal(result.next_action_hint, 'You can ask me to make the change.');
  assert.equal(result.has_pending_handoff, false);
  assert.equal(result.pending_handoff_count, 0);
  assert.equal(result.needs_confirmation, false);
  assert.equal(result.can_contextual_execute, true);
  assert.deepEqual(result.authority, {
    projection_authority: 'main_owned_context_status_projection_v1',
    working_context_state: 'verified_not_exposed',
    pending_handoff_packets: 'none',
    renderer_authority: 'not_present',
    ipc_authority: 'not_present',
    provider_dispatch: false,
    tool_dispatch: false,
    source_read: 'not_present',
    source_write: 'not_present',
    git_mutation: false,
    permission_grant: false,
    revision_admission: 'not_created',
    secret_access: 'not_present',
  });
  assert.equal(Object.isFrozen(result), true);
  assert.doesNotMatch(
    JSON.stringify(result),
    /builder-project:|builder-session:|builder-task-address:|builder-conversation:|builder-task:|sha256:|brief|Task Capsule|WorkingContext|source_tree|provider_(?:secret|config|envelope)|credential|commit_oid|tree_oid/iu,
  );
});

test('projects every non-handoff Working Context state into user-language status', () => {
  const cases = [
    [
      'empty',
      {
        objective_summary: null,
        confirmed_constraints: [],
        rejected_constraints: [],
        open_questions: [],
        latest_user_intent: null,
        source_refs: [],
        latest_task_capsule: null,
      },
      ['No direction yet', 'neutral', false, false],
    ],
    [
      'discussing',
      {
        latest_task_capsule: taskCapsule({
          status: 'discussing',
          current_brief: workingBrief({ use_when_instruction_is_contextual: false }),
        }),
      },
      ['Direction updated', 'info', false, false],
    ],
    [
      'stale',
      {
        invalidated_by: {
          source: 'brief_correction',
          route_decision_id: ROUTE_DECISION_ID,
          invalidated_at_ms: 1_260,
        },
        source_refs: [
          sourceRef(),
          sourceRef({ source_kind: 'brief_correction', source_digest: digest('b') }),
        ],
      },
      ['Direction changed', 'warning', true, false],
    ],
    [
      'approved_plan_ready',
      {
        latest_task_capsule: null,
        approved_plan_ref: {
          plan_result_digest: digest('c'),
          conversation_head_digest: digest('d'),
          approved_at_ms: 1_250,
        },
        source_refs: [sourceRef({ source_kind: 'approved_plan', source_digest: digest('c') })],
      },
      ['Using approved plan', 'success', false, true],
    ],
    [
      'needs_clarification',
      {
        latest_task_capsule: null,
        open_questions: ['Should the homepage include pricing?'],
        source_refs: [sourceRef({ source_kind: 'user_message', source_digest: digest('e') })],
      },
      ['Needs confirmation', 'warning', true, false],
    ],
  ];

  for (const [expectedState, input, expected] of cases) {
    const result = projection(input);
    assert.equal(state(input).state, expectedState);
    assert.equal(result.label, expected[0]);
    assert.equal(result.tone, expected[1]);
    assert.equal(result.needs_confirmation, expected[2]);
    assert.equal(result.can_contextual_execute, expected[3]);
  }
});

test('pending handoff overrides the visible chip without adopting or exposing packet ids', () => {
  const result = projection({}, {
    status: 'pending',
    count: 2,
    first_handoff_id: `builder-handoff-packet:${'1'.repeat(64)}`,
  });

  assert.equal(result.label, 'Handoff received');
  assert.equal(result.tone, 'warning');
  assert.equal(result.next_action_hint, 'Review the handoff before the next change.');
  assert.equal(result.has_pending_handoff, true);
  assert.equal(result.pending_handoff_count, 2);
  assert.equal(result.needs_confirmation, true);
  assert.equal(result.can_contextual_execute, false);
  assert.equal(result.authority.pending_handoff_packets, 'pending_count_only');
  assert.doesNotMatch(JSON.stringify(result), /builder-handoff-packet|111111|sha256:/u);
});

test('fails closed for malformed state, pending handoff shape, accessors, and proxies', () => {
  assertProjectionError(() => projectBuilderContextStatus({
    working_context_state: {
      ...structuredClone(state()),
      private_marker: 'secret-value',
    },
    pending_handoff_packets: pendingHandoff(),
  }));
  assertProjectionError(() => projectBuilderContextStatus({
    working_context_state: structuredClone(state()),
    pending_handoff_packets: {
      status: 'pending',
      count: 0,
      first_handoff_id: null,
    },
  }));
  assertProjectionError(() => projectBuilderContextStatus({
    working_context_state: structuredClone(state()),
    pending_handoff_packets: {
      status: 'absent',
      count: 1,
      first_handoff_id: `builder-handoff-packet:${'1'.repeat(64)}`,
    },
  }));

  const accessor = {
    working_context_state: structuredClone(state()),
    pending_handoff_packets: pendingHandoff(),
  };
  Object.defineProperty(accessor, 'working_context_state', {
    enumerable: true,
    get() { throw new Error('secret-value'); },
  });
  assertProjectionError(() => projectBuilderContextStatus(accessor));
  assertProjectionError(() => projectBuilderContextStatus(new Proxy({
    working_context_state: structuredClone(state()),
    pending_handoff_packets: pendingHandoff(),
  }, {})));
});

test('source boundary stays a pure renderer-safe context status projection', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-context-status-projection.cjs'),
    'utf8',
  );

  assert.match(source, /builder-context-status-projection\.v1/u);
  assert.match(source, /Ready to execute current direction/u);
  assert.match(source, /Handoff received/u);
  assert.match(source, /verified_not_exposed/u);
  assert.match(source, /pending_count_only/u);
  assert.doesNotMatch(source, /Brief mode|Task Capsule|WorkingBrief/u);
  assert.doesNotMatch(
    source,
    /node:sqlite|node:fs|require\(['"]fs['"]\)|ipcMain|ipcRenderer|contextBridge|BrowserWindow|safeStorage|builder-provider|builder-git|fetch\s*\(|https?:|Authorization|Bearer|execFile|spawn\s*\(|writeFile|readFile|createReadStream|eval\s*\(|new Function|shell:\s*true|record_grant|provider_secret|credential_secret|commit_oid|tree_oid|stdout|stderr|file_content|source_tree|local-provider-executor|chat_planner|ChatCreatePage|Canvas|JobMeta/iu,
  );
});
