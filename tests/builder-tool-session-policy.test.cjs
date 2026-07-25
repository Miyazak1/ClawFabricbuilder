'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  BUILDER_TOOL_SESSION_POLICY_VERSION,
  TOOL_SESSION_POLICY_KIND,
  DEFAULT_BUILDER_TOOL_SESSION_LIMITS,
  BuilderToolSessionPolicyError,
  createBuilderToolSessionPolicy,
  sanitizeBuilderToolSessionPolicy,
} = require('../electron/builder-tool-session-policy.cjs');

const PROJECT_UUID = '123e4567-e89b-42d3-a456-426614174000';
const PROJECT_ID = `builder-project:${PROJECT_UUID}`;
const CONVERSATION_ID = `builder-conversation:${PROJECT_UUID}`;
const TURN_ID = 'builder-turn:123e4567-e89b-42d3-a456-426614174002';
const TASK_ID = 'builder-task:123e4567-e89b-42d3-a456-426614174003';
const RUN_ID = 'builder-run:123e4567-e89b-42d3-a456-426614174004';

function policyInput(overrides = {}) {
  return {
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    turn_id: TURN_ID,
    task_id: TASK_ID,
    run_id: RUN_ID,
    issued_at_ms: 100,
    limits: { ...DEFAULT_BUILDER_TOOL_SESSION_LIMITS },
    ...overrides,
  };
}

function assertPolicyError(error) {
  assert.equal(error instanceof BuilderToolSessionPolicyError, true);
  assert.equal(error.code, 'builder_tool_session_policy_invalid');
  assert.equal(error.message, 'The tool session policy could not be verified.');
  assert.equal(error.retryable, false);
  return true;
}

