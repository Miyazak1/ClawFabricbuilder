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
const CONVERSATION_ID = `builder-conversation:${UUID}`;
const DRAFT_ID = `builder-generation-draft:${'d'.repeat(64)}`;
const CHECKPOINT_ID = `builder-draft-checkpoint:${'7'.repeat(64)}`;
const CANDIDATE_ID = `builder-code-change-candidate:${'a'.repeat(64)}`;

function tree() {
  return createBuilderProjectSourceTree({
    files: [
      { path: 'index.html', content: '<main>Live preview</main>\n' },
      { path: 'app.js', content: 'document.body.dataset.ready = "true";\n' },
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

function sourceAdmission(sourceTree = tree()) {
  return createBuilderLivePreviewSourceAdmission({
    source_resolver_result: {
      result_version: BUILDER_LIVE_PREVIEW_SOURCE_RESOLVER_RESULT_VERSION,
      resolver_version: BUILDER_LIVE_PREVIEW_SOURCE_RESOLVER_VERSION,
      operation: 'current_draft_preview_source_resolved',
      source_kind: 'current_draft',
      status: 'ready',
      unavailable_reason: null,
      preview_source_snapshot: {
        snapshot_version: BUILDER_LIVE_PREVIEW_SOURCE_SNAPSHOT_VERSION,
        source_kind: 'current_draft',
        project_id: PROJECT_ID,
        conversation_id: CONVERSATION_ID,
        source_tree: sourceTree,
        source_tree_digest: sourceTree.source_tree_digest,
        source_ref: {
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
    selected_entry_path: 'index.html',
    preview_kind: 'live_static_web',
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
      };
      let status = 'ready';
      return {
        handle_version: 'builder-live-preview-webcontents-view-handle.v1',
        admission_id: input.admission.admission_id,
        project_id: input.admission.project_id,
        readStatus() {
          return {
            status,
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

function sourceServiceHarness({ fail = false } = {}) {
  const calls = [];
  const service = {
    service_version: 'builder-live-preview-current-draft-source-service.v1',
    async resolve_current_draft_preview_source(payload) {
      calls.push(payload);
      if (fail) throw new Error('private source failure');
      return {
        result_version: 'builder-live-preview-current-draft-source-result.v1',
        service_version: 'builder-live-preview-current-draft-source-service.v1',
        operation: 'current_draft_live_preview_source_admitted',
        draft_id: DRAFT_ID,
        project_id: payload.project_id,
        conversation_id: payload.conversation_id,
        source_admission: sourceAdmission(),
      };
    },
  };
  return { calls, service };
}

function fixture(options = {}) {
  const source = sourceServiceHarness(options.source ?? {});
  const runtime = runtimeHarness();
  const window = windowHarness();
  let now = 2_000;
  const service = createBuilderLivePreviewMainService({
    current_draft_source_service: source.service,
    webcontents_view_runtime: runtime.runtime,
    mainWindowRef: () => window.window,
    now_ms() { return now++; },
  });
  return { runtime, service, source, window };
}

test('starts a live preview browser from main-owned source and attaches it to requested bounds', async (t) => {
  const selected = fixture();
  t.after(async () => { await selected.service.shutdown(); });
  assert.deepEqual(Reflect.ownKeys(selected.service), [
    'service_version',
    'request_current_draft_live_preview',
    'reload_current_live_preview',
    'stop_current_live_preview',
    'read_current_live_preview_status',
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
  assert.doesNotMatch(JSON.stringify(result), /"source_tree"|"entry_url"|"preview_origin"|"commit_oid"|"tree_oid"/iu);
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
  assert.doesNotMatch(JSON.stringify(failed), /private source failure|"source_admission"|"source_tree"/iu);
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
