'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  createBuilderProgrammingRuntimeDescriptor,
  createBuilderProgrammingRuntimeRunContract,
} = require('../electron/builder-programming-runtime-contract.cjs');
const {
  BuilderProgrammingRuntimeEventError,
  createBuilderProgrammingRuntimeEventJournal,
  sanitizeBuilderProgrammingRuntimeEvent,
} = require('../electron/builder-programming-runtime-events.cjs');

const UUID = '12345678-1234-4234-8234-123456789abc';
const STEP_UUID = '22345678-1234-4234-8234-123456789abc';
const TOOL_UUID = '32345678-1234-4234-8234-123456789abc';
const MESSAGE_UUID = '42345678-1234-4234-8234-123456789abc';
const ASSISTANT_UUID = '62345678-1234-4234-8234-123456789abc';
const DIGEST = `sha256:${'a'.repeat(64)}`;

function runContract(mode = 'build') {
  const runtimeDescriptor = createBuilderProgrammingRuntimeDescriptor({
    runtime_kind: 'fake.multi_step',
    implementation_version: '0.1.0-test.1',
    capabilities: {
      streaming_text: true,
      reasoning_status: 'bounded_status',
      native_tool_calls: true,
      steering: 'queued',
      cancellation: 'cooperative',
      session_resume: 'runtime_local',
      context_compaction: true,
      parallel_read_tools: true,
    },
  });
  return createBuilderProgrammingRuntimeRunContract({
    runtime_descriptor: runtimeDescriptor,
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
      message_id: `builder-message:${MESSAGE_UUID}`,
      text: 'Update the timer and run its checks.',
    },
  });
}

function structuredRunContract() {
  const runtimeDescriptor = createBuilderProgrammingRuntimeDescriptor({
    runtime_kind: 'structured_operations.v1',
    implementation_version: '1.0.0',
    capabilities: {
      streaming_text: false,
      reasoning_status: 'none',
      native_tool_calls: false,
      steering: 'none',
      cancellation: 'cooperative',
      session_resume: 'none',
      context_compaction: false,
      parallel_read_tools: false,
    },
  });
  const input = runContract();
  return createBuilderProgrammingRuntimeRunContract({
    runtime_descriptor: runtimeDescriptor,
    admission: {
      ...input.admission,
      allowed_tools: [],
    },
    input: input.input,
  });
}

function candidate(eventType, payload, overrides = {}) {
  return {
    protocol_version: 'builder-programming-runtime.v1',
    runtime_event_ref: overrides.runtime_event_ref ?? `fake:${eventType}:${overrides.index ?? 1}`,
    run_id: `builder-run:${UUID}`,
    occurred_at_ms: overrides.occurred_at_ms ?? 110,
    turn_id: overrides.turn_id ?? null,
    step_id: overrides.step_id ?? null,
    tool_call_id: overrides.tool_call_id ?? null,
    event_type: eventType,
    payload,
  };
}

function appendStart(journal) {
  journal.append(candidate('run_started', { mode: 'build' }), 111);
  journal.append(candidate('turn_started', {
    message_id: `builder-message:${MESSAGE_UUID}`,
  }, {
    runtime_event_ref: 'fake:turn:1',
    turn_id: `builder-turn:${UUID}`,
  }), 112);
  journal.append(candidate('step_started', { step_index: 1 }, {
    runtime_event_ref: 'fake:step:1',
    turn_id: `builder-turn:${UUID}`,
    step_id: `builder-run-step:${STEP_UUID}`,
  }), 113);
}

