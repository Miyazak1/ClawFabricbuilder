'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');

const {
  BUILDER_AGENT_DEFINITION_RECORD_VERSION,
  BUILDER_AGENT_VERSION_RECORD_VERSION,
  createBuilderAgentDefinitionRecord,
  createBuilderAgentVersionRecord,
} = require('../electron/builder-agent-definition-contract.cjs');
const {
  BUILDER_AGENT_ASSIGNMENT_RECORD_VERSION,
  BUILDER_AGENT_ASSIGNMENT_STATUS_RECORD_VERSION,
  createBuilderAgentAssignmentRecord,
  createBuilderAgentAssignmentStatusRecord,
} = require('../electron/builder-agent-assignment-contract.cjs');
const {
  BUILDER_AGENT_SUPERVISION_LEASE_RECORD_VERSION,
  BUILDER_AGENT_SUPERVISION_LEASE_RELEASE_RECORD_VERSION,
  createBuilderAgentSupervisionLeaseRecord,
  createBuilderAgentSupervisionLeaseReleaseRecord,
} = require('../electron/builder-agent-supervision-lease-contract.cjs');
const {
  BUILDER_AGENT_SUPERVISION_LEASE_STORE_READ_RESULT_VERSION,
  BUILDER_AGENT_SUPERVISION_LEASE_STORE_RESULT_VERSION,
  BUILDER_AGENT_SUPERVISION_LEASE_STORE_SCHEMA_VERSION,
  BUILDER_AGENT_SUPERVISION_LEASE_STORE_USER_VERSION,
  BUILDER_AGENT_SUPERVISION_LEASE_STORE_VERSION,
  BuilderAgentSupervisionLeaseStoreError,
  createBuilderAgentSupervisionLeaseStore,
} = require('../electron/builder-agent-supervision-lease-store.cjs');

const OWNER_ID = 'builder-user:123e4567-e89b-42d3-a456-426614174000';
const OTHER_OWNER_ID = 'builder-user:123e4567-e89b-42d3-a456-426614174001';
const AGENT_ID = 'builder-agent:123e4567-e89b-42d3-a456-426614174002';
const PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174004';
const CONVERSATION_ID = 'builder-conversation:123e4567-e89b-42d3-a456-426614174005';
const TASK_ID = 'builder-task:123e4567-e89b-42d3-a456-426614174006';
const RUN_ID = 'builder-run:123e4567-e89b-42d3-a456-426614174007';
const SUPERVISOR_ID = 'builder-supervisor:123e4567-e89b-42d3-a456-426614174008';
const OTHER_SUPERVISOR_ID = 'builder-supervisor:123e4567-e89b-42d3-a456-426614174009';

