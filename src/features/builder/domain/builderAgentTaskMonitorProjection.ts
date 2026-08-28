export type BuilderAgentTaskMonitorResult = Readonly<{
  result_version: 'builder-workbench-task-result-summary.v1';
  result_id: string;
  run_id: string;
  sequence: number;
  completed_at_ms: number;
  terminal_status: 'succeeded' | 'failed' | 'interrupted' | 'cancelled';
  result_kind: 'explanation' | 'plan' | 'candidate' | 'failure';
  summary: string;
  review_state: 'pending' | 'approved' | 'accepted' | 'rejected' | 'not_required';
}>;

export type BuilderAgentTaskMonitorItem = Readonly<{
  task_address_id: string;
  project_id: string;
  conversation_id: string;
  title: string;
  goal: string;
  group: 'active' | 'attention' | 'recent';
  state:
    | 'draft'
    | 'working'
    | 'ready'
    | 'waiting_plan_review'
    | 'waiting_review'
    | 'waiting_permission'
    | 'waiting_user_input'
    | 'waiting_resource'
    | 'paused'
    | 'failed'
    | 'interrupted'
    | 'stopped';
  status_label: string;
  latest_activity_at_ms: number;
  latest_result: BuilderAgentTaskMonitorResult | null;
  attention: Readonly<{
    attention_version: 'builder-workbench-task-attention-summary.v1';
    state: 'waiting_permission' | 'waiting_user_input' | 'waiting_resource' | 'paused';
    label: string;
    detail: string;
    action_label: string;
  }> | null;
  operations: readonly ('open_task' | 'cancel_task')[];
}>;

const CANCELLABLE_TASK_STATES = new Set<BuilderAgentTaskMonitorItem['state']>([
  'working', 'waiting_permission', 'waiting_user_input', 'waiting_resource',
]);

export function canStopBuilderAgentTask(task: BuilderAgentTaskMonitorItem): boolean {
  return CANCELLABLE_TASK_STATES.has(task.state) && task.operations.includes('cancel_task');
}

export type BuilderAgentTaskMonitorProjection = Readonly<{
  projection_version: 'builder-workbench-task-monitor.v2';
  agent_id: string;
  tasks: readonly BuilderAgentTaskMonitorItem[];
  counts: Readonly<{ active: number; attention: number; recent: number }>;
  authority: Readonly<{
    task_identity: 'main_owned_session_task_address_store';
    task_state: 'sqlite_canonical_event_replay_plus_task_attention';
    renderer_authority: 'selection_only';
    provider_dispatch: false;
    permission_grant: false;
    source_read: false;
    source_write: false;
  }>;
}>;

export class BuilderAgentTaskMonitorProjectionError extends Error {
  readonly code = 'builder_agent_task_monitor_invalid';
  constructor() {
    super('Builder task monitor could not be verified.');
    this.name = 'BuilderAgentTaskMonitorProjectionError';
  }
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const AGENT_ID = new RegExp(`^builder-agent:${UUID}$`, 'u');
const PROJECT_ID = new RegExp(`^builder-project:${UUID}$`, 'u');
const TASK_ID = new RegExp(`^builder-task-address:${UUID}$`, 'u');
const CONVERSATION_ID = new RegExp(`^builder-conversation:${UUID}:${UUID}$`, 'u');
const RUN_ID = new RegExp(`^builder-run:${UUID}$`, 'u');
const RESULT_ID = /^builder-task-result:[0-9a-f]{64}$/u;

function invalid(): never { throw new BuilderAgentTaskMonitorProjectionError(); }
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid();
  const actual = Reflect.ownKeys(value);
  if (actual.length !== keys.length || actual.some((key) => typeof key !== 'string' || !keys.includes(key))) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const output: Record<string, unknown> = {};
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) invalid();
    output[key] = descriptor.value;
  }
  return output;
}
function array(value: unknown, maximum: number): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum) invalid();
  return value;
}
function text(value: unknown, maximum: number): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > maximum || value.trim() !== value) invalid();
  return value;
}
function id(value: unknown, pattern: RegExp): string {
  const output = text(value, 160);
  if (!pattern.test(output)) invalid();
  return output;
}
function integer(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) invalid();
  return Number(value);
}

function result(value: unknown): BuilderAgentTaskMonitorResult | null {
  if (value === null) return null;
  const source = record(value, [
    'result_version', 'result_id', 'run_id', 'sequence', 'completed_at_ms',
    'terminal_status', 'result_kind', 'summary', 'review_state',
  ]);
  const terminalStatuses = ['succeeded', 'failed', 'interrupted', 'cancelled'] as const;
  const resultKinds = ['explanation', 'plan', 'candidate', 'failure'] as const;
  const reviewStates = ['pending', 'approved', 'accepted', 'rejected', 'not_required'] as const;
  if (
    source.result_version !== 'builder-workbench-task-result-summary.v1'
    || !terminalStatuses.includes(source.terminal_status as typeof terminalStatuses[number])
    || !resultKinds.includes(source.result_kind as typeof resultKinds[number])
    || !reviewStates.includes(source.review_state as typeof reviewStates[number])
  ) invalid();
  return Object.freeze({
    result_version: 'builder-workbench-task-result-summary.v1',
    result_id: id(source.result_id, RESULT_ID),
    run_id: id(source.run_id, RUN_ID),
    sequence: integer(source.sequence),
    completed_at_ms: integer(source.completed_at_ms),
    terminal_status: source.terminal_status as BuilderAgentTaskMonitorResult['terminal_status'],
    result_kind: source.result_kind as BuilderAgentTaskMonitorResult['result_kind'],
    summary: text(source.summary, 2_048),
    review_state: source.review_state as BuilderAgentTaskMonitorResult['review_state'],
  });
}

