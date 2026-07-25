'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const {
  createBuilderProjectSourceTree,
} = require('./builder-project-source-tree.cjs');
const {
  sanitizeBuilderToolCallRecord,
} = require('./builder-tool-call-records.cjs');
const {
  FILESYSTEM_READ_TOOL_RUNTIME_ID,
  sanitizeBuilderToolRuntimeInvocationAdmission,
} = require('./builder-tool-runtime-invocation-admission.cjs');

const BUILDER_TOOL_FILESYSTEM_READ_OUTPUT_RECORD_VERSION =
  'builder-tool-filesystem-read-output-record.v1';
const TOOL_FILESYSTEM_READ_OUTPUT_RECORD_KIND = 'builder_tool_filesystem_read_output_record';
const FILESYSTEM_READ_TOOL_ADAPTER_ID = 'builder-tool-adapter.filesystem-read.v1';
const INPUT_KEYS = Object.freeze([
  'runtime_invocation_admission',
  'tool_call_record',
  'observed_at_ms',
  'content',
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
  'resource_id',
  'observed_at_ms',
  'runtime_invocation_id',
  'runtime_invocation_digest',
  'adapter_id',
  'runtime_id',
  'policy_digest',
  'max_raw_output_bytes',
  'tool_call_record',
  'runtime_invocation_admission',
  'file',
  'lifecycle',
  'authority',
  'record_digest',
]);
const FILE_KEYS = Object.freeze(['path', 'entry_kind', 'content', 'content_digest', 'content_bytes']);
const LIFECYCLE_KEYS = Object.freeze([
  'permission_admission',
  'tool_call_admission',
  'runtime_admission',
  'filesystem_read',
  'raw_output_admission',
  'provider_admission',
  'revision_admission',
]);
const AUTHORITY_KEYS = Object.freeze([
  'record_authority',
  'tool_call_authority',
  'runtime_invocation_authority',
  'content_authority',
  'conversation_binding',
  'renderer_authority',
  'provider_dispatch',
  'credential_readback',
  'filesystem_read',
  'raw_output_storage',
  'conversation_event',
  'git_authority',
]);
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const PROJECT_RESOURCE_PREFIX = 'project:/';
const LIFECYCLE = Object.freeze({
  permission_admission: 'verified_allowed',
  tool_call_admission: 'verified_pre_dispatch_record',
  runtime_admission: 'verified_runtime_invocation',
  filesystem_read: 'bounded_private_file_content_recorded',
  raw_output_admission: 'private_bounded_not_projected',
  provider_admission: 'not_dispatched',
  revision_admission: 'not_created',
});
const AUTHORITY = Object.freeze({
  record_authority: 'main_tool_filesystem_read_output_record_contract_v1',
  tool_call_authority: 'main_tool_call_record_contract_v1',
  runtime_invocation_authority: 'main_tool_runtime_invocation_contract_v1',
  content_authority: 'caller_supplied_adapter_output_sanitized',
  conversation_binding: 'verified_tool_call_record_and_runtime_invocation',
  renderer_authority: 'not_present',
  provider_dispatch: false,
  credential_readback: false,
  filesystem_read: 'bounded_project_resource_output_only',
  raw_output_storage: 'not_durable_by_record_contract',
  conversation_event: 'not_admitted',
  git_authority: 'not_present',
});
const MAX_TOOL_RAW_OUTPUT_BYTES = 64 * 1_024;

