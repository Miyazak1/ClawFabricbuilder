import {
  createBuilderGenerationRequest,
  sanitizeBuilderApprovedPlanGenerationDraft,
  sanitizeBuilderGenerationAnswer,
  sanitizeRestoredBuilderGenerationDraft,
  sanitizeBuilderGenerationDraft,
  type BuilderApprovedPlanGenerationRequest,
  type BuilderGenerationRequest,
  type BuilderGenerationAnswer,
  type BuilderGenerationDraft,
} from './builderGeneration';
import {
  BUILDER_GENERATION_DIAGNOSTIC_RETRYABILITY,
  sanitizeTrustedBuilderGenerationDiagnostic,
  trustedBuilderGenerationDiagnosticCode,
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
  | 'submitting'
  | 'answering'
  | 'generating'
  | 'draft_ready'
  | 'saving'
  | 'rejecting'
  | 'answer_failed'
  | 'submit_failed'
  | 'generation_failed'
  | 'reject_failed'
  | 'save_unknown'
  | 'preview_unavailable'
  | 'conflict'
  | 'unavailable';

export type BuilderProjectControllerError =
  | BuilderGenerationDiagnosticCode
  | 'reject_failed'
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
  inspectedRevision: BuilderProjectReadSnapshot | null;
  answer: BuilderGenerationAnswer | null;
  preview: BuilderSourceTreePreviewProjection | null;
  error: BuilderProjectControllerError;
  retryableGeneration: boolean;
  workingProjectId: string | null;
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
  submit(instruction: string): Promise<BuilderProjectControllerSnapshot>;
  answer(instruction: string): Promise<BuilderProjectControllerSnapshot>;
  generate(instruction: string): Promise<BuilderProjectControllerSnapshot>;
  generateApprovedPlan(request: BuilderApprovedPlanGenerationRequest): Promise<BuilderProjectControllerSnapshot>;
  retryGenerate(): Promise<BuilderProjectControllerSnapshot>;
  restoreDraft(draftId: string): Promise<BuilderProjectControllerSnapshot>;
  inspectRevision(projectId: string, revisionReceiptDigest: string): Promise<BuilderProjectControllerSnapshot>;
  showCurrentRevision(): Promise<BuilderProjectControllerSnapshot>;
  rejectDraft(): Promise<BuilderProjectControllerSnapshot>;
  cancel(): Promise<BuilderProjectControllerSnapshot>;
  save(): Promise<BuilderProjectControllerSnapshot>;
  dispose(): void;
}>;

const PROJECT_ID_PATTERN =
  /^builder-project:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DRAFT_ID_PATTERN = /^builder-generation-draft:[0-9a-f]{64}$/u;
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
const CANCEL_RESULT_KEYS = Object.freeze(['request_id', 'cancelled']);
const REJECT_RESULT_KEYS = Object.freeze([
  'result_version',
  'draft_id',
  'project_id',
  'rejected',
  'pending_draft_released',
  'conversation_event_admission',
]);
const TRUSTED_SNAPSHOTS = new WeakSet<object>();

