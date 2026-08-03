'use strict';

const { types: utilTypes } = require('node:util');

const {
  BuilderAgentProjectWorkResultReviewContractError,
  createBuilderAgentProjectWorkResultReviewRecord,
} = require('./builder-agent-project-work-result-review-contract.cjs');
const {
  BUILDER_AGENT_PROJECT_WORK_RESULT_REVIEW_STORE_VERSION,
  BuilderAgentProjectWorkResultReviewStoreError,
} = require('./builder-agent-project-work-result-review-store.cjs');
const {
  BUILDER_AGENT_PROJECT_WORK_STORE_VERSION,
  BuilderAgentProjectWorkStoreError,
} = require('./builder-agent-project-work-store.cjs');

const BUILDER_AGENT_PROJECT_WORK_RESULT_REVIEW_SERVICE_VERSION =
  'builder-agent-project-work-result-review-service.v1';
const BUILDER_AGENT_PROJECT_WORK_RESULT_REVIEW_SERVICE_RESULT_VERSION =
  'builder-agent-project-work-result-review-service-result.v1';
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const OWNER_ID_PATTERN = new RegExp(`^builder-user:${UUID_SOURCE}$`, 'u');
const WORK_RESULT_ID_PATTERN = /^builder-agent-project-work-result:[0-9a-f]{64}$/u;
const SERVICE_KEYS = Object.freeze(['project_work_store', 'project_work_result_review_store']);
const RECORD_REVIEW_KEYS = Object.freeze([
  'owner_id',
  'work_result_id',
  'review_input',
  'now_ms',
]);
const ERROR_MESSAGES = Object.freeze({
  builder_agent_project_work_result_review_service_invalid:
    'Builder agent project work result review could not be verified.',
  builder_agent_project_work_result_review_service_conflict:
    'Builder agent project work result review changed before it could be recorded.',
  builder_agent_project_work_result_review_service_unavailable:
    'Builder agent project work result review service is unavailable.',
});

class BuilderAgentProjectWorkResultReviewServiceError extends Error {
  constructor(code = 'builder_agent_project_work_result_review_service_invalid') {
    const selected = Object.hasOwn(ERROR_MESSAGES, code)
      ? code
      : 'builder_agent_project_work_result_review_service_invalid';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderAgentProjectWorkResultReviewServiceError';
    this.code = selected;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) {
  throw new BuilderAgentProjectWorkResultReviewServiceError(code);
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
  if (!isPlainObject(value)) fail('builder_agent_project_work_result_review_service_invalid');
  const own = Object.keys(value);
  if (own.length !== keys.length) fail('builder_agent_project_work_result_review_service_invalid');
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) fail('builder_agent_project_work_result_review_service_invalid');
  }
}

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
    fail('builder_agent_project_work_result_review_service_invalid');
  }
  return descriptor.value;
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail('builder_agent_project_work_result_review_service_invalid');
  }
  return value;
}

function safeOwnerId(value) {
  if (typeof value !== 'string' || !OWNER_ID_PATTERN.test(value)) {
    fail('builder_agent_project_work_result_review_service_invalid');
  }
  return value;
}

function safeWorkResultId(value) {
  if (typeof value !== 'string' || !WORK_RESULT_ID_PATTERN.test(value)) {
    fail('builder_agent_project_work_result_review_service_invalid');
  }
  return value;
}

function storeMethod(store, name) {
  const descriptor = Object.getOwnPropertyDescriptor(store, name);
  if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') {
    fail('builder_agent_project_work_result_review_service_invalid');
  }
  return descriptor.value.bind(store);
}

