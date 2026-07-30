'use strict';

const assert = require('node:assert/strict');
const nodeCrypto = require('node:crypto');
const test = require('node:test');

const {
  CONVERSATION_EVENT_VERSION,
  CONVERSATION_EVENT_KIND,
  CONVERSATION_AUTHORITY,
  MAX_EVENT_RECORD_BYTES,
  BuilderConversationRecordError,
  createBuilderConversationPlanAdmission,
  createBuilderConversationEvent,
  sanitizeBuilderConversationEvent,
  serializeBuilderConversationEvent,
} = require('../electron/builder-conversation-records.cjs');
const {
  BUILDER_PERMISSION_DECISION_VERSION,
  BUILDER_PERMISSION_POLICY_VERSION,
} = require('../electron/builder-permission-authority-contract.cjs');
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
  createBuilderToolDispatchAdmission,
} = require('../electron/builder-tool-dispatch-admission.cjs');
const {
  FILESYSTEM_READ_TOOL_ADAPTER_ID,
  createBuilderToolAdapterSelectionAdmission,
} = require('../electron/builder-tool-adapter-selection-admission.cjs');
const {
  FILESYSTEM_READ_TOOL_RUNTIME_ID,
  createBuilderToolRuntimeInvocationAdmission,
} = require('../electron/builder-tool-runtime-invocation-admission.cjs');
const {
  createBuilderToolResultRecord,
} = require('../electron/builder-tool-result-records.cjs');

const PROJECT_ID = 'builder-project:11111111-1111-4111-8111-111111111111';
const CONVERSATION_ID = 'builder-conversation:11111111-1111-4111-8111-111111111111';
const DIGEST_A = `sha256:${'a'.repeat(64)}`;
const COMMIT_OID = 'b'.repeat(40);
const PERMISSION_ID = `builder-permission:${'a'.repeat(64)}`;
const BASE_REVISION = Object.freeze({
  revision_receipt_digest: DIGEST_A,
  commit_oid: COMMIT_OID,
});

function uuid(index) { return `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`; }
function typedId(kind, index) { return `builder-${kind}:${uuid(index)}`; }

function routeDecision(payload, index = 1, overrides = {}) {
  const taskId = payload.task === null ? null : payload.task.task_id;
  const route = payload.mode === 'work' ? 'build' : 'answer';
  return {
    decision_id: typedId('route-decision', index),
    decision_version: 'builder-composer-route-decision.v1',
    project_id: PROJECT_ID,
    message_id: payload.message.message_id,
    task_id: taskId,
    route,
    confidence: 'high',
    matched_signals: [payload.mode === 'work' ? 'clear_build' : 'read_only'],
    downgraded_from: null,
    downgrade_reason: null,
    required_permissions: route === 'build' ? ['write_project'] : [],
    permission_result: route === 'build' ? 'allowed' : 'not_required',
    dispatch: route === 'build' ? 'build' : 'reply',
    decided_at_ms: index,
    ...overrides,
  };
}

function payloadWithRouteDecision(type, payload, index) {
  const normalized = type === 'run_completed'
    ? { ...payload, plan_admission: payload.plan_admission ?? null }
    : payload;
  if (type !== 'turn_submitted') return normalized;
  return {
    ...normalized,
    route_decision: Object.hasOwn(normalized, 'route_decision')
      ? normalized.route_decision
      : routeDecision(normalized, index),
  };
}

function create(type, payload, previous = null, index = 1) {
  const normalizedPayload = payloadWithRouteDecision(type, payload, index);
  return createBuilderConversationEvent({
    record_version: CONVERSATION_EVENT_VERSION,
    record_kind: CONVERSATION_EVENT_KIND,
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    sequence: previous === null ? 1 : previous.sequence + 1,
    command_id: typedId('command', index),
    event_type: type,
    previous_event: previous === null ? null : {
      sequence: previous.sequence,
      event_id: previous.event_id,
      event_digest: previous.event_digest,
    },
    payload: normalizedPayload,
    authority: { ...CONVERSATION_AUTHORITY },
  });
}

