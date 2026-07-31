'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  BUILDER_BUILD_CONTEXT_SNAPSHOT_VERSION,
  BuilderBuildContextSnapshotError,
  createBuilderBuildContextSnapshot,
  sanitizeBuilderBuildContextSnapshot,
} = require('../electron/builder-build-context-snapshot.cjs');

function routeContext(overrides = {}) {
  return {
    route: overrides.route ?? 'build',
    dispatch: overrides.dispatch ?? 'build',
    confidence: overrides.confidence ?? 'high',
    matched_signals: overrides.matched_signals ?? ['contextual_build'],
  };
}

function workingBrief(overrides = {}) {
  return {
    brief_version: 'builder-working-brief.v1',
    source: overrides.source ?? 'task_capsule_update',
    latest_user_goal: 'Build the portfolio homepage.',
    assistant_proposal: 'Use a hero, project cards, and a contact section.',
    approved_plan: overrides.approved_plan ?? null,
    use_when_instruction_is_contextual: overrides.use_when_instruction_is_contextual ?? true,
  };
}

function latestPlan(overrides = {}) {
  return {
    state: overrides.state ?? 'approved',
    text: 'Plan: build the approved homepage update.',
  };
}

function conversationBrief(overrides = {}) {
  return {
    context_version: 'builder-conversation-brief.v3',
    selection: 'recent_prior_messages_latest_plan_and_working_brief',
    entries: overrides.entries ?? [],
    latest_plan: Object.hasOwn(overrides, 'latest_plan') ? overrides.latest_plan : null,
    working_brief: Object.hasOwn(overrides, 'working_brief') ? overrides.working_brief : workingBrief(),
  };
}

function create(overrides = {}) {
  return createBuilderBuildContextSnapshot({
    route_context: Object.hasOwn(overrides, 'route_context') ? overrides.route_context : routeContext(),
    conversation_brief: Object.hasOwn(overrides, 'conversation_brief')
      ? overrides.conversation_brief
      : conversationBrief(),
    workspace_basis: overrides.workspace_basis ?? 'selected_project_workspace',
  });
}

function assertSnapshotError(fn) {
  assert.throws(
    fn,
    (error) => error instanceof BuilderBuildContextSnapshotError
      && error.code === 'builder_build_context_snapshot_invalid',
  );
}

test('creates an exact frozen snapshot for task-brief contextual builds', () => {
  const snapshot = create();

  assert.deepEqual(snapshot, {
    snapshot_version: BUILDER_BUILD_CONTEXT_SNAPSHOT_VERSION,
    route: 'build',
    dispatch: 'build',
    confidence: 'high',
    matched_signals: ['contextual_build'],
    execution_basis: 'task_brief',
    workspace_basis: 'selected_project_workspace',
    working_brief: {
      available: true,
      source: 'task_capsule_update',
      contextual_build_ready: true,
    },
    latest_plan: {
      available: false,
      state: 'none',
    },
    permissions: {
      write_project: 'route_required',
      command_execution: 'not_available',
      external_network: 'not_available',
    },
  });
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.matched_signals), true);
  assert.deepEqual(sanitizeBuilderBuildContextSnapshot(structuredClone(snapshot)), snapshot);
});

test('prioritizes approved plan context without exposing plan text', () => {
  const snapshot = create({
    conversation_brief: conversationBrief({
      latest_plan: latestPlan(),
      working_brief: workingBrief({
        source: 'approved_plan',
        approved_plan: latestPlan(),
      }),
    }),
  });

  assert.equal(snapshot.execution_basis, 'approved_plan');
  assert.deepEqual(snapshot.latest_plan, {
    available: true,
    state: 'approved',
  });
  assert.deepEqual(snapshot.working_brief, {
    available: true,
    source: 'approved_plan',
    contextual_build_ready: true,
  });
  assert.doesNotMatch(JSON.stringify(snapshot), /Plan:|homepage update|Build the portfolio|project cards/u);
});

