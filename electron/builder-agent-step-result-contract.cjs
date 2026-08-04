'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const {
  BuilderAgentStepStartContractError,
  sanitizeBuilderAgentStepStartReceipt,
} = require('./builder-agent-step-start-contract.cjs');

const BUILDER_AGENT_STEP_RESULT_CONTRACT_VERSION =
  'builder-agent-step-result-contract.v1';
const BUILDER_AGENT_STEP_RESULT_RECEIPT_VERSION =
  'builder-agent-step-result-receipt.v1';
const BUILDER_AGENT_STEP_RESULT_RECEIPT_KIND = 'builder_agent_step_result_receipt';
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const OWNER_ID_PATTERN = new RegExp(`^builder-user:${UUID_SOURCE}$`, 'u');
const AGENT_ID_PATTERN = new RegExp(`^builder-agent:${UUID_SOURCE}$`, 'u');
const PROJECT_ID_PATTERN = new RegExp(`^builder-project:${UUID_SOURCE}$`, 'u');
const CONVERSATION_ID_PATTERN = new RegExp(`^builder-conversation:${UUID_SOURCE}$`, 'u');
const TASK_ID_PATTERN = new RegExp(`^builder-task:${UUID_SOURCE}$`, 'u');
const RUN_ID_PATTERN = new RegExp(`^builder-run:${UUID_SOURCE}$`, 'u');
const STEP_ID_PATTERN = new RegExp(`^builder-run-step:${UUID_SOURCE}$`, 'u');
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const AGENT_VERSION_ID_PATTERN = /^builder-agent-version:[0-9a-f]{64}$/u;
const ASSIGNMENT_ID_PATTERN = /^builder-agent-assignment:[0-9a-f]{64}$/u;
const ASSIGNMENT_STATUS_ID_PATTERN = /^builder-agent-assignment-status:[0-9a-f]{64}$/u;
const SUPERVISION_LEASE_ID_PATTERN = /^builder-agent-supervision-lease:[0-9a-f]{64}$/u;
const BUDGET_AUDIT_ID_PATTERN = /^builder-agent-budget-audit:[0-9a-f]{64}$/u;
const ADMISSION_ID_PATTERN = /^builder-agent-supervised-action-admission:[0-9a-f]{64}$/u;
const CREATE_KEYS = Object.freeze([
  'step_start_receipt',
  'observed_at_ms',
  'result',
]);
const RESULT_INPUT_KEYS = Object.freeze(['status', 'summary_code']);
const RESULT_RECORD_KEYS = Object.freeze([
  'status',
  'summary_code',
  'display_summary',
  'summary_digest',
]);
const RECEIPT_BODY_KEYS = Object.freeze([
  'receipt_version',
  'receipt_kind',
  'step_start_receipt_digest',
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
  'started_at_ms',
  'observed_at_ms',
  'result',
  'lifecycle',
  'authority',
]);
const RECEIPT_KEYS = Object.freeze([
  ...RECEIPT_BODY_KEYS,
  'step_result_receipt_digest',
]);
const RESULT_STATUSES = Object.freeze([
  'succeeded',
  'blocked',
  'failed',
  'cancelled',
]);
const RESULT_SUMMARY_CODES = Object.freeze({
  succeeded: Object.freeze(['agent_step_completed_without_raw_output']),
  blocked: Object.freeze(['agent_step_needs_owner_attention']),
  failed: Object.freeze(['agent_step_failed_without_raw_output']),
  cancelled: Object.freeze(['agent_step_cancelled_without_raw_output']),
});
const DISPLAY_SUMMARIES = Object.freeze({
  agent_step_completed_without_raw_output:
    'Agent step completed. Details were not kept.',
  agent_step_needs_owner_attention:
    'Agent step needs owner attention.',
  agent_step_failed_without_raw_output:
    'Agent step could not finish. Details were not kept.',
  agent_step_cancelled_without_raw_output:
    'Agent step was stopped. Details were not kept.',
});
const LIFECYCLE = Object.freeze({
  step_start: 'verified_step_start_receipt',
  step_execution: 'not_performed_by_contract',
  provider_dispatch: 'not_performed_by_contract',
  model_dispatch: 'not_performed_by_contract',
  tool_dispatch: 'not_performed_by_contract',
  source_context: 'not_collected_by_contract',
  raw_output: 'not_included',
  result_for_review: 'not_created',
  project_revision: 'not_created',
});
const AUTHORITY = Object.freeze({
  step_result_authority: 'main_agent_step_result_receipt_contract_v1',
  step_start_authority: 'main_agent_step_start_receipt_contract_v1',
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
  raw_output_storage: false,
  raw_context_storage: false,
});

