'use strict';

const { types: utilTypes } = require('node:util');

const {
  BuilderAgentAssignmentContractError,
  createBuilderAgentAssignmentStatusRecord,
} = require('./builder-agent-assignment-contract.cjs');
const {
  BUILDER_AGENT_ASSIGNMENT_STORE_VERSION,
  BuilderAgentAssignmentStoreError,
} = require('./builder-agent-assignment-store.cjs');
const {
  BUILDER_AGENT_PROJECT_WORK_RESULT_REVIEW_STORE_VERSION,
  BuilderAgentProjectWorkResultReviewStoreError,
} = require('./builder-agent-project-work-result-review-store.cjs');
const {
  BUILDER_AGENT_SUPERVISION_LEASE_STORE_VERSION,
  BuilderAgentSupervisionLeaseStoreError,
} = require('./builder-agent-supervision-lease-store.cjs');

const BUILDER_AGENT_PROJECT_WORK_RESULT_REVIEW_ASSIGNMENT_CLOSE_SERVICE_VERSION =
  'builder-agent-project-work-result-review-assignment-close-service.v1';
const BUILDER_AGENT_PROJECT_WORK_RESULT_REVIEW_ASSIGNMENT_CLOSE_SERVICE_RESULT_VERSION =
  'builder-agent-project-work-result-review-assignment-close-service-result.v1';
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const OWNER_ID_PATTERN = new RegExp(`^builder-user:${UUID_SOURCE}$`, 'u');
const WORK_RESULT_REVIEW_ID_PATTERN =
  /^builder-agent-project-work-result-review:[0-9a-f]{64}$/u;
const SERVICE_KEYS = Object.freeze([
  'assignment_store',
  'project_work_result_review_store',
  'lease_store',
]);
const CLOSE_ASSIGNMENT_KEYS = Object.freeze([
  'owner_id',
  'work_result_review_id',
  'completed_status_input',
  'now_ms',
]);
const ERROR_MESSAGES = Object.freeze({
  builder_agent_project_work_result_review_assignment_close_service_invalid:
    'Builder agent project work result review assignment close could not be verified.',
  builder_agent_project_work_result_review_assignment_close_service_conflict:
    'Builder agent project work result review assignment close changed before it could be recorded.',
  builder_agent_project_work_result_review_assignment_close_service_unavailable:
    'Builder agent project work result review assignment close service is unavailable.',
});

class BuilderAgentProjectWorkResultReviewAssignmentCloseServiceError extends Error {
  constructor(code = 'builder_agent_project_work_result_review_assignment_close_service_invalid') {
    const selected = Object.hasOwn(ERROR_MESSAGES, code)
      ? code
      : 'builder_agent_project_work_result_review_assignment_close_service_invalid';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderAgentProjectWorkResultReviewAssignmentCloseServiceError';
    this.code = selected;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) {
  throw new BuilderAgentProjectWorkResultReviewAssignmentCloseServiceError(code);
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
    fail('builder_agent_project_work_result_review_assignment_close_service_invalid');
  }
  const own = Object.keys(value);
  if (own.length !== keys.length) {
    fail('builder_agent_project_work_result_review_assignment_close_service_invalid');
  }
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) {
      fail('builder_agent_project_work_result_review_assignment_close_service_invalid');
    }
  }
}

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
    fail('builder_agent_project_work_result_review_assignment_close_service_invalid');
  }
  return descriptor.value;
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail('builder_agent_project_work_result_review_assignment_close_service_invalid');
  }
  return value;
}

function safeOwnerId(value) {
  if (typeof value !== 'string' || !OWNER_ID_PATTERN.test(value)) {
    fail('builder_agent_project_work_result_review_assignment_close_service_invalid');
  }
  return value;
}

function safeWorkResultReviewId(value) {
  if (typeof value !== 'string' || !WORK_RESULT_REVIEW_ID_PATTERN.test(value)) {
    fail('builder_agent_project_work_result_review_assignment_close_service_invalid');
  }
  return value;
}

function storeMethod(store, name) {
  const descriptor = Object.getOwnPropertyDescriptor(store, name);
  if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') {
    fail('builder_agent_project_work_result_review_assignment_close_service_invalid');
  }
  return descriptor.value.bind(store);
}

function safeStore(value, expectedVersion, methods) {
  if (value === null || typeof value !== 'object' || utilTypes.isProxy(value)) {
    fail('builder_agent_project_work_result_review_assignment_close_service_invalid');
  }
  const versionDescriptor = Object.getOwnPropertyDescriptor(value, 'store_version');
  if (
    !versionDescriptor
    || !Object.hasOwn(versionDescriptor, 'value')
    || versionDescriptor.value !== expectedVersion
  ) fail('builder_agent_project_work_result_review_assignment_close_service_invalid');
  const selected = { store_version: expectedVersion };
  for (const method of methods) selected[method] = storeMethod(value, method);
  return freezeDeep(selected);
}

