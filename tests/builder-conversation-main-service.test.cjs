'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  createBuilderConversationMainService,
} = require('../electron/builder-conversation-main-service.cjs');
const {
  BUILDER_PERMISSION_DECISION_VERSION,
  BUILDER_PERMISSION_POLICY_VERSION,
} = require('../electron/builder-permission-authority-contract.cjs');
const {
  createBuilderProductMetadataDatabase,
} = require('../electron/builder-product-metadata-database.cjs');
const {
  replayBuilderConversation,
} = require('../electron/builder-conversation-replay.cjs');
const {
  createBuilderToolPermissionAdmission,
} = require('../electron/builder-tool-permission-admission.cjs');
const {
  DEFAULT_BUILDER_TOOL_SESSION_LIMITS,
  createBuilderToolSessionPolicy,
} = require('../electron/builder-tool-session-policy.cjs');
const {
  createBuilderToolCallRecord,
} = require('../electron/builder-tool-call-records.cjs');
const {
  createBuilderToolResultRecord,
} = require('../electron/builder-tool-result-records.cjs');

const PROJECT_ID = 'builder-project:11111111-1111-4111-8111-111111111111';
const REQUEST_DIGEST = `sha256:${'1'.repeat(64)}`;
const QUESTION_DIGEST = `sha256:${'0'.repeat(64)}`;
const CANDIDATE_DIGEST = `sha256:${'2'.repeat(64)}`;
const TOOL_ACTOR_ID = 'builder-user:11111111-1111-4111-8111-111111111112';
const TOOL_CALL_ID = 'builder-tool-call:11111111-1111-4111-8111-111111111113';
const TOOL_STEP_ID = 'builder-run-step:11111111-1111-4111-8111-111111111114';
const TOOL_PERMISSION_ID = `builder-permission:${'a'.repeat(64)}`;
const BASE_REVISION = Object.freeze({
  revision_receipt_digest: `sha256:${'3'.repeat(64)}`,
  commit_oid: '4'.repeat(40),
});

function uuidFactory(start = 1) {
  let value = start;
  return () => {
    const suffix = value.toString(16).padStart(12, '0');
    value += 1;
    return `00000000-0000-4000-8000-${suffix}`;
  };
}

function removeRoot(root) {
  let lastError = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      fs.rmSync(root, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      if (!error || typeof error !== 'object' || !['EBUSY', 'ENOTEMPTY', 'EPERM'].includes(error.code)) {
        throw error;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25 * (attempt + 1));
    }
  }
  if (lastError instanceof Error) throw lastError;
  throw new Error('Temporary test directory could not be removed.');
}

function fixture(uuidStart = 1, nowStart = 1_000) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cfb-cms-'));
  const database = createBuilderProductMetadataDatabase(path.join(root, 'builder.sqlite'));
  let now = nowStart;
  const service = createBuilderConversationMainService({
    metadataAuthority: database,
    createUuid: uuidFactory(uuidStart),
    nowMs: () => now++,
  });
  return {
    root,
    database,
    service,
    setNow(next) {
      now = next;
    },
    close() {
      database.close();
      removeRoot(root);
    },
  };
}

function begin(service, baseRevision = null, instruction = 'Build a focused timer') {
  return service.begin_work({
    project_id: PROJECT_ID,
    instruction,
    request_digest: REQUEST_DIGEST,
    base_revision: baseRevision,
  });
}

function beginQuestion(service, baseRevision = null, question = 'What changed in this project?') {
  return service.begin_question({
    project_id: PROJECT_ID,
    question,
    request_digest: QUESTION_DIGEST,
    base_revision: baseRevision,
  });
}

function candidateResult(context) {
  return {
    draft_id: `builder-generation-draft:${'5'.repeat(64)}`,
    title: 'Focused timer',
    summary: 'A focused timer draft.',
    git_candidate_receipt: {
      receipt_version: 'builder-git-candidate-receipt.v1',
      repository_version: 'builder-git-project-repository.v1',
      project_id: PROJECT_ID,
      conversation_id: context.conversation.conversation_id,
      turn_id: context.ids.turn_id,
      task_id: context.ids.task_id,
      run_id: context.ids.run_id,
      request_id: `builder-git-request:${uuidFactory(900)()}`,
      candidate_id: `builder-code-change-candidate:${'6'.repeat(64)}`,
      candidate_digest: CANDIDATE_DIGEST,
      resulting_tree_digest: `sha256:${'7'.repeat(64)}`,
      semantic_identity_digest: `sha256:${'8'.repeat(64)}`,
      verification_receipt_digest: `sha256:${'9'.repeat(64)}`,
      object_format: 'sha1',
      commit_oid: 'a'.repeat(40),
      tree_oid: 'b'.repeat(40),
      parent_oid: null,
      expected_base_oid: null,
      code_authority: 'git_commit_candidate',
      product_revision_admission: 'not_recorded',
      replay: false,
    },
  };
}

function toolPermissionRequest(overrides = {}) {
  return {
    tool_call_id: TOOL_CALL_ID,
    tool_name: 'filesystem.read',
    project_id: PROJECT_ID,
    action: 'filesystem.read',
    resource: {
      resource_kind: 'filesystem',
      project_id: PROJECT_ID,
      resource_id: 'project:/src/app.tsx',
    },
    ...overrides,
  };
}

async function allowedToolAdmission(overrides = {}) {
  const request = toolPermissionRequest(overrides.request ?? {});
  const guard = createBuilderToolPermissionAdmission({
    actor_id: TOOL_ACTOR_ID,
    now_ms: () => overrides.now_ms ?? 50,
    evaluate_permission: async (body) => ({
      decision_version: BUILDER_PERMISSION_DECISION_VERSION,
      policy_version: BUILDER_PERMISSION_POLICY_VERSION,
      actor_id: TOOL_ACTOR_ID,
      action: body.action,
      resource: body.resource,
      evaluated_at_ms: body.now_ms,
      decision: 'allowed',
      reason: 'matching_active_grant',
      permission_id: TOOL_PERMISSION_ID,
      permission_authority: 'builder_permission_facts_deny_by_default_v1',
      ui_selection_authority: 'not_permission',
      ...(overrides.decision ?? {}),
    }),
  });
  return guard.admit(request);
}

