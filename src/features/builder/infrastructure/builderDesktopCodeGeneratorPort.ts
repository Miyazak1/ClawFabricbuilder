import {
  BUILDER_GENERATION_DIAGNOSTIC_RETRYABILITY,
  BuilderGenerationDiagnosticError,
  type BuilderCodeGeneratorPort,
  type BuilderCommandApprovalRequest,
  type BuilderCommandOutputEvent,
  type BuilderGenerationActivityKind,
  type BuilderGenerationOutputEvent,
  type BuilderManualContextCompactionResult,
  type BuilderGenerationStartedEvent,
  type BuilderGenerationDiagnosticCode as ApplicationBuilderGenerationDiagnosticCode,
  type BuilderSemanticRouteClassification,
} from '../application/builderPorts';
import {
  sanitizeBuilderQueuedFollowupReference,
  type BuilderQueuedFollowupReference,
} from '../application/builderGeneration';

export const BuilderDesktopCodeGeneratorPortError = BuilderGenerationDiagnosticError;
export type BuilderGenerationDiagnosticCode = ApplicationBuilderGenerationDiagnosticCode;

type BuilderCodeGeneratorBridge = Readonly<{
  classifyIntent?(request: unknown): Promise<unknown>;
  submit(request: unknown): Promise<unknown>;
  generate(request: unknown): Promise<unknown>;
  continueDraft(request: unknown): Promise<unknown>;
  generateApprovedPlan(request: unknown): Promise<unknown>;
  proposePlan(request: unknown): Promise<unknown>;
  preparePlanSourceReadApproval(request: unknown): Promise<unknown>;
  approvePlanSourceRead(request: unknown): Promise<unknown>;
  prepareCurrentProjectWriteApproval(request: unknown): Promise<unknown>;
  approveCurrentProjectWrite(request: unknown): Promise<unknown>;
  retry(request: unknown): Promise<unknown>;
  resumeInterruptedRun?(request: unknown): Promise<unknown>;
  manualCompactContext?(request: unknown): Promise<unknown>;
  answer(request: unknown): Promise<unknown>;
  answerPlan(request: unknown): Promise<unknown>;
  answerDraft(request: unknown): Promise<unknown>;
  restoreDraft(request: unknown): Promise<unknown>;
  restoreRevisionAsDraft(request: unknown): Promise<unknown>;
  restorePreviousCheckpointAsDraft(request: unknown): Promise<unknown>;
  rejectDraft(request: unknown): Promise<unknown>;
  cancel(request: unknown): Promise<unknown>;
  steer(request: unknown): Promise<unknown>;
  queueFollowup(request: unknown): Promise<unknown>;
  availability(): Promise<unknown>;
  subscribeStarted(listener: (event: unknown) => void): () => void;
  subscribeOutput(listener: (event: unknown) => void): () => void;
  decideCommandApproval?(request: unknown): Promise<unknown>;
  subscribeCommandApproval?(listener: (event: unknown) => void): () => void;
  subscribeCommandOutput?(listener: (event: unknown) => void): () => void;
}>;

const REQUIRED_BRIDGE_KEYS = new Set([
  'submit',
  'generate',
  'continueDraft',
  'generateApprovedPlan',
  'proposePlan',
  'preparePlanSourceReadApproval',
  'approvePlanSourceRead',
  'prepareCurrentProjectWriteApproval',
  'approveCurrentProjectWrite',
  'retry',
  'answer',
  'answerPlan',
  'answerDraft',
  'restoreDraft',
  'restoreRevisionAsDraft',
  'restorePreviousCheckpointAsDraft',
  'rejectDraft',
  'cancel',
  'steer',
  'queueFollowup',
  'availability',
  'subscribeStarted',
  'subscribeOutput',
]);
const BRIDGE_KEYS = new Set([
  ...REQUIRED_BRIDGE_KEYS,
  'resumeInterruptedRun',
  'manualCompactContext',
  'classifyIntent',
  'decideCommandApproval',
  'subscribeCommandApproval',
  'subscribeCommandOutput',
]);
const MAX_DATA_GRAPH_NODES = 20_000;
const MAX_DATA_GRAPH_ENTRIES = 20_000;
const MAX_DATA_GRAPH_UTF8_BYTES = 1024 * 1024;
const MAX_DATA_GRAPH_DEPTH = 64;
const UTF8_ENCODER = new TextEncoder();

const GENERATE_RESULT_VERSION = 'builder-generation-ipc-result.v1';
const GENERATION_STARTED_EVENT_VERSION = 'builder-generation-started.v1';
const GENERATION_OUTPUT_EVENT_VERSION = 'builder-generation-output.v1';
const GENERATION_ACTIVITY_EVENT_VERSION = 'builder-generation-activity.v2';
const GENERATION_OUTPUT_RESET_EVENT_VERSION = 'builder-generation-output-reset.v1';
const FAILURE_CODES = new Set<BuilderGenerationDiagnosticCode>(
  Object.keys(BUILDER_GENERATION_DIAGNOSTIC_RETRYABILITY) as BuilderGenerationDiagnosticCode[],
);
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const PROJECT_ID_PATTERN =
  /^builder-project:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const TASK_ADDRESS_ID_PATTERN =
  /^builder-task-address:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CONVERSATION_ID_PATTERN =
  /^builder-conversation:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const AGENT_CONVERSATION_ID_PATTERN =
  /^builder-agent-conversation:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const TURN_ID_PATTERN =
  /^builder-turn:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const TASK_ID_PATTERN =
  /^builder-task:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const RUN_ID_PATTERN =
  /^builder-run:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MESSAGE_ID_PATTERN =
  /^builder-message:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const ADMISSION_ID_PATTERN = /^builder-context-compaction-admission:[0-9a-f]{64}$/u;
const COMPACTION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,239}$/u;
const MAX_DISPLAY_DELTA_TEXT_BYTES = 16 * 1024;
const COMMAND_APPROVAL_REQUEST_ID_PATTERN =
  /^builder-controlled-command-approval-request:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const COMMAND_PROFILE_ID_PATTERN = /^builder-command-profile:[0-9a-f]{32}$/u;

function portError(
  code: BuilderGenerationDiagnosticCode = 'builder_generation_failed',
): BuilderGenerationDiagnosticError {
  return new BuilderGenerationDiagnosticError(code);
}

function accountUtf8(value: string, state: { utf8Bytes: number }): void {
  if (value.length > MAX_DATA_GRAPH_UTF8_BYTES - state.utf8Bytes) throw portError();
  state.utf8Bytes += UTF8_ENCODER.encode(value).byteLength;
  if (state.utf8Bytes > MAX_DATA_GRAPH_UTF8_BYTES) throw portError();
}

