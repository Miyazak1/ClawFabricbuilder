'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const {
  BuilderAgentSupervisedActionAdmissionError,
  sanitizeBuilderAgentSupervisedActionAdmission,
} = require('./builder-agent-supervised-action-admission.cjs');

const BUILDER_AGENT_STEP_START_CONTRACT_VERSION =
  'builder-agent-step-start-contract.v1';
const BUILDER_AGENT_STEP_START_RECEIPT_VERSION =
  'builder-agent-step-start-receipt.v1';
const BUILDER_AGENT_STEP_START_RECEIPT_KIND = 'builder_agent_step_start_receipt';
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const OWNER_ID_PATTERN = new RegExp(`^builder-user:${UUID_SOURCE}$`, 'u');
const AGENT_ID_PATTERN = new RegExp(`^builder-agent:${UUID_SOURCE}$`, 'u');
const PROJECT_ID_PATTERN = new RegExp(`^builder-project:${UUID_SOURCE}$`, 'u');
const CONVERSATION_ID_PATTERN = new RegExp(`^builder-conversation:${UUID_SOURCE}$`, 'u');
const TASK_ID_PATTERN = new RegExp(`^builder-task:${UUID_SOURCE}$`, 'u');
const RUN_ID_PATTERN = new RegExp(`^builder-run:${UUID_SOURCE}$`, 'u');
const SUPERVISOR_ID_PATTERN = new RegExp(`^builder-supervisor:${UUID_SOURCE}$`, 'u');
const STEP_ID_PATTERN = new RegExp(`^builder-run-step:${UUID_SOURCE}$`, 'u');
const ADMISSION_ID_PATTERN = /^builder-agent-supervised-action-admission:[0-9a-f]{64}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const AGENT_VERSION_ID_PATTERN = /^builder-agent-version:[0-9a-f]{64}$/u;
const ASSIGNMENT_ID_PATTERN = /^builder-agent-assignment:[0-9a-f]{64}$/u;
const ASSIGNMENT_STATUS_ID_PATTERN = /^builder-agent-assignment-status:[0-9a-f]{64}$/u;
const SUPERVISION_LEASE_ID_PATTERN = /^builder-agent-supervision-lease:[0-9a-f]{64}$/u;
const BUDGET_AUDIT_ID_PATTERN = /^builder-agent-budget-audit:[0-9a-f]{64}$/u;
const BUDGET_KEYS = Object.freeze([
  'max_steps',
  'max_tool_calls',
  'max_runtime_ms',
  'max_private_source_bytes',
]);
const USAGE_KEYS = Object.freeze([
  'step_count',
  'tool_call_count',
  'runtime_ms',
  'private_source_bytes',
]);
const OUTCOME_KEYS = Object.freeze(['decision', 'reason', 'display_summary']);
const BUDGET_AUDIT_LIFECYCLE = Object.freeze({
  assignment: 'verified_active_assignment',
  supervision_lease: 'verified_active_lease_window',
  budget_audit: 'recorded_before_next_action',
  next_action: 'not_performed_by_contract',
  source_materialization: 'not_performed_by_contract',
  tool_dispatch: 'not_performed_by_contract',
  project_revision: 'not_created',
});
const BUDGET_AUDIT_AUTHORITY = Object.freeze({
  record_authority: 'main_agent_budget_audit_contract_v1',
  assignment_authority: 'main_agent_assignment_contract_v1',
  lease_authority: 'main_agent_supervision_lease_contract_v1',
  budget_authority: 'assignment_budget_snapshot_only',
  renderer_authority: 'not_present',
  model_dispatch: false,
  secret_access: 'not_present',
  source_read: 'not_performed_by_contract',
  source_write: 'not_performed_by_contract',
  tool_dispatch: 'not_performed_by_contract',
  process_run: 'not_performed_by_contract',
  revision_authority: 'not_present',
});
const BUDGET_AUDIT_KEYS = Object.freeze([
  'budget_audit_id',
  'definition_digest',
  'record_version',
  'record_kind',
  'assignment_id',
  'assignment_status_id',
  'lease_id',
  'agent_id',
  'agent_version_id',
  'owner_id',
  'project_id',
  'conversation_id',
  'task_id',
  'run_id',
  'lease_holder_id',
  'observed_at_ms',
  'requested_next_action',
  'budget_limits',
  'budget_usage',
  'outcome',
  'audit_contract',
  'lifecycle',
  'authority',
]);
const CREATE_KEYS = Object.freeze([
  'supervised_action_admission',
  'budget_audit',
  'step_id',
  'step_index',
  'started_at_ms',
]);
const RECEIPT_BODY_KEYS = Object.freeze([
  'receipt_version',
  'receipt_kind',
  'supervised_action_admission_id',
  'budget_audit_id',
  'assignment_id',
  'assignment_status_id',
  'lease_id',
  'agent_id',
  'agent_version_id',
  'owner_id',
  'project_id',
  'conversation_id',
  'task_id',
  'run_id',
  'step_id',
  'step_index',
  'budget_step_count_before',
  'budget_max_steps',
  'budget_runtime_ms_before',
  'budget_max_runtime_ms',
  'budget_audit_observed_at_ms',
  'admitted_at_ms',
  'started_at_ms',
  'lifecycle',
  'authority',
]);
const RECEIPT_KEYS = Object.freeze([...RECEIPT_BODY_KEYS, 'step_start_receipt_digest']);
const LIFECYCLE = Object.freeze({
  step_start_admission: 'store_backed_supervised_action_admission',
  budget_admission: 'verified_allowed_budget_audit',
  step_execution: 'not_started',
  provider_dispatch: 'not_started',
  model_dispatch: 'not_started',
  tool_dispatch: 'not_started',
  source_context: 'not_collected',
  result_for_review: 'not_created',
});
const AUTHORITY = Object.freeze({
  step_start_authority: 'main_agent_step_start_receipt_contract_v1',
  admission_store_authority: 'main_owned_agent_supervised_action_admission_store',
  budget_store_authority: 'main_owned_agent_budget_audit_store',
  renderer_authority: 'not_present',
  ipc_authority: 'not_present',
  provider_dispatch: false,
  model_dispatch: false,
  tool_dispatch: false,
  execution_authority: false,
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

class BuilderAgentStepStartContractError extends Error {
  constructor() {
    super('Builder agent step start receipt could not be verified.');
    this.name = 'BuilderAgentStepStartContractError';
    this.code = 'builder_agent_step_start_contract_invalid';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderAgentStepStartContractError();
}

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freezeDeep(nested);
    Object.freeze(value);
  }
  return value;
}

function isPlainObject(value) {
  if (
    value === null
    || typeof value !== 'object'
    || Array.isArray(value)
    || utilTypes.isProxy(value)
  ) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactObject(value, keys) {
  if (!isPlainObject(value)) fail();
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== keys.length
    || actual.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) fail();
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  }
  return value;
}

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  return descriptor.value;
}

