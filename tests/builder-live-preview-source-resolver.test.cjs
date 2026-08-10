'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  createBuilderGitCandidateVerificationReceipt,
  sha256Canonical,
} = require('../electron/builder-git-receipt-contract.cjs');
const {
  BUILDER_GIT_VERIFIED_CANDIDATE_READ_RESULT_VERSION,
} = require('../electron/builder-git-project-repository.cjs');
const {
  createBuilderLivePreviewSourceResolver,
} = require('../electron/builder-live-preview-source-resolver.cjs');
const {
  createBuilderProjectSourceTree,
} = require('../electron/builder-project-source-tree.cjs');

const PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174000';
const CONVERSATION_ID = 'builder-conversation:123e4567-e89b-42d3-a456-426614174001';
const TURN_ID = 'builder-turn:123e4567-e89b-42d3-a456-426614174002';
const TASK_ID = 'builder-task:123e4567-e89b-42d3-a456-426614174003';
const RUN_ID = 'builder-run:123e4567-e89b-42d3-a456-426614174004';
const REQUEST_ID = 'builder-git-request:123e4567-e89b-42d3-a456-426614174005';
const REVISION_DIGEST = `sha256:${'9'.repeat(64)}`;
const COMMIT_OID = '1'.repeat(40);
const TREE_OID = '2'.repeat(40);
const PARENT_OID = '3'.repeat(40);
const BUILDER_AUTOMATIC_DRAFT_CHECKPOINT_RESULT_VERSION =
  'builder-automatic-draft-checkpoint-result.v1';
const BUILDER_AUTOMATIC_DRAFT_CHECKPOINT_SERVICE_VERSION =
  'builder-automatic-draft-checkpoint-service.v1';
const BUILDER_PROJECT_READ_RESULT_VERSION = 'builder-project-read-result.v1';

function tree(content = '<main>Hello preview</main>\n') {
  return createBuilderProjectSourceTree({
    files: [
      { path: 'index.html', content },
      { path: 'app.js', content: 'document.body.dataset.ready = "true";\n' },
    ],
  });
}

function candidateReceipt(sourceTree = tree(), overrides = {}) {
  const base = {
    receipt_version: 'builder-git-candidate-receipt.v1',
    repository_version: 'builder-git-project-repository.v1',
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    turn_id: TURN_ID,
    task_id: TASK_ID,
    run_id: RUN_ID,
    request_id: REQUEST_ID,
    candidate_id: `builder-code-change-candidate:${'4'.repeat(64)}`,
    candidate_digest: `sha256:${'5'.repeat(64)}`,
    resulting_tree_digest: sourceTree.source_tree_digest,
    semantic_identity_digest: `sha256:${'6'.repeat(64)}`,
    verification_receipt_digest: `sha256:${'7'.repeat(64)}`,
    object_format: 'sha1',
    commit_oid: COMMIT_OID,
    tree_oid: TREE_OID,
    parent_oid: PARENT_OID,
    expected_base_oid: PARENT_OID,
    code_authority: 'git_commit_candidate',
    product_revision_admission: 'not_recorded',
    replay: false,
    ...overrides,
  };
  const verification = createBuilderGitCandidateVerificationReceipt(base);
  return {
    ...base,
    verification_receipt_digest: sha256Canonical(verification),
  };
}

function candidatePair(sourceTree = tree(), overrides = {}) {
  const receipt = candidateReceipt(sourceTree, overrides);
  return {
    receipt,
    verification: createBuilderGitCandidateVerificationReceipt(receipt),
  };
}

function checkpointVerification(receipt, overrides = {}) {
  return {
    result_version: BUILDER_AUTOMATIC_DRAFT_CHECKPOINT_RESULT_VERSION,
    service_version: BUILDER_AUTOMATIC_DRAFT_CHECKPOINT_SERVICE_VERSION,
    operation: 'current_candidate_checkpoint_verified',
    status: 'verified',
    checkpoint_ref: {
      checkpoint_id: `builder-draft-checkpoint:${'8'.repeat(64)}`,
      checkpoint_sequence: 2,
      candidate_id: receipt.candidate_id,
      candidate_digest: receipt.candidate_digest,
      resulting_tree_digest: receipt.resulting_tree_digest,
      ...(overrides.checkpoint_ref ?? {}),
    },
    verification_admission: 'main_owned_latest_checkpoint_verified',
    ...Object.fromEntries(
      Object.entries(overrides).filter(([key]) => key !== 'checkpoint_ref'),
    ),
  };
}