function safeStores(rawStores) {
  exactObject(rawStores, SERVICE_KEYS);
  return freezeDeep({
    assignment_store: safeStore(
      valueAt(rawStores, 'assignment_store'),
      BUILDER_AGENT_ASSIGNMENT_STORE_VERSION,
      ['record_status', 'read_assignment', 'list_task_assignments'],
    ),
    project_work_result_review_store: safeStore(
      valueAt(rawStores, 'project_work_result_review_store'),
      BUILDER_AGENT_PROJECT_WORK_RESULT_REVIEW_STORE_VERSION,
      ['read_review', 'list_task_reviews'],
    ),
    lease_store: safeStore(
      valueAt(rawStores, 'lease_store'),
      BUILDER_AGENT_SUPERVISION_LEASE_STORE_VERSION,
      ['read_lease', 'read_assignment_leases'],
    ),
  });
}

function normalizeOperationError(error) {
  if (error instanceof BuilderAgentProjectWorkResultReviewAssignmentCloseServiceError) {
    return new BuilderAgentProjectWorkResultReviewAssignmentCloseServiceError(error.code);
  }
  if (error instanceof BuilderAgentAssignmentContractError) {
    return new BuilderAgentProjectWorkResultReviewAssignmentCloseServiceError(
      'builder_agent_project_work_result_review_assignment_close_service_invalid',
    );
  }
  if (
    error instanceof BuilderAgentAssignmentStoreError
    || error instanceof BuilderAgentProjectWorkResultReviewStoreError
    || error instanceof BuilderAgentSupervisionLeaseStoreError
  ) {
    if (/_conflict$/u.test(error.code) || /_not_found$/u.test(error.code)) {
      return new BuilderAgentProjectWorkResultReviewAssignmentCloseServiceError(
        'builder_agent_project_work_result_review_assignment_close_service_conflict',
      );
    }
    if (/_unavailable$/u.test(error.code)) {
      return new BuilderAgentProjectWorkResultReviewAssignmentCloseServiceError(
        'builder_agent_project_work_result_review_assignment_close_service_unavailable',
      );
    }
    return new BuilderAgentProjectWorkResultReviewAssignmentCloseServiceError(
      'builder_agent_project_work_result_review_assignment_close_service_invalid',
    );
  }
  return new BuilderAgentProjectWorkResultReviewAssignmentCloseServiceError(
    'builder_agent_project_work_result_review_assignment_close_service_unavailable',
  );
}

function serviceEvidence() {
  return freezeDeep({
    service_authority: 'main_owned_agent_project_work_result_review_assignment_close_service',
    assignment_store_authority: 'main_owned_agent_assignment_store',
    assignment_status_authority: 'main_owned_agent_assignment_store',
    project_work_result_review_store_authority:
      'main_owned_agent_project_work_result_review_store',
    lease_store_authority: 'main_owned_agent_supervision_lease_store',
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
    goal_status_authority: false,
    recovery_model: 'idempotent_store_replay',
  });
}

function readReviewFact(stores, ownerId, workResultReviewId) {
  const reviewRead = stores.project_work_result_review_store.read_review({
    work_result_review_id: workResultReviewId,
    owner_id: ownerId,
  });
  if (reviewRead.status !== 'ready' || !reviewRead.project_work_result_review) {
    fail('builder_agent_project_work_result_review_assignment_close_service_conflict');
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
  ) fail('builder_agent_project_work_result_review_assignment_close_service_invalid');
  return freezeDeep({ entry, review_read: reviewRead, task_reviews: taskReviews });
}

function readReleasedLeaseFact(stores, review, nowMs) {
  const leaseRead = stores.lease_store.read_lease({
    lease_id: review.lease_id,
    owner_id: review.owner_id,
  });
  if (
    leaseRead.status !== 'ready'
    || !leaseRead.lease
    || !leaseRead.release
    || leaseRead.lease.lease_id !== review.lease_id
    || leaseRead.release.lease_id !== review.lease_id
    || leaseRead.release.release_outcome !== 'completed'
    || leaseRead.release.released_at_ms < review.reviewed_at_ms
    || nowMs < leaseRead.release.released_at_ms
  ) fail('builder_agent_project_work_result_review_assignment_close_service_conflict');
  const assignmentLeases = stores.lease_store.read_assignment_leases({
    assignment_id: review.assignment_id,
    owner_id: review.owner_id,
    now_ms: nowMs,
  });
  if (
    assignmentLeases.status !== 'ready'
    || assignmentLeases.active_lease !== null
  ) fail('builder_agent_project_work_result_review_assignment_close_service_conflict');
  return freezeDeep({ lease_read: leaseRead, assignment_leases: assignmentLeases });
}

