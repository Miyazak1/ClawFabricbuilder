import {
  BUILDER_GENERATION_DIAGNOSTIC_RETRYABILITY,
  BuilderGenerationDiagnosticError,
  type BuilderCodeGeneratorPort,
  type BuilderGenerationOutputEvent,
  type BuilderGenerationStartedEvent,
  type BuilderGenerationDiagnosticCode as ApplicationBuilderGenerationDiagnosticCode,
} from '../application/builderPorts';

export const BuilderDesktopCodeGeneratorPortError = BuilderGenerationDiagnosticError;
export type BuilderGenerationDiagnosticCode = ApplicationBuilderGenerationDiagnosticCode;

type BuilderCodeGeneratorBridge = Readonly<{
  submit(request: unknown): Promise<unknown>;
  generate(request: unknown): Promise<unknown>;
  generateApprovedPlan(request: unknown): Promise<unknown>;
  proposePlan(request: unknown): Promise<unknown>;
  preparePlanSourceReadApproval(request: unknown): Promise<unknown>;
  approvePlanSourceRead(request: unknown): Promise<unknown>;
  retry(request: unknown): Promise<unknown>;
  answer(request: unknown): Promise<unknown>;
  restoreDraft(request: unknown): Promise<unknown>;
  rejectDraft(request: unknown): Promise<unknown>;
  cancel(request: unknown): Promise<unknown>;
  steer(request: unknown): Promise<unknown>;
  availability(): Promise<unknown>;
  subscribeStarted(listener: (event: unknown) => void): () => void;
  subscribeOutput(listener: (event: unknown) => void): () => void;
}>;

const BRIDGE_KEYS = new Set([
  'submit',
  'generate',
  'generateApprovedPlan',
  'proposePlan',
  'preparePlanSourceReadApproval',
  'approvePlanSourceRead',
  'retry',
  'answer',
  'restoreDraft',
  'rejectDraft',
  'cancel',
  'steer',
  'availability',
  'subscribeStarted',
  'subscribeOutput',
]);
const MAX_DATA_GRAPH_NODES = 20_000;
const MAX_DATA_GRAPH_ENTRIES = 20_000;
const MAX_DATA_GRAPH_UTF8_BYTES = 1024 * 1024;
const MAX_DATA_GRAPH_DEPTH = 64;
const UTF8_ENCODER = new TextEncoder();

