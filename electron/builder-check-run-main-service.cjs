'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const {
  createBuilderCheckRunAdmission,
  createBuilderCheckRunExecutionApproval,
} = require('./builder-check-run-admission.cjs');
const {
  BUILDER_CHECK_RUN_RUNNER_VERSION,
} = require('./builder-check-run-runner.cjs');
const {
  BUILDER_CHECK_DEPENDENCY_PREPARER_VERSION,
  sanitizeBuilderCheckDependencyPreparationReceipt,
} = require('./builder-check-dependency-preparer.cjs');
const {
  createBuilderCheckRun,
} = require('./builder-check-run.cjs');
const {
  createBuilderEnvironmentReadinessDiagnosis,
} = require('./builder-environment-readiness-diagnosis.cjs');
const {
  BUILDER_CHECK_RUN_ACTIVITY_REGISTRY_VERSION,
} = require('./builder-check-run-activity-registry.cjs');
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
const {
  BUILDER_RUNTIME_TOOLCHAIN_PROBE_SERVICE_VERSION,
} = require('./builder-runtime-toolchain-probe.cjs');
const {
  projectBuilderCheckRunStatus,
} = require('./builder-check-run-status-projection.cjs');
const {
  sanitizeBuilderRuntimeReadinessSnapshot,
} = require('./builder-runtime-readiness-snapshot.cjs');

const BUILDER_CHECK_RUN_MAIN_SERVICE_VERSION = 'builder-check-run-main-service.v1';
const BUILDER_CHECK_RUN_MAIN_RESULT_VERSION = 'builder-check-run-main-result.v1';
const BUILDER_CHECK_RUN_ENVIRONMENT_DIAGNOSIS_RESULT_VERSION =
  'builder-check-run-environment-diagnosis-result.v1';
