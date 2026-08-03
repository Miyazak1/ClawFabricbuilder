'use strict';

const { types: utilTypes } = require('node:util');

const {
  BuilderAgentDelegationResultReviewStoreError,
  BUILDER_AGENT_DELEGATION_RESULT_REVIEW_STORE_VERSION,
} = require('./builder-agent-delegation-result-review-store.cjs');
const {
  BuilderAgentDelegationResultParentMaterializationEligibilityError,
  createBuilderAgentDelegationResultParentMaterializationEligibilityRecord,
} = require('./builder-agent-delegation-result-parent-materialization-eligibility.cjs');
const {
  BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_ELIGIBILITY_STORE_VERSION,
  BuilderAgentDelegationResultParentMaterializationEligibilityStoreError,
} = require('./builder-agent-delegation-result-parent-materialization-eligibility-store.cjs');

const BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_ELIGIBILITY_SERVICE_VERSION =
  'builder-agent-delegation-result-parent-materialization-eligibility-service.v1';
const BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_ELIGIBILITY_SERVICE_RESULT_VERSION =
  'builder-agent-delegation-result-parent-materialization-eligibility-service-result.v1';
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const OWNER_ID_PATTERN = new RegExp(`^builder-user:${UUID_SOURCE}$`, 'u');
const DELEGATION_RESULT_REVIEW_ID_PATTERN =
  /^builder-agent-delegation-result-review:[0-9a-f]{64}$/u;
const SERVICE_KEYS = Object.freeze(['review_store', 'eligibility_store']);
const RECORD_ELIGIBILITY_KEYS = Object.freeze([
  'owner_id',
  'delegation_result_review_id',
  'eligibility_input',
  'now_ms',
]);
const ERROR_MESSAGES = Object.freeze({
  builder_agent_delegation_result_parent_materialization_eligibility_service_invalid:
    'Builder agent delegation result parent materialization eligibility could not be verified.',
  builder_agent_delegation_result_parent_materialization_eligibility_service_conflict:
    'Builder agent delegation result parent materialization eligibility changed before it could be recorded.',
  builder_agent_delegation_result_parent_materialization_eligibility_service_unavailable:
    'Builder agent delegation result parent materialization eligibility service is unavailable.',
});

class BuilderAgentDelegationResultParentMaterializationEligibilityServiceError extends Error {
  constructor(code = 'builder_agent_delegation_result_parent_materialization_eligibility_service_invalid') {
    const selected = Object.hasOwn(ERROR_MESSAGES, code)
      ? code
      : 'builder_agent_delegation_result_parent_materialization_eligibility_service_invalid';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderAgentDelegationResultParentMaterializationEligibilityServiceError';
    this.code = selected;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) {
  throw new BuilderAgentDelegationResultParentMaterializationEligibilityServiceError(code);
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
  if (!isPlainObject(value)) {
    fail('builder_agent_delegation_result_parent_materialization_eligibility_service_invalid');
  }
  const own = Object.keys(value);
  if (own.length !== keys.length) {
    fail('builder_agent_delegation_result_parent_materialization_eligibility_service_invalid');
  }
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) {
      fail('builder_agent_delegation_result_parent_materialization_eligibility_service_invalid');
    }
  }
}

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
    fail('builder_agent_delegation_result_parent_materialization_eligibility_service_invalid');
  }
  return descriptor.value;
}

function safePattern(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) {
    fail('builder_agent_delegation_result_parent_materialization_eligibility_service_invalid');
  }
  return value;
}

function safeOwnerId(value) {
  return safePattern(value, OWNER_ID_PATTERN);
}

function safeDelegationResultReviewId(value) {
  return safePattern(value, DELEGATION_RESULT_REVIEW_ID_PATTERN);
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail('builder_agent_delegation_result_parent_materialization_eligibility_service_invalid');
  }
  return value;
}

function storeMethod(store, name) {
  const descriptor = Object.getOwnPropertyDescriptor(store, name);
  if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') {
    fail('builder_agent_delegation_result_parent_materialization_eligibility_service_invalid');
  }
  return descriptor.value.bind(store);
}

