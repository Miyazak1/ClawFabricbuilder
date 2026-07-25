'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const {
  sanitizeBuilderToolCallRecord,
} = require('./builder-tool-call-records.cjs');
const {
  BUILDER_TOOL_DISPATCH_ADMISSION_VERSION,
  sanitizeBuilderToolDispatchAdmission,
} = require('./builder-tool-dispatch-admission.cjs');

const BUILDER_TOOL_ADAPTER_SELECTION_ADMISSION_VERSION = 'builder-tool-adapter-selection-admission.v1';
const TOOL_ADAPTER_SELECTION_ADMISSION_KIND = 'builder_tool_adapter_selection_admission';
const FILESYSTEM_READ_TOOL_ADAPTER_ID = 'builder-tool-adapter.filesystem-read.v1';
const INPUT_KEYS = Object.freeze([
  'dispatch_admission',
  'tool_call_record',
  'adapter_id',
  'adapter_selection_id',
  'selected_at_ms',
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
  'dispatch_admission_digest',
  'dispatch_admitted_at_ms',
  'record_digest',
  'policy_digest',
  'adapter_id',
  'tool_name',
  'action',
  'resource_kind',
  'selected_at_ms',
  'lifecycle',
  'authority',
  'admission_digest',
]);
const LIFECYCLE_KEYS = Object.freeze([
  'dispatch_admission',
  'adapter_selection',
  'runtime_admission',
  'execution_admission',
  'result_admission',
  'raw_output_admission',
  'revision_admission',
]);
const AUTHORITY_KEYS = Object.freeze([
  'selection_authority',
  'dispatch_authority',
  'adapter_registry_authority',
  'conversation_binding',
  'renderer_authority',
  'provider_dispatch',
  'credential_readback',
  'tool_dispatch',
  'runtime_execution',
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
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const LIFECYCLE = Object.freeze({
  dispatch_admission: 'verified_bounded_main_admission',
  adapter_selection: 'selected_without_execution',
  runtime_admission: 'not_started',
  execution_admission: 'not_started',
  result_admission: 'not_recorded',
  raw_output_admission: 'not_included',
  revision_admission: 'not_created',
});
const AUTHORITY = Object.freeze({
  selection_authority: 'main_tool_adapter_selection_contract_v1',
  dispatch_authority: 'main_tool_dispatch_admission_contract_v1',
  adapter_registry_authority: 'static_main_tool_adapter_registry_v1',
  conversation_binding: 'trusted_open_tool_call_required',
  renderer_authority: 'not_present',
  provider_dispatch: false,
  credential_readback: false,
  tool_dispatch: 'not_performed',
  runtime_execution: 'not_started',
  raw_output_storage: 'not_present',
  git_authority: 'not_present',
  cost_authority: 'no_chargeable_dispatch_without_runtime_meter_v1',
});

class BuilderToolAdapterSelectionAdmissionError extends Error {
  constructor() {
    super('The tool adapter selection could not be verified.');
    this.name = 'BuilderToolAdapterSelectionAdmissionError';
    this.code = 'builder_tool_adapter_selection_admission_invalid';
    this.retryable = false;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderToolAdapterSelectionAdmissionError();
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

function safeDigest(value) {
  return safePattern(value, DIGEST_PATTERN);
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail();
  return value;
}

function safeAdapterId(value) {
  if (value !== FILESYSTEM_READ_TOOL_ADAPTER_ID) fail();
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

function assertDispatchReady(dispatchAdmission) {
  if (
    dispatchAdmission.admission_version !== BUILDER_TOOL_DISPATCH_ADMISSION_VERSION
    || dispatchAdmission.lifecycle.dispatch_admission !== 'bounded_main_admission_only'
    || dispatchAdmission.lifecycle.execution_admission !== 'not_started'
    || dispatchAdmission.lifecycle.result_admission !== 'not_recorded'
    || dispatchAdmission.lifecycle.raw_output_admission !== 'not_included'
    || dispatchAdmission.lifecycle.revision_admission !== 'not_created'
    || dispatchAdmission.authority.dispatch_authority !== AUTHORITY.dispatch_authority
    || dispatchAdmission.authority.conversation_binding !== AUTHORITY.conversation_binding
    || dispatchAdmission.authority.renderer_authority !== 'not_present'
    || dispatchAdmission.authority.provider_dispatch !== false
    || dispatchAdmission.authority.credential_readback !== false
    || dispatchAdmission.authority.tool_dispatch !== 'not_performed'
    || dispatchAdmission.authority.adapter_selection !== 'not_selected'
    || dispatchAdmission.authority.raw_output_storage !== 'not_present'
    || dispatchAdmission.authority.git_authority !== 'not_present'
  ) fail();
}

function assertCallRecordReady(record, dispatchAdmission, selectedAtMs) {
  const policy = record.session_policy;
  if (
    !sameRunBinding(record, dispatchAdmission)
    || dispatchAdmission.record_digest !== record.record_digest
    || dispatchAdmission.policy_digest !== policy.policy_digest
    || record.lifecycle.dispatch_admission !== 'not_started'
    || record.lifecycle.execution_admission !== 'not_performed'
    || record.lifecycle.result_admission !== 'not_recorded'
    || record.authority.tool_dispatch !== 'not_performed'
    || policy.limits.max_chargeable_dispatches !== 0
    || selectedAtMs < dispatchAdmission.admitted_at_ms
    || selectedAtMs - record.requested_at_ms > policy.limits.max_step_timeout_ms
    || selectedAtMs - policy.issued_at_ms > policy.limits.max_total_timeout_ms
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
    adapter_selection_id: value.adapter_selection_id,
    admission_kind: value.admission_kind,
    admission_version: value.admission_version,
    authority: value.authority,
    conversation_id: value.conversation_id,
    dispatch_admission_digest: value.dispatch_admission_digest,
    dispatch_admitted_at_ms: value.dispatch_admitted_at_ms,
    dispatch_request_id: value.dispatch_request_id,
    lifecycle: value.lifecycle,
    policy_digest: value.policy_digest,
    project_id: value.project_id,
    record_digest: value.record_digest,
    resource_kind: value.resource_kind,
    run_id: value.run_id,
    selected_at_ms: value.selected_at_ms,
    step_id: value.step_id,
    task_id: value.task_id,
    tool_call_id: value.tool_call_id,
    tool_name: value.tool_name,
    turn_id: value.turn_id,
  };
}

function unsignedAdmission({
  dispatchAdmission,
  record,
  adapterId,
  adapterSelectionId,
  selectedAtMs,
}) {
  assertDispatchReady(dispatchAdmission);
  assertCallRecordReady(record, dispatchAdmission, selectedAtMs);
  return freezeDeep({
    admission_version: BUILDER_TOOL_ADAPTER_SELECTION_ADMISSION_VERSION,
    admission_kind: TOOL_ADAPTER_SELECTION_ADMISSION_KIND,
    project_id: dispatchAdmission.project_id,
    conversation_id: dispatchAdmission.conversation_id,
    turn_id: dispatchAdmission.turn_id,
    task_id: dispatchAdmission.task_id,
    run_id: dispatchAdmission.run_id,
    step_id: dispatchAdmission.step_id,
    tool_call_id: dispatchAdmission.tool_call_id,
    dispatch_request_id: dispatchAdmission.dispatch_request_id,
    adapter_selection_id: adapterSelectionId,
    dispatch_admission_digest: dispatchAdmission.admission_digest,
    dispatch_admitted_at_ms: dispatchAdmission.admitted_at_ms,
    record_digest: record.record_digest,
    policy_digest: record.session_policy.policy_digest,
    adapter_id: adapterId,
    tool_name: record.tool_name,
    action: record.action,
    resource_kind: record.resource.resource_kind,
    selected_at_ms: selectedAtMs,
    lifecycle: { ...LIFECYCLE },
    authority: { ...AUTHORITY },
  });
}

function createBuilderToolAdapterSelectionAdmission(rawInput) {
  try {
    const descriptors = exactObject(rawInput, INPUT_KEYS);
    const dispatchAdmission = sanitizeBuilderToolDispatchAdmission(descriptors.dispatch_admission.value);
    const record = sanitizeBuilderToolCallRecord(descriptors.tool_call_record.value);
    const admission = unsignedAdmission({
      dispatchAdmission,
      record,
      adapterId: safeAdapterId(descriptors.adapter_id.value),
      adapterSelectionId: safeAdapterSelectionId(descriptors.adapter_selection_id.value),
      selectedAtMs: safeTimestamp(descriptors.selected_at_ms.value),
    });
    return freezeDeep({
      ...admission,
      admission_digest: sha256Canonical(admissionDigestBody(admission)),
    });
  } catch (error) {
    if (error instanceof BuilderToolAdapterSelectionAdmissionError) throw error;
    fail();
  }
}

function sanitizeBuilderToolAdapterSelectionAdmission(rawAdmission) {
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
      dispatch_admission_digest: safeDigest(descriptors.dispatch_admission_digest.value),
      dispatch_admitted_at_ms: safeTimestamp(descriptors.dispatch_admitted_at_ms.value),
      record_digest: safeDigest(descriptors.record_digest.value),
      policy_digest: safeDigest(descriptors.policy_digest.value),
      adapter_id: safeAdapterId(descriptors.adapter_id.value),
      tool_name: safeToolName(descriptors.tool_name.value),
      action: safeAction(descriptors.action.value),
      resource_kind: safeResourceKind(descriptors.resource_kind.value),
      selected_at_ms: safeTimestamp(descriptors.selected_at_ms.value),
      lifecycle: sanitizeLifecycle(descriptors.lifecycle.value),
      authority: sanitizeAuthority(descriptors.authority.value),
    });
    if (
      admission.admission_version !== BUILDER_TOOL_ADAPTER_SELECTION_ADMISSION_VERSION
      || admission.admission_kind !== TOOL_ADAPTER_SELECTION_ADMISSION_KIND
      || admission.selected_at_ms < admission.dispatch_admitted_at_ms
    ) fail();
    const digest = safeDigest(descriptors.admission_digest.value);
    if (digest !== sha256Canonical(admissionDigestBody(admission))) fail();
    return freezeDeep({
      ...admission,
      admission_digest: digest,
    });
  } catch (error) {
    if (error instanceof BuilderToolAdapterSelectionAdmissionError) throw error;
    fail();
  }
}

module.exports = freezeDeep({
  BUILDER_TOOL_ADAPTER_SELECTION_ADMISSION_VERSION,
  TOOL_ADAPTER_SELECTION_ADMISSION_KIND,
  FILESYSTEM_READ_TOOL_ADAPTER_ID,
  BuilderToolAdapterSelectionAdmissionError,
  createBuilderToolAdapterSelectionAdmission,
  sanitizeBuilderToolAdapterSelectionAdmission,
});
