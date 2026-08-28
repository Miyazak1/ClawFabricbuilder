'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const {
  BUILDER_BROWSER_PREVIEW_POLICY_VERSION,
  BuilderBrowserPreviewPolicyError,
  authorityForBuilderBrowserPreviewPolicy,
  createBuilderProjectLivePreviewBrowserPolicy,
  sanitizeBuilderBrowserPreviewPolicy,
  webPreferencesForBuilderBrowserPreviewPolicy,
} = require('../electron/builder-browser-preview-policy.cjs');

test('project live preview browser policy is separate from command sandbox authority', () => {
  const policy = createBuilderProjectLivePreviewBrowserPolicy();

  assert.equal(BUILDER_BROWSER_PREVIEW_POLICY_VERSION, 'builder-browser-preview-policy.v1');
  assert.deepEqual(policy, {
    policy_version: 'builder-browser-preview-policy.v1',
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
  assert.equal(Object.isFrozen(policy), true);
});

test('browser preview policy creates safe WebContents preferences without persistent sessions', () => {
  const policy = createBuilderProjectLivePreviewBrowserPolicy();

  assert.deepEqual(webPreferencesForBuilderBrowserPreviewPolicy(policy, 'builder-live-preview-123'), {
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
    devTools: false,
    webviewTag: false,
    allowRunningInsecureContent: false,
    partition: 'builder-live-preview-123',
  });
  assert.throws(
    () => webPreferencesForBuilderBrowserPreviewPolicy(policy, 'persist:builder-live-preview-123'),
    (error) => error instanceof BuilderBrowserPreviewPolicyError
      && error.code === 'builder_browser_preview_policy_invalid'
      && !`${error.message}:${error.stack}`.includes('persist:builder-live-preview-123'),
  );
});

test('browser preview authority reports no command, provider, file, git, or sqlite authority', () => {
  const authority = authorityForBuilderBrowserPreviewPolicy(createBuilderProjectLivePreviewBrowserPolicy());

  assert.deepEqual(authority, {
    browser_policy_version: 'builder-browser-preview-policy.v1',
    live_preview_authority: 'main_webcontents_view_runtime_v1',
    electron_view_creation: 'performed_by_preview_runtime',
    renderer_authority: 'not_present',
    ipc_authority: 'not_present',
    provider_dispatch: 'not_performed',
    tool_dispatch: 'not_performed',
    command_execution: 'not_performed',
    source_write: 'not_present',
    git_mutation: 'not_performed',
    sqlite_write: 'not_performed',
    permission_grant: 'not_performed',
    external_navigation: 'blocked',
    network_access: 'admitted_preview_origin_only',
    node_integration: 'disabled',
    context_isolation: 'enabled',
    sandbox: 'enabled',
    preload_script: 'not_configured',
    downloads: 'blocked',
    new_windows: 'blocked',
    session_persistence: 'non_persistent',
  });
});

test('browser preview policy fails closed if a caller tries to smuggle command authority', () => {
  const unsafe = {
    ...createBuilderProjectLivePreviewBrowserPolicy(),
    command_execution: 'allowed',
  };

  assert.throws(
    () => sanitizeBuilderBrowserPreviewPolicy(unsafe),
    (error) => error instanceof BuilderBrowserPreviewPolicyError
      && error.message === 'Builder browser preview policy is unavailable.'
      && !`${error.message}:${error.stack}`.includes('allowed'),
  );
});

test('browser preview policy module stays below Electron, subprocess, and storage authority', () => {
  const source = fs.readFileSync('electron/builder-browser-preview-policy.cjs', 'utf8');

  assert.doesNotMatch(
    source,
    /require\(['"]electron['"]\)|ipcMain|ipcRenderer|contextBridge|BrowserWindow|WebContentsView|safeStorage|child_process|spawn\s*\(|execFile|fetch\s*\(|https?:|node:sqlite|better-sqlite|writeFile|appendFile|mkdir|rm\(|unlink|provider_secret|credential/iu,
  );
});
