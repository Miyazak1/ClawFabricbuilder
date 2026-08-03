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
  BUILDER_AGENT_GOAL_RECORD_VERSION,
  BUILDER_AGENT_GOAL_STATUS_RECORD_VERSION,
  createBuilderAgentGoalRecord,
  createBuilderAgentGoalStatusRecord,
} = require('../electron/builder-agent-goal-contract.cjs');
const {
  BUILDER_AGENT_GOAL_STORE_READ_RESULT_VERSION,
  BUILDER_AGENT_GOAL_STORE_RESULT_VERSION,
  BUILDER_AGENT_GOAL_STORE_SCHEMA_VERSION,
  BUILDER_AGENT_GOAL_STORE_USER_VERSION,
  BUILDER_AGENT_GOAL_STORE_VERSION,
  BuilderAgentGoalStoreError,
  createBuilderAgentGoalStore,
} = require('../electron/builder-agent-goal-store.cjs');

const OWNER_ID = 'builder-user:123e4567-e89b-42d3-a456-426614174000';
const OTHER_OWNER_ID = 'builder-user:123e4567-e89b-42d3-a456-426614174001';
const AGENT_ID = 'builder-agent:123e4567-e89b-42d3-a456-426614174002';
const OTHER_AGENT_ID = 'builder-agent:123e4567-e89b-42d3-a456-426614174003';
const PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174004';
const CONVERSATION_ID = 'builder-conversation:123e4567-e89b-42d3-a456-426614174005';
const TASK_ID = 'builder-task:123e4567-e89b-42d3-a456-426614174006';

function temporaryDatabase(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawfabric-builder-agent-goals-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return path.join(root, 'agent-goals.sqlite');
}

function definitionInput(overrides = {}) {
  return {
    record_version: BUILDER_AGENT_DEFINITION_RECORD_VERSION,
    agent_id: AGENT_ID,
    owner_id: OWNER_ID,
    display_name: 'Builder Assistant',
    purpose: 'Help the owner continue bounded local Builder work.',
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
    instructions: 'Ask before changing files. Keep working only inside approved bounds.',
    created_at_ms: 20,
    permission_boundary: 'explicit_permission_required',
    ...overrides,
  };
}

function version(definitionRecord, overrides = {}) {
  return createBuilderAgentVersionRecord(versionInput(overrides), definitionRecord);
}

function goalInput(agentVersionRecord, overrides = {}) {
  return {
    record_version: BUILDER_AGENT_GOAL_RECORD_VERSION,
    agent_id: AGENT_ID,
    agent_version_id: agentVersionRecord.agent_version_id,
    owner_id: OWNER_ID,
    created_by: OWNER_ID,
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    task_id: TASK_ID,
    objective: 'Keep improving the Builder conversation workspace until the owner can review a working result.',
    created_at_ms: 30,
    permission_boundary: 'explicit_permission_required',
    supervision_policy: 'owner_supervised',
    execution_contract: 'continuous_until_done_or_blocked',
    completion_contract: 'owner_review_required_before_done',
    budget: {
      max_steps: 24,
      max_runs: 6,
      max_tool_calls: 12,
      max_runtime_ms: 300_000,
      max_private_source_bytes: 65_536,
    },
    ...overrides,
  };
}

function goal(agentDefinition, agentVersion, overrides = {}) {
  return createBuilderAgentGoalRecord(goalInput(agentVersion, overrides), agentVersion, agentDefinition);
}

function statusInput(goalRecord, overrides = {}) {
  return {
    record_version: BUILDER_AGENT_GOAL_STATUS_RECORD_VERSION,
    goal_id: goalRecord.goal_id,
    agent_id: goalRecord.agent_id,
    owner_id: goalRecord.owner_id,
    decided_by: goalRecord.owner_id,
    next_status: 'active',
    reason: 'Owner accepted the bounded goal.',
    decided_at_ms: 40,
    ...overrides,
  };
}

function status(goalRecord, overrides = {}) {
  return createBuilderAgentGoalStatusRecord(statusInput(goalRecord, overrides), goalRecord);
}

function goalRequest(agentDefinition, agentVersion, goalRecord) {
  return {
    definition: agentDefinition,
    version: agentVersion,
    goal: goalRecord,
  };
}

