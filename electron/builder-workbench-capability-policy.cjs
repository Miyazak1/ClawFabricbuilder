'use strict';

const { types: utilTypes } = require('node:util');

const BUILDER_WORKBENCH_CAPABILITY_POLICY_VERSION = 'builder-workbench-capability-policy.v1';

const POLICY_KEYS = Object.freeze([
  'policy_version',
  'plane',
  'message_read',
  'message_state_update',
  'message_record_write',
  'task_proposal',
  'task_decision',
  'task_control',
  'plugin_messages',
  'plugin_actions',
  'context_capsules',
  'browser_session_access',
  'browser_preview_control',
  'command_execution',
  'provider_dispatch',
  'tool_dispatch',
  'permission_grant',
  'source_read',
  'source_write',
  'git_mutation',
  'project_sqlite_write',
  'approval_authority',
]);

const AUTHORITY_KEYS = Object.freeze([
  'workbench_policy_version',
  'renderer_authority',
  'main_owned_message_authority',
  'active_renderer_required',
  'message_record_write',
  'task_proposal',
  'task_decision',
  'task_control',
  'plugin_payload_exposure',
  'plugin_action_authority',
  'browser_session_access',
  'browser_preview_control',
  'provider_dispatch',
  'tool_dispatch',
  'command_execution',
  'permission_grant',
  'source_read',
  'source_write',
  'git_mutation',
  'project_sqlite_write',
  'direct_electron_registration',
  'direct_preload_exposure',
]);

const WORKBENCH_CONTROL_PLANE_POLICY = Object.freeze({
  policy_version: BUILDER_WORKBENCH_CAPABILITY_POLICY_VERSION,
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

class BuilderWorkbenchCapabilityPolicyError extends Error {
  constructor() {
    super('Builder Workbench capability policy is unavailable.');
    this.name = 'BuilderWorkbenchCapabilityPolicyError';
    this.code = 'builder_workbench_capability_policy_invalid';
    this.retryable = false;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderWorkbenchCapabilityPolicyError();
}

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freezeDeep(nested);
    Object.freeze(value);
  }
  return value;
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
  const own = Reflect.ownKeys(value);
  if (
    own.length !== keys.length
    || own.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) fail();
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  }
}

function sanitizeBuilderWorkbenchCapabilityPolicy(rawPolicy) {
  exactObject(rawPolicy, POLICY_KEYS);
  const policy = Object.fromEntries(POLICY_KEYS.map((key) => [key, rawPolicy[key]]));
  if (policy.policy_version !== BUILDER_WORKBENCH_CAPABILITY_POLICY_VERSION) fail();
  if (policy.plane !== 'workbench_control_plane') fail();
  if (policy.message_read !== 'bounded_projection') fail();
  if (policy.message_state_update !== 'user_state_only') fail();
  if (policy.message_record_write !== 'workbench_message_store_only') fail();
  if (policy.task_proposal !== 'review_required') fail();
  if (policy.task_decision !== 'approve_existing_project_or_reject') fail();
  if (policy.task_control !== 'cancel_only') fail();
  if (policy.plugin_messages !== 'normalized_message_envelopes_only') fail();
  if (policy.plugin_actions !== 'declared_review_required_only') fail();
  if (policy.context_capsules !== 'bounded_reviewed_refs_only') fail();
  if (policy.browser_session_access !== 'not_performed') fail();
  if (policy.browser_preview_control !== 'not_performed') fail();
  if (policy.command_execution !== 'not_performed') fail();
  if (policy.provider_dispatch !== false) fail();
  if (policy.tool_dispatch !== false) fail();
  if (policy.permission_grant !== false) fail();
  if (policy.source_read !== false) fail();
  if (policy.source_write !== false) fail();
  if (policy.git_mutation !== false) fail();
  if (policy.project_sqlite_write !== false) fail();
  if (policy.approval_authority !== 'proposal_review_only_not_execution_permission') fail();
  return freezeDeep(policy);
}

function createBuilderWorkbenchControlPlanePolicy() {
  return sanitizeBuilderWorkbenchCapabilityPolicy(WORKBENCH_CONTROL_PLANE_POLICY);
}

function authorityForBuilderWorkbenchCapabilityPolicy(rawPolicy) {
  const policy = sanitizeBuilderWorkbenchCapabilityPolicy(rawPolicy);
  const authority = {
    workbench_policy_version: policy.policy_version,
    renderer_authority: 'selection_and_bounded_state_requests_only',
    main_owned_message_authority: true,
    active_renderer_required: true,
    message_record_write: policy.message_record_write,
    task_proposal: policy.task_proposal,
    task_decision: policy.task_decision,
    task_control: policy.task_control,
    plugin_payload_exposure: false,
    plugin_action_authority: policy.plugin_actions,
    browser_session_access: policy.browser_session_access,
    browser_preview_control: policy.browser_preview_control,
    provider_dispatch: policy.provider_dispatch,
    tool_dispatch: policy.tool_dispatch,
    command_execution: policy.command_execution,
    permission_grant: policy.permission_grant,
    source_read: policy.source_read,
    source_write: policy.source_write,
    git_mutation: policy.git_mutation,
    project_sqlite_write: policy.project_sqlite_write,
    direct_electron_registration: false,
    direct_preload_exposure: false,
  };
  exactObject(authority, AUTHORITY_KEYS);
  return freezeDeep(authority);
}

module.exports = Object.freeze({
  BUILDER_WORKBENCH_CAPABILITY_POLICY_VERSION,
  BuilderWorkbenchCapabilityPolicyError,
  authorityForBuilderWorkbenchCapabilityPolicy,
  createBuilderWorkbenchControlPlanePolicy,
  sanitizeBuilderWorkbenchCapabilityPolicy,
});
