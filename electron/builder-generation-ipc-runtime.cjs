'use strict';

const { spawn } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { types: utilTypes } = require('node:util');

const {
  ANSWER_CHANNEL,
  ANSWER_PLAN_CHANNEL,
  ANSWER_DRAFT_CHANNEL,
  AVAILABILITY_CHANNEL,
  APPROVE_CURRENT_PROJECT_WRITE_CHANNEL,
  APPROVE_PLAN_SOURCE_READ_CHANNEL,
  CANCEL_CHANNEL,
  COMMAND_APPROVAL_REQUESTED_CHANNEL,
  COMMAND_OUTPUT_CHANNEL,
  DECIDE_COMMAND_APPROVAL_CHANNEL,
  CLASSIFY_INTENT_CHANNEL,
  CONTINUE_DRAFT_CHANNEL,
  GENERATE_APPROVED_PLAN_CHANNEL,
  GENERATE_CHANNEL,
  GENERATION_OUTPUT_CHANNEL,
  GENERATION_STARTED_CHANNEL,
  MANUAL_COMPACT_CONTEXT_CHANNEL,
  PREPARE_CURRENT_PROJECT_WRITE_APPROVAL_CHANNEL,
  PREPARE_PLAN_SOURCE_READ_APPROVAL_CHANNEL,
  PROPOSE_PLAN_CHANNEL,
  QUEUE_FOLLOWUP_CHANNEL,
  REJECT_DRAFT_CHANNEL,
  RESTORE_DRAFT_CHANNEL,
  RESTORE_PREVIOUS_CHECKPOINT_AS_DRAFT_CHANNEL,
  RESTORE_REVISION_AS_DRAFT_CHANNEL,
  RETRY_GENERATE_CHANNEL,
  RESUME_INTERRUPTED_RUN_CHANNEL,
  STEER_CHANNEL,
  SUBMIT_CHANNEL,
  createBuilderGenerationIpcAdapter,
} = require('./builder-generation-ipc-adapter.cjs');
const {
  createBuilderGenerationMainService,
} = require('./builder-generation-main-service.cjs');
const {
  createDefaultBuilderHarnessRuntimeComposition,
} = require('./builder-harness-runtime-composition.cjs');
const {
  createBuilderRuntimeWorkspaceSnapshotStore,
} = require('./builder-runtime-workspace-snapshot-store.cjs');
const {
  createBuilderConversationMainService,
} = require('./builder-conversation-main-service.cjs');
const {
  createBuilderAgentConversationService,
} = require('./builder-agent-conversation-service.cjs');
const { createBuilderAgentPlanStore } = require('./builder-agent-plan-store.cjs');
const { createBuilderAgentPlanService, createBuilderAgentPlanTaskObjective } = require('./builder-agent-plan-service.cjs');
const {
  createBuilderAgentConversationWorkbenchRecordingService,
} = require('./builder-agent-conversation-workbench-recording-service.cjs');
const {
  createBuilderWorkbenchMessageStore,
} = require('./builder-workbench-message-store.cjs');
const {
  createBuilderWorkbenchTimelineProjection,
} = require('./builder-workbench-timeline-projection.cjs');
const {
  createBuilderWorkbenchTaskMonitorProjection,
} = require('./builder-workbench-task-monitor-projection.cjs');
const {
  createBuilderTaskAttentionStore,
} = require('./builder-task-attention-store.cjs');
const {
  createBuilderProjectTaskLeaseCoordinator,
} = require('./builder-project-task-lease-coordinator.cjs');
const {
  createBuilderTaskWorkbenchResultRecordingService,
} = require('./builder-task-workbench-result-recording-service.cjs');
const {
  READ_AGENT_WORKBENCH_CHANNEL,
  UPDATE_WORKBENCH_MESSAGE_STATE_CHANNEL,
  CREATE_WORKBENCH_TASK_PROPOSAL_CHANNEL,
  DECIDE_WORKBENCH_TASK_PROPOSAL_CHANNEL,
  DECIDE_AGENT_PLAN_CHANNEL,
  CONTROL_WORKBENCH_TASK_CHANNEL,
  WORKBENCH_CHANGED_CHANNEL,
  createBuilderWorkbenchIpcAdapter,
} = require('./builder-workbench-ipc-adapter.cjs');
const {
  createBuilderWorkbenchTaskProposalStore,
} = require('./builder-workbench-task-proposal-store.cjs');
const {
  createBuilderWorkbenchTaskIncubationService,
} = require('./builder-workbench-task-incubation-service.cjs');
const {
  createBuilderConversationTranscriptArchive,
} = require('./builder-conversation-transcript-archive.cjs');
const {
  createBuilderProjectSaveAuthority,
} = require('./builder-project-save-authority.cjs');
const {
  CREATE_LOCAL_PROJECT_CHANNEL,
  OPEN_PROJECT_LOCATION_CHANNEL,
  OPEN_PROJECT_CHANNEL,
  SAVE_DRAFT_CHANNEL,
  LOAD_CURRENT_CHANNEL,
  LOAD_REVISION_CHANNEL,
  LIST_CURRENT_CHANNEL,
  LIST_WORKSPACES_CHANNEL,
  LIST_HISTORY_CHANNEL,
  createBuilderProjectWorkspaceIpcAdapter,
} = require('./builder-project-workspace-ipc-adapter.cjs');
const {
  READ_TASK_STREAM_CHANNEL,
  TASK_STREAM_CHANGED_CHANNEL,
  createBuilderTaskStreamIpcAdapter,
} = require('./builder-task-stream-ipc-adapter.cjs');
const {
  REVIEW_PLAN_CHANNEL,
  createBuilderPlanReviewIpcAdapter,
} = require('./builder-plan-review-ipc-adapter.cjs');
const {
  createBuilderOpenAICompatibleTransport,
} = require('./builder-openai-compatible-transport.cjs');
const {
  BuilderGenerationKernelError,
  createBuilderGenerationRequest,
} = require('./builder-generation-kernel.cjs');
const {
  inspectBuilderLocalWorkspaceSourceTree,
  readBuilderLocalWorkspaceSourceTree,
} = require('./builder-local-workspace-source-tree.cjs');
const {
  GIT_RUNTIME_DIRECTORY,
  METADATA_DATABASE,
  METADATA_DIRECTORY,
  PROJECT_REPOSITORY_DIRECTORY,
  createBuilderProjectMainAuthority,
} = require('./builder-project-main-authority.cjs');
const {
  createBuilderProviderConfigRepository,
} = require('./builder-provider-config-repository.cjs');
const {
  BUILDER_PERMISSION_POLICY_VERSION,
} = require('./builder-permission-authority-contract.cjs');
const {
  createBuilderPermissionFactStore,
} = require('./builder-permission-fact-store.cjs');
const {
  LOCAL_BUILDER_USER_ACTOR_ID,
  PERMISSION_DATABASE,
  PERMISSION_DIRECTORY,
} = require('./builder-permission-ipc-runtime.cjs');
const {
  createBuilderToolPermissionAdmission,
} = require('./builder-tool-permission-admission.cjs');
const {
  createBuilderProviderContextDisclosureDecisionService,
} = require('./builder-provider-context-disclosure-decision.cjs');
const {
  createBuilderProviderContextDisclosureStatusService,
} = require('./builder-provider-context-disclosure-status-service.cjs');
const {
  createBuilderToolSourceContextCollector,
} = require('./builder-tool-source-context-collector.cjs');
const {
  createBuilderTaskCapsuleStore,
} = require('./builder-task-capsule-store.cjs');
const {
  createBuilderTaskCapsuleRecordingService,
} = require('./builder-task-capsule-recording-service.cjs');
const {
  createBuilderSessionTaskAddressStore,
} = require('./builder-session-task-address-store.cjs');
const {
  createBuilderProjectLifecycleStore,
} = require('./builder-project-lifecycle-store.cjs');
const {
  createBuilderSessionTaskAddressRecordingService,
} = require('./builder-session-task-address-recording-service.cjs');
const {
  createBuilderSessionTaskTargetService,
} = require('./builder-session-task-target-service.cjs');
const {
  createBuilderSessionTaskAddressBindingService,
} = require('./builder-session-task-address-binding-service.cjs');
const {
  createBuilderAgentDefinitionStore,
} = require('./builder-agent-definition-store.cjs');
const {
  DEFAULT_BUILDER_AGENT_ID,
  createBuilderDefaultAgentBootstrap,
} = require('./builder-default-agent-bootstrap.cjs');
const {
  BUILDER_PRODUCT_METADATA_SCHEMA_VERSION,
  BUILDER_PRODUCT_METADATA_USER_VERSION,
} = require('./builder-product-metadata-schema.cjs');
const {
  createBuilderAgentProjectTreeProjection,
} = require('./builder-agent-project-tree-projection.cjs');
const {
  ARCHIVE_AGENT_PROJECT_CHANNEL,
  ARCHIVE_AGENT_TASK_CHANNEL,
  EXPORT_AGENT_TASK_TRANSCRIPT_CHANNEL,
  READ_AGENT_PROJECT_TREE_CHANNEL,
  RENAME_AGENT_PROJECT_CHANNEL,
  RENAME_AGENT_TASK_CHANNEL,
  createBuilderAgentProjectTreeIpcAdapter,
} = require('./builder-agent-project-tree-ipc-adapter.cjs');
const {
  createBuilderTaskTranscriptExport,
} = require('./builder-task-transcript-export.cjs');
const {
  createBuilderContextCompactionSummaryStore,
} = require('./builder-context-compaction-summary-store.cjs');
const {
  createBuilderContextCompactionRecordingService,
} = require('./builder-context-compaction-recording-service.cjs');
const {
  createBuilderHandoffPacketStore,
} = require('./builder-handoff-packet-store.cjs');
const {
  createBuilderWorkingContextStateService,
} = require('./builder-working-context-state-service.cjs');
const {
  createBuilderProjectUnderstandingStore,
} = require('./builder-project-understanding-store.cjs');
const {
  createBuilderProjectUnderstandingService,
} = require('./builder-project-understanding-service.cjs');
const {
  createBuilderDraftCheckpointStore,
} = require('./builder-draft-checkpoint-store.cjs');
const {
  createBuilderDraftCheckpointRecordingService,
} = require('./builder-draft-checkpoint-recording-service.cjs');
const {
  createBuilderAutomaticDraftCheckpointService,
} = require('./builder-automatic-draft-checkpoint-service.cjs');
const {
  createBuilderCheckRunStore,
} = require('./builder-check-run-store.cjs');
const {
  createBuilderCheckSkipDecisionStore,
} = require('./builder-check-skip-decision-store.cjs');
const {
  createBuilderCheckRunStatusService,
} = require('./builder-check-run-status-service.cjs');
const {
  createBuilderCheckRunActivityRegistry,
} = require('./builder-check-run-activity-registry.cjs');
const {
  createBuilderCheckRunSaveGate,
} = require('./builder-check-run-save-gate.cjs');
const {
  createBuilderCheckRunProcessAdapter,
} = require('./builder-check-run-process-adapter.cjs');
const {
  createBuilderCheckRunRuntimeComposition,
} = require('./builder-check-run-runtime-composition.cjs');
const {
  createBuilderProjectEnvironmentDiagnosisService,
} = require('./builder-project-environment-diagnosis.cjs');
const {
  createBuilderProjectDependencyPreparer,
} = require('./builder-project-dependency-preparer.cjs');
const {
  createBuilderLivePreviewCurrentDraftSourceService,
} = require('./builder-live-preview-current-draft-source-service.cjs');
const { builderPerformanceTrace } = require('./builder-performance-trace.cjs');

const BUILDER_GENERATION_IPC_RUNTIME_VERSION = 'builder-generation-ipc-runtime.v2';
const TASK_CAPSULE_DIRECTORY = 'builder-task-capsules-v1';
const TASK_CAPSULE_DATABASE = 'task-capsules.sqlite';
const PROJECT_UNDERSTANDING_DIRECTORY = 'builder-project-understandings-v1';
const PROJECT_UNDERSTANDING_DATABASE = 'understanding.sqlite';
const SESSION_TASK_ADDRESS_DIRECTORY = 'builder-session-task-addresses-v2';
const SESSION_TASK_ADDRESS_DATABASE = 'session-task-addresses.sqlite';
const PROJECT_LIFECYCLE_DIRECTORY = 'builder-project-lifecycle-v1';
const PROJECT_LIFECYCLE_DATABASE = 'project-lifecycle.sqlite';
const AGENT_DEFINITION_DIRECTORY = 'builder-agent-definitions-v1';
const AGENT_DEFINITION_DATABASE = 'agent-definitions.sqlite';
const AGENT_CONVERSATION_DIRECTORY = 'builder-agent-conversations-v1';
const AGENT_CONVERSATION_DATABASE = 'agent-conversations.sqlite';
const AGENT_PLAN_DIRECTORY = 'builder-agent-plans-v1';
const AGENT_PLAN_DATABASE = 'agent-plans.sqlite';
const WORKBENCH_MESSAGE_DIRECTORY = 'builder-agent-workbench-messages-v1';
const WORKBENCH_MESSAGE_DATABASE = 'workbench-messages.sqlite';
const WORKBENCH_TASK_PROPOSAL_DATABASE = 'workbench-task-proposals.sqlite';
const TASK_ATTENTION_DATABASE = 'task-attention.sqlite';
const DRAFT_CHECKPOINT_DIRECTORY = 'builder-draft-checkpoints-v1';
const DRAFT_CHECKPOINT_DATABASE = 'draft-checkpoints.sqlite';
const CHECK_RUN_DIRECTORY = 'builder-check-runs-v1';
const CHECK_RUN_DATABASE = 'check-runs.sqlite';
const CHECK_SKIP_DECISION_DIRECTORY = 'builder-check-skip-decisions-v1';
const CHECK_SKIP_DECISION_DATABASE = 'check-skip-decisions.sqlite';
const PACKAGED_CHECK_WORKER = 'builder-packaged-check-script-worker.cjs';
const CONTEXT_COMPACTION_SUMMARY_DIRECTORY = 'builder-context-compaction-summaries-v1';
const CONTEXT_COMPACTION_SUMMARY_DATABASE = 'context-compaction-summaries.sqlite';
const HANDOFF_PACKET_DIRECTORY = 'builder-handoff-packets-v1';
const HANDOFF_PACKET_DATABASE = 'handoff-packets.sqlite';
const HARNESS_EXECUTION_DIRECTORY = 'builder-harness-execution-v1';
const HARNESS_SESSION_DIRECTORY = 'builder-harness-sessions-v1';
const STRUCTURED_RUNTIME_WORKSPACE_SNAPSHOT_DIRECTORY =
  'builder-structured-runtime-workspace-snapshots-v1';
const RUNTIME_WORKSPACE_SOURCE_SERVICE_VERSION =
  'builder-runtime-workspace-source-service.v1';
const PROJECT_WORKSPACE_PATH_SERVICE_VERSION =
  'builder-project-workspace-path-service.v1';
const LOCAL_BUILDER_AGENT_ID = DEFAULT_BUILDER_AGENT_ID;
const PACKAGED_CANARY_SENTINEL = 'BUILDER_PACKAGED_CANARY';
const PACKAGED_CANARY_USER_DATA_PREFIX = 'clawfabric-builder-packaged-canary-';
const PACKAGED_CANARY_GENERATION_DEBUG_FILE = 'builder-canary-generation-debug.jsonl';
const PACKAGED_CANARY_RUNTIME_IDLE_TIMEOUT_MS =
  'BUILDER_PACKAGED_CANARY_RUNTIME_IDLE_TIMEOUT_MS';
const OPTION_KEYS = Object.freeze([
  'fetchImpl',
  'grantPermissionForExplicitApproval',
  'ipcMain',
  'mainWindowRef',
  'openPath',
  'userDataPath',
  'showOpenDialog',
  'agentTestBrowserRuntime',
]);
const REQUIRED_OPTION_KEYS = Object.freeze([
  'fetchImpl',
  'grantPermissionForExplicitApproval',
  'ipcMain',
  'mainWindowRef',
  'userDataPath',
]);
const ERROR_MESSAGE = 'AI project generation is unavailable.';
const PROJECT_ID_PATTERN = /^builder-project:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const TASK_ADDRESS_ID_PATTERN = /^builder-task-address:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DRAFT_ID_PATTERN = /^builder-generation-draft:[0-9a-f]{64}$/u;

function packagedCheckWorkerPath(runtimeDirectory = __dirname) {
  const archiveRoot = path.dirname(runtimeDirectory);
  if (path.basename(archiveRoot).toLowerCase() === 'app.asar') {
    return path.join(
      `${archiveRoot}.unpacked`,
      path.basename(runtimeDirectory),
      PACKAGED_CHECK_WORKER,
    );
  }
  return path.join(runtimeDirectory, PACKAGED_CHECK_WORKER);
}

function packagedHarnessConfigPath(runtimeDirectory = __dirname) {
  const archiveRoot = path.dirname(runtimeDirectory);
  const effectiveRuntimeDirectory = path.basename(archiveRoot).toLowerCase() === 'app.asar'
    ? path.join(`${archiveRoot}.unpacked`, path.basename(runtimeDirectory))
    : runtimeDirectory;
  return path.join(effectiveRuntimeDirectory, 'harness', 'builder-coding-loop.cordis.yml');
}

function recordCanaryTaskStreamReadFailure(userDataPath, event) {
  try {
    if (
      process.env[PACKAGED_CANARY_SENTINEL] !== '1'
      || !path.basename(userDataPath).startsWith(PACKAGED_CANARY_USER_DATA_PREFIX)
      || event?.diagnostic_version !== 'builder-task-stream-read-failure.v1'
      || typeof event?.stage !== 'string'
    ) return;
    fs.appendFileSync(
      path.join(userDataPath, PACKAGED_CANARY_GENERATION_DEBUG_FILE),
      `${JSON.stringify({
        result_version: 'builder-canary-generation-debug.v1',
        phase: `task_stream_${event.stage}`,
        code: 'builder_task_stream_unavailable',
      })}\n`,
      { encoding: 'utf8' },
    );
  } catch {
    // Canary diagnostics must never alter runtime behavior.
  }
}

function recordCanarySaveFailure(userDataPath, error) {
  try {
    if (
      process.env[PACKAGED_CANARY_SENTINEL] !== '1'
      || !path.basename(userDataPath).startsWith(PACKAGED_CANARY_USER_DATA_PREFIX)
    ) return;
    const descriptor = error !== null && (typeof error === 'object' || typeof error === 'function')
      ? Object.getOwnPropertyDescriptor(error, 'code')
      : null;
    const sourceCode = descriptor && Object.hasOwn(descriptor, 'value')
      && typeof descriptor.value === 'string'
      ? descriptor.value
      : null;
    const code = [
      'builder_project_save_invalid',
      'builder_project_save_not_found',
      'builder_project_save_conflict',
      'builder_project_save_unavailable',
    ].includes(sourceCode) ? sourceCode : 'builder_project_save_unavailable';
    fs.appendFileSync(
      path.join(userDataPath, PACKAGED_CANARY_GENERATION_DEBUG_FILE),
      `${JSON.stringify({
        result_version: 'builder-canary-generation-debug.v1',
        phase: 'save_draft',
        code,
      })}\n`,
      { encoding: 'utf8' },
    );
  } catch {
    // Canary diagnostics must never alter runtime behavior.
  }
}

function mainOwnedProgrammingRuntimeFeatureFlag(
  configuredValue = process.env.BUILDER_PROGRAMMING_RUNTIME,
) {
  if (configuredValue === undefined) return 'enabled';
  return ['disabled', 'shadow', 'enabled'].includes(configuredValue)
    ? configuredValue
    : 'disabled';
}