async function toolCallRecord(context, overrides = {}) {
  const recordOverrides = overrides.record ?? {};
  const projectId = recordOverrides.project_id ?? PROJECT_ID;
  const conversationId = recordOverrides.conversation_id ?? context.conversation.conversation_id;
  const turnId = recordOverrides.turn_id ?? context.ids.turn_id;
  const taskId = recordOverrides.task_id ?? context.ids.task_id;
  const runId = recordOverrides.run_id ?? context.ids.run_id;
  const sessionPolicy = createBuilderToolSessionPolicy({
    project_id: projectId,
    conversation_id: conversationId,
    turn_id: turnId,
    task_id: taskId,
    run_id: runId,
    issued_at_ms: 49,
    limits: { ...DEFAULT_BUILDER_TOOL_SESSION_LIMITS },
    ...(overrides.session_policy ?? {}),
  });
  return createBuilderToolCallRecord({
    project_id: projectId,
    conversation_id: conversationId,
    turn_id: turnId,
    task_id: taskId,
    run_id: runId,
    step_id: TOOL_STEP_ID,
    session_policy: sessionPolicy,
    admission: await allowedToolAdmission(overrides.admission ?? {}),
    requested_at_ms: 60,
    ...recordOverrides,
  });
}

function toolResultRecord(record, overrides = {}) {
  return createBuilderToolResultRecord({
    tool_call_record: record,
    observed_at_ms: 70,
    result: {
      status: 'failed',
      summary_code: 'output_rejected',
    },
    ...overrides,
  });
}

test('records start and terminal events before allowing a later turn to continue', () => {
  const item = fixture();
  try {
    const first = begin(item.service);
    assert.equal(first.start_head.sequence, 2);
    assert.deepEqual(first.events.map((event) => event.event_type), [
      'turn_submitted',
      'run_started',
    ]);

    const terminal = item.service.complete_candidate({
      context: first,
      candidate_result: candidateResult(first),
      assistant_text: 'A timer draft is ready to review.',
    });
    assert.equal(terminal.head.sequence, 4);
    assert.equal(terminal.snapshot.active_turn_id, null);
    assert.equal(terminal.snapshot.turns[0].outcome, 'candidate_ready');
    assert.equal(terminal.snapshot.turns[0].messages[1].role, 'assistant');

    const second = begin(item.service, BASE_REVISION, 'Make the timer more compact');
    assert.equal(second.start_head.sequence, 6);
    assert.deepEqual(second.events.slice(-2).map((event) => event.event_type), [
      'turn_submitted',
      'run_started',
    ]);
  } finally {
    item.close();
  }
});

test('records a question explanation without creating task, candidate, or revision facts', () => {
  const item = fixture();
  let restartedDatabase = null;
  try {
    const context = beginQuestion(item.service);
    assert.equal(context.mode, 'question');
    assert.equal(context.ids.task_id, null);
    assert.equal(context.start_head.sequence, 2);
    assert.deepEqual(context.events.map((event) => event.event_type), [
      'turn_submitted',
      'run_started',
    ]);
    assert.equal(context.events[0].payload.mode, 'question');
    assert.equal(context.events[0].payload.task, null);
    assert.equal(context.events[1].payload.task_id, null);

    const terminal = item.service.complete_explanation({
      context,
      assistant_text: 'This project is saved locally and can be revised without creating a new version.',
    });
    assert.equal(terminal.head.sequence, 4);
    assert.equal(terminal.snapshot.active_turn_id, null);
    assert.equal(terminal.snapshot.turns[0].mode, 'question');
    assert.equal(terminal.snapshot.turns[0].task, null);
    assert.equal(terminal.snapshot.turns[0].outcome, 'answered');
    assert.equal(terminal.snapshot.turns[0].runs[0].result_kind, 'explanation');
    assert.equal(terminal.snapshot.turns[0].runs[0].candidate_result, null);

    const followup = beginQuestion(item.service, null, 'Can I ask another question before saving?');
    assert.equal(followup.project.created_at_ms, context.project.created_at_ms);
    assert.equal(followup.conversation.created_at_ms, context.conversation.created_at_ms);
    assert.equal(followup.start_head.sequence, 6);
    assert.equal(followup.events[0].payload.mode, 'question');
    assert.equal(followup.events[0].payload.task, null);
    const followupTerminal = item.service.complete_explanation({
      context: followup,
      assistant_text: 'Yes. Questions can continue without creating a saved version.',
    });
    assert.equal(followupTerminal.head.sequence, 8);

    const stream = item.service.read_stream({ project_id: PROJECT_ID });
    assert.equal(stream.conversation.head_sequence, 8);
    assert.equal(stream.conversation.items[0].mode, 'question');
    assert.equal(stream.conversation.items[0].task, null);
    assert.equal(stream.conversation.items[1].task_id, null);
    assert.equal(stream.conversation.items[2].result_kind, 'explanation');
    assert.equal(stream.conversation.items[2].candidate, null);
    assert.equal(stream.conversation.items[3].outcome, 'answered');
    assert.equal(stream.conversation.items[4].mode, 'question');
    assert.equal(stream.conversation.items[4].task, null);
    assert.equal(stream.conversation.items[6].result_kind, 'explanation');
    assert.equal(stream.conversation.items[6].candidate, null);
    assert.equal(stream.conversation.items[7].outcome, 'answered');
    assert.doesNotMatch(
      JSON.stringify(stream),
      /candidate_digest|git_candidate_receipt|commit_oid|tree_oid|revision_receipt|save_admission|provider|credential/iu,
    );

    item.database.close();
    restartedDatabase = createBuilderProductMetadataDatabase(
      path.join(item.root, 'builder.sqlite'),
    );
    const restartedService = createBuilderConversationMainService({
      metadataAuthority: restartedDatabase,
      createUuid: uuidFactory(800),
      nowMs: () => 8_000,
    });
    assert.deepEqual(restartedService.read_stream({ project_id: PROJECT_ID }), stream);
  } finally {
    if (restartedDatabase !== null) restartedDatabase.close();
    try { item.database.close(); } catch { /* already closed during restart check */ }
    removeRoot(item.root);
  }
});

