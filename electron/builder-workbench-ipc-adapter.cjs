'use strict';

const { types: utilTypes } = require('node:util');
const {
  authorityForBuilderWorkbenchCapabilityPolicy,
  createBuilderWorkbenchControlPlanePolicy,
} = require('./builder-workbench-capability-policy.cjs');

const READ_AGENT_WORKBENCH_CHANNEL = 'clawfabric-builder:agent-workbench:read';
const UPDATE_WORKBENCH_MESSAGE_STATE_CHANNEL =
  'clawfabric-builder:agent-workbench:update-message-state';
const CREATE_WORKBENCH_TASK_PROPOSAL_CHANNEL =
  'clawfabric-builder:agent-workbench:create-task-proposal';
const DECIDE_WORKBENCH_TASK_PROPOSAL_CHANNEL =
  'clawfabric-builder:agent-workbench:decide-task-proposal';
const CONTROL_WORKBENCH_TASK_CHANNEL = 'clawfabric-builder:agent-workbench:control-task';
const DECIDE_AGENT_PLAN_CHANNEL = 'clawfabric-builder:agent-workbench:decide-agent-plan';
const WORKBENCH_CHANGED_CHANNEL = 'clawfabric-builder:agent-workbench:changed';
const OPTION_KEYS = Object.freeze([
  'readWorkbench', 'updateMessageState', 'createTaskProposal', 'decideTaskProposal', 'decideAgentPlan', 'controlTask',
  'mainWindowRef',
]);
const AGENT_ID_PATTERN =
  /^builder-agent:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MESSAGE_ID_PATTERN =
  /^builder-message:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CURSOR_PATTERN = /^builder-workbench-cursor:[1-9][0-9]*$/u;
const REQUEST_ID_PATTERN =
  /^builder-workbench-request:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const PROPOSAL_ID_PATTERN =
  /^builder-task-proposal:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const PROJECT_ID_PATTERN =
  /^builder-project:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const TASK_ADDRESS_ID_PATTERN =
  /^builder-task-address:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const AGENT_PLAN_ID_PATTERN =
  /^builder-agent-plan:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const OUTCOMES = new Set(['discuss', 'plan', 'build', 'review', 'research', 'monitor']);
const EXECUTION_MODES = new Set(['foreground', 'parallel']);
const PROPOSAL_DECISIONS = new Set(['approve_existing_project', 'reject']);
const OPERATIONS = new Set(['mark_read', 'acknowledge', 'archive', 'unarchive', 'save', 'unsave']);
const MAX_PAGE_SIZE = 200;
const MAX_PLAIN_DATA_NODES = 20_000;
const MAX_PLAIN_DATA_ENTRIES = 20_000;
const MAX_PLAIN_DATA_UTF8_BYTES = 4 * 1024 * 1024;
const MAX_PLAIN_DATA_DEPTH = 64;
const ERROR_MESSAGES = Object.freeze({
  builder_workbench_forbidden: 'Agent Workbench is unavailable.',
  builder_workbench_invalid: 'The Agent Workbench request could not be verified.',
  builder_workbench_unavailable: 'Agent Workbench is unavailable.',
});

