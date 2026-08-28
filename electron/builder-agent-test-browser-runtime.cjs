'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const {
  sanitizeBuilderBrowserSession,
} = require('./builder-browser-session.cjs');
const {
  BUILDER_BROWSER_SESSION_REGISTRY_VERSION,
} = require('./builder-browser-session-registry.cjs');
const { builderPerformanceTrace } = require('./builder-performance-trace.cjs');

const BUILDER_AGENT_TEST_BROWSER_RUNTIME_VERSION = 'builder-agent-test-browser-runtime.v1';
const OPTION_KEYS = Object.freeze(['WebContentsView', 'browser_session_registry', 'mainWindowRef', 'now_ms']);
const OPTIONAL_OPTION_KEYS = Object.freeze(['timeouts']);
const TIMEOUT_KEYS = Object.freeze(['load_ms', 'script_ms', 'screenshot_ms']);
const START_KEYS = Object.freeze(['browser_session', 'entry_url']);
const MAX_VISIBLE_TEXT_BYTES = 16 * 1_024;
const MAX_ELEMENTS = 128;
const MAX_ACCESSIBILITY_NODES = 192;
const MAX_CONSOLE_REPORTS = 100;
const MAX_NETWORK_REPORTS = 100;
const DEFAULT_TIMEOUTS = Object.freeze({
  load_ms: 10_000,
  script_ms: 3_000,
  screenshot_ms: 1_500,
});
const FALLBACK_PANEL_WIDTH_PX = 400;
const FALLBACK_PANEL_MIN_WIDTH_PX = 320;
const FALLBACK_PANEL_RIGHT_INSET_PX = 8;
const LAYOUT_KEYS = Object.freeze(['owner_run_id', 'view_bounds']);
const VIEW_BOUNDS_KEYS = Object.freeze(['x', 'y', 'width', 'height']);
const RUN_ID_PATTERN = /^builder-run:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

class BuilderAgentTestBrowserRuntimeError extends Error {
  constructor(code = 'builder_agent_test_browser_invalid') {
    const selected = [
      'builder_agent_test_browser_invalid',
      'builder_agent_test_browser_conflict',
      'builder_agent_test_browser_closed',
      'builder_agent_test_browser_action_blocked',
      'builder_agent_test_browser_cleanup_required',
      'builder_agent_test_browser_operation_timeout',
    ].includes(code) ? code : 'builder_agent_test_browser_invalid';
    super('Builder Agent Test browser is unavailable.');
    this.name = 'BuilderAgentTestBrowserRuntimeError';
    this.code = selected;
    this.retryable = [
      'builder_agent_test_browser_cleanup_required',
      'builder_agent_test_browser_operation_timeout',
    ].includes(selected);
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) {
  throw new BuilderAgentTestBrowserRuntimeError(code);
}

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freezeDeep(nested);
    Object.freeze(value);
  }
  return value;
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
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.length || own.some((key) => typeof key !== 'string' || !keys.includes(key))) {
    fail();
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail();
  }
}

