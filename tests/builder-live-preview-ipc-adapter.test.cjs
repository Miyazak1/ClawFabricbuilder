'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  READ_CURRENT_LIVE_PREVIEW_STATUS_CHANNEL,
  DECIDE_DEV_SERVER_APPROVAL_CHANNEL,
  RELOAD_CURRENT_LIVE_PREVIEW_CHANNEL,
  REQUEST_CURRENT_DRAFT_LIVE_PREVIEW_CHANNEL,
  STOP_CURRENT_LIVE_PREVIEW_CHANNEL,
  UPDATE_CURRENT_LIVE_PREVIEW_LAYOUT_CHANNEL,
  BuilderLivePreviewIpcError,
  createBuilderLivePreviewIpcAdapter,
} = require('../electron/builder-live-preview-ipc-adapter.cjs');

const UUID = '123e4567-e89b-42d3-a456-426614174000';
const PROJECT_ID = `builder-project:${UUID}`;
const CONVERSATION_ID = `builder-conversation:${UUID}:223e4567-e89b-42d3-a456-426614174000`;
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

function runtimeLaunchProjection(statusLike = {}) {
  const previewKind = statusLike.preview_kind ?? 'live_static_web';
  const statusValue = statusLike.status ?? 'unavailable';
  const devServerApproval = statusLike.dev_server_approval ?? null;
  const devServer = previewKind === 'live_dev_server_web';
  return {
    projection_version: 'builder-project-runtime-launch-projection.v1',
    project_id: statusLike.project_id ?? PROJECT_ID,
    conversation_id: statusLike.conversation_id ?? CONVERSATION_ID,
    preview_kind: previewKind,
    source_status: statusValue === 'idle' ? 'not_requested' : 'main_owned_verified',
    command_profile: devServer ? 'main_owned_dev_server_profile' : 'none',
    user_approval: devServer
      ? devServerApproval !== null ? 'required'
        : ['ready', 'reloading', 'starting', 'failed'].includes(statusValue)
          ? 'approved_once'
          : 'denied_or_expired'
      : 'not_required',
    command_execution: devServer
      ? statusValue === 'approval_required' ? 'approval_required'
        : ['ready', 'reloading', 'starting'].includes(statusValue) ? 'started'
          : statusValue === 'failed' ? 'failed' : 'stopped'
      : 'not_applicable',
    dependency_preparation: 'not_allowed',
    package_install: 'not_allowed',
    sandbox_policy: devServer
      ? 'dev_server_only_no_dependency_install'
      : 'static_preview_no_command_execution',
    provider_dispatch: false,
    tool_dispatch: false,
    project_workspace_write: 'not_granted_by_preview',
    authority: {
      projection_authority: 'main_owned_project_runtime_launch_projection_v1',
      renderer_authority: 'status_projection_only',
      path_disclosure: 'not_serialized',
    },
  };
}

