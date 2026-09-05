'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const {
  createBuilderProgrammingRuntimeRunContract,
} = require('../electron/builder-programming-runtime-contract.cjs');
const {
  createBuilderProgrammingRuntimeEventJournal,
} = require('../electron/builder-programming-runtime-events.cjs');
const {
  createBuilderProgrammingRuntimeMainFactRecorder,
} = require('../electron/builder-programming-runtime-main-fact-recorder.cjs');
const {
  BUILDER_HARNESS_PROCESS_HOST_VERSION,
} = require('../electron/builder-harness-process-host.cjs');
const {
  BuilderHarnessProgrammingRuntimeError,
  createBuilderHarnessProgrammingRuntime,
} = require('../electron/builder-harness-programming-runtime.cjs');

const UUID = '12345678-1234-4234-8234-123456789abc';
const RESUME_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const DIGEST = `sha256:${'a'.repeat(64)}`;

function createRuntime(script, overrides = {}) {
  const hosts = [];
  const workspaceRoot = path.resolve('harness-runtime-workspace');
  let now = 1_000;
  const runtime = createBuilderHarnessProgrammingRuntime({
    host_factory({ on_notification: onNotification, session_id: sessionId }) {
      let resolveTermination;
      const termination = new Promise((resolve) => { resolveTermination = resolve; });
      const host = {
        host_version: BUILDER_HARNESS_PROCESS_HOST_VERSION,
        started: false,
        shutdown_count: 0,
        cancel_count: 0,
        async start() {
          host.started = true;
          return { runtime_name: 'deepseek-harness-sdk-runtime', runtime_version: '0.0.1' };
        },
        async prompt({ session_id: promptSession, text }) {
          assert.equal(promptSession, sessionId);
          await script({ notify: onNotification, sessionId, text });
          return { session_id: sessionId, message_id: 'harness-user-message' };
        },
        async resume({ session_id: resumeSession }) {
          assert.equal(resumeSession, sessionId);
          host.resume_count = (host.resume_count ?? 0) + 1;
          return { session_id: sessionId, restored: true };
        },
        async recover_empty_output(request) {
          host.recovery_count = (host.recovery_count ?? 0) + 1;
          return host.prompt(request);
        },
        async manual_compact(request) {
          host.manual_compact_calls ??= [];
          host.manual_compact_calls.push(request);
          if (typeof overrides.on_manual_compact === 'function') {
            return overrides.on_manual_compact(request);
          }
          return null;
        },
        async shutdown() {
          host.shutdown_count += 1;
          resolveTermination({ reason: 'shutdown', exit_code: 0 });
          return true;
        },
        async cancel() {
          host.cancel_count += 1;
          resolveTermination({ reason: 'cancelled', exit_code: null });
          if (typeof overrides.on_cancel === 'function') overrides.on_cancel();
          return true;
        },
        when_terminated() { return termination; },
        terminate() { resolveTermination({ reason: 'process_exit', exit_code: 1 }); },
        diagnostics() {
          return { state: host.cancel_count > 0 ? 'closed' : 'ready' };
        },
      };
      hosts.push(host);
      return host;
    },
    workspace_resolver(workspaceRef) {
      return {
        root: workspaceRoot,
        source_tree_digest: overrides.workspace_digest ?? workspaceRef.source_tree_digest,
      };
    },
    clock() {
      now += 1;
      return now;
    },
    set_timeout: setTimeout,
    clear_timeout: clearTimeout,
    supervision_policy: {
      runtime_idle_timeout_ms: overrides.runtime_idle_timeout_ms ?? 100,
    },
  });
  return { hosts, runtime, workspaceRoot };
}

function createContract(
  runtime,
  mode = 'build',
  maxDurationMs = 5_000,
  allowedTools = null,
  completionRequirement = null,
  inputOverrides = {},
) {
  return createBuilderProgrammingRuntimeRunContract({
    runtime_descriptor: runtime.descriptor,
    admission: {
      project_id: `builder-project:${UUID}`,
      conversation_id: `builder-conversation:${UUID}`,
      turn_id: `builder-turn:${UUID}`,
      task_id: `builder-task:${UUID}`,
      run_id: `builder-run:${UUID}`,
      mode,
      workspace_ref: {
        ref_version: 'builder-programming-workspace-ref.v1',
        workspace_id: `builder-programming-workspace:${'b'.repeat(64)}`,
        source_tree_digest: DIGEST,
        writable: mode === 'build',
      },
      provider_config_digest: DIGEST,
      allowed_tools: allowedTools ?? (mode === 'build'
        ? ['read', 'search', 'edit', 'write', 'command']
        : ['read', 'search']),
      limits: {
        max_steps: 16,
        max_duration_ms: maxDurationMs,
        max_model_tokens: 32_768,
        max_tool_output_bytes: 256 * 1_024,
      },
      admitted_at_ms: 10,
    },
    input: {
      message_id: `builder-message:${UUID}`,
      text: mode === 'plan' ? 'Make a plan.' : 'Update the timer.',
      ...(completionRequirement === null
        ? {}
        : { completion_requirement: completionRequirement }),
      ...inputOverrides,
    },
  });
}

