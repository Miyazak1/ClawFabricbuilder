'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  createBuilderContextAssembly,
} = require('../electron/builder-context-assembler.cjs');
const {
  createBuilderProviderContextProjection,
} = require('../electron/builder-provider-context-projection.cjs');
const {
  createBuilderWorkingContextState,
} = require('../electron/builder-working-context-state.cjs');
const {
  APPROVE_PROVIDER_CONTEXT_DISCLOSURE_CHANNEL,
} = require('../electron/builder-provider-context-disclosure-approval-ipc-adapter.cjs');
const {
  createBuilderProviderContextDisclosureStatusService,
} = require('../electron/builder-provider-context-disclosure-status-service.cjs');
const {
  BUILDER_PROVIDER_CONTEXT_DISCLOSURE_APPROVAL_IPC_RUNTIME_VERSION,
  BuilderProviderContextDisclosureApprovalIpcRuntimeError,
  createBuilderProviderContextDisclosureApprovalIpcRuntime,
} = require('../electron/builder-provider-context-disclosure-approval-ipc-runtime.cjs');

const UUID = '123e4567-e89b-42d3-a456-426614174000';
const PROJECT_ID = `builder-project:${UUID}`;
const CONVERSATION_ID = `builder-conversation:${UUID}`;
const APPROVED_PLAN_REF = Object.freeze({
  plan_result_digest: `sha256:${'a'.repeat(64)}`,
  conversation_head_digest: `sha256:${'b'.repeat(64)}`,
  approved_at_ms: 10,
});
const PERMISSION_ID = `builder-permission:${'d'.repeat(64)}`;

function digest(value) {
  return `sha256:${String(value).padStart(64, '0').slice(0, 64)}`;
}

function fakeIpcMain({ failHandle = null, failRemove = null } = {}) {
  const handlers = new Map();
  const removed = [];
  const authority = {
    handlers,
    removed,
    failRemove,
    handle(channel, handler) {
      if (channel === failHandle || handlers.has(channel)) {
        throw new Error('private registration detail');
      }
      handlers.set(channel, handler);
    },
    removeHandler(channel) {
      if (channel === authority.failRemove) throw new Error('private removal detail');
      removed.push(channel);
      handlers.delete(channel);
    },
  };
  return authority;
}

function fakeWindow() {
  const webContents = Object.freeze({
    isDestroyed: () => false,
  });
  return Object.freeze({
    webContents,
    isDestroyed: () => false,
  });
}

function workingContextState() {
  return createBuilderWorkingContextState({
    project_id: PROJECT_ID,
    session_id: 'builder-session:123e4567-e89b-42d3-a456-426614174001',
    task_address_id: 'builder-task-address:123e4567-e89b-42d3-a456-426614174002',
    conversation_id: CONVERSATION_ID,
    objective_summary: 'Build the private dashboard idea.',
    confirmed_constraints: ['Keep the project local-first'],
    rejected_constraints: ['Do not publish a social feed'],
    open_questions: [],
    latest_user_intent: 'Apply the approved plan.',
    source_refs: [],
    compaction_refs: [],
    handoff_refs: [],
    latest_task_capsule: null,
    approved_plan_ref: APPROVED_PLAN_REF,
    base_revision_ref: null,
    invalidated_by: null,
    updated_at_ms: 10,
  });
}

function assembly() {
  return createBuilderContextAssembly({
    assembly_purpose: 'contextual_build',
    project_id: PROJECT_ID,
    latest_user_message: 'Apply the approved plan.',
    working_context_state: workingContextState(),
    approved_plan_ref: APPROVED_PLAN_REF,
    current_result_ref: null,
    selected_source_summaries: [{
      source_kind: 'project_summary',
      source_digest: digest(1),
      summary: 'Private source summary for dashboard implementation.',
      priority: 10,
    }],
    compaction_summaries: [],
    adopted_handoff_packets: [],
    permission_state: {
      workspace_state: 'bound',
      write_permission: 'ask',
    },
    context_budget: {
      max_segments: 8,
      max_prompt_bytes: 4096,
      reserved_response_bytes: 1024,
    },
    assembled_at_ms: 20,
  });
}

