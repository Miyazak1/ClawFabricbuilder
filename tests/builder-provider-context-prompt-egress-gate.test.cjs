const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  createBuilderContextAssembly,
} = require('../electron/builder-context-assembler.cjs');
const {
  createBuilderProviderContextProjection,
} = require('../electron/builder-provider-context-projection.cjs');
const {
  assessBuilderProviderContextPromptEgress,
  sanitizeBuilderProviderContextPromptEgressGate,
  BuilderProviderContextPromptEgressGateError,
} = require('../electron/builder-provider-context-prompt-egress-gate.cjs');
const {
  createBuilderWorkingContextState,
} = require('../electron/builder-working-context-state.cjs');

const UUID = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = `builder-project:${UUID}`;
const CONVERSATION_ID = `builder-conversation:${UUID}`;
const APPROVED_PLAN_REF = Object.freeze({
  plan_result_digest: `sha256:${'1'.repeat(64)}`,
  conversation_head_digest: `sha256:${'2'.repeat(64)}`,
  approved_at_ms: 10,
});

function workingContextState(overrides = {}) {
  return createBuilderWorkingContextState({
    project_id: PROJECT_ID,
    session_id: 'builder-session:22222222-2222-4222-8222-222222222222',
    task_address_id: 'builder-task-address:33333333-3333-4333-8333-333333333333',
    conversation_id: CONVERSATION_ID,
    objective_summary: 'Build the approved dashboard with clear navigation.',
    confirmed_constraints: ['Keep it local-first', 'Do not publish anything'],
    rejected_constraints: ['No social feed yet'],
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
    ...overrides,
  });
}

function assembly(overrides = {}) {
  const state = workingContextState(overrides.working_context_state_overrides ?? {});
  return createBuilderContextAssembly({
    assembly_purpose: 'contextual_build',
    project_id: PROJECT_ID,
    latest_user_message: '按批准的方案做',
    working_context_state: state,
    approved_plan_ref: state.approved_plan_ref,
    current_result_ref: null,
    selected_source_summaries: [{
      source_kind: 'project_summary',
      source_digest: `sha256:${'3'.repeat(64)}`,
      summary: 'The current project has a simple dashboard shell.',
      priority: 10,
    }],
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

function disclosureDecision(overrides = {}) {
  return {
    decision: 'not_requested',
    approved_by: null,
    approved_at_ms: null,
    provider_scope: null,
    purpose: null,
    ...overrides,
  };
}

function projection(overrides = {}) {
  return createBuilderProviderContextProjection({
    context_assembly: assembly(overrides.assembly_overrides ?? {}),
    disclosure_decision: disclosureDecision(overrides.disclosure_decision_overrides ?? {}),
    projected_at_ms: overrides.projected_at_ms ?? 12,
  });
}

function readyProjection() {
  return projection({
    disclosure_decision_overrides: {
      decision: 'approved',
      approved_by: 'local_user',
      approved_at_ms: 12,
      provider_scope: 'configured_provider',
      purpose: 'contextual_build',
    },
    projected_at_ms: 13,
  });
}

test('keeps approved provider context out of prompt until a prompt bridge exists', () => {
  const sourceProjection = readyProjection();
  const result = assessBuilderProviderContextPromptEgress({
    provider_context_projection: sourceProjection,
    assessed_at_ms: 14,
  });

  assert.match(result.gate_id, /^builder-provider-context-prompt-egress-gate:[0-9a-f]{64}$/u);
  assert.equal(result.projection_status, 'ready');
  assert.equal(result.prompt_egress_status, 'blocked_by_prompt_bridge');
  assert.equal(result.blocked_reason, 'prompt_bridge_not_enabled');
  assert.equal(result.next_required_step, 'implement_explicit_prompt_bridge');
  assert.equal(result.provider_prompt_context, null);
  assert.deepEqual(result.source_ref, {
    projection_id: sourceProjection.projection_id,
    projected_at_ms: sourceProjection.projected_at_ms,
  });
  assert.deepEqual(sanitizeBuilderProviderContextPromptEgressGate(structuredClone(result)), result);
  assert.doesNotMatch(
    JSON.stringify(result),
    /Build the approved dashboard|Keep it local-first|simple dashboard shell|builder-context-assembly|sha256:|api[_-]?key|credential/u,
  );
});

test('keeps blocked disclosure out of prompt and points to the safe next step', () => {
  const notApproved = assessBuilderProviderContextPromptEgress({
    provider_context_projection: projection(),
    assessed_at_ms: 13,
  });
  assert.equal(notApproved.projection_status, 'blocked');
  assert.equal(notApproved.prompt_egress_status, 'blocked_by_context_disclosure');
  assert.equal(notApproved.blocked_reason, 'context_disclosure_not_approved');
  assert.equal(notApproved.next_required_step, 'approve_context_disclosure');
  assert.equal(notApproved.provider_prompt_context, null);

  const denied = assessBuilderProviderContextPromptEgress({
    provider_context_projection: projection({
      disclosure_decision_overrides: { decision: 'denied' },
    }),
    assessed_at_ms: 13,
  });
  assert.equal(denied.projection_status, 'blocked');
  assert.equal(denied.prompt_egress_status, 'blocked_by_context_disclosure');
  assert.equal(denied.blocked_reason, 'context_disclosure_denied');
  assert.equal(denied.next_required_step, 'context_disclosure_denied');
  assert.equal(denied.provider_prompt_context, null);
});

test('fails closed for forged gates, forged projections, and future projections', () => {
  const ready = readyProjection();
  const gate = assessBuilderProviderContextPromptEgress({
    provider_context_projection: ready,
    assessed_at_ms: 14,
  });

  assert.throws(
    () => sanitizeBuilderProviderContextPromptEgressGate({
      ...gate,
      provider_prompt_context: { segments: [{ kind: 'working_context_objective', text: 'Leaked context.' }] },
    }),
    BuilderProviderContextPromptEgressGateError,
  );
  assert.throws(
    () => assessBuilderProviderContextPromptEgress({
      provider_context_projection: {
        ...ready,
        projection_id: 'builder-provider-context-projection:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
      },
      assessed_at_ms: 14,
    }),
    BuilderProviderContextPromptEgressGateError,
  );
  assert.throws(
    () => assessBuilderProviderContextPromptEgress({
      provider_context_projection: ready,
      assessed_at_ms: 12,
    }),
    BuilderProviderContextPromptEgressGateError,
  );
});

test('source remains a pure prompt egress gate without dispatch authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-provider-context-prompt-egress-gate.cjs'),
    'utf8',
  );

  assert.doesNotMatch(source, /\b(?:fetch|XMLHttpRequest|ipcMain|ipcRenderer|BrowserWindow|safeStorage)\b/u);
  assert.doesNotMatch(source, /\b(?:child_process|spawn|execFile|dugite|DatabaseSync|node:sqlite|sqlite3)\b/u);
  assert.doesNotMatch(
    source,
    /provider_dispatch:\s*'performed'|provider_context_body:\s*'included'|prompt_bridge:\s*'enabled'|source_mutation:\s*'performed'|git_mutation:\s*'performed'/u,
  );
  assert.match(source, /provider_dispatch:\s*'not_performed'/u);
  assert.match(source, /provider_context_body:\s*'not_included'/u);
  assert.match(source, /prompt_bridge:\s*'not_enabled'/u);
});
