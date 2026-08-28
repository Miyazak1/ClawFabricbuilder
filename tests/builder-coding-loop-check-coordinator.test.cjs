'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  BuilderCodingLoopCheckCoordinatorError,
  createBuilderCodingLoopCheckCoordinator,
} = require('../electron/builder-coding-loop-check-coordinator.cjs');
const {
  BUILDER_CHECK_RUN_MAIN_RESULT_VERSION,
  BUILDER_CHECK_RUN_MAIN_SERVICE_VERSION,
} = require('../electron/builder-check-run-main-service.cjs');
const {
  projectBuilderCheckRunStatus,
} = require('../electron/builder-check-run-status-projection.cjs');
const {
  createBuilderCheckRun,
} = require('../electron/builder-check-run.cjs');
const {
  createBuilderCheckRunAdmission,
  createBuilderCheckRunExecutionApproval,
} = require('../electron/builder-check-run-admission.cjs');
const {
  createBuilderGitCandidateVerificationReceipt,
  sha256Canonical,
} = require('../electron/builder-git-receipt-contract.cjs');
const {
  createBuilderProjectSourceTree,
} = require('../electron/builder-project-source-tree.cjs');
const { checkRuntimeIdentity } = require('./helpers/builder-check-runtime-identity-fixture.cjs');

const UUID = '123e4567-e89b-42d3-a456-426614174000';
const PROJECT_ID = `builder-project:${UUID}`;
const CONVERSATION_ID = `builder-conversation:${UUID}`;
const TURN_ID = `builder-turn:${UUID}`;
const TASK_ID = `builder-task:${UUID}`;
const RUN_ID = `builder-run:${UUID}`;
const DRAFT_ID = `builder-generation-draft:${'d'.repeat(64)}`;

function sourceTree(scripts = { lint: 'eslint .', test: 'node --test', build: 'vite build' }) {
  return createBuilderProjectSourceTree({
    files: [{ path: 'package.json', content: `${JSON.stringify({ scripts })}\n` }],
  });
}

