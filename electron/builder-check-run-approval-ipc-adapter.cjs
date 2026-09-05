'use strict';

const { types: utilTypes } = require('node:util');

const {
  BUILDER_CHECK_RUN_CURRENT_DRAFT_ENVIRONMENT_DIAGNOSIS_RESULT_VERSION,
  BUILDER_CHECK_RUN_CURRENT_DRAFT_READ_RESULT_VERSION,
  BUILDER_CHECK_RUN_CURRENT_DRAFT_RUN_RESULT_VERSION,
  BUILDER_CHECK_RUN_CURRENT_DRAFT_SERVICE_VERSION,
} = require('./builder-check-run-current-draft-service.cjs');
const {
  sanitizeBuilderEnvironmentReadinessDiagnosis,
} = require('./builder-environment-readiness-diagnosis.cjs');
const {
  BUILDER_PROJECT_ENVIRONMENT_DIAGNOSIS_RESULT_VERSION,
  BUILDER_PROJECT_ENVIRONMENT_DIAGNOSIS_SERVICE_VERSION,
  sanitizeBuilderProjectEnvironmentDiagnosisResult,
} = require('./builder-project-environment-diagnosis.cjs');
const {
  BUILDER_PROJECT_DEPENDENCY_PREPARATION_RESULT_VERSION,
  BUILDER_PROJECT_DEPENDENCY_PREPARER_VERSION,
  sanitizeBuilderProjectDependencyPreparationResult,
} = require('./builder-project-dependency-preparer.cjs');
const {
  sanitizeBuilderCheckRunStatusProjection,
} = require('./builder-check-run-status-projection.cjs');
const {
  BUILDER_CHECK_SKIP_CURRENT_DRAFT_RESULT_VERSION,
  BUILDER_CHECK_SKIP_CURRENT_DRAFT_SERVICE_VERSION,
} = require('./builder-check-skip-current-draft-service.cjs');
const {
  sanitizeBuilderCheckSkipDecision,
} = require('./builder-check-skip-decision.cjs');

const READ_CURRENT_DRAFT_AVAILABLE_CHECKS_CHANNEL =
  'clawfabric-builder:check-run:read-current-draft-available';
const DIAGNOSE_CURRENT_DRAFT_CHECK_ENVIRONMENT_CHANNEL =
  'clawfabric-builder:check-run:diagnose-current-draft-check-environment';
const DIAGNOSE_PROJECT_ENVIRONMENT_CHANNEL =
  'clawfabric-builder:check-run:diagnose-project-environment';
const PREPARE_PROJECT_DEPENDENCIES_CHANNEL =
  'clawfabric-builder:check-run:prepare-project-dependencies';
const APPROVE_CURRENT_DRAFT_CHECK_CHANNEL =
  'clawfabric-builder:check-run:approve-current-draft-check';
const DECIDE_CURRENT_DRAFT_DEPENDENCY_PREPARATION_CHANNEL =
  'clawfabric-builder:check-run:decide-current-draft-dependency-preparation';
const SKIP_CURRENT_DRAFT_CHECK_CHANNEL =
  'clawfabric-builder:check-run:skip-current-draft-check';
