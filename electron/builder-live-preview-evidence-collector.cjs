'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const BUILDER_LIVE_PREVIEW_EVIDENCE_SUMMARY_VERSION =
  'builder-live-preview-evidence-summary.v1';
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const PROJECT_ID_PATTERN = new RegExp(`^builder-project:${UUID_SOURCE}$`, 'u');
const ADMISSION_ID_PATTERN = /^builder-live-preview-admission:[0-9a-f]{64}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const PREVIEW_ORIGIN_PATTERN = /^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/u;
const PREVIEW_URL_PATTERN = /^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}\/[A-Za-z0-9._~!$&'()*+,;=:@/%-]*$/u;
const INPUT_KEYS = Object.freeze([
  'preview_status',
  'observed_at_ms',
  'console_reports',
  'screenshot_digest',
  'canvas_pixel_status',
  'webgl_status',
  'load_status',
  'error_summary',
]);
const PREVIEW_STATUS_KEYS = Object.freeze([
  'status_version',
  'admission_id',
  'project_id',
  'status',
  'preview_origin',
  'entry_url',
  'partition',
  'navigation_block_count',
  'network_block_count',
  'permission_block_count',
  'download_block_count',
  'window_open_block_count',
  'started_at_ms',
  'stopped_at_ms',
  'authority',
]);
const RUNTIME_AUTHORITY_KEYS = Object.freeze([
  'live_preview_authority',
  'electron_view_creation',
  'renderer_authority',
  'ipc_authority',
  'provider_dispatch',
  'tool_dispatch',
  'command_execution',
  'source_write',
  'git_mutation',
  'sqlite_write',
  'permission_grant',
  'external_navigation',
  'network_access',
  'node_integration',
  'context_isolation',
  'sandbox',
  'preload_script',
  'downloads',
  'new_windows',
  'session_persistence',
]);
const CONSOLE_REPORT_KEYS = Object.freeze(['level', 'source', 'occurred_at_ms']);
const SUMMARY_KEYS = Object.freeze([
  'evidence_version',
  'evidence_id',
  'admission_id',
  'project_id',
  'runtime_status',
  'load_status',
  'preview_origin',
  'entry_url_digest',
  'observed_at_ms',
  'console_error_count',
  'console_warning_count',
  'navigation_block_count',
  'network_block_count',
  'permission_block_count',
  'download_block_count',
  'window_open_block_count',
  'screenshot_digest',
  'canvas_pixel_status',
  'webgl_status',
  'error_summary',
  'authority',
]);
const SUMMARY_AUTHORITY_KEYS = Object.freeze([
  'live_preview_authority',
  'renderer_authority',
  'ipc_authority',
  'provider_dispatch',
  'tool_dispatch',
  'command_execution',
  'source_read',
  'source_write',
  'git_mutation',
  'sqlite_write',
  'permission_grant',
  'revision_admission',
  'save_admission',
  'raw_console_text',
  'raw_external_url',
  'screenshot_bytes',
  'node_integration',
  'preload',
]);
const SUMMARY_AUTHORITY = Object.freeze({
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
const RUNTIME_STATUSES = Object.freeze(['loading', 'ready', 'failed', 'stopped']);
const LOAD_STATUSES = Object.freeze(['ready', 'ready_with_warnings', 'failed', 'stopped', 'blocked']);
const CONSOLE_LEVELS = Object.freeze(['error', 'warning']);
const CONSOLE_SOURCES = Object.freeze(['console', 'pageerror', 'unhandledrejection']);
const CANVAS_PIXEL_STATUSES = Object.freeze(['not_checked', 'nonblank', 'blank', 'not_applicable']);
const WEBGL_STATUSES = Object.freeze(['not_checked', 'available', 'unavailable', 'not_applicable']);
const ERROR_SUMMARIES = Object.freeze([
  'console_errors_present',
  'runtime_failed',
  'blocked_navigation_or_network',
  'blank_canvas',
  'webgl_unavailable',
]);
const ERROR_MESSAGE = 'Builder live preview evidence could not be verified.';

class BuilderLivePreviewEvidenceCollectorError extends Error {
  constructor() {
    super(ERROR_MESSAGE);
    this.name = 'BuilderLivePreviewEvidenceCollectorError';
    this.code = 'builder_live_preview_evidence_invalid';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderLivePreviewEvidenceCollectorError();
}

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freezeDeep(nested);
    Object.freeze(value);
  }
  return value;
}

function isPlainObject(value) {
  if (
    value === null
    || typeof value !== 'object'
    || Array.isArray(value)
    || utilTypes.isProxy(value)
  ) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactObject(value, keys) {
  if (!isPlainObject(value)) fail();
  const own = Reflect.ownKeys(value);
  if (
    own.length !== keys.length
    || own.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) fail();
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      fail();
    }
  }
}

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  return descriptor.value;
}

