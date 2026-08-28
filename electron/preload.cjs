'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const OPEN_PROJECT_CHANNEL = 'clawfabric-builder:project-workspace:open';
const OPEN_PROJECT_LOCATION_CHANNEL = 'clawfabric-builder:project-workspace:open-location';
const CREATE_LOCAL_PROJECT_CHANNEL = 'clawfabric-builder:project-workspace:create-local';
const SAVE_DRAFT_CHANNEL = 'clawfabric-builder:project-workspace:save-draft';
const LOAD_CURRENT_CHANNEL = 'clawfabric-builder:project-workspace:load-current';
const LOAD_REVISION_CHANNEL = 'clawfabric-builder:project-workspace:load-revision';
const LIST_CURRENT_CHANNEL = 'clawfabric-builder:project-workspace:list-current';
const LIST_WORKSPACES_CHANNEL = 'clawfabric-builder:project-workspace:list-workspaces';
const LIST_HISTORY_CHANNEL = 'clawfabric-builder:project-workspace:list-history';
const GENERATE_CHANNEL = 'clawfabric-builder:code-generator:generate';
const CONTINUE_DRAFT_CHANNEL = 'clawfabric-builder:code-generator:continue-draft';
const GENERATE_APPROVED_PLAN_CHANNEL = 'clawfabric-builder:code-generator:generate-approved-plan';
const PROPOSE_PLAN_CHANNEL = 'clawfabric-builder:code-generator:propose-plan';
const PREPARE_PLAN_SOURCE_READ_APPROVAL_CHANNEL =
  'clawfabric-builder:code-generator:prepare-plan-source-read-approval';
const APPROVE_PLAN_SOURCE_READ_CHANNEL =
  'clawfabric-builder:code-generator:approve-plan-source-read';
const PREPARE_CURRENT_PROJECT_WRITE_APPROVAL_CHANNEL =
  'clawfabric-builder:code-generator:prepare-current-project-write-approval';
const APPROVE_CURRENT_PROJECT_WRITE_CHANNEL =
  'clawfabric-builder:code-generator:approve-current-project-write';
const SUBMIT_CHANNEL = 'clawfabric-builder:code-generator:submit';
const CLASSIFY_INTENT_CHANNEL = 'clawfabric-builder:code-generator:classify-intent';
const GENERATION_STARTED_CHANNEL = 'clawfabric-builder:code-generator:started';
const GENERATION_OUTPUT_CHANNEL = 'clawfabric-builder:code-generator:output';
const COMMAND_APPROVAL_REQUESTED_CHANNEL =
  'clawfabric-builder:code-generator:command-approval-requested';
const COMMAND_OUTPUT_CHANNEL = 'clawfabric-builder:code-generator:command-output';
const DECIDE_COMMAND_APPROVAL_CHANNEL =
  'clawfabric-builder:code-generator:decide-command-approval';
const RETRY_GENERATE_CHANNEL = 'clawfabric-builder:code-generator:retry';
const ANSWER_CHANNEL = 'clawfabric-builder:code-generator:answer';
const ANSWER_PLAN_CHANNEL = 'clawfabric-builder:code-generator:answer-plan';
const ANSWER_DRAFT_CHANNEL = 'clawfabric-builder:code-generator:answer-draft';
const CANCEL_CHANNEL = 'clawfabric-builder:code-generator:cancel';
const STEER_CHANNEL = 'clawfabric-builder:code-generator:steer';
const QUEUE_FOLLOWUP_CHANNEL = 'clawfabric-builder:code-generator:queue-followup';
const AVAILABILITY_CHANNEL = 'clawfabric-builder:code-generator:availability';
const RESTORE_DRAFT_CHANNEL = 'clawfabric-builder:code-generator:restore-draft';
const RESTORE_REVISION_AS_DRAFT_CHANNEL =
  'clawfabric-builder:code-generator:restore-revision-as-draft';
const RESTORE_PREVIOUS_CHECKPOINT_AS_DRAFT_CHANNEL =
  'clawfabric-builder:code-generator:restore-previous-checkpoint-as-draft';
