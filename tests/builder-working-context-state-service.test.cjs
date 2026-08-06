'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  BUILDER_TASK_CAPSULE_STORE_VERSION,
  createBuilderTaskCapsuleStore,
} = require('../electron/builder-task-capsule-store.cjs');
const {
  BUILDER_TASK_CAPSULE_VERSION,
  BUILDER_WORKING_BRIEF_VERSION,
  createBuilderTaskCapsuleUpdate,
} = require('../electron/builder-task-capsule-contract.cjs');
const {
  BUILDER_WORKING_CONTEXT_STATE_SERVICE_RESULT_VERSION,
  BUILDER_WORKING_CONTEXT_STATE_SERVICE_VERSION,
  BuilderWorkingContextStateServiceError,
  createBuilderWorkingContextStateService,
} = require('../electron/builder-working-context-state-service.cjs');

const PROJECT_UUID = '123e4567-e89b-42d3-a456-426614174200';
const PROJECT_ID = `builder-project:${PROJECT_UUID}`;
const SESSION_ID = 'builder-session:123e4567-e89b-42d3-a456-426614174201';
const TASK_ADDRESS_ID = 'builder-task-address:123e4567-e89b-42d3-a456-426614174202';
const CONVERSATION_ID = `builder-conversation:${PROJECT_UUID}`;
const TASK_ID = 'builder-task:123e4567-e89b-42d3-a456-426614174203';
const TURN_ID = 'builder-turn:123e4567-e89b-42d3-a456-426614174204';
const RUN_ID = 'builder-run:123e4567-e89b-42d3-a456-426614174205';
const MESSAGE_ID = 'builder-message:123e4567-e89b-42d3-a456-426614174206';
const ROUTE_DECISION_ID = 'builder-route-decision:123e4567-e89b-42d3-a456-426614174207';

function temporaryDatabase() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawfabric-builder-working-context-'));
  return {
    databasePath: path.join(root, 'task-capsules.sqlite'),
    root,
  };
}

function digest(char) {
  return `sha256:${char.repeat(64)}`;
}

function sourceRef(overrides = {}) {
  return {
    source_kind: 'task_capsule_update',
    source_digest: digest('a'),
    ...overrides,
  };
}

function workingBrief(overrides = {}) {
  return {
    brief_version: BUILDER_WORKING_BRIEF_VERSION,
    source: 'task_capsule_update',
    latest_user_goal: 'Build a focused photographer portfolio homepage.',
    assistant_proposal: 'Use a gallery, concise intro, and contact section.',
    approved_plan: null,
    use_when_instruction_is_contextual: true,
    ...overrides,
  };
}

function taskCapsule(overrides = {}) {
  return {
    capsule_version: BUILDER_TASK_CAPSULE_VERSION,
    task_id: TASK_ID,
    project_id: PROJECT_ID,
    title: 'Photographer portfolio',
    goal: 'Create the portfolio homepage from the current discussion.',
    status: 'ready',
    current_brief: workingBrief(),
    last_route_decision_id: ROUTE_DECISION_ID,
    updated_at_ms: 1_200,
    ...overrides,
  };
}

function taskCapsuleUpdate(overrides = {}) {
  const capsule = taskCapsule(overrides.task_capsule ?? {});
  return createBuilderTaskCapsuleUpdate({
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    turn_id: TURN_ID,
    run_id: RUN_ID,
    message_id: MESSAGE_ID,
    route_decision_id: capsule.last_route_decision_id,
    task_capsule: capsule,
    updated_at_ms: capsule.updated_at_ms,
  });
}

function request(overrides = {}) {
  return {
    project_id: PROJECT_ID,
    session_id: SESSION_ID,
    task_address_id: TASK_ADDRESS_ID,
    conversation_id: CONVERSATION_ID,
    objective_summary: 'Build a focused photographer portfolio homepage.',
    confirmed_constraints: ['Use a gallery.', 'Keep intro copy concise.'],
    rejected_constraints: [],
    open_questions: [],
    latest_user_intent: 'Use the current direction.',
    source_refs: [sourceRef()],
    approved_plan_ref: null,
    base_revision_ref: null,
    invalidated_by: null,
    updated_at_ms: 1_300,
    ...overrides,
  };
}

