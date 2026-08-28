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

function createContract(runtime, mode = 'build', maxDurationMs = 5_000, allowedTools = null) {
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

async function successfulTurn({ notify, sessionId, text = 'Done.', turn = 1, seqStart = 1 }) {
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
    reason: { kind: 'completed' },
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