function sinkFor(runContract) {
  const journal = createBuilderProgrammingRuntimeEventJournal({ run_contract: runContract });
  return {
    journal,
    sink: {
      emit(candidate) {
        return journal.append(candidate, candidate.occurred_at_ms + 1);
      },
    },
  };
}

function notifyEvent(notify, sessionId, type, seq, data) {
  return notify({
    method: 'session.event',
    params: { sessionId, event: { type, seq, time: 100 + seq, data } },
  });
}

async function successfulTurn({ notify, sessionId, text = 'Done.', turn = 1, seqStart = 1, reason = 'completed' }) {
  await notifyEvent(notify, sessionId, 'turn/start', seqStart, { turn });
  await notifyEvent(notify, sessionId, 'step/start', seqStart + 1, { turn, step: 1 });
  await notifyEvent(notify, sessionId, 'assistant/chunk', seqStart + 2, {
    turn,
    step: 1,
    chunk: { type: 'text-delta', index: 0, text },
  });
  await notifyEvent(notify, sessionId, 'assistant/message', seqStart + 3, {
    turn,
    step: 1,
    message: {
      id: 'assistant-message',
      role: 'assistant',
      content: [{ type: 'text', text }],
      source: { kind: 'model', provider: 'deepseek-official', model: 'deepseek-v4' },
    },
  });
  await notifyEvent(notify, sessionId, 'step/end', seqStart + 4, { turn, step: 1 });
  await notifyEvent(notify, sessionId, 'turn/end', seqStart + 5, {
    turn,
    reason: { kind: reason },
  });
}

test('keeps a successful Build open until Builder reconciles and checkpoints the workspace', async () => {
  const { hosts, runtime, workspaceRoot } = createRuntime(
    (input) => successfulTurn({ ...input, text: 'Done.' }),
  );
  const runContract = createContract(runtime);
  const { journal, sink } = sinkFor(runContract);
  const handle = await runtime.startRun({ run_contract: runContract, event_sink: sink });
  const settled = await handle.completion;

  assert.equal(settled.status, 'awaiting_reconciliation');
  assert.equal(settled.workspace_root, workspaceRoot);
  assert.equal(settled.assistant_text, 'Done.');
  assert.equal(hosts[0].shutdown_count, 0);
  assert.equal(journal.snapshot().status, 'running');
  const completed = await runtime.reconcileRun(handle, { checkpoint_status: 'created' });
  assert.equal(completed.status, 'completed');
  assert.equal(hosts[0].shutdown_count, 1);
  assert.equal(journal.snapshot().status, 'run_completed');
  assert.equal(journal.snapshot().events.at(-1).payload.checkpoint_status, 'created');
  await runtime.dispose();
});

