'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  BUILDER_STORAGE_LIFECYCLE_REPORT_VERSION,
  BuilderStorageLifecycleReportError,
  createBuilderStorageLifecycleReport,
  sanitizeBuilderStorageLifecycleReport,
} = require('../electron/builder-storage-lifecycle-report.cjs');

const PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174100';
const CONVERSATION_ID = 'builder-conversation:123e4567-e89b-42d3-a456-426614174101';
const TURN_ID = 'builder-turn:123e4567-e89b-42d3-a456-426614174102';
const RUN_ID = 'builder-run:123e4567-e89b-42d3-a456-426614174103';

function reportInput(overrides = {}) {
  return {
    project_id: PROJECT_ID,
    generated_at_ms: 1000,
    counts: {
      conversation_count: 3,
      archived_conversation_count: 1,
      conversation_event_count: 40,
      saved_revision_count: 2,
      pending_candidate_count: 0,
      failed_unsaved_draft_count: 2,
      mirror_file_count: 4,
    },
    active_runs: [],
    dependencies: {
      saved_revision_conversation_count: 1,
      pending_review_count: 0,
      pending_permission_request_count: 0,
    },
    derived_storage: {
      preview_cache_bytes: 100,
      static_snapshot_bytes: 200,
      task_stream_projection_cache_bytes: 300,
      temporary_draft_bytes: 400,
      mirror_bytes: 500,
      old_log_bytes: 600,
    },
    retention_policy: {
      archive_inactive_project_after_days: 90,
      delete_failed_unsaved_draft_after_days: 30,
      saved_versions: 'retain_until_project_delete',
    },
    ...overrides,
  };
}

function assertContractError(fn) {
  assert.throws(
    fn,
    (error) => {
      assert.ok(error instanceof BuilderStorageLifecycleReportError);
      assert.equal(error.code, 'builder_storage_lifecycle_report_invalid');
      const text = `${error.name}:${error.message}:${error.stack}`;
      assert.doesNotMatch(
        text,
        /secret-value|credential|api\.deepseek|Authorization|Bearer|source text|C:\\Users/iu,
      );
      return true;
    },
  );
}

test('creates a deterministic read-only storage lifecycle report without cleanup authority', () => {
  const report = createBuilderStorageLifecycleReport(reportInput());
  const same = createBuilderStorageLifecycleReport(reportInput());

  assert.deepEqual(report, same);
  assert.equal(report.report_version, BUILDER_STORAGE_LIFECYCLE_REPORT_VERSION);
  assert.match(report.report_id, /^builder-storage-lifecycle-report:[0-9a-f]{64}$/u);
  assert.equal(report.project_id, PROJECT_ID);
  assert.equal(report.derived_storage_total_bytes, 2100);
  assert.equal(report.recommendations.export_project, 'available_read_only');
  assert.equal(report.recommendations.archive_project, 'available');
  assert.equal(report.recommendations.delete_conversation, 'blocked_saved_revision_dependency');
  assert.equal(report.recommendations.delete_project, 'requires_explicit_project_delete_confirmation');
  assert.equal(report.recommendations.cleanup_derived_storage, 'eligible_without_authoritative_fact_delete');
  assert.equal(report.recommendations.sqlite_maintenance, 'eligible_after_deletion_transaction');
  assert.equal(report.lifecycle.report_authority, 'main_storage_lifecycle_report_v1');
  assert.equal(report.lifecycle.sqlite_read, 'summarized_by_caller');
  assert.equal(report.lifecycle.sqlite_delete, 'not_performed');
  assert.equal(report.lifecycle.sqlite_vacuum, 'not_performed');
  assert.equal(report.lifecycle.derived_cleanup, 'not_performed');
  assert.equal(report.lifecycle.export_materialization, 'not_performed');
  assert.equal(report.lifecycle.provider_dispatch, 'not_performed');
  assert.equal(report.lifecycle.source_mutation, 'not_performed');
  assert.equal(report.lifecycle.git_mutation, 'not_performed');
  assert.equal(Object.hasOwn(report, 'path'), false);
  assert.equal(Object.hasOwn(report, 'source_tree'), false);
  assert.equal(Object.hasOwn(report, 'credential'), false);
  assert.equal(Object.hasOwn(report, 'provider'), false);
  assert.equal(Object.isFrozen(report), true);
  assert.equal(Object.isFrozen(report.recommendations), true);
  assert.equal(Object.isFrozen(report.lifecycle), true);
  assert.deepEqual(sanitizeBuilderStorageLifecycleReport(structuredClone(report)), report);
});

