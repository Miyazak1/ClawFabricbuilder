'use strict';

const { types: utilTypes } = require('node:util');

const {
  BUILDER_CHECK_RUN_ACTIVITY_REGISTRY_VERSION,
} = require('./builder-check-run-activity-registry.cjs');
const {
  BUILDER_CHECK_RUN_CURRENT_DRAFT_MAIN_CANDIDATE_RESULT_VERSION,
  BUILDER_CHECK_RUN_CURRENT_DRAFT_SERVICE_VERSION,
} = require('./builder-check-run-current-draft-service.cjs');
const {
  BUILDER_CHECK_RUN_STORE_READ_RESULT_VERSION,
  BUILDER_CHECK_RUN_STORE_VERSION,
} = require('./builder-check-run-store.cjs');
const {
  createBuilderCheckSkipDecision,
  sanitizeBuilderCheckSkipDecision,
} = require('./builder-check-skip-decision.cjs');
const {
  BUILDER_CHECK_SKIP_DECISION_STORE_READ_RESULT_VERSION,
  BUILDER_CHECK_SKIP_DECISION_STORE_RESULT_VERSION,
  BUILDER_CHECK_SKIP_DECISION_STORE_VERSION,
} = require('./builder-check-skip-decision-store.cjs');

const BUILDER_CHECK_SKIP_CURRENT_DRAFT_SERVICE_VERSION =
  'builder-check-skip-current-draft-service.v1';
const BUILDER_CHECK_SKIP_CURRENT_DRAFT_RESULT_VERSION =
  'builder-check-skip-current-draft-result.v1';
const CREATE_KEYS = Object.freeze([
  'current_draft_check_run_service',
  'check_run_store',
  'check_skip_decision_store',
  'activity_registry',
  'clock',
]);
const REQUEST_KEYS = Object.freeze(['draft_id']);
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
const DRAFT_ID_PATTERN = /^builder-generation-draft:[0-9a-f]{64}$/u;

const ERROR_MESSAGES = Object.freeze({
  builder_check_skip_current_draft_invalid: 'The check skip request could not be verified.',
  builder_check_skip_current_draft_busy: 'The current draft is already in use.',
  builder_check_skip_current_draft_check_exists: 'A project check already exists for this draft.',
  builder_check_skip_current_draft_unavailable: 'The check skip decision could not be recorded.',
});

class BuilderCheckSkipCurrentDraftServiceError extends Error {
  constructor(code = 'builder_check_skip_current_draft_invalid') {
    const selected = Object.hasOwn(ERROR_MESSAGES, code)
      ? code
      : 'builder_check_skip_current_draft_invalid';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderCheckSkipCurrentDraftServiceError';
    this.code = selected;
    this.retryable = selected === 'builder_check_skip_current_draft_busy'
      || selected === 'builder_check_skip_current_draft_unavailable';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) { throw new BuilderCheckSkipCurrentDraftServiceError(code); }

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freezeDeep(nested);
    Object.freeze(value);
  }
  return value;
}

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
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  }
  return descriptors;
}

