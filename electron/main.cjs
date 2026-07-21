'use strict';

const path = require('node:path');
const { app, BrowserWindow, ipcMain, session } = require('electron');
const { resolveBuilderRendererTarget } = require('./runtime-options.cjs');
const { createBuilderProjectIpcRuntime } = require('./builder-project-ipc-runtime.cjs');

const DEV_SERVER_URL = process.env.BUILDER_RENDERER_URL || '';
let mainWindow = null;
let projectIpcRuntime = null;

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
  window.once('closed', () => {
    if (mainWindow === window) mainWindow = null;
  });

  const rendererTarget = resolveBuilderRendererTarget({
    isPackaged: app.isPackaged,
    rendererUrl: DEV_SERVER_URL,
  });
  if (rendererTarget.kind === 'development_url') {
    void window.loadURL(rendererTarget.url);
  } else {
    void window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
  mainWindow = window;
  return window;
}

function denyRendererPermissions() {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  session.defaultSession.setPermissionCheckHandler(() => false);
}

app.setAppUserModelId('com.clawfabric.builder');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow === null) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    denyRendererPermissions();
    projectIpcRuntime = createBuilderProjectIpcRuntime({
      ipcMain,
      mainWindowRef: () => mainWindow,
      userDataPath: app.getPath('userData'),
    });
    projectIpcRuntime.register();
    createMainWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    });
  }).catch(() => {
    projectIpcRuntime?.dispose();
    projectIpcRuntime = null;
    app.quit();
  });

  app.on('before-quit', () => {
    projectIpcRuntime?.dispose();
    projectIpcRuntime = null;
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
