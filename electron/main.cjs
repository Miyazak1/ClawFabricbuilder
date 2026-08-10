'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, Menu, dialog, ipcMain, net, session, shell } = require('electron');
const { resolveBuilderRendererTarget } = require('./runtime-options.cjs');
const { createBuilderGenerationIpcRuntime } = require('./builder-generation-ipc-runtime.cjs');
const { createBuilderPermissionIpcRuntime } = require('./builder-permission-ipc-runtime.cjs');
const {
  createBuilderProviderContextDisclosureApprovalIpcRuntime,
} = require('./builder-provider-context-disclosure-approval-ipc-runtime.cjs');
const {
  createBuilderLivePreviewIpcRuntime,
  createUnavailableBuilderLivePreviewService,
} = require('./builder-live-preview-ipc-runtime.cjs');
const { createBuilderProviderSettingsIpcRuntime } = require('./builder-provider-settings-ipc-runtime.cjs');
const { createBuilderWindowControlsIpcRuntime } = require('./builder-window-controls-ipc-runtime.cjs');

const DEV_SERVER_URL = process.env.BUILDER_RENDERER_URL || '';
const PACKAGED_CANARY_SENTINEL = 'BUILDER_PACKAGED_CANARY';
const PACKAGED_CANARY_USER_DATA_PATH = 'BUILDER_PACKAGED_CANARY_USER_DATA_PATH';
const PACKAGED_CANARY_USER_DATA_PREFIX = 'clawfabric-builder-packaged-canary-';
const PACKAGED_CANARY_PROJECT_ROOT_PATH = 'BUILDER_PACKAGED_CANARY_PROJECT_ROOT_PATH';
const PACKAGED_CANARY_PROJECT_ROOT_DIRECTORY = 'project-root';
let mainWindow = null;
let ipcRuntimes = Object.freeze([]);

function invalidPackagedCanaryPath() {
  throw new Error('invalid packaged canary user data path');
}

function invalidPackagedCanaryProjectRootPath() {
  throw new Error('invalid packaged canary project root path');
}