test('restores the same renderer-safe task stream after a real database restart', () => {
  const item = fixture();
  let restartedDatabase = null;
  try {
    const context = begin(item.service);
    item.service.complete_candidate({
      context,
      candidate_result: candidateResult(context),
      assistant_text: 'A timer draft is ready to review.',
    });
    const before = item.service.read_stream({ project_id: PROJECT_ID });
    assert.equal(before.stream_version, 'builder-task-stream-read-result.v1');
    assert.equal(before.conversation.head_sequence, 4);
    assert.equal(before.conversation.items[1].recorded_state, 'started');
    assert.equal(before.conversation.items[2].candidate.candidate_state, 'proposed');
    assert.equal(before.conversation.items[2].candidate.source_availability, 'not_loaded');
    assert.doesNotMatch(
      JSON.stringify(before),
      /git_candidate_receipt|candidate_digest|commit_oid|tree_oid|credential|provider|running|save_admission/iu,
    );

    item.database.close();
    restartedDatabase = createBuilderProductMetadataDatabase(
      path.join(item.root, 'builder.sqlite'),
    );
    const restartedService = createBuilderConversationMainService({
      metadataAuthority: restartedDatabase,
      createUuid: uuidFactory(300),
      nowMs: () => 3_000,
    });
    assert.deepEqual(restartedService.read_stream({ project_id: PROJECT_ID }), before);
  } finally {
    if (restartedDatabase !== null) restartedDatabase.close();
    try { item.database.close(); } catch { /* already closed during restart check */ }
    removeRoot(item.root);
  }
});

test('records main-only tool request and fixed-code result facts without dispatching tools', async () => {
  const item = fixture();
  let restartedDatabase = null;
  try {
    const context = begin(item.service);
    const callRecord = await toolCallRecord(context);
    const requestedContext = item.service.record_tool_call_request({
      context,
      tool_call_record: callRecord,
    });
    assert.equal(requestedContext.start_head.sequence, 3);
    assert.equal(requestedContext.events.at(-1).event_type, 'tool_call_requested');

    const resultRecord = toolResultRecord(callRecord);
    const resultContext = item.service.record_tool_result({
      context: requestedContext,
      tool_result_record: resultRecord,
    });
    assert.equal(resultContext.start_head.sequence, 4);
    assert.equal(resultContext.events.at(-1).event_type, 'tool_call_result_recorded');

    const pendingStream = item.service.read_stream({ project_id: PROJECT_ID });
    assert.equal(pendingStream.conversation.head_sequence, 4);
    assert.deepEqual(pendingStream.conversation.items[2], {
      item_kind: 'tool_call_requested',
      sequence: 3,
      turn_id: context.ids.turn_id,
      run_id: context.ids.run_id,
      step_id: TOOL_STEP_ID,
      tool_call_id: TOOL_CALL_ID,
      tool_label: 'Read project file',
      action: 'filesystem.read',
      resource: {
        resource_kind: 'filesystem',
      },
      lifecycle: {
        permission_admission: 'verified_allowed',
        dispatch_admission: 'not_started',
        execution_admission: 'not_performed',
        result_admission: 'not_recorded',
      },
      recorded_state: 'requested',
    });
    assert.deepEqual(pendingStream.conversation.items[3], {
      item_kind: 'tool_call_result_recorded',
      sequence: 4,
      turn_id: context.ids.turn_id,
      run_id: context.ids.run_id,
      step_id: TOOL_STEP_ID,
      tool_call_id: TOOL_CALL_ID,
      tool_label: 'Read project file',
      action: 'filesystem.read',
      resource: {
        resource_kind: 'filesystem',
      },
      result: {
        status: 'failed',
        summary_code: 'output_rejected',
        display_summary: 'The tool output was not accepted.',
      },
      lifecycle: {
        result_admission: 'fixed_summary_code_recorded',
        raw_output_admission: 'not_included',
        revision_admission: 'not_created',
      },
      recorded_state: 'recorded',
    });
    assert.doesNotMatch(
      JSON.stringify(pendingStream),
      /tool_result_record|tool_call_record|session_policy|permission_id|permission_admission_receipt|record_digest|summary_digest|resource_id|project:\/src\/app\.tsx|stdout|stderr|output_digest|git_candidate_receipt|commit_oid|tree_oid|provider|credential|source_tree|save_admission/iu,
    );

    const completed = item.service.complete_failure({
      context: resultContext,
      failure_code: 'builder_tool_step_failed',
    });
    assert.equal(completed.head.sequence, 6);
    assert.equal(completed.snapshot.turns[0].outcome, 'failed');
    assert.equal(completed.snapshot.turns[0].runs[0].terminal_status, 'failed');

    const completedStream = item.service.read_stream({ project_id: PROJECT_ID });
    assert.equal(completedStream.conversation.head_sequence, 6);
    assert.equal(completedStream.conversation.recorded_active_turn_id, null);
    assert.equal(completedStream.conversation.items[4].terminal_status, 'failed');
    assert.equal(completedStream.conversation.items[5].outcome, 'failed');
    assert.doesNotMatch(
      JSON.stringify(completedStream),
      /running|live_run|save_admission|revision_receipt|provider|credential/iu,
    );

    item.database.close();
    restartedDatabase = createBuilderProductMetadataDatabase(
      path.join(item.root, 'builder.sqlite'),
    );
    const restartedService = createBuilderConversationMainService({
      metadataAuthority: restartedDatabase,
      createUuid: uuidFactory(500),
      nowMs: () => 5_000,
    });
    assert.deepEqual(restartedService.read_stream({ project_id: PROJECT_ID }), completedStream);
  } finally {
    if (restartedDatabase !== null) restartedDatabase.close();
    try { item.database.close(); } catch { /* already closed during restart check */ }
    removeRoot(item.root);
  }
});