const OPTION_KEYS = Object.freeze([
  'readCurrentDraftAvailableChecks',
  'diagnoseCurrentDraftCheckEnvironment',
  'diagnoseProjectEnvironment',
  'prepareProjectDependencies',
  'approveAndRunCurrentDraftCheck',
  'decideCurrentDraftDependencyPreparation',
  'skipCurrentDraftCheck',
  'mainWindowRef',
]);
const READ_REQUEST_KEYS = Object.freeze(['draft_id']);
const PROJECT_DIAGNOSIS_REQUEST_KEYS = Object.freeze(['project_id']);
const RUN_REQUEST_KEYS = Object.freeze(['draft_id', 'command_profile_id']);
const DEPENDENCY_PREPARATION_REQUEST_KEYS = Object.freeze([
  'draft_id',
  'command_profile_id',
  'decision',
]);
const DEPENDENCY_PREPARATION_DECISIONS = Object.freeze(['allow_once', 'deny']);
const READ_RESULT_KEYS = Object.freeze([
  'result_version',
  'service_version',
  'operation',
  'status',
  'draft_id',
  'project_id',
  'candidate_id',
  'available_checks',
]);
const RUN_RESULT_KEYS = Object.freeze([
  'result_version',
  'service_version',
  'operation',
  'draft_id',
  'project_id',
  'candidate_id',
  'check_run_status_projection',
]);
const DIAGNOSIS_RESULT_KEYS = Object.freeze([
  'result_version',
  'service_version',
  'operation',
  'draft_id',
  'project_id',
  'candidate_id',
  'environment_diagnosis',
]);
const PROJECT_DIAGNOSIS_RESULT_KEYS = Object.freeze([
  'result_version',
  'service_version',
  'operation',
  'project_id',
  'environment_diagnosis',
]);
const PROJECT_DEPENDENCY_PREPARATION_RESULT_KEYS = Object.freeze([
  'result_version',
  'service_version',
  'operation',
  'project_id',
  'preparation_receipt',
  'environment_diagnosis',
]);
const SKIP_RESULT_KEYS = Object.freeze([
  'result_version',
  'service_version',
  'operation',
  'draft_id',
  'project_id',
  'candidate_id',
  'check_skip_decision',
  'authority',
]);
const PROFILE_KEYS = Object.freeze([
  'command_profile_id',
  'command_kind',
  'command_display',
  'requires_user_approval',
]);
const DRAFT_ID_PATTERN = /^builder-generation-draft:[0-9a-f]{64}$/u;
const COMMAND_PROFILE_ID_PATTERN = /^builder-command-profile:[0-9a-f]{32}$/u;
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const PROJECT_ID_PATTERN = new RegExp(`^builder-project:${UUID_SOURCE}$`, 'u');
const CANDIDATE_ID_PATTERN = /^builder-code-change-candidate:[0-9a-f]{64}$/u;
const COMMAND_DISPLAYS = Object.freeze({
  lint: new Set(['npm run lint', 'pnpm run lint', 'yarn lint', 'bun run lint']),
  typecheck: new Set([
    'npm run typecheck',
    'pnpm run typecheck',
    'yarn typecheck',
    'bun run typecheck',
  ]),
  test: new Set(['npm test', 'pnpm test', 'yarn test', 'bun run test']),
  build: new Set(['npm run build', 'pnpm run build', 'yarn build', 'bun run build']),
});

const ERROR_MESSAGES = Object.freeze({
  builder_check_run_approval_forbidden: 'Project checks are unavailable.',
  builder_check_run_approval_invalid: 'The project check request could not be verified.',
  builder_check_run_approval_busy: 'A project check is already in progress.',
  builder_check_run_current_draft_failed: 'The draft changed before the project check could start.',
  builder_check_run_approval_unavailable: 'The project check could not be completed.',
});

class BuilderCheckRunApprovalIpcError extends Error {
  constructor(code = 'builder_check_run_approval_unavailable') {
    const selected = Object.hasOwn(ERROR_MESSAGES, code)
      ? code
      : 'builder_check_run_approval_unavailable';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderCheckRunApprovalIpcError';
    this.code = selected;
    this.retryable = [
      'builder_check_run_approval_busy',
      'builder_check_run_approval_unavailable',
    ].includes(selected);
    this.stack = `${this.name}: ${this.message}`;
  }
}

function ipcError(code) { return new BuilderCheckRunApprovalIpcError(code); }

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || utilTypes.isProxy(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactObject(value, keys, code = 'builder_check_run_approval_invalid') {
  if (!isPlainObject(value)) throw ipcError(code);
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== keys.length || ownKeys.some(
    (key) => typeof key !== 'string' || !keys.includes(key),
  )) throw ipcError(code);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      throw ipcError(code);
    }
  }
  return descriptors;
}

function stableMethod(value, key) {
  if (!isPlainObject(value)) throw ipcError();
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (
    !descriptor
    || descriptor.enumerable !== true
    || !Object.hasOwn(descriptor, 'value')
    || typeof descriptor.value !== 'function'
    || utilTypes.isProxy(descriptor.value)
  ) throw ipcError();
  return descriptor.value;
}

