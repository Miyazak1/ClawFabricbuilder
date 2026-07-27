'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  BUILDER_AGENT_DEFINITION_RECORD_VERSION,
  BUILDER_AGENT_LIFECYCLE_RECORD_VERSION,
  BUILDER_AGENT_VERSION_RECORD_VERSION,
  BuilderAgentDefinitionContractError,
  createBuilderAgentDefinitionRecord,
  createBuilderAgentLifecycleRecord,
  createBuilderAgentVersionRecord,
  sanitizeBuilderAgentDefinitionRecord,
  sanitizeBuilderAgentLifecycleRecord,
  sanitizeBuilderAgentVersionRecord,
} = require('../electron/builder-agent-definition-contract.cjs');

const OWNER_ID = 'builder-user:123e4567-e89b-42d3-a456-426614174000';
const OTHER_OWNER_ID = 'builder-user:123e4567-e89b-42d3-a456-426614174001';
const AGENT_ID = 'builder-agent:123e4567-e89b-42d3-a456-426614174002';
const OTHER_AGENT_ID = 'builder-agent:123e4567-e89b-42d3-a456-426614174003';

function definitionInput(overrides = {}) {
  return {
    record_version: BUILDER_AGENT_DEFINITION_RECORD_VERSION,
    agent_id: AGENT_ID,
    owner_id: OWNER_ID,
    display_name: 'Builder Assistant',
    purpose: 'Help the owner plan and review local Builder work.',
    created_at_ms: 10,
    ...overrides,
  };
}

function versionInput(overrides = {}) {
  return {
    record_version: BUILDER_AGENT_VERSION_RECORD_VERSION,
    agent_id: AGENT_ID,
    owner_id: OWNER_ID,
    version_number: 1,
    instructions: 'Ask before changing files. Summarize any proposed work before requesting review.',
    created_at_ms: 20,
    permission_boundary: 'explicit_permission_required',
    ...overrides,
  };
}

function lifecycleInput(overrides = {}) {
  return {
    record_version: BUILDER_AGENT_LIFECYCLE_RECORD_VERSION,
    agent_id: AGENT_ID,
    owner_id: OWNER_ID,
    decided_by: OWNER_ID,
    next_status: 'archived',
    reason: 'No longer needed for this project.',
    decided_at_ms: 30,
    ...overrides,
  };
}

function assertContractError(fn) {
  assert.throws(
    fn,
    (error) => {
      assert.ok(error instanceof BuilderAgentDefinitionContractError);
      assert.equal(error.code, 'builder_agent_definition_contract_invalid');
      const text = `${error.name}:${error.message}:${error.stack}`;
      assert.doesNotMatch(text, /secret-value|credential|api\.deepseek|private marker/iu);
      return true;
    },
  );
}

