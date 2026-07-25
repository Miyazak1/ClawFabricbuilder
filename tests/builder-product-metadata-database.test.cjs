'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');

const {
  BUILDER_GIT_CANDIDATE_RECEIPT_VERSION,
  BUILDER_GIT_CANDIDATE_VERIFICATION_RECEIPT_VERSION,
  BUILDER_GIT_PROJECT_REPOSITORY_VERSION,
  BUILDER_PRODUCT_METADATA_USER_VERSION,
  METADATA_TABLES,
  createRevisionReceipt,
  sanitizeRecordProjectRevisionRequest,
  sha256Canonical,
} = require('../electron/builder-product-metadata-schema.cjs');
const {
  BUILDER_PRODUCT_METADATA_RESULT_VERSION,
  BuilderProductMetadataDatabaseError,
  createBuilderProductMetadataDatabase,
} = require('../electron/builder-product-metadata-database.cjs');
const {
  createBuilderConversationEvent,
} = require('../electron/builder-conversation-records.cjs');

const PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174000';
const OTHER_PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174001';
const CONVERSATION_ID = 'builder-conversation:123e4567-e89b-42d3-a456-426614174000';
const OTHER_CONVERSATION_ID = 'builder-conversation:123e4567-e89b-42d3-a456-426614174001';
const DRAFT_ID = `builder-generation-draft:${'5'.repeat(64)}`;

function temporaryDatabase(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawfabric-builder-product-metadata-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return path.join(root, 'product-metadata.sqlite');
}

function digest(char) {
  return `sha256:${char.repeat(64)}`;
}

