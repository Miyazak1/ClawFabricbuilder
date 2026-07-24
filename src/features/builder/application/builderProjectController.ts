import {
  createBuilderGenerationRequest,
  sanitizeBuilderGenerationDraft,
  type BuilderGenerationDraft,
} from './builderGeneration';
import {
  sanitizeTrustedBuilderGenerationDiagnostic,
  type BuilderCodeGeneratorPort,
  type BuilderGenerationDiagnosticCode,
  type BuilderProjectWorkspacePort,
} from './builderPorts';
import {
  sanitizeBuilderProjectReadSnapshot,
  type BuilderProjectReadSnapshot,
  type BuilderProjectSourceTree,
} from '../domain/builderProjectSnapshot';
import {
  createBuilderSourceTreePreview,
  type BuilderSourceTreePreviewProjection,
} from '../preview/builderSourceTreePreview';

export type BuilderProjectControllerStatus =
  | 'new'
  | 'opening'
  | 'ready'
  | 'generating'
  | 'draft_ready'
  | 'saving'
  | 'generation_failed'
  | 'save_unknown'
  | 'preview_unavailable'
  | 'conflict'
  | 'unavailable';

export type BuilderProjectControllerError =
  | BuilderGenerationDiagnosticCode
  | 'save_unknown'
  | 'preview_unavailable'
  | 'conflict'
  | 'unavailable'
  | null;

export type BuilderProjectControllerSnapshot = Readonly<{
  status: BuilderProjectControllerStatus;
  busy: boolean;
  savedProject: BuilderProjectReadSnapshot | null;
  draft: BuilderGenerationDraft | null;
  preview: BuilderSourceTreePreviewProjection | null;
  error: BuilderProjectControllerError;
}>;

export type BuilderProjectControllerDependencies = Readonly<{
  generator: BuilderCodeGeneratorPort;
  workspace: BuilderProjectWorkspacePort;
  createPreview?: typeof createBuilderSourceTreePreview;
}>;

export type BuilderProjectController = Readonly<{
  getSnapshot(): BuilderProjectControllerSnapshot;
  subscribe(listener: () => void): () => void;
  open(projectId?: string): Promise<BuilderProjectControllerSnapshot>;
  generate(instruction: string): Promise<BuilderProjectControllerSnapshot>;
  save(): Promise<BuilderProjectControllerSnapshot>;
  dispose(): void;
}>;

const PROJECT_ID_PATTERN =
  /^builder-project:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const OID_PATTERN = /^[0-9a-f]{40}$/u;
const SAVE_RESULT_KEYS = Object.freeze([
  'result_version',
  'operation',
  'draft_id',
  'project_id',
  'revision_receipt_digest',
  'commit_oid',
  'tree_oid',
  'pending_draft_released',
  'save_evidence',
]);
const SAVE_EVIDENCE_KEYS = Object.freeze([
  'code_authority',
  'product_authority',
  'conversation_event_admission',
  'renderer_authority',
]);
const SELECTION_RESULT_KEYS = Object.freeze(['result_version', 'operation', 'project_id']);
const TRUSTED_SNAPSHOTS = new WeakSet<object>();

function snapshot(
  status: BuilderProjectControllerStatus,
  savedProject: BuilderProjectReadSnapshot | null,
  draft: BuilderGenerationDraft | null,
  preview: BuilderSourceTreePreviewProjection | null,
  error: BuilderProjectControllerError,
): BuilderProjectControllerSnapshot {
  const result = Object.freeze({
    status,
    busy: status === 'opening' || status === 'generating' || status === 'saving',
    savedProject,
    draft,
    preview,
    error,
  });
  TRUSTED_SNAPSHOTS.add(result);
  return result;
}

function draftMatchesSavedBase(
  draft: BuilderGenerationDraft,
  savedProject: BuilderProjectReadSnapshot | null,
): boolean {
  if (savedProject === null) return draft.base_revision_evidence === null;
  const base = draft.base_revision_evidence;
  return (
    base !== null
    && base.project_id === savedProject.target.project_id
    && base.revision_receipt_digest === savedProject.target.revision_receipt_digest
    && base.commit_oid === savedProject.target.commit_oid
    && base.source_tree_digest === savedProject.source_tree.source_tree_digest
  );
}

export function isTrustedBuilderProjectControllerSnapshot(
  value: unknown,
): value is BuilderProjectControllerSnapshot {
  return value !== null && typeof value === 'object' && TRUSTED_SNAPSHOTS.has(value);
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error();
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== keys.length
    || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) throw new Error();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw new Error();
    result[key] = descriptor.value;
  }
  return result;
}

function safeDigest(value: unknown): string {
  if (typeof value !== 'string' || !DIGEST_PATTERN.test(value)) throw new Error();
  return value;
}