function bundledHarnessRuntimeRoot(resourcesDirectory = process.resourcesPath) {
  if (
    typeof resourcesDirectory !== 'string'
    || resourcesDirectory.length === 0
    || resourcesDirectory.includes('\0')
    || !path.isAbsolute(resourcesDirectory)
    || path.normalize(resourcesDirectory) !== resourcesDirectory
  ) return null;
  const candidate = path.join(resourcesDirectory, 'harness-runtime.asar');
  try {
    const info = fs.statSync(candidate);
    return info.isFile() || info.isDirectory() ? candidate : null;
  } catch {
    return null;
  }
}

function createOptionalHarnessRuntimeComposition(userDataPath, featureFlag, callbacks = {}) {
  if (featureFlag === 'disabled') return null;
  const configuredRuntimeRoot = process.env.BUILDER_HARNESS_RUNTIME_ROOT;
  const runtimeRoot = typeof configuredRuntimeRoot === 'string' && configuredRuntimeRoot.length > 0
    ? configuredRuntimeRoot
    : bundledHarnessRuntimeRoot();
  if (typeof runtimeRoot !== 'string' || runtimeRoot.length === 0) return null;
  const executionRoot = path.join(userDataPath, HARNESS_EXECUTION_DIRECTORY);
  const sessionRoot = path.join(userDataPath, HARNESS_SESSION_DIRECTORY);
  const canaryIdleTimeoutSource = process.env[PACKAGED_CANARY_RUNTIME_IDLE_TIMEOUT_MS];
  const canaryIdleTimeoutMs = (
    process.env[PACKAGED_CANARY_SENTINEL] === '1'
    && path.basename(userDataPath).startsWith(PACKAGED_CANARY_USER_DATA_PREFIX)
    && typeof canaryIdleTimeoutSource === 'string'
    && /^[1-9][0-9]{2,4}$/u.test(canaryIdleTimeoutSource)
    && Number(canaryIdleTimeoutSource) <= 60_000
  ) ? Number(canaryIdleTimeoutSource) : null;
  fs.mkdirSync(executionRoot, { recursive: true, mode: 0o700 });
  try {
    return createDefaultBuilderHarnessRuntimeComposition({
      runtime_root: path.normalize(runtimeRoot),
      config_path: packagedHarnessConfigPath(),
      execution_root: executionRoot,
      session_root: sessionRoot,
      worker_path: packagedCheckWorkerPath(),
      on_command_approval_requested: callbacks.on_command_approval_requested ?? (() => undefined),
      on_command_output: callbacks.on_command_output ?? (() => undefined),
      ...(callbacks.agent_test_browser_runtime === undefined ? {} : {
        agent_test_browser_runtime: callbacks.agent_test_browser_runtime,
      }),
      ...(canaryIdleTimeoutMs !== null
        ? { supervision_policy: { runtime_idle_timeout_ms: canaryIdleTimeoutMs } }
        : {}),
    });
  } catch {
    return null;
  }
}
const REQUEST_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const CONVERSATION_ID_PATTERN = /^builder-conversation:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?::[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})?$/u;
const AGENT_CONVERSATION_ID_PATTERN = /^builder-agent-conversation:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const AGENT_ID_PATTERN = /^builder-agent:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const TURN_ID_PATTERN = /^builder-turn:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const TASK_ID_PATTERN = /^builder-task:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const RUN_ID_PATTERN = /^builder-run:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MESSAGE_ID_PATTERN = /^builder-message:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MAX_DISPLAY_DELTA_TEXT_BYTES = 16 * 1024;
const MAX_PLAN_CONTEXT_RESOURCES = 8;
const MAX_PROJECT_RESOURCE_ID_LENGTH = 128;
const MAX_WORKSPACE_PLAN_SCAN_ENTRIES = 2_048;
const PLAN_RESOURCE_ID_PATTERN = /^project:\/[a-z0-9._/@-]{1,120}$/u;
const PLAN_WORKSPACE_DIRECTORY_SKIP_NAMES = new Set([
  '.git',
  '.hg',
  '.svn',
  '.clawfabric',
  'coverage',
  'dist',
  'node_modules',
]);
const PRODUCT_METADATA_DATABASE_ID = 'builder-product-metadata-database.v3';

class BuilderGenerationIpcRuntimeError extends Error {
  constructor() {
    super(ERROR_MESSAGE);
    this.name = 'BuilderGenerationIpcRuntimeError';
    this.code = 'builder_generation_ipc_runtime_unavailable';
    this.retryable = false;
    this.stack = `${this.name}: ${this.message}`;
  }
}

class BuilderGenerationProjectWorkspaceRequiredError extends Error {
  constructor() {
    super('Choose or open a project folder before building.');
    this.name = 'BuilderGenerationProjectWorkspaceRequiredError';
    this.code = 'builder_generation_project_workspace_required';
    this.retryable = false;
    this.stack = `${this.name}: ${this.message}`;
  }
}

class BuilderGenerationProjectWritePermissionRequiredError extends Error {
  constructor() {
    super('Allow current project changes before building.');
    this.name = 'BuilderGenerationProjectWritePermissionRequiredError';
    this.code = 'builder_generation_project_write_permission_required';
    this.retryable = false;
    this.stack = `${this.name}: ${this.message}`;
  }
}

class BuilderGenerationWorkspaceChangedError extends Error {
  constructor() {
    super('The project changed while AI was working. Review it and try again.');
    this.name = 'BuilderGenerationWorkspaceChangedError';
    this.code = 'builder_generation_workspace_changed';
    this.retryable = true;
    this.stack = `${this.name}: ${this.message}`;
  }
}

class BuilderGenerationProjectBusyError extends Error {
  constructor() {
    super('Another task is changing this project. Open that task or try again later.');
    this.name = 'BuilderGenerationProjectBusyError';
    this.code = 'builder_generation_project_busy';
    this.retryable = true;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderGenerationIpcRuntimeError();
}

function failGenerationProjectWorkspaceRequired() {
  throw new BuilderGenerationProjectWorkspaceRequiredError();
}

function failGenerationProjectWritePermissionRequired() {
  throw new BuilderGenerationProjectWritePermissionRequiredError();
}

function failGenerationBaseUnavailable() {
  throw new BuilderGenerationKernelError('builder_generation_base_unavailable');
}

function failGenerationWorkspaceChanged() {
  throw new BuilderGenerationWorkspaceChangedError();
}

function failGenerationProjectBusy() {
  throw new BuilderGenerationProjectBusyError();
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

function stableMethod(value, key) {
  let cursor = value;
  while (cursor !== null) {
    if (utilTypes.isProxy(cursor)) fail();
    const descriptor = Object.getOwnPropertyDescriptor(cursor, key);
    if (descriptor) {
      if (!Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') fail();
      return descriptor.value;
    }
    cursor = Object.getPrototypeOf(cursor);
  }
  fail();
}

function exactDataValue(value, keys, key) {
  if (!isPlainObject(value)) fail();
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== keys.length
    || ownKeys.some((ownKey) => typeof ownKey !== 'string' || !keys.includes(ownKey))
  ) fail();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const expectedKey of keys) {
    const descriptor = descriptors[expectedKey];
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  }
  return descriptors[key].value;
}

function exactDataDescriptors(value, keys) {
  if (!isPlainObject(value)) fail();
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== keys.length
    || ownKeys.some((ownKey) => typeof ownKey !== 'string' || !keys.includes(ownKey))
  ) fail();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const expectedKey of keys) {
    const descriptor = descriptors[expectedKey];
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  }
  return descriptors;
}

function denseDataArray(value, maximum) {
  if (!Array.isArray(value) || utilTypes.isProxy(value) || value.length > maximum) fail();
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== value.length + 1
    || keys.some((key) => typeof key === 'symbol')
    || !keys.includes('length')
  ) fail();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  }
  return value;
}

function publicInstruction(rawRequest) {
  return publicInstructionRequest(rawRequest).instruction;
}

function queuedFollowupReference(rawReference) {
  const descriptors = exactDataDescriptors(rawReference, ['turn_id', 'run_id', 'message_id']);
  if (
    typeof descriptors.turn_id.value !== 'string'
    || !TURN_ID_PATTERN.test(descriptors.turn_id.value)
    || typeof descriptors.run_id.value !== 'string'
    || !RUN_ID_PATTERN.test(descriptors.run_id.value)
    || typeof descriptors.message_id.value !== 'string'
    || !MESSAGE_ID_PATTERN.test(descriptors.message_id.value)
  ) fail();
  return Object.freeze({
    turn_id: descriptors.turn_id.value,
    run_id: descriptors.run_id.value,
    message_id: descriptors.message_id.value,
  });
}

function publicInstructionRequest(rawRequest) {
  try {
    if (!isPlainObject(rawRequest)) throw new Error();
    const ownKeys = Reflect.ownKeys(rawRequest);
    const hasQueuedFollowup = ownKeys.includes('queued_followup');
    const hasTaskAddressId = ownKeys.includes('task_address_id');
    if (
      ownKeys.length !== 1 + Number(hasQueuedFollowup) + Number(hasTaskAddressId)
      || !ownKeys.includes('instruction')
      || (hasQueuedFollowup && !ownKeys.includes('queued_followup'))
    ) throw new Error();
    const descriptor = Object.getOwnPropertyDescriptor(rawRequest, 'instruction');
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      throw new Error();
    }
    return Object.freeze({
      instruction: descriptor.value,
      task_address_id: hasTaskAddressId
        ? (() => {
          const taskAddressId = Object.getOwnPropertyDescriptor(rawRequest, 'task_address_id')?.value;
          if (taskAddressId !== null && (
            typeof taskAddressId !== 'string'
            || !TASK_ADDRESS_ID_PATTERN.test(taskAddressId)
          )) throw new Error();
          return taskAddressId;
        })()
        : null,
      queued_followup: hasQueuedFollowup
        ? queuedFollowupReference(Object.getOwnPropertyDescriptor(rawRequest, 'queued_followup')?.value)
        : null,
    });
  } catch {
    throw new BuilderGenerationKernelError('builder_generation_request_invalid');
  }
}

function draftContinuationRequest(rawRequest) {
  try {
    if (!isPlainObject(rawRequest)) throw new Error();
    const keys = Reflect.ownKeys(rawRequest);
    const hasQueuedFollowup = keys.includes('queued_followup');
    const descriptors = exactDataDescriptors(
      rawRequest,
      hasQueuedFollowup
        ? ['draft_id', 'instruction', 'queued_followup']
        : ['draft_id', 'instruction'],
    );
    const draftId = descriptors.draft_id.value;
    if (typeof draftId !== 'string' || !DRAFT_ID_PATTERN.test(draftId)) throw new Error();
    return Object.freeze({
      draft_id: draftId,
      instruction: descriptors.instruction.value,
      queued_followup: hasQueuedFollowup
        ? queuedFollowupReference(descriptors.queued_followup.value)
        : null,
    });
  } catch {
    throw new BuilderGenerationKernelError('builder_generation_request_invalid');
  }
}

function draftAnswerRequest(rawRequest) {
  try {
    const descriptors = exactDataDescriptors(rawRequest, ['draft_id', 'instruction']);
    const draftId = descriptors.draft_id.value;
    if (typeof draftId !== 'string' || !DRAFT_ID_PATTERN.test(draftId)) throw new Error();
    return Object.freeze({
      draft_id: draftId,
      instruction: descriptors.instruction.value,
    });
  } catch {
    throw new BuilderGenerationKernelError('builder_generation_request_invalid');
  }
}

function draftOnlyRequest(rawRequest) {
  try {
    const descriptors = exactDataDescriptors(rawRequest, ['draft_id']);
    const draftId = descriptors.draft_id.value;
    if (typeof draftId !== 'string' || !DRAFT_ID_PATTERN.test(draftId)) throw new Error();
    return Object.freeze({ draft_id: draftId });
  } catch {
    throw new BuilderGenerationKernelError('builder_generation_request_invalid');
  }
}

function openProjectId(rawRequest) {
  const projectId = exactDataValue(rawRequest, ['project_id'], 'project_id');
  if (projectId !== null && (typeof projectId !== 'string' || !PROJECT_ID_PATTERN.test(projectId))) fail();
  return projectId;
}

function requiredProjectId(rawRequest) {
  const projectId = openProjectId(rawRequest);
  if (projectId === null) fail();
  return projectId;
}

function safePublicWorkspaceText(value, maximum) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > maximum * 2
    || value.length > maximum
    || value.trim() !== value
    || value.includes('\0')
  ) fail();
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) fail();
  }
  return value;
}

function createLocalProjectRequest(rawRequest) {
  const projectId = exactDataValue(rawRequest, ['project_id', 'project_title'], 'project_id');
  if (projectId !== null && (typeof projectId !== 'string' || !PROJECT_ID_PATTERN.test(projectId))) fail();
  return Object.freeze({
    project_id: projectId,
    project_title: safePublicWorkspaceText(
      exactDataValue(rawRequest, ['project_id', 'project_title'], 'project_title'),
      80,
    ),
  });
}

function verifiedProjectIdentityId(value, expectedProjectId) {
  if (!isPlainObject(value)) fail();
  const operation = Object.getOwnPropertyDescriptor(value, 'operation');
  const project = Object.getOwnPropertyDescriptor(value, 'project');
  if (
    !operation
    || operation.value !== 'project_identity_loaded'
    || !project
    || !isPlainObject(project.value)
  ) fail();
  const projectId = Object.getOwnPropertyDescriptor(project.value, 'project_id');
  if (!projectId || projectId.value !== expectedProjectId) fail();
  return expectedProjectId;
}

function approvalTarget(rawRequest) {
  if (!isPlainObject(rawRequest)) fail();
  const ownKeys = Reflect.ownKeys(rawRequest);
  const hasTaskAddressId = ownKeys.includes('task_address_id');
  const descriptors = exactDataDescriptors(
    rawRequest,
    hasTaskAddressId ? ['project_id', 'task_address_id'] : ['project_id'],
  );
  const projectId = descriptors.project_id.value;
  if (typeof projectId !== 'string' || !PROJECT_ID_PATTERN.test(projectId)) fail();
  const taskAddressId = hasTaskAddressId ? descriptors.task_address_id.value : null;
  if (taskAddressId !== null && (
    typeof taskAddressId !== 'string'
    || !TASK_ADDRESS_ID_PATTERN.test(taskAddressId)
  )) fail();
  return Object.freeze({ project_id: projectId, task_address_id: taskAddressId });
}

function restoreRevisionAsDraftRequest(rawRequest) {
  const projectId = exactDataValue(
    rawRequest,
    ['project_id', 'revision_receipt_digest'],
    'project_id',
  );
  const revisionReceiptDigest = exactDataValue(
    rawRequest,
    ['project_id', 'revision_receipt_digest'],
    'revision_receipt_digest',
  );
  if (
    typeof projectId !== 'string'
    || !PROJECT_ID_PATTERN.test(projectId)
    || typeof revisionReceiptDigest !== 'string'
    || !REQUEST_DIGEST_PATTERN.test(revisionReceiptDigest)
  ) fail();
  return Object.freeze({
    project_id: projectId,
    revision_receipt_digest: revisionReceiptDigest,
  });
}

function approvedPlanGenerationRequest(rawRequest) {
  if (!isPlainObject(rawRequest)) fail();
  const keys = Reflect.ownKeys(rawRequest);
  const expectedKeys = ['project_id', 'conversation_id', 'turn_id', 'run_id'];
  if (
    keys.length !== expectedKeys.length
    || keys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))
  ) fail();
  const descriptors = Object.getOwnPropertyDescriptors(rawRequest);
  for (const key of expectedKeys) {
    const descriptor = descriptors[key];
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  }
  const projectId = descriptors.project_id.value;
  const conversationId = descriptors.conversation_id.value;
  if (
    typeof projectId !== 'string'
    || !PROJECT_ID_PATTERN.test(projectId)
    || typeof conversationId !== 'string'
    || !CONVERSATION_ID_PATTERN.test(conversationId)
    || typeof descriptors.turn_id.value !== 'string'
    || !TURN_ID_PATTERN.test(descriptors.turn_id.value)
    || typeof descriptors.run_id.value !== 'string'
    || !RUN_ID_PATTERN.test(descriptors.run_id.value)
  ) fail();
  return Object.freeze({
    project_id: projectId,
    conversation_id: conversationId,
    turn_id: descriptors.turn_id.value,
    run_id: descriptors.run_id.value,
  });
}

function readResultProjectId(value) {
  if (!isPlainObject(value)) fail();
  const receipt = Object.getOwnPropertyDescriptor(value, 'product_revision_receipt');
  if (!receipt || !Object.hasOwn(receipt, 'value') || !isPlainObject(receipt.value)) fail();
  const projectId = Object.getOwnPropertyDescriptor(receipt.value, 'project_id');
  if (
    !projectId
    || !Object.hasOwn(projectId, 'value')
    || typeof projectId.value !== 'string'
    || !PROJECT_ID_PATTERN.test(projectId.value)
  ) fail();
  return projectId.value;
}

function workspaceBoundProjectId(value, expectedProjectId) {
  if (!isPlainObject(value)) fail();
  const operation = Object.getOwnPropertyDescriptor(value, 'operation');
  const workspace = Object.getOwnPropertyDescriptor(value, 'workspace');
  if (
    !operation
    || operation.value !== 'project_workspace_bound'
    || !workspace
    || !isPlainObject(workspace.value)
  ) fail();
  const projectId = Object.getOwnPropertyDescriptor(workspace.value, 'project_id');
  const status = Object.getOwnPropertyDescriptor(workspace.value, 'binding_status');
  if (
    !projectId
    || projectId.value !== expectedProjectId
    || !status
    || status.value !== 'bound'
  ) fail();
  return expectedProjectId;
}

function projectRootPathFromWorkspace(value, expectedProjectId) {
  if (!isPlainObject(value)) fail();
  const operation = Object.getOwnPropertyDescriptor(value, 'operation');
  const workspace = Object.getOwnPropertyDescriptor(value, 'workspace');
  if (
    !operation
    || operation.value !== 'project_workspace_bound'
    || !workspace
    || !isPlainObject(workspace.value)
  ) fail();
  const projectId = Object.getOwnPropertyDescriptor(workspace.value, 'project_id');
  const projectRootPath = Object.getOwnPropertyDescriptor(workspace.value, 'project_root_path');
  const status = Object.getOwnPropertyDescriptor(workspace.value, 'binding_status');
  if (
    !projectId
    || projectId.value !== expectedProjectId
    || !projectRootPath
    || typeof projectRootPath.value !== 'string'
    || projectRootPath.value.length === 0
    || projectRootPath.value.length > 1024
    || projectRootPath.value.trim() !== projectRootPath.value
    || projectRootPath.value.includes('\0')
    || !path.isAbsolute(projectRootPath.value)
    || path.normalize(projectRootPath.value) !== projectRootPath.value
    || !status
    || status.value !== 'bound'
  ) fail();
  return projectRootPath.value;
}

function safeOwnErrorCode(error) {
  try {
    if (error === null || (typeof error !== 'object' && typeof error !== 'function') || utilTypes.isProxy(error)) {
      return null;
    }
    const descriptor = Object.getOwnPropertyDescriptor(error, 'code');
    return descriptor && Object.hasOwn(descriptor, 'value') && typeof descriptor.value === 'string'
      ? descriptor.value
      : null;
  } catch {
    return null;
  }
}

