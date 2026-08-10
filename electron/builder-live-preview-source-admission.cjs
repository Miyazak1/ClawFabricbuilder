'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const {
  BUILDER_LIVE_PREVIEW_SOURCE_RESOLVER_VERSION,
  BUILDER_LIVE_PREVIEW_SOURCE_RESOLVER_RESULT_VERSION,
  BUILDER_LIVE_PREVIEW_SOURCE_SNAPSHOT_VERSION,
} = require('./builder-live-preview-source-resolver.cjs');
const {
  sanitizeBuilderProjectSourceTree,
} = require('./builder-project-source-tree.cjs');

const BUILDER_LIVE_PREVIEW_SOURCE_ADMISSION_VERSION =
  'builder-live-preview-source-admission.v1';
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const PROJECT_ID_PATTERN = new RegExp(`^builder-project:${UUID_SOURCE}$`, 'u');
const CONVERSATION_ID_PATTERN = new RegExp(`^builder-conversation:${UUID_SOURCE}$`, 'u');
const CHECKPOINT_ID_PATTERN = /^builder-draft-checkpoint:[0-9a-f]{64}$/u;
const CANDIDATE_ID_PATTERN = /^builder-code-change-candidate:[0-9a-f]{64}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const OID_PATTERN = /^[0-9a-f]{40,64}$/u;
const PREVIEW_KINDS = Object.freeze(['live_static_web']);

const INPUT_KEYS = Object.freeze([
  'source_resolver_result',
  'selected_entry_path',
  'preview_kind',
  'admitted_at_ms',
  'expires_at_ms',
]);
const RESOLVER_RESULT_KEYS = Object.freeze([
  'result_version',
  'resolver_version',
  'operation',
  'source_kind',
  'status',
  'unavailable_reason',
  'preview_source_snapshot',
]);
const SOURCE_SNAPSHOT_KEYS = Object.freeze([
  'snapshot_version',
  'source_kind',
  'project_id',
  'conversation_id',
  'source_tree',
  'source_tree_digest',
  'source_ref',
  'admission',
  'authority',
]);
const CURRENT_SOURCE_REF_KEYS = Object.freeze([
  'source_ref_kind',
  'project_id',
  'conversation_id',
  'checkpoint_id',
  'checkpoint_sequence',
  'candidate_id',
  'candidate_digest',
  'resulting_tree_digest',
  'commit_oid',
  'tree_oid',
]);
const SAVED_SOURCE_REF_KEYS = Object.freeze([
  'source_ref_kind',
  'project_id',
  'conversation_id',
  'revision_receipt_digest',
  'revision_number',
  'candidate_id',
  'candidate_digest',
  'resulting_tree_digest',
  'commit_oid',
  'tree_oid',
]);
const SOURCE_RESOLVER_ADMISSION_KEYS = Object.freeze([
  'preview_source_admission',
  'source_tree_digest',
]);
const SOURCE_RESOLVER_AUTHORITY_KEYS = Object.freeze([
  'source_resolver_authority',
  'renderer_source_tree',
  'renderer_path_or_url',
  'git_read',
  'sqlite_read',
  'source_write',
  'git_write',
  'sqlite_write',
  'provider_dispatch',
  'tool_dispatch',
  'command_execution',
  'electron_view_attachment',
  'ipc_registration',
  'revision_admission',
  'save_admission',
  'permission_grant',
]);
const LIFECYCLE_KEYS = Object.freeze([
  'source_resolver_admission',
  'entry_admission',
  'preview_server',
  'webcontents_view',
  'evidence_collection',
  'ipc_registration',
  'provider_dispatch',
  'tool_dispatch',
  'revision_admission',
  'save_admission',
]);
const AUTHORITY_KEYS = Object.freeze([
  'live_preview_authority',
  'renderer_source_tree',
  'renderer_path_or_url',
  'source_read',
  'source_write',
  'git_mutation',
  'sqlite_write',
  'server_start',
  'electron_view_attachment',
  'ipc_registration',
  'provider_dispatch',
  'tool_dispatch',
  'command_execution',
  'permission_grant',
  'revision_admission',
  'save_admission',
  'network_access',
  'node_integration',
  'preload',
]);
const ADMISSION_KEYS = Object.freeze([
  'admission_version',
  'admission_id',
  'project_id',
  'conversation_id',
  'source_kind',
  'preview_kind',
  'source_tree_digest',
  'source_ref_digest',
  'source_ref',
  'selected_entry_path',
  'selected_entry_digest',
  'source_tree',
  'admitted_at_ms',
  'expires_at_ms',
  'lifecycle',
  'authority',
]);
const AUTHORITY = Object.freeze({
  live_preview_authority: 'main_live_preview_source_admission_contract_v1',
  renderer_source_tree: 'not_accepted',
  renderer_path_or_url: 'not_accepted',
  source_read: 'provided_by_verified_preview_source_snapshot',
  source_write: 'not_performed',
  git_mutation: 'not_performed',
  sqlite_write: 'not_performed',
  server_start: 'not_started',
  electron_view_attachment: 'not_performed',
  ipc_registration: 'not_present',
  provider_dispatch: 'not_performed',
  tool_dispatch: 'not_performed',
  command_execution: 'not_performed',
  permission_grant: 'not_performed',
  revision_admission: 'not_created',
  save_admission: 'not_performed',
  network_access: 'not_performed',
  node_integration: 'not_present',
  preload: 'not_present',
});
const LIFECYCLE = Object.freeze({
  source_resolver_admission: 'verified_ready_snapshot',
  entry_admission: 'html_entry_verified_in_snapshot',
  preview_server: 'not_started',
  webcontents_view: 'not_attached',
  evidence_collection: 'not_started',
  ipc_registration: 'not_present',
  provider_dispatch: 'not_started',
  tool_dispatch: 'not_started',
  revision_admission: 'not_created',
  save_admission: 'not_performed',
});
const ERROR_MESSAGE = 'Builder live preview source admission could not be verified.';