function exactObjectWithOptional(value, required, optional = []) {
  if (!isPlainObject(value)) fail();
  const own = Reflect.ownKeys(value);
  if (
    required.some((key) => !own.includes(key))
    || own.some((key) => typeof key !== 'string' || ![...required, ...optional].includes(key))
  ) fail();
  for (const key of own) {
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

function safeTimeouts(value) {
  if (value === undefined) return DEFAULT_TIMEOUTS;
  exactObject(value, TIMEOUT_KEYS);
  const selected = {};
  for (const key of TIMEOUT_KEYS) {
    const timeout = value[key];
    if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 60_000) fail();
    selected[key] = timeout;
  }
  return freezeDeep(selected);
}

async function withTimeout(promise, timeoutMs) {
  let timer = null;
  try {
    return await Promise.race([
      Promise.resolve(promise),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(
          new BuilderAgentTestBrowserRuntimeError('builder_agent_test_browser_operation_timeout'),
        ), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

function safeString(value, maximumBytes) {
  if (
    typeof value !== 'string'
    || value.includes('\0')
    || value.normalize('NFC') !== value
    || Buffer.byteLength(value, 'utf8') > maximumBytes
  ) fail();
  return value;
}

function safeEntryUrl(value, session) {
  const source = safeString(value, 2_048);
  let parsed;
  try { parsed = new URL(source); } catch { fail(); }
  if (
    parsed.protocol !== 'http:'
    || parsed.hostname !== '127.0.0.1'
    || parsed.username !== ''
    || parsed.password !== ''
    || !session.admitted_origins.includes(parsed.origin)
  ) fail();
  return parsed.href;
}

function sameAdmittedOrigin(value, session) {
  try { return session.admitted_origins.includes(new URL(value).origin); } catch { return false; }
}

function hasCaptureSurface(view) {
  if (typeof view?.getBounds !== 'function') return true;
  try {
    const bounds = view.getBounds();
    return Number.isSafeInteger(bounds?.width)
      && Number.isSafeInteger(bounds?.height)
      && bounds.width > 0
      && bounds.height > 0;
  } catch {
    return false;
  }
}

function optionalStableMethod(value, key) {
  try { return stableMethod(value, key); } catch { return null; }
}

function fallbackViewBounds(windowRef) {
  let width = 1_280;
  let height = 820;
  try {
    const bounds = Reflect.apply(stableMethod(windowRef, 'getContentBounds'), windowRef, []);
    if (
      isPlainObject(bounds)
      && Number.isSafeInteger(bounds.width)
      && Number.isSafeInteger(bounds.height)
      && bounds.width > 0
      && bounds.height > 0
    ) {
      width = bounds.width;
      height = bounds.height;
    }
  } catch {
    // A bounded fallback still keeps the local-only view inside the app window.
  }
  const availableWidth = Math.max(1, width - FALLBACK_PANEL_RIGHT_INSET_PX);
  const panelWidth = availableWidth < FALLBACK_PANEL_MIN_WIDTH_PX
    ? availableWidth
    : Math.min(FALLBACK_PANEL_WIDTH_PX, availableWidth);
  const y = Math.min(140, Math.max(88, Math.floor(height * 0.14)));
  return freezeDeep({
    x: Math.max(0, width - panelWidth - FALLBACK_PANEL_RIGHT_INSET_PX),
    y,
    width: panelWidth,
    height: Math.max(180, height - y - 24),
  });
}

function contentSize(windowRef) {
  const bounds = Reflect.apply(stableMethod(windowRef, 'getContentBounds'), windowRef, []);
  if (
    !isPlainObject(bounds)
    || !Number.isSafeInteger(bounds.width)
    || !Number.isSafeInteger(bounds.height)
    || bounds.width < 1
    || bounds.height < 1
  ) fail();
  return freezeDeep({ width: bounds.width, height: bounds.height });
}

function safeViewBounds(value) {
  if (value === null) return null;
  exactObject(value, VIEW_BOUNDS_KEYS);
  const bounds = Object.fromEntries(VIEW_BOUNDS_KEYS.map((key) => [key, value[key]]));
  if (
    VIEW_BOUNDS_KEYS.some((key) => !Number.isSafeInteger(bounds[key]))
    || bounds.x < 0
    || bounds.y < 0
    || bounds.width < 1
    || bounds.height < 1
    || VIEW_BOUNDS_KEYS.some((key) => bounds[key] > 100_000)
  ) fail();
  return freezeDeep(bounds);
}

function constrainViewBounds(windowRef, requestedBounds) {
  const size = contentSize(windowRef);
  const x = Math.min(requestedBounds.x, size.width - 1);
  const y = Math.min(requestedBounds.y, size.height - 1);
  return freezeDeep({
    x,
    y,
    width: Math.max(1, Math.min(requestedBounds.width, size.width - x)),
    height: Math.max(1, Math.min(requestedBounds.height, size.height - y)),
  });
}

function safeLayoutRequest(value) {
  exactObject(value, LAYOUT_KEYS);
  if (typeof value.owner_run_id !== 'string' || !RUN_ID_PATTERN.test(value.owner_run_id)) fail();
  return freezeDeep({
    owner_run_id: value.owner_run_id,
    view_bounds: safeViewBounds(value.view_bounds),
  });
}

function attachView(mainWindowRef, view) {
  const windowRef = Reflect.apply(mainWindowRef, undefined, []);
  if (windowRef === null || typeof windowRef !== 'object' || utilTypes.isProxy(windowRef)) fail();
  const contentView = windowRef.contentView;
  if (contentView === null || typeof contentView !== 'object' || utilTypes.isProxy(contentView)) fail();
  const addChildView = stableMethod(contentView, 'addChildView');
  const removeChildView = stableMethod(contentView, 'removeChildView');
  const setBounds = stableMethod(view, 'setBounds');
  const setVisible = optionalStableMethod(view, 'setVisible');
  const bounds = fallbackViewBounds(windowRef);
  Reflect.apply(setBounds, view, [bounds]);
  if (setVisible !== null) Reflect.apply(setVisible, view, [false]);
  Reflect.apply(addChildView, contentView, [view]);
  let attached = true;
  return {
    bounds: null,
    hide() {
      if (!attached || setVisible === null) return false;
      Reflect.apply(setVisible, view, [false]);
      return true;
    },
    update(nextBounds) {
      if (!attached) return false;
      Reflect.apply(setBounds, view, [nextBounds]);
      if (setVisible !== null) Reflect.apply(setVisible, view, [true]);
      return true;
    },
    detach() {
      if (!attached) return;
      attached = false;
      try { Reflect.apply(removeChildView, contentView, [view]); } catch { /* destruction still follows */ }
    },
  };
}

function observationScript() {
  return `(() => {
    const pathFor = (element) => {
      const parts = [];
      let current = element;
      while (current && current.nodeType === 1 && parts.length < 12) {
        let part = current.tagName.toLowerCase();
        if (current.id) {
          part += '#' + CSS.escape(current.id);
          parts.unshift(part);
          break;
        }
        const parent = current.parentElement;
        if (parent) {
          const siblings = Array.from(parent.children).filter((item) => item.tagName === current.tagName);
          if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(current) + 1) + ')';
        }
        parts.unshift(part);
        current = parent;
      }
      return parts.join(' > ');
    };
    const candidates = Array.from(document.querySelectorAll('a,button,input,textarea,select,[role],[tabindex]'))
      .filter((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
      }).slice(0, ${MAX_ELEMENTS});
    const roleFor = (element) => {
      const explicit = element.getAttribute('role');
      if (explicit) return explicit;
      const tag = element.tagName.toLowerCase();
      if (/^h[1-6]$/.test(tag)) return 'heading';
      if (tag === 'a' && element.hasAttribute('href')) return 'link';
      if (tag === 'button') return 'button';
      if (tag === 'nav') return 'navigation';
      if (tag === 'main') return 'main';
      if (tag === 'form') return 'form';
      if (tag === 'img') return 'img';
      if (tag === 'input') return element.type === 'checkbox' ? 'checkbox' : element.type === 'radio' ? 'radio' : 'textbox';
      if (tag === 'textarea') return 'textbox';
      if (tag === 'select') return 'combobox';
      return tag;
    };
    const nameFor = (element) => {
      const labelledBy = element.getAttribute('aria-labelledby');
      const labelled = labelledBy ? labelledBy.split(/\\s+/).map((id) => document.getElementById(id)?.innerText || '').join(' ').trim() : '';
      return (element.getAttribute('aria-label') || labelled || element.getAttribute('alt') || element.innerText || element.getAttribute('placeholder') || '').trim().slice(0, 512);
    };
    const semantic = Array.from(document.querySelectorAll('main,nav,header,footer,form,section,h1,h2,h3,h4,h5,h6,a,button,input,textarea,select,img,[role]'))
      .filter((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
      }).slice(0, ${MAX_ACCESSIBILITY_NODES});
    return {
      url: location.href,
      title: document.title || '',
      ready_state: document.readyState,
      visible_text: (document.body?.innerText || '').slice(0, ${MAX_VISIBLE_TEXT_BYTES}),
      viewport: { width: innerWidth, height: innerHeight, scroll_x: scrollX, scroll_y: scrollY },
      elements: candidates.map((element) => ({
        selector: pathFor(element),
        role: roleFor(element),
        name: nameFor(element),
        disabled: Boolean(element.disabled || element.getAttribute('aria-disabled') === 'true')
      })),
      accessibility_nodes: semantic.map((element) => ({
        role: roleFor(element),
        name: nameFor(element),
        disabled: Boolean(element.disabled || element.getAttribute('aria-disabled') === 'true'),
        checked: element.getAttribute('aria-checked') === 'true' || Boolean(element.checked),
        selected: element.getAttribute('aria-selected') === 'true' || Boolean(element.selected),
        expanded: element.getAttribute('aria-expanded') === 'true'
      }))
    };
  })()`;
}

function actionScript(kind, selector, value = '') {
  const selected = JSON.stringify(selector);
  const supplied = JSON.stringify(value);
  if (kind === 'click') return `(() => { const e=document.querySelector(${selected}); if(!e) return false; e.click(); return true; })()`;
  if (kind === 'type') return `(() => { const e=document.querySelector(${selected}); if(!e || !('value' in e)) return false; e.focus(); e.value=${supplied}; e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true})); return true; })()`;
  if (kind === 'select_option') return `(() => { const e=document.querySelector(${selected}); if(!(e instanceof HTMLSelectElement)) return false; e.value=${supplied}; e.dispatchEvent(new Event('change',{bubbles:true})); return true; })()`;
  fail();
}

function safeObservation(raw, state) {
  if (
    !isPlainObject(raw)
    || !Array.isArray(raw.elements)
    || !Array.isArray(raw.accessibility_nodes)
    || !isPlainObject(raw.viewport)
  ) fail();
  const url = safeEntryUrl(raw.url, state.session);
  const elements = [];
  state.elementSelectors.clear();
  for (const item of raw.elements.slice(0, MAX_ELEMENTS)) {
    if (!isPlainObject(item)) fail();
    const selector = safeString(item.selector, 2_048);
    const elementRef = `browser-element:${nodeCrypto.createHash('sha256')
      .update(`${state.observationSequence}:${selector}`, 'utf8').digest('hex')}`;
    state.elementSelectors.set(elementRef, selector);
    elements.push(freezeDeep({
      element_ref: elementRef,
      role: safeString(item.role, 128),
      name: safeString(item.name, 512),
      disabled: item.disabled === true,
    }));
  }
  const visibleText = safeString(raw.visible_text, MAX_VISIBLE_TEXT_BYTES);
  const accessibility = raw.accessibility_nodes.slice(0, MAX_ACCESSIBILITY_NODES).map((item) => {
    if (!isPlainObject(item)) fail();
    return freezeDeep({
      role: safeString(item.role, 128),
      name: safeString(item.name, 512),
      disabled: item.disabled === true,
      checked: item.checked === true,
      selected: item.selected === true,
      expanded: item.expanded === true,
    });
  });
  return freezeDeep({
    url,
    title: safeString(raw.title, 2_048),
    ready_state: ['loading', 'interactive', 'complete'].includes(raw.ready_state) ? raw.ready_state : 'loading',
    visible_text: visibleText,
    viewport: {
      width: Number.isSafeInteger(raw.viewport.width) ? raw.viewport.width : 0,
      height: Number.isSafeInteger(raw.viewport.height) ? raw.viewport.height : 0,
      scroll_x: Number.isFinite(raw.viewport.scroll_x) ? Math.trunc(raw.viewport.scroll_x) : 0,
      scroll_y: Number.isFinite(raw.viewport.scroll_y) ? Math.trunc(raw.viewport.scroll_y) : 0,
    },
    elements: Object.freeze(elements),
    accessibility: Object.freeze(accessibility),
  });
}

function screenshotPixelStatus(image, size) {
  if (!size || !Number.isSafeInteger(size.width) || !Number.isSafeInteger(size.height)) return 'unavailable';
  const toBitmap = optionalStableMethod(image, 'toBitmap');
  if (toBitmap === null) return 'unavailable';
  let bitmap;
  try { bitmap = Reflect.apply(toBitmap, image, []); } catch { return 'unavailable'; }
  if (!Buffer.isBuffer(bitmap) || bitmap.length < 4) return 'unavailable';
  const pixelCount = Math.floor(bitmap.length / 4);
  const step = Math.max(1, Math.floor(pixelCount / 4_096));
  const baseline = [bitmap[0], bitmap[1], bitmap[2], bitmap[3]];
  for (let pixel = step; pixel < pixelCount; pixel += step) {
    const offset = pixel * 4;
    if (
      Math.abs(bitmap[offset] - baseline[0]) > 4
      || Math.abs(bitmap[offset + 1] - baseline[1]) > 4
      || Math.abs(bitmap[offset + 2] - baseline[2]) > 4
      || Math.abs(bitmap[offset + 3] - baseline[3]) > 4
    ) return 'nonblank';
  }
  return 'blank';
}

function consoleLevel(value) {
  if (value >= 3) return 'error';
  if (value === 2) return 'warning';
  if (value === 1) return 'info';
  return 'debug';
}

function createBuilderAgentTestBrowserRuntime(rawOptions) {
  exactObjectWithOptional(rawOptions, OPTION_KEYS, OPTIONAL_OPTION_KEYS);
  const WebContentsView = rawOptions.WebContentsView;
  const browserSessionRegistry = rawOptions.browser_session_registry;
  const mainWindowRef = rawOptions.mainWindowRef;
  const nowMs = rawOptions.now_ms;
  const timeouts = safeTimeouts(rawOptions.timeouts);
  if (
    typeof WebContentsView !== 'function'
    || !isPlainObject(browserSessionRegistry)
    || browserSessionRegistry.registry_version !== BUILDER_BROWSER_SESSION_REGISTRY_VERSION
    || typeof mainWindowRef !== 'function'
    || typeof nowMs !== 'function'
  ) fail();
  const registryOpen = stableMethod(browserSessionRegistry, 'open');
  const active = new Map();
  const lifecycleSubscribers = new Set();

  function publishLifecycle(state, lifecycle) {
    const event = freezeDeep({
      event_version: 'builder-agent-test-browser-lifecycle-event.v1',
      owner_run_id: state.session.owner_run_id,
      session_id: state.session.session_id,
      lifecycle,
    });
    for (const subscriber of lifecycleSubscribers) {
      try { subscriber(event); } catch { /* lifecycle observers cannot affect browser authority */ }
    }
  }

  function updateLayoutUnmeasured(rawRequest) {
    const request = safeLayoutRequest(rawRequest);
    const matches = [...active.values()].filter((state) => (
      state.status !== 'closed' && state.session.owner_run_id === request.owner_run_id
    ));
    if (matches.length > 1) fail('builder_agent_test_browser_conflict');
    const state = matches[0] ?? null;
    if (state === null || state.attachment === null) {
      return freezeDeep({
        result_version: 'builder-agent-test-browser-layout-result.v1',
        owner_run_id: request.owner_run_id,
        operation: 'not_active',
        visible: false,
        applied_bounds: null,
      });
    }
    const bounds = request.view_bounds === null
      ? null
      : constrainViewBounds(Reflect.apply(mainWindowRef, undefined, []), request.view_bounds);
    if (bounds === null) state.attachment.hide();
    else state.attachment.update(bounds);
    return freezeDeep({
      result_version: 'builder-agent-test-browser-layout-result.v1',
      owner_run_id: request.owner_run_id,
      operation: 'layout_updated',
      visible: bounds !== null,
      applied_bounds: bounds,
    });
  }

  function updateLayout(rawRequest) {
    return builderPerformanceTrace.measureSync(
      'main.agent_test_browser.layout.duration_ms',
      () => updateLayoutUnmeasured(rawRequest),
    );
  }

  async function closeState(state, reason = 'completed') {
    if (state.status === 'closed') return false;
    state.status = 'closed';
    let failed = false;
    try { state.attachment?.detach(); } catch { failed = true; }
    state.attachment = null;
    try { if (!state.webContents.isDestroyed()) state.webContents.destroy(); } catch { failed = true; }
    try { await state.sessionHandle.close({ reason }); } catch { failed = true; }
    active.delete(state.session.session_id);
    publishLifecycle(state, 'closed');
    if (failed) fail('builder_agent_test_browser_cleanup_required');
    return true;
  }

  async function start(rawInput) {
    exactObject(rawInput, START_KEYS);
    const browserSession = sanitizeBuilderBrowserSession(rawInput.browser_session);
    if (browserSession.session_class !== 'agent_test') fail();
    const now = safeTimestamp(nowMs());
    if (browserSession.expires_at_ms === null || now >= browserSession.expires_at_ms) fail();
    if (active.has(browserSession.session_id)) fail('builder_agent_test_browser_conflict');
    const entryUrl = safeEntryUrl(rawInput.entry_url, browserSession);
    const sessionHandle = await Reflect.apply(registryOpen, browserSessionRegistry, [{
      browser_session: browserSession,
    }]);
    if (!isPlainObject(sessionHandle)) fail();
    let partition;
    let electronSession;
    let webRequest;
    let view;
    let webContents;
    try {
      const readMainOnlyPartition = stableMethod(sessionHandle, 'readMainOnlyPartition');
      const readMainOnlyElectronSession = stableMethod(sessionHandle, 'readMainOnlyElectronSession');
      partition = Reflect.apply(readMainOnlyPartition, sessionHandle, []);
      electronSession = Reflect.apply(readMainOnlyElectronSession, sessionHandle, []);
      if (!electronSession || utilTypes.isProxy(electronSession)) fail();
      webRequest = electronSession.webRequest;
      if (!webRequest || utilTypes.isProxy(webRequest)) fail();
      view = new WebContentsView({
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          webSecurity: true,
          devTools: false,
          webviewTag: false,
          allowRunningInsecureContent: false,
          partition,
        },
      });
      webContents = view.webContents;
    } catch (error) {
      try { await sessionHandle.close({ reason: 'interrupted' }); } catch { /* fixed failure below */ }
      if (error instanceof BuilderAgentTestBrowserRuntimeError) throw error;
      fail();
    }
    const state = {
      session: browserSession,
      entryUrl,
      partition,
      view,
      webContents,
      electronSession,
      sessionHandle,
      status: 'loading',
      consoleReports: [],
      networkReports: [],
      blockedRequestCount: 0,
      elementSelectors: new Map(),
      observationSequence: 0,
      latestObservationDigest: null,
      startedAtMs: now,
      attachment: null,
    };
    electronSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    electronSession.setPermissionCheckHandler(() => false);
    electronSession.on('will-download', (event) => event?.preventDefault?.());
    webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    const blockNavigation = (event, url) => {
      if (sameAdmittedOrigin(url, browserSession)) return;
      state.blockedRequestCount += 1;
      event?.preventDefault?.();
    };
    webContents.on('will-navigate', blockNavigation);
    webContents.on('will-frame-navigate', blockNavigation);
    webContents.on('console-message', (_event, level, message, line, sourceId) => {
      if (state.consoleReports.length >= MAX_CONSOLE_REPORTS) return;
      state.consoleReports.push(freezeDeep({
        level: consoleLevel(Number.isSafeInteger(level) ? level : 0),
        message: typeof message === 'string' ? message.slice(0, 512) : '',
        line: Number.isSafeInteger(line) ? line : 0,
        source: typeof sourceId === 'string' ? sourceId.slice(0, 256) : '',
      }));
    });
    webRequest.onBeforeRequest(
      { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*', 'file:///*'] },
      (details, callback) => {
        const allowed = details && sameAdmittedOrigin(details.url, browserSession);
        if (!allowed) state.blockedRequestCount += 1;
        callback({ cancel: !allowed });
      },
    );
    if (typeof webRequest.onCompleted === 'function') {
      webRequest.onCompleted({ urls: ['http://*/*', 'ws://*/*'] }, (details) => {
        if (state.networkReports.length >= MAX_NETWORK_REPORTS || !sameAdmittedOrigin(details.url, browserSession)) return;
        const parsed = new URL(details.url);
        state.networkReports.push(freezeDeep({
          method: typeof details.method === 'string' ? details.method.slice(0, 16) : 'GET',
          path: parsed.pathname.slice(0, 512),
          status_code: Number.isSafeInteger(details.statusCode) ? details.statusCode : 0,
          outcome: 'completed',
        }));
      });
    }
    if (typeof webRequest.onErrorOccurred === 'function') {
      webRequest.onErrorOccurred({ urls: ['http://*/*', 'ws://*/*'] }, (details) => {
        if (state.networkReports.length >= MAX_NETWORK_REPORTS || !sameAdmittedOrigin(details.url, browserSession)) return;
        const parsed = new URL(details.url);
        state.networkReports.push(freezeDeep({
          method: typeof details.method === 'string' ? details.method.slice(0, 16) : 'GET',
          path: parsed.pathname.slice(0, 512),
          status_code: 0,
          outcome: 'failed',
          error: typeof details.error === 'string' ? details.error.slice(0, 128) : 'network_error',
        }));
      });
    }
    active.set(browserSession.session_id, state);
    try {
      state.attachment = attachView(mainWindowRef, view);
      publishLifecycle(state, 'opened');
      await withTimeout(webContents.loadURL(entryUrl), timeouts.load_ms);
      state.status = 'ready';
    } catch {
      try { await closeState(state, 'interrupted'); } catch { /* fixed failure below */ }
      fail('builder_agent_test_browser_closed');
    }

    async function observe() {
      if (state.status !== 'ready') fail('builder_agent_test_browser_closed');
      const observationStartedAt = safeTimestamp(nowMs());
      state.observationSequence += 1;
      const page = safeObservation(await withTimeout(
        webContents.executeJavaScript(observationScript(), true),
        timeouts.script_ms,
      ), state);
      let screenshotDigest = null;
      let screenshotSize = null;
      let screenshotCaptureStatus = 'unavailable';
      let screenshotPixelEvidence = 'unavailable';
      if (typeof webContents.capturePage === 'function' && hasCaptureSurface(view)) {
        try {
          const image = await withTimeout(webContents.capturePage(), timeouts.screenshot_ms);
          const bytes = image?.toPNG?.();
          const size = image?.getSize?.();
          if (Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= 8 * 1024 * 1024) {
            screenshotDigest = `sha256:${nodeCrypto.createHash('sha256').update(bytes).digest('hex')}`;
            screenshotCaptureStatus = 'captured';
          } else {
            screenshotCaptureStatus = 'failed';
          }
          if (size && Number.isSafeInteger(size.width) && Number.isSafeInteger(size.height)) {
            screenshotSize = freezeDeep({ width: size.width, height: size.height });
          }
          screenshotPixelEvidence = screenshotPixelStatus(image, size);
        } catch (error) {
          screenshotCaptureStatus = error?.code === 'builder_agent_test_browser_operation_timeout'
            ? 'timed_out'
            : 'failed';
        }
      }
      const observedAtMs = safeTimestamp(nowMs());
      const body = {
        session_id: state.session.session_id,
        owner_run_id: state.session.owner_run_id,
        observed_at_ms: observedAtMs,
        observation_duration_ms: Math.max(0, observedAtMs - observationStartedAt),
        ...page,
        console_reports: Object.freeze([...state.consoleReports]),
        network_reports: Object.freeze([...state.networkReports]),
        blocked_request_count: state.blockedRequestCount,
        screenshot_digest: screenshotDigest,
        screenshot_size: screenshotSize,
        screenshot_capture_status: screenshotCaptureStatus,
        screenshot_pixel_status: screenshotPixelEvidence,
      };
      const digest = nodeCrypto.createHash('sha256').update(JSON.stringify(body), 'utf8').digest('hex');
      const observation = freezeDeep({
        observation_version: 'builder-agent-test-browser-observation.v1',
        observation_digest: `sha256:${digest}`,
        ...body,
      });
      state.latestObservationDigest = observation.observation_digest;
      return observation;
    }

    async function observeAfterAction(actionKind, action) {
      const beforeObservationDigest = state.latestObservationDigest;
      if (beforeObservationDigest === null) fail('builder_agent_test_browser_action_blocked');
      await withTimeout(action(), timeouts.script_ms);
      const afterObservation = await observe();
      return freezeDeep({
        ...afterObservation,
        action_receipt: freezeDeep({
          receipt_version: 'builder-agent-test-browser-action-receipt.v1',
          action_kind: actionKind,
          before_observation_digest: beforeObservationDigest,
          after_observation_digest: afterObservation.observation_digest,
        }),
      });
    }

    async function act(kind, rawRequest) {
      exactObject(rawRequest, kind === 'click' ? ['element_ref'] : ['element_ref', 'value']);
      const elementRef = safeString(rawRequest.element_ref, 96);
      const selector = state.elementSelectors.get(elementRef);
      if (selector === undefined) fail('builder_agent_test_browser_action_blocked');
      const value = kind === 'click' ? '' : safeString(rawRequest.value, 16 * 1_024);
      return observeAfterAction(kind, async () => {
        const completed = await webContents.executeJavaScript(actionScript(kind, selector, value), true);
        if (completed !== true) fail('builder_agent_test_browser_action_blocked');
      });
    }

    return freezeDeep({
      handle_version: 'builder-agent-test-browser-handle.v1',
      session_id: browserSession.session_id,
      owner_run_id: browserSession.owner_run_id,
      observe,
      click: (request) => act('click', request),
      type: (request) => act('type', request),
      select_option: (request) => act('select_option', request),
      async press_key(rawRequest) {
        exactObject(rawRequest, ['key']);
        const key = safeString(rawRequest.key, 64);
        return observeAfterAction('press_key', async () => {
          const completed = await webContents.executeJavaScript(`(() => { const e=document.activeElement || document.body; e.dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(key)},bubbles:true})); e.dispatchEvent(new KeyboardEvent('keyup',{key:${JSON.stringify(key)},bubbles:true})); return true; })()`, true);
          if (completed !== true) fail('builder_agent_test_browser_action_blocked');
        });
      },
      async scroll(rawRequest) {
        exactObject(rawRequest, ['delta_x', 'delta_y']);
        if (!Number.isSafeInteger(rawRequest.delta_x) || !Number.isSafeInteger(rawRequest.delta_y)) fail();
        const x = Math.max(-10_000, Math.min(10_000, rawRequest.delta_x));
        const y = Math.max(-10_000, Math.min(10_000, rawRequest.delta_y));
        return observeAfterAction('scroll', () => webContents.executeJavaScript(`(() => { scrollBy(${x},${y}); return true; })()`, true));
      },
      async reload() {
        if (state.status !== 'ready') fail('builder_agent_test_browser_closed');
        await withTimeout(webContents.loadURL(entryUrl), timeouts.load_ms);
        state.elementSelectors.clear();
        return observe();
      },
      readStatus() {
        return freezeDeep({
          status_version: 'builder-agent-test-browser-status.v1',
          session_id: browserSession.session_id,
          owner_run_id: browserSession.owner_run_id,
          status: state.status,
          entry_url: state.entryUrl,
          blocked_request_count: state.blockedRequestCount,
          started_at_ms: state.startedAtMs,
        });
      },
      readMainOnlyWebContentsViewForAttachment() { return view; },
      close(rawRequest = undefined) {
        const reason = rawRequest === undefined ? 'completed' : rawRequest.reason;
        if (rawRequest !== undefined) exactObject(rawRequest, ['reason']);
        if (!['completed', 'cancelled', 'replaced', 'shutdown', 'interrupted'].includes(reason)) fail();
        return closeState(state, reason);
      },
    });
  }

  return freezeDeep({
    runtime_version: BUILDER_AGENT_TEST_BROWSER_RUNTIME_VERSION,
    start,
    updateLayout,
    async stop(rawRequest) {
      exactObject(rawRequest, ['owner_run_id']);
      const ownerRunId = safeString(rawRequest.owner_run_id, 96);
      const state = [...active.values()].find((candidate) => (
        candidate.session.owner_run_id === ownerRunId
      ));
      if (!state) return freezeDeep({ closed: false, owner_run_id: ownerRunId });
      await closeState(state, 'cancelled');
      return freezeDeep({ closed: true, owner_run_id: ownerRunId });
    },
    subscribeLifecycle(subscriber) {
      if (typeof subscriber !== 'function' || utilTypes.isProxy(subscriber)) fail();
      lifecycleSubscribers.add(subscriber);
      return () => lifecycleSubscribers.delete(subscriber);
    },
    activeCount: () => active.size,
    async dispose() {
      await Promise.all([...active.values()].map((state) => closeState(state, 'shutdown')));
      return freezeDeep({ disposed: true });
    },
  });
}

module.exports = freezeDeep({
  BUILDER_AGENT_TEST_BROWSER_RUNTIME_VERSION,
  BuilderAgentTestBrowserRuntimeError,
  createBuilderAgentTestBrowserRuntime,
});
