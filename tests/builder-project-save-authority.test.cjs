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
  createDefaultBuilderGitCurrentProjection,
} = require('../electron/builder-git-current-projection.cjs');
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
const {
  inspectBuilderLocalWorkspaceSourceTree,
} = require('../electron/builder-local-workspace-source-tree.cjs');

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
const candidateWorkspaceBases = new Map();

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
    matched_signals: [payload.mode === 'work' ? 'clear_build' : 'read_only'],
    downgraded_from: null,
    downgrade_reason: null,
    required_permissions: route === 'build' ? ['write_project'] : [],
    permission_result: route === 'build' ? 'allowed' : 'not_required',
    dispatch: route === 'build' ? 'build' : 'reply',
    decided_at_ms: 1,
  };
}

function temporaryRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-builder-save-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function append(events, eventType, payload, commandIndex) {
  const previous = events.at(-1) ?? null;
  const basePayload = eventType === 'run_completed'
    ? { ...payload, plan_admission: payload.plan_admission ?? null }
    : payload;
  const normalizedPayload = eventType === 'turn_submitted'
    ? {
      ...basePayload,
      route_decision: Object.hasOwn(basePayload, 'route_decision')
        ? basePayload.route_decision
        : routeDecision(basePayload),
    }
    : basePayload;
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
    payload: normalizedPayload,
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
  candidateWorkspaceBases.set(receipt.candidate_digest, candidateValue.base_source_tree);
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
  const accepted = [];
  return {
    accepted,
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
    accept_candidate(input) {
      const candidateValue = draft.candidate_proof;
      assert.equal(input.draft_id, draft.draft_id);
      assert.match(input.review_id, /^builder-review:/u);
      assert.match(input.reviewer_id, /^builder-user:/u);
      assert.equal(Number.isSafeInteger(input.reviewed_at_ms), true);
      assert.deepEqual(Object.keys(input.revision).sort(), [
        'revision_number',
        'revision_receipt_digest',
      ]);
      assert.match(input.revision.revision_receipt_digest, /^sha256:[0-9a-f]{64}$/u);
      assert.equal(Number.isSafeInteger(input.revision.revision_number), true);
      accepted.push(input);
      return {
        result_version: 'builder-conversation-candidate-accept-result.v1',
        draft_id: draft.draft_id,
        project_id: candidateValue.project_id,
        conversation_id: candidateValue.conversation_id,
        acceptance_admission: 'sqlite_recorded',
      };
    },
  };
}

