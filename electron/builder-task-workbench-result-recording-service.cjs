'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const {
  BUILDER_WORKBENCH_MESSAGE_ENVELOPE_VERSION,
} = require('./builder-workbench-message-contract.cjs');

const SERVICE_VERSION = 'builder-task-workbench-result-recording-service.v1';
const AGENT_ID_PATTERN = /^builder-agent:([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/u;
const OWNER_ID_PATTERN = /^builder-user:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

class BuilderTaskWorkbenchResultRecordingServiceError extends Error {
  constructor() {
    super('Builder Task result could not be recorded in the Workbench.');
    this.name = 'BuilderTaskWorkbenchResultRecordingServiceError';
    this.code = 'builder_task_workbench_result_recording_invalid';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderTaskWorkbenchResultRecordingServiceError();
}

function stableMethod(value, key) {
  if (value === null || typeof value !== 'object' || utilTypes.isProxy(value)) fail();
  let cursor = value;
  while (cursor !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(cursor, key);
    if (descriptor) {
      if (!Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') fail();
      return descriptor.value;
    }
    cursor = Object.getPrototypeOf(cursor);
  }
  fail();
}

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freezeDeep(nested);
    Object.freeze(value);
  }
  return value;
}

function uuidFromSeed(seed) {
  const hex = nodeCrypto.createHash('sha256').update(seed, 'utf8').digest('hex').slice(0, 32).split('');
  hex[12] = '4';
  hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const value = hex.join('');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function createBuilderTaskWorkbenchResultRecordingService({ message_store: messageStore, agent_id: agentId, owner_id: ownerId }) {
  const match = typeof agentId === 'string' ? AGENT_ID_PATTERN.exec(agentId) : null;
  if (match === null || typeof ownerId !== 'string' || !OWNER_ID_PATTERN.test(ownerId)) fail();
  const recordMessage = stableMethod(messageStore, 'record_message');
  const workbenchId = `builder-agent-workbench:${match[1]}`;

  return freezeDeep({
    service_version: SERVICE_VERSION,
    sync_task_monitor(monitor) {
      if (
        monitor?.projection_version !== 'builder-workbench-task-monitor.v2'
        || monitor.agent_id !== agentId
        || !Array.isArray(monitor.tasks)
      ) fail();
      let recordedCount = 0;
      for (const task of monitor.tasks) {
        const result = task.latest_result;
        if (result === null) continue;
        const messageId = `builder-message:${uuidFromSeed(`${result.result_id}:workbench`)}`;
        const recorded = Reflect.apply(recordMessage, messageStore, [{
          message: {
            envelope_version: BUILDER_WORKBENCH_MESSAGE_ENVELOPE_VERSION,
            message_id: messageId,
            agent_id: agentId,
            owner_id: ownerId,
            source: {
              source_kind: 'project_task',
              source_id: task.task_address_id,
              connector_id: null,
              actor_id: agentId,
              external_message_id: null,
            },
            address: {
              workbench_id: workbenchId,
              thread_id: null,
              reply_route_id: null,
              project_id: task.project_id,
              task_address_id: task.task_address_id,
            },
            content: {
              content_type: 'builder.task.result.v1',
              schema_ref: 'builder.workbench.task_result.v1',
              schema_version: 1,
              payload: {
                result_id: result.result_id,
                run_id: result.run_id,
                terminal_status: result.terminal_status,
                result_kind: result.result_kind,
                summary: result.summary,
                task_title: task.title,
              },
              fallback_text: result.summary,
            },
            delivery: {
              attention: result.terminal_status === 'failed' || result.terminal_status === 'interrupted'
                ? 'action_required'
                : 'normal',
              visibility: 'main_stream',
              dedupe_key: result.result_id,
              source_sequence: `task-result:${result.sequence}`,
            },
            trust: {
              provenance: 'local_system',
              sensitivity: 'local',
              prompt_admission: 'candidate',
              memory_admission: 'candidate',
            },
            attachment_refs: [],
            proposed_action_refs: [],
            created_at_ms: result.completed_at_ms,
            received_at_ms: result.completed_at_ms,
          },
        }]);
        if (recorded.operation === 'message_recorded') recordedCount += 1;
      }
      return freezeDeep({
        result_version: 'builder-task-workbench-result-recording-result.v1',
        operation: 'task_results_synchronized',
        recorded_count: recordedCount,
      });
    },
  });
}

module.exports = Object.freeze({
  SERVICE_VERSION,
  BuilderTaskWorkbenchResultRecordingServiceError,
  createBuilderTaskWorkbenchResultRecordingService,
});
