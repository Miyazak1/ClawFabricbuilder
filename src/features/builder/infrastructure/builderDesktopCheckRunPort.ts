import type {
  BuilderCheckRunAvailableResult,
  BuilderCheckRunApproveRequest,
  BuilderCheckRunCommandKind,
  BuilderCheckRunCompletedResult,
  BuilderCheckRunDependencyPreparationRequest,
  BuilderCheckRunEnvironmentDiagnosis,
  BuilderCheckRunEnvironmentDiagnosisResult,
  BuilderCheckRunPort,
  BuilderCheckRunProfile,
  BuilderCheckRunReadRequest,
  BuilderCheckRunStatusProjection,
  BuilderCheckRunSkippedResult,
  BuilderProjectEnvironmentDiagnosis,
  BuilderProjectEnvironmentDiagnosisResult,
} from '../application/builderPorts';

type BuilderCheckRunBridge = Readonly<{
  readCurrentDraftAvailableChecks(request: unknown): Promise<unknown>;
  diagnoseCurrentDraftCheckEnvironment(request: unknown): Promise<unknown>;
  diagnoseProjectEnvironment(request: unknown): Promise<unknown>;
  approveAndRunCurrentDraftCheck(request: unknown): Promise<unknown>;
  decideCurrentDraftDependencyPreparation(request: unknown): Promise<unknown>;
  skipCurrentDraftCheck(request: unknown): Promise<unknown>;
}>;

const BRIDGE_KEYS = Object.freeze([
  'readCurrentDraftAvailableChecks',
  'diagnoseCurrentDraftCheckEnvironment',
  'diagnoseProjectEnvironment',
  'approveAndRunCurrentDraftCheck',
  'decideCurrentDraftDependencyPreparation',
  'skipCurrentDraftCheck',
]);
const READ_REQUEST_KEYS = Object.freeze(['draft_id']);
const PROJECT_DIAGNOSIS_REQUEST_KEYS = Object.freeze(['project_id']);
const RUN_REQUEST_KEYS = Object.freeze(['draft_id', 'command_profile_id']);
const DEPENDENCY_PREPARATION_REQUEST_KEYS = Object.freeze([
  'draft_id',
  'command_profile_id',
  'decision',
]);
const READ_RESULT_KEYS = Object.freeze([
  'result_version', 'service_version', 'operation', 'status', 'draft_id',
  'project_id', 'candidate_id', 'available_checks',
]);
const RUN_RESULT_KEYS = Object.freeze([
  'result_version', 'service_version', 'operation', 'draft_id', 'project_id',
  'candidate_id', 'check_run_status_projection',
]);
const DIAGNOSIS_RESULT_KEYS = Object.freeze([
  'result_version', 'service_version', 'operation', 'draft_id', 'project_id',
  'candidate_id', 'environment_diagnosis',
]);
const PROJECT_DIAGNOSIS_RESULT_KEYS = Object.freeze([
  'result_version', 'service_version', 'operation', 'project_id', 'environment_diagnosis',
]);
const PROJECT_DIAGNOSIS_KEYS = Object.freeze([
  'diagnosis_version', 'diagnosis_id', 'project_id', 'source_tree_digest',
  'package_manager', 'package_manifest', 'dependency_manifest', 'lockfile',
  'project_dependency_state', 'toolchains', 'readiness_state', 'primary_action',
  'safe_summary', 'authority', 'diagnosed_at_ms', 'diagnosis_digest',
]);
const PROJECT_DIAGNOSIS_TOOLCHAIN_NAMES = Object.freeze(['node', 'npm', 'pnpm', 'yarn', 'git']);
const PROJECT_DIAGNOSIS_TOOLCHAIN_KEYS = Object.freeze(['state', 'version']);
const PROJECT_DIAGNOSIS_AUTHORITY_KEYS = Object.freeze([
  'diagnosis_authority', 'source_authority', 'toolchain_probe_authority',
  'renderer_authority', 'browser_preview_authority', 'provider_dispatch',
  'harness_dispatch', 'command_execution', 'dependency_preparation',
  'project_workspace_write', 'check_workspace_write', 'git_write', 'sqlite_write',
  'save_authority', 'path_disclosure', 'environment_variable_disclosure',
  'raw_output', 'secret_access', 'network_access',
]);
const DIAGNOSIS_KEYS = Object.freeze([
  'diagnosis_version', 'diagnosis_id', 'project_id', 'candidate_id',
  'source_tree_digest', 'command_profile_id', 'command_kind', 'command_display',
  'package_manager', 'package_manifest', 'dependency_manifest', 'lockfile',
  'project_dependency_state', 'check_workspace_dependency_state',
  'host_toolchain_state', 'host_node_version', 'host_package_manager_version',
  'install_permission', 'dependency_strategy', 'readiness_state', 'primary_action',
  'safe_summary', 'authority', 'diagnosed_at_ms', 'diagnosis_digest',
]);
const DIAGNOSIS_AUTHORITY_KEYS = Object.freeze([
  'diagnosis_authority', 'readiness_authority', 'renderer_authority',
  'browser_preview_authority', 'provider_dispatch', 'harness_dispatch',
  'command_execution', 'dependency_preparation', 'project_workspace_write',
  'check_workspace_write', 'git_write', 'sqlite_write', 'save_authority',
  'path_disclosure', 'environment_variable_disclosure', 'raw_output',
  'secret_access', 'network_access',
]);
const SKIP_RESULT_KEYS = Object.freeze([
  'result_version', 'operation', 'draft_id', 'project_id', 'candidate_id', 'status',
]);
const PROFILE_KEYS = Object.freeze([
  'command_profile_id', 'command_kind', 'command_display', 'requires_user_approval',
]);
const PROJECTION_KEYS = Object.freeze([
  'projection_version', 'project_id', 'candidate_id', 'check_run_id', 'command_kind',
  'command_label', 'status', 'label', 'summary', 'environment_reason',
  'completed_at_ms', 'result_digest', 'authority',
]);
const AUTHORITY_KEYS = Object.freeze([
  'projection_authority', 'check_run_authority', 'renderer_authority', 'ipc_authority',
  'raw_output', 'runtime_paths', 'provider_dispatch', 'command_execution', 'source_write',
  'git_write', 'sqlite_write', 'save_authority',
]);
const DRAFT_ID_PATTERN = /^builder-generation-draft:[0-9a-f]{64}$/u;
const PROFILE_ID_PATTERN = /^builder-command-profile:[0-9a-f]{32}$/u;
const PROJECT_ID_PATTERN =
  /^builder-project:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CANDIDATE_ID_PATTERN = /^builder-code-change-candidate:[0-9a-f]{64}$/u;
