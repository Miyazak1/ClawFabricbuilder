'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createBuilderBrowserSession,
} = require('../electron/builder-browser-session.cjs');
const {
  BuilderAgentTestBrowserRuntimeError,
  createBuilderAgentTestBrowserRuntime,
} = require('../electron/builder-agent-test-browser-runtime.cjs');
const {
  createBuilderBrowserSessionRegistry,
} = require('../electron/builder-browser-session-registry.cjs');

const PROJECT_ID = 'builder-project:11111111-1111-4111-8111-111111111111';
const RUN_ID = 'builder-run:22222222-2222-4222-8222-222222222222';
const ORIGIN = 'http://127.0.0.1:43210';

function browserSession(overrides = {}) {
  return createBuilderBrowserSession({
    session_class: 'agent_test',
    project_id: PROJECT_ID,
    owner_run_id: RUN_ID,
    profile_id: null,
    admitted_origins: [ORIGIN],
    persistence: 'ephemeral',
    created_at_ms: 1_000,
    expires_at_ms: 60_000,
    ...overrides,
  });
}

function electronHarness() {
  const sessions = [];
  const views = [];
  class WebContentsView {
    constructor(options) {
      const handlers = new Map();
      let destroyed = false;
      const webContents = {
        handlers,
        loadedUrls: [],
        scripts: [],
        setWindowOpenHandler(handler) { webContents.windowOpenHandler = handler; },
        on(name, handler) { handlers.set(name, handler); },
        async loadURL(url) { webContents.loadedUrls.push(url); },
        async executeJavaScript(script) {
          webContents.scripts.push(script);
          if (script.includes('const pathFor')) {
            return {
              url: `${ORIGIN}/index.html`,
              title: 'Agent test fixture',
              ready_state: 'complete',
              visible_text: 'Save changes',
              viewport: { width: 800, height: 600, scroll_x: 0, scroll_y: 0 },
              elements: [{ selector: '#save', role: 'button', name: 'Save', disabled: false }],
              accessibility_nodes: [{
                role: 'button', name: 'Save', disabled: false, checked: false, selected: false, expanded: false,
              }],
            };
          }
          return true;
        },
        async capturePage() {
          return {
            toPNG: () => Buffer.from('fake-image'),
            getSize: () => ({ width: 800, height: 600 }),
            toBitmap: () => Buffer.from([255, 255, 255, 255, 0, 0, 0, 255]),
          };
        },
        destroy() { destroyed = true; },
        isDestroyed() { return destroyed; },
      };
      this.options = options;
      this.webContents = webContents;
      this.bounds = { x: 0, y: 0, width: 0, height: 0 };
      this.visible = false;
      this.setBounds = (bounds) => { this.bounds = { ...bounds }; };
      this.getBounds = () => ({ ...this.bounds });
      this.setVisible = (visible) => { this.visible = visible; };
      views.push(this);
    }
  }
  const session = {
    fromPartition(partition) {
      const handlers = new Map();
      const webRequest = {
        onBeforeRequest(filter, handler) { webRequest.beforeFilter = filter; webRequest.before = handler; },
        onCompleted(filter, handler) { webRequest.completeFilter = filter; webRequest.complete = handler; },
        onErrorOccurred(filter, handler) { webRequest.errorFilter = filter; webRequest.error = handler; },
      };
      const item = {
        partition,
        handlers,
        webRequest,
        setPermissionRequestHandler(handler) { item.permissionRequest = handler; },
        setPermissionCheckHandler(handler) { item.permissionCheck = handler; },
        on(name, handler) { handlers.set(name, handler); },
        async clearStorageData(options) { item.cleared = options; },
      };
      sessions.push(item);
      return item;
    },
  };
  const contentView = {
    children: [],
    addChildView(view) { contentView.children.push(view); },
    removeChildView(view) {
      contentView.children = contentView.children.filter((item) => item !== view);
    },
  };
  const mainWindow = {
    contentView,
    getContentBounds() { return { x: 0, y: 0, width: 1_280, height: 820 }; },
  };
  const browserSessionRegistry = createBuilderBrowserSessionRegistry({
    session,
    now_ms: () => 2_000,
    cleanup_timeout_ms: 50,
  });
  return {
    WebContentsView,
    session,
    browserSessionRegistry,
    sessions,
    views,
    contentView,
    mainWindowRef: () => mainWindow,
  };
}

