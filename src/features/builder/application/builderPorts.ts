import type {
  BuilderApprovedPlanGenerationRequest,
  BuilderGenerationTurnRequest,
  BuilderGenerationRequest,
  BuilderQueuedFollowupReference,
} from './builderGeneration';

export type BuilderGenerationStartedEvent = Readonly<{
  event_version: 'builder-generation-started.v1';
  request_id: string;
  project_id: string | null;
}>;

export type BuilderGenerationOutputEvent = Readonly<{
  event_version: 'builder-generation-output.v1';
  request_id: string;
  project_id: string | null;
  conversation_id: string;
  turn_id: string;
  task_id: string | null;
  run_id: string;
  display_delta_text: string;
}> | Readonly<{
  event_version: 'builder-generation-activity.v1';
  request_id: string;
  project_id: string | null;
  conversation_id: string;
  turn_id: string;
  task_id: string | null;
  run_id: string;
  activity_text: string;
}> | Readonly<{
  event_version: 'builder-generation-output-reset.v1';
  request_id: string;
  project_id: string | null;
  conversation_id: string;
  turn_id: string;
  task_id: string | null;
  run_id: string;
  retain_text_bytes: number;
}>;

export type BuilderCommandApprovalRequest = Readonly<{
  request_version: 'builder-controlled-command-approval-request.v1';
  approval_request_id: string;
  project_id: string;
  conversation_id: string;
  turn_id: string;
  task_id: string;
  run_id: string;
  command_profile_id: string;
  command_kind: 'lint' | 'typecheck' | 'test' | 'build';
  command_display: string;
  description: string;
  source_tree_digest: string;
  requested_at_ms: number;
  expires_at_ms: number;
  risk_notice: 'This project script may modify files or use the network.';
  decisions: readonly ['allow_once', 'deny'];
}>;

