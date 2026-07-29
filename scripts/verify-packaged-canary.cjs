'use strict';

const nodeCrypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { types: utilTypes } = require('node:util');
const { _electron: defaultElectron } = require('playwright-core');
const { PNG } = require('pngjs');

const CANARY_INPUT_VERSION = 'builder-packaged-canary-input.v1';
const CANARY_RESULT_VERSION = 'builder-packaged-canary-result.v14';
const CANARY_QUESTION = 'What does this saved project do, and what should I review before changing it?';
const CANARY_UPDATE_INSTRUCTION = 'Change the main heading and add a short subtitle.';
const CANARY_RESTART_CONTINUATION_INSTRUCTION = 'Plan a compact completed-state summary below the timer before changing files.';
const PACKAGED_CANARY_SENTINEL = 'BUILDER_PACKAGED_CANARY';
const PACKAGED_CANARY_USER_DATA_PATH = 'BUILDER_PACKAGED_CANARY_USER_DATA_PATH';
const PACKAGED_CANARY_USER_DATA_PREFIX = 'clawfabric-builder-packaged-canary-';
const PACKAGED_CANARY_PROJECT_ROOT_PATH = 'BUILDER_PACKAGED_CANARY_PROJECT_ROOT_PATH';
const PACKAGED_CANARY_PROJECT_ROOT_DIRECTORY = 'project-root';
const LOCAL_STATE_FILE_NAME = 'Local State';
const PROVIDER_CONFIG_DIRECTORY_NAME = 'builder-provider-config-v1';
const PROVIDER_CONFIG_CURRENT_FILE_NAME = 'current.json';
const PROVIDER_SECRETS_DIRECTORY_NAME = 'builder-provider-secrets-v1';
const SESSION_DATA_DIRECTORY_NAME = 'session-data';
const DEFAULT_EXECUTABLE = path.join(__dirname, '..', 'release', 'win-unpacked', 'ClawFabric Builder.exe');
const CANARY_PLAN_PROPOSAL_TIMEOUT_MS = 120_000;
const CANARY_PLAN_SOURCE_READ_APPROVAL_TIMEOUT_MS = 5_000;
const CANARY_PROJECT_READY_TIMEOUT_MS = 15_000;
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
  historyPreview: '[data-builder-history-preview="true"]',
  idea: '#builder-idea',
  liveOutput: '[data-builder-live-output="true"]',
  newProjectPanel: '[data-builder-new-project-panel="true"]',
  approvePlan: '[data-builder-approve-plan="true"]',
  approvePlanSourceRead: '[data-builder-approve-plan-source-read="true"]',
  planApproved: '[data-builder-activity-card="Plan approved"]',
  planProposed: '[data-builder-activity-card="Plan proposed"]',
  planReviewActions: '[data-builder-plan-review-actions="true"]',
  planSourceReadApproval: '[data-builder-plan-source-read-approval="true"]',
  questionAnswer: '[data-builder-activity-card="Assistant"]',
  toolActivityRequested: '[data-builder-tool-activity="requested"]',
  toolActivitySucceeded: '[data-builder-tool-activity="succeeded"]',
  userMessage: '[data-builder-activity-card="You"]',
  versionSavedActivity: '[data-builder-activity-card="Version saved"]',
  versionHistory: '[data-builder-version-history="true"]',
  workspaceChip: '[data-builder-workspace-chip="true"]',
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
  reviewActions: '[data-builder-review-actions="true"]',
  reviewCheckpoint: '[data-builder-review-checkpoint="true"]',
  reviewCopy: '[data-builder-review-copy="true"]',
  reviewNote: '[data-builder-review-note="true"]',
  discardDraft: '[data-builder-discard-draft="true"]',
  reviewOpenChanges: '[data-builder-review-open-changes="true"]',
  reviewSummary: '[data-builder-review-summary="true"]',
  reviewTitle: '[data-builder-review-title="true"]',
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
  canary_history_failed: 'Packaged canary history evidence failed.',
  canary_history_navigation_failed: 'Packaged canary history navigation failed.',
  canary_history_preview_failed: 'Packaged canary history preview evidence failed.',
  canary_history_current_failed: 'Packaged canary history changed current evidence.',
  canary_history_return_failed: 'Packaged canary could not return to the current version.',
  canary_preview_failed: 'Packaged canary preview evidence failed.',
  canary_version_failed: 'Packaged canary revision version evidence failed.',
  canary_read_evidence_failed: 'Packaged canary read evidence failed.',
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
  canary_history_failed: 'history',
  canary_history_navigation_failed: 'history_navigation',
  canary_history_preview_failed: 'history_preview',
  canary_history_current_failed: 'history_current',
  canary_history_return_failed: 'history_return',
  canary_preview_failed: 'preview',
  canary_version_failed: 'version',
  canary_read_evidence_failed: 'read_evidence',
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
const BRIDGE_CONTRACT_KEYS = Object.freeze([
  'bridge_version',
  'legacy_namespaces_absent',
  'plan_review_namespace',
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
const TASK_STREAM_AUTHORITY_KEYS = Object.freeze([
  'candidate_source',
  'conversation',
  'project_revision',
  'project_source',
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
  constructor(code = 'canary_evidence_failed') {
    const selected = Object.hasOwn(ERROR_MESSAGES, code) ? code : 'canary_evidence_failed';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderPackagedCanaryError';
    this.code = selected;
    this.stage = ERROR_STAGES[selected];
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) {
  throw new BuilderPackagedCanaryError(code);
}

function fixedError(source, fallback = 'canary_evidence_failed') {
  let code = fallback;
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
    }
  } catch {
    code = fallback;
  }
  return new BuilderPackagedCanaryError(code);
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
  if (!/^https:\/\/[^\s/$.?#].[^\s]*$/iu.test(baseUrl)) fail('canary_input_invalid');
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
  if (outcome === 'alert') fail('canary_generation_terminal_failed');
  fail('canary_preview_failed');
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

async function diagnosePlanTaskStream(page, projectId) {
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
    return planStreamFailureCode(summary);
  } catch {
    return null;
  }
}

async function diagnosePlanAlert(page, projectId = null) {
  const streamCode = await diagnosePlanTaskStream(page, projectId);
  if (streamCode !== null) return streamCode;
  return 'canary_plan_alert_failed';
}

async function waitForPlanProposalVisible(page, projectId = null) {
  const plan = page.locator(SELECTORS.planReviewActions)
    .waitFor({ state: 'visible', timeout: CANARY_PLAN_PROPOSAL_TIMEOUT_MS })
    .then(() => 'plan', () => 'plan_timeout');
  const failed = page.locator(`${SELECTORS.projectPage}[data-builder-project-status="submit_failed"]`)
    .waitFor({ state: 'visible', timeout: CANARY_PLAN_PROPOSAL_TIMEOUT_MS })
    .then(() => 'failed', () => 'failure_timeout');
  const outcome = await Promise.race([plan, failed]);
  if (outcome === 'plan') return;
  if (outcome === 'failed') fail(await diagnosePlanAlert(page, projectId));
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
    if (
      typeof pickerText !== 'string'
      || !pickerText.includes('Choose or create a project before I build.')
      || !pickerText.includes('New project')
      || preservedBeforeBinding !== idea
      || REVIEW_DIFF_INTERNAL_EVIDENCE_PATTERN.test(pickerText)
    ) fail('canary_build_workspace_required_failed');

    await page.locator(SELECTORS.workspaceNewProject).click();
    await page.locator(SELECTORS.newProjectPanel).waitFor({ state: 'visible' });
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
    await page.locator(SELECTORS.saveVersion).waitFor({ state: 'visible' });
    draftReviewDiff = await inspectDraftReviewDiffViaUi(page);
    const preSave = await readSanitizedBridgeEvidence(page);
    if (preSave.catalog.projects.length !== 0 || preSave.current !== null) {
      fail('canary_draft_failed');
    }
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError) throw error;
    fail('canary_draft_failed');
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
    live_output: liveOutput,
    pre_save_catalog_empty: true,
    review_diff: draftReviewDiff,
    saved_via_ui: true,
    unsaved_draft_observed: true,
    workspace_gate: workspaceGate,
  });
}

async function boundedBox(locator) {
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
  ) fail('canary_review_diff_failed');
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

async function assertConversationActivityBeforeReviewViaUi(page, review) {
  await page.locator(SELECTORS.conversationActivity).waitFor({ state: 'visible' });
  const latestUserMessage = page.locator(SELECTORS.userMessage).last();
  await latestUserMessage.waitFor({ state: 'visible' });
  const activity = await boundedBox(page.locator(SELECTORS.conversationActivity));
  const userMessage = await boundedBox(latestUserMessage);
  if (
    activity.width < 560
    || userMessage.width < 88
    || activity.y > review.y + 1
    || userMessage.y > review.y + 1
    || boxBottom(activity) > review.y + 1
    || boxBottom(userMessage) > review.y + 1
    || boxesOverlap(activity, review)
    || boxesOverlap(userMessage, review)
  ) fail('canary_review_diff_failed');
}

async function assertDraftReviewLayoutViaUi(page) {
  const review = await boundedBox(page.locator(SELECTORS.reviewCheckpoint));
  const copy = await boundedBox(page.locator(SELECTORS.reviewCopy));
  const title = await boundedBox(page.locator(SELECTORS.reviewTitle));
  const summary = await boundedBox(page.locator(SELECTORS.reviewSummary));
  const note = await boundedBox(page.locator(SELECTORS.reviewNote));
  const actionGroup = await boundedBox(page.locator(SELECTORS.reviewActions));
  const actions = [
    await boundedBox(page.locator(SELECTORS.reviewOpenChanges)),
    await boundedBox(page.locator(SELECTORS.discardDraft)),
    await boundedBox(page.locator(SELECTORS.saveVersion)),
  ];
  const reviewChildren = [copy, title, summary, note, actionGroup, ...actions];
  if (
    review.width < 560
    || review.height < 96
    || review.height > 280
    || copy.width < 320
    || title.height < 12
    || summary.height < 12
    || note.height < 12
    || actionGroup.height < 28
    || actionGroup.height > 96
    || boxBottom(title) > summary.y + 1
    || boxBottom(summary) > note.y + 1
    || actionGroup.y < boxBottom(note) + 4
    || boxesOverlap(title, summary)
    || boxesOverlap(summary, note)
    || boxesOverlap(note, actionGroup)
  ) fail('canary_review_diff_failed');
  for (const child of reviewChildren) {
    if (!boxContains(review, child)) fail('canary_review_diff_failed');
  }
  for (const action of actions) {
    if (
      action.width < 88
      || action.height < 28
      || action.height > 48
      || action.width / action.height < 2
      || !boxContains(actionGroup, action)
    ) fail('canary_review_diff_failed');
  }
  for (let outer = 0; outer < actions.length; outer += 1) {
    for (let inner = outer + 1; inner < actions.length; inner += 1) {
      if (boxesOverlap(actions[outer], actions[inner])) fail('canary_review_diff_failed');
    }
  }
  return review;
}

async function assertChangesPanelLayoutViaUi(page, review) {
  const flow = await boundedBox(page.locator(SELECTORS.changesFlow));
  const panel = await boundedBox(page.locator(SELECTORS.changesPanel));
  const card = await boundedBox(page.locator(SELECTORS.changeCard).first());
  const diff = await boundedBox(page.locator(SELECTORS.changeDiff).first());

  if (
    flow.width < 560
    || panel.width < 560
    || flow.height < 80
    || panel.height < 80
    || flow.y < boxBottom(review) - 1
    || boxesOverlap(review, flow)
    || boxesOverlap(review, panel)
    || !boxContains(flow, panel)
    || !boxContains(panel, card)
    || !boxContains(card, diff)
    || diff.height < 24
  ) fail('canary_review_diff_failed');
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
    ) fail('canary_review_diff_failed');

    const reviewBox = await assertDraftReviewLayoutViaUi(page);
    await assertConversationActivityBeforeReviewViaUi(page, reviewBox);
    await page.locator(SELECTORS.reviewOpenChanges).waitFor({ state: 'visible' });
    await page.locator(SELECTORS.reviewOpenChanges).click();
    await page.locator(SELECTORS.changesPanel).waitFor({ state: 'visible' });
    await page.locator(SELECTORS.changeCard).first().waitFor({ state: 'visible' });
    await page.locator(SELECTORS.changeDiff).first().waitFor({ state: 'visible' });
    await page.locator(SELECTORS.changeDiffLine).first().waitFor({ state: 'visible' });
    await assertChangesPanelLayoutViaUi(page, reviewBox);
    const summaryText = await page.locator(SELECTORS.changesSummary).textContent();
    const changesText = await page.locator(SELECTORS.changesPanel).textContent();
    if (
      typeof summaryText !== 'string'
      || typeof changesText !== 'string'
      || !summaryText.includes('file')
      || !changesText.includes('line')
      || changesText.includes('No unsaved changes')
      || REVIEW_DIFF_INTERNAL_EVIDENCE_PATTERN.test(changesText)
    ) fail('canary_review_diff_failed');
    return Object.freeze({
      activity_review_do_not_overlap: true,
      changes_diff_nested_in_panel: true,
      changes_panel_follows_review: true,
      changes_panel_visible: true,
      inline_diff_visible: true,
      internal_evidence_hidden: true,
      review_actions_layout_stable: true,
      review_changes_do_not_overlap: true,
      review_checkpoint_visible: true,
      review_internal_layout_stable: true,
    });
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError) throw error;
    fail('canary_review_diff_failed');
  }
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

