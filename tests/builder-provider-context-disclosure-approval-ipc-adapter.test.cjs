'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  APPROVE_PROVIDER_CONTEXT_DISCLOSURE_CHANNEL,
  BuilderProviderContextDisclosureApprovalIpcError,
  createBuilderProviderContextDisclosureApprovalIpcAdapter,
} = require('../electron/builder-provider-context-disclosure-approval-ipc-adapter.cjs');

const UUID = '123e4567-e89b-42d3-a456-426614174000';
const PROJECT_ID = `builder-project:${UUID}`;
const CONVERSATION_ID = `builder-conversation:${UUID}`;

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
    conversation_id: CONVERSATION_ID,
    ...overrides,
  };
}

function result(overrides = {}) {
  return {
    result_version: 'builder-provider-context-disclosure-current-approval-gate.v1',
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    operation: 'approval_recorded',
    approval_scope: 'configured_provider_purpose',
    provider_scope: 'configured_provider',
    purpose: 'contextual_build',
    authority: {
      current_approval_gate: 'main_owned_current_disclosure_preparation_gate_v1',
      status_service: 'main_only_in_memory_preparation_reader',
      approval_service: 'main_owned_prepared_disclosure_request_approval_v1',
      renderer_authority: 'not_accepted',
      provider_context_body: 'not_present',
      provider_dispatch: false,
      prompt_bridge: false,
      tool_dispatch: false,
      source_read: 'not_performed',
      source_write: 'not_performed',
      git_mutation: false,
      sqlite_write: false,
      revision_admission: 'not_created',
      ipc_registration: 'not_performed',
      preload_exposure: false,
    },
    ...overrides,
  };
}

function adapter(overrides = {}) {
  const authority = windowAuthority();
  const calls = [];
  const value = createBuilderProviderContextDisclosureApprovalIpcAdapter({
    approveCurrentProviderContextDisclosure:
      overrides.approveCurrentProviderContextDisclosure ?? (async (body) => {
        calls.push(body);
        return result();
      }),
    mainWindowRef: authority.mainWindowRef,
  });
  return { authority, calls, value };
}

test('provider context disclosure approval adapter exposes only approve-current channel', async () => {
  const { authority, calls, value } = adapter();
  assert.equal(
    value.adapter_id,
    'builder_provider_context_disclosure_approval.controlled_ipc_adapter.v1',
  );
  assert.equal(value.namespace, 'builderProviderContextDisclosureApproval');
  assert.equal(
    value.preload_namespace,
    'window.clawfabricBuilder.providerContextDisclosureApproval',
  );
  assert.deepEqual(value.exposed_methods, ['approveCurrent']);
  assert.deepEqual(Object.keys(value.channels), ['approveCurrent']);
  assert.equal(
    value.channels.approveCurrent.channel,
    APPROVE_PROVIDER_CONTEXT_DISCLOSURE_CHANNEL,
  );
  assert.equal(value.authority.active_renderer_required, true);
  assert.equal(value.authority.approval_command, true);
  assert.equal(value.authority.permission_fact_readback, false);
  assert.equal(value.authority.request_id_exposed, false);
  assert.equal(value.authority.provider_context_body, false);
  assert.equal(value.authority.provider_dispatch, false);
  assert.equal(value.authority.prompt_bridge, false);
  assert.equal(value.authority.tool_dispatch, false);
  assert.equal(value.authority.source_mutation, false);
  assert.equal(value.authority.git_mutation, false);
  assert.equal(value.authority.revision_admission, false);
  assert.equal(value.authority.direct_electron_registration, false);
  assert.equal(value.authority.direct_preload_exposure, false);

  const approved = await value.channels.approveCurrent.invoke(authority.event, request());
  assert.deepEqual(calls, [request()]);
  assert.deepEqual(approved, result());
  assert.equal(Object.isFrozen(approved), true);
  assert.equal(Object.isFrozen(approved.authority), true);
  assert.doesNotMatch(
    JSON.stringify(approved),
    /permission_id|builder-permission:|builder-provider-context-disclosure-request|builder-context-assembly|sha256:|"provider_context":|source_tree|credential|api[_-]?key/iu,
  );
});

test('approval adapter maps existing approval without exposing permission facts', async () => {
  const { authority, value } = adapter({
    approveCurrentProviderContextDisclosure: async () => result({ operation: 'already_approved' }),
  });

  const approved = await value.channels.approveCurrent.invoke(authority.event, request());
  assert.equal(approved.operation, 'already_approved');
  assert.equal(approved.approval_scope, 'configured_provider_purpose');
  assert.doesNotMatch(JSON.stringify(approved), /permission_id|builder-permission:/u);
});