class BuilderAgentStepResultContractError extends Error {
  constructor() {
    super('Builder agent step result receipt could not be verified.');
    this.name = 'BuilderAgentStepResultContractError';
    this.code = 'builder_agent_step_result_contract_invalid';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderAgentStepResultContractError();
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
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      fail();
    }
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

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail();
  return value;
}

function safeStepIndex(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 256) fail();
  return value;
}

function sanitizeFixedMap(value, expected) {
  const source = exactObject(value, Object.keys(expected));
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (valueAt(source, key) !== expectedValue) fail();
  }
  return freezeDeep({ ...expected });
}

function resultDigestBody(result) {
  return freezeDeep({
    status: valueAt(result, 'status'),
    summary_code: valueAt(result, 'summary_code'),
    display_summary: valueAt(result, 'display_summary'),
  });
}

function safeResultStatus(value) {
  if (typeof value !== 'string' || !RESULT_STATUSES.includes(value)) fail();
  return value;
}

function safeResultSummaryCode(status, value) {
  if (
    typeof value !== 'string'
    || !Object.hasOwn(RESULT_SUMMARY_CODES, status)
    || !RESULT_SUMMARY_CODES[status].includes(value)
  ) fail();
  return value;
}

function resultRecord(status, summaryCode) {
  const displaySummary = DISPLAY_SUMMARIES[summaryCode];
  const body = freezeDeep({
    status,
    summary_code: summaryCode,
    display_summary: displaySummary,
  });
  return freezeDeep({
    ...body,
    summary_digest: sha256Canonical(resultDigestBody(body)),
  });
}

function safeCreateResult(value) {
  const source = exactObject(value, RESULT_INPUT_KEYS);
  const status = safeResultStatus(valueAt(source, 'status'));
  const summaryCode = safeResultSummaryCode(status, valueAt(source, 'summary_code'));
  return resultRecord(status, summaryCode);
}

function safeStoredResult(value) {
  const source = exactObject(value, RESULT_RECORD_KEYS);
  const status = safeResultStatus(valueAt(source, 'status'));
  const summaryCode = safeResultSummaryCode(status, valueAt(source, 'summary_code'));
  const expected = resultRecord(status, summaryCode);
  if (
    valueAt(source, 'display_summary') !== expected.display_summary
    || safeDigest(valueAt(source, 'summary_digest')) !== expected.summary_digest
  ) fail();
  return expected;
}

function receiptBody(stepStartReceipt, observedAtMs, result) {
  return freezeDeep({
    receipt_version: BUILDER_AGENT_STEP_RESULT_RECEIPT_VERSION,
    receipt_kind: BUILDER_AGENT_STEP_RESULT_RECEIPT_KIND,
    step_start_receipt_digest: stepStartReceipt.step_start_receipt_digest,
    supervised_action_admission_id: stepStartReceipt.supervised_action_admission_id,
    budget_audit_id: stepStartReceipt.budget_audit_id,
    assignment_id: stepStartReceipt.assignment_id,
    assignment_status_id: stepStartReceipt.assignment_status_id,
    lease_id: stepStartReceipt.lease_id,
    agent_id: stepStartReceipt.agent_id,
    agent_version_id: stepStartReceipt.agent_version_id,
    owner_id: stepStartReceipt.owner_id,
    project_id: stepStartReceipt.project_id,
    conversation_id: stepStartReceipt.conversation_id,
    task_id: stepStartReceipt.task_id,
    run_id: stepStartReceipt.run_id,
    step_id: stepStartReceipt.step_id,
    step_index: stepStartReceipt.step_index,
    started_at_ms: stepStartReceipt.started_at_ms,
    observed_at_ms: observedAtMs,
    result,
    lifecycle: { ...LIFECYCLE },
    authority: { ...AUTHORITY },
  });
}

