'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const {
  BUILDER_TOOL_CALL_RECORD_VERSION,
  sanitizeBuilderToolCallRecord,
} = require('./builder-tool-call-records.cjs');

const BUILDER_TOOL_RESULT_RECORD_VERSION = 'builder-tool-result-record.v1';
const TOOL_RESULT_RECORD_KIND = 'builder_tool_result_record';
const BUILDER_TOOL_RUNTIME_INVOCATION_ADMISSION_VERSION = 'builder-tool-runtime-invocation-admission.v1';
const TOOL_RUNTIME_INVOCATION_ADMISSION_KIND = 'builder_tool_runtime_invocation_admission';
const FILESYSTEM_READ_TOOL_ADAPTER_ID = 'builder-tool-adapter.filesystem-read.v1';
const FILESYSTEM_READ_TOOL_RUNTIME_ID = 'builder-tool-runtime.filesystem-read-envelope.v1';
const INPUT_KEYS = Object.freeze([
  'runtime_invocation_admission',
  'tool_call_record',
  'observed_at_ms',
  'result',
]);
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
  'dispatch_request_id',
  'adapter_selection_id',
  'runtime_invocation_id',
  'adapter_id',
  'runtime_id',
  'dispatch_admission_digest',
  'adapter_selection_digest',
  'runtime_invocation_digest',
  'policy_digest',
  'tool_call_record',
  'runtime_invocation_admission',
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
  'adapter_selection',
  'runtime_admission',
  'execution_admission',
  'result_admission',
  'raw_output_admission',
  'revision_admission',
]);
const AUTHORITY_KEYS = Object.freeze([
  'record_authority',
  'tool_call_authority',
  'runtime_invocation_authority',
  'conversation_binding',
  'renderer_authority',
  'provider_dispatch',
  'credential_readback',
  'tool_dispatch',
  'runtime_execution',
  'raw_output_storage',
  'git_authority',
]);
const RUNTIME_ADMISSION_KEYS = Object.freeze([
  'admission_version',
  'admission_kind',
  'project_id',
  'conversation_id',
  'turn_id',
  'task_id',
  'run_id',
  'step_id',
  'tool_call_id',
  'dispatch_request_id',
  'adapter_selection_id',
  'runtime_invocation_id',
  'dispatch_admission_digest',
  'adapter_selection_digest',
  'record_digest',
  'policy_digest',
  'adapter_id',
  'runtime_id',
  'tool_name',
  'action',
  'resource_kind',
  'adapter_selected_at_ms',
  'runtime_admitted_at_ms',
  'max_raw_output_bytes',
  'max_chargeable_dispatches',
  'lifecycle',
  'authority',
  'admission_digest',
]);
const RUNTIME_LIFECYCLE_KEYS = Object.freeze([
  'dispatch_admission',
  'adapter_selection',
  'runtime_admission',
  'runtime_invocation',
  'filesystem_read',
  'execution_admission',
  'result_admission',
  'raw_output_admission',
  'revision_admission',
]);
const RUNTIME_AUTHORITY_KEYS = Object.freeze([
  'runtime_authority',
  'selection_authority',
  'adapter_registry_authority',
  'runtime_registry_authority',
  'conversation_binding',
  'renderer_authority',
  'provider_dispatch',
  'credential_readback',
  'tool_dispatch',
  'runtime_execution',
  'filesystem_read',
  'network_access',
  'process_access',
  'secret_access',
  'raw_output_storage',
  'git_authority',
  'cost_authority',
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
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const DISPATCH_REQUEST_ID_PATTERN = new RegExp(`^builder-tool-dispatch-request:${UUID_SOURCE}$`, 'u');
const ADAPTER_SELECTION_ID_PATTERN = new RegExp(`^builder-tool-adapter-selection:${UUID_SOURCE}$`, 'u');
const RUNTIME_INVOCATION_ID_PATTERN = new RegExp(`^builder-tool-runtime-invocation:${UUID_SOURCE}$`, 'u');
const LIFECYCLE = Object.freeze({
  permission_admission: 'verified_allowed',
  tool_call_admission: 'verified_pre_dispatch_record',
  dispatch_admission: 'verified_by_runtime_invocation',
  adapter_selection: 'verified_static_adapter',
  runtime_admission: 'verified_runtime_invocation',
  execution_admission: 'not_performed_by_record_contract',
  result_admission: 'fixed_summary_code_recorded',
  raw_output_admission: 'not_included',
  revision_admission: 'not_created',
});
const RUNTIME_LIFECYCLE = Object.freeze({
  dispatch_admission: 'verified_bounded_main_admission',
  adapter_selection: 'verified_static_adapter',
  runtime_admission: 'bounded_envelope_admitted',
  runtime_invocation: 'admitted_without_execution',
  filesystem_read: 'not_performed',
  execution_admission: 'not_started',
  result_admission: 'not_recorded',
  raw_output_admission: 'not_included',
  revision_admission: 'not_created',
});
const AUTHORITY = Object.freeze({
  record_authority: 'main_tool_result_record_contract_v1',
  tool_call_authority: 'main_tool_call_record_contract_v1',
  runtime_invocation_authority: 'main_tool_runtime_invocation_contract_v1',
  conversation_binding: 'verified_tool_call_record_and_runtime_invocation',
  renderer_authority: 'not_present',
  provider_dispatch: false,
  credential_readback: false,
  tool_dispatch: 'bounded_without_raw_output',
  runtime_execution: 'not_performed_by_record_contract',
  raw_output_storage: 'not_present',
  git_authority: 'not_present',
});
const RUNTIME_AUTHORITY = Object.freeze({
  runtime_authority: 'main_tool_runtime_invocation_contract_v1',
  selection_authority: 'main_tool_adapter_selection_contract_v1',
  adapter_registry_authority: 'static_main_tool_adapter_registry_v1',
  runtime_registry_authority: 'static_main_tool_runtime_registry_v1',
  conversation_binding: 'trusted_open_tool_call_required',
  renderer_authority: 'not_present',
  provider_dispatch: false,
  credential_readback: false,
  tool_dispatch: 'not_performed',
  runtime_execution: 'not_started',
  filesystem_read: 'not_performed',
  network_access: 'denied',
  process_access: 'denied',
  secret_access: 'denied',
  raw_output_storage: 'not_present',
  git_authority: 'not_present',
  cost_authority: 'no_chargeable_dispatch_without_runtime_meter_v1',
});
const MAX_TOOL_RAW_OUTPUT_BYTES = 64 * 1_024;
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

function safePattern(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) fail();
  return value;
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail();
  return value;
}

function safeRawOutputBytes(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_TOOL_RAW_OUTPUT_BYTES) fail();
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

function sanitizeRuntimeLifecycle(value) {
  const descriptors = exactObject(value, RUNTIME_LIFECYCLE_KEYS);
  for (const key of RUNTIME_LIFECYCLE_KEYS) {
    if (descriptors[key].value !== RUNTIME_LIFECYCLE[key]) fail();
  }
  return freezeDeep({ ...RUNTIME_LIFECYCLE });
}

function sanitizeRuntimeAuthority(value) {
  const descriptors = exactObject(value, RUNTIME_AUTHORITY_KEYS);
  for (const key of RUNTIME_AUTHORITY_KEYS) {
    if (descriptors[key].value !== RUNTIME_AUTHORITY[key]) fail();
  }
  return freezeDeep({ ...RUNTIME_AUTHORITY });
}

function runtimeDigestBody(value) {
  return {
    action: value.action,
    adapter_id: value.adapter_id,
    adapter_selected_at_ms: value.adapter_selected_at_ms,
    adapter_selection_digest: value.adapter_selection_digest,
    adapter_selection_id: value.adapter_selection_id,
    admission_kind: value.admission_kind,
    admission_version: value.admission_version,
    authority: value.authority,
    conversation_id: value.conversation_id,
    dispatch_admission_digest: value.dispatch_admission_digest,
    dispatch_request_id: value.dispatch_request_id,
    lifecycle: value.lifecycle,
    max_chargeable_dispatches: value.max_chargeable_dispatches,
    max_raw_output_bytes: value.max_raw_output_bytes,
    policy_digest: value.policy_digest,
    project_id: value.project_id,
    record_digest: value.record_digest,
    resource_kind: value.resource_kind,
    run_id: value.run_id,
    runtime_admitted_at_ms: value.runtime_admitted_at_ms,
    runtime_id: value.runtime_id,
    runtime_invocation_id: value.runtime_invocation_id,
    step_id: value.step_id,
    task_id: value.task_id,
    tool_call_id: value.tool_call_id,
    tool_name: value.tool_name,
    turn_id: value.turn_id,
  };
}

function sanitizeRuntimeInvocationAdmission(value) {
  const descriptors = exactObject(value, RUNTIME_ADMISSION_KEYS);
  const runtime = freezeDeep({
    admission_version: descriptors.admission_version.value,
    admission_kind: descriptors.admission_kind.value,
    project_id: descriptors.project_id.value,
    conversation_id: descriptors.conversation_id.value,
    turn_id: descriptors.turn_id.value,
    task_id: descriptors.task_id.value,
    run_id: descriptors.run_id.value,
    step_id: descriptors.step_id.value,
    tool_call_id: descriptors.tool_call_id.value,
    dispatch_request_id: safePattern(descriptors.dispatch_request_id.value, DISPATCH_REQUEST_ID_PATTERN),
    adapter_selection_id: safePattern(descriptors.adapter_selection_id.value, ADAPTER_SELECTION_ID_PATTERN),
    runtime_invocation_id: safePattern(descriptors.runtime_invocation_id.value, RUNTIME_INVOCATION_ID_PATTERN),
    dispatch_admission_digest: safeDigest(descriptors.dispatch_admission_digest.value),
    adapter_selection_digest: safeDigest(descriptors.adapter_selection_digest.value),
    record_digest: safeDigest(descriptors.record_digest.value),
    policy_digest: safeDigest(descriptors.policy_digest.value),
    adapter_id: descriptors.adapter_id.value,
    runtime_id: descriptors.runtime_id.value,
    tool_name: descriptors.tool_name.value,
    action: descriptors.action.value,
    resource_kind: descriptors.resource_kind.value,
    adapter_selected_at_ms: safeTimestamp(descriptors.adapter_selected_at_ms.value),
    runtime_admitted_at_ms: safeTimestamp(descriptors.runtime_admitted_at_ms.value),
    max_raw_output_bytes: safeRawOutputBytes(descriptors.max_raw_output_bytes.value),
    max_chargeable_dispatches: descriptors.max_chargeable_dispatches.value,
    lifecycle: sanitizeRuntimeLifecycle(descriptors.lifecycle.value),
    authority: sanitizeRuntimeAuthority(descriptors.authority.value),
  });
  if (
    runtime.admission_version !== BUILDER_TOOL_RUNTIME_INVOCATION_ADMISSION_VERSION
    || runtime.admission_kind !== TOOL_RUNTIME_INVOCATION_ADMISSION_KIND
    || runtime.adapter_id !== FILESYSTEM_READ_TOOL_ADAPTER_ID
    || runtime.runtime_id !== FILESYSTEM_READ_TOOL_RUNTIME_ID
    || runtime.tool_name !== 'filesystem.read'
    || runtime.action !== 'filesystem.read'
    || runtime.resource_kind !== 'filesystem'
    || runtime.runtime_admitted_at_ms < runtime.adapter_selected_at_ms
    || runtime.max_chargeable_dispatches !== 0
  ) fail();
  const digest = safeDigest(descriptors.admission_digest.value);
  if (digest !== sha256Canonical(runtimeDigestBody(runtime))) fail();
  return freezeDeep({
    ...runtime,
    admission_digest: digest,
  });
}

function resultDigestBody(value) {
  return {
    action: value.action,
    adapter_id: value.adapter_id,
    adapter_selection_digest: value.adapter_selection_digest,
    adapter_selection_id: value.adapter_selection_id,
    authority: value.authority,
    conversation_id: value.conversation_id,
    dispatch_admission_digest: value.dispatch_admission_digest,
    dispatch_request_id: value.dispatch_request_id,
    lifecycle: value.lifecycle,
    observed_at_ms: value.observed_at_ms,
    policy_digest: value.policy_digest,
    project_id: value.project_id,
    record_kind: value.record_kind,
    record_version: value.record_version,
    resource_kind: value.resource_kind,
    result: value.result,
    run_id: value.run_id,
    runtime_id: value.runtime_id,
    runtime_invocation_admission: value.runtime_invocation_admission,
    runtime_invocation_digest: value.runtime_invocation_digest,
    runtime_invocation_id: value.runtime_invocation_id,
    step_id: value.step_id,
    task_id: value.task_id,
    tool_call_id: value.tool_call_id,
    tool_call_record: value.tool_call_record,
    turn_id: value.turn_id,
  };
}

function sameRunBinding(left, right) {
  return left.project_id === right.project_id
    && left.conversation_id === right.conversation_id
    && left.turn_id === right.turn_id
    && left.task_id === right.task_id
    && left.run_id === right.run_id
    && left.step_id === right.step_id
    && left.tool_call_id === right.tool_call_id;
}

function assertRuntimeReady(runtimeAdmission, toolCallRecord, observedAtMs) {
  if (
    runtimeAdmission.admission_version !== BUILDER_TOOL_RUNTIME_INVOCATION_ADMISSION_VERSION
    || runtimeAdmission.runtime_id !== FILESYSTEM_READ_TOOL_RUNTIME_ID
    || runtimeAdmission.lifecycle.runtime_admission !== 'bounded_envelope_admitted'
    || runtimeAdmission.lifecycle.runtime_invocation !== 'admitted_without_execution'
    || runtimeAdmission.lifecycle.filesystem_read !== 'not_performed'
    || runtimeAdmission.lifecycle.execution_admission !== 'not_started'
    || runtimeAdmission.lifecycle.result_admission !== 'not_recorded'
    || runtimeAdmission.lifecycle.raw_output_admission !== 'not_included'
    || runtimeAdmission.lifecycle.revision_admission !== 'not_created'
    || runtimeAdmission.authority.runtime_authority !== AUTHORITY.runtime_invocation_authority
    || runtimeAdmission.authority.renderer_authority !== 'not_present'
    || runtimeAdmission.authority.provider_dispatch !== false
    || runtimeAdmission.authority.credential_readback !== false
    || runtimeAdmission.authority.tool_dispatch !== 'not_performed'
    || runtimeAdmission.authority.runtime_execution !== 'not_started'
    || runtimeAdmission.authority.filesystem_read !== 'not_performed'
    || runtimeAdmission.authority.raw_output_storage !== 'not_present'
    || runtimeAdmission.authority.git_authority !== 'not_present'
    || runtimeAdmission.max_chargeable_dispatches !== 0
    || !sameRunBinding(runtimeAdmission, toolCallRecord)
    || runtimeAdmission.record_digest !== toolCallRecord.record_digest
    || runtimeAdmission.policy_digest !== toolCallRecord.session_policy.policy_digest
    || runtimeAdmission.max_raw_output_bytes !== toolCallRecord.session_policy.limits.max_raw_output_bytes
    || observedAtMs < runtimeAdmission.runtime_admitted_at_ms
  ) fail();
}

function unsignedRecord({
  runtimeAdmission,
  toolCallRecord,
  observedAtMs,
  result,
}) {
  assertRuntimeReady(runtimeAdmission, toolCallRecord, observedAtMs);
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
    dispatch_request_id: runtimeAdmission.dispatch_request_id,
    adapter_selection_id: runtimeAdmission.adapter_selection_id,
    runtime_invocation_id: runtimeAdmission.runtime_invocation_id,
    adapter_id: runtimeAdmission.adapter_id,
    runtime_id: runtimeAdmission.runtime_id,
    dispatch_admission_digest: runtimeAdmission.dispatch_admission_digest,
    adapter_selection_digest: runtimeAdmission.adapter_selection_digest,
    runtime_invocation_digest: runtimeAdmission.admission_digest,
    policy_digest: runtimeAdmission.policy_digest,
    tool_call_record: toolCallRecord,
    runtime_invocation_admission: runtimeAdmission,
    result,
    lifecycle: { ...LIFECYCLE },
    authority: { ...AUTHORITY },
  });
}