function gitRead(receipt, verification, sourceTree) {
  return {
    result_version: BUILDER_GIT_VERIFIED_CANDIDATE_READ_RESULT_VERSION,
    candidate_receipt: receipt,
    verification_receipt: verification,
    source_tree: sourceTree,
    code_authority: 'git_commit_tree',
    read_admission: 'verified',
  };
}

function productReceipt(sourceTree, receipt, overrides = {}) {
  return {
    project_id: receipt.project_id,
    revision_receipt_digest: REVISION_DIGEST,
    revision_number: 3,
    previous_revision_receipt_digest: null,
    title: 'Saved preview',
    summary: 'A saved project preview.',
    conversation_id: receipt.conversation_id,
    turn_id: receipt.turn_id,
    request_id: receipt.request_id,
    object_format: 'sha1',
    commit_oid: receipt.commit_oid,
    tree_oid: receipt.tree_oid,
    parent_oid: receipt.parent_oid,
    candidate_id: receipt.candidate_id,
    candidate_digest: receipt.candidate_digest,
    resulting_tree_digest: sourceTree.source_tree_digest,
    semantic_identity_digest: receipt.semantic_identity_digest,
    verification_receipt_digest: receipt.verification_receipt_digest,
    task_id: receipt.task_id,
    run_id: receipt.run_id,
    review_id: 'builder-review:123e4567-e89b-42d3-a456-426614174006',
    selected_at_ms: 30,
    ...overrides,
  };
}

function currentSummary(receipt) {
  return {
    project_id: receipt.project_id,
    title: 'Saved preview',
    summary: 'A saved project preview.',
    revision_receipt_digest: REVISION_DIGEST,
    revision_number: 3,
    object_format: 'sha1',
    commit_oid: receipt.commit_oid,
    tree_oid: receipt.tree_oid,
    parent_oid: receipt.parent_oid,
  };
}

function projectReadResult(sourceTree, receipt, verification, overrides = {}) {
  const product = productReceipt(sourceTree, receipt, overrides.product_revision_receipt ?? {});
  return {
    result_version: BUILDER_PROJECT_READ_RESULT_VERSION,
    product_revision_receipt: product,
    current: currentSummary(receipt),
    source_tree: sourceTree,
    git_candidate_receipt: receipt,
    git_verification_receipt: verification,
    authority_evidence: {
      product_authority: 'sqlite_product_revision_receipt',
      code_authority: 'git_commit_tree',
      source_read_admission: 'verified',
      current_selection: 'sqlite_current_project_revision',
    },
    operation: 'revision_loaded',
    ...Object.fromEntries(
      Object.entries(overrides).filter(([key]) => key !== 'product_revision_receipt'),
    ),
  };
}

function resolverFixture() {
  const sourceTree = tree();
  const pair = candidatePair(sourceTree);
  const calls = { checkpoint: [], git: [], revision: [] };
  const resolver = createBuilderLivePreviewSourceResolver({
    automatic_draft_checkpoint_service: {
      service_version: BUILDER_AUTOMATIC_DRAFT_CHECKPOINT_SERVICE_VERSION,
      verify_current_candidate_checkpoint(request) {
        calls.checkpoint.push(request);
        return checkpointVerification(pair.receipt);
      },
    },
    git_authority: {
      read_verified_candidate(receipt) {
        calls.git.push(receipt);
        return gitRead(pair.receipt, pair.verification, sourceTree);
      },
    },
    project_read_authority: {
      load_revision(request) {
        calls.revision.push(request);
        return projectReadResult(sourceTree, pair.receipt, pair.verification);
      },
    },
  });
  return { calls, pair, resolver, sourceTree };
}

