'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const BUILDER_STORAGE_LIFECYCLE_REPORT_VERSION = 'builder-storage-lifecycle-report.v1';
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const PROJECT_ID_PATTERN = new RegExp(`^builder-project:${UUID_SOURCE}$`, 'u');
const CONVERSATION_ID_PATTERN = new RegExp(`^builder-conversation:${UUID_SOURCE}$`, 'u');
const TURN_ID_PATTERN = new RegExp(`^builder-turn:${UUID_SOURCE}$`, 'u');
const RUN_ID_PATTERN = new RegExp(`^builder-run:${UUID_SOURCE}$`, 'u');
const COUNT_MAX = 1_000_000;
const BYTE_MAX = 1024 * 1024 * 1024 * 1024;
const MAX_ACTIVE_RUNS = 32;

const REPORT_INPUT_KEYS = Object.freeze([
  'project_id',
  'generated_at_ms',
  'counts',
  'active_runs',
  'dependencies',
  'derived_storage',
  'retention_policy',
]);
const COUNTS_KEYS = Object.freeze([
  'conversation_count',
  'archived_conversation_count',
  'conversation_event_count',
  'saved_revision_count',
  'pending_candidate_count',
  'failed_unsaved_draft_count',
  'mirror_file_count',
]);
const DEPENDENCY_KEYS = Object.freeze([
  'saved_revision_conversation_count',
  'pending_review_count',
  'pending_permission_request_count',
]);
const DERIVED_STORAGE_KEYS = Object.freeze([
  'preview_cache_bytes',
  'static_snapshot_bytes',
  'task_stream_projection_cache_bytes',
  'temporary_draft_bytes',
  'mirror_bytes',
  'old_log_bytes',
]);
const RETENTION_POLICY_KEYS = Object.freeze([
  'archive_inactive_project_after_days',
  'delete_failed_unsaved_draft_after_days',
  'saved_versions',
]);
const ACTIVE_RUN_KEYS = Object.freeze([
  'conversation_id',
  'turn_id',
  'run_id',
  'mode',
  'status',
]);
const LIFECYCLE = Object.freeze({
  report_authority: 'main_storage_lifecycle_report_v1',
  sqlite_read: 'summarized_by_caller',
  sqlite_delete: 'not_performed',
  sqlite_vacuum: 'not_performed',
  derived_cleanup: 'not_performed',
  export_materialization: 'not_performed',
  renderer_authority: 'not_present',
  provider_dispatch: 'not_performed',
  source_mutation: 'not_performed',
  git_mutation: 'not_performed',
});
const ERROR_MESSAGE = 'Builder storage lifecycle report could not be verified.';

class BuilderStorageLifecycleReportError extends Error {
  constructor() {
    super(ERROR_MESSAGE);
    this.name = 'BuilderStorageLifecycleReportError';
    this.code = 'builder_storage_lifecycle_report_invalid';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderStorageLifecycleReportError();
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
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== keys.length
    || actual.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) fail();
  for (const key of actual) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  }
}

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  return descriptor.value;
}

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freezeDeep(nested);
    Object.freeze(value);
  }
  return value;
}

function safePattern(value, pattern, maximum) {
  if (typeof value !== 'string' || value.length > maximum || !pattern.test(value)) fail();
  return value;
}

function safeProjectId(value) {
  return safePattern(value, PROJECT_ID_PATTERN, 64);
}

function safeConversationId(value) {
  return safePattern(value, CONVERSATION_ID_PATTERN, 96);
}

function safeTurnId(value) {
  return safePattern(value, TURN_ID_PATTERN, 64);
}

function safeRunId(value) {
  return safePattern(value, RUN_ID_PATTERN, 64);
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail();
  return value;
}

function safeCount(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > COUNT_MAX) fail();
  return value;
}

function safeBytes(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > BYTE_MAX) fail();
  return value;
}

function safePositiveDays(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 3650) fail();
  return value;
}