class BuilderLivePreviewSourceAdmissionError extends Error {
  constructor() {
    super(ERROR_MESSAGE);
    this.name = 'BuilderLivePreviewSourceAdmissionError';
    this.code = 'builder_live_preview_source_admission_invalid';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderLivePreviewSourceAdmissionError();
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

function safeOid(value) {
  return safePattern(value, OID_PATTERN, 64);
}

function safeEnum(value, allowed) {
  if (!allowed.includes(value)) fail();
  return value;
}

function hasUnsafeTextControlCharacter(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail();
  return value;
}

function safeExpiresAt(value, admittedAt) {
  const expiresAt = safeTimestamp(value);
  if (expiresAt <= admittedAt || expiresAt - admittedAt > 30 * 60 * 1_000) fail();
  return expiresAt;
}

function safeEntryPath(value) {
  if (
    typeof value !== 'string'
    || value.length < 1
    || value.length > 240
    || value.trim() !== value
    || value.startsWith('/')
    || value.endsWith('/')
    || value.includes('\\')
    || value.includes('..')
    || !/\.html?$/iu.test(value)
    || /[<>:"|?*]/u.test(value)
    || hasUnsafeTextControlCharacter(value)
  ) fail();
  return value;
}

function assertAuthority(value, expected, keys) {
  exactObject(value, keys);
  for (const key of keys) {
    if (valueAt(value, key) !== valueAt(expected, key)) fail();
  }
  return expected;
}

function sanitizeSourceResolverAuthority(value) {
  exactObject(value, SOURCE_RESOLVER_AUTHORITY_KEYS);
  if (
    valueAt(value, 'source_resolver_authority') !== 'main_owned_live_preview_source_resolver_v1'
    || valueAt(value, 'renderer_source_tree') !== 'not_accepted'
    || valueAt(value, 'renderer_path_or_url') !== 'not_accepted'
    || valueAt(value, 'source_write') !== 'not_performed'
    || valueAt(value, 'git_write') !== 'not_performed'
    || valueAt(value, 'sqlite_write') !== 'not_performed'
    || valueAt(value, 'provider_dispatch') !== false
    || valueAt(value, 'tool_dispatch') !== false
    || valueAt(value, 'command_execution') !== false
    || valueAt(value, 'electron_view_attachment') !== false
    || valueAt(value, 'ipc_registration') !== false
    || valueAt(value, 'revision_admission') !== false
    || valueAt(value, 'save_admission') !== false
    || valueAt(value, 'permission_grant') !== false
  ) fail();
  return freezeDeep({
    source_resolver_authority: valueAt(value, 'source_resolver_authority'),
    renderer_source_tree: valueAt(value, 'renderer_source_tree'),
    renderer_path_or_url: valueAt(value, 'renderer_path_or_url'),
    git_read: valueAt(value, 'git_read'),
    sqlite_read: valueAt(value, 'sqlite_read'),
    source_write: valueAt(value, 'source_write'),
    git_write: valueAt(value, 'git_write'),
    sqlite_write: valueAt(value, 'sqlite_write'),
    provider_dispatch: false,
    tool_dispatch: false,
    command_execution: false,
    electron_view_attachment: false,
    ipc_registration: false,
    revision_admission: false,
    save_admission: false,
    permission_grant: false,
  });
}

function sanitizeSourceResolverAdmission(value, expectedDigest) {
  exactObject(value, SOURCE_RESOLVER_ADMISSION_KEYS);
  if (
    valueAt(value, 'preview_source_admission') !== 'main_owned_verified_preview_source'
    || valueAt(value, 'source_tree_digest') !== expectedDigest
  ) fail();
  return freezeDeep({
    preview_source_admission: 'main_owned_verified_preview_source',
    source_tree_digest: expectedDigest,
  });
}

function sanitizeSourceRef(value, sourceKind, projectId, conversationId, sourceTreeDigest) {
  if (sourceKind === 'current_draft') {
    exactObject(value, CURRENT_SOURCE_REF_KEYS);
    const checkpointSequence = valueAt(value, 'checkpoint_sequence');
    if (
      valueAt(value, 'source_ref_kind') !== 'current_draft_checkpoint_candidate'
      || valueAt(value, 'project_id') !== projectId
      || valueAt(value, 'conversation_id') !== conversationId
      || valueAt(value, 'resulting_tree_digest') !== sourceTreeDigest
      || !Number.isSafeInteger(checkpointSequence)
      || checkpointSequence < 1
    ) fail();
    return freezeDeep({
      source_ref_kind: 'current_draft_checkpoint_candidate',
      project_id: projectId,
      conversation_id: conversationId,
      checkpoint_id: safePattern(valueAt(value, 'checkpoint_id'), CHECKPOINT_ID_PATTERN, 89),
      checkpoint_sequence: checkpointSequence,
      candidate_id: safePattern(valueAt(value, 'candidate_id'), CANDIDATE_ID_PATTERN, 96),
      candidate_digest: safeDigest(valueAt(value, 'candidate_digest')),
      resulting_tree_digest: sourceTreeDigest,
      commit_oid: safeOid(valueAt(value, 'commit_oid')),
      tree_oid: safeOid(valueAt(value, 'tree_oid')),
    });
  }
  if (sourceKind === 'saved_revision') {
    exactObject(value, SAVED_SOURCE_REF_KEYS);
    const revisionNumber = valueAt(value, 'revision_number');
    if (
      valueAt(value, 'source_ref_kind') !== 'saved_project_revision'
      || valueAt(value, 'project_id') !== projectId
      || valueAt(value, 'conversation_id') !== conversationId
      || valueAt(value, 'resulting_tree_digest') !== sourceTreeDigest
      || !Number.isSafeInteger(revisionNumber)
      || revisionNumber < 1
    ) fail();
    return freezeDeep({
      source_ref_kind: 'saved_project_revision',
      project_id: projectId,
      conversation_id: conversationId,
      revision_receipt_digest: safeDigest(valueAt(value, 'revision_receipt_digest')),
      revision_number: revisionNumber,
      candidate_id: safePattern(valueAt(value, 'candidate_id'), CANDIDATE_ID_PATTERN, 96),
      candidate_digest: safeDigest(valueAt(value, 'candidate_digest')),
      resulting_tree_digest: sourceTreeDigest,
      commit_oid: safeOid(valueAt(value, 'commit_oid')),
      tree_oid: safeOid(valueAt(value, 'tree_oid')),
    });
  }
  fail();
}

function findEntry(sourceTree, entryPath) {
  const entry = sourceTree.files.find((item) => item.path === entryPath);
  if (!entry || entry.entry_kind !== 'text_file') fail();
  return freezeDeep({
    path: entry.path,
    content_digest: entry.content_digest,
  });
}

function sanitizeReadyResolverResult(value) {
  exactObject(value, RESOLVER_RESULT_KEYS);
  if (
    valueAt(value, 'result_version') !== BUILDER_LIVE_PREVIEW_SOURCE_RESOLVER_RESULT_VERSION
    || valueAt(value, 'resolver_version') !== BUILDER_LIVE_PREVIEW_SOURCE_RESOLVER_VERSION
    || valueAt(value, 'status') !== 'ready'
    || valueAt(value, 'unavailable_reason') !== null
  ) fail();
  const sourceKind = safeEnum(valueAt(value, 'source_kind'), ['current_draft', 'saved_revision']);
  const expectedOperation = sourceKind === 'current_draft'
    ? 'current_draft_preview_source_resolved'
    : 'saved_revision_preview_source_resolved';
  if (valueAt(value, 'operation') !== expectedOperation) fail();

  const snapshot = valueAt(value, 'preview_source_snapshot');
  exactObject(snapshot, SOURCE_SNAPSHOT_KEYS);
  const projectId = safeProjectId(valueAt(snapshot, 'project_id'));
  const conversationId = safeConversationId(valueAt(snapshot, 'conversation_id'));
  const sourceTree = sanitizeBuilderProjectSourceTree(valueAt(snapshot, 'source_tree'));
  const sourceTreeDigest = safeDigest(valueAt(snapshot, 'source_tree_digest'));
  if (
    valueAt(snapshot, 'snapshot_version') !== BUILDER_LIVE_PREVIEW_SOURCE_SNAPSHOT_VERSION
    || valueAt(snapshot, 'source_kind') !== sourceKind
    || sourceTree.source_tree_digest !== sourceTreeDigest
  ) fail();
  const sourceRef = sanitizeSourceRef(
    valueAt(snapshot, 'source_ref'),
    sourceKind,
    projectId,
    conversationId,
    sourceTreeDigest,
  );
  sanitizeSourceResolverAdmission(valueAt(snapshot, 'admission'), sourceTreeDigest);
  sanitizeSourceResolverAuthority(valueAt(snapshot, 'authority'));
  return freezeDeep({
    source_kind: sourceKind,
    project_id: projectId,
    conversation_id: conversationId,
    source_tree: sourceTree,
    source_tree_digest: sourceTreeDigest,
    source_ref: sourceRef,
    source_ref_digest: sha256Canonical(sourceRef),
  });
}

function bodyFor(admission) {
  return {
    admission_version: admission.admission_version,
    project_id: admission.project_id,
    conversation_id: admission.conversation_id,
    source_kind: admission.source_kind,
    preview_kind: admission.preview_kind,
    source_tree_digest: admission.source_tree_digest,
    source_ref_digest: admission.source_ref_digest,
    source_ref: admission.source_ref,
    selected_entry_path: admission.selected_entry_path,
    selected_entry_digest: admission.selected_entry_digest,
    admitted_at_ms: admission.admitted_at_ms,
    expires_at_ms: admission.expires_at_ms,
  };
}

function createBuilderLivePreviewSourceAdmission(rawInput) {
  try {
    exactObject(rawInput, INPUT_KEYS);
    const snapshot = sanitizeReadyResolverResult(valueAt(rawInput, 'source_resolver_result'));
    const selectedEntryPath = safeEntryPath(valueAt(rawInput, 'selected_entry_path'));
    const selectedEntry = findEntry(snapshot.source_tree, selectedEntryPath);
    const admittedAtMs = safeTimestamp(valueAt(rawInput, 'admitted_at_ms'));
    const admission = {
      admission_version: BUILDER_LIVE_PREVIEW_SOURCE_ADMISSION_VERSION,
      admission_id: null,
      project_id: snapshot.project_id,
      conversation_id: snapshot.conversation_id,
      source_kind: snapshot.source_kind,
      preview_kind: safeEnum(valueAt(rawInput, 'preview_kind'), PREVIEW_KINDS),
      source_tree_digest: snapshot.source_tree_digest,
      source_ref_digest: snapshot.source_ref_digest,
      source_ref: snapshot.source_ref,
      selected_entry_path: selectedEntry.path,
      selected_entry_digest: selectedEntry.content_digest,
      source_tree: snapshot.source_tree,
      admitted_at_ms: admittedAtMs,
      expires_at_ms: safeExpiresAt(valueAt(rawInput, 'expires_at_ms'), admittedAtMs),
      lifecycle: LIFECYCLE,
      authority: AUTHORITY,
    };
    admission.admission_id = idFor('builder-live-preview-source-admission', bodyFor(admission));
    return freezeDeep(admission);
  } catch (error) {
    if (error instanceof BuilderLivePreviewSourceAdmissionError) throw error;
    throw fail();
  }
}

function sanitizeBuilderLivePreviewSourceAdmission(rawAdmission) {
  try {
    exactObject(rawAdmission, ADMISSION_KEYS);
    const projectId = safeProjectId(valueAt(rawAdmission, 'project_id'));
    const conversationId = safeConversationId(valueAt(rawAdmission, 'conversation_id'));
    const sourceKind = safeEnum(valueAt(rawAdmission, 'source_kind'), ['current_draft', 'saved_revision']);
    const sourceTree = sanitizeBuilderProjectSourceTree(valueAt(rawAdmission, 'source_tree'));
    const sourceTreeDigest = safeDigest(valueAt(rawAdmission, 'source_tree_digest'));
    if (sourceTree.source_tree_digest !== sourceTreeDigest) fail();
    const sourceRef = sanitizeSourceRef(
      valueAt(rawAdmission, 'source_ref'),
      sourceKind,
      projectId,
      conversationId,
      sourceTreeDigest,
    );
    const sourceRefDigest = safeDigest(valueAt(rawAdmission, 'source_ref_digest'));
    if (sourceRefDigest !== sha256Canonical(sourceRef)) fail();
    const selectedEntryPath = safeEntryPath(valueAt(rawAdmission, 'selected_entry_path'));
    const selectedEntry = findEntry(sourceTree, selectedEntryPath);
    const selectedEntryDigest = safeDigest(valueAt(rawAdmission, 'selected_entry_digest'));
    if (selectedEntryDigest !== selectedEntry.content_digest) fail();
    const admittedAtMs = safeTimestamp(valueAt(rawAdmission, 'admitted_at_ms'));
    const admission = {
      admission_version: valueAt(rawAdmission, 'admission_version'),
      admission_id: valueAt(rawAdmission, 'admission_id'),
      project_id: projectId,
      conversation_id: conversationId,
      source_kind: sourceKind,
      preview_kind: safeEnum(valueAt(rawAdmission, 'preview_kind'), PREVIEW_KINDS),
      source_tree_digest: sourceTreeDigest,
      source_ref_digest: sourceRefDigest,
      source_ref: sourceRef,
      selected_entry_path: selectedEntryPath,
      selected_entry_digest: selectedEntryDigest,
      source_tree: sourceTree,
      admitted_at_ms: admittedAtMs,
      expires_at_ms: safeExpiresAt(valueAt(rawAdmission, 'expires_at_ms'), admittedAtMs),
      lifecycle: assertAuthority(valueAt(rawAdmission, 'lifecycle'), LIFECYCLE, LIFECYCLE_KEYS),
      authority: assertAuthority(valueAt(rawAdmission, 'authority'), AUTHORITY, AUTHORITY_KEYS),
    };
    if (admission.admission_version !== BUILDER_LIVE_PREVIEW_SOURCE_ADMISSION_VERSION) fail();
    if (admission.admission_id !== idFor('builder-live-preview-source-admission', bodyFor(admission))) {
      fail();
    }
    return freezeDeep(admission);
  } catch (error) {
    if (error instanceof BuilderLivePreviewSourceAdmissionError) throw error;
    throw fail();
  }
}

module.exports = freezeDeep({
  BUILDER_LIVE_PREVIEW_SOURCE_ADMISSION_VERSION,
  BuilderLivePreviewSourceAdmissionError,
  createBuilderLivePreviewSourceAdmission,
  sanitizeBuilderLivePreviewSourceAdmission,
});
