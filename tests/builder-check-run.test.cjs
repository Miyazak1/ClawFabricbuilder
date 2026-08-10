'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  createBuilderCheckRunAdmission,
  createBuilderCheckRunExecutionApproval,
} = require('../electron/builder-check-run-admission.cjs');
const {
  BuilderCheckRunError,
  createBuilderCheckRun,
  sanitizeBuilderCheckRun,
} = require('../electron/builder-check-run.cjs');
const {
  createBuilderGitCandidateVerificationReceipt,
  sha256Canonical,
} = require('../electron/builder-git-receipt-contract.cjs');
const {
  createBuilderProjectSourceTree,
} = require('../electron/builder-project-source-tree.cjs');
const {
  createBuilderProjectUnderstandingSnapshot,
} = require('../electron/builder-project-understanding.cjs');
const {
  checkRuntimeIdentity,
} = require('./helpers/builder-check-runtime-identity-fixture.cjs');

const UUID = '123e4567-e89b-42d3-a456-426614174000';
const PROJECT_ID = `builder-project:${UUID}`;

function admittedCheck() {
  const tree = createBuilderProjectSourceTree({
    files: [{
      path: 'package.json',
      content: `${JSON.stringify({ scripts: { test: 'node --test' } })}\n`,
    }],
  });
  const understanding = createBuilderProjectUnderstandingSnapshot({
    project_id: PROJECT_ID,
    root_digest: `sha256:${'1'.repeat(64)}`,
    source_tree: tree,
    previous_successful_check_runs: [],
    updated_at_ms: 90,
  });
  const seed = {
    receipt_version: 'builder-git-candidate-receipt.v1',
    repository_version: 'builder-git-project-repository.v1',
    project_id: PROJECT_ID,
    conversation_id: `builder-conversation:${UUID}`,
    turn_id: `builder-turn:${UUID}`,
    task_id: `builder-task:${UUID}`,
    run_id: `builder-run:${UUID}`,
    request_id: `builder-git-request:${UUID}`,
    candidate_id: `builder-code-change-candidate:${'a'.repeat(64)}`,
    candidate_digest: `sha256:${'2'.repeat(64)}`,
    resulting_tree_digest: tree.source_tree_digest,
    semantic_identity_digest: `sha256:${'3'.repeat(64)}`,
    verification_receipt_digest: `sha256:${'4'.repeat(64)}`,
    object_format: 'sha1',
    commit_oid: '5'.repeat(40),
    tree_oid: '6'.repeat(40),
    parent_oid: null,
    expected_base_oid: null,
    code_authority: 'git_commit_candidate',
    product_revision_admission: 'not_recorded',
    replay: false,
  };
  const firstVerification = createBuilderGitCandidateVerificationReceipt(seed);
  const candidate = {
    ...seed,
    verification_receipt_digest: sha256Canonical(firstVerification),
  };
  const verification = createBuilderGitCandidateVerificationReceipt(candidate);
  const checkpoint = {
    checkpoint_id: `builder-draft-checkpoint:${'7'.repeat(64)}`,
    checkpoint_sequence: 1,
    candidate_id: candidate.candidate_id,
    candidate_digest: candidate.candidate_digest,
    resulting_tree_digest: candidate.resulting_tree_digest,
  };
  const approval = createBuilderCheckRunExecutionApproval({
    draft_id: `builder-generation-draft:${'d'.repeat(64)}`,
    draft_checkpoint_ref: checkpoint,
    git_candidate_receipt: candidate,
    git_verification_receipt: verification,
    project_understanding_snapshot: understanding,
    command_profile_id: understanding.command_profiles[0].command_profile_id,
    runtime_identity: checkRuntimeIdentity(),
    approved_at_ms: 100,
    expires_at_ms: 300_100,
  });
  return createBuilderCheckRunAdmission({
    execution_approval: approval,
    draft_checkpoint_ref: checkpoint,
    git_candidate_receipt: candidate,
    git_verification_receipt: verification,
    project_understanding_snapshot: understanding,
    runtime_identity: checkRuntimeIdentity(),
    admitted_at_ms: 101,
  });
}

function resultInput(overrides = {}) {
  return {
    check_run_admission: admittedCheck(),
    status: 'passed',
    exit_code: 0,
    output_digest: `sha256:${'e'.repeat(64)}`,
    failure_class: 'none',
    started_at_ms: 102,
    completed_at_ms: 120,
    ...overrides,
  };
}