function projection(sourceAssembly) {
  return createBuilderProviderContextProjection({
    context_assembly: sourceAssembly,
    disclosure_decision: {
      decision: 'not_requested',
      approved_by: null,
      approved_at_ms: null,
      provider_scope: null,
      purpose: null,
    },
    projected_at_ms: 30,
  });
}

function recordBlockedStatus(statusService) {
  const sourceAssembly = assembly();
  return statusService.record_current_provider_context_disclosure_status({
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    context_assembly: sourceAssembly,
    provider_context_projection: projection(sourceAssembly),
    recorded_at_ms: 40,
  });
}

function grantResult(request, operation = 'grant_recorded') {
  return {
    result_version: 'builder-permission-grant-result.v1',
    project_id: request.project_id,
    action: request.action,
    resource: {
      resource_kind: request.resource_kind,
      project_id: request.project_id,
      resource_id: request.resource_id,
    },
    operation,
    granted_at_ms: 45,
    permission_id: PERMISSION_ID,
    permission_authority: 'builder_permission_facts_deny_by_default_v1',
    ui_selection_authority: 'main_owned_explicit_user_approval_required',
    preload_exposure: false,
  };
}

function runtimeFixture(overrides = {}) {
  const ipcMain = overrides.ipcMain ?? fakeIpcMain();
  const windowRef = overrides.windowRef ?? fakeWindow();
  const statusService =
    overrides.providerContextDisclosureStatusService
    ?? createBuilderProviderContextDisclosureStatusService();
  const grantCalls = [];
  const runtime = createBuilderProviderContextDisclosureApprovalIpcRuntime({
    ipcMain,
    mainWindowRef: () => windowRef,
    providerContextDisclosureStatusService: statusService,
    grantPermissionForExplicitApproval:
      overrides.grantPermissionForExplicitApproval ?? (async (request) => {
        grantCalls.push(request);
        return grantResult(request, overrides.grantOperation);
      }),
  });
  return { grantCalls, ipcMain, runtime, statusService, windowRef };
}

function assertRuntimeError(operation, code, message = 'AI context approval is unavailable.') {
  assert.throws(
    operation,
    (error) => error instanceof BuilderProviderContextDisclosureApprovalIpcRuntimeError
      && error.code === code
      && error.message === message
      && error.stack === `${error.name}: ${error.message}`
      && !`${error.message}:${error.stack}`.includes('private'),
  );
}

test('registers the fixed provider context disclosure approval channel', () => {
  const { ipcMain, runtime } = runtimeFixture();

  assert.equal(
    BUILDER_PROVIDER_CONTEXT_DISCLOSURE_APPROVAL_IPC_RUNTIME_VERSION,
    'builder-provider-context-disclosure-approval-ipc-runtime.v1',
  );
  assert.equal(runtime.runtime_version, BUILDER_PROVIDER_CONTEXT_DISCLOSURE_APPROVAL_IPC_RUNTIME_VERSION);
  assert.deepEqual(Array.from(runtime.channels), [APPROVE_PROVIDER_CONTEXT_DISCLOSURE_CHANNEL]);
  assert.equal(Object.isFrozen(runtime), true);
  assert.equal(Object.isFrozen(runtime.channels), true);

  assert.equal(runtime.register(), true);
  assert.deepEqual([...ipcMain.handlers.keys()], [APPROVE_PROVIDER_CONTEXT_DISCLOSURE_CHANNEL]);
  assertRuntimeError(
    () => runtime.register(),
    'builder_provider_context_disclosure_approval_ipc_runtime_unavailable',
  );
});

