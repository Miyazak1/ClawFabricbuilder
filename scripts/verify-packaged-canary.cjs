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
  sanitizeBuilderDraftCheckpointTimelineProjection,
} = require('../electron/builder-draft-checkpoint-timeline-projection.cjs');
const {
  sanitizeBuilderReviewStateProjection,
} = require('../electron/builder-review-state-projection.cjs');
const {
  sanitizeBuilderCheckRunOutcomeProjection,
} = require('../electron/builder-check-run-outcome-projection.cjs');
const {
  sanitizeBuilderAgentActivityProjection,
} = require('../electron/builder-agent-activity-projection.cjs');
const {
  MAX_PUBLIC_ITEMS: TASK_STREAM_MAX_PUBLIC_ITEMS,
} = require('../electron/builder-task-stream-projection.cjs');
const {
  DEFAULT_BUILDER_AGENT_ID,
} = require('../electron/builder-default-agent-bootstrap.cjs');
const {
  sanitizeBuilderConversationAddress,
} = require('../electron/builder-conversation-address.cjs');

const CANARY_INPUT_VERSION = 'builder-packaged-canary-input.v1';
const CANARY_RESULT_VERSION = 'builder-packaged-canary-result.v25';
const CANARY_INITIAL_CHAT_QUESTION = 'What can you help me with before I choose a project folder?';
const CANARY_QUESTION = 'What does this saved project do, and what should I review before changing it?';
const CANARY_SAVED_PROJECT_CONTEXT_ANSWER = [
  'The current project is the Focus Timer Continued page with the subtitle',
  '"A fresh continuation from the restored checkpoint."',
  'Review index.html and package.json before changing it.',
].join(' ');
const CANARY_UPDATE_INSTRUCTION = 'Change the main heading and add a short subtitle.';
const CANARY_RESTART_CONTINUATION_INSTRUCTION = 'Plan a compact completed-state summary below the timer before changing files.';
const CANARY_CHECKPOINT_CONTINUATION_ONE = 'Change the heading to Focus Timer Refined and update the subtitle for checkpoint recovery.';
const CANARY_CHECKPOINT_CONTINUATION_TWO = 'Change the heading to Focus Timer Polished and revise the subtitle again.';
const CANARY_POST_UNDO_CONTINUATION = 'Change the heading to Focus Timer Continued and add a fresh continuation subtitle.';
const PACKAGED_CANARY_SENTINEL = 'BUILDER_PACKAGED_CANARY';
const PACKAGED_CANARY_USER_DATA_PATH = 'BUILDER_PACKAGED_CANARY_USER_DATA_PATH';
const PACKAGED_CANARY_USER_DATA_PREFIX = 'clawfabric-builder-packaged-canary-';
const PACKAGED_CANARY_PROJECT_ROOT_PATH = 'BUILDER_PACKAGED_CANARY_PROJECT_ROOT_PATH';
const PROGRAMMING_RUNTIME_FEATURE_FLAG = 'BUILDER_PROGRAMMING_RUNTIME';
const HARNESS_RUNTIME_ROOT = 'BUILDER_HARNESS_RUNTIME_ROOT';
const PACKAGED_CANARY_PROJECT_ROOT_DIRECTORY = 'project-root';
const PACKAGED_CANARY_GENERATION_DEBUG_FILE = 'builder-canary-generation-debug.jsonl';
const PACKAGED_CANARY_RUNTIME_IDLE_TIMEOUT_MS =
  'BUILDER_PACKAGED_CANARY_RUNTIME_IDLE_TIMEOUT_MS';
const LOCAL_STATE_FILE_NAME = 'Local State';
const PROVIDER_CONFIG_DIRECTORY_NAME = 'builder-provider-config-v1';
const PROVIDER_CONFIG_CURRENT_FILE_NAME = 'current.json';
const PROVIDER_SECRETS_DIRECTORY_NAME = 'builder-provider-secrets-v1';
const SESSION_DATA_DIRECTORY_NAME = 'session-data';
const DEFAULT_EXECUTABLE = path.join(__dirname, '..', 'release', 'win-unpacked', 'ClawFabric Builder.exe');
const CANARY_PLAN_PROPOSAL_TIMEOUT_MS = 120_000;
const CANARY_QUESTION_ANSWER_TIMEOUT_MS = 120_000;
const CANARY_GENERATION_TERMINAL_TIMEOUT_MS = 120_000;
const CANARY_CURRENT_PROJECT_WRITE_APPROVAL_TIMEOUT_MS = 5_000;
const CANARY_PLAN_SOURCE_READ_APPROVAL_TIMEOUT_MS = 5_000;
const CANARY_PROJECT_READY_TIMEOUT_MS = 15_000;
const CANARY_CHAT_COLUMN_MIN_WIDTH_PX = 320;
const CANARY_CHAT_COLUMN_MIN_HEIGHT_PX = 340;
const CANARY_ARTIFACT_SIDEBAR_MIN_WIDTH_PX = 320;
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

