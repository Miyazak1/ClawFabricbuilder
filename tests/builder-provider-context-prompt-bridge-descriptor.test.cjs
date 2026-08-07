'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  createBuilderContextAssembly,
} = require('../electron/builder-context-assembler.cjs');
const {
  createBuilderGenerationRequest,
} = require('../electron/builder-generation-kernel.cjs');
const {
  createBuilderProjectSourceTree,
} = require('../electron/builder-project-source-tree.cjs');
const {
  createBuilderProviderContextProjection,
} = require('../electron/builder-provider-context-projection.cjs');
const {
  createBuilderProviderContextPromptBridgeAdmission,
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
const {
  BuilderProviderContextPromptBridgeDescriptorError,
  createBuilderProviderContextPromptBridgeDescriptor,
  sanitizeBuilderProviderContextPromptBridgeDescriptor,
} = require('../electron/builder-provider-context-prompt-bridge-descriptor.cjs');

const UUID = '123e4567-e89b-42d3-a456-426614174000';
const PROJECT_ID = `builder-project:${UUID}`;
const CONVERSATION_ID = `builder-conversation:${UUID}`;
const TURN_ID = `builder-turn:${UUID}`;
const RUN_ID = `builder-run:${UUID}`;
const TASK_ID = `builder-task:${UUID}`;
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

function sourceTree(files = []) {
  return createBuilderProjectSourceTree({ files });
}

function request(overrides = {}) {
  return createBuilderGenerationRequest({
    instruction: 'Build from the approved plan.',
    existing_project_id: PROJECT_ID,
    ...overrides,
  });
}

function workingContextState(overrides = {}) {
  return createBuilderWorkingContextState({
    project_id: PROJECT_ID,
    session_id: 'builder-session:123e4567-e89b-42d3-a456-426614174001',
    task_address_id: 'builder-task-address:123e4567-e89b-42d3-a456-426614174002',
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
      max_prompt_bytes: 4096,
      reserved_response_bytes: 1024,
    },
    assembled_at_ms: 11,
    ...overrides,
  });
}