test('keeps the native session compactable only while a Build awaits reconciliation', async () => {
  const manualResults = [{
    compactionId: 'compaction:manual-runtime-1',
    sourceCommandId: `builder-context-compaction-admission:${'c'.repeat(64)}`,
    startSeq: 8,
    summarySeq: 9,
    endSeq: 10,
    shadowedTokenCount: 4096,
  }];
  const { hosts, runtime } = createRuntime(
    (input) => successfulTurn({ ...input, text: 'Done.' }),
    {
      on_manual_compact(request) {
        void request;
        return manualResults.shift() ?? null;
      },
    },
  );
  const runContract = createContract(runtime);
  const { sink } = sinkFor(runContract);
  const handle = await runtime.startRun({ run_contract: runContract, event_sink: sink });
  const settled = await handle.completion;

  assert.equal(settled.status, 'awaiting_reconciliation');
  assert.deepEqual(await runtime.manual_compact({
    session_id: `builder-harness-${UUID}`,
    source_command_id: `builder-context-compaction-admission:${'c'.repeat(64)}`,
    abort_signal: null,
  }), {
    compactionId: 'compaction:manual-runtime-1',
    sourceCommandId: `builder-context-compaction-admission:${'c'.repeat(64)}`,
    startSeq: 8,
    summarySeq: 9,
    endSeq: 10,
    shadowedTokenCount: 4096,
  });
  assert.equal(await runtime.manual_compact({
    session_id: `builder-harness-${UUID}`,
    source_command_id: `builder-context-compaction-admission:${'d'.repeat(64)}`,
    abort_signal: null,
  }), null);
  assert.equal(hosts[0].manual_compact_calls.length, 2);
  assert.deepEqual(
    hosts[0].manual_compact_calls.map((call) => Reflect.ownKeys(call).sort()),
    [
      ['session_id', 'source_command_id'],
      ['session_id', 'source_command_id'],
    ],
  );

  await runtime.reconcileRun(handle, { checkpoint_status: 'created' });
  await assert.rejects(runtime.manual_compact({
    session_id: `builder-harness-${UUID}`,
    source_command_id: `builder-context-compaction-admission:${'e'.repeat(64)}`,
    abort_signal: null,
  }), { code: 'builder_harness_programming_runtime_closed' });
  assert.equal(hosts[0].manual_compact_calls.length, 2);
  await runtime.dispose();
});

test('native task continuation sends only the new user message into retained Harness history', async () => {
  const prompts = [];
  const { hosts, runtime } = createRuntime(async (input) => {
    prompts.push(input.text);
    await successfulTurn({ ...input, text: 'Follow-up completed.' });
  });
  const instruction = 'Optimize the existing 3D scene lighting.';
  const runContract = createContract(runtime, 'build', 5_000, null, null, {
    text: instruction,
    resume_session_run_id: `builder-run:${RESUME_UUID}`,
    resume_kind: 'task_continuation',
  });
  const { sink } = sinkFor(runContract);
  const handle = await runtime.startRun({ run_contract: runContract, event_sink: sink });
  const result = await handle.completion;

  assert.equal(result.status, 'awaiting_reconciliation');
  assert.equal(hosts[0].resume_count, 1);
  assert.deepEqual(prompts, [instruction]);
  await runtime.reconcileRun(handle, { checkpoint_status: 'updated' });
  await runtime.dispose();
});

test('interrupted recovery wakes retained history without replaying the original request', async () => {
  const prompts = [];
  const { hosts, runtime } = createRuntime(async (input) => {
    prompts.push(input.text);
    await successfulTurn({ ...input, text: 'Recovered.' });
  });
  const originalRequest = 'Build the complete football blog from the approved plan.';
  const runContract = createContract(runtime, 'build', 5_000, null, 'source_change_required', {
    text: originalRequest,
    resume_session_run_id: `builder-run:${RESUME_UUID}`,
    resume_kind: 'interrupted_recovery',
  });
  const { sink } = sinkFor(runContract);
  const handle = await runtime.startRun({ run_contract: runContract, event_sink: sink });
  const result = await handle.completion;

  assert.equal(result.status, 'awaiting_reconciliation');
  assert.equal(hosts[0].resume_count, 1);
  assert.equal(prompts.length, 1);
  assert.match(prompts[0], /retained session/u);
  assert.match(prompts[0], /verify uncertain side effects/u);
  assert.equal(prompts[0].includes(originalRequest), false);
  assert.equal(hosts[0].recovery_count ?? 0, 0);
  await runtime.reconcileRun(handle, { checkpoint_status: 'updated' });
  await runtime.dispose();
});

test('allows Builder to close a successful unchanged Build without a checkpoint', async () => {
  const { hosts, runtime } = createRuntime(
    (input) => successfulTurn({
      ...input,
      text: 'I inspected the project and need one more detail before editing.',
    }),
  );
  const runContract = createContract(runtime);
  const { journal, sink } = sinkFor(runContract);
  const handle = await runtime.startRun({ run_contract: runContract, event_sink: sink });
  const settled = await handle.completion;

  assert.equal(settled.status, 'awaiting_reconciliation');
  const completed = await runtime.reconcileRun(handle, { checkpoint_status: 'not_applicable' });

  assert.equal(completed.status, 'completed');
  assert.equal(hosts[0].shutdown_count, 1);
  assert.equal(journal.snapshot().status, 'run_completed');
  assert.equal(journal.snapshot().events.at(-1).payload.checkpoint_status, 'not_applicable');
  await runtime.dispose();
});