function safeOptions(value) {
  exactObject(value, OPTION_KEYS, 'builder_check_run_approval_unavailable');
  return Object.freeze({
    readCurrentDraftAvailableChecks: stableMethod(value, 'readCurrentDraftAvailableChecks'),
    diagnoseCurrentDraftCheckEnvironment: stableMethod(value, 'diagnoseCurrentDraftCheckEnvironment'),
    diagnoseProjectEnvironment: stableMethod(value, 'diagnoseProjectEnvironment'),
    prepareProjectDependencies: stableMethod(value, 'prepareProjectDependencies'),
    approveAndRunCurrentDraftCheck: stableMethod(value, 'approveAndRunCurrentDraftCheck'),
    decideCurrentDraftDependencyPreparation:
      stableMethod(value, 'decideCurrentDraftDependencyPreparation'),
    skipCurrentDraftCheck: stableMethod(value, 'skipCurrentDraftCheck'),
    mainWindowRef: stableMethod(value, 'mainWindowRef'),
  });
}

function safePattern(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw ipcError('builder_check_run_approval_invalid');
  }
  return value;
}

function safeReadRequest(value) {
  const descriptors = exactObject(value, READ_REQUEST_KEYS);
  return Object.freeze({
    draft_id: safePattern(descriptors.draft_id.value, DRAFT_ID_PATTERN),
  });
}

function safeProjectDiagnosisRequest(value) {
  const descriptors = exactObject(value, PROJECT_DIAGNOSIS_REQUEST_KEYS);
  return Object.freeze({
    project_id: safePattern(descriptors.project_id.value, PROJECT_ID_PATTERN),
  });
}

function safeRunRequest(value) {
  const descriptors = exactObject(value, RUN_REQUEST_KEYS);
  return Object.freeze({
    draft_id: safePattern(descriptors.draft_id.value, DRAFT_ID_PATTERN),
    command_profile_id: safePattern(
      descriptors.command_profile_id.value,
      COMMAND_PROFILE_ID_PATTERN,
    ),
  });
}

function safeDependencyPreparationRequest(value) {
  const descriptors = exactObject(value, DEPENDENCY_PREPARATION_REQUEST_KEYS);
  if (
    typeof descriptors.decision.value !== 'string'
    || !DEPENDENCY_PREPARATION_DECISIONS.includes(descriptors.decision.value)
  ) throw ipcError('builder_check_run_approval_invalid');
  return Object.freeze({
    draft_id: safePattern(descriptors.draft_id.value, DRAFT_ID_PATTERN),
    command_profile_id: safePattern(
      descriptors.command_profile_id.value,
      COMMAND_PROFILE_ID_PATTERN,
    ),
    decision: descriptors.decision.value,
  });
}

function safeProfile(value) {
  const descriptors = exactObject(value, PROFILE_KEYS, 'builder_check_run_approval_unavailable');
  const kind = descriptors.command_kind.value;
  const display = descriptors.command_display.value;
  if (
    !COMMAND_PROFILE_ID_PATTERN.test(descriptors.command_profile_id.value)
    || !Object.hasOwn(COMMAND_DISPLAYS, kind)
    || !COMMAND_DISPLAYS[kind].has(display)
    || descriptors.requires_user_approval.value !== true
  ) throw ipcError();
  return Object.freeze({
    command_profile_id: descriptors.command_profile_id.value,
    command_kind: kind,
    command_display: display,
    requires_user_approval: true,
  });
}

function safeReadResult(value, request) {
  const descriptors = exactObject(value, READ_RESULT_KEYS, 'builder_check_run_approval_unavailable');
  const profiles = descriptors.available_checks.value;
  if (
    descriptors.result_version.value !== BUILDER_CHECK_RUN_CURRENT_DRAFT_READ_RESULT_VERSION
    || descriptors.service_version.value !== BUILDER_CHECK_RUN_CURRENT_DRAFT_SERVICE_VERSION
    || descriptors.operation.value !== 'current_draft_available_checks_read'
    || !['ready', 'no_checks'].includes(descriptors.status.value)
    || descriptors.draft_id.value !== request.draft_id
    || !PROJECT_ID_PATTERN.test(descriptors.project_id.value)
    || !CANDIDATE_ID_PATTERN.test(descriptors.candidate_id.value)
    || !Array.isArray(profiles)
    || profiles.length > 4
  ) throw ipcError();
  const availableChecks = Object.freeze(profiles.map(safeProfile));
  if (
    (descriptors.status.value === 'ready') !== (availableChecks.length > 0)
    || new Set(availableChecks.map((profile) => profile.command_profile_id)).size
      !== availableChecks.length
    || new Set(availableChecks.map((profile) => profile.command_kind)).size
      !== availableChecks.length
  ) throw ipcError();
  return Object.freeze({
    result_version: BUILDER_CHECK_RUN_CURRENT_DRAFT_READ_RESULT_VERSION,
    service_version: BUILDER_CHECK_RUN_CURRENT_DRAFT_SERVICE_VERSION,
    operation: 'current_draft_available_checks_read',
    status: descriptors.status.value,
    draft_id: request.draft_id,
    project_id: descriptors.project_id.value,
    candidate_id: descriptors.candidate_id.value,
    available_checks: availableChecks,
  });
}