test('keeps read-only and missing-route snapshots not admitted', () => {
  const readOnly = create({
    route_context: routeContext({
      route: 'answer',
      dispatch: 'reply',
      confidence: 'high',
      matched_signals: ['read_only'],
    }),
    conversation_brief: conversationBrief({ working_brief: null }),
    workspace_basis: 'new_project_request',
  });
  assert.equal(readOnly.execution_basis, 'not_admitted');
  assert.equal(readOnly.permissions.write_project, 'not_required_by_route');
  assert.deepEqual(readOnly.working_brief, {
    available: false,
    source: null,
    contextual_build_ready: false,
  });

  const unknown = create({
    route_context: null,
    conversation_brief: conversationBrief({ working_brief: null }),
  });
  assert.equal(unknown.route, 'unknown');
  assert.equal(unknown.dispatch, 'unknown');
  assert.equal(unknown.execution_basis, 'not_admitted');
});

test('marks contextual build phrases without a brief as missing context', () => {
  const snapshot = create({
    route_context: routeContext({ matched_signals: ['contextual_build_phrase'] }),
    conversation_brief: conversationBrief({
      latest_plan: null,
      working_brief: null,
    }),
  });

  assert.equal(snapshot.execution_basis, 'missing_context_not_admitted');
  assert.deepEqual(snapshot.working_brief, {
    available: false,
    source: null,
    contextual_build_ready: false,
  });
});

test('fails closed on extras, hostile shapes, private signals, and forged capabilities', () => {
  assertSnapshotError(() => create({
    route_context: { ...routeContext(), route_decision_id: 'builder-route-decision:private' },
  }));
  assertSnapshotError(() => create({
    route_context: routeContext({ matched_signals: ['provider:deepseek'] }),
  }));
  assertSnapshotError(() => create({
    route_context: new Proxy(routeContext(), {}),
  }));
  assertSnapshotError(() => create({
    conversation_brief: { ...conversationBrief(), source_tree: { files: [] } },
  }));

  const accessor = conversationBrief();
  Object.defineProperty(accessor, 'working_brief', {
    enumerable: true,
    get() { throw new Error('private getter'); },
  });
  assertSnapshotError(() => create({ conversation_brief: accessor }));

  assertSnapshotError(() => sanitizeBuilderBuildContextSnapshot({
    ...create(),
    permissions: {
      write_project: 'route_required',
      command_execution: 'allowed',
      external_network: 'not_available',
    },
  }));
  assertSnapshotError(() => sanitizeBuilderBuildContextSnapshot({
    ...create({
      route_context: routeContext({
        route: 'answer',
        dispatch: 'reply',
        matched_signals: ['read_only'],
      }),
      conversation_brief: conversationBrief({ working_brief: null }),
    }),
    execution_basis: 'explicit_instruction',
  }));
  assertSnapshotError(() => sanitizeBuilderBuildContextSnapshot({
    ...create({
      route_context: routeContext({
        matched_signals: ['clear_build'],
      }),
      conversation_brief: conversationBrief({ working_brief: null }),
    }),
    execution_basis: 'task_brief',
  }));
  assertSnapshotError(() => sanitizeBuilderBuildContextSnapshot({
    ...create({
      route_context: routeContext({
        matched_signals: ['clear_build'],
      }),
      conversation_brief: conversationBrief({ working_brief: null }),
    }),
    execution_basis: 'not_admitted',
  }));
});

test('source remains a pure main-side contract with no renderer, provider, Git, or execution authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-build-context-snapshot.cjs'),
    'utf8',
  );

  assert.match(source, /builder-build-context-snapshot\.v1/u);
  assert.match(source, /not_available/u);
  assert.doesNotMatch(
    source,
    /ipcMain|ipcRenderer|contextBridge|BrowserWindow|safeStorage|fetch\s*\(|https?:|provider|credential|api[_-]?key|Bearer|git_candidate_receipt|commit_oid|tree_oid|source_tree|permission_id|permission_admission_receipt|run_command|child_process|execFile|spawn/u,
  );
});
