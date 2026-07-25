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
  BUILDER_TOOL_PERMISSION_ADMISSION_VERSION,
  BuilderToolPermissionAdmissionError,
  createBuilderToolPermissionAdmission,
} = require('../electron/builder-tool-permission-admission.cjs');

const PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174000';
const ACTOR_ID = 'builder-user:123e4567-e89b-42d3-a456-426614174001';
const TOOL_CALL_ID = 'builder-tool-call:123e4567-e89b-42d3-a456-426614174002';
const PERMISSION_ID = `builder-permission:${'a'.repeat(64)}`;

function request(overrides = {}) {
  return {
    tool_call_id: TOOL_CALL_ID,
    tool_name: 'filesystem.read',
    project_id: PROJECT_ID,
    action: 'filesystem.read',
    resource: {
      resource_kind: 'filesystem',
      project_id: PROJECT_ID,
      resource_id: 'project:/src/app.tsx',
    },
    ...overrides,
  };
}

function decision(overrides = {}) {
  return {
    decision_version: BUILDER_PERMISSION_DECISION_VERSION,
    policy_version: BUILDER_PERMISSION_POLICY_VERSION,
    actor_id: ACTOR_ID,
    action: 'filesystem.read',
    resource: {
      resource_kind: 'filesystem',
      project_id: PROJECT_ID,
      resource_id: 'project:/src/app.tsx',
    },
    evaluated_at_ms: 50,
    decision: 'allowed',
    reason: 'matching_active_grant',
    permission_id: PERMISSION_ID,
    permission_authority: 'builder_permission_facts_deny_by_default_v1',
    ui_selection_authority: 'not_permission',
    ...overrides,
  };
}

function admission(overrides = {}) {
  const calls = [];
  const guard = createBuilderToolPermissionAdmission({
    actor_id: ACTOR_ID,
    now_ms: () => 50,
    evaluate_permission: async (body) => {
      calls.push(body);
      return decision(overrides.decision ?? {});
    },
  });
  return { calls, guard };
}

test('admits a tool call only after a main-bound permission decision allows it', async () => {
  const { calls, guard } = admission();
  assert.equal(guard.admission_version, BUILDER_TOOL_PERMISSION_ADMISSION_VERSION);
  assert.equal(guard.authority.actor_authority, 'main_bound_actor_id');
  assert.equal(guard.authority.permission_authority, 'main_owned_permission_facts');
  assert.equal(guard.authority.renderer_authority, 'not_present');
  assert.equal(guard.authority.ui_selection_authority, 'not_permission');
  assert.equal(guard.authority.tool_dispatch, 'not_performed');
  assert.equal(guard.authority.grant_command, false);
  assert.equal(guard.authority.revoke_command, false);

  const result = await guard.admit(request());
  assert.deepEqual(calls, [{
    policy_version: BUILDER_PERMISSION_POLICY_VERSION,
    actor_id: ACTOR_ID,
    action: 'filesystem.read',
    resource: {
      resource_kind: 'filesystem',
      project_id: PROJECT_ID,
      resource_id: 'project:/src/app.tsx',
    },
    now_ms: 50,
  }]);
  assert.deepEqual(result, {
    admission_version: BUILDER_TOOL_PERMISSION_ADMISSION_VERSION,
    tool_call_id: TOOL_CALL_ID,
    tool_name: 'filesystem.read',
    actor_id: ACTOR_ID,
    project_id: PROJECT_ID,
    action: 'filesystem.read',
    resource: {
      resource_kind: 'filesystem',
      project_id: PROJECT_ID,
      resource_id: 'project:/src/app.tsx',
    },
    evaluated_at_ms: 50,
    permission_decision: 'allowed',
    permission_id: PERMISSION_ID,
    permission_authority: 'builder_permission_facts_deny_by_default_v1',
    ui_selection_authority: 'not_permission',
    execution_admission: 'permission_allowed_dispatch_not_performed',
    admission_authority: 'main_permission_decision_before_tool_dispatch_v1',
    evidence_digest: result.evidence_digest,
  });
  assert.match(result.evidence_digest, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.resource), true);
  assert.equal(Object.hasOwn(result, 'grants'), false);
  assert.equal(Object.hasOwn(result, 'revocations'), false);
  assert.equal(Object.hasOwn(result, 'provider'), false);
});

