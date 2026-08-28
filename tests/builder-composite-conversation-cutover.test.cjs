'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  createBuilderConversationMainService,
} = require('../electron/builder-conversation-main-service.cjs');
const {
  createBuilderProductMetadataDatabase,
} = require('../electron/builder-product-metadata-database.cjs');
const {
  createBuilderSessionTaskAddressRecordingService,
} = require('../electron/builder-session-task-address-recording-service.cjs');
const {
  createBuilderSessionTaskAddressStore,
} = require('../electron/builder-session-task-address-store.cjs');
const {
  createBuilderSessionTaskTargetService,
} = require('../electron/builder-session-task-target-service.cjs');

const PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174200';
const AGENT_ID = 'builder-agent:123e4567-e89b-42d3-a456-426614174202';
const OWNER_ID = 'builder-user:123e4567-e89b-42d3-a456-426614174201';
const REQUEST_DIGEST = `sha256:${'a'.repeat(64)}`;

function uuidFactory() {
  let next = 300;
  return () => `123e4567-e89b-42d3-a456-${String(next++).padStart(12, '0')}`;
}

test('materializes and restores an independent Task Address conversation inside one project', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'builder-composite-conversation-'));
  const metadata = createBuilderProductMetadataDatabase(path.join(root, 'builder.sqlite'));
  const addresses = createBuilderSessionTaskAddressStore(path.join(root, 'addresses.sqlite'));
  const createUuid = uuidFactory();
  t.after(() => {
    try { addresses.close(); } catch { /* already closed */ }
    try { metadata.close(); } catch { /* already closed */ }
    fs.rmSync(root, { recursive: true, force: true });
  });

  const targetService = createBuilderSessionTaskTargetService({
    address_store: addresses,
    create_uuid: createUuid,
    agent_id: AGENT_ID,
  });
  const target = targetService.resolve_target({ project_id: PROJECT_ID, task_address_id: null });
  assert.match(
    target.conversation_id,
    /^builder-conversation:123e4567-e89b-42d3-a456-426614174200:123e4567-e89b-42d3-a456-000000000300$/u,
  );

  const conversation = createBuilderConversationMainService({
    metadataAuthority: metadata,
    createUuid,
    nowMs: () => 1_000,
  });
  const context = conversation.begin_work({
    project_id: PROJECT_ID,
    conversation_id: target.conversation_id,
    instruction: 'Build the first independent task',
    request_digest: REQUEST_DIGEST,
    base_revision: null,
  });
  const recorder = createBuilderSessionTaskAddressRecordingService({
    address_store: addresses,
    create_uuid: createUuid,
    now_ms: () => 2_000,
    created_by: OWNER_ID,
    agent_id: AGENT_ID,
  });
  const recorded = recorder.record_addresses_from_conversation_context({ context });
  const taskAddressId = recorded.task_address.task_address.task_address_id;

  const restoredTarget = targetService.resolve_target({
    project_id: PROJECT_ID,
    task_address_id: taskAddressId,
  });
  assert.equal(restoredTarget.conversation_id, target.conversation_id);
  assert.equal(
    conversation.read_stream({
      project_id: PROJECT_ID,
      conversation_id: restoredTarget.conversation_id,
    }).conversation.conversation_id,
    target.conversation_id,
  );
});
