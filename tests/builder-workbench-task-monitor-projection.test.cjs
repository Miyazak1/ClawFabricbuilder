'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  BuilderWorkbenchTaskMonitorProjectionError,
  createBuilderWorkbenchTaskMonitorProjection,
} = require('../electron/builder-workbench-task-monitor-projection.cjs');

const AGENT_ID = 'builder-agent:123e4567-e89b-42d3-a456-426614174002';
const PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174101';

function task(index, title = `Task ${index}`, projectId = PROJECT_ID) {
  const suffix = String(index).padStart(12, '0');
  const projectUuid = projectId.slice('builder-project:'.length);
  return {
    task_address: {
      task_address_id: `builder-task-address:123e4567-e89b-42d3-a456-${suffix}`,
      project_id: projectId,
      conversation_id: `builder-conversation:${projectUuid}:123e4567-e89b-42d3-a456-${suffix}`,
      agent_id: AGENT_ID,
      title,
      goal: `${title} goal`,
      updated_at_ms: index,
    },
  };
}

function stream(record, items) {
  return {
    stream_version: 'builder-task-stream-read-result.v1',
    project_id: record.task_address.project_id,
    conversation: {
      conversation_id: record.task_address.conversation_id,
      created_at_ms: 1_000,
      head_sequence: items.length,
      items,
    },
  };
}

function monitor(records, streams, attentions = new Map(), controls = new Map()) {
  return createBuilderWorkbenchTaskMonitorProjection({
    address_store: {
      list_task_addresses_for_agent() {
        return { status: 'ready', task_addresses: records };
      },
    },
    read_task_stream({ conversation_id: conversationId }) {
      return streams.get(conversationId) ?? null;
    },
    read_task_attention({ task_address_id: taskAddressId }) {
      return attentions.get(taskAddressId) ?? null;
    },
    read_task_controls({ task_address_id: taskAddressId }) {
      return controls.get(taskAddressId) ?? [];
    },
  });
}

test('projects active, attention, and recent tasks from canonical Task streams', () => {
  const working = task(1, 'Working task');
  const review = task(2, 'Review task');
  const done = task(3, 'Saved task');
  const streams = new Map([
    [working.task_address.conversation_id, stream(working, [
      { item_kind: 'run_started', sequence: 1, run_id: 'builder-run:working' },
    ])],
    [review.task_address.conversation_id, stream(review, [
      { item_kind: 'run_started', sequence: 1, run_id: 'builder-run:review' },
      {
        item_kind: 'run_completed', sequence: 2, run_id: 'builder-run:review',
        terminal_status: 'succeeded', result_kind: 'candidate', assistant_message: null,
        candidate: { summary: 'Updated the requested files.' },
      },
    ])],
    [done.task_address.conversation_id, stream(done, [
      { item_kind: 'run_started', sequence: 1, run_id: 'builder-run:done' },
      {
        item_kind: 'run_completed', sequence: 2, run_id: 'builder-run:done',
        terminal_status: 'succeeded', result_kind: 'candidate', assistant_message: null,
        candidate: { summary: 'Completed and verified.' },
      },
      { item_kind: 'candidate_reviewed', sequence: 3, run_id: 'builder-run:done', decision: 'accepted' },
    ])],
  ]);

  const result = monitor(
    [working, review, done],
    streams,
    new Map(),
    new Map([[working.task_address.task_address_id, ['cancel_task']]]),
  ).read_monitor({ agent_id: AGENT_ID });
  assert.deepEqual(result.counts, { active: 1, attention: 1, recent: 1 });
  assert.equal(result.tasks.find((item) => item.title === 'Working task').state, 'working');
  assert.deepEqual(
    result.tasks.find((item) => item.title === 'Working task').operations,
    ['open_task', 'cancel_task'],
  );
  assert.deepEqual(
    result.tasks.find((item) => item.title === 'Saved task').operations,
    ['open_task'],
  );
  assert.equal(result.tasks.find((item) => item.title === 'Review task').state, 'waiting_review');
  assert.equal(result.tasks.find((item) => item.title === 'Saved task').status_label, 'Version saved');
  assert.equal(result.tasks.find((item) => item.title === 'Review task').latest_result.summary, 'Updated the requested files.');
  assert.equal(result.authority.renderer_authority, 'selection_only');
  assert.equal(result.authority.provider_dispatch, false);
});

test('fails closed on invalid agent input and degrades unreadable Task streams to draft', () => {
  const record = task(4);
  const projection = createBuilderWorkbenchTaskMonitorProjection({
    address_store: {
      list_task_addresses_for_agent() { return { status: 'ready', task_addresses: [record] }; },
    },
    read_task_stream() { throw new Error('private failure'); },
  });
  const result = projection.read_monitor({ agent_id: AGENT_ID });
  assert.equal(result.tasks[0].state, 'draft');
  assert.equal(result.tasks[0].group, 'active');
  assert.deepEqual(result.counts, { active: 1, attention: 0, recent: 0 });
  assert.throws(
    () => projection.read_monitor({ agent_id: 'invalid' }),
    BuilderWorkbenchTaskMonitorProjectionError,
  );
});

