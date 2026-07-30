'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  CONVERSATION_AUTHORITY,
  CONVERSATION_EVENT_KIND,
  CONVERSATION_EVENT_VERSION,
  createBuilderConversationEvent,
} = require('../electron/builder-conversation-records.cjs');
const {
  createBuilderCodeChangeCandidate,
} = require('../electron/builder-code-change-kernel.cjs');
const {
  BUILDER_GIT_CANDIDATE_RECEIPT_VERSION,
  BUILDER_GIT_CANDIDATE_VERIFICATION_VERSION,
  BUILDER_GIT_PROJECT_REPOSITORY_VERSION,
  createBuilderGitCandidateVerificationReceipt,
  sha256Canonical,
} = require('../electron/builder-git-receipt-contract.cjs');
const {
  BUILDER_GIT_VERIFIED_CANDIDATE_READ_RESULT_VERSION,
  createDefaultBuilderGitProjectRepository,
} = require('../electron/builder-git-project-repository.cjs');
const {
  createBuilderProductMetadataDatabase,
} = require('../electron/builder-product-metadata-database.cjs');
const {
  BUILDER_PRODUCT_METADATA_RESULT_VERSION,
  BUILDER_PRODUCT_METADATA_SCHEMA_VERSION,
  BUILDER_PRODUCT_METADATA_USER_VERSION,
  createRevisionReceipt,
} = require('../electron/builder-product-metadata-schema.cjs');
const {
  createBuilderProjectSourceTree,
} = require('../electron/builder-project-source-tree.cjs');
const {
  BUILDER_PROJECT_READ_AUTHORITY_VERSION,
  BUILDER_PROJECT_READ_RESULT_VERSION,
  BuilderProjectReadAuthorityError,
  createBuilderProjectReadAuthority,
} = require('../electron/builder-project-read-authority.cjs');

const UUID = '123e4567-e89b-42d3-a456-426614174000';
const PROJECT_ID = `builder-project:${UUID}`;
const OTHER_PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174001';
const CONVERSATION_ID = `builder-conversation:${UUID}`;
const TURN_ID = `builder-turn:${UUID}`;
const TASK_ID = `builder-task:${UUID}`;
const RUN_ID = `builder-run:${UUID}`;
const REQUEST_ID = `builder-git-request:${UUID}`;
const CANDIDATE_ID = `builder-code-change-candidate:${'1'.repeat(64)}`;
const REVIEW_ID = `builder-review:${UUID}`;
const COMMIT_OID = 'a'.repeat(40);
const TREE_OID = 'b'.repeat(40);
const DIGEST = `sha256:${'c'.repeat(64)}`;
const SEMANTIC_DIGEST = `sha256:${'d'.repeat(64)}`;

function sourceTree(content = '<main>Hello</main>\n') {
  return createBuilderProjectSourceTree({
    files: [
      { path: 'index.html', content },
      { path: 'styles.css', content: 'main { color: green; }\n' },
      { path: 'app.js', content: 'document.title = "Hello";\n' },
    ],
  });
}

function candidateReceipt(tree = sourceTree(), overrides = {}) {
  const parentOid = overrides.parent_oid ?? null;
  const withoutVerification = {
    receipt_version: BUILDER_GIT_CANDIDATE_RECEIPT_VERSION,
    repository_version: BUILDER_GIT_PROJECT_REPOSITORY_VERSION,
    project_id: overrides.project_id ?? PROJECT_ID,
    conversation_id: overrides.conversation_id ?? CONVERSATION_ID,
    turn_id: overrides.turn_id ?? TURN_ID,
    task_id: overrides.task_id ?? TASK_ID,
    run_id: overrides.run_id ?? RUN_ID,
    request_id: overrides.request_id ?? REQUEST_ID,
    candidate_id: overrides.candidate_id ?? CANDIDATE_ID,
    candidate_digest: overrides.candidate_digest ?? DIGEST,
    resulting_tree_digest: tree.source_tree_digest,
    semantic_identity_digest: overrides.semantic_identity_digest ?? SEMANTIC_DIGEST,
    verification_receipt_digest: null,
    object_format: 'sha1',
    commit_oid: overrides.commit_oid ?? COMMIT_OID,
    tree_oid: overrides.tree_oid ?? TREE_OID,
    parent_oid: parentOid,
    expected_base_oid: overrides.expected_base_oid ?? parentOid,
    code_authority: 'git_commit_candidate',
    product_revision_admission: 'not_recorded',
    replay: false,
  };
  const verification = createBuilderGitCandidateVerificationReceipt({
    ...withoutVerification,
    verification_receipt_digest: `sha256:${'0'.repeat(64)}`,
  });
  return {
    ...withoutVerification,
    verification_receipt_digest: sha256Canonical(verification),
  };
}

