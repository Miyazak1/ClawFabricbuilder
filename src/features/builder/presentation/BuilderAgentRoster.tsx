import { Bot, FolderOpen, Plus } from 'lucide-react';

import type {
  BuilderAgentProjectTreeSnapshot,
} from '../application/builderAgentProjectTreeController';

export type BuilderAgentRosterProps = Readonly<{
  snapshot: BuilderAgentProjectTreeSnapshot;
  agentConversationSelected: boolean;
  onCreateProject(): void;
  onOpenAgent(): void;
  onToggleProjects(): void;
  projectCount: number;
  projectsExpanded: boolean;
}>;

export function BuilderAgentRoster({
  snapshot,
  agentConversationSelected,
  onCreateProject,
  onOpenAgent,
  onToggleProjects,
  projectCount,
  projectsExpanded,
}: BuilderAgentRosterProps) {
  const tree = snapshot.tree;
  return (
    <section className="cf-builder-agent-roster" data-builder-agent-roster="true">
      <header className="cf-builder-agent-roster-header">
        <strong>Agents</strong>
        {projectCount > 0 ? (
          <button
            aria-label={projectsExpanded ? 'Hide projects' : 'Show projects'}
            aria-pressed={projectsExpanded}
            className="cf-builder-agent-projects-toggle"
            onClick={onToggleProjects}
            title={projectsExpanded ? 'Hide projects' : 'Show projects'}
            type="button"
          >
            <FolderOpen className="size-3.5" aria-hidden="true" />
            <span>{projectCount}</span>
          </button>
        ) : null}
      </header>
      {tree !== null ? (
        <div className="cf-builder-agent-roster-row">
          <button
            aria-current={agentConversationSelected ? 'page' : undefined}
            className="cf-builder-agent-roster-item"
            data-builder-agent-id={tree.agent_id}
            data-selected={agentConversationSelected ? 'true' : 'false'}
            onClick={onOpenAgent}
            type="button"
          >
            <span className="cf-builder-agent-avatar" aria-hidden="true">
              <Bot className="size-4" />
            </span>
            <span className="min-w-0">
              <strong>{tree.agent.display_name}</strong>
              <small>{tree.agent.lifecycle_status === 'active' ? 'Active' : 'Unavailable'}</small>
            </span>
          </button>
          <button
            aria-label={`New project for ${tree.agent.display_name}`}
            className="cf-builder-agent-new-project"
            data-builder-catalog-new-project="true"
            onClick={onCreateProject}
            title="New project"
            type="button"
          >
            <Plus className="size-3.5" aria-hidden="true" />
          </button>
        </div>
      ) : null}
      {snapshot.status === 'loading' ? (
        <p className="cf-builder-agent-roster-state" role="status">Loading...</p>
      ) : null}
      {snapshot.status === 'unavailable' ? (
        <p className="cf-builder-agent-roster-state" role="alert">Agent unavailable</p>
      ) : null}
    </section>
  );
}
