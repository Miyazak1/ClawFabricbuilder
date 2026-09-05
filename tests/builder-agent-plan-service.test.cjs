'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createBuilderAgentPlanStore } = require('../electron/builder-agent-plan-store.cjs');
const { createBuilderAgentPlanService, createBuilderAgentPlanTaskObjective } = require('../electron/builder-agent-plan-service.cjs');

const UUID = '123e4567-e89b-42d3-a456-426614174000';
const AGENT_ID = `builder-agent:${UUID}`;
const CONVERSATION_ID = `builder-agent-conversation:${UUID}`;
const TURN_ID = `builder-turn:${UUID}`;
const RUN_ID = `builder-run:${UUID}`;
const MESSAGE_ID = `builder-message:${UUID}`;

function terminal(status = 'succeeded') {
  return {
    agent: { agent_id: AGENT_ID },
    project: { project_id: null },
    conversation: { conversation_id: CONVERSATION_ID },
    ids: { turn_id: TURN_ID, run_id: RUN_ID },
    events: [{
      event_type: 'run_completed',
      payload: {
        turn_id: TURN_ID,
        run_id: RUN_ID,
        terminal_status: status,
        result_kind: status === 'succeeded' ? 'explanation' : 'failure',
        assistant_message: status === 'succeeded' ? { message_id: MESSAGE_ID, text: '# Full plan\n\n1. Implement.\n2. Verify.\n' } : null,
      },
    }],
  };
}

function setup(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'builder-agent-plan-service-'));
  const store = createBuilderAgentPlanStore(path.join(directory, 'plans.sqlite'));
  t.after(() => store.close());
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return createBuilderAgentPlanService({ store, agent_id: AGENT_ID, owner_id: 'owner', now: () => 42 });
}

test('handoff uses the bound source request as context, not the first Markdown heading', (t) => {
  const service = setup(t);
  const artifact = service.record_completed_plan({ context: terminal() }).artifact;
  const conversation = { conversation_id: CONVERSATION_ID, items: [
    { role: 'user', message_kind: 'submitted', turn_id: 'another-turn', message: { text: 'Wrong request.' } },
    { role: 'user', message_kind: 'submitted', turn_id: TURN_ID, message: { text: 'Plan a 3D football blog. Do not write files yet.' } },
  ] };
  const objective = createBuilderAgentPlanTaskObjective({ artifact, conversation });
  assert.match(objective, /^Implement approved Agent Plan v1\. Read the bound full plan/);
  assert.match(objective, /Request context \(excerpt\): Plan a 3D football blog/);
  assert.doesNotMatch(objective, /Full plan|Wrong request/);
  assert.ok(objective.length <= 240);
  assert.equal(createBuilderAgentPlanTaskObjective({ artifact, conversation: null }), objective.split(' Request context')[0]);
  assert.equal(createBuilderAgentPlanTaskObjective({ artifact, conversation: { ...conversation, conversation_id: 'other' } }), objective.split(' Request context')[0]);
  conversation.items[1].message.text = '\u6211\u9700\u8981\u4e00\u4e2a\u8db3\u7403\u535a\u5ba2\u3002'.repeat(100);
  const chinese = createBuilderAgentPlanTaskObjective({ artifact, conversation });
  assert.match(chinese, /^\u5b9e\u65bd\u5df2\u6279\u51c6\u7684 Agent \u8ba1\u5212 v1/);
  assert.ok(chinese.length <= 240);
  assert.ok(chinese.endsWith('...'));
});

test('records only a successful complete Agent Plan and binds approval to it', (t) => {
  const service = setup(t);
  const recorded = service.record_completed_plan({ context: terminal() });
  assert.equal(recorded.operation, 'artifact_recorded');
  assert.equal(recorded.artifact.markdown, '# Full plan\n\n1. Implement.\n2. Verify.');
  assert.equal(recorded.artifact.version, 1);
  assert.equal(service.record_completed_plan({ context: terminal() }).operation, 'artifact_replayed');
  const approved = service.decide({
    agent_plan_id: recorded.artifact.agent_plan_id,
    content_digest: recorded.artifact.content_digest,
    decision: 'approved',
  });
  assert.equal(approved.operation, 'decision_recorded');
  assert.equal(service.read_latest({ agent_id: AGENT_ID, source_conversation_id: CONVERSATION_ID }).decision.decision, 'approved');
});

test('does not turn failed or partial output into an approvable plan', (t) => {
  const service = setup(t);
  assert.throws(() => service.record_completed_plan({ context: terminal('failed') }), { code: 'builder_agent_plan_not_complete' });
  const partial = terminal();
  partial.events = [];
  assert.throws(() => service.record_completed_plan({ context: partial }), { code: 'builder_agent_plan_not_complete' });
});

test('rejects approval of an older plan after a revised version is recorded', (t) => {
  const service = setup(t);
  const first = service.record_completed_plan({ context: terminal() }).artifact;
  const revised = terminal();
  revised.ids = { turn_id: 'builder-turn:223e4567-e89b-42d3-a456-426614174000', run_id: 'builder-run:223e4567-e89b-42d3-a456-426614174000' };
  revised.events[0].payload.turn_id = revised.ids.turn_id;
  revised.events[0].payload.run_id = revised.ids.run_id;
  revised.events[0].payload.assistant_message = {
    message_id: 'builder-message:223e4567-e89b-42d3-a456-426614174000',
    text: '# Revised plan\n\n1. Re-scope.\n2. Verify.',
  };
  const second = service.record_completed_plan({ context: revised }).artifact;
  assert.equal(second.version, 2);
  assert.throws(() => service.decide({
    agent_plan_id: first.agent_plan_id,
    content_digest: first.content_digest,
    decision: 'approved',
  }), { code: 'builder_agent_plan_decision_stale' });
});

test('exposes a full approved plan only through its bound task address', (t) => {
  const service = setup(t);
  const artifact = service.record_completed_plan({ context: terminal() }).artifact;
  service.decide({
    agent_plan_id: artifact.agent_plan_id,
    content_digest: artifact.content_digest,
    decision: 'approved',
  });
  const proposalId = `builder-task-proposal:${UUID}`;
  const taskAddressId = `builder-task-address:${UUID}`;
  service.record_dispatch({ agent_plan_id: artifact.agent_plan_id, proposal_id: proposalId });
  assert.equal(service.read_approved_for_task({ task_address_id: taskAddressId }).status, 'absent');
  service.bind_dispatch_task({ proposal_id: proposalId, task_address_id: taskAddressId });
  const selected = service.read_approved_for_task({ task_address_id: taskAddressId });
  assert.equal(selected.status, 'ready');
  assert.equal(selected.artifact.content_digest, artifact.content_digest);
  assert.equal(selected.artifact.markdown, '# Full plan\n\n1. Implement.\n2. Verify.');
});
