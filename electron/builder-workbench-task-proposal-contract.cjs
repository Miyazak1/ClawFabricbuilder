'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const PROPOSAL_VERSION = 'builder-workbench-task-proposal.v1';
const DECISION_VERSION = 'builder-workbench-task-proposal-decision.v1';
const MATERIALIZATION_VERSION = 'builder-workbench-task-materialization.v1';
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const PROPOSAL_ID = new RegExp(`^builder-task-proposal:${UUID}$`, 'u');
const AGENT_ID = new RegExp(`^builder-agent:${UUID}$`, 'u');
const PROJECT_ID = new RegExp(`^builder-project:${UUID}$`, 'u');
const TASK_ID = new RegExp(`^builder-task-address:${UUID}$`, 'u');
const SESSION_ID = new RegExp(`^builder-session:${UUID}$`, 'u');
const CONVERSATION_ID = new RegExp(`^builder-conversation:${UUID}:${UUID}$`, 'u');
const ACTION_ID = /^builder-workbench-action:[0-9a-f]{64}$/u;
const MESSAGE_ID = new RegExp(`^builder-message:${UUID}$`, 'u');
const REQUEST_ID = new RegExp(`^builder-workbench-request:${UUID}$`, 'u');
const OUTCOMES = Object.freeze(['discuss', 'plan', 'build', 'review', 'research', 'monitor']);
const EXECUTION_MODES = Object.freeze(['foreground', 'parallel']);
const DECISIONS = Object.freeze(['approve_existing_project', 'reject']);

