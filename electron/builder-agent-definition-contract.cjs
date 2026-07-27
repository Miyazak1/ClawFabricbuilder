'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const BUILDER_AGENT_DEFINITION_CONTRACT_VERSION = 'builder-agent-definition-contract.v1';
const BUILDER_AGENT_DEFINITION_RECORD_VERSION = 'builder-agent-definition-record.v1';
const BUILDER_AGENT_VERSION_RECORD_VERSION = 'builder-agent-version-record.v1';
const BUILDER_AGENT_LIFECYCLE_RECORD_VERSION = 'builder-agent-lifecycle-record.v1';
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const OWNER_ID_PATTERN = new RegExp(`^builder-user:${UUID_SOURCE}$`, 'u');
const AGENT_ID_PATTERN = new RegExp(`^builder-agent:${UUID_SOURCE}$`, 'u');
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const AGENT_VERSION_ID_PATTERN = /^builder-agent-version:[0-9a-f]{64}$/u;
const AGENT_LIFECYCLE_ID_PATTERN = /^builder-agent-lifecycle:[0-9a-f]{64}$/u;
const DEFINITION_INPUT_KEYS = Object.freeze([
  'record_version',
  'agent_id',
  'owner_id',
  'display_name',
  'purpose',
  'created_at_ms',
]);
const DEFINITION_RECORD_KEYS = Object.freeze(['definition_digest', ...DEFINITION_INPUT_KEYS]);
const VERSION_INPUT_KEYS = Object.freeze([
  'record_version',
  'agent_id',
  'owner_id',
  'version_number',
  'instructions',
  'created_at_ms',
  'permission_boundary',
]);
const VERSION_RECORD_KEYS = Object.freeze(['agent_version_id', 'definition_digest', ...VERSION_INPUT_KEYS]);
const LIFECYCLE_INPUT_KEYS = Object.freeze([
  'record_version',
  'agent_id',
  'owner_id',
  'decided_by',
  'next_status',
  'reason',
  'decided_at_ms',
]);
const LIFECYCLE_RECORD_KEYS = Object.freeze(['agent_lifecycle_id', 'definition_digest', ...LIFECYCLE_INPUT_KEYS]);
const ERROR_MESSAGES = Object.freeze({
  builder_agent_definition_contract_invalid: 'Builder agent definition could not be verified.',
});

class BuilderAgentDefinitionContractError extends Error {
  constructor() {
    super(ERROR_MESSAGES.builder_agent_definition_contract_invalid);
    this.name = 'BuilderAgentDefinitionContractError';
    this.code = 'builder_agent_definition_contract_invalid';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderAgentDefinitionContractError();
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

function exactObject(value, keys) {
  if (!isPlainObject(value)) fail();
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== keys.length
    || actual.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) fail();
  for (const key of actual) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      fail();
    }
  }
}

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
    fail();
  }
  return descriptor.value;
}

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freezeDeep(nested);
    Object.freeze(value);
  }
  return value;
}

function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map(
      (key) => `${JSON.stringify(key)}:${canonicalJson(valueAt(value, key))}`,
    ).join(',')}}`;
  }
  fail();
}

function sha256Canonical(value) {
  return `sha256:${nodeCrypto.createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')}`;
}

function safePattern(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) fail();
  return value;
}

function safeAgentId(value) {
  return safePattern(value, AGENT_ID_PATTERN);
}

function safeOwnerId(value) {
  return safePattern(value, OWNER_ID_PATTERN);
}

function safeDigest(value) {
  return safePattern(value, DIGEST_PATTERN);
}

function safeAgentVersionId(value) {
  return safePattern(value, AGENT_VERSION_ID_PATTERN);
}

function safeAgentLifecycleId(value) {
  return safePattern(value, AGENT_LIFECYCLE_ID_PATTERN);
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail();
  return value;
}

function safePositiveInteger(value, max) {
  if (!Number.isSafeInteger(value) || value < 1 || value > max) fail();
  return value;
}

function safeText(value, minLength, maxLength) {
  if (
    typeof value !== 'string'
    || value.trim() !== value
    || value.length < minLength
    || value.length > maxLength
  ) fail();
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) fail();
  }
  return value;
}