const CHECK_RUN_ID_PATTERN = /^builder-check-run:[0-9a-f]{64}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const DIAGNOSIS_ID_PATTERN = /^builder-environment-readiness-diagnosis:[0-9a-f]{64}$/u;
const VERSION_PATTERN = /^(?:unknown|[vV]?[0-9][0-9A-Za-z.+_-]{0,63})$/u;
const COMMANDS = Object.freeze({
  lint: { displays: ['npm run lint', 'pnpm run lint', 'yarn lint', 'bun run lint'], label: 'Lint' },
  typecheck: {
    displays: ['npm run typecheck', 'pnpm run typecheck', 'yarn typecheck', 'bun run typecheck'],
    label: 'Type check',
  },
  test: { displays: ['npm test', 'pnpm test', 'yarn test', 'bun run test'], label: 'Tests' },
  build: { displays: ['npm run build', 'pnpm run build', 'yarn build', 'bun run build'], label: 'Build' },
});
const STATUS_TUPLES = new Set([
  JSON.stringify(['passed', 'Checked', 'The project check completed successfully.']),
  JSON.stringify(['failed', 'Check failed', 'The project check found a problem that needs review.']),
  JSON.stringify(['failed', 'Check failed', 'The project check produced too much output to review safely.']),
  JSON.stringify(['incomplete', 'Check incomplete', 'The project check reached its time limit.']),
  JSON.stringify(['incomplete', 'Check incomplete', 'The project check was cancelled.']),
  JSON.stringify(['incomplete', 'Check unavailable', 'The admitted check workspace needs prepared dependencies or local toolchain access before this check can run.']),
  JSON.stringify(['incomplete', 'Check unavailable', 'This draft declares project dependencies, but the isolated check workspace has not prepared them yet.']),
  JSON.stringify(['incomplete', 'Check unavailable', 'This check needs explicit dependency preparation approval before it can run.']),
  JSON.stringify(['incomplete', 'Check unavailable', 'Dependency preparation was denied, so Builder could not run this check.']),
  JSON.stringify(['incomplete', 'Check unavailable', 'Dependency preparation failed in the isolated check workspace. You can retry preparation for this check.']),
  JSON.stringify(['incomplete', 'Check unavailable', 'Dependency preparation reached the time limit in the isolated check workspace. You can retry preparation for this check.']),
  JSON.stringify(['incomplete', 'Check unavailable', 'Builder could not start the package manager needed to prepare check dependencies.']),
  JSON.stringify(['incomplete', 'Check unavailable', 'Builder cannot see the local Node/package-manager toolchain required for this check.']),
  JSON.stringify(['incomplete', 'Check unavailable', 'The project check could not be started.']),
  JSON.stringify(['incomplete', 'Check needs attention', 'Builder could not confirm that the project check stopped.']),
]);
const ENVIRONMENT_REASONS = new Set([
  'none',
  'dependency_workspace_missing',
  'install_approval_required',
  'install_denied',
  'dependency_preparation_failed',
  'dependency_preparation_timed_out',
  'package_manager_unavailable',
  'host_toolchain_missing',
  'environment_unknown',
]);
const DEPENDENCY_PREPARATION_DECISIONS = new Set(['allow_once', 'deny']);
const PACKAGE_MANAGERS = new Set(['npm', 'pnpm', 'yarn', 'bun']);
const PROJECT_PACKAGE_MANAGERS = new Set(['npm', 'pnpm', 'yarn', 'bun', 'none']);
const MANIFEST_STATES = new Set(['absent', 'present', 'unreadable']);
const LOCKFILES = new Set([
  'none',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
]);
const PROJECT_DEPENDENCY_STATES = new Set([
  'not_applicable',
  'not_admitted',
  'unknown',
  'install_present',
  'install_missing',
  'unavailable',
]);
const CHECK_WORKSPACE_DEPENDENCY_STATES = new Set([
  'not_applicable',
  'not_materialized',
  'install_present',
  'install_missing',
  'unavailable',
]);
const HOST_TOOLCHAIN_STATES = new Set(['not_checked', 'visible', 'missing', 'not_admitted']);
const INSTALL_PERMISSIONS = new Set(['not_requested', 'required', 'denied', 'approved_once']);
const DEPENDENCY_STRATEGIES = new Set([
  'no_execution_needed',
  'can_run_without_install',
  'needs_host_toolchain_admission',
  'needs_install_approval',
  'needs_prepared_dependency_workspace',
  'blocked_by_install_denial',
  'unknown',
]);
const READINESS_STATES = new Set([
  'ready',
  'host_toolchain_missing',
  'dependencies_not_prepared',
  'install_approval_required',
  'install_denied',
  'unknown',
]);
const PRIMARY_ACTIONS = new Set([
  'run_check',
  'prepare_once',
  'show_missing_toolchain',
  'show_diagnostics',
  'none',
]);
const PROJECT_READINESS_STATES = new Set([
  'ready',
  'host_toolchain_missing',
  'project_dependencies_missing',
  'unknown',
]);
const PROJECT_PRIMARY_ACTIONS = new Set([
  'none',
  'show_missing_toolchain',
  'show_project_dependency_setup',
  'show_diagnostics',
]);
const DIAGNOSIS_SUMMARIES = Object.freeze({
  ready: 'The selected check environment is ready.',
  host_toolchain_missing: 'Builder cannot see the local toolchain required for this check.',
  dependencies_not_prepared:
    'The isolated check workspace has not prepared this draft\'s dependencies yet.',
  install_approval_required:
    'This check needs one-time approval before Builder can prepare dependencies.',
  install_denied: 'Dependency preparation was denied for this check.',
  unknown: 'Builder could not determine whether this check environment is ready.',
});
const DIAGNOSIS_PRIMARY_ACTIONS = Object.freeze({
  ready: 'run_check',
  host_toolchain_missing: 'show_missing_toolchain',
  dependencies_not_prepared: 'prepare_once',
  install_approval_required: 'prepare_once',
  install_denied: 'none',
  unknown: 'show_diagnostics',
});
const PROJECT_DIAGNOSIS_SUMMARIES = Object.freeze({
  ready: 'The project environment appears ready.',
  host_toolchain_missing: 'Builder cannot see the local toolchain required by this project.',
  project_dependencies_missing:
    'This project declares dependencies, but the project folder does not have installed dependencies.',
  unknown: 'Builder could not determine whether this project environment is ready.',
});
const PROJECT_DIAGNOSIS_PRIMARY_ACTIONS = Object.freeze({
  ready: 'none',
  host_toolchain_missing: 'show_missing_toolchain',
  project_dependencies_missing: 'show_project_dependency_setup',
  unknown: 'show_diagnostics',
});
const PORT_ERROR_MESSAGES = Object.freeze({
  builder_check_run_unavailable: 'Project checks are unavailable.',
  builder_check_run_approval_busy: 'A project check is already in progress.',
  builder_check_run_approval_invalid: 'The project check request could not be verified.',
  builder_check_run_approval_forbidden: 'Project checks are unavailable.',
  builder_check_run_current_draft_failed: 'The draft changed before the project check could start.',
});
type BuilderDesktopCheckRunPortErrorCode = keyof typeof PORT_ERROR_MESSAGES;

