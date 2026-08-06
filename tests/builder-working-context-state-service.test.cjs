'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  BUILDER_TASK_CAPSULE_STORE_VERSION,
  createBuilderTaskCapsuleStore,
} = require('../electron/builder-task-capsule-store.cjs');
const {
  createBuilderContextCompactionSummary,
} = require('../electron/builder-context-compaction-summary.cjs');
const {
  BUILDER_CONTEXT_COMPACTION_SUMMARY_STORE_VERSION,
  createBuilderContextCompactionSummaryStore,
} = require('../electron/builder-context-compaction-summary-store.cjs');
const {
  createBuilderHandoffPacket,
} = require('../electron/builder-handoff-packet.cjs');
const {
  BUILDER_HANDOFF_PACKET_STORE_VERSION,
  createBuilderHandoffPacketStore,
} = require('../electron/builder-handoff-packet-store.cjs');
const {
  createBuilderSessionAddress,
  createBuilderTaskAddress,
} = require('../electron/builder-session-task-address.cjs');
const {
  BUILDER_SESSION_TASK_ADDRESS_STORE_VERSION,
  createBuilderSessionTaskAddressStore,
} = require('../electron/builder-session-task-address-store.cjs');
const {
  BUILDER_TASK_CAPSULE_VERSION,
  BUILDER_WORKING_BRIEF_VERSION,
  createBuilderTaskCapsuleUpdate,
} = require('../electron/builder-task-capsule-contract.cjs');
const {
  BUILDER_WORKING_CONTEXT_STATE_SERVICE_RESULT_VERSION,
  BUILDER_WORKING_CONTEXT_STATE_SERVICE_VERSION,
  BuilderWorkingContextStateServiceError,
  createBuilderWorkingContextStateService,
} = require('../electron/builder-working-context-state-service.cjs');

const PROJECT_UUID = '123e4567-e89b-42d3-a456-426614174200';
const PROJECT_ID = `builder-project:${PROJECT_UUID}`;
const SESSION_ID = 'builder-session:123e4567-e89b-42d3-a456-426614174201';
const TASK_ADDRESS_ID = 'builder-task-address:123e4567-e89b-42d3-a456-426614174202';
const CONVERSATION_ID = `builder-conversation:${PROJECT_UUID}`;
const TASK_ID = 'builder-task:123e4567-e89b-42d3-a456-426614174203';
const AGENT_ID = 'builder-agent:123e4567-e89b-42d3-a456-426614174208';
const TURN_ID = 'builder-turn:123e4567-e89b-42d3-a456-426614174204';
const RUN_ID = 'builder-run:123e4567-e89b-42d3-a456-426614174205';
const MESSAGE_ID = 'builder-message:123e4567-e89b-42d3-a456-426614174206';
const ROUTE_DECISION_ID = 'builder-route-decision:123e4567-e89b-42d3-a456-426614174207';

function temporaryDatabase() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawfabric-builder-working-context-'));
  return {
    compactionDatabasePath: path.join(root, 'context-compaction.sqlite'),
    handoffDatabasePath: path.join(root, 'handoff-packets.sqlite'),
    taskCapsuleDatabasePath: path.join(root, 'task-capsules.sqlite'),
    addressDatabasePath: path.join(root, 'session-task-addresses.sqlite'),
    root,
  };
}

function digest(char) {
  return `sha256:${char.repeat(64)}`;
}

function sourceRef(overrides = {}) {
  return {
    source_kind: 'task_capsule_update',
    source_digest: digest('a'),
    ...overrides,
  };
}

function eventId(char) {
  return `builder-conversation-event:${char.repeat(64)}`;
}

function workingBrief(overrides = {}) {
  return {
    brief_version: BUILDER_WORKING_BRIEF_VERSION,
    source: 'task_capsule_update',
    latest_user_goal: 'Build a focused photographer portfolio homepage.',
    assistant_proposal: 'Use a gallery, concise intro, and contact section.',
    approved_plan: null,
    use_when_instruction_is_contextual: true,
    ...overrides,
  };
}

function taskCapsule(overrides = {}) {
  return {
    capsule_version: BUILDER_TASK_CAPSULE_VERSION,
    task_id: TASK_ID,
    project_id: PROJECT_ID,
    title: 'Photographer portfolio',
    goal: 'Create the portfolio homepage from the current discussion.',
    status: 'ready',
    current_brief: workingBrief(),
    last_route_decision_id: ROUTE_DECISION_ID,
    updated_at_ms: 1_200,
    ...overrides,
  };
}