async function toolCallRecord({
  turnId = typedId('turn', 1),
  taskId = typedId('task', 1),
  runId = typedId('run', 1),
  toolCallId = typedId('tool-call', 1),
  stepId = typedId('run-step', 1),
} = {}) {
  const sessionPolicy = createBuilderToolSessionPolicy({
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    turn_id: turnId,
    task_id: taskId,
    run_id: runId,
    issued_at_ms: 49,
    limits: { ...DEFAULT_BUILDER_TOOL_SESSION_LIMITS },
  });
  const guard = createBuilderToolPermissionAdmission({
    actor_id: typedId('user', 1),
    now_ms: () => 50,
    evaluate_permission: async (body) => ({
      decision_version: BUILDER_PERMISSION_DECISION_VERSION,
      policy_version: BUILDER_PERMISSION_POLICY_VERSION,
      actor_id: typedId('user', 1),
      action: body.action,
      resource: body.resource,
      evaluated_at_ms: body.now_ms,
      decision: 'allowed',
      reason: 'matching_active_grant',
      permission_id: PERMISSION_ID,
      permission_authority: 'builder_permission_facts_deny_by_default_v1',
      ui_selection_authority: 'not_permission',
    }),
  });
  const admission = await guard.admit({
    tool_call_id: toolCallId,
    tool_name: 'filesystem.read',
    project_id: PROJECT_ID,
    action: 'filesystem.read',
    resource: {
      resource_kind: 'filesystem',
      project_id: PROJECT_ID,
      resource_id: 'project:/src/app.tsx',
    },
  });
  return createBuilderToolCallRecord({
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    turn_id: turnId,
    task_id: taskId,
    run_id: runId,
    step_id: stepId,
    session_policy: sessionPolicy,
    admission,
    requested_at_ms: 51,
  });
}

function toolResultRecord(record, overrides = {}) {
  const {
    runtime_invocation_admission: runtime = toolRuntimeAdmission(record),
    ...rest
  } = overrides;
  return createBuilderToolResultRecord({
    runtime_invocation_admission: runtime,
    tool_call_record: record,
    observed_at_ms: 60,
    result: {
      status: 'failed',
      summary_code: 'output_rejected',
    },
    ...rest,
  });
}

function existingToolCall(record) {
  return {
    step_id: record.step_id,
    tool_call_id: record.tool_call_id,
    tool_call_record: record,
    tool_result_record: null,
  };
}

function eventHeadDigest(event) {
  return `sha256:${nodeCrypto.createHash('sha256').update(JSON.stringify({
    event_digest: event.event_digest,
    event_id: event.event_id,
    sequence: event.sequence,
  }), 'utf8').digest('hex')}`;
}

function planAdmission(previous, callRecord, resultRecord, resultDigest = DIGEST_A, overrides = {}) {
  return createBuilderConversationPlanAdmission({
    admission_version: 'builder-conversation-plan-admission.v1',
    admission_kind: 'builder_conversation_plan_admission',
    admission_authority: 'trusted_conversation_main_service_complete_plan_v1',
    project_id: callRecord.project_id,
    conversation_id: callRecord.conversation_id,
    turn_id: callRecord.turn_id,
    task_id: callRecord.task_id,
    run_id: callRecord.run_id,
    attempt_number: 1,
    plan_record_digest: resultDigest,
    source_context_result_version: 'builder-tool-source-context-result.v1',
    collector_authority: 'main_tool_source_context_collector_v1',
    context_digest: `sha256:${'c'.repeat(64)}`,
    context_status: 'succeeded',
    file_count: 1,
    total_content_bytes: 32,
    head_sequence: previous.sequence,
    head_digest: eventHeadDigest(previous),
    tool_reads: [{
      resource_id: callRecord.resource.resource_id,
      tool_call_id: callRecord.tool_call_id,
      tool_call_record_digest: callRecord.record_digest,
      tool_result_record_digest: resultRecord.record_digest,
      result_summary_digest: resultRecord.result.summary_digest,
      result_status: 'succeeded',
    }],
    ...overrides,
  });
}

function toolRuntimeAdmission(record) {
  const dispatch = createBuilderToolDispatchAdmission({
    project_id: record.project_id,
    conversation_id: record.conversation_id,
    turn_id: record.turn_id,
    task_id: record.task_id,
    run_id: record.run_id,
    run_status: 'running',
    interrupt_requested: false,
    cancel_requested: false,
    existing_tool_calls: [existingToolCall(record)],
    tool_call_record: record,
    dispatch_request_id: typedId('tool-dispatch-request', 7),
    admitted_at_ms: record.requested_at_ms,
  });
  const selection = createBuilderToolAdapterSelectionAdmission({
    dispatch_admission: dispatch,
    tool_call_record: record,
    adapter_id: FILESYSTEM_READ_TOOL_ADAPTER_ID,
    adapter_selection_id: typedId('tool-adapter-selection', 8),
    selected_at_ms: dispatch.admitted_at_ms,
  });
  return createBuilderToolRuntimeInvocationAdmission({
    adapter_selection_admission: selection,
    tool_call_record: record,
    runtime_id: FILESYSTEM_READ_TOOL_RUNTIME_ID,
    runtime_invocation_id: typedId('tool-runtime-invocation', 9),
    runtime_admitted_at_ms: selection.selected_at_ms,
  });
}

