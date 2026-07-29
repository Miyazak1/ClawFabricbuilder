import { useState, type KeyboardEvent } from 'react';
import {
  ArrowUp,
  ChevronDown,
  FolderOpen,
  FolderPlus,
  GitCompareArrows,
  ListChecks,
  Search,
  StopCircle,
} from 'lucide-react';

import type {
  BuilderProjectControllerStatus,
  BuilderWorkingProject,
} from '../application/builderProjectController';
import type {
  BuilderProjectCatalogItem,
  BuilderProjectWorkspaceCatalogItem,
} from '../domain/builderProjectCatalog';

type SavedComposerProject = Readonly<{
  revisionNumber: number;
  title: string;
}>;

export type BuilderComposerProps = Readonly<{
  busy: boolean;
  canAddContext: boolean;
  canCancel: boolean;
  canEditInstruction: boolean;
  canProposePlan: boolean;
  canSubmit: boolean;
  canSubmitComposer: boolean;
  catalogBusy: boolean;
  catalogProjects: readonly BuilderProjectCatalogItem[];
  catalogWorkspaceProjects: readonly BuilderProjectWorkspaceCatalogItem[];
  hasUnsavedDraft: boolean;
  instruction: string;
  onCancel?: () => void;
  onCreateProject?: (projectTitle: string) => Promise<unknown> | void;
  onDismissWorkspacePicker?: () => void;
  onFocusDraftReview?: () => void;
  onInstructionChange?: (value: string) => void;
  onOpenProject?: (projectId: string) => Promise<unknown> | void;
  onProposePlan?: () => void;
  onSteerInstruction?: () => void;
  onSubmitInstruction?: () => void;
  savedProject: SavedComposerProject | null;
  status: BuilderProjectControllerStatus;
  viewingHistory: boolean;
  workingProject: BuilderWorkingProject | null;
  workspaceNewProjectRequest?: number;
  workspacePickerRequest?: number;
}>;

function busyLabel(status: BuilderProjectControllerStatus): string {
  if (status === 'opening') return 'Opening...';
  if (status === 'submitting') return 'Working...';
  if (status === 'answering') return 'Answering...';
  if (status === 'generating') return 'Making...';
  if (status === 'restoring') return 'Restoring draft...';
  if (status === 'rejecting') return 'Discarding...';
  return 'Saving...';
}

function sourceFolderBoundaryLabel(folderName: string | undefined): string {
  return `Source folder: ${folderName ?? 'selected folder'}`;
}