function samePath(left, right) {
  return process.platform === 'win32'
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

function checkedRealDirectory(directoryPath, invalidPath = invalidPackagedCanaryPath) {
  let stat;
  let realPath;
  try {
    stat = fs.lstatSync(directoryPath);
    realPath = path.resolve(fs.realpathSync.native(directoryPath));
  } catch {
    invalidPath();
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) invalidPath();
  return realPath;
}

function assertDirectChild(realPath, expectedParentRealPath, expectedBasename, invalidPath = invalidPackagedCanaryPath) {
  if (
    !samePath(path.dirname(realPath), expectedParentRealPath)
    || path.basename(realPath) !== expectedBasename
  ) invalidPath();
}

function resolvePackagedCanaryUserDataPath() {
  if (!app.isPackaged || process.env[PACKAGED_CANARY_SENTINEL] !== '1') return null;
  const requested = process.env[PACKAGED_CANARY_USER_DATA_PATH];
  if (
    typeof requested !== 'string'
    || requested.length === 0
    || requested.length > 1_024
    || requested.trim() !== requested
    || requested.includes('\0')
  ) throw new Error('invalid packaged canary user data path');

  const resolved = path.resolve(requested);
  const tempRoot = path.resolve(os.tmpdir());
  const basename = path.basename(resolved);
  if (
    resolved !== requested
    || path.normalize(resolved) !== resolved
    || path.dirname(resolved) !== tempRoot
    || !basename.startsWith(PACKAGED_CANARY_USER_DATA_PREFIX)
  ) invalidPackagedCanaryPath();

  const tempRootRealPath = checkedRealDirectory(tempRoot);
  const userDataRealPath = checkedRealDirectory(resolved);
  assertDirectChild(userDataRealPath, tempRootRealPath, basename);
  return resolved;
}

function resolvePackagedCanaryProjectRootPath(userDataPath) {
  if (!app.isPackaged || process.env[PACKAGED_CANARY_SENTINEL] !== '1') return null;
  const requested = process.env[PACKAGED_CANARY_PROJECT_ROOT_PATH];
  if (requested === undefined) return null;
  if (
    typeof requested !== 'string'
    || requested.length === 0
    || requested.length > 1_024
    || requested.trim() !== requested
    || requested.includes('\0')
  ) invalidPackagedCanaryProjectRootPath();

  const resolved = path.resolve(requested);
  const basename = path.basename(resolved);
  if (
    resolved !== requested
    || path.normalize(resolved) !== resolved
    || path.dirname(resolved) !== userDataPath
    || basename !== PACKAGED_CANARY_PROJECT_ROOT_DIRECTORY
  ) invalidPackagedCanaryProjectRootPath();

  const userDataRealPath = checkedRealDirectory(userDataPath, invalidPackagedCanaryProjectRootPath);
  const projectRootRealPath = checkedRealDirectory(resolved, invalidPackagedCanaryProjectRootPath);
  assertDirectChild(
    projectRootRealPath,
    userDataRealPath,
    PACKAGED_CANARY_PROJECT_ROOT_DIRECTORY,
    invalidPackagedCanaryProjectRootPath,
  );
  return projectRootRealPath;
}

function configurePackagedCanaryPaths() {
  const userDataPath = resolvePackagedCanaryUserDataPath();
  if (userDataPath === null) return null;
  const sessionDataPath = path.join(userDataPath, 'session-data');
  try {
    fs.mkdirSync(sessionDataPath);
  } catch (error) {
    if (error === null || error.code !== 'EEXIST') invalidPackagedCanaryPath();
  }
  const userDataRealPath = path.resolve(fs.realpathSync.native(userDataPath));
  const sessionDataRealPath = checkedRealDirectory(sessionDataPath);
  assertDirectChild(sessionDataRealPath, userDataRealPath, 'session-data');
  const projectRootPath = resolvePackagedCanaryProjectRootPath(userDataPath);
  app.setPath('userData', userDataPath);
  app.setPath('sessionData', sessionDataPath);
  return projectRootPath;
}

function resolveWindowIconPath() {
  const iconPath = path.join(__dirname, '..', 'build', 'icon.ico');
  try {
    return fs.existsSync(iconPath) ? iconPath : undefined;
  } catch {
    return undefined;
  }
}

function createMainWindow() {
  Menu.setApplicationMenu(null);
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 840,
    minHeight: 620,
    backgroundColor: '#f4f5f7',
    autoHideMenuBar: true,
    frame: false,
    icon: resolveWindowIconPath(),
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

function disposeIpcRuntimes() {
  for (const runtime of [...ipcRuntimes].reverse()) {
    try {
      runtime.dispose();
    } catch {
      // Shutdown must not leave the Electron process open because cleanup reporting failed.
    }
  }
  ipcRuntimes = Object.freeze([]);
}

function createProjectFolderDialog(packagedCanaryProjectRootPath) {
  if (packagedCanaryProjectRootPath !== null) {
    return async () => Object.freeze({
      canceled: false,
      filePaths: Object.freeze([packagedCanaryProjectRootPath]),
    });
  }
  return (...args) => dialog.showOpenDialog(...args);
}

function createIpcRuntimes(userDataPath, packagedCanaryProjectRootPath) {
  const permissionRuntime = createBuilderPermissionIpcRuntime({
    ipcMain,
    mainWindowRef: () => mainWindow,
    userDataPath,
  });
  const generationRuntime = createBuilderGenerationIpcRuntime({
    fetchImpl: net.fetch,
    grantPermissionForExplicitApproval: permissionRuntime.grantForExplicitApproval,
    ipcMain,
    mainWindowRef: () => mainWindow,
    openPath: (projectRootPath) => shell.openPath(projectRootPath),
    showOpenDialog: createProjectFolderDialog(packagedCanaryProjectRootPath),
    userDataPath,
  });
  return Object.freeze([
    createBuilderProviderSettingsIpcRuntime({
      ipcMain,
      mainWindowRef: () => mainWindow,
      userDataPath,
    }),
    permissionRuntime,
    generationRuntime,
    createBuilderProviderContextDisclosureApprovalIpcRuntime({
      grantPermissionForExplicitApproval: permissionRuntime.grantForExplicitApproval,
      ipcMain,
      mainWindowRef: () => mainWindow,
      providerContextDisclosureStatusService:
        generationRuntime.readProviderContextDisclosureStatusServiceForMainOnlyApprovalRuntime(),
    }),
    createBuilderLivePreviewIpcRuntime({
      ipcMain,
      mainWindowRef: () => mainWindow,
      livePreviewService: createUnavailableBuilderLivePreviewService(),
    }),
    createBuilderWindowControlsIpcRuntime({
      ipcMain,
      mainWindowRef: () => mainWindow,
    }),
  ]);
}

function registerIpcRuntimes(runtimes) {
  const registered = [];
  try {
    for (const runtime of runtimes) {
      runtime.register();
      registered.push(runtime);
    }
  } catch (error) {
    for (const runtime of registered.reverse()) {
      try {
        runtime.dispose();
      } catch {
        // The app-level startup failure path below will quit after best-effort cleanup.
      }
    }
    throw error;
  }
}

app.setAppUserModelId('com.clawfabric.builder');
const packagedCanaryProjectRootPath = configurePackagedCanaryPaths();

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
    const userDataPath = app.getPath('userData');
    const runtimes = createIpcRuntimes(userDataPath, packagedCanaryProjectRootPath);
    registerIpcRuntimes(runtimes);
    ipcRuntimes = runtimes;
    createMainWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    });
  }).catch(() => {
    disposeIpcRuntimes();
    app.quit();
  });

  app.on('before-quit', () => {
    disposeIpcRuntimes();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