function temporaryDatabase(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawfabric-builder-agent-supervision-leases-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return path.join(root, 'agent-supervision-leases.sqlite');
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

function assignmentInput(agentVersion, overrides = {}) {
  return {
    record_version: BUILDER_AGENT_ASSIGNMENT_RECORD_VERSION,
    agent_id: AGENT_ID,
    agent_version_id: agentVersion.agent_version_id,
    owner_id: OWNER_ID,
    assigned_by: OWNER_ID,
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    task_id: TASK_ID,
    run_id: RUN_ID,
    goal: 'Review the current Builder task and propose the next small change.',
    created_at_ms: 30,
    permission_boundary: 'explicit_permission_required',
    supervision_policy: 'owner_supervised',
    result_contract: 'review_required_before_materialization',
    budget: {
      max_steps: 12,
      max_tool_calls: 4,
      max_runtime_ms: 120_000,
      max_private_source_bytes: 32_768,
    },
    ...overrides,
  };
}

function assignment(agentDefinition, agentVersion, overrides = {}) {
  return createBuilderAgentAssignmentRecord(
    assignmentInput(agentVersion, overrides),
    agentVersion,
    agentDefinition,
  );
}

function statusInput(assignmentRecord, overrides = {}) {
  return {
    record_version: BUILDER_AGENT_ASSIGNMENT_STATUS_RECORD_VERSION,
    assignment_id: assignmentRecord.assignment_id,
    agent_id: AGENT_ID,
    owner_id: OWNER_ID,
    decided_by: OWNER_ID,
    next_status: 'active',
    reason: 'Owner started supervised work.',
    decided_at_ms: 40,
    ...overrides,
  };
}

function status(assignmentRecord, overrides = {}) {
  return createBuilderAgentAssignmentStatusRecord(statusInput(assignmentRecord, overrides), assignmentRecord);
}

function fixture() {
  const agentDefinition = definition();
  const agentVersion = version(agentDefinition);
  const assignmentRecord = assignment(agentDefinition, agentVersion);
  const activeStatus = status(assignmentRecord);
  return { activeStatus, agentDefinition, agentVersion, assignmentRecord };
}

function leaseInput(assignmentRecord, activeStatus, overrides = {}) {
  return {
    record_version: BUILDER_AGENT_SUPERVISION_LEASE_RECORD_VERSION,
    assignment_id: assignmentRecord.assignment_id,
    assignment_status_id: activeStatus.assignment_status_id,
    agent_id: AGENT_ID,
    owner_id: OWNER_ID,
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    task_id: TASK_ID,
    run_id: RUN_ID,
    lease_holder_id: SUPERVISOR_ID,
    lease_epoch: 1,
    acquired_at_ms: 50,
    expires_at_ms: 120,
    purpose: 'Supervise one active local assignment attempt.',
    redispatch_policy: 'lease_required_no_duplicate_dispatch',
    supervision_state: 'active_assignment_only',
    authority_boundary: 'main_supervision_lease_only',
    ...overrides,
  };
}

function lease(assignmentRecord, activeStatus, overrides = {}) {
  return createBuilderAgentSupervisionLeaseRecord(
    leaseInput(assignmentRecord, activeStatus, overrides),
    assignmentRecord,
    activeStatus,
  );
}

function releaseInput(leaseRecord, overrides = {}) {
  return {
    record_version: BUILDER_AGENT_SUPERVISION_LEASE_RELEASE_RECORD_VERSION,
    lease_id: leaseRecord.lease_id,
    assignment_id: leaseRecord.assignment_id,
    owner_id: OWNER_ID,
    lease_holder_id: leaseRecord.lease_holder_id,
    released_by: leaseRecord.lease_holder_id,
    released_at_ms: 90,
    release_outcome: 'completed',
    reason: 'The supervised attempt returned for review.',
    ...overrides,
  };
}

function release(leaseRecord, overrides = {}) {
  return createBuilderAgentSupervisionLeaseReleaseRecord(releaseInput(leaseRecord, overrides), leaseRecord);
}

function leaseRequest(assignmentRecord, activeStatus, leaseRecord) {
  return {
    assignment: assignmentRecord,
    status: activeStatus,
    lease: leaseRecord,
  };
}

function readLeaseRequest(leaseRecord, overrides = {}) {
  return {
    lease_id: leaseRecord.lease_id,
    owner_id: OWNER_ID,
    ...overrides,
  };
}

function readAssignmentRequest(assignmentRecord, overrides = {}) {
  return {
    assignment_id: assignmentRecord.assignment_id,
    owner_id: OWNER_ID,
    now_ms: 60,
    ...overrides,
  };
}

function assertStoreError(fn, code = null) {
  assert.throws(
    fn,
    (error) => {
      assert.ok(error instanceof BuilderAgentSupervisionLeaseStoreError);
      if (code !== null) assert.equal(error.code, code);
      const text = `${error.name}:${error.message}:${error.stack}`;
      assert.doesNotMatch(text, /private|credential|api\.deepseek|secret-value|source text|raw lease/iu);
      return true;
    },
  );
}

test('records leases and releases then restores them after restart', (t) => {
  const databasePath = temporaryDatabase(t);
  const store = createBuilderAgentSupervisionLeaseStore(databasePath);
  const { activeStatus, assignmentRecord } = fixture();
  const firstLease = lease(assignmentRecord, activeStatus);
  const firstRelease = release(firstLease);

  assert.equal(store.store_version, BUILDER_AGENT_SUPERVISION_LEASE_STORE_VERSION);
  const leaseResult = store.record_lease(leaseRequest(assignmentRecord, activeStatus, firstLease));
  assert.equal(leaseResult.result_version, BUILDER_AGENT_SUPERVISION_LEASE_STORE_RESULT_VERSION);
  assert.equal(leaseResult.operation, 'lease_recorded');
  assert.deepEqual(leaseResult.lease, firstLease);
  assert.equal(leaseResult.lease_evidence.lease_authority, 'main_owned_agent_supervision_lease_store');
  assert.equal(leaseResult.lease_evidence.renderer_authority, 'not_present');
  assert.equal(leaseResult.lease_evidence.ipc_authority, 'not_present');
  assert.equal(leaseResult.lease_evidence.provider_dispatch, false);
  assert.equal(leaseResult.lease_evidence.tool_dispatch, false);
  assert.equal(leaseResult.lease_evidence.permission_grant_authority, false);
  assert.equal(leaseResult.lease_evidence.credential_storage, 'not_present');
  assert.equal(leaseResult.lease_evidence.source_access, 'not_present');
  assert.equal(leaseResult.lease_evidence.revision_authority, false);
  assert.equal(leaseResult.lease_evidence.review_authority, false);
  assert.equal(leaseResult.lease_evidence.schema_version, BUILDER_AGENT_SUPERVISION_LEASE_STORE_SCHEMA_VERSION);
  assert.equal(leaseResult.lease_evidence.user_version, BUILDER_AGENT_SUPERVISION_LEASE_STORE_USER_VERSION);
  assert.match(leaseResult.lease_evidence.schema_fingerprint_digest, /^[a-f0-9]{64}$/u);

  assert.equal(
    store.record_lease(leaseRequest(assignmentRecord, activeStatus, firstLease)).operation,
    'lease_replayed',
  );
  assert.equal(store.read_lease(readLeaseRequest(firstLease)).status, 'ready');

  const activeRead = store.read_assignment_leases(readAssignmentRequest(assignmentRecord, { now_ms: 60 }));
  assert.equal(activeRead.result_version, BUILDER_AGENT_SUPERVISION_LEASE_STORE_READ_RESULT_VERSION);
  assert.equal(activeRead.status, 'ready');
  assert.deepEqual(activeRead.active_lease.lease, firstLease);
  assert.equal(activeRead.active_lease.release, null);
  assert.equal(Object.isFrozen(activeRead), true);

  const releaseResult = store.record_release({ release: firstRelease });
  assert.equal(releaseResult.operation, 'release_recorded');
  assert.deepEqual(releaseResult.release, firstRelease);
  assert.equal(store.record_release({ release: firstRelease }).operation, 'release_replayed');
  assert.equal(store.read_lease(readLeaseRequest(firstLease)).release.release_outcome, 'completed');
  assert.equal(
    store.read_assignment_leases(readAssignmentRequest(assignmentRecord, { now_ms: 95 })).active_lease,
    null,
  );
  store.close();

  const restarted = createBuilderAgentSupervisionLeaseStore(databasePath);
  const restored = restarted.read_lease(readLeaseRequest(firstLease));
  assert.equal(restored.status, 'ready');
  assert.deepEqual(restored.lease, firstLease);
  assert.deepEqual(restored.release, firstRelease);
  restarted.close();
});

test('enforces one unexpired unreleased lease per assignment and monotonic epochs', (t) => {
  const databasePath = temporaryDatabase(t);
  const store = createBuilderAgentSupervisionLeaseStore(databasePath);
  const { activeStatus, assignmentRecord } = fixture();
  const firstLease = lease(assignmentRecord, activeStatus);
  store.record_lease(leaseRequest(assignmentRecord, activeStatus, firstLease));

  const overlapping = lease(assignmentRecord, activeStatus, {
    lease_epoch: 2,
    lease_holder_id: OTHER_SUPERVISOR_ID,
    acquired_at_ms: 70,
    expires_at_ms: 140,
  });
  assertStoreError(
    () => store.record_lease(leaseRequest(assignmentRecord, activeStatus, overlapping)),
    'builder_agent_supervision_lease_store_conflict',
  );

  const olderEpoch = lease(assignmentRecord, activeStatus, {
    lease_epoch: 1,
    lease_holder_id: OTHER_SUPERVISOR_ID,
    acquired_at_ms: 130,
    expires_at_ms: 180,
  });
  assertStoreError(
    () => store.record_lease(leaseRequest(assignmentRecord, activeStatus, olderEpoch)),
    'builder_agent_supervision_lease_store_conflict',
  );

  const expiredSuccessor = lease(assignmentRecord, activeStatus, {
    lease_epoch: 2,
    lease_holder_id: OTHER_SUPERVISOR_ID,
    acquired_at_ms: 121,
    expires_at_ms: 180,
  });
  assert.equal(
    store.record_lease(leaseRequest(assignmentRecord, activeStatus, expiredSuccessor)).operation,
    'lease_recorded',
  );
  assert.deepEqual(
    store.read_assignment_leases(readAssignmentRequest(assignmentRecord, { now_ms: 150 })).active_lease.lease,
    expiredSuccessor,
  );

  const releasedAssignment = assignmentRecord;
  const thirdLease = lease(releasedAssignment, activeStatus, {
    lease_epoch: 3,
    lease_holder_id: SUPERVISOR_ID,
    acquired_at_ms: 181,
    expires_at_ms: 220,
  });
  const successorRelease = release(expiredSuccessor, {
    released_by: OTHER_SUPERVISOR_ID,
    lease_holder_id: OTHER_SUPERVISOR_ID,
    released_at_ms: 170,
    release_outcome: 'cancelled',
    reason: 'Owner stopped this supervised attempt.',
  });
  store.record_release({ release: successorRelease });
  assert.equal(
    store.record_lease(leaseRequest(releasedAssignment, activeStatus, thirdLease)).operation,
    'lease_recorded',
  );
  store.close();
});

test('rejects invalid release ordering, owner drift, hostile input, and tampered rows', (t) => {
  const databasePath = temporaryDatabase(t);
  const store = createBuilderAgentSupervisionLeaseStore(databasePath);
  const { activeStatus, assignmentRecord } = fixture();
  const firstLease = lease(assignmentRecord, activeStatus);

  assertStoreError(() => store.record_lease({
    ...leaseRequest(assignmentRecord, activeStatus, firstLease),
    extra: true,
  }));
  assertStoreError(() => store.read_lease({ ...readLeaseRequest(firstLease), extra: true }));
  assertStoreError(() => store.read_assignment_leases({
    ...readAssignmentRequest(assignmentRecord),
    extra: true,
  }));

  let getterCalls = 0;
  const accessor = leaseRequest(assignmentRecord, activeStatus, firstLease);
  Object.defineProperty(accessor, 'lease', {
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new Error('private credential getter');
    },
  });
  assertStoreError(() => store.record_lease(accessor));
  assert.equal(getterCalls, 0);

  let proxyTrapInvoked = false;
  const proxyTrap = () => {
    proxyTrapInvoked = true;
    throw new Error('private proxy marker');
  };
  assertStoreError(() => store.record_lease(new Proxy(
    leaseRequest(assignmentRecord, activeStatus, firstLease),
    {
      getOwnPropertyDescriptor: proxyTrap,
      getPrototypeOf: proxyTrap,
      ownKeys: proxyTrap,
    },
  )));
  assert.equal(proxyTrapInvoked, false);

  store.record_lease(leaseRequest(assignmentRecord, activeStatus, firstLease));
  assert.equal(
    store.read_lease(readLeaseRequest(firstLease, { owner_id: OTHER_OWNER_ID })).status,
    'absent',
  );
  assertStoreError(
    () => store.record_release({ release: { ...release(firstLease), released_at_ms: 121 } }),
    'builder_agent_supervision_lease_store_invalid',
  );
  assertStoreError(() => store.record_release({ release: new Proxy(release(firstLease), {
    getOwnPropertyDescriptor: proxyTrap,
    getPrototypeOf: proxyTrap,
    ownKeys: proxyTrap,
  }) }));
  assert.equal(proxyTrapInvoked, false);
  store.close();

  const raw = new DatabaseSync(databasePath);
  raw.prepare('UPDATE agent_supervision_leases SET task_id = ? WHERE lease_id = ?')
    .run('builder-task:ffffffff-ffff-4fff-8fff-ffffffffffff', firstLease.lease_id);
  raw.close();

  const corrupted = createBuilderAgentSupervisionLeaseStore(databasePath);
  assertStoreError(
    () => corrupted.read_lease(readLeaseRequest(firstLease)),
    'builder_agent_supervision_lease_store_integrity_failed',
  );
  corrupted.close();
});