function taskCapsuleUpdate(overrides = {}) {
  const capsule = taskCapsule(overrides.task_capsule ?? {});
  return createBuilderTaskCapsuleUpdate({
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    turn_id: TURN_ID,
    run_id: RUN_ID,
    message_id: MESSAGE_ID,
    route_decision_id: capsule.last_route_decision_id,
    task_capsule: capsule,
    updated_at_ms: capsule.updated_at_ms,
  });
}

function compactionSummary(overrides = {}) {
  return createBuilderContextCompactionSummary({
    conversation_id: CONVERSATION_ID,
    task_address_id: TASK_ADDRESS_ID,
    source_event_start_id: eventId('1'),
    source_event_end_id: eventId('2'),
    source_event_count: 8,
    token_budget_before: 64_000,
    token_budget_after: 12_000,
    summary: 'Compacted discussion says the user wants the same portfolio homepage direction.',
    durable_decisions: ['Keep the gallery-first direction.'],
    unresolved_questions: [],
    omitted_large_outputs: [{
      source_kind: 'tool_output',
      source_digest: digest('c'),
      reason: 'Large tool output omitted; digest retained.',
    }],
    source_refs: [
      { source_kind: 'user_message', source_digest: digest('d') },
      { source_kind: 'assistant_message', source_digest: digest('e') },
    ],
    created_at_ms: 1_250,
    ...overrides,
  });
}

function handoffPacket(overrides = {}) {
  return createBuilderHandoffPacket({
    source_thread_id: 'builder-session:123e4567-e89b-42d3-a456-426614174299',
    source_task_address_id: 'builder-task-address:123e4567-e89b-42d3-a456-426614174298',
    target_thread_id: SESSION_ID,
    inserted_by: 'subagent',
    summary: 'Pending handoff provides public context but must be reconciled before use.',
    decisions: ['Treat this as pending context only.'],
    open_questions: [],
    changed_files: [{
      path: 'src/pages/Home.tsx',
      change_kind: 'modified',
      file_digest: digest('6'),
    }],
    commit_refs: [{
      ref_kind: 'project_revision',
      ref_digest: digest('7'),
    }],
    verification_evidence: [{
      evidence_kind: 'review',
      status: 'passed',
      evidence_digest: digest('8'),
      summary: 'Source review passed.',
    }],
    requested_next_action: 'Review this pending handoff after the current work reaches a safe boundary.',
    authority_claims: [{
      claim_kind: 'context_only',
      classification: 'informational',
      summary: 'No permission or approval is inherited.',
    }],
    source_refs: [
      { source_kind: 'public_summary', source_digest: digest('9') },
      { source_kind: 'saved_revision', source_digest: digest('0') },
    ],
    inserted_at_ms: 1_260,
    ...overrides,
  });
}

function sessionAddress(overrides = {}) {
  return createBuilderSessionAddress({
    session_id: SESSION_ID,
    project_id: PROJECT_ID,
    display_id: 'S-A1B2C3',
    title: 'Portfolio work line',
    status: 'active',
    root_conversation_id: CONVERSATION_ID,
    current_task_id: TASK_ADDRESS_ID,
    parent_session_id: null,
    forked_from_session_id: null,
    forked_from_revision_receipt_digest: null,
    created_by: 'local-user',
    created_at_ms: 1_000,
    updated_at_ms: 1_100,
    archived_at_ms: null,
    ...overrides,
  });
}

function taskAddress(overrides = {}) {
  return createBuilderTaskAddress({
    task_address_id: TASK_ADDRESS_ID,
    session_id: SESSION_ID,
    project_id: PROJECT_ID,
    agent_id: AGENT_ID,
    parent_task_address_id: null,
    conversation_id: CONVERSATION_ID,
    title: 'Build portfolio homepage',
    goal: 'Create the portfolio homepage from the current discussion.',
    status: 'planned',
    current_brief_id: digest('1'),
    current_plan_id: null,
    base_revision_receipt_digest: null,
    produced_revision_receipt_digest: null,
    created_by: 'local-user',
    created_at_ms: 1_000,
    updated_at_ms: 1_100,
    closed_at_ms: null,
    ...overrides,
  });
}

