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
  BUILDER_PROJECT_BASE_REVISION_EVIDENCE_VERSION,
  createBuilderCodeChangeCandidate,
} = require('../electron/builder-code-change-kernel.cjs');
const {
  createDefaultBuilderGitProjectRepository,
} = require('../electron/builder-git-project-repository.cjs');
const {
  createBuilderProductMetadataDatabase,
} = require('../electron/builder-product-metadata-database.cjs');
const {
  createBuilderProjectReadAuthority,
} = require('../electron/builder-project-read-authority.cjs');
const {
  BUILDER_PROJECT_SAVE_AUTHORITY_VERSION,
  BuilderProjectSaveAuthorityError,
  createBuilderProjectSaveAuthority,
} = require('../electron/builder-project-save-authority.cjs');
const {
  createBuilderProjectSourceTree,
} = require('../electron/builder-project-source-tree.cjs');

const UUID = '123e4567-e89b-42d3-a456-426614174000';
const PROJECT_ID = `builder-project:${UUID}`;
const CONVERSATION_ID = `builder-conversation:${UUID}`;
const ZERO_DIGEST = `sha256:${'0'.repeat(64)}`;

function uuid(index) {
  return `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
}

function id(kind, index) {
  return `builder-${kind}:${uuid(index)}`;
}

function gitRequestId(index) {
  return `builder-git-request:${uuid(index)}`;
}

function temporaryRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-builder-save-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function append(events, eventType, payload, commandIndex) {
  const previous = events.at(-1) ?? null;
  return [...events, createBuilderConversationEvent({
    record_version: CONVERSATION_EVENT_VERSION,
    record_kind: CONVERSATION_EVENT_KIND,
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    sequence: events.length + 1,
    command_id: id('command', commandIndex),
    event_type: eventType,
    previous_event: previous === null ? null : {
      sequence: previous.sequence,
      event_id: previous.event_id,
      event_digest: previous.event_digest,
    },
    payload,
    authority: { ...CONVERSATION_AUTHORITY },
  })];
}

function candidate({
  index,
  base = createBuilderProjectSourceTree({ files: [] }),
  baseRevision = null,
  baseEvidence = null,
  operations,
}) {
  const turnId = id('turn', index);
  const taskId = id('task', index);
  const runId = id('run', index);
  let events = [];
  events = append(events, 'turn_submitted', {
    message: { message_id: id('message', index), text: 'Save this draft.' },
    turn_id: turnId,
    mode: 'work',
    task: { task_id: taskId, title: baseRevision === null ? 'Create Builder project' : 'Update Builder project' },
    base_revision: baseRevision,
  }, index * 2 - 1);
  events = append(events, 'run_started', {
    turn_id: turnId,
    run_id: runId,
    task_id: taskId,
    attempt_number: 1,
    retry_of_run_id: null,
    input_digest: ZERO_DIGEST,
  }, index * 2);
  return createBuilderCodeChangeCandidate({
    conversation_events: events,
    turn_id: turnId,
    run_id: runId,
    base_revision_evidence: baseEvidence,
    base_source_tree: base,
    operations,
  });
}

function pending(candidateValue, {
  draft = '1',
  request = 1,
  title = 'Saved project',
  summary = 'A project saved by explicit acceptance.',
} = {}) {
  return {
    result_version: 'builder-generation-pending-draft.v1',
    draft_id: `builder-generation-draft:${draft.repeat(64)}`,
    restart_restore: 'not_persisted',
    conversation_event_admission: 'candidate_local_not_recorded',
    request: {
      version: 'builder-generation-request.v2',
      instruction: 'Save this draft.',
      existing_project_id: candidateValue.base_revision_evidence === null ? null : PROJECT_ID,
      request_digest: ZERO_DIGEST,
    },
    git_request_id: gitRequestId(request),
    title,
    summary,
    conversation_events: candidateValue.run_binding.conversation_head.event_digest
      ? [{}, {}]
      : [{}, {}],
    candidate: candidateValue,
  };
}

function draftsStore(initialPending) {
  const drafts = new Map([[initialPending.draft_id, initialPending]]);
  const released = [];
  return {
    released,
    replace(next) { drafts.set(next.draft_id, next); },
    read_pending_draft({ draft_id: draftId }) {
      const value = drafts.get(draftId);
      if (!value) {
        const error = new Error('missing private draft');
        error.code = 'builder_generation_service_unavailable';
        throw error;
      }
      return value;
    },
    release_pending_draft(body) {
      released.push(body);
      const value = drafts.get(body.draft_id);
      if (!value || value.candidate.candidate_digest !== body.candidate_digest) {
        const error = new Error('private release failure');
        error.code = 'builder_generation_draft_conflict';
        throw error;
      }
      drafts.delete(body.draft_id);
      return { released: true };
    },
  };
}

function uuidFactory() {
  let index = 100;
  return () => {
    index += 1;
    return uuid(index);
  };
}

function expectSaveError(code, forbidden = []) {
  return (error) => {
    assert.ok(error instanceof BuilderProjectSaveAuthorityError);
    assert.equal(error.code, code);
    const serialized = JSON.stringify({
      name: error.name,
      code: error.code,
      message: error.message,
      stack: error.stack,
    });
    assert.doesNotMatch(serialized, /private|credential|api\.deepseek|builder-generation-draft/u);
    for (const marker of forbidden) assert.doesNotMatch(serialized, new RegExp(marker, 'iu'));
    return true;
  };
}

function realAuthorities(t) {
  const root = temporaryRoot(t);
  let now = 1_750_000_000;
  const gitOptions = {
    projects_root: path.join(root, 'projects'),
    runtime_root: path.join(root, 'runtime'),
    now_seconds: () => now++,
  };
  fs.mkdirSync(path.join(root, 'metadata'), { recursive: true });
  const metadataPath = path.join(root, 'metadata', 'builder.sqlite');
  const git = createDefaultBuilderGitProjectRepository(gitOptions);
  const metadata = createBuilderProductMetadataDatabase(metadataPath);
  const read = createBuilderProjectReadAuthority({
    metadata_database: metadata,
    git_repository: git,
  });
  return {
    root,
    gitOptions,
    metadataPath,
    git,
    metadata,
    read,
  };
}

test('saves first and update drafts through real Git, SQLite, and restart read authority', async (t) => {
  const firstCandidate = candidate({
    index: 1,
    operations: [
      { operation: 'upsert', path: 'index.html', content: '<main>Hello</main>\n' },
      { operation: 'upsert', path: 'styles.css', content: 'main { color: green; }\n' },
      { operation: 'upsert', path: 'src/app.js', content: 'document.title = "Hello";\n' },
    ],
  });
  const firstPending = pending(firstCandidate);
  const generationDrafts = draftsStore(firstPending);
  const stages = [];
  const value = realAuthorities(t);
  const gitAuthority = {
    async persist_candidate_commit(request) {
      stages.push('git_persist');
      return value.git.persist_candidate_commit(request);
    },
    async verify_candidate_receipt(receipt) {
      stages.push('git_verify');
      return value.git.verify_candidate_receipt(receipt);
    },
    async read_verified_candidate(receipt) {
      return value.git.read_verified_candidate(receipt);
    },
  };
  const metadataAuthority = {
    load_project_identity(request) {
      stages.push('metadata_identity');
      return value.metadata.load_project_identity(request);
    },
    record_project_revision_receipt(request) {
      stages.push('metadata_record');
      return value.metadata.record_project_revision_receipt(request);
    },
  };
  const projectReadAuthority = {
    async load_current(request) {
      stages.push('read_current');
      return value.read.load_current(request);
    },
  };
  let acceptanceTime = 10_000;
  const saveAuthority = createBuilderProjectSaveAuthority({
    generationDrafts,
    gitAuthority,
    metadataAuthority,
    projectReadAuthority,
    createUuid: uuidFactory(),
    nowMs: () => acceptanceTime,
  });

  assert.equal(saveAuthority.authority_version, BUILDER_PROJECT_SAVE_AUTHORITY_VERSION);
  const saved = await saveAuthority.save({ draft_id: firstPending.draft_id }).catch((error) => {
    assert.fail(`save failed at stages:${stages.join(',')}:${error.code}`);
  });
  assert.equal(saved.result_version, 'builder-project-save-result.v1');
  assert.equal(saved.operation, 'draft_saved');
  assert.equal(saved.project_id, PROJECT_ID);
  assert.equal(saved.pending_draft_released, true);
  assert.equal(saved.save_evidence.conversation_event_admission, 'candidate_local_not_recorded');
  assert.equal(generationDrafts.released.length, 1);
  assert.doesNotMatch(JSON.stringify(saved), /operations|credential|conversation_events|api\.deepseek/u);

  const current = await value.read.load_current({ project_id: PROJECT_ID });
  acceptanceTime = 20_000;
  const baseEvidence = {
    evidence_version: BUILDER_PROJECT_BASE_REVISION_EVIDENCE_VERSION,
    project_id: PROJECT_ID,
    revision_receipt_digest: current.product_revision_receipt.revision_receipt_digest,
    commit_oid: current.product_revision_receipt.commit_oid,
    source_tree_digest: current.source_tree.source_tree_digest,
    verification_admission: 'git_sqlite_read_authority_verified',
  };
  const updateCandidate = candidate({
    index: 2,
    base: current.source_tree,
    baseRevision: {
      revision_receipt_digest: current.product_revision_receipt.revision_receipt_digest,
      commit_oid: current.product_revision_receipt.commit_oid,
    },
    baseEvidence,
    operations: [
      { operation: 'upsert', path: 'src/app.js', content: 'document.title = "Updated";\n' },
      { operation: 'upsert', path: 'README.md', content: '# Updated\n' },
    ],
  });
  const updatePending = pending(updateCandidate, { draft: '2', request: 2, title: 'Updated project' });
  generationDrafts.replace(updatePending);
  const updated = await saveAuthority.save({ draft_id: updatePending.draft_id });
  assert.equal(updated.project_id, PROJECT_ID);
  assert.notEqual(updated.revision_receipt_digest, saved.revision_receipt_digest);
  assert.equal(
    value.metadata.load_project_identity({ project_id: PROJECT_ID }).project.created_at_ms,
    10_000,
  );
  value.metadata.close();

  const restartedMetadata = createBuilderProductMetadataDatabase(value.metadataPath);
  const restartedRead = createBuilderProjectReadAuthority({
    metadata_database: restartedMetadata,
    git_repository: createDefaultBuilderGitProjectRepository(value.gitOptions),
  });
  const restored = await restartedRead.load_current({ project_id: PROJECT_ID });
  assert.equal(restored.product_revision_receipt.revision_receipt_digest, updated.revision_receipt_digest);
  assert.equal(restored.source_tree.source_tree_digest, updateCandidate.resulting_tree_digest);
  restartedMetadata.close();
});

test('coalesces concurrent saves for one draft and releases it exactly once', async () => {
  const value = candidate({
    index: 1,
    operations: [{ operation: 'upsert', path: 'src/app.js', content: 'export const ready = true;\n' }],
  });
  const draft = pending(value);
  const generationDrafts = draftsStore(draft);
  let releasePersist;
  const persistGate = new Promise((resolve) => { releasePersist = resolve; });
  let persistCalls = 0;
  let recordCalls = 0;
  const gitReceipt = {
    receipt_version: 'builder-git-candidate-receipt.v1',
    repository_version: 'builder-git-project-repository.v1',
    project_id: PROJECT_ID,
    conversation_id: value.conversation_id,
    turn_id: value.turn_id,
    task_id: value.task_id,
    run_id: value.run_id,
    request_id: draft.git_request_id,
    candidate_id: value.candidate_id,
    candidate_digest: value.candidate_digest,
    resulting_tree_digest: value.resulting_tree_digest,
    semantic_identity_digest: `sha256:${'a'.repeat(64)}`,
    verification_receipt_digest: `sha256:${'b'.repeat(64)}`,
    object_format: 'sha1',
    commit_oid: '1'.repeat(40),
    tree_oid: '2'.repeat(40),
    parent_oid: null,
    expected_base_oid: null,
    code_authority: 'git_commit_candidate',
    product_revision_admission: 'not_recorded',
    replay: false,
  };
  const verification = {
    receipt_version: 'builder-git-candidate-verification-receipt.v1',
    repository_version: gitReceipt.repository_version,
    project_id: PROJECT_ID,
    conversation_id: value.conversation_id,
    turn_id: value.turn_id,
    task_id: value.task_id,
    run_id: value.run_id,
    request_id: draft.git_request_id,
    candidate_id: value.candidate_id,
    candidate_digest: value.candidate_digest,
    expected_base_oid: null,
    commit_oid: gitReceipt.commit_oid,
    candidate_tree_oid: gitReceipt.tree_oid,
    resulting_tree_digest: value.resulting_tree_digest,
    semantic_identity_digest: gitReceipt.semantic_identity_digest,
    object_format: 'sha1',
    commit_ref_admission: 'verified',
    request_ref_admission: 'verified',
    commit_object_admission: 'verified',
    verification_admission: 'accepted',
  };
  const revisionDigest = `sha256:${'c'.repeat(64)}`;
  const saveAuthority = createBuilderProjectSaveAuthority({
    generationDrafts,
    gitAuthority: {
      async persist_candidate_commit() {
        persistCalls += 1;
        await persistGate;
        return gitReceipt;
      },
      async verify_candidate_receipt() { return verification; },
    },
    metadataAuthority: {
      load_project_identity() { throw new Error('new project should not load identity'); },
      record_project_revision_receipt() {
        recordCalls += 1;
        return {
          receipt: {
            project_id: PROJECT_ID,
            revision_receipt_digest: revisionDigest,
            commit_oid: gitReceipt.commit_oid,
          },
        };
      },
    },
    projectReadAuthority: {
      async load_current() {
        return {
          result_version: 'builder-project-read-result.v1',
          product_revision_receipt: {
            project_id: PROJECT_ID,
            revision_receipt_digest: revisionDigest,
            commit_oid: gitReceipt.commit_oid,
          },
          current: {},
          source_tree: {},
          git_candidate_receipt: {},
          git_verification_receipt: {},
          authority_evidence: {},
          operation: 'current_loaded',
        };
      },
    },
    createUuid: uuidFactory(),
    nowMs: () => 25_000,
  });

  const first = saveAuthority.save({ draft_id: draft.draft_id });
  const second = saveAuthority.save({ draft_id: draft.draft_id });
  assert.equal(first, second);
  releasePersist();
  assert.deepEqual(await first, await second);
  assert.equal(persistCalls, 1);
  assert.equal(recordCalls, 1);
  assert.equal(generationDrafts.released.length, 1);
});

test('keeps pending draft and stable attempt identity after metadata failure following Git replay', async () => {
  const value = candidate({
    index: 1,
    operations: [{ operation: 'upsert', path: 'index.html', content: '<main>Hello</main>\n' }],
  });
  const draft = pending(value);
  const generationDrafts = draftsStore(draft);
  const calls = { git: [], records: [] };
  let metadataFails = true;
  const gitReceipt = {
    receipt_version: 'builder-git-candidate-receipt.v1',
    repository_version: 'builder-git-project-repository.v1',
    project_id: PROJECT_ID,
    conversation_id: value.conversation_id,
    turn_id: value.turn_id,
    task_id: value.task_id,
    run_id: value.run_id,
    request_id: draft.git_request_id,
    candidate_id: value.candidate_id,
    candidate_digest: value.candidate_digest,
    resulting_tree_digest: value.resulting_tree_digest,
    semantic_identity_digest: `sha256:${'a'.repeat(64)}`,
    verification_receipt_digest: `sha256:${'b'.repeat(64)}`,
    object_format: 'sha1',
    commit_oid: '1'.repeat(40),
    tree_oid: '2'.repeat(40),
    parent_oid: null,
    expected_base_oid: null,
    code_authority: 'git_commit_candidate',
    product_revision_admission: 'not_recorded',
    replay: false,
  };
  const verification = {
    receipt_version: 'builder-git-candidate-verification-receipt.v1',
    repository_version: 'builder-git-project-repository.v1',
    project_id: PROJECT_ID,
    conversation_id: value.conversation_id,
    turn_id: value.turn_id,
    task_id: value.task_id,
    run_id: value.run_id,
    request_id: draft.git_request_id,
    candidate_id: value.candidate_id,
    candidate_digest: value.candidate_digest,
    expected_base_oid: null,
    commit_oid: gitReceipt.commit_oid,
    candidate_tree_oid: gitReceipt.tree_oid,
    resulting_tree_digest: value.resulting_tree_digest,
    semantic_identity_digest: gitReceipt.semantic_identity_digest,
    object_format: 'sha1',
    commit_ref_admission: 'verified',
    request_ref_admission: 'verified',
    commit_object_admission: 'verified',
    verification_admission: 'accepted',
  };
  const saveAuthority = createBuilderProjectSaveAuthority({
    generationDrafts,
    gitAuthority: {
      async persist_candidate_commit(request) {
        calls.git.push(request);
        return { ...gitReceipt, replay: calls.git.length > 1 };
      },
      async verify_candidate_receipt() { return verification; },
    },
    metadataAuthority: {
      load_project_identity() { throw new Error('new project should not load identity'); },
      record_project_revision_receipt(request) {
        calls.records.push(request);
        if (metadataFails) {
          const error = new Error('private sqlite marker');
          error.code = 'builder_product_metadata_unavailable';
          throw error;
        }
        return {
          receipt: {
            project_id: PROJECT_ID,
            revision_receipt_digest: `sha256:${'c'.repeat(64)}`,
            commit_oid: gitReceipt.commit_oid,
          },
        };
      },
    },
    projectReadAuthority: {
      async load_current() {
        return {
          result_version: 'builder-project-read-result.v1',
          operation: 'current_loaded',
          product_revision_receipt: {
            project_id: PROJECT_ID,
            revision_receipt_digest: `sha256:${'c'.repeat(64)}`,
            commit_oid: gitReceipt.commit_oid,
          },
          current: {},
          source_tree: {},
          git_candidate_receipt: {},
          git_verification_receipt: {},
          authority_evidence: {},
        };
      },
    },
    createUuid: uuidFactory(),
    nowMs: () => 50_000,
  });

  await assert.rejects(
    saveAuthority.save({ draft_id: draft.draft_id }),
    expectSaveError('builder_project_save_unavailable'),
  );
  assert.equal(generationDrafts.released.length, 0);
  metadataFails = false;
  await saveAuthority.save({ draft_id: draft.draft_id });
  assert.equal(calls.git.length, 2);
  assert.equal(calls.git[0].request_id, calls.git[1].request_id);
  assert.equal(calls.records[0].idempotency.idempotency_key, calls.records[1].idempotency.idempotency_key);
  assert.equal(calls.records[0].review.review_id, calls.records[1].review.review_id);
  assert.equal(calls.records[0].review.reviewed_at_ms, calls.records[1].review.reviewed_at_ms);
  assert.equal(generationDrafts.released.length, 1);
});

test('maps CAS conflict without releasing the pending draft', async () => {
  const value = candidate({
    index: 1,
    operations: [{ operation: 'upsert', path: 'index.html', content: '<main>Hello</main>\n' }],
  });
  const draft = pending(value);
  const generationDrafts = draftsStore(draft);
  const saveAuthority = createBuilderProjectSaveAuthority({
    generationDrafts,
    gitAuthority: {
      async persist_candidate_commit() {
        return {
          receipt_version: 'builder-git-candidate-receipt.v1',
          repository_version: 'builder-git-project-repository.v1',
          project_id: PROJECT_ID,
          conversation_id: value.conversation_id,
          turn_id: value.turn_id,
          task_id: value.task_id,
          run_id: value.run_id,
          request_id: draft.git_request_id,
          candidate_id: value.candidate_id,
          candidate_digest: value.candidate_digest,
          resulting_tree_digest: value.resulting_tree_digest,
          semantic_identity_digest: `sha256:${'a'.repeat(64)}`,
          verification_receipt_digest: `sha256:${'b'.repeat(64)}`,
          object_format: 'sha1',
          commit_oid: '1'.repeat(40),
          tree_oid: '2'.repeat(40),
          parent_oid: null,
          expected_base_oid: null,
          code_authority: 'git_commit_candidate',
          product_revision_admission: 'not_recorded',
          replay: false,
        };
      },
      async verify_candidate_receipt(receipt) {
        return {
          receipt_version: 'builder-git-candidate-verification-receipt.v1',
          repository_version: receipt.repository_version,
          project_id: receipt.project_id,
          conversation_id: receipt.conversation_id,
          turn_id: receipt.turn_id,
          task_id: receipt.task_id,
          run_id: receipt.run_id,
          request_id: receipt.request_id,
          candidate_id: receipt.candidate_id,
          candidate_digest: receipt.candidate_digest,
          expected_base_oid: receipt.expected_base_oid,
          commit_oid: receipt.commit_oid,
          candidate_tree_oid: receipt.tree_oid,
          resulting_tree_digest: receipt.resulting_tree_digest,
          semantic_identity_digest: receipt.semantic_identity_digest,
          object_format: receipt.object_format,
          commit_ref_admission: 'verified',
          request_ref_admission: 'verified',
          commit_object_admission: 'verified',
          verification_admission: 'accepted',
        };
      },
    },
    metadataAuthority: {
      load_project_identity() { throw new Error('new project should not load identity'); },
      record_project_revision_receipt() {
        const error = new Error('private current drift');
        error.code = 'builder_product_metadata_conflict';
        throw error;
      },
    },
    projectReadAuthority: { load_current() { throw new Error('must not read after conflict'); } },
    createUuid: uuidFactory(),
    nowMs: () => 60_000,
  });

  await assert.rejects(
    saveAuthority.save({ draft_id: draft.draft_id }),
    expectSaveError('builder_project_save_conflict'),
  );
  assert.equal(generationDrafts.released.length, 0);
});

test('rejects malformed save authority input with fixed redacted errors', async () => {
  assert.throws(
    () => createBuilderProjectSaveAuthority(new Proxy({}, {
      getPrototypeOf() { throw new Error('private proxy trap'); },
    })),
    expectSaveError('builder_project_save_invalid'),
  );

  const value = candidate({
    index: 1,
    operations: [{ operation: 'upsert', path: 'index.html', content: '<main>Hello</main>\n' }],
  });
  const draft = pending(value);
  const generationDrafts = draftsStore(draft);
  const saveAuthority = createBuilderProjectSaveAuthority({
    generationDrafts,
    gitAuthority: { persist_candidate_commit() {}, verify_candidate_receipt() {} },
    metadataAuthority: { load_project_identity() {}, record_project_revision_receipt() {} },
    projectReadAuthority: { load_current() {} },
    createUuid: uuidFactory(),
    nowMs: () => 1,
  });
  await assert.rejects(
    saveAuthority.save({ draft_id: 'bad private draft' }),
    expectSaveError('builder_project_save_invalid'),
  );

  let trapCalls = 0;
  const hostile = new Proxy({}, {
    getPrototypeOf() {
      trapCalls += 1;
      throw new Error('private proxy trap');
    },
    getOwnPropertyDescriptor() {
      trapCalls += 1;
      throw new Error('private descriptor trap');
    },
  });
  const hostileAuthority = createBuilderProjectSaveAuthority({
    generationDrafts,
    gitAuthority: {
      persist_candidate_commit() { throw hostile; },
      verify_candidate_receipt() {},
    },
    metadataAuthority: { load_project_identity() {}, record_project_revision_receipt() {} },
    projectReadAuthority: { load_current() {} },
    createUuid: uuidFactory(),
    nowMs: () => 1,
  });
  await assert.rejects(
    hostileAuthority.save({ draft_id: draft.draft_id }),
    expectSaveError('builder_project_save_unavailable'),
  );
  assert.equal(trapCalls, 0);

  generationDrafts.replace({
    ...draft,
    conversation_events: new Proxy([{}, {}], {
      get() {
        trapCalls += 1;
        throw new Error('private event trap');
      },
    }),
  });
  await assert.rejects(
    saveAuthority.save({ draft_id: draft.draft_id }),
    expectSaveError('builder_project_save_invalid'),
  );
  assert.equal(trapCalls, 0);
});
