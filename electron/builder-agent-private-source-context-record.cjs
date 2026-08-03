'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const {
  BuilderAgentSupervisedActionAdmissionError,
  sanitizeBuilderAgentSupervisedActionAdmission,
} = require('./builder-agent-supervised-action-admission.cjs');
const {
  createBuilderProjectSourceTree,
} = require('./builder-project-source-tree.cjs');

const BUILDER_AGENT_PRIVATE_SOURCE_CONTEXT_RECORD_VERSION =
  'builder-agent-private-source-context-record.v1';
const BUILDER_AGENT_PRIVATE_SOURCE_CONTEXT_RECORD_KIND =
  'builder_agent_private_source_context_record';
const SOURCE_CONTEXT_RESULT_VERSION = 'builder-tool-source-context-result.v1';
const PRIVATE_SOURCE_CONTEXT_VERSION = 'builder-private-source-context.v1';
const MAX_CONTEXT_FILES = 8;
const MAX_CONTEXT_FILE_BYTES = 16 * 1024;
const MAX_CONTEXT_TOTAL_BYTES = MAX_CONTEXT_FILES * MAX_CONTEXT_FILE_BYTES;
const MAX_EVENT_SEQUENCE = 4_096;
const MAX_CONTEXT_EVENTS = 64;
const INPUT_KEYS = Object.freeze([
  'supervised_action_admission',
  'source_context_result',
]);
const RECORD_KEYS = Object.freeze([
  'record_version',
  'record_kind',
  'owner_id',
  'agent_id',
  'project_id',
  'conversation_id',
  'turn_id',
  'task_id',
  'run_id',
  'supervised_action_admission_id',
  'source_context_status',
  'context_binding',
  'resource_count',
  'file_count',
  'total_content_bytes',
  'read_summaries',
  'file_summaries',
  'lifecycle',
  'authority',
  'record_digest',
]);
const CONTEXT_BINDING_KEYS = Object.freeze([
  'source_context_result_version',
  'source_context_operation',
  'collector_authority',
  'context_digest',
  'head_sequence',
  'head_digest',
  'attempt_number',
  'request_digest',
]);
const READ_SUMMARY_KEYS = Object.freeze([
  'resource_id_digest',
  'status',
  'tool_call_id',
]);
const FILE_SUMMARY_KEYS = Object.freeze([
  'resource_id_digest',
  'entry_kind',
  'content_digest',
  'content_bytes',
]);
const RESULT_KEYS = Object.freeze([
  'result_version',
  'operation',
  'status',
  'context',
  'private_source_context',
  'reads',
  'authority',
]);
const PRIVATE_CONTEXT_KEYS = Object.freeze(['context_version', 'files']);
const PRIVATE_FILE_KEYS = Object.freeze(['path', 'entry_kind', 'content', 'content_digest', 'content_bytes']);
const READ_KEYS = Object.freeze(['resource_id', 'status', 'tool_call_id']);
const CONTEXT_KEYS = Object.freeze([
  'context_version',
  'mode',
  'project',
  'conversation',
  'request_digest',
  'start_head',
  'attempt_number',
  'events',
  'run_terminal_failure_code',
  'ids',
  'cancel_requested',
]);
const PROJECT_KEYS = Object.freeze(['project_id', 'created_at_ms']);
const CONVERSATION_KEYS = Object.freeze(['project_id', 'conversation_id', 'created_at_ms']);
const HEAD_KEYS = Object.freeze(['sequence', 'event_id', 'event_digest']);
const IDS_KEYS = Object.freeze([
  'turn_command_id',
  'run_command_id',
  'terminal_command_id',
  'turn_terminal_command_id',
  'cancel_command_id',
  'cancel_request_id',
  'interrupt_command_id',
  'interrupt_request_id',
  'message_id',
  'assistant_message_id',
  'turn_id',
  'task_id',
  'run_id',
]);
const SOURCE_CONTEXT_AUTHORITY_KEYS = Object.freeze([
  'collector_authority',
  'permission_authority',
  'policy_authority',
  'conversation_authority',
  'execution_authority',
  'renderer_authority',
  'provider_dispatch',
  'credential_readback',
  'raw_output_storage',
  'conversation_event',
  'git_authority',
  'revision_admission',
]);
const LIFECYCLE_KEYS = Object.freeze([
  'supervised_action_admission',
  'source_context_collection',
  'raw_source_storage',
  'provider_dispatch',
  'tool_dispatch',
  'source_mutation',
  'result_for_review_admission',
  'revision_admission',
]);
const AUTHORITY_KEYS = Object.freeze([
  'record_authority',
  'supervised_action_admission_authority',
  'source_context_authority',
  'conversation_binding',
  'renderer_authority',
  'ipc_authority',
  'provider_dispatch',
  'model_dispatch',
  'tool_dispatch',
  'execution_authority',
  'permission_grant_authority',
  'credential_storage',
  'source_access',
  'source_read',
  'source_write',
  'raw_source_storage',
  'process_run',
  'network_access',
  'revision_authority',
  'review_authority',
  'artifact_authority',
]);
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const PROJECT_ID_PATTERN = new RegExp(`^builder-project:${UUID_SOURCE}$`, 'u');
const CONVERSATION_ID_PATTERN = new RegExp(`^builder-conversation:${UUID_SOURCE}$`, 'u');
const TURN_ID_PATTERN = new RegExp(`^builder-turn:${UUID_SOURCE}$`, 'u');
const TASK_ID_PATTERN = new RegExp(`^builder-task:${UUID_SOURCE}$`, 'u');
const RUN_ID_PATTERN = new RegExp(`^builder-run:${UUID_SOURCE}$`, 'u');
const COMMAND_ID_PATTERN = new RegExp(`^builder-command:${UUID_SOURCE}$`, 'u');
const MESSAGE_ID_PATTERN = new RegExp(`^builder-message:${UUID_SOURCE}$`, 'u');
const INTERRUPT_REQUEST_ID_PATTERN = new RegExp(`^builder-interrupt-request:${UUID_SOURCE}$`, 'u');
const CANCEL_REQUEST_ID_PATTERN = new RegExp(`^builder-cancel-request:${UUID_SOURCE}$`, 'u');
const TOOL_CALL_ID_PATTERN = new RegExp(`^builder-tool-call:${UUID_SOURCE}$`, 'u');
const EVENT_ID_PATTERN = /^builder-conversation-event:[0-9a-f]{64}$/u;
const ADMISSION_ID_PATTERN = /^builder-agent-supervised-action-admission:[0-9a-f]{64}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const RESOURCE_ID_PATTERN = /^project:\/[a-z0-9._/@-]{1,120}$/u;
const STATUSES = Object.freeze(['succeeded', 'partial', 'failed']);
const READ_STATUSES = Object.freeze(['succeeded', 'failed']);
const SOURCE_CONTEXT_AUTHORITY = Object.freeze({
  collector_authority: 'main_tool_source_context_collector_v1',
  permission_authority: 'main_permission_decision_before_tool_dispatch_v1',
  policy_authority: 'main_tool_session_policy_contract_v1',
  conversation_authority: 'trusted_conversation_main_service_methods',
  execution_authority: 'main_tool_filesystem_read_execution_service_v1',
  renderer_authority: 'not_present',
  provider_dispatch: false,
  credential_readback: false,
  raw_output_storage: 'not_durable',
  conversation_event: 'tool_request_and_fixed_result_only',
  git_authority: 'not_present',
  revision_admission: 'not_created',
});
const LIFECYCLE = Object.freeze({
  supervised_action_admission: 'verified_read_private_source_admission',
  source_context_collection: 'collector_result_summarized',
  raw_source_storage: 'not_persisted',
  provider_dispatch: 'not_started',
  tool_dispatch: 'collector_internal_request_result_facts_only',
  source_mutation: 'not_performed',
  result_for_review_admission: 'not_created',
  revision_admission: 'not_created',
});
const AUTHORITY = Object.freeze({
  record_authority: 'main_agent_private_source_context_record_contract_v1',
  supervised_action_admission_authority: 'main_agent_supervised_action_admission_contract_v1',
  source_context_authority: 'main_tool_source_context_collector_v1',
  conversation_binding: 'ids_only_host_replay_required',
  renderer_authority: 'not_present',
  ipc_authority: 'not_present',
  provider_dispatch: false,
  model_dispatch: false,
  tool_dispatch: 'collector_internal_request_result_facts_only',
  execution_authority: 'collector_internal_filesystem_read_only',
  permission_grant_authority: false,
  credential_storage: 'not_present',
  source_access: 'digest_only_private_source_context_receipt',
  source_read: 'bounded_project_files_already_collected',
  source_write: 'not_present',
  raw_source_storage: 'not_present',
  process_run: false,
  network_access: false,
  revision_authority: false,
  review_authority: false,
  artifact_authority: false,
});

