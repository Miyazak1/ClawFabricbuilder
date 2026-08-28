export const DEFAULT_BUILDER_AGENT_ID = 'builder-agent:123e4567-e89b-42d3-a456-426614174002';

export type BuilderAgentTaskNode = Readonly<{
  task_address_id: string;
  task_id: string;
  session_id: string;
  conversation_id: string;
  project_id: string;
  agent_id: string;
  title: string;
  goal: string;
  status: 'draft' | 'discussing' | 'planned' | 'active' | 'blocked' | 'review_needed' | 'completed' | 'archived';
  current_plan_id: string | null;
  has_unreviewed_draft: boolean;
  needs_permission: boolean;
  latest_activity_at_ms: number | null;
}>;

export type BuilderAgentProjectNode = Readonly<{
  project_id: string;
  title: string;
  summary: string;
  source_boundary_label: string | null;
  revision_number: number | null;
  status: 'saved' | 'workspace' | 'unavailable' | 'stale';
  task_count: number;
  active_task_count: number;
  latest_activity_at_ms: number | null;
  tasks: readonly BuilderAgentTaskNode[];
}>;

export type BuilderAgentProjectTreeProjection = Readonly<{
  projection_version: 'agent-project-tree-projection.v1';
  agent_id: string;
  agent: Readonly<{
    display_name: string;
    purpose: string;
    lifecycle_status: 'active';
    agent_version_id: string;
    version_number: number;
  }>;
  projects: readonly BuilderAgentProjectNode[];
  orphaned_tasks: readonly BuilderAgentTaskNode[];
  authority: Readonly<{
    agent_identity: 'main_owned_agent_definition_store';
    project_catalog: 'main_owned_project_authorities';
    project_lifecycle: 'main_owned_project_lifecycle_store';
    task_identity: 'main_owned_session_task_address_store';
    renderer_authority: 'selection_only';
    permission_grant: false;
    source_read: false;
    source_write: false;
    git_mutation: false;
    provider_dispatch: false;
  }>;
}>;

export class BuilderAgentProjectTreeProjectionError extends Error {
  readonly code = 'builder_agent_project_tree_invalid';
  constructor() {
    super('Builder agent navigation could not be verified.');
    this.name = 'BuilderAgentProjectTreeProjectionError';
  }
}

const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const AGENT_PATTERN = new RegExp(`^builder-agent:${UUID_SOURCE}$`, 'u');
const PROJECT_PATTERN = new RegExp(`^builder-project:${UUID_SOURCE}$`, 'u');
const TASK_ADDRESS_PATTERN = new RegExp(`^builder-task-address:${UUID_SOURCE}$`, 'u');
const SESSION_PATTERN = new RegExp(`^builder-session:${UUID_SOURCE}$`, 'u');
const TASK_CONVERSATION_PATTERN = new RegExp(
  `^builder-conversation:${UUID_SOURCE}:${UUID_SOURCE}$`,
  'u',
);
const VERSION_PATTERN = /^builder-agent-version:[0-9a-f]{64}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;