test('creates a bounded main-only tool session policy without dispatch authority', () => {
  const policy = createBuilderToolSessionPolicy(policyInput());

  assert.equal(policy.policy_version, BUILDER_TOOL_SESSION_POLICY_VERSION);
  assert.equal(policy.policy_kind, TOOL_SESSION_POLICY_KIND);
  assert.equal(policy.project_id, PROJECT_ID);
  assert.equal(policy.conversation_id, CONVERSATION_ID);
  assert.equal(policy.run_id, RUN_ID);
  assert.deepEqual(policy.limits, DEFAULT_BUILDER_TOOL_SESSION_LIMITS);
  assert.deepEqual(policy.lifecycle, {
    step_admission: 'bounded_by_main_policy',
    tool_call_admission: 'bounded_pre_dispatch_only',
    dispatch_admission: 'not_performed_by_policy_contract',
    execution_admission: 'not_performed_by_policy_contract',
    retry_admission: 'bounded_not_started',
    cancellation_admission: 'policy_only_not_cancelled',
    restart_admission: 'policy_must_be_reissued_after_restart',
    raw_output_admission: 'not_included',
    revision_admission: 'not_created',
  });
  assert.deepEqual(policy.authority, {
    policy_authority: 'main_tool_session_policy_contract_v1',
    conversation_binding: 'ids_only_host_replay_required',
    issuance_authority: 'trusted_main_run_context_required',
    digest_authority: 'integrity_digest_not_issuer_proof_v1',
    renderer_authority: 'not_present',
    provider_dispatch: false,
    credential_readback: false,
    tool_dispatch: 'not_performed_by_policy_contract',
    raw_output_storage: 'not_present',
    cost_authority: 'no_chargeable_dispatches_without_runtime_meter_v1',
    git_authority: 'not_present',
  });
  assert.match(policy.policy_digest, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(Object.isFrozen(policy), true);
  assert.equal(Object.isFrozen(policy.limits), true);
  assert.equal(Object.isFrozen(policy.lifecycle), true);
  assert.equal(Object.isFrozen(policy.authority), true);
  assert.deepEqual(sanitizeBuilderToolSessionPolicy(structuredClone(policy)), policy);
});

test('policy digest is deterministic and detects lifecycle, authority, or limit drift', () => {
  const first = createBuilderToolSessionPolicy(policyInput());
  const second = createBuilderToolSessionPolicy(policyInput());

  assert.equal(first.policy_digest, second.policy_digest);

  for (const drift of [
    { ...first, policy_kind: 'builder_tool_session' },
    { ...first, limits: { ...first.limits, max_steps: 17 } },
    { ...first, lifecycle: { ...first.lifecycle, dispatch_admission: 'performed' } },
    { ...first, authority: { ...first.authority, renderer_authority: 'renderer_selected' } },
    { ...first, policy_digest: `sha256:${'f'.repeat(64)}` },
  ]) {
    assert.throws(() => sanitizeBuilderToolSessionPolicy(drift), assertPolicyError);
  }
});

test('accepts an explicit bounded private raw output limit while default remains zero', () => {
  const defaultPolicy = createBuilderToolSessionPolicy(policyInput());
  const outputPolicy = createBuilderToolSessionPolicy(policyInput({
    limits: {
      ...DEFAULT_BUILDER_TOOL_SESSION_LIMITS,
      max_raw_output_bytes: 1_024,
    },
  }));

  assert.equal(defaultPolicy.limits.max_raw_output_bytes, 0);
  assert.equal(outputPolicy.limits.max_raw_output_bytes, 1_024);
  assert.notEqual(outputPolicy.policy_digest, defaultPolicy.policy_digest);
  assert.deepEqual(sanitizeBuilderToolSessionPolicy(structuredClone(outputPolicy)), outputPolicy);
});

test('rejects policy limits outside the bounded session envelope', () => {
  for (const limits of [
    { ...DEFAULT_BUILDER_TOOL_SESSION_LIMITS, max_steps: 0 },
    { ...DEFAULT_BUILDER_TOOL_SESSION_LIMITS, max_steps: 33 },
    { ...DEFAULT_BUILDER_TOOL_SESSION_LIMITS, max_tool_calls: 33 },
    { ...DEFAULT_BUILDER_TOOL_SESSION_LIMITS, max_tool_calls: 17 },
    { ...DEFAULT_BUILDER_TOOL_SESSION_LIMITS, max_retries: 5 },
    { ...DEFAULT_BUILDER_TOOL_SESSION_LIMITS, max_retries: 16 },
    { ...DEFAULT_BUILDER_TOOL_SESSION_LIMITS, max_step_timeout_ms: 120_001 },
    { ...DEFAULT_BUILDER_TOOL_SESSION_LIMITS, max_total_timeout_ms: 300_001 },
    { ...DEFAULT_BUILDER_TOOL_SESSION_LIMITS, max_step_timeout_ms: 120_000, max_total_timeout_ms: 119_999 },
    { ...DEFAULT_BUILDER_TOOL_SESSION_LIMITS, max_public_summary_bytes: 161 },
    { ...DEFAULT_BUILDER_TOOL_SESSION_LIMITS, max_raw_output_bytes: -1 },
    { ...DEFAULT_BUILDER_TOOL_SESSION_LIMITS, max_raw_output_bytes: 1.5 },
    { ...DEFAULT_BUILDER_TOOL_SESSION_LIMITS, max_raw_output_bytes: 64 * 1_024 + 1 },
    { ...DEFAULT_BUILDER_TOOL_SESSION_LIMITS, max_chargeable_dispatches: 1 },
    { ...DEFAULT_BUILDER_TOOL_SESSION_LIMITS, max_steps: 1, max_retries: 1 },
  ]) {
    assert.throws(
      () => createBuilderToolSessionPolicy(policyInput({ limits })),
      assertPolicyError,
    );
  }
});

test('rejects hostile input without invoking getters or leaking private material', () => {
  let getterCalls = 0;
  const accessorInput = {
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    turn_id: TURN_ID,
    task_id: TASK_ID,
    run_id: RUN_ID,
    issued_at_ms: 100,
  };
  Object.defineProperty(accessorInput, 'limits', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return { ...DEFAULT_BUILDER_TOOL_SESSION_LIMITS };
    },
  });

  for (const invalid of [
    null,
    {},
    { ...policyInput(), extra: true },
    new Proxy(policyInput(), {}),
    accessorInput,
    policyInput({ conversation_id: 'builder-conversation:123e4567-e89b-42d3-a456-426614174099' }),
    policyInput({ issued_at_ms: -1 }),
    policyInput({ limits: { ...DEFAULT_BUILDER_TOOL_SESSION_LIMITS, max_steps: 'private-marker' } }),
  ]) {
    assert.throws(() => createBuilderToolSessionPolicy(invalid), (error) => {
      assertPolicyError(error);
      assert.doesNotMatch(`${error.message}\n${error.stack}`, /private-marker|provider_secret|Authorization|Bearer/iu);
      return true;
    });
  }
  assert.equal(getterCalls, 0);
});