test('admits native Harness context projection snapshots without a turn or step identity', () => {
  const journal = createBuilderProgrammingRuntimeEventJournal({ run_contract: runContract() });
  journal.append(candidate('run_started', { mode: 'build' }), 111);
  const projected = journal.append(candidate('context_usage_projected', {
    harness_projection_seq: 42,
    uncached_input_tokens: 20_000,
    output_tokens: 5_000,
    cache_read_tokens: 180_000,
    cache_write_tokens: 0,
    pressure_tokens: 200_000,
    projected_tokens: 205_000,
    context_window_tokens: 258_000,
  }), 112);
  assert.equal(projected.event_type, 'context_usage_projected');
  assert.equal(projected.turn_id, null);
  assert.equal(projected.step_id, null);
  assert.equal(projected.payload.cache_read_tokens, 180_000);
  assert.throws(() => journal.append(candidate('context_usage_projected', {
    ...projected.payload,
    projected_tokens: 1,
    pressure_tokens: null,
  }, { runtime_event_ref: 'fake:context:forged' }), 113), (error) => (
    error instanceof BuilderProgrammingRuntimeEventError
    && error.code === 'builder_programming_runtime_event_invalid'
  ));
});

test('commits an immutable chained coding run with append-only assistant text', () => {
  const journal = createBuilderProgrammingRuntimeEventJournal({ run_contract: runContract() });
  appendStart(journal);
  const delta = journal.append(candidate('assistant_text_delta', {
    message_id: `builder-message:${ASSISTANT_UUID}`,
    delta_text: 'Updated the timer. ',
  }, {
    runtime_event_ref: 'fake:text:1',
    turn_id: `builder-turn:${UUID}`,
    step_id: `builder-run-step:${STEP_UUID}`,
  }), 114);
  journal.append(candidate('assistant_text_delta', {
    message_id: `builder-message:${ASSISTANT_UUID}`,
    delta_text: 'The check passes.',
  }, {
    runtime_event_ref: 'fake:text:2',
    turn_id: `builder-turn:${UUID}`,
    step_id: `builder-run-step:${STEP_UUID}`,
  }), 115);
  journal.append(candidate('assistant_text_completed', {
    message_id: `builder-message:${ASSISTANT_UUID}`,
    text_digest: 'sha256:33426623f44f802b721e01806b21a7bdc9662bc99f669f8a3e638c31a315e07c',
    text_bytes: Buffer.byteLength('Updated the timer. The check passes.', 'utf8'),
  }, {
    runtime_event_ref: 'fake:text:completed',
    turn_id: `builder-turn:${UUID}`,
    step_id: `builder-run-step:${STEP_UUID}`,
  }), 116);
  journal.append(candidate('step_completed', { outcome: 'completed' }, {
    runtime_event_ref: 'fake:step:completed',
    turn_id: `builder-turn:${UUID}`,
    step_id: `builder-run-step:${STEP_UUID}`,
  }), 117);
  journal.append(candidate('turn_completed', { outcome: 'completed' }, {
    runtime_event_ref: 'fake:turn:completed',
    turn_id: `builder-turn:${UUID}`,
  }), 118);
  journal.append(candidate('run_completed', {
    outcome: 'built',
    checkpoint_status: 'created',
  }, { runtime_event_ref: 'fake:run:completed' }), 119);

  const snapshot = journal.snapshot();
  assert.equal(snapshot.status, 'run_completed');
  assert.equal(snapshot.events.length, 9);
  assert.equal(snapshot.events[0].sequence, 1);
  assert.equal(snapshot.events[1].previous_event.event_id, snapshot.events[0].event_id);
  assert.deepEqual(sanitizeBuilderProgrammingRuntimeEvent(structuredClone(delta)), delta);
  assert.ok(Object.isFrozen(snapshot.events));
});

test('allows a runtime to discard one uncommitted assistant attempt before retrying', () => {
  const journal = createBuilderProgrammingRuntimeEventJournal({ run_contract: runContract() });
  appendStart(journal);
  const text = 'A failed partial response.';
  journal.append(candidate('assistant_text_delta', {
    message_id: `builder-message:${ASSISTANT_UUID}`,
    delta_text: text,
  }, {
    runtime_event_ref: 'fake:text:failed-attempt',
    turn_id: `builder-turn:${UUID}`,
    step_id: `builder-run-step:${STEP_UUID}`,
  }), 114);
  journal.append(candidate('assistant_text_discarded', {
    message_id: `builder-message:${ASSISTANT_UUID}`,
    text_digest: 'sha256:b84333ad4a8566a3a0072c454c5a352815cd5bbc7393b5048c8a5263abe93dcd',
    text_bytes: Buffer.byteLength(text, 'utf8'),
  }, {
    runtime_event_ref: 'fake:text:discarded-attempt',
    turn_id: `builder-turn:${UUID}`,
    step_id: `builder-run-step:${STEP_UUID}`,
  }), 115);
  journal.append(candidate('assistant_text_delta', {
    message_id: `builder-message:${ASSISTANT_UUID}`,
    delta_text: 'Recovered response.',
  }, {
    runtime_event_ref: 'fake:text:recovered-attempt',
    turn_id: `builder-turn:${UUID}`,
    step_id: `builder-run-step:${STEP_UUID}`,
  }), 116);

  assert.equal(journal.snapshot().events.at(-1).payload.delta_text, 'Recovered response.');
});