function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number' && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(valueAt(value, key))}`
    )).join(',')}}`;
  }
  fail();
}

function sha256Canonical(value) {
  return `sha256:${nodeCrypto.createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')}`;
}

function idFor(prefix, body) {
  return `${prefix}:${sha256Canonical(body).slice('sha256:'.length)}`;
}

function safePattern(value, pattern, maximum) {
  if (typeof value !== 'string' || value.length > maximum || !pattern.test(value)) fail();
  return value;
}

function safeProjectId(value) {
  return safePattern(value, PROJECT_ID_PATTERN, 52);
}

function safeAdmissionId(value) {
  return safePattern(value, ADMISSION_ID_PATTERN, 95);
}

function safeDigest(value) {
  return safePattern(value, DIGEST_PATTERN, 71);
}

function safeNullableDigest(value) {
  if (value === null) return null;
  return safeDigest(value);
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail();
  return value;
}

function safeCount(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 10_000) fail();
  return value;
}

function safeEnum(value, allowed) {
  if (!allowed.includes(value)) fail();
  return value;
}

function safeNullableErrorSummary(value) {
  if (value === null) return null;
  return safeEnum(value, ERROR_SUMMARIES);
}

function safePreviewOrigin(value) {
  const origin = safePattern(value, PREVIEW_ORIGIN_PATTERN, 64);
  const parsed = new URL(origin);
  if (parsed.origin !== origin || parsed.hostname !== '127.0.0.1') fail();
  return origin;
}

function safeEntryUrl(value, previewOrigin) {
  const entryUrl = safePattern(value, PREVIEW_URL_PATTERN, 2_048);
  const parsed = new URL(entryUrl);
  if (parsed.origin !== previewOrigin || parsed.username || parsed.password) fail();
  return entryUrl;
}

function safeStoppedAt(value, startedAt, runtimeStatus) {
  if (value === null) {
    if (runtimeStatus === 'stopped') fail();
    return null;
  }
  const stoppedAt = safeTimestamp(value);
  if (runtimeStatus !== 'stopped' || stoppedAt < startedAt) fail();
  return stoppedAt;
}

function safeRuntimeAuthority(value) {
  exactObject(value, RUNTIME_AUTHORITY_KEYS);
  if (
    valueAt(value, 'live_preview_authority') !== 'main_webcontents_view_runtime_v1'
    || valueAt(value, 'renderer_authority') !== 'not_present'
    || valueAt(value, 'ipc_authority') !== 'not_present'
    || valueAt(value, 'provider_dispatch') !== 'not_performed'
    || valueAt(value, 'tool_dispatch') !== 'not_performed'
    || valueAt(value, 'command_execution') !== 'not_performed'
    || valueAt(value, 'source_write') !== 'not_present'
    || valueAt(value, 'git_mutation') !== 'not_performed'
    || valueAt(value, 'sqlite_write') !== 'not_performed'
    || valueAt(value, 'permission_grant') !== 'not_performed'
    || valueAt(value, 'external_navigation') !== 'blocked'
    || valueAt(value, 'network_access') !== 'admitted_preview_origin_only'
    || valueAt(value, 'node_integration') !== 'disabled'
    || valueAt(value, 'context_isolation') !== 'enabled'
    || valueAt(value, 'sandbox') !== 'enabled'
    || valueAt(value, 'preload_script') !== 'not_configured'
    || valueAt(value, 'downloads') !== 'blocked'
    || valueAt(value, 'new_windows') !== 'blocked'
    || valueAt(value, 'session_persistence') !== 'non_persistent'
  ) fail();
}

