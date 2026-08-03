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
  createBuilderAgentTaskContextSnapshot,
} = require('../electron/builder-agent-task-context-snapshot.cjs');
const {
  BUILDER_AGENT_SUPERVISED_ACTION_ADMISSION_VERSION,
  SUPERVISED_ACTION_ADMISSION_KIND,
  BuilderAgentSupervisedActionAdmissionError,
  createBuilderAgentSupervisedActionAdmission,
  sanitizeBuilderAgentSupervisedActionAdmission,
} = require('../electron/builder-agent-supervised-action-admission.cjs');

const OWNER_ID = 'builder-user:11111111-1111-4111-8111-111111111111';
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
const NEXT_GATES = Object.freeze({
  start_step: 'agent_step_runner_required_later',
  call_tool: 'tool_call_record_required_later',
  read_private_source: 'source_context_collector_required_later',
  finish_for_review: 'project_work_result_required_later',
});

function requestId(index) {
  return `builder-agent-action-request:123e4567-e89b-42d3-a456-${index.toString(16).padStart(12, '0')}`;
}

function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function digestAdmission(value) {
  return `sha256:${nodeCrypto.createHash('sha256').update(canonicalJson({
    action_request_id: value.action_request_id,
    admitted_at_ms: value.admitted_at_ms,
    admission_kind: value.admission_kind,
    admission_version: value.admission_version,
    authority: value.authority,
    budget_audit_id: value.budget_audit_id,
    budget_audit_observed_at_ms: value.budget_audit_observed_at_ms,
    context_digest: value.context_digest,
    context_ref_counts: value.context_ref_counts,
    lifecycle: value.lifecycle,
    next_gate: value.next_gate,
    requested_next_action: value.requested_next_action,
    run_id: value.run_id,
    snapshot_created_at_ms: value.snapshot_created_at_ms,
    snapshot_id: value.snapshot_id,
    task_id: value.task_id,
    token_budget: value.token_budget,
  }), 'utf8').digest('hex')}`;
}

function fixture(action = 'start_step') {
  const definition = createBuilderAgentDefinitionRecord({
    record_version: BUILDER_AGENT_DEFINITION_RECORD_VERSION,
    agent_id: AGENT_ID,
    owner_id: OWNER_ID,
    display_name: 'Builder Agent',
    purpose: 'Admit one supervised action.',
    created_at_ms: 1,
  });
  const version = createBuilderAgentVersionRecord({
    record_version: BUILDER_AGENT_VERSION_RECORD_VERSION,
    agent_id: AGENT_ID,
    owner_id: OWNER_ID,
    version_number: 1,
    instructions: 'Admit only bounded actions after context snapshot.',
    created_at_ms: 2,
    permission_boundary: 'explicit_permission_required',
  }, definition);
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
    goal: 'Move one supervised action through admission only.',
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
  }, version, definition);
  const activeStatus = createBuilderAgentAssignmentStatusRecord({
    record_version: BUILDER_AGENT_ASSIGNMENT_STATUS_RECORD_VERSION,
    assignment_id: assignment.assignment_id,
    agent_id: AGENT_ID,
    owner_id: OWNER_ID,
    decided_by: OWNER_ID,
    next_status: 'active',
    reason: 'Owner started supervised work.',
    decided_at_ms: 4,
  }, assignment);
  const lease = createBuilderAgentSupervisionLeaseRecord({
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
    purpose: 'Supervise one bounded action admission.',
    redispatch_policy: 'lease_required_no_duplicate_dispatch',
    supervision_state: 'active_assignment_only',
    authority_boundary: 'main_supervision_lease_only',
  }, assignment, activeStatus);
  const budgetAudit = createBuilderAgentBudgetAuditRecord({
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
    requested_next_action: action,
    budget_limits: assignment.budget,
    budget_usage: {
      step_count: action === 'start_step' ? 0 : 1,
      tool_call_count: 0,
      runtime_ms: 100,
      private_source_bytes: 0,
    },
    outcome: {
      decision: 'allowed',
      reason: 'none',
    },
    audit_contract: 'assignment_budget_checked_before_agent_work',
  }, assignment, activeStatus, lease);
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
    created_at_ms: 40,
  });
  return { budgetAudit, snapshot };
}