test('treats a durable absent attention result as no attention', () => {
  const record = task(7, 'No attention task');
  const result = createBuilderWorkbenchTaskMonitorProjection({
    address_store: {
      list_task_addresses_for_agent() { return { status: 'ready', task_addresses: [record] }; },
    },
    read_task_stream() { return null; },
    read_task_attention() { return { status: 'absent', attention: null }; },
  }).read_monitor({ agent_id: AGENT_ID });

  assert.equal(result.tasks[0].state, 'draft');
  assert.equal(result.tasks[0].attention, null);
});

test('scopes result synchronization reads to one project without weakening full monitor reads', () => {
  const otherProjectId = 'builder-project:123e4567-e89b-42d3-a456-426614174202';
  const current = task(9, 'Current project task');
  const other = task(10, 'Other project task', otherProjectId);
  const reads = [];
  const projection = createBuilderWorkbenchTaskMonitorProjection({
    address_store: {
      list_task_addresses_for_agent() {
        return { status: 'ready', task_addresses: [current, other] };
      },
    },
    read_task_stream(request) {
      reads.push(request);
      return null;
    },
  });

  const scoped = projection.read_monitor({ agent_id: AGENT_ID, project_id: PROJECT_ID });
  assert.deepEqual(scoped.tasks.map((item) => item.title), ['Current project task']);
  assert.deepEqual(reads.map((request) => request.project_id), [PROJECT_ID]);

  reads.length = 0;
  const full = projection.read_monitor({ agent_id: AGENT_ID });
  assert.equal(full.tasks.length, 2);
  assert.deepEqual(reads.map((request) => request.project_id), [otherProjectId]);
  reads.length = 0;
  projection.invalidate_monitor({ agent_id: AGENT_ID, project_id: PROJECT_ID });
  projection.read_monitor({ agent_id: AGENT_ID });
  assert.deepEqual(reads.map((request) => request.project_id), [PROJECT_ID]);
  assert.throws(
    () => projection.read_monitor({ agent_id: AGENT_ID, project_id: 'invalid' }),
    BuilderWorkbenchTaskMonitorProjectionError,
  );
  assert.throws(
    () => projection.invalidate_monitor({ agent_id: AGENT_ID, project_id: 'invalid' }),
    BuilderWorkbenchTaskMonitorProjectionError,
  );
});

test('reuses cached task projections until the affected project is invalidated', () => {
  const record = task(11, 'Cached task');
  const reads = [];
  const projection = createBuilderWorkbenchTaskMonitorProjection({
    address_store: {
      list_task_addresses_for_agent() { return { status: 'ready', task_addresses: [record] }; },
    },
    read_task_stream(request) {
      reads.push(request);
      return null;
    },
  });

  projection.read_monitor({ agent_id: AGENT_ID });
  projection.read_monitor({ agent_id: AGENT_ID });
  assert.equal(reads.length, 1);

  projection.invalidate_monitor({ agent_id: AGENT_ID, project_id: PROJECT_ID });
  projection.read_monitor({ agent_id: AGENT_ID });
  assert.equal(reads.length, 2);
});

test('returns an explicit loading summary without replaying uncached history', () => {
  const record = task(12, 'Cold history task');
  const reads = [];
  const projection = createBuilderWorkbenchTaskMonitorProjection({
    address_store: {
      list_task_addresses_for_agent() { return { status: 'ready', task_addresses: [record] }; },
    },
    read_task_stream(request) {
      reads.push(request);
      return null;
    },
  });

  const cold = projection.read_monitor({ agent_id: AGENT_ID, cache_only: true });
  assert.equal(reads.length, 0);
  assert.equal(cold.tasks[0].status_label, 'Loading task history');
  assert.deepEqual(cold.tasks[0].operations, ['open_task']);

  projection.read_monitor({ agent_id: AGENT_ID, project_id: PROJECT_ID });
  const warm = projection.read_monitor({ agent_id: AGENT_ID, cache_only: true });
  assert.equal(reads.length, 1);
  assert.equal(warm.tasks[0].status_label, 'Ready to start');
  assert.throws(
    () => projection.read_monitor({ agent_id: AGENT_ID, cache_only: 'yes' }),
    BuilderWorkbenchTaskMonitorProjectionError,
  );
});

test('hydrates one addressed task without replaying its project siblings', () => {
  const first = task(13, 'First sibling');
  const second = task(14, 'Second sibling');
  const reads = [];
  const projection = createBuilderWorkbenchTaskMonitorProjection({
    address_store: {
      list_task_addresses_for_agent() {
        return { status: 'ready', task_addresses: [first, second] };
      },
    },
    read_task_stream(request) {
      reads.push(request);
      return null;
    },
  });

  const hydrated = projection.read_monitor({
    agent_id: AGENT_ID,
    project_id: PROJECT_ID,
    task_address_id: second.task_address.task_address_id,
  });
  assert.deepEqual(hydrated.tasks.map((item) => item.title), ['Second sibling']);
  assert.equal(reads.length, 1);
  assert.equal(reads[0].conversation_id, second.task_address.conversation_id);
  assert.throws(
    () => projection.read_monitor({
      agent_id: AGENT_ID,
      task_address_id: second.task_address.task_address_id,
    }),
    BuilderWorkbenchTaskMonitorProjectionError,
  );
});