function invalid(): never { throw new BuilderAgentProjectTreeProjectionError(); }
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid();
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== keys.length || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))) invalid();
  const output: Record<string, unknown> = {};
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) invalid();
    output[key] = descriptor.value;
  }
  return output;
}
function array(value: unknown, maximum = 512): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum) invalid();
  return value;
}
function text(value: unknown, maximum: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum || value.trim() !== value) invalid();
  return value;
}
function id(value: unknown, pattern: RegExp): string {
  const output = text(value, 100);
  if (!pattern.test(output)) invalid();
  return output;
}
function integer(value: unknown, nullable = false): number | null {
  if (nullable && value === null) return null;
  if (!Number.isSafeInteger(value) || Number(value) < 0) invalid();
  return Number(value);
}
function nullableDigest(value: unknown): string | null {
  if (value === null) return null;
  return id(value, DIGEST_PATTERN);
}
function nullableText(value: unknown, maximum: number): string | null {
  if (value === null) return null;
  return text(value, maximum);
}
function task(value: unknown): BuilderAgentTaskNode {
  const source = record(value, ['task_address_id', 'task_id', 'session_id', 'conversation_id', 'project_id', 'agent_id', 'title', 'goal', 'status', 'current_plan_id', 'has_unreviewed_draft', 'needs_permission', 'latest_activity_at_ms']);
  const statuses = ['draft', 'discussing', 'planned', 'active', 'blocked', 'review_needed', 'completed', 'archived'] as const;
  if (!statuses.includes(source.status as typeof statuses[number]) || typeof source.has_unreviewed_draft !== 'boolean' || typeof source.needs_permission !== 'boolean') invalid();
  return Object.freeze({
    task_address_id: id(source.task_address_id, TASK_ADDRESS_PATTERN),
    task_id: id(source.task_id, TASK_ADDRESS_PATTERN),
    session_id: id(source.session_id, SESSION_PATTERN),
    conversation_id: id(source.conversation_id, TASK_CONVERSATION_PATTERN),
    project_id: id(source.project_id, PROJECT_PATTERN),
    agent_id: id(source.agent_id, AGENT_PATTERN),
    title: text(source.title, 160), goal: text(source.goal, 2048),
    status: source.status as BuilderAgentTaskNode['status'],
    current_plan_id: nullableDigest(source.current_plan_id),
    has_unreviewed_draft: source.has_unreviewed_draft,
    needs_permission: source.needs_permission,
    latest_activity_at_ms: integer(source.latest_activity_at_ms, true),
  });
}
function project(value: unknown): BuilderAgentProjectNode {
  const source = record(value, ['project_id', 'title', 'summary', 'source_boundary_label', 'revision_number', 'status', 'task_count', 'active_task_count', 'latest_activity_at_ms', 'tasks']);
  const statuses = ['saved', 'workspace', 'unavailable', 'stale'] as const;
  if (!statuses.includes(source.status as typeof statuses[number])) invalid();
  const tasks = Object.freeze(array(source.tasks).map(task));
  const taskCount = integer(source.task_count);
  const activeTaskCount = integer(source.active_task_count);
  if (taskCount !== tasks.length || activeTaskCount === null || activeTaskCount > tasks.length) invalid();
  return Object.freeze({
    project_id: id(source.project_id, PROJECT_PATTERN), title: text(source.title, 80),
    summary: text(source.summary, 400), source_boundary_label: nullableText(source.source_boundary_label, 160),
    revision_number: integer(source.revision_number, true), status: source.status as BuilderAgentProjectNode['status'],
    task_count: taskCount, active_task_count: activeTaskCount,
    latest_activity_at_ms: integer(source.latest_activity_at_ms, true), tasks,
  });
}

export function sanitizeBuilderAgentProjectTreeProjection(value: unknown): BuilderAgentProjectTreeProjection {
  const source = record(value, ['projection_version', 'agent_id', 'agent', 'projects', 'orphaned_tasks', 'authority']);
  if (source.projection_version !== 'agent-project-tree-projection.v1') invalid();
  const agentId = id(source.agent_id, AGENT_PATTERN);
  const agent = record(source.agent, ['display_name', 'purpose', 'lifecycle_status', 'agent_version_id', 'version_number']);
  if (agent.lifecycle_status !== 'active') invalid();
  const authority = record(source.authority, ['agent_identity', 'project_catalog', 'project_lifecycle', 'task_identity', 'renderer_authority', 'permission_grant', 'source_read', 'source_write', 'git_mutation', 'provider_dispatch']);
  if (authority.agent_identity !== 'main_owned_agent_definition_store' || authority.project_catalog !== 'main_owned_project_authorities' || authority.project_lifecycle !== 'main_owned_project_lifecycle_store' || authority.task_identity !== 'main_owned_session_task_address_store' || authority.renderer_authority !== 'selection_only' || authority.permission_grant !== false || authority.source_read !== false || authority.source_write !== false || authority.git_mutation !== false || authority.provider_dispatch !== false) invalid();
  const projects = Object.freeze(array(source.projects, 256).map(project));
  const orphanedTasks = Object.freeze(array(source.orphaned_tasks).map(task));
  for (const node of projects) for (const child of node.tasks) if (child.agent_id !== agentId || child.project_id !== node.project_id) invalid();
  return Object.freeze({
    projection_version: 'agent-project-tree-projection.v1', agent_id: agentId,
    agent: Object.freeze({ display_name: text(agent.display_name, 80), purpose: text(agent.purpose, 280), lifecycle_status: 'active', agent_version_id: id(agent.agent_version_id, VERSION_PATTERN), version_number: integer(agent.version_number) as number }),
    projects, orphaned_tasks: orphanedTasks,
    authority: Object.freeze({ agent_identity: 'main_owned_agent_definition_store', project_catalog: 'main_owned_project_authorities', project_lifecycle: 'main_owned_project_lifecycle_store', task_identity: 'main_owned_session_task_address_store', renderer_authority: 'selection_only', permission_grant: false, source_read: false, source_write: false, git_mutation: false, provider_dispatch: false }),
  });
}