function safeStore(value, expectedVersion, methods) {
  if (value === null || typeof value !== 'object' || utilTypes.isProxy(value)) {
    fail('builder_agent_project_work_result_review_service_invalid');
  }
  const versionDescriptor = Object.getOwnPropertyDescriptor(value, 'store_version');
  if (
    !versionDescriptor
    || !Object.hasOwn(versionDescriptor, 'value')
    || versionDescriptor.value !== expectedVersion
  ) fail('builder_agent_project_work_result_review_service_invalid');
  const selected = { store_version: expectedVersion };
  for (const method of methods) selected[method] = storeMethod(value, method);
  return freezeDeep(selected);
}

function safeStores(rawStores) {
  exactObject(rawStores, SERVICE_KEYS);
  return freezeDeep({
    project_work_store: safeStore(
      valueAt(rawStores, 'project_work_store'),
      BUILDER_AGENT_PROJECT_WORK_STORE_VERSION,
      ['read_result', 'list_task_results'],
    ),
    project_work_result_review_store: safeStore(
      valueAt(rawStores, 'project_work_result_review_store'),
      BUILDER_AGENT_PROJECT_WORK_RESULT_REVIEW_STORE_VERSION,
      ['record_review', 'read_review', 'read_review_for_result', 'list_task_reviews'],
    ),
  });
}

function normalizeOperationError(error) {
  if (error instanceof BuilderAgentProjectWorkResultReviewServiceError) {
    return new BuilderAgentProjectWorkResultReviewServiceError(error.code);
  }
  if (error instanceof BuilderAgentProjectWorkResultReviewContractError) {
    return new BuilderAgentProjectWorkResultReviewServiceError(
      'builder_agent_project_work_result_review_service_invalid',
    );
  }
  if (
    error instanceof BuilderAgentProjectWorkStoreError
    || error instanceof BuilderAgentProjectWorkResultReviewStoreError
  ) {
    if (/_conflict$/u.test(error.code)) {
      return new BuilderAgentProjectWorkResultReviewServiceError(
        'builder_agent_project_work_result_review_service_conflict',
      );
    }
    if (/_unavailable$/u.test(error.code)) {
      return new BuilderAgentProjectWorkResultReviewServiceError(
        'builder_agent_project_work_result_review_service_unavailable',
      );
    }
    return new BuilderAgentProjectWorkResultReviewServiceError(
      'builder_agent_project_work_result_review_service_invalid',
    );
  }
  return new BuilderAgentProjectWorkResultReviewServiceError(
    'builder_agent_project_work_result_review_service_unavailable',
  );
}

function serviceEvidence() {
  return freezeDeep({
    service_authority: 'main_owned_agent_project_work_result_review_service',
    project_work_store_authority: 'main_owned_agent_project_work_store',
    project_work_result_review_store_authority: 'main_owned_agent_project_work_result_review_store',
    renderer_authority: 'not_present',
    ipc_authority: 'not_present',
    provider_dispatch: false,
    model_dispatch: false,
    tool_dispatch: false,
    permission_grant_authority: false,
    credential_storage: 'not_present',
    source_access: 'not_present',
    source_write: 'not_present',
    process_run: false,
    revision_authority: false,
    review_authority: 'local_decision_receipt_only',
    review_row_authority: false,
    artifact_authority: false,
    materialization_authority: false,
    recovery_model: 'idempotent_store_replay',
  });
}

function projectWorkResultFact(stores, ownerId, workResultId) {
  const resultRead = stores.project_work_store.read_result({
    work_result_id: workResultId,
    owner_id: ownerId,
  });
  if (resultRead.status !== 'ready' || !resultRead.work_result) {
    fail('builder_agent_project_work_result_review_service_conflict');
  }
  const entry = resultRead.work_result;
  const result = entry.result;
  const taskResults = stores.project_work_store.list_task_results({
    owner_id: result.owner_id,
    project_id: result.project_id,
    task_id: result.task_id,
  });
  if (
    taskResults.status !== 'ready'
    || !taskResults.work_results.some((item) => item.result.work_result_id === workResultId)
  ) fail('builder_agent_project_work_result_review_service_invalid');
  return freezeDeep({ entry, result_read: resultRead, task_results: taskResults });
}

