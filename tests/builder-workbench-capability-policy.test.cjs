'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const {
  BUILDER_WORKBENCH_CAPABILITY_POLICY_VERSION,
  BuilderWorkbenchCapabilityPolicyError,
  authorityForBuilderWorkbenchCapabilityPolicy,
  createBuilderWorkbenchControlPlanePolicy,
  sanitizeBuilderWorkbenchCapabilityPolicy,
} = require('../electron/builder-workbench-capability-policy.cjs');
const {
  createBuilderWorkbenchIpcAdapter,
} = require('../electron/builder-workbench-ipc-adapter.cjs');

const AGENT_ID = 'builder-agent:123e4567-e89b-42d3-a456-426614174000';

function adapterFixture() {
  const sender = {};
  const adapter = createBuilderWorkbenchIpcAdapter({
    readWorkbench(request) {
      return {
        projection_version: 'builder-agent-workbench-projection.v2',
        agent_id: request.agent_id,
        stream: { items: [], after_cursor: null, next_cursor: null, has_more: false },
        task_monitor: {
          projection_version: 'builder-workbench-task-monitor.v2',
          agent_id: request.agent_id,
          tasks: [],
          counts: { active: 0, attention: 0, recent: 0 },
          authority: {},
        },
        inbox: { unread_count: 0, action_required_count: 0, mention_count: 0, active_task_count: 0 },
        authority: {},
      };
    },
    updateMessageState() { return { operation: 'message_state_updated' }; },
    createTaskProposal() { return { operation: 'proposal_created' }; },
    decideTaskProposal() { return { operation: 'task_materialized' }; },
    controlTask() { return { operation: 'cancel_requested' }; },
    mainWindowRef() {
      return { webContents: sender, isDestroyed: () => false };
    },
  });
  return { adapter, sender };
}

test('Workbench capability policy models a control plane without execution-plane authority', () => {
  const policy = createBuilderWorkbenchControlPlanePolicy();

  assert.equal(
    BUILDER_WORKBENCH_CAPABILITY_POLICY_VERSION,
    'builder-workbench-capability-policy.v1',
  );
  assert.deepEqual(policy, {
    policy_version: 'builder-workbench-capability-policy.v1',
    plane: 'workbench_control_plane',
    message_read: 'bounded_projection',
    message_state_update: 'user_state_only',
    message_record_write: 'workbench_message_store_only',
    task_proposal: 'review_required',
    task_decision: 'approve_existing_project_or_reject',
    task_control: 'cancel_only',
    plugin_messages: 'normalized_message_envelopes_only',
    plugin_actions: 'declared_review_required_only',
    context_capsules: 'bounded_reviewed_refs_only',
    browser_session_access: 'not_performed',
    browser_preview_control: 'not_performed',
    command_execution: 'not_performed',
    provider_dispatch: false,
    tool_dispatch: false,
    permission_grant: false,
    source_read: false,
    source_write: false,
    git_mutation: false,
    project_sqlite_write: false,
    approval_authority: 'proposal_review_only_not_execution_permission',
  });
  assert.equal(Object.isFrozen(policy), true);
});

test('Workbench authority projection stays separate from command, Browser, provider, and project storage', () => {
  const authority = authorityForBuilderWorkbenchCapabilityPolicy(
    createBuilderWorkbenchControlPlanePolicy(),
  );

  assert.deepEqual(authority, {
    workbench_policy_version: 'builder-workbench-capability-policy.v1',
    renderer_authority: 'selection_and_bounded_state_requests_only',
    main_owned_message_authority: true,
    active_renderer_required: true,
    message_record_write: 'workbench_message_store_only',
    task_proposal: 'review_required',
    task_decision: 'approve_existing_project_or_reject',
    task_control: 'cancel_only',
    plugin_payload_exposure: false,
    plugin_action_authority: 'declared_review_required_only',
    browser_session_access: 'not_performed',
    browser_preview_control: 'not_performed',
    provider_dispatch: false,
    tool_dispatch: false,
    command_execution: 'not_performed',
    permission_grant: false,
    source_read: false,
    source_write: false,
    git_mutation: false,
    project_sqlite_write: false,
    direct_electron_registration: false,
    direct_preload_exposure: false,
  });
});

test('Workbench policy fails closed when command or Browser authority is smuggled in', () => {
  for (const unsafe of [
    { ...createBuilderWorkbenchControlPlanePolicy(), command_execution: 'allowed' },
    { ...createBuilderWorkbenchControlPlanePolicy(), browser_session_access: 'allowed' },
    { ...createBuilderWorkbenchControlPlanePolicy(), provider_dispatch: true },
    { ...createBuilderWorkbenchControlPlanePolicy(), source_write: true },
  ]) {
    assert.throws(
      () => sanitizeBuilderWorkbenchCapabilityPolicy(unsafe),
      (error) => error instanceof BuilderWorkbenchCapabilityPolicyError
        && error.code === 'builder_workbench_capability_policy_invalid'
        && !`${error.message}:${error.stack}`.includes('allowed'),
    );
  }
});

test('Workbench IPC adapter exposes policy-derived authority', async () => {
  const { adapter, sender } = adapterFixture();

  assert.equal(adapter.authority.workbench_policy_version, 'builder-workbench-capability-policy.v1');
  assert.equal(adapter.authority.message_record_write, 'workbench_message_store_only');
  assert.equal(adapter.authority.task_proposal, 'review_required');
  assert.equal(adapter.authority.task_control, 'cancel_only');
  assert.equal(adapter.authority.browser_session_access, 'not_performed');
  assert.equal(adapter.authority.browser_preview_control, 'not_performed');
  assert.equal(adapter.authority.command_execution, 'not_performed');
  assert.equal(adapter.authority.provider_dispatch, false);
  assert.equal(adapter.authority.tool_dispatch, false);
  assert.equal(adapter.authority.source_write, false);
  assert.deepEqual(await adapter.channels.read.invoke({ sender }, {
    agent_id: AGENT_ID,
    after_cursor: null,
    limit: 10,
  }), {
    projection_version: 'builder-agent-workbench-projection.v2',
    agent_id: AGENT_ID,
    stream: { items: [], after_cursor: null, next_cursor: null, has_more: false },
    task_monitor: {
      projection_version: 'builder-workbench-task-monitor.v2',
      agent_id: AGENT_ID,
      tasks: [],
      counts: { active: 0, attention: 0, recent: 0 },
      authority: {},
    },
    inbox: { unread_count: 0, action_required_count: 0, mention_count: 0, active_task_count: 0 },
    authority: {},
  });
});

test('Workbench capability policy source has no Electron, subprocess, Browser, provider, or project mutation authority', () => {
  const source = fs.readFileSync('electron/builder-workbench-capability-policy.cjs', 'utf8');

  assert.doesNotMatch(
    source,
    /require\(['"]electron['"]\)|ipcMain|ipcRenderer|contextBridge|BrowserWindow|WebContentsView|safeStorage|child_process|spawn\s*\(|execFile|fetch\s*\(|https?:|node:sqlite|better-sqlite|writeFile|appendFile|mkdir|rm\(|unlink|provider_secret|credential|saveDraft|record_project_revision/iu,
  );
});
