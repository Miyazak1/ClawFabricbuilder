'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const {
  BUILDER_PROGRAMMING_RUNTIME_PROTOCOL_VERSION,
  createBuilderProgrammingRuntimeDescriptor,
  sanitizeBuilderProgrammingRuntimeRunContract,
} = require('./builder-programming-runtime-contract.cjs');

const BUILDER_STRUCTURED_PROGRAMMING_RUNTIME_BRIDGE_VERSION =
  'builder-structured-programming-runtime-bridge.v1';
const START_KEYS = Object.freeze(['run_contract', 'event_sink']);
const SINK_KEYS = Object.freeze(['emit', 'emit_main_fact']);
const HANDLE_KEYS = Object.freeze(['bridge_version', 'run_id', 'runtime_kind']);
const ASSISTANT_KEYS = Object.freeze(['assistant_text']);
const FILE_CHANGE_KEYS = Object.freeze([
  'resource_id',
  'change_kind',
  'added_lines',
  'deleted_lines',
  'duration_ms',
]);
const CHECK_KEYS = Object.freeze(['command_display', 'status', 'duration_ms', 'summary']);
const COMPLETE_KEYS = Object.freeze(['checkpoint_status']);

class BuilderStructuredProgrammingRuntimeBridgeError extends Error {
  constructor(code = 'builder_structured_programming_runtime_bridge_invalid') {
    const selected = [
      'builder_structured_programming_runtime_bridge_invalid',
      'builder_structured_programming_runtime_bridge_conflict',
      'builder_structured_programming_runtime_bridge_closed',
    ].includes(code) ? code : 'builder_structured_programming_runtime_bridge_invalid';
    const messages = {
      builder_structured_programming_runtime_bridge_invalid:
        'The structured programming runtime event could not be verified.',
      builder_structured_programming_runtime_bridge_conflict:
        'The structured programming runtime state changed before it could be recorded.',
      builder_structured_programming_runtime_bridge_closed:
        'The structured programming runtime run is already closed.',
    };
    super(messages[selected]);
    this.name = 'BuilderStructuredProgrammingRuntimeBridgeError';
    this.code = selected;
    this.retryable = false;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) {
  throw new BuilderStructuredProgrammingRuntimeBridgeError(code);
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
    for (const nested of Object.values(value)) freezeDeep(nested);
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

function safeInteger(value, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) fail();
  return value;
}

function safeEnum(value, values) {
  if (typeof value !== 'string' || !values.includes(value)) fail();
  return value;
}

function safeText(value, maximumBytes, allowFormatting = false) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.normalize('NFC') !== value
    || Buffer.byteLength(value, 'utf8') > maximumBytes
    || (!allowFormatting && /[\r\n\t]/u.test(value))
  ) fail();
  return value;
}

