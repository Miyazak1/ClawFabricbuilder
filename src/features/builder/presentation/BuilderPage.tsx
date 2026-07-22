import { useRef, useState } from 'react';
import { Eye, FileCode2, RefreshCw, Sparkles } from 'lucide-react';

import type {
  BuilderProjectControllerSnapshot,
  BuilderProjectControllerStatus,
} from '../application/builderProjectController';
import { BuilderStaticPreview } from '../components/BuilderStaticPreview';
import {
  isTrustedBuilderProjectRevision,
  type BuilderProjectFiles,
} from '../domain/builderProject';
import {
  isTrustedBuilderStaticPreviewProjection,
  type BuilderStaticPreviewProjection,
} from '../preview/builderStaticPreview';

export type BuilderFileName = keyof BuilderProjectFiles;

export type BuilderPageProps = {
  idea: string;
  onIdeaChange?: (value: string) => void;
  onGenerate?: () => void;
  onOpenSettings?: () => void;
  onRetrySave?: () => void;
  snapshot: BuilderProjectControllerSnapshot;
  activeFile: BuilderFileName;
  onSelectFile?: (file: BuilderFileName) => void;
};

const FILES: ReadonlyArray<{ file: BuilderFileName; label: string }> = [
  { file: 'index.html', label: 'HTML' },
  { file: 'styles.css', label: 'CSS' },
  { file: 'app.js', label: 'JavaScript' },
];
const TOOL_VIEWS = Object.freeze([
  { id: 'preview', label: 'Preview', Icon: Eye },
  { id: 'code', label: 'Code', Icon: FileCode2 },
] as const);
const STATUSES = new Set<BuilderProjectControllerStatus>([
  'new',
  'opening',
  'ready',
  'generating',
  'committing',
  'reopening',
  'generation_failed',
  'save_unverified',
  'preview_unavailable',
  'conflict',
  'unavailable',
]);
const BUSY_STATUSES = new Set<BuilderProjectControllerStatus>([
  'opening',
  'generating',
  'committing',
  'reopening',
]);
const GENERATABLE_STATUSES = new Set<BuilderProjectControllerStatus>([
  'new',
  'ready',
  'generation_failed',
]);
const SNAPSHOT_KEYS = new Set(['status', 'busy', 'savedRevision', 'preview', 'error']);

function safeStatus(value: unknown): BuilderProjectControllerStatus {
  return typeof value === 'string' && STATUSES.has(value as BuilderProjectControllerStatus)
    ? value as BuilderProjectControllerStatus
    : 'unavailable';
}

function hasExactEnumerableDataKeys(value: object, allowedKeys: ReadonlySet<string>): boolean {
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== allowedKeys.size
    || keys.some((key) => typeof key !== 'string' || !allowedKeys.has(key))
  ) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return keys.every((key) => {
    const descriptor = descriptors[key as string];
    return descriptor !== undefined
      && descriptor.enumerable
      && !('get' in descriptor)
      && !('set' in descriptor);
  });
}

function expectedError(status: BuilderProjectControllerStatus) {
  return status === 'generation_failed'
    || status === 'save_unverified'
    || status === 'preview_unavailable'
    || status === 'conflict'
    || status === 'unavailable'
    ? status
    : null;
}

function isTrustedSnapshot(value: BuilderProjectControllerSnapshot): boolean {
  try {
    if (
      value === null
      || typeof value !== 'object'
      || !Object.isFrozen(value)
      || !hasExactEnumerableDataKeys(value, SNAPSHOT_KEYS)
    ) return false;
    const status = safeStatus(value.status);
    if (
      status !== value.status
      || value.busy !== BUSY_STATUSES.has(status)
      || value.error !== expectedError(status)
    ) return false;
    const revision = value.savedRevision;
    const preview = value.preview;
    if (revision !== null && !isTrustedBuilderProjectRevision(revision)) return false;
    if (preview !== null) {
      if (
        revision === null
        || !isTrustedBuilderStaticPreviewProjection(preview)
        || preview.project_id !== revision.project_id
        || preview.revision !== revision.revision
        || preview.revision_digest !== revision.revision_digest
      ) return false;
    }
    if (preview !== null && revision === null) return false;
    if (status === 'ready') return revision !== null && preview !== null;
    if (status === 'preview_unavailable') return revision !== null && preview === null;
    if (status === 'new' || status === 'opening' || status === 'unavailable') {
      return revision === null && preview === null;
    }
    return (revision === null) === (preview === null);
  } catch {
    return false;
  }
}

function busyLabel(status: BuilderProjectControllerStatus): string {
  if (status === 'opening') return 'Opening...';
  if (status === 'generating') return 'Making...';
  return 'Saving...';
}

