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
  BuilderStructuredProgrammingRuntimeBridgeError,
  createBuilderStructuredProgrammingRuntimeBridge,
} = require('../electron/builder-structured-programming-runtime-bridge.cjs');

const UUID = '12345678-1234-4234-8234-123456789abc';
const DIGEST = `sha256:${'a'.repeat(64)}`;

function createClock() {
  let current = 100;
  return () => {
    current += 1;
    return current;
  };
}

function createRunContract(bridge) {
  return createBuilderProgrammingRuntimeRunContract({
    runtime_descriptor: bridge.descriptor,
    admission: {
      project_id: `builder-project:${UUID}`,
      conversation_id: `builder-conversation:${UUID}`,
      turn_id: `builder-turn:${UUID}`,
      task_id: `builder-task:${UUID}`,
      run_id: `builder-run:${UUID}`,
      mode: 'build',
      workspace_ref: {
        ref_version: 'builder-programming-workspace-ref.v1',
        workspace_id: `builder-programming-workspace:${'b'.repeat(64)}`,
        source_tree_digest: DIGEST,
        writable: true,
      },
      provider_config_digest: DIGEST,
      allowed_tools: [],
      limits: {
        max_steps: 4,
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

function createSink(runContract) {
  const journal = createBuilderProgrammingRuntimeEventJournal({ run_contract: runContract });
  return {
    journal,
    sink: {
      emit(event) {
        return journal.append(event, event.occurred_at_ms + 1);
      },
      emit_main_fact(event) {
        return journal.appendMainFact(event, event.occurred_at_ms + 1);
      },
    },
  };
}

test('maps structured generation and verified main facts into one canonical Build run', async () => {
  const bridge = createBuilderStructuredProgrammingRuntimeBridge({ clock: createClock() });
  assert.equal(bridge.descriptor.capabilities.native_tool_calls, false);
  const contract = createRunContract(bridge);
  const { journal, sink } = createSink(contract);
  const handle = await bridge.startRun({ run_contract: contract, event_sink: sink });

  await bridge.recordAssistantResult(handle, {
    assistant_text: 'Updated the timer and verified the project check.',
  });
  await bridge.recordFileChange(handle, {
    resource_id: 'project:/src/timer.js',
    change_kind: 'edited',
    added_lines: 8,
    deleted_lines: 2,
    duration_ms: 12,
  });
  await bridge.recordCheckResult(handle, {
    command_display: 'npm test',
    status: 'passed',
    duration_ms: 850,
    summary: 'The project check completed successfully.',
  });
  const result = await bridge.completeRun(handle, { checkpoint_status: 'created' });

  assert.equal(result.status, 'completed');
  assert.equal(result.file_change_count, 1);
  assert.equal(result.check_count, 1);
  const events = journal.snapshot().events;
  assert.equal(journal.snapshot().status, 'run_completed');
  assert.deepEqual(events.slice(0, 5).map((event) => event.event_source), [
    'runtime',
    'runtime',
    'runtime',
    'runtime',
    'runtime',
  ]);
  const fileEvent = events.find((event) => event.event_type === 'file_change_recorded');
  const checkEvent = events.find((event) => event.event_type === 'check_result_recorded');
  assert.equal(fileEvent.event_source, 'main');
  assert.equal(checkEvent.event_source, 'main');
  assert.equal(events.at(-1).event_source, 'main');
  assert.equal(events.at(-1).payload.checkpoint_status, 'created');
});

test('keeps edit and command rows separate and records failed checks honestly', async () => {
  const bridge = createBuilderStructuredProgrammingRuntimeBridge({ clock: createClock() });
  const contract = createRunContract(bridge);
  const { journal, sink } = createSink(contract);
  const handle = await bridge.startRun({ run_contract: contract, event_sink: sink });
  await bridge.recordAssistantResult(handle, { assistant_text: 'Prepared the timer update.' });
  await bridge.recordFileChange(handle, {
    resource_id: 'project:/src/timer.js',
    change_kind: 'edited',
    added_lines: 2,
    deleted_lines: 1,
    duration_ms: 5,
  });
  await bridge.recordCheckResult(handle, {
    command_display: 'npm test',
    status: 'failed',
    duration_ms: 700,
    summary: 'One timer assertion failed.',
  });

  const toolStarts = journal.snapshot().events
    .filter((event) => event.event_type === 'tool_call_started');
  assert.deepEqual(toolStarts.map((event) => event.payload.tool_kind), ['edit', 'command']);
  assert.equal(
    journal.snapshot().events.some((event) => event.event_type === 'tool_call_failed'),
    true,
  );
  await bridge.cancelRun(handle);
});

test('records incomplete environment checks as failed command activities', async () => {
  const bridge = createBuilderStructuredProgrammingRuntimeBridge({ clock: createClock() });
  const contract = createRunContract(bridge);
  const { journal, sink } = createSink(contract);
  const handle = await bridge.startRun({ run_contract: contract, event_sink: sink });

  await bridge.recordAssistantResult(handle, { assistant_text: 'Prepared the timer update.' });
  await bridge.recordFileChange(handle, {
    resource_id: 'project:/src/timer.js',
    change_kind: 'edited',
    added_lines: 2,
    deleted_lines: 1,
    duration_ms: 5,
  });
  await bridge.recordCheckResult(handle, {
    command_display: 'npm test',
    status: 'incomplete',
    duration_ms: 120,
    summary: 'The admitted check workspace needs prepared dependencies or local toolchain access before this check can run.',
  });

  const events = journal.snapshot().events;
  assert.equal(events.at(-2).event_type, 'check_result_recorded');
  assert.equal(events.at(-2).payload.status, 'incomplete');
  assert.equal(events.at(-1).event_type, 'tool_call_failed');
  assert.equal(events.at(-1).payload.failure_class, 'environment_unavailable');
  await bridge.cancelRun(handle);
});

test('does not complete without real assistant, mutation, and checkpoint evidence', async () => {
  const bridge = createBuilderStructuredProgrammingRuntimeBridge({ clock: createClock() });
  const contract = createRunContract(bridge);
  const { sink } = createSink(contract);
  const handle = await bridge.startRun({ run_contract: contract, event_sink: sink });

  await assert.rejects(
    bridge.completeRun(handle, { checkpoint_status: 'created' }),
    (error) => error instanceof BuilderStructuredProgrammingRuntimeBridgeError
      && error.code === 'builder_structured_programming_runtime_bridge_conflict',
  );
  await bridge.recordAssistantResult(handle, { assistant_text: 'Prepared a result.' });
  await assert.rejects(
    bridge.completeRun(handle, { checkpoint_status: 'created' }),
    BuilderStructuredProgrammingRuntimeBridgeError,
  );
  await bridge.cancelRun(handle);
});

test('does not turn a missing check into a command execution fact', async () => {
  const bridge = createBuilderStructuredProgrammingRuntimeBridge({ clock: createClock() });
  const contract = createRunContract(bridge);
  const { journal, sink } = createSink(contract);
  const handle = await bridge.startRun({ run_contract: contract, event_sink: sink });
  const eventCount = journal.snapshot().events.length;

  await assert.rejects(
    bridge.recordCheckResult(handle, {
      command_display: 'npm test',
      status: 'not_run',
      duration_ms: 0,
      summary: 'No project check was discovered.',
    }),
    BuilderStructuredProgrammingRuntimeBridgeError,
  );
  assert.equal(journal.snapshot().events.length, eventCount);
  await bridge.cancelRun(handle);
});

test('bridge does not gain provider, source, process, renderer, or storage authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-structured-programming-runtime-bridge.cjs'),
    'utf8',
  );
  assert.doesNotMatch(source, /\b(?:fetch|ipcMain|ipcRenderer|contextBridge|BrowserWindow)\b/u);
  assert.doesNotMatch(source, /\b(?:child_process|spawn|execFile|DatabaseSync|node:sqlite)\b/u);
  assert.doesNotMatch(source, /\b(?:readFile|writeFile|source_tree|base_source_tree|absolute_path)\b/u);
  assert.doesNotMatch(source, /api[_-]?key|Bearer|credential_value|secret_store/u);
});