function localProjectSelectionFromWorkspace(value, expectedProjectId) {
  if (!isPlainObject(value)) fail();
  const operation = Object.getOwnPropertyDescriptor(value, 'operation');
  const workspace = Object.getOwnPropertyDescriptor(value, 'workspace');
  if (
    !operation
    || operation.value !== 'project_workspace_bound'
    || !workspace
    || !isPlainObject(workspace.value)
  ) fail();
  const projectId = Object.getOwnPropertyDescriptor(workspace.value, 'project_id');
  const title = Object.getOwnPropertyDescriptor(workspace.value, 'project_title');
  const folders = Object.getOwnPropertyDescriptor(workspace.value, 'source_folders');
  const status = Object.getOwnPropertyDescriptor(workspace.value, 'binding_status');
  if (
    !projectId
    || projectId.value !== expectedProjectId
    || !title
    || !folders
    || !Array.isArray(folders.value)
    || folders.value.length !== 1
    || !status
    || status.value !== 'bound'
  ) fail();
  const folder = folders.value[0];
  if (!isPlainObject(folder)) fail();
  const folderName = Object.getOwnPropertyDescriptor(folder, 'name');
  const folderStatus = Object.getOwnPropertyDescriptor(folder, 'status');
  if (!folderName || !folderStatus || folderStatus.value !== 'selected') fail();
  return Object.freeze({
    result_version: 'builder-project-selection-result.v1',
    operation: 'local_project_bound',
    project_id: expectedProjectId,
    project_title: safePublicWorkspaceText(title.value, 80),
    source_folders: Object.freeze([
      Object.freeze({
        name: safePublicWorkspaceText(folderName.value, 120),
        status: 'selected',
      }),
    ]),
  });
}

function workspaceCatalogItemFromMetadata(value) {
  const descriptors = exactDataDescriptors(value, [
    'project_id',
    'title',
    'source_folders',
    'bound_at_ms',
    'has_current_revision',
    'current_revision_number',
  ]);
  const projectId = descriptors.project_id.value;
  const folders = denseDataArray(descriptors.source_folders.value, 1);
  if (
    typeof projectId !== 'string'
    || !PROJECT_ID_PATTERN.test(projectId)
    || folders.length !== 1
    || !Number.isSafeInteger(descriptors.bound_at_ms.value)
    || descriptors.bound_at_ms.value < 0
    || typeof descriptors.has_current_revision.value !== 'boolean'
    || !Number.isSafeInteger(descriptors.current_revision_number.value)
    || descriptors.current_revision_number.value < 0
    || (descriptors.has_current_revision.value === false && descriptors.current_revision_number.value !== 0)
  ) fail();
  const folderDescriptors = exactDataDescriptors(folders[0], ['name', 'status']);
  if (folderDescriptors.status.value !== 'selected') fail();
  return Object.freeze({
    project_id: projectId,
    title: safePublicWorkspaceText(descriptors.title.value, 80),
    source_folders: Object.freeze([
      Object.freeze({
        name: safePublicWorkspaceText(folderDescriptors.name.value, 120),
        status: 'selected',
      }),
    ]),
    bound_at_ms: descriptors.bound_at_ms.value,
    has_current_revision: descriptors.has_current_revision.value,
    current_revision_number: descriptors.current_revision_number.value,
  });
}

function assertWorkspaceCatalogMetadataEvidence(value) {
  const descriptors = exactDataDescriptors(value, [
    'database_id',
    'schema_fingerprint_digest',
    'schema_version',
    'user_version',
    'runtime_pragmas',
    'transaction',
    'git_object_verification',
    'source_bytes_stored',
    'credential_storage',
    'ui_state_storage',
  ]);
  const pragmas = exactDataDescriptors(descriptors.runtime_pragmas.value, [
    'foreign_keys',
    'journal_mode',
    'synchronous',
    'trusted_schema',
  ]);
  if (
    descriptors.database_id.value !== PRODUCT_METADATA_DATABASE_ID
    || descriptors.schema_version.value !== BUILDER_PRODUCT_METADATA_SCHEMA_VERSION
    || descriptors.user_version.value !== BUILDER_PRODUCT_METADATA_USER_VERSION
    || typeof descriptors.schema_fingerprint_digest.value !== 'string'
    || !REQUEST_DIGEST_PATTERN.test(descriptors.schema_fingerprint_digest.value)
    || descriptors.transaction.value !== 'project_workspace_list_readback'
    || descriptors.git_object_verification.value !== 'not_performed_by_metadata_database'
    || descriptors.source_bytes_stored.value !== false
    || descriptors.credential_storage.value !== 'not_present'
    || descriptors.ui_state_storage.value !== 'not_present'
    || pragmas.foreign_keys.value !== 'on'
    || pragmas.journal_mode.value !== 'wal'
    || pragmas.synchronous.value !== 'full'
    || pragmas.trusted_schema.value !== 'off'
  ) fail();
}

function workspaceCatalogFromMetadata(value) {
  const descriptors = exactDataDescriptors(value, [
    'result_version',
    'operation',
    'workspaces',
    'metadata_evidence',
  ]);
  if (
    descriptors.result_version.value !== 'builder-product-metadata-result.v4'
    || descriptors.operation.value !== 'project_workspaces_listed'
  ) fail();
  assertWorkspaceCatalogMetadataEvidence(descriptors.metadata_evidence.value);
  const workspaces = denseDataArray(descriptors.workspaces.value, 256).map(workspaceCatalogItemFromMetadata);
  const seen = new Set();
  for (const workspace of workspaces) {
    if (seen.has(workspace.project_id)) fail();
    seen.add(workspace.project_id);
  }
  return Object.freeze({
    result_version: 'builder-product-metadata-result.v4',
    operation: 'project_workspaces_listed',
    workspaces: Object.freeze(workspaces),
    metadata_evidence: Object.freeze({
      product_authority: 'sqlite_project_workspace_binding',
      code_authority: 'not_read_for_workspace_list',
      source_read_admission: 'not_requested',
      path_disclosure: 'folder_name_only',
    }),
  });
}

function sameFilesystemPath(left, right) {
  return process.platform === 'win32'
    ? left.toLocaleLowerCase('en-US') === right.toLocaleLowerCase('en-US')
    : left === right;
}

function selectedDirectoryFromDialog(value) {
  if (!isPlainObject(value)) fail();
  const canceled = Object.getOwnPropertyDescriptor(value, 'canceled');
  const filePaths = Object.getOwnPropertyDescriptor(value, 'filePaths');
  if (
    !canceled
    || typeof canceled.value !== 'boolean'
    || !filePaths
    || !Array.isArray(filePaths.value)
  ) fail();
  if (canceled.value) return null;
  if (filePaths.value.length !== 1 || typeof filePaths.value[0] !== 'string') fail();
  const resolved = path.resolve(filePaths.value[0]);
  if (
    resolved !== filePaths.value[0]
    || path.normalize(resolved) !== resolved
    || resolved.length === 0
    || resolved.length > 1024
    || resolved.includes('\0')
    || path.parse(resolved).root === resolved
  ) fail();
  let stat;
  let realPath;
  try {
    stat = fs.lstatSync(resolved);
    realPath = path.resolve(fs.realpathSync.native(resolved));
  } catch {
    fail();
  }
  if (
    !stat.isDirectory()
    || stat.isSymbolicLink()
    || !sameFilesystemPath(realPath, resolved)
    || fs.readdirSync(realPath).length !== 0
  ) fail();
  return realPath;
}

function sourceFolderNameFromRoot(projectRootPath) {
  return safePublicWorkspaceText(path.basename(projectRootPath), 120);
}

function safeProjectSourcePath(value) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > MAX_PROJECT_RESOURCE_ID_LENGTH - 'project:/'.length
    || value.includes('\\')
    || value.startsWith('/')
    || value.endsWith('/')
    || /^[A-Za-z]:/u.test(value)
    || value.startsWith('//')
  ) fail();
  const segments = value.split('/');
  if (
    segments.length === 0
    || segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')
  ) fail();
  return value;
}

function sourceTreeResourceIds(readResult) {
  if (!isPlainObject(readResult)) fail();
  const sourceTree = Object.getOwnPropertyDescriptor(readResult, 'source_tree');
  if (
    !sourceTree
    || sourceTree.enumerable !== true
    || !Object.hasOwn(sourceTree, 'value')
    || !isPlainObject(sourceTree.value)
  ) fail();
  const files = Object.getOwnPropertyDescriptor(sourceTree.value, 'files');
  if (
    !files
    || files.enumerable !== true
    || !Object.hasOwn(files, 'value')
    || !Array.isArray(files.value)
    || utilTypes.isProxy(files.value)
  ) fail();
  const keys = Reflect.ownKeys(files.value);
  if (keys.some((key) => typeof key === 'symbol') || keys.length !== files.value.length + 1) fail();
  const resourceIds = [];
  const seen = new Set();
  for (let index = 0; index < files.value.length; index += 1) {
    const file = Object.getOwnPropertyDescriptor(files.value, String(index));
    if (
      !file
      || file.enumerable !== true
      || !Object.hasOwn(file, 'value')
      || !isPlainObject(file.value)
    ) fail();
    const pathDescriptor = Object.getOwnPropertyDescriptor(file.value, 'path');
    if (
      !pathDescriptor
      || pathDescriptor.enumerable !== true
      || !Object.hasOwn(pathDescriptor, 'value')
    ) fail();
    const resourceId = `project:/${safeProjectSourcePath(pathDescriptor.value)}`;
    if (
      resourceId.length > MAX_PROJECT_RESOURCE_ID_LENGTH
      || !PLAN_RESOURCE_ID_PATTERN.test(resourceId)
    ) continue;
    if (seen.has(resourceId)) fail();
    seen.add(resourceId);
    resourceIds.push(resourceId);
  }
  resourceIds.sort();
  const selected = resourceIds.slice(0, MAX_PLAN_CONTEXT_RESOURCES);
  return Object.freeze(selected);
}

function selectedPlanResourceIdsFromPaths(paths) {
  const resourceIds = [];
  const seen = new Set();
  for (const relativePath of paths) {
    let sourcePath;
    try {
      sourcePath = safeProjectSourcePath(relativePath);
    } catch {
      continue;
    }
    const resourceId = `project:/${sourcePath}`;
    if (
      resourceId.length > MAX_PROJECT_RESOURCE_ID_LENGTH
      || !PLAN_RESOURCE_ID_PATTERN.test(resourceId)
      || seen.has(resourceId)
    ) continue;
    seen.add(resourceId);
    resourceIds.push(resourceId);
  }
  resourceIds.sort();
  return Object.freeze(resourceIds.slice(0, MAX_PLAN_CONTEXT_RESOURCES));
}