test('approval adapter rejects inactive senders and malformed payloads before service authority', async () => {
  const { authority, calls, value } = adapter();
  await assert.rejects(
    value.channels.approveCurrent.invoke(Object.freeze({ sender: Object.freeze({}) }), request()),
    (error) => error instanceof BuilderProviderContextDisclosureApprovalIpcError
      && error.code === 'builder_provider_context_disclosure_approval_forbidden'
      && error.stack === `${error.name}: ${error.message}`,
  );
  for (const payload of [
    undefined,
    request({ project_id: 'bad' }),
    request({ conversation_id: 'bad' }),
    request({ resource_id: 'provider:configured/contextual_build' }),
  ]) {
    await assert.rejects(
      value.channels.approveCurrent.invoke(authority.event, payload),
      (error) => error instanceof BuilderProviderContextDisclosureApprovalIpcError
        && error.code === 'builder_provider_context_disclosure_approval_invalid',
    );
  }
  await assert.rejects(
    value.channels.approveCurrent.invoke(authority.event, request(), { extra: true }),
    (error) => error instanceof BuilderProviderContextDisclosureApprovalIpcError
      && error.code === 'builder_provider_context_disclosure_approval_invalid',
  );
  assert.deepEqual(calls, []);
});

test('approval adapter maps service and output failures to fixed redacted errors', async () => {
  const source = new Error('private permission marker');
  source.code = 'builder_provider_context_disclosure_current_approval_unavailable';
  const { authority, value } = adapter({
    approveCurrentProviderContextDisclosure: async () => { throw source; },
  });
  await assert.rejects(
    value.channels.approveCurrent.invoke(authority.event, request()),
    (error) => error instanceof BuilderProviderContextDisclosureApprovalIpcError
      && error.code === 'builder_provider_context_disclosure_approval_unavailable'
      && error.retryable === true
      && !`${error.message}:${error.stack}`.includes('private permission marker'),
  );

  const drift = adapter({
    approveCurrentProviderContextDisclosure: async () => result({
      conversation_id: 'builder-conversation:123e4567-e89b-42d3-a456-426614174099',
    }),
  });
  await assert.rejects(
    drift.value.channels.approveCurrent.invoke(drift.authority.event, request()),
    (error) => error instanceof BuilderProviderContextDisclosureApprovalIpcError
      && error.code === 'builder_provider_context_disclosure_approval_unavailable',
  );

  const leaking = adapter({
    approveCurrentProviderContextDisclosure: async () => result({
      permission_id: `builder-permission:${'a'.repeat(64)}`,
    }),
  });
  await assert.rejects(
    leaking.value.channels.approveCurrent.invoke(leaking.authority.event, request()),
    { code: 'builder_provider_context_disclosure_approval_unavailable' },
  );
});

test('approval adapter fails closed on hostile output without invoking proxy traps', async () => {
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
    approveCurrentProviderContextDisclosure: async () => hostile,
  });
  await assert.rejects(
    value.channels.approveCurrent.invoke(authority.event, request()),
    (error) => error instanceof BuilderProviderContextDisclosureApprovalIpcError
      && error.code === 'builder_provider_context_disclosure_approval_unavailable',
  );
  assert.equal(traps, 0);

  const accessor = adapter({
    approveCurrentProviderContextDisclosure: async () => {
      const output = result();
      Object.defineProperty(output, 'operation', {
        enumerable: true,
        get() { return 'approval_recorded'; },
      });
      return output;
    },
  });
  await assert.rejects(
    accessor.value.channels.approveCurrent.invoke(accessor.authority.event, request()),
    { code: 'builder_provider_context_disclosure_approval_unavailable' },
  );
});

test('approval adapter rejects malformed options without invoking getters or proxy traps', () => {
  let getterCalls = 0;
  const authority = windowAuthority();
  const accessorOptions = {
    approveCurrentProviderContextDisclosure: async () => result(),
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
      approveCurrentProviderContextDisclosure: async () => result(),
      mainWindowRef: authority.mainWindowRef,
      extra: true,
    },
    accessorOptions,
    new Proxy({}, { getPrototypeOf() { throw new Error('private proxy marker'); } }),
  ]) {
    assert.throws(
      () => createBuilderProviderContextDisclosureApprovalIpcAdapter(invalid),
      (error) => error instanceof BuilderProviderContextDisclosureApprovalIpcError
        && error.code === 'builder_provider_context_disclosure_approval_unavailable'
        && !`${error.message}:${error.stack}`.includes('private'),
    );
  }
  assert.equal(getterCalls, 0);
});

test('approval adapter source has no registration, provider, prompt, source, Git, or storage authority', () => {
  const source = fs.readFileSync(
    path.join(
      __dirname,
      '..',
      'electron',
      'builder-provider-context-disclosure-approval-ipc-adapter.cjs',
    ),
    'utf8',
  );
  assert.match(source, /active_renderer_required:\s*true/u);
  assert.match(source, /approval_command:\s*true/u);
  assert.match(source, /permission_fact_readback:\s*false/u);
  assert.match(source, /request_id_exposed:\s*false/u);
  assert.match(source, /provider_context_body:\s*false/u);
  assert.match(source, /provider_dispatch:\s*false/u);
  assert.match(source, /prompt_bridge:\s*false/u);
  assert.match(source, /direct_electron_registration:\s*false/u);
  assert.match(source, /direct_preload_exposure:\s*false/u);
  assert.doesNotMatch(
    source,
    /require\(['"]electron['"]\)|ipcMain|ipcRenderer|contextBridge|BrowserWindow|safeStorage|require\([^)]*builder-provider|builder-git-|node:sqlite|DatabaseSync|fetch\s*\(|https?:|saveDraft|generate|persist_candidate_commit|write_current|local-provider-executor|chat_planner|ChatCreatePage|Canvas|JobMeta/iu,
  );
});