class BuilderWorkbenchIpcError extends Error {
  constructor(code = 'builder_workbench_unavailable') {
    const selected = Object.hasOwn(ERROR_MESSAGES, code)
      ? code
      : 'builder_workbench_unavailable';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderWorkbenchIpcError';
    this.code = selected;
    this.retryable = selected === 'builder_workbench_unavailable';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function ipcError(code) {
  return new BuilderWorkbenchIpcError(code);
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

function dataDescriptor(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (
    !descriptor
    || descriptor.enumerable !== true
    || !Object.hasOwn(descriptor, 'value')
  ) throw ipcError('builder_workbench_invalid');
  return descriptor.value;
}

function stableMethod(value, key) {
  const method = dataDescriptor(value, key);
  if (typeof method !== 'function' || utilTypes.isProxy(method)) throw ipcError();
  return method;
}

function safeOptions(value) {
  try {
    if (!isPlainObject(value)) throw ipcError();
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== OPTION_KEYS.length
      || keys.some((key) => typeof key !== 'string' || !OPTION_KEYS.includes(key))
    ) throw ipcError();
    return Object.freeze({
      readWorkbench: stableMethod(value, 'readWorkbench'),
      updateMessageState: stableMethod(value, 'updateMessageState'),
      createTaskProposal: stableMethod(value, 'createTaskProposal'),
      decideTaskProposal: stableMethod(value, 'decideTaskProposal'),
      decideAgentPlan: stableMethod(value, 'decideAgentPlan'),
      controlTask: stableMethod(value, 'controlTask'),
      mainWindowRef: stableMethod(value, 'mainWindowRef'),
    });
  } catch {
    throw ipcError();
  }
}

function exactKeys(value, expected) {
  if (!isPlainObject(value)) throw ipcError('builder_workbench_invalid');
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== expected.length
    || keys.some((key) => typeof key !== 'string' || !expected.includes(key))
  ) throw ipcError('builder_workbench_invalid');
}

function safeReadRequest(value) {
  exactKeys(value, ['agent_id', 'after_cursor', 'limit']);
  const agentId = dataDescriptor(value, 'agent_id');
  const afterCursor = dataDescriptor(value, 'after_cursor');
  const limit = dataDescriptor(value, 'limit');
  if (
    typeof agentId !== 'string'
    || !AGENT_ID_PATTERN.test(agentId)
    || (afterCursor !== null
      && (typeof afterCursor !== 'string' || !CURSOR_PATTERN.test(afterCursor)))
    || !Number.isSafeInteger(limit)
    || limit < 1
    || limit > MAX_PAGE_SIZE
  ) throw ipcError('builder_workbench_invalid');
  return Object.freeze({ agent_id: agentId, after_cursor: afterCursor, limit });
}

function safeUpdateRequest(value) {
  exactKeys(value, ['agent_id', 'message_id', 'operation']);
  const agentId = dataDescriptor(value, 'agent_id');
  const messageId = dataDescriptor(value, 'message_id');
  const operation = dataDescriptor(value, 'operation');
  if (
    typeof agentId !== 'string'
    || !AGENT_ID_PATTERN.test(agentId)
    || typeof messageId !== 'string'
    || !MESSAGE_ID_PATTERN.test(messageId)
    || typeof operation !== 'string'
    || !OPERATIONS.has(operation)
  ) throw ipcError('builder_workbench_invalid');
  return Object.freeze({ agent_id: agentId, message_id: messageId, operation });
}

function safeProposalText(value, maximum) {
  if (
    typeof value !== 'string'
    || value.trim() !== value
    || value.length < 1
    || value.length > maximum
  ) throw ipcError('builder_workbench_invalid');
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (
      code <= 0x08
      || code === 0x0b
      || code === 0x0c
      || (code >= 0x0e && code <= 0x1f)
      || code === 0x7f
    ) throw ipcError('builder_workbench_invalid');
  }
  return value;
}

function safeCreateProposalRequest(value) {
  exactKeys(value, [
    'request_id', 'agent_id', 'objective', 'requested_outcome', 'execution_mode', 'reason',
  ]);
  const requestId = dataDescriptor(value, 'request_id');
  const agentId = dataDescriptor(value, 'agent_id');
  const requestedOutcome = dataDescriptor(value, 'requested_outcome');
  const executionMode = dataDescriptor(value, 'execution_mode');
  if (
    typeof requestId !== 'string' || !REQUEST_ID_PATTERN.test(requestId)
    || typeof agentId !== 'string' || !AGENT_ID_PATTERN.test(agentId)
    || typeof requestedOutcome !== 'string' || !OUTCOMES.has(requestedOutcome)
    || typeof executionMode !== 'string' || !EXECUTION_MODES.has(executionMode)
  ) throw ipcError('builder_workbench_invalid');
  return Object.freeze({
    request_id: requestId,
    agent_id: agentId,
    objective: safeProposalText(dataDescriptor(value, 'objective'), 2_048),
    requested_outcome: requestedOutcome,
    execution_mode: executionMode,
    reason: safeProposalText(dataDescriptor(value, 'reason'), 1_024),
  });
}

