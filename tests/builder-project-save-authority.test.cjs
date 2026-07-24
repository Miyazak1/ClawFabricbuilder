'use strict';

const assert = require('node:assert/strict');
const nodeCrypto = require('node:crypto');
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
  createBuilderConversationMainService,
} = require('../electron/builder-conversation-main-service.cjs');
const {
  BUILDER_PROJECT_BASE_REVISION_EVIDENCE_VERSION,
  createBuilderCodeChangeCandidate,
} = require('../electron/builder-code-change-kernel.cjs');
const {
  createDefaultBuilderGitProjectRepository,
} = require('../electron/builder-git-project-repository.cjs');
const {
  createBuilderGitCandidateVerificationReceipt,
} = require('../electron/builder-git-receipt-contract.cjs');
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
const candidateStartEvents = new WeakMap();
const candidateActionStart = new WeakMap();
const candidateFullEvents = new WeakMap();
const candidateActionEvents = new WeakMap();
const candidateGitReceipts = new WeakMap();
const pendingProofGitReceipts = new WeakMap();

function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map(
    (key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`,
  ).join(',')}}`;
}

function digest(value) {
  return `sha256:${nodeCrypto.createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')}`;
}

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
  priorEvents = [],
  operations,
}) {
  const turnId = id('turn', index);
  const taskId = id('task', index);
  const runId = id('run', index);
  let events = [...priorEvents];
  const actionStart = events.length;
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
  const value = createBuilderCodeChangeCandidate({
    conversation_events: events,
    turn_id: turnId,
    run_id: runId,
    base_revision_evidence: baseEvidence,
    base_source_tree: base,
    operations,
  });
  candidateStartEvents.set(value, events);
  candidateActionStart.set(value, actionStart);
  return value;
}

function pending(candidateValue, {
  draft = '1',
  request = 1,
  title = 'Saved project',
  summary = 'A project saved by explicit acceptance.',
  gitReceipt = null,
} = {}) {
  const provisional = gitReceipt ?? {
    receipt_version: 'builder-git-candidate-receipt.v1',
    repository_version: 'builder-git-project-repository.v1',
    project_id: candidateValue.project_id,
    conversation_id: candidateValue.conversation_id,
    turn_id: candidateValue.turn_id,
    task_id: candidateValue.task_id,
    run_id: candidateValue.run_id,
    request_id: gitRequestId(request),
    candidate_id: candidateValue.candidate_id,
    candidate_digest: candidateValue.candidate_digest,
    resulting_tree_digest: candidateValue.resulting_tree_digest,
    semantic_identity_digest: `sha256:${'a'.repeat(64)}`,
    verification_receipt_digest: `sha256:${'0'.repeat(64)}`,
    object_format: 'sha1',
    commit_oid: '1'.repeat(40),
    tree_oid: '2'.repeat(40),
    parent_oid: candidateValue.base_revision_evidence?.commit_oid ?? null,
    expected_base_oid: candidateValue.base_revision_evidence?.commit_oid ?? null,
    code_authority: 'git_commit_candidate',
    product_revision_admission: 'not_recorded',
    replay: false,
  };
  const receipt = gitReceipt ?? {
    ...provisional,
    verification_receipt_digest: digest(
      createBuilderGitCandidateVerificationReceipt(provisional),
    ),
  };
  const draftId = `builder-generation-draft:${draft.repeat(64)}`;
  let events = [...candidateStartEvents.get(candidateValue)];
  events = append(events, 'run_completed', {
    turn_id: candidateValue.turn_id,
    run_id: candidateValue.run_id,
    terminal_status: 'succeeded',
    result_kind: 'candidate',
    result_digest: candidateValue.candidate_digest,
    assistant_message: {
      message_id: id('message', request + 100),
      text: summary,
    },
    candidate_result: {
      draft_id: draftId,
      title,
      summary,
      git_candidate_receipt: receipt,
    },
  }, request * 2 + 100);
  events = append(events, 'turn_completed', {
    turn_id: candidateValue.turn_id,
    run_id: candidateValue.run_id,
    outcome: 'candidate_ready',
  }, request * 2 + 101);
  candidateFullEvents.set(candidateValue, events);
  candidateActionEvents.set(
    candidateValue,
    events.slice(candidateActionStart.get(candidateValue)),
  );
  candidateGitReceipts.set(candidateValue, receipt);
  const baseRevision = candidateValue.run_binding.base_revision;
  const proof = {
    proof_version: 'builder-generation-pending-candidate-proof.v1',
    project_id: candidateValue.project_id,
    conversation_id: candidateValue.conversation_id,
    turn_id: candidateValue.turn_id,
    task_id: candidateValue.task_id,
    run_id: candidateValue.run_id,
    request_digest: candidateValue.request_digest,
    git_request_id: receipt.request_id,
    candidate_id: candidateValue.candidate_id,
    candidate_digest: candidateValue.candidate_digest,
    resulting_tree_digest: candidateValue.resulting_tree_digest,
    expected_base_oid: receipt.expected_base_oid,
    base_revision: baseRevision === null ? null : { ...baseRevision },
  };
  pendingProofGitReceipts.set(proof, receipt);
  return {
    result_version: 'builder-generation-pending-draft.v2',
    draft_id: draftId,
    restart_restore: 'not_persisted',
    conversation_event_admission: 'sqlite_recorded',
    git_request_id: receipt.request_id,
    title,
    summary,
    conversation_head: {
      sequence: candidateFullEvents.get(candidateValue).at(-1).sequence,
      event_id: candidateFullEvents.get(candidateValue).at(-1).event_id,
      event_digest: candidateFullEvents.get(candidateValue).at(-1).event_digest,
    },
    candidate_proof: proof,
  };
}