function productReceipt(tree = sourceTree(), overrides = {}) {
  const candidate = candidateReceipt(tree, overrides);
  return createRevisionReceipt({
    project_id: candidate.project_id,
    revision_number: overrides.revision_number ?? 1,
    previous_revision_receipt_digest: overrides.previous_revision_receipt_digest ?? null,
    title: overrides.title ?? 'Hello tool',
    summary: overrides.summary ?? 'A verified saved Builder project.',
    conversation_id: candidate.conversation_id,
    turn_id: candidate.turn_id,
    request_id: candidate.request_id,
    object_format: 'sha1',
    commit_oid: candidate.commit_oid,
    tree_oid: candidate.tree_oid,
    parent_oid: candidate.parent_oid,
    candidate_id: candidate.candidate_id,
    candidate_digest: candidate.candidate_digest,
    resulting_tree_digest: tree.source_tree_digest,
    semantic_identity_digest: candidate.semantic_identity_digest,
    verification_receipt_digest: candidate.verification_receipt_digest,
    task_id: candidate.task_id,
    run_id: candidate.run_id,
    review_id: overrides.review_id ?? REVIEW_ID,
    selected_at_ms: overrides.selected_at_ms ?? 10,
  });
}

function currentSummary(receipt) {
  return {
    project_id: receipt.project_id,
    title: receipt.title,
    summary: receipt.summary,
    revision_receipt_digest: receipt.revision_receipt_digest,
    revision_number: receipt.revision_number,
    object_format: receipt.object_format,
    commit_oid: receipt.commit_oid,
    tree_oid: receipt.tree_oid,
    parent_oid: receipt.parent_oid,
  };
}

function metadataEvidence(transaction = 'current_readback') {
  return {
    database_id: 'builder-product-metadata-database.v3',
    schema_fingerprint_digest: `sha256:${'e'.repeat(64)}`,
    schema_version: BUILDER_PRODUCT_METADATA_SCHEMA_VERSION,
    user_version: BUILDER_PRODUCT_METADATA_USER_VERSION,
    runtime_pragmas: {
      foreign_keys: 'on',
      journal_mode: 'wal',
      synchronous: 'full',
      trusted_schema: 'off',
    },
    transaction,
    git_object_verification: 'not_performed_by_metadata_database',
    source_bytes_stored: false,
    credential_storage: 'not_present',
    ui_state_storage: 'not_present',
  };
}

function metadataResult(receipt, operation = 'current_loaded', current = currentSummary(receipt)) {
  return {
    result_version: BUILDER_PRODUCT_METADATA_RESULT_VERSION,
    operation,
    receipt,
    current,
    metadata_evidence: metadataEvidence(),
  };
}

function gitResult(receipt, tree = sourceTree()) {
  const verification = createBuilderGitCandidateVerificationReceipt(receipt);
  return {
    result_version: BUILDER_GIT_VERIFIED_CANDIDATE_READ_RESULT_VERSION,
    candidate_receipt: receipt,
    verification_receipt: verification,
    source_tree: tree,
    code_authority: 'git_commit_tree',
    read_admission: 'verified',
  };
}