const REJECT_DRAFT_CHANNEL = 'clawfabric-builder:code-generator:reject-draft';
const READ_PROVIDER_SETTINGS_CHANNEL = 'clawfabric-builder:provider-settings:read-current';
const REPLACE_PROVIDER_SETTINGS_CHANNEL = 'clawfabric-builder:provider-settings:replace-current';
const PROVIDER_SETTINGS_STATUS_CHANNEL = 'clawfabric-builder:provider-settings:status';
const READ_TASK_STREAM_CHANNEL = 'clawfabric-builder:task-stream:read';
const TASK_STREAM_CHANGED_CHANNEL = 'clawfabric-builder:task-stream:changed';
const READ_AGENT_PROJECT_TREE_CHANNEL = 'clawfabric-builder:agent-project-tree:read';
const RENAME_AGENT_PROJECT_CHANNEL = 'clawfabric-builder:agent-project-tree:rename-project';
const ARCHIVE_AGENT_PROJECT_CHANNEL = 'clawfabric-builder:agent-project-tree:archive-project';
const RENAME_AGENT_TASK_CHANNEL = 'clawfabric-builder:agent-project-tree:rename-task';
const ARCHIVE_AGENT_TASK_CHANNEL = 'clawfabric-builder:agent-project-tree:archive-task';
const READ_AGENT_WORKBENCH_CHANNEL = 'clawfabric-builder:agent-workbench:read';
const UPDATE_WORKBENCH_MESSAGE_STATE_CHANNEL =
  'clawfabric-builder:agent-workbench:update-message-state';
const CREATE_WORKBENCH_TASK_PROPOSAL_CHANNEL =
  'clawfabric-builder:agent-workbench:create-task-proposal';
const DECIDE_WORKBENCH_TASK_PROPOSAL_CHANNEL =
  'clawfabric-builder:agent-workbench:decide-task-proposal';
const CONTROL_WORKBENCH_TASK_CHANNEL = 'clawfabric-builder:agent-workbench:control-task';
const WORKBENCH_CHANGED_CHANNEL = 'clawfabric-builder:agent-workbench:changed';
const REVIEW_PLAN_CHANNEL = 'clawfabric-builder:plan-review:review';
const EVALUATE_PERMISSION_CHANNEL = 'clawfabric-builder:permissions:evaluate';
const APPROVE_PROVIDER_CONTEXT_DISCLOSURE_CHANNEL =
  'clawfabric-builder:provider-context-disclosure:approve-current';
const READ_CURRENT_DRAFT_AVAILABLE_CHECKS_CHANNEL =
  'clawfabric-builder:check-run:read-current-draft-available';
const DIAGNOSE_CURRENT_DRAFT_CHECK_ENVIRONMENT_CHANNEL =
  'clawfabric-builder:check-run:diagnose-current-draft-check-environment';
const DIAGNOSE_PROJECT_ENVIRONMENT_CHANNEL =
  'clawfabric-builder:check-run:diagnose-project-environment';
const APPROVE_CURRENT_DRAFT_CHECK_CHANNEL =
  'clawfabric-builder:check-run:approve-current-draft-check';
const DECIDE_CURRENT_DRAFT_DEPENDENCY_PREPARATION_CHANNEL =
  'clawfabric-builder:check-run:decide-current-draft-dependency-preparation';
const SKIP_CURRENT_DRAFT_CHECK_CHANNEL =
  'clawfabric-builder:check-run:skip-current-draft-check';
const REQUEST_CURRENT_DRAFT_LIVE_PREVIEW_CHANNEL =
  'clawfabric-builder:live-preview:request-current-draft';
const RELOAD_CURRENT_LIVE_PREVIEW_CHANNEL =
  'clawfabric-builder:live-preview:reload-current';
const STOP_CURRENT_LIVE_PREVIEW_CHANNEL =
  'clawfabric-builder:live-preview:stop-current';
const READ_CURRENT_LIVE_PREVIEW_STATUS_CHANNEL =
  'clawfabric-builder:live-preview:read-current-status';
const UPDATE_CURRENT_LIVE_PREVIEW_LAYOUT_CHANNEL =
  'clawfabric-builder:live-preview:update-current-layout';
