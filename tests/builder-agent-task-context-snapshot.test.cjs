'use strict';

const assert = require('node:assert/strict');
const nodeCrypto = require('node:crypto');
const fs = require('node:fs');
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
  BUILDER_AGENT_TASK_CONTEXT_SNAPSHOT_VERSION,
  BuilderAgentTaskContextSnapshotError,
  createBuilderAgentTaskContextSnapshot,
  sanitizeBuilderAgentTaskContextSnapshot,
} = require('../electron/builder-agent-task-context-snapshot.cjs');

const OWNER_ID = 'builder-user:11111111-1111-4111-8111-111111111111';
const AGENT_ID = 'builder-agent:22222222-2222-4222-8222-222222222222';
const PROJECT_ID = 'builder-project:33333333-3333-4333-8333-333333333333';
const CONVERSATION_ID = 'builder-conversation:44444444-4444-4444-8444-444444444444';
const TASK_ID = 'builder-task:55555555-5555-4555-8555-555555555555';
const RUN_ID = 'builder-run:66666666-6666-4666-8666-666666666666';
const SUPERVISOR_ID = 'builder-supervisor:77777777-7777-4777-8777-777777777777';
const MESSAGE_ID = 'builder-message:88888888-8888-4888-8888-888888888888';
const SECOND_MESSAGE_ID = 'builder-message:99999999-9999-4999-8999-999999999999';
const CHILD_CONVERSATION_ID = 'builder-conversation:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CHILD_TASK_ID = 'builder-task:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CHILD_RUN_ID = 'builder-run:cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const OTHER_TASK_ID = 'builder-task:dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const MEMORY_ID = `builder-agent-memory:${'a'.repeat(64)}`;
const ARTIFACT_ID = `builder-artifact:${'b'.repeat(64)}`;
const RUN_EVENT_ID = `builder-run-event:${'c'.repeat(64)}`;
const PERMISSION_ID = `builder-permission:${'d'.repeat(64)}`;
const BASE_REVISION = Object.freeze({
  status: 'available',
  revision_receipt_digest: `sha256:${'e'.repeat(64)}`,
  commit_oid: 'f'.repeat(40),
});
const NO_BASE_REVISION = Object.freeze({
  status: 'not_available',
  revision_receipt_digest: null,
  commit_oid: null,
});

function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function sha256Canonical(value) {
  return `sha256:${nodeCrypto.createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')}`;
}

function definitionInput(overrides = {}) {
  return {
    record_version: BUILDER_AGENT_DEFINITION_RECORD_VERSION,
    agent_id: AGENT_ID,
    owner_id: OWNER_ID,
    display_name: 'Builder Agent',
    purpose: 'Carry one owner-supervised Builder task.',
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
    instructions: 'Ask before changing files and keep task context bounded.',
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
    goal: 'Prepare a bounded task context snapshot.',
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
    reason: 'Owner activated this supervised assignment.',
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
    purpose: 'Supervise one bounded task context snapshot.',
    redispatch_policy: 'lease_required_no_duplicate_dispatch',
    supervision_state: 'active_assignment_only',
    authority_boundary: 'main_supervision_lease_only',
    ...overrides,
  };
}