test('rejects invalid main-only tool fact recording without committing partial events', async () => {
  const item = fixture();
  const questionItem = fixture(700);
  try {
    const context = begin(item.service);
    const question = beginQuestion(questionItem.service);
    const callRecord = await toolCallRecord(context);
    const resultRecord = toolResultRecord(callRecord);
    const staleContext = Object.freeze({
      ...context,
      start_head: { ...context.start_head },
      events: context.events,
    });
    const otherRecord = await toolCallRecord(context, {
      admission: {
        request: {
          tool_call_id: 'builder-tool-call:11111111-1111-4111-8111-111111111115',
        },
      },
      record: {
        run_id: 'builder-run:11111111-1111-4111-8111-111111111119',
        step_id: 'builder-run-step:11111111-1111-4111-8111-111111111116',
      },
    });
    const futureRecord = await toolCallRecord(context, {
      admission: {
        request: {
          tool_call_id: 'builder-tool-call:11111111-1111-4111-8111-111111111117',
        },
      },
      record: {
        step_id: 'builder-run-step:11111111-1111-4111-8111-111111111118',
        requested_at_ms: 99_999,
      },
    });

    for (const action of [
      () => item.service.record_tool_call_request({
        context: staleContext,
        tool_call_record: callRecord,
      }),
      () => item.service.record_tool_call_request({
        context: question,
        tool_call_record: callRecord,
      }),
      () => item.service.record_tool_call_request({
        context,
        tool_call_record: otherRecord,
      }),
      () => item.service.record_tool_call_request({
        context,
        tool_call_record: futureRecord,
      }),
      () => item.service.record_tool_result({
        context,
        tool_result_record: resultRecord,
      }),
    ]) {
      assert.throws(action, { code: 'builder_conversation_main_service_unavailable' });
    }
    assert.equal(item.service.read_stream({ project_id: PROJECT_ID }).conversation.head_sequence, 2);

    const requestedContext = item.service.record_tool_call_request({
      context,
      tool_call_record: callRecord,
    });
    const resultContext = item.service.record_tool_result({
      context: requestedContext,
      tool_result_record: resultRecord,
    });
    assert.throws(() => item.service.record_tool_result({
      context: resultContext,
      tool_result_record: resultRecord,
    }), { code: 'builder_conversation_main_service_unavailable' });
    assert.throws(() => item.service.complete_candidate({
      context: resultContext,
      candidate_result: candidateResult(context),
      assistant_text: 'A timer draft is ready.',
    }), { code: 'builder_conversation_main_service_unavailable' });
  } finally {
    questionItem.close();
    item.close();
  }
});

test('enforces main-only tool session state before appending tool facts', async () => {
  const item = fixture(900);
  const retryItem = fixture(1_000);
  try {
    const context = begin(item.service);
    const first = await toolCallRecord(context);
    const requestedContext = item.service.record_tool_call_request({
      context,
      tool_call_record: first,
    });
    assert.equal(requestedContext.start_head.sequence, 3);

    const pendingSecond = await toolCallRecord(context, {
      admission: {
        request: {
          tool_call_id: 'builder-tool-call:11111111-1111-4111-8111-111111111120',
        },
      },
      record: {
        step_id: 'builder-run-step:11111111-1111-4111-8111-111111111121',
        requested_at_ms: 80,
      },
    });
    assert.throws(() => item.service.record_tool_call_request({
      context: requestedContext,
      tool_call_record: pendingSecond,
    }), { code: 'builder_conversation_main_service_unavailable' });
    assert.equal(item.service.read_stream({ project_id: PROJECT_ID }).conversation.head_sequence, 3);

    const settledContext = item.service.record_tool_result({
      context: requestedContext,
      tool_result_record: toolResultRecord(first, {
        observed_at_ms: 90,
        result: {
          status: 'succeeded',
          summary_code: 'completed_without_raw_output',
        },
      }),
    });
    assert.equal(settledContext.start_head.sequence, 4);

    const driftedPolicy = await toolCallRecord(context, {
      admission: {
        request: {
          tool_call_id: 'builder-tool-call:11111111-1111-4111-8111-111111111122',
        },
      },
      session_policy: { issued_at_ms: 50 },
      record: {
        step_id: 'builder-run-step:11111111-1111-4111-8111-111111111123',
        requested_at_ms: 100,
      },
    });
    assert.throws(() => item.service.record_tool_call_request({
      context: settledContext,
      tool_call_record: driftedPolicy,
    }), { code: 'builder_conversation_main_service_unavailable' });
    assert.equal(item.service.read_stream({ project_id: PROJECT_ID }).conversation.head_sequence, 4);

    const retryContext = begin(retryItem.service);
    const retryPolicy = {
      limits: {
        ...DEFAULT_BUILDER_TOOL_SESSION_LIMITS,
        max_steps: 4,
        max_tool_calls: 4,
        max_retries: 1,
      },
    };
    const retryFirst = await toolCallRecord(retryContext, {
      session_policy: retryPolicy,
      admission: {
        request: {
          tool_call_id: 'builder-tool-call:11111111-1111-4111-8111-111111111124',
        },
      },
      record: {
        step_id: 'builder-run-step:11111111-1111-4111-8111-111111111125',
        requested_at_ms: 60,
      },
    });
    const retryFirstRequested = retryItem.service.record_tool_call_request({
      context: retryContext,
      tool_call_record: retryFirst,
    });
    const retryFirstResult = retryItem.service.record_tool_result({
      context: retryFirstRequested,
      tool_result_record: toolResultRecord(retryFirst, { observed_at_ms: 70 }),
    });
    const retrySecond = await toolCallRecord(retryContext, {
      session_policy: retryPolicy,
      admission: {
        request: {
          tool_call_id: 'builder-tool-call:11111111-1111-4111-8111-111111111126',
        },
      },
      record: {
        step_id: 'builder-run-step:11111111-1111-4111-8111-111111111127',
        requested_at_ms: 80,
      },
    });
    const retrySecondRequested = retryItem.service.record_tool_call_request({
      context: retryFirstResult,
      tool_call_record: retrySecond,
    });
    const retrySecondResult = retryItem.service.record_tool_result({
      context: retrySecondRequested,
      tool_result_record: toolResultRecord(retrySecond, { observed_at_ms: 90 }),
    });
    const exhausted = await toolCallRecord(retryContext, {
      session_policy: retryPolicy,
      admission: {
        request: {
          tool_call_id: 'builder-tool-call:11111111-1111-4111-8111-111111111128',
        },
      },
      record: {
        step_id: 'builder-run-step:11111111-1111-4111-8111-111111111129',
        requested_at_ms: 100,
      },
    });
    assert.throws(() => retryItem.service.record_tool_call_request({
      context: retrySecondResult,
      tool_call_record: exhausted,
    }), { code: 'builder_conversation_main_service_unavailable' });
    assert.equal(retryItem.service.read_stream({ project_id: PROJECT_ID }).conversation.head_sequence, 6);
  } finally {
    retryItem.close();
    item.close();
  }
});