function dependencies(overrides = {}) {
  const tree = sourceTree();
  const receipt = productReceipt(tree);
  const calls = {
    current: [],
    revision: [],
    list: [],
    history: [],
    git: [],
  };
  const metadata = {
    load_current_project_revision(request) {
      calls.current.push(request);
      return metadataResult(receipt);
    },
    load_project_revision(request) {
      calls.revision.push(request);
      return metadataResult(receipt, 'revision_loaded');
    },
    list_current_project_revisions(request) {
      calls.list.push(request);
      return {
        result_version: BUILDER_PRODUCT_METADATA_RESULT_VERSION,
        operation: 'current_listed',
        projects: [{
          project_id: receipt.project_id,
          title: receipt.title,
          summary: receipt.summary,
          revision_number: receipt.revision_number,
          revision_receipt_digest: receipt.revision_receipt_digest,
          commit_oid: receipt.commit_oid,
          tree_oid: receipt.tree_oid,
          selected_at_ms: receipt.selected_at_ms,
        }],
        metadata_evidence: metadataEvidence('current_list_full_chain_readback'),
      };
    },
    list_project_revisions(request) {
      calls.history.push(request);
      const receipts = overrides.historyReceipts ?? [receipt];
      return {
        result_version: BUILDER_PRODUCT_METADATA_RESULT_VERSION,
        operation: 'project_revisions_listed',
        receipts,
        current: overrides.historyCurrent ?? currentSummary(receipts[0]),
        metadata_evidence: metadataEvidence('project_revision_history_readback'),
      };
    },
    ...(overrides.metadata ?? {}),
  };
  const git = {
    read_verified_candidate(request) {
      calls.git.push(request);
      return gitResult(request, tree);
    },
    ...(overrides.git ?? {}),
  };
  return {
    authority: createBuilderProjectReadAuthority({
      metadata_database: metadata,
      git_repository: git,
    }),
    calls,
    receipt,
    tree,
  };
}

function assertReadError(code, marker = 'credential-marker') {
  return (error) => {
    assert.ok(error instanceof BuilderProjectReadAuthorityError);
    assert.equal(error.code, code);
    assert.doesNotMatch(
      JSON.stringify({
        name: error.name,
        code: error.code,
        message: error.message,
        stack: error.stack,
      }),
      new RegExp(`${marker}|${UUID}|${COMMIT_OID}`, 'iu'),
    );
    return true;
  };
}

function routeDecision(payload) {
  const route = payload.mode === 'work' ? 'build' : 'answer';
  return {
    decision_id: `builder-route-decision:${payload.message.message_id.slice('builder-message:'.length)}`,
    decision_version: 'builder-composer-route-decision.v1',
    project_id: PROJECT_ID,
    message_id: payload.message.message_id,
    task_id: payload.task === null ? null : payload.task.task_id,
    route,
    confidence: 'high',
    matched_signals: [payload.mode === 'work' ? 'test_work_turn' : 'test_question_turn'],
    downgraded_from: null,
    downgrade_reason: null,
    required_permissions: route === 'build' ? ['write_project'] : [],
    permission_result: route === 'build' ? 'allowed' : 'not_required',
    dispatch: route === 'build' ? 'build' : 'reply',
    decided_at_ms: 1,
  };
}

function appendConversationEvent(events, eventType, payload, commandIndex) {
  const previous = events.at(-1) ?? null;
  const normalizedPayload = eventType === 'turn_submitted'
    ? {
      ...payload,
      route_decision: Object.hasOwn(payload, 'route_decision')
        ? payload.route_decision
        : routeDecision(payload),
    }
    : payload;
  return [...events, createBuilderConversationEvent({
    record_version: CONVERSATION_EVENT_VERSION,
    record_kind: CONVERSATION_EVENT_KIND,
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    sequence: events.length + 1,
    command_id: `builder-command:00000000-0000-4000-8000-${String(commandIndex).padStart(12, '0')}`,
    event_type: eventType,
    previous_event: previous === null ? null : {
      sequence: previous.sequence,
      event_id: previous.event_id,
      event_digest: previous.event_digest,
    },
    payload: normalizedPayload,
    authority: { ...CONVERSATION_AUTHORITY },
  })];
}