class BuilderWorkbenchTaskProposalContractError extends Error {
  constructor() {
    super('Builder Workbench task proposal could not be verified.');
    this.name = 'BuilderWorkbenchTaskProposalContractError';
    this.code = 'builder_workbench_task_proposal_invalid';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() { throw new BuilderWorkbenchTaskProposalContractError(); }
function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freezeDeep(nested);
    Object.freeze(value);
  }
  return value;
}
function plain(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || utilTypes.isProxy(value)) fail();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail();
  return value;
}
function exact(value, keys) {
  plain(value);
  const actual = Reflect.ownKeys(value);
  if (actual.length !== keys.length || actual.some((key) => typeof key !== 'string' || !keys.includes(key))) fail();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of keys) {
    if (!descriptors[key]?.enumerable || !Object.hasOwn(descriptors[key], 'value')) fail();
  }
  return descriptors;
}
function pattern(value, matcher) {
  if (typeof value !== 'string' || !matcher.test(value)) fail();
  return value;
}
function text(value, maximum) {
  if (typeof value !== 'string' || value.trim() !== value || value.length < 1 || value.length > maximum) fail();
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (
      code <= 0x08
      || code === 0x0b
      || code === 0x0c
      || (code >= 0x0e && code <= 0x1f)
      || code === 0x7f
    ) fail();
  }
  return value;
}
function timestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail();
  return value;
}
function enumValue(value, allowed) {
  if (typeof value !== 'string' || !allowed.includes(value)) fail();
  return value;
}
function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  plain(value);
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}
function digest(value) {
  return nodeCrypto.createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

function createBuilderWorkbenchTaskProposal(raw) {
  const input = exact(raw, [
    'proposal_id', 'request_id', 'action_id', 'message_id', 'agent_id', 'owner_id',
    'objective', 'requested_outcome', 'execution_mode', 'reason', 'created_at_ms', 'expires_at_ms',
  ]);
  const createdAtMs = timestamp(input.created_at_ms.value);
  const expiresAtMs = timestamp(input.expires_at_ms.value);
  if (expiresAtMs <= createdAtMs) fail();
  const body = {
    proposal_id: pattern(input.proposal_id.value, PROPOSAL_ID),
    request_id: pattern(input.request_id.value, REQUEST_ID),
    action_id: pattern(input.action_id.value, ACTION_ID),
    message_id: pattern(input.message_id.value, MESSAGE_ID),
    agent_id: pattern(input.agent_id.value, AGENT_ID),
    owner_id: text(input.owner_id.value, 80),
    objective: text(input.objective.value, 2_048),
    requested_outcome: enumValue(input.requested_outcome.value, OUTCOMES),
    execution_mode: enumValue(input.execution_mode.value, EXECUTION_MODES),
    reason: text(input.reason.value, 1_024),
    project_scope: 'unresolved',
    created_at_ms: createdAtMs,
    expires_at_ms: expiresAtMs,
  };
  return freezeDeep({ proposal_version: PROPOSAL_VERSION, proposal_digest: `sha256:${digest(body)}`, ...body });
}

function sanitizeBuilderWorkbenchTaskProposal(raw) {
  const source = exact(raw, [
    'proposal_version', 'proposal_digest', 'proposal_id', 'request_id', 'action_id', 'message_id',
    'agent_id', 'owner_id', 'objective', 'requested_outcome', 'execution_mode', 'reason',
    'project_scope', 'created_at_ms', 'expires_at_ms',
  ]);
  if (source.proposal_version.value !== PROPOSAL_VERSION || source.project_scope.value !== 'unresolved') fail();
  const rebuilt = createBuilderWorkbenchTaskProposal({
    proposal_id: source.proposal_id.value,
    request_id: source.request_id.value,
    action_id: source.action_id.value,
    message_id: source.message_id.value,
    agent_id: source.agent_id.value,
    owner_id: source.owner_id.value,
    objective: source.objective.value,
    requested_outcome: source.requested_outcome.value,
    execution_mode: source.execution_mode.value,
    reason: source.reason.value,
    created_at_ms: source.created_at_ms.value,
    expires_at_ms: source.expires_at_ms.value,
  });
  if (source.proposal_digest.value !== rebuilt.proposal_digest) fail();
  return rebuilt;
}

function createBuilderWorkbenchTaskProposalDecision(raw) {
  const input = exact(raw, ['proposal_id', 'decision', 'project_id', 'decided_by', 'decided_at_ms']);
  const decision = enumValue(input.decision.value, DECISIONS);
  const projectId = input.project_id.value === null ? null : pattern(input.project_id.value, PROJECT_ID);
  if ((decision === 'reject') !== (projectId === null)) fail();
  const body = {
    proposal_id: pattern(input.proposal_id.value, PROPOSAL_ID),
    decision,
    project_id: projectId,
    decided_by: text(input.decided_by.value, 80),
    decided_at_ms: timestamp(input.decided_at_ms.value),
  };
  return freezeDeep({ decision_version: DECISION_VERSION, decision_digest: `sha256:${digest(body)}`, ...body });
}

function sanitizeBuilderWorkbenchTaskProposalDecision(raw) {
  const source = exact(raw, ['decision_version', 'decision_digest', 'proposal_id', 'decision', 'project_id', 'decided_by', 'decided_at_ms']);
  if (source.decision_version.value !== DECISION_VERSION) fail();
  const rebuilt = createBuilderWorkbenchTaskProposalDecision({
    proposal_id: source.proposal_id.value,
    decision: source.decision.value,
    project_id: source.project_id.value,
    decided_by: source.decided_by.value,
    decided_at_ms: source.decided_at_ms.value,
  });
  if (source.decision_digest.value !== rebuilt.decision_digest) fail();
  return rebuilt;
}

function createBuilderWorkbenchTaskMaterialization(raw) {
  const input = exact(raw, [
    'proposal_id', 'project_id', 'session_id', 'task_address_id', 'conversation_id',
    'objective', 'origin_message_id', 'materialized_at_ms',
  ]);
  const body = {
    proposal_id: pattern(input.proposal_id.value, PROPOSAL_ID),
    project_id: pattern(input.project_id.value, PROJECT_ID),
    session_id: pattern(input.session_id.value, SESSION_ID),
    task_address_id: pattern(input.task_address_id.value, TASK_ID),
    conversation_id: pattern(input.conversation_id.value, CONVERSATION_ID),
    objective: text(input.objective.value, 2_048),
    origin_message_id: pattern(input.origin_message_id.value, MESSAGE_ID),
    materialized_at_ms: timestamp(input.materialized_at_ms.value),
    context_capsule: {
      capsule_version: 'builder-workbench-incubation-context-capsule.v1',
      provider_dispatch: false,
      permission_grant: false,
    },
  };
  return freezeDeep({ materialization_version: MATERIALIZATION_VERSION, materialization_digest: `sha256:${digest(body)}`, ...body });
}

function sanitizeBuilderWorkbenchTaskMaterialization(raw) {
  const source = exact(raw, [
    'materialization_version', 'materialization_digest', 'proposal_id', 'project_id', 'session_id',
    'task_address_id', 'conversation_id', 'objective', 'origin_message_id', 'materialized_at_ms',
    'context_capsule',
  ]);
  if (source.materialization_version.value !== MATERIALIZATION_VERSION) fail();
  const capsule = exact(source.context_capsule.value, ['capsule_version', 'provider_dispatch', 'permission_grant']);
  if (capsule.capsule_version.value !== 'builder-workbench-incubation-context-capsule.v1' || capsule.provider_dispatch.value !== false || capsule.permission_grant.value !== false) fail();
  const rebuilt = createBuilderWorkbenchTaskMaterialization({
    proposal_id: source.proposal_id.value,
    project_id: source.project_id.value,
    session_id: source.session_id.value,
    task_address_id: source.task_address_id.value,
    conversation_id: source.conversation_id.value,
    objective: source.objective.value,
    origin_message_id: source.origin_message_id.value,
    materialized_at_ms: source.materialized_at_ms.value,
  });
  if (source.materialization_digest.value !== rebuilt.materialization_digest) fail();
  return rebuilt;
}

module.exports = Object.freeze({
  PROPOSAL_VERSION,
  DECISION_VERSION,
  MATERIALIZATION_VERSION,
  BuilderWorkbenchTaskProposalContractError,
  createBuilderWorkbenchTaskProposal,
  sanitizeBuilderWorkbenchTaskProposal,
  createBuilderWorkbenchTaskProposalDecision,
  sanitizeBuilderWorkbenchTaskProposalDecision,
  createBuilderWorkbenchTaskMaterialization,
  sanitizeBuilderWorkbenchTaskMaterialization,
});
