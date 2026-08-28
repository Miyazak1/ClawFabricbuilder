'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');
const {
  BUILDER_WORKBENCH_MESSAGE_ENVELOPE_VERSION,
} = require('./builder-workbench-message-contract.cjs');
const {
  createBuilderWorkbenchTaskProposal,
  createBuilderWorkbenchTaskProposalDecision,
  createBuilderWorkbenchTaskMaterialization,
} = require('./builder-workbench-task-proposal-contract.cjs');
const {
  createBuilderConversationAddress,
} = require('./builder-conversation-address.cjs');
const {
  createBuilderSessionAddress,
  createBuilderTaskAddress,
} = require('./builder-session-task-address.cjs');

const SERVICE_VERSION = 'builder-workbench-task-incubation-service.v1';
const REQUEST_ID = /^builder-workbench-request:([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/u;

class BuilderWorkbenchTaskIncubationServiceError extends Error {
  constructor(code = 'builder_workbench_task_incubation_unavailable') {
    super('Builder Workbench task incubation is unavailable.');
    this.name = 'BuilderWorkbenchTaskIncubationServiceError';
    this.code = code;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) { throw new BuilderWorkbenchTaskIncubationServiceError(code); }
function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freezeDeep(nested);
    Object.freeze(value);
  }
  return value;
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
function uuidFromSeed(seed) {
  const hex = nodeCrypto.createHash('sha256').update(seed, 'utf8').digest('hex').slice(0, 32).split('');
  hex[12] = '5';
  hex[16] = ['8', '9', 'a', 'b'][Number.parseInt(hex[16], 16) % 4];
  const value = hex.join('');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}
function agentUuid(agentId) { return agentId.slice('builder-agent:'.length); }
function workbenchId(agentId) { return `builder-agent-workbench:${agentUuid(agentId)}`; }
function titleFor(objective) {
  const firstLine = objective.split(/\r?\n/u, 1)[0].trim();
  return (firstLine.length > 160 ? `${firstLine.slice(0, 157)}...` : firstLine) || 'New task';
}
function displayId(seed) {
  return `S-${nodeCrypto.createHash('sha256').update(seed, 'utf8').digest('hex').slice(0, 8).toUpperCase()}`;
}
function createBuilderWorkbenchTaskIncubationService(rawOptions) {
  if (rawOptions === null || typeof rawOptions !== 'object' || Array.isArray(rawOptions)) fail();
  const proposalStore = rawOptions.proposal_store;
  const messageStore = rawOptions.message_store;
  const addressStore = rawOptions.address_store;
  const recordProposal = stableMethod(proposalStore, 'record_proposal');
  const recordDecision = stableMethod(proposalStore, 'record_decision');
  const recordMaterialization = stableMethod(proposalStore, 'record_materialization');
  const readProposal = stableMethod(proposalStore, 'read_by_proposal_id');
  const recordMessage = stableMethod(messageStore, 'record_message');
  const recordSessionAddress = stableMethod(addressStore, 'record_session_address');
  const recordTaskAddress = stableMethod(addressStore, 'record_task_address');
  const verifyProject = rawOptions.verify_project;
  const nowMs = rawOptions.now_ms;
  const agentId = rawOptions.agent_id;
  const ownerId = rawOptions.owner_id;
  if (typeof verifyProject !== 'function' || typeof nowMs !== 'function' || typeof agentId !== 'string' || typeof ownerId !== 'string') fail();

  function recordWorkbenchMessage({ messageId, actionId, contentType, text, timestamp, projectId = null, taskAddressId = null }) {
    return Reflect.apply(recordMessage, messageStore, [{
      message: {
        envelope_version: BUILDER_WORKBENCH_MESSAGE_ENVELOPE_VERSION,
        message_id: messageId,
        agent_id: agentId,
        owner_id: ownerId,
        source: {
          source_kind: 'local_agent',
          source_id: agentId,
          connector_id: null,
          actor_id: agentId,
          external_message_id: null,
        },
        address: {
          workbench_id: workbenchId(agentId),
          thread_id: null,
          reply_route_id: null,
          project_id: projectId,
          task_address_id: taskAddressId,
        },
        content: {
          content_type: contentType,
          schema_ref: 'builder.workbench.task_incubation.v1',
          schema_version: 1,
          payload: { text },
          fallback_text: text,
        },
        delivery: {
          attention: contentType === 'builder.task.proposal.v1' ? 'action_required' : 'normal',
          visibility: 'main_stream',
          dedupe_key: messageId,
          source_sequence: null,
        },
        trust: {
          provenance: 'local_system',
          sensitivity: 'local',
          prompt_admission: 'excluded',
          memory_admission: 'candidate',
        },
        attachment_refs: [],
        proposed_action_refs: actionId === null ? [] : [actionId],
        created_at_ms: timestamp,
        received_at_ms: timestamp,
      },
    }]);
  }

  function createProposal(request) {
    const match = typeof request?.request_id === 'string' ? REQUEST_ID.exec(request.request_id) : null;
    if (match === null) fail('builder_workbench_task_incubation_invalid');
    const proposalUuid = uuidFromSeed(`${request.request_id}:proposal`);
    const proposalId = `builder-task-proposal:${proposalUuid}`;
    const existing = Reflect.apply(readProposal, proposalStore, [{ proposal_id: proposalId }]);
    let proposal;
    if (existing.status === 'ready') {
      proposal = existing.proposal;
      if (
        proposal.agent_id !== request.agent_id
        || proposal.objective !== request.objective
        || proposal.requested_outcome !== request.requested_outcome
        || proposal.execution_mode !== request.execution_mode
      ) fail('builder_workbench_task_incubation_conflict');
    } else {
      const createdAtMs = Reflect.apply(nowMs, undefined, []);
      proposal = createBuilderWorkbenchTaskProposal({
        proposal_id: proposalId,
        request_id: request.request_id,
        action_id: `builder-workbench-action:${nodeCrypto.createHash('sha256').update(`${request.request_id}:action`, 'utf8').digest('hex')}`,
        message_id: `builder-message:${uuidFromSeed(`${request.request_id}:message`)}`,
        agent_id: request.agent_id,
        owner_id: ownerId,
        objective: request.objective,
        requested_outcome: request.requested_outcome,
        execution_mode: request.execution_mode,
        reason: request.reason,
        created_at_ms: createdAtMs,
        expires_at_ms: createdAtMs + (30 * 24 * 60 * 60 * 1000),
      });
      Reflect.apply(recordProposal, proposalStore, [{ proposal }]);
    }
    const text = `### Task proposal\n\n${proposal.objective}\n\n- Outcome: ${proposal.requested_outcome}\n- Execution: ${proposal.execution_mode}\n- Project: choose before creating the task`;
    recordWorkbenchMessage({
      messageId: proposal.message_id,
      actionId: proposal.action_id,
      contentType: 'builder.task.proposal.v1',
      text,
      timestamp: proposal.created_at_ms,
    });
    return freezeDeep({
      result_version: 'builder-workbench-task-proposal-create-result.v1',
      operation: existing.status === 'ready' ? 'proposal_replayed' : 'proposal_created',
      proposal,
      authority: {
        project_created: false,
        task_created: false,
        provider_dispatch: false,
        permission_grant: false,
      },
    });
  }

  async function decideProposal(request) {
    const bundle = Reflect.apply(readProposal, proposalStore, [{ proposal_id: request.proposal_id }]);
    if (bundle.status !== 'ready' || bundle.proposal.agent_id !== request.agent_id) fail('builder_workbench_task_incubation_invalid');
    const proposal = bundle.proposal;
    let decision = bundle.decision;
    if (bundle.decision !== null) {
      const same = bundle.decision.decision === request.operation && bundle.decision.project_id === request.project_id;
      if (!same) fail('builder_workbench_task_incubation_conflict');
      if (bundle.materialization !== null || bundle.decision.decision === 'reject') {
        return freezeDeep({
          result_version: 'builder-workbench-task-proposal-decision-result.v1',
          operation: bundle.materialization === null ? 'decision_replayed' : 'task_materialization_replayed',
          proposal,
          decision: bundle.decision,
          materialization: bundle.materialization,
        });
      }
    }
    if (request.operation === 'approve_existing_project') {
      await Reflect.apply(verifyProject, undefined, [request.project_id]);
    }
    if (decision === null) {
      decision = createBuilderWorkbenchTaskProposalDecision({
        proposal_id: proposal.proposal_id,
        decision: request.operation,
        project_id: request.project_id,
        decided_by: ownerId,
        decided_at_ms: Reflect.apply(nowMs, undefined, []),
      });
      Reflect.apply(recordDecision, proposalStore, [{ decision }]);
    }
    const decidedAtMs = decision.decided_at_ms;
    if (decision.decision === 'reject') {
      recordWorkbenchMessage({
        messageId: `builder-message:${uuidFromSeed(`${proposal.proposal_id}:rejected`)}`,
        actionId: null,
        contentType: 'builder.task.status.v1',
        text: 'Task proposal dismissed. No project, task, permission, or execution was created.',
        timestamp: decidedAtMs,
      });
      return freezeDeep({
        result_version: 'builder-workbench-task-proposal-decision-result.v1',
        operation: 'proposal_rejected',
        proposal,
        decision,
        materialization: null,
      });
    }
    const sessionUuid = uuidFromSeed(`${proposal.proposal_id}:${decision.project_id}:session`);
    const taskUuid = uuidFromSeed(`${proposal.proposal_id}:${decision.project_id}:task`);
    const conversationUuid = uuidFromSeed(`${proposal.proposal_id}:${decision.project_id}:conversation`);
    const sessionId = `builder-session:${sessionUuid}`;
    const taskAddressId = `builder-task-address:${taskUuid}`;
    const conversationId = createBuilderConversationAddress(decision.project_id, conversationUuid);
    const title = titleFor(proposal.objective);
    const sessionAddress = createBuilderSessionAddress({
      session_id: sessionId,
      project_id: decision.project_id,
      display_id: displayId(proposal.proposal_id),
      title,
      status: 'active',
      root_conversation_id: conversationId,
      current_task_id: taskAddressId,
      parent_session_id: null,
      forked_from_session_id: null,
      forked_from_revision_receipt_digest: null,
      created_by: ownerId,
      created_at_ms: decidedAtMs,
      updated_at_ms: decidedAtMs,
      archived_at_ms: null,
    });
    const taskAddress = createBuilderTaskAddress({
      task_address_id: taskAddressId,
      session_id: sessionId,
      project_id: decision.project_id,
      agent_id: agentId,
      parent_task_address_id: null,
      conversation_id: conversationId,
      title,
      goal: proposal.objective,
      status: 'draft',
      current_brief_id: null,
      current_plan_id: null,
      base_revision_receipt_digest: null,
      produced_revision_receipt_digest: null,
      created_by: ownerId,
      created_at_ms: decidedAtMs,
      updated_at_ms: decidedAtMs,
      closed_at_ms: null,
    });
    Reflect.apply(recordSessionAddress, addressStore, [{ session_address: sessionAddress }]);
    Reflect.apply(recordTaskAddress, addressStore, [{ task_address: taskAddress }]);
    const materialization = createBuilderWorkbenchTaskMaterialization({
      proposal_id: proposal.proposal_id,
      project_id: decision.project_id,
      session_id: sessionId,
      task_address_id: taskAddressId,
      conversation_id: conversationId,
      objective: proposal.objective,
      origin_message_id: proposal.message_id,
      materialized_at_ms: decidedAtMs,
    });
    Reflect.apply(recordMaterialization, proposalStore, [{ materialization }]);
    recordWorkbenchMessage({
      messageId: `builder-message:${uuidFromSeed(`${proposal.proposal_id}:materialized`)}`,
      actionId: null,
      contentType: 'builder.task.status.v1',
      text: `Task created in the selected project: ${title}. It has not started and has no write permission yet.`,
      timestamp: decidedAtMs,
      projectId: decision.project_id,
      taskAddressId,
    });
    return freezeDeep({
      result_version: 'builder-workbench-task-proposal-decision-result.v1',
      operation: 'task_materialized',
      proposal,
      decision,
      materialization,
    });
  }

  return freezeDeep({
    service_version: SERVICE_VERSION,
    create_proposal: createProposal,
    decide_proposal: decideProposal,
  });
}

module.exports = Object.freeze({
  SERVICE_VERSION,
  BuilderWorkbenchTaskIncubationServiceError,
  createBuilderWorkbenchTaskIncubationService,
});
