'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createBuilderLivePreviewCurrentDraftSourceService,
} = require('../electron/builder-live-preview-current-draft-source-service.cjs');
const {
  createBuilderGitCandidateVerificationReceipt,
  sha256Canonical,
} = require('../electron/builder-git-receipt-contract.cjs');
const {
  createBuilderProjectSourceTree,
} = require('../electron/builder-project-source-tree.cjs');

const UUID = '123e4567-e89b-42d3-a456-426614174000';
const PROJECT_ID = `builder-project:${UUID}`;
const CONVERSATION_ID = `builder-conversation:${UUID}`;
const TURN_ID = `builder-turn:${UUID}`;
const TASK_ID = `builder-task:${UUID}`;
const RUN_ID = `builder-run:${UUID}`;
const DRAFT_ID = `builder-generation-draft:${'d'.repeat(64)}`;

function sourceTree(files = [
  { path: 'index.html', content: '<main>Live preview</main><script src="./app.js"></script>\n' },
  { path: 'app.js', content: 'document.body.dataset.ready = "true";\n' },
]) {
  return createBuilderProjectSourceTree({ files });
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

function fixture({ tree = sourceTree(), mutateDraft, mutateCheckpoint } = {}) {
  const receipt = candidate(tree);
  const verification = createBuilderGitCandidateVerificationReceipt(receipt);
  const calls = { conversation: [], stream: [], gitRead: [], gitVerify: [], checkpoint: [] };
  let now = 1_000;
  const service = createBuilderLivePreviewCurrentDraftSourceService({
    conversation_service: {
      service_version: 'builder-conversation-main-service.v1',
      read_stream(request) {
        calls.stream.push(request);
        return {
          project_id: PROJECT_ID,
          conversation: {
            conversation_id: CONVERSATION_ID,
            created_at_ms: 1,
            events: [],
          },
          review_state_projection: {
            draft_id: DRAFT_ID,
          },
        };
      },
      read_candidate_draft(request) {
        calls.conversation.push(request);
        const draft = conversationDraft(receipt);
        return mutateDraft ? mutateDraft(draft) : draft;
      },
    },
    git_authority: {
      read_verified_candidate(selected) {
        calls.gitRead.push(selected);
        return {
          result_version: 'builder-git-verified-candidate-read-result.v1',
          candidate_receipt: receipt,
          verification_receipt: verification,
          source_tree: tree,
          code_authority: 'git_commit_tree',
          read_admission: 'verified',
        };
      },
      verify_candidate_receipt(selected) {
        calls.gitVerify.push(selected);
        return verification;
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
    now_ms() {
      return now++;
    },
  });
  return { calls, receipt, service, tree };
}

test('admits current draft live preview source through conversation, Git, and checkpoint authority', async () => {
  const selected = fixture();
  const result = await selected.service.resolve_current_draft_preview_source({
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
  });

  assert.equal(result.operation, 'current_draft_live_preview_source_admitted');
  assert.equal(result.draft_id, DRAFT_ID);
  assert.equal(result.source_admission.selected_entry_path, 'index.html');
  assert.equal(result.source_admission.source_tree_digest, selected.tree.source_tree_digest);
  assert.equal(result.source_admission.lifecycle.preview_server, 'not_started');
  assert.equal(result.source_admission.authority.renderer_source_tree, 'not_accepted');
  assert.deepEqual(selected.calls.stream, [{ project_id: PROJECT_ID }]);
  assert.deepEqual(selected.calls.conversation, [{ draft_id: DRAFT_ID }]);
  assert.equal(selected.calls.gitVerify.length, 1);
  assert.equal(selected.calls.gitRead.length, 1);
  assert.equal(selected.calls.checkpoint.length, 1);
});

test('selects the first HTML entry when index.html is absent', async () => {
  const selected = fixture({
    tree: sourceTree([
      { path: 'nested/page.htm', content: '<main>Nested</main>\n' },
      { path: 'app.js', content: 'document.body.dataset.ready = "true";\n' },
    ]),
  });

  const result = await selected.service.resolve_current_draft_preview_source({
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
  });

  assert.equal(result.source_admission.selected_entry_path, 'nested/page.htm');
});

test('rejects renderer source hints and drift before admitting preview source', async () => {
  const selected = fixture();
  await assert.rejects(
    selected.service.resolve_current_draft_preview_source({
      project_id: PROJECT_ID,
      conversation_id: CONVERSATION_ID,
      source_tree: selected.tree,
    }),
    { code: 'builder_live_preview_current_draft_source_unavailable' },
  );

  const drifted = fixture({
    mutateCheckpoint(result) {
      return {
        ...result,
        checkpoint_ref: {
          ...result.checkpoint_ref,
          resulting_tree_digest: `sha256:${'f'.repeat(64)}`,
        },
      };
    },
  });
  await assert.rejects(
    drifted.service.resolve_current_draft_preview_source({
      project_id: PROJECT_ID,
      conversation_id: CONVERSATION_ID,
    }),
    { code: 'builder_live_preview_current_draft_source_unavailable' },
  );
});