test('uses durable tool record timestamps for replay-equivalent session admission', async () => {
  const item = fixture(1_100);
  try {
    const context = begin(item.service);
    const callRecord = await toolCallRecord(context, {
      admission: { now_ms: 1_002 },
      session_policy: { issued_at_ms: 1_001 },
      record: { requested_at_ms: 1_003 },
    });
    item.setNow(400_000);
    const requestedContext = item.service.record_tool_call_request({
      context,
      tool_call_record: callRecord,
    });
    assert.equal(requestedContext.start_head.sequence, 3);

    const resultRecord = toolResultRecord(callRecord, { observed_at_ms: 1_004 });
    item.setNow(400_001);
    const resultContext = item.service.record_tool_result({
      context: requestedContext,
      tool_result_record: resultRecord,
    });
    assert.equal(resultContext.start_head.sequence, 4);

    const stream = item.service.read_stream({ project_id: PROJECT_ID });
    assert.equal(stream.conversation.head_sequence, 4);
    assert.equal(stream.conversation.items[2].recorded_state, 'requested');
    assert.equal(stream.conversation.items[3].recorded_state, 'recorded');
  } finally {
    item.close();
  }
});

test('restores a main-only candidate draft proof after a real database restart', () => {
  const item = fixture();
  let restartedDatabase = null;
  try {
    const context = begin(item.service);
    const candidate = candidateResult(context);
    item.service.complete_candidate({
      context,
      candidate_result: candidate,
      assistant_text: 'A timer draft is ready to review.',
    });
    const before = item.service.read_candidate_draft({ draft_id: candidate.draft_id });
    assert.equal(before.result_version, 'builder-conversation-candidate-draft-read-result.v1');
    assert.equal(before.draft_id, candidate.draft_id);
    assert.equal(before.conversation_head.sequence, 4);
    assert.equal(before.base_revision, null);
    assert.equal(before.candidate_result.git_candidate_receipt.candidate_digest, CANDIDATE_DIGEST);
    assert.doesNotMatch(JSON.stringify(before), /source_tree|provider|credential|running|live/iu);

    item.database.close();
    restartedDatabase = createBuilderProductMetadataDatabase(
      path.join(item.root, 'builder.sqlite'),
    );
    const restartedService = createBuilderConversationMainService({
      metadataAuthority: restartedDatabase,
      createUuid: uuidFactory(500),
      nowMs: () => 5_000,
    });
    assert.deepEqual(
      restartedService.read_candidate_draft({ draft_id: candidate.draft_id }),
      before,
    );
  } finally {
    if (restartedDatabase !== null) restartedDatabase.close();
    try { item.database.close(); } catch { /* already closed during restart check */ }
    removeRoot(item.root);
  }
});

test('records durable candidate rejection and does not restore or verify it afterward', () => {
  const item = fixture();
  let restartedDatabase = null;
  try {
    const context = begin(item.service);
    const candidate = candidateResult(context);
    const terminal = item.service.complete_candidate({
      context,
      candidate_result: candidate,
      assistant_text: 'A timer draft is ready to review.',
    });
    const rejected = item.service.reject_candidate({ draft_id: candidate.draft_id });
    assert.deepEqual(rejected, {
      result_version: 'builder-conversation-candidate-reject-result.v1',
      draft_id: candidate.draft_id,
      project_id: PROJECT_ID,
      conversation_id: context.conversation.conversation_id,
      rejection_admission: 'sqlite_recorded',
    });

    const stream = item.service.read_stream({ project_id: PROJECT_ID });
    assert.equal(stream.conversation.head_sequence, 5);
    assert.deepEqual(stream.conversation.items.at(-1), {
      item_kind: 'candidate_reviewed',
      sequence: 5,
      turn_id: context.ids.turn_id,
      run_id: context.ids.run_id,
      draft_id: candidate.draft_id,
      decision: 'rejected',
      candidate_state: 'rejected',
      saved_revision: null,
    });
    assert.doesNotMatch(
      JSON.stringify(stream),
      /review_id|reviewer_id|reviewed_at_ms|git_candidate_receipt|candidate_digest|commit_oid|tree_oid|provider|credential/iu,
    );
    assert.throws(
      () => item.service.read_candidate_draft({ draft_id: candidate.draft_id }),
      { code: 'builder_conversation_main_service_unavailable' },
    );
    assert.throws(
      () => item.service.verify_candidate({
        project_id: PROJECT_ID,
        conversation_id: context.conversation.conversation_id,
        turn_id: context.ids.turn_id,
        task_id: context.ids.task_id,
        run_id: context.ids.run_id,
        candidate_digest: CANDIDATE_DIGEST,
        conversation_head: terminal.head,
      }),
      { code: 'builder_conversation_main_service_unavailable' },
    );
    assert.throws(
      () => item.service.reject_candidate({ draft_id: candidate.draft_id }),
      { code: 'builder_conversation_main_service_unavailable' },
    );

    item.database.close();
    restartedDatabase = createBuilderProductMetadataDatabase(
      path.join(item.root, 'builder.sqlite'),
    );
    const restartedService = createBuilderConversationMainService({
      metadataAuthority: restartedDatabase,
      createUuid: uuidFactory(750),
      nowMs: () => 7_500,
    });
    assert.throws(
      () => restartedService.read_candidate_draft({ draft_id: candidate.draft_id }),
      { code: 'builder_conversation_main_service_unavailable' },
    );
    assert.deepEqual(restartedService.read_stream({ project_id: PROJECT_ID }), stream);
  } finally {
    if (restartedDatabase !== null) restartedDatabase.close();
    try { item.database.close(); } catch { /* already closed during restart check */ }
    removeRoot(item.root);
  }
});