function tabId(file: BuilderFileName): string {
  if (file === 'index.html') return 'builder-file-tab-html';
  if (file === 'styles.css') return 'builder-file-tab-css';
  return 'builder-file-tab-javascript';
}

export function BuilderPage({
  idea,
  onIdeaChange,
  onGenerate,
  onOpenSettings,
  onRetrySave,
  snapshot,
  activeFile,
  onSelectFile,
}: BuilderPageProps) {
  const trustedSnapshot = isTrustedSnapshot(snapshot);
  const currentStatus = trustedSnapshot ? snapshot.status : 'unavailable';
  const savedRevision = trustedSnapshot ? snapshot.savedRevision : null;
  const preview: BuilderStaticPreviewProjection | null = trustedSnapshot ? snapshot.preview : null;
  const projectTitle = savedRevision?.title ?? 'New project';
  const revision = savedRevision?.revision;
  const files = savedRevision?.files;
  const busy = BUSY_STATUSES.has(currentStatus);
  const canEditIdea = typeof onIdeaChange === 'function'
    && GENERATABLE_STATUSES.has(currentStatus);
  const tabRefs = useRef<Partial<Record<BuilderFileName, HTMLButtonElement | null>>>({});
  const safeActiveFile = FILES.some(({ file }) => file === activeFile)
    ? activeFile
    : FILES[0].file;
  const [toolView, setToolView] = useState<(typeof TOOL_VIEWS)[number]['id']>('preview');
  const canGenerate = typeof onGenerate === 'function'
    && GENERATABLE_STATUSES.has(currentStatus)
    && idea.trim().length > 0;
  const canRetrySave = currentStatus === 'save_unverified'
    && typeof onRetrySave === 'function';
  const canOpenSettings = currentStatus === 'generation_failed'
    && typeof onOpenSettings === 'function';
  const hasDraft = savedRevision !== null;
  const code = files?.[safeActiveFile] ?? '';

  function selectFile(file: BuilderFileName): void {
    if (typeof onSelectFile !== 'function') return;
    setToolView('code');
    onSelectFile(file);
    tabRefs.current[file]?.focus();
  }

  function selectRelativeFile(offset: number): void {
    if (typeof onSelectFile !== 'function') return;
    const currentIndex = FILES.findIndex(({ file }) => file === safeActiveFile);
    const nextIndex = (currentIndex + offset + FILES.length) % FILES.length;
    selectFile(FILES[nextIndex].file);
  }

  return (
    <div className="cf-builder-page bg-background text-foreground" data-builder-page="true">
      <header className="cf-builder-surface-toolbar">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">Project</p>
          <h1 className="truncate text-base font-semibold">{projectTitle}</h1>
        </div>
        {!hasDraft ? null : (
          <span className="text-xs text-muted-foreground" data-builder-current-version="true">
            Version {revision}
          </span>
        )}
      </header>

      <div className="cf-builder-surface-body">
        <section aria-label="Project area" className="cf-builder-panel cf-builder-output-panel border">
          <header className="cf-builder-output-toolbar">
            <div className="min-w-0">
              <p className="text-xs font-medium text-muted-foreground">Result</p>
              <h2 className="text-sm font-semibold">{toolView === 'preview' ? 'Project preview' : 'Project files'}</h2>
            </div>
            <div className="cf-builder-toolbar-actions">
              <div className="cf-builder-tool-switch" role="tablist" aria-label="Project tools">
                {TOOL_VIEWS.map(({ Icon, id, label }) => (
                  <button
                    aria-controls={id === 'preview' ? 'builder-tool-preview' : 'builder-code-panel'}
                    aria-selected={toolView === id}
                    className="cf-builder-tab inline-flex min-h-8 shrink-0 items-center gap-2 px-2.5 text-xs"
                    data-active={toolView === id}
                    disabled={typeof onSelectFile !== 'function'}
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
              {!hasDraft ? (
                <span className="cf-builder-status-pill">Draft not made yet</span>
              ) : (
                <span className="cf-builder-status-pill">Version {revision}</span>
              )}
            </div>
          </header>

          <div className="cf-builder-stage-grid">
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
                  Your preview will appear here.
                </div>
              ) : (
                <BuilderStaticPreview projection={preview} />
              )}
            </section>

            <section
              aria-labelledby={tabId(safeActiveFile)}
              className="cf-builder-code-panel"
              hidden={toolView !== 'code'}
              id="builder-code-panel"
              role="tabpanel"
            >
              <header className="cf-builder-code-header">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-muted-foreground">Code</p>
                  <h3 className="truncate text-sm font-semibold">{safeActiveFile}</h3>
                </div>
                <div className="cf-builder-tab-strip" role="tablist">
                  {FILES.map(({ file, label }) => (
                    <button
                      aria-controls="builder-code-panel"
                      aria-selected={safeActiveFile === file}
                      className="cf-builder-tab inline-flex min-h-8 shrink-0 items-center gap-2 px-2.5 text-xs"
                      data-active={safeActiveFile === file}
                      disabled={typeof onSelectFile !== 'function'}
                      id={tabId(file)}
                      key={file}
                      onClick={() => selectFile(file)}
                      onKeyDown={(event) => {
                        if (event.key === 'ArrowRight') {
                          event.preventDefault();
                          selectRelativeFile(1);
                        } else if (event.key === 'ArrowLeft') {
                          event.preventDefault();
                          selectRelativeFile(-1);
                        } else if (event.key === 'Home') {
                          event.preventDefault();
                          selectFile(FILES[0].file);
                        } else if (event.key === 'End') {
                          event.preventDefault();
                          selectFile(FILES[FILES.length - 1].file);
                        }
                      }}
                      ref={(element) => {
                        tabRefs.current[file] = element;
                      }}
                      role="tab"
                      tabIndex={safeActiveFile === file ? 0 : -1}
                      type="button"
                    >
                      <FileCode2 aria-hidden="true" className="size-3.5" />
                      {label}
                    </button>
                  ))}
                </div>
              </header>
              <pre className="cf-builder-code min-h-72 overflow-auto p-4 text-xs leading-5"><code>{code}</code></pre>
            </section>
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
              onChange={(event) => onIdeaChange?.(event.currentTarget.value)}
              placeholder="Describe the app, tool, or page you want..."
              readOnly={!canEditIdea}
              value={idea}
            />
            <footer className="cf-builder-composer-footer">
              <div className="cf-builder-composer-tools" aria-hidden="true">
                <span className="cf-builder-composer-tool">+</span>
                <span className="cf-builder-status-pill">{hasDraft ? 'Continue this project' : 'Start from an idea'}</span>
              </div>
              <button
                className="cf-builder-primary-button cf-builder-command-button inline-flex min-h-10 items-center justify-center gap-2 px-4 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!canGenerate}
                onClick={onGenerate}
                type="button"
              >
                <Sparkles aria-hidden="true" className="size-4" />
                {busy ? busyLabel(currentStatus) : hasDraft ? 'Update it' : 'Make it'}
              </button>
            </footer>
          </div>
          {currentStatus === 'opening' ? (
            <p className="cf-builder-alert cf-builder-alert-info text-sm" role="status">Opening your project...</p>
          ) : null}
          {currentStatus === 'generating' ? (
            <p className="cf-builder-alert cf-builder-alert-info text-sm" role="status">Making your draft...</p>
          ) : null}
          {currentStatus === 'committing' ? (
            <p className="cf-builder-alert cf-builder-alert-info text-sm" role="status">Saving your project...</p>
          ) : null}
          {currentStatus === 'reopening' ? (
            <p className="cf-builder-alert cf-builder-alert-info text-sm" role="status">Checking the saved version...</p>
          ) : null}
          {currentStatus === 'generation_failed' ? (
            <div className="cf-builder-alert cf-builder-alert-danger flex flex-col gap-2 text-sm" role="alert">
              <p>The draft could not be made. Try again.</p>
              {canOpenSettings ? (
                <button
                  className="cf-builder-secondary-button inline-flex min-h-9 items-center justify-center px-3 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={onOpenSettings}
                  type="button"
                >
                  Check AI settings
                </button>
              ) : null}
            </div>
          ) : null}
          {currentStatus === 'save_unverified' ? (
            <div className="cf-builder-alert cf-builder-alert-danger flex flex-col gap-2 text-sm" role="alert">
              <p>We could not verify that your project was saved.</p>
              <button
                className="cf-builder-secondary-button inline-flex min-h-9 items-center justify-center gap-2 px-3 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!canRetrySave}
                onClick={onRetrySave}
                type="button"
              >
                <RefreshCw aria-hidden="true" className="size-4" />
                Retry save
              </button>
            </div>
          ) : null}
          {currentStatus === 'preview_unavailable' ? (
            <p className="cf-builder-alert cf-builder-alert-danger text-sm" role="alert">
              Your project was saved, but its preview is unavailable.
            </p>
          ) : null}
          {currentStatus === 'conflict' ? (
            <p className="cf-builder-alert cf-builder-alert-danger text-sm" role="alert">
              This project changed elsewhere. Reopen it before making more changes.
            </p>
          ) : null}
          {currentStatus === 'unavailable' ? (
            <p className="cf-builder-alert cf-builder-alert-danger text-sm" role="alert">This project is unavailable.</p>
          ) : null}
        </section>
      </div>
    </div>
  );
}
