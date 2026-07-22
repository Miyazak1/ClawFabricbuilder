import { useRef } from 'react';
import { Code2, Eye, FileCode2, RefreshCw, Sparkles } from 'lucide-react';

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
    <div className="flex min-h-screen flex-col bg-background text-foreground" data-builder-page="true">
      <header className="flex min-h-14 items-center justify-between gap-4 border-b px-4">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">ClawFabric Builder</p>
          <h1 className="truncate text-base font-semibold">{projectTitle}</h1>
        </div>
        {!hasDraft ? null : (
          <span className="text-xs text-muted-foreground">Version {revision}</span>
        )}
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[20rem_minmax(0,1fr)]">
        <section aria-label="Build request" className="flex flex-col gap-3 border-b p-4 lg:border-b-0 lg:border-r">
          <label className="text-sm font-medium" htmlFor="builder-idea">What would you like to make?</label>
          <textarea
            className="min-h-36 w-full resize-y border bg-background p-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            disabled={busy}
            id="builder-idea"
            maxLength={4000}
            onChange={(event) => onIdeaChange?.(event.currentTarget.value)}
            placeholder="A tiny habit tracker with a cheerful weekly view"
            readOnly={!canEditIdea}
            value={idea}
          />
          <button
            className="inline-flex min-h-10 items-center justify-center gap-2 bg-primary px-3 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!canGenerate}
            onClick={onGenerate}
            type="button"
          >
            <Sparkles aria-hidden="true" className="size-4" />
            {busy ? busyLabel(currentStatus) : hasDraft ? 'Update it' : 'Make it'}
          </button>
          {currentStatus === 'opening' ? (
            <p className="text-sm text-muted-foreground" role="status">Opening your project...</p>
          ) : null}
          {currentStatus === 'generating' ? (
            <p className="text-sm text-muted-foreground" role="status">Making your draft...</p>
          ) : null}
          {currentStatus === 'committing' ? (
            <p className="text-sm text-muted-foreground" role="status">Saving your project...</p>
          ) : null}
          {currentStatus === 'reopening' ? (
            <p className="text-sm text-muted-foreground" role="status">Checking the saved version...</p>
          ) : null}
          {currentStatus === 'generation_failed' ? (
            <div className="flex flex-col gap-2" role="alert">
              <p className="text-sm text-destructive">The draft could not be made. Try again.</p>
              {canOpenSettings ? (
                <button
                  className="inline-flex min-h-9 items-center justify-center border px-3 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={onOpenSettings}
                  type="button"
                >
                  Check AI settings
                </button>
              ) : null}
            </div>
          ) : null}
          {currentStatus === 'save_unverified' ? (
            <div className="flex flex-col gap-2" role="alert">
              <p className="text-sm text-destructive">We could not verify that your project was saved.</p>
              <button
                className="inline-flex min-h-9 items-center justify-center gap-2 border px-3 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
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
            <p className="text-sm text-destructive" role="alert">
              Your project was saved, but its preview is unavailable.
            </p>
          ) : null}
          {currentStatus === 'conflict' ? (
            <p className="text-sm text-destructive" role="alert">
              This project changed elsewhere. Reopen it before making more changes.
            </p>
          ) : null}
          {currentStatus === 'unavailable' ? (
            <p className="text-sm text-destructive" role="alert">This project is unavailable.</p>
          ) : null}
        </section>

        <section aria-label="Project area" className="grid min-h-0 grid-rows-[auto_minmax(18rem,1fr)]">
          <div className="flex min-h-11 items-center gap-1 overflow-x-auto border-b px-2" role="tablist">
            {FILES.map(({ file, label }) => (
              <button
                aria-controls="builder-code-panel"
                aria-selected={safeActiveFile === file}
                className="inline-flex min-h-9 shrink-0 items-center gap-2 border-b-2 px-3 text-sm data-[active=true]:border-primary data-[active=false]:border-transparent"
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
                <FileCode2 aria-hidden="true" className="size-4" />
                {label}
              </button>
            ))}
          </div>

          <div className="grid min-h-0 grid-cols-1 xl:grid-cols-2">
            <section
              aria-labelledby={tabId(safeActiveFile)}
              className="min-h-0 border-b xl:border-b-0 xl:border-r"
              id="builder-code-panel"
              role="tabpanel"
            >
              <div className="flex min-h-10 items-center gap-2 border-b px-3 text-xs font-medium text-muted-foreground">
                <Code2 aria-hidden="true" className="size-4" />
                {safeActiveFile}
              </div>
              <pre className="min-h-72 overflow-auto p-4 text-xs leading-5"><code>{code}</code></pre>
            </section>

            <section aria-label="Preview" className="min-h-0 p-3">
              <div className="mb-2 flex min-h-8 items-center gap-2 text-xs font-medium text-muted-foreground">
                <Eye aria-hidden="true" className="size-4" />
                Preview
              </div>
              {preview === null ? (
                <div className="flex min-h-72 items-center justify-center border border-dashed text-sm text-muted-foreground">
                  Your preview will appear here.
                </div>
              ) : (
                <BuilderStaticPreview projection={preview} />
              )}
            </section>
          </div>
        </section>
      </div>
    </div>
  );
}
