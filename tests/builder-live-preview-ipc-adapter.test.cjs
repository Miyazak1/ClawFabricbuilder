'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  READ_CURRENT_LIVE_PREVIEW_STATUS_CHANNEL,
  RELOAD_CURRENT_LIVE_PREVIEW_CHANNEL,
  REQUEST_CURRENT_DRAFT_LIVE_PREVIEW_CHANNEL,
  STOP_CURRENT_LIVE_PREVIEW_CHANNEL,
  BuilderLivePreviewIpcError,
  createBuilderLivePreviewIpcAdapter,
} = require('../electron/builder-live-preview-ipc-adapter.cjs');

const UUID = '123e4567-e89b-42d3-a456-426614174000';
const PROJECT_ID = `builder-project:${UUID}`;
const CONVERSATION_ID = `builder-conversation:${UUID}`;
const DRAFT_ID = `builder-generation-draft:${'d'.repeat(64)}`;

function windowAuthority() {
  const webContents = Object.freeze({
    isDestroyed: () => false,
  });
  const window = Object.freeze({
    webContents,
    isDestroyed: () => false,
  });
  return { event: Object.freeze({ sender: webContents }), mainWindowRef: () => window };
}

function request(overrides = {}) {
  return {
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    ...overrides,
  };
}

function authority() {
  return {
    live_preview_authority: 'main_owned_live_preview_ipc_adapter_v1',
    renderer_authority: 'current_project_conversation_only',
    active_renderer_required: true,
    source_tree_from_renderer: 'not_accepted',
    source_read: 'main_owned_preview_source_resolver_or_not_performed',
    source_write: 'not_performed',
    provider_dispatch: false,
    tool_dispatch: false,
    command_execution: false,
    git_mutation: false,
    sqlite_write: false,
    permission_grant: false,
    revision_admission: false,
    save_admission: false,
    electron_view_attachment: 'main_only_not_exposed_to_renderer',
    preview_content_ipc: false,
    node_integration: false,
    preload: false,
  };
}

function status(overrides = {}) {
  return {
    status_version: 'builder-live-preview-status-projection.v1',
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    preview_kind: 'live_static_web',
    status: 'unavailable',
    can_start: false,
    can_reload: false,
    can_stop: false,
    message: 'Live preview is unavailable until a main-owned preview source resolver is connected.',
    unavailable_reason: 'preview_source_resolver_not_connected',
    updated_at_ms: 50,
    authority: authority(),
    ...overrides,
  };
}

function adapter(overrides = {}) {
  const active = windowAuthority();
  const calls = [];
  const service = async (body) => {
    calls.push(body);
    return status(overrides.result ?? {});
  };
  const value = createBuilderLivePreviewIpcAdapter({
    requestCurrentDraftLivePreview: overrides.requestCurrentDraftLivePreview ?? service,
    reloadCurrentLivePreview: overrides.reloadCurrentLivePreview ?? service,
    stopCurrentLivePreview: overrides.stopCurrentLivePreview ?? service,
    readCurrentLivePreviewStatus: overrides.readCurrentLivePreviewStatus ?? service,
    mainWindowRef: active.mainWindowRef,
  });
  return { active, calls, value };
}

