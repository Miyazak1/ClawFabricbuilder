import type { BuilderCodeGeneratorPort } from '../application/builderPorts';

type BuilderCodeGeneratorBridge = Readonly<{
  generate(request: unknown): Promise<unknown>;
  cancel(request: unknown): Promise<unknown>;
  availability(): Promise<unknown>;
}>;

const BRIDGE_KEYS = new Set(['generate', 'cancel', 'availability']);
const MAX_DATA_GRAPH_NODES = 20_000;
const MAX_DATA_GRAPH_ENTRIES = 20_000;
const MAX_DATA_GRAPH_UTF8_BYTES = 1024 * 1024;
const UTF8_ENCODER = new TextEncoder();

export class BuilderDesktopCodeGeneratorPortError extends Error {
  readonly code = 'builder_generation_unavailable';

  constructor() {
    super('AI project generation is unavailable.');
    this.name = 'BuilderDesktopCodeGeneratorPortError';
  }
}

function portError(): BuilderDesktopCodeGeneratorPortError {
  return new BuilderDesktopCodeGeneratorPortError();
}

function accountUtf8(value: string, state: { utf8Bytes: number }): void {
  if (value.length > MAX_DATA_GRAPH_UTF8_BYTES - state.utf8Bytes) throw portError();
  state.utf8Bytes += UTF8_ENCODER.encode(value).byteLength;
  if (state.utf8Bytes > MAX_DATA_GRAPH_UTF8_BYTES) throw portError();
}

function assertPlainDataGraph(
  value: unknown,
  state: { entries: number; nodes: number; seen: WeakSet<object>; utf8Bytes: number },
): void {
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'string') {
    accountUtf8(value, state);
    return;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (typeof value !== 'object' || state.seen.has(value)) throw portError();
  state.nodes += 1;
  if (state.nodes > MAX_DATA_GRAPH_NODES) throw portError();
  state.seen.add(value);

  const isArray = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (
    (isArray && prototype !== Array.prototype)
    || (!isArray && prototype !== Object.prototype && prototype !== null)
  ) throw portError();
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== 'string')) throw portError();
  state.entries += keys.length - (isArray ? 1 : 0);
  if (state.entries > MAX_DATA_GRAPH_ENTRIES) throw portError();
  for (const key of keys) accountUtf8(key as string, state);

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
    assertPlainDataGraph(descriptor.value, state);
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
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

export function createBuilderDesktopCodeGeneratorPort(
  value: unknown,
): BuilderCodeGeneratorPort {
  const bridge = sanitizeBridge(value);
  return Object.freeze({
    generate(request: Parameters<BuilderCodeGeneratorPort['generate']>[0]) {
      return callBridge(bridge, bridge.generate, [request]);
    },
  });
}