function providerContextProjection(contextAssemblyValue, approved, projectedAtMs) {
  return createBuilderProviderContextProjection({
    context_assembly: contextAssemblyValue,
    disclosure_decision: approved
      ? {
        decision: 'approved',
        approved_by: 'local_user',
        approved_at_ms: 12,
        provider_scope: 'configured_provider',
        purpose: 'contextual_build',
      }
      : {
        decision: 'not_requested',
        approved_by: null,
        approved_at_ms: null,
        provider_scope: null,
        purpose: null,
      },
    projected_at_ms: projectedAtMs,
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

function runContextSnapshot(contextAssemblyValue, projection, gate) {
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
    provider_context_projection: projection,
    provider_context_prompt_egress_gate: gate,
    base_revision: BASE_REVISION,
    created_at_ms: 13,
  });
}

function promptBridgeAdmission(overrides = {}) {
  const assembly = contextAssembly();
  const inspected = providerContextProjection(assembly, false, 12);
  const projection = providerContextProjection(assembly, true, 13);
  const gate = assessBuilderProviderContextPromptEgress({
    provider_context_projection: projection,
    assessed_at_ms: 13,
  });
  const snapshot = runContextSnapshot(assembly, projection, gate);
  return createBuilderProviderContextPromptBridgeAdmission({
    run_context_snapshot: snapshot,
    inspected_provider_context_projection: inspected,
    provider_context_projection: projection,
    provider_context_prompt_egress_gate: gate,
    bridge_consent: {
      consent_version: PROVIDER_CONTEXT_PROMPT_BRIDGE_CONSENT_VERSION,
      project_id: PROJECT_ID,
      conversation_id: CONVERSATION_ID,
      purpose: 'contextual_build',
      provider_scope: 'configured_provider',
      provider_config_digest: PROVIDER_CONFIG_DIGEST,
      context_digest: inspected.source_refs.context_digest,
      inspected_projection_id: inspected.projection_id,
      approved_at_ms: 14,
      expires_at_ms: 30,
      revoked_at_ms: null,
    },
    provider_config_digest: PROVIDER_CONFIG_DIGEST,
    admitted_at_ms: 15,
    ...overrides,
  });
}

function descriptorInput(overrides = {}) {
  return {
    request: request(),
    base_source_tree: sourceTree([{ path: 'src/app.js', content: 'export const existing = true;\n' }]),
    conversation_events: [],
    provider_context_prompt_bridge_admission: promptBridgeAdmission(),
    built_at_ms: 16,
    ...overrides,
  };
}

function assertDescriptorError(fn) {
  assert.throws(fn, BuilderProviderContextPromptBridgeDescriptorError);
}

test('creates a main-only prompt bridge descriptor from verified context admission', () => {
  const result = createBuilderProviderContextPromptBridgeDescriptor(descriptorInput());
  const userContext = JSON.parse(result.prompt_descriptor.user_instruction);

  assert.match(
    result.descriptor_id,
    /^builder-provider-context-prompt-bridge-descriptor:[0-9a-f]{64}$/u,
  );
  assert.equal(result.result_version, 'builder-provider-context-prompt-bridge-descriptor.v1');
  assert.equal(result.project_id, PROJECT_ID);
  assert.equal(result.prompt_version, 'builder-code-project.v3.provider-context-bridge');
  assert.equal(userContext.approved_working_context.context_version, 'builder-provider-context.v1');
  assert.equal(userContext.approved_working_context.source, 'context_assembler');
  assert.deepEqual(
    userContext.approved_working_context.segments.map((segment) => segment.kind),
    [
      'latest_user_message',
      'working_context_objective',
      'working_context_constraints',
      'approved_plan',
      'selected_source_summary',
    ],
  );
  assert.equal(result.source_ref.provider_config_digest, PROVIDER_CONFIG_DIGEST);
  assert.equal(result.authority.provider_dispatch, 'not_performed');
  assert.equal(result.authority.provider_context_body, 'main_only_prompt_descriptor_body');
  assert.equal(result.authority.secret_access, 'not_accessed');
  assert.deepEqual(
    sanitizeBuilderProviderContextPromptBridgeDescriptor(structuredClone(result)),
    result,
  );
  assert.doesNotMatch(
    result.prompt_descriptor.user_instruction,
    /admission_id|source_ref|projection_id|gate_id|snapshot_id|sha256:|builder-(?:project|conversation|turn|run|task|message|route-decision):|api[_-]?key|Bearer/u,
  );
});

test('fails closed for expired, cross-project, malformed, or forged bridge descriptor input', () => {
  const valid = descriptorInput();
  assertDescriptorError(() => createBuilderProviderContextPromptBridgeDescriptor({
    ...valid,
    built_at_ms: 30,
  }));
  assertDescriptorError(() => createBuilderProviderContextPromptBridgeDescriptor({
    ...valid,
    request: request({ existing_project_id: 'builder-project:22222222-2222-4222-8222-222222222222' }),
  }));
  assertDescriptorError(() => createBuilderProviderContextPromptBridgeDescriptor({
    ...valid,
    provider_context_prompt_bridge_admission: {
      ...valid.provider_context_prompt_bridge_admission,
      provider_dispatch: 'performed',
    },
  }));
  assertDescriptorError(() => createBuilderProviderContextPromptBridgeDescriptor({
    ...valid,
    provider_context_projection: {
      projection_status: 'ready',
    },
  }));
});

test('sanitizer rejects tampered prompt bridge descriptor facts', () => {
  const result = createBuilderProviderContextPromptBridgeDescriptor(descriptorInput());

  assertDescriptorError(() => sanitizeBuilderProviderContextPromptBridgeDescriptor({
    ...result,
    prompt_descriptor: {
      ...result.prompt_descriptor,
      prompt_version: 'builder-code-project.v3',
    },
  }));
  assertDescriptorError(() => sanitizeBuilderProviderContextPromptBridgeDescriptor({
    ...result,
    prompt_descriptor: {
      ...result.prompt_descriptor,
      user_instruction: `${result.prompt_descriptor.user_instruction}\napi_key = sk-this-is-not-okay`,
    },
  }));
  assertDescriptorError(() => sanitizeBuilderProviderContextPromptBridgeDescriptor({
    ...result,
    source_ref: {
      ...result.source_ref,
      consent_expires_at_ms: 16,
    },
  }));
  assertDescriptorError(() => sanitizeBuilderProviderContextPromptBridgeDescriptor({
    ...result,
    authority: {
      ...result.authority,
      provider_dispatch: 'performed',
    },
  }));
});

test('source remains a main-only prompt descriptor bridge without dispatch authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-provider-context-prompt-bridge-descriptor.cjs'),
    'utf8',
  );

  assert.doesNotMatch(source, /\b(?:fetch|XMLHttpRequest|ipcMain|ipcRenderer|BrowserWindow|safeStorage)\b/u);
  assert.doesNotMatch(source, /\b(?:child_process|spawn|execFile|dugite|DatabaseSync|node:sqlite|sqlite3)\b/u);
  assert.doesNotMatch(
    source,
    /provider_dispatch:\s*'performed'|tool_dispatch:\s*'performed'|source_mutation:\s*'performed'|git_mutation:\s*'performed'|sqlite_write:\s*'performed'|permission_grant:\s*'performed'|revision_admission:\s*'performed'/u,
  );
  assert.match(source, /provider_dispatch:\s*'not_performed'/u);
  assert.match(source, /ipc_registration:\s*'not_performed'/u);
  assert.match(source, /secret_access:\s*'not_accessed'/u);
});
