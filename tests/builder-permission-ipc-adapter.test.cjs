'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  BUILDER_PERMISSION_DECISION_VERSION,
  BUILDER_PERMISSION_POLICY_VERSION,
} = require('../electron/builder-permission-authority-contract.cjs');
const {
  EVALUATE_PERMISSION_CHANNEL,
  BuilderPermissionIpcError,
  createBuilderPermissionIpcAdapter,
} = require('../electron/builder-permission-ipc-adapter.cjs');

const PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174000';
const ACTOR_ID = 'builder-user:123e4567-e89b-42d3-a456-426614174001';
const PERMISSION_ID = `builder-permission:${'a'.repeat(64)}`;

function windowAuthority() {
  const webContents = Object.freeze({
    isDestroyed: () => false,
  });
  const window = Object.freeze({
    webContents,
    isDestroyed: () => false,
  });
  return { event: Object.freeze({ sender: webContents }), mainWindowRef: () => window };
}

function request(overrides = {}) {
  return {
    project_id: PROJECT_ID,
    action: 'project.edit',
    resource_kind: 'project',
    resource_id: 'project:self',
    ...overrides,
  };
}

function decision(overrides = {}) {
  return {
    decision_version: BUILDER_PERMISSION_DECISION_VERSION,
    policy_version: BUILDER_PERMISSION_POLICY_VERSION,
    actor_id: ACTOR_ID,
    action: 'project.edit',
    resource: {
      resource_kind: 'project',
      project_id: PROJECT_ID,
      resource_id: 'project:self',
    },
    evaluated_at_ms: 30,
    decision: 'denied',
    reason: 'no_matching_active_grant',
    permission_id: null,
    permission_authority: 'builder_permission_facts_deny_by_default_v1',
    ui_selection_authority: 'not_permission',
    ...overrides,
  };
}

function allowedDecision() {
  return decision({
    decision: 'allowed',
    reason: 'matching_active_grant',
    permission_id: PERMISSION_ID,
  });
}

function adapter(overrides = {}) {
  const authority = windowAuthority();
  const calls = [];
  const value = createBuilderPermissionIpcAdapter({
    evaluatePermission: overrides.evaluatePermission ?? (async (body) => {
      calls.push(body);
      return allowedDecision();
    }),
    mainWindowRef: authority.mainWindowRef,
  });
  return { authority, calls, value };
}

test('permission adapter exposes evaluate channel without fact readback or grant authority', async () => {
  const { authority, calls, value } = adapter();
  assert.equal(value.adapter_id, 'builder_permission.controlled_ipc_adapter.v1');
  assert.equal(value.namespace, 'builderPermission');
  assert.equal(value.preload_namespace, 'window.clawfabricBuilder.permissions');
  assert.deepEqual(value.exposed_methods, ['evaluate']);
  assert.deepEqual(Object.keys(value.channels), ['evaluate']);
  assert.equal(value.channels.evaluate.channel, EVALUATE_PERMISSION_CHANNEL);
  assert.equal(value.authority.renderer_authority, 'project_action_resource_only');
  assert.equal(value.authority.actor_authority, 'main_bound_local_user');
  assert.equal(value.authority.permission_fact_authority, 'main_owned_sqlite_permission_facts');
  assert.equal(value.authority.read_only, true);
  assert.equal(value.authority.active_renderer_required, true);
  assert.equal(value.authority.grant_command, false);
  assert.equal(value.authority.revoke_command, false);
  assert.equal(value.authority.grants_exposed, false);
  assert.equal(value.authority.revocations_exposed, false);
  assert.equal(value.authority.direct_electron_registration, false);
  assert.equal(value.authority.direct_preload_exposure, false);

  const result = await value.channels.evaluate.invoke(authority.event, request());
  assert.deepEqual(result, allowedDecision());
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.resource), true);
  assert.equal(Object.hasOwn(result, 'grants'), false);
  assert.equal(Object.hasOwn(result, 'revocations'), false);
  assert.deepEqual(calls, [request()]);
});

test('permission adapter rejects inactive renderers and malformed payloads before invoking authority', async () => {
  const { authority, calls, value } = adapter();
  await assert.rejects(
    value.channels.evaluate.invoke(Object.freeze({ sender: Object.freeze({}) }), request()),
    (error) => error instanceof BuilderPermissionIpcError
      && error.code === 'builder_permission_forbidden'
      && error.stack === `${error.name}: ${error.message}`,
  );
  for (const payload of [
    undefined,
    { ...request(), project_id: 'bad' },
    { ...request(), action: 'project.edit', resource_kind: 'revision' },
    { ...request(), resource_kind: 'network' },
    { ...request(), resource_id: ' Project ' },
    { ...request(), extra: true },
  ]) {
    await assert.rejects(
      value.channels.evaluate.invoke(authority.event, payload),
      (error) => error instanceof BuilderPermissionIpcError
        && error.code === 'builder_permission_request_invalid'
        && error.stack === `${error.name}: ${error.message}`,
    );
  }
  await assert.rejects(
    value.channels.evaluate.invoke(authority.event, request(), { extra: true }),
    (error) => error instanceof BuilderPermissionIpcError
      && error.code === 'builder_permission_request_invalid',
  );
  assert.deepEqual(calls, []);
});

