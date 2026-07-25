'use strict';

const { types: utilTypes } = require('node:util');

const {
  BUILDER_TOOL_SESSION_POLICY_VERSION,
  DEFAULT_BUILDER_TOOL_SESSION_LIMITS,
  createBuilderToolSessionPolicy,
} = require('./builder-tool-session-policy.cjs');
const {
  createBuilderToolCallRecord,
} = require('./builder-tool-call-records.cjs');
const {
  createBuilderToolFilesystemReadExecutionService,
} = require('./builder-tool-filesystem-read-execution-service.cjs');

const BUILDER_TOOL_SOURCE_CONTEXT_COLLECTOR_VERSION =
  'builder-tool-source-context-collector.v1';
const RESULT_VERSION = 'builder-tool-source-context-result.v1';
const OPTION_KEYS = Object.freeze([
  'conversation_service',
  'permission_admission',
  'project_workspace_authority',
  'create_uuid',
  'now_ms',
]);
const REQUEST_KEYS = Object.freeze(['context', 'resource_ids']);
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
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const UUID_PATTERN = new RegExp(`^${UUID_SOURCE}$`, 'u');
const PROJECT_ID_PATTERN = new RegExp(`^builder-project:(${UUID_SOURCE})$`, 'u');
const CONVERSATION_ID_PATTERN = new RegExp(`^builder-conversation:(${UUID_SOURCE})$`, 'u');
const TURN_ID_PATTERN = new RegExp(`^builder-turn:${UUID_SOURCE}$`, 'u');
const TASK_ID_PATTERN = new RegExp(`^builder-task:${UUID_SOURCE}$`, 'u');
const RUN_ID_PATTERN = new RegExp(`^builder-run:${UUID_SOURCE}$`, 'u');
const RESOURCE_ID_PATTERN = /^project:\/[a-z0-9._/@-]{1,120}$/u;
const MAX_CONTEXT_FILES = 8;
const MAX_CONTEXT_FILE_BYTES = 16 * 1024;
const AUTHORITY = Object.freeze({
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

class BuilderToolSourceContextCollectorError extends Error {
  constructor() {
    super('The project source context could not be collected.');
    this.name = 'BuilderToolSourceContextCollectorError';
    this.code = 'builder_tool_source_context_collector_unavailable';
    this.retryable = false;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderToolSourceContextCollectorError();
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

function ownMethod(value, key) {
  if (value === null || typeof value !== 'object' || utilTypes.isProxy(value)) fail();
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') {
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

function safePattern(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) fail();
  return value;
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail();
  return value;
}

function safeContext(rawContext) {
  const descriptors = exactObject(rawContext, CONTEXT_KEYS);
  const project = exactObject(descriptors.project.value, PROJECT_KEYS);
  const conversation = exactObject(descriptors.conversation.value, CONVERSATION_KEYS);
  const ids = exactObject(descriptors.ids.value, IDS_KEYS);
  const projectId = safePattern(project.project_id.value, PROJECT_ID_PATTERN);
  const conversationId = safePattern(conversation.conversation_id.value, CONVERSATION_ID_PATTERN);
  if (
    descriptors.context_version.value !== 'builder-conversation-run-context.v1'
    || descriptors.mode.value !== 'work'
    || descriptors.run_terminal_failure_code.value !== null
    || descriptors.cancel_requested.value !== false
    || safeTimestamp(project.created_at_ms.value) < 0
    || conversation.project_id.value !== projectId
    || safeTimestamp(conversation.created_at_ms.value) < 0
    || conversationId.slice('builder-conversation:'.length)
      !== projectId.slice('builder-project:'.length)
    || !Array.isArray(descriptors.events.value)
    || utilTypes.isProxy(descriptors.events.value)
    || !Number.isSafeInteger(descriptors.attempt_number.value)
    || descriptors.attempt_number.value < 1
  ) fail();
  return freezeDeep({
    project_id: projectId,
    conversation_id: conversationId,
    turn_id: safePattern(ids.turn_id.value, TURN_ID_PATTERN),
    task_id: safePattern(ids.task_id.value, TASK_ID_PATTERN),
    run_id: safePattern(ids.run_id.value, RUN_ID_PATTERN),
  });
}

function safeUuid(value) {
  return safePattern(value, UUID_PATTERN);
}

function newId(createUuid, prefix) {
  return `${prefix}:${safeUuid(Reflect.apply(createUuid, undefined, []))}`;
}

function safeResourceIds(value) {
  if (!Array.isArray(value) || utilTypes.isProxy(value) || value.length < 1 || value.length > MAX_CONTEXT_FILES) {
    fail();
  }
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key === 'symbol') || keys.length !== value.length + 1) fail();
  const seen = new Set();
  const resources = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
    const resourceId = safePattern(descriptor.value, RESOURCE_ID_PATTERN);
    const segments = resourceId.slice('project:/'.length).split('/');
    if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) fail();
    if (seen.has(resourceId)) fail();
    seen.add(resourceId);
    resources.push(resourceId);
  }
  return freezeDeep(resources);
}

function sourceFileFromOutput(outputRecord) {
  if (outputRecord === null) return null;
  const file = outputRecord.file;
  return freezeDeep({
    path: file.path,
    entry_kind: file.entry_kind,
    content: file.content,
    content_digest: file.content_digest,
    content_bytes: file.content_bytes,
  });
}

