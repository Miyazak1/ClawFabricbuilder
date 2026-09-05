'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  READ_AGENT_WORKBENCH_CHANNEL,
  UPDATE_WORKBENCH_MESSAGE_STATE_CHANNEL,
  CONTROL_WORKBENCH_TASK_CHANNEL,
  DECIDE_AGENT_PLAN_CHANNEL,
  BuilderWorkbenchIpcError,
  createBuilderWorkbenchIpcAdapter,
} = require('../electron/builder-workbench-ipc-adapter.cjs');

const AGENT_ID = 'builder-agent:123e4567-e89b-42d3-a456-426614174000';
const MESSAGE_ID = 'builder-message:223e4567-e89b-42d3-a456-426614174000';

function fixture() {
  const sender = {};
  const calls = [];
  const adapter = createBuilderWorkbenchIpcAdapter({
    readWorkbench(request) {
      calls.push(['read', request]);
      return {
        projection_version: 'builder-agent-workbench-projection.v2',
        agent_id: request.agent_id,
        stream: { items: [], after_cursor: null, next_cursor: null, has_more: false },
        task_monitor: {
          projection_version: 'builder-workbench-task-monitor.v2',
          agent_id: request.agent_id,
          tasks: [],
          counts: { active: 0, attention: 0, recent: 0 },
          authority: {},
        },
        inbox: { unread_count: 0, action_required_count: 0, mention_count: 0, active_task_count: 0 },
        authority: {
          canonical_messages: 'main_owned_workbench_message_store',
          user_state: 'main_owned_workbench_message_state_store',
          task_state: 'sqlite_canonical_event_replay_plus_task_attention',
          renderer_authority: 'selection_and_bounded_state_requests_only',
          plugin_payload_exposure: 'not_exposed',
          permission_grant: false,
          provider_dispatch: false,
          source_read: false,
          source_write: false,
        },
      };
    },
    updateMessageState(request) {
      calls.push(['update', request]);
      return { operation: 'message_state_updated' };
    },
    createTaskProposal(request) {
      calls.push(['create-proposal', request]);
      return { operation: 'proposal_created' };
    },
    decideTaskProposal(request) {
      calls.push(['decide-proposal', request]);
      return { operation: 'task_materialized' };
    },
    decideAgentPlan(request) {
      calls.push(['decide-agent-plan', request]);
      return { operation: 'decision_recorded' };
    },
    controlTask(request) {
      calls.push(['control-task', request]);
      return { operation: 'cancel_requested' };
    },
    mainWindowRef() {
      return { webContents: sender, isDestroyed: () => false };
    },
  });
  return { adapter, calls, sender };
}

test('reads the bounded Workbench projection for the active renderer', async () => {
  const { adapter, calls, sender } = fixture();
  assert.equal(adapter.channels.read.channel, READ_AGENT_WORKBENCH_CHANNEL);
  const result = await adapter.channels.read.invoke({ sender }, {
    agent_id: AGENT_ID,
    after_cursor: null,
    limit: 100,
  });
  assert.equal(result.agent_id, AGENT_ID);
  assert.deepEqual(calls, [['read', {
    agent_id: AGENT_ID,
    after_cursor: null,
    limit: 100,
  }]]);
  assert.equal(adapter.authority.plugin_payload_exposure, false);
});

test('binds Agent Plan decisions to the exact persisted digest', async () => {
  const { adapter, calls, sender } = fixture();
  assert.equal(adapter.channels.decideAgentPlan.channel, DECIDE_AGENT_PLAN_CHANNEL);
  const request = {
    agent_id: AGENT_ID,
    agent_plan_id: 'builder-agent-plan:323e4567-e89b-42d3-a456-426614174000',
    content_digest: `sha256:${'a'.repeat(64)}`,
    decision: 'approved',
  };
  await adapter.channels.decideAgentPlan.invoke({ sender }, request);
  assert.deepEqual(calls, [['decide-agent-plan', request]]);
  await assert.rejects(
    adapter.channels.decideAgentPlan.invoke({ sender }, { ...request, content_digest: 'sha256:bad' }),
    { code: 'builder_workbench_invalid' },
  );
});

