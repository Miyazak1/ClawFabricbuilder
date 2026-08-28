const TRACE_VERSION = 'builder-renderer-performance-trace.v1';
const MAX_SAMPLES_PER_METRIC = 4_096;

const METRIC_NAMES = new Set([
  'renderer.command_output.flush_count',
  'renderer.command_output.received_bytes',
  'renderer.command_output.received_count',
  'renderer.command_output.retained_bytes',
  'renderer.activity.commit_count',
  'renderer.activity.render_reason.candidate_changes',
  'renderer.activity.render_reason.live_output',
  'renderer.activity.render_reason.other_state',
  'renderer.activity.render_reason.snapshot',
  'renderer.activity.mount_count',
  'renderer.activity.unmount_count',
  'renderer.builder_app.commit_count',
  'renderer.builder_page.commit_count',
  'renderer.live_output.dropped_count',
  'renderer.live_output.flush_count',
  'renderer.live_output.received_count',
  'renderer.side_workspace.commit_count',
  'renderer.side_workspace.mount_count',
  'renderer.side_workspace.unmount_count',
  'renderer.task_stream.changed.durable_append',
  'renderer.task_stream.changed.coalesced_count',
  'renderer.task_stream.changed.legacy',
  'renderer.task_stream.changed.live_only',
  'renderer.task_stream.changed.runtime_append',
  'renderer.task_stream.clone_freeze.duration_ms',
  'renderer.task_stream.controller_publish_count',
  'renderer.task_stream.cursor.full_count',
  'renderer.task_stream.cursor.incremental_count',
  'renderer.task_stream.cursor.legacy_fallback_count',
  'renderer.task_stream.cursor.unchanged_count',
  'renderer.task_stream.ignored_live_only_count',
  'renderer.task_stream.read.duration_ms',
  'renderer.task_stream.read.result_bytes',
] as const);

type MetricName = typeof METRIC_NAMES extends Set<infer T> ? T : never;
type Metric = { count: number; samples: number[]; total: number };

declare global {
  interface Window {
    __builderPerformanceTraceSnapshot?: () => unknown;
  }
}

const enabled = (() => {
  try {
    return new URLSearchParams(globalThis.location?.search ?? '').get('builder_perf_trace') === '1';
  } catch {
    return false;
  }
})();
const metrics = new Map<MetricName, Metric>();

function rounded(value: number): number {
  return Number(value.toFixed(3));
}

function percentile(sorted: readonly number[], ratio: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

function metricFor(name: MetricName): Metric | null {
  if (!enabled || !METRIC_NAMES.has(name)) return null;
  let metric = metrics.get(name);
  if (metric === undefined) {
    metric = { count: 0, samples: [], total: 0 };
    metrics.set(name, metric);
  }
  return metric;
}

export function builderPerformanceTraceEnabled(): boolean {
  return enabled;
}

export function observeBuilderPerformance(name: MetricName, rawValue: number): boolean {
  const value = Number(rawValue);
  if (!Number.isFinite(value) || value < 0) return false;
  const metric = metricFor(name);
  if (metric === null) return false;
  metric.count += 1;
  metric.total += value;
  if (metric.samples.length < MAX_SAMPLES_PER_METRIC) metric.samples.push(value);
  return true;
}

export function incrementBuilderPerformance(name: MetricName, amount = 1): boolean {
  return observeBuilderPerformance(name, amount);
}

export function measureBuilderPerformance<T>(name: MetricName, callback: () => T): T {
  if (!enabled) return callback();
  const startedAt = performance.now();
  try {
    return callback();
  } finally {
    observeBuilderPerformance(name, performance.now() - startedAt);
  }
}

export async function measureBuilderPerformanceAsync<T>(
  name: MetricName,
  callback: () => Promise<T>,
): Promise<T> {
  if (!enabled) return callback();
  const startedAt = performance.now();
  try {
    return await callback();
  } finally {
    observeBuilderPerformance(name, performance.now() - startedAt);
  }
}

export function builderPerformanceTraceSnapshot(): unknown {
  return Object.freeze({
    trace_version: TRACE_VERSION,
    metrics: Object.freeze([...metrics.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, metric]) => {
        const sorted = [...metric.samples].sort((left, right) => left - right);
        return Object.freeze({
          name,
          count: metric.count,
          sample_count: sorted.length,
          total: rounded(metric.total),
          median: rounded(percentile(sorted, 0.5)),
          p95: rounded(percentile(sorted, 0.95)),
          max: rounded(sorted.at(-1) ?? 0),
        });
      })),
    privacy: Object.freeze({
      content_fields_recorded: false,
      identifiers_recorded: false,
      paths_recorded: false,
      urls_recorded: false,
    }),
  });
}

if (enabled && typeof window !== 'undefined') {
  Object.defineProperty(window, '__builderPerformanceTraceSnapshot', {
    configurable: false,
    enumerable: false,
    value: builderPerformanceTraceSnapshot,
    writable: false,
  });
}

export type BuilderPerformanceMetricName = MetricName;
