'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const {
  sanitizeBuilderToolCallRecord,
} = require('./builder-tool-call-records.cjs');
const {
  FILESYSTEM_READ_TOOL_ADAPTER_ID,
  BUILDER_TOOL_ADAPTER_SELECTION_ADMISSION_VERSION,
  sanitizeBuilderToolAdapterSelectionAdmission,
} = require('./builder-tool-adapter-selection-admission.cjs');

const BUILDER_TOOL_RUNTIME_INVOCATION_ADMISSION_VERSION = 'builder-tool-runtime-invocation-admission.v1';
const TOOL_RUNTIME_INVOCATION_ADMISSION_KIND = 'builder_tool_runtime_invocation_admission';
const FILESYSTEM_READ_TOOL_RUNTIME_ID = 'builder-tool-runtime.filesystem-read-envelope.v1';
const INPUT_KEYS = Object.freeze([
  'adapter_selection_admission',
  'tool_call_record',
  'runtime_id',
  'runtime_invocation_id',
  'runtime_admitted_at_ms',
]);
const ADMISSION_KEYS = Object.freeze([
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
const LIFECYCLE_KEYS = Object.freeze([
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
const AUTHORITY_KEYS = Object.freeze([
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
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const PROJECT_ID_PATTERN = new RegExp(`^builder-project:(${UUID_SOURCE})$`, 'u');
const CONVERSATION_ID_PATTERN = new RegExp(`^builder-conversation:(${UUID_SOURCE})$`, 'u');
const TURN_ID_PATTERN = new RegExp(`^builder-turn:${UUID_SOURCE}$`, 'u');
const TASK_ID_PATTERN = new RegExp(`^builder-task:${UUID_SOURCE}$`, 'u');
const RUN_ID_PATTERN = new RegExp(`^builder-run:${UUID_SOURCE}$`, 'u');
const STEP_ID_PATTERN = new RegExp(`^builder-run-step:${UUID_SOURCE}$`, 'u');
const TOOL_CALL_ID_PATTERN = new RegExp(`^builder-tool-call:${UUID_SOURCE}$`, 'u');
const DISPATCH_REQUEST_ID_PATTERN = new RegExp(`^builder-tool-dispatch-request:${UUID_SOURCE}$`, 'u');
const ADAPTER_SELECTION_ID_PATTERN = new RegExp(`^builder-tool-adapter-selection:${UUID_SOURCE}$`, 'u');
const RUNTIME_INVOCATION_ID_PATTERN = new RegExp(`^builder-tool-runtime-invocation:${UUID_SOURCE}$`, 'u');
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const LIFECYCLE = Object.freeze({
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
const MAX_TOOL_RAW_OUTPUT_BYTES = 64 * 1_024;
const AUTHORITY = Object.freeze({
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

class BuilderToolRuntimeInvocationAdmissionError extends Error {
  constructor() {
    super('The tool runtime invocation could not be verified.');
    this.name = 'BuilderToolRuntimeInvocationAdmissionError';
    this.code = 'builder_tool_runtime_invocation_admission_invalid';
    this.retryable = false;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderToolRuntimeInvocationAdmissionError();
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

function safePattern(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) fail();
  return value;
}

function safeProjectId(value) {
  return safePattern(value, PROJECT_ID_PATTERN);
}

function safeConversationId(value, projectId) {
  const conversationId = safePattern(value, CONVERSATION_ID_PATTERN);
  if (conversationId.slice('builder-conversation:'.length)
    !== projectId.slice('builder-project:'.length)) fail();
  return conversationId;
}

function safeTurnId(value) {
  return safePattern(value, TURN_ID_PATTERN);
}

function safeTaskId(value) {
  return safePattern(value, TASK_ID_PATTERN);
}

function safeRunId(value) {
  return safePattern(value, RUN_ID_PATTERN);
}

function safeStepId(value) {
  return safePattern(value, STEP_ID_PATTERN);
}

function safeToolCallId(value) {
  return safePattern(value, TOOL_CALL_ID_PATTERN);
}

function safeDispatchRequestId(value) {
  return safePattern(value, DISPATCH_REQUEST_ID_PATTERN);
}

function safeAdapterSelectionId(value) {
  return safePattern(value, ADAPTER_SELECTION_ID_PATTERN);
}

function safeRuntimeInvocationId(value) {
  return safePattern(value, RUNTIME_INVOCATION_ID_PATTERN);
}

function safeDigest(value) {
  return safePattern(value, DIGEST_PATTERN);
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail();
  return value;
}

function safeRawOutputBytes(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_TOOL_RAW_OUTPUT_BYTES) fail();
  return value;
}

function safeZero(value) {
  if (value !== 0) fail();
  return value;
}

function safeAdapterId(value) {
  if (value !== FILESYSTEM_READ_TOOL_ADAPTER_ID) fail();
  return value;
}

function safeRuntimeId(value) {
  if (value !== FILESYSTEM_READ_TOOL_RUNTIME_ID) fail();
  return value;
}

function safeToolName(value) {
  if (value !== 'filesystem.read') fail();
  return value;
}

function safeAction(value) {
  if (value !== 'filesystem.read') fail();
  return value;
}

function safeResourceKind(value) {
  if (value !== 'filesystem') fail();
  return value;
}

function assertSafeProjectResource(record) {
  const resourceId = record.resource.resource_id;
  const prefix = 'project:/';
  if (
    typeof resourceId !== 'string'
    || !resourceId.startsWith(prefix)
    || resourceId.length <= prefix.length
    || resourceId.includes('\\')
    || resourceId.includes('\0')
  ) fail();
  const suffix = resourceId.slice(prefix.length);
  if (
    suffix.startsWith('/')
    || suffix.endsWith('/')
    || suffix.includes(':')
    || suffix.split('/').some((segment) => segment === '.' || segment === '..' || segment.length === 0)
  ) fail();
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

function assertSelectionReady(selection) {
  if (
    selection.admission_version !== BUILDER_TOOL_ADAPTER_SELECTION_ADMISSION_VERSION
    || selection.lifecycle.dispatch_admission !== 'verified_bounded_main_admission'
    || selection.lifecycle.adapter_selection !== 'selected_without_execution'
    || selection.lifecycle.runtime_admission !== 'not_started'
    || selection.lifecycle.execution_admission !== 'not_started'
    || selection.lifecycle.result_admission !== 'not_recorded'
    || selection.lifecycle.raw_output_admission !== 'not_included'
    || selection.lifecycle.revision_admission !== 'not_created'
    || selection.authority.selection_authority !== AUTHORITY.selection_authority
    || selection.authority.adapter_registry_authority !== AUTHORITY.adapter_registry_authority
    || selection.authority.conversation_binding !== AUTHORITY.conversation_binding
    || selection.authority.renderer_authority !== 'not_present'
    || selection.authority.provider_dispatch !== false
    || selection.authority.credential_readback !== false
    || selection.authority.tool_dispatch !== 'not_performed'
    || selection.authority.runtime_execution !== 'not_started'
    || selection.authority.raw_output_storage !== 'not_present'
    || selection.authority.git_authority !== 'not_present'
  ) fail();
}

function assertCallRecordReady(record, selection, runtimeAdmittedAtMs) {
  const policy = record.session_policy;
  if (
    !sameRunBinding(record, selection)
    || selection.record_digest !== record.record_digest
    || selection.policy_digest !== policy.policy_digest
    || selection.adapter_id !== FILESYSTEM_READ_TOOL_ADAPTER_ID
    || record.lifecycle.dispatch_admission !== 'not_started'
    || record.lifecycle.execution_admission !== 'not_performed'
    || record.lifecycle.result_admission !== 'not_recorded'
    || record.authority.tool_dispatch !== 'not_performed'
    || policy.limits.max_chargeable_dispatches !== 0
    || runtimeAdmittedAtMs < selection.selected_at_ms
    || runtimeAdmittedAtMs < record.requested_at_ms
    || runtimeAdmittedAtMs - record.requested_at_ms > policy.limits.max_step_timeout_ms
    || runtimeAdmittedAtMs - policy.issued_at_ms > policy.limits.max_total_timeout_ms
  ) fail();
  safeToolName(record.tool_name);
  safeAction(record.action);
  safeResourceKind(record.resource.resource_kind);
  assertSafeProjectResource(record);
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

function admissionDigestBody(value) {
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

function unsignedAdmission({
  selection,
  record,
  runtimeId,
  runtimeInvocationId,
  runtimeAdmittedAtMs,
}) {
  assertSelectionReady(selection);
  assertCallRecordReady(record, selection, runtimeAdmittedAtMs);
  return freezeDeep({
    admission_version: BUILDER_TOOL_RUNTIME_INVOCATION_ADMISSION_VERSION,
    admission_kind: TOOL_RUNTIME_INVOCATION_ADMISSION_KIND,
    project_id: selection.project_id,
    conversation_id: selection.conversation_id,
    turn_id: selection.turn_id,
    task_id: selection.task_id,
    run_id: selection.run_id,
    step_id: selection.step_id,
    tool_call_id: selection.tool_call_id,
    dispatch_request_id: selection.dispatch_request_id,
    adapter_selection_id: selection.adapter_selection_id,
    runtime_invocation_id: runtimeInvocationId,
    dispatch_admission_digest: selection.dispatch_admission_digest,
    adapter_selection_digest: selection.admission_digest,
    record_digest: record.record_digest,
    policy_digest: record.session_policy.policy_digest,
    adapter_id: selection.adapter_id,
    runtime_id: runtimeId,
    tool_name: record.tool_name,
    action: record.action,
    resource_kind: record.resource.resource_kind,
    adapter_selected_at_ms: selection.selected_at_ms,
    runtime_admitted_at_ms: runtimeAdmittedAtMs,
    max_raw_output_bytes: record.session_policy.limits.max_raw_output_bytes,
    max_chargeable_dispatches: 0,
    lifecycle: { ...LIFECYCLE },
    authority: { ...AUTHORITY },
  });
}

function createBuilderToolRuntimeInvocationAdmission(rawInput) {
  try {
    const descriptors = exactObject(rawInput, INPUT_KEYS);
    const selection = sanitizeBuilderToolAdapterSelectionAdmission(descriptors.adapter_selection_admission.value);
    const record = sanitizeBuilderToolCallRecord(descriptors.tool_call_record.value);
    const admission = unsignedAdmission({
      selection,
      record,
      runtimeId: safeRuntimeId(descriptors.runtime_id.value),
      runtimeInvocationId: safeRuntimeInvocationId(descriptors.runtime_invocation_id.value),
      runtimeAdmittedAtMs: safeTimestamp(descriptors.runtime_admitted_at_ms.value),
    });
    return freezeDeep({
      ...admission,
      admission_digest: sha256Canonical(admissionDigestBody(admission)),
    });
  } catch (error) {
    if (error instanceof BuilderToolRuntimeInvocationAdmissionError) throw error;
    fail();
  }
}

function sanitizeBuilderToolRuntimeInvocationAdmission(rawAdmission) {
  try {
    const descriptors = exactObject(rawAdmission, ADMISSION_KEYS);
    const projectId = safeProjectId(descriptors.project_id.value);
    const admission = freezeDeep({
      admission_version: descriptors.admission_version.value,
      admission_kind: descriptors.admission_kind.value,
      project_id: projectId,
      conversation_id: safeConversationId(descriptors.conversation_id.value, projectId),
      turn_id: safeTurnId(descriptors.turn_id.value),
      task_id: safeTaskId(descriptors.task_id.value),
      run_id: safeRunId(descriptors.run_id.value),
      step_id: safeStepId(descriptors.step_id.value),
      tool_call_id: safeToolCallId(descriptors.tool_call_id.value),
      dispatch_request_id: safeDispatchRequestId(descriptors.dispatch_request_id.value),
      adapter_selection_id: safeAdapterSelectionId(descriptors.adapter_selection_id.value),
      runtime_invocation_id: safeRuntimeInvocationId(descriptors.runtime_invocation_id.value),
      dispatch_admission_digest: safeDigest(descriptors.dispatch_admission_digest.value),
      adapter_selection_digest: safeDigest(descriptors.adapter_selection_digest.value),
      record_digest: safeDigest(descriptors.record_digest.value),
      policy_digest: safeDigest(descriptors.policy_digest.value),
      adapter_id: safeAdapterId(descriptors.adapter_id.value),
      runtime_id: safeRuntimeId(descriptors.runtime_id.value),
      tool_name: safeToolName(descriptors.tool_name.value),
      action: safeAction(descriptors.action.value),
      resource_kind: safeResourceKind(descriptors.resource_kind.value),
      adapter_selected_at_ms: safeTimestamp(descriptors.adapter_selected_at_ms.value),
      runtime_admitted_at_ms: safeTimestamp(descriptors.runtime_admitted_at_ms.value),
      max_raw_output_bytes: safeRawOutputBytes(descriptors.max_raw_output_bytes.value),
      max_chargeable_dispatches: safeZero(descriptors.max_chargeable_dispatches.value),
      lifecycle: sanitizeLifecycle(descriptors.lifecycle.value),
      authority: sanitizeAuthority(descriptors.authority.value),
    });
    if (
      admission.admission_version !== BUILDER_TOOL_RUNTIME_INVOCATION_ADMISSION_VERSION
      || admission.admission_kind !== TOOL_RUNTIME_INVOCATION_ADMISSION_KIND
      || admission.runtime_admitted_at_ms < admission.adapter_selected_at_ms
    ) fail();
    const digest = safeDigest(descriptors.admission_digest.value);
    if (digest !== sha256Canonical(admissionDigestBody(admission))) fail();
    return freezeDeep({
      ...admission,
      admission_digest: digest,
    });
  } catch (error) {
    if (error instanceof BuilderToolRuntimeInvocationAdmissionError) throw error;
    fail();
  }
}

module.exports = freezeDeep({
  BUILDER_TOOL_RUNTIME_INVOCATION_ADMISSION_VERSION,
  TOOL_RUNTIME_INVOCATION_ADMISSION_KIND,
  FILESYSTEM_READ_TOOL_RUNTIME_ID,
  BuilderToolRuntimeInvocationAdmissionError,
  createBuilderToolRuntimeInvocationAdmission,
  sanitizeBuilderToolRuntimeInvocationAdmission,
});