function assertPlainDataGraph(
  value: unknown,
  state: { entries: number; nodes: number; seen: WeakSet<object>; utf8Bytes: number },
  depth = 0,
): void {
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'string') {
    accountUtf8(value, state);
    return;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (
    typeof value !== 'object'
    || state.seen.has(value)
    || depth > MAX_DATA_GRAPH_DEPTH
    || state.nodes >= MAX_DATA_GRAPH_NODES
  ) throw portError();
  state.nodes += 1;
  state.seen.add(value);

  const isArray = Array.isArray(value);
  if (isArray && value.length > MAX_DATA_GRAPH_ENTRIES - state.entries) throw portError();
  const prototype = Object.getPrototypeOf(value);
  if (
    (isArray && prototype !== Array.prototype)
    || (!isArray && prototype !== Object.prototype && prototype !== null)
  ) throw portError();
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== 'string')) throw portError();
  const entryCount = keys.length - (isArray ? 1 : 0);
  if (entryCount > MAX_DATA_GRAPH_ENTRIES - state.entries) throw portError();
  for (const key of keys) accountUtf8(key as string, state);
  state.entries += entryCount;

  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== keys.length) throw portError();
  if (isArray) {
    if (keys.length !== value.length + 1 || !Object.hasOwn(descriptors, 'length')) throw portError();
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(descriptors, String(index))) throw portError();
    }
  }
  for (const key of keys) {
    const descriptor = descriptors[key as string];
    if (!descriptor || 'get' in descriptor || 'set' in descriptor) throw portError();
    if (isArray && key === 'length') continue;
    if (!descriptor.enumerable || (isArray && !/^(?:0|[1-9][0-9]*)$/.test(key as string))) {
      throw portError();
    }
    assertPlainDataGraph(descriptor.value, state, depth + 1);
  }
}

function deepFreeze<T>(value: T, depth = 0): T {
  if (depth > MAX_DATA_GRAPH_DEPTH) throw portError();
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      deepFreeze(nested, depth + 1);
    }
    Object.freeze(value);
  }
  return value;
}

function clonePlainData(value: unknown): unknown {
  try {
    assertPlainDataGraph(value, {
      entries: 0,
      nodes: 0,
      seen: new WeakSet<object>(),
      utf8Bytes: 0,
    });
    const cloned = structuredClone(value);
    assertPlainDataGraph(cloned, {
      entries: 0,
      nodes: 0,
      seen: new WeakSet<object>(),
      utf8Bytes: 0,
    });
    return deepFreeze(cloned);
  } catch {
    throw portError();
  }
}

function sanitizeBridge(value: unknown): BuilderCodeGeneratorBridge {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw portError();
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw portError();
    const keys = Reflect.ownKeys(value);
    if (
      keys.length < REQUIRED_BRIDGE_KEYS.size
      || keys.length > BRIDGE_KEYS.size
      || keys.some((key) => typeof key !== 'string' || !BRIDGE_KEYS.has(key))
      || [...REQUIRED_BRIDGE_KEYS].some((key) => !keys.includes(key))
    ) {
      throw portError();
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const methods = {} as Record<string, (...args: unknown[]) => unknown>;
    for (const key of REQUIRED_BRIDGE_KEYS) {
      const descriptor = descriptors[key];
      if (
        !descriptor
        || !descriptor.enumerable
        || 'get' in descriptor
        || 'set' in descriptor
        || typeof descriptor.value !== 'function'
      ) throw portError();
      methods[key] = descriptor.value as (...args: unknown[]) => unknown;
    }
    for (const key of [...BRIDGE_KEYS].filter((candidate) => !REQUIRED_BRIDGE_KEYS.has(candidate))) {
      const descriptor = descriptors[key];
      if (descriptor === undefined) continue;
      if (
        !descriptor.enumerable
        || 'get' in descriptor
        || 'set' in descriptor
        || typeof descriptor.value !== 'function'
      ) throw portError();
      methods[key] = descriptor.value as (...args: unknown[]) => unknown;
    }
    return Object.freeze({
      ...(methods.resumeInterruptedRun === undefined ? {} : {
        resumeInterruptedRun:
          methods.resumeInterruptedRun as NonNullable<BuilderCodeGeneratorBridge['resumeInterruptedRun']>,
      }),
      ...(methods.manualCompactContext === undefined ? {} : {
        manualCompactContext:
          methods.manualCompactContext as NonNullable<BuilderCodeGeneratorBridge['manualCompactContext']>,
      }),
      ...(methods.classifyIntent === undefined ? {} : {
        classifyIntent: methods.classifyIntent as NonNullable<BuilderCodeGeneratorBridge['classifyIntent']>,
      }),
      ...(methods.decideCommandApproval === undefined ? {} : {
        decideCommandApproval:
          methods.decideCommandApproval as NonNullable<BuilderCodeGeneratorBridge['decideCommandApproval']>,
      }),
      ...(methods.subscribeCommandApproval === undefined ? {} : {
        subscribeCommandApproval:
          methods.subscribeCommandApproval as NonNullable<BuilderCodeGeneratorBridge['subscribeCommandApproval']>,
      }),
      ...(methods.subscribeCommandOutput === undefined ? {} : {
        subscribeCommandOutput:
          methods.subscribeCommandOutput as NonNullable<BuilderCodeGeneratorBridge['subscribeCommandOutput']>,
      }),
      submit: methods.submit as BuilderCodeGeneratorBridge['submit'],
      generate: methods.generate as BuilderCodeGeneratorBridge['generate'],
      continueDraft: methods.continueDraft as BuilderCodeGeneratorBridge['continueDraft'],
      generateApprovedPlan: methods.generateApprovedPlan as BuilderCodeGeneratorBridge['generateApprovedPlan'],
      proposePlan: methods.proposePlan as BuilderCodeGeneratorBridge['proposePlan'],
      preparePlanSourceReadApproval:
        methods.preparePlanSourceReadApproval as BuilderCodeGeneratorBridge['preparePlanSourceReadApproval'],
      approvePlanSourceRead:
        methods.approvePlanSourceRead as BuilderCodeGeneratorBridge['approvePlanSourceRead'],
      prepareCurrentProjectWriteApproval:
        methods.prepareCurrentProjectWriteApproval as BuilderCodeGeneratorBridge['prepareCurrentProjectWriteApproval'],
      approveCurrentProjectWrite:
        methods.approveCurrentProjectWrite as BuilderCodeGeneratorBridge['approveCurrentProjectWrite'],
      retry: methods.retry as BuilderCodeGeneratorBridge['retry'],
      answer: methods.answer as BuilderCodeGeneratorBridge['answer'],
      answerPlan: methods.answerPlan as BuilderCodeGeneratorBridge['answerPlan'],
      answerDraft: methods.answerDraft as BuilderCodeGeneratorBridge['answerDraft'],
      restoreDraft: methods.restoreDraft as BuilderCodeGeneratorBridge['restoreDraft'],
      restoreRevisionAsDraft:
        methods.restoreRevisionAsDraft as BuilderCodeGeneratorBridge['restoreRevisionAsDraft'],
      restorePreviousCheckpointAsDraft:
        methods.restorePreviousCheckpointAsDraft as BuilderCodeGeneratorBridge['restorePreviousCheckpointAsDraft'],
      rejectDraft: methods.rejectDraft as BuilderCodeGeneratorBridge['rejectDraft'],
      cancel: methods.cancel as BuilderCodeGeneratorBridge['cancel'],
      steer: methods.steer as BuilderCodeGeneratorBridge['steer'],
      queueFollowup: methods.queueFollowup as BuilderCodeGeneratorBridge['queueFollowup'],
      availability: methods.availability as BuilderCodeGeneratorBridge['availability'],
      subscribeStarted: methods.subscribeStarted as BuilderCodeGeneratorBridge['subscribeStarted'],
      subscribeOutput: methods.subscribeOutput as BuilderCodeGeneratorBridge['subscribeOutput'],
    });
  } catch {
    throw portError();
  }
}

