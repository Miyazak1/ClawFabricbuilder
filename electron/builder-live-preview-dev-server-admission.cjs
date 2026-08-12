'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const {
  BUILDER_LIVE_PREVIEW_SOURCE_ADMISSION_VERSION,
  sanitizeBuilderLivePreviewSourceAdmission,
} = require('./builder-live-preview-source-admission.cjs');

const BUILDER_LIVE_PREVIEW_DEV_SERVER_COMMAND_PROFILE_VERSION =
  'builder-live-preview-dev-server-command-profile.v1';
const BUILDER_LIVE_PREVIEW_DEV_SERVER_APPROVAL_VERSION =
  'builder-live-preview-dev-server-approval.v1';
const BUILDER_LIVE_PREVIEW_DEV_SERVER_ADMISSION_VERSION =
  'builder-live-preview-dev-server-admission.v1';

const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const PROJECT_ID_PATTERN = new RegExp(`^builder-project:${UUID_SOURCE}$`, 'u');
const CONVERSATION_ID_PATTERN = new RegExp(`^builder-conversation:${UUID_SOURCE}$`, 'u');
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const SOURCE_ADMISSION_ID_PATTERN = /^builder-live-preview-source-admission:[0-9a-f]{64}$/u;
const DEV_PROFILE_ID_PATTERN = /^builder-live-preview-dev-server-command-profile:[0-9a-f]{32}$/u;
const DEV_APPROVAL_ID_PATTERN = /^builder-live-preview-dev-server-approval:[0-9a-f]{64}$/u;
const DEV_ADMISSION_ID_PATTERN = /^builder-live-preview-dev-server-admission:[0-9a-f]{64}$/u;

const COMMAND_PROFILE_INPUT_KEYS = Object.freeze([
  'project_id',
  'source_tree_digest',
  'package_manager',
  'script_name',
  'script_digest',
  'discovered_at_ms',
]);
const COMMAND_PROFILE_KEYS = Object.freeze([
  'command_profile_version',
  'command_profile_id',
  'project_id',
  'source_tree_digest',
  'command_kind',
  'command_display',
  'script_digest',
  'cwd',
  'package_manager',
  'script_name',
  'discovered_from',
  'requires_user_approval',
  'risk_class',
  'authority',
  'discovered_at_ms',
]);
const COMMAND_PROFILE_AUTHORITY_KEYS = Object.freeze([
  'command_profile_authority',
  'source_tree_authority',
  'renderer_command',
  'renderer_path_or_url',
  'command_execution',
  'package_install',
  'source_write',
  'git_mutation',
  'sqlite_write',
  'provider_dispatch',
  'tool_dispatch',
  'permission_grant',
]);
const APPROVAL_INPUT_KEYS = Object.freeze([
  'source_admission',
  'command_profile',
  'approved_at_ms',
  'expires_at_ms',
]);
const APPROVAL_KEYS = Object.freeze([
  'approval_version',
  'approval_id',
  'project_id',
  'conversation_id',
  'source_admission_id',
  'source_tree_digest',
  'command_profile_id',
  'script_digest',
  'purpose',
  'approved_at_ms',
  'expires_at_ms',
  'revoked',
  'authority',
]);
const APPROVAL_AUTHORITY_KEYS = Object.freeze([
  'approval_authority',
  'user_visible_action',
  'renderer_command',
  'renderer_port',
  'command_execution',
  'permission_scope',
  'provider_dispatch',
  'tool_dispatch',
  'source_write',
  'git_mutation',
  'sqlite_write',
]);
const ADMISSION_INPUT_KEYS = Object.freeze([
  'source_admission',
  'command_profile',
  'approval',
  'admitted_at_ms',
  'expires_at_ms',
]);
const ADMISSION_KEYS = Object.freeze([
  'admission_version',
  'admission_id',
  'project_id',
  'conversation_id',
  'source_kind',
  'preview_kind',
  'source_admission_id',
  'source_tree_digest',
  'source_ref_digest',
  'command_profile_ref',
  'approval_ref',
  'port_policy',
  'process_policy',
  'network_policy',
  'admitted_at_ms',
  'expires_at_ms',
  'lifecycle',
  'authority',
]);
const COMMAND_PROFILE_REF_KEYS = Object.freeze([
  'command_profile_id',
  'command_display',
  'script_digest',
  'cwd',
  'package_manager',
  'script_name',
]);
const APPROVAL_REF_KEYS = Object.freeze([
  'approval_id',
  'approved_at_ms',
  'expires_at_ms',
  'purpose',
]);
const PORT_POLICY_KEYS = Object.freeze([
  'bind_host',
  'port_selection',
  'port_authority',
  'allowed_origin_kind',
]);
const PROCESS_POLICY_KEYS = Object.freeze([
  'process_lifecycle',
  'health_check',
  'log_projection',
  'environment',
  'dependency_install',
  'shutdown_cleanup',
]);
const NETWORK_POLICY_KEYS = Object.freeze([
  'preview_navigation',
  'external_requests',
  'private_network',
  'downloads',
  'window_open',
]);
const LIFECYCLE_KEYS = Object.freeze([
  'source_admission',
  'command_profile',
  'approval',
  'command_execution',
  'process_runtime',
  'loopback_port',
  'webcontents_view',
  'evidence_collection',
  'ipc_registration',
  'provider_dispatch',
  'tool_dispatch',
  'revision_admission',
  'save_admission',
]);
const ADMISSION_AUTHORITY_KEYS = Object.freeze([
  'live_preview_authority',
  'renderer_command',
  'renderer_source_tree',
  'renderer_path_or_url',
  'renderer_port',
  'source_read',
  'source_write',
  'git_mutation',
  'sqlite_write',
  'command_execution',
  'process_spawn',
  'package_install',
  'loopback_port_authority',
  'external_network',
  'electron_view_attachment',
  'ipc_registration',
  'provider_dispatch',
  'tool_dispatch',
  'permission_grant',
  'revision_admission',
  'save_admission',
  'secret_access',
]);

