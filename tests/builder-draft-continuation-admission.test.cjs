'use strict';

const assert = require('node:assert/strict');
const nodeCrypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  BUILDER_DRAFT_CONTINUATION_ADMISSION_VERSION,
  DRAFT_CONTINUATION_ADMISSION_KIND,
  PENDING_DRAFT_RESULT_VERSION,
  BuilderDraftContinuationAdmissionError,
  createBuilderDraftContinuationAdmission,
  sanitizeBuilderDraftContinuationAdmission,
} = require('../electron/builder-draft-continuation-admission.cjs');

const PROJECT_UUID = '123e4567-e89b-42d3-a456-426614174000';
const PROJECT_ID = `builder-project:${PROJECT_UUID}`;
const CONVERSATION_ID = `builder-conversation:${PROJECT_UUID}`;
const TURN_ID = 'builder-turn:123e4567-e89b-42d3-a456-426614174002';
const TASK_ID = 'builder-task:123e4567-e89b-42d3-a456-426614174003';
const RUN_ID = 'builder-run:123e4567-e89b-42d3-a456-426614174004';
const GIT_REQUEST_ID = 'builder-git-request:123e4567-e89b-42d3-a456-426614174005';
const CONTINUATION_ID = 'builder-draft-continuation:123e4567-e89b-42d3-a456-426614174006';
const DRAFT_ID = `builder-generation-draft:${'1'.repeat(64)}`;
const CANDIDATE_ID = `builder-code-change-candidate:${'2'.repeat(64)}`;
const CANDIDATE_DIGEST = `sha256:${'3'.repeat(64)}`;
const RESULTING_TREE_DIGEST = `sha256:${'4'.repeat(64)}`;
const REQUEST_DIGEST = `sha256:${'5'.repeat(64)}`;
const EVENT_DIGEST = `sha256:${'6'.repeat(64)}`;
const EVENT_ID = `builder-conversation-event:${'7'.repeat(64)}`;
const REVISION_DIGEST = `sha256:${'8'.repeat(64)}`;
const BASE_COMMIT = '9'.repeat(40);

function candidateProof(overrides = {}) {
  return {
    proof_version: 'builder-generation-pending-candidate-proof.v1',
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    turn_id: TURN_ID,
    task_id: TASK_ID,
    run_id: RUN_ID,
    request_digest: REQUEST_DIGEST,
    git_request_id: GIT_REQUEST_ID,
    candidate_id: CANDIDATE_ID,
    candidate_digest: CANDIDATE_DIGEST,
    resulting_tree_digest: RESULTING_TREE_DIGEST,
    expected_base_oid: BASE_COMMIT,
    base_revision: {
      revision_receipt_digest: REVISION_DIGEST,
      commit_oid: BASE_COMMIT,
    },
    ...overrides,
  };
}

function pendingDraft(overrides = {}) {
  return {
    result_version: PENDING_DRAFT_RESULT_VERSION,
    draft_id: DRAFT_ID,
    restart_restore: 'git_sqlite_verified',
    conversation_event_admission: 'sqlite_recorded',
    git_request_id: GIT_REQUEST_ID,
    title: 'Dashboard draft',
    summary: 'A pending dashboard candidate waiting for review.',
    conversation_head: {
      sequence: 9,
      event_id: EVENT_ID,
      event_digest: EVENT_DIGEST,
    },
    candidate_proof: candidateProof(),
    ...overrides,
  };
}

function input(overrides = {}) {
  return {
    pending_draft: pendingDraft(),
    continuation_id: CONTINUATION_ID,
    admitted_at_ms: 10_000,
    ...overrides,
  };
}

function assertAdmissionError(error) {
  assert.equal(error instanceof BuilderDraftContinuationAdmissionError, true);
  assert.equal(error.code, 'builder_draft_continuation_admission_invalid');
  assert.equal(error.message, 'The draft continuation could not be verified.');
  assert.equal(error.retryable, false);
  return true;
}

function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`
  )).join(',')}}`;
}

function sha256Canonical(value) {
  return `sha256:${nodeCrypto.createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')}`;
}

function digestHead(value) {
  return sha256Canonical({
    event_digest: value.event_digest,
    event_id: value.event_id,
    sequence: value.sequence,
  });
}

