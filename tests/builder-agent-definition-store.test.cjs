'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');

const {
  BUILDER_AGENT_DEFINITION_RECORD_VERSION,
  BUILDER_AGENT_LIFECYCLE_RECORD_VERSION,
  BUILDER_AGENT_VERSION_RECORD_VERSION,
  createBuilderAgentDefinitionRecord,
  createBuilderAgentLifecycleRecord,
  createBuilderAgentVersionRecord,
} = require('../electron/builder-agent-definition-contract.cjs');
const {
  BUILDER_AGENT_DEFINITION_STORE_READ_RESULT_VERSION,
  BUILDER_AGENT_DEFINITION_STORE_RESULT_VERSION,
  BUILDER_AGENT_DEFINITION_STORE_SCHEMA_VERSION,
  BUILDER_AGENT_DEFINITION_STORE_USER_VERSION,
  BUILDER_AGENT_DEFINITION_STORE_VERSION,
  BuilderAgentDefinitionStoreError,
  createBuilderAgentDefinitionStore,
} = require('../electron/builder-agent-definition-store.cjs');

const OWNER_ID = 'builder-user:123e4567-e89b-42d3-a456-426614174000';
const OTHER_OWNER_ID = 'builder-user:123e4567-e89b-42d3-a456-426614174001';
const AGENT_ID = 'builder-agent:123e4567-e89b-42d3-a456-426614174002';

function temporaryDatabase(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawfabric-builder-agent-definitions-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return path.join(root, 'agent-definitions.sqlite');
}

function definitionInput(overrides = {}) {
  return {
    record_version: BUILDER_AGENT_DEFINITION_RECORD_VERSION,
    agent_id: AGENT_ID,
    owner_id: OWNER_ID,
    display_name: 'Builder Assistant',
    purpose: 'Help the owner plan and review local Builder work.',
    created_at_ms: 10,
    ...overrides,
  };
}

function definition(overrides = {}) {
  return createBuilderAgentDefinitionRecord(definitionInput(overrides));
}

function versionInput(overrides = {}) {
  return {
    record_version: BUILDER_AGENT_VERSION_RECORD_VERSION,
    agent_id: AGENT_ID,
    owner_id: OWNER_ID,
    version_number: 1,
    instructions: 'Ask before changing files. Summarize proposed work before review.',
    created_at_ms: 20,
    permission_boundary: 'explicit_permission_required',
    ...overrides,
  };
}

function version(definitionRecord, overrides = {}) {
  return createBuilderAgentVersionRecord(versionInput(overrides), definitionRecord);
}

function lifecycleInput(overrides = {}) {
  return {
    record_version: BUILDER_AGENT_LIFECYCLE_RECORD_VERSION,
    agent_id: AGENT_ID,
    owner_id: OWNER_ID,
    decided_by: OWNER_ID,
    next_status: 'active',
    reason: 'Ready for supervised local work.',
    decided_at_ms: 30,
    ...overrides,
  };
}

function lifecycle(definitionRecord, overrides = {}) {
  return createBuilderAgentLifecycleRecord(lifecycleInput(overrides), definitionRecord);
}

function readRequest(overrides = {}) {
  return {
    agent_id: AGENT_ID,
    owner_id: OWNER_ID,
    ...overrides,
  };
}

function assertStoreError(fn, code = null) {
  assert.throws(
    fn,
    (error) => {
      assert.ok(error instanceof BuilderAgentDefinitionStoreError);
      if (code !== null) assert.equal(error.code, code);
      const text = `${error.name}:${error.message}:${error.stack}`;
      assert.doesNotMatch(text, /private|credential|api\.deepseek|secret-value|source text/iu);
      return true;
    },
  );
}