class BuilderToolFilesystemReadOutputRecordError extends Error {
  constructor() {
    super('The filesystem read output could not be verified.');
    this.name = 'BuilderToolFilesystemReadOutputRecordError';
    this.code = 'builder_tool_filesystem_read_output_record_invalid';
    this.retryable = false;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderToolFilesystemReadOutputRecordError();
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

function safeRawOutputBytes(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_TOOL_RAW_OUTPUT_BYTES) fail();
  return value;
}

function relativeResourcePath(resourceId) {
  if (
    typeof resourceId !== 'string'
    || !resourceId.startsWith(PROJECT_RESOURCE_PREFIX)
    || resourceId.length <= PROJECT_RESOURCE_PREFIX.length
  ) fail();
  return resourceId.slice(PROJECT_RESOURCE_PREFIX.length);
}

function fileRecord({ resourceId, content, maxRawOutputBytes }) {
  const path = relativeResourcePath(resourceId);
  if (
    typeof content !== 'string'
    || Buffer.byteLength(content, 'utf8') > maxRawOutputBytes
  ) fail();
  let tree;
  try {
    tree = createBuilderProjectSourceTree({
      files: [{ path, content }],
    });
  } catch {
    fail();
  }
  const [entry] = tree.files;
  return freezeDeep({
    ...entry,
    content_bytes: Buffer.byteLength(entry.content, 'utf8'),
  });
}

function sanitizeFileRecord(value, resourceId, maxRawOutputBytes) {
  const descriptors = exactObject(value, FILE_KEYS);
  const expected = fileRecord({
    resourceId,
    content: descriptors.content.value,
    maxRawOutputBytes,
  });
  if (
    descriptors.path.value !== expected.path
    || descriptors.entry_kind.value !== expected.entry_kind
    || descriptors.content.value !== expected.content
    || safeDigest(descriptors.content_digest.value) !== expected.content_digest
    || descriptors.content_bytes.value !== expected.content_bytes
  ) fail();
  return expected;
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

function sameRunBinding(left, right) {
  return left.project_id === right.project_id
    && left.conversation_id === right.conversation_id
    && left.turn_id === right.turn_id
    && left.task_id === right.task_id
    && left.run_id === right.run_id
    && left.step_id === right.step_id
    && left.tool_call_id === right.tool_call_id;
}

function assertReady({ runtimeAdmission, toolCallRecord, observedAtMs }) {
  const maxRawOutputBytes = safeRawOutputBytes(runtimeAdmission.max_raw_output_bytes);
  if (
    runtimeAdmission.runtime_id !== FILESYSTEM_READ_TOOL_RUNTIME_ID
    || runtimeAdmission.adapter_id !== FILESYSTEM_READ_TOOL_ADAPTER_ID
    || runtimeAdmission.action !== 'filesystem.read'
    || runtimeAdmission.resource_kind !== 'filesystem'
    || runtimeAdmission.lifecycle.runtime_admission !== 'bounded_envelope_admitted'
    || runtimeAdmission.lifecycle.runtime_invocation !== 'admitted_without_execution'
    || runtimeAdmission.lifecycle.execution_admission !== 'not_started'
    || runtimeAdmission.lifecycle.result_admission !== 'not_recorded'
    || runtimeAdmission.lifecycle.revision_admission !== 'not_created'
    || runtimeAdmission.authority.renderer_authority !== 'not_present'
    || runtimeAdmission.authority.provider_dispatch !== false
    || runtimeAdmission.authority.credential_readback !== false
    || runtimeAdmission.authority.network_access !== 'denied'
    || runtimeAdmission.authority.process_access !== 'denied'
    || runtimeAdmission.authority.secret_access !== 'denied'
    || runtimeAdmission.max_chargeable_dispatches !== 0
    || !sameRunBinding(runtimeAdmission, toolCallRecord)
    || runtimeAdmission.record_digest !== toolCallRecord.record_digest
    || runtimeAdmission.policy_digest !== toolCallRecord.session_policy.policy_digest
    || maxRawOutputBytes !== toolCallRecord.session_policy.limits.max_raw_output_bytes
    || toolCallRecord.action !== 'filesystem.read'
    || toolCallRecord.resource.resource_kind !== 'filesystem'
    || toolCallRecord.lifecycle.execution_admission !== 'not_performed'
    || observedAtMs < runtimeAdmission.runtime_admitted_at_ms
    || observedAtMs - toolCallRecord.requested_at_ms
      > toolCallRecord.session_policy.limits.max_step_timeout_ms
    || observedAtMs - toolCallRecord.session_policy.issued_at_ms
      > toolCallRecord.session_policy.limits.max_total_timeout_ms
  ) fail();
  return maxRawOutputBytes;
}

function outputDigestBody(value) {
  return {
    action: value.action,
    authority: value.authority,
    conversation_id: value.conversation_id,
    file: value.file,
    lifecycle: value.lifecycle,
    max_raw_output_bytes: value.max_raw_output_bytes,
    observed_at_ms: value.observed_at_ms,
    policy_digest: value.policy_digest,
    project_id: value.project_id,
    record_kind: value.record_kind,
    record_version: value.record_version,
    resource_id: value.resource_id,
    resource_kind: value.resource_kind,
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

function unsignedRecord({
  runtimeAdmission,
  toolCallRecord,
  observedAtMs,
  file,
}) {
  const maxRawOutputBytes = assertReady({
    runtimeAdmission,
    toolCallRecord,
    observedAtMs,
  });
  return freezeDeep({
    record_version: BUILDER_TOOL_FILESYSTEM_READ_OUTPUT_RECORD_VERSION,
    record_kind: TOOL_FILESYSTEM_READ_OUTPUT_RECORD_KIND,
    project_id: toolCallRecord.project_id,
    conversation_id: toolCallRecord.conversation_id,
    turn_id: toolCallRecord.turn_id,
    task_id: toolCallRecord.task_id,
    run_id: toolCallRecord.run_id,
    step_id: toolCallRecord.step_id,
    tool_call_id: toolCallRecord.tool_call_id,
    action: 'filesystem.read',
    resource_kind: 'filesystem',
    resource_id: toolCallRecord.resource.resource_id,
    observed_at_ms: observedAtMs,
    runtime_invocation_id: runtimeAdmission.runtime_invocation_id,
    runtime_invocation_digest: runtimeAdmission.admission_digest,
    adapter_id: runtimeAdmission.adapter_id,
    runtime_id: runtimeAdmission.runtime_id,
    policy_digest: runtimeAdmission.policy_digest,
    max_raw_output_bytes: maxRawOutputBytes,
    tool_call_record: toolCallRecord,
    runtime_invocation_admission: runtimeAdmission,
    file,
    lifecycle: { ...LIFECYCLE },
    authority: { ...AUTHORITY },
  });
}

function createBuilderToolFilesystemReadOutputRecord(rawInput) {
  try {
    const descriptors = exactObject(rawInput, INPUT_KEYS);
    const runtimeAdmission = sanitizeBuilderToolRuntimeInvocationAdmission(
      descriptors.runtime_invocation_admission.value,
    );
    const toolCallRecord = sanitizeBuilderToolCallRecord(descriptors.tool_call_record.value);
    const observedAtMs = safeTimestamp(descriptors.observed_at_ms.value);
    const maxRawOutputBytes = assertReady({
      runtimeAdmission,
      toolCallRecord,
      observedAtMs,
    });
    const record = unsignedRecord({
      runtimeAdmission,
      toolCallRecord,
      observedAtMs,
      file: fileRecord({
        resourceId: toolCallRecord.resource.resource_id,
        content: descriptors.content.value,
        maxRawOutputBytes,
      }),
    });
    return freezeDeep({
      ...record,
      record_digest: sha256Canonical(outputDigestBody(record)),
    });
  } catch (error) {
    if (error instanceof BuilderToolFilesystemReadOutputRecordError) throw error;
    fail();
  }
}

function sanitizeBuilderToolFilesystemReadOutputRecord(rawRecord) {
  try {
    const descriptors = exactObject(rawRecord, RECORD_KEYS);
    const runtimeAdmission = sanitizeBuilderToolRuntimeInvocationAdmission(
      descriptors.runtime_invocation_admission.value,
    );
    const toolCallRecord = sanitizeBuilderToolCallRecord(descriptors.tool_call_record.value);
    const observedAtMs = safeTimestamp(descriptors.observed_at_ms.value);
    const maxRawOutputBytes = assertReady({
      runtimeAdmission,
      toolCallRecord,
      observedAtMs,
    });
    const record = unsignedRecord({
      runtimeAdmission,
      toolCallRecord,
      observedAtMs,
      file: sanitizeFileRecord(
        descriptors.file.value,
        toolCallRecord.resource.resource_id,
        maxRawOutputBytes,
      ),
    });
    if (
      descriptors.record_version.value !== BUILDER_TOOL_FILESYSTEM_READ_OUTPUT_RECORD_VERSION
      || descriptors.record_kind.value !== TOOL_FILESYSTEM_READ_OUTPUT_RECORD_KIND
      || descriptors.project_id.value !== record.project_id
      || descriptors.conversation_id.value !== record.conversation_id
      || descriptors.turn_id.value !== record.turn_id
      || descriptors.task_id.value !== record.task_id
      || descriptors.run_id.value !== record.run_id
      || descriptors.step_id.value !== record.step_id
      || descriptors.tool_call_id.value !== record.tool_call_id
      || descriptors.action.value !== record.action
      || descriptors.resource_kind.value !== record.resource_kind
      || descriptors.resource_id.value !== record.resource_id
      || descriptors.runtime_invocation_id.value !== record.runtime_invocation_id
      || safeDigest(descriptors.runtime_invocation_digest.value) !== record.runtime_invocation_digest
      || descriptors.adapter_id.value !== record.adapter_id
      || descriptors.runtime_id.value !== record.runtime_id
      || safeDigest(descriptors.policy_digest.value) !== record.policy_digest
      || descriptors.max_raw_output_bytes.value !== record.max_raw_output_bytes
      || JSON.stringify(sanitizeLifecycle(descriptors.lifecycle.value)) !== JSON.stringify(record.lifecycle)
      || JSON.stringify(sanitizeAuthority(descriptors.authority.value)) !== JSON.stringify(record.authority)
    ) fail();
    const digest = safeDigest(descriptors.record_digest.value);
    if (digest !== sha256Canonical(outputDigestBody(record))) fail();
    return freezeDeep({
      ...record,
      record_digest: digest,
    });
  } catch (error) {
    if (error instanceof BuilderToolFilesystemReadOutputRecordError) throw error;
    fail();
  }
}

module.exports = freezeDeep({
  BUILDER_TOOL_FILESYSTEM_READ_OUTPUT_RECORD_VERSION,
  TOOL_FILESYSTEM_READ_OUTPUT_RECORD_KIND,
  BuilderToolFilesystemReadOutputRecordError,
  createBuilderToolFilesystemReadOutputRecord,
  sanitizeBuilderToolFilesystemReadOutputRecord,
});