function task(value: unknown): BuilderAgentTaskMonitorItem {
  const source = record(value, [
    'task_address_id', 'project_id', 'conversation_id', 'title', 'goal', 'group', 'state',
    'status_label', 'latest_activity_at_ms', 'latest_result', 'attention', 'operations',
  ]);
  const groups = ['active', 'attention', 'recent'] as const;
  const states = [
    'draft', 'working', 'ready', 'waiting_plan_review', 'waiting_review',
    'waiting_permission', 'waiting_user_input', 'waiting_resource', 'paused',
    'failed', 'interrupted', 'stopped',
  ] as const;
  if (!groups.includes(source.group as typeof groups[number]) || !states.includes(source.state as typeof states[number])) invalid();
  const operations = array(source.operations, 2);
  if (
    operations.length < 1
    || operations[0] !== 'open_task'
    || operations.some((operation) => operation !== 'open_task' && operation !== 'cancel_task')
    || new Set(operations).size !== operations.length
  ) invalid();
  let attention: BuilderAgentTaskMonitorItem['attention'] = null;
  if (source.attention !== null) {
    const projected = record(source.attention, [
      'attention_version', 'state', 'label', 'detail', 'action_label',
    ]);
    const attentionStates = ['waiting_permission', 'waiting_user_input', 'waiting_resource', 'paused'] as const;
    if (
      projected.attention_version !== 'builder-workbench-task-attention-summary.v1'
      || !attentionStates.includes(projected.state as typeof attentionStates[number])
      || projected.state !== source.state
    ) invalid();
    attention = Object.freeze({
      attention_version: 'builder-workbench-task-attention-summary.v1',
      state: projected.state as NonNullable<BuilderAgentTaskMonitorItem['attention']>['state'],
      label: text(projected.label, 80),
      detail: text(projected.detail, 320),
      action_label: text(projected.action_label, 80),
    });
  } else if (['waiting_permission', 'waiting_user_input', 'waiting_resource', 'paused'].includes(source.state as string)) {
    invalid();
  }
  return Object.freeze({
    task_address_id: id(source.task_address_id, TASK_ID),
    project_id: id(source.project_id, PROJECT_ID),
    conversation_id: id(source.conversation_id, CONVERSATION_ID),
    title: text(source.title, 160),
    goal: text(source.goal, 2_048),
    group: source.group as BuilderAgentTaskMonitorItem['group'],
    state: source.state as BuilderAgentTaskMonitorItem['state'],
    status_label: text(source.status_label, 80),
    latest_activity_at_ms: integer(source.latest_activity_at_ms),
    latest_result: result(source.latest_result),
    attention,
    operations: Object.freeze(operations as ('open_task' | 'cancel_task')[]),
  });
}

export function sanitizeBuilderAgentTaskMonitorProjection(
  value: unknown,
): BuilderAgentTaskMonitorProjection {
  const source = record(value, ['projection_version', 'agent_id', 'tasks', 'counts', 'authority']);
  if (source.projection_version !== 'builder-workbench-task-monitor.v2') invalid();
  const tasks = Object.freeze(array(source.tasks, 256).map(task));
  const counts = record(source.counts, ['active', 'attention', 'recent']);
  const authority = record(source.authority, [
    'task_identity', 'task_state', 'renderer_authority', 'provider_dispatch',
    'permission_grant', 'source_read', 'source_write',
  ]);
  if (
    authority.task_identity !== 'main_owned_session_task_address_store'
    || authority.task_state !== 'sqlite_canonical_event_replay_plus_task_attention'
    || authority.renderer_authority !== 'selection_only'
    || authority.provider_dispatch !== false
    || authority.permission_grant !== false
    || authority.source_read !== false
    || authority.source_write !== false
  ) invalid();
  const outputCounts = {
    active: integer(counts.active),
    attention: integer(counts.attention),
    recent: integer(counts.recent),
  };
  if (
    outputCounts.active !== tasks.filter((item) => item.group === 'active').length
    || outputCounts.attention !== tasks.filter((item) => item.group === 'attention').length
    || outputCounts.recent !== tasks.filter((item) => item.group === 'recent').length
  ) invalid();
  return Object.freeze({
    projection_version: 'builder-workbench-task-monitor.v2',
    agent_id: id(source.agent_id, AGENT_ID),
    tasks,
    counts: Object.freeze(outputCounts),
    authority: Object.freeze({
      task_identity: 'main_owned_session_task_address_store',
      task_state: 'sqlite_canonical_event_replay_plus_task_attention',
      renderer_authority: 'selection_only',
      provider_dispatch: false,
      permission_grant: false,
      source_read: false,
      source_write: false,
    }),
  });
}
