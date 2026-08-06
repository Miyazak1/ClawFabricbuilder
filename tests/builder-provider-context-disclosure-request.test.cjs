'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  createBuilderContextAssembly,
} = require('../electron/builder-context-assembler.cjs');
const {
  createBuilderWorkingContextState,
} = require('../electron/builder-working-context-state.cjs');
const {
  BuilderProviderContextDisclosureRequestError,
  createBuilderProviderContextDisclosureRequest,
  sanitizeBuilderProviderContextDisclosureRequest,
} = require('../electron/builder-provider-context-disclosure-request.cjs');

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

test('creates a bounded local disclosure approval request without raw context text', () => {
  const sourceAssembly = assembly();
  const request = createBuilderProviderContextDisclosureRequest({
    context_assembly: sourceAssembly,
    requested_at_ms: 30,
  });

  assert.match(request.request_id, /^builder-provider-context-disclosure-request:[0-9a-f]{64}$/u);
  assert.equal(request.project_id, PROJECT_ID);
  assert.deepEqual(request.disclosure_request.resource, {
    resource_kind: 'provider',
    project_id: PROJECT_ID,
    resource_id: 'provider:configured/contextual_build',
  });
  assert.equal(request.disclosure_request.action, 'context.disclose');
  assert.equal(request.disclosure_request.approval_scope, 'configured_provider_purpose');
  assert.equal(request.context_surface.segment_count, 5);
  assert.deepEqual(request.context_surface.segment_kinds, [
    'latest_user_message',
    'working_context_objective',
    'working_context_constraints',
    'approved_plan',
    'selected_source_summary',
  ]);
  assert.equal(request.context_surface.permission_gate.side_effect_ready, true);
  assert.equal(request.authority.permission_grant, 'not_performed');
  assert.equal(request.authority.provider_dispatch, 'not_performed');
  assert.deepEqual(sanitizeBuilderProviderContextDisclosureRequest(structuredClone(request)), request);

  assert.doesNotMatch(
    JSON.stringify(request),
    /Apply the approved plan|private dashboard|Private source summary|builder-context-assembly|sha256:|"provider_context":|api[_-]?key|credential|source_tree|git_candidate/iu,
  );
});

test('is deterministic for the same assembly and requested time', () => {
  const sourceAssembly = assembly();
  const first = createBuilderProviderContextDisclosureRequest({
    context_assembly: sourceAssembly,
    requested_at_ms: 30,
  });
  const second = createBuilderProviderContextDisclosureRequest({
    context_assembly: sourceAssembly,
    requested_at_ms: 30,
  });

  assert.equal(first.request_id, second.request_id);
  assert.deepEqual(first, second);
});

test('fails closed for future assemblies and forged request surfaces', () => {
  const sourceAssembly = assembly();
  assert.throws(
    () => createBuilderProviderContextDisclosureRequest({
      context_assembly: sourceAssembly,
      requested_at_ms: 19,
    }),
    BuilderProviderContextDisclosureRequestError,
  );

  const request = createBuilderProviderContextDisclosureRequest({
    context_assembly: sourceAssembly,
    requested_at_ms: 30,
  });
  assert.throws(
    () => sanitizeBuilderProviderContextDisclosureRequest({
      ...request,
      disclosure_request: {
        ...request.disclosure_request,
        resource: {
          ...request.disclosure_request.resource,
          resource_id: 'provider:configured/answer',
        },
      },
    }),
    BuilderProviderContextDisclosureRequestError,
  );
  assert.throws(
    () => sanitizeBuilderProviderContextDisclosureRequest({
      ...request,
      context_surface: {
        ...request.context_surface,
        segment_count: request.context_surface.segment_count + 1,
      },
    }),
    BuilderProviderContextDisclosureRequestError,
  );
  assert.throws(
    () => sanitizeBuilderProviderContextDisclosureRequest({
      ...request,
      user_copy: {
        ...request.user_copy,
        details: 'Send C:/Users/Administrator/private.txt',
      },
    }),
    BuilderProviderContextDisclosureRequestError,
  );
});

test('source remains a pure local approval request contract without dispatch or grant authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-provider-context-disclosure-request.cjs'),
    'utf8',
  );

  assert.doesNotMatch(source, /\b(?:fetch|XMLHttpRequest|ipcMain|ipcRenderer|BrowserWindow|safeStorage)\b/u);
  assert.doesNotMatch(source, /\b(?:child_process|spawn|execFile|dugite|DatabaseSync|node:sqlite|sqlite3)\b/u);
  assert.doesNotMatch(source, /provider_dispatch:\s*'performed'|permission_grant:\s*'performed'|provider_context:\s*valueAt/u);
  assert.match(source, /provider_dispatch:\s*'not_performed'/u);
  assert.match(source, /permission_grant:\s*'not_performed'/u);
});