class BuilderAgentPrivateSourceContextRecordError extends Error {
  constructor() {
    super('Builder agent private source context record could not be verified.');
    this.name = 'BuilderAgentPrivateSourceContextRecordError';
    this.code = 'builder_agent_private_source_context_record_invalid';
    this.retryable = false;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderAgentPrivateSourceContextRecordError();
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
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      fail();
    }
  }
  return descriptors;
}

function exactArray(value, minimum, maximum) {
  if (
    !Array.isArray(value)
    || utilTypes.isProxy(value)
    || value.length < minimum
    || value.length > maximum
  ) fail();
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key === 'symbol') || keys.length !== value.length + 1) fail();
  const result = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      fail();
    }
    result.push(descriptor.value);
  }
  return result;
}

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
    fail();
  }
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

function safeSequence(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_EVENT_SEQUENCE) fail();
  return value;
}

function safeAttemptNumber(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 16) fail();
  return value;
}

function safeByteCount(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_CONTEXT_TOTAL_BYTES) fail();
  return value;
}

function safeCount(value, maximum) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) fail();
  return value;
}

function safeStatus(value) {
  if (typeof value !== 'string' || !STATUSES.includes(value)) fail();
  return value;
}

function expectedConversationId(projectId) {
  return `builder-conversation:${projectId.slice('builder-project:'.length)}`;
}

