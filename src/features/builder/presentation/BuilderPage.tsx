import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type Ref,
} from 'react';
import {
  AlertCircle,
  Bot,
  ChevronDown,
  CheckCircle2,
  Eye,
  FileCode2,
  FolderOpen,
  GitCompareArrows,
  History,
  ListChecks,
  LockKeyhole,
  Menu,
  Minimize2,
  PanelRightClose,
  PanelRightOpen,
  Play,
  Plus,
  RefreshCw,
  ShieldCheck,
  StopCircle,
  UserRound,
  X,
} from 'lucide-react';

import {
  isTrustedBuilderConversationControllerSnapshot,
  type BuilderConversationControllerSnapshot,
} from '../application/builderConversationController';
import {
  isTrustedBuilderProjectControllerSnapshot,
  type BuilderProjectControllerSnapshot,
  type BuilderProjectControllerStatus,
} from '../application/builderProjectController';
import {
  BUILDER_GENERATION_DIAGNOSTIC_RETRYABILITY,
  type BuilderCheckRunProfile,
  type BuilderCheckRunStatusProjection,
  type BuilderLivePreviewStatusProjection,
  type BuilderPlanReviewDecision,
  type BuilderPlanReviewRequest,
  type BuilderSideWorkspaceFileContentProjection,
  type BuilderSideWorkspaceFileRef,
  type BuilderSideWorkspaceFileTreeEntry,
  type BuilderSideWorkspaceFileTreeProjection,
} from '../application/builderPorts';
import type { BuilderComposerRouteDecision } from '../application/builderComposerIntent';
import {
  isTrustedBuilderProjectHistorySnapshot,
  type BuilderProjectHistorySnapshot,
} from '../application/builderProjectHistoryController';
import {
  isTrustedBuilderProjectCatalogSnapshot,
  type BuilderProjectCatalogSnapshot,
} from '../application/builderProjectCatalogController';
import type {
  BuilderConversationItem,
  BuilderConversationRunProgressStage,
} from '../domain/builderConversationSnapshot';
import type { BuilderAgentActivityProjectionWire } from '../domain/builderAgentActivityProjection';
import type { BuilderCheckRunOutcomeProjectionWire } from '../domain/builderCheckRunOutcomeProjection';
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
import { BuilderChangesPanel } from './BuilderChangesPanel';
import {
  BuilderComposer,
  type BuilderComposerApprovalMode,
  type BuilderComposerContextStatus,
  type BuilderComposerMode,
} from './BuilderComposer';
import { BuilderReviewCheckpoint } from './BuilderReviewCheckpoint';
import { BuilderResultPanel } from './BuilderResultPanel';
import { BuilderSourceDisclosure } from './BuilderSourceDisclosure';
import { builderChangesSummary, builderReviewPreviewStatus } from './builderReviewText';

export type BuilderFileName = string;

export type BuilderLiveOutputSnapshot = Readonly<{
  state: 'streaming';
  request_id: string;
  project_id: string;
  text: string;
  chunk_count: number;
  waiting_text?: string;
}>;

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