function sanitizeCounts(value) {
  exactObject(value, COUNTS_KEYS);
  const counts = {};
  for (const key of COUNTS_KEYS) counts[key] = safeCount(valueAt(value, key));
  if (counts.archived_conversation_count > counts.conversation_count) fail();
  if (counts.pending_candidate_count > counts.conversation_event_count) fail();
  if (counts.failed_unsaved_draft_count > counts.conversation_event_count) fail();
  return freezeDeep(counts);
}

function sanitizeDependencies(value, counts) {
  exactObject(value, DEPENDENCY_KEYS);
  const dependencies = {};
  for (const key of DEPENDENCY_KEYS) dependencies[key] = safeCount(valueAt(value, key));
  if (dependencies.saved_revision_conversation_count > counts.conversation_count) fail();
  if (dependencies.pending_review_count > counts.conversation_event_count) fail();
  if (dependencies.pending_permission_request_count > counts.conversation_event_count) fail();
  return freezeDeep(dependencies);
}

function sanitizeDerivedStorage(value) {
  exactObject(value, DERIVED_STORAGE_KEYS);
  const storage = {};
  for (const key of DERIVED_STORAGE_KEYS) storage[key] = safeBytes(valueAt(value, key));
  return freezeDeep(storage);
}

function sanitizeRetentionPolicy(value) {
  exactObject(value, RETENTION_POLICY_KEYS);
  const savedVersions = valueAt(value, 'saved_versions');
  if (savedVersions !== 'retain_until_project_delete') fail();
  return freezeDeep({
    archive_inactive_project_after_days: safePositiveDays(valueAt(value, 'archive_inactive_project_after_days')),
    delete_failed_unsaved_draft_after_days: safePositiveDays(valueAt(value, 'delete_failed_unsaved_draft_after_days')),
    saved_versions: savedVersions,
  });
}

function sanitizeActiveRuns(value) {
  if (!Array.isArray(value) || utilTypes.isProxy(value) || value.length > MAX_ACTIVE_RUNS) fail();
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== value.length + 1
    || keys.some((key) => (
      typeof key === 'symbol'
      || (key !== 'length' && !/^(?:0|[1-9][0-9]*)$/u.test(key))
    ))
  ) fail();
  return freezeDeep(value.map((item) => {
    exactObject(item, ACTIVE_RUN_KEYS);
    const mode = valueAt(item, 'mode');
    const status = valueAt(item, 'status');
    if (!['question', 'work', 'plan'].includes(mode)) fail();
    if (!['running', 'cancelling', 'interrupting'].includes(status)) fail();
    return {
      conversation_id: safeConversationId(valueAt(item, 'conversation_id')),
      turn_id: safeTurnId(valueAt(item, 'turn_id')),
      run_id: safeRunId(valueAt(item, 'run_id')),
      mode,
      status,
    };
  }));
}

function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(valueAt(value, key))}`
    )).join(',')}}`;
  }
  fail();
}

function reportIdFor(body) {
  return `builder-storage-lifecycle-report:${nodeCrypto.createHash('sha256')
    .update(canonicalJson(body), 'utf8')
    .digest('hex')}`;
}

function derivedStorageTotal(storage) {
  return DERIVED_STORAGE_KEYS.reduce((total, key) => total + storage[key], 0);
}