test('creates deterministic owner-bound agent definition, version, and lifecycle records', () => {
  const definition = createBuilderAgentDefinitionRecord(definitionInput());
  const sameDefinition = createBuilderAgentDefinitionRecord(definitionInput());
  assert.deepEqual(definition, sameDefinition);
  assert.match(definition.definition_digest, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(definition.owner_id, OWNER_ID);
  assert.equal(definition.agent_id, AGENT_ID);
  assert.equal(Object.isFrozen(definition), true);

  const version = createBuilderAgentVersionRecord(versionInput(), definition);
  const sameVersion = createBuilderAgentVersionRecord(versionInput(), definition);
  assert.deepEqual(version, sameVersion);
  assert.match(version.agent_version_id, /^builder-agent-version:[0-9a-f]{64}$/u);
  assert.equal(version.definition_digest, definition.definition_digest);
  assert.equal(version.permission_boundary, 'explicit_permission_required');
  assert.equal(Object.hasOwn(version, 'permission_id'), false);
  assert.equal(Object.hasOwn(version, 'provider'), false);
  assert.equal(Object.hasOwn(version, 'credential'), false);
  assert.equal(Object.isFrozen(version), true);

  const lifecycle = createBuilderAgentLifecycleRecord(lifecycleInput(), definition);
  assert.match(lifecycle.agent_lifecycle_id, /^builder-agent-lifecycle:[0-9a-f]{64}$/u);
  assert.equal(lifecycle.definition_digest, definition.definition_digest);
  assert.equal(lifecycle.decided_by, OWNER_ID);
  assert.equal(lifecycle.next_status, 'archived');
  assert.equal(Object.isFrozen(lifecycle), true);

  assert.deepEqual(sanitizeBuilderAgentDefinitionRecord(structuredClone(definition)), definition);
  assert.deepEqual(sanitizeBuilderAgentVersionRecord(structuredClone(version), definition), version);
  assert.deepEqual(sanitizeBuilderAgentLifecycleRecord(structuredClone(lifecycle), definition), lifecycle);
});

test('rejects drift, cross-owner versions, and lifecycle decisions not made by the owner', () => {
  const definition = createBuilderAgentDefinitionRecord(definitionInput());
  const version = createBuilderAgentVersionRecord(versionInput(), definition);
  const lifecycle = createBuilderAgentLifecycleRecord(lifecycleInput(), definition);

  assertContractError(() => sanitizeBuilderAgentDefinitionRecord({
    ...definition,
    display_name: 'Changed',
  }));
  assertContractError(() => createBuilderAgentVersionRecord(versionInput({
    owner_id: OTHER_OWNER_ID,
  }), definition));
  assertContractError(() => createBuilderAgentVersionRecord(versionInput({
    agent_id: OTHER_AGENT_ID,
  }), definition));
  assertContractError(() => createBuilderAgentVersionRecord(versionInput({
    permission_boundary: 'implicit_permission',
  }), definition));
  assertContractError(() => sanitizeBuilderAgentVersionRecord({
    ...version,
    instructions: `${version.instructions} changed`,
  }, definition));
  assertContractError(() => createBuilderAgentLifecycleRecord(lifecycleInput({
    decided_by: OTHER_OWNER_ID,
  }), definition));
  assertContractError(() => createBuilderAgentLifecycleRecord(lifecycleInput({
    next_status: 'deleted',
  }), definition));
  assertContractError(() => sanitizeBuilderAgentLifecycleRecord({
    ...lifecycle,
    reason: `${lifecycle.reason} changed`,
  }, definition));
});

test('fails closed on malformed values, extras, accessors, and proxies without leaking raw input', () => {
  const definition = createBuilderAgentDefinitionRecord(definitionInput());

  assertContractError(() => createBuilderAgentDefinitionRecord({ ...definitionInput(), extra: true }));
  assertContractError(() => createBuilderAgentDefinitionRecord({
    ...definitionInput(),
    display_name: ' secret-value ',
  }));
  assertContractError(() => createBuilderAgentVersionRecord({
    ...versionInput(),
    instructions: `Use credential secret-value.\n`,
  }, definition));
  assertContractError(() => createBuilderAgentVersionRecord({
    ...versionInput(),
    version_number: 0,
  }, definition));

  let getterCalls = 0;
  assertContractError(() => createBuilderAgentDefinitionRecord(Object.defineProperty(
    definitionInput(),
    'display_name',
    {
      enumerable: true,
      get() {
        getterCalls += 1;
        return 'private marker';
      },
    },
  )));
  assert.equal(getterCalls, 0);

  let proxyTrapInvoked = false;
  const proxyTrap = () => {
    proxyTrapInvoked = true;
    throw new Error('private marker');
  };
  assertContractError(() => createBuilderAgentDefinitionRecord(new Proxy(definitionInput(), {
    getOwnPropertyDescriptor: proxyTrap,
    getPrototypeOf: proxyTrap,
    ownKeys: proxyTrap,
  })));
  assert.equal(proxyTrapInvoked, false);
});

test('source remains a pure local agent identity contract with no runtime authority', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'electron', 'builder-agent-definition-contract.cjs'),
    'utf8',
  );

  assert.doesNotMatch(source, /node:fs|node:sqlite|ipc|preload|safeStorage|credential|provider|dugite|git|child_process|spawn|exec|fetch|localStorage|sessionStorage/iu);
  assert.match(source, /explicit_permission_required/u);
  assert.match(source, /builder-agent-definition-contract\.v1/u);
});