test('opens an isolated run-bound Agent Test session and returns bounded evidence', async () => {
  const harness = electronHarness();
  const runtime = createBuilderAgentTestBrowserRuntime({
    WebContentsView: harness.WebContentsView,
    browser_session_registry: harness.browserSessionRegistry,
    mainWindowRef: harness.mainWindowRef,
    now_ms: () => 2_000,
  });
  const handle = await runtime.start({
    browser_session: browserSession(),
    entry_url: `${ORIGIN}/index.html`,
  });

  assert.equal(runtime.activeCount(), 1);
  assert.equal(harness.sessions[0].partition.startsWith('builder-agent-test-'), true);
  assert.equal(harness.sessions[0].partition.startsWith('persist:'), false);
  assert.deepEqual(harness.views[0].options.webPreferences, {
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
    devTools: false,
    webviewTag: false,
    allowRunningInsecureContent: false,
    partition: harness.sessions[0].partition,
  });
  assert.deepEqual(harness.views[0].getBounds(), {
    x: 872, y: 114, width: 400, height: 682,
  });
  assert.equal(harness.views[0].visible, false);
  assert.deepEqual(harness.contentView.children, [harness.views[0]]);
  const observation = await handle.observe();
  assert.equal(observation.visible_text, 'Save changes');
  assert.equal(observation.elements[0].name, 'Save');
  assert.match(observation.elements[0].element_ref, /^browser-element:[0-9a-f]{64}$/u);
  assert.match(observation.screenshot_digest, /^sha256:[0-9a-f]{64}$/u);
  assert.deepEqual(observation.screenshot_size, { width: 800, height: 600 });
  assert.equal(observation.screenshot_capture_status, 'captured');
  assert.equal(observation.screenshot_pixel_status, 'nonblank');
  assert.deepEqual(observation.accessibility[0], {
    role: 'button', name: 'Save', disabled: false, checked: false, selected: false, expanded: false,
  });

  const afterClick = await handle.click({ element_ref: observation.elements[0].element_ref });
  assert.equal(afterClick.observation_version, 'builder-agent-test-browser-observation.v1');
  assert.deepEqual(afterClick.action_receipt, {
    receipt_version: 'builder-agent-test-browser-action-receipt.v1',
    action_kind: 'click',
    before_observation_digest: observation.observation_digest,
    after_observation_digest: afterClick.observation_digest,
  });
  assert.equal(harness.views[0].webContents.scripts.some((script) => script.includes("querySelector(\"#save\")")), true);
});

test('blocks external navigation, network, permissions, downloads, and windows', async () => {
  const harness = electronHarness();
  const runtime = createBuilderAgentTestBrowserRuntime({
    WebContentsView: harness.WebContentsView,
    browser_session_registry: harness.browserSessionRegistry,
    mainWindowRef: harness.mainWindowRef,
    now_ms: () => 2_000,
  });
  const handle = await runtime.start({
    browser_session: browserSession(),
    entry_url: `${ORIGIN}/index.html`,
  });
  const electronSession = harness.sessions[0];
  const webContents = harness.views[0].webContents;

  let permissionAllowed = true;
  electronSession.permissionRequest({}, 'camera', (allowed) => { permissionAllowed = allowed; });
  assert.equal(permissionAllowed, false);
  assert.equal(electronSession.permissionCheck(), false);
  assert.deepEqual(webContents.windowOpenHandler({ url: `${ORIGIN}/popup` }), { action: 'deny' });
  let navigationPrevented = false;
  webContents.handlers.get('will-navigate')({ preventDefault() { navigationPrevented = true; } }, 'https://example.com');
  assert.equal(navigationPrevented, true);
  let networkDecision;
  electronSession.webRequest.before({ url: 'https://example.com/a' }, (decision) => { networkDecision = decision; });
  assert.deepEqual(networkDecision, { cancel: true });
  electronSession.webRequest.error({
    url: `${ORIGIN}/missing.js`, method: 'GET', error: 'net::ERR_CONNECTION_RESET',
  });
  webContents.handlers.get('console-message')({}, 3, 'ReferenceError: missing', 7, `${ORIGIN}/index.html`);
  const observation = await handle.observe();
  assert.deepEqual(observation.network_reports[0], {
    method: 'GET', path: '/missing.js', status_code: 0, outcome: 'failed', error: 'net::ERR_CONNECTION_RESET',
  });
  assert.equal(observation.console_reports[0].level, 'error');
  let downloadPrevented = false;
  electronSession.handlers.get('will-download')({ preventDefault() { downloadPrevented = true; } });
  assert.equal(downloadPrevented, true);
  assert.equal(handle.readStatus().blocked_request_count, 2);
});

