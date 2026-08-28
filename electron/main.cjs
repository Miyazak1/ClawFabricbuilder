'use strict';

const fs = require('node:fs');
const { spawn } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, Menu, WebContentsView, dialog, ipcMain, net, session, shell } = require('electron');
const { resolveBuilderRendererTarget } = require('./runtime-options.cjs');
const {
  createBuilderGenerationIpcRuntime,
  packagedCheckWorkerPath,
} = require('./builder-generation-ipc-runtime.cjs');
const { createBuilderPermissionIpcRuntime } = require('./builder-permission-ipc-runtime.cjs');
const {
  createBuilderProviderContextDisclosureApprovalIpcRuntime,
} = require('./builder-provider-context-disclosure-approval-ipc-runtime.cjs');
const {
  createBuilderCheckRunApprovalIpcRuntime,
} = require('./builder-check-run-approval-ipc-runtime.cjs');
const {
  createBuilderLivePreviewIpcRuntime,
} = require('./builder-live-preview-ipc-runtime.cjs');
const {
  createBuilderSideWorkspaceFileIpcRuntime,
} = require('./builder-side-workspace-file-ipc-runtime.cjs');
const {
  createBuilderLivePreviewMainService,
} = require('./builder-live-preview-main-service.cjs');
const {
  createBuilderSideWorkspaceFileMainService,
} = require('./builder-side-workspace-file-main-service.cjs');
const {
  createBuilderLivePreviewWebContentsViewRuntime,
} = require('./builder-live-preview-webcontents-view-runtime.cjs');
const {
  createBuilderAgentTestBrowserRuntime,
} = require('./builder-agent-test-browser-runtime.cjs');
const {
  createBuilderAgentTestBrowserIpcRuntime,
} = require('./builder-agent-test-browser-ipc-runtime.cjs');
const {
  createBuilderBrowserSessionRegistry,
} = require('./builder-browser-session-registry.cjs');
const {
  createBuilderUserWebMainService,
} = require('./builder-user-web-main-service.cjs');
const {
  createBuilderUserWebIpcRuntime,
} = require('./builder-user-web-ipc-runtime.cjs');
const {
  createBuilderCheckRunProcessAdapter,
} = require('./builder-check-run-process-adapter.cjs');
const {
  createBuilderLivePreviewDevServerRuntime,
} = require('./builder-live-preview-dev-server-runtime.cjs');
const { createBuilderProviderSettingsIpcRuntime } = require('./builder-provider-settings-ipc-runtime.cjs');
const { createBuilderWindowControlsIpcRuntime } = require('./builder-window-controls-ipc-runtime.cjs');
const { builderPerformanceTrace } = require('./builder-performance-trace.cjs');

const DEV_SERVER_URL = process.env.BUILDER_RENDERER_URL || '';
const PACKAGED_CANARY_SENTINEL = 'BUILDER_PACKAGED_CANARY';
const PACKAGED_CANARY_USER_DATA_PATH = 'BUILDER_PACKAGED_CANARY_USER_DATA_PATH';
const PACKAGED_CANARY_USER_DATA_PREFIX = 'clawfabric-builder-packaged-canary-';
const PACKAGED_CANARY_PROJECT_ROOT_PATH = 'BUILDER_PACKAGED_CANARY_PROJECT_ROOT_PATH';
const PACKAGED_CANARY_PROJECT_ROOT_DIRECTORY = 'project-root';
const PERFORMANCE_TRACE_FILE = 'builder-performance-trace.v1.json';
const PACKAGED_CANARY_STARTUP_DEBUG_FILE = 'builder-canary-startup-debug.json';
let mainWindow = null;
let ipcRuntimes = Object.freeze([]);
let ipcShutdownPromise = null;
let quitAfterIpcShutdown = false;