test('permission adapter maps authority and output failures to fixed redacted errors', async () => {
  const source = new Error('private permission marker');
  source.code = 'builder_permission_unavailable';
  const { authority, value } = adapter({
    evaluatePermission: async () => { throw source; },
  });
  await assert.rejects(
    value.channels.evaluate.invoke(authority.event, request()),
    (error) => error instanceof BuilderPermissionIpcError
      && error.code === 'builder_permission_unavailable'
      && error.retryable === true
      && !`${error.message}:${error.stack}`.includes('private permission marker'),
  );
  const drift = adapter({
    evaluatePermission: async () => decision({
      resource: { resource_kind: 'project', project_id: PROJECT_ID, resource_id: 'project:other' },
    }),
  });
  await assert.rejects(
    drift.value.channels.evaluate.invoke(drift.authority.event, request()),
    (error) => error instanceof BuilderPermissionIpcError
      && error.code === 'builder_permission_unavailable',
  );
});

test('permission adapter fails closed on hostile output without invoking proxy traps', async () => {
  let traps = 0;
  const hostile = new Proxy({}, {
    ownKeys() {
      traps += 1;
      throw new Error('private output marker');
    },
    getPrototypeOf() {
      traps += 1;
      throw new Error('private output marker');
    },
  });
  const { authority, value } = adapter({
    evaluatePermission: async () => hostile,
  });
  await assert.rejects(
    value.channels.evaluate.invoke(authority.event, request()),
    (error) => error instanceof BuilderPermissionIpcError
      && error.code === 'builder_permission_unavailable',
  );
  assert.equal(traps, 0);

  const accessor = adapter({
    evaluatePermission: async () => {
      const output = allowedDecision();
      Object.defineProperty(output, 'permission_id', {
        enumerable: true,
        get() { return PERMISSION_ID; },
      });
      return output;
    },
  });
  await assert.rejects(
    accessor.value.channels.evaluate.invoke(accessor.authority.event, request()),
    { code: 'builder_permission_unavailable' },
  );
});

test('permission adapter rejects malformed options without invoking getters or proxy traps', () => {
  const authority = windowAuthority();
  let getterCalls = 0;
  const accessorOptions = {
    evaluatePermission: async () => allowedDecision(),
  };
  Object.defineProperty(accessorOptions, 'mainWindowRef', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return authority.mainWindowRef;
    },
  });
  for (const invalid of [
    null,
    {},
    {
      evaluatePermission: async () => allowedDecision(),
      mainWindowRef: authority.mainWindowRef,
      extra: true,
    },
    accessorOptions,
    new Proxy({}, { getPrototypeOf() { throw new Error('private proxy marker'); } }),
  ]) {
    assert.throws(
      () => createBuilderPermissionIpcAdapter(invalid),
      (error) => error instanceof BuilderPermissionIpcError
        && error.code === 'builder_permission_unavailable'
        && !`${error.message}:${error.stack}`.includes('private'),
    );
  }
  assert.equal(getterCalls, 0);
});

test('permission adapter source has no registration, storage, grant command, provider, Git, network, or legacy authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-permission-ipc-adapter.cjs'),
    'utf8',
  );
  assert.match(source, /active_renderer_required:\s*true/u);
  assert.match(source, /read_only:\s*true/u);
  assert.match(source, /grant_command:\s*false/u);
  assert.match(source, /revoke_command:\s*false/u);
  assert.match(source, /grants_exposed:\s*false/u);
  assert.match(source, /revocations_exposed:\s*false/u);
  assert.match(source, /actor_authority:\s*'main_bound_local_user'/u);
  assert.doesNotMatch(
    source,
    /GRANT_PERMISSION_CHANNEL|clawfabric-builder:permissions:grant|require\(['"]electron['"]\)|ipcMain|ipcRenderer|contextBridge|BrowserWindow|safeStorage|builder-provider|builder-git-|builder-permission-fact-store|node:sqlite|better-sqlite|fetch\s*\(|https?:|saveDraft|generate|record_grant|record_revocation|persist_candidate_commit|write_current|local-provider-executor|chat_planner|ChatCreatePage|Canvas|JobMeta/iu,
  );
});