async function callBridge(
  receiver: BuilderCodeGeneratorBridge,
  method: (...args: unknown[]) => unknown,
  args: unknown[],
): Promise<unknown> {
  try {
    const clonedArgs = args.map((argument) => clonePlainData(argument));
    return clonePlainData(await Reflect.apply(method, receiver, clonedArgs));
  } catch {
    throw portError();
  }
}

function exactDataRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw portError();
  const actual = Reflect.ownKeys(value);
  if (actual.length !== keys.length || actual.some((key) => typeof key !== 'string' || !keys.includes(key))) {
    throw portError();
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || !descriptor.enumerable || 'get' in descriptor || 'set' in descriptor) throw portError();
  }
  return value as Record<string, unknown>;
}

function unwrapGenerationEnvelope(value: unknown): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw portError();
  const okDescriptor = Object.getOwnPropertyDescriptor(value, 'ok');
  if (!okDescriptor || !okDescriptor.enumerable || 'get' in okDescriptor || 'set' in okDescriptor) throw portError();
  if (okDescriptor.value === true) {
    const success = exactDataRecord(value, ['version', 'ok', 'result']);
    if (success.version !== GENERATE_RESULT_VERSION) throw portError();
    return success.result;
  }
  if (okDescriptor.value !== false) throw portError();
  const failure = exactDataRecord(value, ['version', 'ok', 'error']);
  if (failure.version !== GENERATE_RESULT_VERSION) throw portError();
  const error = exactDataRecord(failure.error, ['code', 'retryable']);
  if (typeof error.code !== 'string' || !FAILURE_CODES.has(error.code as BuilderGenerationDiagnosticCode)) {
    throw portError();
  }
  const code = error.code as BuilderGenerationDiagnosticCode;
  if (error.retryable !== BUILDER_GENERATION_DIAGNOSTIC_RETRYABILITY[code]) throw portError();
  throw portError(code);
}

function safeProjectId(value: unknown): string {
  if (typeof value !== 'string' || !PROJECT_ID_PATTERN.test(value)) throw portError();
  return value;
}

function safeConversationId(value: unknown): string {
  if (typeof value !== 'string' || !CONVERSATION_ID_PATTERN.test(value)) throw portError();
  return value;
}

function safeTaskAddressId(value: unknown): string {
  if (typeof value !== 'string' || !TASK_ADDRESS_ID_PATTERN.test(value)) throw portError();
  return value;
}

function safeDigest(value: unknown): string {
  if (typeof value !== 'string' || !DIGEST_PATTERN.test(value)) throw portError();
  return value;
}

function safeDraftId(value: unknown): string {
  if (typeof value !== 'string' || !/^builder-generation-draft:[0-9a-f]{64}$/u.test(value)) {
    throw portError();
  }
  return value;
}

const MAX_PLAN_SOURCE_READ_APPROVAL_FILE_COUNT = 10_000;

function safePlanSourceReadFileCount(value: unknown): number {
  if (
    typeof value !== 'number'
    || !Number.isSafeInteger(value)
    || value < 0
    || value > MAX_PLAN_SOURCE_READ_APPROVAL_FILE_COUNT
  ) {
    throw portError();
  }
  return value;
}

function unwrapPlanSourceReadApprovalStatus(
  value: unknown,
  expectedProjectId: string,
): Awaited<ReturnType<BuilderCodeGeneratorPort['preparePlanSourceReadApproval']>> {
  const result = exactDataRecord(value, [
    'result_version',
    'project_id',
    'state',
    'file_count',
    'approval_scope',
    'authority',
  ]);
  if (
    result.result_version !== 'builder-plan-source-read-approval-status.v1'
    || result.project_id !== expectedProjectId
    || (result.state !== 'ready' && result.state !== 'approval_required')
    || result.approval_scope !== 'current_project_plan_source_read'
    || result.authority !== 'main_selected_project_bounded_filesystem_read_v1'
  ) throw portError();
  return Object.freeze({
    result_version: 'builder-plan-source-read-approval-status.v1',
    project_id: safeProjectId(result.project_id),
    state: result.state,
    file_count: safePlanSourceReadFileCount(result.file_count),
    approval_scope: 'current_project_plan_source_read',
    authority: 'main_selected_project_bounded_filesystem_read_v1',
  });
}

function unwrapPlanSourceReadApprovalResult(
  value: unknown,
  expectedProjectId: string,
): Awaited<ReturnType<BuilderCodeGeneratorPort['approvePlanSourceRead']>> {
  const result = exactDataRecord(value, [
    'result_version',
    'project_id',
    'operation',
    'file_count',
    'approval_scope',
    'authority',
  ]);
  if (
    result.result_version !== 'builder-plan-source-read-approval-result.v1'
    || result.project_id !== expectedProjectId
    || (result.operation !== 'approval_recorded' && result.operation !== 'already_approved')
    || result.approval_scope !== 'current_project_plan_source_read'
    || result.authority !== 'main_selected_project_bounded_filesystem_read_v1'
  ) throw portError();
  return Object.freeze({
    result_version: 'builder-plan-source-read-approval-result.v1',
    project_id: safeProjectId(result.project_id),
    operation: result.operation,
    file_count: safePlanSourceReadFileCount(result.file_count),
    approval_scope: 'current_project_plan_source_read',
    authority: 'main_selected_project_bounded_filesystem_read_v1',
  });
}

