'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  BuilderCheckFailureTriageError,
  createBuilderCheckFailureTriage,
  sanitizeBuilderCheckFailureTriage,
} = require('../electron/builder-check-failure-triage.cjs');
const { checkRun, PROJECT_ID } = require('./helpers/builder-check-run-fixture.cjs');

function assertTriageError(fn) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof BuilderCheckFailureTriageError);
    assert.equal(error.code, 'builder_check_failure_triage_invalid');
    assert.equal(error.message, 'Builder check failure triage could not be verified.');
    assert.doesNotMatch(JSON.stringify(error), /sha256|candidate|runtime|output|secret/iu);
    return true;
  });
}

test('creates deterministic candidate-bound triage for a failed check', () => {
  const failed = checkRun('failed');
  const input = { check_run: failed, triaged_at_ms: failed.completed_at_ms + 1 };
  const triage = createBuilderCheckFailureTriage(input);

  assert.deepEqual(triage, createBuilderCheckFailureTriage(input));
  assert.equal(triage.triage_version, 'builder-check-failure-triage.v1');
  assert.match(triage.triage_id, /^builder-check-failure-triage:[0-9a-f]{64}$/u);
  assert.equal(triage.project_id, PROJECT_ID);
  assert.equal(triage.check_run_id, failed.check_run_id);
  assert.equal(triage.check_run_digest, failed.check_run_digest);
  assert.equal(triage.candidate_id, failed.candidate_id);
  assert.equal(triage.candidate_digest, failed.candidate_digest);
  assert.equal(triage.resulting_tree_digest, failed.resulting_tree_digest);
  assert.equal(triage.draft_id, failed.draft_id);
  assert.equal(triage.draft_checkpoint_id, failed.draft_checkpoint_id);
  assert.equal(triage.command_kind, 'test');
  assert.equal(triage.status, 'failed');
  assert.equal(triage.failure_class, 'command_failed');
  assert.equal(triage.relevant_output_summary, 'Check failed. Review the project command before saving.');
  assert.equal(triage.repairable, true);
  assert.equal(triage.next_action, 'repair_with_bounded_summary');
  assert.deepEqual(sanitizeBuilderCheckFailureTriage(structuredClone(triage)), triage);
  assert.ok(Object.isFrozen(triage));
});

test('classifies non-success checks into bounded repair or user-action buckets', () => {
  for (const [status, expected] of [
    ['timed_out', {
      failure_class: 'timed_out',
      repairable: true,
      next_action: 'ask_user_or_adjust_check_timeout',
    }],
    ['output_exceeded', {
      failure_class: 'output_exceeded',
      repairable: true,
      next_action: 'ask_user_or_rerun_with_smaller_output',
    }],
    ['environment_unavailable', {
      failure_class: 'environment_unavailable',
      repairable: false,
      next_action: 'ask_user_to_prepare_environment',
    }],
    ['cancelled', {
      failure_class: 'cancelled',
      repairable: false,
      next_action: 'wait_for_user_direction',
    }],
    ['spawn_failed', {
      failure_class: 'spawn_failed',
      repairable: false,
      next_action: 'ask_user_to_prepare_environment',
    }],
    ['termination_failed', {
      failure_class: 'termination_failed',
      repairable: false,
      next_action: 'manual_review_required',
    }],
  ]) {
    const run = checkRun(status);
    const triage = createBuilderCheckFailureTriage({
      check_run: run,
      triaged_at_ms: run.completed_at_ms,
    });
    assert.equal(triage.status, status);
    assert.equal(triage.failure_class, expected.failure_class);
    assert.equal(triage.repairable, expected.repairable);
    assert.equal(triage.next_action, expected.next_action);
    assert.equal(triage.relevant_output_summary, run.output_summary);
  }
});

test('rejects successful, stale, forged, or semantically inconsistent triage records', () => {
  const failed = checkRun('failed');
  const triage = createBuilderCheckFailureTriage({
    check_run: failed,
    triaged_at_ms: failed.completed_at_ms,
  });

  assertTriageError(() => createBuilderCheckFailureTriage({
    check_run: checkRun('passed'),
    triaged_at_ms: 120,
  }));
  assertTriageError(() => createBuilderCheckFailureTriage({
    check_run: failed,
    triaged_at_ms: failed.completed_at_ms - 1,
  }));
  assertTriageError(() => createBuilderCheckFailureTriage({
    check_run: failed,
    triaged_at_ms: failed.completed_at_ms + 86_400_001,
  }));
  assertTriageError(() => sanitizeBuilderCheckFailureTriage({
    ...triage,
    authority: { ...triage.authority, provider_dispatch: true },
  }));
  assertTriageError(() => sanitizeBuilderCheckFailureTriage({
    ...triage,
    relevant_output_summary: 'Check completed successfully.',
  }));
  assertTriageError(() => sanitizeBuilderCheckFailureTriage({
    ...triage,
    repairable: false,
  }));
  assertTriageError(() => sanitizeBuilderCheckFailureTriage({
    ...triage,
    project_id: 'builder-project:forged',
  }));
});

test('rejects proxies and accessors without invoking hostile code', () => {
  let invoked = false;
  const hostile = {};
  Object.defineProperty(hostile, 'check_run', {
    enumerable: true,
    get() {
      invoked = true;
      return checkRun('failed');
    },
  });
  assertTriageError(() => createBuilderCheckFailureTriage(hostile));
  assert.equal(invoked, false);
  assertTriageError(() => createBuilderCheckFailureTriage(new Proxy({
    check_run: checkRun('failed'),
    triaged_at_ms: 121,
  }, {})));
});

test('source remains a pure main-owned triage contract without execution authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-check-failure-triage.cjs'),
    'utf8',
  );
  assert.match(source, /sanitizeBuilderCheckRun/u);
  assert.match(source, /raw_output: 'not_present'/u);
  assert.match(source, /provider_dispatch: false/u);
  assert.match(source, /save_authority: false/u);
  assert.doesNotMatch(
    source,
    /DatabaseSync|node:sqlite|ipcMain|preload|BrowserWindow|fetch\s*\(|child_process|\bspawn\b|execFile|shell:\s*true/iu,
  );
});