function admissionInput(snapshot, overrides = {}) {
  return {
    context_snapshot: snapshot,
    action_request_id: requestId(1),
    requested_next_action: snapshot.action_admission.requested_next_action,
    run_status: 'running',
    interrupt_requested: false,
    cancel_requested: false,
    admitted_at_ms: 41,
    ...overrides,
  };
}

function assertAdmissionError(fn) {
  assert.throws(
    fn,
    (error) => error instanceof BuilderAgentSupervisedActionAdmissionError
      && error.code === 'builder_agent_supervised_action_admission_invalid'
      && !/private|credential|api\.deepseek|secret-value|source text|raw prompt|file content|patch body/iu
        .test(String(error.stack)),
  );
}

test('creates deterministic main-only supervised action admissions for every next action', () => {
  for (const [index, action] of ['start_step', 'call_tool', 'read_private_source', 'finish_for_review'].entries()) {
    const { snapshot } = fixture(action);
    const admission = createBuilderAgentSupervisedActionAdmission(admissionInput(snapshot, {
      action_request_id: requestId(index + 1),
      admitted_at_ms: 41 + index,
    }));
    assert.equal(admission.admission_version, BUILDER_AGENT_SUPERVISED_ACTION_ADMISSION_VERSION);
    assert.equal(admission.admission_kind, SUPERVISED_ACTION_ADMISSION_KIND);
    assert.match(admission.admission_id, /^builder-agent-supervised-action-admission:[0-9a-f]{64}$/u);
    assert.equal(admission.requested_next_action, action);
    assert.equal(admission.next_gate, NEXT_GATES[action]);
    assert.equal(admission.snapshot_id, snapshot.snapshot_id);
    assert.equal(admission.context_digest, snapshot.context_digest);
    assert.equal(admission.budget_audit_id, snapshot.budget_audit_id);
    assert.equal(admission.context_ref_counts.included_message_count, 1);
    assert.equal(admission.context_ref_counts.parent_context_included, false);
    assert.equal(admission.context_ref_counts.base_revision_included, true);
    assert.deepEqual(admission.token_budget, snapshot.token_budget);
    assert.deepEqual(admission.lifecycle, {
      context_snapshot_admission: 'verified_context_snapshot_receipt',
      supervised_action_admission: 'bounded_main_admission_only',
      provider_dispatch: 'not_started',
      tool_call_admission: 'required_later_for_tool_actions',
      source_context_admission: 'required_later_for_private_source',
      result_for_review_admission: 'required_later_for_finish',
      materialization_admission: 'not_created',
    });
    assert.deepEqual(admission.authority, {
      admission_authority: 'main_agent_supervised_action_admission_contract_v1',
      context_snapshot_authority: 'main_agent_task_context_snapshot_contract_v1',
      budget_authority: 'main_agent_budget_audit_contract_v1',
      lease_authority: 'main_agent_supervision_lease_contract_v1',
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
      review_authority: false,
      artifact_authority: false,
      raw_context_storage: false,
    });
    assert.deepEqual(sanitizeBuilderAgentSupervisedActionAdmission(admission, {
      snapshot_id: snapshot.snapshot_id,
      context_digest: snapshot.context_digest,
      requested_next_action: action,
    }), admission);
    assert.equal(Object.isFrozen(admission), true);
    assert.equal(Object.isFrozen(admission.lifecycle), true);
    assert.equal(Object.isFrozen(admission.authority), true);
  }
});

