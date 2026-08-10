'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  createBuilderCheckRunCurrentDraftService,
} = require('../electron/builder-check-run-current-draft-service.cjs');
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

function sourceTree(script = 'node --test') {
  return createBuilderProjectSourceTree({
    files: [{
      path: 'package.json',
      content: `${JSON.stringify({ scripts: { test: script, build: 'vite build' } })}\n`,
    }],
  });
}

function candidate(source = sourceTree()) {
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
    resulting_tree_digest: source.source_tree_digest,
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

function conversationDraft(receipt, overrides = {}) {
  return {
    result_version: 'builder-conversation-candidate-draft-read-result.v1',
    draft_id: DRAFT_ID,
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    turn_id: TURN_ID,
    task_id: TASK_ID,
    run_id: RUN_ID,
    candidate_digest: receipt.candidate_digest,
    base_revision: null,
    conversation_head: {
      sequence: 4,
      event_id: `builder-conversation-event:${'8'.repeat(64)}`,
      event_digest: `sha256:${'9'.repeat(64)}`,
    },
    candidate_result: {
      draft_id: DRAFT_ID,
      title: 'Candidate',
      summary: 'Candidate summary.',
      git_candidate_receipt: receipt,
    },
    verification_admission: 'sqlite_replay_verified',
    ...overrides,
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
      checkpoint_sequence: 2,
      candidate_id: receipt.candidate_id,
      candidate_digest: receipt.candidate_digest,
      resulting_tree_digest: receipt.resulting_tree_digest,
    },
    verification_admission: 'main_owned_latest_checkpoint_verified',
  };
}

function fixture({ tree = sourceTree(), mutateGitRead, mutateCheckpoint, mainResult } = {}) {
  const receipt = candidate(tree);
  const verification = createBuilderGitCandidateVerificationReceipt(receipt);
  const calls = { conversation: [], git: [], checkpoint: [], run: [] };
  let now = 100;
  const service = createBuilderCheckRunCurrentDraftService({
    conversation_service: {
      service_version: 'builder-conversation-main-service.v1',
      read_candidate_draft(request) {
        calls.conversation.push(request);
        return conversationDraft(receipt);
      },
    },
    git_authority: {
      read_verified_candidate(selected) {
        calls.git.push(selected);
        const result = {
          result_version: 'builder-git-verified-candidate-read-result.v1',
          candidate_receipt: receipt,
          verification_receipt: verification,
          source_tree: tree,
          code_authority: 'git_commit_tree',
          read_admission: 'verified',
        };
        return mutateGitRead ? mutateGitRead(result) : result;
      },
    },
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
        if (mainResult) return mainResult(request);
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
          status: 'passed',
          exit_code: 0,
          output_digest: `sha256:${'e'.repeat(64)}`,
          failure_class: 'none',
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
    clock: {
      clock_version: 'builder-clock.v1',
      now_ms() { return now++; },
    },
  });
  return { calls, receipt, service, tree, verification };
}

test('lists only renderer-safe checks discovered from the fresh verified candidate tree', async () => {
  const selected = fixture();
  const result = await selected.service.read_available_checks({ draft_id: DRAFT_ID });

  assert.equal(result.status, 'ready');
  assert.equal(result.project_id, PROJECT_ID);
  assert.equal(result.candidate_id, selected.receipt.candidate_id);
  assert.deepEqual(result.available_checks.map((profile) => profile.command_kind), ['test', 'build']);
  assert.deepEqual(Object.keys(result.available_checks[0]), [
    'command_profile_id',
    'command_kind',
    'command_display',
    'requires_user_approval',
  ]);
  assert.equal(result.available_checks[0].requires_user_approval, true);
  assert.equal(JSON.stringify(result).includes('node --test'), false);
  assert.equal(JSON.stringify(result).includes('source_tree'), false);
  assert.deepEqual(selected.calls.conversation, [{ draft_id: DRAFT_ID }]);
  assert.equal(selected.calls.git.length, 1);
  assert.equal(selected.calls.checkpoint.length, 1);
  assert.equal(selected.calls.run.length, 0);
  assert.equal(Object.isFrozen(result.available_checks), true);
});

