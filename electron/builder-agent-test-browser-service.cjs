'use strict';

const { types: utilTypes } = require('node:util');

const {
  createBuilderBrowserSession,
} = require('./builder-browser-session.cjs');
const {
  BUILDER_AGENT_TEST_BROWSER_RUNTIME_VERSION,
} = require('./builder-agent-test-browser-runtime.cjs');
const {
  createBuilderLivePreviewAdmission,
} = require('./builder-live-preview-run.cjs');
const {
  startBuilderLivePreviewStaticServer,
} = require('./builder-live-preview-static-server.cjs');

const BUILDER_AGENT_TEST_BROWSER_SERVICE_VERSION = 'builder-agent-test-browser-service.v1';
const OPTION_KEYS = Object.freeze([
  'browser_runtime', 'run_contract', 'workspace_tools', 'now_ms',
]);
const OPTIONAL_OPTION_KEYS = Object.freeze(['start_static_server']);

class BuilderAgentTestBrowserServiceError extends Error {
  constructor(code = 'builder_agent_test_browser_service_invalid') {
    const selected = [
      'builder_agent_test_browser_service_invalid',
      'builder_agent_test_browser_service_not_open',
      'builder_agent_test_browser_service_no_entry',
    ].includes(code) ? code : 'builder_agent_test_browser_service_invalid';
    super('Builder Agent Test browser service is unavailable.');
    this.name = 'BuilderAgentTestBrowserServiceError';
    this.code = selected;
    this.retryable = false;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) {
  throw new BuilderAgentTestBrowserServiceError(code);
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

function exactObjectWithOptional(value, required, optional = []) {
  if (!isPlainObject(value)) fail();
  const keys = Reflect.ownKeys(value);
  if (required.some((key) => !keys.includes(key)) || keys.some((key) => ![...required, ...optional].includes(key))) fail();
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail();
  }
}

function method(value, key) {
  if (!value || typeof value !== 'object' || utilTypes.isProxy(value)) fail();
  const selected = value[key];
  if (typeof selected !== 'function' || utilTypes.isProxy(selected)) fail();
  return selected.bind(value);
}

function selectedEntryPath(sourceTree) {
  const index = sourceTree.files.find((file) => file.path === 'index.html');
  if (index) return index.path;
  const html = sourceTree.files.find((file) => /\.html?$/iu.test(file.path));
  if (!html) fail('builder_agent_test_browser_service_no_entry');
  return html.path;
}

function createBuilderAgentTestBrowserService(rawOptions) {
  exactObjectWithOptional(rawOptions, OPTION_KEYS, OPTIONAL_OPTION_KEYS);
  const runtime = rawOptions.browser_runtime;
  if (!isPlainObject(runtime) || runtime.runtime_version !== BUILDER_AGENT_TEST_BROWSER_RUNTIME_VERSION) fail();
  const runtimeStart = method(runtime, 'start');
  const runContract = rawOptions.run_contract;
  const admission = runContract?.admission;
  if (!isPlainObject(runContract) || !isPlainObject(admission)) fail();
  const workspaceSnapshot = method(rawOptions.workspace_tools, 'snapshot');
  const nowMs = rawOptions.now_ms;
  const startStaticServer = rawOptions.start_static_server ?? startBuilderLivePreviewStaticServer;
  if (typeof nowMs !== 'function' || typeof startStaticServer !== 'function') fail();
  let active = null;

  async function closeActive(reason = 'completed') {
    const selected = active;
    active = null;
    if (selected === null) return false;
    let firstError = null;
    try { await selected.handle.close({ reason }); } catch (error) { firstError = error; }
    try { await selected.server.stop(); } catch (error) { if (firstError === null) firstError = error; }
    if (firstError !== null) throw firstError;
    return true;
  }

  async function openLocalApp() {
    await closeActive('replaced');
    const sourceTree = await workspaceSnapshot();
    const entryPath = selectedEntryPath(sourceTree);
    const createdAtMs = nowMs();
    const expiresAtMs = createdAtMs + 5 * 60 * 1_000;
    const previewAdmission = createBuilderLivePreviewAdmission({
      project_id: admission.project_id,
      conversation_id: admission.conversation_id,
      task_id: admission.task_id,
      run_id: admission.run_id,
      draft_checkpoint_id: null,
      revision_receipt_digest: null,
      source_tree_digest: sourceTree.source_tree_digest,
      selected_entry_path: entryPath,
      preview_kind: 'live_static_web',
      admitted_at_ms: createdAtMs,
      expires_at_ms: expiresAtMs,
    });
    const server = await startStaticServer({ admission: previewAdmission, source_tree: sourceTree });
    try {
      const browserSession = createBuilderBrowserSession({
        session_class: 'agent_test',
        project_id: admission.project_id,
        owner_run_id: admission.run_id,
        profile_id: null,
        admitted_origins: [server.preview_origin],
        persistence: 'ephemeral',
        created_at_ms: createdAtMs,
        expires_at_ms: expiresAtMs,
      });
      const handle = await runtimeStart({ browser_session: browserSession, entry_url: server.entry_url });
      active = freezeDeep({ handle, server, source_tree_digest: sourceTree.source_tree_digest });
      return await handle.observe();
    } catch (error) {
      try { await server.stop(); } catch { /* original fixed error remains authoritative */ }
      throw error;
    }
  }

  function activeHandle() {
    if (active === null) fail('builder_agent_test_browser_service_not_open');
    return active.handle;
  }

  return freezeDeep({
    service_version: BUILDER_AGENT_TEST_BROWSER_SERVICE_VERSION,
    open_local_app: openLocalApp,
    observe: () => activeHandle().observe(),
    click: (request) => activeHandle().click(request),
    type: (request) => activeHandle().type(request),
    select_option: (request) => activeHandle().select_option(request),
    press_key: (request) => activeHandle().press_key(request),
    scroll: (request) => activeHandle().scroll(request),
    reload_latest_source: openLocalApp,
    async close(rawRequest = undefined) {
      const reason = rawRequest === undefined ? 'completed' : rawRequest.reason;
      if (rawRequest !== undefined) exactObjectWithOptional(rawRequest, ['reason']);
      if (!['completed', 'cancelled', 'shutdown', 'interrupted'].includes(reason)) fail();
      return freezeDeep({ closed: await closeActive(reason) });
    },
    diagnostics() {
      return freezeDeep({
        service_version: BUILDER_AGENT_TEST_BROWSER_SERVICE_VERSION,
        owner_run_id: admission.run_id,
        active: active !== null,
        source_tree_digest: active?.source_tree_digest ?? null,
      });
    },
  });
}

module.exports = freezeDeep({
  BUILDER_AGENT_TEST_BROWSER_SERVICE_VERSION,
  BuilderAgentTestBrowserServiceError,
  createBuilderAgentTestBrowserService,
});