function realCandidate() {
  let events = [];
  events = appendConversationEvent(events, 'turn_submitted', {
    message: {
      message_id: 'builder-message:00000000-0000-4000-8000-000000000001',
      text: 'Create a small greeting tool.',
    },
    turn_id: TURN_ID,
    mode: 'work',
    task: { task_id: TASK_ID, title: 'Create greeting tool' },
    base_revision: null,
  }, 1);
  events = appendConversationEvent(events, 'run_started', {
    turn_id: TURN_ID,
    run_id: RUN_ID,
    task_id: TASK_ID,
    attempt_number: 1,
    retry_of_run_id: null,
    input_digest: `sha256:${'0'.repeat(64)}`,
  }, 2);
  return createBuilderCodeChangeCandidate({
    conversation_events: events,
    turn_id: TURN_ID,
    run_id: RUN_ID,
    base_revision_evidence: null,
    base_source_tree: createBuilderProjectSourceTree({ files: [] }),
    operations: [
      { operation: 'upsert', path: 'index.html', content: '<main>Hello</main>\n' },
      { operation: 'upsert', path: 'styles.css', content: 'main { color: green; }\n' },
      { operation: 'upsert', path: 'app.js', content: 'document.title = "Hello";\n' },
    ],
  });
}

test('restarts through a real Git replay, SQLite v3 selection, and verified source read', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawfabric-builder-project-read-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const projectsRoot = path.join(root, 'projects');
  const runtimeRoot = path.join(root, 'runtime');
  const databasePath = path.join(root, 'metadata', 'builder.sqlite');
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const gitOptions = {
    projects_root: projectsRoot,
    runtime_root: runtimeRoot,
    now_seconds: () => 1_750_000_000,
  };
  const git = createDefaultBuilderGitProjectRepository(gitOptions);
  const candidate = realCandidate();
  const persistRequest = {
    request_id: REQUEST_ID,
    expected_base_oid: null,
    candidate,
  };
  const originalReceipt = await git.persist_candidate_commit(persistRequest);
  const replayReceipt = await createDefaultBuilderGitProjectRepository(gitOptions)
    .persist_candidate_commit(structuredClone(persistRequest));
  assert.equal(originalReceipt.replay, false);
  assert.equal(replayReceipt.replay, true);
  const verification = await git.verify_candidate_receipt(replayReceipt);

  const metadata = createBuilderProductMetadataDatabase(databasePath);
  const recorded = metadata.record_project_revision_receipt({
    idempotency: { idempotency_key: `builder-idempotency:${'1'.repeat(64)}` },
    project: { project_id: PROJECT_ID, created_at_ms: 1 },
    conversation: {
      conversation_id: CONVERSATION_ID,
      project_id: PROJECT_ID,
      created_at_ms: 1,
    },
    task: {
      task_id: TASK_ID,
      project_id: PROJECT_ID,
      conversation_id: CONVERSATION_ID,
      title: 'Create greeting tool',
      base_commit_oid: null,
      created_at_ms: 2,
    },
    run: {
      run_id: RUN_ID,
      project_id: PROJECT_ID,
      task_id: TASK_ID,
      turn_id: TURN_ID,
      request_id: REQUEST_ID,
      candidate_id: candidate.candidate_id,
      status: 'succeeded',
      result_kind: 'candidate',
      result_digest: candidate.candidate_digest,
      completed_at_ms: 3,
    },
    review: {
      review_id: REVIEW_ID,
      project_id: PROJECT_ID,
      task_id: TASK_ID,
      run_id: RUN_ID,
      subject_kind: 'git_candidate',
      subject_candidate_id: candidate.candidate_id,
      subject_candidate_digest: candidate.candidate_digest,
      subject_verification_receipt_digest: replayReceipt.verification_receipt_digest,
      decision: 'accepted',
      reviewer_id: `builder-user:${UUID}`,
      reviewed_at_ms: 4,
    },
    git_candidate_verification_receipt: verification,
    git_candidate_receipt: replayReceipt,
    project_revision: {
      project_id: PROJECT_ID,
      title: 'Greeting tool',
      summary: 'A saved greeting project.',
      conversation_id: CONVERSATION_ID,
      turn_id: TURN_ID,
      request_id: REQUEST_ID,
      object_format: replayReceipt.object_format,
      commit_oid: replayReceipt.commit_oid,
      tree_oid: replayReceipt.tree_oid,
      parent_oid: replayReceipt.parent_oid,
      candidate_id: replayReceipt.candidate_id,
      candidate_digest: replayReceipt.candidate_digest,
      resulting_tree_digest: replayReceipt.resulting_tree_digest,
      semantic_identity_digest: replayReceipt.semantic_identity_digest,
      verification_receipt_digest: replayReceipt.verification_receipt_digest,
      selected_at_ms: 5,
    },
    expected_current_revision_receipt_digest: null,
  });
  metadata.close();

  const restartedMetadata = createBuilderProductMetadataDatabase(databasePath);
  const authority = createBuilderProjectReadAuthority({
    metadata_database: restartedMetadata,
    git_repository: createDefaultBuilderGitProjectRepository(gitOptions),
  });
  const restored = await authority.load_current({ project_id: PROJECT_ID });
  assert.equal(restored.product_revision_receipt.revision_receipt_digest,
    recorded.receipt.revision_receipt_digest);
  assert.deepEqual(restored.source_tree, candidate.resulting_source_tree);
  assert.equal(restored.git_candidate_receipt.replay, false);
  restartedMetadata.close();
});

