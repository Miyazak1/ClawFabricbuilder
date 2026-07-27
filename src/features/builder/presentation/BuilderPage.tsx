import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  AlertCircle,
  ArrowUp,
  Bot,
  CheckCircle2,
  Eye,
  FileCode2,
  GitCompareArrows,
  History,
  ListChecks,
  Play,
  RefreshCw,
  Save,
  StopCircle,
  Trash2,
  UserRound,
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
import { BuilderStaticPreview } from '../components/BuilderStaticPreview';
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
import type {
  BuilderSourceTreePreviewProjection,
  BuilderSourceTreePreviewRuntimeLimitation,
} from '../preview/builderSourceTreePreview';

export type BuilderFileName = string;

export type BuilderLiveOutputSnapshot = Readonly<{
  state: 'streaming';
  request_id: string;
  project_id: string;
  text: string;
  chunk_count: number;
}>;

export type BuilderPageProps = {
  instruction: string;
  liveOutput?: BuilderLiveOutputSnapshot | null;
  onInstructionChange?: (value: string) => void;
  onCancel?: () => void;
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
  onShowCurrentRevision?: () => Promise<unknown> | void;
  onOpenSettings?: () => void;
  conversationSnapshot?: BuilderConversationControllerSnapshot;
  historySnapshot?: BuilderProjectHistorySnapshot;
  snapshot: BuilderProjectControllerSnapshot;
  activeFile: BuilderFileName | null;
  onSelectFile?: (file: BuilderFileName) => void;
};

const GENERATABLE_STATUSES = new Set<BuilderProjectControllerStatus>([
  'new',
  'ready',
  'answer_failed',
  'submit_failed',
  'generation_failed',
  'preview_unavailable',
]);
const CHAT_FOLLOW_BOTTOM_THRESHOLD_PX = 96;

function isBuilderGenerationDiagnosticCode(
  value: BuilderProjectControllerSnapshot['error'],
): value is keyof typeof BUILDER_GENERATION_DIAGNOSTIC_RETRYABILITY {
  return value !== null && Object.hasOwn(BUILDER_GENERATION_DIAGNOSTIC_RETRYABILITY, value);
}

function isRetryableGenerationError(value: BuilderProjectControllerSnapshot['error']): boolean {
  return isBuilderGenerationDiagnosticCode(value) && BUILDER_GENERATION_DIAGNOSTIC_RETRYABILITY[value];
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
      const workEntry = workEntries.get(`${item.turn_id}:${item.run_id}`);
      if (workEntry !== undefined) workEntry.hidden = true;
    }
    entries.push({ entry_kind: 'item', item, hidden: false });
  }
  return entries.filter((entry) => !entry.hidden);
}

function isNearChatBottom(element: HTMLElement): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= CHAT_FOLLOW_BOTTOM_THRESHOLD_PX;
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
  const subject = toolActivitySubject(item.action);
  if (item.result.status === 'succeeded') return `${subject} finished`;
  if (item.result.status === 'cancelled') return `${subject} stopped`;
  return `${subject} needs attention`;
}