function unwrapCurrentProjectWriteApprovalStatus(
  value: unknown,
  expectedProjectId: string,
): Awaited<ReturnType<BuilderCodeGeneratorPort['prepareCurrentProjectWriteApproval']>> {
  const result = exactDataRecord(value, [
    'result_version',
    'project_id',
    'state',
    'approval_scope',
    'authority',
  ]);
  if (
    result.result_version !== 'builder-current-project-write-approval-status.v1'
    || result.project_id !== expectedProjectId
    || (result.state !== 'ready' && result.state !== 'approval_required')
    || result.approval_scope !== 'current_project_write'
    || result.authority !== 'main_selected_project_project_edit_v1'
  ) throw portError();
  return Object.freeze({
    result_version: 'builder-current-project-write-approval-status.v1',
    project_id: safeProjectId(result.project_id),
    state: result.state,
    approval_scope: 'current_project_write',
    authority: 'main_selected_project_project_edit_v1',
  });
}

function unwrapCurrentProjectWriteApprovalResult(
  value: unknown,
  expectedProjectId: string,
): Awaited<ReturnType<BuilderCodeGeneratorPort['approveCurrentProjectWrite']>> {
  const result = exactDataRecord(value, [
    'result_version',
    'project_id',
    'operation',
    'approval_scope',
    'authority',
  ]);
  if (
    result.result_version !== 'builder-current-project-write-approval-result.v1'
    || result.project_id !== expectedProjectId
    || (result.operation !== 'approval_recorded' && result.operation !== 'already_approved')
    || result.approval_scope !== 'current_project_write'
    || result.authority !== 'main_selected_project_project_edit_v1'
  ) throw portError();
  return Object.freeze({
    result_version: 'builder-current-project-write-approval-result.v1',
    project_id: safeProjectId(result.project_id),
    operation: result.operation,
    approval_scope: 'current_project_write',
    authority: 'main_selected_project_project_edit_v1',
  });
}

function safeNullableSeq(value: unknown): number | null {
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 10_000_000) throw portError();
  return value as number;
}

function safeNullableCount(value: unknown): number | null {
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 1_000_000_000) throw portError();
  return value as number;
}

function safeNullableCompactionId(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !COMPACTION_ID_PATTERN.test(value)) throw portError();
  return value;
}

function unwrapManualContextCompactionResult(value: unknown): BuilderManualContextCompactionResult {
  const result = exactDataRecord(value, [
    'result_version',
    'operation',
    'status',
    'admission_id',
    'conversation_compaction_projection_digest',
    'compaction_id',
    'start_seq',
    'summary_seq',
    'end_seq',
    'shadowed_token_count',
    'authority',
  ]);
  const authority = exactDataRecord(result.authority, [
    'bridge_authority',
    'admission_authority',
    'harness_authority',
    'renderer_authority',
    'ipc_authority',
    'provider_dispatch',
    'tool_dispatch',
    'source_write',
    'sqlite_write',
    'permission_grant_authority',
    'revision_authority',
    'summary_materialization',
  ]);
  const startSeq = safeNullableSeq(result.start_seq);
  const summarySeq = safeNullableSeq(result.summary_seq);
  const endSeq = safeNullableSeq(result.end_seq);
  const shadowedTokenCount = safeNullableCount(result.shadowed_token_count);
  const operation = result.operation;
  const status = result.status;
  if (
    result.result_version !== 'builder-context-compaction-execution-result.v1'
    || !['manual_compaction_completed', 'manual_compaction_noop'].includes(operation as string)
    || !['compaction_completed', 'compaction_not_needed'].includes(status as string)
    || (operation === 'manual_compaction_completed') !== (status === 'compaction_completed')
    || typeof result.admission_id !== 'string'
    || !ADMISSION_ID_PATTERN.test(result.admission_id)
    || typeof result.conversation_compaction_projection_digest !== 'string'
    || !DIGEST_PATTERN.test(result.conversation_compaction_projection_digest)
    || authority.bridge_authority !== 'main_context_compaction_execution_bridge_v1'
    || authority.admission_authority !== 'verified_main_context_compaction_admission_contract_v1'
    || authority.harness_authority !== 'manual_compactNow_invoked_after_admission'
    || authority.renderer_authority !== 'not_present'
    || authority.ipc_authority !== 'not_present'
    || authority.provider_dispatch !== 'harness_owned_compaction_only'
    || authority.tool_dispatch !== 'not_performed_by_bridge'
    || authority.source_write !== 'not_performed_by_bridge'
    || authority.sqlite_write !== 'not_performed_by_bridge'
    || authority.permission_grant_authority !== 'not_present'
    || authority.revision_authority !== 'not_present'
    || authority.summary_materialization !== 'not_performed_by_bridge'
  ) throw portError();
  const compactionId = safeNullableCompactionId(result.compaction_id);
  if (status === 'compaction_completed') {
    if (compactionId === null || startSeq === null || summarySeq === null || endSeq === null
      || shadowedTokenCount === null || !(startSeq < summarySeq && summarySeq < endSeq)) throw portError();
  } else if (compactionId !== null || startSeq !== null || summarySeq !== null
    || endSeq !== null || shadowedTokenCount !== null) throw portError();
  return Object.freeze({
    result_version: 'builder-context-compaction-execution-result.v1',
    operation: operation as BuilderManualContextCompactionResult['operation'],
    status: status as BuilderManualContextCompactionResult['status'],
    admission_id: result.admission_id,
    conversation_compaction_projection_digest: result.conversation_compaction_projection_digest,
    compaction_id: compactionId,
    start_seq: startSeq,
    summary_seq: summarySeq,
    end_seq: endSeq,
    shadowed_token_count: shadowedTokenCount,
    authority: Object.freeze({
      bridge_authority: 'main_context_compaction_execution_bridge_v1',
      admission_authority: 'verified_main_context_compaction_admission_contract_v1',
      harness_authority: 'manual_compactNow_invoked_after_admission',
      renderer_authority: 'not_present',
      ipc_authority: 'not_present',
      provider_dispatch: 'harness_owned_compaction_only',
      tool_dispatch: 'not_performed_by_bridge',
      source_write: 'not_performed_by_bridge',
      sqlite_write: 'not_performed_by_bridge',
      permission_grant_authority: 'not_present',
      revision_authority: 'not_present',
      summary_materialization: 'not_performed_by_bridge',
    }),
  });
}