const PACKAGE_MANAGERS = Object.freeze(['npm', 'pnpm', 'yarn', 'bun']);
const SCRIPT_NAMES = Object.freeze(['dev']);
const COMMAND_DISPLAY_BY_PM = Object.freeze({
  npm: 'npm run dev',
  pnpm: 'pnpm run dev',
  yarn: 'yarn dev',
  bun: 'bun run dev',
});
const PREVIEW_KIND = 'live_dev_server_web';
const PURPOSE = 'live_preview_dev_server';

const COMMAND_PROFILE_AUTHORITY = Object.freeze({
  command_profile_authority: 'main_owned_live_preview_dev_server_command_profile_v1',
  source_tree_authority: 'verified_preview_source_snapshot',
  renderer_command: 'not_accepted',
  renderer_path_or_url: 'not_accepted',
  command_execution: 'not_performed',
  package_install: 'not_performed',
  source_write: 'not_performed',
  git_mutation: 'not_performed',
  sqlite_write: 'not_performed',
  provider_dispatch: false,
  tool_dispatch: false,
  permission_grant: false,
});
const APPROVAL_AUTHORITY = Object.freeze({
  approval_authority: 'main_owned_user_dev_server_preview_approval_v1',
  user_visible_action: 'start_browser_preview_dev_server',
  renderer_command: 'not_accepted',
  renderer_port: 'not_accepted',
  command_execution: 'not_started',
  permission_scope: 'single_source_admission_and_command_profile',
  provider_dispatch: false,
  tool_dispatch: false,
  source_write: 'not_performed',
  git_mutation: 'not_performed',
  sqlite_write: 'not_performed',
});
const PORT_POLICY = Object.freeze({
  bind_host: '127.0.0.1',
  port_selection: 'main_owned_ephemeral_or_verified_loopback',
  port_authority: 'runtime_selected_not_renderer_supplied',
  allowed_origin_kind: 'owned_loopback_only',
});
const PROCESS_POLICY = Object.freeze({
  process_lifecycle: 'start_healthcheck_stop_cleanup_required',
  health_check: 'main_owned_loopback_ready_probe_required',
  log_projection: 'redacted_summary_only',
  environment: 'minimal_sanitized_no_secrets',
  dependency_install: 'not_allowed',
  shutdown_cleanup: 'required_before_app_exit',
});
const NETWORK_POLICY = Object.freeze({
  preview_navigation: 'owned_loopback_origin_only',
  external_requests: 'blocked_by_default',
  private_network: 'blocked_by_default',
  downloads: 'blocked',
  window_open: 'blocked',
});
const LIFECYCLE = Object.freeze({
  source_admission: 'verified_preview_source_snapshot',
  command_profile: 'verified_dev_server_profile',
  approval: 'explicit_fresh_user_approval',
  command_execution: 'not_started',
  process_runtime: 'not_started',
  loopback_port: 'not_selected',
  webcontents_view: 'not_attached',
  evidence_collection: 'not_started',
  ipc_registration: 'not_present',
  provider_dispatch: 'not_started',
  tool_dispatch: 'not_started',
  revision_admission: 'not_created',
  save_admission: 'not_performed',
});
const ADMISSION_AUTHORITY = Object.freeze({
  live_preview_authority: 'main_live_preview_dev_server_admission_contract_v1',
  renderer_command: 'not_accepted',
  renderer_source_tree: 'not_accepted',
  renderer_path_or_url: 'not_accepted',
  renderer_port: 'not_accepted',
  source_read: 'provided_by_verified_preview_source_admission',
  source_write: 'not_performed',
  git_mutation: 'not_performed',
  sqlite_write: 'not_performed',
  command_execution: 'not_started',
  process_spawn: 'not_started',
  package_install: 'not_allowed',
  loopback_port_authority: 'main_runtime_only',
  external_network: 'blocked_by_default',
  electron_view_attachment: 'not_performed',
  ipc_registration: 'not_present',
  provider_dispatch: 'not_performed',
  tool_dispatch: 'not_performed',
  permission_grant: 'not_created',
  revision_admission: 'not_created',
  save_admission: 'not_performed',
  secret_access: 'not_present',
});
const ERROR_MESSAGE = 'Builder live preview dev server admission could not be verified.';