test('records definitions, versions, and lifecycle facts then restores them after restart', (t) => {
  const databasePath = temporaryDatabase(t);
  const store = createBuilderAgentDefinitionStore(databasePath);
  const agentDefinition = definition();
  const firstVersion = version(agentDefinition);
  const active = lifecycle(agentDefinition);
  assert.equal(store.store_version, BUILDER_AGENT_DEFINITION_STORE_VERSION);

  const definitionResult = store.record_definition({ definition: agentDefinition });
  assert.equal(definitionResult.result_version, BUILDER_AGENT_DEFINITION_STORE_RESULT_VERSION);
  assert.equal(definitionResult.operation, 'definition_recorded');
  assert.deepEqual(definitionResult.definition, agentDefinition);
  assert.equal(definitionResult.agent_evidence.agent_authority, 'main_owned_agent_definition_store');
  assert.equal(definitionResult.agent_evidence.renderer_authority, 'not_present');
  assert.equal(definitionResult.agent_evidence.ipc_authority, 'not_present');
  assert.equal(definitionResult.agent_evidence.tool_dispatch, false);
  assert.equal(definitionResult.agent_evidence.permission_grant_authority, false);
  assert.equal(definitionResult.agent_evidence.credential_storage, 'not_present');
  assert.equal(definitionResult.agent_evidence.schema_version, BUILDER_AGENT_DEFINITION_STORE_SCHEMA_VERSION);
  assert.equal(definitionResult.agent_evidence.user_version, BUILDER_AGENT_DEFINITION_STORE_USER_VERSION);
  assert.match(definitionResult.agent_evidence.schema_fingerprint_digest, /^[a-f0-9]{64}$/u);

  assert.equal(store.record_definition({ definition: agentDefinition }).operation, 'definition_replayed');
  assert.equal(store.record_version({ version: firstVersion }).operation, 'version_recorded');
  assert.equal(store.record_version({ version: firstVersion }).operation, 'version_replayed');
  assert.equal(store.record_lifecycle({ lifecycle: active }).operation, 'lifecycle_recorded');
  assert.equal(store.record_lifecycle({ lifecycle: active }).operation, 'lifecycle_replayed');

  const read = store.read_agent(readRequest());
  assert.equal(read.result_version, BUILDER_AGENT_DEFINITION_STORE_READ_RESULT_VERSION);
  assert.equal(read.status, 'ready');
  assert.deepEqual(read.definition, agentDefinition);
  assert.deepEqual(read.versions, [firstVersion]);
  assert.deepEqual(read.lifecycle, [active]);
  assert.deepEqual(read.current_version, firstVersion);
  assert.equal(read.current_status, 'active');
  assert.equal(read.evidence.agent_authority, 'main_owned_agent_definition_store');
  assert.equal(Object.isFrozen(read), true);
  assert.equal(Object.isFrozen(read.versions), true);
  store.close();

  const restarted = createBuilderAgentDefinitionStore(databasePath);
  const restored = restarted.read_agent(readRequest());
  assert.equal(restored.status, 'ready');
  assert.deepEqual(restored.definition, agentDefinition);
  assert.deepEqual(restored.versions, [firstVersion]);
  assert.deepEqual(restored.lifecycle, [active]);
  assert.equal(restored.current_status, 'active');
  restarted.close();
});

test('enforces version order, stored definition binding, owner scope, and lifecycle finality', (t) => {
  const databasePath = temporaryDatabase(t);
  const store = createBuilderAgentDefinitionStore(databasePath);
  const agentDefinition = definition();
  const firstVersion = version(agentDefinition);

  assertStoreError(
    () => store.record_version({ version: firstVersion }),
    'builder_agent_definition_store_not_found',
  );
  store.record_definition({ definition: agentDefinition });
  assertStoreError(
    () => store.record_definition({ definition: definition({ display_name: 'Changed' }) }),
    'builder_agent_definition_store_conflict',
  );
  assertStoreError(
    () => store.record_version({ version: version(agentDefinition, { version_number: 2 }) }),
    'builder_agent_definition_store_invalid',
  );
  assertStoreError(
    () => store.record_version({ version: version(agentDefinition, { created_at_ms: 9 }) }),
    'builder_agent_definition_store_invalid',
  );
  store.record_version({ version: firstVersion });
  assertStoreError(
    () => store.record_version({ version: version(agentDefinition, {
      instructions: 'A different first version.',
    }) }),
    'builder_agent_definition_store_conflict',
  );
  const secondVersion = version(agentDefinition, {
    version_number: 2,
    instructions: 'A second supervised version.',
    created_at_ms: 25,
  });
  assert.equal(store.record_version({ version: secondVersion }).operation, 'version_recorded');

  const wrongOwnerRead = store.read_agent(readRequest({ owner_id: OTHER_OWNER_ID }));
  assert.equal(wrongOwnerRead.status, 'absent');
  assert.equal(wrongOwnerRead.definition, null);
  assert.deepEqual(wrongOwnerRead.versions, []);

  const active = lifecycle(agentDefinition, { decided_at_ms: 30 });
  const revoked = lifecycle(agentDefinition, {
    next_status: 'revoked',
    reason: 'The owner revoked this local Agent.',
    decided_at_ms: 40,
  });
  store.record_lifecycle({ lifecycle: active });
  assertStoreError(
    () => store.record_lifecycle({ lifecycle: lifecycle(agentDefinition, {
      next_status: 'archived',
      reason: 'Older event.',
      decided_at_ms: 29,
    }) }),
    'builder_agent_definition_store_invalid',
  );
  store.record_lifecycle({ lifecycle: revoked });
  assertStoreError(
    () => store.record_lifecycle({ lifecycle: lifecycle(agentDefinition, {
      next_status: 'active',
      reason: 'Reactivate after revocation.',
      decided_at_ms: 50,
    }) }),
    'builder_agent_definition_store_conflict',
  );
  store.close();
});