function assertRecordError(expected = 'builder_conversation_record_invalid') {
  return (error) => {
    assert.equal(error instanceof BuilderConversationRecordError, true);
    assert.equal(error.code, expected);
    assert.equal(error.message, 'The local conversation event could not be verified.');
    return true;
  };
}

test('creates deterministic project-bound command and event evidence with canonical bytes', () => {
  const event = create('turn_submitted', {
    message: { message_id: typedId('message', 1), text: 'Build a quiet focus timer.' },
    turn_id: typedId('turn', 1),
    mode: 'work',
    task: { task_id: typedId('task', 1), title: 'Create focus timer' },
    base_revision: BASE_REVISION,
  });
  const repeated = create('turn_submitted', {
    message: { message_id: typedId('message', 1), text: 'Build a quiet focus timer.' },
    turn_id: typedId('turn', 1),
    mode: 'work',
    task: { task_id: typedId('task', 1), title: 'Create focus timer' },
    base_revision: BASE_REVISION,
  });

  assert.deepEqual(event, repeated);
  assert.equal(event.record_version, 'builder-conversation-event.v2');
  assert.match(event.command_digest, /^sha256:[0-9a-f]{64}$/u);
  assert.match(event.event_digest, /^sha256:[0-9a-f]{64}$/u);
  assert.match(event.event_id, /^builder-conversation-event:[0-9a-f]{64}$/u);
  assert.equal(event.conversation_id, CONVERSATION_ID);
  assert.deepEqual(event.payload.route_decision, {
    decision_id: typedId('route-decision', 1),
    decision_version: 'builder-composer-route-decision.v1',
    project_id: PROJECT_ID,
    message_id: typedId('message', 1),
    task_id: typedId('task', 1),
    route: 'build',
    confidence: 'high',
    matched_signals: ['clear_build'],
    downgraded_from: null,
    downgrade_reason: null,
    required_permissions: ['write_project'],
    permission_result: 'allowed',
    dispatch: 'build',
    decided_at_ms: 1,
  });
  assert.equal(Object.isFrozen(event), true);
  assert.equal(Object.isFrozen(event.payload.base_revision), true);
  assert.equal(sanitizeBuilderConversationEvent(structuredClone(event)).event_digest, event.event_digest);
  const serialized = serializeBuilderConversationEvent(event);
  assert.equal(serialized.endsWith('\n'), true);
  assert.equal(Buffer.byteLength(serialized, 'utf8') <= MAX_EVENT_RECORD_BYTES, true);
  assert.equal(serializeBuilderConversationEvent(JSON.parse(serialized)), serialized);
});

test('supports command payloads with exact run attempt and terminal result evidence', () => {
  const submitted = create('turn_submitted', {
    message: { message_id: typedId('message', 1), text: 'Explain this project.' },
    turn_id: typedId('turn', 1), mode: 'question', task: null, base_revision: null,
  }, null, 1);
  const started = create('run_started', {
    turn_id: typedId('turn', 1), run_id: typedId('run', 1), task_id: null,
    attempt_number: 1, retry_of_run_id: null, input_digest: DIGEST_A,
  }, submitted, 2);
  const completed = create('run_completed', {
    turn_id: typedId('turn', 1), run_id: typedId('run', 1), terminal_status: 'succeeded',
    result_kind: 'explanation', result_digest: DIGEST_A,
    assistant_message: { message_id: typedId('message', 2), text: 'This project is local.' },
    candidate_result: null,
  }, started, 3);
  const terminal = create('turn_completed', {
    turn_id: typedId('turn', 1), run_id: typedId('run', 1), outcome: 'answered',
  }, completed, 4);

  assert.equal(started.payload.attempt_number, 1);
  assert.equal(started.payload.retry_of_run_id, null);
  assert.equal(started.payload.input_digest, DIGEST_A);
  assert.equal(completed.payload.result_digest, DIGEST_A);
  assert.equal(completed.payload.result_kind, 'explanation');
  assert.deepEqual(Object.keys(terminal.payload).sort(), ['outcome', 'run_id', 'turn_id']);
});