test('records edit and command work as separate tool facts', () => {
  const journal = createBuilderProgrammingRuntimeEventJournal({ run_contract: runContract() });
  appendStart(journal);
  const common = {
    turn_id: `builder-turn:${UUID}`,
    step_id: `builder-run-step:${STEP_UUID}`,
    tool_call_id: `builder-tool-call:${TOOL_UUID}`,
  };
  journal.append(candidate('tool_call_started', {
    tool_kind: 'edit',
    active_label: 'Editing src/timer.js',
    completed_label: 'Edited src/timer.js',
    target_label: 'src/timer.js',
    presentation: 'changes',
    argument_digest: DIGEST,
  }, { ...common, runtime_event_ref: 'fake:edit:start' }), 114);
  journal.append(candidate('file_change_recorded', {
    change_ref: `builder-runtime-file-change:${'c'.repeat(64)}`,
    resource_id: 'project:/src/timer.js',
    change_kind: 'edited',
    added_lines: 8,
    deleted_lines: 2,
  }, { ...common, runtime_event_ref: 'fake:edit:change' }), 115);
  journal.append(candidate('tool_call_completed', {
    duration_ms: 12,
    result_kind: 'edit',
    result_ref: `builder-runtime-tool-result:${'d'.repeat(64)}`,
    summary: 'Updated 8 lines and removed 2 lines.',
  }, { ...common, runtime_event_ref: 'fake:edit:end' }), 116);
  assert.equal(
    Object.hasOwn(journal.snapshot().events.at(-1).payload, 'presentation_detail'),
    false,
  );

  const commandToolId = 'builder-tool-call:52345678-1234-4234-8234-123456789abc';
  journal.append(candidate('tool_call_started', {
    tool_kind: 'command',
    active_label: 'Running npm test',
    completed_label: 'Ran npm test',
    target_label: 'npm test',
    presentation: 'terminal',
    argument_digest: DIGEST,
  }, { ...common, tool_call_id: commandToolId, runtime_event_ref: 'fake:command:start' }), 117);
  journal.append(candidate('check_result_recorded', {
    command_ref: `builder-runtime-command-result:${'e'.repeat(64)}`,
    status: 'passed',
    duration_ms: 900,
    summary: 'The project check completed successfully.',
  }, { ...common, tool_call_id: commandToolId, runtime_event_ref: 'fake:command:check' }), 118);
  journal.append(candidate('tool_call_completed', {
    duration_ms: 900,
    result_kind: 'command',
    result_ref: `builder-runtime-tool-result:${'f'.repeat(64)}`,
    summary: 'The project check completed successfully.',
  }, { ...common, tool_call_id: commandToolId, runtime_event_ref: 'fake:command:end' }), 119);

  const unavailableCommandToolId = 'builder-tool-call:72345678-1234-4234-8234-123456789abc';
  journal.append(candidate('tool_call_started', {
    tool_kind: 'command',
    active_label: 'Running npm test',
    completed_label: 'Ran npm test',
    target_label: 'npm test',
    presentation: 'terminal',
    argument_digest: DIGEST,
  }, { ...common, tool_call_id: unavailableCommandToolId, runtime_event_ref: 'fake:command-unavailable:start' }), 120);
  journal.append(candidate('check_result_recorded', {
    command_ref: `builder-runtime-command-result:${'7'.repeat(64)}`,
    status: 'incomplete',
    duration_ms: 120,
    summary: 'The admitted check workspace needs prepared dependencies or local toolchain access before this check can run.',
  }, { ...common, tool_call_id: unavailableCommandToolId, runtime_event_ref: 'fake:command-unavailable:check' }), 121);
  journal.append(candidate('tool_call_failed', {
    duration_ms: 120,
    failure_class: 'environment_unavailable',
    safe_message: 'The admitted check workspace needs prepared dependencies or local toolchain access before this check can run.',
  }, { ...common, tool_call_id: unavailableCommandToolId, runtime_event_ref: 'fake:command-unavailable:end' }), 122);

  const types = journal.snapshot().events.map((event) => event.event_type);
  assert.deepEqual(types.slice(-9), [
    'tool_call_started',
    'file_change_recorded',
    'tool_call_completed',
    'tool_call_started',
    'check_result_recorded',
    'tool_call_completed',
    'tool_call_started',
    'check_result_recorded',
    'tool_call_failed',
  ]);
  assert.equal(journal.snapshot().events.at(-2).payload.status, 'incomplete');
  assert.equal(journal.snapshot().events.at(-1).payload.failure_class, 'environment_unavailable');
});

