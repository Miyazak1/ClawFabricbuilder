'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const OPEN_PROJECT_CHANNEL = 'clawfabric-builder:project-workspace:open';
const SAVE_DRAFT_CHANNEL = 'clawfabric-builder:project-workspace:save-draft';
const LOAD_CURRENT_CHANNEL = 'clawfabric-builder:project-workspace:load-current';
const LOAD_REVISION_CHANNEL = 'clawfabric-builder:project-workspace:load-revision';
const LIST_CURRENT_CHANNEL = 'clawfabric-builder:project-workspace:list-current';
const LIST_HISTORY_CHANNEL = 'clawfabric-builder:project-workspace:list-history';
const GENERATE_CHANNEL = 'clawfabric-builder:code-generator:generate';
const RETRY_GENERATE_CHANNEL = 'clawfabric-builder:code-generator:retry';
const ANSWER_CHANNEL = 'clawfabric-builder:code-generator:answer';
const CANCEL_CHANNEL = 'clawfabric-builder:code-generator:cancel';
const AVAILABILITY_CHANNEL = 'clawfabric-builder:code-generator:availability';
const RESTORE_DRAFT_CHANNEL = 'clawfabric-builder:code-generator:restore-draft';
const REJECT_DRAFT_CHANNEL = 'clawfabric-builder:code-generator:reject-draft';
const READ_PROVIDER_SETTINGS_CHANNEL = 'clawfabric-builder:provider-settings:read-current';
const REPLACE_PROVIDER_SETTINGS_CHANNEL = 'clawfabric-builder:provider-settings:replace-current';
const PROVIDER_SETTINGS_STATUS_CHANNEL = 'clawfabric-builder:provider-settings:status';
const READ_TASK_STREAM_CHANNEL = 'clawfabric-builder:task-stream:read';
const EVALUATE_PERMISSION_CHANNEL = 'clawfabric-builder:permissions:evaluate';
const MINIMIZE_WINDOW_CHANNEL = 'clawfabric-builder:window-controls:minimize';
const TOGGLE_MAXIMIZE_WINDOW_CHANNEL = 'clawfabric-builder:window-controls:toggle-maximize';
const CLOSE_WINDOW_CHANNEL = 'clawfabric-builder:window-controls:close';
const READ_WINDOW_STATE_CHANNEL = 'clawfabric-builder:window-controls:read-state';

contextBridge.exposeInMainWorld('clawfabricBuilder', Object.freeze({
  bridgeVersion: 'builder-preload.v4',
  projectWorkspace: Object.freeze({
    open(request) {
      return ipcRenderer.invoke(OPEN_PROJECT_CHANNEL, request);
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
    generate(request) {
      return ipcRenderer.invoke(GENERATE_CHANNEL, request);
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
    rejectDraft(request) {
      return ipcRenderer.invoke(REJECT_DRAFT_CHANNEL, request);
    },
    cancel(request) {
      return ipcRenderer.invoke(CANCEL_CHANNEL, request);
    },
    availability() {
      return ipcRenderer.invoke(AVAILABILITY_CHANNEL);
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
