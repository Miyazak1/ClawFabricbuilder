import {
  createBuilderGenerationRequest,
  sanitizeBuilderApprovedPlanGenerationDraft,
  sanitizeBuilderGenerationAnswer,
  sanitizeBuilderGenerationPlan,
  sanitizeBuilderRevisionRestoreGenerationDraft,
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
  | 'restoring'
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

export type BuilderWorkingProjectSourceFolder = Readonly<{
  name: string;
  status: 'selected';
}>;

export type BuilderWorkingProject = Readonly<{
  project_id: string;
  title: string;
  source_folders: readonly BuilderWorkingProjectSourceFolder[];
}>;

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
  conversationProjectId: string | null;
  workingProjectId: string | null;
  workingProject: BuilderWorkingProject | null;
}>;

export type BuilderProjectControllerDependencies = Readonly<{
  generator: BuilderCodeGeneratorPort;
  workspace: BuilderProjectWorkspacePort;
  createPreview?: typeof createBuilderSourceTreePreview;
}>;

type RetryableGeneration =
  | Readonly<{ kind: 'generation'; request: BuilderGenerationRequest }>
  | Readonly<{ kind: 'submit'; request: BuilderGenerationRequest }>
  | Readonly<{ kind: 'approved_plan'; request: BuilderApprovedPlanGenerationRequest }>;