test('live preview adapter exposes fixed current-preview channels only', async () => {
  const { active, calls, value } = adapter();

  assert.equal(value.adapter_id, 'builder_live_preview.controlled_ipc_adapter.v1');
  assert.equal(value.namespace, 'builderLivePreview');
  assert.equal(value.preload_namespace, 'window.clawfabricBuilder.livePreview');
  assert.deepEqual(value.exposed_methods, [
    'requestCurrentDraftPreview',
    'reloadCurrentPreview',
    'stopCurrentPreview',
    'readCurrentPreviewStatus',
  ]);
  assert.deepEqual(Object.keys(value.channels), [
    'requestCurrentDraftPreview',
    'reloadCurrentPreview',
    'stopCurrentPreview',
    'readCurrentPreviewStatus',
  ]);
  assert.equal(
    value.channels.requestCurrentDraftPreview.channel,
    REQUEST_CURRENT_DRAFT_LIVE_PREVIEW_CHANNEL,
  );
  assert.equal(value.channels.reloadCurrentPreview.channel, RELOAD_CURRENT_LIVE_PREVIEW_CHANNEL);
  assert.equal(value.channels.stopCurrentPreview.channel, STOP_CURRENT_LIVE_PREVIEW_CHANNEL);
  assert.equal(value.channels.readCurrentPreviewStatus.channel, READ_CURRENT_LIVE_PREVIEW_STATUS_CHANNEL);
  assert.equal(value.authority.active_renderer_required, true);
  assert.equal(value.authority.source_tree_from_renderer, false);
  assert.equal(value.authority.provider_dispatch, false);
  assert.equal(value.authority.tool_dispatch, false);
  assert.equal(value.authority.command_execution, false);
  assert.equal(value.authority.source_mutation, false);
  assert.equal(value.authority.git_mutation, false);
  assert.equal(value.authority.sqlite_write, false);
  assert.equal(value.authority.save_admission, false);
  assert.equal(value.authority.preview_content_ipc, false);

  const projected = await value.channels.requestCurrentDraftPreview.invoke(active.event, request());

  assert.deepEqual(calls, [request()]);
  assert.deepEqual(projected, status());
  assert.equal(Object.isFrozen(projected), true);
  assert.equal(Object.isFrozen(projected.authority), true);
  assert.doesNotMatch(
    JSON.stringify(projected),
    /"source_tree":|content_digest|entry_url|preview_origin|credential|permission_id|revision_receipt|commit_oid|tree_oid/iu,
  );
});

test('live preview adapter supports read, reload, and stop through the same exact request shape', async () => {
  const names = [
    'readCurrentPreviewStatus',
    'reloadCurrentPreview',
    'stopCurrentPreview',
  ];
  for (const name of names) {
    const { active, calls, value } = adapter({
      result: name === 'stopCurrentPreview'
        ? { status: 'stopped', message: 'Live preview is stopped.', unavailable_reason: null }
        : { status: 'ready', message: 'Live preview is ready.', unavailable_reason: null },
    });
    const projected = await value.channels[name].invoke(active.event, request());
    assert.deepEqual(calls, [request()]);
    assert.equal(projected.project_id, PROJECT_ID);
    assert.equal(projected.conversation_id, CONVERSATION_ID);
  }
});

test('live preview adapter rejects inactive senders and malformed payloads before service authority', async () => {
  const { active, calls, value } = adapter();
  await assert.rejects(
    value.channels.requestCurrentDraftPreview.invoke(Object.freeze({ sender: Object.freeze({}) }), request()),
    (error) => error instanceof BuilderLivePreviewIpcError
      && error.code === 'builder_live_preview_forbidden'
      && error.stack === `${error.name}: ${error.message}`,
  );
  for (const payload of [
    undefined,
    request({ project_id: 'bad' }),
    request({ conversation_id: 'bad' }),
    request({ draft_id: 'bad' }),
    request({ view_bounds: { x: 1, y: 2, width: 40, height: 50 } }),
    request({ view_bounds: { x: 1, y: 2, width: 320, height: 240, extra: true } }),
    {
      project_id: PROJECT_ID,
      conversation_id: 'builder-conversation:00000000-0000-4000-8000-000000000000',
    },
    request({ source_tree: { files: [] } }),
    request({ path: 'index.html' }),
    request({ url: 'http://127.0.0.1:1/index.html' }),
  ]) {
    await assert.rejects(
      value.channels.requestCurrentDraftPreview.invoke(active.event, payload),
      (error) => error instanceof BuilderLivePreviewIpcError
        && error.code === 'builder_live_preview_invalid',
    );
  }
  await assert.rejects(
    value.channels.requestCurrentDraftPreview.invoke(active.event, request(), { extra: true }),
    { code: 'builder_live_preview_invalid' },
  );
  assert.deepEqual(calls, []);
});

