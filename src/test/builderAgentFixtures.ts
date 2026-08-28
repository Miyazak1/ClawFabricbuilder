export function agentTreeWire() {
  return {
    projection_version: 'agent-project-tree-projection.v1',
    agent_id: 'builder-agent:123e4567-e89b-42d3-a456-426614174002',
    agent: { display_name: 'Builder', purpose: 'Build local projects.', lifecycle_status: 'active', agent_version_id: `builder-agent-version:${'a'.repeat(64)}`, version_number: 1 },
    projects: [{
      project_id: 'builder-project:123e4567-e89b-42d3-a456-426614174200', title: 'Focus timer', summary: 'A timer.', source_boundary_label: 'Source folder: timer', revision_number: 1, status: 'saved', task_count: 1, active_task_count: 1, latest_activity_at_ms: 30,
      tasks: [{ task_address_id: 'builder-task-address:123e4567-e89b-42d3-a456-426614174203', task_id: 'builder-task-address:123e4567-e89b-42d3-a456-426614174203', session_id: 'builder-session:123e4567-e89b-42d3-a456-426614174201', conversation_id: 'builder-conversation:123e4567-e89b-42d3-a456-426614174200:123e4567-e89b-42d3-a456-426614174205', project_id: 'builder-project:123e4567-e89b-42d3-a456-426614174200', agent_id: 'builder-agent:123e4567-e89b-42d3-a456-426614174002', title: 'Improve timer', goal: 'Improve the timer.', status: 'active', current_plan_id: null, has_unreviewed_draft: false, needs_permission: false, latest_activity_at_ms: 30 }],
    }],
    orphaned_tasks: [],
    authority: { agent_identity: 'main_owned_agent_definition_store', project_catalog: 'main_owned_project_authorities', project_lifecycle: 'main_owned_project_lifecycle_store', task_identity: 'main_owned_session_task_address_store', renderer_authority: 'selection_only', permission_grant: false, source_read: false, source_write: false, git_mutation: false, provider_dispatch: false },
  };
}