test('approves current provider context disclosure through registered handler and main grant', async () => {
  const { grantCalls, ipcMain, runtime, statusService, windowRef } = runtimeFixture();
  recordBlockedStatus(statusService);
  runtime.register();

  const approved = await ipcMain.handlers.get(APPROVE_PROVIDER_CONTEXT_DISCLOSURE_CHANNEL)(
    Object.freeze({ sender: windowRef.webContents }),
    { project_id: PROJECT_ID, conversation_id: CONVERSATION_ID },
  );

  assert.deepEqual(grantCalls, [{
    project_id: PROJECT_ID,
    action: 'context.disclose',
    resource_kind: 'provider',
    resource_id: 'provider:configured/contextual_build',
  }]);
  assert.deepEqual(approved, {
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
  });
  assert.doesNotMatch(
    JSON.stringify(approved),
    /permission_id|builder-permission:|builder-provider-context-disclosure-request|builder-context-assembly|sha256:|"provider_context":|source_tree|credential|api[_-]?key/iu,
  );
});

test('registered handler fails closed without current preparation or active sender', async () => {
  const { grantCalls, ipcMain, runtime, windowRef } = runtimeFixture();
  runtime.register();
  const handler = ipcMain.handlers.get(APPROVE_PROVIDER_CONTEXT_DISCLOSURE_CHANNEL);

  await assert.rejects(
    handler(Object.freeze({ sender: windowRef.webContents }), {
      project_id: PROJECT_ID,
      conversation_id: CONVERSATION_ID,
    }),
    { code: 'builder_provider_context_disclosure_approval_unavailable' },
  );
  await assert.rejects(
    handler(Object.freeze({ sender: Object.freeze({}) }), {
      project_id: PROJECT_ID,
      conversation_id: CONVERSATION_ID,
    }),
    { code: 'builder_provider_context_disclosure_approval_forbidden' },
  );
  assert.deepEqual(grantCalls, []);
});

test('rolls back partial registration and dispose removes approval handler permanently', () => {
  const registrationFailure = fakeIpcMain({ failHandle: APPROVE_PROVIDER_CONTEXT_DISCLOSURE_CHANNEL });
  const failedRuntime = runtimeFixture({ ipcMain: registrationFailure }).runtime;
  assertRuntimeError(
    () => failedRuntime.register(),
    'builder_provider_context_disclosure_approval_ipc_runtime_unavailable',
  );
  assert.deepEqual([...registrationFailure.handlers.keys()], []);

  const { ipcMain, runtime } = runtimeFixture();
  runtime.register();
  assert.equal(runtime.dispose(), true);
  assert.deepEqual([...ipcMain.handlers.keys()], []);
  assert.deepEqual(ipcMain.removed, [APPROVE_PROVIDER_CONTEXT_DISCLOSURE_CHANNEL]);
  assert.equal(runtime.dispose(), false);
  assertRuntimeError(
    () => runtime.register(),
    'builder_provider_context_disclosure_approval_ipc_runtime_unavailable',
  );
});

test('reports fixed cleanup failure and allows dispose to finish rollback cleanup', () => {
  const ipcMain = fakeIpcMain({ failRemove: APPROVE_PROVIDER_CONTEXT_DISCLOSURE_CHANNEL });
  const runtime = runtimeFixture({ ipcMain }).runtime;
  runtime.register();

  assertRuntimeError(
    () => runtime.dispose(),
    'builder_provider_context_disclosure_approval_ipc_runtime_cleanup_required',
    'AI context approval cleanup is required.',
  );
  assert.deepEqual([...ipcMain.handlers.keys()], [APPROVE_PROVIDER_CONTEXT_DISCLOSURE_CHANNEL]);
  ipcMain.failRemove = null;
  assert.equal(runtime.dispose(), true);
  assert.deepEqual([...ipcMain.handlers.keys()], []);
});

