import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import {
  Archive,
  ArrowUp,
  Bot,
  ChevronDown,
  GitCompareArrows,
  Hammer,
  ListChecks,
  Pause,
  Play,
  Plus,
  Settings,
  ShieldCheck,
  Sparkles,
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
} from '../application/builderProjectController';
import type { BuilderComposerContextStatus } from '../domain/builderContextStatusProjection';
import type { BuilderContextUsageProjectionWire } from '../domain/builderContextUsageProjection';
import type { BuilderProviderContextDisclosureStatusProjectionWire } from '../domain/builderProviderContextDisclosureStatusProjection';

export type { BuilderComposerApprovalMode } from '../application/builderComposerIntent';
export type { BuilderComposerContextStatus } from '../domain/builderContextStatusProjection';

export type BuilderComposerWorkingBrief = Readonly<{
  key: string;
  label: string;
  summary: string;
  taskId: string | null;
}>;

export type BuilderComposerMode = 'ask' | 'plan' | 'build';
export type BuilderComposerSurfaceKind = 'task' | 'workbench';
export type BuilderManualContextCompactionFeedback =
  | 'idle'
  | 'compacting'
  | 'compacted'
  | 'not_needed'
  | 'failed';
export type BuilderComposerModelSelectionStatus =
  | 'loading'
  | 'unconfigured'
  | 'ready'
  | 'selecting'
  | 'failed'
  | 'unavailable';
export type BuilderComposerModelSelection = Readonly<{
  configDigest: string | null;
  model: string | null;
  status: BuilderComposerModelSelectionStatus;
}>;