export class BuilderDesktopCheckRunPortError extends Error {
  readonly code: BuilderDesktopCheckRunPortErrorCode;

  constructor(code: BuilderDesktopCheckRunPortErrorCode = 'builder_check_run_unavailable') {
    const selected = Object.hasOwn(PORT_ERROR_MESSAGES, code)
      ? code
      : 'builder_check_run_unavailable';
    super(PORT_ERROR_MESSAGES[selected]);
    this.name = 'BuilderDesktopCheckRunPortError';
    this.code = selected;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function safeErrorCode(error: unknown): BuilderDesktopCheckRunPortErrorCode {
  try {
    if (error === null || (typeof error !== 'object' && typeof error !== 'function')) {
      return 'builder_check_run_unavailable';
    }
    const descriptor = Object.getOwnPropertyDescriptor(error, 'code');
    if (
      descriptor
      && Object.hasOwn(descriptor, 'value')
      && typeof descriptor.value === 'string'
      && Object.hasOwn(PORT_ERROR_MESSAGES, descriptor.value)
    ) {
      return descriptor.value as BuilderDesktopCheckRunPortErrorCode;
    }
  } catch {
    return 'builder_check_run_unavailable';
  }
  return 'builder_check_run_unavailable';
}

function unavailable(code: BuilderDesktopCheckRunPortErrorCode = 'builder_check_run_unavailable'):
BuilderDesktopCheckRunPortError {
  return new BuilderDesktopCheckRunPortError(code);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactRecord(value: unknown, keys: readonly string[]): Readonly<Record<string, unknown>> {
  if (!isPlainObject(value)) throw unavailable();
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== keys.length || ownKeys.some(
    (key) => typeof key !== 'string' || !keys.includes(key),
  )) throw unavailable();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      throw unavailable();
    }
  }
  return Object.freeze(Object.fromEntries(keys.map((key) => [key, descriptors[key].value])));
}

