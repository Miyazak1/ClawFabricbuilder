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
  BUILDER_AGENT_ASSIGNMENT_STORE_READ_RESULT_VERSION,
  BUILDER_AGENT_ASSIGNMENT_STORE_RESULT_VERSION,
  BUILDER_AGENT_ASSIGNMENT_STORE_SCHEMA_VERSION,
  BUILDER_AGENT_ASSIGNMENT_STORE_USER_VERSION,
  BUILDER_AGENT_ASSIGNMENT_STORE_VERSION,
  BuilderAgentAssignmentStoreError,
  createBuilderAgentAssignmentStore,
} = require('../electron/builder-agent-assignment-store.cjs');

const OWNER_ID = 'builder-user:123e4567-e89b-42d3-a456-426614174000';
const OTHER_OWNER_ID = 'builder-user:123e4567-e89b-42d3-a456-426614174001';
const AGENT_ID = 'builder-agent:123e4567-e89b-42d3-a456-426614174002';
const PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174004';
const CONVERSATION_ID = 'builder-conversation:123e4567-e89b-42d3-a456-426614174005';
const TASK_ID = 'builder-task:123e4567-e89b-42d3-a456-426614174006';
const RUN_ID = 'builder-run:123e4567-e89b-42d3-a456-426614174007';
const OTHER_RUN_ID = 'builder-run:123e4567-e89b-42d3-a456-426614174008';

