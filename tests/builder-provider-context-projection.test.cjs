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
  sanitizeBuilderProviderContextProjection,
  BuilderProviderContextProjectionError,
} = require('../electron/builder-provider-context-projection.cjs');
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

test('blocks provider context projection unless disclosure is explicitly approved', () => {
  const sourceAssembly = assembly();
  const projection = createBuilderProviderContextProjection({
    context_assembly: sourceAssembly,
    disclosure_decision: disclosureDecision(),
    projected_at_ms: 12,
  });

  assert.match(projection.projection_id, /^builder-provider-context-projection:[0-9a-f]{64}$/u);
  assert.equal(projection.projection_status, 'blocked');
  assert.equal(projection.provider_context, null);
  assert.equal(projection.blocked_reason, 'context_disclosure_not_approved');
  assert.deepEqual(projection.source_refs, {
    assembly_id: sourceAssembly.assembly_id,
    context_digest: sourceAssembly.context_digest,
  });
  assert.deepEqual(sanitizeBuilderProviderContextProjection(structuredClone(projection)), projection);
  assert.doesNotMatch(JSON.stringify(projection.provider_context), /model_context_segments|api[_-]?key|credential/iu);
});

test('projects only sendable context after a local-user approval for the same purpose', () => {
  const projection = createBuilderProviderContextProjection({
    context_assembly: assembly(),
    disclosure_decision: disclosureDecision({
      decision: 'approved',
      approved_by: 'local_user',
      approved_at_ms: 12,
      provider_scope: 'configured_provider',
      purpose: 'contextual_build',
    }),
    projected_at_ms: 13,
  });

  assert.equal(projection.projection_status, 'ready');
  assert.equal(projection.blocked_reason, null);
  assert.equal(projection.provider_context.context_version, 'builder-provider-context.v1');
  assert.equal(projection.provider_context.source, 'context_assembler');
  assert.equal(projection.provider_context.purpose, 'contextual_build');
  assert.equal(projection.provider_context.permission_gate.write_permission, 'ask');
  assert.deepEqual(
    projection.provider_context.segments.map((segment) => segment.kind),
    [
      'latest_user_message',
      'working_context_objective',
      'working_context_constraints',
      'approved_plan',
      'selected_source_summary',
    ],
  );
  assert.doesNotMatch(
    JSON.stringify(projection.provider_context),
    /builder-(?:project|conversation|working-context-state|context-assembly):|sha256:|api[_-]?key|credential|provider_config|source_tree|git_candidate_receipt/iu,
  );
});

test('fails closed for denied disclosure, purpose drift, future approval, and forged provider context', () => {
  const sourceAssembly = assembly();
  const denied = createBuilderProviderContextProjection({
    context_assembly: sourceAssembly,
    disclosure_decision: disclosureDecision({ decision: 'denied' }),
    projected_at_ms: 12,
  });
  assert.equal(denied.projection_status, 'blocked');
  assert.equal(denied.blocked_reason, 'context_disclosure_denied');

  assert.throws(
    () => createBuilderProviderContextProjection({
      context_assembly: sourceAssembly,
      disclosure_decision: disclosureDecision({
        decision: 'approved',
        approved_by: 'local_user',
        approved_at_ms: 12,
        provider_scope: 'configured_provider',
        purpose: 'plan',
      }),
      projected_at_ms: 13,
    }),
    BuilderProviderContextProjectionError,
  );
  assert.throws(
    () => createBuilderProviderContextProjection({
      context_assembly: sourceAssembly,
      disclosure_decision: disclosureDecision({
        decision: 'approved',
        approved_by: 'local_user',
        approved_at_ms: 14,
        provider_scope: 'configured_provider',
        purpose: 'contextual_build',
      }),
      projected_at_ms: 13,
    }),
    BuilderProviderContextProjectionError,
  );

  const ready = createBuilderProviderContextProjection({
    context_assembly: sourceAssembly,
    disclosure_decision: disclosureDecision({
      decision: 'approved',
      approved_by: 'local_user',
      approved_at_ms: 12,
      provider_scope: 'configured_provider',
      purpose: 'contextual_build',
    }),
    projected_at_ms: 13,
  });
  assert.throws(
    () => sanitizeBuilderProviderContextProjection({
      ...ready,
      provider_context: {
        ...ready.provider_context,
        segments: [{
          ...ready.provider_context.segments[0],
          text: 'api_key: secret-value',
        }],
      },
    }),
    BuilderProviderContextProjectionError,
  );
});

test('source remains a pure main-side projection contract without dispatch authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-provider-context-projection.cjs'),
    'utf8',
  );

  assert.doesNotMatch(source, /\b(?:fetch|XMLHttpRequest|ipcMain|ipcRenderer|BrowserWindow|safeStorage)\b/u);
  assert.doesNotMatch(source, /\b(?:child_process|spawn|execFile|dugite|DatabaseSync|node:sqlite|sqlite3)\b/u);
  assert.doesNotMatch(source, /provider_dispatch:\s*'performed'|source_mutation:\s*'performed'|git_mutation:\s*'performed'/u);
  assert.match(source, /provider_dispatch:\s*'not_performed'/u);
});