test('supports durable task brief updates without source or execution authority', () => {
  const submitted = create('turn_submitted', {
    message: { message_id: typedId('message', 1), text: '我想先聊一下这个作品集首页怎么做。' },
    turn_id: typedId('turn', 1),
    mode: 'question',
    task: null,
    base_revision: null,
    route_decision: routeDecision({
      message: { message_id: typedId('message', 1), text: '我想先聊一下这个作品集首页怎么做。' },
      mode: 'question',
      task: null,
    }, 1, {
      route: 'update_brief',
      confidence: 'medium',
      matched_signals: ['exploratory_work'],
      dispatch: 'brief_update',
    }),
  }, null, 1);
  const started = create('run_started', {
    turn_id: typedId('turn', 1),
    run_id: typedId('run', 1),
    task_id: null,
    attempt_number: 1,
    retry_of_run_id: null,
    input_digest: DIGEST_A,
  }, submitted, 2);
  const completed = create('run_completed', {
    turn_id: typedId('turn', 1),
    run_id: typedId('run', 1),
    terminal_status: 'succeeded',
    result_kind: 'explanation',
    result_digest: DIGEST_A,
    assistant_message: {
      message_id: typedId('message', 2),
      text: '可以先做一个带星空 hero、项目卡片和联系入口的单页作品集。',
    },
    candidate_result: null,
  }, started, 3);
  const brief = create('task_brief_updated', {
    turn_id: typedId('turn', 1),
    run_id: typedId('run', 1),
    message_id: typedId('message', 1),
    task_capsule: {
      capsule_version: 'builder-task-capsule.v1',
      task_id: typedId('task', 2),
      project_id: PROJECT_ID,
      title: 'Current project brief',
      goal: '我想先聊一下这个作品集首页怎么做。',
      status: 'ready',
      current_brief: {
        brief_version: 'builder-working-brief.v1',
        source: 'task_capsule_update',
        latest_user_goal: '我想先聊一下这个作品集首页怎么做。',
        assistant_proposal: '可以先做一个带星空 hero、项目卡片和联系入口的单页作品集。',
        approved_plan: null,
        use_when_instruction_is_contextual: true,
      },
      last_route_decision_id: submitted.payload.route_decision.decision_id,
      updated_at_ms: 4,
    },
  }, completed, 4);

  assert.equal(brief.payload.task_capsule.status, 'ready');
  assert.equal(brief.payload.task_capsule.current_brief.use_when_instruction_is_contextual, true);
  assert.doesNotMatch(
    JSON.stringify(brief),
    /candidate_digest|git_candidate_receipt|commit_oid|tree_oid|revision_receipt|save_admission|provider|credential|source_tree/iu,
  );
  assert.throws(() => create('task_brief_updated', {
    ...brief.payload,
    task_capsule: {
      ...brief.payload.task_capsule,
      current_brief: {
        ...brief.payload.task_capsule.current_brief,
        latest_user_goal: 'Read C:/secret/project.txt before doing it.',
      },
    },
  }, completed, 5), assertRecordError());
});

test('supports fixed run progress payloads without provider or source authority', () => {
  const submitted = create('turn_submitted', {
    message: { message_id: typedId('message', 1), text: 'Build a quiet timer.' },
    turn_id: typedId('turn', 1),
    mode: 'work',
    task: { task_id: typedId('task', 1), title: 'Create focus timer' },
    base_revision: null,
  }, null, 1);
  const started = create('run_started', {
    turn_id: typedId('turn', 1),
    run_id: typedId('run', 1),
    task_id: typedId('task', 1),
    attempt_number: 1,
    retry_of_run_id: null,
    input_digest: DIGEST_A,
  }, submitted, 2);
  const progress = create('run_progress_recorded', {
    turn_id: typedId('turn', 1),
    run_id: typedId('run', 1),
    stage: 'context_ready',
  }, started, 3);

  assert.deepEqual(Object.keys(progress.payload).sort(), ['run_id', 'stage', 'turn_id']);
  assert.equal(progress.payload.stage, 'context_ready');
  assert.doesNotMatch(
    JSON.stringify(progress),
    /provider|credential|secret|source_tree|git_|receipt|prompt|token|Authorization|Bearer/iu,
  );
  assert.throws(() => create('run_progress_recorded', {
    turn_id: typedId('turn', 1),
    run_id: typedId('run', 1),
    stage: 'token_delta',
  }, started, 4), assertRecordError());
});