function safeDecideProposalRequest(value) {
  exactKeys(value, ['agent_id', 'proposal_id', 'operation', 'project_id']);
  const agentId = dataDescriptor(value, 'agent_id');
  const proposalId = dataDescriptor(value, 'proposal_id');
  const operation = dataDescriptor(value, 'operation');
  const projectId = dataDescriptor(value, 'project_id');
  if (
    typeof agentId !== 'string' || !AGENT_ID_PATTERN.test(agentId)
    || typeof proposalId !== 'string' || !PROPOSAL_ID_PATTERN.test(proposalId)
    || typeof operation !== 'string' || !PROPOSAL_DECISIONS.has(operation)
    || (projectId !== null && (typeof projectId !== 'string' || !PROJECT_ID_PATTERN.test(projectId)))
    || ((operation === 'reject') !== (projectId === null))
  ) throw ipcError('builder_workbench_invalid');
  return Object.freeze({ agent_id: agentId, proposal_id: proposalId, operation, project_id: projectId });
}

function safeControlTaskRequest(value) {
  exactKeys(value, ['agent_id', 'project_id', 'task_address_id', 'operation']);
  const agentId = dataDescriptor(value, 'agent_id');
  const projectId = dataDescriptor(value, 'project_id');
  const taskAddressId = dataDescriptor(value, 'task_address_id');
  const operation = dataDescriptor(value, 'operation');
  if (
    typeof agentId !== 'string' || !AGENT_ID_PATTERN.test(agentId)
    || typeof projectId !== 'string' || !PROJECT_ID_PATTERN.test(projectId)
    || typeof taskAddressId !== 'string' || !TASK_ADDRESS_ID_PATTERN.test(taskAddressId)
    || operation !== 'cancel_task'
  ) throw ipcError('builder_workbench_invalid');
  return Object.freeze({ agent_id: agentId, project_id: projectId, task_address_id: taskAddressId, operation });
}

function safeDecideAgentPlanRequest(value) {
  exactKeys(value, ['agent_id', 'agent_plan_id', 'content_digest', 'decision']);
  const agentId = dataDescriptor(value, 'agent_id');
  const planId = dataDescriptor(value, 'agent_plan_id');
  const contentDigest = dataDescriptor(value, 'content_digest');
  const decision = dataDescriptor(value, 'decision');
  if (
    typeof agentId !== 'string' || !AGENT_ID_PATTERN.test(agentId)
    || typeof planId !== 'string' || !AGENT_PLAN_ID_PATTERN.test(planId)
    || typeof contentDigest !== 'string' || !DIGEST_PATTERN.test(contentDigest)
    || (decision !== 'approved' && decision !== 'rejected')
  ) throw ipcError('builder_workbench_invalid');
  return Object.freeze({ agent_id: agentId, agent_plan_id: planId, content_digest: contentDigest, decision });
}

function accountUtf8(value, state) {
  const bytes = Buffer.byteLength(value, 'utf8');
  if (bytes > MAX_PLAIN_DATA_UTF8_BYTES - state.utf8Bytes) throw ipcError();
  state.utf8Bytes += bytes;
}

function clonePlainData(value, state = {
  entries: 0,
  nodes: 0,
  seen: new WeakSet(),
  utf8Bytes: 0,
}, depth = 0) {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    accountUtf8(value, state);
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (
    typeof value !== 'object'
    || utilTypes.isProxy(value)
    || state.seen.has(value)
    || depth > MAX_PLAIN_DATA_DEPTH
    || state.nodes >= MAX_PLAIN_DATA_NODES
  ) throw ipcError();
  state.seen.add(value);
  state.nodes += 1;
  const isArray = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (
    (isArray && prototype !== Array.prototype)
    || (!isArray && prototype !== Object.prototype && prototype !== null)
  ) throw ipcError();
  const keys = Reflect.ownKeys(value);
  const entryCount = keys.length - (isArray ? 1 : 0);
  if (
    keys.some((key) => typeof key !== 'string')
    || entryCount > MAX_PLAIN_DATA_ENTRIES - state.entries
  ) throw ipcError();
  state.entries += entryCount;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const output = isArray ? [] : {};
  for (const key of keys) {
    accountUtf8(key, state);
    const descriptor = descriptors[key];
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw ipcError();
    if (isArray && key === 'length') continue;
    if (
      !descriptor.enumerable
      || (isArray && !/^(?:0|[1-9][0-9]*)$/u.test(key))
      || (!isArray && ['__proto__', 'prototype', 'constructor'].includes(key))
    ) throw ipcError();
    output[key] = clonePlainData(descriptor.value, state, depth + 1);
  }
  return Object.freeze(output);
}