function request(overrides = {}) {
  return {
    project_id: PROJECT_ID,
    session_id: SESSION_ID,
    task_address_id: TASK_ADDRESS_ID,
    conversation_id: CONVERSATION_ID,
    objective_summary: 'Build a focused photographer portfolio homepage.',
    confirmed_constraints: ['Use a gallery.', 'Keep intro copy concise.'],
    rejected_constraints: [],
    open_questions: [],
    latest_user_intent: 'Use the current direction.',
    source_refs: [sourceRef()],
    compaction_refs: [],
    handoff_refs: [],
    approved_plan_ref: null,
    base_revision_ref: null,
    invalidated_by: null,
    updated_at_ms: 1_300,
    ...overrides,
  };
}

function fixture(t) {
  const temp = temporaryDatabase();
  const store = createBuilderTaskCapsuleStore(temp.taskCapsuleDatabasePath);
  t.after(() => {
    store.close();
    fs.rmSync(temp.root, { force: true, recursive: true });
  });
  return {
    store,
    service: createBuilderWorkingContextStateService({ task_capsule_store: store }),
  };
}

function compactionFixture(t) {
  const temp = temporaryDatabase();
  const taskCapsuleStore = createBuilderTaskCapsuleStore(temp.taskCapsuleDatabasePath);
  const compactionStore = createBuilderContextCompactionSummaryStore(temp.compactionDatabasePath);
  t.after(() => {
    taskCapsuleStore.close();
    compactionStore.close();
    fs.rmSync(temp.root, { force: true, recursive: true });
  });
  return {
    taskCapsuleStore,
    compactionStore,
    service: createBuilderWorkingContextStateService({
      task_capsule_store: taskCapsuleStore,
      context_compaction_summary_store: compactionStore,
    }),
  };
}

function handoffFixture(t) {
  const temp = temporaryDatabase();
  const taskCapsuleStore = createBuilderTaskCapsuleStore(temp.taskCapsuleDatabasePath);
  const handoffStore = createBuilderHandoffPacketStore(temp.handoffDatabasePath);
  t.after(() => {
    taskCapsuleStore.close();
    handoffStore.close();
    fs.rmSync(temp.root, { force: true, recursive: true });
  });
  return {
    taskCapsuleStore,
    handoffStore,
    service: createBuilderWorkingContextStateService({
      task_capsule_store: taskCapsuleStore,
      handoff_packet_store: handoffStore,
    }),
  };
}

function addressedFixture(t) {
  const temp = temporaryDatabase();
  const taskCapsuleStore = createBuilderTaskCapsuleStore(temp.taskCapsuleDatabasePath);
  const addressStore = createBuilderSessionTaskAddressStore(temp.addressDatabasePath);
  t.after(() => {
    taskCapsuleStore.close();
    addressStore.close();
    fs.rmSync(temp.root, { force: true, recursive: true });
  });
  return {
    taskCapsuleStore,
    addressStore,
    service: createBuilderWorkingContextStateService({
      task_capsule_store: taskCapsuleStore,
      session_task_address_store: addressStore,
    }),
  };
}

function assertServiceError(fn, expectedCode = 'builder_working_context_state_service_invalid') {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof BuilderWorkingContextStateServiceError);
    assert.equal(error.code, expectedCode);
    assert.doesNotMatch(
      `${error.name}:${error.message}:${error.stack}`,
      /secret-value|credential|Authorization|Bearer|provider|source_tree|C:\\Users|api[_-]?key/iu,
    );
    return true;
  });
}

