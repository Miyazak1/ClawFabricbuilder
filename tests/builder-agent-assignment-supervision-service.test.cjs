'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

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
  createBuilderAgentSupervisionLeaseRecord,
} = require('../electron/builder-agent-supervision-lease-contract.cjs');
const {
  createBuilderAgentAssignmentStore,
} = require('../electron/builder-agent-assignment-store.cjs');
const {
  createBuilderAgentSupervisionLeaseStore,
} = require('../electron/builder-agent-supervision-lease-store.cjs');
const {
  BUILDER_AGENT_ASSIGNMENT_SUPERVISION_SERVICE_RESULT_VERSION,
  BUILDER_AGENT_ASSIGNMENT_SUPERVISION_SERVICE_VERSION,
  BuilderAgentAssignmentSupervisionServiceError,
  createBuilderAgentAssignmentSupervisionService,
} = require('../electron/builder-agent-assignment-supervision-service.cjs');

const OWNER_ID = 'builder-user:123e4567-e89b-42d3-a456-426614174000';
const AGENT_ID = 'builder-agent:123e4567-e89b-42d3-a456-426614174002';
const PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174004';
const CONVERSATION_ID = 'builder-conversation:123e4567-e89b-42d3-a456-426614174005';
const TASK_ID = 'builder-task:123e4567-e89b-42d3-a456-426614174006';
const RUN_ID = 'builder-run:123e4567-e89b-42d3-a456-426614174007';
const SUPERVISOR_ID = 'builder-supervisor:123e4567-e89b-42d3-a456-426614174008';