test('supports pre-dispatch tool call request payloads without execution result authority', async () => {
  const submitted = create('turn_submitted', {
    message: { message_id: typedId('message', 1), text: 'Read the project files.' },
    turn_id: typedId('turn', 1),
    mode: 'work',
    task: { task_id: typedId('task', 1), title: 'Inspect project files' },
    base_revision: BASE_REVISION,
  }, null, 1);
  const started = create('run_started', {
    turn_id: typedId('turn', 1),
    run_id: typedId('run', 1),
    task_id: typedId('task', 1),
    attempt_number: 1,
    retry_of_run_id: null,
    input_digest: DIGEST_A,
  }, submitted, 2);
  const record = await toolCallRecord();
  const requested = create('tool_call_requested', {
    tool_call_record: record,
  }, started, 3);

  assert.equal(requested.payload.tool_call_record.record_digest, record.record_digest);
  assert.equal(requested.payload.tool_call_record.lifecycle.dispatch_admission, 'not_started');
  assert.equal(requested.payload.tool_call_record.lifecycle.execution_admission, 'not_performed');
  assert.equal(Object.isFrozen(requested.payload.tool_call_record), true);
  assert.doesNotMatch(
    JSON.stringify(requested),
    /stdout|stderr|exit_code|result_bytes|source_tree|git_candidate_receipt|commit_oid|tree_oid|provider_secret|credential_value|Authorization|Bearer/iu,
  );

  assert.throws(() => create('tool_call_requested', {
    tool_call_record: {
      ...record,
      project_id: 'builder-project:123e4567-e89b-42d3-a456-426614174099',
    },
  }, started, 4), assertRecordError());
});

test('supports fixed-code tool result payloads without raw output or revision authority', async () => {
  const submitted = create('turn_submitted', {
    message: { message_id: typedId('message', 1), text: 'Read the project files.' },
    turn_id: typedId('turn', 1),
    mode: 'work',
    task: { task_id: typedId('task', 1), title: 'Inspect project files' },
    base_revision: BASE_REVISION,
  }, null, 1);
  const started = create('run_started', {
    turn_id: typedId('turn', 1),
    run_id: typedId('run', 1),
    task_id: typedId('task', 1),
    attempt_number: 1,
    retry_of_run_id: null,
    input_digest: DIGEST_A,
  }, submitted, 2);
  const callRecord = await toolCallRecord();
  const requested = create('tool_call_requested', {
    tool_call_record: callRecord,
  }, started, 3);
  const resultRecord = toolResultRecord(callRecord);
  const result = create('tool_call_result_recorded', {
    tool_result_record: resultRecord,
  }, requested, 4);

  assert.equal(result.payload.tool_result_record.record_digest, resultRecord.record_digest);
  assert.deepEqual(result.payload.tool_result_record.result, {
    status: 'failed',
    summary_code: 'output_rejected',
    display_summary: 'The tool output was not accepted.',
    summary_digest: resultRecord.result.summary_digest,
  });
  assert.equal(result.payload.tool_result_record.lifecycle.result_admission, 'fixed_summary_code_recorded');
  assert.equal(result.payload.tool_result_record.lifecycle.raw_output_admission, 'not_included');
  assert.equal(result.payload.tool_result_record.lifecycle.revision_admission, 'not_created');
  assert.doesNotMatch(
    JSON.stringify(result),
    /stdout|stderr|output_digest|exit_code|result_bytes|source_tree|git_candidate_receipt|commit_oid|tree_oid|provider_secret|credential_value|Authorization|Bearer/iu,
  );

  assert.throws(() => create('tool_call_result_recorded', {
    tool_result_record: {
      ...resultRecord,
      project_id: 'builder-project:123e4567-e89b-42d3-a456-426614174099',
    },
  }, requested, 5), assertRecordError());
  assert.throws(() => create('tool_call_result_recorded', {
    tool_result_record: {
      ...resultRecord,
      result: {
        ...resultRecord.result,
        display_summary: 'Raw output follows.',
      },
    },
  }, requested, 6), assertRecordError());
});