function sanitizeAuthority(value, keys, expected) {
  const descriptors = exactObject(value, keys);
  for (const key of keys) {
    if (descriptors[key].value !== expected[key]) fail();
  }
  return freezeDeep({ ...expected });
}

function sanitizeHead(value) {
  const descriptors = exactObject(value, HEAD_KEYS);
  return freezeDeep({
    sequence: safeSequence(descriptors.sequence.value),
    event_id: safePattern(descriptors.event_id.value, EVENT_ID_PATTERN),
    event_digest: safeDigest(descriptors.event_digest.value),
  });
}

function sanitizeContext(value) {
  const descriptors = exactObject(value, CONTEXT_KEYS);
  const project = exactObject(descriptors.project.value, PROJECT_KEYS);
  const conversation = exactObject(descriptors.conversation.value, CONVERSATION_KEYS);
  const ids = exactObject(descriptors.ids.value, IDS_KEYS);
  const projectId = safePattern(project.project_id.value, PROJECT_ID_PATTERN);
  const conversationId = safePattern(conversation.conversation_id.value, CONVERSATION_ID_PATTERN);
  const requestDigest = safeDigest(descriptors.request_digest.value);
  safePattern(ids.turn_command_id.value, COMMAND_ID_PATTERN);
  safePattern(ids.run_command_id.value, COMMAND_ID_PATTERN);
  safePattern(ids.terminal_command_id.value, COMMAND_ID_PATTERN);
  safePattern(ids.turn_terminal_command_id.value, COMMAND_ID_PATTERN);
  safePattern(ids.cancel_command_id.value, COMMAND_ID_PATTERN);
  safePattern(ids.cancel_request_id.value, CANCEL_REQUEST_ID_PATTERN);
  safePattern(ids.interrupt_command_id.value, COMMAND_ID_PATTERN);
  safePattern(ids.interrupt_request_id.value, INTERRUPT_REQUEST_ID_PATTERN);
  safePattern(ids.message_id.value, MESSAGE_ID_PATTERN);
  safePattern(ids.assistant_message_id.value, MESSAGE_ID_PATTERN);
  if (
    descriptors.context_version.value !== 'builder-conversation-run-context.v1'
    || descriptors.mode.value !== 'work'
    || safeTimestamp(project.created_at_ms.value) < 0
    || conversation.project_id.value !== projectId
    || safeTimestamp(conversation.created_at_ms.value) < 0
    || conversationId !== expectedConversationId(projectId)
    || descriptors.run_terminal_failure_code.value !== null
    || descriptors.cancel_requested.value !== false
    || !Array.isArray(descriptors.events.value)
    || descriptors.events.value.length > MAX_CONTEXT_EVENTS
    || utilTypes.isProxy(descriptors.events.value)
  ) fail();
  const eventKeys = Reflect.ownKeys(descriptors.events.value);
  if (eventKeys.some((key) => typeof key === 'symbol') || eventKeys.length !== descriptors.events.value.length + 1) {
    fail();
  }
  const head = sanitizeHead(descriptors.start_head.value);
  return freezeDeep({
    project_id: projectId,
    conversation_id: conversationId,
    turn_id: safePattern(ids.turn_id.value, TURN_ID_PATTERN),
    task_id: safePattern(ids.task_id.value, TASK_ID_PATTERN),
    run_id: safePattern(ids.run_id.value, RUN_ID_PATTERN),
    attempt_number: safeAttemptNumber(descriptors.attempt_number.value),
    request_digest: requestDigest,
    head_sequence: head.sequence,
    head_event_id: head.event_id,
    head_event_digest: head.event_digest,
  });
}