function digestAdmission(value) {
  return sha256Canonical({
    admitted_at_ms: value.admitted_at_ms,
    admission_kind: value.admission_kind,
    admission_version: value.admission_version,
    authority: value.authority,
    candidate_digest: value.candidate_digest,
    candidate_id: value.candidate_id,
    conversation_head: value.conversation_head,
    conversation_head_digest: value.conversation_head_digest,
    conversation_id: value.conversation_id,
    continuation_id: value.continuation_id,
    draft_id: value.draft_id,
    lifecycle: value.lifecycle,
    pending_draft_restart_restore: value.pending_draft_restart_restore,
    pending_draft_result_version: value.pending_draft_result_version,
    previous_request_digest: value.previous_request_digest,
    previous_run_id: value.previous_run_id,
    previous_task_id: value.previous_task_id,
    previous_turn_id: value.previous_turn_id,
    project_id: value.project_id,
    resulting_tree_digest: value.resulting_tree_digest,
  });
}

test('creates a main-only draft continuation admission without starting replacement work', () => {
  const draft = pendingDraft();
  const admission = createBuilderDraftContinuationAdmission(input({ pending_draft: draft }));

  assert.equal(admission.admission_version, BUILDER_DRAFT_CONTINUATION_ADMISSION_VERSION);
  assert.equal(admission.admission_kind, DRAFT_CONTINUATION_ADMISSION_KIND);
  assert.equal(admission.pending_draft_result_version, PENDING_DRAFT_RESULT_VERSION);
  assert.equal(admission.project_id, PROJECT_ID);
  assert.equal(admission.conversation_id, CONVERSATION_ID);
  assert.equal(admission.previous_turn_id, TURN_ID);
  assert.equal(admission.previous_task_id, TASK_ID);
  assert.equal(admission.previous_run_id, RUN_ID);
  assert.equal(admission.previous_request_digest, REQUEST_DIGEST);
  assert.equal(admission.draft_id, DRAFT_ID);
  assert.equal(admission.candidate_id, CANDIDATE_ID);
  assert.equal(admission.candidate_digest, CANDIDATE_DIGEST);
  assert.equal(admission.resulting_tree_digest, RESULTING_TREE_DIGEST);
  assert.equal(admission.pending_draft_restart_restore, 'git_sqlite_verified');
  assert.deepEqual(admission.conversation_head, draft.conversation_head);
  assert.equal(admission.conversation_head_digest, digestHead(draft.conversation_head));
  assert.equal(admission.continuation_id, CONTINUATION_ID);
  assert.equal(admission.admitted_at_ms, 10_000);
  assert.deepEqual(admission.lifecycle, {
    pending_draft_gate: 'pending_candidate_identity_bound',
    current_head_reverification: 'required_before_provider_dispatch',
    review_state_reverification: 'required_before_replacement',
    continuation_admission: 'admitted_without_starting_run',
    prior_candidate_release: 'not_performed',
    provider_dispatch: 'not_started',
    tool_dispatch: 'not_started',
    source_mutation: 'not_performed',
    git_authority: 'not_present',
    revision_admission: 'not_created',
    save_admission: 'not_performed',
  });
  assert.deepEqual(admission.authority, {
    admission_authority: 'main_draft_continuation_admission_contract_v1',
    pending_draft_authority: 'main_generation_pending_draft_identity_verified',
    conversation_binding: 'pending_draft_head_bound_reverify_current_head_before_use',
    review_state_authority: 'not_asserted_reverify_before_replacement',
    renderer_authority: 'not_present',
    provider_dispatch: false,
    credential_readback: false,
    tool_dispatch: 'not_performed',
    source_mutation: 'not_performed',
    git_authority: 'not_present',
    revision_authority: 'not_present',
    save_authority: 'not_present',
    cost_authority: 'no_chargeable_dispatch_without_generation_runtime_v1',
  });
  assert.equal(admission.admission_digest, digestAdmission(admission));
  assert.deepEqual(sanitizeBuilderDraftContinuationAdmission(admission), admission);
  assert.equal(Object.isFrozen(admission), true);
  assert.equal(Object.isFrozen(admission.conversation_head), true);
  assert.equal(Object.isFrozen(admission.lifecycle), true);
  assert.equal(Object.isFrozen(admission.authority), true);
  assert.doesNotMatch(
    JSON.stringify(admission),
    /title|summary|source_tree|file_content|operations|provider_config|provider_secret|credential_secret|credential_value|secret_ref|api[_-]?key|Authorization|Bearer|git_candidate_receipt|commit_oid|tree_oid|revision_receipt|save_result|approval_required/iu,
  );
});

test('accepts a first-draft admission with null prior request and no saved base', () => {
  const admission = createBuilderDraftContinuationAdmission(input({
    pending_draft: pendingDraft({
      restart_restore: 'not_persisted',
      candidate_proof: candidateProof({
        request_digest: null,
        expected_base_oid: null,
        base_revision: null,
      }),
    }),
  }));

  assert.equal(admission.previous_request_digest, null);
  assert.equal(admission.pending_draft_restart_restore, 'not_persisted');
  assert.equal(admission.admission_digest, digestAdmission(admission));
});