test('binds plan terminal events to prior-head admission and tool result evidence', async () => {
  const submitted = create('turn_submitted', {
    message: { message_id: typedId('message', 1), text: 'Inspect and plan the project.' },
    turn_id: typedId('turn', 1),
    mode: 'work',
    task: { task_id: typedId('task', 1), title: 'Plan project update' },
    base_revision: BASE_REVISION,
  }, null, 1);
  const started = create('run_started', {
    turn_id: typedId('turn', 1),
    run_id: typedId('run', 1),
    task_id: typedId('task', 1),
    attempt_number: 1,
    retry_of_run_id: null,
    input_digest: DIGEST_A,
  }, submitted, 2);
  const callRecord = await toolCallRecord();
  const requested = create('tool_call_requested', { tool_call_record: callRecord }, started, 3);
  const resultRecord = toolResultRecord(callRecord, {
    result: {
      status: 'succeeded',
      summary_code: 'completed_without_raw_output',
    },
  });
  const recorded = create('tool_call_result_recorded', {
    tool_result_record: resultRecord,
  }, requested, 4);
  const admission = planAdmission(recorded, callRecord, resultRecord);
  const completed = create('run_completed', {
    turn_id: typedId('turn', 1),
    run_id: typedId('run', 1),
    terminal_status: 'succeeded',
    result_kind: 'plan',
    result_digest: DIGEST_A,
    assistant_message: { message_id: typedId('message', 2), text: 'Here is the proposed plan.' },
    candidate_result: null,
    plan_admission: admission,
  }, recorded, 5);

  assert.equal(completed.payload.plan_admission.plan_record_digest, DIGEST_A);
  assert.equal(completed.payload.plan_admission.head_sequence, recorded.sequence);
  assert.match(completed.payload.plan_admission.admission_digest, /^sha256:[0-9a-f]{64}$/u);
  assert.doesNotMatch(
    JSON.stringify(completed),
    /export const|private_source_context|content_digest|source_tree_digest|provider_secret|credential_value|commit_oid|tree_oid/iu,
  );
  assert.throws(() => create('run_completed', {
    turn_id: typedId('turn', 1),
    run_id: typedId('run', 1),
    terminal_status: 'succeeded',
    result_kind: 'plan',
    result_digest: DIGEST_A,
    assistant_message: { message_id: typedId('message', 2), text: 'Here is the proposed plan.' },
    candidate_result: null,
    plan_admission: planAdmission(started, callRecord, resultRecord),
  }, recorded, 6), assertRecordError());
  assert.throws(() => create('run_completed', {
    turn_id: typedId('turn', 1),
    run_id: typedId('run', 1),
    terminal_status: 'succeeded',
    result_kind: 'plan',
    result_digest: DIGEST_A,
    assistant_message: { message_id: typedId('message', 2), text: 'Here is the proposed plan.' },
    candidate_result: null,
  }, recorded, 7), assertRecordError());
});

test('supports actor-bound plan review payloads without source or execution evidence', () => {
  const submitted = create('turn_submitted', {
    message: { message_id: typedId('message', 1), text: 'Plan a local timer.' },
    turn_id: typedId('turn', 1),
    mode: 'work',
    task: { task_id: typedId('task', 1), title: 'Plan timer' },
    base_revision: null,
  }, null, 1);
  const reviewed = create('plan_reviewed', {
    turn_id: typedId('turn', 1),
    run_id: typedId('run', 1),
    plan_result_digest: DIGEST_A,
    review_id: typedId('review', 1),
    reviewer_id: typedId('user', 1),
    reviewed_at_ms: 1234,
    decision: 'approved',
  }, submitted, 2);

  assert.equal(reviewed.payload.decision, 'approved');
  assert.equal(reviewed.payload.plan_result_digest, DIGEST_A);
  assert.equal(reviewed.payload.review_id, typedId('review', 1));
  assert.equal(reviewed.payload.reviewer_id, typedId('user', 1));
  assert.equal(Object.isFrozen(reviewed.payload), true);
  assert.doesNotMatch(
    JSON.stringify(reviewed),
    /source_tree|plan_body|git_candidate_receipt|commit_oid|tree_oid|credential|provider|ipcMain|ipcRenderer/iu,
  );

  for (const drift of [
    { ...reviewed, payload: { ...reviewed.payload, decision: 'accepted' } },
    { ...reviewed, payload: { ...reviewed.payload, plan_result_digest: 'not-a-digest' } },
    { ...reviewed, payload: { ...reviewed.payload, review_id: typedId('run', 1) } },
    { ...reviewed, payload: { ...reviewed.payload, reviewer_id: typedId('message', 1) } },
    { ...reviewed, payload: { ...reviewed.payload, reviewed_at_ms: -1 } },
    { ...reviewed, payload: { ...reviewed.payload, source_tree_digest: DIGEST_A } },
  ]) {
    assert.throws(() => sanitizeBuilderConversationEvent(drift), assertRecordError());
  }
});