class BuilderLivePreviewDevServerAdmissionError extends Error {
  constructor() {
    super(ERROR_MESSAGE);
    this.name = 'BuilderLivePreviewDevServerAdmissionError';
    this.code = 'builder_live_preview_dev_server_admission_invalid';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderLivePreviewDevServerAdmissionError();
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
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      fail();
    }
  }
}

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  return descriptor.value;
}

function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number' && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(valueAt(value, key))}`
    )).join(',')}}`;
  }
  fail();
}

function sha256Canonical(value) {
  return `sha256:${nodeCrypto.createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')}`;
}

function idFor(prefix, body) {
  return `${prefix}:${sha256Canonical(body).slice('sha256:'.length)}`;
}

function profileIdFor(body) {
  return `builder-live-preview-dev-server-command-profile:${
    sha256Canonical(body).slice('sha256:'.length, 'sha256:'.length + 32)
  }`;
}

function safePattern(value, pattern, maximum) {
  if (typeof value !== 'string' || value.length > maximum || !pattern.test(value)) fail();
  return value;
}

function safeProjectId(value) {
  return safePattern(value, PROJECT_ID_PATTERN, 52);
}

function safeConversationId(value) {
  return safePattern(value, CONVERSATION_ID_PATTERN, 57);
}

function safeDigest(value) {
  return safePattern(value, DIGEST_PATTERN, 71);
}

function safeSourceAdmissionId(value) {
  return safePattern(value, SOURCE_ADMISSION_ID_PATTERN, 128);
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail();
  return value;
}

function safeExpiresAt(value, startsAt, maximumMs) {
  const expiresAt = safeTimestamp(value);
  if (expiresAt <= startsAt || expiresAt - startsAt > maximumMs) fail();
  return expiresAt;
}

function safeEnum(value, allowed) {
  if (!allowed.includes(value)) fail();
  return value;
}

function assertAuthority(value, expected, keys) {
  exactObject(value, keys);
  for (const key of keys) {
    if (valueAt(value, key) !== valueAt(expected, key)) fail();
  }
  return expected;
}

function assertSourceAdmission(value) {
  const admission = sanitizeBuilderLivePreviewSourceAdmission(value);
  if (admission.admission_version !== BUILDER_LIVE_PREVIEW_SOURCE_ADMISSION_VERSION) fail();
  return admission;
}