test('runs the explicitly selected profile after re-reading all current draft authorities', async () => {
  const selected = fixture();
  const available = await selected.service.read_available_checks({ draft_id: DRAFT_ID });
  const profile = available.available_checks[0];
  const result = await selected.service.run_approved_check({
    draft_id: DRAFT_ID,
    command_profile_id: profile.command_profile_id,
  });

  assert.equal(result.operation, 'current_draft_approved_check_completed');
  assert.equal(result.check_run_status_projection.status, 'passed');
  assert.equal(result.check_run_status_projection.command_kind, profile.command_kind);
  assert.equal(selected.calls.conversation.length, 2);
  assert.equal(selected.calls.git.length, 2);
  assert.equal(selected.calls.checkpoint.length, 2);
  assert.equal(selected.calls.run.length, 1);
  assert.equal(selected.calls.run[0].draft_id, DRAFT_ID);
  assert.equal(
    selected.calls.run[0].source_tree.source_tree_digest,
    selected.receipt.resulting_tree_digest,
  );
  assert.equal(
    selected.calls.run[0].project_understanding_snapshot.source_tree_digest,
    selected.receipt.resulting_tree_digest,
  );
});

test('reports no checks without dispatch when the candidate has no approved manifest scripts', async () => {
  const selected = fixture({
    tree: createBuilderProjectSourceTree({ files: [{ path: 'index.html', content: '<main />\n' }] }),
  });
  const result = await selected.service.read_available_checks({ draft_id: DRAFT_ID });

  assert.equal(result.status, 'no_checks');
  assert.deepEqual(result.available_checks, []);
  assert.equal(selected.calls.run.length, 0);
});

test('rejects renderer source, command text, stale profile ids, and hostile request shapes', async () => {
  const selected = fixture();
  await assert.rejects(selected.service.read_available_checks({
    draft_id: DRAFT_ID,
    source_tree: selected.tree,
  }), { code: 'builder_check_run_current_draft_failed' });
  await assert.rejects(selected.service.run_approved_check({
    draft_id: DRAFT_ID,
    command_profile_id: `builder-command-profile:${'0'.repeat(32)}`,
    command: 'npm test',
  }), { code: 'builder_check_run_current_draft_failed' });
  await assert.rejects(selected.service.run_approved_check({
    draft_id: DRAFT_ID,
    command_profile_id: `builder-command-profile:${'0'.repeat(32)}`,
  }), { code: 'builder_check_run_current_draft_failed' });
  await assert.rejects(selected.service.read_available_checks(new Proxy({}, {})), {
    code: 'builder_check_run_current_draft_failed',
  });
  assert.equal(selected.calls.run.length, 0);
});

test('fails closed before dispatch when conversation, Git, or checkpoint authority drifts', async () => {
  const badGit = fixture({
    mutateGitRead(result) {
      return { ...result, read_admission: 'unverified' };
    },
  });
  await assert.rejects(badGit.service.read_available_checks({ draft_id: DRAFT_ID }), {
    code: 'builder_check_run_current_draft_failed',
  });
  assert.equal(badGit.calls.run.length, 0);

  const badCheckpoint = fixture({
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
  await assert.rejects(badCheckpoint.service.read_available_checks({ draft_id: DRAFT_ID }), {
    code: 'builder_check_run_current_draft_failed',
  });
  assert.equal(badCheckpoint.calls.run.length, 0);
});

test('rejects mismatched main results instead of projecting another candidate check', async () => {
  const selected = fixture({
    mainResult(request) {
      return {
        result_version: BUILDER_CHECK_RUN_MAIN_RESULT_VERSION,
        operation: 'approved_check_completed',
        check_run_status_projection: {
          projection_version: 'builder-check-run-status-projection.v1',
          project_id: request.git_candidate_receipt.project_id,
          candidate_id: `builder-code-change-candidate:${'b'.repeat(64)}`,
        },
      };
    },
  });
  const available = await selected.service.read_available_checks({ draft_id: DRAFT_ID });
  await assert.rejects(selected.service.run_approved_check({
    draft_id: DRAFT_ID,
    command_profile_id: available.available_checks[0].command_profile_id,
  }), { code: 'builder_check_run_current_draft_failed' });
});

test('source boundary stays main-only and excludes IPC, provider, save, and project mutation authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-check-run-current-draft-service.cjs'),
    'utf8',
  );
  assert.doesNotMatch(source, /ipcMain|contextBridge|preload|fetch\(|provider|save_draft|writeFile|git write/iu);
  assert.match(source, /read_candidate_draft/u);
  assert.match(source, /read_verified_candidate/u);
  assert.match(source, /verify_current_candidate_checkpoint/u);
});
