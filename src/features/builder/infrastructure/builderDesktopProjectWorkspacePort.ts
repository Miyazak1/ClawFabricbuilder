import type { BuilderProjectWorkspacePort } from '../application/builderPorts';

type BuilderProjectWorkspaceBridge = Readonly<{
  open(request: unknown): Promise<unknown>;
  saveDraft(request: unknown): Promise<unknown>;
  loadCurrent(request: unknown): Promise<unknown>;
  listCurrent(): Promise<unknown>;
}>;

const BRIDGE_KEYS = Object.freeze(['open', 'saveDraft', 'loadCurrent', 'listCurrent']);
const MAX_NODES = 20_000;
const MAX_ENTRIES = 20_000;
const MAX_UTF8_BYTES = 16 * 1024 * 1024;
const MAX_DEPTH = 64;
const ENCODER = new TextEncoder();

export class BuilderDesktopProjectWorkspacePortError extends Error {
  readonly code = 'builder_project_workspace_unavailable';

  constructor() {
    super('Builder projects are unavailable.');
    this.name = 'BuilderDesktopProjectWorkspacePortError';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function unavailable(): BuilderDesktopProjectWorkspacePortError {
  return new BuilderDesktopProjectWorkspacePortError();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function sanitizeBridge(value: unknown): BuilderProjectWorkspaceBridge {
  try {
    if (!isPlainObject(value)) throw unavailable();
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== BRIDGE_KEYS.length
      || keys.some((key) => typeof key !== 'string' || !BRIDGE_KEYS.includes(key))
    ) throw unavailable();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const methods: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
    for (const key of BRIDGE_KEYS) {
      const descriptor = descriptors[key];
      if (
        !descriptor
        || !descriptor.enumerable
        || !Object.hasOwn(descriptor, 'value')
        || typeof descriptor.value !== 'function'
      ) throw unavailable();
      methods[key] = descriptor.value as (...args: unknown[]) => Promise<unknown>;
    }
    return Object.freeze({
      open: methods.open,
      saveDraft: methods.saveDraft,
      loadCurrent: methods.loadCurrent,
      listCurrent: methods.listCurrent,
    });
  } catch {
    throw unavailable();
  }
}

function accountText(value: string, state: { bytes: number }): void {
  if (value.length > MAX_UTF8_BYTES - state.bytes) throw unavailable();
  state.bytes += ENCODER.encode(value).byteLength;
  if (state.bytes > MAX_UTF8_BYTES) throw unavailable();
}

function assertPlainGraph(
  value: unknown,
  state = {
    bytes: 0,
    entries: 0,
    nodes: 0,
    seen: new WeakSet<object>(),
  },
  depth = 0,
): void {
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (typeof value === 'string') {
    accountText(value, state);
    return;
  }
  if (
    typeof value !== 'object'
    || state.seen.has(value)
    || depth > MAX_DEPTH
    || state.nodes >= MAX_NODES
  ) throw unavailable();
  state.seen.add(value);
  state.nodes += 1;
  const array = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (
    (array && prototype !== Array.prototype)
    || (!array && prototype !== Object.prototype && prototype !== null)
  ) throw unavailable();
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== 'string')) throw unavailable();
  if (array && (keys.length !== value.length + 1 || !keys.includes('length'))) throw unavailable();
  const entries = keys.length - (array ? 1 : 0);
  if (entries > MAX_ENTRIES - state.entries) throw unavailable();
  state.entries += entries;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of keys) {
    accountText(key as string, state);
    if (array && key === 'length') continue;
    const descriptor = descriptors[key as string];
    if (
      !descriptor
      || !descriptor.enumerable
      || !Object.hasOwn(descriptor, 'value')
      || (array && !/^(?:0|[1-9][0-9]*)$/u.test(key as string))
    ) throw unavailable();
    assertPlainGraph(descriptor.value, state, depth + 1);
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
    assertPlainGraph(value);
    const cloned = structuredClone(value);
    assertPlainGraph(cloned);
    return deepFreeze(cloned);
  } catch {
    throw unavailable();
  }
}

async function call(
  bridge: BuilderProjectWorkspaceBridge,
  method: (...args: unknown[]) => Promise<unknown>,
  args: unknown[],
): Promise<unknown> {
  try {
    const safeArgs = args.map(clonePlainData);
    return clonePlainData(await Reflect.apply(method, bridge, safeArgs));
  } catch {
    throw unavailable();
  }
}

export function createBuilderDesktopProjectWorkspacePort(
  value: unknown,
): BuilderProjectWorkspacePort {
  const bridge = sanitizeBridge(value);
  return Object.freeze({
    open(request: Readonly<{ project_id: string | null }>) {
      return call(bridge, bridge.open, [request]);
    },
    saveDraft(request: Readonly<{ draft_id: string }>) {
      return call(bridge, bridge.saveDraft, [request]);
    },
    loadCurrent(request: Readonly<{ project_id: string }>) {
      return call(bridge, bridge.loadCurrent, [request]);
    },
    listCurrent() {
      return call(bridge, bridge.listCurrent, []);
    },
  });
}
