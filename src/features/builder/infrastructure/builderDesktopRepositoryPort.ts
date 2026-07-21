import type { BuilderProjectRepositoryPort } from '../application/builderPorts';

type BuilderProjectRevisionBridge = Readonly<{
  commit(request: unknown): Promise<unknown>;
  loadCurrent(request: unknown): Promise<unknown>;
}>;

type CommitRequest = Parameters<BuilderProjectRepositoryPort['commit']>[0];
type LoadCurrentRequest = Parameters<BuilderProjectRepositoryPort['loadCurrent']>[0];

const BRIDGE_KEYS = new Set(['commit', 'loadCurrent']);
const MAX_DATA_GRAPH_NODES = 20_000;
const MAX_DATA_GRAPH_ENTRIES = 20_000;
const MAX_DATA_GRAPH_UTF8_BYTES = 1024 * 1024;
const UTF8_ENCODER = new TextEncoder();

export class BuilderDesktopRepositoryPortError extends Error {
  readonly code = 'builder_repository_unavailable';

  constructor() {
    super('Local project storage is unavailable.');
    this.name = 'BuilderDesktopRepositoryPortError';
  }
}

function portError(): BuilderDesktopRepositoryPortError {
  return new BuilderDesktopRepositoryPortError();
}

function accountUtf8(
  value: string,
  state: { utf8Bytes: number },
): void {
  if (value.length > MAX_DATA_GRAPH_UTF8_BYTES - state.utf8Bytes) throw portError();
  state.utf8Bytes += UTF8_ENCODER.encode(value).byteLength;
  if (state.utf8Bytes > MAX_DATA_GRAPH_UTF8_BYTES) throw portError();
}

function sanitizeBridge(value: unknown): BuilderProjectRevisionBridge {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw portError();
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw portError();
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== BRIDGE_KEYS.size
      || keys.some((key) => typeof key !== 'string' || !BRIDGE_KEYS.has(key))
    ) {
      throw portError();
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const methods = {} as Record<string, (request: unknown) => Promise<unknown>>;
    for (const key of BRIDGE_KEYS) {
      const descriptor = descriptors[key];
      if (
        !descriptor
        || !descriptor.enumerable
        || 'get' in descriptor
        || 'set' in descriptor
        || typeof descriptor.value !== 'function'
      ) {
        throw portError();
      }
      methods[key] = descriptor.value as (request: unknown) => Promise<unknown>;
    }
    return Object.freeze({
      commit: methods.commit,
      loadCurrent: methods.loadCurrent,
    });
  } catch {
    throw portError();
  }
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
  if (isArray && value.length > MAX_DATA_GRAPH_ENTRIES - state.entries) throw portError();
  const prototype = Object.getPrototypeOf(value);
  if (
    (isArray && prototype !== Array.prototype)
    || (!isArray && prototype !== Object.prototype && prototype !== null)
  ) {
    throw portError();
  }
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== 'string')) throw portError();
  for (const key of keys) accountUtf8(key as string, state);
  const entryCount = keys.length - (isArray ? 1 : 0);
  state.entries += entryCount;
  if (state.entries > MAX_DATA_GRAPH_ENTRIES) throw portError();
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

async function callBridge(
  receiver: BuilderProjectRevisionBridge,
  method: (request: unknown) => Promise<unknown>,
  request: unknown,
): Promise<unknown> {
  try {
    const result = await Reflect.apply(method, receiver, [clonePlainData(request)]);
    return clonePlainData(result);
  } catch {
    throw portError();
  }
}

export function createBuilderDesktopRepositoryPort(
  value: unknown,
): BuilderProjectRepositoryPort {
  const bridge = sanitizeBridge(value);
  return Object.freeze({
    commit(request: CommitRequest) {
      return callBridge(bridge, bridge.commit, request);
    },
    loadCurrent(request: LoadCurrentRequest) {
      return callBridge(bridge, bridge.loadCurrent, request);
    },
  });
}
