'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  BuilderProjectTaskLeaseCoordinatorError,
  createBuilderProjectTaskLeaseCoordinator,
} = require('../electron/builder-project-task-lease-coordinator.cjs');

const PROJECT_A = 'builder-project:123e4567-e89b-42d3-a456-426614174101';
const PROJECT_B = 'builder-project:223e4567-e89b-42d3-a456-426614174101';
const TASK_A = 'builder-task-address:123e4567-e89b-42d3-a456-426614174102';
const TASK_B = 'builder-task-address:223e4567-e89b-42d3-a456-426614174102';
const REQUEST_A = `sha256:${'a'.repeat(64)}`;
const REQUEST_B = `sha256:${'b'.repeat(64)}`;

function coordinator() {
  let index = 0;
  return createBuilderProjectTaskLeaseCoordinator({
    create_uuid() {
      index += 1;
      return `${String(index).padStart(8, '0')}-0000-4000-8000-000000000001`;
    },
  });
}

test('allows different projects concurrently and serializes writers within one project', () => {
  const leases = coordinator();
  const first = leases.acquire({ project_id: PROJECT_A, task_address_id: TASK_A, request_id: REQUEST_A });
  const otherProject = leases.acquire({ project_id: PROJECT_B, task_address_id: TASK_B, request_id: REQUEST_B });
  const conflict = leases.acquire({ project_id: PROJECT_A, task_address_id: TASK_B, request_id: REQUEST_B });

  assert.equal(first.status, 'acquired');
  assert.equal(otherProject.status, 'acquired');
  assert.equal(conflict.status, 'busy');
  assert.equal(conflict.owner_task_address_id, TASK_A);
  assert.equal(conflict.lease, null);

  leases.release({
    lease_id: first.lease.lease_id,
    project_id: PROJECT_A,
    request_id: REQUEST_A,
  });
  assert.equal(
    leases.acquire({ project_id: PROJECT_A, task_address_id: TASK_B, request_id: REQUEST_B }).status,
    'acquired',
  );
});

test('rejects malformed requests and release attempts from a different request', () => {
  const leases = coordinator();
  const acquired = leases.acquire({ project_id: PROJECT_A, task_address_id: TASK_A, request_id: REQUEST_A });
  assert.throws(
    () => leases.release({
      lease_id: acquired.lease.lease_id,
      project_id: PROJECT_A,
      request_id: REQUEST_B,
    }),
    BuilderProjectTaskLeaseCoordinatorError,
  );
  assert.throws(
    () => leases.acquire(new Proxy({
      project_id: PROJECT_A,
      task_address_id: TASK_A,
      request_id: REQUEST_A,
    }, {})),
    BuilderProjectTaskLeaseCoordinatorError,
  );
});
