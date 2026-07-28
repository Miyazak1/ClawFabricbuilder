'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const OPEN_PROJECT_CHANNEL = 'clawfabric-builder:project-workspace:open';
const CREATE_LOCAL_PROJECT_CHANNEL = 'clawfabric-builder:project-workspace:create-local';
const SAVE_DRAFT_CHANNEL = 'clawfabric-builder:project-workspace:save-draft';
const LOAD_CURRENT_CHANNEL = 'clawfabric-builder:project-workspace:load-current';
const LOAD_REVISION_CHANNEL = 'clawfabric-builder:project-workspace:load-revision';
const LIST_CURRENT_CHANNEL = 'clawfabric-builder:project-workspace:list-current';
const LIST_HISTORY_CHANNEL = 'clawfabric-builder:project-workspace:list-history';
const GENERATE_CHANNEL = 'clawfabric-builder:code-generator:generate';
const GENERATE_APPROVED_PLAN_CHANNEL = 'clawfabric-builder:code-generator:generate-approved-plan';
const PROPOSE_PLAN_CHANNEL = 'clawfabric-builder:code-generator:propose-plan';
const PREPARE_PLAN_SOURCE_READ_APPROVAL_CHANNEL =
  'clawfabric-builder:code-generator:prepare-plan-source-read-approval';
const APPROVE_PLAN_SOURCE_READ_CHANNEL =
  'clawfabric-builder:code-generator:approve-plan-source-read';
const SUBMIT_CHANNEL = 'clawfabric-builder:code-generator:submit';
const GENERATION_STARTED_CHANNEL = 'clawfabric-builder:code-generator:started';
const GENERATION_OUTPUT_CHANNEL = 'clawfabric-builder:code-generator:output';
const RETRY_GENERATE_CHANNEL = 'clawfabric-builder:code-generator:retry';
const ANSWER_CHANNEL = 'clawfabric-builder:code-generator:answer';
const CANCEL_CHANNEL = 'clawfabric-builder:code-generator:cancel';
const STEER_CHANNEL = 'clawfabric-builder:code-generator:steer';
const AVAILABILITY_CHANNEL = 'clawfabric-builder:code-generator:availability';
const RESTORE_DRAFT_CHANNEL = 'clawfabric-builder:code-generator:restore-draft';
const RESTORE_REVISION_AS_DRAFT_CHANNEL =
  'clawfabric-builder:code-generator:restore-revision-as-draft';
const REJECT_DRAFT_CHANNEL = 'clawfabric-builder:code-generator:reject-draft';
const READ_PROVIDER_SETTINGS_CHANNEL = 'clawfabric-builder:provider-settings:read-current';
const REPLACE_PROVIDER_SETTINGS_CHANNEL = 'clawfabric-builder:provider-settings:replace-current';
const PROVIDER_SETTINGS_STATUS_CHANNEL = 'clawfabric-builder:provider-settings:status';
const READ_TASK_STREAM_CHANNEL = 'clawfabric-builder:task-stream:read';
const TASK_STREAM_CHANGED_CHANNEL = 'clawfabric-builder:task-stream:changed';
const REVIEW_PLAN_CHANNEL = 'clawfabric-builder:plan-review:review';
const EVALUATE_PERMISSION_CHANNEL = 'clawfabric-builder:permissions:evaluate';
const MINIMIZE_WINDOW_CHANNEL = 'clawfabric-builder:window-controls:minimize';
const TOGGLE_MAXIMIZE_WINDOW_CHANNEL = 'clawfabric-builder:window-controls:toggle-maximize';
const CLOSE_WINDOW_CHANNEL = 'clawfabric-builder:window-controls:close';
const READ_WINDOW_STATE_CHANNEL = 'clawfabric-builder:window-controls:read-state';

contextBridge.exposeInMainWorld('clawfabricBuilder', Object.freeze({
  bridgeVersion: 'builder-preload.v15',
  projectWorkspace: Object.freeze({
    open(request) {
      return ipcRenderer.invoke(OPEN_PROJECT_CHANNEL, request);
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
    listHistory(request) {
      return ipcRenderer.invoke(LIST_HISTORY_CHANNEL, request);
    },
  }),
  codeGenerator: Object.freeze({
    submit(request) {
      return ipcRenderer.invoke(SUBMIT_CHANNEL, request);
    },
    generate(request) {
      return ipcRenderer.invoke(GENERATE_CHANNEL, request);
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
    retry(request) {
      return ipcRenderer.invoke(RETRY_GENERATE_CHANNEL, request);
    },
    answer(request) {
      return ipcRenderer.invoke(ANSWER_CHANNEL, request);
    },
    restoreDraft(request) {
      return ipcRenderer.invoke(RESTORE_DRAFT_CHANNEL, request);
    },
    restoreRevisionAsDraft(request) {
      return ipcRenderer.invoke(RESTORE_REVISION_AS_DRAFT_CHANNEL, request);
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
    availability() {
      return ipcRenderer.invoke(AVAILABILITY_CHANNEL);
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