async function emptyTokenLimitedTurn({ notify, sessionId, turn = 1, seqStart = 1 }) {
  await notifyEvent(notify, sessionId, 'turn/start', seqStart, { turn });
  await notifyEvent(notify, sessionId, 'step/start', seqStart + 1, { turn, step: 1 });
  await notifyEvent(notify, sessionId, 'step/end', seqStart + 2, { turn, step: 1 });
  await notifyEvent(notify, sessionId, 'turn/end', seqStart + 3, { turn, reason: { kind: 'max-tokens' } });
}

function harnessToolResult(callId) {
  return {
    id: `result-${callId}`,
    role: 'user',
    content: [{
      type: 'tool-result',
      toolCallId: callId,
      content: [{ type: 'text', text: 'ok' }],
    }],
    source: { kind: 'tool', callId },
  };
}

async function readThenTokenLimitedTurn({ notify, sessionId }) {
  await notifyEvent(notify, sessionId, 'turn/start', 1, { turn: 1 });
  await notifyEvent(notify, sessionId, 'step/start', 2, { turn: 1, step: 1 });
  await notifyEvent(notify, sessionId, 'assistant/message', 3, {
    turn: 1,
    step: 1,
    message: {
      id: 'assistant-read-first',
      role: 'assistant',
      content: [{ type: 'text', text: 'I will inspect the project before implementation.' }],
      source: { kind: 'model', provider: 'deepseek-official', model: 'deepseek-v4' },
    },
  });
  await notifyEvent(notify, sessionId, 'tool/call', 4, {
    turn: 1,
    step: 1,
    callId: 'call-read-first',
    name: 'read',
    arguments: JSON.stringify({ file_path: 'README.md' }),
  });
  await notifyEvent(notify, sessionId, 'tool/result', 5, {
    turn: 1,
    step: 1,
    message: harnessToolResult('call-read-first'),
  });
  await notifyEvent(notify, sessionId, 'step/end', 6, { turn: 1, step: 1 });
  await notifyEvent(notify, sessionId, 'step/start', 7, { turn: 1, step: 2 });
  await notifyEvent(notify, sessionId, 'step/end', 8, { turn: 1, step: 2 });
  await notifyEvent(notify, sessionId, 'turn/end', 9, {
    turn: 1,
    reason: { kind: 'max-tokens' },
  });
}

async function writeThenCompleteTurn({ notify, sessionId }) {
  await notifyEvent(notify, sessionId, 'turn/start', 10, { turn: 2 });
  await notifyEvent(notify, sessionId, 'step/start', 11, { turn: 2, step: 1 });
  await notifyEvent(notify, sessionId, 'tool/call', 12, {
    turn: 2,
    step: 1,
    callId: 'call-write-recovery',
    name: 'write',
    arguments: JSON.stringify({ file_path: 'index.html', content: '<h1>Done</h1>\n' }),
  });
  await notifyEvent(notify, sessionId, 'tool/result', 13, {
    turn: 2,
    step: 1,
    message: harnessToolResult('call-write-recovery'),
  });
  await notifyEvent(notify, sessionId, 'step/end', 14, { turn: 2, step: 1 });
  await notifyEvent(notify, sessionId, 'step/start', 15, { turn: 2, step: 2 });
  await notifyEvent(notify, sessionId, 'assistant/chunk', 16, {
    turn: 2,
    step: 2,
    chunk: { type: 'text-delta', index: 0, text: 'Implemented the approved plan.' },
  });
  await notifyEvent(notify, sessionId, 'assistant/message', 17, {
    turn: 2,
    step: 2,
    message: {
      id: 'assistant-write-complete',
      role: 'assistant',
      content: [{ type: 'text', text: 'Implemented the approved plan.' }],
      source: { kind: 'model', provider: 'deepseek-official', model: 'deepseek-v4' },
    },
  });
  await notifyEvent(notify, sessionId, 'step/end', 18, { turn: 2, step: 2 });
  await notifyEvent(notify, sessionId, 'turn/end', 19, {
    turn: 2,
    reason: { kind: 'completed' },
  });
}

