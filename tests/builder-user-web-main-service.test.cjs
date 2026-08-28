'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createBuilderBrowserSessionRegistry,
} = require('../electron/builder-browser-session-registry.cjs');
const {
  createBuilderUserWebMainService,
} = require('../electron/builder-user-web-main-service.cjs');

function harness() {
  const views = [];
  const sessions = [];
  const added = [];
  const removed = [];
  let now = 1_000;

  class WebContentsView {
    constructor(options) {
      const handlers = new Map();
      let destroyed = false;
      let back = false;
      let forward = false;
      const contents = {
        handlers,
        loaded: [],
        reloadCalls: 0,
        setWindowOpenHandler(handler) { contents.windowOpenHandler = handler; },
        on(name, handler) { handlers.set(name, handler); },
        once(name, handler) { handlers.set(name, handler); },
        removeListener(name, handler) {
          if (handlers.get(name) === handler) handlers.delete(name);
        },
        async loadURL(url) { contents.loaded.push(url); },
        destroy() { destroyed = true; },
        isDestroyed() { return destroyed; },
        canGoBack() { return back; },
        canGoForward() { return forward; },
        goBack() { contents.goBackCalls = (contents.goBackCalls ?? 0) + 1; },
        goForward() { contents.goForwardCalls = (contents.goForwardCalls ?? 0) + 1; },
        reload() {
          contents.reloadCalls += 1;
          queueMicrotask(() => handlers.get('did-finish-load')?.());
        },
        setHistory(canBack, canForward) { back = canBack; forward = canForward; },
      };
      this.options = options;
      this.webContents = contents;
      this.bounds = [];
      this.setBounds = (bounds) => this.bounds.push(bounds);
      views.push(this);
    }
  }

  const session = {
    fromPartition(partition) {
      const handlers = new Map();
      const item = {
        partition,
        handlers,
        clearCalls: 0,
        setPermissionRequestHandler(handler) { item.permissionRequestHandler = handler; },
        setPermissionCheckHandler(handler) { item.permissionCheckHandler = handler; },
        on(name, handler) { handlers.set(name, handler); },
        async clearStorageData() { item.clearCalls += 1; },
      };
      sessions.push(item);
      return item;
    },
  };
  const registry = createBuilderBrowserSessionRegistry({
    session,
    now_ms: () => now++,
  });
  const contentView = {
    addChildView(view) { added.push(view); },
    removeChildView(view) { removed.push(view); },
  };
  const mainWindow = {
    contentView,
    isDestroyed() { return false; },
  };
  const service = createBuilderUserWebMainService({
    WebContentsView,
    browserSessionRegistry: registry,
    mainWindowRef: () => mainWindow,
    nowMs: () => now++,
  });
  return { added, registry, removed, service, sessions, views };
}

test('opens an isolated User Web session with Main-owned navigation and denied ambient powers', async () => {
  const value = harness();
  const ready = await value.service.navigate({ url: 'example.com/docs' });

  assert.equal(ready.status, 'ready');
  assert.equal(ready.current_url, 'https://example.com/docs');
  assert.equal(ready.authority.provider_authority, 'none');
  assert.equal(ready.authority.provider_observation, false);
  assert.equal(ready.authority.command_execution, false);
  assert.equal(Object.hasOwn(ready, 'partition'), false);
  assert.equal(value.sessions.length, 1);
  assert.match(value.sessions[0].partition, /^builder-user-web-/u);
  assert.deepEqual(value.views[0].options.webPreferences, {
    partition: value.sessions[0].partition,
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    webSecurity: true,
    allowRunningInsecureContent: false,
  });

  const layout = value.service.update_layout({
    view_bounds: { x: 900, y: 150, width: 360, height: 600 },
  });
  assert.equal(layout.status, 'ready');
  assert.deepEqual(value.views[0].bounds, [{ x: 900, y: 150, width: 360, height: 600 }]);
  assert.deepEqual(value.added, [value.views[0]]);

  let prevented = false;
  value.views[0].webContents.handlers.get('will-navigate')(
    { preventDefault() { prevented = true; } },
    'https://other.example/',
  );
  assert.equal(prevented, true);
  assert.equal(value.service.read_status().navigation_block_count, 1);
  assert.deepEqual(value.views[0].webContents.windowOpenHandler(), { action: 'deny' });
  assert.equal(value.service.read_status().window_open_block_count, 1);

  let permissionDecision = null;
  value.sessions[0].permissionRequestHandler(null, 'camera', (decision) => {
    permissionDecision = decision;
  });
  assert.equal(permissionDecision, false);
  assert.equal(value.service.read_status().permission_block_count, 1);

  let downloadPrevented = false;
  value.sessions[0].handlers.get('will-download')({
    preventDefault() { downloadPrevented = true; },
  });
  assert.equal(downloadPrevented, true);
  assert.equal(value.service.read_status().download_block_count, 1);

  await value.service.shutdown();
  assert.equal(value.sessions[0].clearCalls, 1);
  assert.deepEqual(value.removed, [value.views[0]]);
  assert.equal(value.registry.diagnostics().active_count, 0);
});

test('replaces cross-origin User Web sessions and supports bounded history controls', async () => {
  const value = harness();
  await value.service.navigate({ url: 'https://example.com/one' });
  value.views[0].webContents.setHistory(true, true);
  assert.equal((await value.service.go_back()).can_go_back, true);
  assert.equal((await value.service.go_forward()).can_go_forward, true);
  assert.equal(value.views[0].webContents.goBackCalls, 1);
  assert.equal(value.views[0].webContents.goForwardCalls, 1);
  assert.equal((await value.service.reload()).status, 'ready');
  assert.equal(value.views[0].webContents.reloadCalls, 1);

  await value.service.navigate({ url: 'https://openai.com/' });
  assert.equal(value.sessions.length, 2);
  assert.equal(value.sessions[0].clearCalls, 1);
  assert.equal(value.views[0].webContents.isDestroyed(), true);
  assert.equal(value.service.read_status().current_url, 'https://openai.com/');
  assert.equal(value.registry.diagnostics().active_by_class.user_web, 1);

  await value.service.stop();
  assert.equal(value.registry.diagnostics().active_count, 0);
  assert.equal(value.service.read_status().status, 'idle');
});

test('rejects credential-bearing and non-web User Web navigation', async () => {
  const value = harness();
  await assert.rejects(
    value.service.navigate({ url: 'https://user:secret@example.com/' }),
    (error) => error.code === 'builder_user_web_invalid',
  );
  await assert.rejects(
    value.service.navigate({ url: 'file:///C:/private.txt' }),
    (error) => error.code === 'builder_user_web_invalid',
  );
  assert.equal(value.registry.diagnostics().active_count, 0);
});