function unwrapSemanticRouteClassification(
  value: unknown,
): BuilderSemanticRouteClassification {
  const result = exactDataRecord(value, [
    'result_version',
    'request_digest',
    'route',
    'confidence',
    'needs_confirmation',
    'reason_code',
    'matched_signal',
    'authority',
  ]);
  const authority = exactDataRecord(result.authority, [
    'classifier',
    'context_scope',
    'conversation_text',
    'working_brief_text',
    'source_read',
    'source_write',
    'tool_dispatch',
    'command_execution',
    'permission_grant',
    'git_mutation',
    'sqlite_write',
    'save_admission',
  ]);
  const routes = ['answer', 'clarify', 'update_brief', 'plan', 'build'] as const;
  const confidences = ['low', 'medium', 'high'] as const;
  const reasonCodes = [
    'asks_for_information',
    'asks_to_discuss_or_refine',
    'updates_working_direction',
    'requests_plan_or_proposal',
    'requests_source_change',
    'ambiguous_between_plan_and_build',
  ] as const;
  const routesByReason: Readonly<Record<typeof reasonCodes[number], readonly typeof routes[number][]>> = {
    asks_for_information: ['answer'],
    asks_to_discuss_or_refine: ['answer', 'clarify'],
    updates_working_direction: ['update_brief'],
    requests_plan_or_proposal: ['plan'],
    requests_source_change: ['build'],
    ambiguous_between_plan_and_build: ['clarify'],
  };
  const route = result.route as typeof routes[number];
  const confidence = result.confidence as typeof confidences[number];
  const reasonCode = result.reason_code as typeof reasonCodes[number];
  const needsConfirmation = route === 'clarify'
    || confidence === 'low'
    || reasonCode === 'ambiguous_between_plan_and_build';
  if (
    result.result_version !== 'builder-semantic-route-classification.v1'
    || typeof result.request_digest !== 'string'
    || !DIGEST_PATTERN.test(result.request_digest)
    || !routes.includes(route)
    || !confidences.includes(confidence)
    || typeof result.needs_confirmation !== 'boolean'
    || !reasonCodes.includes(reasonCode)
    || !routesByReason[reasonCode].includes(route)
    || result.needs_confirmation !== needsConfirmation
    || result.matched_signal !== 'semantic_route'
    || authority.classifier !== 'main_owned_provider_semantic_route_v1'
    || authority.context_scope !== 'current_instruction_and_bounded_product_state'
    || authority.conversation_text !== 'not_disclosed'
    || authority.working_brief_text !== 'not_disclosed'
    || authority.source_read !== 'not_performed'
    || authority.source_write !== 'not_performed'
    || authority.tool_dispatch !== false
    || authority.command_execution !== false
    || authority.permission_grant !== false
    || authority.git_mutation !== false
    || authority.sqlite_write !== false
    || authority.save_admission !== false
  ) throw portError();
  return deepFreeze(result) as BuilderSemanticRouteClassification;
}

function unwrapCancelResult(value: unknown, expectedRequestId: string): Readonly<{
  request_id: string;
  cancelled: boolean;
}> {
  const result = exactDataRecord(value, ['request_id', 'cancelled']);
  if (
    result.request_id !== expectedRequestId
    || typeof result.request_id !== 'string'
    || !DIGEST_PATTERN.test(result.request_id)
    || typeof result.cancelled !== 'boolean'
  ) throw portError();
  return Object.freeze({
    request_id: result.request_id,
    cancelled: result.cancelled,
  });
}

function unwrapSteerResult(value: unknown, expectedRequestId: string): Readonly<{
  request_id: string;
  steered: boolean;
}> {
  const result = exactDataRecord(value, ['request_id', 'steered']);
  if (
    result.request_id !== expectedRequestId
    || typeof result.request_id !== 'string'
    || !DIGEST_PATTERN.test(result.request_id)
    || typeof result.steered !== 'boolean'
  ) throw portError();
  return Object.freeze({
    request_id: result.request_id,
    steered: result.steered,
  });
}

function unwrapQueuedFollowupResult(value: unknown, expectedRequestId: string): Readonly<{
  request_id: string;
  queued: boolean;
  queued_followup: BuilderQueuedFollowupReference | null;
}> {
  const result = exactDataRecord(value, ['request_id', 'queued', 'queued_followup']);
  if (
    result.request_id !== expectedRequestId
    || typeof result.request_id !== 'string'
    || !DIGEST_PATTERN.test(result.request_id)
    || typeof result.queued !== 'boolean'
  ) throw portError();
  let queuedFollowup: BuilderQueuedFollowupReference | null;
  try {
    queuedFollowup = result.queued_followup === null
      ? null
      : sanitizeBuilderQueuedFollowupReference(result.queued_followup);
  } catch {
    throw portError();
  }
  if (result.queued !== (queuedFollowup !== null)) throw portError();
  return Object.freeze({
    request_id: result.request_id,
    queued: result.queued,
    queued_followup: queuedFollowup,
  });
}

function queuedFollowupPayload(value: BuilderQueuedFollowupReference | null | undefined) {
  if (value === undefined || value === null) return undefined;
  if (
    !TURN_ID_PATTERN.test(value.turn_id)
    || !RUN_ID_PATTERN.test(value.run_id)
    || !MESSAGE_ID_PATTERN.test(value.message_id)
  ) throw portError();
  return Object.freeze({
    turn_id: value.turn_id,
    run_id: value.run_id,
    message_id: value.message_id,
  });
}

function instructionRequestPayload(
  instruction: string,
  taskAddressId: string | null,
  queuedFollowup: BuilderQueuedFollowupReference | null | undefined,
) {
  if (taskAddressId !== null && !TASK_ADDRESS_ID_PATTERN.test(taskAddressId)) throw portError();
  const queued = queuedFollowupPayload(queuedFollowup);
  return queued === undefined
    ? { instruction, task_address_id: taskAddressId }
    : { instruction, task_address_id: taskAddressId, queued_followup: queued };
}

function approvalRequestPayload(projectId: string, taskAddressId: string | null | undefined) {
  if (taskAddressId !== null && taskAddressId !== undefined && !TASK_ADDRESS_ID_PATTERN.test(taskAddressId)) {
    throw portError();
  }
  return taskAddressId === undefined
    ? { project_id: projectId }
    : { project_id: projectId, task_address_id: taskAddressId };
}

function sanitizeStartedEvent(value: unknown): BuilderGenerationStartedEvent {
  const event = exactDataRecord(value, ['event_version', 'request_id', 'project_id']);
  if (
    event.event_version !== GENERATION_STARTED_EVENT_VERSION
    || typeof event.request_id !== 'string'
    || !DIGEST_PATTERN.test(event.request_id)
    || (event.project_id !== null && (
      typeof event.project_id !== 'string'
      || !PROJECT_ID_PATTERN.test(event.project_id)
    ))
  ) throw portError();
  return Object.freeze({
    event_version: GENERATION_STARTED_EVENT_VERSION,
    request_id: event.request_id,
    project_id: event.project_id,
  });
}

function safeDisplayDeltaText(value: unknown): string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > MAX_DISPLAY_DELTA_TEXT_BYTES
    || UTF8_ENCODER.encode(value).byteLength > MAX_DISPLAY_DELTA_TEXT_BYTES
  ) throw portError();
  return value;
}

function safeActivityText(value: unknown): string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > 160
    || value.normalize('NFC') !== value
    || /[\r\n\t\p{Cf}\p{Bidi_Control}]/u.test(value)
    || UTF8_ENCODER.encode(value).byteLength > 640
  ) throw portError();
  return value;
}