test('supports actor-bound candidate rejection payloads without source or Git evidence', () => {
  const submitted = create('turn_submitted', {
    message: { message_id: typedId('message', 1), text: 'Build a local timer.' },
    turn_id: typedId('turn', 1),
    mode: 'work',
    task: { task_id: typedId('task', 1), title: 'Create timer' },
    base_revision: null,
  }, null, 1);
  const rejected = create('candidate_rejected', {
    turn_id: typedId('turn', 1),
    run_id: typedId('run', 1),
    draft_id: `builder-generation-draft:${'1'.repeat(64)}`,
    review_id: typedId('review', 1),
    reviewer_id: typedId('user', 1),
    reviewed_at_ms: 1234,
    decision: 'rejected',
  }, submitted, 2);

  assert.equal(rejected.payload.decision, 'rejected');
  assert.equal(rejected.payload.review_id, typedId('review', 1));
  assert.equal(rejected.payload.reviewer_id, typedId('user', 1));
  assert.equal(Object.isFrozen(rejected.payload), true);
  assert.doesNotMatch(
    JSON.stringify(rejected),
    /source_tree|git_candidate_receipt|credential|provider/iu,
  );

  for (const drift of [
    { ...rejected, payload: { ...rejected.payload, decision: 'accepted' } },
    { ...rejected, payload: { ...rejected.payload, review_id: typedId('run', 1) } },
    { ...rejected, payload: { ...rejected.payload, reviewer_id: typedId('message', 1) } },
    { ...rejected, payload: { ...rejected.payload, reviewed_at_ms: -1 } },
  ]) {
    assert.throws(() => sanitizeBuilderConversationEvent(drift), assertRecordError());
  }
});

test('supports accepted candidate review payloads with a minimal revision reference', () => {
  const submitted = create('turn_submitted', {
    message: { message_id: typedId('message', 1), text: 'Build a local timer.' },
    turn_id: typedId('turn', 1),
    mode: 'work',
    task: { task_id: typedId('task', 1), title: 'Create timer' },
    base_revision: null,
  }, null, 1);
  const accepted = create('candidate_accepted', {
    turn_id: typedId('turn', 1),
    run_id: typedId('run', 1),
    draft_id: `builder-generation-draft:${'2'.repeat(64)}`,
    review_id: typedId('review', 2),
    reviewer_id: typedId('user', 2),
    reviewed_at_ms: 5678,
    decision: 'accepted',
    revision: {
      revision_receipt_digest: `sha256:${'3'.repeat(64)}`,
      revision_number: 7,
    },
  }, submitted, 2);

  assert.equal(accepted.payload.decision, 'accepted');
  assert.deepEqual(accepted.payload.revision, {
    revision_receipt_digest: `sha256:${'3'.repeat(64)}`,
    revision_number: 7,
  });
  assert.equal(Object.isFrozen(accepted.payload.revision), true);
  assert.doesNotMatch(
    JSON.stringify(accepted),
    /source_tree|git_candidate_receipt|commit_oid|tree_oid|credential|provider/iu,
  );

  for (const drift of [
    { ...accepted, payload: { ...accepted.payload, decision: 'rejected' } },
    { ...accepted, payload: { ...accepted.payload, revision: { ...accepted.payload.revision, revision_number: 0 } } },
    { ...accepted, payload: { ...accepted.payload, revision: { ...accepted.payload.revision, commit_oid: COMMIT_OID } } },
  ]) {
    assert.throws(() => sanitizeBuilderConversationEvent(drift), assertRecordError());
  }
});