function snapshot(
  status: BuilderProjectControllerStatus,
  savedProject: BuilderProjectReadSnapshot | null,
  draft: BuilderGenerationDraft | null,
  preview: BuilderSourceTreePreviewProjection | null,
  error: BuilderProjectControllerError,
  answer: BuilderGenerationAnswer | null = null,
  inspectedRevision: BuilderProjectReadSnapshot | null = null,
  retryableGeneration = false,
  workingProjectId: string | null = null,
): BuilderProjectControllerSnapshot {
  const result = Object.freeze({
    status,
    busy: status === 'opening'
      || status === 'submitting'
      || status === 'answering'
      || status === 'generating'
      || status === 'saving'
      || status === 'rejecting',
    savedProject,
    draft,
    inspectedRevision,
    answer,
    preview,
    error,
    retryableGeneration,
    workingProjectId,
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

function sanitizeCancelResult(value: unknown, requestId: string): boolean {
  const source = exactRecord(value, CANCEL_RESULT_KEYS);
  if (source.request_id !== requestId || typeof source.cancelled !== 'boolean') throw new Error();
  return source.cancelled;
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
    || evidence.conversation_event_admission !== 'sqlite_recorded'
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
  inspectedRevision: BuilderProjectReadSnapshot | null,
): Readonly<{ project_id: string; title: string; source_tree: BuilderProjectSourceTree }> | null {
  if (draft !== null) {
    return {
      project_id: draft.project_id,
      title: draft.title,
      source_tree: draft.source_tree,
    };
  }
  if (inspectedRevision !== null) {
    return {
      project_id: inspectedRevision.target.project_id,
      title: inspectedRevision.target.title,
      source_tree: inspectedRevision.source_tree,
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

function sanitizeRejectResult(value: unknown, draft: BuilderGenerationDraft): void {
  const source = exactRecord(value, REJECT_RESULT_KEYS);
  if (
    source.result_version !== 'builder-generation-draft-rejection-result.v1'
    || source.draft_id !== draft.draft_id
    || source.project_id !== draft.project_id
    || source.rejected !== true
    || source.pending_draft_released !== true
    || source.conversation_event_admission !== 'sqlite_recorded'
  ) throw new Error();
}

function isExplanationResult(value: unknown): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const descriptor = Object.getOwnPropertyDescriptor(value, 'result_kind');
  return descriptor !== undefined
    && descriptor.enumerable === true
    && Object.hasOwn(descriptor, 'value')
    && descriptor.value === 'explanation';
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

function latestCurrentMatchesSaved(
  saved: BuilderProjectReadSnapshot,
  revision: BuilderProjectReadSnapshot,
): boolean {
  const currentSummary = revision.latestCurrent;
  const savedTarget = saved.target;
  return (
    revision.operation === 'revision_loaded'
    && currentSummary.project_id === savedTarget.project_id
    && currentSummary.title === savedTarget.title
    && currentSummary.summary === savedTarget.summary
    && currentSummary.revision_receipt_digest === savedTarget.revision_receipt_digest
    && currentSummary.revision_number === savedTarget.revision_number
    && currentSummary.object_format === savedTarget.object_format
    && currentSummary.commit_oid === savedTarget.commit_oid
    && currentSummary.tree_oid === savedTarget.tree_oid
    && currentSummary.parent_oid === savedTarget.parent_oid
  );
}

function settledStatus(
  savedProject: BuilderProjectReadSnapshot | null,
  preview: BuilderSourceTreePreviewProjection | null,
): 'new' | 'ready' | 'preview_unavailable' {
  if (savedProject === null) return 'new';
  return preview === null ? 'preview_unavailable' : 'ready';
}

export function createBuilderProjectController(
  dependencies: BuilderProjectControllerDependencies,
): BuilderProjectController {
  const previewProject = dependencies.createPreview ?? createBuilderSourceTreePreview;
  let current = snapshot('new', null, null, null, null);
  let epoch = 0;
  let disposed = false;
  let inFlight: Promise<BuilderProjectControllerSnapshot> | null = null;
  let activeGeneration: Readonly<{
    before: BuilderProjectControllerSnapshot;
    projectId: string | null;
    requestId: string | null;
  }> | null = null;
  let retryableGeneration: Readonly<{ request: BuilderGenerationRequest }> | null = null;
  const listeners = new Set<() => void>();
  const unsubscribeStarted = dependencies.generator.subscribeStarted?.((event) => {
    const target = activeGeneration;
    if (
      disposed
      || target === null
      || (target.requestId !== null && target.requestId !== event.request_id)
      || (target.requestId === null && target.projectId !== event.project_id)
      || !current.busy
      || current.draft !== null
      || current.inspectedRevision !== null
      || (current.savedProject !== null && current.savedProject.target.project_id !== event.project_id)
    ) return;
    if (target.requestId === null) {
      activeGeneration = Object.freeze({
        before: target.before,
        projectId: target.projectId,
        requestId: event.request_id,
      });
    }
    publish(snapshot(
      current.status,
      current.savedProject,
      current.draft,
      current.preview,
      current.error,
      current.answer,
      current.inspectedRevision,
      current.retryableGeneration,
      event.project_id,
    ));
  });

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
    inspectedRevision: BuilderProjectReadSnapshot | null = null,
  ): Promise<BuilderProjectControllerSnapshot> {
    const source = selectedSourceTree(savedProject, draft, inspectedRevision);
    if (source === null || disposed || operationEpoch !== epoch) return current;
    try {
      const preview = await previewProject(source);
      if (disposed || operationEpoch !== epoch) return current;
      return publish(snapshot(status, savedProject, draft, preview, null, null, inspectedRevision));
    } catch {
      if (disposed || operationEpoch !== epoch) return current;
      return publish(snapshot(
        'preview_unavailable',
        savedProject,
        draft,
        null,
        'preview_unavailable',
        null,
        inspectedRevision,
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

  function clearActiveGeneration(requestId: string, operationEpoch: number): void {
    if (operationEpoch === epoch && activeGeneration?.requestId === requestId) {
      activeGeneration = null;
    }
  }

  function clearProjectGeneration(projectId: string, operationEpoch: number): void {
    if (operationEpoch === epoch && activeGeneration?.projectId === projectId) {
      activeGeneration = null;
    }
  }

  function generationFailureDiagnostic(
    error: unknown,
    request: BuilderGenerationRequest | null,
  ): BuilderGenerationDiagnosticCode {
    const trustedCode = trustedBuilderGenerationDiagnosticCode(error);
    if (
      request !== null
      && trustedCode !== null
      && BUILDER_GENERATION_DIAGNOSTIC_RETRYABILITY[trustedCode]
    ) {
      retryableGeneration = Object.freeze({ request });
    } else {
      retryableGeneration = null;
    }
    return trustedCode ?? sanitizeTrustedBuilderGenerationDiagnostic(error);
  }

  function withoutRetryableGeneration(
    value: BuilderProjectControllerSnapshot,
  ): BuilderProjectControllerSnapshot {
    if (!value.retryableGeneration) return value;
    return snapshot(
      value.status,
      value.savedProject,
      value.draft,
      value.preview,
      value.error,
      value.answer,
      value.inspectedRevision,
      false,
      value.workingProjectId,
    );
  }

  async function open(projectId?: string): Promise<BuilderProjectControllerSnapshot> {
    epoch += 1;
    inFlight = null;
    activeGeneration = null;
    retryableGeneration = null;
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

  async function answer(instruction: string): Promise<BuilderProjectControllerSnapshot> {
    if (
      disposed
      || current.busy
      || current.draft !== null
      || current.inspectedRevision !== null
      || !['new', 'ready', 'answer_failed', 'submit_failed', 'generation_failed', 'preview_unavailable'].includes(current.status)
    ) return current;
    const retained = current.savedProject;
    const retainedPreview = current.preview;
    retryableGeneration = null;
    const before = withoutRetryableGeneration(current);
    return run(async (operationEpoch) => {
      publish(snapshot('answering', retained, null, retainedPreview, null));
      let requestId: string | null = null;
      try {
        const request = await createBuilderGenerationRequest(
          instruction,
          retained?.target.project_id ?? null,
        );
        requestId = request.request_digest;
        activeGeneration = Object.freeze({
          before,
          projectId: retained?.target.project_id ?? null,
          requestId,
        });
        const answered = await sanitizeBuilderGenerationAnswer(
          await dependencies.generator.answer(request),
          request,
        );
        clearActiveGeneration(request.request_digest, operationEpoch);
        if (disposed || operationEpoch !== epoch) return current;
        return publish(snapshot(
          settledStatus(retained, retainedPreview),
          retained,
          null,
          retainedPreview,
          null,
          answered,
        ));
      } catch (error) {
        if (requestId !== null) clearActiveGeneration(requestId, operationEpoch);
        if (disposed || operationEpoch !== epoch) return current;
        return publish(snapshot(
          'answer_failed',
          retained,
          null,
          retainedPreview,
          sanitizeTrustedBuilderGenerationDiagnostic(error),
        ));
      }
    });
  }

  async function submit(instruction: string): Promise<BuilderProjectControllerSnapshot> {
    if (
      disposed
      || current.busy
      || current.draft !== null
      || current.inspectedRevision !== null
      || !['new', 'ready', 'answer_failed', 'submit_failed', 'generation_failed', 'preview_unavailable'].includes(current.status)
    ) return current;
    const retained = current.savedProject;
    const retainedPreview = current.preview;
    retryableGeneration = null;
    const before = withoutRetryableGeneration(current);
    return run(async (operationEpoch) => {
      publish(snapshot('submitting', retained, null, retainedPreview, null));
      let requestId: string | null = null;
      let request: BuilderGenerationRequest | null = null;
      try {
        request = await createBuilderGenerationRequest(
          instruction,
          retained?.target.project_id ?? null,
        );
        requestId = request.request_digest;
        activeGeneration = Object.freeze({
          before,
          projectId: retained?.target.project_id ?? null,
          requestId,
        });
        const result = await dependencies.generator.submit(request);
        if (isExplanationResult(result)) {
          const answered = await sanitizeBuilderGenerationAnswer(result, request);
          clearActiveGeneration(request.request_digest, operationEpoch);
          if (disposed || operationEpoch !== epoch) return current;
          return publish(snapshot(
            settledStatus(retained, retainedPreview),
            retained,
            null,
            retainedPreview,
            null,
            answered,
          ));
        }
        const draft = await sanitizeBuilderGenerationDraft(result, request);
        clearActiveGeneration(request.request_digest, operationEpoch);
        if (!draftMatchesSavedBase(draft, retained)) throw new Error();
        if (disposed || operationEpoch !== epoch) return current;
        return withPreview('draft_ready', retained, draft, operationEpoch);
      } catch (error) {
        if (requestId !== null) clearActiveGeneration(requestId, operationEpoch);
        if (disposed || operationEpoch !== epoch) return current;
        return publish(snapshot(
          'submit_failed',
          retained,
          null,
          retainedPreview,
          sanitizeTrustedBuilderGenerationDiagnostic(error),
          null,
          null,
          false,
        ));
      }
    });
  }

  async function generate(instruction: string): Promise<BuilderProjectControllerSnapshot> {
    if (
      disposed
      || current.busy
      || current.draft !== null
      || current.inspectedRevision !== null
      || !['new', 'ready', 'answer_failed', 'submit_failed', 'generation_failed', 'preview_unavailable'].includes(current.status)
    ) return current;
    const retained = current.savedProject;
    retryableGeneration = null;
    const before = withoutRetryableGeneration(current);
    return run(async (operationEpoch) => {
      publish(snapshot('generating', retained, null, current.preview, null));
      let requestId: string | null = null;
      let request: BuilderGenerationRequest | null = null;
      try {
        request = await createBuilderGenerationRequest(
          instruction,
          retained?.target.project_id ?? null,
        );
        requestId = request.request_digest;
        activeGeneration = Object.freeze({
          before,
          projectId: retained?.target.project_id ?? null,
          requestId,
        });
        const draft = await sanitizeBuilderGenerationDraft(
          await dependencies.generator.generate(request),
          request,
        );
        clearActiveGeneration(request.request_digest, operationEpoch);
        if (!draftMatchesSavedBase(draft, retained)) throw new Error();
        if (disposed || operationEpoch !== epoch) return current;
        return withPreview('draft_ready', retained, draft, operationEpoch);
      } catch (error) {
        if (requestId !== null) clearActiveGeneration(requestId, operationEpoch);
        if (disposed || operationEpoch !== epoch) return current;
        return publish(snapshot(
          'generation_failed',
          retained,
          null,
          current.preview,
          generationFailureDiagnostic(error, request),
          null,
          null,
          retryableGeneration !== null,
        ));
      }
    });
  }

  async function retryGenerate(): Promise<BuilderProjectControllerSnapshot> {
    if (
      disposed
      || current.busy
      || current.draft !== null
      || current.inspectedRevision !== null
      || current.status !== 'generation_failed'
      || retryableGeneration === null
    ) return current;
    const retained = current.savedProject;
    const before = current;
    const request = retryableGeneration.request;
    if ((retained?.target.project_id ?? null) !== request.existing_project_id) return current;
    return run(async (operationEpoch) => {
      publish(snapshot('generating', retained, null, current.preview, null));
      activeGeneration = Object.freeze({
        before,
        projectId: retained?.target.project_id ?? null,
        requestId: request.request_digest,
      });
      try {
        const draft = await sanitizeBuilderGenerationDraft(
          await dependencies.generator.retry(request),
          request,
        );
        clearActiveGeneration(request.request_digest, operationEpoch);
        if (!draftMatchesSavedBase(draft, retained)) throw new Error();
        if (disposed || operationEpoch !== epoch) return current;
        retryableGeneration = null;
        return withPreview('draft_ready', retained, draft, operationEpoch);
      } catch (error) {
        clearActiveGeneration(request.request_digest, operationEpoch);
        if (disposed || operationEpoch !== epoch) return current;
        return publish(snapshot(
          'generation_failed',
          retained,
          null,
          current.preview,
          generationFailureDiagnostic(error, request),
          null,
          null,
          retryableGeneration !== null,
        ));
      }
    });
  }

  async function generateApprovedPlan(
    request: BuilderApprovedPlanGenerationRequest,
  ): Promise<BuilderProjectControllerSnapshot> {
    const retained = current.savedProject;
    if (
      disposed
      || current.busy
      || current.draft !== null
      || current.inspectedRevision !== null
      || retained === null
      || !['ready', 'preview_unavailable'].includes(current.status)
      || retained.target.project_id !== request.project_id
      || retained.target.conversation_id !== request.conversation_id
    ) return current;
    retryableGeneration = null;
    const before = withoutRetryableGeneration(current);
    return run(async (operationEpoch) => {
      publish(snapshot('generating', retained, null, current.preview, null));
      activeGeneration = Object.freeze({
        before,
        projectId: request.project_id,
        requestId: null,
      });
      try {
        const draft = await sanitizeBuilderApprovedPlanGenerationDraft(
          await dependencies.generator.generateApprovedPlan(request),
          request,
        );
        clearProjectGeneration(request.project_id, operationEpoch);
        if (!draftMatchesSavedBase(draft, retained)) throw new Error();
        if (disposed || operationEpoch !== epoch) return current;
        return withPreview('draft_ready', retained, draft, operationEpoch);
      } catch (error) {
        clearProjectGeneration(request.project_id, operationEpoch);
        if (disposed || operationEpoch !== epoch) return current;
        return publish(snapshot(
          'generation_failed',
          retained,
          null,
          current.preview,
          sanitizeTrustedBuilderGenerationDiagnostic(error),
          null,
          null,
          false,
        ));
      }
    });
  }

  async function restoreDraft(draftId: string): Promise<BuilderProjectControllerSnapshot> {
    if (
      disposed
      || current.busy
      || current.draft !== null
      || current.inspectedRevision !== null
      || !DRAFT_ID_PATTERN.test(draftId)
      || !['ready', 'generation_failed', 'preview_unavailable'].includes(current.status)
    ) return current;
    const retained = current.savedProject;
    const beforeRestore = current;
    return run(async (operationEpoch) => {
      publish(snapshot('opening', retained, null, current.preview, null));
      try {
        const draft = await sanitizeRestoredBuilderGenerationDraft(
          await dependencies.generator.restoreDraft({ draft_id: draftId }),
          draftId,
        );
        if (!draftMatchesSavedBase(draft, retained)) throw new Error();
        if (disposed || operationEpoch !== epoch) return current;
        retryableGeneration = null;
        return withPreview('draft_ready', retained, draft, operationEpoch);
      } catch {
        if (disposed || operationEpoch !== epoch) return current;
        return publish(beforeRestore);
      }
    });
  }

  async function inspectRevision(
    projectId: string,
    revisionReceiptDigest: string,
  ): Promise<BuilderProjectControllerSnapshot> {
    if (
      disposed
      || current.busy
      || current.draft !== null
      || current.savedProject === null
      || current.savedProject.target.project_id !== projectId
      || !PROJECT_ID_PATTERN.test(projectId)
      || !DIGEST_PATTERN.test(revisionReceiptDigest)
    ) return current;
    if (current.savedProject.target.revision_receipt_digest === revisionReceiptDigest) {
      return showCurrentRevision();
    }
    const retained = current.savedProject;
    const beforeInspect = current;
    return run(async (operationEpoch) => {
      publish(snapshot('opening', retained, null, current.preview, null, current.answer, current.inspectedRevision));
      try {
        const inspected = await sanitizeBuilderProjectReadSnapshot(
          await dependencies.workspace.loadRevision({
            project_id: projectId,
            revision_receipt_digest: revisionReceiptDigest,
          }),
        );
        if (
          disposed
          || operationEpoch !== epoch
          || inspected.operation !== 'revision_loaded'
          || inspected.target.project_id !== projectId
          || inspected.target.revision_receipt_digest !== revisionReceiptDigest
          || !latestCurrentMatchesSaved(retained, inspected)
        ) throw new Error();
        return withPreview('ready', retained, null, operationEpoch, inspected);
      } catch {
        if (disposed || operationEpoch !== epoch) return current;
        return publish(beforeInspect);
      }
    });
  }

  async function showCurrentRevision(): Promise<BuilderProjectControllerSnapshot> {
    if (
      disposed
      || current.busy
      || current.draft !== null
      || current.savedProject === null
      || current.inspectedRevision === null
    ) return current;
    const retained = current.savedProject;
    return run((operationEpoch) => withPreview('ready', retained, null, operationEpoch));
  }

  async function cancel(): Promise<BuilderProjectControllerSnapshot> {
    const target = activeGeneration;
    if (
      disposed
      || target === null
      || target.requestId === null
      || !['answering', 'generating', 'submitting'].includes(current.status)
    ) return current;
    try {
      const cancelled = sanitizeCancelResult(
        await dependencies.generator.cancel({ request_id: target.requestId }),
        target.requestId,
      );
      if (!cancelled || disposed || activeGeneration !== target) return current;
      epoch += 1;
      inFlight = null;
      activeGeneration = null;
      return publish(target.before);
    } catch {
      return current;
    }
  }

  async function rejectDraft(): Promise<BuilderProjectControllerSnapshot> {
    if (disposed || current.busy || current.draft === null) return current;
    const retained = current.savedProject;
    const draft = current.draft;
    return run(async (operationEpoch) => {
      publish(snapshot('rejecting', retained, draft, current.preview, null));
      try {
        sanitizeRejectResult(
          await dependencies.generator.rejectDraft({ draft_id: draft.draft_id }),
          draft,
        );
        if (disposed || operationEpoch !== epoch) return current;
        if (retained === null) return publish(snapshot('new', null, null, null, null));
        return withPreview('ready', retained, null, operationEpoch);
      } catch {
        if (disposed || operationEpoch !== epoch) return current;
        return publish(snapshot('reject_failed', retained, draft, current.preview, 'reject_failed'));
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
    submit,
    answer,
    generate,
    generateApprovedPlan,
    retryGenerate,
    restoreDraft,
    inspectRevision,
    showCurrentRevision,
    rejectDraft,
    cancel,
    save,
    dispose() {
      if (disposed) return;
      disposed = true;
      epoch += 1;
      activeGeneration = null;
      retryableGeneration = null;
      listeners.clear();
      unsubscribeStarted?.();
    },
  });
}