function safeActivityKind(value: unknown): BuilderGenerationActivityKind {
  if (typeof value !== 'string' || ![
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
  ].includes(value)) throw portError();
  return value as BuilderGenerationActivityKind;
}

function sanitizeOutputEvent(value: unknown): BuilderGenerationOutputEvent {
  const reset = Object.hasOwn(value as object, 'retain_text_bytes');
  const activity = Object.hasOwn(value as object, 'activity_text');
  const version = exactDataRecord(value, reset
    ? [
      'event_version',
      'request_id',
      'project_id',
      'conversation_id',
      'turn_id',
      'task_id',
      'run_id',
      'retain_text_bytes',
    ]
    : activity ? [
      'event_version',
      'request_id',
      'project_id',
      'conversation_id',
      'turn_id',
      'task_id',
      'run_id',
      'activity_kind',
      'activity_text',
    ] : [
      'event_version',
      'request_id',
      'project_id',
      'conversation_id',
      'turn_id',
      'task_id',
      'run_id',
      'display_delta_text',
    ]);
  const event = version;
  if (
    ![
      GENERATION_OUTPUT_EVENT_VERSION,
      GENERATION_ACTIVITY_EVENT_VERSION,
      GENERATION_OUTPUT_RESET_EVENT_VERSION,
    ].includes(
      event.event_version as string,
    )
    || typeof event.request_id !== 'string'
    || !DIGEST_PATTERN.test(event.request_id)
    || (event.project_id !== null && (
      typeof event.project_id !== 'string'
      || !PROJECT_ID_PATTERN.test(event.project_id)
    ))
    || typeof event.conversation_id !== 'string'
    || !(event.project_id === null
      ? AGENT_CONVERSATION_ID_PATTERN
      : CONVERSATION_ID_PATTERN).test(event.conversation_id)
    || typeof event.turn_id !== 'string'
    || !TURN_ID_PATTERN.test(event.turn_id)
    || (event.task_id !== null && (typeof event.task_id !== 'string' || !TASK_ID_PATTERN.test(event.task_id)))
    || typeof event.run_id !== 'string'
    || !RUN_ID_PATTERN.test(event.run_id)
  ) throw portError();
  const common = {
    request_id: event.request_id,
    project_id: event.project_id,
    conversation_id: event.conversation_id,
    turn_id: event.turn_id,
    task_id: event.task_id,
    run_id: event.run_id,
  };
  if (event.event_version === GENERATION_OUTPUT_RESET_EVENT_VERSION) {
    if (!Number.isSafeInteger(event.retain_text_bytes) || (event.retain_text_bytes as number) < 0) {
      throw portError();
    }
    return Object.freeze({
      event_version: GENERATION_OUTPUT_RESET_EVENT_VERSION,
      ...common,
      retain_text_bytes: event.retain_text_bytes as number,
    });
  }
  if (event.event_version === GENERATION_ACTIVITY_EVENT_VERSION) {
    return Object.freeze({
      event_version: GENERATION_ACTIVITY_EVENT_VERSION,
      ...common,
      activity_kind: safeActivityKind(event.activity_kind),
      activity_text: safeActivityText(event.activity_text),
    });
  }
  return Object.freeze({
    event_version: GENERATION_OUTPUT_EVENT_VERSION,
    ...common,
    display_delta_text: safeDisplayDeltaText(event.display_delta_text),
  });
}

function safeCommandText(value: unknown, maximum = 1_024): string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.trim() !== value
    || value.normalize('NFC') !== value
    || /[\0\p{Cf}\p{Bidi_Control}]/u.test(value)
    || UTF8_ENCODER.encode(value).byteLength > maximum
  ) throw portError();
  return value;
}

function safeCommandOutputText(value: unknown, maximum: number): string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || /[\0\p{Cf}\p{Bidi_Control}]/u.test(value)
    || UTF8_ENCODER.encode(value).byteLength > maximum
  ) throw portError();
  return value;
}

function sanitizeCommandApproval(value: unknown): BuilderCommandApprovalRequest {
  const event = exactDataRecord(value, [
    'request_version', 'approval_request_id', 'project_id', 'conversation_id',
    'turn_id', 'task_id', 'run_id', 'command_profile_id', 'command_kind',
    'command_display', 'description', 'source_tree_digest', 'requested_at_ms',
    'expires_at_ms', 'risk_notice', 'decisions',
  ]);
  if (
    event.request_version !== 'builder-controlled-command-approval-request.v1'
    || typeof event.approval_request_id !== 'string'
    || !COMMAND_APPROVAL_REQUEST_ID_PATTERN.test(event.approval_request_id)
    || typeof event.project_id !== 'string' || !PROJECT_ID_PATTERN.test(event.project_id)
    || typeof event.conversation_id !== 'string' || !CONVERSATION_ID_PATTERN.test(event.conversation_id)
    || typeof event.turn_id !== 'string' || !TURN_ID_PATTERN.test(event.turn_id)
    || typeof event.task_id !== 'string' || !TASK_ID_PATTERN.test(event.task_id)
    || typeof event.run_id !== 'string' || !RUN_ID_PATTERN.test(event.run_id)
    || typeof event.command_profile_id !== 'string' || !COMMAND_PROFILE_ID_PATTERN.test(event.command_profile_id)
    || !['lint', 'typecheck', 'test', 'build'].includes(event.command_kind as string)
    || typeof event.source_tree_digest !== 'string' || !DIGEST_PATTERN.test(event.source_tree_digest)
    || !Number.isSafeInteger(event.requested_at_ms) || !Number.isSafeInteger(event.expires_at_ms)
    || (event.expires_at_ms as number) <= (event.requested_at_ms as number)
    || event.risk_notice !== 'This project script may modify files or use the network.'
    || !Array.isArray(event.decisions)
    || event.decisions.length !== 2
    || event.decisions[0] !== 'allow_once'
    || event.decisions[1] !== 'deny'
  ) throw portError();
  return Object.freeze({
    request_version: 'builder-controlled-command-approval-request.v1',
    approval_request_id: event.approval_request_id,
    project_id: event.project_id,
    conversation_id: event.conversation_id,
    turn_id: event.turn_id,
    task_id: event.task_id,
    run_id: event.run_id,
    command_profile_id: event.command_profile_id,
    command_kind: event.command_kind as BuilderCommandApprovalRequest['command_kind'],
    command_display: safeCommandText(event.command_display, 512),
    description: safeCommandText(event.description, 1_024),
    source_tree_digest: event.source_tree_digest,
    requested_at_ms: event.requested_at_ms as number,
    expires_at_ms: event.expires_at_ms as number,
    risk_notice: 'This project script may modify files or use the network.',
    decisions: ['allow_once', 'deny'] as const,
  });
}