function readRequest(goalRecord, overrides = {}) {
  return {
    goal_id: goalRecord.goal_id,
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
      assert.ok(error instanceof BuilderAgentGoalStoreError);
      if (code !== null) assert.equal(error.code, code);
      const text = `${error.name}:${error.message}:${error.stack}`;
      assert.doesNotMatch(text, /private|credential|api\.deepseek|secret-value|source text|raw goal/iu);
      return true;
    },
  );
}

test('records goals and statuses then restores them after restart', (t) => {
  const databasePath = temporaryDatabase(t);
  const store = createBuilderAgentGoalStore(databasePath);
  const agentDefinition = definition();
  const agentVersion = version(agentDefinition);
  const firstGoal = goal(agentDefinition, agentVersion);
  const active = status(firstGoal);
  const blocked = status(firstGoal, {
    next_status: 'blocked',
    reason: 'Waiting for owner input before continuing.',
    decided_at_ms: 50,
  });
  const resumed = status(firstGoal, {
    next_status: 'active',
    reason: 'Owner provided the missing decision.',
    decided_at_ms: 60,
  });

  assert.equal(store.store_version, BUILDER_AGENT_GOAL_STORE_VERSION);
  const goalResult = store.record_goal(goalRequest(agentDefinition, agentVersion, firstGoal));
  assert.equal(goalResult.result_version, BUILDER_AGENT_GOAL_STORE_RESULT_VERSION);
  assert.equal(goalResult.operation, 'goal_recorded');
  assert.deepEqual(goalResult.goal, firstGoal);
  assert.equal(goalResult.goal_evidence.goal_authority, 'main_owned_agent_goal_store');
  assert.equal(goalResult.goal_evidence.renderer_authority, 'not_present');
  assert.equal(goalResult.goal_evidence.ipc_authority, 'not_present');
  assert.equal(goalResult.goal_evidence.provider_dispatch, false);
  assert.equal(goalResult.goal_evidence.tool_dispatch, false);
  assert.equal(goalResult.goal_evidence.assignment_authority, false);
  assert.equal(goalResult.goal_evidence.run_authority, false);
  assert.equal(goalResult.goal_evidence.permission_grant_authority, false);
  assert.equal(goalResult.goal_evidence.credential_storage, 'not_present');
  assert.equal(goalResult.goal_evidence.source_access, 'not_present');
  assert.equal(goalResult.goal_evidence.revision_authority, false);
  assert.equal(goalResult.goal_evidence.review_authority, false);
  assert.equal(goalResult.goal_evidence.schema_version, BUILDER_AGENT_GOAL_STORE_SCHEMA_VERSION);
  assert.equal(goalResult.goal_evidence.user_version, BUILDER_AGENT_GOAL_STORE_USER_VERSION);
  assert.match(goalResult.goal_evidence.schema_fingerprint_digest, /^[a-f0-9]{64}$/u);

  assert.equal(store.record_goal(goalRequest(agentDefinition, agentVersion, firstGoal)).operation, 'goal_replayed');
  assert.equal(store.record_status({ status: active }).operation, 'status_recorded');
  assert.equal(store.record_status({ status: active }).operation, 'status_replayed');
  assert.equal(store.record_status({ status: blocked }).operation, 'status_recorded');
  assert.equal(store.record_status({ status: resumed }).operation, 'status_recorded');

  const read = store.read_goal(readRequest(firstGoal));
  assert.equal(read.result_version, BUILDER_AGENT_GOAL_STORE_READ_RESULT_VERSION);
  assert.equal(read.status, 'ready');
  assert.deepEqual(read.goal, firstGoal);
  assert.deepEqual(read.statuses, [active, blocked, resumed]);
  assert.equal(read.current_status, 'active');
  assert.equal(read.evidence.goal_authority, 'main_owned_agent_goal_store');
  assert.equal(Object.isFrozen(read), true);
  assert.equal(Object.isFrozen(read.statuses), true);

  const listed = store.list_task_goals(listRequest());
  assert.equal(listed.status, 'ready');
  assert.equal(listed.goals.length, 1);
  assert.deepEqual(listed.goals[0].goal, firstGoal);
  assert.deepEqual(listed.goals[0].statuses, [active, blocked, resumed]);
  assert.equal(listed.goals[0].current_status, 'active');
  store.close();

  const restarted = createBuilderAgentGoalStore(databasePath);
  const restored = restarted.read_goal(readRequest(firstGoal));
  assert.equal(restored.status, 'ready');
  assert.deepEqual(restored.goal, firstGoal);
  assert.deepEqual(restored.statuses, [active, blocked, resumed]);
  assert.equal(restored.current_status, 'active');
  restarted.close();
});

