'use strict';

const { types: utilTypes } = require('node:util');

const {
  sanitizeBuilderCheckRunStatusProjection,
} = require('./builder-check-run-status-projection.cjs');

const BUILDER_CHECK_RUN_OUTCOME_PROJECTION_VERSION =
  'builder-check-run-outcome-projection.v1';
const INPUT_KEYS = Object.freeze([
  'project_id',
  'candidate_id',
  'state',
  'check_run_status_projection',
]);
const PROJECTION_KEYS = Object.freeze([
  'projection_version',
  'state',
  'command_kind',
  'command_label',
  'status',
  'label',
  'summary',
  'completed_at_ms',
  'authority',
]);
const AUTHORITY_KEYS = Object.freeze([
  'projection_authority',
  'fact_source',
  'raw_output',
  'runtime_paths',
  'renderer_authority',
  'save_authority',
]);
const UUID_SOURCE =
  '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const PROJECT_ID_PATTERN = new RegExp(`^builder-project:${UUID_SOURCE}$`, 'u');
const CANDIDATE_ID_PATTERN = /^builder-code-change-candidate:[0-9a-f]{64}$/u;
const COMMAND_LABELS = Object.freeze({
  lint: 'Lint',
  typecheck: 'Type check',
  test: 'Tests',
  build: 'Build',
});
const COMPLETED_COPY = new Set([
  ['passed', 'Checked', 'The project check completed successfully.'],
  ['failed', 'Check failed', 'The project check found a problem that needs review.'],
  ['failed', 'Check failed', 'The project check produced too much output to review safely.'],
  ['incomplete', 'Check incomplete', 'The project check reached its time limit.'],
  ['incomplete', 'Check incomplete', 'The project check was cancelled.'],
  ['incomplete', 'Check unavailable', 'The required local check environment is unavailable.'],
  ['incomplete', 'Check unavailable', 'The project check could not be started.'],
  ['incomplete', 'Check needs attention', 'Builder could not confirm that the project check stopped.'],
].map((tuple) => JSON.stringify(tuple)));
const SPECIAL = Object.freeze({
  not_run: Object.freeze({
    status: 'not_run',
    label: 'Not checked',
    summary: 'No project check has been recorded for this draft.',
    fact_source: 'verified_absence',
  }),
  running: Object.freeze({
    status: 'running',
    label: 'Running checks',
    summary: 'Checking the current draft before it is saved.',
    fact_source: 'activity_registry',
  }),
  unavailable: Object.freeze({
    status: 'unavailable',
    label: 'Check status unavailable',
    summary: 'Builder could not verify the check status for this draft.',
    fact_source: 'status_unavailable',
  }),
});

class BuilderCheckRunOutcomeProjectionError extends Error {
  constructor() {
    super('Builder check outcome is unavailable.');
    this.name = 'BuilderCheckRunOutcomeProjectionError';
    this.code = 'builder_check_run_outcome_projection_invalid';
    this.retryable = false;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() { throw new BuilderCheckRunOutcomeProjectionError(); }

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
  if (
    ownKeys.length !== keys.length
    || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))
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

function authority(factSource) {
  return freezeDeep({
    projection_authority: 'main_owned_check_run_outcome_projection_v1',
    fact_source: factSource,
    raw_output: 'not_present',
    runtime_paths: 'not_present',
    renderer_authority: 'read_only_projection',
    save_authority: false,
  });
}

function projectBuilderCheckRunOutcome(rawInput) {
  try {
    const input = exactObject(rawInput, INPUT_KEYS);
    const projectId = valueAt(input, 'project_id');
    const candidateId = valueAt(input, 'candidate_id');
    const state = valueAt(input, 'state');
    const rawStatus = valueAt(input, 'check_run_status_projection');
    if (
      typeof projectId !== 'string'
      || !PROJECT_ID_PATTERN.test(projectId)
      || typeof candidateId !== 'string'
      || !CANDIDATE_ID_PATTERN.test(candidateId)
      || !['not_run', 'running', 'completed', 'unavailable'].includes(state)
    ) fail();
    if (state === 'completed') {
      const status = sanitizeBuilderCheckRunStatusProjection(rawStatus);
      if (status.project_id !== projectId || status.candidate_id !== candidateId) fail();
      return freezeDeep({
        projection_version: BUILDER_CHECK_RUN_OUTCOME_PROJECTION_VERSION,
        state,
        command_kind: status.command_kind,
        command_label: status.command_label,
        status: status.status,
        label: status.label,
        summary: status.summary,
        completed_at_ms: status.completed_at_ms,
        authority: authority('verified_current_candidate_check_run'),
      });
    }
    if (rawStatus !== null) fail();
    const special = SPECIAL[state];
    if (!special) fail();
    return freezeDeep({
      projection_version: BUILDER_CHECK_RUN_OUTCOME_PROJECTION_VERSION,
      state,
      command_kind: null,
      command_label: null,
      status: special.status,
      label: special.label,
      summary: special.summary,
      completed_at_ms: null,
      authority: authority(special.fact_source),
    });
  } catch (error) {
    if (error instanceof BuilderCheckRunOutcomeProjectionError) throw error;
    fail();
  }
}

function sanitizeBuilderCheckRunOutcomeProjection(rawValue) {
  try {
    const value = exactObject(rawValue, PROJECTION_KEYS);
    const state = valueAt(value, 'state');
    const authorityValue = exactObject(valueAt(value, 'authority'), AUTHORITY_KEYS);
    const expectedAuthority = authority(valueAt(authorityValue, 'fact_source'));
    for (const key of AUTHORITY_KEYS) {
      if (valueAt(authorityValue, key) !== valueAt(expectedAuthority, key)) fail();
    }
    if (valueAt(value, 'projection_version') !== BUILDER_CHECK_RUN_OUTCOME_PROJECTION_VERSION) fail();
    if (state === 'completed') {
      const commandKind = valueAt(value, 'command_kind');
      if (
        valueAt(authorityValue, 'fact_source') !== 'verified_current_candidate_check_run'
        || !Object.hasOwn(COMMAND_LABELS, commandKind)
        || valueAt(value, 'command_label') !== COMMAND_LABELS[commandKind]
        || !COMPLETED_COPY.has(JSON.stringify([
          valueAt(value, 'status'),
          valueAt(value, 'label'),
          valueAt(value, 'summary'),
        ]))
        || !Number.isSafeInteger(valueAt(value, 'completed_at_ms'))
        || valueAt(value, 'completed_at_ms') < 0
      ) fail();
      return freezeDeep(value);
    }
    const special = SPECIAL[state];
    if (
      !special
      || valueAt(authorityValue, 'fact_source') !== special.fact_source
      || valueAt(value, 'command_kind') !== null
      || valueAt(value, 'command_label') !== null
      || valueAt(value, 'status') !== special.status
      || valueAt(value, 'label') !== special.label
      || valueAt(value, 'summary') !== special.summary
      || valueAt(value, 'completed_at_ms') !== null
    ) fail();
    return freezeDeep(value);
  } catch (error) {
    if (error instanceof BuilderCheckRunOutcomeProjectionError) throw error;
    fail();
  }
}

module.exports = freezeDeep({
  BUILDER_CHECK_RUN_OUTCOME_PROJECTION_VERSION,
  BuilderCheckRunOutcomeProjectionError,
  projectBuilderCheckRunOutcome,
  sanitizeBuilderCheckRunOutcomeProjection,
});