function safeStore(value, expectedVersion, methods) {
  if (value === null || typeof value !== 'object' || utilTypes.isProxy(value)) {
    fail('builder_agent_delegation_result_parent_materialization_eligibility_service_invalid');
  }
  const versionDescriptor = Object.getOwnPropertyDescriptor(value, 'store_version');
  if (
    !versionDescriptor
    || !Object.hasOwn(versionDescriptor, 'value')
    || versionDescriptor.value !== expectedVersion
  ) fail('builder_agent_delegation_result_parent_materialization_eligibility_service_invalid');
  const selected = { store_version: expectedVersion };
  for (const method of methods) selected[method] = storeMethod(value, method);
  return freezeDeep(selected);
}

function safeStores(rawStores) {
  exactObject(rawStores, SERVICE_KEYS);
  return freezeDeep({
    review_store: safeStore(
      valueAt(rawStores, 'review_store'),
      BUILDER_AGENT_DELEGATION_RESULT_REVIEW_STORE_VERSION,
      ['read_review', 'list_parent_task_reviews', 'list_child_task_reviews'],
    ),
    eligibility_store: safeStore(
      valueAt(rawStores, 'eligibility_store'),
      BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_ELIGIBILITY_STORE_VERSION,
      [
        'record_eligibility',
        'read_eligibility',
        'read_eligibility_for_review',
        'list_parent_task_eligibilities',
        'list_child_task_eligibilities',
      ],
    ),
  });
}

function normalizeOperationError(error) {
  if (error instanceof BuilderAgentDelegationResultParentMaterializationEligibilityServiceError) {
    return new BuilderAgentDelegationResultParentMaterializationEligibilityServiceError(error.code);
  }
  if (error instanceof BuilderAgentDelegationResultParentMaterializationEligibilityError) {
    return new BuilderAgentDelegationResultParentMaterializationEligibilityServiceError(
      'builder_agent_delegation_result_parent_materialization_eligibility_service_invalid',
    );
  }
  if (
    error instanceof BuilderAgentDelegationResultReviewStoreError
    || error instanceof BuilderAgentDelegationResultParentMaterializationEligibilityStoreError
  ) {
    if (/_conflict$/u.test(error.code) || /_not_found$/u.test(error.code)) {
      return new BuilderAgentDelegationResultParentMaterializationEligibilityServiceError(
        'builder_agent_delegation_result_parent_materialization_eligibility_service_conflict',
      );
    }
    if (/_unavailable$/u.test(error.code)) {
      return new BuilderAgentDelegationResultParentMaterializationEligibilityServiceError(
        'builder_agent_delegation_result_parent_materialization_eligibility_service_unavailable',
      );
    }
    return new BuilderAgentDelegationResultParentMaterializationEligibilityServiceError(
      'builder_agent_delegation_result_parent_materialization_eligibility_service_invalid',
    );
  }
  return new BuilderAgentDelegationResultParentMaterializationEligibilityServiceError(
    'builder_agent_delegation_result_parent_materialization_eligibility_service_unavailable',
  );
}

function serviceEvidence() {
  return freezeDeep({
    service_authority:
      'main_owned_agent_delegation_result_parent_materialization_eligibility_service',
    review_store_authority: 'main_owned_agent_delegation_result_review_store',
    eligibility_store_authority:
      'main_owned_agent_delegation_result_parent_materialization_eligibility_store',
    renderer_authority: 'not_present',
    ipc_authority: 'not_present',
    child_assignment_authority: false,
    child_run_authority: false,
    provider_dispatch: false,
    model_dispatch: false,
    tool_dispatch: false,
    permission_grant_authority: false,
    credential_storage: 'not_present',
    source_access: 'not_present',
    source_read: 'not_present',
    source_write: 'not_present',
    process_run: false,
    network_access: false,
    revision_authority: false,
    review_authority: 'local_decision_receipt_only',
    review_row_authority: false,
    artifact_authority: false,
    parent_materialization_authority: false,
    recovery_model: 'idempotent_store_replay',
  });
}

