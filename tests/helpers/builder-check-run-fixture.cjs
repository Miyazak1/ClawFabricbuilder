'use strict';

const {
  createBuilderCheckRunAdmission,
  createBuilderCheckRunExecutionApproval,
} = require('../../electron/builder-check-run-admission.cjs');
const { createBuilderCheckRun } = require('../../electron/builder-check-run.cjs');
const {
  createBuilderGitCandidateVerificationReceipt,
  sha256Canonical,
} = require('../../electron/builder-git-receipt-contract.cjs');
const {
  createBuilderProjectSourceTree,
} = require('../../electron/builder-project-source-tree.cjs');
const {
  createBuilderProjectUnderstandingSnapshot,
} = require('../../electron/builder-project-understanding.cjs');
const { checkRuntimeIdentity } = require('./builder-check-runtime-identity-fixture.cjs');

const UUID = '123e4567-e89b-42d3-a456-426614174000';
const PROJECT_ID = `builder-project:${UUID}`;

function admittedCheck(manager = 'npm', kind = 'test') {
  const lock = manager === 'pnpm' ? 'pnpm-lock.yaml'
    : manager === 'yarn' ? 'yarn.lock'
      : manager === 'bun' ? 'bun.lock' : null;
  const files = [{
    path: 'package.json',
    content: `${JSON.stringify({ scripts: { [kind]: 'fixed-script' } })}\n`,
  }];
  if (lock) files.push({ path: lock, content: 'lock\n' });
  const tree = createBuilderProjectSourceTree({ files });
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
  const runtime = checkRuntimeIdentity({
    package_manager: manager,
    launcher_kind: manager === 'bun' ? 'native_binary' : 'node_cli',
    cli_entry_digest: manager === 'bun' ? null : `sha256:${'b'.repeat(64)}`,
  });
  const approval = createBuilderCheckRunExecutionApproval({
    draft_id: `builder-generation-draft:${'d'.repeat(64)}`,
    draft_checkpoint_ref: checkpoint,
    git_candidate_receipt: candidate,
    git_verification_receipt: verification,
    project_understanding_snapshot: understanding,
    command_profile_id: understanding.command_profiles[0].command_profile_id,
    runtime_identity: runtime,
    approved_at_ms: 100,
    expires_at_ms: 300_100,
  });
  return {
    runtime,
    draft_id: `builder-generation-draft:${'d'.repeat(64)}`,
    checkpoint,
    candidate,
    verification,
    understanding,
    tree,
    command_profile_id: understanding.command_profiles[0].command_profile_id,
    admission: createBuilderCheckRunAdmission({
      execution_approval: approval,
      draft_checkpoint_ref: checkpoint,
      git_candidate_receipt: candidate,
      git_verification_receipt: verification,
      project_understanding_snapshot: understanding,
      runtime_identity: runtime,
      admitted_at_ms: 101,
    }),
  };
}

function checkRun(status = 'passed', manager = 'npm', kind = 'test') {
  const selected = admittedCheck(manager, kind);
  return createBuilderCheckRun({
    check_run_admission: selected.admission,
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

module.exports = Object.freeze({ admittedCheck, checkRun, PROJECT_ID, UUID });