test('rejects mismatched actions, stopped runs, interruptions, cancellation, and stale admission time', () => {
  const { snapshot } = fixture('call_tool');
  assertAdmissionError(() => createBuilderAgentSupervisedActionAdmission(admissionInput(snapshot, {
    requested_next_action: 'start_step',
  })));
  assertAdmissionError(() => createBuilderAgentSupervisedActionAdmission(admissionInput(snapshot, {
    run_status: 'completed',
  })));
  assertAdmissionError(() => createBuilderAgentSupervisedActionAdmission(admissionInput(snapshot, {
    interrupt_requested: true,
  })));
  assertAdmissionError(() => createBuilderAgentSupervisedActionAdmission(admissionInput(snapshot, {
    cancel_requested: true,
  })));
  assertAdmissionError(() => createBuilderAgentSupervisedActionAdmission(admissionInput(snapshot, {
    admitted_at_ms: snapshot.created_at_ms - 1,
  })));
});

test('rejects forged admissions and digest drift', () => {
  const { snapshot } = fixture('finish_for_review');
  const admission = createBuilderAgentSupervisedActionAdmission(admissionInput(snapshot));
  assertAdmissionError(() => sanitizeBuilderAgentSupervisedActionAdmission({
    ...admission,
    next_gate: 'tool_call_record_required_later',
  }));
  assertAdmissionError(() => sanitizeBuilderAgentSupervisedActionAdmission({
    ...admission,
    authority: {
      ...admission.authority,
      provider_dispatch: true,
    },
  }));
  assertAdmissionError(() => sanitizeBuilderAgentSupervisedActionAdmission({
    ...admission,
    lifecycle: {
      ...admission.lifecycle,
      provider_dispatch: 'started',
    },
  }));
  assertAdmissionError(() => sanitizeBuilderAgentSupervisedActionAdmission({
    ...admission,
    token_budget: {
      ...admission.token_budget,
      max_input_tokens: 0,
    },
  }));
  const forged = {
    ...admission,
    context_ref_counts: {
      ...admission.context_ref_counts,
      included_message_count: 0,
    },
  };
  assertAdmissionError(() => sanitizeBuilderAgentSupervisedActionAdmission({
    ...forged,
    admission_digest: digestAdmission(forged),
  }));
  assertAdmissionError(() => sanitizeBuilderAgentSupervisedActionAdmission({
    ...admission,
    admission_digest: `sha256:${'1'.repeat(64)}`,
  }));
});

test('rejects hostile input without invoking accessors', () => {
  const { snapshot } = fixture('start_step');
  assertAdmissionError(() => createBuilderAgentSupervisedActionAdmission(
    new Proxy(admissionInput(snapshot), {}),
  ));
  let invoked = false;
  const input = admissionInput(snapshot);
  Object.defineProperty(input, 'context_snapshot', {
    enumerable: true,
    get() {
      invoked = true;
      throw new Error('secret-value');
    },
  });
  assertAdmissionError(() => createBuilderAgentSupervisedActionAdmission(input));
  assert.equal(invoked, false);
});

test('source remains a pure supervised action admission contract without runtime authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-agent-supervised-action-admission.cjs'),
    'utf8',
  );

  assert.match(source, /builder-agent-supervised-action-admission\.v1/u);
  assert.match(source, /main_agent_supervised_action_admission_contract_v1/u);
  assert.match(source, /verified_context_snapshot_receipt/u);
  assert.match(source, /tool_call_record_required_later/u);
  assert.match(source, /source_context_collector_required_later/u);
  assert.match(source, /project_work_result_required_later/u);
  assert.match(source, /provider_dispatch: false/u);
  assert.match(source, /tool_dispatch: false/u);
  assert.match(source, /source_read: 'not_present'/u);
  assert.match(source, /raw_context_storage: false/u);
  assert.doesNotMatch(
    source,
    /require\(['"](?:electron|node:http|node:https|http|https)['"]\)|ipcMain|ipcRenderer|contextBridge|BrowserWindow|safeStorage|builder-provider|builder-git|dugite|fetch\s*\(|https?:|Authorization|Bearer|child_process|execFile|spawn\s*\(|writeFile|rmSync|shell:\s*true|localStorage|sessionStorage|indexedDB|eval\s*\(|new Function|record_grant|provider_secret|credential_secret|file_content|source_tree|commit_oid|tree_oid|stdout|stderr/iu,
  );
});
