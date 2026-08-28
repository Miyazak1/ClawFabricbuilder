'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createBuilderTaskWorkbenchResultRecordingService,
} = require('../electron/builder-task-workbench-result-recording-service.cjs');
const {
  sanitizeBuilderWorkbenchMessageEnvelope,
} = require('../electron/builder-workbench-message-contract.cjs');

const AGENT_ID = 'builder-agent:123e4567-e89b-42d3-a456-426614174002';
const OWNER_ID = 'builder-user:123e4567-e89b-42d3-a456-426614174001';
const PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174101';
const TASK_ID = 'builder-task-address:123e4567-e89b-42d3-a456-426614174201';

function monitor() {
  return {
    projection_version: 'builder-workbench-task-monitor.v2',
    agent_id: AGENT_ID,
    tasks: [{
      task_address_id: TASK_ID,
      project_id: PROJECT_ID,
      title: 'Focus timer',
      latest_result: {
        result_id: `builder-task-result:${'a'.repeat(64)}`,
        run_id: 'builder-run:123e4567-e89b-42d3-a456-426614174301',
        sequence: 8,
        completed_at_ms: 1_008,
        terminal_status: 'succeeded',
        result_kind: 'candidate',
        summary: 'Updated the timer and passed its checks.',
      },
    }],
  };
}

test('records one deterministic, Task-addressed Workbench result without execution authority', () => {
  const messages = [];
  const service = createBuilderTaskWorkbenchResultRecordingService({
    message_store: {
      record_message({ message }) {
        messages.push(sanitizeBuilderWorkbenchMessageEnvelope(message));
        return { operation: 'message_recorded' };
      },
    },
    agent_id: AGENT_ID,
    owner_id: OWNER_ID,
  });
  const first = service.sync_task_monitor(monitor());
  const second = service.sync_task_monitor(monitor());
  assert.equal(first.recorded_count, 1);
  assert.equal(second.recorded_count, 1);
  assert.equal(messages[0].message_id, messages[1].message_id);
  assert.equal(messages[0].address.task_address_id, TASK_ID);
  assert.equal(messages[0].content.content_type, 'builder.task.result.v1');
  assert.equal(messages[0].content.payload.summary, 'Updated the timer and passed its checks.');
  assert.equal(messages[0].source.source_kind, 'project_task');
});

test('skips Tasks without a terminal result', () => {
  let called = false;
  const service = createBuilderTaskWorkbenchResultRecordingService({
    message_store: { record_message() { called = true; } },
    agent_id: AGENT_ID,
    owner_id: OWNER_ID,
  });
  const result = service.sync_task_monitor({
    projection_version: 'builder-workbench-task-monitor.v2',
    agent_id: AGENT_ID,
    tasks: [{ latest_result: null }],
  });
  assert.equal(result.recorded_count, 0);
  assert.equal(called, false);
});