function recordPackagedCanaryStartupFailure(error) {
  if (!app.isPackaged || process.env[PACKAGED_CANARY_SENTINEL] !== '1') return;
  const rawCode = typeof error?.code === 'string' ? error.code.toLowerCase() : '';
  const errorCode = /^[a-z0-9_]{1,96}$/u.test(rawCode) ? rawCode : 'startup_failed';
  const rawName = typeof error?.name === 'string' ? error.name : '';
  const errorName = /^[A-Za-z]{1,48}Error$/u.test(rawName) ? rawName : 'Error';
  const stack = typeof error?.stack === 'string' ? error.stack : '';
  const location = stack.match(/[\\/](builder-[a-z0-9-]+\.cjs):(\d{1,7}):(\d{1,7})/u);
  const diagnostic = Object.freeze({
    diagnostic_version: 'builder-packaged-canary-startup-debug.v1',
    error_code: errorCode,
    error_name: errorName,
    phase: 'ready_handler',
    source_file: location?.[1] ?? null,
    source_line: location === null ? null : Number(location[2]),
  });
  try {
    fs.writeFileSync(
      path.join(app.getPath('userData'), PACKAGED_CANARY_STARTUP_DEBUG_FILE),
      `${JSON.stringify(diagnostic)}\n`,
      { encoding: 'utf8', flag: 'wx' },
    );
  } catch {
    // Canary diagnostics never change startup or shutdown behavior.
  }
}

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
    const rendererUrl = new URL(rendererTarget.url);
    if (builderPerformanceTrace.enabled()) rendererUrl.searchParams.set('builder_perf_trace', '1');
    void window.loadURL(rendererUrl.toString());
  } else {
    void window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), {
      ...(builderPerformanceTrace.enabled()
        ? { query: { builder_perf_trace: '1' } }
        : {}),
    });
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