test('projects the latest task capsule store fact into ready Working Context State', (t) => {
  const item = fixture(t);
  const update = taskCapsuleUpdate();
  item.store.record_task_capsule_update({ task_capsule_update: update });

  const result = item.service.read_current_working_context_state(request());

  assert.equal(result.result_version, BUILDER_WORKING_CONTEXT_STATE_SERVICE_RESULT_VERSION);
  assert.equal(result.service_version, BUILDER_WORKING_CONTEXT_STATE_SERVICE_VERSION);
  assert.equal(result.operation, 'working_context_state_projected');
  assert.equal(result.status, 'ready');
  assert.equal(result.project_id, PROJECT_ID);
  assert.equal(result.working_context_state.state, 'ready');
  assert.equal(result.working_context_state.task_capsule_ref.task_id, TASK_ID);
  assert.equal(result.latest_task_capsule.status, 'ready');
  assert.equal(result.latest_task_capsule.update_id, update.update_id);
  assert.equal(result.evidence.service_authority, 'main_working_context_state_projection_service_v1');
  assert.equal(result.evidence.working_context_contract_authority, 'main_working_context_state_contract_v1');
  assert.equal(result.evidence.task_capsule_store_authority, 'main_owned_task_capsule_store');
  assert.equal(result.evidence.task_capsule_store_operation, 'latest_task_capsule_ready_read');
  assert.equal(result.latest_context_compaction_summary.status, 'absent');
  assert.equal(result.evidence.context_compaction_summary_store_authority, 'not_configured');
  assert.equal(result.evidence.context_compaction_summary_store_operation, 'not_configured');
  assert.deepEqual(result.pending_handoff_packets, {
    status: 'absent',
    count: 0,
    first_handoff_id: null,
  });
  assert.deepEqual(result.context_status_projection, {
    projection_version: 'builder-context-status-projection.v1',
    label: 'Ready to execute current direction',
    tone: 'success',
    next_action_hint: 'You can ask me to make the change.',
    has_pending_handoff: false,
    pending_handoff_count: 0,
    needs_confirmation: false,
    can_contextual_execute: true,
    authority: {
      projection_authority: 'main_owned_context_status_projection_v1',
      working_context_state: 'verified_not_exposed',
      pending_handoff_packets: 'none',
      renderer_authority: 'not_present',
      ipc_authority: 'not_present',
      provider_dispatch: false,
      tool_dispatch: false,
      source_read: 'not_present',
      source_write: 'not_present',
      git_mutation: false,
      permission_grant: false,
      revision_admission: 'not_created',
      secret_access: 'not_present',
    },
  });
  assert.equal(result.evidence.handoff_packet_store_authority, 'not_configured');
  assert.equal(result.evidence.handoff_packet_store_operation, 'not_configured');
  assert.equal(result.evidence.sqlite_write, 'not_performed');
  assert.equal(result.evidence.conversation_append, false);
  assert.equal(result.evidence.provider_dispatch, false);
  assert.equal(result.evidence.tool_dispatch, false);
  assert.equal(result.evidence.source_mutation, false);
  assert.equal(result.evidence.git_mutation, false);
  assert.equal(result.evidence.permission_grant, false);
  assert.equal(result.evidence.revision_admission, 'not_created');
  assert.equal(Object.isFrozen(result), true);
  assert.deepEqual(
    item.store.read_latest_task_capsule({ project_id: PROJECT_ID }).task_capsule_update.task_capsule_update,
    update,
  );
});

test('does not turn compaction-only context into executable readiness when the store is empty', (t) => {
  const item = fixture(t);

  const result = item.service.read_current_working_context_state(request({
    objective_summary: null,
    confirmed_constraints: [],
    rejected_constraints: [],
    open_questions: [],
    latest_user_intent: null,
    source_refs: [sourceRef({ source_kind: 'compaction_summary', source_digest: digest('b') })],
    compaction_refs: [{
      summary_digest: digest('b'),
      source_range_digest: digest('c'),
      compacted_at_ms: 1_240,
    }],
    handoff_refs: [{
      packet_digest: digest('d'),
      inserted_at_ms: 1_230,
      adopted_at_ms: 1_250,
    }],
  }));

  assert.equal(result.status, 'empty');
  assert.equal(result.latest_task_capsule.status, 'absent');
  assert.equal(result.latest_task_capsule.update_id, null);
  assert.equal(result.working_context_state.task_capsule_ref, null);
  assert.equal(result.working_context_state.compaction_refs[0].summary_digest, digest('b'));
  assert.equal(result.working_context_state.handoff_refs[0].packet_digest, digest('d'));
  assert.equal(result.context_status_projection.label, 'No direction yet');
  assert.equal(result.context_status_projection.can_contextual_execute, false);
  assert.equal(result.evidence.task_capsule_store_operation, 'latest_task_capsule_absent_read');
});