function conversationServiceFor(draft) {
  return {
    verify_candidate(input) {
      const candidateValue = draft.candidate_proof;
      assert.deepEqual(input, {
        project_id: candidateValue.project_id,
        conversation_id: candidateValue.conversation_id,
        turn_id: candidateValue.turn_id,
        task_id: candidateValue.task_id,
        run_id: candidateValue.run_id,
        candidate_digest: candidateValue.candidate_digest,
        conversation_head: draft.conversation_head,
      });
      return {
        verification_version: 'builder-conversation-candidate-verification.v1',
        ...input,
        candidate_result: {
          draft_id: draft.draft_id,
          title: draft.title,
          summary: draft.summary,
          git_candidate_receipt: pendingProofGitReceipts.get(candidateValue),
        },
        verification_admission: 'sqlite_replay_verified',
      };
    },
  };
}

function projectIdentityResult(createdAtMs = 1) {
  return {
    result_version: 'builder-product-metadata-result.v3',
    operation: 'project_identity_loaded',
    project: {
      project_id: PROJECT_ID,
      created_at_ms: createdAtMs,
    },
    metadata_evidence: {},
  };
}

function appendCandidateConversation(metadata, candidateValue, recordedAtMs) {
  const existing = (() => {
    try {
      return metadata.load_conversation({
        project_id: candidateValue.project_id,
        conversation_id: candidateValue.conversation_id,
      });
    } catch (error) {
      if (error.code === 'builder_product_metadata_not_found') return null;
      throw error;
    }
  })();
  return metadata.append_conversation_events({
    project: {
      project_id: candidateValue.project_id,
      created_at_ms: existing?.conversation.created_at_ms ?? recordedAtMs,
    },
    conversation: {
      project_id: candidateValue.project_id,
      conversation_id: candidateValue.conversation_id,
      created_at_ms: existing?.conversation.created_at_ms ?? recordedAtMs,
    },
    expected_head: existing?.current_head ?? null,
    events: candidateActionEvents.get(candidateValue),
    recorded_at_ms: recordedAtMs,
  });
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
      if (!value || value.candidate_proof.candidate_digest !== body.candidate_digest) {
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
  const value = realAuthorities(t);
  const firstCandidate = candidate({
    index: 1,
    operations: [
      { operation: 'upsert', path: 'index.html', content: '<main>Hello</main>\n' },
      { operation: 'upsert', path: 'styles.css', content: 'main { color: green; }\n' },
      { operation: 'upsert', path: 'src/app.js', content: 'document.title = "Hello";\n' },
    ],
  });
  const firstGitReceipt = await value.git.persist_candidate_commit({
    request_id: gitRequestId(1),
    expected_base_oid: null,
    candidate: firstCandidate,
  });
  const firstPending = pending(firstCandidate, { gitReceipt: firstGitReceipt });
  const generationDrafts = draftsStore(firstPending);
  const stages = [];
  appendCandidateConversation(value.metadata, firstCandidate, 10_000);
  const conversationService = createBuilderConversationMainService({
    metadataAuthority: value.metadata,
    createUuid: uuidFactory(),
    nowMs: () => 10_000,
  });
  const gitAuthority = {
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
    conversationService,
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
  assert.equal(saved.save_evidence.conversation_event_admission, 'sqlite_recorded');
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
    priorEvents: candidateFullEvents.get(firstCandidate),
    operations: [
      { operation: 'upsert', path: 'src/app.js', content: 'document.title = "Updated";\n' },
      { operation: 'upsert', path: 'README.md', content: '# Updated\n' },
    ],
  });
  const updateGitReceipt = await value.git.persist_candidate_commit({
    request_id: gitRequestId(2),
    expected_base_oid: current.product_revision_receipt.commit_oid,
    candidate: updateCandidate,
  });
  const updatePending = pending(updateCandidate, {
    draft: '2',
    request: 2,
    title: 'Updated project',
    gitReceipt: updateGitReceipt,
  });
  appendCandidateConversation(value.metadata, updateCandidate, 20_000);
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
  let releaseVerify;
  const verifyGate = new Promise((resolve) => { releaseVerify = resolve; });
  let verifyCalls = 0;
  let recordCalls = 0;
  const gitReceipt = candidateGitReceipts.get(value);
  const verification = createBuilderGitCandidateVerificationReceipt(gitReceipt);
  const revisionDigest = `sha256:${'c'.repeat(64)}`;
  const saveAuthority = createBuilderProjectSaveAuthority({
    generationDrafts,
    conversationService: conversationServiceFor(draft),
    gitAuthority: {
      async verify_candidate_receipt(receipt) {
        verifyCalls += 1;
        assert.deepEqual(receipt, gitReceipt);
        await verifyGate;
        return verification;
      },
    },
    metadataAuthority: {
      load_project_identity() { return projectIdentityResult(25_000); },
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
  releaseVerify();
  assert.deepEqual(await first, await second);
  assert.equal(verifyCalls, 1);
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
  const gitReceipt = candidateGitReceipts.get(value);
  const verification = createBuilderGitCandidateVerificationReceipt(gitReceipt);
  const saveAuthority = createBuilderProjectSaveAuthority({
    generationDrafts,
    conversationService: conversationServiceFor(draft),
    gitAuthority: {
      async verify_candidate_receipt(receipt) {
        calls.git.push(receipt);
        return verification;
      },
    },
    metadataAuthority: {
      load_project_identity() { return projectIdentityResult(50_000); },
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
  assert.deepEqual(calls.git[0], calls.git[1]);
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
    conversationService: conversationServiceFor(draft),
    gitAuthority: {
      async verify_candidate_receipt(receipt) {
        return createBuilderGitCandidateVerificationReceipt(receipt);
      },
    },
    metadataAuthority: {
      load_project_identity() { return projectIdentityResult(60_000); },
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
    conversationService: conversationServiceFor(draft),
    gitAuthority: { verify_candidate_receipt() {} },
    metadataAuthority: { load_project_identity() {}, record_project_revision_receipt() {} },
    projectReadAuthority: { load_current() {} },
    createUuid: uuidFactory(),
    nowMs: () => 1,
  });
  await assert.rejects(
    saveAuthority.save({ draft_id: 'bad private draft' }),
    expectSaveError('builder_project_save_invalid'),
  );

  let driftVerifyCalls = 0;
  const driftAuthority = createBuilderProjectSaveAuthority({
    generationDrafts,
    conversationService: {
      verify_candidate(input) {
        return {
          verification_version: 'builder-conversation-candidate-verification.v1',
          ...input,
          project_id: 'builder-project:223e4567-e89b-42d3-a456-426614174000',
          verification_admission: 'sqlite_replay_verified',
        };
      },
    },
    gitAuthority: {
      verify_candidate_receipt() {
        driftVerifyCalls += 1;
      },
    },
    metadataAuthority: {
      load_project_identity() {},
      record_project_revision_receipt() {},
    },
    projectReadAuthority: { load_current() {} },
    createUuid: uuidFactory(),
    nowMs: () => 1,
  });
  await assert.rejects(
    driftAuthority.save({ draft_id: draft.draft_id }),
    expectSaveError('builder_project_save_invalid'),
  );
  assert.equal(driftVerifyCalls, 0);

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
    conversationService: conversationServiceFor(draft),
    gitAuthority: {
      verify_candidate_receipt() { throw hostile; },
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
    conversation_head: new Proxy({}, {
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
