'use strict';

const { types: utilTypes } = require('node:util');

const {
  BuilderAgentDelegationResultReviewContractError,
  createBuilderAgentDelegationResultReviewRecord,
} = require('./builder-agent-delegation-result-review-contract.cjs');
const {
  BUILDER_AGENT_DELEGATION_RESULT_ADMISSION_STORE_VERSION,
  BuilderAgentDelegationResultAdmissionStoreError,
} = require('./builder-agent-delegation-result-admission-store.cjs');
const {
  BUILDER_AGENT_DELEGATION_RESULT_REVIEW_STORE_VERSION,
  BuilderAgentDelegationResultReviewStoreError,
} = require('./builder-agent-delegation-result-review-store.cjs');

const BUILDER_AGENT_DELEGATION_RESULT_REVIEW_SERVICE_VERSION =
  'builder-agent-delegation-result-review-service.v1';
const BUILDER_AGENT_DELEGATION_RESULT_REVIEW_SERVICE_RESULT_VERSION =
  'builder-agent-delegation-result-review-service-result.v1';
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const OWNER_ID_PATTERN = new RegExp(`^builder-user:${UUID_SOURCE}$`, 'u');
const DELEGATION_RESULT_ADMISSION_ID_PATTERN =
  /^builder-agent-delegation-result-admission:[0-9a-f]{64}$/u;
const SERVICE_KEYS = Object.freeze(['admission_store', 'review_store']);
const RECORD_REVIEW_KEYS = Object.freeze([
  'owner_id',
  'delegation_result_admission_id',
  'review_input',
  'now_ms',
]);
const ERROR_MESSAGES = Object.freeze({
  builder_agent_delegation_result_review_service_invalid:
    'Builder agent delegation result review could not be verified.',
  builder_agent_delegation_result_review_service_conflict:
    'Builder agent delegation result review changed before it could be recorded.',
  builder_agent_delegation_result_review_service_unavailable:
    'Builder agent delegation result review service is unavailable.',
});

class BuilderAgentDelegationResultReviewServiceError extends Error {
  constructor(code = 'builder_agent_delegation_result_review_service_invalid') {
    const selected = Object.hasOwn(ERROR_MESSAGES, code)
      ? code
      : 'builder_agent_delegation_result_review_service_invalid';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderAgentDelegationResultReviewServiceError';
    this.code = selected;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) {
  throw new BuilderAgentDelegationResultReviewServiceError(code);
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
    fail('builder_agent_delegation_result_review_service_invalid');
  }
  const own = Object.keys(value);
  if (own.length !== keys.length) {
    fail('builder_agent_delegation_result_review_service_invalid');
  }
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) {
      fail('builder_agent_delegation_result_review_service_invalid');
    }
  }
}

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
    fail('builder_agent_delegation_result_review_service_invalid');
  }
  return descriptor.value;
}

function safePattern(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) {
    fail('builder_agent_delegation_result_review_service_invalid');
  }
  return value;
}

function safeOwnerId(value) {
  return safePattern(value, OWNER_ID_PATTERN);
}

function safeDelegationResultAdmissionId(value) {
  return safePattern(value, DELEGATION_RESULT_ADMISSION_ID_PATTERN);
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail('builder_agent_delegation_result_review_service_invalid');
  }
  return value;
}

function storeMethod(store, name) {
  const descriptor = Object.getOwnPropertyDescriptor(store, name);
  if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') {
    fail('builder_agent_delegation_result_review_service_invalid');
  }
  return descriptor.value.bind(store);
}

function safeStore(value, expectedVersion, methods) {
  if (value === null || typeof value !== 'object' || utilTypes.isProxy(value)) {
    fail('builder_agent_delegation_result_review_service_invalid');
  }
  const versionDescriptor = Object.getOwnPropertyDescriptor(value, 'store_version');
  if (
    !versionDescriptor
    || !Object.hasOwn(versionDescriptor, 'value')
    || versionDescriptor.value !== expectedVersion
  ) fail('builder_agent_delegation_result_review_service_invalid');
  const selected = { store_version: expectedVersion };
  for (const method of methods) selected[method] = storeMethod(value, method);
  return freezeDeep(selected);
}