function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map(
      (key) => `${JSON.stringify(key)}:${canonicalJson(valueAt(value, key))}`,
    ).join(',')}}`;
  }
  fail();
}

function sha256Canonical(value) {
  return `sha256:${nodeCrypto.createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')}`;
}

function safePattern(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) fail();
  return value;
}

function safeDigest(value) {
  return safePattern(value, DIGEST_PATTERN);
}

function safeStepId(value) {
  return safePattern(value, STEP_ID_PATTERN);
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail();
  return value;
}

function safeInteger(value, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail();
  return value;
}

function safeStepIndex(value) {
  return safeInteger(value, 1, 256);
}

function safeBudget(value) {
  const source = exactObject(value, BUDGET_KEYS);
  return freezeDeep({
    max_steps: safeInteger(valueAt(source, 'max_steps'), 1, 256),
    max_tool_calls: safeInteger(valueAt(source, 'max_tool_calls'), 0, 256),
    max_runtime_ms: safeInteger(valueAt(source, 'max_runtime_ms'), 1_000, 86_400_000),
    max_private_source_bytes: safeInteger(valueAt(source, 'max_private_source_bytes'), 0, 4 * 1_024 * 1_024),
  });
}

function safeUsage(value, budget) {
  const source = exactObject(value, USAGE_KEYS);
  return freezeDeep({
    step_count: safeInteger(valueAt(source, 'step_count'), 0, budget.max_steps),
    tool_call_count: safeInteger(valueAt(source, 'tool_call_count'), 0, budget.max_tool_calls),
    runtime_ms: safeInteger(valueAt(source, 'runtime_ms'), 0, budget.max_runtime_ms),
    private_source_bytes: safeInteger(
      valueAt(source, 'private_source_bytes'),
      0,
      budget.max_private_source_bytes,
    ),
  });
}