function candidate(tree) {
  const seed = {
    receipt_version: 'builder-git-candidate-receipt.v1',
    repository_version: 'builder-git-project-repository.v1',
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    turn_id: TURN_ID,
    task_id: TASK_ID,
    run_id: RUN_ID,
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
  return {
    ...seed,
    verification_receipt_digest: sha256Canonical(
      createBuilderGitCandidateVerificationReceipt(seed),
    ),
  };
}

function checkpoint(receipt) {
  return {
    result_version: 'builder-automatic-draft-checkpoint-result.v1',
    service_version: 'builder-automatic-draft-checkpoint-service.v1',
    operation: 'current_candidate_checkpoint_verified',
    status: 'verified',
    checkpoint_ref: {
      checkpoint_id: `builder-draft-checkpoint:${'7'.repeat(64)}`,
      checkpoint_sequence: 1,
      candidate_id: receipt.candidate_id,
      candidate_digest: receipt.candidate_digest,
      resulting_tree_digest: receipt.resulting_tree_digest,
    },
    verification_admission: 'main_owned_latest_checkpoint_verified',
  };
}

function fixture({ tree = sourceTree(), mutateCheckpoint, checkStatus = 'passed' } = {}) {
  const receipt = candidate(tree);
  const verification = createBuilderGitCandidateVerificationReceipt(receipt);
  const calls = { checkpoint: [], run: [], skip: [], activity: [] };
  let now = 100;
  const coordinator = createBuilderCodingLoopCheckCoordinator({
    automatic_draft_checkpoint_service: {
      service_version: 'builder-automatic-draft-checkpoint-service.v1',
      verify_current_candidate_checkpoint(request) {
        calls.checkpoint.push(request);
        const result = checkpoint(receipt);
        return mutateCheckpoint ? mutateCheckpoint(result) : result;
      },
    },
    check_run_main_service: {
      service_version: BUILDER_CHECK_RUN_MAIN_SERVICE_VERSION,
      run_approved_check(request) {
        calls.run.push(request);
        const runtime = checkRuntimeIdentity({ expires_at_ms: 300_200 });
        const approval = createBuilderCheckRunExecutionApproval({
          draft_id: request.draft_id,
          draft_checkpoint_ref: request.draft_checkpoint_ref,
          git_candidate_receipt: request.git_candidate_receipt,
          git_verification_receipt: request.git_verification_receipt,
          project_understanding_snapshot: request.project_understanding_snapshot,
          command_profile_id: request.command_profile_id,
          runtime_identity: runtime,
          approved_at_ms: 200,
          expires_at_ms: 300_200,
        });
        const admission = createBuilderCheckRunAdmission({
          execution_approval: approval,
          draft_checkpoint_ref: request.draft_checkpoint_ref,
          git_candidate_receipt: request.git_candidate_receipt,
          git_verification_receipt: request.git_verification_receipt,
          project_understanding_snapshot: request.project_understanding_snapshot,
          runtime_identity: runtime,
          admitted_at_ms: 201,
        });
        const checkRun = createBuilderCheckRun({
          check_run_admission: admission,
          status: checkStatus,
          exit_code: checkStatus === 'passed' ? 0 : null,
          output_digest: `sha256:${'e'.repeat(64)}`,
          failure_class: checkStatus === 'passed' ? 'none' : checkStatus,
          started_at_ms: 202,
          completed_at_ms: 220,
        });
        return {
          result_version: BUILDER_CHECK_RUN_MAIN_RESULT_VERSION,
          operation: 'approved_check_completed',
          check_run_status_projection: projectBuilderCheckRunStatus({ check_run: checkRun }),
        };
      },
    },
    check_skip_decision_store: {
      store_version: 'builder-check-skip-decision-store.v1',
      record_check_skip_decision(request) {
        calls.skip.push(request);
        return {
          result_version: 'builder-check-skip-decision-store-result.v1',
          operation: 'check_skip_decision_recorded',
          check_skip_decision: request.check_skip_decision,
          store_evidence: {},
        };
      },
    },
    activity_registry: {
      registry_version: 'builder-check-run-activity-registry.v1',
      notify_candidate_projection_changed(request) {
        calls.activity.push(request);
        return true;
      },
    },
    clock: {
      clock_version: 'builder-clock.v1',
      now_ms() { return now++; },
    },
  });
  return { calls, coordinator, receipt, tree, verification };
}

function request(selected) {
  return {
    draft_id: DRAFT_ID,
    candidate_receipt: selected.receipt,
    candidate_verification: selected.verification,
    source_tree: selected.tree,
  };
}

test('automatically selects a relevant check and runs it from main-owned candidate facts', async () => {
  const selected = fixture();
  const result = await selected.coordinator.run_automatic_candidate_check(request(selected));

  assert.equal(result.status, 'completed');
  assert.equal(result.profile.command_kind, 'test');
  assert.equal(result.profile.command_display, 'npm test');
  assert.equal(result.check_run_status_projection.status, 'passed');
  assert.equal(result.duration_ms, 1);
  assert.equal(result.authority, 'main_owned_verified_candidate_auto_check');
  assert.equal(selected.calls.checkpoint.length, 1);
  assert.equal(selected.calls.run.length, 1);
  assert.deepEqual(selected.calls.run[0].source_tree, selected.tree);
  assert.equal(selected.calls.run[0].project_understanding_snapshot.source_tree_digest,
    selected.tree.source_tree_digest);
});

test('records a main-owned skip decision when no checks are discovered', async () => {
  const selected = fixture({
    tree: createBuilderProjectSourceTree({ files: [{ path: 'index.html', content: '<main />\n' }] }),
  });
  const result = await selected.coordinator.run_automatic_candidate_check(request(selected));

  assert.equal(result.status, 'no_checks');
  assert.equal(result.profile, null);
  assert.equal(result.check_run_status_projection, null);
  assert.equal(selected.calls.run.length, 0);
  assert.equal(selected.calls.skip.length, 1);
  assert.equal(
    selected.calls.skip[0].check_skip_decision.reason_code,
    'no_project_checks_detected',
  );
  assert.equal(
    selected.calls.skip[0].check_skip_decision.authority.intent_evidence,
    'main_verified_no_project_checks',
  );
  assert.equal(selected.calls.skip[0].check_skip_decision.draft_id, DRAFT_ID);
  assert.equal(
    selected.calls.skip[0].check_skip_decision.draft_checkpoint_id,
    `builder-draft-checkpoint:${'7'.repeat(64)}`,
  );
  assert.deepEqual(selected.calls.activity, [{
    project_id: selected.receipt.project_id,
    candidate_id: selected.receipt.candidate_id,
  }]);
});

test('returns unavailable environments as completed automatic check facts', async () => {
  const selected = fixture({ checkStatus: 'environment_unavailable' });
  const result = await selected.coordinator.run_automatic_candidate_check(request(selected));

  assert.equal(result.status, 'completed');
  assert.equal(result.profile.command_kind, 'test');
  assert.equal(result.check_run_status_projection.status, 'incomplete');
  assert.equal(result.check_run_status_projection.label, 'Check unavailable');
  assert.equal(
    result.check_run_status_projection.summary,
    'The admitted check workspace needs prepared dependencies or local toolchain access before this check can run.',
  );
  assert.equal(selected.calls.run.length, 1);
});

test('fails closed before command dispatch when checkpoint or source authority drifts', async () => {
  const staleCheckpoint = fixture({
    mutateCheckpoint(result) {
      return {
        ...result,
        checkpoint_ref: {
          ...result.checkpoint_ref,
          candidate_digest: `sha256:${'f'.repeat(64)}`,
        },
      };
    },
  });
  await assert.rejects(
    staleCheckpoint.coordinator.run_automatic_candidate_check(request(staleCheckpoint)),
    BuilderCodingLoopCheckCoordinatorError,
  );
  assert.equal(staleCheckpoint.calls.run.length, 0);

  const staleSource = fixture();
  await assert.rejects(staleSource.coordinator.run_automatic_candidate_check({
    ...request(staleSource),
    source_tree: sourceTree({ test: 'different' }),
  }), BuilderCodingLoopCheckCoordinatorError);
  assert.equal(staleSource.calls.checkpoint.length, 0);
});

test('coordinator has no renderer, provider, filesystem, or process authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-coding-loop-check-coordinator.cjs'),
    'utf8',
  );
  assert.doesNotMatch(source, /ipcMain|ipcRenderer|contextBridge|fetch\(|provider/iu);
  assert.doesNotMatch(source, /child_process|spawn\(|execFile|readFile|writeFile|DatabaseSync/iu);
});