function toolResultBody(
  item: Extract<BuilderConversationItem, { item_kind: 'tool_call_result_recorded' }>,
): string {
  if (item.result.summary_code === 'completed_without_raw_output') return 'This project step finished.';
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

function changesSummary(changes: BuilderSourceTreeChanges): string {
  if (changes.comparison_kind === 'no_draft') return 'No unsaved changes to review.';
  if (changes.total_count === 0) return 'This draft has no file changes.';
  const parts = [
    changes.added_count === 0 ? null : `${changes.added_count} added`,
    changes.modified_count === 0 ? null : `${changes.modified_count} changed`,
    changes.deleted_count === 0 ? null : `${changes.deleted_count} removed`,
  ].filter((part): part is string => part !== null);
  return `${changes.total_count} file ${changes.total_count === 1 ? 'change' : 'changes'}: ${parts.join(', ')}.`;
}

function reviewPreviewStatus(preview: BuilderSourceTreePreviewProjection | null, hasContent: boolean): string {
  if (preview !== null) {
    const labels = previewLimitationLabels(preview.preview_runtime_limitations);
    if (labels.length > 0) {
      return `Preview may be incomplete: interactive code is not running here (${labels.join(', ')}). If it looks blank, the files may still be ready; open Changes or Source before saving.`;
    }
    return 'Static preview is ready. HTML and CSS are shown here; interactive code is not running in this preview.';
  }
  return hasContent
    ? 'Preview unavailable. JavaScript modules, Three.js, canvas animation, network assets, local servers, or backend code need live preview support.'
    : 'Review this draft before saving.';
}

function previewLimitationLabels(
  limitations: readonly BuilderSourceTreePreviewRuntimeLimitation[],
): readonly string[] {
  const labels: string[] = [];
  for (const limitation of limitations) {
    if (limitation === 'javascript_module') labels.push('JavaScript modules');
    else if (limitation === 'three_js') labels.push('Three.js/WebGL');
    else if (limitation === 'canvas_animation') labels.push('canvas animation');
    else if (limitation === 'network_or_external_asset') labels.push('external assets');
    else if (limitation === 'backend_or_local_server') labels.push('local app runtime');
    else if (limitation === 'javascript_removed' && !limitations.includes('javascript_module')) {
      labels.push('JavaScript');
    }
  }
  return labels.slice(0, 4);
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
    if (error === 'builder_generation_provider_unavailable') return 'AI is not configured yet.';
    if (error === 'builder_generation_timeout') return 'Working on this request took too long. Try again.';
    if (error === 'builder_generation_provider_http_error') return 'The AI service could not complete this request. Try again.';
    return 'This request could not be completed. Try again.';
  }
  if (error === 'builder_generation_provider_unavailable') return 'AI generation is not configured yet.';
  if (error === 'builder_generation_timeout') return 'Making this draft took too long. Try again.';
  if (error === 'builder_generation_provider_http_error') return 'The AI service could not make this draft. Try again.';
  if (error === 'builder_generation_structured_response_invalid') return 'The draft could not be prepared. Try again.';
  return 'The draft could not be made. Try again.';
}

function changeLabel(change: BuilderSourceTreeChange): string {
  if (change.change_kind === 'added') return 'Added';
  if (change.change_kind === 'deleted') return 'Removed';
  return 'Changed';
}

function lineSummary(change: BuilderSourceTreeChange): string {
  if (change.change_kind === 'added') {
    return `${change.after_line_count} ${change.after_line_count === 1 ? 'line' : 'lines'} added`;
  }
  if (change.change_kind === 'deleted') {
    return `${change.before_line_count} ${change.before_line_count === 1 ? 'line' : 'lines'} removed`;
  }
  return `${change.before_line_count} ${change.before_line_count === 1 ? 'line' : 'lines'} to ${change.after_line_count} ${change.after_line_count === 1 ? 'line' : 'lines'}`;
}

function diffMarker(lineKind: BuilderSourceTreeChange['diff_lines'][number]['line_kind']): string {
  if (lineKind === 'added') return '+';
  if (lineKind === 'removed') return '-';
  return ' ';
}

function lineNumberLabel(value: number | null): string {
  return value === null ? '' : String(value);
}