test('rejects non-derived conversation/event/command evidence and payload drift', () => {
  const event = create('turn_submitted', {
    message: { message_id: typedId('message', 1), text: 'Build a timer.' },
    turn_id: typedId('turn', 1), mode: 'question', task: null, base_revision: null,
  });
  const payloadWithoutRouteDecision = { ...event.payload };
  delete payloadWithoutRouteDecision.route_decision;
  const cases = [
    { ...event, conversation_id: `builder-conversation:${uuid(99)}` },
    { ...event, record_version: 'builder-conversation-event.v1' },
    { ...event, event_id: `builder-conversation-event:${'f'.repeat(64)}` },
    { ...event, command_digest: DIGEST_A },
    { ...event, event_digest: DIGEST_A },
    { ...event, unexpected: true },
    { ...event, payload: { ...event.payload, base_revision: { revision: 3, revision_digest: DIGEST_A } } },
    { ...event, payload: { ...event.payload, base_revision: { ...BASE_REVISION, revision: 3 } } },
    { ...event, payload: { ...event.payload, base_revision: { ...BASE_REVISION, commit_oid: DIGEST_A } } },
    { ...event, payload: payloadWithoutRouteDecision },
    { ...event, payload: { ...event.payload, route_decision: { ...event.payload.route_decision, project_id: `builder-project:${uuid(99)}` } } },
    { ...event, payload: { ...event.payload, route_decision: { ...event.payload.route_decision, message_id: typedId('message', 2) } } },
    { ...event, payload: { ...event.payload, route_decision: { ...event.payload.route_decision, task_id: typedId('task', 1) } } },
    { ...event, payload: { ...event.payload, route_decision: { ...event.payload.route_decision, route: 'build' } } },
    { ...event, payload: { ...event.payload, route_decision: { ...event.payload.route_decision, matched_signals: ['provider:deepseek'] } } },
    { ...event, payload: { ...event.payload, source: '<html></html>' } },
    { ...event, authority: { ...event.authority, permission_admission: 'granted' } },
  ];
  for (const candidate of cases) {
    assert.throws(() => sanitizeBuilderConversationEvent(candidate), assertRecordError());
  }
});

test('rejects proxies, accessors, symbols, unsafe Unicode, paths, secrets, and oversized text', () => {
  const base = {
    record_version: CONVERSATION_EVENT_VERSION,
    record_kind: CONVERSATION_EVENT_KIND,
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    sequence: 1,
    command_id: typedId('command', 1),
    event_type: 'turn_submitted',
    previous_event: null,
    payload: {
      message: { message_id: typedId('message', 1), text: 'Build a timer.' },
      turn_id: typedId('turn', 1), mode: 'question', task: null, base_revision: null,
    },
    authority: { ...CONVERSATION_AUTHORITY },
  };
  assert.throws(() => createBuilderConversationEvent(new Proxy(base, {})), assertRecordError());
  assert.throws(() => createBuilderConversationEvent({
    ...base, payload: new Proxy(base.payload, {}),
  }), assertRecordError());
  const accessor = { ...base };
  Object.defineProperty(accessor, 'payload', { enumerable: true, get() { return base.payload; } });
  assert.throws(() => createBuilderConversationEvent(accessor), assertRecordError());
  assert.throws(() => createBuilderConversationEvent({ ...base, [Symbol('hidden')]: true }), assertRecordError());

  for (const text of [
    'Open C:\\Users\\Ada\\secret.txt',
    'api_key=sk-abcdefghijklmnop',
    'bad\ud800text',
    `x${'a'.repeat(16 * 1_024)}`,
    'a'.repeat(1_000_000),
  ]) {
    assert.throws(() => createBuilderConversationEvent({
      ...base, payload: { ...base.payload, message: { ...base.payload.message, text } },
    }), assertRecordError());
  }

  const source = require('node:fs').readFileSync(
    require.resolve('../electron/builder-conversation-records.cjs'), 'utf8',
  );
  const safeTextSource = source.slice(
    source.indexOf('function safeText'),
    source.indexOf('function sanitizeMessage'),
  );
  assert.equal(safeTextSource.indexOf('value.length > maximumCodePoints * 2')
    < safeTextSource.indexOf('value.trim()'), true);
  assert.equal(safeTextSource.indexOf('value.length > maximumCodePoints * 2')
    < safeTextSource.indexOf("value.normalize('NFC')"), true);
});

test('keeps fixed errors free of rejected material and imports no product authority', () => {
  const marker = 'sk-should-never-appear-1234567890';
  assert.throws(() => createBuilderConversationEvent({ marker }), (error) => {
    assertRecordError()(error);
    assert.doesNotMatch(`${error.message}\n${error.stack}`, new RegExp(marker, 'u'));
    return true;
  });
  const source = require('node:fs').readFileSync(
    require.resolve('../electron/builder-conversation-records.cjs'), 'utf8',
  );
  assert.doesNotMatch(source, /builder-project-revision-repository|main\.cjs|preload\.cjs|safeStorage/iu);
  assert.match(source, /permission_admission:\s*'not_granted'/u);
  assert.match(source, /revision_admission:\s*'not_created'/u);
});