function createBuilderToolResultRecord(rawInput) {
  try {
    const descriptors = exactObject(rawInput, INPUT_KEYS);
    const runtimeAdmission = sanitizeRuntimeInvocationAdmission(
      descriptors.runtime_invocation_admission.value,
    );
    const toolCallRecord = sanitizeBuilderToolCallRecord(descriptors.tool_call_record.value);
    const record = unsignedRecord({
      runtimeAdmission,
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
    const runtimeAdmission = sanitizeRuntimeInvocationAdmission(
      descriptors.runtime_invocation_admission.value,
    );
    const toolCallRecord = sanitizeBuilderToolCallRecord(descriptors.tool_call_record.value);
    const observedAtMs = safeTimestamp(descriptors.observed_at_ms.value);
    const result = sanitizeResultRecord(
      descriptors.result.value,
      toolCallRecord.session_policy.limits.max_public_summary_bytes,
    );
    const record = unsignedRecord({
      runtimeAdmission,
      toolCallRecord,
      observedAtMs,
      result,
    });
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
      || descriptors.dispatch_request_id.value !== record.dispatch_request_id
      || descriptors.adapter_selection_id.value !== record.adapter_selection_id
      || descriptors.runtime_invocation_id.value !== record.runtime_invocation_id
      || descriptors.adapter_id.value !== record.adapter_id
      || descriptors.runtime_id.value !== record.runtime_id
      || safeDigest(descriptors.dispatch_admission_digest.value) !== record.dispatch_admission_digest
      || safeDigest(descriptors.adapter_selection_digest.value) !== record.adapter_selection_digest
      || safeDigest(descriptors.runtime_invocation_digest.value) !== record.runtime_invocation_digest
      || safeDigest(descriptors.policy_digest.value) !== record.policy_digest
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