function activeWebContents(mainWindowRef) {
  try {
    const windowRef = Reflect.apply(mainWindowRef, undefined, []);
    if (!windowRef || (typeof windowRef.isDestroyed === 'function' && windowRef.isDestroyed())) {
      return null;
    }
    const webContents = windowRef.webContents;
    if (!webContents || (typeof webContents.isDestroyed === 'function' && webContents.isDestroyed())) {
      return null;
    }
    return webContents;
  } catch {
    return null;
  }
}

function assertActiveSender(event, mainWindowRef) {
  if (!event || event.sender !== activeWebContents(mainWindowRef)) {
    throw ipcError('builder_workbench_forbidden');
  }
}

function createBuilderWorkbenchIpcAdapter(rawOptions) {
  const options = safeOptions(rawOptions);
  const workbenchPolicy = createBuilderWorkbenchControlPlanePolicy();
  const workbenchAuthority = authorityForBuilderWorkbenchCapabilityPolicy(workbenchPolicy);

  async function invoke(method, event, rawArguments, sanitize) {
    try {
      assertActiveSender(event, options.mainWindowRef);
      if (rawArguments.length !== 1) throw ipcError('builder_workbench_invalid');
      const result = await Reflect.apply(method, undefined, [sanitize(rawArguments[0])]);
      return clonePlainData(result);
    } catch (error) {
      if (error instanceof BuilderWorkbenchIpcError) throw error;
      throw ipcError();
    }
  }

  return Object.freeze({
    adapter_id: 'builder-workbench.controlled_ipc_adapter.v1',
    namespace: 'builderAgentWorkbench',
    preload_namespace: 'window.clawfabricBuilder.agentWorkbench',
    channels: Object.freeze({
      read: Object.freeze({
        channel: READ_AGENT_WORKBENCH_CHANNEL,
        method: 'read',
        invoke(event, ...rawArguments) {
          return invoke(options.readWorkbench, event, rawArguments, safeReadRequest);
        },
      }),
      updateMessageState: Object.freeze({
        channel: UPDATE_WORKBENCH_MESSAGE_STATE_CHANNEL,
        method: 'updateMessageState',
        invoke(event, ...rawArguments) {
          return invoke(options.updateMessageState, event, rawArguments, safeUpdateRequest);
        },
      }),
      createTaskProposal: Object.freeze({
        channel: CREATE_WORKBENCH_TASK_PROPOSAL_CHANNEL,
        method: 'createTaskProposal',
        invoke(event, ...rawArguments) {
          return invoke(options.createTaskProposal, event, rawArguments, safeCreateProposalRequest);
        },
      }),
      decideTaskProposal: Object.freeze({
        channel: DECIDE_WORKBENCH_TASK_PROPOSAL_CHANNEL,
        method: 'decideTaskProposal',
        invoke(event, ...rawArguments) {
          return invoke(options.decideTaskProposal, event, rawArguments, safeDecideProposalRequest);
        },
      }),
      decideAgentPlan: Object.freeze({
        channel: DECIDE_AGENT_PLAN_CHANNEL,
        method: 'decideAgentPlan',
        invoke(event, ...rawArguments) {
          return invoke(options.decideAgentPlan, event, rawArguments, safeDecideAgentPlanRequest);
        },
      }),
      controlTask: Object.freeze({
        channel: CONTROL_WORKBENCH_TASK_CHANNEL,
        method: 'controlTask',
        invoke(event, ...rawArguments) {
          return invoke(options.controlTask, event, rawArguments, safeControlTaskRequest);
        },
      }),
    }),
    exposed_methods: Object.freeze([
      'read', 'updateMessageState', 'createTaskProposal', 'decideTaskProposal', 'decideAgentPlan', 'controlTask',
      'subscribeChanged',
    ]),
    authority: workbenchAuthority,
  });
}

module.exports = Object.freeze({
  READ_AGENT_WORKBENCH_CHANNEL,
  UPDATE_WORKBENCH_MESSAGE_STATE_CHANNEL,
  CREATE_WORKBENCH_TASK_PROPOSAL_CHANNEL,
  DECIDE_WORKBENCH_TASK_PROPOSAL_CHANNEL,
  DECIDE_AGENT_PLAN_CHANNEL,
  CONTROL_WORKBENCH_TASK_CHANNEL,
  WORKBENCH_CHANGED_CHANNEL,
  BuilderWorkbenchIpcError,
  createBuilderWorkbenchIpcAdapter,
});