function sanitizeBridge(value: unknown): BuilderCheckRunBridge {
  const source = exactRecord(value, BRIDGE_KEYS);
  if (
    typeof source.readCurrentDraftAvailableChecks !== 'function'
    || typeof source.diagnoseProjectEnvironment !== 'function'
    || typeof source.approveAndRunCurrentDraftCheck !== 'function'
    || typeof source.decideCurrentDraftDependencyPreparation !== 'function'
    || typeof source.skipCurrentDraftCheck !== 'function'
  ) throw unavailable();
  return Object.freeze({
    readCurrentDraftAvailableChecks: source.readCurrentDraftAvailableChecks as (request: unknown) => Promise<unknown>,
    diagnoseCurrentDraftCheckEnvironment:
      source.diagnoseCurrentDraftCheckEnvironment as (request: unknown) => Promise<unknown>,
    diagnoseProjectEnvironment:
      source.diagnoseProjectEnvironment as (request: unknown) => Promise<unknown>,
    approveAndRunCurrentDraftCheck: source.approveAndRunCurrentDraftCheck as (request: unknown) => Promise<unknown>,
    decideCurrentDraftDependencyPreparation:
      source.decideCurrentDraftDependencyPreparation as (request: unknown) => Promise<unknown>,
    skipCurrentDraftCheck: source.skipCurrentDraftCheck as (request: unknown) => Promise<unknown>,
  });
}

function readRequest(value: unknown) {
  const source = exactRecord(value, READ_REQUEST_KEYS);
  if (typeof source.draft_id !== 'string' || !DRAFT_ID_PATTERN.test(source.draft_id)) {
    throw unavailable();
  }
  return Object.freeze({ draft_id: source.draft_id });
}

function projectDiagnosisRequest(value: unknown) {
  const source = exactRecord(value, PROJECT_DIAGNOSIS_REQUEST_KEYS);
  if (typeof source.project_id !== 'string' || !PROJECT_ID_PATTERN.test(source.project_id)) {
    throw unavailable();
  }
  return Object.freeze({ project_id: source.project_id });
}

function runRequest(value: unknown) {
  const source = exactRecord(value, RUN_REQUEST_KEYS);
  if (
    typeof source.draft_id !== 'string'
    || !DRAFT_ID_PATTERN.test(source.draft_id)
    || typeof source.command_profile_id !== 'string'
    || !PROFILE_ID_PATTERN.test(source.command_profile_id)
  ) throw unavailable();
  return Object.freeze({
    draft_id: source.draft_id,
    command_profile_id: source.command_profile_id,
  });
}

function dependencyPreparationRequest(value: unknown) {
  const source = exactRecord(value, DEPENDENCY_PREPARATION_REQUEST_KEYS);
  if (
    typeof source.draft_id !== 'string'
    || !DRAFT_ID_PATTERN.test(source.draft_id)
    || typeof source.command_profile_id !== 'string'
    || !PROFILE_ID_PATTERN.test(source.command_profile_id)
    || typeof source.decision !== 'string'
    || !DEPENDENCY_PREPARATION_DECISIONS.has(source.decision)
  ) throw unavailable();
  return Object.freeze({
    draft_id: source.draft_id,
    command_profile_id: source.command_profile_id,
    decision: source.decision,
  });
}

function commandKind(value: unknown): BuilderCheckRunCommandKind {
  if (typeof value !== 'string' || !Object.hasOwn(COMMANDS, value)) throw unavailable();
  return value as BuilderCheckRunCommandKind;
}

function profile(value: unknown): BuilderCheckRunProfile {
  const source = exactRecord(value, PROFILE_KEYS);
  const kind = commandKind(source.command_kind);
  if (
    typeof source.command_profile_id !== 'string'
    || !PROFILE_ID_PATTERN.test(source.command_profile_id)
    || typeof source.command_display !== 'string'
    || !COMMANDS[kind].displays.includes(source.command_display)
    || source.requires_user_approval !== true
  ) throw unavailable();
  return Object.freeze({
    command_profile_id: source.command_profile_id,
    command_kind: kind,
    command_display: source.command_display,
    requires_user_approval: true,
  });
}

function authority(value: unknown): void {
  const source = exactRecord(value, AUTHORITY_KEYS);
  if (
    source.projection_authority !== 'main_owned_check_run_status_projection_v1'
    || source.check_run_authority !== 'verified_check_run_contract'
    || source.renderer_authority !== 'read_only_projection'
    || source.ipc_authority !== 'projection_only'
    || source.raw_output !== 'not_present'
    || source.runtime_paths !== 'not_present'
    || source.provider_dispatch !== false
    || source.command_execution !== false
    || source.source_write !== 'not_present'
    || source.git_write !== false
    || source.sqlite_write !== false
    || source.save_authority !== false
  ) throw unavailable();
}

