'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const {
  BUILDER_TOOL_CALL_RECORD_VERSION,
  sanitizeBuilderToolCallRecord,
} = require('./builder-tool-call-records.cjs');

const BUILDER_TOOL_RESULT_RECORD_VERSION = 'builder-tool-result-record.v1';
const TOOL_RESULT_RECORD_KIND = 'builder_tool_result_record';
const INPUT_KEYS = Object.freeze(['tool_call_record', 'observed_at_ms', 'result']);
const RECORD_KEYS = Object.freeze([
  'record_version',
  'record_kind',
  'project_id',
  'conversation_id',
  'turn_id',
  'task_id',
  'run_id',
  'step_id',
  'tool_call_id',
  'action',
  'resource_kind',
  'observed_at_ms',
  'tool_call_record',
  'result',
  'lifecycle',
  'authority',
  'record_digest',
]);
const RESULT_INPUT_KEYS = Object.freeze(['status', 'summary_code']);
const RESULT_RECORD_KEYS = Object.freeze(['status', 'summary_code', 'display_summary', 'summary_digest']);
const LIFECYCLE_KEYS = Object.freeze([
  'permission_admission',
  'tool_call_admission',
  'dispatch_admission',
  'execution_admission',
  'result_admission',
  'raw_output_admission',
  'revision_admission',
]);
const AUTHORITY_KEYS = Object.freeze([
  'record_authority',
  'tool_call_authority',
  'conversation_binding',
  'renderer_authority',
  'provider_dispatch',
  'credential_readback',
  'tool_dispatch',
  'raw_output_storage',
  'git_authority',
]);
const RESULT_STATUSES = Object.freeze(['succeeded', 'failed', 'cancelled']);
const RESULT_SUMMARY_CODES = Object.freeze({
  succeeded: Object.freeze(['completed_without_raw_output']),
  failed: Object.freeze([
    'failed_without_raw_output',
    'output_rejected',
    'adapter_unavailable',
    'timed_out_without_raw_output',
  ]),
  cancelled: Object.freeze(['cancelled_without_raw_output']),
});
const DISPLAY_SUMMARIES = Object.freeze({
  completed_without_raw_output: 'This step completed. Details were not kept.',
  failed_without_raw_output: 'This step could not finish. Details were not kept.',
  output_rejected: 'The tool output was not accepted.',
  adapter_unavailable: 'The tool was unavailable.',
  timed_out_without_raw_output: 'This step timed out. Details were not kept.',
  cancelled_without_raw_output: 'This step was stopped. Details were not kept.',
});
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const LIFECYCLE = Object.freeze({
  permission_admission: 'verified_allowed',
  tool_call_admission: 'verified_pre_dispatch_record',
  dispatch_admission: 'not_performed_by_record_contract',
  execution_admission: 'not_performed_by_record_contract',
  result_admission: 'fixed_summary_code_recorded',
  raw_output_admission: 'not_included',
  revision_admission: 'not_created',
});
const AUTHORITY = Object.freeze({
  record_authority: 'main_tool_result_record_contract_v1',
  tool_call_authority: 'main_tool_call_record_contract_v1',
  conversation_binding: 'verified_tool_call_record',
  renderer_authority: 'not_present',
  provider_dispatch: false,
  credential_readback: false,
  tool_dispatch: 'not_performed_by_record_contract',
  raw_output_storage: 'not_present',
  git_authority: 'not_present',
});
const MAX_DISPLAY_SUMMARY_BYTES = 160;

class BuilderToolResultRecordError extends Error {
  constructor() {
    super('The tool result record could not be verified.');
    this.name = 'BuilderToolResultRecordError';
    this.code = 'builder_tool_result_record_invalid';
    this.retryable = false;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderToolResultRecordError();
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
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      fail();
    }
  }
  return descriptors;
}

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
    fail();
  }
  return descriptor.value;
}

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freezeDeep(nested);
    Object.freeze(value);
  }
  return value;
}

function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
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

function safeDigest(value) {
  if (typeof value !== 'string' || !DIGEST_PATTERN.test(value)) fail();
  return value;
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail();
  return value;
}