function safeResourceId(value) {
  const resourceId = safePattern(value, RESOURCE_ID_PATTERN);
  const segments = resourceId.slice('project:/'.length).split('/');
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    fail();
  }
  return resourceId;
}

function resourceDigest(resourceId) {
  return sha256Canonical({ resource_id: resourceId });
}

function sanitizeReads(value) {
  const rawReads = exactArray(value, 1, MAX_CONTEXT_FILES);
  const seenResources = new Set();
  const seenToolCalls = new Set();
  return freezeDeep(rawReads.map((rawRead) => {
    const descriptors = exactObject(rawRead, READ_KEYS);
    const resourceId = safeResourceId(descriptors.resource_id.value);
    const toolCallId = safePattern(descriptors.tool_call_id.value, TOOL_CALL_ID_PATTERN);
    const status = descriptors.status.value;
    if (
      !READ_STATUSES.includes(status)
      || seenResources.has(resourceId)
      || seenToolCalls.has(toolCallId)
    ) fail();
    seenResources.add(resourceId);
    seenToolCalls.add(toolCallId);
    return {
      resource_id: resourceId,
      resource_id_digest: resourceDigest(resourceId),
      status,
      tool_call_id: toolCallId,
    };
  }));
}

function sanitizePrivateSourceContext(value, reads) {
  const descriptors = exactObject(value, PRIVATE_CONTEXT_KEYS);
  if (descriptors.context_version.value !== PRIVATE_SOURCE_CONTEXT_VERSION) fail();
  const rawFiles = exactArray(descriptors.files.value, 0, MAX_CONTEXT_FILES);
  const readByResource = new Map(reads.map((read) => [read.resource_id, read]));
  const files = rawFiles.map((rawFile) => {
    const file = exactObject(rawFile, PRIVATE_FILE_KEYS);
    const path = file.path.value;
    const content = file.content.value;
    const contentBytes = safeByteCount(file.content_bytes.value);
    if (
      file.entry_kind.value !== 'text_file'
      || typeof path !== 'string'
      || typeof content !== 'string'
      || Buffer.byteLength(content, 'utf8') !== contentBytes
      || contentBytes > MAX_CONTEXT_FILE_BYTES
    ) fail();
    const resourceId = safeResourceId(`project:/${path}`);
    const read = readByResource.get(resourceId);
    if (!read || read.status !== 'succeeded') fail();
    return {
      path,
      entry_kind: 'text_file',
      content,
      content_digest: safeDigest(file.content_digest.value),
      content_bytes: contentBytes,
      resource_id: resourceId,
      resource_id_digest: read.resource_id_digest,
    };
  });
  let sourceTree;
  try {
    sourceTree = createBuilderProjectSourceTree({
      files: files.map((file) => ({ path: file.path, content: file.content })),
    });
  } catch {
    fail();
  }
  let totalContentBytes = 0;
  const byPath = new Map(sourceTree.files.map((file) => [file.path, file]));
  const seenFiles = new Set();
  for (const file of files) {
    const sourceEntry = byPath.get(file.path);
    totalContentBytes += file.content_bytes;
    if (
      seenFiles.has(file.path)
      || !sourceEntry
      || sourceEntry.content_digest !== file.content_digest
      || sourceEntry.content !== file.content
    ) fail();
    seenFiles.add(file.path);
  }
  if (sourceTree.files.length !== files.length || totalContentBytes > MAX_CONTEXT_TOTAL_BYTES) fail();
  return freezeDeep({
    file_summaries: files.map((file) => ({
      resource_id_digest: file.resource_id_digest,
      entry_kind: 'text_file',
      content_digest: file.content_digest,
      content_bytes: file.content_bytes,
    })),
    file_count: files.length,
    source_tree_digest: sourceTree.source_tree_digest,
    total_content_bytes: totalContentBytes,
  });
}