test('continues a token-limited empty Build once within the original admitted run', async () => {
  const prompts = [];
  const { hosts, runtime } = createRuntime(async (input) => {
    prompts.push(input.text);
    if (prompts.length === 1) await emptyTokenLimitedTurn(input);
    else await successfulTurn({ ...input, text: 'Implementation completed.', turn: 2, seqStart: 5 });
  });
  const runContract = createContract(runtime);
  const { journal, sink } = sinkFor(runContract);
  const handle = await runtime.startRun({ run_contract: runContract, event_sink: sink });
  const completed = await handle.completion;
  assert.equal(completed.status, 'awaiting_reconciliation');
  assert.equal(completed.assistant_text, 'Implementation completed.');
  assert.equal(prompts.length, 2);
  assert.equal(hosts[0].recovery_count, 1);
  assert.match(prompts[1], /No project check has run/);
  assert.ok(prompts[1].includes(runContract.input.text));
  assert.equal(hosts.length, 1);
  assert.equal(journal.snapshot().events.filter((event) => event.event_type === 'turn_started').length, 1);
  assert.equal(journal.snapshot().events.filter((event) => event.event_type === 'project_check_recorded').length, 0);
  await runtime.reconcileRun(handle, { checkpoint_status: 'not_applicable' });
  await runtime.dispose();
});

test('continues an approved implementation that only reads before exhausting its tokens', async () => {
  const prompts = [];
  const { hosts, runtime } = createRuntime(async (input) => {
    prompts.push(input.text);
    if (prompts.length === 1) await readThenTokenLimitedTurn(input);
    else await writeThenCompleteTurn(input);
  });
  const runContract = createContract(
    runtime,
    'build',
    5_000,
    null,
    'source_change_required',
  );
  const { journal, sink } = sinkFor(runContract);
  const handle = await runtime.startRun({ run_contract: runContract, event_sink: sink });
  const completed = await handle.completion;

  assert.equal(completed.status, 'awaiting_reconciliation');
  assert.equal(completed.assistant_text, 'Implemented the approved plan.');
  assert.equal(prompts.length, 2);
  assert.equal(hosts[0].recovery_count, 1);
  assert.match(prompts[1], /requires a source change/u);
  assert.match(prompts[1], /same approved implementation/u);
  assert.ok(prompts[1].includes(runContract.input.text));
  assert.equal(hosts.length, 1);
  assert.equal(
    journal.snapshot().events.filter((event) => event.event_type === 'turn_started').length,
    1,
  );
  assert.deepEqual(
    journal.snapshot().events
      .filter((event) => event.event_type === 'tool_call_completed')
      .map((event) => event.payload.result_kind),
    ['read', 'write'],
  );
  await runtime.reconcileRun(handle, { checkpoint_status: 'created' });
  await runtime.dispose();
});

test('fails closed when approved implementation recovery still makes no source change', async () => {
  let prompts = 0;
  const { hosts, runtime } = createRuntime(async (input) => {
    prompts += 1;
    await successfulTurn({
      ...input,
      text: prompts === 1 ? 'I will start implementing.' : 'I am still preparing.',
      turn: prompts,
      seqStart: prompts === 1 ? 1 : 7,
    });
  });
  const runContract = createContract(
    runtime,
    'build',
    5_000,
    null,
    'source_change_required',
  );
  const { journal, sink } = sinkFor(runContract);
  const handle = await runtime.startRun({ run_contract: runContract, event_sink: sink });
  const completed = await handle.completion;

  assert.equal(completed.status, 'failed');
  assert.equal(completed.runtime_cause_code, 'builder_harness_source_change_required');
  assert.equal(prompts, 2);
  assert.equal(hosts[0].recovery_count, 1);
  assert.equal(hosts[0].cancel_count, 1);
  assert.equal(journal.snapshot().events.at(-1).event_type, 'run_failed');
  await runtime.dispose();
});

test('stops after a second empty token-limit response instead of retrying indefinitely', async () => {
  let prompts = 0;
  const { hosts, runtime } = createRuntime(async (input) => {
    prompts += 1;
    await emptyTokenLimitedTurn({ ...input, turn: prompts, seqStart: (prompts - 1) * 4 + 1 });
  });
  const runContract = createContract(runtime);
  const { journal, sink } = sinkFor(runContract);
  const handle = await runtime.startRun({ run_contract: runContract, event_sink: sink });
  const completed = await handle.completion;
  assert.equal(completed.status, 'failed');
  assert.equal(completed.runtime_cause_code, 'builder_harness_empty_output_token_limit');
  assert.equal(prompts, 2);
  assert.equal(hosts[0].recovery_count, 1);
  assert.equal(hosts[0].cancel_count, 1);
  assert.equal(journal.snapshot().events.at(-1).event_type, 'run_failed');
  await runtime.dispose();
});