function safeOutcome(value) {
  const source = exactObject(value, OUTCOME_KEYS);
  if (
    valueAt(source, 'decision') !== 'allowed'
    || valueAt(source, 'reason') !== 'none'
    || valueAt(source, 'display_summary') !== 'Agent budget check passed.'
  ) fail();
  return freezeDeep({
    decision: 'allowed',
    reason: 'none',
    display_summary: 'Agent budget check passed.',
  });
}

function sanitizeBudgetAudit(value) {
  const source = exactObject(value, BUDGET_AUDIT_KEYS);
  const budgetLimits = safeBudget(valueAt(source, 'budget_limits'));
  const budgetUsage = safeUsage(valueAt(source, 'budget_usage'), budgetLimits);
  const outcome = safeOutcome(valueAt(source, 'outcome'));
  sanitizeFixedMap(valueAt(source, 'lifecycle'), BUDGET_AUDIT_LIFECYCLE);
  sanitizeFixedMap(valueAt(source, 'authority'), BUDGET_AUDIT_AUTHORITY);
  if (
    valueAt(source, 'record_version') !== 'builder-agent-budget-audit-record.v1'
    || valueAt(source, 'record_kind') !== 'builder_agent_budget_audit_record'
    || valueAt(source, 'requested_next_action') !== 'start_step'
    || valueAt(source, 'audit_contract') !== 'assignment_budget_checked_before_agent_work'
    || budgetUsage.step_count >= budgetLimits.max_steps
    || budgetUsage.runtime_ms >= budgetLimits.max_runtime_ms
  ) fail();
  return freezeDeep({
    budget_audit_id: safePattern(valueAt(source, 'budget_audit_id'), BUDGET_AUDIT_ID_PATTERN),
    definition_digest: safeDigest(valueAt(source, 'definition_digest')),
    record_version: 'builder-agent-budget-audit-record.v1',
    record_kind: 'builder_agent_budget_audit_record',
    assignment_id: safePattern(valueAt(source, 'assignment_id'), ASSIGNMENT_ID_PATTERN),
    assignment_status_id: safePattern(
      valueAt(source, 'assignment_status_id'),
      ASSIGNMENT_STATUS_ID_PATTERN,
    ),
    lease_id: safePattern(valueAt(source, 'lease_id'), SUPERVISION_LEASE_ID_PATTERN),
    agent_id: safePattern(valueAt(source, 'agent_id'), AGENT_ID_PATTERN),
    agent_version_id: safePattern(valueAt(source, 'agent_version_id'), AGENT_VERSION_ID_PATTERN),
    owner_id: safePattern(valueAt(source, 'owner_id'), OWNER_ID_PATTERN),
    project_id: safePattern(valueAt(source, 'project_id'), PROJECT_ID_PATTERN),
    conversation_id: safePattern(valueAt(source, 'conversation_id'), CONVERSATION_ID_PATTERN),
    task_id: safePattern(valueAt(source, 'task_id'), TASK_ID_PATTERN),
    run_id: safePattern(valueAt(source, 'run_id'), RUN_ID_PATTERN),
    lease_holder_id: safePattern(valueAt(source, 'lease_holder_id'), SUPERVISOR_ID_PATTERN),
    observed_at_ms: safeTimestamp(valueAt(source, 'observed_at_ms')),
    requested_next_action: 'start_step',
    budget_limits: budgetLimits,
    budget_usage: budgetUsage,
    outcome,
    audit_contract: 'assignment_budget_checked_before_agent_work',
  });
}