test('enforces version binding, owner scope, one goal per agent task, and status finality', (t) => {
  const databasePath = temporaryDatabase(t);
  const store = createBuilderAgentGoalStore(databasePath);
  const agentDefinition = definition();
  const agentVersion = version(agentDefinition);
  const firstGoal = goal(agentDefinition, agentVersion);

  assertStoreError(
    () => store.record_goal(goalRequest(agentDefinition, agentVersion, goal(
      agentDefinition,
      agentVersion,
      { created_at_ms: 19 },
    ))),
    'builder_agent_goal_store_invalid',
  );
  assertStoreError(
    () => store.record_goal(goalRequest(
      agentDefinition,
      version(agentDefinition, {
        instructions: 'Different version at the same number.',
      }),
      firstGoal,
    )),
    'builder_agent_goal_store_invalid',
  );

  store.record_goal(goalRequest(agentDefinition, agentVersion, firstGoal));
  assertStoreError(
    () => store.record_goal(goalRequest(agentDefinition, agentVersion, goal(
      agentDefinition,
      agentVersion,
      { objective: 'A different persistent goal on the same task.' },
    ))),
    'builder_agent_goal_store_conflict',
  );

  const wrongOwnerRead = store.read_goal(readRequest(firstGoal, { owner_id: OTHER_OWNER_ID }));
  assert.equal(wrongOwnerRead.status, 'absent');
  assert.equal(wrongOwnerRead.goal, null);
  assert.deepEqual(wrongOwnerRead.statuses, []);

  assertStoreError(
    () => store.record_status({ status: status(firstGoal, {
      next_status: 'paused',
      reason: 'Cannot pause before activation.',
    }) }),
    'builder_agent_goal_store_conflict',
  );
  const active = status(firstGoal);
  const completed = status(firstGoal, {
    next_status: 'completed',
    reason: 'Owner verified the bounded goal is done.',
    decided_at_ms: 50,
  });
  store.record_status({ status: active });
  assertStoreError(
    () => store.record_status({ status: status(firstGoal, {
      next_status: 'blocked',
      reason: 'Older event.',
      decided_at_ms: 39,
    }) }),
    'builder_agent_goal_store_invalid',
  );
  store.record_status({ status: completed });
  assertStoreError(
    () => store.record_status({ status: status(firstGoal, {
      next_status: 'active',
      reason: 'No reactivation after completion.',
      decided_at_ms: 60,
    }) }),
    'builder_agent_goal_store_conflict',
  );

  const otherAgentDefinition = definition({
    agent_id: OTHER_AGENT_ID,
    display_name: 'Review Partner',
  });
  const otherAgentVersion = version(otherAgentDefinition, {
    agent_id: OTHER_AGENT_ID,
    instructions: 'Review bounded work without writing files.',
  });
  const secondGoal = goal(otherAgentDefinition, otherAgentVersion, {
    agent_id: OTHER_AGENT_ID,
    agent_version_id: otherAgentVersion.agent_version_id,
    objective: 'Continue review until the owner has a clear next step.',
    created_at_ms: 70,
  });
  assert.equal(
    store.record_goal(goalRequest(otherAgentDefinition, otherAgentVersion, secondGoal)).operation,
    'goal_recorded',
  );
  assert.equal(store.list_task_goals(listRequest()).goals.length, 2);
  store.close();
});

