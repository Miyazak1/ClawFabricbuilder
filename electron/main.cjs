'use strict';

const path = require('node:path');
const { app, BrowserWindow, session } = require('electron');
const { resolveBuilderRendererTarget } = require('./runtime-options.cjs');

const DEV_SERVER_URL = process.env.BUILDER_RENDERER_URL || '';

function createMainWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 840,
    minHeight: 620,
    backgroundColor: '#f4f5f7',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.once('ready-to-show', () => window.show());

  const rendererTarget = resolveBuilderRendererTarget({
    isPackaged: app.isPackaged,
    rendererUrl: DEV_SERVER_URL,
  });
  if (rendererTarget.kind === 'development_url') {
    void window.loadURL(rendererTarget.url);
  } else {
    void window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
  return window;
}

function denyRendererPermissions() {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  session.defaultSession.setPermissionCheckHandler(() => false);
}

app.setAppUserModelId('com.clawfabric.builder');

app.whenReady().then(() => {
  denyRendererPermissions();
  createMainWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
