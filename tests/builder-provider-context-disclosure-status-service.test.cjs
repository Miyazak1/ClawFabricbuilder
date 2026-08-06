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
  BuilderProviderContextDisclosureStatusServiceError,
  createBuilderProviderContextDisclosureStatusService,
} = require('../electron/builder-provider-context-disclosure-status-service.cjs');

const UUID = '123e4567-e89b-42d3-a456-426614174000';
const PROJECT_ID = `builder-project:${UUID}`;
const CONVERSATION_ID = `builder-conversation:${UUID}`;
const SESSION_ID = 'builder-session:123e4567-e89b-42d3-a456-426614174001';
const TASK_ADDRESS_ID = 'builder-task-address:123e4567-e89b-42d3-a456-426614174002';
const OTHER_CONVERSATION_ID = 'builder-conversation:123e4567-e89b-42d3-a456-426614174099';
const APPROVED_PLAN_REF = Object.freeze({
  plan_result_digest: `sha256:${'a'.repeat(64)}`,
  conversation_head_digest: `sha256:${'b'.repeat(64)}`,
  approved_at_ms: 10,
});

function workingContextState(overrides = {}) {
  return createBuilderWorkingContextState({
    project_id: PROJECT_ID,
    session_id: SESSION_ID,
    task_address_id: TASK_ADDRESS_ID,
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
  return createBuilderContextAssembly({
    assembly_purpose: 'contextual_build',
    project_id: PROJECT_ID,
    latest_user_message: 'Apply the approved plan.',
    working_context_state: workingContextState(),
    approved_plan_ref: APPROVED_PLAN_REF,
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

function assertServiceError(fn) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof BuilderProviderContextDisclosureStatusServiceError);
    assert.equal(error.code, 'builder_provider_context_disclosure_status_service_unavailable');
    assert.equal(error.retryable, true);
    return true;
  });
}

function record(service, sourceAssembly = assembly(), sourceProjection = null, overrides = {}) {
  return service.record_current_provider_context_disclosure_status({
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    context_assembly: sourceAssembly,
    provider_context_projection: sourceProjection ?? projection(sourceAssembly),
    recorded_at_ms: 40,
    ...overrides,
  });
}

test('records and reads only renderer-safe provider context disclosure status', () => {
  const service = createBuilderProviderContextDisclosureStatusService();
  const recorded = record(service);

  assert.equal(recorded.result_version, 'builder-provider-context-disclosure-status-service.v1');
  assert.equal(recorded.operation, 'provider_context_disclosure_status_recorded');
  assert.equal(recorded.provider_context_disclosure_status_projection.label, 'Allow AI to use current context');
  assert.equal(recorded.provider_context_disclosure_status_projection.needs_user_approval, true);
  assert.equal(recorded.provider_context_disclosure_status_projection.can_use_provider_context, false);
  assert.equal(recorded.provider_context_disclosure_status_projection.request_available, true);
  assert.equal(
    recorded.provider_context_disclosure_status_projection.inspection.summary,
    'Allow Builder to build with current context using a bounded local context summary.',
  );
  assert.equal(
    recorded.provider_context_disclosure_status_projection.inspection.context_surface.segment_count,
    4,
  );

  const read = service.read_current_provider_context_disclosure_status_for_conversation({
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
  });
  assert.equal(read.operation, 'provider_context_disclosure_status_read');
  assert.deepEqual(
    read.provider_context_disclosure_status_projection,
    recorded.provider_context_disclosure_status_projection,
  );
  assert.doesNotMatch(
    JSON.stringify(read),
    /builder-context-assembly:|builder-provider-context-projection:|builder-provider-context-disclosure-request:|builder-provider-context-disclosure-request-preparation:|context_digest|assembly_id|request_id|preparation_id|provider_context_segments|"provider_context":|api[_-]?key|credential|source_tree/iu,
  );

  const preparation = service.read_current_provider_context_disclosure_request_preparation_for_conversation({
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
  });
  assert.equal(preparation.operation, 'provider_context_disclosure_request_preparation_read');
  assert.equal(preparation.project_id, PROJECT_ID);
  assert.equal(preparation.conversation_id, CONVERSATION_ID);
  assert.equal(preparation.disclosure_request_preparation.project_id, PROJECT_ID);
  assert.equal(preparation.disclosure_request_preparation.projection_status, 'blocked');
  assert.equal(preparation.disclosure_request_preparation.blocked_reason, 'context_disclosure_not_approved');
  assert.equal(
    preparation.disclosure_request_preparation.provider_context_disclosure_request
      .disclosure_request.resource.resource_id,
    'provider:configured/contextual_build',
  );
  assert.doesNotMatch(
    JSON.stringify(preparation),
    /Apply the approved plan|private dashboard|builder-context-assembly:|builder-provider-context-projection:|context_digest|assembly_id|"provider_context":|api[_-]?key|credential|source_tree/iu,
  );
});

test('records approved provider context disclosure as ready and clears stale current status', () => {
  const service = createBuilderProviderContextDisclosureStatusService();
  const sourceAssembly = assembly();
  const readyProjection = createBuilderProviderContextProjection({
    context_assembly: sourceAssembly,
    disclosure_decision: disclosureDecision({
      decision: 'approved',
      approved_by: 'local_user',
      approved_at_ms: 35,
      provider_scope: 'configured_provider',
      purpose: 'contextual_build',
    }),
    projected_at_ms: 35,
  });
  record(service, sourceAssembly, readyProjection, { recorded_at_ms: 35 });

  const read = service.read_current_provider_context_disclosure_status_for_conversation({
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
  });
  assert.equal(read.provider_context_disclosure_status_projection.label, 'AI context allowed');
  assert.equal(read.provider_context_disclosure_status_projection.needs_user_approval, false);
  assert.equal(read.provider_context_disclosure_status_projection.can_use_provider_context, true);
  assert.equal(read.provider_context_disclosure_status_projection.blocked_reason, null);
  assert.equal(read.provider_context_disclosure_status_projection.inspection, null);
  const preparation = service.read_current_provider_context_disclosure_request_preparation_for_conversation({
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
  });
  assert.equal(preparation.operation, 'provider_context_disclosure_request_preparation_read');
  assert.equal(preparation.disclosure_request_preparation.projection_status, 'ready');
  assert.equal(preparation.disclosure_request_preparation.provider_context_disclosure_request, null);

  assert.deepEqual(service.clear_current_provider_context_disclosure_status_for_conversation({
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
  }), {
    result_version: 'builder-provider-context-disclosure-status-service.v1',
    operation: 'provider_context_disclosure_status_cleared',
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    cleared: true,
    authority: read.authority,
  });
  const afterClear = service.read_current_provider_context_disclosure_status_for_conversation({
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
  });
  assert.equal(afterClear.operation, 'provider_context_disclosure_status_absent');
  assert.equal(afterClear.provider_context_disclosure_status_projection, null);
  const preparationAfterClear = service.read_current_provider_context_disclosure_request_preparation_for_conversation({
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
  });
  assert.equal(
    preparationAfterClear.operation,
    'provider_context_disclosure_request_preparation_absent',
  );
  assert.equal(preparationAfterClear.disclosure_request_preparation, null);
});

test('keeps status scoped per conversation and reports absent without fabricating work', () => {
  const service = createBuilderProviderContextDisclosureStatusService();
  record(service);

  const other = service.read_current_provider_context_disclosure_status_for_conversation({
    project_id: PROJECT_ID,
    conversation_id: OTHER_CONVERSATION_ID,
  });
  assert.equal(other.operation, 'provider_context_disclosure_status_absent');
  assert.equal(other.provider_context_disclosure_status_projection, null);
  const otherPreparation = service.read_current_provider_context_disclosure_request_preparation_for_conversation({
    project_id: PROJECT_ID,
    conversation_id: OTHER_CONVERSATION_ID,
  });
  assert.equal(
    otherPreparation.operation,
    'provider_context_disclosure_request_preparation_absent',
  );
  assert.equal(otherPreparation.disclosure_request_preparation, null);
  assert.equal(service.clear_current_provider_context_disclosure_status_for_conversation({
    project_id: PROJECT_ID,
    conversation_id: OTHER_CONVERSATION_ID,
  }).cleared, false);
});

test('fails closed for drift, stale projection time, forged objects, and hostile input', () => {
  const service = createBuilderProviderContextDisclosureStatusService();
  const sourceAssembly = assembly();
  const sourceProjection = projection(sourceAssembly);
  assertServiceError(() => record(service, sourceAssembly, sourceProjection, {
    project_id: 'builder-project:123e4567-e89b-42d3-a456-426614174099',
  }));
  assertServiceError(() => record(service, sourceAssembly, sourceProjection, {
    recorded_at_ms: sourceProjection.projected_at_ms - 1,
  }));
  assertServiceError(() => record(service, sourceAssembly, {
    ...sourceProjection,
    source_refs: {
      ...sourceProjection.source_refs,
      context_digest: `sha256:${'0'.repeat(64)}`,
    },
  }));
  assertServiceError(() => service.read_current_provider_context_disclosure_status_for_conversation({
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    extra: true,
  }));
  assertServiceError(() => service.read_current_provider_context_disclosure_request_preparation_for_conversation({
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    extra: true,
  }));
  assertServiceError(() => service.clear_current_provider_context_disclosure_status_for_conversation(new Proxy({
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
  }, {})));
});

test('source remains a main-only in-memory status service without dispatch, IPC, storage writes, or provider body authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-provider-context-disclosure-status-service.cjs'),
    'utf8',
  );
  assert.match(source, /builder-provider-context-disclosure-status-service\.v1/u);
  assert.match(source, /record_current_provider_context_disclosure_status/u);
  assert.match(source, /read_current_provider_context_disclosure_status_for_conversation/u);
  assert.match(source, /read_current_provider_context_disclosure_request_preparation_for_conversation/u);
  assert.match(source, /clear_current_provider_context_disclosure_status_for_conversation/u);
  assert.doesNotMatch(
    source,
    /require\(['"]electron['"]\)|ipcMain|ipcRenderer|contextBridge|BrowserWindow|safeStorage|node:sqlite|node:fs|fetch\s*\(|https?:|providerConfig|credential|secret|persist_candidate_commit|append_conversation_events|provider_context_body:\s*'included'|provider_dispatch:\s*true|permission_grant:\s*true/iu,
  );
});
