import { useState, type KeyboardEvent } from 'react';
import {
  ArrowUp,
  ChevronDown,
  FolderOpen,
  GitCompareArrows,
  ListChecks,
  Plus,
  StopCircle,
  X,
} from 'lucide-react';

import type {
  BuilderComposerRouteDecision,
  BuilderComposerRouteDecisionEvidence,
} from '../application/builderComposerIntent';
import type {
  BuilderProjectControllerStatus,
  BuilderWorkingProject,
} from '../application/builderProjectController';
import type {
  BuilderProjectCatalogItem,
  BuilderProjectWorkspaceCatalogItem,
} from '../domain/builderProjectCatalog';
import { BuilderWorkspacePicker } from './BuilderWorkspacePicker';

type SavedComposerProject = Readonly<{
  revisionNumber: number;
  title: string;
}>;

export type BuilderComposerContextStatus = 'ready_to_build' | null;

export type BuilderComposerWorkingBrief = Readonly<{
  key: string;
  label: string;
  summary: string;
}>;

export type BuilderComposerMode = 'plan';

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
  composerRouteDecision?: BuilderComposerRouteDecision | BuilderComposerRouteDecisionEvidence | null;
  composerContextStatus?: BuilderComposerContextStatus;
  composerMode?: BuilderComposerMode | null;
  composerWorkingBrief?: BuilderComposerWorkingBrief | null;
  hasUnsavedDraft: boolean;
  instruction: string;
  onCancel?: () => void;
  onCreateProject?: (projectTitle: string) => Promise<unknown> | void;
  onClearComposerWorkingBrief?: (key: string) => void;
  onClearComposerMode?: () => void;
  onDismissWorkspacePicker?: () => void;
  onFocusDraftReview?: () => void;
  onInstructionChange?: (value: string) => void;
  onOpenProject?: (projectId: string) => Promise<unknown> | void;
  onSelectPlanMode?: () => void;
  onSteerInstruction?: () => void;
  onSubmitInstruction?: () => void;
  savedProject: SavedComposerProject | null;
  status: BuilderProjectControllerStatus;
  viewingHistory: boolean;
  workingProject: BuilderWorkingProject | null;
  workspaceNewProjectRequest?: number;
  workspacePickerRequest?: number;
}>;

