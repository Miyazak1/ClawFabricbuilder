'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const BUILDER_CHECK_SKIP_DECISION_VERSION = 'builder-check-skip-decision.v1';
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const PROJECT_ID_PATTERN = new RegExp(`^builder-project:${UUID_SOURCE}$`, 'u');
const CONVERSATION_ID_PATTERN = new RegExp(`^builder-conversation:${UUID_SOURCE}$`, 'u');
const TURN_ID_PATTERN = new RegExp(`^builder-turn:${UUID_SOURCE}$`, 'u');
const TASK_ID_PATTERN = new RegExp(`^builder-task:${UUID_SOURCE}$`, 'u');
const RUN_ID_PATTERN = new RegExp(`^builder-run:${UUID_SOURCE}$`, 'u');
const DRAFT_ID_PATTERN = /^builder-generation-draft:[0-9a-f]{64}$/u;
const CHECKPOINT_ID_PATTERN = /^builder-draft-checkpoint:[0-9a-f]{64}$/u;
const CANDIDATE_ID_PATTERN = /^builder-code-change-candidate:[0-9a-f]{64}$/u;
const DECISION_ID_PATTERN = /^builder-check-skip-decision:[0-9a-f]{64}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const INPUT_KEYS = Object.freeze([
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
  'reason_code',
  'decided_at_ms',
]);
const DECISION_KEYS = Object.freeze([
  'decision_version',
  'decision_id',
  'decision_digest',
  ...INPUT_KEYS,
  'authority',
]);
const AUTHORITY_KEYS = Object.freeze([
  'record_authority',
  'intent_evidence',
  'check_execution',
  'save_authority',
]);
const AUTHORITY = Object.freeze({
  record_authority: 'main_owned_check_skip_decision_contract_v1',
  intent_evidence: 'explicit_user_action_admitted_by_main',
  check_execution: 'not_performed_by_decision',
  save_authority: 'not_granted',
});

class BuilderCheckSkipDecisionError extends Error {
  constructor() {
    super('Builder check skip decision could not be verified.');
    this.name = 'BuilderCheckSkipDecisionError';
    this.code = 'builder_check_skip_decision_invalid';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() { throw new BuilderCheckSkipDecisionError(); }

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

function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number' && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map(
      (key) => `${JSON.stringify(key)}:${canonicalJson(valueAt(value, key))}`,
    ).join(',')}}`;
  }
  fail();
}

function digest(value) {
  return `sha256:${nodeCrypto.createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')}`;
}

function safePattern(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) fail();
  return value;
}

function safeSequence(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 1_000_000) fail();
  return value;
}

function safeTime(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail();
  return value;
}

function bodyFromInput(rawInput) {
  const input = exactObject(rawInput, INPUT_KEYS);
  const body = {
    decision_version: BUILDER_CHECK_SKIP_DECISION_VERSION,
    project_id: safePattern(valueAt(input, 'project_id'), PROJECT_ID_PATTERN),
    conversation_id: safePattern(valueAt(input, 'conversation_id'), CONVERSATION_ID_PATTERN),
    turn_id: safePattern(valueAt(input, 'turn_id'), TURN_ID_PATTERN),
    task_id: safePattern(valueAt(input, 'task_id'), TASK_ID_PATTERN),
    run_id: safePattern(valueAt(input, 'run_id'), RUN_ID_PATTERN),
    draft_id: safePattern(valueAt(input, 'draft_id'), DRAFT_ID_PATTERN),
    draft_checkpoint_id: safePattern(valueAt(input, 'draft_checkpoint_id'), CHECKPOINT_ID_PATTERN),
    draft_checkpoint_sequence: safeSequence(valueAt(input, 'draft_checkpoint_sequence')),
    candidate_id: safePattern(valueAt(input, 'candidate_id'), CANDIDATE_ID_PATTERN),
    candidate_digest: safePattern(valueAt(input, 'candidate_digest'), DIGEST_PATTERN),
    resulting_tree_digest: safePattern(valueAt(input, 'resulting_tree_digest'), DIGEST_PATTERN),
    reason_code: valueAt(input, 'reason_code'),
    decided_at_ms: safeTime(valueAt(input, 'decided_at_ms')),
    authority: AUTHORITY,
  };
  if (body.reason_code !== 'user_chose_save_without_check') fail();
  return Object.freeze(body);
}

function assertDecision(rawDecision) {
  const decision = exactObject(rawDecision, DECISION_KEYS);
  const authority = exactObject(valueAt(decision, 'authority'), AUTHORITY_KEYS);
  for (const key of AUTHORITY_KEYS) {
    if (valueAt(authority, key) !== AUTHORITY[key]) fail();
  }
  const body = bodyFromInput(Object.fromEntries(INPUT_KEYS.map(
    (key) => [key, valueAt(decision, key)],
  )));
  const decisionDigest = digest(body);
  if (
    valueAt(decision, 'decision_version') !== BUILDER_CHECK_SKIP_DECISION_VERSION
    || safePattern(valueAt(decision, 'decision_digest'), DIGEST_PATTERN) !== decisionDigest
    || safePattern(valueAt(decision, 'decision_id'), DECISION_ID_PATTERN)
      !== `builder-check-skip-decision:${decisionDigest.slice('sha256:'.length)}`
  ) fail();
  return Object.freeze({
    decision_version: BUILDER_CHECK_SKIP_DECISION_VERSION,
    decision_id: valueAt(decision, 'decision_id'),
    decision_digest: decisionDigest,
    ...Object.fromEntries(INPUT_KEYS.map((key) => [key, body[key]])),
    authority: AUTHORITY,
  });
}

function createBuilderCheckSkipDecision(rawInput) {
  const body = bodyFromInput(rawInput);
  const decisionDigest = digest(body);
  return assertDecision({
    decision_version: BUILDER_CHECK_SKIP_DECISION_VERSION,
    decision_id: `builder-check-skip-decision:${decisionDigest.slice('sha256:'.length)}`,
    decision_digest: decisionDigest,
    ...Object.fromEntries(INPUT_KEYS.map((key) => [key, body[key]])),
    authority: AUTHORITY,
  });
}

function sanitizeBuilderCheckSkipDecision(value) {
  try {
    return assertDecision(value);
  } catch (error) {
    if (error instanceof BuilderCheckSkipDecisionError) throw error;
    fail();
  }
}

module.exports = Object.freeze({
  BUILDER_CHECK_SKIP_DECISION_VERSION,
  BuilderCheckSkipDecisionError,
  createBuilderCheckSkipDecision,
  sanitizeBuilderCheckSkipDecision,
});