function diagnosisAuthority(value: unknown): void {
  const source = exactRecord(value, DIAGNOSIS_AUTHORITY_KEYS);
  if (
    source.diagnosis_authority !== 'main_owned_read_only_environment_diagnosis_v1'
    || source.readiness_authority !== 'verified_builder_runtime_readiness_snapshot_v1'
    || source.renderer_authority !== 'redacted_projection_only'
    || source.browser_preview_authority !== 'readiness_context_only_no_install_decision'
    || source.provider_dispatch !== false
    || source.harness_dispatch !== false
    || source.command_execution !== false
    || source.dependency_preparation !== false
    || source.project_workspace_write !== false
    || source.check_workspace_write !== false
    || source.git_write !== false
    || source.sqlite_write !== false
    || source.save_authority !== false
    || source.path_disclosure !== 'not_serialized'
    || source.environment_variable_disclosure !== false
    || source.raw_output !== 'not_present'
    || source.secret_access !== 'not_present'
    || source.network_access !== false
  ) throw unavailable();
}

function projectDiagnosisAuthority(value: unknown): void {
  const source = exactRecord(value, PROJECT_DIAGNOSIS_AUTHORITY_KEYS);
  if (
    source.diagnosis_authority !== 'main_owned_read_only_project_environment_diagnosis_v1'
    || source.source_authority !== 'main_owned_current_project_source_tree'
    || source.toolchain_probe_authority !== 'main_owned_bounded_toolchain_version_probe_v1'
    || source.renderer_authority !== 'redacted_projection_only'
    || source.browser_preview_authority !== 'readiness_context_only_no_install_decision'
    || source.provider_dispatch !== false
    || source.harness_dispatch !== false
    || source.command_execution !== false
    || source.dependency_preparation !== false
    || source.project_workspace_write !== false
    || source.check_workspace_write !== false
    || source.git_write !== false
    || source.sqlite_write !== false
    || source.save_authority !== false
    || source.path_disclosure !== 'not_serialized'
    || source.environment_variable_disclosure !== false
    || source.raw_output !== 'not_present'
    || source.secret_access !== 'not_present'
    || source.network_access !== false
  ) throw unavailable();
}

function safeNullableVersion(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !VERSION_PATTERN.test(value)) throw unavailable();
  return value;
}

function diagnosis(
  value: unknown,
  projectId: string,
  candidateId: string,
  commandProfileId: string,
): BuilderCheckRunEnvironmentDiagnosis {
  const source = exactRecord(value, DIAGNOSIS_KEYS);
  const kind = commandKind(source.command_kind);
  const readinessState = String(source.readiness_state);
  const primaryAction =
    DIAGNOSIS_PRIMARY_ACTIONS[readinessState as keyof typeof DIAGNOSIS_PRIMARY_ACTIONS];
  const safeSummary =
    DIAGNOSIS_SUMMARIES[readinessState as keyof typeof DIAGNOSIS_SUMMARIES];
  if (
    source.diagnosis_version !== 'builder-environment-readiness-diagnosis.v1'
    || typeof source.diagnosis_id !== 'string'
    || !DIAGNOSIS_ID_PATTERN.test(source.diagnosis_id)
    || source.project_id !== projectId
    || source.candidate_id !== candidateId
    || typeof source.source_tree_digest !== 'string'
    || !DIGEST_PATTERN.test(source.source_tree_digest)
    || source.command_profile_id !== commandProfileId
    || typeof source.command_display !== 'string'
    || !COMMANDS[kind].displays.includes(source.command_display)
    || !PACKAGE_MANAGERS.has(String(source.package_manager))
    || !MANIFEST_STATES.has(String(source.package_manifest))
    || !MANIFEST_STATES.has(String(source.dependency_manifest))
    || !LOCKFILES.has(String(source.lockfile))
    || !PROJECT_DEPENDENCY_STATES.has(String(source.project_dependency_state))
    || !CHECK_WORKSPACE_DEPENDENCY_STATES.has(String(source.check_workspace_dependency_state))
    || !HOST_TOOLCHAIN_STATES.has(String(source.host_toolchain_state))
    || !INSTALL_PERMISSIONS.has(String(source.install_permission))
    || !DEPENDENCY_STRATEGIES.has(String(source.dependency_strategy))
    || !READINESS_STATES.has(readinessState)
    || !PRIMARY_ACTIONS.has(String(source.primary_action))
    || primaryAction !== source.primary_action
    || safeSummary !== source.safe_summary
    || typeof source.diagnosed_at_ms !== 'number'
    || !Number.isSafeInteger(source.diagnosed_at_ms)
    || source.diagnosed_at_ms < 0
    || typeof source.diagnosis_digest !== 'string'
    || !DIGEST_PATTERN.test(source.diagnosis_digest)
  ) throw unavailable();
  diagnosisAuthority(source.authority);
  return Object.freeze({
    diagnosis_version: 'builder-environment-readiness-diagnosis.v1',
    diagnosis_id: source.diagnosis_id,
    project_id: projectId,
    candidate_id: candidateId,
    source_tree_digest: source.source_tree_digest,
    command_profile_id: commandProfileId,
    command_kind: kind,
    command_display: source.command_display,
    package_manager: source.package_manager as BuilderCheckRunEnvironmentDiagnosis['package_manager'],
    package_manifest: source.package_manifest as BuilderCheckRunEnvironmentDiagnosis['package_manifest'],
    dependency_manifest: source.dependency_manifest as BuilderCheckRunEnvironmentDiagnosis['dependency_manifest'],
    lockfile: source.lockfile as BuilderCheckRunEnvironmentDiagnosis['lockfile'],
    project_dependency_state:
      source.project_dependency_state as BuilderCheckRunEnvironmentDiagnosis['project_dependency_state'],
    check_workspace_dependency_state:
      source.check_workspace_dependency_state as BuilderCheckRunEnvironmentDiagnosis['check_workspace_dependency_state'],
    host_toolchain_state: source.host_toolchain_state as BuilderCheckRunEnvironmentDiagnosis['host_toolchain_state'],
    host_node_version: safeNullableVersion(source.host_node_version),
    host_package_manager_version: safeNullableVersion(source.host_package_manager_version),
    install_permission: source.install_permission as BuilderCheckRunEnvironmentDiagnosis['install_permission'],
    dependency_strategy: source.dependency_strategy as BuilderCheckRunEnvironmentDiagnosis['dependency_strategy'],
    readiness_state: source.readiness_state as BuilderCheckRunEnvironmentDiagnosis['readiness_state'],
    primary_action: primaryAction,
    safe_summary: safeSummary,
    diagnosed_at_ms: source.diagnosed_at_ms,
    diagnosis_digest: source.diagnosis_digest,
  });
}

