'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const {
  BUILDER_PROGRAMMING_RUNTIME_PROTOCOL_VERSION,
  createBuilderProgrammingRuntimeDescriptor,
  sanitizeBuilderProgrammingRuntimeRunContract,
} = require('./builder-programming-runtime-contract.cjs');

const BUILDER_FAKE_PROGRAMMING_RUNTIME_VERSION =
  'builder-fake-programming-runtime.v1';
const START_KEYS = Object.freeze(['run_contract', 'event_sink']);
const SINK_KEYS = Object.freeze(['emit']);
const CANCEL_REASONS = Object.freeze(['user_requested', 'superseded', 'shutdown']);

class BuilderFakeProgrammingRuntimeError extends Error {
  constructor(code = 'builder_fake_programming_runtime_invalid') {
    const selected = [
      'builder_fake_programming_runtime_invalid',
      'builder_fake_programming_runtime_conflict',
      'builder_fake_programming_runtime_closed',
    ].includes(code) ? code : 'builder_fake_programming_runtime_invalid';
    const messages = {
      builder_fake_programming_runtime_invalid: 'The fake programming runtime request is invalid.',
      builder_fake_programming_runtime_conflict: 'The fake programming runtime is already active.',
      builder_fake_programming_runtime_closed: 'The fake programming runtime is closed.',
    };
    super(messages[selected]);
    this.name = 'BuilderFakeProgrammingRuntimeError';
    this.code = selected;
    this.retryable = false;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) {
  throw new BuilderFakeProgrammingRuntimeError(code);
}

function isPlainObject(value) {
  if (
    value === null
    || typeof value !== 'object'
    || Array.isArray(value)
    || utilTypes.isProxy(value)
  ) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactObject(value, keys) {
  if (!isPlainObject(value)) fail();
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== keys.length
    || actual.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) fail();
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  }
  return value;
}

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  return descriptor.value;
}

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) {
      if (!(nested instanceof Promise)) freezeDeep(nested);
    }
    Object.freeze(value);
  }
  return value;
}

function requiredMethod(value, name) {
  if (value === null || typeof value !== 'object' || utilTypes.isProxy(value)) fail();
  const descriptor = Object.getOwnPropertyDescriptor(value, name);
  if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') {
    fail();
  }
  return descriptor.value.bind(value);
}