test('invalidates only the changed task or conversation within a shared project', () => {
  const first = task(20);
  const second = task(21);
  const reads = [];
  const projection = createBuilderWorkbenchTaskMonitorProjection({
    address_store: { list_task_addresses_for_agent: () => ({ status: 'ready', task_addresses: [first, second] }) },
    read_task_stream(request) { reads.push(request.conversation_id); return null; },
  });
  projection.read_monitor({ agent_id: AGENT_ID });
  projection.invalidate_monitor({ agent_id: AGENT_ID, project_id: PROJECT_ID, conversation_id: first.task_address.conversation_id });
  projection.read_monitor({ agent_id: AGENT_ID });
  assert.deepEqual(reads, [first.task_address.conversation_id, second.task_address.conversation_id, first.task_address.conversation_id]);
  projection.invalidate_monitor({ agent_id: AGENT_ID, project_id: PROJECT_ID, task_address_id: second.task_address.task_address_id });
  projection.read_monitor({ agent_id: AGENT_ID });
  assert.equal(reads.length, 4);
  assert.equal(reads.at(-1), second.task_address.conversation_id);
  assert.throws(() => projection.invalidate_monitor({ agent_id: AGENT_ID, project_id: PROJECT_ID,
    conversation_id: 'builder-conversation:123e4567-e89b-42d3-a456-426614174999' }), BuilderWorkbenchTaskMonitorProjectionError);
});

test('projects an orphaned durable run as interrupted after runtime restart', () => {
  const record = task(8, 'Restarted task');
  const streams = new Map([[
    record.task_address.conversation_id,
    stream(record, [{ item_kind: 'run_started', sequence: 1, run_id: 'builder-run:orphaned' }]),
  ]]);

  const result = monitor([record], streams).read_monitor({ agent_id: AGENT_ID });

  assert.equal(result.tasks[0].group, 'attention');
  assert.equal(result.tasks[0].state, 'interrupted');
  assert.equal(result.tasks[0].status_label, 'Paused');
  assert.deepEqual(result.tasks[0].operations, ['open_task']);
  assert.deepEqual(result.counts, { active: 0, attention: 1, recent: 0 });
});

test('does not expose stale cancellation controls for a terminal failed task', () => {
  const record = task(15, 'Failed task');
  const streams = new Map([[
    record.task_address.conversation_id,
    stream(record, [
      { item_kind: 'run_started', sequence: 1, run_id: 'builder-run:failed' },
      {
        item_kind: 'run_completed', sequence: 2, run_id: 'builder-run:failed',
        terminal_status: 'failed', result_kind: 'none', assistant_message: null,
        candidate: null,
      },
    ]),
  ]]);
  const controls = new Map([[
    record.task_address.task_address_id,
    ['cancel_task'],
  ]]);

  const result = monitor([record], streams, new Map(), controls)
    .read_monitor({ agent_id: AGENT_ID });

  assert.equal(result.tasks[0].state, 'failed');
  assert.deepEqual(result.tasks[0].operations, ['open_task']);
});

test('projects durable attention ahead of canonical stream progress without exposing private facts', () => {
  const permission = task(5, 'Permission task');
  const userInput = task(6, 'Question task');
  const attentions = new Map([
    [permission.task_address.task_address_id, {
      attention: {
        state: 'waiting_permission',
        updated_at_ms: 2_000,
        request_digest: `sha256:${'a'.repeat(64)}`,
      },
    }],
    [userInput.task_address.task_address_id, {
      attention: {
        state: 'waiting_user_input',
        updated_at_ms: 3_000,
        request_digest: `sha256:${'b'.repeat(64)}`,
      },
    }],
  ]);

  const result = monitor([permission, userInput], new Map(), attentions)
    .read_monitor({ agent_id: AGENT_ID });
  const permissionTask = result.tasks.find((item) => item.title === 'Permission task');
  const questionTask = result.tasks.find((item) => item.title === 'Question task');

  assert.deepEqual(result.counts, { active: 0, attention: 2, recent: 0 });
  assert.equal(permissionTask.state, 'waiting_permission');
  assert.equal(permissionTask.status_label, 'Permission required');
  assert.equal(permissionTask.attention.action_label, 'Review permission');
  assert.equal(questionTask.state, 'waiting_user_input');
  assert.equal(questionTask.attention.action_label, 'Answer task');
  assert.equal(JSON.stringify(result).includes('sha256:'), false);
});

test('source remains a main-only read projection without runtime or mutation authority', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'electron', 'builder-workbench-task-monitor-projection.cjs'), 'utf8');
  assert.doesNotMatch(source, /ipcMain|ipcRenderer|child_process|spawn\(|exec\(|fetch\(|https?\.|writeFile|unlink|provider_dispatch:\s*true/u);
  assert.match(source, /sqlite_canonical_event_replay_plus_task_attention/u);
});