function safePreviewStatus(value) {
  exactObject(value, PREVIEW_STATUS_KEYS);
  const runtimeStatus = safeEnum(valueAt(value, 'status'), RUNTIME_STATUSES);
  const startedAtMs = safeTimestamp(valueAt(value, 'started_at_ms'));
  safeRuntimeAuthority(valueAt(value, 'authority'));
  const previewOrigin = safePreviewOrigin(valueAt(value, 'preview_origin'));
  return freezeDeep({
    status_version: valueAt(value, 'status_version'),
    admission_id: safeAdmissionId(valueAt(value, 'admission_id')),
    project_id: safeProjectId(valueAt(value, 'project_id')),
    status: runtimeStatus,
    preview_origin: previewOrigin,
    entry_url: safeEntryUrl(valueAt(value, 'entry_url'), previewOrigin),
    partition: safePattern(valueAt(value, 'partition'), /^builder-live-preview-[0-9a-f]{64}$/u, 85),
    navigation_block_count: safeCount(valueAt(value, 'navigation_block_count')),
    network_block_count: safeCount(valueAt(value, 'network_block_count')),
    permission_block_count: safeCount(valueAt(value, 'permission_block_count')),
    download_block_count: safeCount(valueAt(value, 'download_block_count')),
    window_open_block_count: safeCount(valueAt(value, 'window_open_block_count')),
    started_at_ms: startedAtMs,
    stopped_at_ms: safeStoppedAt(valueAt(value, 'stopped_at_ms'), startedAtMs, runtimeStatus),
  });
}

function safeConsoleReports(value, startedAtMs, observedAtMs) {
  if (!Array.isArray(value) || value.length > 100 || utilTypes.isProxy(value)) fail();
  let errorCount = 0;
  let warningCount = 0;
  for (const report of value) {
    exactObject(report, CONSOLE_REPORT_KEYS);
    const level = safeEnum(valueAt(report, 'level'), CONSOLE_LEVELS);
    safeEnum(valueAt(report, 'source'), CONSOLE_SOURCES);
    const occurredAt = safeTimestamp(valueAt(report, 'occurred_at_ms'));
    if (occurredAt < startedAtMs || occurredAt > observedAtMs) fail();
    if (level === 'error') errorCount += 1;
    else warningCount += 1;
  }
  return Object.freeze({ errorCount, warningCount });
}

function safeSummaryAuthority(value) {
  exactObject(value, SUMMARY_AUTHORITY_KEYS);
  for (const key of SUMMARY_AUTHORITY_KEYS) {
    if (valueAt(value, key) !== valueAt(SUMMARY_AUTHORITY, key)) fail();
  }
}

function bodyFor(summary) {
  return {
    evidence_version: summary.evidence_version,
    admission_id: summary.admission_id,
    project_id: summary.project_id,
    runtime_status: summary.runtime_status,
    load_status: summary.load_status,
    preview_origin: summary.preview_origin,
    entry_url_digest: summary.entry_url_digest,
    observed_at_ms: summary.observed_at_ms,
    console_error_count: summary.console_error_count,
    console_warning_count: summary.console_warning_count,
    navigation_block_count: summary.navigation_block_count,
    network_block_count: summary.network_block_count,
    permission_block_count: summary.permission_block_count,
    download_block_count: summary.download_block_count,
    window_open_block_count: summary.window_open_block_count,
    screenshot_digest: summary.screenshot_digest,
    canvas_pixel_status: summary.canvas_pixel_status,
    webgl_status: summary.webgl_status,
    error_summary: summary.error_summary,
  };
}

