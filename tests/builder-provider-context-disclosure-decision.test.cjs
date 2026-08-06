'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  BUILDER_PERMISSION_FACTS_READ_RESULT_VERSION,
  BUILDER_PERMISSION_GRANT_RECORD_VERSION,
  BUILDER_PERMISSION_POLICY_VERSION,
  createBuilderPermissionEvaluator,
  createBuilderPermissionGrantRecord,
} = require('../electron/builder-permission-authority-contract.cjs');
const {
  createBuilderContextAssembly,
} = require('../electron/builder-context-assembler.cjs');
const {
  createBuilderProviderContextDisclosureDecisionService,
  sanitizeBuilderProviderContextDisclosureDecision,
  BuilderProviderContextDisclosureDecisionError,
} = require('../electron/builder-provider-context-disclosure-decision.cjs');
const {
  createBuilderProviderContextProjection,
} = require('../electron/builder-provider-context-projection.cjs');
const {
  createBuilderWorkingContextState,
} = require('../electron/builder-working-context-state.cjs');

const UUID = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = `builder-project:${UUID}`;
const CONVERSATION_ID = `builder-conversation:${UUID}`;
const ACTOR_ID = 'builder-user:22222222-2222-4222-8222-222222222222';
const ISSUER_ID = 'builder-user:33333333-3333-4333-8333-333333333333';
const APPROVED_PLAN_REF = Object.freeze({
  plan_result_digest: `sha256:${'1'.repeat(64)}`,
  conversation_head_digest: `sha256:${'2'.repeat(64)}`,
  approved_at_ms: 10,
});

function workingContextState() {
  return createBuilderWorkingContextState({
    project_id: PROJECT_ID,
    session_id: 'builder-session:44444444-4444-4444-8444-444444444444',
    task_address_id: 'builder-task-address:55555555-5555-4555-8555-555555555555',
    conversation_id: CONVERSATION_ID,
    objective_summary: 'Build the approved local dashboard.',
    confirmed_constraints: ['Keep it local-first'],
    rejected_constraints: [],
    open_questions: [],
    latest_user_intent: '按批准的方案做',
    source_refs: [],
    compaction_refs: [],
    handoff_refs: [],
    latest_task_capsule: null,
    approved_plan_ref: APPROVED_PLAN_REF,
    base_revision_ref: null,
    invalidated_by: null,
    updated_at_ms: 10,
  });
}

function assembly(overrides = {}) {
  const state = workingContextState();
  return createBuilderContextAssembly({
    assembly_purpose: 'contextual_build',
    project_id: PROJECT_ID,
    latest_user_message: '按批准的方案做',
    working_context_state: state,
    approved_plan_ref: state.approved_plan_ref,
    current_result_ref: null,
    selected_source_summaries: [],
    compaction_summaries: [],
    adopted_handoff_packets: [],
    permission_state: {
      workspace_state: 'bound',
      write_permission: 'ask',
    },
    context_budget: {
      max_segments: 8,
      max_prompt_bytes: 4_096,
      reserved_response_bytes: 1_024,
    },
    assembled_at_ms: 11,
    ...overrides,
  });
}

function grantFor(sourceAssembly) {
  return createBuilderPermissionGrantRecord({
    record_version: BUILDER_PERMISSION_GRANT_RECORD_VERSION,
    policy_version: BUILDER_PERMISSION_POLICY_VERSION,
    project_id: PROJECT_ID,
    actor_id: ACTOR_ID,
    issuer_id: ISSUER_ID,
    scope_kind: 'project',
    action: 'context.disclose',
    resource: {
      resource_kind: 'provider',
      project_id: PROJECT_ID,
      resource_id: `provider:configured/${sourceAssembly.assembly_purpose}`,
    },
    issued_at_ms: 12,
    expires_at_ms: 100,
  });
}

function factsFor(sourceRequest, grants = []) {
  return {
    result_version: BUILDER_PERMISSION_FACTS_READ_RESULT_VERSION,
    permission_authority: 'main_owned_permission_fact_store',
    policy_version: sourceRequest.policy_version,
    actor_id: sourceRequest.actor_id,
    action: sourceRequest.action,
    resource: sourceRequest.resource,
    grants,
    revocations: [],
  };
}

function service({ grants = [], nowMs = 13, mutateDecision = null } = {}) {
  const calls = [];
  const evaluator = createBuilderPermissionEvaluator({
    read_permission_facts: async (request) => {
      calls.push(request);
      return factsFor(request, grants);
    },
  });
  const guard = createBuilderProviderContextDisclosureDecisionService({
    actor_id: ACTOR_ID,
    now_ms: () => nowMs,
    evaluate_permission: async (request) => {
      const decision = await evaluator.evaluate(request);
      return mutateDecision === null ? decision : mutateDecision(decision);
    },
  });
  return { calls, guard };
}