function sanitizeSaveResult(value: unknown, draft: BuilderGenerationDraft) {
  const source = exactRecord(value, SAVE_RESULT_KEYS);
  if (
    source.result_version !== 'builder-project-save-result.v1'
    || source.operation !== 'draft_saved'
    || source.draft_id !== draft.draft_id
    || source.project_id !== draft.project_id
    || source.pending_draft_released !== true
    || typeof source.commit_oid !== 'string'
    || !OID_PATTERN.test(source.commit_oid)
    || typeof source.tree_oid !== 'string'
    || !OID_PATTERN.test(source.tree_oid)
  ) throw new Error();
  const evidence = exactRecord(source.save_evidence, SAVE_EVIDENCE_KEYS);
  if (
    evidence.code_authority !== 'git_commit_candidate'
    || evidence.product_authority !== 'sqlite_accepted_project_revision_receipt'
    || evidence.conversation_event_admission !== 'candidate_local_not_recorded'
    || evidence.renderer_authority !== 'draft_id_only'
  ) throw new Error();
  return Object.freeze({
    revision_receipt_digest: safeDigest(source.revision_receipt_digest),
    commit_oid: source.commit_oid as string,
    tree_oid: source.tree_oid as string,
  });
}

function selectedSourceTree(
  savedProject: BuilderProjectReadSnapshot | null,
  draft: BuilderGenerationDraft | null,
): Readonly<{ project_id: string; title: string; source_tree: BuilderProjectSourceTree }> | null {
  if (draft !== null) {
    return {
      project_id: draft.project_id,
      title: draft.title,
      source_tree: draft.source_tree,
    };
  }
  if (savedProject !== null) {
    return {
      project_id: savedProject.target.project_id,
      title: savedProject.target.title,
      source_tree: savedProject.source_tree,
    };
  }
  return null;
}

function savedMatchesDraft(
  saved: BuilderProjectReadSnapshot,
  draft: BuilderGenerationDraft,
  receipt: ReturnType<typeof sanitizeSaveResult>,
): boolean {
  return saved.operation === 'current_loaded'
    && saved.target.project_id === draft.project_id
    && saved.target.revision_receipt_digest === receipt.revision_receipt_digest
    && saved.target.commit_oid === receipt.commit_oid
    && saved.target.tree_oid === receipt.tree_oid
    && saved.target.candidate_id === draft.candidate.candidate_id
    && saved.target.candidate_digest === draft.candidate.candidate_digest
    && saved.target.resulting_tree_digest === draft.source_tree.source_tree_digest
    && saved.source_tree.source_tree_digest === draft.source_tree.source_tree_digest;
}

function sanitizeNewSelection(value: unknown): void {
  const source = exactRecord(value, SELECTION_RESULT_KEYS);
  if (
    source.result_version !== 'builder-project-selection-result.v1'
    || source.operation !== 'new_selected'
    || source.project_id !== null
  ) throw new Error();
}

function savedContainsDraft(
  saved: BuilderProjectReadSnapshot,
  draft: BuilderGenerationDraft,
): boolean {
  return saved.operation === 'current_loaded'
    && saved.target.project_id === draft.project_id
    && saved.target.candidate_id === draft.candidate.candidate_id
    && saved.target.candidate_digest === draft.candidate.candidate_digest
    && saved.target.resulting_tree_digest === draft.source_tree.source_tree_digest
    && saved.source_tree.source_tree_digest === draft.source_tree.source_tree_digest;
}