function sanitizeCommandOutput(value: unknown): BuilderCommandOutputEvent {
  const event = exactDataRecord(value, [
    'event_version', 'project_id', 'conversation_id', 'turn_id', 'task_id',
    'run_id', 'command_profile_id', 'chunks',
  ]);
  if (
    event.event_version !== 'builder-controlled-command-output.v1'
    || typeof event.project_id !== 'string' || !PROJECT_ID_PATTERN.test(event.project_id)
    || typeof event.conversation_id !== 'string' || !CONVERSATION_ID_PATTERN.test(event.conversation_id)
    || typeof event.turn_id !== 'string' || !TURN_ID_PATTERN.test(event.turn_id)
    || typeof event.task_id !== 'string' || !TASK_ID_PATTERN.test(event.task_id)
    || typeof event.run_id !== 'string' || !RUN_ID_PATTERN.test(event.run_id)
    || typeof event.command_profile_id !== 'string' || !COMMAND_PROFILE_ID_PATTERN.test(event.command_profile_id)
    || !Array.isArray(event.chunks) || event.chunks.length > 256
  ) throw portError();
  const chunks = event.chunks.map((rawChunk) => {
    const chunk = exactDataRecord(rawChunk, ['stream', 'text']);
    if (!['stdout', 'stderr'].includes(chunk.stream as string)) throw portError();
    return Object.freeze({
      stream: chunk.stream as 'stdout' | 'stderr',
      text: safeCommandOutputText(chunk.text, 64 * 1_024),
    });
  });
  return Object.freeze({
    event_version: 'builder-controlled-command-output.v1',
    project_id: event.project_id,
    conversation_id: event.conversation_id,
    turn_id: event.turn_id,
    task_id: event.task_id,
    run_id: event.run_id,
    command_profile_id: event.command_profile_id,
    chunks,
  });
}