test('rejects external entry URLs and stale element references', async () => {
  const harness = electronHarness();
  const runtime = createBuilderAgentTestBrowserRuntime({
    WebContentsView: harness.WebContentsView,
    browser_session_registry: harness.browserSessionRegistry,
    mainWindowRef: harness.mainWindowRef,
    now_ms: () => 2_000,
  });
  await assert.rejects(
    runtime.start({ browser_session: browserSession(), entry_url: 'https://example.com/' }),
    BuilderAgentTestBrowserRuntimeError,
  );
  const handle = await runtime.start({
    browser_session: browserSession(),
    entry_url: `${ORIGIN}/index.html`,
  });
  await assert.rejects(
    handle.click({ element_ref: `browser-element:${'a'.repeat(64)}` }),
    (error) => error.code === 'builder_agent_test_browser_action_blocked',
  );
});

test('does not report an empty hidden-view capture as valid screenshot evidence', async () => {
  const harness = electronHarness();
  const OriginalView = harness.WebContentsView;
  harness.WebContentsView = class extends OriginalView {
    constructor(options) {
      super(options);
      this.webContents.capturePage = async () => ({
        toPNG: () => Buffer.alloc(0),
        getSize: () => ({ width: 800, height: 600 }),
      });
    }
  };
  const runtime = createBuilderAgentTestBrowserRuntime({
    WebContentsView: harness.WebContentsView,
    browser_session_registry: harness.browserSessionRegistry,
    mainWindowRef: harness.mainWindowRef,
    now_ms: () => 2_000,
  });
  const handle = await runtime.start({
    browser_session: browserSession(),
    entry_url: `${ORIGIN}/index.html`,
  });

  const observation = await handle.observe();
  assert.equal(observation.screenshot_digest, null);
  assert.deepEqual(observation.screenshot_size, { width: 800, height: 600 });
  assert.equal(observation.screenshot_capture_status, 'failed');
  assert.equal(observation.screenshot_pixel_status, 'unavailable');
});

test('does not wait for capturePage while the Agent Test view is unattached', async () => {
  const harness = electronHarness();
  const OriginalView = harness.WebContentsView;
  let captureCalled = false;
  harness.WebContentsView = class extends OriginalView {
    constructor(options) {
      super(options);
      this.getBounds = () => ({ x: 0, y: 0, width: 0, height: 0 });
      this.webContents.capturePage = async () => {
        captureCalled = true;
        return new Promise(() => {});
      };
    }
  };
  const runtime = createBuilderAgentTestBrowserRuntime({
    WebContentsView: harness.WebContentsView,
    browser_session_registry: harness.browserSessionRegistry,
    mainWindowRef: harness.mainWindowRef,
    now_ms: () => 2_000,
  });
  const handle = await runtime.start({
    browser_session: browserSession(),
    entry_url: `${ORIGIN}/index.html`,
  });

  const observation = await handle.observe();
  assert.equal(captureCalled, false);
  assert.equal(observation.screenshot_digest, null);
  assert.equal(observation.screenshot_size, null);
  assert.equal(observation.screenshot_capture_status, 'unavailable');
  assert.equal(observation.screenshot_pixel_status, 'unavailable');
});