function assertCheckError(fn) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof BuilderCheckRunError);
    assert.equal(error.code, 'builder_check_run_invalid');
    assert.equal(error.message, 'The project check result could not be verified.');
    assert.doesNotMatch(JSON.stringify(error), /npm|sha256|candidate|approval/iu);
    return true;
  });
}

test('creates a deterministic terminal CheckRun bound to its exact admission', () => {
  const input = resultInput();
  const passed = createBuilderCheckRun(input);
  assert.deepEqual(passed, createBuilderCheckRun(input));
  assert.equal(passed.admission_id, input.check_run_admission.admission_id);
  assert.equal(passed.approval_id, input.check_run_admission.approval_id);
  assert.equal(passed.script_digest, input.check_run_admission.script_digest);
  assert.equal(passed.invocation_digest, input.check_run_admission.invocation_digest);
  assert.equal(passed.runtime_identity_id, input.check_run_admission.runtime_identity_id);
  assert.equal(passed.draft_checkpoint_sequence, 1);
  assert.equal(passed.status, 'passed');
  assert.equal(passed.output_summary, 'Check completed successfully.');
  assert.match(passed.check_run_id, /^builder-check-run:[0-9a-f]{64}$/u);
  assert.deepEqual(sanitizeBuilderCheckRun(passed), passed);
  assert.ok(Object.isFrozen(passed));
});

test('records admitted failure states without claiming false success', () => {
  for (const [status, failureClass] of [
    ['failed', 'command_failed'],
    ['timed_out', 'timed_out'],
    ['environment_unavailable', 'environment_unavailable'],
    ['cancelled', 'cancelled'],
    ['spawn_failed', 'spawn_failed'],
    ['output_exceeded', 'output_exceeded'],
    ['termination_failed', 'termination_failed'],
  ]) {
    const record = createBuilderCheckRun(resultInput({
      status,
      exit_code: status === 'failed' ? 2 : null,
      failure_class: failureClass,
    }));
    assert.equal(record.status, status);
    assert.notEqual(record.output_summary, 'Check completed successfully.');
  }
});

test('rejects forged admissions, contradictory results, and post-admission drift', () => {
  const input = resultInput();
  assertCheckError(() => createBuilderCheckRun({
    ...input,
    check_run_admission: {
      ...input.check_run_admission,
      invocation_digest: `sha256:${'f'.repeat(64)}`,
    },
  }));
  assertCheckError(() => createBuilderCheckRun({ ...input, status: 'passed', exit_code: 1 }));
  assertCheckError(() => createBuilderCheckRun({
    ...input,
    status: 'timed_out',
    exit_code: null,
    failure_class: 'command_failed',
  }));
  assertCheckError(() => createBuilderCheckRun({ ...input, started_at_ms: 100 }));
  assertCheckError(() => createBuilderCheckRun({
    ...input,
    completed_at_ms: input.started_at_ms + input.check_run_admission.timeout_ms + 30_001,
  }));

  const record = createBuilderCheckRun(input);
  assertCheckError(() => sanitizeBuilderCheckRun({ ...record, extra: true }));
  assertCheckError(() => sanitizeBuilderCheckRun({
    ...record,
    authority: { ...record.authority, save_authority: true },
  }));
  assertCheckError(() => sanitizeBuilderCheckRun({
    ...record,
    admission_digest: `sha256:${'f'.repeat(64)}`,
  }));
});

test('rejects proxies and accessors without invoking hostile code', () => {
  let invoked = false;
  const hostile = {};
  Object.defineProperty(hostile, 'check_run_admission', {
    enumerable: true,
    get() {
      invoked = true;
      return admittedCheck();
    },
  });
  assertCheckError(() => createBuilderCheckRun(hostile));
  assert.equal(invoked, false);
  assertCheckError(() => createBuilderCheckRun(new Proxy(resultInput(), {})));
});

test('source remains a pure admission-bound result fact without execution or storage authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-check-run.cjs'),
    'utf8',
  );
  assert.match(source, /sanitizeBuilderCheckRunAdmission/u);
  assert.doesNotMatch(source, /child_process|\bspawn\b|execFile|shell:\s*true|ipcMain|preload|BrowserWindow/iu);
  assert.doesNotMatch(source, /DatabaseSync|node:sqlite|fetch\s*\(|https?:\/\//iu);
  assert.match(source, /command_execution: 'recorded_admitted_result_only'/u);
  assert.match(source, /save_authority: false/u);
  assert.match(source, /network_authority: 'not_granted_by_check_record'/u);
});
