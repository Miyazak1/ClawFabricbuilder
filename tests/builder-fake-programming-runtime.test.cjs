'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  createBuilderProgrammingRuntimeRunContract,
} = require('../electron/builder-programming-runtime-contract.cjs');
const {
  createBuilderProgrammingRuntimeEventJournal,
} = require('../electron/builder-programming-runtime-events.cjs');
const {
  BuilderFakeProgrammingRuntimeError,
  createBuilderFakeProgrammingRuntime,
} = require('../electron/builder-fake-programming-runtime.cjs');

const UUID = '12345678-1234-4234-8234-123456789abc';
const DIGEST = `sha256:${'a'.repeat(64)}`;

function createClock() {
  let current = 100;
  return () => {
    current += 1;
    return current;
  };
}

function createRunContract(runtime, mode = 'build') {
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
      allowed_tools: mode === 'build'
        ? ['read', 'search', 'edit', 'write', 'command']
        : ['read', 'search'],
      limits: {
        max_steps: 16,
        max_duration_ms: 300_000,
        max_model_tokens: 32_768,
        max_tool_output_bytes: 256 * 1_024,
      },
      admitted_at_ms: 100,
    },
    input: {
      message_id: `builder-message:${UUID}`,
      text: 'Update the timer and run its checks.',
    },
  });
}

function journalSink(runContract) {
  const journal = createBuilderProgrammingRuntimeEventJournal({ run_contract: runContract });
  return {
    journal,
    sink: {
      emit(event) {
        return journal.append(event, event.occurred_at_ms + 1);
      },
    },
  };
}

test('proves a deterministic read, edit, failed check, repair, and passed check loop', async () => {
  const runtime = createBuilderFakeProgrammingRuntime({ clock: createClock() });
  const contract = createRunContract(runtime);
  const { journal, sink } = journalSink(contract);
  const handle = await runtime.startRun({ run_contract: contract, event_sink: sink });
  const result = await handle.completion;

  assert.equal(result.status, 'completed');
  assert.equal(journal.snapshot().status, 'run_completed');
  const events = journal.snapshot().events;
  const types = events.map((event) => event.event_type);
  assert.equal(types.filter((type) => type === 'step_started').length, 3);
  assert.equal(types.filter((type) => type === 'file_change_recorded').length, 2);
  assert.equal(types.filter((type) => type === 'check_result_recorded').length, 2);
  assert.equal(types.filter((type) => type === 'tool_call_failed').length, 1);
  assert.deepEqual(
    events.filter((event) => event.event_type === 'check_result_recorded')
      .map((event) => event.payload.status),
    ['failed', 'passed'],
  );
  assert.equal(events.at(-1).payload.checkpoint_status, 'created');
  await runtime.dispose();
});

test('emits complete Markdown directly for Plan and creates no checkpoint', async () => {
  const runtime = createBuilderFakeProgrammingRuntime({ clock: createClock() });
  const contract = createRunContract(runtime, 'plan');
  const { journal, sink } = journalSink(contract);
  const handle = await runtime.startRun({ run_contract: contract, event_sink: sink });
  await handle.completion;

  const events = journal.snapshot().events;
  const text = events
    .filter((event) => event.event_type === 'assistant_text_delta')
    .map((event) => event.payload.delta_text)
    .join('');
  assert.match(text, /^## Implementation plan/u);
  assert.doesNotMatch(text, /```json|builder_project_plan_proposal/u);
  assert.equal(events.some((event) => event.event_type === 'tool_call_started'), false);
  assert.equal(events.at(-1).payload.checkpoint_status, 'not_applicable');
  await runtime.dispose();
});

test('cooperatively settles an active tool before recording cancellation', async () => {
  const runtime = createBuilderFakeProgrammingRuntime({ clock: createClock() });
  const contract = createRunContract(runtime);
  const journal = createBuilderProgrammingRuntimeEventJournal({ run_contract: contract });
  let releaseRead;
  const readStarted = new Promise((resolve) => { releaseRead = resolve; });
  let continueRead;
  const readRelease = new Promise((resolve) => { continueRead = resolve; });
  const sink = {
    async emit(event) {
      journal.append(event, event.occurred_at_ms + 1);
      if (event.event_type === 'tool_call_started' && event.payload.tool_kind === 'read') {
        releaseRead();
        await readRelease;
      }
    },
  };
  const handle = await runtime.startRun({ run_contract: contract, event_sink: sink });
  await readStarted;
  const receipt = runtime.cancelRun(handle, 'user_requested');
  assert.equal(receipt.cancellation_requested, true);
  continueRead();
  const result = await handle.completion;

  assert.equal(result.status, 'cancelled');
  const events = journal.snapshot().events;
  assert.deepEqual(events.slice(-2).map((event) => event.event_type), [
    'tool_call_failed',
    'run_cancelled',
  ]);
  assert.equal(journal.snapshot().status, 'run_cancelled');
  await runtime.dispose();
});

test('rejects duplicate active runs and new work after disposal', async () => {
  const runtime = createBuilderFakeProgrammingRuntime({ clock: createClock() });
  const contract = createRunContract(runtime);
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const sink = {
    async emit() { await gate; },
  };
  const handle = await runtime.startRun({ run_contract: contract, event_sink: sink });
  await assert.rejects(
    runtime.startRun({ run_contract: contract, event_sink: sink }),
    (error) => error instanceof BuilderFakeProgrammingRuntimeError
      && error.code === 'builder_fake_programming_runtime_conflict',
  );
  runtime.cancelRun(handle, 'shutdown');
  release();
  await handle.completion;
  await runtime.dispose();
  await assert.rejects(
    runtime.startRun({ run_contract: contract, event_sink: sink }),
    (error) => error instanceof BuilderFakeProgrammingRuntimeError
      && error.code === 'builder_fake_programming_runtime_closed',
  );
});

test('fake runtime has no renderer, source, process, provider, or storage authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-fake-programming-runtime.cjs'),
    'utf8',
  );
  assert.doesNotMatch(source, /\b(?:fetch|ipcMain|ipcRenderer|contextBridge|BrowserWindow)\b/u);
  assert.doesNotMatch(source, /\b(?:child_process|spawn|execFile|DatabaseSync|node:sqlite)\b/u);
  assert.doesNotMatch(source, /\b(?:readFile|writeFile|source_tree|base_source_tree|absolute_path)\b/u);
  assert.doesNotMatch(source, /api[_-]?key|Bearer|credential_value|secret_store/u);
});
