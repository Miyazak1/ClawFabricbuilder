'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  createBuilderCheckRunAdmission,
  createBuilderCheckRunExecutionApproval,
} = require('../electron/builder-check-run-admission.cjs');
const { createBuilderCheckRun } = require('../electron/builder-check-run.cjs');
const {
  BuilderCheckRunStatusProjectionError,
  projectBuilderCheckRunStatus,
  sanitizeBuilderCheckRunStatusProjection,
} = require('../electron/builder-check-run-status-projection.cjs');
const {
  createBuilderGitCandidateVerificationReceipt,
  sha256Canonical,
} = require('../electron/builder-git-receipt-contract.cjs');
const { createBuilderProjectSourceTree } = require('../electron/builder-project-source-tree.cjs');
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
  const candidate = {
    ...seed,
    verification_receipt_digest: sha256Canonical(
      createBuilderGitCandidateVerificationReceipt(seed),
    ),
  };
  const verification = createBuilderGitCandidateVerificationReceipt(candidate);
  const checkpoint = {
    checkpoint_id: `builder-draft-checkpoint:${'7'.repeat(64)}`,
    checkpoint_sequence: 1,
    candidate_id: candidate.candidate_id,
    candidate_digest: candidate.candidate_digest,
    resulting_tree_digest: candidate.resulting_tree_digest,
  };
  const runtimeIdentity = checkRuntimeIdentity();
  const approval = createBuilderCheckRunExecutionApproval({
    draft_id: `builder-generation-draft:${'d'.repeat(64)}`,
    draft_checkpoint_ref: checkpoint,
    git_candidate_receipt: candidate,
    git_verification_receipt: verification,
    project_understanding_snapshot: understanding,
    command_profile_id: understanding.command_profiles[0].command_profile_id,
    runtime_identity: runtimeIdentity,
    approved_at_ms: 100,
    expires_at_ms: 300_100,
  });
  return createBuilderCheckRunAdmission({
    execution_approval: approval,
    draft_checkpoint_ref: checkpoint,
    git_candidate_receipt: candidate,
    git_verification_receipt: verification,
    project_understanding_snapshot: understanding,
    runtime_identity: runtimeIdentity,
    admitted_at_ms: 101,
  });
}

function checkRun(status = 'passed') {
  const admission = admittedCheck();
  return createBuilderCheckRun({
    check_run_admission: admission,
    status,
    exit_code: status === 'passed' ? 0 : status === 'failed' ? 2 : null,
    output_digest: `sha256:${'e'.repeat(64)}`,
    failure_class: status === 'passed'
      ? 'none'
      : status === 'failed'
        ? 'command_failed'
        : status,
    started_at_ms: 102,
    completed_at_ms: 120,
  });
}

function assertProjectionError(fn) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof BuilderCheckRunStatusProjectionError);
    assert.equal(error.code, 'builder_check_run_status_projection_invalid');
    assert.equal(error.message, 'Builder check status is unavailable.');
    assert.doesNotMatch(JSON.stringify(error), /sha256|candidate|runtime|output|secret/iu);
    return true;
  });
}

test('projects a passed CheckRun as a frozen read-only public summary', () => {
  const run = checkRun();
  const projection = projectBuilderCheckRunStatus({ check_run: run });
  assert.equal(projection.status, 'passed');
  assert.equal(projection.label, 'Checked');
  assert.equal(projection.command_label, 'Tests');
  assert.equal(projection.result_digest, run.check_run_digest);
  assert.equal(projection.authority.check_run_authority, 'verified_check_run_contract');
  assert.equal(projection.authority.command_execution, false);
  assert.equal(projection.authority.raw_output, 'not_present');
  assert.deepEqual(sanitizeBuilderCheckRunStatusProjection(structuredClone(projection)), projection);
  assert.ok(Object.isFrozen(projection));
  assert.ok(Object.isFrozen(projection.authority));
});

test('maps terminal failures to bounded user-facing states', () => {
  for (const [terminalStatus, publicStatus, label] of [
    ['failed', 'failed', 'Check failed'],
    ['output_exceeded', 'failed', 'Check failed'],
    ['timed_out', 'incomplete', 'Check incomplete'],
    ['cancelled', 'incomplete', 'Check incomplete'],
    ['environment_unavailable', 'incomplete', 'Check unavailable'],
    ['spawn_failed', 'incomplete', 'Check unavailable'],
    ['termination_failed', 'incomplete', 'Check needs attention'],
  ]) {
    const projection = projectBuilderCheckRunStatus({ check_run: checkRun(terminalStatus) });
    assert.equal(projection.status, publicStatus);
    assert.equal(projection.label, label);
  }
});

test('rejects forged public labels, identifiers, authority, and extra fields', () => {
  const projection = projectBuilderCheckRunStatus({ check_run: checkRun() });
  assertProjectionError(() => sanitizeBuilderCheckRunStatusProjection({
    ...projection,
    label: 'Everything is safe',
  }));
  assertProjectionError(() => sanitizeBuilderCheckRunStatusProjection({
    ...projection,
    check_run_id: 'builder-check-run:forged',
  }));
  assertProjectionError(() => sanitizeBuilderCheckRunStatusProjection({
    ...projection,
    authority: { ...projection.authority, command_execution: true },
  }));
  assertProjectionError(() => sanitizeBuilderCheckRunStatusProjection({
    ...projection,
    raw_output: 'secret',
  }));
});

test('rejects accessors and proxies without invoking hostile code', () => {
  let invoked = false;
  const hostile = {};
  Object.defineProperty(hostile, 'check_run', {
    enumerable: true,
    get() {
      invoked = true;
      return checkRun();
    },
  });
  assertProjectionError(() => projectBuilderCheckRunStatus(hostile));
  assert.equal(invoked, false);
  assertProjectionError(() => projectBuilderCheckRunStatus(new Proxy({
    check_run: checkRun(),
  }, {})));
});

test('source remains a main-only redacted projection without execution or storage authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-check-run-status-projection.cjs'),
    'utf8',
  );
  assert.match(source, /sanitizeBuilderCheckRun/u);
  assert.match(source, /raw_output: 'not_present'/u);
  assert.doesNotMatch(source, /child_process|\bspawn\b|execFile|shell:\s*true|ipcMain|preload/iu);
  assert.doesNotMatch(source, /DatabaseSync|node:sqlite|fetch\s*\(|https?:\/\//iu);
});
