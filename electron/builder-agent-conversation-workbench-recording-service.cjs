'use strict';

const { types: utilTypes } = require('node:util');

const {
  BUILDER_WORKBENCH_MESSAGE_ENVELOPE_VERSION,
  BUILDER_WORKBENCH_THREAD_VERSION,
} = require('./builder-workbench-message-contract.cjs');

const SERVICE_VERSION = 'builder-agent-conversation-workbench-recording-service.v1';
const AGENT_ID_PATTERN = /^builder-agent:([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/u;
const OWNER_ID_PATTERN = /^builder-user:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const RUN_ID_PATTERN = /^builder-run:([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/u;
const TURN_OUTCOME_TEXT = Object.freeze({
  cancelled: '\u5df2\u505c\u6b62\uff0c\u672c\u6b21\u8bf7\u6c42\u672a\u5b8c\u6210\u3002',
  interrupted: '\u8bf7\u6c42\u5df2\u4e2d\u65ad\uff0c\u53ef\u4ee5\u91cd\u65b0\u53d1\u9001\u3002',
  failed: '\u8bf7\u6c42\u672a\u5b8c\u6210\uff0c\u8bf7\u91cd\u8bd5\u3002',
});

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
  let synchronizedHead = 0;

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
      || !Number.isSafeInteger(conversation.head_sequence)
      || conversation.head_sequence < 0
    ) fail();
    if (conversation.head_sequence < synchronizedHead) synchronizedHead = 0;
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
        || !Number.isSafeInteger(item.sequence)
        || item.sequence < 1
        || typeof item.turn_id !== 'string'
      ) continue;
      if (item.sequence <= synchronizedHead) continue;
      const turnStatus = item.item_kind === 'turn_completed'
        && Object.hasOwn(TURN_OUTCOME_TEXT, item.outcome)
        && typeof item.run_id === 'string' && RUN_ID_PATTERN.test(item.run_id);
      const transcript = item.item_kind === 'transcript_message'
        && (item.role === 'user' || item.role === 'assistant')
        && typeof item.message?.message_id === 'string' && typeof item.message?.text === 'string';
      if (!turnStatus && !transcript) continue;
      // A terminal notice is a Main fact, never a synthesized assistant reply.
      const messageId = turnStatus
        ? `builder-message:${RUN_ID_PATTERN.exec(item.run_id)[1]}` : item.message.message_id;
      const messageText = turnStatus ? TURN_OUTCOME_TEXT[item.outcome] : item.message.text;
      const isOwner = item.role === 'user';
      const timestamp = conversation.created_at_ms + item.sequence;
      const result = Reflect.apply(recordMessage, messageStore, [{
        message: {
          envelope_version: BUILDER_WORKBENCH_MESSAGE_ENVELOPE_VERSION,
          message_id: messageId,
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
            content_type: turnStatus ? 'builder.chat.turn_status.v1'
              : isOwner ? 'builder.chat.user_message.v1' : 'builder.chat.agent_message.v1',
            schema_ref: turnStatus ? 'builder.workbench.turn_status.v1' : 'builder.workbench.chat_message.v1',
            schema_version: 1,
            payload: turnStatus ? {
              outcome: item.outcome,
              run_id: item.run_id,
              sequence: item.sequence,
              text: messageText,
              turn_id: item.turn_id,
            } : {
              context_route: typeof item.context_route === 'string' ? item.context_route : null,
              message_kind: item.message_kind,
              role: item.role,
              sequence: item.sequence,
              text: item.message.text,
              turn_id: item.turn_id,
            },
            fallback_text: messageText,
          },
          delivery: {
            attention: 'normal',
            visibility: 'main_stream',
            dedupe_key: messageId,
            source_sequence: `agent-conversation:${item.sequence}`,
          },
          trust: {
            provenance: isOwner ? 'human' : 'local_system',
            sensitivity: 'local',
            prompt_admission: turnStatus ? 'excluded' : 'candidate',
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
    synchronizedHead = conversation.head_sequence;
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
