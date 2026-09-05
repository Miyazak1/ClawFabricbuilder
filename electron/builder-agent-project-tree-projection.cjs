'use strict';

const { types: utilTypes } = require('node:util');
const {
  sanitizeBuilderTaskAddress,
} = require('./builder-session-task-address.cjs');

const BUILDER_AGENT_PROJECT_TREE_PROJECTION_VERSION = 'agent-project-tree-projection.v1';
const AGENT_ID_PATTERN = /^builder-agent:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const OPTION_KEYS = Object.freeze([
  'agent_store',
  'address_store',
  'project_lifecycle_store',
  'list_current_projects',
  'list_project_workspaces',
  'owner_id',
]);

class BuilderAgentProjectTreeProjectionError extends Error {
  constructor() {
    super('Builder agent navigation is unavailable.');
    this.name = 'BuilderAgentProjectTreeProjectionError';
    this.code = 'builder_agent_project_tree_unavailable';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderAgentProjectTreeProjectionError();
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || utilTypes.isProxy(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactObject(value, keys) {
  if (!isPlainObject(value)) fail();
  const actual = Reflect.ownKeys(value);
  if (actual.length !== keys.length || actual.some((key) => typeof key !== 'string' || !keys.includes(key))) fail();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail();
  }
  return descriptors;
}

function stableMethod(value, key) {
  if (!isPlainObject(value)) fail();
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') fail();
  return descriptor.value;
}

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freezeDeep(nested);
    Object.freeze(value);
  }
  return value;
}

function workspaceResult(value) {
  if (!isPlainObject(value) || value.operation !== 'project_workspaces_listed' || !Array.isArray(value.workspaces)) fail();
  return value.workspaces;
}

function currentResult(value) {
  if (!isPlainObject(value) || value.operation !== 'current_listed' || !Array.isArray(value.projects)) fail();
  return value.projects;
}

function taskNode(record) {
  let task;
  try {
    task = sanitizeBuilderTaskAddress(record?.task_address);
  } catch {
    fail();
  }
  return freezeDeep({
    task_address_id: task.task_address_id,
    task_id: task.task_address_id,
    session_id: task.session_id,
    conversation_id: task.conversation_id,
    project_id: task.project_id,
    agent_id: task.agent_id,
    title: task.title,
    goal: task.goal,
    status: task.status,
    current_plan_id: task.current_plan_id,
    has_unreviewed_draft: task.status === 'review_needed',
    needs_permission: false,
    latest_activity_at_ms: task.updated_at_ms,
  });
}

function projectNode(saved, workspace, tasks) {
  const latestTask = tasks[0] ?? null;
  return freezeDeep({
    project_id: workspace?.project_id ?? saved.project_id,
    title: workspace?.title ?? saved.title,
    summary: saved?.summary ?? `Local project in ${workspace.source_folders[0].name}`,
    source_boundary_label: workspace ? `Source folder: ${workspace.source_folders[0].name}` : null,
    revision_number: saved?.revision_number ?? (workspace.has_current_revision ? workspace.current_revision_number : null),
    status: saved ? 'saved' : 'workspace',
    task_count: tasks.length,
    active_task_count: tasks.filter((task) => !['completed', 'archived'].includes(task.status)).length,
    latest_activity_at_ms: latestTask?.latest_activity_at_ms ?? saved?.selected_at_ms ?? workspace?.bound_at_ms ?? null,
    tasks,
  });
}