test('blocks destructive lifecycle actions while runs or pending work are active', () => {
  const report = createBuilderStorageLifecycleReport(reportInput({
    active_runs: [{
      conversation_id: CONVERSATION_ID,
      turn_id: TURN_ID,
      run_id: RUN_ID,
      mode: 'work',
      status: 'running',
    }],
    dependencies: {
      saved_revision_conversation_count: 0,
      pending_review_count: 1,
      pending_permission_request_count: 1,
    },
  }));

  assert.equal(report.active_runs.length, 1);
  assert.equal(report.recommendations.archive_project, 'available_with_active_run_notice');
  assert.equal(report.recommendations.delete_conversation, 'blocked_active_run');
  assert.equal(report.recommendations.delete_project, 'blocked_active_run');
  assert.equal(report.recommendations.sqlite_maintenance, 'defer_checkpoint_and_vacuum_until_idle');
  assert.equal(report.lifecycle.sqlite_delete, 'not_performed');
});

test('allows derived cleanup reporting before authoritative fact deletion', () => {
  const report = createBuilderStorageLifecycleReport(reportInput({
    counts: {
      conversation_count: 1,
      archived_conversation_count: 0,
      conversation_event_count: 5,
      saved_revision_count: 0,
      pending_candidate_count: 0,
      failed_unsaved_draft_count: 0,
      mirror_file_count: 0,
    },
    dependencies: {
      saved_revision_conversation_count: 0,
      pending_review_count: 0,
      pending_permission_request_count: 0,
    },
    derived_storage: {
      preview_cache_bytes: 0,
      static_snapshot_bytes: 0,
      task_stream_projection_cache_bytes: 0,
      temporary_draft_bytes: 0,
      mirror_bytes: 0,
      old_log_bytes: 0,
    },
  }));

  assert.equal(report.recommendations.delete_conversation, 'eligible_after_export');
  assert.equal(report.recommendations.delete_project, 'eligible_after_export');
  assert.equal(report.recommendations.cleanup_derived_storage, 'nothing_to_clean');
  assert.equal(report.derived_storage_total_bytes, 0);
});

test('fails closed on malformed counts, forged ids, or fabricated lifecycle', () => {
  assertContractError(() => createBuilderStorageLifecycleReport(reportInput({
    counts: {
      ...reportInput().counts,
      archived_conversation_count: 9,
    },
  })));
  assertContractError(() => createBuilderStorageLifecycleReport(reportInput({
    active_runs: [{
      conversation_id: CONVERSATION_ID,
      turn_id: TURN_ID,
      run_id: RUN_ID,
      mode: 'work',
      status: 'completed',
    }],
  })));
  assertContractError(() => createBuilderStorageLifecycleReport(reportInput({
    project_id: 'builder-project:not-a-uuid',
  })));

  const report = createBuilderStorageLifecycleReport(reportInput());
  assertContractError(() => sanitizeBuilderStorageLifecycleReport({
    ...structuredClone(report),
    lifecycle: {
      ...report.lifecycle,
      sqlite_delete: 'performed',
    },
  }));
  assertContractError(() => sanitizeBuilderStorageLifecycleReport({
    ...structuredClone(report),
    recommendations: {
      ...report.recommendations,
      delete_project: 'eligible_after_export',
    },
  }));
});