test('loads current product identity from SQLite and source truth from verified Git objects', async () => {
  const fixture = dependencies();
  const result = await fixture.authority.load_current({ project_id: PROJECT_ID });

  assert.equal(fixture.authority.authority_version, BUILDER_PROJECT_READ_AUTHORITY_VERSION);
  assert.equal(result.result_version, BUILDER_PROJECT_READ_RESULT_VERSION);
  assert.equal(result.operation, 'current_loaded');
  assert.deepEqual(result.product_revision_receipt, fixture.receipt);
  assert.deepEqual(result.source_tree, fixture.tree);
  assert.equal(result.authority_evidence.product_authority, 'sqlite_product_revision_receipt');
  assert.equal(result.authority_evidence.code_authority, 'git_commit_tree');
  assert.equal(result.authority_evidence.current_selection, 'sqlite_current_project_revision');
  assert.deepEqual(fixture.calls.current, [{ project_id: PROJECT_ID }]);
  assert.equal(fixture.calls.git.length, 1);
  assert.equal(fixture.calls.git[0].commit_oid, fixture.receipt.commit_oid);
  assert.equal(fixture.calls.git[0].resulting_tree_digest, fixture.tree.source_tree_digest);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.source_tree.files), true);
});

test('loads an exact historical product receipt while preserving the separately selected current summary', async () => {
  const base = dependencies();
  const newer = {
    ...currentSummary(base.receipt),
    revision_receipt_digest: `sha256:${'f'.repeat(64)}`,
    revision_number: 2,
    commit_oid: 'c'.repeat(40),
    tree_oid: 'd'.repeat(40),
    parent_oid: base.receipt.commit_oid,
  };
  const fixture = dependencies({
    metadata: {
      load_project_revision(request) {
        base.calls.revision.push(request);
        return metadataResult(base.receipt, 'revision_loaded', newer);
      },
    },
  });
  const result = await fixture.authority.load_revision({
    project_id: PROJECT_ID,
    revision_receipt_digest: fixture.receipt.revision_receipt_digest,
  });

  assert.equal(result.operation, 'revision_loaded');
  assert.equal(result.product_revision_receipt.revision_number, 1);
  assert.equal(result.current.revision_number, 2);
  assert.notEqual(
    result.current.revision_receipt_digest,
    result.product_revision_receipt.revision_receipt_digest,
  );
});

