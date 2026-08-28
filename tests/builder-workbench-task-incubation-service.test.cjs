'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  createBuilderWorkbenchMessageStore,
} = require('../electron/builder-workbench-message-store.cjs');
const {
  createBuilderWorkbenchTaskProposalStore,
} = require('../electron/builder-workbench-task-proposal-store.cjs');
const {
  createBuilderSessionTaskAddressStore,
} = require('../electron/builder-session-task-address-store.cjs');
const {
  createBuilderWorkbenchTaskIncubationService,
} = require('../electron/builder-workbench-task-incubation-service.cjs');
const {
  createBuilderWorkbenchTimelineProjection,
} = require('../electron/builder-workbench-timeline-projection.cjs');

const AGENT_ID = 'builder-agent:123e4567-e89b-42d3-a456-426614174000';
const PROJECT_ID = 'builder-project:223e4567-e89b-42d3-a456-426614174000';
const REQUEST_ID = 'builder-workbench-request:323e4567-e89b-42d3-a456-426614174000';
const OWNER_ID = 'builder-user:00000000-0000-4000-8000-000000000001';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'builder-task-incubation-'));
  const proposalPath = path.join(root, 'proposals.sqlite');
  const messageStore = createBuilderWorkbenchMessageStore(path.join(root, 'messages.sqlite'));
  const proposalStore = createBuilderWorkbenchTaskProposalStore(proposalPath);
  const addressStore = createBuilderSessionTaskAddressStore(path.join(root, 'addresses.sqlite'));
  const verified = [];
  const service = createBuilderWorkbenchTaskIncubationService({
    proposal_store: proposalStore,
    message_store: messageStore,
    address_store: addressStore,
    agent_id: AGENT_ID,
    owner_id: OWNER_ID,
    now_ms: () => 1_000,
    async verify_project(projectId) { verified.push(projectId); },
  });
  return {
    root, proposalPath, proposalStore, messageStore, addressStore, service, verified,
    close() {
      proposalStore.close();
      messageStore.close();
      addressStore.close();
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

function proposalRequest() {
  return {
    request_id: REQUEST_ID,
    agent_id: AGENT_ID,
    objective: 'Build a compact focus timer.',
    requested_outcome: 'build',
    execution_mode: 'foreground',
    reason: 'The request needs project scope before Builder work can start.',
  };
}

test('keeps proposal projectless until approval and then materializes one draft task', async () => {
  const state = fixture();
  try {
    const created = state.service.create_proposal(proposalRequest());
    assert.equal(created.operation, 'proposal_created');
    assert.deepEqual(created.authority, {
      project_created: false,
      task_created: false,
      provider_dispatch: false,
      permission_grant: false,
    });
    const projection = createBuilderWorkbenchTimelineProjection({
      message_store: state.messageStore,
      proposal_store: state.proposalStore,
      task_monitor_projection: {
        read_monitor: () => ({ counts: { active: 0 }, tasks: [] }),
      },
    }).read_workbench({ agent_id: AGENT_ID, after_cursor: null, limit: 20 });
    assert.equal(projection.stream.items[0].actions[0].status, 'pending');
    assert.deepEqual(projection.stream.items[0].actions[0].operations, [
      'approve_existing_project', 'reject',
    ]);

    const decided = await state.service.decide_proposal({
      agent_id: AGENT_ID,
      proposal_id: created.proposal.proposal_id,
      operation: 'approve_existing_project',
      project_id: PROJECT_ID,
    });
    assert.equal(decided.operation, 'task_materialized');
    assert.deepEqual(state.verified, [PROJECT_ID]);
    assert.equal(decided.materialization.context_capsule.provider_dispatch, false);
    assert.equal(decided.materialization.context_capsule.permission_grant, false);

    const task = state.addressStore.read_task_address({
      project_id: PROJECT_ID,
      task_address_id: decided.materialization.task_address_id,
    });
    assert.equal(task.status, 'ready');
    assert.equal(task.task_address.task_address.status, 'draft');
    assert.equal(task.task_address.task_address.goal, proposalRequest().objective);

    const replay = await state.service.decide_proposal({
      agent_id: AGENT_ID,
      proposal_id: created.proposal.proposal_id,
      operation: 'approve_existing_project',
      project_id: PROJECT_ID,
    });
    assert.equal(replay.operation, 'task_materialization_replayed');
    assert.equal(replay.materialization.task_address_id, decided.materialization.task_address_id);
  } finally {
    state.close();
  }
});

test('persists rejection without creating a task and restores the decision after reopen', async () => {
  const state = fixture();
  try {
    const created = state.service.create_proposal(proposalRequest());
    const rejected = await state.service.decide_proposal({
      agent_id: AGENT_ID,
      proposal_id: created.proposal.proposal_id,
      operation: 'reject',
      project_id: null,
    });
    assert.equal(rejected.operation, 'proposal_rejected');
    assert.equal(rejected.materialization, null);
    state.proposalStore.close();
    const reopened = createBuilderWorkbenchTaskProposalStore(state.proposalPath);
    const bundle = reopened.read_by_proposal_id({ proposal_id: created.proposal.proposal_id });
    assert.equal(bundle.decision.decision, 'reject');
    assert.equal(bundle.materialization, null);
    reopened.close();
    state.proposalStore = { close() { return false; } };
  } finally {
    state.close();
  }
});

test('resumes deterministic materialization after a crash between approval and task recording', async () => {
  const state = fixture();
  try {
    const created = state.service.create_proposal(proposalRequest());
    const interrupted = createBuilderWorkbenchTaskIncubationService({
      proposal_store: state.proposalStore,
      message_store: state.messageStore,
      address_store: {
        record_session_address: state.addressStore.record_session_address,
        record_task_address() { throw new Error('simulated interruption'); },
      },
      agent_id: AGENT_ID,
      owner_id: OWNER_ID,
      now_ms: () => 1_000,
      async verify_project() {},
    });
    await assert.rejects(interrupted.decide_proposal({
      agent_id: AGENT_ID,
      proposal_id: created.proposal.proposal_id,
      operation: 'approve_existing_project',
      project_id: PROJECT_ID,
    }));
    const resumed = await state.service.decide_proposal({
      agent_id: AGENT_ID,
      proposal_id: created.proposal.proposal_id,
      operation: 'approve_existing_project',
      project_id: PROJECT_ID,
    });
    assert.equal(resumed.operation, 'task_materialized');
    assert.equal(resumed.materialization.project_id, PROJECT_ID);
  } finally {
    state.close();
  }
});