function projectToolchains(value: unknown): BuilderProjectEnvironmentDiagnosis['toolchains'] {
  const source = exactRecord(value, PROJECT_DIAGNOSIS_TOOLCHAIN_NAMES);
  const toolchains = Object.fromEntries(PROJECT_DIAGNOSIS_TOOLCHAIN_NAMES.map((name) => {
    const tool = exactRecord(source[name], PROJECT_DIAGNOSIS_TOOLCHAIN_KEYS);
    if (
      typeof tool.state !== 'string'
      || !['visible', 'missing', 'unavailable'].includes(tool.state)
    ) throw unavailable();
    const version = safeNullableVersion(tool.version);
    if ((tool.state === 'visible') !== (version !== null)) throw unavailable();
    return [name, Object.freeze({ state: tool.state, version })];
  }));
  return Object.freeze(toolchains) as BuilderProjectEnvironmentDiagnosis['toolchains'];
}

function projectEnvironmentDiagnosis(
  value: unknown,
  projectId: string,
): BuilderProjectEnvironmentDiagnosis {
  const source = exactRecord(value, PROJECT_DIAGNOSIS_KEYS);
  const readinessState = String(source.readiness_state);
  const primaryAction =
    PROJECT_DIAGNOSIS_PRIMARY_ACTIONS[
      readinessState as keyof typeof PROJECT_DIAGNOSIS_PRIMARY_ACTIONS
    ];
  const safeSummary =
    PROJECT_DIAGNOSIS_SUMMARIES[readinessState as keyof typeof PROJECT_DIAGNOSIS_SUMMARIES];
  if (
    source.diagnosis_version !== 'builder-project-environment-diagnosis.v1'
    || typeof source.diagnosis_id !== 'string'
    || !/^builder-project-environment-diagnosis:[0-9a-f]{64}$/u.test(source.diagnosis_id)
    || source.project_id !== projectId
    || typeof source.source_tree_digest !== 'string'
    || !DIGEST_PATTERN.test(source.source_tree_digest)
    || !PROJECT_PACKAGE_MANAGERS.has(String(source.package_manager))
    || !MANIFEST_STATES.has(String(source.package_manifest))
    || !MANIFEST_STATES.has(String(source.dependency_manifest))
    || !LOCKFILES.has(String(source.lockfile))
    || !PROJECT_DEPENDENCY_STATES.has(String(source.project_dependency_state))
    || !PROJECT_READINESS_STATES.has(readinessState)
    || !PROJECT_PRIMARY_ACTIONS.has(String(source.primary_action))
    || primaryAction !== source.primary_action
    || safeSummary !== source.safe_summary
    || typeof source.diagnosed_at_ms !== 'number'
    || !Number.isSafeInteger(source.diagnosed_at_ms)
    || source.diagnosed_at_ms < 0
    || typeof source.diagnosis_digest !== 'string'
    || !DIGEST_PATTERN.test(source.diagnosis_digest)
  ) throw unavailable();
  projectDiagnosisAuthority(source.authority);
  return Object.freeze({
    diagnosis_version: 'builder-project-environment-diagnosis.v1',
    diagnosis_id: source.diagnosis_id,
    project_id: projectId,
    source_tree_digest: source.source_tree_digest,
    package_manager: source.package_manager as BuilderProjectEnvironmentDiagnosis['package_manager'],
    package_manifest: source.package_manifest as BuilderProjectEnvironmentDiagnosis['package_manifest'],
    dependency_manifest: source.dependency_manifest as BuilderProjectEnvironmentDiagnosis['dependency_manifest'],
    lockfile: source.lockfile as BuilderProjectEnvironmentDiagnosis['lockfile'],
    project_dependency_state:
      source.project_dependency_state as BuilderProjectEnvironmentDiagnosis['project_dependency_state'],
    toolchains: projectToolchains(source.toolchains),
    readiness_state: source.readiness_state as BuilderProjectEnvironmentDiagnosis['readiness_state'],
    primary_action: primaryAction as BuilderProjectEnvironmentDiagnosis['primary_action'],
    safe_summary: safeSummary,
    diagnosed_at_ms: source.diagnosed_at_ms,
    diagnosis_digest: source.diagnosis_digest,
  });
}