export function BuilderComposer({
  busy,
  canAddContext,
  canCancel,
  canEditInstruction,
  canProposePlan,
  canSubmit,
  canSubmitComposer,
  catalogBusy,
  catalogProjects,
  catalogWorkspaceProjects,
  hasUnsavedDraft,
  instruction,
  onCancel,
  onCreateProject,
  onDismissWorkspacePicker,
  onFocusDraftReview,
  onInstructionChange,
  onOpenProject,
  onProposePlan,
  onSteerInstruction,
  onSubmitInstruction,
  savedProject,
  status,
  viewingHistory,
  workingProject,
  workspaceNewProjectRequest = 0,
  workspacePickerRequest = 0,
}: BuilderComposerProps) {
  const [workspacePickerState, setWorkspacePickerState] = useState<Readonly<{
    buildPrompt: boolean;
    createRequest: number;
    creating: boolean;
    open: boolean;
    request: number;
    search: string;
    title: string;
  }>>(() => ({
    buildPrompt: false,
    createRequest: 0,
    creating: false,
    open: false,
    request: 0,
    search: '',
    title: 'New project',
  }));
  const [workspacePickerDismissedBuildPrompt, setWorkspacePickerDismissedBuildPrompt] = useState(false);
  const pendingWorkspacePickerRequest = workspacePickerRequest > workspacePickerState.request;
  const pendingWorkspaceNewProjectRequest = workspaceNewProjectRequest > workspacePickerState.createRequest;
  const workspacePickerOpen = workspacePickerState.open
    || pendingWorkspacePickerRequest
    || pendingWorkspaceNewProjectRequest;
  const workspacePickerBuildPrompt = workspacePickerState.buildPrompt || pendingWorkspacePickerRequest;
  const workspacePickerCreating = workspacePickerState.creating || pendingWorkspaceNewProjectRequest;
  const workspaceSearch = workspacePickerState.search;
  const newProjectTitle = workspacePickerState.title;
  const canCreateProjectFromPicker = typeof onCreateProject === 'function'
    && newProjectTitle.trim().length > 0
    && !busy;
  const normalizedWorkspaceSearch = workspaceSearch.trim().toLocaleLowerCase('en-US');
  const workingProjectFolderLabel = sourceFolderBoundaryLabel(workingProject?.source_folders[0]?.name);
  const showCurrentWorkingProject = workingProject !== null
    && savedProject === null
    && (
      normalizedWorkspaceSearch.length === 0
      || [
        workingProject.project_id,
        workingProject.title,
        ...workingProject.source_folders.map((folder) => folder.name),
      ].some((value) => value.toLocaleLowerCase('en-US').includes(normalizedWorkspaceSearch))
    );
  const visibleWorkspaceProjects = normalizedWorkspaceSearch.length === 0
    ? catalogProjects
    : catalogProjects.filter((project) => [
      project.title,
      project.summary,
      project.project_id,
    ].some((value) => value.toLocaleLowerCase('en-US').includes(normalizedWorkspaceSearch)));
  const savedProjectIds = new Set(catalogProjects.map((project) => project.project_id));
  const visibleBoundWorkspaceProjects = catalogWorkspaceProjects.filter((project) => {
    if (savedProjectIds.has(project.project_id)) return false;
    if (workingProject !== null && workingProject.project_id === project.project_id) return false;
    if (normalizedWorkspaceSearch.length === 0) return true;
    return [
      project.project_id,
      project.title,
      ...project.source_folders.map((folder) => folder.name),
    ].some((value) => value.toLocaleLowerCase('en-US').includes(normalizedWorkspaceSearch));
  });
  const showSavedProjectSection = !catalogBusy && visibleWorkspaceProjects.length > 0;
  const showBoundWorkspaceSection = !catalogBusy && visibleBoundWorkspaceProjects.length > 0;
  const workspaceLabel = savedProject !== null
    ? savedProject.title
    : workingProject !== null
      ? workingProject.title
      : 'Choose project';
  const workspaceDetail = savedProject !== null
    ? `Version ${savedProject.revisionNumber}`
    : workingProject !== null
      ? sourceFolderBoundaryLabel(workingProject.source_folders[0]?.name)
      : 'Chat only until you choose a folder';
  const composerStatusLabel = (() => {
    if (canAddContext) return 'Add context';
    if (status === 'submitting') return 'Working';
    if (status === 'generating') return 'Making your draft';
    if (status === 'answering') return 'Answering';
    if (status === 'restoring') return 'Restoring draft';
    if (viewingHistory) return 'Viewing a saved version';
    if (hasUnsavedDraft) return 'Continue this draft';
    return null;
  })();
  const composerPlaceholder = (() => {
    if (hasUnsavedDraft) return 'Ask about this draft, or describe the next change...';
    if (canAddContext) return 'Add context for the current work...';
    if (busy) return 'Working on your request...';
    return 'Ask a question, or describe what to build or change...';
  })();

  function closeWorkspacePicker(
    options: Readonly<{
      keepPendingBuild?: boolean;
      showDismissedBuildNote?: boolean;
    }> = Object.freeze({}),
  ): void {
    if (options.keepPendingBuild !== true) onDismissWorkspacePicker?.();
    if (workspacePickerBuildPrompt && options.showDismissedBuildNote === true) {
      setWorkspacePickerDismissedBuildPrompt(true);
    }
    setWorkspacePickerState((picker) => ({
      ...picker,
      buildPrompt: false,
      createRequest: workspaceNewProjectRequest,
      creating: false,
      open: false,
      request: workspacePickerRequest,
    }));
  }

  function toggleWorkspacePicker(): void {
    if (busy && !canAddContext) return;
    if (workspacePickerOpen) {
      closeWorkspacePicker({ showDismissedBuildNote: true });
      return;
    }
    setWorkspacePickerDismissedBuildPrompt(false);
    setWorkspacePickerState((picker) => ({
      ...picker,
      buildPrompt: false,
      createRequest: workspaceNewProjectRequest,
      creating: false,
      open: true,
      request: workspacePickerRequest,
    }));
  }

  function showNewProjectPanel(): void {
    setWorkspacePickerDismissedBuildPrompt(false);
    setWorkspacePickerState((picker) => ({
      ...picker,
      createRequest: workspaceNewProjectRequest,
      creating: true,
      open: true,
      request: workspacePickerRequest,
      search: '',
    }));
  }

  function hideNewProjectPanel(): void {
    setWorkspacePickerState((picker) => ({
      ...picker,
      createRequest: workspaceNewProjectRequest,
      creating: false,
      open: true,
      request: workspacePickerRequest,
    }));
  }

  function createProjectFromPicker(): void {
    if (!canCreateProjectFromPicker) return;
    const projectTitle = newProjectTitle.trim();
    setWorkspacePickerDismissedBuildPrompt(false);
    closeWorkspacePicker({ keepPendingBuild: true });
    void onCreateProject?.(projectTitle);
  }

  function openProjectFromPicker(projectId: string): void {
    setWorkspacePickerDismissedBuildPrompt(false);
    closeWorkspacePicker();
    void onOpenProject?.(projectId);
  }

  function changeInstruction(value: string): void {
    setWorkspacePickerDismissedBuildPrompt(false);
    onInstructionChange?.(value);
  }

  function submitPrimaryComposerCommand(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (
      event.key !== 'Enter'
      || event.shiftKey
      || event.altKey
      || event.ctrlKey
      || event.metaKey
      || event.nativeEvent.isComposing
      || !canSubmitComposer
    ) {
      return;
    }
    event.preventDefault();
    if (canSubmit) onSubmitInstruction?.();
    else onSteerInstruction?.();
  }

  return (
    <section
      aria-label="Conversation command"
      className="cf-builder-composer-card"
      data-builder-composer="true"
      data-builder-composer-state={hasUnsavedDraft ? 'draft-ready' : 'ready'}
    >
      <div className="cf-builder-composer-shell">
        <textarea
          aria-label="Ask a question, or describe what to build or change"
          className="cf-builder-input cf-builder-composer-textarea w-full resize-none text-sm"
          disabled={busy && !canAddContext}
          id="builder-idea"
          maxLength={4000}
          onChange={(event) => changeInstruction(event.currentTarget.value)}
          onKeyDown={submitPrimaryComposerCommand}
          placeholder={composerPlaceholder}
          readOnly={!canEditInstruction}
          aria-keyshortcuts={canSubmitComposer ? 'Enter' : undefined}
          value={instruction}
        />
        <footer className="cf-builder-composer-footer">
          <div className="cf-builder-composer-tools">
            <button
              aria-expanded={workspacePickerOpen}
              aria-haspopup="dialog"
              className="cf-builder-workspace-chip"
              data-builder-workspace-chip="true"
              disabled={busy && !canAddContext}
              onClick={toggleWorkspacePicker}
              title={workspaceLabel}
              type="button"
            >
              <FolderOpen aria-hidden="true" className="size-3.5" />
              <span className="cf-builder-workspace-chip-copy">
                <span className="cf-builder-workspace-chip-label">{workspaceLabel}</span>
                <span className="cf-builder-workspace-chip-detail">{workspaceDetail}</span>
              </span>
              <ChevronDown aria-hidden="true" className="size-3.5" />
            </button>
            {composerStatusLabel === null ? null : (
              <span className="cf-builder-status-pill" data-builder-composer-status="true">
                {composerStatusLabel}
              </span>
            )}
            {canProposePlan ? (
              <button
                className="cf-builder-composer-tool-button"
                data-builder-propose-plan="true"
                onClick={onProposePlan}
                title="Plan first"
                type="button"
              >
                <ListChecks aria-hidden="true" className="size-3.5" />
                Plan first
              </button>
            ) : null}
          </div>
          <div className="cf-builder-composer-actions">
            {canCancel ? (
              <button
                aria-label="Stop"
                className="cf-builder-secondary-button cf-builder-send-button inline-flex min-h-10 min-w-10 items-center justify-center"
                data-builder-cancel-work="true"
                onClick={onCancel}
                title="Stop"
                type="button"
              >
                <StopCircle aria-hidden="true" className="size-4" />
              </button>
            ) : null}
            {busy && !canAddContext ? null : (
              <button
                aria-label={canAddContext ? 'Add context' : busy ? busyLabel(status) : 'Send'}
                className="cf-builder-primary-button cf-builder-send-button inline-flex min-h-10 min-w-10 items-center justify-center disabled:cursor-not-allowed disabled:opacity-50"
                data-builder-submit-turn="true"
                disabled={!canSubmitComposer}
                onClick={canSubmit ? onSubmitInstruction : onSteerInstruction}
                title={canAddContext ? 'Add context' : busy ? busyLabel(status) : 'Send'}
                type="button"
              >
                <ArrowUp aria-hidden="true" className="size-4" />
              </button>
            )}
          </div>
        </footer>
        {hasUnsavedDraft ? (
          <div
            className="cf-builder-composer-review-gate"
            data-builder-composer-review-gate="true"
            role="status"
          >
            <span>Keep revising here, or review and save this version when ready.</span>
            <button
              className="cf-builder-composer-review-link"
              data-builder-composer-review-focus="true"
              onClick={onFocusDraftReview}
              type="button"
            >
              <GitCompareArrows aria-hidden="true" className="size-3.5" />
              Review draft
            </button>
          </div>
        ) : null}
        {workspacePickerOpen ? (
          <div
            aria-label="Choose project"
            className="cf-builder-workspace-picker"
            data-builder-workspace-picker="true"
            role="dialog"
          >
            {workspacePickerCreating ? (
              <div className="cf-builder-new-project-panel" data-builder-new-project-panel="true">
                <div className="cf-builder-workspace-picker-heading">
                  <h2>New project</h2>
                  <button
                    className="cf-builder-workspace-link-button"
                    onClick={hideNewProjectPanel}
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
                    onChange={(event) => {
                      const nextTitle = event.currentTarget.value;
                      setWorkspacePickerState((picker) => ({
                        ...picker,
                        title: nextTitle,
                      }));
                    }}
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
                    disabled={!canCreateProjectFromPicker}
                    onClick={createProjectFromPicker}
                    type="button"
                  >
                    <FolderPlus aria-hidden="true" className="size-3.5" />
                    Add source folder
                  </button>
                </section>
              </div>
            ) : (
              <>
                {workspacePickerBuildPrompt ? (
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
                    onChange={(event) => {
                      const nextSearch = event.currentTarget.value;
                      setWorkspacePickerState((picker) => ({
                        ...picker,
                        search: nextSearch,
                      }));
                    }}
                    placeholder="Search projects"
                    type="search"
                    value={workspaceSearch}
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
                      disabled={typeof onOpenProject !== 'function'}
                      key={project.project_id}
                      onClick={() => openProjectFromPicker(project.project_id)}
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
                      disabled={typeof onOpenProject !== 'function'}
                      key={project.project_id}
                      onClick={() => openProjectFromPicker(project.project_id)}
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
                  disabled={typeof onCreateProject !== 'function' || catalogBusy}
                  onClick={showNewProjectPanel}
                  type="button"
                >
                  <FolderPlus aria-hidden="true" className="size-3.5" />
                  New project
                </button>
              </>
            )}
          </div>
        ) : null}
        {workspacePickerDismissedBuildPrompt ? (
          <p
            className="cf-builder-composer-note"
            data-builder-workspace-dismissed-build-note="true"
            role="status"
          >
            Choose a project folder when you're ready to build. Your text is still here.
          </p>
        ) : null}
      </div>
    </section>
  );
}