test('returns denied disclosure from deny-by-default permission facts', async () => {
  const sourceAssembly = assembly();
  const { calls, guard } = service();
  const result = await guard.decide({ context_assembly: sourceAssembly });

  assert.deepEqual(calls, [{
    policy_version: BUILDER_PERMISSION_POLICY_VERSION,
    actor_id: ACTOR_ID,
    action: 'context.disclose',
    resource: {
      resource_kind: 'provider',
      project_id: PROJECT_ID,
      resource_id: 'provider:configured/contextual_build',
    },
    now_ms: 13,
  }]);
  assert.equal(result.disclosure_decision.decision, 'denied');
  assert.equal(result.disclosure_decision.approved_at_ms, null);
  assert.equal(result.permission_evidence.decision, 'denied');
  assert.equal(result.permission_evidence.permission_id, null);
  assert.deepEqual(sanitizeBuilderProviderContextDisclosureDecision(structuredClone(result)), result);

  const projection = createBuilderProviderContextProjection({
    context_assembly: sourceAssembly,
    disclosure_decision: result.disclosure_decision,
    projected_at_ms: 14,
  });
  assert.equal(projection.projection_status, 'blocked');
  assert.equal(projection.blocked_reason, 'context_disclosure_denied');
});

test('returns approved disclosure only for an exact active provider context grant', async () => {
  const sourceAssembly = assembly();
  const matchingGrant = grantFor(sourceAssembly);
  const { guard } = service({ grants: [matchingGrant] });
  const result = await guard.decide({ context_assembly: sourceAssembly });

  assert.equal(result.disclosure_decision.decision, 'approved');
  assert.equal(result.disclosure_decision.approved_by, 'local_user');
  assert.equal(result.disclosure_decision.approved_at_ms, 13);
  assert.equal(result.disclosure_decision.provider_scope, 'configured_provider');
  assert.equal(result.disclosure_decision.purpose, 'contextual_build');
  assert.equal(result.permission_evidence.permission_id, matchingGrant.permission_id);

  const projection = createBuilderProviderContextProjection({
    context_assembly: sourceAssembly,
    disclosure_decision: result.disclosure_decision,
    projected_at_ms: 14,
  });
  assert.equal(projection.projection_status, 'ready');
  assert.equal(projection.provider_context.purpose, 'contextual_build');
});

test('fails closed for drifted permission decisions and future assemblies', async () => {
  const sourceAssembly = assembly();
  await assert.rejects(
    service({
      grants: [grantFor(sourceAssembly)],
      mutateDecision: (decision) => ({
        ...decision,
        action: 'network.request',
      }),
    }).guard.decide({ context_assembly: sourceAssembly }),
    BuilderProviderContextDisclosureDecisionError,
  );
  await assert.rejects(
    service({ grants: [grantFor(sourceAssembly)], nowMs: 10 }).guard.decide({ context_assembly: sourceAssembly }),
    BuilderProviderContextDisclosureDecisionError,
  );
  assert.throws(
    () => sanitizeBuilderProviderContextDisclosureDecision({
      ...(awaitablePlaceholder()),
    }),
    BuilderProviderContextDisclosureDecisionError,
  );
});

function awaitablePlaceholder() {
  return {
    result_version: 'builder-provider-context-disclosure-decision.v1',
    decision_id: `builder-provider-context-disclosure-decision:${'f'.repeat(64)}`,
    disclosure_decision: {
      decision: 'approved',
      approved_by: 'local_user',
      approved_at_ms: 13,
      provider_scope: 'configured_provider',
      purpose: 'contextual_build',
    },
    permission_evidence: {
      policy_version: BUILDER_PERMISSION_POLICY_VERSION,
      actor_id: ACTOR_ID,
      action: 'context.disclose',
      resource: {
        resource_kind: 'provider',
        project_id: PROJECT_ID,
        resource_id: 'provider:configured/contextual_build',
      },
      evaluated_at_ms: 13,
      decision: 'denied',
      reason: 'no_matching_active_grant',
      permission_id: null,
      permission_authority: 'builder_permission_facts_deny_by_default_v1',
      ui_selection_authority: 'not_permission',
    },
    authority: {
      provider_context_disclosure_decision: 'main_side_permission_evaluation_adapter',
      context_assembly: 'caller_provided_verified',
      permission_authority: 'main_owned_permission_facts_deny_by_default',
      renderer_authority: 'not_accepted',
      ui_selection_authority: 'not_permission',
      provider_dispatch: 'not_performed',
      tool_dispatch: 'not_performed',
      source_mutation: 'not_performed',
      git_mutation: 'not_performed',
      sqlite_write: 'not_performed',
      permission_grant: 'not_performed',
      revision_admission: 'not_performed',
    },
  };
}

test('source remains a main-side permission adapter with no dispatch or grant authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-provider-context-disclosure-decision.cjs'),
    'utf8',
  );

  assert.doesNotMatch(source, /\b(?:fetch|XMLHttpRequest|ipcMain|ipcRenderer|BrowserWindow|safeStorage)\b/u);
  assert.doesNotMatch(source, /\b(?:child_process|spawn|execFile|dugite|DatabaseSync|node:sqlite|sqlite3)\b/u);
  assert.doesNotMatch(source, /provider_dispatch:\s*'performed'|permission_grant:\s*'performed'/u);
  assert.match(source, /provider_dispatch:\s*'not_performed'/u);
  assert.match(source, /permission_grant:\s*'not_performed'/u);
});