test('rejects proxy, accessor, symbol, extra, and unstable runtime options without traps', () => {
  const ipcMain = fakeIpcMain();
  const statusService = createBuilderProviderContextDisclosureStatusService();
  const mainWindowRef = () => fakeWindow();
  const grantPermissionForExplicitApproval = async (request) => grantResult(request);
  let trapCalls = 0;
  const proxiedOptions = new Proxy({}, {
    getPrototypeOf() {
      trapCalls += 1;
      throw new Error('private proxy trap');
    },
  });
  const symbol = Symbol('private');
  for (const invalid of [
    null,
    {},
    { ipcMain, mainWindowRef, providerContextDisclosureStatusService: statusService },
    {
      ipcMain,
      mainWindowRef,
      providerContextDisclosureStatusService: statusService,
      grantPermissionForExplicitApproval,
      extra: true,
    },
    {
      ipcMain,
      mainWindowRef,
      providerContextDisclosureStatusService: statusService,
      grantPermissionForExplicitApproval,
      [symbol]: true,
    },
    proxiedOptions,
    {
      ipcMain,
      mainWindowRef,
      providerContextDisclosureStatusService: { ...statusService, service_version: 'wrong' },
      grantPermissionForExplicitApproval,
    },
  ]) {
    assertRuntimeError(
      () => createBuilderProviderContextDisclosureApprovalIpcRuntime(invalid),
      'builder_provider_context_disclosure_approval_ipc_runtime_unavailable',
    );
  }
  assert.equal(trapCalls, 0);

  let getterCalls = 0;
  const accessorOptions = { ipcMain, mainWindowRef, grantPermissionForExplicitApproval };
  Object.defineProperty(accessorOptions, 'providerContextDisclosureStatusService', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return statusService;
    },
  });
  assertRuntimeError(
    () => createBuilderProviderContextDisclosureApprovalIpcRuntime(accessorOptions),
    'builder_provider_context_disclosure_approval_ipc_runtime_unavailable',
  );
  assert.equal(getterCalls, 0);

  let applyTrapCalls = 0;
  const proxiedFunction = new Proxy(function authority() {}, {
    apply() {
      applyTrapCalls += 1;
      throw new Error('private apply trap');
    },
  });
  for (const invalid of [
    {
      ipcMain: { handle: proxiedFunction, removeHandler() {} },
      mainWindowRef,
      providerContextDisclosureStatusService: statusService,
      grantPermissionForExplicitApproval,
    },
    {
      ipcMain,
      mainWindowRef: proxiedFunction,
      providerContextDisclosureStatusService: statusService,
      grantPermissionForExplicitApproval,
    },
    {
      ipcMain,
      mainWindowRef,
      providerContextDisclosureStatusService: statusService,
      grantPermissionForExplicitApproval: proxiedFunction,
    },
  ]) {
    assertRuntimeError(
      () => createBuilderProviderContextDisclosureApprovalIpcRuntime(invalid),
      'builder_provider_context_disclosure_approval_ipc_runtime_unavailable',
    );
  }
  assert.equal(applyTrapCalls, 0);
});

test('runtime source has no provider dispatch, prompt, source, Git, storage, preload, or main wiring authority', () => {
  const source = fs.readFileSync(
    path.join(
      __dirname,
      '..',
      'electron',
      'builder-provider-context-disclosure-approval-ipc-runtime.cjs',
    ),
    'utf8',
  );
  assert.match(source, /APPROVE_PROVIDER_CONTEXT_DISCLOSURE_CHANNEL/u);
  assert.match(source, /createBuilderProviderContextDisclosureApprovalService/u);
  assert.match(source, /createBuilderProviderContextDisclosureCurrentApprovalGate/u);
  assert.match(source, /createBuilderProviderContextDisclosureApprovalIpcAdapter/u);
  assert.doesNotMatch(
    source,
    /require\(['"]electron['"]\)|ipcRenderer|contextBridge|BrowserWindow|safeStorage|node:sqlite|DatabaseSync|builder-git-|fetch\s*\(|https?:|saveDraft|generate|persist_candidate_commit|write_current|local-provider-executor|chat_planner|ChatCreatePage|Canvas|JobMeta|main\.cjs|preload\.cjs/iu,
  );
});
