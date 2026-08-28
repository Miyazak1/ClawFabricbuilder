'use strict';

const { types: utilTypes } = require('node:util');

const { createBuilderBrowserSession } = require('./builder-browser-session.cjs');
const {
  BUILDER_BROWSER_SESSION_REGISTRY_VERSION,
} = require('./builder-browser-session-registry.cjs');
const { builderPerformanceTrace } = require('./builder-performance-trace.cjs');

const BUILDER_USER_WEB_MAIN_SERVICE_VERSION = 'builder-user-web-main-service.v1';
const PROFILE_ID = 'builder-browser-profile:00000000-0000-4000-8000-000000000001';
const SESSION_TTL_MS = 8 * 60 * 60 * 1_000;
const LOAD_TIMEOUT_MS = 15_000;
const OPTION_KEYS = Object.freeze([
  'WebContentsView', 'browserSessionRegistry', 'mainWindowRef', 'nowMs',
]);
const NAVIGATE_KEYS = Object.freeze(['url']);
const LAYOUT_KEYS = Object.freeze(['view_bounds']);
const BOUNDS_KEYS = Object.freeze(['x', 'y', 'width', 'height']);

class BuilderUserWebMainServiceError extends Error {
  constructor(code = 'builder_user_web_invalid') {
    const selected = [
      'builder_user_web_invalid',
      'builder_user_web_unavailable',
      'builder_user_web_load_failed',
      'builder_user_web_cleanup_required',
    ].includes(code) ? code : 'builder_user_web_invalid';
    super('User Web is unavailable.');
    this.name = 'BuilderUserWebMainServiceError';
    this.code = selected;
    this.retryable = selected !== 'builder_user_web_invalid';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) {
  throw new BuilderUserWebMainServiceError(code);
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || utilTypes.isProxy(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactObject(value, keys) {
  if (!isPlainObject(value)) fail();
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== keys.length || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))) {
    fail();
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail();
  }
}

function stableMethod(value, key) {
  let cursor = value;
  while (cursor !== null) {
    if (utilTypes.isProxy(cursor)) fail();
    const descriptor = Object.getOwnPropertyDescriptor(cursor, key);
    if (descriptor) {
      if (!Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') fail();
      return descriptor.value;
    }
    cursor = Object.getPrototypeOf(cursor);
  }
  fail();
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail();
  return value;
}

function safeOptions(rawOptions) {
  exactObject(rawOptions, OPTION_KEYS);
  const WebContentsView = rawOptions.WebContentsView;
  const browserSessionRegistry = rawOptions.browserSessionRegistry;
  if (
    typeof WebContentsView !== 'function'
    || utilTypes.isProxy(WebContentsView)
    || !isPlainObject(browserSessionRegistry)
    || browserSessionRegistry.registry_version !== BUILDER_BROWSER_SESSION_REGISTRY_VERSION
    || typeof rawOptions.mainWindowRef !== 'function'
    || utilTypes.isProxy(rawOptions.mainWindowRef)
    || typeof rawOptions.nowMs !== 'function'
    || utilTypes.isProxy(rawOptions.nowMs)
  ) fail();
  return Object.freeze({
    WebContentsView,
    browserSessionRegistry,
    openBrowserSession: stableMethod(browserSessionRegistry, 'open'),
    mainWindowRef: rawOptions.mainWindowRef,
    nowMs: rawOptions.nowMs,
  });
}

function normalizeUrl(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 2_048 || value.trim() !== value) fail();
  const candidate = /^[a-z][a-z0-9+.-]*:/iu.test(value) ? value : `https://${value}`;
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    fail();
  }
  if (
    !['http:', 'https:'].includes(parsed.protocol)
    || parsed.username !== ''
    || parsed.password !== ''
    || parsed.hostname === ''
  ) fail();
  return Object.freeze({ url: parsed.toString(), origin: parsed.origin });
}

function sameOrigin(url, origin) {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol)
      && parsed.username === ''
      && parsed.password === ''
      && parsed.origin === origin;
  } catch {
    return false;
  }
}