function status(overrides = {}) {
  const projected = {
    status_version: 'builder-live-preview-status-projection.v1',
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    preview_kind: 'live_static_web',
    entry_url: null,
    status: 'unavailable',
    can_start: false,
    can_reload: false,
    can_stop: false,
    blocked_request_count: 0,
    navigation_block_count: 0,
    network_block_count: 0,
    permission_block_count: 0,
    download_block_count: 0,
    window_open_block_count: 0,
    message: 'Live preview is unavailable until a main-owned preview source resolver is connected.',
    dev_server_approval: null,
    unavailable_reason: 'preview_source_resolver_not_connected',
    updated_at_ms: 50,
    authority: authority(),
    ...overrides,
  };
  if (!Object.hasOwn(projected, 'runtime_launch_projection')) {
    projected.runtime_launch_projection = runtimeLaunchProjection(projected);
  }
  return projected;
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
    updateCurrentLivePreviewLayout: overrides.updateCurrentLivePreviewLayout ?? service,
    decideDevServerApproval: overrides.decideDevServerApproval ?? service,
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
    'updateCurrentPreviewLayout',
    'decideDevServerApproval',
  ]);
  assert.deepEqual(Object.keys(value.channels), [
    'requestCurrentDraftPreview',
    'reloadCurrentPreview',
    'stopCurrentPreview',
    'readCurrentPreviewStatus',
    'updateCurrentPreviewLayout',
    'decideDevServerApproval',
  ]);
  assert.equal(
    value.channels.requestCurrentDraftPreview.channel,
    REQUEST_CURRENT_DRAFT_LIVE_PREVIEW_CHANNEL,
  );
  assert.equal(value.channels.reloadCurrentPreview.channel, RELOAD_CURRENT_LIVE_PREVIEW_CHANNEL);
  assert.equal(value.channels.stopCurrentPreview.channel, STOP_CURRENT_LIVE_PREVIEW_CHANNEL);
  assert.equal(value.channels.readCurrentPreviewStatus.channel, READ_CURRENT_LIVE_PREVIEW_STATUS_CHANNEL);
  assert.equal(value.channels.updateCurrentPreviewLayout.channel, UPDATE_CURRENT_LIVE_PREVIEW_LAYOUT_CHANNEL);
  assert.equal(value.channels.decideDevServerApproval.channel, DECIDE_DEV_SERVER_APPROVAL_CHANNEL);
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
  assert.equal(Object.isFrozen(projected.runtime_launch_projection), true);
  assert.equal(Object.isFrozen(projected.runtime_launch_projection.authority), true);
  assert.equal(
    projected.runtime_launch_projection.projection_version,
    'builder-project-runtime-launch-projection.v1',
  );
  assert.equal(projected.runtime_launch_projection.package_install, 'not_allowed');
  assert.equal(projected.runtime_launch_projection.provider_dispatch, false);
  assert.equal(projected.runtime_launch_projection.tool_dispatch, false);
  assert.doesNotMatch(
    JSON.stringify(projected),
    /"source_tree":|content_digest|preview_origin|credential|permission_id|revision_receipt|commit_oid|tree_oid/iu,
  );
  assert.equal(projected.entry_url, null);
});

test('live preview adapter preserves bounded runtime block counts', async () => {
  const { active, value } = adapter({
    result: {
      status: 'ready',
      can_reload: true,
      message: 'Live preview is ready.',
      unavailable_reason: null,
      blocked_request_count: 4,
      navigation_block_count: 1,
      network_block_count: 1,
      permission_block_count: 1,
      download_block_count: 0,
      window_open_block_count: 1,
    },
  });

  const projected = await value.channels.requestCurrentDraftPreview.invoke(active.event, request());

  assert.equal(projected.status, 'ready');
  assert.equal(projected.blocked_request_count, 4);
  assert.equal(projected.navigation_block_count, 1);
  assert.equal(projected.network_block_count, 1);
  assert.equal(projected.permission_block_count, 1);
  assert.equal(projected.window_open_block_count, 1);
});