function safeStatus(value) {
  if (typeof value !== 'string' || !RESULT_STATUSES.includes(value)) fail();
  return value;
}

function safeSummaryCode(value, status) {
  if (
    typeof value !== 'string'
    || !RESULT_SUMMARY_CODES[status].includes(value)
  ) fail();
  return value;
}

function summaryDigestBody(value) {
  return {
    digest_authority: 'bounded_tool_result_summary_v1',
    display_summary: value.display_summary,
    status: value.status,
    summary_code: value.summary_code,
  };
}

function resultRecord({ status, summaryCode, maxDisplaySummaryBytes }) {
  const displaySummary = DISPLAY_SUMMARIES[summaryCode];
  if (
    !Number.isSafeInteger(maxDisplaySummaryBytes)
    || maxDisplaySummaryBytes < 1
    || maxDisplaySummaryBytes > MAX_DISPLAY_SUMMARY_BYTES
    || Buffer.byteLength(displaySummary, 'utf8') > maxDisplaySummaryBytes
  ) fail();
  const unsigned = freezeDeep({
    status,
    summary_code: summaryCode,
    display_summary: displaySummary,
  });
  return freezeDeep({
    ...unsigned,
    summary_digest: sha256Canonical(summaryDigestBody(unsigned)),
  });
}

function sanitizeResultInput(value, maxDisplaySummaryBytes) {
  const descriptors = exactObject(value, RESULT_INPUT_KEYS);
  const status = safeStatus(descriptors.status.value);
  return resultRecord({
    status,
    summaryCode: safeSummaryCode(descriptors.summary_code.value, status),
    maxDisplaySummaryBytes,
  });
}

function sanitizeResultRecord(value, maxDisplaySummaryBytes) {
  const descriptors = exactObject(value, RESULT_RECORD_KEYS);
  const status = safeStatus(descriptors.status.value);
  const result = resultRecord({
    status,
    summaryCode: safeSummaryCode(descriptors.summary_code.value, status),
    maxDisplaySummaryBytes,
  });
  if (
    descriptors.display_summary.value !== result.display_summary
    || safeDigest(descriptors.summary_digest.value) !== result.summary_digest
  ) fail();
  return result;
}

function sanitizeLifecycle(value) {
  const descriptors = exactObject(value, LIFECYCLE_KEYS);
  for (const key of LIFECYCLE_KEYS) {
    if (descriptors[key].value !== LIFECYCLE[key]) fail();
  }
  return freezeDeep({ ...LIFECYCLE });
}

function sanitizeAuthority(value) {
  const descriptors = exactObject(value, AUTHORITY_KEYS);
  for (const key of AUTHORITY_KEYS) {
    if (descriptors[key].value !== AUTHORITY[key]) fail();
  }
  return freezeDeep({ ...AUTHORITY });
}

function resultDigestBody(value) {
  return {
    action: value.action,
    authority: value.authority,
    conversation_id: value.conversation_id,
    lifecycle: value.lifecycle,
    observed_at_ms: value.observed_at_ms,
    project_id: value.project_id,
    record_kind: value.record_kind,
    record_version: value.record_version,
    resource_kind: value.resource_kind,
    result: value.result,
    run_id: value.run_id,
    step_id: value.step_id,
    task_id: value.task_id,
    tool_call_id: value.tool_call_id,
    tool_call_record: value.tool_call_record,
    turn_id: value.turn_id,
  };
}

