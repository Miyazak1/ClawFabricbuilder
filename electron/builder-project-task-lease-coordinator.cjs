'use strict';

const { types: utilTypes } = require('node:util');

const COORDINATOR_VERSION = 'builder-project-task-lease-coordinator.v1';
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const PROJECT = new RegExp(`^builder-project:${UUID}$`, 'u');
const TASK = new RegExp(`^builder-task-address:${UUID}$`, 'u');
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const LEASE = new RegExp(`^builder-project-task-lease:${UUID}$`, 'u');

class BuilderProjectTaskLeaseCoordinatorError extends Error {
  constructor() {
    super('Project task coordination is unavailable.');
    this.name = 'BuilderProjectTaskLeaseCoordinatorError';
    this.code = 'builder_project_task_lease_coordinator_invalid';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() { throw new BuilderProjectTaskLeaseCoordinatorError(); }
function plain(value, keys) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || utilTypes.isProxy(value)) fail();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail();
  const actual = Reflect.ownKeys(value);
  if (actual.length !== keys.length || actual.some((key) => typeof key !== 'string' || !keys.includes(key))) fail();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail();
  }
  return value;
}
function id(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) fail();
  return value;
}
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freeze(nested);
    Object.freeze(value);
  }
  return value;
}

function createBuilderProjectTaskLeaseCoordinator({ create_uuid: createUuid }) {
  if (typeof createUuid !== 'function' || utilTypes.isProxy(createUuid)) fail();
  const leases = new Map();
  return freeze({
    coordinator_version: COORDINATOR_VERSION,
    acquire(request) {
      plain(request, ['project_id', 'task_address_id', 'request_id']);
      const projectId = id(request.project_id, PROJECT);
      const taskAddressId = request.task_address_id === null
        ? null
        : id(request.task_address_id, TASK);
      const requestId = id(request.request_id, DIGEST);
      const current = leases.get(projectId) ?? null;
      if (current !== null) {
        return freeze({
          result_version: 'builder-project-task-lease-result.v1',
          status: 'busy',
          project_id: projectId,
          owner_task_address_id: current.task_address_id,
          lease: null,
        });
      }
      const lease = freeze({
        lease_version: 'builder-project-task-lease.v1',
        lease_id: `builder-project-task-lease:${id(createUuid(), new RegExp(`^${UUID}$`, 'u'))}`,
        project_id: projectId,
        task_address_id: taskAddressId,
        request_id: requestId,
      });
      leases.set(projectId, lease);
      return freeze({
        result_version: 'builder-project-task-lease-result.v1',
        status: 'acquired',
        project_id: projectId,
        owner_task_address_id: taskAddressId,
        lease,
      });
    },
    release(request) {
      plain(request, ['lease_id', 'project_id', 'request_id']);
      const leaseId = id(request.lease_id, LEASE);
      const projectId = id(request.project_id, PROJECT);
      const requestId = id(request.request_id, DIGEST);
      const current = leases.get(projectId) ?? null;
      if (current === null || current.lease_id !== leaseId || current.request_id !== requestId) fail();
      leases.delete(projectId);
      return freeze({
        result_version: 'builder-project-task-lease-release-result.v1',
        status: 'released',
        project_id: projectId,
      });
    },
  });
}

module.exports = Object.freeze({
  COORDINATOR_VERSION,
  BuilderProjectTaskLeaseCoordinatorError,
  createBuilderProjectTaskLeaseCoordinator,
});
