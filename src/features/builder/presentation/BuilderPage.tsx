import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
  type Ref,
} from 'react';
import {
  AlertCircle,
  Archive,
  ArrowLeft,
  ArrowRight,
  Bot,
  ChevronDown,
  CheckCircle2,
  Circle,
  Copy,
  Download,
  FileCode2,
  FolderOpen,
  GitCompareArrows,
  Globe2,
  History,
  ListCollapse,
  ListChecks,
  LockKeyhole,
  Maximize2,
  Menu,
  Minimize2,
  MoreVertical,
  PanelRightClose,
  PanelRightOpen,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  SquareTerminal,
  StopCircle,
  Trash2,
  Undo2,
  UserRound,
  X,
} from 'lucide-react';

import {
  isTrustedBuilderConversationControllerSnapshot,
  type BuilderConversationControllerSnapshot,
} from '../application/builderConversationController';
import type { BuilderAgentWorkbenchSnapshot } from '../application/builderAgentWorkbenchController';
import type {
  BuilderLiveOutputSnapshot,
  BuilderLiveOutputStore,
} from '../application/builderLiveOutputStore';
import type {
  BuilderCommandOutputSnapshot,
  BuilderCommandOutputStore,
} from '../application/builderCommandOutputStore';
import {
  isTrustedBuilderProjectControllerSnapshot,
  type BuilderProjectControllerSnapshot,
  type BuilderProjectControllerStatus,
} from '../application/builderProjectController';
import {
  BUILDER_GENERATION_DIAGNOSTIC_RETRYABILITY,
  type BuilderCheckRunEnvironmentDiagnosis,
  type BuilderCheckRunDependencyPreparationDecision,
  type BuilderCheckRunProfile,
  type BuilderCheckRunStatusProjection,
  type BuilderCommandApprovalRequest,
  type BuilderProjectEnvironmentDiagnosis,
  type BuilderLivePreviewStatusProjection,
  type BuilderLivePreviewViewBounds,
  type BuilderUserWebStatusProjection,
  type BuilderPlanReviewDecision,
  type BuilderPlanReviewRequest,
  type BuilderSideWorkspaceFileContentProjection,
  type BuilderSideWorkspaceFileRef,
  type BuilderSideWorkspaceFileTreeEntry,
  type BuilderSideWorkspaceFileTreeProjection,
  type BuilderWorkbenchMessageStateOperation,
} from '../application/builderPorts';
import type { BuilderComposerRouteDecision } from '../application/builderComposerIntent';
import { incrementBuilderPerformance } from '../application/builderPerformanceTrace';
import {
  isTrustedBuilderProjectHistorySnapshot,
  type BuilderProjectHistorySnapshot,
} from '../application/builderProjectHistoryController';
import type { BuilderProjectCatalogSnapshot } from '../application/builderProjectCatalogController';
import type {
  BuilderConversationItem,
  BuilderConversationRunProgressStage,
  BuilderConversationWorkspaceMaterialization,
} from '../domain/builderConversationSnapshot';
import type { BuilderAgentActivityProjectionWire } from '../domain/builderAgentActivityProjection';
import { hasActiveProgrammingTask, interruptedTaskContinuation } from '../domain/builderInterruptedTask';
import type { BuilderAgentWorkbenchTaskProposalAction } from '../domain/builderAgentWorkbenchProjection';
import {
  canStopBuilderAgentTask,
  type BuilderAgentTaskMonitorItem,
} from '../domain/builderAgentTaskMonitorProjection';
import type { BuilderCheckRunOutcomeProjectionWire } from '../domain/builderCheckRunOutcomeProjection';
import type { BuilderDraftCheckpointStatusProjectionWire } from '../domain/builderDraftCheckpointStatusProjection';
import type { BuilderDraftCheckpointTimelineProjectionWire } from '../domain/builderDraftCheckpointTimelineProjection';
import type { BuilderProjectHistoryRevision } from '../domain/builderProjectHistory';
import type { BuilderProjectSourceFile } from '../domain/builderProjectSnapshot';
import {
  createBuilderSourceTreeChanges,
  type BuilderSourceTreeChange,
  type BuilderSourceTreeChanges,
} from '../domain/builderSourceTreeChanges';
import type {
  BuilderProviderContextDisclosureInspectionWire,
  BuilderProviderContextDisclosureStatusProjectionWire,
} from '../domain/builderProviderContextDisclosureStatusProjection';
import type { BuilderContextUsageProjectionWire } from '../domain/builderContextUsageProjection';
import { BuilderChangesPanel } from './BuilderChangesPanel';
import { BuilderConversationMarkdown } from './BuilderConversationMarkdown';
import {
  builderDurableUserMessage,
  builderPendingUserMessageMatchesDurable,
  type BuilderDurableUserMessage,
  type BuilderPendingUserMessage,
} from './builderUserMessageReconciliation';
import {
  BuilderComposer,
  type BuilderComposerApprovalMode,
  type BuilderComposerContextStatus,
  type BuilderManualContextCompactionFeedback,
  type BuilderComposerMode,
  type BuilderComposerModelSelection,
  type BuilderComposerSurfaceKind,
} from './BuilderComposer';
import {
  BuilderDraftCheckStatus,
} from './BuilderReviewCheckpoint';
import { BuilderResultPanel } from './BuilderResultPanel';
import { BuilderSourceDisclosure } from './BuilderSourceDisclosure';

export type BuilderFileName = string;

export type BuilderTaskConversationSeed = Readonly<{
  task_address_id: string;
  conversation_id: string;
  goal: string;
  waiting_to_start: boolean;
}>;

function taskConversationSeedFromMonitorTask(
  task: BuilderAgentTaskMonitorItem,
): BuilderTaskConversationSeed {
  return Object.freeze({
    task_address_id: task.task_address_id,
    conversation_id: task.conversation_id,
    goal: task.goal,
    waiting_to_start: task.state === 'draft',
  });
}

function taskConversationSeedFromProposalAction(
  action: BuilderAgentWorkbenchTaskProposalAction,
): BuilderTaskConversationSeed | null {
  if (action.task_address_id === null || action.conversation_id === null) return null;
  return Object.freeze({
    task_address_id: action.task_address_id,
    conversation_id: action.conversation_id,
    goal: action.objective,
    waiting_to_start: true,
  });
}

type BuilderDisplayedCheckStatus = Pick<
  BuilderCheckRunStatusProjection,
  'command_kind' | 'status' | 'summary' | 'environment_reason' | 'completed_at_ms'
>;

function sameDisplayedCheckStatus(
  previous: BuilderDisplayedCheckStatus | null,
  current: BuilderDisplayedCheckStatus | null,
): boolean {
  return previous === current || (
    previous !== null
    && current !== null
    && previous.command_kind === current.command_kind
    && previous.status === current.status
    && previous.summary === current.summary
    && previous.environment_reason === current.environment_reason
    && previous.completed_at_ms === current.completed_at_ms
  );
}

export type BuilderPlanReviewInFlight = Readonly<{
  project_id: string;
  conversation_id: string;
  turn_id: string;
  run_id: string;
}>;

export type BuilderPlanSourceReadApprovalPrompt = Readonly<{
  project_id: string;
  instruction: string;
  file_count: number | null;
  state: 'pending' | 'approving' | 'failed';
}>;

export type BuilderCurrentProjectWriteApprovalPrompt = Readonly<{
  project_id: string;
  instruction: string;
  state: 'pending' | 'approving' | 'failed';
}>;

export type BuilderCommandApprovalPrompt = Readonly<{
  request: BuilderCommandApprovalRequest;
  state: 'pending' | 'deciding' | 'failed';
}>;

export type BuilderCheckRunOperationFailureCode =
  | 'busy'
  | 'stale_draft'
  | 'invalid_request'
  | 'forbidden'
  | 'unavailable';

export type BuilderCheckEnvironmentDiagnosisView = Readonly<{
  command_profile_id: string;
  status: 'idle' | 'loading' | 'ready' | 'failed';
  diagnosis?: BuilderCheckRunEnvironmentDiagnosis;
  failure_message?: string;
}>;

type BuilderProjectEnvironmentDiagnosisView = Readonly<{
  project_id: string;
  status: 'loading' | 'ready' | 'failed';
  diagnosis?: BuilderProjectEnvironmentDiagnosis;
  failure_message?: string;
}>;

type BuilderProjectDependencyPreparationView = Readonly<{
  project_id: string;
  status: 'preparing' | 'failed';
  failure_message?: string;
}>;

export type BuilderPageProps = {
  activeRunFollowupQueued?: boolean;
  approvalMode?: BuilderComposerApprovalMode;
  checkRunOperation?: 'loading' | 'running' | 'preparing_dependencies' | 'skipping' | 'failed' | null;
  checkRunOperationFailureCode?: BuilderCheckRunOperationFailureCode | null;
  checkEnvironmentDiagnosis?: BuilderCheckEnvironmentDiagnosisView | null;
  checkRunProfiles?: readonly BuilderCheckRunProfile[];
  checkRunStatus?: BuilderCheckRunStatusProjection | null;
  projectDependencyPreparation?: BuilderProjectDependencyPreparationView | null;
  projectEnvironmentDiagnosis?: BuilderProjectEnvironmentDiagnosisView | null;
  instruction: string;
  composerRouteDecision?: BuilderComposerRouteDecision | null;
  composerContextStatus?: BuilderComposerContextStatus;
  providerContextDisclosureStatus?: BuilderProviderContextDisclosureStatusProjectionWire | null;
  contextUsageProjection?: BuilderContextUsageProjectionWire | null;
  manualContextCompactionFeedback?: BuilderManualContextCompactionFeedback;
  providerContextDisclosureApprovalState?: 'idle' | 'approving' | 'failed';
  composerMode?: BuilderComposerMode | null;
  composerModelSelection?: BuilderComposerModelSelection;
  composerSubmitLocked?: boolean;
  liveOutput?: BuilderLiveOutputSnapshot | null;
  liveOutputStore?: BuilderLiveOutputStore | null;
  livePreviewOperation?: 'starting' | 'reloading' | 'stopping' | null;
  livePreviewStatus?: BuilderLivePreviewStatusProjection | null;
  userWebOperation?: 'navigating' | 'reloading' | 'stopping' | null;
  userWebStatus?: BuilderUserWebStatusProjection | null;
  sideWorkspaceFileContent?: BuilderSideWorkspaceFileContentProjection | null;
  sideWorkspaceFileContentStatus?: 'idle' | 'loading' | 'ready' | 'failed';
  sideWorkspaceFileTree?: BuilderSideWorkspaceFileTreeProjection | null;
  sideWorkspaceFileTreeStatus?: 'idle' | 'loading' | 'ready' | 'failed';
  surfaceKind?: BuilderComposerSurfaceKind;
  approvedPlanContinuationFailure?: BuilderPlanReviewInFlight | null;
  answerFailureRecordedSuccess?: boolean;
  planReviewFailure?: BuilderPlanReviewInFlight | null;
  planReviewInFlight?: BuilderPlanReviewInFlight | null;
  planReviewRecorded?: BuilderPlanReviewInFlight | null;
  planSourceReadApproval?: BuilderPlanSourceReadApprovalPrompt | null;
  currentProjectWriteApproval?: BuilderCurrentProjectWriteApprovalPrompt | null;
  commandApproval?: BuilderCommandApprovalPrompt | null;
  commandOutputStore?: BuilderCommandOutputStore | null;
  pendingUserMessages?: readonly BuilderPendingUserMessage[];
  onInstructionChange?: (value: string) => void;
  onApprovePlanSourceRead?: () => Promise<unknown> | void;
  onApproveCurrentProjectWrite?: () => Promise<unknown> | void;
  onDecideCommandApproval?: (decision: 'allow_once' | 'deny') => Promise<unknown> | void;
  onDecideCheckDependencyPreparation?: (
    decision: BuilderCheckRunDependencyPreparationDecision,
    profile: BuilderCheckRunProfile,
  ) => Promise<unknown> | void;
  onDiagnoseCheckEnvironment?: (profile: BuilderCheckRunProfile) => Promise<unknown> | void;
  onApproveProviderContextDisclosure?: () => Promise<unknown> | void;
  onCancel?: () => void;
  onPauseTask?: () => void;
  onDismissPlanSourceReadApproval?: () => void;
  onDismissCurrentProjectWriteApproval?: () => void;
  onSelectApprovalMode?: (mode: BuilderComposerApprovalMode) => Promise<unknown> | void;
  onSelectComposerMode?: (mode: BuilderComposerMode) => void;
  onSelectComposerModel?: (model: string, expectedConfigDigest: string) => Promise<unknown> | void;
  onSelectPlanMode?: () => void;
  onClearComposerMode?: () => void;
  onSubmitInstruction?: () => void;
  onRetryGenerate?: () => void;
  onResumeInterruptedRun?: () => void;
  onManualCompactContext?: () => Promise<unknown> | void;
  onRefreshConversation?: () => Promise<unknown> | void;
  onRefreshHistory?: () => Promise<unknown> | void;
  onRejectDraft?: () => void;
  onReloadLivePreview?: () => Promise<unknown> | void;
  onDecideLivePreviewDevServerApproval?: (
    decision: 'allow_once' | 'deny',
  ) => Promise<unknown> | void;
  onLivePreviewLayoutChange?: (bounds: BuilderLivePreviewViewBounds | null) => Promise<unknown> | void;
  onAgentTestBrowserLayoutChange?: (
    ownerRunId: string,
    bounds: BuilderLivePreviewViewBounds | null,
  ) => Promise<unknown> | void;
  activeAgentTestBrowserRunId?: string | null;
  onNavigateUserWeb?: (url: string) => Promise<unknown> | void;
  onGoBackUserWeb?: () => Promise<unknown> | void;
  onGoForwardUserWeb?: () => Promise<unknown> | void;
  onReloadUserWeb?: () => Promise<unknown> | void;
  onStopUserWeb?: () => Promise<unknown> | void;
  onUserWebLayoutChange?: (bounds: BuilderLivePreviewViewBounds | null) => Promise<unknown> | void;
  onReviewPlan?: (request: BuilderPlanReviewRequest) => Promise<unknown> | void;
  onRequestLivePreview?: () => Promise<unknown> | void;
  onRequestSideWorkspaceFiles?: () => Promise<unknown> | void;
  onSave?: () => void;
  onUndoDraft?: () => void;
  onSelectSideWorkspaceFile?: (fileRef: BuilderSideWorkspaceFileRef) => Promise<unknown> | void;
  onStopLivePreview?: () => Promise<unknown> | void;
  onInspectRevision?: (projectId: string, revisionReceiptDigest: string) => Promise<unknown> | void;
  onOpenProjectLocation?: (projectId: string) => Promise<unknown> | void;
  onRestoreRevisionAsDraft?: (projectId: string, revisionReceiptDigest: string) => Promise<unknown> | void;
  onShowCurrentRevision?: () => Promise<unknown> | void;
  onOpenSettings?: () => void;
  onPrepareProjectDependencies?: (projectId: string) => Promise<unknown> | void;
  conversationSnapshot?: BuilderConversationControllerSnapshot;
  taskConversationSeed?: BuilderTaskConversationSeed | null;
  agentWorkbenchSnapshot?: BuilderAgentWorkbenchSnapshot;
  onRefreshAgentWorkbench?: () => Promise<unknown> | void;
  onUpdateAgentWorkbenchMessageState?: (
    messageId: string,
    operation: BuilderWorkbenchMessageStateOperation,
  ) => Promise<unknown> | void;
  onDecideAgentTaskProposal?: (
    proposalId: string,
    operation: 'approve_existing_project' | 'reject',
    projectId: string | null,
  ) => Promise<unknown> | void;
  onDecideAgentPlan?: (
    agentPlanId: string,
    contentDigest: string,
    decision: 'approved' | 'rejected',
  ) => Promise<unknown> | void;
  onCreateProjectForAgentTaskProposal?: (
    proposalId: string,
    objective: string,
  ) => Promise<unknown> | void;
  onOpenAgentTaskProposal?: (
    projectId: string,
    taskAddressId: string,
    seed?: BuilderTaskConversationSeed | null,
  ) => void;
  onArchiveAgentTask?: (
    projectId: string,
    taskAddressId: string,
  ) => Promise<unknown> | void;
  onControlAgentTask?: (
    projectId: string,
    taskAddressId: string,
    operation: 'cancel_task',
  ) => Promise<unknown> | void;
  onRenameAgentTask?: (
    projectId: string,
    taskAddressId: string,
    title: string,
  ) => Promise<unknown> | void;
  projectCatalogSnapshot?: BuilderProjectCatalogSnapshot;
  historySnapshot?: BuilderProjectHistorySnapshot;
  snapshot: BuilderProjectControllerSnapshot;
  activeFile: BuilderFileName | null;
  onSelectFile?: (file: BuilderFileName) => void;
  onOpenRuntimeToolFile?: (
    request: Readonly<{ run_id: string; tool_call_id: string }>,
  ) => Promise<boolean>;
};

const GENERATABLE_STATUSES = new Set<BuilderProjectControllerStatus>([
  'new',
  'ready',
  'draft_ready',
  'answer_failed',
  'submit_failed',
  'generation_failed',
  'preview_unavailable',
]);
const PLAN_PROPOSAL_READY_STATUSES = new Set<BuilderProjectControllerStatus>([
  'ready',
  'preview_unavailable',
  'answer_failed',
  'submit_failed',
  'generation_failed',
]);
const CHAT_FOLLOW_BOTTOM_THRESHOLD_PX = 96;
const ARTIFACT_DEFAULT_WIDTH_PX = 400;
const ARTIFACT_MIN_WIDTH_PX = 320;
const ARTIFACT_MAX_WIDTH_PX = 1_100;
const ARTIFACT_MIN_CHAT_WIDTH_PX = 420;
const ARTIFACT_KEYBOARD_STEP_PX = 24;
const ARTIFACT_KEYBOARD_LARGE_STEP_PX = 80;
type BuilderArtifactTab =
  | 'browser_placeholder'
  | 'changes'
  | 'permissions'
  | 'preview'
  | 'side_chat_placeholder'
  | 'source'
  | 'terminal_placeholder'
  | 'versions';
type BuilderSideWorkspaceTabType = 'browser' | 'file' | 'review' | 'side_chat' | 'terminal';

function clampArtifactWidth(value: number, maximum = ARTIFACT_MAX_WIDTH_PX): number {
  if (!Number.isFinite(value)) return ARTIFACT_DEFAULT_WIDTH_PX;
  const safeMaximum = Math.max(ARTIFACT_MIN_WIDTH_PX, Math.min(ARTIFACT_MAX_WIDTH_PX, Math.round(maximum)));
  return Math.min(safeMaximum, Math.max(ARTIFACT_MIN_WIDTH_PX, Math.round(value)));
}

function artifactMaxWidthForShell(shellWidth: number): number {
  if (!Number.isFinite(shellWidth)) return ARTIFACT_MAX_WIDTH_PX;
  if (shellWidth <= 0) return ARTIFACT_MAX_WIDTH_PX;
  return Math.max(ARTIFACT_MIN_WIDTH_PX, shellWidth - ARTIFACT_MIN_CHAT_WIDTH_PX);
}

function isBuilderGenerationDiagnosticCode(
  value: BuilderProjectControllerSnapshot['error'],
): value is keyof typeof BUILDER_GENERATION_DIAGNOSTIC_RETRYABILITY {
  return value !== null && Object.hasOwn(BUILDER_GENERATION_DIAGNOSTIC_RETRYABILITY, value);
}

function isRetryableGenerationError(value: BuilderProjectControllerSnapshot['error']): boolean {
  return isBuilderGenerationDiagnosticCode(value) && BUILDER_GENERATION_DIAGNOSTIC_RETRYABILITY[value];
}

function selectedFiles(snapshot: BuilderProjectControllerSnapshot): readonly BuilderProjectSourceFile[] {
  return snapshot.draft?.source_tree.files
    ?? snapshot.inspectedRevision?.source_tree.files
    ?? snapshot.savedProject?.source_tree.files
    ?? [];
}

function visibleActivitySnapshot(
  value: BuilderConversationControllerSnapshot | undefined,
): BuilderConversationControllerSnapshot | null {
  if (value === undefined) return null;
  return isTrustedBuilderConversationControllerSnapshot(value) ? value : null;
}

function visibleHistorySnapshot(
  value: BuilderProjectHistorySnapshot | undefined,
): BuilderProjectHistorySnapshot | null {
  if (value === undefined) return null;
  return isTrustedBuilderProjectHistorySnapshot(value) ? value : null;
}

function activityItems(
  snapshot: BuilderConversationControllerSnapshot | null,
): readonly BuilderConversationItem[] {
  const conversation = snapshot?.conversation;
  return conversation?.state === 'ready' ? conversation.conversation.items : [];
}

function currentAgentActivity(
  snapshot: BuilderConversationControllerSnapshot | null,
): BuilderAgentActivityProjectionWire | null {
  return snapshot?.conversation?.state === 'ready'
    ? snapshot.conversation.agent_activity_projection ?? null
    : null;
}

function currentCheckRunOutcome(
  snapshot: BuilderConversationControllerSnapshot | null,
): BuilderCheckRunOutcomeProjectionWire | null {
  return snapshot?.conversation?.state === 'ready'
    ? snapshot.conversation.check_run_outcome_projection ?? null
    : null;
}

function ChangeLineDelta({ change }: Readonly<{ change: BuilderSourceTreeChange }>) {
  if (change.diff_availability === 'too_large') return <small>Large change</small>;
  const added = change.diff_lines.filter((line) => line.line_kind === 'added').length;
  const removed = change.diff_lines.filter((line) => line.line_kind === 'removed').length;
  return (
    <small className="cf-builder-change-line-delta">
      <span data-builder-delta-added="true">+{added}</span>
      {' '}
      <span data-builder-delta-removed="true">-{removed}</span>
    </small>
  );
}

function activityEntries(snapshot: BuilderConversationControllerSnapshot | null): readonly ActivityEntry[] {
  const entries: ActivityEntry[] = [];
  const completedRuns = new Set<string>();
  const workEntries = new Map<string, ActivityWorkStatusEntry>();
  const toolRequestEntries = new Map<string, ActivityItemEntry>();
  const runtimeToolEntries = new Map<string, ActivityItemEntry>();
  const latestRuntimeStatusByRun = new Map<string, ActivityItemEntry>();
  const recoveryActionEntries = new Map<string, ActivityItemEntry>();
  const items = activityItems(snapshot);
  const approvedPlanContinuationTurns = new Set(items
    .filter((item) => item.item_kind === 'programming_run_admitted')
    .map((item) => item.turn_id));
  for (const item of items) {
    if (
      item.item_kind === 'user_message'
      && item.mode === 'work'
      && item.task?.title === 'Apply approved plan'
      && approvedPlanContinuationTurns.has(item.turn_id)
    ) {
      continue;
    }
    if (item.item_kind === 'run_started') {
      const key = `${item.turn_id}:${item.run_id}`;
      const entry: ActivityWorkStatusEntry = {
        entry_kind: 'work_status',
        key,
        sequence: item.sequence,
        turnId: item.turn_id,
        runId: item.run_id,
        status: 'started',
        hidden: false,
      };
      workEntries.set(key, entry);
      entries.push(entry);
      continue;
    }
    if (item.item_kind === 'run_progress_recorded') {
      const key = `${item.turn_id}:${item.run_id}`;
      const existing = workEntries.get(key);
      if (existing === undefined) {
        const entry: ActivityWorkStatusEntry = {
          entry_kind: 'work_status',
          key,
          sequence: item.sequence,
          turnId: item.turn_id,
          runId: item.run_id,
          status: item.stage,
          hidden: false,
        };
        workEntries.set(key, entry);
        entries.push(entry);
      } else {
        existing.status = item.stage;
      }
      continue;
    }
    if (
      item.item_kind === 'run_context_snapshot_recorded'
      || item.item_kind === 'programming_run_admitted'
      || item.item_kind === 'task_brief_updated'
    ) {
      continue;
    }
    if (item.item_kind === 'tool_call_requested') {
      const runKey = `${item.turn_id}:${item.run_id}`;
      const entry: ActivityItemEntry = {
        entry_kind: 'item',
        key: `tool:${runKey}:${item.tool_call_id}`,
        item,
        hidden: true,
      };
      toolRequestEntries.set(`${runKey}:${item.tool_call_id}`, entry);
      entries.push(entry);
      continue;
    }
    if (item.item_kind === 'tool_call_result_recorded') {
      const runKey = `${item.turn_id}:${item.run_id}`;
      const requestEntry = toolRequestEntries.get(`${runKey}:${item.tool_call_id}`);
      if (requestEntry !== undefined) {
        requestEntry.item = item;
        requestEntry.hidden = item.result.status === 'succeeded';
      } else {
        const entry: ActivityItemEntry = {
          entry_kind: 'item',
          key: `tool:${runKey}:${item.tool_call_id}`,
          item,
          hidden: item.result.status === 'succeeded',
        };
        entries.push(entry);
      }
      continue;
    }
    if (item.item_kind === 'programming_runtime_assistant_message') {
      const runKey = `${item.turn_id}:${item.run_id}`;
      const workEntry = workEntries.get(runKey);
      if (workEntry !== undefined) workEntry.hidden = true;
      const statusEntry = latestRuntimeStatusByRun.get(item.run_id);
      if (statusEntry !== undefined) statusEntry.hidden = true;
      const entry: ActivityItemEntry = {
        entry_kind: 'item',
        key: `item:${item.sequence}`,
        item,
        hidden: false,
      };
      entries.push(entry);
      continue;
    }
    if (item.item_kind === 'programming_runtime_tool_activity') {
      const runKey = `${item.turn_id}:${item.run_id}`;
      const activityKey = `${runKey}:${item.tool_call_id}`;
      const workEntry = workEntries.get(runKey);
      if (workEntry !== undefined) workEntry.hidden = true;
      const statusEntry = latestRuntimeStatusByRun.get(item.run_id);
      if (statusEntry !== undefined) statusEntry.hidden = true;
      const existing = runtimeToolEntries.get(activityKey);
      if (existing !== undefined) {
        existing.item = item;
      } else {
        const entry: ActivityItemEntry = {
          entry_kind: 'item',
          key: `runtime-tool:${activityKey}`,
          item,
          hidden: false,
        };
        runtimeToolEntries.set(activityKey, entry);
        entries.push(entry);
      }
      continue;
    }
    if (item.item_kind === 'programming_runtime_status') {
      const existing = latestRuntimeStatusByRun.get(item.run_id);
      if (existing !== undefined) existing.hidden = true;
      for (const workEntry of workEntries.values()) {
        if (workEntry.runId === item.run_id) workEntry.hidden = true;
      }
      const entry: ActivityItemEntry = {
        entry_kind: 'item',
        key: `runtime-status:${item.run_id}:${item.sequence}`,
        item,
        hidden: false,
      };
      latestRuntimeStatusByRun.set(item.run_id, entry);
      entries.push(entry);
      continue;
    }
    if (item.item_kind === 'agent_step_progress_recorded') {
      continue;
    }
    if (item.item_kind === 'recovery_action_recorded') {
      const key = `${item.run_id}:${item.action}`;
      const existing = recoveryActionEntries.get(key);
      if (existing !== undefined) {
        existing.item = item;
      } else {
        const entry: ActivityItemEntry = {
          entry_kind: 'item',
          key: `recovery:${key}`,
          item,
          hidden: false,
        };
        recoveryActionEntries.set(key, entry);
        entries.push(entry);
      }
      continue;
    }
    if (item.item_kind === 'run_completed') {
      const key = `${item.turn_id}:${item.run_id}`;
      const runHistoryItems = [...runtimeToolEntries.values()]
        .filter((entry): entry is ActivityItemEntry & {
          item: Extract<BuilderConversationItem, { item_kind: 'programming_runtime_tool_activity' }>;
        } => (
          entry.item.item_kind === 'programming_runtime_tool_activity'
          && entry.item.turn_id === item.turn_id
          && entry.item.run_id === item.run_id
        ))
        .sort((left, right) => left.item.sequence - right.item.sequence);
      if (runHistoryItems.length > 0) {
        for (const entry of runHistoryItems) entry.hidden = true;
        entries.push({
          entry_kind: 'run_history',
          key: `runtime-history:${key}`,
          runKey: key,
          items: runHistoryItems.map((entry) => entry.item),
        });
      }
      completedRuns.add(key);
      entries.push({
        entry_kind: 'item',
        key: `item:${item.sequence}`,
        item,
        hidden: false,
      });
      continue;
    }
    if (
      item.item_kind === 'turn_completed'
      && item.run_id !== null
      && completedRuns.has(`${item.turn_id}:${item.run_id}`)
    ) {
      continue;
    }
    entries.push({ entry_kind: 'item', key: `item:${item.sequence}`, item, hidden: false });
  }
  return entries.filter((entry) => {
    if (entry.entry_kind === 'run_history') return true;
    if (entry.entry_kind === 'item' && entry.item.item_kind === 'run_control_requested'
      && entry.item.action === 'interrupt'
      && completedRuns.has(`${entry.item.turn_id}:${entry.item.run_id}`)) return false;
    return !entry.hidden;
  });
}

function isNearChatBottom(element: HTMLElement): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= CHAT_FOLLOW_BOTTOM_THRESHOLD_PX;
}

function useLatestCallback<Arguments extends unknown[], Result>(
  callback: (...args: Arguments) => Result,
): (...args: Arguments) => Result {
  const callbackRef = useRef(callback);
  useLayoutEffect(() => {
    callbackRef.current = callback;
  }, [callback]);
  return useCallback((...args: Arguments) => callbackRef.current(...args), []);
}

function useLatestOptionalCallback<Arguments extends unknown[], Result>(
  callback: ((...args: Arguments) => Result) | undefined,
): ((...args: Arguments) => Result) | undefined {
  const callbackRef = useRef(callback);
  useLayoutEffect(() => {
    callbackRef.current = callback;
  }, [callback]);
  const stable = useCallback((...args: Arguments) => callbackRef.current?.(...args), []);
  return callback === undefined
    ? undefined
    : stable as (...args: Arguments) => Result;
}

function planReviewKey(turnId: string, runId: string): string {
  return `${turnId}:${runId}`;
}

function pendingPlanReviewTarget(
  snapshot: BuilderConversationControllerSnapshot | null,
): BuilderPlanReviewRequest | null {
  const conversation = snapshot?.conversation;
  if (conversation?.state !== 'ready' || conversation.project_id === null) return null;
  const planRuns = new Set<string>();
  const pending = new Map<string, BuilderPlanReviewRequest>();
  for (const item of conversation.conversation.items) {
    if (
      item.item_kind === 'run_completed'
      && item.terminal_status === 'succeeded'
      && item.result_kind === 'plan'
    ) {
      planRuns.add(planReviewKey(item.turn_id, item.run_id));
    } else if (
      item.item_kind === 'turn_completed'
      && item.outcome === 'plan_proposed'
      && item.run_id !== null
      && planRuns.has(planReviewKey(item.turn_id, item.run_id))
    ) {
      pending.set(planReviewKey(item.turn_id, item.run_id), Object.freeze({
        project_id: conversation.project_id,
        conversation_id: conversation.conversation.conversation_id,
        turn_id: item.turn_id,
        run_id: item.run_id,
        decision: 'approved',
      }));
    } else if (item.item_kind === 'plan_reviewed') {
      pending.delete(planReviewKey(item.turn_id, item.run_id));
    }
  }
  return [...pending.values()].at(-1) ?? null;
}

function inlinePlanReviewDecisions(
  snapshot: BuilderConversationControllerSnapshot | null,
): ReadonlyMap<string, BuilderPlanReviewDecision> {
  const conversation = snapshot?.conversation;
  if (conversation?.state !== 'ready') return new Map();
  const planRuns = new Set<string>();
  const reviews = new Map<string, BuilderPlanReviewDecision>();
  for (const item of conversation.conversation.items) {
    if (
      item.item_kind === 'run_completed'
      && item.terminal_status === 'succeeded'
      && item.result_kind === 'plan'
    ) {
      planRuns.add(planReviewKey(item.turn_id, item.run_id));
    }
  }
  for (const item of conversation.conversation.items) {
    if (item.item_kind !== 'plan_reviewed') continue;
    const key = planReviewKey(item.turn_id, item.run_id);
    if (planRuns.has(key)) reviews.set(key, item.decision);
  }
  return reviews;
}

function activityMessage(
  snapshot: BuilderConversationControllerSnapshot | null,
): string | null {
  if (snapshot === null || snapshot.status === 'idle') return null;
  if (snapshot.status === 'loading') return 'Loading activity...';
  if (snapshot.status === 'unavailable') return 'Activity is unavailable.';
  if (snapshot.status === 'stale') return 'Activity could not be refreshed.';
  if (snapshot.conversation?.state === 'absent') {
    return 'No recorded activity for this project yet. History is available.';
  }
  return null;
}

function isTranscriptRestoredConversation(
  snapshot: BuilderConversationControllerSnapshot | null,
): boolean {
  return snapshot?.conversation?.state === 'ready'
    && snapshot.conversation.conversation.source === 'sqlite_derived_public_transcript'
    && snapshot.conversation.conversation.recovery?.recovery_kind === 'transcript_restored';
}

function shouldShowActivityPanel(snapshot: BuilderConversationControllerSnapshot | null): boolean {
  if (snapshot === null || snapshot.status === 'idle' || snapshot.status === 'absent') return false;
  const items = activityItems(snapshot);
  if (items.length > 0) return true;
  if (snapshot.status === 'unavailable') return false;
  return snapshot.status === 'loading'
    || snapshot.status === 'refreshing'
    || snapshot.status === 'stale';
}

function projectHistoryMessage(
  snapshot: BuilderProjectHistorySnapshot | null,
  hasSavedProject: boolean,
): string | null {
  if (!hasSavedProject) return 'No milestone versions yet.';
  if (snapshot === null || snapshot.status === 'idle') return 'Loading history...';
  if (snapshot.status === 'loading') return 'Loading history...';
  if (snapshot.status === 'unavailable') return 'History is unavailable.';
  if (snapshot.status === 'stale') return 'History could not be refreshed.';
  return null;
}

function outcomeLabel(
  outcome: Extract<BuilderConversationItem, { item_kind: 'turn_completed' }>['outcome'],
): string {
  if (outcome === 'answered') return 'Answered';
  if (outcome === 'candidate_ready') return 'Draft ready';
  if (outcome === 'plan_proposed') return 'Plan ready';
  if (outcome === 'failed') return 'Could not finish';
  if (outcome === 'interrupted') return '已暂停';
  if (outcome === 'cancelled') return 'Stopped';
  return 'Responded';
}

function completionLabel(item: Extract<BuilderConversationItem, { item_kind: 'run_completed' }>): string {
  if (item.terminal_status === 'failed') return 'Could not finish';
  if (item.terminal_status === 'interrupted') return '已暂停';
  if (item.terminal_status === 'cancelled') return 'Stopped';
  if (item.result_kind === 'candidate') return 'Draft proposed';
  if (item.result_kind === 'plan') return 'Plan proposed';
  return 'Assistant';
}

function progressLabel(item: Extract<BuilderConversationItem, { item_kind: 'run_progress_recorded' }>): string {
  void item;
  return 'Assistant is working';
}

function progressBody(item: Extract<BuilderConversationItem, { item_kind: 'run_progress_recorded' }>): string {
  if (item.stage === 'context_ready') return 'Reading the current project context.';
  if (item.stage === 'provider_request_started') return 'Writing the response.';
  if (item.stage === 'provider_response_received') return 'Checking the response.';
  return 'Preparing the result for review.';
}

function agentStepTitle(
  item: Extract<BuilderConversationItem, { item_kind: 'agent_step_progress_recorded' }>,
): string {
  if (item.recorded_state === 'start_recorded') return 'Step started';
  if (item.result?.status === 'succeeded') return 'Step completed';
  if (item.result?.status === 'blocked') return 'Step needs attention';
  if (item.result?.status === 'cancelled') return 'Step stopped';
  return 'Step could not finish';
}

function agentStepBody(
  item: Extract<BuilderConversationItem, { item_kind: 'agent_step_progress_recorded' }>,
): string {
  if (item.recorded_state === 'start_recorded') {
    return 'This step was recorded as started.';
  }
  if (item.result?.status === 'succeeded') return 'This step completed.';
  if (item.result?.status === 'blocked') return 'This step needs your attention.';
  if (item.result?.status === 'cancelled') return 'This step was stopped.';
  return 'This step could not finish.';
}

type ActivityWorkStatus = 'started' | BuilderConversationRunProgressStage;

type ActivityWorkStatusEntry = {
  entry_kind: 'work_status';
  key: string;
  sequence: number;
  turnId: string;
  runId: string;
  status: ActivityWorkStatus;
  hidden: boolean;
};

type ActivityItemEntry = {
  entry_kind: 'item';
  key: string;
  item: BuilderConversationItem;
  hidden: boolean;
};

type ActivityRunHistoryEntry = {
  entry_kind: 'run_history';
  key: string;
  runKey: string;
  items: readonly BuilderConversationItem[];
};

type ActivityEntry =
  | ActivityItemEntry
  | ActivityRunHistoryEntry
  | ActivityWorkStatusEntry;

function shouldShowLiveOutput(
  liveOutput: BuilderLiveOutputSnapshot | null,
): liveOutput is BuilderLiveOutputSnapshot {
  if (liveOutput === null) return false;
  if (liveOutput.text.length > 0) return true;
  return liveOutput.waiting_text !== undefined;
}

