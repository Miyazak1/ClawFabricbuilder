'use strict';

const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { types: utilTypes } = require('node:util');

const {
  ANSWER_CHANNEL,
  ANSWER_DRAFT_CHANNEL,
  AVAILABILITY_CHANNEL,
  APPROVE_CURRENT_PROJECT_WRITE_CHANNEL,
  APPROVE_PLAN_SOURCE_READ_CHANNEL,
  CANCEL_CHANNEL,
  CONTINUE_DRAFT_CHANNEL,
  GENERATE_APPROVED_PLAN_CHANNEL,
  GENERATE_CHANNEL,
  GENERATION_OUTPUT_CHANNEL,
  GENERATION_STARTED_CHANNEL,
  PREPARE_CURRENT_PROJECT_WRITE_APPROVAL_CHANNEL,
  PREPARE_PLAN_SOURCE_READ_APPROVAL_CHANNEL,
  PROPOSE_PLAN_CHANNEL,
  QUEUE_FOLLOWUP_CHANNEL,
  REJECT_DRAFT_CHANNEL,
  RESTORE_DRAFT_CHANNEL,
  RESTORE_REVISION_AS_DRAFT_CHANNEL,
  RETRY_GENERATE_CHANNEL,
  STEER_CHANNEL,
  SUBMIT_CHANNEL,
  createBuilderGenerationIpcAdapter,
} = require('./builder-generation-ipc-adapter.cjs');
const {
  createBuilderGenerationMainService,
} = require('./builder-generation-main-service.cjs');
const {
  createBuilderConversationMainService,
} = require('./builder-conversation-main-service.cjs');
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
  createBuilderSessionTaskAddressRecordingService,
} = require('./builder-session-task-address-recording-service.cjs');
const {
  createBuilderSessionTaskAddressBindingService,
} = require('./builder-session-task-address-binding-service.cjs');
const {
  createBuilderContextCompactionSummaryStore,
} = require('./builder-context-compaction-summary-store.cjs');
const {
  createBuilderHandoffPacketStore,
} = require('./builder-handoff-packet-store.cjs');
const {
  createBuilderWorkingContextStateService,
} = require('./builder-working-context-state-service.cjs');