test('lists only SQLite current summaries and never reads Git source objects', async () => {
  const fixture = dependencies();
  const result = await fixture.authority.list_current({ limit: 256 });

  assert.equal(result.operation, 'current_listed');
  assert.deepEqual(result.projects, [{
    project_id: PROJECT_ID,
    title: 'Hello tool',
    summary: 'A verified saved Builder project.',
    revision_number: 1,
    revision_receipt_digest: fixture.receipt.revision_receipt_digest,
    commit_oid: COMMIT_OID,
    tree_oid: TREE_OID,
    selected_at_ms: 10,
  }]);
  assert.equal(result.authority_evidence.code_authority, 'not_read_for_catalog');
  assert.equal(fixture.calls.git.length, 0);
  assert.doesNotMatch(JSON.stringify(result), /files|content|conversation_id|candidate_digest/iu);
});

test('lists verified project history summaries without source or candidate internals', async () => {
  const firstTree = sourceTree('<main>Version 1</main>\n');
  const secondTree = sourceTree('<main>Version 2</main>\n');
  const first = productReceipt(firstTree, {
    title: 'Version one',
    summary: 'The first saved Builder version.',
    selected_at_ms: 10,
  });
  const second = productReceipt(secondTree, {
    revision_number: 2,
    previous_revision_receipt_digest: first.revision_receipt_digest,
    title: 'Version two',
    summary: 'The second saved Builder version.',
    commit_oid: '2'.repeat(40),
    tree_oid: '3'.repeat(40),
    parent_oid: first.commit_oid,
    candidate_id: `builder-code-change-candidate:${'2'.repeat(64)}`,
    candidate_digest: `sha256:${'2'.repeat(64)}`,
    semantic_identity_digest: `sha256:${'3'.repeat(64)}`,
    selected_at_ms: 20,
  });
  const calls = { history: [], git: [] };
  const authority = createBuilderProjectReadAuthority({
    metadata_database: {
      load_current_project_revision() { throw new Error('history must not load current source'); },
      load_project_revision() { throw new Error('history must not load single revision source'); },
      list_current_project_revisions() { throw new Error('history must not list the project catalog'); },
      list_project_revisions(request) {
        calls.history.push(request);
        return {
          result_version: BUILDER_PRODUCT_METADATA_RESULT_VERSION,
          operation: 'project_revisions_listed',
          receipts: [second, first],
          current: currentSummary(second),
          metadata_evidence: metadataEvidence('project_revision_history_readback'),
        };
      },
    },
    git_repository: {
      read_verified_candidate(request) {
        calls.git.push(request);
        const tree = request.resulting_tree_digest === firstTree.source_tree_digest
          ? firstTree
          : secondTree;
        return gitResult(request, tree);
      },
    },
  });

  const result = await authority.list_history({ project_id: PROJECT_ID, limit: 2 });

  assert.equal(result.operation, 'history_listed');
  assert.equal(result.project_id, PROJECT_ID);
  assert.deepEqual(calls.history, [{ project_id: PROJECT_ID, limit: 2 }]);
  assert.deepEqual(calls.git.map((request) => request.commit_oid), [
    second.commit_oid,
    first.commit_oid,
  ]);
  assert.deepEqual(result.revisions, [
    {
      project_id: PROJECT_ID,
      title: 'Version two',
      summary: 'The second saved Builder version.',
      revision_number: 2,
      revision_receipt_digest: second.revision_receipt_digest,
      previous_revision_receipt_digest: first.revision_receipt_digest,
      commit_oid: second.commit_oid,
      tree_oid: second.tree_oid,
      parent_oid: first.commit_oid,
      selected_at_ms: 20,
      is_current: true,
    },
    {
      project_id: PROJECT_ID,
      title: 'Version one',
      summary: 'The first saved Builder version.',
      revision_number: 1,
      revision_receipt_digest: first.revision_receipt_digest,
      previous_revision_receipt_digest: null,
      commit_oid: first.commit_oid,
      tree_oid: first.tree_oid,
      parent_oid: null,
      selected_at_ms: 10,
      is_current: false,
    },
  ]);
  assert.equal(result.authority_evidence.history_selection, 'sqlite_project_revision_receipts');
  assert.doesNotMatch(
    JSON.stringify(result),
    /source_tree|files|content|candidate_digest|verification_receipt_digest|conversation_id|turn_id|request_id|task_id|run_id|review_id/iu,
  );
  assert.equal(Object.isFrozen(result.revisions), true);
});

