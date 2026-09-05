export const BUILDER_CONTEXT_USAGE_PROJECTION_VERSION =
  'builder-context-usage-projection.v2' as const;

export type BuilderContextUsageMeasurementState =
  | 'ready'
  | 'awaiting_usage'
  | 'awaiting_post_compaction_projection';

export type BuilderContextUsageCompactionState = 'idle' | 'compacting' | 'compacted';

export type BuilderContextUsageProjectionWire = Readonly<{
  projection_version: typeof BUILDER_CONTEXT_USAGE_PROJECTION_VERSION;
  authority: 'main_owned_context_usage_projection';
  source: 'deepseek_harness_session_projection';
  project_id: string;
  conversation_id: string;
  run_id: string;
  harness_projection_seq: number;
  measurement_state: BuilderContextUsageMeasurementState;
  uncached_input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  pressure_tokens: number | null;
  projected_tokens: number | null;
  context_window_tokens: number | null;
  usage_percent: number | null;
  cache_hit_percent: number | null;
  compaction_state: BuilderContextUsageCompactionState;
  last_compacted_at_ms: number | null;
  updated_at_ms: number;
}>;

const UUID_SOURCE =
  '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const PROJECT_ID_PATTERN = new RegExp(`^builder-project:${UUID_SOURCE}$`, 'u');
const CONVERSATION_ID_PATTERN = new RegExp(
  `^builder-conversation:${UUID_SOURCE}:${UUID_SOURCE}$`,
  'u',
);
const RUN_ID_PATTERN = new RegExp(`^builder-run:${UUID_SOURCE}$`, 'u');
const KEYS = Object.freeze([
  'projection_version', 'authority', 'source', 'project_id', 'conversation_id', 'run_id',
  'harness_projection_seq', 'measurement_state', 'uncached_input_tokens', 'output_tokens',
  'cache_read_tokens', 'cache_write_tokens', 'pressure_tokens', 'projected_tokens',
  'context_window_tokens', 'usage_percent', 'cache_hit_percent', 'compaction_state',
  'last_compacted_at_ms', 'updated_at_ms',
] as const);

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function safeCount(value: unknown, minimum = 0, maximum = 1_000_000_000): number | null {
  return Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum
    ? value as number
    : null;
}

function nullableCount(value: unknown, minimum = 0): number | null | undefined {
  if (value === null) return null;
  return safeCount(value, minimum) ?? undefined;
}

function usagePercent(
  projectedTokens: number | null,
  pressureTokens: number | null,
  contextWindowTokens: number | null,
): number | null {
  const occupiedTokens = projectedTokens ?? pressureTokens;
  return occupiedTokens === null || contextWindowTokens === null
    ? null
    : Math.min(100, Math.round((occupiedTokens / contextWindowTokens) * 100));
}

function cacheHitPercent(
  uncachedInputTokens: number,
  cacheReadTokens: number,
  cacheWriteTokens: number,
): number | null {
  const totalInputTokens = uncachedInputTokens + cacheReadTokens + cacheWriteTokens;
  return totalInputTokens === 0
    ? null
    : Math.min(100, Math.round((cacheReadTokens / totalInputTokens) * 100));
}