function sourceContextDigest(binding, sourceSummary, reads, status) {
  return sha256Canonical({
    attempt_number: binding.attempt_number,
    collector_authority: SOURCE_CONTEXT_AUTHORITY.collector_authority,
    file_count: sourceSummary.file_count,
    head_event_digest: binding.head_event_digest,
    head_event_id: binding.head_event_id,
    head_sequence: binding.head_sequence,
    operation: 'project_source_context_collected',
    read_summaries: reads.map((read) => ({
      resource_id_digest: read.resource_id_digest,
      status: read.status,
      tool_call_id: read.tool_call_id,
    })),
    request_digest: binding.request_digest,
    resource_count: reads.length,
    result_version: SOURCE_CONTEXT_RESULT_VERSION,
    source_context_status: status,
    source_tree_digest: sourceSummary.source_tree_digest,
    total_content_bytes: sourceSummary.total_content_bytes,
  });
}

function sanitizeSourceContextResult(value) {
  const descriptors = exactObject(value, RESULT_KEYS);
  const status = safeStatus(descriptors.status.value);
  if (
    descriptors.result_version.value !== SOURCE_CONTEXT_RESULT_VERSION
    || descriptors.operation.value !== 'project_source_context_collected'
  ) fail();
  sanitizeAuthority(
    descriptors.authority.value,
    SOURCE_CONTEXT_AUTHORITY_KEYS,
    SOURCE_CONTEXT_AUTHORITY,
  );
  const binding = sanitizeContext(descriptors.context.value);
  const reads = sanitizeReads(descriptors.reads.value);
  const sourceSummary = sanitizePrivateSourceContext(descriptors.private_source_context.value, reads);
  const succeededReads = reads.filter((read) => read.status === 'succeeded').length;
  if (
    sourceSummary.file_count !== succeededReads
    || (status === 'succeeded' && sourceSummary.file_count !== reads.length)
    || (status === 'partial' && (sourceSummary.file_count < 1 || sourceSummary.file_count >= reads.length))
    || (status === 'failed' && sourceSummary.file_count !== 0)
  ) fail();
  return freezeDeep({
    binding,
    context_digest: sourceContextDigest(binding, sourceSummary, reads, status),
    file_summaries: sourceSummary.file_summaries,
    file_count: sourceSummary.file_count,
    read_summaries: reads.map((read) => ({
      resource_id_digest: read.resource_id_digest,
      status: read.status,
      tool_call_id: read.tool_call_id,
    })),
    resource_count: reads.length,
    source_context_status: status,
    total_content_bytes: sourceSummary.total_content_bytes,
  });
}

function recordDigestBody(value) {
  return freezeDeep({
    agent_id: value.agent_id,
    authority: value.authority,
    context_binding: value.context_binding,
    conversation_id: value.conversation_id,
    file_count: value.file_count,
    file_summaries: value.file_summaries,
    lifecycle: value.lifecycle,
    owner_id: value.owner_id,
    project_id: value.project_id,
    read_summaries: value.read_summaries,
    record_kind: value.record_kind,
    record_version: value.record_version,
    resource_count: value.resource_count,
    run_id: value.run_id,
    source_context_status: value.source_context_status,
    supervised_action_admission_id: value.supervised_action_admission_id,
    task_id: value.task_id,
    total_content_bytes: value.total_content_bytes,
    turn_id: value.turn_id,
  });
}