test('fails closed on product and Git cross-evidence drift', async (t) => {
  await t.test('metadata current summary drift', async () => {
    const fixture = dependencies({
      metadata: {
        load_current_project_revision() {
          const receipt = productReceipt();
          return metadataResult(receipt, 'current_loaded', {
            ...currentSummary(receipt),
            tree_oid: 'f'.repeat(40),
          });
        },
      },
    });
    await assert.rejects(
      fixture.authority.load_current({ project_id: PROJECT_ID }),
      assertReadError('builder_project_read_integrity_failed'),
    );
  });

  await t.test('Git source digest drift', async () => {
    const fixture = dependencies({
      git: {
        read_verified_candidate(request) {
          const changedTree = sourceTree('<main>Changed</main>\n');
          return gitResult(request, changedTree);
        },
      },
    });
    await assert.rejects(
      fixture.authority.load_current({ project_id: PROJECT_ID }),
      assertReadError('builder_project_read_integrity_failed'),
    );
  });

  await t.test('Git candidate identity drift', async () => {
    const fixture = dependencies({
      git: {
        read_verified_candidate(request) {
          const changed = { ...request, tree_oid: 'f'.repeat(40) };
          return gitResult(changed, sourceTree());
        },
      },
    });
    await assert.rejects(
      fixture.authority.load_current({ project_id: PROJECT_ID }),
      assertReadError('builder_project_read_integrity_failed'),
    );
  });

  await t.test('history receipt chain drift', async () => {
    const first = productReceipt();
    const second = productReceipt(sourceTree('<main>Detached</main>\n'), {
      revision_number: 2,
      previous_revision_receipt_digest: `sha256:${'f'.repeat(64)}`,
      commit_oid: '2'.repeat(40),
      tree_oid: '3'.repeat(40),
      parent_oid: first.commit_oid,
      candidate_id: `builder-code-change-candidate:${'2'.repeat(64)}`,
      candidate_digest: `sha256:${'2'.repeat(64)}`,
      semantic_identity_digest: `sha256:${'3'.repeat(64)}`,
      selected_at_ms: 20,
    });
    const fixture = dependencies({
      historyReceipts: [second, first],
      historyCurrent: currentSummary(second),
    });
    await assert.rejects(
      fixture.authority.list_history({ project_id: PROJECT_ID, limit: 2 }),
      assertReadError('builder_project_read_integrity_failed'),
    );
    assert.equal(fixture.calls.git.length, 0);
  });

  await t.test('history Git source digest drift', async () => {
    const fixture = dependencies({
      git: {
        read_verified_candidate(request) {
          const changedTree = sourceTree('<main>Changed history</main>\n');
          return gitResult(request, changedTree);
        },
      },
    });
    await assert.rejects(
      fixture.authority.list_history({ project_id: PROJECT_ID, limit: 1 }),
      assertReadError('builder_project_read_integrity_failed'),
    );
  });
});

test('rejects malformed dependency surfaces, responses, and requests without invoking source reads', async () => {
  assert.throws(
    () => createBuilderProjectReadAuthority({
      metadata_database: Object.create({
        load_current_project_revision() {},
        load_project_revision() {},
        list_current_project_revisions() {},
        list_project_revisions() {},
      }),
      git_repository: { read_verified_candidate() {} },
    }),
    assertReadError('builder_project_read_invalid'),
  );

  const fixture = dependencies({
    metadata: {
      list_current_project_revisions() {
        return {
          result_version: BUILDER_PRODUCT_METADATA_RESULT_VERSION,
          operation: 'current_listed',
          projects: [],
          metadata_evidence: metadataEvidence('current_list_full_chain_readback'),
          hidden: 'credential-marker',
        };
      },
    },
  });
  await assert.rejects(
    fixture.authority.list_current({ limit: 256 }),
    assertReadError('builder_project_read_integrity_failed'),
  );
  await assert.rejects(
    fixture.authority.load_current({ project_id: `${PROJECT_ID} ` }),
    assertReadError('builder_project_read_invalid'),
  );
  assert.equal(fixture.calls.git.length, 0);
});

