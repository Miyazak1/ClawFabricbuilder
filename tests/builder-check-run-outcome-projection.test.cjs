'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  BuilderCheckRunOutcomeProjectionError,
  projectBuilderCheckRunOutcome,
  sanitizeBuilderCheckRunOutcomeProjection,
} = require('../electron/builder-check-run-outcome-projection.cjs');
const {
  projectBuilderCheckRunStatus,
} = require('../electron/builder-check-run-status-projection.cjs');
const { checkRun, PROJECT_ID } = require('./helpers/builder-check-run-fixture.cjs');

const CANDIDATE_ID = `builder-code-change-candidate:${'a'.repeat(64)}`;

function input(state, status = null) {
  return {
    project_id: PROJECT_ID,
    candidate_id: CANDIDATE_ID,
    state,
    check_run_status_projection: status,
  };
}

function assertOutcomeError(fn) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof BuilderCheckRunOutcomeProjectionError);
    assert.equal(error.code, 'builder_check_run_outcome_projection_invalid');
    assert.doesNotMatch(JSON.stringify(error), /sha256|candidate|runtime|output|secret/iu);
    return true;
  });
}

test('projects verified absence, running activity, and unavailable reads distinctly', () => {
  for (const [state, status, label, factSource] of [
    ['not_run', 'not_run', 'Not checked', 'verified_absence'],
    ['running', 'running', 'Running checks', 'activity_registry'],
    ['unavailable', 'unavailable', 'Check status unavailable', 'status_unavailable'],
  ]) {
    const projection = projectBuilderCheckRunOutcome(input(state));
    assert.equal(projection.state, state);
    assert.equal(projection.status, status);
    assert.equal(projection.label, label);
    assert.equal(projection.command_kind, null);
    assert.equal(projection.completed_at_ms, null);
    assert.equal(projection.authority.fact_source, factSource);
    assert.deepEqual(sanitizeBuilderCheckRunOutcomeProjection(structuredClone(projection)), projection);
  }
});

test('strips CheckRun identity and digest while preserving fixed completed copy', () => {
  const status = projectBuilderCheckRunStatus({ check_run: checkRun('timed_out') });
  const projection = projectBuilderCheckRunOutcome(input('completed', status));
  assert.equal(projection.command_kind, 'test');
  assert.equal(projection.command_label, 'Tests');
  assert.equal(projection.status, 'incomplete');
  assert.equal(projection.label, 'Check incomplete');
  assert.equal(projection.summary, 'The project check reached its time limit.');
  assert.equal(projection.completed_at_ms, 120);
  assert.equal(projection.authority.fact_source, 'verified_current_candidate_check_run');
  assert.doesNotMatch(
    JSON.stringify(projection),
    /check_run_id|candidate_id|result_digest|sha256|exit_code|command_display|runtime_identity|credential/iu,
  );
});

test('rejects mismatched subjects, forged copy, authority, and state combinations', () => {
  const status = projectBuilderCheckRunStatus({ check_run: checkRun() });
  assertOutcomeError(() => projectBuilderCheckRunOutcome({
    ...input('completed', status),
    candidate_id: `builder-code-change-candidate:${'f'.repeat(64)}`,
  }));
  const completed = projectBuilderCheckRunOutcome(input('completed', status));
  assertOutcomeError(() => sanitizeBuilderCheckRunOutcomeProjection({
    ...completed,
    summary: 'Everything is safe.',
  }));
  assertOutcomeError(() => sanitizeBuilderCheckRunOutcomeProjection({
    ...completed,
    authority: { ...completed.authority, save_authority: true },
  }));
  assertOutcomeError(() => projectBuilderCheckRunOutcome(input('running', status)));
});

test('rejects accessors and proxies without invoking hostile code', () => {
  let invoked = false;
  const hostile = {};
  Object.defineProperty(hostile, 'project_id', {
    enumerable: true,
    get() {
      invoked = true;
      return PROJECT_ID;
    },
  });
  assertOutcomeError(() => projectBuilderCheckRunOutcome(hostile));
  assert.equal(invoked, false);
  assertOutcomeError(() => projectBuilderCheckRunOutcome(new Proxy(input('not_run'), {})));
});

test('source stays a pure redacted projection with no execution or storage authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-check-run-outcome-projection.cjs'),
    'utf8',
  );
  assert.match(source, /sanitizeBuilderCheckRunStatusProjection/u);
  assert.match(source, /raw_output: 'not_present'/u);
  assert.doesNotMatch(source, /child_process|execFile|shell:\s*true|ipcMain|preload|DatabaseSync|node:sqlite/iu);
  assert.doesNotMatch(source, /fetch\s*\(|https?:\/\//iu);
});
