'use strict';

const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('clawfabricBuilder', Object.freeze({
  bridgeVersion: 'builder-preload.v1',
}));