export type BuilderCommandOutputEvent = Readonly<{
  event_version: 'builder-controlled-command-output.v1';
  project_id: string;
  conversation_id: string;
  turn_id: string;
  task_id: string;
  run_id: string;
  command_profile_id: string;
  chunks: readonly Readonly<{ stream: 'stdout' | 'stderr'; text: string }>[];
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
  | 'builder_generation_project_busy'
  | 'builder_generation_workspace_changed'
  | 'builder_generation_workspace_guard_denied'
  | 'builder_generation_workspace_guard_approval_required'
  | 'builder_generation_provider_unavailable'
  | 'builder_generation_timeout'
  | 'builder_generation_runtime_stalled'
  | 'builder_generation_run_limit_reached'
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
  builder_generation_project_busy: true,
  builder_generation_workspace_changed: true,
  builder_generation_workspace_guard_denied: false,
  builder_generation_workspace_guard_approval_required: false,
  builder_generation_provider_unavailable: false,
  builder_generation_timeout: true,
  builder_generation_runtime_stalled: true,
  builder_generation_run_limit_reached: true,
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
  builder_generation_project_busy: 'Another task is changing this project. Open that task or try again later.',
  builder_generation_workspace_changed: 'The project changed while AI was working. Review it and try again.',
  builder_generation_workspace_guard_denied: 'The proposed file changes were blocked to protect this project.',
  builder_generation_workspace_guard_approval_required: 'The proposed file changes need additional approval.',
  builder_generation_provider_unavailable: 'AI project generation is not configured.',
  builder_generation_timeout: 'AI project generation timed out.',
  builder_generation_runtime_stalled: 'The coding runtime stopped making progress.',
  builder_generation_run_limit_reached: 'This coding run reached its safety limit.',
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
    request: Readonly<{ instruction: string; task_address_id: string | null }>,
  ): Promise<BuilderSemanticRouteClassification>;
  submit(request: BuilderGenerationTurnRequest): Promise<unknown>;
  generate(request: BuilderGenerationRequest): Promise<unknown>;
  continueDraft(request: Readonly<{
    draft_id: string;
    instruction: string;
    queued_followup?: BuilderQueuedFollowupReference | null;
  }>): Promise<unknown>;
  generateApprovedPlan(request: BuilderApprovedPlanGenerationRequest): Promise<unknown>;
  proposePlan(request: BuilderGenerationRequest): Promise<unknown>;
  preparePlanSourceReadApproval(
    request: Readonly<{ project_id: string; task_address_id?: string | null }>,
  ): Promise<BuilderPlanSourceReadApprovalStatus>;
  approvePlanSourceRead(
    request: Readonly<{ project_id: string; task_address_id?: string | null }>,
  ): Promise<BuilderPlanSourceReadApprovalResult>;
  prepareCurrentProjectWriteApproval(
    request: Readonly<{ project_id: string; task_address_id?: string | null }>,
  ): Promise<BuilderCurrentProjectWriteApprovalStatus>;
  approveCurrentProjectWrite(
    request: Readonly<{ project_id: string; task_address_id?: string | null }>,
  ): Promise<BuilderCurrentProjectWriteApprovalResult>;
  retry(request: BuilderGenerationRequest): Promise<unknown>;
  answer(request: BuilderGenerationTurnRequest): Promise<unknown>;
  answerPlan?(request: BuilderGenerationTurnRequest): Promise<unknown>;
  answerDraft(request: Readonly<{ draft_id: string; instruction: string }>): Promise<unknown>;
  restoreDraft(request: Readonly<{ draft_id: string }>): Promise<unknown>;
  restoreRevisionAsDraft(
    request: Readonly<{ project_id: string; revision_receipt_digest: string }>,
  ): Promise<unknown>;
  restorePreviousCheckpointAsDraft?(request: Readonly<{ draft_id: string }>): Promise<unknown>;
  rejectDraft(request: Readonly<{ draft_id: string }>): Promise<unknown>;
  cancel(request: Readonly<{ request_id: string }>): Promise<unknown>;
  steer(request: Readonly<{ request_id: string; message: string }>): Promise<unknown>;
  queueFollowup(request: Readonly<{ request_id: string; message: string }>): Promise<unknown>;
  subscribeStarted?(listener: (event: BuilderGenerationStartedEvent) => void): () => void;
  subscribeOutput?(listener: (event: BuilderGenerationOutputEvent) => void): () => void;
  decideCommandApproval?(request: Readonly<{
    run_id: string;
    approval_request_id: string;
    decision: 'allow_once' | 'deny';
  }>): Promise<void>;
  subscribeCommandApproval?(listener: (event: BuilderCommandApprovalRequest) => void): () => void;
  subscribeCommandOutput?(listener: (event: BuilderCommandOutputEvent) => void): () => void;
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
  read(request:
    | Readonly<{ agent_id: string }>
    | Readonly<{ project_id: string; task_address_id: string }>): Promise<unknown>;
  subscribeChanged(listener: (event: BuilderTaskStreamChangedEvent) => void): () => void;
}

