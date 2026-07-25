'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');

const {
  BUILDER_PERMISSION_FACTS_READ_RESULT_VERSION,
  BUILDER_PERMISSION_GRANT_RECORD_VERSION,
  BUILDER_PERMISSION_POLICY_VERSION,
  BUILDER_PERMISSION_REVOCATION_RECORD_VERSION,
  createBuilderPermissionGrantRecord,
  createBuilderPermissionRevocationRecord,
} = require('../electron/builder-permission-authority-contract.cjs');
const {
  BUILDER_PERMISSION_FACT_STORE_RESULT_VERSION,
  BUILDER_PERMISSION_FACT_STORE_SCHEMA_VERSION,
  BUILDER_PERMISSION_FACT_STORE_USER_VERSION,
  BUILDER_PERMISSION_FACT_STORE_VERSION,
  BuilderPermissionFactStoreError,
  createBuilderPermissionFactStore,
} = require('../electron/builder-permission-fact-store.cjs');

const PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174000';
const ACTOR_ID = 'builder-agent:123e4567-e89b-42d3-a456-426614174001';
const OTHER_ACTOR_ID = 'builder-agent:123e4567-e89b-42d3-a456-426614174002';
const ISSUER_ID = 'builder-user:123e4567-e89b-42d3-a456-426614174003';
const REVOKER_ID = 'builder-user:123e4567-e89b-42d3-a456-426614174004';

function temporaryDatabase(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawfabric-builder-permission-facts-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return path.join(root, 'permission-facts.sqlite');
}

function resource(overrides = {}) {
  return {
    resource_kind: 'project',
    project_id: PROJECT_ID,
    resource_id: 'project:self',
    ...overrides,
  };
}

function grantInput(overrides = {}) {
  return {
    record_version: BUILDER_PERMISSION_GRANT_RECORD_VERSION,
    policy_version: BUILDER_PERMISSION_POLICY_VERSION,
    project_id: PROJECT_ID,
    actor_id: ACTOR_ID,
    issuer_id: ISSUER_ID,
    scope_kind: 'project',
    action: 'project.edit',
    resource: resource(),
    issued_at_ms: 10,
    expires_at_ms: 100,
    ...overrides,
  };
}

function grant(overrides = {}) {
  return createBuilderPermissionGrantRecord(grantInput(overrides));
}

function revocation(permission, overrides = {}) {
  return createBuilderPermissionRevocationRecord({
    record_version: BUILDER_PERMISSION_REVOCATION_RECORD_VERSION,
    policy_version: BUILDER_PERMISSION_POLICY_VERSION,
    permission_id: permission.permission_id,
    project_id: permission.project_id,
    revoker_id: REVOKER_ID,
    revoked_at_ms: 20,
    ...overrides,
  });
}

function readRequest(overrides = {}) {
  return {
    policy_version: BUILDER_PERMISSION_POLICY_VERSION,
    actor_id: ACTOR_ID,
    action: 'project.edit',
    resource: resource(),
    now_ms: 30,
    ...overrides,
  };
}

function assertStoreError(fn, code = null) {
  assert.throws(
    fn,
    (error) => {
      assert.ok(error instanceof BuilderPermissionFactStoreError);
      if (code !== null) assert.equal(error.code, code);
      const text = `${error.name}:${error.message}:${error.stack}`;
      assert.doesNotMatch(text, /private|credential|api\.deepseek|secret-value/iu);
      return true;
    },
  );
}

