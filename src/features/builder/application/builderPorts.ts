import type {
  BuilderApprovedPlanGenerationRequest,
  BuilderGenerationRequest,
} from './builderGeneration';

export type BuilderGenerationStartedEvent = Readonly<{
  event_version: 'builder-generation-started.v1';
  request_id: string;
  project_id: string;
}>;

export type BuilderGenerationOutputEvent = Readonly<{
  event_version: 'builder-generation-output.v1';
  request_id: string;
  project_id: string;
  conversation_id: string;
  turn_id: string;
  task_id: string | null;
  run_id: string;
  display_delta_text: string;
}>;

export type BuilderGenerationDiagnosticCode =
  | 'builder_generation_parent_unavailable'
  | 'builder_generation_provider_unavailable'
  | 'builder_generation_timeout'
  | 'builder_generation_provider_http_error'
  | 'builder_generation_structured_response_invalid'
  | 'builder_generation_failed';

export const BUILDER_GENERATION_DIAGNOSTIC_RETRYABILITY: Readonly<
  Record<BuilderGenerationDiagnosticCode, boolean>
> = Object.freeze({
  builder_generation_parent_unavailable: true,
  builder_generation_provider_unavailable: false,
  builder_generation_timeout: true,
  builder_generation_provider_http_error: true,
  builder_generation_structured_response_invalid: true,
  builder_generation_failed: true,
});

const DIAGNOSTIC_MESSAGES: Readonly<Record<BuilderGenerationDiagnosticCode, string>> = Object.freeze({
  builder_generation_parent_unavailable: 'The current project version is unavailable.',
  builder_generation_provider_unavailable: 'AI project generation is not configured.',
  builder_generation_timeout: 'AI project generation timed out.',
  builder_generation_provider_http_error: 'The AI service could not make this project.',
  builder_generation_structured_response_invalid: 'The generated project could not be prepared.',
  builder_generation_failed: 'The project draft could not be generated.',
});

const TRUSTED_DIAGNOSTICS = new WeakMap<object, BuilderGenerationDiagnosticCode>();

export class BuilderGenerationDiagnosticError extends Error {
  readonly code: BuilderGenerationDiagnosticCode;
  readonly retryable: boolean;

  constructor(code: BuilderGenerationDiagnosticCode = 'builder_generation_failed') {
    super(DIAGNOSTIC_MESSAGES[code]);
    this.name = 'BuilderDesktopCodeGeneratorPortError';
    this.code = code;
    this.retryable = BUILDER_GENERATION_DIAGNOSTIC_RETRYABILITY[code];
    this.stack = `${this.name}: ${this.message}`;
    TRUSTED_DIAGNOSTICS.set(this, code);
    Object.freeze(this);
  }
}

export function sanitizeTrustedBuilderGenerationDiagnostic(
  error: unknown,
): BuilderGenerationDiagnosticCode {
  return trustedBuilderGenerationDiagnosticCode(error) ?? 'builder_generation_failed';
}

export function trustedBuilderGenerationDiagnosticCode(
  error: unknown,
): BuilderGenerationDiagnosticCode | null {
  if ((typeof error !== 'object' && typeof error !== 'function') || error === null) {
    return null;
  }
  return TRUSTED_DIAGNOSTICS.get(error) ?? null;
}

export interface BuilderCodeGeneratorPort {
  submit(request: BuilderGenerationRequest): Promise<unknown>;
  generate(request: BuilderGenerationRequest): Promise<unknown>;
  generateApprovedPlan(request: BuilderApprovedPlanGenerationRequest): Promise<unknown>;
  proposePlan(request: BuilderGenerationRequest): Promise<unknown>;
  retry(request: BuilderGenerationRequest): Promise<unknown>;
  answer(request: BuilderGenerationRequest): Promise<unknown>;
  restoreDraft(request: Readonly<{ draft_id: string }>): Promise<unknown>;
  rejectDraft(request: Readonly<{ draft_id: string }>): Promise<unknown>;
  cancel(request: Readonly<{ request_id: string }>): Promise<unknown>;
  steer(request: Readonly<{ request_id: string; message: string }>): Promise<unknown>;
  subscribeStarted?(listener: (event: BuilderGenerationStartedEvent) => void): () => void;
  subscribeOutput?(listener: (event: BuilderGenerationOutputEvent) => void): () => void;
}

export interface BuilderProjectWorkspacePort {
  open(request: Readonly<{ project_id: string | null }>): Promise<unknown>;
  saveDraft(request: Readonly<{ draft_id: string }>): Promise<unknown>;
  loadCurrent(request: Readonly<{ project_id: string }>): Promise<unknown>;
  loadRevision(request: Readonly<{ project_id: string; revision_receipt_digest: string }>): Promise<unknown>;
  listCurrent(): Promise<unknown>;
  listHistory(request: Readonly<{ project_id: string; limit: number }>): Promise<unknown>;
}

export interface BuilderTaskStreamPort {
  read(request: Readonly<{ project_id: string }>): Promise<unknown>;
  subscribeChanged(listener: (event: BuilderTaskStreamChangedEvent) => void): () => void;
}

export type BuilderTaskStreamChangedEvent = Readonly<{
  event_version: 'builder-task-stream-changed.v1';
  project_id: string;
}>;

export type BuilderPlanReviewDecision = 'approved' | 'rejected';

export type BuilderPlanReviewRequest = Readonly<{
  project_id: string;
  conversation_id: string;
  turn_id: string;
  run_id: string;
  decision: BuilderPlanReviewDecision;
}>;

export type BuilderPlanReviewResult = Readonly<{
  result_version: 'builder-conversation-plan-review-result.v1';
  project_id: string;
  conversation_id: string;
  turn_id: string;
  run_id: string;
  decision: BuilderPlanReviewDecision;
  review_admission: 'sqlite_recorded_no_execution';
}>;

export interface BuilderPlanReviewPort {
  review(request: BuilderPlanReviewRequest): Promise<BuilderPlanReviewResult>;
}

export type BuilderPermissionAction =
  | 'context.read'
  | 'project.read'
  | 'project.edit'
  | 'secret.read'
  | 'filesystem.read'
  | 'filesystem.write'
  | 'network.request'
  | 'process.spawn'
  | 'publication.create'
  | 'permission.grant';

export type BuilderPermissionResourceKind =
  | 'artifact'
  | 'conversation'
  | 'filesystem'
  | 'network'
  | 'permission'
  | 'process'
  | 'project'
  | 'publication'
  | 'revision'
  | 'run'
  | 'secret'
  | 'task';

export type BuilderPermissionRequest = Readonly<{
  project_id: string;
  action: BuilderPermissionAction;
  resource_kind: BuilderPermissionResourceKind;
  resource_id: string;
}>;

export type BuilderPermissionDecision = Readonly<{
  action: BuilderPermissionAction;
  resource: Readonly<{
    resource_kind: BuilderPermissionResourceKind;
    project_id: string;
    resource_id: string;
  }>;
  evaluated_at_ms: number;
  decision: 'allowed' | 'denied';
  reason: 'matching_active_grant' | 'no_matching_active_grant';
  permission_id: string | null;
}>;

export interface BuilderPermissionPort {
  evaluate(request: BuilderPermissionRequest): Promise<BuilderPermissionDecision>;
}