test('resolves current draft source only through checkpoint and verified Git authorities', async () => {
  const fixture = resolverFixture();
  const result = await fixture.resolver.resolveCurrentDraftPreviewSource({
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    candidate_receipt: fixture.pair.receipt,
    candidate_verification: fixture.pair.verification,
  });

  assert.equal(result.status, 'ready');
  assert.equal(result.operation, 'current_draft_preview_source_resolved');
  assert.equal(result.preview_source_snapshot.source_kind, 'current_draft');
  assert.equal(result.preview_source_snapshot.source_tree.source_tree_digest, fixture.sourceTree.source_tree_digest);
  assert.equal(result.preview_source_snapshot.source_ref.checkpoint_sequence, 2);
  assert.equal(result.preview_source_snapshot.authority.renderer_source_tree, 'not_accepted');
  assert.equal(result.preview_source_snapshot.authority.command_execution, false);
  assert.deepEqual(fixture.calls.checkpoint, [{
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    task_id: TASK_ID,
    run_id: RUN_ID,
    candidate_id: fixture.pair.receipt.candidate_id,
    candidate_digest: fixture.pair.receipt.candidate_digest,
    resulting_tree_digest: fixture.pair.receipt.resulting_tree_digest,
  }]);
  assert.deepEqual(fixture.calls.git, [fixture.pair.receipt]);
  assert.equal(Object.isFrozen(result.preview_source_snapshot.source_tree.files), true);
});

test('rejects renderer-supplied source or path material in current draft requests', async () => {
  const fixture = resolverFixture();
  await assert.rejects(
    fixture.resolver.resolveCurrentDraftPreviewSource({
      project_id: PROJECT_ID,
      conversation_id: CONVERSATION_ID,
      candidate_receipt: fixture.pair.receipt,
      candidate_verification: fixture.pair.verification,
      source_tree: fixture.sourceTree,
    }),
    { code: 'builder_live_preview_source_resolver_invalid' },
  );
  await assert.rejects(
    fixture.resolver.resolveSavedRevisionPreviewSource({
      project_id: PROJECT_ID,
      conversation_id: CONVERSATION_ID,
      revision_receipt_digest: REVISION_DIGEST,
      path: 'index.html',
    }),
    { code: 'builder_live_preview_source_resolver_invalid' },
  );
});

test('returns unavailable when current draft authorities cannot provide the source', async () => {
  const fixture = resolverFixture();
  const resolver = createBuilderLivePreviewSourceResolver({
    automatic_draft_checkpoint_service: {
      service_version: BUILDER_AUTOMATIC_DRAFT_CHECKPOINT_SERVICE_VERSION,
      verify_current_candidate_checkpoint() {
        throw new Error('checkpoint missing');
      },
    },
    git_authority: fixture.resolver,
    project_read_authority: null,
  });
  const result = await resolver.resolveCurrentDraftPreviewSource({
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    candidate_receipt: fixture.pair.receipt,
    candidate_verification: fixture.pair.verification,
  });

  assert.equal(result.status, 'unavailable');
  assert.equal(result.preview_source_snapshot, null);
  assert.equal(result.unavailable_reason, 'preview_source_authority_unavailable');
});

test('rejects checkpoint or Git digest drift before creating a preview snapshot', async () => {
  const sourceTree = tree();
  const pair = candidatePair(sourceTree);
  const resolver = createBuilderLivePreviewSourceResolver({
    automatic_draft_checkpoint_service: {
      service_version: BUILDER_AUTOMATIC_DRAFT_CHECKPOINT_SERVICE_VERSION,
      verify_current_candidate_checkpoint() {
        return checkpointVerification(pair.receipt, {
          checkpoint_ref: { resulting_tree_digest: `sha256:${'a'.repeat(64)}` },
        });
      },
    },
    git_authority: {
      read_verified_candidate(receipt) {
        return gitRead(receipt, pair.verification, sourceTree);
      },
    },
    project_read_authority: null,
  });

  await assert.rejects(
    resolver.resolveCurrentDraftPreviewSource({
      project_id: PROJECT_ID,
      conversation_id: CONVERSATION_ID,
      candidate_receipt: pair.receipt,
      candidate_verification: pair.verification,
    }),
    { code: 'builder_live_preview_source_resolver_invalid' },
  );
});

