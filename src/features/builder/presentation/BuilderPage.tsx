import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type Ref,
} from 'react';
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  Eye,
  FileCode2,
  GitCompareArrows,
  History,
  ListChecks,
  LockKeyhole,
  Play,
  RefreshCw,
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
  type BuilderPlanReviewDecision,
  type BuilderPlanReviewRequest,
} from '../application/builderPorts';
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
import type { BuilderProjectHistoryRevision } from '../domain/builderProjectHistory';
import type { BuilderProjectSourceFile } from '../domain/builderProjectSnapshot';
import {
  createBuilderSourceTreeChanges,
  type BuilderSourceTreeChange,
  type BuilderSourceTreeChanges,
} from '../domain/builderSourceTreeChanges';
import { BuilderChangesPanel } from './BuilderChangesPanel';
import { BuilderComposer } from './BuilderComposer';
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
  file_count: number;
  state: 'pending' | 'approving' | 'failed';
}>;

export type BuilderPageProps = {
  instruction: string;
  liveOutput?: BuilderLiveOutputSnapshot | null;
  approvedPlanContinuationFailure?: BuilderPlanReviewInFlight | null;
  planReviewFailure?: BuilderPlanReviewInFlight | null;
  planReviewInFlight?: BuilderPlanReviewInFlight | null;
  planReviewRecorded?: BuilderPlanReviewInFlight | null;
  planSourceReadApproval?: BuilderPlanSourceReadApprovalPrompt | null;
  workspacePickerRequest?: number;
  workspaceNewProjectRequest?: number;
  onInstructionChange?: (value: string) => void;
  onApprovePlanSourceRead?: () => Promise<unknown> | void;
  onCancel?: () => void;
  onCreateProject?: (projectTitle: string) => Promise<unknown> | void;
  onDismissWorkspacePicker?: () => void;
  onDismissPlanSourceReadApproval?: () => void;
  onSteerInstruction?: () => void;
  onProposePlan?: () => void;
  onSubmitInstruction?: () => void;
  onRetryGenerate?: () => void;
  onRefreshConversation?: () => Promise<unknown> | void;
  onRefreshHistory?: () => Promise<unknown> | void;
  onRejectDraft?: () => void;
  onReviewPlan?: (request: BuilderPlanReviewRequest) => Promise<unknown> | void;
  onSave?: () => void;
  onInspectRevision?: (projectId: string, revisionReceiptDigest: string) => Promise<unknown> | void;
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
const CHAT_FOLLOW_BOTTOM_THRESHOLD_PX = 96;
const ARTIFACT_DEFAULT_WIDTH_PX = 480;
const ARTIFACT_MIN_WIDTH_PX = 360;
const ARTIFACT_MAX_WIDTH_PX = 760;
const ARTIFACT_MIN_CHAT_WIDTH_PX = 360;
type BuilderArtifactTab = 'changes' | 'logs' | 'preview' | 'source' | 'versions';

function clampArtifactWidth(value: number, maximum = ARTIFACT_MAX_WIDTH_PX): number {
  if (!Number.isFinite(value)) return ARTIFACT_DEFAULT_WIDTH_PX;
  const safeMaximum = Math.max(ARTIFACT_MIN_WIDTH_PX, Math.min(ARTIFACT_MAX_WIDTH_PX, Math.round(maximum)));
  return Math.min(safeMaximum, Math.max(ARTIFACT_MIN_WIDTH_PX, Math.round(value)));
}

function artifactMaxWidthForShell(shellWidth: number): number {
  if (!Number.isFinite(shellWidth)) return ARTIFACT_MAX_WIDTH_PX;
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

function activityEntries(snapshot: BuilderConversationControllerSnapshot | null): readonly ActivityEntry[] {
  const entries: ActivityEntry[] = [];
  const completedRuns = new Set<string>();
  const workEntries = new Map<string, ActivityWorkStatusEntry>();
  const toolRequestEntries = new Map<string, ActivityItemEntry>();
  for (const item of activityItems(snapshot)) {
    if (item.item_kind === 'run_started') {
      const key = `${item.turn_id}:${item.run_id}`;
      const entry: ActivityWorkStatusEntry = {
        entry_kind: 'work_status',
        key,
        sequence: item.sequence,
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
    if (item.item_kind === 'run_completed') {
      const key = `${item.turn_id}:${item.run_id}`;
      completedRuns.add(key);
      const workEntry = workEntries.get(key);
      if (workEntry !== undefined) workEntry.hidden = true;
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

function isArtifactLogEntry(entry: ActivityEntry): boolean {
  if (entry.entry_kind === 'work_status') return true;
  const { item } = entry;
  if (
    item.item_kind === 'run_control_requested'
    || item.item_kind === 'tool_call_requested'
    || item.item_kind === 'tool_call_result_recorded'
    || item.item_kind === 'candidate_reviewed'
    || item.item_kind === 'plan_reviewed'
  ) return true;
  if (item.item_kind === 'run_completed') {
    return item.terminal_status !== 'succeeded' || item.result_kind !== 'explanation';
  }
  return false;
}

function artifactLogEntries(snapshot: BuilderConversationControllerSnapshot | null): readonly ActivityEntry[] {
  return activityEntries(snapshot).filter(isArtifactLogEntry);
}

function isNearChatBottom(element: HTMLElement): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= CHAT_FOLLOW_BOTTOM_THRESHOLD_PX;
}

function scrollElementToChatStart(
  scroll: HTMLElement | null,
  target: HTMLElement,
): void {
  if (scroll !== null) {
    const scrollBox = scroll.getBoundingClientRect();
    const targetBox = target.getBoundingClientRect();
    if (
      Number.isFinite(scrollBox.top)
      && Number.isFinite(scrollBox.height)
      && Number.isFinite(targetBox.top)
      && Number.isFinite(targetBox.height)
      && scrollBox.height > 0
      && targetBox.height > 0
    ) {
      scroll.scrollTop += targetBox.top - scrollBox.top - 12;
      return;
    }
  }
  target.scrollIntoView?.({ block: 'start' });
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
  if (activityItems(snapshot).length > 0) return true;
  return snapshot.status === 'loading'
    || snapshot.status === 'refreshing'
    || snapshot.status === 'stale'
    || snapshot.status === 'unavailable';
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

type ActivityWorkStatus = 'started' | BuilderConversationRunProgressStage;

type ActivityWorkStatusEntry = {
  entry_kind: 'work_status';
  key: string;
  sequence: number;
  status: ActivityWorkStatus;
  hidden: boolean;
};

type ActivityItemEntry = {
  entry_kind: 'item';
  item: BuilderConversationItem;
  hidden: boolean;
};

type ActivityEntry =
  | ActivityItemEntry
  | ActivityWorkStatusEntry;

function workStatusBody(status: ActivityWorkStatus): string {
  if (status === 'started') return 'Preparing this request.';
  if (status === 'context_ready') return 'Reading the current project context.';
  if (status === 'provider_request_started') return 'Writing the response.';
  if (status === 'provider_response_received') return 'Checking the response.';
  return 'Preparing the result for review.';
}

function ActivityGlyph({ item }: Readonly<{ item: BuilderConversationItem }>) {
  if (item.item_kind === 'user_message') return <UserRound className="size-3.5" />;
  if (item.item_kind === 'run_started') return <Play className="size-3.5" />;
  if (item.item_kind === 'run_progress_recorded') return <RefreshCw className="size-3.5" />;
  if (item.item_kind === 'run_control_requested') return <StopCircle className="size-3.5" />;
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
    return item.message_kind === 'steering' ? 'You added context' : 'You';
  }
  if (item.item_kind === 'run_started') return 'Assistant is working';
  if (item.item_kind === 'run_progress_recorded') return progressLabel(item);
  if (item.item_kind === 'run_control_requested') {
    return item.action === 'interrupt' ? 'Interrupt requested' : 'Stop requested';
  }
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

function activityBody(item: BuilderConversationItem): string {
  if (item.item_kind === 'user_message') return item.message.text;
  if (item.item_kind === 'run_started') return 'Preparing this request.';
  if (item.item_kind === 'run_progress_recorded') return progressBody(item);
  if (item.item_kind === 'run_control_requested') {
    return item.action === 'interrupt'
      ? 'You asked to steer the current work.'
      : 'You asked to stop the current work.';
  }
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

function activityDisplayRole(item: BuilderConversationItem): 'assistant' | 'status' | 'user' {
  if (item.item_kind === 'user_message') return 'user';
  if (item.item_kind === 'run_completed' && item.assistant_message !== null) return 'assistant';
  return 'status';
}

function candidateAvailabilityNote(hasUnsavedDraft: boolean): string {
  return hasUnsavedDraft
    ? 'Review the draft preview, files, and changes before saving this version.'
    : 'Activity shows this draft summary only. Review appears only after Builder verifies and restores the files.';
}

function failedStatusMessage(
  status: BuilderProjectControllerStatus,
  error: BuilderProjectControllerSnapshot['error'],
): string {
  if (status === 'answer_failed') {
    if (error === 'builder_generation_provider_unavailable') return 'AI is not configured yet.';
    if (error === 'builder_generation_timeout') return 'Answering took too long. Try again.';
    if (error === 'builder_generation_provider_http_error') return 'The AI service could not answer. Try again.';
    return 'The answer could not be prepared. Try again.';
  }
  if (status === 'submit_failed') {
    if (error === 'builder_generation_project_workspace_required') return 'Choose or open a project folder before I build.';
    if (error === 'builder_generation_provider_unavailable') return 'AI is not configured yet.';
    if (error === 'builder_generation_timeout') return 'Working on this request took too long. Try again.';
    if (error === 'builder_generation_provider_http_error') return 'The AI service could not complete this request. Try again.';
    return 'This request could not be completed. Try again.';
  }
  if (error === 'builder_generation_project_workspace_required') return 'Choose or open a project folder before I make a draft.';
  if (error === 'builder_generation_provider_unavailable') return 'AI generation is not configured yet.';
  if (error === 'builder_generation_timeout') return 'Making this draft took too long. Try again.';
  if (error === 'builder_generation_provider_http_error') return 'The AI service could not make this draft. Try again.';
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
}: Readonly<{
  canReviewPlan: boolean;
  hasUnsavedDraft: boolean;
  item: BuilderConversationItem;
  onReviewPlan?: (request: BuilderPlanReviewRequest) => Promise<unknown> | void;
  planReviewBusy: boolean;
  planReviewFailed: boolean;
  planReviewRecorded: boolean;
  pendingPlanReview: BuilderPlanReviewRequest | null;
}>) {
  const displayRole = activityDisplayRole(item);
  const messageSurface = displayRole === 'user'
    ? 'bubble'
    : displayRole === 'assistant'
      ? 'plain'
      : 'status';
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
      data-builder-activity-card={activityTitle(item)}
      data-builder-activity-role={displayRole}
      data-builder-tool-activity={item.item_kind === 'tool_call_requested'
        ? 'requested'
        : item.item_kind === 'tool_call_result_recorded'
          ? item.result.status
          : undefined}
    >
      <div className="cf-builder-activity-icon" aria-hidden="true">
        <ActivityGlyph item={item} />
      </div>
      <div
        className="cf-builder-activity-content min-w-0"
        data-builder-message-surface={messageSurface}
      >
        <div className="cf-builder-activity-title">{activityTitle(item)}</div>
        <p className="cf-builder-activity-body">{activityBody(item)}</p>
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
}: Readonly<{
  entry: ActivityWorkStatusEntry;
}>) {
  return (
    <li
      className="cf-builder-activity-item"
      data-builder-activity-card="Assistant working"
      data-builder-activity-role="status"
      data-builder-work-status="true"
      data-builder-work-status-stage={entry.status}
    >
      <div className="cf-builder-activity-icon" aria-hidden="true">
        <RefreshCw className="size-3.5" />
      </div>
      <div
        className="cf-builder-activity-content min-w-0"
        data-builder-message-surface="status"
      >
        <div className="cf-builder-activity-title">Assistant is working</div>
        <p className="cf-builder-activity-body">{workStatusBody(entry.status)}</p>
      </div>
    </li>
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
}>) {
  const entries = activityEntries(snapshot);
  const visibleEntries = liveOutput === null
    ? entries
    : entries.filter((entry) => entry.entry_kind !== 'work_status');
  const message = activityMessage(snapshot);
  const canRefresh = snapshot !== null
    && snapshot.project_id !== null
    && !snapshot.busy
    && typeof onRefresh === 'function';
  return (
    <section
      aria-label="Project conversation"
      className="cf-builder-activity-panel cf-builder-chat-flow-surface"
      data-builder-activity="true"
      data-builder-activity-status={snapshot?.status ?? 'idle'}
      data-builder-conversation-workspace="true"
    >
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
      <div className="cf-builder-activity-body-wrap">
        {snapshot?.status === 'refreshing' && visibleEntries.length === 0 && liveOutput === null ? (
          <p className="cf-builder-activity-status" role="status">Refreshing activity...</p>
        ) : null}
        {visibleEntries.length === 0 && liveOutput === null && message !== null ? (
          <div className="cf-builder-empty cf-builder-activity-empty flex min-h-32 items-center justify-center border border-dashed px-3 text-center text-sm">
            {message}
          </div>
        ) : (
          <ol className="cf-builder-activity-list">
            {visibleEntries.map((entry) => (
              entry.entry_kind === 'work_status' ? (
                <ActivityWorkStatusItem entry={entry} key={entry.key} />
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
                />
              )
            ))}
            {liveOutput !== null ? (
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
  if (tab === 'source') return 'Source';
  if (tab === 'logs') return 'Logs';
  return 'Versions';
}

function ArtifactTabIcon({ tab }: Readonly<{ tab: BuilderArtifactTab }>) {
  if (tab === 'preview') return <Eye aria-hidden="true" className="size-3.5" />;
  if (tab === 'changes') return <GitCompareArrows aria-hidden="true" className="size-3.5" />;
  if (tab === 'source') return <FileCode2 aria-hidden="true" className="size-3.5" />;
  if (tab === 'logs') return <ListChecks aria-hidden="true" className="size-3.5" />;
  return <History aria-hidden="true" className="size-3.5" />;
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
      {entries.length === 0 && liveOutput === null ? (
        <div className="cf-builder-empty cf-builder-artifact-logs-empty flex min-h-24 items-center justify-center border border-dashed px-3 text-center text-sm">
          Work details will appear here when the assistant reads, plans, or prepares changes.
        </div>
      ) : (
        <ol className="cf-builder-activity-list cf-builder-artifact-logs-list">
          {entries.map((entry) => (
            entry.entry_kind === 'work_status' ? (
              <ActivityWorkStatusItem entry={entry} key={entry.key} />
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
              />
            )
          ))}
          {liveOutput !== null ? (
            <ActivityLiveOutputItem liveOutput={liveOutput} />
          ) : null}
        </ol>
      )}
    </section>
  );
}

function BuilderArtifactSummary({
  activeTab,
  changes,
  hasContent,
  onOpenChanges,
  onOpenPreview,
  preview,
  showChanges,
  showPreview,
}: Readonly<{
  activeTab: BuilderArtifactTab | null;
  changes: BuilderSourceTreeChanges;
  hasContent: boolean;
  onOpenChanges: () => void;
  onOpenPreview: () => void;
  preview: BuilderProjectControllerSnapshot['preview'];
  showChanges: boolean;
  showPreview: boolean;
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
      <div className="cf-builder-artifact-summary-actions">
        {showPreview ? (
          <button
            className="cf-builder-secondary-button inline-flex min-h-8 shrink-0 items-center justify-center gap-2 px-2.5 text-xs font-medium"
            data-active={activeTab === 'preview' ? 'true' : undefined}
            data-builder-open-artifact-preview="true"
            onClick={onOpenPreview}
            type="button"
          >
            <Eye aria-hidden="true" className="size-3.5" />
            Preview
          </button>
        ) : null}
        {showChanges ? (
          <button
            className="cf-builder-secondary-button inline-flex min-h-8 shrink-0 items-center justify-center gap-2 px-2.5 text-xs font-medium"
            data-active={activeTab === 'changes' ? 'true' : undefined}
            data-builder-open-artifact-changes="true"
            onClick={onOpenChanges}
            type="button"
          >
            <GitCompareArrows aria-hidden="true" className="size-3.5" />
            Changes
          </button>
        ) : null}
      </div>
    </section>
  );
}

function BuilderArtifactSidebar({
  activeTab,
  changes,
  changesOpen,
  files,
  hasSavedProject,
  hasUnsavedDraft,
  inspectedRevisionReceiptDigest,
  liveOutput,
  onClose,
  onInspectRevision,
  onOpenFile,
  onRefreshHistory,
  onRestoreRevisionAsDraft,
  onResizeStart,
  onSelectFile,
  onSelectTab,
  onSourceOpenChange,
  preview,
  previewPanelRef,
  sidebarRef,
  snapshot,
  sourceDisclosureOpen,
  sourceDisclosureRef,
  sourceFile,
  tabs,
  history,
}: Readonly<{
  activeTab: BuilderArtifactTab;
  changes: BuilderSourceTreeChanges;
  changesOpen: boolean;
  files: readonly BuilderProjectSourceFile[];
  hasSavedProject: boolean;
  hasUnsavedDraft: boolean;
  history: BuilderProjectHistorySnapshot | null;
  inspectedRevisionReceiptDigest: string | null;
  liveOutput: BuilderLiveOutputSnapshot | null;
  onClose: () => void;
  onInspectRevision?: (projectId: string, revisionReceiptDigest: string) => Promise<unknown> | void;
  onOpenFile: (change: BuilderSourceTreeChange) => void;
  onRefreshHistory?: () => Promise<unknown> | void;
  onRestoreRevisionAsDraft?: (projectId: string, revisionReceiptDigest: string) => Promise<unknown> | void;
  onResizeStart: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onSelectFile?: (file: BuilderFileName) => void;
  onSelectTab: (tab: BuilderArtifactTab) => void;
  onSourceOpenChange: (open: boolean) => void;
  preview: BuilderProjectControllerSnapshot['preview'];
  previewPanelRef?: Ref<HTMLElement>;
  sidebarRef?: Ref<HTMLElement>;
  snapshot: BuilderConversationControllerSnapshot | null;
  sourceDisclosureOpen: boolean;
  sourceDisclosureRef: Ref<HTMLDetailsElement>;
  sourceFile: BuilderProjectSourceFile | null;
  tabs: readonly BuilderArtifactTab[];
}>) {
  return (
    <aside
      aria-label="Project artifact"
      className="cf-builder-artifact-sidebar"
      data-builder-artifact-sidebar="true"
      data-builder-artifact-tab-active={activeTab}
      ref={sidebarRef}
    >
      <button
        aria-label="Resize artifact"
        className="cf-builder-artifact-resize-handle"
        data-builder-artifact-resize-handle="true"
        onPointerDown={onResizeStart}
        type="button"
      />
      <header className="cf-builder-artifact-header">
        <div className="min-w-0">
          <p className="cf-builder-artifact-kicker">Artifact</p>
          <h3 className="cf-builder-artifact-title">{artifactTabLabel(activeTab)}</h3>
        </div>
        <div className="cf-builder-artifact-header-actions">
          <div className="cf-builder-artifact-tabs" role="tablist" aria-label="Artifact views">
            {tabs.map((tab) => (
              <button
                aria-selected={activeTab === tab}
                className="cf-builder-artifact-tab"
                data-active={activeTab === tab ? 'true' : undefined}
                data-builder-artifact-tab={tab}
                key={tab}
                onClick={() => onSelectTab(tab)}
                role="tab"
                type="button"
              >
                <ArtifactTabIcon tab={tab} />
                <span>{artifactTabLabel(tab)}</span>
              </button>
            ))}
          </div>
          <button
            aria-label="Close artifact"
            className="cf-builder-secondary-button cf-builder-icon-button inline-flex size-8 items-center justify-center"
            data-builder-close-artifact-sidebar="true"
            onClick={onClose}
            type="button"
          >
            <X aria-hidden="true" className="size-3.5" />
          </button>
        </div>
      </header>
      <div className="cf-builder-artifact-body" data-builder-artifact-body="true">
        {activeTab === 'preview' ? (
          <BuilderResultPanel panelRef={previewPanelRef} placement="artifact" projection={preview} />
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
        {activeTab === 'source' && sourceFile !== null ? (
          <BuilderSourceDisclosure
            canToggle
            disclosureRef={sourceDisclosureRef}
            files={files}
            onOpenChange={onSourceOpenChange}
            onSelectFile={onSelectFile}
            open={sourceDisclosureOpen}
            placement="artifact"
            sourceFile={sourceFile}
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
      </div>
    </aside>
  );
}

export function BuilderPage({
  instruction,
  onApprovePlanSourceRead,
  onCancel,
  onCreateProject,
  onDismissWorkspacePicker,
  onDismissPlanSourceReadApproval,
  onInstructionChange,
  onOpenProject,
  onSteerInstruction,
  onProposePlan,
  onSubmitInstruction,
  onRetryGenerate,
  onRefreshConversation,
  onRefreshHistory,
  onRejectDraft,
  onReviewPlan,
  onRestoreRevisionAsDraft,
  onSave,
  onInspectRevision,
  onShowCurrentRevision,
  onOpenSettings,
  conversationSnapshot,
  projectCatalogSnapshot,
  historySnapshot,
  snapshot,
  activeFile,
  approvedPlanContinuationFailure = null,
  liveOutput = null,
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
  const canAddContext = typeof onSteerInstruction === 'function'
    && busy
    && !hasUnsavedDraft
    && !viewingHistory
    && (status === 'answering' || status === 'generating' || status === 'submitting');
  const canSubmit = typeof onSubmitInstruction === 'function'
    && GENERATABLE_STATUSES.has(status)
    && !viewingHistory
    && instruction.trim().length > 0;
  const canSubmitComposer = canSubmit || (canAddContext && instruction.trim().length > 0);
  const canSave = typeof onSave === 'function' && hasUnsavedDraft && !busy;
  const canReject = typeof onRejectDraft === 'function' && hasUnsavedDraft && !busy;
  const canCancel = typeof onCancel === 'function'
    && (status === 'answering' || status === 'generating' || status === 'submitting');
  const canEditInstruction = typeof onInstructionChange === 'function'
    && !viewingHistory
    && (!busy || canAddContext);
  const failed = status === 'generation_failed' || status === 'answer_failed' || status === 'submit_failed';
  const canRetryGenerate = typeof onRetryGenerate === 'function'
    && (status === 'generation_failed' || status === 'submit_failed')
    && current?.retryableGeneration === true
    && isRetryableGenerationError(current.error);
  const canOpenSettings = failed
    && current?.error === 'builder_generation_provider_unavailable'
    && typeof onOpenSettings === 'function';
  const activity = visibleActivitySnapshot(conversationSnapshot);
  const history = visibleHistorySnapshot(historySnapshot);
  const visibleLiveOutput = liveOutput;
  const showActivity = shouldShowActivityPanel(activity) || visibleLiveOutput !== null;
  const showLogsPanel = artifactLogEntries(activity).length > 0 || visibleLiveOutput !== null;
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
  const canProposePlan = typeof onProposePlan === 'function'
    && saved !== null
    && !busy
    && !hasUnsavedDraft
    && !viewingHistory
    && (status === 'ready' || status === 'preview_unavailable')
    && instruction.trim().length > 0;
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
  ].join('|');
  const artifactTabs = useMemo(() => {
    const tabs: BuilderArtifactTab[] = [];
    if (showResultFlow) tabs.push('preview');
    if (hasUnsavedDraft) tabs.push('changes');
    if (sourceFile !== null) tabs.push('source');
    if (showVersionHistoryPanel) tabs.push('versions');
    if (showLogsPanel) tabs.push('logs');
    return tabs;
  }, [hasUnsavedDraft, showLogsPanel, showResultFlow, showVersionHistoryPanel, sourceFile]);
  const defaultArtifactTab: BuilderArtifactTab | null = selected !== null && sourceFile !== null
    ? 'source'
    : viewingHistory && showResultFlow
      ? 'preview'
    : hasUnsavedDraft && showResultFlow
      ? 'preview'
      : showVersionHistoryPanel
        ? 'versions'
        : showResultFlow
          ? 'preview'
          : sourceFile !== null
            ? 'source'
            : hasUnsavedDraft
              ? 'changes'
              : showLogsPanel
                ? 'logs'
                : null;
  const [artifactPanelState, setArtifactPanelState] = useState<Readonly<{
    active: BuilderArtifactTab | null;
    identity: string;
  }>>(() => ({
    active: defaultArtifactTab,
    identity: artifactPanelIdentity,
  }));
  const requestedArtifactTab = artifactPanelState.identity === artifactPanelIdentity
    ? artifactPanelState.active
    : defaultArtifactTab;
  const activeArtifactTab = requestedArtifactTab !== null && artifactTabs.includes(requestedArtifactTab)
    ? requestedArtifactTab
    : null;
  const showArtifactSidebar = activeArtifactTab !== null;
  const showChangesPanel = activeArtifactTab === 'changes' && hasUnsavedDraft;
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
      setArtifactWidth((currentWidth) => clampArtifactWidth(currentWidth, maximum));
    }

    clampForCurrentShell();
    window.addEventListener('resize', clampForCurrentShell);
    return () => {
      window.removeEventListener('resize', clampForCurrentShell);
    };
  }, [showArtifactSidebar]);

  const activityFollowCursor = (() => {
    const liveCursor = visibleLiveOutput === null
      ? 'no-live-output'
      : `${visibleLiveOutput.request_id}:${visibleLiveOutput.chunk_count}:${visibleLiveOutput.text}`;
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
    const scrollDraftReviewIntoView = () => {
      if (cancelled) return;
      const landingTarget = draftReviewRef.current
        ?? draftLandingRef.current
        ?? (showResultFlow ? resultFlowRef.current : null);
      if (landingTarget !== null) {
        scrollElementToChatStart(chatScrollRef.current, landingTarget);
      }
    };
    scrollDraftReviewIntoView();
    const frame = window.requestAnimationFrame(scrollDraftReviewIntoView);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
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
      if (panelState.identity === artifactPanelIdentity && panelState.active === active) {
        return panelState;
      }
      return {
        active,
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

  function closeArtifactSidebar(): void {
    shouldFollowChatRef.current = false;
    setActiveArtifactTab(null);
  }

  function startArtifactResize(event: ReactPointerEvent<HTMLButtonElement>): void {
    event.preventDefault();
    const sidebar = artifactSidebarRef.current;
    const startWidth = sidebar?.getBoundingClientRect().width ?? artifactWidth;
    const startX = event.clientX;

    function onPointerMove(moveEvent: globalThis.PointerEvent): void {
      const shellWidth = chatShellRef.current?.getBoundingClientRect().width ?? Number.NaN;
      setArtifactWidth(clampArtifactWidth(
        startWidth + startX - moveEvent.clientX,
        artifactMaxWidthForShell(shellWidth),
      ));
    }

    function stopResize(): void {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', stopResize);
      window.removeEventListener('pointercancel', stopResize);
    }

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', stopResize, { once: true });
    window.addEventListener('pointercancel', stopResize, { once: true });
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

  function openChangesPanel(): void {
    pendingChangesFocusRef.current = true;
    shouldFollowChatRef.current = false;
    openArtifactTab('changes');
    const disclosure = document.querySelector<HTMLDetailsElement>('[data-builder-changes-disclosure="true"]');
    if (disclosure !== null) {
      pendingChangesFocusRef.current = false;
      disclosure.open = true;
      disclosure.focus({ preventScroll: true });
      return;
    }
    document.getElementById('builder-tool-changes')?.focus({ preventScroll: true });
  }

  function openPreviewPanel(): void {
    openArtifactTab('preview');
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
    if (status === 'saving') {
      return (
        <p
          className="cf-builder-alert cf-builder-alert-info cf-builder-chat-notice text-sm"
          data-builder-conversation-notice="saving"
          role="status"
        >
          Saving this version...
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
    if (failed) {
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
      changes={changes}
      checkpointRef={draftReviewRef}
      discardLabel={status === 'rejecting' ? 'Discarding...' : 'Discard draft'}
      hasContent={hasContent}
      onOpenChanges={openChangesPanel}
      onOpenPreview={openPreviewPanel}
      onRejectDraft={onRejectDraft}
      onSave={onSave}
      preview={preview}
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
          <p className="cf-builder-review-summary">
            I need to read {planSourceReadApproval.file_count === 1
              ? 'one project file'
              : `${planSourceReadApproval.file_count} project files`} to make a useful plan.
          </p>
          <p className="cf-builder-review-note">
            This only prepares the plan. It will not change files or save a version.
          </p>
        </div>
      </div>
      <div className="cf-builder-review-actions" data-builder-plan-source-read-actions="true">
        {planSourceReadApproval.state === 'failed' ? (
          <p className="cf-builder-review-note" role="alert">
            I could not record that approval. Try again.
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

  const composer = (
    <BuilderComposer
      busy={busy}
      canAddContext={canAddContext}
      canCancel={canCancel}
      canEditInstruction={canEditInstruction}
      canProposePlan={canProposePlan}
      canSubmit={canSubmit}
      canSubmitComposer={canSubmitComposer}
      catalogBusy={catalogBusy}
      catalogProjects={catalogProjects}
      catalogWorkspaceProjects={catalogWorkspaceProjects}
      hasUnsavedDraft={hasUnsavedDraft}
      instruction={instruction}
      onCancel={onCancel}
      onCreateProject={onCreateProject}
      onDismissWorkspacePicker={onDismissWorkspacePicker}
      onFocusDraftReview={focusDraftReview}
      onInstructionChange={onInstructionChange}
      onOpenProject={onOpenProject}
      onProposePlan={onProposePlan}
      onSteerInstruction={onSteerInstruction}
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
      activeTab={activeArtifactTab}
      changes={changes}
      hasContent={hasContent}
      onOpenChanges={openChangesPanel}
      onOpenPreview={openPreviewPanel}
      preview={preview}
      showChanges={hasUnsavedDraft}
      showPreview={showResultFlow}
    />
  ) : null;
  const artifactSidebar = showArtifactSidebar && activeArtifactTab !== null ? (
    <BuilderArtifactSidebar
      activeTab={activeArtifactTab}
      changes={changes}
      changesOpen={activeArtifactTab === 'changes' || changesPanelOpen}
      files={files}
      hasSavedProject={saved !== null}
      hasUnsavedDraft={hasUnsavedDraft}
      history={history}
      inspectedRevisionReceiptDigest={inspected?.target.revision_receipt_digest ?? null}
      liveOutput={visibleLiveOutput}
      onClose={closeArtifactSidebar}
      onInspectRevision={onInspectRevision}
      onOpenFile={openChangedFile}
      onRefreshHistory={onRefreshHistory}
      onResizeStart={startArtifactResize}
      onRestoreRevisionAsDraft={onRestoreRevisionAsDraft}
      onSelectFile={onSelectFile}
      onSelectTab={openArtifactTab}
      onSourceOpenChange={setSourceDisclosureOpen}
      preview={preview}
      previewPanelRef={resultFlowRef}
      sidebarRef={artifactSidebarRef}
      snapshot={activity}
      sourceDisclosureOpen={sourceDisclosureOpen}
      sourceDisclosureRef={sourceDisclosureRef}
      sourceFile={sourceFile}
      tabs={artifactTabs}
    />
  ) : null;

  return (
    <div
      className="cf-builder-page bg-background text-foreground"
      data-builder-page="true"
      data-builder-project-status={status}
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
                setArtifactPanelState({
                  active: showResultFlow ? 'preview' : 'versions',
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
                  snapshot={activity}
                />
              ) : null}
              {planSourceReadApprovalCard}

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
    </div>
  );
}
