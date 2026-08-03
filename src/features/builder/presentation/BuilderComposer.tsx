import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import {
  ArrowUp,
  ChevronDown,
  FolderOpen,
  GitCompareArrows,
  ListChecks,
  Plus,
  ShieldCheck,
  StopCircle,
  X,
} from 'lucide-react';

import type {
  BuilderComposerApprovalMode,
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

export type { BuilderComposerApprovalMode } from '../application/builderComposerIntent';

type SavedComposerProject = Readonly<{
  revisionNumber: number;
  title: string;
}>;

export type BuilderComposerContextStatus = 'ready_to_build' | null;

export type BuilderComposerWorkingBrief = Readonly<{
  key: string;
  label: string;
  summary: string;
  taskId: string | null;
}>;

export type BuilderComposerMode = 'plan';

export type BuilderComposerProps = Readonly<{
  activeAnswerBuildBlocked?: boolean;
  approvalMode?: BuilderComposerApprovalMode;
  busy: boolean;
  canAddContext: boolean;
  canAllowCurrentProjectApproval?: boolean;
  canCancel: boolean;
  canEditInstruction: boolean;
  canProposePlan: boolean;
  canSubmitComposer: boolean;
  catalogBusy: boolean;
  catalogProjects: readonly BuilderProjectCatalogItem[];
  catalogWorkspaceProjects: readonly BuilderProjectWorkspaceCatalogItem[];
  composerRouteDecision?: BuilderComposerRouteDecision | BuilderComposerRouteDecisionEvidence | null;
  composerContextStatus?: BuilderComposerContextStatus;
  composerMode?: BuilderComposerMode | null;
  hasUnsavedDraft: boolean;
  instruction: string;
  onCancel?: () => void;
  onCreateProject?: (projectTitle: string) => Promise<unknown> | void;
  onClearComposerMode?: () => void;
  onDismissWorkspacePicker?: () => void;
  onFocusDraftReview?: () => void;
  onInstructionChange?: (value: string) => void;
  onOpenProject?: (projectId: string) => Promise<unknown> | void;
  onSelectApprovalMode?: (mode: BuilderComposerApprovalMode) => Promise<unknown> | void;
  onSelectBriefMode?: () => void;
  onSelectPlanMode?: () => void;
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

function approvalModeLabel(mode: BuilderComposerApprovalMode): string {
  if (mode === 'read_only_chat') return 'Read-only chat';
  if (mode === 'allow_current_project') return 'Allow current project';
  return 'Ask before write';
}

export function BuilderComposer({
  activeAnswerBuildBlocked = false,
  approvalMode = 'ask_before_write',
  busy,
  canAddContext,
  canAllowCurrentProjectApproval = false,
  canCancel,
  canEditInstruction,
  canProposePlan,
  canSubmitComposer,
  catalogBusy,
  catalogProjects,
  catalogWorkspaceProjects,
  composerContextStatus = null,
  composerMode = null,
  composerRouteDecision = null,
  hasUnsavedDraft,
  instruction,
  onCancel,
  onClearComposerMode,
  onCreateProject,
  onDismissWorkspacePicker,
  onFocusDraftReview,
  onInstructionChange,
  onOpenProject,
  onSelectApprovalMode,
  onSelectBriefMode,
  onSelectPlanMode,
  onSubmitInstruction,
  savedProject,
  status,
  viewingHistory,
  workingProject,
  workspaceNewProjectRequest = 0,
  workspacePickerRequest = 0,
}: BuilderComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const restoreComposerFocusAfterSubmitRef = useRef(false);
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
  const hasInstruction = instruction.trim().length > 0;
  const showSubmitAction = !busy || (canAddContext && hasInstruction);
  const showCancelAction = !showSubmitAction && canCancel;
  const showBusyAction = busy && !showSubmitAction && !showCancelAction;

  useEffect(() => {
    if (!restoreComposerFocusAfterSubmitRef.current) return;
    if (busy && !canAddContext) return;
    if (!canEditInstruction) return;
    restoreComposerFocusAfterSubmitRef.current = false;
    textareaRef.current?.focus({ preventScroll: true });
  }, [busy, canAddContext, canEditInstruction, instruction]);

  function requestComposerFocusAfterSubmit(): void {
    restoreComposerFocusAfterSubmitRef.current = true;
    window.setTimeout(() => {
      if (!restoreComposerFocusAfterSubmitRef.current) return;
      if (busy && !canAddContext) return;
      if (!canEditInstruction) return;
      restoreComposerFocusAfterSubmitRef.current = false;
      textareaRef.current?.focus({ preventScroll: true });
    }, 0);
  }

  function keepComposerFocusDuringPointerSubmit(event: MouseEvent<HTMLButtonElement>): void {
    if (canSubmitComposer) event.preventDefault();
  }

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

  useEffect(() => {
    if (!addMenuOpen && !workspacePickerOpen) return undefined;
    function closeFloatingPanels(event: PointerEvent): void {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (
        addMenuOpen
        && target.closest('[data-builder-composer-add-menu="true"], [data-builder-composer-add-menu-button="true"]')
          === null
      ) {
        setAddMenuOpen(false);
      }
      if (
        workspacePickerOpen
        && target.closest('[data-builder-workspace-picker="true"], [data-builder-workspace-chip="true"]') === null
      ) {
        onDismissWorkspacePicker?.();
        if (workspacePickerBuildPrompt) setWorkspacePickerDismissedBuildPrompt(true);
        setWorkspacePickerState((picker) => ({
          ...picker,
          buildPrompt: false,
          createRequest: workspaceNewProjectRequest,
          creating: false,
          open: false,
          request: workspacePickerRequest,
        }));
      }
    }
    document.addEventListener('pointerdown', closeFloatingPanels);
    return () => document.removeEventListener('pointerdown', closeFloatingPanels);
  }, [
    addMenuOpen,
    onDismissWorkspacePicker,
    workspaceNewProjectRequest,
    workspacePickerBuildPrompt,
    workspacePickerOpen,
    workspacePickerRequest,
  ]);

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

  function selectBriefMode(): void {
    setAddMenuOpen(false);
    onSelectBriefMode?.();
  }

  function selectApprovalMode(mode: BuilderComposerApprovalMode): void {
    if (typeof onSelectApprovalMode !== 'function') return;
    if (mode === 'allow_current_project' && !canAllowCurrentProjectApproval) return;
    setAddMenuOpen(false);
    void onSelectApprovalMode(mode);
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
    onSubmitInstruction?.();
    requestComposerFocusAfterSubmit();
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
          ref={textareaRef}
          aria-keyshortcuts={canSubmitComposer ? 'Enter' : undefined}
          value={instruction}
        />
        {activeAnswerBuildBlocked ? (
          <p
            className="cf-builder-composer-busy-build-notice"
            data-builder-active-answer-build-blocked="true"
            data-builder-active-answer-build-queued="true"
          >
            I&apos;m still answering. This change is queued and will start after the answer finishes.
          </p>
        ) : null}
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
                    onClick={selectBriefMode}
                    role="menuitem"
                    type="button"
                  >
                    <ListChecks aria-hidden="true" className="size-3.5" />
                    Brief
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
                  <div className="cf-builder-composer-add-menu-label">Approval mode</div>
                  <button
                    aria-checked={approvalMode === 'read_only_chat'}
                    data-builder-composer-approval-mode-option="read_only_chat"
                    onClick={() => selectApprovalMode('read_only_chat')}
                    role="menuitemradio"
                    type="button"
                  >
                    <ShieldCheck aria-hidden="true" className="size-3.5" />
                    Read-only chat
                  </button>
                  <button
                    aria-checked={approvalMode === 'ask_before_write'}
                    data-builder-composer-approval-mode-option="ask_before_write"
                    onClick={() => selectApprovalMode('ask_before_write')}
                    role="menuitemradio"
                    type="button"
                  >
                    <GitCompareArrows aria-hidden="true" className="size-3.5" />
                    Approval mode
                    <span className="cf-builder-composer-add-menu-hint">Ask before write</span>
                  </button>
                  <button
                    aria-checked={approvalMode === 'allow_current_project'}
                    data-builder-composer-approval-mode-option="allow_current_project"
                    disabled={!canAllowCurrentProjectApproval}
                    onClick={() => selectApprovalMode('allow_current_project')}
                    role="menuitemradio"
                    title={canAllowCurrentProjectApproval
                      ? 'Allow draft preparation in the current project'
                      : 'Choose a project before allowing current project writes'}
                    type="button"
                  >
                    <ShieldCheck aria-hidden="true" className="size-3.5" />
                    Allow current project
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
            <span
              className="cf-builder-approval-mode-chip"
              data-builder-approval-mode={approvalMode}
              data-builder-approval-mode-chip="true"
              title={approvalModeLabel(approvalMode)}
            >
              <ShieldCheck aria-hidden="true" className="size-3.5" />
              {approvalModeLabel(approvalMode)}
            </span>
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
          </div>
          <div className="cf-builder-composer-actions">
            {showSubmitAction ? (
              <button
                aria-label={canAddContext ? 'Add context' : busy ? busyLabel(status) : 'Send'}
                className="cf-builder-primary-button cf-builder-send-button inline-flex min-h-10 min-w-10 items-center justify-center disabled:cursor-not-allowed disabled:opacity-50"
                data-builder-composer-primary-action="true"
                data-builder-submit-turn="true"
                disabled={!canSubmitComposer}
                onClick={() => {
                  onSubmitInstruction?.();
                  requestComposerFocusAfterSubmit();
                }}
                onMouseDown={keepComposerFocusDuringPointerSubmit}
                title={canAddContext ? 'Add context' : busy ? busyLabel(status) : 'Send'}
                type="button"
              >
                <ArrowUp aria-hidden="true" className="size-4" />
              </button>
            ) : null}
            {showCancelAction ? (
              <button
                aria-label="Stop"
                className="cf-builder-primary-button cf-builder-send-button inline-flex min-h-10 min-w-10 items-center justify-center disabled:cursor-not-allowed disabled:opacity-50"
                data-builder-cancel-work="true"
                data-builder-composer-primary-action="true"
                onClick={onCancel}
                title="Stop"
                type="button"
              >
                <StopCircle aria-hidden="true" className="size-4" />
              </button>
            ) : null}
            {showBusyAction ? (
              <button
                aria-label={busyLabel(status)}
                className="cf-builder-primary-button cf-builder-send-button inline-flex min-h-10 min-w-10 items-center justify-center disabled:cursor-not-allowed disabled:opacity-50"
                data-builder-busy-work="true"
                data-builder-composer-primary-action="true"
                disabled
                title={busyLabel(status)}
                type="button"
              >
                <StopCircle aria-hidden="true" className="size-4" />
              </button>
            ) : null}
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