test('keeps read and search tool presentation details summary-only', () => {
  const journal = createBuilderProgrammingRuntimeEventJournal({ run_contract: runContract() });
  appendStart(journal);
  const common = {
    turn_id: `builder-turn:${UUID}`,
    step_id: `builder-run-step:${STEP_UUID}`,
  };
  journal.append(candidate('tool_call_started', {
    tool_kind: 'read',
    active_label: 'Reading index.html',
    completed_label: 'Read index.html',
    target_label: 'index.html',
    presentation: 'file',
    argument_digest: DIGEST,
  }, {
    ...common,
    tool_call_id: `builder-tool-call:${TOOL_UUID}`,
    runtime_event_ref: 'fake:read:start',
  }), 130);
  const readCompleted = journal.append(candidate('tool_call_completed', {
    duration_ms: 4,
    result_kind: 'read',
    result_ref: `builder-runtime-tool-result:${'1'.repeat(64)}`,
    summary: 'Read index.html.',
    presentation_detail: {
      detail_kind: 'read',
      path: 'index.html',
      offset: 1,
      returned_lines: 120,
      total_lines: 120,
      first_line: 1,
      last_line: 120,
      language_hint: 'html',
    },
  }, {
    ...common,
    tool_call_id: `builder-tool-call:${TOOL_UUID}`,
    runtime_event_ref: 'fake:read:end',
  }), 131);
  assert.equal(Object.hasOwn(readCompleted.payload.presentation_detail, 'content'), false);

  const searchToolId = 'builder-tool-call:82345678-1234-4234-8234-123456789abc';
  journal.append(candidate('tool_call_started', {
    tool_kind: 'search',
    active_label: 'Searching project',
    completed_label: 'Searched project',
    target_label: 'Focus',
    presentation: 'search',
    argument_digest: DIGEST,
  }, {
    ...common,
    tool_call_id: searchToolId,
    runtime_event_ref: 'fake:search:start',
  }), 132);
  const searchCompleted = journal.append(candidate('tool_call_completed', {
    duration_ms: 5,
    result_kind: 'search',
    result_ref: `builder-runtime-tool-result:${'2'.repeat(64)}`,
    summary: 'Found 120 matches.',
    presentation_detail: {
      detail_kind: 'search',
      matches: Array.from({ length: 100 }, (_unused, index) => ({
        path: `src/file-${index}.js`,
        line: index + 1,
        column: 1,
      })),
      truncated: true,
      total: 120,
    },
  }, {
    ...common,
    tool_call_id: searchToolId,
    runtime_event_ref: 'fake:search:end',
  }), 133);
  assert.equal(searchCompleted.payload.presentation_detail.matches.length, 100);
  assert.equal(Object.hasOwn(searchCompleted.payload.presentation_detail.matches[0], 'preview'), false);

  const forgedJournal = createBuilderProgrammingRuntimeEventJournal({ run_contract: runContract() });
  appendStart(forgedJournal);
  const forgedToolId = 'builder-tool-call:92345678-1234-4234-8234-123456789abc';
  forgedJournal.append(candidate('tool_call_started', {
    tool_kind: 'search',
    active_label: 'Searching project',
    completed_label: 'Searched project',
    target_label: 'Focus',
    presentation: 'search',
    argument_digest: DIGEST,
  }, {
    ...common,
    tool_call_id: forgedToolId,
    runtime_event_ref: 'fake:search-forged:start',
  }), 130);
  assert.throws(() => forgedJournal.append(candidate('tool_call_completed', {
    duration_ms: 1,
    result_kind: 'search',
    result_ref: `builder-runtime-tool-result:${'3'.repeat(64)}`,
    summary: 'Forged search detail.',
    presentation_detail: {
      detail_kind: 'search',
      matches: [{
        path: 'src/app.js',
        line: 1,
        column: 1,
        preview: 'raw line text must stay out of task stream',
      }],
      truncated: false,
      total: 1,
    },
  }, {
    ...common,
    tool_call_id: forgedToolId,
    runtime_event_ref: 'fake:search:forged',
  }), 131), BuilderProgrammingRuntimeEventError);
});

