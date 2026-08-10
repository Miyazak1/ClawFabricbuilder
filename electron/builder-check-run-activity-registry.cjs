'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const {
  sanitizeBuilderCheckRunAdmission,
} = require('./builder-check-run-admission.cjs');

const BUILDER_CHECK_RUN_ACTIVITY_REGISTRY_VERSION =
  'builder-check-run-activity-registry.v1';
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
const BEGIN_KEYS = Object.freeze(['check_run_admission']);
const SAVE_KEYS = Object.freeze(['current_candidate']);
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const PATTERNS = Object.freeze({
  project_id: new RegExp(`^builder-project:${UUID_SOURCE}$`, 'u'),
  conversation_id: new RegExp(`^builder-conversation:${UUID_SOURCE}$`, 'u'),
  turn_id: new RegExp(`^builder-turn:${UUID_SOURCE}$`, 'u'),
  task_id: new RegExp(`^builder-task:${UUID_SOURCE}$`, 'u'),
  run_id: new RegExp(`^builder-run:${UUID_SOURCE}$`, 'u'),
  draft_id: /^builder-generation-draft:[0-9a-f]{64}$/u,
  draft_checkpoint_id: /^builder-draft-checkpoint:[0-9a-f]{64}$/u,
  candidate_id: /^builder-code-change-candidate:[0-9a-f]{64}$/u,
  candidate_digest: /^sha256:[0-9a-f]{64}$/u,
  resulting_tree_digest: /^sha256:[0-9a-f]{64}$/u,
});

class BuilderCheckRunActivityRegistryError extends Error {
  constructor(code = 'builder_check_run_activity_invalid') {
    const selected = code === 'builder_check_run_activity_busy'
      ? code : 'builder_check_run_activity_invalid';
    super(selected === 'builder_check_run_activity_busy'
      ? 'The project candidate is already in use.'
      : 'The project check activity could not be verified.');
    this.name = 'BuilderCheckRunActivityRegistryError';
    this.code = selected;
    this.retryable = selected === 'builder_check_run_activity_busy';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) { throw new BuilderCheckRunActivityRegistryError(code); }

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

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freezeDeep(nested);
    Object.freeze(value);
  }
  return value;
}

function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map(
      (key) => `${JSON.stringify(key)}:${canonicalJson(valueAt(value, key))}`,
    ).join(',')}}`;
  }
  fail();
}

function safeCurrentCandidate(rawValue) {
  const value = exactObject(rawValue, CURRENT_CANDIDATE_KEYS);
  const normalized = {};
  for (const key of CURRENT_CANDIDATE_KEYS) {
    const selected = valueAt(value, key);
    if (key === 'draft_checkpoint_sequence') {
      if (!Number.isSafeInteger(selected) || selected < 1 || selected > 1_000_000) fail();
    } else if (typeof selected !== 'string' || !PATTERNS[key].test(selected)) fail();
    normalized[key] = selected;
  }
  return freezeDeep(normalized);
}

function candidateFromAdmission(admission) {
  return freezeDeep(Object.fromEntries(
    CURRENT_CANDIDATE_KEYS.map((key) => [key, admission[key]]),
  ));
}

function guardFor(candidate) {
  const digest = nodeCrypto.createHash('sha256')
    .update(canonicalJson(candidate), 'utf8')
    .digest('hex');
  return freezeDeep({
    guard_version: 'builder-check-run-save-guard.v1',
    guard_id: `builder-check-run-save-guard:${digest}`,
    current_candidate: candidate,
  });
}

function sameValue(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function createBuilderCheckRunActivityRegistry() {
  const active = new Map();

  return freezeDeep({
    registry_version: BUILDER_CHECK_RUN_ACTIVITY_REGISTRY_VERSION,

    begin_check_run(rawRequest) {
      const request = exactObject(rawRequest, BEGIN_KEYS);
      const admission = sanitizeBuilderCheckRunAdmission(valueAt(request, 'check_run_admission'));
      const candidate = candidateFromAdmission(admission);
      if (active.has(candidate.candidate_id)) fail('builder_check_run_activity_busy');
      active.set(candidate.candidate_id, freezeDeep({
        kind: 'check_run',
        admission_id: admission.admission_id,
        current_candidate: candidate,
      }));
      return true;
    },

    end_check_run(rawRequest) {
      const request = exactObject(rawRequest, BEGIN_KEYS);
      const admission = sanitizeBuilderCheckRunAdmission(valueAt(request, 'check_run_admission'));
      const existing = active.get(admission.candidate_id);
      if (
        !existing
        || existing.kind !== 'check_run'
        || existing.admission_id !== admission.admission_id
        || !sameValue(existing.current_candidate, candidateFromAdmission(admission))
      ) fail();
      active.delete(admission.candidate_id);
      return true;
    },

    acquire_candidate_save(rawRequest) {
      const request = exactObject(rawRequest, SAVE_KEYS);
      const candidate = safeCurrentCandidate(valueAt(request, 'current_candidate'));
      if (active.has(candidate.candidate_id)) fail('builder_check_run_activity_busy');
      const guard = guardFor(candidate);
      active.set(candidate.candidate_id, freezeDeep({
        kind: 'save',
        guard_id: guard.guard_id,
        current_candidate: candidate,
      }));
      return guard;
    },

    release_candidate_save(rawRequest) {
      const request = exactObject(rawRequest, ['save_guard']);
      const guard = valueAt(request, 'save_guard');
      exactObject(guard, ['guard_version', 'guard_id', 'current_candidate']);
      const candidate = safeCurrentCandidate(valueAt(guard, 'current_candidate'));
      const expected = guardFor(candidate);
      const existing = active.get(candidate.candidate_id);
      if (
        valueAt(guard, 'guard_version') !== expected.guard_version
        || valueAt(guard, 'guard_id') !== expected.guard_id
        || !existing
        || existing.kind !== 'save'
        || existing.guard_id !== expected.guard_id
        || !sameValue(existing.current_candidate, candidate)
      ) fail();
      active.delete(candidate.candidate_id);
      return true;
    },
  });
}

module.exports = Object.freeze({
  BUILDER_CHECK_RUN_ACTIVITY_REGISTRY_VERSION,
  BuilderCheckRunActivityRegistryError,
  createBuilderCheckRunActivityRegistry,
});
