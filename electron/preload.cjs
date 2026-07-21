'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const COMMIT_CHANNEL = 'clawfabric-builder:project-revisions:commit';
const LOAD_CURRENT_CHANNEL = 'clawfabric-builder:project-revisions:load-current';
const LIST_CURRENT_CHANNEL = 'clawfabric-builder:project-catalog:list-current';

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
}));
