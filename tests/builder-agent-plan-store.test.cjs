'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  createBuilderAgentPlanArtifact,
  createBuilderAgentPlanDecision,
} = require('../electron/builder-agent-plan-contract.cjs');
const { createBuilderAgentPlanStore } = require('../electron/builder-agent-plan-store.cjs');

const UUID = '123e4567-e89b-42d3-a456-426614174000';
const PLAN_ID = `builder-agent-plan:${UUID}`;
const AGENT_ID = `builder-agent:${UUID}`;
const CONVERSATION_ID = `builder-agent-conversation:${UUID}`;
const PROPOSAL_ID = `builder-task-proposal:${UUID}`;
const TASK_ADDRESS_ID = `builder-task-address:${UUID}`;

function artifact(overrides = {}) {
  return createBuilderAgentPlanArtifact({
    agent_plan_id: PLAN_ID,
    agent_id: AGENT_ID,
    source_conversation_id: CONVERSATION_ID,
    source_turn_id: `builder-turn:${UUID}`,
    source_run_id: `builder-run:${UUID}`,
    source_message_id: `builder-message:${UUID}`,
    version: 1,
    markdown: '# Plan\n\n1. Build the first slice.\n2. Verify it.',
    created_at_ms: 10,
    ...overrides,
  });
}

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'builder-agent-plan-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return path.join(directory, 'plans.sqlite');
}

test('persists a complete Agent Plan and restores it after restart', (t) => {
  const databasePath = fixture(t);
  const plan = artifact();
  const first = createBuilderAgentPlanStore(databasePath);
  assert.equal(first.record_artifact({ artifact: plan }).operation, 'artifact_recorded');
  assert.equal(first.record_artifact({ artifact: plan }).operation, 'artifact_replayed');
  first.close();

  const restarted = createBuilderAgentPlanStore(databasePath);
  assert.deepEqual(restarted.read({ agent_plan_id: PLAN_ID }), {
    status: 'ready', artifact: plan, decision: null,
  });
  assert.deepEqual(restarted.read_latest({ agent_id: AGENT_ID, source_conversation_id: CONVERSATION_ID }).artifact, plan);
  restarted.close();
});

test('binds approval to the exact plan digest and replays it idempotently', (t) => {
  const store = createBuilderAgentPlanStore(fixture(t));
  const plan = artifact();
  store.record_artifact({ artifact: plan });
  const decision = createBuilderAgentPlanDecision({
    agent_plan_id: PLAN_ID,
    content_digest: plan.content_digest,
    decision: 'approved',
    decided_by: 'builder-user:123e4567-e89b-42d3-a456-426614174001',
    decided_at_ms: 20,
  });
  assert.equal(store.record_decision({ decision }).operation, 'decision_recorded');
  assert.equal(store.record_decision({ decision }).operation, 'decision_replayed');
  assert.deepEqual(store.read({ agent_plan_id: PLAN_ID }).decision, decision);
  assert.throws(() => store.record_decision({
    decision: createBuilderAgentPlanDecision({
      agent_plan_id: PLAN_ID,
      content_digest: `sha256:${'f'.repeat(64)}`,
      decision: 'approved',
      decided_by: 'builder-user:123e4567-e89b-42d3-a456-426614174001',
      decided_at_ms: 20,
    }),
  }), { code: 'builder_agent_plan_store_conflict' });
  store.close();
});

test('rejects conflicting plan identity and a second decision', (t) => {
  const store = createBuilderAgentPlanStore(fixture(t));
  const plan = artifact();
  store.record_artifact({ artifact: plan });
  assert.throws(() => store.record_artifact({
    artifact: artifact({ markdown: '# Different plan' }),
  }), { code: 'builder_agent_plan_store_conflict' });
  const approved = createBuilderAgentPlanDecision({
    agent_plan_id: PLAN_ID,
    content_digest: plan.content_digest,
    decision: 'approved',
    decided_by: 'owner',
    decided_at_ms: 20,
  });
  store.record_decision({ decision: approved });
  assert.throws(() => store.record_decision({
    decision: createBuilderAgentPlanDecision({
      agent_plan_id: PLAN_ID,
      content_digest: plan.content_digest,
      decision: 'rejected',
      decided_by: 'owner',
      decided_at_ms: 21,
    }),
  }), { code: 'builder_agent_plan_store_conflict' });
  store.close();
});

test('persists one approved plan dispatch and resolves it by materialized task after restart', (t) => {
  const databasePath = fixture(t);
  const plan = artifact();
  const first = createBuilderAgentPlanStore(databasePath);
  first.record_artifact({ artifact: plan });
  assert.throws(() => first.record_dispatch({
    agent_plan_id: PLAN_ID,
    proposal_id: PROPOSAL_ID,
  }), { code: 'builder_agent_plan_store_conflict' });
  first.record_decision({ decision: createBuilderAgentPlanDecision({
    agent_plan_id: PLAN_ID,
    content_digest: plan.content_digest,
    decision: 'approved',
    decided_by: 'owner',
    decided_at_ms: 20,
  }) });
  assert.equal(first.record_dispatch({ agent_plan_id: PLAN_ID, proposal_id: PROPOSAL_ID }).operation, 'dispatch_recorded');
  assert.equal(first.record_dispatch({ agent_plan_id: PLAN_ID, proposal_id: PROPOSAL_ID }).operation, 'dispatch_replayed');
  assert.equal(first.bind_dispatch_task({ proposal_id: PROPOSAL_ID, task_address_id: TASK_ADDRESS_ID }).operation, 'dispatch_bound');
  first.close();

  const restarted = createBuilderAgentPlanStore(databasePath);
  const restored = restarted.read_by_task({ task_address_id: TASK_ADDRESS_ID });
  assert.equal(restored.status, 'ready');
  assert.deepEqual(restored.artifact, plan);
  assert.equal(restored.decision.decision, 'approved');
  assert.equal(restarted.bind_dispatch_task({ proposal_id: PROPOSAL_ID, task_address_id: TASK_ADDRESS_ID }).operation, 'dispatch_binding_replayed');
  restarted.close();
});