test('projects latest compaction summary refs without changing readiness authority', (t) => {
  const item = compactionFixture(t);
  const compacted = compactionSummary();
  item.compactionStore.record_context_compaction_summary({ context_compaction_summary: compacted });

  const result = item.service.read_current_working_context_state(request({
    objective_summary: null,
    confirmed_constraints: [],
    rejected_constraints: [],
    open_questions: [],
    latest_user_intent: null,
    source_refs: [sourceRef({ source_kind: 'compaction_summary', source_digest: compacted.digest })],
  }));

  assert.equal(result.status, 'empty');
  assert.equal(result.latest_task_capsule.status, 'absent');
  assert.deepEqual(result.latest_context_compaction_summary, {
    status: 'ready',
    summary_id: compacted.summary_id,
  });
  assert.deepEqual(result.working_context_state.compaction_refs, [{
    summary_digest: compacted.digest,
    source_range_digest: compacted.source_range_digest,
    compacted_at_ms: compacted.created_at_ms,
  }]);
  assert.equal(
    result.evidence.context_compaction_summary_store_authority,
    'main_owned_context_compaction_summary_store',
  );
  assert.equal(
    result.evidence.context_compaction_summary_store_operation,
    'latest_context_compaction_summary_ready_read',
  );
  assert.equal(result.evidence.provider_dispatch, false);
  assert.equal(result.evidence.source_mutation, false);
  assert.equal(result.evidence.git_mutation, false);
  assert.equal(result.evidence.permission_grant, false);
});

test('projects pending handoff inbox status without adopting context', (t) => {
  const item = handoffFixture(t);
  const pending = handoffPacket();
  item.handoffStore.record_handoff_packet({ handoff_packet: pending });

  const result = item.service.read_current_working_context_state(request({
    objective_summary: null,
    confirmed_constraints: [],
    rejected_constraints: [],
    open_questions: [],
    latest_user_intent: null,
    source_refs: [],
  }));

  assert.equal(result.status, 'empty');
  assert.deepEqual(result.pending_handoff_packets, {
    status: 'pending',
    count: 1,
    first_handoff_id: pending.handoff_id,
  });
  assert.deepEqual(result.working_context_state.handoff_refs, []);
  assert.equal(result.context_status_projection.label, 'Handoff received');
  assert.equal(result.context_status_projection.has_pending_handoff, true);
  assert.equal(result.context_status_projection.pending_handoff_count, 1);
  assert.equal(result.context_status_projection.needs_confirmation, true);
  assert.equal(result.context_status_projection.can_contextual_execute, false);
  assert.doesNotMatch(JSON.stringify(result.context_status_projection), /builder-handoff-packet|sha256:/u);
  assert.equal(result.evidence.handoff_packet_store_authority, 'main_owned_handoff_packet_store');
  assert.equal(result.evidence.handoff_packet_store_operation, 'pending_handoff_packets_ready_read');
  assert.equal(result.evidence.provider_dispatch, false);
  assert.equal(result.evidence.tool_dispatch, false);
  assert.equal(result.evidence.source_mutation, false);
  assert.equal(result.evidence.git_mutation, false);
  assert.equal(result.evidence.permission_grant, false);
});

test('projects approved plan and stale correction state without writing to the task capsule store', (t) => {
  const item = fixture(t);
  const update = taskCapsuleUpdate();
  item.store.record_task_capsule_update({ task_capsule_update: update });

  const approved = item.service.read_current_working_context_state(request({
    approved_plan_ref: {
      plan_result_digest: digest('c'),
      conversation_head_digest: digest('d'),
      approved_at_ms: 1_250,
    },
    source_refs: [
      sourceRef(),
      sourceRef({ source_kind: 'approved_plan', source_digest: digest('c') }),
    ],
  }));
  assert.equal(approved.status, 'approved_plan_ready');
  assert.equal(approved.working_context_state.approved_plan_ref.plan_result_digest, digest('c'));
  assert.equal(approved.context_status_projection.label, 'Using approved plan');
  assert.equal(approved.context_status_projection.can_contextual_execute, true);

  const stale = item.service.read_current_working_context_state(request({
    invalidated_by: {
      source: 'brief_correction',
      route_decision_id: ROUTE_DECISION_ID,
      invalidated_at_ms: 1_260,
    },
    source_refs: [
      sourceRef(),
      sourceRef({ source_kind: 'brief_correction', source_digest: digest('e') }),
    ],
  }));
  assert.equal(stale.status, 'stale');
  assert.equal(stale.working_context_state.invalidated_by.source, 'brief_correction');
  assert.equal(stale.context_status_projection.label, 'Direction changed');
  assert.equal(stale.context_status_projection.needs_confirmation, true);
  assert.equal(stale.context_status_projection.can_contextual_execute, false);
  assert.equal(
    item.store.read_latest_task_capsule({ project_id: PROJECT_ID }).task_capsule_update.task_capsule_update.update_id,
    update.update_id,
  );
});