function projection(value: unknown, projectId: string, candidateId: string): BuilderCheckRunStatusProjection {
  const source = exactRecord(value, PROJECTION_KEYS);
  const kind = commandKind(source.command_kind);
  if (
    source.projection_version !== 'builder-check-run-status-projection.v1'
    || source.project_id !== projectId
    || source.candidate_id !== candidateId
    || typeof source.check_run_id !== 'string'
    || !CHECK_RUN_ID_PATTERN.test(source.check_run_id)
    || source.command_label !== COMMANDS[kind].label
    || typeof source.status !== 'string'
    || typeof source.label !== 'string'
    || typeof source.summary !== 'string'
    || !STATUS_TUPLES.has(JSON.stringify([source.status, source.label, source.summary]))
    || !ENVIRONMENT_REASONS.has(String(source.environment_reason))
    || (source.label !== 'Check unavailable' && source.environment_reason !== 'none')
    || typeof source.completed_at_ms !== 'number'
    || !Number.isSafeInteger(source.completed_at_ms)
    || source.completed_at_ms < 0
    || typeof source.result_digest !== 'string'
    || !DIGEST_PATTERN.test(source.result_digest)
  ) throw unavailable();
  authority(source.authority);
  return Object.freeze({
    projection_version: 'builder-check-run-status-projection.v1',
    project_id: projectId,
    candidate_id: candidateId,
    check_run_id: source.check_run_id,
    command_kind: kind,
    command_label: source.command_label as BuilderCheckRunStatusProjection['command_label'],
    status: source.status as BuilderCheckRunStatusProjection['status'],
    label: source.label as BuilderCheckRunStatusProjection['label'],
    summary: source.summary,
    environment_reason: source.environment_reason as BuilderCheckRunStatusProjection['environment_reason'],
    completed_at_ms: source.completed_at_ms,
    result_digest: source.result_digest,
  });
}

function availableResult(value: unknown, draftId: string): BuilderCheckRunAvailableResult {
  const source = exactRecord(value, READ_RESULT_KEYS);
  if (
    source.result_version !== 'builder-check-run-current-draft-read-result.v1'
    || source.service_version !== 'builder-check-run-current-draft-service.v1'
    || source.operation !== 'current_draft_available_checks_read'
    || !['ready', 'no_checks'].includes(source.status as string)
    || source.draft_id !== draftId
    || typeof source.project_id !== 'string'
    || !PROJECT_ID_PATTERN.test(source.project_id)
    || typeof source.candidate_id !== 'string'
    || !CANDIDATE_ID_PATTERN.test(source.candidate_id)
    || !Array.isArray(source.available_checks)
    || source.available_checks.length > 4
  ) throw unavailable();
  const profiles = Object.freeze(source.available_checks.map(profile));
  if (
    (source.status === 'ready') !== (profiles.length > 0)
    || new Set(profiles.map((entry) => entry.command_profile_id)).size !== profiles.length
  ) throw unavailable();
  return Object.freeze({
    result_version: 'builder-check-run-current-draft-read-result.v1',
    service_version: 'builder-check-run-current-draft-service.v1',
    operation: 'current_draft_available_checks_read',
    status: source.status as BuilderCheckRunAvailableResult['status'],
    draft_id: draftId,
    project_id: source.project_id,
    candidate_id: source.candidate_id,
    available_checks: profiles,
  });
}

function completedResult(value: unknown, draftId: string): BuilderCheckRunCompletedResult {
  const source = exactRecord(value, RUN_RESULT_KEYS);
  if (
    source.result_version !== 'builder-check-run-current-draft-run-result.v1'
    || source.service_version !== 'builder-check-run-current-draft-service.v1'
    || source.operation !== 'current_draft_approved_check_completed'
    || source.draft_id !== draftId
    || typeof source.project_id !== 'string'
    || !PROJECT_ID_PATTERN.test(source.project_id)
    || typeof source.candidate_id !== 'string'
    || !CANDIDATE_ID_PATTERN.test(source.candidate_id)
  ) throw unavailable();
  return Object.freeze({
    result_version: 'builder-check-run-current-draft-run-result.v1',
    service_version: 'builder-check-run-current-draft-service.v1',
    operation: 'current_draft_approved_check_completed',
    draft_id: draftId,
    project_id: source.project_id,
    candidate_id: source.candidate_id,
    check_run_status_projection: projection(
      source.check_run_status_projection,
      source.project_id,
      source.candidate_id,
    ),
  });
}

