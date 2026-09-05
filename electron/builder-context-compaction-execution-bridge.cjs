'use strict';

const { types: utilTypes } = require('node:util');

const {
  sanitizeBuilderContextCompactionAdmissionRecord,
} = require('./builder-context-compaction-admission.cjs');

const BUILDER_CONTEXT_COMPACTION_EXECUTION_BRIDGE_VERSION =
  'builder-context-compaction-execution-bridge.v1';
const BUILDER_CONTEXT_COMPACTION_EXECUTION_RESULT_VERSION =
  'builder-context-compaction-execution-result.v1';
const CREATE_KEYS = Object.freeze(['harness_runtime']);
const EXECUTE_KEYS = Object.freeze([
  'session_id',
  'context_compaction_admission',
  'conversation_compaction_projection',
  'abort_signal',
]);
const RESULT_KEYS = Object.freeze([
  'result_version',
  'operation',
  'status',
  'admission_id',
  'conversation_compaction_projection_digest',
  'compaction_id',
  'start_seq',
  'summary_seq',
  'end_seq',
  'shadowed_token_count',
  'authority',
]);
const AUTHORITY_KEYS = Object.freeze([
  'bridge_authority',
  'admission_authority',
  'harness_authority',
  'renderer_authority',
  'ipc_authority',
  'provider_dispatch',
  'tool_dispatch',
  'source_write',
  'sqlite_write',
  'permission_grant_authority',
  'revision_authority',
  'summary_materialization',
]);
const AUTHORITY = Object.freeze({
  bridge_authority: 'main_context_compaction_execution_bridge_v1',
  admission_authority: 'verified_main_context_compaction_admission_contract_v1',
  harness_authority: 'manual_compactNow_invoked_after_admission',
  renderer_authority: 'not_present',
  ipc_authority: 'not_present',
  provider_dispatch: 'harness_owned_compaction_only',
  tool_dispatch: 'not_performed_by_bridge',
  source_write: 'not_performed_by_bridge',
  sqlite_write: 'not_performed_by_bridge',
  permission_grant_authority: 'not_present',
  revision_authority: 'not_present',
  summary_materialization: 'not_performed_by_bridge',
});
const ADMISSION_ID_PATTERN = /^builder-context-compaction-admission:[0-9a-f]{64}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const COMPACTION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,239}$/u;
const SESSION_ID_PATTERN = /^builder-harness-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

class BuilderContextCompactionExecutionBridgeError extends Error {
  constructor(code = 'builder_context_compaction_execution_bridge_invalid') {
    const selected = [
      'builder_context_compaction_execution_bridge_invalid',
      'builder_context_compaction_execution_bridge_unavailable',
      'builder_context_compaction_execution_bridge_failed',
    ].includes(code) ? code : 'builder_context_compaction_execution_bridge_invalid';
    const messages = {
      builder_context_compaction_execution_bridge_invalid:
        'Builder context compaction execution could not be verified.',
      builder_context_compaction_execution_bridge_unavailable:
        'Builder context compaction execution is unavailable.',
      builder_context_compaction_execution_bridge_failed:
        'Builder context compaction execution failed.',
    };
    super(messages[selected]);
    this.name = 'BuilderContextCompactionExecutionBridgeError';
    this.code = selected;
    this.retryable = selected === 'builder_context_compaction_execution_bridge_unavailable';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code = 'builder_context_compaction_execution_bridge_invalid') {
  throw new BuilderContextCompactionExecutionBridgeError(code);
}

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freezeDeep(nested);
    Object.freeze(value);
  }
  return value;
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
  for (const key of actual) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  }
}

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  return descriptor.value;
}

function method(value, key) {
  if (!isPlainObject(value)) fail();
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') fail();
  return descriptor.value;
}

function safePattern(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) fail();
  return value;
}

function safeSeq(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 10_000_000) fail();
  return value;
}

function safeCount(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 1_000_000_000) fail();
  return value;
}

function safeAbortSignal(value) {
  if (value === null) return null;
  if (typeof value !== 'object' || utilTypes.isProxy(value)) fail();
  let aborted;
  try {
    aborted = value.aborted;
  } catch {
    fail();
  }
  if (typeof aborted !== 'boolean') fail();
  return value;
}

function sanitizeRuntimeCompactionResult(value, admission) {
  if (value === null) {
    return freezeDeep({
      operation: 'manual_compaction_noop',
      status: 'compaction_not_needed',
      compaction_id: null,
      start_seq: null,
      summary_seq: null,
      end_seq: null,
      shadowed_token_count: null,
    });
  }
  exactObject(value, [
    'compactionId',
    'sourceCommandId',
    'startSeq',
    'summarySeq',
    'endSeq',
    'shadowedTokenCount',
  ]);
  const sourceCommandId = valueAt(value, 'sourceCommandId');
  const startSeq = safeSeq(valueAt(value, 'startSeq'));
  const summarySeq = safeSeq(valueAt(value, 'summarySeq'));
  const endSeq = safeSeq(valueAt(value, 'endSeq'));
  if (
    sourceCommandId !== admission.admission_id
    || !(startSeq < summarySeq && summarySeq < endSeq)
  ) fail();
  return freezeDeep({
    operation: 'manual_compaction_completed',
    status: 'compaction_completed',
    compaction_id: safePattern(valueAt(value, 'compactionId'), COMPACTION_ID_PATTERN),
    start_seq: startSeq,
    summary_seq: summarySeq,
    end_seq: endSeq,
    shadowed_token_count: safeCount(valueAt(value, 'shadowedTokenCount')),
  });
}