test('does not automatically replay a token-limited Build that already produced text', async () => {
  let prompts = 0;
  const { runtime } = createRuntime(async (input) => {
    prompts += 1;
    await successfulTurn({ ...input, text: 'Partial implementation details.', reason: 'max-tokens' });
  });
  const runContract = createContract(runtime);
  const { sink } = sinkFor(runContract);
  const handle = await runtime.startRun({ run_contract: runContract, event_sink: sink });
  assert.equal((await handle.completion).status, 'awaiting_reconciliation');
  assert.equal(prompts, 1);
  await runtime.reconcileRun(handle, { checkpoint_status: 'not_applicable' });
  await runtime.dispose();
});

test('keeps the empty-output continuation cancellable without opening another run', async () => {
  let prompts = 0;
  let recoveryStarted;
  let releaseRecovery;
  const started = new Promise((resolve) => { recoveryStarted = resolve; });
  const held = new Promise((resolve) => { releaseRecovery = resolve; });
  const { hosts, runtime } = createRuntime(async (input) => {
    prompts += 1;
    if (prompts === 1) await emptyTokenLimitedTurn(input);
    else {
      recoveryStarted();
      await held;
    }
  }, { on_cancel: () => releaseRecovery() });
  const runContract = createContract(runtime);
  const { journal, sink } = sinkFor(runContract);
  const handle = await runtime.startRun({ run_contract: runContract, event_sink: sink });
  await started;
  assert.equal((await runtime.cancelRun(handle, 'user_requested')).cancellation_requested, true);
  assert.equal((await handle.completion).status, 'cancelled');
  assert.equal(prompts, 2);
  assert.equal(hosts.length, 1);
  assert.equal(hosts[0].cancel_count, 1);
  assert.equal(journal.snapshot().status, 'run_cancelled');
  await runtime.dispose();
});

test('keeps one Builder turn while Harness repairs a failed project check', async () => {
  let promptCount = 0;
  const prompts = [];
  const { hosts, runtime } = createRuntime(async (input) => {
    promptCount += 1;
    prompts.push(input.text);
    await successfulTurn({
      ...input,
      text: promptCount === 1 ? 'Initial edit ready.' : 'Repaired the failed check.',
      turn: promptCount,
      seqStart: promptCount === 1 ? 1 : 7,
    });
  });
  const runContract = createContract(runtime);
  const { journal, sink } = sinkFor(runContract);
  const handle = await runtime.startRun({ run_contract: runContract, event_sink: sink });
  const first = await handle.completion;
  const recorder = createBuilderProgrammingRuntimeMainFactRecorder({
    run_contract: runContract,
    append_main_fact: (candidate) => journal.appendMainFact(candidate, candidate.occurred_at_ms + 1),
    clock: (() => { let now = 2_000; return () => ++now; })(),
  });
  await recorder.record_check({
    verification_step_id: first.verification_step_id,
    command_display: 'npm test',
    status: 'failed',
    duration_ms: 400,
    summary: 'One test failed.',
  });

  const repaired = await runtime.repairRun(handle, { failure_summary: 'One test failed.' });
  assert.equal(repaired.status, 'awaiting_reconciliation');
  assert.equal(repaired.assistant_text, 'Repaired the failed check.');
  assert.notEqual(repaired.verification_step_id, first.verification_step_id);
  assert.equal(journal.snapshot().events.filter((event) => event.event_type === 'turn_started').length, 1);
  assert.equal(hosts[0].shutdown_count, 0);
  assert.match(prompts[1], /<original_end_user_request>\nUpdate the timer\.\n<\/original_end_user_request>/u);
  assert.match(prompts[1], /preserve every constraint/u);
  assert.match(prompts[1], /conditional instruction that applies after a failed check/u);
  assert.match(prompts[1], /historical first-attempt requirements, not repair constraints/u);
  assert.match(prompts[1], /inspect the project check definition and the files it references/u);
  assert.match(prompts[1], /controlled bash tool is available/u);
  assert.match(prompts[1], /using bash during the repair is optional/u);
  assert.doesNotMatch(prompts[1], /has no shell or command tool/u);
  assert.match(prompts[1], /Builder will rerun the same main-owned project check/u);
  assert.match(prompts[1], /Do not claim that the check passed/u);
  assert.match(prompts[1], /Do not weaken, delete, bypass, or rewrite tests or verification logic/u);
  assert.match(prompts[1], /only when the original end-user request explicitly requires that change/u);

  await recorder.record_check({
    verification_step_id: repaired.verification_step_id,
    command_display: 'npm test',
    status: 'passed',
    duration_ms: 320,
    summary: 'All tests passed.',
  });
  await runtime.reconcileRun(handle, { checkpoint_status: 'updated' });
  assert.equal(hosts[0].shutdown_count, 1);
  assert.equal(journal.snapshot().status, 'run_completed');
  await runtime.dispose();
});

