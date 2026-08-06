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
  prepareBuilderProviderContextDisclosureRequest,
} = require('../electron/builder-provider-context-disclosure-request-service.cjs');
const {
  BuilderProviderContextDisclosureStatusProjectionError,
  projectBuilderProviderContextDisclosureStatus,
  sanitizeBuilderProviderContextDisclosureStatusProjection,
} = require('../electron/builder-provider-context-disclosure-status-projection.cjs');

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

function workingContextState() {
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
  });
}

function assembly() {
  const state = workingContextState();
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

function preparation(decisionOverrides = {}, projectionOverrides = {}) {
  const sourceAssembly = assembly();
  const sourceProjection = createBuilderProviderContextProjection({
    context_assembly: sourceAssembly,
    disclosure_decision: disclosureDecision(decisionOverrides),
    projected_at_ms: decisionOverrides.decision === 'approved' ? 31 : 30,
    ...projectionOverrides,
  });
  return prepareBuilderProviderContextDisclosureRequest({
    context_assembly: sourceAssembly,
    provider_context_projection: sourceProjection,
    requested_at_ms: 40,
  });
}

function assertProjectionError(fn) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof BuilderProviderContextDisclosureStatusProjectionError);
    assert.equal(error.code, 'builder_provider_context_disclosure_status_projection_invalid');
    assert.equal(error.retryable, false);
    assert.doesNotMatch(
      `${error.name}:${error.message}:${error.stack}`,
      /credential|Authorization|Bearer|source_tree|C:\\Users|api[_-]?key|sha256:|provider_context/iu,
    );
    return true;
  });
}

test('projects missing approval into a renderer-safe approval-needed status', () => {
  const projected = projectBuilderProviderContextDisclosureStatus({
    disclosure_request_preparation: preparation(),
  });

  assert.equal(projected.projection_version, 'builder-provider-context-disclosure-status-projection.v1');
  assert.equal(projected.label, 'Allow AI to use current context');
  assert.equal(projected.tone, 'warning');
  assert.equal(projected.needs_user_approval, true);
  assert.equal(projected.can_use_provider_context, false);
  assert.equal(projected.blocked_reason, 'context_disclosure_not_approved');
  assert.equal(projected.request_available, true);
  assert.equal(projected.authority.permission_grant, false);
  assert.equal(projected.authority.provider_dispatch, false);
  assert.deepEqual(
    sanitizeBuilderProviderContextDisclosureStatusProjection(structuredClone(projected)),
    projected,
  );
  assert.doesNotMatch(
    JSON.stringify(projected),
    /Apply the approved plan|private dashboard|Private source summary|builder-provider-context-disclosure-request|builder-context-assembly|sha256:|"provider_context":|api[_-]?key|credential|source_tree/iu,
  );
});

test('projects denied and ready preparations without turning either into a grant', () => {
  const denied = projectBuilderProviderContextDisclosureStatus({
    disclosure_request_preparation: preparation({ decision: 'denied' }),
  });
  assert.equal(denied.label, 'AI context not allowed');
  assert.equal(denied.tone, 'neutral');
  assert.equal(denied.needs_user_approval, false);
  assert.equal(denied.can_use_provider_context, false);
  assert.equal(denied.blocked_reason, 'context_disclosure_denied');
  assert.equal(denied.request_available, true);
  assert.equal(denied.authority.permission_grant, false);

  const ready = projectBuilderProviderContextDisclosureStatus({
    disclosure_request_preparation: preparation({
      decision: 'approved',
      approved_by: 'local_user',
      approved_at_ms: 30,
      provider_scope: 'configured_provider',
      purpose: 'contextual_build',
    }),
  });
  assert.equal(ready.label, 'AI context allowed');
  assert.equal(ready.tone, 'success');
  assert.equal(ready.needs_user_approval, false);
  assert.equal(ready.can_use_provider_context, true);
  assert.equal(ready.blocked_reason, null);
  assert.equal(ready.request_available, false);
  assert.equal(ready.authority.permission_grant, false);
});

test('fails closed for forged projection surfaces and hostile input', () => {
  const projected = projectBuilderProviderContextDisclosureStatus({
    disclosure_request_preparation: preparation(),
  });

  assertProjectionError(() => sanitizeBuilderProviderContextDisclosureStatusProjection({
    ...projected,
    can_use_provider_context: true,
  }));
  assertProjectionError(() => sanitizeBuilderProviderContextDisclosureStatusProjection({
    ...projected,
    label: 'Allow AI to use current context sha256:aaaaaaaa',
  }));
  assertProjectionError(() => sanitizeBuilderProviderContextDisclosureStatusProjection({
    ...projected,
    authority: {
      ...projected.authority,
      permission_grant: true,
    },
  }));
  assertProjectionError(() => projectBuilderProviderContextDisclosureStatus(new Proxy({
    disclosure_request_preparation: preparation(),
  }, {})));
});

test('source remains a pure renderer-safe status projection without dispatch or grant authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-provider-context-disclosure-status-projection.cjs'),
    'utf8',
  );

  assert.doesNotMatch(source, /\b(?:fetch|XMLHttpRequest|ipcMain|ipcRenderer|BrowserWindow|safeStorage)\b/u);
  assert.doesNotMatch(source, /\b(?:child_process|spawn|execFile|dugite|DatabaseSync|node:sqlite|sqlite3)\b/u);
  assert.doesNotMatch(source, /provider_dispatch:\s*true|permission_grant:\s*true|provider_context:\s*valueAt/u);
  assert.match(source, /provider_dispatch:\s*false/u);
  assert.match(source, /permission_grant:\s*false/u);
});