test('live preview adapter preserves fixed failure reasons from the main preview service', async () => {
  for (const unavailableReason of [
    'live_preview_static_server_unavailable',
    'live_preview_view_attachment_failed',
    'live_preview_dev_server_unavailable',
  ]) {
    const { active, value } = adapter({
      result: {
        status: 'failed',
        can_start: true,
        message: 'Live preview could not start for the current draft.',
        unavailable_reason: unavailableReason,
      },
    });

    const projected = await value.channels.requestCurrentDraftPreview.invoke(active.event, request());

    assert.equal(projected.status, 'failed');
    assert.equal(projected.unavailable_reason, unavailableReason);
    assert.doesNotMatch(JSON.stringify(projected), /private|content_digest|preview_origin/iu);
  }
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

test('live preview adapter forwards only an exact one-time development-server decision', async () => {
  const approvalRequestId =
    'builder-live-preview-dev-server-approval-request:323e4567-e89b-42d3-a456-426614174000';
  const { active, calls, value } = adapter({
    result: {
      preview_kind: 'live_dev_server_web',
      status: 'approval_required',
      message: 'Allow this project development server to run once.',
      dev_server_approval: {
        request_version: 'builder-live-preview-dev-server-approval-request.v1',
        approval_request_id: approvalRequestId,
        project_id: PROJECT_ID,
        conversation_id: CONVERSATION_ID,
        command_display: 'npm run dev',
        source_tree_digest: `sha256:${'a'.repeat(64)}`,
        risk_notice: 'This project script may modify files or use the network.',
        requested_at_ms: 100,
        expires_at_ms: 300_100,
        decisions: ['allow_once', 'deny'],
      },
      authority: { ...authority(), command_execution: true },
      unavailable_reason: null,
    },
  });
  const decision = {
    ...request(),
    approval_request_id: approvalRequestId,
    decision: 'allow_once',
  };

  const projected = await value.channels.decideDevServerApproval.invoke(active.event, decision);
  assert.deepEqual(calls, [decision]);
  assert.equal(projected.status, 'approval_required');
  assert.equal(projected.dev_server_approval.command_display, 'npm run dev');
  assert.equal(projected.runtime_launch_projection.preview_kind, 'live_dev_server_web');
  assert.equal(projected.runtime_launch_projection.command_profile, 'main_owned_dev_server_profile');
  assert.equal(projected.runtime_launch_projection.user_approval, 'required');
  assert.equal(projected.runtime_launch_projection.command_execution, 'approval_required');
  assert.equal(projected.runtime_launch_projection.package_install, 'not_allowed');

  for (const invalid of [
    { ...decision, decision: 'always_allow' },
    { ...decision, port: 5173 },
    { ...decision, command: 'npm run dev' },
    { ...decision, approval_request_id: 'bad' },
  ]) {
    await assert.rejects(
      value.channels.decideDevServerApproval.invoke(active.event, invalid),
      { code: 'builder_live_preview_invalid' },
    );
  }
});

test('live preview adapter accepts only bounded UI geometry on the dedicated layout channel', async () => {
  const { active, calls, value } = adapter({
    result: { status: 'ready', message: 'Live preview is ready.', unavailable_reason: null },
  });
  const layout = request({ view_bounds: { x: 820, y: 180, width: 420, height: 520 } });
  const projected = await value.channels.updateCurrentPreviewLayout.invoke(active.event, layout);
  assert.deepEqual(calls, [layout]);
  assert.equal(projected.status, 'ready');

  const hidden = request({ view_bounds: null });
  await value.channels.updateCurrentPreviewLayout.invoke(active.event, hidden);
  assert.deepEqual(calls, [layout, hidden]);

  for (const invalid of [
    request({ view_bounds: { x: -1, y: 0, width: 20, height: 20 } }),
    request({ view_bounds: { x: 0, y: 0, width: 0, height: 20 } }),
    request({ view_bounds: { x: 0, y: 0, width: 20, height: 20, extra: true } }),
    request({ view_bounds: { x: 0, y: 0, width: 20.5, height: 20 } }),
  ]) {
    await assert.rejects(
      value.channels.updateCurrentPreviewLayout.invoke(active.event, invalid),
      { code: 'builder_live_preview_invalid' },
    );
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

  const runtimeAuthorityLeak = adapter({
    result: {
      runtime_launch_projection: {
        ...runtimeLaunchProjection(),
        package_install: 'allowed',
      },
    },
  });
  await assert.rejects(
    runtimeAuthorityLeak.value.channels.requestCurrentDraftPreview.invoke(
      runtimeAuthorityLeak.active.event,
      request(),
    ),
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
    updateCurrentLivePreviewLayout: async () => status(),
    decideDevServerApproval: async () => status(),
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
    /require\(['"]electron['"]\)|ipcMain|ipcRenderer|contextBridge|BrowserWindow|WebContentsView|safeStorage|node:sqlite|DatabaseSync|builder-git-|fetch\s*\(|saveDraft|generate|persist_candidate_commit|write_current|local-provider-executor|chat_planner|ChatCreatePage|Canvas|JobMeta/iu,
  );
});