test('fails closed on malformed input, hostile accessors, proxies, and tampered rows', (t) => {
  const databasePath = temporaryDatabase(t);
  const store = createBuilderAgentDefinitionStore(databasePath);
  const agentDefinition = definition();
  const firstVersion = version(agentDefinition);

  assertStoreError(() => store.record_definition({ definition: agentDefinition, extra: true }));
  assertStoreError(() => store.read_agent({ ...readRequest(), extra: true }));

  let getterCalls = 0;
  const accessor = { definition: agentDefinition };
  Object.defineProperty(accessor, 'definition', {
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new Error('private credential getter');
    },
  });
  assertStoreError(() => store.record_definition(accessor));
  assert.equal(getterCalls, 0);

  let proxyTrapInvoked = false;
  const proxyTrap = () => {
    proxyTrapInvoked = true;
    throw new Error('private proxy marker');
  };
  assertStoreError(() => store.record_definition(new Proxy({ definition: agentDefinition }, {
    getOwnPropertyDescriptor: proxyTrap,
    getPrototypeOf: proxyTrap,
    ownKeys: proxyTrap,
  })));
  assert.equal(proxyTrapInvoked, false);
  assertStoreError(() => store.record_version({ version: new Proxy(firstVersion, {
    getOwnPropertyDescriptor: proxyTrap,
    getPrototypeOf: proxyTrap,
    ownKeys: proxyTrap,
  }) }));
  assert.equal(proxyTrapInvoked, false);

  store.record_definition({ definition: agentDefinition });
  store.record_version({ version: firstVersion });
  store.close();

  const raw = new DatabaseSync(databasePath);
  raw.prepare('UPDATE agent_versions SET definition_digest = ? WHERE agent_id = ?')
    .run(`sha256:${'f'.repeat(64)}`, AGENT_ID);
  raw.close();

  const corrupted = createBuilderAgentDefinitionStore(databasePath);
  assertStoreError(
    () => corrupted.read_agent(readRequest()),
    'builder_agent_definition_store_integrity_failed',
  );
  corrupted.close();
});

test('rejects schema drift and unsafe database paths', (t) => {
  const databasePath = temporaryDatabase(t);
  const store = createBuilderAgentDefinitionStore(databasePath);
  store.close();

  const raw = new DatabaseSync(databasePath);
  raw.exec('CREATE TABLE unexpected_agent_fact (id TEXT PRIMARY KEY) STRICT');
  raw.close();

  assertStoreError(
    () => createBuilderAgentDefinitionStore(databasePath),
    'builder_agent_definition_store_integrity_failed',
  );
  assertStoreError(
    () => createBuilderAgentDefinitionStore(path.join('relative', 'agent.sqlite')),
    'builder_agent_definition_store_invalid',
  );

  const notDatabasePath = path.join(path.dirname(databasePath), 'not-a-database.sqlite');
  fs.writeFileSync(notDatabasePath, 'not sqlite private credential marker');
  assertStoreError(
    () => createBuilderAgentDefinitionStore(notDatabasePath),
    'builder_agent_definition_store_unavailable',
  );
});

test('source boundary remains a main-only Agent definition store without runtime authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-agent-definition-store.cjs'),
    'utf8',
  );
  assert.match(source, /main_owned_agent_definition_store/u);
  assert.match(source, /record_definition/u);
  assert.match(source, /record_version/u);
  assert.match(source, /record_lifecycle/u);
  assert.match(source, /read_agent/u);
  assert.match(source, /node:sqlite/u);
  assert.match(source, /utilTypes\.isProxy/u);
  assert.doesNotMatch(
    source,
    /require\(['"](?:electron|node:http|node:https|http|https)['"]\)|ipcMain|ipcRenderer|contextBridge|BrowserWindow|safeStorage|builder-provider|builder-git|dugite|fetch\s*\(|https?:|Authorization|Bearer|child_process|execFile|shell:\s*true|localStorage|sessionStorage|indexedDB|better-sqlite|eval\s*\(|new Function/iu,
  );
});
