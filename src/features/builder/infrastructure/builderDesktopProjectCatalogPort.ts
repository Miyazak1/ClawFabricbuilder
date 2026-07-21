import type { BuilderProjectCatalogPort } from '../application/builderProjectCatalogController';

type BuilderProjectCatalogBridge = Readonly<{
  listCurrent(): Promise<unknown>;
}>;

const BRIDGE_KEYS = new Set(['listCurrent']);
const MAX_NODES = 1024;
const MAX_ENTRIES = 4096;
const MAX_UTF8_BYTES = 512 * 1024;
const ENCODER = new TextEncoder();

export class BuilderDesktopProjectCatalogPortError extends Error {
  readonly code = 'builder_project_catalog_unavailable';

  constructor() {
    super('Saved projects are unavailable.');
    this.name = 'BuilderDesktopProjectCatalogPortError';
  }
}

function unavailable(): BuilderDesktopProjectCatalogPortError {
  return new BuilderDesktopProjectCatalogPortError();
}

function bridge(value: unknown): BuilderProjectCatalogBridge {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw unavailable();
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw unavailable();
    const keys = Reflect.ownKeys(value);
    if (keys.length !== 1 || keys.some((key) => typeof key !== 'string' || !BRIDGE_KEYS.has(key))) {
      throw unavailable();
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, 'listCurrent');
    if (
      !descriptor
      || !descriptor.enumerable
      || 'get' in descriptor
      || 'set' in descriptor
      || typeof descriptor.value !== 'function'
    ) throw unavailable();
    return Object.freeze({ listCurrent: descriptor.value as () => Promise<unknown> });
  } catch {
    throw unavailable();
  }
}

function assertPlainGraph(
  value: unknown,
  state: { entries: number; nodes: number; bytes: number; seen: WeakSet<object> },
): void {
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (typeof value === 'string') {
    if (value.length > MAX_UTF8_BYTES - state.bytes) throw unavailable();
    state.bytes += ENCODER.encode(value).byteLength;
    if (state.bytes > MAX_UTF8_BYTES) throw unavailable();
    return;
  }
  if (typeof value !== 'object' || state.seen.has(value)) throw unavailable();
  state.seen.add(value);
  state.nodes += 1;
  if (state.nodes > MAX_NODES) throw unavailable();
  const array = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if ((array && prototype !== Array.prototype) || (!array && prototype !== Object.prototype && prototype !== null)) {
    throw unavailable();
  }
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== 'string')) throw unavailable();
  if (array && (keys.length !== value.length + 1 || !keys.includes('length'))) throw unavailable();
  state.entries += keys.length - (array ? 1 : 0);
  if (state.entries > MAX_ENTRIES) throw unavailable();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of keys) {
    if (array && key === 'length') continue;
    const descriptor = descriptors[key as string];
    if (!descriptor || !descriptor.enumerable || 'get' in descriptor || 'set' in descriptor) {
      throw unavailable();
    }
    assertPlainGraph(descriptor.value, state);
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function cloneResult(value: unknown): unknown {
  try {
    assertPlainGraph(value, { entries: 0, nodes: 0, bytes: 0, seen: new WeakSet() });
    const cloned = structuredClone(value);
    assertPlainGraph(cloned, { entries: 0, nodes: 0, bytes: 0, seen: new WeakSet() });
    return deepFreeze(cloned);
  } catch {
    throw unavailable();
  }
}

export function createBuilderDesktopProjectCatalogPort(
  value: unknown,
): BuilderProjectCatalogPort {
  const receiver = bridge(value);
  return Object.freeze({
    async listCurrent() {
      try {
        const result = await Reflect.apply(receiver.listCurrent, receiver, []);
        return cloneResult(result);
      } catch {
        throw unavailable();
      }
    },
  });
}