function policyLimits(fileCount) {
  return freezeDeep({
    ...DEFAULT_BUILDER_TOOL_SESSION_LIMITS,
    max_steps: Math.max(fileCount + 1, 2),
    max_tool_calls: Math.max(fileCount, 1),
    max_retries: 0,
    max_raw_output_bytes: MAX_CONTEXT_FILE_BYTES,
  });
}

function collectorStatus(fileCount, resourceCount) {
  if (fileCount === resourceCount) return 'succeeded';
  return fileCount === 0 ? 'failed' : 'partial';
}

function sanitizeOptions(value) {
  const descriptors = exactObject(value, OPTION_KEYS);
  const conversationService = descriptors.conversation_service.value;
  const permissionAdmission = descriptors.permission_admission.value;
  const projectWorkspaceAuthority = descriptors.project_workspace_authority.value;
  const createUuid = descriptors.create_uuid.value;
  const nowMs = descriptors.now_ms.value;
  if (
    typeof createUuid !== 'function'
    || utilTypes.isProxy(createUuid)
    || typeof nowMs !== 'function'
    || utilTypes.isProxy(nowMs)
  ) fail();
  return Object.freeze({
    conversationService,
    permissionAdmission,
    projectWorkspaceAuthority,
    createUuid,
    nowMs,
    admitPermission: ownMethod(permissionAdmission, 'admit'),
    recordToolCallRequest: ownMethod(conversationService, 'record_tool_call_request'),
  });
}

function createBuilderToolSourceContextCollector(rawOptions) {
  const options = sanitizeOptions(rawOptions);
  const filesystemReadExecution = createBuilderToolFilesystemReadExecutionService({
    conversation_service: options.conversationService,
    project_workspace_authority: options.projectWorkspaceAuthority,
    now_ms: options.nowMs,
  });

  async function collectProjectSourceContext(rawRequest) {
    try {
      const descriptors = exactObject(rawRequest, REQUEST_KEYS);
      let context = descriptors.context.value;
      const binding = safeContext(context);
      const resourceIds = safeResourceIds(descriptors.resource_ids.value);
      const issuedAtMs = safeTimestamp(Reflect.apply(options.nowMs, undefined, []));
      const sessionPolicy = createBuilderToolSessionPolicy({
        project_id: binding.project_id,
        conversation_id: binding.conversation_id,
        turn_id: binding.turn_id,
        task_id: binding.task_id,
        run_id: binding.run_id,
        issued_at_ms: issuedAtMs,
        limits: policyLimits(resourceIds.length),
      });
      const admittedReads = [];
      for (const resourceId of resourceIds) {
        const toolCallId = newId(options.createUuid, 'builder-tool-call');
        const permission = await Reflect.apply(options.admitPermission, options.permissionAdmission, [{
          tool_call_id: toolCallId,
          tool_name: 'filesystem.read',
          project_id: binding.project_id,
          action: 'filesystem.read',
          resource: {
            resource_kind: 'filesystem',
            project_id: binding.project_id,
            resource_id: resourceId,
          },
        }]);
        admittedReads.push(freezeDeep({
          resource_id: resourceId,
          tool_call_id: toolCallId,
          step_id: newId(options.createUuid, 'builder-run-step'),
          permission,
        }));
      }
      const files = [];
      const reads = [];
      for (const admittedRead of admittedReads) {
        const toolCallRecord = createBuilderToolCallRecord({
          project_id: binding.project_id,
          conversation_id: binding.conversation_id,
          turn_id: binding.turn_id,
          task_id: binding.task_id,
          run_id: binding.run_id,
          step_id: admittedRead.step_id,
          session_policy: sessionPolicy,
          admission: admittedRead.permission,
          requested_at_ms: safeTimestamp(Reflect.apply(options.nowMs, undefined, [])),
        });
        const requestedContext = Reflect.apply(
          options.recordToolCallRequest,
          options.conversationService,
          [{
            context,
            tool_call_record: toolCallRecord,
          }],
        );
        const read = await filesystemReadExecution.execute_filesystem_read({
          context: requestedContext,
          tool_call_record: toolCallRecord,
        });
        context = read.context;
        const file = sourceFileFromOutput(read.private_filesystem_read_output_record);
        if (file !== null) files.push(file);
        reads.push(freezeDeep({
          resource_id: admittedRead.resource_id,
          status: read.status,
          tool_call_id: toolCallRecord.tool_call_id,
        }));
      }
      return freezeDeep({
        result_version: RESULT_VERSION,
        operation: 'project_source_context_collected',
        status: collectorStatus(files.length, resourceIds.length),
        context,
        private_source_context: {
          context_version: 'builder-private-source-context.v1',
          files,
        },
        reads,
        authority: { ...AUTHORITY },
      });
    } catch (error) {
      if (error instanceof BuilderToolSourceContextCollectorError) throw error;
      fail();
    }
  }

  return freezeDeep({
    collector_version: BUILDER_TOOL_SOURCE_CONTEXT_COLLECTOR_VERSION,
    collect_project_source_context: collectProjectSourceContext,
    policy: {
      policy_version: BUILDER_TOOL_SESSION_POLICY_VERSION,
      max_context_files: MAX_CONTEXT_FILES,
      max_context_file_bytes: MAX_CONTEXT_FILE_BYTES,
    },
  });
}

module.exports = freezeDeep({
  BUILDER_TOOL_SOURCE_CONTEXT_COLLECTOR_VERSION,
  BuilderToolSourceContextCollectorError,
  createBuilderToolSourceContextCollector,
});