function readAssignmentFact(stores, review) {
  const assignmentRead = stores.assignment_store.read_assignment({
    assignment_id: review.assignment_id,
    owner_id: review.owner_id,
  });
  if (
    assignmentRead.status !== 'ready'
    || !assignmentRead.assignment
    || assignmentRead.assignment.assignment_id !== review.assignment_id
    || (
      assignmentRead.current_status !== 'active'
      && assignmentRead.current_status !== 'completed'
    )
  ) fail('builder_agent_project_work_result_review_assignment_close_service_conflict');
  return assignmentRead;
}

function closeReviewedProjectWorkAssignment(stores, rawRequest) {
  exactObject(rawRequest, CLOSE_ASSIGNMENT_KEYS);
  const ownerId = safeOwnerId(valueAt(rawRequest, 'owner_id'));
  const workResultReviewId = safeWorkResultReviewId(valueAt(rawRequest, 'work_result_review_id'));
  const nowMs = safeTimestamp(valueAt(rawRequest, 'now_ms'));
  const reviewEvidence = readReviewFact(stores, ownerId, workResultReviewId);
  const entry = reviewEvidence.entry;
  const review = entry.review;
  const leaseEvidence = readReleasedLeaseFact(stores, review, nowMs);
  const assignmentReadBefore = readAssignmentFact(stores, review);
  const completedStatus = createBuilderAgentAssignmentStatusRecord(
    valueAt(rawRequest, 'completed_status_input'),
    assignmentReadBefore.assignment,
  );
  if (
    completedStatus.next_status !== 'completed'
    || completedStatus.decided_at_ms !== nowMs
    || completedStatus.assignment_id !== review.assignment_id
    || completedStatus.owner_id !== ownerId
    || completedStatus.decided_by !== ownerId
  ) fail('builder_agent_project_work_result_review_assignment_close_service_invalid');

  const statusStoreWrite = stores.assignment_store.record_status({ status: completedStatus });
  const assignmentRead = stores.assignment_store.read_assignment({
    assignment_id: completedStatus.assignment_id,
    owner_id: completedStatus.owner_id,
  });
  if (
    assignmentRead.status !== 'ready'
    || assignmentRead.current_status !== 'completed'
    || !assignmentRead.statuses.some(
      (status) => status.assignment_status_id === completedStatus.assignment_status_id,
    )
  ) fail('builder_agent_project_work_result_review_assignment_close_service_invalid');
  const taskAssignments = stores.assignment_store.list_task_assignments({
    owner_id: completedStatus.owner_id,
    project_id: review.project_id,
    task_id: review.task_id,
  });
  if (
    taskAssignments.status !== 'ready'
    || !taskAssignments.assignments.some(
      (item) => item.assignment.assignment_id === completedStatus.assignment_id
        && item.current_status === 'completed',
    )
  ) fail('builder_agent_project_work_result_review_assignment_close_service_invalid');

  return freezeDeep({
    result_version: BUILDER_AGENT_PROJECT_WORK_RESULT_REVIEW_ASSIGNMENT_CLOSE_SERVICE_RESULT_VERSION,
    service_version: BUILDER_AGENT_PROJECT_WORK_RESULT_REVIEW_ASSIGNMENT_CLOSE_SERVICE_VERSION,
    operation: 'agent_project_work_result_review_assignment_closed',
    status: 'ready',
    work_kind: review.work_kind,
    result_status: review.result.status,
    decision: review.decision,
    review,
    completed_status: completedStatus,
    project_work_result_review: entry,
    review_read: reviewEvidence.review_read,
    task_reviews: reviewEvidence.task_reviews,
    lease_read: leaseEvidence.lease_read,
    assignment_leases: leaseEvidence.assignment_leases,
    assignment_read_before: assignmentReadBefore,
    assignment_read: assignmentRead,
    task_assignments: taskAssignments,
    operations: {
      assignment_status_store: statusStoreWrite.operation,
    },
    evidence: serviceEvidence(),
  });
}

function createBuilderAgentProjectWorkResultReviewAssignmentCloseService(rawStores) {
  const stores = safeStores(rawStores);
  return freezeDeep({
    service_version: BUILDER_AGENT_PROJECT_WORK_RESULT_REVIEW_ASSIGNMENT_CLOSE_SERVICE_VERSION,

    close_reviewed_project_work_assignment(rawRequest) {
      try { return closeReviewedProjectWorkAssignment(stores, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },
  });
}

module.exports = Object.freeze({
  BUILDER_AGENT_PROJECT_WORK_RESULT_REVIEW_ASSIGNMENT_CLOSE_SERVICE_RESULT_VERSION,
  BUILDER_AGENT_PROJECT_WORK_RESULT_REVIEW_ASSIGNMENT_CLOSE_SERVICE_VERSION,
  BuilderAgentProjectWorkResultReviewAssignmentCloseServiceError,
  createBuilderAgentProjectWorkResultReviewAssignmentCloseService,
});