function safeRunResult(value, request) {
  const descriptors = exactObject(value, RUN_RESULT_KEYS, 'builder_check_run_approval_unavailable');
  if (
    descriptors.result_version.value !== BUILDER_CHECK_RUN_CURRENT_DRAFT_RUN_RESULT_VERSION
    || descriptors.service_version.value !== BUILDER_CHECK_RUN_CURRENT_DRAFT_SERVICE_VERSION
    || descriptors.operation.value !== 'current_draft_approved_check_completed'
    || descriptors.draft_id.value !== request.draft_id
    || !PROJECT_ID_PATTERN.test(descriptors.project_id.value)
    || !CANDIDATE_ID_PATTERN.test(descriptors.candidate_id.value)
  ) throw ipcError();
  let projection;
  try {
    projection = sanitizeBuilderCheckRunStatusProjection(
      descriptors.check_run_status_projection.value,
    );
  } catch {
    throw ipcError();
  }
  if (
    projection.project_id !== descriptors.project_id.value
    || projection.candidate_id !== descriptors.candidate_id.value
  ) throw ipcError();
  return Object.freeze({
    result_version: BUILDER_CHECK_RUN_CURRENT_DRAFT_RUN_RESULT_VERSION,
    service_version: BUILDER_CHECK_RUN_CURRENT_DRAFT_SERVICE_VERSION,
    operation: 'current_draft_approved_check_completed',
    draft_id: request.draft_id,
    project_id: descriptors.project_id.value,
    candidate_id: descriptors.candidate_id.value,
    check_run_status_projection: projection,
  });
}

function safeDiagnosisResult(value, request) {
  const descriptors = exactObject(value, DIAGNOSIS_RESULT_KEYS, 'builder_check_run_approval_unavailable');
  if (
    descriptors.result_version.value !== BUILDER_CHECK_RUN_CURRENT_DRAFT_ENVIRONMENT_DIAGNOSIS_RESULT_VERSION
    || descriptors.service_version.value !== BUILDER_CHECK_RUN_CURRENT_DRAFT_SERVICE_VERSION
    || descriptors.operation.value !== 'current_draft_check_environment_diagnosed'
    || descriptors.draft_id.value !== request.draft_id
    || !PROJECT_ID_PATTERN.test(descriptors.project_id.value)
    || !CANDIDATE_ID_PATTERN.test(descriptors.candidate_id.value)
  ) throw ipcError();
  let diagnosis;
  try {
    diagnosis = sanitizeBuilderEnvironmentReadinessDiagnosis(
      descriptors.environment_diagnosis.value,
    );
  } catch {
    throw ipcError();
  }
  if (
    diagnosis.project_id !== descriptors.project_id.value
    || diagnosis.candidate_id !== descriptors.candidate_id.value
    || diagnosis.command_profile_id !== request.command_profile_id
  ) throw ipcError();
  return Object.freeze({
    result_version: BUILDER_CHECK_RUN_CURRENT_DRAFT_ENVIRONMENT_DIAGNOSIS_RESULT_VERSION,
    service_version: BUILDER_CHECK_RUN_CURRENT_DRAFT_SERVICE_VERSION,
    operation: 'current_draft_check_environment_diagnosed',
    draft_id: request.draft_id,
    project_id: descriptors.project_id.value,
    candidate_id: descriptors.candidate_id.value,
    environment_diagnosis: diagnosis,
  });
}

