'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { createBuilderAgentProjectTreeProjection } = require('../electron/builder-agent-project-tree-projection.cjs');

const AGENT_ID = 'builder-agent:123e4567-e89b-42d3-a456-426614174002';
const PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174200';
const WORKSPACE_ID = 'builder-project:223e4567-e89b-42d3-a456-426614174200';

function agentRead() {
  return {
    status: 'ready',
    current_status: 'active',
    definition: { display_name: 'Builder', purpose: 'Build local projects.' },
    current_version: { agent_version_id: `builder-agent-version:${'a'.repeat(64)}`, version_number: 1 },
  };
}

const passthroughProjectLifecycleStore = Object.freeze({
  apply_to_project(project) {
    return project;
  },
});

test('projects saved and workspace facts under the persisted Agent and only renders addressed tasks', async () => {
  const projection = createBuilderAgentProjectTreeProjection({
    agent_store: { read_agent: () => agentRead() },
    address_store: {
      list_task_addresses_for_agent: () => ({
        status: 'ready',
        task_addresses: [{ task_address: {
          task_address_id: 'builder-task-address:123e4567-e89b-42d3-a456-426614174203',
          session_id: 'builder-session:123e4567-e89b-42d3-a456-426614174201',
          conversation_id: 'builder-conversation:123e4567-e89b-42d3-a456-426614174205',
          project_id: PROJECT_ID,
          agent_id: AGENT_ID,
          title: 'Improve navigation',
          goal: 'Make Agent-first navigation usable.',
          status: 'active',
          current_plan_id: null,
          updated_at_ms: 30,
        } }],
      }),
    },
    project_lifecycle_store: passthroughProjectLifecycleStore,
    list_current_projects: async () => ({ operation: 'current_listed', projects: [{
      project_id: PROJECT_ID,
      title: 'Saved project',
      summary: 'A saved project.',
      revision_number: 2,
      selected_at_ms: 20,
    }] }),
    list_project_workspaces: async () => ({ operation: 'project_workspaces_listed', workspaces: [{
      project_id: WORKSPACE_ID,
      title: 'Workspace project',
      source_folders: [{ name: 'workspace', status: 'selected' }],
      bound_at_ms: 10,
      has_current_revision: false,
      current_revision_number: 0,
    }] }),
    owner_id: 'builder-user:00000000-0000-4000-8000-000000000001',
  });
  const result = await projection.read_tree({ agent_id: AGENT_ID });
  assert.equal(result.projection_version, 'agent-project-tree-projection.v1');
  assert.equal(result.agent.display_name, 'Builder');
  assert.deepEqual(result.projects.map((project) => project.project_id), [PROJECT_ID, WORKSPACE_ID]);
  assert.equal(result.projects[0].tasks.length, 1);
  assert.equal(result.projects[0].tasks[0].conversation_id, 'builder-conversation:123e4567-e89b-42d3-a456-426614174205');
  assert.equal(result.projects[1].tasks.length, 0);
  assert.equal(result.authority.permission_grant, false);
  assert.equal(result.authority.source_read, false);
  assert.equal(Object.isFrozen(result.projects), true);
});

test('missing persisted Agent fails instead of synthesizing a project-first fallback', async () => {
  const projection = createBuilderAgentProjectTreeProjection({
    agent_store: { read_agent: () => ({ status: 'absent' }) },
    address_store: { list_task_addresses_for_agent: () => ({ status: 'ready', task_addresses: [] }) },
    project_lifecycle_store: passthroughProjectLifecycleStore,
    list_current_projects: async () => ({ operation: 'current_listed', projects: [] }),
    list_project_workspaces: async () => ({ operation: 'project_workspaces_listed', workspaces: [] }),
    owner_id: 'builder-user:00000000-0000-4000-8000-000000000001',
  });
  await assert.rejects(() => projection.read_tree({ agent_id: AGENT_ID }), {
    code: 'builder_agent_project_tree_unavailable',
  });
});

test('applies main-owned project lifecycle before rendering the Agent tree', async () => {
  const projection = createBuilderAgentProjectTreeProjection({
    agent_store: { read_agent: () => agentRead() },
    address_store: { list_task_addresses_for_agent: () => ({ status: 'ready', task_addresses: [] }) },
    project_lifecycle_store: {
      apply_to_project(project) {
        if (project.project_id === PROJECT_ID) return { ...project, title: 'Renamed saved project' };
        if (project.project_id === WORKSPACE_ID) return null;
        return project;
      },
    },
    list_current_projects: async () => ({ operation: 'current_listed', projects: [{
      project_id: PROJECT_ID,
      title: 'Saved project',
      summary: 'A saved project.',
      revision_number: 2,
      selected_at_ms: 20,
    }] }),
    list_project_workspaces: async () => ({ operation: 'project_workspaces_listed', workspaces: [{
      project_id: WORKSPACE_ID,
      title: 'Workspace project',
      source_folders: [{ name: 'workspace', status: 'selected' }],
      bound_at_ms: 10,
      has_current_revision: false,
      current_revision_number: 0,
    }] }),
    owner_id: 'builder-user:00000000-0000-4000-8000-000000000001',
  });
  const result = await projection.read_tree({ agent_id: AGENT_ID });
  assert.deepEqual(result.projects.map((project) => project.project_id), [PROJECT_ID]);
  assert.equal(result.projects[0].title, 'Renamed saved project');
  assert.equal(result.authority.project_lifecycle, 'main_owned_project_lifecycle_store');
});