function temporaryDatabase(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawfabric-builder-agent-assignments-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return path.join(root, 'agent-assignments.sqlite');
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

function assignmentInput(agentVersionRecord, overrides = {}) {
  return {
    record_version: BUILDER_AGENT_ASSIGNMENT_RECORD_VERSION,
    agent_id: AGENT_ID,
    agent_version_id: agentVersionRecord.agent_version_id,
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
    next_status: 'queued',
    reason: 'Owner queued this supervised local assignment.',
    decided_at_ms: 40,
    ...overrides,
  };
}

function status(assignmentRecord, overrides = {}) {
  return createBuilderAgentAssignmentStatusRecord(statusInput(assignmentRecord, overrides), assignmentRecord);
}

function assignmentRequest(agentDefinition, agentVersion, assignmentRecord) {
  return {
    definition: agentDefinition,
    version: agentVersion,
    assignment: assignmentRecord,
  };
}

function readRequest(assignmentRecord, overrides = {}) {
  return {
    assignment_id: assignmentRecord.assignment_id,
    owner_id: OWNER_ID,
    ...overrides,
  };
}

function listRequest(overrides = {}) {
  return {
    owner_id: OWNER_ID,
    project_id: PROJECT_ID,
    task_id: TASK_ID,
    ...overrides,
  };
}

function assertStoreError(fn, code = null) {
  assert.throws(
    fn,
    (error) => {
      assert.ok(error instanceof BuilderAgentAssignmentStoreError);
      if (code !== null) assert.equal(error.code, code);
      const text = `${error.name}:${error.message}:${error.stack}`;
      assert.doesNotMatch(text, /private|credential|api\.deepseek|secret-value|source text|raw assignment/iu);
      return true;
    },
  );
}

test('records assignments and statuses then restores them after restart', (t) => {
  const databasePath = temporaryDatabase(t);
  const store = createBuilderAgentAssignmentStore(databasePath);
  const agentDefinition = definition();
  const agentVersion = version(agentDefinition);
  const firstAssignment = assignment(agentDefinition, agentVersion);
  const queued = status(firstAssignment);
  const active = status(firstAssignment, {
    next_status: 'active',
    reason: 'Owner started supervised work.',
    decided_at_ms: 50,
  });

  assert.equal(store.store_version, BUILDER_AGENT_ASSIGNMENT_STORE_VERSION);
  const assignmentResult = store.record_assignment(assignmentRequest(agentDefinition, agentVersion, firstAssignment));
  assert.equal(assignmentResult.result_version, BUILDER_AGENT_ASSIGNMENT_STORE_RESULT_VERSION);
  assert.equal(assignmentResult.operation, 'assignment_recorded');
  assert.deepEqual(assignmentResult.assignment, firstAssignment);
  assert.equal(assignmentResult.assignment_evidence.assignment_authority, 'main_owned_agent_assignment_store');
  assert.equal(assignmentResult.assignment_evidence.renderer_authority, 'not_present');
  assert.equal(assignmentResult.assignment_evidence.ipc_authority, 'not_present');
  assert.equal(assignmentResult.assignment_evidence.provider_dispatch, false);
  assert.equal(assignmentResult.assignment_evidence.tool_dispatch, false);
  assert.equal(assignmentResult.assignment_evidence.permission_grant_authority, false);
  assert.equal(assignmentResult.assignment_evidence.credential_storage, 'not_present');
  assert.equal(assignmentResult.assignment_evidence.source_access, 'not_present');
  assert.equal(assignmentResult.assignment_evidence.revision_authority, false);
  assert.equal(assignmentResult.assignment_evidence.review_authority, false);
  assert.equal(assignmentResult.assignment_evidence.schema_version, BUILDER_AGENT_ASSIGNMENT_STORE_SCHEMA_VERSION);
  assert.equal(assignmentResult.assignment_evidence.user_version, BUILDER_AGENT_ASSIGNMENT_STORE_USER_VERSION);
  assert.match(assignmentResult.assignment_evidence.schema_fingerprint_digest, /^[a-f0-9]{64}$/u);

  assert.equal(
    store.record_assignment(assignmentRequest(agentDefinition, agentVersion, firstAssignment)).operation,
    'assignment_replayed',
  );
  assert.equal(store.record_status({ status: queued }).operation, 'status_recorded');
  assert.equal(store.record_status({ status: queued }).operation, 'status_replayed');
  assert.equal(store.record_status({ status: active }).operation, 'status_recorded');

  const read = store.read_assignment(readRequest(firstAssignment));
  assert.equal(read.result_version, BUILDER_AGENT_ASSIGNMENT_STORE_READ_RESULT_VERSION);
  assert.equal(read.status, 'ready');
  assert.deepEqual(read.assignment, firstAssignment);
  assert.deepEqual(read.statuses, [queued, active]);
  assert.equal(read.current_status, 'active');
  assert.equal(read.evidence.assignment_authority, 'main_owned_agent_assignment_store');
  assert.equal(Object.isFrozen(read), true);
  assert.equal(Object.isFrozen(read.statuses), true);

  const listed = store.list_task_assignments(listRequest());
  assert.equal(listed.status, 'ready');
  assert.equal(listed.assignments.length, 1);
  assert.deepEqual(listed.assignments[0].assignment, firstAssignment);
  assert.deepEqual(listed.assignments[0].statuses, [queued, active]);
  assert.equal(listed.assignments[0].current_status, 'active');
  store.close();

  const restarted = createBuilderAgentAssignmentStore(databasePath);
  const restored = restarted.read_assignment(readRequest(firstAssignment));
  assert.equal(restored.status, 'ready');
  assert.deepEqual(restored.assignment, firstAssignment);
  assert.deepEqual(restored.statuses, [queued, active]);
  assert.equal(restored.current_status, 'active');
  restarted.close();
});

test('enforces version binding, owner scope, duplicate run protection, and status finality', (t) => {
  const databasePath = temporaryDatabase(t);
  const store = createBuilderAgentAssignmentStore(databasePath);
  const agentDefinition = definition();
  const agentVersion = version(agentDefinition);
  const firstAssignment = assignment(agentDefinition, agentVersion);

  assertStoreError(
    () => store.record_assignment(assignmentRequest(agentDefinition, agentVersion, assignment(
      agentDefinition,
      agentVersion,
      { created_at_ms: 19 },
    ))),
    'builder_agent_assignment_store_invalid',
  );
  assertStoreError(
    () => store.record_assignment(assignmentRequest(
      agentDefinition,
      version(agentDefinition, {
        instructions: 'Different version at the same number.',
      }),
      firstAssignment,
    )),
    'builder_agent_assignment_store_invalid',
  );

  store.record_assignment(assignmentRequest(agentDefinition, agentVersion, firstAssignment));
  assertStoreError(
    () => store.record_assignment(assignmentRequest(agentDefinition, agentVersion, assignment(
      agentDefinition,
      agentVersion,
      { goal: 'Different assignment on the same run.' },
    ))),
    'builder_agent_assignment_store_conflict',
  );

  const wrongOwnerRead = store.read_assignment(readRequest(firstAssignment, { owner_id: OTHER_OWNER_ID }));
  assert.equal(wrongOwnerRead.status, 'absent');
  assert.equal(wrongOwnerRead.assignment, null);
  assert.deepEqual(wrongOwnerRead.statuses, []);

  assertStoreError(
    () => store.record_status({ status: status(firstAssignment, {
      next_status: 'active',
      reason: 'Cannot start before queued.',
    }) }),
    'builder_agent_assignment_store_conflict',
  );
  const queued = status(firstAssignment);
  const active = status(firstAssignment, {
    next_status: 'active',
    reason: 'Owner started supervised work.',
    decided_at_ms: 50,
  });
  const completed = status(firstAssignment, {
    next_status: 'completed',
    reason: 'Work returned for review.',
    decided_at_ms: 60,
  });
  store.record_status({ status: queued });
  assertStoreError(
    () => store.record_status({ status: status(firstAssignment, {
      next_status: 'paused',
      reason: 'Older event.',
      decided_at_ms: 39,
    }) }),
    'builder_agent_assignment_store_invalid',
  );
  store.record_status({ status: active });
  store.record_status({ status: completed });
  assertStoreError(
    () => store.record_status({ status: status(firstAssignment, {
      next_status: 'active',
      reason: 'No reactivation after completion.',
      decided_at_ms: 70,
    }) }),
    'builder_agent_assignment_store_conflict',
  );

  const secondAssignment = assignment(agentDefinition, agentVersion, {
    run_id: OTHER_RUN_ID,
    created_at_ms: 80,
    goal: 'A second task-bound assignment.',
  });
  assert.equal(
    store.record_assignment(assignmentRequest(agentDefinition, agentVersion, secondAssignment)).operation,
    'assignment_recorded',
  );
  assert.equal(store.list_task_assignments(listRequest()).assignments.length, 2);
  store.close();
});

test('fails closed on malformed input, hostile accessors, proxies, and tampered rows', (t) => {
  const databasePath = temporaryDatabase(t);
  const store = createBuilderAgentAssignmentStore(databasePath);
  const agentDefinition = definition();
  const agentVersion = version(agentDefinition);
  const firstAssignment = assignment(agentDefinition, agentVersion);

  assertStoreError(() => store.record_assignment({
    ...assignmentRequest(agentDefinition, agentVersion, firstAssignment),
    extra: true,
  }));
  assertStoreError(() => store.read_assignment({ ...readRequest(firstAssignment), extra: true }));
  assertStoreError(() => store.list_task_assignments({ ...listRequest(), extra: true }));

  let getterCalls = 0;
  const accessor = assignmentRequest(agentDefinition, agentVersion, firstAssignment);
  Object.defineProperty(accessor, 'assignment', {
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new Error('private credential getter');
    },
  });
  assertStoreError(() => store.record_assignment(accessor));
  assert.equal(getterCalls, 0);

  let proxyTrapInvoked = false;
  const proxyTrap = () => {
    proxyTrapInvoked = true;
    throw new Error('private proxy marker');
  };
  assertStoreError(() => store.record_assignment(new Proxy(
    assignmentRequest(agentDefinition, agentVersion, firstAssignment),
    {
      getOwnPropertyDescriptor: proxyTrap,
      getPrototypeOf: proxyTrap,
      ownKeys: proxyTrap,
    },
  )));
  assert.equal(proxyTrapInvoked, false);
  assertStoreError(() => store.record_status({ status: new Proxy(status(firstAssignment), {
    getOwnPropertyDescriptor: proxyTrap,
    getPrototypeOf: proxyTrap,
    ownKeys: proxyTrap,
  }) }));
  assert.equal(proxyTrapInvoked, false);

  store.record_assignment(assignmentRequest(agentDefinition, agentVersion, firstAssignment));
  store.record_status({ status: status(firstAssignment) });
  store.close();

  const raw = new DatabaseSync(databasePath);
  raw.prepare('UPDATE agent_assignments SET project_id = ? WHERE assignment_id = ?')
    .run('builder-project:ffffffff-ffff-4fff-8fff-ffffffffffff', firstAssignment.assignment_id);
  raw.close();

  const corrupted = createBuilderAgentAssignmentStore(databasePath);
  assertStoreError(
    () => corrupted.read_assignment(readRequest(firstAssignment)),
    'builder_agent_assignment_store_integrity_failed',
  );
  corrupted.close();
});