test('rejects hostile or inconsistent pending draft input', () => {
  assert.throws(() => createBuilderDraftContinuationAdmission(input({
    pending_draft: pendingDraft({ result_version: 'builder-generation-pending-draft.v3' }),
  })), assertAdmissionError);
  assert.throws(() => createBuilderDraftContinuationAdmission(input({
    pending_draft: pendingDraft({ conversation_event_admission: 'memory_only' }),
  })), assertAdmissionError);
  assert.throws(() => createBuilderDraftContinuationAdmission(input({
    pending_draft: pendingDraft({
      candidate_proof: candidateProof({ git_request_id: 'builder-git-request:123e4567-e89b-42d3-a456-426614174999' }),
    }),
  })), assertAdmissionError);
  assert.throws(() => createBuilderDraftContinuationAdmission(input({
    pending_draft: pendingDraft({
      candidate_proof: candidateProof({ expected_base_oid: 'a'.repeat(40) }),
    }),
  })), assertAdmissionError);
  assert.throws(() => createBuilderDraftContinuationAdmission(input({
    pending_draft: pendingDraft({
      candidate_proof: candidateProof({ conversation_id: 'builder-conversation:123e4567-e89b-42d3-a456-426614174999' }),
    }),
  })), assertAdmissionError);
  assert.throws(() => createBuilderDraftContinuationAdmission(input({
    pending_draft: { ...pendingDraft(), extra: true },
  })), assertAdmissionError);
  assert.throws(() => createBuilderDraftContinuationAdmission(input({
    continuation_id: 'builder-run:123e4567-e89b-42d3-a456-426614174006',
  })), assertAdmissionError);

  const accessorInput = input();
  Object.defineProperty(accessorInput, 'pending_draft', {
    enumerable: true,
    get() { throw new Error('private marker'); },
  });
  assert.throws(() => createBuilderDraftContinuationAdmission(accessorInput), assertAdmissionError);
  assert.throws(() => createBuilderDraftContinuationAdmission(input({
    pending_draft: new Proxy(pendingDraft(), {}),
  })), assertAdmissionError);
});

test('rejects forged continuation admissions that claim execution or changed evidence', () => {
  const admission = createBuilderDraftContinuationAdmission(input());

  const started = {
    ...admission,
    lifecycle: {
      ...admission.lifecycle,
      continuation_admission: 'run_started',
    },
  };
  assert.throws(() => sanitizeBuilderDraftContinuationAdmission({
    ...started,
    admission_digest: digestAdmission(started),
  }), assertAdmissionError);

  const dispatched = {
    ...admission,
    authority: {
      ...admission.authority,
      provider_dispatch: true,
    },
  };
  assert.throws(() => sanitizeBuilderDraftContinuationAdmission({
    ...dispatched,
    admission_digest: digestAdmission(dispatched),
  }), assertAdmissionError);

  const badHeadDigest = {
    ...admission,
    conversation_head_digest: `sha256:${'a'.repeat(64)}`,
  };
  assert.throws(() => sanitizeBuilderDraftContinuationAdmission({
    ...badHeadDigest,
    admission_digest: digestAdmission(badHeadDigest),
  }), assertAdmissionError);

  assert.throws(() => sanitizeBuilderDraftContinuationAdmission({
    ...admission,
    resulting_tree_digest: `sha256:${'b'.repeat(64)}`,
  }), assertAdmissionError);
  assert.throws(() => sanitizeBuilderDraftContinuationAdmission({
    ...admission,
    extra: true,
  }), assertAdmissionError);
});

test('source remains a pure main contract with no IPC, provider, or mutation authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-draft-continuation-admission.cjs'),
    'utf8',
  );
  assert.match(source, /builder-draft-continuation-admission\.v1/u);
  assert.match(source, /required_before_provider_dispatch/u);
  assert.doesNotMatch(
    source,
    /require\(['"]electron['"]\)|ipcMain|ipcRenderer|contextBridge|BrowserWindow|safeStorage|fetch\s*\(|https?:|Authorization|Bearer|builder-provider|provider_secret|credential_value|secret_ref|child_process|execFile|spawn\s*\(|persist_candidate_commit|write_current|record_grant|record_revocation|saveDraft|localStorage|sessionStorage|indexedDB|eval\s*\(|new Function/iu,
  );
});