test('resolves saved revision source through project read authority without renderer source hints', async () => {
  const fixture = resolverFixture();
  const result = await fixture.resolver.resolveSavedRevisionPreviewSource({
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    revision_receipt_digest: REVISION_DIGEST,
  });

  assert.equal(result.status, 'ready');
  assert.equal(result.operation, 'saved_revision_preview_source_resolved');
  assert.equal(result.preview_source_snapshot.source_kind, 'saved_revision');
  assert.equal(result.preview_source_snapshot.source_tree_digest, fixture.sourceTree.source_tree_digest);
  assert.equal(result.preview_source_snapshot.source_ref.revision_receipt_digest, REVISION_DIGEST);
  assert.equal(result.preview_source_snapshot.source_ref.revision_number, 3);
  assert.deepEqual(fixture.calls.revision, [{
    project_id: PROJECT_ID,
    revision_receipt_digest: REVISION_DIGEST,
  }]);
});

test('rejects saved revision project, conversation, or digest drift', async () => {
  const sourceTree = tree();
  const pair = candidatePair(sourceTree);
  const resolver = createBuilderLivePreviewSourceResolver({
    automatic_draft_checkpoint_service: null,
    git_authority: null,
    project_read_authority: {
      load_revision() {
        return projectReadResult(sourceTree, pair.receipt, pair.verification, {
          product_revision_receipt: {
            conversation_id: 'builder-conversation:123e4567-e89b-42d3-a456-426614174099',
          },
        });
      },
    },
  });

  await assert.rejects(
    resolver.resolveSavedRevisionPreviewSource({
      project_id: PROJECT_ID,
      conversation_id: CONVERSATION_ID,
      revision_receipt_digest: REVISION_DIGEST,
    }),
    { code: 'builder_live_preview_source_resolver_invalid' },
  );
});

test('returns unavailable when saved revision authority cannot load the source', async () => {
  const fixture = resolverFixture();
  const resolver = createBuilderLivePreviewSourceResolver({
    automatic_draft_checkpoint_service: null,
    git_authority: null,
    project_read_authority: {
      load_revision() {
        throw new Error('not found');
      },
    },
  });
  const result = await resolver.resolveSavedRevisionPreviewSource({
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    revision_receipt_digest: REVISION_DIGEST,
  });

  assert.equal(result.status, 'unavailable');
  assert.equal(result.source_kind, 'saved_revision');
  assert.equal(result.preview_source_snapshot, null);
  assert.equal(fixture.calls.revision.length, 0);
});

test('source resolver stays preview-only and does not register runtime authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-live-preview-source-resolver.cjs'),
    'utf8',
  );

  assert.doesNotMatch(
    source,
    /ipcMain|ipcRenderer|BrowserWindow|WebContentsView|BrowserView|contextBridge|preload|createServer|listen\(|child_process|execFile|spawn\(|writeFile|tool_dispatch\s*:\s*true|provider_dispatch\s*:\s*true|saveDraft|record_project_revision|record_project_revision_receipt/iu,
  );
  assert.match(source, /renderer_source_tree: 'not_accepted'/u);
  assert.match(source, /renderer_path_or_url: 'not_accepted'/u);
  assert.match(source, /source_write: 'not_performed'/u);
  assert.match(
    source,
    /const CURRENT_DRAFT_KEYS = Object\.freeze\(\[\s*'project_id',\s*'conversation_id',\s*'candidate_receipt',\s*'candidate_verification',\s*\]\);/u,
  );
  assert.match(
    source,
    /const SAVED_REVISION_KEYS = Object\.freeze\(\[\s*'project_id',\s*'conversation_id',\s*'revision_receipt_digest',\s*\]\);/u,
  );
});
