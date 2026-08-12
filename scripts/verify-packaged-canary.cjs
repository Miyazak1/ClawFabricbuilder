'use strict';

const nodeCrypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { types: utilTypes } = require('node:util');
const { _electron: defaultElectron } = require('playwright-core');
const { PNG } = require('pngjs');

const {
  sanitizeBuilderDraftCheckpointStatusProjection,
} = require('../electron/builder-draft-checkpoint-status-projection.cjs');
const {
  sanitizeBuilderReviewStateProjection,
} = require('../electron/builder-review-state-projection.cjs');
const {
  sanitizeBuilderCheckRunOutcomeProjection,
} = require('../electron/builder-check-run-outcome-projection.cjs');
const {
  sanitizeBuilderAgentActivityProjection,
} = require('../electron/builder-agent-activity-projection.cjs');

const CANARY_INPUT_VERSION = 'builder-packaged-canary-input.v1';
const CANARY_RESULT_VERSION = 'builder-packaged-canary-result.v21';
const CANARY_INITIAL_CHAT_QUESTION = 'What can you help me with before I choose a project folder?';
const CANARY_QUESTION = 'What does this saved project do, and what should I review before changing it?';
const CANARY_UPDATE_INSTRUCTION = 'Change the main heading and add a short subtitle.';
const CANARY_RESTART_CONTINUATION_INSTRUCTION = 'Plan a compact completed-state summary below the timer before changing files.';
const PACKAGED_CANARY_SENTINEL = 'BUILDER_PACKAGED_CANARY';
const PACKAGED_CANARY_USER_DATA_PATH = 'BUILDER_PACKAGED_CANARY_USER_DATA_PATH';
const PACKAGED_CANARY_USER_DATA_PREFIX = 'clawfabric-builder-packaged-canary-';
const PACKAGED_CANARY_PROJECT_ROOT_PATH = 'BUILDER_PACKAGED_CANARY_PROJECT_ROOT_PATH';
const PACKAGED_CANARY_PROJECT_ROOT_DIRECTORY = 'project-root';
const PACKAGED_CANARY_GENERATION_DEBUG_FILE = 'builder-canary-generation-debug.jsonl';
const LOCAL_STATE_FILE_NAME = 'Local State';
const PROVIDER_CONFIG_DIRECTORY_NAME = 'builder-provider-config-v1';
const PROVIDER_CONFIG_CURRENT_FILE_NAME = 'current.json';
const PROVIDER_SECRETS_DIRECTORY_NAME = 'builder-provider-secrets-v1';
const SESSION_DATA_DIRECTORY_NAME = 'session-data';
const DEFAULT_EXECUTABLE = path.join(__dirname, '..', 'release', 'win-unpacked', 'ClawFabric Builder.exe');
const CANARY_PLAN_PROPOSAL_TIMEOUT_MS = 120_000;
const CANARY_QUESTION_ANSWER_TIMEOUT_MS = 120_000;
const CANARY_CURRENT_PROJECT_WRITE_APPROVAL_TIMEOUT_MS = 5_000;
const CANARY_PLAN_SOURCE_READ_APPROVAL_TIMEOUT_MS = 5_000;
const CANARY_PROJECT_READY_TIMEOUT_MS = 15_000;
const CANARY_CHAT_COLUMN_MIN_WIDTH_PX = 320;
const CANARY_REVIEW_COPY_MIN_WIDTH_PX = 320;
const STDIN_MAX_BYTES = 128 * 1024;
const LOCAL_STATE_MAX_BYTES = 2 * 1024 * 1024;
const PROVIDER_CONFIG_MAX_BYTES = 128 * 1024;
const PROVIDER_SECRET_MAX_BYTES = 64 * 1024;
const PROVIDER_SECRET_MAX_FILES = 8;
const WINDOWS_ENV_ALLOWLIST = Object.freeze([
  'SystemRoot',
  'WINDIR',
  'PATH',
  'ComSpec',
  'TEMP',
  'TMP',
  'USERPROFILE',
  'LOCALAPPDATA',
]);
const SELECTORS = Object.freeze({
  apiKey: '#builder-provider-api-key',
  artifactResizeHandle: '[data-builder-artifact-resize-handle="true"]',
  artifactSidebar: '[data-builder-artifact-sidebar="true"]',
  artifactSummary: '[data-builder-artifact-summary="true"]',
  artifactTabPermissions: '[data-builder-artifact-tab="permissions"]',
  artifactTabVersions: '[data-builder-artifact-tab="versions"]',
  composerAddMenuButton: '[data-builder-composer-add-menu-button="true"]',
  composerAddAskMode: '[data-builder-composer-add-ask-mode="true"]',
  composerAddBuildMode: '[data-builder-composer-add-build-mode="true"]',
  composerAddPlanMode: '[data-builder-composer-add-plan-mode="true"]',
  composerClearMode: '[data-builder-clear-composer-mode="true"]',
  baseUrl: '#builder-provider-base-url',
  changeCard: '[data-builder-change-card]',
  changeDiff: '[data-builder-change-diff]',
  changeDiffLine: '[data-builder-change-diff-line-kind]',
  chatScroll: '[data-builder-chat-scroll="true"]',
  changesFlow: '[data-builder-changes-flow="true"]',
  changesPanel: '[data-builder-changes-panel="true"]',
  changesDisclosure: '[data-builder-changes-disclosure="true"]',
  changesSummaryToggle: '[data-builder-changes-disclosure="true"] > summary',
  changesSummary: '[data-builder-changes-summary="true"]',
  conversationActivity: '[data-builder-activity="true"]',
  addSourceFolder: '[data-builder-add-source-folder="true"]',
  currentVersion: '[data-builder-current-version="true"]',
  generationFailedNotice: '[data-builder-conversation-notice="generation_failed"]',
  historyPreview: '[data-builder-history-preview="true"]',
  idea: '#builder-idea',
  liveOutput: '[data-builder-live-output="true"]',
  newProjectPanel: '[data-builder-new-project-panel="true"]',
  cancelWork: '[data-builder-cancel-work="true"]',
  composer: '[data-builder-composer="true"]',
  composerStatus: '[data-builder-composer-status="true"]',
  approvePlan: '[data-builder-approve-plan="true"]',
  approveCurrentProjectWrite: '[data-builder-approve-current-project-write="true"]',
  approveProviderContextDisclosure: '[data-builder-approve-provider-context-disclosure="true"]',
  artifactPermissions: '[data-builder-artifact-permissions="true"]',
  approvePlanSourceRead: '[data-builder-approve-plan-source-read="true"]',
  currentProjectWriteApproval: '[data-builder-current-project-write-approval="true"]',
  dismissCurrentProjectWriteApproval: '[data-builder-dismiss-current-project-write="true"]',
  planApproved: '[data-builder-activity-card="Plan approved"]',
  planProposed: '[data-builder-activity-card="Plan proposed"]',
  planRejected: '[data-builder-activity-card="Plan rejected"]',
  rejectPlan: '[data-builder-reject-plan="true"]',
  planReviewActions: '[data-builder-plan-review-actions="true"]',
  planSourceReadApproval: '[data-builder-plan-source-read-approval="true"]',
  questionAnswerFailedNotice: '[data-builder-conversation-notice="answer_failed"]',
  questionAnswer: '[data-builder-activity-card="Assistant"]',
  providerContextPermissionRow: '[data-builder-permission-row="ai-context"]',
  submitTurn: '[data-builder-submit-turn="true"]',
  toolActivityRequested: '[data-builder-tool-activity="requested"]',
  toolActivitySucceeded: '[data-builder-tool-activity="succeeded"]',
  userMessage: '[data-builder-activity-card="You"]',
  versionSavedActivity: '[data-builder-activity-card="Version saved"]',
  versionHistory: '[data-builder-version-history="true"]',
  workspaceChip: '[data-builder-workspace-chip="true"]',
  workspaceControlChanges: '[data-builder-workspace-control-tab="changes"]',
  workspaceControlPreview: '[data-builder-workspace-control-tab="preview"]',
  workspaceControlVersions: '[data-builder-workspace-control-tab="versions"]',
  workspaceMenu: '[data-builder-workspace-menu="true"]',
  workspaceMenuButton: '[data-builder-workspace-menu-button="true"]',
  workspaceNewProject: '[data-builder-workspace-new-project="true"]',
  workspacePicker: '[data-builder-workspace-picker="true"]',
  maxTokens: '#builder-provider-max-tokens',
  model: '#builder-provider-model',
  providerPanel: '[data-builder-provider-settings-panel="true"]',
  projectCatalog: '[data-builder-project-catalog="true"]',
  projectPage: '[data-builder-page="true"]',
  preview: '[data-builder-static-preview="true"]',
  previewFrame: '[data-builder-static-preview="true"] iframe[title$=" preview"]',
  previewLimitation: '[data-builder-preview-limitation="true"]',
  previewRuntimeBlocked: '[data-builder-preview-runtime-blocked="true"]',
  previewUnavailable: '[data-builder-preview-unavailable="true"]',
  retryDraft: '[data-builder-retry-draft="true"]',
  resultFlow: '[data-builder-preview-flow="true"]',
  reviewActions: '[data-builder-review-actions="true"]',
  reviewChecks: '[data-builder-review-checks="true"]',
  reviewCheckpoint: '[data-builder-review-checkpoint="true"]',
  reviewCopy: '[data-builder-review-copy="true"]',
  reviewNote: '[data-builder-review-note="true"]',
  reviewMore: '[data-builder-review-more="true"]',
  discardDraft: '[data-builder-discard-draft="true"]',
  reviewOpenChanges: '[data-builder-review-open-changes="true"]',
  reviewOpenPreview: '[data-builder-review-open-preview="true"]',
  reviewSummary: '[data-builder-review-summary="true"]',
  reviewTitle: '[data-builder-review-title="true"]',
  skipCheck: '[data-builder-skip-check="true"]',
  checkRunStatus: '[data-builder-check-run-status]',
  saveVersion: '[data-builder-save-version="true"]',
  temperature: '#builder-provider-temperature',
  timeout: '#builder-provider-timeout',
  unsavedDraft: '[data-builder-unsaved-draft="true"]',
});
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const GIT_OID_PATTERN = /^[0-9a-f]{40}$/u;
const CSS_IDENTIFIER_PATTERN = /^[a-z][a-z0-9_-]*$/u;
const UUID_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const BUILDER_ID_PATTERNS = Object.freeze({
  candidate_id: /^builder-code-change-candidate:[0-9a-f]{64}$/u,
  conversation_id: new RegExp(`^builder-conversation:${UUID_PATTERN}$`, 'u'),
  message_id: new RegExp(`^builder-message:${UUID_PATTERN}$`, 'u'),
  request_id: new RegExp(`^builder-git-request:${UUID_PATTERN}$`, 'u'),
  review_id: new RegExp(`^builder-review:${UUID_PATTERN}$`, 'u'),
  run_id: new RegExp(`^builder-run:${UUID_PATTERN}$`, 'u'),
  run_step_id: new RegExp(`^builder-run-step:${UUID_PATTERN}$`, 'u'),
  task_id: new RegExp(`^builder-task:${UUID_PATTERN}$`, 'u'),
  tool_call_id: new RegExp(`^builder-tool-call:${UUID_PATTERN}$`, 'u'),
  turn_id: new RegExp(`^builder-turn:${UUID_PATTERN}$`, 'u'),
});
const DRAFT_ID_PATTERN = /^builder-generation-draft:[0-9a-f]{64}$/u;

const ERROR_MESSAGES = Object.freeze({
  canary_input_invalid: 'Packaged canary input is invalid.',
  canary_secret_source_invalid: 'Packaged canary credential source is invalid.',
  canary_launch_failed: 'Packaged canary could not launch.',
  canary_ui_failed: 'Packaged canary UI flow failed.',
  canary_settings_navigation_failed: 'Packaged canary settings navigation failed.',
  canary_settings_panel_failed: 'Packaged canary settings panel failed.',
  canary_settings_save_failed: 'Packaged canary settings save failed.',
  canary_settings_return_failed: 'Packaged canary could not return from settings.',
  canary_saved_profile_failed: 'Packaged canary saved profile setup failed.',
  canary_build_workspace_required_failed: 'Packaged canary build workspace gate failed.',
  canary_new_project_failed: 'Packaged canary new project failed.',
  canary_plan_alert_failed: 'Packaged canary plan proposal showed an app error.',
  canary_plan_after_context_failed: 'Packaged canary plan failed after reading project context.',
  canary_plan_base_unavailable_failed: 'Packaged canary plan source context was unavailable.',
  canary_plan_before_context_failed: 'Packaged canary plan failed before reading project context.',
  canary_plan_bridge_invoke_failed: 'Packaged canary plan bridge diagnostic failed.',
  canary_plan_bridge_shape_failed: 'Packaged canary plan bridge diagnostic returned an unexpected envelope.',
  canary_plan_bridge_unavailable_failed: 'Packaged canary plan bridge diagnostic was unavailable.',
  canary_plan_failed: 'Packaged canary plan proposal failed.',
  canary_plan_evidence_failed: 'Packaged canary plan evidence failed.',
  canary_plan_context_status_failed: 'Packaged canary plan context status was unavailable.',
  canary_plan_provider_http_failed: 'Packaged canary plan provider request failed.',
  canary_plan_provider_unavailable_failed: 'Packaged canary plan provider was unavailable.',
  canary_plan_renderer_sanitizer_failed: 'Packaged canary plan succeeded in main but was rejected by the renderer.',
  canary_plan_request_invalid_failed: 'Packaged canary plan request was rejected.',
  canary_plan_source_read_approval_failed: 'Packaged canary plan source read approval failed.',
  canary_plan_structured_response_failed: 'Packaged canary plan response could not be prepared.',
  canary_plan_timeout_failed: 'Packaged canary plan proposal timed out.',
  canary_plan_review_failed: 'Packaged canary plan approval did not continue.',
  canary_plan_tool_activity_failed: 'Packaged canary plan tool activity was not visible.',
  canary_plan_tool_result_failed: 'Packaged canary plan project context read failed.',
  canary_question_failed: 'Packaged canary question did not produce a visible answer.',
  canary_question_evidence_failed: 'Packaged canary question evidence failed.',
  canary_generation_terminal_failed: 'Packaged canary generation did not reach a terminal preview state.',
  canary_current_project_write_approval_failed: 'Packaged canary current project write approval failed.',
  canary_retry_failed: 'Packaged canary retry did not recover a failed draft.',
  canary_update_generation_terminal_failed: 'Packaged canary update generation did not reach a terminal preview state.',
  canary_draft_failed: 'Packaged canary unsaved draft evidence failed.',
  canary_update_draft_failed: 'Packaged canary update draft evidence failed.',
  canary_pending_draft_restart_failed: 'Packaged canary pending draft restart restore failed.',
  canary_save_failed: 'Packaged canary draft save failed.',
  canary_update_save_failed: 'Packaged canary update draft save failed.',
  canary_save_persistence_failed: 'Packaged canary draft was not persisted.',
  canary_save_confirmation_failed: 'Packaged canary could not confirm the persisted draft in the UI.',
  canary_update_save_confirmation_failed: 'Packaged canary could not confirm the persisted update in the UI.',
  canary_save_activity_failed: 'Packaged canary saved activity evidence failed.',
  canary_review_diff_failed: 'Packaged canary review diff evidence failed.',
  canary_review_diff_activity_failed: 'Packaged canary review diff activity layout failed.',
  canary_review_diff_artifact_chat_geometry_failed: 'Packaged canary review artifact chat geometry failed.',
  canary_review_diff_artifact_layout_failed: 'Packaged canary review diff artifact layout failed.',
  canary_review_diff_artifact_overlap_failed: 'Packaged canary review artifact overlap failed.',
  canary_review_diff_artifact_resize_geometry_failed: 'Packaged canary review artifact resize geometry failed.',
  canary_review_diff_artifact_result_geometry_failed: 'Packaged canary review artifact result geometry failed.',
  canary_review_diff_artifact_review_bounds_failed: 'Packaged canary review artifact review bounds failed.',
  canary_review_diff_artifact_sidebar_geometry_failed: 'Packaged canary review artifact sidebar geometry failed.',
  canary_review_diff_artifact_summary_geometry_failed: 'Packaged canary review artifact summary geometry failed.',
  canary_review_diff_artifact_summary_horizontal_failed: 'Packaged canary review artifact summary horizontal bounds failed.',
  canary_review_diff_artifact_summary_order_failed: 'Packaged canary review artifact summary order failed.',
  canary_review_diff_artifact_summary_vertical_failed: 'Packaged canary review artifact summary vertical bounds failed.',
  canary_review_diff_artifact_summary_width_failed: 'Packaged canary review artifact summary width failed.',
  canary_review_diff_box_failed: 'Packaged canary review diff geometry evidence failed.',
  canary_review_diff_checkpoint_action_geometry_failed: 'Packaged canary review checkpoint action geometry failed.',
  canary_review_diff_checkpoint_action_overlap_failed: 'Packaged canary review checkpoint actions overlapped.',
  canary_review_diff_checkpoint_copy_width_failed: 'Packaged canary review checkpoint copy width failed.',
  canary_review_diff_checkpoint_height_failed: 'Packaged canary review checkpoint height failed.',
  canary_review_diff_checkpoint_width_failed: 'Packaged canary review checkpoint width failed.',
  canary_review_diff_checkpoint_child_bounds_failed: 'Packaged canary review checkpoint child bounds failed.',
  canary_review_diff_changes_layout_failed: 'Packaged canary review diff changes layout failed.',
  canary_review_diff_checkpoint_layout_failed: 'Packaged canary review checkpoint layout failed.',
  canary_review_diff_checkpoint_text_stack_failed: 'Packaged canary review checkpoint text layout failed.',
  canary_review_diff_text_failed: 'Packaged canary review diff text evidence failed.',
  canary_check_run_failed: 'Packaged canary project check failed.',
  canary_history_failed: 'Packaged canary history evidence failed.',
  canary_history_navigation_failed: 'Packaged canary history navigation failed.',
  canary_history_preview_failed: 'Packaged canary history preview evidence failed.',
  canary_history_current_failed: 'Packaged canary history changed current evidence.',
  canary_history_return_failed: 'Packaged canary could not return to the current version.',
  canary_preview_failed: 'Packaged canary preview evidence failed.',
  canary_preview_frame_body_failed: 'Packaged canary preview frame body evidence failed.',
  canary_preview_frame_contract_failed: 'Packaged canary preview frame contract failed.',
  canary_preview_limitation_failed: 'Packaged canary preview limitation evidence failed.',
  canary_preview_limitation_text_failed: 'Packaged canary preview limitation text failed.',
  canary_preview_pixels_failed: 'Packaged canary preview pixel evidence failed.',
  canary_preview_runtime_text_failed: 'Packaged canary runtime preview explanation failed.',
  canary_preview_surface_failed: 'Packaged canary preview surface did not appear.',
  canary_preview_unavailable_pixels_failed: 'Packaged canary unavailable preview pixel evidence failed.',
  canary_preview_unavailable_text_failed: 'Packaged canary unavailable preview explanation failed.',
  canary_version_failed: 'Packaged canary revision version evidence failed.',
  canary_read_evidence_failed: 'Packaged canary read evidence failed.',
  canary_read_evidence_pending_update_current_failed:
    'Packaged canary pending update current revision evidence failed.',
  canary_read_evidence_pending_update_task_stream_failed:
    'Packaged canary pending update task stream evidence failed.',
  canary_read_evidence_initial_current_failed: 'Packaged canary initial current evidence failed.',
  canary_read_evidence_initial_current_current_failed: 'Packaged canary initial current project evidence failed.',
  canary_read_evidence_initial_current_task_stream_failed: 'Packaged canary initial current task stream evidence failed.',
  canary_read_evidence_initial_saved_failed: 'Packaged canary initial saved evidence failed.',
  canary_read_evidence_pending_update_failed: 'Packaged canary pending update evidence failed.',
  canary_read_evidence_plan_proposal_failed: 'Packaged canary plan proposal evidence failed.',
  canary_read_evidence_restart_continuation_failed: 'Packaged canary restart continuation evidence failed.',
  canary_read_evidence_saved_profile_boot_failed: 'Packaged canary saved profile boot evidence failed.',
  canary_read_evidence_updated_current_failed: 'Packaged canary updated current evidence failed.',
  canary_read_evidence_updated_saved_failed: 'Packaged canary updated saved evidence failed.',
  canary_restart_failed: 'Packaged canary restart restore failed.',
  canary_restart_open_failed: 'Packaged canary could not reopen the saved project.',
  canary_restart_preview_failed: 'Packaged canary could not restore the saved preview.',
  canary_restart_evidence_failed: 'Packaged canary restart evidence could not be verified.',
  canary_restart_state_new: 'Packaged canary lost the saved project selection after restart.',
  canary_restart_state_opening: 'Packaged canary project restore did not finish.',
  canary_restart_state_unavailable: 'Packaged canary restored project is unavailable.',
  canary_custom_chrome_failed: 'Packaged canary custom window controls are unavailable.',
  canary_evidence_failed: 'Packaged canary evidence could not be verified.',
  canary_cleanup_failed: 'Packaged canary cleanup failed.',
});
const ERROR_STAGES = Object.freeze({
  canary_input_invalid: 'input',
  canary_secret_source_invalid: 'secret_source',
  canary_launch_failed: 'launch',
  canary_ui_failed: 'ui',
  canary_settings_navigation_failed: 'settings_navigation',
  canary_settings_panel_failed: 'settings_panel',
  canary_settings_save_failed: 'settings_save',
  canary_settings_return_failed: 'settings_return',
  canary_saved_profile_failed: 'saved_profile',
  canary_build_workspace_required_failed: 'build_workspace_required',
  canary_new_project_failed: 'new_project',
  canary_plan_alert_failed: 'plan_alert',
  canary_plan_after_context_failed: 'plan_after_context',
  canary_plan_base_unavailable_failed: 'plan_base_unavailable',
  canary_plan_before_context_failed: 'plan_before_context',
  canary_plan_bridge_invoke_failed: 'plan_bridge_invoke',
  canary_plan_bridge_shape_failed: 'plan_bridge_shape',
  canary_plan_bridge_unavailable_failed: 'plan_bridge_unavailable',
  canary_plan_failed: 'plan',
  canary_plan_evidence_failed: 'plan_evidence',
  canary_plan_context_status_failed: 'plan_context_status',
  canary_plan_provider_http_failed: 'plan_provider_http',
  canary_plan_provider_unavailable_failed: 'plan_provider_unavailable',
  canary_plan_renderer_sanitizer_failed: 'plan_renderer_sanitizer',
  canary_plan_request_invalid_failed: 'plan_request_invalid',
  canary_plan_structured_response_failed: 'plan_structured_response',
  canary_plan_timeout_failed: 'plan_timeout',
  canary_plan_review_failed: 'plan_review',
  canary_plan_tool_activity_failed: 'plan_tool_activity',
  canary_plan_tool_result_failed: 'plan_tool_result',
  canary_question_failed: 'question',
  canary_question_evidence_failed: 'question_evidence',
  canary_generation_terminal_failed: 'generation_terminal',
  canary_current_project_write_approval_failed: 'current_project_write_approval',
  canary_retry_failed: 'retry',
  canary_update_generation_terminal_failed: 'update_generation_terminal',
  canary_draft_failed: 'draft',
  canary_update_draft_failed: 'update_draft',
  canary_pending_draft_restart_failed: 'pending_draft_restart',
  canary_save_failed: 'save',
  canary_update_save_failed: 'update_save',
  canary_save_persistence_failed: 'save_persistence',
  canary_save_confirmation_failed: 'save_confirmation',
  canary_update_save_confirmation_failed: 'update_save_confirmation',
  canary_save_activity_failed: 'save_activity',
  canary_review_diff_failed: 'review_diff',
  canary_review_diff_activity_failed: 'review_diff_activity',
  canary_review_diff_artifact_chat_geometry_failed: 'review_diff_artifact_chat_geometry',
  canary_review_diff_artifact_layout_failed: 'review_diff_artifact_layout',
  canary_review_diff_artifact_overlap_failed: 'review_diff_artifact_overlap',
  canary_review_diff_artifact_resize_geometry_failed: 'review_diff_artifact_resize_geometry',
  canary_review_diff_artifact_result_geometry_failed: 'review_diff_artifact_result_geometry',
  canary_review_diff_artifact_review_bounds_failed: 'review_diff_artifact_review_bounds',
  canary_review_diff_artifact_sidebar_geometry_failed: 'review_diff_artifact_sidebar_geometry',
  canary_review_diff_artifact_summary_geometry_failed: 'review_diff_artifact_summary_geometry',
  canary_review_diff_artifact_summary_horizontal_failed: 'review_diff_artifact_summary_horizontal',
  canary_review_diff_artifact_summary_order_failed: 'review_diff_artifact_summary_order',
  canary_review_diff_artifact_summary_vertical_failed: 'review_diff_artifact_summary_vertical',
  canary_review_diff_artifact_summary_width_failed: 'review_diff_artifact_summary_width',
  canary_review_diff_box_failed: 'review_diff_geometry',
  canary_review_diff_checkpoint_action_geometry_failed: 'review_diff_checkpoint_action_geometry',
  canary_review_diff_checkpoint_action_overlap_failed: 'review_diff_checkpoint_action_overlap',
  canary_review_diff_checkpoint_copy_width_failed: 'review_diff_checkpoint_copy_width',
  canary_review_diff_checkpoint_height_failed: 'review_diff_checkpoint_height',
  canary_review_diff_checkpoint_width_failed: 'review_diff_checkpoint_width',
  canary_review_diff_checkpoint_child_bounds_failed: 'review_diff_checkpoint_child_bounds',
  canary_review_diff_changes_layout_failed: 'review_diff_changes_layout',
  canary_review_diff_checkpoint_layout_failed: 'review_diff_checkpoint_layout',
  canary_review_diff_checkpoint_text_stack_failed: 'review_diff_checkpoint_text_stack',
  canary_review_diff_text_failed: 'review_diff_text',
  canary_check_run_failed: 'check_run',
  canary_history_failed: 'history',
  canary_history_navigation_failed: 'history_navigation',
  canary_history_preview_failed: 'history_preview',
  canary_history_current_failed: 'history_current',
  canary_history_return_failed: 'history_return',
  canary_preview_failed: 'preview',
  canary_preview_frame_body_failed: 'preview_frame_body',
  canary_preview_frame_contract_failed: 'preview_frame_contract',
  canary_preview_limitation_failed: 'preview_limitation',
  canary_preview_limitation_text_failed: 'preview_limitation_text',
  canary_preview_pixels_failed: 'preview_pixels',
  canary_preview_runtime_text_failed: 'preview_runtime_text',
  canary_preview_surface_failed: 'preview_surface',
  canary_preview_unavailable_pixels_failed: 'preview_unavailable_pixels',
  canary_preview_unavailable_text_failed: 'preview_unavailable_text',
  canary_version_failed: 'version',
  canary_read_evidence_failed: 'read_evidence',
  canary_read_evidence_pending_update_current_failed: 'read_evidence_pending_update_current',
  canary_read_evidence_pending_update_task_stream_failed: 'read_evidence_pending_update_task_stream',
  canary_read_evidence_initial_current_failed: 'read_evidence_initial_current',
  canary_read_evidence_initial_current_current_failed: 'read_evidence_initial_current_current',
  canary_read_evidence_initial_current_task_stream_failed: 'read_evidence_initial_current_task_stream',
  canary_read_evidence_initial_saved_failed: 'read_evidence_initial_saved',
  canary_read_evidence_pending_update_failed: 'read_evidence_pending_update',
  canary_read_evidence_plan_proposal_failed: 'read_evidence_plan_proposal',
  canary_read_evidence_restart_continuation_failed: 'read_evidence_restart_continuation',
  canary_read_evidence_saved_profile_boot_failed: 'read_evidence_saved_profile_boot',
  canary_read_evidence_updated_current_failed: 'read_evidence_updated_current',
  canary_read_evidence_updated_saved_failed: 'read_evidence_updated_saved',
  canary_restart_failed: 'restart',
  canary_restart_open_failed: 'restart_open',
  canary_restart_preview_failed: 'restart_preview',
  canary_restart_evidence_failed: 'restart_evidence',
  canary_restart_state_new: 'restart_state_new',
  canary_restart_state_opening: 'restart_state_opening',
  canary_restart_state_unavailable: 'restart_state_unavailable',
  canary_custom_chrome_failed: 'custom_chrome',
  canary_evidence_failed: 'evidence',
  canary_cleanup_failed: 'cleanup',
});
const PREVIEW_FAILURE_CODES = Object.freeze(new Set([
  'canary_preview_frame_body_failed',
  'canary_preview_frame_contract_failed',
  'canary_preview_limitation_failed',
  'canary_preview_limitation_text_failed',
  'canary_preview_pixels_failed',
  'canary_preview_runtime_text_failed',
  'canary_preview_surface_failed',
  'canary_preview_unavailable_pixels_failed',
  'canary_preview_unavailable_text_failed',
]));
const BRIDGE_CONTRACT_KEYS = Object.freeze([
  'bridge_version',
  'legacy_namespaces_absent',
  'check_run_namespace',
  'live_preview_namespace',
  'side_workspace_files_namespace',
  'plan_review_namespace',
  'provider_context_disclosure_approval_namespace',
]);
const CATALOG_RESULT_KEYS = Object.freeze(['authority_evidence', 'operation', 'projects', 'result_version']);
const CATALOG_PROJECT_KEYS = Object.freeze([
  'commit_oid',
  'project_id',
  'revision_number',
  'revision_receipt_digest',
  'selected_at_ms',
  'summary',
  'title',
  'tree_oid',
]);
const AUTHORITY_EVIDENCE_KEYS = Object.freeze([
  'code_authority',
  'current_selection',
  'product_authority',
  'source_read_admission',
]);
const CURRENT_RESULT_KEYS = Object.freeze([
  'authority_evidence',
  'current',
  'git_candidate_receipt',
  'git_verification_receipt',
  'operation',
  'product_revision_receipt',
  'result_version',
  'source_tree',
]);
const CURRENT_SUMMARY_KEYS = Object.freeze([
  'commit_oid',
  'object_format',
  'parent_oid',
  'project_id',
  'revision_number',
  'revision_receipt_digest',
  'summary',
  'title',
  'tree_oid',
]);
const PRODUCT_RECEIPT_KEYS = Object.freeze([
  'candidate_digest',
  'candidate_id',
  'commit_oid',
  'conversation_id',
  'object_format',
  'parent_oid',
  'previous_revision_receipt_digest',
  'project_id',
  'request_id',
  'resulting_tree_digest',
  'review_id',
  'revision_number',
  'revision_receipt_digest',
  'run_id',
  'selected_at_ms',
  'semantic_identity_digest',
  'summary',
  'task_id',
  'title',
  'tree_oid',
  'turn_id',
  'verification_receipt_digest',
]);
const CANDIDATE_RECEIPT_KEYS = Object.freeze([
  'candidate_digest',
  'candidate_id',
  'code_authority',
  'commit_oid',
  'conversation_id',
  'expected_base_oid',
  'object_format',
  'parent_oid',
  'product_revision_admission',
  'project_id',
  'receipt_version',
  'replay',
  'repository_version',
  'request_id',
  'resulting_tree_digest',
  'run_id',
  'semantic_identity_digest',
  'task_id',
  'tree_oid',
  'turn_id',
  'verification_receipt_digest',
]);
const VERIFICATION_RECEIPT_KEYS = Object.freeze([
  'candidate_digest',
  'candidate_id',
  'candidate_tree_oid',
  'commit_object_admission',
  'commit_oid',
  'commit_ref_admission',
  'conversation_id',
  'expected_base_oid',
  'object_format',
  'project_id',
  'receipt_version',
  'repository_version',
  'request_id',
  'request_ref_admission',
  'resulting_tree_digest',
  'run_id',
  'semantic_identity_digest',
  'task_id',
  'turn_id',
  'verification_admission',
]);
const SOURCE_TREE_KEYS = Object.freeze(['files', 'source_tree_digest', 'source_tree_version']);
const SOURCE_ENTRY_KEYS = Object.freeze(['content', 'content_digest', 'entry_kind', 'path']);
const STATUS_KEYS = Object.freeze([
  'config_digest',
  'configured',
  'credential_status',
  'status_version',
]);
const TASK_STREAM_KEYS = Object.freeze(['authority', 'conversation', 'project_id', 'stream_version']);
const TASK_STREAM_OPTIONAL_KEYS = Object.freeze([
  'context_status_projection',
  'provider_context_disclosure_status_projection',
  'draft_checkpoint_status_projection',
  'review_state_projection',
  'check_run_outcome_projection',
  'agent_activity_projection',
]);
const TASK_STREAM_AUTHORITY_KEYS = Object.freeze([
  'candidate_source',
  'conversation',
  'project_revision',
  'project_source',
]);
const TASK_STREAM_CONTEXT_STATUS_PROJECTION_KEYS = Object.freeze([
  'projection_version',
  'label',
  'tone',
  'next_action_hint',
  'has_pending_handoff',
  'pending_handoff_count',
  'needs_confirmation',
  'can_contextual_execute',
  'authority',
]);
const TASK_STREAM_CONTEXT_STATUS_AUTHORITY_KEYS = Object.freeze([
  'projection_authority',
  'working_context_state',
  'pending_handoff_packets',
  'renderer_authority',
  'ipc_authority',
  'provider_dispatch',
  'tool_dispatch',
  'source_read',
  'source_write',
  'git_mutation',
  'permission_grant',
  'revision_admission',
  'secret_access',
]);
const TASK_STREAM_PROVIDER_CONTEXT_DISCLOSURE_STATUS_PROJECTION_KEYS = Object.freeze([
  'projection_version',
  'label',
  'tone',
  'next_action_hint',
  'needs_user_approval',
  'can_use_provider_context',
  'blocked_reason',
  'request_available',
  'inspection',
  'authority',
]);
const TASK_STREAM_PROVIDER_CONTEXT_DISCLOSURE_INSPECTION_KEYS = Object.freeze([
  'title',
  'summary',
  'details',
  'purpose',
  'provider_scope',
  'context_surface',
]);
const TASK_STREAM_PROVIDER_CONTEXT_DISCLOSURE_CONTEXT_SURFACE_KEYS = Object.freeze([
  'working_context_state_status',
  'segment_count',
  'segment_kinds',
  'omitted_ref_count',
  'budget',
  'permission_gate',
]);
const TASK_STREAM_PROVIDER_CONTEXT_DISCLOSURE_BUDGET_KEYS = Object.freeze([
  'used_prompt_bytes',
  'max_prompt_bytes',
  'reserved_response_bytes',
]);
const TASK_STREAM_PROVIDER_CONTEXT_DISCLOSURE_PERMISSION_GATE_KEYS = Object.freeze([
  'workspace_state',
  'write_permission',
  'side_effect_ready',
]);
const TASK_STREAM_PROVIDER_CONTEXT_DISCLOSURE_STATUS_AUTHORITY_KEYS = Object.freeze([
  'projection_authority',
  'disclosure_request_preparation',
  'renderer_authority',
  'provider_context_body',
  'provider_dispatch',
  'tool_dispatch',
  'source_read',
  'source_write',
  'git_mutation',
  'sqlite_write',
  'permission_grant',
  'revision_admission',
  'secret_access',
]);
const TASK_STREAM_PROVIDER_CONTEXT_DISCLOSURE_SEGMENT_KINDS = Object.freeze([
  'approved_plan',
  'compaction_summary',
  'current_result',
  'handoff_summary',
  'latest_user_message',
  'selected_source_summary',
  'working_context_constraints',
  'working_context_objective',
]);
const TASK_STREAM_PROVIDER_CONTEXT_DISCLOSURE_WORKING_CONTEXT_STATES = Object.freeze([
  'approved_plan_ready',
  'discussing',
  'empty',
  'needs_clarification',
  'ready',
  'stale',
]);
const TASK_STREAM_CONVERSATION_KEYS = Object.freeze([
  'conversation_id',
  'created_at_ms',
  'head_sequence',
  'items',
  'recorded_active_turn_id',
  'window',
]);
const TASK_STREAM_WINDOW_KEYS = Object.freeze(['first_sequence', 'has_earlier', 'last_sequence']);
const TASK_STREAM_MESSAGE_KEYS = Object.freeze(['message_id', 'text']);
const TASK_STREAM_TASK_KEYS = Object.freeze(['task_id', 'title']);
const TASK_STREAM_CANDIDATE_KEYS = Object.freeze([
  'draft_id',
  'title',
  'summary',
  'candidate_state',
  'source_availability',
]);
const TASK_STREAM_USER_MESSAGE_KEYS = Object.freeze([
  'item_kind',
  'sequence',
  'turn_id',
  'message',
  'message_kind',
  'mode',
  'task',
]);
const TASK_STREAM_TASK_BRIEF_UPDATED_KEYS = Object.freeze([
  'item_kind',
  'sequence',
  'turn_id',
  'run_id',
  'task',
  'brief',
  'recorded_state',
]);
const TASK_STREAM_TASK_BRIEF_KEYS = Object.freeze(['status', 'summary', 'contextual_build_ready']);
const TASK_STREAM_RUN_STARTED_KEYS = Object.freeze([
  'item_kind',
  'sequence',
  'turn_id',
  'run_id',
  'task_id',
  'attempt_number',
  'retry_of_run_id',
  'recorded_state',
]);
const TASK_STREAM_RUN_CONTEXT_SNAPSHOT_KEYS = Object.freeze([
  'item_kind',
  'sequence',
  'turn_id',
  'run_id',
  'task_id',
  'context',
]);
const TASK_STREAM_PROGRAMMING_RUN_ADMITTED_KEYS = Object.freeze([
  'item_kind',
  'sequence',
  'turn_id',
  'run_id',
  'task_id',
  'recorded_state',
]);
const TASK_STREAM_RUN_CONTEXT_KEYS = Object.freeze([
  'recorded_state',
  'route',
  'dispatch',
  'downgraded_from',
  'downgrade_reason',
  'brief',
  'base',
  'permission_result',
  'command_execution',
  'network_access',
]);
const TASK_STREAM_RUN_PROGRESS_KEYS = Object.freeze([
  'item_kind',
  'sequence',
  'turn_id',
  'run_id',
  'stage',
  'recorded_state',
]);
const TASK_STREAM_RUN_CONTROL_KEYS = Object.freeze([
  'item_kind',
  'sequence',
  'turn_id',
  'run_id',
  'action',
]);
const TASK_STREAM_RUN_COMPLETED_KEYS = Object.freeze([
  'item_kind',
  'sequence',
  'turn_id',
  'run_id',
  'terminal_status',
  'result_kind',
  'failure_phase',
  'assistant_message',
  'candidate',
]);
const TASK_STREAM_TOOL_CALL_REQUESTED_KEYS = Object.freeze([
  'item_kind',
  'sequence',
  'turn_id',
  'run_id',
  'step_id',
  'tool_call_id',
  'tool_label',
  'action',
  'resource',
  'lifecycle',
  'recorded_state',
]);
const TASK_STREAM_TOOL_CALL_RESULT_RECORDED_KEYS = Object.freeze([
  'item_kind',
  'sequence',
  'turn_id',
  'run_id',
  'step_id',
  'tool_call_id',
  'tool_label',
  'action',
  'resource',
  'result',
  'lifecycle',
  'recorded_state',
]);
const TASK_STREAM_TOOL_RESOURCE_KEYS = Object.freeze(['resource_kind']);
const TASK_STREAM_TOOL_LIFECYCLE_KEYS = Object.freeze([
  'permission_admission',
  'dispatch_admission',
  'execution_admission',
  'result_admission',
]);
const TASK_STREAM_TOOL_RESULT_KEYS = Object.freeze([
  'status',
  'summary_code',
  'display_summary',
]);
const TASK_STREAM_TOOL_RESULT_LIFECYCLE_KEYS = Object.freeze([
  'result_admission',
  'raw_output_admission',
  'revision_admission',
]);
const TASK_STREAM_CANDIDATE_REVIEWED_KEYS = Object.freeze([
  'item_kind',
  'sequence',
  'turn_id',
  'run_id',
  'draft_id',
  'decision',
  'candidate_state',
  'saved_revision',
]);
const TASK_STREAM_PLAN_REVIEWED_KEYS = Object.freeze([
  'item_kind',
  'sequence',
  'turn_id',
  'run_id',
  'decision',
  'plan_state',
]);
const TASK_STREAM_SAVED_REVISION_KEYS = Object.freeze(['revision_number']);
const TASK_STREAM_TURN_COMPLETED_KEYS = Object.freeze([
  'item_kind',
  'sequence',
  'turn_id',
  'run_id',
  'outcome',
]);
const READ_EVIDENCE_KEYS = Object.freeze([
  'bridge_contract',
  'catalog',
  'current',
  'status',
  'task_stream',
]);
const TASK_STREAM_RUN_PROGRESS_STAGES = Object.freeze([
  'context_ready',
  'provider_request_started',
  'provider_response_received',
  'result_preparing',
]);
const TASK_STREAM_TOOL_LABEL_BY_ACTION = Object.freeze({
  'context.read': 'Read project context',
  'project.read': 'Read project context',
  'project.edit': 'Prepare project edit',
  'secret.read': 'Use saved secret',
  'filesystem.read': 'Read project file',
  'filesystem.write': 'Prepare file change',
  'network.request': 'Use network',
  'process.spawn': 'Run local command',
  'publication.create': 'Prepare publish',
  'permission.grant': 'Change access',
});
const TASK_STREAM_TOOL_RESOURCE_KINDS_BY_ACTION = Object.freeze({
  'context.read': Object.freeze(['project', 'conversation', 'task', 'run', 'revision', 'artifact']),
  'project.read': Object.freeze(['project', 'revision']),
  'project.edit': Object.freeze(['project']),
  'secret.read': Object.freeze(['secret']),
  'filesystem.read': Object.freeze(['filesystem']),
  'filesystem.write': Object.freeze(['filesystem']),
  'network.request': Object.freeze(['network']),
  'process.spawn': Object.freeze(['process']),
  'publication.create': Object.freeze(['publication']),
  'permission.grant': Object.freeze(['permission']),
});
const TASK_STREAM_TOOL_RESULT_SUMMARY_BY_CODE = Object.freeze({
  completed_without_raw_output: 'This step completed. Details were not kept.',
  failed_without_raw_output: 'This step could not finish. Details were not kept.',
  output_rejected: 'The tool output was not accepted.',
  adapter_unavailable: 'The tool was unavailable.',
  timed_out_without_raw_output: 'This step timed out. Details were not kept.',
  cancelled_without_raw_output: 'This step was stopped. Details were not kept.',
});
const TASK_STREAM_TOOL_RESULT_CODES_BY_STATUS = Object.freeze({
  succeeded: Object.freeze(['completed_without_raw_output']),
  failed: Object.freeze([
    'failed_without_raw_output',
    'output_rejected',
    'adapter_unavailable',
    'timed_out_without_raw_output',
  ]),
  cancelled: Object.freeze(['cancelled_without_raw_output']),
});
const TRUSTED_READ_EVIDENCE = new WeakSet();
const RUN_OPTION_KEYS = Object.freeze(['argv', 'electron', 'env', 'fs', 'os', 'userDataPath']);
const FIRST_CONFIG_INPUT_KEYS = Object.freeze(['executable_path', 'idea', 'provider', 'schema_version']);
const SAVED_PROFILE_INPUT_KEYS = Object.freeze([
  'executable_path',
  'idea',
  'mode',
  'schema_version',
  'source_user_data_path',
]);
const PROVIDER_SECRET_FILE_PATTERN = /^[0-9a-f]{64}\.json$/u;
const PROJECT_ID_PATTERN = /^builder-project:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const PROJECT_ID_LENGTH = 'builder-project:00000000-0000-0000-0000-000000000000'.length;
const SAVED_ACTIVITY_INTERNAL_EVIDENCE_PATTERN = /builder-(?:generation-draft|git-request|message|project|review|run|task|turn):|sha256:|commit_oid|tree_oid|receipt|provider|credential|source_tree|review_id|reviewer_id|reviewed_at_ms/iu;
const REVIEW_DIFF_INTERNAL_EVIDENCE_PATTERN = /builder-(?:code-change-candidate|conversation|generation-draft|git-request|message|project|review|run|task|turn):|sha256:|commit_oid|tree_oid|receipt|provider|credential|source_tree|review_id|reviewer_id|reviewed_at_ms/iu;

class BuilderPackagedCanaryError extends Error {
  constructor(code = 'canary_evidence_failed', diagnostic = null) {
    const selected = Object.hasOwn(ERROR_MESSAGES, code) ? code : 'canary_evidence_failed';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderPackagedCanaryError';
    this.code = selected;
    this.stage = ERROR_STAGES[selected];
    if (diagnostic !== null) this.diagnostic = diagnostic;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) {
  throw new BuilderPackagedCanaryError(code);
}

function failWithDiagnostic(code, diagnostic) {
  throw new BuilderPackagedCanaryError(code, diagnostic);
}

function fixedError(source, fallback = 'canary_evidence_failed') {
  let code = fallback;
  let diagnostic = null;
  try {
    if (source !== null && typeof source === 'object' && !utilTypes.isProxy(source)) {
      const descriptor = Object.getOwnPropertyDescriptor(source, 'code');
      if (
        descriptor
        && descriptor.enumerable
        && !('get' in descriptor)
        && !('set' in descriptor)
        && Object.hasOwn(ERROR_MESSAGES, descriptor.value)
      ) code = descriptor.value;
      const diagnosticDescriptor = Object.getOwnPropertyDescriptor(source, 'diagnostic');
      if (
        diagnosticDescriptor
        && diagnosticDescriptor.enumerable
        && !('get' in diagnosticDescriptor)
        && !('set' in diagnosticDescriptor)
      ) {
        diagnostic = diagnosticDescriptor.value;
      }
    }
  } catch {
    code = fallback;
    diagnostic = null;
  }
  return new BuilderPackagedCanaryError(code, diagnostic);
}

function isObjectProxy(value) {
  return value !== null && typeof value === 'object' && utilTypes.isProxy(value);
}

function text(value, maxBytes = 64 * 1024) {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
    fail('canary_input_invalid');
  }
  if (Buffer.byteLength(value, 'utf8') > maxBytes) fail('canary_input_invalid');
  return value;
}

function optionalNumber(value, minimum, maximum) {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    fail('canary_input_invalid');
  }
  return value;
}

function integer(value, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) fail('canary_input_invalid');
  return value;
}

function exactObject(value, expectedKeys) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || isObjectProxy(value)) {
    fail('canary_input_invalid');
  }
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== expectedKeys.length
    || keys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))
  ) fail('canary_input_invalid');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of expectedKeys) {
    const descriptor = descriptors[key];
    if (!descriptor || !descriptor.enumerable || 'get' in descriptor || 'set' in descriptor) {
      fail('canary_input_invalid');
    }
  }
  return descriptors;
}

function exactDataObject(value, expectedKeys, code = 'canary_evidence_failed') {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value) || isObjectProxy(value)) fail(code);
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== expectedKeys.length
      || keys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))
    ) fail(code);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const key of expectedKeys) {
      const descriptor = descriptors[key];
      if (!descriptor || !descriptor.enumerable || 'get' in descriptor || 'set' in descriptor) {
        fail(code);
      }
    }
    return descriptors;
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError) throw error;
    fail(code);
  }
}

function exactDataObjectWithOptional(value, requiredKeys, optionalKeys, code = 'canary_evidence_failed') {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value) || isObjectProxy(value)) fail(code);
    const allowedKeys = [...requiredKeys, ...optionalKeys];
    const keys = Reflect.ownKeys(value);
    if (
      keys.length < requiredKeys.length
      || keys.length > allowedKeys.length
      || keys.some((key) => typeof key !== 'string' || !allowedKeys.includes(key))
      || requiredKeys.some((key) => !keys.includes(key))
    ) fail(code);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor || !descriptor.enumerable || 'get' in descriptor || 'set' in descriptor) {
        fail(code);
      }
    }
    return descriptors;
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError) throw error;
    fail(code);
  }
}

function sanitizeProvider(value) {
  const descriptors = exactObject(value, [
    'base_url',
    'credential',
    'max_tokens',
    'model',
    'temperature',
    'timeout_ms',
  ]);
  const baseUrl = text(descriptors.base_url.value);
  try {
    const parsed = new URL(baseUrl);
    if (
      !['http:', 'https:'].includes(parsed.protocol)
      || parsed.username
      || parsed.password
      || parsed.search
      || parsed.hash
      || parsed.toString().replace(/\/$/u, '') !== baseUrl
    ) fail('canary_input_invalid');
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname.toLowerCase());
    if (parsed.protocol === 'http:' && !loopback) fail('canary_input_invalid');
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError) throw error;
    fail('canary_input_invalid');
  }
  return Object.freeze({
    base_url: baseUrl,
    credential: text(descriptors.credential.value),
    max_tokens: optionalNumber(descriptors.max_tokens.value, 256, 65_536),
    model: text(descriptors.model.value),
    temperature: optionalNumber(descriptors.temperature.value, 0, 2),
    timeout_ms: integer(descriptors.timeout_ms.value, 1_000, 120_000),
  });
}

function sanitizedExecutablePath(value) {
  const executablePath = value === null
    ? DEFAULT_EXECUTABLE
    : text(value, 2_048);
  if (!isLocalAbsolutePath(executablePath)) fail('canary_input_invalid');
  return executablePath;
}

function isLocalAbsolutePath(value) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.trim() !== value
    || value.includes('\0')
    || !path.isAbsolute(value)
    || path.normalize(value) !== value
    || path.resolve(value) !== value
  ) {
    return false;
  }
  if (process.platform === 'win32') {
    if (/^\\\\/u.test(value)) return false;
    if (!/^[A-Za-z]:\\/u.test(value)) return false;
  }
  return true;
}

function inputDescriptors(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || isObjectProxy(value)) {
    fail('canary_input_invalid');
  }
  let keys;
  let descriptors;
  try {
    keys = Reflect.ownKeys(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    fail('canary_input_invalid');
  }
  const modeDescriptor = descriptors.mode;
  const expectedKeys = modeDescriptor === undefined
    ? FIRST_CONFIG_INPUT_KEYS
    : SAVED_PROFILE_INPUT_KEYS;
  if (
    keys.length !== expectedKeys.length
    || keys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))
  ) fail('canary_input_invalid');
  for (const key of expectedKeys) {
    const descriptor = descriptors[key];
    if (!descriptor || !descriptor.enumerable || 'get' in descriptor || 'set' in descriptor) {
      fail('canary_input_invalid');
    }
  }
  return Object.freeze({ descriptors, mode: modeDescriptor === undefined ? 'first_config' : modeDescriptor.value });
}

function sanitizeInput(value) {
  const { descriptors, mode } = inputDescriptors(value);
  if (descriptors.schema_version.value !== CANARY_INPUT_VERSION) fail('canary_input_invalid');
  const executablePath = sanitizedExecutablePath(descriptors.executable_path.value);
  if (mode === 'saved_profile') {
    const sourceUserDataPath = text(descriptors.source_user_data_path.value, 2_048);
    if (!isLocalAbsolutePath(sourceUserDataPath)) fail('canary_input_invalid');
    return Object.freeze({
      executable_path: executablePath,
      idea: text(descriptors.idea.value, 4_000),
      mode: 'saved_profile',
      schema_version: CANARY_INPUT_VERSION,
      source_user_data_path: sourceUserDataPath,
    });
  }
  if (mode !== 'first_config') fail('canary_input_invalid');
  return Object.freeze({
    executable_path: executablePath,
    idea: text(descriptors.idea.value, 4_000),
    provider: sanitizeProvider(descriptors.provider.value),
    schema_version: CANARY_INPUT_VERSION,
  });
}

function parseCanaryInput(source) {
  try {
    return sanitizeInput(JSON.parse(source));
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError) throw error;
    fail('canary_input_invalid');
  }
}

function ensureCredentialOnlyFromStdin(credential, argv, env) {
  if (argv.some((entry) => typeof entry === 'string' && entry.includes(credential))) {
    fail('canary_secret_source_invalid');
  }
  if (isObjectProxy(env)) fail('canary_secret_source_invalid');
  let descriptors;
  try {
    descriptors = Object.getOwnPropertyDescriptors(env);
  } catch {
    fail('canary_secret_source_invalid');
  }
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== 'string') continue;
    const descriptor = descriptors[key];
    if (!descriptor || 'get' in descriptor || 'set' in descriptor || typeof descriptor.value !== 'string') {
      continue;
    }
    if (descriptor.value.includes(credential)) fail('canary_secret_source_invalid');
  }
}

function redactInput(input) {
  const credentialSource = input.mode === 'saved_profile' ? 'saved_profile' : 'stdin';
  return Object.freeze({
    credential_source: credentialSource,
    idea_digest: digestText(input.idea),
    initial_chat_question_digest: digestText(CANARY_INITIAL_CHAT_QUESTION),
    question_digest: digestText(CANARY_QUESTION),
    restart_continuation_instruction_digest: digestText(CANARY_RESTART_CONTINUATION_INSTRUCTION),
    schema_version: input.schema_version,
    update_instruction_digest: digestText(CANARY_UPDATE_INSTRUCTION),
  });
}

function digestText(value) {
  return `sha256:${nodeCrypto.createHash('sha256').update(value).digest('hex')}`;
}

function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number' && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  if (value !== null && typeof value === 'object' && !isObjectProxy(value)) {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) fail('canary_evidence_failed');
    return `{${Object.keys(value).sort().map(
      (key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`,
    ).join(',')}}`;
  }
  fail('canary_evidence_failed');
}

function digestCanonical(value) {
  return `sha256:${nodeCrypto.createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')}`;
}

function hasUnpairedSurrogate(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function hasUnsafeControl(value, allowFormatting = false) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0x7f && code <= 0x9f) return true;
    if (code <= 0x1f && (!allowFormatting || ![0x09, 0x0a, 0x0d].includes(code))) return true;
  }
  return false;
}

function evidenceText(value, maximumCodePoints, maximumUtf8Bytes, allowEmpty = false, allowFormatting = false) {
  if (
    typeof value !== 'string'
    || (!allowEmpty && value.length === 0)
    || value.length > maximumCodePoints * 2
    || Array.from(value).length > maximumCodePoints
    || Buffer.byteLength(value, 'utf8') > maximumUtf8Bytes
    || hasUnpairedSurrogate(value)
    || hasUnsafeControl(value, allowFormatting)
  ) fail('canary_evidence_failed');
  return value;
}

function safeDigest(value) {
  if (typeof value !== 'string' || !DIGEST_PATTERN.test(value)) fail('canary_evidence_failed');
  return value;
}

function safeOid(value, nullable = false) {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || !GIT_OID_PATTERN.test(value)) fail('canary_evidence_failed');
  return value;
}

function safePositiveInteger(value) {
  if (!Number.isSafeInteger(value) || value < 1) fail('canary_evidence_failed');
  return value;
}

function safeNonNegativeInteger(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail('canary_evidence_failed');
  return value;
}

function safeBuilderId(value, kind) {
  const pattern = BUILDER_ID_PATTERNS[kind];
  if (typeof value !== 'string' || !pattern || !pattern.test(value)) fail('canary_evidence_failed');
  return value;
}

function safeDraftId(value) {
  if (typeof value !== 'string' || !DRAFT_ID_PATTERN.test(value)) fail('canary_evidence_failed');
  return value;
}

function denseEvidenceArray(value, maximum) {
  if (
    !Array.isArray(value)
    || isObjectProxy(value)
    || Object.getPrototypeOf(value) !== Array.prototype
    || value.length > maximum
  ) fail('canary_evidence_failed');
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== value.length + 1
    || keys.some((key) => typeof key === 'symbol')
    || !keys.includes('length')
  ) fail('canary_evidence_failed');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const output = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      fail('canary_evidence_failed');
    }
    output.push(descriptor.value);
  }
  return output;
}

function cssString(value) {
  return String(value).replace(/["\\\n\r\f]/gu, (character) => {
    if (character === '"') return '\\"';
    if (character === '\\') return '\\\\';
    if (character === '\n') return '\\a ';
    if (character === '\r') return '\\d ';
    return '\\c ';
  });
}

function attributeEqualsSelector(attributeName, value) {
  if (typeof attributeName !== 'string' || !CSS_IDENTIFIER_PATTERN.test(attributeName)) {
    fail('canary_evidence_failed');
  }
  return `[${attributeName}="${cssString(value)}"]`;
}

function createArtifactGate() {
  let allowed = false;
  return Object.freeze({
    allow() { allowed = true; },
    assertAllowed() {
      if (!allowed) fail('canary_secret_source_invalid');
    },
    get allowed() { return allowed; },
  });
}

function samePath(left, right) {
  return process.platform === 'win32'
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

function pathIdentity(stat) {
  const dev = typeof stat.dev === 'bigint' || Number.isSafeInteger(stat.dev) ? stat.dev : null;
  const ino = typeof stat.ino === 'bigint' || Number.isSafeInteger(stat.ino) ? stat.ino : null;
  return Object.freeze({
    dev,
    ino,
  });
}

function guardedUserDataError() {
  throw new BuilderPackagedCanaryError('canary_cleanup_failed');
}

function lstatDirectory(fsModule, directoryPath) {
  let stat;
  try {
    stat = fsModule.lstatSync(directoryPath, { bigint: true });
  } catch {
    guardedUserDataError();
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) guardedUserDataError();
  return stat;
}

function realpath(fsModule, directoryPath) {
  try {
    return path.resolve(fsModule.realpathSync.native(directoryPath));
  } catch {
    guardedUserDataError();
  }
}

function captureGuardedUserDataRoot(rootPath, fsModule = fs, osModule = os) {
  if (
    typeof rootPath !== 'string'
    || rootPath.length === 0
    || rootPath.trim() !== rootPath
    || rootPath.includes('\0')
    || !path.isAbsolute(rootPath)
    || path.normalize(rootPath) !== rootPath
    || path.resolve(rootPath) !== rootPath
  ) guardedUserDataError();
  const tempRoot = path.resolve(osModule.tmpdir());
  const basename = path.basename(rootPath);
  if (path.dirname(rootPath) !== tempRoot || !basename.startsWith(PACKAGED_CANARY_USER_DATA_PREFIX)) {
    guardedUserDataError();
  }
  const tempStat = lstatDirectory(fsModule, tempRoot);
  void tempStat;
  const tempRealPath = realpath(fsModule, tempRoot);
  const rootStat = lstatDirectory(fsModule, rootPath);
  const rootRealPath = realpath(fsModule, rootPath);
  if (!samePath(path.dirname(rootRealPath), tempRealPath) || path.basename(rootRealPath) !== basename) {
    guardedUserDataError();
  }
  return Object.freeze({
    basename,
    identity: pathIdentity(rootStat),
    path: rootPath,
    realPath: rootRealPath,
  });
}

function reverifyGuardedUserDataRoot(rootIdentity, fsModule = fs, osModule = os) {
  const current = captureGuardedUserDataRoot(rootIdentity.path, fsModule, osModule);
  if (!samePath(current.realPath, rootIdentity.realPath)) guardedUserDataError();
  for (const key of ['dev', 'ino']) {
    if (
      rootIdentity.identity[key] !== null
      && current.identity[key] !== null
      && rootIdentity.identity[key] !== current.identity[key]
    ) guardedUserDataError();
  }
  return current;
}

function savedProfileError() {
  throw new BuilderPackagedCanaryError('canary_saved_profile_failed');
}

function normalizedFileStat(stat, maximumBytes) {
  const size = stat.size;
  if (typeof size !== 'bigint' && !Number.isSafeInteger(size)) savedProfileError();
  const normalizedSize = typeof size === 'bigint' ? size : BigInt(size);
  if (normalizedSize < 0n || normalizedSize > BigInt(maximumBytes)) savedProfileError();
  return Object.freeze({
    dev: typeof stat.dev === 'bigint' || Number.isSafeInteger(stat.dev) ? stat.dev : null,
    ino: typeof stat.ino === 'bigint' || Number.isSafeInteger(stat.ino) ? stat.ino : null,
    mtimeMs: (
      (typeof stat.mtimeMs === 'bigint')
      || (typeof stat.mtimeMs === 'number' && Number.isFinite(stat.mtimeMs))
    ) ? stat.mtimeMs : null,
    size: normalizedSize,
  });
}

function sourceProfileFileStat(fsModule, filePath, maximumBytes, options = {}) {
  let stat;
  try {
    stat = fsModule.lstatSync(filePath, { bigint: true });
  } catch {
    savedProfileError();
  }
  if (!stat.isFile() || stat.isSymbolicLink()) savedProfileError();
  const before = normalizedFileStat(stat, maximumBytes);
  let fd = null;
  try {
    fd = fsModule.openSync(filePath, 'r');
    const opened = normalizedFileStat(fsModule.fstatSync(fd, { bigint: true }), maximumBytes);
    compareSourceFileStat(before, opened);
    const buffer = readBoundedDescriptor(fsModule, fd, maximumBytes);
    const after = normalizedFileStat(fsModule.fstatSync(fd, { bigint: true }), maximumBytes);
    compareSourceFileStat(opened, after);
    if (BigInt(buffer.length) !== after.size) savedProfileError();
    const snapshot = {
      ...after,
      sha256: nodeCrypto.createHash('sha256').update(buffer).digest('hex'),
    };
    if (options.includeBuffer === true) snapshot.buffer = buffer;
    return Object.freeze(snapshot);
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError) throw error;
    savedProfileError();
  } finally {
    if (fd !== null) {
      try {
        fsModule.closeSync(fd);
      } catch {
        savedProfileError();
      }
    }
  }
}

function readBoundedDescriptor(fsModule, fd, maximumBytes) {
  const chunks = [];
  let total = 0;
  const chunkSize = Math.max(1, Math.min(64 * 1024, maximumBytes + 1));
  const buffer = Buffer.alloc(chunkSize);
  while (total <= maximumBytes) {
    const remaining = maximumBytes + 1 - total;
    const bytesRead = fsModule.readSync(fd, buffer, 0, Math.min(buffer.length, remaining), null);
    if (!Number.isSafeInteger(bytesRead) || bytesRead < 0) savedProfileError();
    if (bytesRead === 0) break;
    chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
    total += bytesRead;
  }
  if (total > maximumBytes) savedProfileError();
  return Buffer.concat(chunks, total);
}

function compareSourceFileStat(left, right) {
  if (left.size !== right.size) savedProfileError();
  if (left.sha256 !== undefined && right.sha256 !== undefined && left.sha256 !== right.sha256) {
    savedProfileError();
  }
  for (const key of ['dev', 'ino', 'mtimeMs']) {
    if (left[key] !== null && right[key] !== null && left[key] !== right[key]) savedProfileError();
  }
}

function captureSourceUserDataRoot(sourcePath, fsModule) {
  if (!isLocalAbsolutePath(sourcePath)) savedProfileError();
  return captureSourceDirectory(fsModule, sourcePath);
}

function captureSourceDirectory(fsModule, directoryPath) {
  let stat;
  let realPath;
  try {
    stat = fsModule.lstatSync(directoryPath, { bigint: true });
    realPath = path.resolve(fsModule.realpathSync.native(directoryPath));
  } catch {
    savedProfileError();
  }
  if (!stat.isDirectory() || stat.isSymbolicLink() || !samePath(realPath, directoryPath)) savedProfileError();
  return Object.freeze({
    identity: pathIdentity(stat),
    path: directoryPath,
    realPath,
  });
}

function compareSourceDirectoryIdentity(left, right) {
  if (!samePath(left.path, right.path) || !samePath(left.realPath, right.realPath)) savedProfileError();
  for (const key of ['dev', 'ino']) {
    if (left.identity[key] !== null && right.identity[key] !== null && left.identity[key] !== right.identity[key]) {
      savedProfileError();
    }
  }
}

function captureTargetProfileDirectories(
  userDataRoot,
  configDirectory,
  secretsDirectory,
  sessionDataDirectory,
  fsModule,
) {
  const root = captureSourceDirectory(fsModule, userDataRoot.realPath);
  if (!samePath(root.realPath, userDataRoot.realPath)) savedProfileError();
  for (const key of ['dev', 'ino']) {
    if (
      userDataRoot.identity[key] !== null
      && root.identity[key] !== null
      && userDataRoot.identity[key] !== root.identity[key]
    ) savedProfileError();
  }
  return Object.freeze({
    config: captureSourceDirectory(fsModule, configDirectory),
    root,
    secrets: captureSourceDirectory(fsModule, secretsDirectory),
    sessionData: captureSourceDirectory(fsModule, sessionDataDirectory),
  });
}

function assertTargetProfileDirectoriesUnchanged(snapshot, fsModule) {
  compareSourceDirectoryIdentity(snapshot.root, captureSourceDirectory(fsModule, snapshot.root.path));
  compareSourceDirectoryIdentity(snapshot.config, captureSourceDirectory(fsModule, snapshot.config.path));
  compareSourceDirectoryIdentity(snapshot.secrets, captureSourceDirectory(fsModule, snapshot.secrets.path));
  compareSourceDirectoryIdentity(
    snapshot.sessionData,
    captureSourceDirectory(fsModule, snapshot.sessionData.path),
  );
}

function assertTargetProfileWriteDirectory(snapshot, directoryKey, fsModule) {
  compareSourceDirectoryIdentity(snapshot.root, captureSourceDirectory(fsModule, snapshot.root.path));
  compareSourceDirectoryIdentity(snapshot[directoryKey], captureSourceDirectory(fsModule, snapshot[directoryKey].path));
}

function readExactDirectoryNames(fsModule, directoryPath, expectedNames, code = 'canary_saved_profile_failed') {
  let entries;
  try {
    entries = fsModule.readdirSync(directoryPath, { withFileTypes: true });
  } catch {
    fail(code);
  }
  if (!Array.isArray(entries)) fail(code);
  const names = entries.map((entry) => {
    if (
      entry === null
      || typeof entry !== 'object'
      || isObjectProxy(entry)
    ) fail(code);
    const descriptor = Object.getOwnPropertyDescriptor(entry, 'name');
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'string') fail(code);
    return descriptor.value;
  });
  if (
    names.length !== expectedNames.length
    || names.some((name) => !expectedNames.includes(name))
  ) fail(code);
  return Object.freeze(names);
}

function readSecretDirectoryNames(fsModule, directoryPath) {
  let entries;
  try {
    entries = fsModule.readdirSync(directoryPath, { withFileTypes: true });
  } catch {
    savedProfileError();
  }
  if (!Array.isArray(entries) || entries.length === 0 || entries.length > PROVIDER_SECRET_MAX_FILES) {
    savedProfileError();
  }
  const names = [];
  for (const entry of entries) {
    if (entry === null || typeof entry !== 'object' || isObjectProxy(entry)) savedProfileError();
    const nameDescriptor = Object.getOwnPropertyDescriptor(entry, 'name');
    if (!nameDescriptor || !Object.hasOwn(nameDescriptor, 'value') || typeof nameDescriptor.value !== 'string') {
      savedProfileError();
    }
    const name = nameDescriptor.value;
    if (!PROVIDER_SECRET_FILE_PATTERN.test(name)) savedProfileError();
    let isFile = false;
    try {
      isFile = typeof entry.isFile === 'function' ? Reflect.apply(entry.isFile, entry, []) : false;
    } catch {
      savedProfileError();
    }
    if (isFile !== true) savedProfileError();
    names.push(name);
  }
  names.sort();
  if (new Set(names).size !== names.length) savedProfileError();
  return Object.freeze(names);
}

function makeDirectory(fsModule, directoryPath) {
  try {
    fsModule.mkdirSync(directoryPath);
  } catch {
    savedProfileError();
  }
}

function writeExclusiveProfileFile(
  fsModule,
  targetPath,
  buffer,
  maximumBytes,
  expectedSha256,
  targetDirectories,
  directoryKey,
) {
  if (!Buffer.isBuffer(buffer) || buffer.length > maximumBytes) savedProfileError();
  let fd = null;
  try {
    assertTargetProfileWriteDirectory(targetDirectories, directoryKey, fsModule);
    fd = fsModule.openSync(targetPath, 'wx');
    let written = 0;
    while (written < buffer.length) {
      const bytesWritten = fsModule.writeSync(fd, buffer, written, buffer.length - written, written);
      if (!Number.isSafeInteger(bytesWritten) || bytesWritten <= 0) savedProfileError();
      written += bytesWritten;
    }
    fsModule.fsyncSync(fd);
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError) throw error;
    savedProfileError();
  } finally {
    if (fd !== null) {
      try {
        fsModule.closeSync(fd);
      } catch {
        savedProfileError();
      }
    }
  }
  assertTargetProfileWriteDirectory(targetDirectories, directoryKey, fsModule);
  const copied = sourceProfileFileStat(fsModule, targetPath, maximumBytes);
  if (copied.sha256 !== expectedSha256) savedProfileError();
  assertTargetProfileWriteDirectory(targetDirectories, directoryKey, fsModule);
  return copied;
}

function copyProfileFile(fsModule, sourcePath, targetPath, maximumBytes, targetDirectories, directoryKey) {
  assertTargetProfileWriteDirectory(targetDirectories, directoryKey, fsModule);
  const before = sourceProfileFileStat(fsModule, sourcePath, maximumBytes, { includeBuffer: true });
  writeExclusiveProfileFile(
    fsModule,
    targetPath,
    before.buffer,
    maximumBytes,
    before.sha256,
    targetDirectories,
    directoryKey,
  );
  assertTargetProfileWriteDirectory(targetDirectories, directoryKey, fsModule);
  const after = sourceProfileFileStat(fsModule, sourcePath, maximumBytes);
  compareSourceFileStat(before, after);
  return before;
}

function captureSavedProfileSnapshot(sourceRoot, fsModule) {
  const configDirectory = path.join(sourceRoot.path, PROVIDER_CONFIG_DIRECTORY_NAME);
  const secretsDirectory = path.join(sourceRoot.path, PROVIDER_SECRETS_DIRECTORY_NAME);
  const directories = Object.freeze({
    config: captureSourceDirectory(fsModule, configDirectory),
    root: captureSourceDirectory(fsModule, sourceRoot.path),
    secrets: captureSourceDirectory(fsModule, secretsDirectory),
  });
  readExactDirectoryNames(fsModule, configDirectory, [PROVIDER_CONFIG_CURRENT_FILE_NAME]);
  const secretNames = readSecretDirectoryNames(fsModule, secretsDirectory);
  const files = new Map();
  files.set(
    LOCAL_STATE_FILE_NAME,
    sourceProfileFileStat(fsModule, path.join(sourceRoot.path, LOCAL_STATE_FILE_NAME), LOCAL_STATE_MAX_BYTES),
  );
  files.set(
    `${PROVIDER_CONFIG_DIRECTORY_NAME}/${PROVIDER_CONFIG_CURRENT_FILE_NAME}`,
    sourceProfileFileStat(
      fsModule,
      path.join(configDirectory, PROVIDER_CONFIG_CURRENT_FILE_NAME),
      PROVIDER_CONFIG_MAX_BYTES,
    ),
  );
  for (const name of secretNames) {
    files.set(
      `${PROVIDER_SECRETS_DIRECTORY_NAME}/${name}`,
      sourceProfileFileStat(fsModule, path.join(secretsDirectory, name), PROVIDER_SECRET_MAX_BYTES),
    );
  }
  return Object.freeze({ directories, files, secretNames });
}

function assertSavedProfileUnchanged(snapshot, sourceRoot, fsModule) {
  const current = captureSavedProfileSnapshot(sourceRoot, fsModule);
  compareSourceDirectoryIdentity(snapshot.directories.root, current.directories.root);
  compareSourceDirectoryIdentity(snapshot.directories.config, current.directories.config);
  compareSourceDirectoryIdentity(snapshot.directories.secrets, current.directories.secrets);
  if (current.files.size !== snapshot.files.size) savedProfileError();
  for (const [name, before] of snapshot.files) {
    const after = current.files.get(name);
    if (!after) savedProfileError();
    compareSourceFileStat(before, after);
  }
}

function copySavedProviderProfile(input, userDataRoot, fsModule = fs) {
  if (input.mode !== 'saved_profile') return null;
  const sourceRoot = captureSourceUserDataRoot(input.source_user_data_path, fsModule);
  const snapshot = captureSavedProfileSnapshot(sourceRoot, fsModule);
  const targetConfigDirectory = path.join(userDataRoot.realPath, PROVIDER_CONFIG_DIRECTORY_NAME);
  const targetSecretsDirectory = path.join(userDataRoot.realPath, PROVIDER_SECRETS_DIRECTORY_NAME);
  const targetSessionDataDirectory = path.join(userDataRoot.realPath, SESSION_DATA_DIRECTORY_NAME);
  makeDirectory(fsModule, targetConfigDirectory);
  makeDirectory(fsModule, targetSecretsDirectory);
  makeDirectory(fsModule, targetSessionDataDirectory);
  const targetDirectories = captureTargetProfileDirectories(
    userDataRoot,
    targetConfigDirectory,
    targetSecretsDirectory,
    targetSessionDataDirectory,
    fsModule,
  );
  copyProfileFile(
    fsModule,
    path.join(sourceRoot.path, LOCAL_STATE_FILE_NAME),
    path.join(userDataRoot.realPath, LOCAL_STATE_FILE_NAME),
    LOCAL_STATE_MAX_BYTES,
    targetDirectories,
    'root',
  );
  copyProfileFile(
    fsModule,
    path.join(sourceRoot.path, LOCAL_STATE_FILE_NAME),
    path.join(targetSessionDataDirectory, LOCAL_STATE_FILE_NAME),
    LOCAL_STATE_MAX_BYTES,
    targetDirectories,
    'sessionData',
  );
  copyProfileFile(
    fsModule,
    path.join(sourceRoot.path, PROVIDER_CONFIG_DIRECTORY_NAME, PROVIDER_CONFIG_CURRENT_FILE_NAME),
    path.join(targetConfigDirectory, PROVIDER_CONFIG_CURRENT_FILE_NAME),
    PROVIDER_CONFIG_MAX_BYTES,
    targetDirectories,
    'config',
  );
  for (const name of snapshot.secretNames) {
    copyProfileFile(
      fsModule,
      path.join(sourceRoot.path, PROVIDER_SECRETS_DIRECTORY_NAME, name),
      path.join(targetSecretsDirectory, name),
      PROVIDER_SECRET_MAX_BYTES,
      targetDirectories,
      'secrets',
    );
  }
  assertTargetProfileDirectoriesUnchanged(targetDirectories, fsModule);
  return Object.freeze({ sourceRoot, snapshot });
}

function sanitizeLaunchEnvironment(sourceEnv, userDataPath, projectRootPath) {
  const output = {};
  let descriptors;
  try {
    if (isObjectProxy(sourceEnv)) fail('canary_launch_failed');
    descriptors = Object.getOwnPropertyDescriptors(sourceEnv);
  } catch {
    fail('canary_launch_failed');
  }
  for (const allowedName of WINDOWS_ENV_ALLOWLIST) {
    const descriptorKey = Reflect.ownKeys(descriptors).find((key) => (
      typeof key === 'string'
      && key.toLowerCase() === allowedName.toLowerCase()
    ));
    if (descriptorKey === undefined) continue;
    const descriptor = descriptors[descriptorKey];
    if (
      !descriptor
      || !descriptor.enumerable
      || 'get' in descriptor
      || 'set' in descriptor
      || typeof descriptor.value !== 'string'
      || descriptor.value.includes('\0')
    ) continue;
    output[allowedName] = descriptor.value;
  }
  output[PACKAGED_CANARY_SENTINEL] = '1';
  output[PACKAGED_CANARY_USER_DATA_PATH] = userDataPath;
  output[PACKAGED_CANARY_PROJECT_ROOT_PATH] = projectRootPath;
  return Object.freeze(output);
}

function sanitizeRunOptions(value) {
  if (value === undefined) return Object.freeze({});
  if (value === null || typeof value !== 'object' || Array.isArray(value) || isObjectProxy(value)) {
    fail('canary_launch_failed');
  }
  let keys;
  let descriptors;
  try {
    keys = Reflect.ownKeys(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    fail('canary_launch_failed');
  }
  if (keys.some((key) => typeof key !== 'string' || !RUN_OPTION_KEYS.includes(key))) {
    fail('canary_launch_failed');
  }
  const output = {};
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || !descriptor.enumerable || 'get' in descriptor || 'set' in descriptor) {
      fail('canary_launch_failed');
    }
    output[key] = descriptor.value;
  }
  return Object.freeze(output);
}

async function clickByRole(page, role, name) {
  const locator = page.getByRole(role, { exact: true, name });
  await locator.click();
}

async function clickSaveVersionViaUi(page) {
  const save = page.locator(SELECTORS.saveVersion);
  await save.waitFor({ state: 'visible' });
  if (await optionalLocatorVisible(page, SELECTORS.skipCheck) === true) {
    await page.locator(SELECTORS.skipCheck).click();
    await page.locator(
      `${SELECTORS.checkRunStatus}[data-builder-check-run-status="skipped"]`,
    ).waitFor({ state: 'visible' });
  }
  try {
    const changesOpen = await page.locator(SELECTORS.changesDisclosure).evaluate((node) => node.open === true);
    if (changesOpen) {
      await page.locator(SELECTORS.changesSummaryToggle).click({ timeout: 5000 });
    }
  } catch {
    // Saving remains explicit even when the optional Changes disclosure is not mounted.
  }
  await save.evaluate((node) => {
    if (typeof node.scrollIntoView === 'function') {
      node.scrollIntoView({ block: 'center', inline: 'nearest' });
    }
  });
  await save.click();
}

async function waitForComposerReadyToSend(page) {
  const deadline = Date.now() + 10_000;
  while (Date.now() <= deadline) {
    try {
      const title = await page.locator(SELECTORS.submitTurn).getAttribute('title');
      if (title === null || title === 'Send') return;
    } catch {
      return;
    }
    if (typeof page.waitForTimeout === 'function') {
      await page.waitForTimeout(100);
    } else {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

async function waitForComposerRoute(page, expectedRoute, expectedDispatch) {
  const deadline = Date.now() + 10_000;
  while (Date.now() <= deadline) {
    try {
      const route = await page.locator(SELECTORS.composer).getAttribute('data-builder-route');
      const dispatch = await page.locator(SELECTORS.composer).getAttribute('data-builder-route-dispatch');
      if (route === null && dispatch === null) return;
      if (route === expectedRoute && dispatch === expectedDispatch) return;
    } catch {
      return;
    }
    if (typeof page.waitForTimeout === 'function') {
      await page.waitForTimeout(100);
    } else {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

async function waitForPreviewSurface(page) {
  const staticPreview = page.locator(SELECTORS.preview).waitFor({ state: 'visible' })
    .then(() => 'static_preview', () => 'static_preview_timeout');
  const unavailablePreview = page.locator(SELECTORS.previewUnavailable).waitFor({ state: 'visible' })
    .then(() => 'preview_unavailable', () => 'preview_unavailable_timeout');
  const outcome = await Promise.race([staticPreview, unavailablePreview]);
  if (outcome === 'static_preview' || outcome === 'preview_unavailable') return outcome;
  return 'preview_timeout';
}

async function waitForGenerationTerminal(page) {
  const preview = waitForPreviewSurface(page);
  const alert = page.getByRole('alert').waitFor({ state: 'visible' })
    .then(() => 'alert', () => 'alert_unavailable');
  const outcome = await Promise.race([alert, preview]);
  if (outcome === 'static_preview' || outcome === 'preview_unavailable') return;
  if (outcome === 'alert') {
    failWithDiagnostic(
      'canary_generation_terminal_failed',
      await collectUpdateGenerationFailureDiagnostic(page, 'initial_generation_alert'),
    );
  }
  failWithDiagnostic('canary_preview_failed', await collectPreviewSurfaceDiagnostic(page));
}

async function captureGenerationLiveOutputViaUi(page, failureCode) {
  try {
    const liveOutput = page.locator(SELECTORS.liveOutput);
    await liveOutput.waitFor({ state: 'visible' });
    const text = await liveOutput.textContent();
    if (
      typeof text !== 'string'
      || !/(?:assistant|working|preparing|building|writing|updating|checking|draft|response|request)/iu.test(text)
      || REVIEW_DIFF_INTERNAL_EVIDENCE_PATTERN.test(text)
    ) fail(failureCode);
    return Object.freeze({
      internal_evidence_hidden: true,
      live_output_visible: true,
      user_facing_work_status_visible: true,
    });
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError) throw error;
    fail(failureCode);
  }
}

async function captureGenerationLiveOutputOrDraftReadyViaUi(page, failureCode) {
  try {
    return await captureGenerationLiveOutputViaUi(page, failureCode);
  } catch (error) {
    if (!(error instanceof BuilderPackagedCanaryError) || error.code !== failureCode) throw error;
    if (
      await optionalLocatorVisible(page, SELECTORS.unsavedDraft) === true
      && await optionalLocatorAttribute(page, SELECTORS.projectPage, 'data-builder-project-status') === 'draft_ready'
    ) {
      return Object.freeze({
        draft_ready_before_live_output_capture: true,
        internal_evidence_hidden: true,
        live_output_visible: false,
        user_facing_work_status_visible: true,
      });
    }
    throw error;
  }
}

function planStreamFailureCode(value) {
  try {
    if (value === null || typeof value !== 'object' || utilTypes.isProxy(value)) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (descriptors.diagnostic?.value !== 'stream_summary') return null;
    const failedRun = descriptors.failed_run?.value;
    const toolRequested = descriptors.tool_requested_count?.value;
    const toolSucceeded = descriptors.tool_succeeded_count?.value;
    const toolFailed = descriptors.tool_failed_count?.value;
    if (
      typeof failedRun !== 'boolean'
      || !Number.isSafeInteger(toolRequested)
      || !Number.isSafeInteger(toolSucceeded)
      || !Number.isSafeInteger(toolFailed)
      || toolRequested < 0
      || toolRequested > 16
      || toolSucceeded < 0
      || toolSucceeded > 16
      || toolFailed < 0
      || toolFailed > 16
    ) return null;
    if (!failedRun) return null;
    if (toolFailed > 0) return 'canary_plan_tool_result_failed';
    if (toolSucceeded > 0) return 'canary_plan_after_context_failed';
    if (toolRequested > 0) return 'canary_plan_tool_activity_failed';
    return 'canary_plan_before_context_failed';
  } catch {
    return null;
  }
}

async function collectPlanTaskStreamDiagnostic(page, projectId) {
  if (projectId === null) return null;
  try {
    const summary = await page.evaluate(async (sourceProjectId) => {
      const root = globalThis.window?.clawfabricBuilder;
      const stream = await root?.taskStream?.read?.({ project_id: sourceProjectId });
      const items = stream?.conversation?.items;
      if (!Array.isArray(items)) return { diagnostic: 'stream_unavailable' };
      let firstRecent = Math.max(0, items.length - 12);
      for (let index = items.length - 1; index >= 0; index -= 1) {
        const item = items[index];
        if (item?.item_kind === 'user_message' && item?.message_kind === 'submitted' && item?.mode === 'work') {
          firstRecent = index;
          break;
        }
      }
      let failedRun = false;
      let toolRequestedCount = 0;
      let toolSucceededCount = 0;
      let toolFailedCount = 0;
      for (const item of items.slice(firstRecent)) {
        if (item?.item_kind === 'run_completed' && item?.terminal_status === 'failed') {
          failedRun = true;
        } else if (item?.item_kind === 'tool_call_requested') {
          toolRequestedCount += 1;
        } else if (item?.item_kind === 'tool_call_result_recorded') {
          if (item?.result?.status === 'succeeded') toolSucceededCount += 1;
          else toolFailedCount += 1;
        }
      }
      return {
        diagnostic: 'stream_summary',
        failed_run: failedRun,
        tool_requested_count: toolRequestedCount,
        tool_succeeded_count: toolSucceededCount,
        tool_failed_count: toolFailedCount,
      };
    }, projectId);
    if (
      summary === null
      || typeof summary !== 'object'
      || utilTypes.isProxy(summary)
      || summary.diagnostic !== 'stream_summary'
    ) return null;
    return Object.freeze({
      diagnostic: 'stream_summary',
      failed_run: summary.failed_run === true,
      tool_requested_count: Number.isSafeInteger(summary.tool_requested_count)
        ? summary.tool_requested_count
        : null,
      tool_succeeded_count: Number.isSafeInteger(summary.tool_succeeded_count)
        ? summary.tool_succeeded_count
        : null,
      tool_failed_count: Number.isSafeInteger(summary.tool_failed_count)
        ? summary.tool_failed_count
        : null,
    });
  } catch {
    return null;
  }
}

async function failPlanAlert(page, projectId = null, userDataRoot = null) {
  const streamDiagnostic = await collectPlanTaskStreamDiagnostic(page, projectId);
  const diagnostic = Object.freeze({
    ...(streamDiagnostic ?? Object.freeze({ diagnostic: 'stream_unavailable' })),
    active_notice: await optionalLocatorText(page, '[data-builder-conversation-notice]'),
    active_notice_kind: await optionalLocatorAttribute(
      page,
      '[data-builder-conversation-notice]',
      'data-builder-conversation-notice',
    ),
    composer_route: await optionalLocatorAttribute(page, SELECTORS.composer, 'data-builder-route'),
    composer_dispatch: await optionalLocatorAttribute(page, SELECTORS.composer, 'data-builder-route-dispatch'),
    composer_permission: await optionalLocatorAttribute(page, SELECTORS.composer, 'data-builder-route-permission'),
    composer_signals: await optionalLocatorAttribute(page, SELECTORS.composer, 'data-builder-route-signals'),
    composer_status: await optionalLocatorText(page, SELECTORS.composerStatus),
    composer_text: safeDiagnosticText(await optionalInputValue(page, SELECTORS.idea)),
    plan_source_read_approval_visible: await optionalLocatorVisible(page, SELECTORS.planSourceReadApproval),
    project_status: await optionalLocatorAttribute(page, SELECTORS.projectPage, 'data-builder-project-status'),
    recent_activity: await optionalRecentActivitySummary(page),
    generation_debug: optionalCanaryGenerationDebug(userDataRoot),
  });
  const streamCode = planStreamFailureCode(streamDiagnostic);
  failWithDiagnostic(
    streamCode ?? 'canary_plan_alert_failed',
    diagnostic,
  );
}

async function currentProjectStatus(page) {
  try {
    return await page.locator(SELECTORS.projectPage).getAttribute('data-builder-project-status');
  } catch {
    return null;
  }
}

async function waitForPlanProposalVisible(page, projectId = null, userDataRoot = null) {
  const plan = page.locator(SELECTORS.planReviewActions)
    .waitFor({ state: 'visible', timeout: CANARY_PLAN_PROPOSAL_TIMEOUT_MS })
    .then(() => 'plan', () => 'plan_timeout');
  const failed = page.locator(`${SELECTORS.projectPage}[data-builder-project-status="submit_failed"]`)
    .waitFor({ state: 'visible', timeout: CANARY_PLAN_PROPOSAL_TIMEOUT_MS })
    .then(() => 'failed', () => 'failure_timeout');
  const outcome = await Promise.race([plan, failed]);
  if (outcome === 'plan') return;
  if (outcome === 'failed') await failPlanAlert(page, projectId, userDataRoot);
  if (await currentProjectStatus(page) === 'submit_failed') await failPlanAlert(page, projectId, userDataRoot);
  fail('canary_plan_failed');
}

async function approvePlanSourceReadIfRequested(page) {
  try {
    await page.locator(SELECTORS.planSourceReadApproval).waitFor({
      state: 'visible',
      timeout: CANARY_PLAN_SOURCE_READ_APPROVAL_TIMEOUT_MS,
    });
  } catch {
    return false;
  }

  try {
    await page.locator(SELECTORS.approvePlanSourceRead).click();
    await page.locator(SELECTORS.planSourceReadApproval).waitFor({
      state: 'hidden',
      timeout: CANARY_PLAN_PROPOSAL_TIMEOUT_MS,
    });
    return true;
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError) throw error;
    fail('canary_plan_source_read_approval_failed');
  }
}

async function approveCurrentProjectWriteIfRequested(page) {
  try {
    await page.locator(SELECTORS.currentProjectWriteApproval).waitFor({
      state: 'visible',
      timeout: CANARY_CURRENT_PROJECT_WRITE_APPROVAL_TIMEOUT_MS,
    });
  } catch {
    return false;
  }

  try {
    await page.locator(SELECTORS.approveCurrentProjectWrite).click();
    await page.locator(SELECTORS.currentProjectWriteApproval).waitFor({
      state: 'hidden',
      timeout: CANARY_PLAN_PROPOSAL_TIMEOUT_MS,
    });
    return true;
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError) throw error;
    fail('canary_current_project_write_approval_failed');
  }
}

async function approveProviderContextDisclosureIfRequested(page) {
  const deadline = Date.now() + CANARY_QUESTION_ANSWER_TIMEOUT_MS;
  while (Date.now() <= deadline) {
    try {
      await page.locator(SELECTORS.artifactTabPermissions).click({ timeout: 2_000 });
      await page.locator(SELECTORS.approveProviderContextDisclosure).waitFor({
        state: 'visible',
        timeout: 2_000,
      });
      break;
    } catch {
      if (typeof page.waitForTimeout === 'function') {
        await page.waitForTimeout(250);
      } else {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
  }
  try {
    if (!await page.locator(SELECTORS.approveProviderContextDisclosure).isVisible()) return false;
  } catch {
    return false;
  }

  try {
    await page.locator(SELECTORS.approveProviderContextDisclosure).click();
    await page.locator(SELECTORS.approveProviderContextDisclosure).waitFor({
      state: 'hidden',
      timeout: CANARY_PLAN_PROPOSAL_TIMEOUT_MS,
    });
    return true;
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError) throw error;
    fail('canary_question_failed');
  }
}

async function fillProviderSettingsViaUi(page, provider, gate) {
  try {
    await clickByRole(page, 'button', 'Settings');
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError) throw error;
    fail('canary_settings_navigation_failed');
  }
  try {
    await page.locator(SELECTORS.providerPanel).waitFor({ state: 'visible' });
    await page.locator(SELECTORS.baseUrl).fill(provider.base_url);
    await page.locator(SELECTORS.model).fill(provider.model);
    await page.locator(SELECTORS.apiKey).fill(provider.credential);
    await page.locator(SELECTORS.timeout).fill(String(provider.timeout_ms));
    await page.locator(SELECTORS.temperature).fill(provider.temperature === null ? '' : String(provider.temperature));
    await page.locator(SELECTORS.maxTokens).fill(provider.max_tokens === null ? '' : String(provider.max_tokens));
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError) throw error;
    fail('canary_settings_panel_failed');
  }
  try {
    await clickByRole(page, 'button', 'Save provider');
    await page.getByText('Provider settings saved.').waitFor({ state: 'visible' });
    await page.locator(SELECTORS.apiKey).waitFor({ state: 'visible' });
    const passwordValue = await page.locator(SELECTORS.apiKey).inputValue();
    if (passwordValue !== '') fail('canary_settings_save_failed');
    gate.allow();
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError) throw error;
    fail('canary_settings_save_failed');
  }
  try {
    await clickByRole(page, 'button', 'Back to project');
    await page.locator(SELECTORS.projectPage).waitFor({ state: 'visible' });
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError) throw error;
    fail('canary_settings_return_failed');
  }
}

async function bindNewProjectWorkspaceViaUi(page) {
  try {
    await page.locator(SELECTORS.workspaceChip).click();
    await page.locator(SELECTORS.workspacePicker).waitFor({ state: 'visible' });
    await page.locator(SELECTORS.workspaceNewProject).click();
    await page.locator(SELECTORS.newProjectPanel).waitFor({ state: 'visible' });
    await page.locator(SELECTORS.addSourceFolder).click();
    await page.locator(SELECTORS.workspacePicker).waitFor({ state: 'hidden' });
    await page.locator(`${SELECTORS.projectPage}[data-builder-project-status="ready"]`)
      .waitFor({ state: 'visible', timeout: CANARY_PROJECT_READY_TIMEOUT_MS });
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError) throw error;
    fail('canary_new_project_failed');
  }
}

async function requireBuildWorkspaceBeforeDraftViaUi(page, idea) {
  try {
    await page.locator(SELECTORS.idea).fill(idea);
    await clickByRole(page, 'button', 'Send');
    await page.locator(SELECTORS.workspacePicker).waitFor({ state: 'visible' });
    await page.locator(SELECTORS.unsavedDraft).waitFor({ state: 'hidden' });
    await page.locator(SELECTORS.saveVersion).waitFor({ state: 'hidden' });
    const pickerText = await page.locator(SELECTORS.workspacePicker).textContent();
    const preservedBeforeBinding = await page.locator(SELECTORS.idea).inputValue();
    const newProjectPanelAlreadyVisible = await page.locator(SELECTORS.newProjectPanel).isVisible();
    if (
      typeof pickerText !== 'string'
      || (
        !newProjectPanelAlreadyVisible
        && (
          !pickerText.includes('Choose or create a project before I build.')
          || !pickerText.includes('New project')
        )
      )
      || preservedBeforeBinding !== idea
      || REVIEW_DIFF_INTERNAL_EVIDENCE_PATTERN.test(pickerText)
    ) fail('canary_build_workspace_required_failed');

    if (!newProjectPanelAlreadyVisible) {
      await page.locator(SELECTORS.workspaceNewProject).click();
      await page.locator(SELECTORS.newProjectPanel).waitFor({ state: 'visible' });
    }
    const newProjectText = await page.locator(SELECTORS.newProjectPanel).textContent();
    if (
      typeof newProjectText !== 'string'
      || !newProjectText.includes('Project name')
      || !newProjectText.includes('Source folders')
      || !newProjectText.includes('Add source folder')
      || REVIEW_DIFF_INTERNAL_EVIDENCE_PATTERN.test(newProjectText)
    ) fail('canary_build_workspace_required_failed');

    await page.locator(SELECTORS.addSourceFolder).click();
    await page.locator(SELECTORS.workspacePicker).waitFor({ state: 'hidden' });
    return Object.freeze({
      build_without_workspace_blocked: true,
      build_continued_after_workspace_bound: true,
      composer_text_preserved_until_workspace_bound: true,
      source_folder_required: true,
      workspace_picker_visible: true,
    });
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError) throw error;
    fail('canary_build_workspace_required_failed');
  }
}

async function generateProjectViaUi(page, idea) {
  let checkRun = null;
  let draftReviewDiff = null;
  let liveOutput = null;
  let workspaceGate = null;
  try {
    await clickByRole(page, 'button', 'New project');
    await page.locator(SELECTORS.projectPage).waitFor({ state: 'visible' });
    workspaceGate = await requireBuildWorkspaceBeforeDraftViaUi(page, idea);
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError) throw error;
    fail('canary_new_project_failed');
  }
  try {
    await approveCurrentProjectWriteIfRequested(page);
    liveOutput = await captureGenerationLiveOutputViaUi(page, 'canary_generation_terminal_failed');
    await waitForGenerationTerminal(page);
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError) throw error;
    fail('canary_generation_terminal_failed');
  }
  try {
    await page.locator(SELECTORS.unsavedDraft)
      .getByText('Unsaved draft', { exact: true })
      .waitFor({ state: 'visible' });
    checkRun = await waitForAutomaticProjectCheckViaUi(page);
    draftReviewDiff = await inspectDraftReviewDiffViaUi(page);
    await page.locator(SELECTORS.saveVersion).waitFor({ state: 'visible' });
    const preSave = await readSanitizedBridgeEvidence(page);
    if (preSave.catalog.projects.length !== 0 || preSave.current !== null) {
      failWithDiagnostic(
        'canary_draft_failed',
        await collectInitialDraftFailureDiagnostic(page, 'pre_save_evidence_not_empty'),
      );
    }
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError) throw error;
    failWithDiagnostic(
      'canary_draft_failed',
      await collectInitialDraftFailureDiagnostic(page, 'draft_evidence_step_failed'),
    );
  }
  try {
    await clickSaveVersionViaUi(page);
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError) throw error;
    fail('canary_save_failed');
  }
  try {
    await page.locator(SELECTORS.unsavedDraft).waitFor({ state: 'hidden' });
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError) throw error;
    try {
      const evidence = await readSanitizedBridgeEvidence(page);
      if (evidence.catalog.projects.length === 0) fail('canary_save_persistence_failed');
      fail('canary_save_confirmation_failed');
    } catch (evidenceError) {
      if (evidenceError instanceof BuilderPackagedCanaryError) throw evidenceError;
      fail('canary_save_failed');
    }
  }
  await assertVisibleVersion(page, 1);
  return Object.freeze({
    ...(checkRun === null ? {} : { check_run: checkRun }),
    live_output: liveOutput,
    pre_save_catalog_empty: true,
    review_diff: draftReviewDiff,
    saved_via_ui: true,
    unsaved_draft_observed: true,
    workspace_gate: workspaceGate,
  });
}

async function collectInitialDraftFailureDiagnostic(page, failurePoint) {
  const bridgeEvidence = await readOptionalDraftBridgeEvidence(page);
  return Object.freeze({
    diagnostic_version: 'builder-canary-initial-draft-diagnostic.v1',
    failure_point: failurePoint,
    project_status: await optionalLocatorAttribute(page, SELECTORS.projectPage, 'data-builder-project-status'),
    project_error: await optionalLocatorAttribute(page, SELECTORS.projectPage, 'data-builder-project-error'),
    active_notice_kind: await optionalLocatorAttribute(
      page,
      '[data-builder-conversation-notice]',
      'data-builder-conversation-notice',
    ),
    unsaved_draft_visible: await optionalLocatorVisible(page, SELECTORS.unsavedDraft),
    unsaved_draft_text: await optionalLocatorText(page, SELECTORS.unsavedDraft),
    review_visible: await optionalLocatorVisible(page, SELECTORS.reviewCheckpoint),
    review_text: await optionalLocatorText(page, SELECTORS.reviewCheckpoint),
    save_visible: await optionalLocatorVisible(page, SELECTORS.saveVersion),
    save_text: await optionalLocatorText(page, SELECTORS.saveVersion),
    review_more_visible: await optionalLocatorVisible(page, SELECTORS.reviewMore),
    visible_buttons: await readVisibleButtonTexts(page),
    bridge: bridgeEvidence,
  });
}

async function readOptionalDraftBridgeEvidence(page) {
  try {
    const evidence = await readSanitizedBridgeEvidence(page);
    return Object.freeze({
      read_ok: true,
      catalog_count: Array.isArray(evidence.catalog?.projects) ? evidence.catalog.projects.length : null,
      current_state: evidence.current?.state ?? null,
      task_stream_state: evidence.task_stream?.conversation?.state ?? null,
      task_stream_item_count: Array.isArray(evidence.task_stream?.conversation?.items)
        ? evidence.task_stream.conversation.items.length
        : null,
    });
  } catch (error) {
    return Object.freeze({
      read_ok: false,
      error_code: error instanceof BuilderPackagedCanaryError ? error.code : null,
    });
  }
}

async function readVisibleButtonTexts(page) {
  try {
    return await page.evaluate(() => {
      const visible = (element) => {
        if (!(element instanceof globalThis.HTMLElement)) return false;
        const style = globalThis.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.visibility !== 'hidden'
          && style.display !== 'none'
          && rect.width > 0
          && rect.height > 0;
      };
      return Array.from(globalThis.document.querySelectorAll('button'))
        .filter((button) => visible(button))
        .map((button) => button.textContent?.replace(/\s+/gu, ' ').trim() ?? '')
        .filter((text) => text.length > 0)
        .slice(0, 24);
    });
  } catch {
    return Object.freeze([]);
  }
}

async function waitForAutomaticProjectCheckViaUi(page) {
  try {
    await page.locator(
      `${SELECTORS.checkRunStatus}[data-builder-check-run-status="passed"]`,
    ).waitFor({ state: 'visible', timeout: 120_000 });
    return Object.freeze({
      agent_ran_check_automatically: true,
      command_profile_selected_by_main: true,
      packaged_runtime_executed: true,
      status: 'passed',
    });
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError) throw error;
    failWithDiagnostic('canary_check_run_failed', Object.freeze({
      check_operation: await optionalLocatorAttribute(
        page,
        SELECTORS.reviewChecks,
        'data-builder-check-run-operation',
      ),
      check_status: await optionalLocatorAttribute(
        page,
        SELECTORS.checkRunStatus,
        'data-builder-check-run-status',
      ),
      check_status_text: await optionalLocatorText(page, SELECTORS.checkRunStatus),
      bridge_check_run: await readCheckRunFailureDiagnostic(page, null),
    }));
  }
}

async function readCheckRunFailureDiagnostic(page, profileId) {
  try {
    return await page.evaluate(async (request) => {
      const bridge = globalThis.clawfabricBuilder;
      const workspaces = await bridge?.projectWorkspace?.listWorkspaces?.();
      const candidates = Array.isArray(workspaces?.projects) ? workspaces.projects : [];
      const projectId = candidates.find((project) => typeof project?.project_id === 'string')?.project_id ?? null;
      if (projectId === null) {
        return {
          workspace_found: false,
          task_stream_ready: false,
          pending_draft_found: false,
          read_ok: null,
          run_ok: null,
        };
      }
      const stream = await bridge?.taskStream?.read?.({ project_id: projectId });
      const items = Array.isArray(stream?.conversation?.items) ? stream.conversation.items : [];
      const reviewedDraftIds = new Set();
      let draftId = null;
      for (let index = items.length - 1; index >= 0; index -= 1) {
        const item = items[index];
        if (item?.item_kind === 'candidate_reviewed' && typeof item.draft_id === 'string') {
          reviewedDraftIds.add(item.draft_id);
          continue;
        }
        if (
          item?.item_kind === 'run_completed'
          && item?.candidate !== null
          && typeof item?.candidate?.draft_id === 'string'
          && !reviewedDraftIds.has(item.candidate.draft_id)
        ) {
          draftId = item.candidate.draft_id;
          break;
        }
      }
      if (draftId === null) {
        return {
          workspace_found: true,
          task_stream_ready: stream?.conversation?.state === 'ready',
          pending_draft_found: false,
          item_count: items.length,
          read_ok: null,
          run_ok: null,
        };
      }
      let readResponse = null;
      try {
        readResponse = await bridge?.checkRun?.readCurrentDraftAvailableChecks?.({ draft_id: draftId });
      } catch (readError) {
        return {
          workspace_found: true,
          task_stream_ready: stream?.conversation?.state === 'ready',
          pending_draft_found: true,
          read_ok: false,
          read_error_code: readError?.code ?? null,
          run_ok: null,
        };
      }
      const safeProfileId = typeof request.profileId === 'string'
        ? request.profileId
        : readResponse?.result?.available_checks?.[0]?.command_profile_id;
      let runResponse = null;
      try {
        runResponse = await bridge?.checkRun?.approveAndRunCurrentDraftCheck?.({
          draft_id: draftId,
          command_profile_id: safeProfileId,
        });
      } catch (runError) {
        return {
          workspace_found: true,
          task_stream_ready: stream?.conversation?.state === 'ready',
          pending_draft_found: true,
          read_ok: readResponse?.ok ?? null,
          read_result_version: readResponse?.result?.result_version ?? null,
          read_status: readResponse?.result?.status ?? null,
          read_check_count: Array.isArray(readResponse?.result?.available_checks)
            ? readResponse.result.available_checks.length
            : null,
          run_ok: false,
          run_error_code: runError?.code ?? null,
        };
      }
      return {
        workspace_found: true,
        task_stream_ready: stream?.conversation?.state === 'ready',
        pending_draft_found: true,
        read_ok: readResponse?.ok ?? null,
        read_result_version: readResponse?.result?.result_version ?? null,
        read_status: readResponse?.result?.status ?? null,
        read_check_count: Array.isArray(readResponse?.result?.available_checks)
          ? readResponse.result.available_checks.length
          : null,
        run_ok: runResponse?.ok ?? null,
        run_result_version: runResponse?.result?.result_version ?? null,
        run_status: runResponse?.result?.check_run_status_projection?.status ?? null,
        run_error_code: runResponse?.error?.code ?? null,
      };
    }, { profileId });
  } catch {
    return Object.freeze({ diagnostic_unavailable: true });
  }
}

async function boundedBox(locator, code = 'canary_review_diff_box_failed') {
  const box = await locator.boundingBox();
  if (
    box === null
    || typeof box !== 'object'
    || !Number.isFinite(box.x)
    || !Number.isFinite(box.y)
    || !Number.isFinite(box.width)
    || !Number.isFinite(box.height)
    || box.width <= 0
    || box.height <= 0
  ) fail(code);
  return box;
}

function boxRight(box) {
  return box.x + box.width;
}

function boxBottom(box) {
  return box.y + box.height;
}

function boxesOverlap(left, right) {
  return left.x < boxRight(right)
    && boxRight(left) > right.x
    && left.y < boxBottom(right)
    && boxBottom(left) > right.y;
}

function boxContains(container, child) {
  return child.x >= container.x - 1
    && child.y >= container.y - 1
    && boxRight(child) <= boxRight(container) + 1
    && boxBottom(child) <= boxBottom(container) + 1;
}

function boxHorizontallyContains(container, child) {
  return child.x >= container.x - 1
    && boxRight(child) <= boxRight(container) + 1;
}

async function assertConversationActivityBeforeReviewViaUi(page, review) {
  await page.locator(SELECTORS.conversationActivity).waitFor({ state: 'visible' });
  const latestUserMessage = page.locator(SELECTORS.userMessage).last();
  await latestUserMessage.waitFor({ state: 'visible' });
  const activity = await boundedBox(page.locator(SELECTORS.conversationActivity), 'canary_review_diff_activity_failed');
  const userMessage = await boundedBox(latestUserMessage, 'canary_review_diff_activity_failed');
  if (
    activity.width < CANARY_CHAT_COLUMN_MIN_WIDTH_PX
    || userMessage.width < 88
    || activity.y > review.y + 1
    || userMessage.y > review.y + 1
    || boxBottom(activity) > review.y + 1
    || boxBottom(userMessage) > review.y + 1
    || boxesOverlap(activity, review)
    || boxesOverlap(userMessage, review)
  ) fail('canary_review_diff_activity_failed');
}

function draftReviewLayoutFailureCode({
  actionGroup,
  actions,
  copy,
  note,
  review,
  summary,
  title,
}) {
  const reviewChildren = [copy, title, summary, note, actionGroup, ...actions];
  if (review.width < CANARY_CHAT_COLUMN_MIN_WIDTH_PX) return 'canary_review_diff_checkpoint_width_failed';
  if (review.height < 96 || review.height > 420) return 'canary_review_diff_checkpoint_height_failed';
  if (copy.width < CANARY_REVIEW_COPY_MIN_WIDTH_PX) return 'canary_review_diff_checkpoint_copy_width_failed';
  if (
    title.height < 12
    || summary.height < 12
    || note.height < 12
    || actionGroup.height < 28
    || actionGroup.height > 96
    || boxBottom(title) > summary.y + 1
    || boxBottom(summary) > note.y + 1
  ) return 'canary_review_diff_checkpoint_text_stack_failed';
  if (
    actionGroup.y < boxBottom(note) + 4
    || boxesOverlap(title, summary)
    || boxesOverlap(summary, note)
    || boxesOverlap(note, actionGroup)
  ) return 'canary_review_diff_checkpoint_text_stack_failed';
  for (const child of reviewChildren) {
    if (!boxContains(review, child)) return 'canary_review_diff_checkpoint_child_bounds_failed';
  }
  for (const action of actions) {
    if (
      action.width < 28
      || action.height < 28
      || action.height > 48
      || !boxContains(actionGroup, action)
    ) return 'canary_review_diff_checkpoint_action_geometry_failed';
  }
  for (let outer = 0; outer < actions.length; outer += 1) {
    for (let inner = outer + 1; inner < actions.length; inner += 1) {
      if (boxesOverlap(actions[outer], actions[inner])) {
        return 'canary_review_diff_checkpoint_action_overlap_failed';
      }
    }
  }
  return null;
}

function shouldRetryDraftReviewLayoutFailure(code) {
  return code === 'canary_review_diff_checkpoint_child_bounds_failed'
    || code === 'canary_review_diff_checkpoint_text_stack_failed';
}

async function assertDraftReviewLayoutViaUi(page) {
  const code = 'canary_review_diff_checkpoint_layout_failed';
  let lastFailureCode = code;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const reviewLocator = page.locator(SELECTORS.reviewCheckpoint).last();
    const review = await boundedBox(reviewLocator, code);
    const copy = await boundedBox(reviewLocator.locator(SELECTORS.reviewCopy), code);
    const title = await boundedBox(reviewLocator.locator(SELECTORS.reviewTitle), code);
    const summary = await boundedBox(reviewLocator.locator(SELECTORS.reviewSummary), code);
    const note = await boundedBox(reviewLocator.locator(SELECTORS.reviewNote), code);
    const actionGroup = await boundedBox(reviewLocator.locator(SELECTORS.reviewActions), code);
    const actions = [
      await boundedBox(reviewLocator.locator(SELECTORS.reviewMore), code),
      await boundedBox(reviewLocator.locator(SELECTORS.saveVersion), code),
    ];
    const failureCode = draftReviewLayoutFailureCode({
      actionGroup,
      actions,
      copy,
      note,
      review,
      summary,
      title,
    });
    if (failureCode === null) return review;
    lastFailureCode = failureCode;
    if (!shouldRetryDraftReviewLayoutFailure(failureCode)) fail(failureCode);
    if (typeof page.waitForTimeout !== 'function') break;
    await page.waitForTimeout(100);
  }
  fail(lastFailureCode);
}

async function assertDraftArtifactPreviewLayoutViaUi(page, review) {
  let lastFailureCode = 'canary_review_diff_artifact_layout_failed';
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const scroll = await boundedBox(page.locator(SELECTORS.chatScroll), 'canary_review_diff_artifact_chat_geometry_failed');
    const summary = await boundedBox(
      page.locator(SELECTORS.artifactSummary),
      'canary_review_diff_artifact_summary_geometry_failed',
    );
    const sidebar = await boundedBox(
      page.locator(SELECTORS.artifactSidebar),
      'canary_review_diff_artifact_sidebar_geometry_failed',
    );
    const resize = await boundedBox(
      page.locator(SELECTORS.artifactResizeHandle),
      'canary_review_diff_artifact_resize_geometry_failed',
    );
    const result = await boundedBox(
      page.locator(SELECTORS.resultFlow),
      'canary_review_diff_artifact_result_geometry_failed',
    );
    const save = await boundedBox(
      page.locator(SELECTORS.saveVersion),
      'canary_review_diff_artifact_review_bounds_failed',
    );
    const failureCode = draftArtifactPreviewLayoutFailureCode({
      result,
      resize,
      review,
      save,
      scroll,
      sidebar,
      summary,
    });
    if (failureCode === null) return Object.freeze({ result, sidebar, summary });
    lastFailureCode = failureCode;
    if (
      failureCode !== 'canary_review_diff_artifact_summary_order_failed'
      && failureCode !== 'canary_review_diff_artifact_summary_vertical_failed'
    ) {
      failWithDiagnostic(failureCode, Object.freeze({
        review_bottom_overflow_px: Math.max(0, boxBottom(review) - boxBottom(scroll)),
        review_height_px: review.height,
        review_top_offset_px: review.y - scroll.y,
        save_bottom_overflow_px: Math.max(0, boxBottom(save) - boxBottom(scroll)),
        save_top_offset_px: save.y - scroll.y,
        scroll_height_px: scroll.height,
      }));
    }
    if (typeof page.waitForTimeout !== 'function') break;
    await page.waitForTimeout(100);
  }
  fail(lastFailureCode);
}

function draftArtifactPreviewLayoutFailureCode({
  result,
  resize,
  review,
  save,
  scroll,
  sidebar,
  summary,
}) {
  if (scroll.width < CANARY_CHAT_COLUMN_MIN_WIDTH_PX || scroll.height < 360) {
    return 'canary_review_diff_artifact_chat_geometry_failed';
  }
  if (summary.width < 360) return 'canary_review_diff_artifact_summary_width_failed';
  if (summary.x < scroll.x || boxRight(summary) > boxRight(scroll)) {
    return 'canary_review_diff_artifact_summary_horizontal_failed';
  }
  if (summary.height > scroll.height) {
    return 'canary_review_diff_artifact_summary_vertical_failed';
  }
  if (summary.y < boxBottom(review) - 1) return 'canary_review_diff_artifact_summary_order_failed';
  if (sidebar.width < 340 || boxRight(scroll) > sidebar.x + 1) {
    return 'canary_review_diff_artifact_sidebar_geometry_failed';
  }
  if (
    resize.width < 6
    || resize.height < 320
    || resize.x > sidebar.x + 2
    || boxRight(resize) < sidebar.x - 1
    || resize.y > sidebar.y + 1
    || boxBottom(resize) < boxBottom(sidebar) - 1
  ) return 'canary_review_diff_artifact_resize_geometry_failed';
  if (
    result.width < 320
    || !boxContains(sidebar, result)
    || boxContains(scroll, result)
  ) return 'canary_review_diff_artifact_result_geometry_failed';
  if (!boxHorizontallyContains(scroll, review) || !boxHorizontallyContains(scroll, save)) {
    return 'canary_review_diff_artifact_review_bounds_failed';
  }
  if (boxesOverlap(review, result) || boxesOverlap(summary, result)) {
    return 'canary_review_diff_artifact_overlap_failed';
  }
  return null;
}

async function assertChangesPanelLayoutViaUi(page, review, artifact) {
  const code = 'canary_review_diff_changes_layout_failed';
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const scroll = await boundedBox(page.locator(SELECTORS.chatScroll), code);
    const flow = await boundedBox(page.locator(SELECTORS.changesFlow), code);
    const panel = await boundedBox(page.locator(SELECTORS.changesPanel), code);
    const card = await boundedBox(page.locator(SELECTORS.changeCard).first(), code);
    const diff = await boundedBox(page.locator(SELECTORS.changeDiff).first(), code);

    if (
      flow.width >= 320
      && panel.width >= 320
      && flow.height >= 80
      && panel.height >= 80
      && boxContains(artifact.sidebar, flow)
      && boxContains(artifact.sidebar, panel)
      && !boxContains(scroll, panel)
      && !boxesOverlap(review, flow)
      && !boxesOverlap(review, panel)
      && boxContains(flow, panel)
      && boxContains(panel, card)
      && boxContains(card, diff)
      && diff.height >= 24
    ) return;
    if (typeof page.waitForTimeout !== 'function') break;
    await page.waitForTimeout(100);
  }
  fail(code);
}

async function inspectDraftReviewDiffViaUi(page) {
  try {
    const review = page.locator(SELECTORS.reviewCheckpoint);
    await review.waitFor({ state: 'visible' });
    await review.getByText('Review before saving', { exact: true }).waitFor({ state: 'visible' });
    const reviewText = await review.textContent();
    if (
      typeof reviewText !== 'string'
      || !reviewText.includes('Review before saving')
      || !reviewText.includes('file')
      || reviewText.includes('No unsaved changes')
      || REVIEW_DIFF_INTERNAL_EVIDENCE_PATTERN.test(reviewText)
    ) fail('canary_review_diff_text_failed');

    const reviewBox = await assertDraftReviewLayoutViaUi(page);
    await assertConversationActivityBeforeReviewViaUi(page, reviewBox);
    const artifactBox = await assertDraftArtifactPreviewLayoutViaUi(page, reviewBox);
    await page.locator(SELECTORS.workspaceMenuButton).waitFor({ state: 'visible' });
    await page.locator(SELECTORS.workspaceMenuButton).click();
    await page.locator(SELECTORS.workspaceControlChanges).waitFor({ state: 'visible' });
    await page.locator(SELECTORS.workspaceControlChanges).click();
    await page.locator(SELECTORS.changesPanel).waitFor({ state: 'visible' });
    await page.locator(SELECTORS.changeCard).first().waitFor({ state: 'visible' });
    await page.locator(SELECTORS.changeDiff).first().waitFor({ state: 'visible' });
    await page.locator(SELECTORS.changeDiffLine).first().waitFor({ state: 'visible' });
    await assertChangesPanelLayoutViaUi(page, reviewBox, artifactBox);
    const summaryText = await page.locator(SELECTORS.changesSummary).textContent();
    const changesText = await page.locator(SELECTORS.changesPanel).textContent();
    if (
      typeof summaryText !== 'string'
      || typeof changesText !== 'string'
      || !summaryText.includes('file')
      || !changesText.includes('line')
      || changesText.includes('No unsaved changes')
      || REVIEW_DIFF_INTERNAL_EVIDENCE_PATTERN.test(changesText)
    ) fail('canary_review_diff_text_failed');
    return Object.freeze({
      activity_review_do_not_overlap: true,
      artifact_preview_default_visible: true,
      artifact_resize_handle_visible: true,
      artifact_sidebar_visible: true,
      chat_summary_compact_visible: true,
      changes_diff_nested_in_panel: true,
      changes_panel_in_artifact_sidebar: true,
      changes_panel_visible: true,
      completion_landing_review_and_artifact_preview_visible: true,
      inline_diff_visible: true,
      internal_evidence_hidden: true,
      review_actions_layout_stable: true,
      review_changes_do_not_overlap: true,
      review_checkpoint_visible: true,
      review_internal_layout_stable: true,
    });
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError) throw error;
    failWithDiagnostic(
      'canary_review_diff_failed',
      await collectReviewDiffFailureDiagnostic(page),
    );
  }
}

async function collectReviewDiffFailureDiagnostic(page) {
  return Object.freeze({
    diagnostic_version: 'builder-canary-review-diff-diagnostic.v1',
    project_status: await optionalLocatorAttribute(page, SELECTORS.projectPage, 'data-builder-project-status'),
    review_visible: await optionalLocatorVisible(page, SELECTORS.reviewCheckpoint),
    review_text: await optionalLocatorText(page, SELECTORS.reviewCheckpoint),
    review_more_visible: await optionalLocatorVisible(page, SELECTORS.reviewMore),
    save_visible: await optionalLocatorVisible(page, SELECTORS.saveVersion),
    workspace_menu_button_visible: await optionalLocatorVisible(page, SELECTORS.workspaceMenuButton),
    workspace_changes_visible: await optionalLocatorVisible(page, SELECTORS.workspaceControlChanges),
    changes_panel_visible: await optionalLocatorVisible(page, SELECTORS.changesPanel),
    change_card_visible: await optionalLocatorVisible(page, SELECTORS.changeCard),
    change_diff_visible: await optionalLocatorVisible(page, SELECTORS.changeDiff),
    visible_buttons: await readVisibleButtonTexts(page),
  });
}

async function retryFailedDraftViaUi(page, idea, replacementIdea = CANARY_UPDATE_INSTRUCTION) {
  let draftReviewDiff = null;
  try {
    await clickByRole(page, 'button', 'New project');
    await page.locator(SELECTORS.projectPage).waitFor({ state: 'visible' });
    await bindNewProjectWorkspaceViaUi(page);
    await page.locator(SELECTORS.idea).fill(idea);
    await clickByRole(page, 'button', 'Send');
    await page.getByRole('alert').waitFor({ state: 'visible' });
    await page.locator(SELECTORS.retryDraft).waitFor({ state: 'visible' });
    await page.locator(SELECTORS.unsavedDraft).waitFor({ state: 'hidden' });
    await page.locator(SELECTORS.saveVersion).waitFor({ state: 'hidden' });
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError) throw error;
    fail('canary_retry_failed');
  }
  try {
    await page.locator(SELECTORS.idea).fill(replacementIdea);
    await clickByRole(page, 'button', 'Retry');
    await waitForGenerationTerminal(page);
  } catch {
    fail('canary_retry_failed');
  }
  try {
    await page.locator(SELECTORS.unsavedDraft)
      .getByText('Unsaved draft', { exact: true })
      .waitFor({ state: 'visible' });
    await page.locator(SELECTORS.saveVersion).waitFor({ state: 'visible' });
    draftReviewDiff = await inspectDraftReviewDiffViaUi(page);
    const preSave = await readSanitizedBridgeEvidence(page);
    if (preSave.catalog.projects.length !== 0 || preSave.current !== null) {
      fail('canary_retry_failed');
    }
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError) throw error;
    fail('canary_retry_failed');
  }
  return Object.freeze({
    review_diff: draftReviewDiff,
    retry_button_observed: true,
    retry_recovered_draft: true,
    save_remained_explicit: true,
  });
}

async function assertNoQuestionAnswerFailureNotice(page) {
  try {
    if (await page.locator(SELECTORS.questionAnswerFailedNotice).isVisible()) {
      fail('canary_question_failed');
    }
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError) throw error;
    fail('canary_question_failed');
  }
}

async function optionalLocatorCount(page, selector) {
  try {
    return await page.locator(selector).count();
  } catch {
    return null;
  }
}

async function optionalLocatorVisible(page, selector) {
  try {
    return await page.locator(selector).isVisible();
  } catch {
    return null;
  }
}

async function optionalLocatorAttribute(page, selector, attribute) {
  try {
    const value = await page.locator(selector).getAttribute(attribute);
    return typeof value === 'string' ? value : null;
  } catch {
    return null;
  }
}

async function optionalInputValue(page, selector) {
  try {
    const value = await page.locator(selector).inputValue();
    return typeof value === 'string' ? value : null;
  } catch {
    return null;
  }
}

function safeDiagnosticText(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/\s+/gu, ' ').trim();
  if (normalized.length === 0) return '';
  if (REVIEW_DIFF_INTERNAL_EVIDENCE_PATTERN.test(normalized)) return '[redacted-internal-evidence]';
  return normalized.length > 240 ? `${normalized.slice(0, 240)}...` : normalized;
}

async function optionalLocatorText(page, selector) {
  try {
    return safeDiagnosticText(await page.locator(selector).textContent());
  } catch {
    return null;
  }
}

function optionalPageClosed(page) {
  try {
    return typeof page.isClosed === 'function' ? page.isClosed() : null;
  } catch {
    return null;
  }
}

function optionalPageUrl(page) {
  try {
    return typeof page.url === 'function' ? safeDiagnosticText(page.url()) : null;
  } catch {
    return null;
  }
}

async function optionalPageTitle(page) {
  try {
    return safeDiagnosticText(await page.title());
  } catch {
    return null;
  }
}

async function optionalBodyText(page) {
  try {
    return safeDiagnosticText(await page.locator('body').textContent());
  } catch {
    return null;
  }
}

async function collectQuestionFailureDiagnostic(page, outcome, expectedVisibleAnswers) {
  return Object.freeze({
    outcome: typeof outcome === 'string' ? outcome : 'exception',
    expected_visible_answers: expectedVisibleAnswers,
    page_closed: optionalPageClosed(page),
    page_url: optionalPageUrl(page),
    page_title: await optionalPageTitle(page),
    body_text: await optionalBodyText(page),
    visible_answer_count: await optionalLocatorCount(page, SELECTORS.questionAnswer),
    answer_failed_notice_visible: await optionalLocatorVisible(page, SELECTORS.questionAnswerFailedNotice),
    project_status: await optionalLocatorAttribute(page, SELECTORS.projectPage, 'data-builder-project-status'),
    composer_route: await optionalLocatorAttribute(page, SELECTORS.composer, 'data-builder-route'),
    composer_dispatch: await optionalLocatorAttribute(page, SELECTORS.composer, 'data-builder-route-dispatch'),
    submit_visible: await optionalLocatorVisible(page, SELECTORS.submitTurn),
    cancel_visible: await optionalLocatorVisible(page, SELECTORS.cancelWork),
    workspace_picker_visible: await optionalLocatorVisible(page, SELECTORS.workspacePicker),
    unsaved_draft_visible: await optionalLocatorVisible(page, SELECTORS.unsavedDraft),
    save_visible: await optionalLocatorVisible(page, SELECTORS.saveVersion),
    permissions_tab_visible: await optionalLocatorVisible(page, SELECTORS.artifactTabPermissions),
    permissions_panel_visible: await optionalLocatorVisible(page, SELECTORS.artifactPermissions),
    provider_context_status: await optionalLocatorAttribute(
      page,
      SELECTORS.providerContextPermissionRow,
      'data-builder-ai-context-status',
    ),
    provider_context_approval_visible: await optionalLocatorVisible(page, SELECTORS.approveProviderContextDisclosure),
    provider_context_row_text: await optionalLocatorText(page, SELECTORS.providerContextPermissionRow),
    live_output_visible: await optionalLocatorVisible(page, SELECTORS.liveOutput),
    live_output_text: await optionalLocatorText(page, SELECTORS.liveOutput),
    latest_answer_text: await optionalLocatorText(page, SELECTORS.questionAnswer),
    composer_text: safeDiagnosticText(await optionalInputValue(page, SELECTORS.idea)),
  });
}

async function failQuestionWithDiagnostic(page, outcome, expectedVisibleAnswers) {
  failWithDiagnostic(
    'canary_question_failed',
    await collectQuestionFailureDiagnostic(page, outcome, expectedVisibleAnswers),
  );
}

async function optionalTaskStreamFailureSummary(page, projectId) {
  if (typeof projectId !== 'string') return null;
  try {
    return await page.evaluate(async (request) => {
      const stream = await globalThis.clawfabricBuilder.taskStream.read({ project_id: request.projectId });
      const conversation = stream?.conversation ?? null;
      const items = Array.isArray(conversation?.items) ? conversation.items : [];
      const latestRunCompleted = [...items]
        .reverse()
        .find((item) => item?.item_kind === 'run_completed') ?? null;
      const latestTurnCompleted = [...items]
        .reverse()
        .find((item) => item?.item_kind === 'turn_completed') ?? null;
      const counts = conversation?.item_facts?.counts ?? null;
      return {
        head_sequence: conversation?.head_sequence ?? null,
        item_count: conversation?.item_count ?? null,
        run_completed_count: counts?.run_completed_count ?? null,
        turn_completed_count: counts?.turn_completed_count ?? null,
        latest_run_terminal_status: latestRunCompleted?.terminal_status ?? null,
        latest_run_result_kind: latestRunCompleted?.result_kind ?? null,
        latest_run_failure_phase: latestRunCompleted?.failure_phase ?? null,
        latest_turn_outcome: latestTurnCompleted?.outcome ?? null,
      };
    }, { projectId });
  } catch {
    return null;
  }
}

async function optionalRecentActivitySummary(page) {
  try {
    return await page.evaluate(() => {
      const nodes = Array.from(globalThis.document.querySelectorAll('[data-builder-activity-card]'));
      return nodes.slice(-8).map((node) => ({
        card: node.getAttribute('data-builder-activity-card'),
        role: node.getAttribute('data-builder-activity-role'),
        status: node.getAttribute('data-builder-activity-status'),
        text: String(node.textContent ?? '').replace(/\s+/gu, ' ').trim().slice(0, 500),
      }));
    });
  } catch {
    return null;
  }
}

function optionalCanaryGenerationDebug(userDataRoot, fsModule = fs) {
  try {
    if (userDataRoot === null || typeof userDataRoot?.path !== 'string') return null;
    const debugPath = path.join(userDataRoot.path, PACKAGED_CANARY_GENERATION_DEBUG_FILE);
    if (!fsModule.existsSync(debugPath)) return null;
    const text = fsModule.readFileSync(debugPath, 'utf8');
    return text
      .trim()
      .split(/\r?\n/u)
      .filter(Boolean)
      .slice(-12)
      .map((line) => {
        try {
          const parsed = JSON.parse(line);
          return {
            result_version: parsed.result_version,
            phase: parsed.phase,
            code: parsed.code,
          };
        } catch {
          return { result_version: 'builder-canary-generation-debug.v1', phase: 'unreadable', code: 'unknown' };
        }
      });
  } catch {
    return null;
  }
}

async function collectUpdateGenerationFailureDiagnostic(
  page,
  step = 'unknown',
  projectId = null,
  userDataRoot = null,
  fsModule = fs,
) {
  return Object.freeze({
    step,
    page_closed: optionalPageClosed(page),
    page_url: optionalPageUrl(page),
    page_title: await optionalPageTitle(page),
    body_text: await optionalBodyText(page),
    composer_route: await optionalLocatorAttribute(page, SELECTORS.composer, 'data-builder-route'),
    composer_dispatch: await optionalLocatorAttribute(page, SELECTORS.composer, 'data-builder-route-dispatch'),
    composer_permission: await optionalLocatorAttribute(page, SELECTORS.composer, 'data-builder-route-permission'),
    composer_signals: await optionalLocatorAttribute(page, SELECTORS.composer, 'data-builder-route-signals'),
    composer_active_run_input: await optionalLocatorAttribute(
      page,
      SELECTORS.composer,
      'data-builder-route-active-run-input',
    ),
    submit_title: await optionalLocatorAttribute(page, SELECTORS.submitTurn, 'title'),
    submit_disabled: await optionalLocatorAttribute(page, SELECTORS.submitTurn, 'disabled'),
    submit_visible: await optionalLocatorVisible(page, SELECTORS.submitTurn),
    current_project_write_approval_visible: await optionalLocatorVisible(page, SELECTORS.currentProjectWriteApproval),
    current_project_write_approve_visible: await optionalLocatorVisible(page, SELECTORS.approveCurrentProjectWrite),
    live_output_visible: await optionalLocatorVisible(page, SELECTORS.liveOutput),
    live_output_text: await optionalLocatorText(page, SELECTORS.liveOutput),
    preview_visible: await optionalLocatorVisible(page, SELECTORS.preview),
    preview_unavailable_visible: await optionalLocatorVisible(page, SELECTORS.previewUnavailable),
    unsaved_draft_visible: await optionalLocatorVisible(page, SELECTORS.unsavedDraft),
    save_visible: await optionalLocatorVisible(page, SELECTORS.saveVersion),
    composer_text: safeDiagnosticText(await optionalInputValue(page, SELECTORS.idea)),
    project_status: await optionalLocatorAttribute(page, SELECTORS.projectPage, 'data-builder-project-status'),
    project_error: await optionalLocatorAttribute(page, SELECTORS.projectPage, 'data-builder-project-error'),
    active_notice: await optionalLocatorText(page, '[data-builder-conversation-notice]'),
    active_notice_kind: await optionalLocatorAttribute(page, '[data-builder-conversation-notice]', 'data-builder-conversation-notice'),
    recent_activity: await optionalRecentActivitySummary(page),
    task_stream: await optionalTaskStreamFailureSummary(page, projectId),
    generation_debug: optionalCanaryGenerationDebug(userDataRoot, fsModule),
  });
}

async function waitForVisibleQuestionAnswers(page, expectedVisibleAnswers) {
  try {
    await page.locator(SELECTORS.questionAnswer).waitFor({
      state: 'visible',
      timeout: CANARY_QUESTION_ANSWER_TIMEOUT_MS,
    });
  } catch {
    return 'answer_timeout';
  }
  try {
    await page.locator(SELECTORS.questionAnswer).nth(expectedVisibleAnswers - 1).waitFor({
      state: 'visible',
      timeout: CANARY_QUESTION_ANSWER_TIMEOUT_MS,
    });
    return 'answer';
  } catch {
    try {
      if (await page.locator(SELECTORS.questionAnswer).count() >= expectedVisibleAnswers) return 'answer';
    } catch {
      // The fixed timeout outcome below remains authoritative.
    }
  }
  return 'answer_timeout';
}

async function hasEnoughQuestionAnswers(page, expectedVisibleAnswers) {
  try {
    return await page.locator(SELECTORS.questionAnswer).count() >= expectedVisibleAnswers
      && await page.locator(SELECTORS.questionAnswerFailedNotice).isVisible() !== true;
  } catch {
    return false;
  }
}

async function askInitialChatQuestionViaUi(
  page,
  question = CANARY_INITIAL_CHAT_QUESTION,
  expectedVisibleAnswers = 1,
) {
  try {
    await page.locator(SELECTORS.idea).fill(question);
    await clickByRole(page, 'button', 'Send');
    const answer = waitForVisibleQuestionAnswers(page, expectedVisibleAnswers);
    const alert = page.getByRole('alert').waitFor({ state: 'visible' })
      .then(() => 'alert', () => 'alert_unavailable');
    const outcome = await Promise.race([answer, alert]);
    if (outcome !== 'answer' && !await hasEnoughQuestionAnswers(page, expectedVisibleAnswers)) {
      await failQuestionWithDiagnostic(page, outcome, expectedVisibleAnswers);
    }
    await assertNoQuestionAnswerFailureNotice(page);
    const visibleAnswerCount = await page.locator(SELECTORS.questionAnswer).count();
    if (visibleAnswerCount < expectedVisibleAnswers) {
      await failQuestionWithDiagnostic(page, 'answer_count_short', expectedVisibleAnswers);
    }
    await page.locator(SELECTORS.workspacePicker).waitFor({ state: 'hidden' });
    await page.locator(SELECTORS.unsavedDraft).waitFor({ state: 'hidden' });
    await page.locator(SELECTORS.saveVersion).waitFor({ state: 'hidden' });
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError) {
      if (error.code !== 'canary_question_failed' || error.diagnostic !== undefined) throw error;
      await failQuestionWithDiagnostic(page, 'question_failed', expectedVisibleAnswers);
    }
    await failQuestionWithDiagnostic(page, 'exception', expectedVisibleAnswers);
  }
  try {
    const evidence = await readSanitizedBridgeEvidence(page);
    if (
      evidence.catalog.projects.length !== 0
      || evidence.current !== null
      || evidence.task_stream !== null
    ) {
      failWithDiagnostic('canary_question_evidence_failed', {
        catalog_project_count: evidence.catalog.projects.length,
        current_present: evidence.current !== null,
        task_stream_present: evidence.task_stream !== null,
      });
    }
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError) {
      if (error.code === 'canary_question_evidence_failed') throw error;
      failWithDiagnostic('canary_question_evidence_failed', {
        underlying_code: error.code,
        underlying_stage: error.stage,
      });
    }
    fail('canary_question_evidence_failed');
  }
  return Object.freeze({
    answer_failure_notice_absent: true,
    catalog_remained_empty: true,
    no_draft_created: true,
    no_workspace_required: true,
    ui_answer_observed: true,
    visible_answer_count: expectedVisibleAnswers,
  });
}

async function askProjectQuestionViaUi(
  page,
  currentProject,
  question = CANARY_QUESTION,
  expectedCandidateTurns = currentProject.revision_number,
  expectedQuestionTurns = 1,
  expectedVisibleAnswers = expectedQuestionTurns,
) {
  try {
    await page.locator(SELECTORS.idea).fill(question);
    await clickByRole(page, 'button', 'Send');
    const answer = waitForVisibleQuestionAnswers(page, expectedVisibleAnswers);
    const alert = page.getByRole('alert').waitFor({ state: 'visible' })
      .then(() => 'alert', () => 'alert_unavailable');
    const outcome = await Promise.race([answer, alert]);
    if (outcome !== 'answer' && !await hasEnoughQuestionAnswers(page, expectedVisibleAnswers)) {
      if (!await approveProviderContextDisclosureIfRequested(page)) {
        await failQuestionWithDiagnostic(page, outcome, expectedVisibleAnswers);
      }
      await page.locator(SELECTORS.idea).fill(question);
      await clickByRole(page, 'button', 'Send');
      const retryOutcome = await waitForVisibleQuestionAnswers(page, expectedVisibleAnswers);
      if (retryOutcome !== 'answer' && !await hasEnoughQuestionAnswers(page, expectedVisibleAnswers)) {
        await failQuestionWithDiagnostic(page, retryOutcome, expectedVisibleAnswers);
      }
    }
    await assertNoQuestionAnswerFailureNotice(page);
    const visibleAnswerCount = await page.locator(SELECTORS.questionAnswer).count();
    if (visibleAnswerCount < expectedVisibleAnswers) {
      await failQuestionWithDiagnostic(page, 'answer_count_short', expectedVisibleAnswers);
    }
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError) {
      if (error.code !== 'canary_question_failed' || error.diagnostic !== undefined) throw error;
      await failQuestionWithDiagnostic(page, 'question_failed', expectedVisibleAnswers);
    }
    await failQuestionWithDiagnostic(page, 'exception', expectedVisibleAnswers);
  }
  try {
    await page.locator(SELECTORS.saveVersion).waitFor({ state: 'hidden' });
    const evidence = await readSanitizedBridgeEvidence(page, currentProject.project_id);
    assertExactRevision(evidence, currentProject);
    return Object.freeze({
      answer_failure_notice_absent: true,
      saved_revision_unchanged: true,
      task_stream: assertTaskStreamExplanationFacts(
        evidence,
        currentProject,
        expectedCandidateTurns,
        expectedQuestionTurns,
      ),
      ui_answer_observed: true,
      visible_answer_count: expectedVisibleAnswers,
    });
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError) {
      if (error.code === 'canary_question_evidence_failed') throw error;
      fail('canary_question_evidence_failed');
    }
    fail('canary_question_evidence_failed');
  }
}

async function askRejectedPlanContextualSubmitViaUi(
  page,
  currentProject,
  question = '按这个做',
  expectedCandidateTurns = currentProject.revision_number,
  expectedQuestionTurns = 1,
  expectedPlanTurns = 1,
  expectedVisibleAnswers = expectedQuestionTurns,
) {
  try {
    await page.locator(SELECTORS.idea).fill(question);
    await clickByRole(page, 'button', 'Send');
    const answer = waitForVisibleQuestionAnswers(page, expectedVisibleAnswers);
    const alert = page.getByRole('alert').waitFor({ state: 'visible' })
      .then(() => 'alert', () => 'alert_unavailable');
    const outcome = await Promise.race([answer, alert]);
    if (outcome !== 'answer') await failQuestionWithDiagnostic(page, outcome, expectedVisibleAnswers);
    await assertNoQuestionAnswerFailureNotice(page);
    const visibleAnswerCount = await page.locator(SELECTORS.questionAnswer).count();
    if (visibleAnswerCount < expectedVisibleAnswers) {
      await failQuestionWithDiagnostic(page, 'answer_count_short', expectedVisibleAnswers);
    }
    await page.locator(SELECTORS.unsavedDraft).waitFor({ state: 'hidden' });
    await page.locator(SELECTORS.saveVersion).waitFor({ state: 'hidden' });
    await expectComposerStatus(page, 'Direction changed');
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError) {
      if (error.code !== 'canary_question_failed' || error.diagnostic !== undefined) throw error;
      await failQuestionWithDiagnostic(page, 'question_failed', expectedVisibleAnswers);
    }
    await failQuestionWithDiagnostic(page, 'exception', expectedVisibleAnswers);
  }
  try {
    const evidence = await readSanitizedBridgeEvidence(page, currentProject.project_id);
    assertExactRevision(evidence, currentProject);
    return Object.freeze({
      answer_failure_notice_absent: true,
      composer_status_text: await readComposerStatus(page),
      contextual_submit_answered: true,
      saved_revision_unchanged: true,
      task_stream: assertTaskStreamRejectedPlanFacts(
        evidence,
        currentProject,
        expectedCandidateTurns,
        expectedQuestionTurns,
        expectedPlanTurns,
      ),
      unsaved_draft_visible: false,
      visible_answer_count: expectedVisibleAnswers,
    });
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError) {
      if (error.code === 'canary_question_evidence_failed') throw error;
      fail('canary_question_evidence_failed');
    }
    fail('canary_question_evidence_failed');
  }
}

async function createUpdateDraftViaUi(
  page,
  currentProject,
  instruction = CANARY_UPDATE_INSTRUCTION,
  expectedQuestionTurns = 0,
  userDataRoot = null,
  fsModule = fs,
) {
  let draftReviewDiff = null;
  let checkRun = null;
  let liveOutput = null;
  let step = 'start';
  try {
    step = 'wait_ready';
    await waitForComposerReadyToSend(page);
    step = 'fill_instruction';
    await page.locator(SELECTORS.idea).fill(instruction);
    step = 'wait_route';
    await waitForComposerRoute(page, 'build', 'build');
    if (typeof page.waitForTimeout === 'function') {
      await page.waitForTimeout(250);
    } else {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    step = 'submit_instruction';
    await page.locator(SELECTORS.submitTurn).click();
    step = 'approve_write';
    await approveCurrentProjectWriteIfRequested(page);
    step = 'capture_live_output';
    liveOutput = await captureGenerationLiveOutputOrDraftReadyViaUi(page, 'canary_update_generation_terminal_failed');
    step = 'wait_terminal';
    await waitForGenerationTerminal(page);
  } catch {
    await failWithDiagnostic(
      'canary_update_generation_terminal_failed',
      await collectUpdateGenerationFailureDiagnostic(page, step, currentProject.project_id, userDataRoot, fsModule),
    );
  }
  try {
    await page.locator(SELECTORS.unsavedDraft)
      .getByText('Unsaved draft', { exact: true })
      .waitFor({ state: 'visible' });
    checkRun = await waitForAutomaticProjectCheckViaUi(page);
    draftReviewDiff = await inspectDraftReviewDiffViaUi(page);
    await page.locator(SELECTORS.saveVersion).waitFor({ state: 'visible' });
    const preSave = await readSanitizedBridgeEvidence(
      page,
      currentProject.project_id,
      'canary_read_evidence_pending_update_failed',
    );
    assertExactRevision(preSave, currentProject);
    assertTaskStreamPendingCandidateFacts(
      preSave,
      currentProject,
      currentProject.revision_number + 1,
      expectedQuestionTurns,
    );
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError) throw error;
    fail('canary_update_draft_failed');
  }
  return Object.freeze({
    ...(checkRun === null ? {} : { check_run: checkRun }),
    live_output: liveOutput,
    previous_revision_verified_before_save: true,
    review_diff: draftReviewDiff,
    unsaved_draft_observed: true,
  });
}

async function proposePlanViaUi(
  page,
  currentProject,
  instruction = CANARY_RESTART_CONTINUATION_INSTRUCTION,
  expectedCandidateTurns = currentProject.revision_number,
  expectedQuestionTurns = 0,
  expectedPlanTurns = 1,
  userDataRoot = null,
) {
  try {
    await page.locator(SELECTORS.idea).fill(instruction);
    await page.locator(SELECTORS.composerAddMenuButton).click();
    await page.locator(SELECTORS.composerAddPlanMode).click();
    await clickByRole(page, 'button', 'Send');
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError) throw error;
    fail('canary_plan_failed');
  }

  try {
    await approvePlanSourceReadIfRequested(page);
    await waitForPlanProposalVisible(page, currentProject.project_id, userDataRoot);
    await page.locator(SELECTORS.planProposed).waitFor({ state: 'visible' });
    await page.locator(SELECTORS.approvePlan).waitFor({ state: 'visible' });
    await expectComposerStatus(page, 'Needs confirmation');
    await page.locator(SELECTORS.saveVersion).waitFor({ state: 'hidden' });
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError) throw error;
    fail('canary_plan_failed');
  }

  try {
    await page.locator(SELECTORS.toolActivitySucceeded).first().waitFor({ state: 'visible' });
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError) throw error;
    fail('canary_plan_tool_activity_failed');
  }

  try {
    const evidence = await readSanitizedBridgeEvidence(page, currentProject.project_id);
    assertExactRevision(evidence, currentProject);
    return Object.freeze({
      approve_plan_visible: true,
      composer_status_text: await readComposerStatus(page),
      plan_review_actions_visible: true,
      saved_revision_unchanged: true,
      task_stream: assertTaskStreamPlanFacts(
        evidence,
        currentProject,
        expectedCandidateTurns,
        expectedQuestionTurns,
        expectedPlanTurns,
      ),
      tool_activity_visible: true,
    });
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError) throw error;
    fail('canary_plan_evidence_failed');
  }
}

async function readComposerStatus(page) {
  return safeDiagnosticText(await page.locator(SELECTORS.composerStatus).textContent());
}

async function expectComposerStatus(page, expectedText) {
  try {
    await page.locator(SELECTORS.composerStatus).waitFor({ state: 'visible' });
    const statusText = await readComposerStatus(page);
    if (statusText !== expectedText) fail('canary_plan_context_status_failed');
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError) throw error;
    fail('canary_plan_context_status_failed');
  }
}

async function approvePlanViaUi(
  page,
  currentProject,
  expectedCandidateTurns,
  expectedQuestionTurns = 0,
  expectedPlanTurns = 1,
  userDataRoot = null,
) {
  let draftReviewDiff = null;
  try {
    await clickByRole(page, 'button', 'Approve plan');
    await page.locator(SELECTORS.planApproved).waitFor({ state: 'visible' });
    await approveCurrentProjectWriteIfRequested(page);
    const draftReady = page.locator(SELECTORS.unsavedDraft)
      .getByText('Unsaved draft', { exact: true })
      .waitFor({ state: 'visible', timeout: CANARY_PLAN_PROPOSAL_TIMEOUT_MS })
      .then(() => 'draft_ready', () => 'draft_timeout');
    const alert = page.locator(SELECTORS.generationFailedNotice)
      .waitFor({ state: 'visible', timeout: CANARY_PLAN_PROPOSAL_TIMEOUT_MS })
      .then(() => 'alert', () => 'alert_timeout');
    const outcome = await Promise.race([draftReady, alert]);
    if (outcome !== 'draft_ready') {
      await failWithDiagnostic(
        'canary_plan_review_failed',
        await collectPlanReviewContinuationDiagnostic(page, currentProject, userDataRoot),
      );
    }
    await page.locator(SELECTORS.saveVersion).waitFor({ state: 'visible' });
    await expectComposerStatus(page, 'Ready to execute current direction');
    draftReviewDiff = await inspectDraftReviewDiffViaUi(page);
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError) throw error;
    fail('canary_plan_review_failed');
  }

  try {
    const evidence = await readSanitizedBridgeEvidence(page, currentProject.project_id);
    assertExactRevision(evidence, currentProject);
    assertTaskStreamPendingCandidateFacts(
      evidence,
      currentProject,
      expectedCandidateTurns,
      expectedQuestionTurns,
      {
        approvedPlanReviews: 1,
        planTurns: expectedPlanTurns,
        requireToolActivity: true,
      },
    );
    return Object.freeze({
      approved_plan_continued: true,
      approved_plan_task_stream_verified: true,
      composer_status_text: await readComposerStatus(page),
      previous_revision_verified_before_save: true,
      review_diff: draftReviewDiff,
      unsaved_draft_observed: true,
    });
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError) throw error;
    fail('canary_plan_review_failed');
  }
}

async function collectPlanReviewContinuationDiagnostic(page, currentProject, userDataRoot = null) {
  let evidence = null;
  try {
    evidence = await readSanitizedBridgeEvidence(page, currentProject.project_id);
  } catch {
    evidence = null;
  }
  const facts = evidence?.task_stream?.conversation?.item_facts ?? null;
  const counts = facts?.counts ?? null;
  const latestPlanReview = facts?.latestPlanReview ?? null;
  return Object.freeze({
    active_notice: await optionalLocatorText(page, '[data-builder-conversation-notice]'),
    active_notice_kind: await optionalLocatorAttribute(
      page,
      '[data-builder-conversation-notice]',
      'data-builder-conversation-notice',
    ),
    composer_dispatch: await optionalLocatorAttribute(page, SELECTORS.composer, 'data-builder-route-dispatch'),
    composer_permission: await optionalLocatorAttribute(page, SELECTORS.composer, 'data-builder-route-permission'),
    composer_route: await optionalLocatorAttribute(page, SELECTORS.composer, 'data-builder-route'),
    composer_signals: await optionalLocatorAttribute(page, SELECTORS.composer, 'data-builder-route-signals'),
    composer_status: await optionalLocatorText(page, SELECTORS.composerStatus),
    generation_debug: optionalCanaryGenerationDebug(userDataRoot),
    generation_failed_notice_visible: await optionalLocatorVisible(page, SELECTORS.generationFailedNotice),
    latest_plan_review: latestPlanReview === null ? null : Object.freeze({
      decision: latestPlanReview.decision,
      plan_state: latestPlanReview.plan_state,
    }),
    plan_approved_visible: await optionalLocatorVisible(page, SELECTORS.planApproved),
    plan_review_actions_visible: await optionalLocatorVisible(page, SELECTORS.planReviewActions),
    project_status: await optionalLocatorAttribute(page, SELECTORS.projectPage, 'data-builder-project-status'),
    save_version_visible: await optionalLocatorVisible(page, SELECTORS.saveVersion),
    task_stream_counts: counts === null ? null : Object.freeze({
      answer_count: counts.answer_count,
      candidate_ready_count: counts.candidate_ready_count,
      plan_approved_count: counts.plan_approved_count,
      plan_rejected_count: counts.plan_rejected_count,
      plan_reviewed_count: counts.plan_reviewed_count,
      plan_turn_count: counts.plan_turn_count,
    }),
    unsaved_draft_visible: await optionalLocatorVisible(page, SELECTORS.unsavedDraft),
  });
}

async function rejectPlanViaUi(
  page,
  currentProject,
  expectedCandidateTurns,
  expectedQuestionTurns = 0,
  expectedPlanTurns = 1,
) {
  try {
    await clickByRole(page, 'button', 'Reject');
    await page.locator(SELECTORS.planRejected).waitFor({ state: 'visible' });
    await expectComposerStatus(page, 'Direction changed');
    await page.locator(SELECTORS.unsavedDraft).waitFor({ state: 'hidden' });
    await page.locator(SELECTORS.saveVersion).waitFor({ state: 'hidden' });
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError) throw error;
    fail('canary_plan_review_failed');
  }

  try {
    const evidence = await readSanitizedBridgeEvidence(page, currentProject.project_id);
    assertExactRevision(evidence, currentProject);
    return Object.freeze({
      composer_status_text: await readComposerStatus(page),
      plan_rejected: true,
      saved_revision_unchanged: true,
      task_stream: assertTaskStreamRejectedPlanFacts(
        evidence,
        currentProject,
        expectedCandidateTurns,
        expectedQuestionTurns,
        expectedPlanTurns,
      ),
      unsaved_draft_visible: false,
    });
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError) throw error;
    fail('canary_plan_review_failed');
  }
}

async function saveUpdateDraftViaUi(page, currentProject) {
  try {
    await clickSaveVersionViaUi(page);
  } catch {
    fail('canary_update_save_failed');
  }
  try {
    await page.locator(SELECTORS.unsavedDraft).waitFor({ state: 'hidden' });
  } catch {
    fail('canary_update_save_confirmation_failed');
  }
  await assertVisibleVersion(page, currentProject.revision_number + 1);
  return Object.freeze({
    saved_via_ui: true,
  });
}

async function updateProjectViaUi(page, currentProject, instruction = CANARY_UPDATE_INSTRUCTION) {
  const pendingDraft = await createUpdateDraftViaUi(page, currentProject, instruction);
  const savedDraft = await saveUpdateDraftViaUi(page, currentProject);
  return Object.freeze({
    ...pendingDraft,
    ...savedDraft,
    unsaved_draft_observed: true,
  });
}

async function assertVisibleVersion(page, revisionNumber) {
  try {
    const version = page.locator(SELECTORS.currentVersion);
    await version.waitFor({ state: 'visible' });
    if ((await version.textContent())?.trim() !== `Version ${revisionNumber}`) {
      fail('canary_version_failed');
    }
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError) throw error;
    fail('canary_version_failed');
  }
}

async function hasVisibleVersionHistory(page) {
  try {
    await page.locator(SELECTORS.versionHistory).waitFor({ state: 'visible', timeout: 750 });
    return true;
  } catch {
    return false;
  }
}

async function openVersionHistoryViaUi(page) {
  if (await hasVisibleVersionHistory(page)) return;
  const attempts = [
    async () => {
      await page.locator(SELECTORS.artifactTabVersions).click({ timeout: 1000 });
    },
    async () => {
      await page.locator(SELECTORS.workspaceMenuButton).click({ timeout: 1000 });
      await page.locator(SELECTORS.workspaceControlVersions).click({ timeout: 3000 });
    },
  ];
  for (const attempt of attempts) {
    try {
      await attempt();
      if (await hasVisibleVersionHistory(page)) return;
    } catch {
      // Try the next public history entry point before reporting navigation failure.
    }
  }
}

async function captureSavedActivityEvidence(page, revisionNumber) {
  try {
    const expectedBody = `This draft was saved as Version ${revisionNumber}.`;
    const activity = page.locator(SELECTORS.versionSavedActivity).filter({ hasText: expectedBody });
    await activity.waitFor({ state: 'visible' });
    await activity.getByText(expectedBody, { exact: true }).waitFor({ state: 'visible' });
    const activityText = await activity.textContent();
    if (
      typeof activityText !== 'string'
      || !activityText.includes('Version saved')
      || !activityText.includes(expectedBody)
      || SAVED_ACTIVITY_INTERNAL_EVIDENCE_PATTERN.test(activityText)
    ) fail('canary_save_activity_failed');
    return Object.freeze({
      internal_evidence_hidden: true,
      public_revision_number: revisionNumber,
      version_saved_visible: true,
    });
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError) throw error;
    fail('canary_save_activity_failed');
  }
}

async function inspectHistoryVersionViaUi(
  page,
  historicalRevision,
  currentRevision,
  historicalPreviewEvidence,
  currentPreviewEvidence,
  currentTaskStream,
  gate,
  expectedQuestionTurns = 1,
) {
  const historicalVersion = historicalRevision.revision_number;
  const currentVersion = currentRevision.revision_number;
  try {
    await openVersionHistoryViaUi(page);
    await page.locator(SELECTORS.versionHistory).waitFor({ state: 'visible' });
    await page.locator(`[data-builder-version-card="Version ${currentVersion}"]`)
      .waitFor({ state: 'visible' });
    await page.locator(`[data-builder-version-card="Version ${historicalVersion}"]`)
      .getByText(`Version ${historicalVersion}`, { exact: true })
      .waitFor({ state: 'visible' });
    await page.locator(`[data-builder-view-version="Version ${historicalVersion}"]`).click();
    await page.locator(SELECTORS.historyPreview)
      .getByText(`Viewing Version ${historicalVersion}`, { exact: true })
      .waitFor({ state: 'visible' });
    await page.locator(SELECTORS.unsavedDraft).waitFor({ state: 'hidden' });
    await page.locator(SELECTORS.saveVersion).waitFor({ state: 'hidden' });
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError) throw error;
    fail('canary_history_navigation_failed');
  }

  try {
    const viewedPreview = await capturePreviewEvidence(page, gate);
    if (
      !samePreviewEvidence(viewedPreview, historicalPreviewEvidence)
      || (
        viewedPreview.preview_mode === 'static_frame'
        && currentPreviewEvidence.preview_mode === 'static_frame'
        && samePreviewEvidence(viewedPreview, currentPreviewEvidence)
      )
    ) fail('canary_history_preview_failed');
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError && error.code === 'canary_history_preview_failed') {
      throw error;
    }
    fail('canary_history_preview_failed');
  }

  try {
    const viewingEvidence = await readSanitizedBridgeEvidence(page, currentRevision.project_id);
    assertExactRevision(viewingEvidence, currentRevision);
    const viewingTaskStream = assertTaskStreamCandidateFacts(
      viewingEvidence,
      currentRevision,
      currentVersion,
      expectedQuestionTurns,
    );
    if (digestCanonical(viewingTaskStream) !== digestCanonical(currentTaskStream)) {
      fail('canary_history_current_failed');
    }
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError && error.code === 'canary_history_current_failed') {
      throw error;
    }
    fail('canary_history_current_failed');
  }

  try {
    await clickByRole(page, 'button', 'Back to current');
    await page.locator(SELECTORS.historyPreview).waitFor({ state: 'hidden' });
    await assertVisibleVersion(page, currentVersion);
    const restoredPreview = await capturePreviewEvidence(page, gate);
    if (!samePreviewEvidence(restoredPreview, currentPreviewEvidence)) {
      fail('canary_history_return_failed');
    }
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError && error.code === 'canary_history_return_failed') {
      throw error;
    }
    fail('canary_history_return_failed');
  }

  return Object.freeze({
    current_preview_restored: true,
    current_revision_unchanged: true,
    historical_preview_matches_saved_version: true,
    returned_to_current: true,
    task_stream_unchanged: true,
    viewed_revision_number: historicalVersion,
  });
}

async function failRestartVersion(page) {
  try {
    const status = await page.locator(SELECTORS.projectPage)
      .getAttribute('data-builder-project-status');
    if (status === 'new') fail('canary_restart_state_new');
    if (status === 'opening') fail('canary_restart_state_opening');
    if (status === 'unavailable') fail('canary_restart_state_unavailable');
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError) throw error;
  }
  fail('canary_version_failed');
}

async function readPendingUpdateDraftRestoreEvidence(
  page,
  currentProject,
  expectedCandidateTurns,
  expectedQuestionTurns = 0,
) {
  try {
    await page.locator(SELECTORS.unsavedDraft)
      .getByText('Unsaved draft', { exact: true })
      .waitFor({ state: 'visible' });
    await page.locator(SELECTORS.saveVersion).waitFor({ state: 'visible' });
    await assertVisibleVersion(page, currentProject.revision_number);
    const reviewDiff = await inspectDraftReviewDiffViaUi(page);
    const evidence = await readSanitizedBridgeEvidence(page, currentProject.project_id);
    assertExactRevision(evidence, currentProject);
    return Object.freeze({
      evidence,
      task_stream: assertTaskStreamPendingCandidateFacts(
        evidence,
        currentProject,
        expectedCandidateTurns,
        expectedQuestionTurns,
      ),
      ui: Object.freeze({
        review_diff: reviewDiff,
        save_remained_explicit: true,
        saved_revision_visible: true,
        unsaved_draft_restored: true,
      }),
    });
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError) throw error;
    let evidence = null;
    try {
      evidence = await readSanitizedBridgeEvidence(
        page,
        currentProject.project_id,
        'canary_read_evidence_pending_restart_diagnostic_failed',
      );
    } catch {
      evidence = null;
    }
    let diagnosticRestore = null;
    try {
      diagnosticRestore = await page.evaluate(async (request) => {
        const root = globalThis.clawfabricBuilder;
        const stream = await root?.taskStream?.read?.({ project_id: request.projectId });
        const items = Array.isArray(stream?.conversation?.items) ? stream.conversation.items : [];
        const reviewedDraftIds = new Set();
        let draftId = null;
        for (let index = items.length - 1; index >= 0; index -= 1) {
          const item = items[index];
          if (item?.item_kind === 'candidate_reviewed' && typeof item.draft_id === 'string') {
            reviewedDraftIds.add(item.draft_id);
            continue;
          }
          if (
            item?.item_kind === 'run_completed'
            && item?.candidate !== null
            && typeof item?.candidate?.draft_id === 'string'
            && !reviewedDraftIds.has(item.candidate.draft_id)
          ) {
            draftId = item.candidate.draft_id;
            break;
          }
        }
        if (draftId === null) {
          return {
            pending_draft_found: false,
            item_count: items.length,
            latest_item_kinds: items.slice(-6).map((item) => item?.item_kind ?? null),
          };
        }
        const response = await root?.codeGenerator?.restoreDraft?.({ draft_id: draftId });
        const base = response?.result?.base_revision_evidence ?? null;
        return {
          pending_draft_found: true,
          response_ok: response?.ok ?? null,
          result_version: response?.result?.result_version ?? null,
          restart_restore: response?.result?.restart_restore ?? null,
          error_code: response?.error?.code ?? null,
          base_revision_evidence_present: base !== null,
          base_project_matches: base?.project_id === request.projectId,
          base_revision_digest_matches: base?.revision_receipt_digest === request.revisionReceiptDigest,
          base_commit_matches: base?.commit_oid === request.commitOid,
          base_source_tree_matches_current: base?.source_tree_digest === request.sourceTreeDigest,
          source_tree_present: response?.result?.source_tree !== undefined,
        };
      }, {
        commitOid: currentProject.commit_oid,
        projectId: currentProject.project_id,
        revisionReceiptDigest: currentProject.revision_receipt_digest,
        sourceTreeDigest: evidence?.current?.source_tree?.source_tree_digest ?? null,
      });
    } catch {
      diagnosticRestore = Object.freeze({ response_ok: null, error_code: 'diagnostic_restore_threw' });
    }
    failWithDiagnostic('canary_pending_draft_restart_failed', Object.freeze({
      diagnostic_version: 'builder-canary-pending-restart-restore-diagnostic.v1',
      project_status: await optionalLocatorAttribute(page, SELECTORS.projectPage, 'data-builder-project-status'),
      react_conversation_status: await optionalLocatorAttribute(
        page,
        SELECTORS.projectPage,
        'data-builder-conversation-status',
      ),
      react_conversation_project_id: await optionalLocatorAttribute(
        page,
        SELECTORS.projectPage,
        'data-builder-conversation-project-id',
      ),
      react_conversation_item_count: await optionalLocatorAttribute(
        page,
        SELECTORS.projectPage,
        'data-builder-conversation-item-count',
      ),
      unsaved_draft_visible: await optionalLocatorVisible(page, SELECTORS.unsavedDraft),
      save_version_visible: await optionalLocatorVisible(page, SELECTORS.saveVersion),
      active_version_text: await optionalLocatorText(page, SELECTORS.currentVersion),
      review_diff_visible: await optionalLocatorVisible(page, SELECTORS.reviewDiff),
      conversation_notice: await optionalLocatorText(page, '[data-builder-conversation-notice]'),
      restore_observer: await readPendingRestartRestoreObserver(page),
      ui: await readPendingRestartUiDiagnostic(page),
      app_scan: await readPendingRestartAppScanDiagnostic(page, currentProject),
      task_stream: taskStreamCheckpointDiagnostic(evidence, 'pending_restart_restore'),
      diagnostic_restore: diagnosticRestore,
      thrown_name: error instanceof Error ? error.name : null,
    }));
  }
}

async function readOnlyBridgeEvidence(page, projectId = null, code = 'canary_read_evidence_failed') {
  try {
    return await page.evaluate(async (request) => {
      const bridge = globalThis.clawfabricBuilder;
      const planReview = bridge.planReview;
      const planReviewDescriptors = planReview !== null
        && (typeof planReview === 'object' || typeof planReview === 'function')
        ? Object.getOwnPropertyDescriptors(planReview)
        : null;
      const planReviewKeys = planReviewDescriptors === null
        ? []
        : Reflect.ownKeys(planReviewDescriptors);
      const reviewDescriptor = planReviewDescriptors === null
        ? null
        : planReviewDescriptors.review;
      const providerContextDisclosureApproval = bridge.providerContextDisclosureApproval;
      const providerContextDisclosureApprovalDescriptors =
        providerContextDisclosureApproval !== null
          && (
            typeof providerContextDisclosureApproval === 'object'
            || typeof providerContextDisclosureApproval === 'function'
          )
          ? Object.getOwnPropertyDescriptors(providerContextDisclosureApproval)
          : null;
      const providerContextDisclosureApprovalKeys =
        providerContextDisclosureApprovalDescriptors === null
          ? []
          : Reflect.ownKeys(providerContextDisclosureApprovalDescriptors);
      const approveCurrentDescriptor = providerContextDisclosureApprovalDescriptors === null
        ? null
        : providerContextDisclosureApprovalDescriptors.approveCurrent;
      const checkRun = bridge.checkRun;
      const checkRunDescriptors = checkRun !== null
        && (typeof checkRun === 'object' || typeof checkRun === 'function')
        ? Object.getOwnPropertyDescriptors(checkRun)
        : null;
      const checkRunKeys = checkRunDescriptors === null
        ? []
        : Reflect.ownKeys(checkRunDescriptors);
      const checkRunMethodNames = [
        'readCurrentDraftAvailableChecks',
        'approveAndRunCurrentDraftCheck',
        'skipCurrentDraftCheck',
      ];
      const checkRunMethodsAreExact = checkRunKeys.length === checkRunMethodNames.length
        && checkRunMethodNames.every((name, index) => {
          const descriptor = checkRunDescriptors[name];
          return checkRunKeys[index] === name
            && descriptor !== undefined
            && descriptor.enumerable === true
            && Object.hasOwn(descriptor, 'value')
            && typeof descriptor.value === 'function';
        });
      const livePreview = bridge.livePreview;
      const livePreviewDescriptors = livePreview !== null
        && (typeof livePreview === 'object' || typeof livePreview === 'function')
        ? Object.getOwnPropertyDescriptors(livePreview)
        : null;
      const livePreviewKeys = livePreviewDescriptors === null
        ? []
        : Reflect.ownKeys(livePreviewDescriptors);
      const livePreviewMethodNames = [
        'requestCurrentDraftPreview',
        'reloadCurrentPreview',
        'stopCurrentPreview',
        'readCurrentPreviewStatus',
      ];
      const livePreviewMethodsAreExact = livePreviewKeys.length === livePreviewMethodNames.length
        && livePreviewMethodNames.every((name, index) => {
          const descriptor = livePreviewDescriptors[name];
          return livePreviewKeys[index] === name
            && descriptor !== undefined
            && descriptor.enumerable === true
            && Object.hasOwn(descriptor, 'value')
            && typeof descriptor.value === 'function';
        });
      const sideWorkspaceFiles = bridge.sideWorkspaceFiles;
      const sideWorkspaceFilesDescriptors = sideWorkspaceFiles !== null
        && (typeof sideWorkspaceFiles === 'object' || typeof sideWorkspaceFiles === 'function')
        ? Object.getOwnPropertyDescriptors(sideWorkspaceFiles)
        : null;
      const sideWorkspaceFilesKeys = sideWorkspaceFilesDescriptors === null
        ? []
        : Reflect.ownKeys(sideWorkspaceFilesDescriptors);
      const sideWorkspaceFilesMethodNames = [
        'readCurrentDraftFileTree',
        'readCurrentDraftFileContent',
      ];
      const sideWorkspaceFilesMethodsAreExact =
        sideWorkspaceFilesKeys.length === sideWorkspaceFilesMethodNames.length
        && sideWorkspaceFilesMethodNames.every((name, index) => {
          const descriptor = sideWorkspaceFilesDescriptors[name];
          return sideWorkspaceFilesKeys[index] === name
            && descriptor !== undefined
            && descriptor.enumerable === true
            && Object.hasOwn(descriptor, 'value')
            && typeof descriptor.value === 'function';
        });
      const bridge_contract = {
        bridge_version: bridge.bridgeVersion,
        legacy_namespaces_absent: !Object.hasOwn(bridge, 'projectCatalog')
          && !Object.hasOwn(bridge, 'projectRevisions'),
        check_run_namespace: checkRunMethodsAreExact
          ? 'current_draft_identity_methods_only'
          : 'unavailable',
        live_preview_namespace: livePreviewMethodsAreExact
          ? 'current_preview_control_methods_only'
          : 'unavailable',
        side_workspace_files_namespace: sideWorkspaceFilesMethodsAreExact
          ? 'current_draft_file_read_methods_only'
          : 'unavailable',
        plan_review_namespace: planReviewKeys.length === 1
          && planReviewKeys[0] === 'review'
          && reviewDescriptor !== null
          && reviewDescriptor.enumerable === true
          && Object.hasOwn(reviewDescriptor, 'value')
          && typeof reviewDescriptor.value === 'function'
          ? 'review_method_only'
          : 'unavailable',
        provider_context_disclosure_approval_namespace:
          providerContextDisclosureApprovalKeys.length === 1
          && providerContextDisclosureApprovalKeys[0] === 'approveCurrent'
          && approveCurrentDescriptor !== null
          && approveCurrentDescriptor.enumerable === true
          && Object.hasOwn(approveCurrentDescriptor, 'value')
          && typeof approveCurrentDescriptor.value === 'function'
            ? 'approve_current_method_only'
            : 'unavailable',
      };
      const status = await bridge.providerSettings.status();
      const catalog = await bridge.projectWorkspace.listCurrent();
      const current = request.projectId === null
        ? null
        : await bridge.projectWorkspace.loadCurrent({ project_id: request.projectId });
      const task_stream = request.projectId === null
        ? null
        : await bridge.taskStream.read({ project_id: request.projectId });
      return { bridge_contract, catalog, current, status, task_stream };
    }, { projectId });
  } catch {
    fail(code);
  }
}

async function readSanitizedBridgeEvidence(page, projectId = null, code = 'canary_read_evidence_failed') {
  try {
    return assertReadEvidence(await readOnlyBridgeEvidence(page, projectId, code), code);
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError) {
      const componentCodes = READ_EVIDENCE_COMPONENT_FAILURE_CODES[code];
      if (
        error.code === code
        || (
          componentCodes !== undefined
          && Object.values(componentCodes).includes(error.code)
        )
      ) {
        throw error;
      }
    }
    fail(code);
  }
}

const READ_EVIDENCE_COMPONENT_FAILURE_CODES = Object.freeze({
  canary_read_evidence_initial_current_failed: Object.freeze({
    current: 'canary_read_evidence_initial_current_current_failed',
    task_stream: 'canary_read_evidence_initial_current_task_stream_failed',
  }),
  canary_read_evidence_pending_update_failed: Object.freeze({
    current: 'canary_read_evidence_pending_update_current_failed',
    task_stream: 'canary_read_evidence_pending_update_task_stream_failed',
  }),
});

function readEvidenceComponentCode(code, component) {
  const componentCodes = READ_EVIDENCE_COMPONENT_FAILURE_CODES[code];
  if (componentCodes === undefined) return code;
  return componentCodes[component] ?? code;
}

function sanitizeReadEvidenceComponent(code, component, callback) {
  try {
    return callback();
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError) {
      fail(readEvidenceComponentCode(code, component));
    }
    throw error;
  }
}

function assertReadEvidence(value, code = 'canary_evidence_failed') {
  if (
    value !== null
    && (typeof value === 'object' || typeof value === 'function')
    && TRUSTED_READ_EVIDENCE.has(value)
  ) return value;
  const evidenceDescriptors = exactDataObject(value, READ_EVIDENCE_KEYS);
  const bridgeContractDescriptors = exactDataObject(
    evidenceDescriptors.bridge_contract.value,
    BRIDGE_CONTRACT_KEYS,
  );
  if (
    bridgeContractDescriptors.bridge_version.value !== 'builder-preload.v27'
    || bridgeContractDescriptors.legacy_namespaces_absent.value !== true
    || bridgeContractDescriptors.check_run_namespace.value
      !== 'current_draft_identity_methods_only'
    || bridgeContractDescriptors.live_preview_namespace.value
      !== 'current_preview_control_methods_only'
    || bridgeContractDescriptors.side_workspace_files_namespace.value
      !== 'current_draft_file_read_methods_only'
    || bridgeContractDescriptors.plan_review_namespace.value !== 'review_method_only'
    || bridgeContractDescriptors.provider_context_disclosure_approval_namespace.value
      !== 'approve_current_method_only'
  ) fail('canary_evidence_failed');
  const bridgeContract = Object.freeze({
    bridge_version: 'builder-preload.v27',
    legacy_namespaces_absent: true,
    check_run_namespace: 'current_draft_identity_methods_only',
    live_preview_namespace: 'current_preview_control_methods_only',
    side_workspace_files_namespace: 'current_draft_file_read_methods_only',
    plan_review_namespace: 'review_method_only',
    provider_context_disclosure_approval_namespace: 'approve_current_method_only',
  });
  const status = sanitizeStatus(evidenceDescriptors.status.value);
  const catalog = sanitizeCatalog(evidenceDescriptors.catalog.value);
  const current = evidenceDescriptors.current.value === null
    ? null
    : sanitizeReadEvidenceComponent(
      code,
      'current',
      () => sanitizeCurrent(evidenceDescriptors.current.value),
    );
  const taskStream = evidenceDescriptors.task_stream.value === null
    ? null
    : sanitizeReadEvidenceComponent(
      code,
      'task_stream',
      () => sanitizeTaskStream(
        evidenceDescriptors.task_stream.value,
        current === null ? null : current.product_revision_receipt.project_id,
      ),
    );
  const result = Object.freeze({
    bridge_contract: bridgeContract,
    catalog,
    current,
    status,
    task_stream: taskStream,
  });
  TRUSTED_READ_EVIDENCE.add(result);
  return result;
}

function sanitizeStatus(value) {
  const descriptors = exactDataObject(value, STATUS_KEYS);
  const statusVersion = descriptors.status_version.value;
  const configured = descriptors.configured.value;
  const credentialStatus = descriptors.credential_status.value;
  const configDigest = descriptors.config_digest.value;
  if (
    statusVersion !== 'builder-provider-settings-status.v1'
    || configured !== true
    || credentialStatus !== 'stored'
    || typeof configDigest !== 'string'
    || !DIGEST_PATTERN.test(configDigest)
  ) fail('canary_evidence_failed');
  return Object.freeze({
    config_digest: configDigest,
    configured,
    credential_status: credentialStatus,
    status_version: statusVersion,
  });
}

const TASK_STREAM_CONTEXT_STATUS_EXPECTED = Object.freeze([
  Object.freeze({
    label: 'No direction yet',
    tone: 'neutral',
    next_action_hint: 'Describe what you want to make or change.',
    has_pending_handoff: false,
    pending_handoff_count: 0,
    needs_confirmation: false,
    can_contextual_execute: false,
  }),
  Object.freeze({
    label: 'Direction updated',
    tone: 'info',
    next_action_hint: 'Ask me to make the change when the direction is ready.',
    has_pending_handoff: false,
    pending_handoff_count: 0,
    needs_confirmation: false,
    can_contextual_execute: false,
  }),
  Object.freeze({
    label: 'Ready to execute current direction',
    tone: 'success',
    next_action_hint: 'You can ask me to make the change.',
    has_pending_handoff: false,
    pending_handoff_count: 0,
    needs_confirmation: false,
    can_contextual_execute: true,
  }),
  Object.freeze({
    label: 'Direction changed',
    tone: 'warning',
    next_action_hint: 'Confirm the new direction before I change files.',
    has_pending_handoff: false,
    pending_handoff_count: 0,
    needs_confirmation: true,
    can_contextual_execute: false,
  }),
  Object.freeze({
    label: 'Using approved plan',
    tone: 'success',
    next_action_hint: 'You can ask me to apply the approved plan.',
    has_pending_handoff: false,
    pending_handoff_count: 0,
    needs_confirmation: false,
    can_contextual_execute: true,
  }),
  Object.freeze({
    label: 'Needs confirmation',
    tone: 'warning',
    next_action_hint: 'Answer the open question before I change files.',
    has_pending_handoff: false,
    pending_handoff_count: 0,
    needs_confirmation: true,
    can_contextual_execute: false,
  }),
  Object.freeze({
    label: 'Handoff received',
    tone: 'warning',
    next_action_hint: 'Review the handoff before the next change.',
    has_pending_handoff: true,
    pending_handoff_count: 'positive',
    needs_confirmation: true,
    can_contextual_execute: false,
  }),
]);

const TASK_STREAM_PROVIDER_CONTEXT_DISCLOSURE_EXPECTED = Object.freeze([
  Object.freeze({
    label: 'Allow AI to use current context',
    tone: 'warning',
    next_action_hint: 'Review this before Builder shares the current task context.',
    needs_user_approval: true,
    can_use_provider_context: false,
    blocked_reason: 'context_disclosure_not_approved',
    request_available: true,
  }),
  Object.freeze({
    label: 'AI context not allowed',
    tone: 'neutral',
    next_action_hint: 'Builder will continue without sharing the current task context.',
    needs_user_approval: false,
    can_use_provider_context: false,
    blocked_reason: 'context_disclosure_denied',
    request_available: true,
  }),
  Object.freeze({
    label: 'AI context allowed',
    tone: 'success',
    next_action_hint: 'Builder can use the approved task context for this AI request.',
    needs_user_approval: false,
    can_use_provider_context: true,
    blocked_reason: null,
    request_available: false,
  }),
]);

function dataValue(descriptors, key) {
  const descriptor = descriptors[key];
  if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail('canary_evidence_failed');
  return descriptor.value;
}

function exactAuthority(value, keys, expected) {
  const descriptors = exactDataObject(value, keys);
  for (const key of keys) {
    if (dataValue(descriptors, key) !== expected[key]) fail('canary_evidence_failed');
  }
}

function safeProviderContextDisclosureCopy(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9 .,;:/()_-]{1,240}$/u.test(value)) {
    fail('canary_evidence_failed');
  }
  return value;
}

function safeProviderContextDisclosureEnum(value, allowed) {
  if (typeof value !== 'string' || !allowed.includes(value)) fail('canary_evidence_failed');
  return value;
}

function safeProviderContextDisclosureCount(value, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail('canary_evidence_failed');
  }
  return value;
}

function sanitizeProviderContextDisclosureBudget(value) {
  const descriptors = exactDataObject(value, TASK_STREAM_PROVIDER_CONTEXT_DISCLOSURE_BUDGET_KEYS);
  const maxPromptBytes = safeProviderContextDisclosureCount(
    dataValue(descriptors, 'max_prompt_bytes'),
    512,
    65_536,
  );
  return Object.freeze({
    used_prompt_bytes: safeProviderContextDisclosureCount(
      dataValue(descriptors, 'used_prompt_bytes'),
      0,
      maxPromptBytes,
    ),
    max_prompt_bytes: maxPromptBytes,
    reserved_response_bytes: safeProviderContextDisclosureCount(
      dataValue(descriptors, 'reserved_response_bytes'),
      0,
      65_536,
    ),
  });
}

function sanitizeProviderContextDisclosurePermissionGate(value) {
  const descriptors = exactDataObject(value, TASK_STREAM_PROVIDER_CONTEXT_DISCLOSURE_PERMISSION_GATE_KEYS);
  const sideEffectReady = dataValue(descriptors, 'side_effect_ready');
  if (typeof sideEffectReady !== 'boolean') fail('canary_evidence_failed');
  return Object.freeze({
    workspace_state: safeProviderContextDisclosureEnum(
      dataValue(descriptors, 'workspace_state'),
      ['bound', 'missing'],
    ),
    write_permission: safeProviderContextDisclosureEnum(
      dataValue(descriptors, 'write_permission'),
      ['allowed', 'ask', 'denied', 'not_required'],
    ),
    side_effect_ready: sideEffectReady,
  });
}

function sanitizeProviderContextDisclosureSegmentKinds(value) {
  if (!Array.isArray(value) || value.length > 16) fail('canary_evidence_failed');
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || keys.some((key) => typeof key === 'symbol')) {
    fail('canary_evidence_failed');
  }
  const kinds = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      fail('canary_evidence_failed');
    }
    kinds.push(safeProviderContextDisclosureEnum(
      descriptor.value,
      TASK_STREAM_PROVIDER_CONTEXT_DISCLOSURE_SEGMENT_KINDS,
    ));
  }
  return Object.freeze(kinds);
}

function sanitizeProviderContextDisclosureContextSurface(value) {
  const descriptors = exactDataObject(value, TASK_STREAM_PROVIDER_CONTEXT_DISCLOSURE_CONTEXT_SURFACE_KEYS);
  const segmentKinds = sanitizeProviderContextDisclosureSegmentKinds(
    dataValue(descriptors, 'segment_kinds'),
  );
  const segmentCount = safeProviderContextDisclosureCount(dataValue(descriptors, 'segment_count'), 0, 16);
  if (segmentCount !== segmentKinds.length) fail('canary_evidence_failed');
  return Object.freeze({
    working_context_state_status: safeProviderContextDisclosureEnum(
      dataValue(descriptors, 'working_context_state_status'),
      TASK_STREAM_PROVIDER_CONTEXT_DISCLOSURE_WORKING_CONTEXT_STATES,
    ),
    segment_count: segmentCount,
    segment_kinds: segmentKinds,
    omitted_ref_count: safeProviderContextDisclosureCount(
      dataValue(descriptors, 'omitted_ref_count'),
      0,
      16,
    ),
    budget: sanitizeProviderContextDisclosureBudget(dataValue(descriptors, 'budget')),
    permission_gate: sanitizeProviderContextDisclosurePermissionGate(dataValue(descriptors, 'permission_gate')),
  });
}

function sanitizeProviderContextDisclosureInspection(value) {
  if (value === null) return null;
  const descriptors = exactDataObject(value, TASK_STREAM_PROVIDER_CONTEXT_DISCLOSURE_INSPECTION_KEYS);
  return Object.freeze({
    title: safeProviderContextDisclosureCopy(dataValue(descriptors, 'title')),
    summary: safeProviderContextDisclosureCopy(dataValue(descriptors, 'summary')),
    details: safeProviderContextDisclosureCopy(dataValue(descriptors, 'details')),
    purpose: safeProviderContextDisclosureEnum(
      dataValue(descriptors, 'purpose'),
      ['answer', 'plan', 'contextual_build'],
    ),
    provider_scope: dataValue(descriptors, 'provider_scope') === 'configured_provider'
      ? 'configured_provider'
      : fail('canary_evidence_failed'),
    context_surface: sanitizeProviderContextDisclosureContextSurface(
      dataValue(descriptors, 'context_surface'),
    ),
  });
}

function sanitizeTaskStreamContextStatusProjection(value) {
  if (value === null) return null;
  const descriptors = exactDataObject(value, TASK_STREAM_CONTEXT_STATUS_PROJECTION_KEYS);
  if (dataValue(descriptors, 'projection_version') !== 'builder-context-status-projection.v1') {
    fail('canary_evidence_failed');
  }
  exactAuthority(dataValue(descriptors, 'authority'), TASK_STREAM_CONTEXT_STATUS_AUTHORITY_KEYS, {
    projection_authority: 'main_owned_context_status_projection_v1',
    working_context_state: 'verified_not_exposed',
    pending_handoff_packets: dataValue(descriptors, 'has_pending_handoff') === true
      ? 'pending_count_only'
      : 'none',
    renderer_authority: 'not_present',
    ipc_authority: 'not_present',
    provider_dispatch: false,
    tool_dispatch: false,
    source_read: 'not_present',
    source_write: 'not_present',
    git_mutation: false,
    permission_grant: false,
    revision_admission: 'not_created',
    secret_access: 'not_present',
  });
  const pendingHandoffCount = dataValue(descriptors, 'pending_handoff_count');
  const matched = TASK_STREAM_CONTEXT_STATUS_EXPECTED.find((expected) => (
    dataValue(descriptors, 'label') === expected.label
    && dataValue(descriptors, 'tone') === expected.tone
    && dataValue(descriptors, 'next_action_hint') === expected.next_action_hint
    && dataValue(descriptors, 'has_pending_handoff') === expected.has_pending_handoff
    && (expected.pending_handoff_count === 'positive'
      ? Number.isSafeInteger(pendingHandoffCount) && pendingHandoffCount >= 1 && pendingHandoffCount <= 128
      : pendingHandoffCount === expected.pending_handoff_count)
    && dataValue(descriptors, 'needs_confirmation') === expected.needs_confirmation
    && dataValue(descriptors, 'can_contextual_execute') === expected.can_contextual_execute
  ));
  if (matched === undefined) fail('canary_evidence_failed');
  return Object.freeze({
    can_contextual_execute: matched.can_contextual_execute,
    has_pending_handoff: matched.has_pending_handoff,
    label: matched.label,
    needs_confirmation: matched.needs_confirmation,
    pending_handoff_count: pendingHandoffCount,
    tone: matched.tone,
  });
}

function sanitizeTaskStreamProviderContextDisclosureStatusProjection(value) {
  if (value === null) return null;
  const descriptors = exactDataObject(value, TASK_STREAM_PROVIDER_CONTEXT_DISCLOSURE_STATUS_PROJECTION_KEYS);
  if (
    dataValue(descriptors, 'projection_version')
    !== 'builder-provider-context-disclosure-status-projection.v1'
  ) fail('canary_evidence_failed');
  exactAuthority(dataValue(descriptors, 'authority'), TASK_STREAM_PROVIDER_CONTEXT_DISCLOSURE_STATUS_AUTHORITY_KEYS, {
    projection_authority: 'main_owned_provider_context_disclosure_status_projection_v1',
    disclosure_request_preparation: 'verified_safe_inspection_only',
    renderer_authority: 'not_present',
    provider_context_body: 'not_present',
    provider_dispatch: false,
    tool_dispatch: false,
    source_read: 'not_present',
    source_write: 'not_present',
    git_mutation: false,
    sqlite_write: false,
    permission_grant: false,
    revision_admission: 'not_created',
    secret_access: 'not_present',
  });
  const matched = TASK_STREAM_PROVIDER_CONTEXT_DISCLOSURE_EXPECTED.find((expected) => (
    dataValue(descriptors, 'label') === expected.label
    && dataValue(descriptors, 'tone') === expected.tone
    && dataValue(descriptors, 'next_action_hint') === expected.next_action_hint
    && dataValue(descriptors, 'needs_user_approval') === expected.needs_user_approval
    && dataValue(descriptors, 'can_use_provider_context') === expected.can_use_provider_context
    && dataValue(descriptors, 'blocked_reason') === expected.blocked_reason
    && dataValue(descriptors, 'request_available') === expected.request_available
  ));
  if (matched === undefined) fail('canary_evidence_failed');
  const inspection = sanitizeProviderContextDisclosureInspection(dataValue(descriptors, 'inspection'));
  if (
    (matched.can_use_provider_context && inspection !== null)
    || (!matched.can_use_provider_context && inspection === null)
  ) fail('canary_evidence_failed');
  return Object.freeze({
    blocked_reason: matched.blocked_reason,
    can_use_provider_context: matched.can_use_provider_context,
    inspection,
    label: matched.label,
    needs_user_approval: matched.needs_user_approval,
    request_available: matched.request_available,
    tone: matched.tone,
  });
}

function sanitizeTaskStream(value, expectedProjectId) {
  const descriptors = exactDataObjectWithOptional(value, TASK_STREAM_KEYS, TASK_STREAM_OPTIONAL_KEYS);
  const streamVersion = descriptors.stream_version.value;
  const projectId = safeProjectId(descriptors.project_id.value);
  const authorityDescriptors = exactDataObject(
    descriptors.authority.value,
    TASK_STREAM_AUTHORITY_KEYS,
  );
  if (
    streamVersion !== 'builder-task-stream-read-result.v1'
    || (expectedProjectId !== null && projectId !== expectedProjectId)
    || authorityDescriptors.conversation.value !== 'sqlite_canonical_event_replay_or_absent'
    || authorityDescriptors.project_source.value !== 'not_included'
    || authorityDescriptors.candidate_source.value !== 'not_loaded'
    || authorityDescriptors.project_revision.value !== 'not_inferred'
  ) fail('canary_evidence_failed');
  const conversation = descriptors.conversation.value === null
    ? null
    : sanitizeTaskStreamConversation(descriptors.conversation.value, projectId);
  const checkRunOutcomeProjection = Object.hasOwn(descriptors, 'check_run_outcome_projection')
    ? descriptors.check_run_outcome_projection.value === null
      ? null
      : sanitizeBuilderCheckRunOutcomeProjection(
        descriptors.check_run_outcome_projection.value,
      )
    : undefined;
  const agentActivityProjection = Object.hasOwn(descriptors, 'agent_activity_projection')
    ? descriptors.agent_activity_projection.value === null
      ? null
      : sanitizeBuilderAgentActivityProjection(descriptors.agent_activity_projection.value)
    : undefined;
  if (
    (agentActivityProjection === null && conversation !== null)
    || (
      agentActivityProjection !== undefined
      && agentActivityProjection !== null
      && (
        conversation === null
        || agentActivityProjection.project_id !== projectId
        || agentActivityProjection.conversation_id !== conversation.conversation_id
        || agentActivityProjection.head_sequence !== conversation.head_sequence
      )
    )
  ) fail('canary_evidence_failed');
  const reviewStateProjection = Object.hasOwn(descriptors, 'review_state_projection')
    ? descriptors.review_state_projection.value === null
      ? null
      : sanitizeBuilderReviewStateProjection(descriptors.review_state_projection.value)
    : undefined;
  if (
    reviewStateProjection !== undefined
    && reviewStateProjection !== null
    && checkRunOutcomeProjection !== undefined
    && checkRunOutcomeProjection !== null
    && reviewStateProjection.check_status !== checkRunOutcomeProjection.status
  ) fail('canary_evidence_failed');
  return Object.freeze({
    authority: Object.freeze({
      candidate_source: 'not_loaded',
      conversation: 'sqlite_canonical_event_replay_or_absent',
      project_revision: 'not_inferred',
      project_source: 'not_included',
    }),
    conversation,
    ...(Object.hasOwn(descriptors, 'context_status_projection')
      ? {
        context_status_projection:
          sanitizeTaskStreamContextStatusProjection(descriptors.context_status_projection.value),
      }
      : {}),
    ...(Object.hasOwn(descriptors, 'provider_context_disclosure_status_projection')
      ? {
        provider_context_disclosure_status_projection:
          sanitizeTaskStreamProviderContextDisclosureStatusProjection(
            descriptors.provider_context_disclosure_status_projection.value,
          ),
      }
      : {}),
    ...(Object.hasOwn(descriptors, 'draft_checkpoint_status_projection')
      ? {
        draft_checkpoint_status_projection:
          descriptors.draft_checkpoint_status_projection.value === null
            ? null
            : sanitizeBuilderDraftCheckpointStatusProjection(
              descriptors.draft_checkpoint_status_projection.value,
            ),
      }
      : {}),
    ...(reviewStateProjection === undefined
      ? {}
      : { review_state_projection: reviewStateProjection }),
    ...(checkRunOutcomeProjection === undefined
      ? {}
      : { check_run_outcome_projection: checkRunOutcomeProjection }),
    ...(agentActivityProjection === undefined
      ? {}
      : { agent_activity_projection: agentActivityProjection }),
    project_id: projectId,
    stream_version: streamVersion,
  });
}

function sanitizeTaskStreamMessage(value) {
  const descriptors = exactDataObject(value, TASK_STREAM_MESSAGE_KEYS);
  return Object.freeze({
    message_id: safeBuilderId(descriptors.message_id.value, 'message_id'),
    text_digest: digestText(evidenceText(descriptors.text.value, 8_192, 16 * 1_024, false, true)),
  });
}

function sanitizeTaskStreamTask(value) {
  if (value === null) return null;
  const descriptors = exactDataObject(value, TASK_STREAM_TASK_KEYS);
  return Object.freeze({
    task_id: safeBuilderId(descriptors.task_id.value, 'task_id'),
    title_digest: digestText(evidenceText(descriptors.title.value, 200, 1_024)),
  });
}

function sanitizeTaskStreamCandidate(value) {
  if (value === null) return null;
  const descriptors = exactDataObject(value, TASK_STREAM_CANDIDATE_KEYS);
  if (
    descriptors.candidate_state.value !== 'proposed'
    || descriptors.source_availability.value !== 'not_loaded'
  ) fail('canary_evidence_failed');
  return Object.freeze({
    draft_id_digest: digestText(safeDraftId(descriptors.draft_id.value)),
    title_digest: digestText(evidenceText(descriptors.title.value, 160, 1_024)),
    summary_digest: digestText(evidenceText(descriptors.summary.value, 2_000, 8_192, false, true)),
    candidate_state: 'proposed',
    source_availability: 'not_loaded',
  });
}

function sanitizeTaskStreamSavedRevision(value) {
  const descriptors = exactDataObject(value, TASK_STREAM_SAVED_REVISION_KEYS);
  return Object.freeze({
    revision_number: safePositiveInteger(descriptors.revision_number.value),
  });
}

function sanitizeTaskStreamCandidateReviewed(source, sequence) {
  const decision = source.decision;
  if (decision !== 'accepted' && decision !== 'rejected') fail('canary_evidence_failed');
  if (decision === 'accepted') {
    if (source.candidate_state !== 'saved') fail('canary_evidence_failed');
    return Object.freeze({
      item_kind: 'candidate_reviewed',
      sequence,
      turn_id: safeBuilderId(source.turn_id, 'turn_id'),
      run_id: safeBuilderId(source.run_id, 'run_id'),
      draft_id: safeDraftId(source.draft_id),
      decision: 'accepted',
      candidate_state: 'saved',
      saved_revision: sanitizeTaskStreamSavedRevision(source.saved_revision),
    });
  }
  if (source.candidate_state !== 'rejected' || source.saved_revision !== null) {
    fail('canary_evidence_failed');
  }
  return Object.freeze({
    item_kind: 'candidate_reviewed',
    sequence,
    turn_id: safeBuilderId(source.turn_id, 'turn_id'),
    run_id: safeBuilderId(source.run_id, 'run_id'),
    draft_id: safeDraftId(source.draft_id),
    decision: 'rejected',
    candidate_state: 'rejected',
    saved_revision: null,
  });
}

function sanitizeTaskStreamPlanReviewed(source, sequence) {
  const decision = source.decision;
  if (
    (decision !== 'approved' && decision !== 'rejected')
    || source.plan_state !== decision
  ) fail('canary_evidence_failed');
  return Object.freeze({
    item_kind: 'plan_reviewed',
    sequence,
    turn_id: safeBuilderId(source.turn_id, 'turn_id'),
    run_id: safeBuilderId(source.run_id, 'run_id'),
    decision,
    plan_state: decision,
  });
}

function sanitizeTaskStreamUserMessage(source, sequence) {
  const messageKind = source.message_kind;
  const mode = source.mode;
  const task = sanitizeTaskStreamTask(source.task);
  if (
    messageKind !== 'submitted'
    && messageKind !== 'steering'
    && messageKind !== 'queued_followup'
  ) fail('canary_evidence_failed');
  if (messageKind === 'submitted') {
    if ((mode !== 'question' && mode !== 'work') || ((mode === 'work') !== (task !== null))) {
      fail('canary_evidence_failed');
    }
  } else if (mode !== null || task !== null) {
    fail('canary_evidence_failed');
  }
  return Object.freeze({
    item_kind: 'user_message',
    sequence,
    turn_id: safeBuilderId(source.turn_id, 'turn_id'),
    message: sanitizeTaskStreamMessage(source.message),
    message_kind: messageKind,
    mode: messageKind === 'submitted' ? mode : null,
    task,
  });
}

function sanitizeTaskStreamTaskBrief(value) {
  const descriptors = exactDataObject(value, TASK_STREAM_TASK_BRIEF_KEYS);
  const status = descriptors.status.value;
  const contextualBuildReady = descriptors.contextual_build_ready.value;
  if (
    (status !== 'discussing' && status !== 'ready')
    || typeof contextualBuildReady !== 'boolean'
    || (status !== 'ready' && contextualBuildReady)
  ) fail('canary_evidence_failed');
  return Object.freeze({
    status,
    summary_digest: digestText(evidenceText(descriptors.summary.value, 4_096, 16 * 1_024, true, true)),
    contextual_build_ready: contextualBuildReady,
  });
}

function sanitizeTaskStreamTaskBriefUpdated(source, sequence) {
  if (source.recorded_state !== 'updated') fail('canary_evidence_failed');
  const task = sanitizeTaskStreamTask(source.task);
  if (task === null) fail('canary_evidence_failed');
  return Object.freeze({
    item_kind: 'task_brief_updated',
    sequence,
    turn_id: safeBuilderId(source.turn_id, 'turn_id'),
    run_id: safeBuilderId(source.run_id, 'run_id'),
    task,
    brief: sanitizeTaskStreamTaskBrief(source.brief),
    recorded_state: 'updated',
  });
}

function sanitizeTaskStreamRunStarted(source, sequence) {
  const attemptNumber = source.attempt_number;
  const retryOfRunId = source.retry_of_run_id === null
    ? null
    : safeBuilderId(source.retry_of_run_id, 'run_id');
  if (
    !Number.isSafeInteger(attemptNumber)
    || attemptNumber < 1
    || attemptNumber > 16
    || (attemptNumber === 1) !== (retryOfRunId === null)
    || source.recorded_state !== 'started'
  ) fail('canary_evidence_failed');
  return Object.freeze({
    item_kind: 'run_started',
    sequence,
    turn_id: safeBuilderId(source.turn_id, 'turn_id'),
    run_id: safeBuilderId(source.run_id, 'run_id'),
    task_id: source.task_id === null ? null : safeBuilderId(source.task_id, 'task_id'),
    attempt_number: attemptNumber,
    retry_of_run_id: retryOfRunId,
    recorded_state: 'started',
  });
}

function sanitizeTaskStreamRunContextSnapshot(source, sequence) {
  const context = exactDataObject(source.context, TASK_STREAM_RUN_CONTEXT_KEYS);
  const route = context.route.value;
  const dispatch = context.dispatch.value;
  const downgradedFrom = context.downgraded_from.value;
  const downgradeReason = context.downgrade_reason.value;
  const brief = context.brief.value;
  const base = context.base.value;
  const permissionResult = context.permission_result.value;
  if (
    !['answer', 'clarify', 'update_brief', 'plan', 'build'].includes(route)
    || !['reply', 'brief_update', 'plan', 'build', 'ask_workspace', 'ask_permission', 'blocked'].includes(dispatch)
    || (downgradedFrom !== null && !['answer', 'clarify', 'update_brief', 'plan', 'build'].includes(downgradedFrom))
    || (downgradeReason !== null && !['ambiguous_build_intent', 'missing_prior_build_context', 'workspace_required'].includes(downgradeReason))
    || !['available', 'not_available'].includes(brief)
    || !['new_project_or_unsaved', 'project_revision'].includes(base)
    || !['not_required', 'allowed', 'ask', 'denied'].includes(permissionResult)
    || context.recorded_state.value !== 'recorded'
    || context.command_execution.value !== 'not_included'
    || context.network_access.value !== 'not_included'
  ) fail('canary_evidence_failed');
  return Object.freeze({
    item_kind: 'run_context_snapshot_recorded',
    sequence,
    turn_id: safeBuilderId(source.turn_id, 'turn_id'),
    run_id: safeBuilderId(source.run_id, 'run_id'),
    task_id: source.task_id === null ? null : safeBuilderId(source.task_id, 'task_id'),
    context: Object.freeze({
      recorded_state: 'recorded',
      route,
      dispatch,
      downgraded_from: downgradedFrom,
      downgrade_reason: downgradeReason,
      brief,
      base,
      permission_result: permissionResult,
      command_execution: 'not_included',
      network_access: 'not_included',
    }),
  });
}

function sanitizeTaskStreamProgrammingRunAdmitted(source, sequence) {
  if (source.recorded_state !== 'admitted') fail('canary_evidence_failed');
  return Object.freeze({
    item_kind: 'programming_run_admitted',
    sequence,
    turn_id: safeBuilderId(source.turn_id, 'turn_id'),
    run_id: safeBuilderId(source.run_id, 'run_id'),
    task_id: safeBuilderId(source.task_id, 'task_id'),
    recorded_state: 'admitted',
  });
}

function sanitizeTaskStreamRunProgress(source, sequence) {
  const stage = source.stage;
  if (
    source.recorded_state !== 'recorded'
    || !TASK_STREAM_RUN_PROGRESS_STAGES.includes(stage)
  ) fail('canary_evidence_failed');
  return Object.freeze({
    item_kind: 'run_progress_recorded',
    sequence,
    turn_id: safeBuilderId(source.turn_id, 'turn_id'),
    run_id: safeBuilderId(source.run_id, 'run_id'),
    stage,
    recorded_state: 'recorded',
  });
}

function sanitizeTaskStreamRunControl(source, sequence) {
  if (source.action !== 'cancel' && source.action !== 'interrupt') fail('canary_evidence_failed');
  return Object.freeze({
    item_kind: 'run_control_requested',
    sequence,
    turn_id: safeBuilderId(source.turn_id, 'turn_id'),
    run_id: safeBuilderId(source.run_id, 'run_id'),
    action: source.action,
  });
}

function sanitizeTaskStreamToolAction(value) {
  if (!Object.hasOwn(TASK_STREAM_TOOL_LABEL_BY_ACTION, value)) fail('canary_evidence_failed');
  return value;
}

function sanitizeTaskStreamToolResource(value, action) {
  const descriptors = exactDataObject(value, TASK_STREAM_TOOL_RESOURCE_KEYS);
  const resourceKind = descriptors.resource_kind.value;
  const allowedKinds = TASK_STREAM_TOOL_RESOURCE_KINDS_BY_ACTION[action];
  if (!allowedKinds.includes(resourceKind)) fail('canary_evidence_failed');
  return Object.freeze({ resource_kind: resourceKind });
}

function sanitizeTaskStreamToolLifecycle(value) {
  const descriptors = exactDataObject(value, TASK_STREAM_TOOL_LIFECYCLE_KEYS);
  if (
    descriptors.permission_admission.value !== 'verified_allowed'
    || descriptors.dispatch_admission.value !== 'not_started'
    || descriptors.execution_admission.value !== 'not_performed'
    || descriptors.result_admission.value !== 'not_recorded'
  ) fail('canary_evidence_failed');
  return Object.freeze({
    permission_admission: 'verified_allowed',
    dispatch_admission: 'not_started',
    execution_admission: 'not_performed',
    result_admission: 'not_recorded',
  });
}

function sanitizeTaskStreamToolResult(value) {
  const descriptors = exactDataObject(value, TASK_STREAM_TOOL_RESULT_KEYS);
  const status = descriptors.status.value;
  const summaryCode = descriptors.summary_code.value;
  const displaySummary = descriptors.display_summary.value;
  if (
    !Object.hasOwn(TASK_STREAM_TOOL_RESULT_CODES_BY_STATUS, status)
    || !TASK_STREAM_TOOL_RESULT_CODES_BY_STATUS[status].includes(summaryCode)
    || TASK_STREAM_TOOL_RESULT_SUMMARY_BY_CODE[summaryCode] !== displaySummary
  ) fail('canary_evidence_failed');
  return Object.freeze({
    status,
    summary_code: summaryCode,
    display_summary: displaySummary,
  });
}

function sanitizeTaskStreamToolResultLifecycle(value) {
  const descriptors = exactDataObject(value, TASK_STREAM_TOOL_RESULT_LIFECYCLE_KEYS);
  if (
    descriptors.result_admission.value !== 'fixed_summary_code_recorded'
    || descriptors.raw_output_admission.value !== 'not_included'
    || descriptors.revision_admission.value !== 'not_created'
  ) fail('canary_evidence_failed');
  return Object.freeze({
    result_admission: 'fixed_summary_code_recorded',
    raw_output_admission: 'not_included',
    revision_admission: 'not_created',
  });
}

function sanitizeTaskStreamToolCallRequested(source, sequence) {
  const action = sanitizeTaskStreamToolAction(source.action);
  const toolLabel = TASK_STREAM_TOOL_LABEL_BY_ACTION[action];
  if (source.recorded_state !== 'requested' || source.tool_label !== toolLabel) {
    fail('canary_evidence_failed');
  }
  return Object.freeze({
    item_kind: 'tool_call_requested',
    sequence,
    turn_id: safeBuilderId(source.turn_id, 'turn_id'),
    run_id: safeBuilderId(source.run_id, 'run_id'),
    step_id: safeBuilderId(source.step_id, 'run_step_id'),
    tool_call_id: safeBuilderId(source.tool_call_id, 'tool_call_id'),
    tool_label: toolLabel,
    action,
    resource: sanitizeTaskStreamToolResource(source.resource, action),
    lifecycle: sanitizeTaskStreamToolLifecycle(source.lifecycle),
    recorded_state: 'requested',
  });
}

function sanitizeTaskStreamToolCallResultRecorded(source, sequence) {
  const action = sanitizeTaskStreamToolAction(source.action);
  const toolLabel = TASK_STREAM_TOOL_LABEL_BY_ACTION[action];
  if (source.recorded_state !== 'recorded' || source.tool_label !== toolLabel) {
    fail('canary_evidence_failed');
  }
  return Object.freeze({
    item_kind: 'tool_call_result_recorded',
    sequence,
    turn_id: safeBuilderId(source.turn_id, 'turn_id'),
    run_id: safeBuilderId(source.run_id, 'run_id'),
    step_id: safeBuilderId(source.step_id, 'run_step_id'),
    tool_call_id: safeBuilderId(source.tool_call_id, 'tool_call_id'),
    tool_label: toolLabel,
    action,
    resource: sanitizeTaskStreamToolResource(source.resource, action),
    result: sanitizeTaskStreamToolResult(source.result),
    lifecycle: sanitizeTaskStreamToolResultLifecycle(source.lifecycle),
    recorded_state: 'recorded',
  });
}

function sanitizeTaskStreamRunCompleted(source, sequence) {
  const terminalStatus = source.terminal_status;
  const resultKind = source.result_kind;
  const failurePhase = source.failure_phase;
  if (
    !['succeeded', 'failed', 'interrupted', 'cancelled'].includes(terminalStatus)
    || !['explanation', 'plan', 'candidate', 'failure'].includes(resultKind)
    || ((terminalStatus === 'succeeded') !== (resultKind !== 'failure'))
    || ![
      'not_applicable',
      'not_recorded',
      'context_ready',
      'provider_request_started',
      'provider_response_received',
      'result_preparing',
    ].includes(failurePhase)
    || ((terminalStatus === 'failed') !== (failurePhase !== 'not_applicable'))
  ) fail('canary_evidence_failed');
  const assistantMessage = source.assistant_message === null
    ? null
    : sanitizeTaskStreamMessage(source.assistant_message);
  const candidate = sanitizeTaskStreamCandidate(source.candidate);
  if (
    (resultKind === 'candidate') !== (candidate !== null)
    || (assistantMessage === null && terminalStatus !== 'interrupted' && terminalStatus !== 'cancelled')
  ) fail('canary_evidence_failed');
  return Object.freeze({
    item_kind: 'run_completed',
    sequence,
    turn_id: safeBuilderId(source.turn_id, 'turn_id'),
    run_id: safeBuilderId(source.run_id, 'run_id'),
    terminal_status: terminalStatus,
    result_kind: resultKind,
    failure_phase: failurePhase,
    assistant_message: assistantMessage,
    candidate,
  });
}

function sanitizeTaskStreamTurnCompleted(source, sequence) {
  const outcome = source.outcome;
  if (![
    'answered',
    'responded',
    'plan_proposed',
    'candidate_ready',
    'failed',
    'interrupted',
    'cancelled',
  ].includes(outcome)) fail('canary_evidence_failed');
  return Object.freeze({
    item_kind: 'turn_completed',
    sequence,
    turn_id: safeBuilderId(source.turn_id, 'turn_id'),
    run_id: source.run_id === null ? null : safeBuilderId(source.run_id, 'run_id'),
    outcome,
  });
}

function exactTaskStreamValues(value, keys) {
  const descriptors = exactDataObject(value, keys);
  const output = {};
  for (const key of keys) output[key] = descriptors[key].value;
  return output;
}

function sanitizeTaskStreamItem(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || isObjectProxy(value)) {
    fail('canary_evidence_failed');
  }
  const itemKindDescriptor = Object.getOwnPropertyDescriptor(value, 'item_kind');
  if (
    !itemKindDescriptor
    || itemKindDescriptor.enumerable !== true
    || !Object.hasOwn(itemKindDescriptor, 'value')
  ) fail('canary_evidence_failed');
  const itemKind = itemKindDescriptor.value;
  let source;
  if (itemKind === 'user_message') {
    source = exactTaskStreamValues(value, TASK_STREAM_USER_MESSAGE_KEYS);
  } else if (itemKind === 'task_brief_updated') {
    source = exactTaskStreamValues(value, TASK_STREAM_TASK_BRIEF_UPDATED_KEYS);
  } else if (itemKind === 'run_started') {
    source = exactTaskStreamValues(value, TASK_STREAM_RUN_STARTED_KEYS);
  } else if (itemKind === 'run_context_snapshot_recorded') {
    source = exactTaskStreamValues(value, TASK_STREAM_RUN_CONTEXT_SNAPSHOT_KEYS);
  } else if (itemKind === 'programming_run_admitted') {
    source = exactTaskStreamValues(value, TASK_STREAM_PROGRAMMING_RUN_ADMITTED_KEYS);
  } else if (itemKind === 'run_progress_recorded') {
    source = exactTaskStreamValues(value, TASK_STREAM_RUN_PROGRESS_KEYS);
  } else if (itemKind === 'run_control_requested') {
    source = exactTaskStreamValues(value, TASK_STREAM_RUN_CONTROL_KEYS);
  } else if (itemKind === 'tool_call_requested') {
    source = exactTaskStreamValues(value, TASK_STREAM_TOOL_CALL_REQUESTED_KEYS);
  } else if (itemKind === 'tool_call_result_recorded') {
    source = exactTaskStreamValues(value, TASK_STREAM_TOOL_CALL_RESULT_RECORDED_KEYS);
  } else if (itemKind === 'run_completed') {
    source = exactTaskStreamValues(value, TASK_STREAM_RUN_COMPLETED_KEYS);
  } else if (itemKind === 'candidate_reviewed') {
    source = exactTaskStreamValues(value, TASK_STREAM_CANDIDATE_REVIEWED_KEYS);
  } else if (itemKind === 'plan_reviewed') {
    source = exactTaskStreamValues(value, TASK_STREAM_PLAN_REVIEWED_KEYS);
  } else if (itemKind === 'turn_completed') {
    source = exactTaskStreamValues(value, TASK_STREAM_TURN_COMPLETED_KEYS);
  } else {
    fail('canary_evidence_failed');
  }
  const sequence = safePositiveInteger(source.sequence);
  if (itemKind === 'user_message') return sanitizeTaskStreamUserMessage(source, sequence);
  if (itemKind === 'task_brief_updated') return sanitizeTaskStreamTaskBriefUpdated(source, sequence);
  if (itemKind === 'run_started') return sanitizeTaskStreamRunStarted(source, sequence);
  if (itemKind === 'run_context_snapshot_recorded') return sanitizeTaskStreamRunContextSnapshot(source, sequence);
  if (itemKind === 'programming_run_admitted') {
    return sanitizeTaskStreamProgrammingRunAdmitted(source, sequence);
  }
  if (itemKind === 'run_progress_recorded') return sanitizeTaskStreamRunProgress(source, sequence);
  if (itemKind === 'run_control_requested') return sanitizeTaskStreamRunControl(source, sequence);
  if (itemKind === 'tool_call_requested') return sanitizeTaskStreamToolCallRequested(source, sequence);
  if (itemKind === 'tool_call_result_recorded') return sanitizeTaskStreamToolCallResultRecorded(source, sequence);
  if (itemKind === 'run_completed') return sanitizeTaskStreamRunCompleted(source, sequence);
  if (itemKind === 'candidate_reviewed') return sanitizeTaskStreamCandidateReviewed(source, sequence);
  if (itemKind === 'plan_reviewed') return sanitizeTaskStreamPlanReviewed(source, sequence);
  return sanitizeTaskStreamTurnCompleted(source, sequence);
}

function taskStreamItemCounts(items) {
  const counts = {
    answer_count: 0,
    candidate_accepted_count: 0,
    candidate_ready_count: 0,
    candidate_rejected_count: 0,
    candidate_reviewed_count: 0,
    candidate_result_count: 0,
    explanation_result_count: 0,
    plan_approved_count: 0,
    plan_ready_count: 0,
    plan_rejected_count: 0,
    plan_result_count: 0,
    plan_reviewed_count: 0,
    programming_run_admitted_count: 0,
    run_context_snapshot_count: 0,
    run_completed_count: 0,
    run_progress_count: 0,
    run_started_count: 0,
    task_brief_update_count: 0,
    tool_request_count: 0,
    tool_result_count: 0,
    tool_result_cancelled_count: 0,
    tool_result_failed_count: 0,
    tool_result_succeeded_count: 0,
    turn_completed_count: 0,
    queued_followup_message_count: 0,
    steering_message_count: 0,
    submitted_message_count: 0,
    user_message_count: 0,
  };
  let latestCandidate = null;
  let latestCandidateReview = null;
  let latestExplanation = null;
  let latestPlan = null;
  let latestPlanReview = null;
  let latestTurn = null;
  const candidateRunCompletedByRunId = new Map();
  const candidateReviewByRunId = new Map();
  const activeRunByTurnId = new Map();
  const planReviewByRunId = new Map();
  const planRunCompletedByRunId = new Map();
  const programmingRunAdmissionByRunId = new Map();
  const progressStageByRunId = new Map();
  const runContextSnapshotByRunId = new Map();
  const runCompletedByRunId = new Map();
  const runStartedByRunId = new Map();
  const toolRequestById = new Map();
  const toolResultById = new Map();
  const turnCompletedByRunId = new Map();
  const userMessageByTurnId = new Map();
  for (const item of items) {
    if (item.item_kind === 'user_message') {
      counts.user_message_count += 1;
      if (item.message_kind === 'submitted') {
        counts.submitted_message_count += 1;
        if (userMessageByTurnId.has(item.turn_id) || activeRunByTurnId.has(item.turn_id)) {
          fail('canary_evidence_failed');
        }
        userMessageByTurnId.set(item.turn_id, item);
      } else {
        if (item.message_kind === 'steering') {
          counts.steering_message_count += 1;
        } else {
          counts.queued_followup_message_count += 1;
        }
        const activeRun = activeRunByTurnId.get(item.turn_id) ?? null;
        if (activeRun === null || activeRun.sequence >= item.sequence) fail('canary_evidence_failed');
      }
    }
    if (item.item_kind === 'task_brief_updated') {
      counts.task_brief_update_count += 1;
      const started = runStartedByRunId.get(item.run_id) ?? null;
      if (
        started === null
        || started.turn_id !== item.turn_id
        || item.sequence <= started.sequence
      ) fail('canary_evidence_failed');
    }
    if (item.item_kind === 'run_started') {
      counts.run_started_count += 1;
      if (runStartedByRunId.has(item.run_id) || activeRunByTurnId.has(item.turn_id)) {
        fail('canary_evidence_failed');
      }
      runStartedByRunId.set(item.run_id, item);
      activeRunByTurnId.set(item.turn_id, item);
    }
    if (item.item_kind === 'run_context_snapshot_recorded') {
      counts.run_context_snapshot_count += 1;
      const started = runStartedByRunId.get(item.run_id) ?? null;
      if (
        started === null
        || started.turn_id !== item.turn_id
        || runCompletedByRunId.has(item.run_id)
        || runContextSnapshotByRunId.has(item.run_id)
        || item.sequence <= started.sequence
      ) fail('canary_evidence_failed');
      runContextSnapshotByRunId.set(item.run_id, item);
    }
    if (item.item_kind === 'programming_run_admitted') {
      counts.programming_run_admitted_count += 1;
      const started = runStartedByRunId.get(item.run_id) ?? null;
      const contextSnapshot = runContextSnapshotByRunId.get(item.run_id) ?? null;
      if (
        started === null
        || contextSnapshot === null
        || started.turn_id !== item.turn_id
        || started.task_id !== item.task_id
        || contextSnapshot.turn_id !== item.turn_id
        || contextSnapshot.task_id !== item.task_id
        || programmingRunAdmissionByRunId.has(item.run_id)
        || progressStageByRunId.has(item.run_id)
        || runCompletedByRunId.has(item.run_id)
        || item.sequence <= contextSnapshot.sequence
      ) fail('canary_evidence_failed');
      programmingRunAdmissionByRunId.set(item.run_id, item);
    }
    if (item.item_kind === 'run_progress_recorded') {
      counts.run_progress_count += 1;
      const started = runStartedByRunId.get(item.run_id) ?? null;
      const previousStage = progressStageByRunId.get(item.run_id) ?? null;
      const previousIndex = previousStage === null
        ? -1
        : TASK_STREAM_RUN_PROGRESS_STAGES.indexOf(previousStage);
      const stageIndex = TASK_STREAM_RUN_PROGRESS_STAGES.indexOf(item.stage);
      if (
        started === null
        || started.turn_id !== item.turn_id
        || runCompletedByRunId.has(item.run_id)
        || stageIndex !== previousIndex + 1
      ) fail('canary_evidence_failed');
      progressStageByRunId.set(item.run_id, item.stage);
    }
    if (item.item_kind === 'tool_call_requested') {
      counts.tool_request_count += 1;
      const started = runStartedByRunId.get(item.run_id) ?? null;
      if (
        started === null
        || started.turn_id !== item.turn_id
        || runCompletedByRunId.has(item.run_id)
        || toolRequestById.has(item.tool_call_id)
      ) fail('canary_evidence_failed');
      toolRequestById.set(item.tool_call_id, item);
    }
    if (item.item_kind === 'tool_call_result_recorded') {
      counts.tool_result_count += 1;
      if (item.result.status === 'succeeded') counts.tool_result_succeeded_count += 1;
      if (item.result.status === 'failed') counts.tool_result_failed_count += 1;
      if (item.result.status === 'cancelled') counts.tool_result_cancelled_count += 1;
      const request = toolRequestById.get(item.tool_call_id) ?? null;
      if (
        request === null
        || request.turn_id !== item.turn_id
        || request.run_id !== item.run_id
        || request.step_id !== item.step_id
        || request.action !== item.action
        || request.resource.resource_kind !== item.resource.resource_kind
        || runCompletedByRunId.has(item.run_id)
        || request.sequence >= item.sequence
        || toolResultById.has(item.tool_call_id)
      ) fail('canary_evidence_failed');
      toolResultById.set(item.tool_call_id, item);
    }
    if (item.item_kind === 'run_completed') {
      counts.run_completed_count += 1;
      const started = runStartedByRunId.get(item.run_id) ?? null;
      if (
        started === null
        || started.turn_id !== item.turn_id
        || started.sequence >= item.sequence
        || runCompletedByRunId.has(item.run_id)
      ) fail('canary_evidence_failed');
      if (
        item.terminal_status === 'failed'
        && item.failure_phase !== (progressStageByRunId.get(item.run_id) ?? 'not_recorded')
      ) fail('canary_evidence_failed');
      runCompletedByRunId.set(item.run_id, item);
      if (activeRunByTurnId.get(item.turn_id)?.run_id === item.run_id) {
        activeRunByTurnId.delete(item.turn_id);
      }
      if (item.result_kind === 'candidate' && item.candidate !== null) {
        counts.candidate_result_count += 1;
        latestCandidate = item;
        candidateRunCompletedByRunId.set(item.run_id, item);
      }
      if (item.result_kind === 'explanation') {
        counts.explanation_result_count += 1;
        latestExplanation = item;
      }
      if (item.result_kind === 'plan') {
        counts.plan_result_count += 1;
        latestPlan = item;
        planRunCompletedByRunId.set(item.run_id, item);
      }
    }
    if (item.item_kind === 'candidate_reviewed') {
      counts.candidate_reviewed_count += 1;
      if (item.decision === 'accepted') counts.candidate_accepted_count += 1;
      if (item.decision === 'rejected') counts.candidate_rejected_count += 1;
      const candidateResult = candidateRunCompletedByRunId.get(item.run_id) ?? null;
      const completedTurn = turnCompletedByRunId.get(item.run_id) ?? null;
      if (
        candidateResult === null
        || completedTurn === null
        || candidateReviewByRunId.has(item.run_id)
        || candidateResult.turn_id !== item.turn_id
        || completedTurn.turn_id !== item.turn_id
        || candidateResult.candidate.draft_id_digest !== digestText(item.draft_id)
        || item.sequence <= candidateResult.sequence
        || item.sequence <= completedTurn.sequence
      ) fail('canary_evidence_failed');
      candidateReviewByRunId.set(item.run_id, item);
      latestCandidateReview = item;
    }
    if (item.item_kind === 'plan_reviewed') {
      counts.plan_reviewed_count += 1;
      if (item.decision === 'approved') counts.plan_approved_count += 1;
      if (item.decision === 'rejected') counts.plan_rejected_count += 1;
      const planResult = planRunCompletedByRunId.get(item.run_id) ?? null;
      const completedTurn = turnCompletedByRunId.get(item.run_id) ?? null;
      if (
        planResult === null
        || completedTurn === null
        || planReviewByRunId.has(item.run_id)
        || planResult.turn_id !== item.turn_id
        || completedTurn.turn_id !== item.turn_id
        || completedTurn.outcome !== 'plan_proposed'
        || item.sequence <= planResult.sequence
        || item.sequence <= completedTurn.sequence
      ) fail('canary_evidence_failed');
      planReviewByRunId.set(item.run_id, item);
      latestPlanReview = item;
    }
    if (item.item_kind === 'turn_completed') {
      counts.turn_completed_count += 1;
      if (item.outcome === 'candidate_ready') counts.candidate_ready_count += 1;
      if (item.outcome === 'answered') counts.answer_count += 1;
      if (item.outcome === 'plan_proposed') counts.plan_ready_count += 1;
      if (item.run_id !== null) turnCompletedByRunId.set(item.run_id, item);
      latestTurn = item;
    }
  }
  return Object.freeze({
    counts: Object.freeze(counts),
    latestCandidate,
    latestCandidateReview,
    latestExplanation,
    latestExplanationRunStarted: latestExplanation === null
      ? null
      : runStartedByRunId.get(latestExplanation.run_id) ?? null,
    latestExplanationUserMessage: latestExplanation === null
      ? null
      : userMessageByTurnId.get(latestExplanation.turn_id) ?? null,
    latestPlan,
    latestPlanReview,
    latestPlanRunStarted: latestPlan === null
      ? null
      : runStartedByRunId.get(latestPlan.run_id) ?? null,
    latestPlanUserMessage: latestPlan === null
      ? null
      : userMessageByTurnId.get(latestPlan.turn_id) ?? null,
    latestTurn,
  });
}

function sanitizeTaskStreamConversation(value, projectId) {
  const descriptors = exactDataObject(value, TASK_STREAM_CONVERSATION_KEYS);
  const conversationId = safeBuilderId(descriptors.conversation_id.value, 'conversation_id');
  if (conversationId.slice('builder-conversation:'.length) !== projectId.slice('builder-project:'.length)) {
    fail('canary_evidence_failed');
  }
  const items = denseEvidenceArray(descriptors.items.value, 128).map(sanitizeTaskStreamItem);
  const windowDescriptors = exactDataObject(descriptors.window.value, TASK_STREAM_WINDOW_KEYS);
  const firstSequence = safePositiveInteger(windowDescriptors.first_sequence.value);
  const lastSequence = safePositiveInteger(windowDescriptors.last_sequence.value);
  const hasEarlier = windowDescriptors.has_earlier.value;
  const headSequence = safePositiveInteger(descriptors.head_sequence.value);
  const activeTurnId = descriptors.recorded_active_turn_id.value === null
    ? null
    : safeBuilderId(descriptors.recorded_active_turn_id.value, 'turn_id');
  if (
    typeof hasEarlier !== 'boolean'
    || items.length === 0
    || lastSequence < firstSequence
    || lastSequence - firstSequence + 1 !== items.length
    || headSequence < lastSequence
  ) fail('canary_evidence_failed');
  for (let index = 0; index < items.length; index += 1) {
    if (items[index].sequence !== firstSequence + index) fail('canary_evidence_failed');
  }
  const itemFacts = taskStreamItemCounts(items);
  return Object.freeze({
    conversation_id: conversationId,
    created_at_ms: safeNonNegativeInteger(descriptors.created_at_ms.value),
    head_sequence: headSequence,
    item_facts: itemFacts,
    item_count: items.length,
    recorded_active_turn_id: activeTurnId,
    window: Object.freeze({
      first_sequence: firstSequence,
      has_earlier: hasEarlier,
      last_sequence: lastSequence,
    }),
  });
}

function sanitizeCatalog(value) {
  const descriptors = exactDataObject(value, CATALOG_RESULT_KEYS);
  const resultVersion = descriptors.result_version.value;
  const operation = descriptors.operation.value;
  const projects = descriptors.projects.value;
  if (
    resultVersion !== 'builder-project-read-result.v1'
    || operation !== 'current_listed'
    || !Array.isArray(projects)
    || isObjectProxy(projects)
  ) fail('canary_evidence_failed');
  const sanitizedProjects = denseEvidenceArray(projects, 256).map(sanitizeCatalogProject);
  for (let index = 1; index < sanitizedProjects.length; index += 1) {
    if (sanitizedProjects[index - 1].project_id >= sanitizedProjects[index].project_id) {
      fail('canary_evidence_failed');
    }
  }
  return Object.freeze({
    authority_evidence: sanitizeAuthorityEvidence(descriptors.authority_evidence.value, true),
    operation,
    projects: Object.freeze(sanitizedProjects),
    result_version: resultVersion,
  });
}

function sanitizeCatalogProject(value) {
  const descriptors = exactDataObject(value, CATALOG_PROJECT_KEYS);
  const project = Object.freeze({
    commit_oid: safeOid(descriptors.commit_oid.value),
    project_id: safeProjectId(descriptors.project_id.value),
    revision_number: safePositiveInteger(descriptors.revision_number.value),
    revision_receipt_digest: safeDigest(descriptors.revision_receipt_digest.value),
    selected_at_ms: safeNonNegativeInteger(descriptors.selected_at_ms.value),
    summary: evidenceText(descriptors.summary.value, 400, 1_600),
    title: evidenceText(descriptors.title.value, 80, 320),
    tree_oid: safeOid(descriptors.tree_oid.value),
  });
  return project;
}

function safeProjectId(value) {
  if (
    typeof value !== 'string'
    || value.length !== PROJECT_ID_LENGTH
    || !PROJECT_ID_PATTERN.test(value)
  ) fail('canary_evidence_failed');
  return value;
}

function sanitizeAuthorityEvidence(value, catalogOnly) {
  const descriptors = exactDataObject(value, AUTHORITY_EVIDENCE_KEYS);
  const evidence = Object.freeze({
    code_authority: descriptors.code_authority.value,
    current_selection: descriptors.current_selection.value,
    product_authority: descriptors.product_authority.value,
    source_read_admission: descriptors.source_read_admission.value,
  });
  if (
    evidence.product_authority !== 'sqlite_product_revision_receipt'
    || evidence.current_selection !== 'sqlite_current_project_revision'
    || evidence.code_authority !== (catalogOnly ? 'not_read_for_catalog' : 'git_commit_tree')
    || evidence.source_read_admission !== (catalogOnly ? 'not_requested' : 'verified')
  ) fail('canary_evidence_failed');
  return evidence;
}

function safeSourcePath(value) {
  const sourcePath = evidenceText(value, 240, 1_024);
  if (
    sourcePath.includes('\\')
    || sourcePath.startsWith('/')
    || /^[A-Za-z]:/u.test(sourcePath)
    || sourcePath.split('/').some((segment) => segment.length === 0 || segment === '.' || segment === '..')
  ) fail('canary_evidence_failed');
  return sourcePath;
}

function sanitizeSourceEntry(value) {
  const descriptors = exactDataObject(value, SOURCE_ENTRY_KEYS);
  const entryKind = descriptors.entry_kind.value;
  if (entryKind !== 'text_file') fail('canary_evidence_failed');
  const entry = Object.freeze({
    content: evidenceText(descriptors.content.value, 512 * 1024, 512 * 1024, true, true),
    entry_kind: 'text_file',
    path: safeSourcePath(descriptors.path.value),
  });
  const contentDigest = safeDigest(descriptors.content_digest.value);
  if (digestCanonical(entry) !== contentDigest) fail('canary_evidence_failed');
  return Object.freeze({ ...entry, content_digest: contentDigest });
}

function sanitizeSourceTree(value) {
  const descriptors = exactDataObject(value, SOURCE_TREE_KEYS);
  if (descriptors.source_tree_version.value !== 'builder-project-source-tree.v1') {
    fail('canary_evidence_failed');
  }
  const files = denseEvidenceArray(descriptors.files.value, 512).map(sanitizeSourceEntry);
  let totalBytes = 0;
  for (let index = 0; index < files.length; index += 1) {
    totalBytes += Buffer.byteLength(files[index].content, 'utf8');
    if (totalBytes > 4 * 1024 * 1024) fail('canary_evidence_failed');
    if (index > 0 && files[index - 1].path >= files[index].path) fail('canary_evidence_failed');
  }
  const unsigned = Object.freeze({
    files: Object.freeze(files),
    source_tree_version: 'builder-project-source-tree.v1',
  });
  const sourceTreeDigest = safeDigest(descriptors.source_tree_digest.value);
  if (digestCanonical(unsigned) !== sourceTreeDigest) fail('canary_evidence_failed');
  return Object.freeze({ ...unsigned, source_tree_digest: sourceTreeDigest });
}

function sanitizeProductRevisionReceipt(value) {
  const descriptors = exactDataObject(value, PRODUCT_RECEIPT_KEYS);
  const body = Object.freeze({
    candidate_digest: safeDigest(descriptors.candidate_digest.value),
    candidate_id: safeBuilderId(descriptors.candidate_id.value, 'candidate_id'),
    commit_oid: safeOid(descriptors.commit_oid.value),
    conversation_id: safeBuilderId(descriptors.conversation_id.value, 'conversation_id'),
    object_format: descriptors.object_format.value,
    parent_oid: safeOid(descriptors.parent_oid.value, true),
    previous_revision_receipt_digest: descriptors.previous_revision_receipt_digest.value === null
      ? null
      : safeDigest(descriptors.previous_revision_receipt_digest.value),
    project_id: safeProjectId(descriptors.project_id.value),
    request_id: safeBuilderId(descriptors.request_id.value, 'request_id'),
    resulting_tree_digest: safeDigest(descriptors.resulting_tree_digest.value),
    review_id: safeBuilderId(descriptors.review_id.value, 'review_id'),
    revision_number: safePositiveInteger(descriptors.revision_number.value),
    run_id: safeBuilderId(descriptors.run_id.value, 'run_id'),
    selected_at_ms: safeNonNegativeInteger(descriptors.selected_at_ms.value),
    semantic_identity_digest: safeDigest(descriptors.semantic_identity_digest.value),
    summary: evidenceText(descriptors.summary.value, 400, 1_600),
    task_id: safeBuilderId(descriptors.task_id.value, 'task_id'),
    title: evidenceText(descriptors.title.value, 80, 320),
    tree_oid: safeOid(descriptors.tree_oid.value),
    turn_id: safeBuilderId(descriptors.turn_id.value, 'turn_id'),
    verification_receipt_digest: safeDigest(descriptors.verification_receipt_digest.value),
  });
  if (
    body.object_format !== 'sha1'
    || (body.revision_number === 1) !== (body.previous_revision_receipt_digest === null)
    || (body.revision_number === 1) !== (body.parent_oid === null)
  ) fail('canary_evidence_failed');
  const revisionReceiptDigest = safeDigest(descriptors.revision_receipt_digest.value);
  if (digestCanonical(body) !== revisionReceiptDigest) fail('canary_evidence_failed');
  return Object.freeze({ ...body, revision_receipt_digest: revisionReceiptDigest });
}

function sanitizeCurrentSummary(value) {
  const descriptors = exactDataObject(value, CURRENT_SUMMARY_KEYS);
  if (descriptors.object_format.value !== 'sha1') fail('canary_evidence_failed');
  return Object.freeze({
    commit_oid: safeOid(descriptors.commit_oid.value),
    object_format: 'sha1',
    parent_oid: safeOid(descriptors.parent_oid.value, true),
    project_id: safeProjectId(descriptors.project_id.value),
    revision_number: safePositiveInteger(descriptors.revision_number.value),
    revision_receipt_digest: safeDigest(descriptors.revision_receipt_digest.value),
    summary: evidenceText(descriptors.summary.value, 400, 1_600),
    title: evidenceText(descriptors.title.value, 80, 320),
    tree_oid: safeOid(descriptors.tree_oid.value),
  });
}

function sanitizeCandidateReceipt(value) {
  const descriptors = exactDataObject(value, CANDIDATE_RECEIPT_KEYS);
  if (
    descriptors.receipt_version.value !== 'builder-git-candidate-receipt.v1'
    || descriptors.repository_version.value !== 'builder-git-project-repository.v1'
    || descriptors.object_format.value !== 'sha1'
    || descriptors.code_authority.value !== 'git_commit_candidate'
    || descriptors.product_revision_admission.value !== 'not_recorded'
    || typeof descriptors.replay.value !== 'boolean'
  ) fail('canary_evidence_failed');
  return Object.freeze({
    candidate_digest: safeDigest(descriptors.candidate_digest.value),
    candidate_id: safeBuilderId(descriptors.candidate_id.value, 'candidate_id'),
    code_authority: 'git_commit_candidate',
    commit_oid: safeOid(descriptors.commit_oid.value),
    conversation_id: safeBuilderId(descriptors.conversation_id.value, 'conversation_id'),
    expected_base_oid: safeOid(descriptors.expected_base_oid.value, true),
    object_format: 'sha1',
    parent_oid: safeOid(descriptors.parent_oid.value, true),
    product_revision_admission: 'not_recorded',
    project_id: safeProjectId(descriptors.project_id.value),
    receipt_version: 'builder-git-candidate-receipt.v1',
    replay: descriptors.replay.value,
    repository_version: 'builder-git-project-repository.v1',
    request_id: safeBuilderId(descriptors.request_id.value, 'request_id'),
    resulting_tree_digest: safeDigest(descriptors.resulting_tree_digest.value),
    run_id: safeBuilderId(descriptors.run_id.value, 'run_id'),
    semantic_identity_digest: safeDigest(descriptors.semantic_identity_digest.value),
    task_id: safeBuilderId(descriptors.task_id.value, 'task_id'),
    tree_oid: safeOid(descriptors.tree_oid.value),
    turn_id: safeBuilderId(descriptors.turn_id.value, 'turn_id'),
    verification_receipt_digest: safeDigest(descriptors.verification_receipt_digest.value),
  });
}

function sanitizeVerificationReceipt(value) {
  const descriptors = exactDataObject(value, VERIFICATION_RECEIPT_KEYS);
  if (
    descriptors.receipt_version.value !== 'builder-git-candidate-verification-receipt.v1'
    || descriptors.repository_version.value !== 'builder-git-project-repository.v1'
    || descriptors.object_format.value !== 'sha1'
    || descriptors.commit_ref_admission.value !== 'verified'
    || descriptors.request_ref_admission.value !== 'verified'
    || descriptors.commit_object_admission.value !== 'verified'
    || descriptors.verification_admission.value !== 'accepted'
  ) fail('canary_evidence_failed');
  return Object.freeze({
    candidate_digest: safeDigest(descriptors.candidate_digest.value),
    candidate_id: safeBuilderId(descriptors.candidate_id.value, 'candidate_id'),
    candidate_tree_oid: safeOid(descriptors.candidate_tree_oid.value),
    commit_object_admission: 'verified',
    commit_oid: safeOid(descriptors.commit_oid.value),
    commit_ref_admission: 'verified',
    conversation_id: safeBuilderId(descriptors.conversation_id.value, 'conversation_id'),
    expected_base_oid: safeOid(descriptors.expected_base_oid.value, true),
    object_format: 'sha1',
    project_id: safeProjectId(descriptors.project_id.value),
    receipt_version: 'builder-git-candidate-verification-receipt.v1',
    repository_version: 'builder-git-project-repository.v1',
    request_id: safeBuilderId(descriptors.request_id.value, 'request_id'),
    request_ref_admission: 'verified',
    resulting_tree_digest: safeDigest(descriptors.resulting_tree_digest.value),
    run_id: safeBuilderId(descriptors.run_id.value, 'run_id'),
    semantic_identity_digest: safeDigest(descriptors.semantic_identity_digest.value),
    task_id: safeBuilderId(descriptors.task_id.value, 'task_id'),
    turn_id: safeBuilderId(descriptors.turn_id.value, 'turn_id'),
    verification_admission: 'accepted',
  });
}

function assertCandidateEvidence(candidate, verification) {
  if (
    candidate.project_id !== verification.project_id
    || candidate.conversation_id !== verification.conversation_id
    || candidate.turn_id !== verification.turn_id
    || candidate.task_id !== verification.task_id
    || candidate.run_id !== verification.run_id
    || candidate.request_id !== verification.request_id
    || candidate.candidate_id !== verification.candidate_id
    || candidate.candidate_digest !== verification.candidate_digest
    || candidate.expected_base_oid !== verification.expected_base_oid
    || candidate.parent_oid !== verification.expected_base_oid
    || candidate.commit_oid !== verification.commit_oid
    || candidate.tree_oid !== verification.candidate_tree_oid
    || candidate.resulting_tree_digest !== verification.resulting_tree_digest
    || candidate.semantic_identity_digest !== verification.semantic_identity_digest
    || candidate.verification_receipt_digest !== digestCanonical(verification)
  ) fail('canary_evidence_failed');
}

function assertRevisionEvidence(receipt, current, sourceTree, candidate, verification) {
  if (
    receipt.project_id !== current.project_id
    || receipt.title !== current.title
    || receipt.summary !== current.summary
    || receipt.revision_receipt_digest !== current.revision_receipt_digest
    || receipt.revision_number !== current.revision_number
    || receipt.object_format !== current.object_format
    || receipt.commit_oid !== current.commit_oid
    || receipt.tree_oid !== current.tree_oid
    || receipt.parent_oid !== current.parent_oid
    || receipt.project_id !== candidate.project_id
    || receipt.conversation_id !== candidate.conversation_id
    || receipt.turn_id !== candidate.turn_id
    || receipt.task_id !== candidate.task_id
    || receipt.run_id !== candidate.run_id
    || receipt.request_id !== candidate.request_id
    || receipt.candidate_id !== candidate.candidate_id
    || receipt.candidate_digest !== candidate.candidate_digest
    || receipt.resulting_tree_digest !== candidate.resulting_tree_digest
    || receipt.resulting_tree_digest !== sourceTree.source_tree_digest
    || receipt.semantic_identity_digest !== candidate.semantic_identity_digest
    || receipt.verification_receipt_digest !== candidate.verification_receipt_digest
    || receipt.commit_oid !== candidate.commit_oid
    || receipt.tree_oid !== candidate.tree_oid
    || receipt.parent_oid !== candidate.parent_oid
    || receipt.project_id !== verification.project_id
    || receipt.commit_oid !== verification.commit_oid
    || receipt.tree_oid !== verification.candidate_tree_oid
  ) fail('canary_evidence_failed');
}

function sanitizeCurrent(value) {
  const descriptors = exactDataObject(value, CURRENT_RESULT_KEYS);
  if (
    descriptors.result_version.value !== 'builder-project-read-result.v1'
    || descriptors.operation.value !== 'current_loaded'
  ) fail('canary_evidence_failed');
  const receipt = sanitizeProductRevisionReceipt(descriptors.product_revision_receipt.value);
  const current = sanitizeCurrentSummary(descriptors.current.value);
  const sourceTree = sanitizeSourceTree(descriptors.source_tree.value);
  const candidate = sanitizeCandidateReceipt(descriptors.git_candidate_receipt.value);
  const verification = sanitizeVerificationReceipt(descriptors.git_verification_receipt.value);
  assertCandidateEvidence(candidate, verification);
  assertRevisionEvidence(receipt, current, sourceTree, candidate, verification);
  return Object.freeze({
    authority_evidence: sanitizeAuthorityEvidence(descriptors.authority_evidence.value, false),
    current,
    git_candidate_receipt: candidate,
    git_verification_receipt: verification,
    operation: 'current_loaded',
    product_revision_receipt: receipt,
    result_version: 'builder-project-read-result.v1',
    source_tree: sourceTree,
  });
}

function projectFromCatalog(evidence, expectedRevisionNumber) {
  const catalog = assertReadEvidence(evidence).catalog;
  if (catalog.projects.length !== 1) fail('canary_evidence_failed');
  const project = catalog.projects[0];
  if (
    project === null
    || typeof project !== 'object'
    || typeof project.project_id !== 'string'
    || project.revision_number !== expectedRevisionNumber
    || typeof project.revision_receipt_digest !== 'string'
    || !DIGEST_PATTERN.test(project.revision_receipt_digest)
    || typeof project.commit_oid !== 'string'
    || !GIT_OID_PATTERN.test(project.commit_oid)
    || typeof project.tree_oid !== 'string'
    || !GIT_OID_PATTERN.test(project.tree_oid)
  ) fail('canary_evidence_failed');
  return project;
}

function projectFromReadEvidence(evidence, expectedRevisionNumber) {
  try {
    return projectFromCatalog(evidence, expectedRevisionNumber);
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError) fail('canary_read_evidence_failed');
    throw error;
  }
}

function assertExactRevision(evidence, expectedProject) {
  const sanitized = assertReadEvidence(evidence);
  const current = sanitized.current;
  if (
    current === null
    || current.product_revision_receipt.project_id !== expectedProject.project_id
    || current.product_revision_receipt.revision_number !== expectedProject.revision_number
    || current.product_revision_receipt.revision_receipt_digest
      !== expectedProject.revision_receipt_digest
    || current.product_revision_receipt.commit_oid !== expectedProject.commit_oid
    || current.product_revision_receipt.tree_oid !== expectedProject.tree_oid
    || current.product_revision_receipt.title !== expectedProject.title
    || current.product_revision_receipt.summary !== expectedProject.summary
    || current.product_revision_receipt.selected_at_ms !== expectedProject.selected_at_ms
  ) fail('canary_evidence_failed');
  return current.product_revision_receipt;
}

function assertRevisionAdvance(previousRevision, nextRevision) {
  if (
    nextRevision.revision_number !== previousRevision.revision_number + 1
    || nextRevision.project_id !== previousRevision.project_id
    || nextRevision.parent_oid !== previousRevision.commit_oid
    || nextRevision.previous_revision_receipt_digest !== previousRevision.revision_receipt_digest
    || nextRevision.commit_oid === previousRevision.commit_oid
    || nextRevision.tree_oid === previousRevision.tree_oid
    || nextRevision.revision_receipt_digest === previousRevision.revision_receipt_digest
  ) fail('canary_evidence_failed');
}

function sameCatalogProjectRevision(left, right) {
  return left.project_id === right.project_id
    && left.revision_number === right.revision_number
    && left.revision_receipt_digest === right.revision_receipt_digest
    && left.commit_oid === right.commit_oid
    && left.tree_oid === right.tree_oid;
}

function taskStreamCheckpointDiagnostic(evidence, checkpoint) {
  const stream = evidence?.task_stream ?? null;
  const conversation = stream?.conversation ?? null;
  const counts = conversation?.item_facts?.counts ?? null;
  return Object.freeze({
    checkpoint,
    current_revision_number: evidence?.current?.product_revision_receipt?.revision_number ?? null,
    conversation_present: conversation !== null,
    conversation_item_count: conversation?.item_count ?? null,
    conversation_head_sequence: conversation?.head_sequence ?? null,
    active_turn_present: conversation?.recorded_active_turn_id !== null,
    candidate_ready_count: counts?.candidate_ready_count ?? null,
    candidate_reviewed_count: counts?.candidate_reviewed_count ?? null,
    run_completed_count: counts?.run_completed_count ?? null,
    turn_completed_count: counts?.turn_completed_count ?? null,
    check_state: stream?.check_run_outcome_projection?.state ?? null,
    check_status: stream?.check_run_outcome_projection?.status ?? null,
    review_status: stream?.review_state_projection?.status ?? null,
    review_check_status: stream?.review_state_projection?.check_status ?? null,
    review_can_save: stream?.review_state_projection?.can_save ?? null,
    activity_phase: stream?.agent_activity_projection?.current?.phase ?? null,
    activity_status: stream?.agent_activity_projection?.current?.status ?? null,
  });
}

function exactRevisionFromReadEvidence(evidence, expectedProject) {
  try {
    return assertExactRevision(evidence, expectedProject);
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError) fail('canary_read_evidence_failed');
    throw error;
  }
}

function safeCount(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 16) fail('canary_evidence_failed');
  return value;
}

function taskStreamPlanOptions(options = {}) {
  const planTurns = safeCount(options.planTurns ?? 0);
  const approvedPlanReviews = safeCount(options.approvedPlanReviews ?? 0);
  const rejectedPlanReviews = safeCount(options.rejectedPlanReviews ?? 0);
  const requireToolActivity = options.requireToolActivity === true;
  if (
    approvedPlanReviews + rejectedPlanReviews > planTurns
    || (requireToolActivity && planTurns < 1)
  ) fail('canary_evidence_failed');
  return Object.freeze({
    approvedPlanReviews,
    planReviews: approvedPlanReviews + rejectedPlanReviews,
    planTurns,
    rejectedPlanReviews,
    requireToolActivity,
  });
}

function expectedTaskStreamItemCount(
  counts,
  expectedCandidateTurns,
  expectedQuestionTurns,
  expectedAcceptedReviews,
  planOptions,
) {
  const expectedTurnCount = expectedCandidateTurns + expectedQuestionTurns + planOptions.planTurns;
  const expectedBaseItemCount = expectedTurnCount * 4
    + expectedAcceptedReviews
    + planOptions.planReviews;
  const expectedActiveRunMessageCount =
    counts.steering_message_count + counts.queued_followup_message_count;
  const expectedUserMessageCount = expectedTurnCount + expectedActiveRunMessageCount;
  const expectedItemCount = expectedBaseItemCount
    + expectedActiveRunMessageCount
    + counts.run_context_snapshot_count
    + counts.programming_run_admitted_count
    + counts.run_progress_count
    + counts.task_brief_update_count
    + counts.tool_request_count
    + counts.tool_result_count;
  return Object.freeze({
    expectedItemCount,
    expectedTurnCount,
    expectedUserMessageCount,
  });
}

function assertTaskStreamPlanCounts(counts, expectedTurnCount, planOptions) {
  if (
    counts.plan_result_count !== planOptions.planTurns
    || counts.plan_ready_count !== planOptions.planTurns
    || counts.plan_reviewed_count !== planOptions.planReviews
    || counts.plan_approved_count !== planOptions.approvedPlanReviews
    || counts.plan_rejected_count !== planOptions.rejectedPlanReviews
    || counts.programming_run_admitted_count !== planOptions.approvedPlanReviews
    || counts.run_context_snapshot_count > expectedTurnCount
    || counts.run_progress_count > expectedTurnCount * TASK_STREAM_RUN_PROGRESS_STAGES.length
    || counts.task_brief_update_count > expectedTurnCount
    || counts.tool_request_count !== counts.tool_result_count
    || (
      planOptions.requireToolActivity
      && (counts.tool_request_count < 1 || counts.tool_result_succeeded_count < 1)
    )
  ) fail('canary_evidence_failed');
}

function planTaskStreamReturnFields(counts, planOptions, latestPlanReview) {
  if (planOptions.planTurns === 0 && planOptions.planReviews === 0) return Object.freeze({});
  return Object.freeze({
    latest_plan_review: latestPlanReview === null ? 'pending' : latestPlanReview.decision,
    plan_approved_count: counts.plan_approved_count,
    plan_ready_count: counts.plan_ready_count,
    plan_rejected_count: counts.plan_rejected_count,
    plan_result_count: counts.plan_result_count,
    plan_reviewed_count: counts.plan_reviewed_count,
    programming_run_admitted_count: counts.programming_run_admitted_count,
    tool_result_succeeded_count: counts.tool_result_succeeded_count,
  });
}

function assertTaskStreamCandidateFacts(
  evidence,
  expectedRevision,
  expectedCandidateTurns,
  expectedQuestionTurns = 0,
  options = {},
) {
  const sanitized = assertReadEvidence(evidence);
  const stream = sanitized.task_stream;
  if (
    stream === null
    || stream.project_id !== expectedRevision.project_id
    || stream.conversation === null
    || stream.conversation.conversation_id !== expectedRevision.conversation_id
    || stream.conversation.recorded_active_turn_id !== null
  ) fail('canary_evidence_failed');

  const conversation = stream.conversation;
  const facts = conversation.item_facts;
  const counts = facts.counts;
  const planOptions = taskStreamPlanOptions(options);
  const expectedAcceptedReviews = expectedRevision.revision_number;
  const { expectedItemCount, expectedTurnCount, expectedUserMessageCount } = expectedTaskStreamItemCount(
    counts,
    expectedCandidateTurns,
    expectedQuestionTurns,
    expectedAcceptedReviews,
    planOptions,
  );
  if (
    conversation.window.first_sequence !== 1
    || conversation.window.last_sequence !== expectedItemCount
    || conversation.window.has_earlier !== false
    || conversation.head_sequence !== expectedItemCount
    || conversation.item_count !== expectedItemCount
    || counts.user_message_count !== expectedUserMessageCount
    || counts.submitted_message_count !== expectedTurnCount
    || counts.run_started_count !== expectedTurnCount
    || counts.run_completed_count !== expectedTurnCount
    || counts.turn_completed_count !== expectedTurnCount
    || counts.candidate_result_count !== expectedCandidateTurns
    || counts.candidate_ready_count !== expectedCandidateTurns
    || counts.explanation_result_count !== expectedQuestionTurns
    || counts.answer_count !== expectedQuestionTurns
    || counts.candidate_reviewed_count !== expectedAcceptedReviews
    || counts.candidate_accepted_count !== expectedAcceptedReviews
    || counts.candidate_rejected_count !== 0
  ) fail('canary_evidence_failed');
  assertTaskStreamPlanCounts(counts, expectedTurnCount, planOptions);

  const latestCandidate = facts.latestCandidate;
  const latestCandidateReview = facts.latestCandidateReview;
  const latestTurn = facts.latestTurn;
  if (
    latestCandidate === null
    || latestCandidateReview === null
    || latestTurn === null
    || latestCandidate.turn_id !== expectedRevision.turn_id
    || latestCandidate.run_id !== expectedRevision.run_id
    || latestCandidate.terminal_status !== 'succeeded'
    || latestCandidate.result_kind !== 'candidate'
    || latestCandidate.candidate === null
    || latestCandidate.candidate.source_availability !== 'not_loaded'
    || latestTurn.turn_id !== expectedRevision.turn_id
    || latestTurn.run_id !== expectedRevision.run_id
    || latestTurn.outcome !== 'candidate_ready'
    || latestCandidateReview.turn_id !== expectedRevision.turn_id
    || latestCandidateReview.run_id !== expectedRevision.run_id
    || latestCandidateReview.decision !== 'accepted'
    || latestCandidateReview.candidate_state !== 'saved'
    || latestCandidateReview.saved_revision.revision_number !== expectedRevision.revision_number
  ) fail('canary_evidence_failed');

  return Object.freeze({
    answer_count: counts.answer_count,
    accepted_review_count: counts.candidate_accepted_count,
    candidate_ready_count: counts.candidate_ready_count,
    candidate_reviewed_count: counts.candidate_reviewed_count,
    candidate_result_count: counts.candidate_result_count,
    explanation_result_count: counts.explanation_result_count,
    head_sequence: conversation.head_sequence,
    item_count: conversation.item_count,
    latest_candidate_bound_to_revision: true,
    latest_candidate_review: 'accepted',
    latest_saved_revision_number: expectedRevision.revision_number,
    ...planTaskStreamReturnFields(counts, planOptions, facts.latestPlanReview),
    run_progress_count: counts.run_progress_count,
    source_availability: 'not_loaded',
    tool_request_count: counts.tool_request_count,
    tool_result_count: counts.tool_result_count,
  });
}

function assertTaskStreamExplanationFacts(
  evidence,
  expectedRevision,
  expectedCandidateTurns,
  expectedQuestionTurns,
  options = {},
) {
  const sanitized = assertReadEvidence(evidence);
  const stream = sanitized.task_stream;
  const current = sanitized.current;
  if (
    stream === null
    || current === null
    || stream.project_id !== expectedRevision.project_id
    || current.product_revision_receipt.project_id !== expectedRevision.project_id
    || current.product_revision_receipt.revision_number !== expectedRevision.revision_number
    || current.product_revision_receipt.revision_receipt_digest !== expectedRevision.revision_receipt_digest
    || current.product_revision_receipt.commit_oid !== expectedRevision.commit_oid
    || current.product_revision_receipt.tree_oid !== expectedRevision.tree_oid
    || expectedQuestionTurns < 1
    || stream.conversation === null
    || stream.conversation.conversation_id !== expectedRevision.conversation_id
    || stream.conversation.recorded_active_turn_id !== null
  ) fail('canary_question_evidence_failed');

  const conversation = stream.conversation;
  const facts = conversation.item_facts;
  const counts = facts.counts;
  const planOptions = taskStreamPlanOptions(options);
  const expectedAcceptedReviews = expectedRevision.revision_number;
  const { expectedItemCount, expectedTurnCount, expectedUserMessageCount } = expectedTaskStreamItemCount(
    counts,
    expectedCandidateTurns,
    expectedQuestionTurns,
    expectedAcceptedReviews,
    planOptions,
  );
  if (
    conversation.window.first_sequence !== 1
    || conversation.window.last_sequence !== expectedItemCount
    || conversation.window.has_earlier !== false
    || conversation.head_sequence !== expectedItemCount
    || conversation.item_count !== expectedItemCount
    || counts.user_message_count !== expectedUserMessageCount
    || counts.submitted_message_count !== expectedTurnCount
    || counts.run_started_count !== expectedTurnCount
    || counts.run_completed_count !== expectedTurnCount
    || counts.turn_completed_count !== expectedTurnCount
    || counts.candidate_result_count !== expectedCandidateTurns
    || counts.candidate_ready_count !== expectedCandidateTurns
    || counts.explanation_result_count !== expectedQuestionTurns
    || counts.answer_count !== expectedQuestionTurns
    || counts.candidate_reviewed_count !== expectedAcceptedReviews
    || counts.candidate_accepted_count !== expectedAcceptedReviews
    || counts.candidate_rejected_count !== 0
  ) fail('canary_question_evidence_failed');
  try {
    assertTaskStreamPlanCounts(counts, expectedTurnCount, planOptions);
  } catch {
    fail('canary_question_evidence_failed');
  }

  const latestExplanation = facts.latestExplanation;
  const latestCandidate = facts.latestCandidate;
  const latestCandidateReview = facts.latestCandidateReview;
  const latestExplanationRunStarted = facts.latestExplanationRunStarted;
  const latestExplanationUserMessage = facts.latestExplanationUserMessage;
  const latestTurn = facts.latestTurn;
  if (
    latestExplanation === null
    || latestCandidate === null
    || latestCandidateReview === null
    || latestExplanationRunStarted === null
    || latestExplanationUserMessage === null
    || latestTurn === null
    || latestCandidate.candidate === null
    || latestCandidate.candidate.source_availability !== 'not_loaded'
    || latestCandidateReview.turn_id !== expectedRevision.turn_id
    || latestCandidateReview.run_id !== expectedRevision.run_id
    || latestCandidateReview.decision !== 'accepted'
    || latestCandidateReview.candidate_state !== 'saved'
    || latestCandidateReview.saved_revision.revision_number !== expectedRevision.revision_number
    || latestExplanationUserMessage.turn_id !== latestExplanation.turn_id
    || latestExplanationUserMessage.message_kind !== 'submitted'
    || latestExplanationUserMessage.mode !== 'question'
    || latestExplanationUserMessage.task !== null
    || latestExplanationRunStarted.turn_id !== latestExplanation.turn_id
    || latestExplanationRunStarted.run_id !== latestExplanation.run_id
    || latestExplanationRunStarted.task_id !== null
    || latestExplanationUserMessage.sequence >= latestExplanationRunStarted.sequence
    || latestExplanationRunStarted.sequence >= latestExplanation.sequence
    || latestExplanation.sequence >= latestTurn.sequence
    || latestExplanation.terminal_status !== 'succeeded'
    || latestExplanation.result_kind !== 'explanation'
    || latestExplanation.candidate !== null
    || latestExplanation.assistant_message === null
    || latestTurn.turn_id !== latestExplanation.turn_id
    || latestTurn.run_id !== latestExplanation.run_id
    || latestTurn.outcome !== 'answered'
  ) fail('canary_question_evidence_failed');

  return Object.freeze({
    answer_count: counts.answer_count,
    accepted_review_count: counts.candidate_accepted_count,
    candidate_ready_count: counts.candidate_ready_count,
    candidate_reviewed_count: counts.candidate_reviewed_count,
    candidate_result_count: counts.candidate_result_count,
    explanation_result_count: counts.explanation_result_count,
    head_sequence: conversation.head_sequence,
    item_count: conversation.item_count,
    latest_candidate_review: 'accepted',
    ...planTaskStreamReturnFields(counts, planOptions, facts.latestPlanReview),
    revision_unchanged: true,
    run_progress_count: counts.run_progress_count,
    source_availability: 'not_loaded',
    tool_request_count: counts.tool_request_count,
    tool_result_count: counts.tool_result_count,
  });
}

function assertTaskStreamPlanFacts(
  evidence,
  expectedRevision,
  expectedCandidateTurns,
  expectedQuestionTurns = 0,
  expectedPlanTurns = 1,
) {
  const sanitized = assertReadEvidence(evidence);
  const stream = sanitized.task_stream;
  const current = sanitized.current;
  if (
    stream === null
    || current === null
    || stream.project_id !== expectedRevision.project_id
    || current.product_revision_receipt.project_id !== expectedRevision.project_id
    || current.product_revision_receipt.revision_number !== expectedRevision.revision_number
    || current.product_revision_receipt.revision_receipt_digest !== expectedRevision.revision_receipt_digest
    || current.product_revision_receipt.commit_oid !== expectedRevision.commit_oid
    || current.product_revision_receipt.tree_oid !== expectedRevision.tree_oid
    || expectedPlanTurns < 1
    || stream.conversation === null
    || stream.conversation.conversation_id !== expectedRevision.conversation_id
    || stream.conversation.recorded_active_turn_id !== null
  ) fail('canary_evidence_failed');

  const conversation = stream.conversation;
  const facts = conversation.item_facts;
  const counts = facts.counts;
  const planOptions = taskStreamPlanOptions({ planTurns: expectedPlanTurns, requireToolActivity: true });
  const expectedAcceptedReviews = expectedRevision.revision_number;
  const { expectedItemCount, expectedTurnCount, expectedUserMessageCount } = expectedTaskStreamItemCount(
    counts,
    expectedCandidateTurns,
    expectedQuestionTurns,
    expectedAcceptedReviews,
    planOptions,
  );
  if (
    conversation.window.first_sequence !== 1
    || conversation.window.last_sequence !== expectedItemCount
    || conversation.window.has_earlier !== false
    || conversation.head_sequence !== expectedItemCount
    || conversation.item_count !== expectedItemCount
    || counts.user_message_count !== expectedUserMessageCount
    || counts.submitted_message_count !== expectedTurnCount
    || counts.run_started_count !== expectedTurnCount
    || counts.run_completed_count !== expectedTurnCount
    || counts.turn_completed_count !== expectedTurnCount
    || counts.candidate_result_count !== expectedCandidateTurns
    || counts.candidate_ready_count !== expectedCandidateTurns
    || counts.explanation_result_count !== expectedQuestionTurns
    || counts.answer_count !== expectedQuestionTurns
    || counts.candidate_reviewed_count !== expectedAcceptedReviews
    || counts.candidate_accepted_count !== expectedAcceptedReviews
    || counts.candidate_rejected_count !== 0
  ) fail('canary_evidence_failed');
  assertTaskStreamPlanCounts(counts, expectedTurnCount, planOptions);

  const latestPlan = facts.latestPlan;
  const latestPlanRunStarted = facts.latestPlanRunStarted;
  const latestPlanUserMessage = facts.latestPlanUserMessage;
  const latestTurn = facts.latestTurn;
  if (
    latestPlan === null
    || latestPlanRunStarted === null
    || latestPlanUserMessage === null
    || latestTurn === null
    || facts.latestPlanReview !== null
    || latestPlanUserMessage.turn_id !== latestPlan.turn_id
    || latestPlanUserMessage.message_kind !== 'submitted'
    || latestPlanUserMessage.mode !== 'work'
    || latestPlanUserMessage.task === null
    || latestPlanRunStarted.turn_id !== latestPlan.turn_id
    || latestPlanRunStarted.run_id !== latestPlan.run_id
    || latestPlanRunStarted.task_id === null
    || latestPlanUserMessage.sequence >= latestPlanRunStarted.sequence
    || latestPlanRunStarted.sequence >= latestPlan.sequence
    || latestPlan.sequence >= latestTurn.sequence
    || latestPlan.terminal_status !== 'succeeded'
    || latestPlan.result_kind !== 'plan'
    || latestPlan.candidate !== null
    || latestPlan.assistant_message === null
    || latestTurn.turn_id !== latestPlan.turn_id
    || latestTurn.run_id !== latestPlan.run_id
    || latestTurn.outcome !== 'plan_proposed'
  ) fail('canary_evidence_failed');

  return Object.freeze({
    answer_count: counts.answer_count,
    accepted_review_count: counts.candidate_accepted_count,
    candidate_ready_count: counts.candidate_ready_count,
    candidate_reviewed_count: counts.candidate_reviewed_count,
    candidate_result_count: counts.candidate_result_count,
    explanation_result_count: counts.explanation_result_count,
    head_sequence: conversation.head_sequence,
    item_count: conversation.item_count,
    latest_plan_review: 'pending',
    plan_approved_count: counts.plan_approved_count,
    plan_ready_count: counts.plan_ready_count,
    plan_rejected_count: counts.plan_rejected_count,
    plan_result_count: counts.plan_result_count,
    plan_reviewed_count: counts.plan_reviewed_count,
    revision_unchanged: true,
    run_progress_count: counts.run_progress_count,
    tool_request_count: counts.tool_request_count,
    tool_result_count: counts.tool_result_count,
    tool_result_succeeded_count: counts.tool_result_succeeded_count,
  });
}

function assertTaskStreamRejectedPlanFacts(
  evidence,
  expectedRevision,
  expectedCandidateTurns,
  expectedQuestionTurns = 0,
  expectedPlanTurns = 1,
) {
  const sanitized = assertReadEvidence(evidence);
  const stream = sanitized.task_stream;
  const current = sanitized.current;
  if (
    stream === null
    || current === null
    || stream.project_id !== expectedRevision.project_id
    || current.product_revision_receipt.project_id !== expectedRevision.project_id
    || current.product_revision_receipt.revision_number !== expectedRevision.revision_number
    || current.product_revision_receipt.revision_receipt_digest !== expectedRevision.revision_receipt_digest
    || current.product_revision_receipt.commit_oid !== expectedRevision.commit_oid
    || current.product_revision_receipt.tree_oid !== expectedRevision.tree_oid
    || expectedPlanTurns < 1
    || stream.conversation === null
    || stream.conversation.conversation_id !== expectedRevision.conversation_id
    || stream.conversation.recorded_active_turn_id !== null
  ) fail('canary_evidence_failed');

  const conversation = stream.conversation;
  const facts = conversation.item_facts;
  const counts = facts.counts;
  const planOptions = taskStreamPlanOptions({
    planTurns: expectedPlanTurns,
    rejectedPlanReviews: 1,
    requireToolActivity: true,
  });
  const expectedAcceptedReviews = expectedRevision.revision_number;
  const { expectedItemCount, expectedTurnCount, expectedUserMessageCount } = expectedTaskStreamItemCount(
    counts,
    expectedCandidateTurns,
    expectedQuestionTurns,
    expectedAcceptedReviews,
    planOptions,
  );
  if (
    conversation.window.first_sequence !== 1
    || conversation.window.last_sequence !== expectedItemCount
    || conversation.window.has_earlier !== false
    || conversation.head_sequence !== expectedItemCount
    || conversation.item_count !== expectedItemCount
    || counts.user_message_count !== expectedUserMessageCount
    || counts.submitted_message_count !== expectedTurnCount
    || counts.run_started_count !== expectedTurnCount
    || counts.run_completed_count !== expectedTurnCount
    || counts.turn_completed_count !== expectedTurnCount
    || counts.candidate_result_count !== expectedCandidateTurns
    || counts.candidate_ready_count !== expectedCandidateTurns
    || counts.explanation_result_count !== expectedQuestionTurns
    || counts.answer_count !== expectedQuestionTurns
    || counts.candidate_reviewed_count !== expectedAcceptedReviews
    || counts.candidate_accepted_count !== expectedAcceptedReviews
    || counts.candidate_rejected_count !== 0
  ) fail('canary_evidence_failed');
  assertTaskStreamPlanCounts(counts, expectedTurnCount, planOptions);

  const latestPlan = facts.latestPlan;
  const latestPlanReview = facts.latestPlanReview;
  const latestTurn = facts.latestTurn;
  if (
    latestPlan === null
    || latestPlanReview === null
    || latestTurn === null
    || latestPlan.terminal_status !== 'succeeded'
    || latestPlan.result_kind !== 'plan'
    || latestPlan.candidate !== null
    || latestPlan.assistant_message === null
    || latestTurn.turn_id !== latestPlan.turn_id
    || latestTurn.run_id !== latestPlan.run_id
    || latestTurn.outcome !== 'plan_proposed'
    || latestPlanReview.turn_id !== latestPlan.turn_id
    || latestPlanReview.run_id !== latestPlan.run_id
    || latestPlanReview.decision !== 'rejected'
    || latestPlanReview.plan_state !== 'rejected'
    || latestTurn.sequence >= latestPlanReview.sequence
  ) fail('canary_evidence_failed');

  return Object.freeze({
    answer_count: counts.answer_count,
    accepted_review_count: counts.candidate_accepted_count,
    candidate_ready_count: counts.candidate_ready_count,
    candidate_reviewed_count: counts.candidate_reviewed_count,
    candidate_result_count: counts.candidate_result_count,
    explanation_result_count: counts.explanation_result_count,
    head_sequence: conversation.head_sequence,
    item_count: conversation.item_count,
    ...planTaskStreamReturnFields(counts, planOptions, latestPlanReview),
    revision_unchanged: true,
    run_progress_count: counts.run_progress_count,
    tool_request_count: counts.tool_request_count,
    tool_result_count: counts.tool_result_count,
    tool_result_succeeded_count: counts.tool_result_succeeded_count,
  });
}

function assertTaskStreamPendingCandidateFacts(
  evidence,
  expectedSavedRevision,
  expectedCandidateTurns,
  expectedQuestionTurns = 0,
  options = {},
) {
  const sanitized = assertReadEvidence(evidence);
  const stream = sanitized.task_stream;
  const current = sanitized.current;
  if (
    stream === null
    || current === null
    || stream.project_id !== expectedSavedRevision.project_id
    || current.product_revision_receipt.project_id !== expectedSavedRevision.project_id
    || current.product_revision_receipt.revision_number !== expectedSavedRevision.revision_number
    || current.product_revision_receipt.revision_receipt_digest
      !== expectedSavedRevision.revision_receipt_digest
    || current.product_revision_receipt.commit_oid !== expectedSavedRevision.commit_oid
    || current.product_revision_receipt.tree_oid !== expectedSavedRevision.tree_oid
    || expectedCandidateTurns <= expectedSavedRevision.revision_number
    || stream.conversation === null
    || stream.conversation.conversation_id !== expectedSavedRevision.conversation_id
    || stream.conversation.recorded_active_turn_id !== null
  ) fail('canary_evidence_failed');

  const conversation = stream.conversation;
  const facts = conversation.item_facts;
  const counts = facts.counts;
  const planOptions = taskStreamPlanOptions(options);
  const expectedAcceptedReviews = expectedSavedRevision.revision_number;
  const { expectedItemCount, expectedTurnCount, expectedUserMessageCount } = expectedTaskStreamItemCount(
    counts,
    expectedCandidateTurns,
    expectedQuestionTurns,
    expectedAcceptedReviews,
    planOptions,
  );
  if (
    conversation.window.first_sequence !== 1
    || conversation.window.last_sequence !== expectedItemCount
    || conversation.window.has_earlier !== false
    || conversation.head_sequence !== expectedItemCount
    || conversation.item_count !== expectedItemCount
    || counts.user_message_count !== expectedUserMessageCount
    || counts.submitted_message_count !== expectedTurnCount
    || counts.run_started_count !== expectedTurnCount
    || counts.run_completed_count !== expectedTurnCount
    || counts.turn_completed_count !== expectedTurnCount
    || counts.candidate_result_count !== expectedCandidateTurns
    || counts.candidate_ready_count !== expectedCandidateTurns
    || counts.explanation_result_count !== expectedQuestionTurns
    || counts.answer_count !== expectedQuestionTurns
    || counts.candidate_reviewed_count !== expectedAcceptedReviews
    || counts.candidate_accepted_count !== expectedAcceptedReviews
    || counts.candidate_rejected_count !== 0
  ) fail('canary_evidence_failed');
  assertTaskStreamPlanCounts(counts, expectedTurnCount, planOptions);

  const latestCandidate = facts.latestCandidate;
  const latestCandidateReview = facts.latestCandidateReview;
  const latestTurn = facts.latestTurn;
  if (
    latestCandidate === null
    || latestTurn === null
    || latestCandidate.turn_id === expectedSavedRevision.turn_id
    || latestCandidate.run_id === expectedSavedRevision.run_id
    || latestCandidate.terminal_status !== 'succeeded'
    || latestCandidate.result_kind !== 'candidate'
    || latestCandidate.candidate === null
    || latestCandidate.candidate.source_availability !== 'not_loaded'
    || latestTurn.turn_id !== latestCandidate.turn_id
    || latestTurn.run_id !== latestCandidate.run_id
    || latestTurn.outcome !== 'candidate_ready'
    || latestCandidateReview === null
    || latestCandidateReview.decision !== 'accepted'
    || latestCandidateReview.candidate_state !== 'saved'
    || latestCandidateReview.saved_revision.revision_number !== expectedSavedRevision.revision_number
    || latestCandidateReview.run_id === latestCandidate.run_id
  ) fail('canary_evidence_failed');

  return Object.freeze({
    answer_count: counts.answer_count,
    accepted_review_count: counts.candidate_accepted_count,
    candidate_ready_count: counts.candidate_ready_count,
    candidate_reviewed_count: counts.candidate_reviewed_count,
    candidate_result_count: counts.candidate_result_count,
    explanation_result_count: counts.explanation_result_count,
    head_sequence: conversation.head_sequence,
    item_count: conversation.item_count,
    latest_candidate_review: 'pending',
    latest_candidate_distinct_from_saved_revision: true,
    ...planTaskStreamReturnFields(counts, planOptions, facts.latestPlanReview),
    run_progress_count: counts.run_progress_count,
    saved_revision_number: expectedSavedRevision.revision_number,
    source_availability: 'not_loaded',
    tool_request_count: counts.tool_request_count,
    tool_result_count: counts.tool_result_count,
  });
}

function networkRecorder() {
  const unexpected = [];
  let attachedApplicationCount = 0;
  function observe(request) {
    const url = request.url();
    if (!/^(?:https?|wss?):/iu.test(url)) return;
    unexpected.push(true);
  }
  return Object.freeze({
    attachApplication(app) {
      if (app === null || typeof app !== 'object' || typeof app.context !== 'function') return false;
      let context;
      try {
        context = app.context();
      } catch {
        return false;
      }
      if (context === null || typeof context !== 'object' || typeof context.on !== 'function') return false;
      context.on('request', observe);
      attachedApplicationCount += 1;
      return true;
    },
    attachPage(page) {
      page.on('request', observe);
    },
    snapshot() {
      return Object.freeze({
        renderer_context_observer_count: attachedApplicationCount,
        renderer_unexpected_network_count: unexpected.length,
      });
    },
  });
}

function summarizePng(buffer, pngModule = PNG) {
  let image;
  try {
    image = pngModule.sync.read(buffer);
  } catch {
    fail('canary_evidence_failed');
  }
  let coloredPixels = 0;
  const colors = new Set();
  for (let offset = 0; offset < image.data.length; offset += 4) {
    const alpha = image.data[offset + 3];
    if (alpha === 0) continue;
    const red = image.data[offset];
    const green = image.data[offset + 1];
    const blue = image.data[offset + 2];
    colors.add(`${red},${green},${blue},${alpha}`);
    if (!(red > 248 && green > 248 && blue > 248)) coloredPixels += 1;
  }
  if (colors.size < 2 || coloredPixels < 16) fail('canary_evidence_failed');
  return Object.freeze({
    colored_pixels: coloredPixels,
    height: image.height,
    pixel_digest: digestText(buffer),
    unique_colors: colors.size,
    width: image.width,
  });
}

function summarizePreviewPng(buffer, code) {
  try {
    return summarizePng(buffer);
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError) fail(code);
    throw error;
  }
}

async function hasVisiblePreviewSurface(page) {
  try {
    await page.locator(SELECTORS.preview).waitFor({ state: 'visible', timeout: 750 });
    return true;
  } catch {
    // The preview may be hidden behind the artifact workspace until the canary opens it.
  }
  try {
    await page.locator(SELECTORS.previewUnavailable).waitFor({ state: 'visible', timeout: 750 });
    return true;
  } catch {
    return false;
  }
}

async function readArtifactActiveTab(page) {
  try {
    const activeTab = await page.locator(SELECTORS.artifactSidebar)
      .getAttribute('data-builder-artifact-tab-active');
    return typeof activeTab === 'string' ? activeTab : null;
  } catch {
    return null;
  }
}

async function waitForArtifactPreviewTab(page) {
  const deadline = Date.now() + 3_000;
  while (Date.now() <= deadline) {
    if (await readArtifactActiveTab(page) === 'preview') return true;
    if (await hasVisiblePreviewSurface(page)) return true;
    if (typeof page.waitForTimeout === 'function') {
      await page.waitForTimeout(100);
    } else {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  return false;
}

const PREVIEW_SURFACE_DIAGNOSTIC_SELECTORS = Object.freeze({
  artifact_sidebar: SELECTORS.artifactSidebar,
  preview_surface: SELECTORS.preview,
  preview_unavailable: SELECTORS.previewUnavailable,
  result_flow: SELECTORS.resultFlow,
  workspace_control_preview: SELECTORS.workspaceControlPreview,
  workspace_menu_button: SELECTORS.workspaceMenuButton,
});

function boundedSelectorCount(value) {
  if (!Number.isSafeInteger(value) || value < 0) return 0;
  return Math.min(value, 99);
}

async function previewSurfaceSelectorDiagnostic(page, selector) {
  const locator = page.locator(selector);
  let count = 0;
  try {
    count = boundedSelectorCount(await locator.count());
  } catch {
    count = 0;
  }
  let visible = false;
  if (count > 0) {
    try {
      await locator.waitFor({ state: 'visible', timeout: 250 });
      visible = true;
    } catch {
      visible = false;
    }
  }
  return Object.freeze({ count, visible });
}

async function collectPreviewSurfaceDiagnostic(page) {
  const selectors = {};
  for (const [name, selector] of Object.entries(PREVIEW_SURFACE_DIAGNOSTIC_SELECTORS)) {
    selectors[name] = await previewSurfaceSelectorDiagnostic(page, selector);
  }
  return Object.freeze({
    diagnostic_version: 'builder-canary-preview-surface-diagnostic.v1',
    artifact_active_tab: await readArtifactActiveTab(page),
    selectors: Object.freeze(selectors),
  });
}

async function failPreviewSurface(page) {
  failWithDiagnostic('canary_preview_surface_failed', await collectPreviewSurfaceDiagnostic(page));
}

async function openPreviewSurfaceViaUi(page) {
  if (await hasVisiblePreviewSurface(page)) return;
  const attempts = [
    async () => {
      await page.locator(SELECTORS.workspaceMenuButton).click({ timeout: 3000 });
      await page.locator(SELECTORS.workspaceMenu).waitFor({ state: 'visible', timeout: 3000 });
      await page.locator(SELECTORS.workspaceControlPreview).click({ timeout: 3000 });
      if (await waitForArtifactPreviewTab(page)) return true;
      return false;
    },
  ];
  for (const attempt of attempts) {
    try {
      if (await attempt()) return;
      if (await hasVisiblePreviewSurface(page)) return;
    } catch {
      // Try the next public preview entry point before reporting the fixed preview surface failure.
    }
  }
}

async function capturePreviewEvidence(page, gate, attempt = 0) {
  try {
    gate.assertAllowed();
    await openPreviewSurfaceViaUi(page);
    const unavailable = page.locator(SELECTORS.previewUnavailable);
    const unavailableCount = await unavailable.count();
    if (unavailableCount > 0) {
      try {
        await unavailable.waitFor({ state: 'visible' });
      } catch {
        await failPreviewSurface(page);
      }
      const unavailableText = await unavailable.textContent();
      if (
        typeof unavailableText !== 'string'
        || !unavailableText.includes('Preview unavailable')
        || !unavailableText.includes('The files were generated')
        || !unavailableText.includes('live preview support')
        || !unavailableText.includes('Review')
        || !/(?:3D|WebGL|JavaScript modules|canvas|backend|live preview)/iu.test(unavailableText)
        || REVIEW_DIFF_INTERNAL_EVIDENCE_PATTERN.test(unavailableText)
      ) fail('canary_preview_unavailable_text_failed');
      const screenshot = await unavailable.screenshot();
      return Object.freeze({
        ...summarizePreviewPng(screenshot, 'canary_preview_unavailable_pixels_failed'),
        frame_body_nonempty: false,
        preview_mode: 'preview_unavailable',
        runtime_preview_limit_explained: true,
        sandbox: 'not_mounted',
        script_src: 'none',
        srcdoc_digest: digestText(unavailableText),
        static_preview_limitation_visible: true,
      });
    }
    const section = page.locator(SELECTORS.preview);
    try {
      await section.waitFor({ state: 'visible' });
    } catch {
      await failPreviewSurface(page);
    }
    const limitation = page.locator(SELECTORS.previewLimitation);
    const limitationCount = await limitation.count();
    const limitationVisible = limitationCount > 0;
    let limitationText = null;
    if (limitationVisible) {
      try {
        await limitation.waitFor({ state: 'visible' });
      } catch {
        fail('canary_preview_limitation_failed');
      }
      limitationText = await limitation.textContent();
    }
    const runtimeBlocked = await page.locator(SELECTORS.previewRuntimeBlocked).count();
    if (runtimeBlocked > 0) {
      if (
        !limitationVisible
        || typeof limitationText !== 'string'
        || !limitationText.includes('Preview unavailable here')
        || !limitationText.includes('The files were generated')
        || !limitationText.includes('live preview support')
        || !limitationText.includes('Use the review workspace before saving')
        || !/(?:3D|WebGL|JavaScript modules|canvas|live preview)/iu.test(limitationText)
        || REVIEW_DIFF_INTERNAL_EVIDENCE_PATTERN.test(limitationText)
      ) fail('canary_preview_runtime_text_failed');
      const screenshot = await section.screenshot();
      return Object.freeze({
        ...summarizePreviewPng(screenshot, 'canary_preview_pixels_failed'),
        frame_body_nonempty: false,
        preview_mode: 'runtime_unavailable',
        runtime_preview_limit_explained: true,
        sandbox: 'not_mounted',
        script_src: 'none',
        srcdoc_digest: digestText(limitationText),
        static_preview_limitation_visible: true,
      });
    }
    if (limitationVisible) {
      if (
        typeof limitationText !== 'string'
        || !limitationText.includes('Static preview')
        || !limitationText.includes('HTML and CSS are shown here')
        || !limitationText.includes('JavaScript is disabled')
        || !limitationText.includes('live preview support')
        || limitationText.includes('Preview may look blank')
        || REVIEW_DIFF_INTERNAL_EVIDENCE_PATTERN.test(limitationText)
      ) fail('canary_preview_limitation_text_failed');
    } else {
      const previewText = await section.textContent();
      if (
        typeof previewText !== 'string'
        || !previewText.includes('Static preview')
        || REVIEW_DIFF_INTERNAL_EVIDENCE_PATTERN.test(previewText)
      ) fail('canary_preview_limitation_text_failed');
    }
    const frame = page.locator(SELECTORS.previewFrame);
    try {
      await frame.waitFor({ state: 'visible' });
    } catch {
      fail('canary_preview_frame_contract_failed');
    }
    const sandbox = await frame.getAttribute('sandbox');
    const srcdoc = await frame.getAttribute('srcdoc');
    if (
      sandbox !== ''
      || typeof srcdoc !== 'string'
      || !/Content-Security-Policy/iu.test(srcdoc)
      || !/script-src 'none'/iu.test(srcdoc)
    ) fail('canary_preview_frame_contract_failed');
    const body = frame.contentFrame().locator('body');
    const bodyText = await body.innerText();
    if (typeof bodyText !== 'string' || bodyText.trim().length === 0) fail('canary_preview_frame_body_failed');
    const screenshot = await frame.screenshot();
    return Object.freeze({
      ...summarizePreviewPng(screenshot, 'canary_preview_pixels_failed'),
      frame_body_nonempty: true,
      preview_mode: 'static_frame',
      sandbox: 'empty',
      script_src: 'none',
      static_preview_limitation_visible: limitationVisible,
      runtime_preview_limit_explained: limitationVisible,
      static_preview_mode_visible: true,
      srcdoc_digest: digestText(srcdoc),
    });
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError
      && error.code === 'canary_secret_source_invalid') throw error;
    if (error instanceof BuilderPackagedCanaryError && PREVIEW_FAILURE_CODES.has(error.code)) throw error;
    if (attempt < 7 && typeof page.waitForTimeout === 'function') {
      await page.waitForTimeout(100);
      return capturePreviewEvidence(page, gate, attempt + 1);
    }
    failWithDiagnostic('canary_preview_failed', {
      ...(await collectPreviewSurfaceDiagnostic(page)),
      recoverable_preview_error: previewRecoverableErrorDiagnostic(error),
    });
  }
}

function previewRecoverableErrorDiagnostic(error) {
  if (error === null || typeof error !== 'object') return null;
  const name = typeof error.constructor?.name === 'string' ? error.constructor.name : null;
  return Object.freeze({ name });
}

function samePreviewEvidence(left, right) {
  return left.preview_mode === right.preview_mode && left.srcdoc_digest === right.srcdoc_digest;
}

function staticPreviewSrcdocChanged(left, right) {
  if (left.preview_mode !== 'static_frame' || right.preview_mode !== 'static_frame') return true;
  return left.srcdoc_digest !== right.srcdoc_digest;
}

function previewComparisonDiagnostic(comparison, before, after) {
  return Object.freeze({
    diagnostic_version: 'builder-canary-preview-comparison-diagnostic.v1',
    comparison,
    before: Object.freeze({
      preview_mode: before.preview_mode,
      srcdoc_digest: before.srcdoc_digest,
    }),
    after: Object.freeze({
      preview_mode: after.preview_mode,
      srcdoc_digest: after.srcdoc_digest,
    }),
  });
}

function pendingRestartComparisonDiagnostic({
  comparison,
  beforeTaskStream = null,
  afterEvidence = null,
  afterTaskStream = null,
  beforePreview = null,
  afterPreview = null,
} = {}) {
  return Object.freeze({
    diagnostic_version: 'builder-canary-pending-restart-comparison-diagnostic.v1',
    comparison,
    before_task_stream_digest: beforeTaskStream === null ? null : digestCanonical(beforeTaskStream),
    after_task_stream_digest: afterTaskStream === null ? null : digestCanonical(afterTaskStream),
    after_task_stream: taskStreamCheckpointDiagnostic(afterEvidence, 'pending_restart_after'),
    preview: beforePreview === null || afterPreview === null
      ? null
      : previewComparisonDiagnostic('pending_restart_preview', beforePreview, afterPreview),
  });
}

async function openProjectFromCatalogById(page, project, failureCode = 'canary_restart_failed') {
  try {
    const projectId = safeProjectId(project.project_id);
    const catalog = page.locator(SELECTORS.projectCatalog);
    await catalog.waitFor({ state: 'visible' });
    const projectButton = catalog.locator(`button${attributeEqualsSelector('data-builder-project-id', projectId)}`);
    await projectButton.waitFor({ state: 'visible' });
    await projectButton.getByText(project.title, { exact: true }).waitFor({ state: 'visible' });
    await projectButton.getByText(project.summary, { exact: true }).waitFor({ state: 'visible' });
    await projectButton.getByText(`Version ${project.revision_number}`, { exact: true }).waitFor({ state: 'visible' });
    await projectButton.click();
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError) throw error;
    fail(failureCode);
  }
}

async function installPendingRestartRestoreObserver(page) {
  try {
    await page.evaluate(() => {
      const root = globalThis.clawfabricBuilder;
      const observed = {
        restore_draft_calls: 0,
        restore_draft_error_codes: [],
        restore_draft_ok_count: 0,
        restore_draft_result_versions: [],
        task_stream_read_calls: 0,
        task_stream_read_project_ids: [],
      };
      Object.defineProperty(globalThis, '__clawfabricPendingRestartRestoreObserver', {
        configurable: true,
        enumerable: false,
        value: observed,
        writable: true,
      });
      if (root?.codeGenerator?.restoreDraft && root.codeGenerator.restoreDraft.__canaryObserved !== true) {
        const originalRestoreDraft = root.codeGenerator.restoreDraft.bind(root.codeGenerator);
        const observedRestoreDraft = async (request) => {
          observed.restore_draft_calls += 1;
          const response = await originalRestoreDraft(request);
          if (response?.ok === true) {
            observed.restore_draft_ok_count += 1;
            if (typeof response?.result?.result_version === 'string') {
              observed.restore_draft_result_versions.push(response.result.result_version);
            }
          } else if (typeof response?.error?.code === 'string') {
            observed.restore_draft_error_codes.push(response.error.code);
          }
          return response;
        };
        Object.defineProperty(observedRestoreDraft, '__canaryObserved', { value: true });
        root.codeGenerator.restoreDraft = observedRestoreDraft;
      }
      if (root?.taskStream?.read && root.taskStream.read.__canaryObserved !== true) {
        const originalRead = root.taskStream.read.bind(root.taskStream);
        const observedRead = async (request) => {
          observed.task_stream_read_calls += 1;
          observed.task_stream_read_project_ids.push(
            typeof request?.project_id === 'string' ? request.project_id : null,
          );
          return await originalRead(request);
        };
        Object.defineProperty(observedRead, '__canaryObserved', { value: true });
        root.taskStream.read = observedRead;
      }
    });
  } catch {
    /* diagnostic observer cannot affect canary behavior */
  }
}

async function readPendingRestartRestoreObserver(page) {
  try {
    return await page.evaluate(() => {
      const observed = globalThis.__clawfabricPendingRestartRestoreObserver;
      if (observed === null || typeof observed !== 'object') return null;
      return {
        restore_draft_calls: Number.isSafeInteger(observed.restore_draft_calls)
          ? observed.restore_draft_calls
          : null,
        restore_draft_error_codes: Array.isArray(observed.restore_draft_error_codes)
          ? observed.restore_draft_error_codes.filter((code) => typeof code === 'string').slice(-5)
          : [],
        restore_draft_ok_count: Number.isSafeInteger(observed.restore_draft_ok_count)
          ? observed.restore_draft_ok_count
          : null,
        restore_draft_result_versions: Array.isArray(observed.restore_draft_result_versions)
          ? observed.restore_draft_result_versions.filter((version) => typeof version === 'string').slice(-5)
          : [],
        task_stream_read_calls: Number.isSafeInteger(observed.task_stream_read_calls)
          ? observed.task_stream_read_calls
          : null,
        task_stream_read_project_id_count: Array.isArray(observed.task_stream_read_project_ids)
          ? observed.task_stream_read_project_ids.length
          : null,
        task_stream_read_project_ids: Array.isArray(observed.task_stream_read_project_ids)
          ? observed.task_stream_read_project_ids
            .filter((projectId) => projectId === null || typeof projectId === 'string')
            .slice(-5)
          : [],
      };
    });
  } catch {
    return null;
  }
}

async function readPendingRestartUiDiagnostic(page) {
  try {
    return await page.evaluate((selectors) => {
      const text = (element) => (element?.textContent ?? '').replace(/\s+/gu, ' ').trim() || null;
      const visible = (element) => {
        if (!(element instanceof globalThis.HTMLElement)) return false;
        const style = globalThis.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.visibility !== 'hidden'
          && style.display !== 'none'
          && rect.width > 0
          && rect.height > 0;
      };
      const pageDocument = globalThis.document;
      const projectPage = pageDocument.querySelector(selectors.projectPage);
      const historyPreview = pageDocument.querySelector(selectors.historyPreview);
      const unsavedDraft = pageDocument.querySelector(selectors.unsavedDraft);
      const saveVersion = pageDocument.querySelector(selectors.saveVersion);
      const currentVersion = pageDocument.querySelector(selectors.currentVersion);
      const showCurrentButton = Array.from(pageDocument.querySelectorAll('button'))
        .find((button) => text(button) === 'Back to current') ?? null;
      const visibleButtons = Array.from(pageDocument.querySelectorAll('button'))
        .filter((button) => visible(button))
        .map((button) => text(button))
        .filter((buttonText) => buttonText !== null)
        .slice(0, 20);
      return {
        project_page_status: projectPage?.getAttribute('data-builder-project-status') ?? null,
        project_page_error: projectPage?.getAttribute('data-builder-project-error') ?? null,
        history_preview_visible: visible(historyPreview),
        history_preview_text: text(historyPreview),
        show_current_visible: visible(showCurrentButton),
        unsaved_draft_visible: visible(unsavedDraft),
        unsaved_draft_text: text(unsavedDraft),
        save_version_visible: visible(saveVersion),
        save_version_text: text(saveVersion),
        current_version_visible: visible(currentVersion),
        current_version_text: text(currentVersion),
        visible_buttons: visibleButtons,
      };
    }, SELECTORS);
  } catch {
    return Object.freeze({ diagnostic_unavailable: true });
  }
}

async function readPendingRestartAppScanDiagnostic(page, currentProject) {
  try {
    return await page.evaluate(async (request) => {
      const root = globalThis.clawfabricBuilder;
      const stream = await root?.taskStream?.read?.({ project_id: request.projectId });
      const items = Array.isArray(stream?.conversation?.items) ? stream.conversation.items : [];
      const summarizeItem = (item, index) => {
        const candidate = item?.candidate && typeof item.candidate === 'object'
          ? item.candidate
          : null;
        return {
          candidate_draft_tail: typeof candidate?.draft_id === 'string'
            ? candidate.draft_id.slice(-8)
            : null,
          candidate_state: item?.candidate_state ?? null,
          decision: item?.decision ?? null,
          failure_phase: item?.failure_phase ?? null,
          index,
          item_kind: item?.item_kind ?? null,
          keys: item && typeof item === 'object'
            ? Object.keys(item).sort()
            : [],
          outcome: item?.outcome ?? null,
          result_kind: item?.result_kind ?? null,
          run_id_tail: typeof item?.run_id === 'string' ? item.run_id.slice(-8) : null,
          sequence: item?.sequence ?? null,
          terminal_status: item?.terminal_status ?? null,
          turn_id_tail: typeof item?.turn_id === 'string' ? item.turn_id.slice(-8) : null,
        };
      };
      const reviewedDraftIds = new Set();
      const inspected = [];
      let selected = null;
      for (let index = items.length - 1; index >= 0; index -= 1) {
        const item = items[index];
        if (item?.item_kind === 'candidate_reviewed' && typeof item.draft_id === 'string') {
          reviewedDraftIds.add(item.draft_id);
          inspected.push({
            candidate_state: item.candidate_state ?? null,
            decision: item.decision ?? null,
            draft_id_tail: item.draft_id.slice(-8),
            index,
            item_kind: 'candidate_reviewed',
            run_id_tail: typeof item.run_id === 'string' ? item.run_id.slice(-8) : null,
            sequence: item.sequence ?? null,
            turn_id_tail: typeof item.turn_id === 'string' ? item.turn_id.slice(-8) : null,
          });
          continue;
        }
        if (item?.item_kind === 'run_completed' && item.candidate !== null) {
          const draftId = typeof item.candidate?.draft_id === 'string' ? item.candidate.draft_id : null;
          const savedTargetMatch = item.turn_id === request.turnId && item.run_id === request.runId;
          const reviewed = draftId !== null && reviewedDraftIds.has(draftId);
          inspected.push({
            draft_id_tail: draftId === null ? null : draftId.slice(-8),
            index,
            item_kind: 'run_completed',
            result_kind: item.result_kind ?? null,
            reviewed,
            run_id_tail: typeof item.run_id === 'string' ? item.run_id.slice(-8) : null,
            saved_target_match: savedTargetMatch,
            sequence: item.sequence ?? null,
            terminal_status: item.terminal_status ?? null,
            turn_id_tail: typeof item.turn_id === 'string' ? item.turn_id.slice(-8) : null,
          });
          if (reviewed) continue;
          if (savedTargetMatch) continue;
          selected = {
            draft_id_tail: draftId === null ? null : draftId.slice(-8),
            index,
            run_id_tail: typeof item.run_id === 'string' ? item.run_id.slice(-8) : null,
            sequence: item.sequence ?? null,
            turn_id_tail: typeof item.turn_id === 'string' ? item.turn_id.slice(-8) : null,
          };
          break;
        }
      }
      return {
        conversation_state: stream?.conversation?.state ?? null,
        conversation_keys: stream?.conversation && typeof stream.conversation === 'object'
          ? Object.keys(stream.conversation).sort()
          : [],
        head_sequence: stream?.conversation?.conversation?.head_sequence ?? stream?.conversation?.head_sequence ?? null,
        item_count: items.length,
        inspected: inspected.slice(0, 10),
        raw_items: items.map((item, index) => summarizeItem(item, index)).slice(-30),
        selected,
        top_level_keys: stream && typeof stream === 'object'
          ? Object.keys(stream).sort()
          : [],
        window: stream?.conversation?.window ?? stream?.conversation?.conversation?.window ?? null,
      };
    }, {
      projectId: currentProject.project_id,
      runId: currentProject.run_id,
      turnId: currentProject.turn_id,
    });
  } catch {
    return Object.freeze({ diagnostic_unavailable: true });
  }
}

async function assertCustomChromeControls(page) {
  try {
    const minimize = page.getByRole('button', { name: 'Minimize window' });
    const maximizeOrRestore = page.getByRole('button', { name: /^(?:Maximize|Restore) window$/u });
    const close = page.getByRole('button', { name: 'Close window' });
    await minimize.waitFor({ state: 'visible' });
    await maximizeOrRestore.waitFor({ state: 'visible' });
    await close.waitFor({ state: 'visible' });
    if (
      typeof minimize.isEnabled !== 'function'
      || typeof maximizeOrRestore.isEnabled !== 'function'
      || typeof close.isEnabled !== 'function'
      || await minimize.isEnabled() !== true
      || await maximizeOrRestore.isEnabled() !== true
      || await close.isEnabled() !== true
    ) fail('canary_custom_chrome_failed');
    return Object.freeze({
      close_enabled: true,
      maximize_or_restore_enabled: true,
      minimize_enabled: true,
      window_controls_enabled: true,
    });
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError) throw error;
    fail('canary_custom_chrome_failed');
  }
}

function makeTempUserData(fsModule = fs, osModule = os) {
  return fsModule.mkdtempSync(path.join(osModule.tmpdir(), PACKAGED_CANARY_USER_DATA_PREFIX));
}

function createCanaryProjectRoot(userDataRoot, fsModule = fs, osModule = os) {
  const currentRoot = reverifyGuardedUserDataRoot(userDataRoot, fsModule, osModule);
  const projectRootPath = path.join(currentRoot.path, PACKAGED_CANARY_PROJECT_ROOT_DIRECTORY);
  try {
    fsModule.mkdirSync(projectRootPath);
  } catch {
    guardedUserDataError();
  }
  const stat = lstatDirectory(fsModule, projectRootPath);
  const projectRootRealPath = realpath(fsModule, projectRootPath);
  if (
    path.basename(projectRootRealPath) !== PACKAGED_CANARY_PROJECT_ROOT_DIRECTORY
    || !samePath(path.dirname(projectRootRealPath), currentRoot.realPath)
  ) guardedUserDataError();
  if (stat.isSymbolicLink()) guardedUserDataError();
  return projectRootPath;
}

function removeDirectory(rootIdentity, fsModule = fs, osModule = os) {
  if (!rootIdentity) return;
  reverifyGuardedUserDataRoot(rootIdentity, fsModule, osModule);
  fsModule.rmSync(rootIdentity.path, { force: true, recursive: true });
}

function removeRawTempUserDataPath(rawPath, fsModule = fs, osModule = os) {
  if (
    typeof rawPath !== 'string'
    || rawPath.length === 0
    || rawPath.trim() !== rawPath
    || rawPath.includes('\0')
    || !path.isAbsolute(rawPath)
    || path.normalize(rawPath) !== rawPath
    || path.resolve(rawPath) !== rawPath
  ) return;
  const tempRoot = path.resolve(osModule.tmpdir());
  if (path.dirname(rawPath) !== tempRoot || !path.basename(rawPath).startsWith(PACKAGED_CANARY_USER_DATA_PREFIX)) {
    return;
  }
  try {
    const root = captureGuardedUserDataRoot(rawPath, fsModule, osModule);
    removeDirectory(root, fsModule, osModule);
    return;
  } catch {
    // Fall back only for the direct mkdtemp path when lstat still proves a plain directory.
  }
  try {
    const stat = fsModule.lstatSync(rawPath, { bigint: true });
    if (!stat.isDirectory() || stat.isSymbolicLink()) return;
    fsModule.rmSync(rawPath, { force: true, recursive: true });
  } catch {
    // Cleanup is best-effort before a trusted root identity exists.
  }
}

function attachApplicationNetworkRecorder(recorder, app) {
  return recorder.attachApplication(app) === true;
}

async function launchApp({ electron, executablePath, userDataPath, projectRootPath, env }) {
  try {
    return await electron.launch({
      args: [],
      executablePath,
      env: sanitizeLaunchEnvironment(env, userDataPath, projectRootPath),
    });
  } catch {
    fail('canary_launch_failed');
  }
}

async function closeApp(app) {
  if (!app) return;
  await app.close();
}

async function runPackagedCanary(rawInput, options = {}) {
  let app = null;
  let electron = defaultElectron;
  let env = process.env;
  let fsModule = fs;
  let gate = null;
  let input = null;
  let osModule = os;
  let primaryError = null;
  let result = null;
  let savedProfile = null;
  let rawUserDataPath = null;
  let recorder = null;
  let projectRootPath = null;
  let userDataRoot = null;
  try {
    input = sanitizeInput(rawInput);
    const runOptions = sanitizeRunOptions(options);
    electron = runOptions.electron ?? defaultElectron;
    fsModule = runOptions.fs ?? fs;
    osModule = runOptions.os ?? os;
    env = runOptions.env ?? process.env;
    const argv = runOptions.argv ?? process.argv.slice(2);
    rawUserDataPath = runOptions.userDataPath ?? makeTempUserData(fsModule, osModule);
    userDataRoot = captureGuardedUserDataRoot(rawUserDataPath, fsModule, osModule);
    projectRootPath = createCanaryProjectRoot(userDataRoot, fsModule, osModule);
    gate = createArtifactGate();
    savedProfile = copySavedProviderProfile(input, userDataRoot, fsModule);
    if (input.mode !== 'saved_profile') {
      ensureCredentialOnlyFromStdin(input.provider.credential, argv, env);
    }
    let executableExists = false;
    try {
      executableExists = fsModule.existsSync(input.executable_path);
    } catch {
      fail('canary_launch_failed');
    }
    if (!executableExists) fail('canary_launch_failed');

    recorder = networkRecorder();
    app = await launchApp({
      electron,
      env,
      executablePath: input.executable_path,
      projectRootPath,
      userDataPath: userDataRoot.path,
    });
    const applicationObserver = attachApplicationNetworkRecorder(recorder, app);
    const page = await app.firstWindow();
    if (applicationObserver !== true) recorder.attachPage(page);
    const customChrome = await assertCustomChromeControls(page);
    if (input.mode !== 'saved_profile') {
      await fillProviderSettingsViaUi(page, input.provider, gate);
    } else {
      await readSanitizedBridgeEvidence(page, null, 'canary_read_evidence_saved_profile_boot_failed');
      gate.allow();
    }
    const initialChat = await askInitialChatQuestionViaUi(page);
    const initialChatFollowup = await askInitialChatQuestionViaUi(
      page,
      'Can we keep discussing before I choose a project folder?',
      2,
    );
    const initialDraft = await generateProjectViaUi(page, input.idea);
    const initialSavedActivity = await captureSavedActivityEvidence(page, 1);
    const initialEvidence = await readSanitizedBridgeEvidence(page, null, 'canary_read_evidence_initial_saved_failed');
    const initialProject = projectFromReadEvidence(initialEvidence, 1);
    const initialCurrentEvidence = await readSanitizedBridgeEvidence(
      page,
      initialProject.project_id,
      'canary_read_evidence_initial_current_failed',
    );
    const initialRevision = exactRevisionFromReadEvidence(initialCurrentEvidence, initialProject);
    const initialTaskStream = assertTaskStreamCandidateFacts(initialCurrentEvidence, initialRevision, 1);
    const initialPreviewEvidence = await capturePreviewEvidence(page, gate);
    const pendingUpdateDraft = await createUpdateDraftViaUi(
      page,
      initialRevision,
      CANARY_UPDATE_INSTRUCTION,
      0,
      userDataRoot,
      fsModule,
    );
    let pendingUpdateEvidence = null;
    let pendingUpdateProject = null;
    let pendingUpdateTaskStream;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        pendingUpdateEvidence = await readSanitizedBridgeEvidence(
          page,
          initialProject.project_id,
          'canary_read_evidence_pending_update_failed',
        );
        pendingUpdateProject = projectFromReadEvidence(pendingUpdateEvidence, 1);
        if (!sameCatalogProjectRevision(pendingUpdateProject, initialProject)) fail('canary_evidence_failed');
        pendingUpdateTaskStream = assertTaskStreamPendingCandidateFacts(
          pendingUpdateEvidence,
          initialRevision,
          2,
          0,
        );
        break;
      } catch (error) {
        if (attempt < 7) {
          if (typeof page.waitForTimeout === 'function') await page.waitForTimeout(100);
          else await new Promise((resolve) => setTimeout(resolve, 100));
          continue;
        }
        if (error instanceof BuilderPackagedCanaryError) {
          error.diagnostic = taskStreamCheckpointDiagnostic(
            pendingUpdateEvidence,
            'pending_update_task_stream',
          );
        }
        throw error;
      }
    }
    const pendingUpdatePreviewEvidence = await capturePreviewEvidence(page, gate);
    if (!staticPreviewSrcdocChanged(pendingUpdatePreviewEvidence, initialPreviewEvidence)) {
      failWithDiagnostic(
        'canary_preview_failed',
        previewComparisonDiagnostic('pending_update_changed_srcdoc', initialPreviewEvidence, pendingUpdatePreviewEvidence),
      );
    }
    await closeApp(app);
    app = null;

    app = await launchApp({
      electron,
      env,
      executablePath: input.executable_path,
      projectRootPath,
      userDataPath: userDataRoot.path,
    });
    const pendingRestartApplicationObserver = attachApplicationNetworkRecorder(recorder, app);
    const pendingRestartPage = await app.firstWindow();
    if (pendingRestartApplicationObserver !== true) recorder.attachPage(pendingRestartPage);
    await assertCustomChromeControls(pendingRestartPage);
    await installPendingRestartRestoreObserver(pendingRestartPage);
    await openProjectFromCatalogById(pendingRestartPage, initialRevision, 'canary_restart_open_failed');
    const pendingRestart = await readPendingUpdateDraftRestoreEvidence(pendingRestartPage, initialRevision, 2, 0);
    const pendingRestartProject = projectFromReadEvidence(pendingRestart.evidence, 1);
    if (!sameCatalogProjectRevision(pendingRestartProject, initialProject)) {
      failWithDiagnostic('canary_pending_draft_restart_failed', pendingRestartComparisonDiagnostic({
        afterEvidence: pendingRestart.evidence,
        afterTaskStream: pendingRestart.task_stream,
        beforeTaskStream: pendingUpdateTaskStream,
        comparison: 'project_revision',
      }));
    }
    const pendingRestartTaskStreamUnchanged = (
      digestCanonical(pendingRestart.task_stream) === digestCanonical(pendingUpdateTaskStream)
    );
    if (!pendingRestartTaskStreamUnchanged) {
      failWithDiagnostic('canary_pending_draft_restart_failed', pendingRestartComparisonDiagnostic({
        afterEvidence: pendingRestart.evidence,
        afterTaskStream: pendingRestart.task_stream,
        beforeTaskStream: pendingUpdateTaskStream,
        comparison: 'task_stream',
      }));
    }
    const pendingRestartPreviewEvidence = await capturePreviewEvidence(pendingRestartPage, gate);
    if (!samePreviewEvidence(pendingRestartPreviewEvidence, pendingUpdatePreviewEvidence)) {
      failWithDiagnostic('canary_pending_draft_restart_failed', pendingRestartComparisonDiagnostic({
        afterEvidence: pendingRestart.evidence,
        afterPreview: pendingRestartPreviewEvidence,
        afterTaskStream: pendingRestart.task_stream,
        beforePreview: pendingUpdatePreviewEvidence,
        beforeTaskStream: pendingUpdateTaskStream,
        comparison: 'preview',
      }));
    }
    const updateDraft = Object.freeze({
      ...pendingUpdateDraft,
      ...(await saveUpdateDraftViaUi(pendingRestartPage, initialRevision)),
    });
    const updatedSavedActivity = await captureSavedActivityEvidence(pendingRestartPage, 2);
    const updatedEvidence = await readSanitizedBridgeEvidence(
      pendingRestartPage,
      null,
      'canary_read_evidence_updated_saved_failed',
    );
    const updatedProject = projectFromReadEvidence(updatedEvidence, 2);
    const updatedCurrentEvidence = await readSanitizedBridgeEvidence(
      pendingRestartPage,
      updatedProject.project_id,
      'canary_read_evidence_updated_current_failed',
    );
    const updatedRevision = exactRevisionFromReadEvidence(updatedCurrentEvidence, updatedProject);
    assertRevisionAdvance(initialRevision, updatedRevision);
    const updatedTaskStream = assertTaskStreamCandidateFacts(updatedCurrentEvidence, updatedRevision, 2, 0);
    const updatedPreviewEvidence = await capturePreviewEvidence(pendingRestartPage, gate);
    if (!staticPreviewSrcdocChanged(updatedPreviewEvidence, initialPreviewEvidence)) {
      failWithDiagnostic(
        'canary_preview_failed',
        previewComparisonDiagnostic('updated_changed_srcdoc', initialPreviewEvidence, updatedPreviewEvidence),
      );
    }
    await closeApp(app);
    app = null;

    app = await launchApp({
      electron,
      env,
      executablePath: input.executable_path,
      projectRootPath,
      userDataPath: userDataRoot.path,
    });
    const restartApplicationObserver = attachApplicationNetworkRecorder(recorder, app);
    const restartedPage = await app.firstWindow();
    if (restartApplicationObserver !== true) recorder.attachPage(restartedPage);
    await assertCustomChromeControls(restartedPage);
    await openProjectFromCatalogById(restartedPage, updatedRevision, 'canary_restart_open_failed');
    let restartEvidence;
    try {
      restartEvidence = await readSanitizedBridgeEvidence(restartedPage, updatedProject.project_id);
      assertExactRevision(restartEvidence, updatedProject);
    } catch {
      fail('canary_restart_evidence_failed');
    }
    try {
      await assertVisibleVersion(restartedPage, 2);
    } catch {
      await failRestartVersion(restartedPage);
    }
    const restartProject = projectFromReadEvidence(restartEvidence, 2);
    const restartTaskStream = assertTaskStreamCandidateFacts(restartEvidence, updatedRevision, 2, 0);
    const restartPreviewEvidence = await capturePreviewEvidence(restartedPage, gate);
    const history = await inspectHistoryVersionViaUi(
      restartedPage,
      initialRevision,
      updatedRevision,
      initialPreviewEvidence,
      restartPreviewEvidence,
      restartTaskStream,
      gate,
      0,
    );
    const network = recorder.snapshot();
    if (network.renderer_unexpected_network_count !== 0) {
      failWithDiagnostic('canary_evidence_failed', Object.freeze({
        diagnostic_version: 'builder-canary-final-evidence-diagnostic.v1',
        comparison: 'restart_network',
        renderer_unexpected_network_count: network.renderer_unexpected_network_count,
      }));
    }
    const restartRevisionUnchanged = (
      restartEvidence.catalog.projects.length === updatedEvidence.catalog.projects.length
      && restartProject.project_id === updatedProject.project_id
      && restartProject.revision_number === updatedProject.revision_number
      && restartProject.revision_receipt_digest === updatedProject.revision_receipt_digest
      && restartProject.commit_oid === updatedProject.commit_oid
      && restartProject.tree_oid === updatedProject.tree_oid
      && samePreviewEvidence(restartPreviewEvidence, updatedPreviewEvidence)
    );
    if (!restartRevisionUnchanged) {
      failWithDiagnostic('canary_evidence_failed', Object.freeze({
        diagnostic_version: 'builder-canary-final-evidence-diagnostic.v1',
        comparison: 'restart_revision',
        catalog_count_after_save: updatedEvidence.catalog.projects.length,
        catalog_count_after_restart: restartEvidence.catalog.projects.length,
        project_id_matches: restartProject.project_id === updatedProject.project_id,
        revision_number_matches: restartProject.revision_number === updatedProject.revision_number,
        revision_receipt_digest_matches:
          restartProject.revision_receipt_digest === updatedProject.revision_receipt_digest,
        commit_oid_matches: restartProject.commit_oid === updatedProject.commit_oid,
        tree_oid_matches: restartProject.tree_oid === updatedProject.tree_oid,
        preview_matches: samePreviewEvidence(restartPreviewEvidence, updatedPreviewEvidence),
      }));
    }
    const restartTaskStreamUnchanged = digestCanonical(restartTaskStream) === digestCanonical(updatedTaskStream);
    if (!restartTaskStreamUnchanged) {
      failWithDiagnostic('canary_evidence_failed', Object.freeze({
        diagnostic_version: 'builder-canary-final-evidence-diagnostic.v1',
        comparison: 'restart_task_stream',
        updated_task_stream_digest: digestCanonical(updatedTaskStream),
        restart_task_stream_digest: digestCanonical(restartTaskStream),
        updated_candidate_ready_count: updatedTaskStream.candidate_ready_count,
        restart_candidate_ready_count: restartTaskStream.candidate_ready_count,
        updated_check_state: updatedTaskStream.check_run_outcome_projection?.state ?? null,
        restart_check_state: restartTaskStream.check_run_outcome_projection?.state ?? null,
        updated_check_status: updatedTaskStream.check_run_outcome_projection?.status ?? null,
        restart_check_status: restartTaskStream.check_run_outcome_projection?.status ?? null,
      }));
    }
    const restartContinuationPlan = await proposePlanViaUi(
      restartedPage,
      updatedRevision,
      CANARY_RESTART_CONTINUATION_INSTRUCTION,
      2,
      0,
      1,
      userDataRoot,
    );
    const planProposalProject = projectFromReadEvidence(
      await readSanitizedBridgeEvidence(
        restartedPage,
        updatedProject.project_id,
        'canary_read_evidence_plan_proposal_failed',
      ),
      2,
    );
    if (!sameCatalogProjectRevision(planProposalProject, updatedProject)) {
      fail('canary_evidence_failed');
    }
    const restartContinuationDraft = await approvePlanViaUi(
      restartedPage,
      updatedRevision,
      3,
      0,
      1,
      userDataRoot,
    );
    const restartContinuationEvidence = await readSanitizedBridgeEvidence(
      restartedPage,
      updatedProject.project_id,
      'canary_read_evidence_restart_continuation_failed',
    );
    const restartContinuationProject = projectFromReadEvidence(restartContinuationEvidence, 2);
    if (!sameCatalogProjectRevision(restartContinuationProject, updatedProject)) {
      fail('canary_evidence_failed');
    }
    assertExactRevision(restartContinuationEvidence, updatedProject);
    const restartContinuationTaskStream = assertTaskStreamPendingCandidateFacts(
      restartContinuationEvidence,
      updatedRevision,
      3,
      0,
      {
        approvedPlanReviews: 1,
        planTurns: 1,
        requireToolActivity: true,
      },
    );
    const restartContinuationPreviewEvidence = await capturePreviewEvidence(restartedPage, gate);
    if (!staticPreviewSrcdocChanged(restartContinuationPreviewEvidence, restartPreviewEvidence)) {
      failWithDiagnostic(
        'canary_preview_failed',
        previewComparisonDiagnostic(
          'restart_continuation_changed_srcdoc',
          restartPreviewEvidence,
          restartContinuationPreviewEvidence,
        ),
      );
    }
    const restartContinuationAdvancedCandidateCount = (
      restartContinuationTaskStream.candidate_ready_count === restartTaskStream.candidate_ready_count + 1
      && restartContinuationTaskStream.accepted_review_count === restartTaskStream.accepted_review_count
      && restartContinuationTaskStream.saved_revision_number === updatedRevision.revision_number
    );
    if (!restartContinuationAdvancedCandidateCount) fail('canary_evidence_failed');
    const finalNetwork = recorder.snapshot();
    if (finalNetwork.renderer_unexpected_network_count !== 0) fail('canary_evidence_failed');

    result = Object.freeze({
      result_version: CANARY_RESULT_VERSION,
      artifacts_after_password_clear: gate.allowed,
      custom_chrome: customChrome,
      activity: Object.freeze({
        initial_save: initialSavedActivity,
        update_save: updatedSavedActivity,
      }),
      draft: Object.freeze({
        initial: initialDraft,
        restart_continuation: restartContinuationDraft,
        pending_update_restart: pendingRestart.ui,
        update: updateDraft,
      }),
      input: redactInput(input),
      history,
      network: finalNetwork,
      plan: Object.freeze({
        restart_continuation: restartContinuationPlan,
      }),
      question: Object.freeze({
        initial_chat: initialChat,
        initial_chat_followup: initialChatFollowup,
        saved_project_context_chat: 'skipped_until_provider_context_prompt_bridge',
      }),
      preview: Object.freeze({
        initial: initialPreviewEvidence,
        pending_update: pendingUpdatePreviewEvidence,
        pending_update_restart: pendingRestartPreviewEvidence,
        updated: updatedPreviewEvidence,
        restart: restartPreviewEvidence,
        restart_continuation: restartContinuationPreviewEvidence,
        pending_update_restart_srcdoc_unchanged: true,
        restart_continuation_changed_srcdoc: true,
        update_changed_srcdoc: true,
        restart_srcdoc_unchanged: true,
      }),
      project: Object.freeze({
        catalog_project_count: updatedEvidence.catalog.projects.length,
        initial_commit_oid: initialProject.commit_oid,
        initial_revision_number: 1,
        initial_revision_receipt_digest: initialProject.revision_receipt_digest,
        initial_tree_oid: initialProject.tree_oid,
        parent_oid: updatedRevision.parent_oid,
        pending_update_restart_catalog_project_count: pendingRestart.evidence.catalog.projects.length,
        pending_update_restart_revision_unchanged: true,
        pending_update_revision_unchanged: true,
        previous_revision_receipt_digest: updatedRevision.previous_revision_receipt_digest,
        restart_catalog_project_count: restartEvidence.catalog.projects.length,
        restart_continuation_revision_unchanged: true,
        restart_new_revision_observed: true,
        restart_revision_unchanged: true,
        project_id: updatedProject.project_id,
        restart_restored: true,
        revision_number: 2,
        revision_receipt_digest: updatedProject.revision_receipt_digest,
        commit_oid: updatedProject.commit_oid,
        tree_oid: updatedProject.tree_oid,
      }),
      safe_storage: Object.freeze({
        credential_status: restartEvidence.status.credential_status,
        configured: restartEvidence.status.configured,
      }),
      task_stream: Object.freeze({
        initial: initialTaskStream,
        pending_update: pendingUpdateTaskStream,
        pending_update_restart: pendingRestart.task_stream,
        updated: updatedTaskStream,
        restart: restartTaskStream,
        restart_continuation: restartContinuationTaskStream,
        pending_update_advanced_candidate_count: pendingUpdateTaskStream.candidate_ready_count
          === initialTaskStream.candidate_ready_count + 1,
        saved_project_context_chat_deferred_until_prompt_bridge: true,
        pending_update_restart_unchanged: true,
        update_advanced_candidate_count: updatedTaskStream.candidate_ready_count
          === initialTaskStream.candidate_ready_count + 1,
        restart_continuation_advanced_candidate_count: restartContinuationAdvancedCandidateCount,
        restart_unchanged: true,
      }),
      user_data: Object.freeze({
        ...(input.mode === 'saved_profile' ? { source_profile_unchanged: true } : {}),
        temporary: true,
      }),
    });
  } catch (error) {
    primaryError = fixedError(error);
  }

  const cleanupErrors = [];
  try {
    await closeApp(app);
  } catch {
    cleanupErrors.push(new BuilderPackagedCanaryError('canary_cleanup_failed'));
  }
  try {
    if (savedProfile !== null) {
      assertSavedProfileUnchanged(savedProfile.snapshot, savedProfile.sourceRoot, fsModule);
    }
  } catch {
    cleanupErrors.push(new BuilderPackagedCanaryError('canary_saved_profile_failed'));
  }
  try {
    if (userDataRoot !== null) {
      removeDirectory(userDataRoot, fsModule, osModule);
    } else {
      removeRawTempUserDataPath(rawUserDataPath, fsModule, osModule);
    }
  } catch {
    cleanupErrors.push(new BuilderPackagedCanaryError('canary_cleanup_failed'));
  }
  if (primaryError !== null && primaryError.code === 'canary_saved_profile_failed') throw primaryError;
  if (cleanupErrors.length > 0) throw cleanupErrors[0];
  if (primaryError !== null) throw primaryError;
  return result;
}

function readStdin(stream = process.stdin, maxBytes = STDIN_MAX_BYTES) {
  return new Promise((resolve, reject) => {
    let body = '';
    let bytes = 0;
    let settled = false;
    const rejectFixed = () => {
      if (settled) return;
      settled = true;
      reject(new BuilderPackagedCanaryError('canary_input_invalid'));
    };
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      if (settled) return;
      bytes += Buffer.byteLength(chunk, 'utf8');
      if (bytes > maxBytes) {
        rejectFixed();
        if (typeof stream.destroy === 'function') stream.destroy();
        return;
      }
      body += chunk;
    });
    stream.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(body);
    });
    stream.on('error', () => rejectFixed());
  });
}

async function runCli({
  argv = process.argv.slice(2),
  stdin = process.stdin,
  stdout = process.stdout,
  run = runPackagedCanary,
} = {}) {
  if (!Array.isArray(argv) || argv.length !== 1 || argv[0] !== '--execute') {
    fail('canary_input_invalid');
  }
  const result = await run(parseCanaryInput(await readStdin(stdin)));
  stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

async function main() {
  await runCli();
}

module.exports = {
  BuilderPackagedCanaryError,
  CANARY_INPUT_VERSION,
  CANARY_INITIAL_CHAT_QUESTION,
  CANARY_QUESTION,
  CANARY_RESULT_VERSION,
  PACKAGED_CANARY_PROJECT_ROOT_DIRECTORY,
  PACKAGED_CANARY_PROJECT_ROOT_PATH,
  PACKAGED_CANARY_SENTINEL,
  PACKAGED_CANARY_USER_DATA_PATH,
  PACKAGED_CANARY_USER_DATA_PREFIX,
  SELECTORS,
  assertCustomChromeControls,
  assertExactRevision,
  assertRevisionAdvance,
  assertReadEvidence,
  assertTaskStreamCandidateFacts,
  assertTaskStreamExplanationFacts,
  assertTaskStreamPendingCandidateFacts,
  assertTaskStreamPlanFacts,
  approveCurrentProjectWriteIfRequested,
  approvePlanSourceReadIfRequested,
  approvePlanViaUi,
  askInitialChatQuestionViaUi,
  askProjectQuestionViaUi,
  askRejectedPlanContextualSubmitViaUi,
  captureGuardedUserDataRoot,
  capturePreviewEvidence,
  captureSavedActivityEvidence,
  copySavedProviderProfile,
  createCanaryProjectRoot,
  createUpdateDraftViaUi,
  createArtifactGate,
  ensureCredentialOnlyFromStdin,
  fillProviderSettingsViaUi,
  generateProjectViaUi,
  inspectDraftReviewDiffViaUi,
  inspectHistoryVersionViaUi,
  networkRecorder,
  openProjectFromCatalogById,
  parseCanaryInput,
  proposePlanViaUi,
  readStdin,
  readOnlyBridgeEvidence,
  readSanitizedBridgeEvidence,
  retryFailedDraftViaUi,
  rejectPlanViaUi,
  runCli,
  runPackagedCanary,
  sanitizeInput,
  sanitizeLaunchEnvironment,
  saveUpdateDraftViaUi,
  summarizePng,
  updateProjectViaUi,
  waitForGenerationTerminal,
};

if (require.main === module) {
  main().catch((error) => {
    const code = error instanceof BuilderPackagedCanaryError
      ? error.code
      : 'canary_evidence_failed';
    const stage = Object.hasOwn(ERROR_STAGES, code)
      ? ERROR_STAGES[code]
      : ERROR_STAGES.canary_evidence_failed;
    process.stderr.write(`${JSON.stringify({
      ok: false,
      code,
      message: Object.hasOwn(ERROR_MESSAGES, code)
        ? ERROR_MESSAGES[code]
        : ERROR_MESSAGES.canary_evidence_failed,
      stage,
      diagnostic: error instanceof BuilderPackagedCanaryError
        ? error.diagnostic
        : undefined,
    })}\n`);
    process.exitCode = 1;
  });
}