function fixture(t) {
  const temp = temporaryDatabase();
  const store = createBuilderTaskCapsuleStore(temp.databasePath);
  t.after(() => {
    store.close();
    fs.rmSync(temp.root, { force: true, recursive: true });
  });
  return {
    store,
    service: createBuilderWorkingContextStateService({ task_capsule_store: store }),
  };
}

function assertServiceError(fn, expectedCode = 'builder_working_context_state_service_invalid') {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof BuilderWorkingContextStateServiceError);
    assert.equal(error.code, expectedCode);
    assert.doesNotMatch(
      `${error.name}:${error.message}:${error.stack}`,
      /secret-value|credential|Authorization|Bearer|provider|source_tree|C:\\Users|api[_-]?key/iu,
    );
    return true;
  });
}

test('projects the latest task capsule store fact into ready Working Context State', (t) => {
  const item = fixture(t);
  const update = taskCapsuleUpdate();
  item.store.record_task_capsule_update({ task_capsule_update: update });

  const result = item.service.read_current_working_context_state(request());

  assert.equal(result.result_version, BUILDER_WORKING_CONTEXT_STATE_SERVICE_RESULT_VERSION);
  assert.equal(result.service_version, BUILDER_WORKING_CONTEXT_STATE_SERVICE_VERSION);
  assert.equal(result.operation, 'working_context_state_projected');
  assert.equal(result.status, 'ready');
  assert.equal(result.project_id, PROJECT_ID);
  assert.equal(result.working_context_state.state, 'ready');
  assert.equal(result.working_context_state.task_capsule_ref.task_id, TASK_ID);
  assert.equal(result.latest_task_capsule.status, 'ready');
  assert.equal(result.latest_task_capsule.update_id, update.update_id);
  assert.equal(result.evidence.service_authority, 'main_working_context_state_projection_service_v1');
  assert.equal(result.evidence.working_context_contract_authority, 'main_working_context_state_contract_v1');
  assert.equal(result.evidence.task_capsule_store_authority, 'main_owned_task_capsule_store');
  assert.equal(result.evidence.task_capsule_store_operation, 'latest_task_capsule_ready_read');
  assert.equal(result.evidence.sqlite_write, 'not_performed');
  assert.equal(result.evidence.conversation_append, false);
  assert.equal(result.evidence.provider_dispatch, false);
  assert.equal(result.evidence.tool_dispatch, false);
  assert.equal(result.evidence.source_mutation, false);
  assert.equal(result.evidence.git_mutation, false);
  assert.equal(result.evidence.permission_grant, false);
  assert.equal(result.evidence.revision_admission, 'not_created');
  assert.equal(Object.isFrozen(result), true);
  assert.deepEqual(
    item.store.read_latest_task_capsule({ project_id: PROJECT_ID }).task_capsule_update.task_capsule_update,
    update,
  );
});

test('does not turn compaction-only context into executable readiness when the store is empty', (t) => {
  const item = fixture(t);

  const result = item.service.read_current_working_context_state(request({
    objective_summary: null,
    confirmed_constraints: [],
    rejected_constraints: [],
    open_questions: [],
    latest_user_intent: null,
    source_refs: [sourceRef({ source_kind: 'compaction_summary', source_digest: digest('b') })],
  }));

  assert.equal(result.status, 'empty');
  assert.equal(result.latest_task_capsule.status, 'absent');
  assert.equal(result.latest_task_capsule.update_id, null);
  assert.equal(result.working_context_state.task_capsule_ref, null);
  assert.equal(result.evidence.task_capsule_store_operation, 'latest_task_capsule_absent_read');
});

