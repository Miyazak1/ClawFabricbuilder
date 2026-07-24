import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  Eye,
  FileCode2,
  History,
  Play,
  RefreshCw,
  Save,
  Sparkles,
  StopCircle,
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
  isTrustedBuilderProjectHistorySnapshot,
  type BuilderProjectHistorySnapshot,
} from '../application/builderProjectHistoryController';
import { BuilderStaticPreview } from '../components/BuilderStaticPreview';
import type { BuilderConversationItem } from '../domain/builderConversationSnapshot';
import type { BuilderProjectHistoryRevision } from '../domain/builderProjectHistory';
import type { BuilderProjectSourceFile } from '../domain/builderProjectSnapshot';

export type BuilderFileName = string;

export type BuilderPageProps = {
  instruction: string;
  onInstructionChange?: (value: string) => void;
  onAnswer?: () => void;
  onGenerate?: () => void;
  onRefreshConversation?: () => Promise<unknown> | void;
  onRefreshHistory?: () => Promise<unknown> | void;
  onSave?: () => void;
  onOpenSettings?: () => void;
  conversationSnapshot?: BuilderConversationControllerSnapshot;
  historySnapshot?: BuilderProjectHistorySnapshot;
  snapshot: BuilderProjectControllerSnapshot;
  activeFile: BuilderFileName | null;
  onSelectFile?: (file: BuilderFileName) => void;
};

const TOOL_VIEWS = Object.freeze([
  { id: 'preview', label: 'Preview', Icon: Eye },
  { id: 'code', label: 'Code', Icon: FileCode2 },
] as const);
const GENERATABLE_STATUSES = new Set<BuilderProjectControllerStatus>([
  'new',
  'ready',
  'answer_failed',
  'generation_failed',
  'preview_unavailable',
]);

function busyLabel(status: BuilderProjectControllerStatus): string {
  if (status === 'opening') return 'Opening...';
  if (status === 'answering') return 'Answering...';
  if (status === 'generating') return 'Making...';
  return 'Saving...';
}

function tabId(file: string): string {
  return `builder-file-tab-${file.replace(/[^a-zA-Z0-9_-]/gu, '-')}`;
}

function selectedFiles(snapshot: BuilderProjectControllerSnapshot): readonly BuilderProjectSourceFile[] {
  return snapshot.draft?.source_tree.files
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

function VersionItem({ revision }: Readonly<{ revision: BuilderProjectHistoryRevision }>) {
  return (
    <li
      className="cf-builder-version-item"
      data-builder-version-card={`Version ${revision.revision_number}`}
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
    </li>
  );
}

function VersionHistoryPanel({
  hasSavedProject,
  onRefresh,
  snapshot,
}: Readonly<{
  hasSavedProject: boolean;
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
                key={revision.revision_receipt_digest}
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
  hasUnsavedDraft,
  item,
}: Readonly<{
  hasUnsavedDraft: boolean;
  item: BuilderConversationItem;
}>) {
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
      </div>
    </li>
  );
}

function ActivityPanel({
  hasUnsavedDraft,
  snapshot,
  onRefresh,
}: Readonly<{
  hasUnsavedDraft: boolean;
  snapshot: BuilderConversationControllerSnapshot | null;
  onRefresh?: () => Promise<unknown> | void;
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
                hasUnsavedDraft={hasUnsavedDraft}
                item={item}
                key={item.sequence}
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
  onInstructionChange,
  onGenerate,
  onRefreshConversation,
  onRefreshHistory,
  onSave,
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
  const preview = current?.preview ?? null;
  const files = current === null ? [] : selectedFiles(current);
  const selected = files.find((file) => file.path === activeFile) ?? files[0] ?? null;
  const busy = current?.busy ?? false;
  const hasUnsavedDraft = draft !== null;
  const hasContent = files.length > 0;
  const title = draft?.title ?? saved?.target.title ?? 'New project';
  const version = saved?.target.revision_number ?? null;
  const canGenerate = typeof onGenerate === 'function'
    && GENERATABLE_STATUSES.has(status)
    && !hasUnsavedDraft
    && instruction.trim().length > 0;
  const canAnswer = typeof onAnswer === 'function'
    && GENERATABLE_STATUSES.has(status)
    && !hasUnsavedDraft
    && instruction.trim().length > 0;
  const canSave = typeof onSave === 'function' && hasUnsavedDraft && !busy;
  const canEditInstruction = typeof onInstructionChange === 'function' && !busy && !hasUnsavedDraft;
  const failed = status === 'generation_failed' || status === 'answer_failed';
  const canOpenSettings = failed
    && current?.error === 'builder_generation_provider_unavailable'
    && typeof onOpenSettings === 'function';
  const activity = visibleActivitySnapshot(conversationSnapshot);
  const history = visibleHistorySnapshot(historySnapshot);
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
            <span className="cf-builder-status-pill" data-builder-unsaved-draft="true">
              Unsaved draft
            </span>
          ) : version === null ? null : (
            <span className="text-xs text-muted-foreground" data-builder-current-version="true">
              Version {version}
            </span>
          )}
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

      <div className="cf-builder-surface-body">
        <section aria-label="Project area" className="cf-builder-panel cf-builder-output-panel border">
          <header className="cf-builder-output-toolbar">
            <div className="min-w-0">
              <p className="text-xs font-medium text-muted-foreground">Result</p>
              <h2 className="text-sm font-semibold">
                {toolView === 'preview' ? 'Project preview' : 'Project files'}
              </h2>
            </div>
            <div className="cf-builder-tool-switch" role="tablist" aria-label="Project tools">
              {TOOL_VIEWS.map(({ Icon, id, label }) => (
                <button
                  aria-controls={id === 'preview' ? 'builder-tool-preview' : 'builder-code-panel'}
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
            </div>
            <div className="cf-builder-side-stack">
              <VersionHistoryPanel
                hasSavedProject={saved !== null}
                onRefresh={onRefreshHistory}
                snapshot={history}
              />
              <ActivityPanel
                hasUnsavedDraft={hasUnsavedDraft}
                onRefresh={onRefreshConversation}
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
                  {hasUnsavedDraft ? 'Save this draft before asking for another change' : saved ? 'Continue this project' : 'Start from an idea'}
                </span>
              </div>
              <div className="cf-builder-composer-actions">
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
            </div>
          ) : null}
          {status === 'save_unknown' ? (
            <p className="cf-builder-alert cf-builder-alert-danger text-sm" role="alert">
              The save result could not be confirmed. Your draft is still available; check the project and try again.
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