function result(admission, runtimeResult) {
  return freezeDeep({
    result_version: BUILDER_CONTEXT_COMPACTION_EXECUTION_RESULT_VERSION,
    operation: runtimeResult.operation,
    status: runtimeResult.status,
    admission_id: admission.admission_id,
    conversation_compaction_projection_digest:
      admission.conversation_compaction_projection_digest,
    compaction_id: runtimeResult.compaction_id,
    start_seq: runtimeResult.start_seq,
    summary_seq: runtimeResult.summary_seq,
    end_seq: runtimeResult.end_seq,
    shadowed_token_count: runtimeResult.shadowed_token_count,
    authority: freezeDeep({ ...AUTHORITY }),
  });
}

function sanitizeBuilderContextCompactionExecutionResult(value) {
  try {
    exactObject(value, RESULT_KEYS);
    const operation = valueAt(value, 'operation');
    const status = valueAt(value, 'status');
    const compactionId = valueAt(value, 'compaction_id');
    const startSeq = valueAt(value, 'start_seq');
    const summarySeq = valueAt(value, 'summary_seq');
    const endSeq = valueAt(value, 'end_seq');
    const shadowedTokenCount = valueAt(value, 'shadowed_token_count');
    if (
      valueAt(value, 'result_version') !== BUILDER_CONTEXT_COMPACTION_EXECUTION_RESULT_VERSION
      || !['manual_compaction_completed', 'manual_compaction_noop'].includes(operation)
      || !['compaction_completed', 'compaction_not_needed'].includes(status)
      || (operation === 'manual_compaction_completed') !== (status === 'compaction_completed')
      || valueAt(value, 'authority') === null
    ) fail();
    const normalized = freezeDeep({
      result_version: BUILDER_CONTEXT_COMPACTION_EXECUTION_RESULT_VERSION,
      operation,
      status,
      admission_id: safePattern(valueAt(value, 'admission_id'), ADMISSION_ID_PATTERN),
      conversation_compaction_projection_digest:
        safePattern(valueAt(value, 'conversation_compaction_projection_digest'), DIGEST_PATTERN),
      compaction_id: compactionId === null ? null : safePattern(compactionId, COMPACTION_ID_PATTERN),
      start_seq: startSeq === null ? null : safeSeq(startSeq),
      summary_seq: summarySeq === null ? null : safeSeq(summarySeq),
      end_seq: endSeq === null ? null : safeSeq(endSeq),
      shadowed_token_count: shadowedTokenCount === null ? null : safeCount(shadowedTokenCount),
      authority: (() => {
        exactObject(valueAt(value, 'authority'), AUTHORITY_KEYS);
        for (const key of AUTHORITY_KEYS) {
          if (valueAt(valueAt(value, 'authority'), key) !== AUTHORITY[key]) fail();
        }
        return freezeDeep({ ...AUTHORITY });
      })(),
    });
    if (
      status === 'compaction_not_needed'
      && (
        normalized.compaction_id !== null
        || normalized.start_seq !== null
        || normalized.summary_seq !== null
        || normalized.end_seq !== null
        || normalized.shadowed_token_count !== null
      )
    ) fail();
    if (
      status === 'compaction_completed'
      && (
        normalized.compaction_id === null
        || normalized.start_seq === null
        || normalized.summary_seq === null
        || normalized.end_seq === null
        || normalized.shadowed_token_count === null
        || !(normalized.start_seq < normalized.summary_seq
          && normalized.summary_seq < normalized.end_seq)
      )
    ) fail();
    return normalized;
  } catch (error) {
    if (error instanceof BuilderContextCompactionExecutionBridgeError) throw error;
    fail();
  }
}

function createBuilderContextCompactionExecutionBridge(rawOptions) {
  exactObject(rawOptions, CREATE_KEYS);
  const runtime = valueAt(rawOptions, 'harness_runtime');
  const manualCompact = method(runtime, 'manual_compact');

  return freezeDeep({
    bridge_version: BUILDER_CONTEXT_COMPACTION_EXECUTION_BRIDGE_VERSION,

    async execute_manual_compaction(rawRequest) {
      let admission;
      let abortSignal;
      let sessionId;
      try {
        exactObject(rawRequest, EXECUTE_KEYS);
        sessionId = safePattern(valueAt(rawRequest, 'session_id'), SESSION_ID_PATTERN);
        admission = sanitizeBuilderContextCompactionAdmissionRecord(
          valueAt(rawRequest, 'context_compaction_admission'),
          valueAt(rawRequest, 'conversation_compaction_projection'),
        );
        abortSignal = safeAbortSignal(valueAt(rawRequest, 'abort_signal'));
      } catch (error) {
        if (error instanceof BuilderContextCompactionExecutionBridgeError) throw error;
        fail();
      }
      let rawResult;
      try {
        rawResult = await Reflect.apply(manualCompact, runtime, [{
          session_id: sessionId,
          source_command_id: admission.admission_id,
          abort_signal: abortSignal,
        }]);
      } catch (error) {
        if (error instanceof BuilderContextCompactionExecutionBridgeError) throw error;
        fail('builder_context_compaction_execution_bridge_failed');
      }
      return result(admission, sanitizeRuntimeCompactionResult(rawResult, admission));
    },
  });
}

module.exports = Object.freeze({
  BUILDER_CONTEXT_COMPACTION_EXECUTION_BRIDGE_VERSION,
  BUILDER_CONTEXT_COMPACTION_EXECUTION_RESULT_VERSION,
  BuilderContextCompactionExecutionBridgeError,
  createBuilderContextCompactionExecutionBridge,
  sanitizeBuilderContextCompactionExecutionResult,
});