test('separates runtime tool requests from verified main-owned structured facts', () => {
  const journal = createBuilderProgrammingRuntimeEventJournal({
    run_contract: structuredRunContract(),
  });
  appendStart(journal);
  const common = {
    runtime_event_ref: 'structured:edit:start',
    turn_id: `builder-turn:${UUID}`,
    step_id: `builder-run-step:${STEP_UUID}`,
    tool_call_id: `builder-tool-call:${TOOL_UUID}`,
  };
  const editStart = candidate('tool_call_started', {
    tool_kind: 'edit',
    active_label: 'Editing src/timer.js',
    completed_label: 'Edited src/timer.js',
    target_label: 'src/timer.js',
    presentation: 'changes',
    argument_digest: DIGEST,
  }, common);

  assert.throws(
    () => journal.append(editStart, 114),
    BuilderProgrammingRuntimeEventError,
  );
  const mainEvent = journal.appendMainFact(editStart, 114);
  assert.equal(mainEvent.event_source, 'main');
  assert.equal(mainEvent.event_type, 'tool_call_started');
});

test('keeps lifecycle and reasoning status within declared runtime capabilities', () => {
  const nativeJournal = createBuilderProgrammingRuntimeEventJournal({
    run_contract: runContract(),
  });
  assert.throws(
    () => nativeJournal.appendMainFact(candidate('run_started', { mode: 'build' }), 111),
    BuilderProgrammingRuntimeEventError,
  );

  const structuredJournal = createBuilderProgrammingRuntimeEventJournal({
    run_contract: structuredRunContract(),
  });
  appendStart(structuredJournal);
  assert.throws(
    () => structuredJournal.append(candidate('assistant_reasoning_status', {
      status: 'Inspecting the project',
    }, {
      runtime_event_ref: 'structured:reasoning:1',
      turn_id: `builder-turn:${UUID}`,
      step_id: `builder-run-step:${STEP_UUID}`,
    }), 114),
    BuilderProgrammingRuntimeEventError,
  );
});

test('rejects malformed canonical run identifiers', () => {
  const journal = createBuilderProgrammingRuntimeEventJournal({ run_contract: runContract() });
  assert.throws(
    () => journal.append({
      ...candidate('run_started', { mode: 'build' }),
      run_id: 'builder-run:------------------------------------',
    }, 111),
    BuilderProgrammingRuntimeEventError,
  );
});

test('makes duplicate runtime delivery idempotent and rejects conflicting reuse', () => {
  const journal = createBuilderProgrammingRuntimeEventJournal({ run_contract: runContract() });
  const started = candidate('run_started', { mode: 'build' });
  const first = journal.append(started, 111);
  const duplicate = journal.append(structuredClone(started), 112);
  assert.equal(duplicate, first);
  assert.equal(journal.snapshot().events.length, 1);

  assert.throws(
    () => journal.append({ ...started, occurred_at_ms: 111 }, 112),
    (error) => error instanceof BuilderProgrammingRuntimeEventError
      && error.code === 'builder_programming_runtime_event_conflict',
  );
});

