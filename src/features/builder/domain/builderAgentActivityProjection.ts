export type BuilderAgentActivityPhase =
  | 'preparing'
  | 'reading_project'
  | 'planning'
  | 'waiting_for_permission'
  | 'editing'
  | 'running_local_step'
  | 'preparing_review'
  | 'responding'
  | 'stopping'
  | 'waiting_for_approval'
  | 'ready_to_execute'
  | 'ready_for_review'
  | 'blocked'
  | 'finished';

export type BuilderAgentActivityProjectionWire = Readonly<{
  projection_version: 'builder-agent-activity-projection.v1';
  project_id: string;
  conversation_id: string;
  head_sequence: number;
  current: Readonly<{
    phase: BuilderAgentActivityPhase;
    status: 'active' | 'waiting' | 'ready' | 'blocked' | 'complete';
    label: string;
    summary: string;
    turn_id: string | null;
    run_id: string | null;
  }>;
  authority: Readonly<{
    projection_authority: 'main_owned_agent_activity_projection_v1';
    fact_source: 'recorded_activity' | 'recorded_activity_and_review';
    consumer_role: 'read_only';
    side_effect_authority: 'none';
  }>;
}>;

const UUID_SOURCE =
  '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const PROJECT_ID_PATTERN = new RegExp(`^builder-project:${UUID_SOURCE}$`, 'u');
const CONVERSATION_ID_PATTERN = new RegExp(`^builder-conversation:${UUID_SOURCE}$`, 'u');
const TURN_ID_PATTERN = new RegExp(`^builder-turn:${UUID_SOURCE}$`, 'u');
const RUN_ID_PATTERN = new RegExp(`^builder-run:${UUID_SOURCE}$`, 'u');
const PROJECTION_KEYS = Object.freeze([
  'projection_version', 'project_id', 'conversation_id', 'head_sequence', 'current', 'authority',
]);
const CURRENT_KEYS = Object.freeze([
  'phase', 'status', 'label', 'summary', 'turn_id', 'run_id',
]);
const AUTHORITY_KEYS = Object.freeze([
  'projection_authority', 'fact_source', 'consumer_role', 'side_effect_authority',
]);
const COPY = Object.freeze({
  preparing: ['active', 'Preparing request'],
  reading_project: ['active', 'Reading project'],
  planning: ['active', 'Planning'],
  waiting_for_permission: ['waiting', 'Waiting for approval'],
  editing: ['active', 'Changing files'],
  running_local_step: ['active', 'Running local step'],
  preparing_review: ['active', 'Preparing review'],
  responding: ['active', 'Writing response'],
  stopping: ['active', 'Stopping work'],
  waiting_for_approval: ['waiting', 'Plan ready'],
  ready_to_execute: ['ready', 'Ready to execute'],
  ready_for_review: ['ready', 'Ready for review'],
  blocked: ['blocked', 'Needs attention'],
  finished: ['complete', 'Finished'],
} satisfies Readonly<Record<BuilderAgentActivityPhase, readonly [string, string]>>);

type PlainRecord = Record<string, unknown>;

function exactRecord(value: unknown, keys: readonly string[]): value is PlainRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== keys.length
    || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) return false;
  return keys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value');
  });
}

function nullableId(value: unknown, pattern: RegExp): boolean {
  return value === null || (typeof value === 'string' && pattern.test(value));
}

export function sanitizeBuilderAgentActivityProjectionWire(
  value: unknown,
): BuilderAgentActivityProjectionWire | null {
  try {
    if (
      !exactRecord(value, PROJECTION_KEYS)
      || !exactRecord(value.current, CURRENT_KEYS)
      || !exactRecord(value.authority, AUTHORITY_KEYS)
    ) return null;
    const current = value.current;
    const authority = value.authority;
    const copy = typeof current.phase === 'string'
      ? COPY[current.phase as BuilderAgentActivityPhase]
      : undefined;
    if (
      copy === undefined
      || value.projection_version !== 'builder-agent-activity-projection.v1'
      || typeof value.project_id !== 'string'
      || !PROJECT_ID_PATTERN.test(value.project_id)
      || typeof value.conversation_id !== 'string'
      || !CONVERSATION_ID_PATTERN.test(value.conversation_id)
      || value.conversation_id.slice('builder-conversation:'.length)
        !== value.project_id.slice('builder-project:'.length)
      || !Number.isSafeInteger(value.head_sequence)
      || Number(value.head_sequence) < 1
      || current.status !== copy[0]
      || current.label !== copy[1]
      || typeof current.summary !== 'string'
      || current.summary.length < 1
      || current.summary.length > 240
      || !nullableId(current.turn_id, TURN_ID_PATTERN)
      || !nullableId(current.run_id, RUN_ID_PATTERN)
      || (current.turn_id === null) !== (current.run_id === null)
      || authority.projection_authority !== 'main_owned_agent_activity_projection_v1'
      || !['recorded_activity', 'recorded_activity_and_review'].includes(String(authority.fact_source))
      || authority.consumer_role !== 'read_only'
      || authority.side_effect_authority !== 'none'
    ) return null;
    return value as BuilderAgentActivityProjectionWire;
  } catch {
    return null;
  }
}
