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
  BuilderProviderContextDisclosureApprovalServiceError,
  createBuilderProviderContextDisclosureApprovalService,
  sanitizeBuilderProviderContextDisclosureApprovalResult,
} = require('../electron/builder-provider-context-disclosure-approval-service.cjs');

const UUID = '123e4567-e89b-42d3-a456-426614174000';
const PROJECT_ID = `builder-project:${UUID}`;
const CONVERSATION_ID = `builder-conversation:${UUID}`;
const APPROVED_PLAN_REF = Object.freeze({
  plan_result_digest: `sha256:${'a'.repeat(64)}`,
  conversation_head_digest: `sha256:${'b'.repeat(64)}`,
  approved_at_ms: 10,
});
const PERMISSION_ID = `builder-permission:${'c'.repeat(64)}`;

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

function preparation(sourceAssembly = assembly(), sourceProjection = null) {
  return prepareBuilderProviderContextDisclosureRequest({
    context_assembly: sourceAssembly,
    provider_context_projection: sourceProjection ?? projection(sourceAssembly),
    requested_at_ms: 40,
  });
}

function grantResult(request, operation = 'grant_recorded', overrides = {}) {
  return {
    result_version: 'builder-permission-grant-result.v1',
    project_id: request.project_id,
    action: request.action,
    resource: {
      resource_kind: request.resource_kind,
      project_id: request.project_id,
      resource_id: request.resource_id,
    },
    operation,
    granted_at_ms: 45,
    permission_id: PERMISSION_ID,
    permission_authority: 'builder_permission_facts_deny_by_default_v1',
    ui_selection_authority: 'main_owned_explicit_user_approval_required',
    preload_exposure: false,
    ...overrides,
  };
}

function assertServiceError(fn) {
  assert.rejects(fn, (error) => {
    assert.ok(error instanceof BuilderProviderContextDisclosureApprovalServiceError);
    assert.equal(error.code, 'builder_provider_context_disclosure_approval_unavailable');
    assert.equal(error.retryable, true);
    return true;
  });
}

test('approves a prepared provider context disclosure through exact main-owned permission grant', async () => {
  const grantCalls = [];
  const service = createBuilderProviderContextDisclosureApprovalService({
    async grant_permission_for_explicit_approval(request) {
      grantCalls.push(request);
      return grantResult(request);
    },
  });
  const result = await service.approve_prepared_provider_context_disclosure({
    disclosure_request_preparation: preparation(),
  });

  assert.deepEqual(grantCalls, [{
    project_id: PROJECT_ID,
    action: 'context.disclose',
    resource_kind: 'provider',
    resource_id: 'provider:configured/contextual_build',
  }]);
  assert.deepEqual(result, {
    result_version: 'builder-provider-context-disclosure-approval-result.v1',
    project_id: PROJECT_ID,
    operation: 'approval_recorded',
    approval_scope: 'configured_provider_purpose',
    provider_scope: 'configured_provider',
    purpose: 'contextual_build',
    authority: {
      provider_context_disclosure_approval:
        'main_owned_prepared_disclosure_request_approval_v1',
      disclosure_request_preparation: 'caller_provided_verified',
      renderer_authority: 'not_accepted',
      permission_grant: 'main_owned_explicit_user_approval_required',
      provider_context_body: 'not_present',
      provider_dispatch: false,
      prompt_bridge: false,
      tool_dispatch: false,
      source_read: 'not_performed',
      source_write: 'not_performed',
      git_mutation: false,
      sqlite_write: false,
      revision_admission: 'not_created',
      ipc_registration: 'not_performed',
      preload_exposure: false,
    },
  });
  assert.deepEqual(
    sanitizeBuilderProviderContextDisclosureApprovalResult(structuredClone(result)),
    result,
  );
  assert.doesNotMatch(
    JSON.stringify(result),
    /builder-provider-context-disclosure-request|permission_id|builder-permission:|builder-context-assembly|sha256:|"provider_context":|source_tree|credential|api[_-]?key/iu,
  );
});

test('maps an existing provider context disclosure permission to already approved', async () => {
  const service = createBuilderProviderContextDisclosureApprovalService({
    async grant_permission_for_explicit_approval(request) {
      return grantResult(request, 'grant_existing');
    },
  });
  const result = await service.approve_prepared_provider_context_disclosure({
    disclosure_request_preparation: preparation(),
  });

  assert.equal(result.operation, 'already_approved');
  assert.equal(result.purpose, 'contextual_build');
});

test('fails closed for ready preparations, forged grants, extras, and hostile methods', async () => {
  const sourceAssembly = assembly();
  const readyPreparation = preparation(sourceAssembly, projection(sourceAssembly, {
    disclosure_decision: disclosureDecision({
      decision: 'approved',
      approved_by: 'local_user',
      approved_at_ms: 30,
      provider_scope: 'configured_provider',
      purpose: 'contextual_build',
    }),
    projected_at_ms: 31,
  }));
  const service = createBuilderProviderContextDisclosureApprovalService({
    async grant_permission_for_explicit_approval(request) {
      return grantResult(request);
    },
  });

  await assertServiceError(async () => service.approve_prepared_provider_context_disclosure({
    disclosure_request_preparation: readyPreparation,
  }));
  await assertServiceError(async () => service.approve_prepared_provider_context_disclosure({
    disclosure_request_preparation: preparation(),
    resource_id: 'provider:configured/answer',
  }));

  const forgedGrantService = createBuilderProviderContextDisclosureApprovalService({
    async grant_permission_for_explicit_approval(request) {
      return grantResult(request, 'grant_recorded', {
        action: 'network.request',
      });
    },
  });
  await assertServiceError(async () => forgedGrantService.approve_prepared_provider_context_disclosure({
    disclosure_request_preparation: preparation(),
  }));

  assert.throws(
    () => createBuilderProviderContextDisclosureApprovalService({
      get grant_permission_for_explicit_approval() {
        throw new Error('getter must not run');
      },
    }),
    BuilderProviderContextDisclosureApprovalServiceError,
  );
});

test('source stays a main-side approval adapter without renderer, provider, prompt, or storage authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-provider-context-disclosure-approval-service.cjs'),
    'utf8',
  );

  assert.doesNotMatch(source, /\b(?:fetch|XMLHttpRequest|ipcMain|ipcRenderer|BrowserWindow|safeStorage)\b/u);
  assert.doesNotMatch(source, /\b(?:child_process|spawn|execFile|dugite|DatabaseSync|node:sqlite|sqlite3)\b/u);
  assert.doesNotMatch(source, /provider_context_body:\s*'included'|provider_dispatch:\s*true|prompt_bridge:\s*true/u);
  assert.match(source, /permission_grant:\s*'main_owned_explicit_user_approval_required'/u);
  assert.match(source, /preload_exposure:\s*false/u);
});
