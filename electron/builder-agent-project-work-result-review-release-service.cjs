'use strict';

const { types: utilTypes } = require('node:util');

const {
  BUILDER_AGENT_PROJECT_WORK_RESULT_REVIEW_STORE_VERSION,
  BuilderAgentProjectWorkResultReviewStoreError,
} = require('./builder-agent-project-work-result-review-store.cjs');
const {
  BUILDER_AGENT_SUPERVISION_LEASE_RELEASE_RECORD_VERSION,
  BuilderAgentSupervisionLeaseContractError,
  createBuilderAgentSupervisionLeaseReleaseRecord,
} = require('./builder-agent-supervision-lease-contract.cjs');
const {
  BUILDER_AGENT_SUPERVISION_LEASE_STORE_VERSION,
  BuilderAgentSupervisionLeaseStoreError,
} = require('./builder-agent-supervision-lease-store.cjs');

const BUILDER_AGENT_PROJECT_WORK_RESULT_REVIEW_RELEASE_SERVICE_VERSION =
  'builder-agent-project-work-result-review-release-service.v1';
const BUILDER_AGENT_PROJECT_WORK_RESULT_REVIEW_RELEASE_SERVICE_RESULT_VERSION =
  'builder-agent-project-work-result-review-release-service-result.v1';
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const OWNER_ID_PATTERN = new RegExp(`^builder-user:${UUID_SOURCE}$`, 'u');
const WORK_RESULT_REVIEW_ID_PATTERN =
  /^builder-agent-project-work-result-review:[0-9a-f]{64}$/u;
const SERVICE_KEYS = Object.freeze(['project_work_result_review_store', 'lease_store']);
const RELEASE_REVIEW_KEYS = Object.freeze(['owner_id', 'work_result_review_id', 'now_ms']);
const ERROR_MESSAGES = Object.freeze({
  builder_agent_project_work_result_review_release_service_invalid:
    'Builder agent project work result review release could not be verified.',
  builder_agent_project_work_result_review_release_service_conflict:
    'Builder agent project work result review release changed before it could be recorded.',
  builder_agent_project_work_result_review_release_service_unavailable:
    'Builder agent project work result review release service is unavailable.',
});

class BuilderAgentProjectWorkResultReviewReleaseServiceError extends Error {
  constructor(code = 'builder_agent_project_work_result_review_release_service_invalid') {
    const selected = Object.hasOwn(ERROR_MESSAGES, code)
      ? code
      : 'builder_agent_project_work_result_review_release_service_invalid';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderAgentProjectWorkResultReviewReleaseServiceError';
    this.code = selected;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) {
  throw new BuilderAgentProjectWorkResultReviewReleaseServiceError(code);
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
    fail('builder_agent_project_work_result_review_release_service_invalid');
  }
  const own = Object.keys(value);
  if (own.length !== keys.length) {
    fail('builder_agent_project_work_result_review_release_service_invalid');
  }
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) {
      fail('builder_agent_project_work_result_review_release_service_invalid');
    }
  }
}

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
    fail('builder_agent_project_work_result_review_release_service_invalid');
  }
  return descriptor.value;
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail('builder_agent_project_work_result_review_release_service_invalid');
  }
  return value;
}

function safeOwnerId(value) {
  if (typeof value !== 'string' || !OWNER_ID_PATTERN.test(value)) {
    fail('builder_agent_project_work_result_review_release_service_invalid');
  }
  return value;
}

function safeWorkResultReviewId(value) {
  if (typeof value !== 'string' || !WORK_RESULT_REVIEW_ID_PATTERN.test(value)) {
    fail('builder_agent_project_work_result_review_release_service_invalid');
  }
  return value;
}

function storeMethod(store, name) {
  const descriptor = Object.getOwnPropertyDescriptor(store, name);
  if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') {
    fail('builder_agent_project_work_result_review_release_service_invalid');
  }
  return descriptor.value.bind(store);
}

