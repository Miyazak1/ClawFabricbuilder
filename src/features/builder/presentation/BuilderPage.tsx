import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  Eye,
  FileCode2,
  GitCompareArrows,
  History,
  Play,
  RefreshCw,
  Save,
  Sparkles,
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
import type { BuilderConversationItem } from '../domain/builderConversationSnapshot';
import type { BuilderProjectHistoryRevision } from '../domain/builderProjectHistory';
import type { BuilderProjectSourceFile } from '../domain/builderProjectSnapshot';
import {
  createBuilderSourceTreeChanges,
  type BuilderSourceTreeChange,
  type BuilderSourceTreeChanges,
} from '../domain/builderSourceTreeChanges';
import type { BuilderSourceTreePreviewProjection } from '../preview/builderSourceTreePreview';

export type BuilderFileName = string;

export type BuilderPageProps = {
  instruction: string;
  onInstructionChange?: (value: string) => void;
  onAnswer?: () => void;
  onCancel?: () => void;
  onGenerate?: () => void;
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

const TOOL_VIEWS = Object.freeze([
  { id: 'preview', label: 'Preview', Icon: Eye },
  { id: 'changes', label: 'Changes', Icon: GitCompareArrows },
  { id: 'code', label: 'Code', Icon: FileCode2 },
] as const);
const GENERATABLE_STATUSES = new Set<BuilderProjectControllerStatus>([
  'new',
  'ready',
  'answer_failed',
  'generation_failed',
  'preview_unavailable',
]);

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
  if (status === 'answering') return 'Answering...';
  if (status === 'generating') return 'Making...';
  if (status === 'rejecting') return 'Discarding...';
  return 'Saving...';
}