test('rejects tool settlement before start and step completion with pending tools', () => {
  const journal = createBuilderProgrammingRuntimeEventJournal({ run_contract: runContract() });
  appendStart(journal);
  const common = {
    turn_id: `builder-turn:${UUID}`,
    step_id: `builder-run-step:${STEP_UUID}`,
    tool_call_id: `builder-tool-call:${TOOL_UUID}`,
  };
  assert.throws(
    () => journal.append(candidate('tool_call_completed', {
      duration_ms: 1,
      result_kind: 'edit',
      result_ref: `builder-runtime-tool-result:${'d'.repeat(64)}`,
      summary: 'No start exists.',
    }, common), 114),
    BuilderProgrammingRuntimeEventError,
  );

  journal.append(candidate('tool_call_started', {
    tool_kind: 'edit',
    active_label: 'Editing src/timer.js',
    completed_label: 'Edited src/timer.js',
    target_label: 'src/timer.js',
    presentation: 'changes',
    argument_digest: DIGEST,
  }, { ...common, runtime_event_ref: 'fake:pending:start' }), 115);
  assert.throws(
    () => journal.append(candidate('step_completed', { outcome: 'completed' }, {
      runtime_event_ref: 'fake:early-step-end',
      turn_id: common.turn_id,
      step_id: common.step_id,
    }), 116),
    BuilderProgrammingRuntimeEventError,
  );
});

test('rejects forged assistant completion and events after terminal completion', () => {
  const journal = createBuilderProgrammingRuntimeEventJournal({ run_contract: runContract() });
  appendStart(journal);
  journal.append(candidate('assistant_text_delta', {
    message_id: `builder-message:${ASSISTANT_UUID}`,
    delta_text: 'Real text.',
  }, {
    runtime_event_ref: 'fake:real-text',
    turn_id: `builder-turn:${UUID}`,
    step_id: `builder-run-step:${STEP_UUID}`,
  }), 114);
  assert.throws(
    () => journal.append(candidate('assistant_text_completed', {
      message_id: `builder-message:${ASSISTANT_UUID}`,
      text_digest: DIGEST,
      text_bytes: 10,
    }, {
      runtime_event_ref: 'fake:forged-text-end',
      turn_id: `builder-turn:${UUID}`,
      step_id: `builder-run-step:${STEP_UUID}`,
    }), 115),
    BuilderProgrammingRuntimeEventError,
  );

  journal.append(candidate('run_cancelled', {
    failure_class: 'cancelled',
    safe_message: 'The coding run was cancelled.',
  }, {
    runtime_event_ref: 'fake:cancelled',
    turn_id: `builder-turn:${UUID}`,
  }), 116);
  assert.throws(
    () => journal.append(candidate('assistant_reasoning_status', {
      status: 'Still working',
    }, {
      runtime_event_ref: 'fake:late',
      turn_id: `builder-turn:${UUID}`,
      step_id: `builder-run-step:${STEP_UUID}`,
    }), 117),
    (error) => error instanceof BuilderProgrammingRuntimeEventError
      && error.code === 'builder_programming_runtime_event_closed',
  );
});

test('event module remains a pure main-owned normalizer without execution authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-programming-runtime-events.cjs'),
    'utf8',
  );
  assert.doesNotMatch(source, /\b(?:fetch|ipcMain|ipcRenderer|contextBridge|BrowserWindow)\b/u);
  assert.doesNotMatch(source, /\b(?:child_process|spawn|execFile|DatabaseSync|node:sqlite)\b/u);
  assert.doesNotMatch(source, /\b(?:readFile|writeFile|source_tree|base_source_tree|absolute_path)\b/u);
  assert.doesNotMatch(source, /api[_-]?key|Bearer|credential_value|secret_store/u);
});