test('records durable candidate acceptance and does not restore or review it afterward', () => {
  const item = fixture();
  let restartedDatabase = null;
  try {
    const context = begin(item.service);
    const candidate = candidateResult(context);
    const terminal = item.service.complete_candidate({
      context,
      candidate_result: candidate,
      assistant_text: 'A timer draft is ready to review.',
    });
    const accepted = item.service.accept_candidate({
      draft_id: candidate.draft_id,
      review_id: 'builder-review:00000000-0000-4000-8000-000000000900',
      reviewer_id: 'builder-user:00000000-0000-4000-8000-000000000901',
      reviewed_at_ms: 9_000,
      revision: {
        revision_receipt_digest: `sha256:${'a'.repeat(64)}`,
        revision_number: 1,
      },
    });
    assert.deepEqual(accepted, {
      result_version: 'builder-conversation-candidate-accept-result.v1',
      draft_id: candidate.draft_id,
      project_id: PROJECT_ID,
      conversation_id: context.conversation.conversation_id,
      acceptance_admission: 'sqlite_recorded',
    });

    const stream = item.service.read_stream({ project_id: PROJECT_ID });
    assert.equal(stream.conversation.head_sequence, 5);
    assert.deepEqual(stream.conversation.items.at(-1), {
      item_kind: 'candidate_reviewed',
      sequence: 5,
      turn_id: context.ids.turn_id,
      run_id: context.ids.run_id,
      draft_id: candidate.draft_id,
      decision: 'accepted',
      candidate_state: 'saved',
      saved_revision: { revision_number: 1 },
    });
    assert.doesNotMatch(
      JSON.stringify(stream),
      /review_id|reviewer_id|reviewed_at_ms|revision_receipt|git_candidate_receipt|candidate_digest|commit_oid|tree_oid|provider|credential/iu,
    );
    assert.throws(
      () => item.service.read_candidate_draft({ draft_id: candidate.draft_id }),
      { code: 'builder_conversation_main_service_unavailable' },
    );
    assert.throws(
      () => item.service.verify_candidate({
        project_id: PROJECT_ID,
        conversation_id: context.conversation.conversation_id,
        turn_id: context.ids.turn_id,
        task_id: context.ids.task_id,
        run_id: context.ids.run_id,
        candidate_digest: CANDIDATE_DIGEST,
        conversation_head: terminal.head,
      }),
      { code: 'builder_conversation_main_service_unavailable' },
    );
    assert.throws(
      () => item.service.reject_candidate({ draft_id: candidate.draft_id }),
      { code: 'builder_conversation_main_service_unavailable' },
    );
    assert.throws(
      () => item.service.accept_candidate({
        draft_id: candidate.draft_id,
        review_id: 'builder-review:00000000-0000-4000-8000-000000000902',
        reviewer_id: 'builder-user:00000000-0000-4000-8000-000000000903',
        reviewed_at_ms: 9_001,
        revision: {
          revision_receipt_digest: `sha256:${'b'.repeat(64)}`,
          revision_number: 2,
        },
      }),
      { code: 'builder_conversation_main_service_unavailable' },
    );

    item.database.close();
    restartedDatabase = createBuilderProductMetadataDatabase(
      path.join(item.root, 'builder.sqlite'),
    );
    const restartedService = createBuilderConversationMainService({
      metadataAuthority: restartedDatabase,
      createUuid: uuidFactory(850),
      nowMs: () => 8_500,
    });
    assert.throws(
      () => restartedService.read_candidate_draft({ draft_id: candidate.draft_id }),
      { code: 'builder_conversation_main_service_unavailable' },
    );
    assert.deepEqual(restartedService.read_stream({ project_id: PROJECT_ID }), stream);
  } finally {
    if (restartedDatabase !== null) restartedDatabase.close();
    try { item.database.close(); } catch { /* already closed during restart check */ }
    removeRoot(item.root);
  }
});

test('returns a legal empty stream when the project has no conversation', () => {
  const item = fixture();
  try {
    assert.deepEqual(item.service.read_stream({ project_id: PROJECT_ID }), {
      stream_version: 'builder-task-stream-read-result.v1',
      project_id: PROJECT_ID,
      conversation: null,
      authority: {
        conversation: 'sqlite_canonical_event_replay_or_absent',
        project_source: 'not_included',
        candidate_source: 'not_loaded',
        project_revision: 'not_inferred',
      },
    });
    assert.throws(() => item.service.read_stream({
      project_id: PROJECT_ID,
      extra: 'private-marker',
    }), {
      code: 'builder_task_stream_unavailable',
      message: 'Project activity is unavailable.',
      retryable: true,
    });
  } finally {
    item.close();
  }
});

test('reads a restarted active run as recorded without mutating durable events', () => {
  const item = fixture();
  let restartedDatabase = null;
  try {
    const context = begin(item.service);
    const request = {
      project_id: PROJECT_ID,
      conversation_id: context.conversation.conversation_id,
    };
    const beforeRestart = item.database.load_conversation(request);
    assert.equal(beforeRestart.current_head.sequence, 2);

    item.database.close();
    restartedDatabase = createBuilderProductMetadataDatabase(
      path.join(item.root, 'builder.sqlite'),
    );
    const durableBeforeRead = restartedDatabase.load_conversation(request);
    const restartedService = createBuilderConversationMainService({
      metadataAuthority: restartedDatabase,
      createUuid: uuidFactory(400),
      nowMs: () => 4_000,
    });
    const stream = restartedService.read_stream({ project_id: PROJECT_ID });
    assert.equal(stream.conversation.head_sequence, 2);
    assert.equal(stream.conversation.recorded_active_turn_id, context.ids.turn_id);
    assert.equal(stream.conversation.items.at(-1).recorded_state, 'started');
    assert.doesNotMatch(JSON.stringify(stream), /running|live/iu);
    const durableAfterRead = restartedDatabase.load_conversation(request);
    assert.deepEqual(durableAfterRead, durableBeforeRead);
  } finally {
    if (restartedDatabase !== null) restartedDatabase.close();
    try { item.database.close(); } catch { /* already closed during restart check */ }
    removeRoot(item.root);
  }
});