export function sanitizeBuilderContextUsageProjectionWire(
  value: unknown,
): BuilderContextUsageProjectionWire | null {
  try {
    if (!isPlainRecord(value)) return null;
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== KEYS.length
      || ownKeys.some((key) => typeof key !== 'string'
        || !KEYS.includes(key as typeof KEYS[number]))) return null;
    const harnessProjectionSeq = safeCount(value.harness_projection_seq, -1);
    const uncachedInputTokens = safeCount(value.uncached_input_tokens);
    const outputTokens = safeCount(value.output_tokens);
    const cacheReadTokens = safeCount(value.cache_read_tokens);
    const cacheWriteTokens = safeCount(value.cache_write_tokens);
    const pressureTokens = nullableCount(value.pressure_tokens);
    const projectedTokens = nullableCount(value.projected_tokens);
    const contextWindowTokens = nullableCount(value.context_window_tokens, 1);
    const reportedUsagePercent = nullableCount(value.usage_percent);
    const reportedCacheHitPercent = nullableCount(value.cache_hit_percent);
    const lastCompactedAtMs = value.last_compacted_at_ms === null
      ? null
      : safeCount(value.last_compacted_at_ms, 0, Number.MAX_SAFE_INTEGER);
    const updatedAtMs = safeCount(value.updated_at_ms, 0, Number.MAX_SAFE_INTEGER);
    if (
      value.projection_version !== BUILDER_CONTEXT_USAGE_PROJECTION_VERSION
      || value.authority !== 'main_owned_context_usage_projection'
      || value.source !== 'deepseek_harness_session_projection'
      || typeof value.project_id !== 'string'
      || !PROJECT_ID_PATTERN.test(value.project_id)
      || typeof value.conversation_id !== 'string'
      || !CONVERSATION_ID_PATTERN.test(value.conversation_id)
      || typeof value.run_id !== 'string'
      || !RUN_ID_PATTERN.test(value.run_id)
      || !['ready', 'awaiting_usage', 'awaiting_post_compaction_projection']
        .includes(value.measurement_state as string)
      || !['idle', 'compacting', 'compacted'].includes(value.compaction_state as string)
      || harnessProjectionSeq === null
      || uncachedInputTokens === null
      || outputTokens === null
      || cacheReadTokens === null
      || cacheWriteTokens === null
      || pressureTokens === undefined
      || projectedTokens === undefined
      || contextWindowTokens === undefined
      || reportedUsagePercent === undefined
      || reportedCacheHitPercent === undefined
      || (reportedUsagePercent !== null && reportedUsagePercent > 100)
      || (reportedCacheHitPercent !== null && reportedCacheHitPercent > 100)
      || (projectedTokens !== null && pressureTokens === null)
      || reportedUsagePercent !== usagePercent(projectedTokens, pressureTokens, contextWindowTokens)
      || reportedCacheHitPercent !== cacheHitPercent(
        uncachedInputTokens,
        cacheReadTokens,
        cacheWriteTokens,
      )
      || value.measurement_state !== (
        value.measurement_state === 'awaiting_post_compaction_projection'
          ? 'awaiting_post_compaction_projection'
          : pressureTokens === null ? 'awaiting_usage' : 'ready'
      )
      || (lastCompactedAtMs === null && value.last_compacted_at_ms !== null)
      || updatedAtMs === null
      || (value.compaction_state === 'idle' && lastCompactedAtMs !== null)
      || (value.measurement_state === 'awaiting_post_compaction_projection'
        && lastCompactedAtMs === null)
      || (lastCompactedAtMs !== null && lastCompactedAtMs > updatedAtMs)
    ) return null;
    return Object.freeze({
      projection_version: BUILDER_CONTEXT_USAGE_PROJECTION_VERSION,
      authority: 'main_owned_context_usage_projection',
      source: 'deepseek_harness_session_projection',
      project_id: value.project_id,
      conversation_id: value.conversation_id,
      run_id: value.run_id,
      harness_projection_seq: harnessProjectionSeq,
      measurement_state: value.measurement_state as BuilderContextUsageMeasurementState,
      uncached_input_tokens: uncachedInputTokens,
      output_tokens: outputTokens,
      cache_read_tokens: cacheReadTokens,
      cache_write_tokens: cacheWriteTokens,
      pressure_tokens: pressureTokens,
      projected_tokens: projectedTokens,
      context_window_tokens: contextWindowTokens,
      usage_percent: reportedUsagePercent,
      cache_hit_percent: reportedCacheHitPercent,
      compaction_state: value.compaction_state as BuilderContextUsageCompactionState,
      last_compacted_at_ms: lastCompactedAtMs,
      updated_at_ms: updatedAtMs,
    });
  } catch {
    return null;
  }
}
