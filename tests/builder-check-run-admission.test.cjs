'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  BuilderCheckRunAdmissionError,
  createBuilderCheckRunAdmission,
  createBuilderCheckRunExecutionApproval,
  sanitizeBuilderCheckRunAdmission,
  sanitizeBuilderCheckRunExecutionApproval,
} = require('../electron/builder-check-run-admission.cjs');
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

const UUID = '123e4567-e89b-42d3-a456-426614174000';
const PROJECT_ID = `builder-project:${UUID}`;
const DRAFT_ID = `builder-generation-draft:${'d'.repeat(64)}`;

function sourceTree(script = 'vitest run') {
  return createBuilderProjectSourceTree({
    files: [{
      path: 'package.json',
      content: `${JSON.stringify({ scripts: { test: script } })}\n`,
    }, {
      path: 'test.cjs',
      content: "'use strict';\n",
    }],
  });
}

function understanding(tree = sourceTree()) {
  return createBuilderProjectUnderstandingSnapshot({
    project_id: PROJECT_ID,
    root_digest: `sha256:${'1'.repeat(64)}`,
    source_tree: tree,
    previous_successful_check_runs: [],
    updated_at_ms: 90,
  });
}

function candidateReceipt(tree = sourceTree(), overrides = {}) {
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
    ...overrides,
  };
  const verification = createBuilderGitCandidateVerificationReceipt(seed);
  return { ...seed, verification_receipt_digest: sha256Canonical(verification) };
}

function facts(tree = sourceTree()) {
  const candidate = candidateReceipt(tree);
  return {
    candidate,
    verification: createBuilderGitCandidateVerificationReceipt(candidate),
    checkpoint: {
      checkpoint_id: `builder-draft-checkpoint:${'7'.repeat(64)}`,
      checkpoint_sequence: 1,
      candidate_id: candidate.candidate_id,
      candidate_digest: candidate.candidate_digest,
      resulting_tree_digest: candidate.resulting_tree_digest,
    },
    understanding: understanding(tree),
  };
}

function approvalInput(selected = facts(), overrides = {}) {
  return {
    draft_id: DRAFT_ID,
    draft_checkpoint_ref: selected.checkpoint,
    git_candidate_receipt: selected.candidate,
    git_verification_receipt: selected.verification,
    project_understanding_snapshot: selected.understanding,
    command_profile_id: selected.understanding.command_profiles[0].command_profile_id,
    approved_at_ms: 100,
    expires_at_ms: 100 + (5 * 60 * 1000),
    ...overrides,
  };
}

function admissionInput(approval, selected = facts(), overrides = {}) {
  return {
    execution_approval: approval,
    draft_checkpoint_ref: selected.checkpoint,
    git_candidate_receipt: selected.candidate,
    git_verification_receipt: selected.verification,
    project_understanding_snapshot: selected.understanding,
    admitted_at_ms: 101,
    ...overrides,
  };
}

function assertAdmissionError(fn) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof BuilderCheckRunAdmissionError);
    assert.equal(error.code, 'builder_check_run_admission_invalid');
    assert.equal(error.message, 'The project check could not be approved.');
    assert.doesNotMatch(JSON.stringify(error), /vitest|candidate|sha256|permission/iu);
    return true;
  });
}

test('creates a one-shot candidate and script-bound check execution approval', () => {
  const selected = facts();
  const approval = createBuilderCheckRunExecutionApproval(approvalInput(selected));
  assert.match(
    approval.approval_id,
    /^builder-check-run-execution-approval:[0-9a-f]{64}$/u,
  );
  assert.equal(approval.resulting_tree_digest, selected.candidate.resulting_tree_digest);
  assert.equal(approval.command_display, 'npm test');
  assert.equal(approval.script_digest, selected.understanding.command_profiles[0].script_digest);
  assert.equal(approval.status, 'approved_once');
  assert.equal(approval.execution_policy.sandbox_status, 'unavailable');
  assert.equal(approval.execution_policy.network_enforcement, 'unavailable');
  assert.equal(approval.authority.permission_scope, 'single_check_run_not_project_grant');
  assert.deepEqual(sanitizeBuilderCheckRunExecutionApproval(approval), approval);
  assert.ok(Object.isFrozen(approval));
});

