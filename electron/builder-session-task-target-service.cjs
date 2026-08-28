'use strict';

const { types: utilTypes } = require('node:util');
const {
  createBuilderConversationAddress,
  sanitizeBuilderConversationAddress,
} = require('./builder-conversation-address.cjs');

const SERVICE_VERSION = 'builder-session-task-target-service.v1';
const OPTION_KEYS = Object.freeze(['address_store', 'create_uuid', 'agent_id']);
const REQUEST_KEYS = Object.freeze(['project_id', 'task_address_id']);
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const UUID_PATTERN = new RegExp(`^${UUID_SOURCE}$`, 'u');
const PROJECT_ID_PATTERN = new RegExp(`^builder-project:${UUID_SOURCE}$`, 'u');
const TASK_ADDRESS_ID_PATTERN = new RegExp(`^builder-task-address:${UUID_SOURCE}$`, 'u');
const AGENT_ID_PATTERN = new RegExp(`^builder-agent:${UUID_SOURCE}$`, 'u');

class BuilderSessionTaskTargetServiceError extends Error {
  constructor() {
    super('Builder task target could not be verified.');
    this.name = 'BuilderSessionTaskTargetServiceError';
    this.code = 'builder_session_task_target_invalid';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() { throw new BuilderSessionTaskTargetServiceError(); }
function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || utilTypes.isProxy(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function exactObject(value, keys) {
  if (!isPlainObject(value)) fail();
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== keys.length || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))) fail();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  }
  return descriptors;
}
function stableMethod(value, key) {
  let cursor = value;
  while (cursor !== null) {
    if (utilTypes.isProxy(cursor)) fail();
    const descriptor = Object.getOwnPropertyDescriptor(cursor, key);
    if (descriptor) {
      if (!Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') fail();
      return descriptor.value;
    }
    cursor = Object.getPrototypeOf(cursor);
  }
  fail();
}
function safePattern(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) fail();
  return value;
}
function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freezeDeep(nested);
    Object.freeze(value);
  }
  return value;
}

function createBuilderSessionTaskTargetService(rawOptions) {
  const options = exactObject(rawOptions, OPTION_KEYS);
  const addressStore = options.address_store.value;
  const readTaskAddress = stableMethod(addressStore, 'read_task_address');
  const createUuid = options.create_uuid.value;
  const agentId = safePattern(options.agent_id.value, AGENT_ID_PATTERN);
  if (typeof createUuid !== 'function') fail();

  return freezeDeep({
    service_version: SERVICE_VERSION,
    resolve_target(rawRequest) {
      const request = exactObject(rawRequest, REQUEST_KEYS);
      const projectId = safePattern(request.project_id.value, PROJECT_ID_PATTERN);
      const taskAddressId = request.task_address_id.value;
      if (taskAddressId === null) {
        const conversationUuid = safePattern(Reflect.apply(createUuid, undefined, []), UUID_PATTERN);
        return freezeDeep({
          result_version: 'builder-session-task-target-result.v1',
          operation: 'new_task_target_allocated',
          project_id: projectId,
          task_address_id: null,
          conversation_id: createBuilderConversationAddress(projectId, conversationUuid),
          agent_id: agentId,
          should_record_task_address: true,
          authority: 'main_owned_task_target_resolution',
        });
      }
      const safeTaskAddressId = safePattern(taskAddressId, TASK_ADDRESS_ID_PATTERN);
      const result = Reflect.apply(readTaskAddress, addressStore, [{
        project_id: projectId,
        task_address_id: safeTaskAddressId,
      }]);
      const task = result?.status === 'ready' ? result.task_address?.task_address : null;
      if (!isPlainObject(task) || task.project_id !== projectId || task.task_address_id !== safeTaskAddressId || task.agent_id !== agentId) fail();
      return freezeDeep({
        result_version: 'builder-session-task-target-result.v1',
        operation: 'existing_task_target_resolved',
        project_id: projectId,
        task_address_id: safeTaskAddressId,
        conversation_id: sanitizeBuilderConversationAddress(projectId, task.conversation_id),
        agent_id: agentId,
        should_record_task_address: false,
        authority: 'main_owned_task_target_resolution',
      });
    },
  });
}

module.exports = Object.freeze({
  BuilderSessionTaskTargetServiceError,
  SERVICE_VERSION,
  createBuilderSessionTaskTargetService,
});