function safeProjectDiagnosisResult(value, request) {
  const descriptors = exactObject(value, PROJECT_DIAGNOSIS_RESULT_KEYS, 'builder_check_run_approval_unavailable');
  if (
    descriptors.result_version.value !== BUILDER_PROJECT_ENVIRONMENT_DIAGNOSIS_RESULT_VERSION
    || descriptors.service_version.value !== BUILDER_PROJECT_ENVIRONMENT_DIAGNOSIS_SERVICE_VERSION
    || descriptors.operation.value !== 'project_environment_diagnosed'
    || descriptors.project_id.value !== request.project_id
  ) throw ipcError();
  let result;
  try {
    result = sanitizeBuilderProjectEnvironmentDiagnosisResult(value);
  } catch {
    throw ipcError();
  }
  return result;
}

function safeProjectDependencyPreparationResult(value, request) {
  const descriptors = exactObject(
    value,
    PROJECT_DEPENDENCY_PREPARATION_RESULT_KEYS,
    'builder_check_run_approval_unavailable',
  );
  if (
    descriptors.result_version.value !== BUILDER_PROJECT_DEPENDENCY_PREPARATION_RESULT_VERSION
    || descriptors.service_version.value !== BUILDER_PROJECT_DEPENDENCY_PREPARER_VERSION
    || descriptors.operation.value !== 'project_dependencies_prepared'
    || descriptors.project_id.value !== request.project_id
  ) throw ipcError();
  try {
    return sanitizeBuilderProjectDependencyPreparationResult(value);
  } catch {
    throw ipcError();
  }
}

function safeSkipResult(value, request) {
  const descriptors = exactObject(value, SKIP_RESULT_KEYS, 'builder_check_run_approval_unavailable');
  if (
    descriptors.result_version.value !== BUILDER_CHECK_SKIP_CURRENT_DRAFT_RESULT_VERSION
    || descriptors.service_version.value !== BUILDER_CHECK_SKIP_CURRENT_DRAFT_SERVICE_VERSION
    || !['check_skip_decision_recorded', 'check_skip_decision_replayed'].includes(
      descriptors.operation.value,
    )
    || descriptors.draft_id.value !== request.draft_id
    || !PROJECT_ID_PATTERN.test(descriptors.project_id.value)
    || !CANDIDATE_ID_PATTERN.test(descriptors.candidate_id.value)
  ) throw ipcError();
  let decision;
  try { decision = sanitizeBuilderCheckSkipDecision(descriptors.check_skip_decision.value); } catch {
    throw ipcError();
  }
  if (
    decision.draft_id !== request.draft_id
    || decision.project_id !== descriptors.project_id.value
    || decision.candidate_id !== descriptors.candidate_id.value
  ) throw ipcError();
  const authority = exactObject(descriptors.authority.value, [
    'user_action',
    'save_version',
    'check_execution',
    'renderer_candidate_identity',
  ], 'builder_check_run_approval_unavailable');
  if (
    authority.user_action.value !== 'explicit_skip_check_request_admitted_by_main'
    || authority.save_version.value !== 'not_performed'
    || authority.check_execution.value !== 'not_performed'
    || authority.renderer_candidate_identity.value !== 'not_accepted'
  ) throw ipcError();
  return Object.freeze({
    result_version: 'builder-check-skip-current-draft-public-result.v1',
    operation: 'current_draft_check_skipped',
    draft_id: request.draft_id,
    project_id: descriptors.project_id.value,
    candidate_id: descriptors.candidate_id.value,
    status: 'skipped',
  });
}

function activeWebContents(mainWindowRef) {
  try {
    const windowRef = Reflect.apply(mainWindowRef, undefined, []);
    if (!windowRef || (typeof windowRef.isDestroyed === 'function' && windowRef.isDestroyed())) return null;
    const webContents = windowRef.webContents;
    if (!webContents || (typeof webContents.isDestroyed === 'function' && webContents.isDestroyed())) {
      return null;
    }
    return webContents;
  } catch {
    return null;
  }
}

function assertActiveSender(event, mainWindowRef) {
  const webContents = activeWebContents(mainWindowRef);
  if (
    !event
    || webContents === null
    || event.sender !== webContents
    || webContents.mainFrame === null
    || typeof webContents.mainFrame !== 'object'
    || event.senderFrame !== webContents.mainFrame
  ) {
    throw ipcError('builder_check_run_approval_forbidden');
  }
}

