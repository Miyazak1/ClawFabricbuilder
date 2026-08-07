'use strict';

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
  createBuilderProviderContextPromptBridgeAdmission,
  sanitizeBuilderProviderContextPromptBridgeAdmission,
  BuilderProviderContextPromptBridgeAdmissionError,
  PROVIDER_CONTEXT_PROMPT_BRIDGE_CONSENT_VERSION,
} = require('../electron/builder-provider-context-prompt-bridge-admission.cjs');
const {
  assessBuilderProviderContextPromptEgress,
} = require('../electron/builder-provider-context-prompt-egress-gate.cjs');
const {
  createBuilderRunContextSnapshot,
} = require('../electron/builder-run-context-snapshot.cjs');
const {
  createBuilderWorkingContextState,
} = require('../electron/builder-working-context-state.cjs');

const UUID = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = `builder-project:${UUID}`;
const CONVERSATION_ID = `builder-conversation:${UUID}`;
const TURN_ID = `builder-turn:${UUID}`;
const TASK_ID = `builder-task:${UUID}`;
const RUN_ID = `builder-run:${UUID}`;
const MESSAGE_ID = `builder-message:${UUID}`;
const ROUTE_DECISION_ID = `builder-route-decision:${UUID}`;
const PROVIDER_CONFIG_DIGEST = `sha256:${'8'.repeat(64)}`;
const BASE_REVISION = Object.freeze({
  revision_receipt_digest: `sha256:${'a'.repeat(64)}`,
  commit_oid: 'b'.repeat(40),
});
const APPROVED_PLAN_REF = Object.freeze({
  plan_result_digest: `sha256:${'6'.repeat(64)}`,
  conversation_head_digest: `sha256:${'7'.repeat(64)}`,
  approved_at_ms: 9,
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
    latest_user_intent: 'Build from the approved plan.',
    source_refs: [],
    compaction_refs: [],
    handoff_refs: [],
    latest_task_capsule: null,
    approved_plan_ref: APPROVED_PLAN_REF,
    base_revision_ref: {
      revision_receipt_digest: BASE_REVISION.revision_receipt_digest,
    },
    invalidated_by: null,
    updated_at_ms: 10,
    ...overrides,
  });
}

