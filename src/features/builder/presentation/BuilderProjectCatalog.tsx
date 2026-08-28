import { useState, type FormEvent } from 'react';
import { Archive, FolderOpen, MoreVertical, Pencil, Plus, RefreshCw, X } from 'lucide-react';

import {
  isTrustedBuilderProjectCatalogSnapshot,
  type BuilderProjectCatalogSnapshot,
} from '../application/builderProjectCatalogController';

export type BuilderProjectCatalogProps = Readonly<{
  snapshot: BuilderProjectCatalogSnapshot;
  onArchiveProject?: (projectId: string) => Promise<unknown> | void;
  onOpenProject?: (projectId: string) => void;
  onCreateProject?: () => void;
  onRefresh?: () => void;
  onRenameProject?: (projectId: string, title: string) => Promise<unknown> | void;
}>;

function sourceFolderBoundaryLabel(folderName: string | undefined): string {
  return `Source folder: ${folderName ?? 'selected folder'}`;
}

export function BuilderProjectCatalog({
  snapshot,
  onArchiveProject,
  onOpenProject,
  onCreateProject,
  onRefresh,
  onRenameProject,
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
      </div>

      <div className="cf-builder-catalog-command">
        <button
          className="cf-builder-primary-button cf-builder-command-button inline-flex min-h-9 w-full items-center justify-center gap-2 px-3 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
          data-builder-catalog-new-project="true"
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
        <div className="cf-builder-alert cf-builder-alert-danger m-3 flex flex-col items-start gap-3 text-sm" role="alert">
          <p>Saved projects could not be refreshed. Showing the previous list.</p>
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
      {(status === 'ready' || status === 'stale' || status === 'refreshing')
      && projects.length === 0
      && workspaceProjects.length === 0 ? (
        <p className="cf-builder-alert cf-builder-alert-info m-3 text-sm">No saved projects yet.</p>
      ) : null}
      {projects.length > 0 ? (
        <ul className="cf-builder-project-list" aria-label="Saved projects">
          {projects.map((project) => (
            <BuilderProjectCatalogRow
              badge={`Version ${project.revision_number}`}
              busy={busy}
              key={project.project_id}
              onArchiveProject={onArchiveProject}
              onOpenProject={onOpenProject}
              onRenameProject={onRenameProject}
              projectId={project.project_id}
              rowKind="saved"
              summary={project.summary}
              title={project.title}
            />
          ))}
        </ul>
      ) : null}
      {workspaceProjects.length > 0 ? (
        <div className="cf-builder-workspace-catalog" data-builder-workspace-catalog="true">
          <p className="cf-builder-catalog-section-label">In progress</p>
          <ul className="cf-builder-project-list" aria-label="Unsaved projects">
            {workspaceProjects.map((project) => (
              <BuilderProjectCatalogRow
                badge="Draft"
                busy={busy}
                key={project.project_id}
                onArchiveProject={onArchiveProject}
                onOpenProject={onOpenProject}
                onRenameProject={onRenameProject}
                projectId={project.project_id}
                rowKind="workspace"
                summary={sourceFolderBoundaryLabel(project.source_folders[0]?.name)}
                title={project.title}
              />
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function BuilderProjectCatalogRow({
  badge,
  busy,
  onArchiveProject,
  onOpenProject,
  onRenameProject,
  projectId,
  rowKind,
  summary,
  title,
}: Readonly<{
  badge: string;
  busy: boolean;
  onArchiveProject?: (projectId: string) => Promise<unknown> | void;
  onOpenProject?: (projectId: string) => void;
  onRenameProject?: (projectId: string, title: string) => Promise<unknown> | void;
  projectId: string;
  rowKind: 'saved' | 'workspace';
  summary: string;
  title: string;
}>) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draftTitle, setDraftTitle] = useState(title);
  const canRename = typeof onRenameProject === 'function';
  const canArchive = typeof onArchiveProject === 'function';
  const showActions = canRename || canArchive;
  const openDataAttribute = rowKind === 'saved'
    ? { 'data-builder-project-id': projectId }
    : { 'data-builder-workspace-catalog-project': projectId };

  function submitRename(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const nextTitle = draftTitle.trim();
    if (!canRename || nextTitle.length === 0 || nextTitle === title) {
      setRenaming(false);
      setMenuOpen(false);
      setDraftTitle(title);
      return;
    }
    void onRenameProject(projectId, nextTitle);
    setRenaming(false);
    setMenuOpen(false);
  }

  return (
    <li
      data-builder-project-catalog-row={rowKind}
      data-builder-project-lifecycle-target={projectId}
    >
      {renaming ? (
        <form
          className="cf-builder-project-rename-form"
          data-builder-project-rename-form={projectId}
          onSubmit={submitRename}
        >
          <FolderOpen aria-hidden="true" className="mt-0.5 size-4" />
          <input
            aria-label="Project name"
            className="cf-builder-input"
            data-builder-project-rename-input={projectId}
            onChange={(event) => setDraftTitle(event.currentTarget.value)}
            value={draftTitle}
          />
          <span className="cf-builder-project-rename-actions">
            <button
              className="cf-builder-secondary-button"
              data-builder-project-rename-cancel={projectId}
              onClick={() => {
                setDraftTitle(title);
                setRenaming(false);
              }}
              type="button"
            >
              <X aria-hidden="true" className="size-3.5" />
              Cancel
            </button>
            <button
              className="cf-builder-primary-button"
              data-builder-project-rename-save={projectId}
              disabled={draftTitle.trim().length === 0}
              type="submit"
            >
              Save
            </button>
          </span>
        </form>
      ) : (
        <div className="cf-builder-project-row-wrap">
          <button
            className="cf-builder-project-row grid min-h-16 w-full grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 px-4 py-3 text-left disabled:cursor-not-allowed disabled:opacity-50"
            disabled={busy || typeof onOpenProject !== 'function'}
            onClick={() => onOpenProject?.(projectId)}
            type="button"
            {...openDataAttribute}
          >
            <FolderOpen aria-hidden="true" className="mt-0.5 size-4" />
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{title}</span>
              <span className="mt-1 block line-clamp-2 text-xs text-muted-foreground">
                {summary}
              </span>
            </span>
            <span className="text-xs text-muted-foreground">{badge}</span>
          </button>
          {showActions ? (
            <span className="cf-builder-project-row-actions">
              <button
                aria-expanded={menuOpen}
                aria-haspopup="menu"
                aria-label={`Project actions for ${title}`}
                className="cf-builder-project-action-button"
                data-builder-project-actions={projectId}
                onClick={() => setMenuOpen((open) => !open)}
                title="Project actions"
                type="button"
              >
                <MoreVertical aria-hidden="true" className="size-3.5" />
              </button>
              {menuOpen ? (
                <span
                  className="cf-builder-project-action-menu"
                  data-builder-project-action-menu={projectId}
                  role="menu"
                >
                  {canRename ? (
                    <button
                      data-builder-project-rename={projectId}
                      onClick={() => {
                        setDraftTitle(title);
                        setRenaming(true);
                        setMenuOpen(false);
                      }}
                      role="menuitem"
                      type="button"
                    >
                      <Pencil aria-hidden="true" className="size-3.5" />
                      Rename
                    </button>
                  ) : null}
                  {canArchive ? (
                    <button
                      data-builder-project-archive={projectId}
                      onClick={() => {
                        setMenuOpen(false);
                        void onArchiveProject(projectId);
                      }}
                      role="menuitem"
                      type="button"
                    >
                      <Archive aria-hidden="true" className="size-3.5" />
                      Archive
                    </button>
                  ) : null}
                </span>
              ) : null}
            </span>
          ) : null}
        </div>
      )}
    </li>
  );
}
