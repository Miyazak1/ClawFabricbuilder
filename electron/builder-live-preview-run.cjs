'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const BUILDER_LIVE_PREVIEW_ADMISSION_VERSION = 'builder-live-preview-admission.v1';
const BUILDER_PREVIEW_RUN_VERSION = 'builder-preview-run.v1';
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const PROJECT_ID_PATTERN = new RegExp(`^builder-project:${UUID_SOURCE}$`, 'u');
const CONVERSATION_ID_PATTERN = new RegExp(`^builder-conversation:${UUID_SOURCE}$`, 'u');
const TASK_ID_PATTERN = new RegExp(`^builder-task:${UUID_SOURCE}$`, 'u');
const RUN_ID_PATTERN = new RegExp(`^builder-run:${UUID_SOURCE}$`, 'u');
const DRAFT_CHECKPOINT_ID_PATTERN = /^builder-draft-checkpoint:[0-9a-f]{64}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const LOCAL_PREVIEW_URL_PATTERN = /^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}\/[A-Za-z0-9._~!$&'()*+,;=:@/%-]*$/u;

const ADMISSION_INPUT_KEYS = Object.freeze([
  'project_id',
  'conversation_id',
  'task_id',
  'run_id',
  'draft_checkpoint_id',
  'source_tree_digest',
  'selected_entry_path',
  'preview_kind',
  'admitted_at_ms',
  'expires_at_ms',
]);
const ADMISSION_KEYS = Object.freeze([
  'admission_version',
  'admission_id',
  'project_id',
  'conversation_id',
  'task_id',
  'run_id',
  'draft_checkpoint_id',
  'source_tree_digest',
  'selected_entry_path',
  'preview_kind',
  'admitted_at_ms',
  'expires_at_ms',
  'authority',
]);
const PREVIEW_RUN_INPUT_KEYS = Object.freeze([
  'admission',
  'status',
  'entry_url',
  'started_at_ms',
  'completed_at_ms',
  'console_error_count',
  'console_warning_count',
  'navigation_block_count',
  'network_block_count',
  'screenshot_digest',
  'canvas_pixel_status',
  'webgl_status',
  'error_summary',
]);
const PREVIEW_RUN_KEYS = Object.freeze([
  'preview_run_version',
  'preview_run_id',
  'admission_ref',
  'project_id',
  'source_tree_digest',
  'entry_url',
  'status',
  'started_at_ms',
  'completed_at_ms',
  'console_error_count',
  'console_warning_count',
  'navigation_block_count',
  'network_block_count',
  'screenshot_digest',
  'canvas_pixel_status',
  'webgl_status',
  'error_summary',
  'authority',
]);
const ADMISSION_REF_KEYS = Object.freeze([
  'admission_id',
  'preview_kind',
  'selected_entry_path',
  'draft_checkpoint_id',
]);
const AUTHORITY_KEYS = Object.freeze([
  'live_preview_authority',
  'renderer_authority',
  'ipc_authority',
  'electron_view_creation',
  'preview_server',
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
  'network_access',
  'external_navigation',
  'node_integration',
  'preload',
]);
const ADMISSION_AUTHORITY = Object.freeze({
  live_preview_authority: 'main_live_preview_admission_contract_v1',
  renderer_authority: 'not_present',
  ipc_authority: 'not_present',
  electron_view_creation: 'not_performed',
  preview_server: 'not_started',
  provider_dispatch: 'not_performed',
  tool_dispatch: 'not_performed',
  command_execution: 'not_performed',
  source_read: 'provided_by_caller_snapshot',
  source_write: 'not_present',
  git_mutation: 'not_performed',
  sqlite_write: 'not_performed',
  permission_grant: 'not_performed',
  revision_admission: 'not_created',
  save_admission: 'not_performed',
  network_access: 'not_performed',
  external_navigation: 'not_allowed',
  node_integration: 'not_present',
  preload: 'not_present',
});
const PREVIEW_RUN_AUTHORITY = Object.freeze({
  live_preview_authority: 'main_preview_run_contract_v1',
  renderer_authority: 'not_present',
  ipc_authority: 'not_present',
  electron_view_creation: 'not_performed',
  preview_server: 'provided_by_later_runtime',
  provider_dispatch: 'not_performed',
  tool_dispatch: 'not_performed',
  command_execution: 'not_performed',
  source_read: 'provided_by_admission_snapshot',
  source_write: 'not_present',
  git_mutation: 'not_performed',
  sqlite_write: 'not_performed',
  permission_grant: 'not_performed',
  revision_admission: 'not_created',
  save_admission: 'not_performed',
  network_access: 'local_preview_origin_only',
  external_navigation: 'blocked',
  node_integration: 'not_present',
  preload: 'not_present',
});
const PREVIEW_KINDS = Object.freeze(['live_static_web']);
const PREVIEW_STATUSES = Object.freeze([
  'admitted',
  'server_starting',
  'loading',
  'ready',
  'ready_with_warnings',
  'blocked',
  'failed',
  'stopped',
]);
const CANVAS_PIXEL_STATUSES = Object.freeze(['not_checked', 'nonblank', 'blank', 'not_applicable']);
const WEBGL_STATUSES = Object.freeze(['not_checked', 'available', 'unavailable', 'not_applicable']);
const ERROR_MESSAGE = 'Builder live preview run could not be verified.';

class BuilderLivePreviewRunError extends Error {
  constructor() {
    super(ERROR_MESSAGE);
    this.name = 'BuilderLivePreviewRunError';
    this.code = 'builder_live_preview_run_invalid';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderLivePreviewRunError();
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
  return nodeCrypto.createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

function idFor(prefix, body) {
  return `${prefix}:${sha256Canonical(body)}`;
}

function safePattern(value, pattern, maximum) {
  if (typeof value !== 'string' || value.length > maximum || !pattern.test(value)) fail();
  return value;
}

function safeProjectId(value) {
  return safePattern(value, PROJECT_ID_PATTERN, 52);
}

function safeConversationId(value) {
  return safePattern(value, CONVERSATION_ID_PATTERN, 57);
}

function safeNullableTaskId(value) {
  if (value === null) return null;
  return safePattern(value, TASK_ID_PATTERN, 50);
}

function safeNullableRunId(value) {
  if (value === null) return null;
  return safePattern(value, RUN_ID_PATTERN, 49);
}

function safeNullableDraftCheckpointId(value) {
  if (value === null) return null;
  return safePattern(value, DRAFT_CHECKPOINT_ID_PATTERN, 89);
}

function safeDigest(value) {
  return safePattern(value, DIGEST_PATTERN, 71);
}

function safeNullableDigest(value) {
  if (value === null) return null;
  return safeDigest(value);
}

function hasUnsafeTextControlCharacter(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function safeBoundedText(value, maximum) {
  if (
    typeof value !== 'string'
    || value.length < 1
    || value.length > maximum
    || value.trim() !== value
    || hasUnsafeTextControlCharacter(value)
  ) fail();
  return value;
}

function safeNullableSummary(value) {
  if (value === null) return null;
  return safeBoundedText(value, 320);
}

function safeEntryPath(value) {
  const entryPath = safeBoundedText(value, 240);
  if (
    entryPath.startsWith('/')
    || entryPath.endsWith('/')
    || entryPath.includes('\\')
    || entryPath.includes('..')
    || !/\.html?$/iu.test(entryPath)
    || /[<>:"|?*]/u.test(entryPath)
  ) fail();
  return entryPath;
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail();
  return value;
}

function safeExpiresAt(value, admittedAt) {
  const expiresAt = safeTimestamp(value);
  if (expiresAt <= admittedAt || expiresAt - admittedAt > 30 * 60 * 1_000) fail();
  return expiresAt;
}

function safeEnum(value, allowed) {
  if (!allowed.includes(value)) fail();
  return value;
}

function safeCount(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 10_000) fail();
  return value;
}

function safeEntryUrl(value, status) {
  if (value === null) {
    if (status === 'admitted' || status === 'server_starting' || status === 'stopped') return null;
    fail();
  }
  const url = safePattern(value, LOCAL_PREVIEW_URL_PATTERN, 2_048);
  const parsed = new URL(url);
  const port = Number(parsed.port);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) fail();
  if (parsed.username || parsed.password || parsed.hash) fail();
  return url;
}

function safeCompletedAt(value, startedAt, status) {
  if (value === null) {
    if (status === 'admitted' || status === 'server_starting' || status === 'loading') return null;
    fail();
  }
  const completedAt = safeTimestamp(value);
  if (completedAt < startedAt) fail();
  return completedAt;
}

function assertAuthority(value, expected) {
  exactObject(value, AUTHORITY_KEYS);
  for (const key of AUTHORITY_KEYS) {
    if (valueAt(value, key) !== valueAt(expected, key)) fail();
  }
  return expected;
}

function sanitizeLivePreviewAdmissionAuthority(value) {
  return assertAuthority(value, ADMISSION_AUTHORITY);
}

function sanitizePreviewRunAuthority(value) {
  return assertAuthority(value, PREVIEW_RUN_AUTHORITY);
}

function createBuilderLivePreviewAdmission(rawInput) {
  try {
    exactObject(rawInput, ADMISSION_INPUT_KEYS);
    const projectId = safeProjectId(valueAt(rawInput, 'project_id'));
    const conversationId = safeConversationId(valueAt(rawInput, 'conversation_id'));
    const taskId = safeNullableTaskId(valueAt(rawInput, 'task_id'));
    const runId = safeNullableRunId(valueAt(rawInput, 'run_id'));
    const draftCheckpointId = safeNullableDraftCheckpointId(valueAt(rawInput, 'draft_checkpoint_id'));
    if (runId === null && draftCheckpointId === null) fail();
    const sourceTreeDigest = safeDigest(valueAt(rawInput, 'source_tree_digest'));
    const selectedEntryPath = safeEntryPath(valueAt(rawInput, 'selected_entry_path'));
    const previewKind = safeEnum(valueAt(rawInput, 'preview_kind'), PREVIEW_KINDS);
    const admittedAtMs = safeTimestamp(valueAt(rawInput, 'admitted_at_ms'));
    const expiresAtMs = safeExpiresAt(valueAt(rawInput, 'expires_at_ms'), admittedAtMs);
    const body = {
      admission_version: BUILDER_LIVE_PREVIEW_ADMISSION_VERSION,
      project_id: projectId,
      conversation_id: conversationId,
      task_id: taskId,
      run_id: runId,
      draft_checkpoint_id: draftCheckpointId,
      source_tree_digest: sourceTreeDigest,
      selected_entry_path: selectedEntryPath,
      preview_kind: previewKind,
      admitted_at_ms: admittedAtMs,
      expires_at_ms: expiresAtMs,
    };
    return freezeDeep({
      ...body,
      admission_id: idFor('builder-live-preview-admission', body),
      authority: ADMISSION_AUTHORITY,
    });
  } catch (error) {
    if (error instanceof BuilderLivePreviewRunError) throw error;
    throw fail();
  }
}

function sanitizeBuilderLivePreviewAdmission(rawAdmission) {
  try {
    exactObject(rawAdmission, ADMISSION_KEYS);
    const admission = {
      admission_version: valueAt(rawAdmission, 'admission_version'),
      admission_id: valueAt(rawAdmission, 'admission_id'),
      project_id: safeProjectId(valueAt(rawAdmission, 'project_id')),
      conversation_id: safeConversationId(valueAt(rawAdmission, 'conversation_id')),
      task_id: safeNullableTaskId(valueAt(rawAdmission, 'task_id')),
      run_id: safeNullableRunId(valueAt(rawAdmission, 'run_id')),
      draft_checkpoint_id: safeNullableDraftCheckpointId(valueAt(rawAdmission, 'draft_checkpoint_id')),
      source_tree_digest: safeDigest(valueAt(rawAdmission, 'source_tree_digest')),
      selected_entry_path: safeEntryPath(valueAt(rawAdmission, 'selected_entry_path')),
      preview_kind: safeEnum(valueAt(rawAdmission, 'preview_kind'), PREVIEW_KINDS),
      admitted_at_ms: safeTimestamp(valueAt(rawAdmission, 'admitted_at_ms')),
      expires_at_ms: 0,
      authority: sanitizeLivePreviewAdmissionAuthority(valueAt(rawAdmission, 'authority')),
    };
    if (admission.admission_version !== BUILDER_LIVE_PREVIEW_ADMISSION_VERSION) fail();
    admission.expires_at_ms = safeExpiresAt(valueAt(rawAdmission, 'expires_at_ms'), admission.admitted_at_ms);
    if (admission.run_id === null && admission.draft_checkpoint_id === null) fail();
    const body = {
      admission_version: admission.admission_version,
      project_id: admission.project_id,
      conversation_id: admission.conversation_id,
      task_id: admission.task_id,
      run_id: admission.run_id,
      draft_checkpoint_id: admission.draft_checkpoint_id,
      source_tree_digest: admission.source_tree_digest,
      selected_entry_path: admission.selected_entry_path,
      preview_kind: admission.preview_kind,
      admitted_at_ms: admission.admitted_at_ms,
      expires_at_ms: admission.expires_at_ms,
    };
    if (admission.admission_id !== idFor('builder-live-preview-admission', body)) fail();
    return freezeDeep(admission);
  } catch (error) {
    if (error instanceof BuilderLivePreviewRunError) throw error;
    throw fail();
  }
}

function admissionRef(admission) {
  return freezeDeep({
    admission_id: admission.admission_id,
    preview_kind: admission.preview_kind,
    selected_entry_path: admission.selected_entry_path,
    draft_checkpoint_id: admission.draft_checkpoint_id,
  });
}

function sanitizeAdmissionRef(value) {
  exactObject(value, ADMISSION_REF_KEYS);
  return freezeDeep({
    admission_id: safePattern(valueAt(value, 'admission_id'), /^builder-live-preview-admission:[0-9a-f]{64}$/u, 95),
    preview_kind: safeEnum(valueAt(value, 'preview_kind'), PREVIEW_KINDS),
    selected_entry_path: safeEntryPath(valueAt(value, 'selected_entry_path')),
    draft_checkpoint_id: safeNullableDraftCheckpointId(valueAt(value, 'draft_checkpoint_id')),
  });
}

function createBuilderPreviewRun(rawInput) {
  try {
    exactObject(rawInput, PREVIEW_RUN_INPUT_KEYS);
    const admission = sanitizeBuilderLivePreviewAdmission(valueAt(rawInput, 'admission'));
    const status = safeEnum(valueAt(rawInput, 'status'), PREVIEW_STATUSES);
    const startedAtMs = safeTimestamp(valueAt(rawInput, 'started_at_ms'));
    const completedAtMs = safeCompletedAt(valueAt(rawInput, 'completed_at_ms'), startedAtMs, status);
    const body = {
      preview_run_version: BUILDER_PREVIEW_RUN_VERSION,
      admission_ref: admissionRef(admission),
      project_id: admission.project_id,
      source_tree_digest: admission.source_tree_digest,
      entry_url: safeEntryUrl(valueAt(rawInput, 'entry_url'), status),
      status,
      started_at_ms: startedAtMs,
      completed_at_ms: completedAtMs,
      console_error_count: safeCount(valueAt(rawInput, 'console_error_count')),
      console_warning_count: safeCount(valueAt(rawInput, 'console_warning_count')),
      navigation_block_count: safeCount(valueAt(rawInput, 'navigation_block_count')),
      network_block_count: safeCount(valueAt(rawInput, 'network_block_count')),
      screenshot_digest: safeNullableDigest(valueAt(rawInput, 'screenshot_digest')),
      canvas_pixel_status: safeEnum(valueAt(rawInput, 'canvas_pixel_status'), CANVAS_PIXEL_STATUSES),
      webgl_status: safeEnum(valueAt(rawInput, 'webgl_status'), WEBGL_STATUSES),
      error_summary: safeNullableSummary(valueAt(rawInput, 'error_summary')),
    };
    return freezeDeep({
      ...body,
      preview_run_id: idFor('builder-preview-run', body),
      authority: PREVIEW_RUN_AUTHORITY,
    });
  } catch (error) {
    if (error instanceof BuilderLivePreviewRunError) throw error;
    throw fail();
  }
}

function sanitizeBuilderPreviewRun(rawRun) {
  try {
    exactObject(rawRun, PREVIEW_RUN_KEYS);
    const status = safeEnum(valueAt(rawRun, 'status'), PREVIEW_STATUSES);
    const startedAtMs = safeTimestamp(valueAt(rawRun, 'started_at_ms'));
    const run = {
      preview_run_version: valueAt(rawRun, 'preview_run_version'),
      preview_run_id: valueAt(rawRun, 'preview_run_id'),
      admission_ref: sanitizeAdmissionRef(valueAt(rawRun, 'admission_ref')),
      project_id: safeProjectId(valueAt(rawRun, 'project_id')),
      source_tree_digest: safeDigest(valueAt(rawRun, 'source_tree_digest')),
      entry_url: safeEntryUrl(valueAt(rawRun, 'entry_url'), status),
      status,
      started_at_ms: startedAtMs,
      completed_at_ms: safeCompletedAt(valueAt(rawRun, 'completed_at_ms'), startedAtMs, status),
      console_error_count: safeCount(valueAt(rawRun, 'console_error_count')),
      console_warning_count: safeCount(valueAt(rawRun, 'console_warning_count')),
      navigation_block_count: safeCount(valueAt(rawRun, 'navigation_block_count')),
      network_block_count: safeCount(valueAt(rawRun, 'network_block_count')),
      screenshot_digest: safeNullableDigest(valueAt(rawRun, 'screenshot_digest')),
      canvas_pixel_status: safeEnum(valueAt(rawRun, 'canvas_pixel_status'), CANVAS_PIXEL_STATUSES),
      webgl_status: safeEnum(valueAt(rawRun, 'webgl_status'), WEBGL_STATUSES),
      error_summary: safeNullableSummary(valueAt(rawRun, 'error_summary')),
      authority: sanitizePreviewRunAuthority(valueAt(rawRun, 'authority')),
    };
    if (run.preview_run_version !== BUILDER_PREVIEW_RUN_VERSION) fail();
    const body = {
      preview_run_version: run.preview_run_version,
      admission_ref: run.admission_ref,
      project_id: run.project_id,
      source_tree_digest: run.source_tree_digest,
      entry_url: run.entry_url,
      status: run.status,
      started_at_ms: run.started_at_ms,
      completed_at_ms: run.completed_at_ms,
      console_error_count: run.console_error_count,
      console_warning_count: run.console_warning_count,
      navigation_block_count: run.navigation_block_count,
      network_block_count: run.network_block_count,
      screenshot_digest: run.screenshot_digest,
      canvas_pixel_status: run.canvas_pixel_status,
      webgl_status: run.webgl_status,
      error_summary: run.error_summary,
    };
    if (run.preview_run_id !== idFor('builder-preview-run', body)) fail();
    return freezeDeep(run);
  } catch (error) {
    if (error instanceof BuilderLivePreviewRunError) throw error;
    throw fail();
  }
}

module.exports = Object.freeze({
  BUILDER_LIVE_PREVIEW_ADMISSION_VERSION,
  BUILDER_PREVIEW_RUN_VERSION,
  BuilderLivePreviewRunError,
  createBuilderLivePreviewAdmission,
  createBuilderPreviewRun,
  sanitizeBuilderLivePreviewAdmission,
  sanitizeBuilderPreviewRun,
});