test('keeps the repair prompt file-tool-only when the admitted run has no command capability', async () => {
  const prompts = [];
  let promptCount = 0;
  const { runtime } = createRuntime(async (input) => {
    promptCount += 1;
    prompts.push(input.text);
    await successfulTurn({
      ...input,
      text: promptCount === 1 ? 'Initial edit ready.' : 'Repaired with file tools.',
      turn: promptCount,
      seqStart: promptCount === 1 ? 1 : 7,
    });
  });
  const runContract = createContract(
    runtime,
    'build',
    5_000,
    ['read', 'search', 'edit', 'write'],
  );
  const { sink } = sinkFor(runContract);
  const handle = await runtime.startRun({ run_contract: runContract, event_sink: sink });
  await handle.completion;

  await runtime.repairRun(handle, { failure_summary: 'One test failed.' });

  assert.match(prompts[1], /has no shell or command tool/u);
  assert.doesNotMatch(prompts[1], /controlled bash tool is available/u);
  await runtime.reconcileRun(handle, { checkpoint_status: 'updated' });
  await runtime.dispose();
});

test('completes Plan in conversation without waiting for workspace reconciliation', async () => {
  const markdown = '## Plan\n\n1. Read the project.\n2. Make the change.';
  const { runtime } = createRuntime((input) => successfulTurn({ ...input, text: markdown }));
  const runContract = createContract(runtime, 'plan');
  const { journal, sink } = sinkFor(runContract);
  const handle = await runtime.startRun({ run_contract: runContract, event_sink: sink });
  const result = await handle.completion;

  assert.equal(result.status, 'completed');
  assert.equal(journal.snapshot().status, 'run_completed');
  assert.equal(
    journal.snapshot().events
      .filter((item) => item.event_type === 'assistant_text_delta')
      .map((item) => item.payload.delta_text)
      .join(''),
    markdown,
  );
  await runtime.dispose();
});

test('reaps the dedicated process and closes runtime facts after an unsupported Harness tool', async () => {
  const { hosts, runtime } = createRuntime(async ({ notify, sessionId }) => {
    await notifyEvent(notify, sessionId, 'turn/start', 1, { turn: 1 });
    await notifyEvent(notify, sessionId, 'step/start', 2, { turn: 1, step: 1 });
    await notifyEvent(notify, sessionId, 'tool/call', 3, {
      turn: 1,
      step: 1,
      callId: 'subagent-call',
      name: 'subagent',
      arguments: JSON.stringify({ task: 'leave the workspace' }),
    });
  });
  const runContract = createContract(runtime, 'build', 1_000);
  const { journal, sink } = sinkFor(runContract);
  const handle = await runtime.startRun({ run_contract: runContract, event_sink: sink });
  const result = await handle.completion;

  assert.equal(result.status, 'failed');
  assert.equal(result.runtime_code, 'builder_harness_programming_run_limit_reached');
  assert.equal(result.runtime_cause_code, 'builder_harness_programming_run_limit_reached');
  assert.ok(hosts[0].cancel_count >= 1);
  assert.equal(journal.snapshot().status, 'run_failed');
  await runtime.dispose();
});

test('preserves a fixed Harness host failure code in the terminal completion', async () => {
  const { runtime } = createRuntime(async () => {
    const error = new Error('private provider detail');
    error.code = 'builder_harness_process_host_runtime_failed';
    throw error;
  });
  const runContract = createContract(runtime);
  const { sink } = sinkFor(runContract);
  const handle = await runtime.startRun({ run_contract: runContract, event_sink: sink });
  const result = await handle.completion;

  assert.equal(result.status, 'failed');
  assert.equal(result.runtime_code, 'builder_harness_programming_runtime_failed');
  assert.equal(result.runtime_cause_code, 'builder_harness_process_host_runtime_failed');
  assert.equal(JSON.stringify(result).includes('private provider detail'), false);
  await runtime.dispose();
});

test('settles when the host terminates after acknowledging the prompt', async () => {
  const { hosts, runtime } = createRuntime(async () => {}, {
    runtime_idle_timeout_ms: 1_000,
  });
  const runContract = createContract(runtime);
  const { journal, sink } = sinkFor(runContract);
  const handle = await runtime.startRun({ run_contract: runContract, event_sink: sink });
  await new Promise((resolve) => setImmediate(resolve));
  hosts[0].terminate();
  const result = await handle.completion;

  assert.equal(result.status, 'failed');
  assert.equal(result.runtime_code, 'builder_harness_programming_runtime_failed');
  assert.equal(result.runtime_cause_code, 'builder_harness_process_host_runtime_failed');
  assert.equal(journal.snapshot().status, 'run_failed');
  await runtime.dispose();
});

