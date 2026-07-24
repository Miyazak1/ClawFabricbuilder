import type { BuilderTaskStreamPort } from '../application/builderPorts';

type BuilderTaskStreamBridge = Readonly<{
  read(request: unknown): Promise<unknown>;
}>;

const BRIDGE_KEYS = Object.freeze(['read']);
const PROJECT_ID_PATTERN =
  /^builder-project:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MAX_NODES = 20_000;
const MAX_ENTRIES = 20_000;
const MAX_UTF8_BYTES = 4 * 1024 * 1024;
const MAX_DEPTH = 64;
const ENCODER = new TextEncoder();

export class BuilderDesktopTaskStreamPortError extends Error {
  readonly code = 'builder_task_stream_unavailable';

  constructor() {
    super('Project activity is unavailable.');
    this.name = 'BuilderDesktopTaskStreamPortError';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function unavailable(): BuilderDesktopTaskStreamPortError {
  return new BuilderDesktopTaskStreamPortError();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function sanitizeBridge(value: unknown): BuilderTaskStreamBridge {
  try {
    if (!isPlainObject(value)) throw unavailable();
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== BRIDGE_KEYS.length
      || keys.some((key) => typeof key !== 'string' || !BRIDGE_KEYS.includes(key))
    ) throw unavailable();
    const descriptor = Object.getOwnPropertyDescriptor(value, 'read');
    if (
      !descriptor
      || !descriptor.enumerable
      || !Object.hasOwn(descriptor, 'value')
      || typeof descriptor.value !== 'function'
    ) throw unavailable();
    return Object.freeze({
      read: descriptor.value as (request: unknown) => Promise<unknown>,
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

function safeReadRequest(request: Readonly<{ project_id: string }>): Readonly<{ project_id: string }> {
  if (!isPlainObject(request)) throw unavailable();
  const keys = Reflect.ownKeys(request);
  const descriptor = Object.getOwnPropertyDescriptor(request, 'project_id');
  if (
    keys.length !== 1
    || keys[0] !== 'project_id'
    || !descriptor
    || !descriptor.enumerable
    || !Object.hasOwn(descriptor, 'value')
    || typeof descriptor.value !== 'string'
    || !PROJECT_ID_PATTERN.test(descriptor.value)
  ) throw unavailable();
  return Object.freeze({ project_id: descriptor.value });
}

async function callRead(
  bridge: BuilderTaskStreamBridge,
  request: Readonly<{ project_id: string }>,
): Promise<unknown> {
  try {
    return clonePlainData(await Reflect.apply(bridge.read, bridge, [safeReadRequest(request)]));
  } catch {
    throw unavailable();
  }
}

export function createBuilderDesktopTaskStreamPort(value: unknown): BuilderTaskStreamPort {
  const bridge = sanitizeBridge(value);
  return Object.freeze({
    read(request: Readonly<{ project_id: string }>) {
      return callRead(bridge, request);
    },
  });
}