test('live preview adapter rejects renderer draft, geometry, and source material', async () => {
  const { active, calls, value } = adapter();
  for (const payload of [
    request({ draft_id: DRAFT_ID }),
    request({ view_bounds: { x: 820, y: 180, width: 420, height: 520 } }),
    request({ source_tree: { files: [] } }),
    request({ path: 'index.html' }),
    request({ url: 'http://127.0.0.1:1/index.html' }),
  ]) {
    await assert.rejects(
      value.channels.requestCurrentDraftPreview.invoke(active.event, payload),
      { code: 'builder_live_preview_invalid' },
    );
  }
  assert.deepEqual(calls, []);
});

test('live preview adapter maps service and output failures to fixed redacted errors', async () => {
  const source = new Error('private live preview marker');
  source.code = 'builder_live_preview_runtime_private';
  const { active, value } = adapter({
    requestCurrentDraftLivePreview: async () => { throw source; },
  });
  await assert.rejects(
    value.channels.requestCurrentDraftPreview.invoke(active.event, request()),
    (error) => error instanceof BuilderLivePreviewIpcError
      && error.code === 'builder_live_preview_unavailable'
      && !`${error.message}:${error.stack}`.includes('private live preview marker'),
  );

  const leaking = adapter({
    result: {
      source_tree: { files: [] },
    },
  });
  await assert.rejects(
    leaking.value.channels.requestCurrentDraftPreview.invoke(leaking.active.event, request()),
    { code: 'builder_live_preview_unavailable' },
  );
});

test('live preview adapter rejects malformed options without invoking getters or proxy traps', () => {
  let getterCalls = 0;
  const active = windowAuthority();
  const accessorOptions = {
    requestCurrentDraftLivePreview: async () => status(),
    reloadCurrentLivePreview: async () => status(),
    stopCurrentLivePreview: async () => status(),
    readCurrentLivePreviewStatus: async () => status(),
  };
  Object.defineProperty(accessorOptions, 'mainWindowRef', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return active.mainWindowRef;
    },
  });
  for (const invalid of [
    null,
    {},
    {
      requestCurrentDraftLivePreview: async () => status(),
      reloadCurrentLivePreview: async () => status(),
      stopCurrentLivePreview: async () => status(),
      readCurrentPreviewStatus: async () => status(),
      mainWindowRef: active.mainWindowRef,
      extra: true,
    },
    accessorOptions,
    new Proxy({}, { getPrototypeOf() { throw new Error('private proxy marker'); } }),
  ]) {
    assert.throws(
      () => createBuilderLivePreviewIpcAdapter(invalid),
      (error) => error instanceof BuilderLivePreviewIpcError
        && error.code === 'builder_live_preview_unavailable'
        && !`${error.message}:${error.stack}`.includes('private'),
    );
  }
  assert.equal(getterCalls, 0);
});

test('live preview adapter source has no provider, tool, source, Git, storage, or direct preload authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-live-preview-ipc-adapter.cjs'),
    'utf8',
  );
  assert.match(source, /active_renderer_required:\s*true/u);
  assert.match(source, /source_tree_from_renderer:\s*false/u);
  assert.match(source, /preview_content_ipc:\s*false/u);
  assert.match(source, /direct_electron_registration:\s*false/u);
  assert.match(source, /direct_preload_exposure:\s*false/u);
  assert.doesNotMatch(
    source,
    /require\(['"]electron['"]\)|ipcMain|ipcRenderer|contextBridge|BrowserWindow|WebContentsView|safeStorage|node:sqlite|DatabaseSync|builder-git-|fetch\s*\(|https?:|saveDraft|generate|persist_candidate_commit|write_current|local-provider-executor|chat_planner|ChatCreatePage|Canvas|JobMeta/iu,
  );
});
