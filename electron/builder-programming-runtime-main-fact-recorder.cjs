'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const {
  BUILDER_PROGRAMMING_RUNTIME_PROTOCOL_VERSION,
  sanitizeBuilderProgrammingRuntimeRunContract,
} = require('./builder-programming-runtime-contract.cjs');

const BUILDER_PROGRAMMING_RUNTIME_MAIN_FACT_RECORDER_VERSION =
  'builder-programming-runtime-main-fact-recorder.v1';
const CREATE_KEYS = Object.freeze(['run_contract', 'append_main_fact', 'clock']);
const CHECK_KEYS = Object.freeze([
  'verification_step_id', 'command_display', 'status', 'duration_ms', 'summary',
]);
const STEP_ID_PATTERN = /^builder-run-step:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

class BuilderProgrammingRuntimeMainFactRecorderError extends Error {
  constructor() {
    super('The Builder runtime fact could not be recorded.');
    this.name = 'BuilderProgrammingRuntimeMainFactRecorderError';
    this.code = 'builder_programming_runtime_main_fact_invalid';
    this.retryable = false;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() { throw new BuilderProgrammingRuntimeMainFactRecorderError(); }

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || utilTypes.isProxy(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactObject(value, keys) {
  if (!isPlainObject(value)) fail();
  const actual = Reflect.ownKeys(value);
  if (actual.length !== keys.length || actual.some((key) => typeof key !== 'string' || !keys.includes(key))) {
    fail();
  }
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

function safeText(value, maximum, formatting = false) {
  if (
    typeof value !== 'string' || value.length === 0 || value.trim() !== value
    || value.normalize('NFC') !== value || Buffer.byteLength(value, 'utf8') > maximum
    || /[\p{Cf}\p{Bidi_Control}]/u.test(value)
    || (!formatting && /[\r\n\t]/u.test(value))
  ) fail();
  return value;
}

function sha256(value) {
  return `sha256:${nodeCrypto.createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

function deterministicUuid(value) {
  const bytes = nodeCrypto.createHash('sha256').update(value, 'utf8').digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function createBuilderProgrammingRuntimeMainFactRecorder(rawOptions) {
  const options = exactObject(rawOptions, CREATE_KEYS);
  const runContract = sanitizeBuilderProgrammingRuntimeRunContract(valueAt(options, 'run_contract'));
  const appendMainFact = valueAt(options, 'append_main_fact');
  const clock = valueAt(options, 'clock');
  if (
    typeof appendMainFact !== 'function' || utilTypes.isProxy(appendMainFact)
    || typeof clock !== 'function' || utilTypes.isProxy(clock)
  ) fail();
  let checkIndex = 0;

  async function emit(type, payload, stepId, toolCallId, refSuffix) {
    const occurredAtMs = Number(Reflect.apply(clock, undefined, []));
    if (!Number.isSafeInteger(occurredAtMs) || occurredAtMs < 0) fail();
    return await Promise.resolve(Reflect.apply(appendMainFact, undefined, [Object.freeze({
      protocol_version: BUILDER_PROGRAMMING_RUNTIME_PROTOCOL_VERSION,
      runtime_event_ref: `builder.main.${refSuffix}`,
      run_id: runContract.admission.run_id,
      occurred_at_ms: occurredAtMs,
      turn_id: runContract.admission.turn_id,
      step_id: stepId,
      tool_call_id: toolCallId,
      event_type: type,
      payload,
    })]));
  }

  async function recordCheck(rawFact) {
    const fact = exactObject(rawFact, CHECK_KEYS);
    const stepId = valueAt(fact, 'verification_step_id');
    const commandDisplay = safeText(valueAt(fact, 'command_display'), 512);
    const status = valueAt(fact, 'status');
    const durationMs = valueAt(fact, 'duration_ms');
    const summary = safeText(valueAt(fact, 'summary'), 1_440, true);
    if (
      typeof stepId !== 'string' || !STEP_ID_PATTERN.test(stepId)
      || !['passed', 'failed', 'incomplete'].includes(status)
      || !Number.isSafeInteger(durationMs) || durationMs < 0 || durationMs > 60 * 60 * 1_000
    ) fail();
    checkIndex += 1;
    const token = `${runContract.admission.run_id}:main-check:${checkIndex}:${commandDisplay}`;
    const toolCallId = `builder-tool-call:${deterministicUuid(token)}`;
    await emit('tool_call_started', {
      tool_kind: 'command',
      active_label: `Running ${commandDisplay}`,
      completed_label: `Ran ${commandDisplay}`,
      target_label: commandDisplay,
      presentation: 'terminal',
      argument_digest: sha256(commandDisplay),
    }, stepId, toolCallId, `check.${checkIndex}.started`);
    await emit('check_result_recorded', {
      command_ref: `builder-runtime-command-result:${sha256(`${token}:result`).slice('sha256:'.length)}`,
      status,
      duration_ms: durationMs,
      summary,
    }, stepId, toolCallId, `check.${checkIndex}.result`);
    await emit(status === 'passed' ? 'tool_call_completed' : 'tool_call_failed', status === 'passed'
      ? {
        duration_ms: durationMs,
        result_kind: 'command',
        result_ref: `builder-runtime-tool-result:${sha256(`${token}:tool`).slice('sha256:'.length)}`,
        summary,
      }
      : {
        duration_ms: durationMs,
        failure_class: status === 'incomplete' ? 'environment_unavailable' : 'check_failed',
        safe_message: summary,
      }, stepId, toolCallId, `check.${checkIndex}.${status}`);
    return Object.freeze({
      recorder_version: BUILDER_PROGRAMMING_RUNTIME_MAIN_FACT_RECORDER_VERSION,
      tool_call_id: toolCallId,
      status,
    });
  }

  return Object.freeze({
    recorder_version: BUILDER_PROGRAMMING_RUNTIME_MAIN_FACT_RECORDER_VERSION,
    record_check: recordCheck,
  });
}

module.exports = Object.freeze({
  BUILDER_PROGRAMMING_RUNTIME_MAIN_FACT_RECORDER_VERSION,
  BuilderProgrammingRuntimeMainFactRecorderError,
  createBuilderProgrammingRuntimeMainFactRecorder,
});
