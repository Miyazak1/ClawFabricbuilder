'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const COMMIT_CHANNEL = 'clawfabric-builder:project-revisions:commit';
const LOAD_CURRENT_CHANNEL = 'clawfabric-builder:project-revisions:load-current';
const LIST_CURRENT_CHANNEL = 'clawfabric-builder:project-catalog:list-current';
const GENERATE_CHANNEL = 'clawfabric-builder:code-generator:generate';
const CANCEL_CHANNEL = 'clawfabric-builder:code-generator:cancel';
const AVAILABILITY_CHANNEL = 'clawfabric-builder:code-generator:availability';
const READ_PROVIDER_SETTINGS_CHANNEL = 'clawfabric-builder:provider-settings:read-current';
const REPLACE_PROVIDER_SETTINGS_CHANNEL = 'clawfabric-builder:provider-settings:replace-current';
const PROVIDER_SETTINGS_STATUS_CHANNEL = 'clawfabric-builder:provider-settings:status';
const MINIMIZE_WINDOW_CHANNEL = 'clawfabric-builder:window-controls:minimize';
const TOGGLE_MAXIMIZE_WINDOW_CHANNEL = 'clawfabric-builder:window-controls:toggle-maximize';
const CLOSE_WINDOW_CHANNEL = 'clawfabric-builder:window-controls:close';
const READ_WINDOW_STATE_CHANNEL = 'clawfabric-builder:window-controls:read-state';

contextBridge.exposeInMainWorld('clawfabricBuilder', Object.freeze({
  bridgeVersion: 'builder-preload.v1',
  projectRevisions: Object.freeze({
    commit(request) {
      return ipcRenderer.invoke(COMMIT_CHANNEL, request);
    },
    loadCurrent(request) {
      return ipcRenderer.invoke(LOAD_CURRENT_CHANNEL, request);
    },
  }),
  projectCatalog: Object.freeze({
    listCurrent() {
      return ipcRenderer.invoke(LIST_CURRENT_CHANNEL);
    },
  }),
  codeGenerator: Object.freeze({
    generate(request) {
      return ipcRenderer.invoke(GENERATE_CHANNEL, request);
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