function commandProfileBody(profile) {
  return {
    command_profile_version: profile.command_profile_version,
    project_id: profile.project_id,
    source_tree_digest: profile.source_tree_digest,
    command_kind: profile.command_kind,
    command_display: profile.command_display,
    script_digest: profile.script_digest,
    cwd: profile.cwd,
    package_manager: profile.package_manager,
    script_name: profile.script_name,
    discovered_from: profile.discovered_from,
    requires_user_approval: profile.requires_user_approval,
    risk_class: profile.risk_class,
    discovered_at_ms: profile.discovered_at_ms,
  };
}

function sanitizeCommandProfile(value, expected = null) {
  exactObject(value, COMMAND_PROFILE_KEYS);
  const packageManager = safeEnum(valueAt(value, 'package_manager'), PACKAGE_MANAGERS);
  const scriptName = safeEnum(valueAt(value, 'script_name'), SCRIPT_NAMES);
  const profile = {
    command_profile_version: valueAt(value, 'command_profile_version'),
    command_profile_id: safePattern(valueAt(value, 'command_profile_id'), DEV_PROFILE_ID_PATTERN, 83),
    project_id: safeProjectId(valueAt(value, 'project_id')),
    source_tree_digest: safeDigest(valueAt(value, 'source_tree_digest')),
    command_kind: valueAt(value, 'command_kind'),
    command_display: valueAt(value, 'command_display'),
    script_digest: safeDigest(valueAt(value, 'script_digest')),
    cwd: valueAt(value, 'cwd'),
    package_manager: packageManager,
    script_name: scriptName,
    discovered_from: valueAt(value, 'discovered_from'),
    requires_user_approval: valueAt(value, 'requires_user_approval'),
    risk_class: valueAt(value, 'risk_class'),
    authority: assertAuthority(
      valueAt(value, 'authority'),
      COMMAND_PROFILE_AUTHORITY,
      COMMAND_PROFILE_AUTHORITY_KEYS,
    ),
    discovered_at_ms: safeTimestamp(valueAt(value, 'discovered_at_ms')),
  };
  if (
    profile.command_profile_version !== BUILDER_LIVE_PREVIEW_DEV_SERVER_COMMAND_PROFILE_VERSION
    || profile.command_kind !== 'dev_server'
    || profile.command_display !== COMMAND_DISPLAY_BY_PM[packageManager]
    || profile.cwd !== '.'
    || profile.discovered_from !== 'package.json:scripts.dev'
    || profile.requires_user_approval !== true
    || profile.risk_class !== 'project_dev_server_execution'
  ) fail();
  if (expected !== null) {
    if (
      profile.project_id !== expected.project_id
      || profile.source_tree_digest !== expected.source_tree_digest
    ) fail();
  }
  if (profile.command_profile_id !== profileIdFor(commandProfileBody(profile))) fail();
  return freezeDeep(profile);
}

function createBuilderLivePreviewDevServerCommandProfile(rawInput) {
  try {
    exactObject(rawInput, COMMAND_PROFILE_INPUT_KEYS);
    const packageManager = safeEnum(valueAt(rawInput, 'package_manager'), PACKAGE_MANAGERS);
    const scriptName = safeEnum(valueAt(rawInput, 'script_name'), SCRIPT_NAMES);
    const body = {
      command_profile_version: BUILDER_LIVE_PREVIEW_DEV_SERVER_COMMAND_PROFILE_VERSION,
      project_id: safeProjectId(valueAt(rawInput, 'project_id')),
      source_tree_digest: safeDigest(valueAt(rawInput, 'source_tree_digest')),
      command_kind: 'dev_server',
      command_display: COMMAND_DISPLAY_BY_PM[packageManager],
      script_digest: safeDigest(valueAt(rawInput, 'script_digest')),
      cwd: '.',
      package_manager: packageManager,
      script_name: scriptName,
      discovered_from: 'package.json:scripts.dev',
      requires_user_approval: true,
      risk_class: 'project_dev_server_execution',
      discovered_at_ms: safeTimestamp(valueAt(rawInput, 'discovered_at_ms')),
    };
    return freezeDeep({
      ...body,
      command_profile_id: profileIdFor(body),
      authority: COMMAND_PROFILE_AUTHORITY,
    });
  } catch (error) {
    if (error instanceof BuilderLivePreviewDevServerAdmissionError) throw error;
    throw fail();
  }
}

