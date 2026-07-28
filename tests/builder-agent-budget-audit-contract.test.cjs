'use strict';

const assert = require('node:assert/strict');
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
  BuilderAgentBudgetAuditContractError,
  createBuilderAgentBudgetAuditRecord,
  sanitizeBuilderAgentBudgetAuditRecord,
} = require('../electron/builder-agent-budget-audit-contract.cjs');

const OWNER_ID = 'builder-user:123e4567-e89b-42d3-a456-426614174000';
const OTHER_OWNER_ID = 'builder-user:123e4567-e89b-42d3-a456-426614174001';
const AGENT_ID = 'builder-agent:123e4567-e89b-42d3-a456-426614174002';
const PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174004';
const CONVERSATION_ID = 'builder-conversation:123e4567-e89b-42d3-a456-426614174005';
const TASK_ID = 'builder-task:123e4567-e89b-42d3-a456-426614174006';
const RUN_ID = 'builder-run:123e4567-e89b-42d3-a456-426614174007';
const SUPERVISOR_ID = 'builder-supervisor:123e4567-e89b-42d3-a456-426614174008';

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
    goal: 'Prepare one reviewable local Builder change.',
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

function fixture(overrides = {}) {
  const agentDefinition = createBuilderAgentDefinitionRecord(definitionInput());
  const agentVersion = createBuilderAgentVersionRecord(versionInput(), agentDefinition);
  const assignmentRecord = createBuilderAgentAssignmentRecord(
    assignmentInput(agentVersion, overrides.assignment ?? {}),
    agentVersion,
    agentDefinition,
  );
  const activeStatus = createBuilderAgentAssignmentStatusRecord(
    statusInput(assignmentRecord, overrides.status ?? {}),
    assignmentRecord,
  );
  const leaseRecord = createBuilderAgentSupervisionLeaseRecord(
    leaseInput(assignmentRecord, activeStatus, overrides.lease ?? {}),
    assignmentRecord,
    activeStatus,
  );
  return { activeStatus, agentDefinition, agentVersion, assignmentRecord, leaseRecord };
}

function auditInput(assignmentRecord, activeStatus, leaseRecord, overrides = {}) {
  const budgetUsage = overrides.budget_usage ?? {
    step_count: 3,
    tool_call_count: 1,
    runtime_ms: 4_000,
    private_source_bytes: 1_024,
  };
  const requestedNextAction = overrides.requested_next_action ?? 'start_step';
  const outcome = overrides.outcome ?? {
    decision: 'allowed',
    reason: 'none',
  };
  return {
    record_version: BUILDER_AGENT_BUDGET_AUDIT_RECORD_VERSION,
    record_kind: BUILDER_AGENT_BUDGET_AUDIT_RECORD_KIND,
    assignment_id: assignmentRecord.assignment_id,
    assignment_status_id: activeStatus.assignment_status_id,
    lease_id: leaseRecord.lease_id,
    agent_id: AGENT_ID,
    agent_version_id: assignmentRecord.agent_version_id,
    owner_id: OWNER_ID,
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    task_id: TASK_ID,
    run_id: RUN_ID,
    lease_holder_id: SUPERVISOR_ID,
    observed_at_ms: 90,
    requested_next_action: requestedNextAction,
    budget_limits: assignmentRecord.budget,
    budget_usage: budgetUsage,
    outcome,
    audit_contract: 'assignment_budget_checked_before_agent_work',
    ...overrides,
  };
}

function assertAuditError(fn) {
  assert.throws(
    fn,
    (error) => {
      assert.ok(error instanceof BuilderAgentBudgetAuditContractError);
      assert.equal(error.code, 'builder_agent_budget_audit_contract_invalid');
      const text = `${error.name}:${error.message}:${error.stack}`;
      assert.doesNotMatch(text, /secret-value|api\.deepseek|private marker|source text|raw usage/iu);
      return true;
    },
  );
}

