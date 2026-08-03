'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  BuilderRunContextSnapshotError,
  createBuilderRunContextSnapshot,
  sanitizeBuilderRunContextSnapshot,
} = require('../electron/builder-run-context-snapshot.cjs');

const UUID = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = `builder-project:${UUID}`;
const CONVERSATION_ID = `builder-conversation:${UUID}`;
const TURN_ID = `builder-turn:${UUID}`;
const TASK_ID = `builder-task:${UUID}`;
const RUN_ID = `builder-run:${UUID}`;
const MESSAGE_ID = `builder-message:${UUID}`;
const BRIEF_MESSAGE_ID = 'builder-message:22222222-2222-4222-8222-222222222222';
const ROUTE_DECISION_ID = `builder-route-decision:${UUID}`;
const BRIEF_ROUTE_DECISION_ID = 'builder-route-decision:22222222-2222-4222-8222-222222222222';
const BASE_REVISION = Object.freeze({
  revision_receipt_digest: `sha256:${'a'.repeat(64)}`,
  commit_oid: 'b'.repeat(40),
});

function routeDecision(overrides = {}) {
  return {
    decision_id: ROUTE_DECISION_ID,
    decision_version: 'builder-composer-route-decision.v1',
    project_id: PROJECT_ID,
    message_id: MESSAGE_ID,
    task_id: TASK_ID,
    route: 'build',
    confidence: 'high',
    matched_signals: ['clear_build'],
    downgraded_from: null,
    downgrade_reason: null,
    required_permissions: ['write_project'],
    permission_result: 'allowed',
    dispatch: 'build',
    decided_at_ms: 7,
    ...overrides,
  };
}

function snapshotInput(overrides = {}) {
  return {
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    turn_id: TURN_ID,
    run_id: RUN_ID,
    task_id: TASK_ID,
    message_id: MESSAGE_ID,
    route_decision: routeDecision(),
    latest_task_capsule: null,
    base_revision: BASE_REVISION,
    created_at_ms: 10,
    ...overrides,
  };
}

function latestTaskCapsule() {
  return {
    message_id: BRIEF_MESSAGE_ID,
    task_capsule: {
      task_id: TASK_ID,
      last_route_decision_id: BRIEF_ROUTE_DECISION_ID,
    },
  };
}

test('creates a digest-bound run context snapshot without private source authority', () => {
  const snapshot = createBuilderRunContextSnapshot(snapshotInput());

  assert.equal(Object.isFrozen(snapshot), true);
  assert.match(snapshot.snapshot_id, /^builder-run-context-snapshot:[0-9a-f]{64}$/u);
  assert.match(snapshot.context_digest, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(snapshot.project_id, PROJECT_ID);
  assert.equal(snapshot.conversation_id, CONVERSATION_ID);
  assert.deepEqual(snapshot.included_message_ids, [MESSAGE_ID]);
  assert.deepEqual(snapshot.route_decision, {
    decision_id: ROUTE_DECISION_ID,
    route: 'build',
    dispatch: 'build',
    matched_signals: ['clear_build'],
    downgraded_from: null,
    downgrade_reason: null,
  });
  assert.deepEqual(snapshot.permissions, {
    required_permissions: ['write_project'],
    permission_result: 'allowed',
    admission_source: 'route_decision',
  });
  assert.deepEqual(sanitizeBuilderRunContextSnapshot(structuredClone(snapshot), {
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    turn_id: TURN_ID,
    run_id: RUN_ID,
    task_id: TASK_ID,
  }), snapshot);
  assert.doesNotMatch(
    JSON.stringify(snapshot),
    /credential|provider|source_tree|prompt|api[_-]?key|git_candidate_receipt|tree_oid|parent_oid/iu,
  );
});

test('keeps safe route downgrade facts in the digest-bound snapshot', () => {
  const snapshot = createBuilderRunContextSnapshot(snapshotInput({
    route_decision: routeDecision({
      route: 'clarify',
      dispatch: 'reply',
      matched_signals: ['clear_build'],
      downgraded_from: 'build',
      downgrade_reason: 'missing_prior_build_context',
      required_permissions: [],
      permission_result: 'not_required',
    }),
  }));

  assert.deepEqual(snapshot.route_decision, {
    decision_id: ROUTE_DECISION_ID,
    route: 'clarify',
    dispatch: 'reply',
    matched_signals: ['clear_build'],
    downgraded_from: 'build',
    downgrade_reason: 'missing_prior_build_context',
  });
  assert.doesNotMatch(JSON.stringify(snapshot.route_decision), /required_permissions|permission_result|confidence|decided_at_ms/iu);
});

test('binds a task capsule source message without including brief text', () => {
  const snapshot = createBuilderRunContextSnapshot(snapshotInput({
    latest_task_capsule: latestTaskCapsule(),
  }));

  assert.deepEqual(snapshot.included_message_ids, [MESSAGE_ID, BRIEF_MESSAGE_ID]);
  assert.deepEqual(snapshot.brief_reference, {
    status: 'task_capsule_update',
    task_id: TASK_ID,
    source_message_id: BRIEF_MESSAGE_ID,
    last_route_decision_id: BRIEF_ROUTE_DECISION_ID,
    contextual_build_ready: true,
  });
  assert.deepEqual(sanitizeBuilderRunContextSnapshot(structuredClone(snapshot), {
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    turn_id: TURN_ID,
    run_id: RUN_ID,
    task_id: TASK_ID,
  }), snapshot);
  assert.doesNotMatch(
    JSON.stringify(snapshot),
    /assistant_proposal|latest_user_goal|current_brief|credential|provider|source_tree|prompt/iu,
  );
});

test('binds snapshot id and digest to the canonical body', () => {
  const snapshot = structuredClone(createBuilderRunContextSnapshot(snapshotInput()));
  snapshot.route_decision.dispatch = 'blocked';

  assert.throws(
    () => sanitizeBuilderRunContextSnapshot(snapshot, {
      project_id: PROJECT_ID,
      conversation_id: CONVERSATION_ID,
      turn_id: TURN_ID,
      run_id: RUN_ID,
      task_id: TASK_ID,
    }),
    BuilderRunContextSnapshotError,
  );
});

test('rejects private route signals, extra fields, and mismatched identity', () => {
  assert.throws(
    () => createBuilderRunContextSnapshot(snapshotInput({
      route_decision: routeDecision({ matched_signals: ['provider:deepseek'] }),
    })),
    BuilderRunContextSnapshotError,
  );
  assert.throws(
    () => createBuilderRunContextSnapshot(snapshotInput({
      route_decision: routeDecision({ downgrade_reason: 'private_marker' }),
    })),
    BuilderRunContextSnapshotError,
  );
  assert.throws(
    () => createBuilderRunContextSnapshot({
      ...snapshotInput(),
      provider_secret: 'private',
    }),
    BuilderRunContextSnapshotError,
  );
  assert.throws(
    () => sanitizeBuilderRunContextSnapshot({
      ...createBuilderRunContextSnapshot(snapshotInput({ latest_task_capsule: latestTaskCapsule() })),
      included_message_ids: [MESSAGE_ID],
    }),
    BuilderRunContextSnapshotError,
  );
  assert.throws(
    () => sanitizeBuilderRunContextSnapshot(
      createBuilderRunContextSnapshot(snapshotInput()),
      {
        project_id: PROJECT_ID,
        conversation_id: CONVERSATION_ID,
        turn_id: TURN_ID,
        run_id: RUN_ID,
        task_id: null,
      },
    ),
    BuilderRunContextSnapshotError,
  );
});