function deterministicUuid(value) {
  const bytes = nodeCrypto.createHash('sha256').update(value, 'utf8').digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function digestText(value) {
  return `sha256:${nodeCrypto.createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

function digestRef(prefix, value) {
  return `${prefix}:${digestText(value).slice('sha256:'.length)}`;
}

function createBuilderFakeProgrammingRuntime(options = {}) {
  if (!isPlainObject(options)) fail();
  const optionKeys = Reflect.ownKeys(options);
  if (optionKeys.some((key) => typeof key !== 'string' || !['clock'].includes(key))) fail();
  const clock = options.clock === undefined ? Date.now : options.clock;
  if (typeof clock !== 'function') fail();

  const descriptor = createBuilderProgrammingRuntimeDescriptor({
    runtime_kind: 'fake.multi_step',
    implementation_version: '1.0.0',
    capabilities: {
      streaming_text: true,
      reasoning_status: 'bounded_status',
      native_tool_calls: true,
      steering: 'queued',
      cancellation: 'cooperative',
      session_resume: 'none',
      context_compaction: false,
      parallel_read_tools: false,
    },
  });
  const inFlight = new Map();
  let disposed = false;

  async function startRun(rawRequest) {
    if (disposed) fail('builder_fake_programming_runtime_closed');
    const request = exactObject(rawRequest, START_KEYS);
    const runContract = sanitizeBuilderProgrammingRuntimeRunContract(
      valueAt(request, 'run_contract'),
    );
    if (runContract.runtime_descriptor.descriptor_id !== descriptor.descriptor_id) fail();
    const sink = exactObject(valueAt(request, 'event_sink'), SINK_KEYS);
    const emitToSink = requiredMethod(sink, 'emit');
    const runId = runContract.admission.run_id;
    if (inFlight.has(runId)) fail('builder_fake_programming_runtime_conflict');

    const entry = {
      cancelled: false,
      cancel_reason: null,
      event_index: 0,
      active_tool: null,
      completion: null,
    };
    inFlight.set(runId, entry);

    function nextRef(label) {
      entry.event_index += 1;
      return `fake:${entry.event_index}:${label}`;
    }

    async function emit(eventType, payload, ids = {}) {
      const event = freezeDeep({
        protocol_version: BUILDER_PROGRAMMING_RUNTIME_PROTOCOL_VERSION,
        runtime_event_ref: nextRef(eventType),
        run_id: runId,
        occurred_at_ms: Number(Reflect.apply(clock, undefined, [])),
        turn_id: ids.turn_id ?? null,
        step_id: ids.step_id ?? null,
        tool_call_id: ids.tool_call_id ?? null,
        event_type: eventType,
        payload,
      });
      await Promise.resolve(Reflect.apply(emitToSink, undefined, [event]));
      if (eventType === 'tool_call_started') {
        entry.active_tool = {
          turn_id: event.turn_id,
          step_id: event.step_id,
          tool_call_id: event.tool_call_id,
        };
      }
      if (eventType === 'tool_call_completed' || eventType === 'tool_call_failed') {
        entry.active_tool = null;
      }
    }

    async function settleCancellation(turnId = null) {
      if (entry.active_tool !== null) {
        await emit('tool_call_failed', {
          duration_ms: 0,
          failure_class: 'cancelled',
          safe_message: 'The active tool was cancelled.',
        }, entry.active_tool);
      }
      await emit('run_cancelled', {
        failure_class: 'cancelled',
        safe_message: 'The coding run was cancelled.',
      }, { turn_id: turnId });
      return freezeDeep({
        runtime_version: BUILDER_FAKE_PROGRAMMING_RUNTIME_VERSION,
        run_id: runId,
        status: 'cancelled',
        cancel_reason: entry.cancel_reason,
        emitted_event_count: entry.event_index,
      });
    }

    async function emitChecked(eventType, payload, ids = {}) {
      if (entry.cancelled) return false;
      await emit(eventType, payload, ids);
      return !entry.cancelled;
    }

    async function runBuild() {
      const turnId = runContract.admission.turn_id;
      const inputMessageId = runContract.input.message_id;
      const assistantMessageId = `builder-message:${deterministicUuid(`${runId}:assistant`)}`;
      const stepIds = [1, 2, 3].map(
        (index) => `builder-run-step:${deterministicUuid(`${runId}:step:${index}`)}`,
      );
      const toolId = (label) => `builder-tool-call:${deterministicUuid(`${runId}:tool:${label}`)}`;
      const ids = (stepIndex, toolLabel = null) => ({
        turn_id: turnId,
        step_id: stepIds[stepIndex - 1],
        ...(toolLabel === null ? {} : { tool_call_id: toolId(toolLabel) }),
      });

      if (!await emitChecked('run_started', { mode: 'build' })) return settleCancellation();
      if (!await emitChecked('turn_started', { message_id: inputMessageId }, { turn_id: turnId })) {
        return settleCancellation(turnId);
      }
      if (!await emitChecked('step_started', { step_index: 1 }, ids(1))) {
        return settleCancellation(turnId);
      }
      if (!await emitChecked('assistant_reasoning_status', {
        status: 'Reading the project',
      }, ids(1))) return settleCancellation(turnId);
      if (!await emitChecked('tool_call_started', {
        tool_kind: 'read',
        active_label: 'Reading src/timer.js',
        completed_label: 'Read src/timer.js',
        target_label: 'src/timer.js',
        presentation: 'file',
        argument_digest: digestText(`${runId}:read`),
      }, ids(1, 'read'))) return settleCancellation(turnId);
      if (!await emitChecked('tool_call_completed', {
        duration_ms: 8,
        result_kind: 'read',
        result_ref: digestRef('builder-runtime-tool-result', `${runId}:read`),
        summary: 'Read the current timer implementation.',
      }, ids(1, 'read'))) return settleCancellation(turnId);
      if (!await emitChecked('step_completed', { outcome: 'completed' }, ids(1))) {
        return settleCancellation(turnId);
      }

      if (!await emitChecked('step_started', { step_index: 2 }, ids(2))) {
        return settleCancellation(turnId);
      }
      if (!await emitChecked('tool_call_started', {
        tool_kind: 'edit',
        active_label: 'Editing src/timer.js',
        completed_label: 'Edited src/timer.js',
        target_label: 'src/timer.js',
        presentation: 'changes',
        argument_digest: digestText(`${runId}:edit:first`),
      }, ids(2, 'edit:first'))) return settleCancellation(turnId);
      if (!await emitChecked('file_change_recorded', {
        change_ref: digestRef('builder-runtime-file-change', `${runId}:change:first`),
        resource_id: 'project:/src/timer.js',
        change_kind: 'edited',
        added_lines: 8,
        deleted_lines: 2,
      }, ids(2, 'edit:first'))) return settleCancellation(turnId);
      if (!await emitChecked('tool_call_completed', {
        duration_ms: 12,
        result_kind: 'edit',
        result_ref: digestRef('builder-runtime-tool-result', `${runId}:edit:first`),
        summary: 'Updated the timer behavior.',
      }, ids(2, 'edit:first'))) return settleCancellation(turnId);
      if (!await emitChecked('tool_call_started', {
        tool_kind: 'command',
        active_label: 'Running npm test',
        completed_label: 'Ran npm test',
        target_label: 'npm test',
        presentation: 'terminal',
        argument_digest: digestText(`${runId}:command:first`),
      }, ids(2, 'command:first'))) return settleCancellation(turnId);
      if (!await emitChecked('check_result_recorded', {
        command_ref: digestRef('builder-runtime-command-result', `${runId}:command:first`),
        status: 'failed',
        duration_ms: 850,
        summary: 'The timer assertion failed.',
      }, ids(2, 'command:first'))) return settleCancellation(turnId);
      if (!await emitChecked('tool_call_failed', {
        duration_ms: 850,
        failure_class: 'check_failed',
        safe_message: 'The timer assertion failed.',
      }, ids(2, 'command:first'))) return settleCancellation(turnId);
      if (!await emitChecked('step_completed', { outcome: 'failed' }, ids(2))) {
        return settleCancellation(turnId);
      }

      if (!await emitChecked('step_started', { step_index: 3 }, ids(3))) {
        return settleCancellation(turnId);
      }
      if (!await emitChecked('assistant_reasoning_status', {
        status: 'Repairing the failed check',
      }, ids(3))) return settleCancellation(turnId);
      if (!await emitChecked('tool_call_started', {
        tool_kind: 'edit',
        active_label: 'Editing src/timer.js',
        completed_label: 'Edited src/timer.js',
        target_label: 'src/timer.js',
        presentation: 'changes',
        argument_digest: digestText(`${runId}:edit:repair`),
      }, ids(3, 'edit:repair'))) return settleCancellation(turnId);
      if (!await emitChecked('file_change_recorded', {
        change_ref: digestRef('builder-runtime-file-change', `${runId}:change:repair`),
        resource_id: 'project:/src/timer.js',
        change_kind: 'edited',
        added_lines: 2,
        deleted_lines: 1,
      }, ids(3, 'edit:repair'))) return settleCancellation(turnId);
      if (!await emitChecked('tool_call_completed', {
        duration_ms: 6,
        result_kind: 'edit',
        result_ref: digestRef('builder-runtime-tool-result', `${runId}:edit:repair`),
        summary: 'Corrected the timer assertion behavior.',
      }, ids(3, 'edit:repair'))) return settleCancellation(turnId);
      if (!await emitChecked('tool_call_started', {
        tool_kind: 'command',
        active_label: 'Running npm test',
        completed_label: 'Ran npm test',
        target_label: 'npm test',
        presentation: 'terminal',
        argument_digest: digestText(`${runId}:command:repair`),
      }, ids(3, 'command:repair'))) return settleCancellation(turnId);
      if (!await emitChecked('check_result_recorded', {
        command_ref: digestRef('builder-runtime-command-result', `${runId}:command:repair`),
        status: 'passed',
        duration_ms: 780,
        summary: 'The project check completed successfully.',
      }, ids(3, 'command:repair'))) return settleCancellation(turnId);
      if (!await emitChecked('tool_call_completed', {
        duration_ms: 780,
        result_kind: 'command',
        result_ref: digestRef('builder-runtime-tool-result', `${runId}:command:repair`),
        summary: 'The project check completed successfully.',
      }, ids(3, 'command:repair'))) return settleCancellation(turnId);

      const finalText = 'Updated the timer and repaired the failing check. The project check now passes.';
      if (!await emitChecked('assistant_text_delta', {
        message_id: assistantMessageId,
        delta_text: 'Updated the timer and repaired the failing check. ',
      }, ids(3))) return settleCancellation(turnId);
      if (!await emitChecked('assistant_text_delta', {
        message_id: assistantMessageId,
        delta_text: 'The project check now passes.',
      }, ids(3))) return settleCancellation(turnId);
      if (!await emitChecked('assistant_text_completed', {
        message_id: assistantMessageId,
        text_digest: digestText(finalText),
        text_bytes: Buffer.byteLength(finalText, 'utf8'),
      }, ids(3))) return settleCancellation(turnId);
      if (!await emitChecked('step_completed', { outcome: 'completed' }, ids(3))) {
        return settleCancellation(turnId);
      }
      if (!await emitChecked('turn_completed', { outcome: 'completed' }, { turn_id: turnId })) {
        return settleCancellation(turnId);
      }
      if (!await emitChecked('run_completed', {
        outcome: 'built',
        checkpoint_status: 'created',
      })) return settleCancellation();
      return freezeDeep({
        runtime_version: BUILDER_FAKE_PROGRAMMING_RUNTIME_VERSION,
        run_id: runId,
        status: 'completed',
        cancel_reason: null,
        emitted_event_count: entry.event_index,
      });
    }

    async function runReadOnly() {
      const turnId = runContract.admission.turn_id;
      const inputMessageId = runContract.input.message_id;
      const assistantMessageId = `builder-message:${deterministicUuid(`${runId}:assistant`)}`;
      const stepId = `builder-run-step:${deterministicUuid(`${runId}:step:1`)}`;
      const common = { turn_id: turnId, step_id: stepId };
      const mode = runContract.admission.mode;
      const text = mode === 'plan'
        ? '## Implementation plan\n\n1. Read the current timer.\n2. Update its behavior.\n3. Run the project check.'
        : 'The current project contains a timer implementation and a project check.';
      if (!await emitChecked('run_started', { mode })) return settleCancellation();
      if (!await emitChecked('turn_started', { message_id: inputMessageId }, { turn_id: turnId })) {
        return settleCancellation(turnId);
      }
      if (!await emitChecked('step_started', { step_index: 1 }, common)) {
        return settleCancellation(turnId);
      }
      if (!await emitChecked('assistant_text_delta', {
        message_id: assistantMessageId,
        delta_text: text,
      }, common)) return settleCancellation(turnId);
      if (!await emitChecked('assistant_text_completed', {
        message_id: assistantMessageId,
        text_digest: digestText(text),
        text_bytes: Buffer.byteLength(text, 'utf8'),
      }, common)) return settleCancellation(turnId);
      if (!await emitChecked('step_completed', { outcome: 'completed' }, common)) {
        return settleCancellation(turnId);
      }
      if (!await emitChecked('turn_completed', { outcome: 'completed' }, { turn_id: turnId })) {
        return settleCancellation(turnId);
      }
      const outcome = mode === 'plan' ? 'planned' : 'answered';
      if (!await emitChecked('run_completed', {
        outcome,
        checkpoint_status: 'not_applicable',
      })) return settleCancellation();
      return freezeDeep({
        runtime_version: BUILDER_FAKE_PROGRAMMING_RUNTIME_VERSION,
        run_id: runId,
        status: 'completed',
        cancel_reason: null,
        emitted_event_count: entry.event_index,
      });
    }

    entry.completion = (runContract.admission.mode === 'build' ? runBuild() : runReadOnly())
      .finally(() => {
        if (inFlight.get(runId) === entry) inFlight.delete(runId);
      });
    return freezeDeep({
      runtime_version: BUILDER_FAKE_PROGRAMMING_RUNTIME_VERSION,
      run_id: runId,
      runtime_kind: descriptor.runtime_kind,
      completion: entry.completion,
    });
  }

  function cancelRun(rawHandle, rawReason) {
    if (disposed) fail('builder_fake_programming_runtime_closed');
    const handle = exactObject(rawHandle, [
      'runtime_version',
      'run_id',
      'runtime_kind',
      'completion',
    ]);
    if (
      valueAt(handle, 'runtime_version') !== BUILDER_FAKE_PROGRAMMING_RUNTIME_VERSION
      || valueAt(handle, 'runtime_kind') !== descriptor.runtime_kind
      || !(valueAt(handle, 'completion') instanceof Promise)
      || typeof rawReason !== 'string'
      || !CANCEL_REASONS.includes(rawReason)
    ) fail();
    const runId = valueAt(handle, 'run_id');
    const entry = inFlight.get(runId);
    if (!entry) return freezeDeep({ run_id: runId, cancellation_requested: false });
    entry.cancelled = true;
    entry.cancel_reason = rawReason;
    return freezeDeep({ run_id: runId, cancellation_requested: true });
  }

  async function dispose() {
    if (disposed) return;
    disposed = true;
    const completions = [];
    for (const entry of inFlight.values()) {
      entry.cancelled = true;
      entry.cancel_reason = 'shutdown';
      if (entry.completion) completions.push(entry.completion.catch(() => undefined));
    }
    await Promise.all(completions);
  }

  return freezeDeep({
    runtime_version: BUILDER_FAKE_PROGRAMMING_RUNTIME_VERSION,
    descriptor,
    startRun,
    cancelRun,
    dispose,
  });
}

module.exports = Object.freeze({
  BUILDER_FAKE_PROGRAMMING_RUNTIME_VERSION,
  BuilderFakeProgrammingRuntimeError,
  createBuilderFakeProgrammingRuntime,
});