test('policy carries no renderer, provider, credential, Git, execution, or raw output evidence', () => {
  const policy = createBuilderToolSessionPolicy(policyInput());
  const serialized = JSON.stringify(policy);

  assert.equal(policy.authority.renderer_authority, 'not_present');
  assert.equal(policy.authority.provider_dispatch, false);
  assert.equal(policy.authority.credential_readback, false);
  assert.equal(policy.authority.tool_dispatch, 'not_performed_by_policy_contract');
  assert.equal(policy.authority.issuance_authority, 'trusted_main_run_context_required');
  assert.equal(policy.authority.digest_authority, 'integrity_digest_not_issuer_proof_v1');
  assert.equal(policy.authority.raw_output_storage, 'not_present');
  assert.equal(policy.authority.git_authority, 'not_present');
  assert.equal(policy.limits.max_raw_output_bytes, 0);
  assert.equal(policy.limits.max_chargeable_dispatches, 0);
  assert.doesNotMatch(
    serialized,
    /stdout|stderr|exit_code|result_bytes|file_content|source_tree|commit_oid|tree_oid|provider_secret|credential_secret|credential_value|secret_ref|Authorization|Bearer|ipcRenderer|BrowserWindow/iu,
  );
});

test('source remains a pure bounded policy contract with no IPC, provider, Git, or executor authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-tool-session-policy.cjs'),
    'utf8',
  );
  assert.match(source, /builder-tool-session-policy\.v1/u);
  assert.match(source, /main_tool_session_policy_contract_v1/u);
  assert.match(source, /max_steps:\s*16/u);
  assert.match(source, /max_tool_calls:\s*16/u);
  assert.match(source, /max_retries:\s*2/u);
  assert.match(source, /max_step_timeout_ms:\s*120_000/u);
  assert.match(source, /max_total_timeout_ms:\s*300_000/u);
  assert.match(source, /const MAX_TOOL_RAW_OUTPUT_BYTES = 64 \* 1_024/u);
  assert.match(source, /max_raw_output_bytes:\s*0/u);
  assert.match(source, /max_raw_output_bytes:\s*MAX_TOOL_RAW_OUTPUT_BYTES/u);
  assert.match(source, /max_chargeable_dispatches:\s*0/u);
  assert.match(source, /raw_output_admission:\s*'not_included'/u);
  assert.match(source, /issuance_authority:\s*'trusted_main_run_context_required'/u);
  assert.match(source, /digest_authority:\s*'integrity_digest_not_issuer_proof_v1'/u);
  assert.match(source, /cost_authority:\s*'no_chargeable_dispatches_without_runtime_meter_v1'/u);
  assert.doesNotMatch(
    source,
    /require\(['"]electron['"]\)|ipcMain|ipcRenderer|contextBridge|BrowserWindow|safeStorage|builder-provider|builder-git|builder-project-main-authority|fetch\s*\(|require\(['"](?:node:http|node:https|http|https)['"]\)|child_process|execFile|spawn\s*\(|eval\s*\(|new Function|shell:\s*true|persist_candidate_commit|write_current|stdout|stderr|output_digest|exit_code|result_bytes|file_content|source_tree|commit_oid|tree_oid|provider_secret|credential_secret|credential_value|secret_ref|local-provider-executor|chat_planner|ChatCreatePage|Canvas|JobMeta/iu,
  );
});