function createBuilderStructuredProgrammingRuntimeBridge(options = {}) {
  if (!isPlainObject(options)) fail();
  const optionKeys = Reflect.ownKeys(options);
  if (optionKeys.some((key) => typeof key !== 'string' || key !== 'clock')) fail();
  const clock = options.clock === undefined ? Date.now : options.clock;
  if (typeof clock !== 'function') fail();

  const descriptor = createBuilderProgrammingRuntimeDescriptor({
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
  const active = new Map();
  let disposed = false;

  function checkedHandle(rawHandle) {
    const handle = exactObject(rawHandle, HANDLE_KEYS);
    if (
      valueAt(handle, 'bridge_version') !== BUILDER_STRUCTURED_PROGRAMMING_RUNTIME_BRIDGE_VERSION
      || valueAt(handle, 'runtime_kind') !== descriptor.runtime_kind
      || typeof valueAt(handle, 'run_id') !== 'string'
    ) fail();
    const entry = active.get(valueAt(handle, 'run_id'));
    if (!entry) fail('builder_structured_programming_runtime_bridge_closed');
    return entry;
  }

  async function startRun(rawRequest) {
    if (disposed) fail('builder_structured_programming_runtime_bridge_closed');
    const request = exactObject(rawRequest, START_KEYS);
    const runContract = sanitizeBuilderProgrammingRuntimeRunContract(
      valueAt(request, 'run_contract'),
    );
    if (
      runContract.runtime_descriptor.descriptor_id !== descriptor.descriptor_id
      || runContract.admission.mode !== 'build'
      || runContract.admission.allowed_tools.length !== 0
    ) fail();
    const sink = exactObject(valueAt(request, 'event_sink'), SINK_KEYS);
    const emitRuntime = requiredMethod(sink, 'emit');
    const emitMainFact = requiredMethod(sink, 'emit_main_fact');
    const runId = runContract.admission.run_id;
    if (active.has(runId)) fail('builder_structured_programming_runtime_bridge_conflict');
    const entry = {
      run_contract: runContract,
      emit_runtime: emitRuntime,
      emit_main_fact: emitMainFact,
      event_index: 0,
      tool_index: 0,
      step_id: `builder-run-step:${deterministicUuid(`${runId}:structured-step`)}`,
      assistant_message_id: `builder-message:${deterministicUuid(`${runId}:assistant`)}`,
      assistant_recorded: false,
      file_change_count: 0,
      check_count: 0,
    };
    active.set(runId, entry);

    try {
      await emit(entry, 'runtime', 'run_started', { mode: 'build' });
      await emit(entry, 'runtime', 'turn_started', {
        message_id: runContract.input.message_id,
      }, { turn_id: runContract.admission.turn_id });
      await emit(entry, 'runtime', 'step_started', { step_index: 1 }, {
        turn_id: runContract.admission.turn_id,
        step_id: entry.step_id,
      });
    } catch {
      active.delete(runId);
      fail('builder_structured_programming_runtime_bridge_conflict');
    }
    return freezeDeep({
      bridge_version: BUILDER_STRUCTURED_PROGRAMMING_RUNTIME_BRIDGE_VERSION,
      run_id: runId,
      runtime_kind: descriptor.runtime_kind,
    });
  }

  async function emit(entry, source, eventType, payload, ids = {}) {
    entry.event_index += 1;
    const candidate = freezeDeep({
      protocol_version: BUILDER_PROGRAMMING_RUNTIME_PROTOCOL_VERSION,
      runtime_event_ref: `structured:${entry.event_index}:${eventType}`,
      run_id: entry.run_contract.admission.run_id,
      occurred_at_ms: safeInteger(
        Number(Reflect.apply(clock, undefined, [])),
        0,
        Number.MAX_SAFE_INTEGER,
      ),
      turn_id: ids.turn_id ?? null,
      step_id: ids.step_id ?? null,
      tool_call_id: ids.tool_call_id ?? null,
      event_type: eventType,
      payload,
    });
    const method = source === 'main' ? entry.emit_main_fact : entry.emit_runtime;
    await Promise.resolve(Reflect.apply(method, undefined, [candidate]));
  }

  async function recordAssistantResult(rawHandle, rawResult) {
    const entry = checkedHandle(rawHandle);
    const result = exactObject(rawResult, ASSISTANT_KEYS);
    if (entry.assistant_recorded) fail('builder_structured_programming_runtime_bridge_conflict');
    const text = safeText(valueAt(result, 'assistant_text'), 32 * 1_024, true);
    const ids = {
      turn_id: entry.run_contract.admission.turn_id,
      step_id: entry.step_id,
    };
    await emit(entry, 'runtime', 'assistant_text_delta', {
      message_id: entry.assistant_message_id,
      delta_text: text,
    }, ids);
    await emit(entry, 'runtime', 'assistant_text_completed', {
      message_id: entry.assistant_message_id,
      text_digest: digestText(text),
      text_bytes: Buffer.byteLength(text, 'utf8'),
    }, ids);
    entry.assistant_recorded = true;
  }

  async function recordFileChange(rawHandle, rawFact) {
    const entry = checkedHandle(rawHandle);
    const fact = exactObject(rawFact, FILE_CHANGE_KEYS);
    entry.tool_index += 1;
    const token = `${entry.run_contract.admission.run_id}:file:${entry.tool_index}`;
    const toolCallId = `builder-tool-call:${deterministicUuid(token)}`;
    const resourceId = safeText(valueAt(fact, 'resource_id'), 1_024, false);
    const targetLabel = resourceId.startsWith('project:/')
      ? resourceId.slice('project:/'.length)
      : (() => { fail(); })();
    const changeKind = safeEnum(valueAt(fact, 'change_kind'), ['added', 'edited', 'deleted']);
    const durationMs = safeInteger(valueAt(fact, 'duration_ms'), 0, 60 * 60 * 1_000);
    const ids = {
      turn_id: entry.run_contract.admission.turn_id,
      step_id: entry.step_id,
      tool_call_id: toolCallId,
    };
    const pastTense = { added: 'Added', edited: 'Edited', deleted: 'Deleted' }[changeKind];
    await emit(entry, 'main', 'tool_call_started', {
      tool_kind: changeKind === 'added' ? 'write' : 'edit',
      active_label: `${changeKind === 'added' ? 'Adding' : 'Editing'} ${targetLabel}`,
      completed_label: `${pastTense} ${targetLabel}`,
      target_label: targetLabel,
      presentation: 'changes',
      argument_digest: digestText(token),
    }, ids);
    await emit(entry, 'main', 'file_change_recorded', {
      change_ref: digestRef('builder-runtime-file-change', token),
      resource_id: resourceId,
      change_kind: changeKind,
      added_lines: safeInteger(valueAt(fact, 'added_lines'), 0, 1_000_000),
      deleted_lines: safeInteger(valueAt(fact, 'deleted_lines'), 0, 1_000_000),
    }, ids);
    await emit(entry, 'main', 'tool_call_completed', {
      duration_ms: durationMs,
      result_kind: changeKind === 'added' ? 'write' : 'edit',
      result_ref: digestRef('builder-runtime-tool-result', token),
      summary: `${pastTense} ${targetLabel}.`,
    }, ids);
    entry.file_change_count += 1;
  }

  async function recordCheckResult(rawHandle, rawFact) {
    const entry = checkedHandle(rawHandle);
    const fact = exactObject(rawFact, CHECK_KEYS);
    entry.tool_index += 1;
    const token = `${entry.run_contract.admission.run_id}:check:${entry.tool_index}`;
    const toolCallId = `builder-tool-call:${deterministicUuid(token)}`;
    const commandDisplay = safeText(valueAt(fact, 'command_display'), 512, false);
    const status = safeEnum(valueAt(fact, 'status'), ['passed', 'failed', 'incomplete']);
    const durationMs = safeInteger(valueAt(fact, 'duration_ms'), 0, 60 * 60 * 1_000);
    const summary = safeText(valueAt(fact, 'summary'), 1_440, false);
    const ids = {
      turn_id: entry.run_contract.admission.turn_id,
      step_id: entry.step_id,
      tool_call_id: toolCallId,
    };
    await emit(entry, 'main', 'tool_call_started', {
      tool_kind: 'command',
      active_label: `Running ${commandDisplay}`,
      completed_label: `Ran ${commandDisplay}`,
      target_label: commandDisplay,
      presentation: 'terminal',
      argument_digest: digestText(token),
    }, ids);
    await emit(entry, 'main', 'check_result_recorded', {
      command_ref: digestRef('builder-runtime-command-result', token),
      status,
      duration_ms: durationMs,
      summary,
    }, ids);
    if (status !== 'passed') {
      await emit(entry, 'main', 'tool_call_failed', {
        duration_ms: durationMs,
        failure_class: status === 'incomplete' ? 'environment_unavailable' : 'check_failed',
        safe_message: summary,
      }, ids);
    } else {
      await emit(entry, 'main', 'tool_call_completed', {
        duration_ms: durationMs,
        result_kind: 'command',
        result_ref: digestRef('builder-runtime-tool-result', token),
        summary,
      }, ids);
    }
    entry.check_count += 1;
  }

  async function completeRun(rawHandle, rawCompletion) {
    const entry = checkedHandle(rawHandle);
    const completion = exactObject(rawCompletion, COMPLETE_KEYS);
    const checkpointStatus = safeEnum(
      valueAt(completion, 'checkpoint_status'),
      ['created', 'updated'],
    );
    if (!entry.assistant_recorded || entry.file_change_count < 1) {
      fail('builder_structured_programming_runtime_bridge_conflict');
    }
    const turnId = entry.run_contract.admission.turn_id;
    await emit(entry, 'main', 'step_completed', { outcome: 'completed' }, {
      turn_id: turnId,
      step_id: entry.step_id,
    });
    await emit(entry, 'main', 'turn_completed', { outcome: 'completed' }, {
      turn_id: turnId,
    });
    await emit(entry, 'main', 'run_completed', {
      outcome: 'built',
      checkpoint_status: checkpointStatus,
    });
    active.delete(entry.run_contract.admission.run_id);
    return freezeDeep({
      bridge_version: BUILDER_STRUCTURED_PROGRAMMING_RUNTIME_BRIDGE_VERSION,
      run_id: entry.run_contract.admission.run_id,
      status: 'completed',
      file_change_count: entry.file_change_count,
      check_count: entry.check_count,
      checkpoint_status: checkpointStatus,
    });
  }

  async function cancelRun(rawHandle) {
    const entry = checkedHandle(rawHandle);
    await emit(entry, 'main', 'run_cancelled', {
      failure_class: 'cancelled',
      safe_message: 'The structured coding run was cancelled.',
    }, { turn_id: entry.run_contract.admission.turn_id });
    active.delete(entry.run_contract.admission.run_id);
    return freezeDeep({
      bridge_version: BUILDER_STRUCTURED_PROGRAMMING_RUNTIME_BRIDGE_VERSION,
      run_id: entry.run_contract.admission.run_id,
      status: 'cancelled',
    });
  }

  async function dispose() {
    disposed = true;
    active.clear();
  }

  return freezeDeep({
    bridge_version: BUILDER_STRUCTURED_PROGRAMMING_RUNTIME_BRIDGE_VERSION,
    descriptor,
    startRun,
    recordAssistantResult,
    recordFileChange,
    recordCheckResult,
    completeRun,
    cancelRun,
    dispose,
  });
}

module.exports = Object.freeze({
  BUILDER_STRUCTURED_PROGRAMMING_RUNTIME_BRIDGE_VERSION,
  BuilderStructuredProgrammingRuntimeBridgeError,
  createBuilderStructuredProgrammingRuntimeBridge,
});
