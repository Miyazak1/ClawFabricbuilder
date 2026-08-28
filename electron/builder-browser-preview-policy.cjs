'use strict';

const { types: utilTypes } = require('node:util');

const BUILDER_BROWSER_PREVIEW_POLICY_VERSION = 'builder-browser-preview-policy.v1';

const POLICY_KEYS = Object.freeze([
  'policy_version',
  'profile_kind',
  'session_persistence',
  'allowed_origin',
  'navigation',
  'network_access',
  'downloads',
  'new_windows',
  'permissions',
  'node_integration',
  'context_isolation',
  'electron_sandbox',
  'web_security',
  'webview_tag',
  'preload_script',
  'devtools',
  'renderer_ipc',
  'command_execution',
  'file_write',
  'source_write',
  'git_mutation',
  'sqlite_write',
  'provider_dispatch',
  'tool_dispatch',
  'approval_authority',
]);

const WEB_PREFERENCE_KEYS = Object.freeze([
  'nodeIntegration',
  'contextIsolation',
  'sandbox',
  'webSecurity',
  'devTools',
  'webviewTag',
  'allowRunningInsecureContent',
  'partition',
]);

const AUTHORITY_KEYS = Object.freeze([
  'browser_policy_version',
  'live_preview_authority',
  'electron_view_creation',
  'renderer_authority',
  'ipc_authority',
  'provider_dispatch',
  'tool_dispatch',
  'command_execution',
  'source_write',
  'git_mutation',
  'sqlite_write',
  'permission_grant',
  'external_navigation',
  'network_access',
  'node_integration',
  'context_isolation',
  'sandbox',
  'preload_script',
  'downloads',
  'new_windows',
  'session_persistence',
]);

const PROJECT_LIVE_PREVIEW_POLICY = Object.freeze({
  policy_version: BUILDER_BROWSER_PREVIEW_POLICY_VERSION,
  profile_kind: 'project_live_preview',
  session_persistence: 'non_persistent',
  allowed_origin: 'admitted_loopback_preview_origin',
  navigation: 'admitted_preview_origin_only',
  network_access: 'admitted_preview_origin_only',
  downloads: 'blocked',
  new_windows: 'blocked',
  permissions: 'blocked',
  node_integration: 'disabled',
  context_isolation: 'enabled',
  electron_sandbox: 'enabled',
  web_security: 'enabled',
  webview_tag: 'disabled',
  preload_script: 'not_configured',
  devtools: 'disabled_by_default',
  renderer_ipc: false,
  command_execution: 'not_performed',
  file_write: 'not_performed',
  source_write: 'not_performed',
  git_mutation: 'not_performed',
  sqlite_write: 'not_performed',
  provider_dispatch: false,
  tool_dispatch: false,
  approval_authority: 'preview_policy_only_not_command_approval',
});

class BuilderBrowserPreviewPolicyError extends Error {
  constructor() {
    super('Builder browser preview policy is unavailable.');
    this.name = 'BuilderBrowserPreviewPolicyError';
    this.code = 'builder_browser_preview_policy_invalid';
    this.retryable = false;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderBrowserPreviewPolicyError();
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

function sanitizeBuilderBrowserPreviewPolicy(rawPolicy) {
  exactObject(rawPolicy, POLICY_KEYS);
  const policy = Object.fromEntries(POLICY_KEYS.map((key) => [key, rawPolicy[key]]));
  if (policy.policy_version !== BUILDER_BROWSER_PREVIEW_POLICY_VERSION) fail();
  if (policy.profile_kind !== 'project_live_preview') fail();
  if (policy.session_persistence !== 'non_persistent') fail();
  if (policy.allowed_origin !== 'admitted_loopback_preview_origin') fail();
  if (policy.navigation !== 'admitted_preview_origin_only') fail();
  if (policy.network_access !== 'admitted_preview_origin_only') fail();
  if (policy.downloads !== 'blocked') fail();
  if (policy.new_windows !== 'blocked') fail();
  if (policy.permissions !== 'blocked') fail();
  if (policy.node_integration !== 'disabled') fail();
  if (policy.context_isolation !== 'enabled') fail();
  if (policy.electron_sandbox !== 'enabled') fail();
  if (policy.web_security !== 'enabled') fail();
  if (policy.webview_tag !== 'disabled') fail();
  if (policy.preload_script !== 'not_configured') fail();
  if (policy.devtools !== 'disabled_by_default') fail();
  if (policy.renderer_ipc !== false) fail();
  if (policy.command_execution !== 'not_performed') fail();
  if (policy.file_write !== 'not_performed') fail();
  if (policy.source_write !== 'not_performed') fail();
  if (policy.git_mutation !== 'not_performed') fail();
  if (policy.sqlite_write !== 'not_performed') fail();
  if (policy.provider_dispatch !== false) fail();
  if (policy.tool_dispatch !== false) fail();
  if (policy.approval_authority !== 'preview_policy_only_not_command_approval') fail();
  return freezeDeep(policy);
}

function createBuilderProjectLivePreviewBrowserPolicy() {
  return sanitizeBuilderBrowserPreviewPolicy(PROJECT_LIVE_PREVIEW_POLICY);
}

function webPreferencesForBuilderBrowserPreviewPolicy(rawPolicy, partition) {
  const policy = sanitizeBuilderBrowserPreviewPolicy(rawPolicy);
  if (typeof partition !== 'string' || partition.length < 1 || partition.startsWith('persist:')) fail();
  const preferences = {
    nodeIntegration: policy.node_integration !== 'disabled',
    contextIsolation: policy.context_isolation === 'enabled',
    sandbox: policy.electron_sandbox === 'enabled',
    webSecurity: policy.web_security === 'enabled',
    devTools: false,
    webviewTag: false,
    allowRunningInsecureContent: false,
    partition,
  };
  exactObject(preferences, WEB_PREFERENCE_KEYS);
  return freezeDeep(preferences);
}

function authorityForBuilderBrowserPreviewPolicy(rawPolicy) {
  const policy = sanitizeBuilderBrowserPreviewPolicy(rawPolicy);
  const authority = {
    browser_policy_version: policy.policy_version,
    live_preview_authority: 'main_webcontents_view_runtime_v1',
    electron_view_creation: 'performed_by_preview_runtime',
    renderer_authority: 'not_present',
    ipc_authority: 'not_present',
    provider_dispatch: 'not_performed',
    tool_dispatch: 'not_performed',
    command_execution: policy.command_execution,
    source_write: 'not_present',
    git_mutation: policy.git_mutation,
    sqlite_write: policy.sqlite_write,
    permission_grant: 'not_performed',
    external_navigation: 'blocked',
    network_access: policy.network_access,
    node_integration: policy.node_integration,
    context_isolation: policy.context_isolation,
    sandbox: policy.electron_sandbox,
    preload_script: policy.preload_script,
    downloads: policy.downloads,
    new_windows: policy.new_windows,
    session_persistence: policy.session_persistence,
  };
  exactObject(authority, AUTHORITY_KEYS);
  return freezeDeep(authority);
}

module.exports = Object.freeze({
  BUILDER_BROWSER_PREVIEW_POLICY_VERSION,
  BuilderBrowserPreviewPolicyError,
  authorityForBuilderBrowserPreviewPolicy,
  createBuilderProjectLivePreviewBrowserPolicy,
  sanitizeBuilderBrowserPreviewPolicy,
  webPreferencesForBuilderBrowserPreviewPolicy,
});