function diagnosisResult(
  value: unknown,
  draftId: string,
  commandProfileId: string,
): BuilderCheckRunEnvironmentDiagnosisResult {
  const source = exactRecord(value, DIAGNOSIS_RESULT_KEYS);
  if (
    source.result_version !== 'builder-check-run-current-draft-environment-diagnosis-result.v1'
    || source.service_version !== 'builder-check-run-current-draft-service.v1'
    || source.operation !== 'current_draft_check_environment_diagnosed'
    || source.draft_id !== draftId
    || typeof source.project_id !== 'string'
    || !PROJECT_ID_PATTERN.test(source.project_id)
    || typeof source.candidate_id !== 'string'
    || !CANDIDATE_ID_PATTERN.test(source.candidate_id)
  ) throw unavailable();
  return Object.freeze({
    result_version: 'builder-check-run-current-draft-environment-diagnosis-result.v1',
    service_version: 'builder-check-run-current-draft-service.v1',
    operation: 'current_draft_check_environment_diagnosed',
    draft_id: draftId,
    project_id: source.project_id,
    candidate_id: source.candidate_id,
    environment_diagnosis: diagnosis(
      source.environment_diagnosis,
      source.project_id,
      source.candidate_id,
      commandProfileId,
    ),
  });
}

function projectDiagnosisResult(
  value: unknown,
  projectId: string,
): BuilderProjectEnvironmentDiagnosisResult {
  const source = exactRecord(value, PROJECT_DIAGNOSIS_RESULT_KEYS);
  if (
    source.result_version !== 'builder-project-environment-diagnosis-result.v1'
    || source.service_version !== 'builder-project-environment-diagnosis-service.v1'
    || source.operation !== 'project_environment_diagnosed'
    || source.project_id !== projectId
  ) throw unavailable();
  return Object.freeze({
    result_version: 'builder-project-environment-diagnosis-result.v1',
    service_version: 'builder-project-environment-diagnosis-service.v1',
    operation: 'project_environment_diagnosed',
    project_id: projectId,
    environment_diagnosis: projectEnvironmentDiagnosis(source.environment_diagnosis, projectId),
  });
}

function skippedResult(value: unknown, draftId: string): BuilderCheckRunSkippedResult {
  const source = exactRecord(value, SKIP_RESULT_KEYS);
  if (
    source.result_version !== 'builder-check-skip-current-draft-public-result.v1'
    || source.operation !== 'current_draft_check_skipped'
    || source.draft_id !== draftId
    || typeof source.project_id !== 'string'
    || !PROJECT_ID_PATTERN.test(source.project_id)
    || typeof source.candidate_id !== 'string'
    || !CANDIDATE_ID_PATTERN.test(source.candidate_id)
    || source.status !== 'skipped'
  ) throw unavailable();
  return Object.freeze({
    result_version: 'builder-check-skip-current-draft-public-result.v1',
    operation: 'current_draft_check_skipped',
    draft_id: draftId,
    project_id: source.project_id,
    candidate_id: source.candidate_id,
    status: 'skipped',
  });
}

export function createBuilderDesktopCheckRunPort(value: unknown): BuilderCheckRunPort {
  const bridge = sanitizeBridge(value);
  return Object.freeze({
    async readCurrentDraftAvailableChecks(request: BuilderCheckRunReadRequest) {
      try {
        const safe = readRequest(request);
        return availableResult(await Reflect.apply(
          bridge.readCurrentDraftAvailableChecks,
          bridge,
          [safe],
        ), safe.draft_id);
      } catch (error) {
        throw unavailable(safeErrorCode(error));
      }
    },
    async diagnoseCurrentDraftCheckEnvironment(request: BuilderCheckRunApproveRequest) {
      try {
        const safe = runRequest(request);
        return diagnosisResult(await Reflect.apply(
          bridge.diagnoseCurrentDraftCheckEnvironment,
          bridge,
          [safe],
        ), safe.draft_id, safe.command_profile_id);
      } catch (error) {
        throw unavailable(safeErrorCode(error));
      }
    },
    async diagnoseProjectEnvironment(request: Readonly<{ project_id: string }>) {
      try {
        const safe = projectDiagnosisRequest(request);
        return projectDiagnosisResult(await Reflect.apply(
          bridge.diagnoseProjectEnvironment,
          bridge,
          [safe],
        ), safe.project_id);
      } catch (error) {
        throw unavailable(safeErrorCode(error));
      }
    },
    async approveAndRunCurrentDraftCheck(request: BuilderCheckRunApproveRequest) {
      try {
        const safe = runRequest(request);
        return completedResult(await Reflect.apply(
          bridge.approveAndRunCurrentDraftCheck,
          bridge,
          [safe],
        ), safe.draft_id);
      } catch (error) {
        throw unavailable(safeErrorCode(error));
      }
    },
    async decideCurrentDraftDependencyPreparation(
      request: BuilderCheckRunDependencyPreparationRequest,
    ) {
      try {
        const safe = dependencyPreparationRequest(request);
        return completedResult(await Reflect.apply(
          bridge.decideCurrentDraftDependencyPreparation,
          bridge,
          [safe],
        ), safe.draft_id);
      } catch (error) {
        throw unavailable(safeErrorCode(error));
      }
    },
    async skipCurrentDraftCheck(request: BuilderCheckRunReadRequest) {
      try {
        const safe = readRequest(request);
        return skippedResult(await Reflect.apply(
          bridge.skipCurrentDraftCheck,
          bridge,
          [safe],
        ), safe.draft_id);
      } catch (error) {
        throw unavailable(safeErrorCode(error));
      }
    },
  });
}