test('rejects schema drift and unsafe database paths', (t) => {
  const databasePath = temporaryDatabase(t);
  const store = createBuilderAgentSupervisionLeaseStore(databasePath);
  store.close();

  const raw = new DatabaseSync(databasePath);
  raw.exec('CREATE TABLE unexpected_supervision_lease_fact (id TEXT PRIMARY KEY) STRICT');
  raw.close();

  assertStoreError(
    () => createBuilderAgentSupervisionLeaseStore(databasePath),
    'builder_agent_supervision_lease_store_integrity_failed',
  );
  assertStoreError(
    () => createBuilderAgentSupervisionLeaseStore(path.join('relative', 'leases.sqlite')),
    'builder_agent_supervision_lease_store_invalid',
  );

  const notDatabasePath = path.join(path.dirname(databasePath), 'not-a-database.sqlite');
  fs.writeFileSync(notDatabasePath, 'not sqlite private credential marker');
  assertStoreError(
    () => createBuilderAgentSupervisionLeaseStore(notDatabasePath),
    'builder_agent_supervision_lease_store_unavailable',
  );
});

test('source boundary remains a main-only Agent supervision lease store without runtime authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-agent-supervision-lease-store.cjs'),
    'utf8',
  );
  assert.match(source, /main_owned_agent_supervision_lease_store/u);
  assert.match(source, /record_lease/u);
  assert.match(source, /record_release/u);
  assert.match(source, /read_assignment_leases/u);
  assert.match(source, /node:sqlite/u);
  assert.match(source, /utilTypes\.isProxy/u);
  assert.doesNotMatch(
    source,
    /require\(['"](?:electron|node:http|node:https|http|https)['"]\)|ipcMain|ipcRenderer|contextBridge|BrowserWindow|safeStorage|builder-provider|builder-git|dugite|fetch\s*\(|https?:|Authorization|Bearer|child_process|execFile|shell:\s*true|localStorage|sessionStorage|indexedDB|better-sqlite|eval\s*\(|new Function/iu,
  );
});