export function createBuilderProjectController(
  dependencies: BuilderProjectControllerDependencies,
): BuilderProjectController {
  const previewProject = dependencies.createPreview ?? createBuilderSourceTreePreview;
  let current = snapshot('new', null, null, null, null);
  let epoch = 0;
  let disposed = false;
  let inFlight: Promise<BuilderProjectControllerSnapshot> | null = null;
  const listeners = new Set<() => void>();

  function publish(next: BuilderProjectControllerSnapshot): BuilderProjectControllerSnapshot {
    if (disposed) return current;
    current = next;
    for (const listener of [...listeners]) {
      try { listener(); } catch { /* observers cannot interrupt controller state */ }
    }
    return current;
  }

  async function withPreview(
    status: 'ready' | 'draft_ready',
    savedProject: BuilderProjectReadSnapshot | null,
    draft: BuilderGenerationDraft | null,
    operationEpoch: number,
  ): Promise<BuilderProjectControllerSnapshot> {
    const source = selectedSourceTree(savedProject, draft);
    if (source === null || disposed || operationEpoch !== epoch) return current;
    try {
      const preview = await previewProject(source);
      if (disposed || operationEpoch !== epoch) return current;
      return publish(snapshot(status, savedProject, draft, preview, null));
    } catch {
      if (disposed || operationEpoch !== epoch) return current;
      return publish(snapshot(
        'preview_unavailable',
        savedProject,
        draft,
        null,
        'preview_unavailable',
      ));
    }
  }

  function run(
    operation: (operationEpoch: number) => Promise<BuilderProjectControllerSnapshot>,
  ): Promise<BuilderProjectControllerSnapshot> {
    if (disposed) return Promise.resolve(current);
    if (inFlight !== null) return inFlight;
    const operationEpoch = ++epoch;
    const running = operation(operationEpoch).catch(() => current);
    inFlight = running;
    void running.finally(() => {
      if (inFlight === running) inFlight = null;
    }).catch(() => undefined);
    return running;
  }

  async function open(projectId?: string): Promise<BuilderProjectControllerSnapshot> {
    epoch += 1;
    inFlight = null;
    if (projectId === undefined) {
      return run(async (operationEpoch) => {
        publish(snapshot('opening', null, null, null, null));
        try {
          sanitizeNewSelection(await dependencies.workspace.open({ project_id: null }));
          if (disposed || operationEpoch !== epoch) return current;
          return publish(snapshot('new', null, null, null, null));
        } catch {
          if (disposed || operationEpoch !== epoch) return current;
          return publish(snapshot('unavailable', null, null, null, 'unavailable'));
        }
      });
    }
    if (!PROJECT_ID_PATTERN.test(projectId)) {
      return publish(snapshot('unavailable', null, null, null, 'unavailable'));
    }
    return run(async (operationEpoch) => {
      publish(snapshot('opening', null, null, null, null));
      try {
        const saved = await sanitizeBuilderProjectReadSnapshot(
          await dependencies.workspace.open({ project_id: projectId }),
        );
        if (
          disposed
          || operationEpoch !== epoch
          || saved.operation !== 'current_loaded'
          || saved.target.project_id !== projectId
        ) return current;
        return withPreview('ready', saved, null, operationEpoch);
      } catch {
        if (disposed || operationEpoch !== epoch) return current;
        return publish(snapshot('unavailable', null, null, null, 'unavailable'));
      }
    });
  }

  async function generate(instruction: string): Promise<BuilderProjectControllerSnapshot> {
    if (
      disposed
      || current.busy
      || current.draft !== null
      || !['new', 'ready', 'generation_failed', 'preview_unavailable'].includes(current.status)
    ) return current;
    const retained = current.savedProject;
    return run(async (operationEpoch) => {
      publish(snapshot('generating', retained, null, current.preview, null));
      try {
        const request = await createBuilderGenerationRequest(
          instruction,
          retained?.target.project_id ?? null,
        );
        const draft = await sanitizeBuilderGenerationDraft(
          await dependencies.generator.generate(request),
          request,
        );
        if (!draftMatchesSavedBase(draft, retained)) throw new Error();
        if (disposed || operationEpoch !== epoch) return current;
        return withPreview('draft_ready', retained, draft, operationEpoch);
      } catch (error) {
        if (disposed || operationEpoch !== epoch) return current;
        return publish(snapshot(
          'generation_failed',
          retained,
          null,
          current.preview,
          sanitizeTrustedBuilderGenerationDiagnostic(error),
        ));
      }
    });
  }

  async function save(): Promise<BuilderProjectControllerSnapshot> {
    if (disposed || current.busy || current.draft === null) return current;
    const retained = current.savedProject;
    const draft = current.draft;
    return run(async (operationEpoch) => {
      publish(snapshot('saving', retained, draft, current.preview, null));
      let saveReceipt: ReturnType<typeof sanitizeSaveResult>;
      try {
        saveReceipt = sanitizeSaveResult(
          await dependencies.workspace.saveDraft({ draft_id: draft.draft_id }),
          draft,
        );
      } catch {
        if (disposed || operationEpoch !== epoch) return current;
        try {
          const recovered = await sanitizeBuilderProjectReadSnapshot(
            await dependencies.workspace.open({ project_id: draft.project_id }),
          );
          if (disposed || operationEpoch !== epoch) return current;
          if (savedContainsDraft(recovered, draft)) {
            return withPreview('ready', recovered, null, operationEpoch);
          }
        } catch {
          // The durable outcome remains unknown; the draft stays available for an explicit retry.
        }
        if (disposed || operationEpoch !== epoch) return current;
        return publish(snapshot('save_unknown', retained, draft, current.preview, 'save_unknown'));
      }
      try {
        const saved = await sanitizeBuilderProjectReadSnapshot(
          await dependencies.workspace.loadCurrent({ project_id: draft.project_id }),
        );
        if (disposed || operationEpoch !== epoch) return current;
        if (!savedMatchesDraft(saved, draft, saveReceipt)) {
          return publish(snapshot('conflict', retained, draft, current.preview, 'conflict'));
        }
        return withPreview('ready', saved, null, operationEpoch);
      } catch {
        if (disposed || operationEpoch !== epoch) return current;
        return publish(snapshot('save_unknown', retained, draft, current.preview, 'save_unknown'));
      }
    });
  }

  return Object.freeze({
    getSnapshot: () => current,
    subscribe(listener) {
      if (disposed) return () => undefined;
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    open,
    generate,
    save,
    dispose() {
      if (disposed) return;
      disposed = true;
      epoch += 1;
      listeners.clear();
    },
  });
}
