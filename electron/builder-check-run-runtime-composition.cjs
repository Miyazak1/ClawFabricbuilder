'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { types: utilTypes } = require('node:util');

const {
  createBuilderCheckRunCurrentDraftService,
} = require('./builder-check-run-current-draft-service.cjs');
const {
  createBuilderCheckSkipCurrentDraftService,
} = require('./builder-check-skip-current-draft-service.cjs');
const {
  createBuilderCheckRunMainService,
} = require('./builder-check-run-main-service.cjs');
const {
  BUILDER_CHECK_RUN_PROCESS_ADAPTER_VERSION,
} = require('./builder-check-run-process-adapter.cjs');
const {
  createBuilderCheckRunRunner,
} = require('./builder-check-run-runner.cjs');
const {
  createBuilderCheckRuntimeRegistry,
} = require('./builder-check-runtime-identity.cjs');
const {
  createBuilderCheckWorkspaceMaterializer,
} = require('./builder-check-workspace-materializer.cjs');
const {
  createBuilderPackagedCheckRuntimeResolver,
} = require('./builder-packaged-check-runtime-resolver.cjs');

const BUILDER_CHECK_RUN_RUNTIME_COMPOSITION_VERSION =
  'builder-check-run-runtime-composition.v1';
const CHECK_WORKSPACE_DIRECTORY = 'builder-check-workspaces-v1';
const CREATE_KEYS = Object.freeze([
  'user_data_path',
  'launcher_path',
  'worker_path',
  'process_adapter',
  'clock',
  'conversation_service',
  'git_authority',
  'automatic_draft_checkpoint_service',
  'check_run_store',
  'check_run_status_service',
  'check_skip_decision_store',
  'activity_registry',
]);

class BuilderCheckRunRuntimeCompositionError extends Error {
  constructor() {
    super('The project check runtime could not be created.');
    this.name = 'BuilderCheckRunRuntimeCompositionError';
    this.code = 'builder_check_run_runtime_composition_failed';
    this.retryable = false;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() { throw new BuilderCheckRunRuntimeCompositionError(); }

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || utilTypes.isProxy(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactObject(value, keys) {
  if (!isPlainObject(value)) fail();
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== keys.length || ownKeys.some(
    (key) => typeof key !== 'string' || !keys.includes(key),
  )) fail();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  }
  return descriptors;
}

function safeAbsolutePath(value) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > 1_024
    || value.includes('\0')
    || !path.isAbsolute(value)
    || path.normalize(value) !== value
  ) fail();
  return value;
}

function serviceMethod(value, versionKey, expectedVersion, methodKey) {
  if (!isPlainObject(value)) fail();
  const version = Object.getOwnPropertyDescriptor(value, versionKey);
  const method = Object.getOwnPropertyDescriptor(value, methodKey);
  if (
    !version
    || !Object.hasOwn(version, 'value')
    || version.value !== expectedVersion
    || !method
    || !Object.hasOwn(method, 'value')
    || typeof method.value !== 'function'
    || utilTypes.isProxy(method.value)
  ) fail();
  return method.value;
}

function createBuilderCheckRunRuntimeComposition(rawOptions) {
  try {
    const options = exactObject(rawOptions, CREATE_KEYS);
    const userDataPath = safeAbsolutePath(options.user_data_path.value);
    const launcherPath = safeAbsolutePath(options.launcher_path.value);
    const workerPath = safeAbsolutePath(options.worker_path.value);
    const processAdapter = options.process_adapter.value;
    const spawnProcess = serviceMethod(
      processAdapter,
      'adapter_version',
      BUILDER_CHECK_RUN_PROCESS_ADAPTER_VERSION,
      'spawn_process',
    );
    const terminateProcessTree = serviceMethod(
      processAdapter,
      'adapter_version',
      BUILDER_CHECK_RUN_PROCESS_ADAPTER_VERSION,
      'terminate_process_tree',
    );
    const clock = options.clock.value;
    serviceMethod(clock, 'clock_version', 'builder-clock.v1', 'now_ms');
    serviceMethod(clock, 'clock_version', 'builder-clock.v1', 'set_timeout');
    serviceMethod(clock, 'clock_version', 'builder-clock.v1', 'clear_timeout');
    const checksRoot = path.join(userDataPath, CHECK_WORKSPACE_DIRECTORY);
    fs.mkdirSync(checksRoot, { recursive: true, mode: 0o700 });
    const runtimeRegistry = createBuilderCheckRuntimeRegistry();
    const runtimeResolver = createBuilderPackagedCheckRuntimeResolver({
      runtime_registry: runtimeRegistry,
      launcher_path: launcherPath,
      worker_path: workerPath,
      clock,
    });
    const workspaceMaterializer = createBuilderCheckWorkspaceMaterializer({
      checks_root: checksRoot,
    });
    const checkRunRunner = createBuilderCheckRunRunner({
      spawn_process: spawnProcess,
      clock,
      workspace_materializer: workspaceMaterializer,
      runtime_registry: runtimeRegistry,
      activity_registry: options.activity_registry.value,
      terminate_process_tree: terminateProcessTree,
    });
    const checkRunMainService = createBuilderCheckRunMainService({
      runtime_resolver: runtimeResolver,
      workspace_materializer: workspaceMaterializer,
      check_run_runner: checkRunRunner,
      check_run_store: options.check_run_store.value,
      check_run_status_service: options.check_run_status_service.value,
      clock,
    });
    const currentDraftService = createBuilderCheckRunCurrentDraftService({
      conversation_service: options.conversation_service.value,
      git_authority: options.git_authority.value,
      automatic_draft_checkpoint_service: options.automatic_draft_checkpoint_service.value,
      check_run_main_service: checkRunMainService,
      clock,
    });
    const currentDraftSkipService = createBuilderCheckSkipCurrentDraftService({
      current_draft_check_run_service: currentDraftService,
      check_run_store: options.check_run_store.value,
      check_skip_decision_store: options.check_skip_decision_store.value,
      activity_registry: options.activity_registry.value,
      clock,
    });
    return Object.freeze({
      composition_version: BUILDER_CHECK_RUN_RUNTIME_COMPOSITION_VERSION,
      current_draft_service: currentDraftService,
      current_draft_skip_service: currentDraftSkipService,
    });
  } catch (error) {
    if (error instanceof BuilderCheckRunRuntimeCompositionError) throw error;
    fail();
  }
}

module.exports = Object.freeze({
  BUILDER_CHECK_RUN_RUNTIME_COMPOSITION_VERSION,
  CHECK_WORKSPACE_DIRECTORY,
  BuilderCheckRunRuntimeCompositionError,
  createBuilderCheckRunRuntimeComposition,
});
