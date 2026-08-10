'use strict';

const { types: utilTypes } = require('node:util');

const {
  sanitizeBuilderCheckRun,
} = require('./builder-check-run.cjs');
const {
  BUILDER_CHECK_RUN_ACTIVITY_REGISTRY_VERSION,
} = require('./builder-check-run-activity-registry.cjs');
const {
  BUILDER_CHECK_RUN_STORE_READ_RESULT_VERSION,
  BUILDER_CHECK_RUN_STORE_VERSION,
} = require('./builder-check-run-store.cjs');

const BUILDER_CHECK_RUN_SAVE_GATE_VERSION = 'builder-check-run-save-gate.v1';
const CREATE_KEYS = Object.freeze(['check_run_store', 'activity_registry']);
const CURRENT_CANDIDATE_KEYS = Object.freeze([
  'project_id',
  'conversation_id',
  'turn_id',
  'task_id',
  'run_id',
  'draft_id',
  'draft_checkpoint_id',
  'draft_checkpoint_sequence',
  'candidate_id',
  'candidate_digest',
  'resulting_tree_digest',
]);

class BuilderCheckRunSaveGateError extends Error {
  constructor(code = 'builder_check_run_save_gate_invalid') {
    const allowed = [
      'builder_check_run_save_gate_invalid',
      'builder_check_run_save_gate_active',
      'builder_check_run_save_gate_stale',
      'builder_check_run_save_gate_failed',
      'builder_check_run_save_gate_unavailable',
    ];
    const selected = allowed.includes(code) ? code : 'builder_check_run_save_gate_invalid';
    super(selected === 'builder_check_run_save_gate_stale'
      ? 'The project check no longer matches the current draft.'
      : selected === 'builder_check_run_save_gate_active'
        ? 'The project check is still running.'
        : selected === 'builder_check_run_save_gate_failed'
          ? 'The project check must pass before this version can be saved.'
          : 'The project check could not be verified for saving.');
    this.name = 'BuilderCheckRunSaveGateError';
    this.code = selected;
    this.retryable = selected !== 'builder_check_run_save_gate_invalid';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) { throw new BuilderCheckRunSaveGateError(code); }

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || utilTypes.isProxy(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactObject(value, keys) {
  if (!isPlainObject(value)) fail();
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== keys.length || ownKeys.some(
    (key) => typeof key !== 'string' || !keys.includes(key),
  )) fail();
  for (const key of ownKeys) {
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

function ownMethod(value, versionKey, expectedVersion, method) {
  if (!isPlainObject(value)) fail();
  const version = Object.getOwnPropertyDescriptor(value, versionKey);
  const selected = Object.getOwnPropertyDescriptor(value, method);
  if (
    !version
    || !Object.hasOwn(version, 'value')
    || version.value !== expectedVersion
    || !selected
    || !Object.hasOwn(selected, 'value')
    || typeof selected.value !== 'function'
  ) fail();
  return selected.value;
}

function ownCode(error) {
  if (!error || typeof error !== 'object' || utilTypes.isProxy(error)) return null;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(error, 'code');
    return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : null;
  } catch {
    return null;
  }
}

function currentCandidate(rawValue) {
  const value = exactObject(rawValue, CURRENT_CANDIDATE_KEYS);
  return Object.freeze(Object.fromEntries(
    CURRENT_CANDIDATE_KEYS.map((key) => [key, valueAt(value, key)]),
  ));
}

function assertLatestResult(rawResult, expected) {
  exactObject(rawResult, [
    'result_version',
    'operation',
    'status',
    'check_run',
    'store_evidence',
  ]);
  if (
    valueAt(rawResult, 'result_version') !== BUILDER_CHECK_RUN_STORE_READ_RESULT_VERSION
    || valueAt(rawResult, 'operation') !== 'latest_check_run_read'
  ) fail();
  const status = valueAt(rawResult, 'status');
  const rawCheckRun = valueAt(rawResult, 'check_run');
  if (status === 'absent') {
    if (rawCheckRun !== null) fail();
    return Object.freeze({ save_admission: 'allow_not_run', check_run: null });
  }
  if (status !== 'ready' || rawCheckRun === null) fail();
  let checkRun;
  try { checkRun = sanitizeBuilderCheckRun(rawCheckRun); } catch { fail(); }
  for (const key of CURRENT_CANDIDATE_KEYS) {
    if (checkRun[key] !== expected[key]) fail('builder_check_run_save_gate_stale');
  }
  if (checkRun.status !== 'passed') fail('builder_check_run_save_gate_failed');
  return Object.freeze({ save_admission: 'allow_passed', check_run: checkRun });
}

function createBuilderCheckRunSaveGate(rawOptions) {
  const options = exactObject(rawOptions, CREATE_KEYS);
  const store = valueAt(options, 'check_run_store');
  const readLatest = ownMethod(
    store,
    'store_version',
    BUILDER_CHECK_RUN_STORE_VERSION,
    'read_latest_check_run',
  );
  const registry = valueAt(options, 'activity_registry');
  const acquire = ownMethod(
    registry,
    'registry_version',
    BUILDER_CHECK_RUN_ACTIVITY_REGISTRY_VERSION,
    'acquire_candidate_save',
  );
  const release = ownMethod(
    registry,
    'registry_version',
    BUILDER_CHECK_RUN_ACTIVITY_REGISTRY_VERSION,
    'release_candidate_save',
  );

  return Object.freeze({
    gate_version: BUILDER_CHECK_RUN_SAVE_GATE_VERSION,

    async with_current_candidate_save_gate(rawCurrentCandidate, operation) {
      const expected = currentCandidate(rawCurrentCandidate);
      if (typeof operation !== 'function' || utilTypes.isProxy(operation)) fail();
      let guard;
      try {
        guard = Reflect.apply(acquire, registry, [{ current_candidate: expected }]);
      } catch (error) {
        if (ownCode(error) === 'builder_check_run_activity_busy') {
          fail('builder_check_run_save_gate_active');
        }
        fail('builder_check_run_save_gate_unavailable');
      }
      let operationResult;
      let operationError = null;
      let operationFailed = false;
      try {
        let latest;
        try {
          latest = Reflect.apply(readLatest, store, [{
            project_id: expected.project_id,
            candidate_id: expected.candidate_id,
          }]);
        } catch {
          fail('builder_check_run_save_gate_unavailable');
        }
        const result = assertLatestResult(
          latest,
          expected,
        );
        operationResult = await Reflect.apply(operation, undefined, [result]);
      } catch (error) {
        operationFailed = true;
        operationError = error;
      }
      try {
        if (Reflect.apply(release, registry, [{ save_guard: guard }]) !== true) {
          fail('builder_check_run_save_gate_unavailable');
        }
      } catch {
        fail('builder_check_run_save_gate_unavailable');
      }
      if (operationFailed) throw operationError;
      return operationResult;
    },
  });
}

module.exports = Object.freeze({
  BUILDER_CHECK_RUN_SAVE_GATE_VERSION,
  BuilderCheckRunSaveGateError,
  createBuilderCheckRunSaveGate,
});