async function askProjectQuestionViaUi(
  page,
  currentProject,
  question = CANARY_QUESTION,
  expectedCandidateTurns = currentProject.revision_number,
  expectedQuestionTurns = 1,
) {
  try {
    await page.locator(SELECTORS.idea).fill(question);
    await clickByRole(page, 'button', 'Send');
    const answer = page.locator(SELECTORS.questionAnswer).waitFor({ state: 'visible' })
      .then(() => 'answer', () => 'answer_timeout');
    const alert = page.getByRole('alert').waitFor({ state: 'visible' })
      .then(() => 'alert', () => 'alert_unavailable');
    const outcome = await Promise.race([answer, alert]);
    if (outcome !== 'answer') fail('canary_question_failed');
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError) throw error;
    fail('canary_question_failed');
  }
  try {
    await page.locator(SELECTORS.saveVersion).waitFor({ state: 'hidden' });
    const evidence = await readSanitizedBridgeEvidence(page, currentProject.project_id);
    assertExactRevision(evidence, currentProject);
    return Object.freeze({
      saved_revision_unchanged: true,
      task_stream: assertTaskStreamExplanationFacts(
        evidence,
        currentProject,
        expectedCandidateTurns,
        expectedQuestionTurns,
      ),
      ui_answer_observed: true,
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
) {
  let draftReviewDiff = null;
  let liveOutput = null;
  try {
    await page.locator(SELECTORS.idea).fill(instruction);
    await clickByRole(page, 'button', 'Send');
    liveOutput = await captureGenerationLiveOutputViaUi(page, 'canary_update_generation_terminal_failed');
    await waitForGenerationTerminal(page);
  } catch {
    fail('canary_update_generation_terminal_failed');
  }
  try {
    await page.locator(SELECTORS.unsavedDraft)
      .getByText('Unsaved draft', { exact: true })
      .waitFor({ state: 'visible' });
    await page.locator(SELECTORS.saveVersion).waitFor({ state: 'visible' });
    draftReviewDiff = await inspectDraftReviewDiffViaUi(page);
    const preSave = await readSanitizedBridgeEvidence(page, currentProject.project_id);
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
) {
  try {
    await page.locator(SELECTORS.idea).fill(instruction);
    await clickByRole(page, 'button', 'Plan first');
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError) throw error;
    fail('canary_plan_failed');
  }

  try {
    await approvePlanSourceReadIfRequested(page);
    await waitForPlanProposalVisible(page, currentProject.project_id);
    await page.locator(SELECTORS.planProposed).waitFor({ state: 'visible' });
    await page.locator(SELECTORS.approvePlan).waitFor({ state: 'visible' });
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

async function approvePlanViaUi(
  page,
  currentProject,
  expectedCandidateTurns,
  expectedQuestionTurns = 0,
  expectedPlanTurns = 1,
) {
  let draftReviewDiff = null;
  try {
    await clickByRole(page, 'button', 'Approve plan');
    await page.locator(SELECTORS.planApproved).waitFor({ state: 'visible' });
    const draftReady = page.locator(SELECTORS.unsavedDraft)
      .getByText('Unsaved draft', { exact: true })
      .waitFor({ state: 'visible', timeout: CANARY_PLAN_PROPOSAL_TIMEOUT_MS })
      .then(() => 'draft_ready', () => 'draft_timeout');
    const alert = page.getByRole('alert')
      .waitFor({ state: 'visible', timeout: CANARY_PLAN_PROPOSAL_TIMEOUT_MS })
      .then(() => 'alert', () => 'alert_timeout');
    const outcome = await Promise.race([draftReady, alert]);
    if (outcome !== 'draft_ready') fail('canary_plan_review_failed');
    await page.locator(SELECTORS.saveVersion).waitFor({ state: 'visible' });
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
      previous_revision_verified_before_save: true,
      review_diff: draftReviewDiff,
      unsaved_draft_observed: true,
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
) {
  const historicalVersion = historicalRevision.revision_number;
  const currentVersion = currentRevision.revision_number;
  try {
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
      1,
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
    fail('canary_pending_draft_restart_failed');
  }
}

async function readOnlyBridgeEvidence(page, projectId = null) {
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
      const bridge_contract = {
        bridge_version: bridge.bridgeVersion,
        legacy_namespaces_absent: !Object.hasOwn(bridge, 'projectCatalog')
          && !Object.hasOwn(bridge, 'projectRevisions'),
        plan_review_namespace: planReviewKeys.length === 1
          && planReviewKeys[0] === 'review'
          && reviewDescriptor !== null
          && reviewDescriptor.enumerable === true
          && Object.hasOwn(reviewDescriptor, 'value')
          && typeof reviewDescriptor.value === 'function'
          ? 'review_method_only'
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
    fail('canary_read_evidence_failed');
  }
}

async function readSanitizedBridgeEvidence(page, projectId = null) {
  try {
    return assertReadEvidence(await readOnlyBridgeEvidence(page, projectId));
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError && error.code === 'canary_read_evidence_failed') {
      throw error;
    }
    fail('canary_read_evidence_failed');
  }
}

function assertReadEvidence(value) {
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
    bridgeContractDescriptors.bridge_version.value !== 'builder-preload.v17'
    || bridgeContractDescriptors.legacy_namespaces_absent.value !== true
    || bridgeContractDescriptors.plan_review_namespace.value !== 'review_method_only'
  ) fail('canary_evidence_failed');
  const bridgeContract = Object.freeze({
    bridge_version: 'builder-preload.v17',
    legacy_namespaces_absent: true,
    plan_review_namespace: 'review_method_only',
  });
  const status = sanitizeStatus(evidenceDescriptors.status.value);
  const catalog = sanitizeCatalog(evidenceDescriptors.catalog.value);
  const current = evidenceDescriptors.current.value === null
    ? null
    : sanitizeCurrent(evidenceDescriptors.current.value);
  const taskStream = evidenceDescriptors.task_stream.value === null
    ? null
    : sanitizeTaskStream(
      evidenceDescriptors.task_stream.value,
      current === null ? null : current.product_revision_receipt.project_id,
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

function sanitizeTaskStream(value, expectedProjectId) {
  const descriptors = exactDataObject(value, TASK_STREAM_KEYS);
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
  return Object.freeze({
    authority: Object.freeze({
      candidate_source: 'not_loaded',
      conversation: 'sqlite_canonical_event_replay_or_absent',
      project_revision: 'not_inferred',
      project_source: 'not_included',
    }),
    conversation,
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
  if (messageKind !== 'submitted' && messageKind !== 'steering') fail('canary_evidence_failed');
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
  if (
    !['succeeded', 'failed', 'interrupted', 'cancelled'].includes(terminalStatus)
    || !['explanation', 'plan', 'candidate', 'failure'].includes(resultKind)
    || ((terminalStatus === 'succeeded') !== (resultKind !== 'failure'))
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
  } else if (itemKind === 'run_started') {
    source = exactTaskStreamValues(value, TASK_STREAM_RUN_STARTED_KEYS);
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
  if (itemKind === 'run_started') return sanitizeTaskStreamRunStarted(source, sequence);
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
    run_completed_count: 0,
    run_progress_count: 0,
    run_started_count: 0,
    tool_request_count: 0,
    tool_result_count: 0,
    tool_result_cancelled_count: 0,
    tool_result_failed_count: 0,
    tool_result_succeeded_count: 0,
    turn_completed_count: 0,
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
  const progressStageByRunId = new Map();
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
        counts.steering_message_count += 1;
        const activeRun = activeRunByTurnId.get(item.turn_id) ?? null;
        if (activeRun === null || activeRun.sequence >= item.sequence) fail('canary_evidence_failed');
      }
    }
    if (item.item_kind === 'run_started') {
      counts.run_started_count += 1;
      if (runStartedByRunId.has(item.run_id) || activeRunByTurnId.has(item.turn_id)) {
        fail('canary_evidence_failed');
      }
      runStartedByRunId.set(item.run_id, item);
      activeRunByTurnId.set(item.turn_id, item);
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
  const expectedUserMessageCount = expectedTurnCount + counts.steering_message_count;
  const expectedItemCount = expectedBaseItemCount
    + counts.steering_message_count
    + counts.run_progress_count
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
    || counts.run_progress_count > expectedTurnCount * TASK_STREAM_RUN_PROGRESS_STAGES.length
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
    plan_result_count: counts.plan_result_count,
    plan_reviewed_count: counts.plan_reviewed_count,
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
    plan_ready_count: counts.plan_ready_count,
    plan_result_count: counts.plan_result_count,
    plan_reviewed_count: counts.plan_reviewed_count,
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

async function capturePreviewEvidence(page, gate) {
  try {
    gate.assertAllowed();
    const unavailable = page.locator(SELECTORS.previewUnavailable);
    const unavailableCount = await unavailable.count();
    if (unavailableCount > 0) {
      await unavailable.waitFor({ state: 'visible' });
      const unavailableText = await unavailable.textContent();
      if (
        typeof unavailableText !== 'string'
        || !unavailableText.includes('Preview unavailable')
        || !unavailableText.includes('The files were generated')
        || !unavailableText.includes('live preview support')
        || !unavailableText.includes('Review')
        || !/(?:3D|WebGL|JavaScript modules|canvas|backend|live preview)/iu.test(unavailableText)
        || REVIEW_DIFF_INTERNAL_EVIDENCE_PATTERN.test(unavailableText)
      ) fail('canary_preview_failed');
      const screenshot = await unavailable.screenshot();
      return Object.freeze({
        ...summarizePng(screenshot),
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
    await section.waitFor({ state: 'visible' });
    const limitation = page.locator(SELECTORS.previewLimitation);
    await limitation.waitFor({ state: 'visible' });
    const limitationText = await limitation.textContent();
    const runtimeBlocked = await page.locator(SELECTORS.previewRuntimeBlocked).count();
    if (runtimeBlocked > 0) {
      if (
        typeof limitationText !== 'string'
        || !limitationText.includes('Preview unavailable here')
        || !limitationText.includes('The files were generated')
        || !limitationText.includes('live preview support')
        || !limitationText.includes('Review Changes or Source before saving')
        || !/(?:3D|WebGL|JavaScript modules|canvas|live preview)/iu.test(limitationText)
        || REVIEW_DIFF_INTERNAL_EVIDENCE_PATTERN.test(limitationText)
      ) fail('canary_preview_failed');
      const screenshot = await section.screenshot();
      return Object.freeze({
        ...summarizePng(screenshot),
        frame_body_nonempty: false,
        preview_mode: 'runtime_unavailable',
        runtime_preview_limit_explained: true,
        sandbox: 'not_mounted',
        script_src: 'none',
        srcdoc_digest: digestText(limitationText),
        static_preview_limitation_visible: true,
      });
    }
    if (
      typeof limitationText !== 'string'
      || !limitationText.includes('Static preview')
      || !limitationText.includes('The files were generated')
      || !limitationText.includes('visible HTML/CSS is shown here')
      || !limitationText.includes('Interactive JavaScript is disabled')
      || !limitationText.includes('live preview support')
      || limitationText.includes('Preview may look blank')
      || REVIEW_DIFF_INTERNAL_EVIDENCE_PATTERN.test(limitationText)
    ) fail('canary_preview_failed');
    const frame = page.locator(SELECTORS.previewFrame);
    await frame.waitFor({ state: 'visible' });
    const sandbox = await frame.getAttribute('sandbox');
    const srcdoc = await frame.getAttribute('srcdoc');
    if (
      sandbox !== ''
      || typeof srcdoc !== 'string'
      || !/Content-Security-Policy/iu.test(srcdoc)
      || !/script-src 'none'/iu.test(srcdoc)
    ) fail('canary_preview_failed');
    const body = frame.contentFrame().locator('body');
    const bodyText = await body.innerText();
    if (typeof bodyText !== 'string' || bodyText.trim().length === 0) fail('canary_preview_failed');
    const screenshot = await frame.screenshot();
    return Object.freeze({
      ...summarizePng(screenshot),
      frame_body_nonempty: true,
      preview_mode: 'static_frame',
      sandbox: 'empty',
      script_src: 'none',
      static_preview_limitation_visible: true,
      runtime_preview_limit_explained: true,
      srcdoc_digest: digestText(srcdoc),
    });
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError
      && error.code === 'canary_secret_source_invalid') throw error;
    fail('canary_preview_failed');
  }
}

function samePreviewEvidence(left, right) {
  return left.preview_mode === right.preview_mode && left.srcdoc_digest === right.srcdoc_digest;
}

function staticPreviewSrcdocChanged(left, right) {
  if (left.preview_mode !== 'static_frame' || right.preview_mode !== 'static_frame') return true;
  return left.srcdoc_digest !== right.srcdoc_digest;
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
      await readSanitizedBridgeEvidence(page);
      gate.allow();
    }
    const initialDraft = await generateProjectViaUi(page, input.idea);
    const initialSavedActivity = await captureSavedActivityEvidence(page, 1);
    const initialEvidence = await readSanitizedBridgeEvidence(page);
    const initialProject = projectFromReadEvidence(initialEvidence, 1);
    const initialCurrentEvidence = await readSanitizedBridgeEvidence(page, initialProject.project_id);
    const initialRevision = exactRevisionFromReadEvidence(initialCurrentEvidence, initialProject);
    const initialTaskStream = assertTaskStreamCandidateFacts(initialCurrentEvidence, initialRevision, 1);
    const initialPreviewEvidence = await capturePreviewEvidence(page, gate);
    const question = await askProjectQuestionViaUi(page, initialRevision, CANARY_QUESTION, 1, 1);
    const pendingUpdateDraft = await createUpdateDraftViaUi(
      page,
      initialRevision,
      CANARY_UPDATE_INSTRUCTION,
      1,
    );
    const pendingUpdateEvidence = await readSanitizedBridgeEvidence(page, initialProject.project_id);
    const pendingUpdateProject = projectFromReadEvidence(pendingUpdateEvidence, 1);
    if (!sameCatalogProjectRevision(pendingUpdateProject, initialProject)) fail('canary_evidence_failed');
    const pendingUpdateTaskStream = assertTaskStreamPendingCandidateFacts(pendingUpdateEvidence, initialRevision, 2, 1);
    const pendingUpdatePreviewEvidence = await capturePreviewEvidence(page, gate);
    if (!staticPreviewSrcdocChanged(pendingUpdatePreviewEvidence, initialPreviewEvidence)) {
      fail('canary_preview_failed');
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
    await openProjectFromCatalogById(pendingRestartPage, initialRevision, 'canary_restart_open_failed');
    const pendingRestart = await readPendingUpdateDraftRestoreEvidence(pendingRestartPage, initialRevision, 2, 1);
    const pendingRestartProject = projectFromReadEvidence(pendingRestart.evidence, 1);
    if (!sameCatalogProjectRevision(pendingRestartProject, initialProject)) {
      fail('canary_pending_draft_restart_failed');
    }
    const pendingRestartTaskStreamUnchanged = (
      digestCanonical(pendingRestart.task_stream) === digestCanonical(pendingUpdateTaskStream)
    );
    if (!pendingRestartTaskStreamUnchanged) fail('canary_pending_draft_restart_failed');
    const pendingRestartPreviewEvidence = await capturePreviewEvidence(pendingRestartPage, gate);
    if (!samePreviewEvidence(pendingRestartPreviewEvidence, pendingUpdatePreviewEvidence)) {
      fail('canary_pending_draft_restart_failed');
    }
    const updateDraft = Object.freeze({
      ...pendingUpdateDraft,
      ...(await saveUpdateDraftViaUi(pendingRestartPage, initialRevision)),
    });
    const updatedSavedActivity = await captureSavedActivityEvidence(pendingRestartPage, 2);
    const updatedEvidence = await readSanitizedBridgeEvidence(pendingRestartPage);
    const updatedProject = projectFromReadEvidence(updatedEvidence, 2);
    const updatedCurrentEvidence = await readSanitizedBridgeEvidence(pendingRestartPage, updatedProject.project_id);
    const updatedRevision = exactRevisionFromReadEvidence(updatedCurrentEvidence, updatedProject);
    assertRevisionAdvance(initialRevision, updatedRevision);
    const updatedTaskStream = assertTaskStreamCandidateFacts(updatedCurrentEvidence, updatedRevision, 2, 1);
    const updatedPreviewEvidence = await capturePreviewEvidence(pendingRestartPage, gate);
    if (!staticPreviewSrcdocChanged(updatedPreviewEvidence, initialPreviewEvidence)) {
      fail('canary_preview_failed');
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
    try {
      await restartedPage.locator(SELECTORS.preview).waitFor({ state: 'visible' });
    } catch (error) {
      if (error instanceof BuilderPackagedCanaryError) throw error;
      fail('canary_restart_preview_failed');
    }
    const restartProject = projectFromReadEvidence(restartEvidence, 2);
    const restartTaskStream = assertTaskStreamCandidateFacts(restartEvidence, updatedRevision, 2, 1);
    const restartPreviewEvidence = await capturePreviewEvidence(restartedPage, gate);
    const history = await inspectHistoryVersionViaUi(
      restartedPage,
      initialRevision,
      updatedRevision,
      initialPreviewEvidence,
      restartPreviewEvidence,
      restartTaskStream,
      gate,
    );
    const network = recorder.snapshot();
    if (network.renderer_unexpected_network_count !== 0) fail('canary_evidence_failed');
    const restartRevisionUnchanged = (
      restartEvidence.catalog.projects.length === updatedEvidence.catalog.projects.length
      && restartProject.project_id === updatedProject.project_id
      && restartProject.revision_number === updatedProject.revision_number
      && restartProject.revision_receipt_digest === updatedProject.revision_receipt_digest
      && restartProject.commit_oid === updatedProject.commit_oid
      && restartProject.tree_oid === updatedProject.tree_oid
      && samePreviewEvidence(restartPreviewEvidence, updatedPreviewEvidence)
    );
    if (!restartRevisionUnchanged) fail('canary_evidence_failed');
    const restartTaskStreamUnchanged = digestCanonical(restartTaskStream) === digestCanonical(updatedTaskStream);
    if (!restartTaskStreamUnchanged) fail('canary_evidence_failed');
    const restartContinuationPlan = await proposePlanViaUi(
      restartedPage,
      updatedRevision,
      CANARY_RESTART_CONTINUATION_INSTRUCTION,
      2,
      1,
      1,
    );
    const planProposalProject = projectFromReadEvidence(
      await readSanitizedBridgeEvidence(restartedPage, updatedProject.project_id),
      2,
    );
    if (!sameCatalogProjectRevision(planProposalProject, updatedProject)) {
      fail('canary_evidence_failed');
    }
    const restartContinuationDraft = await approvePlanViaUi(
      restartedPage,
      updatedRevision,
      3,
      1,
      1,
    );
    const restartContinuationEvidence = await readSanitizedBridgeEvidence(restartedPage, updatedProject.project_id);
    const restartContinuationProject = projectFromReadEvidence(restartContinuationEvidence, 2);
    if (!sameCatalogProjectRevision(restartContinuationProject, updatedProject)) {
      fail('canary_evidence_failed');
    }
    assertExactRevision(restartContinuationEvidence, updatedProject);
    const restartContinuationTaskStream = assertTaskStreamPendingCandidateFacts(
      restartContinuationEvidence,
      updatedRevision,
      3,
      1,
      {
        approvedPlanReviews: 1,
        planTurns: 1,
        requireToolActivity: true,
      },
    );
    const restartContinuationPreviewEvidence = await capturePreviewEvidence(restartedPage, gate);
    if (!staticPreviewSrcdocChanged(restartContinuationPreviewEvidence, restartPreviewEvidence)) {
      fail('canary_preview_failed');
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
        after_initial_save: question,
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
        question: question.task_stream,
        pending_update: pendingUpdateTaskStream,
        pending_update_restart: pendingRestart.task_stream,
        updated: updatedTaskStream,
        restart: restartTaskStream,
        restart_continuation: restartContinuationTaskStream,
        pending_update_advanced_candidate_count: pendingUpdateTaskStream.candidate_ready_count
          === initialTaskStream.candidate_ready_count + 1,
        question_did_not_advance_candidate_count: question.task_stream.candidate_ready_count
          === initialTaskStream.candidate_ready_count,
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
  approvePlanSourceReadIfRequested,
  approvePlanViaUi,
  askProjectQuestionViaUi,
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
    })}\n`);
    process.exitCode = 1;
  });
}
