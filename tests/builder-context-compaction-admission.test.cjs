'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  BUILDER_CONTEXT_COMPACTION_ADMISSION_RECORD_KIND,
  BUILDER_CONTEXT_COMPACTION_ADMISSION_RECORD_VERSION,
  BUILDER_CONTEXT_COMPACTION_ADMISSION_VERSION,
  BuilderContextCompactionAdmissionError,
  createBuilderContextCompactionAdmissionRecord,
  sanitizeBuilderContextCompactionAdmissionRecord,
} = require('../electron/builder-context-compaction-admission.cjs');
const {
  BUILDER_CONVERSATION_AUTHORITY_RESULT_VERSION,
  eventHead,
} = require('../electron/builder-conversation-authority-contract.cjs');
const {
  createBuilderConversationCompactionProjection,
} = require('../electron/builder-conversation-export.cjs');
const {
  createBuilderConversationEvent,
} = require('../electron/builder-conversation-records.cjs');
const {
  replayBuilderConversation,
} = require('../electron/builder-conversation-replay.cjs');

const PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174000';
const CONVERSATION_ID = 'builder-conversation:123e4567-e89b-42d3-a456-426614174000';
const TASK_ADDRESS_ID = 'builder-task-address:123e4567-e89b-42d3-a456-426614174002';
function uuid(index) {
  return `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
}

function digest(char) {
  return `sha256:${char.repeat(64)}`;
}

function loadedConversation() {
  let previousEvent = null;
  const events = [];
  const append = (eventType, payload) => {
    const event = createBuilderConversationEvent({
      record_version: 'builder-conversation-event.v2',
      record_kind: 'builder_conversation_event',
      project_id: PROJECT_ID,
      conversation_id: CONVERSATION_ID,
      sequence: events.length + 1,
      command_id: `builder-command:${uuid(100 + events.length + 1)}`,
      event_type: eventType,
      previous_event: previousEvent === null ? null : eventHead(previousEvent),
      payload,
      authority: {
        context_authority: 'project_local_conversation',
        permission_admission: 'not_granted',
        execution_admission: 'not_granted',
        revision_admission: 'not_created',
      },
    });
    events.push(event);
    previousEvent = event;
    return event;
  };
  const userMessageId = `builder-message:${uuid(201)}`;
  const assistantMessageId = `builder-message:${uuid(202)}`;
  const turnId = `builder-turn:${uuid(203)}`;
  const runId = `builder-run:${uuid(204)}`;
  append('turn_submitted', {
    message: {
      message_id: userMessageId,
      text: 'Please compact the current conversation before we continue.',
    },
    turn_id: turnId,
    mode: 'question',
    task: null,
    base_revision: null,
    route_decision: {
      decision_id: `builder-route-decision:${userMessageId.slice('builder-message:'.length)}`,
      decision_version: 'builder-composer-route-decision.v1',
      project_id: PROJECT_ID,
      message_id: userMessageId,
      task_id: null,
      route: 'answer',
      confidence: 'high',
      matched_signals: ['read_only'],
      downgraded_from: null,
      downgrade_reason: null,
      required_permissions: [],
      permission_result: 'not_required',
      dispatch: 'reply',
      decided_at_ms: 100,
    },
  });
  append('run_started', {
    turn_id: turnId,
    run_id: runId,
    task_id: null,
    attempt_number: 1,
    retry_of_run_id: null,
    input_digest: digest('1'),
  });
  append('run_completed', {
    turn_id: turnId,
    run_id: runId,
    terminal_status: 'succeeded',
    result_kind: 'explanation',
    result_digest: digest('2'),
    assistant_message: {
      message_id: assistantMessageId,
      text: 'The conversation can be summarized into a compact checkpoint.',
    },
    candidate_result: null,
    plan_admission: null,
  });
  append('turn_completed', {
    turn_id: turnId,
    run_id: runId,
    outcome: 'answered',
  });
  return {
    result_version: BUILDER_CONVERSATION_AUTHORITY_RESULT_VERSION,
    operation: 'conversation_loaded',
    conversation: {
      project_id: PROJECT_ID,
      conversation_id: CONVERSATION_ID,
      created_at_ms: 1,
    },
    action_events: [],
    current_head: eventHead(events.at(-1)),
    events,
    snapshot: replayBuilderConversation(events),
    metadata_evidence: {},
  };
}

function projection() {
  return createBuilderConversationCompactionProjection({
    loaded_conversation: loadedConversation(),
  });
}

function admissionInput(compactionProjection, overrides = {}) {
  return {
    record_version: BUILDER_CONTEXT_COMPACTION_ADMISSION_RECORD_VERSION,
    record_kind: BUILDER_CONTEXT_COMPACTION_ADMISSION_RECORD_KIND,
    project_id: compactionProjection.project_id,
    conversation_id: compactionProjection.conversation_id,
    task_address_id: TASK_ADDRESS_ID,
    conversation_compaction_projection_id: compactionProjection.projection_id,
    source_event_count: compactionProjection.source.event_count,
    source_current_sequence: compactionProjection.source.current_sequence,
    source_current_event_id: compactionProjection.source.current_event_id,
    source_current_event_digest: compactionProjection.source.current_event_digest,
    requested_by: 'local-user',
    requested_at_ms: 1_500,
    trigger: 'manual',
    admission_status: 'admitted_for_manual_compaction',
    admission_reason: 'manual_request_on_committed_conversation_projection',
    harness_operation: 'compactNow',
    harness_turn_binding: 'manual_turn_null',
    execution_boundary: 'admission_only_no_compaction_started',
    ...overrides,
  };
}

function assertAdmissionError(fn) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof BuilderContextCompactionAdmissionError);
    assert.equal(error.code, 'builder_context_compaction_admission_invalid');
    assert.doesNotMatch(
      `${error.name}:${error.message}:${error.stack}`,
      /secret-value|Authorization|Bearer|source_tree|provider_output|C:\\Users|raw prompt/iu,
    );
    return true;
  });
}

test('creates deterministic admission-only manual compaction receipts from a committed projection', () => {
  const compactionProjection = projection();
  const admission = createBuilderContextCompactionAdmissionRecord(
    admissionInput(compactionProjection),
    compactionProjection,
  );
  const sameAdmission = createBuilderContextCompactionAdmissionRecord(
    admissionInput(structuredClone(compactionProjection)),
    structuredClone(compactionProjection),
  );

  assert.deepEqual(admission, sameAdmission);
  assert.equal(BUILDER_CONTEXT_COMPACTION_ADMISSION_VERSION, 'builder-context-compaction-admission.v1');
  assert.match(admission.admission_id, /^builder-context-compaction-admission:[0-9a-f]{64}$/u);
  assert.match(admission.conversation_compaction_projection_digest, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(admission.project_id, PROJECT_ID);
  assert.equal(admission.conversation_id, CONVERSATION_ID);
  assert.equal(admission.task_address_id, TASK_ADDRESS_ID);
  assert.equal(admission.conversation_compaction_projection_id, compactionProjection.projection_id);
  assert.equal(admission.source_current_event_id, compactionProjection.source.current_event_id);
  assert.equal(admission.trigger, 'manual');
  assert.equal(admission.admission_status, 'admitted_for_manual_compaction');
  assert.equal(admission.harness_operation, 'compactNow');
  assert.equal(admission.harness_turn_binding, 'manual_turn_null');
  assert.equal(admission.execution_boundary, 'admission_only_no_compaction_started');
  assert.equal(admission.lifecycle.harness_compaction, 'not_started_by_admission');
  assert.equal(admission.lifecycle.summary_recording, 'not_performed_by_admission');
  assert.equal(admission.authority.record_authority, 'main_context_compaction_admission_contract_v1');
  assert.equal(admission.authority.harness_authority, 'manual_compactNow_admission_only');
  assert.equal(admission.authority.model_dispatch, false);
  assert.equal(admission.authority.provider_dispatch, false);
  assert.equal(admission.authority.session_mutation, 'not_started_by_admission');
  assert.equal(admission.authority.permission_grant_authority, 'not_present');
  assert.equal(Object.hasOwn(admission, 'summary'), false);
  assert.equal(Object.hasOwn(admission, 'raw_output'), false);
  assert.equal(Object.hasOwn(admission, 'source_tree'), false);
  assert.equal(Object.isFrozen(admission), true);
  assert.equal(Object.isFrozen(admission.lifecycle), true);
  assert.equal(Object.isFrozen(admission.authority), true);
  assert.deepEqual(
    sanitizeBuilderContextCompactionAdmissionRecord(structuredClone(admission), compactionProjection),
    admission,
  );
});

test('rejects stale projection bindings, wrong trigger semantics, and forged authority', () => {
  const compactionProjection = projection();
  assertAdmissionError(() => createBuilderContextCompactionAdmissionRecord(
    admissionInput(compactionProjection, {
      source_current_event_digest: `sha256:${'3'.repeat(64)}`,
    }),
    compactionProjection,
  ));
  assertAdmissionError(() => createBuilderContextCompactionAdmissionRecord(
    admissionInput(compactionProjection, { trigger: 'automatic_pressure' }),
    compactionProjection,
  ));
  assertAdmissionError(() => createBuilderContextCompactionAdmissionRecord(
    admissionInput(compactionProjection, { harness_turn_binding: 'active_turn' }),
    compactionProjection,
  ));
  assertAdmissionError(() => sanitizeBuilderContextCompactionAdmissionRecord({
    ...createBuilderContextCompactionAdmissionRecord(
      admissionInput(compactionProjection),
      compactionProjection,
    ),
    authority: {
      ...createBuilderContextCompactionAdmissionRecord(
        admissionInput(compactionProjection),
        compactionProjection,
      ).authority,
      provider_dispatch: true,
    },
  }, compactionProjection));
  assertAdmissionError(() => createBuilderContextCompactionAdmissionRecord(
    admissionInput(compactionProjection),
    {
      ...compactionProjection,
      source: {
        ...compactionProjection.source,
        current_sequence: compactionProjection.source.current_sequence - 1,
      },
    },
  ));
});

test('fails closed on extras, accessors, proxies, and non-useful projections', () => {
  const compactionProjection = projection();
  assertAdmissionError(() => createBuilderContextCompactionAdmissionRecord({
    ...admissionInput(compactionProjection),
    raw_output: 'secret-value',
  }, compactionProjection));

  let getterCalls = 0;
  const accessor = admissionInput(compactionProjection);
  Object.defineProperty(accessor, 'requested_by', {
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new Error('secret-value');
    },
  });
  assertAdmissionError(() => createBuilderContextCompactionAdmissionRecord(accessor, compactionProjection));
  assert.equal(getterCalls, 0);

  let proxyTrapInvoked = false;
  const proxyTrap = () => {
    proxyTrapInvoked = true;
    throw new Error('private proxy marker');
  };
  assertAdmissionError(() => createBuilderContextCompactionAdmissionRecord(new Proxy(
    admissionInput(compactionProjection),
    {
      getOwnPropertyDescriptor: proxyTrap,
      getPrototypeOf: proxyTrap,
      ownKeys: proxyTrap,
    },
  ), compactionProjection));
  assert.equal(proxyTrapInvoked, false);

  assertAdmissionError(() => createBuilderContextCompactionAdmissionRecord(
    admissionInput(compactionProjection),
    {
      ...compactionProjection,
      public_entry_count: 1,
    },
  ));
});

test('source remains a pure admission contract without runtime authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-context-compaction-admission.cjs'),
    'utf8',
  );

  assert.match(source, /main_context_compaction_admission_contract_v1/u);
  assert.match(source, /manual_compactNow_admission_only/u);
  assert.match(source, /admission_only_no_compaction_started/u);
  assert.doesNotMatch(
    source,
    /require\(['"](?:electron|node:http|node:https|http|https|node:fs|fs|node:child_process|child_process)['"]\)|ipcMain|ipcRenderer|contextBridge|BrowserWindow|safeStorage|builder-provider|builder-git|dugite|fetch\s*\(|https?:|Authorization|Bearer|execFile|spawn\s*\(|shell:\s*true|DatabaseSync|writeFile|rmSync|unlinkSync|localStorage|sessionStorage|indexedDB|eval\s*\(|new Function/iu,
  );
});
