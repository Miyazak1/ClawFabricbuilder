'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  createBuilderLivePreviewMainService,
} = require('../electron/builder-live-preview-main-service.cjs');
const {
  createBuilderLivePreviewSourceAdmission,
} = require('../electron/builder-live-preview-source-admission.cjs');
const {
  BUILDER_LIVE_PREVIEW_SOURCE_RESOLVER_RESULT_VERSION,
  BUILDER_LIVE_PREVIEW_SOURCE_RESOLVER_VERSION,
  BUILDER_LIVE_PREVIEW_SOURCE_SNAPSHOT_VERSION,
} = require('../electron/builder-live-preview-source-resolver.cjs');
const {
  createBuilderProjectSourceTree,
} = require('../electron/builder-project-source-tree.cjs');

const UUID = '123e4567-e89b-42d3-a456-426614174000';
const PROJECT_ID = `builder-project:${UUID}`;
const CONVERSATION_ID = `builder-conversation:${UUID}:223e4567-e89b-42d3-a456-426614174000`;
const DRAFT_ID = `builder-generation-draft:${'d'.repeat(64)}`;
const CHECKPOINT_ID = `builder-draft-checkpoint:${'7'.repeat(64)}`;
const CANDIDATE_ID = `builder-code-change-candidate:${'a'.repeat(64)}`;
const REVISION_DIGEST = `sha256:${'e'.repeat(64)}`;

function tree() {
  return createBuilderProjectSourceTree({
    files: [
      { path: 'index.html', content: '<main>Live preview</main>\n' },
      { path: 'app.js', content: 'document.body.dataset.ready = "true";\n' },
    ],
  });
}

function devTree() {
  return createBuilderProjectSourceTree({
    files: [
      { path: 'index.html', content: '<main>Development preview</main>\n' },
      { path: 'package.json', content: '{"private":true,"scripts":{"dev":"node server.cjs"}}\n' },
      { path: 'server.cjs', content: '/* admitted test server */\n' },
    ],
  });
}

function nextTreeWithoutHtml() {
  return createBuilderProjectSourceTree({
    files: [
      { path: 'package.json', content: '{"private":true,"scripts":{"dev":"next dev"}}\n' },
      { path: 'app/layout.tsx', content: 'export default function Layout({ children }) { return children; }\n' },
      { path: 'app/page.tsx', content: 'export default function Page() { return <main>App router</main>; }\n' },
    ],
  });
}

function sourceResolverAuthority() {
  return {
    source_resolver_authority: 'main_owned_live_preview_source_resolver_v1',
    renderer_source_tree: 'not_accepted',
    renderer_path_or_url: 'not_accepted',
    git_read: 'existing_authority_verified_candidate_only',
    sqlite_read: 'existing_revision_or_checkpoint_authority_only',
    source_write: 'not_performed',
    git_write: 'not_performed',
    sqlite_write: 'not_performed',
    provider_dispatch: false,
    tool_dispatch: false,
    command_execution: false,
    electron_view_attachment: false,
    ipc_registration: false,
    revision_admission: false,
    save_admission: false,
    permission_grant: false,
  };
}