function safeStores(rawStores) {
  exactObject(rawStores, SERVICE_KEYS);
  return freezeDeep({
    admission_store: safeStore(
      valueAt(rawStores, 'admission_store'),
      BUILDER_AGENT_DELEGATION_RESULT_ADMISSION_STORE_VERSION,
      ['read_admission', 'list_parent_task_admissions', 'list_child_task_admissions'],
    ),
    review_store: safeStore(
      valueAt(rawStores, 'review_store'),
      BUILDER_AGENT_DELEGATION_RESULT_REVIEW_STORE_VERSION,
      ['record_review', 'read_review', 'read_review_for_admission', 'list_parent_task_reviews', 'list_child_task_reviews'],
    ),
  });
}

function normalizeOperationError(error) {
  if (error instanceof BuilderAgentDelegationResultReviewServiceError) {
    return new BuilderAgentDelegationResultReviewServiceError(error.code);
  }
  if (error instanceof BuilderAgentDelegationResultReviewContractError) {
    return new BuilderAgentDelegationResultReviewServiceError(
      'builder_agent_delegation_result_review_service_invalid',
    );
  }
  if (
    error instanceof BuilderAgentDelegationResultAdmissionStoreError
    || error instanceof BuilderAgentDelegationResultReviewStoreError
  ) {
    if (/_conflict$/u.test(error.code) || /_not_found$/u.test(error.code)) {
      return new BuilderAgentDelegationResultReviewServiceError(
        'builder_agent_delegation_result_review_service_conflict',
      );
    }
    if (/_unavailable$/u.test(error.code)) {
      return new BuilderAgentDelegationResultReviewServiceError(
        'builder_agent_delegation_result_review_service_unavailable',
      );
    }
    return new BuilderAgentDelegationResultReviewServiceError(
      'builder_agent_delegation_result_review_service_invalid',
    );
  }
  return new BuilderAgentDelegationResultReviewServiceError(
    'builder_agent_delegation_result_review_service_unavailable',
  );
}

