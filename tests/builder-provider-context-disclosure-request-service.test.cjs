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
  createBuilderWorkingContextState,
} = require('../electron/builder-working-context-state.cjs');
const {
  BuilderProviderContextDisclosureRequestPreparationError,
  prepareBuilderProviderContextDisclosureRequest,
  sanitizeBuilderProviderContextDisclosureRequestPreparation,
} = require('../electron/builder-provider-context-disclosure-request-service.cjs');

const UUID = '123e4567-e89b-42d3-a456-426614174000';
const PROJECT_ID = `builder-project:${UUID}`;
const CONVERSATION_ID = `builder-conversation:${UUID}`;
const APPROVED_PLAN_REF = Object.freeze({
  plan_result_digest: `sha256:${'a'.repeat(64)}`,
  conversation_head_digest: `sha256:${'b'.repeat(64)}`,
  approved_at_ms: 10,
});

function digest(value) {
  return `sha256:${String(value).padStart(64, '0').slice(0, 64)}`;
}

function workingContextState(overrides = {}) {
  return createBuilderWorkingContextState({
    project_id: PROJECT_ID,
    session_id: 'builder-session:123e4567-e89b-42d3-a456-426614174001',
    task_address_id: 'builder-task-address:123e4567-e89b-42d3-a456-426614174002',
    conversation_id: CONVERSATION_ID,
    objective_summary: 'Build the private dashboard idea.',
    confirmed_constraints: ['Keep the project local-first'],
    rejected_constraints: ['Do not publish a social feed'],
    open_questions: [],
    latest_user_intent: 'Apply the approved plan.',
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
    latest_user_message: 'Apply the approved plan.',
    working_context_state: state,
    approved_plan_ref: APPROVED_PLAN_REF,
    current_result_ref: null,
    selected_source_summaries: [{
      source_kind: 'project_summary',
      source_digest: digest(1),
      summary: 'Private source summary for dashboard implementation.',
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
      max_prompt_bytes: 4096,
      reserved_response_bytes: 1024,
    },
    assembled_at_ms: 20,
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

function projection(sourceAssembly, overrides = {}) {
  return createBuilderProviderContextProjection({
    context_assembly: sourceAssembly,
    disclosure_decision: disclosureDecision(),
    projected_at_ms: 30,
    ...overrides,
  });
}

test('prepares a bounded disclosure request only for blocked provider context projection', () => {
  const sourceAssembly = assembly();
  const blockedProjection = projection(sourceAssembly, {
    disclosure_decision: disclosureDecision({ decision: 'denied' }),
  });
  const prepared = prepareBuilderProviderContextDisclosureRequest({
    context_assembly: sourceAssembly,
    provider_context_projection: blockedProjection,
    requested_at_ms: 40,
  });

  assert.match(
    prepared.preparation_id,
    /^builder-provider-context-disclosure-request-preparation:[0-9a-f]{64}$/u,
  );
  assert.equal(prepared.project_id, PROJECT_ID);
  assert.equal(prepared.projection_status, 'blocked');
  assert.equal(prepared.blocked_reason, 'context_disclosure_denied');
  assert.equal(
    prepared.provider_context_disclosure_request.disclosure_request.action,
    'context.disclose',
  );
  assert.equal(
    prepared.provider_context_disclosure_request.context_surface.segment_count,
    5,
  );
  assert.equal(prepared.authority.permission_grant, 'not_performed');
  assert.equal(prepared.authority.provider_dispatch, 'not_performed');
  assert.deepEqual(
    sanitizeBuilderProviderContextDisclosureRequestPreparation(structuredClone(prepared)),
    prepared,
  );

  assert.doesNotMatch(
    JSON.stringify(prepared),
    /Apply the approved plan|private dashboard|Private source summary|builder-context-assembly|sha256:|"provider_context":|api[_-]?key|credential|source_tree|git_candidate/iu,
  );
});

test('returns no disclosure request for an already ready provider context projection', () => {
  const sourceAssembly = assembly();
  const readyProjection = projection(sourceAssembly, {
    disclosure_decision: disclosureDecision({
      decision: 'approved',
      approved_by: 'local_user',
      approved_at_ms: 30,
      provider_scope: 'configured_provider',
      purpose: 'contextual_build',
    }),
    projected_at_ms: 31,
  });
  const prepared = prepareBuilderProviderContextDisclosureRequest({
    context_assembly: sourceAssembly,
    provider_context_projection: readyProjection,
    requested_at_ms: 40,
  });

  assert.equal(prepared.projection_status, 'ready');
  assert.equal(prepared.blocked_reason, null);
  assert.equal(prepared.provider_context_disclosure_request, null);
  assert.deepEqual(
    sanitizeBuilderProviderContextDisclosureRequestPreparation(structuredClone(prepared)),
    prepared,
  );
  assert.doesNotMatch(JSON.stringify(prepared), /"provider_context":|segments|Apply the approved plan/u);
});

test('fails closed for projection drift, future projections, and forged preparation records', () => {
  const sourceAssembly = assembly();
  const blockedProjection = projection(sourceAssembly);
  const otherAssembly = assembly({
    selected_source_summaries: [{
      source_kind: 'project_summary',
      source_digest: digest(2),
      summary: 'Another private source summary.',
      priority: 10,
    }],
  });

  assert.throws(
    () => prepareBuilderProviderContextDisclosureRequest({
      context_assembly: otherAssembly,
      provider_context_projection: blockedProjection,
      requested_at_ms: 40,
    }),
    BuilderProviderContextDisclosureRequestPreparationError,
  );
  assert.throws(
    () => prepareBuilderProviderContextDisclosureRequest({
      context_assembly: sourceAssembly,
      provider_context_projection: blockedProjection,
      requested_at_ms: 29,
    }),
    BuilderProviderContextDisclosureRequestPreparationError,
  );

  const prepared = prepareBuilderProviderContextDisclosureRequest({
    context_assembly: sourceAssembly,
    provider_context_projection: blockedProjection,
    requested_at_ms: 40,
  });
  assert.throws(
    () => sanitizeBuilderProviderContextDisclosureRequestPreparation({
      ...prepared,
      projection_status: 'ready',
    }),
    BuilderProviderContextDisclosureRequestPreparationError,
  );
  assert.throws(
    () => sanitizeBuilderProviderContextDisclosureRequestPreparation({
      ...prepared,
      provider_context_disclosure_request: {
        ...prepared.provider_context_disclosure_request,
        project_id: 'builder-project:33333333-3333-4333-8333-333333333333',
      },
    }),
    BuilderProviderContextDisclosureRequestPreparationError,
  );
});

test('source remains a pure local preparation service without dispatch, storage, or grant authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-provider-context-disclosure-request-service.cjs'),
    'utf8',
  );

  assert.doesNotMatch(source, /\b(?:fetch|XMLHttpRequest|ipcMain|ipcRenderer|BrowserWindow|safeStorage)\b/u);
  assert.doesNotMatch(source, /\b(?:child_process|spawn|execFile|dugite|DatabaseSync|node:sqlite|sqlite3)\b/u);
  assert.doesNotMatch(source, /provider_dispatch:\s*'performed'|permission_grant:\s*'performed'|provider_context:\s*valueAt/u);
  assert.match(source, /provider_dispatch:\s*'not_performed'/u);
  assert.match(source, /permission_grant:\s*'not_performed'/u);
});