function sourceAdmission(sourceTree = tree(), sourceKind = 'current_draft') {
  const savedRevision = sourceKind === 'saved_revision';
  const selectedEntryPath = sourceTree.files.some((file) => file.path === 'index.html')
    ? 'index.html'
    : 'package.json';
  const previewKind = selectedEntryPath === 'package.json'
    ? 'live_dev_server_web'
    : 'live_static_web';
  return createBuilderLivePreviewSourceAdmission({
    source_resolver_result: {
      result_version: BUILDER_LIVE_PREVIEW_SOURCE_RESOLVER_RESULT_VERSION,
      resolver_version: BUILDER_LIVE_PREVIEW_SOURCE_RESOLVER_VERSION,
      operation: savedRevision
        ? 'saved_revision_preview_source_resolved'
        : 'current_draft_preview_source_resolved',
      source_kind: sourceKind,
      status: 'ready',
      unavailable_reason: null,
      preview_source_snapshot: {
        snapshot_version: BUILDER_LIVE_PREVIEW_SOURCE_SNAPSHOT_VERSION,
        source_kind: sourceKind,
        project_id: PROJECT_ID,
        conversation_id: CONVERSATION_ID,
        source_tree: sourceTree,
        source_tree_digest: sourceTree.source_tree_digest,
        source_ref: savedRevision ? {
          source_ref_kind: 'saved_project_revision',
          project_id: PROJECT_ID,
          conversation_id: CONVERSATION_ID,
          revision_receipt_digest: REVISION_DIGEST,
          revision_number: 1,
          candidate_id: CANDIDATE_ID,
          candidate_digest: `sha256:${'2'.repeat(64)}`,
          resulting_tree_digest: sourceTree.source_tree_digest,
          commit_oid: '5'.repeat(40),
          tree_oid: '6'.repeat(40),
        } : {
          source_ref_kind: 'current_draft_checkpoint_candidate',
          project_id: PROJECT_ID,
          conversation_id: CONVERSATION_ID,
          checkpoint_id: CHECKPOINT_ID,
          checkpoint_sequence: 2,
          candidate_id: CANDIDATE_ID,
          candidate_digest: `sha256:${'2'.repeat(64)}`,
          resulting_tree_digest: sourceTree.source_tree_digest,
          commit_oid: '5'.repeat(40),
          tree_oid: '6'.repeat(40),
        },
        admission: {
          preview_source_admission: 'main_owned_verified_preview_source',
          source_tree_digest: sourceTree.source_tree_digest,
        },
        authority: sourceResolverAuthority(),
      },
    },
    selected_entry_path: selectedEntryPath,
    preview_kind: previewKind,
    admitted_at_ms: 1_000,
    expires_at_ms: 61_000,
  });
}

function request(overrides = {}) {
  return {
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    ...overrides,
  };
}

function windowHarness() {
  const calls = [];
  const contentView = {
    addChildView(view) { calls.push(['add', view.id]); },
    removeChildView(view) { calls.push(['remove', view.id]); },
  };
  const window = {
    contentView,
    getContentBounds() {
      return { x: 0, y: 0, width: 1280, height: 820 };
    },
  };
  return { calls, window };
}

function runtimeHarness() {
  const calls = [];
  let count = 0;
  const runtime = {
    runtime_version: 'builder-live-preview-webcontents-view-runtime.v1',
    async start(input) {
      calls.push(['start', input.admission.selected_entry_path, input.static_server.entry_url]);
      const view = {
        id: `view-${++count}`,
        bounds: null,
        setBounds(bounds) {
          view.bounds = bounds;
          calls.push(['bounds', bounds]);
        },
        setVisible(visible) {
          calls.push(['visible', visible]);
        },
      };
      let status = 'ready';
      return {
        handle_version: 'builder-live-preview-webcontents-view-handle.v1',
        admission_id: input.admission.admission_id,
        project_id: input.admission.project_id,
        readStatus() {
          return {
            status,
            entry_url: input.static_server.entry_url,
            navigation_block_count: 1,
            network_block_count: 2,
            permission_block_count: 0,
            download_block_count: 0,
            window_open_block_count: 1,
          };
        },
        readMainOnlyWebContentsViewForAttachment() {
          return view;
        },
        async reload() {
          calls.push(['reload']);
          status = 'ready';
        },
        async stop() {
          calls.push(['stop']);
          status = 'stopped';
          await input.static_server.stop();
          return { status };
        },
      };
    },
    async dispose() {
      calls.push(['dispose']);
      return { disposed: true };
    },
  };
  return { calls, runtime };
}