const PROJECT_WORKSPACE_PATH_SERVICE_VERSION = 'builder-project-workspace-path-service.v1';
const PROJECT_WORKSPACE_PATH_RESULT_KEYS = Object.freeze([
  'result_version',
  'project_id',
  'project_root_path',
  'authority',
]);
const APPROVAL_LIFETIME_MS = 5 * 60 * 1000;
const CREATE_KEYS = Object.freeze([
  'runtime_resolver',
  'workspace_materializer',
  'project_workspace_path_service',
  'check_run_runner',
  'dependency_preparer',
  'toolchain_probe_service',
  'check_run_store',
  'check_run_status_service',
  'activity_registry',
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
const RUN_WITH_DEPENDENCY_PREPARATION_KEYS = Object.freeze([
  ...RUN_KEYS,
  'dependency_preparation_decision',
]);
const DEPENDENCY_PREPARATION_DECISIONS = Object.freeze(['not_requested', 'allow_once', 'deny']);

class BuilderCheckRunMainServiceError extends Error {
  constructor(runtimeCode = 'request_validation', runtimeCauseCode = 'unknown') {
    super('The project check could not be completed.');
    this.name = 'BuilderCheckRunMainServiceError';
    this.code = 'builder_check_run_main_service_failed';
    this.runtime_code = safeDiagnosticCode(runtimeCode);
    this.runtime_cause_code = safeDiagnosticCode(runtimeCauseCode);
    this.retryable = true;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function safeDiagnosticCode(value) {
  return typeof value === 'string' && /^[a-z0-9_]{1,96}$/u.test(value) ? value : 'unknown';
}

function diagnosticProperty(error, key) {
  try {
    if (error === null || (typeof error !== 'object' && typeof error !== 'function')) return 'unknown';
    const descriptor = Object.getOwnPropertyDescriptor(error, key);
    return descriptor && Object.hasOwn(descriptor, 'value')
      ? safeDiagnosticCode(descriptor.value)
      : 'unknown';
  } catch {
    return 'unknown';
  }
}

function fail(runtimeCode, runtimeCauseCode) {
  throw new BuilderCheckRunMainServiceError(runtimeCode, runtimeCauseCode);
}

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

function environmentUnavailableOutputDigest() {
  return `sha256:${nodeCrypto.createHash('sha256')
    .update('builder-check-run:environment-unavailable', 'utf8')
    .digest('hex')}`;
}

function readinessBlocksCheck(readinessSnapshot, runtimeIdentity) {
  if (!isPlainObject(readinessSnapshot)) return false;
  if (
    readinessSnapshot.host_toolchain_state === 'missing'
    && runtimeIdentity.resolution_source !== 'packaged_runtime'
  ) return true;
  if (
    readinessSnapshot.dependency_strategy === 'needs_host_toolchain_admission'
    && runtimeIdentity.resolution_source === 'packaged_runtime'
  ) return false;
  return [
    'needs_prepared_dependency_workspace',
    'needs_install_approval',
    'blocked_by_install_denial',
    'needs_host_toolchain_admission',
  ].includes(readinessSnapshot.dependency_strategy);
}

function environmentReasonForReadiness(readinessSnapshot) {
  if (readinessSnapshot.dependency_strategy === 'needs_prepared_dependency_workspace') {
    return 'dependency_workspace_missing';
  }
  if (readinessSnapshot.dependency_strategy === 'needs_install_approval') {
    return 'install_approval_required';
  }
  if (readinessSnapshot.dependency_strategy === 'blocked_by_install_denial') {
    return 'install_denied';
  }
  if (
    readinessSnapshot.host_toolchain_state === 'missing'
    || readinessSnapshot.dependency_strategy === 'needs_host_toolchain_admission'
  ) return 'host_toolchain_missing';
  return 'environment_unknown';
}

function packageManagerUnavailable(toolchainProbe, packageManager) {
  if (!isPlainObject(toolchainProbe) || toolchainProbe.package_manager !== packageManager) return false;
  if (packageManager === 'npm') {
    return toolchainProbe.node_state !== 'visible'
      || toolchainProbe.package_manager_state !== 'visible';
  }
  return toolchainProbe.package_manager_state !== 'visible';
}

function environmentReasonForPreparationStatus(preparationStatus, toolchainProbe, packageManager) {
  if (preparationStatus === 'timed_out') return 'dependency_preparation_timed_out';
  if (preparationStatus === 'spawn_failed') {
    return packageManagerUnavailable(toolchainProbe, packageManager)
      ? 'package_manager_unavailable'
      : 'dependency_preparation_failed';
  }
  if (preparationStatus === 'failed') return 'dependency_preparation_failed';
  return null;
}

function safeDependencyPreparationDecision(value) {
  if (typeof value !== 'string' || !DEPENDENCY_PREPARATION_DECISIONS.includes(value)) fail();
  return value;
}

function projectRootPathFromResult(rawResult, projectId) {
  const descriptors = exactObject(rawResult, PROJECT_WORKSPACE_PATH_RESULT_KEYS);
  if (
    descriptors.result_version.value !== 'builder-project-workspace-path-result.v1'
    || descriptors.project_id.value !== projectId
    || descriptors.authority.value !== 'main_owned_bound_project_workspace_path'
  ) fail();
  const projectRootPath = descriptors.project_root_path.value;
  if (projectRootPath !== null && typeof projectRootPath !== 'string') fail();
  return projectRootPath;
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
  const readWorkspaceReadinessSnapshot =
    typeof materializer.read_workspace_readiness_snapshot === 'function'
      ? materializer.read_workspace_readiness_snapshot.bind(materializer)
      : null;
  const projectWorkspacePathService = options.project_workspace_path_service.value;
  const resolveProjectWorkspacePath = serviceMethod(
    projectWorkspacePathService,
    'service_version',
    PROJECT_WORKSPACE_PATH_SERVICE_VERSION,
    'resolve_project_workspace_path',
  );
  const runner = options.check_run_runner.value;
  const runCheck = serviceMethod(
    runner,
    'runner_version',
    BUILDER_CHECK_RUN_RUNNER_VERSION,
    'run_check',
  );
  const dependencyPreparer = options.dependency_preparer.value;
  const prepareDependencies = serviceMethod(
    dependencyPreparer,
    'preparer_version',
    BUILDER_CHECK_DEPENDENCY_PREPARER_VERSION,
    'prepare_dependencies',
  );
  const toolchainProbeService = options.toolchain_probe_service.value;
  const probePackageManager = serviceMethod(
    toolchainProbeService,
    'service_version',
    BUILDER_RUNTIME_TOOLCHAIN_PROBE_SERVICE_VERSION,
    'probe_package_manager',
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
  const activityRegistry = options.activity_registry.value;
  const notifyCandidateProjectionChanged = serviceMethod(
    activityRegistry,
    'registry_version',
    BUILDER_CHECK_RUN_ACTIVITY_REGISTRY_VERSION,
    'notify_candidate_projection_changed',
  );
  const clock = options.clock.value;
  const nowMs = serviceMethod(clock, 'clock_version', 'builder-clock.v1', 'now_ms');

  return freezeDeep({
    service_version: BUILDER_CHECK_RUN_MAIN_SERVICE_VERSION,
    async run_approved_check(rawInput) {
      let workspaceAdmission = null;
      let runtimeCode = 'request_validation';
      try {
        const input = exactObject(rawInput,
          isPlainObject(rawInput) && Object.hasOwn(rawInput, 'dependency_preparation_decision')
            ? RUN_WITH_DEPENDENCY_PREPARATION_KEYS
            : RUN_KEYS);
        const dependencyPreparationDecision = Object.hasOwn(input, 'dependency_preparation_decision')
          ? safeDependencyPreparationDecision(input.dependency_preparation_decision.value)
          : 'not_requested';
        runtimeCode = 'runtime_resolution';
        const runtimeIdentity = resolveRuntime();
        const approvedAtMs = nowMs();
        if (!Number.isSafeInteger(approvedAtMs) || approvedAtMs < 0) fail();
        const sharedFacts = {
          draft_id: input.draft_id.value,
          draft_checkpoint_ref: input.draft_checkpoint_ref.value,
          git_candidate_receipt: input.git_candidate_receipt.value,
          git_verification_receipt: input.git_verification_receipt.value,
          project_understanding_snapshot: input.project_understanding_snapshot.value,
          runtime_identity: runtimeIdentity,
        };
        runtimeCode = 'execution_admission';
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
        runtimeCode = 'toolchain_probe';
        const [toolchainProbe, projectRootPath] = await Promise.all([
          probePackageManager({
            package_manager: checkRunAdmission.package_manager,
          }),
          (async () => {
            try {
              return projectRootPathFromResult(
                await resolveProjectWorkspacePath({
                  project_id: checkRunAdmission.project_id,
                }),
                checkRunAdmission.project_id,
              );
            } catch {
              return null;
            }
          })(),
        ]);
        runtimeCode = 'workspace_materialization';
        workspaceAdmission = materializeCandidate({
          check_run_admission: checkRunAdmission,
          source_tree: input.source_tree.value,
        });
        if (readWorkspaceReadinessSnapshot !== null) {
          runtimeCode = 'readiness_snapshot';
          let dependencyPreparationFailureReason = null;
          let readinessSnapshot = sanitizeBuilderRuntimeReadinessSnapshot(
            readWorkspaceReadinessSnapshot({
              check_run_admission: checkRunAdmission,
              workspace_admission: workspaceAdmission,
              project_root_path: projectRootPath,
              host_toolchain_state: 'not_checked',
              toolchain_probe: toolchainProbe,
              install_permission: dependencyPreparationDecision === 'deny'
                ? 'denied'
                : dependencyPreparationDecision === 'allow_once'
                  ? 'approved_once'
                  : 'not_requested',
              updated_at_ms: approvedAtMs,
            }),
          );
          if (
            readinessSnapshot.dependency_strategy === 'needs_prepared_dependency_workspace'
            && dependencyPreparationDecision === 'allow_once'
          ) {
            runtimeCode = 'dependency_preparation';
            let preparationStatus = 'failed';
            try {
              const preparationReceipt = sanitizeBuilderCheckDependencyPreparationReceipt(
                await prepareDependencies({
                  check_run_admission: checkRunAdmission,
                  workspace_admission: workspaceAdmission,
                  package_manager: checkRunAdmission.package_manager,
                }),
              );
              preparationStatus = preparationReceipt.status;
            } catch {
              preparationStatus = 'spawn_failed';
            }
            if (preparationStatus === 'prepared') {
              runtimeCode = 'readiness_snapshot';
              readinessSnapshot = sanitizeBuilderRuntimeReadinessSnapshot(
                readWorkspaceReadinessSnapshot({
                  check_run_admission: checkRunAdmission,
                  workspace_admission: workspaceAdmission,
                  project_root_path: projectRootPath,
                  host_toolchain_state: 'not_checked',
                  toolchain_probe: toolchainProbe,
                  install_permission: 'approved_once',
                  updated_at_ms: nowMs(),
                }),
              );
              if (environmentReasonForReadiness(readinessSnapshot) === 'dependency_workspace_missing') {
                dependencyPreparationFailureReason = 'dependency_preparation_failed';
              }
            } else {
              dependencyPreparationFailureReason = environmentReasonForPreparationStatus(
                preparationStatus,
                toolchainProbe,
                checkRunAdmission.package_manager,
              );
              runtimeCode = 'readiness_snapshot';
            }
          }
          if (readinessBlocksCheck(readinessSnapshot, runtimeIdentity)) {
            const completedAtMs = nowMs();
            if (!Number.isSafeInteger(completedAtMs) || completedAtMs < approvedAtMs) fail();
            const checkRun = createBuilderCheckRun({
              check_run_admission: checkRunAdmission,
              status: 'environment_unavailable',
              exit_code: null,
              output_digest: environmentUnavailableOutputDigest(),
              failure_class: 'environment_unavailable',
              environment_reason: dependencyPreparationFailureReason
                ?? environmentReasonForReadiness(readinessSnapshot),
              started_at_ms: checkRunAdmission.admitted_at_ms,
              completed_at_ms: completedAtMs,
            });
            cleanupWorkspace(workspaceAdmission);
            workspaceAdmission = null;
            runtimeCode = 'check_store';
            recordCheckRun({ check_run: checkRun });
            runtimeCode = 'status_projection';
            const statusResult = readStatus({
              project_id: checkRun.project_id,
              candidate_id: checkRun.candidate_id,
            });
            if (
              !isPlainObject(statusResult)
              || !isPlainObject(statusResult.check_run_status_projection)
              || statusResult.check_run_status_projection.check_run_id !== checkRun.check_run_id
            ) fail();
            const statusProjection = projectBuilderCheckRunStatus({
              check_run: checkRun,
              runtime_readiness_snapshot: readinessSnapshot,
            });
            runtimeCode = 'projection_notification';
            if (notifyCandidateProjectionChanged({
              project_id: checkRun.project_id,
              candidate_id: checkRun.candidate_id,
            }) !== true) fail();
            return freezeDeep({
              result_version: BUILDER_CHECK_RUN_MAIN_RESULT_VERSION,
              operation: 'approved_check_completed',
              check_run_status_projection: statusProjection,
            });
          }
        }
        runtimeCode = 'check_runner';
        const checkRun = await runCheck({
          check_run_admission: checkRunAdmission,
          workspace_admission: workspaceAdmission,
          runtime_identity: runtimeIdentity,
        });
        workspaceAdmission = null;
        runtimeCode = 'check_store';
        recordCheckRun({ check_run: checkRun });
        runtimeCode = 'status_projection';
        const statusResult = readStatus({
          project_id: checkRun.project_id,
          candidate_id: checkRun.candidate_id,
        });
        if (
          !isPlainObject(statusResult)
          || !isPlainObject(statusResult.check_run_status_projection)
          || statusResult.check_run_status_projection.check_run_id !== checkRun.check_run_id
        ) fail();
        runtimeCode = 'projection_notification';
        if (notifyCandidateProjectionChanged({
          project_id: checkRun.project_id,
          candidate_id: checkRun.candidate_id,
        }) !== true) fail();
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
        fail(
          runtimeCode,
          diagnosticProperty(error, 'phase_code') !== 'unknown'
            ? diagnosticProperty(error, 'phase_code')
            : diagnosticProperty(error, 'runtime_code') !== 'unknown'
            ? diagnosticProperty(error, 'runtime_code')
            : diagnosticProperty(error, 'code'),
        );
      }
    },

    async diagnose_check_environment(rawInput) {
      let workspaceAdmission = null;
      let runtimeCode = 'request_validation';
      try {
        const input = exactObject(rawInput, RUN_KEYS);
        runtimeCode = 'runtime_resolution';
        const runtimeIdentity = resolveRuntime();
        const diagnosedAtMs = nowMs();
        if (!Number.isSafeInteger(diagnosedAtMs) || diagnosedAtMs < 0) fail();
        const sharedFacts = {
          draft_id: input.draft_id.value,
          draft_checkpoint_ref: input.draft_checkpoint_ref.value,
          git_candidate_receipt: input.git_candidate_receipt.value,
          git_verification_receipt: input.git_verification_receipt.value,
          project_understanding_snapshot: input.project_understanding_snapshot.value,
          runtime_identity: runtimeIdentity,
        };
        runtimeCode = 'diagnosis_admission';
        const executionApproval = createBuilderCheckRunExecutionApproval({
          ...sharedFacts,
          command_profile_id: input.command_profile_id.value,
          approved_at_ms: diagnosedAtMs,
          expires_at_ms: diagnosedAtMs + APPROVAL_LIFETIME_MS,
        });
        const checkRunAdmission = createBuilderCheckRunAdmission({
          execution_approval: executionApproval,
          draft_checkpoint_ref: sharedFacts.draft_checkpoint_ref,
          git_candidate_receipt: sharedFacts.git_candidate_receipt,
          git_verification_receipt: sharedFacts.git_verification_receipt,
          project_understanding_snapshot: sharedFacts.project_understanding_snapshot,
          runtime_identity: runtimeIdentity,
          admitted_at_ms: diagnosedAtMs,
        });
        runtimeCode = 'toolchain_probe';
        const [toolchainProbe, projectRootPath] = await Promise.all([
          probePackageManager({
            package_manager: checkRunAdmission.package_manager,
          }),
          (async () => {
            try {
              return projectRootPathFromResult(
                await resolveProjectWorkspacePath({
                  project_id: checkRunAdmission.project_id,
                }),
                checkRunAdmission.project_id,
              );
            } catch {
              return null;
            }
          })(),
        ]);
        if (readWorkspaceReadinessSnapshot === null) fail('readiness_snapshot');
        runtimeCode = 'workspace_materialization';
        workspaceAdmission = materializeCandidate({
          check_run_admission: checkRunAdmission,
          source_tree: input.source_tree.value,
        });
        runtimeCode = 'readiness_snapshot';
        const readinessSnapshot = sanitizeBuilderRuntimeReadinessSnapshot(
          readWorkspaceReadinessSnapshot({
            check_run_admission: checkRunAdmission,
            workspace_admission: workspaceAdmission,
            project_root_path: projectRootPath,
            host_toolchain_state: 'not_checked',
            toolchain_probe: toolchainProbe,
            install_permission: 'not_requested',
            updated_at_ms: diagnosedAtMs,
          }),
        );
        runtimeCode = 'environment_diagnosis';
        const environmentDiagnosis = createBuilderEnvironmentReadinessDiagnosis({
          check_run_admission: checkRunAdmission,
          runtime_readiness_snapshot: readinessSnapshot,
          diagnosed_at_ms: diagnosedAtMs,
        });
        cleanupWorkspace(workspaceAdmission);
        workspaceAdmission = null;
        return freezeDeep({
          result_version: BUILDER_CHECK_RUN_ENVIRONMENT_DIAGNOSIS_RESULT_VERSION,
          operation: 'check_environment_diagnosed',
          environment_diagnosis: environmentDiagnosis,
        });
      } catch (error) {
        if (workspaceAdmission !== null) {
          try { cleanupWorkspace(workspaceAdmission); } catch { /* fixed failure below */ }
        }
        if (error instanceof BuilderCheckRunMainServiceError) throw error;
        fail(
          runtimeCode,
          diagnosticProperty(error, 'phase_code') !== 'unknown'
            ? diagnosticProperty(error, 'phase_code')
            : diagnosticProperty(error, 'runtime_code') !== 'unknown'
            ? diagnosticProperty(error, 'runtime_code')
            : diagnosticProperty(error, 'code'),
        );
      }
    },
  });
}

module.exports = freezeDeep({
  BUILDER_CHECK_RUN_ENVIRONMENT_DIAGNOSIS_RESULT_VERSION,
  BUILDER_CHECK_RUN_MAIN_RESULT_VERSION,
  BUILDER_CHECK_RUN_MAIN_SERVICE_VERSION,
  BuilderCheckRunMainServiceError,
  createBuilderCheckRunMainService,
});
