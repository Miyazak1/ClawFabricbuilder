import type {
  BuilderTaskStreamChangedEvent,
  BuilderTaskStreamPort,
} from '../application/builderPorts';
import {
  builderPerformanceTraceEnabled,
  incrementBuilderPerformance,
  measureBuilderPerformance,
  measureBuilderPerformanceAsync,
  observeBuilderPerformance,
} from '../application/builderPerformanceTrace';
import {
  sanitizeBuilderConversationSnapshot,
  type BuilderConversationSnapshot,
} from '../domain/builderConversationSnapshot';

type BuilderTaskStreamBridge = Readonly<{
  read(request: unknown): Promise<unknown>;
  subscribeChanged(listener: (event: unknown) => void): unknown;
}>;

const BRIDGE_KEYS = Object.freeze(['read', 'subscribeChanged']);
const PROJECT_ID_PATTERN =
  /^builder-project:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const TASK_ADDRESS_ID_PATTERN =
  /^builder-task-address:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const AGENT_ID_PATTERN =
  /^builder-agent:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CURSOR_PROTOCOL_VERSION = 'builder-task-stream-cursor.v1';
const CURSOR_READ_RESULT_VERSION = 'builder-task-stream-cursor-read-result.v1';
const SNAPSHOT_DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const MAX_NODES = 20_000;
const MAX_ENTRIES = 20_000;
const MAX_UTF8_BYTES = 4 * 1024 * 1024;
const MAX_DEPTH = 64;
const ENCODER = new TextEncoder();
type PlainGraphState = {
  bytes: number;
  entries: number;
  nodes: number;
  seen: WeakSet<object>;
};
type PlainDataClone<T> = Readonly<{ value: T; utf8Bytes: number }>;

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
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const descriptor = descriptors.read;
    const subscribeChanged = descriptors.subscribeChanged;
    if (
      !descriptor
      || !descriptor.enumerable
      || !Object.hasOwn(descriptor, 'value')
      || typeof descriptor.value !== 'function'
      || !subscribeChanged
      || !subscribeChanged.enumerable
      || !Object.hasOwn(subscribeChanged, 'value')
      || typeof subscribeChanged.value !== 'function'
    ) throw unavailable();
    return Object.freeze({
      read: descriptor.value as (request: unknown) => Promise<unknown>,
      subscribeChanged: subscribeChanged.value as (
        listener: (event: unknown) => void
      ) => unknown,
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

function plainGraphState(): PlainGraphState {
  return {
    bytes: 0,
    entries: 0,
    nodes: 0,
    seen: new WeakSet<object>(),
  };
}

function assertPlainGraph(
  value: unknown,
  state = plainGraphState(),
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

function clonePlainDataWithStats(value: unknown): PlainDataClone<unknown> {
  try {
    return measureBuilderPerformance('renderer.task_stream.clone_freeze.duration_ms', () => {
      assertPlainGraph(value, plainGraphState());
      const cloned = structuredClone(value);
      const clonedState = plainGraphState();
      assertPlainGraph(cloned, clonedState);
      return Object.freeze({
        value: deepFreeze(cloned),
        utf8Bytes: clonedState.bytes,
      });
    });
  } catch {
    throw unavailable();
  }
}

type BuilderTaskStreamReadRequest = Parameters<BuilderTaskStreamPort['read']>[0];
type NormalizedActivityStoreEntry = Readonly<{
  snapshot_digest: string;
  snapshot: BuilderConversationSnapshot;
  items_by_sequence: ReadonlyMap<number, unknown>;
}>;

function normalizedActivityStoreEntry(
  snapshotDigest: string,
  snapshot: BuilderConversationSnapshot,
): NormalizedActivityStoreEntry {
  return Object.freeze({
    snapshot_digest: snapshotDigest,
    snapshot,
    items_by_sequence: new Map(snapshot.state === 'ready'
      ? snapshot.conversation.items.map((item) => [item.sequence, item] as const)
      : []),
  });
}

function safeReadRequest(request: BuilderTaskStreamReadRequest): BuilderTaskStreamReadRequest {
  if (!isPlainObject(request)) throw unavailable();
  const keys = Reflect.ownKeys(request);
  if (keys.length === 1 && keys[0] === 'agent_id') {
    const agentDescriptor = Object.getOwnPropertyDescriptor(request, 'agent_id');
    if (
      !agentDescriptor
      || !agentDescriptor.enumerable
      || !Object.hasOwn(agentDescriptor, 'value')
      || typeof agentDescriptor.value !== 'string'
      || !AGENT_ID_PATTERN.test(agentDescriptor.value)
    ) throw unavailable();
    return Object.freeze({ agent_id: agentDescriptor.value });
  }
  const projectDescriptor = Object.getOwnPropertyDescriptor(request, 'project_id');
  const taskDescriptor = Object.getOwnPropertyDescriptor(request, 'task_address_id');
  if (
    keys.length !== 2
    || keys.some((key) => typeof key !== 'string' || !['project_id', 'task_address_id'].includes(key))
    || !projectDescriptor
    || !projectDescriptor.enumerable
    || !Object.hasOwn(projectDescriptor, 'value')
    || typeof projectDescriptor.value !== 'string'
    || !PROJECT_ID_PATTERN.test(projectDescriptor.value)
    || !taskDescriptor
    || !taskDescriptor.enumerable
    || !Object.hasOwn(taskDescriptor, 'value')
    || typeof taskDescriptor.value !== 'string'
    || !TASK_ADDRESS_ID_PATTERN.test(taskDescriptor.value)
  ) throw unavailable();
  return Object.freeze({
    project_id: projectDescriptor.value,
    task_address_id: taskDescriptor.value,
  });
}

function readRequestKey(request: BuilderTaskStreamReadRequest): string {
  return 'agent_id' in request
    ? `agent:${request.agent_id}`
    : `task:${request.project_id}:${request.task_address_id}`;
}

function safeSnapshotDigest(value: unknown): string {
  if (typeof value !== 'string' || !SNAPSHOT_DIGEST_PATTERN.test(value)) throw unavailable();
  return value;
}

function exactCursorEnvelope(value: unknown): Record<string, unknown> | null {
  if (!isPlainObject(value) || value.result_version !== CURSOR_READ_RESULT_VERSION) return null;
  const kind = value.result_kind;
  const expectedKeys = kind === 'unchanged'
    ? ['result_version', 'result_kind', 'base_snapshot_digest', 'snapshot_digest']
    : ['result_version', 'result_kind', 'base_snapshot_digest', 'snapshot_digest', 'snapshot'];
  const keys = Reflect.ownKeys(value);
  if (
    !['full', 'unchanged', 'incremental'].includes(kind as string)
    || keys.length !== expectedKeys.length
    || keys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))
  ) throw unavailable();
  if (kind === 'full') {
    if (value.base_snapshot_digest !== null) throw unavailable();
  } else if (safeSnapshotDigest(value.base_snapshot_digest) === '') {
    throw unavailable();
  }
  safeSnapshotDigest(value.snapshot_digest);
  return value;
}

function mergeIncrementalSnapshot(
  baseEntry: NormalizedActivityStoreEntry,
  patch: unknown,
): BuilderConversationSnapshot {
  const base = baseEntry.snapshot;
  if (base.state !== 'ready' || !isPlainObject(patch) || !isPlainObject(patch.conversation)) {
    throw unavailable();
  }
  const patchConversation = patch.conversation;
  if (!isPlainObject(patchConversation.window) || !Array.isArray(patchConversation.items)) {
    throw unavailable();
  }
  const firstSequence = patchConversation.window.first_sequence;
  const baseLastSequence = base.conversation.window.last_sequence;
  if (!Number.isSafeInteger(firstSequence) || (firstSequence as number) < 1) throw unavailable();
  const suffix = patchConversation.items;
  if (suffix.some((item) => (
    !isPlainObject(item)
    || !Number.isSafeInteger(item.sequence)
    || (item.sequence as number) <= baseLastSequence
  ))) throw unavailable();
  const itemsBySequence = new Map([...baseEntry.items_by_sequence]
    .filter(([sequence]) => sequence >= (firstSequence as number)));
  for (const item of suffix) {
    const sequence = (item as { sequence: number }).sequence;
    if (itemsBySequence.has(sequence)) throw unavailable();
    itemsBySequence.set(sequence, item);
  }
  return sanitizeBuilderConversationSnapshot({
    ...patch,
    conversation: {
      ...patchConversation,
      items: [...itemsBySequence.entries()]
        .sort(([left], [right]) => left - right)
        .map(([, item]) => item),
    },
  });
}

function resolveCursorEnvelope(
  envelope: Record<string, unknown>,
  cacheEntry: NormalizedActivityStoreEntry | null,
): NormalizedActivityStoreEntry {
  const kind = envelope.result_kind;
  const digest = safeSnapshotDigest(envelope.snapshot_digest);
  if (kind === 'full') {
    incrementBuilderPerformance('renderer.task_stream.cursor.full_count');
    return normalizedActivityStoreEntry(
      digest,
      sanitizeBuilderConversationSnapshot(envelope.snapshot),
    );
  }
  const baseDigest = safeSnapshotDigest(envelope.base_snapshot_digest);
  if (cacheEntry === null || cacheEntry.snapshot_digest !== baseDigest) throw unavailable();
  if (kind === 'unchanged') {
    if (digest !== baseDigest) throw unavailable();
    incrementBuilderPerformance('renderer.task_stream.cursor.unchanged_count');
    return cacheEntry;
  }
  incrementBuilderPerformance('renderer.task_stream.cursor.incremental_count');
  return normalizedActivityStoreEntry(
    digest,
    mergeIncrementalSnapshot(cacheEntry, envelope.snapshot),
  );
}

function safeChangedEvent(value: unknown): BuilderTaskStreamChangedEvent {
  if (!isPlainObject(value)) throw unavailable();
  const keys = Reflect.ownKeys(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const version = descriptors.event_version;
  if (
    version
    && version.enumerable
    && Object.hasOwn(version, 'value')
    && version.value === 'builder-task-stream-changed.v2'
  ) {
    if (
      keys.length !== 4
      || keys.some((key) => typeof key !== 'string' || ![
        'event_version', 'project_id', 'change_kind', 'cursor',
      ].includes(key))
    ) throw unavailable();
    const project = descriptors.project_id;
    const changeKind = descriptors.change_kind;
    const cursor = descriptors.cursor;
    if (
      !project
      || !project.enumerable
      || !Object.hasOwn(project, 'value')
      || typeof project.value !== 'string'
      || !PROJECT_ID_PATTERN.test(project.value)
      || !changeKind
      || !changeKind.enumerable
      || !Object.hasOwn(changeKind, 'value')
      || !['live_only', 'runtime_append', 'durable_append'].includes(changeKind.value)
      || !cursor
      || !cursor.enumerable
      || !Object.hasOwn(cursor, 'value')
      || !Number.isSafeInteger(cursor.value)
      || cursor.value < 1
    ) throw unavailable();
    return Object.freeze({
      event_version: 'builder-task-stream-changed.v2',
      project_id: project.value,
      change_kind: changeKind.value,
      cursor: cursor.value,
    });
  }
  const isAgentEvent = Object.hasOwn(value, 'agent_id');
  const identityKey = isAgentEvent ? 'agent_id' : 'project_id';
  if (
    keys.length !== 2
    || keys.some((key) => typeof key !== 'string' || !['event_version', identityKey].includes(key))
  ) throw unavailable();
  const identity = descriptors[identityKey];
  if (
    !version
    || !version.enumerable
    || !Object.hasOwn(version, 'value')
    || version.value !== 'builder-task-stream-changed.v1'
    || !identity
    || !identity.enumerable
    || !Object.hasOwn(identity, 'value')
    || typeof identity.value !== 'string'
    || !(isAgentEvent ? AGENT_ID_PATTERN : PROJECT_ID_PATTERN).test(identity.value)
  ) throw unavailable();
  return Object.freeze({
    event_version: 'builder-task-stream-changed.v1',
    [identityKey]: identity.value,
  }) as BuilderTaskStreamChangedEvent;
}

async function callRead(
  bridge: BuilderTaskStreamBridge,
  request: BuilderTaskStreamReadRequest,
  normalizedActivityStore: Map<string, NormalizedActivityStoreEntry>,
  cursorProtocol: { supported: boolean | null },
): Promise<unknown> {
  try {
    return await measureBuilderPerformanceAsync('renderer.task_stream.read.duration_ms', async () => {
      const safeRequest = safeReadRequest(request);
      const cacheKey = readRequestKey(safeRequest);
      const cacheEntry = normalizedActivityStore.get(cacheKey) ?? null;
      let wire: unknown;
      if (cursorProtocol.supported === false) {
        wire = await Reflect.apply(bridge.read, bridge, [safeRequest]);
      } else {
        try {
          wire = await Reflect.apply(bridge.read, bridge, [{
            ...safeRequest,
            cursor: {
              protocol_version: CURSOR_PROTOCOL_VERSION,
              snapshot_digest: cacheEntry?.snapshot_digest ?? null,
            },
          }]);
        } catch {
          wire = await Reflect.apply(bridge.read, bridge, [safeRequest]);
          cursorProtocol.supported = false;
          normalizedActivityStore.clear();
          incrementBuilderPerformance('renderer.task_stream.cursor.legacy_fallback_count');
        }
      }
      const clonedResult = clonePlainDataWithStats(wire);
      if (builderPerformanceTraceEnabled()) {
        observeBuilderPerformance('renderer.task_stream.read.result_bytes', clonedResult.utf8Bytes);
      }
      const cloned = clonedResult.value;
      const envelope = exactCursorEnvelope(cloned);
      if (envelope === null) {
        cursorProtocol.supported = false;
        normalizedActivityStore.clear();
        incrementBuilderPerformance('renderer.task_stream.cursor.legacy_fallback_count');
        return cloned;
      }
      cursorProtocol.supported = true;
      const resolved = resolveCursorEnvelope(envelope, cacheEntry);
      normalizedActivityStore.set(cacheKey, resolved);
      return resolved.snapshot;
    });
  } catch {
    throw unavailable();
  }
}

function callSubscribeChanged(
  bridge: BuilderTaskStreamBridge,
  listener: (event: BuilderTaskStreamChangedEvent) => void,
): () => void {
  try {
    const unsubscribe = Reflect.apply(bridge.subscribeChanged, bridge, [(event: unknown) => {
      try {
        const changed = safeChangedEvent(event);
        if (changed.event_version === 'builder-task-stream-changed.v2') {
          incrementBuilderPerformance(`renderer.task_stream.changed.${changed.change_kind}`);
        } else {
          incrementBuilderPerformance('renderer.task_stream.changed.legacy');
        }
        listener(changed);
      } catch {
        // Malformed activity hints are ignored; read() remains the authority.
      }
    }]);
    if (typeof unsubscribe !== 'function') throw unavailable();
    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      try { Reflect.apply(unsubscribe, undefined, []); } catch { /* unsubscribe is best-effort */ }
    };
  } catch {
    throw unavailable();
  }
}

export function createBuilderDesktopTaskStreamPort(value: unknown): BuilderTaskStreamPort {
  const bridge = sanitizeBridge(value);
  const normalizedActivityStore = new Map<string, NormalizedActivityStoreEntry>();
  const cursorProtocol = { supported: null as boolean | null };
  return Object.freeze({
    read(request: BuilderTaskStreamReadRequest) {
      return callRead(bridge, request, normalizedActivityStore, cursorProtocol);
    },
    subscribeChanged(listener: (event: BuilderTaskStreamChangedEvent) => void) {
      return callSubscribeChanged(bridge, listener);
    },
  });
}
