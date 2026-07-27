'use strict';

const assert = require('node:assert/strict');
const nodeCrypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  APPROVED_PLAN_CONTINUATION_ADMISSION_KIND,
  APPROVED_PLAN_READ_RESULT_VERSION,
  BUILDER_APPROVED_PLAN_CONTINUATION_ADMISSION_VERSION,
  BuilderApprovedPlanContinuationAdmissionError,
  createBuilderApprovedPlanContinuationAdmission,
  sanitizeBuilderApprovedPlanContinuationAdmission,
} = require('../electron/builder-approved-plan-continuation-admission.cjs');

const PROJECT_UUID = '123e4567-e89b-42d3-a456-426614174000';
const PROJECT_ID = `builder-project:${PROJECT_UUID}`;
const CONVERSATION_ID = `builder-conversation:${PROJECT_UUID}`;
const TURN_ID = 'builder-turn:123e4567-e89b-42d3-a456-426614174002';
const TASK_ID = 'builder-task:123e4567-e89b-42d3-a456-426614174003';
const RUN_ID = 'builder-run:123e4567-e89b-42d3-a456-426614174004';
const CONTINUATION_ID = 'builder-approved-plan-continuation:123e4567-e89b-42d3-a456-426614174005';
const PLAN_RESULT_DIGEST = `sha256:${'a'.repeat(64)}`;
const EVENT_DIGEST = `sha256:${'b'.repeat(64)}`;
const EVENT_ID = `builder-conversation-event:${'c'.repeat(64)}`;

function approvedPlan(overrides = {}) {
  return {
    result_version: APPROVED_PLAN_READ_RESULT_VERSION,
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    turn_id: TURN_ID,
    task_id: TASK_ID,
    run_id: RUN_ID,
    decision: 'approved',
    plan_result_digest: PLAN_RESULT_DIGEST,
    conversation_head: {
      sequence: 7,
      event_id: EVENT_ID,
      event_digest: EVENT_DIGEST,
    },
    authority: {
      conversation: 'sqlite_replay_current_head_verified',
      plan_review: 'approved_current_head',
      renderer_authority: 'not_present',
      provider_dispatch: false,
      tool_dispatch: 'not_performed',
      source_mutation: 'not_performed',
      git_authority: 'not_present',
      revision_admission: 'not_created',
    },
    ...overrides,
  };
}

function input(overrides = {}) {
  return {
    approved_plan: approvedPlan(),
    continuation_id: CONTINUATION_ID,
    admitted_at_ms: 8_000,
    ...overrides,
  };
}

function assertContinuationError(error) {
  assert.equal(error instanceof BuilderApprovedPlanContinuationAdmissionError, true);
  assert.equal(error.code, 'builder_approved_plan_continuation_admission_invalid');
  assert.equal(error.message, 'The approved plan continuation could not be verified.');
  assert.equal(error.retryable, false);
  return true;
}

function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
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
    approved_plan_result_version: value.approved_plan_result_version,
    authority: value.authority,
    conversation_head: value.conversation_head,
    conversation_head_digest: value.conversation_head_digest,
    conversation_id: value.conversation_id,
    continuation_id: value.continuation_id,
    decision: value.decision,
    lifecycle: value.lifecycle,
    plan_result_digest: value.plan_result_digest,
    project_id: value.project_id,
    run_id: value.run_id,
    task_id: value.task_id,
    turn_id: value.turn_id,
  });
}

