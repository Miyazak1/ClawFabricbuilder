import {
  BUILDER_GENERATION_DIAGNOSTIC_RETRYABILITY,
  BuilderGenerationDiagnosticError,
  type BuilderCodeGeneratorPort,
  type BuilderGenerationDiagnosticCode as ApplicationBuilderGenerationDiagnosticCode,
} from '../application/builderPorts';

export const BuilderDesktopCodeGeneratorPortError = BuilderGenerationDiagnosticError;
export type BuilderGenerationDiagnosticCode = ApplicationBuilderGenerationDiagnosticCode;

type BuilderCodeGeneratorBridge = Readonly<{
  generate(request: unknown): Promise<unknown>;
  restoreDraft(request: unknown): Promise<unknown>;
  cancel(request: unknown): Promise<unknown>;
  availability(): Promise<unknown>;
}>;

const BRIDGE_KEYS = new Set(['generate', 'restoreDraft', 'cancel', 'availability']);
const MAX_DATA_GRAPH_NODES = 20_000;
const MAX_DATA_GRAPH_ENTRIES = 20_000;
const MAX_DATA_GRAPH_UTF8_BYTES = 1024 * 1024;
const MAX_DATA_GRAPH_DEPTH = 64;
const UTF8_ENCODER = new TextEncoder();

const GENERATE_RESULT_VERSION = 'builder-generation-ipc-result.v1';
const FAILURE_CODES = new Set<BuilderGenerationDiagnosticCode>(
  Object.keys(BUILDER_GENERATION_DIAGNOSTIC_RETRYABILITY) as BuilderGenerationDiagnosticCode[],
);

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
    const methods = {} as Record<string, (...args: unknown[]) => Promise<unknown>>;
    for (const key of BRIDGE_KEYS) {
      const descriptor = descriptors[key];
      if (
        !descriptor
        || !descriptor.enumerable
        || 'get' in descriptor
        || 'set' in descriptor
        || typeof descriptor.value !== 'function'
      ) throw portError();
      methods[key] = descriptor.value as (...args: unknown[]) => Promise<unknown>;
    }
    return Object.freeze({
      generate: methods.generate,
      restoreDraft: methods.restoreDraft,
      cancel: methods.cancel,
      availability: methods.availability,
    });
  } catch {
    throw portError();
  }
}

async function callBridge(
  receiver: BuilderCodeGeneratorBridge,
  method: (...args: unknown[]) => Promise<unknown>,
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
    restoreDraft(request: Parameters<BuilderCodeGeneratorPort['restoreDraft']>[0]) {
      return callBridge(bridge, bridge.restoreDraft, [{
        draft_id: request.draft_id,
      }]).then(unwrapGenerationEnvelope);
    },
  });
}