function ActivityGlyph({ item }: Readonly<{ item: BuilderConversationItem }>) {
  if (item.item_kind === 'user_message') return <UserRound className="size-3.5" />;
  if (item.item_kind === 'transcript_message') {
    return item.role === 'user' ? <UserRound className="size-3.5" /> : <Bot className="size-3.5" />;
  }
  if (item.item_kind === 'queued_followup_consumed') return <CheckCircle2 className="size-3.5" />;
  if (item.item_kind === 'run_started') return <Play className="size-3.5" />;
  if (item.item_kind === 'run_context_snapshot_recorded') return <ListChecks className="size-3.5" />;
  if (item.item_kind === 'run_progress_recorded') return <RefreshCw className="size-3.5" />;
  if (item.item_kind === 'run_control_requested') return <StopCircle className="size-3.5" />;
  if (item.item_kind === 'checkpoint_recorded') {
    return item.status === 'failed'
      ? <AlertCircle className="size-3.5" />
      : <ShieldCheck className="size-3.5" />;
  }
  if (item.item_kind === 'recovery_action_recorded') {
    if (item.phase === 'requested') {
      return <RefreshCw className="cf-builder-activity-spinner size-3.5" />;
    }
    return item.phase === 'completed'
      ? <CheckCircle2 className="size-3.5" />
      : <AlertCircle className="size-3.5" />;
  }
  if (item.item_kind === 'task_brief_updated') return <ListChecks className="size-3.5" />;
  if (item.item_kind === 'agent_step_progress_recorded') {
    if (item.recorded_state === 'start_recorded') {
      return <RefreshCw className="cf-builder-activity-spinner size-3.5" />;
    }
    if (item.result?.status === 'succeeded') return <CheckCircle2 className="size-3.5" />;
    if (item.result?.status === 'cancelled') return <StopCircle className="size-3.5" />;
    return <AlertCircle className="size-3.5" />;
  }
  if (item.item_kind === 'tool_call_requested') {
    return <RefreshCw className="cf-builder-activity-spinner size-3.5" />;
  }
  if (item.item_kind === 'tool_call_result_recorded') {
    if (item.result.status === 'succeeded') return <CheckCircle2 className="size-3.5" />;
    if (item.result.status === 'cancelled') return <StopCircle className="size-3.5" />;
    return <AlertCircle className="size-3.5" />;
  }
  if (item.item_kind === 'programming_runtime_tool_activity') {
    if (item.state === 'running') {
      return <RefreshCw className="cf-builder-activity-spinner size-3.5" />;
    }
    if (item.state === 'failed' || item.check_result?.status === 'failed') {
      return <AlertCircle className="size-3.5" />;
    }
    return <CheckCircle2 className="size-3.5" />;
  }
  if (item.item_kind === 'programming_runtime_assistant_message') {
    return <Bot className="size-3.5" />;
  }
  if (item.item_kind === 'programming_runtime_status') {
    if (item.status_kind === 'failure') return <AlertCircle className="size-3.5" />;
    if (item.status_kind === 'cancelled') return <StopCircle className="size-3.5" />;
    if (item.status_kind === 'attention') return <AlertCircle className="size-3.5" />;
    return <RefreshCw className="cf-builder-activity-spinner size-3.5" />;
  }
  if (item.item_kind === 'context_compaction_recorded') return <Archive className="size-3.5" />;
  if (item.item_kind === 'candidate_reviewed') {
    return item.decision === 'accepted'
      ? <CheckCircle2 className="size-3.5" />
      : <AlertCircle className="size-3.5" />;
  }
  if (item.item_kind === 'plan_reviewed') {
    return item.decision === 'approved'
      ? <CheckCircle2 className="size-3.5" />
      : <AlertCircle className="size-3.5" />;
  }
  if (item.item_kind === 'run_completed' && item.terminal_status === 'interrupted') {
    return <Pause className="size-3.5" />;
  }
  if (item.item_kind === 'run_completed' && item.terminal_status !== 'succeeded') {
    return <AlertCircle className="size-3.5" />;
  }
  if (item.item_kind === 'run_completed') return <Bot className="size-3.5" />;
  return <CheckCircle2 className="size-3.5" />;
}

type BuilderActivityNodeKind =
  | 'checkpoint_event'
  | 'message'
  | 'product_fact'
  | 'reasoning'
  | 'tool_evidence'
  | 'turn_tail';

function activityNodeKind(item: BuilderConversationItem): BuilderActivityNodeKind {
  if (item.item_kind === 'user_message') return 'message';
  if (item.item_kind === 'transcript_message') return 'message';
  if (item.item_kind === 'programming_runtime_assistant_message') return 'message';
  if (item.item_kind === 'run_completed' && item.assistant_message !== null) return 'message';
  if (item.item_kind === 'programming_runtime_status' && item.status_kind === 'reasoning') return 'reasoning';
  if (item.item_kind === 'checkpoint_recorded') return 'checkpoint_event';
  if (
    item.item_kind === 'tool_call_requested'
    || item.item_kind === 'tool_call_result_recorded'
    || item.item_kind === 'programming_runtime_tool_activity'
  ) {
    return 'tool_evidence';
  }
  if (item.item_kind === 'turn_completed') return 'turn_tail';
  return 'product_fact';
}

function checkpointTurnEventKind(
  item: Extract<BuilderConversationItem, { item_kind: 'checkpoint_recorded' }>,
): 'created' | 'failed' | 'updated' {
  if (item.status === 'failed') return 'failed';
  return item.status === 'created' ? 'created' : 'updated';
}

function activityTitle(item: BuilderConversationItem): string {
  if (item.item_kind === 'user_message') {
    if (item.message_kind === 'steering') return 'You added context';
    if (item.message_kind === 'queued_followup') return 'You queued a follow-up';
    return 'You';
  }
  if (item.item_kind === 'transcript_message') return item.role === 'user' ? 'You' : 'Assistant';
  if (item.item_kind === 'queued_followup_consumed') return 'Follow-up picked up';
  if (item.item_kind === 'run_started') return 'Assistant is working';
  if (item.item_kind === 'run_context_snapshot_recorded') return 'Why this ran';
  if (item.item_kind === 'programming_run_admitted') return 'Execution approved';
  if (item.item_kind === 'run_progress_recorded') return progressLabel(item);
  if (item.item_kind === 'run_control_requested') {
    return item.action === 'interrupt' ? 'Interrupt requested' : 'Stop requested';
  }
  if (item.item_kind === 'checkpoint_recorded') {
    if (item.status === 'failed') return '检查点保存失败';
    return item.status === 'created' ? '检查点已创建' : '检查点已更新';
  }
  if (item.item_kind === 'recovery_action_recorded') {
    if (item.action === 'restore_checkpoint') {
      if (item.phase === 'requested') return '正在恢复上个检查点';
      return item.phase === 'completed' ? '已恢复上个检查点' : '检查点恢复失败';
    }
    if (item.phase === 'requested') return '正在恢复历史版本';
    return item.phase === 'completed' ? '已恢复历史版本' : '历史版本恢复失败';
  }
  if (item.item_kind === 'task_brief_updated') return 'Direction updated';
  if (item.item_kind === 'agent_step_progress_recorded') return agentStepTitle(item);
  if (item.item_kind === 'tool_call_requested') return toolRequestTitle(item);
  if (item.item_kind === 'tool_call_result_recorded') return toolResultTitle(item);
  if (item.item_kind === 'programming_runtime_tool_activity') {
    if (item.state === 'running') return item.status_label ?? item.active_label;
    if (item.state === 'completed') return item.completed_label;
    return item.target_label === null
      ? 'This step could not finish'
      : `Could not finish ${item.target_label}`;
  }
  if (item.item_kind === 'programming_runtime_assistant_message') return 'Assistant';
  if (item.item_kind === 'programming_runtime_status') {
    return item.status_kind === 'reasoning' ? 'Think' : item.status;
  }
  if (item.item_kind === 'context_compaction_recorded') {
    return item.status === 'compaction_completed'
      ? 'Context compacted'
      : 'Context already compact';
  }
  if (item.item_kind === 'candidate_reviewed') {
    return item.decision === 'accepted' ? 'Version saved' : 'Draft rejected';
  }
  if (item.item_kind === 'plan_reviewed') {
    return item.decision === 'approved' ? 'Plan approved' : 'Plan rejected';
  }
  if (item.item_kind === 'run_completed') return completionLabel(item);
  return outcomeLabel(item.outcome);
}

function activityRecoveryTone(item: BuilderConversationItem): 'success' | 'pending' | 'failure' | undefined {
  if (item.item_kind === 'checkpoint_recorded') {
    return item.status === 'failed' ? 'failure' : 'success';
  }
  if (item.item_kind === 'recovery_action_recorded') {
    if (item.phase === 'requested') return 'pending';
    return item.phase === 'completed' ? 'success' : 'failure';
  }
  if (item.item_kind === 'run_control_requested') return 'pending';
  if (item.item_kind === 'candidate_reviewed') {
    return item.decision === 'accepted' ? 'success' : 'failure';
  }
  if (item.item_kind === 'context_compaction_recorded') return 'success';
  return undefined;
}