const DECIDE_DEV_SERVER_APPROVAL_CHANNEL =
  'clawfabric-builder:live-preview:decide-dev-server-approval';
const NAVIGATE_USER_WEB_CHANNEL = 'clawfabric-builder:user-web:navigate';
const GO_BACK_USER_WEB_CHANNEL = 'clawfabric-builder:user-web:go-back';
const GO_FORWARD_USER_WEB_CHANNEL = 'clawfabric-builder:user-web:go-forward';
const RELOAD_USER_WEB_CHANNEL = 'clawfabric-builder:user-web:reload';
const STOP_USER_WEB_CHANNEL = 'clawfabric-builder:user-web:stop';
const READ_USER_WEB_STATUS_CHANNEL = 'clawfabric-builder:user-web:read-status';
const UPDATE_USER_WEB_LAYOUT_CHANNEL = 'clawfabric-builder:user-web:update-layout';
const UPDATE_AGENT_TEST_BROWSER_LAYOUT_CHANNEL =
  'clawfabric-builder:agent-test-browser:update-layout';
const STOP_AGENT_TEST_BROWSER_CHANNEL = 'clawfabric-builder:agent-test-browser:stop';
const AGENT_TEST_BROWSER_LIFECYCLE_CHANNEL =
  'clawfabric-builder:agent-test-browser:lifecycle';
const READ_CURRENT_DRAFT_FILE_TREE_CHANNEL =
  'clawfabric-builder:side-workspace-files:read-current-draft-tree';
const READ_CURRENT_DRAFT_FILE_CONTENT_CHANNEL =
  'clawfabric-builder:side-workspace-files:read-current-draft-content';
const READ_RUNTIME_TOOL_FILE_TREE_CHANNEL =
  'clawfabric-builder:side-workspace-files:read-runtime-tool-tree';
const MINIMIZE_WINDOW_CHANNEL = 'clawfabric-builder:window-controls:minimize';
const TOGGLE_MAXIMIZE_WINDOW_CHANNEL = 'clawfabric-builder:window-controls:toggle-maximize';
const CLOSE_WINDOW_CHANNEL = 'clawfabric-builder:window-controls:close';
const READ_WINDOW_STATE_CHANNEL = 'clawfabric-builder:window-controls:read-state';