function workspacePlanResourceIds(workspaceRootPath) {
  let rootRealPath;
  try {
    const rootStat = fs.lstatSync(workspaceRootPath);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) fail();
    rootRealPath = path.resolve(fs.realpathSync.native(workspaceRootPath));
    if (!sameFilesystemPath(rootRealPath, workspaceRootPath)) fail();
  } catch {
    fail();
  }
  const pending = [Object.freeze({ absolutePath: rootRealPath, relativePath: '' })];
  const filePaths = [];
  let inspected = 0;
  while (pending.length > 0 && inspected < MAX_WORKSPACE_PLAN_SCAN_ENTRIES) {
    const current = pending.shift();
    let entries;
    try {
      entries = fs.readdirSync(current.absolutePath, { withFileTypes: true });
    } catch {
      inspected += 1;
      continue;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));
    for (const entry of entries) {
      inspected += 1;
      if (inspected > MAX_WORKSPACE_PLAN_SCAN_ENTRIES) break;
      if (entry.isSymbolicLink()) continue;
      const relativePath = current.relativePath.length === 0
        ? entry.name
        : `${current.relativePath}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!PLAN_WORKSPACE_DIRECTORY_SKIP_NAMES.has(entry.name.toLowerCase())) {
          pending.push(Object.freeze({
            absolutePath: path.join(current.absolutePath, entry.name),
            relativePath,
          }));
        }
        continue;
      }
      if (entry.isFile()) filePaths.push(relativePath);
    }
  }
  return selectedPlanResourceIdsFromPaths(filePaths);
}

function localWorkspaceReadResult(workspaceRootPath, projectId) {
  return Object.freeze({
    result_version: 'builder-project-local-workspace-read-result.v1',
    operation: 'local_workspace_loaded',
    project_id: projectId,
    source_tree: readBuilderLocalWorkspaceSourceTree(workspaceRootPath),
    authority_evidence: Object.freeze({
      workspace_authority: 'sqlite_bound_project_workspace',
      source_read_authority: 'main_selected_workspace_filesystem_read',
      current_revision: 'not_saved_yet',
    }),
  });
}

function activeWebContents(mainWindowRef) {
  try {
    const windowRef = Reflect.apply(mainWindowRef, undefined, []);
    if (!windowRef || (typeof windowRef.isDestroyed === 'function' && windowRef.isDestroyed())) {
      return null;
    }
    const webContents = windowRef.webContents;
    if (!webContents || (typeof webContents.isDestroyed === 'function' && webContents.isDestroyed())) {
      return null;
    }
    return webContents;
  } catch {
    return null;
  }
}

function taskStreamChangedEvent(rawEvent) {
  if (!isPlainObject(rawEvent)) fail();
  const keys = Reflect.ownKeys(rawEvent);
  const version = Object.getOwnPropertyDescriptor(rawEvent, 'event_version');
  if (
    version
    && version.enumerable === true
    && Object.hasOwn(version, 'value')
    && version.value === 'builder-task-stream-changed.v2'
  ) {
    if (
      keys.length !== 4
      || keys.some((key) => typeof key !== 'string' || ![
        'event_version', 'project_id', 'change_kind', 'cursor',
      ].includes(key))
    ) fail();
    const projectId = Object.getOwnPropertyDescriptor(rawEvent, 'project_id');
    const changeKind = Object.getOwnPropertyDescriptor(rawEvent, 'change_kind');
    const cursor = Object.getOwnPropertyDescriptor(rawEvent, 'cursor');
    if (
      !projectId
      || projectId.enumerable !== true
      || !Object.hasOwn(projectId, 'value')
      || typeof projectId.value !== 'string'
      || !PROJECT_ID_PATTERN.test(projectId.value)
      || !changeKind
      || changeKind.enumerable !== true
      || !Object.hasOwn(changeKind, 'value')
      || !['live_only', 'runtime_append', 'durable_append'].includes(changeKind.value)
      || !cursor
      || cursor.enumerable !== true
      || !Object.hasOwn(cursor, 'value')
      || !Number.isSafeInteger(cursor.value)
      || cursor.value < 1
    ) fail();
    return Object.freeze({
      event_version: 'builder-task-stream-changed.v2',
      project_id: projectId.value,
      change_kind: changeKind.value,
      cursor: cursor.value,
    });
  }
  const isAgentEvent = Object.hasOwn(rawEvent, 'agent_id');
  const identityKey = isAgentEvent ? 'agent_id' : 'project_id';
  if (
    keys.length !== 2
    || keys.some((key) => typeof key !== 'string' || !['event_version', identityKey].includes(key))
  ) fail();
  const identity = Object.getOwnPropertyDescriptor(rawEvent, identityKey);
  if (
    !version
    || version.enumerable !== true
    || !Object.hasOwn(version, 'value')
    || version.value !== 'builder-task-stream-changed.v1'
    || !identity
    || identity.enumerable !== true
    || !Object.hasOwn(identity, 'value')
    || typeof identity.value !== 'string'
    || !(isAgentEvent ? AGENT_ID_PATTERN : PROJECT_ID_PATTERN).test(identity.value)
  ) fail();
  return Object.freeze({
    event_version: 'builder-task-stream-changed.v1',
    [identityKey]: identity.value,
  });
}

function generationStartedEvent(rawEvent) {
  if (!isPlainObject(rawEvent)) fail();
  const keys = Reflect.ownKeys(rawEvent);
  if (
    keys.length !== 3
    || keys.some((key) => typeof key !== 'string' || !['event_version', 'request_id', 'project_id'].includes(key))
  ) fail();
  const version = Object.getOwnPropertyDescriptor(rawEvent, 'event_version');
  const requestId = Object.getOwnPropertyDescriptor(rawEvent, 'request_id');
  const projectId = Object.getOwnPropertyDescriptor(rawEvent, 'project_id');
  if (
    !version
    || version.enumerable !== true
    || !Object.hasOwn(version, 'value')
    || version.value !== 'builder-generation-started.v1'
    || !requestId
    || requestId.enumerable !== true
    || !Object.hasOwn(requestId, 'value')
    || typeof requestId.value !== 'string'
    || !REQUEST_DIGEST_PATTERN.test(requestId.value)
    || !projectId
    || projectId.enumerable !== true
    || !Object.hasOwn(projectId, 'value')
    || (projectId.value !== null && (
      typeof projectId.value !== 'string'
      || !PROJECT_ID_PATTERN.test(projectId.value)
    ))
  ) fail();
  return Object.freeze({
    event_version: 'builder-generation-started.v1',
    request_id: requestId.value,
    project_id: projectId.value,
  });
}

function safeDisplayDeltaText(value) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > MAX_DISPLAY_DELTA_TEXT_BYTES
    || Buffer.byteLength(value, 'utf8') > MAX_DISPLAY_DELTA_TEXT_BYTES
  ) fail();
  return value;
}

function safeActivityText(value) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > 160
    || value.normalize('NFC') !== value
    || /[\r\n\t\p{Cf}\p{Bidi_Control}]/u.test(value)
    || Buffer.byteLength(value, 'utf8') > 640
  ) fail();
  return value;
}

function safeActivityKind(value) {
  if (![
    'reasoning',
    'session_running',
    'session_idle',
    'turn_preparing',
    'step_analyzing',
    'model_retry_waiting',
    'model_retrying',
    'context_compacting',
    'context_compacted',
    'todo_updated',
    'subagent_started',
    'subagent_finished',
    'generation_finishing',
  ].includes(value)) fail();
  return value;
}

function generationOutputEvent(rawEvent) {
  if (!isPlainObject(rawEvent)) fail();
  const keys = Reflect.ownKeys(rawEvent);
  const reset = Object.hasOwn(rawEvent, 'retain_text_bytes');
  const activity = Object.hasOwn(rawEvent, 'activity_text');
  const expectedKeys = [
    'event_version',
    'request_id',
    'project_id',
    'conversation_id',
    'turn_id',
    'task_id',
    'run_id',
    ...(reset
      ? ['retain_text_bytes']
      : activity
        ? ['activity_kind', 'activity_text']
        : ['display_delta_text']),
  ];
  if (
    keys.length !== expectedKeys.length
    || keys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))
  ) fail();
  const descriptors = Object.getOwnPropertyDescriptors(rawEvent);
  for (const key of expectedKeys) {
    const descriptor = descriptors[key];
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  }
  const taskId = descriptors.task_id.value;
  if (
    descriptors.event_version.value !== (reset
      ? 'builder-generation-output-reset.v1'
      : activity
        ? 'builder-generation-activity.v2'
        : 'builder-generation-output.v1')
    || typeof descriptors.request_id.value !== 'string'
    || !REQUEST_DIGEST_PATTERN.test(descriptors.request_id.value)
    || (descriptors.project_id.value !== null && (
      typeof descriptors.project_id.value !== 'string'
      || !PROJECT_ID_PATTERN.test(descriptors.project_id.value)
    ))
    || typeof descriptors.conversation_id.value !== 'string'
    || !(descriptors.project_id.value === null
      ? AGENT_CONVERSATION_ID_PATTERN
      : CONVERSATION_ID_PATTERN).test(descriptors.conversation_id.value)
    || typeof descriptors.turn_id.value !== 'string'
    || !TURN_ID_PATTERN.test(descriptors.turn_id.value)
    || (taskId !== null && (typeof taskId !== 'string' || !TASK_ID_PATTERN.test(taskId)))
    || typeof descriptors.run_id.value !== 'string'
    || !RUN_ID_PATTERN.test(descriptors.run_id.value)
    || (reset && (
      !Number.isSafeInteger(descriptors.retain_text_bytes.value)
      || descriptors.retain_text_bytes.value < 0
    ))
  ) fail();
  const common = {
    request_id: descriptors.request_id.value,
    project_id: descriptors.project_id.value,
    conversation_id: descriptors.conversation_id.value,
    turn_id: descriptors.turn_id.value,
    task_id: taskId,
    run_id: descriptors.run_id.value,
  };
  if (reset) {
    return Object.freeze({
      event_version: 'builder-generation-output-reset.v1',
      ...common,
      retain_text_bytes: descriptors.retain_text_bytes.value,
    });
  }
  if (activity) {
    return Object.freeze({
      event_version: 'builder-generation-activity.v2',
      ...common,
      activity_kind: safeActivityKind(descriptors.activity_kind.value),
      activity_text: safeActivityText(descriptors.activity_text.value),
    });
  }
  return Object.freeze({
    event_version: 'builder-generation-output.v1',
    ...common,
    display_delta_text: safeDisplayDeltaText(descriptors.display_delta_text.value),
  });
}

function saveResultProjectId(value) {
  if (!isPlainObject(value)) fail();
  const projectId = Object.getOwnPropertyDescriptor(value, 'project_id');
  if (
    !projectId
    || !Object.hasOwn(projectId, 'value')
    || typeof projectId.value !== 'string'
    || !PROJECT_ID_PATTERN.test(projectId.value)
  ) fail();
  return projectId.value;
}

function safeOptions(value) {
  try {
    if (!isPlainObject(value)) fail();
    const keys = Reflect.ownKeys(value);
    if (
      keys.length < REQUIRED_OPTION_KEYS.length
      || keys.length > OPTION_KEYS.length
      || keys.some((key) => typeof key !== 'string' || !OPTION_KEYS.includes(key))
      || REQUIRED_OPTION_KEYS.some((key) => !keys.includes(key))
    ) fail();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
    }
    const fetchImpl = descriptors.fetchImpl.value;
    const grantPermissionForExplicitApproval = descriptors.grantPermissionForExplicitApproval.value;
    const ipcMain = descriptors.ipcMain.value;
    const mainWindowRef = descriptors.mainWindowRef.value;
    const openPath = keys.includes('openPath')
      ? descriptors.openPath.value
      : null;
    const userDataPath = descriptors.userDataPath.value;
    const showOpenDialog = keys.includes('showOpenDialog')
      ? descriptors.showOpenDialog.value
      : null;
    const agentTestBrowserRuntime = keys.includes('agentTestBrowserRuntime')
      ? descriptors.agentTestBrowserRuntime.value
      : null;
    if (
      typeof fetchImpl !== 'function'
      || utilTypes.isProxy(fetchImpl)
      || typeof grantPermissionForExplicitApproval !== 'function'
      || utilTypes.isProxy(grantPermissionForExplicitApproval)
      || ipcMain === null
      || typeof ipcMain !== 'object'
      || utilTypes.isProxy(ipcMain)
      || typeof mainWindowRef !== 'function'
      || (openPath !== null && (typeof openPath !== 'function' || utilTypes.isProxy(openPath)))
      || (showOpenDialog !== null && (typeof showOpenDialog !== 'function' || utilTypes.isProxy(showOpenDialog)))
      || (agentTestBrowserRuntime !== null && (
        !isPlainObject(agentTestBrowserRuntime)
        || agentTestBrowserRuntime.runtime_version !== 'builder-agent-test-browser-runtime.v1'
      ))
      || typeof userDataPath !== 'string'
      || userDataPath.length === 0
      || userDataPath.length > 1_024
      || userDataPath.trim() !== userDataPath
      || userDataPath.includes('\0')
      || !path.isAbsolute(userDataPath)
      || path.normalize(userDataPath) !== userDataPath
    ) fail();
    return Object.freeze({
      fetchImpl,
      grantPermissionForExplicitApproval,
      ipcMain,
      handle: stableMethod(ipcMain, 'handle'),
      removeHandler: stableMethod(ipcMain, 'removeHandler'),
      mainWindowRef,
      openPath,
      showOpenDialog,
      agentTestBrowserRuntime,
      userDataPath,
    });
  } catch {
    fail();
  }
}

function createBuilderGenerationIpcRuntime(rawOptions) {
  const options = safeOptions(rawOptions);
  let providerConfigRepository = null;
  let permissionFactStore = null;
  let taskCapsuleStore = null;
  let projectUnderstandingStore = null;
  let sessionTaskAddressStore = null;
  let projectLifecycleStore = null;
  let agentDefinitionStore = null;
  let draftCheckpointStore = null;
  let checkRunStore = null;
  let checkSkipDecisionStore = null;
  let contextCompactionSummaryStore = null;
  let handoffPacketStore = null;
  let projectMainAuthority = null;
  let harnessRuntimeComposition = null;
  let structuredRuntimeWorkspaceSnapshotStore = null;
  let structuredRuntimeWorkspaceSnapshotService = null;
  let agentConversationService = null;
  let agentPlanStore = null;
  let agentPlanService = null;
  let workbenchMessageStore = null;
  let workbenchTaskProposalStore = null;
  let taskAttentionStore = null;
  let projectTaskLeaseCoordinator = null;
  let workbenchRecordingService = null;
  let workbenchTaskMonitorProjection = null;
  let workbenchTaskResultRecordingService = null;
  const workbenchTaskHydrationTasks = new Map();
  let workbenchTaskHydrationScheduled = false;
  let service;
  let adapter;
  let workspaceAdapter;
  let taskStreamAdapter;
  let agentProjectTreeAdapter;
  let workbenchAdapter;
  let planReviewAdapter;
  let providerContextDisclosureStatusService = null;
  let checkRunCurrentDraftService = null;
  let checkRunSkipCurrentDraftService = null;
  let projectEnvironmentDiagnosisService = null;
  let projectDependencyPreparer = null;
  let livePreviewCurrentDraftSourceService = null;
  let livePreviewCurrentDraftSourceDependencies = null;
  let runtimeWorkspaceSourceService = null;
  let projectWorkspacePathService = null;
  let selectedProjectId = null;
  let selectionEpoch = 0;
  let selectionPending = false;
  const activeRequests = new Map();
  const activeTaskRequests = new Map();
  let activeRequestIds = () => Object.freeze([]);
  try {
    projectTaskLeaseCoordinator = createBuilderProjectTaskLeaseCoordinator({
      create_uuid: randomUUID,
    });
    const programmingRuntimeFeatureFlag = mainOwnedProgrammingRuntimeFeatureFlag();
    harnessRuntimeComposition = createOptionalHarnessRuntimeComposition(
      options.userDataPath,
      programmingRuntimeFeatureFlag,
      {
        ...(options.agentTestBrowserRuntime === null ? {} : {
          agent_test_browser_runtime: options.agentTestBrowserRuntime,
        }),
        on_command_approval_requested(request) {
          const webContents = activeWebContents(options.mainWindowRef);
          if (webContents === null) return;
          webContents.send(COMMAND_APPROVAL_REQUESTED_CHANNEL, request);
        },
        on_command_output(event) {
          const webContents = activeWebContents(options.mainWindowRef);
          if (webContents === null) return;
          webContents.send(COMMAND_OUTPUT_CHANNEL, event);
        },
      },
    );
    structuredRuntimeWorkspaceSnapshotStore = createBuilderRuntimeWorkspaceSnapshotStore({
      root_directory: path.join(
        options.userDataPath,
        STRUCTURED_RUNTIME_WORKSPACE_SNAPSHOT_DIRECTORY,
      ),
      now_ms: () => Date.now(),
    });
    structuredRuntimeWorkspaceSnapshotService = Object.freeze({
      recordRuntimeSourceTree(request) {
        return structuredRuntimeWorkspaceSnapshotStore.record_source_tree(request);
      },
      bindToolFile(request) {
        return structuredRuntimeWorkspaceSnapshotStore.bind_tool_file(request);
      },
      readRuntimeToolFile(request) {
        return structuredRuntimeWorkspaceSnapshotStore.read_tool_file(request);
      },
      readRuntimeSourceTree(request) {
        return structuredRuntimeWorkspaceSnapshotStore.read_source_tree(request);
      },
    });
    projectMainAuthority = createBuilderProjectMainAuthority({
      userDataPath: options.userDataPath,
    });
    const agentDefinitionRoot = path.join(options.userDataPath, AGENT_DEFINITION_DIRECTORY);
    fs.mkdirSync(agentDefinitionRoot, { recursive: true, mode: 0o700 });
    agentDefinitionStore = createBuilderAgentDefinitionStore(
      path.join(agentDefinitionRoot, AGENT_DEFINITION_DATABASE),
    );
    createBuilderDefaultAgentBootstrap({
      agent_store: agentDefinitionStore,
      owner_id: LOCAL_BUILDER_USER_ACTOR_ID,
    });
    const lazyProviderConfigRepository = Object.freeze({
      bind_current_authority() {
        if (providerConfigRepository === null) {
          providerConfigRepository = createBuilderProviderConfigRepository(options.userDataPath);
        }
        return providerConfigRepository.bind_current_authority();
      },
    });
    function publishTaskStreamChanged(rawEvent, { taskCatalogChanged = false, conversationId = null, taskAddressId = null } = {}) {
      const event = taskStreamChangedEvent(rawEvent);
      if (event.event_version === 'builder-task-stream-changed.v1') {
        builderPerformanceTrace.increment('main.task_stream.changed.legacy');
      }
      const requiresWorkbenchSync = taskCatalogChanged || (Object.hasOwn(event, 'project_id')
        && (event.event_version === 'builder-task-stream-changed.v1' || event.change_kind === 'durable_append'));
      if (requiresWorkbenchSync) {
        try {
          const projectId = Object.hasOwn(event, 'project_id') ? event.project_id : null;
          invalidateTaskWorkbench(projectId, taskAddressId, conversationId);
          synchronizeTaskWorkbench(projectId, taskAddressId);
          publishWorkbenchChanged();
        } catch {
          // Task reads remain authoritative if Workbench result synchronization is unavailable.
        }
      }
      const webContents = activeWebContents(options.mainWindowRef);
      if (webContents === null || typeof webContents.send !== 'function') return;
      try {
        webContents.send(TASK_STREAM_CHANGED_CHANNEL, event);
      } catch {
        // Activity notifications are opportunistic; the read IPC remains authoritative.
      }
    }
    const taskStreamProjectionCursors = new Map();
    function nextTaskStreamProjectionCursor(projectId) {
      const nextCursor = (taskStreamProjectionCursors.get(projectId) ?? 0) + 1;
      taskStreamProjectionCursors.set(projectId, nextCursor);
      return nextCursor;
    }
    function publishTaskStreamProjectionChanged(projectId) {
      builderPerformanceTrace.increment('main.task_stream.changed.runtime_append');
      publishTaskStreamChanged({
        event_version: 'builder-task-stream-changed.v2',
        project_id: projectId,
        change_kind: 'runtime_append',
        cursor: nextTaskStreamProjectionCursor(projectId),
      });
    }
    function publishWorkbenchChanged() {
      const webContents = activeWebContents(options.mainWindowRef);
      if (webContents === null || typeof webContents.send !== 'function') return;
      try {
        webContents.send(WORKBENCH_CHANGED_CHANNEL, Object.freeze({
          event_version: 'builder-agent-workbench-changed.v1',
          agent_id: LOCAL_BUILDER_AGENT_ID,
        }));
      } catch {
        // Invalidation is opportunistic; the Workbench read IPC remains authoritative.
      }
    }
    function synchronizeAgentWorkbench() {
      if (agentConversationService === null || workbenchRecordingService === null) return null;
      return workbenchRecordingService.sync_agent_conversation_stream(
        agentConversationService.read_stream({ agent_id: LOCAL_BUILDER_AGENT_ID }),
      );
    }
    function synchronizeTaskWorkbench(projectId = null, taskAddressId = null) {
      if (workbenchTaskMonitorProjection === null || workbenchTaskResultRecordingService === null) return null;
      return builderPerformanceTrace.measureSync(
        'main.workbench.task_sync.duration_ms',
        () => {
          const monitor = builderPerformanceTrace.measureSync('main.workbench.task_sync.project.duration_ms', () => workbenchTaskMonitorProjection.read_monitor({
            agent_id: LOCAL_BUILDER_AGENT_ID,
            ...(projectId === null ? {} : { project_id: projectId }),
            ...(taskAddressId === null ? {} : { task_address_id: taskAddressId }),
          }));
          builderPerformanceTrace.observe('main.workbench.task_sync.task_count', monitor.tasks.length);
          builderPerformanceTrace.measureSync('main.workbench.task_sync.record.duration_ms',
            () => workbenchTaskResultRecordingService.sync_task_monitor(monitor));
          return monitor;
        },
      );
    }
    function invalidateTaskWorkbench(projectId = null, taskAddressId = null, conversationId = null) {
      if (
        workbenchTaskMonitorProjection === null
        || typeof workbenchTaskMonitorProjection.invalidate_monitor !== 'function'
      ) return null;
      return workbenchTaskMonitorProjection.invalidate_monitor({
        agent_id: LOCAL_BUILDER_AGENT_ID,
        ...(projectId === null ? {} : { project_id: projectId }),
        ...(taskAddressId === null ? {} : { task_address_id: taskAddressId }),
        ...(conversationId === null ? {} : { conversation_id: conversationId }),
      });
    }
    function hydrateNextTaskWorkbenchProject() {
      if (state !== 'registered' || workbenchTaskMonitorProjection === null) {
        workbenchTaskHydrationTasks.clear();
        workbenchTaskHydrationScheduled = false;
        return;
      }
      const next = workbenchTaskHydrationTasks.entries().next().value;
      if (!Array.isArray(next)) {
        workbenchTaskHydrationScheduled = false;
        return;
      }
      const [taskAddressId, projectId] = next;
      workbenchTaskHydrationTasks.delete(taskAddressId);
      try {
        synchronizeTaskWorkbench(projectId, taskAddressId);
        publishWorkbenchChanged();
      } catch {
        // The next ordinary read keeps the task in an explicit loading state.
      }
      if (workbenchTaskHydrationTasks.size > 0) {
        setImmediate(hydrateNextTaskWorkbenchProject);
      } else {
        workbenchTaskHydrationScheduled = false;
      }
    }
    function scheduleTaskWorkbenchHydration(taskMonitor) {
      if (!Array.isArray(taskMonitor?.tasks)) return;
      for (const task of taskMonitor.tasks) {
        if (
          task?.status_label === 'Loading task history'
          && PROJECT_ID_PATTERN.test(task.project_id)
          && TASK_ADDRESS_ID_PATTERN.test(task.task_address_id)
        ) {
          workbenchTaskHydrationTasks.set(task.task_address_id, task.project_id);
        }
      }
      if (workbenchTaskHydrationTasks.size === 0 || workbenchTaskHydrationScheduled) return;
      workbenchTaskHydrationScheduled = true;
      setImmediate(hydrateNextTaskWorkbenchProject);
    }
    function applyProjectLifecycleToCatalogResult(rawResult, collectionKey) {
      const items = Array.isArray(rawResult?.[collectionKey]) ? rawResult[collectionKey] : [];
      return Object.freeze({
        ...rawResult,
        [collectionKey]: Object.freeze(items
          .map((project) => projectLifecycleStore.apply_to_project(project))
          .filter((project) => project !== null)),
      });
    }
    function renameAgentProject(request) {
      const result = projectLifecycleStore.rename_project({
        project_id: request.project_id,
        title: request.title,
        updated_at_ms: Date.now(),
      });
      publishTaskStreamChanged(Object.freeze({
        event_version: 'builder-task-stream-changed.v1',
        agent_id: request.agent_id,
      }), { taskCatalogChanged: true });
      return result;
    }
    function archiveAgentProject(request) {
      const result = projectLifecycleStore.archive_project({
        project_id: request.project_id,
        archived_at_ms: Date.now(),
      });
      publishTaskStreamChanged(Object.freeze({
        event_version: 'builder-task-stream-changed.v1',
        agent_id: request.agent_id,
      }), { taskCatalogChanged: true });
      return result;
    }
    function renameAgentTask(request) {
      const result = sessionTaskAddressStore.rename_task_address({
        project_id: request.project_id,
        task_address_id: request.task_address_id,
        title: request.title,
        updated_at_ms: Date.now(),
      });
      publishTaskStreamChanged(Object.freeze({
        event_version: 'builder-task-stream-changed.v1',
        project_id: request.project_id,
      }), { taskAddressId: request.task_address_id });
      return result;
    }
    function archiveAgentTask(request) {
      const result = sessionTaskAddressStore.archive_task_address({
        project_id: request.project_id,
        task_address_id: request.task_address_id,
        archived_at_ms: Date.now(),
      });
      publishTaskStreamChanged(Object.freeze({
        event_version: 'builder-task-stream-changed.v1',
        project_id: request.project_id,
      }), { taskAddressId: request.task_address_id });
      return result;
    }
    function exportAgentTaskTranscript(request) {
      const addressed = sessionTaskAddressStore.read_task_address({
        project_id: request.project_id,
        task_address_id: request.task_address_id,
      });
      const taskAddress = addressed?.task_address?.task_address;
      if (
        addressed?.status !== 'ready'
        || taskAddress?.agent_id !== request.agent_id
        || taskAddress?.project_id !== request.project_id
        || taskAddress?.task_address_id !== request.task_address_id
      ) fail();
      const loadedConversation = projectMainAuthority.metadata_authority.load_conversation({
        project_id: taskAddress.project_id,
        conversation_id: taskAddress.conversation_id,
      });
      return createBuilderTaskTranscriptExport({
        task_address: taskAddress,
        loaded_conversation: loadedConversation,
        exported_at_ms: Date.now(),
      });
    }
    const workbenchMessageRoot = path.join(
      options.userDataPath,
      WORKBENCH_MESSAGE_DIRECTORY,
    );
    fs.mkdirSync(workbenchMessageRoot, { recursive: true, mode: 0o700 });
    workbenchMessageStore = createBuilderWorkbenchMessageStore(
      path.join(workbenchMessageRoot, WORKBENCH_MESSAGE_DATABASE),
    );
    workbenchTaskProposalStore = createBuilderWorkbenchTaskProposalStore(
      path.join(workbenchMessageRoot, WORKBENCH_TASK_PROPOSAL_DATABASE),
    );
    taskAttentionStore = createBuilderTaskAttentionStore(
      path.join(workbenchMessageRoot, TASK_ATTENTION_DATABASE),
    );
    const agentConversationRoot = path.join(options.userDataPath, AGENT_CONVERSATION_DIRECTORY);
    fs.mkdirSync(agentConversationRoot, { recursive: true, mode: 0o700 });
    agentConversationService = createBuilderAgentConversationService({
      databasePath: path.join(agentConversationRoot, AGENT_CONVERSATION_DATABASE),
      agentId: LOCAL_BUILDER_AGENT_ID,
      createUuid: randomUUID,
      nowMs: () => Date.now(),
      onChanged(event) {
        publishTaskStreamChanged(event);
        synchronizeAgentWorkbench();
        publishWorkbenchChanged();
      },
    });
    const agentPlanRoot = path.join(options.userDataPath, AGENT_PLAN_DIRECTORY);
    fs.mkdirSync(agentPlanRoot, { recursive: true, mode: 0o700 });
    agentPlanStore = createBuilderAgentPlanStore(path.join(agentPlanRoot, AGENT_PLAN_DATABASE));
    agentPlanService = createBuilderAgentPlanService({
      store: agentPlanStore,
      agent_id: LOCAL_BUILDER_AGENT_ID,
      owner_id: LOCAL_BUILDER_USER_ACTOR_ID,
      now: () => Date.now(),
    });
    workbenchRecordingService = createBuilderAgentConversationWorkbenchRecordingService({
      message_store: workbenchMessageStore,
      agent_id: LOCAL_BUILDER_AGENT_ID,
      owner_id: LOCAL_BUILDER_USER_ACTOR_ID,
    });
    synchronizeAgentWorkbench();
    const permissionRoot = path.join(options.userDataPath, PERMISSION_DIRECTORY);
    fs.mkdirSync(permissionRoot, { recursive: true, mode: 0o700 });
    permissionFactStore = createBuilderPermissionFactStore(path.join(permissionRoot, PERMISSION_DATABASE));
    const taskCapsuleRoot = path.join(options.userDataPath, TASK_CAPSULE_DIRECTORY);
    fs.mkdirSync(taskCapsuleRoot, { recursive: true, mode: 0o700 });
    taskCapsuleStore = createBuilderTaskCapsuleStore(path.join(taskCapsuleRoot, TASK_CAPSULE_DATABASE));
    const taskCapsuleRecordingService = createBuilderTaskCapsuleRecordingService({
      task_capsule_store: taskCapsuleStore,
    });
    const projectUnderstandingRoot = path.join(options.userDataPath, PROJECT_UNDERSTANDING_DIRECTORY);
    fs.mkdirSync(projectUnderstandingRoot, { recursive: true, mode: 0o700 });
    projectUnderstandingStore = createBuilderProjectUnderstandingStore(
      path.join(projectUnderstandingRoot, PROJECT_UNDERSTANDING_DATABASE),
    );
    const sessionTaskAddressRoot = path.join(options.userDataPath, SESSION_TASK_ADDRESS_DIRECTORY);
    fs.mkdirSync(sessionTaskAddressRoot, { recursive: true, mode: 0o700 });
    sessionTaskAddressStore = createBuilderSessionTaskAddressStore(
      path.join(sessionTaskAddressRoot, SESSION_TASK_ADDRESS_DATABASE),
    );
    const projectLifecycleRoot = path.join(options.userDataPath, PROJECT_LIFECYCLE_DIRECTORY);
    fs.mkdirSync(projectLifecycleRoot, { recursive: true, mode: 0o700 });
    projectLifecycleStore = createBuilderProjectLifecycleStore(
      path.join(projectLifecycleRoot, PROJECT_LIFECYCLE_DATABASE),
    );
    const sessionTaskAddressRecordingService = createBuilderSessionTaskAddressRecordingService({
      address_store: sessionTaskAddressStore,
      create_uuid: randomUUID,
      now_ms: () => Date.now(),
      created_by: LOCAL_BUILDER_USER_ACTOR_ID,
      agent_id: LOCAL_BUILDER_AGENT_ID,
    });
    const sessionTaskTargetService = createBuilderSessionTaskTargetService({
      address_store: sessionTaskAddressStore,
      create_uuid: randomUUID,
      agent_id: LOCAL_BUILDER_AGENT_ID,
    });
    const sessionTaskAddressBindingService = createBuilderSessionTaskAddressBindingService({
      address_store: sessionTaskAddressStore,
    });
    const draftCheckpointRoot = path.join(options.userDataPath, DRAFT_CHECKPOINT_DIRECTORY);
    fs.mkdirSync(draftCheckpointRoot, { recursive: true, mode: 0o700 });
    draftCheckpointStore = createBuilderDraftCheckpointStore(
      path.join(draftCheckpointRoot, DRAFT_CHECKPOINT_DATABASE),
    );
    const draftCheckpointRecordingService = createBuilderDraftCheckpointRecordingService({
      draft_checkpoint_store: draftCheckpointStore,
    });
    const automaticDraftCheckpointService = createBuilderAutomaticDraftCheckpointService({
      address_store: sessionTaskAddressStore,
      draft_checkpoint_store: draftCheckpointStore,
      draft_checkpoint_recording_service: draftCheckpointRecordingService,
      now_ms: () => Date.now(),
    });
    const checkRunRoot = path.join(options.userDataPath, CHECK_RUN_DIRECTORY);
    fs.mkdirSync(checkRunRoot, { recursive: true, mode: 0o700 });
    checkRunStore = createBuilderCheckRunStore(path.join(checkRunRoot, CHECK_RUN_DATABASE));
    const checkSkipDecisionRoot = path.join(
      options.userDataPath,
      CHECK_SKIP_DECISION_DIRECTORY,
    );
    fs.mkdirSync(checkSkipDecisionRoot, { recursive: true, mode: 0o700 });
    checkSkipDecisionStore = createBuilderCheckSkipDecisionStore(
      path.join(checkSkipDecisionRoot, CHECK_SKIP_DECISION_DATABASE),
    );
    const checkRunStatusService = createBuilderCheckRunStatusService({
      check_run_store: checkRunStore,
      check_skip_decision_store: checkSkipDecisionStore,
    });
    const checkRunActivityRegistry = createBuilderCheckRunActivityRegistry({
      on_activity_changed(event) {
        publishTaskStreamProjectionChanged(event.project_id);
      },
    });
    const checkRunSaveGate = createBuilderCheckRunSaveGate({
      check_run_store: checkRunStore,
      check_skip_decision_store: checkSkipDecisionStore,
      activity_registry: checkRunActivityRegistry,
    });
    const contextCompactionSummaryRoot = path.join(options.userDataPath, CONTEXT_COMPACTION_SUMMARY_DIRECTORY);
    fs.mkdirSync(contextCompactionSummaryRoot, { recursive: true, mode: 0o700 });
    contextCompactionSummaryStore = createBuilderContextCompactionSummaryStore(
      path.join(contextCompactionSummaryRoot, CONTEXT_COMPACTION_SUMMARY_DATABASE),
    );
    const contextCompactionRecordingService = createBuilderContextCompactionRecordingService({
      context_compaction_summary_store: contextCompactionSummaryStore,
      session_task_address_store: sessionTaskAddressStore,
      now_ms: () => Date.now(),
    });
    const handoffPacketRoot = path.join(options.userDataPath, HANDOFF_PACKET_DIRECTORY);
    fs.mkdirSync(handoffPacketRoot, { recursive: true, mode: 0o700 });
    handoffPacketStore = createBuilderHandoffPacketStore(
      path.join(handoffPacketRoot, HANDOFF_PACKET_DATABASE),
    );
    const workingContextStateService = createBuilderWorkingContextStateService({
      task_capsule_store: taskCapsuleStore,
      session_task_address_store: sessionTaskAddressStore,
      context_compaction_summary_store: contextCompactionSummaryStore,
      handoff_packet_store: handoffPacketStore,
    });
    const permissionEvaluator = permissionFactStore.create_evaluator();
    const permissionAdmission = createBuilderToolPermissionAdmission({
      actor_id: LOCAL_BUILDER_USER_ACTOR_ID,
      evaluate_permission(request) {
        return permissionEvaluator.evaluate({
          policy_version: BUILDER_PERMISSION_POLICY_VERSION,
          actor_id: LOCAL_BUILDER_USER_ACTOR_ID,
          action: request.action,
          resource: request.resource,
          now_ms: request.now_ms,
        });
      },
      now_ms: () => Date.now(),
    });
    const providerContextDisclosureDecisionService = createBuilderProviderContextDisclosureDecisionService({
      actor_id: LOCAL_BUILDER_USER_ACTOR_ID,
      evaluate_permission(request) {
        return permissionEvaluator.evaluate({
          policy_version: BUILDER_PERMISSION_POLICY_VERSION,
          actor_id: LOCAL_BUILDER_USER_ACTOR_ID,
          action: request.action,
          resource: request.resource,
          now_ms: request.now_ms,
        });
      },
      now_ms: () => Date.now(),
    });
    providerContextDisclosureStatusService = createBuilderProviderContextDisclosureStatusService();
    const conversationTranscriptRoot = path.join(options.userDataPath, 'builder-transcripts-v1');
    fs.mkdirSync(conversationTranscriptRoot, { recursive: true, mode: 0o700 });
    const conversationTranscriptArchive = createBuilderConversationTranscriptArchive({
      root_path: conversationTranscriptRoot,
    });
    const conversationService = createBuilderConversationMainService({
      metadataAuthority: projectMainAuthority.metadata_authority,
      createUuid: randomUUID,
      nowMs: () => Date.now(),
      onTaskStreamChanged: publishTaskStreamChanged,
      onTaskStreamReadFailure(event) {
        recordCanaryTaskStreamReadFailure(options.userDataPath, event);
      },
      workingContextStateService,
      providerContextDisclosureStatusService,
      automaticDraftCheckpointService,
      checkRunStatusService,
      checkRunActivityRegistry,
      transcriptArchive: conversationTranscriptArchive,
      contextCompactionRecordingService,
    });
    const checkRunClock = Object.freeze({
      clock_version: 'builder-clock.v1',
      now_ms: () => Date.now(),
      set_timeout: (callback, delay) => setTimeout(callback, delay),
      clear_timeout: (timer) => clearTimeout(timer),
    });
    const checkRunProcessAdapter = createBuilderCheckRunProcessAdapter({
      spawn_process: spawn,
      platform: process.platform,
      windows_root: process.platform === 'win32'
        ? (process.env.SystemRoot ?? path.join(path.parse(process.execPath).root, 'Windows'))
        : null,
    });
    projectWorkspacePathService = Object.freeze({
      service_version: PROJECT_WORKSPACE_PATH_SERVICE_VERSION,
      async resolve_project_workspace_path(rawRequest) {
        if (
          !isPlainObject(rawRequest)
          || Reflect.ownKeys(rawRequest).length !== 1
          || typeof rawRequest.project_id !== 'string'
          || !PROJECT_ID_PATTERN.test(rawRequest.project_id)
        ) fail();
        const workspace = await projectMainAuthority.metadata_authority.load_project_workspace({
          project_id: rawRequest.project_id,
        });
        return Object.freeze({
          result_version: 'builder-project-workspace-path-result.v1',
          project_id: rawRequest.project_id,
          project_root_path: projectRootPathFromWorkspace(workspace, rawRequest.project_id),
          authority: 'main_owned_bound_project_workspace_path',
        });
      },
    });
    const checkRunComposition = createBuilderCheckRunRuntimeComposition({
      user_data_path: options.userDataPath,
      launcher_path: process.execPath,
      worker_path: packagedCheckWorkerPath(),
      process_adapter: checkRunProcessAdapter,
      toolchain_probe_spawn_process: spawn,
      dependency_prepare_spawn_process: spawn,
      project_workspace_path_service: projectWorkspacePathService,
      clock: checkRunClock,
      conversation_service: conversationService,
      git_authority: projectMainAuthority.git_authority,
      automatic_draft_checkpoint_service: automaticDraftCheckpointService,
      check_run_store: checkRunStore,
      check_skip_decision_store: checkSkipDecisionStore,
      check_run_status_service: checkRunStatusService,
      activity_registry: checkRunActivityRegistry,
    });
    checkRunCurrentDraftService = checkRunComposition.current_draft_service;
    checkRunSkipCurrentDraftService = checkRunComposition.current_draft_skip_service;
    livePreviewCurrentDraftSourceDependencies = Object.freeze({
      conversation_service: conversationService,
      git_authority: projectMainAuthority.git_authority,
      automatic_draft_checkpoint_service: automaticDraftCheckpointService,
      project_read_authority: projectMainAuthority.project_read_authority,
    });
    const sourceContextCollector = createBuilderToolSourceContextCollector({
      conversation_service: conversationService,
      permission_admission: permissionAdmission,
      project_workspace_authority: projectMainAuthority.project_workspace_authority,
      create_uuid: randomUUID,
      now_ms: () => Date.now(),
    });
    const generationProjectReadAuthority = Object.freeze({
      ...projectMainAuthority.project_read_authority,
      async load_current(rawRequest) {
        try {
          return await Reflect.apply(
            projectMainAuthority.project_read_authority.load_current,
            projectMainAuthority.project_read_authority,
            [rawRequest],
          );
        } catch (error) {
          if (safeOwnErrorCode(error) !== 'builder_project_read_not_found') throw error;
          const projectId = requiredProjectId(rawRequest);
          return localWorkspaceReadResult(
            projectRootPathFromWorkspace(
              await projectMainAuthority.metadata_authority.load_project_workspace({
                project_id: projectId,
              }),
              projectId,
            ),
            projectId,
          );
        }
      },
    });
    const generationWorkspaceReadAuthority = Object.freeze({
      async load_fresh_workspace(rawRequest) {
        const projectId = requiredProjectId(rawRequest);
        return localWorkspaceReadResult(
          projectRootPathFromWorkspace(
            await projectMainAuthority.metadata_authority.load_project_workspace({
              project_id: projectId,
            }),
            projectId,
          ),
          projectId,
        );
      },
    });
    projectEnvironmentDiagnosisService = createBuilderProjectEnvironmentDiagnosisService({
      project_read_authority: generationProjectReadAuthority,
      project_workspace_path_service: projectWorkspacePathService,
      spawn_process: spawn,
      terminate_process_tree(rawRequest) {
        const child = rawRequest?.child;
        if (child === null || typeof child !== 'object' || typeof child.kill !== 'function') {
          return false;
        }
        try {
          return child.kill() === true;
        } catch {
          return false;
        }
      },
      clock: checkRunClock,
      platform: process.platform,
      windows_root: process.platform === 'win32'
        ? (process.env.SystemRoot ?? path.join(path.parse(process.execPath).root, 'Windows'))
        : null,
    });
    projectDependencyPreparer = createBuilderProjectDependencyPreparer({
      project_environment_diagnosis_service: projectEnvironmentDiagnosisService,
      project_workspace_path_service: projectWorkspacePathService,
      spawn_process: spawn,
      terminate_process_tree(rawRequest) {
        const child = rawRequest?.child;
        if (child === null || typeof child !== 'object' || typeof child.kill !== 'function') {
          return false;
        }
        try {
          return child.kill() === true;
        } catch {
          return false;
        }
      },
      clock: checkRunClock,
      platform: process.platform,
      windows_root: process.platform === 'win32'
        ? (process.env.SystemRoot ?? path.join(path.parse(process.execPath).root, 'Windows'))
        : null,
    });
    const saveWorkspaceReadAuthority = Object.freeze({
      async load_fresh_workspace(rawRequest) {
        const projectId = requiredProjectId(rawRequest);
        const workspaceRootPath = projectRootPathFromWorkspace(
          await projectMainAuthority.metadata_authority.load_project_workspace({
            project_id: projectId,
          }),
          projectId,
        );
        const inspected = inspectBuilderLocalWorkspaceSourceTree(workspaceRootPath);
        return Object.freeze({
          result_version: 'builder-project-save-workspace-read-result.v1',
          project_id: projectId,
          source_tree: inspected.source_tree,
          scan_status: inspected.scan_status,
          incomplete_reasons: inspected.incomplete_reasons,
          read_admission: 'main_bound_workspace_fresh_read',
        });
      },
    });
    const projectUnderstandingService = createBuilderProjectUnderstandingService({
      project_read_authority: generationProjectReadAuthority,
      project_understanding_store: projectUnderstandingStore,
      now_ms: () => Date.now(),
    });
    service = createBuilderGenerationMainService({
      providerConfigRepository: lazyProviderConfigRepository,
      projectReadAuthority: generationProjectReadAuthority,
      workspaceReadAuthority: generationWorkspaceReadAuthority,
      projectUnderstandingService,
      projectIdentityAuthority: projectMainAuthority.metadata_authority,
      conversationService,
      agentConversationService,
      agentPlanService,
      gitAuthority: projectMainAuthority.git_authority,
      currentProjection: projectMainAuthority.git_current_projection,
      sourceContextCollector,
      taskCapsuleStore,
      taskCapsuleRecordingService,
      sessionTaskTargetService,
      sessionTaskAddressRecordingService,
      sessionTaskAddressBindingService,
      automaticDraftCheckpointService,
      codingLoopCheckCoordinator: checkRunComposition.coding_loop_check_coordinator,
      workingContextStateService,
      providerContextDisclosureDecisionService,
      providerContextDisclosureStatusService,
      runtimeWorkspaceSnapshotService: structuredRuntimeWorkspaceSnapshotService,
      harnessRuntimeComposition,
      programmingRuntimeFeatureFlag,
      transport: createBuilderOpenAICompatibleTransport({ fetchImpl: options.fetchImpl }),
      onGenerationStarted(event) {
        const started = generationStartedEvent(event);
        const webContents = activeWebContents(options.mainWindowRef);
        if (webContents === null) return;
        webContents.send(GENERATION_STARTED_CHANNEL, started);
      },
      onProviderOutputDelta(event) {
        const webContents = activeWebContents(options.mainWindowRef);
        if (webContents === null) return;
        webContents.send(GENERATION_OUTPUT_CHANNEL, generationOutputEvent(event));
      },
    });
    const saveAuthority = createBuilderProjectSaveAuthority({
      generationDrafts: service,
      gitAuthority: projectMainAuthority.git_authority,
      currentProjection: projectMainAuthority.git_current_projection,
      metadataAuthority: projectMainAuthority.metadata_authority,
      projectReadAuthority: projectMainAuthority.project_read_authority,
      workspaceReadAuthority: saveWorkspaceReadAuthority,
      conversationService,
      automaticDraftCheckpointService,
      checkRunSaveGate,
      createUuid: randomUUID,
      nowMs: () => Date.now(),
    });
    async function assertSelectedProjectWriteAllowed(projectId) {
      if (selectionPending || selectedProjectId !== projectId) failGenerationProjectWorkspaceRequired();
      const decision = await permissionEvaluator.evaluate({
        policy_version: BUILDER_PERMISSION_POLICY_VERSION,
        actor_id: LOCAL_BUILDER_USER_ACTOR_ID,
        action: 'project.edit',
        resource: {
          resource_kind: 'project',
          project_id: projectId,
          resource_id: 'project:self',
        },
        now_ms: Date.now(),
      });
      if (decision.decision !== 'allowed') failGenerationProjectWritePermissionRequired();
      return decision;
    }

    function acquireProjectTaskLease(projectId, taskAddressId, requestId) {
      const result = projectTaskLeaseCoordinator.acquire({
        project_id: projectId,
        task_address_id: taskAddressId,
        request_id: requestId,
      });
      if (result.status === 'busy') {
        recordTaskAttention(
          { project_id: projectId, task_address_id: taskAddressId },
          'waiting_resource',
          'project_busy',
        );
        failGenerationProjectBusy();
      }
      recordTaskAttention(
        { project_id: projectId, task_address_id: taskAddressId },
        'ready',
        'resolved',
      );
      return result.lease;
    }

    function releaseProjectTaskLease(lease) {
      projectTaskLeaseCoordinator.release({
        lease_id: lease.lease_id,
        project_id: lease.project_id,
        request_id: lease.request_id,
      });
    }

    function retainActiveTaskRequest(projectId, taskAddressId, requestId) {
      if (taskAddressId === null) return;
      const current = activeTaskRequests.get(taskAddressId) ?? null;
      if (current !== null) {
        recordTaskAttention(
          { project_id: projectId, task_address_id: taskAddressId },
          'waiting_resource',
          'concurrency_limit',
        );
        failGenerationProjectBusy();
      }
      activeTaskRequests.set(taskAddressId, Object.freeze({
        project_id: projectId,
        request_id: requestId,
      }));
    }

    function releaseActiveTaskRequest(projectId, taskAddressId, requestId) {
      if (taskAddressId === null) return;
      const current = activeTaskRequests.get(taskAddressId) ?? null;
      if (
        current === null
        || current.project_id !== projectId
        || current.request_id !== requestId
      ) return;
      activeTaskRequests.delete(taskAddressId);
      try {
        recordTaskAttention(
          { project_id: projectId, task_address_id: taskAddressId },
          'ready',
          'resolved',
        );
      } catch {
        // Attention is derived; releasing the active request must remain final.
      } finally {
        try { invalidateTaskWorkbench(projectId, taskAddressId); } catch { /* active authority is already released */ }
        publishWorkbenchChanged();
      }
    }

    function trackedGenerationOperation(rawRequest, method, queuedMethod = null) {
      if (selectionPending) fail();
      const instructionRequest = publicInstructionRequest(rawRequest);
      if (instructionRequest.queued_followup !== null && typeof queuedMethod !== 'function') fail();
      const request = createBuilderGenerationRequest({
        instruction: instructionRequest.instruction,
        existing_project_id: selectedProjectId,
        task_address_id: instructionRequest.task_address_id,
      });
      const requestId = request.request_digest;
      const lease = instructionRequest.queued_followup === null
        ? acquireProjectTaskLease(
          request.existing_project_id,
          instructionRequest.task_address_id,
          requestId,
        )
        : null;
      try {
        retainActiveTaskRequest(
          request.existing_project_id,
          instructionRequest.task_address_id,
          requestId,
        );
      } catch (error) {
        if (lease !== null) releaseProjectTaskLease(lease);
        throw error;
      }
      activeRequests.set(requestId, (activeRequests.get(requestId) ?? 0) + 1);
      let operation;
      try {
        if (instructionRequest.queued_followup !== null && typeof queuedMethod !== 'function') fail();
        operation = Promise.resolve(instructionRequest.queued_followup === null
          ? Reflect.apply(method, service, [request])
          : Reflect.apply(queuedMethod, service, [{
            request,
            queued_followup: instructionRequest.queued_followup,
          }]));
      } catch (error) {
        const remaining = (activeRequests.get(requestId) ?? 1) - 1;
        if (remaining === 0) activeRequests.delete(requestId);
        else activeRequests.set(requestId, remaining);
        try {
          releaseActiveTaskRequest(
            request.existing_project_id,
            instructionRequest.task_address_id,
            requestId,
          );
        } finally {
          if (lease !== null) releaseProjectTaskLease(lease);
        }
        throw error;
      }
      return operation.finally(() => {
        const remaining = (activeRequests.get(requestId) ?? 1) - 1;
        if (remaining === 0) activeRequests.delete(requestId);
        else activeRequests.set(requestId, remaining);
        try {
          releaseActiveTaskRequest(
            request.existing_project_id,
            instructionRequest.task_address_id,
            requestId,
          );
        } finally {
          if (lease !== null) releaseProjectTaskLease(lease);
        }
      });
    }

    async function trackedGenerate(rawRequest) {
      publicInstruction(rawRequest);
      if (selectionPending) fail();
      if (selectedProjectId === null) failGenerationProjectWorkspaceRequired();
      await assertSelectedProjectWriteAllowed(selectedProjectId);
      return trackedGenerationOperation(rawRequest, service.generate);
    }

    async function trackedContinueDraft(rawRequest) {
      const continuationRequest = draftContinuationRequest(rawRequest);
      if (selectionPending) fail();
      if (selectedProjectId === null) failGenerationProjectWorkspaceRequired();
      const projectId = selectedProjectId;
      await assertSelectedProjectWriteAllowed(projectId);
      const request = createBuilderGenerationRequest({
        instruction: continuationRequest.instruction,
        existing_project_id: projectId,
        task_address_id: null,
      });
      const requestId = request.request_digest;
      const admission = await service.prepare_draft_continuation({
        draft_id: continuationRequest.draft_id,
      });
      if (
        !isPlainObject(admission)
        || Object.getOwnPropertyDescriptor(admission, 'project_id')?.value !== projectId
      ) failGenerationWorkspaceChanged();
      const lease = acquireProjectTaskLease(projectId, null, requestId);
      activeRequests.set(requestId, (activeRequests.get(requestId) ?? 0) + 1);
      try {
        return await service.generate_draft_continuation({
          draft_id: continuationRequest.draft_id,
          instruction: request.instruction,
          ...(continuationRequest.queued_followup === null
            ? {}
            : { queued_followup: continuationRequest.queued_followup }),
        });
      } finally {
        const remaining = (activeRequests.get(requestId) ?? 1) - 1;
        if (remaining === 0) activeRequests.delete(requestId);
        else activeRequests.set(requestId, remaining);
        releaseProjectTaskLease(lease);
      }
    }

    async function trackedGenerateApprovedPlan(rawRequest) {
      if (selectionPending) fail();
      const request = approvedPlanGenerationRequest(rawRequest);
      if (selectedProjectId !== request.project_id) fail();
      const writePermissionDecision = await assertSelectedProjectWriteAllowed(request.project_id);
      const addressed = sessionTaskAddressStore.read_current_session_task_for_conversation({
        project_id: request.project_id,
        conversation_id: request.conversation_id,
      });
      const taskAddressId = addressed?.status === 'ready'
        ? addressed.task_address?.task_address?.task_address_id ?? null
        : null;
      const requestId = `sha256:${createHash('sha256')
        .update(`${request.project_id}:${request.run_id}:approved-plan`, 'utf8')
        .digest('hex')}`;
      const lease = acquireProjectTaskLease(request.project_id, taskAddressId, requestId);
      try {
        return await service.generate_approved_plan({
          request,
          write_permission_decision: writePermissionDecision,
        });
      } finally {
        releaseProjectTaskLease(lease);
      }
    }

    async function trackedProposePlan(rawRequest) {
      if (selectionPending || selectedProjectId === null) failGenerationBaseUnavailable();
      const projectId = selectedProjectId;
      const request = createBuilderGenerationRequest({
        instruction: publicInstruction(rawRequest),
        existing_project_id: projectId,
        task_address_id: publicInstructionRequest(rawRequest).task_address_id,
      });
      const requestId = request.request_digest;
      retainActiveTaskRequest(projectId, request.task_address_id, requestId);
      activeRequests.set(requestId, (activeRequests.get(requestId) ?? 0) + 1);
      try {
        const resourceIds = await selectedPlanSourceReadResources(projectId);
        return await service.propose_plan({
          request,
          resource_ids: resourceIds,
        });
      } finally {
        const remaining = (activeRequests.get(requestId) ?? 1) - 1;
        if (remaining === 0) activeRequests.delete(requestId);
        else activeRequests.set(requestId, remaining);
        releaseActiveTaskRequest(projectId, request.task_address_id, requestId);
      }
    }

    async function selectedPlanSourceReadResources(projectId) {
      if (selectionPending || selectedProjectId !== projectId) failGenerationBaseUnavailable();
      let currentProject;
      try {
        currentProject = await projectMainAuthority.project_read_authority.load_current({ project_id: projectId });
        if (readResultProjectId(currentProject) !== projectId) fail();
        return sourceTreeResourceIds(currentProject);
      } catch (error) {
        if (safeOwnErrorCode(error) !== 'builder_project_read_not_found') {
          failGenerationBaseUnavailable();
        }
        try {
          return workspacePlanResourceIds(projectRootPathFromWorkspace(
            await projectMainAuthority.metadata_authority.load_project_workspace({
              project_id: projectId,
            }),
            projectId,
          ));
        } catch {
          failGenerationBaseUnavailable();
        }
      }
    }

    function recordTaskAttention(target, state, reasonCode) {
      if (target.task_address_id === null) return null;
      const addressed = sessionTaskAddressStore.read_task_address({
        project_id: target.project_id,
        task_address_id: target.task_address_id,
      });
      const taskAddress = addressed?.task_address?.task_address;
      if (
        addressed?.status !== 'ready'
        || taskAddress?.project_id !== target.project_id
        || taskAddress?.task_address_id !== target.task_address_id
      ) fail();
      const priorResult = taskAttentionStore.read_task_attention({
        project_id: target.project_id,
        task_address_id: target.task_address_id,
      });
      const prior = priorResult?.attention ?? null;
      const requestDigest = state === 'ready'
        ? null
        : `sha256:${createHash('sha256')
          .update(`${target.project_id}:${target.task_address_id}:${reasonCode}`, 'utf8')
          .digest('hex')}`;
      if (
        (prior === null && state === 'ready')
        || (
          prior?.state === state
          && prior?.reason_code === reasonCode
          && prior?.request_digest === requestDigest
        )
      ) return prior;
      const recorded = taskAttentionStore.record_task_attention({
        attention: {
          record_version: 'builder-task-attention-record.v1',
          attention_id: `builder-task-attention:${randomUUID()}`,
          project_id: target.project_id,
          conversation_id: taskAddress.conversation_id,
          task_address_id: target.task_address_id,
          state,
          reason_code: reasonCode,
          request_digest: requestDigest,
          revision: (prior?.revision ?? 0) + 1,
          updated_at_ms: Math.max(Date.now(), prior?.updated_at_ms ?? 0),
        },
      }).attention;
      invalidateTaskWorkbench(target.project_id, target.task_address_id);
      synchronizeTaskWorkbench(target.project_id, target.task_address_id);
      publishWorkbenchChanged();
      return recorded;
    }

    async function planSourceReadApprovalStatus(rawRequest) {
      const target = approvalTarget(rawRequest);
      const projectId = target.project_id;
      const resourceIds = await selectedPlanSourceReadResources(projectId);
      const nowMs = Date.now();
      let denied = false;
      for (const resourceId of resourceIds) {
        const decision = await permissionEvaluator.evaluate({
          policy_version: BUILDER_PERMISSION_POLICY_VERSION,
          actor_id: LOCAL_BUILDER_USER_ACTOR_ID,
          action: 'filesystem.read',
          resource: {
            resource_kind: 'filesystem',
            project_id: projectId,
            resource_id: resourceId,
          },
          now_ms: nowMs,
        });
        if (decision.decision !== 'allowed') denied = true;
      }
      recordTaskAttention(
        target,
        denied ? 'waiting_permission' : 'ready',
        denied ? 'plan_source_read' : 'resolved',
      );
      return Object.freeze({
        result_version: 'builder-plan-source-read-approval-status.v1',
        project_id: projectId,
        state: denied ? 'approval_required' : 'ready',
        file_count: resourceIds.length,
        approval_scope: 'current_project_plan_source_read',
        authority: 'main_selected_project_bounded_filesystem_read_v1',
      });
    }

    async function approvePlanSourceRead(rawRequest) {
      const target = approvalTarget(rawRequest);
      const projectId = target.project_id;
      const resourceIds = await selectedPlanSourceReadResources(projectId);
      let recorded = false;
      for (const resourceId of resourceIds) {
        const result = await Reflect.apply(options.grantPermissionForExplicitApproval, undefined, [{
          project_id: projectId,
          action: 'filesystem.read',
          resource_kind: 'filesystem',
          resource_id: resourceId,
        }]);
        if (
          !isPlainObject(result)
          || Object.getOwnPropertyDescriptor(result, 'result_version')?.value !== 'builder-permission-grant-result.v1'
          || Object.getOwnPropertyDescriptor(result, 'project_id')?.value !== projectId
          || Object.getOwnPropertyDescriptor(result, 'action')?.value !== 'filesystem.read'
          || Object.getOwnPropertyDescriptor(result, 'ui_selection_authority')?.value
            !== 'main_owned_explicit_user_approval_required'
        ) fail();
        const operation = Object.getOwnPropertyDescriptor(result, 'operation')?.value;
        if (operation === 'grant_recorded') recorded = true;
        else if (operation !== 'grant_existing') fail();
      }
      recordTaskAttention(target, 'ready', 'resolved');
      return Object.freeze({
        result_version: 'builder-plan-source-read-approval-result.v1',
        project_id: projectId,
        operation: recorded ? 'approval_recorded' : 'already_approved',
        file_count: resourceIds.length,
        approval_scope: 'current_project_plan_source_read',
        authority: 'main_selected_project_bounded_filesystem_read_v1',
      });
    }

    function assertSelectedProjectWriteApprovalProject(projectId) {
      if (selectionPending || selectedProjectId !== projectId) failGenerationProjectWorkspaceRequired();
    }

    async function currentProjectWriteApprovalStatus(rawRequest) {
      const target = approvalTarget(rawRequest);
      const projectId = target.project_id;
      assertSelectedProjectWriteApprovalProject(projectId);
      const decision = await permissionEvaluator.evaluate({
        policy_version: BUILDER_PERMISSION_POLICY_VERSION,
        actor_id: LOCAL_BUILDER_USER_ACTOR_ID,
        action: 'project.edit',
        resource: {
          resource_kind: 'project',
          project_id: projectId,
          resource_id: 'project:self',
        },
        now_ms: Date.now(),
      });
      recordTaskAttention(
        target,
        decision.decision === 'allowed' ? 'ready' : 'waiting_permission',
        decision.decision === 'allowed' ? 'resolved' : 'current_project_write',
      );
      return Object.freeze({
        result_version: 'builder-current-project-write-approval-status.v1',
        project_id: projectId,
        state: decision.decision === 'allowed' ? 'ready' : 'approval_required',
        approval_scope: 'current_project_write',
        authority: 'main_selected_project_project_edit_v1',
      });
    }

    async function approveCurrentProjectWrite(rawRequest) {
      const target = approvalTarget(rawRequest);
      const projectId = target.project_id;
      assertSelectedProjectWriteApprovalProject(projectId);
      const result = await Reflect.apply(options.grantPermissionForExplicitApproval, undefined, [{
        project_id: projectId,
        action: 'project.edit',
        resource_kind: 'project',
        resource_id: 'project:self',
      }]);
      if (
        !isPlainObject(result)
        || Object.getOwnPropertyDescriptor(result, 'result_version')?.value !== 'builder-permission-grant-result.v1'
        || Object.getOwnPropertyDescriptor(result, 'project_id')?.value !== projectId
        || Object.getOwnPropertyDescriptor(result, 'action')?.value !== 'project.edit'
        || Object.getOwnPropertyDescriptor(result, 'ui_selection_authority')?.value
          !== 'main_owned_explicit_user_approval_required'
      ) fail();
      const resource = Object.getOwnPropertyDescriptor(result, 'resource')?.value;
      if (
        !isPlainObject(resource)
        || Object.getOwnPropertyDescriptor(resource, 'resource_kind')?.value !== 'project'
        || Object.getOwnPropertyDescriptor(resource, 'project_id')?.value !== projectId
        || Object.getOwnPropertyDescriptor(resource, 'resource_id')?.value !== 'project:self'
      ) fail();
      const operation = Object.getOwnPropertyDescriptor(result, 'operation')?.value;
      if (operation !== 'grant_recorded' && operation !== 'grant_existing') fail();
      recordTaskAttention(target, 'ready', 'resolved');
      return Object.freeze({
        result_version: 'builder-current-project-write-approval-result.v1',
        project_id: projectId,
        operation: operation === 'grant_recorded' ? 'approval_recorded' : 'already_approved',
        approval_scope: 'current_project_write',
        authority: 'main_selected_project_project_edit_v1',
      });
    }

    async function trackedSubmit(rawRequest) {
      publicInstructionRequest(rawRequest);
      if (selectionPending) fail();
      if (selectedProjectId === null) failGenerationProjectWorkspaceRequired();
      await assertSelectedProjectWriteAllowed(selectedProjectId);
      return trackedGenerationOperation(rawRequest, service.submit, service.submit_queued_followup);
    }

    async function trackedRetryGenerate(rawRequest) {
      publicInstruction(rawRequest);
      if (selectionPending) fail();
      if (selectedProjectId === null) failGenerationProjectWorkspaceRequired();
      await assertSelectedProjectWriteAllowed(selectedProjectId);
      return trackedGenerationOperation(rawRequest, service.retry_generate);
    }

    async function trackedResumeInterruptedRun(rawRequest) {
      const values = exactDataDescriptors(rawRequest, ['task_address_id', 'run_id']);
      if (selectionPending || selectedProjectId === null) failGenerationProjectWorkspaceRequired();
      const projectId = selectedProjectId;
      await assertSelectedProjectWriteAllowed(projectId);
      if (selectionPending || selectedProjectId !== projectId) failGenerationProjectWorkspaceRequired();
      const prepared = service.prepare_resume_interrupted_run({ project_id: projectId,
        task_address_id: values.task_address_id.value, run_id: values.run_id.value });
      const request = prepared.request;
      const requestId = request.request_digest;
      const lease = acquireProjectTaskLease(projectId, request.task_address_id, requestId);
      try { retainActiveTaskRequest(projectId, request.task_address_id, requestId); }
      catch (error) { releaseProjectTaskLease(lease); throw error; }
      activeRequests.set(requestId, (activeRequests.get(requestId) ?? 0) + 1);
      try { return await service.resume_interrupted_run(prepared); }
      finally {
        const remaining = (activeRequests.get(requestId) ?? 1) - 1;
        if (remaining === 0) activeRequests.delete(requestId);
        else activeRequests.set(requestId, remaining);
        try { releaseActiveTaskRequest(projectId, request.task_address_id, requestId); }
        finally { releaseProjectTaskLease(lease); publishWorkbenchChanged(); }
      }
    }

    function trackedAnswer(rawRequest, answerMethod = service.answer, forceProjectless = false) {
      if (selectionPending) fail();
      const instructionRequest = publicInstructionRequest(rawRequest);
      if (forceProjectless && instructionRequest.task_address_id !== null) fail();
      const request = createBuilderGenerationRequest({
        instruction: instructionRequest.instruction,
        existing_project_id: forceProjectless ? null : selectedProjectId,
        task_address_id: instructionRequest.task_address_id,
      });
      const requestId = request.request_digest;
      retainActiveTaskRequest(request.existing_project_id, request.task_address_id, requestId);
      activeRequests.set(requestId, (activeRequests.get(requestId) ?? 0) + 1);
      let operation;
      try {
        if (answerMethod !== service.answer && instructionRequest.queued_followup !== null) fail();
        operation = Promise.resolve(instructionRequest.queued_followup === null
          ? Reflect.apply(answerMethod, service, [request])
          : Reflect.apply(service.answer_queued_followup, service, [{
            request,
            queued_followup: instructionRequest.queued_followup,
          }]));
      } catch (error) {
        const remaining = (activeRequests.get(requestId) ?? 1) - 1;
        if (remaining === 0) activeRequests.delete(requestId);
        else activeRequests.set(requestId, remaining);
        releaseActiveTaskRequest(request.existing_project_id, request.task_address_id, requestId);
        throw error;
      }
      return operation.finally(() => {
        const remaining = (activeRequests.get(requestId) ?? 1) - 1;
        if (remaining === 0) activeRequests.delete(requestId);
        else activeRequests.set(requestId, remaining);
        releaseActiveTaskRequest(request.existing_project_id, request.task_address_id, requestId);
      });
    }

    function trackedAnswerPlan(rawRequest) {
      return trackedAnswer(rawRequest, service.answer_plan, true).finally(() => {
        publishWorkbenchChanged();
      });
    }

    function trackedClassifyIntent(rawRequest) {
      if (selectionPending) fail();
      const request = publicInstructionRequest(rawRequest);
      return service.classify_intent({
        instruction: request.instruction,
        existing_project_id: selectedProjectId,
        task_address_id: request.task_address_id,
      });
    }

    async function trackedAnswerDraft(rawRequest) {
      const answerRequest = draftAnswerRequest(rawRequest);
      if (selectionPending) fail();
      if (selectedProjectId === null) failGenerationProjectWorkspaceRequired();
      return service.answer_draft({
        draft_id: answerRequest.draft_id,
        instruction: answerRequest.instruction,
        project_id: selectedProjectId,
      });
    }

    function trackedRestoreRevisionAsDraft(rawRequest) {
      const request = restoreRevisionAsDraftRequest(rawRequest);
      if (selectionPending || selectedProjectId !== request.project_id) failGenerationProjectWorkspaceRequired();
      return assertSelectedProjectWriteAllowed(request.project_id).then(() => (
        Reflect.apply(service.restore_revision_as_draft, service, [request])
      ));
    }

    async function trackedRestorePreviousCheckpointAsDraft(rawRequest) {
      const request = draftOnlyRequest(rawRequest);
      if (selectionPending || selectedProjectId === null) failGenerationProjectWorkspaceRequired();
      await assertSelectedProjectWriteAllowed(selectedProjectId);
      return Reflect.apply(service.restore_previous_checkpoint_as_draft, service, [{
        draft_id: request.draft_id,
        project_id: selectedProjectId,
      }]);
    }

    function decideCommandApproval(rawRequest) {
      if (harnessRuntimeComposition === null) fail();
      const decided = harnessRuntimeComposition.decideCommandApproval(rawRequest);
      if (decided !== true) fail();
      return Object.freeze({
        result_version: 'builder-controlled-command-approval-decision-result.v1',
        operation: 'command_approval_decided',
      });
    }

    adapter = createBuilderGenerationIpcAdapter({
      generate: trackedGenerate,
      continueDraft: trackedContinueDraft,
      generateApprovedPlan: trackedGenerateApprovedPlan,
      proposePlan: trackedProposePlan,
      preparePlanSourceReadApproval: planSourceReadApprovalStatus,
      approvePlanSourceRead,
      prepareCurrentProjectWriteApproval: currentProjectWriteApprovalStatus,
      approveCurrentProjectWrite,
      submit: trackedSubmit,
      classifyIntent: trackedClassifyIntent,
      retry: trackedRetryGenerate,
      resumeInterruptedRun: trackedResumeInterruptedRun,
      manualCompactContext: service.manual_compact_context,
      answer: trackedAnswer,
      answerPlan: trackedAnswerPlan,
      answerDraft: trackedAnswerDraft,
      restoreDraft: service.restore_draft,
      restoreRevisionAsDraft: trackedRestoreRevisionAsDraft,
      restorePreviousCheckpointAsDraft: trackedRestorePreviousCheckpointAsDraft,
      rejectDraft: service.reject_draft,
      cancel: service.cancel,
      steer: service.steer,
      queueFollowup: service.queue_followup,
      availability: service.availability,
      decideCommandApproval,
      mainWindowRef: options.mainWindowRef,
    });
    async function openProject(rawRequest) {
      const projectId = openProjectId(rawRequest);
      const operationEpoch = ++selectionEpoch;
      selectionPending = projectId !== null;
      selectedProjectId = null;
      if (projectId === null) {
        return Object.freeze({
          result_version: 'builder-project-selection-result.v1',
          operation: 'new_selected',
          project_id: null,
        });
      }
      let result;
      try {
        result = await projectMainAuthority.project_read_authority.load_current({
          project_id: projectId,
        });
      } catch (error) {
        if (safeOwnErrorCode(error) === 'builder_project_read_not_found') {
          try {
            result = localProjectSelectionFromWorkspace(
              await projectMainAuthority.metadata_authority.load_project_workspace({
                project_id: projectId,
              }),
              projectId,
            );
            if (operationEpoch === selectionEpoch) {
              selectedProjectId = projectId;
              selectionPending = false;
            }
            return result;
          } catch {
            if (operationEpoch === selectionEpoch) selectionPending = false;
            throw error;
          }
        }
        if (operationEpoch === selectionEpoch) selectionPending = false;
        throw error;
      }
      if (readResultProjectId(result) !== projectId) fail();
      if (operationEpoch === selectionEpoch) {
        selectedProjectId = projectId;
        selectionPending = false;
      }
      return result;
    }
    async function openProjectLocation(rawRequest) {
      if (options.openPath === null) fail();
      const projectId = requiredProjectId(rawRequest);
      const workspace = await projectMainAuthority.metadata_authority.load_project_workspace({
        project_id: projectId,
      });
      const projectRootPath = projectRootPathFromWorkspace(workspace, projectId);
      let stat;
      try {
        stat = fs.statSync(projectRootPath);
      } catch {
        fail();
      }
      if (!stat.isDirectory()) fail();
      const openResult = await Reflect.apply(options.openPath, undefined, [projectRootPath]);
      if (openResult !== '') fail();
      return Object.freeze({
        result_version: 'builder-project-location-open-result.v1',
        project_id: projectId,
        opened: true,
      });
    }
    async function createLocalProject(rawRequest) {
      const request = createLocalProjectRequest(rawRequest);
      if (options.showOpenDialog === null) fail();
      const operationEpoch = ++selectionEpoch;
      selectionPending = true;
      selectedProjectId = null;
      let projectRootPath;
      try {
        const windowRef = Reflect.apply(options.mainWindowRef, undefined, []);
        if (!windowRef || (typeof windowRef.isDestroyed === 'function' && windowRef.isDestroyed())) fail();
        const dialogOptions = {
          title: 'Choose an empty folder for this project',
          properties: ['openDirectory', 'createDirectory'],
        };
        projectRootPath = selectedDirectoryFromDialog(await Reflect.apply(
          options.showOpenDialog,
          undefined,
          [windowRef, dialogOptions],
        ));
      } catch (error) {
        if (operationEpoch === selectionEpoch) selectionPending = false;
        throw error;
      }
      if (projectRootPath === null) {
        if (operationEpoch === selectionEpoch) selectionPending = false;
        return Object.freeze({
          result_version: 'builder-project-selection-result.v1',
          operation: 'new_selected',
          project_id: null,
        });
      }
      const projectId = request.project_id ?? `builder-project:${randomUUID()}`;
      if (request.project_id !== null) {
        try {
          verifiedProjectIdentityId(
            await projectMainAuthority.metadata_authority.load_project_identity({
              project_id: request.project_id,
            }),
            request.project_id,
          );
        } catch (error) {
          if (operationEpoch === selectionEpoch) selectionPending = false;
          throw error;
        }
      }
      const boundAtMs = Date.now();
      let result;
      try {
        result = await projectMainAuthority.metadata_authority.bind_project_workspace({
          project_id: projectId,
          project_title: request.project_title,
          project_root_path: projectRootPath,
          source_folder_name: sourceFolderNameFromRoot(projectRootPath),
          created_at_ms: boundAtMs,
          bound_at_ms: boundAtMs,
        });
      } catch (error) {
        if (operationEpoch === selectionEpoch) selectionPending = false;
        throw error;
      }
      workspaceBoundProjectId(result, projectId);
      if (operationEpoch === selectionEpoch) {
        selectedProjectId = projectId;
        selectionPending = false;
      }
      return Object.freeze({
        result_version: 'builder-project-selection-result.v1',
        operation: 'local_project_bound',
        project_id: projectId,
        project_title: request.project_title,
        source_folders: [
          {
            name: sourceFolderNameFromRoot(projectRootPath),
            status: 'selected',
          },
        ],
      });
    }
    async function saveDraft(rawRequest) {
      if (selectionPending) fail();
      const operationEpoch = selectionEpoch;
      const expectedProjectId = selectedProjectId;
      let result;
      try {
        result = await saveAuthority.save(rawRequest);
      } catch (error) {
        recordCanarySaveFailure(options.userDataPath, error);
        throw error;
      }
      const savedProjectId = saveResultProjectId(result);
      if (operationEpoch === selectionEpoch && selectedProjectId === expectedProjectId) {
        selectedProjectId = savedProjectId;
        selectionEpoch += 1;
      }
      return result;
    }
    workspaceAdapter = createBuilderProjectWorkspaceIpcAdapter({
      openProject,
      openProjectLocation,
      createLocalProject,
      saveDraft,
      loadCurrent: projectMainAuthority.project_read_authority.load_current,
      loadRevision: projectMainAuthority.project_read_authority.load_revision,
      listCurrent: async () => applyProjectLifecycleToCatalogResult(
        await projectMainAuthority.project_read_authority.list_current({ limit: 256 }),
        'projects',
      ),
      listWorkspaces: async () => workspaceCatalogFromMetadata(
        applyProjectLifecycleToCatalogResult(
          await projectMainAuthority.metadata_authority.list_project_workspaces({ limit: 256 }),
          'workspaces',
        ),
      ),
      listHistory: projectMainAuthority.project_read_authority.list_history,
      mainWindowRef: options.mainWindowRef,
    });
    const agentProjectTreeProjection = createBuilderAgentProjectTreeProjection({
      agent_store: agentDefinitionStore,
      address_store: sessionTaskAddressStore,
      project_lifecycle_store: projectLifecycleStore,
      list_current_projects: async () => applyProjectLifecycleToCatalogResult(
        await projectMainAuthority.project_read_authority.list_current({ limit: 256 }),
        'projects',
      ),
      list_project_workspaces: async () => workspaceCatalogFromMetadata(
        applyProjectLifecycleToCatalogResult(
          await projectMainAuthority.metadata_authority.list_project_workspaces({ limit: 256 }),
          'workspaces',
        ),
      ),
      owner_id: LOCAL_BUILDER_USER_ACTOR_ID,
    });
    agentProjectTreeAdapter = createBuilderAgentProjectTreeIpcAdapter({
      readTree: agentProjectTreeProjection.read_tree,
      renameProject: renameAgentProject,
      archiveProject: archiveAgentProject,
      renameTask: renameAgentTask,
      archiveTask: archiveAgentTask,
      exportTaskTranscript: exportAgentTaskTranscript,
      mainWindowRef: options.mainWindowRef,
    });
    workbenchTaskMonitorProjection = createBuilderWorkbenchTaskMonitorProjection({
      address_store: sessionTaskAddressStore,
      read_task_stream: conversationService.read_monitor_stream,
      read_task_attention({ project_id: projectId, task_address_id: taskAddressId }) {
        return taskAttentionStore.read_task_attention({
          project_id: projectId,
          task_address_id: taskAddressId,
        });
      },
      read_task_controls({ project_id: projectId, task_address_id: taskAddressId }) {
        const binding = activeTaskRequests.get(taskAddressId) ?? null;
        return binding !== null && binding.project_id === projectId
          ? Object.freeze(['cancel_task'])
          : Object.freeze([]);
      },
    });
    workbenchTaskResultRecordingService = createBuilderTaskWorkbenchResultRecordingService({
      message_store: workbenchMessageStore,
      agent_id: LOCAL_BUILDER_AGENT_ID,
      owner_id: LOCAL_BUILDER_USER_ACTOR_ID,
    });
    const workbenchProjection = createBuilderWorkbenchTimelineProjection({
      message_store: workbenchMessageStore,
      proposal_store: workbenchTaskProposalStore,
      task_monitor_projection: workbenchTaskMonitorProjection,
    });
    const workbenchTaskIncubationService = createBuilderWorkbenchTaskIncubationService({
      proposal_store: workbenchTaskProposalStore,
      message_store: workbenchMessageStore,
      address_store: sessionTaskAddressStore,
      agent_id: LOCAL_BUILDER_AGENT_ID,
      owner_id: LOCAL_BUILDER_USER_ACTOR_ID,
      now_ms: () => Date.now(),
      async verify_project(projectId) {
        verifiedProjectIdentityId(
          await projectMainAuthority.metadata_authority.load_project_identity({
            project_id: projectId,
          }),
          projectId,
        );
        return projectId;
      },
    });
    workbenchAdapter = createBuilderWorkbenchIpcAdapter({
      readWorkbench(request) {
        return builderPerformanceTrace.measureSync('main.workbench.read.duration_ms', () => {
          synchronizeAgentWorkbench();
          const projected = workbenchProjection.read_workbench(request);
          scheduleTaskWorkbenchHydration(projected.task_monitor);
          let latestPlan = Object.freeze({ status: 'absent', artifact: null, decision: null });
          const conversation = agentConversationService.read_stream({ agent_id: request.agent_id });
          if (conversation.conversation !== null) {
            latestPlan = agentPlanService.read_latest({
              agent_id: request.agent_id,
              source_conversation_id: conversation.conversation.conversation_id,
            });
          }
          return Object.freeze({ ...projected, agent_plan: latestPlan.status === 'ready' ? latestPlan : null });
        });
      },
      updateMessageState(request) {
        const result = workbenchMessageStore.update_message_state({
          ...request,
          updated_at_ms: Date.now(),
        });
        publishWorkbenchChanged();
        return result;
      },
      createTaskProposal(request) {
        const result = workbenchTaskIncubationService.create_proposal(request);
        publishWorkbenchChanged();
        return result;
      },
      async decideTaskProposal(request) {
        const result = await workbenchTaskIncubationService.decide_proposal(request);
        if (result.materialization !== null) {
          agentPlanService.bind_dispatch_task({
            proposal_id: result.proposal.proposal_id,
            task_address_id: result.materialization.task_address_id,
          });
        }
        publishWorkbenchChanged();
        if (result.materialization !== null) {
          publishTaskStreamChanged({
            event_version: 'builder-task-stream-changed.v1',
            project_id: result.materialization.project_id,
          });
        }
        return result;
      },
      decideAgentPlan(request) {
        if (request.agent_id !== LOCAL_BUILDER_AGENT_ID) fail();
        const result = agentPlanService.decide(request);
        if (request.decision === 'approved') {
          const selected = agentPlanService.read({ agent_plan_id: request.agent_plan_id });
          if (selected.status !== 'ready') fail();
          const planUuid = request.agent_plan_id.slice('builder-agent-plan:'.length);
          const objective = createBuilderAgentPlanTaskObjective({
            artifact: selected.artifact,
            conversation: agentConversationService.read_stream({ agent_id: request.agent_id }).conversation,
          });
          const proposal = workbenchTaskIncubationService.create_proposal({
            request_id: `builder-workbench-request:${planUuid}`,
            agent_id: request.agent_id,
            objective,
            requested_outcome: 'build',
            execution_mode: 'foreground',
            reason: `Execute approved Agent Plan v${selected.artifact.version}. The task must read the bound approved plan before acting.`,
          });
          agentPlanService.record_dispatch({
            agent_plan_id: request.agent_plan_id,
            proposal_id: proposal.proposal.proposal_id,
          });
        }
        publishWorkbenchChanged();
        return result;
      },
      controlTask(request) {
        if (request.agent_id !== LOCAL_BUILDER_AGENT_ID) fail();
        const addressed = sessionTaskAddressStore.read_task_address({
          project_id: request.project_id,
          task_address_id: request.task_address_id,
        });
        const taskAddress = addressed?.task_address?.task_address;
        if (
          addressed?.status !== 'ready'
          || taskAddress?.agent_id !== request.agent_id
          || taskAddress?.project_id !== request.project_id
          || taskAddress?.task_address_id !== request.task_address_id
        ) fail();
        const binding = activeTaskRequests.get(request.task_address_id) ?? null;
        if (binding === null || binding.project_id !== request.project_id) {
          return Object.freeze({
            result_version: 'builder-workbench-task-control-result.v1',
            operation: 'task_not_active',
            project_id: request.project_id,
            task_address_id: request.task_address_id,
          });
        }
        const cancelled = service.cancel({ request_id: binding.request_id });
        if (cancelled?.cancelled === true) {
          activeTaskRequests.delete(request.task_address_id);
          try {
            recordTaskAttention(
              { project_id: request.project_id, task_address_id: request.task_address_id },
              'ready',
              'resolved',
            );
          } finally {
            invalidateTaskWorkbench(request.project_id, request.task_address_id);
            publishWorkbenchChanged();
          }
        } else {
          publishWorkbenchChanged();
        }
        return Object.freeze({
          result_version: 'builder-workbench-task-control-result.v1',
          operation: cancelled?.cancelled === true ? 'cancel_requested' : 'task_not_active',
          project_id: request.project_id,
          task_address_id: request.task_address_id,
        });
      },
      mainWindowRef: options.mainWindowRef,
    });
    taskStreamAdapter = createBuilderTaskStreamIpcAdapter({
      readStream(rawRequest) {
        if (Object.hasOwn(rawRequest, 'agent_id')) {
          return agentConversationService.read_stream(rawRequest);
        }
        const target = sessionTaskTargetService.resolve_target(rawRequest);
        // Reconcile a former process's open run before displaying its history.
        // Navigation never redispatches work or grants execution permission.
        if (!activeTaskRequests.has(target.task_address_id)) {
          conversationService.recover_inactive_run({
            project_id: target.project_id,
            conversation_id: target.conversation_id,
          });
        }
        return conversationService.read_stream({
          project_id: target.project_id,
          conversation_id: target.conversation_id,
        });
      },
      mainWindowRef: options.mainWindowRef,
    });
    planReviewAdapter = createBuilderPlanReviewIpcAdapter({
      reviewPlan: conversationService.review_plan,
      mainWindowRef: options.mainWindowRef,
    });
    activeRequestIds = () => Object.freeze([...activeRequests.keys()]);
  } catch {
    livePreviewCurrentDraftSourceService = null;
    livePreviewCurrentDraftSourceDependencies = null;
    try { agentConversationService?.close(); } catch { /* fixed failure below */ }
    try { agentPlanStore?.close(); } catch { /* fixed failure below */ }
    try { workbenchTaskProposalStore?.close(); } catch { /* fixed failure below */ }
    try { taskAttentionStore?.close(); } catch { /* fixed failure below */ }
    try { workbenchMessageStore?.close(); } catch { /* fixed failure below */ }
    try { handoffPacketStore?.close(); } catch { /* fixed failure below */ }
    try { contextCompactionSummaryStore?.close(); } catch { /* fixed failure below */ }
    try { checkSkipDecisionStore?.close(); } catch { /* fixed failure below */ }
    try { checkRunStore?.close(); } catch { /* fixed failure below */ }
    try { draftCheckpointStore?.close(); } catch { /* fixed failure below */ }
    try { sessionTaskAddressStore?.close(); } catch { /* fixed failure below */ }
    try { projectLifecycleStore?.close(); } catch { /* fixed failure below */ }
    try { agentDefinitionStore?.close(); } catch { /* fixed failure below */ }
    try { projectUnderstandingStore?.close(); } catch { /* fixed failure below */ }
    try { taskCapsuleStore?.close(); } catch { /* fixed failure below */ }
    try { permissionFactStore?.close(); } catch { /* fixed failure below */ }
    try { projectMainAuthority?.close(); } catch { /* fixed failure below */ }
    fail();
  }

  const handlers = Object.freeze([
    Object.freeze({ channel: GENERATE_CHANNEL, invoke: adapter.channels.generate.invoke }),
    Object.freeze({ channel: CONTINUE_DRAFT_CHANNEL, invoke: adapter.channels.continueDraft.invoke }),
    Object.freeze({ channel: GENERATE_APPROVED_PLAN_CHANNEL, invoke: adapter.channels.generateApprovedPlan.invoke }),
    Object.freeze({ channel: PROPOSE_PLAN_CHANNEL, invoke: adapter.channels.proposePlan.invoke }),
    Object.freeze({
      channel: PREPARE_PLAN_SOURCE_READ_APPROVAL_CHANNEL,
      invoke: adapter.channels.preparePlanSourceReadApproval.invoke,
    }),
    Object.freeze({
      channel: APPROVE_PLAN_SOURCE_READ_CHANNEL,
      invoke: adapter.channels.approvePlanSourceRead.invoke,
    }),
    Object.freeze({
      channel: PREPARE_CURRENT_PROJECT_WRITE_APPROVAL_CHANNEL,
      invoke: adapter.channels.prepareCurrentProjectWriteApproval.invoke,
    }),
    Object.freeze({
      channel: APPROVE_CURRENT_PROJECT_WRITE_CHANNEL,
      invoke: adapter.channels.approveCurrentProjectWrite.invoke,
    }),
    Object.freeze({ channel: SUBMIT_CHANNEL, invoke: adapter.channels.submit.invoke }),
    Object.freeze({ channel: CLASSIFY_INTENT_CHANNEL, invoke: adapter.channels.classifyIntent.invoke }),
    Object.freeze({ channel: RETRY_GENERATE_CHANNEL, invoke: adapter.channels.retry.invoke }),
    Object.freeze({
      channel: RESUME_INTERRUPTED_RUN_CHANNEL,
      invoke: adapter.channels.resumeInterruptedRun.invoke,
    }),
    Object.freeze({
      channel: MANUAL_COMPACT_CONTEXT_CHANNEL,
      invoke: adapter.channels.manualCompactContext.invoke,
    }),
    Object.freeze({ channel: ANSWER_CHANNEL, invoke: adapter.channels.answer.invoke }),
    Object.freeze({ channel: ANSWER_PLAN_CHANNEL, invoke: adapter.channels.answerPlan.invoke }),
    Object.freeze({ channel: ANSWER_DRAFT_CHANNEL, invoke: adapter.channels.answerDraft.invoke }),
    Object.freeze({ channel: RESTORE_DRAFT_CHANNEL, invoke: adapter.channels.restoreDraft.invoke }),
    Object.freeze({
      channel: RESTORE_REVISION_AS_DRAFT_CHANNEL,
      invoke: adapter.channels.restoreRevisionAsDraft.invoke,
    }),
    Object.freeze({
      channel: RESTORE_PREVIOUS_CHECKPOINT_AS_DRAFT_CHANNEL,
      invoke: adapter.channels.restorePreviousCheckpointAsDraft.invoke,
    }),
    Object.freeze({ channel: REJECT_DRAFT_CHANNEL, invoke: adapter.channels.rejectDraft.invoke }),
    Object.freeze({ channel: CANCEL_CHANNEL, invoke: adapter.channels.cancel.invoke }),
    Object.freeze({ channel: STEER_CHANNEL, invoke: adapter.channels.steer.invoke }),
    Object.freeze({ channel: QUEUE_FOLLOWUP_CHANNEL, invoke: adapter.channels.queueFollowup.invoke }),
    Object.freeze({ channel: AVAILABILITY_CHANNEL, invoke: adapter.channels.availability.invoke }),
    Object.freeze({
      channel: DECIDE_COMMAND_APPROVAL_CHANNEL,
      invoke: adapter.channels.decideCommandApproval.invoke,
    }),
    Object.freeze({ channel: OPEN_PROJECT_CHANNEL, invoke: workspaceAdapter.channels.open.invoke }),
    Object.freeze({ channel: OPEN_PROJECT_LOCATION_CHANNEL, invoke: workspaceAdapter.channels.openLocation.invoke }),
    Object.freeze({ channel: CREATE_LOCAL_PROJECT_CHANNEL, invoke: workspaceAdapter.channels.createLocalProject.invoke }),
    Object.freeze({ channel: SAVE_DRAFT_CHANNEL, invoke: workspaceAdapter.channels.saveDraft.invoke }),
    Object.freeze({ channel: LOAD_CURRENT_CHANNEL, invoke: workspaceAdapter.channels.loadCurrent.invoke }),
    Object.freeze({ channel: LOAD_REVISION_CHANNEL, invoke: workspaceAdapter.channels.loadRevision.invoke }),
    Object.freeze({ channel: LIST_CURRENT_CHANNEL, invoke: workspaceAdapter.channels.listCurrent.invoke }),
    Object.freeze({ channel: LIST_WORKSPACES_CHANNEL, invoke: workspaceAdapter.channels.listWorkspaces.invoke }),
    Object.freeze({ channel: LIST_HISTORY_CHANNEL, invoke: workspaceAdapter.channels.listHistory.invoke }),
    Object.freeze({ channel: READ_TASK_STREAM_CHANNEL, invoke: taskStreamAdapter.channels.read.invoke }),
    Object.freeze({ channel: READ_AGENT_PROJECT_TREE_CHANNEL, invoke: agentProjectTreeAdapter.invoke }),
    Object.freeze({
      channel: RENAME_AGENT_PROJECT_CHANNEL,
      invoke: agentProjectTreeAdapter.channels.renameProject.invoke,
    }),
    Object.freeze({
      channel: ARCHIVE_AGENT_PROJECT_CHANNEL,
      invoke: agentProjectTreeAdapter.channels.archiveProject.invoke,
    }),
    Object.freeze({
      channel: RENAME_AGENT_TASK_CHANNEL,
      invoke: agentProjectTreeAdapter.channels.renameTask.invoke,
    }),
    Object.freeze({
      channel: ARCHIVE_AGENT_TASK_CHANNEL,
      invoke: agentProjectTreeAdapter.channels.archiveTask.invoke,
    }),
    Object.freeze({
      channel: EXPORT_AGENT_TASK_TRANSCRIPT_CHANNEL,
      invoke: agentProjectTreeAdapter.channels.exportTaskTranscript.invoke,
    }),
    Object.freeze({
      channel: READ_AGENT_WORKBENCH_CHANNEL,
      invoke: workbenchAdapter.channels.read.invoke,
    }),
    Object.freeze({
      channel: UPDATE_WORKBENCH_MESSAGE_STATE_CHANNEL,
      invoke: workbenchAdapter.channels.updateMessageState.invoke,
    }),
    Object.freeze({
      channel: CREATE_WORKBENCH_TASK_PROPOSAL_CHANNEL,
      invoke: workbenchAdapter.channels.createTaskProposal.invoke,
    }),
    Object.freeze({
      channel: DECIDE_WORKBENCH_TASK_PROPOSAL_CHANNEL,
      invoke: workbenchAdapter.channels.decideTaskProposal.invoke,
    }),
    Object.freeze({
      channel: DECIDE_AGENT_PLAN_CHANNEL,
      invoke: workbenchAdapter.channels.decideAgentPlan.invoke,
    }),
    Object.freeze({
      channel: CONTROL_WORKBENCH_TASK_CHANNEL,
      invoke: workbenchAdapter.channels.controlTask.invoke,
    }),
    Object.freeze({ channel: REVIEW_PLAN_CHANNEL, invoke: planReviewAdapter.channels.review.invoke }),
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

  function pauseActiveRequestsForShutdown() {
    let failed = false;
    for (const requestId of activeRequestIds()) {
      try {
        const result = Reflect.apply(service.pause_for_shutdown, undefined, [{ request_id: requestId }]);
        if (result?.cancelled !== true) failed = true;
      } catch {
        failed = true;
      }
    }
    activeTaskRequests.clear();
    return failed === false;
  }

  function closeProjectMainAuthority() {
    if (
      projectMainAuthority === null
      && harnessRuntimeComposition === null
      && structuredRuntimeWorkspaceSnapshotStore === null
    ) return true;
    try {
      livePreviewCurrentDraftSourceService = null;
      livePreviewCurrentDraftSourceDependencies = null;
      runtimeWorkspaceSourceService = null;
      projectEnvironmentDiagnosisService = null;
      projectDependencyPreparer = null;
      if (harnessRuntimeComposition !== null) {
        const pendingDisposal = harnessRuntimeComposition.dispose();
        if (pendingDisposal && typeof pendingDisposal.catch === 'function') {
          void pendingDisposal.catch(() => {});
        }
        harnessRuntimeComposition = null;
      }
      structuredRuntimeWorkspaceSnapshotService = null;
      structuredRuntimeWorkspaceSnapshotStore = null;
      if (projectMainAuthority !== null) {
        projectMainAuthority.close();
        projectMainAuthority = null;
      }
      if (projectLifecycleStore !== null) {
        projectLifecycleStore.close();
        projectLifecycleStore = null;
      }
      return true;
    } catch {
      return false;
    }
  }

  function closePermissionFactStore() {
    if (permissionFactStore === null) return true;
    try {
      permissionFactStore.close();
      permissionFactStore = null;
      return true;
    } catch {
      return false;
    }
  }

  function closeTaskCapsuleStore() {
    if (taskCapsuleStore === null) return true;
    try {
      taskCapsuleStore.close();
      taskCapsuleStore = null;
      return true;
    } catch {
      return false;
    }
  }

  function closeProjectUnderstandingStore() {
    if (projectUnderstandingStore === null) return true;
    try {
      projectUnderstandingStore.close();
      projectUnderstandingStore = null;
      return true;
    } catch {
      return false;
    }
  }

  function closeSessionTaskAddressStore() {
    if (sessionTaskAddressStore === null) return true;
    try {
      sessionTaskAddressStore.close();
      sessionTaskAddressStore = null;
      return true;
    } catch {
      return false;
    }
  }

  function closeAgentDefinitionStore() {
    if (agentDefinitionStore === null) return true;
    try {
      agentDefinitionStore.close();
      agentDefinitionStore = null;
      return true;
    } catch {
      return false;
    }
  }

  function closeAgentConversationService() {
    if (agentConversationService === null) return true;
    try {
      agentConversationService.close();
      agentConversationService = null;
      return true;
    } catch {
      return false;
    }
  }

  function closeAgentPlanStore() {
    if (agentPlanStore === null) return true;
    try {
      agentPlanStore.close();
      agentPlanStore = null;
      agentPlanService = null;
      return true;
    } catch {
      return false;
    }
  }

  function closeWorkbenchMessageStore() {
    workbenchTaskHydrationTasks.clear();
    workbenchTaskHydrationScheduled = false;
    workbenchRecordingService = null;
    workbenchTaskMonitorProjection = null;
    workbenchTaskResultRecordingService = null;
    if (taskAttentionStore !== null) {
      try {
        taskAttentionStore.close();
        taskAttentionStore = null;
      } catch {
        return false;
      }
    }
    if (workbenchTaskProposalStore !== null) {
      try {
        workbenchTaskProposalStore.close();
        workbenchTaskProposalStore = null;
      } catch {
        return false;
      }
    }
    if (workbenchMessageStore === null) return true;
    try {
      workbenchMessageStore.close();
      workbenchMessageStore = null;
      return true;
    } catch {
      return false;
    }
  }

  function closeDraftCheckpointStore() {
    if (draftCheckpointStore === null) return true;
    try {
      draftCheckpointStore.close();
      draftCheckpointStore = null;
      return true;
    } catch {
      return false;
    }
  }

  function closeCheckRunStore() {
    if (checkRunStore === null) return true;
    try {
      checkRunStore.close();
      checkRunStore = null;
      return true;
    } catch {
      return false;
    }
  }

  function closeCheckSkipDecisionStore() {
    if (checkSkipDecisionStore === null) return true;
    try {
      checkSkipDecisionStore.close();
      checkSkipDecisionStore = null;
      checkRunSkipCurrentDraftService = null;
      return true;
    } catch {
      return false;
    }
  }

  function closeContextCompactionSummaryStore() {
    if (contextCompactionSummaryStore === null) return true;
    try {
      contextCompactionSummaryStore.close();
      contextCompactionSummaryStore = null;
      return true;
    } catch {
      return false;
    }
  }

  function closeHandoffPacketStore() {
    if (handoffPacketStore === null) return true;
    try {
      handoffPacketStore.close();
      handoffPacketStore = null;
      return true;
    } catch {
      return false;
    }
  }

  return Object.freeze({
    runtime_version: BUILDER_GENERATION_IPC_RUNTIME_VERSION,
    channels: Object.freeze(handlers.map(({ channel }) => channel)),
    readProviderContextDisclosureStatusServiceForMainOnlyApprovalRuntime() {
      if (providerContextDisclosureStatusService === null || state === 'disposed') fail();
      return providerContextDisclosureStatusService;
    },
    readCheckRunCurrentDraftServiceForMainOnlyApprovalRuntime() {
      if (checkRunCurrentDraftService === null || state === 'disposed') fail();
      return checkRunCurrentDraftService;
    },
    readCheckRunSkipCurrentDraftServiceForMainOnlyApprovalRuntime() {
      if (checkRunSkipCurrentDraftService === null || state === 'disposed') fail();
      return checkRunSkipCurrentDraftService;
    },
    readProjectEnvironmentDiagnosisServiceForMainOnlyApprovalRuntime() {
      if (projectEnvironmentDiagnosisService === null || state === 'disposed') fail();
      return projectEnvironmentDiagnosisService;
    },
    readProjectDependencyPreparerForMainOnlyApprovalRuntime() {
      if (projectDependencyPreparer === null || state === 'disposed') fail();
      return projectDependencyPreparer;
    },
    readLivePreviewCurrentDraftSourceServiceForMainOnlyRuntime() {
      if (state === 'disposed') fail();
      if (livePreviewCurrentDraftSourceService === null) {
        if (livePreviewCurrentDraftSourceDependencies === null) fail();
        livePreviewCurrentDraftSourceService = createBuilderLivePreviewCurrentDraftSourceService({
          conversation_service: livePreviewCurrentDraftSourceDependencies.conversation_service,
          git_authority: livePreviewCurrentDraftSourceDependencies.git_authority,
          automatic_draft_checkpoint_service:
            livePreviewCurrentDraftSourceDependencies.automatic_draft_checkpoint_service,
          project_read_authority:
            livePreviewCurrentDraftSourceDependencies.project_read_authority,
          now_ms: () => Date.now(),
        });
      }
      return livePreviewCurrentDraftSourceService;
    },
    readProjectWorkspacePathServiceForMainOnlyRuntime() {
      if (state === 'disposed') fail();
      return projectWorkspacePathService;
    },
    readRuntimeWorkspaceSourceServiceForMainOnlyRuntime() {
      if (state === 'disposed') fail();
      if (runtimeWorkspaceSourceService === null) {
        runtimeWorkspaceSourceService = Object.freeze({
          service_version: RUNTIME_WORKSPACE_SOURCE_SERVICE_VERSION,
          async resolve_runtime_tool_source(request) {
            if (harnessRuntimeComposition !== null) {
              try {
                return await harnessRuntimeComposition.readRuntimeToolFile(request);
              } catch { /* the run may belong to the structured runtime */ }
            }
            if (structuredRuntimeWorkspaceSnapshotService === null) fail();
            return structuredRuntimeWorkspaceSnapshotService.readRuntimeToolFile(request);
          },
          async resolve_runtime_snapshot_source(request) {
            if (harnessRuntimeComposition !== null) {
              try {
                return await harnessRuntimeComposition.readRuntimeSourceTree(request);
              } catch { /* the run may belong to the structured runtime */ }
            }
            if (structuredRuntimeWorkspaceSnapshotService === null) fail();
            return structuredRuntimeWorkspaceSnapshotService.readRuntimeSourceTree(request);
          },
        });
      }
      return runtimeWorkspaceSourceService;
    },
    register() {
      if (state === 'registered') return false;
      if (state !== 'idle') fail();
      try {
        for (const entry of handlers) {
          Reflect.apply(options.handle, options.ipcMain, [entry.channel, entry.invoke]);
          installed.push(entry);
        }
        state = 'registered';
        return true;
      } catch {
        const removed = removeInstalledHandlers();
        const handoffsClosed = closeHandoffPacketStore();
        const compactionsClosed = handoffsClosed ? closeContextCompactionSummaryStore() : false;
        const checkSkipsClosed = compactionsClosed ? closeCheckSkipDecisionStore() : false;
        const checksClosed = checkSkipsClosed ? closeCheckRunStore() : false;
        const checkpointsClosed = checksClosed ? closeDraftCheckpointStore() : false;
        const addressesClosed = checkpointsClosed ? closeSessionTaskAddressStore() : false;
        const agentConversationsClosed = addressesClosed ? closeAgentConversationService() : false;
        const agentPlansClosed = agentConversationsClosed ? closeAgentPlanStore() : false;
        const workbenchClosed = agentPlansClosed ? closeWorkbenchMessageStore() : false;
        const agentsClosed = workbenchClosed ? closeAgentDefinitionStore() : false;
        const understandingsClosed = agentsClosed ? closeProjectUnderstandingStore() : false;
        const taskCapsulesClosed = understandingsClosed ? closeTaskCapsuleStore() : false;
        const permissionsClosed = taskCapsulesClosed ? closePermissionFactStore() : false;
        const closed = permissionsClosed ? closeProjectMainAuthority() : false;
        state = removed && handoffsClosed && compactionsClosed && checkSkipsClosed && checksClosed
          && checkpointsClosed && addressesClosed && agentConversationsClosed && agentPlansClosed && workbenchClosed
          && agentsClosed
          && understandingsClosed && taskCapsulesClosed && permissionsClosed && closed
          ? 'disposed'
          : 'cleanup_required';
        fail();
      }
    },
    dispose() {
      if (state === 'disposed') return false;
      if (state === 'idle') {
        const handoffsClosed = closeHandoffPacketStore();
        const compactionsClosed = handoffsClosed ? closeContextCompactionSummaryStore() : false;
        const checkSkipsClosed = compactionsClosed ? closeCheckSkipDecisionStore() : false;
        const checksClosed = checkSkipsClosed ? closeCheckRunStore() : false;
        const checkpointsClosed = checksClosed ? closeDraftCheckpointStore() : false;
        const addressesClosed = checkpointsClosed ? closeSessionTaskAddressStore() : false;
        const agentConversationsClosed = addressesClosed ? closeAgentConversationService() : false;
        const agentPlansClosed = agentConversationsClosed ? closeAgentPlanStore() : false;
        const workbenchClosed = agentPlansClosed ? closeWorkbenchMessageStore() : false;
        const agentsClosed = workbenchClosed ? closeAgentDefinitionStore() : false;
        const understandingsClosed = agentsClosed ? closeProjectUnderstandingStore() : false;
        const taskCapsulesClosed = understandingsClosed ? closeTaskCapsuleStore() : false;
        const permissionsClosed = taskCapsulesClosed ? closePermissionFactStore() : false;
        const closed = permissionsClosed ? closeProjectMainAuthority() : false;
        if (!handoffsClosed || !compactionsClosed || !checkSkipsClosed || !checksClosed
          || !checkpointsClosed || !addressesClosed || !agentConversationsClosed || !agentPlansClosed
          || !workbenchClosed || !agentsClosed
          || !understandingsClosed || !taskCapsulesClosed || !permissionsClosed || !closed) {
          state = 'cleanup_required';
          fail();
        }
        state = 'disposed';
        return false;
      }
      const cancelled = pauseActiveRequestsForShutdown();
      const removed = removeInstalledHandlers();
      const handoffsClosed = cancelled ? closeHandoffPacketStore() : false;
      const compactionsClosed = handoffsClosed ? closeContextCompactionSummaryStore() : false;
      const checkSkipsClosed = compactionsClosed ? closeCheckSkipDecisionStore() : false;
      const checksClosed = checkSkipsClosed ? closeCheckRunStore() : false;
      const checkpointsClosed = checksClosed ? closeDraftCheckpointStore() : false;
      const addressesClosed = checkpointsClosed ? closeSessionTaskAddressStore() : false;
      const agentConversationsClosed = addressesClosed ? closeAgentConversationService() : false;
      const agentPlansClosed = agentConversationsClosed ? closeAgentPlanStore() : false;
      const workbenchClosed = agentPlansClosed ? closeWorkbenchMessageStore() : false;
      const agentsClosed = workbenchClosed ? closeAgentDefinitionStore() : false;
      const understandingsClosed = agentsClosed ? closeProjectUnderstandingStore() : false;
      const taskCapsulesClosed = understandingsClosed ? closeTaskCapsuleStore() : false;
      const permissionsClosed = taskCapsulesClosed ? closePermissionFactStore() : false;
      const closed = permissionsClosed ? closeProjectMainAuthority() : false;
      if (!cancelled || !removed || !handoffsClosed || !compactionsClosed || !checkSkipsClosed
        || !checksClosed || !checkpointsClosed || !addressesClosed
        || !agentConversationsClosed || !agentPlansClosed || !workbenchClosed || !agentsClosed
        || !understandingsClosed || !taskCapsulesClosed || !permissionsClosed || !closed) {
        state = 'cleanup_required';
        fail();
      }
      state = 'disposed';
      return true;
    },
  });
}

module.exports = Object.freeze({
  BUILDER_GENERATION_IPC_RUNTIME_VERSION,
  PROJECT_REPOSITORY_DIRECTORY,
  GIT_RUNTIME_DIRECTORY,
  METADATA_DIRECTORY,
  METADATA_DATABASE,
  TASK_CAPSULE_DIRECTORY,
  TASK_CAPSULE_DATABASE,
  PROJECT_UNDERSTANDING_DIRECTORY,
  PROJECT_UNDERSTANDING_DATABASE,
  CONTEXT_COMPACTION_SUMMARY_DIRECTORY,
  CONTEXT_COMPACTION_SUMMARY_DATABASE,
  HANDOFF_PACKET_DIRECTORY,
  HANDOFF_PACKET_DATABASE,
  packagedCheckWorkerPath,
  bundledHarnessRuntimeRoot,
  mainOwnedProgrammingRuntimeFeatureFlag,
  BuilderGenerationIpcRuntimeError,
  ANSWER_DRAFT_CHANNEL,
  createBuilderGenerationIpcRuntime,
});