test('creates deterministic allowed and denied budget audit records', () => {
  const { activeStatus, assignmentRecord, leaseRecord } = fixture();
  const allowed = createBuilderAgentBudgetAuditRecord(
    auditInput(assignmentRecord, activeStatus, leaseRecord),
    assignmentRecord,
    activeStatus,
    leaseRecord,
  );
  const sameAllowed = createBuilderAgentBudgetAuditRecord(
    auditInput(assignmentRecord, activeStatus, leaseRecord),
    assignmentRecord,
    activeStatus,
    leaseRecord,
  );
  const denied = createBuilderAgentBudgetAuditRecord(
    auditInput(assignmentRecord, activeStatus, leaseRecord, {
      requested_next_action: 'call_tool',
      budget_usage: {
        step_count: 3,
        tool_call_count: assignmentRecord.budget.max_tool_calls,
        runtime_ms: 4_000,
        private_source_bytes: 1_024,
      },
      outcome: {
        decision: 'denied',
        reason: 'max_tool_calls_reached',
      },
    }),
    assignmentRecord,
    activeStatus,
    leaseRecord,
  );

  assert.deepEqual(allowed, sameAllowed);
  assert.match(allowed.budget_audit_id, /^builder-agent-budget-audit:[0-9a-f]{64}$/u);
  assert.equal(allowed.definition_digest, assignmentRecord.definition_digest);
  assert.equal(allowed.assignment_id, assignmentRecord.assignment_id);
  assert.equal(allowed.assignment_status_id, activeStatus.assignment_status_id);
  assert.equal(allowed.lease_id, leaseRecord.lease_id);
  assert.deepEqual(allowed.budget_limits, assignmentRecord.budget);
  assert.equal(allowed.outcome.decision, 'allowed');
  assert.equal(allowed.outcome.reason, 'none');
  assert.equal(allowed.outcome.display_summary, 'Agent budget check passed.');
  assert.equal(allowed.lifecycle.next_action, 'not_performed_by_contract');
  assert.equal(allowed.lifecycle.project_revision, 'not_created');
  assert.equal(allowed.authority.renderer_authority, 'not_present');
  assert.equal(allowed.authority.model_dispatch, false);
  assert.equal(allowed.authority.source_write, 'not_performed_by_contract');
  assert.equal(allowed.authority.tool_dispatch, 'not_performed_by_contract');
  assert.equal(allowed.authority.revision_authority, 'not_present');
  assert.equal(Object.hasOwn(allowed, 'provider'), false);
  assert.equal(Object.hasOwn(allowed, 'credential'), false);
  assert.equal(Object.hasOwn(allowed, 'source_tree'), false);
  assert.equal(Object.hasOwn(allowed, 'permission_id'), false);
  assert.equal(Object.isFrozen(allowed), true);
  assert.equal(Object.isFrozen(allowed.budget_limits), true);
  assert.equal(Object.isFrozen(allowed.budget_usage), true);
  assert.equal(Object.isFrozen(allowed.outcome), true);

  assert.equal(denied.outcome.decision, 'denied');
  assert.equal(denied.outcome.reason, 'max_tool_calls_reached');
  assert.equal(denied.outcome.display_summary, 'Agent budget needs owner review.');

  assert.deepEqual(
    sanitizeBuilderAgentBudgetAuditRecord(structuredClone(allowed), assignmentRecord, activeStatus, leaseRecord),
    allowed,
  );
});

test('rejects inactive assignments, identity drift, stale leases, wrong budget snapshots, and forged outcomes', () => {
  const { activeStatus, assignmentRecord, leaseRecord } = fixture();
  const pausedStatus = createBuilderAgentAssignmentStatusRecord(statusInput(assignmentRecord, {
    next_status: 'paused',
    reason: 'Owner paused this assignment.',
    decided_at_ms: 45,
  }), assignmentRecord);

  assertAuditError(() => createBuilderAgentBudgetAuditRecord(
    auditInput(assignmentRecord, pausedStatus, leaseRecord),
    assignmentRecord,
    pausedStatus,
    leaseRecord,
  ));
  assertAuditError(() => createBuilderAgentBudgetAuditRecord(
    auditInput(assignmentRecord, activeStatus, leaseRecord, { owner_id: OTHER_OWNER_ID }),
    assignmentRecord,
    activeStatus,
    leaseRecord,
  ));
  assertAuditError(() => createBuilderAgentBudgetAuditRecord(
    auditInput(assignmentRecord, activeStatus, leaseRecord, { observed_at_ms: 49 }),
    assignmentRecord,
    activeStatus,
    leaseRecord,
  ));
  assertAuditError(() => createBuilderAgentBudgetAuditRecord(
    auditInput(assignmentRecord, activeStatus, leaseRecord, { observed_at_ms: 121 }),
    assignmentRecord,
    activeStatus,
    leaseRecord,
  ));
  assertAuditError(() => createBuilderAgentBudgetAuditRecord(
    auditInput(assignmentRecord, activeStatus, leaseRecord, {
      budget_limits: {
        ...assignmentRecord.budget,
        max_steps: assignmentRecord.budget.max_steps + 1,
      },
    }),
    assignmentRecord,
    activeStatus,
    leaseRecord,
  ));
  assertAuditError(() => createBuilderAgentBudgetAuditRecord(
    auditInput(assignmentRecord, activeStatus, leaseRecord, {
      budget_usage: {
        step_count: assignmentRecord.budget.max_steps + 1,
        tool_call_count: 1,
        runtime_ms: 4_000,
        private_source_bytes: 1_024,
      },
    }),
    assignmentRecord,
    activeStatus,
    leaseRecord,
  ));
  assertAuditError(() => createBuilderAgentBudgetAuditRecord(
    auditInput(assignmentRecord, activeStatus, leaseRecord, {
      requested_next_action: 'call_tool',
      budget_usage: {
        step_count: 3,
        tool_call_count: assignmentRecord.budget.max_tool_calls,
        runtime_ms: 4_000,
        private_source_bytes: 1_024,
      },
      outcome: {
        decision: 'allowed',
        reason: 'none',
      },
    }),
    assignmentRecord,
    activeStatus,
    leaseRecord,
  ));
  assertAuditError(() => createBuilderAgentBudgetAuditRecord(
    auditInput(assignmentRecord, activeStatus, leaseRecord, {
      requested_next_action: 'read_private_source',
      budget_usage: {
        step_count: 3,
        tool_call_count: 1,
        runtime_ms: 4_000,
        private_source_bytes: assignmentRecord.budget.max_private_source_bytes,
      },
      outcome: {
        decision: 'denied',
        reason: 'max_runtime_reached',
      },
    }),
    assignmentRecord,
    activeStatus,
    leaseRecord,
  ));
});

