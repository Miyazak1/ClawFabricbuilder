'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  BUILDER_LIVE_PREVIEW_ADMISSION_VERSION,
  BUILDER_PREVIEW_RUN_VERSION,
  BuilderLivePreviewRunError,
  createBuilderLivePreviewAdmission,
  createBuilderPreviewRun,
  sanitizeBuilderLivePreviewAdmission,
  sanitizeBuilderPreviewRun,
} = require('../electron/builder-live-preview-run.cjs');

const PROJECT_ID = 'builder-project:11111111-1111-4111-8111-111111111111';
const CONVERSATION_ID = 'builder-conversation:22222222-2222-4222-8222-222222222222';
const TASK_ID = 'builder-task:33333333-3333-4333-8333-333333333333';
const RUN_ID = 'builder-run:44444444-4444-4444-8444-444444444444';
const DRAFT_CHECKPOINT_ID = `builder-draft-checkpoint:${'a'.repeat(64)}`;

function digest(char) {
  return `sha256:${char.repeat(64)}`;
}

function admissionInput(overrides = {}) {
  return {
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    task_id: TASK_ID,
    run_id: RUN_ID,
    draft_checkpoint_id: DRAFT_CHECKPOINT_ID,
    source_tree_digest: digest('1'),
    selected_entry_path: 'index.html',
    preview_kind: 'live_static_web',
    admitted_at_ms: 1_000,
    expires_at_ms: 61_000,
    ...overrides,
  };
}

function previewRunInput(overrides = {}) {
  return {
    admission: createBuilderLivePreviewAdmission(admissionInput()),
    status: 'ready_with_warnings',
    entry_url: 'http://127.0.0.1:49152/index.html',
    started_at_ms: 2_000,
    completed_at_ms: 2_500,
    console_error_count: 1,
    console_warning_count: 2,
    navigation_block_count: 3,
    network_block_count: 4,
    screenshot_digest: digest('2'),
    canvas_pixel_status: 'nonblank',
    webgl_status: 'available',
    error_summary: 'Preview ran with one blocked external request.',
    ...overrides,
  };
}

function assertLivePreviewError(fn, forbidden = []) {
  assert.throws(
    fn,
    (error) => {
      assert.ok(error instanceof BuilderLivePreviewRunError);
      assert.equal(error.code, 'builder_live_preview_run_invalid');
      const serialized = JSON.stringify({
        name: error.name,
        code: error.code,
        message: error.message,
        stack: error.stack,
      });
      for (const marker of forbidden) assert.doesNotMatch(serialized, new RegExp(marker, 'iu'));
      assert.doesNotMatch(
        serialized,
        /secret-value|credential|provider|source_tree|file_content|Authorization|Bearer|api[_-]?key|C:\\Users/iu,
      );
      return true;
    },
  );
}

