'use strict';

const { types: utilTypes } = require('node:util');

const {
  createBuilderCheckRunAdmission,
  createBuilderCheckRunExecutionApproval,
} = require('./builder-check-run-admission.cjs');
const {
  BUILDER_CHECK_RUN_RUNNER_VERSION,
} = require('./builder-check-run-runner.cjs');
const {
  BUILDER_CHECK_RUN_STATUS_SERVICE_VERSION,
} = require('./builder-check-run-status-service.cjs');
const {
  BUILDER_CHECK_RUN_STORE_VERSION,
} = require('./builder-check-run-store.cjs');
const {
  BUILDER_CHECK_WORKSPACE_MATERIALIZER_VERSION,
} = require('./builder-check-workspace-materializer.cjs');
const {
  BUILDER_PACKAGED_CHECK_RUNTIME_RESOLVER_VERSION,
} = require('./builder-packaged-check-runtime-resolver.cjs');

const BUILDER_CHECK_RUN_MAIN_SERVICE_VERSION = 'builder-check-run-main-service.v1';
const BUILDER_CHECK_RUN_MAIN_RESULT_VERSION = 'builder-check-run-main-result.v1';
const APPROVAL_LIFETIME_MS = 5 * 60 * 1000;
const CREATE_KEYS = Object.freeze([
  'runtime_resolver',
  'workspace_materializer',
  'check_run_runner',
  'check_run_store',
  'check_run_status_service',
  'clock',
]);
const RUN_KEYS = Object.freeze([
  'draft_id',
  'draft_checkpoint_ref',
  'git_candidate_receipt',
  'git_verification_receipt',
  'project_understanding_snapshot',
  'command_profile_id',
  'source_tree',
]);

class BuilderCheckRunMainServiceError extends Error {
  constructor() {
    super('The project check could not be completed.');
    this.name = 'BuilderCheckRunMainServiceError';
    this.code = 'builder_check_run_main_service_failed';
    this.retryable = true;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() { throw new BuilderCheckRunMainServiceError(); }

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
  ) fail();
  return method.value.bind(value);
}

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freezeDeep(nested);
    Object.freeze(value);
  }
  return value;
}

function createBuilderCheckRunMainService(rawOptions) {
  const options = exactObject(rawOptions, CREATE_KEYS);
  const resolver = options.runtime_resolver.value;
  const resolveRuntime = serviceMethod(
    resolver,
    'resolver_version',
    BUILDER_PACKAGED_CHECK_RUNTIME_RESOLVER_VERSION,
    'resolve_npm_runtime',
  );
  const materializer = options.workspace_materializer.value;
  const materializeCandidate = serviceMethod(
    materializer,
    'materializer_version',
    BUILDER_CHECK_WORKSPACE_MATERIALIZER_VERSION,
    'materialize_candidate',
  );
  const cleanupWorkspace = serviceMethod(
    materializer,
    'materializer_version',
    BUILDER_CHECK_WORKSPACE_MATERIALIZER_VERSION,
    'cleanup',
  );
  const runner = options.check_run_runner.value;
  const runCheck = serviceMethod(
    runner,
    'runner_version',
    BUILDER_CHECK_RUN_RUNNER_VERSION,
    'run_check',
  );
  const store = options.check_run_store.value;
  const recordCheckRun = serviceMethod(
    store,
    'store_version',
    BUILDER_CHECK_RUN_STORE_VERSION,
    'record_check_run',
  );
  const statusService = options.check_run_status_service.value;
  const readStatus = serviceMethod(
    statusService,
    'service_version',
    BUILDER_CHECK_RUN_STATUS_SERVICE_VERSION,
    'read_current_check_run_status',
  );
  const clock = options.clock.value;
  const nowMs = serviceMethod(clock, 'clock_version', 'builder-clock.v1', 'now_ms');

  return freezeDeep({
    service_version: BUILDER_CHECK_RUN_MAIN_SERVICE_VERSION,
    async run_approved_check(rawInput) {
      let workspaceAdmission = null;
      try {
        const input = exactObject(rawInput, RUN_KEYS);
        const approvedAtMs = nowMs();
        if (!Number.isSafeInteger(approvedAtMs) || approvedAtMs < 0) fail();
        const runtimeIdentity = resolveRuntime();
        const sharedFacts = {
          draft_id: input.draft_id.value,
          draft_checkpoint_ref: input.draft_checkpoint_ref.value,
          git_candidate_receipt: input.git_candidate_receipt.value,
          git_verification_receipt: input.git_verification_receipt.value,
          project_understanding_snapshot: input.project_understanding_snapshot.value,
          runtime_identity: runtimeIdentity,
        };
        const executionApproval = createBuilderCheckRunExecutionApproval({
          ...sharedFacts,
          command_profile_id: input.command_profile_id.value,
          approved_at_ms: approvedAtMs,
          expires_at_ms: approvedAtMs + APPROVAL_LIFETIME_MS,
        });
        const checkRunAdmission = createBuilderCheckRunAdmission({
          execution_approval: executionApproval,
          draft_checkpoint_ref: sharedFacts.draft_checkpoint_ref,
          git_candidate_receipt: sharedFacts.git_candidate_receipt,
          git_verification_receipt: sharedFacts.git_verification_receipt,
          project_understanding_snapshot: sharedFacts.project_understanding_snapshot,
          runtime_identity: runtimeIdentity,
          admitted_at_ms: approvedAtMs,
        });
        workspaceAdmission = materializeCandidate({
          check_run_admission: checkRunAdmission,
          source_tree: input.source_tree.value,
        });
        const checkRun = await runCheck({
          check_run_admission: checkRunAdmission,
          workspace_admission: workspaceAdmission,
          runtime_identity: runtimeIdentity,
        });
        workspaceAdmission = null;
        recordCheckRun({ check_run: checkRun });
        const statusResult = readStatus({
          project_id: checkRun.project_id,
          candidate_id: checkRun.candidate_id,
        });
        if (
          !isPlainObject(statusResult)
          || !isPlainObject(statusResult.check_run_status_projection)
          || statusResult.check_run_status_projection.check_run_id !== checkRun.check_run_id
        ) fail();
        return freezeDeep({
          result_version: BUILDER_CHECK_RUN_MAIN_RESULT_VERSION,
          operation: 'approved_check_completed',
          check_run_status_projection: statusResult.check_run_status_projection,
        });
      } catch (error) {
        if (workspaceAdmission !== null) {
          try { cleanupWorkspace(workspaceAdmission); } catch { /* fixed failure below */ }
        }
        if (error instanceof BuilderCheckRunMainServiceError) throw error;
        fail();
      }
    },
  });
}

module.exports = freezeDeep({
  BUILDER_CHECK_RUN_MAIN_RESULT_VERSION,
  BUILDER_CHECK_RUN_MAIN_SERVICE_VERSION,
  BuilderCheckRunMainServiceError,
  createBuilderCheckRunMainService,
});