export type BuilderComposerProps = Readonly<{
  activeRunFollowupQueued?: boolean;
  approvalMode?: BuilderComposerApprovalMode;
  busy: boolean;
  canAddContext: boolean;
  canAllowCurrentProjectApproval?: boolean;
  canCancel: boolean;
  canEditInstruction: boolean;
  canManualCompactContext?: boolean;
  canProposePlan: boolean;
  canSubmitComposer: boolean;
  composerRouteDecision?: BuilderComposerRouteDecision | BuilderComposerRouteDecisionEvidence | null;
  composerContextStatus?: BuilderComposerContextStatus;
  contextUsageProjection?: BuilderContextUsageProjectionWire | null;
  manualContextCompactionFeedback?: BuilderManualContextCompactionFeedback;
  providerContextDisclosureStatus?: BuilderProviderContextDisclosureStatusProjectionWire | null;
  composerMode?: BuilderComposerMode | null;
  hasUnsavedDraft: boolean;
  instruction: string;
  onCancel?: () => void;
  onManualCompactContext?: () => Promise<unknown> | void;
  onPauseTask?: () => void;
  onResumeInterruptedRun?: () => void;
  paused?: boolean;
  onClearComposerMode?: () => void;
  onInstructionChange?: (value: string) => void;
  onOpenSettings?: () => void;
  onSelectApprovalMode?: (mode: BuilderComposerApprovalMode) => Promise<unknown> | void;
  onSelectComposerMode?: (mode: BuilderComposerMode) => void;
  onSelectModel?: (model: string, expectedConfigDigest: string) => Promise<unknown> | void;
  onSelectPlanMode?: () => void;
  onSubmitInstruction?: () => void;
  modelSelection?: BuilderComposerModelSelection;
  surfaceKind?: BuilderComposerSurfaceKind;
  status: BuilderProjectControllerStatus;
  viewingHistory: boolean;
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

function approvalModeLabel(mode: BuilderComposerApprovalMode): string {
  if (mode === 'read_only_chat') return 'Read-only chat';
  if (mode === 'allow_current_project') return 'Allow current project';
  return 'Ask before write';
}

function composerModeLabel(
  mode: BuilderComposerMode,
  surfaceKind: BuilderComposerSurfaceKind = 'task',
): string {
  if (mode === 'ask') return surfaceKind === 'workbench' ? 'Chat mode' : 'Ask mode';
  if (mode === 'build') return 'Build mode';
  return 'Plan mode';
}

function composerContextStatusLabel(status: BuilderComposerContextStatus): string | null {
  if (status === 'direction_changed') return 'Direction changed';
  if (status === 'handoff_received') return 'Handoff received';
  if (status === 'needs_confirmation') return 'Needs confirmation';
  if (status === 'ready_to_execute') return 'Ready to execute current direction';
  if (status === 'using_approved_plan') return 'Using approved plan';
  return null;
}

function providerContextDisclosureStatusCode(
  status: BuilderProviderContextDisclosureStatusProjectionWire | null,
): 'allowed' | 'denied' | 'needs_approval' | undefined {
  if (status === null) return undefined;
  if (status.can_use_provider_context) return 'allowed';
  return status.needs_user_approval ? 'needs_approval' : 'denied';
}

type BuilderComposerModelOption = Readonly<{
  description: string;
  label: string;
  model: string;
}>;

const BUILDER_COMPOSER_MODEL_OPTIONS: readonly BuilderComposerModelOption[] = Object.freeze([
  Object.freeze({
    description: 'Fast iteration for everyday Builder work',
    label: 'V4 Flash',
    model: 'deepseek-v4-flash',
  }),
  Object.freeze({
    description: 'Deeper reasoning for larger changes',
    label: 'V4 Pro',
    model: 'deepseek-v4-pro',
  }),
]);

const UNAVAILABLE_MODEL_SELECTION: BuilderComposerModelSelection = Object.freeze({
  configDigest: null,
  model: null,
  status: 'unavailable',
});

function modelOptionLabel(model: string): string {
  return BUILDER_COMPOSER_MODEL_OPTIONS.find((option) => option.model === model)?.label ?? model;
}

function modelSelectionLabel(selection: BuilderComposerModelSelection): string {
  if (selection.status === 'loading') return 'Model...';
  if (selection.status === 'unconfigured') return 'Set model';
  if (selection.status === 'failed') return selection.model === null ? 'Model failed' : modelOptionLabel(selection.model);
  if (selection.status === 'unavailable') return 'Model unavailable';
  if (selection.status === 'selecting' && selection.model === null) return 'Switching...';
  return selection.model === null ? 'Set model' : modelOptionLabel(selection.model);
}

function formatContextGate(value: string): string {
  return value
    .split('_')
    .filter((part) => part.length > 0)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function formatContextTokens(value: number): string {
  if (value >= 1_000_000) {
    const millions = value / 1_000_000;
    return `${Number.isInteger(millions) ? millions : millions.toFixed(1)}m`;
  }
  if (value >= 1_000) {
    const thousands = value / 1_000;
    const digits = value >= 100_000 ? 0 : 1;
    return `${Number.isInteger(thousands) ? thousands : thousands.toFixed(digits)}k`;
  }
  return String(value);
}

function composerContextRows(
  status: BuilderProviderContextDisclosureStatusProjectionWire | null,
  composerStatus: BuilderComposerContextStatus,
): readonly Readonly<{ key: string; label: string; value: string }>[] {
  if (status === null) {
    return Object.freeze([
      Object.freeze({
        key: 'state',
        label: 'State',
        value: composerContextStatusLabel(composerStatus) ?? 'No active context',
      }),
    ]);
  }
  const rows: Array<Readonly<{ key: string; label: string; value: string }>> = [
    Object.freeze({ key: 'state', label: 'State', value: status.label }),
  ];
  const surface = status.inspection?.context_surface ?? null;
  if (surface !== null) {
    rows.push(
      Object.freeze({ key: 'segments', label: 'Segments', value: String(surface.segment_count) }),
      Object.freeze({
        key: 'budget',
        label: 'Budget',
        value: `${surface.budget.used_prompt_bytes}/${surface.budget.max_prompt_bytes} bytes`,
      }),
      Object.freeze({ key: 'omitted', label: 'Omitted refs', value: String(surface.omitted_ref_count) }),
      Object.freeze({
        key: 'workspace',
        label: 'Workspace gate',
        value: formatContextGate(surface.permission_gate.workspace_state),
      }),
      Object.freeze({
        key: 'writes',
        label: 'Write gate',
        value: formatContextGate(surface.permission_gate.write_permission),
      }),
    );
  }
  return Object.freeze(rows);
}

export function BuilderComposer({
  activeRunFollowupQueued = false,
  approvalMode = 'ask_before_write',
  busy,
  canAddContext,
  canAllowCurrentProjectApproval = false,
  canCancel,
  canEditInstruction,
  canManualCompactContext = false,
  canProposePlan,
  canSubmitComposer,
  composerContextStatus = null,
  contextUsageProjection = null,
  manualContextCompactionFeedback = 'idle',
  composerMode = null,
  composerRouteDecision = null,
  providerContextDisclosureStatus = null,
  hasUnsavedDraft,
  instruction,
  modelSelection = UNAVAILABLE_MODEL_SELECTION,
  onCancel,
  onManualCompactContext,
  onPauseTask,
  onResumeInterruptedRun,
  paused = false,
  onClearComposerMode,
  onInstructionChange,
  onOpenSettings,
  onSelectApprovalMode,
  onSelectComposerMode,
  onSelectModel,
  onSelectPlanMode,
  onSubmitInstruction,
  surfaceKind = 'task',
  status,
}: BuilderComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const resumeAction = paused && !busy && instruction.trim().length === 0
    && canEditInstruction && typeof onResumeInterruptedRun === 'function';
  const restoreComposerFocusAfterSubmitRef = useRef(false);
  const restoreComposerFocusAfterLockedBusyRef = useRef(false);
  const restoreComposerFocusGraceTimerRef = useRef<number | null>(null);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [approvalMenuOpen, setApprovalMenuOpen] = useState(false);
  const [contextPopoverOpen, setContextPopoverOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [customModel, setCustomModel] = useState('');
  const contextStatusLabel = composerContextStatusLabel(composerContextStatus);
  const providerContextStatusLabel = providerContextDisclosureStatus?.label ?? null;
  const visibleContextStatusLabel = providerContextStatusLabel
    ?? (composerContextStatus === 'ready_to_execute' ? null : contextStatusLabel);
  const contextRows = composerContextRows(
    providerContextDisclosureStatus,
    composerContextStatus,
  );
  const contextUsagePercent = contextUsageProjection?.usage_percent ?? null;
  const contextOccupiedTokens = contextUsageProjection?.projected_tokens
    ?? contextUsageProjection?.pressure_tokens
    ?? null;
  const contextProgressDegrees = contextUsagePercent === null
    ? 0
    : Math.min(360, Math.max(0, contextUsagePercent * 3.6));
  const contextUsageStateLabel = contextUsageProjection === null
    || contextUsageProjection.context_window_tokens === null
    || contextUsagePercent === null
    ? 'Not measured'
    : contextUsageProjection.compaction_state === 'compacting'
      ? `${contextUsagePercent}% used · Compacting`
      : contextUsageProjection.measurement_state === 'awaiting_post_compaction_projection'
        ? `${contextUsagePercent}% last measured · Refreshing`
        : contextUsageProjection.measurement_state === 'awaiting_usage'
          ? 'Waiting for model usage'
        : `${contextUsagePercent}% used`;
  const contextTokenUsageLabel = contextUsageProjection === null
    || contextUsageProjection.context_window_tokens === null
    || contextOccupiedTokens === null
    ? 'Token usage unavailable'
    : `${formatContextTokens(contextOccupiedTokens)} / ${formatContextTokens(contextUsageProjection.context_window_tokens)} tokens`;
  const contextTokenBreakdownLabel = contextUsageProjection === null
    ? null
    : `Uncached ${formatContextTokens(contextUsageProjection.uncached_input_tokens)} · Output ${formatContextTokens(contextUsageProjection.output_tokens)}`;
  const contextCacheUsageLabel = contextUsageProjection === null
    ? null
    : `Cache hit ${contextUsageProjection.cache_hit_percent === null
      ? 'n/a'
      : `${contextUsageProjection.cache_hit_percent}%`} · Read ${formatContextTokens(contextUsageProjection.cache_read_tokens)} · Write ${formatContextTokens(contextUsageProjection.cache_write_tokens)}`;
  const contextPressureLabel = contextUsageProjection?.pressure_tokens === null
    || contextUsageProjection?.pressure_tokens === undefined
    ? null
    : `Provider prompt ${formatContextTokens(contextUsageProjection.pressure_tokens)}${contextUsageProjection.projected_tokens === null
      ? ''
      : ` · Projected ${formatContextTokens(contextUsageProjection.projected_tokens)}`}`;
  const contextLastCompactedLabel = contextUsageProjection?.last_compacted_at_ms === null
    || contextUsageProjection?.last_compacted_at_ms === undefined
    ? null
    : `Last compacted ${new Date(contextUsageProjection.last_compacted_at_ms).toLocaleString()}`;
  const manualContextCompactionBusy = manualContextCompactionFeedback === 'compacting'
    || contextUsageProjection?.compaction_state === 'compacting'
    || contextUsageProjection?.measurement_state === 'awaiting_post_compaction_projection';
  const canRequestManualContextCompaction = canManualCompactContext
    && typeof onManualCompactContext === 'function'
    && contextUsageProjection !== null
    && !manualContextCompactionBusy;
  const manualContextCompactionActionLabel =
    manualContextCompactionFeedback === 'compacting'
      ? 'Compacting...'
      : manualContextCompactionFeedback === 'compacted'
        ? 'Compacted'
        : manualContextCompactionFeedback === 'not_needed'
          ? 'Already compact'
          : manualContextCompactionFeedback === 'failed'
            ? 'Compact failed'
            : 'Compact now';
  const manualContextCompactionFeedbackLabel =
    manualContextCompactionFeedback === 'compacting'
      ? 'Manual compaction is running.'
      : manualContextCompactionFeedback === 'compacted'
        ? 'Manual compaction was recorded.'
        : manualContextCompactionFeedback === 'not_needed'
          ? 'No new compaction was needed.'
          : manualContextCompactionFeedback === 'failed'
            ? 'Manual compaction failed.'
            : null;
  const contextMeterStyle = {
    '--cf-builder-context-progress': `${contextProgressDegrees}deg`,
  } as CSSProperties;
  const contextStateLabel = providerContextStatusLabel
    ?? contextStatusLabel
    ?? 'No active context';
  const composerRouteEvidence = routeDecisionEvidence(composerRouteDecision);
  const composerPlaceholder = (() => {
    if (surfaceKind === 'workbench') return 'Message Builder...';
    if (hasUnsavedDraft) return 'Ask about this draft, or describe the next change...';
    if (canAddContext) return 'Add context for the current work...';
    if (busy) return 'Working on your request...';
    return 'Ask a question, or describe what to build or change...';
  })();
  const hasInstruction = instruction.trim().length > 0;
  const visibleModelOptions = modelSelection.model !== null
    && BUILDER_COMPOSER_MODEL_OPTIONS.every((option) => option.model !== modelSelection.model)
    ? Object.freeze([
      Object.freeze({
        description: 'Current configured model',
        label: modelSelection.model,
        model: modelSelection.model,
      }),
      ...BUILDER_COMPOSER_MODEL_OPTIONS,
    ])
    : BUILDER_COMPOSER_MODEL_OPTIONS;
  const canSelectModel = typeof onSelectModel === 'function'
    && modelSelection.configDigest !== null
    && (modelSelection.status === 'ready' || modelSelection.status === 'failed');
  const trimmedCustomModel = customModel.trim();
  const canSelectCustomModel = canSelectModel
    && trimmedCustomModel.length > 0
    && trimmedCustomModel === customModel
    && trimmedCustomModel !== modelSelection.model;
  const showSubmitAction = !busy || (canAddContext && hasInstruction);
  const showCancelAction = !showSubmitAction && canCancel;
  const showBusyAction = busy && !showSubmitAction && !showCancelAction;

  function clearPendingComposerFocusRestore(): void {
    restoreComposerFocusAfterSubmitRef.current = false;
    restoreComposerFocusAfterLockedBusyRef.current = false;
    if (restoreComposerFocusGraceTimerRef.current !== null) {
      window.clearTimeout(restoreComposerFocusGraceTimerRef.current);
      restoreComposerFocusGraceTimerRef.current = null;
    }
  }

  useEffect(() => {
    if (!restoreComposerFocusAfterSubmitRef.current) return;
    if (busy && !canAddContext) {
      restoreComposerFocusAfterLockedBusyRef.current = true;
      return;
    }
    if (!canEditInstruction) return;
    const shouldCompleteRestore = restoreComposerFocusAfterLockedBusyRef.current || (busy && canAddContext);
    if (shouldCompleteRestore) clearPendingComposerFocusRestore();
    textareaRef.current?.focus({ preventScroll: true });
  }, [busy, canAddContext, canEditInstruction, instruction]);

  useEffect(() => () => {
    if (restoreComposerFocusGraceTimerRef.current !== null) {
      window.clearTimeout(restoreComposerFocusGraceTimerRef.current);
    }
  }, []);

  function requestComposerFocusAfterSubmit(): void {
    restoreComposerFocusAfterSubmitRef.current = true;
    restoreComposerFocusAfterLockedBusyRef.current = false;
    if (restoreComposerFocusGraceTimerRef.current !== null) {
      window.clearTimeout(restoreComposerFocusGraceTimerRef.current);
    }
    restoreComposerFocusGraceTimerRef.current = window.setTimeout(() => {
      restoreComposerFocusGraceTimerRef.current = null;
      if (!restoreComposerFocusAfterSubmitRef.current) return;
      if (restoreComposerFocusAfterLockedBusyRef.current) return;
      if (busy && !canAddContext) return;
      if (!canEditInstruction) return;
      clearPendingComposerFocusRestore();
      textareaRef.current?.focus({ preventScroll: true });
    }, 800);
  }

  function keepComposerFocusDuringPointerSubmit(event: MouseEvent<HTMLButtonElement>): void {
    if (canSubmitComposer) event.preventDefault();
  }

  useEffect(() => {
    if (!addMenuOpen && !approvalMenuOpen && !contextPopoverOpen && !modelMenuOpen) {
      return undefined;
    }
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
        approvalMenuOpen
        && target.closest(
          '[data-builder-composer-approval-menu="true"], [data-builder-composer-approval-menu-button="true"]',
        ) === null
      ) {
        setApprovalMenuOpen(false);
      }
      if (
        contextPopoverOpen
        && target.closest(
          '[data-builder-composer-context-popover="true"], [data-builder-composer-context-button="true"], [data-builder-composer-status="true"]',
        ) === null
      ) {
        setContextPopoverOpen(false);
      }
      if (
        modelMenuOpen
        && target.closest(
          '[data-builder-composer-model-menu="true"], [data-builder-composer-model-menu-button="true"]',
        ) === null
      ) {
        setModelMenuOpen(false);
      }
    }
    document.addEventListener('pointerdown', closeFloatingPanels);
    return () => document.removeEventListener('pointerdown', closeFloatingPanels);
  }, [
    addMenuOpen,
    approvalMenuOpen,
    contextPopoverOpen,
    modelMenuOpen,
  ]);

  useEffect(() => {
    if (!addMenuOpen && !approvalMenuOpen && !contextPopoverOpen && !modelMenuOpen) {
      return undefined;
    }
    function closeFloatingPanelsWithEscape(event: globalThis.KeyboardEvent): void {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      if (addMenuOpen) setAddMenuOpen(false);
      if (approvalMenuOpen) setApprovalMenuOpen(false);
      if (contextPopoverOpen) setContextPopoverOpen(false);
      if (modelMenuOpen) setModelMenuOpen(false);
      textareaRef.current?.focus({ preventScroll: true });
    }
    document.addEventListener('keydown', closeFloatingPanelsWithEscape);
    return () => document.removeEventListener('keydown', closeFloatingPanelsWithEscape);
  }, [
    addMenuOpen,
    approvalMenuOpen,
    contextPopoverOpen,
    modelMenuOpen,
  ]);

  function toggleAddMenu(): void {
    if (busy && !canAddContext) return;
    setApprovalMenuOpen(false);
    setContextPopoverOpen(false);
    setModelMenuOpen(false);
    setAddMenuOpen((open) => !open);
  }

  function toggleApprovalMenu(): void {
    if (busy && !canAddContext) return;
    setAddMenuOpen(false);
    setContextPopoverOpen(false);
    setModelMenuOpen(false);
    setApprovalMenuOpen((open) => !open);
  }

  function toggleContextPopover(): void {
    setAddMenuOpen(false);
    setApprovalMenuOpen(false);
    setModelMenuOpen(false);
    setContextPopoverOpen((open) => !open);
  }

  function toggleModelMenu(): void {
    setAddMenuOpen(false);
    setApprovalMenuOpen(false);
    setContextPopoverOpen(false);
    setModelMenuOpen((open) => !open);
  }

  function selectModel(model: string): void {
    if (!canSelectModel || model === modelSelection.model || modelSelection.configDigest === null) return;
    setModelMenuOpen(false);
    void onSelectModel?.(model, modelSelection.configDigest);
  }

  function selectCustomModel(): void {
    if (!canSelectCustomModel || modelSelection.configDigest === null) return;
    setModelMenuOpen(false);
    setCustomModel('');
    void onSelectModel?.(trimmedCustomModel, modelSelection.configDigest);
  }

  function selectPlanMode(): void {
    if (!canProposePlan) return;
    setAddMenuOpen(false);
    if (typeof onSelectComposerMode === 'function') {
      onSelectComposerMode('plan');
    } else {
      onSelectPlanMode?.();
    }
  }

  function selectComposerMode(mode: BuilderComposerMode): void {
    if (mode === 'plan') {
      selectPlanMode();
      return;
    }
    if (typeof onSelectComposerMode !== 'function') return;
    setAddMenuOpen(false);
    onSelectComposerMode(mode);
  }

  function selectApprovalMode(mode: BuilderComposerApprovalMode): void {
    if (typeof onSelectApprovalMode !== 'function') return;
    if (mode === 'allow_current_project' && !canAllowCurrentProjectApproval) return;
    setApprovalMenuOpen(false);
    void onSelectApprovalMode(mode);
  }

  function changeInstruction(value: string): void {
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
      || (!canSubmitComposer && !resumeAction)
    ) {
      return;
    }
    event.preventDefault();
    if (resumeAction) onResumeInterruptedRun?.();
    else onSubmitInstruction?.();
    requestComposerFocusAfterSubmit();
  }

  return (
    <section
      aria-label="Conversation command"
      className="cf-builder-composer-card"
      data-builder-composer="true"
      data-builder-composer-state={paused ? 'paused' : hasUnsavedDraft ? 'draft-ready' : 'ready'}
      data-builder-route-confidence={composerRouteDecision?.confidence}
      data-builder-route-created-at={composerRouteEvidence?.createdAt}
      data-builder-route-decision-id={composerRouteEvidence?.decisionId}
      data-builder-route-dispatch={composerRouteDecision?.dispatch}
      data-builder-route-downgrade={composerRouteDecision?.downgradeReason ?? undefined}
      data-builder-route-active-run-input={composerRouteDecision?.activeRunInput}
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
        {activeRunFollowupQueued ? (
          <p
            className="cf-builder-composer-busy-build-notice"
            data-builder-active-run-followup-queued="true"
          >
            I&apos;m still working. This message is queued and will run after the current step finishes.
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
                    data-builder-composer-add-ask-mode="true"
                    onClick={() => selectComposerMode('ask')}
                    role="menuitem"
                    type="button"
                  >
                    <Bot aria-hidden="true" className="size-3.5" />
                    {surfaceKind === 'workbench' ? 'Chat mode' : 'Ask mode'}
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
                  {surfaceKind === 'task' ? (
                    <button
                      data-builder-composer-add-build-mode="true"
                      onClick={() => selectComposerMode('build')}
                      role="menuitem"
                      type="button"
                    >
                      <Hammer aria-hidden="true" className="size-3.5" />
                      Build mode
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
            {surfaceKind === 'task' ? (
              <div className="cf-builder-composer-approval-wrap">
              <button
                aria-expanded={approvalMenuOpen}
                aria-haspopup="menu"
                aria-label="Approval mode"
                className="cf-builder-composer-approval-button"
                data-builder-approval-mode={approvalMode}
                data-builder-composer-approval-menu-button="true"
                disabled={busy && !canAddContext}
                onClick={toggleApprovalMenu}
                title={`Approval mode: ${approvalModeLabel(approvalMode)}`}
                type="button"
              >
                <ShieldCheck aria-hidden="true" className="size-3.5" />
                {approvalModeLabel(approvalMode)}
              </button>
              {approvalMenuOpen ? (
                <div
                  className="cf-builder-composer-approval-menu"
                  data-builder-composer-approval-menu="true"
                  role="menu"
                >
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
                    Ask before write
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
            ) : null}
            {composerMode !== null ? (
              <span className="cf-builder-composer-mode-chip" data-builder-composer-mode-chip={composerMode}>
                {composerMode === 'ask' ? <Bot aria-hidden="true" className="size-3.5" /> : null}
                {composerMode === 'plan' ? <ListChecks aria-hidden="true" className="size-3.5" /> : null}
                {composerMode === 'build' ? <Hammer aria-hidden="true" className="size-3.5" /> : null}
                {composerModeLabel(composerMode, surfaceKind)}
                {typeof onClearComposerMode === 'function' ? (
                  <button
                    aria-label={`Remove ${composerModeLabel(composerMode, surfaceKind)}`}
                    data-builder-clear-composer-mode="true"
                    onClick={onClearComposerMode}
                    title={`Remove ${composerModeLabel(composerMode, surfaceKind)}`}
                    type="button"
                  >
                    <X aria-hidden="true" className="size-3" />
                  </button>
                ) : null}
              </span>
            ) : null}
            {visibleContextStatusLabel !== null ? (
              <button
                aria-expanded={contextPopoverOpen}
                aria-haspopup="dialog"
                className="cf-builder-composer-context-pill"
                data-builder-composer-context-status={providerContextDisclosureStatus === null
                  ? composerContextStatus
                  : undefined}
                data-builder-composer-provider-context-status={providerContextDisclosureStatus === null
                  ? undefined
                  : providerContextDisclosureStatusCode(providerContextDisclosureStatus)}
                data-builder-composer-status="true"
                onClick={toggleContextPopover}
                title={visibleContextStatusLabel}
                type="button"
              >
                <Sparkles aria-hidden="true" className="size-3.5" />
                {visibleContextStatusLabel}
              </button>
            ) : null}
          </div>
          <div className="cf-builder-composer-actions">
            <div className="cf-builder-composer-context-wrap">
              <button
                aria-expanded={contextPopoverOpen}
                aria-haspopup="dialog"
                aria-label={`Context: ${contextStateLabel}`}
                className="cf-builder-composer-context-meter-button"
                data-builder-composer-context-budget-state={contextUsageProjection === null
                  ? 'not_measured'
                  : 'available'}
                data-builder-composer-context-button="true"
                data-builder-composer-context-compaction={contextUsageProjection?.compaction_state ?? 'idle'}
                data-builder-composer-context-limit={contextUsageProjection?.context_window_tokens ?? undefined}
                data-builder-composer-context-measurement={contextUsageProjection?.measurement_state ?? 'unavailable'}
                data-builder-composer-context-pressure={contextUsageProjection?.pressure_tokens ?? undefined}
                data-builder-composer-context-projected={contextUsageProjection?.projected_tokens ?? undefined}
                onClick={toggleContextPopover}
                type="button"
              >
                <span
                  aria-hidden="true"
                  className="cf-builder-composer-context-meter"
                  style={contextMeterStyle}
                />
              </button>
              <div
                aria-hidden="true"
                className="cf-builder-composer-context-tooltip"
                data-builder-composer-context-tooltip="true"
                role="tooltip"
              >
                <strong>Context window</strong>
                <span>{contextUsageStateLabel}</span>
                <small>{contextTokenUsageLabel}</small>
                {contextPressureLabel === null ? null : <small>{contextPressureLabel}</small>}
                {contextTokenBreakdownLabel === null ? null : <small>{contextTokenBreakdownLabel}</small>}
                {contextCacheUsageLabel === null ? null : <small>{contextCacheUsageLabel}</small>}
                {contextLastCompactedLabel === null ? null : <small>{contextLastCompactedLabel}</small>}
              </div>
              {contextPopoverOpen ? (
                <div
                  className="cf-builder-composer-context-popover"
                  data-builder-composer-context-popover="true"
                  role="dialog"
                >
                  <div className="cf-builder-composer-add-menu-label">Context</div>
                  {providerContextDisclosureStatus?.inspection?.summary ? (
                    <p>{providerContextDisclosureStatus.inspection.summary}</p>
                  ) : null}
                  <dl className="cf-builder-composer-context-grid">
                    {contextRows.map((row) => (
                      <div key={row.key}>
                        <dt>{row.label}</dt>
                        <dd>{row.value}</dd>
                      </div>
                    ))}
                  </dl>
                  {surfaceKind === 'task' && typeof onManualCompactContext === 'function' ? (
                    <button
                      className="cf-builder-composer-context-action"
                      data-builder-composer-manual-compact-context="true"
                      data-builder-composer-manual-compact-state={manualContextCompactionFeedback}
                      disabled={!canRequestManualContextCompaction}
                      onClick={() => {
                        setContextPopoverOpen(false);
                        void onManualCompactContext();
                      }}
                      title="Compact context now"
                      type="button"
                    >
                      <Archive aria-hidden="true" className="size-3.5" />
                      {manualContextCompactionActionLabel}
                    </button>
                  ) : null}
                  {manualContextCompactionFeedbackLabel === null ? null : (
                    <p
                      className="cf-builder-composer-context-action-note"
                      data-builder-composer-manual-compact-feedback={manualContextCompactionFeedback}
                    >
                      {manualContextCompactionFeedbackLabel}
                    </p>
                  )}
                </div>
              ) : null}
            </div>
            <div className="cf-builder-composer-model-wrap">
              <button
                aria-expanded={modelMenuOpen}
                aria-haspopup="menu"
                aria-label="AI model"
                className="cf-builder-composer-model-button"
                data-builder-composer-model-menu-button="true"
                data-builder-composer-model-status={modelSelection.status}
                onClick={toggleModelMenu}
                title={`AI model: ${modelSelectionLabel(modelSelection)}`}
                type="button"
              >
                <Bot aria-hidden="true" className="size-3.5" />
                <span>{modelSelectionLabel(modelSelection)}</span>
                <ChevronDown aria-hidden="true" className="size-3.5" />
              </button>
              {modelMenuOpen ? (
                <div
                  className="cf-builder-composer-model-menu"
                  data-builder-composer-model-menu="true"
                  role="menu"
                >
                  <div className="cf-builder-composer-add-menu-label">Model</div>
                  {modelSelection.status === 'unconfigured' || modelSelection.status === 'unavailable' ? (
                    <p className="cf-builder-composer-model-menu-note">
                      Configure the AI provider in Settings before switching models here.
                    </p>
                  ) : null}
                  {visibleModelOptions.map((option) => (
                    <button
                      aria-checked={modelSelection.model === option.model}
                      data-builder-composer-model-option={option.model}
                      disabled={!canSelectModel
                        || modelSelection.model === option.model}
                      key={option.model}
                      onClick={() => selectModel(option.model)}
                      role="menuitemradio"
                      type="button"
                    >
                      <Bot aria-hidden="true" className="size-3.5" />
                      <span>
                        <strong>{option.label}</strong>
                        <small>{option.description}</small>
                      </span>
                    </button>
                  ))}
                  <div className="cf-builder-composer-model-custom">
                    <input
                      aria-label="Custom model"
                      disabled={!canSelectModel}
                      onChange={(event) => setCustomModel(event.currentTarget.value)}
                      placeholder="Custom model"
                      value={customModel}
                    />
                    <button
                      disabled={!canSelectCustomModel}
                      onClick={selectCustomModel}
                      type="button"
                    >
                      Use
                    </button>
                  </div>
                  <button
                    className="cf-builder-composer-model-settings"
                    onClick={() => {
                      setModelMenuOpen(false);
                      onOpenSettings?.();
                    }}
                    role="menuitem"
                    type="button"
                  >
                    <Settings aria-hidden="true" className="size-3.5" />
                    Provider settings
                  </button>
                </div>
              ) : null}
            </div>
            {showSubmitAction ? (
              <button
                aria-label={resumeAction ? '继续任务' : canAddContext ? 'Add context' : busy ? busyLabel(status) : 'Send'}
                className="cf-builder-primary-button cf-builder-send-button inline-flex min-h-10 min-w-10 items-center justify-center disabled:cursor-not-allowed disabled:opacity-50"
                data-builder-composer-primary-action="true"
                data-builder-submit-turn="true"
                data-builder-resume-interrupted-run={resumeAction ? 'true' : undefined}
                disabled={!canSubmitComposer && !resumeAction}
                onClick={() => {
                  if (resumeAction) onResumeInterruptedRun?.();
                  else onSubmitInstruction?.();
                  requestComposerFocusAfterSubmit();
                }}
                onMouseDown={keepComposerFocusDuringPointerSubmit}
                title={resumeAction ? '继续任务' : canAddContext ? 'Add context' : busy ? busyLabel(status) : 'Send'}
                type="button"
              >
                {resumeAction ? <Play aria-hidden="true" className="size-4" /> : <ArrowUp aria-hidden="true" className="size-4" />}
              </button>
            ) : null}
            {showCancelAction ? (
              <button
                aria-label={onPauseTask ? 'Pause task' : 'Stop'}
                className="cf-builder-primary-button cf-builder-send-button inline-flex min-h-10 min-w-10 items-center justify-center disabled:cursor-not-allowed disabled:opacity-50"
                data-builder-cancel-work="true"
                data-builder-pause-task={onPauseTask ? 'true' : undefined}
                data-builder-composer-primary-action="true"
                onClick={onPauseTask ?? onCancel}
                title={onPauseTask ? 'Pause task' : 'Stop'}
                type="button"
              >
                {onPauseTask ? <Pause aria-hidden="true" className="size-4" /> : <StopCircle aria-hidden="true" className="size-4" />}
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
      </div>
    </section>
  );
}