function serviceEvidence() {
  return freezeDeep({
    service_authority: 'main_owned_agent_delegation_result_review_service',
    admission_store_authority: 'main_owned_agent_delegation_result_admission_store',
    review_store_authority: 'main_owned_agent_delegation_result_review_store',
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

function readRecordedAdmissionFact(stores, ownerId, delegationResultAdmissionId) {
  const admissionRead = stores.admission_store.read_admission({
    delegation_result_admission_id: delegationResultAdmissionId,
    owner_id: ownerId,
  });
  if (
    admissionRead.status !== 'ready'
    || !admissionRead.delegation_result_admission
    || !admissionRead.delegation_result_admission.delegation
    || !admissionRead.delegation_result_admission.result
    || !admissionRead.delegation_result_admission.admission
    || admissionRead.delegation_result_admission.admission.delegation_result_admission_id
      !== delegationResultAdmissionId
    || admissionRead.delegation_result_admission.admission.owner_id !== ownerId
  ) fail('builder_agent_delegation_result_review_service_conflict');
  const admission = admissionRead.delegation_result_admission.admission;
  const parentTaskAdmissions = stores.admission_store.list_parent_task_admissions({
    owner_id: ownerId,
    project_id: admission.project_id,
    parent_task_id: admission.parent_task_id,
  });
  if (
    parentTaskAdmissions.status !== 'ready'
    || !parentTaskAdmissions.delegation_result_admissions.some(
      (entry) => entry.admission.delegation_result_admission_id === delegationResultAdmissionId,
    )
  ) fail('builder_agent_delegation_result_review_service_invalid');
  const childTaskAdmissions = stores.admission_store.list_child_task_admissions({
    owner_id: ownerId,
    project_id: admission.project_id,
    child_task_id: admission.child_task_id,
  });
  if (
    childTaskAdmissions.status !== 'ready'
    || !childTaskAdmissions.delegation_result_admissions.some(
      (entry) => entry.admission.delegation_result_admission_id === delegationResultAdmissionId,
    )
  ) fail('builder_agent_delegation_result_review_service_invalid');
  return freezeDeep({
    admission_read: admissionRead,
    parent_task_admissions: parentTaskAdmissions,
    child_task_admissions: childTaskAdmissions,
  });
}

function recordDelegationResultReview(stores, rawRequest) {
  exactObject(rawRequest, RECORD_REVIEW_KEYS);
  const ownerId = safeOwnerId(valueAt(rawRequest, 'owner_id'));
  const delegationResultAdmissionId = safeDelegationResultAdmissionId(
    valueAt(rawRequest, 'delegation_result_admission_id'),
  );
  const nowMs = safeTimestamp(valueAt(rawRequest, 'now_ms'));
  const admissionEvidence = readRecordedAdmissionFact(stores, ownerId, delegationResultAdmissionId);
  const delegation = admissionEvidence.admission_read.delegation_result_admission.delegation;
  const result = admissionEvidence.admission_read.delegation_result_admission.result;
  const admission = admissionEvidence.admission_read.delegation_result_admission.admission;
  const review = createBuilderAgentDelegationResultReviewRecord(
    valueAt(rawRequest, 'review_input'),
    admission,
    result,
    delegation,
  );
  if (
    review.owner_id !== ownerId
    || review.delegation_result_admission_id !== delegationResultAdmissionId
    || review.reviewed_at_ms !== nowMs
  ) fail('builder_agent_delegation_result_review_service_invalid');

  const reviewWrite = stores.review_store.record_review({
    delegation,
    result,
    admission,
    review,
  });
  const reviewRead = stores.review_store.read_review({
    delegation_result_review_id: review.delegation_result_review_id,
    owner_id: ownerId,
  });
  if (
    reviewRead.status !== 'ready'
    || !reviewRead.delegation_result_review
    || reviewRead.delegation_result_review.review.delegation_result_review_id
      !== review.delegation_result_review_id
  ) fail('builder_agent_delegation_result_review_service_invalid');
  const reviewForAdmission = stores.review_store.read_review_for_admission({
    delegation_result_admission_id: delegationResultAdmissionId,
    owner_id: ownerId,
  });
  if (
    reviewForAdmission.status !== 'ready'
    || !reviewForAdmission.delegation_result_review
    || reviewForAdmission.delegation_result_review.review.delegation_result_review_id
      !== review.delegation_result_review_id
  ) fail('builder_agent_delegation_result_review_service_invalid');
  const parentTaskReviews = stores.review_store.list_parent_task_reviews({
    owner_id: ownerId,
    project_id: review.project_id,
    parent_task_id: review.parent_task_id,
  });
  if (
    parentTaskReviews.status !== 'ready'
    || !parentTaskReviews.delegation_result_reviews.some(
      (entry) => entry.review.delegation_result_review_id === review.delegation_result_review_id,
    )
  ) fail('builder_agent_delegation_result_review_service_invalid');
  const childTaskReviews = stores.review_store.list_child_task_reviews({
    owner_id: ownerId,
    project_id: review.project_id,
    child_task_id: review.child_task_id,
  });
  if (
    childTaskReviews.status !== 'ready'
    || !childTaskReviews.delegation_result_reviews.some(
      (entry) => entry.review.delegation_result_review_id === review.delegation_result_review_id,
    )
  ) fail('builder_agent_delegation_result_review_service_invalid');

  return freezeDeep({
    result_version: BUILDER_AGENT_DELEGATION_RESULT_REVIEW_SERVICE_RESULT_VERSION,
    service_version: BUILDER_AGENT_DELEGATION_RESULT_REVIEW_SERVICE_VERSION,
    operation: 'agent_delegation_result_review_recorded',
    status: 'ready',
    result_status: review.result.status,
    decision: review.decision,
    delegation_result_review: review,
    admission_read: admissionEvidence.admission_read,
    parent_task_admissions: admissionEvidence.parent_task_admissions,
    child_task_admissions: admissionEvidence.child_task_admissions,
    review_write: reviewWrite,
    review_read: reviewRead,
    review_for_admission: reviewForAdmission,
    parent_task_reviews: parentTaskReviews,
    child_task_reviews: childTaskReviews,
    operations: {
      review_store: reviewWrite.operation,
    },
    evidence: serviceEvidence(),
  });
}

function createBuilderAgentDelegationResultReviewService(rawStores) {
  const stores = safeStores(rawStores);
  return freezeDeep({
    service_version: BUILDER_AGENT_DELEGATION_RESULT_REVIEW_SERVICE_VERSION,

    record_delegation_result_review(rawRequest) {
      try { return recordDelegationResultReview(stores, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },
  });
}

module.exports = Object.freeze({
  BUILDER_AGENT_DELEGATION_RESULT_REVIEW_SERVICE_RESULT_VERSION,
  BUILDER_AGENT_DELEGATION_RESULT_REVIEW_SERVICE_VERSION,
  BuilderAgentDelegationResultReviewServiceError,
  createBuilderAgentDelegationResultReviewService,
});