function contextAssembly(overrides = {}) {
  const state = overrides.working_context_state ?? workingContextState();
  return createBuilderContextAssembly({
    assembly_purpose: 'contextual_build',
    project_id: PROJECT_ID,
    latest_user_message: 'Build from the approved plan.',
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
      write_permission: 'allowed',
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

function readyProjection(overrides = {}) {
  const assembly = overrides.context_assembly ?? contextAssembly();
  return createBuilderProviderContextProjection({
    context_assembly: assembly,
    disclosure_decision: {
      decision: 'approved',
      approved_by: 'local_user',
      approved_at_ms: 12,
      provider_scope: 'configured_provider',
      purpose: 'contextual_build',
    },
    projected_at_ms: 13,
    ...overrides,
  });
}

function blockedProjection() {
  return createBuilderProviderContextProjection({
    context_assembly: contextAssembly(),
    disclosure_decision: {
      decision: 'denied',
      approved_by: null,
      approved_at_ms: null,
      provider_scope: null,
      purpose: null,
    },
    projected_at_ms: 13,
  });
}

function promptEgressGate(providerContextProjection) {
  return assessBuilderProviderContextPromptEgress({
    provider_context_projection: providerContextProjection,
    assessed_at_ms: 13,
  });
}

function routeDecision() {
  return {
    decision_id: ROUTE_DECISION_ID,
    decision_version: 'builder-composer-route-decision.v1',
    project_id: PROJECT_ID,
    message_id: MESSAGE_ID,
    task_id: TASK_ID,
    route: 'build',
    confidence: 'high',
    matched_signals: ['clear_build'],
    downgraded_from: null,
    downgrade_reason: null,
    required_permissions: ['write_project'],
    permission_result: 'allowed',
    dispatch: 'build',
    decided_at_ms: 10,
  };
}

function runContextSnapshot(contextAssemblyValue, providerContextProjection, gate) {
  return createBuilderRunContextSnapshot({
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    turn_id: TURN_ID,
    run_id: RUN_ID,
    task_id: TASK_ID,
    message_id: MESSAGE_ID,
    route_decision: routeDecision(),
    latest_task_capsule: null,
    working_context_state: workingContextState(),
    context_assembly: contextAssemblyValue,
    provider_context_projection: providerContextProjection,
    provider_context_prompt_egress_gate: gate,
    base_revision: BASE_REVISION,
    created_at_ms: 13,
  });
}

function bridgeConsent(providerContextProjection, overrides = {}) {
  return {
    consent_version: PROVIDER_CONTEXT_PROMPT_BRIDGE_CONSENT_VERSION,
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    purpose: 'contextual_build',
    provider_scope: 'configured_provider',
    provider_config_digest: PROVIDER_CONFIG_DIGEST,
    context_digest: providerContextProjection.source_refs.context_digest,
    projection_id: providerContextProjection.projection_id,
    approved_at_ms: 14,
    expires_at_ms: 30,
    revoked_at_ms: null,
    ...overrides,
  };
}

function fixture() {
  const assembly = contextAssembly();
  const projection = readyProjection({ context_assembly: assembly });
  const gate = promptEgressGate(projection);
  return {
    assembly,
    projection,
    gate,
    snapshot: runContextSnapshot(assembly, projection, gate),
  };
}

function assertAdmissionError(fn) {
  assert.throws(fn, BuilderProviderContextPromptBridgeAdmissionError);
}

test('admits provider context for prompt use only after explicit bridge consent', () => {
  const facts = fixture();
  const admission = createBuilderProviderContextPromptBridgeAdmission({
    run_context_snapshot: facts.snapshot,
    provider_context_projection: facts.projection,
    provider_context_prompt_egress_gate: facts.gate,
    bridge_consent: bridgeConsent(facts.projection),
    provider_config_digest: PROVIDER_CONFIG_DIGEST,
    admitted_at_ms: 15,
  });

  assert.match(admission.admission_id, /^builder-provider-context-prompt-bridge-admission:[0-9a-f]{64}$/u);
  assert.equal(admission.project_id, PROJECT_ID);
  assert.equal(admission.conversation_id, CONVERSATION_ID);
  assert.equal(admission.purpose, 'contextual_build');
  assert.equal(admission.provider_scope, 'configured_provider');
  assert.equal(admission.provider_config_digest, PROVIDER_CONFIG_DIGEST);
  assert.equal(admission.provider_prompt_context.context_version, 'builder-provider-context.v1');
  assert.equal(admission.provider_prompt_context.source, 'context_assembler');
  assert.deepEqual(
    admission.provider_prompt_context.segments.map((segment) => segment.kind),
    [
      'latest_user_message',
      'working_context_objective',
      'working_context_constraints',
      'approved_plan',
      'selected_source_summary',
    ],
  );
  assert.deepEqual(admission.source_ref, {
    snapshot_id: facts.snapshot.snapshot_id,
    snapshot_context_digest: facts.snapshot.context_digest,
    projection_id: facts.projection.projection_id,
    gate_id: facts.gate.gate_id,
    context_digest: facts.projection.source_refs.context_digest,
    projected_at_ms: 13,
    gate_assessed_at_ms: 13,
    consent_approved_at_ms: 14,
    consent_expires_at_ms: 30,
  });
  assert.equal(admission.authority.provider_dispatch, 'not_performed');
  assert.equal(admission.authority.provider_context_body, 'main_only_provider_prompt_context');
  assert.deepEqual(sanitizeBuilderProviderContextPromptBridgeAdmission(structuredClone(admission)), admission);
  assert.doesNotMatch(
    JSON.stringify(admission),
    /api[_-]?key|credential|source_tree|git_candidate_receipt|permission_id|provider_config_snapshot/u,
  );
});

test('fails closed without ready projection, prompt-bridge gate, or current consent', () => {
  const facts = fixture();
  const deniedProjection = blockedProjection();
  const deniedGate = promptEgressGate(deniedProjection);

  assertAdmissionError(() => createBuilderProviderContextPromptBridgeAdmission({
    run_context_snapshot: facts.snapshot,
    provider_context_projection: deniedProjection,
    provider_context_prompt_egress_gate: deniedGate,
    bridge_consent: bridgeConsent(deniedProjection),
    provider_config_digest: PROVIDER_CONFIG_DIGEST,
    admitted_at_ms: 15,
  }));
  assertAdmissionError(() => createBuilderProviderContextPromptBridgeAdmission({
    run_context_snapshot: facts.snapshot,
    provider_context_projection: facts.projection,
    provider_context_prompt_egress_gate: {
      ...facts.gate,
      prompt_egress_status: 'blocked_by_context_disclosure',
    },
    bridge_consent: bridgeConsent(facts.projection),
    provider_config_digest: PROVIDER_CONFIG_DIGEST,
    admitted_at_ms: 15,
  }));
  assertAdmissionError(() => createBuilderProviderContextPromptBridgeAdmission({
    run_context_snapshot: facts.snapshot,
    provider_context_projection: facts.projection,
    provider_context_prompt_egress_gate: facts.gate,
    bridge_consent: bridgeConsent(facts.projection, {
      expires_at_ms: 15,
    }),
    provider_config_digest: PROVIDER_CONFIG_DIGEST,
    admitted_at_ms: 15,
  }));
  assertAdmissionError(() => createBuilderProviderContextPromptBridgeAdmission({
    run_context_snapshot: facts.snapshot,
    provider_context_projection: facts.projection,
    provider_context_prompt_egress_gate: facts.gate,
    bridge_consent: bridgeConsent(facts.projection, {
      revoked_at_ms: 14,
    }),
    provider_config_digest: PROVIDER_CONFIG_DIGEST,
    admitted_at_ms: 15,
  }));
});

test('fails closed for project, conversation, provider, projection, context, and snapshot drift', () => {
  const facts = fixture();
  const otherAssembly = contextAssembly({
    context_budget: {
      max_segments: 8,
      max_prompt_bytes: 8_192,
      reserved_response_bytes: 1_024,
    },
  });
  const otherProjection = readyProjection({
    context_assembly: otherAssembly,
    projected_at_ms: 13,
  });

  for (const overrides of [
    { project_id: 'builder-project:22222222-2222-4222-8222-222222222222' },
    { conversation_id: 'builder-conversation:22222222-2222-4222-8222-222222222222' },
    { provider_config_digest: `sha256:${'9'.repeat(64)}` },
    { projection_id: otherProjection.projection_id },
    { context_digest: otherProjection.source_refs.context_digest },
    { purpose: 'plan' },
  ]) {
    assertAdmissionError(() => createBuilderProviderContextPromptBridgeAdmission({
      run_context_snapshot: facts.snapshot,
      provider_context_projection: facts.projection,
      provider_context_prompt_egress_gate: facts.gate,
      bridge_consent: bridgeConsent(facts.projection, overrides),
      provider_config_digest: PROVIDER_CONFIG_DIGEST,
      admitted_at_ms: 15,
    }));
  }

  assertAdmissionError(() => createBuilderProviderContextPromptBridgeAdmission({
    run_context_snapshot: facts.snapshot,
    provider_context_projection: facts.projection,
    provider_context_prompt_egress_gate: facts.gate,
    bridge_consent: bridgeConsent(facts.projection),
    provider_config_digest: `sha256:${'9'.repeat(64)}`,
    admitted_at_ms: 15,
  }));

  assertAdmissionError(() => createBuilderProviderContextPromptBridgeAdmission({
    run_context_snapshot: {
      ...facts.snapshot,
      provider_context_projection_ref: {
        ...facts.snapshot.provider_context_projection_ref,
        projection_id: otherProjection.projection_id,
      },
    },
    provider_context_projection: facts.projection,
    provider_context_prompt_egress_gate: facts.gate,
    bridge_consent: bridgeConsent(facts.projection),
    provider_config_digest: PROVIDER_CONFIG_DIGEST,
    admitted_at_ms: 15,
  }));
});

test('rejects forged admission bodies and hostile prompt context text', () => {
  const facts = fixture();
  const admission = createBuilderProviderContextPromptBridgeAdmission({
    run_context_snapshot: facts.snapshot,
    provider_context_projection: facts.projection,
    provider_context_prompt_egress_gate: facts.gate,
    bridge_consent: bridgeConsent(facts.projection),
    provider_config_digest: PROVIDER_CONFIG_DIGEST,
    admitted_at_ms: 15,
  });

  assertAdmissionError(() => sanitizeBuilderProviderContextPromptBridgeAdmission({
    ...admission,
    provider_dispatch: 'performed',
  }));
  assertAdmissionError(() => sanitizeBuilderProviderContextPromptBridgeAdmission({
    ...admission,
    provider_prompt_context: {
      ...admission.provider_prompt_context,
      segments: [{
        ...admission.provider_prompt_context.segments[0],
        text: 'api_key: secret-value',
      }],
    },
  }));
  assertAdmissionError(() => sanitizeBuilderProviderContextPromptBridgeAdmission({
    ...admission,
    source_ref: {
      ...admission.source_ref,
      consent_expires_at_ms: 15,
    },
  }));
});

test('source remains a main-only bridge admission contract without dispatch or storage authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-provider-context-prompt-bridge-admission.cjs'),
    'utf8',
  );

  assert.doesNotMatch(source, /\b(?:fetch|XMLHttpRequest|ipcMain|ipcRenderer|BrowserWindow|safeStorage)\b/u);
  assert.doesNotMatch(source, /\b(?:child_process|spawn|execFile|dugite|DatabaseSync|node:sqlite|sqlite3)\b/u);
  assert.doesNotMatch(
    source,
    /provider_dispatch:\s*'performed'|tool_dispatch:\s*'performed'|source_mutation:\s*'performed'|git_mutation:\s*'performed'|sqlite_write:\s*'performed'|permission_grant:\s*'performed'/u,
  );
  assert.match(source, /prompt_bridge_admission:\s*'main_only_explicit_provider_context_prompt_bridge_admission_v1'/u);
  assert.match(source, /provider_dispatch:\s*'not_performed'/u);
});