test('creates deterministic live preview admission without runtime authority', () => {
  const first = createBuilderLivePreviewAdmission(admissionInput());
  const second = createBuilderLivePreviewAdmission(structuredClone(admissionInput()));

  assert.deepEqual(second, first);
  assert.equal(first.admission_version, BUILDER_LIVE_PREVIEW_ADMISSION_VERSION);
  assert.match(first.admission_id, /^builder-live-preview-admission:[0-9a-f]{64}$/u);
  assert.equal(first.project_id, PROJECT_ID);
  assert.equal(first.conversation_id, CONVERSATION_ID);
  assert.equal(first.task_id, TASK_ID);
  assert.equal(first.run_id, RUN_ID);
  assert.equal(first.draft_checkpoint_id, DRAFT_CHECKPOINT_ID);
  assert.equal(first.selected_entry_path, 'index.html');
  assert.equal(first.preview_kind, 'live_static_web');
  assert.equal(first.authority.live_preview_authority, 'main_live_preview_admission_contract_v1');
  assert.equal(first.authority.renderer_authority, 'not_present');
  assert.equal(first.authority.ipc_authority, 'not_present');
  assert.equal(first.authority.electron_view_creation, 'not_performed');
  assert.equal(first.authority.preview_server, 'not_started');
  assert.equal(first.authority.provider_dispatch, 'not_performed');
  assert.equal(first.authority.tool_dispatch, 'not_performed');
  assert.equal(first.authority.command_execution, 'not_performed');
  assert.equal(first.authority.source_read, 'provided_by_caller_snapshot');
  assert.equal(first.authority.source_write, 'not_present');
  assert.equal(first.authority.git_mutation, 'not_performed');
  assert.equal(first.authority.sqlite_write, 'not_performed');
  assert.equal(first.authority.permission_grant, 'not_performed');
  assert.equal(first.authority.revision_admission, 'not_created');
  assert.equal(first.authority.save_admission, 'not_performed');
  assert.equal(first.authority.network_access, 'not_performed');
  assert.equal(first.authority.external_navigation, 'not_allowed');
  assert.equal(first.authority.node_integration, 'not_present');
  assert.equal(first.authority.preload, 'not_present');
  assert.equal(Object.isFrozen(first), true);
  assert.deepEqual(sanitizeBuilderLivePreviewAdmission(structuredClone(first)), first);
});

test('creates preview run evidence bound to admission without exposing raw preview body', () => {
  const run = createBuilderPreviewRun(previewRunInput());

  assert.equal(run.preview_run_version, BUILDER_PREVIEW_RUN_VERSION);
  assert.match(run.preview_run_id, /^builder-preview-run:[0-9a-f]{64}$/u);
  assert.equal(run.admission_ref.admission_id, previewRunInput().admission.admission_id);
  assert.equal(run.admission_ref.preview_kind, 'live_static_web');
  assert.equal(run.admission_ref.selected_entry_path, 'index.html');
  assert.equal(run.project_id, PROJECT_ID);
  assert.equal(run.source_tree_digest, digest('1'));
  assert.equal(run.entry_url, 'http://127.0.0.1:49152/index.html');
  assert.equal(run.status, 'ready_with_warnings');
  assert.equal(run.console_error_count, 1);
  assert.equal(run.console_warning_count, 2);
  assert.equal(run.navigation_block_count, 3);
  assert.equal(run.network_block_count, 4);
  assert.equal(run.screenshot_digest, digest('2'));
  assert.equal(run.canvas_pixel_status, 'nonblank');
  assert.equal(run.webgl_status, 'available');
  assert.equal(run.authority.live_preview_authority, 'main_preview_run_contract_v1');
  assert.equal(run.authority.electron_view_creation, 'not_performed');
  assert.equal(run.authority.preview_server, 'provided_by_later_runtime');
  assert.equal(run.authority.network_access, 'local_preview_origin_only');
  assert.equal(run.authority.external_navigation, 'blocked');
  assert.equal(run.authority.node_integration, 'not_present');
  assert.equal(run.authority.preload, 'not_present');
  assert.deepEqual(sanitizeBuilderPreviewRun(structuredClone(run)), run);
  assert.doesNotMatch(
    JSON.stringify(run),
    /<script|raw_source_tree|file_content|raw_console|webContents|BrowserView|WebContentsView|ipcMain|provider_secret|Authorization|Bearer/iu,
  );
});

test('supports admitted preview run before server or view runtime exists', () => {
  const run = createBuilderPreviewRun(previewRunInput({
    status: 'admitted',
    entry_url: null,
    completed_at_ms: null,
    console_error_count: 0,
    console_warning_count: 0,
    navigation_block_count: 0,
    network_block_count: 0,
    screenshot_digest: null,
    canvas_pixel_status: 'not_checked',
    webgl_status: 'not_checked',
    error_summary: null,
  }));

  assert.equal(run.status, 'admitted');
  assert.equal(run.entry_url, null);
  assert.equal(run.completed_at_ms, null);
});