export type BuilderPageProps = {
  activeRunFollowupQueued?: boolean;
  approvalMode?: BuilderComposerApprovalMode;
  checkRunOperation?: 'loading' | 'running' | 'skipping' | 'failed' | null;
  checkRunProfiles?: readonly BuilderCheckRunProfile[];
  checkRunStatus?: BuilderCheckRunStatusProjection | null;
  instruction: string;
  composerRouteDecision?: BuilderComposerRouteDecision | null;
  composerContextStatus?: BuilderComposerContextStatus;
  providerContextDisclosureStatus?: BuilderProviderContextDisclosureStatusProjectionWire | null;
  providerContextDisclosureApprovalState?: 'idle' | 'approving' | 'failed';
  composerMode?: BuilderComposerMode | null;
  composerSubmitLocked?: boolean;
  liveOutput?: BuilderLiveOutputSnapshot | null;
  livePreviewOperation?: 'starting' | 'reloading' | 'stopping' | null;
  livePreviewStatus?: BuilderLivePreviewStatusProjection | null;
  sideWorkspaceFileContent?: BuilderSideWorkspaceFileContentProjection | null;
  sideWorkspaceFileContentStatus?: 'idle' | 'loading' | 'ready' | 'failed';
  sideWorkspaceFileTree?: BuilderSideWorkspaceFileTreeProjection | null;
  sideWorkspaceFileTreeStatus?: 'idle' | 'loading' | 'ready' | 'failed';
  approvedPlanContinuationFailure?: BuilderPlanReviewInFlight | null;
  answerFailureRecordedSuccess?: boolean;
  planReviewFailure?: BuilderPlanReviewInFlight | null;
  planReviewInFlight?: BuilderPlanReviewInFlight | null;
  planReviewRecorded?: BuilderPlanReviewInFlight | null;
  planSourceReadApproval?: BuilderPlanSourceReadApprovalPrompt | null;
  currentProjectWriteApproval?: BuilderCurrentProjectWriteApprovalPrompt | null;
  workspacePickerRequest?: number;
  workspaceNewProjectRequest?: number;
  onInstructionChange?: (value: string) => void;
  onApprovePlanSourceRead?: () => Promise<unknown> | void;
  onApproveCurrentProjectWrite?: () => Promise<unknown> | void;
  onApproveProviderContextDisclosure?: () => Promise<unknown> | void;
  onCancel?: () => void;
  onCreateProject?: (projectTitle: string) => Promise<unknown> | void;
  onClearWorkspaceSelection?: () => void;
  onDismissWorkspacePicker?: () => void;
  onDismissPlanSourceReadApproval?: () => void;
  onDismissCurrentProjectWriteApproval?: () => void;
  onSelectApprovalMode?: (mode: BuilderComposerApprovalMode) => Promise<unknown> | void;
  onSelectComposerMode?: (mode: BuilderComposerMode) => void;
  onSelectPlanMode?: () => void;
  onClearComposerMode?: () => void;
  onSubmitInstruction?: () => void;
  onRetryGenerate?: () => void;
  onRefreshConversation?: () => Promise<unknown> | void;
  onRefreshHistory?: () => Promise<unknown> | void;
  onRejectDraft?: () => void;
  onReloadLivePreview?: () => Promise<unknown> | void;
  onReviewPlan?: (request: BuilderPlanReviewRequest) => Promise<unknown> | void;
  onRequestLivePreview?: () => Promise<unknown> | void;
  onRequestSideWorkspaceFiles?: () => Promise<unknown> | void;
  onSave?: () => void;
  onSelectSideWorkspaceFile?: (fileRef: BuilderSideWorkspaceFileRef) => Promise<unknown> | void;
  onStopLivePreview?: () => Promise<unknown> | void;
  onInspectRevision?: (projectId: string, revisionReceiptDigest: string) => Promise<unknown> | void;
  onOpenProjectLocation?: (projectId: string) => Promise<unknown> | void;
  onOpenProject?: (projectId: string) => Promise<unknown> | void;
  onRestoreRevisionAsDraft?: (projectId: string, revisionReceiptDigest: string) => Promise<unknown> | void;
  onShowCurrentRevision?: () => Promise<unknown> | void;
  onOpenSettings?: () => void;
  conversationSnapshot?: BuilderConversationControllerSnapshot;
  projectCatalogSnapshot?: BuilderProjectCatalogSnapshot;
  historySnapshot?: BuilderProjectHistorySnapshot;
  snapshot: BuilderProjectControllerSnapshot;
  activeFile: BuilderFileName | null;
  onSelectFile?: (file: BuilderFileName) => void;
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
const ARTIFACT_DEFAULT_WIDTH_PX = 480;
const ARTIFACT_MIN_WIDTH_PX = 360;
const ARTIFACT_MAX_WIDTH_PX = 760;
const ARTIFACT_MIN_CHAT_WIDTH_PX = 360;
const ARTIFACT_KEYBOARD_STEP_PX = 24;
const ARTIFACT_KEYBOARD_LARGE_STEP_PX = 80;
type BuilderArtifactTab = 'changes' | 'logs' | 'permissions' | 'preview' | 'source' | 'versions';
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

function activityEntries(snapshot: BuilderConversationControllerSnapshot | null): readonly ActivityEntry[] {
  const entries: ActivityEntry[] = [];
  const completedRuns = new Set<string>();
  const progressStagesByRun = new Map<string, BuilderConversationRunProgressStage[]>();
  const workEntries = new Map<string, ActivityWorkStatusEntry>();
  const toolRequestEntries = new Map<string, ActivityItemEntry>();
  const agentStepEntries = new Map<string, ActivityItemEntry>();
  for (const item of activityItems(snapshot)) {
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
      const progressStages = progressStagesByRun.get(key) ?? [];
      if (progressStages.at(-1) !== item.stage) {
        progressStages.push(item.stage);
        progressStagesByRun.set(key, progressStages);
      }
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
    if (item.item_kind === 'run_context_snapshot_recorded') {
      continue;
    }
    if (item.item_kind === 'tool_call_requested') {
      const entry: ActivityItemEntry = {
        entry_kind: 'item',
        item,
        hidden: false,
      };
      toolRequestEntries.set(`${item.turn_id}:${item.run_id}:${item.tool_call_id}`, entry);
      entries.push(entry);
      continue;
    }
    if (item.item_kind === 'tool_call_result_recorded') {
      const toolRequestEntry = toolRequestEntries.get(`${item.turn_id}:${item.run_id}:${item.tool_call_id}`);
      if (toolRequestEntry !== undefined) toolRequestEntry.hidden = true;
      entries.push({ entry_kind: 'item', item, hidden: false });
      continue;
    }
    if (item.item_kind === 'agent_step_progress_recorded') {
      const key = `${item.turn_id}:${item.run_id}:${item.step_id}`;
      if (item.recorded_state === 'start_recorded') {
        const entry: ActivityItemEntry = {
          entry_kind: 'item',
          item,
          hidden: false,
        };
        agentStepEntries.set(key, entry);
        entries.push(entry);
      } else {
        const startEntry = agentStepEntries.get(key);
        if (startEntry !== undefined) startEntry.hidden = true;
        entries.push({ entry_kind: 'item', item, hidden: false });
      }
      continue;
    }
    if (item.item_kind === 'run_completed') {
      const key = `${item.turn_id}:${item.run_id}`;
      completedRuns.add(key);
      const workEntry = workEntries.get(key);
      if (workEntry !== undefined) workEntry.hidden = true;
      entries.push({
        entry_kind: 'item',
        item,
        progressStages: progressStagesByRun.get(key) ?? [],
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
    entries.push({ entry_kind: 'item', item, hidden: false });
  }
  return entries.filter((entry) => !entry.hidden);
}

function isArtifactLogItem(item: BuilderConversationItem): boolean {
  if (
    item.item_kind === 'run_control_requested'
    || item.item_kind === 'run_context_snapshot_recorded'
    || item.item_kind === 'task_brief_updated'
    || item.item_kind === 'tool_call_requested'
    || item.item_kind === 'tool_call_result_recorded'
    || item.item_kind === 'agent_step_progress_recorded'
    || item.item_kind === 'candidate_reviewed'
    || item.item_kind === 'plan_reviewed'
  ) return true;
  if (item.item_kind === 'run_completed') {
    return item.terminal_status !== 'succeeded' || item.result_kind !== 'explanation';
  }
  return false;
}

function artifactWorkStatusEntry(
  item: Extract<BuilderConversationItem, { item_kind: 'run_started' | 'run_progress_recorded' }>,
): ActivityWorkStatusEntry {
  return {
    entry_kind: 'work_status',
    key: `${item.turn_id}:${item.run_id}:${item.sequence}`,
    sequence: item.sequence,
    turnId: item.turn_id,
    runId: item.run_id,
    status: item.item_kind === 'run_started' ? 'started' : item.stage,
    hidden: false,
  };
}

function artifactLogEntries(snapshot: BuilderConversationControllerSnapshot | null): readonly ActivityEntry[] {
  const entries: ActivityEntry[] = [];
  const toolRequestEntries = new Map<string, ActivityItemEntry>();
  const agentStepEntries = new Map<string, ActivityItemEntry>();
  for (const item of activityItems(snapshot)) {
    if (item.item_kind === 'run_started' || item.item_kind === 'run_progress_recorded') {
      entries.push(artifactWorkStatusEntry(item));
      continue;
    }
    if (item.item_kind === 'tool_call_requested') {
      const entry: ActivityItemEntry = { entry_kind: 'item', item, hidden: false };
      toolRequestEntries.set(`${item.turn_id}:${item.run_id}:${item.tool_call_id}`, entry);
      entries.push(entry);
      continue;
    }
    if (item.item_kind === 'tool_call_result_recorded') {
      const toolRequestEntry = toolRequestEntries.get(`${item.turn_id}:${item.run_id}:${item.tool_call_id}`);
      if (toolRequestEntry !== undefined) toolRequestEntry.hidden = true;
      entries.push({ entry_kind: 'item', item, hidden: false });
      continue;
    }
    if (item.item_kind === 'agent_step_progress_recorded') {
      const key = `${item.turn_id}:${item.run_id}:${item.step_id}`;
      if (item.recorded_state === 'start_recorded') {
        const entry: ActivityItemEntry = { entry_kind: 'item', item, hidden: false };
        agentStepEntries.set(key, entry);
        entries.push(entry);
      } else {
        const startEntry = agentStepEntries.get(key);
        if (startEntry !== undefined) startEntry.hidden = true;
        entries.push({ entry_kind: 'item', item, hidden: false });
      }
      continue;
    }
    if (isArtifactLogItem(item)) {
      entries.push({ entry_kind: 'item', item, hidden: false });
    }
  }
  return entries.filter((entry) => !entry.hidden).sort((left, right) => {
    const leftSequence = left.entry_kind === 'work_status' ? left.sequence : left.item.sequence;
    const rightSequence = right.entry_kind === 'work_status' ? right.sequence : right.item.sequence;
    return leftSequence - rightSequence;
  });
}

function latestTaskBriefItem(
  snapshot: BuilderConversationControllerSnapshot | null,
): Extract<BuilderConversationItem, { item_kind: 'task_brief_updated' }> | null {
  const items = activityItems(snapshot);
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item.item_kind === 'task_brief_updated') return item;
  }
  return null;
}

function isNearChatBottom(element: HTMLElement): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= CHAT_FOLLOW_BOTTOM_THRESHOLD_PX;
}

function usableRect(box: DOMRect): boolean {
  return Number.isFinite(box.top)
    && Number.isFinite(box.bottom)
    && Number.isFinite(box.height)
    && box.height > 0;
}

function scrollElementRangeIntoChatView(
  scroll: HTMLElement | null,
  startTarget: HTMLElement,
  endTarget: HTMLElement = startTarget,
): void {
  if (scroll !== null) {
    const scrollBox = scroll.getBoundingClientRect();
    const startBox = startTarget.getBoundingClientRect();
    const rawEndBox = endTarget.getBoundingClientRect();
    const endBox = usableRect(rawEndBox) ? rawEndBox : startBox;
    if (
      Number.isFinite(scrollBox.top)
      && Number.isFinite(scrollBox.bottom)
      && Number.isFinite(scrollBox.height)
      && scrollBox.height > 0
      && usableRect(startBox)
    ) {
      let delta = startBox.top - scrollBox.top - 12;
      const bottomAfterStartScroll = endBox.bottom - delta;
      const bottomLimit = scrollBox.bottom - 12;
      if (bottomAfterStartScroll > bottomLimit) {
        delta += bottomAfterStartScroll - bottomLimit;
      }
      scroll.scrollTop += delta;
      return;
    }
  }
  startTarget.scrollIntoView?.({ block: 'start' });
}

function planReviewKey(turnId: string, runId: string): string {
  return `${turnId}:${runId}`;
}

function pendingPlanReviewTarget(
  snapshot: BuilderConversationControllerSnapshot | null,
): BuilderPlanReviewRequest | null {
  const conversation = snapshot?.conversation;
  if (conversation?.state !== 'ready') return null;
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

function activityMessage(
  snapshot: BuilderConversationControllerSnapshot | null,
): string | null {
  if (snapshot === null || snapshot.status === 'idle') return null;
  if (snapshot.status === 'loading') return 'Loading activity...';
  if (snapshot.status === 'unavailable') return 'Activity is unavailable.';
  if (snapshot.status === 'stale') return 'Activity could not be refreshed.';
  if (snapshot.conversation?.state === 'absent') return null;
  return null;
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

function versionHistoryMessage(
  snapshot: BuilderProjectHistorySnapshot | null,
  hasSavedProject: boolean,
): string | null {
  if (!hasSavedProject) return 'Save a version to see history.';
  if (snapshot === null || snapshot.status === 'idle') return 'Loading versions...';
  if (snapshot.status === 'loading') return 'Loading versions...';
  if (snapshot.status === 'unavailable') return 'Versions are unavailable.';
  if (snapshot.status === 'stale') return 'Versions could not be refreshed.';
  return null;
}

function outcomeLabel(
  outcome: Extract<BuilderConversationItem, { item_kind: 'turn_completed' }>['outcome'],
): string {
  if (outcome === 'answered') return 'Answered';
  if (outcome === 'candidate_ready') return 'Draft ready';
  if (outcome === 'plan_proposed') return 'Plan ready';
  if (outcome === 'failed') return 'Could not finish';
  if (outcome === 'interrupted') return 'Interrupted';
  if (outcome === 'cancelled') return 'Stopped';
  return 'Responded';
}

function completionLabel(item: Extract<BuilderConversationItem, { item_kind: 'run_completed' }>): string {
  if (item.terminal_status === 'failed') return 'Could not finish';
  if (item.terminal_status === 'interrupted') return 'Interrupted';
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
  item: BuilderConversationItem;
  progressStages?: readonly BuilderConversationRunProgressStage[];
  hidden: boolean;
};

type ActivityEntry =
  | ActivityItemEntry
  | ActivityWorkStatusEntry;

function shouldShowLiveOutput(
  liveOutput: BuilderLiveOutputSnapshot | null,
  entries: readonly ActivityEntry[],
): liveOutput is BuilderLiveOutputSnapshot {
  if (liveOutput === null) return false;
  if (liveOutput.text.length > 0) return true;
  if (liveOutput.waiting_text !== undefined) return true;
  return !entries.some((entry) => entry.entry_kind === 'work_status');
}

function workStatusBody(status: ActivityWorkStatus): string {
  if (status === 'started') return 'Preparing this request.';
  if (status === 'context_ready') return 'Reading the current project context.';
  if (status === 'provider_request_started') return 'Writing the response.';
  if (status === 'provider_response_received') return 'Checking the response.';
  return 'Preparing the result for review.';
}

function progressStepLabel(stage: BuilderConversationRunProgressStage): string {
  if (stage === 'context_ready') return 'Read the current project context.';
  if (stage === 'provider_request_started') return 'Wrote the response.';
  if (stage === 'provider_response_received') return 'Checked the response.';
  return 'Prepared the result for review.';
}

function ActivityGlyph({ item }: Readonly<{ item: BuilderConversationItem }>) {
  if (item.item_kind === 'user_message') return <UserRound className="size-3.5" />;
  if (item.item_kind === 'queued_followup_consumed') return <CheckCircle2 className="size-3.5" />;
  if (item.item_kind === 'run_started') return <Play className="size-3.5" />;
  if (item.item_kind === 'run_context_snapshot_recorded') return <ListChecks className="size-3.5" />;
  if (item.item_kind === 'run_progress_recorded') return <RefreshCw className="size-3.5" />;
  if (item.item_kind === 'run_control_requested') return <StopCircle className="size-3.5" />;
  if (item.item_kind === 'task_brief_updated') return <ListChecks className="size-3.5" />;
  if (item.item_kind === 'agent_step_progress_recorded') {
    if (item.recorded_state === 'start_recorded') return <RefreshCw className="size-3.5" />;
    if (item.result?.status === 'succeeded') return <CheckCircle2 className="size-3.5" />;
    if (item.result?.status === 'cancelled') return <StopCircle className="size-3.5" />;
    return <AlertCircle className="size-3.5" />;
  }
  if (item.item_kind === 'tool_call_requested') return <Play className="size-3.5" />;
  if (item.item_kind === 'tool_call_result_recorded') {
    if (item.result.status === 'succeeded') return <CheckCircle2 className="size-3.5" />;
    if (item.result.status === 'cancelled') return <StopCircle className="size-3.5" />;
    return <AlertCircle className="size-3.5" />;
  }
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
  if (item.item_kind === 'run_completed' && item.terminal_status !== 'succeeded') {
    return <AlertCircle className="size-3.5" />;
  }
  if (item.item_kind === 'run_completed') return <Bot className="size-3.5" />;
  return <CheckCircle2 className="size-3.5" />;
}

function activityTitle(item: BuilderConversationItem): string {
  if (item.item_kind === 'user_message') {
    if (item.message_kind === 'steering') return 'You added context';
    if (item.message_kind === 'queued_followup') return 'You queued a follow-up';
    return 'You';
  }
  if (item.item_kind === 'queued_followup_consumed') return 'Follow-up picked up';
  if (item.item_kind === 'run_started') return 'Assistant is working';
  if (item.item_kind === 'run_context_snapshot_recorded') return 'Why this ran';
  if (item.item_kind === 'programming_run_admitted') return 'Execution approved';
  if (item.item_kind === 'run_progress_recorded') return progressLabel(item);
  if (item.item_kind === 'run_control_requested') {
    return item.action === 'interrupt' ? 'Interrupt requested' : 'Stop requested';
  }
  if (item.item_kind === 'task_brief_updated') return 'Direction updated';
  if (item.item_kind === 'agent_step_progress_recorded') return agentStepTitle(item);
  if (item.item_kind === 'tool_call_requested') return toolRequestTitle(item);
  if (item.item_kind === 'tool_call_result_recorded') return toolResultTitle(item);
  if (item.item_kind === 'candidate_reviewed') {
    return item.decision === 'accepted' ? 'Version saved' : 'Draft rejected';
  }
  if (item.item_kind === 'plan_reviewed') {
    return item.decision === 'approved' ? 'Plan approved' : 'Plan rejected';
  }
  if (item.item_kind === 'run_completed') return completionLabel(item);
  return outcomeLabel(item.outcome);
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
  if (item.item_kind === 'task_brief_updated') return item.brief.summary;
  if (item.item_kind === 'agent_step_progress_recorded') return agentStepBody(item);
  if (item.item_kind === 'tool_call_requested') return toolRequestBody(item);
  if (item.item_kind === 'tool_call_result_recorded') return toolResultBody(item);
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
    return item.assistant_message?.text
      ?? (item.terminal_status === 'succeeded'
        ? 'The assistant finished this step.'
        : 'The request did not finish.');
  }
  return `${outcomeLabel(item.outcome)}.`;
}

type ActivityCompletionSummary = Readonly<{
  happened: string;
  changed: string;
  next: string;
}>;

function failedCompletionSummary(
  item: Extract<BuilderConversationItem, { item_kind: 'run_completed' }>,
): ActivityCompletionSummary {
  if (item.failure_phase === 'provider_request_started') {
    return {
      happened: 'The AI request started but did not return a usable result.',
      changed: 'No version was saved by this result.',
      next: 'Check your network or proxy, then retry. If the service rejects the request, check the AI settings.',
    };
  }
  if (
    item.failure_phase === 'provider_response_received'
    || item.failure_phase === 'result_preparing'
  ) {
    return {
      happened: 'The AI response arrived but could not be prepared for review.',
      changed: 'No version was saved by this result.',
      next: 'Try again with a smaller request or continue with a clearer follow-up.',
    };
  }
  if (item.failure_phase === 'context_ready') {
    return {
      happened: 'Builder prepared the project context, but the request did not finish.',
      changed: 'No version was saved by this result.',
      next: 'Try again or adjust the request before continuing.',
    };
  }
  return {
    happened: 'The request could not finish.',
    changed: 'No version was saved by this result.',
    next: 'Try again or adjust the request before continuing.',
  };
}

function completionSummary(
  item: Extract<BuilderConversationItem, { item_kind: 'run_completed' }>,
  hasUnsavedDraft: boolean,
): ActivityCompletionSummary {
  if (item.terminal_status === 'failed') {
    return failedCompletionSummary(item);
  }
  if (item.terminal_status === 'interrupted') {
    return {
      happened: 'The work was interrupted.',
      changed: 'No version was saved by this result.',
      next: 'Send a follow-up with the change in direction.',
    };
  }
  if (item.terminal_status === 'cancelled') {
    return {
      happened: 'The work was stopped.',
      changed: 'No version was saved by this result.',
      next: 'Start again when you are ready.',
    };
  }
  if (item.result_kind === 'candidate' && item.candidate !== null) {
    return {
      happened: 'A draft is ready for review.',
      changed: item.candidate.summary,
      next: hasUnsavedDraft
        ? 'Review the workspace, then save a version if it looks right.'
        : 'Review the available result before deciding what to do next.',
    };
  }
  if (item.result_kind === 'plan') {
    return {
      happened: 'A plan is ready for review.',
      changed: 'The project files have not changed.',
      next: 'Approve the plan to continue, or reject it to keep discussing.',
    };
  }
  return {
    happened: 'The assistant answered.',
    changed: 'No files were changed.',
    next: 'Ask a follow-up or describe the next change.',
  };
}

function activityDisplayRole(item: BuilderConversationItem): 'assistant' | 'status' | 'user' {
  if (item.item_kind === 'user_message') return 'user';
  if (item.item_kind === 'run_completed' && item.assistant_message !== null) return 'assistant';
  return 'status';
}

function candidateAvailabilityNote(hasUnsavedDraft: boolean): string {
  return hasUnsavedDraft
    ? 'The review workspace is ready before saving this version.'
    : 'Activity shows this draft summary only. Review appears only after Builder verifies and restores the files.';
}

function failedStatusMessage(
  status: BuilderProjectControllerStatus,
  error: BuilderProjectControllerSnapshot['error'],
): string {
  if (status === 'answer_failed') {
    if (error === 'builder_generation_provider_unavailable') return 'AI is not configured yet.';
    if (error === 'builder_generation_timeout') return 'Answering took too long. Try again.';
    if (error === 'builder_generation_provider_http_error') return 'The AI service rejected the request. Check the API key, model, or account.';
    if (error === 'builder_generation_provider_transport_error') return 'The AI service could not be reached. Check your network or proxy, then retry.';
    return 'The answer could not be prepared. Try again.';
  }
  if (status === 'submit_failed') {
    if (error === 'builder_generation_project_workspace_required') return 'Choose or open a project folder before I build.';
    if (error === 'builder_generation_project_write_permission_required') return 'Allow current project changes before I build.';
    if (error === 'builder_generation_workspace_changed') return 'The project changed while I was working. Review it, then retry.';
    if (error === 'builder_generation_workspace_guard_denied') return 'I blocked these file changes to protect the project.';
    if (error === 'builder_generation_workspace_guard_approval_required') return 'These file changes need additional approval before I can continue.';
    if (error === 'builder_generation_provider_unavailable') return 'AI is not configured yet.';
    if (error === 'builder_generation_timeout') return 'Working on this request took too long. Try again.';
    if (error === 'builder_generation_provider_http_error') return 'The AI service rejected the request. Check the API key, model, or account.';
    if (error === 'builder_generation_provider_transport_error') return 'The AI service could not be reached. Check your network or proxy, then retry.';
    if (error === 'builder_generation_static_preview_contract_rejected') return 'This result needs Browser preview support. Your current draft was kept.';
    return 'This request could not be completed. Try again.';
  }
  if (error === 'builder_generation_project_workspace_required') return 'Choose or open a project folder before I make a draft.';
  if (error === 'builder_generation_project_write_permission_required') return 'Allow current project changes before I make a draft.';
  if (error === 'builder_generation_workspace_changed') return 'The project changed while I was working. Review it, then retry.';
  if (error === 'builder_generation_workspace_guard_denied') return 'I blocked these file changes to protect the project.';
  if (error === 'builder_generation_workspace_guard_approval_required') return 'These file changes need additional approval before I can continue.';
  if (error === 'builder_generation_provider_unavailable') return 'AI generation is not configured yet.';
  if (error === 'builder_generation_timeout') return 'Making this draft took too long. Try again.';
  if (error === 'builder_generation_provider_http_error') return 'The AI service rejected the request. Check the API key, model, or account.';
  if (error === 'builder_generation_provider_transport_error') return 'The AI service could not be reached. Check your network or proxy, then retry.';
  if (error === 'builder_generation_static_preview_contract_rejected') return 'This result needs Browser preview support. Your current draft was kept.';
  if (error === 'builder_generation_structured_response_invalid') return 'The draft could not be prepared. Try again.';
  return 'The draft could not be made. Try again.';
}

function approvedPlanContinuationFailureMessage(
  error: BuilderProjectControllerSnapshot['error'],
): string {
  if (error === 'builder_generation_provider_unavailable') {
    return 'The plan was approved, but AI generation is not configured yet.';
  }
  if (error === 'builder_generation_timeout') {
    return 'The plan was approved, but making the draft took too long. Retry to continue from that plan.';
  }
  return 'The plan was approved, but the draft could not be created. Retry to continue from that plan.';
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
  hasSavedProject,
  inspectedRevisionReceiptDigest,
  onInspectRevision,
  onRefresh,
  onRestoreRevisionAsDraft,
  snapshot,
}: Readonly<{
  hasSavedProject: boolean;
  inspectedRevisionReceiptDigest: string | null;
  onInspectRevision?: (projectId: string, revisionReceiptDigest: string) => Promise<unknown> | void;
  onRefresh?: () => Promise<unknown> | void;
  onRestoreRevisionAsDraft?: (projectId: string, revisionReceiptDigest: string) => Promise<unknown> | void;
  snapshot: BuilderProjectHistorySnapshot | null;
}>) {
  const revisions = snapshot?.history?.revisions ?? [];
  const message = versionHistoryMessage(snapshot, hasSavedProject);
  const canRefresh = hasSavedProject
    && snapshot !== null
    && snapshot.project_id !== null
    && !snapshot.busy
    && typeof onRefresh === 'function';
  return (
    <aside
      aria-label="Project versions"
      className="cf-builder-version-panel"
      data-builder-version-history="true"
      data-builder-version-history-status={snapshot?.status ?? 'idle'}
    >
      <header className="cf-builder-side-header">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">Versions</p>
          <h3 className="truncate text-sm font-semibold">Saved history</h3>
        </div>
        <button
          aria-label="Refresh versions"
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
          <p className="cf-builder-version-status" role="status">Refreshing versions...</p>
        ) : null}
        {revisions.length === 0 ? (
          <div className="cf-builder-empty cf-builder-version-empty flex min-h-24 items-center justify-center border border-dashed px-3 text-center text-sm">
            {message ?? 'No saved versions yet.'}
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
  canReviewPlan,
  hasUnsavedDraft,
  item,
  onReviewPlan,
  planReviewBusy,
  planReviewFailed,
  planReviewRecorded,
  pendingPlanReview,
  progressStages = [],
}: Readonly<{
  canReviewPlan: boolean;
  hasUnsavedDraft: boolean;
  item: BuilderConversationItem;
  onReviewPlan?: (request: BuilderPlanReviewRequest) => Promise<unknown> | void;
  planReviewBusy: boolean;
  planReviewFailed: boolean;
  planReviewRecorded: boolean;
  pendingPlanReview: BuilderPlanReviewRequest | null;
  progressStages?: readonly BuilderConversationRunProgressStage[];
}>) {
  const displayRole = activityDisplayRole(item);
  const title = activityTitle(item);
  const messageSurface = displayRole === 'user'
    ? 'bubble'
    : displayRole === 'assistant'
      ? 'plain'
      : 'status';
  const showTitle = !(displayRole === 'user' && title === 'You');
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
      className="cf-builder-activity-item"
      data-builder-activity-card={title}
      data-builder-activity-role={displayRole}
      data-builder-tool-activity={item.item_kind === 'tool_call_requested'
        ? 'requested'
        : item.item_kind === 'tool_call_result_recorded'
          ? item.result.status
          : undefined}
      data-builder-agent-step-progress={item.item_kind === 'agent_step_progress_recorded'
        ? item.recorded_state
        : undefined}
    >
      <div className="cf-builder-activity-icon" aria-hidden="true">
        <ActivityGlyph item={item} />
      </div>
      <div
        className="cf-builder-activity-content min-w-0"
        data-builder-message-surface={messageSurface}
      >
        {showTitle ? (
          <div className="cf-builder-activity-title">{title}</div>
        ) : null}
        <p className="cf-builder-activity-body">{activityBody(item)}</p>
        {item.item_kind === 'run_completed' && (
          item.terminal_status !== 'succeeded' || item.result_kind !== 'explanation'
        ) ? (
          <ActivityCompletionSummaryView
            hasUnsavedDraft={hasUnsavedDraft}
            item={item}
            progressStages={progressStages}
          />
        ) : null}
        {item.item_kind === 'run_completed' && item.candidate !== null ? (
          <>
            <p className="cf-builder-activity-note">
              {item.candidate.title}: {item.candidate.summary}
            </p>
            <p className="cf-builder-activity-note">
              {candidateAvailabilityNote(hasUnsavedDraft)}
            </p>
          </>
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
            <p className="cf-builder-activity-note" role={planReviewFailed ? 'alert' : undefined}>
              {planReviewBusy
                ? 'Recording your decision...'
                : planReviewRecorded
                  ? 'Decision recorded. Updating the conversation...'
                  : planReviewFailed
                    ? 'That decision could not be recorded. Try again.'
                    : 'Approve this plan to let the assistant continue. Reject it to keep the project unchanged.'}
            </p>
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
      </div>
    </li>
  );
}

function ActivityLiveOutputItem({
  liveOutput,
}: Readonly<{
  liveOutput: BuilderLiveOutputSnapshot;
}>) {
  const hasText = liveOutput.text.length > 0;
  const waitingText = liveOutput.waiting_text ?? "I'm working on this...";
  return (
    <li
      className="cf-builder-activity-item"
      data-builder-activity-card="Assistant live output"
      data-builder-activity-role="assistant"
      data-builder-live-output="true"
      data-builder-live-output-state={hasText ? 'text' : 'waiting'}
    >
      <div className="cf-builder-activity-icon" aria-hidden="true">
        <Bot className="size-3.5" />
      </div>
      <div
        className="cf-builder-activity-content min-w-0"
        data-builder-message-surface="plain"
      >
        <div className="cf-builder-activity-title">Assistant</div>
        <p className="cf-builder-activity-body">
          {hasText ? liveOutput.text : waitingText}
          <span className="cf-builder-live-output-cursor" aria-hidden="true" />
        </p>
      </div>
    </li>
  );
}

function ActivityWorkStatusItem({
  entry,
  projection,
}: Readonly<{
  entry: ActivityWorkStatusEntry;
  projection: BuilderAgentActivityProjectionWire | null;
}>) {
  const current = projection?.current.turn_id === entry.turnId
    && projection.current.run_id === entry.runId
    ? projection.current
    : null;
  return (
    <li
      className="cf-builder-activity-item"
      data-builder-activity-card="Assistant working"
      data-builder-activity-role="status"
      data-builder-work-status="true"
      data-builder-work-phase={current?.phase}
      data-builder-work-status-stage={entry.status}
    >
      <div className="cf-builder-activity-icon" aria-hidden="true">
        <RefreshCw className="size-3.5" />
      </div>
      <div
        className="cf-builder-activity-content min-w-0"
        data-builder-message-surface="status"
      >
        <div className="cf-builder-activity-title">{current?.label ?? 'Assistant is working'}</div>
        <p className="cf-builder-activity-body">{current?.summary ?? workStatusBody(entry.status)}</p>
      </div>
    </li>
  );
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
        <RefreshCw className="size-3.5" />
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
        <RefreshCw className="size-3.5" />
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
  if (projection?.current.phase !== 'running_checks' || projection.current.status !== 'active') return null;
  const alreadyShown = entries.some((entry) => (
    entry.entry_kind === 'work_status'
    && entry.turnId === projection.current.turn_id
    && entry.runId === projection.current.run_id
  ));
  return alreadyShown ? null : projection;
}

function ActivityCompletionSummaryView({
  hasUnsavedDraft,
  item,
  progressStages,
}: Readonly<{
  hasUnsavedDraft: boolean;
  item: Extract<BuilderConversationItem, { item_kind: 'run_completed' }>;
  progressStages: readonly BuilderConversationRunProgressStage[];
}>) {
  const summary = completionSummary(item, hasUnsavedDraft);
  const result = item.terminal_status === 'succeeded' ? item.result_kind : item.terminal_status;
  return (
    <dl
      className="cf-builder-completion-summary"
      data-builder-completion-result={result}
      data-builder-completion-summary="true"
    >
      <div>
        <dt>What happened</dt>
        <dd>{summary.happened}</dd>
      </div>
      <div>
        <dt>Changed</dt>
        <dd>{summary.changed}</dd>
      </div>
      <div>
        <dt>Next</dt>
        <dd>{summary.next}</dd>
      </div>
      {progressStages.length > 0 ? (
        <div data-builder-completion-steps="true">
          <dt>Recorded steps</dt>
          <dd>
            <ol className="cf-builder-completion-steps">
              {progressStages.map((stage, index) => (
                <li key={`${stage}:${index}`}>{progressStepLabel(stage)}</li>
              ))}
            </ol>
          </dd>
        </div>
      ) : null}
    </dl>
  );
}

function ActivityPanel({
  hasUnsavedDraft,
  liveOutput,
  snapshot,
  onRefresh,
  onReviewPlan,
  planReviewBusy,
  planReviewFailed,
  planReviewRecorded,
  pendingPlanReview,
  canReviewPlan,
  savingVersion,
}: Readonly<{
  canReviewPlan: boolean;
  hasUnsavedDraft: boolean;
  liveOutput: BuilderLiveOutputSnapshot | null;
  snapshot: BuilderConversationControllerSnapshot | null;
  onRefresh?: () => Promise<unknown> | void;
  onReviewPlan?: (request: BuilderPlanReviewRequest) => Promise<unknown> | void;
  planReviewBusy: boolean;
  planReviewFailed: boolean;
  planReviewRecorded: boolean;
  pendingPlanReview: BuilderPlanReviewRequest | null;
  savingVersion: boolean;
}>) {
  const entries = activityEntries(snapshot);
  const visibleEntries = entries;
  const agentActivityProjection = currentAgentActivity(snapshot);
  const currentAgentActivityStatus = standaloneAgentActivity(agentActivityProjection, visibleEntries);
  const showLiveOutput = shouldShowLiveOutput(liveOutput, visibleEntries);
  const message = activityMessage(snapshot);
  const canRefresh = snapshot !== null
    && snapshot.project_id !== null
    && !snapshot.busy
    && typeof onRefresh === 'function';
  const showRefresh = canRefresh && snapshot.status === 'stale';
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
        {snapshot?.status === 'refreshing' && visibleEntries.length === 0 && !showLiveOutput && !savingVersion ? (
          <p className="cf-builder-activity-status" role="status">Refreshing activity...</p>
        ) : null}
        {visibleEntries.length === 0 && !showLiveOutput && !savingVersion && message !== null ? (
          <div className="cf-builder-empty cf-builder-activity-empty flex min-h-32 items-center justify-center border border-dashed px-3 text-center text-sm">
            {message}
          </div>
        ) : (
          <ol className="cf-builder-activity-list">
            {visibleEntries.map((entry) => (
              entry.entry_kind === 'work_status' ? (
                <ActivityWorkStatusItem
                  entry={entry}
                  key={entry.key}
                  projection={agentActivityProjection}
                />
              ) : (
                <ActivityItem
                  canReviewPlan={canReviewPlan}
                  hasUnsavedDraft={hasUnsavedDraft}
                  item={entry.item}
                  key={entry.item.sequence}
                  onReviewPlan={onReviewPlan}
                  planReviewBusy={planReviewBusy}
                  planReviewFailed={planReviewFailed}
                  planReviewRecorded={planReviewRecorded}
                  pendingPlanReview={pendingPlanReview}
                  progressStages={entry.progressStages}
                />
              )
            ))}
            {currentAgentActivityStatus !== null ? (
              <ActivityProjectedStatusItem projection={currentAgentActivityStatus} />
            ) : null}
            {savingVersion ? <ActivitySavingVersionItem /> : null}
            {showLiveOutput ? (
              <ActivityLiveOutputItem liveOutput={liveOutput} />
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
}

function artifactTabLabel(tab: BuilderArtifactTab): string {
  if (tab === 'preview') return 'Preview';
  if (tab === 'changes') return 'Changes';
  if (tab === 'source') return 'Files';
  if (tab === 'logs') return 'Logs';
  if (tab === 'permissions') return 'Permissions';
  return 'Versions';
}

function ArtifactTabIcon({ tab }: Readonly<{ tab: BuilderArtifactTab }>) {
  if (tab === 'preview') return <Eye aria-hidden="true" className="size-3.5" />;
  if (tab === 'changes') return <GitCompareArrows aria-hidden="true" className="size-3.5" />;
  if (tab === 'source') return <FileCode2 aria-hidden="true" className="size-3.5" />;
  if (tab === 'logs') return <ListChecks aria-hidden="true" className="size-3.5" />;
  if (tab === 'permissions') return <ShieldCheck aria-hidden="true" className="size-3.5" />;
  return <History aria-hidden="true" className="size-3.5" />;
}

function sideWorkspaceTabTypeForArtifactTab(tab: BuilderArtifactTab): BuilderSideWorkspaceTabType {
  if (tab === 'preview') return 'browser';
  if (tab === 'source') return 'file';
  if (tab === 'logs') return 'terminal';
  return 'review';
}

function artifactTabForSideWorkspaceTabType(
  type: BuilderSideWorkspaceTabType,
  availableTabs: readonly BuilderArtifactTab[],
): BuilderArtifactTab | null {
  if (type === 'browser') return availableTabs.includes('preview') ? 'preview' : null;
  if (type === 'file') return availableTabs.includes('source') ? 'source' : null;
  if (type === 'terminal') return availableTabs.includes('logs') ? 'logs' : null;
  if (type === 'review') {
    if (availableTabs.includes('changes')) return 'changes';
    if (availableTabs.includes('permissions')) return 'permissions';
    if (availableTabs.includes('versions')) return 'versions';
    return null;
  }
  return null;
}

function SideWorkspaceNewTabIcon({ type }: Readonly<{ type: BuilderSideWorkspaceTabType }>) {
  if (type === 'browser') return <Eye aria-hidden="true" className="size-3.5" />;
  if (type === 'file') return <FileCode2 aria-hidden="true" className="size-3.5" />;
  if (type === 'terminal') return <ListChecks aria-hidden="true" className="size-3.5" />;
  if (type === 'side_chat') return <Bot aria-hidden="true" className="size-3.5" />;
  return <GitCompareArrows aria-hidden="true" className="size-3.5" />;
}

const SIDE_WORKSPACE_NEW_TAB_ITEMS: readonly Readonly<{
  label: string;
  type: BuilderSideWorkspaceTabType;
  status: 'available_when_projected' | 'coming_later';
}>[] = Object.freeze([
  { label: 'File', type: 'file', status: 'available_when_projected' },
  { label: 'Side Chat', type: 'side_chat', status: 'coming_later' },
  { label: 'Browser', type: 'browser', status: 'available_when_projected' },
  { label: 'Terminal', type: 'terminal', status: 'coming_later' },
  { label: 'Review', type: 'review', status: 'available_when_projected' },
]);

function sideWorkspaceFileRefKey(fileRef: BuilderSideWorkspaceFileRef | null): string {
  if (fileRef === null) return 'none';
  return `${fileRef.source_tree_digest}:${fileRef.path}:${fileRef.content_digest}`;
}

function sideWorkspaceFileDepthStyle(depth: number): CSSProperties {
  return { '--cf-builder-file-depth': Math.max(0, Math.min(12, depth)) } as CSSProperties;
}

function sideWorkspaceFileDisplayName(path: string | null): string {
  if (path === null || path.trim().length === 0) return 'Files';
  return path.split('/').filter(Boolean).at(-1) ?? path;
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

  const selectedRefKey = content === null ? sideWorkspaceFileRefKey(projection?.selected_file_ref ?? null) : sideWorkspaceFileRefKey(content.file_ref);
  const firstFile = firstTextFileEntry(projection);
  const fileCount = projection?.entries.filter((entry) => entry.entry_kind === 'text_file').length ?? 0;
  const selectedPath = content?.path ?? projection?.selected_file_ref?.path ?? firstFile?.path ?? null;
  const selectedName = sideWorkspaceFileDisplayName(selectedPath);
  return (
    <section
      aria-label="Project files"
      className="cf-builder-artifact-files"
      data-builder-side-workspace-files="true"
      data-builder-side-workspace-files-status={treeStatus}
    >
      <div className="cf-builder-artifact-files-toolbar">
        <div className="cf-builder-artifact-files-path">
          <strong>{selectedName}</strong>
          <span>
            {selectedPath ?? (
              projection === null
                ? treeStatus === 'loading'
                  ? 'Loading files from the current draft.'
                  : 'Files are unavailable for this view.'
                : `${fileCount} ${fileCount === 1 ? 'file' : 'files'} from ${projection.root_label}.`
            )}
          </span>
        </div>
        <span className="cf-builder-artifact-files-count">
          {projection === null
            ? 'Files'
            : `${fileCount} ${fileCount === 1 ? 'file' : 'files'} from ${projection.root_label}`}
        </span>
      </div>
      <div className="cf-builder-artifact-files-body">
        <section
          aria-label="Selected file"
          className="cf-builder-artifact-file-content"
          data-builder-side-workspace-file-content={content?.path ?? 'none'}
          data-builder-side-workspace-file-content-status={contentStatus}
        >
          {contentStatus === 'loading' ? (
            <p className="cf-builder-artifact-files-empty" role="status">Loading file...</p>
          ) : content === null ? (
            <p className="cf-builder-artifact-files-empty" role={contentStatus === 'failed' ? 'alert' : 'status'}>
              {contentStatus === 'failed' ? 'This file is unavailable.' : 'Select a file to inspect its content.'}
            </p>
          ) : (
            <>
              <header className="cf-builder-artifact-file-content-header">
                <strong>{content.path}</strong>
                <span>{content.language_hint}{content.content_status === 'truncated' ? ' - truncated' : ''}</span>
              </header>
              <pre className="cf-builder-artifact-file-code">
                <code>{content.text_preview}</code>
              </pre>
            </>
          )}
        </section>
        <aside className="cf-builder-artifact-file-browser" aria-label="Project file browser">
          <div className="cf-builder-artifact-file-browser-header">
            <strong>Files</strong>
            <span>{projection?.root_label ?? 'Current draft'}</span>
          </div>
          <div className="cf-builder-artifact-file-filter" aria-hidden="true">Filter files...</div>
          <div className="cf-builder-artifact-file-tree" aria-label="Project file tree">
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

function BuilderArtifactLogsPanel({
  hasUnsavedDraft,
  liveOutput,
  snapshot,
}: Readonly<{
  hasUnsavedDraft: boolean;
  liveOutput: BuilderLiveOutputSnapshot | null;
  snapshot: BuilderConversationControllerSnapshot | null;
}>) {
  const entries = artifactLogEntries(snapshot);
  const latestBrief = latestTaskBriefItem(snapshot);
  const showLiveOutput = shouldShowLiveOutput(liveOutput, entries);
  const agentActivityProjection = currentAgentActivity(snapshot);
  const currentAgentActivityStatus = standaloneAgentActivity(agentActivityProjection, entries);
  return (
    <section
      aria-label="Work logs"
      className="cf-builder-artifact-logs"
      data-builder-artifact-logs="true"
    >
      <div className="cf-builder-artifact-logs-intro">
        <h4>Work logs</h4>
        <p>Readable steps from the current conversation.</p>
      </div>
      {latestBrief !== null ? (
        <section
          aria-label="Current direction"
          className="cf-builder-current-direction"
          data-builder-current-direction="true"
        >
          <div>
            <p className="cf-builder-current-direction-kicker">Current direction</p>
            <h4>Ready for later build</h4>
          </div>
          <p data-builder-current-direction-summary="true">{latestBrief.brief.summary}</p>
          <p className="cf-builder-current-direction-note">
            Used only after you ask Builder to start building from this direction.
          </p>
        </section>
      ) : null}
      {entries.length === 0 && !showLiveOutput ? (
        <div className="cf-builder-empty cf-builder-artifact-logs-empty flex min-h-24 items-center justify-center border border-dashed px-3 text-center text-sm">
          Work details will appear here when the assistant reads, plans, or prepares changes.
        </div>
      ) : (
        <ol className="cf-builder-activity-list cf-builder-artifact-logs-list">
          {entries.map((entry) => (
            entry.entry_kind === 'work_status' ? (
              <ActivityWorkStatusItem
                entry={entry}
                key={entry.key}
                projection={agentActivityProjection}
              />
            ) : (
              <ActivityItem
                canReviewPlan={false}
                hasUnsavedDraft={hasUnsavedDraft}
                item={entry.item}
                key={entry.item.sequence}
                planReviewBusy={false}
                planReviewFailed={false}
                planReviewRecorded={false}
                pendingPlanReview={null}
                progressStages={entry.progressStages}
              />
            )
          ))}
          {currentAgentActivityStatus !== null ? (
            <ActivityProjectedStatusItem projection={currentAgentActivityStatus} />
          ) : null}
          {showLiveOutput ? (
            <ActivityLiveOutputItem liveOutput={liveOutput} />
          ) : null}
        </ol>
      )}
    </section>
  );
}

function BuilderArtifactSummary({
  changes,
  hasContent,
  preview,
}: Readonly<{
  changes: BuilderSourceTreeChanges;
  hasContent: boolean;
  preview: BuilderProjectControllerSnapshot['preview'];
}>) {
  return (
    <section
      aria-label="Draft result summary"
      className="cf-builder-artifact-summary cf-builder-chat-flow-surface"
      data-builder-artifact-summary="true"
    >
      <div className="cf-builder-artifact-summary-copy">
        <div className="cf-builder-artifact-summary-icon" aria-hidden="true">
          <Eye className="size-4" />
        </div>
        <div className="min-w-0">
          <h2 className="cf-builder-artifact-summary-title">Result ready</h2>
          <p className="cf-builder-artifact-summary-text" data-builder-artifact-summary-preview="true">
            {builderReviewPreviewStatus(preview, hasContent)}
          </p>
          <p className="cf-builder-artifact-summary-text" data-builder-artifact-summary-changes="true">
            {builderChangesSummary(changes)}
          </p>
        </div>
      </div>
    </section>
  );
}

function BuilderArtifactSidebar({
  activeTab,
  approvalMode,
  artifactTabs,
  availableArtifactTabs,
  changes,
  changesOpen,
  currentProjectWriteApproval,
  files,
  hasSavedProject,
  hasUnsavedDraft,
  inspectedRevisionReceiptDigest,
  liveOutput,
  livePreviewOperation,
  livePreviewStatus,
  onExpandPreview,
  onApproveProviderContextDisclosure,
  onInspectRevision,
  onOpenFile,
  onRefreshHistory,
  onReloadLivePreview,
  onResizeKeyDown,
  onRestoreRevisionAsDraft,
  onSelectArtifactTab,
  onCloseArtifactTab,
  onOpenWorkspaceTab,
  onRequestLivePreview,
  onResizeStart,
  resizing,
  onSelectFile,
  onSourceOpenChange,
  planSourceReadApproval,
  providerContextDisclosureApprovalState,
  providerContextDisclosureStatus,
  preview,
  previewPanelRef,
  sidebarRef,
  snapshot,
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
  workingProject,
  history,
}: Readonly<{
  activeTab: BuilderArtifactTab;
  approvalMode: BuilderComposerApprovalMode;
  artifactTabs: readonly BuilderArtifactTab[];
  availableArtifactTabs: readonly BuilderArtifactTab[];
  changes: BuilderSourceTreeChanges;
  changesOpen: boolean;
  currentProjectWriteApproval: BuilderCurrentProjectWriteApprovalPrompt | null;
  files: readonly BuilderProjectSourceFile[];
  hasSavedProject: boolean;
  hasUnsavedDraft: boolean;
  history: BuilderProjectHistorySnapshot | null;
  inspectedRevisionReceiptDigest: string | null;
  liveOutput: BuilderLiveOutputSnapshot | null;
  livePreviewOperation: 'starting' | 'reloading' | 'stopping' | null;
  livePreviewStatus: BuilderLivePreviewStatusProjection | null;
  onExpandPreview: () => void;
  onApproveProviderContextDisclosure?: () => Promise<unknown> | void;
  onInspectRevision?: (projectId: string, revisionReceiptDigest: string) => Promise<unknown> | void;
  onOpenFile: (change: BuilderSourceTreeChange) => void;
  onRefreshHistory?: () => Promise<unknown> | void;
  onReloadLivePreview?: () => Promise<unknown> | void;
  onResizeKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => void;
  onRestoreRevisionAsDraft?: (projectId: string, revisionReceiptDigest: string) => Promise<unknown> | void;
  onSelectArtifactTab: (tab: BuilderArtifactTab) => void;
  onCloseArtifactTab: (tab: BuilderArtifactTab) => void;
  onOpenWorkspaceTab: (type: BuilderSideWorkspaceTabType) => void;
  onRequestLivePreview?: () => Promise<unknown> | void;
  onResizeStart: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  resizing: boolean;
  onSelectFile?: (file: BuilderFileName) => void;
  onSourceOpenChange: (open: boolean) => void;
  planSourceReadApproval: BuilderPlanSourceReadApprovalPrompt | null;
  providerContextDisclosureApprovalState: 'idle' | 'approving' | 'failed';
  providerContextDisclosureStatus: BuilderProviderContextDisclosureStatusProjectionWire | null;
  preview: BuilderProjectControllerSnapshot['preview'];
  previewPanelRef?: Ref<HTMLElement>;
  sidebarRef?: Ref<HTMLElement>;
  snapshot: BuilderConversationControllerSnapshot | null;
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
  workingProject: BuilderProjectControllerSnapshot['workingProject'];
}>) {
  const [newTabMenuOpen, setNewTabMenuOpen] = useState(false);
  const sourceTabLabel = sideWorkspaceFileDisplayName(
    sideWorkspaceFileContent?.path
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
            const label = tab === 'source' ? sourceTabLabel : artifactTabLabel(tab);
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
                  <span>{label}</span>
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
                const disabled = item.status === 'coming_later' || availableTab === null;
                return (
                  <button
                    aria-disabled={disabled}
                    className="cf-builder-side-workspace-new-tab-menu-item"
                    data-builder-side-workspace-new-tab-kind={item.type}
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
                    {item.status === 'coming_later' ? <small>Later</small> : null}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      </header>
      <div className="cf-builder-artifact-body" data-builder-artifact-body="true">
        {activeTab === 'preview' ? (
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
        ) : null}
        {activeTab === 'changes' ? (
          <div className="cf-builder-artifact-changes" data-builder-changes-flow="true">
            <BuilderChangesPanel
              changes={changes}
              onOpenChange={() => undefined}
              onOpenFile={onOpenFile}
              open={changesOpen}
            />
          </div>
        ) : null}
        {activeTab === 'source' ? (
          <BuilderArtifactFilesPanel
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
        {activeTab === 'versions' ? (
          <VersionHistoryPanel
            hasSavedProject={hasSavedProject}
            inspectedRevisionReceiptDigest={inspectedRevisionReceiptDigest}
            onInspectRevision={onInspectRevision}
            onRefresh={onRefreshHistory}
            onRestoreRevisionAsDraft={onRestoreRevisionAsDraft}
            snapshot={history}
          />
        ) : null}
        {activeTab === 'logs' ? (
          <BuilderArtifactLogsPanel
            hasUnsavedDraft={hasUnsavedDraft}
            liveOutput={liveOutput}
            snapshot={snapshot}
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
}

export function BuilderPage({
  activeRunFollowupQueued = false,
  approvalMode = 'ask_before_write',
  checkRunOperation = null,
  checkRunProfiles = [],
  checkRunStatus = null,
  instruction,
  composerRouteDecision = null,
  composerContextStatus = null,
  providerContextDisclosureStatus = null,
  providerContextDisclosureApprovalState = 'idle',
  composerMode = null,
  composerSubmitLocked = false,
  currentProjectWriteApproval = null,
  onApproveCurrentProjectWrite,
  onApproveProviderContextDisclosure,
  onApprovePlanSourceRead,
  onCancel,
  onCreateProject,
  onClearWorkspaceSelection,
  onDismissCurrentProjectWriteApproval,
  onDismissWorkspacePicker,
  onDismissPlanSourceReadApproval,
  onInstructionChange,
  onOpenProject,
  onOpenProjectLocation,
  onSelectApprovalMode,
  onSelectComposerMode,
  onSelectPlanMode,
  onClearComposerMode,
  onSubmitInstruction,
  onRetryGenerate,
  onRefreshConversation,
  onRefreshHistory,
  onRejectDraft,
  onReloadLivePreview,
  onReviewPlan,
  onRequestLivePreview,
  onRequestSideWorkspaceFiles,
  onRestoreRevisionAsDraft,
  onSave,
  onSelectSideWorkspaceFile,
  onStopLivePreview,
  onInspectRevision,
  onShowCurrentRevision,
  onOpenSettings,
  conversationSnapshot,
  projectCatalogSnapshot,
  historySnapshot,
  snapshot,
  activeFile,
  approvedPlanContinuationFailure = null,
  answerFailureRecordedSuccess = false,
  liveOutput = null,
  livePreviewOperation = null,
  livePreviewStatus = null,
  sideWorkspaceFileContent = null,
  sideWorkspaceFileContentStatus = 'idle',
  sideWorkspaceFileTree = null,
  sideWorkspaceFileTreeStatus = 'idle',
  planReviewFailure = null,
  planReviewInFlight = null,
  planReviewRecorded = null,
  planSourceReadApproval = null,
  workspaceNewProjectRequest = 0,
  workspacePickerRequest = 0,
  onSelectFile,
}: BuilderPageProps) {
  const trusted = isTrustedBuilderProjectControllerSnapshot(snapshot);
  const current = trusted ? snapshot : null;
  const status = current?.status ?? 'unavailable';
  const conversationStatus = conversationSnapshot?.status ?? 'unavailable';
  const conversationProjectId = conversationSnapshot?.project_id ?? null;
  const conversationItemCount = conversationSnapshot?.conversation?.state === 'ready'
    ? conversationSnapshot.conversation.conversation.items.length
    : 0;
  const saved = current?.savedProject ?? null;
  const draft = current?.draft ?? null;
  const inspected = current?.inspectedRevision ?? null;
  const preview = current?.preview ?? null;
  const files = current === null ? [] : selectedFiles(current);
  const selected = files.find((file) => file.path === activeFile) ?? null;
  const busy = current?.busy ?? false;
  const hasUnsavedDraft = draft !== null;
  const viewingHistory = inspected !== null;
  const hasContent = files.length > 0;
  const title = draft?.title ?? inspected?.target.title ?? saved?.target.title ?? 'New project';
  const workingProject = current?.workingProject ?? null;
  const catalog = isTrustedBuilderProjectCatalogSnapshot(projectCatalogSnapshot)
    ? projectCatalogSnapshot
    : null;
  const catalogProjects = catalog?.projects ?? [];
  const catalogWorkspaceProjects = catalog?.workspaceProjects ?? [];
  const catalogBusy = catalog?.status === 'loading' || catalog?.status === 'refreshing';
  const version = saved?.target.revision_number ?? null;
  const canAddContext = typeof onSubmitInstruction === 'function'
    && liveOutput !== null
    && busy
    && !hasUnsavedDraft
    && !viewingHistory
    && (status === 'answering' || status === 'generating' || status === 'submitting');
  const canSubmit = typeof onSubmitInstruction === 'function'
    && GENERATABLE_STATUSES.has(status)
    && !viewingHistory
    && !composerSubmitLocked
    && instruction.trim().length > 0;
  const canSubmitComposer = canSubmit || (canAddContext && instruction.trim().length > 0);
  const canCancel = typeof onCancel === 'function'
    && (status === 'answering' || status === 'generating' || status === 'submitting');
  const canEditInstruction = typeof onInstructionChange === 'function'
    && !viewingHistory
    && (!busy || canAddContext);
  const failed = status === 'generation_failed' || status === 'answer_failed' || status === 'submit_failed';
  const showFailedNotice = failed && !(status === 'answer_failed' && answerFailureRecordedSuccess);
  const canRetryGenerate = typeof onRetryGenerate === 'function'
    && (status === 'generation_failed' || status === 'submit_failed')
    && current?.retryableGeneration === true
    && isRetryableGenerationError(current.error);
  const canOpenSettings = failed
    && current?.error === 'builder_generation_provider_unavailable'
    && typeof onOpenSettings === 'function';
  const activity = visibleActivitySnapshot(conversationSnapshot);
  const draftCheckpointStatus = activity?.status === 'ready'
    && activity.conversation?.state === 'ready'
    ? activity.conversation.draft_checkpoint_status_projection ?? null
    : null;
  const reviewState = activity?.status === 'ready'
    && activity.conversation?.state === 'ready'
    ? activity.conversation.review_state_projection ?? null
    : null;
  const checkRunOutcome = currentCheckRunOutcome(activity);
  const canSave = typeof onSave === 'function'
    && hasUnsavedDraft
    && !busy
    && checkRunOperation !== 'running'
    && checkRunStatus?.status !== 'failed'
    && checkRunStatus?.status !== 'incomplete'
    && reviewState?.draft_id === draft?.draft_id
    && reviewState?.can_save === true;
  const canReject = typeof onRejectDraft === 'function'
    && hasUnsavedDraft
    && !busy
    && reviewState?.draft_id === draft?.draft_id
    && reviewState?.can_discard === true;
  const history = visibleHistorySnapshot(historySnapshot);
  const visibleLiveOutput = liveOutput;
  const showActivity = shouldShowActivityPanel(activity) || visibleLiveOutput !== null || status === 'saving';
  const showLogsPanel = artifactLogEntries(activity).length > 0 || visibleLiveOutput !== null;
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
    && (saved !== null || workingProject !== null)
    && !busy
    && !hasUnsavedDraft
    && !viewingHistory
    && PLAN_PROPOSAL_READY_STATUSES.has(status);
  const changes = useMemo(() => createBuilderSourceTreeChanges(
    saved?.source_tree ?? null,
    draft?.source_tree ?? null,
  ), [draft, saved]);
  const sourceFile = selected ?? (preview === null ? files[0] ?? null : null);
  const showPreviewUnavailableResult = preview === null && status === 'preview_unavailable' && hasContent;
  const showResultFlow = preview !== null || showPreviewUnavailableResult;
  const showVersionHistoryPanel = saved !== null && !hasUnsavedDraft;
  const sourceDisclosureRef = useRef<HTMLDetailsElement | null>(null);
  const draftLandingRef = useRef<HTMLDivElement | null>(null);
  const draftReviewRef = useRef<HTMLElement | null>(null);
  const resultFlowRef = useRef<HTMLElement | null>(null);
  const artifactSidebarRef = useRef<HTMLElement | null>(null);
  const pendingChangesFocusRef = useRef(false);
  const pendingSourceFocusRef = useRef(false);
  const chatShellRef = useRef<HTMLElement | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const chatTailRef = useRef<HTMLDivElement | null>(null);
  const shouldFollowChatRef = useRef(true);
  const [artifactWidth, setArtifactWidth] = useState(ARTIFACT_DEFAULT_WIDTH_PX);
  const [artifactWidthMaximum, setArtifactWidthMaximum] = useState(ARTIFACT_MAX_WIDTH_PX);
  const [artifactResizing, setArtifactResizing] = useState(false);
  const [previewExpanded, setPreviewExpanded] = useState(false);
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const changesPanelIdentity = [
    draft?.draft_id ?? 'no-draft',
    inspected?.target.revision_receipt_digest ?? 'no-inspected',
    saved?.target.revision_receipt_digest ?? 'no-saved',
  ].join('|');
  const sourceDisclosureIdentity = [
    draft?.draft_id ?? 'no-draft',
    inspected?.target.revision_receipt_digest ?? 'no-inspected',
    saved?.target.revision_receipt_digest ?? 'no-saved',
    sourceFile?.path ?? 'no-source',
    files.length,
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
  const currentFiles = draft?.source_tree.files ?? saved?.source_tree.files ?? [];
  const currentSelected = currentFiles.find((file) => file.path === activeFile) ?? null;
  const currentSourceFile = currentSelected ?? (preview === null ? currentFiles[0] ?? null : null);
  const currentArtifactPanelIdentity = [
    draft?.draft_id ?? 'no-draft',
    'no-inspected',
    saved?.target.revision_receipt_digest ?? 'no-saved',
    currentSourceFile?.path ?? 'no-source',
    currentFiles.length,
    showResultFlow ? 'result' : 'no-result',
    showVersionHistoryPanel ? 'versions' : 'no-versions',
    showLogsPanel ? 'logs' : 'no-logs',
    showPermissionsPanel ? 'permissions' : 'no-permissions',
  ].join('|');
  const artifactPanelIdentity = [
    draft?.draft_id ?? 'no-draft',
    inspected?.target.revision_receipt_digest ?? 'no-inspected',
    saved?.target.revision_receipt_digest ?? 'no-saved',
    sourceFile?.path ?? 'no-source',
    files.length,
    showResultFlow ? 'result' : 'no-result',
    showVersionHistoryPanel ? 'versions' : 'no-versions',
    showLogsPanel ? 'logs' : 'no-logs',
    showPermissionsPanel ? 'permissions' : 'no-permissions',
  ].join('|');
  const showFilesPanel = sourceFile !== null || hasUnsavedDraft;
  const artifactTabs = useMemo(() => {
    const tabs: BuilderArtifactTab[] = [];
    if (showResultFlow) tabs.push('preview');
    if (hasUnsavedDraft) tabs.push('changes');
    if (showFilesPanel) tabs.push('source');
    if (showVersionHistoryPanel) tabs.push('versions');
    if (showLogsPanel) tabs.push('logs');
    if (showPermissionsPanel) tabs.push('permissions');
    return tabs;
  }, [hasUnsavedDraft, showFilesPanel, showLogsPanel, showPermissionsPanel, showResultFlow, showVersionHistoryPanel]);
  const hasArtifactControls = artifactTabs.length > 0;
  const defaultArtifactTab: BuilderArtifactTab | null = selected !== null && showFilesPanel
    ? 'source'
    : viewingHistory && showResultFlow
      ? 'preview'
    : hasUnsavedDraft && showResultFlow
      ? 'preview'
      : showVersionHistoryPanel
        ? 'versions'
        : showResultFlow
          ? 'preview'
          : showFilesPanel
            ? 'source'
            : hasUnsavedDraft
              ? 'changes'
              : null;
  const [artifactPanelState, setArtifactPanelState] = useState<Readonly<{
    active: BuilderArtifactTab | null;
    openTabs: readonly BuilderArtifactTab[];
    identity: string;
  }>>(() => ({
    active: defaultArtifactTab,
    openTabs: defaultArtifactTab === null ? [] : [defaultArtifactTab],
    identity: artifactPanelIdentity,
  }));
  const requestedOpenArtifactTabs = artifactPanelState.identity === artifactPanelIdentity
    ? artifactPanelState.openTabs.filter((tab) => artifactTabs.includes(tab))
    : defaultArtifactTab === null ? [] : [defaultArtifactTab];
  const openArtifactTabs = artifactPanelState.identity === artifactPanelIdentity || defaultArtifactTab === null
    ? requestedOpenArtifactTabs
    : [defaultArtifactTab];
  const requestedArtifactTab = artifactPanelState.identity === artifactPanelIdentity
    ? artifactPanelState.active
    : defaultArtifactTab;
  const activeArtifactTab = requestedArtifactTab === null
    ? null
    : openArtifactTabs.includes(requestedArtifactTab)
      ? requestedArtifactTab
      : openArtifactTabs[0] ?? null;
  const showArtifactSidebar = activeArtifactTab !== null;
  const activeWorkspaceMenuLabel = activeArtifactTab === null ? 'Workspace' : artifactTabLabel(activeArtifactTab);
  const workspaceMenuVisible = workspaceMenuOpen && hasArtifactControls;
  const openLocationProjectId = draft?.project_id
    ?? inspected?.target.project_id
    ?? saved?.target.project_id
    ?? current?.workingProjectId
    ?? null;
  const showChangesPanel = activeArtifactTab === 'changes' && hasUnsavedDraft;
  const previewExpandedVisible = previewExpanded && showResultFlow;
  const artifactShellStyle = showArtifactSidebar
    ? ({
      '--cf-builder-artifact-width': `${artifactWidth}px`,
    } as CSSProperties)
    : undefined;

  useLayoutEffect(() => {
    if (!showArtifactSidebar) return undefined;
    const shell = chatShellRef.current;
    if (shell === null) return undefined;
    const shellElement = shell;

    function clampForCurrentShell(): void {
      const maximum = artifactMaxWidthForShell(shellElement.getBoundingClientRect().width);
      setArtifactWidthMaximum(maximum);
      setArtifactWidth((currentWidth) => clampArtifactWidth(currentWidth, maximum));
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
      : `${visibleLiveOutput.request_id}:${visibleLiveOutput.state}:${visibleLiveOutput.chunk_count}`;
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

  useEffect(() => {
    if (!pendingSourceFocusRef.current || !sourceDisclosureOpen) return;
    const disclosure = sourceDisclosureRef.current;
    if (disclosure === null) return;
    pendingSourceFocusRef.current = false;
    disclosure.focus();
  }, [sourceDisclosureOpen, sourceFile?.path]);

  useEffect(() => {
    if (hasUnsavedDraft) return;
    if (!shouldFollowChatRef.current) return;
    chatTailRef.current?.scrollIntoView?.({ block: 'end' });
  }, [chatFollowKey, hasUnsavedDraft]);

  useEffect(() => {
    if (!hasUnsavedDraft) return;
    shouldFollowChatRef.current = false;
    let cancelled = false;
    const frameHandles: number[] = [];
    const timeoutHandles: number[] = [];
    const scrollDraftReviewIntoView = () => {
      if (cancelled) return;
      const landingTarget = draftReviewRef.current
        ?? draftLandingRef.current
        ?? (showResultFlow ? resultFlowRef.current : null);
      if (landingTarget !== null) {
        scrollElementRangeIntoChatView(
          chatScrollRef.current,
          landingTarget,
          draftLandingRef.current ?? landingTarget,
        );
      }
    };
    const scheduleFrame = (callback: () => void): void => {
      frameHandles.push(window.requestAnimationFrame(callback));
    };
    const scheduleTimeout = (delayMs: number): void => {
      timeoutHandles.push(window.setTimeout(scrollDraftReviewIntoView, delayMs));
    };
    scrollDraftReviewIntoView();
    scheduleFrame(() => {
      scrollDraftReviewIntoView();
      scheduleFrame(scrollDraftReviewIntoView);
    });
    scheduleTimeout(120);
    scheduleTimeout(320);
    return () => {
      cancelled = true;
      for (const frameHandle of frameHandles) window.cancelAnimationFrame(frameHandle);
      for (const timeoutHandle of timeoutHandles) window.clearTimeout(timeoutHandle);
    };
  }, [
    draft?.draft_id,
    hasUnsavedDraft,
    preview?.source_tree_digest,
    showPreviewUnavailableResult,
    showResultFlow,
  ]);

  useEffect(() => {
    if (!pendingChangesFocusRef.current || !showChangesPanel) return;
    const disclosure = document.querySelector<HTMLDetailsElement>('[data-builder-changes-disclosure="true"]');
    if (disclosure === null) return;
    pendingChangesFocusRef.current = false;
    disclosure.focus({ preventScroll: true });
  }, [showChangesPanel]);

  useEffect(() => {
    if (activeArtifactTab !== 'source' || !hasUnsavedDraft) return;
    void onRequestSideWorkspaceFiles?.();
  }, [activeArtifactTab, hasUnsavedDraft, onRequestSideWorkspaceFiles]);

  function updateChatFollowState(): void {
    const scroll = chatScrollRef.current;
    if (scroll === null) return;
    shouldFollowChatRef.current = isNearChatBottom(scroll);
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
      };
    });
  }

  function openArtifactTab(tab: BuilderArtifactTab): void {
    shouldFollowChatRef.current = false;
    setActiveArtifactTab(tab);
    if (tab === 'changes') setChangesPanelOpen(true);
    if (tab === 'source') setSourceDisclosureOpen(true);
  }

  function closeArtifactTab(tab: BuilderArtifactTab): void {
    shouldFollowChatRef.current = false;
    setArtifactPanelState((panelState) => {
      const baseOpenTabs = panelState.identity === artifactPanelIdentity
        ? panelState.openTabs.filter((openTab) => artifactTabs.includes(openTab))
        : openArtifactTabs;
      const nextOpenTabs = baseOpenTabs.filter((openTab) => openTab !== tab);
      const nextActive = panelState.active === tab
        ? nextOpenTabs.at(-1) ?? null
        : panelState.active;
      return {
        active: nextActive,
        openTabs: nextOpenTabs,
        identity: artifactPanelIdentity,
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
    openArtifactTab(tab);
    setWorkspaceMenuOpen(false);
    if (tab === 'preview') {
      window.requestAnimationFrame(() => {
        document.getElementById('builder-tool-preview')?.focus({ preventScroll: true });
      });
    }
  }

  function minimizeArtifactSidebar(): void {
    shouldFollowChatRef.current = false;
    const fallbackTab = activeArtifactTab ?? defaultArtifactTab ?? artifactTabs[0] ?? null;
    setArtifactWidth(ARTIFACT_MIN_WIDTH_PX);
    if (fallbackTab !== null) {
      setActiveArtifactTab(fallbackTab);
    }
  }

  function toggleArtifactSidebar(): void {
    shouldFollowChatRef.current = false;
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
    shouldFollowChatRef.current = false;
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
      setArtifactWidthMaximum(maximum);
      setArtifactWidth(clampArtifactWidth(
        startWidth + startX - moveEvent.clientX,
        maximum,
      ));
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
    shouldFollowChatRef.current = false;
    setArtifactWidth(clampArtifactWidth(nextWidth, maximum));
  }

  function selectFile(path: string): boolean {
    if (typeof onSelectFile !== 'function') return false;
    onSelectFile(path);
    return true;
  }

  function openChangedFile(change: BuilderSourceTreeChange): void {
    if (change.change_kind === 'deleted') return;
    if (!selectFile(change.path)) return;
    pendingSourceFocusRef.current = true;
    openArtifactTab('source');
    const disclosure = sourceDisclosureRef.current;
    if (disclosure !== null) {
      pendingSourceFocusRef.current = false;
      disclosure.focus();
    }
  }

  function openExpandedPreview(): void {
    shouldFollowChatRef.current = false;
    openArtifactTab('preview');
    setPreviewExpanded(true);
  }

  function closeExpandedPreview(): void {
    setPreviewExpanded(false);
    window.requestAnimationFrame(() => {
      document.getElementById('builder-tool-preview')?.focus({ preventScroll: true });
    });
  }

  function focusDraftReview(): void {
    shouldFollowChatRef.current = false;
    const review = draftReviewRef.current;
    if (review === null) return;
    review.scrollIntoView?.({ block: 'start' });
    review.focus({ preventScroll: true });
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
  const draftReview = hasUnsavedDraft ? (
    <BuilderReviewCheckpoint
      canReject={canReject}
      canSave={canSave}
      checkRunOperation={checkRunOperation}
      checkRunOutcome={checkRunOutcome}
      checkRunProfiles={checkRunProfiles}
      checkRunStatus={checkRunStatus}
      changes={changes}
      checkpointRef={draftReviewRef}
      discardLabel={status === 'rejecting' ? 'Discarding...' : 'Discard draft'}
      hasContent={hasContent}
      onRejectDraft={onRejectDraft}
      onSave={onSave}
      preview={preview}
      reviewState={reviewState}
      saveLabel={status === 'saving'
        ? 'Saving...'
        : status === 'save_unknown'
          ? 'Try Save again'
          : 'Save version'}
    />
  ) : null;

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

  const composer = (
    <BuilderComposer
      activeRunFollowupQueued={activeRunFollowupQueued}
      approvalMode={approvalMode}
      busy={busy}
      canAddContext={canAddContext}
      canAllowCurrentProjectApproval={saved !== null || workingProject !== null}
      canCancel={canCancel}
      canEditInstruction={canEditInstruction}
      canProposePlan={canProposePlan}
      canSubmitComposer={canSubmitComposer}
      catalogBusy={catalogBusy}
      catalogProjects={catalogProjects}
      catalogWorkspaceProjects={catalogWorkspaceProjects}
      composerContextStatus={viewingHistory ? null : composerContextStatus}
      providerContextDisclosureStatus={viewingHistory ? null : providerContextDisclosureStatus}
      composerMode={composerMode}
      composerRouteDecision={composerRouteDecision}
      hasUnsavedDraft={hasUnsavedDraft}
      instruction={instruction}
      onCancel={onCancel}
      onClearComposerMode={onClearComposerMode}
      onClearWorkspaceSelection={onClearWorkspaceSelection}
      onCreateProject={onCreateProject}
      onDismissWorkspacePicker={onDismissWorkspacePicker}
      onFocusDraftReview={focusDraftReview}
      onInstructionChange={onInstructionChange}
      onOpenProject={onOpenProject}
      onSelectApprovalMode={onSelectApprovalMode}
      onSelectComposerMode={onSelectComposerMode}
      onSelectPlanMode={onSelectPlanMode}
      onSubmitInstruction={onSubmitInstruction}
      savedProject={saved === null
        ? null
        : {
          revisionNumber: saved.target.revision_number,
          title: saved.target.title,
        }}
      status={status}
      viewingHistory={viewingHistory}
      workingProject={workingProject}
      workspaceNewProjectRequest={workspaceNewProjectRequest}
      workspacePickerRequest={workspacePickerRequest}
    />
  );

  const showArtifactSummary = hasUnsavedDraft && (showResultFlow || hasContent);
  const artifactSummary = showArtifactSummary ? (
    <BuilderArtifactSummary
      changes={changes}
      hasContent={hasContent}
      preview={preview}
    />
  ) : null;
  const workspaceControls = openLocationProjectId !== null || hasArtifactControls ? (
    <div
      aria-label="Workspace artifact controls"
      className="cf-builder-workspace-controls"
      data-builder-workspace-controls="true"
      data-builder-workspace-drawer-visible={showArtifactSidebar ? 'true' : 'false'}
      role="group"
    >
      {openLocationProjectId !== null ? (
        <button
          aria-label="Open location"
          className="cf-builder-workspace-control-button cf-builder-workspace-location-button"
          data-builder-open-project-location="true"
          onClick={openProjectLocation}
          title="Open location"
          type="button"
        >
          <FolderOpen aria-hidden="true" className="size-3.5" />
          <span>Open location</span>
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
              <span>{activeWorkspaceMenuLabel}</span>
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
  const artifactSidebar = showArtifactSidebar && activeArtifactTab !== null ? (
    <BuilderArtifactSidebar
      activeTab={activeArtifactTab}
      approvalMode={approvalMode}
      artifactTabs={openArtifactTabs}
      availableArtifactTabs={artifactTabs}
      changes={changes}
      changesOpen={activeArtifactTab === 'changes' || changesPanelOpen}
      currentProjectWriteApproval={currentProjectWriteApproval}
      files={files}
      hasSavedProject={saved !== null}
      hasUnsavedDraft={hasUnsavedDraft}
      history={history}
      inspectedRevisionReceiptDigest={inspected?.target.revision_receipt_digest ?? null}
      liveOutput={visibleLiveOutput}
      livePreviewOperation={livePreviewOperation}
      livePreviewStatus={livePreviewStatus}
      onExpandPreview={openExpandedPreview}
      onApproveProviderContextDisclosure={onApproveProviderContextDisclosure}
      onCloseArtifactTab={closeArtifactTab}
      onInspectRevision={onInspectRevision}
      onOpenFile={openChangedFile}
      onOpenWorkspaceTab={openSideWorkspaceTab}
      onRefreshHistory={onRefreshHistory}
      onReloadLivePreview={onReloadLivePreview}
      onResizeKeyDown={resizeArtifactWithKeyboard}
      onResizeStart={startArtifactResize}
      onRestoreRevisionAsDraft={onRestoreRevisionAsDraft}
      onRequestLivePreview={onRequestLivePreview}
      resizing={artifactResizing}
      onSelectArtifactTab={openArtifactTab}
      onSelectFile={onSelectFile}
      onSourceOpenChange={setSourceDisclosureOpen}
      planSourceReadApproval={planSourceReadApproval}
      providerContextDisclosureApprovalState={providerContextDisclosureApprovalState}
      providerContextDisclosureStatus={viewingHistory ? null : providerContextDisclosureStatus}
      preview={preview}
      previewPanelRef={resultFlowRef}
      sidebarRef={artifactSidebarRef}
      snapshot={activity}
      sourceDisclosureOpen={sourceDisclosureOpen}
      sourceDisclosureRef={sourceDisclosureRef}
      sourceFile={sourceFile}
      sideWorkspaceFileContent={sideWorkspaceFileContent}
      sideWorkspaceFileContentStatus={sideWorkspaceFileContentStatus}
      sideWorkspaceFileTree={sideWorkspaceFileTree}
      sideWorkspaceFileTreeStatus={sideWorkspaceFileTreeStatus}
      width={artifactWidth}
      widthMaximum={artifactWidthMaximum}
      onSelectSideWorkspaceFile={onSelectSideWorkspaceFile}
      onStopLivePreview={onStopLivePreview}
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
        <div className="cf-builder-preview-expanded-body">
          <BuilderResultPanel placement="expanded" projection={preview} />
        </div>
      </div>
    </section>
  ) : null;

  return (
    <div
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
          <p className="text-xs font-medium text-muted-foreground">Project</p>
          <h1 className="truncate text-base font-semibold">{title}</h1>
        </div>
        <div className="cf-builder-toolbar-actions">
          {hasUnsavedDraft ? (
            <>
              <span className="cf-builder-status-pill" data-builder-unsaved-draft="true">
                Unsaved draft
              </span>
              {draftCheckpointStatus?.status === 'ready' ? (
                <span
                  className="cf-builder-status-pill"
                  data-builder-draft-checkpoint-status="ready"
                  title={draftCheckpointStatus.next_action_hint}
                >
                  {draftCheckpointStatus.label} · {draftCheckpointStatus.changed_file_count}{' '}
                  {draftCheckpointStatus.changed_file_count === 1 ? 'file' : 'files'}
                </span>
              ) : null}
              {version === null ? null : (
                <span className="text-xs text-muted-foreground" data-builder-current-version="true">
                  Version {version}
                </span>
              )}
            </>
          ) : viewingHistory ? (
            <span className="cf-builder-status-pill" data-builder-history-preview="true">
              Viewing Version {inspected.target.revision_number}
            </span>
          ) : version === null ? null : (
            <span className="text-xs text-muted-foreground" data-builder-current-version="true">
              Version {version}
            </span>
          )}
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
        </div>
      </header>

      <div className="cf-builder-surface-body">
        <section
          aria-label="Project conversation workspace"
          className="cf-builder-chat-shell"
          data-builder-artifact-sidebar-visible={showArtifactSidebar ? 'true' : 'false'}
          data-builder-chat-workspace="true"
          ref={chatShellRef}
          style={artifactShellStyle}
        >
          <div className="cf-builder-chat-main" data-builder-chat-main="true">
            <div
              className="cf-builder-chat-scroll"
              data-builder-chat-scroll="true"
              onScroll={updateChatFollowState}
              ref={chatScrollRef}
            >
              {showActivity ? (
                <ActivityPanel
                  canReviewPlan={canReviewPlan}
                  hasUnsavedDraft={hasUnsavedDraft}
                  liveOutput={visibleLiveOutput}
                  onRefresh={onRefreshConversation}
                  onReviewPlan={onReviewPlan}
                  planReviewBusy={planReviewBusy}
                  planReviewFailed={planReviewFailed}
                  planReviewRecorded={planReviewRecordedForTarget}
                  pendingPlanReview={planReviewTarget}
                  savingVersion={status === 'saving'}
                  snapshot={activity}
                />
              ) : null}
              {planSourceReadApprovalCard}
              {currentProjectWriteApprovalCard}

              {hasUnsavedDraft ? (
                <div
                  className="cf-builder-draft-landing"
                  data-builder-draft-landing="true"
                  ref={draftLandingRef}
                >
                  {draftReview}
                  {artifactSummary}
                </div>
              ) : null}

              {conversationNotice}
              <div
                aria-hidden="true"
                className="cf-builder-chat-tail"
                data-builder-chat-tail="true"
                ref={chatTailRef}
              />
            </div>

            {composer}
          </div>

          {artifactSidebar}
        </section>
      </div>
      {expandedPreviewOverlay}
    </div>
  );
}