function createRecordBody(admission, sourceContext) {
  if (
    admission.requested_next_action !== 'read_private_source'
    || admission.next_gate !== 'source_context_collector_required_later'
    || admission.project_id !== sourceContext.binding.project_id
    || admission.conversation_id !== sourceContext.binding.conversation_id
    || admission.task_id !== sourceContext.binding.task_id
    || admission.run_id !== sourceContext.binding.run_id
  ) fail();
  return freezeDeep({
    record_version: BUILDER_AGENT_PRIVATE_SOURCE_CONTEXT_RECORD_VERSION,
    record_kind: BUILDER_AGENT_PRIVATE_SOURCE_CONTEXT_RECORD_KIND,
    owner_id: admission.owner_id,
    agent_id: admission.agent_id,
    project_id: admission.project_id,
    conversation_id: admission.conversation_id,
    turn_id: sourceContext.binding.turn_id,
    task_id: admission.task_id,
    run_id: admission.run_id,
    supervised_action_admission_id: admission.admission_id,
    source_context_status: sourceContext.source_context_status,
    context_binding: {
      source_context_result_version: SOURCE_CONTEXT_RESULT_VERSION,
      source_context_operation: 'project_source_context_collected',
      collector_authority: SOURCE_CONTEXT_AUTHORITY.collector_authority,
      context_digest: sourceContext.context_digest,
      head_sequence: sourceContext.binding.head_sequence,
      head_digest: sha256Canonical({
        event_digest: sourceContext.binding.head_event_digest,
        event_id: sourceContext.binding.head_event_id,
        sequence: sourceContext.binding.head_sequence,
      }),
      attempt_number: sourceContext.binding.attempt_number,
      request_digest: sourceContext.binding.request_digest,
    },
    resource_count: sourceContext.resource_count,
    file_count: sourceContext.file_count,
    total_content_bytes: sourceContext.total_content_bytes,
    read_summaries: sourceContext.read_summaries,
    file_summaries: sourceContext.file_summaries,
    lifecycle: { ...LIFECYCLE },
    authority: { ...AUTHORITY },
  });
}

function sanitizeContextBinding(value) {
  const source = exactObject(value, CONTEXT_BINDING_KEYS);
  if (
    source.source_context_result_version.value !== SOURCE_CONTEXT_RESULT_VERSION
    || source.source_context_operation.value !== 'project_source_context_collected'
    || source.collector_authority.value !== SOURCE_CONTEXT_AUTHORITY.collector_authority
  ) fail();
  return freezeDeep({
    source_context_result_version: SOURCE_CONTEXT_RESULT_VERSION,
    source_context_operation: 'project_source_context_collected',
    collector_authority: SOURCE_CONTEXT_AUTHORITY.collector_authority,
    context_digest: safeDigest(source.context_digest.value),
    head_sequence: safeSequence(source.head_sequence.value),
    head_digest: safeDigest(source.head_digest.value),
    attempt_number: safeAttemptNumber(source.attempt_number.value),
    request_digest: safeDigest(source.request_digest.value),
  });
}

function sanitizeReadSummaries(value) {
  const reads = exactArray(value, 1, MAX_CONTEXT_FILES);
  const seenResources = new Set();
  const seenToolCalls = new Set();
  return freezeDeep(reads.map((rawRead) => {
    const source = exactObject(rawRead, READ_SUMMARY_KEYS);
    const resourceIdDigest = safeDigest(source.resource_id_digest.value);
    const status = source.status.value;
    const toolCallId = safePattern(source.tool_call_id.value, TOOL_CALL_ID_PATTERN);
    if (
      !READ_STATUSES.includes(status)
      || seenResources.has(resourceIdDigest)
      || seenToolCalls.has(toolCallId)
    ) fail();
    seenResources.add(resourceIdDigest);
    seenToolCalls.add(toolCallId);
    return freezeDeep({
      resource_id_digest: resourceIdDigest,
      status,
      tool_call_id: toolCallId,
    });
  }));
}

function sanitizeFileSummaries(value, reads) {
  const files = exactArray(value, 0, MAX_CONTEXT_FILES);
  const readResources = new Set(reads.filter((read) => read.status === 'succeeded').map(
    (read) => read.resource_id_digest,
  ));
  const seenResources = new Set();
  let total = 0;
  const result = files.map((rawFile) => {
    const source = exactObject(rawFile, FILE_SUMMARY_KEYS);
    const resourceIdDigest = safeDigest(source.resource_id_digest.value);
    const contentBytes = safeByteCount(source.content_bytes.value);
    if (
      source.entry_kind.value !== 'text_file'
      || !readResources.has(resourceIdDigest)
      || seenResources.has(resourceIdDigest)
    ) fail();
    seenResources.add(resourceIdDigest);
    total += contentBytes;
    return freezeDeep({
      resource_id_digest: resourceIdDigest,
      entry_kind: 'text_file',
      content_digest: safeDigest(source.content_digest.value),
      content_bytes: contentBytes,
    });
  });
  if (total > MAX_CONTEXT_TOTAL_BYTES) fail();
  return freezeDeep(result);
}

