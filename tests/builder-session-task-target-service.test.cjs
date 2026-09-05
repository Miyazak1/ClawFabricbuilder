'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  BuilderSessionTaskTargetServiceError,
  createBuilderSessionTaskTargetService,
} = require('../electron/builder-session-task-target-service.cjs');

const PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174200';
const TASK_ID = 'builder-task-address:123e4567-e89b-42d3-a456-426614174203';
const AGENT_ID = 'builder-agent:123e4567-e89b-42d3-a456-426614174002';
const CONVERSATION_ID = 'builder-conversation:123e4567-e89b-42d3-a456-426614174200:123e4567-e89b-42d3-a456-426614174205';

function service(read = () => ({
  status: 'ready',
  task_address: { task_address: {
    project_id: PROJECT_ID,
    task_address_id: TASK_ID,
    agent_id: AGENT_ID,
    conversation_id: CONVERSATION_ID,
  } },
})) {
  return createBuilderSessionTaskTargetService({
    address_store: { read_task_address: read },
    create_uuid: () => '123e4567-e89b-42d3-a456-426614174206',
    agent_id: AGENT_ID,
  });
}

test('allocates a main-owned conversation target for an unsent task draft', () => {
  const result = service().resolve_target({ project_id: PROJECT_ID, task_address_id: null });
  assert.equal(result.operation, 'new_task_target_allocated');
  assert.equal(
    result.conversation_id,
    'builder-conversation:123e4567-e89b-42d3-a456-426614174200:123e4567-e89b-42d3-a456-426614174206',
  );
  assert.equal(result.should_record_task_address, true);
});

test('resolves an existing Task Address without trusting renderer conversation identity', () => {
  const result = service().resolve_target({ project_id: PROJECT_ID, task_address_id: TASK_ID });
  assert.equal(result.operation, 'existing_task_target_resolved');
  assert.equal(result.conversation_id, CONVERSATION_ID);
  assert.equal(result.should_record_task_address, false);
});

test('fails closed for an absent or cross-Agent Task Address', () => {
  assert.throws(
    () => service(() => ({ status: 'absent', task_address: null }))
      .resolve_target({ project_id: PROJECT_ID, task_address_id: TASK_ID }),
    BuilderSessionTaskTargetServiceError,
  );
});

test('fails closed when an existing Task Address points at project-root conversation history', () => {
  assert.throws(
    () => service(() => ({
      status: 'ready',
      task_address: { task_address: {
        project_id: PROJECT_ID,
        task_address_id: TASK_ID,
        agent_id: AGENT_ID,
        conversation_id: 'builder-conversation:123e4567-e89b-42d3-a456-426614174200',
      } },
    })).resolve_target({ project_id: PROJECT_ID, task_address_id: TASK_ID }),
    BuilderSessionTaskTargetServiceError,
  );
});