test('admits the approved check only after fresh candidate, checkpoint, and script verification', () => {
  const selected = facts();
  const approval = createBuilderCheckRunExecutionApproval(approvalInput(selected));
  const admission = createBuilderCheckRunAdmission(admissionInput(approval, selected));
  assert.match(admission.admission_id, /^builder-check-run-admission:[0-9a-f]{64}$/u);
  assert.equal(admission.approval_id, approval.approval_id);
  assert.equal(admission.status, 'admitted');
  assert.equal(admission.timeout_ms, 120_000);
  assert.equal(admission.output_budget_bytes, 65_536);
  assert.equal(admission.lifecycle.process_spawn, 'not_performed');
  assert.equal(admission.authority.process_spawn_authority, 'admitted_once_not_dispatched');
  assert.deepEqual(sanitizeBuilderCheckRunAdmission(admission), admission);
});

test('rejects expired approval, candidate drift, checkpoint drift, and script drift', () => {
  const selected = facts();
  const approval = createBuilderCheckRunExecutionApproval(approvalInput(selected));
  assertAdmissionError(() => createBuilderCheckRunAdmission(admissionInput(
    approval,
    selected,
    { admitted_at_ms: approval.expires_at_ms },
  )));

  const otherCandidate = candidateReceipt(sourceTree(), {
    candidate_digest: `sha256:${'8'.repeat(64)}`,
  });
  const candidateDrift = {
    ...selected,
    candidate: otherCandidate,
    verification: createBuilderGitCandidateVerificationReceipt(otherCandidate),
    checkpoint: {
      ...selected.checkpoint,
      candidate_digest: otherCandidate.candidate_digest,
    },
  };
  assertAdmissionError(() => createBuilderCheckRunAdmission(admissionInput(approval, candidateDrift)));
  assertAdmissionError(() => createBuilderCheckRunAdmission(admissionInput(approval, selected, {
    draft_checkpoint_ref: { ...selected.checkpoint, checkpoint_sequence: 2 },
  })));

  const changedTree = sourceTree('node --test');
  const changed = facts(changedTree);
  assertAdmissionError(() => createBuilderCheckRunAdmission(admissionInput(approval, changed)));
});

test('rejects unsafe lifetime, forged policy, wrong commands, accessors, and proxies', () => {
  const selected = facts();
  assertAdmissionError(() => createBuilderCheckRunExecutionApproval(approvalInput(selected, {
    expires_at_ms: 100 + (5 * 60 * 1000) + 1,
  })));
  const approval = createBuilderCheckRunExecutionApproval(approvalInput(selected));
  assertAdmissionError(() => sanitizeBuilderCheckRunExecutionApproval({
    ...approval,
    command_display: 'npm install',
  }));
  assertAdmissionError(() => sanitizeBuilderCheckRunExecutionApproval({
    ...approval,
    execution_policy: { ...approval.execution_policy, network_enforcement: 'blocked' },
  }));
  assertAdmissionError(() => sanitizeBuilderCheckRunExecutionApproval({
    ...approval,
    authority: { ...approval.authority, process_spawn_authority: 'always_allowed' },
  }));

  let invoked = false;
  const hostile = {};
  Object.defineProperty(hostile, 'draft_id', {
    enumerable: true,
    get() {
      invoked = true;
      return DRAFT_ID;
    },
  });
  assertAdmissionError(() => createBuilderCheckRunExecutionApproval(hostile));
  assert.equal(invoked, false);
  assertAdmissionError(() => createBuilderCheckRunExecutionApproval(new Proxy(
    approvalInput(selected),
    {},
  )));
});

test('source remains an admission contract without process, IPC, storage, or save authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-check-run-admission.cjs'),
    'utf8',
  );
  assert.doesNotMatch(source, /child_process|\bspawn\b|execFile|shell:\s*true|ipcMain|preload|BrowserWindow/iu);
  assert.doesNotMatch(source, /DatabaseSync|node:sqlite|fetch\s*\(|https?:\/\//iu);
  assert.match(source, /sandbox_status: 'unavailable'/u);
  assert.match(source, /network_enforcement: 'unavailable'/u);
  assert.match(source, /permission_scope: 'single_check_run_not_project_grant'/u);
  assert.match(source, /save_authority: false/u);
});