function cleanupFailingRuntimeHarness() {
  const selected = runtimeHarness();
  return {
    calls: selected.calls,
    runtime: {
      ...selected.runtime,
      async start(input) {
        selected.calls.push(['start', input.admission.selected_entry_path, input.static_server.entry_url]);
        const view = {
          id: 'view-cleanup-failure',
          bounds: null,
          setBounds(bounds) {
            view.bounds = bounds;
            selected.calls.push(['bounds', bounds]);
          },
          setVisible(visible) {
            selected.calls.push(['visible', visible]);
          },
        };
        return {
          handle_version: 'builder-live-preview-webcontents-view-handle.v1',
          admission_id: input.admission.admission_id,
          project_id: input.admission.project_id,
          readStatus() {
            return {
              status: 'ready',
              navigation_block_count: 0,
              network_block_count: 0,
              permission_block_count: 0,
              download_block_count: 0,
              window_open_block_count: 0,
            };
          },
          readMainOnlyWebContentsViewForAttachment() {
            return view;
          },
          async reload() {
            selected.calls.push(['reload']);
          },
          async stop() {
            selected.calls.push(['stop']);
            await input.static_server.stop();
            throw new Error('private cleanup failure');
          },
        };
      },
    },
  };
}

function sourceServiceHarness({ fail = false, savedRevision = false, sourceTree = tree() } = {}) {
  const calls = [];
  const service = {
    service_version: 'builder-live-preview-current-draft-source-service.v1',
    async resolve_current_draft_preview_source(payload) {
      calls.push(payload);
      if (fail) throw new Error('private source failure');
      return {
        result_version: 'builder-live-preview-current-draft-source-result.v1',
        service_version: 'builder-live-preview-current-draft-source-service.v1',
        operation: savedRevision
          ? 'saved_revision_live_preview_source_admitted'
          : 'current_draft_live_preview_source_admitted',
        draft_id: savedRevision ? null : DRAFT_ID,
        project_id: payload.project_id,
        conversation_id: payload.conversation_id,
        source_admission: sourceAdmission(sourceTree, savedRevision ? 'saved_revision' : 'current_draft'),
      };
    },
  };
  return { calls, service, setSourceTree(value) { sourceTree = value; }, setFailure(value) { fail = value; } };
}

function fixture(options = {}) {
  const source = sourceServiceHarness(options.source ?? {});
  const runtime = options.runtime ?? runtimeHarness();
  const window = options.window ?? windowHarness();
  let now = 2_000;
  const devCalls = [];
  const devServerRuntime = options.dev ? {
    runtime_version: 'builder-live-preview-dev-server-runtime.v1',
    async start(input) {
      devCalls.push(['start', input]);
      let stopped = false;
      return {
        server_version: 'builder-live-preview-static-server.v1',
        project_id: input.runtime_admission.project_id,
        admission_id: input.runtime_admission.admission_id,
        source_tree_digest: input.runtime_admission.source_tree_digest,
        preview_origin: 'http://127.0.0.1:49321',
        entry_url: 'http://127.0.0.1:49321/',
        async stop() {
          devCalls.push(['stop']);
          if (stopped) return { stopped: false, reason: 'already_stopped' };
          stopped = true;
          return { stopped: true, reason: 'process_tree_closed' };
        },
      };
    },
    async shutdown() { devCalls.push(['shutdown']); },
  } : null;
  const workspaceService = options.dev ? {
    service_version: 'builder-project-workspace-path-service.v1',
    async resolve_project_workspace_path(input) {
      devCalls.push(['workspace', input]);
      return {
        result_version: 'builder-project-workspace-path-result.v1',
        project_id: input.project_id,
        project_root_path: path.resolve('bounded-dev-project'),
        authority: 'main_owned_bound_project_workspace_path',
      };
    },
  } : null;
  const service = createBuilderLivePreviewMainService({
    current_draft_source_service: source.service,
    webcontents_view_runtime: runtime.runtime,
    mainWindowRef: () => window.window,
    now_ms() { return now++; },
    ...(options.dev ? {
      dev_server_runtime: devServerRuntime,
      project_workspace_path_service: workspaceService,
    } : {}),
  });
  return { devCalls, runtime, service, source, window };
}

