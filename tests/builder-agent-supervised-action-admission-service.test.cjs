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
  BUILDER_AGENT_BUDGET_AUDIT_RECORD_KIND,
  BUILDER_AGENT_BUDGET_AUDIT_RECORD_VERSION,
  createBuilderAgentBudgetAuditRecord,
} = require('../electron/builder-agent-budget-audit-contract.cjs');
const {
  createBuilderAgentTaskContextSnapshot,
} = require('../electron/builder-agent-task-context-snapshot.cjs');
const {
  BUILDER_AGENT_TASK_CONTEXT_SNAPSHOT_STORE_VERSION,
  createBuilderAgentTaskContextSnapshotStore,
} = require('../electron/builder-agent-task-context-snapshot-store.cjs');
const {
  BUILDER_AGENT_SUPERVISED_ACTION_ADMISSION_STORE_VERSION,
  createBuilderAgentSupervisedActionAdmissionStore,
} = require('../electron/builder-agent-supervised-action-admission-store.cjs');
const {
  BUILDER_AGENT_SUPERVISED_ACTION_ADMISSION_SERVICE_RESULT_VERSION,
  BUILDER_AGENT_SUPERVISED_ACTION_ADMISSION_SERVICE_VERSION,
  BuilderAgentSupervisedActionAdmissionServiceError,
  createBuilderAgentSupervisedActionAdmissionService,
} = require('../electron/builder-agent-supervised-action-admission-service.cjs');

const OWNER_ID = 'builder-user:11111111-1111-4111-8111-111111111111';
const OTHER_OWNER_ID = 'builder-user:12111111-1111-4111-8111-111111111111';
const AGENT_ID = 'builder-agent:22222222-2222-4222-8222-222222222222';
const PROJECT_ID = 'builder-project:33333333-3333-4333-8333-333333333333';
const CONVERSATION_ID = 'builder-conversation:44444444-4444-4444-8444-444444444444';
const TASK_ID = 'builder-task:55555555-5555-4555-8555-555555555555';
const RUN_ID = 'builder-run:66666666-6666-4666-8666-666666666666';
const SUPERVISOR_ID = 'builder-supervisor:77777777-7777-4777-8777-777777777777';
const MESSAGE_ID = 'builder-message:88888888-8888-4888-8888-888888888888';
const MEMORY_ID = `builder-agent-memory:${'a'.repeat(64)}`;
const ARTIFACT_ID = `builder-artifact:${'b'.repeat(64)}`;
const RUN_EVENT_ID = `builder-run-event:${'c'.repeat(64)}`;
const PERMISSION_ID = `builder-permission:${'d'.repeat(64)}`;
const ACTIONS = Object.freeze(['start_step', 'call_tool', 'read_private_source', 'finish_for_review']);

