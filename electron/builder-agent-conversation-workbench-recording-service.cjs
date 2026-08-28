'use strict';

const { types: utilTypes } = require('node:util');

const {
  BUILDER_WORKBENCH_MESSAGE_ENVELOPE_VERSION,
  BUILDER_WORKBENCH_THREAD_VERSION,
} = require('./builder-workbench-message-contract.cjs');

const SERVICE_VERSION = 'builder-agent-conversation-workbench-recording-service.v1';
const AGENT_ID_PATTERN = /^builder-agent:([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/u;
const OWNER_ID_PATTERN = /^builder-user:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

class BuilderAgentConversationWorkbenchRecordingServiceError extends Error {
  constructor() {
    super('Builder Agent conversation could not be recorded in the Workbench.');
    this.name = 'BuilderAgentConversationWorkbenchRecordingServiceError';
    this.code = 'builder_agent_conversation_workbench_recording_invalid';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderAgentConversationWorkbenchRecordingServiceError();
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

function createBuilderAgentConversationWorkbenchRecordingService(rawOptions) {
  if (rawOptions === null || typeof rawOptions !== 'object' || Array.isArray(rawOptions)) fail();
  const { message_store: messageStore, agent_id: agentId, owner_id: ownerId } = rawOptions;
  const match = typeof agentId === 'string' ? AGENT_ID_PATTERN.exec(agentId) : null;
  if (match === null || typeof ownerId !== 'string' || !OWNER_ID_PATTERN.test(ownerId)) fail();
  const recordThread = stableMethod(messageStore, 'record_thread');
  const recordMessage = stableMethod(messageStore, 'record_message');
  const threadId = `builder-workbench-thread:${match[1]}`;
  const workbenchId = `builder-agent-workbench:${match[1]}`;

  function syncAgentConversationStream(stream) {
    if (
      stream === null
      || typeof stream !== 'object'
      || stream.scope_kind !== 'agent_conversation'
      || stream.agent_id !== agentId
      || stream.project_id !== null
    ) fail();
    if (stream.conversation === null) {
      return freezeDeep({
        result_version: 'builder-agent-conversation-workbench-recording-result.v1',
        operation: 'conversation_empty',
        recorded_count: 0,
      });
    }
    const conversation = stream.conversation;
    if (
      conversation === null
      || typeof conversation !== 'object'
      || !Number.isSafeInteger(conversation.created_at_ms)
      || conversation.created_at_ms < 0
      || !Array.isArray(conversation.items)
    ) fail();
    Reflect.apply(recordThread, messageStore, [{
      thread: {
        thread_version: BUILDER_WORKBENCH_THREAD_VERSION,
        thread_id: threadId,
        agent_id: agentId,
        owner_id: ownerId,
        thread_kind: 'conversation',
        title: 'Builder',
        created_at_ms: conversation.created_at_ms,
        updated_at_ms: conversation.created_at_ms,
      },
    }]);
    let recordedCount = 0;
    for (const item of conversation.items) {
      if (
        item === null
        || typeof item !== 'object'
        || item.item_kind !== 'transcript_message'
        || (item.role !== 'user' && item.role !== 'assistant')
        || !Number.isSafeInteger(item.sequence)
        || item.sequence < 1
        || typeof item.turn_id !== 'string'
        || typeof item.message?.message_id !== 'string'
        || typeof item.message?.text !== 'string'
      ) continue;
      const isOwner = item.role === 'user';
      const timestamp = conversation.created_at_ms + item.sequence;
      const result = Reflect.apply(recordMessage, messageStore, [{
        message: {
          envelope_version: BUILDER_WORKBENCH_MESSAGE_ENVELOPE_VERSION,
          message_id: item.message.message_id,
          agent_id: agentId,
          owner_id: ownerId,
          source: {
            source_kind: isOwner ? 'owner' : 'local_agent',
            source_id: isOwner ? ownerId : agentId,
            connector_id: null,
            actor_id: isOwner ? ownerId : agentId,
            external_message_id: null,
          },
          address: {
            workbench_id: workbenchId,
            thread_id: threadId,
            reply_route_id: null,
            project_id: null,
            task_address_id: null,
          },
          content: {
            content_type: isOwner
              ? 'builder.chat.user_message.v1'
              : 'builder.chat.agent_message.v1',
            schema_ref: 'builder.workbench.chat_message.v1',
            schema_version: 1,
            payload: {
              context_route: typeof item.context_route === 'string' ? item.context_route : null,
              message_kind: item.message_kind,
              role: item.role,
              sequence: item.sequence,
              text: item.message.text,
              turn_id: item.turn_id,
            },
            fallback_text: item.message.text,
          },
          delivery: {
            attention: 'normal',
            visibility: 'main_stream',
            dedupe_key: item.message.message_id,
            source_sequence: `agent-conversation:${item.sequence}`,
          },
          trust: {
            provenance: isOwner ? 'human' : 'local_system',
            sensitivity: 'local',
            prompt_admission: 'candidate',
            memory_admission: isOwner ? 'candidate' : 'excluded',
          },
          attachment_refs: [],
          proposed_action_refs: [],
          created_at_ms: timestamp,
          received_at_ms: timestamp,
        },
      }]);
      if (result.operation === 'message_recorded') recordedCount += 1;
    }
    return freezeDeep({
      result_version: 'builder-agent-conversation-workbench-recording-result.v1',
      operation: 'conversation_synchronized',
      recorded_count: recordedCount,
    });
  }

  return freezeDeep({
    service_version: SERVICE_VERSION,
    sync_agent_conversation_stream: syncAgentConversationStream,
  });
}

module.exports = Object.freeze({
  SERVICE_VERSION,
  BuilderAgentConversationWorkbenchRecordingServiceError,
  createBuilderAgentConversationWorkbenchRecordingService,
});