function tabId(file: string): string {
  return `builder-file-tab-${file.replace(/[^a-zA-Z0-9_-]/gu, '-')}`;
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
  if (snapshot === null || snapshot.status === 'idle') return 'Select a project to see activity.';
  if (snapshot.status === 'loading') return 'Loading activity...';
  if (snapshot.status === 'unavailable') return 'Activity is unavailable.';
  if (snapshot.status === 'stale') return 'Activity could not be refreshed.';
  if (snapshot.conversation?.state === 'absent') return 'No activity yet.';
  return null;
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

function ActivityGlyph({ item }: Readonly<{ item: BuilderConversationItem }>) {
  if (item.item_kind === 'user_message') return <UserRound className="size-3.5" />;
  if (item.item_kind === 'run_started') return <Play className="size-3.5" />;
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
  if (item.item_kind === 'run_started') return 'Started';
  if (item.item_kind === 'run_control_requested') {
    return item.action === 'interrupt' ? 'Interrupt requested' : 'Stop requested';
  }
  if (item.item_kind === 'tool_call_requested') return 'Project access ready';
  if (item.item_kind === 'tool_call_result_recorded') {
    if (item.result.status === 'succeeded') return 'Project step completed';
    if (item.result.status === 'cancelled') return 'Project step stopped';
    return 'Project step could not finish';
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

function activityBody(item: BuilderConversationItem): string {
  if (item.item_kind === 'user_message') return item.message.text;
  if (item.item_kind === 'run_started') return 'The assistant began working on this request.';
  if (item.item_kind === 'run_control_requested') {
    return item.action === 'interrupt'
      ? 'You asked to steer the current work.'
      : 'You asked to stop the current work.';
  }
  if (item.item_kind === 'tool_call_requested') {
    return 'The assistant has approved project access for this step. It has not run yet.';
  }
  if (item.item_kind === 'tool_call_result_recorded') return item.result.display_summary;
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

function candidateAvailabilityNote(hasUnsavedDraft: boolean): string {
  return hasUnsavedDraft
    ? 'Review the draft files in Result before saving this version.'
    : 'Activity keeps this draft summary only and cannot reopen unsaved files.';
}

function toolPanelId(id: (typeof TOOL_VIEWS)[number]['id']): string {
  if (id === 'preview') return 'builder-tool-preview';
  if (id === 'changes') return 'builder-tool-changes';
  return 'builder-code-panel';
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
  if (preview !== null) return 'Preview and changes are ready.';
  return hasContent
    ? 'Review the files and changes before saving.'
    : 'Review this draft before saving.';
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
  onOpenFile,
}: Readonly<{
  changes: BuilderSourceTreeChanges;
  onOpenFile: (change: BuilderSourceTreeChange) => void;
}>) {
  return (
    <section
      aria-labelledby="builder-tool-tab-changes"
      className="cf-builder-changes-panel"
      data-builder-changes-panel="true"
      id="builder-tool-changes"
      role="tabpanel"
    >
      <div className="cf-builder-panel-toolbar">
        <GitCompareArrows aria-hidden="true" className="size-4" />
        Changes
      </div>
      <div className="cf-builder-changes-body">
        <p className="cf-builder-changes-summary" data-builder-changes-summary="true">
          {changesSummary(changes)}
        </p>
        {changes.files.length === 0 ? (
          <div className="cf-builder-empty flex min-h-56 items-center justify-center border border-dashed px-4 text-center text-sm">
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
    </section>
  );
}

function VersionItem({
  inspectedRevisionReceiptDigest,
  onInspectRevision,
  onShowCurrentRevision,
  revision,
}: Readonly<{
  inspectedRevisionReceiptDigest: string | null;
  onInspectRevision?: (projectId: string, revisionReceiptDigest: string) => Promise<unknown> | void;
  onShowCurrentRevision?: () => Promise<unknown> | void;
  revision: BuilderProjectHistoryRevision;
}>) {
  const isInspected = inspectedRevisionReceiptDigest === revision.revision_receipt_digest;
  const canInspect = !isInspected
    && (revision.is_current
      ? typeof onShowCurrentRevision === 'function'
      : typeof onInspectRevision === 'function');
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
      <button
        className="cf-builder-secondary-button inline-flex min-h-8 shrink-0 items-center justify-center px-2.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50"
        data-builder-show-current-version={revision.is_current ? 'true' : undefined}
        data-builder-view-version={revision.is_current ? undefined : `Version ${revision.revision_number}`}
        disabled={!canInspect}
        onClick={() => {
          if (revision.is_current) {
            void onShowCurrentRevision?.();
          } else {
            void onInspectRevision?.(revision.project_id, revision.revision_receipt_digest);
          }
        }}
        type="button"
      >
        {isInspected ? 'Viewing' : revision.is_current ? 'Current' : 'View'}
      </button>
    </li>
  );
}

function VersionHistoryPanel({
  hasSavedProject,
  inspectedRevisionReceiptDigest,
  onInspectRevision,
  onRefresh,
  onShowCurrentRevision,
  snapshot,
}: Readonly<{
  hasSavedProject: boolean;
  inspectedRevisionReceiptDigest: string | null;
  onInspectRevision?: (projectId: string, revisionReceiptDigest: string) => Promise<unknown> | void;
  onRefresh?: () => Promise<unknown> | void;
  onShowCurrentRevision?: () => Promise<unknown> | void;
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
                onShowCurrentRevision={onShowCurrentRevision}
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
  const itemPlanReviewKey = item.item_kind === 'turn_completed' && item.run_id !== null
    ? planReviewKey(item.turn_id, item.run_id)
    : null;
  const showPlanReviewActions = item.item_kind === 'turn_completed'
    && item.outcome === 'plan_proposed'
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
    >
      <div className="cf-builder-activity-icon" aria-hidden="true">
        <ActivityGlyph item={item} />
      </div>
      <div className="min-w-0">
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
          <div className="mt-2 flex flex-wrap gap-2" data-builder-plan-review-actions="true">
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
              Reject plan
            </button>
          </div>
        ) : null}
      </div>
    </li>
  );
}

function ActivityPanel({
  hasUnsavedDraft,
  snapshot,
  onRefresh,
  onReviewPlan,
  pendingPlanReview,
  canReviewPlan,
}: Readonly<{
  canReviewPlan: boolean;
  hasUnsavedDraft: boolean;
  snapshot: BuilderConversationControllerSnapshot | null;
  onRefresh?: () => Promise<unknown> | void;
  onReviewPlan?: (request: BuilderPlanReviewRequest) => Promise<unknown> | void;
  pendingPlanReview: BuilderPlanReviewRequest | null;
}>) {
  const items = activityItems(snapshot);
  const message = activityMessage(snapshot);
  const canRefresh = snapshot !== null
    && snapshot.project_id !== null
    && !snapshot.busy
    && typeof onRefresh === 'function';
  return (
    <aside
      aria-label="Project activity"
      className="cf-builder-activity-panel"
      data-builder-activity="true"
      data-builder-activity-status={snapshot?.status ?? 'idle'}
    >
      <header className="cf-builder-side-header">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">Activity</p>
          <h3 className="truncate text-sm font-semibold">Project work</h3>
        </div>
        <button
          aria-label="Refresh activity"
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
      <div className="cf-builder-activity-body-wrap">
        {snapshot?.status === 'refreshing' ? (
          <p className="cf-builder-activity-status" role="status">Refreshing activity...</p>
        ) : null}
        {items.length === 0 ? (
          <div className="cf-builder-empty cf-builder-activity-empty flex min-h-32 items-center justify-center border border-dashed px-3 text-center text-sm">
            {message ?? 'No activity yet.'}
          </div>
        ) : (
          <ol className="cf-builder-activity-list">
            {items.map((item) => (
              <ActivityItem
                canReviewPlan={canReviewPlan}
                hasUnsavedDraft={hasUnsavedDraft}
                item={item}
                key={item.sequence}
                onReviewPlan={onReviewPlan}
                pendingPlanReview={pendingPlanReview}
              />
            ))}
          </ol>
        )}
        {items.length > 0 && message !== null ? (
          <p className="cf-builder-activity-status" role={snapshot?.status === 'stale' ? 'alert' : 'status'}>
            {message}
          </p>
        ) : null}
      </div>
    </aside>
  );
}

export function BuilderPage({
  instruction,
  onAnswer,
  onCancel,
  onInstructionChange,
  onGenerate,
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
  const selected = files.find((file) => file.path === activeFile) ?? files[0] ?? null;
  const busy = current?.busy ?? false;
  const hasUnsavedDraft = draft !== null;
  const viewingHistory = inspected !== null;
  const hasContent = files.length > 0;
  const title = draft?.title ?? inspected?.target.title ?? saved?.target.title ?? 'New project';
  const version = saved?.target.revision_number ?? null;
  const canGenerate = typeof onGenerate === 'function'
    && GENERATABLE_STATUSES.has(status)
    && !hasUnsavedDraft
    && !viewingHistory
    && instruction.trim().length > 0;
  const canAnswer = typeof onAnswer === 'function'
    && GENERATABLE_STATUSES.has(status)
    && !hasUnsavedDraft
    && !viewingHistory
    && instruction.trim().length > 0;
  const canSave = typeof onSave === 'function' && hasUnsavedDraft && !busy;
  const canReject = typeof onRejectDraft === 'function' && hasUnsavedDraft && !busy;
  const canCancel = typeof onCancel === 'function'
    && (status === 'answering' || status === 'generating');
  const canEditInstruction = typeof onInstructionChange === 'function' && !busy && !hasUnsavedDraft && !viewingHistory;
  const failed = status === 'generation_failed' || status === 'answer_failed';
  const canRetryGenerate = typeof onRetryGenerate === 'function'
    && status === 'generation_failed'
    && current?.retryableGeneration === true
    && isRetryableGenerationError(current.error);
  const canOpenSettings = failed
    && current?.error === 'builder_generation_provider_unavailable'
    && typeof onOpenSettings === 'function';
  const activity = visibleActivitySnapshot(conversationSnapshot);
  const history = visibleHistorySnapshot(historySnapshot);
  const planReviewTarget = pendingPlanReviewTarget(activity);
  const canReviewPlan = typeof onReviewPlan === 'function'
    && planReviewTarget !== null
    && !busy
    && !hasUnsavedDraft
    && !viewingHistory;
  const changes = useMemo(() => createBuilderSourceTreeChanges(
    saved?.source_tree ?? null,
    draft?.source_tree ?? null,
  ), [draft, saved]);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [toolView, setToolView] = useState<(typeof TOOL_VIEWS)[number]['id']>('preview');

  useEffect(() => {
    if (selected !== null && selected.path !== activeFile) onSelectFile?.(selected.path);
  }, [activeFile, onSelectFile, selected]);

  function selectFile(path: string): void {
    if (typeof onSelectFile !== 'function') return;
    setToolView('code');
    onSelectFile(path);
    tabRefs.current[path]?.focus();
  }

  function selectRelativeFile(offset: number): void {
    if (selected === null || typeof onSelectFile !== 'function') return;
    const index = files.findIndex((file) => file.path === selected.path);
    const next = files[(index + offset + files.length) % files.length];
    selectFile(next.path);
  }

  function openChangedFile(change: BuilderSourceTreeChange): void {
    if (change.change_kind === 'deleted') return;
    setToolView('code');
    onSelectFile?.(change.path);
  }

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
          {hasUnsavedDraft ? (
            <button
              className="cf-builder-secondary-button inline-flex min-h-9 items-center justify-center gap-2 px-3 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
              data-builder-discard-draft="true"
              disabled={!canReject}
              onClick={onRejectDraft}
              type="button"
            >
              <Trash2 aria-hidden="true" className="size-4" />
              {status === 'rejecting' ? 'Discarding...' : 'Discard draft'}
            </button>
          ) : null}
          {hasUnsavedDraft ? (
            <button
              className="cf-builder-primary-button inline-flex min-h-9 items-center justify-center gap-2 px-3 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
              data-builder-save-version="true"
              disabled={!canSave}
              onClick={onSave}
              type="button"
            >
              <Save aria-hidden="true" className="size-4" />
              {status === 'saving'
                ? 'Saving...'
                : status === 'save_unknown'
                  ? 'Try Save again'
                  : 'Save version'}
            </button>
          ) : null}
        </div>
      </header>

      {hasUnsavedDraft ? (
        <section
          aria-label="Draft review"
          className="cf-builder-review-checkpoint"
          data-builder-review-checkpoint="true"
        >
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
          <button
            className="cf-builder-secondary-button inline-flex min-h-8 shrink-0 items-center justify-center gap-2 px-2.5 text-xs font-medium"
            data-builder-review-open-changes="true"
            onClick={() => setToolView('changes')}
            type="button"
          >
            <GitCompareArrows aria-hidden="true" className="size-3.5" />
            Changes
          </button>
        </section>
      ) : null}

      <div className="cf-builder-surface-body">
        <section aria-label="Project area" className="cf-builder-panel cf-builder-output-panel border">
          <header className="cf-builder-output-toolbar">
            <div className="min-w-0">
              <p className="text-xs font-medium text-muted-foreground">Result</p>
              <h2 className="text-sm font-semibold">
                {toolView === 'preview'
                  ? 'Project preview'
                  : toolView === 'changes'
                    ? 'Project changes'
                    : 'Project files'}
              </h2>
            </div>
            <div className="cf-builder-tool-switch" role="tablist" aria-label="Project tools">
              {TOOL_VIEWS.map(({ Icon, id, label }) => (
                <button
                  aria-controls={toolPanelId(id)}
                  aria-selected={toolView === id}
                  className="cf-builder-tab inline-flex min-h-8 shrink-0 items-center gap-2 px-2.5 text-xs"
                  data-active={toolView === id}
                  id={`builder-tool-tab-${id}`}
                  key={id}
                  onClick={() => setToolView(id)}
                  role="tab"
                  tabIndex={toolView === id ? 0 : -1}
                  type="button"
                >
                  <Icon aria-hidden="true" className="size-3.5" />
                  {label}
                </button>
              ))}
            </div>
          </header>

          <div className="cf-builder-stage-grid">
            <div className="cf-builder-result-stage">
              <section
                aria-labelledby="builder-tool-tab-preview"
                className="cf-builder-preview-panel cf-builder-preview-primary"
                hidden={toolView !== 'preview'}
                id="builder-tool-preview"
                role="tabpanel"
              >
                <div className="cf-builder-panel-toolbar">
                  <Eye aria-hidden="true" className="size-4" />
                  Preview
                </div>
                <p
                  className="mb-3 text-xs leading-5 text-muted-foreground"
                  data-builder-preview-safety-note="true"
                >
                  Preview is isolated for safety.
                </p>
                {preview === null ? (
                  <div className="cf-builder-empty flex min-h-72 items-center justify-center border border-dashed px-4 text-center text-sm">
                    {hasContent
                      ? 'This project can be viewed as code, but it does not have a static preview.'
                      : 'Your preview will appear here.'}
                  </div>
                ) : (
                  <BuilderStaticPreview projection={preview} />
                )}
              </section>

              <section
                aria-labelledby={selected === null ? undefined : tabId(selected.path)}
                className="cf-builder-code-panel"
                hidden={toolView !== 'code'}
                id="builder-code-panel"
                role="tabpanel"
              >
                <header className="cf-builder-code-header">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-muted-foreground">Code</p>
                    <h3 className="truncate text-sm font-semibold">{selected?.path ?? 'No files yet'}</h3>
                  </div>
                  <div className="cf-builder-tab-strip" role="tablist">
                    {files.map((file) => (
                      <button
                        aria-controls="builder-code-panel"
                        aria-selected={selected?.path === file.path}
                        className="cf-builder-tab inline-flex min-h-8 shrink-0 items-center gap-2 px-2.5 text-xs"
                        data-active={selected?.path === file.path}
                        id={tabId(file.path)}
                        key={file.path}
                        onClick={() => selectFile(file.path)}
                        onKeyDown={(event) => {
                          if (event.key === 'ArrowRight') {
                            event.preventDefault();
                            selectRelativeFile(1);
                          } else if (event.key === 'ArrowLeft') {
                            event.preventDefault();
                            selectRelativeFile(-1);
                          } else if (event.key === 'Home' && files[0]) {
                            event.preventDefault();
                            selectFile(files[0].path);
                          } else if (event.key === 'End' && files.at(-1)) {
                            event.preventDefault();
                            selectFile(files.at(-1)!.path);
                          }
                        }}
                        ref={(element) => {
                          tabRefs.current[file.path] = element;
                        }}
                        role="tab"
                        tabIndex={selected?.path === file.path ? 0 : -1}
                        type="button"
                      >
                        <FileCode2 aria-hidden="true" className="size-3.5" />
                        {file.path}
                      </button>
                    ))}
                  </div>
                </header>
                <pre className="cf-builder-code min-h-72 overflow-auto p-4 text-xs leading-5">
                  <code>{selected?.content ?? ''}</code>
                </pre>
              </section>

              <div hidden={toolView !== 'changes'}>
                <ChangesPanel
                  changes={changes}
                  onOpenFile={openChangedFile}
                />
              </div>
            </div>
            <div className="cf-builder-side-stack">
              <VersionHistoryPanel
                hasSavedProject={saved !== null}
                inspectedRevisionReceiptDigest={inspected?.target.revision_receipt_digest ?? null}
                onInspectRevision={onInspectRevision}
                onRefresh={onRefreshHistory}
                onShowCurrentRevision={onShowCurrentRevision}
                snapshot={history}
              />
            <ActivityPanel
              canReviewPlan={canReviewPlan}
              hasUnsavedDraft={hasUnsavedDraft}
              onRefresh={onRefreshConversation}
              onReviewPlan={onReviewPlan}
              pendingPlanReview={planReviewTarget}
              snapshot={activity}
            />
            </div>
          </div>
        </section>

        <section aria-label="Build request" className="cf-builder-composer-card" data-builder-composer="true">
          <div className="cf-builder-composer-shell">
            <textarea
              aria-label="What do you want to build?"
              className="cf-builder-input cf-builder-composer-textarea w-full resize-none text-sm"
              disabled={busy}
              id="builder-idea"
              maxLength={4000}
              onChange={(event) => onInstructionChange?.(event.currentTarget.value)}
              placeholder="Describe what you want to build or change..."
              readOnly={!canEditInstruction}
              value={instruction}
            />
            <footer className="cf-builder-composer-footer">
              <div className="cf-builder-composer-tools">
                <span className="cf-builder-status-pill">
                  {viewingHistory
                    ? 'Viewing a saved version'
                    : hasUnsavedDraft
                      ? 'Save this draft before asking for another change'
                      : saved
                        ? 'Continue this project'
                        : 'Start from an idea'}
                </span>
              </div>
              <div className="cf-builder-composer-actions">
                {canCancel ? (
                  <button
                    className="cf-builder-secondary-button cf-builder-command-button inline-flex min-h-10 items-center justify-center gap-2 px-4 text-sm font-medium"
                    data-builder-cancel-work="true"
                    onClick={onCancel}
                    type="button"
                  >
                    <StopCircle aria-hidden="true" className="size-4" />
                    Stop
                  </button>
                ) : null}
                <button
                  className="cf-builder-secondary-button cf-builder-command-button inline-flex min-h-10 items-center justify-center gap-2 px-4 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
                  data-builder-ask-question="true"
                  disabled={!canAnswer}
                  onClick={onAnswer}
                  type="button"
                >
                  <Bot aria-hidden="true" className="size-4" />
                  {status === 'answering' ? 'Asking...' : 'Ask'}
                </button>
                <button
                  className="cf-builder-primary-button cf-builder-command-button inline-flex min-h-10 items-center justify-center gap-2 px-4 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
                  data-builder-make-draft="true"
                  disabled={!canGenerate}
                  onClick={onGenerate}
                  type="button"
                >
                  <Sparkles aria-hidden="true" className="size-4" />
                  {busy ? busyLabel(status) : saved ? 'Make change' : 'Make draft'}
                </button>
              </div>
            </footer>
          </div>

          {status === 'opening' ? (
            <p className="cf-builder-alert cf-builder-alert-info text-sm" role="status">Opening your project...</p>
          ) : null}
          {status === 'generating' ? (
            <p className="cf-builder-alert cf-builder-alert-info text-sm" role="status">Making your draft...</p>
          ) : null}
          {status === 'answering' ? (
            <p className="cf-builder-alert cf-builder-alert-info text-sm" role="status">Answering...</p>
          ) : null}
          {status === 'saving' ? (
            <p className="cf-builder-alert cf-builder-alert-info text-sm" role="status">Saving this version...</p>
          ) : null}
          {status === 'rejecting' ? (
            <p className="cf-builder-alert cf-builder-alert-info text-sm" role="status">Discarding this draft...</p>
          ) : null}
          {failed ? (
            <div className="cf-builder-alert cf-builder-alert-danger flex flex-col gap-2 text-sm" role="alert">
              <p>{status === 'answer_failed'
                ? (current?.error === 'builder_generation_provider_unavailable'
                  ? 'AI is not configured yet.'
                  : current?.error === 'builder_generation_timeout'
                    ? 'Answering took too long. Try again.'
                    : current?.error === 'builder_generation_provider_http_error'
                      ? 'The AI service could not answer. Try again.'
                      : 'The answer could not be prepared. Try again.')
                : current?.error === 'builder_generation_provider_unavailable'
                  ? 'AI generation is not configured yet.'
                  : current?.error === 'builder_generation_timeout'
                    ? 'Making this draft took too long. Try again.'
                    : current?.error === 'builder_generation_provider_http_error'
                      ? 'The AI service could not make this draft. Try again.'
                      : current?.error === 'builder_generation_structured_response_invalid'
                        ? 'The draft could not be prepared. Try again.'
                        : 'The draft could not be made. Try again.'}</p>
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
          ) : null}
          {status === 'save_unknown' ? (
            <p className="cf-builder-alert cf-builder-alert-danger text-sm" role="alert">
              The save result could not be confirmed. Your draft is still available; check the project and try again.
            </p>
          ) : null}
          {status === 'reject_failed' ? (
            <p className="cf-builder-alert cf-builder-alert-danger text-sm" role="alert">
              The draft could not be discarded. Your draft is still available; try again.
            </p>
          ) : null}
          {status === 'preview_unavailable' && hasContent ? (
            <p className="cf-builder-alert cf-builder-alert-info text-sm" role="status">
              A static preview is not available for this project. You can still review and save its files.
            </p>
          ) : null}
          {status === 'conflict' ? (
            <p className="cf-builder-alert cf-builder-alert-danger text-sm" role="alert">
              This project changed before the saved version could be verified.
            </p>
          ) : null}
          {status === 'unavailable' ? (
            <p className="cf-builder-alert cf-builder-alert-danger text-sm" role="alert">
              This project is unavailable.
            </p>
          ) : null}
        </section>
      </div>
    </div>
  );
}
