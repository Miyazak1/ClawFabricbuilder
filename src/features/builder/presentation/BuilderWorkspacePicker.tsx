import { FolderOpen, FolderPlus, Search } from 'lucide-react';

import type { BuilderWorkingProject } from '../application/builderProjectController';
import type {
  BuilderProjectCatalogItem,
  BuilderProjectWorkspaceCatalogItem,
} from '../domain/builderProjectCatalog';

export type BuilderWorkspacePickerProps = Readonly<{
  buildPrompt: boolean;
  canCreateProject: boolean;
  canOpenProject: boolean;
  canStartNewProject: boolean;
  catalogBusy: boolean;
  catalogProjects: readonly BuilderProjectCatalogItem[];
  catalogWorkspaceProjects: readonly BuilderProjectWorkspaceCatalogItem[];
  creating: boolean;
  hasSavedProject: boolean;
  newProjectTitle: string;
  onCreateProject: () => void;
  onHideNewProjectPanel: () => void;
  onNewProjectTitleChange: (title: string) => void;
  onOpenProject: (projectId: string) => void;
  onSearchChange: (search: string) => void;
  onShowNewProjectPanel: () => void;
  search: string;
  workingProject: BuilderWorkingProject | null;
}>;

function sourceFolderBoundaryLabel(folderName: string | undefined): string {
  return `Source folder: ${folderName ?? 'selected folder'}`;
}