function safeBounds(rawBounds) {
  if (rawBounds === null) return null;
  exactObject(rawBounds, BOUNDS_KEYS);
  for (const key of ['x', 'y']) {
    if (!Number.isSafeInteger(rawBounds[key]) || rawBounds[key] < 0 || rawBounds[key] > 100_000) fail();
  }
  for (const key of ['width', 'height']) {
    if (!Number.isSafeInteger(rawBounds[key]) || rawBounds[key] < 1 || rawBounds[key] > 100_000) fail();
  }
  return Object.freeze({ ...rawBounds });
}

function safeWindow(rawWindow) {
  if (rawWindow === null || typeof rawWindow !== 'object' || utilTypes.isProxy(rawWindow)) fail('builder_user_web_unavailable');
  const contentView = rawWindow.contentView;
  if (contentView === null || typeof contentView !== 'object' || utilTypes.isProxy(contentView)) fail('builder_user_web_unavailable');
  return Object.freeze({
    window: rawWindow,
    isDestroyed: stableMethod(rawWindow, 'isDestroyed'),
    contentView,
    addChildView: stableMethod(contentView, 'addChildView'),
    removeChildView: stableMethod(contentView, 'removeChildView'),
  });
}

function safeElectronSession(value) {
  if (value === null || typeof value !== 'object' || utilTypes.isProxy(value)) fail('builder_user_web_unavailable');
  return Object.freeze({
    session: value,
    setPermissionRequestHandler: stableMethod(value, 'setPermissionRequestHandler'),
    setPermissionCheckHandler: stableMethod(value, 'setPermissionCheckHandler'),
    on: stableMethod(value, 'on'),
  });
}

function safeView(WebContentsView, partition) {
  let view;
  try {
    view = new WebContentsView({
      webPreferences: {
        partition,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
      },
    });
  } catch {
    fail('builder_user_web_unavailable');
  }
  if (view === null || typeof view !== 'object' || utilTypes.isProxy(view)) fail('builder_user_web_unavailable');
  const contents = view.webContents;
  if (contents === null || typeof contents !== 'object' || utilTypes.isProxy(contents)) fail('builder_user_web_unavailable');
  return Object.freeze({
    view,
    setBounds: stableMethod(view, 'setBounds'),
    contents,
    loadURL: stableMethod(contents, 'loadURL'),
    setWindowOpenHandler: stableMethod(contents, 'setWindowOpenHandler'),
    on: stableMethod(contents, 'on'),
    destroy: stableMethod(contents, 'destroy'),
    isDestroyed: stableMethod(contents, 'isDestroyed'),
    canGoBack: stableMethod(contents, 'canGoBack'),
    canGoForward: stableMethod(contents, 'canGoForward'),
    goBack: stableMethod(contents, 'goBack'),
    goForward: stableMethod(contents, 'goForward'),
    reload: stableMethod(contents, 'reload'),
    once: stableMethod(contents, 'once'),
    removeListener: stableMethod(contents, 'removeListener'),
  });
}

function authority() {
  return Object.freeze({
    user_web_authority: 'builder_main_user_web_v1',
    renderer_authority: 'explicit_navigation_and_layout_only',
    provider_authority: 'none',
    provider_observation: false,
    command_execution: false,
    dependency_installation: false,
    project_write: false,
    downloads: 'blocked_pending_separate_admission',
    permissions: 'denied',
    popup_windows: 'blocked',
    partition_visibility: 'main_private',
  });
}