test('creates a main-only continuation admission from the current approved-plan fact', () => {
  const plan = approvedPlan();
  const admission = createBuilderApprovedPlanContinuationAdmission(input({ approved_plan: plan }));

  assert.equal(admission.admission_version, BUILDER_APPROVED_PLAN_CONTINUATION_ADMISSION_VERSION);
  assert.equal(admission.admission_kind, APPROVED_PLAN_CONTINUATION_ADMISSION_KIND);
  assert.equal(admission.approved_plan_result_version, APPROVED_PLAN_READ_RESULT_VERSION);
  assert.equal(admission.project_id, PROJECT_ID);
  assert.equal(admission.conversation_id, CONVERSATION_ID);
  assert.equal(admission.turn_id, TURN_ID);
  assert.equal(admission.task_id, TASK_ID);
  assert.equal(admission.run_id, RUN_ID);
  assert.equal(admission.decision, 'approved');
  assert.equal(admission.plan_result_digest, PLAN_RESULT_DIGEST);
  assert.deepEqual(admission.conversation_head, plan.conversation_head);
  assert.equal(admission.conversation_head_digest, digestHead(plan.conversation_head));
  assert.equal(admission.continuation_id, CONTINUATION_ID);
  assert.equal(admission.admitted_at_ms, 8_000);
  assert.deepEqual(admission.lifecycle, {
    approval_gate: 'verified_current_head_approved_plan',
    continuation_admission: 'admitted_without_starting_run',
    provider_dispatch: 'not_started',
    tool_dispatch: 'not_started',
    source_mutation: 'not_performed',
    git_authority: 'not_present',
    revision_admission: 'not_created',
  });
  assert.deepEqual(admission.authority, {
    admission_authority: 'main_approved_plan_continuation_admission_contract_v1',
    approved_plan_read_authority: 'sqlite_replay_current_head_verified',
    conversation_binding: 'approved_plan_read_current_head_required',
    plan_review: 'approved_current_head',
    renderer_authority: 'not_present',
    provider_dispatch: false,
    credential_readback: false,
    tool_dispatch: 'not_performed',
    source_mutation: 'not_performed',
    git_authority: 'not_present',
    revision_authority: 'not_present',
    cost_authority: 'no_chargeable_dispatch_without_agent_runtime_v1',
  });
  assert.equal(admission.admission_digest, digestAdmission(admission));
  assert.deepEqual(sanitizeBuilderApprovedPlanContinuationAdmission(admission), admission);
  assert.equal(Object.isFrozen(admission), true);
  assert.equal(Object.isFrozen(admission.conversation_head), true);
  assert.equal(Object.isFrozen(admission.lifecycle), true);
  assert.equal(Object.isFrozen(admission.authority), true);
  assert.doesNotMatch(
    JSON.stringify(admission),
    /review_id|reviewer_id|reviewed_at_ms|private_source_context|context_digest|source_tree|file_content|provider_config|provider_secret|credential_secret|credential_value|secret_ref|api[_-]?key|base_url|model|git_candidate_receipt|commit_oid|tree_oid|revision_receipt|save_admission/iu,
  );
});

test('rejects unapproved, stale-authority, mismatched, or hostile approved-plan input', () => {
  assert.throws(() => createBuilderApprovedPlanContinuationAdmission(input({
    approved_plan: approvedPlan({ decision: 'rejected' }),
  })), assertContinuationError);
  assert.throws(() => createBuilderApprovedPlanContinuationAdmission(input({
    approved_plan: approvedPlan({ result_version: 'builder-conversation-approved-plan-read-result.v2' }),
  })), assertContinuationError);
  assert.throws(() => createBuilderApprovedPlanContinuationAdmission(input({
    approved_plan: approvedPlan({ conversation_id: 'builder-conversation:123e4567-e89b-42d3-a456-426614174999' }),
  })), assertContinuationError);
  assert.throws(() => createBuilderApprovedPlanContinuationAdmission(input({
    approved_plan: approvedPlan({
      authority: {
        ...approvedPlan().authority,
        conversation: 'sqlite_replay_observed',
      },
    }),
  })), assertContinuationError);
  assert.throws(() => createBuilderApprovedPlanContinuationAdmission(input({
    approved_plan: approvedPlan({
      authority: {
        ...approvedPlan().authority,
        provider_dispatch: true,
      },
    }),
  })), assertContinuationError);
  assert.throws(() => createBuilderApprovedPlanContinuationAdmission(input({
    approved_plan: { ...approvedPlan(), extra: true },
  })), assertContinuationError);
  assert.throws(() => createBuilderApprovedPlanContinuationAdmission(input({
    continuation_id: 'builder-run:123e4567-e89b-42d3-a456-426614174005',
  })), assertContinuationError);

  const accessorInput = input();
  Object.defineProperty(accessorInput, 'approved_plan', {
    enumerable: true,
    get() { throw new Error('private marker'); },
  });
  assert.throws(() => createBuilderApprovedPlanContinuationAdmission(accessorInput), assertContinuationError);
  assert.throws(() => createBuilderApprovedPlanContinuationAdmission(input({
    approved_plan: new Proxy(approvedPlan(), {}),
  })), assertContinuationError);
});