const BUILDER_GENERATION_IPC_RUNTIME_VERSION = 'builder-generation-ipc-runtime.v2';
const TASK_CAPSULE_DIRECTORY = 'builder-task-capsules-v1';
const TASK_CAPSULE_DATABASE = 'task-capsules.sqlite';
const SESSION_TASK_ADDRESS_DIRECTORY = 'builder-session-task-addresses-v1';
const SESSION_TASK_ADDRESS_DATABASE = 'session-task-addresses.sqlite';
const CONTEXT_COMPACTION_SUMMARY_DIRECTORY = 'builder-context-compaction-summaries-v1';
const CONTEXT_COMPACTION_SUMMARY_DATABASE = 'context-compaction-summaries.sqlite';
const HANDOFF_PACKET_DIRECTORY = 'builder-handoff-packets-v1';
const HANDOFF_PACKET_DATABASE = 'handoff-packets.sqlite';
const LOCAL_BUILDER_AGENT_ID = 'builder-agent:123e4567-e89b-42d3-a456-426614174002';
const OPTION_KEYS = Object.freeze([
  'fetchImpl',
  'grantPermissionForExplicitApproval',
  'ipcMain',
  'mainWindowRef',
  'openPath',
  'userDataPath',
  'showOpenDialog',
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
const DRAFT_ID_PATTERN = /^builder-generation-draft:[0-9a-f]{64}$/u;
const REQUEST_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const CONVERSATION_ID_PATTERN = /^builder-conversation:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
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
const PRODUCT_METADATA_SCHEMA_VERSION = 'builder-product-metadata-schema.v6';
const PRODUCT_METADATA_USER_VERSION = 6;

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
    if (
      ownKeys.length !== (hasQueuedFollowup ? 2 : 1)
      || !ownKeys.includes('instruction')
      || (hasQueuedFollowup && !ownKeys.includes('queued_followup'))
    ) throw new Error();
    const descriptor = Object.getOwnPropertyDescriptor(rawRequest, 'instruction');
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      throw new Error();
    }
    return Object.freeze({
      instruction: descriptor.value,
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

function planSourceReadApprovalProjectId(rawRequest) {
  const projectId = exactDataValue(rawRequest, ['project_id'], 'project_id');
  if (typeof projectId !== 'string' || !PROJECT_ID_PATTERN.test(projectId)) fail();
  return projectId;
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
    || conversationId.slice('builder-conversation:'.length)
      !== projectId.slice('builder-project:'.length)
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
    || descriptors.schema_version.value !== PRODUCT_METADATA_SCHEMA_VERSION
    || descriptors.user_version.value !== PRODUCT_METADATA_USER_VERSION
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
    if (rootRealPath !== workspaceRootPath) fail();
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
  if (
    keys.length !== 2
    || keys.some((key) => typeof key !== 'string' || !['event_version', 'project_id'].includes(key))
  ) fail();
  const version = Object.getOwnPropertyDescriptor(rawEvent, 'event_version');
  const projectId = Object.getOwnPropertyDescriptor(rawEvent, 'project_id');
  if (
    !version
    || version.enumerable !== true
    || !Object.hasOwn(version, 'value')
    || version.value !== 'builder-task-stream-changed.v1'
    || !projectId
    || projectId.enumerable !== true
    || !Object.hasOwn(projectId, 'value')
    || typeof projectId.value !== 'string'
    || !PROJECT_ID_PATTERN.test(projectId.value)
  ) fail();
  return Object.freeze({
    event_version: 'builder-task-stream-changed.v1',
    project_id: projectId.value,
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
    || typeof projectId.value !== 'string'
    || !PROJECT_ID_PATTERN.test(projectId.value)
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

function generationOutputEvent(rawEvent) {
  if (!isPlainObject(rawEvent)) fail();
  const keys = Reflect.ownKeys(rawEvent);
  const expectedKeys = [
    'event_version',
    'request_id',
    'project_id',
    'conversation_id',
    'turn_id',
    'task_id',
    'run_id',
    'display_delta_text',
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
    descriptors.event_version.value !== 'builder-generation-output.v1'
    || typeof descriptors.request_id.value !== 'string'
    || !REQUEST_DIGEST_PATTERN.test(descriptors.request_id.value)
    || typeof descriptors.project_id.value !== 'string'
    || !PROJECT_ID_PATTERN.test(descriptors.project_id.value)
    || typeof descriptors.conversation_id.value !== 'string'
    || !CONVERSATION_ID_PATTERN.test(descriptors.conversation_id.value)
    || descriptors.conversation_id.value.slice('builder-conversation:'.length)
      !== descriptors.project_id.value.slice('builder-project:'.length)
    || typeof descriptors.turn_id.value !== 'string'
    || !TURN_ID_PATTERN.test(descriptors.turn_id.value)
    || (taskId !== null && (typeof taskId !== 'string' || !TASK_ID_PATTERN.test(taskId)))
    || typeof descriptors.run_id.value !== 'string'
    || !RUN_ID_PATTERN.test(descriptors.run_id.value)
  ) fail();
  return Object.freeze({
    event_version: 'builder-generation-output.v1',
    request_id: descriptors.request_id.value,
    project_id: descriptors.project_id.value,
    conversation_id: descriptors.conversation_id.value,
    turn_id: descriptors.turn_id.value,
    task_id: taskId,
    run_id: descriptors.run_id.value,
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
  let sessionTaskAddressStore = null;
  let contextCompactionSummaryStore = null;
  let handoffPacketStore = null;
  let projectMainAuthority = null;
  let service;
  let adapter;
  let workspaceAdapter;
  let taskStreamAdapter;
  let planReviewAdapter;
  let providerContextDisclosureStatusService = null;
  let selectedProjectId = null;
  let selectedConversationProjectId = null;
  let selectionEpoch = 0;
  let selectionPending = false;
  const activeRequests = new Map();
  const activeAnswerRequests = new Set();
  let activeRequestIds = () => Object.freeze([]);
  try {
    projectMainAuthority = createBuilderProjectMainAuthority({
      userDataPath: options.userDataPath,
    });
    const lazyProviderConfigRepository = Object.freeze({
      bind_current_authority() {
        if (providerConfigRepository === null) {
          providerConfigRepository = createBuilderProviderConfigRepository(options.userDataPath);
        }
        return providerConfigRepository.bind_current_authority();
      },
    });
    function publishTaskStreamChanged(rawEvent) {
      const event = taskStreamChangedEvent(rawEvent);
      const webContents = activeWebContents(options.mainWindowRef);
      if (webContents === null || typeof webContents.send !== 'function') return;
      try {
        webContents.send(TASK_STREAM_CHANGED_CHANNEL, event);
      } catch {
        // Activity notifications are opportunistic; the read IPC remains authoritative.
      }
    }
    const permissionRoot = path.join(options.userDataPath, PERMISSION_DIRECTORY);
    fs.mkdirSync(permissionRoot, { recursive: true, mode: 0o700 });
    permissionFactStore = createBuilderPermissionFactStore(path.join(permissionRoot, PERMISSION_DATABASE));
    const taskCapsuleRoot = path.join(options.userDataPath, TASK_CAPSULE_DIRECTORY);
    fs.mkdirSync(taskCapsuleRoot, { recursive: true, mode: 0o700 });
    taskCapsuleStore = createBuilderTaskCapsuleStore(path.join(taskCapsuleRoot, TASK_CAPSULE_DATABASE));
    const taskCapsuleRecordingService = createBuilderTaskCapsuleRecordingService({
      task_capsule_store: taskCapsuleStore,
    });
    const sessionTaskAddressRoot = path.join(options.userDataPath, SESSION_TASK_ADDRESS_DIRECTORY);
    fs.mkdirSync(sessionTaskAddressRoot, { recursive: true, mode: 0o700 });
    sessionTaskAddressStore = createBuilderSessionTaskAddressStore(
      path.join(sessionTaskAddressRoot, SESSION_TASK_ADDRESS_DATABASE),
    );
    const sessionTaskAddressRecordingService = createBuilderSessionTaskAddressRecordingService({
      address_store: sessionTaskAddressStore,
      create_uuid: randomUUID,
      now_ms: () => Date.now(),
      created_by: LOCAL_BUILDER_USER_ACTOR_ID,
      agent_id: LOCAL_BUILDER_AGENT_ID,
    });
    const sessionTaskAddressBindingService = createBuilderSessionTaskAddressBindingService({
      address_store: sessionTaskAddressStore,
    });
    const contextCompactionSummaryRoot = path.join(options.userDataPath, CONTEXT_COMPACTION_SUMMARY_DIRECTORY);
    fs.mkdirSync(contextCompactionSummaryRoot, { recursive: true, mode: 0o700 });
    contextCompactionSummaryStore = createBuilderContextCompactionSummaryStore(
      path.join(contextCompactionSummaryRoot, CONTEXT_COMPACTION_SUMMARY_DATABASE),
    );
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
    const conversationService = createBuilderConversationMainService({
      metadataAuthority: projectMainAuthority.metadata_authority,
      createUuid: randomUUID,
      nowMs: () => Date.now(),
      onTaskStreamChanged: publishTaskStreamChanged,
      workingContextStateService,
      providerContextDisclosureStatusService,
    });
    const sourceContextCollector = createBuilderToolSourceContextCollector({
      conversation_service: conversationService,
      permission_admission: permissionAdmission,
      project_workspace_authority: projectMainAuthority.project_workspace_authority,
      create_uuid: randomUUID,
      now_ms: () => Date.now(),
    });
    service = createBuilderGenerationMainService({
      providerConfigRepository: lazyProviderConfigRepository,
      projectReadAuthority: projectMainAuthority.project_read_authority,
      projectIdentityAuthority: projectMainAuthority.metadata_authority,
      conversationService,
      gitAuthority: projectMainAuthority.git_authority,
      sourceContextCollector,
      taskCapsuleStore,
      taskCapsuleRecordingService,
      sessionTaskAddressRecordingService,
      sessionTaskAddressBindingService,
      workingContextStateService,
      providerContextDisclosureDecisionService,
      providerContextDisclosureStatusService,
      transport: createBuilderOpenAICompatibleTransport({ fetchImpl: options.fetchImpl }),
      onGenerationStarted(event) {
        const started = generationStartedEvent(event);
        if (
          selectedProjectId === null
          && activeAnswerRequests.has(started.request_id)
          && selectedConversationProjectId === null
        ) {
          selectedConversationProjectId = started.project_id;
        }
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
      conversationService,
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
    }

    function trackedGenerationOperation(rawRequest, method, queuedMethod = null) {
      if (selectionPending) fail();
      const instructionRequest = publicInstructionRequest(rawRequest);
      if (instructionRequest.queued_followup !== null && typeof queuedMethod !== 'function') fail();
      const request = createBuilderGenerationRequest({
        instruction: instructionRequest.instruction,
        existing_project_id: selectedProjectId,
      });
      const requestId = request.request_digest;
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
        throw error;
      }
      return operation.finally(() => {
        const remaining = (activeRequests.get(requestId) ?? 1) - 1;
        if (remaining === 0) activeRequests.delete(requestId);
        else activeRequests.set(requestId, remaining);
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
      });
      const requestId = request.request_digest;
      const admission = await service.prepare_draft_continuation({
        draft_id: continuationRequest.draft_id,
      });
      if (
        !isPlainObject(admission)
        || Object.getOwnPropertyDescriptor(admission, 'project_id')?.value !== projectId
      ) fail();
      activeRequests.set(requestId, (activeRequests.get(requestId) ?? 0) + 1);
      try {
        return await service.generate_draft_continuation({
          draft_id: continuationRequest.draft_id,
          instruction: request.instruction,
        });
      } finally {
        const remaining = (activeRequests.get(requestId) ?? 1) - 1;
        if (remaining === 0) activeRequests.delete(requestId);
        else activeRequests.set(requestId, remaining);
      }
    }

    async function trackedGenerateApprovedPlan(rawRequest) {
      if (selectionPending) fail();
      const request = approvedPlanGenerationRequest(rawRequest);
      if (selectedProjectId !== request.project_id) fail();
      await assertSelectedProjectWriteAllowed(request.project_id);
      return service.generate_approved_plan(request);
    }

    async function trackedProposePlan(rawRequest) {
      if (selectionPending || selectedProjectId === null) failGenerationBaseUnavailable();
      const projectId = selectedProjectId;
      const request = createBuilderGenerationRequest({
        instruction: publicInstruction(rawRequest),
        existing_project_id: projectId,
      });
      const requestId = request.request_digest;
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

    async function planSourceReadApprovalStatus(rawRequest) {
      const projectId = planSourceReadApprovalProjectId(rawRequest);
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
      const projectId = planSourceReadApprovalProjectId(rawRequest);
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
      const projectId = planSourceReadApprovalProjectId(rawRequest);
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
      return Object.freeze({
        result_version: 'builder-current-project-write-approval-status.v1',
        project_id: projectId,
        state: decision.decision === 'allowed' ? 'ready' : 'approval_required',
        approval_scope: 'current_project_write',
        authority: 'main_selected_project_project_edit_v1',
      });
    }

    async function approveCurrentProjectWrite(rawRequest) {
      const projectId = planSourceReadApprovalProjectId(rawRequest);
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

    function trackedAnswer(rawRequest) {
      if (selectionPending) fail();
      const instructionRequest = publicInstructionRequest(rawRequest);
      const request = createBuilderGenerationRequest({
        instruction: instructionRequest.instruction,
        existing_project_id: selectedProjectId ?? selectedConversationProjectId,
      });
      const requestId = request.request_digest;
      activeRequests.set(requestId, (activeRequests.get(requestId) ?? 0) + 1);
      activeAnswerRequests.add(requestId);
      let operation;
      try {
        operation = Promise.resolve(instructionRequest.queued_followup === null
          ? Reflect.apply(service.answer, service, [request])
          : Reflect.apply(service.answer_queued_followup, service, [{
            request,
            queued_followup: instructionRequest.queued_followup,
          }]));
      } catch (error) {
        const remaining = (activeRequests.get(requestId) ?? 1) - 1;
        if (remaining === 0) activeRequests.delete(requestId);
        else activeRequests.set(requestId, remaining);
        activeAnswerRequests.delete(requestId);
        throw error;
      }
      return operation.then((result) => {
        if (
          selectedProjectId === null
          && result !== null
          && typeof result === 'object'
          && Object.getPrototypeOf(result) === Object.prototype
        ) {
          const projectId = Object.getOwnPropertyDescriptor(result, 'project_id');
          if (
            projectId
            && Object.hasOwn(projectId, 'value')
            && typeof projectId.value === 'string'
            && PROJECT_ID_PATTERN.test(projectId.value)
          ) {
            selectedConversationProjectId = projectId.value;
          }
        }
        return result;
      }).finally(() => {
        const remaining = (activeRequests.get(requestId) ?? 1) - 1;
        if (remaining === 0) activeRequests.delete(requestId);
        else activeRequests.set(requestId, remaining);
        activeAnswerRequests.delete(requestId);
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
      retry: trackedRetryGenerate,
      answer: trackedAnswer,
      answerDraft: trackedAnswerDraft,
      restoreDraft: service.restore_draft,
      restoreRevisionAsDraft: trackedRestoreRevisionAsDraft,
      rejectDraft: service.reject_draft,
      cancel: service.cancel,
      steer: service.steer,
      queueFollowup: service.queue_followup,
      availability: service.availability,
      mainWindowRef: options.mainWindowRef,
    });
    async function openProject(rawRequest) {
      const projectId = openProjectId(rawRequest);
      const operationEpoch = ++selectionEpoch;
      selectionPending = projectId !== null;
      selectedProjectId = null;
      selectedConversationProjectId = null;
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
      selectedConversationProjectId = request.project_id;
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
        selectedConversationProjectId = request.project_id;
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
        selectedConversationProjectId = null;
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
      const result = await saveAuthority.save(rawRequest);
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
      listCurrent: () => projectMainAuthority.project_read_authority.list_current({ limit: 256 }),
      listWorkspaces: async () => workspaceCatalogFromMetadata(
        await projectMainAuthority.metadata_authority.list_project_workspaces({ limit: 256 }),
      ),
      listHistory: projectMainAuthority.project_read_authority.list_history,
      mainWindowRef: options.mainWindowRef,
    });
    taskStreamAdapter = createBuilderTaskStreamIpcAdapter({
      readStream: conversationService.read_stream,
      mainWindowRef: options.mainWindowRef,
    });
    planReviewAdapter = createBuilderPlanReviewIpcAdapter({
      reviewPlan: conversationService.review_plan,
      mainWindowRef: options.mainWindowRef,
    });
    activeRequestIds = () => Object.freeze([...activeRequests.keys()]);
  } catch {
    try { handoffPacketStore?.close(); } catch { /* fixed failure below */ }
    try { contextCompactionSummaryStore?.close(); } catch { /* fixed failure below */ }
    try { sessionTaskAddressStore?.close(); } catch { /* fixed failure below */ }
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
    Object.freeze({ channel: RETRY_GENERATE_CHANNEL, invoke: adapter.channels.retry.invoke }),
    Object.freeze({ channel: ANSWER_CHANNEL, invoke: adapter.channels.answer.invoke }),
    Object.freeze({ channel: ANSWER_DRAFT_CHANNEL, invoke: adapter.channels.answerDraft.invoke }),
    Object.freeze({ channel: RESTORE_DRAFT_CHANNEL, invoke: adapter.channels.restoreDraft.invoke }),
    Object.freeze({
      channel: RESTORE_REVISION_AS_DRAFT_CHANNEL,
      invoke: adapter.channels.restoreRevisionAsDraft.invoke,
    }),
    Object.freeze({ channel: REJECT_DRAFT_CHANNEL, invoke: adapter.channels.rejectDraft.invoke }),
    Object.freeze({ channel: CANCEL_CHANNEL, invoke: adapter.channels.cancel.invoke }),
    Object.freeze({ channel: STEER_CHANNEL, invoke: adapter.channels.steer.invoke }),
    Object.freeze({ channel: QUEUE_FOLLOWUP_CHANNEL, invoke: adapter.channels.queueFollowup.invoke }),
    Object.freeze({ channel: AVAILABILITY_CHANNEL, invoke: adapter.channels.availability.invoke }),
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

  function cancelActiveRequests() {
    let failed = false;
    for (const requestId of activeRequestIds()) {
      try {
        const result = Reflect.apply(service.cancel, undefined, [{ request_id: requestId }]);
        if (result?.cancelled !== true) failed = true;
      } catch {
        failed = true;
      }
    }
    return failed === false;
  }

  function closeProjectMainAuthority() {
    if (projectMainAuthority === null) return true;
    try {
      projectMainAuthority.close();
      projectMainAuthority = null;
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
        const addressesClosed = compactionsClosed ? closeSessionTaskAddressStore() : false;
        const taskCapsulesClosed = addressesClosed ? closeTaskCapsuleStore() : false;
        const permissionsClosed = taskCapsulesClosed ? closePermissionFactStore() : false;
        const closed = permissionsClosed ? closeProjectMainAuthority() : false;
        state = removed && handoffsClosed && compactionsClosed && addressesClosed
          && taskCapsulesClosed && permissionsClosed && closed
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
        const addressesClosed = compactionsClosed ? closeSessionTaskAddressStore() : false;
        const taskCapsulesClosed = addressesClosed ? closeTaskCapsuleStore() : false;
        const permissionsClosed = taskCapsulesClosed ? closePermissionFactStore() : false;
        const closed = permissionsClosed ? closeProjectMainAuthority() : false;
        if (!handoffsClosed || !compactionsClosed || !addressesClosed
          || !taskCapsulesClosed || !permissionsClosed || !closed) {
          state = 'cleanup_required';
          fail();
        }
        state = 'disposed';
        return false;
      }
      const cancelled = cancelActiveRequests();
      const removed = removeInstalledHandlers();
      const handoffsClosed = cancelled ? closeHandoffPacketStore() : false;
      const compactionsClosed = handoffsClosed ? closeContextCompactionSummaryStore() : false;
      const addressesClosed = compactionsClosed ? closeSessionTaskAddressStore() : false;
      const taskCapsulesClosed = addressesClosed ? closeTaskCapsuleStore() : false;
      const permissionsClosed = taskCapsulesClosed ? closePermissionFactStore() : false;
      const closed = permissionsClosed ? closeProjectMainAuthority() : false;
      if (!cancelled || !removed || !handoffsClosed || !compactionsClosed || !addressesClosed
        || !taskCapsulesClosed || !permissionsClosed || !closed) {
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
  CONTEXT_COMPACTION_SUMMARY_DIRECTORY,
  CONTEXT_COMPACTION_SUMMARY_DATABASE,
  HANDOFF_PACKET_DIRECTORY,
  HANDOFF_PACKET_DATABASE,
  BuilderGenerationIpcRuntimeError,
  ANSWER_DRAFT_CHANNEL,
  createBuilderGenerationIpcRuntime,
});
