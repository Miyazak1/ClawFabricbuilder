'use strict';

const { types: utilTypes } = require('node:util');

const {
  sanitizeBuilderToolCallRecord,
} = require('./builder-tool-call-records.cjs');
const {
  FILESYSTEM_READ_TOOL_ADAPTER_ID,
} = require('./builder-tool-adapter-selection-admission.cjs');
const {
  FILESYSTEM_READ_TOOL_RUNTIME_ID,
} = require('./builder-tool-runtime-invocation-admission.cjs');
const {
  createBuilderToolResultRecord,
} = require('./builder-tool-result-records.cjs');
const {
  readBuilderToolFilesystemReadAdapter,
} = require('./builder-tool-filesystem-read-adapter.cjs');

const BUILDER_TOOL_FILESYSTEM_READ_EXECUTION_SERVICE_VERSION =
  'builder-tool-filesystem-read-execution-service.v1';
const RESULT_VERSION = 'builder-tool-filesystem-read-execution-result.v1';
const OPTION_KEYS = Object.freeze([
  'conversation_service',
  'project_workspace_authority',
  'now_ms',
]);
const REQUEST_KEYS = Object.freeze([
  'context',
  'tool_call_record',
]);
const AUTHORITY = Object.freeze({
  execution_authority: 'main_tool_filesystem_read_execution_service_v1',
  conversation_authority: 'trusted_conversation_main_service_methods',
  workspace_authority: 'main_project_workspace_root_contract_v1',
  adapter_authority: 'main_tool_filesystem_read_adapter_v1',
  renderer_authority: 'not_present',
  provider_dispatch: false,
  credential_readback: false,
  raw_output_storage: 'not_durable',
  conversation_event: 'fixed_result_summary_only',
  git_authority: 'not_present',
  revision_admission: 'not_created',
});

class BuilderToolFilesystemReadExecutionServiceError extends Error {
  constructor() {
    super('The filesystem read tool could not be completed.');
    this.name = 'BuilderToolFilesystemReadExecutionServiceError';
    this.code = 'builder_tool_filesystem_read_execution_service_unavailable';
    this.retryable = false;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderToolFilesystemReadExecutionServiceError();
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

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail();
  return value;
}

function sanitizeOptions(value) {
  const descriptors = exactObject(value, OPTION_KEYS);
  const conversationService = descriptors.conversation_service.value;
  const projectWorkspaceAuthority = descriptors.project_workspace_authority.value;
  const nowMs = descriptors.now_ms.value;
  if (typeof nowMs !== 'function' || utilTypes.isProxy(nowMs)) fail();
  return Object.freeze({
    conversationService,
    projectWorkspaceAuthority,
    nowMs,
    selectToolAdapter: ownMethod(conversationService, 'select_tool_adapter'),
    admitToolRuntimeInvocation: ownMethod(conversationService, 'admit_tool_runtime_invocation'),
    recordToolResult: ownMethod(conversationService, 'record_tool_result'),
    admitProjectWorkspace: ownMethod(projectWorkspaceAuthority, 'admit_project_workspace'),
  });
}

function resultInputFor(outputRecord) {
  if (outputRecord === null) {
    return Object.freeze({
      status: 'failed',
      summary_code: 'adapter_unavailable',
    });
  }
  return Object.freeze({
    status: 'succeeded',
    summary_code: 'completed_without_raw_output',
  });
}

function createBuilderToolFilesystemReadExecutionService(rawOptions) {
  const options = sanitizeOptions(rawOptions);

  async function executeFilesystemRead(rawRequest) {
    try {
      const descriptors = exactObject(rawRequest, REQUEST_KEYS);
      const context = descriptors.context.value;
      const toolCallRecord = sanitizeBuilderToolCallRecord(descriptors.tool_call_record.value);
      const selectionAdmission = Reflect.apply(options.selectToolAdapter, options.conversationService, [{
        context,
        tool_call_id: toolCallRecord.tool_call_id,
        adapter_id: FILESYSTEM_READ_TOOL_ADAPTER_ID,
      }]);
      const runtimeAdmission = Reflect.apply(options.admitToolRuntimeInvocation, options.conversationService, [{
        context,
        tool_call_id: toolCallRecord.tool_call_id,
        adapter_selection_admission: selectionAdmission,
        runtime_id: FILESYSTEM_READ_TOOL_RUNTIME_ID,
      }]);
      const observedAtMs = safeTimestamp(Reflect.apply(options.nowMs, undefined, []));
      let filesystemReadOutputRecord = null;
      try {
        const workspaceAdmission = Reflect.apply(
          options.admitProjectWorkspace,
          options.projectWorkspaceAuthority,
          [{
            project_id: toolCallRecord.project_id,
            admitted_at_ms: observedAtMs,
          }],
        );
        filesystemReadOutputRecord = await readBuilderToolFilesystemReadAdapter({
          project_workspace_admission: workspaceAdmission,
          runtime_invocation_admission: runtimeAdmission,
          tool_call_record: toolCallRecord,
          observed_at_ms: observedAtMs,
        });
      } catch {
        filesystemReadOutputRecord = null;
      }
      const toolResultRecord = createBuilderToolResultRecord({
        runtime_invocation_admission: runtimeAdmission,
        tool_call_record: toolCallRecord,
        observed_at_ms: observedAtMs,
        result: resultInputFor(filesystemReadOutputRecord),
      });
      const updatedContext = Reflect.apply(options.recordToolResult, options.conversationService, [{
        context,
        runtime_invocation_admission: runtimeAdmission,
        tool_result_record: toolResultRecord,
      }]);
      return freezeDeep({
        result_version: RESULT_VERSION,
        operation: 'filesystem_read_tool_executed',
        status: toolResultRecord.result.status,
        context: updatedContext,
        runtime_invocation_admission: runtimeAdmission,
        tool_result_record: toolResultRecord,
        private_filesystem_read_output_record: filesystemReadOutputRecord,
        authority: { ...AUTHORITY },
      });
    } catch (error) {
      if (error instanceof BuilderToolFilesystemReadExecutionServiceError) throw error;
      fail();
    }
  }

  return freezeDeep({
    service_version: BUILDER_TOOL_FILESYSTEM_READ_EXECUTION_SERVICE_VERSION,
    execute_filesystem_read: executeFilesystemRead,
  });
}

module.exports = freezeDeep({
  BUILDER_TOOL_FILESYSTEM_READ_EXECUTION_SERVICE_VERSION,
  BuilderToolFilesystemReadExecutionServiceError,
  createBuilderToolFilesystemReadExecutionService,
});