function readRecordedReviewFact(stores, ownerId, delegationResultReviewId) {
  const reviewRead = stores.review_store.read_review({
    delegation_result_review_id: delegationResultReviewId,
    owner_id: ownerId,
  });
  if (
    reviewRead.status !== 'ready'
    || !reviewRead.delegation_result_review
    || !reviewRead.delegation_result_review.delegation
    || !reviewRead.delegation_result_review.result
    || !reviewRead.delegation_result_review.admission
    || !reviewRead.delegation_result_review.review
    || reviewRead.delegation_result_review.review.delegation_result_review_id
      !== delegationResultReviewId
    || reviewRead.delegation_result_review.review.owner_id !== ownerId
  ) fail('builder_agent_delegation_result_parent_materialization_eligibility_service_conflict');
  const review = reviewRead.delegation_result_review.review;
  const parentTaskReviews = stores.review_store.list_parent_task_reviews({
    owner_id: ownerId,
    project_id: review.project_id,
    parent_task_id: review.parent_task_id,
  });
  if (
    parentTaskReviews.status !== 'ready'
    || !parentTaskReviews.delegation_result_reviews.some(
      (entry) => entry.review.delegation_result_review_id === delegationResultReviewId,
    )
  ) fail('builder_agent_delegation_result_parent_materialization_eligibility_service_invalid');
  const childTaskReviews = stores.review_store.list_child_task_reviews({
    owner_id: ownerId,
    project_id: review.project_id,
    child_task_id: review.child_task_id,
  });
  if (
    childTaskReviews.status !== 'ready'
    || !childTaskReviews.delegation_result_reviews.some(
      (entry) => entry.review.delegation_result_review_id === delegationResultReviewId,
    )
  ) fail('builder_agent_delegation_result_parent_materialization_eligibility_service_invalid');
  return freezeDeep({ review_read: reviewRead, parent_task_reviews: parentTaskReviews, child_task_reviews: childTaskReviews });
}