function safeDefinitionFields(value) {
  exactObject(value, DEFINITION_INPUT_KEYS);
  const recordVersion = valueAt(value, 'record_version');
  if (recordVersion !== BUILDER_AGENT_DEFINITION_RECORD_VERSION) fail();
  return freezeDeep({
    record_version: BUILDER_AGENT_DEFINITION_RECORD_VERSION,
    agent_id: safeAgentId(valueAt(value, 'agent_id')),
    owner_id: safeOwnerId(valueAt(value, 'owner_id')),
    display_name: safeText(valueAt(value, 'display_name'), 1, 80),
    purpose: safeText(valueAt(value, 'purpose'), 0, 280),
    created_at_ms: safeTimestamp(valueAt(value, 'created_at_ms')),
  });
}

function definitionDigestFor(fields) {
  return sha256Canonical({
    agent_definition_identity: BUILDER_AGENT_DEFINITION_RECORD_VERSION,
    fields,
  });
}

function createBuilderAgentDefinitionRecord(value) {
  try {
    const fields = safeDefinitionFields(value);
    return freezeDeep({
      definition_digest: definitionDigestFor(fields),
      ...fields,
    });
  } catch (error) {
    if (error instanceof BuilderAgentDefinitionContractError) throw error;
    fail();
  }
}

function sanitizeBuilderAgentDefinitionRecord(value) {
  try {
    exactObject(value, DEFINITION_RECORD_KEYS);
    const definitionDigest = safeDigest(valueAt(value, 'definition_digest'));
    const fields = safeDefinitionFields({
      record_version: valueAt(value, 'record_version'),
      agent_id: valueAt(value, 'agent_id'),
      owner_id: valueAt(value, 'owner_id'),
      display_name: valueAt(value, 'display_name'),
      purpose: valueAt(value, 'purpose'),
      created_at_ms: valueAt(value, 'created_at_ms'),
    });
    if (definitionDigest !== definitionDigestFor(fields)) fail();
    return freezeDeep({ definition_digest: definitionDigest, ...fields });
  } catch (error) {
    if (error instanceof BuilderAgentDefinitionContractError) throw error;
    fail();
  }
}

function safeVersionFields(value, definition) {
  exactObject(value, VERSION_INPUT_KEYS);
  const recordVersion = valueAt(value, 'record_version');
  const agentId = safeAgentId(valueAt(value, 'agent_id'));
  const ownerId = safeOwnerId(valueAt(value, 'owner_id'));
  const permissionBoundary = valueAt(value, 'permission_boundary');
  if (
    recordVersion !== BUILDER_AGENT_VERSION_RECORD_VERSION
    || agentId !== definition.agent_id
    || ownerId !== definition.owner_id
    || permissionBoundary !== 'explicit_permission_required'
  ) fail();
  return freezeDeep({
    record_version: BUILDER_AGENT_VERSION_RECORD_VERSION,
    agent_id: agentId,
    owner_id: ownerId,
    version_number: safePositiveInteger(valueAt(value, 'version_number'), 10_000),
    instructions: safeText(valueAt(value, 'instructions'), 1, 8_000),
    created_at_ms: safeTimestamp(valueAt(value, 'created_at_ms')),
    permission_boundary: 'explicit_permission_required',
  });
}

function agentVersionIdFor(definition, fields) {
  return `builder-agent-version:${sha256Canonical({
    agent_version_identity: BUILDER_AGENT_VERSION_RECORD_VERSION,
    definition_digest: definition.definition_digest,
    fields,
  }).slice('sha256:'.length)}`;
}

function createBuilderAgentVersionRecord(value, definitionRecord) {
  try {
    const definition = sanitizeBuilderAgentDefinitionRecord(definitionRecord);
    const fields = safeVersionFields(value, definition);
    return freezeDeep({
      agent_version_id: agentVersionIdFor(definition, fields),
      definition_digest: definition.definition_digest,
      ...fields,
    });
  } catch (error) {
    if (error instanceof BuilderAgentDefinitionContractError) throw error;
    fail();
  }
}

function sanitizeBuilderAgentVersionRecord(value, definitionRecord) {
  try {
    const definition = sanitizeBuilderAgentDefinitionRecord(definitionRecord);
    exactObject(value, VERSION_RECORD_KEYS);
    const agentVersionId = safeAgentVersionId(valueAt(value, 'agent_version_id'));
    const definitionDigest = safeDigest(valueAt(value, 'definition_digest'));
    if (definitionDigest !== definition.definition_digest) fail();
    const fields = safeVersionFields({
      record_version: valueAt(value, 'record_version'),
      agent_id: valueAt(value, 'agent_id'),
      owner_id: valueAt(value, 'owner_id'),
      version_number: valueAt(value, 'version_number'),
      instructions: valueAt(value, 'instructions'),
      created_at_ms: valueAt(value, 'created_at_ms'),
      permission_boundary: valueAt(value, 'permission_boundary'),
    }, definition);
    if (agentVersionId !== agentVersionIdFor(definition, fields)) fail();
    return freezeDeep({ agent_version_id: agentVersionId, definition_digest: definitionDigest, ...fields });
  } catch (error) {
    if (error instanceof BuilderAgentDefinitionContractError) throw error;
    fail();
  }
}