function budgetAuditInput(assignment, activeStatus, lease, overrides = {}) {
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
    observed_at_ms: 30,
    requested_next_action: 'start_step',
    budget_limits: assignment.budget,
    budget_usage: {
      step_count: 1,
      tool_call_count: 0,
      runtime_ms: 100,
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

function fixture(overrides = {}) {
  const agentDefinition = createBuilderAgentDefinitionRecord(definitionInput(overrides.definition ?? {}));
  const agentVersion = createBuilderAgentVersionRecord(versionInput(overrides.version ?? {}), agentDefinition);
  const assignment = createBuilderAgentAssignmentRecord(
    assignmentInput(agentVersion, overrides.assignment ?? {}),
    agentVersion,
    agentDefinition,
  );
  const activeStatus = createBuilderAgentAssignmentStatusRecord(
    activeStatusInput(assignment, overrides.activeStatus ?? {}),
    assignment,
  );
  const lease = createBuilderAgentSupervisionLeaseRecord(
    leaseInput(assignment, activeStatus, overrides.lease ?? {}),
    assignment,
    activeStatus,
  );
  const budgetAudit = createBuilderAgentBudgetAuditRecord(
    budgetAuditInput(assignment, activeStatus, lease, overrides.budgetAudit ?? {}),
    assignment,
    activeStatus,
    lease,
  );
  return {
    active_status: activeStatus,
    agent_definition: agentDefinition,
    agent_version: agentVersion,
    assignment,
    budget_audit: budgetAudit,
    lease,
  };
}

function parentProjection(overrides = {}) {
  const materializedAtMs = overrides.materialized_at_ms ?? 25;
  const body = {
    projection_version: 'builder-agent-parent-task-context-projection.v1',
    owner_id: overrides.owner_id ?? OWNER_ID,
    project_id: overrides.project_id ?? PROJECT_ID,
    parent_task_id: overrides.parent_task_id ?? TASK_ID,
    context_kind: 'agent_parent_task_context_from_reviewed_child_results',
    materialized_child_result_refs: [
      {
        delegation_result_parent_materialization_id:
          `builder-agent-delegation-result-parent-materialization:${'1'.repeat(64)}`,
        delegation_result_parent_materialization_eligibility_id:
          `builder-agent-delegation-result-parent-materialization-eligibility:${'2'.repeat(64)}`,
        delegation_result_review_id: `builder-agent-delegation-result-review:${'3'.repeat(64)}`,
        delegation_result_admission_id: `builder-agent-delegation-result-admission:${'4'.repeat(64)}`,
        delegation_result_id: `builder-agent-delegation-result:${'5'.repeat(64)}`,
        delegation_id: `builder-agent-delegation:${'6'.repeat(64)}`,
        child_conversation_id: CHILD_CONVERSATION_ID,
        child_task_id: CHILD_TASK_ID,
        child_run_id: CHILD_RUN_ID,
        to_agent_id: AGENT_ID,
        to_agent_version_id: `builder-agent-version:${'7'.repeat(64)}`,
        result_status: 'proposed',
        result_summary_code: 'delegated_child_result_ready_for_parent_review',
        decision: 'approved_for_parent_materialization',
        eligibility_status: 'eligible_for_parent_materialization_gate',
        parent_context_status: 'materialized_as_parent_task_context_receipt',
        materialization_summary_code: 'delegated_child_result_materialized_as_parent_context_receipt',
        materialized_at_ms: materializedAtMs,
      },
    ],
    available_materialization_count: 1,
    included_materialization_count: 1,
    truncated: false,
    created_at_ms: overrides.created_at_ms ?? 35,
    authority: {
      projection_authority: 'main_agent_parent_task_context_projection_v1',
      parent_task_context_authority: 'local_parent_task_context_projection_only',
      delegation_result_parent_materialization_authority:
        'main_agent_delegation_result_parent_materialization_receipts',
      renderer_authority: 'not_present',
      ipc_authority: 'not_present',
      provider_dispatch: false,
      model_dispatch: false,
      tool_dispatch: false,
      permission_grant_authority: false,
      credential_storage: 'not_present',
      source_access: 'not_present',
      source_read: 'not_present',
      source_write: 'not_present',
      process_run: false,
      network_access: false,
      revision_authority: false,
      review_row_authority: false,
      artifact_authority: false,
      parent_source_mutation_authority: false,
    },
  };
  const contextDigest = sha256Canonical(body);
  return Object.freeze({
    ...body,
    projection_id: `builder-agent-parent-task-context-projection:${contextDigest.slice('sha256:'.length)}`,
    context_digest: contextDigest,
  });
}

function snapshotInput(overrides = {}) {
  return {
    ...fixture(overrides.fixture ?? {}),
    included_memory_ids: [MEMORY_ID],
    included_message_ids: [MESSAGE_ID, SECOND_MESSAGE_ID],
    included_artifact_ids: [ARTIFACT_ID],
    included_run_event_ids: [RUN_EVENT_ID],
    included_permission_ids: [PERMISSION_ID],
    parent_task_context_projection: parentProjection(overrides.parentProjection ?? {}),
    base_project_revision: BASE_REVISION,
    token_budget: {
      max_input_tokens: 32_000,
      reserved_output_tokens: 2_000,
      selection_policy: 'deterministic_task_local_budget_v1',
    },
    created_at_ms: 40,
    ...overrides.input,
  };
}

function assertSnapshotError(fn) {
  assert.throws(
    fn,
    (error) => error instanceof BuilderAgentTaskContextSnapshotError
      && error.code === 'builder_agent_task_context_snapshot_invalid'
      && !/secret-value|private marker|raw prompt|source text|file content|api\.deepseek|patch body|assistant instructions/iu.test(String(error.stack)),
  );
}

test('creates a digest-bound Agent task context snapshot from bounded refs', () => {
  const snapshot = createBuilderAgentTaskContextSnapshot(snapshotInput());

  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(snapshot.snapshot_version, BUILDER_AGENT_TASK_CONTEXT_SNAPSHOT_VERSION);
  assert.match(snapshot.snapshot_id, /^builder-agent-task-context-snapshot:[0-9a-f]{64}$/u);
  assert.match(snapshot.context_digest, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(snapshot.context_kind, 'agent_task_context_snapshot_before_supervised_action');
  assert.equal(snapshot.owner_id, OWNER_ID);
  assert.equal(snapshot.project_id, PROJECT_ID);
  assert.equal(snapshot.task_id, TASK_ID);
  assert.deepEqual(snapshot.included_message_ids, [MESSAGE_ID, SECOND_MESSAGE_ID]);
  assert.deepEqual(snapshot.parent_task_context_projection, {
    status: 'included',
    projection_id: snapshotInput().parent_task_context_projection.projection_id,
    context_digest: snapshotInput().parent_task_context_projection.context_digest,
    included_materialization_count: 1,
    truncated: false,
  });
  assert.deepEqual(snapshot.action_admission, {
    requested_next_action: 'start_step',
    budget_audit_decision: 'allowed',
    budget_audit_reason: 'none',
    budget_audit_observed_at_ms: 30,
  });
  assert.deepEqual(
    sanitizeBuilderAgentTaskContextSnapshot(structuredClone(snapshot), {
      owner_id: OWNER_ID,
      project_id: PROJECT_ID,
      task_id: TASK_ID,
      run_id: RUN_ID,
    }),
    snapshot,
  );
  assert.equal(snapshot.authority.snapshot_authority, 'main_agent_task_context_snapshot_contract_v1');
  assert.equal(snapshot.authority.renderer_authority, 'not_present');
  assert.equal(snapshot.authority.ipc_authority, 'not_present');
  assert.equal(snapshot.authority.model_dispatch, false);
  assert.equal(snapshot.authority.tool_dispatch, false);
  assert.equal(snapshot.authority.source_write, 'not_present');
  assert.equal(snapshot.authority.prompt_materialization, false);
  assert.doesNotMatch(
    JSON.stringify(snapshot),
    /Ask before changing files|assistant instructions|raw prompt|current_brief|source text|file content|builder-provider|provider_(?:config|secret|envelope)|credential_(?:secret|value|ref)|api[_-]?key|Authorization|Bearer|patch body|tree_oid/iu,
  );
});

test('supports empty optional context refs without inventing source or revision facts', () => {
  const snapshot = createBuilderAgentTaskContextSnapshot(snapshotInput({
    input: {
      included_memory_ids: [],
      included_artifact_ids: [],
      included_run_event_ids: [],
      included_permission_ids: [],
      parent_task_context_projection: null,
      base_project_revision: NO_BASE_REVISION,
    },
  }));

  assert.deepEqual(snapshot.included_memory_ids, []);
  assert.deepEqual(snapshot.included_artifact_ids, []);
  assert.deepEqual(snapshot.included_run_event_ids, []);
  assert.deepEqual(snapshot.included_permission_ids, []);
  assert.deepEqual(snapshot.parent_task_context_projection, {
    status: 'not_available',
    projection_id: null,
    context_digest: null,
    included_materialization_count: 0,
    truncated: false,
  });
  assert.deepEqual(snapshot.base_project_revision, NO_BASE_REVISION);
});

test('binds snapshot identity to canonical refs and expected task identity', () => {
  const snapshot = structuredClone(createBuilderAgentTaskContextSnapshot(snapshotInput()));
  snapshot.included_message_ids = [MESSAGE_ID];
  assertSnapshotError(() => sanitizeBuilderAgentTaskContextSnapshot(snapshot, {
    owner_id: OWNER_ID,
    project_id: PROJECT_ID,
    task_id: TASK_ID,
    run_id: RUN_ID,
  }));

  const clean = createBuilderAgentTaskContextSnapshot(snapshotInput());
  assertSnapshotError(() => sanitizeBuilderAgentTaskContextSnapshot(clean, {
    owner_id: OWNER_ID,
    project_id: PROJECT_ID,
    task_id: OTHER_TASK_ID,
    run_id: RUN_ID,
  }));
});

test('rejects denied budgets, mismatched parent context, hostile input, and raw text attempts', () => {
  assertSnapshotError(() => createBuilderAgentTaskContextSnapshot(snapshotInput({
    fixture: {
      budgetAudit: {
        budget_usage: {
          step_count: 12,
          tool_call_count: 0,
          runtime_ms: 100,
          private_source_bytes: 0,
        },
        outcome: {
          decision: 'denied',
          reason: 'max_steps_reached',
        },
      },
    },
  })));
  assertSnapshotError(() => createBuilderAgentTaskContextSnapshot(snapshotInput({
    parentProjection: { parent_task_id: OTHER_TASK_ID },
  })));
  assertSnapshotError(() => createBuilderAgentTaskContextSnapshot(snapshotInput({
    parentProjection: { created_at_ms: 41 },
  })));
  assertSnapshotError(() => createBuilderAgentTaskContextSnapshot({
    ...snapshotInput(),
    raw_prompt: 'raw prompt',
  }));
  assertSnapshotError(() => createBuilderAgentTaskContextSnapshot({
    ...snapshotInput(),
    included_message_ids: [MESSAGE_ID, MESSAGE_ID],
  }));
  const accessor = snapshotInput();
  Object.defineProperty(accessor, 'included_message_ids', {
    enumerable: true,
    get() {
      throw new Error('private marker');
    },
  });
  assertSnapshotError(() => createBuilderAgentTaskContextSnapshot(accessor));
  assertSnapshotError(() => createBuilderAgentTaskContextSnapshot(new Proxy(snapshotInput(), {})));
});

test('source boundary remains a main-only context snapshot without runtime authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-agent-task-context-snapshot.cjs'),
    'utf8',
  );
  assert.match(source, /builder-agent-task-context-snapshot\.v1/u);
  assert.match(source, /main_agent_task_context_snapshot_contract_v1/u);
  assert.match(source, /main_agent_parent_task_context_projection_v1/u);
  assert.match(source, /renderer_authority: 'not_present'/u);
  assert.match(source, /ipc_authority: 'not_present'/u);
  assert.match(source, /provider_dispatch: false/u);
  assert.match(source, /model_dispatch: false/u);
  assert.match(source, /tool_dispatch: false/u);
  assert.match(source, /source_write: 'not_present'/u);
  assert.match(source, /raw_context_storage: false/u);
  assert.doesNotMatch(
    source,
    /require\(['"](?:electron|node:fs|node:http|node:https|http|https|node:child_process|child_process)['"]\)|ipcMain|ipcRenderer|contextBridge|BrowserWindow|safeStorage|builder-provider|builder-git|dugite|fetch\s*\(|https?:|Authorization|Bearer|spawn\(|execFile\(|writeFile|rmSync|localStorage|sessionStorage|indexedDB|eval\s*\(|new Function/iu,
  );
});