function unsignedRecord({ toolCallRecord, observedAtMs, result }) {
  if (
    toolCallRecord.record_version !== BUILDER_TOOL_CALL_RECORD_VERSION
    || toolCallRecord.lifecycle.permission_admission !== 'verified_allowed'
    || toolCallRecord.lifecycle.session_policy_admission !== 'verified_main_run_policy'
    || toolCallRecord.lifecycle.dispatch_admission !== 'not_started'
    || toolCallRecord.lifecycle.execution_admission !== 'not_performed'
    || toolCallRecord.lifecycle.result_admission !== 'not_recorded'
    || toolCallRecord.lifecycle.revision_admission !== 'not_created'
    || observedAtMs < toolCallRecord.requested_at_ms
    || observedAtMs - toolCallRecord.requested_at_ms > toolCallRecord.session_policy.limits.max_step_timeout_ms
    || observedAtMs - toolCallRecord.session_policy.issued_at_ms > toolCallRecord.session_policy.limits.max_total_timeout_ms
  ) fail();
  return freezeDeep({
    record_version: BUILDER_TOOL_RESULT_RECORD_VERSION,
    record_kind: TOOL_RESULT_RECORD_KIND,
    project_id: toolCallRecord.project_id,
    conversation_id: toolCallRecord.conversation_id,
    turn_id: toolCallRecord.turn_id,
    task_id: toolCallRecord.task_id,
    run_id: toolCallRecord.run_id,
    step_id: toolCallRecord.step_id,
    tool_call_id: toolCallRecord.tool_call_id,
    action: toolCallRecord.action,
    resource_kind: toolCallRecord.resource.resource_kind,
    observed_at_ms: observedAtMs,
    tool_call_record: toolCallRecord,
    result,
    lifecycle: { ...LIFECYCLE },
    authority: { ...AUTHORITY },
  });
}

function createBuilderToolResultRecord(rawInput) {
  try {
    const descriptors = exactObject(rawInput, INPUT_KEYS);
    const toolCallRecord = sanitizeBuilderToolCallRecord(descriptors.tool_call_record.value);
    const record = unsignedRecord({
      toolCallRecord,
      observedAtMs: safeTimestamp(descriptors.observed_at_ms.value),
      result: sanitizeResultInput(
        descriptors.result.value,
        toolCallRecord.session_policy.limits.max_public_summary_bytes,
      ),
    });
    return freezeDeep({
      ...record,
      record_digest: sha256Canonical(resultDigestBody(record)),
    });
  } catch (error) {
    if (error instanceof BuilderToolResultRecordError) throw error;
    fail();
  }
}

function sanitizeBuilderToolResultRecord(rawRecord) {
  try {
    const descriptors = exactObject(rawRecord, RECORD_KEYS);
    const toolCallRecord = sanitizeBuilderToolCallRecord(descriptors.tool_call_record.value);
    const observedAtMs = safeTimestamp(descriptors.observed_at_ms.value);
    const result = sanitizeResultRecord(
      descriptors.result.value,
      toolCallRecord.session_policy.limits.max_public_summary_bytes,
    );
    const record = unsignedRecord({ toolCallRecord, observedAtMs, result });
    if (
      descriptors.record_version.value !== BUILDER_TOOL_RESULT_RECORD_VERSION
      || descriptors.record_kind.value !== TOOL_RESULT_RECORD_KIND
      || descriptors.project_id.value !== record.project_id
      || descriptors.conversation_id.value !== record.conversation_id
      || descriptors.turn_id.value !== record.turn_id
      || descriptors.task_id.value !== record.task_id
      || descriptors.run_id.value !== record.run_id
      || descriptors.step_id.value !== record.step_id
      || descriptors.tool_call_id.value !== record.tool_call_id
      || descriptors.action.value !== record.action
      || descriptors.resource_kind.value !== record.resource_kind
      || JSON.stringify(sanitizeLifecycle(descriptors.lifecycle.value)) !== JSON.stringify(record.lifecycle)
      || JSON.stringify(sanitizeAuthority(descriptors.authority.value)) !== JSON.stringify(record.authority)
    ) fail();
    const digest = safeDigest(descriptors.record_digest.value);
    if (digest !== sha256Canonical(resultDigestBody(record))) fail();
    return freezeDeep({
      ...record,
      record_digest: digest,
    });
  } catch (error) {
    if (error instanceof BuilderToolResultRecordError) throw error;
    fail();
  }
}

module.exports = freezeDeep({
  BUILDER_TOOL_RESULT_RECORD_VERSION,
  TOOL_RESULT_RECORD_KIND,
  BuilderToolResultRecordError,
  createBuilderToolResultRecord,
  sanitizeBuilderToolResultRecord,
});