test('bounds a stuck screenshot capture without blocking the Browser observation', async () => {
  const harness = electronHarness();
  const OriginalView = harness.WebContentsView;
  harness.WebContentsView = class extends OriginalView {
    constructor(options) {
      super(options);
      this.webContents.capturePage = async () => new Promise(() => {});
    }
  };
  const runtime = createBuilderAgentTestBrowserRuntime({
    WebContentsView: harness.WebContentsView,
    browser_session_registry: harness.browserSessionRegistry,
    mainWindowRef: harness.mainWindowRef,
    now_ms: () => 2_000,
    timeouts: { load_ms: 50, script_ms: 50, screenshot_ms: 5 },
  });
  const handle = await runtime.start({
    browser_session: browserSession(),
    entry_url: `${ORIGIN}/index.html`,
  });

  const observation = await handle.observe();
  assert.equal(observation.screenshot_digest, null);
  assert.equal(observation.screenshot_capture_status, 'timed_out');
  assert.equal(observation.screenshot_pixel_status, 'unavailable');
});

test('close and dispose destroy WebContents and clear ephemeral storage', async () => {
  const harness = electronHarness();
  const runtime = createBuilderAgentTestBrowserRuntime({
    WebContentsView: harness.WebContentsView,
    browser_session_registry: harness.browserSessionRegistry,
    mainWindowRef: harness.mainWindowRef,
    now_ms: () => 2_000,
  });
  const handle = await runtime.start({
    browser_session: browserSession(),
    entry_url: `${ORIGIN}/index.html`,
  });
  assert.equal(await handle.close(), true);
  assert.equal(runtime.activeCount(), 0);
  assert.deepEqual(harness.contentView.children, []);
  assert.equal(harness.views[0].webContents.isDestroyed(), true);
  assert.deepEqual(harness.sessions[0].cleared, {});
  assert.deepEqual(await runtime.dispose(), { disposed: true });
});

test('updates only the matching run view with Main-constrained right-sidebar bounds', async () => {
  const harness = electronHarness();
  const runtime = createBuilderAgentTestBrowserRuntime({
    WebContentsView: harness.WebContentsView,
    browser_session_registry: harness.browserSessionRegistry,
    mainWindowRef: harness.mainWindowRef,
    now_ms: () => 2_000,
  });
  const handle = await runtime.start({
    browser_session: browserSession(),
    entry_url: `${ORIGIN}/index.html`,
  });

  const stale = runtime.updateLayout({
    owner_run_id: 'builder-run:33333333-3333-4333-8333-333333333333',
    view_bounds: { x: 10, y: 10, width: 100, height: 100 },
  });
  assert.deepEqual(stale, {
    result_version: 'builder-agent-test-browser-layout-result.v1',
    owner_run_id: 'builder-run:33333333-3333-4333-8333-333333333333',
    operation: 'not_active',
    visible: false,
    applied_bounds: null,
  });
  assert.deepEqual(harness.views[0].getBounds(), { x: 872, y: 114, width: 400, height: 682 });

  const updated = runtime.updateLayout({
    owner_run_id: RUN_ID,
    view_bounds: { x: 1_200, y: 780, width: 500, height: 500 },
  });
  assert.deepEqual(updated.applied_bounds, { x: 1_200, y: 780, width: 80, height: 40 });
  assert.deepEqual(harness.views[0].getBounds(), updated.applied_bounds);
  assert.equal(harness.views[0].visible, true);

  const hidden = runtime.updateLayout({ owner_run_id: RUN_ID, view_bounds: null });
  assert.equal(hidden.operation, 'layout_updated');
  assert.equal(hidden.visible, false);
  assert.equal(harness.views[0].visible, false);

  await handle.close();
  assert.equal(runtime.updateLayout({ owner_run_id: RUN_ID, view_bounds: null }).operation, 'not_active');
  assert.throws(
    () => runtime.updateLayout({ owner_run_id: RUN_ID, view_bounds: { x: -1, y: 0, width: 1, height: 1 } }),
    BuilderAgentTestBrowserRuntimeError,
  );
});
