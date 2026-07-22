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
  const busy = status === 'loading' || status === 'refreshing';

  return (
    <section aria-labelledby="builder-project-catalog-title" className="text-[var(--cf-text-soft)]" data-builder-project-catalog="true">
      <div className="cf-builder-header flex min-h-12 items-center justify-between gap-2 border-b px-3">
        <h2 className="text-sm font-semibold" id="builder-project-catalog-title">Your projects</h2>
        <div className="flex items-center gap-1">
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
          <button
            className="cf-builder-primary-button inline-flex min-h-9 items-center gap-2 px-3 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
            disabled={busy || typeof onCreateProject !== 'function'}
            onClick={onCreateProject}
            type="button"
          >
            <Plus aria-hidden="true" className="size-4" />
            New project
          </button>
        </div>
      </div>

      {status === 'loading' ? (
        <p className="cf-builder-alert cf-builder-alert-info m-4 text-sm" role="status">Loading saved projects...</p>
      ) : null}
      {status === 'refreshing' ? (
        <p className="cf-builder-alert cf-builder-alert-info mx-4 mt-3 text-sm" role="status">Refreshing saved projects...</p>
      ) : null}
      {status === 'unavailable' ? (
        <div className="cf-builder-alert cf-builder-alert-danger m-4 flex flex-col items-start gap-3 text-sm" role="alert">
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
        <p className="cf-builder-alert cf-builder-alert-danger mx-4 mt-3 text-sm" role="alert">
          Saved projects could not be refreshed. Showing the previous list.
        </p>
      ) : null}
      {(status === 'ready' || status === 'stale' || status === 'refreshing') && projects.length === 0 ? (
        <p className="cf-builder-alert cf-builder-alert-info m-4 text-sm">No saved projects yet.</p>
      ) : null}
      {projects.length > 0 ? (
        <ul className="divide-y divide-[var(--cf-border)]" aria-label="Saved projects">
          {projects.map((project) => (
            <li key={project.project_id}>
              <button
                className="cf-builder-project-row grid min-h-20 w-full grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 px-4 py-3 text-left disabled:cursor-not-allowed disabled:opacity-50"
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
                <span className="text-xs text-muted-foreground">Version {project.revision}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