function recordProjectWorkResultReview(stores, rawRequest) {
  exactObject(rawRequest, RECORD_REVIEW_KEYS);
  const ownerId = safeOwnerId(valueAt(rawRequest, 'owner_id'));
  const workResultId = safeWorkResultId(valueAt(rawRequest, 'work_result_id'));
  const nowMs = safeTimestamp(valueAt(rawRequest, 'now_ms'));
  const resultEvidence = projectWorkResultFact(stores, ownerId, workResultId);
  const entry = resultEvidence.entry;
  const review = createBuilderAgentProjectWorkResultReviewRecord(
    valueAt(rawRequest, 'review_input'),
    entry.result,
    entry.assignment,
    entry.status,
    entry.lease,
  );
  if (
    review.reviewed_at_ms !== nowMs
    || review.owner_id !== ownerId
    || review.work_result_id !== workResultId
  ) fail('builder_agent_project_work_result_review_service_invalid');

  const reviewStoreWrite = stores.project_work_result_review_store.record_review({
    assignment: entry.assignment,
    status: entry.status,
    lease: entry.lease,
    result: entry.result,
    review,
  });
  const reviewRead = stores.project_work_result_review_store.read_review({
    work_result_review_id: review.work_result_review_id,
    owner_id: review.owner_id,
  });
  const reviewForResult = stores.project_work_result_review_store.read_review_for_result({
    work_result_id: review.work_result_id,
    owner_id: review.owner_id,
  });
  if (
    reviewRead.status !== 'ready'
    || reviewForResult.status !== 'ready'
    || reviewRead.project_work_result_review.review.work_result_review_id !== review.work_result_review_id
    || reviewForResult.project_work_result_review.review.work_result_review_id !== review.work_result_review_id
  ) fail('builder_agent_project_work_result_review_service_invalid');
  const taskReviews = stores.project_work_result_review_store.list_task_reviews({
    owner_id: review.owner_id,
    project_id: review.project_id,
    task_id: review.task_id,
  });
  if (
    taskReviews.status !== 'ready'
    || !taskReviews.project_work_result_reviews.some(
      (item) => item.review.work_result_review_id === review.work_result_review_id,
    )
  ) fail('builder_agent_project_work_result_review_service_invalid');

  return freezeDeep({
    result_version: BUILDER_AGENT_PROJECT_WORK_RESULT_REVIEW_SERVICE_RESULT_VERSION,
    service_version: BUILDER_AGENT_PROJECT_WORK_RESULT_REVIEW_SERVICE_VERSION,
    operation: 'agent_project_work_result_review_recorded',
    status: 'ready',
    work_kind: review.work_kind,
    result_status: review.result.status,
    decision: review.decision,
    review,
    project_work_result: entry.result,
    result_read: resultEvidence.result_read,
    task_results: resultEvidence.task_results,
    review_read: reviewRead,
    review_for_result: reviewForResult,
    task_reviews: taskReviews,
    operations: {
      project_work_result_review_store: reviewStoreWrite.operation,
    },
    evidence: serviceEvidence(),
  });
}

function createBuilderAgentProjectWorkResultReviewService(rawStores) {
  const stores = safeStores(rawStores);
  return freezeDeep({
    service_version: BUILDER_AGENT_PROJECT_WORK_RESULT_REVIEW_SERVICE_VERSION,

    record_project_work_result_review(rawRequest) {
      try { return recordProjectWorkResultReview(stores, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },
  });
}

module.exports = Object.freeze({
  BUILDER_AGENT_PROJECT_WORK_RESULT_REVIEW_SERVICE_RESULT_VERSION,
  BUILDER_AGENT_PROJECT_WORK_RESULT_REVIEW_SERVICE_VERSION,
  BuilderAgentProjectWorkResultReviewServiceError,
  createBuilderAgentProjectWorkResultReviewService,
});