test('recovers a running turn as interrupted without redispatching a provider', () => {
  const item = fixture();
  let restartedDatabase = null;
  try {
    const abandoned = begin(item.service);
    assert.equal(abandoned.start_head.sequence, 2);

    item.database.close();
    restartedDatabase = createBuilderProductMetadataDatabase(
      path.join(item.root, 'builder.sqlite'),
    );
    const restartedService = createBuilderConversationMainService({
      metadataAuthority: restartedDatabase,
      createUuid: uuidFactory(200),
      nowMs: () => 2_000,
    });
    const resumed = begin(restartedService, BASE_REVISION, 'Try a new direction');
    assert.equal(resumed.start_head.sequence, 7);
    assert.deepEqual(resumed.events.map((event) => event.event_type), [
      'turn_submitted',
      'run_started',
      'run_interrupt_requested',
      'run_completed',
      'turn_completed',
      'turn_submitted',
      'run_started',
    ]);
    const replayed = replayBuilderConversation(resumed.events);
    assert.equal(replayed.turns[0].outcome, 'interrupted');
    assert.equal(replayed.turns[1].status, 'active');
  } finally {
    if (restartedDatabase !== null) restartedDatabase.close();
    try { item.database.close(); } catch { /* already closed during restart check */ }
    removeRoot(item.root);
  }
});

test('records fixed failed, cancelled, and timeout-interrupted terminal outcomes', () => {
  const cases = [
    ['builder_generation_failed', 'failed', 4],
    ['builder_generation_cancelled', 'cancelled', 5],
    ['builder_generation_timeout', 'interrupted', 5],
  ];
  for (const [failureCode, outcome, expectedSequence] of cases) {
    const item = fixture();
    try {
      const context = begin(item.service);
      const terminal = item.service.complete_failure({
        context,
        failure_code: failureCode,
      });
      assert.equal(terminal.head.sequence, expectedSequence);
      assert.equal(terminal.snapshot.turns[0].outcome, outcome);
      assert.equal(
        terminal.snapshot.turns[0].runs[0].terminal_status,
        outcome,
      );
      assert.doesNotMatch(JSON.stringify(terminal), /provider\.example|credential|api[_-]?key/iu);
    } finally {
      item.close();
    }
  }
});

test('records a deliberate retry as a second run on the same active turn', () => {
  const item = fixture();
  let restartedDatabase = null;
  try {
    const first = begin(item.service);
    const retry = item.service.retry_after_failure({
      context: first,
      failure_code: 'builder_generation_failed',
    });
    assert.equal(retry.attempt_number, 2);
    assert.equal(retry.ids.turn_id, first.ids.turn_id);
    assert.equal(retry.ids.task_id, first.ids.task_id);
    assert.notEqual(retry.ids.run_id, first.ids.run_id);
    assert.equal(retry.start_head.sequence, 4);
    assert.deepEqual(retry.events.map((event) => event.event_type), [
      'turn_submitted',
      'run_started',
      'run_completed',
      'run_started',
    ]);

    const pending = item.service.read_stream({ project_id: PROJECT_ID });
    assert.equal(pending.conversation.head_sequence, 4);
    assert.equal(pending.conversation.recorded_active_turn_id, first.ids.turn_id);
    assert.deepEqual(pending.conversation.items[3], {
      item_kind: 'run_started',
      sequence: 4,
      turn_id: first.ids.turn_id,
      run_id: retry.ids.run_id,
      task_id: first.ids.task_id,
      attempt_number: 2,
      retry_of_run_id: first.ids.run_id,
      recorded_state: 'started',
    });
    assert.doesNotMatch(JSON.stringify(pending), /provider|credential|git_candidate_receipt|commit_oid|tree_oid|live|running/iu);

    const terminal = item.service.complete_candidate({
      context: retry,
      candidate_result: candidateResult(retry),
      assistant_text: 'The retry prepared a timer draft.',
    });
    assert.equal(terminal.head.sequence, 6);
    assert.equal(terminal.snapshot.active_turn_id, null);
    assert.equal(terminal.snapshot.turns.length, 1);
    assert.deepEqual(terminal.snapshot.turns[0].runs.map((run) => ({
      attempt_number: run.attempt_number,
      retry_of_run_id: run.retry_of_run_id,
      run_id: run.run_id,
      terminal_status: run.terminal_status,
    })), [
      {
        attempt_number: 1,
        retry_of_run_id: null,
        run_id: first.ids.run_id,
        terminal_status: 'failed',
      },
      {
        attempt_number: 2,
        retry_of_run_id: first.ids.run_id,
        run_id: retry.ids.run_id,
        terminal_status: 'succeeded',
      },
    ]);
    assert.equal(terminal.snapshot.turns[0].outcome, 'candidate_ready');
    const completedStream = item.service.read_stream({ project_id: PROJECT_ID });
    assert.equal(completedStream.conversation.head_sequence, 6);
    assert.equal(completedStream.conversation.recorded_active_turn_id, null);
    assert.equal(completedStream.conversation.items[4].result_kind, 'candidate');

    item.database.close();
    restartedDatabase = createBuilderProductMetadataDatabase(
      path.join(item.root, 'builder.sqlite'),
    );
    const restartedService = createBuilderConversationMainService({
      metadataAuthority: restartedDatabase,
      createUuid: uuidFactory(950),
      nowMs: () => 9_500,
    });
    assert.deepEqual(restartedService.read_stream({ project_id: PROJECT_ID }), completedStream);
  } finally {
    if (restartedDatabase !== null) restartedDatabase.close();
    try { item.database.close(); } catch { /* already closed during restart check */ }
    removeRoot(item.root);
  }
});