export function BuilderWorkspacePicker({
  buildPrompt,
  canCreateProject,
  canOpenProject,
  canStartNewProject,
  catalogBusy,
  catalogProjects,
  catalogWorkspaceProjects,
  creating,
  hasSavedProject,
  newProjectTitle,
  onCreateProject,
  onHideNewProjectPanel,
  onNewProjectTitleChange,
  onOpenProject,
  onSearchChange,
  onShowNewProjectPanel,
  search,
  workingProject,
}: BuilderWorkspacePickerProps) {
  const normalizedSearch = search.trim().toLocaleLowerCase('en-US');
  const workingProjectFolderLabel = sourceFolderBoundaryLabel(workingProject?.source_folders[0]?.name);
  const showCurrentWorkingProject = workingProject !== null
    && !hasSavedProject
    && (
      normalizedSearch.length === 0
      || [
        workingProject.project_id,
        workingProject.title,
        ...workingProject.source_folders.map((folder) => folder.name),
      ].some((value) => value.toLocaleLowerCase('en-US').includes(normalizedSearch))
    );
  const visibleWorkspaceProjects = normalizedSearch.length === 0
    ? catalogProjects
    : catalogProjects.filter((project) => [
      project.title,
      project.summary,
      project.project_id,
    ].some((value) => value.toLocaleLowerCase('en-US').includes(normalizedSearch)));
  const savedProjectIds = new Set(catalogProjects.map((project) => project.project_id));
  const visibleBoundWorkspaceProjects = catalogWorkspaceProjects.filter((project) => {
    if (savedProjectIds.has(project.project_id)) return false;
    if (workingProject !== null && workingProject.project_id === project.project_id) return false;
    if (normalizedSearch.length === 0) return true;
    return [
      project.project_id,
      project.title,
      ...project.source_folders.map((folder) => folder.name),
    ].some((value) => value.toLocaleLowerCase('en-US').includes(normalizedSearch));
  });
  const showSavedProjectSection = !catalogBusy && visibleWorkspaceProjects.length > 0;
  const showBoundWorkspaceSection = !catalogBusy && visibleBoundWorkspaceProjects.length > 0;

  return (
    <div
      aria-label="Choose project"
      className="cf-builder-workspace-picker"
      data-builder-workspace-picker="true"
      role="dialog"
    >
      {creating ? (
        <div className="cf-builder-new-project-panel" data-builder-new-project-panel="true">
          <div className="cf-builder-workspace-picker-heading">
            <h2>New project</h2>
            <button
              className="cf-builder-workspace-link-button"
              onClick={onHideNewProjectPanel}
              type="button"
            >
              Back
            </button>
          </div>
          <label className="cf-builder-new-project-field">
            <span>Project name</span>
            <input
              aria-label="Project name"
              autoComplete="off"
              data-builder-new-project-title="true"
              maxLength={80}
              onChange={(event) => onNewProjectTitleChange(event.currentTarget.value)}
              value={newProjectTitle}
            />
          </label>
          <section className="cf-builder-source-folders-box" aria-label="Source folders">
            <div>
              <h3>Source folders</h3>
              <p>
                No source folder selected. Choose an empty local folder that Builder can read and edit for this project.
              </p>
            </div>
            <button
              className="cf-builder-workspace-new-project"
              data-builder-add-source-folder="true"
              disabled={!canCreateProject}
              onClick={onCreateProject}
              type="button"
            >
              <FolderPlus aria-hidden="true" className="size-3.5" />
              Add source folder
            </button>
          </section>
        </div>
      ) : (
        <>
          {buildPrompt ? (
            <p className="cf-builder-workspace-picker-note" role="status">
              Choose or create a project before I build. Add a source folder so Builder knows where it can work.
            </p>
          ) : null}
          <label className="cf-builder-workspace-search">
            <Search aria-hidden="true" className="size-3.5" />
            <input
              aria-label="Search projects"
              autoComplete="off"
              data-builder-workspace-search="true"
              disabled={catalogBusy}
              onChange={(event) => onSearchChange(event.currentTarget.value)}
              placeholder="Search projects"
              type="search"
              value={search}
            />
          </label>
          <div className="cf-builder-workspace-picker-list" role="listbox">
            {catalogBusy ? (
              <p className="cf-builder-workspace-picker-empty" role="status">
                Loading projects...
              </p>
            ) : null}
            {!catalogBusy
              && visibleWorkspaceProjects.length === 0
              && visibleBoundWorkspaceProjects.length === 0
              && !showCurrentWorkingProject ? (
              <p className="cf-builder-workspace-picker-empty">
                {catalogProjects.length === 0 && catalogWorkspaceProjects.length === 0
                  ? 'No projects yet.'
                  : 'No matching projects.'}
              </p>
            ) : null}
            {!catalogBusy && showCurrentWorkingProject ? (
              <>
                <p className="cf-builder-workspace-picker-section-label" data-builder-workspace-section="current">
                  Current project
                </p>
                <div
                  aria-selected="true"
                  className="cf-builder-workspace-project-row cf-builder-workspace-project-row-current"
                  data-builder-workspace-current-project="true"
                  role="option"
                >
                  <FolderOpen aria-hidden="true" className="size-3.5" />
                  <span className="min-w-0">
                    <span className="cf-builder-workspace-project-title">{workingProject.title}</span>
                    <span className="cf-builder-workspace-project-summary">
                      Draft workspace - {workingProjectFolderLabel}
                    </span>
                  </span>
                </div>
              </>
            ) : null}
            {showSavedProjectSection ? (
              <p className="cf-builder-workspace-picker-section-label" data-builder-workspace-section="saved">
                Saved projects
              </p>
            ) : null}
            {!catalogBusy && visibleWorkspaceProjects.map((project) => (
              <button
                className="cf-builder-workspace-project-row"
                data-builder-workspace-project={project.project_id}
                disabled={!canOpenProject}
                key={project.project_id}
                onClick={() => onOpenProject(project.project_id)}
                role="option"
                type="button"
              >
                <FolderOpen aria-hidden="true" className="size-3.5" />
                <span className="min-w-0">
                  <span className="cf-builder-workspace-project-title">{project.title}</span>
                  <span className="cf-builder-workspace-project-summary">
                    Version {project.revision_number} - {project.summary}
                  </span>
                </span>
              </button>
            ))}
            {showBoundWorkspaceSection ? (
              <p className="cf-builder-workspace-picker-section-label" data-builder-workspace-section="in-progress">
                In progress
              </p>
            ) : null}
            {!catalogBusy && visibleBoundWorkspaceProjects.map((project) => (
              <button
                className="cf-builder-workspace-project-row"
                data-builder-workspace-bound-project={project.project_id}
                disabled={!canOpenProject}
                key={project.project_id}
                onClick={() => onOpenProject(project.project_id)}
                role="option"
                type="button"
              >
                <FolderOpen aria-hidden="true" className="size-3.5" />
                <span className="min-w-0">
                  <span className="cf-builder-workspace-project-title">{project.title}</span>
                  <span className="cf-builder-workspace-project-summary">
                    Draft workspace - {sourceFolderBoundaryLabel(project.source_folders[0]?.name)}
                  </span>
                </span>
              </button>
            ))}
          </div>
          <button
            className="cf-builder-workspace-new-project"
            data-builder-workspace-new-project="true"
            disabled={!canStartNewProject}
            onClick={onShowNewProjectPanel}
            type="button"
          >
            <FolderPlus aria-hidden="true" className="size-3.5" />
            New project
          </button>
        </>
      )}
    </div>
  );
}