function receiptDigestBody(receipt) {
  const body = {};
  for (const key of RECEIPT_BODY_KEYS) body[key] = valueAt(receipt, key);
  return body;
}

function createBuilderAgentStepResultReceipt(rawInput) {
  try {
    const input = exactObject(rawInput, CREATE_KEYS);
    const stepStartReceipt = sanitizeBuilderAgentStepStartReceipt(
      valueAt(input, 'step_start_receipt'),
    );
    const observedAtMs = safeTimestamp(valueAt(input, 'observed_at_ms'));
    const result = safeCreateResult(valueAt(input, 'result'));
    if (observedAtMs < stepStartReceipt.started_at_ms) fail();
    const body = receiptBody(stepStartReceipt, observedAtMs, result);
    return freezeDeep({
      ...body,
      step_result_receipt_digest: sha256Canonical(receiptDigestBody(body)),
    });
  } catch (error) {
    if (
      error instanceof BuilderAgentStepResultContractError
      || error instanceof BuilderAgentStepStartContractError
    ) fail();
    throw error;
  }
}

function sanitizeBuilderAgentStepResultReceipt(rawReceipt) {
  try {
    const receipt = exactObject(rawReceipt, RECEIPT_KEYS);
    const result = safeStoredResult(valueAt(receipt, 'result'));
    const normalized = freezeDeep({
      receipt_version: valueAt(receipt, 'receipt_version'),
      receipt_kind: valueAt(receipt, 'receipt_kind'),
      step_start_receipt_digest: safeDigest(valueAt(receipt, 'step_start_receipt_digest')),
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
      step_id: safePattern(valueAt(receipt, 'step_id'), STEP_ID_PATTERN),
      step_index: safeStepIndex(valueAt(receipt, 'step_index')),
      started_at_ms: safeTimestamp(valueAt(receipt, 'started_at_ms')),
      observed_at_ms: safeTimestamp(valueAt(receipt, 'observed_at_ms')),
      result,
      lifecycle: sanitizeFixedMap(valueAt(receipt, 'lifecycle'), LIFECYCLE),
      authority: sanitizeFixedMap(valueAt(receipt, 'authority'), AUTHORITY),
    });
    if (
      normalized.receipt_version !== BUILDER_AGENT_STEP_RESULT_RECEIPT_VERSION
      || normalized.receipt_kind !== BUILDER_AGENT_STEP_RESULT_RECEIPT_KIND
      || normalized.observed_at_ms < normalized.started_at_ms
      || safeDigest(valueAt(receipt, 'step_result_receipt_digest')) !== sha256Canonical(receiptDigestBody(normalized))
    ) fail();
    return freezeDeep({
      ...normalized,
      step_result_receipt_digest: valueAt(receipt, 'step_result_receipt_digest'),
    });
  } catch (error) {
    if (error instanceof BuilderAgentStepResultContractError) fail();
    throw error;
  }
}

module.exports = Object.freeze({
  BUILDER_AGENT_STEP_RESULT_CONTRACT_VERSION,
  BUILDER_AGENT_STEP_RESULT_RECEIPT_KIND,
  BUILDER_AGENT_STEP_RESULT_RECEIPT_VERSION,
  BuilderAgentStepResultContractError,
  createBuilderAgentStepResultReceipt,
  sanitizeBuilderAgentStepResultReceipt,
});