function lifecycleRecommendations(counts, dependencies, activeRuns, derivedStorage) {
  const activeRunCount = activeRuns.length;
  const hasSavedRevisionDependencies = dependencies.saved_revision_conversation_count > 0;
  const hasPendingFacts = (
    activeRunCount > 0
    || counts.pending_candidate_count > 0
    || dependencies.pending_review_count > 0
    || dependencies.pending_permission_request_count > 0
  );
  return freezeDeep({
    export_project: 'available_read_only',
    archive_project: activeRunCount > 0
      ? 'available_with_active_run_notice'
      : 'available',
    delete_conversation: activeRunCount > 0
      ? 'blocked_active_run'
      : hasSavedRevisionDependencies
        ? 'blocked_saved_revision_dependency'
        : 'eligible_after_export',
    delete_project: activeRunCount > 0
      ? 'blocked_active_run'
      : hasPendingFacts
        ? 'blocked_pending_work_or_review'
        : counts.saved_revision_count > 0
          ? 'requires_explicit_project_delete_confirmation'
          : 'eligible_after_export',
    cleanup_derived_storage: derivedStorageTotal(derivedStorage) > 0
      ? 'eligible_without_authoritative_fact_delete'
      : 'nothing_to_clean',
    sqlite_maintenance: activeRunCount > 0
      ? 'defer_checkpoint_and_vacuum_until_idle'
      : 'eligible_after_deletion_transaction',
  });
}

function createBuilderStorageLifecycleReport(input) {
  exactObject(input, REPORT_INPUT_KEYS);
  const projectId = safeProjectId(valueAt(input, 'project_id'));
  const generatedAtMs = safeTimestamp(valueAt(input, 'generated_at_ms'));
  const counts = sanitizeCounts(valueAt(input, 'counts'));
  const activeRuns = sanitizeActiveRuns(valueAt(input, 'active_runs'));
  const dependencies = sanitizeDependencies(valueAt(input, 'dependencies'), counts);
  const derivedStorage = sanitizeDerivedStorage(valueAt(input, 'derived_storage'));
  const retentionPolicy = sanitizeRetentionPolicy(valueAt(input, 'retention_policy'));
  const body = freezeDeep({
    project_id: projectId,
    generated_at_ms: generatedAtMs,
    counts,
    active_runs: activeRuns,
    dependencies,
    derived_storage: derivedStorage,
    derived_storage_total_bytes: derivedStorageTotal(derivedStorage),
    retention_policy: retentionPolicy,
    recommendations: lifecycleRecommendations(counts, dependencies, activeRuns, derivedStorage),
    lifecycle: { ...LIFECYCLE },
  });
  return freezeDeep({
    report_version: BUILDER_STORAGE_LIFECYCLE_REPORT_VERSION,
    report_id: reportIdFor(body),
    ...body,
  });
}

function sanitizeBuilderStorageLifecycleReport(value) {
  exactObject(value, [
    'report_version',
    'report_id',
    'project_id',
    'generated_at_ms',
    'counts',
    'active_runs',
    'dependencies',
    'derived_storage',
    'derived_storage_total_bytes',
    'retention_policy',
    'recommendations',
    'lifecycle',
  ]);
  if (valueAt(value, 'report_version') !== BUILDER_STORAGE_LIFECYCLE_REPORT_VERSION) fail();
  const rebuilt = createBuilderStorageLifecycleReport({
    project_id: valueAt(value, 'project_id'),
    generated_at_ms: valueAt(value, 'generated_at_ms'),
    counts: valueAt(value, 'counts'),
    active_runs: valueAt(value, 'active_runs'),
    dependencies: valueAt(value, 'dependencies'),
    derived_storage: valueAt(value, 'derived_storage'),
    retention_policy: valueAt(value, 'retention_policy'),
  });
  if (valueAt(value, 'report_id') !== rebuilt.report_id) fail();
  if (canonicalJson(valueAt(value, 'recommendations')) !== canonicalJson(rebuilt.recommendations)) fail();
  if (canonicalJson(valueAt(value, 'lifecycle')) !== canonicalJson(rebuilt.lifecycle)) fail();
  if (valueAt(value, 'derived_storage_total_bytes') !== rebuilt.derived_storage_total_bytes) fail();
  return rebuilt;
}

module.exports = {
  BUILDER_STORAGE_LIFECYCLE_REPORT_VERSION,
  BuilderStorageLifecycleReportError,
  createBuilderStorageLifecycleReport,
  sanitizeBuilderStorageLifecycleReport,
};
