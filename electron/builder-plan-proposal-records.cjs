'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const {
  createBuilderProjectSourceTree,
} = require('./builder-project-source-tree.cjs');

const BUILDER_PLAN_PROPOSAL_RECORD_VERSION = 'builder-plan-proposal-record.v1';
const PLAN_PROPOSAL_RECORD_KIND = 'builder_plan_proposal_record';
const SOURCE_CONTEXT_RESULT_VERSION = 'builder-tool-source-context-result.v1';
const PRIVATE_SOURCE_CONTEXT_VERSION = 'builder-private-source-context.v1';
const MAX_CONTEXT_FILES = 8;
const MAX_CONTEXT_FILE_BYTES = 16 * 1024;
const MAX_CONTEXT_TOTAL_BYTES = MAX_CONTEXT_FILES * MAX_CONTEXT_FILE_BYTES;
const MAX_PLAN_STEPS = 12;
const MAX_TITLE_CODE_POINTS = 120;
const MAX_TITLE_UTF8_BYTES = 512;
const MAX_SUMMARY_CODE_POINTS = 1_200;
const MAX_SUMMARY_UTF8_BYTES = 4 * 1024;
const MAX_STEP_TEXT_CODE_POINTS = 360;
const MAX_STEP_TEXT_UTF8_BYTES = 1_536;
const MAX_EVENT_SEQUENCE = 4_096;
const MAX_EVENTS_IN_CONTEXT = 64;