test('stops a silent runtime with a distinct inactivity classification', async () => {
  const { hosts, runtime } = createRuntime(async () => new Promise(() => {}));
  const runContract = createContract(runtime, 'build', 5_000);
  const { journal, sink } = sinkFor(runContract);
  const handle = await runtime.startRun({ run_contract: runContract, event_sink: sink });
  const result = await handle.completion;

  assert.equal(result.status, 'failed');
  assert.equal(result.runtime_code, 'builder_harness_programming_runtime_idle_timeout');
  assert.equal(result.runtime_cause_code, 'builder_harness_programming_runtime_idle_timeout');
  assert.equal(hosts[0].cancel_count, 1);
  assert.equal(journal.snapshot().status, 'run_failed');
  assert.equal(journal.snapshot().events.at(-1).payload.failure_class, 'runtime_idle_timeout');
  await runtime.dispose();
});

test('rearms runtime inactivity from verified semantic progress', async () => {
  const pause = () => new Promise((resolve) => setTimeout(resolve, 150));
  const { runtime } = createRuntime(async ({ notify, sessionId }) => {
    await notifyEvent(notify, sessionId, 'turn/start', 1, { turn: 1 });
    await pause();
    await notifyEvent(notify, sessionId, 'step/start', 2, { turn: 1, step: 1 });
    await pause();
    await notifyEvent(notify, sessionId, 'assistant/message', 3, {
      turn: 1,
      step: 1,
      message: {
        id: 'assistant-message',
        role: 'assistant',
        content: [{ type: 'text', text: 'Finished after several progress intervals.' }],
        source: { kind: 'model', provider: 'deepseek-official', model: 'deepseek-v4' },
      },
    });
    await notifyEvent(notify, sessionId, 'step/end', 4, { turn: 1, step: 1 });
    await notifyEvent(notify, sessionId, 'turn/end', 5, {
      turn: 1,
      reason: { kind: 'completed' },
    });
  }, { runtime_idle_timeout_ms: 250 });
  const runContract = createContract(runtime, 'plan', 5_000);
  const { journal, sink } = sinkFor(runContract);
  const handle = await runtime.startRun({ run_contract: runContract, event_sink: sink });
  const result = await handle.completion;

  assert.equal(result.status, 'completed');
  assert.equal(journal.snapshot().status, 'run_completed');
  await runtime.dispose();
});

test('terminates the Harness host before committing the cancelled terminal fact', async () => {
  const order = [];
  let releasePrompt;
  const promptHeld = new Promise((resolve) => { releasePrompt = resolve; });
  const { hosts, runtime } = createRuntime(
    async () => promptHeld,
    {
      on_cancel() {
        order.push('host_cancelled');
        releasePrompt();
      },
    },
  );
  const runContract = createContract(runtime);
  const journal = createBuilderProgrammingRuntimeEventJournal({ run_contract: runContract });
  const handle = await runtime.startRun({
    run_contract: runContract,
    event_sink: {
      emit(candidate) {
        if (candidate.event_type === 'run_cancelled') order.push('run_cancelled');
        return journal.append(candidate, candidate.occurred_at_ms + 1);
      },
    },
  });

  const cancelled = await runtime.cancelRun(handle, 'user_requested');
  const completion = await handle.completion;

  assert.equal(cancelled.cancellation_requested, true);
  assert.equal(completion.status, 'cancelled');
  assert.equal(hosts[0].cancel_count, 1);
  assert.deepEqual(order, ['host_cancelled', 'run_cancelled']);
  assert.equal(journal.snapshot().status, 'run_cancelled');
  await runtime.dispose();
});

test('rejects a workspace resolver result that does not match the admitted source tree', async () => {
  const { runtime } = createRuntime(successfulTurn, {
    workspace_digest: `sha256:${'f'.repeat(64)}`,
  });
  const runContract = createContract(runtime);
  const { sink } = sinkFor(runContract);

  await assert.rejects(
    runtime.startRun({ run_contract: runContract, event_sink: sink }),
    (error) => error instanceof BuilderHarnessProgrammingRuntimeError
      && error.code === 'builder_harness_programming_runtime_invalid',
  );
  await runtime.dispose();
});
