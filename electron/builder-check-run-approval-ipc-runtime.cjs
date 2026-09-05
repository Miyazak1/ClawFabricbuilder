'use strict';

const { types: utilTypes } = require('node:util');

const {
  APPROVE_CURRENT_DRAFT_CHECK_CHANNEL,
  DECIDE_CURRENT_DRAFT_DEPENDENCY_PREPARATION_CHANNEL,
  DIAGNOSE_CURRENT_DRAFT_CHECK_ENVIRONMENT_CHANNEL,
  DIAGNOSE_PROJECT_ENVIRONMENT_CHANNEL,
  PREPARE_PROJECT_DEPENDENCIES_CHANNEL,
  READ_CURRENT_DRAFT_AVAILABLE_CHECKS_CHANNEL,
  SKIP_CURRENT_DRAFT_CHECK_CHANNEL,
  createBuilderCheckRunApprovalIpcAdapter,
} = require('./builder-check-run-approval-ipc-adapter.cjs');
const {
  BUILDER_CHECK_RUN_CURRENT_DRAFT_SERVICE_VERSION,
} = require('./builder-check-run-current-draft-service.cjs');
const {
  BUILDER_CHECK_SKIP_CURRENT_DRAFT_SERVICE_VERSION,
} = require('./builder-check-skip-current-draft-service.cjs');
const {
  BUILDER_PROJECT_DEPENDENCY_PREPARER_VERSION,
} = require('./builder-project-dependency-preparer.cjs');

const BUILDER_CHECK_RUN_APPROVAL_IPC_RUNTIME_VERSION =
  'builder-check-run-approval-ipc-runtime.v1';
const OPTION_KEYS = Object.freeze([
  'ipcMain',
  'mainWindowRef',
  'currentDraftCheckRunService',
  'currentDraftCheckSkipService',
  'projectEnvironmentDiagnosisService',
  'projectDependencyPreparer',
]);
const SERVICE_KEYS = Object.freeze([
  'service_version',
  'read_available_checks',
  'read_current_candidate_for_main_only',
  'diagnose_check_environment',
  'run_approved_check',
  'decide_dependency_preparation_and_run_check',
]);
const SKIP_SERVICE_KEYS = Object.freeze(['service_version', 'skip_current_draft_check']);
const PROJECT_DIAGNOSIS_SERVICE_KEYS = Object.freeze([
  'service_version',
  'diagnose_project_environment',
]);
const PROJECT_DEPENDENCY_PREPARER_KEYS = Object.freeze([
  'preparer_version',
  'prepare_project_dependencies',
]);