function serviceMethod(value, versionKey, expectedVersion, methodKey) {
  if (!isPlainObject(value)) fail();
  const version = Object.getOwnPropertyDescriptor(value, versionKey);
  const method = Object.getOwnPropertyDescriptor(value, methodKey);
  if (
    !version
    || !Object.hasOwn(version, 'value')
    || version.value !== expectedVersion
    || !method
    || !Object.hasOwn(method, 'value')
    || typeof method.value !== 'function'
    || utilTypes.isProxy(method.value)
  ) fail();
  return method.value.bind(value);
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

function safeDraftId(value) {
  if (typeof value !== 'string' || !DRAFT_ID_PATTERN.test(value)) fail();
  return value;
}

function currentCandidate(rawResult, expectedDraftId) {
  const result = exactObject(rawResult, [
    'result_version',
    'service_version',
    'operation',
    'current_candidate',
    'authority',
  ]);
  if (
    result.result_version.value !== BUILDER_CHECK_RUN_CURRENT_DRAFT_MAIN_CANDIDATE_RESULT_VERSION
    || result.service_version.value !== BUILDER_CHECK_RUN_CURRENT_DRAFT_SERVICE_VERSION
    || result.operation.value !== 'current_draft_candidate_resolved_for_main_only'
  ) fail();
  const candidate = exactObject(result.current_candidate.value, CURRENT_CANDIDATE_KEYS);
  const normalized = Object.fromEntries(CURRENT_CANDIDATE_KEYS.map(
    (key) => [key, candidate[key].value],
  ));
  if (normalized.draft_id !== expectedDraftId) fail();
  return freezeDeep(normalized);
}

function assertNoCheckRun(rawResult) {
  const result = exactObject(rawResult, [
    'result_version', 'operation', 'status', 'check_run', 'store_evidence',
  ]);
  if (
    result.result_version.value !== BUILDER_CHECK_RUN_STORE_READ_RESULT_VERSION
    || result.operation.value !== 'latest_check_run_read'
  ) fail('builder_check_skip_current_draft_unavailable');
  if (result.status.value !== 'absent' || result.check_run.value !== null) {
    fail('builder_check_skip_current_draft_check_exists');
  }
}

function existingDecision(rawResult, candidate) {
  const result = exactObject(rawResult, [
    'result_version', 'operation', 'status', 'check_skip_decision', 'store_evidence',
  ]);
  if (
    result.result_version.value !== BUILDER_CHECK_SKIP_DECISION_STORE_READ_RESULT_VERSION
    || result.operation.value !== 'current_check_skip_decision_read'
  ) fail('builder_check_skip_current_draft_unavailable');
  if (result.status.value === 'absent') {
    if (result.check_skip_decision.value !== null) fail('builder_check_skip_current_draft_unavailable');
    return null;
  }
  if (result.status.value !== 'ready' || result.check_skip_decision.value === null) {
    fail('builder_check_skip_current_draft_unavailable');
  }
  let decision;
  try { decision = sanitizeBuilderCheckSkipDecision(result.check_skip_decision.value); } catch {
    fail('builder_check_skip_current_draft_unavailable');
  }
  for (const key of CURRENT_CANDIDATE_KEYS) {
    if (decision[key] !== candidate[key]) fail('builder_check_skip_current_draft_unavailable');
  }
  return decision;
}

function assertWriteResult(rawResult, candidate) {
  const result = exactObject(rawResult, [
    'result_version', 'operation', 'check_skip_decision', 'store_evidence',
  ]);
  if (
    result.result_version.value !== BUILDER_CHECK_SKIP_DECISION_STORE_RESULT_VERSION
    || !['check_skip_decision_recorded', 'check_skip_decision_replayed'].includes(
      result.operation.value,
    )
  ) fail('builder_check_skip_current_draft_unavailable');
  return existingDecision({
    result_version: BUILDER_CHECK_SKIP_DECISION_STORE_READ_RESULT_VERSION,
    operation: 'current_check_skip_decision_read',
    status: 'ready',
    check_skip_decision: result.check_skip_decision.value,
    store_evidence: result.store_evidence.value,
  }, candidate);
}

function createBuilderCheckSkipCurrentDraftService(rawOptions) {
  const options = exactObject(rawOptions, CREATE_KEYS);
  const readCurrentCandidate = serviceMethod(
    options.current_draft_check_run_service.value,
    'service_version',
    BUILDER_CHECK_RUN_CURRENT_DRAFT_SERVICE_VERSION,
    'read_current_candidate_for_main_only',
  );
  const readLatestCheckRun = serviceMethod(
    options.check_run_store.value,
    'store_version',
    BUILDER_CHECK_RUN_STORE_VERSION,
    'read_latest_check_run',
  );
  const skipStore = options.check_skip_decision_store.value;
  const readSkipDecision = serviceMethod(
    skipStore,
    'store_version',
    BUILDER_CHECK_SKIP_DECISION_STORE_VERSION,
    'read_current_check_skip_decision',
  );
  const recordSkipDecision = serviceMethod(
    skipStore,
    'store_version',
    BUILDER_CHECK_SKIP_DECISION_STORE_VERSION,
    'record_check_skip_decision',
  );
  const registry = options.activity_registry.value;
  const acquireSkip = serviceMethod(
    registry,
    'registry_version',
    BUILDER_CHECK_RUN_ACTIVITY_REGISTRY_VERSION,
    'acquire_candidate_skip',
  );
  const releaseSkip = serviceMethod(
    registry,
    'registry_version',
    BUILDER_CHECK_RUN_ACTIVITY_REGISTRY_VERSION,
    'release_candidate_skip',
  );
  const nowMs = serviceMethod(options.clock.value, 'clock_version', 'builder-clock.v1', 'now_ms');

  return freezeDeep({
    service_version: BUILDER_CHECK_SKIP_CURRENT_DRAFT_SERVICE_VERSION,

    async skip_current_draft_check(rawRequest) {
      const request = exactObject(rawRequest, REQUEST_KEYS);
      const draftId = safeDraftId(request.draft_id.value);
      const candidate = currentCandidate(await readCurrentCandidate({ draft_id: draftId }), draftId);
      let guard;
      try {
        guard = acquireSkip({ current_candidate: candidate });
      } catch (error) {
        if (ownCode(error) === 'builder_check_run_activity_busy') {
          fail('builder_check_skip_current_draft_busy');
        }
        fail('builder_check_skip_current_draft_unavailable');
      }
      let decision;
      let operation = 'check_skip_decision_recorded';
      let failure = null;
      try {
        assertNoCheckRun(readLatestCheckRun({
          project_id: candidate.project_id,
          candidate_id: candidate.candidate_id,
        }));
        decision = existingDecision(readSkipDecision({
          project_id: candidate.project_id,
          candidate_id: candidate.candidate_id,
        }), candidate);
        if (decision !== null) {
          operation = 'check_skip_decision_replayed';
        } else {
          const decidedAtMs = nowMs();
          if (!Number.isSafeInteger(decidedAtMs) || decidedAtMs < 0) {
            fail('builder_check_skip_current_draft_unavailable');
          }
          const created = createBuilderCheckSkipDecision({
            ...candidate,
            reason_code: 'user_chose_save_without_check',
            decided_at_ms: decidedAtMs,
          });
          decision = assertWriteResult(recordSkipDecision({
            check_skip_decision: created,
          }), candidate);
        }
      } catch (error) {
        failure = error;
      }
      try {
        if (releaseSkip({ skip_guard: guard }) !== true) {
          fail('builder_check_skip_current_draft_unavailable');
        }
      } catch {
        fail('builder_check_skip_current_draft_unavailable');
      }
      if (failure !== null) {
        if (failure instanceof BuilderCheckSkipCurrentDraftServiceError) throw failure;
        fail('builder_check_skip_current_draft_unavailable');
      }
      return freezeDeep({
        result_version: BUILDER_CHECK_SKIP_CURRENT_DRAFT_RESULT_VERSION,
        service_version: BUILDER_CHECK_SKIP_CURRENT_DRAFT_SERVICE_VERSION,
        operation,
        draft_id: draftId,
        project_id: candidate.project_id,
        candidate_id: candidate.candidate_id,
        check_skip_decision: decision,
        authority: {
          user_action: 'explicit_skip_check_request_admitted_by_main',
          save_version: 'not_performed',
          check_execution: 'not_performed',
          renderer_candidate_identity: 'not_accepted',
        },
      });
    },
  });
}

module.exports = freezeDeep({
  BUILDER_CHECK_SKIP_CURRENT_DRAFT_RESULT_VERSION,
  BUILDER_CHECK_SKIP_CURRENT_DRAFT_SERVICE_VERSION,
  BuilderCheckSkipCurrentDraftServiceError,
  createBuilderCheckSkipCurrentDraftService,
});
