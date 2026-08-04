'use strict';

const { types: utilTypes } = require('node:util');

const {
  BuilderAgentStepProgressProjectionError,
  projectBuilderAgentStepProgress,
} = require('./builder-agent-step-progress-projection.cjs');
const {
  BUILDER_AGENT_STEP_RESULT_STORE_VERSION,
  BuilderAgentStepResultStoreError,
} = require('./builder-agent-step-result-store.cjs');
const {
  BUILDER_AGENT_STEP_START_STORE_VERSION,
  BuilderAgentStepStartStoreError,
} = require('./builder-agent-step-start-store.cjs');

const BUILDER_AGENT_STEP_PROGRESS_READ_SERVICE_VERSION =
  'builder-agent-step-progress-read-service.v1';
const BUILDER_AGENT_STEP_PROGRESS_READ_SERVICE_RESULT_VERSION =
  'builder-agent-step-progress-read-service-result.v1';
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const OWNER_ID_PATTERN = new RegExp(`^builder-user:${UUID_SOURCE}$`, 'u');
const PROJECT_ID_PATTERN = new RegExp(`^builder-project:${UUID_SOURCE}$`, 'u');
const TASK_ID_PATTERN = new RegExp(`^builder-task:${UUID_SOURCE}$`, 'u');
const RUN_ID_PATTERN = new RegExp(`^builder-run:${UUID_SOURCE}$`, 'u');
const STORE_KEYS = Object.freeze([
  'step_result_store',
  'step_start_store',
]);
const READ_KEYS = Object.freeze([
  'owner_id',
  'project_id',
  'task_id',
  'run_id',
]);
const ERROR_MESSAGES = Object.freeze({
  builder_agent_step_progress_read_service_invalid:
    'Builder agent progress could not be verified.',
  builder_agent_step_progress_read_service_unavailable:
    'Builder agent progress is unavailable.',
});

class BuilderAgentStepProgressReadServiceError extends Error {
  constructor(code = 'builder_agent_step_progress_read_service_invalid') {
    const selected = Object.hasOwn(ERROR_MESSAGES, code)
      ? code
      : 'builder_agent_step_progress_read_service_invalid';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderAgentStepProgressReadServiceError';
    this.code = selected;
    this.retryable = selected === 'builder_agent_step_progress_read_service_unavailable';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) {
  throw new BuilderAgentStepProgressReadServiceError(code);
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
  if (!isPlainObject(value)) fail('builder_agent_step_progress_read_service_invalid');
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== keys.length
    || actual.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) fail('builder_agent_step_progress_read_service_invalid');
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      fail('builder_agent_step_progress_read_service_invalid');
    }
  }
  return value;
}

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
    fail('builder_agent_step_progress_read_service_invalid');
  }
  return descriptor.value;
}

function safePattern(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) {
    fail('builder_agent_step_progress_read_service_invalid');
  }
  return value;
}

function safeOwnerId(value) {
  return safePattern(value, OWNER_ID_PATTERN);
}

function safeProjectId(value) {
  return safePattern(value, PROJECT_ID_PATTERN);
}

function safeTaskId(value) {
  return safePattern(value, TASK_ID_PATTERN);
}

function safeRunId(value) {
  return safePattern(value, RUN_ID_PATTERN);
}

function storeMethod(store, name) {
  const descriptor = Object.getOwnPropertyDescriptor(store, name);
  if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') {
    fail('builder_agent_step_progress_read_service_invalid');
  }
  return descriptor.value.bind(store);
}

function safeStore(value, expectedVersion, methods) {
  if (value === null || typeof value !== 'object' || utilTypes.isProxy(value)) {
    fail('builder_agent_step_progress_read_service_invalid');
  }
  const versionDescriptor = Object.getOwnPropertyDescriptor(value, 'store_version');
  if (
    !versionDescriptor
    || !Object.hasOwn(versionDescriptor, 'value')
    || versionDescriptor.value !== expectedVersion
  ) fail('builder_agent_step_progress_read_service_invalid');
  const selected = { store_version: expectedVersion };
  for (const method of methods) selected[method] = storeMethod(value, method);
  return freezeDeep(selected);
}