class BuilderCheckRunApprovalIpcRuntimeError extends Error {
  constructor(code = 'builder_check_run_approval_ipc_runtime_unavailable') {
    const selected = code === 'builder_check_run_approval_ipc_runtime_cleanup_required'
      ? code
      : 'builder_check_run_approval_ipc_runtime_unavailable';
    super(selected === 'builder_check_run_approval_ipc_runtime_cleanup_required'
      ? 'Project check cleanup is required.'
      : 'Project checks are unavailable.');
    this.name = 'BuilderCheckRunApprovalIpcRuntimeError';
    this.code = selected;
    this.retryable = selected === 'builder_check_run_approval_ipc_runtime_cleanup_required';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) { throw new BuilderCheckRunApprovalIpcRuntimeError(code); }

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

function stableMethod(value, key) {
  let cursor = value;
  while (cursor !== null) {
    if (utilTypes.isProxy(cursor)) fail();
    const descriptor = Object.getOwnPropertyDescriptor(cursor, key);
    if (descriptor) {
      if (
        !Object.hasOwn(descriptor, 'value')
        || typeof descriptor.value !== 'function'
        || utilTypes.isProxy(descriptor.value)
      ) fail();
      return descriptor.value;
    }
    cursor = Object.getPrototypeOf(cursor);
  }
  fail();
}

function safeService(value) {
  const descriptors = exactObject(value, SERVICE_KEYS);
  if (descriptors.service_version.value !== BUILDER_CHECK_RUN_CURRENT_DRAFT_SERVICE_VERSION) fail();
  for (const key of SERVICE_KEYS) {
    if (key === 'service_version') continue;
    if (typeof descriptors[key].value !== 'function' || utilTypes.isProxy(descriptors[key].value)) {
      fail();
    }
  }
  return value;
}

function safeSkipService(value) {
  const descriptors = exactObject(value, SKIP_SERVICE_KEYS);
  if (descriptors.service_version.value !== BUILDER_CHECK_SKIP_CURRENT_DRAFT_SERVICE_VERSION) fail();
  if (
    typeof descriptors.skip_current_draft_check.value !== 'function'
    || utilTypes.isProxy(descriptors.skip_current_draft_check.value)
  ) fail();
  return value;
}

function safeProjectDiagnosisService(value) {
  const descriptors = exactObject(value, PROJECT_DIAGNOSIS_SERVICE_KEYS);
  if (
    descriptors.service_version.value !== 'builder-project-environment-diagnosis-service.v1'
    || typeof descriptors.diagnose_project_environment.value !== 'function'
    || utilTypes.isProxy(descriptors.diagnose_project_environment.value)
  ) fail();
  return value;
}

function safeProjectDependencyPreparer(value) {
  const descriptors = exactObject(value, PROJECT_DEPENDENCY_PREPARER_KEYS);
  if (
    descriptors.preparer_version.value !== BUILDER_PROJECT_DEPENDENCY_PREPARER_VERSION
    || typeof descriptors.prepare_project_dependencies.value !== 'function'
    || utilTypes.isProxy(descriptors.prepare_project_dependencies.value)
  ) fail();
  return value;
}

function safeOptions(value) {
  const descriptors = exactObject(value, OPTION_KEYS);
  const ipcMain = descriptors.ipcMain.value;
  const mainWindowRef = descriptors.mainWindowRef.value;
  if (
    ipcMain === null
    || typeof ipcMain !== 'object'
    || utilTypes.isProxy(ipcMain)
    || typeof mainWindowRef !== 'function'
    || utilTypes.isProxy(mainWindowRef)
  ) fail();
  return Object.freeze({
    ipcMain,
    handle: stableMethod(ipcMain, 'handle'),
    removeHandler: stableMethod(ipcMain, 'removeHandler'),
    mainWindowRef,
    currentDraftCheckRunService: safeService(descriptors.currentDraftCheckRunService.value),
    currentDraftCheckSkipService: safeSkipService(descriptors.currentDraftCheckSkipService.value),
    projectEnvironmentDiagnosisService:
      safeProjectDiagnosisService(descriptors.projectEnvironmentDiagnosisService.value),
    projectDependencyPreparer:
      safeProjectDependencyPreparer(descriptors.projectDependencyPreparer.value),
  });
}

function createBuilderCheckRunApprovalIpcRuntime(rawOptions) {
  const options = safeOptions(rawOptions);
  const activeReads = new Map();
  const activeDiagnoses = new Map();
  const activeProjectDiagnoses = new Map();
  const activeProjectDependencyPreparations = new Map();
  const activeRuns = new Set();
  const activeSkips = new Set();
  const activeOperations = new Set();
  let shutdownOperation = null;

  function trackOperation(operation) {
    activeOperations.add(operation);
    operation.finally(() => activeOperations.delete(operation)).catch(() => undefined);
    return operation;
  }

  function readAvailableChecks(request) {
    const existing = activeReads.get(request.draft_id);
    if (existing !== undefined) return existing;
    const operation = Promise.resolve().then(() => Reflect.apply(
      options.currentDraftCheckRunService.read_available_checks,
      options.currentDraftCheckRunService,
      [request],
    ));
    activeReads.set(request.draft_id, operation);
    operation.finally(() => {
      if (activeReads.get(request.draft_id) === operation) activeReads.delete(request.draft_id);
    }).catch(() => undefined);
    return trackOperation(operation);
  }

  function diagnosisKey(request) {
    return `${request.draft_id}:${request.command_profile_id}`;
  }

  function diagnoseCheckEnvironment(request) {
    const key = diagnosisKey(request);
    const existing = activeDiagnoses.get(key);
    if (existing !== undefined) return existing;
    const operation = Promise.resolve().then(() => Reflect.apply(
      options.currentDraftCheckRunService.diagnose_check_environment,
      options.currentDraftCheckRunService,
      [request],
    ));
    activeDiagnoses.set(key, operation);
    operation.finally(() => {
      if (activeDiagnoses.get(key) === operation) activeDiagnoses.delete(key);
    }).catch(() => undefined);
    return trackOperation(operation);
  }

  function diagnoseProjectEnvironment(request) {
    const existing = activeProjectDiagnoses.get(request.project_id);
    if (existing !== undefined) return existing;
    const operation = Promise.resolve().then(() => Reflect.apply(
      options.projectEnvironmentDiagnosisService.diagnose_project_environment,
      options.projectEnvironmentDiagnosisService,
      [request],
    ));
    activeProjectDiagnoses.set(request.project_id, operation);
    operation.finally(() => {
      if (activeProjectDiagnoses.get(request.project_id) === operation) {
        activeProjectDiagnoses.delete(request.project_id);
      }
    }).catch(() => undefined);
    return trackOperation(operation);
  }

  function prepareProjectDependencies(request) {
    const existing = activeProjectDependencyPreparations.get(request.project_id);
    if (existing !== undefined) return existing;
    const operation = Promise.resolve().then(() => Reflect.apply(
      options.projectDependencyPreparer.prepare_project_dependencies,
      options.projectDependencyPreparer,
      [request],
    ));
    activeProjectDependencyPreparations.set(request.project_id, operation);
    operation.finally(() => {
      if (activeProjectDependencyPreparations.get(request.project_id) === operation) {
        activeProjectDependencyPreparations.delete(request.project_id);
      }
    }).catch(() => undefined);
    return trackOperation(operation);
  }

  function approveAndRunCheck(request) {
    if (activeRuns.has(request.draft_id)) {
      const error = new Error('A project check is already in progress.');
      error.code = 'builder_check_run_approval_busy';
      return Promise.reject(error);
    }
    activeRuns.add(request.draft_id);
    const operation = Promise.resolve().then(() => Reflect.apply(
        options.currentDraftCheckRunService.run_approved_check,
        options.currentDraftCheckRunService,
        [request],
      )).finally(() => {
      activeRuns.delete(request.draft_id);
    });
    return trackOperation(operation);
  }

  function decideDependencyPreparation(request) {
    if (activeRuns.has(request.draft_id)) {
      const error = new Error('A project check is already in progress.');
      error.code = 'builder_check_run_approval_busy';
      return Promise.reject(error);
    }
    activeRuns.add(request.draft_id);
    const operation = Promise.resolve().then(() => Reflect.apply(
        options.currentDraftCheckRunService.decide_dependency_preparation_and_run_check,
        options.currentDraftCheckRunService,
        [request],
      )).finally(() => {
      activeRuns.delete(request.draft_id);
    });
    return trackOperation(operation);
  }

  function skipCurrentDraftCheck(request) {
    if (activeRuns.has(request.draft_id) || activeSkips.has(request.draft_id)) {
      const error = new Error('A project check activity is already in progress.');
      error.code = 'builder_check_run_approval_busy';
      return Promise.reject(error);
    }
    activeSkips.add(request.draft_id);
    const operation = Promise.resolve().then(() => Reflect.apply(
      options.currentDraftCheckSkipService.skip_current_draft_check,
      options.currentDraftCheckSkipService,
      [request],
    )).finally(() => {
      activeSkips.delete(request.draft_id);
    });
    return trackOperation(operation);
  }

  let adapter;
  try {
    adapter = createBuilderCheckRunApprovalIpcAdapter({
      readCurrentDraftAvailableChecks: readAvailableChecks,
      diagnoseCurrentDraftCheckEnvironment: diagnoseCheckEnvironment,
      diagnoseProjectEnvironment,
      prepareProjectDependencies,
      approveAndRunCurrentDraftCheck: approveAndRunCheck,
      decideCurrentDraftDependencyPreparation: decideDependencyPreparation,
      skipCurrentDraftCheck,
      mainWindowRef: options.mainWindowRef,
    });
  } catch {
    fail();
  }
  const handlers = Object.freeze([
    Object.freeze({
      channel: READ_CURRENT_DRAFT_AVAILABLE_CHECKS_CHANNEL,
      invoke: adapter.channels.readCurrentDraftAvailableChecks.invoke,
    }),
    Object.freeze({
      channel: DIAGNOSE_CURRENT_DRAFT_CHECK_ENVIRONMENT_CHANNEL,
      invoke: adapter.channels.diagnoseCurrentDraftCheckEnvironment.invoke,
    }),
    Object.freeze({
      channel: DIAGNOSE_PROJECT_ENVIRONMENT_CHANNEL,
      invoke: adapter.channels.diagnoseProjectEnvironment.invoke,
    }),
    Object.freeze({
      channel: PREPARE_PROJECT_DEPENDENCIES_CHANNEL,
      invoke: adapter.channels.prepareProjectDependencies.invoke,
    }),
    Object.freeze({
      channel: APPROVE_CURRENT_DRAFT_CHECK_CHANNEL,
      invoke: adapter.channels.approveAndRunCurrentDraftCheck.invoke,
    }),
    Object.freeze({
      channel: DECIDE_CURRENT_DRAFT_DEPENDENCY_PREPARATION_CHANNEL,
      invoke: adapter.channels.decideCurrentDraftDependencyPreparation.invoke,
    }),
    Object.freeze({
      channel: SKIP_CURRENT_DRAFT_CHECK_CHANNEL,
      invoke: adapter.channels.skipCurrentDraftCheck.invoke,
    }),
  ]);
  const installed = [];
  let state = 'idle';

  function removeInstalledHandlers() {
    let failed = false;
    for (const entry of [...installed].reverse()) {
      try {
        Reflect.apply(options.removeHandler, options.ipcMain, [entry.channel]);
        installed.splice(installed.indexOf(entry), 1);
      } catch {
        failed = true;
      }
    }
    return failed === false;
  }

  return Object.freeze({
    runtime_version: BUILDER_CHECK_RUN_APPROVAL_IPC_RUNTIME_VERSION,
    channels: Object.freeze(handlers.map(({ channel }) => channel)),
    register() {
      if (state !== 'idle') fail();
      try {
        for (const entry of handlers) {
          Reflect.apply(options.handle, options.ipcMain, [entry.channel, entry.invoke]);
          installed.push(entry);
        }
        state = 'registered';
        return true;
      } catch {
        state = removeInstalledHandlers() ? 'idle' : 'cleanup_required';
        fail(state === 'cleanup_required'
          ? 'builder_check_run_approval_ipc_runtime_cleanup_required'
          : undefined);
      }
      return false;
    },
    shutdown() {
      if (state === 'disposed') return Promise.resolve(false);
      if (shutdownOperation !== null) return shutdownOperation;
      shutdownOperation = (async () => {
        if (state === 'idle') {
          state = 'disposed';
          return false;
        }
        if (state !== 'draining') {
          if (!removeInstalledHandlers()) {
            state = 'cleanup_required';
            fail('builder_check_run_approval_ipc_runtime_cleanup_required');
          }
          state = 'draining';
        }
        while (activeOperations.size > 0) {
          await Promise.allSettled([...activeOperations]);
        }
        state = 'disposed';
        return true;
      })();
      return shutdownOperation;
    },
    dispose() {
      if (state === 'disposed') return false;
      if (state === 'idle') {
        state = 'disposed';
        return false;
      }
      if (state === 'draining') {
        if (
          activeReads.size > 0
          || activeDiagnoses.size > 0
          || activeProjectDiagnoses.size > 0
          || activeRuns.size > 0
        ) {
          fail('builder_check_run_approval_ipc_runtime_cleanup_required');
        }
        state = 'disposed';
        return true;
      }
      if (!removeInstalledHandlers()) {
        state = 'cleanup_required';
        fail('builder_check_run_approval_ipc_runtime_cleanup_required');
      }
      if (
        activeReads.size > 0
        || activeDiagnoses.size > 0
        || activeProjectDiagnoses.size > 0
        || activeRuns.size > 0
      ) {
        state = 'draining';
        fail('builder_check_run_approval_ipc_runtime_cleanup_required');
      }
      state = 'disposed';
      return true;
    },
  });
}

module.exports = Object.freeze({
  BUILDER_CHECK_RUN_APPROVAL_IPC_RUNTIME_VERSION,
  BuilderCheckRunApprovalIpcRuntimeError,
  createBuilderCheckRunApprovalIpcRuntime,
});