test('rejects schema drift and unsafe database paths', (t) => {
  const databasePath = temporaryDatabase(t);
  const store = createBuilderAgentAssignmentStore(databasePath);
  store.close();

  const raw = new DatabaseSync(databasePath);
  raw.exec('CREATE TABLE unexpected_assignment_fact (id TEXT PRIMARY KEY) STRICT');
  raw.close();

  assertStoreError(
    () => createBuilderAgentAssignmentStore(databasePath),
    'builder_agent_assignment_store_integrity_failed',
  );
  assertStoreError(
    () => createBuilderAgentAssignmentStore(path.join('relative', 'assignment.sqlite')),
    'builder_agent_assignment_store_invalid',
  );

  const notDatabasePath = path.join(path.dirname(databasePath), 'not-a-database.sqlite');
  fs.writeFileSync(notDatabasePath, 'not sqlite private credential marker');
  assertStoreError(
    () => createBuilderAgentAssignmentStore(notDatabasePath),
    'builder_agent_assignment_store_unavailable',
  );
});

test('source boundary remains a main-only Agent assignment store without runtime authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-agent-assignment-store.cjs'),
    'utf8',
  );
  assert.match(source, /main_owned_agent_assignment_store/u);
  assert.match(source, /record_assignment/u);
  assert.match(source, /record_status/u);
  assert.match(source, /read_assignment/u);
  assert.match(source, /list_task_assignments/u);
  assert.match(source, /node:sqlite/u);
  assert.match(source, /utilTypes\.isProxy/u);
  assert.doesNotMatch(
    source,
    /require\(['"](?:electron|node:http|node:https|http|https)['"]\)|ipcMain|ipcRenderer|contextBridge|BrowserWindow|safeStorage|builder-provider|builder-git|dugite|fetch\s*\(|https?:|Authorization|Bearer|child_process|execFile|shell:\s*true|localStorage|sessionStorage|indexedDB|better-sqlite|eval\s*\(|new Function/iu,
  );
});