test('starts a live preview browser from main-owned source and attaches it to requested bounds', async (t) => {
  const selected = fixture();
  t.after(async () => { await selected.service.shutdown(); });
  assert.deepEqual(Reflect.ownKeys(selected.service), [
    'service_version',
    'request_current_draft_live_preview',
    'decide_current_live_preview_dev_server',
    'reload_current_live_preview',
    'stop_current_live_preview',
    'read_current_live_preview_status',
    'update_current_live_preview_layout',
    'shutdown',
  ]);
  const result = await selected.service.request_current_draft_live_preview(request());

  assert.equal(result.status, 'ready');
  assert.equal(result.can_reload, true);
  assert.equal(result.can_stop, true);
  assert.equal(result.blocked_request_count, 4);
  assert.equal(result.navigation_block_count, 1);
  assert.equal(result.network_block_count, 2);
  assert.equal(result.window_open_block_count, 1);
  assert.deepEqual(selected.source.calls, [{
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
  }]);
  assert.equal(selected.runtime.calls[0][0], 'start');
  assert.equal(selected.window.calls[0][0], 'add');
  assert.deepEqual(selected.runtime.calls.find((item) => item[0] === 'bounds')[1], {
    x: 792,
    y: 114,
    width: 480,
    height: 682,
  });
  assert.match(result.entry_url, /^http:\/\/127\.0\.0\.1:/u);
  assert.doesNotMatch(JSON.stringify(result), /"source_tree"|"preview_origin"|"commit_oid"|"tree_oid"/iu);
});

test('requires one-time user approval before starting a discovered project development server', async (t) => {
  const selected = fixture({ dev: true, source: { sourceTree: devTree() } });
  t.after(async () => { await selected.service.shutdown(); });

  const first = await selected.service.request_current_draft_live_preview(request());
  assert.equal(first.status, 'approval_required');
  assert.equal(first.preview_kind, 'live_dev_server_web');
  assert.equal(first.dev_server_approval.command_display, 'npm run dev');
  assert.equal(first.runtime_launch_projection.projection_version, 'builder-project-runtime-launch-projection.v1');
  assert.equal(first.runtime_launch_projection.command_profile, 'main_owned_dev_server_profile');
  assert.equal(first.runtime_launch_projection.user_approval, 'required');
  assert.equal(first.runtime_launch_projection.command_execution, 'approval_required');
  assert.equal(first.runtime_launch_projection.dependency_preparation, 'not_allowed');
  assert.equal(first.runtime_launch_projection.package_install, 'not_allowed');
  assert.equal(first.runtime_launch_projection.provider_dispatch, false);
  assert.equal(first.runtime_launch_projection.tool_dispatch, false);
  assert.equal(first.authority.command_execution, true);
  assert.deepEqual(selected.devCalls.map(([name]) => name), ['workspace']);
  assert.equal(
    selected.service.read_current_live_preview_status(request()).dev_server_approval.approval_request_id,
    first.dev_server_approval.approval_request_id,
  );

  const denied = await selected.service.decide_current_live_preview_dev_server({
    ...request(),
    approval_request_id: first.dev_server_approval.approval_request_id,
    decision: 'deny',
  });
  assert.equal(denied.status, 'stopped');
  assert.deepEqual(selected.devCalls.map(([name]) => name), ['workspace']);

  const second = await selected.service.request_current_draft_live_preview(request());
  const ready = await selected.service.decide_current_live_preview_dev_server({
    ...request(),
    approval_request_id: second.dev_server_approval.approval_request_id,
    decision: 'allow_once',
  });
  assert.equal(ready.status, 'ready');
  assert.equal(ready.entry_url, 'http://127.0.0.1:49321/');
  assert.equal(ready.runtime_launch_projection.user_approval, 'approved_once');
  assert.equal(ready.runtime_launch_projection.command_execution, 'started');
  assert.equal(ready.runtime_launch_projection.sandbox_policy, 'dev_server_only_no_dependency_install');
  assert.deepEqual(selected.devCalls.map(([name]) => name), ['workspace', 'workspace', 'start']);
  await assert.rejects(selected.service.decide_current_live_preview_dev_server({
    ...request(),
    approval_request_id: second.dev_server_approval.approval_request_id,
    decision: 'allow_once',
  }));

  const stopped = await selected.service.stop_current_live_preview(request());
  assert.equal(stopped.status, 'stopped');
  assert.equal(selected.devCalls.some(([name]) => name === 'stop'), true);
});