test('denies without fabricating an allowed admission or leaking permission facts', async () => {
  const { guard } = admission({
    decision: {
      decision: 'denied',
      reason: 'no_matching_active_grant',
      permission_id: null,
    },
  });
  await assert.rejects(
    guard.admit(request()),
    (error) => error instanceof BuilderToolPermissionAdmissionError
      && error.code === 'builder_tool_permission_admission_denied'
      && error.retryable === false
      && !`${error.message}:${error.stack}`.includes(PERMISSION_ID),
  );
});

test('rejects malformed tool requests before evaluating permissions', async () => {
  const { calls, guard } = admission();
  for (const invalid of [
    null,
    { ...request(), tool_call_id: 'bad' },
    { ...request(), tool_name: 'Filesystem Read' },
    { ...request(), action: 'filesystem.read', resource: { ...request().resource, resource_kind: 'project' } },
    { ...request(), project_id: 'builder-project:123e4567-e89b-42d3-a456-426614174099' },
    { ...request(), actor_id: ACTOR_ID },
    { ...request(), resource: { ...request().resource, resource_id: ' project:/src/app.tsx ' } },
  ]) {
    await assert.rejects(
      guard.admit(invalid),
      (error) => error instanceof BuilderToolPermissionAdmissionError
        && error.code === 'builder_tool_permission_admission_invalid',
    );
  }
  assert.deepEqual(calls, []);
});

test('fails closed on hostile or drifted permission decisions', async () => {
  let getterCalls = 0;
  const accessor = createBuilderToolPermissionAdmission({
    actor_id: ACTOR_ID,
    now_ms: () => 50,
    evaluate_permission: async () => Object.defineProperty(decision(), 'permission_id', {
      enumerable: true,
      get() {
        getterCalls += 1;
        return PERMISSION_ID;
      },
    }),
  });
  await assert.rejects(accessor.admit(request()), {
    code: 'builder_tool_permission_admission_unavailable',
  });
  assert.equal(getterCalls, 0);

  for (const drift of [
    { actor_id: 'builder-user:123e4567-e89b-42d3-a456-426614174099' },
    { evaluated_at_ms: 51 },
    { resource: { ...request().resource, resource_id: 'project:/src/other.tsx' } },
    { permission_authority: 'renderer_supplied_facts' },
    { ui_selection_authority: 'button_click' },
  ]) {
    const { guard } = admission({ decision: drift });
    await assert.rejects(guard.admit(request()), {
      code: 'builder_tool_permission_admission_unavailable',
    });
  }
});

test('rejects malformed admission authority without invoking getters or proxy traps', () => {
  let getterCalls = 0;
  const accessor = {
    actor_id: ACTOR_ID,
    evaluate_permission: async () => decision(),
  };
  Object.defineProperty(accessor, 'now_ms', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return () => 50;
    },
  });
  for (const invalid of [
    null,
    {},
    { actor_id: ACTOR_ID, now_ms: () => 50, evaluate_permission: async () => decision(), extra: true },
    { actor_id: 'bad', now_ms: () => 50, evaluate_permission: async () => decision() },
    accessor,
    new Proxy({}, { getPrototypeOf() { throw new Error('private proxy marker'); } }),
  ]) {
    assert.throws(
      () => createBuilderToolPermissionAdmission(invalid),
      (error) => error instanceof BuilderToolPermissionAdmissionError
        && error.code === 'builder_tool_permission_admission_unavailable'
        && !`${error.message}:${error.stack}`.includes('private'),
    );
  }
  assert.equal(getterCalls, 0);
});

test('source remains a pure permission gate with no renderer, provider, Git, IPC, or tool dispatch authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-tool-permission-admission.cjs'),
    'utf8',
  );
  assert.match(source, /main_permission_decision_before_tool_dispatch_v1/u);
  assert.match(source, /tool_dispatch:\s*'not_performed'/u);
  assert.match(source, /execution_admission:\s*'permission_allowed_dispatch_not_performed'/u);
  assert.match(source, /grant_command:\s*false/u);
  assert.match(source, /revoke_command:\s*false/u);
  assert.doesNotMatch(
    source,
    /require\(['"]electron['"]\)|ipcMain|ipcRenderer|contextBridge|BrowserWindow|require\(['"][^'"]*preload[^'"]*['"]\)|safeStorage|builder-provider|builder-git|builder-project-main-authority|fetch\s*\(|https?:|Authorization|Bearer|child_process|execFile|spawn\s*\(|eval\s*\(|new Function|shell:\s*true|record_grant|record_revocation|local-provider-executor|ChatCreatePage|Canvas|JobMeta/iu,
  );
});