async function shutdownIpcRuntimes() {
  const shutdownComplete = await builderPerformanceTrace.measureAsync(
    'main.lifecycle.shutdown_ipc_runtimes.duration_ms',
    async () => {
      for (const runtime of [...ipcRuntimes].reverse()) {
        try {
          if (typeof runtime.shutdown === 'function') await runtime.shutdown();
          else runtime.dispose();
        } catch {
          if (typeof runtime.shutdown === 'function') return false;
          // Non-executing IPC cleanup remains best-effort during application shutdown.
        }
      }
      ipcRuntimes = Object.freeze([]);
      return true;
    }
  );
  try { builderPerformanceTrace.flush(); } catch { /* local diagnostics never block shutdown */ }
  return shutdownComplete;
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
  const browserSessionRegistry = createBuilderBrowserSessionRegistry({
    session,
    now_ms: () => Date.now(),
  });
  const agentTestBrowserRuntime = createBuilderAgentTestBrowserRuntime({
    WebContentsView,
    browser_session_registry: browserSessionRegistry,
    mainWindowRef: () => mainWindow,
    now_ms: () => Date.now(),
  });
  const generationRuntime = createBuilderGenerationIpcRuntime({
    fetchImpl: net.fetch,
    grantPermissionForExplicitApproval: permissionRuntime.grantForExplicitApproval,
    ipcMain,
    mainWindowRef: () => mainWindow,
    openPath: (projectRootPath) => shell.openPath(projectRootPath),
    showOpenDialog: createProjectFolderDialog(packagedCanaryProjectRootPath),
    userDataPath,
    agentTestBrowserRuntime,
  });
  const devServerRuntime = createBuilderLivePreviewDevServerRuntime({
    process_adapter: createBuilderCheckRunProcessAdapter({
      spawn_process: spawn,
      platform: process.platform,
      windows_root: process.platform === 'win32' ? process.env.SystemRoot : null,
    }),
    process_exec_path: process.execPath,
    worker_path: packagedCheckWorkerPath(),
    now_ms: () => Date.now(),
    on_output: () => undefined,
  });
  const livePreviewService = createBuilderLivePreviewMainService({
    current_draft_source_service:
      generationRuntime.readLivePreviewCurrentDraftSourceServiceForMainOnlyRuntime(),
    webcontents_view_runtime: createBuilderLivePreviewWebContentsViewRuntime({
      WebContentsView,
      browserSessionRegistry,
      nowMs: () => Date.now(),
    }),
    mainWindowRef: () => mainWindow,
    now_ms: () => Date.now(),
    dev_server_runtime: devServerRuntime,
    project_workspace_path_service:
      generationRuntime.readProjectWorkspacePathServiceForMainOnlyRuntime(),
  });
  const userWebService = createBuilderUserWebMainService({
    WebContentsView,
    browserSessionRegistry,
    mainWindowRef: () => mainWindow,
    nowMs: () => Date.now(),
  });
  const sideWorkspaceFileService = createBuilderSideWorkspaceFileMainService({
    current_draft_source_service:
      generationRuntime.readLivePreviewCurrentDraftSourceServiceForMainOnlyRuntime(),
    runtime_snapshot_source_service:
      generationRuntime.readRuntimeWorkspaceSourceServiceForMainOnlyRuntime(),
  });
  return Object.freeze([
    Object.freeze({
      register() {},
      dispose() {
        void agentTestBrowserRuntime.dispose().finally(() => browserSessionRegistry.dispose());
      },
      async shutdown() {
        try { await agentTestBrowserRuntime.dispose(); }
        finally { await browserSessionRegistry.dispose(); }
      },
    }),
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
    createBuilderCheckRunApprovalIpcRuntime({
      ipcMain,
      mainWindowRef: () => mainWindow,
      currentDraftCheckRunService:
        generationRuntime.readCheckRunCurrentDraftServiceForMainOnlyApprovalRuntime(),
      currentDraftCheckSkipService:
        generationRuntime.readCheckRunSkipCurrentDraftServiceForMainOnlyApprovalRuntime(),
      projectEnvironmentDiagnosisService:
        generationRuntime.readProjectEnvironmentDiagnosisServiceForMainOnlyApprovalRuntime(),
    }),
    createBuilderLivePreviewIpcRuntime({
      ipcMain,
      mainWindowRef: () => mainWindow,
      livePreviewService,
    }),
    createBuilderAgentTestBrowserIpcRuntime({
      agentTestBrowserRuntime,
      ipcMain,
      mainWindowRef: () => mainWindow,
    }),
    createBuilderUserWebIpcRuntime({
      ipcMain,
      mainWindowRef: () => mainWindow,
      userWebService,
    }),
    createBuilderSideWorkspaceFileIpcRuntime({
      ipcMain,
      mainWindowRef: () => mainWindow,
      fileService: sideWorkspaceFileService,
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

function exposePackagedPerformanceTraceControls() {
  Object.defineProperty(globalThis, '__builderPerformanceTraceEventLoopWindow', {
    configurable: true,
    enumerable: false,
    value(action, name) {
      if (action === 'begin') return builderPerformanceTrace.beginEventLoopWindow(name);
      if (action === 'end') return builderPerformanceTrace.endEventLoopWindow(name);
      return false;
    },
    writable: false,
  });
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

  app.whenReady().then(async () => {
    denyRendererPermissions();
    const userDataPath = app.getPath('userData');
    if (process.env.BUILDER_PERF_TRACE === '1') {
      builderPerformanceTrace.configure({
        enabled: true,
        output_path: path.join(userDataPath, PERFORMANCE_TRACE_FILE),
      });
      exposePackagedPerformanceTraceControls();
    }
    await builderPerformanceTrace.measureAsync('main.lifecycle.ready_handler.duration_ms', async () => {
      const runtimes = builderPerformanceTrace.measureSync(
        'main.lifecycle.create_ipc_runtimes.duration_ms',
        () => createIpcRuntimes(userDataPath, packagedCanaryProjectRootPath),
      );
      builderPerformanceTrace.measureSync(
        'main.lifecycle.register_ipc_runtimes.duration_ms',
        () => registerIpcRuntimes(runtimes),
      );
      ipcRuntimes = runtimes;
      builderPerformanceTrace.measureSync(
        'main.lifecycle.create_main_window.duration_ms',
        () => createMainWindow(),
      );
      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          builderPerformanceTrace.measureSync(
            'main.lifecycle.create_main_window.duration_ms',
            () => createMainWindow(),
          );
        }
      });
    });
  }).catch(async (error) => {
    recordPackagedCanaryStartupFailure(error);
    if (await shutdownIpcRuntimes()) {
      quitAfterIpcShutdown = true;
      app.quit();
    }
  });

  app.on('before-quit', (event) => {
    if (quitAfterIpcShutdown) return;
    event.preventDefault();
    if (ipcShutdownPromise !== null) return;
    ipcShutdownPromise = shutdownIpcRuntimes().then((shutdownComplete) => {
      if (shutdownComplete) {
        quitAfterIpcShutdown = true;
        app.quit();
      } else {
        ipcShutdownPromise = null;
      }
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