test('allows only bounded message-state requests', async () => {
  const { adapter, calls, sender } = fixture();
  assert.equal(
    adapter.channels.updateMessageState.channel,
    UPDATE_WORKBENCH_MESSAGE_STATE_CHANNEL,
  );
  const result = await adapter.channels.updateMessageState.invoke({ sender }, {
    agent_id: AGENT_ID,
    message_id: MESSAGE_ID,
    operation: 'mark_read',
  });
  assert.deepEqual(result, { operation: 'message_state_updated' });
  assert.deepEqual(calls[0], ['update', {
    agent_id: AGENT_ID,
    message_id: MESSAGE_ID,
    operation: 'mark_read',
  }]);
  await assert.rejects(
    adapter.channels.updateMessageState.invoke({ sender }, {
      agent_id: AGENT_ID,
      message_id: MESSAGE_ID,
      operation: 'grant_permission',
    }),
    (error) => error instanceof BuilderWorkbenchIpcError
      && error.code === 'builder_workbench_invalid',
  );
});

test('admits only explicit task-proposal creation and decisions', async () => {
  const { adapter, calls, sender } = fixture();
  const proposalId = 'builder-task-proposal:323e4567-e89b-42d3-a456-426614174000';
  const projectId = 'builder-project:423e4567-e89b-42d3-a456-426614174000';
  await adapter.channels.createTaskProposal.invoke({ sender }, {
    request_id: 'builder-workbench-request:523e4567-e89b-42d3-a456-426614174000',
    agent_id: AGENT_ID,
    objective: 'Build a compact focus timer.',
    requested_outcome: 'build',
    execution_mode: 'foreground',
    reason: 'Project scope is required.',
  });
  await adapter.channels.decideTaskProposal.invoke({ sender }, {
    agent_id: AGENT_ID,
    proposal_id: proposalId,
    operation: 'approve_existing_project',
    project_id: projectId,
  });
  assert.equal(calls[0][0], 'create-proposal');
  assert.deepEqual(calls[1], ['decide-proposal', {
    agent_id: AGENT_ID,
    proposal_id: proposalId,
    operation: 'approve_existing_project',
    project_id: projectId,
  }]);
  await assert.rejects(
    adapter.channels.decideTaskProposal.invoke({ sender }, {
      agent_id: AGENT_ID,
      proposal_id: proposalId,
      operation: 'reject',
      project_id: projectId,
    }),
    (error) => error instanceof BuilderWorkbenchIpcError
      && error.code === 'builder_workbench_invalid',
  );
});

test('admits only identity-bound task cancellation requests', async () => {
  const { adapter, calls, sender } = fixture();
  const request = {
    agent_id: AGENT_ID,
    project_id: 'builder-project:423e4567-e89b-42d3-a456-426614174000',
    task_address_id: 'builder-task-address:623e4567-e89b-42d3-a456-426614174000',
    operation: 'cancel_task',
  };
  assert.equal(adapter.channels.controlTask.channel, CONTROL_WORKBENCH_TASK_CHANNEL);
  assert.deepEqual(await adapter.channels.controlTask.invoke({ sender }, request), {
    operation: 'cancel_requested',
  });
  assert.deepEqual(calls[0], ['control-task', request]);
  await assert.rejects(
    adapter.channels.controlTask.invoke({ sender }, { ...request, operation: 'pause_task' }),
    (error) => error instanceof BuilderWorkbenchIpcError
      && error.code === 'builder_workbench_invalid',
  );
  await assert.rejects(
    adapter.channels.controlTask.invoke({ sender }, { ...request, request_id: `sha256:${'a'.repeat(64)}` }),
    (error) => error instanceof BuilderWorkbenchIpcError
      && error.code === 'builder_workbench_invalid',
  );
});

test('rejects stale renderers, extra fields, accessors, and invalid cursors', async () => {
  const { adapter, sender } = fixture();
  await assert.rejects(
    adapter.channels.read.invoke({ sender: {} }, {
      agent_id: AGENT_ID,
      after_cursor: null,
      limit: 100,
    }),
    (error) => error.code === 'builder_workbench_forbidden',
  );
  for (const request of [
    { agent_id: AGENT_ID, after_cursor: null, limit: 100, raw_payload: true },
    { agent_id: AGENT_ID, after_cursor: 'cursor:1', limit: 100 },
    { agent_id: AGENT_ID, after_cursor: null, limit: 201 },
  ]) {
    await assert.rejects(
      adapter.channels.read.invoke({ sender }, request),
      (error) => error.code === 'builder_workbench_invalid',
    );
  }
  const accessor = Object.create(null);
  Object.defineProperty(accessor, 'agent_id', { enumerable: true, get: () => AGENT_ID });
  Object.defineProperty(accessor, 'after_cursor', { enumerable: true, value: null });
  Object.defineProperty(accessor, 'limit', { enumerable: true, value: 100 });
  await assert.rejects(
    adapter.channels.read.invoke({ sender }, accessor),
    (error) => error.code === 'builder_workbench_invalid',
  );
});