export function createBuilderDesktopCodeGeneratorPort(
  value: unknown,
): BuilderCodeGeneratorPort {
  const bridge = sanitizeBridge(value);
  return Object.freeze({
    ...(bridge.classifyIntent === undefined ? {} : {
      classifyIntent(request: Readonly<{ instruction: string; task_address_id: string | null }>) {
        return callBridge(
          bridge,
          bridge.classifyIntent as NonNullable<BuilderCodeGeneratorBridge['classifyIntent']>,
          [instructionRequestPayload(request.instruction, request.task_address_id, undefined)],
        ).then((result) => unwrapSemanticRouteClassification(unwrapGenerationEnvelope(result)));
      },
    }),
    generate(request: Parameters<BuilderCodeGeneratorPort['generate']>[0]) {
      return callBridge(bridge, bridge.generate, [{
        instruction: request.instruction,
        task_address_id: request.task_address_id,
      }]).then(unwrapGenerationEnvelope);
    },
    continueDraft(request: Parameters<BuilderCodeGeneratorPort['continueDraft']>[0]) {
      const queued = queuedFollowupPayload(request.queued_followup);
      return callBridge(bridge, bridge.continueDraft, [{
        draft_id: safeDraftId(request.draft_id),
        instruction: request.instruction,
        ...(queued === undefined ? {} : { queued_followup: queued }),
      }]).then(unwrapGenerationEnvelope);
    },
    generateApprovedPlan(request: Parameters<BuilderCodeGeneratorPort['generateApprovedPlan']>[0]) {
      return callBridge(bridge, bridge.generateApprovedPlan, [{
        project_id: request.project_id,
        conversation_id: request.conversation_id,
        turn_id: request.turn_id,
        run_id: request.run_id,
      }]).then(unwrapGenerationEnvelope);
    },
    proposePlan(request: Parameters<BuilderCodeGeneratorPort['proposePlan']>[0]) {
      return callBridge(bridge, bridge.proposePlan, [{
        instruction: request.instruction,
        task_address_id: request.task_address_id,
      }]).then(unwrapGenerationEnvelope);
    },
    preparePlanSourceReadApproval(
      request: Parameters<BuilderCodeGeneratorPort['preparePlanSourceReadApproval']>[0],
    ) {
      const projectId = safeProjectId(request.project_id);
      return callBridge(bridge, bridge.preparePlanSourceReadApproval, [approvalRequestPayload(
        projectId,
        request.task_address_id,
      )]).then((result) => unwrapPlanSourceReadApprovalStatus(
        unwrapGenerationEnvelope(result),
        projectId,
      ));
    },
    approvePlanSourceRead(request: Parameters<BuilderCodeGeneratorPort['approvePlanSourceRead']>[0]) {
      const projectId = safeProjectId(request.project_id);
      return callBridge(bridge, bridge.approvePlanSourceRead, [approvalRequestPayload(
        projectId,
        request.task_address_id,
      )]).then((result) => unwrapPlanSourceReadApprovalResult(
        unwrapGenerationEnvelope(result),
        projectId,
      ));
    },
    prepareCurrentProjectWriteApproval(
      request: Parameters<BuilderCodeGeneratorPort['prepareCurrentProjectWriteApproval']>[0],
    ) {
      const projectId = safeProjectId(request.project_id);
      return callBridge(bridge, bridge.prepareCurrentProjectWriteApproval, [approvalRequestPayload(
        projectId,
        request.task_address_id,
      )]).then((result) => unwrapCurrentProjectWriteApprovalStatus(
        unwrapGenerationEnvelope(result),
        projectId,
      ));
    },
    approveCurrentProjectWrite(
      request: Parameters<BuilderCodeGeneratorPort['approveCurrentProjectWrite']>[0],
    ) {
      const projectId = safeProjectId(request.project_id);
      return callBridge(bridge, bridge.approveCurrentProjectWrite, [approvalRequestPayload(
        projectId,
        request.task_address_id,
      )]).then((result) => unwrapCurrentProjectWriteApprovalResult(
        unwrapGenerationEnvelope(result),
        projectId,
      ));
    },
    submit(request: Parameters<BuilderCodeGeneratorPort['submit']>[0]) {
      return callBridge(bridge, bridge.submit, [
        instructionRequestPayload(request.instruction, request.task_address_id, request.queued_followup),
      ]).then(unwrapGenerationEnvelope);
    },
    retry(request: Parameters<BuilderCodeGeneratorPort['retry']>[0]) {
      return callBridge(bridge, bridge.retry, [{
        instruction: request.instruction,
        task_address_id: request.task_address_id,
      }]).then(unwrapGenerationEnvelope);
    },
    resumeInterruptedRun(request: Parameters<NonNullable<BuilderCodeGeneratorPort['resumeInterruptedRun']>>[0]) {
      if (!bridge.resumeInterruptedRun || !TASK_ADDRESS_ID_PATTERN.test(request.task_address_id)
        || !RUN_ID_PATTERN.test(request.run_id)) return Promise.reject(portError());
      return callBridge(
        bridge,
        bridge.resumeInterruptedRun,
        [{ task_address_id: request.task_address_id, run_id: request.run_id }],
      )
        .then(unwrapGenerationEnvelope);
    },
    ...(bridge.manualCompactContext === undefined ? {} : {
      manualCompactContext(request: Parameters<NonNullable<BuilderCodeGeneratorPort['manualCompactContext']>>[0]) {
        const projectId = safeProjectId(request.project_id);
        const conversationId = safeConversationId(request.conversation_id);
        const taskAddressId = safeTaskAddressId(request.task_address_id);
        return callBridge(
          bridge,
          bridge.manualCompactContext as NonNullable<BuilderCodeGeneratorBridge['manualCompactContext']>,
          [{
            project_id: projectId,
            conversation_id: conversationId,
            task_address_id: taskAddressId,
          }],
        ).then((result) => unwrapManualContextCompactionResult(unwrapGenerationEnvelope(result)));
      },
    }),
    answer(request: Parameters<BuilderCodeGeneratorPort['answer']>[0]) {
      return callBridge(bridge, bridge.answer, [
        instructionRequestPayload(request.instruction, request.task_address_id, request.queued_followup),
      ]).then(unwrapGenerationEnvelope);
    },
    answerPlan(request: Parameters<NonNullable<BuilderCodeGeneratorPort['answerPlan']>>[0]) {
      return callBridge(bridge, bridge.answerPlan, [
        instructionRequestPayload(request.instruction, request.task_address_id, request.queued_followup),
      ]).then(unwrapGenerationEnvelope);
    },
    answerDraft(request: Parameters<BuilderCodeGeneratorPort['answerDraft']>[0]) {
      return callBridge(bridge, bridge.answerDraft, [{
        draft_id: safeDraftId(request.draft_id),
        instruction: request.instruction,
      }]).then(unwrapGenerationEnvelope);
    },
    restoreDraft(request: Parameters<BuilderCodeGeneratorPort['restoreDraft']>[0]) {
      return callBridge(bridge, bridge.restoreDraft, [{
        draft_id: request.draft_id,
      }]).then(unwrapGenerationEnvelope);
    },
    restoreRevisionAsDraft(request: Parameters<BuilderCodeGeneratorPort['restoreRevisionAsDraft']>[0]) {
      const projectId = safeProjectId(request.project_id);
      const revisionReceiptDigest = safeDigest(request.revision_receipt_digest);
      return callBridge(bridge, bridge.restoreRevisionAsDraft, [{
        project_id: projectId,
        revision_receipt_digest: revisionReceiptDigest,
      }]).then(unwrapGenerationEnvelope);
    },
    restorePreviousCheckpointAsDraft(
      request: Parameters<NonNullable<BuilderCodeGeneratorPort['restorePreviousCheckpointAsDraft']>>[0],
    ) {
      return callBridge(bridge, bridge.restorePreviousCheckpointAsDraft, [{
        draft_id: safeDraftId(request.draft_id),
      }]).then(unwrapGenerationEnvelope);
    },
    rejectDraft(request: Parameters<BuilderCodeGeneratorPort['rejectDraft']>[0]) {
      return callBridge(bridge, bridge.rejectDraft, [{
        draft_id: request.draft_id,
      }]).then(unwrapGenerationEnvelope);
    },
    cancel(request: Parameters<BuilderCodeGeneratorPort['cancel']>[0]) {
      return callBridge(bridge, bridge.cancel, [{
        request_id: request.request_id,
        ...(request.pause === true ? { pause: true } : {}),
      }]).then((result) => unwrapCancelResult(result, request.request_id));
    },
    steer(request: Parameters<BuilderCodeGeneratorPort['steer']>[0]) {
      return callBridge(bridge, bridge.steer, [{
        request_id: request.request_id,
        message: request.message,
      }]).then((result) => unwrapSteerResult(result, request.request_id));
    },
    queueFollowup(request: Parameters<BuilderCodeGeneratorPort['queueFollowup']>[0]) {
      return callBridge(bridge, bridge.queueFollowup, [{
        request_id: request.request_id,
        message: request.message,
      }]).then((result) => unwrapQueuedFollowupResult(result, request.request_id));
    },
    subscribeStarted(listener: (event: BuilderGenerationStartedEvent) => void) {
      if (typeof listener !== 'function') throw portError();
      let active = true;
      const unsubscribe = bridge.subscribeStarted((event) => {
        if (!active) return;
        let sanitized: BuilderGenerationStartedEvent;
        try {
          sanitized = sanitizeStartedEvent(event);
        } catch {
          return;
        }
        listener(sanitized);
      });
      if (typeof unsubscribe !== 'function') throw portError();
      return () => {
        if (!active) return;
        active = false;
        unsubscribe();
      };
    },
    subscribeOutput(listener: (event: BuilderGenerationOutputEvent) => void) {
      if (typeof listener !== 'function') throw portError();
      let active = true;
      const unsubscribe = bridge.subscribeOutput((event) => {
        if (!active) return;
        let sanitized: BuilderGenerationOutputEvent;
        try {
          sanitized = sanitizeOutputEvent(event);
        } catch {
          return;
        }
        listener(sanitized);
      });
      if (typeof unsubscribe !== 'function') throw portError();
      return () => {
        if (!active) return;
        active = false;
        unsubscribe();
      };
    },
    ...(bridge.decideCommandApproval === undefined ? {} : {
      decideCommandApproval(request: Parameters<NonNullable<BuilderCodeGeneratorPort['decideCommandApproval']>>[0]) {
        return callBridge(bridge, bridge.decideCommandApproval as NonNullable<BuilderCodeGeneratorBridge['decideCommandApproval']>, [request])
          .then((result) => {
            const envelope = unwrapGenerationEnvelope(result);
            const value = exactDataRecord(envelope, ['result_version', 'operation']);
            if (
              value.result_version !== 'builder-controlled-command-approval-decision-result.v1'
              || value.operation !== 'command_approval_decided'
            ) throw portError();
          });
      },
    }),
    ...(bridge.subscribeCommandApproval === undefined ? {} : {
      subscribeCommandApproval(listener: (event: BuilderCommandApprovalRequest) => void) {
        if (typeof listener !== 'function') throw portError();
        return bridge.subscribeCommandApproval!((event) => {
          try { listener(sanitizeCommandApproval(event)); } catch { /* invalid events are ignored */ }
        });
      },
    }),
    ...(bridge.subscribeCommandOutput === undefined ? {} : {
      subscribeCommandOutput(listener: (event: BuilderCommandOutputEvent) => void) {
        if (typeof listener !== 'function') throw portError();
        return bridge.subscribeCommandOutput!((event) => {
          try { listener(sanitizeCommandOutput(event)); } catch { /* invalid events are ignored */ }
        });
      },
    }),
  });
}