function approvalBody(approval) {
  return {
    approval_version: approval.approval_version,
    project_id: approval.project_id,
    conversation_id: approval.conversation_id,
    source_admission_id: approval.source_admission_id,
    source_tree_digest: approval.source_tree_digest,
    command_profile_id: approval.command_profile_id,
    script_digest: approval.script_digest,
    purpose: approval.purpose,
    approved_at_ms: approval.approved_at_ms,
    expires_at_ms: approval.expires_at_ms,
    revoked: approval.revoked,
  };
}

function sanitizeApproval(value, expected) {
  exactObject(value, APPROVAL_KEYS);
  const approval = {
    approval_version: valueAt(value, 'approval_version'),
    approval_id: safePattern(valueAt(value, 'approval_id'), DEV_APPROVAL_ID_PATTERN, 128),
    project_id: safeProjectId(valueAt(value, 'project_id')),
    conversation_id: safeConversationId(valueAt(value, 'conversation_id')),
    source_admission_id: safeSourceAdmissionId(valueAt(value, 'source_admission_id')),
    source_tree_digest: safeDigest(valueAt(value, 'source_tree_digest')),
    command_profile_id: safePattern(valueAt(value, 'command_profile_id'), DEV_PROFILE_ID_PATTERN, 83),
    script_digest: safeDigest(valueAt(value, 'script_digest')),
    purpose: valueAt(value, 'purpose'),
    approved_at_ms: safeTimestamp(valueAt(value, 'approved_at_ms')),
    expires_at_ms: 0,
    revoked: valueAt(value, 'revoked'),
    authority: assertAuthority(valueAt(value, 'authority'), APPROVAL_AUTHORITY, APPROVAL_AUTHORITY_KEYS),
  };
  if (
    approval.approval_version !== BUILDER_LIVE_PREVIEW_DEV_SERVER_APPROVAL_VERSION
    || approval.purpose !== PURPOSE
    || approval.revoked !== false
    || approval.project_id !== expected.project_id
    || approval.conversation_id !== expected.conversation_id
    || approval.source_admission_id !== expected.source_admission_id
    || approval.source_tree_digest !== expected.source_tree_digest
    || approval.command_profile_id !== expected.command_profile_id
    || approval.script_digest !== expected.script_digest
  ) fail();
  approval.expires_at_ms = safeExpiresAt(valueAt(value, 'expires_at_ms'), approval.approved_at_ms, 10 * 60 * 1_000);
  if (approval.approval_id !== idFor('builder-live-preview-dev-server-approval', approvalBody(approval))) {
    fail();
  }
  return freezeDeep(approval);
}

function createBuilderLivePreviewDevServerApproval(rawInput) {
  try {
    exactObject(rawInput, APPROVAL_INPUT_KEYS);
    const sourceAdmission = assertSourceAdmission(valueAt(rawInput, 'source_admission'));
    const commandProfile = sanitizeCommandProfile(valueAt(rawInput, 'command_profile'), {
      project_id: sourceAdmission.project_id,
      source_tree_digest: sourceAdmission.source_tree_digest,
    });
    const approvedAtMs = safeTimestamp(valueAt(rawInput, 'approved_at_ms'));
    const approval = {
      approval_version: BUILDER_LIVE_PREVIEW_DEV_SERVER_APPROVAL_VERSION,
      approval_id: null,
      project_id: sourceAdmission.project_id,
      conversation_id: sourceAdmission.conversation_id,
      source_admission_id: sourceAdmission.admission_id,
      source_tree_digest: sourceAdmission.source_tree_digest,
      command_profile_id: commandProfile.command_profile_id,
      script_digest: commandProfile.script_digest,
      purpose: PURPOSE,
      approved_at_ms: approvedAtMs,
      expires_at_ms: safeExpiresAt(valueAt(rawInput, 'expires_at_ms'), approvedAtMs, 10 * 60 * 1_000),
      revoked: false,
      authority: APPROVAL_AUTHORITY,
    };
    approval.approval_id = idFor('builder-live-preview-dev-server-approval', approvalBody(approval));
    return freezeDeep(approval);
  } catch (error) {
    if (error instanceof BuilderLivePreviewDevServerAdmissionError) throw error;
    throw fail();
  }
}