test('restores projection after task capsule store restart', (t) => {
  const temp = temporaryDatabase();
  const store = createBuilderTaskCapsuleStore(temp.taskCapsuleDatabasePath);
  const update = taskCapsuleUpdate();
  store.record_task_capsule_update({ task_capsule_update: update });
  store.close();

  const restarted = createBuilderTaskCapsuleStore(temp.taskCapsuleDatabasePath);
  t.after(() => {
    restarted.close();
    fs.rmSync(temp.root, { force: true, recursive: true });
  });
  const service = createBuilderWorkingContextStateService({ task_capsule_store: restarted });
  const result = service.read_current_working_context_state(request());

  assert.equal(result.status, 'ready');
  assert.equal(result.latest_task_capsule.update_id, update.update_id);
  assert.equal(result.working_context_state.task_capsule_ref.status, 'ready');
});

test('resolves current Session and Task Address before projecting conversation context', (t) => {
  const item = addressedFixture(t);
  const update = taskCapsuleUpdate();
  item.taskCapsuleStore.record_task_capsule_update({ task_capsule_update: update });
  item.addressStore.record_session_address({ session_address: sessionAddress() });
  item.addressStore.record_task_address({ task_address: taskAddress() });

  const result = item.service.read_current_working_context_state_for_conversation({
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    objective_summary: 'Build a focused photographer portfolio homepage.',
    confirmed_constraints: ['Use a gallery.'],
    rejected_constraints: [],
    open_questions: [],
    latest_user_intent: 'Use the current direction.',
    source_refs: [sourceRef()],
    compaction_refs: [],
    handoff_refs: [],
    approved_plan_ref: null,
    base_revision_ref: null,
    invalidated_by: null,
    updated_at_ms: 1_300,
  });

  assert.equal(result.status, 'ready');
  assert.equal(result.working_context_state.session_id, SESSION_ID);
  assert.equal(result.working_context_state.task_address_id, TASK_ADDRESS_ID);
  assert.equal(result.working_context_state.conversation_id, CONVERSATION_ID);
  assert.equal(result.latest_task_capsule.update_id, update.update_id);
  assert.equal(result.evidence.task_capsule_store_operation, 'latest_task_capsule_ready_read');
  assert.equal(
    item.addressStore.read_current_session_task_for_conversation({
      project_id: PROJECT_ID,
      conversation_id: CONVERSATION_ID,
    }).status,
    'ready',
  );
});

test('fails closed when conversation address resolution is unavailable or absent', (t) => {
  const item = addressedFixture(t);
  item.taskCapsuleStore.record_task_capsule_update({ task_capsule_update: taskCapsuleUpdate() });

  assertServiceError(() => item.service.read_current_working_context_state_for_conversation({
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    objective_summary: 'Build a focused photographer portfolio homepage.',
    confirmed_constraints: [],
    rejected_constraints: [],
    open_questions: [],
    latest_user_intent: 'Use the current direction.',
    source_refs: [sourceRef()],
    compaction_refs: [],
    handoff_refs: [],
    approved_plan_ref: null,
    base_revision_ref: null,
    invalidated_by: null,
    updated_at_ms: 1_300,
  }));

  const noAddressService = createBuilderWorkingContextStateService({
    task_capsule_store: item.taskCapsuleStore,
  });
  assertServiceError(() => noAddressService.read_current_working_context_state_for_conversation({
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    objective_summary: 'Build a focused photographer portfolio homepage.',
    confirmed_constraints: [],
    rejected_constraints: [],
    open_questions: [],
    latest_user_intent: 'Use the current direction.',
    source_refs: [sourceRef()],
    compaction_refs: [],
    handoff_refs: [],
    approved_plan_ref: null,
    base_revision_ref: null,
    invalidated_by: null,
    updated_at_ms: 1_300,
  }));
});