function sameAgentRun(admission, audit) {
  return admission.budget_audit_id === audit.budget_audit_id
    && admission.assignment_id === audit.assignment_id
    && admission.assignment_status_id === audit.assignment_status_id
    && admission.lease_id === audit.lease_id
    && admission.agent_id === audit.agent_id
    && admission.agent_version_id === audit.agent_version_id
    && admission.owner_id === audit.owner_id
    && admission.project_id === audit.project_id
    && admission.conversation_id === audit.conversation_id
    && admission.task_id === audit.task_id
    && admission.run_id === audit.run_id
    && admission.budget_audit_observed_at_ms === audit.observed_at_ms;
}

function receiptBody(admission, audit, stepId, stepIndex, startedAtMs) {
  return freezeDeep({
    receipt_version: BUILDER_AGENT_STEP_START_RECEIPT_VERSION,
    receipt_kind: BUILDER_AGENT_STEP_START_RECEIPT_KIND,
    supervised_action_admission_id: admission.admission_id,
    budget_audit_id: audit.budget_audit_id,
    assignment_id: admission.assignment_id,
    assignment_status_id: admission.assignment_status_id,
    lease_id: admission.lease_id,
    agent_id: admission.agent_id,
    agent_version_id: admission.agent_version_id,
    owner_id: admission.owner_id,
    project_id: admission.project_id,
    conversation_id: admission.conversation_id,
    task_id: admission.task_id,
    run_id: admission.run_id,
    step_id: stepId,
    step_index: stepIndex,
    budget_step_count_before: audit.budget_usage.step_count,
    budget_max_steps: audit.budget_limits.max_steps,
    budget_runtime_ms_before: audit.budget_usage.runtime_ms,
    budget_max_runtime_ms: audit.budget_limits.max_runtime_ms,
    budget_audit_observed_at_ms: audit.observed_at_ms,
    admitted_at_ms: admission.admitted_at_ms,
    started_at_ms: startedAtMs,
    lifecycle: { ...LIFECYCLE },
    authority: { ...AUTHORITY },
  });
}

function receiptDigestBody(receipt) {
  const body = {};
  for (const key of RECEIPT_BODY_KEYS) body[key] = valueAt(receipt, key);
  return body;
}

function createBuilderAgentStepStartReceipt(rawInput) {
  try {
    const input = exactObject(rawInput, CREATE_KEYS);
    const admission = sanitizeBuilderAgentSupervisedActionAdmission(
      valueAt(input, 'supervised_action_admission'),
    );
    const audit = sanitizeBudgetAudit(valueAt(input, 'budget_audit'));
    const stepId = safeStepId(valueAt(input, 'step_id'));
    const stepIndex = safeStepIndex(valueAt(input, 'step_index'));
    const startedAtMs = safeTimestamp(valueAt(input, 'started_at_ms'));
    if (
      admission.requested_next_action !== 'start_step'
      || admission.next_gate !== 'agent_step_runner_required_later'
      || !sameAgentRun(admission, audit)
      || stepIndex !== audit.budget_usage.step_count + 1
      || startedAtMs < admission.admitted_at_ms
    ) fail();
    const body = receiptBody(admission, audit, stepId, stepIndex, startedAtMs);
    return freezeDeep({
      ...body,
      step_start_receipt_digest: sha256Canonical(receiptDigestBody(body)),
    });
  } catch (error) {
    if (
      error instanceof BuilderAgentStepStartContractError
      || error instanceof BuilderAgentSupervisedActionAdmissionError
    ) fail();
    throw error;
  }
}

function sanitizeFixedMap(value, expected) {
  const source = exactObject(value, Object.keys(expected));
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (valueAt(source, key) !== expectedValue) fail();
  }
  return freezeDeep({ ...expected });
}