function safeStore(value, expectedVersion, methods) {
  if (value === null || typeof value !== 'object' || utilTypes.isProxy(value)) {
    fail('builder_agent_project_work_result_review_release_service_invalid');
  }
  const versionDescriptor = Object.getOwnPropertyDescriptor(value, 'store_version');
  if (
    !versionDescriptor
    || !Object.hasOwn(versionDescriptor, 'value')
    || versionDescriptor.value !== expectedVersion
  ) fail('builder_agent_project_work_result_review_release_service_invalid');
  const selected = { store_version: expectedVersion };
  for (const method of methods) selected[method] = storeMethod(value, method);
  return freezeDeep(selected);
}

function safeStores(rawStores) {
  exactObject(rawStores, SERVICE_KEYS);
  return freezeDeep({
    project_work_result_review_store: safeStore(
      valueAt(rawStores, 'project_work_result_review_store'),
      BUILDER_AGENT_PROJECT_WORK_RESULT_REVIEW_STORE_VERSION,
      ['read_review', 'list_task_reviews'],
    ),
    lease_store: safeStore(
      valueAt(rawStores, 'lease_store'),
      BUILDER_AGENT_SUPERVISION_LEASE_STORE_VERSION,
      ['record_release', 'read_lease', 'read_assignment_leases'],
    ),
  });
}

function normalizeOperationError(error) {
  if (error instanceof BuilderAgentProjectWorkResultReviewReleaseServiceError) {
    return new BuilderAgentProjectWorkResultReviewReleaseServiceError(error.code);
  }
  if (error instanceof BuilderAgentSupervisionLeaseContractError) {
    return new BuilderAgentProjectWorkResultReviewReleaseServiceError(
      'builder_agent_project_work_result_review_release_service_invalid',
    );
  }
  if (
    error instanceof BuilderAgentProjectWorkResultReviewStoreError
    || error instanceof BuilderAgentSupervisionLeaseStoreError
  ) {
    if (/_conflict$/u.test(error.code) || /_not_found$/u.test(error.code)) {
      return new BuilderAgentProjectWorkResultReviewReleaseServiceError(
        'builder_agent_project_work_result_review_release_service_conflict',
      );
    }
    if (/_unavailable$/u.test(error.code)) {
      return new BuilderAgentProjectWorkResultReviewReleaseServiceError(
        'builder_agent_project_work_result_review_release_service_unavailable',
      );
    }
    return new BuilderAgentProjectWorkResultReviewReleaseServiceError(
      'builder_agent_project_work_result_review_release_service_invalid',
    );
  }
  return new BuilderAgentProjectWorkResultReviewReleaseServiceError(
    'builder_agent_project_work_result_review_release_service_unavailable',
  );
}

function serviceEvidence() {
  return freezeDeep({
    service_authority: 'main_owned_agent_project_work_result_review_release_service',
    project_work_result_review_store_authority:
      'main_owned_agent_project_work_result_review_store',
    lease_store_authority: 'main_owned_agent_supervision_lease_store',
    lease_release_authority: 'main_owned_agent_supervision_lease_store',
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
    assignment_status_authority: false,
    recovery_model: 'idempotent_store_replay',
  });
}

function readReviewFact(stores, ownerId, workResultReviewId) {
  const reviewRead = stores.project_work_result_review_store.read_review({
    work_result_review_id: workResultReviewId,
    owner_id: ownerId,
  });
  if (reviewRead.status !== 'ready' || !reviewRead.project_work_result_review) {
    fail('builder_agent_project_work_result_review_release_service_conflict');
  }
  const entry = reviewRead.project_work_result_review;
  const review = entry.review;
  const taskReviews = stores.project_work_result_review_store.list_task_reviews({
    owner_id: review.owner_id,
    project_id: review.project_id,
    task_id: review.task_id,
  });
  if (
    taskReviews.status !== 'ready'
    || !taskReviews.project_work_result_reviews.some(
      (item) => item.review.work_result_review_id === workResultReviewId,
    )
  ) fail('builder_agent_project_work_result_review_release_service_invalid');
  return freezeDeep({ entry, review_read: reviewRead, task_reviews: taskReviews });
}