test('binds dependency results back to the exact requested project and revision', async () => {
  const fixture = dependencies();
  await assert.rejects(
    fixture.authority.load_current({ project_id: OTHER_PROJECT_ID }),
    assertReadError('builder_project_read_integrity_failed'),
  );
  await assert.rejects(
    fixture.authority.list_history({ project_id: OTHER_PROJECT_ID, limit: 1 }),
    assertReadError('builder_project_read_integrity_failed'),
  );
  await assert.rejects(
    fixture.authority.load_revision({
      project_id: PROJECT_ID,
      revision_receipt_digest: `sha256:${'9'.repeat(64)}`,
    }),
    assertReadError('builder_project_read_integrity_failed'),
  );
  assert.equal(fixture.calls.git.length, 0);
});

test('maps dependency failures to fixed redacted read errors', async (t) => {
  for (const [dependencyCode, expectedCode] of [
    ['builder_product_metadata_not_found', 'builder_project_read_not_found'],
    ['builder_product_metadata_integrity_failed', 'builder_project_read_integrity_failed'],
    ['builder_product_metadata_resource_exceeded', 'builder_project_read_resource_exceeded'],
    ['builder_product_metadata_unavailable', 'builder_project_read_unavailable'],
    ['builder_git_project_integrity_failed', 'builder_project_read_integrity_failed'],
    ['builder_git_project_failed', 'builder_project_read_unavailable'],
  ]) {
    await t.test(dependencyCode, async () => {
      const error = new Error(`credential-marker ${PROJECT_ID}`);
      error.code = dependencyCode;
      const fixture = dependencyCode.startsWith('builder_git')
        ? dependencies({ git: { read_verified_candidate() { throw error; } } })
        : dependencies({ metadata: { load_current_project_revision() { throw error; } } });
      await assert.rejects(
        fixture.authority.load_current({ project_id: PROJECT_ID }),
        assertReadError(expectedCode),
      );
    });
  }
});

test('normalizes hostile Proxy failures without invoking traps', async () => {
  let trapCalls = 0;
  const hostile = new Proxy({}, {
    getPrototypeOf() {
      trapCalls += 1;
      throw new Error('credential-marker');
    },
    getOwnPropertyDescriptor() {
      trapCalls += 1;
      throw new Error('credential-marker');
    },
  });
  const fixture = dependencies({
    metadata: {
      load_current_project_revision() {
        throw hostile;
      },
    },
  });
  await assert.rejects(
    fixture.authority.load_current({ project_id: PROJECT_ID }),
    assertReadError('builder_project_read_unavailable'),
  );
  assert.equal(trapCalls, 0);
});

test('source boundary stays main-only composition without storage, IPC, or network authority', () => {
  const source = fs.readFileSync(
    require.resolve('../electron/builder-project-read-authority.cjs'),
    'utf8',
  );
  assert.doesNotMatch(
    source,
    /node:fs|node:path|node:sqlite|DatabaseSync|ipcMain|ipcRenderer|BrowserWindow|preload|fetch\s*\(|https?:|safeStorage|builder-project-revision-repository/iu,
  );
  assert.match(source, /read_verified_candidate/u);
  assert.match(source, /load_current_project_revision/u);
  assert.match(source, /list_current_project_revisions/u);
  assert.match(source, /list_project_revisions/u);
  assert.equal(BUILDER_GIT_CANDIDATE_VERIFICATION_VERSION.includes('verification'), true);
});