function statusFor(state) {
  if (state === null) {
    return Object.freeze({
      status_version: 'builder-user-web-status.v1',
      status: 'idle',
      current_url: null,
      can_go_back: false,
      can_go_forward: false,
      can_reload: false,
      can_stop: false,
      navigation_block_count: 0,
      permission_block_count: 0,
      download_block_count: 0,
      window_open_block_count: 0,
      message: 'Enter a URL to browse.',
      updated_at_ms: 0,
      authority: authority(),
    });
  }
  let canGoBack = false;
  let canGoForward = false;
  if (state.status !== 'stopped') {
    try {
      canGoBack = Reflect.apply(state.canGoBack, state.contents, []);
      canGoForward = Reflect.apply(state.canGoForward, state.contents, []);
    } catch {
      canGoBack = false;
      canGoForward = false;
    }
  }
  return Object.freeze({
    status_version: 'builder-user-web-status.v1',
    status: state.status,
    current_url: state.current_url,
    can_go_back: Boolean(canGoBack),
    can_go_forward: Boolean(canGoForward),
    can_reload: ['ready', 'failed'].includes(state.status),
    can_stop: !['stopped'].includes(state.status),
    navigation_block_count: state.navigation_block_count,
    permission_block_count: state.permission_block_count,
    download_block_count: state.download_block_count,
    window_open_block_count: state.window_open_block_count,
    message: state.message,
    updated_at_ms: state.updated_at_ms,
    authority: authority(),
  });
}

function withTimeout(operation, timeoutMs) {
  let timer = null;
  return Promise.race([
    Promise.resolve().then(operation),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new BuilderUserWebMainServiceError('builder_user_web_load_failed')), timeoutMs);
    }),
  ]).finally(() => {
    if (timer !== null) clearTimeout(timer);
  });
}

function attachState(state, bounds) {
  const rawWindow = Reflect.apply(state.mainWindowRef, undefined, []);
  const target = safeWindow(rawWindow);
  if (Reflect.apply(target.isDestroyed, target.window, [])) fail('builder_user_web_unavailable');
  if (state.attachedWindow !== target.window) {
    if (state.attachedWindow !== null) {
      try { Reflect.apply(state.removeChildView, state.attachedContentView, [state.view]); } catch { /* cleanup below */ }
    }
    Reflect.apply(target.addChildView, target.contentView, [state.view]);
    state.attachedWindow = target.window;
    state.attachedContentView = target.contentView;
    state.removeChildView = target.removeChildView;
  }
  Reflect.apply(state.setBounds, state.view, [bounds]);
  state.view_bounds = bounds;
}

function detachState(state) {
  if (state.attachedWindow === null) return;
  try {
    Reflect.apply(state.removeChildView, state.attachedContentView, [state.view]);
  } finally {
    state.attachedWindow = null;
    state.attachedContentView = null;
    state.removeChildView = null;
    state.view_bounds = null;
  }
}

function installPolicies(state, electronSession) {
  Reflect.apply(electronSession.setPermissionRequestHandler, electronSession.session, [
    (_contents, _permission, callback) => {
      state.permission_block_count += 1;
      callback(false);
    },
  ]);
  Reflect.apply(electronSession.setPermissionCheckHandler, electronSession.session, [() => {
    state.permission_block_count += 1;
    return false;
  }]);
  Reflect.apply(electronSession.on, electronSession.session, ['will-download', (event) => {
    state.download_block_count += 1;
    event?.preventDefault?.();
  }]);
  Reflect.apply(state.setWindowOpenHandler, state.contents, [() => {
    state.window_open_block_count += 1;
    return { action: 'deny' };
  }]);
  const blockCrossOrigin = (event, url) => {
    if (sameOrigin(url, state.origin)) return;
    state.navigation_block_count += 1;
    event?.preventDefault?.();
  };
  Reflect.apply(state.on, state.contents, ['will-navigate', blockCrossOrigin]);
  Reflect.apply(state.on, state.contents, ['will-frame-navigate', blockCrossOrigin]);
  Reflect.apply(state.on, state.contents, ['will-redirect', blockCrossOrigin]);
  Reflect.apply(state.on, state.contents, ['did-navigate', (_event, url) => {
    if (!sameOrigin(url, state.origin)) return;
    state.current_url = url;
    state.updated_at_ms = safeTimestamp(Reflect.apply(state.nowMs, undefined, []));
  }]);
  Reflect.apply(state.on, state.contents, ['did-navigate-in-page', (_event, url) => {
    if (!sameOrigin(url, state.origin)) return;
    state.current_url = url;
    state.updated_at_ms = safeTimestamp(Reflect.apply(state.nowMs, undefined, []));
  }]);
}

