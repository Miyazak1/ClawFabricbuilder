'use strict';

const {
  BUILDER_AGENT_DEFINITION_RECORD_VERSION,
  BUILDER_AGENT_LIFECYCLE_RECORD_VERSION,
  BUILDER_AGENT_VERSION_RECORD_VERSION,
  createBuilderAgentDefinitionRecord,
  createBuilderAgentLifecycleRecord,
  createBuilderAgentVersionRecord,
} = require('./builder-agent-definition-contract.cjs');

const BUILDER_DEFAULT_AGENT_BOOTSTRAP_VERSION = 'builder-default-agent-bootstrap.v1';
const DEFAULT_BUILDER_AGENT_ID = 'builder-agent:123e4567-e89b-42d3-a456-426614174002';
const DEFAULT_BUILDER_AGENT_CREATED_AT_MS = 0;

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freezeDeep(nested);
    Object.freeze(value);
  }
  return value;
}

function createBuilderDefaultAgentBootstrap({ agent_store, owner_id }) {
  const definition = createBuilderAgentDefinitionRecord({
    record_version: BUILDER_AGENT_DEFINITION_RECORD_VERSION,
    agent_id: DEFAULT_BUILDER_AGENT_ID,
    owner_id,
    display_name: 'Builder',
    purpose: 'Plan, build, review, and maintain the owner\'s local projects.',
    created_at_ms: DEFAULT_BUILDER_AGENT_CREATED_AT_MS,
  });
  const version = createBuilderAgentVersionRecord({
    record_version: BUILDER_AGENT_VERSION_RECORD_VERSION,
    agent_id: definition.agent_id,
    owner_id: definition.owner_id,
    version_number: 1,
    instructions: 'Act as the owner\'s general Builder agent. Preserve project context and require explicit permission for protected actions.',
    created_at_ms: DEFAULT_BUILDER_AGENT_CREATED_AT_MS,
    permission_boundary: 'explicit_permission_required',
  }, definition);
  const lifecycle = createBuilderAgentLifecycleRecord({
    record_version: BUILDER_AGENT_LIFECYCLE_RECORD_VERSION,
    agent_id: definition.agent_id,
    owner_id: definition.owner_id,
    decided_by: definition.owner_id,
    next_status: 'active',
    reason: 'Default Builder agent bootstrap.',
    decided_at_ms: DEFAULT_BUILDER_AGENT_CREATED_AT_MS,
  }, definition);

  const definitionResult = agent_store.record_definition({ definition });
  const versionResult = agent_store.record_version({ version });
  const lifecycleResult = agent_store.record_lifecycle({ lifecycle });
  const readback = agent_store.read_agent({
    agent_id: DEFAULT_BUILDER_AGENT_ID,
    owner_id,
  });
  if (
    readback.status !== 'ready'
    || readback.current_status !== 'active'
    || readback.current_version?.agent_version_id !== version.agent_version_id
  ) throw new Error('Builder default agent setup failed.');

  return freezeDeep({
    bootstrap_version: BUILDER_DEFAULT_AGENT_BOOTSTRAP_VERSION,
    operation: 'default_agent_ready',
    agent_id: DEFAULT_BUILDER_AGENT_ID,
    owner_id,
    definition_operation: definitionResult.operation,
    version_operation: versionResult.operation,
    lifecycle_operation: lifecycleResult.operation,
  });
}

module.exports = Object.freeze({
  BUILDER_DEFAULT_AGENT_BOOTSTRAP_VERSION,
  DEFAULT_BUILDER_AGENT_ID,
  createBuilderDefaultAgentBootstrap,
});