test('records a retryable failed run without completing the turn before deliberate retry', () => {
  const item = fixture();
  let restartedDatabase = null;
  try {
    const first = begin(item.service);
    const failed = item.service.record_retryable_failure({
      context: first,
      failure_code: 'builder_generation_failed',
    });
    assert.equal(failed.attempt_number, 1);
    assert.equal(failed.run_terminal_failure_code, 'builder_generation_failed');
    assert.equal(failed.ids.run_id, first.ids.run_id);
    assert.equal(failed.start_head.sequence, 3);
    assert.deepEqual(failed.events.map((event) => event.event_type), [
      'turn_submitted',
      'run_started',
      'run_completed',
    ]);

    const failedStream = item.service.read_stream({ project_id: PROJECT_ID });
    assert.equal(failedStream.conversation.head_sequence, 3);
    assert.equal(failedStream.conversation.recorded_active_turn_id, first.ids.turn_id);
    assert.deepEqual(failedStream.conversation.items[2], {
      item_kind: 'run_completed',
      sequence: 3,
      turn_id: first.ids.turn_id,
      run_id: first.ids.run_id,
      terminal_status: 'failed',
      result_kind: 'failure',
      assistant_message: {
        message_id: first.ids.assistant_message_id,
        text: 'The draft could not be made.',
      },
      candidate: null,
    });
    assert.throws(() => item.service.record_retryable_failure({
      context: failed,
      failure_code: 'builder_generation_failed',
    }), { code: 'builder_conversation_main_service_unavailable' });

    const retry = item.service.retry_after_failure({
      context: failed,
      failure_code: 'builder_generation_failed',
    });
    assert.equal(retry.attempt_number, 2);
    assert.equal(retry.run_terminal_failure_code, null);
    assert.equal(retry.ids.turn_id, first.ids.turn_id);
    assert.equal(retry.ids.task_id, first.ids.task_id);
    assert.equal(retry.start_head.sequence, 4);
    assert.deepEqual(retry.events.map((event) => event.event_type), [
      'turn_submitted',
      'run_started',
      'run_completed',
      'run_started',
    ]);

    const pendingRetry = item.service.read_stream({ project_id: PROJECT_ID });
    assert.equal(pendingRetry.conversation.head_sequence, 4);
    assert.equal(pendingRetry.conversation.recorded_active_turn_id, first.ids.turn_id);
    assert.deepEqual(pendingRetry.conversation.items[3], {
      item_kind: 'run_started',
      sequence: 4,
      turn_id: first.ids.turn_id,
      run_id: retry.ids.run_id,
      task_id: first.ids.task_id,
      attempt_number: 2,
      retry_of_run_id: first.ids.run_id,
      recorded_state: 'started',
    });

    const terminal = item.service.complete_candidate({
      context: retry,
      candidate_result: candidateResult(retry),
      assistant_text: 'The retry prepared a timer draft.',
    });
    assert.equal(terminal.head.sequence, 6);
    const completedStream = item.service.read_stream({ project_id: PROJECT_ID });
    assert.equal(completedStream.conversation.head_sequence, 6);
    assert.equal(completedStream.conversation.recorded_active_turn_id, null);
    assert.equal(completedStream.conversation.items[4].result_kind, 'candidate');
    assert.doesNotMatch(JSON.stringify(completedStream), /provider|credential|git_candidate_receipt|commit_oid|tree_oid|live|running/iu);

    item.database.close();
    restartedDatabase = createBuilderProductMetadataDatabase(
      path.join(item.root, 'builder.sqlite'),
    );
    const restartedService = createBuilderConversationMainService({
      metadataAuthority: restartedDatabase,
      createUuid: uuidFactory(975),
      nowMs: () => 9_750,
    });
    assert.deepEqual(restartedService.read_stream({ project_id: PROJECT_ID }), completedStream);
  } finally {
    if (restartedDatabase !== null) restartedDatabase.close();
    try { item.database.close(); } catch { /* already closed during restart check */ }
    removeRoot(item.root);
  }
});

test('closes a retryable failed turn before starting a distinct new turn', () => {
  const item = fixture();
  try {
    const first = begin(item.service);
    item.service.record_retryable_failure({
      context: first,
      failure_code: 'builder_generation_failed',
    });
    const failedStream = item.service.read_stream({ project_id: PROJECT_ID });
    assert.equal(failedStream.conversation.head_sequence, 3);
    assert.equal(failedStream.conversation.recorded_active_turn_id, first.ids.turn_id);

    const second = begin(item.service, null, 'Try a different timer layout');
    assert.equal(second.start_head.sequence, 6);
    assert.notEqual(second.ids.turn_id, first.ids.turn_id);
    assert.notEqual(second.ids.run_id, first.ids.run_id);
    assert.deepEqual(second.events.map((event) => event.event_type), [
      'turn_submitted',
      'run_started',
      'run_completed',
      'turn_completed',
      'turn_submitted',
      'run_started',
    ]);

    const stream = item.service.read_stream({ project_id: PROJECT_ID });
    assert.equal(stream.conversation.head_sequence, 6);
    assert.equal(stream.conversation.recorded_active_turn_id, second.ids.turn_id);
    assert.deepEqual(stream.conversation.items[3], {
      item_kind: 'turn_completed',
      sequence: 4,
      turn_id: first.ids.turn_id,
      run_id: first.ids.run_id,
      outcome: 'failed',
    });
    assert.deepEqual(stream.conversation.items[4], {
      item_kind: 'user_message',
      sequence: 5,
      turn_id: second.ids.turn_id,
      message: {
        message_id: second.ids.message_id,
        text: 'Try a different timer layout',
      },
      message_kind: 'submitted',
      mode: 'work',
      task: {
        task_id: second.ids.task_id,
        title: 'Create Builder project',
      },
    });
    assert.doesNotMatch(JSON.stringify(stream), /provider|credential|git_candidate_receipt|commit_oid|tree_oid|live|running/iu);
  } finally {
    item.close();
  }
});

test('rejects forged contexts and stays isolated from provider, IPC, renderer, and Git authority', () => {
  const item = fixture();
  try {
    const work = begin(item.service);
    const question = beginQuestion(item.service, BASE_REVISION);
    assert.throws(() => item.service.complete_candidate({
      context: Object.freeze({}),
      candidate_result: candidateResult(work),
      assistant_text: 'Ready.',
    }), { code: 'builder_conversation_main_service_unavailable' });
    assert.throws(() => item.service.complete_candidate({
      context: question,
      candidate_result: candidateResult(work),
      assistant_text: 'Ready.',
    }), { code: 'builder_conversation_main_service_unavailable' });
    assert.throws(() => item.service.complete_explanation({
      context: work,
      assistant_text: 'This is an answer.',
    }), { code: 'builder_conversation_main_service_unavailable' });
    assert.throws(() => item.service.retry_after_failure({
      context: Object.freeze({}),
      failure_code: 'builder_generation_failed',
    }), { code: 'builder_conversation_main_service_unavailable' });
    assert.throws(() => item.service.record_retryable_failure({
      context: Object.freeze({}),
      failure_code: 'builder_generation_failed',
    }), { code: 'builder_conversation_main_service_unavailable' });
  } finally {
    item.close();
  }

  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-conversation-main-service.cjs'),
    'utf8',
  );
  assert.doesNotMatch(
    source,
    /BrowserWindow|ipcMain|ipcRenderer|preload|fetch\(|openai|deepseek|safeStorage|persist_candidate_commit|builder-git-project-repository/iu,
  );
});