const GENERATE_RESULT_VERSION = 'builder-generation-ipc-result.v1';
const GENERATION_STARTED_EVENT_VERSION = 'builder-generation-started.v1';
const GENERATION_OUTPUT_EVENT_VERSION = 'builder-generation-output.v1';
const FAILURE_CODES = new Set<BuilderGenerationDiagnosticCode>(
  Object.keys(BUILDER_GENERATION_DIAGNOSTIC_RETRYABILITY) as BuilderGenerationDiagnosticCode[],
);
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const PROJECT_ID_PATTERN =
  /^builder-project:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CONVERSATION_ID_PATTERN =
  /^builder-conversation:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const TURN_ID_PATTERN =
  /^builder-turn:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const TASK_ID_PATTERN =
  /^builder-task:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const RUN_ID_PATTERN =
  /^builder-run:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MAX_DISPLAY_DELTA_TEXT_BYTES = 16 * 1024;

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
    if (keys.length !== BRIDGE_KEYS.size || keys.some((key) => typeof key !== 'string' || !BRIDGE_KEYS.has(key))) {
      throw portError();
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const methods = {} as Record<string, (...args: unknown[]) => unknown>;
    for (const key of BRIDGE_KEYS) {
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
    return Object.freeze({
      submit: methods.submit as BuilderCodeGeneratorBridge['submit'],
      generate: methods.generate as BuilderCodeGeneratorBridge['generate'],
      generateApprovedPlan: methods.generateApprovedPlan as BuilderCodeGeneratorBridge['generateApprovedPlan'],
      proposePlan: methods.proposePlan as BuilderCodeGeneratorBridge['proposePlan'],
      preparePlanSourceReadApproval:
        methods.preparePlanSourceReadApproval as BuilderCodeGeneratorBridge['preparePlanSourceReadApproval'],
      approvePlanSourceRead:
        methods.approvePlanSourceRead as BuilderCodeGeneratorBridge['approvePlanSourceRead'],
      retry: methods.retry as BuilderCodeGeneratorBridge['retry'],
      answer: methods.answer as BuilderCodeGeneratorBridge['answer'],
      restoreDraft: methods.restoreDraft as BuilderCodeGeneratorBridge['restoreDraft'],
      rejectDraft: methods.rejectDraft as BuilderCodeGeneratorBridge['rejectDraft'],
      cancel: methods.cancel as BuilderCodeGeneratorBridge['cancel'],
      steer: methods.steer as BuilderCodeGeneratorBridge['steer'],
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

function safePlanSourceReadFileCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 8) {
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

function sanitizeStartedEvent(value: unknown): BuilderGenerationStartedEvent {
  const event = exactDataRecord(value, ['event_version', 'request_id', 'project_id']);
  if (
    event.event_version !== GENERATION_STARTED_EVENT_VERSION
    || typeof event.request_id !== 'string'
    || !DIGEST_PATTERN.test(event.request_id)
    || typeof event.project_id !== 'string'
    || !PROJECT_ID_PATTERN.test(event.project_id)
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

function sanitizeOutputEvent(value: unknown): BuilderGenerationOutputEvent {
  const event = exactDataRecord(value, [
    'event_version',
    'request_id',
    'project_id',
    'conversation_id',
    'turn_id',
    'task_id',
    'run_id',
    'display_delta_text',
  ]);
  if (
    event.event_version !== GENERATION_OUTPUT_EVENT_VERSION
    || typeof event.request_id !== 'string'
    || !DIGEST_PATTERN.test(event.request_id)
    || typeof event.project_id !== 'string'
    || !PROJECT_ID_PATTERN.test(event.project_id)
    || typeof event.conversation_id !== 'string'
    || !CONVERSATION_ID_PATTERN.test(event.conversation_id)
    || event.conversation_id.slice('builder-conversation:'.length)
      !== event.project_id.slice('builder-project:'.length)
    || typeof event.turn_id !== 'string'
    || !TURN_ID_PATTERN.test(event.turn_id)
    || (event.task_id !== null && (typeof event.task_id !== 'string' || !TASK_ID_PATTERN.test(event.task_id)))
    || typeof event.run_id !== 'string'
    || !RUN_ID_PATTERN.test(event.run_id)
  ) throw portError();
  return Object.freeze({
    event_version: GENERATION_OUTPUT_EVENT_VERSION,
    request_id: event.request_id,
    project_id: event.project_id,
    conversation_id: event.conversation_id,
    turn_id: event.turn_id,
    task_id: event.task_id,
    run_id: event.run_id,
    display_delta_text: safeDisplayDeltaText(event.display_delta_text),
  });
}

export function createBuilderDesktopCodeGeneratorPort(
  value: unknown,
): BuilderCodeGeneratorPort {
  const bridge = sanitizeBridge(value);
  return Object.freeze({
    generate(request: Parameters<BuilderCodeGeneratorPort['generate']>[0]) {
      return callBridge(bridge, bridge.generate, [{
        instruction: request.instruction,
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
      }]).then(unwrapGenerationEnvelope);
    },
    preparePlanSourceReadApproval(
      request: Parameters<BuilderCodeGeneratorPort['preparePlanSourceReadApproval']>[0],
    ) {
      const projectId = safeProjectId(request.project_id);
      return callBridge(bridge, bridge.preparePlanSourceReadApproval, [{
        project_id: projectId,
      }]).then((result) => unwrapPlanSourceReadApprovalStatus(
        unwrapGenerationEnvelope(result),
        projectId,
      ));
    },
    approvePlanSourceRead(request: Parameters<BuilderCodeGeneratorPort['approvePlanSourceRead']>[0]) {
      const projectId = safeProjectId(request.project_id);
      return callBridge(bridge, bridge.approvePlanSourceRead, [{
        project_id: projectId,
      }]).then((result) => unwrapPlanSourceReadApprovalResult(
        unwrapGenerationEnvelope(result),
        projectId,
      ));
    },
    submit(request: Parameters<BuilderCodeGeneratorPort['submit']>[0]) {
      return callBridge(bridge, bridge.submit, [{
        instruction: request.instruction,
      }]).then(unwrapGenerationEnvelope);
    },
    retry(request: Parameters<BuilderCodeGeneratorPort['retry']>[0]) {
      return callBridge(bridge, bridge.retry, [{
        instruction: request.instruction,
      }]).then(unwrapGenerationEnvelope);
    },
    answer(request: Parameters<BuilderCodeGeneratorPort['answer']>[0]) {
      return callBridge(bridge, bridge.answer, [{
        instruction: request.instruction,
      }]).then(unwrapGenerationEnvelope);
    },
    restoreDraft(request: Parameters<BuilderCodeGeneratorPort['restoreDraft']>[0]) {
      return callBridge(bridge, bridge.restoreDraft, [{
        draft_id: request.draft_id,
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
      }]).then((result) => unwrapCancelResult(result, request.request_id));
    },
    steer(request: Parameters<BuilderCodeGeneratorPort['steer']>[0]) {
      return callBridge(bridge, bridge.steer, [{
        request_id: request.request_id,
        message: request.message,
      }]).then((result) => unwrapSteerResult(result, request.request_id));
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
  });
}
