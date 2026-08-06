'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const BUILDER_HANDOFF_PACKET_VERSION = 'builder-handoff-packet.v1';

const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const THREAD_ID_PATTERN = new RegExp(`^builder-session:${UUID_SOURCE}$`, 'u');
const TASK_ADDRESS_ID_PATTERN = new RegExp(`^builder-task-address:${UUID_SOURCE}$`, 'u');
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const UNSAFE_UNICODE_FORMAT_PATTERN = /[\p{Cf}\p{Bidi_Control}]/u;
const LOCAL_PATH_PATTERN = /(?:file:\/{1,3}|\\\\|(?:^|[\s"'`=(,:])(?:[A-Za-z]:[\\/]|~[\\/]|\/(?!\/)[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*))/iu;
const CREDENTIAL_PATTERN = /(?:["'`]?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|password|secret|credential|client[_-]?secret|private[_-]?key)["'`]?\s*[:=]\s*(?!["'`]?\s*(?:null|undefined)\b)\S|\b(?:basic|bearer)\s+[A-Za-z0-9._~+/=-]{16,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|https?:\/\/[^\s/:@]+:[^\s/@]+@|\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16})\b)/iu;

const INPUT_KEYS = Object.freeze([
  'source_thread_id',
  'source_task_address_id',
  'target_thread_id',
  'inserted_by',
  'summary',
  'decisions',
  'open_questions',
  'changed_files',
  'commit_refs',
  'verification_evidence',
  'requested_next_action',
  'authority_claims',
  'source_refs',
  'inserted_at_ms',
]);
const PACKET_KEYS = Object.freeze([
  'packet_version',
  'handoff_id',
  'source_thread_id',
  'source_task_address_id',
  'target_thread_id',
  'inserted_by',
  'summary',
  'decisions',
  'open_questions',
  'changed_files',
  'commit_refs',
  'verification_evidence',
  'requested_next_action',
  'authority_claims',
  'source_refs',
  'digest',
  'inserted_at_ms',
  'authority',
]);
const CHANGED_FILE_KEYS = Object.freeze(['path', 'change_kind', 'file_digest']);
const COMMIT_REF_KEYS = Object.freeze(['ref_kind', 'ref_digest']);
const VERIFICATION_EVIDENCE_KEYS = Object.freeze(['evidence_kind', 'status', 'evidence_digest', 'summary']);
const AUTHORITY_CLAIM_KEYS = Object.freeze(['claim_kind', 'classification', 'summary']);
const SOURCE_REF_KEYS = Object.freeze(['source_kind', 'source_digest']);
const AUTHORITY_KEYS = Object.freeze([
  'handoff_authority',
  'renderer_authority',
  'sqlite_write',
  'provider_dispatch',
  'tool_dispatch',
  'source_mutation',
  'git_mutation',
  'permission_grant',
  'plan_approval',
  'publication',
  'credential_access',
  'readiness_authority',
]);

const INSERTED_BY = Object.freeze(['local_user', 'assistant', 'subagent', 'system']);
const CHANGE_KINDS = Object.freeze(['added', 'modified', 'deleted', 'renamed']);
const COMMIT_REF_KINDS = Object.freeze(['project_revision', 'git_commit', 'work_capsule', 'artifact']);
const VERIFICATION_KINDS = Object.freeze(['test', 'lint', 'preview', 'review', 'manual']);
const VERIFICATION_STATUSES = Object.freeze(['passed', 'failed', 'not_run', 'unknown']);
const CLAIM_KINDS = Object.freeze([
  'write_permission',
  'plan_approval',
  'publish',
  'delete',
  'network',
  'external_directory',
  'result_evidence',
  'context_only',
]);
const CLAIM_CLASSIFICATIONS = Object.freeze(['informational', 'requires_confirmation', 'unsafe']);
const SOURCE_KINDS = Object.freeze([
  'public_summary',
  'approved_artifact',
  'saved_revision',
  'work_capsule',
  'delegated_result',
  'explicit_export',
]);
const AUTHORITY = Object.freeze({
  handoff_authority: 'main_handoff_packet_contract_v1',
  renderer_authority: 'not_present',
  sqlite_write: 'not_performed',
  provider_dispatch: 'not_performed',
  tool_dispatch: 'not_performed',
  source_mutation: 'not_performed',
  git_mutation: 'not_performed',
  permission_grant: 'not_performed',
  plan_approval: 'not_performed',
  publication: 'not_performed',
  credential_access: 'not_present',
  readiness_authority: 'not_authoritative_for_readiness',
});

const ERROR_MESSAGE = 'Builder handoff packet could not be verified.';

class BuilderHandoffPacketError extends Error {
  constructor() {
    super(ERROR_MESSAGE);
    this.name = 'BuilderHandoffPacketError';
    this.code = 'builder_handoff_packet_invalid';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderHandoffPacketError();
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
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== keys.length
    || actual.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) fail();
  for (const key of actual) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  }
}

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  return descriptor.value;
}

function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(valueAt(value, key))}`
    )).join(',')}}`;
  }
  fail();
}

function digestId(prefix, body) {
  return `${prefix}:${nodeCrypto.createHash('sha256').update(canonicalJson(body), 'utf8').digest('hex')}`;
}

function digest(body) {
  return `sha256:${nodeCrypto.createHash('sha256').update(canonicalJson(body), 'utf8').digest('hex')}`;
}

function safePattern(value, pattern, maximum) {
  if (typeof value !== 'string' || value.length > maximum || !pattern.test(value)) fail();
  return value;
}

function safeThreadId(value) {
  return safePattern(value, THREAD_ID_PATTERN, 96);
}

function safeTaskAddressId(value) {
  return safePattern(value, TASK_ADDRESS_ID_PATTERN, 96);
}

function safeDigest(value) {
  return safePattern(value, DIGEST_PATTERN, 80);
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail();
  return value;
}

function safeEnum(value, allowed) {
  if (typeof value !== 'string' || !allowed.includes(value)) fail();
  return value;
}

function hasUnpairedSurrogate(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function hasControl(value, allowFormatting) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (
      code <= 0x1f
      && !(allowFormatting && (code === 0x09 || code === 0x0a || code === 0x0d))
    ) return true;
    if (code === 0x7f) return true;
  }
  return UNSAFE_UNICODE_FORMAT_PATTERN.test(value);
}

function safeText(value, maximumCodePoints, maximumBytes, allowFormatting) {
  if (
    typeof value !== 'string'
    || value.length > maximumCodePoints * 2
    || value.length === 0
    || value.trim() !== value
    || value.normalize('NFC') !== value
    || hasUnpairedSurrogate(value)
    || hasControl(value, allowFormatting)
    || Array.from(value).length > maximumCodePoints
    || Buffer.byteLength(value, 'utf8') > maximumBytes
    || LOCAL_PATH_PATTERN.test(value.normalize('NFKC'))
    || CREDENTIAL_PATTERN.test(value.normalize('NFKC'))
  ) fail();
  return value;
}

function safeNullableText(value, maximumCodePoints, maximumBytes, allowFormatting) {
  if (value === null) return null;
  return safeText(value, maximumCodePoints, maximumBytes, allowFormatting);
}

function safeTextArray(value, maximumItems, maximumCodePoints, maximumBytes) {
  if (!Array.isArray(value) || utilTypes.isProxy(value) || value.length > maximumItems) fail();
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key === 'symbol') || keys.length !== value.length + 1) fail();
  const items = [];
  const seen = new Set();
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
    const item = safeText(descriptor.value, maximumCodePoints, maximumBytes, true);
    if (seen.has(item)) fail();
    seen.add(item);
    items.push(item);
  }
  return freezeDeep(items);
}

function safeRelativePath(value) {
  const text = safeText(value, 240, 960, false);
  if (
    text.startsWith('/')
    || text.startsWith('\\')
    || /^[A-Za-z]:[\\/]/u.test(text)
    || text.split(/[\\/]/u).some((part) => part === '..' || part === '')
  ) fail();
  return text.replaceAll('\\', '/');
}

function sanitizeChangedFile(value) {
  exactObject(value, CHANGED_FILE_KEYS);
  return freezeDeep({
    path: safeRelativePath(valueAt(value, 'path')),
    change_kind: safeEnum(valueAt(value, 'change_kind'), CHANGE_KINDS),
    file_digest: safeDigest(valueAt(value, 'file_digest')),
  });
}

function sanitizeCommitRef(value) {
  exactObject(value, COMMIT_REF_KEYS);
  return freezeDeep({
    ref_kind: safeEnum(valueAt(value, 'ref_kind'), COMMIT_REF_KINDS),
    ref_digest: safeDigest(valueAt(value, 'ref_digest')),
  });
}

function sanitizeVerificationEvidence(value) {
  exactObject(value, VERIFICATION_EVIDENCE_KEYS);
  return freezeDeep({
    evidence_kind: safeEnum(valueAt(value, 'evidence_kind'), VERIFICATION_KINDS),
    status: safeEnum(valueAt(value, 'status'), VERIFICATION_STATUSES),
    evidence_digest: safeDigest(valueAt(value, 'evidence_digest')),
    summary: safeText(valueAt(value, 'summary'), 240, 960, false),
  });
}

function sanitizeAuthorityClaim(value) {
  exactObject(value, AUTHORITY_CLAIM_KEYS);
  return freezeDeep({
    claim_kind: safeEnum(valueAt(value, 'claim_kind'), CLAIM_KINDS),
    classification: safeEnum(valueAt(value, 'classification'), CLAIM_CLASSIFICATIONS),
    summary: safeText(valueAt(value, 'summary'), 240, 960, false),
  });
}

function sanitizeSourceRef(value) {
  exactObject(value, SOURCE_REF_KEYS);
  return freezeDeep({
    source_kind: safeEnum(valueAt(value, 'source_kind'), SOURCE_KINDS),
    source_digest: safeDigest(valueAt(value, 'source_digest')),
  });
}

function safeObjectArray(value, maximumItems, sanitize, keyFor) {
  if (!Array.isArray(value) || utilTypes.isProxy(value) || value.length > maximumItems) fail();
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key === 'symbol') || keys.length !== value.length + 1) fail();
  const items = [];
  const seen = new Set();
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
    const item = sanitize(descriptor.value);
    const key = keyFor(item);
    if (seen.has(key)) fail();
    seen.add(key);
    items.push(item);
  }
  return freezeDeep(items);
}

function sanitizeAuthority(value) {
  exactObject(value, AUTHORITY_KEYS);
  if (canonicalJson(value) !== canonicalJson(AUTHORITY)) fail();
  return { ...AUTHORITY };
}

function buildBody(rawInput) {
  exactObject(rawInput, INPUT_KEYS);
  const sourceThreadId = safeThreadId(valueAt(rawInput, 'source_thread_id'));
  const targetThreadId = safeThreadId(valueAt(rawInput, 'target_thread_id'));
  if (sourceThreadId === targetThreadId) fail();
  return freezeDeep({
    source_thread_id: sourceThreadId,
    source_task_address_id: safeTaskAddressId(valueAt(rawInput, 'source_task_address_id')),
    target_thread_id: targetThreadId,
    inserted_by: safeEnum(valueAt(rawInput, 'inserted_by'), INSERTED_BY),
    summary: safeText(valueAt(rawInput, 'summary'), 2_048, 8_192, true),
    decisions: safeTextArray(valueAt(rawInput, 'decisions'), 24, 512, 2_048),
    open_questions: safeTextArray(valueAt(rawInput, 'open_questions'), 16, 512, 2_048),
    changed_files: safeObjectArray(
      valueAt(rawInput, 'changed_files'),
      32,
      sanitizeChangedFile,
      (item) => item.path,
    ),
    commit_refs: safeObjectArray(
      valueAt(rawInput, 'commit_refs'),
      16,
      sanitizeCommitRef,
      (item) => `${item.ref_kind}:${item.ref_digest}`,
    ),
    verification_evidence: safeObjectArray(
      valueAt(rawInput, 'verification_evidence'),
      16,
      sanitizeVerificationEvidence,
      (item) => `${item.evidence_kind}:${item.evidence_digest}`,
    ),
    requested_next_action: safeNullableText(valueAt(rawInput, 'requested_next_action'), 512, 2_048, true),
    authority_claims: safeObjectArray(
      valueAt(rawInput, 'authority_claims'),
      16,
      sanitizeAuthorityClaim,
      (item) => `${item.claim_kind}:${item.classification}:${item.summary}`,
    ),
    source_refs: safeObjectArray(
      valueAt(rawInput, 'source_refs'),
      32,
      sanitizeSourceRef,
      (item) => `${item.source_kind}:${item.source_digest}`,
    ),
    inserted_at_ms: safeTimestamp(valueAt(rawInput, 'inserted_at_ms')),
    authority: { ...AUTHORITY },
  });
}

function createBuilderHandoffPacket(rawInput) {
  const body = buildBody(rawInput);
  return freezeDeep({
    packet_version: BUILDER_HANDOFF_PACKET_VERSION,
    handoff_id: digestId('builder-handoff-packet', body),
    ...body,
    digest: digest(body),
  });
}

function sanitizeBuilderHandoffPacket(value) {
  exactObject(value, PACKET_KEYS);
  if (valueAt(value, 'packet_version') !== BUILDER_HANDOFF_PACKET_VERSION) fail();
  const body = freezeDeep({
    source_thread_id: safeThreadId(valueAt(value, 'source_thread_id')),
    source_task_address_id: safeTaskAddressId(valueAt(value, 'source_task_address_id')),
    target_thread_id: safeThreadId(valueAt(value, 'target_thread_id')),
    inserted_by: safeEnum(valueAt(value, 'inserted_by'), INSERTED_BY),
    summary: safeText(valueAt(value, 'summary'), 2_048, 8_192, true),
    decisions: safeTextArray(valueAt(value, 'decisions'), 24, 512, 2_048),
    open_questions: safeTextArray(valueAt(value, 'open_questions'), 16, 512, 2_048),
    changed_files: safeObjectArray(valueAt(value, 'changed_files'), 32, sanitizeChangedFile, (item) => item.path),
    commit_refs: safeObjectArray(
      valueAt(value, 'commit_refs'),
      16,
      sanitizeCommitRef,
      (item) => `${item.ref_kind}:${item.ref_digest}`,
    ),
    verification_evidence: safeObjectArray(
      valueAt(value, 'verification_evidence'),
      16,
      sanitizeVerificationEvidence,
      (item) => `${item.evidence_kind}:${item.evidence_digest}`,
    ),
    requested_next_action: safeNullableText(valueAt(value, 'requested_next_action'), 512, 2_048, true),
    authority_claims: safeObjectArray(
      valueAt(value, 'authority_claims'),
      16,
      sanitizeAuthorityClaim,
      (item) => `${item.claim_kind}:${item.classification}:${item.summary}`,
    ),
    source_refs: safeObjectArray(
      valueAt(value, 'source_refs'),
      32,
      sanitizeSourceRef,
      (item) => `${item.source_kind}:${item.source_digest}`,
    ),
    inserted_at_ms: safeTimestamp(valueAt(value, 'inserted_at_ms')),
    authority: sanitizeAuthority(valueAt(value, 'authority')),
  });
  if (body.source_thread_id === body.target_thread_id) fail();
  if (
    valueAt(value, 'digest') !== digest(body)
    || valueAt(value, 'handoff_id') !== digestId('builder-handoff-packet', body)
  ) fail();
  return freezeDeep({
    packet_version: BUILDER_HANDOFF_PACKET_VERSION,
    handoff_id: valueAt(value, 'handoff_id'),
    ...body,
    digest: valueAt(value, 'digest'),
  });
}

module.exports = Object.freeze({
  BUILDER_HANDOFF_PACKET_VERSION,
  HANDOFF_PACKET_AUTHORITY: AUTHORITY,
  BuilderHandoffPacketError,
  createBuilderHandoffPacket,
  sanitizeBuilderHandoffPacket,
});
