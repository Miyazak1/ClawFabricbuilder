'use strict';

const { types: utilTypes } = require('node:util');

const {
  BUILDER_CHECK_RUN_STORE_READ_RESULT_VERSION,
} = require('./builder-check-run-store.cjs');
const {
  projectBuilderCheckRunStatus,
} = require('./builder-check-run-status-projection.cjs');
const {
  sanitizeBuilderCheckSkipDecision,
} = require('./builder-check-skip-decision.cjs');
const {
  BUILDER_CHECK_SKIP_DECISION_STORE_READ_RESULT_VERSION,
} = require('./builder-check-skip-decision-store.cjs');

const BUILDER_CHECK_RUN_STATUS_SERVICE_VERSION = 'builder-check-run-status-service.v1';
const CREATE_KEYS = Object.freeze(['check_run_store', 'check_skip_decision_store']);
const READ_KEYS = Object.freeze(['project_id', 'candidate_id']);
const STORE_RESULT_KEYS = Object.freeze([
  'result_version',
  'operation',
  'status',
  'check_run',
  'store_evidence',
]);
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const PROJECT_ID_PATTERN = new RegExp(`^builder-project:${UUID_SOURCE}$`, 'u');
const CANDIDATE_ID_PATTERN = /^builder-code-change-candidate:[0-9a-f]{64}$/u;

class BuilderCheckRunStatusServiceError extends Error {
  constructor() {
    super('Builder check status is unavailable.');
    this.name = 'BuilderCheckRunStatusServiceError';
    this.code = 'builder_check_run_status_service_unavailable';
    this.retryable = true;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() { throw new BuilderCheckRunStatusServiceError(); }

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
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  }
  return descriptors;
}

function functionAt(value, key) {
  if (!isPlainObject(value)) fail();
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (
    !descriptor
    || descriptor.enumerable !== true
    || !Object.hasOwn(descriptor, 'value')
    || typeof descriptor.value !== 'function'
    || utilTypes.isProxy(descriptor.value)
  ) fail();
  return descriptor.value.bind(value);
}

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freezeDeep(nested);
    Object.freeze(value);
  }
  return value;
}

function createBuilderCheckRunStatusService(rawOptions) {
  try {
    const options = exactObject(rawOptions, CREATE_KEYS);
    const store = options.check_run_store.value;
    const readLatestCheckRun = functionAt(store, 'read_latest_check_run');
    const skipStore = options.check_skip_decision_store.value;
    const readCurrentSkipDecision = functionAt(skipStore, 'read_current_check_skip_decision');
    return freezeDeep({
      service_version: BUILDER_CHECK_RUN_STATUS_SERVICE_VERSION,
      read_current_check_run_status(rawRequest) {
        try {
          const request = exactObject(rawRequest, READ_KEYS);
          const projectId = request.project_id.value;
          const candidateId = request.candidate_id.value;
          if (
            typeof projectId !== 'string'
            || !PROJECT_ID_PATTERN.test(projectId)
            || typeof candidateId !== 'string'
            || !CANDIDATE_ID_PATTERN.test(candidateId)
          ) fail();
          const result = readLatestCheckRun({
            project_id: projectId,
            candidate_id: candidateId,
          });
          const stored = exactObject(result, STORE_RESULT_KEYS);
          if (
            stored.result_version.value !== BUILDER_CHECK_RUN_STORE_READ_RESULT_VERSION
            || stored.operation.value !== 'latest_check_run_read'
            || !['absent', 'ready'].includes(stored.status.value)
            || !isPlainObject(stored.store_evidence.value)
          ) fail();
          if (stored.status.value === 'absent') {
            if (stored.check_run.value !== null) fail();
            const skipResult = readCurrentSkipDecision({
              project_id: projectId,
              candidate_id: candidateId,
            });
            const storedSkip = exactObject(skipResult, [
              'result_version',
              'operation',
              'status',
              'check_skip_decision',
              'store_evidence',
            ]);
            if (
              storedSkip.result_version.value !== BUILDER_CHECK_SKIP_DECISION_STORE_READ_RESULT_VERSION
              || storedSkip.operation.value !== 'current_check_skip_decision_read'
              || !['absent', 'ready'].includes(storedSkip.status.value)
              || !isPlainObject(storedSkip.store_evidence.value)
            ) fail();
            if (storedSkip.status.value === 'absent') {
              if (storedSkip.check_skip_decision.value !== null) fail();
              return freezeDeep({
                check_run_state: 'not_run',
                check_run_status_projection: null,
              });
            }
            if (storedSkip.check_skip_decision.value === null) fail();
            const decision = sanitizeBuilderCheckSkipDecision(
              storedSkip.check_skip_decision.value,
            );
            if (decision.project_id !== projectId || decision.candidate_id !== candidateId) fail();
            return freezeDeep({
              check_run_state: 'skipped',
              check_run_status_projection: null,
            });
          }
          if (stored.check_run.value === null) fail();
          const projection = projectBuilderCheckRunStatus({
            check_run: stored.check_run.value,
          });
          if (projection.project_id !== projectId || projection.candidate_id !== candidateId) fail();
          return freezeDeep({
            check_run_state: 'completed',
            check_run_status_projection: projection,
          });
        } catch (error) {
          if (error instanceof BuilderCheckRunStatusServiceError) throw error;
          fail();
        }
      },
    });
  } catch (error) {
    if (error instanceof BuilderCheckRunStatusServiceError) throw error;
    fail();
  }
}

module.exports = freezeDeep({
  BUILDER_CHECK_RUN_STATUS_SERVICE_VERSION,
  BuilderCheckRunStatusServiceError,
  createBuilderCheckRunStatusService,
});