test('requires dev-server approval for app-router projects without root HTML', async (t) => {
  const selected = fixture({ dev: true, source: { sourceTree: nextTreeWithoutHtml() } });
  t.after(async () => { await selected.service.shutdown(); });

  const first = await selected.service.request_current_draft_live_preview(request());

  assert.equal(first.status, 'approval_required');
  assert.equal(first.preview_kind, 'live_dev_server_web');
  assert.equal(first.dev_server_approval.command_display, 'npm run dev');
  assert.equal(first.runtime_launch_projection.command_execution, 'approval_required');
  assert.deepEqual(selected.devCalls.map(([name]) => name), ['workspace']);
});

test('starts a live preview browser from the current saved revision when no draft exists', async (t) => {
  const selected = fixture({ source: { savedRevision: true } });
  t.after(async () => { await selected.service.shutdown(); });

  const result = await selected.service.request_current_draft_live_preview(request());

  assert.equal(result.status, 'ready');
  assert.equal(result.can_stop, true);
  assert.equal(selected.runtime.calls[0][0], 'start');
  assert.deepEqual(selected.source.calls, [{
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
  }]);
});

test('layout updates follow the Browser panel and hide the native view on other tabs', async (t) => {
  const selected = fixture();
  t.after(async () => { await selected.service.shutdown(); });
  const layout = request({ view_bounds: { x: 610, y: 160, width: 900, height: 900 } });

  await selected.service.update_current_live_preview_layout(layout);
  await selected.service.request_current_draft_live_preview(request());
  await selected.service.update_current_live_preview_layout(
    request({ view_bounds: { x: 700, y: 150, width: 500, height: 600 } }),
  );
  await selected.service.update_current_live_preview_layout(request({ view_bounds: null }));

  assert.deepEqual(
    selected.runtime.calls.filter((item) => item[0] === 'bounds').map((item) => item[1]),
    [
      { x: 610, y: 160, width: 670, height: 660 },
      { x: 700, y: 150, width: 500, height: 600 },
    ],
  );
  assert.deepEqual(
    selected.runtime.calls.filter((item) => item[0] === 'visible').map((item) => item[1]),
    [true, true, false],
  );
});

test('reload updates bounds and stop detaches then cleans up runtime', async () => {
  const selected = fixture();
  await selected.service.request_current_draft_live_preview(request());
  const reloaded = await selected.service.reload_current_live_preview(request());
  const stopped = await selected.service.stop_current_live_preview(request());

  assert.equal(reloaded.status, 'ready');
  assert.equal(stopped.status, 'stopped');
  assert.equal(reloaded.blocked_request_count, 4);
  assert.equal(stopped.blocked_request_count, 4);
  assert.deepEqual(selected.runtime.calls.filter((item) => item[0] === 'bounds').map((item) => item[1]), [
    { x: 792, y: 114, width: 480, height: 682 },
  ]);
  assert.deepEqual(selected.window.calls.map((item) => item[0]), ['add', 'remove']);
  assert.equal(selected.runtime.calls.some((item) => item[0] === 'reload'), true);
  assert.equal(selected.runtime.calls.some((item) => item[0] === 'stop'), true);
});

test('reload replaces an outdated snapshot with the latest admitted source', async (t) => {
  const selected = fixture();
  t.after(() => selected.service.shutdown());
  const initial = await selected.service.request_current_draft_live_preview(request());
  selected.source.setSourceTree(createBuilderProjectSourceTree({ files: [
    { path: 'index.html', content: '<main>Updated preview</main>\n' },
  ] }));
  const updated = await selected.service.reload_current_live_preview(request());
  assert.equal(updated.status, 'ready');
  assert.notEqual(updated.entry_url, initial.entry_url);
  assert.match(await (await fetch(updated.entry_url)).text(), /Updated preview/u);
  assert.deepEqual(selected.runtime.calls.filter(([name]) => ['start', 'reload', 'stop'].includes(name))
    .map(([name]) => name), ['start', 'stop', 'start']);
  const unchanged = await selected.service.reload_current_live_preview(request());
  assert.equal(unchanged.entry_url, updated.entry_url);
  assert.equal(selected.runtime.calls.at(-1)[0], 'reload');
});