function safeErrorCode(error) {
  try {
    if (
      error === null
      || (typeof error !== 'object' && typeof error !== 'function')
      || utilTypes.isProxy(error)
    ) return null;
    const descriptor = Object.getOwnPropertyDescriptor(error, 'code');
    return descriptor
      && Object.hasOwn(descriptor, 'value')
      && typeof descriptor.value === 'string'
      ? descriptor.value
      : null;
  } catch {
    return null;
  }
}

function normalizeError(error) {
  if (error instanceof BuilderCheckRunApprovalIpcError) return error;
  if (
    safeErrorCode(error) === 'builder_check_run_approval_busy'
    || safeErrorCode(error) === 'builder_check_skip_current_draft_busy'
  ) {
    return ipcError('builder_check_run_approval_busy');
  }
  if (safeErrorCode(error) === 'builder_check_run_current_draft_failed') {
    return ipcError('builder_check_run_current_draft_failed');
  }
  return ipcError();
}

function createBuilderCheckRunApprovalIpcAdapter(rawOptions) {
  const options = safeOptions(rawOptions);

  async function invokeRead(event, rawArguments) {
    try {
      assertActiveSender(event, options.mainWindowRef);
      if (rawArguments.length !== 1) throw ipcError('builder_check_run_approval_invalid');
      const request = safeReadRequest(rawArguments[0]);
      return safeReadResult(await Reflect.apply(
        options.readCurrentDraftAvailableChecks,
        undefined,
        [request],
      ), request);
    } catch (error) {
      throw normalizeError(error);
    }
  }

  async function invokeApproveAndRun(event, rawArguments) {
    try {
      assertActiveSender(event, options.mainWindowRef);
      if (rawArguments.length !== 1) throw ipcError('builder_check_run_approval_invalid');
      const request = safeRunRequest(rawArguments[0]);
      return safeRunResult(await Reflect.apply(
        options.approveAndRunCurrentDraftCheck,
        undefined,
        [request],
      ), request);
    } catch (error) {
      throw normalizeError(error);
    }
  }

  async function invokeDiagnose(event, rawArguments) {
    try {
      assertActiveSender(event, options.mainWindowRef);
      if (rawArguments.length !== 1) throw ipcError('builder_check_run_approval_invalid');
      const request = safeRunRequest(rawArguments[0]);
      return safeDiagnosisResult(await Reflect.apply(
        options.diagnoseCurrentDraftCheckEnvironment,
        undefined,
        [request],
      ), request);
    } catch (error) {
      throw normalizeError(error);
    }
  }

  async function invokeProjectDiagnose(event, rawArguments) {
    try {
      assertActiveSender(event, options.mainWindowRef);
      if (rawArguments.length !== 1) throw ipcError('builder_check_run_approval_invalid');
      const request = safeProjectDiagnosisRequest(rawArguments[0]);
      return safeProjectDiagnosisResult(await Reflect.apply(
        options.diagnoseProjectEnvironment,
        undefined,
        [request],
      ), request);
    } catch (error) {
      throw normalizeError(error);
    }
  }

  async function invokePrepareProjectDependencies(event, rawArguments) {
    try {
      assertActiveSender(event, options.mainWindowRef);
      if (rawArguments.length !== 1) throw ipcError('builder_check_run_approval_invalid');
      const request = safeProjectDiagnosisRequest(rawArguments[0]);
      return safeProjectDependencyPreparationResult(await Reflect.apply(
        options.prepareProjectDependencies,
        undefined,
        [request],
      ), request);
    } catch (error) {
      throw normalizeError(error);
    }
  }

  async function invokeDecideDependencyPreparation(event, rawArguments) {
    try {
      assertActiveSender(event, options.mainWindowRef);
      if (rawArguments.length !== 1) throw ipcError('builder_check_run_approval_invalid');
      const request = safeDependencyPreparationRequest(rawArguments[0]);
      return safeRunResult(await Reflect.apply(
        options.decideCurrentDraftDependencyPreparation,
        undefined,
        [request],
      ), request);
    } catch (error) {
      throw normalizeError(error);
    }
  }

  async function invokeSkip(event, rawArguments) {
    try {
      assertActiveSender(event, options.mainWindowRef);
      if (rawArguments.length !== 1) throw ipcError('builder_check_run_approval_invalid');
      const request = safeReadRequest(rawArguments[0]);
      return safeSkipResult(await Reflect.apply(
        options.skipCurrentDraftCheck,
        undefined,
        [request],
      ), request);
    } catch (error) {
      throw normalizeError(error);
    }
  }

  return Object.freeze({
    adapter_id: 'builder-check-run-approval.controlled-ipc-adapter.v1',
    channels: Object.freeze({
      readCurrentDraftAvailableChecks: Object.freeze({
        channel: READ_CURRENT_DRAFT_AVAILABLE_CHECKS_CHANNEL,
        method: 'readCurrentDraftAvailableChecks',
        invoke(event, ...rawArguments) { return invokeRead(event, rawArguments); },
      }),
      diagnoseCurrentDraftCheckEnvironment: Object.freeze({
        channel: DIAGNOSE_CURRENT_DRAFT_CHECK_ENVIRONMENT_CHANNEL,
        method: 'diagnoseCurrentDraftCheckEnvironment',
        invoke(event, ...rawArguments) { return invokeDiagnose(event, rawArguments); },
      }),
      diagnoseProjectEnvironment: Object.freeze({
        channel: DIAGNOSE_PROJECT_ENVIRONMENT_CHANNEL,
        method: 'diagnoseProjectEnvironment',
        invoke(event, ...rawArguments) { return invokeProjectDiagnose(event, rawArguments); },
      }),
      prepareProjectDependencies: Object.freeze({
        channel: PREPARE_PROJECT_DEPENDENCIES_CHANNEL,
        method: 'prepareProjectDependencies',
        invoke(event, ...rawArguments) {
          return invokePrepareProjectDependencies(event, rawArguments);
        },
      }),
      approveAndRunCurrentDraftCheck: Object.freeze({
        channel: APPROVE_CURRENT_DRAFT_CHECK_CHANNEL,
        method: 'approveAndRunCurrentDraftCheck',
        invoke(event, ...rawArguments) { return invokeApproveAndRun(event, rawArguments); },
      }),
      decideCurrentDraftDependencyPreparation: Object.freeze({
        channel: DECIDE_CURRENT_DRAFT_DEPENDENCY_PREPARATION_CHANNEL,
        method: 'decideCurrentDraftDependencyPreparation',
        invoke(event, ...rawArguments) {
          return invokeDecideDependencyPreparation(event, rawArguments);
        },
      }),
      skipCurrentDraftCheck: Object.freeze({
        channel: SKIP_CURRENT_DRAFT_CHECK_CHANNEL,
        method: 'skipCurrentDraftCheck',
        invoke(event, ...rawArguments) { return invokeSkip(event, rawArguments); },
      }),
    }),
    exposed_methods: Object.freeze([
      'readCurrentDraftAvailableChecks',
      'diagnoseCurrentDraftCheckEnvironment',
      'diagnoseProjectEnvironment',
      'prepareProjectDependencies',
      'approveAndRunCurrentDraftCheck',
      'decideCurrentDraftDependencyPreparation',
      'skipCurrentDraftCheck',
    ]),
    authority: Object.freeze({
      renderer_authority: 'current_draft_and_displayed_profile_identity_only',
      approval_authority: 'main_owned_explicit_one_shot_check_run_approval',
      active_renderer_required: true,
      source_tree: false,
      script_body: false,
      raw_output: false,
      runtime_paths: false,
      provider_dispatch: false,
      source_mutation: false,
      git_mutation: false,
      save_authority: false,
      direct_electron_registration: false,
      direct_preload_exposure: false,
    }),
  });
}

module.exports = Object.freeze({
  APPROVE_CURRENT_DRAFT_CHECK_CHANNEL,
  DECIDE_CURRENT_DRAFT_DEPENDENCY_PREPARATION_CHANNEL,
  DIAGNOSE_CURRENT_DRAFT_CHECK_ENVIRONMENT_CHANNEL,
  DIAGNOSE_PROJECT_ENVIRONMENT_CHANNEL,
  PREPARE_PROJECT_DEPENDENCIES_CHANNEL,
  READ_CURRENT_DRAFT_AVAILABLE_CHECKS_CHANNEL,
  SKIP_CURRENT_DRAFT_CHECK_CHANNEL,
  BuilderCheckRunApprovalIpcError,
  createBuilderCheckRunApprovalIpcAdapter,
});