contextBridge.exposeInMainWorld('clawfabricBuilder', Object.freeze({
  bridgeVersion: 'builder-preload.v38',
  agentProjectTree: Object.freeze({
    read(request) {
      return ipcRenderer.invoke(READ_AGENT_PROJECT_TREE_CHANNEL, request);
    },
    renameProject(request) {
      return ipcRenderer.invoke(RENAME_AGENT_PROJECT_CHANNEL, request);
    },
    archiveProject(request) {
      return ipcRenderer.invoke(ARCHIVE_AGENT_PROJECT_CHANNEL, request);
    },
    renameTask(request) {
      return ipcRenderer.invoke(RENAME_AGENT_TASK_CHANNEL, request);
    },
    archiveTask(request) {
      return ipcRenderer.invoke(ARCHIVE_AGENT_TASK_CHANNEL, request);
    },
  }),
  agentWorkbench: Object.freeze({
    read(request) {
      return ipcRenderer.invoke(READ_AGENT_WORKBENCH_CHANNEL, request);
    },
    updateMessageState(request) {
      return ipcRenderer.invoke(UPDATE_WORKBENCH_MESSAGE_STATE_CHANNEL, request);
    },
    createTaskProposal(request) {
      return ipcRenderer.invoke(CREATE_WORKBENCH_TASK_PROPOSAL_CHANNEL, request);
    },
    decideTaskProposal(request) {
      return ipcRenderer.invoke(DECIDE_WORKBENCH_TASK_PROPOSAL_CHANNEL, request);
    },
    controlTask(request) {
      return ipcRenderer.invoke(CONTROL_WORKBENCH_TASK_CHANNEL, request);
    },
    subscribeChanged(listener) {
      if (typeof listener !== 'function') return () => undefined;
      const handler = (_event, payload) => listener(payload);
      ipcRenderer.on(WORKBENCH_CHANGED_CHANNEL, handler);
      return () => {
        ipcRenderer.removeListener(WORKBENCH_CHANGED_CHANNEL, handler);
      };
    },
  }),
  projectWorkspace: Object.freeze({
    open(request) {
      return ipcRenderer.invoke(OPEN_PROJECT_CHANNEL, request);
    },
    openLocation(request) {
      return ipcRenderer.invoke(OPEN_PROJECT_LOCATION_CHANNEL, request);
    },
    createLocalProject(request) {
      return ipcRenderer.invoke(CREATE_LOCAL_PROJECT_CHANNEL, request);
    },
    saveDraft(request) {
      return ipcRenderer.invoke(SAVE_DRAFT_CHANNEL, request);
    },
    loadCurrent(request) {
      return ipcRenderer.invoke(LOAD_CURRENT_CHANNEL, request);
    },
    loadRevision(request) {
      return ipcRenderer.invoke(LOAD_REVISION_CHANNEL, request);
    },
    listCurrent() {
      return ipcRenderer.invoke(LIST_CURRENT_CHANNEL);
    },
    listWorkspaces() {
      return ipcRenderer.invoke(LIST_WORKSPACES_CHANNEL);
    },
    listHistory(request) {
      return ipcRenderer.invoke(LIST_HISTORY_CHANNEL, request);
    },
  }),
  codeGenerator: Object.freeze({
    submit(request) {
      return ipcRenderer.invoke(SUBMIT_CHANNEL, request);
    },
    classifyIntent(request) {
      return ipcRenderer.invoke(CLASSIFY_INTENT_CHANNEL, request);
    },
    generate(request) {
      return ipcRenderer.invoke(GENERATE_CHANNEL, request);
    },
    continueDraft(request) {
      return ipcRenderer.invoke(CONTINUE_DRAFT_CHANNEL, request);
    },
    generateApprovedPlan(request) {
      return ipcRenderer.invoke(GENERATE_APPROVED_PLAN_CHANNEL, request);
    },
    proposePlan(request) {
      return ipcRenderer.invoke(PROPOSE_PLAN_CHANNEL, request);
    },
    preparePlanSourceReadApproval(request) {
      return ipcRenderer.invoke(PREPARE_PLAN_SOURCE_READ_APPROVAL_CHANNEL, request);
    },
    approvePlanSourceRead(request) {
      return ipcRenderer.invoke(APPROVE_PLAN_SOURCE_READ_CHANNEL, request);
    },
    prepareCurrentProjectWriteApproval(request) {
      return ipcRenderer.invoke(PREPARE_CURRENT_PROJECT_WRITE_APPROVAL_CHANNEL, request);
    },
    approveCurrentProjectWrite(request) {
      return ipcRenderer.invoke(APPROVE_CURRENT_PROJECT_WRITE_CHANNEL, request);
    },
    retry(request) {
      return ipcRenderer.invoke(RETRY_GENERATE_CHANNEL, request);
    },
    answer(request) {
      return ipcRenderer.invoke(ANSWER_CHANNEL, request);
    },
    answerPlan(request) {
      return ipcRenderer.invoke(ANSWER_PLAN_CHANNEL, request);
    },
    answerDraft(request) {
      return ipcRenderer.invoke(ANSWER_DRAFT_CHANNEL, request);
    },
    restoreDraft(request) {
      return ipcRenderer.invoke(RESTORE_DRAFT_CHANNEL, request);
    },
    restoreRevisionAsDraft(request) {
      return ipcRenderer.invoke(RESTORE_REVISION_AS_DRAFT_CHANNEL, request);
    },
    restorePreviousCheckpointAsDraft(request) {
      return ipcRenderer.invoke(RESTORE_PREVIOUS_CHECKPOINT_AS_DRAFT_CHANNEL, request);
    },
    rejectDraft(request) {
      return ipcRenderer.invoke(REJECT_DRAFT_CHANNEL, request);
    },
    cancel(request) {
      return ipcRenderer.invoke(CANCEL_CHANNEL, request);
    },
    steer(request) {
      return ipcRenderer.invoke(STEER_CHANNEL, request);
    },
    queueFollowup(request) {
      return ipcRenderer.invoke(QUEUE_FOLLOWUP_CHANNEL, request);
    },
    availability() {
      return ipcRenderer.invoke(AVAILABILITY_CHANNEL);
    },
    decideCommandApproval(request) {
      return ipcRenderer.invoke(DECIDE_COMMAND_APPROVAL_CHANNEL, request);
    },
    subscribeStarted(listener) {
      if (typeof listener !== 'function') return () => undefined;
      const handler = (_event, payload) => listener(payload);
      ipcRenderer.on(GENERATION_STARTED_CHANNEL, handler);
      return () => {
        ipcRenderer.removeListener(GENERATION_STARTED_CHANNEL, handler);
      };
    },
    subscribeOutput(listener) {
      if (typeof listener !== 'function') return () => undefined;
      const handler = (_event, payload) => listener(payload);
      ipcRenderer.on(GENERATION_OUTPUT_CHANNEL, handler);
      return () => {
        ipcRenderer.removeListener(GENERATION_OUTPUT_CHANNEL, handler);
      };
    },
    subscribeCommandApproval(listener) {
      if (typeof listener !== 'function') return () => undefined;
      const handler = (_event, payload) => listener(payload);
      ipcRenderer.on(COMMAND_APPROVAL_REQUESTED_CHANNEL, handler);
      return () => ipcRenderer.removeListener(COMMAND_APPROVAL_REQUESTED_CHANNEL, handler);
    },
    subscribeCommandOutput(listener) {
      if (typeof listener !== 'function') return () => undefined;
      const handler = (_event, payload) => listener(payload);
      ipcRenderer.on(COMMAND_OUTPUT_CHANNEL, handler);
      return () => ipcRenderer.removeListener(COMMAND_OUTPUT_CHANNEL, handler);
    },
  }),
  providerSettings: Object.freeze({
    readCurrent() {
      return ipcRenderer.invoke(READ_PROVIDER_SETTINGS_CHANNEL);
    },
    replaceCurrent(request) {
      return ipcRenderer.invoke(REPLACE_PROVIDER_SETTINGS_CHANNEL, request);
    },
    status() {
      return ipcRenderer.invoke(PROVIDER_SETTINGS_STATUS_CHANNEL);
    },
  }),
  taskStream: Object.freeze({
    read(request) {
      return ipcRenderer.invoke(READ_TASK_STREAM_CHANNEL, request);
    },
    subscribeChanged(listener) {
      if (typeof listener !== 'function') return () => undefined;
      const handler = (_event, payload) => {
        listener(payload);
      };
      ipcRenderer.on(TASK_STREAM_CHANGED_CHANNEL, handler);
      return () => {
        ipcRenderer.removeListener(TASK_STREAM_CHANGED_CHANNEL, handler);
      };
    },
  }),
  planReview: Object.freeze({
    review(request) {
      return ipcRenderer.invoke(REVIEW_PLAN_CHANNEL, request);
    },
  }),
  permissions: Object.freeze({
    evaluate(request) {
      return ipcRenderer.invoke(EVALUATE_PERMISSION_CHANNEL, request);
    },
  }),
  providerContextDisclosureApproval: Object.freeze({
    approveCurrent(request) {
      return ipcRenderer.invoke(APPROVE_PROVIDER_CONTEXT_DISCLOSURE_CHANNEL, request);
    },
  }),
  checkRun: Object.freeze({
    readCurrentDraftAvailableChecks(request) {
      return ipcRenderer.invoke(READ_CURRENT_DRAFT_AVAILABLE_CHECKS_CHANNEL, request);
    },
    diagnoseCurrentDraftCheckEnvironment(request) {
      return ipcRenderer.invoke(DIAGNOSE_CURRENT_DRAFT_CHECK_ENVIRONMENT_CHANNEL, request);
    },
    diagnoseProjectEnvironment(request) {
      return ipcRenderer.invoke(DIAGNOSE_PROJECT_ENVIRONMENT_CHANNEL, request);
    },
    approveAndRunCurrentDraftCheck(request) {
      return ipcRenderer.invoke(APPROVE_CURRENT_DRAFT_CHECK_CHANNEL, request);
    },
    decideCurrentDraftDependencyPreparation(request) {
      return ipcRenderer.invoke(DECIDE_CURRENT_DRAFT_DEPENDENCY_PREPARATION_CHANNEL, request);
    },
    skipCurrentDraftCheck(request) {
      return ipcRenderer.invoke(SKIP_CURRENT_DRAFT_CHECK_CHANNEL, request);
    },
  }),
  livePreview: Object.freeze({
    requestCurrentDraftPreview(request) {
      return ipcRenderer.invoke(REQUEST_CURRENT_DRAFT_LIVE_PREVIEW_CHANNEL, request);
    },
    reloadCurrentPreview(request) {
      return ipcRenderer.invoke(RELOAD_CURRENT_LIVE_PREVIEW_CHANNEL, request);
    },
    stopCurrentPreview(request) {
      return ipcRenderer.invoke(STOP_CURRENT_LIVE_PREVIEW_CHANNEL, request);
    },
    readCurrentPreviewStatus(request) {
      return ipcRenderer.invoke(READ_CURRENT_LIVE_PREVIEW_STATUS_CHANNEL, request);
    },
    updateCurrentPreviewLayout(request) {
      return ipcRenderer.invoke(UPDATE_CURRENT_LIVE_PREVIEW_LAYOUT_CHANNEL, request);
    },
    decideDevServerApproval(request) {
      return ipcRenderer.invoke(DECIDE_DEV_SERVER_APPROVAL_CHANNEL, request);
    },
  }),
  agentTestBrowser: Object.freeze({
    stop(request) {
      return ipcRenderer.invoke(STOP_AGENT_TEST_BROWSER_CHANNEL, request);
    },
    updateLayout(request) {
      return ipcRenderer.invoke(UPDATE_AGENT_TEST_BROWSER_LAYOUT_CHANNEL, request);
    },
    subscribeLifecycle(listener) {
      if (typeof listener !== 'function') return () => undefined;
      const handler = (_event, payload) => listener(payload);
      ipcRenderer.on(AGENT_TEST_BROWSER_LIFECYCLE_CHANNEL, handler);
      return () => ipcRenderer.removeListener(AGENT_TEST_BROWSER_LIFECYCLE_CHANNEL, handler);
    },
  }),
  userWeb: Object.freeze({
    navigate(request) {
      return ipcRenderer.invoke(NAVIGATE_USER_WEB_CHANNEL, request);
    },
    goBack() {
      return ipcRenderer.invoke(GO_BACK_USER_WEB_CHANNEL);
    },
    goForward() {
      return ipcRenderer.invoke(GO_FORWARD_USER_WEB_CHANNEL);
    },
    reload() {
      return ipcRenderer.invoke(RELOAD_USER_WEB_CHANNEL);
    },
    stop() {
      return ipcRenderer.invoke(STOP_USER_WEB_CHANNEL);
    },
    readStatus() {
      return ipcRenderer.invoke(READ_USER_WEB_STATUS_CHANNEL);
    },
    updateLayout(request) {
      return ipcRenderer.invoke(UPDATE_USER_WEB_LAYOUT_CHANNEL, request);
    },
  }),
  sideWorkspaceFiles: Object.freeze({
    readCurrentDraftFileTree(request) {
      return ipcRenderer.invoke(READ_CURRENT_DRAFT_FILE_TREE_CHANNEL, request);
    },
    readCurrentDraftFileContent(request) {
      return ipcRenderer.invoke(READ_CURRENT_DRAFT_FILE_CONTENT_CHANNEL, request);
    },
    readRuntimeToolFileTree(request) {
      return ipcRenderer.invoke(READ_RUNTIME_TOOL_FILE_TREE_CHANNEL, request);
    },
  }),
  windowControls: Object.freeze({
    minimize() {
      return ipcRenderer.invoke(MINIMIZE_WINDOW_CHANNEL);
    },
    toggleMaximize() {
      return ipcRenderer.invoke(TOGGLE_MAXIMIZE_WINDOW_CHANNEL);
    },
    close() {
      return ipcRenderer.invoke(CLOSE_WINDOW_CHANNEL);
    },
    readState() {
      return ipcRenderer.invoke(READ_WINDOW_STATE_CHANNEL);
    },
  }),
}));