function commandProfileRef(profile) {
  return freezeDeep({
    command_profile_id: profile.command_profile_id,
    command_display: profile.command_display,
    script_digest: profile.script_digest,
    cwd: profile.cwd,
    package_manager: profile.package_manager,
    script_name: profile.script_name,
  });
}

function sanitizeCommandProfileRef(value) {
  exactObject(value, COMMAND_PROFILE_REF_KEYS);
  const packageManager = safeEnum(valueAt(value, 'package_manager'), PACKAGE_MANAGERS);
  return freezeDeep({
    command_profile_id: safePattern(valueAt(value, 'command_profile_id'), DEV_PROFILE_ID_PATTERN, 83),
    command_display: COMMAND_DISPLAY_BY_PM[packageManager],
    script_digest: safeDigest(valueAt(value, 'script_digest')),
    cwd: valueAt(value, 'cwd') === '.' ? '.' : fail(),
    package_manager: packageManager,
    script_name: safeEnum(valueAt(value, 'script_name'), SCRIPT_NAMES),
  });
}

function approvalRef(approval) {
  return freezeDeep({
    approval_id: approval.approval_id,
    approved_at_ms: approval.approved_at_ms,
    expires_at_ms: approval.expires_at_ms,
    purpose: approval.purpose,
  });
}

function sanitizeApprovalRef(value) {
  exactObject(value, APPROVAL_REF_KEYS);
  return freezeDeep({
    approval_id: safePattern(valueAt(value, 'approval_id'), DEV_APPROVAL_ID_PATTERN, 128),
    approved_at_ms: safeTimestamp(valueAt(value, 'approved_at_ms')),
    expires_at_ms: safeTimestamp(valueAt(value, 'expires_at_ms')),
    purpose: valueAt(value, 'purpose') === PURPOSE ? PURPOSE : fail(),
  });
}

function admissionBody(admission) {
  return {
    admission_version: admission.admission_version,
    project_id: admission.project_id,
    conversation_id: admission.conversation_id,
    source_kind: admission.source_kind,
    preview_kind: admission.preview_kind,
    source_admission_id: admission.source_admission_id,
    source_tree_digest: admission.source_tree_digest,
    source_ref_digest: admission.source_ref_digest,
    command_profile_ref: admission.command_profile_ref,
    approval_ref: admission.approval_ref,
    admitted_at_ms: admission.admitted_at_ms,
    expires_at_ms: admission.expires_at_ms,
  };
}

function createBuilderLivePreviewDevServerAdmission(rawInput) {
  try {
    exactObject(rawInput, ADMISSION_INPUT_KEYS);
    const sourceAdmission = assertSourceAdmission(valueAt(rawInput, 'source_admission'));
    const commandProfile = sanitizeCommandProfile(valueAt(rawInput, 'command_profile'), {
      project_id: sourceAdmission.project_id,
      source_tree_digest: sourceAdmission.source_tree_digest,
    });
    const approval = sanitizeApproval(valueAt(rawInput, 'approval'), {
      project_id: sourceAdmission.project_id,
      conversation_id: sourceAdmission.conversation_id,
      source_admission_id: sourceAdmission.admission_id,
      source_tree_digest: sourceAdmission.source_tree_digest,
      command_profile_id: commandProfile.command_profile_id,
      script_digest: commandProfile.script_digest,
    });
    const admittedAtMs = safeTimestamp(valueAt(rawInput, 'admitted_at_ms'));
    if (admittedAtMs < approval.approved_at_ms || admittedAtMs >= approval.expires_at_ms) fail();
    const admission = {
      admission_version: BUILDER_LIVE_PREVIEW_DEV_SERVER_ADMISSION_VERSION,
      admission_id: null,
      project_id: sourceAdmission.project_id,
      conversation_id: sourceAdmission.conversation_id,
      source_kind: sourceAdmission.source_kind,
      preview_kind: PREVIEW_KIND,
      source_admission_id: sourceAdmission.admission_id,
      source_tree_digest: sourceAdmission.source_tree_digest,
      source_ref_digest: sourceAdmission.source_ref_digest,
      command_profile_ref: commandProfileRef(commandProfile),
      approval_ref: approvalRef(approval),
      port_policy: PORT_POLICY,
      process_policy: PROCESS_POLICY,
      network_policy: NETWORK_POLICY,
      admitted_at_ms: admittedAtMs,
      expires_at_ms: safeExpiresAt(valueAt(rawInput, 'expires_at_ms'), admittedAtMs, 30 * 60 * 1_000),
      lifecycle: LIFECYCLE,
      authority: ADMISSION_AUTHORITY,
    };
    if (admission.expires_at_ms > approval.expires_at_ms) fail();
    admission.admission_id = idFor('builder-live-preview-dev-server-admission', admissionBody(admission));
    return freezeDeep(admission);
  } catch (error) {
    if (error instanceof BuilderLivePreviewDevServerAdmissionError) throw error;
    throw fail();
  }
}

