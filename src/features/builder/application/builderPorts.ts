import type {
  BuilderApprovedPlanGenerationRequest,
  BuilderGenerationTurnRequest,
  BuilderGenerationRequest,
  BuilderQueuedFollowupReference,
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

export type BuilderQueuedFollowupResult = Readonly<{
  request_id: string;
  queued: boolean;
  queued_followup: BuilderQueuedFollowupReference | null;
}>;

export type BuilderPlanSourceReadApprovalStatus = Readonly<{
  result_version: 'builder-plan-source-read-approval-status.v1';
  project_id: string;
  state: 'ready' | 'approval_required';
  file_count: number;
  approval_scope: 'current_project_plan_source_read';
  authority: 'main_selected_project_bounded_filesystem_read_v1';
}>;

export type BuilderPlanSourceReadApprovalResult = Readonly<{
  result_version: 'builder-plan-source-read-approval-result.v1';
  project_id: string;
  operation: 'approval_recorded' | 'already_approved';
  file_count: number;
  approval_scope: 'current_project_plan_source_read';
  authority: 'main_selected_project_bounded_filesystem_read_v1';
}>;

export type BuilderCurrentProjectWriteApprovalStatus = Readonly<{
  result_version: 'builder-current-project-write-approval-status.v1';
  project_id: string;
  state: 'ready' | 'approval_required';
  approval_scope: 'current_project_write';
  authority: 'main_selected_project_project_edit_v1';
}>;

export type BuilderCurrentProjectWriteApprovalResult = Readonly<{
  result_version: 'builder-current-project-write-approval-result.v1';
  project_id: string;
  operation: 'approval_recorded' | 'already_approved';
  approval_scope: 'current_project_write';
  authority: 'main_selected_project_project_edit_v1';
}>;

export type BuilderSemanticRouteClassification = Readonly<{
  result_version: 'builder-semantic-route-classification.v1';
  request_digest: string;
  route: 'answer' | 'clarify' | 'update_brief' | 'plan' | 'build';
  confidence: 'low' | 'medium' | 'high';
  needs_confirmation: boolean;
  reason_code:
    | 'asks_for_information'
    | 'asks_to_discuss_or_refine'
    | 'updates_working_direction'
    | 'requests_plan_or_proposal'
    | 'requests_source_change'
    | 'ambiguous_between_plan_and_build';
  matched_signal: 'semantic_route';
  authority: Readonly<{
    classifier: 'main_owned_provider_semantic_route_v1';
    context_scope: 'current_instruction_and_bounded_product_state';
    conversation_text: 'not_disclosed';
    working_brief_text: 'not_disclosed';
    source_read: 'not_performed';
    source_write: 'not_performed';
    tool_dispatch: false;
    command_execution: false;
    permission_grant: false;
    git_mutation: false;
    sqlite_write: false;
    save_admission: false;
  }>;
}>;

export type BuilderGenerationDiagnosticCode =
  | 'builder_generation_base_unavailable'
  | 'builder_generation_parent_unavailable'
  | 'builder_generation_project_workspace_required'
  | 'builder_generation_project_write_permission_required'
  | 'builder_generation_workspace_changed'
  | 'builder_generation_workspace_guard_denied'
  | 'builder_generation_workspace_guard_approval_required'
  | 'builder_generation_provider_unavailable'
  | 'builder_generation_timeout'
  | 'builder_generation_provider_http_error'
  | 'builder_generation_provider_transport_error'
  | 'builder_generation_structured_response_invalid'
  | 'builder_generation_static_preview_contract_rejected'
  | 'builder_generation_failed';

export const BUILDER_GENERATION_DIAGNOSTIC_RETRYABILITY: Readonly<
  Record<BuilderGenerationDiagnosticCode, boolean>
> = Object.freeze({
  builder_generation_base_unavailable: true,
  builder_generation_parent_unavailable: true,
  builder_generation_project_workspace_required: false,
  builder_generation_project_write_permission_required: false,
  builder_generation_workspace_changed: true,
  builder_generation_workspace_guard_denied: false,
  builder_generation_workspace_guard_approval_required: false,
  builder_generation_provider_unavailable: false,
  builder_generation_timeout: true,
  builder_generation_provider_http_error: true,
  builder_generation_provider_transport_error: true,
  builder_generation_structured_response_invalid: true,
  builder_generation_static_preview_contract_rejected: true,
  builder_generation_failed: true,
});

const DIAGNOSTIC_MESSAGES: Readonly<Record<BuilderGenerationDiagnosticCode, string>> = Object.freeze({
  builder_generation_base_unavailable: 'The current project source is unavailable.',
  builder_generation_parent_unavailable: 'The current project version is unavailable.',
  builder_generation_project_workspace_required: 'Choose or open a project folder before building.',
  builder_generation_project_write_permission_required: 'Allow current project changes before building.',
  builder_generation_workspace_changed: 'The project changed while AI was working. Review it and try again.',
  builder_generation_workspace_guard_denied: 'The proposed file changes were blocked to protect this project.',
  builder_generation_workspace_guard_approval_required: 'The proposed file changes need additional approval.',
  builder_generation_provider_unavailable: 'AI project generation is not configured.',
  builder_generation_timeout: 'AI project generation timed out.',
  builder_generation_provider_http_error: 'The AI service could not make this project.',
  builder_generation_provider_transport_error: 'The AI service could not be reached.',
  builder_generation_structured_response_invalid: 'The generated project could not be prepared.',
  builder_generation_static_preview_contract_rejected: 'The generated project needs browser preview support.',
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
  classifyIntent?(
    request: Readonly<{ instruction: string }>,
  ): Promise<BuilderSemanticRouteClassification>;
  submit(request: BuilderGenerationTurnRequest): Promise<unknown>;
  generate(request: BuilderGenerationRequest): Promise<unknown>;
  continueDraft(request: Readonly<{ draft_id: string; instruction: string }>): Promise<unknown>;
  generateApprovedPlan(request: BuilderApprovedPlanGenerationRequest): Promise<unknown>;
  proposePlan(request: BuilderGenerationRequest): Promise<unknown>;
  preparePlanSourceReadApproval(
    request: Readonly<{ project_id: string }>,
  ): Promise<BuilderPlanSourceReadApprovalStatus>;
  approvePlanSourceRead(
    request: Readonly<{ project_id: string }>,
  ): Promise<BuilderPlanSourceReadApprovalResult>;
  prepareCurrentProjectWriteApproval(
    request: Readonly<{ project_id: string }>,
  ): Promise<BuilderCurrentProjectWriteApprovalStatus>;
  approveCurrentProjectWrite(
    request: Readonly<{ project_id: string }>,
  ): Promise<BuilderCurrentProjectWriteApprovalResult>;
  retry(request: BuilderGenerationRequest): Promise<unknown>;
  answer(request: BuilderGenerationTurnRequest): Promise<unknown>;
  answerDraft(request: Readonly<{ draft_id: string; instruction: string }>): Promise<unknown>;
  restoreDraft(request: Readonly<{ draft_id: string }>): Promise<unknown>;
  restoreRevisionAsDraft(
    request: Readonly<{ project_id: string; revision_receipt_digest: string }>,
  ): Promise<unknown>;
  rejectDraft(request: Readonly<{ draft_id: string }>): Promise<unknown>;
  cancel(request: Readonly<{ request_id: string }>): Promise<unknown>;
  steer(request: Readonly<{ request_id: string; message: string }>): Promise<unknown>;
  queueFollowup(request: Readonly<{ request_id: string; message: string }>): Promise<unknown>;
  subscribeStarted?(listener: (event: BuilderGenerationStartedEvent) => void): () => void;
  subscribeOutput?(listener: (event: BuilderGenerationOutputEvent) => void): () => void;
}

export interface BuilderProjectWorkspacePort {
  open(request: Readonly<{ project_id: string | null }>): Promise<unknown>;
  openLocation(request: Readonly<{ project_id: string }>): Promise<unknown>;
  createLocalProject(request: Readonly<{ project_id: string | null; project_title: string }>): Promise<unknown>;
  saveDraft(request: Readonly<{ draft_id: string }>): Promise<unknown>;
  loadCurrent(request: Readonly<{ project_id: string }>): Promise<unknown>;
  loadRevision(request: Readonly<{ project_id: string; revision_receipt_digest: string }>): Promise<unknown>;
  listCurrent(): Promise<unknown>;
  listWorkspaces(): Promise<unknown>;
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

export type BuilderCheckRunCommandKind = 'lint' | 'typecheck' | 'test' | 'build';

export type BuilderCheckRunProfile = Readonly<{
  command_profile_id: string;
  command_kind: BuilderCheckRunCommandKind;
  command_display: string;
  requires_user_approval: true;
}>;

export type BuilderCheckRunStatusProjection = Readonly<{
  projection_version: 'builder-check-run-status-projection.v1';
  project_id: string;
  candidate_id: string;
  check_run_id: string;
  command_kind: BuilderCheckRunCommandKind;
  command_label: 'Lint' | 'Type check' | 'Tests' | 'Build';
  status: 'passed' | 'failed' | 'incomplete';
  label: 'Checked' | 'Check failed' | 'Check incomplete' | 'Check unavailable' | 'Check needs attention';
  summary: string;
  completed_at_ms: number;
  result_digest: string;
}>;

export type BuilderCheckRunAvailableResult = Readonly<{
  result_version: 'builder-check-run-current-draft-read-result.v1';
  service_version: 'builder-check-run-current-draft-service.v1';
  operation: 'current_draft_available_checks_read';
  status: 'ready' | 'no_checks';
  draft_id: string;
  project_id: string;
  candidate_id: string;
  available_checks: readonly BuilderCheckRunProfile[];
}>;

export type BuilderCheckRunCompletedResult = Readonly<{
  result_version: 'builder-check-run-current-draft-run-result.v1';
  service_version: 'builder-check-run-current-draft-service.v1';
  operation: 'current_draft_approved_check_completed';
  draft_id: string;
  project_id: string;
  candidate_id: string;
  check_run_status_projection: BuilderCheckRunStatusProjection;
}>;

export type BuilderCheckRunReadRequest = Readonly<{ draft_id: string }>;

export type BuilderCheckRunApproveRequest = Readonly<{
  draft_id: string;
  command_profile_id: string;
}>;

export type BuilderCheckRunSkippedResult = Readonly<{
  result_version: 'builder-check-skip-current-draft-public-result.v1';
  operation: 'current_draft_check_skipped';
  draft_id: string;
  project_id: string;
  candidate_id: string;
  status: 'skipped';
}>;

export interface BuilderCheckRunPort {
  readCurrentDraftAvailableChecks(request: BuilderCheckRunReadRequest): Promise<BuilderCheckRunAvailableResult>;
  approveAndRunCurrentDraftCheck(request: BuilderCheckRunApproveRequest): Promise<BuilderCheckRunCompletedResult>;
  skipCurrentDraftCheck(request: BuilderCheckRunReadRequest): Promise<BuilderCheckRunSkippedResult>;
}

export type BuilderLivePreviewStatusProjection = Readonly<{
  status_version: 'builder-live-preview-status-projection.v1';
  project_id: string;
  conversation_id: string;
  preview_kind: 'live_static_web';
  status:
    | 'idle'
    | 'unavailable'
    | 'starting'
    | 'ready'
    | 'reloading'
    | 'stopping'
    | 'stopped'
    | 'failed';
  can_start: boolean;
  can_reload: boolean;
  can_stop: boolean;
  message: string;
  unavailable_reason:
    | 'preview_source_resolver_not_connected'
    | 'no_current_draft_preview_source'
    | 'live_preview_runtime_unavailable'
    | null;
  updated_at_ms: number;
  authority: Readonly<{
    live_preview_authority: 'main_owned_live_preview_ipc_adapter_v1';
    renderer_authority: 'current_project_conversation_only';
    active_renderer_required: true;
    source_tree_from_renderer: 'not_accepted';
    source_read: 'main_owned_preview_source_resolver_or_not_performed';
    source_write: 'not_performed';
    provider_dispatch: false;
    tool_dispatch: false;
    command_execution: false;
    git_mutation: false;
    sqlite_write: false;
    permission_grant: false;
    revision_admission: false;
    save_admission: false;
    electron_view_attachment: 'main_only_not_exposed_to_renderer';
    preview_content_ipc: false;
    node_integration: false;
    preload: false;
  }>;
}>;

export type BuilderLivePreviewRequest = Readonly<{
  project_id: string;
  conversation_id: string;
}>;

export interface BuilderLivePreviewPort {
  requestCurrentDraftPreview(request: BuilderLivePreviewRequest): Promise<BuilderLivePreviewStatusProjection>;
  reloadCurrentPreview(request: BuilderLivePreviewRequest): Promise<BuilderLivePreviewStatusProjection>;
  stopCurrentPreview(request: BuilderLivePreviewRequest): Promise<BuilderLivePreviewStatusProjection>;
  readCurrentPreviewStatus(request: BuilderLivePreviewRequest): Promise<BuilderLivePreviewStatusProjection>;
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