function safeLifecycleStatus(value) {
  if (value !== 'active' && value !== 'archived' && value !== 'revoked') fail();
  return value;
}

function safeLifecycleFields(value, definition) {
  exactObject(value, LIFECYCLE_INPUT_KEYS);
  const recordVersion = valueAt(value, 'record_version');
  const agentId = safeAgentId(valueAt(value, 'agent_id'));
  const ownerId = safeOwnerId(valueAt(value, 'owner_id'));
  const decidedBy = safeOwnerId(valueAt(value, 'decided_by'));
  if (
    recordVersion !== BUILDER_AGENT_LIFECYCLE_RECORD_VERSION
    || agentId !== definition.agent_id
    || ownerId !== definition.owner_id
    || decidedBy !== definition.owner_id
  ) fail();
  return freezeDeep({
    record_version: BUILDER_AGENT_LIFECYCLE_RECORD_VERSION,
    agent_id: agentId,
    owner_id: ownerId,
    decided_by: decidedBy,
    next_status: safeLifecycleStatus(valueAt(value, 'next_status')),
    reason: safeText(valueAt(value, 'reason'), 0, 280),
    decided_at_ms: safeTimestamp(valueAt(value, 'decided_at_ms')),
  });
}

function agentLifecycleIdFor(definition, fields) {
  return `builder-agent-lifecycle:${sha256Canonical({
    agent_lifecycle_identity: BUILDER_AGENT_LIFECYCLE_RECORD_VERSION,
    definition_digest: definition.definition_digest,
    fields,
  }).slice('sha256:'.length)}`;
}

function createBuilderAgentLifecycleRecord(value, definitionRecord) {
  try {
    const definition = sanitizeBuilderAgentDefinitionRecord(definitionRecord);
    const fields = safeLifecycleFields(value, definition);
    return freezeDeep({
      agent_lifecycle_id: agentLifecycleIdFor(definition, fields),
      definition_digest: definition.definition_digest,
      ...fields,
    });
  } catch (error) {
    if (error instanceof BuilderAgentDefinitionContractError) throw error;
    fail();
  }
}

function sanitizeBuilderAgentLifecycleRecord(value, definitionRecord) {
  try {
    const definition = sanitizeBuilderAgentDefinitionRecord(definitionRecord);
    exactObject(value, LIFECYCLE_RECORD_KEYS);
    const agentLifecycleId = safeAgentLifecycleId(valueAt(value, 'agent_lifecycle_id'));
    const definitionDigest = safeDigest(valueAt(value, 'definition_digest'));
    if (definitionDigest !== definition.definition_digest) fail();
    const fields = safeLifecycleFields({
      record_version: valueAt(value, 'record_version'),
      agent_id: valueAt(value, 'agent_id'),
      owner_id: valueAt(value, 'owner_id'),
      decided_by: valueAt(value, 'decided_by'),
      next_status: valueAt(value, 'next_status'),
      reason: valueAt(value, 'reason'),
      decided_at_ms: valueAt(value, 'decided_at_ms'),
    }, definition);
    if (agentLifecycleId !== agentLifecycleIdFor(definition, fields)) fail();
    return freezeDeep({ agent_lifecycle_id: agentLifecycleId, definition_digest: definitionDigest, ...fields });
  } catch (error) {
    if (error instanceof BuilderAgentDefinitionContractError) throw error;
    fail();
  }
}

module.exports = Object.freeze({
  BUILDER_AGENT_DEFINITION_CONTRACT_VERSION,
  BUILDER_AGENT_DEFINITION_RECORD_VERSION,
  BUILDER_AGENT_VERSION_RECORD_VERSION,
  BUILDER_AGENT_LIFECYCLE_RECORD_VERSION,
  BuilderAgentDefinitionContractError,
  createBuilderAgentDefinitionRecord,
  createBuilderAgentLifecycleRecord,
  createBuilderAgentVersionRecord,
  sanitizeBuilderAgentDefinitionRecord,
  sanitizeBuilderAgentLifecycleRecord,
  sanitizeBuilderAgentVersionRecord,
});
