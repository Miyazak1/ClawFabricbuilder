'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { types: utilTypes } = require('node:util');

const {
  createBuilderCheckRunCurrentDraftService,
} = require('./builder-check-run-current-draft-service.cjs');
const {
  createBuilderCheckDependencyPreparer,
} = require('./builder-check-dependency-preparer.cjs');
const {
  createBuilderCodingLoopCheckCoordinator,
} = require('./builder-coding-loop-check-coordinator.cjs');
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
  createBuilderDependencyEnvironmentStore,
} = require('./builder-dependency-environment-store.cjs');
const {
  createBuilderPackagedCheckRuntimeResolver,
} = require('./builder-packaged-check-runtime-resolver.cjs');
const {
  createBuilderRuntimeToolchainProbe,
} = require('./builder-runtime-toolchain-probe.cjs');

const BUILDER_CHECK_RUN_RUNTIME_COMPOSITION_VERSION =
  'builder-check-run-runtime-composition.v1';
const CHECK_WORKSPACE_DIRECTORY = 'builder-check-workspaces-v1';
const DEPENDENCY_ENVIRONMENT_DIRECTORY = 'builder-check-dependency-environments-v1';
const CREATE_KEYS = Object.freeze([
  'user_data_path',
  'launcher_path',
  'worker_path',
  'process_adapter',
  'toolchain_probe_spawn_process',
  'dependency_prepare_spawn_process',
  'project_workspace_path_service',
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

function functionValue(value) {
  if (typeof value !== 'function' || utilTypes.isProxy(value)) fail();
  return value;
}

function terminateToolchainProbeProcessTree(rawRequest) {
  const child = rawRequest?.child;
  if (child === null || typeof child !== 'object' || typeof child.kill !== 'function') {
    return false;
  }
  try {
    return child.kill() === true;
  } catch {
    return false;
  }
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
    const toolchainProbeSpawnProcess = functionValue(options.toolchain_probe_spawn_process.value);
    const dependencyPrepareSpawnProcess = functionValue(options.dependency_prepare_spawn_process.value);
    const clock = options.clock.value;
    serviceMethod(clock, 'clock_version', 'builder-clock.v1', 'now_ms');
    serviceMethod(clock, 'clock_version', 'builder-clock.v1', 'set_timeout');
    serviceMethod(clock, 'clock_version', 'builder-clock.v1', 'clear_timeout');
    const checksRoot = path.join(userDataPath, CHECK_WORKSPACE_DIRECTORY);
    fs.mkdirSync(checksRoot, { recursive: true, mode: 0o700 });
    const dependencyEnvironmentRoot = path.join(userDataPath, DEPENDENCY_ENVIRONMENT_DIRECTORY);
    const runtimeRegistry = createBuilderCheckRuntimeRegistry();
    const runtimeResolver = createBuilderPackagedCheckRuntimeResolver({
      runtime_registry: runtimeRegistry,
      launcher_path: launcherPath,
      worker_path: workerPath,
      clock,
    });
    const dependencyEnvironmentStore = createBuilderDependencyEnvironmentStore({
      environment_root: dependencyEnvironmentRoot,
    });
    const workspaceMaterializer = createBuilderCheckWorkspaceMaterializer({
      checks_root: checksRoot,
      dependency_environment_store: dependencyEnvironmentStore,
    });
    const toolchainProbeService = createBuilderRuntimeToolchainProbe({
      spawn_process: toolchainProbeSpawnProcess,
      terminate_process_tree: terminateToolchainProbeProcessTree,
      clock,
    });
    const dependencyPreparer = createBuilderCheckDependencyPreparer({
      spawn_process: dependencyPrepareSpawnProcess,
      terminate_process_tree: terminateToolchainProbeProcessTree,
      workspace_materializer: workspaceMaterializer,
      clock,
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
      dependency_preparer: dependencyPreparer,
      toolchain_probe_service: toolchainProbeService,
      project_workspace_path_service: options.project_workspace_path_service.value,
      check_run_store: options.check_run_store.value,
      check_run_status_service: options.check_run_status_service.value,
      activity_registry: options.activity_registry.value,
      clock,
    });
    const currentDraftService = createBuilderCheckRunCurrentDraftService({
      conversation_service: options.conversation_service.value,
      git_authority: options.git_authority.value,
      automatic_draft_checkpoint_service: options.automatic_draft_checkpoint_service.value,
      check_run_main_service: checkRunMainService,
      clock,
    });
    const codingLoopCheckCoordinator = createBuilderCodingLoopCheckCoordinator({
      automatic_draft_checkpoint_service: options.automatic_draft_checkpoint_service.value,
      check_run_main_service: checkRunMainService,
      check_skip_decision_store: options.check_skip_decision_store.value,
      activity_registry: options.activity_registry.value,
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
      coding_loop_check_coordinator: codingLoopCheckCoordinator,
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
  DEPENDENCY_ENVIRONMENT_DIRECTORY,
  BuilderCheckRunRuntimeCompositionError,
  createBuilderCheckRunRuntimeComposition,
});