async function cleanupState(state, reason) {
  return builderPerformanceTrace.measureAsync('main.user_web.cleanup.duration_ms', async () => {
    if (state.status === 'stopped') return statusFor(state);
    state.status = 'stopped';
    state.message = 'Browser closed.';
    state.updated_at_ms = safeTimestamp(Reflect.apply(state.nowMs, undefined, []));
    let failed = false;
    try { detachState(state); } catch { failed = true; }
    try {
      if (!Reflect.apply(state.isDestroyed, state.contents, [])) {
        Reflect.apply(state.destroy, state.contents, []);
      }
    } catch {
      failed = true;
    }
    try {
      await state.browserSessionHandle.close({ reason });
    } catch {
      failed = true;
    }
    if (failed) fail('builder_user_web_cleanup_required');
    return statusFor(state);
  });
}

function reloadAndWait(state, timeoutMs) {
  return new Promise((resolve, reject) => {
    let timer = null;
    const cleanup = () => {
      if (timer !== null) clearTimeout(timer);
      Reflect.apply(state.removeListener, state.contents, ['did-finish-load', didFinish]);
      Reflect.apply(state.removeListener, state.contents, ['did-fail-load', didFail]);
    };
    const didFinish = () => {
      cleanup();
      resolve(true);
    };
    const didFail = () => {
      cleanup();
      reject(new BuilderUserWebMainServiceError('builder_user_web_load_failed'));
    };
    Reflect.apply(state.once, state.contents, ['did-finish-load', didFinish]);
    Reflect.apply(state.once, state.contents, ['did-fail-load', didFail]);
    timer = setTimeout(didFail, timeoutMs);
    try {
      Reflect.apply(state.reload, state.contents, []);
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

function createBuilderUserWebMainService(rawOptions) {
  const options = safeOptions(rawOptions);
  let activeState = null;

  async function navigateUnmeasured(rawRequest) {
    exactObject(rawRequest, NAVIGATE_KEYS);
    const target = normalizeUrl(rawRequest.url);
    if (activeState !== null) {
      await cleanupState(activeState, 'replaced');
      activeState = null;
    }
    const now = safeTimestamp(Reflect.apply(options.nowMs, undefined, []));
    const browserSession = createBuilderBrowserSession({
      session_class: 'user_web',
      project_id: null,
      owner_run_id: null,
      profile_id: PROFILE_ID,
      admitted_origins: [target.origin],
      persistence: 'ephemeral',
      created_at_ms: now,
      expires_at_ms: now + SESSION_TTL_MS,
    });
    const browserSessionHandle = await Reflect.apply(
      options.openBrowserSession,
      options.browserSessionRegistry,
      [{ browser_session: browserSession }],
    );
    let safeBrowser;
    try {
      const partition = browserSessionHandle.readMainOnlyPartition();
      const electronSession = safeElectronSession(browserSessionHandle.readMainOnlyElectronSession());
      safeBrowser = safeView(options.WebContentsView, partition);
      const state = {
        status: 'loading',
        current_url: target.url,
        origin: target.origin,
        message: 'Loading page...',
        updated_at_ms: now,
        navigation_block_count: 0,
        permission_block_count: 0,
        download_block_count: 0,
        window_open_block_count: 0,
        view: safeBrowser.view,
        contents: safeBrowser.contents,
        setBounds: safeBrowser.setBounds,
        setWindowOpenHandler: safeBrowser.setWindowOpenHandler,
        on: safeBrowser.on,
        destroy: safeBrowser.destroy,
        isDestroyed: safeBrowser.isDestroyed,
        canGoBack: safeBrowser.canGoBack,
        canGoForward: safeBrowser.canGoForward,
        goBack: safeBrowser.goBack,
        goForward: safeBrowser.goForward,
        reload: safeBrowser.reload,
        once: safeBrowser.once,
        removeListener: safeBrowser.removeListener,
        browserSessionHandle,
        mainWindowRef: options.mainWindowRef,
        nowMs: options.nowMs,
        attachedWindow: null,
        attachedContentView: null,
        removeChildView: null,
        view_bounds: null,
      };
      installPolicies(state, electronSession);
      activeState = state;
      await withTimeout(
        () => Reflect.apply(safeBrowser.loadURL, safeBrowser.contents, [target.url]),
        LOAD_TIMEOUT_MS,
      );
      state.status = 'ready';
      state.message = 'Page ready.';
      state.updated_at_ms = safeTimestamp(Reflect.apply(options.nowMs, undefined, []));
      return statusFor(state);
    } catch (error) {
      if (activeState !== null) {
        activeState.status = 'failed';
        activeState.message = 'The page could not be loaded.';
        activeState.updated_at_ms = safeTimestamp(Reflect.apply(options.nowMs, undefined, []));
        return statusFor(activeState);
      }
      try { await browserSessionHandle.close({ reason: 'interrupted' }); } catch { /* fixed error below */ }
      if (error instanceof BuilderUserWebMainServiceError) throw error;
      fail('builder_user_web_load_failed');
    }
  }

  function navigate(rawRequest) {
    return builderPerformanceTrace.measureAsync(
      'main.user_web.navigate.duration_ms',
      () => navigateUnmeasured(rawRequest),
    );
  }

  async function historyAction(direction) {
    if (activeState === null || activeState.status === 'stopped') return statusFor(activeState);
    const method = direction === 'back' ? activeState.goBack : activeState.goForward;
    const canMove = direction === 'back' ? activeState.canGoBack : activeState.canGoForward;
    if (Reflect.apply(canMove, activeState.contents, [])) {
      Reflect.apply(method, activeState.contents, []);
      activeState.updated_at_ms = safeTimestamp(Reflect.apply(options.nowMs, undefined, []));
    }
    return statusFor(activeState);
  }

  async function reload() {
    return builderPerformanceTrace.measureAsync('main.user_web.reload.duration_ms', async () => {
      if (activeState === null || activeState.status === 'stopped') return statusFor(activeState);
      activeState.status = 'loading';
      activeState.message = 'Reloading page...';
      activeState.updated_at_ms = safeTimestamp(Reflect.apply(options.nowMs, undefined, []));
      try {
        await reloadAndWait(activeState, LOAD_TIMEOUT_MS);
        activeState.status = 'ready';
        activeState.message = 'Page ready.';
      } catch {
        activeState.status = 'failed';
        activeState.message = 'The page could not be reloaded.';
      }
      activeState.updated_at_ms = safeTimestamp(Reflect.apply(options.nowMs, undefined, []));
      return statusFor(activeState);
    });
  }

  function updateLayout(rawRequest) {
    return builderPerformanceTrace.measureSync('main.user_web.layout.duration_ms', () => {
      exactObject(rawRequest, LAYOUT_KEYS);
      const bounds = safeBounds(rawRequest.view_bounds);
      if (activeState === null || activeState.status === 'stopped') return statusFor(activeState);
      if (bounds === null) detachState(activeState);
      else attachState(activeState, bounds);
      activeState.updated_at_ms = safeTimestamp(Reflect.apply(options.nowMs, undefined, []));
      return statusFor(activeState);
    });
  }

  return Object.freeze({
    service_version: BUILDER_USER_WEB_MAIN_SERVICE_VERSION,
    navigate,
    go_back() { return historyAction('back'); },
    go_forward() { return historyAction('forward'); },
    reload,
    async stop() {
      if (activeState === null) return statusFor(null);
      const state = activeState;
      activeState = null;
      return cleanupState(state, 'user_closed');
    },
    read_status() { return statusFor(activeState); },
    update_layout: updateLayout,
    async shutdown() {
      if (activeState !== null) {
        const state = activeState;
        activeState = null;
        await cleanupState(state, 'shutdown');
      }
      return Object.freeze({ disposed: true });
    },
  });
}

module.exports = Object.freeze({
  BUILDER_USER_WEB_MAIN_SERVICE_VERSION,
  BuilderUserWebMainServiceError,
  createBuilderUserWebMainService,
});