test('reload removes the stale view when the latest source cannot be admitted', async (t) => {
  const selected = fixture();
  t.after(() => selected.service.shutdown());
  await selected.service.request_current_draft_live_preview(request());
  selected.source.setFailure(true);
  const failed = await selected.service.reload_current_live_preview(request());
  assert.equal(failed.status, 'failed');
  assert.equal(failed.unavailable_reason, 'no_current_draft_preview_source');
  assert.equal(failed.entry_url, null);
  assert.equal(selected.runtime.calls.some(([name]) => name === 'stop'), true);
  assert.deepEqual(selected.window.calls.map(([name]) => name), ['add', 'remove']);
  assert.equal(selected.service.read_current_live_preview_status(request()).status, 'failed');
  selected.source.setFailure(false);
  assert.equal((await selected.service.request_current_draft_live_preview(request())).status, 'ready');
});

test('serializes overlapping Run and Stop so a stopped view cannot reappear', async (t) => {
  const selected = fixture();
  t.after(() => selected.service.shutdown());
  const start = selected.service.request_current_draft_live_preview(request());
  const stop = selected.service.stop_current_live_preview(request());
  assert.equal((await start).status, 'ready');
  assert.equal((await stop).status, 'stopped');
  assert.equal(selected.service.read_current_live_preview_status(request()).status, 'stopped');
  assert.deepEqual(selected.window.calls.map(([name]) => name), ['add', 'remove']);
});

test('hides a preview when layout ownership moves to another conversation', async (t) => {
  const selected = fixture();
  t.after(() => selected.service.shutdown());
  await selected.service.request_current_draft_live_preview(request());
  const other = request({ conversation_id: `builder-conversation:${UUID}:323e4567-e89b-42d3-a456-426614174000`, view_bounds: null });
  await selected.service.update_current_live_preview_layout(other);
  assert.equal(selected.runtime.calls.at(-1)[0], 'visible');
  assert.equal(selected.runtime.calls.at(-1)[1], false);
  await selected.service.request_current_draft_live_preview(request());
  assert.equal(selected.runtime.calls.filter(([name]) => name === 'visible').at(-1)[1], false);
});

test('changed development-server source requires a fresh one-time approval on reload', async (t) => {
  const selected = fixture({ dev: true, source: { sourceTree: devTree() } });
  t.after(() => selected.service.shutdown());
  const first = await selected.service.request_current_draft_live_preview(request());
  await selected.service.decide_current_live_preview_dev_server({ ...request(),
    approval_request_id: first.dev_server_approval.approval_request_id, decision: 'allow_once' });
  selected.source.setSourceTree(createBuilderProjectSourceTree({ files: [
    ...devTree().files.filter((file) => file.path !== 'index.html').map(({ path, content }) => ({ path, content })),
    { path: 'index.html', content: '<main>Updated development preview</main>\n' },
  ] }));
  const updated = await selected.service.reload_current_live_preview(request());
  assert.equal(updated.status, 'approval_required');
  assert.notEqual(updated.dev_server_approval.approval_request_id, first.dev_server_approval.approval_request_id);
  assert.equal(selected.devCalls.filter(([name]) => name === 'start').length, 1);
  assert.equal(selected.devCalls.filter(([name]) => name === 'stop').length, 1);
});

test('fallback bounds shrink inside narrow windows instead of overflowing', async (t) => {
  const selected = fixture();
  t.after(async () => { await selected.service.shutdown(); });
  selected.window.window.getContentBounds = () => ({ width: 300, height: 420 });

  await selected.service.request_current_draft_live_preview(request());

  assert.deepEqual(selected.runtime.calls.find((item) => item[0] === 'bounds')[1], {
    x: 0,
    y: 88,
    width: 292,
    height: 308,
  });
});