test('fails closed on malformed admissions and stale runtime windows', () => {
  assertLivePreviewError(() => createBuilderLivePreviewAdmission({
    ...admissionInput(),
    provider_dispatch: true,
  }));
  assertLivePreviewError(() => createBuilderLivePreviewAdmission({
    ...admissionInput(),
    run_id: null,
    draft_checkpoint_id: null,
  }));
  assertLivePreviewError(() => createBuilderLivePreviewAdmission({
    ...admissionInput(),
    selected_entry_path: '../index.html',
  }));
  assertLivePreviewError(() => createBuilderLivePreviewAdmission({
    ...admissionInput(),
    selected_entry_path: 'src/app.js',
  }));
  assertLivePreviewError(() => createBuilderLivePreviewAdmission({
    ...admissionInput(),
    expires_at_ms: 1_000 + (31 * 60 * 1_000),
  }));
  assertLivePreviewError(() => sanitizeBuilderLivePreviewAdmission({
    ...createBuilderLivePreviewAdmission(admissionInput()),
    authority: {
      ...createBuilderLivePreviewAdmission(admissionInput()).authority,
      ipc_authority: 'renderer_visible',
    },
  }));
});

test('fails closed on unsafe preview run evidence', () => {
  assertLivePreviewError(() => createBuilderPreviewRun(previewRunInput({
    entry_url: 'https://example.com/index.html',
  })));
  assertLivePreviewError(() => createBuilderPreviewRun(previewRunInput({
    entry_url: 'file:///C:/Users/secret/index.html',
  })), ['secret']);
  assertLivePreviewError(() => createBuilderPreviewRun(previewRunInput({
    status: 'ready',
    entry_url: null,
  })));
  assertLivePreviewError(() => createBuilderPreviewRun(previewRunInput({
    status: 'ready',
    completed_at_ms: null,
  })));
  assertLivePreviewError(() => createBuilderPreviewRun(previewRunInput({
    console_error_count: 10_001,
  })));
  const forged = createBuilderPreviewRun(previewRunInput());
  assertLivePreviewError(() => sanitizeBuilderPreviewRun({
    ...forged,
    authority: {
      ...forged.authority,
      electron_view_creation: 'created',
    },
  }));
});

test('rejects proxies and accessors without leaking hostile values', () => {
  assertLivePreviewError(() => createBuilderLivePreviewAdmission(new Proxy(admissionInput(), {})));
  const accessor = {};
  Object.defineProperty(accessor, 'project_id', {
    enumerable: true,
    get() {
      throw new Error('secret-value');
    },
  });
  for (const key of [
    'conversation_id',
    'task_id',
    'run_id',
    'draft_checkpoint_id',
    'source_tree_digest',
    'selected_entry_path',
    'preview_kind',
    'admitted_at_ms',
    'expires_at_ms',
  ]) {
    Object.defineProperty(accessor, key, { enumerable: true, value: admissionInput()[key] });
  }
  assertLivePreviewError(() => createBuilderLivePreviewAdmission(accessor), ['secret-value']);
});

test('source remains a main-only contract without Electron, IPC, server, provider, or source mutation authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-live-preview-run.cjs'),
    'utf8',
  );

  assert.match(source, /main_live_preview_admission_contract_v1/u);
  assert.match(source, /main_preview_run_contract_v1/u);
  assert.match(source, /electron_view_creation:\s*'not_performed'/u);
  assert.match(source, /preview_server:\s*'not_started'/u);
  assert.match(source, /source_write:\s*'not_present'/u);
  assert.match(source, /node_integration:\s*'not_present'/u);
  assert.match(source, /preload:\s*'not_present'/u);
  assert.doesNotMatch(
    source,
    /require\(['"]electron['"]\)|ipcMain|ipcRenderer|contextBridge|BrowserWindow|BrowserView|WebContentsView|session\.fromPartition|createServer|listen\s*\(|node:fs|node:http|node:https|child_process|spawn|execFile|fetch\s*\(|builder-provider|builder-git-|safeStorage|credential|secret_ref/iu,
  );
});