test('records grant facts, reads them for evaluator decisions, and restores after restart', async (t) => {
  const databasePath = temporaryDatabase(t);
  const store = createBuilderPermissionFactStore(databasePath);
  const permission = grant();
  assert.equal(store.store_version, BUILDER_PERMISSION_FACT_STORE_VERSION);

  const recorded = store.record_grant({ grant: permission });
  assert.equal(recorded.result_version, BUILDER_PERMISSION_FACT_STORE_RESULT_VERSION);
  assert.equal(recorded.operation, 'grant_recorded');
  assert.deepEqual(recorded.grant, permission);
  assert.equal(recorded.permission_evidence.permission_authority, 'main_owned_permission_fact_store');
  assert.equal(recorded.permission_evidence.renderer_authority, 'not_present');
  assert.equal(recorded.permission_evidence.provider_dispatch, false);
  assert.equal(recorded.permission_evidence.credential_storage, 'not_present');
  assert.equal(recorded.permission_evidence.schema_version, BUILDER_PERMISSION_FACT_STORE_SCHEMA_VERSION);
  assert.equal(recorded.permission_evidence.user_version, BUILDER_PERMISSION_FACT_STORE_USER_VERSION);
  assert.match(recorded.permission_evidence.schema_fingerprint_digest, /^[a-f0-9]{64}$/u);
  assert.equal(Object.hasOwn(recorded.permission_evidence, 'schema_fingerprint'), false);

  const replayed = store.record_grant({ grant: permission });
  assert.equal(replayed.operation, 'grant_replayed');
  assert.deepEqual(replayed.grant, permission);

  const facts = store.read_permission_facts(readRequest());
  assert.deepEqual(facts, {
    result_version: BUILDER_PERMISSION_FACTS_READ_RESULT_VERSION,
    permission_authority: 'main_owned_permission_fact_store',
    policy_version: BUILDER_PERMISSION_POLICY_VERSION,
    actor_id: ACTOR_ID,
    action: 'project.edit',
    resource: resource(),
    grants: [permission],
    revocations: [],
  });

  const evaluator = store.create_evaluator();
  const decision = await evaluator.evaluate(readRequest());
  assert.equal(decision.decision, 'allowed');
  assert.equal(decision.permission_id, permission.permission_id);
  store.close();

  const restarted = createBuilderPermissionFactStore(databasePath);
  const restoredDecision = await restarted.create_evaluator().evaluate(readRequest());
  assert.equal(restoredDecision.decision, 'allowed');
  assert.equal(restoredDecision.permission_id, permission.permission_id);
  restarted.close();
});

test('revocation facts replay over older grants and remain visible after restart', async (t) => {
  const databasePath = temporaryDatabase(t);
  const store = createBuilderPermissionFactStore(databasePath);
  const permission = grant();
  const revoked = revocation(permission);
  store.record_grant({ grant: permission });

  const recorded = store.record_revocation({ revocation: revoked });
  assert.equal(recorded.operation, 'revocation_recorded');
  assert.deepEqual(recorded.revocation, revoked);
  assert.equal(store.record_revocation({ revocation: revoked }).operation, 'revocation_replayed');

  const facts = store.read_permission_facts(readRequest());
  assert.deepEqual(facts.grants, [permission]);
  assert.deepEqual(facts.revocations, [revoked]);
  assert.equal((await store.create_evaluator().evaluate(readRequest())).decision, 'denied');
  store.close();

  const restarted = createBuilderPermissionFactStore(databasePath);
  const restartedDecision = await restarted.create_evaluator().evaluate(readRequest());
  assert.equal(restartedDecision.decision, 'denied');
  assert.equal(restartedDecision.permission_id, null);
  restarted.close();
});

test('rejects missing grants, conflicting revocations, and invalid revoked ordering', (t) => {
  const databasePath = temporaryDatabase(t);
  const store = createBuilderPermissionFactStore(databasePath);
  const permission = grant();
  const revoked = revocation(permission);

  assertStoreError(
    () => store.record_revocation({ revocation: revoked }),
    'builder_permission_fact_store_not_found',
  );
  store.record_grant({ grant: permission });
  assertStoreError(
    () => store.record_revocation({ revocation: revocation(permission, { revoked_at_ms: 9 }) }),
    'builder_permission_fact_store_invalid',
  );
  store.record_revocation({ revocation: revoked });
  assertStoreError(
    () => store.record_revocation({ revocation: revocation(permission, { revoked_at_ms: 21 }) }),
    'builder_permission_fact_store_conflict',
  );
  store.close();
});

test('read scope is exact actor/action/resource and denies unrelated facts', async (t) => {
  const databasePath = temporaryDatabase(t);
  const store = createBuilderPermissionFactStore(databasePath);
  const permission = grant();
  store.record_grant({ grant: permission });

  assert.deepEqual(store.read_permission_facts(readRequest({ actor_id: OTHER_ACTOR_ID })).grants, []);
  assert.deepEqual(store.read_permission_facts(readRequest({
    action: 'project.read',
    resource: resource({ resource_kind: 'project' }),
  })).grants, []);
  assert.deepEqual(store.read_permission_facts(readRequest({
    resource: resource({ resource_id: 'project:other' }),
  })).grants, []);
  assert.equal((await store.create_evaluator().evaluate(readRequest({
    resource: resource({ resource_id: 'project:other' }),
  }))).decision, 'denied');
  store.close();
});

