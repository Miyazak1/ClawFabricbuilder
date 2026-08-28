'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createBuilderAgentDefinitionStore } = require('../electron/builder-agent-definition-store.cjs');
const {
  DEFAULT_BUILDER_AGENT_ID,
  createBuilderDefaultAgentBootstrap,
} = require('../electron/builder-default-agent-bootstrap.cjs');

const OWNER_ID = 'builder-user:00000000-0000-4000-8000-000000000001';

test('persists and idempotently restores the versioned default Builder agent', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'builder-default-agent-'));
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  const databasePath = path.join(root, 'agents.sqlite');
  const firstStore = createBuilderAgentDefinitionStore(databasePath);
  const first = createBuilderDefaultAgentBootstrap({ agent_store: firstStore, owner_id: OWNER_ID });
  assert.equal(first.operation, 'default_agent_ready');
  assert.equal(first.agent_id, DEFAULT_BUILDER_AGENT_ID);
  firstStore.close();

  const restarted = createBuilderAgentDefinitionStore(databasePath);
  const replay = createBuilderDefaultAgentBootstrap({ agent_store: restarted, owner_id: OWNER_ID });
  assert.equal(replay.definition_operation, 'definition_replayed');
  assert.equal(replay.version_operation, 'version_replayed');
  assert.equal(replay.lifecycle_operation, 'lifecycle_replayed');
  const agent = restarted.read_agent({ agent_id: DEFAULT_BUILDER_AGENT_ID, owner_id: OWNER_ID });
  assert.equal(agent.status, 'ready');
  assert.equal(agent.definition.display_name, 'Builder');
  assert.equal(agent.current_status, 'active');
  assert.equal(agent.current_version.version_number, 1);
  assert.equal(agent.current_version.permission_boundary, 'explicit_permission_required');
  restarted.close();
});