function BuilderComposerVersionDecisionCard({
  blockedMessage,
  canReject,
  canSave,
  discardLabel,
  onRejectDraft,
  onSave,
  saveLabel,
}: Readonly<{
  blockedMessage: string | null;
  canReject: boolean;
  canSave: boolean;
  discardLabel: string;
  onRejectDraft?: () => void;
  onSave?: () => void;
  saveLabel: string;
}>) {
  const showSaveAction = typeof onSave === 'function';
  const showDiscardAction = typeof onRejectDraft === 'function';
  if (!showSaveAction && !showDiscardAction) return null;
  return (
    <section
      aria-label="Review draft version"
      className="cf-builder-composer-version-decision"
      data-builder-composer-version-decision="true"
    >
      <div className="cf-builder-composer-version-strip">
        <span aria-hidden="true" className="cf-builder-composer-version-dot" />
        Draft ready for review
      </div>
      <div className="cf-builder-composer-version-body">
        <div className="cf-builder-composer-version-copy">
          <h2>Save this draft?</h2>
          <p>Save it as a project version, or discard it and keep the previous version.</p>
          {blockedMessage !== null ? (
            <p
              className="cf-builder-composer-version-warning"
              data-builder-composer-version-blocked="true"
              role="status"
            >
              {blockedMessage}
            </p>
          ) : null}
        </div>
        <div className="cf-builder-composer-version-actions">
          {showDiscardAction ? (
            <button
              className="cf-builder-composer-version-button cf-builder-composer-version-button-secondary"
              data-builder-discard-draft="true"
              disabled={!canReject}
              onClick={onRejectDraft}
              type="button"
            >
              <Trash2 aria-hidden="true" className="size-3.5" />
              {discardLabel}
            </button>
          ) : null}
          {showSaveAction ? (
            <button
              className="cf-builder-composer-version-button cf-builder-composer-version-button-primary"
              data-builder-save-version="true"
              disabled={!canSave}
              onClick={onSave}
              type="button"
            >
              <Save aria-hidden="true" className="size-3.5" />
              {saveLabel}
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}

type BuilderToolActivityAction = Extract<
  BuilderConversationItem,
  { item_kind: 'tool_call_requested' | 'tool_call_result_recorded' }
>['action'];

function toolActivitySubject(action: BuilderToolActivityAction): string {
  if (action === 'context.read' || action === 'project.read') {
    return 'Project check';
  }
  if (action === 'filesystem.read') return 'File check';
  if (action === 'project.edit' || action === 'filesystem.write') return 'Change step';
  if (action === 'secret.read' || action === 'permission.grant') return 'Access check';
  if (action === 'network.request') return 'Online step';
  if (action === 'process.spawn') return 'Local step';
  if (action === 'publication.create') return 'Publish step';
  return 'Project step';
}

function toolRequestTitle(
  item: Extract<BuilderConversationItem, { item_kind: 'tool_call_requested' }>,
): string {
  if (item.action === 'context.read' || item.action === 'project.read') return 'Looking over the project';
  if (item.action === 'filesystem.read') return 'Reading project files';
  if (item.action === 'project.edit' || item.action === 'filesystem.write') return 'Preparing changes';
  if (item.action === 'secret.read' || item.action === 'permission.grant') return 'Checking access';
  if (item.action === 'network.request') return 'Checking online information';
  if (item.action === 'process.spawn') return 'Running a local step';
  if (item.action === 'publication.create') return 'Preparing to publish';
  return 'Preparing project work';
}

function toolRequestBody(
  item: Extract<BuilderConversationItem, { item_kind: 'tool_call_requested' }>,
): string {
  if (item.action === 'context.read' || item.action === 'project.read') {
    return 'I am checking the current project context.';
  }
  if (item.action === 'filesystem.read') return 'I am checking the files needed for this request.';
  if (item.action === 'project.edit' || item.action === 'filesystem.write') {
    return 'I am getting the project changes ready.';
  }
  if (item.action === 'secret.read' || item.action === 'permission.grant') {
    return 'I am checking whether this step is allowed.';
  }
  if (item.action === 'network.request') return 'I am preparing an online step for this request.';
  if (item.action === 'process.spawn') return 'I am preparing a local project command.';
  if (item.action === 'publication.create') return 'I am preparing the publish step.';
  return 'I am preparing this project step.';
}

function toolResultTitle(
  item: Extract<BuilderConversationItem, { item_kind: 'tool_call_result_recorded' }>,
): string {
  if (item.action === 'context.read' || item.action === 'project.read') {
    if (item.result.status === 'succeeded') return 'Project context ready';
    if (item.result.status === 'cancelled') return 'Project context stopped';
    return 'Project context needs attention';
  }
  if (item.action === 'filesystem.read') {
    if (item.result.status === 'succeeded') return 'Project files reviewed';
    if (item.result.status === 'cancelled') return 'Project file check stopped';
    return 'Project files need attention';
  }
  if (item.action === 'project.edit' || item.action === 'filesystem.write') {
    if (item.result.status === 'succeeded') return 'Changes ready';
    if (item.result.status === 'cancelled') return 'Change step stopped';
    return 'Changes need attention';
  }
  const subject = toolActivitySubject(item.action);
  if (item.result.status === 'succeeded') return `${subject} finished`;
  if (item.result.status === 'cancelled') return `${subject} stopped`;
  return `${subject} needs attention`;
}

function toolResultBody(
  item: Extract<BuilderConversationItem, { item_kind: 'tool_call_result_recorded' }>,
): string {
  if (item.result.summary_code === 'completed_without_raw_output') {
    if (item.action === 'context.read' || item.action === 'project.read') {
      return 'I checked the project context needed for this request.';
    }
    if (item.action === 'filesystem.read') {
      return 'I checked the project files needed for this request.';
    }
    if (item.action === 'project.edit' || item.action === 'filesystem.write') {
      return 'The project changes are ready for review.';
    }
    return 'This project step finished.';
  }
  if (item.result.summary_code === 'output_rejected') {
    return 'I could not safely use the information from this step.';
  }
  if (item.result.summary_code === 'adapter_unavailable') {
    return 'This project step is not available yet.';
  }
  if (item.result.summary_code === 'timed_out_without_raw_output') {
    return 'This project step took too long and stopped.';
  }
  if (item.result.summary_code === 'cancelled_without_raw_output') {
    return 'This project step was stopped.';
  }
  return 'This project step could not finish.';
}

function runContextSnapshotBody(
  item: Extract<BuilderConversationItem, { item_kind: 'run_context_snapshot_recorded' }>,
): string {
  const intent = item.context.route === 'build'
    ? 'Builder treated this as a change request.'
    : item.context.route === 'plan'
      ? 'Builder prepared a plan instead of changing files.'
      : item.context.route === 'update_brief'
        ? 'Builder updated the current brief from this discussion.'
        : item.context.route === 'clarify'
          ? 'Builder kept this as a clarification step.'
          : 'Builder kept this as chat.';
  const downgrade = item.context.downgrade_reason === 'missing_prior_build_context'
    ? 'It did not have enough confirmed direction to start changing files.'
    : item.context.downgrade_reason === 'workspace_required'
      ? 'Builder needed a project folder before it could change files.'
      : item.context.downgrade_reason === 'ambiguous_build_intent'
        ? 'Builder kept this as discussion because the change intent was not clear enough.'
        : '';
  const brief = item.context.brief === 'available'
    ? 'The current brief was attached.'
    : 'No current brief was attached.';
  const base = item.context.base === 'project_revision'
    ? 'It used the current project version.'
    : 'It used the selected unsaved workspace.';
  const permission = item.context.permission_result === 'allowed'
    ? 'Builder was allowed to write in the selected project.'
    : item.context.permission_result === 'ask'
      ? 'Builder still needed write approval.'
      : item.context.permission_result === 'denied'
        ? 'Write access was not allowed.'
        : 'No write access was needed.';
  return [intent, downgrade, brief, base, permission, 'No terminal commands or network access were used.']
    .filter(Boolean)
    .join(' ');
}

function activityBody(item: BuilderConversationItem): string {
  if (item.item_kind === 'user_message') return item.message.text;
  if (item.item_kind === 'transcript_message') return item.message.text;
  if (item.item_kind === 'queued_followup_consumed') {
    return 'The queued follow-up moved into the next request.';
  }
  if (item.item_kind === 'run_started') return 'Preparing this request.';
  if (item.item_kind === 'run_context_snapshot_recorded') return runContextSnapshotBody(item);
  if (item.item_kind === 'programming_run_admitted') return 'The approved plan can now run.';
  if (item.item_kind === 'run_progress_recorded') return progressBody(item);
  if (item.item_kind === 'run_control_requested') {
    return item.action === 'interrupt'
      ? 'You asked to steer the current work.'
      : 'You asked to stop the current work.';
  }
  if (item.item_kind === 'checkpoint_recorded') {
    if (item.status === 'failed') return '草稿仍可审查，但本轮没有生成新的恢复点。';
    const files = `${item.changed_file_count} 个文件`;
    return item.verification_status === 'candidate_verified_with_warnings'
      ? `${files}已受到保护，验证包含警告。`
      : `${files}已受到保护，可以继续修改或恢复。`;
  }
  if (item.item_kind === 'recovery_action_recorded') {
    if (item.phase === 'requested') return '正在准备一个可审查的新草稿。';
    if (item.phase === 'completed') return '恢复结果已写入当前项目，并保留为可审查草稿。';
    return '项目没有完成恢复，原有版本与恢复点仍然保留。';
  }
  if (item.item_kind === 'task_brief_updated') return item.brief.summary;
  if (item.item_kind === 'agent_step_progress_recorded') return agentStepBody(item);
  if (item.item_kind === 'tool_call_requested') return toolRequestBody(item);
  if (item.item_kind === 'tool_call_result_recorded') return toolResultBody(item);
  if (item.item_kind === 'programming_runtime_tool_activity') {
    if (item.check_result !== null) return item.check_result.summary;
    if (item.file_change !== null) {
      return `+${item.file_change.added_lines} -${item.file_change.deleted_lines}`;
    }
    return item.summary ?? '';
  }
  if (item.item_kind === 'programming_runtime_assistant_message') return item.message.text;
  if (item.item_kind === 'programming_runtime_status') {
    if (item.status_kind === 'reasoning') return item.status;
    if (item.status_kind === 'attention') return '需要你完成这一步后，任务才能继续。';
    if (item.status_kind === 'failure') return '本轮已经结束，可以查看上方活动后重试。';
    if (item.status_kind === 'cancelled') return '本轮已停止。';
    return '';
  }
  if (item.item_kind === 'context_compaction_recorded') {
    if (item.status === 'compaction_not_needed') {
      return '当前 Harness 会话判断无需新增压缩摘要。';
    }
    const shadowedTokens = item.shadowed_token_count === null
      ? 'some prior context'
      : `${item.shadowed_token_count.toLocaleString()} tokens`;
    return `Harness compacted ${shadowedTokens}; Builder is waiting for the next context usage projection.`;
  }
  if (item.item_kind === 'candidate_reviewed') {
    if (item.decision === 'accepted') {
      const revisionNumber = item.saved_revision?.revision_number;
      return revisionNumber === undefined
        ? 'This draft was saved as a version.'
        : `This draft was saved as Version ${revisionNumber}.`;
    }
    return 'The draft was discarded and is no longer available for review.';
  }
  if (item.item_kind === 'plan_reviewed') {
    return item.decision === 'approved'
      ? 'The plan was approved. The project has not changed yet.'
      : 'The plan was rejected. The project has not changed.';
  }
  if (item.item_kind === 'run_completed') {
    if (item.terminal_status === 'interrupted') return '上次运行已中断，任务记录已保留。';
    return item.assistant_message?.text
      ?? (item.terminal_status === 'succeeded'
        ? 'The assistant finished this step.'
        : 'The request did not finish.');
  }
  return `${outcomeLabel(item.outcome)}.`;
}

function activityDisplayRole(item: BuilderConversationItem): 'assistant' | 'status' | 'user' {
  if (item.item_kind === 'user_message') return 'user';
  if (item.item_kind === 'transcript_message') return item.role;
  if (item.item_kind === 'programming_runtime_assistant_message') return 'assistant';
  if (item.item_kind === 'run_completed' && item.assistant_message !== null) return 'assistant';
  return 'status';
}

function failedStatusMessage(
  status: BuilderProjectControllerStatus,
  error: BuilderProjectControllerSnapshot['error'],
): string {
  if (status === 'answer_failed') {
    if (error === 'builder_generation_provider_unavailable') return '尚未配置 AI 服务。';
    if (error === 'builder_generation_timeout') return '回答超时，请重试。';
    if (error === 'builder_generation_runtime_stalled') return '编码运行长时间没有新进展，请查看上方活动后重试。';
    if (error === 'builder_generation_run_limit_reached') return '本轮已达到运行上限，请查看上方活动后继续或重试。';
    if (error === 'builder_generation_provider_http_error') return 'AI 服务拒绝了请求，请检查 API Key、模型或账户状态。';
    if (error === 'builder_generation_provider_transport_error') return '无法连接 AI 服务，请检查网络或代理后重试。';
    return '暂时无法完成回答，请重试。';
  }
  if (status === 'submit_failed') {
    if (error === 'builder_generation_project_workspace_required') return '开始构建前，请先选择或打开项目文件夹。';
    if (error === 'builder_generation_project_write_permission_required') return '开始构建前，请允许修改当前项目。';
    if (error === 'builder_generation_workspace_changed') return '工作期间项目发生了变化，请检查后重试。';
    if (error === 'builder_generation_source_context_unavailable') return '上一次原生会话无法恢复，请明确重新开始恢复运行。';
    if (error === 'builder_generation_workspace_guard_denied') return '为保护项目，本次文件修改已被阻止。';
    if (error === 'builder_generation_workspace_guard_approval_required') return '这些文件修改需要额外确认后才能继续。';
    if (error === 'builder_generation_provider_unavailable') return '尚未配置 AI 服务。';
    if (error === 'builder_generation_timeout') return '本次处理超时，请重试。';
    if (error === 'builder_generation_runtime_stalled') return '编码运行长时间没有新进展，请查看上方活动后重试。';
    if (error === 'builder_generation_run_limit_reached') return '本轮已达到运行上限，请查看上方活动后继续或重试。';
    if (error === 'builder_generation_provider_http_error') return 'AI 服务拒绝了请求，请检查 API Key、模型或账户状态。';
    if (error === 'builder_generation_provider_transport_error') return '无法连接 AI 服务，请检查网络或代理后重试。';
    if (error === 'builder_generation_static_preview_contract_rejected') return '此结果需要 Browser 预览支持，当前草稿已保留。';
    return '本次请求未能完成，请重试。';
  }
  if (error === 'builder_generation_project_workspace_required') return '生成草稿前，请先选择或打开项目文件夹。';
  if (error === 'builder_generation_project_write_permission_required') return '生成草稿前，请允许修改当前项目。';
  if (error === 'builder_generation_workspace_changed') return '工作期间项目发生了变化，请检查后重试。';
  if (error === 'builder_generation_source_context_unavailable') return '上一次原生会话无法恢复，请明确重新开始恢复运行。';
  if (error === 'builder_generation_workspace_guard_denied') return '为保护项目，本次文件修改已被阻止。';
  if (error === 'builder_generation_workspace_guard_approval_required') return '这些文件修改需要额外确认后才能继续。';
  if (error === 'builder_generation_provider_unavailable') return '尚未配置 AI 服务。';
  if (error === 'builder_generation_timeout') return '生成草稿超时，请重试。';
  if (error === 'builder_generation_runtime_stalled') return '编码运行长时间没有新进展，请查看上方活动后重试。';
  if (error === 'builder_generation_run_limit_reached') return '本轮已达到运行上限，请查看上方活动后继续或重试。';
  if (error === 'builder_generation_provider_http_error') return 'AI 服务拒绝了请求，请检查 API Key、模型或账户状态。';
  if (error === 'builder_generation_provider_transport_error') return '无法连接 AI 服务，请检查网络或代理后重试。';
  if (error === 'builder_generation_static_preview_contract_rejected') return '此结果需要 Browser 预览支持，当前草稿已保留。';
  if (error === 'builder_generation_structured_response_invalid') return '草稿内容未通过校验，请重试。';
  return '草稿未能生成，请重试。';
}

function approvedPlanContinuationFailureMessage(
  error: BuilderProjectControllerSnapshot['error'],
): string {
  if (error === 'builder_generation_provider_unavailable') {
    return '计划已批准，但尚未配置 AI 服务。';
  }
  if (error === 'builder_generation_timeout') {
    return '计划已批准，但生成草稿超时；重试后会从该计划继续。';
  }
  if (error === 'builder_generation_runtime_stalled') {
    return '计划已批准，但编码运行长时间没有新进展，请查看活动后重试。';
  }
  if (error === 'builder_generation_run_limit_reached') {
    return '计划已批准，但本轮已达到运行上限，请查看活动后继续或重试。';
  }
  return '计划已批准，但草稿未能生成；重试后会从该计划继续。';
}

function VersionItem({
  inspectedRevisionReceiptDigest,
  onInspectRevision,
  onRestoreRevisionAsDraft,
  revision,
  restoreDisabled,
}: Readonly<{
  inspectedRevisionReceiptDigest: string | null;
  onInspectRevision?: (projectId: string, revisionReceiptDigest: string) => Promise<unknown> | void;
  onRestoreRevisionAsDraft?: (projectId: string, revisionReceiptDigest: string) => Promise<unknown> | void;
  revision: BuilderProjectHistoryRevision;
  restoreDisabled: boolean;
}>) {
  const isInspected = inspectedRevisionReceiptDigest === revision.revision_receipt_digest;
  const showAction = isInspected || !revision.is_current;
  const canInspect = !isInspected
    && !revision.is_current
    && typeof onInspectRevision === 'function';
  const canRestore = !revision.is_current
    && !restoreDisabled
    && typeof onRestoreRevisionAsDraft === 'function';
  return (
    <li
      className="cf-builder-version-item"
      data-builder-version-card={`Version ${revision.revision_number}`}
      data-builder-inspected-version={isInspected ? 'true' : undefined}
    >
      <div className="cf-builder-activity-icon" aria-hidden="true">
        <History className="size-3.5" />
      </div>
      <div className="min-w-0">
        <div className="cf-builder-version-title">
          <span className="truncate">Version {revision.revision_number}</span>
          {revision.is_current ? (
            <span className="cf-builder-version-current">Current</span>
          ) : null}
        </div>
        <p className="cf-builder-version-name">{revision.title}</p>
        <p className="cf-builder-version-summary">{revision.summary}</p>
      </div>
      {showAction ? (
        <div className="cf-builder-version-actions flex shrink-0 items-center gap-1">
          <button
            className="cf-builder-secondary-button inline-flex min-h-8 shrink-0 items-center justify-center px-2.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50"
            data-builder-show-current-version={revision.is_current ? 'true' : undefined}
            data-builder-view-version={revision.is_current ? undefined : `Version ${revision.revision_number}`}
            disabled={!canInspect}
            onClick={() => {
              void onInspectRevision?.(revision.project_id, revision.revision_receipt_digest);
            }}
            type="button"
          >
            {isInspected ? 'Viewing' : 'View'}
          </button>
          {!revision.is_current ? (
            <button
              className="cf-builder-primary-button inline-flex min-h-8 shrink-0 items-center justify-center px-2.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50"
              data-builder-restore-version={`Version ${revision.revision_number}`}
              disabled={!canRestore}
              onClick={() => {
                void onRestoreRevisionAsDraft?.(revision.project_id, revision.revision_receipt_digest);
              }}
              type="button"
            >
              Restore
            </button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function VersionHistoryPanel({
  canUndo,
  draftCheckpointStatus,
  draftCheckpointTimeline,
  hasSavedProject,
  hasUnsavedDraft,
  inspectedRevisionReceiptDigest,
  onInspectRevision,
  onRefresh,
  onRestoreRevisionAsDraft,
  onUndoDraft,
  snapshot,
}: Readonly<{
  canUndo: boolean;
  draftCheckpointStatus: BuilderDraftCheckpointStatusProjectionWire | null;
  draftCheckpointTimeline: BuilderDraftCheckpointTimelineProjectionWire | null;
  hasSavedProject: boolean;
  hasUnsavedDraft: boolean;
  inspectedRevisionReceiptDigest: string | null;
  onInspectRevision?: (projectId: string, revisionReceiptDigest: string) => Promise<unknown> | void;
  onRefresh?: () => Promise<unknown> | void;
  onRestoreRevisionAsDraft?: (projectId: string, revisionReceiptDigest: string) => Promise<unknown> | void;
  onUndoDraft?: () => void;
  snapshot: BuilderProjectHistorySnapshot | null;
}>) {
  const revisions = snapshot?.history?.revisions ?? [];
  const earlierCheckpoints = draftCheckpointTimeline?.status === 'ready'
    ? draftCheckpointTimeline.entries.filter((entry) => !entry.is_current)
    : [];
  const message = projectHistoryMessage(snapshot, hasSavedProject);
  const canRefresh = hasSavedProject
    && snapshot !== null
    && snapshot.project_id !== null
    && !snapshot.busy
    && typeof onRefresh === 'function';
  return (
    <aside
      aria-label="Project history"
      className="cf-builder-version-panel"
      data-builder-project-history="true"
      data-builder-version-history="true"
      data-builder-version-history-status={snapshot?.status ?? 'idle'}
    >
      <header className="cf-builder-side-header">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">History</p>
          <h3 className="truncate text-sm font-semibold">Project history</h3>
          <p
            className="cf-builder-version-scope"
            data-builder-version-history-scope="true"
          >
            {hasUnsavedDraft
              ? 'Current work is protected automatically. Versions are optional milestones.'
              : 'Versions are optional milestones.'}
          </p>
        </div>
        <button
          aria-label="Refresh history"
          className="cf-builder-secondary-button cf-builder-icon-button inline-flex size-8 items-center justify-center disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!canRefresh}
          onClick={() => {
            void onRefresh?.();
          }}
          type="button"
        >
          <RefreshCw aria-hidden="true" className="size-3.5" />
        </button>
      </header>
      <div className="cf-builder-version-body-wrap">
        {snapshot?.status === 'refreshing' ? (
          <p className="cf-builder-version-status" role="status">Refreshing history...</p>
        ) : null}
        {hasUnsavedDraft && draftCheckpointStatus !== null ? (
          <section className="cf-builder-history-section" aria-labelledby="builder-current-work-history">
            <p className="cf-builder-history-section-label" id="builder-current-work-history">Current work</p>
            <div
              aria-label="Current work recovery"
              className="cf-builder-draft-recovery-card"
              data-builder-draft-recovery-card="true"
            >
              <div className="cf-builder-activity-icon" aria-hidden="true">
                <CheckCircle2 className="size-3.5" />
              </div>
              <div className="min-w-0">
                <div className="cf-builder-version-title">
                  <span className="truncate">Automatic recovery</span>
                  <span className="cf-builder-version-current">Now</span>
                </div>
                <p className="cf-builder-version-summary">
                  {draftCheckpointStatus.label}. {draftCheckpointStatus.changed_file_count}
                  {' '}
                  {draftCheckpointStatus.changed_file_count === 1 ? 'file' : 'files'} protected.
                </p>
              </div>
              <button
                aria-label="Undo to the previous checkpoint"
                className="cf-builder-secondary-button cf-builder-history-undo-button"
                data-builder-history-undo="true"
                disabled={!canUndo}
                onClick={onUndoDraft}
                title="Undo to the previous checkpoint"
                type="button"
              >
                <Undo2 aria-hidden="true" className="size-3.5" />
                <span>Undo</span>
              </button>
            </div>
            {earlierCheckpoints.length > 0 ? (
              <ol
                aria-label="Earlier automatic checkpoints"
                className="cf-builder-checkpoint-timeline"
                data-builder-checkpoint-timeline="true"
              >
                {earlierCheckpoints.map((checkpoint) => (
                  <li
                    className="cf-builder-checkpoint-timeline-item"
                    data-builder-checkpoint-sequence={checkpoint.checkpoint_sequence}
                    key={checkpoint.checkpoint_sequence}
                  >
                    <span className="cf-builder-checkpoint-timeline-marker" aria-hidden="true" />
                    <div className="min-w-0">
                      <div className="cf-builder-checkpoint-timeline-title">
                        <span>Checkpoint {checkpoint.checkpoint_sequence}</span>
                        <time dateTime={new Date(checkpoint.created_at_ms).toISOString()}>
                          {new Intl.DateTimeFormat(undefined, {
                            hour: '2-digit',
                            minute: '2-digit',
                          }).format(checkpoint.created_at_ms)}
                        </time>
                      </div>
                      <p className="cf-builder-version-summary">
                        {checkpoint.changed_file_count}
                        {' '}
                        {checkpoint.changed_file_count === 1 ? 'file' : 'files'} protected
                        {checkpoint.verification_status === 'candidate_verified_with_warnings'
                          ? ' with warnings'
                          : ''}
                        .
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            ) : null}
            {draftCheckpointTimeline?.truncated === true ? (
              <p className="cf-builder-version-status">Older checkpoints are not shown.</p>
            ) : null}
          </section>
        ) : null}
        <p className="cf-builder-history-section-label">Milestones</p>
        {revisions.length === 0 ? (
          <div className="cf-builder-empty cf-builder-version-empty flex min-h-24 items-center justify-center border border-dashed px-3 text-center text-sm">
            {message ?? 'No milestone versions yet.'}
          </div>
        ) : (
          <ol className="cf-builder-version-list">
            {revisions.map((revision) => (
              <VersionItem
                inspectedRevisionReceiptDigest={inspectedRevisionReceiptDigest}
                key={revision.revision_receipt_digest}
                onInspectRevision={onInspectRevision}
                onRestoreRevisionAsDraft={onRestoreRevisionAsDraft}
                revision={revision}
                restoreDisabled={snapshot?.busy === true}
              />
            ))}
          </ol>
        )}
        {revisions.length > 0 && message !== null ? (
          <p className="cf-builder-version-status" role={snapshot?.status === 'stale' ? 'alert' : 'status'}>
            {message}
          </p>
        ) : null}
      </div>
    </aside>
  );
}

function ActivityItem({
  canUndoDraft,
  canReviewPlan,
  candidateChanges,
  checkRunProfile,
  checkRunStatus,
  hasUnsavedDraft,
  hasRuntimeFacts,
  isCurrentDraftCompletion,
  item,
  onOpenCandidateChange,
  onOpenCheckCommand,
  onOpenHistory,
  resolveRuntimeToolAction,
  onReviewPlan,
  onUndoDraft,
  planReviewBusy,
  planReviewFailed,
  planReviewRecorded,
  pendingPlanReview,
  planReviewDecision,
}: Readonly<{
  canUndoDraft: boolean;
  canReviewPlan: boolean;
  candidateChanges: readonly BuilderSourceTreeChange[];
  checkRunProfile: BuilderCheckRunProfile | null;
  checkRunStatus: BuilderDisplayedCheckStatus | null;
  hasUnsavedDraft: boolean;
  hasRuntimeFacts: boolean;
  isCurrentDraftCompletion: boolean;
  item: BuilderConversationItem;
  onOpenCandidateChange?: (change: BuilderSourceTreeChange) => void;
  onOpenCheckCommand?: () => void;
  onOpenHistory?: () => void;
  resolveRuntimeToolAction?: ResolveRuntimeToolAction;
  onReviewPlan?: (request: BuilderPlanReviewRequest) => Promise<unknown> | void;
  onUndoDraft?: () => void;
  planReviewBusy: boolean;
  planReviewFailed: boolean;
  planReviewRecorded: boolean;
  pendingPlanReview: BuilderPlanReviewRequest | null;
  planReviewDecision: BuilderPlanReviewDecision | null;
}>) {
  const nodeKind = activityNodeKind(item);
  const displayRole = activityDisplayRole(item);
  const title = activityTitle(item);
  const body = activityBody(item);
  const recoveryTone = activityRecoveryTone(item);
  const isRuntimeToolActivity = item.item_kind === 'programming_runtime_tool_activity';
  const isCheckpointEvent = item.item_kind === 'checkpoint_recorded';
  const activityItemClassName = [
    'cf-builder-activity-item',
    isRuntimeToolActivity ? 'cf-builder-tool-evidence-row' : null,
    isCheckpointEvent ? 'cf-builder-checkpoint-event-row' : null,
  ].filter(Boolean).join(' ');
  const messageSurface = displayRole === 'user'
    ? 'bubble'
    : displayRole === 'assistant'
      ? 'plain'
      : 'status';
  const showTitle = displayRole === 'status';
  const runtimeToolAction = item.item_kind === 'programming_runtime_tool_activity'
    ? resolveRuntimeToolAction?.(item) ?? null
    : null;
  const isAssistantMessage = item.item_kind === 'programming_runtime_assistant_message'
    || (item.item_kind === 'run_completed' && item.assistant_message !== null);
  const isPlanMessage = item.item_kind === 'run_completed'
    && item.assistant_message !== null
    && item.result_kind === 'plan';
  const itemPlanReviewKey = item.item_kind === 'run_completed' && item.result_kind === 'plan'
    ? planReviewKey(item.turn_id, item.run_id)
    : null;
  const showPlanReviewActions = item.item_kind === 'run_completed'
    && item.result_kind === 'plan'
    && pendingPlanReview !== null
    && itemPlanReviewKey === planReviewKey(pendingPlanReview.turn_id, pendingPlanReview.run_id);
  function review(decision: BuilderPlanReviewDecision): void {
    if (
      pendingPlanReview === null
      || typeof onReviewPlan !== 'function'
      || planReviewBusy
      || planReviewRecorded
    ) return;
    void onReviewPlan({ ...pendingPlanReview, decision });
  }

  return (
    <li
      className={activityItemClassName}
      data-builder-activity-card={title}
      data-builder-activity-role={displayRole}
      data-builder-checkpoint-animation={isCheckpointEvent && item.status !== 'failed' ? 'settle' : undefined}
      data-builder-checkpoint-turn-event={isCheckpointEvent ? checkpointTurnEventKind(item) : undefined}
      data-builder-conversation-node={nodeKind}
      data-builder-reasoning-row={nodeKind === 'reasoning' ? 'true' : undefined}
      data-builder-tool-activity={item.item_kind === 'tool_call_requested'
        ? 'requested'
        : item.item_kind === 'tool_call_result_recorded'
          ? item.result.status
          : item.item_kind === 'programming_runtime_tool_activity'
            ? item.state
          : undefined}
      data-builder-agent-step-progress={item.item_kind === 'agent_step_progress_recorded'
        ? item.recorded_state
        : undefined}
      data-builder-plan-markdown={isPlanMessage ? 'true' : undefined}
      data-builder-runtime-assistant-message={item.item_kind === 'programming_runtime_assistant_message'
        ? item.message.message_id
        : undefined}
      data-builder-runtime-tool-kind={item.item_kind === 'programming_runtime_tool_activity'
        ? item.tool_kind
        : undefined}
      data-builder-runtime-status={item.item_kind === 'programming_runtime_status'
        ? item.status_kind
        : undefined}
      data-builder-context-compaction={item.item_kind === 'context_compaction_recorded'
        ? item.status
        : undefined}
      data-builder-draft-checkpoint-status={item.item_kind === 'checkpoint_recorded'
        ? item.status === 'failed' ? 'failed' : 'ready'
        : undefined}
      data-builder-recovery-action={item.item_kind === 'run_control_requested'
        ? `${item.action}_requested`
        : item.item_kind === 'recovery_action_recorded'
          ? `${item.action}_${item.phase}`
        : item.item_kind === 'checkpoint_recorded'
          ? `checkpoint_${item.status}`
        : item.item_kind === 'candidate_reviewed'
          ? item.decision === 'accepted' ? 'version_saved' : 'draft_discarded'
          : undefined}
      data-builder-recovery-tone={recoveryTone}
      data-builder-run-completion-message={item.item_kind === 'run_completed'
        && item.assistant_message !== null
        ? item.run_id
        : undefined}
      data-builder-plan-review-decision={isPlanMessage && planReviewDecision !== null
        ? planReviewDecision
        : undefined}
    >
      <div className="cf-builder-activity-icon" aria-hidden="true">
        <ActivityGlyph item={item} />
      </div>
      <div
        className="cf-builder-activity-content min-w-0"
        data-builder-message-surface={messageSurface}
      >
        {item.item_kind === 'programming_runtime_tool_activity' ? (
          <RuntimeToolEvidenceContent item={item} action={runtimeToolAction} />
        ) : showTitle && runtimeToolAction !== null ? (
          <button
            className="cf-builder-activity-title cf-builder-runtime-activity-button cf-builder-tool-evidence-title"
            onClick={runtimeToolAction}
            type="button"
          >
            {title}
          </button>
        ) : showTitle ? (
          <div className={isRuntimeToolActivity
            ? 'cf-builder-activity-title cf-builder-tool-evidence-title'
            : 'cf-builder-activity-title'}>{title}</div>
        ) : null}
        {item.item_kind === 'programming_runtime_tool_activity' ? null : isAssistantMessage ? (
          <BuilderConversationMarkdown
            source={body}
            variant={isPlanMessage ? 'plan' : 'response'}
          />
        ) : body.length > 0 ? (
          <p className={isRuntimeToolActivity
            ? 'cf-builder-activity-body cf-builder-tool-evidence-detail'
            : 'cf-builder-activity-body'}>{body}</p>
        ) : null}
        {item.item_kind === 'checkpoint_recorded' && item.status !== 'failed' ? (
          <div
            aria-label="Checkpoint recovery actions"
            className="cf-builder-recovery-actions"
            data-builder-recovery-actions="checkpoint"
          >
            {typeof onUndoDraft === 'function' ? (
              <button
                aria-label="撤回到上一个检查点"
                className="cf-builder-recovery-action-button"
                data-builder-chat-undo-checkpoint="true"
                data-builder-recovery-action-command="undo_checkpoint"
                disabled={!canUndoDraft}
                onClick={onUndoDraft}
                title="撤回到上一个检查点"
                type="button"
              >
                <Undo2 aria-hidden="true" className="size-3.5" />
                <span>撤回</span>
              </button>
            ) : null}
            {typeof onOpenHistory === 'function' ? (
              <button
                aria-label="打开恢复历史"
                className="cf-builder-recovery-action-button"
                data-builder-chat-open-history="true"
                data-builder-recovery-action-command="open_history"
                onClick={onOpenHistory}
                title="打开恢复历史"
                type="button"
              >
                <History aria-hidden="true" className="size-3.5" />
                <span>历史</span>
              </button>
            ) : null}
          </div>
        ) : null}
        {item.item_kind === 'run_completed' && item.candidate !== null && !hasUnsavedDraft ? (
          <p className="cf-builder-activity-note">
            This older draft is no longer available in Review.
          </p>
        ) : null}
        {item.item_kind === 'run_completed' && item.assistant_message !== null ? (
          <BuilderTurnTailActions
            changes={isCurrentDraftCompletion && !hasRuntimeFacts ? candidateChanges : []}
            checkRunProfile={isCurrentDraftCompletion && !hasRuntimeFacts ? checkRunProfile : null}
            checkRunStatus={isCurrentDraftCompletion && !hasRuntimeFacts ? checkRunStatus : null}
            item={item}
            onOpenCandidateChange={onOpenCandidateChange}
            onOpenCheckCommand={onOpenCheckCommand}
          />
        ) : null}
        {showPlanReviewActions ? (
          <div
            className="cf-builder-plan-review-actions"
            data-builder-plan-review-actions="true"
            data-builder-plan-review-state={planReviewBusy
              ? 'recording'
              : planReviewRecorded
                ? 'recorded'
                : planReviewFailed ? 'failed' : 'ready'}
          >
            {planReviewBusy || planReviewRecorded || planReviewFailed ? (
              <p className="cf-builder-activity-note" role={planReviewFailed ? 'alert' : undefined}>
                {planReviewBusy
                  ? 'Recording your decision...'
                  : planReviewRecorded
                    ? 'Decision recorded. Updating the conversation...'
                    : 'That decision could not be recorded. Try again.'}
              </p>
            ) : null}
            <button
              className="cf-builder-primary-button inline-flex min-h-8 items-center justify-center gap-2 px-2.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50"
              data-builder-approve-plan="true"
              disabled={!canReviewPlan}
              onClick={() => review('approved')}
              type="button"
            >
              <CheckCircle2 aria-hidden="true" className="size-3.5" />
              Approve plan
            </button>
            <button
              className="cf-builder-secondary-button inline-flex min-h-8 items-center justify-center gap-2 px-2.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50"
              data-builder-reject-plan="true"
              disabled={!canReviewPlan}
              onClick={() => review('rejected')}
              type="button"
            >
              <AlertCircle aria-hidden="true" className="size-3.5" />
              Reject
            </button>
          </div>
        ) : null}
        {isPlanMessage && planReviewDecision !== null ? (
          <div
            className="cf-builder-plan-review-result"
            data-builder-plan-review-result={planReviewDecision}
          >
            {planReviewDecision === 'approved' ? (
              <CheckCircle2 aria-hidden="true" className="size-3.5" />
            ) : (
              <AlertCircle aria-hidden="true" className="size-3.5" />
            )}
            <span>
              <strong>{planReviewDecision === 'approved' ? 'Plan approved' : 'Plan rejected'}</strong>
              <small>
                {planReviewDecision === 'approved'
                  ? 'Continuing with the approved plan.'
                  : 'No project files were changed.'}
              </small>
            </span>
          </div>
        ) : null}
      </div>
    </li>
  );
}

function PendingUserMessageItem({
  message,
}: Readonly<{
  message: BuilderPendingUserMessage;
}>) {
  const title = message.message_kind === 'queued_followup'
    ? 'You queued a follow-up'
    : message.message_kind === 'steering'
      ? 'You added context'
      : 'You';
  return (
    <li
      className="cf-builder-activity-item"
      data-builder-activity-card={title}
      data-builder-activity-pending="true"
      data-builder-activity-role="user"
      data-builder-conversation-node="message"
    >
      <div className="cf-builder-activity-icon" aria-hidden="true">
        <UserRound className="size-3.5" />
      </div>
      <div className="cf-builder-activity-content min-w-0" data-builder-message-surface="bubble">
        <p className="cf-builder-activity-body">{message.text}</p>
      </div>
    </li>
  );
}

function BuilderTurnTailActions({
  changes,
  checkRunProfile,
  checkRunStatus,
  item,
  onOpenCandidateChange,
  onOpenCheckCommand,
}: Readonly<{
  changes: readonly BuilderSourceTreeChange[];
  checkRunProfile: BuilderCheckRunProfile | null;
  checkRunStatus: BuilderDisplayedCheckStatus | null;
  item: Extract<BuilderConversationItem, { item_kind: 'run_completed' }>;
  onOpenCandidateChange?: (change: BuilderSourceTreeChange) => void;
  onOpenCheckCommand?: () => void;
}>) {
  const [copied, setCopied] = useState(false);
  const messageText = item.assistant_message?.text ?? '';
  const canCopy = messageText.trim().length > 0;
  const hasWorkActions = changes.length > 0 || (checkRunProfile !== null && checkRunStatus !== null);

  function copyMessage(): void {
    if (!canCopy) return;
    const writeText = navigator.clipboard?.writeText;
    if (typeof writeText !== 'function') return;
    void writeText.call(navigator.clipboard, messageText).then(() => {
      setCopied(true);
    }).catch(() => undefined);
  }

  return (
    <div
      className="cf-builder-turn-tail"
      data-builder-turn-tail="true"
      data-builder-turn-tail-result={item.result_kind}
      data-builder-turn-tail-status={item.terminal_status}
    >
      <div className="cf-builder-turn-tail-bar" data-builder-message-actions="true">
        <button
          aria-label="Copy assistant response"
          className="cf-builder-turn-tail-button"
          data-builder-copy-run-message="true"
          disabled={!canCopy}
          onClick={copyMessage}
          title="Copy assistant response"
          type="button"
        >
          <Copy aria-hidden="true" className="size-3.5" />
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
        <span className="cf-builder-turn-tail-meta" data-builder-turn-tail-meta="true">
          {completionLabel(item)}
        </span>
      </div>
      {hasWorkActions ? (
        <ol className="cf-builder-turn-tail-work-list" data-builder-turn-tail-work="true">
          <ActivityCompletedActions
            changes={changes}
            checkRunProfile={checkRunProfile}
            checkRunStatus={checkRunStatus}
            onOpenCandidateChange={onOpenCandidateChange}
            onOpenCheckCommand={onOpenCheckCommand}
          />
        </ol>
      ) : null}
    </div>
  );
}

function TaskConversationSeedPanel({ task }: Readonly<{ task: BuilderTaskConversationSeed }>) {
  const waitingToStart = task.waiting_to_start;
  return (
    <section
      aria-label="Task conversation start"
      className="cf-builder-activity-panel cf-builder-chat-flow-surface"
      data-builder-task-conversation-seed={task.task_address_id}
    >
      <div className="cf-builder-activity-body-wrap">
        <ol className="cf-builder-activity-list">
          <li
            className="cf-builder-activity-item"
            data-builder-activity-role="user"
            data-builder-task-seed-message="true"
          >
            <div className="cf-builder-activity-icon" aria-hidden="true">
              <UserRound className="size-3.5" />
            </div>
            <div
              className="cf-builder-activity-content min-w-0"
              data-builder-message-surface="bubble"
            >
              <p className="cf-builder-activity-body">{task.goal}</p>
            </div>
          </li>
          <li
            className="cf-builder-activity-item"
            data-builder-activity-role="status"
            data-builder-task-seed-status={waitingToStart ? 'draft' : 'active'}
          >
            <div className="cf-builder-activity-icon" aria-hidden="true">
              <Circle className="size-3.5" />
            </div>
            <div className="cf-builder-activity-content min-w-0" data-builder-message-surface="status">
              <div className="cf-builder-activity-title">{waitingToStart ? 'Task ready' : 'Task context'}</div>
              <p className="cf-builder-activity-body">
                {waitingToStart
                  ? 'Created from the Agent workbench. It has not started yet.'
                  : 'This task has no recorded conversation activity yet.'}
              </p>
            </div>
          </li>
        </ol>
      </div>
    </section>
  );
}

function ActivityLiveOutputItem({
  liveOutput,
}: Readonly<{
  liveOutput: BuilderLiveOutputSnapshot;
}>) {
  const hasText = liveOutput.text.length > 0;
  const waitingText = liveOutput.waiting_text ?? '正在处理当前任务';
  const activityKind = liveOutput.activity_kind ?? null;
  const contextCompacting = activityKind === 'context_compacting';
  const contextCompacted = activityKind === 'context_compacted';
  return (
    <li
      className="cf-builder-activity-item"
      data-builder-activity-card="Assistant live output"
      data-builder-activity-role="assistant"
      data-builder-live-output="true"
      data-builder-live-output-state={hasText ? 'text' : 'waiting'}
    >
      <div
        className="cf-builder-activity-content min-w-0"
        data-builder-message-surface="plain"
      >
        <p
          className="cf-builder-live-activity-status"
          data-builder-live-activity="true"
          data-builder-live-activity-kind={activityKind ?? undefined}
          role="status"
        >
          {contextCompacting ? (
            <ListCollapse
              aria-hidden="true"
              className="cf-builder-context-compaction-icon size-3.5"
              data-builder-context-compaction-animation="true"
            />
          ) : contextCompacted ? (
            <CheckCircle2
              aria-hidden="true"
              className="cf-builder-context-compacted-icon size-3.5"
              data-builder-context-compacted="true"
            />
          ) : (
            <RefreshCw aria-hidden="true" className="cf-builder-activity-spinner size-3.5" />
          )}
          <span>{waitingText}</span>
        </p>
        <div className="cf-builder-live-output-text" aria-live="polite">
          {hasText ? (
            <BuilderConversationMarkdown source={liveOutput.text} />
          ) : null}
        </div>
      </div>
    </li>
  );
}

const subscribeToNoLiveOutput = () => () => undefined;
const readNoLiveOutput = () => null;

function remainingLiveOutput(
  liveOutput: BuilderLiveOutputSnapshot | null,
  committedPrefix: string,
): BuilderLiveOutputSnapshot | null {
  if (liveOutput === null || committedPrefix.length === 0) return liveOutput;
  if (!liveOutput.text.startsWith(committedPrefix)) return liveOutput;
  const remaining = liveOutput.text.slice(committedPrefix.length);
  return Object.freeze({ ...liveOutput, text: remaining });
}

function ActivityLiveOutputSlot({
  committedPrefix,
  fallback,
  onVisibleFrame,
  store,
}: Readonly<{
  committedPrefix: string;
  fallback: BuilderLiveOutputSnapshot | null;
  onVisibleFrame?: () => void;
  store: BuilderLiveOutputStore | null;
}>) {
  const stored = useSyncExternalStore(
    store?.subscribe ?? subscribeToNoLiveOutput,
    store?.getSnapshot ?? readNoLiveOutput,
    store?.getSnapshot ?? readNoLiveOutput,
  );
  const liveOutput = remainingLiveOutput(store === null ? fallback : stored, committedPrefix);
  const visible = shouldShowLiveOutput(liveOutput);
  useLayoutEffect(() => {
    if (!visible) return;
    onVisibleFrame?.();
  }, [liveOutput?.chunk_count, liveOutput?.request_id, liveOutput?.state, onVisibleFrame, visible]);
  return visible ? <ActivityLiveOutputItem liveOutput={liveOutput} /> : null;
}

function ActivityProjectedStatusItem({
  projection,
}: Readonly<{
  projection: BuilderAgentActivityProjectionWire;
}>) {
  return (
    <li
      className="cf-builder-activity-item"
      data-builder-activity-card="Assistant working"
      data-builder-activity-role="status"
      data-builder-agent-current-activity={projection.current.phase}
      data-builder-work-phase={projection.current.phase}
    >
      <div className="cf-builder-activity-icon" aria-hidden="true">
        <RefreshCw className="cf-builder-activity-spinner size-3.5" />
      </div>
      <div
        className="cf-builder-activity-content min-w-0"
        data-builder-message-surface="status"
      >
        <div className="cf-builder-activity-title">{projection.current.label}</div>
        <p className="cf-builder-activity-body">{projection.current.summary}</p>
      </div>
    </li>
  );
}

function ActivitySavingVersionItem() {
  return (
    <li
      className="cf-builder-activity-item"
      data-builder-activity-card="Saving version"
      data-builder-activity-role="status"
      data-builder-agent-current-activity="saving_version"
      data-builder-work-phase="saving_version"
    >
      <div className="cf-builder-activity-icon" aria-hidden="true">
        <RefreshCw className="cf-builder-activity-spinner size-3.5" />
      </div>
      <div
        className="cf-builder-activity-content min-w-0"
        data-builder-message-surface="status"
      >
        <div className="cf-builder-activity-title">Saving version</div>
        <p className="cf-builder-activity-body">Recording this draft as a saved project version.</p>
      </div>
    </li>
  );
}

function standaloneAgentActivity(
  projection: BuilderAgentActivityProjectionWire | null,
  entries: readonly ActivityEntry[],
): BuilderAgentActivityProjectionWire | null {
  if (projection === null || projection.current.status === 'complete') return null;
  const completedRunShown = projection.current.status !== 'active' && entries.some((entry) => (
    entry.entry_kind === 'item'
    && entry.item.item_kind === 'run_completed'
    && entry.item.turn_id === projection.current.turn_id
    && entry.item.run_id === projection.current.run_id
  ));
  if (completedRunShown) return null;
  const alreadyShown = entries.some((entry) => (
    entry.entry_kind === 'work_status'
    && entry.turnId === projection.current.turn_id
    && entry.runId === projection.current.run_id
  ));
  return alreadyShown ? null : projection;
}

type RuntimeToolActivityItem = Extract<
  BuilderConversationItem,
  { item_kind: 'programming_runtime_tool_activity' }
>;

function RuntimeToolPresentationDetail({ item }: Readonly<{ item: RuntimeToolActivityItem }>) {
  const detail = item.presentation_detail;
  if (detail === null) return null;
  if (detail.detail_kind === 'read') {
    const lineRange = detail.returned_lines === 0
      ? 'No lines returned'
      : `Lines ${detail.first_line}-${detail.last_line} of ${detail.total_lines}`;
    return (
      <div className="cf-builder-tool-presentation-detail" data-builder-tool-detail="read">
        <code>{detail.path}</code>
        <span>{lineRange}{detail.language_hint === null ? '' : ` · ${detail.language_hint}`}</span>
      </div>
    );
  }
  if (detail.detail_kind === 'diff') {
    return (
      <div className="cf-builder-tool-presentation-detail" data-builder-tool-detail="diff">
        <code>{detail.path}</code>
        <span className="cf-builder-tool-diff-counts">
          <b>+{detail.added_lines}</b>
          <i>-{detail.deleted_lines}</i>
        </span>
      </div>
    );
  }
  if (detail.detail_kind === 'command') {
    const outcome = detail.exit_code === null
      ? detail.status.replaceAll('_', ' ')
      : `exit ${detail.exit_code}`;
    const facts = [
      outcome,
      detail.duration_ms === 0 ? null : `${detail.duration_ms} ms`,
      detail.truncated ? 'output truncated' : null,
    ].filter((fact): fact is string => fact !== null);
    return (
      <div className="cf-builder-tool-presentation-detail" data-builder-tool-detail="command">
        <code>{detail.command}</code>
        <span>{facts.join(' · ')}</span>
      </div>
    );
  }
  const visibleMatches = detail.matches.slice(0, 6);
  return (
    <div className="cf-builder-tool-presentation-detail" data-builder-tool-detail="search">
      <span>
        {detail.matches.length} shown of {detail.total} {detail.total === 1 ? 'match' : 'matches'}
        {detail.truncated ? ' · truncated' : ''}
      </span>
      {visibleMatches.length === 0 ? null : (
        <ol className="cf-builder-tool-search-locations">
          {visibleMatches.map((match, index) => (
            <li key={`${match.path}:${match.line}:${match.column}:${index}`}>
              <code>{match.path}</code>
              {match.line > 0 ? <span>:{match.line}:{match.column}</span> : null}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function runtimeHistoryGroup(
  item: RuntimeToolActivityItem,
): 'file' | 'command' | 'browser' | 'read' | 'search' {
  if (item.tool_kind === 'edit' || item.tool_kind === 'write') return 'file';
  if (item.tool_kind === 'command') return 'command';
  if (item.tool_kind === 'browser') return 'browser';
  if (item.tool_kind === 'search') return 'search';
  return 'read';
}

function runtimeHistoryGroupLabel(
  kind: ReturnType<typeof runtimeHistoryGroup>,
  count: number,
): string {
  if (kind === 'file') return `Edited ${count} files`;
  if (kind === 'command') return `Ran ${count} commands`;
  if (kind === 'browser') return `Ran ${count} browser actions`;
  if (kind === 'search') return `Ran ${count} searches`;
  return `Read ${count} files`;
}

type ResolveRuntimeToolAction = (
  item: RuntimeToolActivityItem,
) => (() => void) | null;

function runtimeToolEvidenceActionLabel(item: RuntimeToolActivityItem): string {
  if (item.presentation === 'terminal') return 'Inspect';
  if (item.presentation === 'changes') return 'Open';
  if (item.presentation === 'file') return 'Open';
  if (item.presentation === 'search') return 'Inspect';
  if (item.presentation === 'browser') return 'Open';
  return 'Review';
}

function RuntimeToolEvidenceContent({
  item,
  action,
}: Readonly<{
  item: RuntimeToolActivityItem;
  action: (() => void) | null;
}>) {
  const body = activityBody(item);
  const hasDetail = body.length > 0 || item.presentation_detail !== null || action !== null;
  const summary = (
    <span className="cf-builder-tool-evidence-summary">
      <strong className="cf-builder-tool-evidence-title">{activityTitle(item)}</strong>
      {body.length > 0 ? <small className="cf-builder-tool-evidence-detail">{body}</small> : null}
    </span>
  );
  if (!hasDetail) return summary;
  return (
    <details
      className="cf-builder-tool-evidence-details"
      data-builder-tool-evidence-details={item.presentation}
    >
      <summary>
        <ChevronDown aria-hidden="true" className="size-3.5" />
        {summary}
        {action === null ? null : (
          <button
            className="cf-builder-tool-evidence-action"
            data-builder-runtime-tool-open={item.presentation}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              action();
            }}
            type="button"
          >
            {runtimeToolEvidenceActionLabel(item)}
          </button>
        )}
      </summary>
      <div className="cf-builder-tool-evidence-body">
        <RuntimeToolPresentationDetail item={item} />
      </div>
    </details>
  );
}

function RuntimeHistoryAction({
  item,
  resolveAction,
}: Readonly<{
  item: RuntimeToolActivityItem;
  resolveAction?: ResolveRuntimeToolAction;
}>) {
  const action = resolveAction?.(item) ?? null;
  return (
    <li
      className="cf-builder-run-history-action cf-builder-tool-evidence-row"
      data-builder-conversation-node="tool_evidence"
      data-builder-runtime-tool-kind={item.tool_kind}
      data-builder-tool-activity={item.state}
    >
      <ActivityGlyph item={item} />
      <RuntimeToolEvidenceContent item={item} action={action} />
    </li>
  );
}

function RuntimeMainCheckAction({
  checkRunProfile,
  checkRunStatus,
  onOpenCheckCommand,
}: Readonly<{
  checkRunProfile: BuilderCheckRunProfile;
  checkRunStatus: BuilderDisplayedCheckStatus;
  onOpenCheckCommand?: () => void;
}>) {
  return (
    <li
      className="cf-builder-run-history-action cf-builder-tool-evidence-row"
      data-builder-conversation-node="tool_evidence"
      data-builder-runtime-tool-kind="command"
      data-builder-tool-activity={checkRunStatus.status === 'passed' ? 'completed' : 'failed'}
    >
      <div className="cf-builder-activity-icon" aria-hidden="true">
        <SquareTerminal className="size-3.5" />
      </div>
      <span className="cf-builder-tool-evidence-summary">
        <strong className="cf-builder-tool-evidence-title">
          {checkRunStatus.status === 'passed' ? 'Ran' : 'Tried'} {checkRunProfile.command_display}
        </strong>
        <small className="cf-builder-tool-evidence-detail">{checkRunStatus.summary}</small>
        {typeof onOpenCheckCommand === 'function' ? (
          <button
            className="cf-builder-tool-evidence-action"
            data-builder-runtime-tool-open="terminal"
            onClick={onOpenCheckCommand}
            type="button"
          >
            Inspect
          </button>
        ) : null}
      </span>
    </li>
  );
}

function RuntimeHistoryGroup({
  items,
  kind,
  resolveAction,
}: Readonly<{
  items: readonly RuntimeToolActivityItem[];
  kind: ReturnType<typeof runtimeHistoryGroup>;
  resolveAction?: ResolveRuntimeToolAction;
}>) {
  const representative = items.at(-1);
  if (representative === undefined) return null;
  if (items.length === 1) {
    return <RuntimeHistoryAction item={representative} resolveAction={resolveAction} />;
  }
  return (
    <li
      className="cf-builder-run-history-action cf-builder-runtime-history-group cf-builder-tool-evidence-row"
      data-builder-conversation-node="tool_evidence"
      data-builder-runtime-tool-group={kind}
    >
      <ActivityGlyph item={representative} />
      <details
        className="cf-builder-run-history"
        data-builder-run-history="true"
        data-builder-runtime-history-details={kind}
      >
        <summary>
          <ChevronDown aria-hidden="true" className="size-3.5" />
          <span>{runtimeHistoryGroupLabel(kind, items.length)}</span>
        </summary>
        <ol className="cf-builder-run-history-list">
          {items.map((item) => (
            <RuntimeHistoryAction
              item={item}
              key={item.tool_call_id}
              resolveAction={resolveAction}
            />
          ))}
        </ol>
      </details>
    </li>
  );
}

function ActivityRunHistory({
  checkRunProfile,
  checkRunStatus,
  entry,
  includeMainCheckFallback,
  onOpenCheckCommand,
  resolveRuntimeToolAction,
}: Readonly<{
  checkRunProfile: BuilderCheckRunProfile | null;
  checkRunStatus: BuilderDisplayedCheckStatus | null;
  entry: ActivityRunHistoryEntry;
  includeMainCheckFallback: boolean;
  onOpenCheckCommand?: () => void;
  resolveRuntimeToolAction?: ResolveRuntimeToolAction;
}>) {
  const runtimeItems = entry.items.filter(
    (item): item is RuntimeToolActivityItem => item.item_kind === 'programming_runtime_tool_activity',
  );
  const legacyItems = entry.items.filter(
    (item) => item.item_kind !== 'programming_runtime_tool_activity',
  );
  const runtimeGroups: Array<{
    kind: ReturnType<typeof runtimeHistoryGroup>;
    items: RuntimeToolActivityItem[];
  }> = [];
  for (const item of runtimeItems) {
    const kind = runtimeHistoryGroup(item);
    const previous = runtimeGroups.at(-1);
    if (previous?.kind === kind) previous.items.push(item);
    else runtimeGroups.push({ kind, items: [item] });
  }
  const showMainCheckFallback = includeMainCheckFallback
    && checkRunProfile !== null
    && checkRunStatus !== null
    && !runtimeItems.some((item) => item.tool_kind === 'command');
  return (
    <>
      {runtimeGroups.map(({ kind, items }, index) => (
        <RuntimeHistoryGroup
          items={items}
          key={`${kind}:${index}`}
          kind={kind}
          resolveAction={resolveRuntimeToolAction}
        />
      ))}
      {showMainCheckFallback ? (
        <RuntimeMainCheckAction
          checkRunProfile={checkRunProfile}
          checkRunStatus={checkRunStatus}
          onOpenCheckCommand={onOpenCheckCommand}
        />
      ) : null}
      {legacyItems.length === 0 ? null : (
        <li
          className="cf-builder-activity-item cf-builder-run-history-item"
          data-builder-run-history-item="true"
        >
          <div className="cf-builder-activity-icon" aria-hidden="true">
            <History className="size-3.5" />
          </div>
          <details className="cf-builder-run-history" data-builder-run-history="true">
            <summary data-builder-run-history-toggle="true">
              <ChevronDown aria-hidden="true" className="size-3.5" />
              <span>Completed work</span>
              <span className="cf-builder-completion-work-count">
                {legacyItems.length} {legacyItems.length === 1 ? 'action' : 'actions'}
              </span>
            </summary>
            <ol className="cf-builder-run-history-list">
              {legacyItems.map((item) => (
            <li
              className="cf-builder-run-history-action"
              data-builder-tool-activity={item.item_kind === 'tool_call_requested'
                ? 'requested'
                : item.item_kind === 'tool_call_result_recorded'
                  ? item.result.status
                  : undefined}
              key={item.sequence}
            >
              <ActivityGlyph item={item} />
              <span>
                <strong>{activityTitle(item)}</strong>
                <small>{activityBody(item)}</small>
              </span>
            </li>
              ))}
            </ol>
          </details>
        </li>
      )}
    </>
  );
}

function ActivityCompletedActions({
  changes,
  checkRunProfile,
  checkRunStatus,
  onOpenCandidateChange,
  onOpenCheckCommand,
}: Readonly<{
  changes: readonly BuilderSourceTreeChange[];
  checkRunProfile: BuilderCheckRunProfile | null;
  checkRunStatus: BuilderDisplayedCheckStatus | null;
  onOpenCandidateChange?: (change: BuilderSourceTreeChange) => void;
  onOpenCheckCommand?: () => void;
}>) {
  const singleChange = changes.length === 1 ? changes[0] : null;
  return (
    <>
      {singleChange === null ? null : (
        <li
          className="cf-builder-activity-item cf-builder-completed-action"
          data-builder-completed-action-group="file"
          data-builder-change-kind={singleChange.change_kind}
        >
          <div className="cf-builder-activity-icon" aria-hidden="true">
            <FileCode2 className="size-3.5" />
          </div>
          <div data-builder-completion-candidate-change={singleChange.path}>
            <button
              className="cf-builder-completion-work-action"
              onClick={() => onOpenCandidateChange?.(singleChange)}
              type="button"
            >
              <strong>{singleChange.change_kind === 'added' ? 'Added' : singleChange.change_kind === 'deleted' ? 'Deleted' : 'Edited'} {singleChange.path}</strong>
              <ChangeLineDelta change={singleChange} />
            </button>
          </div>
        </li>
      )}
      {changes.length <= 1 ? null : (
        <li
          className="cf-builder-activity-item cf-builder-completed-action-group"
          data-builder-completed-action-group="file"
        >
          <div className="cf-builder-activity-icon" aria-hidden="true">
            <FileCode2 className="size-3.5" />
          </div>
          <details className="cf-builder-completed-actions" data-builder-completed-actions="file" open>
            <summary data-builder-completed-actions-toggle="file">
              <ChevronDown aria-hidden="true" className="size-3.5" />
              <span>Edited {changes.length} files</span>
            </summary>
            <ol className="cf-builder-completion-work-list">
              {changes.map((change) => (
                <li
                  data-builder-change-kind={change.change_kind}
                  data-builder-completion-candidate-change={change.path}
                  key={change.path}
                >
                  <CheckCircle2 aria-hidden="true" className="size-3.5" />
                  <button
                    className="cf-builder-completion-work-action"
                    onClick={() => onOpenCandidateChange?.(change)}
                    type="button"
                  >
                    <strong>{change.change_kind === 'added' ? 'Added' : change.change_kind === 'deleted' ? 'Deleted' : 'Edited'} {change.path}</strong>
                    <ChangeLineDelta change={change} />
                  </button>
                </li>
              ))}
            </ol>
          </details>
        </li>
      )}
      {checkRunProfile === null || checkRunStatus === null ? null : (
        <li
          className="cf-builder-activity-item cf-builder-completed-action"
          data-builder-completed-action-group="command"
          data-builder-command-status={checkRunStatus.status}
        >
          <div className="cf-builder-activity-icon" aria-hidden="true">
            <SquareTerminal className="size-3.5" />
          </div>
          <div data-builder-completion-command={checkRunProfile.command_display}>
            <button
              className="cf-builder-completion-work-action"
              onClick={onOpenCheckCommand}
              type="button"
            >
              <strong>{checkRunStatus.status === 'passed' ? 'Ran' : 'Tried'} {checkRunProfile.command_display}</strong>
              <small>{checkRunStatus.summary}</small>
            </button>
          </div>
        </li>
      )}
    </>
  );
}

function ActivityWorkspaceMaterializationSummary({
  materialization,
}: Readonly<{
  materialization: BuilderConversationWorkspaceMaterialization;
}>) {
  if (materialization.status === 'not_recorded') return null;
  const synced = materialization.status === 'materialized';
  const title = synced ? 'Project folder updated' : materialization.label;
  const detail = synced
    ? 'Latest draft files are available in the project folder.'
    : materialization.detail;
  return (
    <li
      className="cf-builder-activity-item cf-builder-workspace-materialization-summary"
      data-builder-workspace-materialization={materialization.status}
    >
      <div className="cf-builder-activity-icon" aria-hidden="true">
        {synced ? <CheckCircle2 className="size-3.5" /> : <AlertCircle className="size-3.5" />}
      </div>
      <div className="cf-builder-activity-content min-w-0">
        <div className="cf-builder-activity-title">{title}</div>
        <p className="cf-builder-activity-body">{detail}</p>
      </div>
    </li>
  );
}

const ActivityPanel = memo(function ActivityPanel({
  canUndoDraft,
  candidateChanges,
  checkRunProfile,
  checkRunStatus,
  currentDraftId,
  hasUnsavedDraft,
  liveOutput,
  liveOutputStore,
  pendingUserMessages,
  onLiveOutputFrame,
  onOpenCandidateChange,
  onOpenCheckCommand,
  onOpenRuntimeToolCommand,
  onOpenRuntimeToolBrowser,
  onOpenRuntimeToolFile,
  onOpenHistory,
  snapshot,
  onRefresh,
  onReviewPlan,
  onUndoDraft,
  planReviewBusy,
  planReviewFailed,
  planReviewRecorded,
  pendingPlanReview,
  canReviewPlan,
  savingVersion,
}: Readonly<{
  canReviewPlan: boolean;
  canUndoDraft: boolean;
  candidateChanges: readonly BuilderSourceTreeChange[];
  checkRunProfile: BuilderCheckRunProfile | null;
  checkRunStatus: BuilderDisplayedCheckStatus | null;
  currentDraftId: string | null;
  hasUnsavedDraft: boolean;
  liveOutput: BuilderLiveOutputSnapshot | null;
  liveOutputStore: BuilderLiveOutputStore | null;
  pendingUserMessages: readonly BuilderPendingUserMessage[];
  onLiveOutputFrame?: () => void;
  onOpenCandidateChange?: (change: BuilderSourceTreeChange) => void;
  onOpenCheckCommand?: () => void;
  onOpenRuntimeToolCommand?: (item: RuntimeToolActivityItem) => void;
  onOpenRuntimeToolBrowser?: () => void;
  onOpenRuntimeToolFile?: (
    request: Readonly<{ run_id: string; tool_call_id: string }>,
  ) => Promise<boolean>;
  onOpenHistory?: () => void;
  onRefresh?: () => Promise<unknown> | void;
  onReviewPlan?: (request: BuilderPlanReviewRequest) => Promise<unknown> | void;
  onUndoDraft?: () => void;
  planReviewBusy: boolean;
  planReviewFailed: boolean;
  planReviewRecorded: boolean;
  pendingPlanReview: BuilderPlanReviewRequest | null;
  savingVersion: boolean;
  snapshot: BuilderConversationControllerSnapshot | null;
}>) {
  useLayoutEffect(() => {
    incrementBuilderPerformance('renderer.activity.commit_count');
  });
  useEffect(() => {
    incrementBuilderPerformance('renderer.activity.mount_count');
    return () => {
      incrementBuilderPerformance('renderer.activity.unmount_count');
    };
  }, []);
  const entries = activityEntries(snapshot);
  const durableUserMessages = snapshot?.conversation?.state === 'ready'
    ? snapshot.conversation.conversation.items
      .map(builderDurableUserMessage)
      .filter((message): message is BuilderDurableUserMessage => message !== null)
    : [];
  const visiblePendingUserMessages = pendingUserMessages.filter((message) => {
    return !durableUserMessages.some((durable) => (
      builderPendingUserMessageMatchesDurable(message, durable)
    ));
  });
  const latestConversationRunId = snapshot?.conversation?.state === 'ready'
    ? [...snapshot.conversation.conversation.items]
      .reverse()
      .find((item) => item.item_kind === 'run_started')?.run_id ?? null
    : null;
  const committedRuntimeOutputPrefix = liveOutput === null
    || snapshot?.conversation?.state !== 'ready'
    || latestConversationRunId === null
    ? ''
    : snapshot.conversation.conversation.items
      .filter((item): item is Extract<BuilderConversationItem, {
        item_kind: 'programming_runtime_assistant_message';
      }> => (
        item.item_kind === 'programming_runtime_assistant_message'
        && item.run_id === latestConversationRunId
      ))
      .map((item) => item.message.text)
      .join('');
  const runtimeFactRuns = new Set(
    snapshot?.conversation?.state === 'ready'
      ? snapshot.conversation.conversation.items
        .filter((item): item is Extract<BuilderConversationItem, {
          item_kind: 'programming_runtime_tool_activity';
        }> => item.item_kind === 'programming_runtime_tool_activity')
        .map((item) => `${item.turn_id}:${item.run_id}`)
      : [],
  );
  const runtimeCommandRuns = new Set(
    snapshot?.conversation?.state === 'ready'
      ? snapshot.conversation.conversation.items
        .filter((item): item is Extract<BuilderConversationItem, {
          item_kind: 'programming_runtime_tool_activity';
        }> => (
          item.item_kind === 'programming_runtime_tool_activity'
          && item.tool_kind === 'command'
        ))
        .map((item) => `${item.turn_id}:${item.run_id}`)
      : [],
  );
  const currentDraftCompletion = snapshot?.conversation?.state === 'ready'
    ? [...snapshot.conversation.conversation.items]
      .reverse()
      .find((item): item is Extract<BuilderConversationItem, { item_kind: 'run_completed' }> => (
        item.item_kind === 'run_completed'
        && item.candidate?.draft_id === currentDraftId
      ))
    : undefined;
  const currentDraftCompletionKey = currentDraftCompletion === undefined
    ? null
    : `${currentDraftCompletion.turn_id}:${currentDraftCompletion.run_id}`;
  const planReviewDecisions = inlinePlanReviewDecisions(snapshot);
  const hasLiveOutput = liveOutput !== null;
  const visibleEntries = entries.filter((entry) => (
    entry.entry_kind !== 'work_status'
    && (
      entry.entry_kind !== 'item'
      || entry.item.item_kind !== 'plan_reviewed'
      || !planReviewDecisions.has(planReviewKey(entry.item.turn_id, entry.item.run_id))
    )
    && (
      !hasLiveOutput
      || entry.entry_kind !== 'item'
      || entry.item.item_kind !== 'programming_runtime_status'
      || (entry.item.status_kind !== 'reasoning' && entry.item.status_kind !== 'activity')
    )
  ));
  const agentActivityProjection = currentAgentActivity(snapshot);
  const currentAgentActivityStatus = agentActivityProjection?.current.phase === 'blocked'
    ? standaloneAgentActivity(agentActivityProjection, visibleEntries)
    : null;
  const message = activityMessage(snapshot);
  const transcriptRestored = isTranscriptRestoredConversation(snapshot);
  const canRefresh = snapshot !== null
    && snapshot.project_id !== null
    && !snapshot.busy
    && typeof onRefresh === 'function';
  const showRefresh = canRefresh && snapshot.status === 'stale';
  const resolveRuntimeToolAction: ResolveRuntimeToolAction = (item) => {
    if (
      item.tool_kind === 'read'
      || item.tool_kind === 'search'
      || item.tool_kind === 'edit'
      || item.tool_kind === 'write'
    ) {
      const path = item.target_label;
      if (path === null) return null;
      const change = candidateChanges.find((candidateChange) => candidateChange.path === path);
      if (typeof onOpenRuntimeToolFile === 'function') {
        return () => {
          void (async () => {
            const opened = await onOpenRuntimeToolFile({
              run_id: item.run_id,
              tool_call_id: item.tool_call_id,
            });
            if (!opened && change !== undefined && typeof onOpenCandidateChange === 'function') {
              onOpenCandidateChange(change);
            }
          })();
        };
      }
      if (change !== undefined && typeof onOpenCandidateChange === 'function') {
        return () => onOpenCandidateChange(change);
      }
      return null;
    }
    if (
      item.tool_kind === 'browser'
      && typeof onOpenRuntimeToolBrowser === 'function'
    ) return onOpenRuntimeToolBrowser;
    if (
      item.tool_kind === 'command'
      && item.target_label !== null
      && item.check_result !== null
      && typeof onOpenRuntimeToolCommand === 'function'
    ) return () => onOpenRuntimeToolCommand(item);
    if (
      item.tool_kind === 'command'
      && typeof onOpenCheckCommand === 'function'
      && checkRunProfile?.command_display === item.target_label
    ) return onOpenCheckCommand;
    return null;
  };
  return (
    <section
      aria-label="Project conversation"
      className="cf-builder-activity-panel cf-builder-chat-flow-surface"
      data-builder-activity="true"
      data-builder-activity-status={snapshot?.status ?? 'idle'}
      data-builder-conversation-workspace="true"
    >
      {showRefresh ? (
        <header className="cf-builder-activity-toolbar" data-builder-activity-toolbar="true">
          <button
            aria-label="Refresh conversation"
            className="cf-builder-secondary-button cf-builder-icon-button inline-flex size-8 items-center justify-center disabled:cursor-not-allowed disabled:opacity-50"
            data-builder-refresh-activity="true"
            disabled={!canRefresh}
            onClick={() => {
              void onRefresh?.();
            }}
            type="button"
          >
            <RefreshCw aria-hidden="true" className="size-3.5" />
          </button>
        </header>
      ) : null}
      <div className="cf-builder-activity-body-wrap">
        {snapshot?.status === 'refreshing'
        && visibleEntries.length === 0
        && visiblePendingUserMessages.length === 0
        && !hasLiveOutput
        && !savingVersion ? (
          <p className="cf-builder-activity-status" role="status">Refreshing activity...</p>
        ) : null}
        {transcriptRestored ? (
          <p
            className="cf-builder-activity-status cf-builder-activity-recovery-status"
            data-builder-transcript-recovery-status="true"
            role="status"
          >
            Showing saved transcript. Live activity is unavailable.
          </p>
        ) : null}
        {visibleEntries.length === 0
        && visiblePendingUserMessages.length === 0
        && !hasLiveOutput
        && !savingVersion
        && message !== null ? (
          <div className="cf-builder-empty cf-builder-activity-empty flex min-h-32 items-center justify-center border border-dashed px-3 text-center text-sm">
            {message}
          </div>
        ) : (
          <ol className="cf-builder-activity-list">
            {visibleEntries.map((entry) => {
              if (entry.entry_kind === 'work_status') return null;
              if (entry.entry_kind === 'run_history') return (
                <ActivityRunHistory
                  checkRunProfile={checkRunProfile}
                  checkRunStatus={checkRunStatus}
                  entry={entry}
                  includeMainCheckFallback={entry.runKey === currentDraftCompletionKey}
                  key={entry.key}
                  onOpenCheckCommand={onOpenCheckCommand}
                  resolveRuntimeToolAction={resolveRuntimeToolAction}
                />
              );
              const isCurrentDraftCompletion = entry.item.item_kind === 'run_completed'
                && entry.item.candidate?.draft_id === currentDraftId;
              const hasRuntimeFacts = entry.item.item_kind === 'run_completed'
                && runtimeFactRuns.has(`${entry.item.turn_id}:${entry.item.run_id}`);
              const needsRuntimeCheckFallback = entry.item.item_kind === 'run_completed'
                && isCurrentDraftCompletion
                && hasRuntimeFacts
                && !runtimeCommandRuns.has(`${entry.item.turn_id}:${entry.item.run_id}`)
                && checkRunProfile !== null
                && checkRunStatus !== null;
              return (
                <Fragment key={entry.key}>
                  <ActivityItem
                    canUndoDraft={canUndoDraft}
                    canReviewPlan={canReviewPlan}
                    candidateChanges={candidateChanges}
                    checkRunProfile={checkRunProfile}
                    checkRunStatus={checkRunStatus}
                    hasUnsavedDraft={hasUnsavedDraft}
                    hasRuntimeFacts={hasRuntimeFacts}
                    isCurrentDraftCompletion={isCurrentDraftCompletion}
                    item={entry.item}
                    onOpenCandidateChange={onOpenCandidateChange}
                    onOpenCheckCommand={onOpenCheckCommand}
                    onOpenHistory={onOpenHistory}
                    onReviewPlan={onReviewPlan}
                    onUndoDraft={onUndoDraft}
                    planReviewBusy={planReviewBusy}
                    planReviewFailed={planReviewFailed}
                    planReviewRecorded={planReviewRecorded}
                    pendingPlanReview={pendingPlanReview}
                    resolveRuntimeToolAction={resolveRuntimeToolAction}
                    planReviewDecision={entry.item.item_kind === 'run_completed'
                      && entry.item.result_kind === 'plan'
                      ? planReviewDecisions.get(planReviewKey(entry.item.turn_id, entry.item.run_id)) ?? null
                      : null}
                  />
                  {isCurrentDraftCompletion && entry.item.item_kind === 'run_completed'
                  && entry.item.candidate !== null ? (
                    <ActivityWorkspaceMaterializationSummary
                      materialization={entry.item.candidate.workspace_materialization}
                    />
                    ) : null}
                  {needsRuntimeCheckFallback ? (
                    <RuntimeMainCheckAction
                      checkRunProfile={checkRunProfile}
                      checkRunStatus={checkRunStatus}
                      onOpenCheckCommand={onOpenCheckCommand}
                    />
                  ) : null}
                </Fragment>
              );
            })}
            {visiblePendingUserMessages.map((pending) => (
              <PendingUserMessageItem key={pending.client_id} message={pending} />
            ))}
            {currentAgentActivityStatus !== null ? (
              <ActivityProjectedStatusItem projection={currentAgentActivityStatus} />
            ) : null}
            {savingVersion ? <ActivitySavingVersionItem /> : null}
            {hasLiveOutput ? (
              <ActivityLiveOutputSlot
                committedPrefix={committedRuntimeOutputPrefix}
                fallback={liveOutput}
                key="active-live-output"
                onVisibleFrame={onLiveOutputFrame}
                store={liveOutputStore}
              />
            ) : null}
          </ol>
        )}
        {visibleEntries.length > 0 && message !== null ? (
          <p className="cf-builder-activity-status" role={snapshot?.status === 'stale' ? 'alert' : 'status'}>
            {message}
          </p>
        ) : null}
      </div>
    </section>
  );
}, (previous, current) => {
  const snapshotChanged = previous.snapshot !== current.snapshot;
  const candidateChangesChanged = previous.candidateChanges !== current.candidateChanges;
  const liveOutputChanged = previous.liveOutput !== current.liveOutput;
  const otherStateChanged = (
    previous.canReviewPlan !== current.canReviewPlan
    || previous.canUndoDraft !== current.canUndoDraft
    || previous.checkRunProfile !== current.checkRunProfile
    || !sameDisplayedCheckStatus(previous.checkRunStatus, current.checkRunStatus)
    || previous.currentDraftId !== current.currentDraftId
    || previous.hasUnsavedDraft !== current.hasUnsavedDraft
    || previous.liveOutputStore !== current.liveOutputStore
    || previous.pendingUserMessages !== current.pendingUserMessages
    || previous.planReviewBusy !== current.planReviewBusy
    || previous.planReviewFailed !== current.planReviewFailed
    || previous.planReviewRecorded !== current.planReviewRecorded
    || previous.pendingPlanReview !== current.pendingPlanReview
    || previous.savingVersion !== current.savingVersion
  );
  if (snapshotChanged) {
    incrementBuilderPerformance('renderer.activity.render_reason.snapshot');
  }
  if (candidateChangesChanged) {
    incrementBuilderPerformance('renderer.activity.render_reason.candidate_changes');
  }
  if (liveOutputChanged) {
    incrementBuilderPerformance('renderer.activity.render_reason.live_output');
  }
  if (otherStateChanged) {
    incrementBuilderPerformance('renderer.activity.render_reason.other_state');
  }
  return previous.canReviewPlan === current.canReviewPlan
  && previous.canUndoDraft === current.canUndoDraft
  && previous.candidateChanges === current.candidateChanges
  && previous.checkRunProfile === current.checkRunProfile
  && sameDisplayedCheckStatus(previous.checkRunStatus, current.checkRunStatus)
  && previous.currentDraftId === current.currentDraftId
  && previous.hasUnsavedDraft === current.hasUnsavedDraft
  && previous.liveOutput === current.liveOutput
  && previous.liveOutputStore === current.liveOutputStore
  && previous.pendingUserMessages === current.pendingUserMessages
  && previous.planReviewBusy === current.planReviewBusy
  && previous.planReviewFailed === current.planReviewFailed
  && previous.planReviewRecorded === current.planReviewRecorded
  && previous.pendingPlanReview === current.pendingPlanReview
  && previous.savingVersion === current.savingVersion
  && previous.snapshot === current.snapshot;
});

function AgentTaskProposalActions({
  action,
  disabled,
  onCreateProject,
  onDecide,
  onOpenTask,
  projectCatalogSnapshot,
}: Readonly<{
  action: BuilderAgentWorkbenchTaskProposalAction;
  disabled: boolean;
  onCreateProject?: (proposalId: string, objective: string) => Promise<unknown> | void;
  onDecide?: (
    proposalId: string,
    operation: 'approve_existing_project' | 'reject',
    projectId: string | null,
  ) => Promise<unknown> | void;
  onOpenTask?: (
    projectId: string,
    taskAddressId: string,
    seed?: BuilderTaskConversationSeed | null,
  ) => void;
  projectCatalogSnapshot?: BuilderProjectCatalogSnapshot;
}>) {
  const projects = useMemo(() => {
    const byId = new Map<string, string>();
    for (const project of projectCatalogSnapshot?.workspaceProjects ?? []) {
      byId.set(project.project_id, project.title);
    }
    for (const project of projectCatalogSnapshot?.projects ?? []) {
      byId.set(project.project_id, project.title);
    }
    return [...byId].map(([projectId, title]) => ({ projectId, title }));
  }, [projectCatalogSnapshot]);
  const [selectedProjectId, setSelectedProjectId] = useState(projects[0]?.projectId ?? '');
  const effectiveSelectedProjectId = projects.some(
    (project) => project.projectId === selectedProjectId,
  ) ? selectedProjectId : (projects[0]?.projectId ?? '');

  if (action.status === 'rejected') {
    return <p className="cf-builder-agent-task-proposal-state">Dismissed</p>;
  }
  if (action.status === 'materialized') {
    return action.project_id !== null && action.task_address_id !== null && typeof onOpenTask === 'function' ? (
      <button
        className="cf-builder-secondary-button cf-builder-agent-task-proposal-open"
        data-builder-agent-task-proposal-open="true"
        onClick={() => onOpenTask(
          action.project_id!,
          action.task_address_id!,
          taskConversationSeedFromProposalAction(action),
        )}
        type="button"
      >
        Open task
        <ArrowRight aria-hidden="true" className="size-3.5" />
      </button>
    ) : <p className="cf-builder-agent-task-proposal-state">Task created</p>;
  }
  return (
    <div
      className="cf-builder-agent-task-proposal-actions"
      data-builder-agent-task-proposal-actions="true"
    >
      {projects.length > 0 ? (
        <label className="cf-builder-agent-task-proposal-project">
          <span>Project</span>
          <select
            aria-label="Project for task proposal"
            disabled={disabled}
            onChange={(event) => setSelectedProjectId(event.target.value)}
            value={effectiveSelectedProjectId}
          >
            {projects.map((project) => (
              <option key={project.projectId} value={project.projectId}>{project.title}</option>
            ))}
          </select>
        </label>
      ) : null}
      <div className="cf-builder-agent-task-proposal-commands">
        {projects.length > 0 && typeof onDecide === 'function' ? (
          <button
            className="cf-builder-primary-button"
            data-builder-agent-task-proposal-create-task="true"
            disabled={disabled || effectiveSelectedProjectId.length === 0}
            onClick={() => { void onDecide(action.proposal_id, 'approve_existing_project', effectiveSelectedProjectId); }}
            type="button"
          >
            Create task
          </button>
        ) : null}
        {typeof onCreateProject === 'function' ? (
          <button
            className="cf-builder-secondary-button"
            data-builder-agent-task-proposal-new-project="true"
            disabled={disabled}
            onClick={() => { void onCreateProject(action.proposal_id, action.objective); }}
            type="button"
          >
            <FolderOpen aria-hidden="true" className="size-3.5" />
            New project
          </button>
        ) : null}
        {typeof onDecide === 'function' ? (
          <button
            className="cf-builder-agent-task-proposal-dismiss"
            data-builder-agent-task-proposal-dismiss="true"
            disabled={disabled}
            onClick={() => { void onDecide(action.proposal_id, 'reject', null); }}
            type="button"
          >
            Dismiss
          </button>
        ) : null}
      </div>
    </div>
  );
}

function AgentWorkbenchPanel({
  actionsDisabled,
  liveOutput,
  liveOutputStore,
  onLiveOutputFrame,
  onRefresh,
  onUpdateMessageState,
  onDecideTaskProposal,
  onDecideAgentPlan,
  onReviseAgentPlan,
  onCreateProjectForTaskProposal,
  onOpenTaskProposal,
  projectCatalogSnapshot,
  snapshot,
}: Readonly<{
  actionsDisabled: boolean;
  onRefresh?: () => Promise<unknown> | void;
  onUpdateMessageState?: (
    messageId: string,
    operation: BuilderWorkbenchMessageStateOperation,
  ) => Promise<unknown> | void;
  onDecideTaskProposal?: (
    proposalId: string,
    operation: 'approve_existing_project' | 'reject',
    projectId: string | null,
  ) => Promise<unknown> | void;
  onDecideAgentPlan?: (
    agentPlanId: string,
    contentDigest: string,
    decision: 'approved' | 'rejected',
  ) => Promise<unknown> | void;
  onReviseAgentPlan?: () => void;
  onCreateProjectForTaskProposal?: (proposalId: string, objective: string) => Promise<unknown> | void;
  onOpenTaskProposal?: (
    projectId: string,
    taskAddressId: string,
    seed?: BuilderTaskConversationSeed | null,
  ) => void;
  projectCatalogSnapshot?: BuilderProjectCatalogSnapshot;
  snapshot?: BuilderAgentWorkbenchSnapshot;
  liveOutput?: BuilderLiveOutputSnapshot | null;
  liveOutputStore?: BuilderLiveOutputStore | null;
  onLiveOutputFrame?: () => void;
}>) {
  const projection = snapshot?.projection ?? null;
  type WorkbenchFamily = 'conversation' | 'proposal' | 'result' | 'status';
  const [selectedFamilies, setSelectedFamilies] = useState<ReadonlySet<WorkbenchFamily>>(
    () => new Set(),
  );
  const [attentionOnly, setAttentionOnly] = useState(false);
  const unarchivedItems = projection?.stream.items.filter((item) => !item.state.archived) ?? [];
  const items = unarchivedItems.filter((item) => {
    const familyMatches = selectedFamilies.size === 0
      || selectedFamilies.has(item.presentation_family as WorkbenchFamily);
    const attentionMatches = !attentionOnly
      || item.state.unread
      || item.attention === 'action_required'
      || item.attention === 'urgent';
    return familyMatches && attentionMatches;
  });
  const visibleMessageIds = new Set(items.map((item) => item.message_id));
  const hiddenAttentionCount = unarchivedItems.filter((item) => (
    !visibleMessageIds.has(item.message_id)
    && (item.state.unread || item.attention === 'action_required' || item.attention === 'urgent')
  )).length;
  const unavailable = snapshot?.status === 'unavailable' || snapshot?.status === 'stale';
  const filterOptions = [
    { family: 'conversation', label: 'Conversation' },
    { family: 'proposal', label: 'Proposals' },
    { family: 'result', label: 'Results' },
    { family: 'status', label: 'Status' },
  ] as const;
  const planDecision = projection?.agent_plan !== null && projection?.agent_plan !== undefined ? (
        <div className="cf-builder-agent-plan-decision" data-builder-agent-plan-decision="true">
          <div>
            <strong>Plan version {projection.agent_plan.artifact.version}</strong>
            <span>{projection.agent_plan.decision === null
              ? 'Ready for review'
              : projection.agent_plan.decision.decision === 'approved' ? 'Approved' : 'Rejected'}</span>
          </div>
          {projection.agent_plan.decision === null ? (
            <div className="cf-builder-agent-plan-decision-actions">
              <button
                className="cf-builder-primary-button"
                disabled={actionsDisabled || typeof onDecideAgentPlan !== 'function'}
                onClick={() => { void onDecideAgentPlan?.(
                  projection.agent_plan!.artifact.agent_plan_id,
                  projection.agent_plan!.artifact.content_digest,
                  'approved',
                ); }}
                type="button"
              >Approve plan</button>
              <button
                className="cf-builder-secondary-button"
                disabled={actionsDisabled || typeof onReviseAgentPlan !== 'function'}
                onClick={onReviseAgentPlan}
                type="button"
              >Revise</button>
              <button
                className="cf-builder-secondary-button"
                disabled={actionsDisabled || typeof onDecideAgentPlan !== 'function'}
                onClick={() => { void onDecideAgentPlan?.(
                  projection.agent_plan!.artifact.agent_plan_id,
                  projection.agent_plan!.artifact.content_digest,
                  'rejected',
                ); }}
                type="button"
              >Reject</button>
            </div>
          ) : null}
        </div>
      ) : null;
  function toggleFamily(family: WorkbenchFamily): void {
    setSelectedFamilies((current) => {
      if (current.size === 0) return new Set([family]);
      const next = new Set(current);
      if (next.has(family)) next.delete(family);
      else next.add(family);
      return next;
    });
  }
  return (
    <section
      aria-label="Agent Workbench conversation"
      className="cf-builder-agent-workbench-stream"
      data-builder-agent-workbench-stream="true"
      data-builder-agent-workbench-status={snapshot?.status ?? 'unavailable'}
    >
      {projection !== null ? (
        <div
          aria-label="Filter Agent messages"
          className="cf-builder-agent-workbench-filters"
          data-builder-agent-workbench-filters="true"
          role="group"
        >
          <button
            aria-pressed={selectedFamilies.size === 0 && !attentionOnly}
            data-builder-agent-workbench-filter="all"
            onClick={() => {
              setSelectedFamilies(new Set());
              setAttentionOnly(false);
            }}
            type="button"
          >
            All
          </button>
          {filterOptions.map((option) => (
            <button
              aria-pressed={selectedFamilies.has(option.family)}
              data-builder-agent-workbench-filter={option.family}
              key={option.family}
              onClick={() => toggleFamily(option.family)}
              type="button"
            >
              {option.label}
            </button>
          ))}
          <button
            aria-pressed={attentionOnly}
            data-builder-agent-workbench-filter="attention"
            onClick={() => setAttentionOnly((current) => !current)}
            type="button"
          >
            Needs attention
          </button>
          {hiddenAttentionCount > 0 ? (
            <span data-builder-agent-workbench-hidden-attention="true">
              {hiddenAttentionCount} hidden
            </span>
          ) : null}
        </div>
      ) : null}
      {projection === null ? (
        <div className="cf-builder-agent-workbench-empty" role="status">
          <p>{snapshot?.status === 'loading' ? 'Loading messages...' : 'Messages are unavailable.'}</p>
          {unavailable && typeof onRefresh === 'function' ? (
            <button
              className="cf-builder-secondary-button inline-flex min-h-8 items-center gap-2 px-2.5 text-xs font-medium"
              onClick={() => { void onRefresh(); }}
              type="button"
            >
              <RefreshCw aria-hidden="true" className="size-3.5" />
              Retry
            </button>
          ) : null}
        </div>
      ) : items.length === 0 ? (
        <div className="cf-builder-agent-workbench-empty" role="status">
          {unarchivedItems.length === 0 ? 'No messages yet.' : 'No messages match these filters.'}
        </div>
      ) : (
        <ol className="cf-builder-agent-workbench-list">
          {items.map((item) => {
            const ownerMessage = item.content_type === 'builder.chat.user_message.v1';
            const turnStatus = item.content_type === 'builder.chat.turn_status.v1';
            const genericMessage = item.presentation_family === 'generic';
            return (
              <li
                className={ownerMessage
                  ? 'cf-builder-agent-workbench-message cf-builder-agent-workbench-message-owner'
                  : 'cf-builder-agent-workbench-message'}
                data-builder-workbench-content-type={item.content_type}
                data-builder-workbench-family={item.presentation_family}
                data-builder-workbench-message={item.message_id}
                key={item.message_id}
              >
                {genericMessage ? (
                  <div className="cf-builder-agent-workbench-message-meta">
                    <span>{item.source_label}</span>
                    <code>{item.content_type}</code>
                  </div>
                ) : null}
                <div className={turnStatus
                  ? 'cf-builder-agent-workbench-message-body cf-builder-agent-turn-status'
                  : 'cf-builder-agent-workbench-message-body'} role={turnStatus ? 'note' : undefined}>
                  {turnStatus ? <StopCircle aria-hidden="true" className="size-3.5 shrink-0" /> : null}
                  {item.presentation.body_kind === 'markdown' ? (
                    <BuilderConversationMarkdown source={item.presentation.body_text} />
                  ) : (
                    <p>{item.presentation.body_text}</p>
                  )}
                </div>
                {item.message_id === projection?.agent_plan?.artifact.source_message_id ? planDecision : null}
                {item.actions.map((action) => (
                  <AgentTaskProposalActions
                    action={action}
                    disabled={actionsDisabled}
                    key={action.action_id}
                    onCreateProject={onCreateProjectForTaskProposal}
                    onDecide={onDecideTaskProposal}
                    onOpenTask={onOpenTaskProposal}
                    projectCatalogSnapshot={projectCatalogSnapshot}
                  />
                ))}
                {item.presentation_family === 'result' ? (
                  <div className="cf-builder-agent-result-actions">
                    {item.task_ref !== null && typeof onOpenTaskProposal === 'function' ? (
                      <button
                        className="cf-builder-agent-result-open"
                        data-builder-agent-result-open-task="true"
                        data-builder-task-address-id={item.task_ref.task_address_id}
                        onClick={() => {
                          const taskRef = item.task_ref;
                          if (taskRef === null) return;
                          const monitoredTask = projection?.task_monitor.tasks.find(
                            (task) => task.task_address_id === taskRef.task_address_id,
                          ) ?? null;
                          onOpenTaskProposal(
                            taskRef.project_id,
                            taskRef.task_address_id,
                            monitoredTask === null
                              ? null
                              : taskConversationSeedFromMonitorTask(monitoredTask),
                          );
                        }}
                        type="button"
                      >
                        <ArrowRight aria-hidden="true" className="size-3.5" />
                        Open task
                      </button>
                    ) : null}
                    <span className="cf-builder-agent-result-state-actions">
                      {!item.state.acknowledged && typeof onUpdateMessageState === 'function' ? (
                        <button
                          className="cf-builder-agent-result-state-button"
                          data-builder-agent-result-acknowledge="true"
                          disabled={actionsDisabled}
                          onClick={() => { void onUpdateMessageState(item.message_id, 'acknowledge'); }}
                          type="button"
                        >
                          <CheckCircle2 aria-hidden="true" className="size-3.5" />
                          Acknowledge
                        </button>
                      ) : null}
                      {typeof onUpdateMessageState === 'function' ? (
                        <button
                          aria-label="Archive result"
                          className="cf-builder-agent-result-archive"
                          data-builder-agent-result-archive="true"
                          disabled={actionsDisabled}
                          onClick={() => { void onUpdateMessageState(item.message_id, 'archive'); }}
                          title="Archive result"
                          type="button"
                        >
                          <Archive aria-hidden="true" className="size-3.5" />
                        </button>
                      ) : null}
                    </span>
                  </div>
                ) : item.task_ref !== null && typeof onOpenTaskProposal === 'function' ? (
                  <button
                    className="cf-builder-agent-result-open"
                    data-builder-agent-result-open-task="true"
                    data-builder-task-address-id={item.task_ref.task_address_id}
                    onClick={() => onOpenTaskProposal(
                      item.task_ref!.project_id,
                      item.task_ref!.task_address_id,
                    )}
                    type="button"
                  >
                    <ArrowRight aria-hidden="true" className="size-3.5" />
                    Open task
                  </button>
                ) : null}
                {item.state.unread && !ownerMessage && typeof onUpdateMessageState === 'function' ? (
                  <button
                    aria-label="Mark message as read"
                    className="cf-builder-agent-workbench-message-action"
                    onClick={() => { void onUpdateMessageState(item.message_id, 'mark_read'); }}
                    title="Mark as read"
                    type="button"
                  >
                    <CheckCircle2 aria-hidden="true" className="size-3.5" />
                  </button>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
      {projection !== null && unavailable && typeof onRefresh === 'function' ? (
        <button
          aria-label="Refresh Agent Workbench"
          className="cf-builder-agent-workbench-refresh"
          onClick={() => { void onRefresh(); }}
          title="Refresh"
          type="button"
        >
          <RefreshCw aria-hidden="true" className="size-3.5" />
        </button>
      ) : null}
      {liveOutput !== null && liveOutput !== undefined ? (
        <ol className="cf-builder-agent-workbench-list cf-builder-agent-workbench-live-output">
          <ActivityLiveOutputSlot
            committedPrefix=""
            fallback={liveOutput}
            onVisibleFrame={onLiveOutputFrame}
            store={liveOutputStore ?? null}
          />
        </ol>
      ) : null}
    </section>
  );
}

function taskMonitorStateIcon(task: BuilderAgentTaskMonitorItem) {
  if (task.state === 'working') return <RefreshCw aria-hidden="true" className="size-3.5 cf-builder-task-monitor-spin" />;
  if (task.group === 'attention') return <AlertCircle aria-hidden="true" className="size-3.5" />;
  if (task.state === 'stopped') return <StopCircle aria-hidden="true" className="size-3.5" />;
  if (task.latest_result === null) return <Circle aria-hidden="true" className="size-3.5" />;
  return <CheckCircle2 aria-hidden="true" className="size-3.5" />;
}

function AgentTaskMonitorPanel({
  actionsDisabled,
  onCollapse,
  onArchiveTask,
  onControlTask,
  onOpenTask,
  onRenameTask,
  projectCatalogSnapshot,
  snapshot,
}: Readonly<{
  actionsDisabled: boolean;
  onCollapse(): void;
  onArchiveTask?: (
    projectId: string,
    taskAddressId: string,
  ) => Promise<unknown> | void;
  onControlTask?: (
    projectId: string,
    taskAddressId: string,
    operation: 'cancel_task',
  ) => Promise<unknown> | void;
  onOpenTask?: (
    projectId: string,
    taskAddressId: string,
    seed?: BuilderTaskConversationSeed | null,
  ) => void;
  onRenameTask?: (
    projectId: string,
    taskAddressId: string,
    title: string,
  ) => Promise<unknown> | void;
  projectCatalogSnapshot?: BuilderProjectCatalogSnapshot;
  snapshot?: BuilderAgentWorkbenchSnapshot;
}>) {
  const tasks = snapshot?.projection?.task_monitor.tasks ?? [];
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [taskActionMenuOpenFor, setTaskActionMenuOpenFor] = useState<string | null>(null);
  const [renamingTaskId, setRenamingTaskId] = useState<string | null>(null);
  const [draftTaskTitle, setDraftTaskTitle] = useState('');
  const selectedTask = tasks.find((task) => task.task_address_id === selectedTaskId) ?? tasks[0] ?? null;
  const projectTitleById = useMemo(() => {
    const entries = [
      ...(projectCatalogSnapshot?.projects ?? []),
      ...(projectCatalogSnapshot?.workspaceProjects ?? []),
    ].map((project) => [project.project_id, project.title] as const);
    return new Map(entries);
  }, [projectCatalogSnapshot]);
  const groups = [
    { id: 'active', label: 'Active' },
    { id: 'attention', label: 'Needs attention' },
    { id: 'recent', label: 'Recent' },
  ] as const;
  const selectedTaskActionsAvailable = selectedTask !== null
    && (typeof onArchiveTask === 'function' || typeof onRenameTask === 'function');
  const selectedTaskIsRenaming = selectedTask !== null
    && renamingTaskId === selectedTask.task_address_id;

  function submitTaskRename(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (selectedTask === null || typeof onRenameTask !== 'function') {
      setRenamingTaskId(null);
      return;
    }
    const nextTitle = draftTaskTitle.trim();
    if (nextTitle.length === 0 || nextTitle === selectedTask.title) {
      setRenamingTaskId(null);
      setDraftTaskTitle('');
      return;
    }
    void onRenameTask(selectedTask.project_id, selectedTask.task_address_id, nextTitle);
    setRenamingTaskId(null);
    setDraftTaskTitle('');
  }

  return (
    <aside
      aria-label="Tasks"
      className="cf-builder-task-monitor"
      data-builder-task-monitor="true"
    >
      <header className="cf-builder-task-monitor-header">
        <div>
          <strong>Tasks</strong>
          <span>{tasks.length}</span>
        </div>
        <button
          aria-label="Hide tasks"
          className="cf-builder-icon-button"
          onClick={onCollapse}
          title="Hide tasks"
          type="button"
        >
          <PanelRightClose aria-hidden="true" className="size-4" />
        </button>
      </header>
      <div className="cf-builder-task-monitor-list">
        {groups.map((group) => {
          const groupTasks = tasks.filter((task) => task.group === group.id);
          if (groupTasks.length === 0) return null;
          return (
            <section data-builder-task-monitor-group={group.id} key={group.id}>
              <h2>{group.label}<span>{groupTasks.length}</span></h2>
              <ul>
                {groupTasks.map((task) => (
                  <li key={task.task_address_id}>
                    <button
                      aria-pressed={selectedTask?.task_address_id === task.task_address_id}
                      data-builder-task-monitor-item={task.task_address_id}
                      data-builder-task-monitor-state={task.state}
                      onClick={() => setSelectedTaskId(task.task_address_id)}
                      type="button"
                    >
                      <span className="cf-builder-task-monitor-icon" data-state={task.state}>
                        {taskMonitorStateIcon(task)}
                      </span>
                      <span className="min-w-0">
                        <strong>{task.title}</strong>
                        <small>{projectTitleById.get(task.project_id) ?? 'Local project'}</small>
                      </span>
                      <small data-state={task.state}>{task.status_label}</small>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
      {selectedTask !== null ? (
        <footer className="cf-builder-task-monitor-detail" data-builder-task-monitor-detail={selectedTask.task_address_id}>
          <div className="cf-builder-task-monitor-detail-heading">
            <div className="min-w-0">
              {selectedTaskIsRenaming ? (
                <form
                  className="cf-builder-task-monitor-rename-form"
                  data-builder-task-monitor-rename-form="true"
                  onSubmit={submitTaskRename}
                >
                  <input
                    aria-label="Task name"
                    className="cf-builder-input"
                    data-builder-task-monitor-rename-input="true"
                    onChange={(event) => setDraftTaskTitle(event.currentTarget.value)}
                    value={draftTaskTitle}
                  />
                  <span>
                    <button
                      className="cf-builder-secondary-button"
                      data-builder-task-monitor-rename-cancel="true"
                      onClick={() => {
                        setDraftTaskTitle('');
                        setRenamingTaskId(null);
                      }}
                      type="button"
                    >
                      <X aria-hidden="true" className="size-3.5" />
                      Cancel
                    </button>
                    <button
                      className="cf-builder-primary-button"
                      data-builder-task-monitor-rename-save="true"
                      disabled={draftTaskTitle.trim().length === 0}
                      type="submit"
                    >
                      Save
                    </button>
                  </span>
                </form>
              ) : (
                <>
                  <strong>{selectedTask.title}</strong>
                  <p>{selectedTask.attention?.detail ?? selectedTask.latest_result?.summary ?? selectedTask.goal}</p>
                </>
              )}
            </div>
            {selectedTaskActionsAvailable ? (
              <div className="cf-builder-task-monitor-action-shell">
                <button
                  aria-expanded={taskActionMenuOpenFor === selectedTask.task_address_id}
                  aria-haspopup="menu"
                  aria-label={`Task actions for ${selectedTask.title}`}
                  className="cf-builder-task-monitor-action-button"
                  data-builder-task-monitor-task-actions="true"
                  onClick={() => setTaskActionMenuOpenFor((openFor) => (
                    openFor === selectedTask.task_address_id ? null : selectedTask.task_address_id
                  ))}
                  title="Task actions"
                  type="button"
                >
                  <MoreVertical aria-hidden="true" className="size-3.5" />
                </button>
                {taskActionMenuOpenFor === selectedTask.task_address_id ? (
                  <div
                    className="cf-builder-task-monitor-action-menu"
                    data-builder-task-monitor-action-menu="true"
                    role="menu"
                  >
                    {typeof onRenameTask === 'function' ? (
                      <button
                        data-builder-task-monitor-rename-task="true"
                        onClick={() => {
                          setDraftTaskTitle(selectedTask.title);
                          setRenamingTaskId(selectedTask.task_address_id);
                          setTaskActionMenuOpenFor(null);
                        }}
                        role="menuitem"
                        type="button"
                      >
                        <Pencil aria-hidden="true" className="size-3.5" />
                        Rename
                      </button>
                    ) : null}
                    {typeof onArchiveTask === 'function' ? (
                      <button
                        data-builder-task-monitor-archive-task="true"
                        onClick={() => {
                          setTaskActionMenuOpenFor(null);
                          void onArchiveTask(selectedTask.project_id, selectedTask.task_address_id);
                        }}
                        role="menuitem"
                        type="button"
                      >
                        <Archive aria-hidden="true" className="size-3.5" />
                        Archive
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
          <div className="cf-builder-task-monitor-commands">
            {canStopBuilderAgentTask(selectedTask) && typeof onControlTask === 'function' ? (
              <button
                className="cf-builder-secondary-button"
                data-builder-task-monitor-cancel-task="true"
                disabled={actionsDisabled}
                onClick={() => { void onControlTask(
                  selectedTask.project_id,
                  selectedTask.task_address_id,
                  'cancel_task',
                ); }}
                type="button"
              >
                <StopCircle aria-hidden="true" className="size-3.5" />
                Stop
              </button>
            ) : null}
            <button
              className="cf-builder-primary-button"
              data-builder-task-monitor-open-task="true"
              disabled={typeof onOpenTask !== 'function'}
              onClick={() => onOpenTask?.(
                selectedTask.project_id,
                selectedTask.task_address_id,
                taskConversationSeedFromMonitorTask(selectedTask),
              )}
              type="button"
            >
              {selectedTask.attention?.action_label ?? 'Open task'}
              <ArrowRight aria-hidden="true" className="size-3.5" />
            </button>
          </div>
        </footer>
      ) : null}
    </aside>
  );
}

function artifactTabLabel(tab: BuilderArtifactTab): string {
  if (tab === 'browser_placeholder') return 'New tab';
  if (tab === 'preview') return 'Preview';
  if (tab === 'changes') return 'Changes';
  if (tab === 'source') return 'Files';
  if (tab === 'permissions') return 'Permissions';
  if (tab === 'side_chat_placeholder') return 'Side Chat';
  if (tab === 'terminal_placeholder') return 'Terminal';
  return 'History';
}

function ArtifactTabIcon({ tab }: Readonly<{ tab: BuilderArtifactTab }>) {
  if (tab === 'browser_placeholder') return <Globe2 aria-hidden="true" className="size-3.5" />;
  if (tab === 'preview') return <Globe2 aria-hidden="true" className="size-3.5" />;
  if (tab === 'changes') return <GitCompareArrows aria-hidden="true" className="size-3.5" />;
  if (tab === 'source') return <FileCode2 aria-hidden="true" className="size-3.5" />;
  if (tab === 'permissions') return <ShieldCheck aria-hidden="true" className="size-3.5" />;
  if (tab === 'side_chat_placeholder') return <Bot aria-hidden="true" className="size-3.5" />;
  if (tab === 'terminal_placeholder') return <SquareTerminal aria-hidden="true" className="size-3.5" />;
  return <History aria-hidden="true" className="size-3.5" />;
}

function sideWorkspaceTabTypeForArtifactTab(tab: BuilderArtifactTab): BuilderSideWorkspaceTabType {
  if (tab === 'browser_placeholder' || tab === 'preview') return 'browser';
  if (tab === 'source') return 'file';
  if (tab === 'terminal_placeholder') return 'terminal';
  if (tab === 'side_chat_placeholder') return 'side_chat';
  return 'review';
}

function artifactTabForSideWorkspaceTabType(
  type: BuilderSideWorkspaceTabType,
  availableTabs: readonly BuilderArtifactTab[],
): BuilderArtifactTab | null {
  if (type === 'browser') {
    if (availableTabs.includes('preview')) return 'preview';
    return availableTabs.includes('browser_placeholder') ? 'browser_placeholder' : null;
  }
  if (type === 'file') return availableTabs.includes('source') ? 'source' : null;
  if (type === 'terminal') return availableTabs.includes('terminal_placeholder') ? 'terminal_placeholder' : null;
  if (type === 'side_chat') return availableTabs.includes('side_chat_placeholder') ? 'side_chat_placeholder' : null;
  if (type === 'review') {
    if (availableTabs.includes('changes')) return 'changes';
    if (availableTabs.includes('permissions')) return 'permissions';
    if (availableTabs.includes('versions')) return 'versions';
    return null;
  }
  return null;
}

function SideWorkspaceNewTabIcon({ type }: Readonly<{ type: BuilderSideWorkspaceTabType }>) {
  if (type === 'browser') return <Globe2 aria-hidden="true" className="size-3.5" />;
  if (type === 'file') return <FileCode2 aria-hidden="true" className="size-3.5" />;
  if (type === 'terminal') return <SquareTerminal aria-hidden="true" className="size-3.5" />;
  if (type === 'side_chat') return <Bot aria-hidden="true" className="size-3.5" />;
  return <GitCompareArrows aria-hidden="true" className="size-3.5" />;
}

const SIDE_WORKSPACE_NEW_TAB_ITEMS: readonly Readonly<{
  label: string;
  type: BuilderSideWorkspaceTabType;
  status: 'available_when_projected';
}>[] = Object.freeze([
  { label: 'File', type: 'file', status: 'available_when_projected' },
  { label: 'Side Chat', type: 'side_chat', status: 'available_when_projected' },
  { label: 'Browser', type: 'browser', status: 'available_when_projected' },
  { label: 'Terminal', type: 'terminal', status: 'available_when_projected' },
  { label: 'Review', type: 'review', status: 'available_when_projected' },
]);

function sideWorkspaceFileRefKey(fileRef: BuilderSideWorkspaceFileRef | null): string {
  if (fileRef === null) return 'none';
  return `${fileRef.source_kind}:${fileRef.source_tree_digest}:${fileRef.path}:${fileRef.content_digest}`;
}

function sideWorkspaceFileDepthStyle(depth: number): CSSProperties {
  return { '--cf-builder-file-depth': Math.max(0, Math.min(12, depth)) } as CSSProperties;
}

function sideWorkspaceFileDisplayName(path: string | null): string {
  if (path === null || path.trim().length === 0) return 'Files';
  return path.split('/').filter(Boolean).at(-1) ?? path;
}

function sideWorkspaceCodeLines(text: string): readonly string[] {
  const normalized = text.replace(/\r\n/gu, '\n').replace(/\r/gu, '\n');
  const lines = normalized.split('\n');
  if (lines.length > 1 && lines.at(-1) === '') return lines.slice(0, -1);
  return lines;
}

function firstTextFileEntry(
  tree: BuilderSideWorkspaceFileTreeProjection | null,
): Extract<BuilderSideWorkspaceFileTreeEntry, { entry_kind: 'text_file' }> | null {
  return tree?.entries.find((entry): entry is Extract<
    BuilderSideWorkspaceFileTreeEntry,
    { entry_kind: 'text_file' }
  > => entry.entry_kind === 'text_file') ?? null;
}

function BuilderArtifactFilesPanel({
  activePath,
  content,
  contentStatus,
  fallbackFiles,
  fallbackSourceFile,
  onOpenFile,
  onSelectFallbackFile,
  onSourceOpenChange,
  projection,
  sourceDisclosureOpen,
  sourceDisclosureRef,
  treeStatus,
}: Readonly<{
  activePath: string | null;
  content: BuilderSideWorkspaceFileContentProjection | null;
  contentStatus: 'idle' | 'loading' | 'ready' | 'failed';
  fallbackFiles: readonly BuilderProjectSourceFile[];
  fallbackSourceFile: BuilderProjectSourceFile | null;
  onOpenFile?: (fileRef: BuilderSideWorkspaceFileRef) => Promise<unknown> | void;
  onSelectFallbackFile?: (file: BuilderFileName) => void;
  onSourceOpenChange: (open: boolean) => void;
  projection: BuilderSideWorkspaceFileTreeProjection | null;
  sourceDisclosureOpen: boolean;
  sourceDisclosureRef: Ref<HTMLDetailsElement>;
  treeStatus: 'idle' | 'loading' | 'ready' | 'failed';
}>) {
  if (projection === null && treeStatus !== 'loading' && fallbackSourceFile !== null) {
    return (
      <BuilderSourceDisclosure
        canToggle
        disclosureRef={sourceDisclosureRef}
        files={fallbackFiles}
        onOpenChange={onSourceOpenChange}
        onSelectFile={onSelectFallbackFile}
        open={sourceDisclosureOpen}
        placement="artifact"
        sourceFile={fallbackSourceFile}
      />
    );
  }

  const firstFile = firstTextFileEntry(projection);
  const fileCount = projection?.entries.filter((entry) => entry.entry_kind === 'text_file').length ?? 0;
  const activeTreeFile = projection?.entries.find((entry) => (
    entry.entry_kind === 'text_file' && entry.path === activePath
  ));
  const contentMatchesActivePath = activePath === null || content?.path === activePath;
  const visibleContent = contentMatchesActivePath ? content : null;
  const visibleContentStatus = contentMatchesActivePath
    ? contentStatus
    : contentStatus === 'failed' ? 'failed' : 'loading';
  const selectedFileRef = (activeTreeFile?.entry_kind === 'text_file' ? activeTreeFile.file_ref : null)
    ?? visibleContent?.file_ref
    ?? projection?.selected_file_ref
    ?? firstFile?.file_ref
    ?? null;
  const selectedRefKey = sideWorkspaceFileRefKey(selectedFileRef);
  const selectedPath = selectedFileRef?.path ?? visibleContent?.path ?? null;
  const selectedName = sideWorkspaceFileDisplayName(selectedPath);
  return (
    <section
      aria-label="Project files"
      className="cf-builder-artifact-files"
      data-builder-side-workspace-files="true"
      data-builder-side-workspace-file-source-kind={projection?.source_kind ?? 'none'}
      data-builder-side-workspace-files-status={treeStatus}
    >
      <div className="cf-builder-artifact-files-body">
        <section
          aria-label="Selected file"
          aria-busy={visibleContentStatus === 'loading'}
          className="cf-builder-artifact-file-content"
          data-builder-side-workspace-file-content={visibleContent?.path ?? 'none'}
          data-builder-side-workspace-file-content-status={visibleContentStatus}
        >
          <header className="cf-builder-artifact-file-content-header">
            <strong data-builder-side-workspace-file-path="true">
              {selectedPath === null ? 'No file selected' : `/${selectedPath}`}
            </strong>
            {visibleContent === null ? null : (
              <span>{visibleContent.language_hint}{visibleContent.content_status === 'truncated' ? ' - truncated' : ''}</span>
            )}
          </header>
          {visibleContentStatus === 'loading' ? (
            <div className="cf-builder-artifact-file-loading" role="status">
              <span className="cf-builder-visually-hidden">Loading {selectedName}...</span>
              <div aria-hidden="true" className="cf-builder-artifact-file-loading-lines">
                {Array.from({ length: 9 }, (_, index) => (
                  <span className="cf-builder-artifact-file-loading-line" key={index} />
                ))}
              </div>
            </div>
          ) : visibleContent === null ? (
            <p className="cf-builder-artifact-files-empty" role={visibleContentStatus === 'failed' ? 'alert' : 'status'}>
              {visibleContentStatus === 'failed' ? 'This file is unavailable.' : 'Select a file to inspect its content.'}
            </p>
          ) : (
              <ol
                aria-label={`${visibleContent.path} source preview`}
                className="cf-builder-artifact-file-code"
                data-builder-side-workspace-scroll-region="file-content"
                data-builder-side-workspace-code-viewer="true"
              >
                {sideWorkspaceCodeLines(visibleContent.text_preview).map((line, index) => (
                  <li
                    className="cf-builder-artifact-file-code-line"
                    data-builder-side-workspace-code-line={index + 1}
                    key={`${index}:${line}`}
                  >
                    <span className="cf-builder-artifact-file-code-number" aria-hidden="true">
                      {index + 1}
                    </span>
                    <code>{line.length === 0 ? ' ' : line}</code>
                  </li>
                ))}
              </ol>
          )}
        </section>
        <aside className="cf-builder-artifact-file-browser" aria-label="Project file browser">
          <div className="cf-builder-artifact-file-browser-header">
            <strong>Files</strong>
            <span>
              {projection === null
                ? 'Current draft'
                : `${projection.root_label} · ${fileCount}`}
            </span>
          </div>
          <div className="cf-builder-artifact-file-filter" aria-hidden="true">Filter files...</div>
          <div
            aria-label="Project file tree"
            className="cf-builder-artifact-file-tree"
            data-builder-side-workspace-scroll-region="file-tree"
          >
            {projection === null ? (
              <p className="cf-builder-artifact-files-empty" role={treeStatus === 'failed' ? 'alert' : 'status'}>
                {treeStatus === 'loading' ? 'Loading files...' : 'Current draft files are not available yet.'}
              </p>
            ) : (
              projection.entries.map((entry) => {
                if (entry.entry_kind === 'directory') {
                  return (
                    <div
                      className="cf-builder-artifact-file-entry"
                      data-builder-side-workspace-file-entry={entry.path}
                      data-builder-side-workspace-file-kind="directory"
                      key={`directory:${entry.path}`}
                      style={sideWorkspaceFileDepthStyle(entry.depth)}
                    >
                      <FolderOpen aria-hidden="true" className="size-3.5" />
                      <span>{entry.name}</span>
                      <small>{entry.child_count}</small>
                    </div>
                  );
                }
                const active = selectedRefKey === sideWorkspaceFileRefKey(entry.file_ref)
                  || (content === null && firstFile?.path === entry.path);
                return (
                  <button
                    className="cf-builder-artifact-file-entry"
                    data-active={active ? 'true' : undefined}
                    data-builder-side-workspace-file-entry={entry.path}
                    data-builder-side-workspace-file-kind="text_file"
                    key={`file:${entry.path}`}
                    onClick={() => {
                      void onOpenFile?.(entry.file_ref);
                    }}
                    style={sideWorkspaceFileDepthStyle(entry.depth)}
                    type="button"
                  >
                    <FileCode2 aria-hidden="true" className="size-3.5" />
                    <span>{entry.name}</span>
                  </button>
                );
              })
            )}
          </div>
        </aside>
      </div>
    </section>
  );
}

function BuilderSideWorkspaceBrowserToolbar({
  addressMode = 'project_preview',
  addressValue = '',
  livePreviewOperation,
  livePreviewStatus,
  userWebOperation = null,
  userWebStatus = null,
  onAddressChange,
  onNavigateUserWeb,
  onGoBackUserWeb,
  onGoForwardUserWeb,
  onReloadUserWeb,
  onStopUserWeb,
  onExpandPreview,
  onRequestLivePreview,
  onReloadLivePreview,
  onStopLivePreview,
}: Readonly<{
  addressMode?: 'agent_test' | 'project_preview' | 'user_web';
  addressValue?: string;
  livePreviewOperation?: 'starting' | 'reloading' | 'stopping' | null;
  livePreviewStatus: BuilderLivePreviewStatusProjection | null;
  userWebOperation?: 'navigating' | 'reloading' | 'stopping' | null;
  userWebStatus?: BuilderUserWebStatusProjection | null;
  onAddressChange?: (value: string) => void;
  onNavigateUserWeb?: () => void;
  onGoBackUserWeb?: () => void;
  onGoForwardUserWeb?: () => void;
  onReloadUserWeb?: () => void;
  onStopUserWeb?: () => void;
  onExpandPreview?: () => void;
  onRequestLivePreview?: () => Promise<unknown> | void;
  onReloadLivePreview?: () => Promise<unknown> | void;
  onStopLivePreview?: () => Promise<unknown> | void;
}>) {
  const operation = livePreviewOperation ?? null;
  const canStart = operation === null
    && typeof onRequestLivePreview === 'function'
    && livePreviewStatus?.can_start === true;
  const canReload = operation === null
    && typeof onReloadLivePreview === 'function'
    && livePreviewStatus?.can_reload === true;
  const canStop = operation === null
    && typeof onStopLivePreview === 'function'
    && livePreviewStatus?.can_stop === true;
  const userWebActive = addressMode === 'user_web';
  const userWebBusy = userWebOperation !== null;
  const addressLabel = userWebActive
    ? addressValue
    : addressMode === 'agent_test'
      ? 'Agent Test local project'
      : livePreviewStatus?.entry_url
      ?? (livePreviewStatus?.status === 'ready' ? 'Project live preview' : 'Project preview');
  const blockedSummary = livePreviewStatus !== null && livePreviewStatus.blocked_request_count > 0
    ? `Blocked ${livePreviewStatus.blocked_request_count} unsafe preview request${
      livePreviewStatus.blocked_request_count === 1 ? '' : 's'
    }`
    : null;
  return (
    <div
      aria-label="Browser preview controls"
      className="cf-builder-side-workspace-browser-toolbar"
      data-builder-side-workspace-browser-toolbar="true"
    >
      <span className="cf-builder-side-workspace-browser-nav" aria-label="Browser navigation">
        <button
          aria-label="Back"
          disabled={!userWebActive || userWebBusy || userWebStatus?.can_go_back !== true}
          onClick={onGoBackUserWeb}
          title="Back"
          type="button"
        >
          <ArrowLeft aria-hidden="true" className="size-3.5" />
        </button>
        <button
          aria-label="Forward"
          disabled={!userWebActive || userWebBusy || userWebStatus?.can_go_forward !== true}
          onClick={onGoForwardUserWeb}
          title="Forward"
          type="button"
        >
          <ArrowRight aria-hidden="true" className="size-3.5" />
        </button>
        <button
          aria-label={userWebActive ? 'Reload page' : 'Reload preview'}
          disabled={userWebActive
            ? userWebBusy || userWebStatus?.can_reload !== true
            : !canReload}
          onClick={() => {
            if (userWebActive) onReloadUserWeb?.();
            else void onReloadLivePreview?.();
          }}
          data-builder-live-preview-reload="true"
          title={userWebActive
            ? userWebStatus?.can_reload === true ? 'Reload page' : 'Reload page unavailable'
            : canReload ? 'Reload preview' : 'Reload preview unavailable'}
          type="button"
        >
          <RefreshCw aria-hidden="true" className="size-3.5" />
        </button>
      </span>
      <label
        aria-label="Preview address"
        className="cf-builder-side-workspace-browser-address"
        data-builder-side-workspace-browser-address="true"
      >
        {blockedSummary !== null ? (
          <span
            aria-label={blockedSummary}
            className="cf-builder-side-workspace-browser-status"
            data-builder-live-preview-blocked-count="true"
            role="img"
            title={blockedSummary}
          >
            <ShieldCheck aria-hidden="true" className="size-3.5" />
          </span>
        ) : null}
        <input
          aria-label="Browser address"
          title={addressLabel}
          placeholder="Enter URL"
          readOnly={!userWebActive}
          onChange={(event) => onAddressChange?.(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (!userWebActive || event.key !== 'Enter' || userWebBusy || addressValue.trim() === '') return;
            event.preventDefault();
            onNavigateUserWeb?.();
          }}
          value={addressLabel}
        />
      </label>
      <span className="cf-builder-side-workspace-browser-tools" aria-label="Browser tools">
        <button
          aria-label="Start live preview"
          data-builder-live-preview-start="true"
          disabled={userWebActive || !canStart}
          onClick={() => { void onRequestLivePreview?.(); }}
          title={canStart ? 'Start live preview' : 'Start live preview unavailable'}
          type="button"
        >
          <Play aria-hidden="true" className="size-3.5" />
        </button>
        <button
          aria-label={userWebActive ? 'Close page' : 'Stop live preview'}
          data-builder-live-preview-stop="true"
          disabled={userWebActive
            ? userWebBusy || userWebStatus?.can_stop !== true
            : !canStop}
          onClick={() => {
            if (userWebActive) onStopUserWeb?.();
            else void onStopLivePreview?.();
          }}
          title={userWebActive ? 'Close page' : canStop ? 'Stop live preview' : 'Stop live preview unavailable'}
          type="button"
        >
          <StopCircle aria-hidden="true" className="size-3.5" />
        </button>
        <button aria-label="Downloads unavailable" disabled title="Downloads unavailable" type="button">
          <Download aria-hidden="true" className="size-3.5" />
        </button>
        {typeof onExpandPreview === 'function' ? (
          <button
            aria-label="Expand preview"
            data-builder-expand-preview="true"
            onClick={onExpandPreview}
            title="Expand preview"
            type="button"
          >
            <Maximize2 aria-hidden="true" className="size-3.5" />
          </button>
        ) : null}
        <button aria-label="Browser menu unavailable" disabled title="Browser menu unavailable" type="button">
          <MoreVertical aria-hidden="true" className="size-3.5" />
        </button>
      </span>
    </div>
  );
}

function BuilderLivePreviewDevServerApproval({
  livePreviewOperation,
  livePreviewStatus,
  onDecide,
}: Readonly<{
  livePreviewOperation: 'starting' | 'reloading' | 'stopping' | null;
  livePreviewStatus: BuilderLivePreviewStatusProjection | null;
  onDecide?: (decision: 'allow_once' | 'deny') => Promise<unknown> | void;
}>) {
  const approval = livePreviewStatus?.status === 'approval_required'
    ? livePreviewStatus.dev_server_approval
    : null;
  if (approval === null) return null;
  const disabled = livePreviewOperation !== null || typeof onDecide !== 'function';
  return (
    <section
      aria-label="Development server approval"
      className="cf-builder-live-preview-approval"
      data-builder-live-preview-dev-server-approval={approval.approval_request_id}
    >
      <div className="cf-builder-live-preview-approval-copy">
        <strong>允许运行项目开发服务器？</strong>
        <code>{approval.command_display}</code>
        <p>此项目脚本可能修改文件或访问网络。授权仅对本次启动有效。</p>
      </div>
      <div className="cf-builder-live-preview-approval-actions">
        <button
          className="cf-builder-secondary-button"
          data-builder-deny-live-preview-dev-server="true"
          disabled={disabled}
          onClick={() => { void onDecide?.('deny'); }}
          type="button"
        >
          拒绝
        </button>
        <button
          className="cf-builder-primary-button"
          data-builder-allow-live-preview-dev-server-once="true"
          disabled={disabled}
          onClick={() => { void onDecide?.('allow_once'); }}
          type="button"
        >
          {livePreviewOperation === 'starting' ? '正在启动...' : '仅允许这一次'}
        </button>
      </div>
    </section>
  );
}

function BuilderSideWorkspaceBrowserPlaceholder({
  agentTestActive,
  userWebOperation,
  userWebStatus,
  userWebSurfaceRef,
  onNavigateUserWeb,
  onGoBackUserWeb,
  onGoForwardUserWeb,
  onReloadUserWeb,
  onStopUserWeb,
}: Readonly<{
  agentTestActive: boolean;
  userWebOperation: 'navigating' | 'reloading' | 'stopping' | null;
  userWebStatus: BuilderUserWebStatusProjection | null;
  userWebSurfaceRef: Ref<HTMLElement>;
  onNavigateUserWeb?: (url: string) => Promise<unknown> | void;
  onGoBackUserWeb?: () => Promise<unknown> | void;
  onGoForwardUserWeb?: () => Promise<unknown> | void;
  onReloadUserWeb?: () => Promise<unknown> | void;
  onStopUserWeb?: () => Promise<unknown> | void;
}>) {
  const currentUrl = userWebStatus?.current_url ?? null;
  const [addressEdit, setAddressEdit] = useState<Readonly<{
    baseUrl: string | null;
    value: string;
  }> | null>(null);
  const address = addressEdit?.baseUrl === currentUrl
    ? addressEdit.value
    : currentUrl ?? '';
  return (
    <section
      aria-label={agentTestActive ? 'Agent Test browser' : 'Browser new tab'}
      className="cf-builder-side-workspace-browser"
      data-builder-side-workspace-browser-placeholder="true"
    >
      <BuilderSideWorkspaceBrowserToolbar
        addressMode={agentTestActive ? 'agent_test' : 'user_web'}
        addressValue={address}
        livePreviewStatus={null}
        onAddressChange={(value) => setAddressEdit({ baseUrl: currentUrl, value })}
        onGoBackUserWeb={() => { void onGoBackUserWeb?.(); }}
        onGoForwardUserWeb={() => { void onGoForwardUserWeb?.(); }}
        onNavigateUserWeb={() => { void onNavigateUserWeb?.(address); }}
        onReloadUserWeb={() => { void onReloadUserWeb?.(); }}
        onStopUserWeb={() => { void onStopUserWeb?.(); }}
        userWebOperation={userWebOperation}
        userWebStatus={userWebStatus}
      />
      <div
        className="cf-builder-side-workspace-empty cf-builder-side-workspace-browser-empty"
        data-builder-agent-test-browser-surface={agentTestActive ? 'true' : undefined}
        data-builder-user-web-surface={!agentTestActive ? 'true' : undefined}
        ref={userWebSurfaceRef as Ref<HTMLDivElement>}
      >
        <Globe2 aria-hidden="true" className="size-7" />
        <h4>{agentTestActive ? 'Agent Test' : userWebStatus?.status === 'failed' ? 'Page unavailable' : 'Browser'}</h4>
        <p
          className="cf-builder-visually-hidden"
          data-builder-side-workspace-placeholder-note="browser"
        >
          {agentTestActive
            ? 'The isolated local project is open in this browser surface.'
            : userWebStatus?.message ?? 'Enter a URL in the address bar.'}
        </p>
      </div>
    </section>
  );
}

function BuilderSideWorkspaceTerminalPlaceholder({
  checkRunProfile,
  checkRunStatus,
  commandOutput,
  runtimeCommand,
}: Readonly<{
  checkRunProfile: BuilderCheckRunProfile | null;
  checkRunStatus: BuilderDisplayedCheckStatus | null;
  commandOutput: BuilderCommandOutputSnapshot | null;
  runtimeCommand: RuntimeToolActivityItem | null;
}>) {
  if (commandOutput !== null) {
    const stateLabel = {
      awaiting_approval: '等待授权',
      running: '运行中',
      denied: '已拒绝',
      completed: '已完成',
      failed: '执行失败',
    }[commandOutput.state];
    return (
      <section
        aria-label="命令输出"
        className="cf-builder-side-workspace-terminal"
        data-builder-command-terminal={commandOutput.state}
      >
        <div className="cf-builder-side-workspace-terminal-screen">
          <div className="cf-builder-side-workspace-terminal-status">
            <span aria-hidden="true" data-state={commandOutput.state} />
            <strong>{stateLabel}</strong>
          </div>
          <p className="cf-builder-side-workspace-terminal-heading">命令</p>
          <pre data-builder-command-display="true">{commandOutput.command_display}</pre>
          <p className="cf-builder-side-workspace-terminal-description">{commandOutput.description}</p>
          {commandOutput.stdout_text.length > 0 ? (
            <>
              <p className="cf-builder-side-workspace-terminal-heading">标准输出</p>
              <pre data-builder-command-stdout="true">{commandOutput.stdout_text}</pre>
            </>
          ) : null}
          {commandOutput.stderr_text.length > 0 ? (
            <>
              <p className="cf-builder-side-workspace-terminal-heading">错误输出</p>
              <pre className="cf-builder-side-workspace-terminal-stderr" data-builder-command-stderr="true">
                {commandOutput.stderr_text}
              </pre>
            </>
          ) : null}
          {commandOutput.result_summary !== null ? (
            <>
              <p className="cf-builder-side-workspace-terminal-heading">结果</p>
              <p data-builder-command-result={commandOutput.state}>{commandOutput.result_summary}</p>
            </>
          ) : null}
          {commandOutput.output_truncated ? (
            <p className="cf-builder-side-workspace-terminal-truncated">较早的输出已折叠。</p>
          ) : null}
        </div>
        <p className="cf-builder-side-workspace-terminal-note">
          只读实时输出。命令、权限和进程生命周期由 Builder 管理。
        </p>
      </section>
    );
  }
  if (
    runtimeCommand !== null
    && runtimeCommand.target_label !== null
    && runtimeCommand.check_result !== null
  ) {
    return (
      <section
        aria-label="Command details"
        className="cf-builder-side-workspace-terminal"
        data-builder-command-inspector="true"
      >
        <div className="cf-builder-side-workspace-terminal-screen">
          <p className="cf-builder-side-workspace-terminal-heading">Command</p>
          <pre data-builder-command-display="true">{runtimeCommand.target_label}</pre>
          <p className="cf-builder-side-workspace-terminal-heading">Result</p>
          <p data-builder-command-result={runtimeCommand.check_result.status}>
            {runtimeCommand.check_result.summary}
          </p>
        </div>
        <p className="cf-builder-side-workspace-terminal-note">
          Read-only runtime evidence. Command execution remains managed by Builder.
        </p>
      </section>
    );
  }
  if (checkRunProfile !== null && checkRunStatus !== null) {
    return (
      <section
        aria-label="Command details"
        className="cf-builder-side-workspace-terminal"
        data-builder-command-inspector="true"
      >
        <div className="cf-builder-side-workspace-terminal-screen">
          <p className="cf-builder-side-workspace-terminal-heading">Command</p>
          <pre data-builder-command-display="true">{checkRunProfile.command_display}</pre>
          <p className="cf-builder-side-workspace-terminal-heading">Result</p>
          <p data-builder-command-result={checkRunStatus.status}>{checkRunStatus.summary}</p>
        </div>
        <p className="cf-builder-side-workspace-terminal-note">
          Read-only check details. Command execution remains managed by Builder.
        </p>
      </section>
    );
  }
  return (
    <section
      aria-label="Terminal"
      className="cf-builder-side-workspace-terminal"
      data-builder-side-workspace-terminal-placeholder="true"
    >
      <div
        className="cf-builder-side-workspace-terminal-screen"
        aria-hidden="true"
        data-builder-side-workspace-terminal-idle="true"
      >
        <p className="cf-builder-side-workspace-terminal-prompt">PS Project&gt;</p>
      </div>
      <p
        className="cf-builder-side-workspace-terminal-note cf-builder-visually-hidden"
        data-builder-side-workspace-placeholder-note="terminal"
      >
        Terminal runtime is not connected yet.
      </p>
    </section>
  );
}

function BuilderSideWorkspaceChatPlaceholder() {
  return (
    <section
      aria-label="Side chat"
      className="cf-builder-side-workspace-empty"
      data-builder-side-workspace-chat-placeholder="true"
    >
      <Bot aria-hidden="true" className="size-7" />
      <h4>Side chat</h4>
      <p
        className="cf-builder-visually-hidden"
        data-builder-side-workspace-placeholder-note="side_chat"
      >
        Side chat will share this workspace without changing the main task thread.
      </p>
    </section>
  );
}

function approvalModeLabel(mode: BuilderComposerApprovalMode): string {
  if (mode === 'read_only_chat') return 'Read-only chat';
  if (mode === 'allow_current_project') return 'Allow current project';
  return 'Ask before write';
}

function permissionWriteStatus(
  mode: BuilderComposerApprovalMode,
  prompt: BuilderCurrentProjectWriteApprovalPrompt | null,
): string {
  if (mode === 'read_only_chat') return 'Read-only chat is active. Builder will not change files from composer turns.';
  if (prompt?.state === 'pending') return 'Waiting for you to allow current project changes.';
  if (prompt?.state === 'approving') return 'Recording current project write approval.';
  if (prompt?.state === 'failed') return 'Write approval was not recorded. Try again before building.';
  if (mode === 'allow_current_project') return 'Current project changes are allowed for this selected project.';
  return 'Builder will ask before preparing a draft that changes files.';
}

function permissionReadStatus(prompt: BuilderPlanSourceReadApprovalPrompt | null): string {
  if (prompt?.state === 'pending') return 'Waiting for you to allow project reading for the plan.';
  if (prompt?.state === 'approving') return 'Recording project read approval for the plan.';
  if (prompt?.state === 'failed') return 'Project read approval was not recorded. Try again before planning with source.';
  return 'Chat stays read-only unless a plan or tool path asks for project context.';
}

function aiContextPermissionLabel(
  status: BuilderProviderContextDisclosureStatusProjectionWire | null,
): string {
  return status?.label ?? 'Not active';
}

function aiContextPermissionStatus(
  status: BuilderProviderContextDisclosureStatusProjectionWire | null,
): string {
  if (status === null) return 'Builder has not requested current task context for an AI call in this view.';
  if (status.needs_user_approval) {
    return 'Builder needs your approval before sharing current task context with the AI service.';
  }
  return status.next_action_hint;
}

function aiContextPermissionStatusCode(
  status: BuilderProviderContextDisclosureStatusProjectionWire | null,
): 'absent' | 'allowed' | 'denied' | 'needs_approval' {
  if (status === null) return 'absent';
  if (status.can_use_provider_context) return 'allowed';
  return status.needs_user_approval ? 'needs_approval' : 'denied';
}

function aiContextPurposeLabel(
  status: BuilderProviderContextDisclosureStatusProjectionWire | null,
): string {
  const purpose = status?.inspection?.purpose ?? null;
  if (purpose === 'answer') return 'Answer with current context';
  if (purpose === 'plan') return 'Plan with current context';
  if (purpose === 'contextual_build') return 'Build with current context';
  return 'Current AI request';
}

function aiContextSegmentLabel(
  kind: BuilderProviderContextDisclosureInspectionWire['context_surface']['segment_kinds'][number],
): string {
  if (kind === 'latest_user_message') return 'latest message';
  if (kind === 'working_context_objective') return 'current goal';
  if (kind === 'working_context_constraints') return 'confirmed constraints';
  if (kind === 'approved_plan') return 'approved plan';
  if (kind === 'current_result') return 'current result';
  if (kind === 'selected_source_summary') return 'project summary';
  if (kind === 'compaction_summary') return 'conversation summary';
  return 'handoff summary';
}

function aiContextInspectionIncludes(
  status: BuilderProviderContextDisclosureStatusProjectionWire | null,
): string {
  const surface = status?.inspection?.context_surface ?? null;
  if (surface === null || surface.segment_kinds.length === 0) return 'No task summary is prepared.';
  return surface.segment_kinds.map(aiContextSegmentLabel).join(', ');
}

function aiContextInspectionScope(
  status: BuilderProviderContextDisclosureStatusProjectionWire | null,
): string {
  const surface = status?.inspection?.context_surface ?? null;
  if (surface === null) return 'No bounded context request is prepared.';
  const workspace = surface.permission_gate.workspace_state === 'bound'
    ? 'current project'
    : 'no project folder';
  const writeState = surface.permission_gate.side_effect_ready
    ? 'changes can continue under the current approval'
    : 'it will still ask before writing';
  return `${aiContextPurposeLabel(status)} for the configured AI service, scoped to ${workspace}; ${writeState}.`;
}

function BuilderArtifactPermissionsPanel({
  approvalMode,
  currentProjectWriteApproval,
  hasSavedProject,
  hasUnsavedDraft,
  onApproveProviderContextDisclosure,
  planSourceReadApproval,
  providerContextDisclosureApprovalState,
  providerContextDisclosureStatus,
  workingProject,
}: Readonly<{
  approvalMode: BuilderComposerApprovalMode;
  currentProjectWriteApproval: BuilderCurrentProjectWriteApprovalPrompt | null;
  hasSavedProject: boolean;
  hasUnsavedDraft: boolean;
  onApproveProviderContextDisclosure?: () => Promise<unknown> | void;
  planSourceReadApproval: BuilderPlanSourceReadApprovalPrompt | null;
  providerContextDisclosureApprovalState: 'idle' | 'approving' | 'failed';
  providerContextDisclosureStatus: BuilderProviderContextDisclosureStatusProjectionWire | null;
  workingProject: BuilderProjectControllerSnapshot['workingProject'];
}>) {
  const projectLabel = workingProject?.title
    ?? (hasSavedProject ? 'Saved project' : hasUnsavedDraft ? 'Unsaved draft project' : 'No project selected');
  const sourceFolderLabel = workingProject?.source_folders.map((folder) => folder.name).join(', ')
    || (hasSavedProject || hasUnsavedDraft ? 'Current project folder' : 'Choose a project before building');
  return (
    <section
      aria-label="Permissions"
      className="cf-builder-artifact-permissions"
      data-builder-artifact-permissions="true"
    >
      <div className="cf-builder-artifact-permissions-intro">
        <h4>Permissions</h4>
        <p>What Builder can do with the current project.</p>
      </div>
      <dl className="cf-builder-permission-list" data-builder-permission-list="true">
        <div className="cf-builder-permission-row" data-builder-permission-row="workspace">
          <dt>Project boundary</dt>
          <dd>
            <strong>{projectLabel}</strong>
            <span>{sourceFolderLabel}</span>
          </dd>
        </div>
        <div className="cf-builder-permission-row" data-builder-permission-row="approval-mode">
          <dt>Approval mode</dt>
          <dd>
            <strong>{approvalModeLabel(approvalMode)}</strong>
            <span>{permissionWriteStatus(approvalMode, currentProjectWriteApproval)}</span>
          </dd>
        </div>
        <div className="cf-builder-permission-row" data-builder-permission-row="read-project">
          <dt>Project reading</dt>
          <dd>
            <strong>Project context</strong>
            <span>{permissionReadStatus(planSourceReadApproval)}</span>
          </dd>
        </div>
        <div
          className="cf-builder-permission-row"
          data-builder-ai-context-status={aiContextPermissionStatusCode(providerContextDisclosureStatus)}
          data-builder-permission-row="ai-context"
        >
          <dt>AI context</dt>
          <dd>
            <strong>{aiContextPermissionLabel(providerContextDisclosureStatus)}</strong>
            <span>{aiContextPermissionStatus(providerContextDisclosureStatus)}</span>
            {providerContextDisclosureStatus?.inspection !== null
              && providerContextDisclosureStatus?.inspection !== undefined ? (
                <div
                  className="cf-builder-permission-inspection"
                  data-builder-provider-context-disclosure-inspection="true"
                >
                  <span>{aiContextInspectionScope(providerContextDisclosureStatus)}</span>
                  <span>Includes: {aiContextInspectionIncludes(providerContextDisclosureStatus)}.</span>
                  <span>{providerContextDisclosureStatus.inspection.details}</span>
                </div>
              ) : null}
            {providerContextDisclosureStatus?.needs_user_approval === true
              && providerContextDisclosureStatus.request_available ? (
                <button
                  className="cf-builder-secondary-button cf-builder-permission-action"
                  data-builder-approve-provider-context-disclosure="true"
                  disabled={providerContextDisclosureApprovalState === 'approving'}
                  onClick={() => { void onApproveProviderContextDisclosure?.(); }}
                  type="button"
                >
                  {providerContextDisclosureApprovalState === 'approving'
                    ? 'Recording approval...'
                    : 'Allow AI context'}
                </button>
              ) : null}
            {providerContextDisclosureApprovalState === 'failed' ? (
              <span data-builder-provider-context-disclosure-approval-error="true">
                Approval was not recorded. Try again.
              </span>
            ) : null}
          </dd>
        </div>
        <div className="cf-builder-permission-row" data-builder-permission-row="future-tools">
          <dt>Tools</dt>
          <dd>
            <strong>Not enabled</strong>
            <span>Terminal, network, external folders, publish, and delegation are separate future approvals.</span>
          </dd>
        </div>
      </dl>
    </section>
  );
}

const BuilderArtifactSidebar = memo(function BuilderArtifactSidebar({
  activeTab,
  activeFile,
  agentTestBrowserActive,
  approvalMode,
  artifactTabs,
  availableArtifactTabs,
  canUndo,
  changes,
  changesOpen,
  draftCheckpointStatus,
  draftCheckpointTimeline,
  checkRunProfile,
  checkRunStatus,
  currentProjectWriteApproval,
  files,
  hasSavedProject,
  hasUnsavedDraft,
  inspectedRevisionReceiptDigest,
  livePreviewOperation,
  livePreviewStatus,
  userWebOperation,
  userWebStatus,
  userWebSurfaceRef,
  onExpandPreview,
  onApproveProviderContextDisclosure,
  onInspectRevision,
  onOpenFile,
  onRefreshHistory,
  onReloadLivePreview,
  onDecideLivePreviewDevServerApproval,
  onResizeKeyDown,
  onRestoreRevisionAsDraft,
  onUndoDraft,
  onSelectArtifactTab,
  onCloseArtifactTab,
  onOpenWorkspaceTab,
  onRequestLivePreview,
  onResizeStart,
  resizing,
  commandOutput,
  runtimeCommand,
  onSelectFile,
  onSourceOpenChange,
  planSourceReadApproval,
  providerContextDisclosureApprovalState,
  providerContextDisclosureStatus,
  preview,
  previewPanelRef,
  sidebarRef,
  sourceDisclosureOpen,
  sourceDisclosureRef,
  sourceFile,
  sideWorkspaceFileContent,
  sideWorkspaceFileContentStatus,
  sideWorkspaceFileTree,
  sideWorkspaceFileTreeStatus,
  width,
  widthMaximum,
  onSelectSideWorkspaceFile,
  onStopLivePreview,
  onNavigateUserWeb,
  onGoBackUserWeb,
  onGoForwardUserWeb,
  onReloadUserWeb,
  onStopUserWeb,
  workingProject,
  history,
}: Readonly<{
  activeTab: BuilderArtifactTab;
  activeFile: BuilderFileName | null;
  agentTestBrowserActive: boolean;
  approvalMode: BuilderComposerApprovalMode;
  artifactTabs: readonly BuilderArtifactTab[];
  availableArtifactTabs: readonly BuilderArtifactTab[];
  canUndo: boolean;
  changes: BuilderSourceTreeChanges;
  changesOpen: boolean;
  draftCheckpointStatus: BuilderDraftCheckpointStatusProjectionWire | null;
  draftCheckpointTimeline: BuilderDraftCheckpointTimelineProjectionWire | null;
  checkRunProfile: BuilderCheckRunProfile | null;
  checkRunStatus: BuilderDisplayedCheckStatus | null;
  currentProjectWriteApproval: BuilderCurrentProjectWriteApprovalPrompt | null;
  files: readonly BuilderProjectSourceFile[];
  hasSavedProject: boolean;
  hasUnsavedDraft: boolean;
  history: BuilderProjectHistorySnapshot | null;
  inspectedRevisionReceiptDigest: string | null;
  livePreviewOperation: 'starting' | 'reloading' | 'stopping' | null;
  livePreviewStatus: BuilderLivePreviewStatusProjection | null;
  userWebOperation: 'navigating' | 'reloading' | 'stopping' | null;
  userWebStatus: BuilderUserWebStatusProjection | null;
  userWebSurfaceRef: Ref<HTMLElement>;
  onExpandPreview: () => void;
  onApproveProviderContextDisclosure?: () => Promise<unknown> | void;
  onInspectRevision?: (projectId: string, revisionReceiptDigest: string) => Promise<unknown> | void;
  onOpenFile: (change: BuilderSourceTreeChange) => void;
  onRefreshHistory?: () => Promise<unknown> | void;
  onReloadLivePreview?: () => Promise<unknown> | void;
  onDecideLivePreviewDevServerApproval?: (
    decision: 'allow_once' | 'deny',
  ) => Promise<unknown> | void;
  onResizeKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => void;
  onRestoreRevisionAsDraft?: (projectId: string, revisionReceiptDigest: string) => Promise<unknown> | void;
  onUndoDraft?: () => void;
  onSelectArtifactTab: (tab: BuilderArtifactTab) => void;
  onCloseArtifactTab: (tab: BuilderArtifactTab) => void;
  onOpenWorkspaceTab: (type: BuilderSideWorkspaceTabType) => void;
  onRequestLivePreview?: () => Promise<unknown> | void;
  onResizeStart: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  resizing: boolean;
  commandOutput: BuilderCommandOutputSnapshot | null;
  runtimeCommand: RuntimeToolActivityItem | null;
  onSelectFile?: (file: BuilderFileName) => void;
  onSourceOpenChange: (open: boolean) => void;
  planSourceReadApproval: BuilderPlanSourceReadApprovalPrompt | null;
  providerContextDisclosureApprovalState: 'idle' | 'approving' | 'failed';
  providerContextDisclosureStatus: BuilderProviderContextDisclosureStatusProjectionWire | null;
  preview: BuilderProjectControllerSnapshot['preview'];
  previewPanelRef?: Ref<HTMLElement>;
  sidebarRef?: Ref<HTMLElement>;
  sourceDisclosureOpen: boolean;
  sourceDisclosureRef: Ref<HTMLDetailsElement>;
  sourceFile: BuilderProjectSourceFile | null;
  sideWorkspaceFileContent: BuilderSideWorkspaceFileContentProjection | null;
  sideWorkspaceFileContentStatus: 'idle' | 'loading' | 'ready' | 'failed';
  sideWorkspaceFileTree: BuilderSideWorkspaceFileTreeProjection | null;
  sideWorkspaceFileTreeStatus: 'idle' | 'loading' | 'ready' | 'failed';
  width: number;
  widthMaximum: number;
  onSelectSideWorkspaceFile?: (fileRef: BuilderSideWorkspaceFileRef) => Promise<unknown> | void;
  onStopLivePreview?: () => Promise<unknown> | void;
  onNavigateUserWeb?: (url: string) => Promise<unknown> | void;
  onGoBackUserWeb?: () => Promise<unknown> | void;
  onGoForwardUserWeb?: () => Promise<unknown> | void;
  onReloadUserWeb?: () => Promise<unknown> | void;
  onStopUserWeb?: () => Promise<unknown> | void;
  workingProject: BuilderProjectControllerSnapshot['workingProject'];
}>) {
  useLayoutEffect(() => {
    incrementBuilderPerformance('renderer.side_workspace.commit_count');
  });
  useEffect(() => {
    incrementBuilderPerformance('renderer.side_workspace.mount_count');
    return () => {
      incrementBuilderPerformance('renderer.side_workspace.unmount_count');
    };
  }, []);
  const [newTabMenuOpen, setNewTabMenuOpen] = useState(false);
  const openTabSet = useMemo(() => new Set<BuilderArtifactTab>(artifactTabs), [artifactTabs]);
  const activeSideWorkspaceFile = sideWorkspaceFileTree?.entries.find((entry) => (
    entry.entry_kind === 'text_file' && entry.path === activeFile
  ));
  const sourceTabLabel = sideWorkspaceFileDisplayName(
    activeSideWorkspaceFile?.path
      ?? sideWorkspaceFileContent?.path
      ?? sideWorkspaceFileTree?.selected_file_ref?.path
      ?? firstTextFileEntry(sideWorkspaceFileTree)?.path
      ?? sourceFile?.path
      ?? null,
  );
  return (
    <aside
      aria-label="Project artifact"
      className="cf-builder-artifact-sidebar"
      data-builder-artifact-sidebar="true"
      data-builder-artifact-tab-active={activeTab}
      data-builder-side-workspace-open-tab-count={artifactTabs.length}
      ref={sidebarRef}
    >
      <button
        aria-label="Resize artifact panel"
        aria-orientation="vertical"
        aria-valuemax={widthMaximum}
        aria-valuemin={ARTIFACT_MIN_WIDTH_PX}
        aria-valuenow={width}
        className="cf-builder-artifact-resize-handle"
        data-builder-artifact-resize-handle="true"
        data-builder-artifact-resizing={resizing ? 'true' : undefined}
        onKeyDown={onResizeKeyDown}
        onPointerDown={onResizeStart}
        role="separator"
        title="Resize artifact panel"
        type="button"
      />
      <header className="cf-builder-side-workspace-tabs" data-builder-side-workspace-tabs="true">
        <div
          aria-label="Side workspace tabs"
          className="cf-builder-side-workspace-tab-list"
          role="tablist"
        >
          {artifactTabs.map((tab) => {
            const label = tab === 'source'
              ? sourceTabLabel
              : tab === 'browser_placeholder' && agentTestBrowserActive
                ? 'Agent Test'
                : artifactTabLabel(tab);
            return (
              <div
                className="cf-builder-side-workspace-tab"
                data-active={activeTab === tab ? 'true' : undefined}
                data-builder-side-workspace-tab="true"
                data-builder-side-workspace-tab-kind={sideWorkspaceTabTypeForArtifactTab(tab)}
                key={tab}
              >
                <button
                  aria-selected={activeTab === tab}
                  className="cf-builder-side-workspace-tab-main"
                  data-builder-side-workspace-tab-kind={sideWorkspaceTabTypeForArtifactTab(tab)}
                  data-builder-side-workspace-tool={tab}
                  onClick={() => onSelectArtifactTab(tab)}
                  role="tab"
                  title={label}
                  type="button"
                >
                  <ArtifactTabIcon tab={tab} />
                  <span
                    className={activeTab === tab ? undefined : 'cf-builder-visually-hidden'}
                    data-builder-side-workspace-tab-label={activeTab === tab ? 'active' : 'collapsed'}
                  >
                    {label}
                  </span>
                </button>
                <button
                  aria-label={`Close ${label} tab`}
                  className="cf-builder-side-workspace-tab-close"
                  data-builder-side-workspace-close-tab={tab}
                  onClick={(event) => {
                    event.stopPropagation();
                    onCloseArtifactTab(tab);
                  }}
                  title={`Close ${label} tab`}
                  type="button"
                >
                  <X aria-hidden="true" className="size-3" />
                </button>
              </div>
            );
          })}
        </div>
        <div className="cf-builder-side-workspace-new-tab-wrap">
          <button
            aria-expanded={newTabMenuOpen}
            aria-haspopup="menu"
            aria-label="Open workspace tab"
            className="cf-builder-side-workspace-new-tab-button"
            data-builder-side-workspace-new-tab-button="true"
            onClick={() => setNewTabMenuOpen((open) => !open)}
            title="Open workspace tab"
            type="button"
          >
            <Plus aria-hidden="true" className="size-3.5" />
          </button>
          {newTabMenuOpen ? (
            <div
              aria-label="Open workspace tab"
              className="cf-builder-side-workspace-new-tab-menu"
              data-builder-side-workspace-new-tab-menu="true"
              role="menu"
            >
              {SIDE_WORKSPACE_NEW_TAB_ITEMS.map((item) => {
                const availableTab = artifactTabForSideWorkspaceTabType(item.type, availableArtifactTabs);
                const disabled = availableTab === null;
                const opened = availableTab !== null && openTabSet.has(availableTab);
                return (
                  <button
                    aria-disabled={disabled}
                    className="cf-builder-side-workspace-new-tab-menu-item"
                    data-builder-side-workspace-new-tab-kind={item.type}
                    data-open={opened ? 'true' : undefined}
                    data-status={item.status}
                    disabled={disabled}
                    key={item.type}
                    onClick={() => {
                      if (disabled) return;
                      setNewTabMenuOpen(false);
                      onOpenWorkspaceTab(item.type);
                    }}
                    role="menuitem"
                    type="button"
                  >
                    <SideWorkspaceNewTabIcon type={item.type} />
                    <span>{item.label}</span>
                    <small>
                      {availableTab === null
                          ? 'Unavailable'
                          : opened
                            ? 'Open'
                            : 'Add'}
                    </small>
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      </header>
      <div className="cf-builder-artifact-body" data-builder-artifact-body="true">
        {activeTab === 'browser_placeholder' ? (
          <BuilderSideWorkspaceBrowserPlaceholder
            agentTestActive={agentTestBrowserActive}
            onGoBackUserWeb={onGoBackUserWeb}
            onGoForwardUserWeb={onGoForwardUserWeb}
            onNavigateUserWeb={onNavigateUserWeb}
            onReloadUserWeb={onReloadUserWeb}
            onStopUserWeb={onStopUserWeb}
            userWebOperation={userWebOperation}
            userWebStatus={userWebStatus}
            userWebSurfaceRef={userWebSurfaceRef}
          />
        ) : null}
        {artifactTabs.includes('preview') ? (
          <section
            aria-label="Browser preview workspace"
            className="cf-builder-side-workspace-browser"
            data-builder-side-workspace-browser="true"
            data-builder-live-preview-approval-visible={
              livePreviewStatus?.status === 'approval_required' ? 'true' : 'false'
            }
            data-builder-live-preview-panel="true"
            data-builder-live-preview-status={livePreviewStatus?.status ?? 'unknown'}
            hidden={activeTab !== 'preview'}
          >
            <BuilderSideWorkspaceBrowserToolbar
              livePreviewOperation={livePreviewOperation}
              livePreviewStatus={livePreviewStatus}
              onExpandPreview={onExpandPreview}
              onRequestLivePreview={onRequestLivePreview}
              onReloadLivePreview={onReloadLivePreview}
              onStopLivePreview={onStopLivePreview}
            />
            <BuilderLivePreviewDevServerApproval
              livePreviewOperation={livePreviewOperation}
              livePreviewStatus={livePreviewStatus}
              onDecide={onDecideLivePreviewDevServerApproval}
            />
            <BuilderResultPanel
              livePreviewOperation={livePreviewOperation}
              livePreviewStatus={livePreviewStatus}
              onExpandPreview={onExpandPreview}
              onReloadLivePreview={onReloadLivePreview}
              onRequestLivePreview={onRequestLivePreview}
              onStopLivePreview={onStopLivePreview}
              panelRef={previewPanelRef}
              placement="artifact"
              projection={preview}
            />
          </section>
        ) : null}
        {activeTab === 'changes' ? (
          <div className="cf-builder-artifact-changes" data-builder-changes-flow="true">
            <BuilderChangesPanel
              changes={changes}
              onOpenChange={() => undefined}
              onOpenFile={onOpenFile}
              open={changesOpen}
              placement="artifact"
            />
          </div>
        ) : null}
        {activeTab === 'source' ? (
          <BuilderArtifactFilesPanel
            activePath={activeFile}
            content={sideWorkspaceFileContent}
            contentStatus={sideWorkspaceFileContentStatus}
            fallbackFiles={hasUnsavedDraft ? [] : files}
            fallbackSourceFile={hasUnsavedDraft ? null : sourceFile}
            onOpenFile={(fileRef) => {
              onSelectFile?.(fileRef.path);
              return onSelectSideWorkspaceFile?.(fileRef);
            }}
            onSelectFallbackFile={onSelectFile}
            onSourceOpenChange={onSourceOpenChange}
            projection={sideWorkspaceFileTree}
            sourceDisclosureOpen={sourceDisclosureOpen}
            sourceDisclosureRef={sourceDisclosureRef}
            treeStatus={sideWorkspaceFileTreeStatus}
          />
        ) : null}
        {activeTab === 'side_chat_placeholder' ? (
          <BuilderSideWorkspaceChatPlaceholder />
        ) : null}
        {activeTab === 'terminal_placeholder' ? (
          <BuilderSideWorkspaceTerminalPlaceholder
            checkRunProfile={checkRunProfile}
            checkRunStatus={checkRunStatus}
            commandOutput={commandOutput}
            runtimeCommand={runtimeCommand}
          />
        ) : null}
        {activeTab === 'versions' ? (
          <VersionHistoryPanel
            canUndo={canUndo}
            draftCheckpointStatus={draftCheckpointStatus}
            draftCheckpointTimeline={draftCheckpointTimeline}
            hasSavedProject={hasSavedProject}
            hasUnsavedDraft={hasUnsavedDraft}
            inspectedRevisionReceiptDigest={inspectedRevisionReceiptDigest}
            onInspectRevision={onInspectRevision}
            onRefresh={onRefreshHistory}
            onRestoreRevisionAsDraft={onRestoreRevisionAsDraft}
            onUndoDraft={onUndoDraft}
            snapshot={history}
          />
        ) : null}
        {activeTab === 'permissions' ? (
          <BuilderArtifactPermissionsPanel
            approvalMode={approvalMode}
            currentProjectWriteApproval={currentProjectWriteApproval}
            hasSavedProject={hasSavedProject}
            hasUnsavedDraft={hasUnsavedDraft}
            onApproveProviderContextDisclosure={onApproveProviderContextDisclosure}
            planSourceReadApproval={planSourceReadApproval}
            providerContextDisclosureApprovalState={providerContextDisclosureApprovalState}
            providerContextDisclosureStatus={providerContextDisclosureStatus}
            workingProject={workingProject}
          />
        ) : null}
      </div>
    </aside>
  );
}, (previous, current) => {
  const sameTabs = (left: readonly BuilderArtifactTab[], right: readonly BuilderArtifactTab[]) => (
    left.length === right.length && left.every((tab, index) => tab === right[index])
  );
  if (
    previous.activeTab !== current.activeTab
    || !sameTabs(previous.artifactTabs, current.artifactTabs)
    || !sameTabs(previous.availableArtifactTabs, current.availableArtifactTabs)
    || previous.resizing !== current.resizing
    || previous.width !== current.width
    || previous.widthMaximum !== current.widthMaximum
  ) return false;
  if (current.activeTab === 'preview') {
    return previous.livePreviewOperation === current.livePreviewOperation
      && previous.livePreviewStatus === current.livePreviewStatus
      && previous.preview === current.preview
      && previous.previewPanelRef === current.previewPanelRef;
  }
  if (current.activeTab === 'browser_placeholder') {
    return previous.agentTestBrowserActive === current.agentTestBrowserActive
      && previous.userWebOperation === current.userWebOperation
      && previous.userWebStatus === current.userWebStatus;
  }
  if (current.activeTab === 'changes') {
    return previous.changes === current.changes
      && previous.changesOpen === current.changesOpen;
  }
  if (current.activeTab === 'source') {
    return previous.activeFile === current.activeFile
      && previous.files === current.files
      && previous.hasUnsavedDraft === current.hasUnsavedDraft
      && previous.sideWorkspaceFileContent === current.sideWorkspaceFileContent
      && previous.sideWorkspaceFileContentStatus === current.sideWorkspaceFileContentStatus
      && previous.sideWorkspaceFileTree === current.sideWorkspaceFileTree
      && previous.sideWorkspaceFileTreeStatus === current.sideWorkspaceFileTreeStatus
      && previous.sourceDisclosureOpen === current.sourceDisclosureOpen
      && previous.sourceFile === current.sourceFile;
  }
  if (current.activeTab === 'terminal_placeholder') {
    return previous.checkRunProfile === current.checkRunProfile
      && sameDisplayedCheckStatus(previous.checkRunStatus, current.checkRunStatus)
      && previous.commandOutput === current.commandOutput
      && previous.runtimeCommand === current.runtimeCommand;
  }
  if (current.activeTab === 'versions') {
    return previous.canUndo === current.canUndo
      && previous.draftCheckpointStatus === current.draftCheckpointStatus
      && previous.draftCheckpointTimeline === current.draftCheckpointTimeline
      && previous.hasSavedProject === current.hasSavedProject
      && previous.hasUnsavedDraft === current.hasUnsavedDraft
      && previous.history === current.history
      && previous.inspectedRevisionReceiptDigest === current.inspectedRevisionReceiptDigest;
  }
  if (current.activeTab === 'permissions') {
    return previous.approvalMode === current.approvalMode
      && previous.currentProjectWriteApproval === current.currentProjectWriteApproval
      && previous.hasSavedProject === current.hasSavedProject
      && previous.hasUnsavedDraft === current.hasUnsavedDraft
      && previous.planSourceReadApproval === current.planSourceReadApproval
      && previous.providerContextDisclosureApprovalState
        === current.providerContextDisclosureApprovalState
      && previous.providerContextDisclosureStatus === current.providerContextDisclosureStatus
      && previous.workingProject === current.workingProject;
  }
  return true;
});

export function BuilderPage({
  activeRunFollowupQueued = false,
  approvalMode = 'ask_before_write',
  checkRunOperation = null,
  checkRunOperationFailureCode = null,
  checkEnvironmentDiagnosis = null,
  checkRunProfiles = [],
  checkRunStatus = null,
  projectDependencyPreparation = null,
  projectEnvironmentDiagnosis = null,
  instruction,
  composerRouteDecision = null,
  composerContextStatus = null,
  providerContextDisclosureStatus = null,
  contextUsageProjection = null,
  manualContextCompactionFeedback = 'idle',
  providerContextDisclosureApprovalState = 'idle',
  composerMode = null,
  composerModelSelection,
  composerSubmitLocked = false,
  commandApproval = null,
  commandOutputStore = null,
  pendingUserMessages = [],
  currentProjectWriteApproval = null,
  onApproveCurrentProjectWrite,
  onDecideCommandApproval,
  onDecideCheckDependencyPreparation,
  onDiagnoseCheckEnvironment,
  onApproveProviderContextDisclosure,
  onApprovePlanSourceRead,
  onCancel,
  onPauseTask,
  onDismissCurrentProjectWriteApproval,
  onDismissPlanSourceReadApproval,
  onInstructionChange,
  onOpenProjectLocation,
  onSelectApprovalMode,
  onSelectComposerMode,
  onSelectComposerModel,
  onSelectPlanMode,
  onClearComposerMode,
  onSubmitInstruction,
  onRetryGenerate,
  onResumeInterruptedRun,
  onManualCompactContext,
  onRefreshConversation,
  onRefreshHistory,
  onRejectDraft,
  onReloadLivePreview,
  onLivePreviewLayoutChange,
  onAgentTestBrowserLayoutChange,
  activeAgentTestBrowserRunId = null,
  onNavigateUserWeb,
  onGoBackUserWeb,
  onGoForwardUserWeb,
  onReloadUserWeb,
  onStopUserWeb,
  onUserWebLayoutChange,
  onReviewPlan,
  onRequestLivePreview,
  onRequestSideWorkspaceFiles,
  onRestoreRevisionAsDraft,
  onSave,
  onUndoDraft,
  onSelectSideWorkspaceFile,
  onStopLivePreview,
  onInspectRevision,
  onShowCurrentRevision,
  onOpenSettings,
  onPrepareProjectDependencies,
  conversationSnapshot,
  taskConversationSeed = null,
  agentWorkbenchSnapshot,
  onRefreshAgentWorkbench,
  onUpdateAgentWorkbenchMessageState,
  onDecideAgentTaskProposal,
  onDecideAgentPlan,
  onCreateProjectForAgentTaskProposal,
  onArchiveAgentTask,
  onOpenAgentTaskProposal,
  onControlAgentTask,
  onRenameAgentTask,
  projectCatalogSnapshot,
  historySnapshot,
  snapshot,
  activeFile,
  approvedPlanContinuationFailure = null,
  answerFailureRecordedSuccess = false,
  liveOutput = null,
  liveOutputStore = null,
  livePreviewOperation = null,
  livePreviewStatus = null,
  userWebOperation = null,
  userWebStatus = null,
  sideWorkspaceFileContent = null,
  sideWorkspaceFileContentStatus = 'idle',
  sideWorkspaceFileTree = null,
  sideWorkspaceFileTreeStatus = 'idle',
  surfaceKind = 'task',
  planReviewFailure = null,
  planReviewInFlight = null,
  planReviewRecorded = null,
  planSourceReadApproval = null,
  onSelectFile,
  onOpenRuntimeToolFile,
  onDecideLivePreviewDevServerApproval,
}: BuilderPageProps) {
  useLayoutEffect(() => {
    incrementBuilderPerformance('renderer.builder_page.commit_count');
  });
  const trusted = isTrustedBuilderProjectControllerSnapshot(snapshot);
  const current = trusted ? snapshot : null;
  const status = current?.status ?? 'unavailable';
  const conversationStatus = conversationSnapshot?.status ?? 'unavailable';
  const commandOutput = useSyncExternalStore(
    commandOutputStore?.subscribe ?? subscribeToNoLiveOutput,
    commandOutputStore?.getSnapshot ?? readNoLiveOutput,
    commandOutputStore?.getSnapshot ?? readNoLiveOutput,
  );
  const conversationProjectId = conversationSnapshot?.project_id ?? null;
  const conversationItemCount = conversationSnapshot?.conversation?.state === 'ready'
    ? conversationSnapshot.conversation.conversation.items.length
    : 0;
  const showingAgentWorkbench = surfaceKind === 'workbench';
  const saved = current?.savedProject ?? null;
  const draft = current?.draft ?? null;
  const inspected = current?.inspectedRevision ?? null;
  const preview = current?.preview ?? null;
  const files = current === null ? [] : selectedFiles(current);
  const selected = files.find((file) => file.path === activeFile) ?? null;
  const busy = current?.busy ?? false;
  const hasUnsavedDraft = draft !== null;
  const hasSideWorkspaceSource = hasUnsavedDraft || saved !== null;
  const viewingHistory = inspected !== null;
  const hasContent = files.length > 0;
  const title = draft?.title ?? inspected?.target.title ?? saved?.target.title ?? 'New project';
  const workingProject = current?.workingProject ?? null;
  const activeConversationTurnId = conversationSnapshot?.conversation?.state === 'ready'
    ? conversationSnapshot.conversation.conversation.recorded_active_turn_id
    : null;
  const activeConversationRunId = activeConversationTurnId === null
    || conversationSnapshot?.conversation?.state !== 'ready'
    ? null
    : [...conversationSnapshot.conversation.conversation.items].reverse().find((item): item is Extract<
      BuilderConversationItem,
      { item_kind: 'run_started' }
    > => (
      item.item_kind === 'run_started' && item.turn_id === activeConversationTurnId
    ))?.run_id ?? null;
  const agentTestBrowserOwnerRunId = activeAgentTestBrowserRunId ?? activeConversationRunId;
  const latestAgentTestBrowserActivity = agentTestBrowserOwnerRunId !== null
    && conversationSnapshot?.conversation?.state === 'ready'
    ? [...conversationSnapshot.conversation.conversation.items].reverse().find((item): item is RuntimeToolActivityItem => (
      item.item_kind === 'programming_runtime_tool_activity'
      && item.tool_kind === 'browser'
      && item.run_id === agentTestBrowserOwnerRunId
    )) ?? null
    : null;
  const agentTestBrowserActive = activeAgentTestBrowserRunId !== null
    || latestAgentTestBrowserActivity !== null;
  const composerBusy = busy || agentTestBrowserActive;
  const canAddContext = typeof onSubmitInstruction === 'function'
    && liveOutput !== null
    && busy
    && !hasUnsavedDraft
    && !viewingHistory
    && (status === 'answering' || status === 'generating' || status === 'submitting');
  const canSubmit = typeof onSubmitInstruction === 'function'
    && GENERATABLE_STATUSES.has(status)
    && activeAgentTestBrowserRunId === null
    && !viewingHistory
    && !composerSubmitLocked
    && instruction.trim().length > 0;
  const canSubmitComposer = canSubmit || (canAddContext && instruction.trim().length > 0);
  const pausedTask = !showingAgentWorkbench && !composerBusy && !composerSubmitLocked && !hasUnsavedDraft && !viewingHistory
    && conversationSnapshot?.status === 'ready'
    && interruptedTaskContinuation(conversationSnapshot.conversation) !== null;
  const canCancel = typeof onCancel === 'function'
    && (
      status === 'answering'
      || status === 'generating'
      || status === 'submitting'
      || agentTestBrowserActive
    );
  const canEditInstruction = typeof onInstructionChange === 'function'
    && !viewingHistory
    && (!composerBusy || canAddContext);
  const canPauseTask = !showingAgentWorkbench && ['generating', 'submitting'].includes(status) && !hasUnsavedDraft
    && conversationSnapshot?.status === 'ready'
    && hasActiveProgrammingTask(conversationSnapshot.conversation);
  const activity = visibleActivitySnapshot(conversationSnapshot);
  const failed = status === 'generation_failed' || status === 'answer_failed' || status === 'submit_failed';
  const workspaceConflictProjectedInConversation = current?.error === 'builder_generation_workspace_changed'
    && current.retryableGeneration === false
    && currentAgentActivity(activity)?.current.phase === 'blocked';
  const showFailedNotice = failed
    && !(status === 'answer_failed' && answerFailureRecordedSuccess)
    && !(status === 'generation_failed' && hasUnsavedDraft)
    && !workspaceConflictProjectedInConversation;
  const canRetryGenerate = typeof onRetryGenerate === 'function'
    && (status === 'generation_failed' || status === 'submit_failed')
    && current?.retryableGeneration === true
    && isRetryableGenerationError(current.error);
  const canOpenSettings = failed
    && current?.error === 'builder_generation_provider_unavailable'
    && typeof onOpenSettings === 'function';
  const draftCheckpointStatus = activity?.status === 'ready'
    && activity.conversation?.state === 'ready'
    ? activity.conversation.draft_checkpoint_status_projection ?? null
    : null;
  const draftCheckpointTimeline = activity?.status === 'ready'
    && activity.conversation?.state === 'ready'
    ? activity.conversation.draft_checkpoint_timeline_projection ?? null
    : null;
  const reviewState = activity?.status === 'ready'
    && activity.conversation?.state === 'ready'
    ? activity.conversation.review_state_projection ?? null
    : null;
  const checkRunOutcome = currentCheckRunOutcome(activity);
  const displayedCheckRunStatus: BuilderDisplayedCheckStatus | null = checkRunStatus ?? (
    checkRunOutcome?.state === 'completed'
    && checkRunOutcome.command_kind !== null
    && (
      checkRunOutcome.status === 'passed'
      || checkRunOutcome.status === 'failed'
      || checkRunOutcome.status === 'incomplete'
    )
    && checkRunOutcome.completed_at_ms !== null
      ? {
        command_kind: checkRunOutcome.command_kind,
        status: checkRunOutcome.status,
        summary: checkRunOutcome.summary,
        environment_reason: checkRunOutcome.environment_reason,
        completed_at_ms: checkRunOutcome.completed_at_ms,
      }
      : null
  );
  const checkRunProfile = displayedCheckRunStatus === null
    ? null
    : checkRunProfiles?.find(
      (profile) => profile.command_kind === displayedCheckRunStatus.command_kind,
    ) ?? null;
  const conversationHasActiveTurn = conversationSnapshot?.conversation?.state === 'ready'
    && conversationSnapshot.conversation.conversation.recorded_active_turn_id !== null;
  const projectedAgentActivity = currentAgentActivity(activity);
  const conversationHasInFlightStage = conversationHasActiveTurn
    && (
      projectedAgentActivity === null
      || projectedAgentActivity.current.status === 'active'
      || projectedAgentActivity.current.status === 'waiting'
    );
  const checkRunInFlight = checkRunOperation === 'running'
    || checkRunOperation === 'preparing_dependencies';
  const reviewReadyForCurrentDraft = reviewState !== null
    && reviewState.draft_id === draft?.draft_id
    && reviewState.can_save === true;
  const showVersionDecision = hasUnsavedDraft
    && (!busy || status === 'save_unknown')
    && !conversationHasInFlightStage
    && (
      status === 'save_unknown'
      || reviewReadyForCurrentDraft
    );
  const canSave = typeof onSave === 'function'
    && hasUnsavedDraft
    && !busy
    && !conversationHasInFlightStage
    && !checkRunInFlight
    && displayedCheckRunStatus?.status !== 'failed'
    && displayedCheckRunStatus?.status !== 'incomplete'
    && reviewState?.draft_id === draft?.draft_id
    && reviewState?.can_save === true;
  const canReject = typeof onRejectDraft === 'function'
    && hasUnsavedDraft
    && !busy
    && !conversationHasInFlightStage
    && reviewState?.draft_id === draft?.draft_id
    && reviewState?.can_discard === true;
  const canUndo = typeof onUndoDraft === 'function'
    && hasUnsavedDraft
    && !busy
    && !conversationHasInFlightStage
    && !checkRunInFlight;
  const history = visibleHistorySnapshot(historySnapshot);
  const visibleLiveOutput = liveOutput;
  const showActivity = shouldShowActivityPanel(activity)
    || (saved !== null && activity?.status === 'absent')
    || visibleLiveOutput !== null
    || status === 'saving';
  const hasCanonicalTaskConversationItems = conversationSnapshot?.conversation?.state === 'ready'
    && taskConversationSeed !== null
    && conversationSnapshot.conversation.conversation.conversation_id
      === taskConversationSeed.conversation_id
    && conversationSnapshot.conversation.conversation.items.length > 0;
  const showTaskConversationSeed = !showingAgentWorkbench
    && taskConversationSeed !== null
    && !hasCanonicalTaskConversationItems;
  const showPermissionsPanel = saved !== null
    || workingProject !== null
    || hasUnsavedDraft
    || planSourceReadApproval !== null
    || currentProjectWriteApproval !== null
    || providerContextDisclosureStatus !== null;
  const planReviewTarget = pendingPlanReviewTarget(activity);
  const planReviewBusy = planReviewTarget !== null
    && planReviewInFlight !== null
    && planReviewInFlight.project_id === planReviewTarget.project_id
    && planReviewInFlight.conversation_id === planReviewTarget.conversation_id
    && planReviewInFlight.turn_id === planReviewTarget.turn_id
    && planReviewInFlight.run_id === planReviewTarget.run_id;
  const planReviewFailed = planReviewTarget !== null
    && planReviewFailure !== null
    && planReviewFailure.project_id === planReviewTarget.project_id
    && planReviewFailure.conversation_id === planReviewTarget.conversation_id
    && planReviewFailure.turn_id === planReviewTarget.turn_id
    && planReviewFailure.run_id === planReviewTarget.run_id;
  const planReviewRecordedForTarget = planReviewTarget !== null
    && planReviewRecorded !== null
    && planReviewRecorded.project_id === planReviewTarget.project_id
    && planReviewRecorded.conversation_id === planReviewTarget.conversation_id
    && planReviewRecorded.turn_id === planReviewTarget.turn_id
    && planReviewRecorded.run_id === planReviewTarget.run_id;
  const approvedPlanContinuationFailed = status === 'generation_failed'
    && approvedPlanContinuationFailure !== null
    && saved !== null
    && approvedPlanContinuationFailure.project_id === saved.target.project_id
    && approvedPlanContinuationFailure.conversation_id === saved.target.conversation_id
    && !hasUnsavedDraft;
  const canReviewPlan = typeof onReviewPlan === 'function'
    && planReviewTarget !== null
    && !planReviewBusy
    && !planReviewRecordedForTarget
    && !busy
    && !hasUnsavedDraft
    && !viewingHistory;
  const canProposePlan = (typeof onSelectComposerMode === 'function' || typeof onSelectPlanMode === 'function')
    && (showingAgentWorkbench || saved !== null || workingProject !== null)
    && !busy
    && (showingAgentWorkbench || (!hasUnsavedDraft && !viewingHistory && PLAN_PROPOSAL_READY_STATUSES.has(status)));
  const changes = useMemo(() => createBuilderSourceTreeChanges(
    saved?.source_tree ?? null,
    draft?.source_tree ?? null,
  ), [draft, saved]);
  const sourceFile = selected ?? (preview === null ? files[0] ?? null : null);
  const showPreviewUnavailableResult = preview === null && status === 'preview_unavailable' && hasContent;
  const showResultFlow = preview !== null || showPreviewUnavailableResult;
  const showVersionHistoryPanel = saved !== null || hasUnsavedDraft;
  const sourceDisclosureRef = useRef<HTMLDetailsElement | null>(null);
  const artifactPreviewRef = useRef<HTMLElement | null>(null);
  const expandedPreviewRef = useRef<HTMLDivElement | null>(null);
  const artifactSidebarRef = useRef<HTMLElement | null>(null);
  const pendingChangesFocusRef = useRef(false);
  const pendingSourceFocusRef = useRef(false);
  const skipNextDraftSourceRequestRef = useRef(false);
  const chatShellRef = useRef<HTMLElement | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const chatFlowColumnRef = useRef<HTMLDivElement | null>(null);
  const chatTailRef = useRef<HTMLDivElement | null>(null);
  const composerStackRef = useRef<HTMLDivElement | null>(null);
  const shouldFollowChatRef = useRef(true);
  const observedChatScrollTopRef = useRef(0);
  const chatReaderScrollIntentUntilRef = useRef(0);
  const chatReaderScrollDirectionRef = useRef(0);
  const liveOutputFollowFrameRef = useRef<number | null>(null);
  const livePreviewLayoutFrameRef = useRef<number | null>(null);
  const livePreviewLayoutSignatureRef = useRef<string | null>(null);
  const userWebSurfaceRef = useRef<HTMLElement | null>(null);
  const userWebLayoutFrameRef = useRef<number | null>(null);
  const userWebLayoutSignatureRef = useRef<string | null>(null);
  const agentTestBrowserLayoutFrameRef = useRef<number | null>(null);
  const agentTestBrowserLayoutSignatureRef = useRef<string | null>(null);
  const [artifactWidth, setArtifactWidth] = useState(ARTIFACT_DEFAULT_WIDTH_PX);
  const artifactPreferredWidthRef = useRef(ARTIFACT_DEFAULT_WIDTH_PX);
  const [artifactWidthMaximum, setArtifactWidthMaximum] = useState(ARTIFACT_MAX_WIDTH_PX);
  const [artifactResizing, setArtifactResizing] = useState(false);
  const [previewExpanded, setPreviewExpanded] = useState(false);
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [taskMonitorCollapsed, setTaskMonitorCollapsed] = useState(false);
  const artifactWorkspaceIdentity = [
    conversationSnapshot?.agent_id ?? 'no-agent',
    conversationProjectId
      ?? current?.conversationProjectId
      ?? draft?.project_id
      ?? saved?.target.project_id
      ?? current?.workingProjectId
      ?? 'no-project',
    conversationSnapshot?.task_address_id ?? 'no-task-address',
  ].join('|');
  const currentArtifactPanelIdentity = `${artifactWorkspaceIdentity}|current`;
  const artifactPanelIdentity = inspected === null
    ? currentArtifactPanelIdentity
    : `${artifactWorkspaceIdentity}|${inspected.target.revision_receipt_digest}`;
  const changesPanelIdentity = `${artifactPanelIdentity}|changes`;
  const sourceDisclosureIdentity = [
    artifactPanelIdentity,
    'source',
    sourceFile?.path ?? 'no-source',
  ].join('|');
  const [changesPanelState, setChangesPanelState] = useState<Readonly<{
    identity: string;
    open: boolean;
  }>>(() => ({
    identity: changesPanelIdentity,
    open: false,
  }));
  const changesPanelOpen = changesPanelState.identity === changesPanelIdentity
    ? changesPanelState.open
    : false;
  const [sourceDisclosureState, setSourceDisclosureState] = useState<Readonly<{
    identity: string;
    open: boolean;
  }>>(() => ({
    identity: sourceDisclosureIdentity,
    open: false,
  }));
  const sourceDisclosureOpen = sourceFile !== null && (
    selected !== null
    || (
      sourceDisclosureState.identity === sourceDisclosureIdentity
      && sourceDisclosureState.open
    )
  );
  const [runtimeCommandState, setRuntimeCommandState] = useState<Readonly<{
    identity: string;
    item: RuntimeToolActivityItem;
  }> | null>(null);
  const runtimeCommand = runtimeCommandState?.identity === artifactPanelIdentity
    ? runtimeCommandState.item
    : null;
  const agentTestBrowserIdentity = agentTestBrowserActive
    ? activeAgentTestBrowserRunId ?? `${latestAgentTestBrowserActivity?.run_id}|${latestAgentTestBrowserActivity?.tool_call_id}`
    : null;
  const observedAgentTestBrowserIdentityRef = useRef<string | null>(null);
  const pendingAgentTestPreviewHandoffRef = useRef<string | null>(null);
  const showFilesPanel = sourceFile !== null
    || hasSideWorkspaceSource
    || sideWorkspaceFileTree !== null
    || sideWorkspaceFileContent !== null;
  const artifactTabs = useMemo(() => {
    const tabs: BuilderArtifactTab[] = [];
    if (agentTestBrowserActive) tabs.push('browser_placeholder');
    if (showResultFlow) tabs.push('preview');
    if (!showingAgentWorkbench && !tabs.includes('browser_placeholder')) {
      tabs.push('browser_placeholder');
    }
    if (hasUnsavedDraft) tabs.push('changes');
    if (showFilesPanel) tabs.push('source');
    if (showVersionHistoryPanel) tabs.push('versions');
    if (showPermissionsPanel) tabs.push('permissions');
    if (tabs.length > 0 || commandOutput !== null) {
      tabs.push('terminal_placeholder');
      tabs.push('side_chat_placeholder');
    }
    return tabs;
  }, [
    agentTestBrowserActive,
    commandOutput,
    hasUnsavedDraft,
    showFilesPanel,
    showPermissionsPanel,
    showResultFlow,
    showVersionHistoryPanel,
    showingAgentWorkbench,
  ]);
  const hasArtifactControls = artifactTabs.length > 0;
  const defaultArtifactTab: BuilderArtifactTab | null = selected !== null && showFilesPanel
    ? 'source'
    : viewingHistory && showResultFlow
      ? 'preview'
    : hasUnsavedDraft && showResultFlow
      ? 'preview'
    : hasUnsavedDraft && showFilesPanel
      ? 'source'
      : showVersionHistoryPanel
        ? 'versions'
        : showResultFlow
          ? 'preview'
          : showFilesPanel
            ? 'source'
            : hasUnsavedDraft
              ? 'changes'
              : artifactTabs.includes('browser_placeholder')
                ? 'browser_placeholder'
                : null;
  const [artifactPanelState, setArtifactPanelState] = useState<Readonly<{
    active: BuilderArtifactTab | null;
    openTabs: readonly BuilderArtifactTab[];
    identity: string;
    observedCommandIdentity: string | null;
  }>>(() => ({
    active: null,
    openTabs: [],
    identity: artifactPanelIdentity,
    observedCommandIdentity: null,
  }));
  const commandOutputIdentity = commandOutput === null
    ? null
    : [
      commandOutput.project_id,
      commandOutput.conversation_id,
      commandOutput.run_id,
      commandOutput.command_profile_id,
    ].join('|');
  useEffect(() => {
    if (commandOutputIdentity === null || !artifactTabs.includes('terminal_placeholder')) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- A new command opens its existing terminal artifact synchronously.
    setArtifactPanelState((panelState) => {
      if (
        panelState.identity === artifactPanelIdentity
        && panelState.observedCommandIdentity === commandOutputIdentity
      ) return panelState;
      const baseOpenTabs = panelState.identity === artifactPanelIdentity
        ? panelState.openTabs.filter((tab) => artifactTabs.includes(tab))
        : [];
      return {
        active: 'terminal_placeholder',
        openTabs: baseOpenTabs.includes('terminal_placeholder')
          ? baseOpenTabs
          : [...baseOpenTabs, 'terminal_placeholder'],
        identity: artifactPanelIdentity,
        observedCommandIdentity: commandOutputIdentity,
      };
    });
  }, [artifactPanelIdentity, artifactTabs, commandOutputIdentity]);
  useEffect(() => {
    if (
      agentTestBrowserIdentity === null
      || observedAgentTestBrowserIdentityRef.current === agentTestBrowserIdentity
      || !artifactTabs.includes('browser_placeholder')
    ) return;
    observedAgentTestBrowserIdentityRef.current = agentTestBrowserIdentity;
    pendingAgentTestPreviewHandoffRef.current = artifactPanelIdentity;
    setArtifactPanelState((panelState) => {
      const baseOpenTabs = panelState.identity === artifactPanelIdentity
        ? panelState.openTabs.filter((tab) => artifactTabs.includes(tab))
        : [];
      return {
        ...panelState,
        active: 'browser_placeholder',
        openTabs: baseOpenTabs.includes('browser_placeholder')
          ? baseOpenTabs
          : [...baseOpenTabs, 'browser_placeholder'],
        identity: artifactPanelIdentity,
      };
    });
  }, [agentTestBrowserIdentity, artifactPanelIdentity, artifactTabs]);
  useEffect(() => {
    if (agentTestBrowserIdentity !== null || busy) return;
    const identity = pendingAgentTestPreviewHandoffRef.current;
    if (identity === null) return;
    pendingAgentTestPreviewHandoffRef.current = null;
    if (identity !== artifactPanelIdentity) return;
    // End the temporary browser tab without retaining its session or starting a server.
    setArtifactPanelState((panelState) => {
      if (panelState.identity !== identity || panelState.active !== 'browser_placeholder') return panelState;
      const replacement = artifactTabs.includes('preview') ? 'preview' : null;
      const openTabs = panelState.openTabs.filter((tab) => tab !== 'browser_placeholder' && artifactTabs.includes(tab));
      if (replacement !== null && !openTabs.includes(replacement)) openTabs.push(replacement);
      return { ...panelState, active: replacement ?? openTabs.at(-1) ?? null, openTabs };
    });
  }, [agentTestBrowserIdentity, artifactPanelIdentity, artifactTabs, busy]);
  const retainedOpenArtifactTabs: readonly BuilderArtifactTab[] =
    artifactPanelState.identity === artifactPanelIdentity
    ? artifactPanelState.openTabs.filter((tab) => artifactTabs.includes(tab))
    : [];
  const openArtifactTabs: readonly BuilderArtifactTab[] = retainedOpenArtifactTabs;
  const requestedArtifactTab: BuilderArtifactTab | null =
    artifactPanelState.identity === artifactPanelIdentity
    ? artifactPanelState.active
    : null;
  const activeArtifactTab: BuilderArtifactTab | null = requestedArtifactTab === null
    ? null
    : openArtifactTabs.includes(requestedArtifactTab)
      ? requestedArtifactTab
      : openArtifactTabs[0] ?? null;
  const showArtifactSidebar = activeArtifactTab !== null;
  const taskMonitorTasks = agentWorkbenchSnapshot?.projection?.task_monitor.tasks ?? [];
  const taskMonitorAvailable = showingAgentWorkbench && taskMonitorTasks.length > 0;
  const showTaskMonitor = taskMonitorAvailable && !taskMonitorCollapsed;
  const showRightSidebar = showArtifactSidebar || showTaskMonitor;
  const workspaceMenuVisible = workspaceMenuOpen && hasArtifactControls;
  const openLocationProjectId = draft?.project_id
    ?? inspected?.target.project_id
    ?? saved?.target.project_id
    ?? current?.workingProjectId
    ?? null;
  const showChangesPanel = activeArtifactTab === 'changes' && hasUnsavedDraft;
  const previewExpandedVisible = previewExpanded && showResultFlow;
  const artifactShellStyle = showRightSidebar
    ? ({
      '--cf-builder-artifact-width': showTaskMonitor ? '328px' : `${artifactWidth}px`,
    } as CSSProperties)
    : undefined;
  useLayoutEffect(() => {
    if (typeof onLivePreviewLayoutChange !== 'function') return undefined;
    // A new request-bound callback must receive the current bounds even when
    // the DOM geometry is unchanged from an earlier, not-yet-admitted request.
    livePreviewLayoutSignatureRef.current = null;
    const previewElement = activeArtifactTab === 'preview'
      ? previewExpandedVisible
        ? expandedPreviewRef.current
        : artifactPreviewRef.current
      : null;

    function publish(bounds: BuilderLivePreviewViewBounds | null): void {
      const signature = bounds === null
        ? 'hidden'
        : `${bounds.x}:${bounds.y}:${bounds.width}:${bounds.height}`;
      if (signature === livePreviewLayoutSignatureRef.current) return;
      livePreviewLayoutSignatureRef.current = signature;
      void onLivePreviewLayoutChange?.(bounds);
    }

    function measure(): void {
      if (livePreviewLayoutFrameRef.current !== null) {
        window.cancelAnimationFrame(livePreviewLayoutFrameRef.current);
      }
      livePreviewLayoutFrameRef.current = window.requestAnimationFrame(() => {
        livePreviewLayoutFrameRef.current = null;
        if (previewElement === null || !previewElement.isConnected) {
          publish(null);
          return;
        }
        const rect = previewElement.getBoundingClientRect();
        const bounds = Object.freeze({
          x: Math.max(0, Math.round(rect.left)),
          y: Math.max(0, Math.round(rect.top)),
          width: Math.max(1, Math.round(rect.width)),
          height: Math.max(1, Math.round(rect.height)),
        });
        publish(bounds);
      });
    }

    if (previewElement === null) {
      publish(null);
      return undefined;
    }
    measure();
    const observer = typeof ResizeObserver === 'function'
      ? new ResizeObserver(measure)
      : null;
    observer?.observe(previewElement);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      if (livePreviewLayoutFrameRef.current !== null) {
        window.cancelAnimationFrame(livePreviewLayoutFrameRef.current);
        livePreviewLayoutFrameRef.current = null;
      }
    };
  }, [activeArtifactTab, onLivePreviewLayoutChange, previewExpandedVisible]);

  useLayoutEffect(() => {
    if (typeof onUserWebLayoutChange !== 'function') return undefined;
    userWebLayoutSignatureRef.current = null;
    const browserElement = activeArtifactTab === 'browser_placeholder' && !agentTestBrowserActive
      ? userWebSurfaceRef.current
      : null;

    function publish(bounds: BuilderLivePreviewViewBounds | null): void {
      const signature = bounds === null
        ? 'hidden'
        : `${bounds.x}:${bounds.y}:${bounds.width}:${bounds.height}`;
      if (signature === userWebLayoutSignatureRef.current) return;
      userWebLayoutSignatureRef.current = signature;
      void onUserWebLayoutChange?.(bounds);
    }

    function measure(): void {
      if (userWebLayoutFrameRef.current !== null) {
        window.cancelAnimationFrame(userWebLayoutFrameRef.current);
      }
      userWebLayoutFrameRef.current = window.requestAnimationFrame(() => {
        userWebLayoutFrameRef.current = null;
        if (browserElement === null || !browserElement.isConnected) {
          publish(null);
          return;
        }
        const rect = browserElement.getBoundingClientRect();
        publish(Object.freeze({
          x: Math.max(0, Math.round(rect.left)),
          y: Math.max(0, Math.round(rect.top)),
          width: Math.max(1, Math.round(rect.width)),
          height: Math.max(1, Math.round(rect.height)),
        }));
      });
    }

    if (browserElement === null) {
      publish(null);
      return undefined;
    }
    measure();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    observer?.observe(browserElement);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      if (userWebLayoutFrameRef.current !== null) {
        window.cancelAnimationFrame(userWebLayoutFrameRef.current);
        userWebLayoutFrameRef.current = null;
      }
    };
  }, [
    activeArtifactTab,
    agentTestBrowserActive,
    onUserWebLayoutChange,
    userWebStatus?.current_url,
    userWebStatus?.status,
  ]);

  useLayoutEffect(() => {
    if (
      typeof onAgentTestBrowserLayoutChange !== 'function'
      || agentTestBrowserOwnerRunId === null
    ) return undefined;
    const ownerRunId = agentTestBrowserOwnerRunId;
    agentTestBrowserLayoutSignatureRef.current = null;
    const browserElement = activeArtifactTab === 'browser_placeholder' && agentTestBrowserActive
      ? userWebSurfaceRef.current
      : null;

    function publish(bounds: BuilderLivePreviewViewBounds | null): void {
      const signature = bounds === null
        ? 'hidden'
        : `${bounds.x}:${bounds.y}:${bounds.width}:${bounds.height}`;
      if (signature === agentTestBrowserLayoutSignatureRef.current) return;
      agentTestBrowserLayoutSignatureRef.current = signature;
      void onAgentTestBrowserLayoutChange?.(ownerRunId, bounds);
    }

    function measure(): void {
      if (agentTestBrowserLayoutFrameRef.current !== null) {
        window.cancelAnimationFrame(agentTestBrowserLayoutFrameRef.current);
      }
      agentTestBrowserLayoutFrameRef.current = window.requestAnimationFrame(() => {
        agentTestBrowserLayoutFrameRef.current = null;
        if (browserElement === null || !browserElement.isConnected) {
          publish(null);
          return;
        }
        const rect = browserElement.getBoundingClientRect();
        publish(Object.freeze({
          x: Math.max(0, Math.round(rect.left)),
          y: Math.max(0, Math.round(rect.top)),
          width: Math.max(1, Math.round(rect.width)),
          height: Math.max(1, Math.round(rect.height)),
        }));
      });
    }

    if (browserElement === null) {
      publish(null);
      return undefined;
    }
    measure();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    observer?.observe(browserElement);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      if (agentTestBrowserLayoutFrameRef.current !== null) {
        window.cancelAnimationFrame(agentTestBrowserLayoutFrameRef.current);
        agentTestBrowserLayoutFrameRef.current = null;
      }
      void onAgentTestBrowserLayoutChange?.(ownerRunId, null);
    };
  }, [
    activeArtifactTab,
    agentTestBrowserOwnerRunId,
    agentTestBrowserActive,
    onAgentTestBrowserLayoutChange,
  ]);

  useLayoutEffect(() => {
    if (!showArtifactSidebar) return undefined;
    const shell = chatShellRef.current;
    if (shell === null) return undefined;
    const shellElement = shell;

    function clampForCurrentShell(): void {
      const maximum = artifactMaxWidthForShell(shellElement.getBoundingClientRect().width);
      setArtifactWidthMaximum(maximum);
      setArtifactWidth(clampArtifactWidth(artifactPreferredWidthRef.current, maximum));
    }

    clampForCurrentShell();
    window.addEventListener('resize', clampForCurrentShell);
    return () => {
      window.removeEventListener('resize', clampForCurrentShell);
    };
  }, [showArtifactSidebar]);

  useEffect(() => {
    if (!workspaceMenuVisible) return undefined;
    function closeWorkspaceMenu(event: PointerEvent): void {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (
        target.closest('[data-builder-workspace-menu="true"], [data-builder-workspace-menu-button="true"]')
        !== null
      ) {
        return;
      }
      setWorkspaceMenuOpen(false);
    }
    function closeWorkspaceMenuOnEscape(event: KeyboardEvent): void {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setWorkspaceMenuOpen(false);
      window.requestAnimationFrame(() => {
        document.querySelector<HTMLButtonElement>('[data-builder-workspace-menu-button="true"]')
          ?.focus({ preventScroll: true });
      });
    }
    document.addEventListener('pointerdown', closeWorkspaceMenu);
    window.addEventListener('keydown', closeWorkspaceMenuOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeWorkspaceMenu);
      window.removeEventListener('keydown', closeWorkspaceMenuOnEscape);
    };
  }, [workspaceMenuVisible]);

  useEffect(() => {
    if (!previewExpandedVisible) return undefined;
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setPreviewExpanded(false);
      window.requestAnimationFrame(() => {
        document.getElementById('builder-tool-preview')?.focus({ preventScroll: true });
      });
    }
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [previewExpandedVisible]);

  const activityFollowCursor = (() => {
    const liveCursor = visibleLiveOutput === null
      ? 'no-live-output'
      : `${visibleLiveOutput.request_id}:${visibleLiveOutput.state}`;
    const conversation = activity?.conversation;
    if (conversation?.state !== 'ready') return `${activity?.status ?? 'no-activity'}:${liveCursor}`;
    const items = conversation.conversation.items;
    const tail = items.at(-1);
    return [
      conversation.conversation.head_sequence,
      items.length,
      tail === undefined ? 'empty' : `${tail.sequence}:${tail.item_kind}:${activityTitle(tail)}:${activityBody(tail)}`,
      liveCursor,
    ].join(':');
  })();
  const chatFollowKey = [
    status,
    draft?.draft_id ?? 'no-draft',
    saved?.target.revision_number ?? 'no-saved',
    inspected?.target.revision_number ?? 'no-inspected',
    sourceFile?.path ?? 'no-source',
    preview === null ? 'no-preview' : 'preview-ready',
    showChangesPanel ? 'changes-open' : 'changes-closed',
    activityFollowCursor,
  ].join('|');

  function followChatToBottom(): void {
    if (!shouldFollowChatRef.current) return;
    const scroll = chatScrollRef.current;
    if (scroll === null) return;
    scroll.scrollTop = scroll.scrollHeight;
    observedChatScrollTopRef.current = scroll.scrollTop;
  }

  useLayoutEffect(() => {
    const stack = composerStackRef.current;
    if (stack === null) return undefined;
    followChatToBottom();
    if (typeof ResizeObserver !== 'function') return undefined;
    const observer = new ResizeObserver(followChatToBottom);
    observer.observe(stack);
    return () => { observer.disconnect(); };
  }, [showVersionDecision]);

  useEffect(() => {
    if (!pendingSourceFocusRef.current || !sourceDisclosureOpen) return;
    const disclosure = sourceDisclosureRef.current;
    if (disclosure === null) return;
    pendingSourceFocusRef.current = false;
    disclosure.focus();
  }, [sourceDisclosureOpen, sourceFile?.path]);

  useEffect(() => {
    if (!shouldFollowChatRef.current) return;
    followChatToBottom();
  }, [chatFollowKey, hasUnsavedDraft]);

  useEffect(() => {
    const column = chatFlowColumnRef.current;
    if (column === null || typeof ResizeObserver !== 'function') return undefined;
    const observer = new ResizeObserver(followChatToBottom);
    observer.observe(column);
    return () => { observer.disconnect(); };
  }, []);

  const followVisibleLiveOutput = useCallback(() => {
    if (!shouldFollowChatRef.current) return;
    if (liveOutputFollowFrameRef.current !== null) return;
    liveOutputFollowFrameRef.current = window.requestAnimationFrame(() => {
      liveOutputFollowFrameRef.current = null;
      if (!shouldFollowChatRef.current) return;
      const scroll = chatScrollRef.current;
      if (scroll === null) return;
      followChatToBottom();
    });
  }, []);

  useEffect(() => () => {
    if (liveOutputFollowFrameRef.current === null) return;
    window.cancelAnimationFrame(liveOutputFollowFrameRef.current);
    liveOutputFollowFrameRef.current = null;
  }, []);

  useEffect(() => {
    if (!pendingChangesFocusRef.current || !showChangesPanel) return;
    const disclosure = document.querySelector<HTMLDetailsElement>('[data-builder-changes-disclosure="true"]');
    if (disclosure === null) return;
    pendingChangesFocusRef.current = false;
    disclosure.focus({ preventScroll: true });
  }, [showChangesPanel]);

  useEffect(() => {
    if (activeArtifactTab !== 'source' || !hasSideWorkspaceSource) return;
    if (skipNextDraftSourceRequestRef.current) {
      skipNextDraftSourceRequestRef.current = false;
      return;
    }
    if (sideWorkspaceFileTree?.source_kind === 'runtime_snapshot') return;
    void onRequestSideWorkspaceFiles?.();
  }, [activeArtifactTab, hasSideWorkspaceSource, onRequestSideWorkspaceFiles, sideWorkspaceFileTree]);

  function updateChatFollowState(): void {
    const scroll = chatScrollRef.current;
    if (scroll === null) return;
    if (Date.now() > chatReaderScrollIntentUntilRef.current) {
      if (shouldFollowChatRef.current) followChatToBottom();
      else observedChatScrollTopRef.current = scroll.scrollTop;
      return;
    }
    const floor = Math.max(0, scroll.scrollHeight - scroll.clientHeight);
    const expectedTop = Math.min(observedChatScrollTopRef.current, floor);
    const movedByUser = Math.abs(scroll.scrollTop - expectedTop) > 0.5;
    if (!movedByUser) {
      if (shouldFollowChatRef.current) followChatToBottom();
      return;
    }
    shouldFollowChatRef.current = chatReaderScrollDirectionRef.current >= 0 && isNearChatBottom(scroll);
    observedChatScrollTopRef.current = scroll.scrollTop;
  }

  function markChatReaderScrollIntent(): void {
    chatReaderScrollIntentUntilRef.current = Date.now() + 500;
    chatReaderScrollDirectionRef.current = 0;
  }

  function markChatWheelScrollIntent(event: ReactWheelEvent<HTMLDivElement>): void {
    markChatReaderScrollIntent();
    chatReaderScrollDirectionRef.current = Math.sign(event.deltaY);
    // Pause before the browser scroll event, so a concurrent stream frame cannot undo the gesture.
    if (event.deltaY < 0) shouldFollowChatRef.current = false;
  }

  function markChatKeyboardScrollIntent(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) {
      markChatReaderScrollIntent();
      const upward = ['ArrowUp', 'PageUp', 'Home'].includes(event.key) || (event.key === ' ' && event.shiftKey);
      chatReaderScrollDirectionRef.current = upward ? -1 : 1;
      if (upward) shouldFollowChatRef.current = false;
    }
  }

  function setChangesPanelOpen(open: boolean): void {
    setChangesPanelState((panelState) => {
      if (panelState.identity === changesPanelIdentity && panelState.open === open) {
        return panelState;
      }
      return {
        identity: changesPanelIdentity,
        open,
      };
    });
  }

  function setSourceDisclosureOpen(open: boolean): void {
    setSourceDisclosureState((disclosureState) => {
      if (disclosureState.identity === sourceDisclosureIdentity && disclosureState.open === open) {
        return disclosureState;
      }
      return {
        identity: sourceDisclosureIdentity,
        open,
      };
    });
  }

  function setActiveArtifactTab(active: BuilderArtifactTab | null): void {
    setArtifactPanelState((panelState) => {
      const baseOpenTabs = panelState.identity === artifactPanelIdentity
        ? panelState.openTabs.filter((tab) => artifactTabs.includes(tab))
        : [];
      const nextOpenTabs = active === null
        ? []
        : baseOpenTabs.includes(active)
          ? baseOpenTabs
          : [...baseOpenTabs, active];
      if (
        panelState.identity === artifactPanelIdentity
        && panelState.active === active
        && panelState.openTabs.length === nextOpenTabs.length
        && panelState.openTabs.every((tab, index) => tab === nextOpenTabs[index])
      ) {
        return panelState;
      }
      return {
        active,
        openTabs: nextOpenTabs,
        identity: artifactPanelIdentity,
        observedCommandIdentity: commandOutputIdentity,
      };
    });
  }

  function openArtifactTab(tab: BuilderArtifactTab): void {
    setActiveArtifactTab(tab);
    if (tab === 'changes') setChangesPanelOpen(true);
    if (tab === 'source') setSourceDisclosureOpen(true);
  }

  function runProjectPreview(): void {
    if (!artifactTabs.includes('preview')) return;
    openArtifactTab('preview');
    if (
      livePreviewOperation === null
      && livePreviewStatus?.can_start === true
    ) {
      void onRequestLivePreview?.();
    }
  }

  function stopProjectPreview(): void {
    if (
      livePreviewOperation === null
      && livePreviewStatus?.can_stop === true
    ) {
      void onStopLivePreview?.();
    }
  }

  function closeArtifactTab(tab: BuilderArtifactTab): void {
    setArtifactPanelState((panelState) => {
      const baseOpenTabs = panelState.identity === artifactPanelIdentity
        ? panelState.openTabs.filter((openTab) => artifactTabs.includes(openTab))
        : openArtifactTabs;
      const closedIndex = baseOpenTabs.indexOf(tab);
      const nextOpenTabs = baseOpenTabs.filter((openTab) => openTab !== tab);
      const nextActive = panelState.active === tab
        ? nextOpenTabs[Math.max(0, closedIndex)] ?? nextOpenTabs.at(-1) ?? null
        : panelState.active;
      return {
        active: nextActive,
        openTabs: nextOpenTabs,
        identity: artifactPanelIdentity,
        observedCommandIdentity: commandOutputIdentity,
      };
    });
  }

  function openSideWorkspaceTab(type: BuilderSideWorkspaceTabType): void {
    const tab = artifactTabForSideWorkspaceTabType(type, artifactTabs);
    if (tab === null) return;
    openArtifactTab(tab);
  }

  function toggleWorkspaceMenu(): void {
    if (!hasArtifactControls) return;
    setWorkspaceMenuOpen((open) => !open);
  }

  function openWorkspaceMenuTab(tab: BuilderArtifactTab): void {
    if (tab === 'changes') pendingChangesFocusRef.current = true;
    if (tab === 'source' && sideWorkspaceFileTree?.source_kind === 'runtime_snapshot') {
      void onRequestSideWorkspaceFiles?.();
    }
    openArtifactTab(tab);
    setWorkspaceMenuOpen(false);
    if (tab === 'preview') {
      window.requestAnimationFrame(() => {
        document.getElementById('builder-tool-preview')?.focus({ preventScroll: true });
      });
    }
  }

  function minimizeArtifactSidebar(): void {
    const fallbackTab = activeArtifactTab ?? defaultArtifactTab ?? artifactTabs[0] ?? null;
    artifactPreferredWidthRef.current = ARTIFACT_MIN_WIDTH_PX;
    setArtifactWidth(ARTIFACT_MIN_WIDTH_PX);
    if (fallbackTab !== null) {
      setActiveArtifactTab(fallbackTab);
    }
  }

  function toggleArtifactSidebar(): void {
    if (showArtifactSidebar) {
      setActiveArtifactTab(null);
      return;
    }
    const fallbackTab = activeArtifactTab ?? defaultArtifactTab ?? artifactTabs[0] ?? null;
    if (fallbackTab !== null) {
      setActiveArtifactTab(fallbackTab);
    }
  }

  function openProjectLocation(): void {
    if (openLocationProjectId === null) return;
    void onOpenProjectLocation?.(openLocationProjectId);
  }

  function startArtifactResize(event: ReactPointerEvent<HTMLButtonElement>): void {
    if (event.button !== 0) return;
    event.preventDefault();
    const sidebar = artifactSidebarRef.current;
    const startWidth = sidebar?.getBoundingClientRect().width ?? artifactWidth;
    const startX = event.clientX;
    const handle = event.currentTarget;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    let stopped = false;

    setArtifactResizing(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    try {
      handle.setPointerCapture(event.pointerId);
    } catch {
      // jsdom and some fallback event paths do not implement pointer capture.
    }

    function onPointerMove(moveEvent: globalThis.PointerEvent): void {
      const shellWidth = chatShellRef.current?.getBoundingClientRect().width ?? Number.NaN;
      const maximum = artifactMaxWidthForShell(shellWidth);
      const nextWidth = clampArtifactWidth(
        startWidth + startX - moveEvent.clientX,
        maximum,
      );
      setArtifactWidthMaximum(maximum);
      artifactPreferredWidthRef.current = nextWidth;
      setArtifactWidth(nextWidth);
    }

    function stopResize(): void {
      if (stopped) return;
      stopped = true;
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', stopResize);
      window.removeEventListener('pointercancel', stopResize);
      try {
        handle.releasePointerCapture(event.pointerId);
      } catch {
        // Pointer capture may be unavailable in tests or older browser paths.
      }
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      setArtifactResizing(false);
    }

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', stopResize, { once: true });
    window.addEventListener('pointercancel', stopResize, { once: true });
  }

  function resizeArtifactWithKeyboard(event: ReactKeyboardEvent<HTMLButtonElement>): void {
    const step = event.shiftKey ? ARTIFACT_KEYBOARD_LARGE_STEP_PX : ARTIFACT_KEYBOARD_STEP_PX;
    const maximum = artifactMaxWidthForShell(
      chatShellRef.current?.getBoundingClientRect().width ?? Number.NaN,
    );
    setArtifactWidthMaximum(maximum);
    let nextWidth: number | null = null;
    if (event.key === 'ArrowLeft') {
      nextWidth = artifactWidth + step;
    } else if (event.key === 'ArrowRight') {
      nextWidth = artifactWidth - step;
    } else if (event.key === 'Home') {
      nextWidth = ARTIFACT_MIN_WIDTH_PX;
    } else if (event.key === 'End') {
      nextWidth = maximum;
    }
    if (nextWidth === null) return;
    event.preventDefault();
    const clampedWidth = clampArtifactWidth(nextWidth, maximum);
    artifactPreferredWidthRef.current = clampedWidth;
    setArtifactWidth(clampedWidth);
  }

  function selectFile(path: string): boolean {
    if (typeof onSelectFile !== 'function') return false;
    onSelectFile(path);
    return true;
  }

  function openChangedFile(change: BuilderSourceTreeChange): void {
    if (change.change_kind === 'deleted') {
      openArtifactTab('changes');
      return;
    }
    if (!selectFile(change.path)) return;
    pendingSourceFocusRef.current = true;
    openArtifactTab('source');
    const disclosure = sourceDisclosureRef.current;
    if (disclosure !== null) {
      pendingSourceFocusRef.current = false;
      disclosure.focus();
    }
  }

  async function openRuntimeToolFile(
    request: Readonly<{ run_id: string; tool_call_id: string }>,
  ): Promise<boolean> {
    if (typeof onOpenRuntimeToolFile !== 'function') return false;
    skipNextDraftSourceRequestRef.current = true;
    const opened = await onOpenRuntimeToolFile(request);
    if (!opened) {
      skipNextDraftSourceRequestRef.current = false;
      return false;
    }
    pendingSourceFocusRef.current = true;
    openArtifactTab('source');
    window.requestAnimationFrame(() => {
      const disclosure = sourceDisclosureRef.current;
      if (disclosure === null) return;
      pendingSourceFocusRef.current = false;
      disclosure.focus();
    });
    return true;
  }

  function openCheckCommand(): void {
    openArtifactTab('terminal_placeholder');
  }

  function openHistoryWorkspace(): void {
    setArtifactPanelState({
      active: 'versions',
      openTabs: artifactTabs.includes('versions')
        ? [...new Set<BuilderArtifactTab>([
          ...artifactPanelState.openTabs,
          'versions',
        ])]
        : artifactPanelState.openTabs,
      identity: artifactPanelIdentity,
      observedCommandIdentity: commandOutputIdentity,
    });
  }

  function openRuntimeToolCommand(item: RuntimeToolActivityItem): void {
    setRuntimeCommandState({ identity: artifactPanelIdentity, item });
    openArtifactTab('terminal_placeholder');
  }

  function openRuntimeToolBrowser(): void {
    openArtifactTab('browser_placeholder');
  }

  function openExpandedPreview(): void {
    openArtifactTab('preview');
    setPreviewExpanded(true);
  }

  function closeExpandedPreview(): void {
    setPreviewExpanded(false);
    window.requestAnimationFrame(() => {
      document.getElementById('builder-tool-preview')?.focus({ preventScroll: true });
    });
  }

  const conversationNotice = (() => {
    if (
      visibleLiveOutput !== null
      && (status === 'submitting' || status === 'generating' || status === 'answering')
    ) return null;
    if (status === 'opening') {
      return (
        <p
          className="cf-builder-alert cf-builder-alert-info cf-builder-chat-notice text-sm"
          data-builder-conversation-notice="opening"
          role="status"
        >
          Opening your project...
        </p>
      );
    }
    if (status === 'generating') {
      return (
        <p
          className="cf-builder-alert cf-builder-alert-info cf-builder-chat-notice text-sm"
          data-builder-conversation-notice="generating"
          role="status"
        >
          Making your draft...
        </p>
      );
    }
    if (status === 'submitting') {
      return (
        <p
          className="cf-builder-alert cf-builder-alert-info cf-builder-chat-notice text-sm"
          data-builder-conversation-notice="submitting"
          role="status"
        >
          Working on your request...
        </p>
      );
    }
    if (status === 'answering') {
      return (
        <p
          className="cf-builder-alert cf-builder-alert-info cf-builder-chat-notice text-sm"
          data-builder-conversation-notice="answering"
          role="status"
        >
          Answering...
        </p>
      );
    }
    if (status === 'restoring') {
      return (
        <p
          className="cf-builder-alert cf-builder-alert-info cf-builder-chat-notice text-sm"
          data-builder-conversation-notice="restoring"
          role="status"
        >
          Restoring draft for review...
        </p>
      );
    }
    if (status === 'rejecting') {
      return (
        <p
          className="cf-builder-alert cf-builder-alert-info cf-builder-chat-notice text-sm"
          data-builder-conversation-notice="rejecting"
          role="status"
        >
          Discarding this draft...
        </p>
      );
    }
    if (showFailedNotice) {
      return (
        <div
          className="cf-builder-alert cf-builder-alert-danger cf-builder-chat-notice flex flex-col gap-2 text-sm"
          data-builder-conversation-notice={status}
          role="alert"
        >
          <p>
            {approvedPlanContinuationFailed
              ? approvedPlanContinuationFailureMessage(current?.error ?? null)
              : failedStatusMessage(status, current?.error ?? null)}
          </p>
          {canOpenSettings ? (
            <button
              className="cf-builder-secondary-button inline-flex min-h-9 items-center justify-center px-3 text-sm font-medium"
              onClick={onOpenSettings}
              type="button"
            >
              Check AI settings
            </button>
          ) : null}
          {canRetryGenerate ? (
            <button
              className="cf-builder-secondary-button inline-flex min-h-9 items-center justify-center gap-2 px-3 text-sm font-medium"
              data-builder-retry-draft="true"
              onClick={onRetryGenerate}
              type="button"
            >
              <RefreshCw aria-hidden="true" className="size-4" />
              Retry
            </button>
          ) : null}
        </div>
      );
    }
    if (status === 'save_unknown') {
      return (
        <p
          className="cf-builder-alert cf-builder-alert-danger cf-builder-chat-notice text-sm"
          data-builder-conversation-notice="save_unknown"
          role="alert"
        >
          The save result could not be confirmed. Your draft is still available; check the project and try again.
        </p>
      );
    }
    if (status === 'reject_failed') {
      return (
        <p
          className="cf-builder-alert cf-builder-alert-danger cf-builder-chat-notice text-sm"
          data-builder-conversation-notice="reject_failed"
          role="alert"
        >
          The draft could not be discarded. Your draft is still available; try again.
        </p>
      );
    }
    if (status === 'conflict') {
      return (
        <p
          className="cf-builder-alert cf-builder-alert-danger cf-builder-chat-notice text-sm"
          data-builder-conversation-notice="conflict"
          role="alert"
        >
          This project changed before the saved version could be verified.
        </p>
      );
    }
    if (status === 'unavailable') {
      return (
        <p
          className="cf-builder-alert cf-builder-alert-danger cf-builder-chat-notice text-sm"
          data-builder-conversation-notice="unavailable"
          role="alert"
        >
          This project is unavailable.
        </p>
      );
    }
    return null;
  })();
  const dependencyPreparationReason = displayedCheckRunStatus?.environment_reason ?? 'none';
  const dependencyPreparationAttemptFailed = dependencyPreparationReason === 'dependency_preparation_failed'
    || dependencyPreparationReason === 'dependency_preparation_timed_out';
  const dependencyPreparationToolchainBlocked = dependencyPreparationReason === 'package_manager_unavailable'
    || dependencyPreparationReason === 'host_toolchain_missing';
  const dependencyPreparationInteractionActive = checkRunOperation === 'preparing_dependencies'
    || checkRunOperation === 'failed';
  const dependencyPreparationNeeded = hasUnsavedDraft
    && (
      dependencyPreparationInteractionActive
      || (!busy && !conversationHasInFlightStage)
    )
    && checkRunProfile !== null
    && displayedCheckRunStatus?.status === 'incomplete'
    && (
      dependencyPreparationReason === 'dependency_workspace_missing'
      || dependencyPreparationReason === 'install_approval_required'
      || dependencyPreparationAttemptFailed
      || dependencyPreparationToolchainBlocked
    )
    && (
      typeof onDecideCheckDependencyPreparation === 'function'
      || typeof onDiagnoseCheckEnvironment === 'function'
    );
  const dependencyPreparationProfile = dependencyPreparationNeeded ? checkRunProfile : null;
  const dependencyPreparationTitle = dependencyPreparationToolchainBlocked
    ? dependencyPreparationReason === 'package_manager_unavailable'
      ? 'Package manager unavailable'
      : 'Local toolchain unavailable'
    : dependencyPreparationAttemptFailed
      ? 'Check dependency preparation failed'
      : 'Prepare check dependencies?';
  const dependencyPreparationSummary = dependencyPreparationToolchainBlocked
    ? dependencyPreparationReason === 'package_manager_unavailable'
      ? 'Builder could not start the package manager needed to prepare check dependencies.'
      : 'Builder cannot see the local Node/package-manager toolchain required for this check.'
    : dependencyPreparationAttemptFailed
      ? dependencyPreparationReason === 'dependency_preparation_timed_out'
        ? 'Dependency preparation reached the time limit in the isolated check workspace.'
        : 'Dependency preparation failed in the isolated check workspace.'
      : checkRunOperation === 'preparing_dependencies'
        ? `Builder is preparing dependencies in the isolated check workspace before rerunning ${dependencyPreparationProfile?.command_display ?? 'the check'}.`
        : `The generated draft needs dependencies prepared in its isolated check workspace before ${dependencyPreparationProfile?.command_display ?? 'the check'} can pass.`;
  const dependencyPreparationNote = dependencyPreparationToolchainBlocked
    ? 'Diagnose local tools first. Dependency preparation cannot start until the selected package manager is available.'
    : dependencyPreparationAttemptFailed
      ? 'This did not write to the project folder or save a version. You can retry this check preparation.'
      : 'This does not write to the project folder or save a version. Approval is only for this check.';
  const dependencyPreparationStatus = checkRunOperation === 'preparing_dependencies'
    ? 'preparing'
    : dependencyPreparationToolchainBlocked
      ? 'toolchain_unavailable'
      : dependencyPreparationAttemptFailed ? 'retryable' : 'needs_approval';
  const dependencyPreparationCanPrepare = dependencyPreparationProfile !== null
    && !dependencyPreparationToolchainBlocked
    && typeof onDecideCheckDependencyPreparation === 'function';
  const dependencyPreparationPrimaryAction = dependencyPreparationToolchainBlocked
    ? 'Diagnose local tools before preparing dependencies.'
    : checkRunOperation === 'preparing_dependencies'
      ? `Builder will rerun ${dependencyPreparationProfile?.command_display ?? 'the check'} automatically.`
      : `Builder will rerun ${dependencyPreparationProfile?.command_display ?? 'the check'} and enable Save if it passes.`;
  const dependencyPreparationStatusFacts = dependencyPreparationProfile === null ? [] : [
    {
      key: 'project_folder',
      label: 'Project folder',
      value: 'Not changed by Prepare once',
    },
    {
      key: 'check_workspace',
      label: 'Check workspace',
      value: dependencyPreparationToolchainBlocked
        ? 'Waiting for local toolchain'
        : checkRunOperation === 'preparing_dependencies'
        ? 'Preparing dependencies now'
        : dependencyPreparationAttemptFailed
          ? 'Needs another preparation attempt'
          : 'Dependencies not prepared yet',
    },
    {
      key: 'after_prepare',
      label: dependencyPreparationToolchainBlocked ? 'Next step' : 'After Prepare once',
      value: dependencyPreparationPrimaryAction,
    },
  ];
  const dependencyPreparationDecisionFailureMessage = checkRunOperationFailureCode === 'busy'
    ? 'A project check is already running. Try again when it finishes.'
    : checkRunOperationFailureCode === 'stale_draft'
      ? 'This draft or check option changed. Refresh the current draft and try again.'
      : checkRunOperationFailureCode === 'invalid_request'
        ? 'Builder could not verify this check request. Refresh the draft and try again.'
        : checkRunOperationFailureCode === 'forbidden'
          ? 'The check request did not come from the active Builder window. Try again from this window.'
          : 'I could not record that decision. Try again.';
  const dependencyPreparationDiagnosis = dependencyPreparationProfile !== null
    && checkEnvironmentDiagnosis?.command_profile_id === dependencyPreparationProfile.command_profile_id
    ? checkEnvironmentDiagnosis
    : null;
  const dependencyPreparationDiagnosisFacts = dependencyPreparationDiagnosis?.diagnosis === undefined
    ? null
    : [
      `Readiness: ${dependencyPreparationDiagnosis.diagnosis.safe_summary}`,
      `Toolchain: ${dependencyPreparationDiagnosis.diagnosis.host_toolchain_state}`,
      `Check workspace: ${dependencyPreparationDiagnosis.diagnosis.check_workspace_dependency_state}`,
      `Package manager: ${dependencyPreparationDiagnosis.diagnosis.package_manager}`,
    ];
  const dependencyPreparationCard = dependencyPreparationProfile === null ? null : (
    <section
      aria-label="Check dependency preparation"
      className="cf-builder-review-checkpoint cf-builder-chat-flow-surface"
      data-builder-dependency-preparation="true"
      data-builder-dependency-preparation-failed={dependencyPreparationAttemptFailed ? 'true' : undefined}
    >
      <div className="cf-builder-review-copy">
        <div className="cf-builder-review-icon" aria-hidden="true">
          <Download className="size-4" />
        </div>
        <div className="min-w-0">
          <h2 className="cf-builder-review-title">{dependencyPreparationTitle}</h2>
          <p className="cf-builder-review-summary">
            {dependencyPreparationSummary}
          </p>
          <p className="cf-builder-review-note">
            {dependencyPreparationNote}
          </p>
          <dl
            className="cf-builder-dependency-facts"
            data-builder-dependency-preparation-status={dependencyPreparationStatus}
          >
            {dependencyPreparationStatusFacts.map((fact) => (
              <div data-builder-dependency-preparation-fact={fact.key} key={fact.key}>
                <dt>{fact.label}</dt>
                <dd>{fact.value}</dd>
              </div>
            ))}
          </dl>
          {dependencyPreparationDiagnosis === null ? null : (
            <div
              className="mt-2 space-y-1 text-xs text-muted-foreground"
              data-builder-check-environment-diagnosis={dependencyPreparationDiagnosis.status}
            >
              {dependencyPreparationDiagnosis.status === 'loading' ? (
                <p>Checking local tools and isolated dependencies...</p>
              ) : dependencyPreparationDiagnosis.status === 'failed' ? (
                <p role="alert">
                  {dependencyPreparationDiagnosis.failure_message
                    ?? 'I could not read the check environment diagnosis. Try again.'}
                </p>
              ) : dependencyPreparationDiagnosisFacts === null ? null : (
                dependencyPreparationDiagnosisFacts.map((fact) => (
                  <p key={fact}>{fact}</p>
                ))
              )}
            </div>
          )}
        </div>
      </div>
      <div className="cf-builder-review-actions" data-builder-dependency-preparation-actions="true">
        {checkRunOperation === 'failed' ? (
          <p className="cf-builder-review-note" role="alert">
            {dependencyPreparationDecisionFailureMessage}
          </p>
        ) : null}
        {typeof onDiagnoseCheckEnvironment === 'function' ? (
          <button
            className="cf-builder-secondary-button inline-flex min-h-8 shrink-0 items-center justify-center gap-2 px-2.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50"
            data-builder-diagnose-check-environment="true"
            disabled={dependencyPreparationDiagnosis?.status === 'loading'}
            onClick={() => {
              void onDiagnoseCheckEnvironment(dependencyPreparationProfile);
            }}
            type="button"
          >
            <ShieldCheck className="size-3.5" aria-hidden="true" />
            {dependencyPreparationDiagnosis?.status === 'loading' ? 'Checking...' : 'Diagnose'}
          </button>
        ) : null}
        {dependencyPreparationCanPrepare ? (
          <>
            <button
              className="cf-builder-secondary-button inline-flex min-h-8 shrink-0 items-center justify-center gap-2 px-2.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50"
              data-builder-deny-dependency-preparation="true"
              disabled={checkRunOperation === 'preparing_dependencies'}
              onClick={() => {
                void onDecideCheckDependencyPreparation?.('deny', dependencyPreparationProfile);
              }}
              type="button"
            >
              Not now
            </button>
            <button
              className="cf-builder-primary-button inline-flex min-h-8 shrink-0 items-center justify-center gap-2 px-2.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50"
              data-builder-allow-dependency-preparation="true"
              disabled={checkRunOperation === 'preparing_dependencies'}
              onClick={() => {
                void onDecideCheckDependencyPreparation?.('allow_once', dependencyPreparationProfile);
              }}
              type="button"
            >
              {checkRunOperation === 'preparing_dependencies' ? 'Preparing...' : 'Prepare once'}
            </button>
          </>
        ) : null}
      </div>
    </section>
  );
  const projectEnvironmentSetup = !hasUnsavedDraft
    && !viewingHistory
    && saved !== null
    && projectEnvironmentDiagnosis?.project_id === saved.target.project_id
    && projectEnvironmentDiagnosis.status === 'ready'
    && projectEnvironmentDiagnosis.diagnosis?.readiness_state === 'project_dependencies_missing'
    ? projectEnvironmentDiagnosis.diagnosis
    : null;
  const projectEnvironmentSetupCommand = projectEnvironmentSetup?.package_manager === 'pnpm'
    ? 'pnpm install'
    : projectEnvironmentSetup?.package_manager === 'yarn'
      ? 'yarn install'
      : projectEnvironmentSetup?.package_manager === 'bun'
        ? 'bun install'
        : 'npm install';
  const projectEnvironmentPreparing = projectEnvironmentSetup !== null
    && projectDependencyPreparation?.project_id === projectEnvironmentSetup.project_id
    && projectDependencyPreparation.status === 'preparing';
  const projectEnvironmentPreparationFailure = projectEnvironmentSetup !== null
    && projectDependencyPreparation?.project_id === projectEnvironmentSetup.project_id
    && projectDependencyPreparation.status === 'failed'
    ? projectDependencyPreparation.failure_message ?? 'Project dependency preparation failed.'
    : null;
  const projectEnvironmentSetupCard = projectEnvironmentSetup === null ? null : (
    <section
      aria-label="Project environment setup"
      className="cf-builder-review-checkpoint cf-builder-chat-flow-surface"
      data-builder-project-environment-setup="true"
    >
      <div className="cf-builder-review-copy">
        <div className="cf-builder-review-icon" aria-hidden="true">
          <AlertCircle className="size-4" />
        </div>
        <div className="min-w-0">
          <h2 className="cf-builder-review-title">Saved project dependencies needed</h2>
          <p className="cf-builder-review-summary">
            This saved project declares dependencies, but its project folder does not have an install yet.
          </p>
          <p className="cf-builder-review-note">
            Prepare once runs {projectEnvironmentSetupCommand} in the saved project folder for local launch, then Builder diagnoses it again.
            Current-draft checks still use their isolated workspace.
          </p>
          {projectEnvironmentPreparationFailure === null ? null : (
            <p className="cf-builder-review-note" role="alert">
              {projectEnvironmentPreparationFailure}
            </p>
          )}
        </div>
      </div>
      {typeof onPrepareProjectDependencies === 'function' || typeof onOpenSettings === 'function' ? (
        <div className="cf-builder-review-actions">
          {typeof onPrepareProjectDependencies === 'function' ? (
            <button
              className="cf-builder-primary-button inline-flex min-h-8 shrink-0 items-center justify-center gap-2 px-2.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50"
              data-builder-prepare-project-dependencies="true"
              disabled={projectEnvironmentPreparing}
              onClick={() => {
                void onPrepareProjectDependencies(projectEnvironmentSetup.project_id);
              }}
              type="button"
            >
              <ShieldCheck className="size-3.5" aria-hidden="true" />
              {projectEnvironmentPreparing ? 'Preparing...' : 'Prepare once'}
            </button>
          ) : null}
          {typeof onOpenSettings === 'function' ? (
            <button
              className="cf-builder-secondary-button inline-flex min-h-8 shrink-0 items-center justify-center gap-2 px-2.5 text-xs font-medium"
              data-builder-open-project-environment-diagnostics="true"
              onClick={onOpenSettings}
              type="button"
            >
              Open diagnostics
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
  const planSourceReadApprovalCard = planSourceReadApproval === null ? null : (
    <section
      aria-label="Project read approval"
      className="cf-builder-review-checkpoint cf-builder-chat-flow-surface"
      data-builder-plan-source-read-approval="true"
    >
      <div className="cf-builder-review-copy">
        <div className="cf-builder-review-icon" aria-hidden="true">
          <LockKeyhole className="size-4" />
        </div>
        <div className="min-w-0">
          <h2 className="cf-builder-review-title">Allow project reading?</h2>
          {planSourceReadApproval.file_count === null ? (
            <p className="cf-builder-review-summary">
              I could not prepare project reading for this plan.
            </p>
          ) : (
            <p className="cf-builder-review-summary">
              I need to read {planSourceReadApproval.file_count === 1
                ? 'one project file'
                : `${planSourceReadApproval.file_count} project files`} to make a useful plan.
            </p>
          )}
          <p className="cf-builder-review-note">
            This only prepares the plan. It will not change files or save a version.
          </p>
        </div>
      </div>
      <div className="cf-builder-review-actions" data-builder-plan-source-read-actions="true">
        {planSourceReadApproval.state === 'failed' ? (
          <p className="cf-builder-review-note" role="alert">
            I could not prepare or record that approval. Try again.
          </p>
        ) : null}
        <button
          className="cf-builder-secondary-button inline-flex min-h-8 shrink-0 items-center justify-center gap-2 px-2.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50"
          data-builder-dismiss-plan-source-read="true"
          disabled={planSourceReadApproval.state === 'approving'}
          onClick={onDismissPlanSourceReadApproval}
          type="button"
        >
          Not now
        </button>
        <button
          className="cf-builder-primary-button inline-flex min-h-8 shrink-0 items-center justify-center gap-2 px-2.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50"
          data-builder-approve-plan-source-read="true"
          disabled={planSourceReadApproval.state === 'approving'}
          onClick={() => { void onApprovePlanSourceRead?.(); }}
          type="button"
        >
          {planSourceReadApproval.state === 'approving' ? 'Allowing...' : 'Allow and continue'}
        </button>
      </div>
    </section>
  );

  const currentProjectWriteApprovalCard = currentProjectWriteApproval === null ? null : (
    <section
      aria-label="Current project write approval"
      className="cf-builder-review-checkpoint cf-builder-chat-flow-surface"
      data-builder-current-project-write-approval="true"
    >
      <div className="cf-builder-review-copy">
        <div className="cf-builder-review-icon" aria-hidden="true">
          <LockKeyhole className="size-4" />
        </div>
        <div className="min-w-0">
          <h2 className="cf-builder-review-title">Allow current project changes?</h2>
          <p className="cf-builder-review-summary">
            I can prepare a draft in the selected project folder after you allow writes for this project.
          </p>
          <p className="cf-builder-review-note">
            This does not save a version. You will still review the draft before saving.
          </p>
        </div>
      </div>
      <div className="cf-builder-review-actions" data-builder-current-project-write-actions="true">
        {currentProjectWriteApproval.state === 'failed' ? (
          <p className="cf-builder-review-note" role="alert">
            I could not record that approval. Try again.
          </p>
        ) : null}
        <button
          className="cf-builder-secondary-button inline-flex min-h-8 shrink-0 items-center justify-center gap-2 px-2.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50"
          data-builder-dismiss-current-project-write="true"
          disabled={currentProjectWriteApproval.state === 'approving'}
          onClick={onDismissCurrentProjectWriteApproval}
          type="button"
        >
          Not now
        </button>
        <button
          className="cf-builder-primary-button inline-flex min-h-8 shrink-0 items-center justify-center gap-2 px-2.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50"
          data-builder-approve-current-project-write="true"
          disabled={currentProjectWriteApproval.state === 'approving'}
          onClick={() => { void onApproveCurrentProjectWrite?.(); }}
          type="button"
        >
          {currentProjectWriteApproval.state === 'approving' ? 'Allowing...' : 'Allow and continue'}
        </button>
      </div>
    </section>
  );

  const commandApprovalCard = commandApproval === null ? null : (
    <section
      aria-label="Command execution approval"
      className="cf-builder-review-checkpoint cf-builder-chat-flow-surface cf-builder-command-approval"
      data-builder-command-approval="true"
      data-builder-command-approval-state={commandApproval.state}
    >
      <div className="cf-builder-review-copy">
        <div className="cf-builder-review-icon" aria-hidden="true">
          <SquareTerminal className="size-4" />
        </div>
        <div className="cf-builder-review-copy-body">
          <h2 className="cf-builder-review-title">允许运行这条命令？</h2>
          <code className="cf-builder-command-approval-command">
            {commandApproval.request.command_display}
          </code>
          <p className="cf-builder-review-summary">
            {commandApproval.request.description}
          </p>
          <p className="cf-builder-review-note">
            此项目脚本可能修改文件或访问网络。授权仅对本次命令有效。
          </p>
        </div>
      </div>
      <div className="cf-builder-review-actions" data-builder-command-approval-actions="true">
        {commandApproval.state === 'failed' ? (
          <p className="cf-builder-review-note" role="alert">
            无法记录这次决定，或请求已经过期。请重试任务。
          </p>
        ) : null}
        <button
          className="cf-builder-secondary-button inline-flex min-h-8 shrink-0 items-center justify-center gap-2 px-2.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50"
          data-builder-deny-command="true"
          disabled={commandApproval.state === 'deciding'}
          onClick={() => { void onDecideCommandApproval?.('deny'); }}
          type="button"
        >
          拒绝
        </button>
        <button
          className="cf-builder-primary-button inline-flex min-h-8 shrink-0 items-center justify-center gap-2 px-2.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50"
          data-builder-allow-command-once="true"
          disabled={commandApproval.state === 'deciding'}
          onClick={() => { void onDecideCommandApproval?.('allow_once'); }}
          type="button"
        >
          {commandApproval.state === 'deciding' ? '正在记录...' : '仅允许这一次'}
        </button>
      </div>
    </section>
  );

  const discardDraftLabel = status === 'rejecting' ? 'Discarding...' : 'Discard draft';
  const saveVersionLabel = status === 'saving'
    ? 'Saving...'
    : status === 'save_unknown'
      ? 'Try Save again'
      : 'Save version';
  const versionDecisionCard = showVersionDecision ? (
    <BuilderComposerVersionDecisionCard
      blockedMessage={null}
      canReject={canReject}
      canSave={canSave}
      discardLabel={discardDraftLabel}
      onRejectDraft={onRejectDraft}
      onSave={onSave}
      saveLabel={saveVersionLabel}
    />
  ) : null;
  const canManualCompactContext = !showingAgentWorkbench
    && !viewingHistory
    && typeof onManualCompactContext === 'function'
    && manualContextCompactionFeedback !== 'compacting'
    && contextUsageProjection !== null
    && contextUsageProjection.compaction_state !== 'compacting'
    && contextUsageProjection.measurement_state !== 'awaiting_post_compaction_projection';
  const composer = (
    <div
      className="cf-builder-composer-stack"
      data-builder-composer-stack="true"
      ref={composerStackRef}
    >
      {versionDecisionCard}
      <BuilderComposer
        activeRunFollowupQueued={activeRunFollowupQueued}
        approvalMode={approvalMode}
        busy={composerBusy}
        canAddContext={canAddContext}
        canAllowCurrentProjectApproval={saved !== null || workingProject !== null}
        canCancel={canCancel}
        canEditInstruction={canEditInstruction}
        canProposePlan={canProposePlan}
        canSubmitComposer={canSubmitComposer}
        composerContextStatus={viewingHistory ? null : composerContextStatus}
        providerContextDisclosureStatus={viewingHistory ? null : providerContextDisclosureStatus}
        contextUsageProjection={viewingHistory ? null : contextUsageProjection}
        manualContextCompactionFeedback={viewingHistory ? 'idle' : manualContextCompactionFeedback}
        canManualCompactContext={canManualCompactContext}
        composerMode={composerMode}
        modelSelection={composerModelSelection}
        composerRouteDecision={composerRouteDecision}
        hasUnsavedDraft={hasUnsavedDraft}
        instruction={instruction}
        onCancel={onCancel}
        onPauseTask={canPauseTask ? onPauseTask : undefined}
        onResumeInterruptedRun={onResumeInterruptedRun}
        onManualCompactContext={canManualCompactContext ? onManualCompactContext : undefined}
        paused={pausedTask}
        onClearComposerMode={onClearComposerMode}
        onInstructionChange={onInstructionChange}
        onOpenSettings={onOpenSettings}
        onSelectApprovalMode={onSelectApprovalMode}
        onSelectComposerMode={onSelectComposerMode}
        onSelectModel={onSelectComposerModel}
        onSelectPlanMode={onSelectPlanMode}
        onSubmitInstruction={onSubmitInstruction}
        surfaceKind={showingAgentWorkbench ? 'workbench' : 'task'}
        status={status}
        viewingHistory={viewingHistory}
      />
    </div>
  );

  const workspaceControls = openLocationProjectId !== null || hasArtifactControls || hasUnsavedDraft ? (
    <div
      aria-label="Workspace artifact controls"
      className="cf-builder-workspace-controls"
      data-builder-workspace-controls="true"
      data-builder-workspace-drawer-visible={showArtifactSidebar ? 'true' : 'false'}
      role="group"
    >
      {hasUnsavedDraft ? (
        <BuilderDraftCheckStatus
          checkRunOperation={checkRunOperation}
          checkRunOutcome={checkRunOutcome}
          checkRunProfiles={checkRunProfiles}
          checkRunStatus={checkRunStatus}
          presentation="compact"
        />
      ) : null}
      {openLocationProjectId !== null
      && artifactTabs.includes('preview')
      && typeof onRequestLivePreview === 'function' ? (
        <>
          <button
            aria-label={livePreviewStatus?.status === 'ready' ? 'Open running project' : 'Run project'}
            className="cf-builder-workspace-control-button"
            data-builder-control-presentation="compact"
            data-builder-run-project="true"
            disabled={
              livePreviewOperation !== null
              || (livePreviewStatus?.can_start !== true && livePreviewStatus?.status !== 'ready')
            }
            onClick={runProjectPreview}
            title={livePreviewStatus?.status === 'ready' ? 'Open running project' : 'Run project'}
            type="button"
          >
            <Play aria-hidden="true" className="size-3.5" />
            <span className="cf-builder-visually-hidden">Run</span>
          </button>
          <button
            aria-label="Stop project"
            className="cf-builder-workspace-control-button"
            data-builder-stop-project="true"
            disabled={
              livePreviewOperation !== null
              || typeof onStopLivePreview !== 'function'
              || livePreviewStatus?.can_stop !== true
            }
            onClick={stopProjectPreview}
            title="Stop project"
            type="button"
          >
            <StopCircle aria-hidden="true" className="size-3.5" />
          </button>
        </>
      ) : null}
      {openLocationProjectId !== null ? (
        <button
          aria-label="Open project folder"
          className="cf-builder-workspace-control-button cf-builder-workspace-location-button"
          data-builder-open-project-location="true"
          onClick={openProjectLocation}
          title="Open project folder"
          type="button"
        >
          <FolderOpen aria-hidden="true" className="size-3.5" />
        </button>
      ) : null}
      {hasArtifactControls ? (
        <>
          <div className="cf-builder-workspace-menu-wrap">
            <button
              aria-expanded={workspaceMenuVisible}
              aria-haspopup="menu"
              aria-label="Workspace menu"
              className="cf-builder-workspace-control-button cf-builder-workspace-menu-button"
              data-active={showArtifactSidebar ? 'true' : undefined}
              data-builder-workspace-menu-button="true"
              onClick={toggleWorkspaceMenu}
              title="Workspace menu"
              type="button"
            >
              <Menu aria-hidden="true" className="size-3.5" />
              <ChevronDown aria-hidden="true" className="size-3" />
            </button>
            {workspaceMenuVisible ? (
              <div
                aria-label="Workspace menu"
                className="cf-builder-workspace-menu"
                data-builder-workspace-menu="true"
                role="menu"
              >
                {artifactTabs.map((tab) => (
                  <button
                    aria-checked={activeArtifactTab === tab}
                    className="cf-builder-workspace-menu-item"
                    data-active={activeArtifactTab === tab ? 'true' : undefined}
                    data-builder-workspace-control-tab={tab}
                    key={tab}
                    onClick={() => openWorkspaceMenuTab(tab)}
                    role="menuitemradio"
                    type="button"
                  >
                    <ArtifactTabIcon tab={tab} />
                    <span>{artifactTabLabel(tab)}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <button
            aria-label="Minimize artifact panel"
            className="cf-builder-workspace-control-button"
            data-builder-minimize-artifact="true"
            onClick={minimizeArtifactSidebar}
            title="Minimize artifact panel"
            type="button"
          >
            <Minimize2 aria-hidden="true" className="size-3.5" />
          </button>
          <button
            aria-label={showArtifactSidebar ? 'Hide artifact panel' : 'Show artifact panel'}
            aria-pressed={showArtifactSidebar}
            className="cf-builder-workspace-control-button"
            data-builder-toggle-artifact="true"
            onClick={toggleArtifactSidebar}
            title={showArtifactSidebar ? 'Hide artifact panel' : 'Show artifact panel'}
            type="button"
          >
            {showArtifactSidebar ? (
              <PanelRightClose aria-hidden="true" className="size-3.5" />
            ) : (
              <PanelRightOpen aria-hidden="true" className="size-3.5" />
            )}
          </button>
        </>
      ) : null}
    </div>
  ) : null;
  const taskMonitorControl = taskMonitorAvailable ? (
    <button
      aria-label={showTaskMonitor ? 'Hide tasks' : 'Show tasks'}
      aria-pressed={showTaskMonitor}
      className="cf-builder-workspace-control-button cf-builder-task-monitor-toggle"
      data-builder-task-monitor-toggle="true"
      onClick={() => setTaskMonitorCollapsed((currentValue) => !currentValue)}
      title={showTaskMonitor ? 'Hide tasks' : 'Show tasks'}
      type="button"
    >
      {showTaskMonitor ? (
        <PanelRightClose aria-hidden="true" className="size-3.5" />
      ) : (
        <PanelRightOpen aria-hidden="true" className="size-3.5" />
      )}
      <span>{taskMonitorTasks.length}</span>
    </button>
  ) : null;
  const inspectRevisionFromWorkspace = (
    projectId: string,
    revisionReceiptDigest: string,
  ): Promise<unknown> | void => {
    const nextIdentity = `${artifactWorkspaceIdentity}|${revisionReceiptDigest}`;
    setArtifactPanelState((previous) => ({
      active: 'preview',
      identity: nextIdentity,
      openTabs: previous.openTabs.includes('preview')
        ? previous.openTabs
        : [...previous.openTabs, 'preview'],
      observedCommandIdentity: commandOutputIdentity,
    }));
    return onInspectRevision?.(projectId, revisionReceiptDigest);
  };
  const artifactOnExpandPreview = useLatestCallback(openExpandedPreview);
  const artifactOnApproveProviderContextDisclosure = useLatestOptionalCallback(
    onApproveProviderContextDisclosure,
  );
  const artifactOnInspectRevision = useLatestCallback(inspectRevisionFromWorkspace);
  const artifactOnOpenFile = useLatestCallback(openChangedFile);
  const artifactOnRefreshHistory = useLatestOptionalCallback(onRefreshHistory);
  const artifactOnReloadLivePreview = useLatestOptionalCallback(onReloadLivePreview);
  const artifactOnDecideLivePreviewDevServerApproval = useLatestOptionalCallback(
    onDecideLivePreviewDevServerApproval,
  );
  const artifactOnResizeKeyDown = useLatestCallback(resizeArtifactWithKeyboard);
  const artifactOnRestoreRevisionAsDraft = useLatestOptionalCallback(onRestoreRevisionAsDraft);
  const artifactOnUndoDraft = useLatestOptionalCallback(onUndoDraft);
  const artifactOnSelectArtifactTab = useLatestCallback(openArtifactTab);
  const artifactOnCloseArtifactTab = useLatestCallback(closeArtifactTab);
  const artifactOnOpenWorkspaceTab = useLatestCallback(openSideWorkspaceTab);
  const artifactOnRequestLivePreview = useLatestOptionalCallback(onRequestLivePreview);
  const artifactOnResizeStart = useLatestCallback(startArtifactResize);
  const artifactOnSelectFile = useLatestOptionalCallback(onSelectFile);
  const artifactOnSourceOpenChange = useLatestCallback(setSourceDisclosureOpen);
  const artifactOnSelectSideWorkspaceFile = useLatestOptionalCallback(onSelectSideWorkspaceFile);
  const artifactOnStopLivePreview = useLatestOptionalCallback(onStopLivePreview);
  const artifactOnNavigateUserWeb = useLatestOptionalCallback(onNavigateUserWeb);
  const artifactOnGoBackUserWeb = useLatestOptionalCallback(onGoBackUserWeb);
  const artifactOnGoForwardUserWeb = useLatestOptionalCallback(onGoForwardUserWeb);
  const artifactOnReloadUserWeb = useLatestOptionalCallback(onReloadUserWeb);
  const artifactOnStopUserWeb = useLatestOptionalCallback(onStopUserWeb);
  const activityOnLiveOutputFrame = useLatestCallback(followVisibleLiveOutput);
  const activityOnOpenCheckCommand = useLatestCallback(openCheckCommand);
  const activityOnOpenRuntimeToolBrowser = useLatestCallback(openRuntimeToolBrowser);
  const activityOnOpenRuntimeToolCommand = useLatestCallback(openRuntimeToolCommand);
  const activityOnOpenRuntimeToolFile = useLatestCallback(openRuntimeToolFile);
  const activityOnOpenHistory = useLatestCallback(openHistoryWorkspace);
  const activityOnRefresh = useLatestOptionalCallback(onRefreshConversation);
  const activityOnReviewPlan = useLatestOptionalCallback(onReviewPlan);
  const artifactSidebar = showArtifactSidebar && activeArtifactTab !== null ? (
    <BuilderArtifactSidebar
      activeTab={activeArtifactTab}
      activeFile={activeFile}
      agentTestBrowserActive={agentTestBrowserActive}
      approvalMode={approvalMode}
      artifactTabs={openArtifactTabs}
      availableArtifactTabs={artifactTabs}
      canUndo={canUndo}
      changes={changes}
      changesOpen={activeArtifactTab === 'changes' || changesPanelOpen}
      draftCheckpointStatus={draftCheckpointStatus}
      draftCheckpointTimeline={draftCheckpointTimeline}
      checkRunProfile={checkRunProfile}
      checkRunStatus={displayedCheckRunStatus}
      currentProjectWriteApproval={currentProjectWriteApproval}
      files={files}
      hasSavedProject={saved !== null}
      hasUnsavedDraft={hasUnsavedDraft}
      history={history}
      inspectedRevisionReceiptDigest={inspected?.target.revision_receipt_digest ?? null}
      livePreviewOperation={livePreviewOperation}
      livePreviewStatus={livePreviewStatus}
      userWebOperation={userWebOperation}
      userWebStatus={userWebStatus}
      userWebSurfaceRef={userWebSurfaceRef}
      onExpandPreview={artifactOnExpandPreview}
      onApproveProviderContextDisclosure={artifactOnApproveProviderContextDisclosure}
      onCloseArtifactTab={artifactOnCloseArtifactTab}
      onInspectRevision={artifactOnInspectRevision}
      onOpenFile={artifactOnOpenFile}
      onOpenWorkspaceTab={artifactOnOpenWorkspaceTab}
      onRefreshHistory={artifactOnRefreshHistory}
      onReloadLivePreview={artifactOnReloadLivePreview}
      onDecideLivePreviewDevServerApproval={artifactOnDecideLivePreviewDevServerApproval}
      onResizeKeyDown={artifactOnResizeKeyDown}
      onResizeStart={artifactOnResizeStart}
      onRestoreRevisionAsDraft={artifactOnRestoreRevisionAsDraft}
      onUndoDraft={artifactOnUndoDraft}
      onRequestLivePreview={artifactOnRequestLivePreview}
      resizing={artifactResizing}
      commandOutput={commandOutput}
      runtimeCommand={runtimeCommand}
      onSelectArtifactTab={artifactOnSelectArtifactTab}
      onSelectFile={artifactOnSelectFile}
      onSourceOpenChange={artifactOnSourceOpenChange}
      planSourceReadApproval={planSourceReadApproval}
      providerContextDisclosureApprovalState={providerContextDisclosureApprovalState}
      providerContextDisclosureStatus={viewingHistory ? null : providerContextDisclosureStatus}
      preview={preview}
      previewPanelRef={previewExpandedVisible ? undefined : artifactPreviewRef}
      sidebarRef={artifactSidebarRef}
      sourceDisclosureOpen={sourceDisclosureOpen}
      sourceDisclosureRef={sourceDisclosureRef}
      sourceFile={sourceFile}
      sideWorkspaceFileContent={sideWorkspaceFileContent}
      sideWorkspaceFileContentStatus={sideWorkspaceFileContentStatus}
      sideWorkspaceFileTree={sideWorkspaceFileTree}
      sideWorkspaceFileTreeStatus={sideWorkspaceFileTreeStatus}
      width={artifactWidth}
      widthMaximum={artifactWidthMaximum}
      onSelectSideWorkspaceFile={artifactOnSelectSideWorkspaceFile}
      onStopLivePreview={artifactOnStopLivePreview}
      onNavigateUserWeb={artifactOnNavigateUserWeb}
      onGoBackUserWeb={artifactOnGoBackUserWeb}
      onGoForwardUserWeb={artifactOnGoForwardUserWeb}
      onReloadUserWeb={artifactOnReloadUserWeb}
      onStopUserWeb={artifactOnStopUserWeb}
      workingProject={workingProject}
    />
  ) : null;
  const expandedPreviewOverlay = previewExpandedVisible ? (
    <section
      aria-label="Expanded project preview"
      aria-modal="true"
      className="cf-builder-preview-expanded-backdrop"
      data-builder-expanded-preview="true"
      role="dialog"
    >
      <div className="cf-builder-preview-expanded-shell">
        <header className="cf-builder-preview-expanded-header">
          <div className="min-w-0">
            <p className="cf-builder-artifact-kicker">Preview</p>
            <h2 className="cf-builder-preview-expanded-title">Expanded preview</h2>
          </div>
          <button
            aria-label="Close expanded preview"
            className="cf-builder-secondary-button cf-builder-icon-button inline-flex size-9 items-center justify-center"
            data-builder-close-expanded-preview="true"
            onClick={closeExpandedPreview}
            type="button"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </header>
        <div
          className="cf-builder-preview-expanded-body"
          data-builder-expanded-preview-content="true"
          ref={expandedPreviewRef}
        >
          <BuilderResultPanel placement="expanded" projection={preview} />
        </div>
      </div>
    </section>
  ) : null;

  return (
    <div
      aria-busy={status === 'opening'}
      className="cf-builder-page bg-background text-foreground"
      data-builder-page="true"
      data-builder-project-status={status}
      data-builder-project-error={snapshot.error ?? 'none'}
      data-builder-conversation-status={conversationStatus}
      data-builder-conversation-project-id={conversationProjectId ?? 'none'}
      data-builder-conversation-item-count={conversationItemCount}
    >
      <header className="cf-builder-surface-toolbar">
        <div className="min-w-0">
          {showingAgentWorkbench ? (
            <p className="text-xs font-medium text-muted-foreground">Agent</p>
          ) : null}
          <h1 className="truncate text-base font-semibold">
            {showingAgentWorkbench ? 'Builder' : title}
          </h1>
        </div>
        <div className="cf-builder-toolbar-actions">
          {status === 'opening' ? (
            <span className="cf-builder-status-pill" data-builder-project-opening="true">
              Opening project...
            </span>
          ) : null}
          {hasUnsavedDraft ? (
            <span className="cf-builder-status-pill" data-builder-unsaved-draft="true">
              Unsaved draft
            </span>
          ) : viewingHistory ? (
            <span className="cf-builder-status-pill" data-builder-history-preview="true">
              Viewing Version {inspected.target.revision_number}
            </span>
          ) : null}
          {viewingHistory ? (
            <button
              className="cf-builder-secondary-button inline-flex min-h-9 items-center justify-center gap-2 px-3 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
              data-builder-show-current-version="true"
              disabled={busy || typeof onShowCurrentRevision !== 'function'}
              onClick={() => {
                const currentTab = showResultFlow ? 'preview' : 'versions';
                setArtifactPanelState({
                  active: currentTab,
                  openTabs: [currentTab],
                  identity: currentArtifactPanelIdentity,
                  observedCommandIdentity: commandOutputIdentity,
                });
                void onShowCurrentRevision?.();
              }}
              type="button"
            >
              <History aria-hidden="true" className="size-4" />
              Back to current
            </button>
          ) : null}
          {workspaceControls}
          {taskMonitorControl}
        </div>
      </header>

      <div className="cf-builder-surface-body">
        <section
          aria-label="Project conversation workspace"
          className="cf-builder-chat-shell"
          data-builder-artifact-sidebar-visible={showRightSidebar ? 'true' : 'false'}
          data-builder-chat-workspace="true"
          inert={status === 'opening' ? true : undefined}
          ref={chatShellRef}
          style={artifactShellStyle}
        >
          <div className="cf-builder-chat-main" data-builder-chat-main="true">
            <div
              className="cf-builder-chat-scroll"
              data-builder-chat-scroll="true"
              onKeyDownCapture={markChatKeyboardScrollIntent}
              onScroll={updateChatFollowState}
              onTouchMoveCapture={markChatReaderScrollIntent}
              onWheelCapture={markChatWheelScrollIntent}
              ref={chatScrollRef}
            >
              <div
                className="cf-builder-chat-flow-column"
                data-builder-chat-flow-column="true"
                ref={chatFlowColumnRef}
              >
                {showingAgentWorkbench ? (
                  <AgentWorkbenchPanel
                  actionsDisabled={composerSubmitLocked}
                  liveOutput={visibleLiveOutput}
                  liveOutputStore={liveOutputStore}
                  onLiveOutputFrame={followVisibleLiveOutput}
                  onRefresh={onRefreshAgentWorkbench}
                  onUpdateMessageState={onUpdateAgentWorkbenchMessageState}
                  onDecideTaskProposal={onDecideAgentTaskProposal}
                  onDecideAgentPlan={onDecideAgentPlan}
                  onReviseAgentPlan={onSelectPlanMode}
                  onCreateProjectForTaskProposal={onCreateProjectForAgentTaskProposal}
                  onOpenTaskProposal={onOpenAgentTaskProposal}
                  projectCatalogSnapshot={projectCatalogSnapshot}
                  snapshot={agentWorkbenchSnapshot}
                />
              ) : showTaskConversationSeed ? (
                <TaskConversationSeedPanel task={taskConversationSeed} />
              ) : showActivity ? (
                <ActivityPanel
                  canReviewPlan={canReviewPlan}
                  canUndoDraft={canUndo}
                  candidateChanges={changes.files}
                  checkRunProfile={checkRunProfile}
                  checkRunStatus={displayedCheckRunStatus}
                  currentDraftId={draft?.draft_id ?? null}
                  hasUnsavedDraft={hasUnsavedDraft}
                  liveOutput={visibleLiveOutput}
                  liveOutputStore={liveOutputStore}
                  onLiveOutputFrame={activityOnLiveOutputFrame}
                  onOpenCandidateChange={artifactOnOpenFile}
                  onOpenCheckCommand={activityOnOpenCheckCommand}
                  onOpenRuntimeToolBrowser={activityOnOpenRuntimeToolBrowser}
                  onOpenRuntimeToolCommand={activityOnOpenRuntimeToolCommand}
                  onOpenRuntimeToolFile={activityOnOpenRuntimeToolFile}
                  onOpenHistory={activityOnOpenHistory}
                  onRefresh={activityOnRefresh}
                  onReviewPlan={activityOnReviewPlan}
                  onUndoDraft={artifactOnUndoDraft}
                  planReviewBusy={planReviewBusy}
                  planReviewFailed={planReviewFailed}
                  planReviewRecorded={planReviewRecordedForTarget}
                  pendingUserMessages={pendingUserMessages}
                  pendingPlanReview={planReviewTarget}
                  savingVersion={status === 'saving'}
                  snapshot={activity}
                />
                ) : null}
                {planSourceReadApprovalCard}
                {currentProjectWriteApprovalCard}
                {commandApprovalCard}
                {dependencyPreparationCard}
                {projectEnvironmentSetupCard}

                {conversationNotice}
                <div
                  aria-hidden="true"
                  className="cf-builder-chat-tail"
                  data-builder-chat-tail="true"
                  ref={chatTailRef}
                />
              </div>
            </div>

            {composer}
          </div>

          {showTaskMonitor ? (
            <AgentTaskMonitorPanel
              actionsDisabled={composerSubmitLocked}
              onCollapse={() => setTaskMonitorCollapsed(true)}
              onArchiveTask={onArchiveAgentTask}
              onControlTask={onControlAgentTask}
              onOpenTask={onOpenAgentTaskProposal}
              onRenameTask={onRenameAgentTask}
              projectCatalogSnapshot={projectCatalogSnapshot}
              snapshot={agentWorkbenchSnapshot}
            />
          ) : artifactSidebar}
        </section>
      </div>
      {expandedPreviewOverlay}
    </div>
  );
}
