import type {
  BuilderAgentTestBrowserLayoutResult,
  BuilderAgentTestBrowserLifecycleEvent,
  BuilderAgentTestBrowserPort,
  BuilderLivePreviewViewBounds,
} from '../application/builderPorts';

const BRIDGE_KEYS = new Set(['stop', 'subscribeLifecycle', 'updateLayout']);
const LIFECYCLE_KEYS = new Set(['event_version', 'owner_run_id', 'session_id', 'lifecycle']);
const RESULT_KEYS = new Set([
  'result_version', 'owner_run_id', 'operation', 'visible', 'applied_bounds',
]);
const BOUNDS_KEYS = new Set(['x', 'y', 'width', 'height']);
const RUN_ID = /^builder-run:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export class BuilderDesktopAgentTestBrowserPortError extends Error {
  readonly code = 'builder_desktop_agent_test_browser_unavailable';
  constructor() {
    super('Agent Test browser layout is unavailable.');
    this.name = 'BuilderDesktopAgentTestBrowserPortError';
  }
}

function invalid(): never { throw new BuilderDesktopAgentTestBrowserPortError(); }

function record(value: unknown, keys: ReadonlySet<string>): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid();
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== keys.size || ownKeys.some((key) => typeof key !== 'string' || !keys.has(key))) {
    invalid();
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const output: Record<string, unknown> = {};
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) invalid();
    output[key] = descriptor.value;
  }
  return output;
}

function bounds(value: unknown): BuilderLivePreviewViewBounds | null {
  if (value === null) return null;
  const source = record(value, BOUNDS_KEYS);
  for (const key of BOUNDS_KEYS) {
    const selected = source[key];
    if (!Number.isSafeInteger(selected) || Number(selected) < (key === 'width' || key === 'height' ? 1 : 0)) {
      invalid();
    }
  }
  return Object.freeze({
    x: Number(source.x),
    y: Number(source.y),
    width: Number(source.width),
    height: Number(source.height),
  });
}

function result(value: unknown): BuilderAgentTestBrowserLayoutResult {
  const source = record(value, RESULT_KEYS);
  if (
    source.result_version !== 'builder-agent-test-browser-layout-result.v1'
    || typeof source.owner_run_id !== 'string'
    || !RUN_ID.test(source.owner_run_id)
    || !['layout_updated', 'not_active'].includes(String(source.operation))
    || typeof source.visible !== 'boolean'
  ) invalid();
  const appliedBounds = bounds(source.applied_bounds);
  if (
    (source.operation === 'not_active' && (source.visible !== false || appliedBounds !== null))
    || (source.operation === 'layout_updated' && source.visible !== (appliedBounds !== null))
  ) invalid();
  return Object.freeze({
    result_version: 'builder-agent-test-browser-layout-result.v1',
    owner_run_id: source.owner_run_id,
    operation: source.operation as BuilderAgentTestBrowserLayoutResult['operation'],
    visible: source.visible,
    applied_bounds: appliedBounds,
  });
}

type AgentTestBrowserBridge = Readonly<{
  stop(request: Parameters<BuilderAgentTestBrowserPort['stop']>[0]): Promise<unknown>;
  subscribeLifecycle(listener: (event: unknown) => void): () => void;
  updateLayout(request: Parameters<BuilderAgentTestBrowserPort['updateLayout']>[0]): Promise<unknown>;
}>;

function bridge(value: unknown): AgentTestBrowserBridge {
  const source = record(value, BRIDGE_KEYS);
  if (typeof source.updateLayout !== 'function') invalid();
  if (typeof source.stop !== 'function') invalid();
  if (typeof source.subscribeLifecycle !== 'function') invalid();
  return Object.freeze({
    stop: source.stop as AgentTestBrowserBridge['stop'],
    subscribeLifecycle: source.subscribeLifecycle as AgentTestBrowserBridge['subscribeLifecycle'],
    updateLayout: source.updateLayout as AgentTestBrowserBridge['updateLayout'],
  });
}

export function createBuilderDesktopAgentTestBrowserPort(value: unknown): BuilderAgentTestBrowserPort {
  const selected = bridge(value);
  return Object.freeze({
    async stop(request: Parameters<BuilderAgentTestBrowserPort['stop']>[0]) {
      const source = record(await selected.stop(request), new Set(['closed', 'owner_run_id']));
      if (typeof source.closed !== 'boolean' || source.owner_run_id !== request.owner_run_id) invalid();
      return Object.freeze({ closed: source.closed, owner_run_id: request.owner_run_id });
    },
    subscribeLifecycle(listener: (event: BuilderAgentTestBrowserLifecycleEvent) => void) {
      return selected.subscribeLifecycle((value) => {
        const source = record(value, LIFECYCLE_KEYS);
        if (
          source.event_version !== 'builder-agent-test-browser-lifecycle-event.v1'
          || typeof source.owner_run_id !== 'string'
          || !RUN_ID.test(source.owner_run_id)
          || typeof source.session_id !== 'string'
          || !/^builder-browser-session:[0-9a-f]{64}$/u.test(source.session_id)
          || !['opened', 'closed'].includes(String(source.lifecycle))
        ) invalid();
        listener(Object.freeze({
          event_version: 'builder-agent-test-browser-lifecycle-event.v1',
          owner_run_id: source.owner_run_id,
          session_id: source.session_id,
          lifecycle: source.lifecycle,
        }) as BuilderAgentTestBrowserLifecycleEvent);
      });
    },
    async updateLayout(request: Parameters<BuilderAgentTestBrowserPort['updateLayout']>[0]) {
      return result(await selected.updateLayout(request));
    },
  });
}