test('rejects forged continuation admissions that claim execution or changed evidence', () => {
  const admission = createBuilderApprovedPlanContinuationAdmission(input());

  const started = {
    ...admission,
    lifecycle: {
      ...admission.lifecycle,
      continuation_admission: 'run_started',
    },
  };
  assert.throws(() => sanitizeBuilderApprovedPlanContinuationAdmission({
    ...started,
    admission_digest: digestAdmission(started),
  }), assertContinuationError);

  const dispatch = {
    ...admission,
    authority: {
      ...admission.authority,
      tool_dispatch: 'performed',
    },
  };
  assert.throws(() => sanitizeBuilderApprovedPlanContinuationAdmission({
    ...dispatch,
    admission_digest: digestAdmission(dispatch),
  }), assertContinuationError);

  const badHeadDigest = {
    ...admission,
    conversation_head_digest: `sha256:${'d'.repeat(64)}`,
  };
  assert.throws(() => sanitizeBuilderApprovedPlanContinuationAdmission({
    ...badHeadDigest,
    admission_digest: digestAdmission(badHeadDigest),
  }), assertContinuationError);

  assert.throws(() => sanitizeBuilderApprovedPlanContinuationAdmission({
    ...admission,
    plan_result_digest: `sha256:${'e'.repeat(64)}`,
  }), assertContinuationError);
  assert.throws(() => sanitizeBuilderApprovedPlanContinuationAdmission({
    ...admission,
    extra: true,
  }), assertContinuationError);
});

test('source remains a pure approved-plan continuation contract with no IPC, provider, Git, source, or execution authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-approved-plan-continuation-admission.cjs'),
    'utf8',
  );
  assert.match(source, /builder-approved-plan-continuation-admission\.v1/u);
  assert.match(source, /main_approved_plan_continuation_admission_contract_v1/u);
  assert.match(source, /approved_plan_read_current_head_required/u);
  assert.match(source, /admitted_without_starting_run/u);
  assert.match(source, /provider_dispatch:\s*false/u);
  assert.match(source, /credential_readback:\s*false/u);
  assert.match(source, /tool_dispatch:\s*'not_performed'/u);
  assert.match(source, /source_mutation:\s*'not_performed'/u);
  assert.match(source, /git_authority:\s*'not_present'/u);
  assert.match(source, /revision_admission:\s*'not_created'/u);
  assert.doesNotMatch(
    source,
    /require\(['"]electron['"]\)|require\(['"](?:node:fs|fs|fs\/promises|node:path|path)['"]\)|ipcMain|ipcRenderer|contextBridge|BrowserWindow|safeStorage|builder-provider|builder-git|builder-project-main-authority|builder-conversation-main-service|fetch\s*\(|https?:|Authorization|Bearer|child_process|execFile|spawn\s*\(|readFile|writeFile|createReadStream|createWriteStream|readdir|statSync|openSync|eval\s*\(|new Function|shell:\s*true|record_grant|record_revocation|persist_candidate_commit|write_current|stdout|stderr|output_digest|exit_code|result_bytes|file_content|source_tree|commit_oid|tree_oid|provider_secret|credential_secret|credential_value|secret_ref|local-provider-executor|chat_planner|ChatCreatePage|Canvas|JobMeta/iu,
  );
});