function projectIdentityResult(createdAtMs = 1) {
  return {
    result_version: 'builder-product-metadata-result.v4',
    operation: 'project_identity_loaded',
    project: {
      project_id: PROJECT_ID,
      created_at_ms: createdAtMs,
      current_revision_receipt_digest: null,
      current_revision_number: 0,
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
  let activeDraftId = initialPending.draft_id;
  return {
    released,
    replace(next) {
      drafts.set(next.draft_id, next);
      activeDraftId = next.draft_id;
    },
    workspace_source_tree() {
      const draft = drafts.get(activeDraftId);
      const receipt = draft && pendingProofGitReceipts.get(draft.candidate_proof);
      const sourceTree = receipt && candidateWorkspaceBases.get(receipt.candidate_digest);
      assert.ok(sourceTree);
      return sourceTree;
    },
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
      if (activeDraftId === body.draft_id) activeDraftId = null;
      return { released: true };
    },
  };
}

function candidateWorkspaceBaseResult(receipt) {
  const sourceTree = candidateWorkspaceBases.get(receipt.candidate_digest);
  assert.ok(sourceTree);
  return {
    result_version: 'builder-git-candidate-workspace-base.v1',
    project_id: receipt.project_id,
    candidate_id: receipt.candidate_id,
    candidate_digest: receipt.candidate_digest,
    base_source_tree_digest: sourceTree.source_tree_digest,
    read_admission: 'verified_git_candidate_commit_trailer',
  };
}

function workspaceReadResult(projectId, inspected) {
  return {
    result_version: 'builder-project-save-workspace-read-result.v1',
    project_id: projectId,
    source_tree: inspected.source_tree,
    scan_status: inspected.scan_status,
    incomplete_reasons: inspected.incomplete_reasons,
    read_admission: 'main_bound_workspace_fresh_read',
  };
}

function checkpointVerificationResult(request, overrides = {}) {
  return {
    result_version: 'builder-automatic-draft-checkpoint-result.v1',
    service_version: 'builder-automatic-draft-checkpoint-service.v1',
    operation: 'current_candidate_checkpoint_verified',
    status: 'verified',
    checkpoint_ref: {
      checkpoint_id: `builder-draft-checkpoint:${'a'.repeat(64)}`,
      checkpoint_sequence: 1,
      candidate_id: request.candidate_id,
      candidate_digest: request.candidate_digest,
      resulting_tree_digest: request.resulting_tree_digest,
      ...(overrides.checkpoint_ref ?? {}),
    },
    verification_admission: 'main_owned_latest_checkpoint_verified',
    ...overrides,
  };
}

function createSaveAuthority(options) {
  const gitAuthority = {
    ...options.gitAuthority,
    read_candidate_workspace_base: options.gitAuthority.read_candidate_workspace_base
      ?? ((receipt) => candidateWorkspaceBaseResult(receipt)),
  };
  const workspaceReadAuthority = options.workspaceReadAuthority ?? {
    load_fresh_workspace({ project_id: projectId }) {
      const sourceTree = options.generationDrafts.workspace_source_tree();
      return workspaceReadResult(projectId, {
        source_tree: sourceTree,
        scan_status: 'complete',
        incomplete_reasons: [],
      });
    },
  };
  const automaticDraftCheckpointService = options.automaticDraftCheckpointService ?? {
    verify_current_candidate_checkpoint(request) {
      return checkpointVerificationResult(request);
    },
  };
  return createBuilderProjectSaveAuthority({
    ...options,
    gitAuthority,
    workspaceReadAuthority,
    automaticDraftCheckpointService,
  });
}

function uuidFactory(start = 100) {
  let index = start;
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

function projectionResult(gitReceipt, mainRef = 'updated') {
  return {
    result_version: 'builder-git-current-projection-result.v1',
    project_id: gitReceipt.project_id,
    commit_oid: gitReceipt.commit_oid,
    tree_oid: gitReceipt.tree_oid,
    expected_base_oid: gitReceipt.expected_base_oid,
    previous_main_oid: (() => {
      if (mainRef === 'already_current') return gitReceipt.commit_oid;
      if (mainRef === 'repaired') return gitReceipt.parent_oid === null ? 'f'.repeat(40) : null;
      return gitReceipt.expected_base_oid;
    })(),
    main_ref: mainRef,
    worktree: 'materialized',
    worktree_file_count: 1,
    projection_authority: 'git_main_ref_and_materialized_worktree',
    source_admission: 'git_verified_candidate',
  };
}

function projectionAuthorityFor(gitReceipt, calls = null) {
  return {
    project_current(request) {
      if (calls) calls.push(request);
      assert.deepEqual(request, {
        candidate_receipt: gitReceipt,
        expected_workspace_source_tree_digest:
          candidateWorkspaceBases.get(gitReceipt.candidate_digest).source_tree_digest,
        projection_mode: 'base_cas',
      });
      return projectionResult(gitReceipt);
    },
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
  const projection = createDefaultBuilderGitCurrentProjection({
    projects_root: gitOptions.projects_root,
    runtime_root: gitOptions.runtime_root,
    git_repository: git,
  });
  const read = createBuilderProjectReadAuthority({
    metadata_database: metadata,
    git_repository: git,
  });
  return {
    root,
    gitOptions,
    metadataPath,
    git,
    projection,
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
    createUuid: uuidFactory(900),
    nowMs: () => 10_000,
  });
  const saveConversationService = {
    verify_candidate(input) {
      return conversationService.verify_candidate(input);
    },
    accept_candidate(input) {
      stages.push('conversation_accept');
      try {
        return conversationService.accept_candidate(input);
      } catch (error) {
        stages.push(`conversation_accept_error:${error.code}`);
        throw error;
      }
    },
  };
  const gitAuthority = {
    async verify_candidate_receipt(receipt) {
      stages.push('git_verify');
      return value.git.verify_candidate_receipt(receipt);
    },
    async read_verified_candidate(receipt) {
      return value.git.read_verified_candidate(receipt);
    },
    async read_candidate_workspace_base(receipt) {
      stages.push('git_workspace_base');
      return value.git.read_candidate_workspace_base(receipt);
    },
  };
  const currentProjection = {
    async project_current(request) {
      stages.push('project_current');
      return value.projection.project_current(request);
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
      try {
        return await value.read.load_current(request);
      } catch (error) {
        stages.push(`read_current_error:${error.code}`);
        throw error;
      }
    },
  };
  const workspaceReadAuthority = {
    load_fresh_workspace({ project_id: projectId }) {
      stages.push('workspace_read');
      return workspaceReadResult(
        projectId,
        inspectBuilderLocalWorkspaceSourceTree(
          path.join(value.gitOptions.projects_root, UUID),
        ),
      );
    },
  };
  let acceptanceTime = 10_000;
  const saveAuthority = createSaveAuthority({
    generationDrafts,
    gitAuthority,
    currentProjection,
    metadataAuthority,
    projectReadAuthority,
    workspaceReadAuthority,
    conversationService: saveConversationService,
    automaticDraftCheckpointService: {
      verify_current_candidate_checkpoint(request) {
        stages.push('checkpoint_verify');
        return checkpointVerificationResult(request);
      },
    },
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
  assert.equal(saved.save_evidence.projection_authority, 'git_main_ref_and_materialized_worktree');
  assert.equal(saved.save_evidence.projection_main_ref, 'updated');
  assert.equal(saved.save_evidence.worktree_projection, 'materialized');
  assert.deepEqual(stages.slice(0, 8), [
    'git_verify',
    'checkpoint_verify',
    'git_workspace_base',
    'workspace_read',
    'metadata_identity',
    'metadata_record',
    'project_current',
    'read_current',
  ]);
  assert.equal(generationDrafts.released.length, 1);
  assert.doesNotMatch(JSON.stringify(saved), /operations|credential|conversation_events|api\.deepseek/u);
  const savedStream = conversationService.read_stream({ project_id: PROJECT_ID });
  assert.deepEqual(savedStream.conversation.items.at(-1), {
    item_kind: 'candidate_reviewed',
    sequence: 5,
    turn_id: firstCandidate.turn_id,
    run_id: firstCandidate.run_id,
    draft_id: firstPending.draft_id,
    decision: 'accepted',
    candidate_state: 'saved',
    saved_revision: { revision_number: 1 },
  });
  assert.doesNotMatch(
    JSON.stringify(savedStream),
    /revision_receipt|commit_oid|tree_oid|review_id|reviewer_id|reviewed_at_ms|provider|credential/iu,
  );

  const current = await value.read.load_current({ project_id: PROJECT_ID });
  const priorConversation = value.metadata.load_conversation({
    project_id: firstCandidate.project_id,
    conversation_id: firstCandidate.conversation_id,
  });
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
    priorEvents: priorConversation.events,
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
  const updated = await saveAuthority.save({ draft_id: updatePending.draft_id }).catch((error) => {
    assert.fail(`update save failed at stages:${stages.join(',')}:${error.code}`);
  });
  assert.equal(updated.project_id, PROJECT_ID);
  assert.notEqual(updated.revision_receipt_digest, saved.revision_receipt_digest);
  assert.equal(updated.save_evidence.projection_main_ref, 'updated');
  assert.equal(
    fs.readFileSync(path.join(value.gitOptions.projects_root, UUID, 'README.md'), 'utf8'),
    '# Updated\n',
  );
  assert.equal(
    fs.readFileSync(path.join(value.gitOptions.projects_root, UUID, 'src', 'app.js'), 'utf8'),
    'document.title = "Updated";\n',
  );
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
  const conversationService = conversationServiceFor(draft);
  const saveAuthority = createSaveAuthority({
    generationDrafts,
    conversationService,
    gitAuthority: {
      async verify_candidate_receipt(receipt) {
        verifyCalls += 1;
        assert.deepEqual(receipt, gitReceipt);
        await verifyGate;
        return verification;
      },
    },
    currentProjection: projectionAuthorityFor(gitReceipt),
    metadataAuthority: {
      load_project_identity() { return projectIdentityResult(25_000); },
      record_project_revision_receipt() {
        recordCalls += 1;
        return {
          operation: 'recorded',
          receipt: {
            project_id: PROJECT_ID,
            revision_receipt_digest: revisionDigest,
            revision_number: 1,
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
            revision_number: 1,
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
  assert.equal(conversationService.accepted.length, 1);
  assert.equal(generationDrafts.released.length, 1);
});

test('fails closed before revision admission when the current candidate checkpoint is unavailable', async () => {
  const value = candidate({
    index: 1,
    operations: [{ operation: 'upsert', path: 'src/app.js', content: 'export const safe = true;\n' }],
  });
  const draft = pending(value);
  const generationDrafts = draftsStore(draft);
  const gitReceipt = candidateGitReceipts.get(value);
  const conversationService = conversationServiceFor(draft);
  let metadataWrites = 0;
  const saveAuthority = createSaveAuthority({
    generationDrafts,
    conversationService,
    gitAuthority: {
      async verify_candidate_receipt() {
        return createBuilderGitCandidateVerificationReceipt(gitReceipt);
      },
    },
    automaticDraftCheckpointService: {
      verify_current_candidate_checkpoint() {
        throw new Error('private-checkpoint-marker');
      },
    },
    currentProjection: {
      async project_current() { assert.fail('projection must not run'); },
    },
    metadataAuthority: {
      async load_project_identity() { assert.fail('identity must not load'); },
      async record_project_revision_receipt() { metadataWrites += 1; },
    },
    projectReadAuthority: {
      async load_current() { assert.fail('current revision must not load'); },
    },
    createUuid: uuidFactory(),
    nowMs: () => 25_000,
  });

  await assert.rejects(
    saveAuthority.save({ draft_id: draft.draft_id }),
    expectSaveError('builder_project_save_unavailable', ['private-checkpoint-marker']),
  );
  assert.equal(metadataWrites, 0);
  assert.equal(conversationService.accepted.length, 0);
  assert.equal(generationDrafts.released.length, 0);
});

test('keeps pending draft and stable attempt identity after metadata failure following Git replay', async () => {
  const value = candidate({
    index: 1,
    operations: [{ operation: 'upsert', path: 'index.html', content: '<main>Hello</main>\n' }],
  });
  const draft = pending(value);
  const generationDrafts = draftsStore(draft);
  const calls = { git: [], records: [], projection: [] };
  let metadataFails = true;
  const gitReceipt = candidateGitReceipts.get(value);
  const verification = createBuilderGitCandidateVerificationReceipt(gitReceipt);
  const saveAuthority = createSaveAuthority({
    generationDrafts,
    conversationService: conversationServiceFor(draft),
    gitAuthority: {
      async verify_candidate_receipt(receipt) {
        calls.git.push(receipt);
        return verification;
      },
    },
    currentProjection: projectionAuthorityFor(gitReceipt, calls.projection),
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
          operation: 'recorded',
          receipt: {
            project_id: PROJECT_ID,
            revision_receipt_digest: `sha256:${'c'.repeat(64)}`,
            revision_number: 1,
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
            revision_number: 1,
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
  assert.equal(calls.projection.length, 0);
  metadataFails = false;
  await saveAuthority.save({ draft_id: draft.draft_id });
  assert.equal(calls.git.length, 2);
  assert.deepEqual(calls.git[0], calls.git[1]);
  assert.equal(calls.records[0].idempotency.idempotency_key, calls.records[1].idempotency.idempotency_key);
  assert.equal(calls.records[0].review.review_id, calls.records[1].review.review_id);
  assert.equal(calls.records[0].review.reviewed_at_ms, calls.records[1].review.reviewed_at_ms);
  assert.equal(calls.projection.length, 1);
  assert.equal(generationDrafts.released.length, 1);
});

test('keeps pending draft and retries projection after SQLite receipt is recorded', async () => {
  const value = candidate({
    index: 1,
    operations: [{ operation: 'upsert', path: 'index.html', content: '<main>Hello</main>\n' }],
  });
  const draft = pending(value);
  const generationDrafts = draftsStore(draft);
  const calls = { records: [], projection: [] };
  const gitReceipt = candidateGitReceipts.get(value);
  const verification = createBuilderGitCandidateVerificationReceipt(gitReceipt);
  const revisionDigest = `sha256:${'d'.repeat(64)}`;
  const conversationService = conversationServiceFor(draft);
  let projectionFails = true;
  const saveAuthority = createSaveAuthority({
    generationDrafts,
    conversationService,
    gitAuthority: {
      async verify_candidate_receipt() {
        return verification;
      },
    },
    currentProjection: {
      project_current(request) {
        calls.projection.push(request);
        assert.deepEqual(request, {
          candidate_receipt: gitReceipt,
          expected_workspace_source_tree_digest:
            candidateWorkspaceBases.get(gitReceipt.candidate_digest).source_tree_digest,
          projection_mode: calls.projection.length === 1 ? 'base_cas' : 'sqlite_current_repair',
        });
        if (projectionFails) {
          const error = new Error('private projection marker');
          error.code = 'builder_git_current_projection_unavailable';
          throw error;
        }
        return projectionResult(gitReceipt);
      },
    },
    metadataAuthority: {
      load_project_identity() { return projectIdentityResult(55_000); },
      record_project_revision_receipt(request) {
        calls.records.push(request);
        return {
          operation: calls.records.length === 1 ? 'recorded' : 'replayed',
          receipt: {
            project_id: PROJECT_ID,
            revision_receipt_digest: revisionDigest,
            revision_number: 1,
            commit_oid: gitReceipt.commit_oid,
          },
        };
      },
    },
    projectReadAuthority: {
      load_current() {
        return {
          result_version: 'builder-project-read-result.v1',
          operation: 'current_loaded',
          product_revision_receipt: {
            project_id: PROJECT_ID,
            revision_receipt_digest: revisionDigest,
            revision_number: 1,
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
    nowMs: () => 55_000,
  });

  await assert.rejects(
    saveAuthority.save({ draft_id: draft.draft_id }),
    expectSaveError('builder_project_save_unavailable', ['private projection marker']),
  );
  assert.equal(calls.records.length, 1);
  assert.equal(calls.projection.length, 1);
  assert.equal(conversationService.accepted.length, 0);
  assert.equal(generationDrafts.released.length, 0);

  projectionFails = false;
  await saveAuthority.save({ draft_id: draft.draft_id });
  assert.equal(calls.records.length, 2);
  assert.equal(calls.projection.length, 2);
  assert.equal(calls.records[0].idempotency.idempotency_key, calls.records[1].idempotency.idempotency_key);
  assert.deepEqual(calls.records[0].review, calls.records[1].review);
  assert.equal(calls.records[0].task.created_at_ms, calls.records[1].task.created_at_ms);
  assert.equal(calls.records[0].run.completed_at_ms, calls.records[1].run.completed_at_ms);
  assert.equal(calls.records[0].project_revision.selected_at_ms, calls.records[1].project_revision.selected_at_ms);
  assert.equal(conversationService.accepted.length, 1);
  assert.equal(generationDrafts.released.length, 1);
});

test('replays recorded SQLite receipt after projection failure and save authority restart', async (t) => {
  const value = realAuthorities(t);
  const candidateValue = candidate({
    index: 1,
    operations: [
      { operation: 'upsert', path: 'index.html', content: '<main>Hello after restart</main>\n' },
    ],
  });
  const gitReceipt = await value.git.persist_candidate_commit({
    request_id: gitRequestId(1),
    expected_base_oid: null,
    candidate: candidateValue,
  });
  const draft = pending(candidateValue, { gitReceipt });
  appendCandidateConversation(value.metadata, candidateValue, 12_000);
  const firstDrafts = draftsStore(draft);
  const firstRecords = [];
  const firstConversation = createBuilderConversationMainService({
    metadataAuthority: value.metadata,
    createUuid: uuidFactory(1_200),
    nowMs: () => 12_000,
  });
  const firstSaveAuthority = createSaveAuthority({
    generationDrafts: firstDrafts,
    conversationService: firstConversation,
    gitAuthority: {
      verify_candidate_receipt(receipt) {
        return value.git.verify_candidate_receipt(receipt);
      },
    },
    currentProjection: {
      project_current(request) {
        assert.deepEqual(request, {
          candidate_receipt: gitReceipt,
          expected_workspace_source_tree_digest:
            candidateWorkspaceBases.get(gitReceipt.candidate_digest).source_tree_digest,
          projection_mode: 'base_cas',
        });
        const error = new Error('private first projection failure');
        error.code = 'builder_git_current_projection_unavailable';
        throw error;
      },
    },
    metadataAuthority: {
      load_project_identity(request) { return value.metadata.load_project_identity(request); },
      record_project_revision_receipt(request) {
        firstRecords.push(request);
        return value.metadata.record_project_revision_receipt(request);
      },
    },
    projectReadAuthority: {
      load_current(request) { return value.read.load_current(request); },
    },
    createUuid: uuidFactory(1_300),
    nowMs: () => 30_000,
  });

  await assert.rejects(
    firstSaveAuthority.save({ draft_id: draft.draft_id }),
    expectSaveError('builder_project_save_unavailable', ['private first projection failure']),
  );
  assert.equal(firstRecords.length, 1);
  assert.equal(
    firstConversation.read_stream({ project_id: PROJECT_ID }).conversation.items.some(
      (item) => item.item_kind === 'candidate_reviewed',
    ),
    false,
  );
  assert.equal(firstDrafts.released.length, 0);
  assert.equal(
    value.metadata.load_current_project_revision({ project_id: PROJECT_ID }).current.commit_oid,
    gitReceipt.commit_oid,
  );

  const restoredDraft = { ...draft, restart_restore: 'git_sqlite_verified' };
  const restartedDrafts = draftsStore(restoredDraft);
  const restartedRecords = [];
  const restartedConversation = createBuilderConversationMainService({
    metadataAuthority: value.metadata,
    createUuid: uuidFactory(1_400),
    nowMs: () => 90_000,
  });
  const restartedSaveAuthority = createSaveAuthority({
    generationDrafts: restartedDrafts,
    conversationService: restartedConversation,
    gitAuthority: {
      verify_candidate_receipt(receipt) {
        return value.git.verify_candidate_receipt(receipt);
      },
    },
    currentProjection: value.projection,
    metadataAuthority: {
      load_project_identity(request) { return value.metadata.load_project_identity(request); },
      record_project_revision_receipt(request) {
        restartedRecords.push(request);
        return value.metadata.record_project_revision_receipt(request);
      },
    },
    projectReadAuthority: {
      load_current(request) { return value.read.load_current(request); },
    },
    createUuid: uuidFactory(1_500),
    nowMs: () => 95_000,
  });

  const saved = await restartedSaveAuthority.save({ draft_id: draft.draft_id });
  assert.equal(saved.pending_draft_released, true);
  assert.equal(saved.save_evidence.projection_main_ref, 'updated');
  assert.equal(restartedRecords.length, 1);
  assert.equal(restartedDrafts.released.length, 1);
  assert.equal(restartedConversation.read_stream({ project_id: PROJECT_ID }).conversation.items.at(-1).item_kind, 'candidate_reviewed');
  assert.deepEqual(restartedRecords[0].idempotency, firstRecords[0].idempotency);
  assert.deepEqual(restartedRecords[0].review, firstRecords[0].review);
  assert.equal(restartedRecords[0].task.created_at_ms, firstRecords[0].task.created_at_ms);
  assert.equal(restartedRecords[0].run.completed_at_ms, firstRecords[0].run.completed_at_ms);
  assert.equal(restartedRecords[0].project_revision.selected_at_ms, firstRecords[0].project_revision.selected_at_ms);
  assert.equal(
    fs.readFileSync(path.join(value.gitOptions.projects_root, UUID, 'index.html'), 'utf8'),
    '<main>Hello after restart</main>\n',
  );
  value.metadata.close();
});

test('rejects changed or incomplete workspaces before recording a revision', async (t) => {
  const scenarios = [
    {
      name: 'managed source drift',
      inspected() {
        return {
          source_tree: createBuilderProjectSourceTree({
            files: [{ path: 'local-change.txt', content: 'not part of the candidate\n' }],
          }),
          scan_status: 'complete',
          incomplete_reasons: [],
        };
      },
    },
    {
      name: 'incomplete bounded scan',
      inspected(baseSourceTree) {
        return {
          source_tree: baseSourceTree,
          scan_status: 'incomplete',
          incomplete_reasons: ['oversized_file'],
        };
      },
    },
  ];

  for (const [offset, scenario] of scenarios.entries()) {
    await t.test(scenario.name, async () => {
      const candidateValue = candidate({
        index: 20 + offset,
        operations: [{ operation: 'upsert', path: 'index.html', content: '<main>Hello</main>\n' }],
      });
      const draft = pending(candidateValue, {
        draft: String(3 + offset),
        request: 20 + offset,
      });
      const generationDrafts = draftsStore(draft);
      const gitReceipt = candidateGitReceipts.get(candidateValue);
      const verification = createBuilderGitCandidateVerificationReceipt(gitReceipt);
      const conversationService = conversationServiceFor(draft);
      const calls = { metadata: 0, projection: 0, current: 0 };
      const saveAuthority = createSaveAuthority({
        generationDrafts,
        conversationService,
        gitAuthority: {
          verify_candidate_receipt() { return verification; },
        },
        workspaceReadAuthority: {
          load_fresh_workspace({ project_id: projectId }) {
            return workspaceReadResult(
              projectId,
              scenario.inspected(candidateWorkspaceBases.get(gitReceipt.candidate_digest)),
            );
          },
        },
        currentProjection: {
          project_current() {
            calls.projection += 1;
            throw new Error('must not project after workspace conflict');
          },
        },
        metadataAuthority: {
          load_project_identity() {
            calls.metadata += 1;
            throw new Error('must not read metadata after workspace conflict');
          },
          record_project_revision_receipt() {
            calls.metadata += 1;
            throw new Error('must not record metadata after workspace conflict');
          },
        },
        projectReadAuthority: {
          load_current() {
            calls.current += 1;
            throw new Error('must not read current after workspace conflict');
          },
        },
        createUuid: uuidFactory(2_000 + offset * 10),
        nowMs: () => 100_000,
      });

      await assert.rejects(
        saveAuthority.save({ draft_id: draft.draft_id }),
        expectSaveError('builder_project_save_conflict'),
      );
      assert.deepEqual(calls, { metadata: 0, projection: 0, current: 0 });
      assert.equal(conversationService.accepted.length, 0);
      assert.equal(generationDrafts.released.length, 0);
    });
  }
});

test('maps projection CAS conflict without accepting or releasing the pending draft', async () => {
  const value = candidate({
    index: 1,
    operations: [{ operation: 'upsert', path: 'index.html', content: '<main>Hello</main>\n' }],
  });
  const draft = pending(value);
  const generationDrafts = draftsStore(draft);
  const gitReceipt = candidateGitReceipts.get(value);
  const verification = createBuilderGitCandidateVerificationReceipt(gitReceipt);
  const conversationService = conversationServiceFor(draft);
  const saveAuthority = createSaveAuthority({
    generationDrafts,
    conversationService,
    gitAuthority: {
      verify_candidate_receipt() {
        return verification;
      },
    },
    currentProjection: {
      project_current(request) {
        assert.deepEqual(request, {
          candidate_receipt: gitReceipt,
          expected_workspace_source_tree_digest:
            candidateWorkspaceBases.get(gitReceipt.candidate_digest).source_tree_digest,
          projection_mode: 'base_cas',
        });
        const error = new Error('private main drift');
        error.code = 'builder_git_current_projection_conflict';
        throw error;
      },
    },
    metadataAuthority: {
      load_project_identity() { return projectIdentityResult(58_000); },
      record_project_revision_receipt() {
        return {
          operation: 'recorded',
          receipt: {
            project_id: PROJECT_ID,
            revision_receipt_digest: `sha256:${'e'.repeat(64)}`,
            revision_number: 1,
            commit_oid: gitReceipt.commit_oid,
          },
        };
      },
    },
    projectReadAuthority: { load_current() { throw new Error('must not read after projection conflict'); } },
    createUuid: uuidFactory(),
    nowMs: () => 58_000,
  });

  await assert.rejects(
    saveAuthority.save({ draft_id: draft.draft_id }),
    expectSaveError('builder_project_save_conflict', ['private main drift']),
  );
  assert.equal(conversationService.accepted.length, 0);
  assert.equal(generationDrafts.released.length, 0);
});

test('maps CAS conflict without releasing the pending draft', async () => {
  const value = candidate({
    index: 1,
    operations: [{ operation: 'upsert', path: 'index.html', content: '<main>Hello</main>\n' }],
  });
  const draft = pending(value);
  const generationDrafts = draftsStore(draft);
  const saveAuthority = createSaveAuthority({
    generationDrafts,
    conversationService: conversationServiceFor(draft),
    gitAuthority: {
      async verify_candidate_receipt(receipt) {
        return createBuilderGitCandidateVerificationReceipt(receipt);
      },
    },
    currentProjection: { project_current() { throw new Error('must not project after conflict'); } },
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
  const saveAuthority = createSaveAuthority({
    generationDrafts,
    conversationService: conversationServiceFor(draft),
    gitAuthority: { verify_candidate_receipt() {} },
    currentProjection: { project_current() {} },
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
  const driftAuthority = createSaveAuthority({
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
      accept_candidate() {
        throw new Error('must not accept after invalid verification');
      },
    },
    gitAuthority: {
      verify_candidate_receipt() {
        driftVerifyCalls += 1;
      },
    },
    currentProjection: { project_current() { throw new Error('must not project after invalid verification'); } },
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
  const hostileAuthority = createSaveAuthority({
    generationDrafts,
    conversationService: conversationServiceFor(draft),
    gitAuthority: {
      verify_candidate_receipt() { throw hostile; },
    },
    currentProjection: { project_current() { throw new Error('must not project after hostile Git verify'); } },
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