function routeDecisionEvidence(
  decision: BuilderComposerRouteDecision | BuilderComposerRouteDecisionEvidence | null,
): BuilderComposerRouteDecisionEvidence | null {
  return decision !== null && 'decisionId' in decision ? decision : null;
}

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
  composerContextStatus = null,
  composerMode = null,
  composerRouteDecision = null,
  composerWorkingBrief = null,
  hasUnsavedDraft,
  instruction,
  onCancel,
  onClearComposerMode,
  onClearComposerWorkingBrief,
  onCreateProject,
  onDismissWorkspacePicker,
  onFocusDraftReview,
  onInstructionChange,
  onOpenProject,
  onSelectPlanMode,
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
  const [addMenuOpen, setAddMenuOpen] = useState(false);
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
    if (composerContextStatus === 'ready_to_build') return 'Ready to build';
    return null;
  })();
  const composerRouteEvidence = routeDecisionEvidence(composerRouteDecision);
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

  function toggleAddMenu(): void {
    if (busy && !canAddContext) return;
    setAddMenuOpen((open) => !open);
  }

  function openFilesAndFoldersFromAddMenu(): void {
    setAddMenuOpen(false);
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

  function selectPlanMode(): void {
    if (!canProposePlan) return;
    setAddMenuOpen(false);
    onSelectPlanMode?.();
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
      data-builder-route-confidence={composerRouteDecision?.confidence}
      data-builder-route-created-at={composerRouteEvidence?.createdAt}
      data-builder-route-decision-id={composerRouteEvidence?.decisionId}
      data-builder-route-dispatch={composerRouteDecision?.dispatch}
      data-builder-route-downgrade={composerRouteDecision?.downgradeReason ?? undefined}
      data-builder-route-message-id={composerRouteEvidence?.messageId}
      data-builder-route-permission={composerRouteDecision?.permissionResult}
      data-builder-route-project-id={composerRouteEvidence?.projectId ?? undefined}
      data-builder-route-signals={composerRouteDecision?.matchedSignals.join(',')}
      data-builder-route-task-id={composerRouteEvidence?.taskId ?? undefined}
      data-builder-route={composerRouteDecision?.route}
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
            <div className="cf-builder-composer-add-menu-wrap">
              <button
                aria-expanded={addMenuOpen}
                aria-haspopup="menu"
                aria-label="Add context"
                className="cf-builder-composer-add-button"
                data-builder-composer-add-menu-button="true"
                disabled={busy && !canAddContext}
                onClick={toggleAddMenu}
                title="Add context"
                type="button"
              >
                <Plus aria-hidden="true" className="size-3.5" />
              </button>
              {addMenuOpen ? (
                <div
                  className="cf-builder-composer-add-menu"
                  data-builder-composer-add-menu="true"
                  role="menu"
                >
                  <button
                    data-builder-composer-add-files="true"
                    onClick={openFilesAndFoldersFromAddMenu}
                    role="menuitem"
                    type="button"
                  >
                    <FolderOpen aria-hidden="true" className="size-3.5" />
                    Files and folders
                  </button>
                  <button
                    data-builder-composer-add-brief="true"
                    disabled
                    role="menuitem"
                    type="button"
                  >
                    <ListChecks aria-hidden="true" className="size-3.5" />
                    Goal / Brief
                  </button>
                  <button
                    data-builder-composer-add-plan-mode="true"
                    disabled={!canProposePlan}
                    onClick={selectPlanMode}
                    role="menuitem"
                    type="button"
                  >
                    <ListChecks aria-hidden="true" className="size-3.5" />
                    Plan mode
                  </button>
                  <button
                    data-builder-composer-add-approval-mode="true"
                    disabled
                    role="menuitem"
                    type="button"
                  >
                    <GitCompareArrows aria-hidden="true" className="size-3.5" />
                    Approval mode
                  </button>
                </div>
              ) : null}
            </div>
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
            {composerMode === 'plan' ? (
              <span className="cf-builder-composer-mode-chip" data-builder-composer-mode-chip="plan">
                <ListChecks aria-hidden="true" className="size-3.5" />
                Plan mode
                {typeof onClearComposerMode === 'function' ? (
                  <button
                    aria-label="Remove Plan mode"
                    data-builder-clear-composer-mode="true"
                    onClick={onClearComposerMode}
                    title="Remove Plan mode"
                    type="button"
                  >
                    <X aria-hidden="true" className="size-3" />
                  </button>
                ) : null}
              </span>
            ) : null}
            {canProposePlan && composerMode !== 'plan' ? (
              <button
                className="cf-builder-composer-tool-button"
                data-builder-propose-plan="true"
                onClick={selectPlanMode}
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
        {!hasUnsavedDraft && composerWorkingBrief !== null ? (
          <div
            className="cf-builder-composer-brief"
            data-builder-composer-brief="true"
          >
            <div className="cf-builder-composer-brief-copy">
              <span className="cf-builder-composer-brief-label">{composerWorkingBrief.label}</span>
              <p className="cf-builder-composer-brief-summary">{composerWorkingBrief.summary}</p>
            </div>
            {typeof onClearComposerWorkingBrief === 'function' ? (
              <button
                aria-label="Clear current brief"
                className="cf-builder-composer-brief-clear"
                data-builder-clear-composer-brief="true"
                onClick={() => onClearComposerWorkingBrief(composerWorkingBrief.key)}
                title="Clear current brief"
                type="button"
              >
                <X aria-hidden="true" className="size-3.5" />
                Clear
              </button>
            ) : null}
          </div>
        ) : null}
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
          <BuilderWorkspacePicker
            buildPrompt={workspacePickerBuildPrompt}
            canCreateProject={canCreateProjectFromPicker}
            canOpenProject={typeof onOpenProject === 'function'}
            canStartNewProject={typeof onCreateProject === 'function' && !catalogBusy}
            catalogBusy={catalogBusy}
            catalogProjects={catalogProjects}
            catalogWorkspaceProjects={catalogWorkspaceProjects}
            creating={workspacePickerCreating}
            hasSavedProject={savedProject !== null}
            newProjectTitle={newProjectTitle}
            onCreateProject={createProjectFromPicker}
            onHideNewProjectPanel={hideNewProjectPanel}
            onNewProjectTitleChange={(nextTitle) => {
              setWorkspacePickerState((picker) => ({
                ...picker,
                title: nextTitle,
              }));
            }}
            onOpenProject={openProjectFromPicker}
            onSearchChange={(nextSearch) => {
              setWorkspacePickerState((picker) => ({
                ...picker,
                search: nextSearch,
              }));
            }}
            onShowNewProjectPanel={showNewProjectPanel}
            search={workspaceSearch}
            workingProject={workingProject}
          />
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