function temporaryRoot(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function openStores(root) {
  return {
    assignment_store: createBuilderAgentAssignmentStore(path.join(root, 'assignments.sqlite')),
    lease_store: createBuilderAgentSupervisionLeaseStore(path.join(root, 'leases.sqlite')),
  };
}

function closeStores(stores) {
  stores.assignment_store.close();
  stores.lease_store.close();
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

function fixture() {
  const definition = createBuilderAgentDefinitionRecord(definitionInput());
  const version = createBuilderAgentVersionRecord(versionInput(), definition);
  const assignment = createBuilderAgentAssignmentRecord({
    record_version: BUILDER_AGENT_ASSIGNMENT_RECORD_VERSION,
    agent_id: AGENT_ID,
    agent_version_id: version.agent_version_id,
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
  }, version, definition);
  const queuedStatus = createBuilderAgentAssignmentStatusRecord({
    record_version: BUILDER_AGENT_ASSIGNMENT_STATUS_RECORD_VERSION,
    assignment_id: assignment.assignment_id,
    agent_id: AGENT_ID,
    owner_id: OWNER_ID,
    decided_by: OWNER_ID,
    next_status: 'queued',
    reason: 'Owner queued this admitted Goal assignment.',
    decided_at_ms: 40,
  }, assignment);
  const activeStatusInput = {
    record_version: BUILDER_AGENT_ASSIGNMENT_STATUS_RECORD_VERSION,
    assignment_id: assignment.assignment_id,
    agent_id: AGENT_ID,
    owner_id: OWNER_ID,
    decided_by: OWNER_ID,
    next_status: 'active',
    reason: 'Owner started supervised work.',
    decided_at_ms: 50,
  };
  const activeStatus = createBuilderAgentAssignmentStatusRecord(activeStatusInput, assignment);
  const leaseInput = {
    record_version: BUILDER_AGENT_SUPERVISION_LEASE_RECORD_VERSION,
    assignment_id: assignment.assignment_id,
    assignment_status_id: activeStatus.assignment_status_id,
    agent_id: AGENT_ID,
    owner_id: OWNER_ID,
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    task_id: TASK_ID,
    run_id: RUN_ID,
    lease_holder_id: SUPERVISOR_ID,
    lease_epoch: 1,
    acquired_at_ms: 60,
    expires_at_ms: 180,
    purpose: 'Supervise one active local assignment attempt.',
    redispatch_policy: 'lease_required_no_duplicate_dispatch',
    supervision_state: 'active_assignment_only',
    authority_boundary: 'main_supervision_lease_only',
  };
  const lease = createBuilderAgentSupervisionLeaseRecord(leaseInput, assignment, activeStatus);
  return {
    activeStatus,
    activeStatusInput,
    assignment,
    definition,
    lease,
    leaseInput,
    queuedStatus,
    version,
  };
}

function seedQueuedAssignment(stores, facts) {
  stores.assignment_store.record_assignment({
    definition: facts.definition,
    version: facts.version,
    assignment: facts.assignment,
  });
  stores.assignment_store.record_status({ status: facts.queuedStatus });
}

function request(facts, overrides = {}) {
  return {
    assignment: facts.assignment,
    active_status_input: {
      ...facts.activeStatusInput,
      ...(overrides.active_status_input ?? {}),
    },
    lease_input: {
      ...facts.leaseInput,
      ...(overrides.lease_input ?? {}),
    },
    now_ms: overrides.now_ms ?? 70,
  };
}

function serviceFor(t) {
  const root = temporaryRoot('clawfabric-builder-agent-assignment-supervision-service-');
  const stores = openStores(root);
  const service = createBuilderAgentAssignmentSupervisionService(stores);
  t.after(() => {
    closeStores(stores);
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, service, stores };
}

function assertServiceError(fn, code) {
  assert.throws(
    fn,
    (error) => error instanceof BuilderAgentAssignmentSupervisionServiceError
      && error.code === code
      && !/private|credential|api\.deepseek|secret-value|source text|raw lease/iu.test(String(error.stack)),
  );
}

test('activates a queued Assignment and records an active supervision lease', (t) => {
  const { service, stores } = serviceFor(t);
  const facts = fixture();
  seedQueuedAssignment(stores, facts);

  const result = service.activate_assignment(request(facts));
  assert.equal(result.result_version, BUILDER_AGENT_ASSIGNMENT_SUPERVISION_SERVICE_RESULT_VERSION);
  assert.equal(result.service_version, BUILDER_AGENT_ASSIGNMENT_SUPERVISION_SERVICE_VERSION);
  assert.equal(result.status, 'ready');
  assert.equal(result.assignment_read.current_status, 'active');
  assert.deepEqual(result.active_status, facts.activeStatus);
  assert.deepEqual(result.lease, facts.lease);
  assert.equal(result.lease_read.active_lease.lease.lease_id, facts.lease.lease_id);
  assert.equal(result.operations.assignment_status_store, 'status_recorded');
  assert.equal(result.operations.lease_store, 'lease_recorded');
  assert.equal(result.evidence.service_authority, 'main_owned_agent_assignment_supervision_service');
  assert.equal(result.evidence.provider_dispatch, false);
  assert.equal(result.evidence.tool_dispatch, false);
  assert.equal(result.evidence.run_authority, false);
  assert.equal(result.evidence.source_access, 'not_present');
  assert.equal(result.evidence.revision_authority, false);

  const replay = service.activate_assignment(request(facts));
  assert.equal(replay.operations.assignment_status_store, 'status_replayed');
  assert.equal(replay.operations.lease_store, 'lease_replayed');
  assert.deepEqual(replay.lease, result.lease);
});

test('recovers active supervision across restart through idempotent store replay', () => {
  const root = temporaryRoot('clawfabric-builder-agent-assignment-supervision-service-restart-');
  const facts = fixture();
  const stores = openStores(root);
  seedQueuedAssignment(stores, facts);
  const service = createBuilderAgentAssignmentSupervisionService(stores);
  const first = service.activate_assignment(request(facts));
  closeStores(stores);

  const reopened = openStores(root);
  const restarted = createBuilderAgentAssignmentSupervisionService(reopened);
  const replay = restarted.activate_assignment(request(facts));
  assert.equal(replay.operations.assignment_status_store, 'status_replayed');
  assert.equal(replay.operations.lease_store, 'lease_replayed');
  assert.deepEqual(replay.lease, first.lease);
  closeStores(reopened);
  fs.rmSync(root, { recursive: true, force: true });
});

test('fails closed before execution for missing queue, non-active status, stale lease time, and malformed stores', (t) => {
  const { service, stores } = serviceFor(t);
  const facts = fixture();
  stores.assignment_store.record_assignment({
    definition: facts.definition,
    version: facts.version,
    assignment: facts.assignment,
  });
  assertServiceError(
    () => service.activate_assignment(request(facts)),
    'builder_agent_assignment_supervision_service_conflict',
  );

  stores.assignment_store.record_status({ status: facts.queuedStatus });
  assertServiceError(
    () => service.activate_assignment(request(facts, {
      active_status_input: { next_status: 'cancelled' },
    })),
    'builder_agent_assignment_supervision_service_invalid',
  );
  assertServiceError(
    () => service.activate_assignment(request(facts, { now_ms: 180 })),
    'builder_agent_assignment_supervision_service_invalid',
  );
  const afterStaleLease = stores.assignment_store.read_assignment({
    assignment_id: facts.assignment.assignment_id,
    owner_id: OWNER_ID,
  });
  assert.equal(afterStaleLease.current_status, 'queued');
  assertServiceError(
    () => createBuilderAgentAssignmentSupervisionService({
      assignment_store: {},
      lease_store: stores.lease_store,
    }),
    'builder_agent_assignment_supervision_service_invalid',
  );
});

test('source boundary remains main-only and exposes no runtime authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-agent-assignment-supervision-service.cjs'),
    'utf8',
  );

  assert.doesNotMatch(source, /require\('electron'\)|ipcMain|BrowserWindow|preload|safeStorage|provider-config|provider-secret/iu);
  assert.doesNotMatch(source, /node:child_process|require\(['"]child_process['"]\)|spawn\(|execFile\(|writeFile|rmSync/iu);
  assert.match(source, /service_authority: 'main_owned_agent_assignment_supervision_service'/u);
  assert.match(source, /provider_dispatch: false/u);
  assert.match(source, /tool_dispatch: false/u);
  assert.match(source, /run_authority: false/u);
  assert.match(source, /source_access: 'not_present'/u);
  assert.match(source, /revision_authority: false/u);
});