function sanitizeBuilderAgentStepStartReceipt(rawReceipt) {
  try {
    const receipt = exactObject(rawReceipt, RECEIPT_KEYS);
    const normalized = freezeDeep({
      receipt_version: valueAt(receipt, 'receipt_version'),
      receipt_kind: valueAt(receipt, 'receipt_kind'),
      supervised_action_admission_id: safePattern(
        valueAt(receipt, 'supervised_action_admission_id'),
        ADMISSION_ID_PATTERN,
      ),
      budget_audit_id: safePattern(valueAt(receipt, 'budget_audit_id'), BUDGET_AUDIT_ID_PATTERN),
      assignment_id: safePattern(valueAt(receipt, 'assignment_id'), ASSIGNMENT_ID_PATTERN),
      assignment_status_id: safePattern(
        valueAt(receipt, 'assignment_status_id'),
        ASSIGNMENT_STATUS_ID_PATTERN,
      ),
      lease_id: safePattern(valueAt(receipt, 'lease_id'), SUPERVISION_LEASE_ID_PATTERN),
      agent_id: safePattern(valueAt(receipt, 'agent_id'), AGENT_ID_PATTERN),
      agent_version_id: safePattern(valueAt(receipt, 'agent_version_id'), AGENT_VERSION_ID_PATTERN),
      owner_id: safePattern(valueAt(receipt, 'owner_id'), OWNER_ID_PATTERN),
      project_id: safePattern(valueAt(receipt, 'project_id'), PROJECT_ID_PATTERN),
      conversation_id: safePattern(valueAt(receipt, 'conversation_id'), CONVERSATION_ID_PATTERN),
      task_id: safePattern(valueAt(receipt, 'task_id'), TASK_ID_PATTERN),
      run_id: safePattern(valueAt(receipt, 'run_id'), RUN_ID_PATTERN),
      step_id: safeStepId(valueAt(receipt, 'step_id')),
      step_index: safeStepIndex(valueAt(receipt, 'step_index')),
      budget_step_count_before: safeInteger(valueAt(receipt, 'budget_step_count_before'), 0, 256),
      budget_max_steps: safeInteger(valueAt(receipt, 'budget_max_steps'), 1, 256),
      budget_runtime_ms_before: safeInteger(valueAt(receipt, 'budget_runtime_ms_before'), 0, 86_400_000),
      budget_max_runtime_ms: safeInteger(valueAt(receipt, 'budget_max_runtime_ms'), 1_000, 86_400_000),
      budget_audit_observed_at_ms: safeTimestamp(valueAt(receipt, 'budget_audit_observed_at_ms')),
      admitted_at_ms: safeTimestamp(valueAt(receipt, 'admitted_at_ms')),
      started_at_ms: safeTimestamp(valueAt(receipt, 'started_at_ms')),
      lifecycle: sanitizeFixedMap(valueAt(receipt, 'lifecycle'), LIFECYCLE),
      authority: sanitizeFixedMap(valueAt(receipt, 'authority'), AUTHORITY),
    });
    if (
      normalized.receipt_version !== BUILDER_AGENT_STEP_START_RECEIPT_VERSION
      || normalized.receipt_kind !== BUILDER_AGENT_STEP_START_RECEIPT_KIND
      || normalized.budget_step_count_before >= normalized.budget_max_steps
      || normalized.budget_runtime_ms_before >= normalized.budget_max_runtime_ms
      || normalized.step_index !== normalized.budget_step_count_before + 1
      || normalized.budget_audit_observed_at_ms > normalized.admitted_at_ms
      || normalized.admitted_at_ms > normalized.started_at_ms
      || safeDigest(valueAt(receipt, 'step_start_receipt_digest')) !== sha256Canonical(receiptDigestBody(normalized))
    ) fail();
    return freezeDeep({
      ...normalized,
      step_start_receipt_digest: valueAt(receipt, 'step_start_receipt_digest'),
    });
  } catch (error) {
    if (error instanceof BuilderAgentStepStartContractError) fail();
    throw error;
  }
}

module.exports = Object.freeze({
  BUILDER_AGENT_STEP_START_CONTRACT_VERSION,
  BUILDER_AGENT_STEP_START_RECEIPT_KIND,
  BUILDER_AGENT_STEP_START_RECEIPT_VERSION,
  BuilderAgentStepStartContractError,
  createBuilderAgentStepStartReceipt,
  sanitizeBuilderAgentStepStartReceipt,
});