test('fails closed on malformed input, hostile accessors, and tampered rows', (t) => {
  const databasePath = temporaryDatabase(t);
  const store = createBuilderPermissionFactStore(databasePath);
  const permission = grant();

  assertStoreError(() => store.record_grant({ grant: permission, extra: true }));
  assertStoreError(() => store.read_permission_facts({ ...readRequest(), grants: [permission] }));

  let proxyTrapInvoked = false;
  const proxyTrap = () => {
    proxyTrapInvoked = true;
    throw new Error('private proxy marker');
  };
  assertStoreError(
    () => store.record_grant(new Proxy({ grant: permission }, {
      getOwnPropertyDescriptor: proxyTrap,
      getPrototypeOf: proxyTrap,
      ownKeys: proxyTrap,
    })),
    'builder_permission_fact_store_invalid',
  );
  assert.equal(proxyTrapInvoked, false);
  assertStoreError(
    () => store.read_permission_facts(new Proxy(readRequest(), {
      getOwnPropertyDescriptor: proxyTrap,
      getPrototypeOf: proxyTrap,
      ownKeys: proxyTrap,
    })),
    'builder_permission_fact_store_invalid',
  );
  assert.equal(proxyTrapInvoked, false);
  assertStoreError(
    () => store.read_permission_facts({
      ...readRequest(),
      resource: new Proxy(resource(), {
        getOwnPropertyDescriptor: proxyTrap,
        getPrototypeOf: proxyTrap,
        ownKeys: proxyTrap,
      }),
    }),
    'builder_permission_fact_store_invalid',
  );
  assert.equal(proxyTrapInvoked, false);

  const accessor = { grant: permission };
  Object.defineProperty(accessor, 'grant', {
    enumerable: true,
    get() { throw new Error('private credential getter'); },
  });
  assertStoreError(() => store.record_grant(accessor));
  assertStoreError(() => store.record_grant({ grant: new Proxy(permission, {
    ownKeys() { throw new Error('private proxy marker'); },
  }) }));

  store.record_grant({ grant: permission });
  store.close();

  const raw = new DatabaseSync(databasePath);
  raw.prepare('UPDATE permission_grants SET permission_id = ? WHERE project_id = ?')
    .run('builder-permission:bad', PROJECT_ID);
  raw.close();

  const corrupted = createBuilderPermissionFactStore(databasePath);
  assertStoreError(
    () => corrupted.read_permission_facts(readRequest()),
    'builder_permission_fact_store_integrity_failed',
  );
  corrupted.close();
});

test('rejects schema drift and unsafe database paths', (t) => {
  const databasePath = temporaryDatabase(t);
  const store = createBuilderPermissionFactStore(databasePath);
  store.close();

  const raw = new DatabaseSync(databasePath);
  raw.exec('CREATE TABLE unexpected_permission_fact (id TEXT PRIMARY KEY) STRICT');
  raw.close();

  assertStoreError(
    () => createBuilderPermissionFactStore(databasePath),
    'builder_permission_fact_store_integrity_failed',
  );
  assertStoreError(
    () => createBuilderPermissionFactStore(path.join('relative', 'permission.sqlite')),
    'builder_permission_fact_store_invalid',
  );

  const notDatabasePath = path.join(path.dirname(databasePath), 'not-a-database.sqlite');
  fs.writeFileSync(notDatabasePath, 'not sqlite private credential marker');
  assertStoreError(
    () => createBuilderPermissionFactStore(notDatabasePath),
    'builder_permission_fact_store_unavailable',
  );
});

test('source boundary remains main-owned SQLite facts without renderer, provider, Git, network, or execution authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-permission-fact-store.cjs'),
    'utf8',
  );
  assert.match(source, /main_owned_permission_fact_store/u);
  assert.match(source, /createBuilderPermissionEvaluator/u);
  assert.match(source, /record_grant/u);
  assert.match(source, /record_revocation/u);
  assert.match(source, /read_permission_facts/u);
  assert.match(source, /node:sqlite/u);
  assert.match(source, /node:util/u);
  assert.match(source, /utilTypes\.isProxy/u);
  assert.doesNotMatch(
    source,
    /require\(['"](?:electron|node:http|node:https|http|https)['"]\)|ipcMain|ipcRenderer|contextBridge|BrowserWindow|safeStorage|builder-provider|builder-git|fetch\s*\(|https?:|Authorization|Bearer|child_process|execFile|shell:\s*true|localStorage|sessionStorage|indexedDB|better-sqlite|eval\s*\(|new Function/iu,
  );
});