function recordDelegationResultParentMaterializationEligibility(stores, rawRequest) {
  exactObject(rawRequest, RECORD_ELIGIBILITY_KEYS);
  const ownerId = safeOwnerId(valueAt(rawRequest, 'owner_id'));
  const delegationResultReviewId = safeDelegationResultReviewId(
    valueAt(rawRequest, 'delegation_result_review_id'),
  );
  const nowMs = safeTimestamp(valueAt(rawRequest, 'now_ms'));
  const reviewEvidence = readRecordedReviewFact(stores, ownerId, delegationResultReviewId);
  const delegation = reviewEvidence.review_read.delegation_result_review.delegation;
  const result = reviewEvidence.review_read.delegation_result_review.result;
  const admission = reviewEvidence.review_read.delegation_result_review.admission;
  const review = reviewEvidence.review_read.delegation_result_review.review;
  const eligibility = createBuilderAgentDelegationResultParentMaterializationEligibilityRecord(
    valueAt(rawRequest, 'eligibility_input'),
    review,
    admission,
    result,
    delegation,
  );
  if (
    eligibility.owner_id !== ownerId
    || eligibility.delegation_result_review_id !== delegationResultReviewId
    || eligibility.eligibility_recorded_at_ms !== nowMs
  ) fail('builder_agent_delegation_result_parent_materialization_eligibility_service_invalid');

  const eligibilityWrite = stores.eligibility_store.record_eligibility({
    delegation,
    result,
    admission,
    review,
    eligibility,
  });
  const eligibilityRead = stores.eligibility_store.read_eligibility({
    delegation_result_parent_materialization_eligibility_id:
      eligibility.delegation_result_parent_materialization_eligibility_id,
    owner_id: ownerId,
  });
  if (
    eligibilityRead.status !== 'ready'
    || !eligibilityRead.delegation_result_parent_materialization_eligibility
    || eligibilityRead.delegation_result_parent_materialization_eligibility
      .eligibility.delegation_result_parent_materialization_eligibility_id
        !== eligibility.delegation_result_parent_materialization_eligibility_id
  ) fail('builder_agent_delegation_result_parent_materialization_eligibility_service_invalid');
  const eligibilityForReview = stores.eligibility_store.read_eligibility_for_review({
    delegation_result_review_id: delegationResultReviewId,
    owner_id: ownerId,
  });
  if (
    eligibilityForReview.status !== 'ready'
    || !eligibilityForReview.delegation_result_parent_materialization_eligibility
    || eligibilityForReview.delegation_result_parent_materialization_eligibility
      .eligibility.delegation_result_parent_materialization_eligibility_id
        !== eligibility.delegation_result_parent_materialization_eligibility_id
  ) fail('builder_agent_delegation_result_parent_materialization_eligibility_service_invalid');
  const parentTaskEligibilities = stores.eligibility_store.list_parent_task_eligibilities({
    owner_id: ownerId,
    project_id: eligibility.project_id,
    parent_task_id: eligibility.parent_task_id,
  });
  if (
    parentTaskEligibilities.status !== 'ready'
    || !parentTaskEligibilities.delegation_result_parent_materialization_eligibilities.some(
      (entry) => entry.eligibility.delegation_result_parent_materialization_eligibility_id
        === eligibility.delegation_result_parent_materialization_eligibility_id,
    )
  ) fail('builder_agent_delegation_result_parent_materialization_eligibility_service_invalid');
  const childTaskEligibilities = stores.eligibility_store.list_child_task_eligibilities({
    owner_id: ownerId,
    project_id: eligibility.project_id,
    child_task_id: eligibility.child_task_id,
  });
  if (
    childTaskEligibilities.status !== 'ready'
    || !childTaskEligibilities.delegation_result_parent_materialization_eligibilities.some(
      (entry) => entry.eligibility.delegation_result_parent_materialization_eligibility_id
        === eligibility.delegation_result_parent_materialization_eligibility_id,
    )
  ) fail('builder_agent_delegation_result_parent_materialization_eligibility_service_invalid');

  return freezeDeep({
    result_version:
      BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_ELIGIBILITY_SERVICE_RESULT_VERSION,
    service_version:
      BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_ELIGIBILITY_SERVICE_VERSION,
    operation: 'agent_delegation_result_parent_materialization_eligibility_recorded',
    status: 'ready',
    result_status: eligibility.result.status,
    decision: eligibility.decision,
    eligibility_status: eligibility.eligibility_status,
    delegation_result_parent_materialization_eligibility: eligibility,
    review_read: reviewEvidence.review_read,
    parent_task_reviews: reviewEvidence.parent_task_reviews,
    child_task_reviews: reviewEvidence.child_task_reviews,
    eligibility_write: eligibilityWrite,
    eligibility_read: eligibilityRead,
    eligibility_for_review: eligibilityForReview,
    parent_task_eligibilities: parentTaskEligibilities,
    child_task_eligibilities: childTaskEligibilities,
    operations: {
      eligibility_store: eligibilityWrite.operation,
    },
    evidence: serviceEvidence(),
  });
}

function createBuilderAgentDelegationResultParentMaterializationEligibilityService(rawStores) {
  const stores = safeStores(rawStores);
  return freezeDeep({
    service_version: BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_ELIGIBILITY_SERVICE_VERSION,

    record_delegation_result_parent_materialization_eligibility(rawRequest) {
      try {
        return recordDelegationResultParentMaterializationEligibility(stores, rawRequest);
      } catch (error) {
        throw normalizeOperationError(error);
      }
    },
  });
}

module.exports = Object.freeze({
  BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_ELIGIBILITY_SERVICE_RESULT_VERSION,
  BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_ELIGIBILITY_SERVICE_VERSION,
  BuilderAgentDelegationResultParentMaterializationEligibilityServiceError,
  createBuilderAgentDelegationResultParentMaterializationEligibilityService,
});