export type BuilderTaskStreamChangedEvent = Readonly<{
  event_version: 'builder-task-stream-changed.v1';
  project_id: string | null;
}> | Readonly<{
  event_version: 'builder-task-stream-changed.v1';
  agent_id: string;
}> | Readonly<{
  event_version: 'builder-task-stream-changed.v2';
  project_id: string;
  change_kind: 'live_only' | 'runtime_append' | 'durable_append';
  cursor: number;
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
  environment_reason:
    | 'none'
    | 'dependency_workspace_missing'
    | 'install_approval_required'
    | 'install_denied'
    | 'dependency_preparation_failed'
    | 'dependency_preparation_timed_out'
    | 'package_manager_unavailable'
    | 'host_toolchain_missing'
    | 'environment_unknown';
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

export type BuilderCheckRunDependencyPreparationDecision = 'allow_once' | 'deny';

export type BuilderCheckRunDependencyPreparationRequest = Readonly<{
  draft_id: string;
  command_profile_id: string;
  decision: BuilderCheckRunDependencyPreparationDecision;
}>;

export type BuilderCheckRunEnvironmentDiagnosis = Readonly<{
  diagnosis_version: 'builder-environment-readiness-diagnosis.v1';
  diagnosis_id: string;
  project_id: string;
  candidate_id: string;
  source_tree_digest: string;
  command_profile_id: string;
  command_kind: BuilderCheckRunCommandKind;
  command_display: string;
  package_manager: 'npm' | 'pnpm' | 'yarn' | 'bun';
  package_manifest: 'absent' | 'present' | 'unreadable';
  dependency_manifest: 'absent' | 'present' | 'unreadable';
  lockfile: 'none' | 'package-lock.json' | 'pnpm-lock.yaml' | 'yarn.lock' | 'bun.lock' | 'bun.lockb';
  project_dependency_state:
    | 'not_applicable'
    | 'not_admitted'
    | 'unknown'
    | 'install_present'
    | 'install_missing'
    | 'unavailable';
  check_workspace_dependency_state:
    | 'not_applicable'
    | 'not_materialized'
    | 'install_present'
    | 'install_missing'
    | 'unavailable';
  host_toolchain_state: 'not_checked' | 'visible' | 'missing' | 'not_admitted';
  host_node_version: string | null;
  host_package_manager_version: string | null;
  install_permission: 'not_requested' | 'required' | 'denied' | 'approved_once';
  dependency_strategy:
    | 'no_execution_needed'
    | 'can_run_without_install'
    | 'needs_host_toolchain_admission'
    | 'needs_install_approval'
    | 'needs_prepared_dependency_workspace'
    | 'blocked_by_install_denial'
    | 'unknown';
  readiness_state:
    | 'ready'
    | 'host_toolchain_missing'
    | 'dependencies_not_prepared'
    | 'install_approval_required'
    | 'install_denied'
    | 'unknown';
  primary_action:
    | 'run_check'
    | 'prepare_once'
    | 'show_missing_toolchain'
    | 'show_diagnostics'
    | 'none';
  safe_summary: string;
  diagnosed_at_ms: number;
  diagnosis_digest: string;
}>;

export type BuilderCheckRunEnvironmentDiagnosisResult = Readonly<{
  result_version: 'builder-check-run-current-draft-environment-diagnosis-result.v1';
  service_version: 'builder-check-run-current-draft-service.v1';
  operation: 'current_draft_check_environment_diagnosed';
  draft_id: string;
  project_id: string;
  candidate_id: string;
  environment_diagnosis: BuilderCheckRunEnvironmentDiagnosis;
}>;

export type BuilderProjectEnvironmentToolchainState = Readonly<{
  state: 'visible' | 'missing' | 'unavailable';
  version: string | null;
}>;

export type BuilderProjectEnvironmentDiagnosis = Readonly<{
  diagnosis_version: 'builder-project-environment-diagnosis.v1';
  diagnosis_id: string;
  project_id: string;
  source_tree_digest: string;
  package_manager: 'npm' | 'pnpm' | 'yarn' | 'bun' | 'none';
  package_manifest: 'absent' | 'present' | 'unreadable';
  dependency_manifest: 'absent' | 'present' | 'unreadable';
  lockfile: 'none' | 'package-lock.json' | 'pnpm-lock.yaml' | 'yarn.lock' | 'bun.lock' | 'bun.lockb';
  project_dependency_state:
    | 'not_applicable'
    | 'not_admitted'
    | 'install_present'
    | 'install_missing'
    | 'unavailable';
  toolchains: Readonly<{
    node: BuilderProjectEnvironmentToolchainState;
    npm: BuilderProjectEnvironmentToolchainState;
    pnpm: BuilderProjectEnvironmentToolchainState;
    yarn: BuilderProjectEnvironmentToolchainState;
    git: BuilderProjectEnvironmentToolchainState;
  }>;
  readiness_state:
    | 'ready'
    | 'host_toolchain_missing'
    | 'project_dependencies_missing'
    | 'unknown';
  primary_action:
    | 'none'
    | 'show_missing_toolchain'
    | 'show_project_dependency_setup'
    | 'show_diagnostics';
  safe_summary: string;
  diagnosed_at_ms: number;
  diagnosis_digest: string;
}>;

export type BuilderProjectEnvironmentDiagnosisResult = Readonly<{
  result_version: 'builder-project-environment-diagnosis-result.v1';
  service_version: 'builder-project-environment-diagnosis-service.v1';
  operation: 'project_environment_diagnosed';
  project_id: string;
  environment_diagnosis: BuilderProjectEnvironmentDiagnosis;
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
  diagnoseCurrentDraftCheckEnvironment(
    request: BuilderCheckRunApproveRequest,
  ): Promise<BuilderCheckRunEnvironmentDiagnosisResult>;
  diagnoseProjectEnvironment(
    request: Readonly<{ project_id: string }>,
  ): Promise<BuilderProjectEnvironmentDiagnosisResult>;
  approveAndRunCurrentDraftCheck(request: BuilderCheckRunApproveRequest): Promise<BuilderCheckRunCompletedResult>;
  decideCurrentDraftDependencyPreparation(
    request: BuilderCheckRunDependencyPreparationRequest,
  ): Promise<BuilderCheckRunCompletedResult>;
  skipCurrentDraftCheck(request: BuilderCheckRunReadRequest): Promise<BuilderCheckRunSkippedResult>;
}

export interface BuilderAgentProjectTreePort {
  read(request: Readonly<{ agent_id: string }>): Promise<unknown>;
  renameProject(request: Readonly<{
    agent_id: string;
    project_id: string;
    title: string;
  }>): Promise<unknown>;
  archiveProject(request: Readonly<{
    agent_id: string;
    project_id: string;
  }>): Promise<unknown>;
  renameTask(request: Readonly<{
    agent_id: string;
    project_id: string;
    task_address_id: string;
    title: string;
  }>): Promise<unknown>;
  archiveTask(request: Readonly<{
    agent_id: string;
    project_id: string;
    task_address_id: string;
  }>): Promise<unknown>;
}

export type BuilderWorkbenchChangedEvent = Readonly<{
  event_version: 'builder-agent-workbench-changed.v1';
  agent_id: string;
}>;

export type BuilderWorkbenchMessageStateOperation =
  | 'mark_read'
  | 'acknowledge'
  | 'archive'
  | 'unarchive'
  | 'save'
  | 'unsave';

export type BuilderWorkbenchTaskProposalOutcome =
  | 'discuss'
  | 'plan'
  | 'build'
  | 'review'
  | 'research'
  | 'monitor';

export type BuilderWorkbenchTaskProposalDecision = 'approve_existing_project' | 'reject';

export interface BuilderAgentWorkbenchPort {
  read(request: Readonly<{
    agent_id: string;
    after_cursor: string | null;
    limit: number;
  }>): Promise<unknown>;
  updateMessageState(request: Readonly<{
    agent_id: string;
    message_id: string;
    operation: BuilderWorkbenchMessageStateOperation;
  }>): Promise<unknown>;
  createTaskProposal(request: Readonly<{
    request_id: string;
    agent_id: string;
    objective: string;
    requested_outcome: BuilderWorkbenchTaskProposalOutcome;
    execution_mode: 'foreground' | 'parallel';
    reason: string;
  }>): Promise<unknown>;
  decideTaskProposal(request: Readonly<{
    agent_id: string;
    proposal_id: string;
    operation: BuilderWorkbenchTaskProposalDecision;
    project_id: string | null;
  }>): Promise<unknown>;
  controlTask(request: Readonly<{
    agent_id: string;
    project_id: string;
    task_address_id: string;
    operation: 'cancel_task';
  }>): Promise<unknown>;
  subscribeChanged(listener: (event: BuilderWorkbenchChangedEvent) => void): () => void;
}

export type BuilderLivePreviewStatusProjection = Readonly<{
  status_version: 'builder-live-preview-status-projection.v1';
  project_id: string;
  conversation_id: string;
  preview_kind: 'live_static_web' | 'live_dev_server_web';
  entry_url: string | null;
  status:
    | 'idle'
    | 'approval_required'
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
  blocked_request_count: number;
  navigation_block_count: number;
  network_block_count: number;
  permission_block_count: number;
  download_block_count: number;
  window_open_block_count: number;
  message: string;
  dev_server_approval: Readonly<{
    request_version: 'builder-live-preview-dev-server-approval-request.v1';
    approval_request_id: string;
    project_id: string;
    conversation_id: string;
    command_display: string;
    source_tree_digest: string;
    risk_notice: 'This project script may modify files or use the network.';
    requested_at_ms: number;
    expires_at_ms: number;
    decisions: readonly ['allow_once', 'deny'];
  }> | null;
  unavailable_reason:
    | 'preview_source_resolver_not_connected'
    | 'no_current_draft_preview_source'
    | 'live_preview_runtime_unavailable'
    | 'live_preview_static_server_unavailable'
    | 'live_preview_view_attachment_failed'
    | 'live_preview_dev_server_unavailable'
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
    command_execution: boolean;
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

export type BuilderLivePreviewViewBounds = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
}>;

export type BuilderLivePreviewLayoutRequest = BuilderLivePreviewRequest & Readonly<{
  view_bounds: BuilderLivePreviewViewBounds | null;
}>;

export interface BuilderLivePreviewPort {
  requestCurrentDraftPreview(request: BuilderLivePreviewRequest): Promise<BuilderLivePreviewStatusProjection>;
  reloadCurrentPreview(request: BuilderLivePreviewRequest): Promise<BuilderLivePreviewStatusProjection>;
  stopCurrentPreview(request: BuilderLivePreviewRequest): Promise<BuilderLivePreviewStatusProjection>;
  readCurrentPreviewStatus(request: BuilderLivePreviewRequest): Promise<BuilderLivePreviewStatusProjection>;
  updateCurrentPreviewLayout(request: BuilderLivePreviewLayoutRequest): Promise<BuilderLivePreviewStatusProjection>;
  decideDevServerApproval(request: BuilderLivePreviewRequest & Readonly<{
    approval_request_id: string;
    decision: 'allow_once' | 'deny';
  }>): Promise<BuilderLivePreviewStatusProjection>;
}

export type BuilderUserWebStatusProjection = Readonly<{
  status_version: 'builder-user-web-status.v1';
  status: 'idle' | 'loading' | 'ready' | 'failed' | 'stopped';
  current_url: string | null;
  can_go_back: boolean;
  can_go_forward: boolean;
  can_reload: boolean;
  can_stop: boolean;
  navigation_block_count: number;
  permission_block_count: number;
  download_block_count: number;
  window_open_block_count: number;
  message: string;
  updated_at_ms: number;
  authority: Readonly<{
    user_web_authority: 'builder_main_user_web_v1';
    renderer_authority: 'explicit_navigation_and_layout_only';
    provider_authority: 'none';
    provider_observation: false;
    command_execution: false;
    dependency_installation: false;
    project_write: false;
    downloads: 'blocked_pending_separate_admission';
    permissions: 'denied';
    popup_windows: 'blocked';
    partition_visibility: 'main_private';
  }>;
}>;

export interface BuilderUserWebPort {
  navigate(request: Readonly<{ url: string }>): Promise<BuilderUserWebStatusProjection>;
  goBack(): Promise<BuilderUserWebStatusProjection>;
  goForward(): Promise<BuilderUserWebStatusProjection>;
  reload(): Promise<BuilderUserWebStatusProjection>;
  stop(): Promise<BuilderUserWebStatusProjection>;
  readStatus(): Promise<BuilderUserWebStatusProjection>;
  updateLayout(request: Readonly<{
    view_bounds: BuilderLivePreviewViewBounds | null;
  }>): Promise<BuilderUserWebStatusProjection>;
}

export type BuilderAgentTestBrowserLayoutResult = Readonly<{
  result_version: 'builder-agent-test-browser-layout-result.v1';
  owner_run_id: string;
  operation: 'layout_updated' | 'not_active';
  visible: boolean;
  applied_bounds: BuilderLivePreviewViewBounds | null;
}>;

export interface BuilderAgentTestBrowserPort {
  subscribeLifecycle(
    listener: (event: BuilderAgentTestBrowserLifecycleEvent) => void,
  ): () => void;
  updateLayout(request: Readonly<{
    owner_run_id: string;
    view_bounds: BuilderLivePreviewViewBounds | null;
  }>): Promise<BuilderAgentTestBrowserLayoutResult>;
  stop(request: Readonly<{ owner_run_id: string }>): Promise<Readonly<{
    closed: boolean;
    owner_run_id: string;
  }>>;
}

export type BuilderAgentTestBrowserLifecycleEvent = Readonly<{
  event_version: 'builder-agent-test-browser-lifecycle-event.v1';
  owner_run_id: string;
  session_id: string;
  lifecycle: 'opened' | 'closed';
}>;

export type BuilderSideWorkspaceFileRef = Readonly<{
  file_ref_version: 'builder-side-workspace-file-ref.v1';
  source_kind: 'current_draft' | 'saved_revision' | 'inspected_revision' | 'runtime_snapshot';
  source_tree_digest: string;
  path: string;
  content_digest: string;
}>;

export type BuilderSideWorkspaceFileAuthority = Readonly<{
  file_projection_authority: 'main_owned_side_workspace_file_projection_v1';
  renderer_source_tree: 'not_accepted';
  renderer_path_authority: 'main_issued_file_ref_only';
  source_read: 'main_owned_verified_source_tree_only';
  source_write: 'not_performed';
  git_write: 'not_performed';
  sqlite_write: 'not_performed';
  provider_dispatch: false;
  tool_dispatch: false;
  command_execution: false;
  electron_view_attachment: false;
  ipc_registration: false;
  revision_admission: false;
  save_admission: false;
  permission_grant: false;
}>;

export type BuilderSideWorkspaceFileTreeEntry = Readonly<
  | {
    entry_kind: 'directory';
    path: string;
    name: string;
    parent_path: string | null;
    depth: number;
    child_count: number;
  }
  | {
    entry_kind: 'text_file';
    path: string;
    name: string;
    parent_path: string | null;
    depth: number;
    content_digest: string;
    file_ref: BuilderSideWorkspaceFileRef;
  }
>;

export type BuilderSideWorkspaceFileTreeProjection = Readonly<{
  projection_version: 'builder-side-workspace-file-tree.v1';
  project_id: string;
  conversation_id: string;
  source_kind: 'current_draft' | 'saved_revision' | 'inspected_revision' | 'runtime_snapshot';
  root_label: string;
  source_tree_digest: string;
  entries: readonly BuilderSideWorkspaceFileTreeEntry[];
  selected_file_ref: BuilderSideWorkspaceFileRef | null;
  source_ref: Readonly<Record<string, unknown>>;
  authority: BuilderSideWorkspaceFileAuthority;
}>;

export type BuilderSideWorkspaceFileContentProjection = Readonly<{
  projection_version: 'builder-side-workspace-file-content.v1';
  project_id: string;
  conversation_id: string;
  source_kind: 'current_draft' | 'saved_revision' | 'inspected_revision' | 'runtime_snapshot';
  source_tree_digest: string;
  file_ref: BuilderSideWorkspaceFileRef;
  path: string;
  language_hint: 'javascript' | 'typescript' | 'html' | 'css' | 'json' | 'markdown' | 'python' | 'text';
  content_status: 'ready' | 'truncated';
  text_preview: string;
  binary_summary: null;
  authority: BuilderSideWorkspaceFileAuthority;
}>;

export type BuilderSideWorkspaceFileRequest = Readonly<{
  project_id: string;
  conversation_id: string;
}>;

export type BuilderSideWorkspaceFileContentRequest = Readonly<{
  project_id: string;
  conversation_id: string;
  file_ref: BuilderSideWorkspaceFileRef;
}>;

export type BuilderSideWorkspaceRuntimeToolFileRequest = Readonly<{
  project_id: string;
  conversation_id: string;
  run_id: string;
  tool_call_id: string;
}>;

export interface BuilderSideWorkspaceFilesPort {
  readCurrentDraftFileTree(
    request: BuilderSideWorkspaceFileRequest,
  ): Promise<BuilderSideWorkspaceFileTreeProjection>;
  readCurrentDraftFileContent(
    request: BuilderSideWorkspaceFileContentRequest,
  ): Promise<BuilderSideWorkspaceFileContentProjection>;
  readRuntimeToolFileTree(
    request: BuilderSideWorkspaceRuntimeToolFileRequest,
  ): Promise<BuilderSideWorkspaceFileTreeProjection>;
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
