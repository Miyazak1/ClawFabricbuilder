'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  BUILDER_CONTEXT_COMPACTION_ADMISSION_RECORD_KIND,
  BUILDER_CONTEXT_COMPACTION_ADMISSION_RECORD_VERSION,
  createBuilderContextCompactionAdmissionRecord,
} = require('../electron/builder-context-compaction-admission.cjs');
const {
  BUILDER_CONTEXT_COMPACTION_EXECUTION_BRIDGE_VERSION,
  BUILDER_CONTEXT_COMPACTION_EXECUTION_RESULT_VERSION,
  BuilderContextCompactionExecutionBridgeError,
  createBuilderContextCompactionExecutionBridge,
  sanitizeBuilderContextCompactionExecutionResult,
} = require('../electron/builder-context-compaction-execution-bridge.cjs');
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
const SESSION_ID = 'builder-harness-11111111-1111-4111-8111-111111111111';

function uuid(index) {
  return `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
}

function digest(char) {
  return `sha256:${char.repeat(64)}`;
}

function loadedConversation(extraAnswer = '') {
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
      text: `The conversation can be summarized into a compact checkpoint.${extraAnswer}`,
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

function projection(extraAnswer = '') {
  return createBuilderConversationCompactionProjection({
    loaded_conversation: loadedConversation(extraAnswer),
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

function admission(compactionProjection) {
  return createBuilderContextCompactionAdmissionRecord(
    admissionInput(compactionProjection),
    compactionProjection,
  );
}

async function assertBridgeError(fn, expectedCode = 'builder_context_compaction_execution_bridge_invalid') {
  await assert.rejects(
    fn,
    (error) => {
      assert.ok(error instanceof BuilderContextCompactionExecutionBridgeError);
      assert.equal(error.code, expectedCode);
      assert.doesNotMatch(
        `${error.name}:${error.message}:${error.stack}`,
        /secret-value|Authorization|Bearer|source_tree|provider_output|C:\\Users|raw prompt/iu,
      );
      return true;
    },
  );
}

test('invokes Harness manual compact only after a valid admission receipt', async () => {
  const compactionProjection = projection();
  const receipt = admission(compactionProjection);
  const calls = [];
  const controller = new AbortController();
  const bridge = createBuilderContextCompactionExecutionBridge({
    harness_runtime: {
      async manual_compact(request) {
        calls.push(request);
        return {
          compactionId: 'compaction:manual-1',
          sourceCommandId: request.source_command_id,
          startSeq: 10,
          summarySeq: 11,
          endSeq: 13,
          shadowedTokenCount: 48_000,
        };
      },
    },
  });

  const result = await bridge.execute_manual_compaction({
    session_id: SESSION_ID,
    context_compaction_admission: receipt,
    conversation_compaction_projection: compactionProjection,
    abort_signal: controller.signal,
  });

  assert.equal(bridge.bridge_version, BUILDER_CONTEXT_COMPACTION_EXECUTION_BRIDGE_VERSION);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].session_id, SESSION_ID);
  assert.equal(calls[0].source_command_id, receipt.admission_id);
  assert.equal(calls[0].abort_signal, controller.signal);
  assert.deepEqual(Reflect.ownKeys(calls[0]).sort(), [
    'abort_signal',
    'session_id',
    'source_command_id',
  ]);
  assert.deepEqual(result, {
    result_version: BUILDER_CONTEXT_COMPACTION_EXECUTION_RESULT_VERSION,
    operation: 'manual_compaction_completed',
    status: 'compaction_completed',
    admission_id: receipt.admission_id,
    conversation_compaction_projection_digest: receipt.conversation_compaction_projection_digest,
    compaction_id: 'compaction:manual-1',
    start_seq: 10,
    summary_seq: 11,
    end_seq: 13,
    shadowed_token_count: 48_000,
    authority: {
      bridge_authority: 'main_context_compaction_execution_bridge_v1',
      admission_authority: 'verified_main_context_compaction_admission_contract_v1',
      harness_authority: 'manual_compactNow_invoked_after_admission',
      renderer_authority: 'not_present',
      ipc_authority: 'not_present',
      provider_dispatch: 'harness_owned_compaction_only',
      tool_dispatch: 'not_performed_by_bridge',
      source_write: 'not_performed_by_bridge',
      sqlite_write: 'not_performed_by_bridge',
      permission_grant_authority: 'not_present',
      revision_authority: 'not_present',
      summary_materialization: 'not_performed_by_bridge',
    },
  });
  assert.deepEqual(sanitizeBuilderContextCompactionExecutionResult(structuredClone(result)), result);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.authority), true);
});

test('does not invoke runtime for stale or forged admission receipts', async () => {
  const originalProjection = projection();
  const staleProjection = projection(' Additional event text changes the projection id.');
  const receipt = admission(originalProjection);
  let calls = 0;
  const bridge = createBuilderContextCompactionExecutionBridge({
    harness_runtime: {
      async manual_compact() {
        calls += 1;
        throw new Error('must not be reached');
      },
    },
  });

  await assertBridgeError(() => bridge.execute_manual_compaction({
    session_id: SESSION_ID,
    context_compaction_admission: receipt,
    conversation_compaction_projection: staleProjection,
    abort_signal: null,
  }));
  await assertBridgeError(() => bridge.execute_manual_compaction({
    session_id: SESSION_ID,
    context_compaction_admission: {
      ...receipt,
      source_current_event_digest: `sha256:${'3'.repeat(64)}`,
    },
    conversation_compaction_projection: originalProjection,
    abort_signal: null,
  }));
  await assertBridgeError(() => bridge.execute_manual_compaction({
    session_id: SESSION_ID,
    context_compaction_admission: {
      ...receipt,
      authority: {
        ...receipt.authority,
        session_mutation: 'started',
      },
    },
    conversation_compaction_projection: originalProjection,
    abort_signal: null,
  }));
  assert.equal(calls, 0);
});

test('projects a no-op compact and rejects malformed Harness results', async () => {
  const compactionProjection = projection();
  const receipt = admission(compactionProjection);
  const noopBridge = createBuilderContextCompactionExecutionBridge({
    harness_runtime: {
      async manual_compact() { return null; },
    },
  });

  const noop = await noopBridge.execute_manual_compaction({
    session_id: SESSION_ID,
    context_compaction_admission: receipt,
    conversation_compaction_projection: compactionProjection,
    abort_signal: null,
  });

  assert.equal(noop.operation, 'manual_compaction_noop');
  assert.equal(noop.status, 'compaction_not_needed');
  assert.equal(noop.compaction_id, null);
  assert.equal(noop.start_seq, null);
  assert.equal(noop.summary_seq, null);
  assert.equal(noop.end_seq, null);
  assert.equal(noop.shadowed_token_count, null);
  assert.deepEqual(sanitizeBuilderContextCompactionExecutionResult(structuredClone(noop)), noop);

  const malformedBridge = createBuilderContextCompactionExecutionBridge({
    harness_runtime: {
      async manual_compact() {
        return {
          compactionId: 'compaction:bad',
          sourceCommandId: receipt.admission_id,
          startSeq: 20,
          summarySeq: 19,
          endSeq: 21,
          shadowedTokenCount: 5,
        };
      },
    },
  });
  await assertBridgeError(() => malformedBridge.execute_manual_compaction({
    session_id: SESSION_ID,
    context_compaction_admission: receipt,
    conversation_compaction_projection: compactionProjection,
    abort_signal: null,
  }));
});

test('normalizes runtime failures after a valid admission', async () => {
  const compactionProjection = projection();
  const receipt = admission(compactionProjection);
  const bridge = createBuilderContextCompactionExecutionBridge({
    harness_runtime: {
      async manual_compact() {
        throw new Error('secret-value from provider should not escape');
      },
    },
  });

  await assertBridgeError(() => bridge.execute_manual_compaction({
    session_id: SESSION_ID,
    context_compaction_admission: receipt,
    conversation_compaction_projection: compactionProjection,
    abort_signal: null,
  }), 'builder_context_compaction_execution_bridge_failed');
});

test('source remains a pure execution bridge without direct runtime or storage authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-context-compaction-execution-bridge.cjs'),
    'utf8',
  );

  assert.match(source, /main_context_compaction_execution_bridge_v1/u);
  assert.match(source, /manual_compactNow_invoked_after_admission/u);
  assert.match(source, /sanitizeBuilderContextCompactionAdmissionRecord/u);
  assert.doesNotMatch(
    source,
    /require\(['"](?:electron|node:http|node:https|http|https|node:fs|fs|node:child_process|child_process|node:sqlite)['"]\)|ipcMain|ipcRenderer|contextBridge|BrowserWindow|safeStorage|builder-provider|builder-git|dugite|fetch\s*\(|https?:|Authorization|Bearer|execFile|spawn\s*\(|shell:\s*true|DatabaseSync|writeFile|rmSync|unlinkSync|localStorage|sessionStorage|indexedDB|eval\s*\(|new Function/iu,
  );
});