export type BuilderProjectController = Readonly<{
  getSnapshot(): BuilderProjectControllerSnapshot;
  subscribe(listener: () => void): () => void;
  retainConversationProject(projectId: string): BuilderProjectControllerSnapshot;
  clearWorkspaceSelection(): BuilderProjectControllerSnapshot;
  open(projectId?: string): Promise<BuilderProjectControllerSnapshot>;
  createLocalProject(projectTitle: string): Promise<BuilderProjectControllerSnapshot>;
  submit(instruction: string): Promise<BuilderProjectControllerSnapshot>;
  answer(instruction: string): Promise<BuilderProjectControllerSnapshot>;
  proposePlan(instruction: string): Promise<BuilderProjectControllerSnapshot>;
  generate(instruction: string): Promise<BuilderProjectControllerSnapshot>;
  generateApprovedPlan(request: BuilderApprovedPlanGenerationRequest): Promise<BuilderProjectControllerSnapshot>;
  retryGenerate(): Promise<BuilderProjectControllerSnapshot>;
  restoreDraft(draftId: string): Promise<BuilderProjectControllerSnapshot>;
  restoreRevisionAsDraft(
    projectId: string,
    revisionReceiptDigest: string,
  ): Promise<BuilderProjectControllerSnapshot>;
  inspectRevision(projectId: string, revisionReceiptDigest: string): Promise<BuilderProjectControllerSnapshot>;
  showCurrentRevision(): Promise<BuilderProjectControllerSnapshot>;
  rejectDraft(): Promise<BuilderProjectControllerSnapshot>;
  cancel(): Promise<BuilderProjectControllerSnapshot>;
  steer(message: string): Promise<boolean>;
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
const LOCAL_PROJECT_SELECTION_RESULT_KEYS = Object.freeze([
  'result_version',
  'operation',
  'project_id',
  'project_title',
  'source_folders',
]);
const SOURCE_FOLDER_SELECTION_KEYS = Object.freeze(['name', 'status']);
const CANCEL_RESULT_KEYS = Object.freeze(['request_id', 'cancelled']);
const STEER_RESULT_KEYS = Object.freeze(['request_id', 'steered']);
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
  workingProject: BuilderWorkingProject | null = null,
  conversationProjectId: string | null = null,
): BuilderProjectControllerSnapshot {
  const selectedWorkingProject = workingProjectId !== null
    && workingProject !== null
    && workingProject.project_id === workingProjectId
    ? workingProject
    : null;
  const result = Object.freeze({
    status,
    busy: status === 'opening'
      || status === 'submitting'
      || status === 'answering'
      || status === 'generating'
      || status === 'restoring'
      || status === 'saving'
      || status === 'rejecting',
    savedProject,
    draft,
    inspectedRevision,
    answer,
    preview,
    error,
    retryableGeneration,
    conversationProjectId,
    workingProjectId,
    workingProject: selectedWorkingProject,
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

function buildWorkspaceRequiredSnapshot(
  status: 'submit_failed' | 'generation_failed',
  retained: BuilderProjectReadSnapshot | null,
  preview: BuilderSourceTreePreviewProjection | null,
  answer: BuilderGenerationAnswer | null,
  conversationProjectId: string | null = null,
): BuilderProjectControllerSnapshot {
  return snapshot(
    status,
    retained,
    null,
    preview,
    'builder_generation_project_workspace_required',
    answer,
    null,
    false,
    null,
    null,
    conversationProjectId,
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

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function safePublicText(value: unknown, maximumLength: number): string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > maximumLength * 2
    || value.length > maximumLength
    || value.trim() !== value
    || hasControlCharacter(value)
  ) throw new Error();
  return value;
}

function safeProjectTitleInput(value: string): string {
  return safePublicText(value, 80);
}

function sanitizeCancelResult(value: unknown, requestId: string): boolean {
  const source = exactRecord(value, CANCEL_RESULT_KEYS);
  if (source.request_id !== requestId || typeof source.cancelled !== 'boolean') throw new Error();
  return source.cancelled;
}

function sanitizeSteerResult(value: unknown, requestId: string): boolean {
  const source = exactRecord(value, STEER_RESULT_KEYS);
  if (source.request_id !== requestId || typeof source.steered !== 'boolean') throw new Error();
  return source.steered;
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

function sanitizeLocalProject(value: unknown): BuilderWorkingProject {
  const source = exactRecord(value, LOCAL_PROJECT_SELECTION_RESULT_KEYS);
  if (
    source.result_version !== 'builder-project-selection-result.v1'
    || source.operation !== 'local_project_bound'
    || typeof source.project_id !== 'string'
    || !PROJECT_ID_PATTERN.test(source.project_id)
  ) throw new Error();
  if (!Array.isArray(source.source_folders) || source.source_folders.length !== 1) throw new Error();
  const folder = exactRecord(source.source_folders[0], SOURCE_FOLDER_SELECTION_KEYS);
  if (folder.status !== 'selected') throw new Error();
  return Object.freeze({
    project_id: source.project_id,
    title: safePublicText(source.project_title, 80),
    source_folders: Object.freeze([
      Object.freeze({
        name: safePublicText(folder.name, 120),
        status: 'selected' as const,
      }),
    ]),
  });
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
  workingProjectId: string | null = null,
): 'new' | 'ready' | 'preview_unavailable' {
  if (savedProject === null) return workingProjectId === null ? 'new' : 'ready';
  return preview === null ? 'preview_unavailable' : 'ready';
}

function unsavedWorkingProjectId(
  savedProject: BuilderProjectReadSnapshot | null,
  draft: BuilderGenerationDraft | null,
  fallback: string | null,
): string | null {
  if (savedProject !== null) return null;
  return draft?.project_id ?? fallback;
}

function unsavedWorkingProject(
  savedProject: BuilderProjectReadSnapshot | null,
  draft: BuilderGenerationDraft | null,
  fallbackProjectId: string | null,
  fallbackWorkingProject: BuilderWorkingProject | null,
): BuilderWorkingProject | null {
  const projectId = unsavedWorkingProjectId(savedProject, draft, fallbackProjectId);
  return projectId !== null && fallbackWorkingProject?.project_id === projectId
    ? fallbackWorkingProject
    : null;
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
  let retryableGeneration: RetryableGeneration | null = null;
  const listeners = new Set<() => void>();
  const unsubscribeStarted = dependencies.generator.subscribeStarted?.((event) => {
    const target = activeGeneration;
    if (
      disposed
      || target === null
      || (target.requestId !== null && target.requestId !== event.request_id)
      || (target.requestId === null && target.projectId !== event.project_id)
      || !current.busy
      || current.inspectedRevision !== null
      || (current.savedProject !== null && current.savedProject.target.project_id !== event.project_id)
      || (current.savedProject === null && current.workingProjectId !== null && current.workingProjectId !== event.project_id)
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
      current.workingProject,
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
      return publish(snapshot(
        status,
        savedProject,
        draft,
        preview,
        null,
        null,
        inspectedRevision,
        false,
        unsavedWorkingProjectId(savedProject, draft, current.workingProjectId),
        unsavedWorkingProject(savedProject, draft, current.workingProjectId, current.workingProject),
        current.conversationProjectId,
      ));
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
        false,
        unsavedWorkingProjectId(savedProject, draft, current.workingProjectId),
        unsavedWorkingProject(savedProject, draft, current.workingProjectId, current.workingProject),
        current.conversationProjectId,
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
      retryableGeneration = Object.freeze({ kind: 'generation', request });
    } else {
      retryableGeneration = null;
    }
    return trustedCode ?? sanitizeTrustedBuilderGenerationDiagnostic(error);
  }

  function submitFailureDiagnostic(
    error: unknown,
    request: BuilderGenerationRequest | null,
  ): BuilderGenerationDiagnosticCode {
    const trustedCode = trustedBuilderGenerationDiagnosticCode(error);
    if (
      request !== null
      && trustedCode !== null
      && BUILDER_GENERATION_DIAGNOSTIC_RETRYABILITY[trustedCode]
    ) {
      retryableGeneration = Object.freeze({ kind: 'submit', request });
    } else {
      retryableGeneration = null;
    }
    return trustedCode ?? sanitizeTrustedBuilderGenerationDiagnostic(error);
  }

  function approvedPlanGenerationFailureDiagnostic(
    error: unknown,
    request: BuilderApprovedPlanGenerationRequest,
  ): BuilderGenerationDiagnosticCode {
    const trustedCode = trustedBuilderGenerationDiagnosticCode(error);
    if (
      trustedCode !== null
      && BUILDER_GENERATION_DIAGNOSTIC_RETRYABILITY[trustedCode]
    ) {
      retryableGeneration = Object.freeze({ kind: 'approved_plan', request });
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
      value.workingProject,
      value.conversationProjectId,
    );
  }

  function retainConversationProject(projectId: string): BuilderProjectControllerSnapshot {
    if (disposed || !PROJECT_ID_PATTERN.test(projectId)) return current;
    if (current.savedProject !== null && current.savedProject.target.project_id !== projectId) return current;
    if (current.draft !== null && current.draft.project_id !== projectId) return current;
    if (current.workingProjectId !== null && current.workingProjectId !== projectId) return current;
    if (current.answer?.project_id === projectId || current.conversationProjectId === projectId) return current;
    return publish(snapshot(
      current.status,
      current.savedProject,
      current.draft,
      current.preview,
      current.error,
      current.answer,
      current.inspectedRevision,
      current.retryableGeneration,
      current.workingProjectId,
      current.workingProject,
      projectId,
    ));
  }

  function clearWorkspaceSelection(): BuilderProjectControllerSnapshot {
    if (
      disposed
      || current.busy
      || current.draft !== null
      || current.inspectedRevision !== null
      || (current.savedProject === null && current.workingProjectId === null)
    ) return current;
    epoch += 1;
    inFlight = null;
    activeGeneration = null;
    retryableGeneration = null;
    const retainedConversationProjectId = current.conversationProjectId
      ?? current.answer?.project_id
      ?? current.savedProject?.target.project_id
      ?? current.workingProjectId;
    return publish(snapshot(
      'new',
      null,
      null,
      null,
      null,
      current.answer,
      null,
      false,
      null,
      null,
      retainedConversationProjectId,
    ));
  }

  async function bindProjectForBuild(
    status: 'submit_failed' | 'generation_failed',
    retained: BuilderProjectReadSnapshot | null,
    preview: BuilderSourceTreePreviewProjection | null,
  ): Promise<string | null> {
    const existingProjectId = retained?.target.project_id ?? current.workingProjectId;
    if (existingProjectId !== null) return existingProjectId;
    publish(buildWorkspaceRequiredSnapshot(status, retained, preview, current.answer, current.conversationProjectId));
    return null;
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
        const opened = await dependencies.workspace.open({ project_id: projectId });
        try {
          const saved = await sanitizeBuilderProjectReadSnapshot(opened);
          if (
            disposed
            || operationEpoch !== epoch
            || saved.operation !== 'current_loaded'
            || saved.target.project_id !== projectId
          ) return current;
          return withPreview('ready', saved, null, operationEpoch);
        } catch {
          const workingProject = sanitizeLocalProject(opened);
          if (disposed || operationEpoch !== epoch || workingProject.project_id !== projectId) return current;
          return publish(snapshot(
            'ready',
            null,
            null,
            null,
            null,
            null,
            null,
            false,
            workingProject.project_id,
            workingProject,
          ));
        }
      } catch {
        if (disposed || operationEpoch !== epoch) return current;
        return publish(snapshot('unavailable', null, null, null, 'unavailable'));
      }
    });
  }

  async function createLocalProject(projectTitle: string): Promise<BuilderProjectControllerSnapshot> {
    if (disposed || current.busy || current.draft !== null || current.inspectedRevision !== null) return current;
    epoch += 1;
    inFlight = null;
    activeGeneration = null;
    retryableGeneration = null;
    const logicalProjectId = current.answer?.project_id ?? current.conversationProjectId ?? null;
    return run(async (operationEpoch) => {
      publish(snapshot('opening', null, null, null, null));
      try {
        const workingProject = sanitizeLocalProject(await dependencies.workspace.createLocalProject({
          project_id: logicalProjectId,
          project_title: safeProjectTitleInput(projectTitle),
        }));
        if (disposed || operationEpoch !== epoch) return current;
        return publish(snapshot(
          'ready',
          null,
          null,
          null,
          null,
          null,
          null,
          false,
          workingProject.project_id,
          workingProject,
        ));
      } catch {
        if (disposed || operationEpoch !== epoch) return current;
        return publish(snapshot('new', null, null, null, null));
      }
    });
  }

  async function answer(instruction: string): Promise<BuilderProjectControllerSnapshot> {
    if (
      disposed
      || current.busy
      || current.inspectedRevision !== null
      || ![
        'new',
        'ready',
        'draft_ready',
        'answer_failed',
        'submit_failed',
        'generation_failed',
        'preview_unavailable',
      ].includes(current.status)
    ) return current;
    const retained = current.savedProject;
    const retainedDraft = current.draft;
    const retainedPreview = current.preview;
    const targetProjectId = retainedDraft?.project_id
      ?? retained?.target.project_id
      ?? current.workingProjectId
      ?? current.answer?.project_id
      ?? current.conversationProjectId
      ?? null;
    const workspaceProjectId = retainedDraft?.project_id ?? retained?.target.project_id ?? current.workingProjectId;
    const retainedAnswer = current.answer;
    retryableGeneration = null;
    const before = withoutRetryableGeneration(current);
    return run(async (operationEpoch) => {
      publish(snapshot(
        'answering',
        retained,
        retainedDraft,
        retainedPreview,
        null,
        retainedAnswer,
        null,
        false,
        unsavedWorkingProjectId(retained, retainedDraft, workspaceProjectId),
        unsavedWorkingProject(retained, retainedDraft, workspaceProjectId, current.workingProject),
        current.conversationProjectId,
      ));
      let requestId: string | null = null;
      try {
        const request = await createBuilderGenerationRequest(
          instruction,
          targetProjectId,
        );
        requestId = request.request_digest;
        activeGeneration = Object.freeze({
          before,
          projectId: targetProjectId,
          requestId,
        });
        const answered = await sanitizeBuilderGenerationAnswer(
          retainedDraft === null
            ? await dependencies.generator.answer(request)
            : await dependencies.generator.answerDraft({
              draft_id: retainedDraft.draft_id,
              instruction: request.instruction,
            }),
          request,
        );
        clearActiveGeneration(request.request_digest, operationEpoch);
        if (disposed || operationEpoch !== epoch) return current;
        return publish(snapshot(
          retainedDraft === null
            ? settledStatus(retained, retainedPreview, workspaceProjectId)
            : retainedPreview === null ? 'preview_unavailable' : 'draft_ready',
          retained,
          retainedDraft,
          retainedPreview,
          null,
          answered,
          null,
          false,
          unsavedWorkingProjectId(retained, retainedDraft, workspaceProjectId),
          unsavedWorkingProject(retained, retainedDraft, workspaceProjectId, current.workingProject),
          answered.project_id,
        ));
      } catch (error) {
        if (requestId !== null) clearActiveGeneration(requestId, operationEpoch);
        if (disposed || operationEpoch !== epoch) return current;
        const failedConversationProjectId = current.conversationProjectId
          ?? retainedAnswer?.project_id
          ?? targetProjectId;
        return publish(snapshot(
          'answer_failed',
          retained,
          retainedDraft,
          retainedPreview,
          sanitizeTrustedBuilderGenerationDiagnostic(error),
          retainedAnswer,
          null,
          false,
          unsavedWorkingProjectId(retained, retainedDraft, workspaceProjectId),
          unsavedWorkingProject(retained, retainedDraft, workspaceProjectId, current.workingProject),
          failedConversationProjectId,
        ));
      }
    });
  }

  async function submit(instruction: string): Promise<BuilderProjectControllerSnapshot> {
    if (
      disposed
      || current.busy
      || current.inspectedRevision !== null
      || ![
        'new',
        'ready',
        'draft_ready',
        'answer_failed',
        'submit_failed',
        'generation_failed',
        'preview_unavailable',
      ].includes(current.status)
    ) return current;
    const retained = current.savedProject;
    const retainedDraft = current.draft;
    const retainedPreview = current.preview;
    retryableGeneration = null;
    return run(async (operationEpoch) => {
      let targetProjectId = retainedDraft?.project_id ?? retained?.target.project_id ?? current.workingProjectId;
      if (targetProjectId === null) {
        targetProjectId = await bindProjectForBuild(
          'submit_failed',
          retained,
          retainedPreview,
        );
      }
      if (targetProjectId === null) return current;
      const before = withoutRetryableGeneration(current);
      publish(snapshot(
        'submitting',
        retained,
        retainedDraft,
        retainedPreview,
        null,
        null,
        null,
        false,
        unsavedWorkingProjectId(retained, retainedDraft, targetProjectId),
        unsavedWorkingProject(retained, retainedDraft, targetProjectId, current.workingProject),
      ));
      let requestId: string | null = null;
      let request: BuilderGenerationRequest | null = null;
      try {
        request = await createBuilderGenerationRequest(
          instruction,
          targetProjectId,
        );
        requestId = request.request_digest;
        activeGeneration = Object.freeze({
          before,
          projectId: targetProjectId,
          requestId,
        });
        const result = retainedDraft === null
          ? await dependencies.generator.submit(request)
          : await dependencies.generator.continueDraft({
            draft_id: retainedDraft.draft_id,
            instruction: request.instruction,
          });
        if (isExplanationResult(result)) {
          const answered = await sanitizeBuilderGenerationAnswer(result, request);
          clearActiveGeneration(request.request_digest, operationEpoch);
          if (disposed || operationEpoch !== epoch) return current;
          return publish(snapshot(
            retainedDraft === null
              ? settledStatus(retained, retainedPreview, targetProjectId)
              : retainedPreview === null ? 'preview_unavailable' : 'draft_ready',
            retained,
            retainedDraft,
            retainedPreview,
            null,
            answered,
            null,
            false,
            unsavedWorkingProjectId(retained, retainedDraft, targetProjectId),
            unsavedWorkingProject(retained, retainedDraft, targetProjectId, current.workingProject),
          ));
        }
        const draft = await sanitizeBuilderGenerationDraft(result, request);
        clearActiveGeneration(request.request_digest, operationEpoch);
        if (
          !draftMatchesSavedBase(draft, retained)
          || (retainedDraft !== null && draft.project_id !== retainedDraft.project_id)
        ) throw new Error();
        if (disposed || operationEpoch !== epoch) return current;
        return withPreview('draft_ready', retained, draft, operationEpoch);
      } catch (error) {
        if (requestId !== null) clearActiveGeneration(requestId, operationEpoch);
        if (disposed || operationEpoch !== epoch) return current;
        return publish(snapshot(
          'submit_failed',
          retained,
          retainedDraft,
          retainedPreview,
          submitFailureDiagnostic(error, retainedDraft === null ? request : null),
          null,
          null,
          retryableGeneration !== null,
          unsavedWorkingProjectId(retained, retainedDraft, targetProjectId),
          unsavedWorkingProject(retained, retainedDraft, targetProjectId, current.workingProject),
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
    return run(async (operationEpoch) => {
      let targetProjectId = retained?.target.project_id ?? current.workingProjectId;
      if (targetProjectId === null) {
        targetProjectId = await bindProjectForBuild(
          'generation_failed',
          retained,
          current.preview,
        );
      }
      if (targetProjectId === null) return current;
      const before = withoutRetryableGeneration(current);
      publish(snapshot(
        'generating',
        retained,
        null,
        current.preview,
        null,
        null,
        null,
        false,
        unsavedWorkingProjectId(retained, null, targetProjectId),
        unsavedWorkingProject(retained, null, targetProjectId, current.workingProject),
      ));
      let requestId: string | null = null;
      let request: BuilderGenerationRequest | null = null;
      try {
        request = await createBuilderGenerationRequest(
          instruction,
          targetProjectId,
        );
        requestId = request.request_digest;
        activeGeneration = Object.freeze({
          before,
          projectId: targetProjectId,
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
          unsavedWorkingProjectId(retained, null, targetProjectId),
          unsavedWorkingProject(retained, null, targetProjectId, current.workingProject),
        ));
      }
    });
  }

  async function proposePlan(instruction: string): Promise<BuilderProjectControllerSnapshot> {
    if (
      disposed
      || current.busy
      || current.draft !== null
      || current.inspectedRevision !== null
      || (current.savedProject === null && current.workingProjectId === null)
      || !['ready', 'preview_unavailable'].includes(current.status)
    ) return current;
    const retained = current.savedProject;
    const targetProjectId = retained?.target.project_id ?? current.workingProjectId;
    if (targetProjectId === null) return current;
    const retainedPreview = current.preview;
    const retainedWorkingProject = unsavedWorkingProject(retained, null, targetProjectId, current.workingProject);
    const retainedWorkingProjectId = unsavedWorkingProjectId(retained, null, targetProjectId);
    retryableGeneration = null;
    const before = withoutRetryableGeneration(current);
    return run(async (operationEpoch) => {
      publish(snapshot(
        'submitting',
        retained,
        null,
        retainedPreview,
        null,
        null,
        null,
        false,
        retainedWorkingProjectId,
        retainedWorkingProject,
      ));
      let requestId: string | null = null;
      let request: Awaited<ReturnType<typeof createBuilderGenerationRequest>> | null = null;
      try {
        request = await createBuilderGenerationRequest(instruction, targetProjectId);
        requestId = request.request_digest;
        activeGeneration = Object.freeze({
          before,
          projectId: targetProjectId,
          requestId,
        });
        await sanitizeBuilderGenerationPlan(
          await dependencies.generator.proposePlan(request),
          request,
        );
        clearActiveGeneration(request.request_digest, operationEpoch);
        if (disposed || operationEpoch !== epoch) return current;
        return publish(snapshot(
          settledStatus(retained, retainedPreview, targetProjectId),
          retained,
          null,
          retainedPreview,
          null,
          null,
          null,
          false,
          retainedWorkingProjectId,
          retainedWorkingProject,
        ));
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
          retainedWorkingProjectId,
          retainedWorkingProject,
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
      || (current.status !== 'generation_failed' && current.status !== 'submit_failed')
      || retryableGeneration === null
    ) return current;
    const retained = current.savedProject;
    const retryable = retryableGeneration;
    if (retryable.kind === 'submit') {
      if (current.status !== 'submit_failed') return current;
      const targetProjectId = retained?.target.project_id ?? current.workingProjectId;
      if (targetProjectId === null) {
        retryableGeneration = null;
        activeGeneration = null;
        return publish(buildWorkspaceRequiredSnapshot(
          'submit_failed',
          retained,
          current.preview,
          current.answer,
          current.conversationProjectId,
        ));
      }
      const retainedPreview = current.preview;
      const request = retryable.request;
      if (targetProjectId !== request.existing_project_id) return current;
      const before = current;
      return run(async (operationEpoch) => {
        publish(snapshot(
          'submitting',
          retained,
          null,
          retainedPreview,
          null,
          null,
          null,
          false,
          unsavedWorkingProjectId(retained, null, targetProjectId),
          unsavedWorkingProject(retained, null, targetProjectId, current.workingProject),
        ));
        activeGeneration = Object.freeze({
          before,
          projectId: targetProjectId,
          requestId: request.request_digest,
        });
        try {
          const result = await dependencies.generator.submit(request);
          if (isExplanationResult(result)) {
            const answered = await sanitizeBuilderGenerationAnswer(result, request);
            clearActiveGeneration(request.request_digest, operationEpoch);
            if (disposed || operationEpoch !== epoch) return current;
            retryableGeneration = null;
            return publish(snapshot(
              settledStatus(retained, retainedPreview, targetProjectId),
              retained,
              null,
              retainedPreview,
              null,
              answered,
              null,
              false,
              unsavedWorkingProjectId(retained, null, targetProjectId),
              unsavedWorkingProject(retained, null, targetProjectId, current.workingProject),
            ));
          }
          const draft = await sanitizeBuilderGenerationDraft(result, request);
          clearActiveGeneration(request.request_digest, operationEpoch);
          if (!draftMatchesSavedBase(draft, retained)) throw new Error();
          if (disposed || operationEpoch !== epoch) return current;
          retryableGeneration = null;
          return withPreview('draft_ready', retained, draft, operationEpoch);
        } catch (error) {
          clearActiveGeneration(request.request_digest, operationEpoch);
          if (disposed || operationEpoch !== epoch) return current;
          return publish(snapshot(
            'submit_failed',
            retained,
            null,
            retainedPreview,
            submitFailureDiagnostic(error, request),
            null,
            null,
            retryableGeneration !== null,
            unsavedWorkingProjectId(retained, null, targetProjectId),
            unsavedWorkingProject(retained, null, targetProjectId, current.workingProject),
          ));
        }
      });
    }
    if (retryable.kind === 'approved_plan') {
      if (current.status !== 'generation_failed') return current;
      if (
        retained === null
        || retained.target.project_id !== retryable.request.project_id
        || retained.target.conversation_id !== retryable.request.conversation_id
      ) return current;
      const before = current;
      return run(async (operationEpoch) => {
        publish(snapshot(
          'generating',
          retained,
          null,
          current.preview,
          null,
          null,
          null,
          false,
        ));
        activeGeneration = Object.freeze({
          before,
          projectId: retryable.request.project_id,
          requestId: null,
        });
        try {
          const draft = await sanitizeBuilderApprovedPlanGenerationDraft(
            await dependencies.generator.generateApprovedPlan(retryable.request),
            retryable.request,
          );
          clearProjectGeneration(retryable.request.project_id, operationEpoch);
          if (!draftMatchesSavedBase(draft, retained)) throw new Error();
          if (disposed || operationEpoch !== epoch) return current;
          retryableGeneration = null;
          return withPreview('draft_ready', retained, draft, operationEpoch);
        } catch (error) {
          clearProjectGeneration(retryable.request.project_id, operationEpoch);
          if (disposed || operationEpoch !== epoch) return current;
          return publish(snapshot(
            'generation_failed',
            retained,
            null,
            current.preview,
            approvedPlanGenerationFailureDiagnostic(error, retryable.request),
            null,
            null,
            retryableGeneration !== null,
          ));
        }
      });
    }
    if (current.status !== 'generation_failed') return current;
    const targetProjectId = retained?.target.project_id ?? current.workingProjectId;
    if (targetProjectId === null) {
      retryableGeneration = null;
      activeGeneration = null;
      return publish(buildWorkspaceRequiredSnapshot(
        'generation_failed',
        retained,
        current.preview,
        current.answer,
        current.conversationProjectId,
      ));
    }
    const before = current;
    const request = retryable.request;
    if (targetProjectId !== request.existing_project_id) return current;
    return run(async (operationEpoch) => {
      publish(snapshot(
        'generating',
        retained,
        null,
        current.preview,
        null,
        null,
        null,
        false,
        unsavedWorkingProjectId(retained, null, targetProjectId),
        unsavedWorkingProject(retained, null, targetProjectId, current.workingProject),
      ));
      activeGeneration = Object.freeze({
        before,
        projectId: targetProjectId,
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
          unsavedWorkingProjectId(retained, null, targetProjectId),
          unsavedWorkingProject(retained, null, targetProjectId, current.workingProject),
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
        retryableGeneration = null;
        return withPreview('draft_ready', retained, draft, operationEpoch);
      } catch (error) {
        clearProjectGeneration(request.project_id, operationEpoch);
        if (disposed || operationEpoch !== epoch) return current;
        return publish(snapshot(
          'generation_failed',
          retained,
          null,
          current.preview,
          approvedPlanGenerationFailureDiagnostic(error, request),
          null,
          null,
          retryableGeneration !== null,
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
      publish(snapshot(
        'restoring',
        retained,
        null,
        current.preview,
        null,
        null,
        null,
        false,
        current.workingProjectId,
        current.workingProject,
      ));
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

  async function restoreRevisionAsDraft(
    projectId: string,
    revisionReceiptDigest: string,
  ): Promise<BuilderProjectControllerSnapshot> {
    const retained = current.savedProject;
    if (
      disposed
      || current.busy
      || current.draft !== null
      || retained === null
      || !PROJECT_ID_PATTERN.test(projectId)
      || !DIGEST_PATTERN.test(revisionReceiptDigest)
      || retained.target.project_id !== projectId
      || retained.target.revision_receipt_digest === revisionReceiptDigest
      || !['ready', 'generation_failed', 'preview_unavailable'].includes(current.status)
    ) return current;
    const beforeRestore = current;
    return run(async (operationEpoch) => {
      publish(snapshot(
        'restoring',
        retained,
        null,
        current.preview,
        null,
        null,
        current.inspectedRevision,
        false,
        current.workingProjectId,
        current.workingProject,
      ));
      try {
        const draft = await sanitizeBuilderRevisionRestoreGenerationDraft(
          await dependencies.generator.restoreRevisionAsDraft({
            project_id: projectId,
            revision_receipt_digest: revisionReceiptDigest,
          }),
          projectId,
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

  async function steer(message: string): Promise<boolean> {
    const target = activeGeneration;
    const text = message.trim();
    if (
      disposed
      || target === null
      || target.requestId === null
      || text.length === 0
      || !['answering', 'generating', 'submitting'].includes(current.status)
    ) return false;
    try {
      return sanitizeSteerResult(
        await dependencies.generator.steer({ request_id: target.requestId, message: text }),
        target.requestId,
      );
    } catch {
      return false;
    }
  }

  async function rejectDraft(): Promise<BuilderProjectControllerSnapshot> {
    if (disposed || current.busy || current.draft === null) return current;
    const retained = current.savedProject;
    const draft = current.draft;
    return run(async (operationEpoch) => {
      publish(snapshot(
        'rejecting',
        retained,
        draft,
        current.preview,
        null,
        null,
        null,
        false,
        unsavedWorkingProjectId(retained, draft, current.workingProjectId),
        unsavedWorkingProject(retained, draft, current.workingProjectId, current.workingProject),
      ));
      try {
        sanitizeRejectResult(
          await dependencies.generator.rejectDraft({ draft_id: draft.draft_id }),
          draft,
        );
        if (disposed || operationEpoch !== epoch) return current;
        if (retained === null) {
          return publish(snapshot(
            'ready',
            null,
            null,
            null,
            null,
            null,
            null,
            false,
            draft.project_id,
            current.workingProject?.project_id === draft.project_id ? current.workingProject : null,
          ));
        }
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
      publish(snapshot(
        'saving',
        retained,
        draft,
        current.preview,
        null,
        null,
        null,
        false,
        unsavedWorkingProjectId(retained, draft, current.workingProjectId),
        unsavedWorkingProject(retained, draft, current.workingProjectId, current.workingProject),
      ));
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
        return publish(snapshot(
          'save_unknown',
          retained,
          draft,
          current.preview,
          'save_unknown',
          null,
          null,
          false,
          unsavedWorkingProjectId(retained, draft, current.workingProjectId),
          unsavedWorkingProject(retained, draft, current.workingProjectId, current.workingProject),
        ));
      }
      try {
        const saved = await sanitizeBuilderProjectReadSnapshot(
          await dependencies.workspace.loadCurrent({ project_id: draft.project_id }),
        );
        if (disposed || operationEpoch !== epoch) return current;
        if (!savedMatchesDraft(saved, draft, saveReceipt)) {
          return publish(snapshot(
            'conflict',
            retained,
            draft,
            current.preview,
            'conflict',
            null,
            null,
            false,
            unsavedWorkingProjectId(retained, draft, current.workingProjectId),
            unsavedWorkingProject(retained, draft, current.workingProjectId, current.workingProject),
          ));
        }
        return withPreview('ready', saved, null, operationEpoch);
      } catch {
        if (disposed || operationEpoch !== epoch) return current;
        return publish(snapshot(
          'save_unknown',
          retained,
          draft,
          current.preview,
          'save_unknown',
          null,
          null,
          false,
          unsavedWorkingProjectId(retained, draft, current.workingProjectId),
          unsavedWorkingProject(retained, draft, current.workingProjectId, current.workingProject),
        ));
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
    retainConversationProject,
    clearWorkspaceSelection,
    open,
    createLocalProject,
    submit,
    answer,
    proposePlan,
    generate,
    generateApprovedPlan,
    retryGenerate,
    restoreDraft,
    restoreRevisionAsDraft,
    inspectRevision,
    showCurrentRevision,
    rejectDraft,
    cancel,
    steer,
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