function traceCanaryStage(stage, detail = null) {
  if (process.env.BUILDER_PACKAGED_CANARY_TRACE !== '1') return;
  const payload = {
    at: new Date().toISOString(),
    detail,
    stage,
  };
  process.stderr.write(`[packaged-canary-trace] ${JSON.stringify(payload)}\n`);
}
const SELECTORS = Object.freeze({
  apiKey: '#builder-provider-api-key',
  artifactResizeHandle: '[data-builder-artifact-resize-handle="true"]',
  artifactSidebar: '[data-builder-artifact-sidebar="true"]',
  artifactSummary: '[data-builder-artifact-summary="true"]',
  artifactToggle: '[data-builder-toggle-artifact="true"]',
  artifactTabPermissions: '[data-builder-artifact-tab="permissions"]',
  artifactTabVersions: '[data-builder-artifact-tab="versions"]',
  composerAddMenuButton: '[data-builder-composer-add-menu-button="true"]',
  composerAddAskMode: '[data-builder-composer-add-ask-mode="true"]',
  composerAddBuildMode: '[data-builder-composer-add-build-mode="true"]',
  composerAddFiles: '[data-builder-composer-add-files="true"]',
  composerAddPlanMode: '[data-builder-composer-add-plan-mode="true"]',
  composerClearMode: '[data-builder-clear-composer-mode="true"]',
  baseUrl: '#builder-provider-base-url',
  changeCard: '[data-builder-change-card]',
  changeDiff: '[data-builder-change-diff]',
  changeDiffLine: '[data-builder-change-diff-line-kind]',
  chatScroll: '[data-builder-chat-scroll="true"]',
  catalogNewProject: '[data-builder-catalog-new-project="true"]',
  changesFlow: '[data-builder-changes-flow="true"]',
  changesPanel: '[data-builder-changes-panel="true"]',
  changesDisclosure: '[data-builder-changes-disclosure="true"]',
  changesSummaryToggle: '[data-builder-changes-disclosure="true"] > summary',
  changesSummary: '[data-builder-changes-summary="true"]',
  completionSummary: '[data-builder-completion-summary="true"]',
  conversationActivity: '[data-builder-activity="true"]',
  addSourceFolder: '[data-builder-add-source-folder="true"]',
  agentTaskProposal: '[data-builder-workbench-content-type="builder.task.proposal.v1"]',
  agentTaskProposalActions: '[data-builder-agent-task-proposal-actions="true"]',
  agentTaskProposalNewProject: '[data-builder-agent-task-proposal-new-project="true"]',
  agentRosterItem: `[data-builder-agent-id="${DEFAULT_BUILDER_AGENT_ID}"]`,
  agentTaskResult: '[data-builder-workbench-content-type="builder.task.result.v1"]',
  agentTaskResultOpen: '[data-builder-agent-result-open-task="true"]',
  agentTaskMonitor: '[data-builder-task-monitor="true"]',
  agentTaskMonitorItem: '[data-builder-task-monitor-item]',
  currentVersion: '[data-builder-current-version="true"]',
  generationFailedNotice: '[data-builder-conversation-notice="generation_failed"]',
  historyPreview: '[data-builder-history-preview="true"]',
  idea: '#builder-idea',
  liveOutput: '[data-builder-live-output="true"]',
  workStatus: '[data-builder-work-status="true"]',
  newProjectPanel: '[data-builder-new-project-panel="true"]',
  cancelWork: '[data-builder-cancel-work="true"]',
  composer: '[data-builder-composer="true"]',
  composerVersionDecision: '[data-builder-composer-version-decision="true"]',
  composerStatus: '[data-builder-composer-status="true"]',
  runHistory: '[data-builder-run-history="true"]',
  runHistoryToggle: '[data-builder-run-history-toggle="true"]',
  runtimeFileAction: '[data-builder-runtime-tool-kind="edit"], [data-builder-runtime-tool-kind="write"]',
  runtimeFileGroup: '[data-builder-runtime-tool-group="file"]',
  runtimeCommandAction: '[data-builder-runtime-tool-kind="command"]',
  runtimeCommandOpen: '[data-builder-runtime-tool-open="terminal"]',
  completedFileActions: '[data-builder-completed-action-group="file"]',
  completedCommandActions: '[data-builder-completed-action-group="command"]',
  completionCandidateChange: '[data-builder-completion-candidate-change]',
  completionCommand: '[data-builder-completion-command]',
  completionCommandButton: '[data-builder-completion-command] button',
  commandInspector: '[data-builder-command-inspector="true"]',
  commandDisplay: '[data-builder-command-display="true"]',
  activeTerminalTab: '[data-builder-side-workspace-tool="terminal_placeholder"][aria-selected="true"]',
  approvePlan: '[data-builder-approve-plan="true"]',
  approveCurrentProjectWrite: '[data-builder-approve-current-project-write="true"]',
  approveProviderContextDisclosure: '[data-builder-approve-provider-context-disclosure="true"]',
  artifactPermissions: '[data-builder-artifact-permissions="true"]',
  approvePlanSourceRead: '[data-builder-approve-plan-source-read="true"]',
  currentProjectWriteApproval: '[data-builder-current-project-write-approval="true"]',
  dismissCurrentProjectWriteApproval: '[data-builder-dismiss-current-project-write="true"]',
  planApproved: '[data-builder-plan-review-decision="approved"]',
  planProposed: '[data-builder-activity-card="Plan proposed"]',
  planMarkdown: '[data-builder-plan-markdown="true"] [data-builder-markdown-variant="plan"]',
  draftProposed: '[data-builder-activity-card="Draft proposed"]',
  planRejected: '[data-builder-plan-review-decision="rejected"]',
  rejectPlan: '[data-builder-reject-plan="true"]',
  planReviewActions: '[data-builder-plan-review-actions="true"]',
  planSourceReadApproval: '[data-builder-plan-source-read-approval="true"]',
  questionAnswerFailedNotice: '[data-builder-conversation-notice="answer_failed"]',
  questionAnswer: [
    '[data-builder-workbench-content-type="builder.chat.agent_message.v1"]',
    '[data-builder-activity-card="Assistant"]',
  ].join(', '),
  providerContextPermissionRow: '[data-builder-permission-row="ai-context"]',
  submitTurn: '[data-builder-submit-turn="true"]',
  toolActivityRequested: '[data-builder-tool-activity="requested"]',
  toolActivitySucceeded: '[data-builder-tool-activity="succeeded"]',
  userMessage: '[data-builder-activity-card="You"]',
  versionSavedActivity: '[data-builder-activity-card="Version saved"]',
  versionHistory: '[data-builder-version-history="true"]',
  workspaceChip: '[data-builder-workspace-chip="true"]',
  workspaceControlChanges: '[data-builder-workspace-control-tab="changes"]',
  workspaceControlLogs: '[data-builder-workspace-control-tab="logs"]',
  workspaceControlPreview: '[data-builder-workspace-control-tab="preview"]',
  workspaceControlSource: '[data-builder-workspace-control-tab="source"]',
  workspaceControlVersions: '[data-builder-workspace-control-tab="versions"]',
  workspaceControls: '[data-builder-workspace-controls="true"]',
  workspaceDraftActions: '[data-builder-workspace-draft-actions="true"]',
  workspaceMenu: '[data-builder-workspace-menu="true"]',
  workspaceMenuButton: '[data-builder-workspace-menu-button="true"]',
  workspaceNewProject: '[data-builder-workspace-new-project="true"]',
  workspacePicker: '[data-builder-workspace-picker="true"]',
  maxTokens: '#builder-provider-max-tokens',
  model: '#builder-provider-model',
  providerPanel: '[data-builder-provider-settings-panel="true"]',
  projectCatalog: '[data-builder-agent-sidebar="true"]',
  projectPage: '[data-builder-page="true"]',
  preview: '[data-builder-static-preview="true"]',
  previewFrame: '[data-builder-static-preview="true"] iframe[title$=" preview"]',
  previewLimitation: '[data-builder-preview-limitation="true"]',
  previewRuntimeBlocked: '[data-builder-preview-runtime-blocked="true"]',
  previewUnavailable: '[data-builder-preview-unavailable="true"]',
  retryDraft: '[data-builder-retry-draft="true"]',
  resultFlow: '[data-builder-preview-flow="true"]',
  reviewCheckpoint: '[data-builder-review-checkpoint="true"]',
  reviewMore: '[data-builder-review-more="true"]',
  undoDraft: '[data-builder-undo-draft="true"], [data-builder-chat-undo-checkpoint="true"]',
  discardDraft: '[data-builder-discard-draft="true"]',
  reviewOpenChanges: '[data-builder-review-open-changes="true"]',
  reviewOpenPreview: '[data-builder-review-open-preview="true"]',
  runCheck: '[data-builder-run-check]',
  skipCheck: '[data-builder-skip-check="true"]',
  checkRunStatus: '[data-builder-check-run-status]',
  saveVersion: '[data-builder-save-version="true"]',
  temperature: '#builder-provider-temperature',
  timeout: '#builder-provider-timeout',
  unsavedDraft: '[data-builder-unsaved-draft="true"]',
  sideWorkspaceFiles: '[data-builder-side-workspace-files="true"]',
  sideWorkspaceFileContent: '[data-builder-side-workspace-file-content-status]',
  sideWorkspaceFileContentReady: '[data-builder-side-workspace-file-content-status="ready"]',
  sideWorkspaceCodeViewer: '[data-builder-side-workspace-code-viewer="true"]',
  sideWorkspaceCodeLine: '[data-builder-side-workspace-code-line]',
});
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const GIT_OID_PATTERN = /^[0-9a-f]{40}$/u;
const CSS_IDENTIFIER_PATTERN = /^[a-z][a-z0-9_-]*$/u;
const UUID_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const BUILDER_ID_PATTERNS = Object.freeze({
  candidate_id: /^builder-code-change-candidate:[0-9a-f]{64}$/u,
  conversation_id: new RegExp(`^builder-conversation:${UUID_PATTERN}(?::${UUID_PATTERN})?$`, 'u'),
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
const RUNTIME_RESULT_REF_PATTERN = /^builder-runtime-tool-result:[0-9a-f]{64}$/u;
const RUNTIME_CHANGE_REF_PATTERN = /^builder-runtime-file-change:[0-9a-f]{64}$/u;
const RUNTIME_COMMAND_REF_PATTERN = /^builder-runtime-command-result:[0-9a-f]{64}$/u;

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
  canary_agent_workbench_boundary_failed: 'Packaged canary Agent Workbench boundary evidence failed.',
  canary_agent_workbench_task_return_failed: 'Packaged canary Agent Workbench task return failed.',
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
  canary_plan_tool_activity_failed: 'Packaged canary plan tool activity projection was incorrect.',
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
  canary_checkpoint_undo_failed: 'Packaged canary could not restore the previous draft checkpoint.',
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
  canary_review_diff_checkpoint_copy_width_failed: 'Packaged canary review checkpoint copy width failed.',
  canary_review_diff_checkpoint_height_failed: 'Packaged canary review checkpoint height failed.',
  canary_review_diff_checkpoint_width_failed: 'Packaged canary review checkpoint width failed.',
  canary_review_diff_checkpoint_child_bounds_failed: 'Packaged canary review checkpoint child bounds failed.',
  canary_review_diff_changes_layout_failed: 'Packaged canary review diff changes layout failed.',
  canary_review_diff_checkpoint_layout_failed: 'Packaged canary review checkpoint layout failed.',
  canary_review_diff_checkpoint_text_stack_failed: 'Packaged canary review checkpoint text layout failed.',
  canary_review_diff_workspace_actions_layout_failed: 'Packaged canary workspace draft action layout failed.',
  canary_review_diff_text_failed: 'Packaged canary review diff text evidence failed.',
  canary_review_diff_completed_actions_failed: 'Packaged canary completed actions were missing factual file or command results.',
  canary_check_run_failed: 'Packaged canary project check failed.',
  canary_manual_check_controls_visible: 'Packaged canary exposed manual project check controls.',
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
  canary_agent_workbench_boundary_failed: 'agent_workbench_boundary',
  canary_agent_workbench_task_return_failed: 'agent_workbench_task_return',
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
  canary_checkpoint_undo_failed: 'checkpoint_undo',
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
  canary_review_diff_checkpoint_copy_width_failed: 'review_diff_checkpoint_copy_width',
  canary_review_diff_checkpoint_height_failed: 'review_diff_checkpoint_height',
  canary_review_diff_checkpoint_width_failed: 'review_diff_checkpoint_width',
  canary_review_diff_checkpoint_child_bounds_failed: 'review_diff_checkpoint_child_bounds',
  canary_review_diff_changes_layout_failed: 'review_diff_changes_layout',
  canary_review_diff_checkpoint_layout_failed: 'review_diff_checkpoint_layout',
  canary_review_diff_checkpoint_text_stack_failed: 'review_diff_checkpoint_text_stack',
  canary_review_diff_workspace_actions_layout_failed: 'review_diff_workspace_actions_layout',
  canary_review_diff_text_failed: 'review_diff_text',
  canary_check_run_failed: 'check_run',
  canary_manual_check_controls_visible: 'manual_check_controls',
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
  'agent_project_tree_namespace',
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
  'draft_checkpoint_timeline_projection',
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
const TASK_STREAM_CANDIDATE_OPTIONAL_KEYS = Object.freeze(['workspace_materialization']);
const TASK_STREAM_WORKSPACE_MATERIALIZATION_KEYS = Object.freeze(['status']);
const TASK_STREAM_WORKSPACE_MATERIALIZATION_WITH_DETAIL_KEYS = Object.freeze([
  'status',
  'label',
  'detail',
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
const TASK_STREAM_AGENT_STEP_PROGRESS_KEYS = Object.freeze([
  'item_kind',
  'sequence',
  'turn_id',
  'run_id',
  'task_id',
  'step_id',
  'step_index',
  'recorded_state',
  'result',
  'summary',
  'lifecycle',
]);
const TASK_STREAM_AGENT_STEP_RESULT_KEYS = Object.freeze([
  'status',
  'summary_code',
  'display_summary',
]);
const TASK_STREAM_AGENT_STEP_SUMMARY_KEYS = Object.freeze(['status', 'display_summary']);
const TASK_STREAM_AGENT_STEP_LIFECYCLE_KEYS = Object.freeze([
  'conversation_admission',
  'raw_output_admission',
  'revision_admission',
]);
const TASK_STREAM_RUN_CONTROL_KEYS = Object.freeze([
  'item_kind',
  'sequence',
  'turn_id',
  'run_id',
  'action',
]);
const TASK_STREAM_CHECKPOINT_RECORDED_KEYS = Object.freeze([
  'item_kind',
  'sequence',
  'turn_id',
  'run_id',
  'status',
  'changed_file_count',
  'verification_status',
]);
const TASK_STREAM_RECOVERY_ACTION_RECORDED_KEYS = Object.freeze([
  'item_kind',
  'sequence',
  'turn_id',
  'run_id',
  'action',
  'phase',
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
const TASK_STREAM_PROGRAMMING_RUNTIME_TOOL_ACTIVITY_KEYS = Object.freeze([
  'item_kind',
  'sequence',
  'turn_id',
  'run_id',
  'step_id',
  'tool_call_id',
  'tool_kind',
  'state',
  'active_label',
  'completed_label',
  'target_label',
  'presentation',
  'presentation_detail',
  'status_label',
  'duration_ms',
  'summary',
  'failure_class',
  'result_ref',
  'file_change',
  'check_result',
]);
const TASK_STREAM_PROGRAMMING_RUNTIME_ASSISTANT_MESSAGE_KEYS = Object.freeze([
  'item_kind',
  'sequence',
  'turn_id',
  'run_id',
  'step_id',
  'message',
]);
const TASK_STREAM_PROGRAMMING_RUNTIME_STATUS_KEYS = Object.freeze([
  'item_kind',
  'sequence',
  'turn_id',
  'run_id',
  'step_id',
  'activity_kind',
  'attention_class',
  'failure_class',
  'status_kind',
  'status',
]);
const TASK_STREAM_PROGRAMMING_RUNTIME_ACTIVITY_KINDS = Object.freeze([
  'session_running',
  'session_idle',
  'turn_preparing',
  'step_analyzing',
  'model_retry_waiting',
  'model_retrying',
  'context_compacting',
  'context_compacted',
  'todo_updated',
  'subagent_started',
  'subagent_finished',
  'generation_finishing',
]);
const TASK_STREAM_PROGRAMMING_RUNTIME_ATTENTION_CLASSES = Object.freeze([
  'permission_required',
  'user_input_required',
  'workspace_unavailable',
]);
const TASK_STREAM_PROGRAMMING_RUNTIME_FAILURE_CLASSES = Object.freeze([
  'cancelled',
  'timeout',
  'provider_failure',
  'runtime_failure',
  'invalid_event',
  'runtime_idle_timeout',
  'run_limit_reached',
]);
const TASK_STREAM_PROGRAMMING_RUNTIME_FILE_CHANGE_KEYS = Object.freeze([
  'change_ref',
  'change_kind',
  'added_lines',
  'deleted_lines',
]);
const TASK_STREAM_PROGRAMMING_RUNTIME_CHECK_RESULT_KEYS = Object.freeze([
  'command_ref',
  'status',
  'duration_ms',
  'summary',
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
const TASK_STREAM_AGENT_STEP_RESULT_SUMMARY_BY_CODE = Object.freeze({
  agent_step_completed_without_raw_output: 'Agent step completed. Details were not kept.',
  agent_step_needs_owner_attention: 'Agent step needs owner attention.',
  agent_step_failed_without_raw_output: 'Agent step could not finish. Details were not kept.',
  agent_step_cancelled_without_raw_output: 'Agent step was stopped. Details were not kept.',
});
const TASK_STREAM_AGENT_STEP_RESULT_CODE_BY_STATUS = Object.freeze({
  succeeded: 'agent_step_completed_without_raw_output',
  blocked: 'agent_step_needs_owner_attention',
  failed: 'agent_step_failed_without_raw_output',
  cancelled: 'agent_step_cancelled_without_raw_output',
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
  const featureFlag = descriptors[PROGRAMMING_RUNTIME_FEATURE_FLAG]?.value;
  const harnessRuntimeRoot = descriptors[HARNESS_RUNTIME_ROOT]?.value;
  if (['disabled', 'shadow', 'enabled'].includes(featureFlag)) {
    output[PROGRAMMING_RUNTIME_FEATURE_FLAG] = featureFlag;
    if (
      featureFlag !== 'disabled'
      &&
      typeof harnessRuntimeRoot === 'string'
      && harnessRuntimeRoot.length > 0
      && !harnessRuntimeRoot.includes('\0')
      && path.isAbsolute(harnessRuntimeRoot)
      && path.normalize(harnessRuntimeRoot) === harnessRuntimeRoot
    ) output[HARNESS_RUNTIME_ROOT] = harnessRuntimeRoot;
  }
  const canaryRuntimeIdleTimeoutMs = descriptors[PACKAGED_CANARY_RUNTIME_IDLE_TIMEOUT_MS]?.value;
  if (
    typeof canaryRuntimeIdleTimeoutMs === 'string'
    && /^[1-9][0-9]{2,4}$/u.test(canaryRuntimeIdleTimeoutMs)
    && Number(canaryRuntimeIdleTimeoutMs) <= 60_000
  ) output[PACKAGED_CANARY_RUNTIME_IDLE_TIMEOUT_MS] = canaryRuntimeIdleTimeoutMs;
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

async function waitForComposerDraftDecisionViaUi(page) {
  await page.locator(SELECTORS.composerVersionDecision).waitFor({ state: 'visible' });
  await page.locator(SELECTORS.saveVersion).waitFor({ state: 'visible' });
  await page.locator(SELECTORS.discardDraft).waitFor({ state: 'visible' });
}

function currentUndoDraftLocator(page) {
  return page.locator(SELECTORS.undoDraft).last();
}

async function optionalUndoDraftUiDiagnostic(page) {
  try {
    return await page.evaluate((selector) => {
      const nodes = Array.from(globalThis.document.querySelectorAll(selector));
      return nodes.slice(-12).map((node, index) => {
        const rect = node.getBoundingClientRect();
        const style = globalThis.getComputedStyle(node);
        return {
          index: Math.max(0, nodes.length - 12) + index,
          text: String(node.textContent ?? '').replace(/\s+/gu, ' ').trim().slice(0, 120),
          disabled: node instanceof globalThis.HTMLButtonElement ? node.disabled : null,
          aria_disabled: node.getAttribute('aria-disabled'),
          connected: node.isConnected,
          display: style.display,
          visibility: style.visibility,
          pointer_events: style.pointerEvents,
          rect: {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
          },
        };
      });
    }, SELECTORS.undoDraft);
  } catch {
    return null;
  }
}

async function clickSaveVersionViaUi(page) {
  const save = page.locator(SELECTORS.saveVersion);
  traceCanaryStage('click_save.wait_check_evidence');
  await waitForPassedProjectCheckEvidenceViaUi(page);
  traceCanaryStage('click_save.check_evidence_ready');
  await assertNoManualProjectCheckControlsViaUi(page);
  await currentUndoDraftLocator(page).waitFor({ state: 'visible' });
  traceCanaryStage('click_save.undo_visible');
  try {
    traceCanaryStage('click_save.close_changes_if_open.start');
    const changesDisclosure = page.locator(SELECTORS.changesDisclosure).first();
    const changesVisible = await changesDisclosure.isVisible({ timeout: 1000 }).catch(() => false);
    if (changesVisible) {
      const changesOpen = await changesDisclosure.evaluate((node) => node.open === true).catch(() => false);
      if (changesOpen) {
        await page.locator(SELECTORS.changesSummaryToggle).click({ timeout: 5000 });
      }
    }
  } catch {
    // The optional Changes disclosure does not control the milestone menu.
  } finally {
    traceCanaryStage('click_save.close_changes_if_open.done');
  }
  if (await save.isHidden().catch(() => true)) {
    traceCanaryStage('click_save.open_legacy_more');
    await page.locator(SELECTORS.reviewMore).click();
  }
  traceCanaryStage('click_save.wait_save_visible');
  await save.waitFor({ state: 'visible' });
  await save.evaluate((node) => {
    if (typeof node.scrollIntoView === 'function') {
      node.scrollIntoView({ block: 'center', inline: 'nearest' });
    }
  });
  traceCanaryStage('click_save.click');
  await save.click();
  traceCanaryStage('click_save.clicked');
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

async function waitForGenerationTerminal(page, projectId = null, userDataRoot = null) {
  const draftReady = page.locator(SELECTORS.unsavedDraft).waitFor({ state: 'visible' })
    .then(() => 'draft_ready', () => new Promise(() => {}));
  const alert = page.locator(SELECTORS.generationFailedNotice).waitFor({ state: 'visible' })
    .then(() => 'alert', () => new Promise(() => {}));
  let timeoutId = null;
  const timeout = new Promise((resolve) => {
    timeoutId = setTimeout(() => resolve('timeout'), CANARY_GENERATION_TERMINAL_TIMEOUT_MS);
  });
  const outcome = await Promise.race([alert, draftReady, timeout]);
  if (timeoutId !== null) clearTimeout(timeoutId);
  if (outcome === 'draft_ready') return;
  if (outcome === 'alert') {
    failWithDiagnostic(
      'canary_generation_terminal_failed',
      await collectUpdateGenerationFailureDiagnostic(
        page,
        'initial_generation_alert',
        projectId,
        userDataRoot,
      ),
    );
  }
  if (outcome === 'timeout') {
    failWithDiagnostic(
      'canary_generation_terminal_failed',
      await collectUpdateGenerationFailureDiagnostic(
        page,
        'generation_terminal_timeout',
        projectId,
        userDataRoot,
      ),
    );
  }
  failWithDiagnostic(
    'canary_generation_terminal_failed',
    await collectUpdateGenerationFailureDiagnostic(page, 'generation_terminal_unknown', projectId, userDataRoot),
  );
}

async function closeArtifactSidebarViaUi(page) {
  if (!await page.locator(SELECTORS.artifactSidebar).isVisible().catch(() => false)) return;
  traceCanaryStage('artifact_sidebar.close.click');
  await page.locator(SELECTORS.artifactToggle).click();
  await page.locator(SELECTORS.artifactSidebar).waitFor({ state: 'hidden', timeout: 10_000 });
  traceCanaryStage('artifact_sidebar.close.done');
}

async function assertArtifactSidebarDefaultHidden(page) {
  if (await page.locator(SELECTORS.artifactSidebar).isVisible().catch(() => false)) {
    fail('canary_review_diff_failed');
  }
}

async function captureGenerationLiveOutputViaUi(page, failureCode) {
  let timeoutId = null;
  try {
    const visibleOutcome = (selector, outcome) => page.locator(selector).first()
      .waitFor({ state: 'visible' })
      .then(() => outcome, () => new Promise(() => {}));
    const timeout = new Promise((resolve) => {
      timeoutId = setTimeout(() => resolve('timeout'), CANARY_GENERATION_TERMINAL_TIMEOUT_MS);
    });
    const outcome = await Promise.race([
      visibleOutcome(SELECTORS.liveOutput, 'assistant_text'),
      visibleOutcome(SELECTORS.unsavedDraft, 'draft_ready'),
      visibleOutcome(SELECTORS.generationFailedNotice, 'failed'),
      timeout,
    ]);
    if (outcome === 'failed') fail(failureCode);
    if (outcome === 'timeout') {
      failWithDiagnostic(failureCode, Object.freeze({
        diagnostic_version: 'builder-canary-generation-timeout-diagnostic.v1',
        generation_failed_notice_visible: await optionalLocatorVisible(
          page,
          SELECTORS.generationFailedNotice,
        ),
        live_output_visible: await optionalLocatorVisible(page, SELECTORS.liveOutput),
        unsaved_draft_visible: await optionalLocatorVisible(page, SELECTORS.unsavedDraft),
      }));
    }
    let liveOutputVisible = await optionalLocatorVisible(page, SELECTORS.liveOutput);
    const fixedWorkStatusVisible = await optionalLocatorVisible(page, SELECTORS.workStatus);
    let text = liveOutputVisible
      ? await optionalLocatorRawText(page, SELECTORS.liveOutput)
      : null;
    if (liveOutputVisible && (text === null || text.trim().length === 0)) {
      await Promise.race([
        page.waitForFunction(
          (selector) => {
            const value = globalThis.document.querySelector(selector)?.textContent;
            return typeof value === 'string' && value.trim().length > 0;
          },
          SELECTORS.liveOutput,
          { timeout: 5_000 },
        ).catch(() => null),
        page.locator(SELECTORS.unsavedDraft).first()
          .waitFor({ state: 'visible', timeout: 5_000 }).catch(() => null),
        page.locator(SELECTORS.generationFailedNotice).first()
          .waitFor({ state: 'visible', timeout: 5_000 }).catch(() => null),
      ]);
      liveOutputVisible = await optionalLocatorVisible(page, SELECTORS.liveOutput);
      text = liveOutputVisible
        ? await optionalLocatorRawText(page, SELECTORS.liveOutput)
        : null;
    }
    const draftReadyVisible = await optionalLocatorVisible(page, SELECTORS.unsavedDraft);
    if (
      fixedWorkStatusVisible
      || (text !== null && REVIEW_DIFF_INTERNAL_EVIDENCE_PATTERN.test(text))
      || (liveOutputVisible && !draftReadyVisible && (text === null || text.trim().length === 0))
    ) {
      failWithDiagnostic(failureCode, {
        draft_ready_visible: draftReadyVisible,
        live_output_visible: liveOutputVisible,
        work_status_present: fixedWorkStatusVisible,
        work_status_safe: text === null || !REVIEW_DIFF_INTERNAL_EVIDENCE_PATTERN.test(text),
      });
    }
    return Object.freeze({
      fixed_work_status_hidden: true,
      progress_kind: liveOutputVisible && text?.trim().length > 0 ? 'assistant_text' : outcome,
      internal_evidence_hidden: true,
      live_output_visible: liveOutputVisible,
      structured_provider_output_hidden: true,
      user_facing_work_status_visible: false,
    });
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError) throw error;
    fail(failureCode);
  } finally {
    if (timeoutId !== null) clearTimeout(timeoutId);
  }
}

async function captureGenerationLiveOutputOrDraftReadyViaUi(page, failureCode) {
  return await captureGenerationLiveOutputViaUi(page, failureCode);
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
  let phase = 'workspace_picker';
  try {
    try {
      await page.locator(SELECTORS.workspacePicker).
        waitFor({ state: 'visible', timeout: 1_000 });
    } catch {
      await page.locator(SELECTORS.workspaceChip).click();
      await page.locator(SELECTORS.workspacePicker).waitFor({ state: 'visible' });
    }
    if (!await page.locator(SELECTORS.newProjectPanel).isVisible()) {
      phase = 'new_project_panel';
      await page.locator(SELECTORS.workspaceNewProject).click();
      await page.locator(SELECTORS.newProjectPanel).waitFor({ state: 'visible' });
    }
    phase = 'source_folder';
    await page.locator(SELECTORS.addSourceFolder).click();
    await page.locator(SELECTORS.workspacePicker).waitFor({ state: 'hidden' });
    phase = 'project_ready';
    await page.locator(`${SELECTORS.projectPage}[data-builder-project-status="ready"]`)
      .waitFor({ state: 'visible', timeout: CANARY_PROJECT_READY_TIMEOUT_MS });
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError) {
      if (error.diagnostic === undefined) {
        error.diagnostic = Object.freeze({
          diagnostic_version: 'builder-canary-initial-draft-phase-diagnostic.v1',
          phase,
        });
      }
      throw error;
    }
    fail('canary_new_project_failed');
  }
}

async function requireBuildWorkspaceBeforeDraftViaUi(page, idea) {
  try {
    await page.locator(SELECTORS.composerAddMenuButton).click();
    const [buildModeCount, filesCount, planModeCount] = await Promise.all([
      page.locator(SELECTORS.composerAddBuildMode).count(),
      page.locator(SELECTORS.composerAddFiles).count(),
      page.locator(SELECTORS.composerAddPlanMode).count(),
    ]);
    if (buildModeCount !== 0 || filesCount !== 0 || planModeCount !== 1) {
      fail('canary_agent_workbench_boundary_failed');
    }
    await page.locator(SELECTORS.composerAddMenuButton).click();
    await page.locator(SELECTORS.idea).fill(idea);
    await clickByRole(page, 'button', 'Send');
    await page.locator(SELECTORS.agentTaskProposalActions).waitFor({ state: 'visible' });
    await page.locator(SELECTORS.unsavedDraft).waitFor({ state: 'hidden' });
    await page.locator(SELECTORS.saveVersion).waitFor({ state: 'hidden' });
    await page.locator(SELECTORS.workspacePicker).waitFor({ state: 'hidden' });
    const proposalText = await page.locator(SELECTORS.agentTaskProposal).textContent();
    const composerClearedAfterProposal = await page.locator(SELECTORS.idea).inputValue();
    if (
      typeof proposalText !== 'string'
      || !proposalText.includes('Task proposal')
      || !proposalText.includes(idea)
      || !proposalText.includes('New project')
      || composerClearedAfterProposal !== ''
      || REVIEW_DIFF_INTERNAL_EVIDENCE_PATTERN.test(proposalText)
    ) fail('canary_build_workspace_required_failed');
    await page.locator(SELECTORS.agentTaskProposalNewProject).click();
    await page.locator(`${SELECTORS.projectPage}[data-builder-project-status="ready"]`)
      .waitFor({ state: 'visible', timeout: CANARY_PROJECT_READY_TIMEOUT_MS });
    await page.locator(SELECTORS.agentTaskProposalActions).waitFor({ state: 'hidden' });
    await page.locator(SELECTORS.idea).fill(idea);
    await clickByRole(page, 'button', 'Send');
    return Object.freeze({
      agent_task_proposal_visible: true,
      agent_workbench_build_mode_hidden: true,
      agent_workbench_files_hidden: true,
      agent_workbench_plan_mode_available: true,
      build_without_workspace_blocked: true,
      build_continued_after_task_materialized: true,
      source_folder_required: true,
      task_started_only_after_user_submit: true,
    });
  } catch (error) {
    const diagnostic = Object.freeze({
      agent_task_proposal_actions_visible: await optionalLocatorVisible(
        page,
        SELECTORS.agentTaskProposalActions,
      ),
      agent_task_proposal_text: safeDiagnosticText(
        await optionalLocatorText(page, SELECTORS.agentTaskProposal),
      ),
      composer_dispatch: await optionalLocatorAttribute(
        page,
        SELECTORS.composer,
        'data-builder-route-dispatch',
      ),
      composer_mode: await optionalLocatorAttribute(
        page,
        '[data-builder-composer-mode-chip]',
        'data-builder-composer-mode-chip',
      ),
      composer_route: await optionalLocatorAttribute(
        page,
        SELECTORS.composer,
        'data-builder-route',
      ),
      composer_signals: await optionalLocatorAttribute(
        page,
        SELECTORS.composer,
        'data-builder-route-signals',
      ),
      composer_text: safeDiagnosticText(await optionalInputValue(page, SELECTORS.idea)),
      project_status: await optionalLocatorAttribute(
        page,
        SELECTORS.projectPage,
        'data-builder-project-status',
      ),
    });
    if (error instanceof BuilderPackagedCanaryError) {
      if (error.diagnostic === undefined) error.diagnostic = diagnostic;
      throw error;
    }
    failWithDiagnostic('canary_build_workspace_required_failed', diagnostic);
  }
}

async function inspectAgentWorkbenchTaskReturnViaUi(page, userDataRoot = null) {
  let phase = 'open_workbench';
  try {
    await page.locator(SELECTORS.agentRosterItem).click();
    phase = 'task_monitor';
    await page.locator(SELECTORS.agentTaskMonitor).waitFor({ state: 'visible' });
    phase = 'task_monitor_item';
    const taskMonitorItem = page.locator(SELECTORS.agentTaskMonitorItem).first();
    await taskMonitorItem.waitFor({ state: 'visible' });
    const taskAddressId = await taskMonitorItem.getAttribute('data-builder-task-monitor-item');
    if (
      typeof taskAddressId !== 'string'
      || !/^builder-task-address:[0-9a-f-]{36}$/u.test(taskAddressId)
    ) fail('canary_agent_workbench_task_return_failed');
    phase = 'task_result';
    const taskResultOpen = page.locator(
      `${SELECTORS.agentTaskResultOpen}[data-builder-task-address-id="${taskAddressId}"]`,
    ).last();
    await taskResultOpen.waitFor({
      state: 'visible',
      timeout: CANARY_PROJECT_READY_TIMEOUT_MS,
    });
    const resultText = await page.locator(SELECTORS.agentTaskResult).last().textContent();
    if (
      typeof resultText !== 'string'
      || resultText.trim().length === 0
      || REVIEW_DIFF_INTERNAL_EVIDENCE_PATTERN.test(resultText)
    ) fail('canary_agent_workbench_task_return_failed');
    phase = 'open_task';
    await taskResultOpen.click();
    phase = 'restore_saved_task';
    await page.locator(`${SELECTORS.projectPage}[data-builder-project-status="ready"]`)
      .waitFor({ state: 'visible', timeout: CANARY_PROJECT_READY_TIMEOUT_MS });
    await page.locator(SELECTORS.unsavedDraft).waitFor({ state: 'hidden' });
    return Object.freeze({
      open_task_returned_to_original_task: true,
      result_message_visible: true,
      task_monitor_visible: true,
    });
  } catch (error) {
    const conversationProjectId = await optionalLocatorAttribute(
      page,
      SELECTORS.projectPage,
      'data-builder-conversation-project-id',
    );
    const diagnostic = Object.freeze({
      diagnostic_version: 'builder-canary-workbench-task-return-diagnostic.v1',
      phase,
      agent_roster_visible: await optionalLocatorVisible(page, SELECTORS.agentRosterItem),
      task_monitor_visible: await optionalLocatorVisible(page, SELECTORS.agentTaskMonitor),
      task_monitor_item_visible: await optionalLocatorVisible(page, SELECTORS.agentTaskMonitorItem),
      task_result_visible: await optionalLocatorVisible(page, SELECTORS.agentTaskResult),
      task_result_text: safeDiagnosticText(await optionalLocatorText(page, SELECTORS.agentTaskResult)),
      project_status: await optionalLocatorAttribute(
        page,
        SELECTORS.projectPage,
        'data-builder-project-status',
      ),
      conversation_status: await optionalLocatorAttribute(
        page,
        SELECTORS.projectPage,
        'data-builder-conversation-status',
      ),
      conversation_project_id: conversationProjectId,
      conversation_item_count: await optionalLocatorAttribute(
        page,
        SELECTORS.projectPage,
        'data-builder-conversation-item-count',
      ),
      unsaved_draft_visible: await optionalLocatorVisible(page, SELECTORS.unsavedDraft),
      generation_debug: optionalCanaryGenerationDebug(userDataRoot),
    });
    if (error instanceof BuilderPackagedCanaryError) {
      if (error.diagnostic === undefined) error.diagnostic = diagnostic;
      throw error;
    }
    failWithDiagnostic('canary_agent_workbench_task_return_failed', diagnostic);
  }
}

async function createInitialDraftViaUi(page, idea, userDataRoot = null) {
  let phase = 'workspace_gate';
  let checkRun = null;
  let draftReviewDiff = null;
  let liveOutput = null;
  let workspaceGate = null;
  try {
    await page.locator(SELECTORS.projectPage).waitFor({ state: 'visible' });
    workspaceGate = await requireBuildWorkspaceBeforeDraftViaUi(page, idea);
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError) throw error;
    fail('canary_new_project_failed');
  }
  try {
    phase = 'write_approval';
    await approveCurrentProjectWriteIfRequested(page);
    phase = 'live_output';
    liveOutput = await captureGenerationLiveOutputViaUi(page, 'canary_generation_terminal_failed');
    phase = 'generation_terminal';
    await waitForGenerationTerminal(page, null, userDataRoot);
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError) {
      if (error.diagnostic === undefined) {
        error.diagnostic = Object.freeze({
          diagnostic_version: 'builder-canary-initial-draft-phase-diagnostic.v1',
          phase,
        });
      }
      throw error;
    }
    fail('canary_generation_terminal_failed');
  }
  try {
    phase = 'draft_visible';
    await page.locator(SELECTORS.unsavedDraft)
      .getByText('Unsaved draft', { exact: true })
      .waitFor({ state: 'visible' });
    phase = 'artifact_sidebar';
    await assertArtifactSidebarDefaultHidden(page);
    phase = 'automatic_check';
    traceCanaryStage('initial_draft.automatic_check.start');
    checkRun = await waitForAutomaticProjectCheckViaUi(page, null, userDataRoot);
    traceCanaryStage('initial_draft.automatic_check.done', checkRun);
    phase = 'draft_review_diff';
    traceCanaryStage('initial_draft.review_diff.start');
    draftReviewDiff = await inspectDraftReviewDiffViaUi(page);
    traceCanaryStage('initial_draft.review_diff.done', draftReviewDiff);
    phase = 'undo_visibility';
    await currentUndoDraftLocator(page).waitFor({ state: 'visible' });
    traceCanaryStage('initial_draft.undo_visible');
    await waitForComposerDraftDecisionViaUi(page);
    traceCanaryStage('initial_draft.composer_decision_visible');
    phase = 'pre_save_bridge_evidence';
    traceCanaryStage('initial_draft.pre_save_bridge.start');
    const preSave = await readSanitizedBridgeEvidence(page);
    traceCanaryStage('initial_draft.pre_save_bridge.done', {
      catalog_projects: preSave.catalog.projects.length,
      current: preSave.current === null ? null : 'present',
    });
    if (preSave.catalog.projects.length !== 0 || preSave.current !== null) {
      failWithDiagnostic(
        'canary_draft_failed',
        await collectInitialDraftFailureDiagnostic(page, 'pre_save_evidence_not_empty', userDataRoot),
      );
    }
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError) {
      if (error.diagnostic === undefined) {
        error.diagnostic = Object.freeze({
          diagnostic_version: 'builder-canary-initial-draft-phase-diagnostic.v1',
          phase,
        });
      }
      throw error;
    }
    failWithDiagnostic(
      'canary_draft_failed',
      await collectInitialDraftFailureDiagnostic(page, 'draft_evidence_step_failed', userDataRoot),
    );
  }
  return Object.freeze({
    ...(checkRun === null ? {} : { check_run: checkRun }),
    live_output: liveOutput,
    pre_save_catalog_empty: true,
    review_diff: draftReviewDiff,
    unsaved_draft_observed: true,
    workbench_task_return_deferred_until_after_save: true,
    workspace_gate: workspaceGate,
  });
}

async function generateProjectViaUi(page, idea, userDataRoot = null) {
  const initialDraft = await createInitialDraftViaUi(page, idea, userDataRoot);
  try {
    traceCanaryStage('generate_project.click_save.start');
    await clickSaveVersionViaUi(page);
    traceCanaryStage('generate_project.click_save.done');
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError) throw error;
    failWithDiagnostic(
      'canary_save_failed',
      await collectInitialDraftFailureDiagnostic(page, 'save_click_failed', userDataRoot),
    );
  }
  try {
    await page.locator(SELECTORS.unsavedDraft).waitFor({ state: 'hidden' });
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError) throw error;
    try {
      const evidence = await readSanitizedBridgeEvidence(page);
      if (evidence.catalog.projects.length === 0) {
        failWithDiagnostic(
          'canary_save_persistence_failed',
          await collectInitialDraftFailureDiagnostic(page, 'saved_project_not_persisted', userDataRoot),
        );
      }
      failWithDiagnostic(
        'canary_save_confirmation_failed',
        await collectInitialDraftFailureDiagnostic(page, 'saved_project_not_confirmed_in_ui', userDataRoot),
      );
    } catch (evidenceError) {
      if (evidenceError instanceof BuilderPackagedCanaryError) throw evidenceError;
      failWithDiagnostic(
        'canary_save_failed',
        await collectInitialDraftFailureDiagnostic(page, 'save_evidence_read_failed', userDataRoot),
      );
    }
  }
  await captureSavedActivityEvidence(page, 1);
  await assertVisibleVersion(page, 1);
  const workbenchTaskReturn = await inspectAgentWorkbenchTaskReturnViaUi(page, userDataRoot);
  return Object.freeze({
    ...initialDraft,
    saved_via_ui: true,
    workbench_task_return: workbenchTaskReturn,
  });
}

async function collectInitialDraftFailureDiagnostic(page, failurePoint, userDataRoot = null) {
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
    canary_debug: optionalCanaryGenerationDebug(userDataRoot),
  });
}

async function readOptionalDraftBridgeEvidence(page) {
  try {
    const catalogEvidence = await readSanitizedBridgeEvidence(page);
    const projects = Array.isArray(catalogEvidence.catalog?.projects)
      ? catalogEvidence.catalog.projects
      : [];
    const projectId = projects.length === 1 && typeof projects[0]?.project_id === 'string'
      ? projects[0].project_id
      : null;
    const evidence = projectId === null
      ? catalogEvidence
      : await readSanitizedBridgeEvidence(page, projectId);
    const currentReceipt = evidence.current?.product_revision_receipt ?? null;
    return Object.freeze({
      read_ok: true,
      catalog_count: projects.length,
      current_state: evidence.current?.state ?? null,
      current_revision_number: evidence.current?.product_revision_receipt?.revision_number ?? null,
      task_stream_state: evidence.task_stream?.conversation?.state ?? null,
      task_stream_item_count: Array.isArray(evidence.task_stream?.conversation?.items)
        ? evidence.task_stream.conversation.items.length
        : evidence.task_stream?.conversation?.item_count ?? null,
      task_stream: taskStreamCheckpointDiagnostic(evidence, 'version_visibility_failure'),
      pending_scan: currentReceipt === null
        ? null
        : await readPendingRestartAppScanDiagnostic(page, currentReceipt),
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

async function waitForPassedProjectCheckEvidenceViaUi(page, projectId = null) {
  const evidenceHandle = await page.waitForFunction(async (request) => {
      const bridge = globalThis.clawfabricBuilder;
      const tree = await bridge?.agentProjectTree?.read?.({ agent_id: request.agentId });
      const treeProjects = Array.isArray(tree?.projects) ? tree.projects : [];
      const resolvedProjectId = typeof request.projectId === 'string'
        ? request.projectId
        : treeProjects.find((project) => typeof project?.project_id === 'string')?.project_id ?? null;
      const project = treeProjects.find((candidate) => candidate?.project_id === resolvedProjectId) ?? null;
      const taskAddressId = Array.isArray(project?.tasks)
        ? project.tasks.find((task) => typeof task?.task_address_id === 'string')?.task_address_id ?? null
        : null;
      if (typeof resolvedProjectId !== 'string' || typeof taskAddressId !== 'string') return false;
      const stream = await bridge?.taskStream?.read?.({
        project_id: resolvedProjectId,
        task_address_id: taskAddressId,
      });
      const outcome = stream?.check_run_outcome_projection;
      const review = stream?.review_state_projection;
      if (
        outcome?.state === 'completed'
        && outcome?.status === 'passed'
        && review?.check_status === 'passed'
      ) {
        return { source: 'task_stream_check_projection', status: 'passed' };
      }
      if (
        outcome?.state === 'skipped'
        && outcome?.status === 'skipped'
        && review?.check_status === 'skipped'
        && review?.can_save === true
      ) {
        return { source: 'task_stream_check_projection', status: 'skipped' };
      }
      return false;
    }, {
      agentId: DEFAULT_BUILDER_AGENT_ID,
      projectId,
    }, { timeout: 120_000 });
  const evidence = await evidenceHandle.jsonValue();
  if (evidence?.source !== 'task_stream_check_projection') {
    throw new Error('Automatic check did not produce task stream check projection evidence.');
  }
  if (evidence.status === 'passed') {
    await page.locator(SELECTORS.runtimeCommandAction).last().waitFor({
      state: 'visible',
      timeout: 10_000,
    });
  }
  return evidence;
}

async function waitForAutomaticProjectCheckViaUi(page, projectId = null, userDataRoot = null) {
  try {
    const evidence = await waitForPassedProjectCheckEvidenceViaUi(page, projectId);
    await assertNoManualProjectCheckControlsViaUi(page);
    return Object.freeze({
      agent_ran_check_automatically: true,
      command_profile_selected_by_main: true,
      manual_check_controls_hidden: true,
      packaged_runtime_executed: true,
      evidence_source: evidence?.source ?? 'unknown',
      status: evidence?.status ?? 'passed',
    });
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError) throw error;
    const conversationProjectId = await optionalLocatorAttribute(
      page,
      SELECTORS.projectPage,
      'data-builder-conversation-project-id',
    );
    failWithDiagnostic('canary_check_run_failed', Object.freeze({
      check_operation: await optionalLocatorAttribute(
        page,
        SELECTORS.checkRunStatus,
        'data-builder-check-run-operation',
      ),
      check_status: await optionalLocatorAttribute(
        page,
        SELECTORS.checkRunStatus,
        'data-builder-check-run-status',
      ),
      check_status_text: await optionalLocatorText(page, SELECTORS.checkRunStatus),
      page_state: await readCheckRunPageDiagnostic(page),
      bridge_check_run: await readCheckRunFailureDiagnostic(
        page,
        typeof conversationProjectId === 'string' && conversationProjectId !== 'none'
          ? conversationProjectId
          : projectId,
      ),
      task_stream: await optionalTaskStreamFailureSummary(
        page,
        typeof conversationProjectId === 'string' && conversationProjectId !== 'none'
          ? conversationProjectId
          : projectId,
      ),
      generation_debug: optionalCanaryGenerationDebug(userDataRoot),
    }));
  }
}

async function assertNoManualProjectCheckControlsViaUi(page) {
  const runCheckVisible = await optionalLocatorVisible(page, SELECTORS.runCheck);
  const skipCheckVisible = await optionalLocatorVisible(page, SELECTORS.skipCheck);
  const visibleButtons = await readVisibleButtonTexts(page);
  const leakedManualCheckButton = visibleButtons.find((text) => (
    /^Run\b/iu.test(text) && /\b(?:npm|pnpm|yarn|test|lint|build|check)\b/iu.test(text)
  ) || /^Skip check$/iu.test(text));
  if (runCheckVisible || skipCheckVisible || leakedManualCheckButton !== undefined) {
    failWithDiagnostic('canary_manual_check_controls_visible', Object.freeze({
      run_check_visible: runCheckVisible,
      skip_check_visible: skipCheckVisible,
      visible_buttons: visibleButtons,
    }));
  }
}

async function readCheckRunFailureDiagnostic(page, requestedProjectId = null) {
  try {
    return await page.evaluate(async (request) => {
      const bridge = globalThis.clawfabricBuilder;
      const workspaces = await bridge?.projectWorkspace?.listWorkspaces?.();
      const candidates = Array.isArray(workspaces?.projects) ? workspaces.projects : [];
      const tree = await bridge?.agentProjectTree?.read?.({ agent_id: request.agentId });
      const treeProjects = Array.isArray(tree?.projects) ? tree.projects : [];
      const projectId = typeof request.projectId === 'string'
        ? request.projectId
        : treeProjects.find((project) => typeof project?.project_id === 'string')?.project_id
          ?? candidates.find((project) => typeof project?.project_id === 'string')?.project_id
          ?? null;
      if (projectId === null) {
        return {
          workspace_found: false,
          agent_tree_project_count: treeProjects.length,
          task_stream_ready: false,
          pending_draft_found: false,
          read_ok: null,
          run_ok: null,
        };
      }
      const project = treeProjects.find((candidate) => candidate?.project_id === projectId) ?? null;
      const taskAddressId = Array.isArray(project?.tasks)
        ? project.tasks.find((task) => typeof task?.task_address_id === 'string')?.task_address_id ?? null
        : null;
      if (taskAddressId === null) {
        return {
          workspace_found: candidates.some((candidate) => candidate?.project_id === projectId),
          agent_tree_project_count: treeProjects.length,
          agent_tree_project_found: project !== null,
          task_address_found: false,
          task_stream_ready: false,
          pending_draft_found: false,
          read_ok: null,
          run_ok: null,
        };
      }
      const stream = await bridge?.taskStream?.read?.({
        project_id: projectId,
        task_address_id: taskAddressId,
      });
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
          agent_tree_project_count: treeProjects.length,
          task_address_found: true,
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
      return {
        workspace_found: true,
        agent_tree_project_count: treeProjects.length,
        task_address_found: true,
        task_stream_ready: stream?.conversation?.state === 'ready',
        stream_project_id: stream?.project_id ?? null,
        stream_keys: stream !== null && typeof stream === 'object'
          ? Object.keys(stream).sort()
          : [],
        conversation_keys: stream?.conversation !== null && typeof stream?.conversation === 'object'
          ? Object.keys(stream.conversation).sort()
          : [],
        conversation_id: stream?.conversation?.conversation_id ?? null,
        conversation_item_count: Array.isArray(stream?.conversation?.items)
          ? stream.conversation.items.length
          : null,
        conversation_first_sequence: stream?.conversation?.items?.[0]?.sequence ?? null,
        conversation_last_sequence: stream?.conversation?.items?.at?.(-1)?.sequence ?? null,
        conversation_window: stream?.conversation?.window ?? null,
        conversation_item_kinds: Array.isArray(stream?.conversation?.items)
          ? [...new Set(stream.conversation.items.map((item) => item?.item_kind ?? null))]
          : [],
        conversation_item_shapes: Array.isArray(stream?.conversation?.items)
          ? Object.values(stream.conversation.items.reduce((shapes, item) => {
            const kind = typeof item?.item_kind === 'string' ? item.item_kind : 'unknown';
            const keys = item !== null && typeof item === 'object' ? Object.keys(item).sort() : [];
            shapes[`${kind}:${keys.join(',')}`] = { item_kind: kind, keys };
            return shapes;
          }, {}))
          : [],
        projection_shapes: Object.fromEntries([
          'draft_checkpoint_status_projection',
          'draft_checkpoint_timeline_projection',
          'review_state_projection',
          'check_run_outcome_projection',
          'agent_activity_projection',
        ].map((key) => [
          key,
          stream?.[key] !== null && typeof stream?.[key] === 'object'
            ? Object.keys(stream[key]).sort()
            : null,
        ])),
        agent_activity_identity: stream?.agent_activity_projection === null
          || typeof stream?.agent_activity_projection !== 'object'
          ? null
          : {
            project_id: stream.agent_activity_projection.project_id ?? null,
            conversation_id: stream.agent_activity_projection.conversation_id ?? null,
            head_sequence: stream.agent_activity_projection.head_sequence ?? null,
          },
        pending_draft_found: true,
        stream_head_sequence: stream?.conversation?.head_sequence ?? null,
        check_outcome_state: stream?.check_run_outcome_projection?.state ?? null,
        check_outcome_status: stream?.check_run_outcome_projection?.status ?? null,
        review_check_status: stream?.review_state_projection?.check_status ?? null,
        read_ok: readResponse?.ok ?? null,
        read_result_version: readResponse?.result?.result_version ?? null,
        read_status: readResponse?.result?.status ?? null,
        read_check_count: Array.isArray(readResponse?.result?.available_checks)
          ? readResponse.result.available_checks.length
          : null,
        run_ok: null,
      };
    }, { agentId: DEFAULT_BUILDER_AGENT_ID, projectId: requestedProjectId });
  } catch {
    return Object.freeze({ diagnostic_unavailable: true });
  }
}

async function readSideWorkspaceFailureDiagnostic(page) {
  try {
    return await page.evaluate(async (request) => {
      const bounded = async (operation) => Promise.race([
        operation(),
        new Promise((resolve) => setTimeout(() => resolve({ __timeout: true }), 2_000)),
      ]);
      const errorCode = (error) => {
        try {
          return typeof error?.code === 'string' ? error.code : 'unclassified';
        } catch {
          return 'unclassified';
        }
      };
      const errorDiagnostic = (error) => {
        try {
          return {
            error_code: errorCode(error),
            error_name: typeof error?.name === 'string' ? error.name.slice(0, 80) : 'unknown',
            error_message: typeof error?.message === 'string'
              ? error.message.replace(/\s+/gu, ' ').slice(0, 240)
              : 'unavailable',
          };
        } catch {
          return { error_code: 'unclassified', error_name: 'unknown', error_message: 'unavailable' };
        }
      };
      const bridge = globalThis.clawfabricBuilder;
      const tree = await bounded(() => bridge?.agentProjectTree?.read?.({
        agent_id: request.agentId,
      }));
      if (tree?.__timeout === true) return { stage: 'agent_tree', status: 'timeout' };
      const projects = Array.isArray(tree?.projects) ? tree.projects : [];
      const project = projects.find((candidate) => Array.isArray(candidate?.tasks)) ?? null;
      const task = project?.tasks?.find((candidate) => (
        typeof candidate?.task_address_id === 'string'
        && typeof candidate?.conversation_id === 'string'
      )) ?? null;
      if (project === null || task === null) {
        return { stage: 'task_identity', status: 'absent', project_count: projects.length };
      }
      const stream = await bounded(() => bridge?.taskStream?.read?.({
        project_id: project.project_id,
        task_address_id: task.task_address_id,
      }));
      if (stream?.__timeout === true) return { stage: 'task_stream', status: 'timeout' };
      const items = Array.isArray(stream?.conversation?.items) ? stream.conversation.items : [];
      const runtimeFile = [...items].reverse().find((item) => (
        item?.item_kind === 'programming_runtime_tool_activity'
        && (item?.tool_kind === 'edit' || item?.tool_kind === 'write')
        && typeof item?.run_id === 'string'
        && typeof item?.tool_call_id === 'string'
      )) ?? null;
      if (runtimeFile === null) {
        return {
          stage: 'runtime_file_fact',
          status: 'absent',
          task_stream_state: stream?.conversation?.state ?? 'unknown',
          item_count: items.length,
        };
      }
      let fileTree;
      try {
        fileTree = await bounded(() => bridge?.sideWorkspaceFiles?.readRuntimeToolFileTree?.({
          project_id: project.project_id,
          conversation_id: task.conversation_id,
          run_id: runtimeFile.run_id,
          tool_call_id: runtimeFile.tool_call_id,
        }));
      } catch (error) {
        return { stage: 'runtime_file_tree', status: 'failed', ...errorDiagnostic(error) };
      }
      if (fileTree?.__timeout === true) return { stage: 'runtime_file_tree', status: 'timeout' };
      const fileRef = fileTree?.selected_file_ref ?? null;
      if (fileRef === null) {
        return {
          stage: 'runtime_file_tree',
          status: 'ready_without_selection',
          entry_count: Array.isArray(fileTree?.entries) ? fileTree.entries.length : null,
        };
      }
      let content;
      try {
        content = await bounded(() => bridge?.sideWorkspaceFiles?.readCurrentDraftFileContent?.({
          project_id: project.project_id,
          conversation_id: task.conversation_id,
          file_ref: fileRef,
        }));
      } catch (error) {
        return {
          stage: 'runtime_file_content',
          status: 'failed',
          ...errorDiagnostic(error),
          source_kind: fileRef.source_kind ?? 'unknown',
          path: fileRef.path ?? 'unknown',
        };
      }
      if (content?.__timeout === true) {
        return {
          stage: 'runtime_file_content',
          status: 'timeout',
          source_kind: fileRef.source_kind ?? 'unknown',
          path: fileRef.path ?? 'unknown',
        };
      }
      return {
        stage: 'runtime_file_content',
        status: 'ready',
        source_kind: content?.file_ref?.source_kind ?? 'unknown',
        path: content?.file_ref?.path ?? 'unknown',
        content_status: content?.content_status ?? 'unknown',
      };
    }, { agentId: DEFAULT_BUILDER_AGENT_ID });
  } catch {
    return Object.freeze({ stage: 'diagnostic', status: 'unavailable' });
  }
}

async function readCheckRunPageDiagnostic(page) {
  try {
    if (typeof page?.isClosed === 'function' && page.isClosed()) {
      return Object.freeze({ page_closed: true });
    }
    return await page.evaluate(() => {
      const bodyText = globalThis.document?.body?.innerText?.replace(/\s+/gu, ' ').trim() ?? '';
      return {
        page_closed: false,
        href: globalThis.location?.href ?? null,
        ready_state: globalThis.document?.readyState ?? null,
        body_text: bodyText.length > 400 ? `${bodyText.slice(0, 400)}...` : bodyText,
        builder_page_count: globalThis.document?.querySelectorAll('[data-builder-page="true"]').length ?? null,
        check_status_count: globalThis.document?.querySelectorAll('[data-builder-check-run-status]').length ?? null,
        conversation_status: globalThis.document
          ?.querySelector('[data-builder-page="true"]')
          ?.getAttribute('data-builder-conversation-status') ?? null,
        conversation_project_id: globalThis.document
          ?.querySelector('[data-builder-page="true"]')
          ?.getAttribute('data-builder-conversation-project-id') ?? null,
      };
    });
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

async function assertConversationActivityInChatViaUi(page, sidebar) {
  const code = 'canary_review_diff_activity_failed';
  await page.locator(SELECTORS.conversationActivity).waitFor({ state: 'visible' });
  const latestUserMessage = page.locator(SELECTORS.userMessage).last();
  await latestUserMessage.waitFor({ state: 'visible' });
  const scroll = await boundedBox(page.locator(SELECTORS.chatScroll), code);
  const activity = await boundedBox(page.locator(SELECTORS.conversationActivity), code);
  const userMessage = await boundedBox(latestUserMessage, code);
  const diagnostic = Object.freeze({
    activity,
    scroll,
    sidebar,
    user_message: userMessage,
    activity_inside_chat_column: boxHorizontallyContains(scroll, activity),
    activity_overlaps_sidebar: boxesOverlap(activity, sidebar),
    user_message_inside_chat_column: boxHorizontallyContains(scroll, userMessage),
    user_message_overlaps_sidebar: boxesOverlap(userMessage, sidebar),
  });
  if (
    scroll.width < CANARY_CHAT_COLUMN_MIN_WIDTH_PX
    || userMessage.width < 88
    || !diagnostic.activity_inside_chat_column
    || !diagnostic.user_message_inside_chat_column
    || diagnostic.activity_overlaps_sidebar
    || diagnostic.user_message_overlaps_sidebar
  ) failWithDiagnostic(code, diagnostic);
}

async function assertDraftWorkspaceActionsLayoutViaUi(page) {
  const code = 'canary_review_diff_composer_decision_layout_failed';
  traceCanaryStage('composer_decision_layout.controls_box.start');
  const controls = await boundedBox(page.locator(SELECTORS.workspaceControls), code);
  traceCanaryStage('composer_decision_layout.controls_box.done', controls);
  traceCanaryStage('composer_decision_layout.composer_box.start');
  const composer = await boundedBox(page.locator(SELECTORS.composer), code);
  traceCanaryStage('composer_decision_layout.composer_box.done', composer);
  traceCanaryStage('composer_decision_layout.decision_box.start');
  const decision = await boundedBox(page.locator(SELECTORS.composerVersionDecision), code);
  traceCanaryStage('composer_decision_layout.decision_box.done', decision);
  traceCanaryStage('composer_decision_layout.discard_box.start');
  const discard = await boundedBox(page.locator(SELECTORS.discardDraft), code);
  traceCanaryStage('composer_decision_layout.discard_box.done', discard);
  traceCanaryStage('composer_decision_layout.save_box.start');
  const save = await boundedBox(page.locator(SELECTORS.saveVersion), code);
  traceCanaryStage('composer_decision_layout.save_box.done', save);
  traceCanaryStage('composer_decision_layout.latest_activity_box.start');
  const latestActivity = await boundedBox(
    page.locator(`${SELECTORS.conversationActivity} .cf-builder-activity-list > li`).last(),
    code,
  );
  traceCanaryStage('composer_decision_layout.latest_activity_box.done', latestActivity);
  const workspaceDraftActionsCount = await optionalLocatorCount(page, SELECTORS.workspaceDraftActions);
  const reviewMoreCount = await optionalLocatorCount(page, SELECTORS.reviewMore);
  traceCanaryStage('composer_decision_layout.counts.done', {
    review_more_count: reviewMoreCount,
    workspace_draft_actions_count: workspaceDraftActionsCount,
  });
  const diagnostic = Object.freeze({
    composer,
    controls,
    decision,
    discard,
    latest_activity: latestActivity,
    save,
    decision_overlaps_controls: boxesOverlap(decision, controls),
    decision_above_composer: decision.y + decision.height <= composer.y + 2,
    decision_width_matches_composer: Math.abs(decision.x - composer.x) <= 16
      && decision.width >= composer.width * 0.9
      && decision.width <= composer.width + 16,
    latest_activity_above_decision: boxBottom(latestActivity) <= decision.y + 2,
    discard_inside_decision: boxContains(decision, discard),
    save_inside_decision: boxContains(decision, save),
    save_overlaps_discard: boxesOverlap(save, discard),
    workspace_draft_actions_count: workspaceDraftActionsCount,
    review_more_count: reviewMoreCount,
  });
  const failed = (
    decision.height < 72
    || discard.width < 96
    || discard.height < 28
    || discard.height > 48
    || save.width < 96
    || save.height < 28
    || save.height > 48
    || diagnostic.decision_overlaps_controls
    || !diagnostic.decision_above_composer
    || !diagnostic.decision_width_matches_composer
    || !diagnostic.latest_activity_above_decision
    || !diagnostic.discard_inside_decision
    || !diagnostic.save_inside_decision
    || diagnostic.save_overlaps_discard
    || workspaceDraftActionsCount !== 0
  );
  traceCanaryStage('composer_decision_layout.evaluated', { failed, diagnostic });
  if (failed) failWithDiagnostic(code, diagnostic);
  traceCanaryStage('composer_decision_layout.pass');
}

async function assertDraftArtifactPreviewLayoutViaUi(page) {
  const code = 'canary_review_diff_artifact_layout_failed';
  const scroll = await boundedBox(page.locator(SELECTORS.chatScroll), code);
  const sidebar = await boundedBox(page.locator(SELECTORS.artifactSidebar), code);
  const resize = await boundedBox(page.locator(SELECTORS.artifactResizeHandle), code);
  const result = await boundedBox(
    page.locator(SELECTORS.artifactSidebar).locator(SELECTORS.resultFlow),
    code,
  );
  let failureCode = null;
  if (
    scroll.width < CANARY_CHAT_COLUMN_MIN_WIDTH_PX
    || scroll.height < CANARY_CHAT_COLUMN_MIN_HEIGHT_PX
  ) {
    failureCode = 'canary_review_diff_artifact_chat_geometry_failed';
  }
  if (
    failureCode === null
    && (
      sidebar.width < CANARY_ARTIFACT_SIDEBAR_MIN_WIDTH_PX
      || boxRight(scroll) > sidebar.x + 1
    )
  ) {
    failureCode = 'canary_review_diff_artifact_sidebar_geometry_failed';
  }
  if (failureCode === null && (
    resize.width < 6
    || resize.height < 320
    || resize.x > sidebar.x + 2
    || boxRight(resize) < sidebar.x - 1
    || resize.y > sidebar.y + 1
    || boxBottom(resize) < boxBottom(sidebar) - 1
  )) failureCode = 'canary_review_diff_artifact_resize_geometry_failed';
  if (failureCode === null && (
    result.width < CANARY_ARTIFACT_SIDEBAR_MIN_WIDTH_PX - 1
    || !boxContains(sidebar, result)
    || boxContains(scroll, result)
  )) failureCode = 'canary_review_diff_artifact_result_geometry_failed';
  if (failureCode !== null) failWithDiagnostic(failureCode, Object.freeze({
    artifact_chat_min_height_px: CANARY_CHAT_COLUMN_MIN_HEIGHT_PX,
    artifact_chat_min_width_px: CANARY_CHAT_COLUMN_MIN_WIDTH_PX,
    artifact_sidebar_min_width_px: CANARY_ARTIFACT_SIDEBAR_MIN_WIDTH_PX,
    result_box: geometryDiagnosticBox(result),
    result_inside_sidebar: boxContains(sidebar, result),
    scroll_box: geometryDiagnosticBox(scroll),
    sidebar_box: geometryDiagnosticBox(sidebar),
  }));
  return Object.freeze({ result, sidebar });
}

function geometryDiagnosticBox(box) {
  return Object.freeze({
    height: box.height,
    width: box.width,
    x: box.x,
    y: box.y,
  });
}

async function assertChangesPanelLayoutViaUi(page, artifact) {
  const code = 'canary_review_diff_changes_layout_failed';
  let last = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const scroll = await boundedBox(page.locator(SELECTORS.chatScroll), code);
    const flow = await boundedBox(page.locator(SELECTORS.changesFlow), code);
    const panel = await boundedBox(page.locator(SELECTORS.changesPanel), code);
    const card = await boundedBox(page.locator(SELECTORS.changeCard).first(), code);
    const diff = await boundedBox(page.locator(SELECTORS.changeDiff).first(), code);
    last = { scroll, flow, panel, card, diff };

    if (
      flow.width >= 300
      && panel.width >= 300
      && flow.height >= 80
      && panel.height >= 80
      && boxContains(artifact.sidebar, flow)
      && boxContains(artifact.sidebar, panel)
      && !boxContains(scroll, panel)
      && boxContains(flow, panel)
      && boxContains(panel, card)
      && boxContains(card, diff)
      && diff.height >= 24
    ) return;
    if (typeof page.waitForTimeout !== 'function') break;
    await page.waitForTimeout(100);
  }
  failWithDiagnostic(code, Object.freeze({
    diagnostic_version: 'builder-canary-changes-layout-diagnostic.v1',
    ...(last === null ? {} : {
      artifact_sidebar: geometryDiagnosticBox(artifact.sidebar),
      card: geometryDiagnosticBox(last.card),
      diff: geometryDiagnosticBox(last.diff),
      flow: geometryDiagnosticBox(last.flow),
      panel: geometryDiagnosticBox(last.panel),
      scroll: geometryDiagnosticBox(last.scroll),
      card_contains_diff: boxContains(last.card, last.diff),
      flow_contains_panel: boxContains(last.flow, last.panel),
      panel_contains_card: boxContains(last.panel, last.card),
      panel_inside_artifact: boxContains(artifact.sidebar, last.panel),
      panel_inside_chat: boxContains(last.scroll, last.panel),
    }),
  }));
}

async function assertCurrentDraftFileContentViaUi(page) {
  try {
    await page.locator(SELECTORS.workspaceMenuButton).click();
    await page.locator(SELECTORS.workspaceControlSource).waitFor({ state: 'visible' });
    await page.locator(SELECTORS.workspaceControlSource).click();
    await page.locator(SELECTORS.sideWorkspaceFiles).waitFor({ state: 'visible' });
    await page.locator(SELECTORS.sideWorkspaceFileContentReady).waitFor({
      state: 'visible',
      timeout: 10_000,
    });
    await page.locator(SELECTORS.sideWorkspaceCodeViewer).waitFor({ state: 'visible' });
    await page.locator(SELECTORS.sideWorkspaceCodeLine).first().waitFor({
      state: 'visible',
      timeout: 10_000,
    });
    return true;
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError) throw error;
    failWithDiagnostic('canary_side_workspace_file_content_failed', Object.freeze({
      files_visible: await optionalLocatorVisible(page, SELECTORS.sideWorkspaceFiles),
      ready_content_visible: await optionalLocatorVisible(page, SELECTORS.sideWorkspaceFileContentReady),
      code_viewer_visible: await optionalLocatorVisible(page, SELECTORS.sideWorkspaceCodeViewer),
      code_line_count: await optionalLocatorCount(page, SELECTORS.sideWorkspaceCodeLine),
    }));
  }
}

async function inspectDraftReviewDiffViaUi(page) {
  let reviewStage = 'initializing';
  try {
    reviewStage = 'waiting_terminal_summary';
    await page.locator(SELECTORS.completionSummary).waitFor({ state: 'hidden' });
    await page.locator(SELECTORS.reviewCheckpoint).waitFor({ state: 'hidden' });
    await page.locator(SELECTORS.artifactSummary).waitFor({ state: 'hidden' });
    traceCanaryStage('review_diff.wait_check_evidence.start');
    await waitForPassedProjectCheckEvidenceViaUi(page);
    traceCanaryStage('review_diff.wait_check_evidence.done');
    const draftProposal = page.locator(SELECTORS.draftProposed).last();
    const runtimeFileActions = page.locator(SELECTORS.runtimeFileAction);
    const runtimeFileGroup = page.locator(SELECTORS.runtimeFileGroup).last();
    const runtimeCommandActions = page.locator(SELECTORS.runtimeCommandAction);
    const draftProposalActionCount = await draftProposal
      .locator('[data-builder-completed-action-group]')
      .count();
    const runtimeFileActionCount = await runtimeFileActions.count();
    const runtimeCommandActionCount = await runtimeCommandActions.count();
    const runtimeFileGroupCount = await runtimeFileGroup.count();
    const usingRuntimeFacts = runtimeFileActionCount > 0 && runtimeCommandActionCount > 0;
    traceCanaryStage('review_diff.runtime_fact_counts', {
      runtime_command_count: runtimeCommandActionCount,
      runtime_file_count: runtimeFileActionCount,
      runtime_group_count: runtimeFileGroupCount,
      using_runtime_facts: usingRuntimeFacts,
    });
    const runtimeFileGrouped = usingRuntimeFacts && runtimeFileGroupCount === 1;
    const fileActions = usingRuntimeFacts
      ? runtimeFileGrouped ? runtimeFileGroup : runtimeFileActions.last()
      : page.locator(SELECTORS.completedFileActions).last();
    const commandActions = usingRuntimeFacts
      ? runtimeCommandActions.last()
      : page.locator(SELECTORS.completedCommandActions).last();
    const draftCandidateChange = usingRuntimeFacts
      ? runtimeFileActions
      : fileActions.locator(SELECTORS.completionCandidateChange);
    const draftCommand = usingRuntimeFacts
      ? commandActions
      : commandActions.locator(SELECTORS.completionCommand);
    const draftCommandButton = usingRuntimeFacts
      ? page.locator(SELECTORS.runtimeCommandOpen).last()
      : commandActions.locator('button');
    const fileDisclosure = fileActions.locator('details');
    const commandDisclosure = commandActions.locator('details');
    reviewStage = 'validating_completed_actions';
    await fileActions.waitFor({ state: 'visible' });
    const failCompletedActions = async () => failWithDiagnostic(
      'canary_review_diff_completed_actions_failed',
      Object.freeze({
        file_action_text: await optionalExistingLocatorText(fileActions),
        command_action_text: await optionalExistingLocatorText(commandActions),
        candidate_change_count: await optionalExistingLocatorCount(draftCandidateChange),
        command_count: await optionalExistingLocatorCount(draftCommand),
        file_disclosure_count: await optionalExistingLocatorCount(fileDisclosure),
        command_disclosure_count: await optionalExistingLocatorCount(commandDisclosure),
        using_runtime_facts: usingRuntimeFacts,
        runtime_file_grouped: runtimeFileGrouped,
        draft_proposal_action_count: draftProposalActionCount,
      }),
    );
    const candidateChangeCount = await draftCandidateChange.count();
    if (candidateChangeCount < 1) {
      await failCompletedActions();
    }
    try {
      await commandActions.waitFor({ state: 'visible' });
    } catch {
      await failCompletedActions();
    }
    if (await draftCommand.count() !== 1) await failCompletedActions();
    const fileDisclosureCount = await fileDisclosure.count();
    const commandDisclosureCount = await commandDisclosure.count();
    const expectedGroupedFileDisclosure = usingRuntimeFacts && runtimeFileGrouped
      ? fileDisclosureCount >= 1
      : fileDisclosureCount === 1;
    if (
      (candidateChangeCount === 1 && fileDisclosureCount !== 0)
      || (candidateChangeCount > 1 && !expectedGroupedFileDisclosure)
      || (!usingRuntimeFacts && commandDisclosureCount !== 0)
    ) await failCompletedActions();
    const fileActionText = await fileActions.textContent();
    const commandActionText = await commandActions.textContent();
    const fileActionLooksFactual = usingRuntimeFacts && runtimeFileGrouped
      ? /(?:Added|Edited|Deleted) \d+ files/u.test(fileActionText ?? '')
      : /(?:Added|Edited|Deleted|Edited \d+ files) [^\s]+/u.test(fileActionText ?? '');
    if (
      typeof fileActionText !== 'string'
      || typeof commandActionText !== 'string'
      || !fileActionLooksFactual
      || !/(?:Ran|Tried) [^\s]+/u.test(commandActionText)
      || /Ran|Tried/u.test(fileActionText)
      || /Added|Edited|Deleted/u.test(commandActionText)
      || /Work details|Read the current project context|Started the AI request|Received the AI response|Prepared the result for review/u.test(`${fileActionText} ${commandActionText}`)
    ) await failCompletedActions();
    reviewStage = 'validating_workspace_actions';
    traceCanaryStage('review_diff.workspace_actions.start');
    await assertDraftWorkspaceActionsLayoutViaUi(page);
    traceCanaryStage('review_diff.workspace_actions.done');
    if (usingRuntimeFacts) {
      traceCanaryStage('review_diff.return_runtime_fast_path');
      return Object.freeze({
        activity_stays_in_chat: true,
        artifact_sidebar_default_hidden: true,
        artifact_sidebar_opened_on_user_request: false,
        chat_runtime_response_visible: true,
        completed_review_verified_from_chat_runtime_facts: true,
        composer_decision_card_visible: true,
        check_status_verified_from_chat_or_task_stream: true,
        duplicate_result_summary_hidden: true,
        duplicate_review_checkpoint_hidden: true,
        mechanical_completion_summary_hidden: true,
        factual_candidate_change_in_chat: true,
        factual_command_in_chat: true,
        final_response_has_no_work_details: true,
        result_action_types_separate: true,
        runtime_facts_preferred_over_legacy_review_panel: true,
        side_workspace_file_content_loaded: false,
        command_details_opened_from_chat: false,
        provider_lifecycle_steps_hidden: true,
        internal_evidence_hidden: true,
        draft_actions_in_workspace_toolbar: false,
      });
    }
    reviewStage = 'opening_preview';
    traceCanaryStage('review_diff.opening_preview.start');
    await page.locator(SELECTORS.workspaceMenuButton).click();
    await page.locator(SELECTORS.workspaceControlPreview).waitFor({ state: 'visible' });
    await page.locator(SELECTORS.workspaceControlPreview).click();
    await page.locator(SELECTORS.artifactSidebar).waitFor({ state: 'visible' });
    traceCanaryStage('review_diff.opening_preview.done');
    reviewStage = 'validating_preview_layout';
    traceCanaryStage('review_diff.validating_preview_layout.start');
    const artifactBox = await assertDraftArtifactPreviewLayoutViaUi(page);
    traceCanaryStage('review_diff.validating_preview_layout.done');
    reviewStage = 'validating_chat_activity_layout';
    traceCanaryStage('review_diff.validating_chat_activity_layout.start');
    await assertConversationActivityInChatViaUi(page, artifactBox.sidebar);
    traceCanaryStage('review_diff.validating_chat_activity_layout.done');
    reviewStage = 'opening_chat_file';
    if (usingRuntimeFacts) {
      const visibleRuntimeFileButton = () => page.locator(
        '[data-builder-runtime-tool-kind="edit"] button:visible, '
        + '[data-builder-runtime-tool-kind="write"] button:visible',
      );
      const currentCandidateFileButton = () => visibleRuntimeFileButton()
        .filter({ hasText: 'index.html' })
        .last();
      let firstFileButton = currentCandidateFileButton();
      if (await firstFileButton.count() === 0 && runtimeFileGrouped) {
        reviewStage = 'expanding_chat_file_group';
        await fileDisclosure.locator('summary').click();
        firstFileButton = currentCandidateFileButton();
      }
      await firstFileButton.evaluate((node) => {
        if (typeof node.scrollIntoView === 'function') {
          node.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }
      });
      reviewStage = 'waiting_chat_file_button';
      await firstFileButton.waitFor({ state: 'visible' });
      reviewStage = 'clicking_chat_file_button';
      await firstFileButton.click();
      reviewStage = 'waiting_chat_file_content';
      await page.locator(SELECTORS.sideWorkspaceFileContentReady).waitFor({
        state: 'visible',
        timeout: 10_000,
      });
      await page.locator(SELECTORS.sideWorkspaceCodeViewer).waitFor({ state: 'visible' });
    }
    reviewStage = 'opening_chat_command';
    traceCanaryStage('review_diff.opening_chat_command.start');
    await draftCommandButton.waitFor({ state: 'visible', timeout: 10_000 });
    await draftCommandButton.evaluate((node) => {
      if (typeof node.scrollIntoView === 'function') {
        node.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
    });
    await draftCommandButton.click();
    await page.locator(SELECTORS.activeTerminalTab).waitFor({ state: 'visible' });
    await page.locator(SELECTORS.commandInspector).waitFor({ state: 'visible' });
    traceCanaryStage('review_diff.opening_chat_command.done');
    const commandDisplayText = await page.locator(SELECTORS.commandDisplay).textContent();
    if (typeof commandDisplayText !== 'string' || commandDisplayText.trim().length === 0) {
      fail('canary_review_diff_completed_actions_failed');
    }
    reviewStage = 'opening_workspace_menu';
    traceCanaryStage('review_diff.opening_changes.start');
    await page.locator(SELECTORS.workspaceMenuButton).waitFor({ state: 'visible' });
    await page.locator(SELECTORS.workspaceMenuButton).click();
    reviewStage = 'opening_changes';
    await page.locator(SELECTORS.workspaceControlChanges).waitFor({ state: 'visible' });
    await page.locator(SELECTORS.workspaceControlChanges).click();
    await page.locator(SELECTORS.changesPanel).waitFor({ state: 'visible' });
    await page.locator(SELECTORS.changeCard).first().waitFor({ state: 'visible' });
    await page.locator(SELECTORS.changeDiff).first().waitFor({ state: 'visible' });
    await page.locator(SELECTORS.changeDiffLine).first().waitFor({ state: 'visible' });
    await assertChangesPanelLayoutViaUi(page, artifactBox);
    traceCanaryStage('review_diff.opening_changes.done');
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
    reviewStage = 'reading_current_file';
    traceCanaryStage('review_diff.reading_current_file.start');
    const sideWorkspaceFileContentLoaded = await assertCurrentDraftFileContentViaUi(page);
    traceCanaryStage('review_diff.reading_current_file.done');
    reviewStage = 'closing_artifact_sidebar';
    traceCanaryStage('review_diff.closing_artifact_sidebar.start');
    await closeArtifactSidebarViaUi(page);
    traceCanaryStage('review_diff.closing_artifact_sidebar.done');
    return Object.freeze({
      activity_stays_in_chat: true,
      artifact_sidebar_default_hidden: true,
      artifact_sidebar_opened_on_user_request: true,
      artifact_resize_handle_visible: true,
      chat_terminal_response_compact_visible: true,
      compact_check_status_in_workspace_toolbar: true,
      changes_diff_nested_in_panel: true,
      changes_panel_in_artifact_sidebar: true,
      changes_panel_visible: true,
      duplicate_result_summary_hidden: true,
      duplicate_review_checkpoint_hidden: true,
      mechanical_completion_summary_hidden: true,
      factual_candidate_change_in_chat: true,
      factual_command_in_chat: true,
      final_response_has_no_work_details: true,
      result_action_types_separate: true,
      single_result_actions_not_collapsed: true,
      side_workspace_file_content_loaded: sideWorkspaceFileContentLoaded,
      command_details_opened_from_chat: true,
      provider_lifecycle_steps_hidden: true,
      inline_diff_visible: true,
      internal_evidence_hidden: true,
      draft_actions_in_workspace_toolbar: false,
    });
  } catch (error) {
    if (
      error instanceof BuilderPackagedCanaryError
      && error.code !== 'canary_evidence_failed'
    ) throw error;
    failWithDiagnostic(
      'canary_review_diff_failed',
      await collectReviewDiffFailureDiagnostic(page, reviewStage),
    );
  }
}

async function collectReviewDiffFailureDiagnostic(page, reviewStage = 'unknown') {
  const fileActions = page.locator(SELECTORS.completedFileActions).last();
  const commandActions = page.locator(SELECTORS.completedCommandActions).last();
  const draftCandidateChange = fileActions.locator(SELECTORS.completionCandidateChange);
  const runtimeFileActions = page.locator(SELECTORS.runtimeFileAction);
  const runtimeFileGroup = page.locator(SELECTORS.runtimeFileGroup).last();
  const runtimeCommandActions = page.locator(SELECTORS.runtimeCommandAction);
  const runtimeFileButton = runtimeFileActions.first().locator('button');
  const runtimeFileDetails = runtimeFileGroup.locator('details');
  return Object.freeze({
    diagnostic_version: 'builder-canary-review-diff-diagnostic.v1',
    review_stage: reviewStage,
    project_status: await optionalLocatorAttribute(page, SELECTORS.projectPage, 'data-builder-project-status'),
    review_visible: await optionalLocatorVisible(page, SELECTORS.reviewCheckpoint),
    review_text: await optionalLocatorText(page, SELECTORS.reviewCheckpoint),
    draft_proposed_count: await optionalLocatorCount(page, SELECTORS.draftProposed),
    completed_file_actions_visible: await optionalExistingLocatorVisible(fileActions),
    completed_file_actions_text: await optionalExistingLocatorText(fileActions),
    completed_command_actions_visible: await optionalExistingLocatorVisible(commandActions),
    completed_command_actions_text: await optionalExistingLocatorText(commandActions),
    candidate_change_count: await optionalExistingLocatorCount(draftCandidateChange),
    runtime_file_action_count: await optionalExistingLocatorCount(runtimeFileActions),
    runtime_file_group_count: await optionalExistingLocatorCount(runtimeFileGroup),
    runtime_command_action_count: await optionalExistingLocatorCount(runtimeCommandActions),
    runtime_file_action_text: await optionalExistingLocatorText(runtimeFileActions.last()),
    runtime_command_action_text: await optionalExistingLocatorText(runtimeCommandActions.last()),
    runtime_file_button_count: await optionalExistingLocatorCount(runtimeFileButton),
    runtime_file_button_visible: await optionalExistingLocatorVisible(runtimeFileButton),
    runtime_file_group_open: await optionalDetailsOpen(runtimeFileDetails),
    artifact_active_tab: await readArtifactActiveTab(page),
    side_workspace_file_content_status: await optionalLocatorAttribute(
      page,
      SELECTORS.sideWorkspaceFileContent,
      'data-builder-side-workspace-file-content-status',
    ),
    side_workspace_file_content_path: await optionalLocatorAttribute(
      page,
      SELECTORS.sideWorkspaceFileContent,
      'data-builder-side-workspace-file-content',
    ),
    side_workspace_file_content_text: await optionalLocatorText(page, SELECTORS.sideWorkspaceFileContent),
    bridge_side_workspace: await readSideWorkspaceFailureDiagnostic(page),
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

async function retryFailedDraftViaUi(page, idea, replacementIdea = CANARY_UPDATE_INSTRUCTION, userDataRoot = null) {
  let draftReviewDiff = null;
  try {
    await page.locator(SELECTORS.projectPage).waitFor({ state: 'visible' });
    await requireBuildWorkspaceBeforeDraftViaUi(page, idea);
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
    await currentUndoDraftLocator(page).waitFor({ state: 'visible' });
    await waitForAutomaticProjectCheckViaUi(page, null, userDataRoot);
    await waitForComposerDraftDecisionViaUi(page);
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

async function optionalExistingLocatorCount(locator) {
  try {
    return await locator.count();
  } catch {
    return null;
  }
}

async function optionalExistingLocatorVisible(locator) {
  try {
    return await locator.isVisible();
  } catch {
    return null;
  }
}

async function optionalExistingLocatorText(locator) {
  try {
    return safeDiagnosticText(await locator.textContent());
  } catch {
    return null;
  }
}

async function optionalDetailsOpen(locator) {
  try {
    return await locator.evaluate((node) => node.open === true);
  } catch {
    return false;
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

async function optionalLocatorRawText(page, selector) {
  try {
    const value = await page.locator(selector).textContent();
    return typeof value === 'string' ? value : null;
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
      let stream;
      try {
        const tree = await globalThis.clawfabricBuilder.agentProjectTree.read({
          agent_id: request.agentId,
        });
        const project = tree?.projects?.find((candidate) => candidate?.project_id === request.projectId);
        const taskAddressId = project?.tasks?.[0]?.task_address_id;
        if (typeof taskAddressId !== 'string') throw new Error('task address unavailable');
        stream = await globalThis.clawfabricBuilder.taskStream.read({
          project_id: request.projectId,
          task_address_id: taskAddressId,
        });
      } catch (error) {
        return {
          read_failed: true,
          error_code: typeof error?.code === 'string' ? error.code : null,
          retryable: error?.retryable === true,
        };
      }
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
    }, { agentId: DEFAULT_BUILDER_AGENT_ID, projectId });
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
            runtime_code: parsed.runtime_code,
            runtime_cause_code: parsed.runtime_cause_code,
          };
        } catch {
          return {
            result_version: 'builder-canary-generation-debug.v1',
            phase: 'unreadable',
            code: 'unknown',
            runtime_code: 'unknown',
            runtime_cause_code: 'unknown',
          };
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
  const conversationProjectId = await optionalLocatorAttribute(
    page,
    SELECTORS.projectPage,
    'data-builder-conversation-project-id',
  );
  const diagnosticProjectId = projectId ?? (
    typeof conversationProjectId === 'string' && conversationProjectId !== 'none'
      ? conversationProjectId
      : null
  );
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
    task_stream: await optionalTaskStreamFailureSummary(page, diagnosticProjectId),
    generation_debug: optionalCanaryGenerationDebug(userDataRoot, fsModule),
  });
}

async function waitForVisibleQuestionAnswers(page, expectedVisibleAnswers) {
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

async function observeLiveOutputStability(page) {
  const observationKey = '__builderPackagedCanaryLiveOutputObservation';
  await page.evaluate(({ liveOutputSelector, key }) => {
    const prior = globalThis[key];
    prior?.observer?.disconnect?.();
    const state = {
      current: null,
      initial: null,
      maximumTextLength: 0,
      previousText: '',
      replacementCount: 0,
      structuredJsonVisible: false,
      textContentUpdates: 0,
      observer: null,
    };
    function sample() {
      const current = globalThis.document.querySelector(liveOutputSelector);
      if (!(current instanceof globalThis.HTMLElement)) {
        state.current = null;
        return;
      }
      if (state.initial === null) {
        state.initial = current;
        state.current = current;
        state.previousText = current.textContent ?? '';
      } else if (current !== state.initial && current !== state.current) {
        state.replacementCount += 1;
        state.current = current;
        state.previousText = '';
      } else {
        state.current = current;
      }
      const text = current.textContent ?? '';
      if (text !== state.previousText) state.textContentUpdates += 1;
      state.previousText = text;
      state.maximumTextLength = Math.max(state.maximumTextLength, text.length);
      if (/"(?:kind|summary|operations|steps)"\s*:/u.test(text)) state.structuredJsonVisible = true;
    }
    state.observer = new globalThis.MutationObserver(sample);
    state.observer.observe(globalThis.document.body, { characterData: true, childList: true, subtree: true });
    sample();
    globalThis[key] = state;
  }, {
    key: observationKey,
    liveOutputSelector: SELECTORS.liveOutput,
  });
  return Object.freeze({
    finish: () => page.evaluate(({ key }) => {
      const state = globalThis[key];
      if (state === null || typeof state !== 'object') return null;
      state.observer?.disconnect?.();
      delete globalThis[key];
      if (!(state.initial instanceof globalThis.HTMLElement)) return null;
      return {
        maximum_text_length: state.maximumTextLength,
        message_node_replacements: state.replacementCount,
        structured_json_visible: state.structuredJsonVisible,
        text_content_updates: state.textContentUpdates,
      };
    }, { key: observationKey }),
  });
}

async function askInitialChatQuestionViaUi(
  page,
  question = CANARY_INITIAL_CHAT_QUESTION,
  expectedVisibleAnswers = 1,
  options = Object.freeze({}),
) {
  let liveOutputObservation = null;
  try {
    await page.locator(SELECTORS.idea).fill(question);
    const observation = options.observeLiveOutput === true
      ? await observeLiveOutputStability(page)
      : null;
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
    liveOutputObservation = observation === null ? null : await observation.finish();
    if (
      options.observeLiveOutput === true
      && (
        liveOutputObservation === null
        || liveOutputObservation.message_node_replacements !== 0
        || liveOutputObservation.structured_json_visible !== false
        || liveOutputObservation.text_content_updates < 2
        || liveOutputObservation.text_content_updates > 40
      )
    ) {
      failWithDiagnostic('canary_question_evidence_failed', {
        live_output_observation: liveOutputObservation,
      });
    }
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
    ...(liveOutputObservation === null ? {} : {
      streaming_output: Object.freeze({
        frame_updates_bounded: true,
        message_node_stable: true,
        structured_json_hidden: true,
        visible_text_observed: liveOutputObservation.maximum_text_length > 0,
      }),
    }),
  });
}

async function askProjectQuestionViaUi(
  page,
  currentProject,
  question = CANARY_QUESTION,
  expectedCandidateTurns = currentProject.revision_number,
  expectedQuestionTurns = 1,
  expectedVisibleAnswers = expectedQuestionTurns,
  options = Object.freeze({}),
) {
  const expectedAnswerText = typeof options.expected_answer_text === 'string'
    ? options.expected_answer_text
    : null;
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
    if (expectedAnswerText !== null) {
      const latestAnswerText = await page.locator(SELECTORS.questionAnswer)
        .nth(expectedVisibleAnswers - 1)
        .textContent();
      if (typeof latestAnswerText !== 'string' || !latestAnswerText.includes(expectedAnswerText)) {
        failWithDiagnostic('canary_question_evidence_failed', {
          expected_answer_digest: digestText(expectedAnswerText),
          latest_answer_digest: typeof latestAnswerText === 'string'
            ? digestText(latestAnswerText)
            : null,
        });
      }
    }
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError) {
      if (error.code !== 'canary_question_failed' || error.diagnostic !== undefined) throw error;
      await failQuestionWithDiagnostic(page, 'question_failed', expectedVisibleAnswers);
    }
    await failQuestionWithDiagnostic(page, 'exception', expectedVisibleAnswers);
  }
  try {
    if (options.expect_unsaved_draft === true) {
      await page.locator(SELECTORS.unsavedDraft).waitFor({ state: 'visible' });
      await waitForAutomaticProjectCheckViaUi(page, currentProject.project_id, null);
      await waitForComposerDraftDecisionViaUi(page);
    } else {
      await page.locator(SELECTORS.saveVersion).waitFor({ state: 'hidden' });
    }
    const evidence = await readSanitizedBridgeEvidence(page, currentProject.project_id);
    assertExactRevision(evidence, currentProject);
    const taskStream = options.pending_candidate === true
      ? assertTaskStreamPendingExplanationFacts(
        evidence,
        currentProject,
        expectedCandidateTurns,
        expectedQuestionTurns,
        options.task_stream_options,
      )
      : assertTaskStreamExplanationFacts(
        evidence,
        currentProject,
        expectedCandidateTurns,
        expectedQuestionTurns,
        options.task_stream_options,
      );
    return Object.freeze({
      answer_failure_notice_absent: true,
      current_project_context_verified: expectedAnswerText !== null,
      pending_candidate_preserved: options.pending_candidate === true,
      saved_revision_unchanged: true,
      task_stream: taskStream,
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
  expectedCandidateTurns = currentProject.revision_number + 1,
  taskStreamOptions = {},
) {
  let draftReviewDiff = null;
  let checkRun = null;
  let liveOutput = null;
  let step = 'start';
  let evidenceStep = 'start';
  try {
    step = 'wait_ready';
    traceCanaryStage('create_update.wait_ready.start', { expected_candidate_turns: expectedCandidateTurns });
    await waitForComposerReadyToSend(page);
    traceCanaryStage('create_update.wait_ready.done');
    step = 'fill_instruction';
    traceCanaryStage('create_update.fill_instruction.start');
    await page.locator(SELECTORS.idea).fill(instruction);
    traceCanaryStage('create_update.fill_instruction.done');
    step = 'wait_route';
    traceCanaryStage('create_update.wait_route.start');
    await waitForComposerRoute(page, 'build', 'build');
    traceCanaryStage('create_update.wait_route.done');
    if (typeof page.waitForTimeout === 'function') {
      await page.waitForTimeout(250);
    } else {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    step = 'submit_instruction';
    traceCanaryStage('create_update.submit_instruction.start');
    await page.locator(SELECTORS.submitTurn).click();
    traceCanaryStage('create_update.submit_instruction.done');
    step = 'approve_write';
    traceCanaryStage('create_update.approve_write.start');
    await approveCurrentProjectWriteIfRequested(page);
    traceCanaryStage('create_update.approve_write.done');
    step = 'capture_live_output';
    traceCanaryStage('create_update.capture_live_output.start');
    liveOutput = await captureGenerationLiveOutputOrDraftReadyViaUi(page, 'canary_update_generation_terminal_failed');
    traceCanaryStage('create_update.capture_live_output.done', liveOutput);
    step = 'wait_terminal';
    traceCanaryStage('create_update.wait_terminal.start');
    await waitForGenerationTerminal(page, currentProject.project_id, userDataRoot);
    traceCanaryStage('create_update.wait_terminal.done');
  } catch {
    await failWithDiagnostic(
      'canary_update_generation_terminal_failed',
      await collectUpdateGenerationFailureDiagnostic(page, step, currentProject.project_id, userDataRoot, fsModule),
    );
  }
  try {
    evidenceStep = 'wait_unsaved_draft';
    await page.locator(SELECTORS.unsavedDraft)
      .getByText('Unsaved draft', { exact: true })
      .waitFor({ state: 'visible' });
    evidenceStep = 'wait_automatic_check';
    checkRun = await waitForAutomaticProjectCheckViaUi(
      page,
      currentProject.project_id,
      userDataRoot,
    );
    evidenceStep = 'inspect_review_diff';
    draftReviewDiff = await inspectDraftReviewDiffViaUi(page);
    evidenceStep = 'wait_checkpoint_actions';
    await currentUndoDraftLocator(page).waitFor({ state: 'visible' });
    await waitForComposerDraftDecisionViaUi(page);
    let preSave = null;
    evidenceStep = 'read_task_stream';
    for (let attempt = 0; attempt < 30; attempt += 1) {
      try {
        preSave = await readSanitizedBridgeEvidence(
          page,
          currentProject.project_id,
          'canary_read_evidence_pending_update_failed',
        );
        assertExactRevision(preSave, currentProject);
        assertTaskStreamPendingCandidateFacts(
          preSave,
          currentProject,
          expectedCandidateTurns,
          expectedQuestionTurns,
          taskStreamOptions,
        );
        break;
      } catch (error) {
        if (attempt < 29) {
          if (typeof page.waitForTimeout === 'function') await page.waitForTimeout(100);
          else await new Promise((resolve) => setTimeout(resolve, 100));
          continue;
        }
        if (expectedCandidateTurns === currentProject.revision_number + 1) throw error;
        failWithDiagnostic('canary_checkpoint_undo_failed', Object.freeze({
          diagnostic_version: 'builder-canary-checkpoint-continuation-diagnostic.v1',
          expected_candidate_turns: expectedCandidateTurns,
          generation_debug: optionalCanaryGenerationDebug(userDataRoot, fsModule),
          task_stream: taskStreamCheckpointDiagnostic(preSave, 'checkpoint_continuation'),
        }));
      }
    }
  } catch (error) {
    if (
      expectedCandidateTurns > currentProject.revision_number + 1
      && error instanceof BuilderPackagedCanaryError
      && error.code === 'canary_evidence_failed'
    ) {
      failWithDiagnostic('canary_checkpoint_undo_failed', Object.freeze({
        diagnostic_version: 'builder-canary-checkpoint-continuation-diagnostic.v1',
        evidence_step: evidenceStep,
        expected_candidate_turns: expectedCandidateTurns,
        generation_debug: optionalCanaryGenerationDebug(userDataRoot, fsModule),
      }));
    }
    if (error instanceof BuilderPackagedCanaryError) throw error;
    failWithDiagnostic('canary_update_draft_failed', Object.freeze({
      diagnostic_version: 'builder-canary-update-draft-diagnostic.v1',
      evidence_step: evidenceStep,
      error_message: error instanceof Error ? error.message : String(error),
      generation_debug: optionalCanaryGenerationDebug(userDataRoot, fsModule),
      project_status: await optionalLocatorAttribute(
        page,
        SELECTORS.projectPage,
        'data-builder-project-status',
      ),
      save_visible: await optionalLocatorVisible(page, SELECTORS.saveVersion),
      task_stream_read: await optionalTaskStreamFailureSummary(page, currentProject.project_id),
      unsaved_draft_visible: await optionalLocatorVisible(page, SELECTORS.unsavedDraft),
    }));
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
    await page.locator(SELECTORS.planMarkdown).waitFor({ state: 'visible' });
    await page.locator(`${SELECTORS.planMarkdown} h2`).waitFor({ state: 'visible' });
    if (await page.locator(`${SELECTORS.planMarkdown} ol > li`).count() < 1) {
      fail('canary_plan_markdown_steps_missing');
    }
    await page.locator(SELECTORS.completionSummary).waitFor({ state: 'hidden' });
    await page.locator(SELECTORS.approvePlan).waitFor({ state: 'visible' });
    await expectComposerStatus(page, 'Needs confirmation');
    await page.locator(SELECTORS.saveVersion).waitFor({ state: 'hidden' });
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError) throw error;
    fail('canary_plan_failed');
  }

  try {
    await page.locator(SELECTORS.runHistory).last().waitFor({ state: 'hidden' });
    await page.locator(SELECTORS.workspaceMenuButton).click();
    await page.locator(SELECTORS.workspaceControlLogs).waitFor({ state: 'hidden' });
    await page.locator(SELECTORS.workspaceMenuButton).click();
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
      plan_markdown_visible: true,
      plan_review_actions_visible: true,
      saved_revision_unchanged: true,
      task_stream: assertTaskStreamPlanFacts(
        evidence,
        currentProject,
        expectedCandidateTurns,
        expectedQuestionTurns,
        expectedPlanTurns,
      ),
      logs_workspace_control_hidden: true,
      targetless_tool_lifecycle_hidden_after_completion: true,
    });
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError) throw error;
    fail('canary_plan_evidence_failed');
  }
}

async function readComposerStatus(page) {
  return safeDiagnosticText(await optionalLocatorText(page, SELECTORS.composerStatus));
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

async function expectComposerStatusHidden(page) {
  try {
    await page.locator(SELECTORS.composerStatus).waitFor({ state: 'hidden' });
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
    await currentUndoDraftLocator(page).waitFor({ state: 'visible' });
    await waitForAutomaticProjectCheckViaUi(page, currentProject.project_id, userDataRoot);
    await waitForComposerDraftDecisionViaUi(page);
    await expectComposerStatusHidden(page);
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
  await captureSavedActivityEvidence(page, currentProject.revision_number + 1);
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
  let stage = 'header_status';
  try {
    await page.locator(SELECTORS.currentVersion).waitFor({ state: 'hidden' });
    stage = 'open_history';
    await openVersionHistoryViaUi(page);
    stage = 'wait_version';
    const version = page.locator(`[data-builder-version-card="Version ${revisionNumber}"]`);
    await version.waitFor({ state: 'visible' });
    stage = 'read_version';
    if (!(await version.textContent())?.includes(`Version ${revisionNumber}`)) {
      fail('canary_version_failed');
    }
    stage = 'close_history';
    await closeArtifactSidebarViaUi(page);
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError) throw error;
    failWithDiagnostic('canary_version_failed', Object.freeze({
      diagnostic_version: 'builder-canary-version-visibility-diagnostic.v1',
      stage,
      artifact_sidebar_visible: await optionalLocatorVisible(page, SELECTORS.artifactSidebar),
      version_history_visible: await optionalLocatorVisible(page, SELECTORS.versionHistory),
      version_card_count: await optionalLocatorCount(
        page,
        `[data-builder-version-card="Version ${revisionNumber}"]`,
      ),
      workspace_menu_button_visible: await optionalLocatorVisible(page, SELECTORS.workspaceMenuButton),
      workspace_menu_visible: await optionalLocatorVisible(page, SELECTORS.workspaceMenu),
      workspace_versions_count: await optionalLocatorCount(page, SELECTORS.workspaceControlVersions),
      workspace_versions_visible: await optionalLocatorVisible(page, SELECTORS.workspaceControlVersions),
      project_status: await optionalLocatorAttribute(
        page,
        SELECTORS.projectPage,
        'data-builder-project-status',
      ),
      project_error: await optionalLocatorAttribute(
        page,
        SELECTORS.projectPage,
        'data-builder-project-error',
      ),
      unsaved_draft_count: await optionalLocatorCount(page, SELECTORS.unsavedDraft),
      unsaved_draft_visible: await optionalLocatorVisible(page, SELECTORS.unsavedDraft),
      save_version_visible: await optionalLocatorVisible(page, SELECTORS.saveVersion),
      visible_buttons: await readVisibleButtonTexts(page),
      bridge: await readOptionalDraftBridgeEvidence(page),
    }));
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
  try {
    await page.locator(SELECTORS.artifactTabVersions).click({ timeout: 1000 });
    await page.locator(SELECTORS.versionHistory).waitFor({ state: 'visible', timeout: 3000 });
    return;
  } catch {
    // A closed workspace has no mounted tab strip; use its public menu instead.
  }
  await page.locator(SELECTORS.workspaceMenuButton).click({ timeout: 3000 });
  await page.locator(SELECTORS.workspaceMenu).waitFor({ state: 'visible', timeout: 3000 });
  await page.locator(SELECTORS.workspaceControlVersions).waitFor({
    state: 'visible',
    timeout: 15_000,
  });
  await page.locator(SELECTORS.workspaceControlVersions).click({ timeout: 3000 });
  await page.locator(SELECTORS.artifactSidebar).waitFor({ state: 'visible', timeout: 10_000 });
  await page.locator(SELECTORS.versionHistory).waitFor({ state: 'visible', timeout: 10_000 });
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

async function assertRestoredConversationSettledViaUi(page) {
  const activity = page.locator(SELECTORS.conversationActivity);
  await activity.waitFor({ state: 'visible', timeout: CANARY_PROJECT_READY_TIMEOUT_MS });
  let status = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    status = await activity.getAttribute('data-builder-activity-status');
    if (status !== null && status !== 'loading' && status !== 'refreshing') {
      return Object.freeze({
        activity_status: status,
        loading_activity_settled: true,
        stable_shell_retained_during_restore: true,
      });
    }
    if (typeof page.waitForTimeout === 'function') await page.waitForTimeout(100);
  }
  failWithDiagnostic('canary_restart_evidence_failed', Object.freeze({
    diagnostic_version: 'builder-canary-conversation-restore-diagnostic.v1',
    activity_status: status,
    activity_text: await optionalLocatorText(page, SELECTORS.conversationActivity),
  }));
}

async function readPendingUpdateDraftRestoreEvidence(
  page,
  currentProject,
  expectedCandidateTurns,
  expectedQuestionTurns = 0,
  taskStreamOptions = {},
) {
  try {
    await page.locator(SELECTORS.unsavedDraft)
      .getByText('Unsaved draft', { exact: true })
      .waitFor({ state: 'visible' });
    await currentUndoDraftLocator(page).waitFor({ state: 'visible' });
    await waitForAutomaticProjectCheckViaUi(page, currentProject.project_id, null);
    await waitForComposerDraftDecisionViaUi(page);
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
        taskStreamOptions,
      ),
      ui: Object.freeze({
        formal_version_save_is_secondary: true,
        review_diff: reviewDiff,
        saved_revision_visible: true,
        undo_draft_directly_visible: true,
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

async function undoDraftToCheckpointViaUi(
  page,
  currentProject,
  expectedCandidateTurns,
  expectedPreview,
  userDataRoot,
  gate,
  taskStreamOptions = {},
) {
  traceCanaryStage('checkpoint_undo.click.start', {
    expected_candidate_turns: expectedCandidateTurns,
  });
  try {
    await currentUndoDraftLocator(page).click();
    traceCanaryStage('checkpoint_undo.click.done');
  } catch (error) {
    failWithDiagnostic('canary_checkpoint_undo_failed', Object.freeze({
      diagnostic_version: 'builder-canary-checkpoint-undo-click-diagnostic.v1',
      expected_candidate_turns: expectedCandidateTurns,
      thrown_name: error instanceof Error ? error.name : null,
      thrown_message: error instanceof Error ? safeDiagnosticText(error.message) : null,
      project_status: await optionalLocatorAttribute(
        page,
        SELECTORS.projectPage,
        'data-builder-project-status',
      ),
      project_error: await optionalLocatorAttribute(
        page,
        SELECTORS.projectPage,
        'data-builder-project-error',
      ),
      unsaved_draft_visible: await optionalLocatorVisible(page, SELECTORS.unsavedDraft),
      composer_decision_visible: await optionalLocatorVisible(page, SELECTORS.composerVersionDecision),
      undo_controls: await optionalUndoDraftUiDiagnostic(page),
      recent_activity: await optionalRecentActivitySummary(page),
      task_stream_read: await optionalTaskStreamFailureSummary(page, currentProject.project_id),
      generation_debug: optionalCanaryGenerationDebug(userDataRoot),
    }));
  }

  let evidence = null;
  let taskStream = null;
  let settledMismatchCount = 0;
  for (let attempt = 0; attempt < 1_200; attempt += 1) {
    try {
      evidence = await readSanitizedBridgeEvidence(page, currentProject.project_id);
      assertExactRevision(evidence, currentProject);
      taskStream = assertTaskStreamPendingCandidateFacts(
        evidence,
        currentProject,
        expectedCandidateTurns,
        0,
        taskStreamOptions,
      );
      break;
    } catch {
      taskStream = null;
      const conversation = evidence?.task_stream?.conversation ?? null;
      if (conversation !== null && conversation.recorded_active_turn_id === null) {
        settledMismatchCount += 1;
        if (settledMismatchCount >= 20) break;
      } else {
        settledMismatchCount = 0;
      }
    }
    if (typeof page.waitForTimeout === 'function') await page.waitForTimeout(100);
    else await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (evidence === null || taskStream === null) {
    failWithDiagnostic('canary_checkpoint_undo_failed', Object.freeze({
      diagnostic_version: 'builder-canary-checkpoint-undo-diagnostic.v1',
      expected_candidate_turns: expectedCandidateTurns,
      generation_debug: optionalCanaryGenerationDebug(userDataRoot),
      project_status: await optionalLocatorAttribute(
        page,
        SELECTORS.projectPage,
        'data-builder-project-status',
      ),
      conversation_status: await optionalLocatorAttribute(
        page,
        SELECTORS.projectPage,
        'data-builder-conversation-status',
      ),
      conversation_notice: await optionalLocatorText(page, '[data-builder-conversation-notice]'),
      recent_activity: await optionalRecentActivitySummary(page),
      task_stream_read: await optionalTaskStreamFailureSummary(page, currentProject.project_id),
      task_stream: taskStreamCheckpointDiagnostic(evidence, 'checkpoint_undo'),
    }));
  }

  try {
    await page.locator(SELECTORS.unsavedDraft)
      .getByText('Unsaved draft', { exact: true })
      .waitFor({ state: 'visible' });
    await currentUndoDraftLocator(page).waitFor({ state: 'visible' });
    await assertVisibleVersion(page, currentProject.revision_number);
    const automaticCheck = await waitForAutomaticProjectCheckViaUi(
      page,
      currentProject.project_id,
      userDataRoot,
    );
    await waitForComposerDraftDecisionViaUi(page);
    const preview = await capturePreviewEvidence(page, gate);
    if (!samePreviewEvidence(preview, expectedPreview)) {
      failWithDiagnostic(
        'canary_checkpoint_undo_failed',
        previewComparisonDiagnostic('checkpoint_undo_target', expectedPreview, preview),
      );
    }
    return Object.freeze({
      automatic_check: automaticCheck,
      formal_revision_unchanged: true,
      preview,
      preview_matches_target_checkpoint: true,
      task_stream: taskStream,
      undo_draft_directly_visible: true,
      restored_draft_decision_visible: true,
    });
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError) throw error;
    fail('canary_checkpoint_undo_failed');
  }
}

async function readOnlyBridgeEvidence(page, projectId = null, code = 'canary_read_evidence_failed') {
  try {
    return await page.evaluate(async (request) => {
      const bridge = globalThis.clawfabricBuilder;
      const agentProjectTree = bridge.agentProjectTree;
      const agentProjectTreeDescriptors = agentProjectTree !== null
        && (typeof agentProjectTree === 'object' || typeof agentProjectTree === 'function')
        ? Object.getOwnPropertyDescriptors(agentProjectTree)
        : null;
      const agentProjectTreeKeys = agentProjectTreeDescriptors === null
        ? []
        : Reflect.ownKeys(agentProjectTreeDescriptors);
      const agentProjectTreeMethodNames = [
        'read',
        'renameProject',
        'archiveProject',
        'renameTask',
        'archiveTask',
      ];
      const agentProjectTreeMethodsAreExact =
        agentProjectTreeKeys.length === agentProjectTreeMethodNames.length
        && agentProjectTreeMethodNames.every((name, index) => {
          const descriptor = agentProjectTreeDescriptors[name];
          return agentProjectTreeKeys[index] === name
            && descriptor !== undefined
            && descriptor.enumerable === true
            && Object.hasOwn(descriptor, 'value')
            && typeof descriptor.value === 'function';
        });
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
        'diagnoseCurrentDraftCheckEnvironment',
        'diagnoseProjectEnvironment',
        'approveAndRunCurrentDraftCheck',
        'decideCurrentDraftDependencyPreparation',
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
        'updateCurrentPreviewLayout',
        'decideDevServerApproval',
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
        'readRuntimeToolFileTree',
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
        agent_project_tree_namespace: agentProjectTreeMethodsAreExact
          ? 'read_and_lifecycle_methods_only'
          : 'unavailable',
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
      let task_stream = null;
      if (request.projectId !== null) {
        const tree = await bridge.agentProjectTree.read({ agent_id: request.agentId });
        const project = tree?.projects?.find((candidate) => candidate?.project_id === request.projectId);
        const projectTasks = Array.isArray(project?.tasks) ? project.tasks : [];
        const orphanedTasks = Array.isArray(tree?.orphaned_tasks)
          ? tree.orphaned_tasks.filter((task) => task?.project_id === request.projectId)
          : [];
        const projectedTaskAddressId = [...projectTasks, ...orphanedTasks]
          .filter((task) => typeof task?.task_address_id === 'string')
          .sort((left, right) => (
            (Number.isSafeInteger(right?.latest_activity_at_ms) ? right.latest_activity_at_ms : 0)
            - (Number.isSafeInteger(left?.latest_activity_at_ms) ? left.latest_activity_at_ms : 0)
          ))[0]?.task_address_id;
        const projectLink = globalThis.document.querySelector(
          `[data-builder-project-id="${request.projectId}"]`,
        );
        const visibleTaskAddressId = projectLink?.closest('li')
          ?.querySelector('[data-builder-task-address-id]')
          ?.getAttribute('data-builder-task-address-id');
        const taskAddressId = typeof projectedTaskAddressId === 'string'
          ? projectedTaskAddressId
          : visibleTaskAddressId;
        if (typeof taskAddressId !== 'string') throw new Error('task address unavailable');
        task_stream = await bridge.taskStream.read({
          project_id: request.projectId,
          task_address_id: taskAddressId,
        });
      }
      return { bridge_contract, catalog, current, status, task_stream };
    }, { agentId: DEFAULT_BUILDER_AGENT_ID, projectId });
  } catch {
    failWithDiagnostic(code, await readOnlyBridgeFailureDiagnostic(page, projectId));
  }
}

async function readOnlyBridgeFailureDiagnostic(page, projectId) {
  try {
    return await page.evaluate(async (request) => {
      const bridge = globalThis.clawfabricBuilder;
      const calls = [
        ['provider_settings_status', () => bridge.providerSettings.status()],
        ['project_workspace_list', () => bridge.projectWorkspace.listCurrent()],
        ...(request.projectId === null ? [] : [
          ['project_workspace_load', () => bridge.projectWorkspace.loadCurrent({
            project_id: request.projectId,
          })],
          ['task_stream_read', async () => {
            const tree = await bridge.agentProjectTree.read({ agent_id: request.agentId });
            const project = tree?.projects?.find((candidate) => candidate?.project_id === request.projectId);
            const projectTasks = Array.isArray(project?.tasks) ? project.tasks : [];
            const orphanedTasks = Array.isArray(tree?.orphaned_tasks)
              ? tree.orphaned_tasks.filter((task) => task?.project_id === request.projectId)
              : [];
            const taskAddressId = [...projectTasks, ...orphanedTasks]
              .filter((task) => typeof task?.task_address_id === 'string')
              .sort((left, right) => (
                (Number.isSafeInteger(right?.latest_activity_at_ms) ? right.latest_activity_at_ms : 0)
                - (Number.isSafeInteger(left?.latest_activity_at_ms) ? left.latest_activity_at_ms : 0)
              ))[0]?.task_address_id;
            if (typeof taskAddressId !== 'string') throw new Error('task address unavailable');
            return bridge.taskStream.read({
              project_id: request.projectId,
              task_address_id: taskAddressId,
            });
          }],
        ]),
      ];
      for (const [stage, call] of calls) {
        try {
          await call();
        } catch (error) {
          return {
            diagnostic_version: 'builder-canary-read-evidence-failure.v1',
            failed_stage: stage,
            error_code: typeof error?.code === 'string' ? error.code : null,
            error_name: typeof error?.name === 'string' ? error.name : null,
          };
        }
      }
      return {
        diagnostic_version: 'builder-canary-read-evidence-failure.v1',
        failed_stage: 'evidence_assembly',
        error_code: null,
        error_name: null,
      };
    }, { agentId: DEFAULT_BUILDER_AGENT_ID, projectId });
  } catch {
    return Object.freeze({
      diagnostic_version: 'builder-canary-read-evidence-failure.v1',
      failed_stage: 'diagnostic_unavailable',
      error_code: null,
      error_name: null,
    });
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

async function readSanitizedTaskStreamEvidence(
  page,
  projectId,
  code = 'canary_read_evidence_failed',
) {
  try {
    const probe = await page.evaluate(async (request) => {
      let tree;
      try {
        tree = await globalThis.clawfabricBuilder.agentProjectTree.read({
          agent_id: request.agentId,
        });
      } catch {
        return { ok: false, phase: 'project_tree' };
      }
      const project = tree?.projects?.find((candidate) => candidate?.project_id === request.projectId);
      const projectTasks = Array.isArray(project?.tasks) ? project.tasks : [];
      const orphanedTasks = Array.isArray(tree?.orphaned_tasks)
        ? tree.orphaned_tasks.filter((task) => task?.project_id === request.projectId)
        : [];
      const projectedTaskAddressId = [...projectTasks, ...orphanedTasks]
        .filter((task) => typeof task?.task_address_id === 'string')
        .sort((left, right) => (
          (Number.isSafeInteger(right?.latest_activity_at_ms) ? right.latest_activity_at_ms : 0)
          - (Number.isSafeInteger(left?.latest_activity_at_ms) ? left.latest_activity_at_ms : 0)
        ))[0]?.task_address_id;
      const projectLink = globalThis.document.querySelector(
        `[data-builder-project-id="${request.projectId}"]`,
      );
      const visibleTaskAddressId = projectLink?.closest('li')
        ?.querySelector('[data-builder-task-address-id]')
        ?.getAttribute('data-builder-task-address-id');
      const taskAddressId = typeof projectedTaskAddressId === 'string'
        ? projectedTaskAddressId
        : visibleTaskAddressId;
      if (typeof taskAddressId !== 'string') return { ok: false, phase: 'task_address' };
      try {
        return {
          ok: true,
          task_stream: await globalThis.clawfabricBuilder.taskStream.read({
            project_id: request.projectId,
            task_address_id: taskAddressId,
          }),
        };
      } catch {
        return { ok: false, phase: 'task_stream' };
      }
    }, { agentId: DEFAULT_BUILDER_AGENT_ID, projectId });
    if (
      probe === null
      || typeof probe !== 'object'
      || probe.ok !== true
      || !Object.hasOwn(probe, 'task_stream')
    ) {
      const phase = probe !== null
        && typeof probe === 'object'
        && ['project_tree', 'task_address', 'task_stream'].includes(probe.phase)
        ? probe.phase
        : 'probe';
      failWithDiagnostic(code, Object.freeze({ phase }));
    }
    try {
      return sanitizeTaskStream(probe.task_stream, projectId);
    } catch (error) {
      failWithDiagnostic(code, Object.freeze({
        phase: 'sanitize',
        sanitizer_code: error instanceof BuilderPackagedCanaryError
          ? error.code
          : 'canary_read_evidence_failed',
      }));
    }
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError) throw error;
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
      const componentCode = readEvidenceComponentCode(code, component);
      if (error.diagnostic !== undefined) {
        failWithDiagnostic(componentCode, error.diagnostic);
      }
      fail(componentCode);
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
    bridgeContractDescriptors.bridge_version.value !== 'builder-preload.v36'
    || bridgeContractDescriptors.legacy_namespaces_absent.value !== true
    || bridgeContractDescriptors.agent_project_tree_namespace.value
      !== 'read_and_lifecycle_methods_only'
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
    bridge_version: 'builder-preload.v36',
    legacy_namespaces_absent: true,
    agent_project_tree_namespace: 'read_and_lifecycle_methods_only',
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

function sanitizeTaskStreamPhase(validationPhase, callback) {
  try {
    return callback();
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError && error.diagnostic !== undefined) {
      throw error;
    }
    failWithDiagnostic('canary_evidence_failed', Object.freeze({
      validation_phase: validationPhase,
    }));
  }
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
    : sanitizeTaskStreamPhase(
      'conversation',
      () => sanitizeTaskStreamConversation(descriptors.conversation.value, projectId),
    );
  const checkRunOutcomeProjection = Object.hasOwn(descriptors, 'check_run_outcome_projection')
    ? descriptors.check_run_outcome_projection.value === null
      ? null
      : sanitizeTaskStreamPhase(
        'check_run_outcome_projection',
        () => sanitizeBuilderCheckRunOutcomeProjection(
          descriptors.check_run_outcome_projection.value,
        ),
      )
    : undefined;
  const agentActivityProjection = Object.hasOwn(descriptors, 'agent_activity_projection')
    ? descriptors.agent_activity_projection.value === null
      ? null
      : sanitizeTaskStreamPhase(
        'agent_activity_projection',
        () => sanitizeBuilderAgentActivityProjection(descriptors.agent_activity_projection.value),
      )
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
      : sanitizeTaskStreamPhase(
        'review_state_projection',
        () => sanitizeBuilderReviewStateProjection(descriptors.review_state_projection.value),
      )
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
    ...(Object.hasOwn(descriptors, 'draft_checkpoint_timeline_projection')
      ? {
        draft_checkpoint_timeline_projection:
          descriptors.draft_checkpoint_timeline_projection.value === null
            ? null
            : sanitizeBuilderDraftCheckpointTimelineProjection(
              descriptors.draft_checkpoint_timeline_projection.value,
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
  const descriptors = exactDataObjectWithOptional(
    value,
    TASK_STREAM_CANDIDATE_KEYS,
    TASK_STREAM_CANDIDATE_OPTIONAL_KEYS,
  );
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
    ...(descriptors.workspace_materialization === undefined
      ? {}
      : {
        workspace_materialization: sanitizeTaskStreamWorkspaceMaterialization(
          descriptors.workspace_materialization.value,
        ),
      }),
  });
}

function sanitizeTaskStreamWorkspaceMaterialization(value) {
  const status = value?.status;
  if (status === 'materialized' || status === 'not_recorded') {
    exactDataObject(value, TASK_STREAM_WORKSPACE_MATERIALIZATION_KEYS);
    return Object.freeze({ status });
  }
  if (status === 'not_materialized' || status === 'not_attempted') {
    const descriptors = exactDataObject(
      value,
      TASK_STREAM_WORKSPACE_MATERIALIZATION_WITH_DETAIL_KEYS,
    );
    return Object.freeze({
      status,
      label_digest: digestText(evidenceText(descriptors.label.value, 120, 512)),
      detail_digest: digestText(evidenceText(descriptors.detail.value, 360, 1_536)),
    });
  }
  fail('canary_evidence_failed');
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

function sanitizeTaskStreamAgentStepResult(value) {
  const descriptors = exactDataObject(value, TASK_STREAM_AGENT_STEP_RESULT_KEYS);
  const status = descriptors.status.value;
  const summaryCode = descriptors.summary_code.value;
  if (
    !Object.hasOwn(TASK_STREAM_AGENT_STEP_RESULT_CODE_BY_STATUS, status)
    || TASK_STREAM_AGENT_STEP_RESULT_CODE_BY_STATUS[status] !== summaryCode
    || TASK_STREAM_AGENT_STEP_RESULT_SUMMARY_BY_CODE[summaryCode]
      !== descriptors.display_summary.value
  ) fail('canary_evidence_failed');
  return Object.freeze({
    status,
    summary_code: summaryCode,
    display_summary: TASK_STREAM_AGENT_STEP_RESULT_SUMMARY_BY_CODE[summaryCode],
  });
}

function sanitizeTaskStreamAgentStepSummary(value, result) {
  const descriptors = exactDataObject(value, TASK_STREAM_AGENT_STEP_SUMMARY_KEYS);
  if (result === null) {
    if (
      descriptors.status.value !== 'started'
      || descriptors.display_summary.value !== 'Agent step start was recorded.'
    ) fail('canary_evidence_failed');
    return Object.freeze({
      status: 'started',
      display_summary: 'Agent step start was recorded.',
    });
  }
  if (
    descriptors.status.value !== result.status
    || descriptors.display_summary.value !== result.display_summary
  ) fail('canary_evidence_failed');
  return Object.freeze({
    status: result.status,
    display_summary: result.display_summary,
  });
}

function sanitizeTaskStreamAgentStepLifecycle(value) {
  const descriptors = exactDataObject(value, TASK_STREAM_AGENT_STEP_LIFECYCLE_KEYS);
  if (
    descriptors.conversation_admission.value !== 'verified_public_progress'
    || descriptors.raw_output_admission.value !== 'not_included'
    || descriptors.revision_admission.value !== 'not_created'
  ) fail('canary_evidence_failed');
  return Object.freeze({
    conversation_admission: 'verified_public_progress',
    raw_output_admission: 'not_included',
    revision_admission: 'not_created',
  });
}

function sanitizeTaskStreamAgentStepProgress(source, sequence) {
  const recordedState = source.recorded_state;
  if (recordedState !== 'start_recorded' && recordedState !== 'result_recorded') {
    fail('canary_evidence_failed');
  }
  const result = source.result === null
    ? null
    : sanitizeTaskStreamAgentStepResult(source.result);
  if ((recordedState === 'start_recorded') !== (result === null)) {
    fail('canary_evidence_failed');
  }
  const stepIndex = safePositiveInteger(source.step_index);
  if (stepIndex > 256) fail('canary_evidence_failed');
  return Object.freeze({
    item_kind: 'agent_step_progress_recorded',
    sequence,
    turn_id: safeBuilderId(source.turn_id, 'turn_id'),
    run_id: safeBuilderId(source.run_id, 'run_id'),
    task_id: safeBuilderId(source.task_id, 'task_id'),
    step_id: safeBuilderId(source.step_id, 'run_step_id'),
    step_index: stepIndex,
    recorded_state: recordedState,
    result,
    summary: sanitizeTaskStreamAgentStepSummary(source.summary, result),
    lifecycle: sanitizeTaskStreamAgentStepLifecycle(source.lifecycle),
  });
}

function safeRuntimeRef(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) fail('canary_evidence_failed');
  return value;
}

function safeRuntimeDuration(value) {
  const duration = safeNonNegativeInteger(value);
  if (duration > 60 * 60 * 1_000) fail('canary_evidence_failed');
  return duration;
}

function sanitizeTaskStreamProgrammingRuntimeFileChange(value) {
  if (value === null) return null;
  const descriptors = exactDataObject(
    value,
    TASK_STREAM_PROGRAMMING_RUNTIME_FILE_CHANGE_KEYS,
  );
  const changeKind = descriptors.change_kind.value;
  const addedLines = safeNonNegativeInteger(descriptors.added_lines.value);
  const deletedLines = safeNonNegativeInteger(descriptors.deleted_lines.value);
  if (
    !['added', 'edited', 'deleted'].includes(changeKind)
    || addedLines > 1_000_000
    || deletedLines > 1_000_000
  ) fail('canary_evidence_failed');
  return Object.freeze({
    change_ref: safeRuntimeRef(descriptors.change_ref.value, RUNTIME_CHANGE_REF_PATTERN),
    change_kind: changeKind,
    added_lines: addedLines,
    deleted_lines: deletedLines,
  });
}

function sanitizeTaskStreamProgrammingRuntimeCheckResult(value) {
  if (value === null) return null;
  const descriptors = exactDataObject(
    value,
    TASK_STREAM_PROGRAMMING_RUNTIME_CHECK_RESULT_KEYS,
  );
  const status = descriptors.status.value;
  if (!['passed', 'failed', 'incomplete', 'not_run'].includes(status)) fail('canary_evidence_failed');
  return Object.freeze({
    command_ref: safeRuntimeRef(descriptors.command_ref.value, RUNTIME_COMMAND_REF_PATTERN),
    status,
    duration_ms: safeRuntimeDuration(descriptors.duration_ms.value),
    summary_digest: digestText(evidenceText(descriptors.summary.value, 360, 1_440)),
  });
}

function sanitizeTaskStreamProgrammingRuntimeToolPresentationDetail(value) {
  if (value === null) return null;
  if (value === null || typeof value !== 'object' || Array.isArray(value) || isObjectProxy(value)) {
    fail('canary_evidence_failed');
  }
  const kind = Object.getOwnPropertyDescriptor(value, 'detail_kind')?.value;
  if (kind === 'read') {
    const source = exactDataObject(value, [
      'detail_kind', 'path', 'offset', 'returned_lines', 'total_lines', 'first_line', 'last_line', 'language_hint',
    ]);
    evidenceText(source.path.value, 240, 960);
    const offset = safePositiveInteger(source.offset.value);
    const returnedLines = safeNonNegativeInteger(source.returned_lines.value);
    const totalLines = safeNonNegativeInteger(source.total_lines.value);
    const firstLine = source.first_line.value === null ? null : safePositiveInteger(source.first_line.value);
    const lastLine = source.last_line.value === null ? null : safePositiveInteger(source.last_line.value);
    if (
      offset > 1_000_000 || returnedLines > 1_000_000 || totalLines > 1_000_000
      || firstLine !== null && firstLine > 1_000_000
      || lastLine !== null && lastLine > 1_000_000
      || (firstLine === null) !== (lastLine === null)
      || firstLine !== null && lastLine < firstLine
      || source.language_hint.value !== null
        && evidenceText(source.language_hint.value, 32, 128).length === 0
    ) fail('canary_evidence_failed');
    return kind;
  }
  if (kind === 'search') {
    const source = exactDataObject(value, ['detail_kind', 'matches', 'truncated', 'total']);
    if (
      !Array.isArray(source.matches.value)
      || source.matches.value.length > 100
      || typeof source.truncated.value !== 'boolean'
    ) {
      fail('canary_evidence_failed');
    }
    const total = safeNonNegativeInteger(source.total.value);
    if (total > 1_000_000) fail('canary_evidence_failed');
    for (const valueMatch of source.matches.value) {
      const match = exactDataObject(valueMatch, ['path', 'line', 'column']);
      evidenceText(match.path.value, 240, 960);
      if (
        safeNonNegativeInteger(match.line.value) > 1_000_000
        || safeNonNegativeInteger(match.column.value) > 1_000_000
      ) fail('canary_evidence_failed');
    }
    return kind;
  }
  if (kind === 'diff') {
    const source = exactDataObject(value, ['detail_kind', 'path', 'added_lines', 'deleted_lines']);
    evidenceText(source.path.value, 240, 960);
    if (
      safeNonNegativeInteger(source.added_lines.value) > 1_000_000
      || safeNonNegativeInteger(source.deleted_lines.value) > 1_000_000
    ) fail('canary_evidence_failed');
    return kind;
  }
  if (kind === 'command') {
    const source = exactDataObject(value, [
      'detail_kind', 'status', 'command', 'exit_code', 'duration_ms', 'truncated',
    ]);
    const status = source.status.value;
    const exitCode = source.exit_code.value === null
      ? null
      : safeNonNegativeInteger(source.exit_code.value);
    if (
      ![
        'passed', 'failed', 'timed_out', 'cancelled', 'output_exceeded',
        'spawn_failed', 'termination_failed',
      ].includes(status)
      || evidenceText(source.command.value, 160, 640).length === 0
      || exitCode !== null && exitCode > 255
      || safeRuntimeDuration(source.duration_ms.value) > 60 * 60 * 1_000
      || typeof source.truncated.value !== 'boolean'
      || status === 'passed' && exitCode !== 0
      || status === 'failed' && (exitCode === null || exitCode === 0)
      || !['passed', 'failed'].includes(status) && exitCode !== null
    ) failWithDiagnostic('canary_evidence_failed', Object.freeze({
      validation_phase: 'programming_runtime_command_detail',
    }));
    return kind;
  }
  fail('canary_evidence_failed');
}

function sanitizeTaskStreamProgrammingRuntimeToolActivity(source, sequence) {
  const toolKind = source.tool_kind;
  const state = source.state;
  const presentation = source.presentation;
  const failureClass = source.failure_class;
  if (
    !['read', 'search', 'edit', 'write', 'command'].includes(toolKind)
    || !['running', 'completed', 'failed'].includes(state)
    || !['file', 'changes', 'terminal', 'search'].includes(presentation)
    || (failureClass !== null && ![
      'denied',
      'invalid_input',
      'stale_file',
      'not_found',
      'timeout',
      'cancelled',
      'check_failed',
        'runtime_failure',
        'environment_unavailable',
    ].includes(failureClass))
  ) fail('canary_evidence_failed');
  const durationMs = source.duration_ms === null ? null : safeRuntimeDuration(source.duration_ms);
  const summaryDigest = source.summary === null
    ? null
    : digestText(evidenceText(source.summary, 360, 1_440));
  const resultRef = source.result_ref === null
    ? null
    : safeRuntimeRef(source.result_ref, RUNTIME_RESULT_REF_PATTERN);
  const targetLabelDigest = source.target_label === null
    ? null
    : digestText(evidenceText(source.target_label, 240, 960));
  const statusLabelDigest = source.status_label === null
    ? null
    : digestText(evidenceText(source.status_label, 240, 960));
  sanitizeTaskStreamProgrammingRuntimeToolPresentationDetail(source.presentation_detail);
  const fileChange = sanitizeTaskStreamProgrammingRuntimeFileChange(source.file_change);
  const checkResult = sanitizeTaskStreamProgrammingRuntimeCheckResult(source.check_result);
  if (
    (state === 'running' && (
      durationMs !== null
      || summaryDigest !== null
      || failureClass !== null
      || resultRef !== null
    ))
    || (state === 'completed' && (
      durationMs === null
      || summaryDigest === null
      || failureClass !== null
      || resultRef === null
    ))
    || (state === 'failed' && (
      durationMs === null
      || summaryDigest === null
      || failureClass === null
      || resultRef !== null
    ))
    || (fileChange !== null && toolKind !== 'edit' && toolKind !== 'write')
    || (checkResult !== null && toolKind !== 'command')
  ) fail('canary_evidence_failed');
  return Object.freeze({
    item_kind: 'programming_runtime_tool_activity',
    sequence,
    turn_id: safeBuilderId(source.turn_id, 'turn_id'),
    run_id: safeBuilderId(source.run_id, 'run_id'),
    step_id: safeBuilderId(source.step_id, 'run_step_id'),
    tool_call_id: safeBuilderId(source.tool_call_id, 'tool_call_id'),
    tool_kind: toolKind,
    state,
    active_label_digest: digestText(evidenceText(source.active_label, 240, 960)),
    completed_label_digest: digestText(evidenceText(source.completed_label, 240, 960)),
    target_label_digest: targetLabelDigest,
    presentation,
    status_label_digest: statusLabelDigest,
    duration_ms: durationMs,
    summary_digest: summaryDigest,
    failure_class: failureClass,
    result_ref: resultRef,
    file_change: fileChange,
    check_result: checkResult,
  });
}

function sanitizeTaskStreamProgrammingRuntimeAssistantMessage(source, sequence) {
  return Object.freeze({
    item_kind: 'programming_runtime_assistant_message',
    sequence,
    turn_id: safeBuilderId(source.turn_id, 'turn_id'),
    run_id: safeBuilderId(source.run_id, 'run_id'),
    step_id: safeBuilderId(source.step_id, 'run_step_id'),
    message: sanitizeTaskStreamMessage(source.message),
  });
}

function sanitizeTaskStreamProgrammingRuntimeStatus(source, sequence) {
  const statusKind = source.status_kind;
  const activityKind = source.activity_kind;
  const attentionClass = source.attention_class;
  const failureClass = source.failure_class;
  if (
    !['reasoning', 'activity', 'attention', 'cancelled', 'failure'].includes(statusKind)
    || (activityKind !== null
      && !TASK_STREAM_PROGRAMMING_RUNTIME_ACTIVITY_KINDS.includes(activityKind))
    || (attentionClass !== null
      && !TASK_STREAM_PROGRAMMING_RUNTIME_ATTENTION_CLASSES.includes(attentionClass))
    || (failureClass !== null
      && !TASK_STREAM_PROGRAMMING_RUNTIME_FAILURE_CLASSES.includes(failureClass))
    || (statusKind === 'reasoning'
      && (activityKind !== null || attentionClass !== null || failureClass !== null))
    || (statusKind === 'activity'
      && (activityKind === null || attentionClass !== null || failureClass !== null))
    || (statusKind === 'attention'
      && (activityKind !== null || attentionClass === null || failureClass !== null))
    || (statusKind === 'cancelled'
      && (activityKind !== null || attentionClass !== null || failureClass !== 'cancelled'))
    || (statusKind === 'failure'
      && (activityKind !== null || attentionClass !== null
        || failureClass === null || failureClass === 'cancelled'))
  ) fail('canary_evidence_failed');
  return Object.freeze({
    item_kind: 'programming_runtime_status',
    sequence,
    turn_id: safeBuilderId(source.turn_id, 'turn_id'),
    run_id: safeBuilderId(source.run_id, 'run_id'),
    step_id: source.step_id === null ? null : safeBuilderId(source.step_id, 'run_step_id'),
    activity_kind: activityKind,
    attention_class: attentionClass,
    failure_class: failureClass,
    status_kind: statusKind,
    status_digest: digestText(evidenceText(source.status, 360, 1_440)),
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

function sanitizeTaskStreamCheckpointRecorded(source, sequence) {
  if (
    !['created', 'updated', 'failed'].includes(source.status)
    || !Number.isSafeInteger(source.changed_file_count)
    || source.changed_file_count < 0
    || source.changed_file_count > 50_000
    || ![
      'candidate_verified',
      'candidate_verified_with_warnings',
    ].includes(source.verification_status)
  ) fail('canary_evidence_failed');
  return Object.freeze({
    item_kind: 'checkpoint_recorded',
    sequence,
    turn_id: safeBuilderId(source.turn_id, 'turn_id'),
    run_id: safeBuilderId(source.run_id, 'run_id'),
    status: source.status,
    changed_file_count: source.changed_file_count,
    verification_status: source.verification_status,
  });
}

function sanitizeTaskStreamRecoveryActionRecorded(source, sequence) {
  if (
    !['restore_checkpoint', 'restore_revision'].includes(source.action)
    || !['requested', 'completed', 'failed'].includes(source.phase)
  ) fail('canary_evidence_failed');
  return Object.freeze({
    item_kind: 'recovery_action_recorded',
    sequence,
    turn_id: safeBuilderId(source.turn_id, 'turn_id'),
    run_id: safeBuilderId(source.run_id, 'run_id'),
    action: source.action,
    phase: source.phase,
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
  } else if (itemKind === 'agent_step_progress_recorded') {
    source = exactTaskStreamValues(value, TASK_STREAM_AGENT_STEP_PROGRESS_KEYS);
  } else if (itemKind === 'run_control_requested') {
    source = exactTaskStreamValues(value, TASK_STREAM_RUN_CONTROL_KEYS);
  } else if (itemKind === 'checkpoint_recorded') {
    source = exactTaskStreamValues(value, TASK_STREAM_CHECKPOINT_RECORDED_KEYS);
  } else if (itemKind === 'recovery_action_recorded') {
    source = exactTaskStreamValues(value, TASK_STREAM_RECOVERY_ACTION_RECORDED_KEYS);
  } else if (itemKind === 'tool_call_requested') {
    source = exactTaskStreamValues(value, TASK_STREAM_TOOL_CALL_REQUESTED_KEYS);
  } else if (itemKind === 'tool_call_result_recorded') {
    source = exactTaskStreamValues(value, TASK_STREAM_TOOL_CALL_RESULT_RECORDED_KEYS);
  } else if (itemKind === 'programming_runtime_tool_activity') {
    source = exactTaskStreamValues(
      value,
      TASK_STREAM_PROGRAMMING_RUNTIME_TOOL_ACTIVITY_KEYS,
    );
  } else if (itemKind === 'programming_runtime_assistant_message') {
    source = exactTaskStreamValues(
      value,
      TASK_STREAM_PROGRAMMING_RUNTIME_ASSISTANT_MESSAGE_KEYS,
    );
  } else if (itemKind === 'programming_runtime_status') {
    source = exactTaskStreamValues(
      value,
      TASK_STREAM_PROGRAMMING_RUNTIME_STATUS_KEYS,
    );
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
  if (itemKind === 'agent_step_progress_recorded') {
    return sanitizeTaskStreamAgentStepProgress(source, sequence);
  }
  if (itemKind === 'run_control_requested') return sanitizeTaskStreamRunControl(source, sequence);
  if (itemKind === 'checkpoint_recorded') {
    return sanitizeTaskStreamCheckpointRecorded(source, sequence);
  }
  if (itemKind === 'recovery_action_recorded') {
    return sanitizeTaskStreamRecoveryActionRecorded(source, sequence);
  }
  if (itemKind === 'tool_call_requested') return sanitizeTaskStreamToolCallRequested(source, sequence);
  if (itemKind === 'tool_call_result_recorded') return sanitizeTaskStreamToolCallResultRecorded(source, sequence);
  if (itemKind === 'programming_runtime_tool_activity') {
    return sanitizeTaskStreamProgrammingRuntimeToolActivity(source, sequence);
  }
  if (itemKind === 'programming_runtime_assistant_message') {
    return sanitizeTaskStreamProgrammingRuntimeAssistantMessage(source, sequence);
  }
  if (itemKind === 'programming_runtime_status') {
    return sanitizeTaskStreamProgrammingRuntimeStatus(source, sequence);
  }
  if (itemKind === 'run_completed') return sanitizeTaskStreamRunCompleted(source, sequence);
  if (itemKind === 'candidate_reviewed') return sanitizeTaskStreamCandidateReviewed(source, sequence);
  if (itemKind === 'plan_reviewed') return sanitizeTaskStreamPlanReviewed(source, sequence);
  return sanitizeTaskStreamTurnCompleted(source, sequence);
}

function taskStreamItemCounts(items) {
  const counts = {
    answer_count: 0,
    agent_step_progress_count: 0,
    candidate_accepted_count: 0,
    candidate_ready_count: 0,
    candidate_rejected_count: 0,
    candidate_reviewed_count: 0,
    candidate_result_count: 0,
    checkpoint_created_count: 0,
    checkpoint_failed_count: 0,
    checkpoint_updated_count: 0,
    explanation_result_count: 0,
    plan_approved_count: 0,
    plan_ready_count: 0,
    plan_rejected_count: 0,
    plan_result_count: 0,
    plan_reviewed_count: 0,
    programming_run_admitted_count: 0,
    programming_runtime_check_failed_count: 0,
    programming_runtime_check_passed_count: 0,
    programming_runtime_assistant_message_count: 0,
    programming_runtime_status_count: 0,
    programming_runtime_tool_activity_count: 0,
    run_control_cancel_count: 0,
    run_control_interrupt_count: 0,
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
    recovery_action_completed_count: 0,
    recovery_action_failed_count: 0,
    recovery_action_requested_count: 0,
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
  const checkpointByRunId = new Map();
  const activeRunByTurnId = new Map();
  const agentStepProgressById = new Map();
  const planReviewByRunId = new Map();
  const planRunCompletedByRunId = new Map();
  const programmingRunAdmissionByRunId = new Map();
  const programmingRuntimeAssistantMessageById = new Map();
  const programmingRuntimeToolActivityById = new Map();
  const recoveryActionByRunId = new Map();
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
    if (item.item_kind === 'agent_step_progress_recorded') {
      counts.agent_step_progress_count += 1;
      const started = runStartedByRunId.get(item.run_id) ?? null;
      const existing = agentStepProgressById.get(item.step_id) ?? null;
      if (
        started === null
        || started.turn_id !== item.turn_id
        || started.task_id !== item.task_id
        || runCompletedByRunId.has(item.run_id)
      ) fail('canary_evidence_failed');
      if (item.recorded_state === 'start_recorded') {
        if (existing !== null || item.result !== null) fail('canary_evidence_failed');
        agentStepProgressById.set(item.step_id, {
          run_id: item.run_id,
          step_index: item.step_index,
          result_recorded: false,
        });
      } else {
        if (
          existing === null
          || existing.run_id !== item.run_id
          || existing.step_index !== item.step_index
          || existing.result_recorded
          || item.result === null
        ) fail('canary_evidence_failed');
        agentStepProgressById.set(item.step_id, {
          ...existing,
          result_recorded: true,
        });
      }
    }
    if (item.item_kind === 'run_control_requested') {
      const started = runStartedByRunId.get(item.run_id) ?? null;
      if (
        started === null
        || started.turn_id !== item.turn_id
        || started.sequence >= item.sequence
        || runCompletedByRunId.has(item.run_id)
      ) fail('canary_evidence_failed');
      if (item.action === 'cancel') counts.run_control_cancel_count += 1;
      if (item.action === 'interrupt') counts.run_control_interrupt_count += 1;
    }
    if (item.item_kind === 'checkpoint_recorded') {
      const started = runStartedByRunId.get(item.run_id) ?? null;
      const contextSnapshot = runContextSnapshotByRunId.get(item.run_id) ?? null;
      if (
        started === null
        || contextSnapshot === null
        || started.turn_id !== item.turn_id
        || contextSnapshot.turn_id !== item.turn_id
        || runCompletedByRunId.has(item.run_id)
        || (checkpointByRunId.has(item.run_id) && item.status !== 'updated')
      ) fail('canary_evidence_failed');
      checkpointByRunId.set(item.run_id, item);
      if (item.status === 'created') counts.checkpoint_created_count += 1;
      if (item.status === 'updated') counts.checkpoint_updated_count += 1;
      if (item.status === 'failed') counts.checkpoint_failed_count += 1;
    }
    if (item.item_kind === 'recovery_action_recorded') {
      const started = runStartedByRunId.get(item.run_id) ?? null;
      const contextSnapshot = runContextSnapshotByRunId.get(item.run_id) ?? null;
      const existing = recoveryActionByRunId.get(item.run_id) ?? null;
      if (
        started === null
        || contextSnapshot === null
        || started.turn_id !== item.turn_id
        || contextSnapshot.turn_id !== item.turn_id
        || runCompletedByRunId.has(item.run_id)
      ) fail('canary_evidence_failed');
      if (item.phase === 'requested') {
        if (existing !== null) fail('canary_evidence_failed');
        counts.recovery_action_requested_count += 1;
      } else {
        if (existing === null || existing.action !== item.action || existing.phase !== 'requested') {
          fail('canary_evidence_failed');
        }
        if (item.phase === 'completed') counts.recovery_action_completed_count += 1;
        if (item.phase === 'failed') counts.recovery_action_failed_count += 1;
      }
      recoveryActionByRunId.set(item.run_id, item);
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
    if (item.item_kind === 'programming_runtime_tool_activity') {
      counts.programming_runtime_tool_activity_count += 1;
      const started = runStartedByRunId.get(item.run_id) ?? null;
      const existing = programmingRuntimeToolActivityById.get(item.tool_call_id) ?? null;
      if (
        started === null
        || started.turn_id !== item.turn_id
        || runCompletedByRunId.has(item.run_id)
      ) failWithDiagnostic('canary_evidence_failed', Object.freeze({
        validation_phase: 'programming_runtime_tool_activity_run_relationship',
      }));
      if (existing === null) {
        if (item.state !== 'running') {
          failWithDiagnostic('canary_evidence_failed', Object.freeze({
            validation_phase: 'programming_runtime_tool_activity_initial_state',
          }));
        }
      } else if (
        existing.run_id !== item.run_id
        || existing.step_id !== item.step_id
        || existing.tool_kind !== item.tool_kind
        || existing.state !== 'running'
      ) failWithDiagnostic('canary_evidence_failed', Object.freeze({
        validation_phase: 'programming_runtime_tool_activity_transition',
      }));
      const existingCheckStatus = existing?.check_result_status ?? null;
      const nextCheckStatus = item.check_result?.status ?? null;
      if (
        existingCheckStatus !== null
        && nextCheckStatus !== null
        && existingCheckStatus !== nextCheckStatus
      ) fail('canary_evidence_failed');
      if (existingCheckStatus === null && nextCheckStatus === 'failed') {
        counts.programming_runtime_check_failed_count += 1;
      }
      if (existingCheckStatus === null && nextCheckStatus === 'passed') {
        counts.programming_runtime_check_passed_count += 1;
      }
      programmingRuntimeToolActivityById.set(item.tool_call_id, {
        run_id: item.run_id,
        step_id: item.step_id,
        tool_kind: item.tool_kind,
        state: item.state,
        check_result_status: nextCheckStatus ?? existingCheckStatus,
      });
    }
    if (item.item_kind === 'programming_runtime_assistant_message') {
      counts.programming_runtime_assistant_message_count += 1;
      const started = runStartedByRunId.get(item.run_id) ?? null;
      if (
        started === null
        || started.turn_id !== item.turn_id
        || runCompletedByRunId.has(item.run_id)
        || programmingRuntimeAssistantMessageById.has(item.message.message_id)
      ) fail('canary_evidence_failed');
      programmingRuntimeAssistantMessageById.set(item.message.message_id, item);
    }
    if (item.item_kind === 'programming_runtime_status') {
      counts.programming_runtime_status_count += 1;
      const started = runStartedByRunId.get(item.run_id) ?? null;
      if (
        started === null
        || started.turn_id !== item.turn_id
        || runCompletedByRunId.has(item.run_id)
      ) fail('canary_evidence_failed');
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
  let conversationId;
  try {
    conversationId = safeConversationId(projectId, descriptors.conversation_id.value);
  } catch {
    failWithDiagnostic('canary_evidence_failed', Object.freeze({
      validation_phase: 'conversation_identity',
    }));
  }
  const rawItems = denseEvidenceArray(
    descriptors.items.value,
    TASK_STREAM_MAX_PUBLIC_ITEMS,
  );
  const items = rawItems.map((item, index) => {
    try {
      return sanitizeTaskStreamItem(item);
    } catch {
      let itemKind = 'unknown';
      if (item !== null && typeof item === 'object' && !Array.isArray(item) && !isObjectProxy(item)) {
        const descriptor = Object.getOwnPropertyDescriptor(item, 'item_kind');
        if (
          descriptor
          && Object.hasOwn(descriptor, 'value')
          && typeof descriptor.value === 'string'
          && [
            'user_message',
            'task_brief_updated',
            'run_started',
            'run_context_snapshot_recorded',
            'programming_run_admitted',
            'run_progress_recorded',
            'agent_step_progress_recorded',
            'run_control_requested',
            'checkpoint_recorded',
            'recovery_action_recorded',
            'tool_call_requested',
            'tool_call_result_recorded',
            'programming_runtime_assistant_message',
            'programming_runtime_status',
            'programming_runtime_tool_activity',
            'run_completed',
            'candidate_reviewed',
            'plan_reviewed',
            'turn_completed',
          ].includes(descriptor.value)
        ) itemKind = descriptor.value;
      }
      failWithDiagnostic('canary_evidence_failed', Object.freeze({
        task_stream_item_index: index,
        task_stream_item_kind: itemKind,
        validation_phase: 'item_shape',
      }));
    }
  });
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
    || firstSequence !== items[0].sequence
    || lastSequence < items.at(-1).sequence
    || headSequence !== lastSequence
    || hasEarlier !== (firstSequence > 1)
    || (hasEarlier ? items.length !== TASK_STREAM_MAX_PUBLIC_ITEMS : firstSequence !== 1)
  ) failWithDiagnostic('canary_evidence_failed', Object.freeze({
    validation_phase: 'conversation_window',
  }));
  for (let index = 1; index < items.length; index += 1) {
    if (items[index].sequence <= items[index - 1].sequence) {
      failWithDiagnostic('canary_evidence_failed', Object.freeze({
        task_stream_item_index: index,
        task_stream_item_kind: items[index].item_kind,
        validation_phase: 'conversation_sequence',
      }));
    }
  }
  let itemFacts;
  try {
    itemFacts = taskStreamItemCounts(items);
  } catch {
    failWithDiagnostic('canary_evidence_failed', Object.freeze({
      validation_phase: 'item_relationships',
    }));
  }
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

function safeConversationId(projectId, value) {
  safeBuilderId(value, 'conversation_id');
  try {
    return sanitizeBuilderConversationAddress(projectId, value);
  } catch {
    fail('canary_evidence_failed');
  }
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
  const projectId = safeProjectId(descriptors.project_id.value);
  const body = Object.freeze({
    candidate_digest: safeDigest(descriptors.candidate_digest.value),
    candidate_id: safeBuilderId(descriptors.candidate_id.value, 'candidate_id'),
    commit_oid: safeOid(descriptors.commit_oid.value),
    conversation_id: safeConversationId(projectId, descriptors.conversation_id.value),
    object_format: descriptors.object_format.value,
    parent_oid: safeOid(descriptors.parent_oid.value, true),
    previous_revision_receipt_digest: descriptors.previous_revision_receipt_digest.value === null
      ? null
      : safeDigest(descriptors.previous_revision_receipt_digest.value),
    project_id: projectId,
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
  const projectId = safeProjectId(descriptors.project_id.value);
  return Object.freeze({
    candidate_digest: safeDigest(descriptors.candidate_digest.value),
    candidate_id: safeBuilderId(descriptors.candidate_id.value, 'candidate_id'),
    code_authority: 'git_commit_candidate',
    commit_oid: safeOid(descriptors.commit_oid.value),
    conversation_id: safeConversationId(projectId, descriptors.conversation_id.value),
    expected_base_oid: safeOid(descriptors.expected_base_oid.value, true),
    object_format: 'sha1',
    parent_oid: safeOid(descriptors.parent_oid.value, true),
    product_revision_admission: 'not_recorded',
    project_id: projectId,
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
  const projectId = safeProjectId(descriptors.project_id.value);
  return Object.freeze({
    candidate_digest: safeDigest(descriptors.candidate_digest.value),
    candidate_id: safeBuilderId(descriptors.candidate_id.value, 'candidate_id'),
    candidate_tree_oid: safeOid(descriptors.candidate_tree_oid.value),
    commit_object_admission: 'verified',
    commit_oid: safeOid(descriptors.commit_oid.value),
    commit_ref_admission: 'verified',
    conversation_id: safeConversationId(projectId, descriptors.conversation_id.value),
    expected_base_oid: safeOid(descriptors.expected_base_oid.value, true),
    object_format: 'sha1',
    project_id: projectId,
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
    active_turn_present: conversation !== null && conversation.recorded_active_turn_id !== null,
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
    + counts.checkpoint_created_count
    + counts.checkpoint_failed_count
    + counts.checkpoint_updated_count
    + counts.run_context_snapshot_count
    + counts.run_control_cancel_count
    + counts.run_control_interrupt_count
    + counts.programming_run_admitted_count
    + counts.agent_step_progress_count
    + counts.programming_runtime_assistant_message_count
    + counts.programming_runtime_status_count
    + counts.programming_runtime_tool_activity_count
    + counts.recovery_action_completed_count
    + counts.recovery_action_failed_count
    + counts.recovery_action_requested_count
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
    || counts.programming_run_admitted_count < planOptions.approvedPlanReviews
    || counts.programming_run_admitted_count > expectedTurnCount
    || counts.agent_step_progress_count > expectedTurnCount * 512
    || counts.programming_runtime_assistant_message_count > expectedTurnCount * 512
    || counts.programming_runtime_tool_activity_count > expectedTurnCount * 512
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
  ) failWithDiagnostic('canary_evidence_failed', Object.freeze({
    validation_phase: 'candidate_facts_stream_identity',
  }));

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
    || conversation.window.last_sequence !== conversation.head_sequence
    || conversation.window.has_earlier !== false
    || conversation.head_sequence < expectedItemCount
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
  ) {
    failWithDiagnostic('canary_evidence_failed', Object.freeze({
      diagnostic_version: 'builder-canary-task-stream-count-diagnostic.v1',
      comparison: 'candidate_facts',
      project_id_matches: stream.project_id === expectedRevision.project_id,
      conversation_id_matches:
        stream.conversation.conversation_id === expectedRevision.conversation_id,
      recorded_active_turn_absent: stream.conversation.recorded_active_turn_id === null,
      expected: Object.freeze({
        accepted_review_count: expectedAcceptedReviews,
        candidate_turn_count: expectedCandidateTurns,
        item_count: expectedItemCount,
        question_turn_count: expectedQuestionTurns,
        turn_count: expectedTurnCount,
        user_message_count: expectedUserMessageCount,
      }),
      actual: Object.freeze({
        accepted_review_count: counts.candidate_accepted_count,
        candidate_ready_count: counts.candidate_ready_count,
        candidate_result_count: counts.candidate_result_count,
        head_sequence: conversation.head_sequence,
        item_count: conversation.item_count,
        run_completed_count: counts.run_completed_count,
        run_started_count: counts.run_started_count,
        submitted_message_count: counts.submitted_message_count,
        turn_completed_count: counts.turn_completed_count,
        user_message_count: counts.user_message_count,
        window_first_sequence: conversation.window.first_sequence,
        window_has_earlier: conversation.window.has_earlier,
        window_last_sequence: conversation.window.last_sequence,
      }),
    }));
  }
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
  ) failWithDiagnostic('canary_evidence_failed', Object.freeze({
    validation_phase: 'candidate_facts_latest_binding',
  }));

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
    || conversation.window.last_sequence !== conversation.head_sequence
    || conversation.window.has_earlier !== false
    || conversation.head_sequence < expectedItemCount
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
    || conversation.window.last_sequence !== conversation.head_sequence
    || conversation.window.has_earlier !== false
    || conversation.head_sequence < expectedItemCount
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
    || conversation.window.last_sequence !== conversation.head_sequence
    || conversation.window.has_earlier !== false
    || conversation.head_sequence < expectedItemCount
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
    || conversation.window.last_sequence !== conversation.head_sequence
    || conversation.window.has_earlier !== false
    || conversation.head_sequence < expectedItemCount
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

function assertTaskStreamPendingExplanationFacts(
  evidence,
  expectedSavedRevision,
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
    || stream.project_id !== expectedSavedRevision.project_id
    || current.product_revision_receipt.project_id !== expectedSavedRevision.project_id
    || current.product_revision_receipt.revision_number !== expectedSavedRevision.revision_number
    || current.product_revision_receipt.revision_receipt_digest
      !== expectedSavedRevision.revision_receipt_digest
    || current.product_revision_receipt.commit_oid !== expectedSavedRevision.commit_oid
    || current.product_revision_receipt.tree_oid !== expectedSavedRevision.tree_oid
    || expectedCandidateTurns <= expectedSavedRevision.revision_number
    || expectedQuestionTurns < 1
    || stream.conversation === null
    || stream.conversation.conversation_id !== expectedSavedRevision.conversation_id
    || stream.conversation.recorded_active_turn_id !== null
  ) fail('canary_question_evidence_failed');

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
    || conversation.window.last_sequence !== conversation.head_sequence
    || conversation.window.has_earlier !== false
    || conversation.head_sequence < expectedItemCount
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

  const latestCandidate = facts.latestCandidate;
  const latestCandidateReview = facts.latestCandidateReview;
  const latestExplanation = facts.latestExplanation;
  const latestExplanationRunStarted = facts.latestExplanationRunStarted;
  const latestExplanationUserMessage = facts.latestExplanationUserMessage;
  const latestTurn = facts.latestTurn;
  if (
    latestCandidate === null
    || latestCandidateReview === null
    || latestExplanation === null
    || latestExplanationRunStarted === null
    || latestExplanationUserMessage === null
    || latestTurn === null
    || latestCandidate.turn_id === expectedSavedRevision.turn_id
    || latestCandidate.run_id === expectedSavedRevision.run_id
    || latestCandidate.terminal_status !== 'succeeded'
    || latestCandidate.result_kind !== 'candidate'
    || latestCandidate.candidate === null
    || latestCandidate.candidate.source_availability !== 'not_loaded'
    || latestCandidateReview.decision !== 'accepted'
    || latestCandidateReview.candidate_state !== 'saved'
    || latestCandidateReview.saved_revision.revision_number !== expectedSavedRevision.revision_number
    || latestCandidateReview.run_id === latestCandidate.run_id
    || latestCandidate.sequence >= latestExplanationUserMessage.sequence
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
    latest_candidate_review: 'pending',
    latest_candidate_distinct_from_saved_revision: true,
    ...planTaskStreamReturnFields(counts, planOptions, facts.latestPlanReview),
    revision_unchanged: true,
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

async function capturePreviewSurfacePixels(page, locator, failureCode) {
  const bounds = await locator.boundingBox();
  if (
    bounds === null
    || !Number.isFinite(bounds.x)
    || !Number.isFinite(bounds.y)
    || !Number.isFinite(bounds.width)
    || !Number.isFinite(bounds.height)
    || bounds.width < 1
    || bounds.height < 1
  ) fail(failureCode);
  const screenshot = await page.screenshot({
    animations: 'disabled',
    clip: {
      x: Math.max(0, bounds.x),
      y: Math.max(0, bounds.y),
      width: bounds.width,
      height: bounds.height,
    },
    timeout: 5000,
  });
  return summarizePreviewPng(screenshot, failureCode);
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
  let previewEvidenceStep = 'opening_preview';
  try {
    gate.assertAllowed();
    await openPreviewSurfaceViaUi(page);
    previewEvidenceStep = 'reading_preview_mode';
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
      previewEvidenceStep = 'capturing_unavailable_pixels';
      return Object.freeze({
        ...await capturePreviewSurfacePixels(
          page,
          unavailable,
          'canary_preview_unavailable_pixels_failed',
        ),
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
      previewEvidenceStep = 'capturing_runtime_unavailable_pixels';
      return Object.freeze({
        ...await capturePreviewSurfacePixels(page, section, 'canary_preview_pixels_failed'),
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
    previewEvidenceStep = 'waiting_preview_frame';
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
    if (!staticPreviewSrcdocHasReadableBody(srcdoc)) fail('canary_preview_frame_body_failed');
    previewEvidenceStep = 'capturing_preview_frame_pixels';
    return Object.freeze({
      ...await capturePreviewSurfacePixels(page, frame, 'canary_preview_pixels_failed'),
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
      preview_evidence_step: previewEvidenceStep,
      recoverable_preview_error: previewRecoverableErrorDiagnostic(error),
    });
  }
}

function staticPreviewSrcdocHasReadableBody(srcdoc) {
  if (typeof srcdoc !== 'string') return false;
  const body = /<body\b[^>]*>([\s\S]*?)<\/body>/iu.exec(srcdoc)?.[1] ?? null;
  if (body === null) return false;
  return body
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, ' ')
    .replace(/<[^>]+>/gu, ' ')
    .replace(/&(?:#\d+|#x[\da-f]+|[a-z][\da-z]+);/giu, ' ')
    .trim()
    .length > 0;
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

async function waitForChangedPreviewEvidence(
  page,
  gate,
  before,
  comparison,
  supplemental = null,
  attempt = 0,
) {
  const after = await capturePreviewEvidence(page, gate);
  if (staticPreviewSrcdocChanged(after, before)) return after;
  if (attempt < 29) {
    if (typeof page.waitForTimeout === 'function') await page.waitForTimeout(100);
    else await new Promise((resolve) => setTimeout(resolve, 100));
    return waitForChangedPreviewEvidence(page, gate, before, comparison, supplemental, attempt + 1);
  }
  failWithDiagnostic(
    'canary_preview_failed',
    Object.freeze({
      ...previewComparisonDiagnostic(comparison, before, after),
      ...(supplemental === null ? {} : { supplemental }),
    }),
  );
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
  let canaryPhase = 'bootstrap';
  let checkpointCanaryPhase = null;
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
    canaryPhase = 'input';
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
    canaryPhase = 'launch';
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
    canaryPhase = 'chrome';
    const customChrome = await assertCustomChromeControls(page);
    if (input.mode !== 'saved_profile') {
      canaryPhase = 'provider_settings';
      await fillProviderSettingsViaUi(page, input.provider, gate);
    } else {
      await readSanitizedBridgeEvidence(page, null, 'canary_read_evidence_saved_profile_boot_failed');
      gate.allow();
    }
    canaryPhase = 'initial_chat';
    const initialChat = await askInitialChatQuestionViaUi(
      page,
      CANARY_INITIAL_CHAT_QUESTION,
      1,
      Object.freeze({ observeLiveOutput: true }),
    );
    canaryPhase = 'initial_chat_followup';
    const initialChatFollowup = await askInitialChatQuestionViaUi(
      page,
      'Can we keep discussing before I choose a project folder?',
      2,
    );
    canaryPhase = 'initial_draft';
    const initialDraft = await generateProjectViaUi(page, input.idea, userDataRoot);
    canaryPhase = 'initial_saved_activity';
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
    const pendingUpdatePreviewEvidence = await waitForChangedPreviewEvidence(
      page,
      gate,
      initialPreviewEvidence,
      'pending_update_changed_srcdoc',
    );
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
    const updatedPreviewEvidence = await waitForChangedPreviewEvidence(
      pendingRestartPage,
      gate,
      initialPreviewEvidence,
      'updated_changed_srcdoc',
    );
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
    const restartConversationRestore = await assertRestoredConversationSettledViaUi(restartedPage);
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
    const planTaskStreamOptions = Object.freeze({
      approvedPlanReviews: 1,
      planTurns: 1,
      requireToolActivity: true,
    });
    const restartContinuationTaskStream = assertTaskStreamPendingCandidateFacts(
      restartContinuationEvidence,
      updatedRevision,
      3,
      0,
      planTaskStreamOptions,
    );
    const restartContinuationPreviewEvidence = await waitForChangedPreviewEvidence(
      restartedPage,
      gate,
      restartPreviewEvidence,
      'restart_continuation_changed_srcdoc',
    );
    const restartContinuationAdvancedCandidateCount = (
      restartContinuationTaskStream.candidate_ready_count === restartTaskStream.candidate_ready_count + 1
      && restartContinuationTaskStream.accepted_review_count === restartTaskStream.accepted_review_count
      && restartContinuationTaskStream.saved_revision_number === updatedRevision.revision_number
    );
    if (!restartContinuationAdvancedCandidateCount) fail('canary_evidence_failed');

    checkpointCanaryPhase = 'continuation_one_create';
    const checkpointContinuationOneDraft = await createUpdateDraftViaUi(
      restartedPage,
      updatedRevision,
      CANARY_CHECKPOINT_CONTINUATION_ONE,
      0,
      userDataRoot,
      fsModule,
      4,
      planTaskStreamOptions,
    );
    checkpointCanaryPhase = 'continuation_one_evidence';
    const checkpointContinuationOneEvidence = await readSanitizedBridgeEvidence(
      restartedPage,
      updatedProject.project_id,
    );
    const checkpointContinuationOneTaskStream = assertTaskStreamPendingCandidateFacts(
      checkpointContinuationOneEvidence,
      updatedRevision,
      4,
      0,
      planTaskStreamOptions,
    );
    const checkpointContinuationOnePreview = await waitForChangedPreviewEvidence(
      restartedPage,
      gate,
      restartContinuationPreviewEvidence,
      'checkpoint_continuation_one_changed_srcdoc',
      Object.freeze({
        generation_debug: optionalCanaryGenerationDebug(userDataRoot, fsModule),
      }),
    );

    checkpointCanaryPhase = 'continuation_two_create';
    const checkpointContinuationTwoDraft = await createUpdateDraftViaUi(
      restartedPage,
      updatedRevision,
      CANARY_CHECKPOINT_CONTINUATION_TWO,
      0,
      userDataRoot,
      fsModule,
      5,
      planTaskStreamOptions,
    );
    checkpointCanaryPhase = 'continuation_two_evidence';
    const checkpointContinuationTwoEvidence = await readSanitizedBridgeEvidence(
      restartedPage,
      updatedProject.project_id,
    );
    const checkpointContinuationTwoTaskStream = assertTaskStreamPendingCandidateFacts(
      checkpointContinuationTwoEvidence,
      updatedRevision,
      5,
      0,
      planTaskStreamOptions,
    );
    const checkpointContinuationTwoPreview = await waitForChangedPreviewEvidence(
      restartedPage,
      gate,
      checkpointContinuationOnePreview,
      'checkpoint_continuation_two_changed_srcdoc',
    );

    checkpointCanaryPhase = 'undo_first';
    const checkpointUndoFirst = await undoDraftToCheckpointViaUi(
      restartedPage,
      updatedRevision,
      6,
      checkpointContinuationOnePreview,
      userDataRoot,
      gate,
      planTaskStreamOptions,
    );
    await closeApp(app);
    app = null;

    checkpointCanaryPhase = 'undo_restart_launch';
    app = await launchApp({
      electron,
      env,
      executablePath: input.executable_path,
      projectRootPath,
      userDataPath: userDataRoot.path,
    });
    const checkpointRestartApplicationObserver = attachApplicationNetworkRecorder(recorder, app);
    const checkpointRestartPage = await app.firstWindow();
    if (checkpointRestartApplicationObserver !== true) recorder.attachPage(checkpointRestartPage);
    await assertCustomChromeControls(checkpointRestartPage);
    await openProjectFromCatalogById(checkpointRestartPage, updatedRevision, 'canary_restart_open_failed');
    const checkpointRestartConversation = await assertRestoredConversationSettledViaUi(checkpointRestartPage);
    checkpointCanaryPhase = 'undo_restart_restore';
    const checkpointRestart = await readPendingUpdateDraftRestoreEvidence(
      checkpointRestartPage,
      updatedRevision,
      6,
      0,
      planTaskStreamOptions,
    );
    const checkpointRestartPreview = await capturePreviewEvidence(checkpointRestartPage, gate);
    const checkpointUndoRestartRecovered = (
      samePreviewEvidence(checkpointRestartPreview, checkpointUndoFirst.preview)
      && digestCanonical(checkpointRestart.task_stream) === digestCanonical(checkpointUndoFirst.task_stream)
    );
    if (!checkpointUndoRestartRecovered) fail('canary_checkpoint_undo_failed');

    checkpointCanaryPhase = 'undo_second';
    const checkpointUndoSecond = await undoDraftToCheckpointViaUi(
      checkpointRestartPage,
      updatedRevision,
      7,
      restartContinuationPreviewEvidence,
      userDataRoot,
      gate,
      planTaskStreamOptions,
    );
    checkpointCanaryPhase = 'post_undo_continuation_create';
    const checkpointPostUndoDraft = await createUpdateDraftViaUi(
      checkpointRestartPage,
      updatedRevision,
      CANARY_POST_UNDO_CONTINUATION,
      0,
      userDataRoot,
      fsModule,
      8,
      planTaskStreamOptions,
    );
    checkpointCanaryPhase = 'post_undo_continuation_evidence';
    const checkpointPostUndoEvidence = await readSanitizedBridgeEvidence(
      checkpointRestartPage,
      updatedProject.project_id,
    );
    const checkpointPostUndoTaskStream = assertTaskStreamPendingCandidateFacts(
      checkpointPostUndoEvidence,
      updatedRevision,
      8,
      0,
      planTaskStreamOptions,
    );
    const checkpointPostUndoPreview = await waitForChangedPreviewEvidence(
      checkpointRestartPage,
      gate,
      checkpointUndoSecond.preview,
      'checkpoint_post_undo_changed_srcdoc',
    );
    checkpointCanaryPhase = 'saved_project_context_question';
    const priorVisibleAnswerCount = await optionalLocatorCount(
      checkpointRestartPage,
      SELECTORS.questionAnswer,
    );
    const savedProjectContextChat = await askProjectQuestionViaUi(
      checkpointRestartPage,
      updatedRevision,
      CANARY_QUESTION,
      8,
      1,
      priorVisibleAnswerCount + 1,
      Object.freeze({
        expect_unsaved_draft: true,
        expected_answer_text: CANARY_SAVED_PROJECT_CONTEXT_ANSWER,
        pending_candidate: true,
        task_stream_options: planTaskStreamOptions,
      }),
    );
    if (
      savedProjectContextChat.task_stream.candidate_ready_count
        !== checkpointPostUndoTaskStream.candidate_ready_count
      || savedProjectContextChat.task_stream.saved_revision_number
        !== checkpointPostUndoTaskStream.saved_revision_number
    ) fail('canary_question_evidence_failed');
    checkpointCanaryPhase = null;
    const finalNetwork = recorder.snapshot();
    if (finalNetwork.renderer_unexpected_network_count !== 0) fail('canary_evidence_failed');

    result = Object.freeze({
      result_version: CANARY_RESULT_VERSION,
      artifacts_after_password_clear: gate.allowed,
      custom_chrome: customChrome,
      activity: Object.freeze({
        initial_save: initialSavedActivity,
        restart_restore: restartConversationRestore,
        update_save: updatedSavedActivity,
      }),
      draft: Object.freeze({
        checkpoint_continuation_one: checkpointContinuationOneDraft,
        checkpoint_continuation_two: checkpointContinuationTwoDraft,
        checkpoint_post_undo_continuation: checkpointPostUndoDraft,
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
      checkpoint_undo: Object.freeze({
        continued_without_formal_save: true,
        first: checkpointUndoFirst,
        formal_revision_unchanged: true,
        repeated_undo_verified: true,
        restart_conversation: checkpointRestartConversation,
        restart_restore: checkpointRestart.ui,
        restart_restore_verified: checkpointUndoRestartRecovered,
        second: checkpointUndoSecond,
      }),
      question: Object.freeze({
        initial_chat: initialChat,
        initial_chat_followup: initialChatFollowup,
        saved_project_context_chat: savedProjectContextChat,
      }),
      preview: Object.freeze({
        initial: initialPreviewEvidence,
        pending_update: pendingUpdatePreviewEvidence,
        pending_update_restart: pendingRestartPreviewEvidence,
        updated: updatedPreviewEvidence,
        restart: restartPreviewEvidence,
        restart_continuation: restartContinuationPreviewEvidence,
        checkpoint_continuation_one: checkpointContinuationOnePreview,
        checkpoint_continuation_two: checkpointContinuationTwoPreview,
        checkpoint_undo_first: checkpointUndoFirst.preview,
        checkpoint_undo_restart: checkpointRestartPreview,
        checkpoint_undo_second: checkpointUndoSecond.preview,
        checkpoint_post_undo_continuation: checkpointPostUndoPreview,
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
        checkpoint_continuation_one: checkpointContinuationOneTaskStream,
        checkpoint_continuation_two: checkpointContinuationTwoTaskStream,
        checkpoint_undo_first: checkpointUndoFirst.task_stream,
        checkpoint_undo_restart: checkpointRestart.task_stream,
        checkpoint_undo_second: checkpointUndoSecond.task_stream,
        checkpoint_post_undo_continuation: checkpointPostUndoTaskStream,
        pending_update_advanced_candidate_count: pendingUpdateTaskStream.candidate_ready_count
          === initialTaskStream.candidate_ready_count + 1,
        saved_project_context_chat: savedProjectContextChat.task_stream,
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
    primaryError = checkpointCanaryPhase !== null && error?.code === 'canary_evidence_failed'
      ? new BuilderPackagedCanaryError('canary_checkpoint_undo_failed', Object.freeze({
        diagnostic_version: 'builder-canary-checkpoint-phase-diagnostic.v1',
        phase: checkpointCanaryPhase,
        cause_code: error.code,
        cause_stage: error.stage ?? null,
      }))
      : fixedError(error);
    if (
      primaryError.code === 'canary_evidence_failed'
      && primaryError.diagnostic === undefined
    ) {
      primaryError.diagnostic = Object.freeze({
        diagnostic_version: 'builder-canary-phase-diagnostic.v1',
        phase: canaryPhase,
      });
    }
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
  CANARY_SAVED_PROJECT_CONTEXT_ANSWER,
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
  assertTaskStreamPendingExplanationFacts,
  assertTaskStreamPlanFacts,
  approveCurrentProjectWriteIfRequested,
  approvePlanSourceReadIfRequested,
  approvePlanViaUi,
  assertNoManualProjectCheckControlsViaUi,
  askInitialChatQuestionViaUi,
  askProjectQuestionViaUi,
  askRejectedPlanContextualSubmitViaUi,
  captureGuardedUserDataRoot,
  capturePreviewEvidence,
  waitForChangedPreviewEvidence,
  captureSavedActivityEvidence,
  bindNewProjectWorkspaceViaUi,
  clickSaveVersionViaUi,
  copySavedProviderProfile,
  createInitialDraftViaUi,
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
  readSanitizedTaskStreamEvidence,
  retryFailedDraftViaUi,
  rejectPlanViaUi,
  runCli,
  runPackagedCanary,
  undoDraftToCheckpointViaUi,
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