function sanitizeBuilderLivePreviewDevServerAdmission(rawAdmission) {
  try {
    exactObject(rawAdmission, ADMISSION_KEYS);
    const admission = {
      admission_version: valueAt(rawAdmission, 'admission_version'),
    admission_id: safePattern(valueAt(rawAdmission, 'admission_id'), DEV_ADMISSION_ID_PATTERN, 128),
      project_id: safeProjectId(valueAt(rawAdmission, 'project_id')),
      conversation_id: safeConversationId(valueAt(rawAdmission, 'conversation_id')),
      source_kind: safeEnum(valueAt(rawAdmission, 'source_kind'), ['current_draft', 'saved_revision']),
      preview_kind: valueAt(rawAdmission, 'preview_kind'),
      source_admission_id: safeSourceAdmissionId(valueAt(rawAdmission, 'source_admission_id')),
      source_tree_digest: safeDigest(valueAt(rawAdmission, 'source_tree_digest')),
      source_ref_digest: safeDigest(valueAt(rawAdmission, 'source_ref_digest')),
      command_profile_ref: sanitizeCommandProfileRef(valueAt(rawAdmission, 'command_profile_ref')),
      approval_ref: sanitizeApprovalRef(valueAt(rawAdmission, 'approval_ref')),
      port_policy: assertAuthority(valueAt(rawAdmission, 'port_policy'), PORT_POLICY, PORT_POLICY_KEYS),
      process_policy: assertAuthority(valueAt(rawAdmission, 'process_policy'), PROCESS_POLICY, PROCESS_POLICY_KEYS),
      network_policy: assertAuthority(valueAt(rawAdmission, 'network_policy'), NETWORK_POLICY, NETWORK_POLICY_KEYS),
      admitted_at_ms: safeTimestamp(valueAt(rawAdmission, 'admitted_at_ms')),
      expires_at_ms: safeTimestamp(valueAt(rawAdmission, 'expires_at_ms')),
      lifecycle: assertAuthority(valueAt(rawAdmission, 'lifecycle'), LIFECYCLE, LIFECYCLE_KEYS),
      authority: assertAuthority(valueAt(rawAdmission, 'authority'), ADMISSION_AUTHORITY, ADMISSION_AUTHORITY_KEYS),
    };
    if (
      admission.admission_version !== BUILDER_LIVE_PREVIEW_DEV_SERVER_ADMISSION_VERSION
      || admission.preview_kind !== PREVIEW_KIND
      || admission.admitted_at_ms < admission.approval_ref.approved_at_ms
      || admission.expires_at_ms > admission.approval_ref.expires_at_ms
      || admission.expires_at_ms <= admission.admitted_at_ms
    ) fail();
    if (admission.admission_id !== idFor('builder-live-preview-dev-server-admission', admissionBody(admission))) {
      fail();
    }
    return freezeDeep(admission);
  } catch (error) {
    if (error instanceof BuilderLivePreviewDevServerAdmissionError) throw error;
    throw fail();
  }
}

module.exports = freezeDeep({
  BUILDER_LIVE_PREVIEW_DEV_SERVER_ADMISSION_VERSION,
  BUILDER_LIVE_PREVIEW_DEV_SERVER_APPROVAL_VERSION,
  BUILDER_LIVE_PREVIEW_DEV_SERVER_COMMAND_PROFILE_VERSION,
  BuilderLivePreviewDevServerAdmissionError,
  createBuilderLivePreviewDevServerAdmission,
  createBuilderLivePreviewDevServerApproval,
  createBuilderLivePreviewDevServerCommandProfile,
  sanitizeBuilderLivePreviewDevServerAdmission,
});