const INPUT_KEYS = Object.freeze([
  'source_context_result',
  'proposed_at_ms',
  'title',
  'summary',
  'steps',
]);
const RECORD_KEYS = Object.freeze([
  'record_version',
  'record_kind',
  'project_id',
  'conversation_id',
  'turn_id',
  'task_id',
  'run_id',
  'attempt_number',
  'proposed_at_ms',
  'result_kind',
  'plan_state',
  'context_binding',
  'title',
  'summary',
  'steps',
  'lifecycle',
  'authority',
  'record_digest',
]);
const CONTEXT_BINDING_KEYS = Object.freeze([
  'source_context_result_version',
  'collector_authority',
  'context_digest',
  'context_status',
  'file_count',
  'total_content_bytes',
  'head_sequence',
  'head_digest',
]);
const STEP_KEYS = Object.freeze([
  'plan_step_id',
  'title',
  'purpose',
  'expected_change',
  'status',
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
  'source_context_admission',
  'plan_admission',
  'approval_admission',
  'tool_dispatch',
  'provider_dispatch',
  'source_mutation',
  'verification_admission',
  'revision_admission',
]);
const AUTHORITY_KEYS = Object.freeze([
  'record_authority',
  'source_context_authority',
  'conversation_binding',
  'renderer_authority',
  'provider_dispatch',
  'credential_readback',
  'tool_dispatch',
  'source_mutation',
  'raw_source_storage',
  'conversation_event',
  'git_authority',
  'revision_admission',
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
const PLAN_STEP_ID_PATTERN = new RegExp(`^builder-plan-step:${UUID_SOURCE}$`, 'u');
const EVENT_ID_PATTERN = /^builder-conversation-event:[0-9a-f]{64}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const RESOURCE_ID_PATTERN = /^project:\/[a-z0-9._/@-]{1,120}$/u;
const UNSAFE_UNICODE_FORMAT_PATTERN = /[\p{Cf}\p{Bidi_Control}]/u;
const LOCAL_PATH_PATTERN = /(?:file:\/{1,3}|\\\\|(?:^|[\s"'`=(,:])(?:[A-Za-z]:[\\/]|~[\\/]|\/(?!\/)[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*))/iu;
const SOURCE_PATH_PATTERN = /(?:^|[\s"'`(,:])(?:[A-Za-z0-9._-]+\/){1,}[A-Za-z0-9._-]+\.[A-Za-z0-9._-]{1,12}(?=$|[\s"'`),.;:])/u;
const PROJECT_RESOURCE_PATTERN = /\bproject:\/[a-z0-9._/@-]+/iu;
const CREDENTIAL_PATTERN = /(?:["'`]?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|password|secret|credential|client[_-]?secret|private[_-]?key)["'`]?\s*[:=]\s*(?!["'`]?\s*(?:null|undefined)\b)\S|\b(?:basic|bearer)\s+[A-Za-z0-9._~+/=-]{16,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|https?:\/\/[^\s/:@]+:[^\s/@]+@|\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16})\b)/iu;

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
  source_context_admission: 'bounded_private_source_context_digest_only',
  plan_admission: 'proposed_not_approved',
  approval_admission: 'not_approved',
  tool_dispatch: 'not_performed',
  provider_dispatch: 'not_performed_by_record_contract',
  source_mutation: 'not_performed',
  verification_admission: 'not_started',
  revision_admission: 'not_created',
});
const AUTHORITY = Object.freeze({
  record_authority: 'main_plan_proposal_record_contract_v1',
  source_context_authority: 'main_tool_source_context_collector_v1',
  conversation_binding: 'ids_only_host_replay_required',
  renderer_authority: 'not_present',
  provider_dispatch: false,
  credential_readback: false,
  tool_dispatch: 'not_performed',
  source_mutation: 'not_performed',
  raw_source_storage: 'not_present',
  conversation_event: 'not_admitted_by_record_contract',
  git_authority: 'not_present',
  revision_admission: 'not_created',
});

class BuilderPlanProposalRecordError extends Error {
  constructor() {
    super('The plan proposal record could not be verified.');
    this.name = 'BuilderPlanProposalRecordError';
    this.code = 'builder_plan_proposal_record_invalid';
    this.retryable = false;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderPlanProposalRecordError();
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
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
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

function hasUnpairedSurrogate(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return true;
  }
  return false;
}

function hasControl(value, allowFormatting) {
  if (UNSAFE_UNICODE_FORMAT_PATTERN.test(value)) return true;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0x7f && code <= 0x9f) return true;
    if (code <= 0x1f && (!allowFormatting || ![9, 10, 13].includes(code))) return true;
  }
  return false;
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

function unsafeText(value) {
  const normalized = value.normalize('NFKC');
  return LOCAL_PATH_PATTERN.test(normalized)
    || SOURCE_PATH_PATTERN.test(normalized)
    || PROJECT_RESOURCE_PATTERN.test(normalized)
    || CREDENTIAL_PATTERN.test(normalized);
}

function safeText(value, maximumCodePoints, maximumUtf8Bytes, allowFormatting) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.trim() !== value
    || value.normalize('NFC') !== value
    || value.length > maximumCodePoints * 2
    || Array.from(value).length > maximumCodePoints
    || Buffer.byteLength(value, 'utf8') > maximumUtf8Bytes
    || hasUnpairedSurrogate(value)
    || hasControl(value, allowFormatting)
    || unsafeText(value)
  ) fail();
  return value;
}

function sanitizeAuthority(value, keys, expected) {
  const descriptors = exactObject(value, keys);
  for (const key of keys) {
    if (descriptors[key].value !== expected[key]) fail();
  }
  return freezeDeep({ ...expected });
}

function expectedConversationId(projectId) {
  return `builder-conversation:${projectId.slice('builder-project:'.length)}`;
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
  ) fail();
  exactArray(descriptors.events.value, 0, MAX_EVENTS_IN_CONTEXT);
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

function sanitizePrivateSourceContext(value) {
  const descriptors = exactObject(value, PRIVATE_CONTEXT_KEYS);
  if (descriptors.context_version.value !== PRIVATE_SOURCE_CONTEXT_VERSION) fail();
  const files = exactArray(descriptors.files.value, 0, MAX_CONTEXT_FILES).map((rawFile) => {
    const file = exactObject(rawFile, PRIVATE_FILE_KEYS);
    const content = file.content.value;
    const contentBytes = safeByteCount(file.content_bytes.value);
    if (
      file.entry_kind.value !== 'text_file'
      || typeof content !== 'string'
      || Buffer.byteLength(content, 'utf8') !== contentBytes
      || contentBytes > MAX_CONTEXT_FILE_BYTES
    ) fail();
    return {
      path: file.path.value,
      entry_kind: 'text_file',
      content,
      content_digest: safeDigest(file.content_digest.value),
      content_bytes: contentBytes,
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
  for (const file of files) {
    const sourceEntry = byPath.get(file.path);
    totalContentBytes += file.content_bytes;
    if (
      !sourceEntry
      || sourceEntry.content_digest !== file.content_digest
      || sourceEntry.content !== file.content
    ) fail();
  }
  if (totalContentBytes > MAX_CONTEXT_TOTAL_BYTES) fail();
  return freezeDeep({
    source_tree_digest: sourceTree.source_tree_digest,
    file_count: sourceTree.files.length,
    total_content_bytes: totalContentBytes,
    resource_ids: sourceTree.files.map((file) => `project:/${file.path}`),
  });
}

function sanitizeReads(value, expectedResourceIds) {
  const expectedCount = expectedResourceIds.length;
  const reads = exactArray(value, expectedCount, expectedCount);
  const seenResources = new Set();
  const seenToolCalls = new Set();
  const result = [];
  for (const read of reads) {
    const descriptors = exactObject(read, READ_KEYS);
    const resourceId = safePattern(descriptors.resource_id.value, RESOURCE_ID_PATTERN);
    const toolCallId = safePattern(descriptors.tool_call_id.value, TOOL_CALL_ID_PATTERN);
    if (
      descriptors.status.value !== 'succeeded'
      || seenResources.has(resourceId)
      || seenToolCalls.has(toolCallId)
    ) fail();
    seenResources.add(resourceId);
    seenToolCalls.add(toolCallId);
    result.push({
      resource_id: resourceId,
      status: 'succeeded',
      tool_call_id: toolCallId,
    });
  }
  for (const resourceId of expectedResourceIds) {
    if (!seenResources.has(resourceId)) fail();
  }
  return freezeDeep(result);
}

function sourceContextDigest(binding, privateContext) {
  return sha256Canonical({
    attempt_number: binding.attempt_number,
    collector_authority: SOURCE_CONTEXT_AUTHORITY.collector_authority,
    context_status: 'succeeded',
    conversation_id: binding.conversation_id,
    file_count: privateContext.file_count,
    head_event_digest: binding.head_event_digest,
    head_event_id: binding.head_event_id,
    head_sequence: binding.head_sequence,
    operation: 'project_source_context_collected',
    project_id: binding.project_id,
    request_digest: binding.request_digest,
    result_version: SOURCE_CONTEXT_RESULT_VERSION,
    run_id: binding.run_id,
    source_tree_digest: privateContext.source_tree_digest,
    task_id: binding.task_id,
    total_content_bytes: privateContext.total_content_bytes,
    turn_id: binding.turn_id,
  });
}

function sanitizeSourceContextResult(value) {
  const descriptors = exactObject(value, RESULT_KEYS);
  if (
    descriptors.result_version.value !== SOURCE_CONTEXT_RESULT_VERSION
    || descriptors.operation.value !== 'project_source_context_collected'
    || descriptors.status.value !== 'succeeded'
  ) fail();
  sanitizeAuthority(
    descriptors.authority.value,
    SOURCE_CONTEXT_AUTHORITY_KEYS,
    SOURCE_CONTEXT_AUTHORITY,
  );
  const binding = sanitizeContext(descriptors.context.value);
  const privateContext = sanitizePrivateSourceContext(descriptors.private_source_context.value);
  const reads = sanitizeReads(descriptors.reads.value, privateContext.resource_ids);
  const headDigest = sha256Canonical({
    event_digest: binding.head_event_digest,
    event_id: binding.head_event_id,
    sequence: binding.head_sequence,
  });
  return freezeDeep({
    ...binding,
    context_binding: {
      source_context_result_version: SOURCE_CONTEXT_RESULT_VERSION,
      collector_authority: SOURCE_CONTEXT_AUTHORITY.collector_authority,
      context_digest: sourceContextDigest(binding, privateContext),
      context_status: 'succeeded',
      file_count: privateContext.file_count,
      total_content_bytes: privateContext.total_content_bytes,
      head_sequence: binding.head_sequence,
      head_digest: headDigest,
    },
    reads,
  });
}

function sanitizeBuilderPlanProposalSourceContextResult(rawResult) {
  try {
    return sanitizeSourceContextResult(rawResult);
  } catch (error) {
    if (error instanceof BuilderPlanProposalRecordError) throw error;
    fail();
  }
}

function sanitizeContextBinding(value) {
  const descriptors = exactObject(value, CONTEXT_BINDING_KEYS);
  const fileCount = descriptors.file_count.value;
  const totalContentBytes = safeByteCount(descriptors.total_content_bytes.value);
  if (
    descriptors.source_context_result_version.value !== SOURCE_CONTEXT_RESULT_VERSION
    || descriptors.collector_authority.value !== SOURCE_CONTEXT_AUTHORITY.collector_authority
    || descriptors.context_status.value !== 'succeeded'
    || !Number.isSafeInteger(fileCount)
    || fileCount < 0
    || fileCount > MAX_CONTEXT_FILES
    || totalContentBytes < 0
  ) fail();
  return freezeDeep({
    source_context_result_version: SOURCE_CONTEXT_RESULT_VERSION,
    collector_authority: SOURCE_CONTEXT_AUTHORITY.collector_authority,
    context_digest: safeDigest(descriptors.context_digest.value),
    context_status: 'succeeded',
    file_count: fileCount,
    total_content_bytes: totalContentBytes,
    head_sequence: safeSequence(descriptors.head_sequence.value),
    head_digest: safeDigest(descriptors.head_digest.value),
  });
}

function sanitizePlanSteps(value) {
  const steps = exactArray(value, 1, MAX_PLAN_STEPS);
  const seen = new Set();
  return freezeDeep(steps.map((rawStep) => {
    const descriptors = exactObject(rawStep, STEP_KEYS);
    const planStepId = safePattern(descriptors.plan_step_id.value, PLAN_STEP_ID_PATTERN);
    if (seen.has(planStepId) || descriptors.status.value !== 'proposed') fail();
    seen.add(planStepId);
    return {
      plan_step_id: planStepId,
      title: safeText(descriptors.title.value, MAX_TITLE_CODE_POINTS, MAX_TITLE_UTF8_BYTES, false),
      purpose: safeText(
        descriptors.purpose.value,
        MAX_STEP_TEXT_CODE_POINTS,
        MAX_STEP_TEXT_UTF8_BYTES,
        true,
      ),
      expected_change: safeText(
        descriptors.expected_change.value,
        MAX_STEP_TEXT_CODE_POINTS,
        MAX_STEP_TEXT_UTF8_BYTES,
        true,
      ),
      status: 'proposed',
    };
  }));
}

function planDigestBody(record) {
  return {
    attempt_number: record.attempt_number,
    authority: record.authority,
    context_binding: record.context_binding,
    conversation_id: record.conversation_id,
    lifecycle: record.lifecycle,
    plan_state: record.plan_state,
    project_id: record.project_id,
    proposed_at_ms: record.proposed_at_ms,
    record_kind: record.record_kind,
    record_version: record.record_version,
    result_kind: record.result_kind,
    run_id: record.run_id,
    steps: record.steps,
    summary: record.summary,
    task_id: record.task_id,
    title: record.title,
    turn_id: record.turn_id,
  };
}

function unsignedRecord({
  sourceContext,
  proposedAtMs,
  title,
  summary,
  steps,
}) {
  return freezeDeep({
    record_version: BUILDER_PLAN_PROPOSAL_RECORD_VERSION,
    record_kind: PLAN_PROPOSAL_RECORD_KIND,
    project_id: sourceContext.project_id,
    conversation_id: sourceContext.conversation_id,
    turn_id: sourceContext.turn_id,
    task_id: sourceContext.task_id,
    run_id: sourceContext.run_id,
    attempt_number: sourceContext.attempt_number,
    proposed_at_ms: proposedAtMs,
    result_kind: 'plan',
    plan_state: 'proposed',
    context_binding: sourceContext.context_binding,
    title,
    summary,
    steps,
    lifecycle: { ...LIFECYCLE },
    authority: { ...AUTHORITY },
  });
}

function createBuilderPlanProposalRecord(rawInput) {
  try {
    const descriptors = exactObject(rawInput, INPUT_KEYS);
    const sourceContext = sanitizeSourceContextResult(descriptors.source_context_result.value);
    const record = unsignedRecord({
      sourceContext,
      proposedAtMs: safeTimestamp(descriptors.proposed_at_ms.value),
      title: safeText(
        descriptors.title.value,
        MAX_TITLE_CODE_POINTS,
        MAX_TITLE_UTF8_BYTES,
        false,
      ),
      summary: safeText(
        descriptors.summary.value,
        MAX_SUMMARY_CODE_POINTS,
        MAX_SUMMARY_UTF8_BYTES,
        true,
      ),
      steps: sanitizePlanSteps(descriptors.steps.value),
    });
    return freezeDeep({
      ...record,
      record_digest: sha256Canonical(planDigestBody(record)),
    });
  } catch (error) {
    if (error instanceof BuilderPlanProposalRecordError) throw error;
    fail();
  }
}

function sanitizeBuilderPlanProposalRecord(rawRecord) {
  try {
    const descriptors = exactObject(rawRecord, RECORD_KEYS);
    if (
      descriptors.record_version.value !== BUILDER_PLAN_PROPOSAL_RECORD_VERSION
      || descriptors.record_kind.value !== PLAN_PROPOSAL_RECORD_KIND
      || descriptors.result_kind.value !== 'plan'
      || descriptors.plan_state.value !== 'proposed'
    ) fail();
    const record = freezeDeep({
      record_version: BUILDER_PLAN_PROPOSAL_RECORD_VERSION,
      record_kind: PLAN_PROPOSAL_RECORD_KIND,
      project_id: safePattern(descriptors.project_id.value, PROJECT_ID_PATTERN),
      conversation_id: safePattern(descriptors.conversation_id.value, CONVERSATION_ID_PATTERN),
      turn_id: safePattern(descriptors.turn_id.value, TURN_ID_PATTERN),
      task_id: safePattern(descriptors.task_id.value, TASK_ID_PATTERN),
      run_id: safePattern(descriptors.run_id.value, RUN_ID_PATTERN),
      attempt_number: safeAttemptNumber(descriptors.attempt_number.value),
      proposed_at_ms: safeTimestamp(descriptors.proposed_at_ms.value),
      result_kind: 'plan',
      plan_state: 'proposed',
      context_binding: sanitizeContextBinding(descriptors.context_binding.value),
      title: safeText(
        descriptors.title.value,
        MAX_TITLE_CODE_POINTS,
        MAX_TITLE_UTF8_BYTES,
        false,
      ),
      summary: safeText(
        descriptors.summary.value,
        MAX_SUMMARY_CODE_POINTS,
        MAX_SUMMARY_UTF8_BYTES,
        true,
      ),
      steps: sanitizePlanSteps(descriptors.steps.value),
      lifecycle: sanitizeAuthority(descriptors.lifecycle.value, LIFECYCLE_KEYS, LIFECYCLE),
      authority: sanitizeAuthority(descriptors.authority.value, AUTHORITY_KEYS, AUTHORITY),
    });
    if (record.conversation_id !== expectedConversationId(record.project_id)) fail();
    const digest = safeDigest(descriptors.record_digest.value);
    if (digest !== sha256Canonical(planDigestBody(record))) fail();
    return freezeDeep({
      ...record,
      record_digest: digest,
    });
  } catch (error) {
    if (error instanceof BuilderPlanProposalRecordError) throw error;
    fail();
  }
}

module.exports = freezeDeep({
  BUILDER_PLAN_PROPOSAL_RECORD_VERSION,
  PLAN_PROPOSAL_RECORD_KIND,
  BuilderPlanProposalRecordError,
  createBuilderPlanProposalRecord,
  sanitizeBuilderPlanProposalSourceContextResult,
  sanitizeBuilderPlanProposalRecord,
});