function createBuilderAgentProjectTreeProjection(rawOptions) {
  const options = exactObject(rawOptions, OPTION_KEYS);
  const agentStore = options.agent_store.value;
  const addressStore = options.address_store.value;
  const projectLifecycleStore = options.project_lifecycle_store.value;
  const readAgent = stableMethod(agentStore, 'read_agent');
  const listTasks = stableMethod(addressStore, 'list_task_addresses_for_agent');
  const applyProjectLifecycle = stableMethod(projectLifecycleStore, 'apply_to_project');
  const listCurrentProjects = options.list_current_projects.value;
  const listProjectWorkspaces = options.list_project_workspaces.value;
  const ownerId = options.owner_id.value;
  if (typeof listCurrentProjects !== 'function' || typeof listProjectWorkspaces !== 'function' || typeof ownerId !== 'string') fail();

  return freezeDeep({
    projection_service_version: 'builder-agent-project-tree-projection-service.v1',
    async read_tree(rawRequest) {
      const request = exactObject(rawRequest, ['agent_id']);
      const agentId = request.agent_id.value;
      if (typeof agentId !== 'string' || !AGENT_ID_PATTERN.test(agentId)) fail();
      const agentRead = Reflect.apply(readAgent, agentStore, [{ agent_id: agentId, owner_id: ownerId }]);
      if (agentRead.status !== 'ready' || agentRead.current_status !== 'active' || agentRead.current_version === null) fail();
      const [savedResult, workspacesResult] = await Promise.all([
        Reflect.apply(listCurrentProjects, undefined, []),
        Reflect.apply(listProjectWorkspaces, undefined, []),
      ]);
      const saved = currentResult(savedResult)
        .map((project) => Reflect.apply(applyProjectLifecycle, projectLifecycleStore, [project]))
        .filter((project) => project !== null);
      const workspaces = workspaceResult(workspacesResult)
        .map((project) => Reflect.apply(applyProjectLifecycle, projectLifecycleStore, [project]))
        .filter((project) => project !== null);
      const taskResult = Reflect.apply(listTasks, addressStore, [{ agent_id: agentId, limit: 512 }]);
      if (taskResult.status !== 'ready' || !Array.isArray(taskResult.task_addresses)) fail();
      const tasks = taskResult.task_addresses.map(taskNode);
      const tasksByProject = new Map();
      for (const task of tasks) {
        const group = tasksByProject.get(task.project_id) ?? [];
        group.push(task);
        tasksByProject.set(task.project_id, group);
      }
      const savedById = new Map(saved.map((project) => [project.project_id, project]));
      const workspaceById = new Map(workspaces.map((project) => [project.project_id, project]));
      const projectIds = new Set([...savedById.keys(), ...workspaceById.keys()]);
      const projects = [...projectIds].map((projectId) => projectNode(
        savedById.get(projectId) ?? null,
        workspaceById.get(projectId) ?? null,
        freezeDeep(tasksByProject.get(projectId) ?? []),
      )).sort((left, right) => (
        (right.latest_activity_at_ms ?? 0) - (left.latest_activity_at_ms ?? 0)
        || left.project_id.localeCompare(right.project_id)
      ));
      const orphanedTasks = tasks.filter((task) => !projectIds.has(task.project_id));
      return freezeDeep({
        projection_version: BUILDER_AGENT_PROJECT_TREE_PROJECTION_VERSION,
        agent_id: agentId,
        agent: {
          display_name: agentRead.definition.display_name,
          purpose: agentRead.definition.purpose,
          lifecycle_status: agentRead.current_status,
          agent_version_id: agentRead.current_version.agent_version_id,
          version_number: agentRead.current_version.version_number,
        },
        projects,
        orphaned_tasks: orphanedTasks,
        authority: {
          agent_identity: 'main_owned_agent_definition_store',
          project_catalog: 'main_owned_project_authorities',
          project_lifecycle: 'main_owned_project_lifecycle_store',
          task_identity: 'main_owned_session_task_address_store',
          renderer_authority: 'selection_only',
          permission_grant: false,
          source_read: false,
          source_write: false,
          git_mutation: false,
          provider_dispatch: false,
        },
      });
    },
  });
}

module.exports = Object.freeze({
  BUILDER_AGENT_PROJECT_TREE_PROJECTION_VERSION,
  BuilderAgentProjectTreeProjectionError,
  createBuilderAgentProjectTreeProjection,
});