test('fails closed on extras, accessors, and proxies without leaking raw input', () => {
  const { activeStatus, assignmentRecord, leaseRecord } = fixture();

  assertAuditError(() => createBuilderAgentBudgetAuditRecord({
    ...auditInput(assignmentRecord, activeStatus, leaseRecord),
    extra: true,
  }, assignmentRecord, activeStatus, leaseRecord));
  assertAuditError(() => createBuilderAgentBudgetAuditRecord({
    ...auditInput(assignmentRecord, activeStatus, leaseRecord),
    outcome: {
      decision: 'denied',
      reason: 'source text secret-value',
    },
  }, assignmentRecord, activeStatus, leaseRecord));

  let getterCalls = 0;
  assertAuditError(() => createBuilderAgentBudgetAuditRecord(Object.defineProperty(
    auditInput(assignmentRecord, activeStatus, leaseRecord),
    'budget_usage',
    {
      enumerable: true,
      get() {
        getterCalls += 1;
        return 'private marker';
      },
    },
  ), assignmentRecord, activeStatus, leaseRecord));
  assert.equal(getterCalls, 0);

  let nestedGetterCalls = 0;
  assertAuditError(() => createBuilderAgentBudgetAuditRecord({
    ...auditInput(assignmentRecord, activeStatus, leaseRecord),
    budget_usage: Object.defineProperty(
      {
        step_count: 3,
        tool_call_count: 1,
        runtime_ms: 4_000,
        private_source_bytes: 1_024,
      },
      'step_count',
      {
        enumerable: true,
        get() {
          nestedGetterCalls += 1;
          return 3;
        },
      },
    ),
  }, assignmentRecord, activeStatus, leaseRecord));
  assert.equal(nestedGetterCalls, 0);

  let proxyTrapInvoked = false;
  const proxyTrap = () => {
    proxyTrapInvoked = true;
    throw new Error('private marker');
  };
  assertAuditError(() => createBuilderAgentBudgetAuditRecord(new Proxy(
    auditInput(assignmentRecord, activeStatus, leaseRecord),
    {
      getOwnPropertyDescriptor: proxyTrap,
      getPrototypeOf: proxyTrap,
      ownKeys: proxyTrap,
    },
  ), assignmentRecord, activeStatus, leaseRecord));
  assert.equal(proxyTrapInvoked, false);
});

test('source remains a pure local budget audit contract with no runtime authority', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'electron', 'builder-agent-budget-audit-contract.cjs'),
    'utf8',
  );

  assert.doesNotMatch(source, /node:fs|node:sqlite|ipc|preload|safeStorage|credential|provider|dugite|builder-git|child_process|spawn|exec|fetch|localStorage|sessionStorage/iu);
  assert.match(source, /assignment_budget_checked_before_agent_work/u);
  assert.match(source, /recorded_before_next_action/u);
  assert.match(source, /builder-agent-budget-audit-contract\.v1/u);
});