function ChangesPanel({
  changes,
  open,
  onOpenChange,
  onOpenFile,
}: Readonly<{
  changes: BuilderSourceTreeChanges;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenFile: (change: BuilderSourceTreeChange) => void;
}>) {
  return (
    <section
      aria-label="Project changes"
      className="cf-builder-changes-panel"
      data-builder-changes-panel="true"
      id="builder-tool-changes"
      tabIndex={-1}
    >
      <details
        className="cf-builder-changes-disclosure"
        data-builder-changes-disclosure="true"
        onToggle={(event) => onOpenChange(event.currentTarget.open)}
        open={open}
        tabIndex={-1}
      >
        <summary className="cf-builder-panel-toolbar cf-builder-changes-summary-row">
          <GitCompareArrows aria-hidden="true" className="size-4" />
          <span className="cf-builder-changes-summary-main">
            <span className="cf-builder-changes-title">Changes</span>
            <span className="cf-builder-changes-summary" data-builder-changes-summary="true">
              {changesSummary(changes)}
            </span>
          </span>
        </summary>
        <div className="cf-builder-changes-body">
          {changes.files.length === 0 ? (
            <div className="cf-builder-empty flex min-h-32 items-center justify-center border border-dashed px-4 text-center text-sm">
              {changes.comparison_kind === 'no_draft'
                ? 'Make a draft to compare it with the current version.'
                : 'No file changes were found in this draft.'}
            </div>
          ) : (
            <ol className="cf-builder-changes-list">
              {changes.files.map((change) => (
                <li
                  className="cf-builder-change-item"
                  data-builder-change-card={`${changeLabel(change)} ${change.path}`}
                  data-builder-change-kind={change.change_kind}
                  key={`${change.change_kind}:${change.path}`}
                >
                  <span className="cf-builder-change-kind">{changeLabel(change)}</span>
                  <div className="min-w-0">
                    {change.change_kind === 'deleted' ? (
                      <span className="cf-builder-change-path">{change.path}</span>
                    ) : (
                      <button
                        className="cf-builder-change-path-button"
                        onClick={() => onOpenFile(change)}
                        type="button"
                      >
                        {change.path}
                      </button>
                    )}
                    <p className="cf-builder-change-lines">{lineSummary(change)}</p>
                    {change.diff_availability === 'too_large' ? (
                      <p className="cf-builder-change-diff-note" data-builder-change-diff-note={change.path}>
                        This change is too large for the inline comparison.
                      </p>
                    ) : (
                      <div
                        aria-label={`${change.path} comparison`}
                        className="cf-builder-change-diff"
                        data-builder-change-diff={change.path}
                      >
                        {change.diff_lines.map((line, index) => (
                          <div
                            className="cf-builder-change-diff-line"
                            data-builder-change-diff-line-kind={line.line_kind}
                            key={`${line.line_kind}:${line.before_line ?? ''}:${line.after_line ?? ''}:${index}`}
                          >
                            <span className="cf-builder-change-diff-number" aria-hidden="true">
                              {lineNumberLabel(line.before_line)}
                            </span>
                            <span className="cf-builder-change-diff-number" aria-hidden="true">
                              {lineNumberLabel(line.after_line)}
                            </span>
                            <span className="cf-builder-change-diff-marker" aria-hidden="true">
                              {diffMarker(line.line_kind)}
                            </span>
                            <code className="cf-builder-change-diff-text">
                              {line.text}
                            </code>
                          </div>
                        ))}
                        {change.omitted_line_count > 0 ? (
                          <p className="cf-builder-change-diff-note">
                            {change.omitted_line_count} {change.omitted_line_count === 1 ? 'line' : 'lines'} not shown.
                          </p>
                        ) : null}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </details>
    </section>
  );
}

function VersionItem({
  inspectedRevisionReceiptDigest,
  onInspectRevision,
  revision,
}: Readonly<{
  inspectedRevisionReceiptDigest: string | null;
  onInspectRevision?: (projectId: string, revisionReceiptDigest: string) => Promise<unknown> | void;
  revision: BuilderProjectHistoryRevision;
}>) {
  const isInspected = inspectedRevisionReceiptDigest === revision.revision_receipt_digest;
  const showAction = isInspected || !revision.is_current;
  const canInspect = !isInspected
    && !revision.is_current
    && typeof onInspectRevision === 'function';
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
      ) : null}
    </li>
  );
}

function VersionHistoryPanel({
  hasSavedProject,
  inspectedRevisionReceiptDigest,
  onInspectRevision,
  onRefresh,
  snapshot,
}: Readonly<{
  hasSavedProject: boolean;
  inspectedRevisionReceiptDigest: string | null;
  onInspectRevision?: (projectId: string, revisionReceiptDigest: string) => Promise<unknown> | void;
  onRefresh?: () => Promise<unknown> | void;
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
                revision={revision}
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
  pendingPlanReview,
}: Readonly<{
  canReviewPlan: boolean;
  hasUnsavedDraft: boolean;
  item: BuilderConversationItem;
  onReviewPlan?: (request: BuilderPlanReviewRequest) => Promise<unknown> | void;
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
    if (pendingPlanReview === null || typeof onReviewPlan !== 'function') return;
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
          <div className="cf-builder-plan-review-actions" data-builder-plan-review-actions="true">
            <p className="cf-builder-activity-note">
              Approve this plan to let the assistant continue. Reject it to keep the project unchanged.
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
          {hasText ? liveOutput.text : "I'm working on this..."}
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
  pendingPlanReview,
  canReviewPlan,
}: Readonly<{
  canReviewPlan: boolean;
  hasUnsavedDraft: boolean;
  liveOutput: BuilderLiveOutputSnapshot | null;
  snapshot: BuilderConversationControllerSnapshot | null;
  onRefresh?: () => Promise<unknown> | void;
  onReviewPlan?: (request: BuilderPlanReviewRequest) => Promise<unknown> | void;
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

function StarterPrompt() {
  return (
    <div
      aria-label="Conversation starter"
      className="cf-builder-starter-card cf-builder-chat-flow-surface"
      data-builder-starter-card="true"
    >
      <div className="cf-builder-starter-icon" aria-hidden="true">
        <Bot className="size-3.5" />
      </div>
      <div
        className="cf-builder-starter-content min-w-0"
        data-builder-message-surface="plain"
      >
        <div className="cf-builder-starter-title">ClawFabric Builder</div>
        <p className="cf-builder-starter-body">What are we building today?</p>
      </div>
    </div>
  );
}

export function BuilderPage({
  instruction,
  onCancel,
  onInstructionChange,
  onSteerInstruction,
  onProposePlan,
  onSubmitInstruction,
  onRetryGenerate,
  onRefreshConversation,
  onRefreshHistory,
  onRejectDraft,
  onReviewPlan,
  onSave,
  onInspectRevision,
  onShowCurrentRevision,
  onOpenSettings,
  conversationSnapshot,
  historySnapshot,
  snapshot,
  activeFile,
  liveOutput = null,
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
  const version = saved?.target.revision_number ?? null;
  const canAddContext = typeof onSteerInstruction === 'function'
    && busy
    && !hasUnsavedDraft
    && !viewingHistory
    && (status === 'answering' || status === 'generating' || status === 'submitting');
  const canSubmit = typeof onSubmitInstruction === 'function'
    && GENERATABLE_STATUSES.has(status)
    && !hasUnsavedDraft
    && !viewingHistory
    && instruction.trim().length > 0;
  const canSubmitComposer = canSubmit || (canAddContext && instruction.trim().length > 0);
  const canSave = typeof onSave === 'function' && hasUnsavedDraft && !busy;
  const canReject = typeof onRejectDraft === 'function' && hasUnsavedDraft && !busy;
  const canCancel = typeof onCancel === 'function'
    && (status === 'answering' || status === 'generating' || status === 'submitting');
  const canEditInstruction = typeof onInstructionChange === 'function'
    && !hasUnsavedDraft
    && !viewingHistory
    && (!busy || canAddContext);
  const failed = status === 'generation_failed' || status === 'answer_failed' || status === 'submit_failed';
  const canRetryGenerate = typeof onRetryGenerate === 'function'
    && status === 'generation_failed'
    && current?.retryableGeneration === true
    && isRetryableGenerationError(current.error);
  const canOpenSettings = failed
    && current?.error === 'builder_generation_provider_unavailable'
    && typeof onOpenSettings === 'function';
  const activity = visibleActivitySnapshot(conversationSnapshot);
  const history = visibleHistorySnapshot(historySnapshot);
  const visibleLiveOutput = liveOutput;
  const showActivity = shouldShowActivityPanel(activity) || visibleLiveOutput !== null;
  const planReviewTarget = pendingPlanReviewTarget(activity);
  const canReviewPlan = typeof onReviewPlan === 'function'
    && planReviewTarget !== null
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
  const sourceDisclosureRef = useRef<HTMLDetailsElement | null>(null);
  const draftReviewRef = useRef<HTMLElement | null>(null);
  const resultFlowRef = useRef<HTMLElement | null>(null);
  const pendingChangesFocusRef = useRef(false);
  const pendingSourceFocusRef = useRef(false);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const chatTailRef = useRef<HTMLDivElement | null>(null);
  const shouldFollowChatRef = useRef(true);
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
  const showChangesPanel = hasUnsavedDraft && changesPanelOpen;
  const showReviewSidebar = saved !== null && !hasUnsavedDraft;
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
    if (!shouldFollowChatRef.current) return;
    chatTailRef.current?.scrollIntoView?.({ block: 'end' });
  }, [chatFollowKey]);

  useEffect(() => {
    if (!hasUnsavedDraft) return;
    const landingTarget = draftReviewRef.current ?? (showResultFlow ? resultFlowRef.current : null);
    landingTarget?.scrollIntoView?.({ block: 'start' });
  }, [draft?.draft_id, hasUnsavedDraft, showResultFlow]);

  useEffect(() => {
    if (!pendingChangesFocusRef.current || !showChangesPanel) return;
    const disclosure = document.querySelector<HTMLDetailsElement>('[data-builder-changes-disclosure="true"]');
    if (disclosure === null) return;
    pendingChangesFocusRef.current = false;
    disclosure.focus();
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

  function selectFile(path: string): boolean {
    if (typeof onSelectFile !== 'function') return false;
    onSelectFile(path);
    return true;
  }

  function openChangedFile(change: BuilderSourceTreeChange): void {
    if (change.change_kind === 'deleted') return;
    if (!selectFile(change.path)) return;
    pendingSourceFocusRef.current = true;
    const disclosure = sourceDisclosureRef.current;
    if (disclosure !== null) {
      pendingSourceFocusRef.current = false;
      disclosure.focus();
    }
  }

  function openChangesPanel(): void {
    pendingChangesFocusRef.current = true;
    setChangesPanelOpen(true);
    const disclosure = document.querySelector<HTMLDetailsElement>('[data-builder-changes-disclosure="true"]');
    if (disclosure !== null) {
      pendingChangesFocusRef.current = false;
      disclosure.open = true;
      disclosure.focus();
      return;
    }
    document.getElementById('builder-tool-changes')?.focus();
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

  const composerStatusLabel = (() => {
    if (canAddContext) return 'Add context';
    if (status === 'submitting') return 'Working';
    if (status === 'generating') return 'Making your draft';
    if (status === 'answering') return 'Answering';
    if (status === 'restoring') return 'Restoring draft';
    if (viewingHistory) return 'Viewing a saved version';
    if (hasUnsavedDraft) return 'Review draft before continuing';
    return saved ? 'Continue this project' : 'Start from an idea';
  })();
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
          <p>{failedStatusMessage(status, current?.error ?? null)}</p>
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
  const showStarterPrompt = status === 'new'
    && !showActivity
    && !hasUnsavedDraft
    && !busy
    && sourceFile === null
    && showResultFlow === false
    && conversationNotice === null;

  const draftReview = hasUnsavedDraft ? (
    <section
      aria-label="Draft review"
      className="cf-builder-review-checkpoint cf-builder-chat-flow-surface"
      data-builder-review-layout="action-row"
      data-builder-review-checkpoint="true"
      ref={draftReviewRef}
    >
      <div className="cf-builder-review-copy">
        <div className="cf-builder-review-icon" aria-hidden="true">
          <GitCompareArrows className="size-4" />
        </div>
        <div className="min-w-0">
          <h2 className="cf-builder-review-title">Review before saving</h2>
          <p className="cf-builder-review-summary" data-builder-review-summary="true">
            {changesSummary(changes)}
          </p>
          <p className="cf-builder-review-note">
            {reviewPreviewStatus(preview, hasContent)}
          </p>
        </div>
      </div>
      <div className="cf-builder-review-actions" data-builder-draft-review-actions="true">
        <button
          className="cf-builder-secondary-button inline-flex min-h-8 shrink-0 items-center justify-center gap-2 px-2.5 text-xs font-medium"
          data-builder-review-open-changes="true"
          onClick={openChangesPanel}
          type="button"
        >
          <GitCompareArrows aria-hidden="true" className="size-3.5" />
          Changes
        </button>
        <button
          className="cf-builder-secondary-button inline-flex min-h-8 shrink-0 items-center justify-center gap-2 px-2.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50"
          data-builder-discard-draft="true"
          disabled={!canReject}
          onClick={onRejectDraft}
          type="button"
        >
          <Trash2 aria-hidden="true" className="size-3.5" />
          {status === 'rejecting' ? 'Discarding...' : 'Discard draft'}
        </button>
        <button
          className="cf-builder-primary-button inline-flex min-h-8 shrink-0 items-center justify-center gap-2 px-2.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50"
          data-builder-save-version="true"
          disabled={!canSave}
          onClick={onSave}
          type="button"
        >
          <Save aria-hidden="true" className="size-3.5" />
          {status === 'saving'
            ? 'Saving...'
            : status === 'save_unknown'
              ? 'Try Save again'
              : 'Save version'}
        </button>
      </div>
    </section>
  ) : null;

  const composer = (
    <section aria-label="Conversation command" className="cf-builder-composer-card" data-builder-composer="true">
      <div className="cf-builder-composer-shell">
        <textarea
          aria-label="What do you want to build?"
          className="cf-builder-input cf-builder-composer-textarea w-full resize-none text-sm"
          disabled={busy && !canAddContext}
          id="builder-idea"
          maxLength={4000}
          onChange={(event) => onInstructionChange?.(event.currentTarget.value)}
          onKeyDown={submitPrimaryComposerCommand}
          placeholder={canAddContext
            ? 'Add context for the current work...'
            : busy
              ? 'Working on your request...'
              : 'Describe what you want to build or change...'}
          readOnly={!canEditInstruction}
          aria-keyshortcuts={canSubmitComposer ? 'Enter' : undefined}
          value={instruction}
        />
        <footer className="cf-builder-composer-footer">
          <div className="cf-builder-composer-tools">
            <span className="cf-builder-status-pill">
              {composerStatusLabel}
            </span>
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
            {hasUnsavedDraft || (busy && !canAddContext) ? null : (
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
      </div>
    </section>
  );

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
          data-builder-chat-workspace="true"
          data-builder-review-sidebar-mode={showReviewSidebar ? 'summary' : 'hidden'}
          data-builder-review-sidebar-visible={showReviewSidebar ? 'true' : 'false'}
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
                  pendingPlanReview={planReviewTarget}
                  snapshot={activity}
                />
              ) : null}
              {showStarterPrompt ? <StarterPrompt /> : null}

              {draftReview}

              {showChangesPanel ? (
                <div className="cf-builder-chat-flow-surface cf-builder-changes-flow" data-builder-changes-flow="true">
                  <ChangesPanel
                    changes={changes}
                    onOpenChange={setChangesPanelOpen}
                    onOpenFile={openChangedFile}
                    open={changesPanelOpen}
                  />
                </div>
              ) : null}

              {showResultFlow ? (
                <section
                  aria-label="Project result"
                  className="cf-builder-flow-card cf-builder-preview-panel cf-builder-result-card cf-builder-chat-flow-surface"
                  data-builder-preview-flow="true"
                  data-builder-result-flow="true"
                  id="builder-tool-preview"
                  ref={resultFlowRef}
                >
                  <div className="cf-builder-result-toolbar">
                    <Eye aria-hidden="true" className="size-4" />
                    Result
                  </div>
                  <div className="cf-builder-flow-card-body">
                    <BuilderStaticPreview projection={preview} />
                  </div>
                </section>
              ) : null}

              {sourceFile === null ? null : (
                <details
                  aria-label="Project source"
                  className="cf-builder-source-disclosure cf-builder-chat-flow-surface"
                  data-builder-source-flow="true"
                  id="builder-source-disclosure"
                  open={sourceDisclosureOpen}
                  ref={sourceDisclosureRef}
                  tabIndex={-1}
                >
                  <summary
                    aria-expanded={sourceDisclosureOpen}
                    className="cf-builder-source-summary"
                    data-builder-source-summary="true"
                    onClick={(event) => {
                      event.preventDefault();
                      if (selected !== null) return;
                      setSourceDisclosureOpen(!sourceDisclosureOpen);
                    }}
                  >
                    <span className="cf-builder-source-title">
                      <FileCode2 aria-hidden="true" className="size-3.5" />
                      Source files
                    </span>
                    <span className="cf-builder-source-meta">
                      {files.length} {files.length === 1 ? 'file' : 'files'} - {sourceFile.path}
                    </span>
                  </summary>
                  {sourceDisclosureOpen ? (
                    <div className="cf-builder-source-body">
                      <div className="cf-builder-source-files" aria-label="Project source files">
                        {files.map((file) => {
                          const active = sourceFile.path === file.path;
                          return (
                            <button
                              className="cf-builder-source-file"
                              data-active={active ? 'true' : undefined}
                              data-builder-source-file={file.path}
                              disabled={typeof onSelectFile !== 'function' || active}
                              key={file.path}
                              onClick={() => selectFile(file.path)}
                              type="button"
                            >
                              <FileCode2 aria-hidden="true" className="size-3.5" />
                              {file.path}
                            </button>
                          );
                        })}
                      </div>
                      <pre
                        className="cf-builder-source-code"
                        data-builder-source-code={sourceFile.path}
                      >
                        <code>{sourceFile.content}</code>
                      </pre>
                    </div>
                  ) : null}
                </details>
              )}

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

          {showReviewSidebar ? (
            <aside
              aria-label="Project versions"
              className="cf-builder-review-sidebar"
              data-builder-review-sidebar="true"
            >
              <VersionHistoryPanel
                hasSavedProject={saved !== null}
                inspectedRevisionReceiptDigest={inspected?.target.revision_receipt_digest ?? null}
                onInspectRevision={onInspectRevision}
                onRefresh={onRefreshHistory}
                snapshot={history}
              />
            </aside>
          ) : null}
        </section>
      </div>
    </div>
  );
}