function temporaryRoot(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function openStores(root) {
  return {
    context_snapshot_store: createBuilderAgentTaskContextSnapshotStore(
      path.join(root, 'task-context-snapshots.sqlite'),
    ),
    admission_store: createBuilderAgentSupervisedActionAdmissionStore(
      path.join(root, 'supervised-action-admissions.sqlite'),
    ),
  };
}

function closeStores(stores) {
  stores.context_snapshot_store.close();
  stores.admission_store.close();
}

function requestId(index) {
  return `builder-agent-action-request:123e4567-e89b-42d3-a456-${index.toString(16).padStart(12, '0')}`;
}

function definitionInput(overrides = {}) {
  return {
    record_version: BUILDER_AGENT_DEFINITION_RECORD_VERSION,
    agent_id: AGENT_ID,
    owner_id: OWNER_ID,
    display_name: 'Builder Agent',
    purpose: 'Admit one store-backed supervised action.',
    created_at_ms: 1,
    ...overrides,
  };
}

function versionInput(overrides = {}) {
  return {
    record_version: BUILDER_AGENT_VERSION_RECORD_VERSION,
    agent_id: AGENT_ID,
    owner_id: OWNER_ID,
    version_number: 1,
    instructions: 'Admit only store-backed task context snapshots.',
    created_at_ms: 2,
    permission_boundary: 'explicit_permission_required',
    ...overrides,
  };
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
    goal: 'Move one store-backed context snapshot through action admission only.',
    created_at_ms: 3,
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

function activeStatusInput(assignment, overrides = {}) {
  return {
    record_version: BUILDER_AGENT_ASSIGNMENT_STATUS_RECORD_VERSION,
    assignment_id: assignment.assignment_id,
    agent_id: AGENT_ID,
    owner_id: OWNER_ID,
    decided_by: OWNER_ID,
    next_status: 'active',
    reason: 'Owner started supervised work.',
    decided_at_ms: 4,
    ...overrides,
  };
}

function leaseInput(assignment, activeStatus, overrides = {}) {
  return {
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
    acquired_at_ms: 20,
    expires_at_ms: 620,
    purpose: 'Supervise one store-backed action admission.',
    redispatch_policy: 'lease_required_no_duplicate_dispatch',
    supervision_state: 'active_assignment_only',
    authority_boundary: 'main_supervision_lease_only',
    ...overrides,
  };
}

function budgetAuditInput(assignment, activeStatus, lease, action, index, overrides = {}) {
  return {
    record_version: BUILDER_AGENT_BUDGET_AUDIT_RECORD_VERSION,
    record_kind: BUILDER_AGENT_BUDGET_AUDIT_RECORD_KIND,
    assignment_id: assignment.assignment_id,
    assignment_status_id: activeStatus.assignment_status_id,
    lease_id: lease.lease_id,
    agent_id: AGENT_ID,
    agent_version_id: assignment.agent_version_id,
    owner_id: OWNER_ID,
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    task_id: TASK_ID,
    run_id: RUN_ID,
    lease_holder_id: SUPERVISOR_ID,
    observed_at_ms: 30 + index,
    requested_next_action: action,
    budget_limits: assignment.budget,
    budget_usage: {
      step_count: action === 'start_step' ? index - 1 : index,
      tool_call_count: 0,
      runtime_ms: 100 + index,
      private_source_bytes: 0,
    },
    outcome: {
      decision: 'allowed',
      reason: 'none',
    },
    audit_contract: 'assignment_budget_checked_before_agent_work',
    ...overrides,
  };
}

function snapshotFixture(action = 'start_step', index = 1) {
  const definition = createBuilderAgentDefinitionRecord(definitionInput());
  const version = createBuilderAgentVersionRecord(versionInput(), definition);
  const assignment = createBuilderAgentAssignmentRecord(
    assignmentInput(version),
    version,
    definition,
  );
  const activeStatus = createBuilderAgentAssignmentStatusRecord(activeStatusInput(assignment), assignment);
  const lease = createBuilderAgentSupervisionLeaseRecord(
    leaseInput(assignment, activeStatus),
    assignment,
    activeStatus,
  );
  const budgetAudit = createBuilderAgentBudgetAuditRecord(
    budgetAuditInput(assignment, activeStatus, lease, action, index),
    assignment,
    activeStatus,
    lease,
  );
  const snapshot = createBuilderAgentTaskContextSnapshot({
    agent_definition: definition,
    agent_version: version,
    assignment,
    active_status: activeStatus,
    lease,
    budget_audit: budgetAudit,
    included_memory_ids: [MEMORY_ID],
    included_message_ids: [MESSAGE_ID],
    included_artifact_ids: [ARTIFACT_ID],
    included_run_event_ids: [RUN_EVENT_ID],
    included_permission_ids: [PERMISSION_ID],
    parent_task_context_projection: null,
    base_project_revision: {
      status: 'available',
      revision_receipt_digest: `sha256:${'e'.repeat(64)}`,
      commit_oid: 'f'.repeat(40),
    },
    token_budget: {
      max_input_tokens: 32_000,
      reserved_output_tokens: 4_096,
      selection_policy: 'deterministic_task_local_budget_v1',
    },
    created_at_ms: 40 + index,
  });
  return { snapshot };
}

function serviceFor(t) {
  const root = temporaryRoot('clawfabric-builder-agent-supervised-action-admission-service-');
  const stores = openStores(root);
  const service = createBuilderAgentSupervisedActionAdmissionService(stores);
  t.after(() => {
    closeStores(stores);
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, service, stores };
}

function seedSnapshot(stores, record) {
  stores.context_snapshot_store.record_snapshot({ snapshot: record.snapshot });
}

function request(record, index = 1, overrides = {}) {
  return {
    owner_id: OWNER_ID,
    snapshot_id: record.snapshot.snapshot_id,
    action_request_id: requestId(index),
    requested_next_action: record.snapshot.action_admission.requested_next_action,
    run_status: 'running',
    interrupt_requested: false,
    cancel_requested: false,
    now_ms: record.snapshot.created_at_ms + 5,
    ...overrides,
  };
}

function assertServiceError(fn, code) {
  assert.throws(
    fn,
    (error) => error instanceof BuilderAgentSupervisedActionAdmissionServiceError
      && error.code === code
      && !/private|credential|api\.deepseek|secret-value|source text|raw prompt|file content|patch body/iu
        .test(String(error.stack)),
  );
}

test('records a supervised action admission only from a store-backed context snapshot', (t) => {
  const { service, stores } = serviceFor(t);
  const record = snapshotFixture('call_tool', 2);
  seedSnapshot(stores, record);
  const result = service.record_supervised_action_admission(request(record, 2));

  assert.equal(result.result_version, BUILDER_AGENT_SUPERVISED_ACTION_ADMISSION_SERVICE_RESULT_VERSION);
  assert.equal(result.service_version, BUILDER_AGENT_SUPERVISED_ACTION_ADMISSION_SERVICE_VERSION);
  assert.equal(result.operation, 'agent_supervised_action_admission_recorded');
  assert.equal(result.status, 'ready');
  assert.equal(result.requested_next_action, 'call_tool');
  assert.equal(result.next_gate, 'tool_call_record_required_later');
  assert.equal(result.supervised_action_admission.snapshot_id, record.snapshot.snapshot_id);
  assert.equal(result.snapshot_read.status, 'ready');
  assert.equal(result.task_snapshots.agent_task_context_snapshots.length, 1);
  assert.equal(result.run_snapshots.agent_task_context_snapshots.length, 1);
  assert.equal(result.admission_write.operation, 'supervised_action_admission_recorded');
  assert.equal(result.admission_read.status, 'ready');
  assert.equal(result.admission_for_snapshot.status, 'ready');
  assert.equal(result.task_admissions.supervised_action_admissions.length, 1);
  assert.equal(result.run_admissions.supervised_action_admissions.length, 1);
  assert.equal(result.operations.admission_store, 'supervised_action_admission_recorded');
  assert.equal(result.evidence.service_authority, 'main_owned_agent_supervised_action_admission_service');
  assert.equal(result.evidence.context_snapshot_store_authority, 'main_owned_agent_task_context_snapshot_store');
  assert.equal(result.evidence.admission_store_authority, 'main_owned_agent_supervised_action_admission_store');
  assert.equal(result.evidence.next_action_dispatch, false);
  assert.equal(result.evidence.provider_dispatch, false);
  assert.equal(result.evidence.tool_dispatch, false);
  assert.equal(result.evidence.permission_grant_authority, false);
  assert.equal(result.evidence.source_access, 'not_present');
  assert.equal(result.evidence.source_write, 'not_present');
  assert.equal(result.evidence.revision_authority, false);
  assert.equal(result.evidence.review_authority, false);
  assert.equal(result.evidence.artifact_authority, false);
  assert.equal(result.evidence.raw_context_storage, false);

  const replay = service.record_supervised_action_admission(request(record, 2));
  assert.equal(replay.operations.admission_store, 'supervised_action_admission_replayed');
  assert.deepEqual(replay.supervised_action_admission, result.supervised_action_admission);
});

test('records all next action admissions and recovers through restart', () => {
  const root = temporaryRoot('clawfabric-builder-agent-supervised-action-admission-service-restart-');
  const stores = openStores(root);
  const service = createBuilderAgentSupervisedActionAdmissionService(stores);
  const records = ACTIONS.map((action, index) => snapshotFixture(action, index + 1));
  for (const [index, record] of records.entries()) {
    seedSnapshot(stores, record);
    service.record_supervised_action_admission(request(record, index + 1));
  }
  assert.deepEqual(
    stores.admission_store.list_task_admissions({
      owner_id: OWNER_ID,
      project_id: PROJECT_ID,
      task_id: TASK_ID,
    }).supervised_action_admissions.map((entry) => entry.admission.requested_next_action),
    ACTIONS,
  );
  closeStores(stores);

  const reopened = openStores(root);
  const restarted = createBuilderAgentSupervisedActionAdmissionService(reopened);
  const replay = restarted.record_supervised_action_admission(request(records[3], 4));
  assert.equal(replay.operations.admission_store, 'supervised_action_admission_replayed');
  assert.equal(
    replay.supervised_action_admission.next_gate,
    'project_work_result_required_later',
  );
  closeStores(reopened);
  fs.rmSync(root, { recursive: true, force: true });
});

test('fails closed without a stored snapshot or when action/run state drifts', (t) => {
  const { service, stores } = serviceFor(t);
  const record = snapshotFixture('read_private_source', 3);
  assertServiceError(
    () => service.record_supervised_action_admission(request(record, 3)),
    'builder_agent_supervised_action_admission_service_conflict',
  );

  seedSnapshot(stores, record);
  assertServiceError(
    () => service.record_supervised_action_admission(request(record, 3, {
      owner_id: OTHER_OWNER_ID,
    })),
    'builder_agent_supervised_action_admission_service_conflict',
  );
  assertServiceError(
    () => service.record_supervised_action_admission(request(record, 3, {
      requested_next_action: 'call_tool',
    })),
    'builder_agent_supervised_action_admission_service_invalid',
  );
  assertServiceError(
    () => service.record_supervised_action_admission(request(record, 3, {
      run_status: 'completed',
    })),
    'builder_agent_supervised_action_admission_service_invalid',
  );
  assertServiceError(
    () => service.record_supervised_action_admission(request(record, 3, {
      interrupt_requested: true,
    })),
    'builder_agent_supervised_action_admission_service_invalid',
  );
  assertServiceError(
    () => service.record_supervised_action_admission(request(record, 3, {
      cancel_requested: true,
    })),
    'builder_agent_supervised_action_admission_service_invalid',
  );
  assertServiceError(
    () => service.record_supervised_action_admission(request(record, 3, {
      now_ms: record.snapshot.created_at_ms - 1,
    })),
    'builder_agent_supervised_action_admission_service_invalid',
  );
});

test('fails closed for replay conflict, malformed stores, and hostile input', (t) => {
  const { service, stores } = serviceFor(t);
  const record = snapshotFixture('finish_for_review', 4);
  seedSnapshot(stores, record);
  service.record_supervised_action_admission(request(record, 4));
  assertServiceError(
    () => service.record_supervised_action_admission(request(record, 99, {
      now_ms: record.snapshot.created_at_ms + 6,
    })),
    'builder_agent_supervised_action_admission_service_conflict',
  );
  assertServiceError(
    () => createBuilderAgentSupervisedActionAdmissionService({
      context_snapshot_store: { store_version: BUILDER_AGENT_TASK_CONTEXT_SNAPSHOT_STORE_VERSION },
      admission_store: stores.admission_store,
    }),
    'builder_agent_supervised_action_admission_service_invalid',
  );
  assertServiceError(
    () => createBuilderAgentSupervisedActionAdmissionService({
      context_snapshot_store: stores.context_snapshot_store,
      admission_store: { store_version: BUILDER_AGENT_SUPERVISED_ACTION_ADMISSION_STORE_VERSION },
    }),
    'builder_agent_supervised_action_admission_service_invalid',
  );

  let invoked = false;
  const hostile = request(record, 4);
  Object.defineProperty(hostile, 'now_ms', {
    enumerable: true,
    get() {
      invoked = true;
      throw new Error('secret-value');
    },
  });
  assertServiceError(
    () => service.record_supervised_action_admission(hostile),
    'builder_agent_supervised_action_admission_service_invalid',
  );
  assert.equal(invoked, false);
  assertServiceError(
    () => service.record_supervised_action_admission(new Proxy(request(record, 4), {})),
    'builder_agent_supervised_action_admission_service_invalid',
  );
});

test('source boundary remains main-only and exposes no runtime authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-agent-supervised-action-admission-service.cjs'),
    'utf8',
  );

  assert.doesNotMatch(
    source,
    /require\(['"](?:electron|node:http|node:https|http|https)['"]\)|ipcMain|ipcRenderer|contextBridge|BrowserWindow|safeStorage|builder-provider|builder-git|dugite|fetch\s*\(|https?:|Authorization|Bearer|child_process|execFile|spawn\s*\(|writeFile|rmSync|shell:\s*true|localStorage|sessionStorage|indexedDB|better-sqlite|eval\s*\(|new Function|record_grant|provider_secret|credential_secret|file_content|source_tree|commit_oid|tree_oid|stdout|stderr/iu,
  );
  assert.match(source, /service_authority: 'main_owned_agent_supervised_action_admission_service'/u);
  assert.match(source, /context_snapshot_store_authority: 'main_owned_agent_task_context_snapshot_store'/u);
  assert.match(source, /admission_store_authority: 'main_owned_agent_supervised_action_admission_store'/u);
  assert.match(source, /admission_contract_authority: 'main_agent_supervised_action_admission_contract_v1'/u);
  assert.match(source, /next_action_dispatch: false/u);
  assert.match(source, /provider_dispatch: false/u);
  assert.match(source, /tool_dispatch: false/u);
  assert.match(source, /source_write: 'not_present'/u);
  assert.match(source, /raw_context_storage: false/u);
});