function createBuilderLivePreviewEvidenceSummary(rawInput) {
  try {
    exactObject(rawInput, INPUT_KEYS);
    const previewStatus = safePreviewStatus(valueAt(rawInput, 'preview_status'));
    if (previewStatus.status_version !== 'builder-live-preview-webcontents-view-status.v1') fail();
    const observedAtMs = safeTimestamp(valueAt(rawInput, 'observed_at_ms'));
    if (observedAtMs < previewStatus.started_at_ms) fail();
    if (previewStatus.stopped_at_ms !== null && observedAtMs < previewStatus.stopped_at_ms) fail();
    const consoleCounts = safeConsoleReports(
      valueAt(rawInput, 'console_reports'),
      previewStatus.started_at_ms,
      observedAtMs,
    );
    const summary = {
      evidence_version: BUILDER_LIVE_PREVIEW_EVIDENCE_SUMMARY_VERSION,
      evidence_id: '',
      admission_id: previewStatus.admission_id,
      project_id: previewStatus.project_id,
      runtime_status: previewStatus.status,
      load_status: safeEnum(valueAt(rawInput, 'load_status'), LOAD_STATUSES),
      preview_origin: previewStatus.preview_origin,
      entry_url_digest: sha256Canonical(previewStatus.entry_url),
      observed_at_ms: observedAtMs,
      console_error_count: consoleCounts.errorCount,
      console_warning_count: consoleCounts.warningCount,
      navigation_block_count: previewStatus.navigation_block_count,
      network_block_count: previewStatus.network_block_count,
      permission_block_count: previewStatus.permission_block_count,
      download_block_count: previewStatus.download_block_count,
      window_open_block_count: previewStatus.window_open_block_count,
      screenshot_digest: safeNullableDigest(valueAt(rawInput, 'screenshot_digest')),
      canvas_pixel_status: safeEnum(valueAt(rawInput, 'canvas_pixel_status'), CANVAS_PIXEL_STATUSES),
      webgl_status: safeEnum(valueAt(rawInput, 'webgl_status'), WEBGL_STATUSES),
      error_summary: safeNullableErrorSummary(valueAt(rawInput, 'error_summary')),
      authority: SUMMARY_AUTHORITY,
    };
    summary.evidence_id = idFor('builder-live-preview-evidence', bodyFor(summary));
    return freezeDeep(summary);
  } catch (error) {
    if (error instanceof BuilderLivePreviewEvidenceCollectorError) throw error;
    throw fail();
  }
}

function sanitizeBuilderLivePreviewEvidenceSummary(rawSummary) {
  try {
    exactObject(rawSummary, SUMMARY_KEYS);
    const summary = {
      evidence_version: valueAt(rawSummary, 'evidence_version'),
      evidence_id: valueAt(rawSummary, 'evidence_id'),
      admission_id: safeAdmissionId(valueAt(rawSummary, 'admission_id')),
      project_id: safeProjectId(valueAt(rawSummary, 'project_id')),
      runtime_status: safeEnum(valueAt(rawSummary, 'runtime_status'), RUNTIME_STATUSES),
      load_status: safeEnum(valueAt(rawSummary, 'load_status'), LOAD_STATUSES),
      preview_origin: safePreviewOrigin(valueAt(rawSummary, 'preview_origin')),
      entry_url_digest: safeDigest(valueAt(rawSummary, 'entry_url_digest')),
      observed_at_ms: safeTimestamp(valueAt(rawSummary, 'observed_at_ms')),
      console_error_count: safeCount(valueAt(rawSummary, 'console_error_count')),
      console_warning_count: safeCount(valueAt(rawSummary, 'console_warning_count')),
      navigation_block_count: safeCount(valueAt(rawSummary, 'navigation_block_count')),
      network_block_count: safeCount(valueAt(rawSummary, 'network_block_count')),
      permission_block_count: safeCount(valueAt(rawSummary, 'permission_block_count')),
      download_block_count: safeCount(valueAt(rawSummary, 'download_block_count')),
      window_open_block_count: safeCount(valueAt(rawSummary, 'window_open_block_count')),
      screenshot_digest: safeNullableDigest(valueAt(rawSummary, 'screenshot_digest')),
      canvas_pixel_status: safeEnum(valueAt(rawSummary, 'canvas_pixel_status'), CANVAS_PIXEL_STATUSES),
      webgl_status: safeEnum(valueAt(rawSummary, 'webgl_status'), WEBGL_STATUSES),
      error_summary: safeNullableErrorSummary(valueAt(rawSummary, 'error_summary')),
      authority: valueAt(rawSummary, 'authority'),
    };
    if (summary.evidence_version !== BUILDER_LIVE_PREVIEW_EVIDENCE_SUMMARY_VERSION) fail();
    safeSummaryAuthority(summary.authority);
    if (
      summary.evidence_id !== idFor('builder-live-preview-evidence', bodyFor(summary))
      || !/^builder-live-preview-evidence:[0-9a-f]{64}$/u.test(summary.evidence_id)
    ) fail();
    return freezeDeep(summary);
  } catch (error) {
    if (error instanceof BuilderLivePreviewEvidenceCollectorError) throw error;
    throw fail();
  }
}

module.exports = Object.freeze({
  BUILDER_LIVE_PREVIEW_EVIDENCE_SUMMARY_VERSION,
  BuilderLivePreviewEvidenceCollectorError,
  createBuilderLivePreviewEvidenceSummary,
  sanitizeBuilderLivePreviewEvidenceSummary,
});