test('read status is idle until started and failed source resolution is redacted', async () => {
  const idle = fixture();
  assert.equal(idle.service.read_current_live_preview_status(request()).status, 'idle');
  assert.equal(idle.service.read_current_live_preview_status(request()).blocked_request_count, 0);

  const selected = fixture({ source: { fail: true } });
  const failed = await selected.service.request_current_draft_live_preview(request());
  assert.equal(failed.status, 'failed');
  assert.equal(failed.message, 'Live preview could not start for the current draft.');
  assert.equal(failed.unavailable_reason, 'no_current_draft_preview_source');
  assert.doesNotMatch(JSON.stringify(failed), /private source failure|"source_admission"|"source_tree"/iu);
});

test('reports fixed runtime and attachment failure reasons without leaking details', async () => {
  const runtimeFailure = fixture({
    runtime: {
      calls: [],
      runtime: {
        runtime_version: 'builder-live-preview-webcontents-view-runtime.v1',
        async start() { throw new Error('private runtime failure'); },
        async dispose() { return { disposed: true }; },
      },
    },
  });
  const runtimeFailed = await runtimeFailure.service.request_current_draft_live_preview(request());
  assert.equal(runtimeFailed.status, 'failed');
  assert.equal(runtimeFailed.unavailable_reason, 'live_preview_runtime_unavailable');
  assert.doesNotMatch(JSON.stringify(runtimeFailed), /private runtime failure|"source_tree"/iu);

  const attachmentFailure = fixture({
    window: {
      calls: [],
      window: {
        contentView: {
          addChildView() { throw new Error('private attach failure'); },
          removeChildView() {},
        },
        getContentBounds() { return { x: 0, y: 0, width: 1280, height: 820 }; },
      },
    },
  });
  const attachmentFailed = await attachmentFailure.service.request_current_draft_live_preview(request());
  assert.equal(attachmentFailed.status, 'failed');
  assert.equal(attachmentFailed.unavailable_reason, 'live_preview_view_attachment_failed');
  assert.doesNotMatch(JSON.stringify(attachmentFailed), /private attach failure|"source_tree"/iu);
});

test('shutdown stops active preview before disposing runtime', async () => {
  const selected = fixture();
  await selected.service.request_current_draft_live_preview(request());
  await selected.service.shutdown();

  assert.deepEqual(selected.window.calls.map((item) => item[0]), ['add', 'remove']);
  assert.deepEqual(selected.runtime.calls.slice(-2).map((item) => item[0]), ['stop', 'dispose']);
});

test('shutdown reports cleanup_required without blocking app quit', async () => {
  const source = sourceServiceHarness();
  const runtime = cleanupFailingRuntimeHarness();
  const window = windowHarness();
  const service = createBuilderLivePreviewMainService({
    current_draft_source_service: source.service,
    webcontents_view_runtime: runtime.runtime,
    mainWindowRef: () => window.window,
    now_ms() { return 2_000; },
  });
  await service.request_current_draft_live_preview(request());

  const result = await service.shutdown();

  assert.deepEqual(result, { shutdown: true, cleanup_required: true });
  assert.deepEqual(window.calls.map((item) => item[0]), ['add', 'remove']);
  assert.deepEqual(runtime.calls.slice(-2).map((item) => item[0]), ['stop', 'dispose']);
});

test('main service source stays preview-specific without provider, save, or package authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-live-preview-main-service.cjs'),
    'utf8',
  );
  assert.match(source, /main_owned_live_preview_ipc_adapter_v1/u);
  assert.match(source, /webcontents_view_runtime/u);
  assert.doesNotMatch(
    source,
    /ipcMain|ipcRenderer|contextBridge|preload\.cjs|builder-check-run|builder-project-save-authority|createBuilderGenerationMainService|provider_dispatch\s*:\s*true|tool_dispatch\s*:\s*true|source_tree_from_renderer:\s*'accepted'|writeFile|appendFile|record_project_revision|verify:package|verify:release/iu,
  );
});