function safeStores(rawStores) {
  exactObject(rawStores, STORE_KEYS);
  return freezeDeep({
    step_result_store: safeStore(
      valueAt(rawStores, 'step_result_store'),
      BUILDER_AGENT_STEP_RESULT_STORE_VERSION,
      ['list_run_step_results'],
    ),
    step_start_store: safeStore(
      valueAt(rawStores, 'step_start_store'),
      BUILDER_AGENT_STEP_START_STORE_VERSION,
      ['list_run_step_starts'],
    ),
  });
}

function normalizeOperationError(error) {
  if (error instanceof BuilderAgentStepProgressReadServiceError) {
    return new BuilderAgentStepProgressReadServiceError(error.code);
  }
  if (error instanceof BuilderAgentStepProgressProjectionError) {
    return new BuilderAgentStepProgressReadServiceError(
      'builder_agent_step_progress_read_service_invalid',
    );
  }
  if (
    error instanceof BuilderAgentStepResultStoreError
    || error instanceof BuilderAgentStepStartStoreError
  ) {
    if (/_unavailable$/u.test(error.code) || /_resource_exceeded$/u.test(error.code)) {
      return new BuilderAgentStepProgressReadServiceError(
        'builder_agent_step_progress_read_service_unavailable',
      );
    }
    return new BuilderAgentStepProgressReadServiceError(
      'builder_agent_step_progress_read_service_invalid',
    );
  }
  return new BuilderAgentStepProgressReadServiceError(
    'builder_agent_step_progress_read_service_unavailable',
  );
}

function evidence() {
  return freezeDeep({
    service_authority: 'main_owned_agent_step_progress_read_service',
    projection_authority: 'main_owned_step_start_and_result_store_projection',
    step_start_store_authority: 'main_owned_agent_step_start_store',
    step_result_store_authority: 'main_owned_agent_step_result_store',
    step_start_receipt: 'verified_not_exposed',
    step_result_receipt: 'verified_not_exposed',
    renderer_authority: 'not_present',
    ipc_authority: 'not_present',
    provider_dispatch: false,
    model_dispatch: false,
    tool_dispatch: false,
    step_execution: false,
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
    recovery_model: 'read_only_store_projection_replay',
  });
}

function countEntries(list, key) {
  const entries = valueAt(list, key);
  if (!Array.isArray(entries) || utilTypes.isProxy(entries)) {
    fail('builder_agent_step_progress_read_service_invalid');
  }
  return entries.length;
}

function readAgentStepProgress(stores, rawRequest) {
  exactObject(rawRequest, READ_KEYS);
  const request = freezeDeep({
    owner_id: safeOwnerId(valueAt(rawRequest, 'owner_id')),
    project_id: safeProjectId(valueAt(rawRequest, 'project_id')),
    task_id: safeTaskId(valueAt(rawRequest, 'task_id')),
    run_id: safeRunId(valueAt(rawRequest, 'run_id')),
  });
  const stepStarts = stores.step_start_store.list_run_step_starts(request);
  const stepResults = stores.step_result_store.list_run_step_results(request);
  const projection = projectBuilderAgentStepProgress({
    ...request,
    step_starts: stepStarts,
    step_results: stepResults,
  });
  return freezeDeep({
    result_version: BUILDER_AGENT_STEP_PROGRESS_READ_SERVICE_RESULT_VERSION,
    service_version: BUILDER_AGENT_STEP_PROGRESS_READ_SERVICE_VERSION,
    operation: 'agent_step_progress_projected',
    status: projection.progress.items.length === 0 ? 'absent' : 'ready',
    projection,
    read_summary: {
      step_start_status: stepStarts.status,
      step_result_status: stepResults.status,
      step_start_count: countEntries(stepStarts, 'agent_step_starts'),
      step_result_count: countEntries(stepResults, 'agent_step_results'),
      truncated: stepStarts.truncated === true || stepResults.truncated === true,
    },
    evidence: evidence(),
  });
}

function createBuilderAgentStepProgressReadService(rawStores) {
  const stores = safeStores(rawStores);
  return freezeDeep({
    service_version: BUILDER_AGENT_STEP_PROGRESS_READ_SERVICE_VERSION,

    read_agent_step_progress(rawRequest) {
      try { return readAgentStepProgress(stores, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },
  });
}

module.exports = Object.freeze({
  BUILDER_AGENT_STEP_PROGRESS_READ_SERVICE_RESULT_VERSION,
  BUILDER_AGENT_STEP_PROGRESS_READ_SERVICE_VERSION,
  BuilderAgentStepProgressReadServiceError,
  createBuilderAgentStepProgressReadService,
});