function createReleaseForReviewedWork(review, lease, nowMs) {
  if (nowMs < review.reviewed_at_ms) {
    fail('builder_agent_project_work_result_review_release_service_invalid');
  }
  return createBuilderAgentSupervisionLeaseReleaseRecord({
    record_version: BUILDER_AGENT_SUPERVISION_LEASE_RELEASE_RECORD_VERSION,
    lease_id: review.lease_id,
    assignment_id: review.assignment_id,
    owner_id: review.owner_id,
    lease_holder_id: review.lease_holder_id,
    released_by: review.lease_holder_id,
    released_at_ms: nowMs,
    release_outcome: 'completed',
    reason: 'Owner review closed the supervised project work result.',
  }, lease);
}

function releaseReviewedProjectWorkResult(stores, rawRequest) {
  exactObject(rawRequest, RELEASE_REVIEW_KEYS);
  const ownerId = safeOwnerId(valueAt(rawRequest, 'owner_id'));
  const workResultReviewId = safeWorkResultReviewId(valueAt(rawRequest, 'work_result_review_id'));
  const nowMs = safeTimestamp(valueAt(rawRequest, 'now_ms'));
  const reviewEvidence = readReviewFact(stores, ownerId, workResultReviewId);
  const entry = reviewEvidence.entry;
  const review = entry.review;
  const leaseReadBefore = stores.lease_store.read_lease({
    lease_id: review.lease_id,
    owner_id: review.owner_id,
  });
  if (
    leaseReadBefore.status !== 'ready'
    || !leaseReadBefore.lease
    || leaseReadBefore.lease.lease_id !== review.lease_id
  ) fail('builder_agent_project_work_result_review_release_service_conflict');

  const release = createReleaseForReviewedWork(review, entry.lease, nowMs);
  const releaseStoreWrite = stores.lease_store.record_release({ release });
  const leaseRead = stores.lease_store.read_lease({
    lease_id: release.lease_id,
    owner_id: release.owner_id,
  });
  if (
    leaseRead.status !== 'ready'
    || !leaseRead.release
    || leaseRead.release.lease_release_id !== release.lease_release_id
  ) fail('builder_agent_project_work_result_review_release_service_invalid');
  const assignmentLeases = stores.lease_store.read_assignment_leases({
    assignment_id: release.assignment_id,
    owner_id: release.owner_id,
    now_ms: release.released_at_ms,
  });
  if (
    assignmentLeases.status !== 'ready'
    || assignmentLeases.active_lease !== null
  ) fail('builder_agent_project_work_result_review_release_service_invalid');

  return freezeDeep({
    result_version: BUILDER_AGENT_PROJECT_WORK_RESULT_REVIEW_RELEASE_SERVICE_RESULT_VERSION,
    service_version: BUILDER_AGENT_PROJECT_WORK_RESULT_REVIEW_RELEASE_SERVICE_VERSION,
    operation: 'agent_project_work_result_review_released',
    status: 'ready',
    work_kind: review.work_kind,
    result_status: review.result.status,
    decision: review.decision,
    review,
    release,
    project_work_result_review: entry,
    review_read: reviewEvidence.review_read,
    task_reviews: reviewEvidence.task_reviews,
    lease_read_before: leaseReadBefore,
    lease_read: leaseRead,
    assignment_leases: assignmentLeases,
    operations: {
      lease_store: releaseStoreWrite.operation,
    },
    evidence: serviceEvidence(),
  });
}

function createBuilderAgentProjectWorkResultReviewReleaseService(rawStores) {
  const stores = safeStores(rawStores);
  return freezeDeep({
    service_version: BUILDER_AGENT_PROJECT_WORK_RESULT_REVIEW_RELEASE_SERVICE_VERSION,

    release_reviewed_project_work_result(rawRequest) {
      try { return releaseReviewedProjectWorkResult(stores, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },
  });
}

module.exports = Object.freeze({
  BUILDER_AGENT_PROJECT_WORK_RESULT_REVIEW_RELEASE_SERVICE_RESULT_VERSION,
  BUILDER_AGENT_PROJECT_WORK_RESULT_REVIEW_RELEASE_SERVICE_VERSION,
  BuilderAgentProjectWorkResultReviewReleaseServiceError,
  createBuilderAgentProjectWorkResultReviewReleaseService,
});