test('fails closed on malformed input, hostile accessors, proxies, and tampered rows', (t) => {
  const databasePath = temporaryDatabase(t);
  const store = createBuilderAgentGoalStore(databasePath);
  const agentDefinition = definition();
  const agentVersion = version(agentDefinition);
  const firstGoal = goal(agentDefinition, agentVersion);

  assertStoreError(() => store.record_goal({
    ...goalRequest(agentDefinition, agentVersion, firstGoal),
    extra: true,
  }));
  assertStoreError(() => store.read_goal({ ...readRequest(firstGoal), extra: true }));
  assertStoreError(() => store.list_task_goals({ ...listRequest(), extra: true }));

  let getterCalls = 0;
  const accessor = goalRequest(agentDefinition, agentVersion, firstGoal);
  Object.defineProperty(accessor, 'goal', {
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new Error('private credential getter');
    },
  });
  assertStoreError(() => store.record_goal(accessor));
  assert.equal(getterCalls, 0);

  let proxyTrapInvoked = false;
  const proxyTrap = () => {
    proxyTrapInvoked = true;
    throw new Error('private proxy marker');
  };
  assertStoreError(() => store.record_goal(new Proxy(
    goalRequest(agentDefinition, agentVersion, firstGoal),
    {
      getOwnPropertyDescriptor: proxyTrap,
      getPrototypeOf: proxyTrap,
      ownKeys: proxyTrap,
    },
  )));
  assert.equal(proxyTrapInvoked, false);
  assertStoreError(() => store.record_status({ status: new Proxy(status(firstGoal), {
    getOwnPropertyDescriptor: proxyTrap,
    getPrototypeOf: proxyTrap,
    ownKeys: proxyTrap,
  }) }));
  assert.equal(proxyTrapInvoked, false);

  store.record_goal(goalRequest(agentDefinition, agentVersion, firstGoal));
  store.record_status({ status: status(firstGoal) });
  store.close();

  const raw = new DatabaseSync(databasePath);
  raw.prepare('UPDATE agent_goals SET objective = ? WHERE goal_id = ?')
    .run('Changed after record.', firstGoal.goal_id);
  raw.close();

  const corrupted = createBuilderAgentGoalStore(databasePath);
  assertStoreError(
    () => corrupted.read_goal(readRequest(firstGoal)),
    'builder_agent_goal_store_integrity_failed',
  );
  corrupted.close();
});

test('rejects schema drift and unsafe database paths', (t) => {
  const databasePath = temporaryDatabase(t);
  const store = createBuilderAgentGoalStore(databasePath);
  store.close();

  const raw = new DatabaseSync(databasePath);
  raw.exec('CREATE TABLE unexpected_goal_fact (id TEXT PRIMARY KEY) STRICT');
  raw.close();

  assertStoreError(
    () => createBuilderAgentGoalStore(databasePath),
    'builder_agent_goal_store_integrity_failed',
  );
  assertStoreError(
    () => createBuilderAgentGoalStore(path.join('relative', 'goal.sqlite')),
    'builder_agent_goal_store_invalid',
  );

  const notDatabasePath = path.join(path.dirname(databasePath), 'not-a-database.sqlite');
  fs.writeFileSync(notDatabasePath, 'not sqlite private credential marker');
  assertStoreError(
    () => createBuilderAgentGoalStore(notDatabasePath),
    'builder_agent_goal_store_unavailable',
  );
});

test('source boundary remains a main-only Agent Goal store without runtime authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-agent-goal-store.cjs'),
    'utf8',
  );
  assert.match(source, /main_owned_agent_goal_store/u);
  assert.match(source, /record_goal/u);
  assert.match(source, /record_status/u);
  assert.match(source, /read_goal/u);
  assert.match(source, /list_task_goals/u);
  assert.match(source, /node:sqlite/u);
  assert.match(source, /utilTypes\.isProxy/u);
  assert.doesNotMatch(
    source,
    /require\(['"](?:electron|node:http|node:https|http|https|node:child_process|child_process)['"]\)|ipcMain|ipcRenderer|contextBridge|BrowserWindow|safeStorage|builder-provider|builder-git|dugite|fetch\s*\(|https?:|Authorization|Bearer|execFile\s*\(|spawn\s*\(|shell:\s*true|localStorage|sessionStorage|indexedDB|better-sqlite|eval\s*\(|new Function/iu,
  );
});
