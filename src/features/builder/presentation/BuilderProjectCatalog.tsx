import { FolderOpen, Plus, RefreshCw } from 'lucide-react';

import {
  isTrustedBuilderProjectCatalogSnapshot,
  type BuilderProjectCatalogSnapshot,
} from '../application/builderProjectCatalogController';

export type BuilderProjectCatalogProps = Readonly<{
  snapshot: BuilderProjectCatalogSnapshot;
  onOpenProject?: (projectId: string) => void;
  onCreateProject?: () => void;
  onRefresh?: () => void;
}>;

export function BuilderProjectCatalog({
  snapshot,
  onOpenProject,
  onCreateProject,
  onRefresh,
}: BuilderProjectCatalogProps) {
  const trusted = isTrustedBuilderProjectCatalogSnapshot(snapshot);
  const status = trusted ? snapshot.status : 'unavailable';
  const projects = trusted ? snapshot.projects : [];
  const savedProjectIds = new Set(projects.map((project) => project.project_id));
  const workspaceProjects = trusted
    ? snapshot.workspaceProjects.filter((project) => !savedProjectIds.has(project.project_id))
    : [];
  const busy = status === 'loading' || status === 'refreshing';

  return (
    <section aria-labelledby="builder-project-catalog-title" className="cf-builder-catalog" data-builder-project-catalog="true">
      <div className="cf-builder-catalog-header">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">Projects</p>
          <h2 className="truncate text-sm font-semibold" id="builder-project-catalog-title">Your projects</h2>
        </div>
        <div className="cf-builder-catalog-actions">
          <button
            aria-label="Refresh projects"
            className="cf-builder-secondary-button inline-flex size-9 items-center justify-center disabled:cursor-not-allowed disabled:opacity-50"
            disabled={busy || typeof onRefresh !== 'function'}
            onClick={onRefresh}
            title="Refresh projects"
            type="button"
          >
            <RefreshCw aria-hidden="true" className="size-4" />
          </button>
        </div>
      </div>

      <div className="cf-builder-catalog-command">
        <button
          className="cf-builder-primary-button cf-builder-command-button inline-flex min-h-9 w-full items-center justify-center gap-2 px-3 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
          disabled={busy || typeof onCreateProject !== 'function'}
          onClick={onCreateProject}
          type="button"
        >
          <Plus aria-hidden="true" className="size-4" />
          New project
        </button>
      </div>

      {status === 'loading' ? (
        <p className="cf-builder-alert cf-builder-alert-info m-3 text-sm" role="status">Loading saved projects...</p>
      ) : null}
      {status === 'refreshing' ? (
        <p className="cf-builder-alert cf-builder-alert-info mx-3 mt-3 text-sm" role="status">Refreshing saved projects...</p>
      ) : null}
      {status === 'unavailable' ? (
        <div className="cf-builder-alert cf-builder-alert-danger m-3 flex flex-col items-start gap-3 text-sm" role="alert">
          <p>Saved projects are unavailable.</p>
          <button
            className="cf-builder-secondary-button inline-flex min-h-9 items-center gap-2 px-3 text-sm font-medium disabled:opacity-50"
            disabled={typeof onRefresh !== 'function'}
            onClick={onRefresh}
            type="button"
          >
            <RefreshCw aria-hidden="true" className="size-4" />
            Retry
          </button>
        </div>
      ) : null}
      {status === 'stale' ? (
        <p className="cf-builder-alert cf-builder-alert-danger mx-3 mt-3 text-sm" role="alert">
          Saved projects could not be refreshed. Showing the previous list.
        </p>
      ) : null}
      {(status === 'ready' || status === 'stale' || status === 'refreshing')
      && projects.length === 0
      && workspaceProjects.length === 0 ? (
        <p className="cf-builder-alert cf-builder-alert-info m-3 text-sm">No saved projects yet.</p>
      ) : null}
      {projects.length > 0 ? (
        <ul className="cf-builder-project-list" aria-label="Saved projects">
          {projects.map((project) => (
            <li key={project.project_id}>
              <button
                className="cf-builder-project-row grid min-h-20 w-full grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 px-4 py-3 text-left disabled:cursor-not-allowed disabled:opacity-50"
                data-builder-project-id={project.project_id}
                disabled={busy || typeof onOpenProject !== 'function'}
                onClick={() => onOpenProject?.(project.project_id)}
                type="button"
              >
                <FolderOpen aria-hidden="true" className="mt-0.5 size-4" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{project.title}</span>
                  <span className="mt-1 block line-clamp-2 text-xs text-muted-foreground">
                    {project.summary}
                  </span>
                </span>
                <span className="text-xs text-muted-foreground">Version {project.revision_number}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {workspaceProjects.length > 0 ? (
        <div className="cf-builder-workspace-catalog" data-builder-workspace-catalog="true">
          <p className="cf-builder-catalog-section-label">In progress</p>
          <ul className="cf-builder-project-list" aria-label="Unsaved projects">
            {workspaceProjects.map((project) => (
              <li key={project.project_id}>
                <button
                  className="cf-builder-project-row grid min-h-16 w-full grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 px-4 py-3 text-left disabled:cursor-not-allowed disabled:opacity-50"
                  data-builder-workspace-catalog-project={project.project_id}
                  disabled={busy || typeof onOpenProject !== 'function'}
                  onClick={() => onOpenProject?.(project.project_id)}
                  type="button"
                >
                  <FolderOpen aria-hidden="true" className="mt-0.5 size-4" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{project.title}</span>
                    <span className="mt-1 block truncate text-xs text-muted-foreground">
                      Not saved yet - {project.source_folders[0]?.name ?? 'Source folder selected'}
                    </span>
                  </span>
                  <span className="text-xs text-muted-foreground">Draft</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