test('projects approved plan and stale correction state without writing to the task capsule store', (t) => {
  const item = fixture(t);
  const update = taskCapsuleUpdate();
  item.store.record_task_capsule_update({ task_capsule_update: update });

  const approved = item.service.read_current_working_context_state(request({
    approved_plan_ref: {
      plan_result_digest: digest('c'),
      conversation_head_digest: digest('d'),
      approved_at_ms: 1_250,
    },
    source_refs: [
      sourceRef(),
      sourceRef({ source_kind: 'approved_plan', source_digest: digest('c') }),
    ],
  }));
  assert.equal(approved.status, 'approved_plan_ready');
  assert.equal(approved.working_context_state.approved_plan_ref.plan_result_digest, digest('c'));

  const stale = item.service.read_current_working_context_state(request({
    invalidated_by: {
      source: 'brief_correction',
      route_decision_id: ROUTE_DECISION_ID,
      invalidated_at_ms: 1_260,
    },
    source_refs: [
      sourceRef(),
      sourceRef({ source_kind: 'brief_correction', source_digest: digest('e') }),
    ],
  }));
  assert.equal(stale.status, 'stale');
  assert.equal(stale.working_context_state.invalidated_by.source, 'brief_correction');
  assert.equal(
    item.store.read_latest_task_capsule({ project_id: PROJECT_ID }).task_capsule_update.task_capsule_update.update_id,
    update.update_id,
  );
});

test('restores projection after task capsule store restart', (t) => {
  const temp = temporaryDatabase();
  const store = createBuilderTaskCapsuleStore(temp.databasePath);
  const update = taskCapsuleUpdate();
  store.record_task_capsule_update({ task_capsule_update: update });
  store.close();

  const restarted = createBuilderTaskCapsuleStore(temp.databasePath);
  t.after(() => {
    restarted.close();
    fs.rmSync(temp.root, { force: true, recursive: true });
  });
  const service = createBuilderWorkingContextStateService({ task_capsule_store: restarted });
  const result = service.read_current_working_context_state(request());

  assert.equal(result.status, 'ready');
  assert.equal(result.latest_task_capsule.update_id, update.update_id);
  assert.equal(result.working_context_state.task_capsule_ref.status, 'ready');
});

test('fails closed for malformed requests, forged stores, and hostile read results', (t) => {
  const item = fixture(t);
  assertServiceError(() => item.service.read_current_working_context_state({
    ...request(),
    source_tree: { files: [] },
  }));
  assertServiceError(() => item.service.read_current_working_context_state(request({
    latest_user_intent: 'api_key: secret-value',
  })));

  assertServiceError(() => createBuilderWorkingContextStateService({
    task_capsule_store: {
      store_version: BUILDER_TASK_CAPSULE_STORE_VERSION,
      read_latest_task_capsule: 'nope',
    },
  }));
  assertServiceError(() => createBuilderWorkingContextStateService(new Proxy({
    task_capsule_store: item.store,
  }, {})));

  const hostileStore = {
    store_version: BUILDER_TASK_CAPSULE_STORE_VERSION,
    read_latest_task_capsule() {
      return {
        result_version: 'builder-task-capsule-store-read-result.v1',
        task_capsule_authority: 'main_owned_task_capsule_store',
        status: 'ready',
        task_capsule_update: null,
        evidence: {
          transaction: 'latest_task_capsule_ready_read',
        },
      };
    },
  };
  const hostileService = createBuilderWorkingContextStateService({ task_capsule_store: hostileStore });
  assertServiceError(() => hostileService.read_current_working_context_state(request()));

  const unavailableStore = {
    store_version: BUILDER_TASK_CAPSULE_STORE_VERSION,
    read_latest_task_capsule() {
      throw new Error('secret-value');
    },
  };
  const unavailableService = createBuilderWorkingContextStateService({ task_capsule_store: unavailableStore });
  assertServiceError(
    () => unavailableService.read_current_working_context_state(request()),
    'builder_working_context_state_service_unavailable',
  );
});

test('source remains a main-only read projection service without runtime authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-working-context-state-service.cjs'),
    'utf8',
  );

  assert.match(source, /builder-working-context-state-service\.v1/u);
  assert.match(source, /read_latest_task_capsule/u);
  assert.doesNotMatch(
    source,
    /ipcMain|ipcRenderer|contextBridge|BrowserWindow|safeStorage|fetch\s*\(|child_process|execFile|spawn|run_command|CREATE TABLE|INSERT INTO|UPDATE\s+\w+|DELETE FROM|record_task_capsule_update/u,
  );
});