function sanitizeLifecycle(value) {
  return sanitizeAuthority(value, LIFECYCLE_KEYS, LIFECYCLE);
}

function sanitizeRecordAuthority(value) {
  return sanitizeAuthority(value, AUTHORITY_KEYS, AUTHORITY);
}

function createBuilderAgentPrivateSourceContextRecord(rawInput) {
  const input = exactObject(rawInput, INPUT_KEYS);
  let admission;
  try {
    admission = sanitizeBuilderAgentSupervisedActionAdmission(input.supervised_action_admission.value);
  } catch (error) {
    if (error instanceof BuilderAgentSupervisedActionAdmissionError) fail();
    throw error;
  }
  const sourceContext = sanitizeSourceContextResult(input.source_context_result.value);
  const body = createRecordBody(admission, sourceContext);
  const record = freezeDeep({
    ...body,
    record_digest: sha256Canonical(recordDigestBody(body)),
  });
  return sanitizeBuilderAgentPrivateSourceContextRecord(record);
}

function sanitizeBuilderAgentPrivateSourceContextRecord(rawRecord) {
  const source = exactObject(rawRecord, RECORD_KEYS);
  const reads = sanitizeReadSummaries(source.read_summaries.value);
  const files = sanitizeFileSummaries(source.file_summaries.value, reads);
  const status = safeStatus(source.source_context_status.value);
  const fileCount = safeCount(source.file_count.value, MAX_CONTEXT_FILES);
  const resourceCount = safeCount(source.resource_count.value, MAX_CONTEXT_FILES);
  const totalContentBytes = safeByteCount(source.total_content_bytes.value);
  if (
    fileCount !== files.length
    || resourceCount !== reads.length
    || totalContentBytes !== files.reduce((sum, file) => sum + file.content_bytes, 0)
    || (status === 'succeeded' && fileCount !== resourceCount)
    || (status === 'partial' && (fileCount < 1 || fileCount >= resourceCount))
    || (status === 'failed' && fileCount !== 0)
  ) fail();
  const record = freezeDeep({
    record_version: source.record_version.value,
    record_kind: source.record_kind.value,
    owner_id: safePattern(source.owner_id.value, /^builder-user:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u),
    agent_id: safePattern(source.agent_id.value, /^builder-agent:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u),
    project_id: safePattern(source.project_id.value, PROJECT_ID_PATTERN),
    conversation_id: safePattern(source.conversation_id.value, CONVERSATION_ID_PATTERN),
    turn_id: safePattern(source.turn_id.value, TURN_ID_PATTERN),
    task_id: safePattern(source.task_id.value, TASK_ID_PATTERN),
    run_id: safePattern(source.run_id.value, RUN_ID_PATTERN),
    supervised_action_admission_id: safePattern(source.supervised_action_admission_id.value, ADMISSION_ID_PATTERN),
    source_context_status: status,
    context_binding: sanitizeContextBinding(source.context_binding.value),
    resource_count: resourceCount,
    file_count: fileCount,
    total_content_bytes: totalContentBytes,
    read_summaries: reads,
    file_summaries: files,
    lifecycle: sanitizeLifecycle(source.lifecycle.value),
    authority: sanitizeRecordAuthority(source.authority.value),
    record_digest: safeDigest(source.record_digest.value),
  });
  if (
    record.record_version !== BUILDER_AGENT_PRIVATE_SOURCE_CONTEXT_RECORD_VERSION
    || record.record_kind !== BUILDER_AGENT_PRIVATE_SOURCE_CONTEXT_RECORD_KIND
    || record.conversation_id !== expectedConversationId(record.project_id)
    || record.record_digest !== sha256Canonical(recordDigestBody(record))
  ) fail();
  return record;
}

module.exports = freezeDeep({
  BUILDER_AGENT_PRIVATE_SOURCE_CONTEXT_RECORD_KIND,
  BUILDER_AGENT_PRIVATE_SOURCE_CONTEXT_RECORD_VERSION,
  BuilderAgentPrivateSourceContextRecordError,
  createBuilderAgentPrivateSourceContextRecord,
  sanitizeBuilderAgentPrivateSourceContextRecord,
});