function uuid(index) {
  return `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
}

function prior(event) {
  return event === null ? null : {
    sequence: event.sequence,
    event_id: event.event_id,
    event_digest: event.event_digest,
  };
}

function conversationEvent(sequence, type, payload, previousEvent = null) {
  const normalizedPayload = type === 'run_completed'
    ? { ...payload, plan_admission: payload.plan_admission ?? null }
    : payload;
  return createBuilderConversationEvent({
    record_version: 'builder-conversation-event.v2',
    record_kind: 'builder_conversation_event',
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    sequence,
    command_id: `builder-command:${uuid(100 + sequence)}`,
    event_type: type,
    previous_event: prior(previousEvent),
    payload: normalizedPayload,
    authority: {
      context_authority: 'project_local_conversation',
      permission_admission: 'not_granted',
      execution_admission: 'not_granted',
      revision_admission: 'not_created',
    },
  });
}

function initialConversationEvents() {
  const submitted = conversationEvent(1, 'turn_submitted', {
    message: {
      message_id: `builder-message:${uuid(201)}`,
      text: 'Build a small timer.',
    },
    turn_id: `builder-turn:${uuid(202)}`,
    mode: 'work',
    task: {
      task_id: `builder-task:${uuid(203)}`,
      title: 'Create Builder project',
    },
    base_revision: null,
  });
  const started = conversationEvent(2, 'run_started', {
    turn_id: submitted.payload.turn_id,
    run_id: `builder-run:${uuid(204)}`,
    task_id: submitted.payload.task.task_id,
    attempt_number: 1,
    retry_of_run_id: null,
    input_digest: digest('a'),
  }, submitted);
  return [submitted, started];
}

function terminalConversationEvents(initial) {
  const completed = conversationEvent(3, 'run_completed', {
    turn_id: initial[0].payload.turn_id,
    run_id: initial[1].payload.run_id,
    terminal_status: 'succeeded',
    result_kind: 'explanation',
    result_digest: digest('b'),
    assistant_message: {
      message_id: `builder-message:${uuid(205)}`,
      text: 'The draft is ready to review.',
    },
    candidate_result: null,
  }, initial[1]);
  const terminal = conversationEvent(4, 'turn_completed', {
    turn_id: initial[0].payload.turn_id,
    run_id: initial[1].payload.run_id,
    outcome: 'responded',
  }, completed);
  return [completed, terminal];
}

function candidateTerminalConversationEvents(initial) {
  const completed = conversationEvent(3, 'run_completed', {
    turn_id: initial[0].payload.turn_id,
    run_id: initial[1].payload.run_id,
    terminal_status: 'succeeded',
    result_kind: 'candidate',
    result_digest: digest('b'),
    assistant_message: {
      message_id: `builder-message:${uuid(205)}`,
      text: 'The draft is ready to review.',
    },
    candidate_result: {
      draft_id: DRAFT_ID,
      title: 'Timer draft',
      summary: 'A draft ready to save.',
      git_candidate_receipt: {
        receipt_version: 'builder-git-candidate-receipt.v1',
        repository_version: 'builder-git-project-repository.v1',
        project_id: PROJECT_ID,
        conversation_id: CONVERSATION_ID,
        turn_id: initial[0].payload.turn_id,
        task_id: initial[0].payload.task.task_id,
        run_id: initial[1].payload.run_id,
        request_id: `builder-git-request:${uuid(206)}`,
        candidate_id: `builder-code-change-candidate:${'6'.repeat(64)}`,
        candidate_digest: digest('b'),
        resulting_tree_digest: digest('d'),
        semantic_identity_digest: digest('e'),
        verification_receipt_digest: digest('f'),
        object_format: 'sha1',
        commit_oid: '1'.repeat(40),
        tree_oid: '2'.repeat(40),
        parent_oid: null,
        expected_base_oid: null,
        code_authority: 'git_commit_candidate',
        product_revision_admission: 'not_recorded',
        replay: false,
      },
    },
  }, initial[1]);
  const terminal = conversationEvent(4, 'turn_completed', {
    turn_id: initial[0].payload.turn_id,
    run_id: initial[1].payload.run_id,
    outcome: 'candidate_ready',
  }, completed);
  return [completed, terminal];
}

function appendConversationRequest(events, expectedHead = null) {
  return {
    project: { project_id: PROJECT_ID, created_at_ms: 1 },
    conversation: {
      project_id: PROJECT_ID,
      conversation_id: CONVERSATION_ID,
      created_at_ms: 1,
    },
    expected_head: expectedHead,
    events,
    recorded_at_ms: 2,
  };
}

function oid(index) {
  return String(index).padStart(40, '0');
}

function digestFromIndex(index) {
  return `sha256:${index.toString(16).padStart(64, '0')}`;
}

function request({
  idempotencyIndex = 1,
  taskIndex = 1,
  runIndex = 2,
  reviewIndex = 3,
  reviewerIndex = 4,
  turnIndex = 5,
  requestIndex = 6,
  candidateIndex = 7,
  commit = 'a'.repeat(40),
  tree = 'b'.repeat(40),
  parent = null,
  candidateDigest = digest('c'),
  resultingTreeDigest = digest('d'),
  semanticIdentityDigest = digest('e'),
  title = 'Create the project',
  summary = 'A saved Builder project revision.',
  expected = null,
  selectedAt = 5,
  baseCreatedAt = 1,
  projectId = PROJECT_ID,
  conversationId = CONVERSATION_ID,
} = {}) {
  const taskId = `builder-task:${uuid(taskIndex)}`;
  const runId = `builder-run:${uuid(runIndex)}`;
  const turnId = `builder-turn:${uuid(turnIndex)}`;
  const requestId = `builder-git-request:${uuid(requestIndex)}`;
  const candidateId = `builder-code-change-candidate:${String(candidateIndex).padStart(64, '0')}`;
  const verification = {
    receipt_version: BUILDER_GIT_CANDIDATE_VERIFICATION_RECEIPT_VERSION,
    repository_version: BUILDER_GIT_PROJECT_REPOSITORY_VERSION,
    project_id: projectId,
    conversation_id: conversationId,
    turn_id: turnId,
    task_id: taskId,
    run_id: runId,
    request_id: requestId,
    candidate_id: candidateId,
    candidate_digest: candidateDigest,
    expected_base_oid: parent,
    commit_oid: commit,
    candidate_tree_oid: tree,
    resulting_tree_digest: resultingTreeDigest,
    semantic_identity_digest: semanticIdentityDigest,
    object_format: 'sha1',
    commit_ref_admission: 'verified',
    request_ref_admission: 'verified',
    commit_object_admission: 'verified',
    verification_admission: 'accepted',
  };
  const verificationDigest = sha256Canonical(verification);
  return {
    idempotency: {
      idempotency_key: `builder-idempotency:${String(idempotencyIndex).padStart(64, '0')}`,
    },
    project: {
      project_id: projectId,
      created_at_ms: baseCreatedAt,
    },
    conversation: {
      conversation_id: conversationId,
      project_id: projectId,
      created_at_ms: baseCreatedAt,
    },
    task: {
      task_id: taskId,
      project_id: projectId,
      conversation_id: conversationId,
      title,
      base_commit_oid: parent,
      created_at_ms: baseCreatedAt + 1,
    },
    run: {
      run_id: runId,
      project_id: projectId,
      task_id: taskId,
      turn_id: turnId,
      request_id: requestId,
      candidate_id: candidateId,
      status: 'succeeded',
      result_kind: 'candidate',
      result_digest: candidateDigest,
      completed_at_ms: baseCreatedAt + 2,
    },
    review: {
      review_id: `builder-review:${uuid(reviewIndex)}`,
      project_id: projectId,
      task_id: taskId,
      run_id: runId,
      subject_kind: 'git_candidate',
      subject_candidate_id: candidateId,
      subject_candidate_digest: candidateDigest,
      subject_verification_receipt_digest: verificationDigest,
      decision: 'accepted',
      reviewer_id: `builder-user:${uuid(reviewerIndex)}`,
      reviewed_at_ms: baseCreatedAt + 3,
    },
    git_candidate_verification_receipt: verification,
    git_candidate_receipt: {
      receipt_version: BUILDER_GIT_CANDIDATE_RECEIPT_VERSION,
      repository_version: BUILDER_GIT_PROJECT_REPOSITORY_VERSION,
      project_id: projectId,
      conversation_id: conversationId,
      turn_id: turnId,
      task_id: taskId,
      run_id: runId,
      request_id: requestId,
      candidate_id: candidateId,
      candidate_digest: candidateDigest,
      resulting_tree_digest: resultingTreeDigest,
      semantic_identity_digest: semanticIdentityDigest,
      verification_receipt_digest: verificationDigest,
      object_format: 'sha1',
      commit_oid: commit,
      tree_oid: tree,
      parent_oid: parent,
      expected_base_oid: parent,
      code_authority: 'git_commit_candidate',
      product_revision_admission: 'not_recorded',
      replay: false,
    },
    project_revision: {
      project_id: projectId,
      title,
      summary,
      conversation_id: conversationId,
      turn_id: turnId,
      request_id: requestId,
      object_format: 'sha1',
      commit_oid: commit,
      tree_oid: tree,
      parent_oid: parent,
      candidate_id: candidateId,
      candidate_digest: candidateDigest,
      resulting_tree_digest: resultingTreeDigest,
      semantic_identity_digest: semanticIdentityDigest,
      verification_receipt_digest: verificationDigest,
      selected_at_ms: selectedAt,
    },
    expected_current_revision_receipt_digest: expected,
  };
}

function assertDatabaseError(code, forbidden = []) {
  return (error) => {
    assert.ok(error instanceof BuilderProductMetadataDatabaseError);
    assert.equal(error.code, code);
    const text = JSON.stringify({
      name: error.name,
      code: error.code,
      message: error.message,
      stack: error.stack,
    });
    assert.doesNotMatch(text, /123e4567|product-metadata|credential-marker|SQLITE|table|commit_oid/u);
    for (const marker of forbidden) assert.doesNotMatch(text, new RegExp(marker, 'iu'));
    return true;
  };
}

function receiptBody(receipt) {
  const body = { ...receipt };
  delete body.revision_receipt_digest;
  return body;
}

function inspectDatabase(filePath) {
  const db = new DatabaseSync(filePath);
  try {
    const tableRows = db.prepare(
      "SELECT name, strict FROM pragma_table_list WHERE schema = 'main' AND type = 'table'",
    ).all().filter((row) => !String(row.name).startsWith('sqlite_'));
    const indexes = db.prepare(
      "SELECT name FROM sqlite_schema WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    ).all().map((row) => row.name);
    return {
      foreignKeys: db.prepare('PRAGMA foreign_keys').get().foreign_keys,
      journalMode: db.prepare('PRAGMA journal_mode').get().journal_mode,
      synchronous: db.prepare('PRAGMA synchronous').get().synchronous,
      tableRows,
      indexes,
      userVersion: db.prepare('PRAGMA user_version').get().user_version,
    };
  } finally {
    db.close();
  }
}

function seedRevisionChainFixture(filePath, length) {
  const raw = new DatabaseSync(filePath);
  let previousReceiptDigest = null;
  let parentOid = null;
  let lastReceipt = null;
  try {
    raw.exec('PRAGMA foreign_keys = ON');
    raw.exec('BEGIN IMMEDIATE');
    const insertProject = raw.prepare(`INSERT OR IGNORE INTO projects (
      project_id, project_created_at_ms, current_revision_receipt_digest,
      current_revision_number, metadata_schema_version
    ) VALUES (?, ?, NULL, 0, 'builder-product-metadata-schema.v4')`);
    const insertConversation = raw.prepare(`INSERT OR IGNORE INTO conversations (
      project_id, conversation_id, created_at_ms
    ) VALUES (?, ?, ?)`);
    const insertTask = raw.prepare(`INSERT INTO tasks (
      project_id, conversation_id, task_id, title, base_commit_oid, created_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?)`);
    const insertRun = raw.prepare(`INSERT INTO runs (
      project_id, task_id, run_id, turn_id, request_id, candidate_id, status,
      result_kind, result_digest, completed_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const insertReview = raw.prepare(`INSERT INTO reviews (
      project_id, task_id, run_id, review_id, subject_kind, subject_candidate_id,
      subject_candidate_digest, subject_verification_receipt_digest, decision,
      reviewer_id, reviewed_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const insertRevision = raw.prepare(`INSERT INTO project_revisions (
      project_id, revision_receipt_digest, revision_number, previous_revision_receipt_digest,
      title, summary, conversation_id, turn_id, request_id, object_format, commit_oid,
      tree_oid, parent_oid, candidate_id, candidate_digest, resulting_tree_digest,
      semantic_identity_digest, verification_receipt_digest, task_id, run_id, review_id,
      selected_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (let index = 1; index <= length; index += 1) {
      const rawRequest = request({
        idempotencyIndex: index,
        taskIndex: index,
        runIndex: index + 2_000,
        reviewIndex: index + 4_000,
        reviewerIndex: 4,
        turnIndex: index + 6_000,
        requestIndex: index + 8_000,
        candidateIndex: index,
        commit: oid(index),
        tree: oid(index + 10_000),
        parent: parentOid,
        candidateDigest: digestFromIndex(index),
        resultingTreeDigest: digestFromIndex(index + 10_000),
        expected: previousReceiptDigest,
        selectedAt: index,
      });
      const sanitized = sanitizeRecordProjectRevisionRequest(rawRequest);
      const receipt = createRevisionReceipt({
        ...sanitized.receipt_input,
        revision_number: index,
        previous_revision_receipt_digest: previousReceiptDigest,
      });
      insertProject.run(sanitized.project.project_id, sanitized.project.created_at_ms);
      insertConversation.run(
        sanitized.conversation.project_id,
        sanitized.conversation.conversation_id,
        sanitized.conversation.created_at_ms,
      );
      insertTask.run(
        sanitized.task.project_id,
        sanitized.task.conversation_id,
        sanitized.task.task_id,
        sanitized.task.title,
        sanitized.task.base_commit_oid,
        sanitized.task.created_at_ms,
      );
      insertRun.run(
        sanitized.run.project_id,
        sanitized.run.task_id,
        sanitized.run.run_id,
        sanitized.run.turn_id,
        sanitized.run.request_id,
        sanitized.run.candidate_id,
        sanitized.run.status,
        sanitized.run.result_kind,
        sanitized.run.result_digest,
        sanitized.run.completed_at_ms,
      );
      insertReview.run(
        sanitized.review.project_id,
        sanitized.review.task_id,
        sanitized.review.run_id,
        sanitized.review.review_id,
        sanitized.review.subject_kind,
        sanitized.review.subject_candidate_id,
        sanitized.review.subject_candidate_digest,
        sanitized.review.subject_verification_receipt_digest,
        sanitized.review.decision,
        sanitized.review.reviewer_id,
        sanitized.review.reviewed_at_ms,
      );
      insertRevision.run(
        receipt.project_id,
        receipt.revision_receipt_digest,
        receipt.revision_number,
        receipt.previous_revision_receipt_digest,
        receipt.title,
        receipt.summary,
        receipt.conversation_id,
        receipt.turn_id,
        receipt.request_id,
        receipt.object_format,
        receipt.commit_oid,
        receipt.tree_oid,
        receipt.parent_oid,
        receipt.candidate_id,
        receipt.candidate_digest,
        receipt.resulting_tree_digest,
        receipt.semantic_identity_digest,
        receipt.verification_receipt_digest,
        receipt.task_id,
        receipt.run_id,
        receipt.review_id,
        receipt.selected_at_ms,
      );
      previousReceiptDigest = receipt.revision_receipt_digest;
      parentOid = receipt.commit_oid;
      lastReceipt = receipt;
    }
    raw.prepare(`UPDATE projects
      SET current_revision_receipt_digest = ?, current_revision_number = ?
      WHERE project_id = ?`).run(lastReceipt.revision_receipt_digest, lastReceipt.revision_number, PROJECT_ID);
    raw.exec('COMMIT');
    return { lastReceipt, parentOid, previousReceiptDigest };
  } catch (error) {
    try { raw.exec('ROLLBACK'); } catch { /* test cleanup */ }
    throw error;
  } finally {
    raw.close();
  }
}

test('creates a strict node:sqlite C0 metadata database with exact schema and PRAGMAs', (t) => {
  const filePath = temporaryDatabase(t);
  const metadata = createBuilderProductMetadataDatabase(filePath);
  metadata.close();

  const inspected = inspectDatabase(filePath);
  assert.equal(inspected.userVersion, BUILDER_PRODUCT_METADATA_USER_VERSION);
  assert.equal(inspected.foreignKeys, 1);
  assert.equal(inspected.synchronous, 2);
  assert.equal(String(inspected.journalMode).toLowerCase(), 'wal');
  assert.deepEqual(
    inspected.tableRows.map((row) => row.name).sort(),
    [...METADATA_TABLES].sort(),
  );
  assert.ok(inspected.tableRows.every((row) => row.strict === 1));
  assert.ok(inspected.indexes.includes('runs_task_idx'));
  assert.ok(inspected.indexes.includes('conversation_candidate_results_project_idx'));

  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-product-metadata-database.cjs'),
    'utf8',
  );
  assert.match(source, /PRAGMA trusted_schema = OFF/u);
  assert.match(source, /PRAGMA table_xinfo/u);
  assert.match(source, /PRAGMA foreign_key_list/u);
  assert.match(source, /PRAGMA index_xinfo/u);
  assert.match(source, /PRAGMA foreign_key_check/u);
  assert.doesNotMatch(source, /receipt_json/u);
});

test('records monotonic Project Revision receipts and restores current after restart', (t) => {
  const filePath = temporaryDatabase(t);
  const metadata = createBuilderProductMetadataDatabase(filePath);
  const first = metadata.record_project_revision_receipt(request());
  const identity = metadata.load_project_identity({ project_id: PROJECT_ID });

  assert.equal(first.result_version, BUILDER_PRODUCT_METADATA_RESULT_VERSION);
  assert.equal(first.operation, 'recorded');
  assert.equal(first.receipt.project_id, PROJECT_ID);
  assert.equal(first.receipt.revision_number, 1);
  assert.equal(first.receipt.title, 'Create the project');
  assert.equal(first.receipt.summary, 'A saved Builder project revision.');
  assert.equal(first.receipt.conversation_id, CONVERSATION_ID);
  assert.match(first.receipt.request_id, /^builder-git-request:/u);
  assert.equal(first.receipt.resulting_tree_digest, digest('d'));
  assert.equal(first.receipt.semantic_identity_digest, digest('e'));
  assert.equal(first.receipt.previous_revision_receipt_digest, null);
  assert.equal(first.receipt.parent_oid, null);
  assert.equal(first.receipt.candidate_digest, digest('c'));
  assert.equal(first.current.revision_receipt_digest, first.receipt.revision_receipt_digest);
  assert.equal(first.metadata_evidence.git_object_verification, 'not_performed_by_metadata_database');
  assert.equal(first.metadata_evidence.source_bytes_stored, false);
  assert.equal(first.metadata_evidence.credential_storage, 'not_present');
  assert.equal(first.metadata_evidence.ui_state_storage, 'not_present');
  assert.deepEqual(identity.project, {
    project_id: PROJECT_ID,
    created_at_ms: 1,
  });
  assert.equal(identity.operation, 'project_identity_loaded');
  assert.doesNotMatch(JSON.stringify(identity), /commit_oid|revision_receipt_digest|candidate_digest/u);
  assert.deepEqual(first.metadata_evidence.runtime_pragmas, {
    foreign_keys: 'on',
    journal_mode: 'wal',
    synchronous: 'full',
    trusted_schema: 'off',
  });

  const second = metadata.record_project_revision_receipt(request({
    idempotencyIndex: 2,
    taskIndex: 11,
    runIndex: 12,
    reviewIndex: 13,
    turnIndex: 14,
    requestIndex: 15,
    candidateIndex: 16,
    commit: 'e'.repeat(40),
    tree: 'f'.repeat(40),
    parent: first.receipt.commit_oid,
    candidateDigest: digest('e'),
    resultingTreeDigest: digest('f'),
    expected: first.receipt.revision_receipt_digest,
    selectedAt: 60,
  }));
  assert.equal(second.receipt.revision_number, 2);
  assert.equal(second.receipt.previous_revision_receipt_digest, first.receipt.revision_receipt_digest);
  assert.equal(second.receipt.parent_oid, first.receipt.commit_oid);
  metadata.close();

  const restarted = createBuilderProductMetadataDatabase(filePath);
  const current = restarted.load_current_project_revision({ project_id: PROJECT_ID });
  assert.equal(current.operation, 'current_loaded');
  assert.deepEqual(current.receipt, second.receipt);
  const exactFirst = restarted.load_project_revision({
    project_id: PROJECT_ID,
    revision_receipt_digest: first.receipt.revision_receipt_digest,
  });
  assert.equal(exactFirst.operation, 'revision_loaded');
  assert.deepEqual(exactFirst.receipt, first.receipt);
  assert.equal(exactFirst.current.revision_receipt_digest, second.receipt.revision_receipt_digest);
  assert.notEqual(exactFirst.current.revision_receipt_digest, exactFirst.receipt.revision_receipt_digest);
  assert.deepEqual(restarted.load_project_identity({ project_id: PROJECT_ID }).project, {
    project_id: PROJECT_ID,
    created_at_ms: 1,
  });
  restarted.close();
});

test('lists current Project Revisions as stable redacted catalog entries', (t) => {
  const filePath = temporaryDatabase(t);
  const metadata = createBuilderProductMetadataDatabase(filePath);
  const laterProject = metadata.record_project_revision_receipt(request({
    projectId: OTHER_PROJECT_ID,
    conversationId: OTHER_CONVERSATION_ID,
    idempotencyIndex: 2,
    taskIndex: 11,
    runIndex: 12,
    reviewIndex: 13,
    turnIndex: 14,
    requestIndex: 15,
    candidateIndex: 16,
    commit: '2'.repeat(40),
    tree: '3'.repeat(40),
    candidateDigest: digest('2'),
    resultingTreeDigest: digest('3'),
    semanticIdentityDigest: digest('4'),
    title: 'Second project',
    summary: 'Another current project.',
    selectedAt: 20,
  }));
  const firstProject = metadata.record_project_revision_receipt(request({
    idempotencyIndex: 3,
    taskIndex: 21,
    runIndex: 22,
    reviewIndex: 23,
    turnIndex: 24,
    requestIndex: 25,
    candidateIndex: 26,
    commit: '4'.repeat(40),
    tree: '5'.repeat(40),
    candidateDigest: digest('5'),
    resultingTreeDigest: digest('6'),
    semanticIdentityDigest: digest('7'),
    title: 'First project',
    summary: 'The first current project.',
    selectedAt: 10,
  }));

  const listed = metadata.list_current_project_revisions({ limit: 256 });
  assert.equal(listed.result_version, BUILDER_PRODUCT_METADATA_RESULT_VERSION);
  assert.equal(listed.operation, 'current_listed');
  assert.deepEqual(listed.projects, [
    {
      project_id: PROJECT_ID,
      title: 'First project',
      summary: 'The first current project.',
      revision_number: 1,
      revision_receipt_digest: firstProject.receipt.revision_receipt_digest,
      commit_oid: firstProject.receipt.commit_oid,
      tree_oid: firstProject.receipt.tree_oid,
      selected_at_ms: 10,
    },
    {
      project_id: OTHER_PROJECT_ID,
      title: 'Second project',
      summary: 'Another current project.',
      revision_number: 1,
      revision_receipt_digest: laterProject.receipt.revision_receipt_digest,
      commit_oid: laterProject.receipt.commit_oid,
      tree_oid: laterProject.receipt.tree_oid,
      selected_at_ms: 20,
    },
  ]);
  const catalogPacket = JSON.stringify(listed.projects);
  assert.doesNotMatch(
    catalogPacket,
    /candidate_digest|verification_receipt_digest|conversation_id|turn_id|request_id|source/iu,
  );
  assert.deepEqual(
    metadata.list_current_project_revisions({ limit: 1 }).projects.map((entry) => entry.project_id),
    [PROJECT_ID],
  );
  metadata.close();
});

test('lists one project Revision history as a current-first receipt window', (t) => {
  const filePath = temporaryDatabase(t);
  const metadata = createBuilderProductMetadataDatabase(filePath);
  const first = metadata.record_project_revision_receipt(request({
    title: 'First saved version',
    summary: 'The first saved Builder version.',
    selectedAt: 10,
  }));
  const second = metadata.record_project_revision_receipt(request({
    idempotencyIndex: 2,
    taskIndex: 11,
    runIndex: 12,
    reviewIndex: 13,
    turnIndex: 14,
    requestIndex: 15,
    candidateIndex: 16,
    commit: '2'.repeat(40),
    tree: '3'.repeat(40),
    parent: first.receipt.commit_oid,
    candidateDigest: digest('2'),
    resultingTreeDigest: digest('3'),
    semanticIdentityDigest: digest('4'),
    title: 'Second saved version',
    summary: 'The second saved Builder version.',
    expected: first.receipt.revision_receipt_digest,
    selectedAt: 20,
  }));

  const listed = metadata.list_project_revisions({ project_id: PROJECT_ID, limit: 2 });
  assert.equal(listed.result_version, BUILDER_PRODUCT_METADATA_RESULT_VERSION);
  assert.equal(listed.operation, 'project_revisions_listed');
  assert.equal(listed.metadata_evidence.transaction, 'project_revision_history_readback');
  assert.equal(listed.metadata_evidence.git_object_verification, 'not_performed_by_metadata_database');
  assert.equal(listed.metadata_evidence.source_bytes_stored, false);
  assert.deepEqual(listed.current, {
    project_id: PROJECT_ID,
    title: 'Second saved version',
    summary: 'The second saved Builder version.',
    revision_receipt_digest: second.receipt.revision_receipt_digest,
    revision_number: 2,
    object_format: 'sha1',
    commit_oid: second.receipt.commit_oid,
    tree_oid: second.receipt.tree_oid,
    parent_oid: second.receipt.parent_oid,
  });
  assert.deepEqual(
    listed.receipts.map((receipt) => receipt.revision_receipt_digest),
    [second.receipt.revision_receipt_digest, first.receipt.revision_receipt_digest],
  );
  assert.deepEqual(metadata.list_project_revisions({ project_id: PROJECT_ID, limit: 1 }).receipts, [
    second.receipt,
  ]);
  assert.doesNotMatch(JSON.stringify(listed), /source_tree|credential_secret|provider_secret|ui_state_storage":"present/iu);
  metadata.close();
});

test('replays the original action receipt while re-querying latest current', (t) => {
  const filePath = temporaryDatabase(t);
  const metadata = createBuilderProductMetadataDatabase(filePath);
  const firstRequest = request();
  const first = metadata.record_project_revision_receipt(firstRequest);
  const second = metadata.record_project_revision_receipt(request({
    idempotencyIndex: 2,
    taskIndex: 21,
    runIndex: 22,
    reviewIndex: 23,
    turnIndex: 24,
    requestIndex: 25,
    candidateIndex: 26,
    commit: '2'.repeat(40),
    tree: '3'.repeat(40),
    parent: first.receipt.commit_oid,
    candidateDigest: digest('2'),
    resultingTreeDigest: digest('3'),
    expected: first.receipt.revision_receipt_digest,
    selectedAt: 70,
  }));

  const replayed = metadata.record_project_revision_receipt(structuredClone(firstRequest));
  assert.equal(replayed.operation, 'replayed');
  assert.deepEqual(replayed.receipt, first.receipt);
  assert.equal(replayed.current.revision_receipt_digest, second.receipt.revision_receipt_digest);
  assert.notEqual(replayed.current.revision_receipt_digest, replayed.receipt.revision_receipt_digest);

  const upstreamReplay = structuredClone(firstRequest);
  upstreamReplay.git_candidate_receipt.replay = true;
  const upstreamReplayResult = metadata.record_project_revision_receipt(upstreamReplay);
  assert.equal(upstreamReplayResult.operation, 'replayed');
  assert.deepEqual(upstreamReplayResult.receipt, first.receipt);
  metadata.close();

  const recoveryPath = temporaryDatabase(t);
  const recovered = createBuilderProductMetadataDatabase(recoveryPath);
  const recoveredResult = recovered.record_project_revision_receipt(upstreamReplay);
  assert.equal(recoveredResult.operation, 'recorded');
  assert.equal(recoveredResult.receipt.commit_oid, first.receipt.commit_oid);
  recovered.close();

  {
    const raw = new DatabaseSync(filePath);
    raw.prepare('UPDATE project_revisions SET commit_oid = ? WHERE revision_receipt_digest = ?')
      .run('f'.repeat(40), first.receipt.revision_receipt_digest);
    raw.close();
  }
  const tamperedReplay = createBuilderProductMetadataDatabase(filePath);
  assert.throws(
    () => tamperedReplay.record_project_revision_receipt(firstRequest),
    assertDatabaseError('builder_product_metadata_integrity_failed'),
  );
  tamperedReplay.close();
});

test('rejects semantic idempotency drift without changing current', (t) => {
  const filePath = temporaryDatabase(t);
  const metadata = createBuilderProductMetadataDatabase(filePath);
  const firstRequest = request();
  const first = metadata.record_project_revision_receipt(firstRequest);
  const drift = request({
    commit: '9'.repeat(40),
    tree: '8'.repeat(40),
    candidateDigest: digest('9'),
    resultingTreeDigest: digest('8'),
  });
  drift.idempotency = firstRequest.idempotency;
  assert.throws(
    () => metadata.record_project_revision_receipt(drift),
    assertDatabaseError('builder_product_metadata_idempotency_conflict'),
  );
  assert.deepEqual(metadata.load_current_project_revision({ project_id: PROJECT_ID }).receipt, first.receipt);
  metadata.close();
});

test('rejects idempotency replay rows that cross project authority', (t) => {
  const filePath = temporaryDatabase(t);
  const metadata = createBuilderProductMetadataDatabase(filePath);
  const firstRequest = request();
  const first = metadata.record_project_revision_receipt(firstRequest);
  const other = metadata.record_project_revision_receipt(request({
    idempotencyIndex: 9,
    taskIndex: 91,
    runIndex: 92,
    reviewIndex: 93,
    turnIndex: 94,
    requestIndex: 95,
    candidateIndex: 96,
    commit: '9'.repeat(40),
    tree: '8'.repeat(40),
    candidateDigest: digest('9'),
    resultingTreeDigest: digest('8'),
    projectId: OTHER_PROJECT_ID,
    conversationId: OTHER_CONVERSATION_ID,
  }));
  metadata.close();

  const raw = new DatabaseSync(filePath);
  try {
    raw.exec('PRAGMA ignore_check_constraints = ON');
    raw.prepare(
      `UPDATE idempotency_records
        SET result_project_id = ?, result_digest = ?
        WHERE project_id = ? AND idempotency_key = ?`,
    ).run(
      OTHER_PROJECT_ID,
      other.receipt.revision_receipt_digest,
      PROJECT_ID,
      firstRequest.idempotency.idempotency_key,
    );
  } finally {
    raw.close();
  }

  const tampered = createBuilderProductMetadataDatabase(filePath);
  assert.throws(
    () => tampered.record_project_revision_receipt(firstRequest),
    assertDatabaseError('builder_product_metadata_integrity_failed'),
  );
  assert.equal(
    tampered.load_current_project_revision({ project_id: PROJECT_ID }).receipt.revision_receipt_digest,
    first.receipt.revision_receipt_digest,
  );
  tampered.close();
});

test('enforces expected-current CAS and exact parent chain semantics', (t) => {
  const filePath = temporaryDatabase(t);
  const metadata = createBuilderProductMetadataDatabase(filePath);
  const first = metadata.record_project_revision_receipt(request());

  assert.throws(
    () => metadata.record_project_revision_receipt(request({
      idempotencyIndex: 2,
      taskIndex: 11,
      runIndex: 12,
      reviewIndex: 13,
      turnIndex: 14,
      requestIndex: 15,
      candidateIndex: 16,
      commit: 'c'.repeat(40),
      tree: 'd'.repeat(40),
      parent: null,
      expected: null,
      selectedAt: 50,
    })),
    assertDatabaseError('builder_product_metadata_conflict'),
  );

  assert.throws(
    () => metadata.record_project_revision_receipt(request({
      idempotencyIndex: 3,
      taskIndex: 21,
      runIndex: 22,
      reviewIndex: 23,
      turnIndex: 24,
      requestIndex: 25,
      candidateIndex: 26,
      commit: 'e'.repeat(40),
      tree: 'f'.repeat(40),
      parent: '0'.repeat(40),
      candidateDigest: digest('e'),
      resultingTreeDigest: digest('f'),
      expected: first.receipt.revision_receipt_digest,
      selectedAt: 60,
    })),
    assertDatabaseError('builder_product_metadata_invalid'),
  );

  assert.throws(
    () => metadata.record_project_revision_receipt(request({
      idempotencyIndex: 4,
      taskIndex: 31,
      runIndex: 32,
      reviewIndex: 33,
      turnIndex: 34,
      requestIndex: 35,
      candidateIndex: 36,
      commit: '4'.repeat(40),
      tree: '5'.repeat(40),
      parent: null,
      expected: first.receipt.revision_receipt_digest,
      selectedAt: 80,
    })),
    assertDatabaseError('builder_product_metadata_invalid'),
  );
  metadata.close();
});

test('maps schema tamper, row drift, and read-boundary drift to integrity failures', (t) => {
  const schemaPath = temporaryDatabase(t);
  const metadata = createBuilderProductMetadataDatabase(schemaPath);
  metadata.close();
  {
    const raw = new DatabaseSync(schemaPath);
    raw.exec('CREATE TABLE unexpected_product_fact (id TEXT PRIMARY KEY) STRICT');
    raw.close();
  }
  assert.throws(
    () => createBuilderProductMetadataDatabase(schemaPath),
    assertDatabaseError('builder_product_metadata_integrity_failed'),
  );

  const rowPath = temporaryDatabase(t);
  const rowDb = createBuilderProductMetadataDatabase(rowPath);
  const saved = rowDb.record_project_revision_receipt(request());
  rowDb.close();
  {
    const raw = new DatabaseSync(rowPath);
    raw.prepare('UPDATE project_revisions SET commit_oid = ? WHERE revision_receipt_digest = ?')
      .run('0'.repeat(40), saved.receipt.revision_receipt_digest);
    raw.close();
  }
  const tampered = createBuilderProductMetadataDatabase(rowPath);
  assert.throws(
    () => tampered.load_current_project_revision({ project_id: PROJECT_ID }),
    assertDatabaseError('builder_product_metadata_integrity_failed'),
  );
  tampered.close();

  const relationPath = temporaryDatabase(t);
  const relationDb = createBuilderProductMetadataDatabase(relationPath);
  relationDb.record_project_revision_receipt(request());
  relationDb.close();
  {
    const raw = new DatabaseSync(relationPath);
    raw.prepare('UPDATE runs SET result_digest = ?').run(digest('9'));
    raw.close();
  }
  const relationTampered = createBuilderProductMetadataDatabase(relationPath);
  assert.throws(
    () => relationTampered.load_current_project_revision({ project_id: PROJECT_ID }),
    assertDatabaseError('builder_product_metadata_integrity_failed'),
  );
  relationTampered.close();
});

test('treats inconsistent project current tuples as integrity failures', (t) => {
  const filePath = temporaryDatabase(t);
  const metadata = createBuilderProductMetadataDatabase(filePath);
  metadata.record_project_revision_receipt(request());
  metadata.close();

  {
    const raw = new DatabaseSync(filePath);
    raw.exec('PRAGMA ignore_check_constraints = ON');
    raw.prepare('UPDATE projects SET current_revision_receipt_digest = NULL, current_revision_number = 1')
      .run();
    raw.close();
  }

  const tampered = createBuilderProductMetadataDatabase(filePath);
  assert.throws(
    () => tampered.load_current_project_revision({ project_id: PROJECT_ID }),
    assertDatabaseError('builder_product_metadata_integrity_failed'),
  );
  tampered.close();

  const numberPath = temporaryDatabase(t);
  const numberDb = createBuilderProductMetadataDatabase(numberPath);
  const saved = numberDb.record_project_revision_receipt(request());
  numberDb.close();
  {
    const raw = new DatabaseSync(numberPath);
    raw.prepare('UPDATE projects SET current_revision_number = 2 WHERE project_id = ?').run(PROJECT_ID);
    raw.close();
  }
  const numberTampered = createBuilderProductMetadataDatabase(numberPath);
  assert.throws(
    () => numberTampered.record_project_revision_receipt(request({
      idempotencyIndex: 2,
      taskIndex: 11,
      runIndex: 12,
      reviewIndex: 13,
      turnIndex: 14,
      requestIndex: 15,
      candidateIndex: 16,
      commit: 'e'.repeat(40),
      tree: 'f'.repeat(40),
      parent: saved.receipt.commit_oid,
      candidateDigest: digest('e'),
      resultingTreeDigest: digest('f'),
      expected: saved.receipt.revision_receipt_digest,
      selectedAt: 60,
    })),
    assertDatabaseError('builder_product_metadata_integrity_failed'),
  );
  numberTampered.close();
  {
    const raw = new DatabaseSync(numberPath);
    try {
      assert.equal(raw.prepare('SELECT COUNT(*) AS count FROM project_revisions').get().count, 1);
      assert.equal(raw.prepare('SELECT COUNT(*) AS count FROM tasks').get().count, 1);
      assert.equal(raw.prepare('SELECT COUNT(*) AS count FROM runs').get().count, 1);
      assert.equal(raw.prepare('SELECT COUNT(*) AS count FROM reviews').get().count, 1);
    } finally {
      raw.close();
    }
  }
});

test('allows the bounded 1024 revision chain and rejects the 1025th before writing', (t) => {
  const filePath = temporaryDatabase(t);
  createBuilderProductMetadataDatabase(filePath).close();
  const fixture = seedRevisionChainFixture(filePath, 1024);
  const metadata = createBuilderProductMetadataDatabase(filePath);
  assert.equal(fixture.lastReceipt.revision_number, 1024);
  assert.equal(
    metadata.load_current_project_revision({ project_id: PROJECT_ID }).receipt.revision_receipt_digest,
    fixture.lastReceipt.revision_receipt_digest,
  );
  assert.throws(
    () => metadata.record_project_revision_receipt(request({
      idempotencyIndex: 1025,
      taskIndex: 1025,
      runIndex: 3025,
      reviewIndex: 5025,
      reviewerIndex: 4,
      turnIndex: 7025,
      requestIndex: 9025,
      candidateIndex: 1025,
      commit: oid(1025),
      tree: oid(11025),
      parent: fixture.parentOid,
      candidateDigest: digestFromIndex(1025),
      resultingTreeDigest: digestFromIndex(11025),
      expected: fixture.previousReceiptDigest,
      selectedAt: 1025,
    })),
    assertDatabaseError('builder_product_metadata_resource_exceeded'),
  );
  assert.equal(
    metadata.load_current_project_revision({ project_id: PROJECT_ID }).receipt.revision_receipt_digest,
    fixture.lastReceipt.revision_receipt_digest,
  );
  metadata.close();

  const raw = new DatabaseSync(filePath);
  try {
    assert.equal(raw.prepare('SELECT COUNT(*) AS count FROM project_revisions').get().count, 1024);
    assert.equal(raw.prepare('SELECT COUNT(*) AS count FROM tasks').get().count, 1024);
    assert.equal(raw.prepare('SELECT COUNT(*) AS count FROM runs').get().count, 1024);
    assert.equal(raw.prepare('SELECT COUNT(*) AS count FROM reviews').get().count, 1024);
  } finally {
    raw.close();
  }
});

test('validates the complete revision chain on current read', (t) => {
  const filePath = temporaryDatabase(t);
  const metadata = createBuilderProductMetadataDatabase(filePath);
  const first = metadata.record_project_revision_receipt(request());
  const second = metadata.record_project_revision_receipt(request({
    idempotencyIndex: 2,
    taskIndex: 11,
    runIndex: 12,
    reviewIndex: 13,
    turnIndex: 14,
    requestIndex: 15,
    candidateIndex: 16,
    commit: 'e'.repeat(40),
    tree: 'f'.repeat(40),
    parent: first.receipt.commit_oid,
    candidateDigest: digest('e'),
    resultingTreeDigest: digest('f'),
    expected: first.receipt.revision_receipt_digest,
    selectedAt: 60,
  }));
  metadata.close();

  let drifted;
  {
    const raw = new DatabaseSync(filePath);
    raw.exec('PRAGMA foreign_keys = OFF');
    drifted = createRevisionReceipt({
      ...receiptBody(second.receipt),
      parent_oid: '0'.repeat(40),
    });
    raw.prepare(
      `UPDATE project_revisions
        SET revision_receipt_digest = ?, parent_oid = ?
        WHERE project_id = ? AND revision_receipt_digest = ?`,
    ).run(
      drifted.revision_receipt_digest,
      drifted.parent_oid,
      PROJECT_ID,
      second.receipt.revision_receipt_digest,
    );
    raw.prepare('UPDATE tasks SET base_commit_oid = ? WHERE project_id = ? AND task_id = ?')
      .run(drifted.parent_oid, PROJECT_ID, second.receipt.task_id);
    raw.prepare('UPDATE projects SET current_revision_receipt_digest = ? WHERE project_id = ?')
      .run(drifted.revision_receipt_digest, PROJECT_ID);
    raw.prepare('UPDATE idempotency_records SET result_digest = ? WHERE project_id = ? AND result_digest = ?')
      .run(drifted.revision_receipt_digest, PROJECT_ID, second.receipt.revision_receipt_digest);
    raw.close();
  }

  const parentDrift = createBuilderProductMetadataDatabase(filePath);
  assert.throws(
    () => parentDrift.record_project_revision_receipt(request({
      idempotencyIndex: 3,
      taskIndex: 21,
      runIndex: 22,
      reviewIndex: 23,
      turnIndex: 24,
      requestIndex: 25,
      candidateIndex: 26,
      commit: '2'.repeat(40),
      tree: '3'.repeat(40),
      parent: drifted.commit_oid,
      candidateDigest: digest('2'),
      resultingTreeDigest: digest('3'),
      expected: drifted.revision_receipt_digest,
      selectedAt: 70,
    })),
    assertDatabaseError('builder_product_metadata_integrity_failed'),
  );
  assert.throws(
    () => parentDrift.load_current_project_revision({ project_id: PROJECT_ID }),
    assertDatabaseError('builder_product_metadata_integrity_failed'),
  );
  parentDrift.close();
  {
    const raw = new DatabaseSync(filePath);
    try {
      assert.equal(raw.prepare('SELECT COUNT(*) AS count FROM project_revisions').get().count, 2);
      assert.equal(raw.prepare('SELECT COUNT(*) AS count FROM tasks').get().count, 2);
      assert.equal(raw.prepare('SELECT COUNT(*) AS count FROM runs').get().count, 2);
      assert.equal(raw.prepare('SELECT COUNT(*) AS count FROM reviews').get().count, 2);
    } finally {
      raw.close();
    }
  }

  const brokenPath = temporaryDatabase(t);
  const broken = createBuilderProductMetadataDatabase(brokenPath);
  const base = broken.record_project_revision_receipt(request());
  const tip = broken.record_project_revision_receipt(request({
    idempotencyIndex: 2,
    taskIndex: 11,
    runIndex: 12,
    reviewIndex: 13,
    turnIndex: 14,
    requestIndex: 15,
    candidateIndex: 16,
    commit: 'e'.repeat(40),
    tree: 'f'.repeat(40),
    parent: base.receipt.commit_oid,
    candidateDigest: digest('e'),
    resultingTreeDigest: digest('f'),
    expected: base.receipt.revision_receipt_digest,
    selectedAt: 60,
  }));
  broken.close();
  {
    const raw = new DatabaseSync(brokenPath);
    const missingPrevious = createRevisionReceipt({
      ...receiptBody(tip.receipt),
      previous_revision_receipt_digest: digest('9'),
    });
    raw.exec('PRAGMA foreign_keys = OFF');
    raw.prepare(
      `UPDATE project_revisions
        SET revision_receipt_digest = ?, previous_revision_receipt_digest = ?
        WHERE project_id = ? AND revision_receipt_digest = ?`,
    ).run(
      missingPrevious.revision_receipt_digest,
      missingPrevious.previous_revision_receipt_digest,
      PROJECT_ID,
      tip.receipt.revision_receipt_digest,
    );
    raw.prepare('UPDATE projects SET current_revision_receipt_digest = ? WHERE project_id = ?')
      .run(missingPrevious.revision_receipt_digest, PROJECT_ID);
    raw.close();
  }
  assert.throws(
    () => createBuilderProductMetadataDatabase(brokenPath),
    assertDatabaseError('builder_product_metadata_integrity_failed'),
  );
});

test('rejects same-commit competing receipts and rolls back partial facts', (t) => {
  const filePath = temporaryDatabase(t);
  const metadata = createBuilderProductMetadataDatabase(filePath);
  const first = metadata.record_project_revision_receipt(request());
  assert.throws(
    () => metadata.record_project_revision_receipt(request({
      idempotencyIndex: 2,
      taskIndex: 11,
      runIndex: 12,
      reviewIndex: 13,
      turnIndex: 14,
      requestIndex: 15,
      candidateIndex: 16,
      commit: first.receipt.commit_oid,
      tree: 'f'.repeat(40),
      parent: first.receipt.commit_oid,
      candidateDigest: digest('e'),
      resultingTreeDigest: digest('f'),
      expected: first.receipt.revision_receipt_digest,
      selectedAt: 60,
    })),
    assertDatabaseError('builder_product_metadata_integrity_failed'),
  );
  assert.deepEqual(metadata.load_current_project_revision({ project_id: PROJECT_ID }).receipt, first.receipt);
  metadata.close();

  const raw = new DatabaseSync(filePath);
  try {
    assert.equal(raw.prepare('SELECT COUNT(*) AS count FROM runs').get().count, 1);
    assert.equal(raw.prepare('SELECT COUNT(*) AS count FROM reviews').get().count, 1);
    assert.equal(raw.prepare('SELECT COUNT(*) AS count FROM tasks').get().count, 1);
  } finally {
    raw.close();
  }
});

test('appends, replays, and restores one canonical conversation chain from SQLite', (t) => {
  const filePath = temporaryDatabase(t);
  const initial = initialConversationEvents();
  let metadata = createBuilderProductMetadataDatabase(filePath);
  const appended = metadata.append_conversation_events(appendConversationRequest(initial));
  assert.equal(appended.result_version, 'builder-conversation-authority-result.v1');
  assert.equal(appended.operation, 'events_appended');
  assert.deepEqual(appended.action_events, initial);
  assert.deepEqual(appended.current_head, prior(initial[1]));
  assert.equal(appended.snapshot.event_count, 2);
  assert.equal(appended.snapshot.turns[0].runs[0].status, 'running');
  assert.equal(appended.metadata_evidence.database_id, 'builder-product-metadata-database.v3');
  assert.equal(appended.metadata_evidence.transaction,
    'conversation_expected_head_append_readback');
  assert.equal(Object.isFrozen(appended), true);

  const replayed = metadata.append_conversation_events(appendConversationRequest(initial));
  assert.equal(replayed.operation, 'events_replayed');
  assert.deepEqual(replayed.action_events, initial);
  assert.deepEqual(replayed.current_head, prior(initial[1]));
  metadata.close();

  metadata = createBuilderProductMetadataDatabase(filePath);
  const restored = metadata.load_conversation({
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
  });
  assert.equal(restored.operation, 'conversation_loaded');
  assert.deepEqual(restored.events, initial);
  assert.deepEqual(restored.current_head, prior(initial[1]));
  assert.equal(restored.snapshot.turns[0].runs[0].status, 'running');
  metadata.close();
});

test('appends a terminal batch with expected-head CAS and rejects stale or drifting commands', (t) => {
  const filePath = temporaryDatabase(t);
  const metadata = createBuilderProductMetadataDatabase(filePath);
  const initial = initialConversationEvents();
  metadata.append_conversation_events(appendConversationRequest(initial));
  const terminal = terminalConversationEvents(initial);
  const completed = metadata.append_conversation_events(
    appendConversationRequest(terminal, prior(initial[1])),
  );
  assert.equal(completed.operation, 'events_appended');
  assert.deepEqual(completed.current_head, prior(terminal[1]));
  assert.equal(completed.snapshot.turns[0].runs[0].status, 'completed');
  assert.equal(completed.snapshot.turns[0].runs[0].terminal_status, 'succeeded');
  assert.equal(completed.snapshot.turns[0].messages[1].text,
    'The draft is ready to review.');

  assert.throws(
    () => metadata.append_conversation_events(appendConversationRequest(
      terminalConversationEvents(initial),
      prior(initial[0]),
    )),
    assertDatabaseError('builder_product_metadata_invalid'),
  );

  const driftSubmitted = conversationEvent(1, 'turn_submitted', {
    ...initial[0].payload,
    message: {
      ...initial[0].payload.message,
      text: 'Build a different project with the same command identity.',
    },
  });
  const drift = [
    driftSubmitted,
    conversationEvent(2, 'run_started', initial[1].payload, driftSubmitted),
  ];
  assert.throws(
    () => metadata.append_conversation_events(appendConversationRequest(drift)),
    assertDatabaseError('builder_product_metadata_idempotency_conflict'),
  );
  metadata.close();
});

test('indexes candidate terminal events by draft id and restores them after restart', (t) => {
  const filePath = temporaryDatabase(t);
  const initial = initialConversationEvents();
  const terminal = candidateTerminalConversationEvents(initial);
  let metadata = createBuilderProductMetadataDatabase(filePath);
  metadata.append_conversation_events(appendConversationRequest(initial));
  metadata.append_conversation_events(appendConversationRequest(terminal, prior(initial[1])));

  const loaded = metadata.load_conversation_candidate_by_draft({ draft_id: DRAFT_ID });
  assert.equal(loaded.operation, 'conversation_loaded');
  assert.deepEqual(loaded.current_head, prior(terminal[1]));
  assert.equal(loaded.snapshot.turns[0].outcome, 'candidate_ready');
  assert.equal(loaded.snapshot.turns[0].runs[0].candidate_result.draft_id, DRAFT_ID);
  assert.throws(
    () => metadata.load_conversation_candidate_by_draft({
      draft_id: `builder-generation-draft:${'9'.repeat(64)}`,
    }),
    assertDatabaseError('builder_product_metadata_not_found'),
  );
  metadata.close();

  metadata = createBuilderProductMetadataDatabase(filePath);
  assert.deepEqual(
    metadata.load_conversation_candidate_by_draft({ draft_id: DRAFT_ID }),
    loaded,
  );
  metadata.close();
});

test('fails closed when canonical conversation event bytes are corrupted', (t) => {
  const filePath = temporaryDatabase(t);
  const initial = initialConversationEvents();
  const metadata = createBuilderProductMetadataDatabase(filePath);
  metadata.append_conversation_events(appendConversationRequest(initial));
  metadata.close();

  const raw = new DatabaseSync(filePath);
  raw.exec('PRAGMA foreign_keys = OFF');
  raw.prepare(`UPDATE conversation_events SET record_json = ?
    WHERE project_id = ? AND conversation_id = ? AND sequence = 2`).run(
    JSON.stringify({ secret: 'credential-marker' }),
    PROJECT_ID,
    CONVERSATION_ID,
  );
  raw.close();

  const reopened = createBuilderProductMetadataDatabase(filePath);
  assert.throws(
    () => reopened.load_conversation({
      project_id: PROJECT_ID,
      conversation_id: CONVERSATION_ID,
    }),
    assertDatabaseError('builder_product_metadata_integrity_failed', ['credential-marker']),
  );
  reopened.close();
});

test('separates invalid input from missing current and cross-project drift', (t) => {
  const missingPath = temporaryDatabase(t);
  const missing = createBuilderProductMetadataDatabase(missingPath);
  assert.throws(
    () => missing.load_current_project_revision({ project_id: PROJECT_ID }),
    assertDatabaseError('builder_product_metadata_not_found'),
  );
  missing.close();

  const invalidPath = temporaryDatabase(t);
  const metadata = createBuilderProductMetadataDatabase(invalidPath);
  assert.throws(
    () => metadata.record_project_revision_receipt(request({ parent: 'f'.repeat(40), expected: null })),
    assertDatabaseError('builder_product_metadata_invalid'),
  );
  const crossProject = request({ projectId: OTHER_PROJECT_ID });
  crossProject.conversation.project_id = PROJECT_ID;
  assert.throws(
    () => metadata.record_project_revision_receipt(crossProject),
    assertDatabaseError('builder_product_metadata_invalid'),
  );
  metadata.close();
});

test('rejects retired v2 metadata and fails closed on proxy, accessor, and symbol input', (t) => {
  const versionPath = temporaryDatabase(t);
  {
    const raw = new DatabaseSync(versionPath);
    raw.exec('PRAGMA user_version = 2');
    raw.close();
  }
  assert.throws(
    () => createBuilderProductMetadataDatabase(versionPath),
    assertDatabaseError('builder_product_metadata_integrity_failed'),
  );

  const filePath = temporaryDatabase(t);
  const metadata = createBuilderProductMetadataDatabase(filePath);
  let traps = 0;
  assert.throws(
    () => metadata.record_project_revision_receipt(new Proxy(request(), {
      ownKeys() {
        traps += 1;
        return [];
      },
    })),
    assertDatabaseError('builder_product_metadata_invalid'),
  );
  assert.equal(traps, 0);

  const accessor = request();
  Object.defineProperty(accessor.git_candidate_receipt, 'candidate_digest', {
    enumerable: true,
    get: () => { throw new Error('credential-marker'); },
  });
  assert.throws(
    () => metadata.record_project_revision_receipt(accessor),
    assertDatabaseError('builder_product_metadata_invalid', ['credential-marker']),
  );

  const withSymbol = request();
  withSymbol.run[Symbol('hidden')] = true;
  assert.throws(
    () => metadata.record_project_revision_receipt(withSymbol),
    assertDatabaseError('builder_product_metadata_invalid'),
  );
  metadata.close();
});

test('exposes only exact frozen redacted APIs and no old project or source authority', (t) => {
  const filePath = temporaryDatabase(t);
  const metadata = createBuilderProductMetadataDatabase(filePath);
  assert.deepEqual(Reflect.ownKeys(metadata).sort(), [
    'append_conversation_events',
    'close',
    'list_current_project_revisions',
    'list_project_revisions',
    'load_conversation',
    'load_conversation_candidate_by_draft',
    'load_current_project_revision',
    'load_project_identity',
    'load_project_revision',
    'record_project_revision_receipt',
  ]);
  assert.equal(Object.isFrozen(metadata), true);
  assert.throws(
    () => metadata.close('extra'),
    assertDatabaseError('builder_product_metadata_invalid'),
  );
  metadata.close();

  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-product-metadata-database.cjs'),
    'utf8',
  );
  assert.doesNotMatch(source, /builder-project-revision-repository|ipcMain|ipcRenderer|preload|main\.cjs|dugite|fetch\s*\(|localStorage|sessionStorage|credential_secret|receipt_json/iu);
});