test('fails closed when resolved task is not the session current task', (t) => {
  const item = addressedFixture(t);
  item.taskCapsuleStore.record_task_capsule_update({ task_capsule_update: taskCapsuleUpdate() });
  item.addressStore.record_session_address({
    session_address: sessionAddress({
      current_task_id: 'builder-task-address:123e4567-e89b-42d3-a456-426614174299',
    }),
  });
  item.addressStore.record_task_address({ task_address: taskAddress() });

  assertServiceError(() => item.service.read_current_working_context_state_for_conversation({
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    objective_summary: 'Build a focused photographer portfolio homepage.',
    confirmed_constraints: [],
    rejected_constraints: [],
    open_questions: [],
    latest_user_intent: 'Use the current direction.',
    source_refs: [sourceRef()],
    compaction_refs: [],
    handoff_refs: [],
    approved_plan_ref: null,
    base_revision_ref: null,
    invalidated_by: null,
    updated_at_ms: 1_300,
  }));
});

test('fails closed for malformed requests, forged stores, and hostile read results', (t) => {
  const item = fixture(t);
  assertServiceError(() => item.service.read_current_working_context_state({
    ...request(),
    source_tree: { files: [] },
  }));
  assertServiceError(() => item.service.read_current_working_context_state(request({
    latest_user_intent: 'api_key: secret-value',
  })));

  assertServiceError(() => createBuilderWorkingContextStateService({
    task_capsule_store: {
      store_version: BUILDER_TASK_CAPSULE_STORE_VERSION,
      read_latest_task_capsule: 'nope',
    },
  }));
  assertServiceError(() => createBuilderWorkingContextStateService({
    task_capsule_store: item.store,
    session_task_address_store: {
      store_version: BUILDER_SESSION_TASK_ADDRESS_STORE_VERSION,
      read_current_session_task_for_conversation: 'nope',
    },
  }));
  assertServiceError(() => createBuilderWorkingContextStateService({
    task_capsule_store: item.store,
    context_compaction_summary_store: {
      store_version: BUILDER_CONTEXT_COMPACTION_SUMMARY_STORE_VERSION,
      read_latest_context_compaction_summary: 'nope',
    },
  }));
  assertServiceError(() => createBuilderWorkingContextStateService({
    task_capsule_store: item.store,
    handoff_packet_store: {
      store_version: BUILDER_HANDOFF_PACKET_STORE_VERSION,
      list_pending_handoff_packets: 'nope',
    },
  }));
  assertServiceError(() => createBuilderWorkingContextStateService(new Proxy({
    task_capsule_store: item.store,
  }, {})));

  const hostileStore = {
    store_version: BUILDER_TASK_CAPSULE_STORE_VERSION,
    read_latest_task_capsule() {
      return {
        result_version: 'builder-task-capsule-store-read-result.v1',
        task_capsule_authority: 'main_owned_task_capsule_store',
        status: 'ready',
        task_capsule_update: null,
        evidence: {
          transaction: 'latest_task_capsule_ready_read',
        },
      };
    },
  };
  const hostileService = createBuilderWorkingContextStateService({ task_capsule_store: hostileStore });
  assertServiceError(() => hostileService.read_current_working_context_state(request()));

  const unavailableStore = {
    store_version: BUILDER_TASK_CAPSULE_STORE_VERSION,
    read_latest_task_capsule() {
      throw new Error('secret-value');
    },
  };
  const unavailableService = createBuilderWorkingContextStateService({ task_capsule_store: unavailableStore });
  assertServiceError(
    () => unavailableService.read_current_working_context_state(request()),
    'builder_working_context_state_service_unavailable',
  );
});

test('source remains a main-only read projection service without runtime authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-working-context-state-service.cjs'),
    'utf8',
  );

  assert.match(source, /builder-working-context-state-service\.v1/u);
  assert.match(source, /read_latest_task_capsule/u);
  assert.match(source, /read_latest_context_compaction_summary/u);
  assert.match(source, /read_current_session_task_for_conversation/u);
  assert.match(source, /list_pending_handoff_packets/u);
  assert.match(source, /projectBuilderContextStatus/u);
  assert.doesNotMatch(
    source,
    /ipcMain|ipcRenderer|contextBridge|BrowserWindow|safeStorage|fetch\s*\(|child_process|execFile|spawn|run_command|CREATE TABLE|INSERT INTO|UPDATE\s+\w+|DELETE FROM|record_task_capsule_update|record_handoff_packet/u,
  );
});
