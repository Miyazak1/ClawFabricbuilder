'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  BUILDER_LIVE_PREVIEW_EVIDENCE_SUMMARY_VERSION,
  BuilderLivePreviewEvidenceCollectorError,
  createBuilderLivePreviewEvidenceSummary,
  sanitizeBuilderLivePreviewEvidenceSummary,
} = require('../electron/builder-live-preview-evidence-collector.cjs');

const PROJECT_ID = 'builder-project:11111111-1111-4111-8111-111111111111';
const ADMISSION_ID = `builder-live-preview-admission:${'a'.repeat(64)}`;

function runtimeAuthority(overrides = {}) {
  return {
    live_preview_authority: 'main_webcontents_view_runtime_v1',
    electron_view_creation: 'performed_by_preview_runtime',
    renderer_authority: 'not_present',
    ipc_authority: 'not_present',
    provider_dispatch: 'not_performed',
    tool_dispatch: 'not_performed',
    command_execution: 'not_performed',
    source_write: 'not_present',
    git_mutation: 'not_performed',
    sqlite_write: 'not_performed',
    permission_grant: 'not_performed',
    external_navigation: 'blocked',
    network_access: 'admitted_preview_origin_only',
    node_integration: 'disabled',
    context_isolation: 'enabled',
    sandbox: 'enabled',
    preload_script: 'not_configured',
    downloads: 'blocked',
    new_windows: 'blocked',
    session_persistence: 'non_persistent',
    ...overrides,
  };
}

function previewStatus(overrides = {}) {
  return {
    status_version: 'builder-live-preview-webcontents-view-status.v1',
    admission_id: ADMISSION_ID,
    project_id: PROJECT_ID,
    status: 'ready',
    preview_origin: 'http://127.0.0.1:49231',
    entry_url: 'http://127.0.0.1:49231/index.html',
    partition: `builder-live-preview-${'b'.repeat(64)}`,
    navigation_block_count: 1,
    network_block_count: 2,
    permission_block_count: 3,
    download_block_count: 4,
    window_open_block_count: 5,
    started_at_ms: 1_000,
    stopped_at_ms: null,
    authority: runtimeAuthority(),
    ...overrides,
  };
}

function evidenceInput(overrides = {}) {
  return {
    preview_status: previewStatus(),
    observed_at_ms: 2_000,
    console_reports: [
      { level: 'error', source: 'pageerror', occurred_at_ms: 1_500 },
      { level: 'warning', source: 'console', occurred_at_ms: 1_700 },
      { level: 'error', source: 'unhandledrejection', occurred_at_ms: 1_900 },
    ],
    screenshot_digest: `sha256:${'c'.repeat(64)}`,
    canvas_pixel_status: 'nonblank',
    webgl_status: 'available',
    load_status: 'ready_with_warnings',
    error_summary: 'console_errors_present',
    ...overrides,
  };
}

function assertFixedError(operation) {
  assert.throws(
    operation,
    (error) => error instanceof BuilderLivePreviewEvidenceCollectorError
      && error.code === 'builder_live_preview_evidence_invalid'
      && error.message === 'Builder live preview evidence could not be verified.'
      && error.stack === `${error.name}: ${error.message}`
      && !`${error.message}:${error.stack}`.includes('private'),
  );
}

test('creates deterministic renderer-safe live preview evidence summaries', () => {
  const summary = createBuilderLivePreviewEvidenceSummary(evidenceInput());
  const repeated = createBuilderLivePreviewEvidenceSummary(evidenceInput());

  assert.equal(BUILDER_LIVE_PREVIEW_EVIDENCE_SUMMARY_VERSION, 'builder-live-preview-evidence-summary.v1');
  assert.equal(summary.evidence_version, BUILDER_LIVE_PREVIEW_EVIDENCE_SUMMARY_VERSION);
  assert.equal(summary.evidence_id, repeated.evidence_id);
  assert.match(summary.evidence_id, /^builder-live-preview-evidence:[0-9a-f]{64}$/u);
  assert.equal(summary.admission_id, ADMISSION_ID);
  assert.equal(summary.project_id, PROJECT_ID);
  assert.equal(summary.runtime_status, 'ready');
  assert.equal(summary.load_status, 'ready_with_warnings');
  assert.equal(summary.preview_origin, 'http://127.0.0.1:49231');
  assert.match(summary.entry_url_digest, /^sha256:[0-9a-f]{64}$/u);
  assert.notEqual(summary.entry_url_digest, 'http://127.0.0.1:49231/index.html');
  assert.equal(summary.console_error_count, 2);
  assert.equal(summary.console_warning_count, 1);
  assert.equal(summary.navigation_block_count, 1);
  assert.equal(summary.network_block_count, 2);
  assert.equal(summary.permission_block_count, 3);
  assert.equal(summary.download_block_count, 4);
  assert.equal(summary.window_open_block_count, 5);
  assert.equal(summary.screenshot_digest, `sha256:${'c'.repeat(64)}`);
  assert.equal(summary.canvas_pixel_status, 'nonblank');
  assert.equal(summary.webgl_status, 'available');
  assert.equal(summary.error_summary, 'console_errors_present');
  assert.equal(Object.isFrozen(summary), true);
  assert.equal(Object.isFrozen(summary.authority), true);
  assert.deepEqual(summary.authority, {
    live_preview_authority: 'main_live_preview_evidence_collector_v1',
    renderer_authority: 'not_present',
    ipc_authority: 'not_present',
    provider_dispatch: 'not_performed',
    tool_dispatch: 'not_performed',
    command_execution: 'not_performed',
    source_read: 'not_present',
    source_write: 'not_present',
    git_mutation: 'not_performed',
    sqlite_write: 'not_performed',
    permission_grant: 'not_performed',
    revision_admission: 'not_created',
    save_admission: 'not_performed',
    raw_console_text: 'not_collected',
    raw_external_url: 'not_collected',
    screenshot_bytes: 'not_collected',
    node_integration: 'not_present',
    preload: 'not_present',
  });
});

test('sanitizes summaries and rejects drift without accepting raw preview material', () => {
  const summary = createBuilderLivePreviewEvidenceSummary(evidenceInput());
  assert.deepEqual(sanitizeBuilderLivePreviewEvidenceSummary(summary), summary);

  assertFixedError(() => sanitizeBuilderLivePreviewEvidenceSummary({
    ...summary,
    console_error_count: summary.console_error_count + 1,
  }));
  assertFixedError(() => sanitizeBuilderLivePreviewEvidenceSummary({
    ...summary,
    authority: {
      ...summary.authority,
      provider_dispatch: 'performed',
    },
  }));
  assertFixedError(() => sanitizeBuilderLivePreviewEvidenceSummary({
    ...summary,
    raw_console_text: 'private stack trace',
  }));
});

test('rejects raw console text, external URLs, screenshots, stale time, and forged runtime authority', () => {
  assertFixedError(() => createBuilderLivePreviewEvidenceSummary(evidenceInput({
    console_reports: [
      {
        level: 'error',
        source: 'pageerror',
        occurred_at_ms: 1_500,
        message: 'private stack trace',
      },
    ],
  })));
  assertFixedError(() => createBuilderLivePreviewEvidenceSummary(evidenceInput({
    preview_status: previewStatus({ entry_url: 'https://example.com/index.html' }),
  })));
  assertFixedError(() => createBuilderLivePreviewEvidenceSummary(evidenceInput({
    screenshot_digest: 'data:image/png;base64,private',
  })));
  assertFixedError(() => createBuilderLivePreviewEvidenceSummary(evidenceInput({
    observed_at_ms: 900,
  })));
  assertFixedError(() => createBuilderLivePreviewEvidenceSummary(evidenceInput({
    preview_status: previewStatus({
      authority: runtimeAuthority({ ipc_authority: 'present' }),
    }),
  })));
});

test('accepts stopped evidence only after stopped time and keeps optional fields nullable', () => {
  const summary = createBuilderLivePreviewEvidenceSummary(evidenceInput({
    preview_status: previewStatus({
      status: 'stopped',
      stopped_at_ms: 3_000,
    }),
    observed_at_ms: 3_500,
    console_reports: [],
    screenshot_digest: null,
    canvas_pixel_status: 'not_checked',
    webgl_status: 'not_checked',
    load_status: 'stopped',
    error_summary: null,
  }));

  assert.equal(summary.runtime_status, 'stopped');
  assert.equal(summary.console_error_count, 0);
  assert.equal(summary.console_warning_count, 0);
  assert.equal(summary.screenshot_digest, null);
  assert.equal(summary.error_summary, null);

  assertFixedError(() => createBuilderLivePreviewEvidenceSummary(evidenceInput({
    preview_status: previewStatus({
      status: 'stopped',
      stopped_at_ms: 3_000,
    }),
    observed_at_ms: 2_999,
  })));
});

test('rejects malformed shapes, proxies, accessors, and oversized console reports without leaking values', () => {
  let trapCalls = 0;
  const proxy = new Proxy({}, {
    getPrototypeOf() {
      trapCalls += 1;
      throw new Error('private proxy trap');
    },
  });
  assertFixedError(() => createBuilderLivePreviewEvidenceSummary(proxy));
  assert.equal(trapCalls, 0);

  let getterCalls = 0;
  const input = evidenceInput();
  Object.defineProperty(input, 'load_status', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return 'ready';
    },
  });
  assertFixedError(() => createBuilderLivePreviewEvidenceSummary(input));
  assert.equal(getterCalls, 0);

  assertFixedError(() => createBuilderLivePreviewEvidenceSummary(evidenceInput({
    console_reports: Array.from({ length: 101 }, () => ({
      level: 'warning',
      source: 'console',
      occurred_at_ms: 1_500,
    })),
  })));
});

test('source remains main-only evidence collection without IPC, UI, provider, command, or mutation authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-live-preview-evidence-collector.cjs'),
    'utf8',
  );
  for (const forbidden of [
    /require\(['"]electron['"]\)|ipcMain|ipcRenderer|contextBridge|BrowserWindow|WebContentsView|BrowserView/u,
    /BuilderPage|BuilderApp|React|styles\.css|main\.cjs|package\.json/u,
    /require\(['"].*preload|preload_path|preloadScript|preload_script:\s*'configured'/iu,
    /builder-generation|builder-conversation|builder-execution-approval|builder-programming-run/iu,
    /provider_dispatch:\s*'performed'|tool_dispatch:\s*'performed'|command_execution:\s*'performed'/u,
    /source_read:\s*'performed'|source_write:\s*'performed'|git_mutation:\s*'performed'/u,
    /sqlite_write:\s*'performed'|permission_grant:\s*'performed'|revision_admission:\s*'created'/u,
    /child_process|execFile|spawn\s*\(|writeFile|appendFile|rmSync|readFileSync/u,
    /Authorization|Bearer|credential|secret|safeStorage/iu,
  ]) assert.doesNotMatch(source, forbidden);
});
