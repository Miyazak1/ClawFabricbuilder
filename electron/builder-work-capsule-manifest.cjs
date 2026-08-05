'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const {
  sanitizeBuilderSessionAddress,
  sanitizeBuilderTaskAddress,
} = require('./builder-session-task-address.cjs');

const BUILDER_WORK_CAPSULE_MANIFEST_VERSION = 'builder-work-capsule-manifest.v1';
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const PROJECT_ID_PATTERN = new RegExp(`^builder-project:${UUID_SOURCE}$`, 'u');
const CONVERSATION_ID_PATTERN = new RegExp(`^builder-conversation:${UUID_SOURCE}$`, 'u');
const TURN_ID_PATTERN = new RegExp(`^builder-turn:${UUID_SOURCE}$`, 'u');
const REQUEST_ID_PATTERN = new RegExp(`^builder-git-request:${UUID_SOURCE}$`, 'u');
const TASK_ID_PATTERN = new RegExp(`^builder-task:${UUID_SOURCE}$`, 'u');
const RUN_ID_PATTERN = new RegExp(`^builder-run:${UUID_SOURCE}$`, 'u');
const REVIEW_ID_PATTERN = new RegExp(`^builder-review:${UUID_SOURCE}$`, 'u');
const ARTIFACT_ID_PATTERN = /^builder-artifact:[0-9a-f]{64}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const MAX_ARTIFACT_REFS = 8;
const MAX_TEXT_LENGTH = 2_048;

const INPUT_KEYS = Object.freeze([
  'project_revision',
  'artifact_refs',
  'review_decision',
  'verification_summary',
  'public_summary',
  'remix_metadata',
  'session_address',
  'task_address',
  'created_at_ms',
]);
const PROJECT_REVISION_KEYS = Object.freeze([
  'project_id',
  'revision_receipt_digest',
  'revision_number',
  'previous_revision_receipt_digest',
  'title',
  'summary',
  'conversation_id',
  'turn_id',
  'request_id',
  'candidate_id',
  'candidate_digest',
  'resulting_tree_digest',
  'semantic_identity_digest',
  'verification_receipt_digest',
  'task_id',
  'run_id',
  'review_id',
  'selected_at_ms',
]);
const ARTIFACT_REF_KEYS = Object.freeze([
  'artifact_id',
  'artifact_kind',
  'title',
  'summary',
  'preview_digest',
]);
const REVIEW_DECISION_KEYS = Object.freeze([
  'review_id',
  'decision',
  'reviewed_at_ms',
  'decision_summary',
]);
const VERIFICATION_SUMMARY_KEYS = Object.freeze([
  'verification_receipt_digest',
  'status',
  'summary',
]);
const PUBLIC_SUMMARY_KEYS = Object.freeze([
  'title',
  'description',
  'what_changed',
  'how_to_continue',
]);
const REMIX_METADATA_KEYS = Object.freeze([
  'source_capsule_id',
  'parent_revision_receipt_digest',
  'compatibility_notes',
  'license_intent',
]);
const LIFECYCLE = Object.freeze({
  manifest_authority: 'main_local_work_capsule_manifest_contract_v1',
  sqlite_read: 'provided_by_caller',
  sqlite_write: 'not_performed',
  git_read: 'provided_by_caller',
  git_write: 'not_performed',
  export_materialization: 'not_performed',
  renderer_authority: 'not_present',
  provider_dispatch: 'not_performed',
  source_mutation: 'not_performed',
  permission_grant: 'not_performed',
  network_access: 'not_present',
  publication: 'not_performed',
  autonomous_experiment: 'not_performed',
});
const ERROR_MESSAGE = 'Builder Work Capsule manifest could not be verified.';

class BuilderWorkCapsuleManifestError extends Error {
  constructor() {
    super(ERROR_MESSAGE);
    this.name = 'BuilderWorkCapsuleManifestError';
    this.code = 'builder_work_capsule_manifest_invalid';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderWorkCapsuleManifestError();
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

function manifestIdFor(body) {
  return `builder-work-capsule:${nodeCrypto.createHash('sha256')
    .update(canonicalJson(body), 'utf8')
    .digest('hex')}`;
}

function safePattern(value, pattern, maximum) {
  if (typeof value !== 'string' || value.length > maximum || !pattern.test(value)) fail();
  return value;
}

function safeProjectId(value) {
  return safePattern(value, PROJECT_ID_PATTERN, 64);
}

function safeConversationId(value) {
  return safePattern(value, CONVERSATION_ID_PATTERN, 96);
}

function safeTurnId(value) {
  return safePattern(value, TURN_ID_PATTERN, 80);
}

function safeRequestId(value) {
  return safePattern(value, REQUEST_ID_PATTERN, 87);
}

function safeTaskId(value) {
  return safePattern(value, TASK_ID_PATTERN, 88);
}

function safeRunId(value) {
  return safePattern(value, RUN_ID_PATTERN, 88);
}

function safeReviewId(value) {
  return safePattern(value, REVIEW_ID_PATTERN, 91);
}

function safeArtifactId(value) {
  return safePattern(value, ARTIFACT_ID_PATTERN, 81);
}

function safeDigest(value) {
  return safePattern(value, DIGEST_PATTERN, 71);
}

function safeNullableDigest(value) {
  if (value === null) return null;
  return safeDigest(value);
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail();
  return value;
}

function hasControlCharacter(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function safeText(value, maximum = MAX_TEXT_LENGTH) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > maximum
    || value.trim() !== value
    || hasControlCharacter(value)
  ) fail();
  return value;
}

function safeNullableText(value, maximum) {
  if (value === null) return null;
  return safeText(value, maximum);
}

function safePositiveInteger(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 1_000_000) fail();
  return value;
}

function sanitizeProjectRevision(value) {
  exactObject(value, PROJECT_REVISION_KEYS);
  return freezeDeep({
    project_id: safeProjectId(valueAt(value, 'project_id')),
    revision_receipt_digest: safeDigest(valueAt(value, 'revision_receipt_digest')),
    revision_number: safePositiveInteger(valueAt(value, 'revision_number')),
    previous_revision_receipt_digest: safeNullableDigest(valueAt(value, 'previous_revision_receipt_digest')),
    title: safeText(valueAt(value, 'title'), 80),
    summary: safeText(valueAt(value, 'summary'), 400),
    conversation_id: safeConversationId(valueAt(value, 'conversation_id')),
    turn_id: safeTurnId(valueAt(value, 'turn_id')),
    request_id: safeRequestId(valueAt(value, 'request_id')),
    candidate_id: safePattern(
      valueAt(value, 'candidate_id'),
      /^builder-code-change-candidate:[0-9a-f]{64}$/u,
      94,
    ),
    candidate_digest: safeDigest(valueAt(value, 'candidate_digest')),
    resulting_tree_digest: safeDigest(valueAt(value, 'resulting_tree_digest')),
    semantic_identity_digest: safeDigest(valueAt(value, 'semantic_identity_digest')),
    verification_receipt_digest: safeDigest(valueAt(value, 'verification_receipt_digest')),
    task_id: safeTaskId(valueAt(value, 'task_id')),
    run_id: safeRunId(valueAt(value, 'run_id')),
    review_id: safeReviewId(valueAt(value, 'review_id')),
    selected_at_ms: safeTimestamp(valueAt(value, 'selected_at_ms')),
  });
}

function denseArray(value, limit) {
  if (!Array.isArray(value) || utilTypes.isProxy(value) || value.length < 1 || value.length > limit) fail();
  const keys = Reflect.ownKeys(value);
  const expected = new Set(['length', ...Array.from({ length: value.length }, (_, index) => String(index))]);
  if (keys.length !== expected.size || keys.some((key) => typeof key === 'symbol' || !expected.has(key))) fail();
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  }
  return value;
}

function sanitizeArtifactRef(value) {
  exactObject(value, ARTIFACT_REF_KEYS);
  const artifactKind = valueAt(value, 'artifact_kind');
  if (!['static_preview', 'changes_summary', 'source_snapshot', 'verification_report'].includes(artifactKind)) fail();
  return freezeDeep({
    artifact_id: safeArtifactId(valueAt(value, 'artifact_id')),
    artifact_kind: artifactKind,
    title: safeText(valueAt(value, 'title'), 120),
    summary: safeText(valueAt(value, 'summary'), 400),
    preview_digest: safeDigest(valueAt(value, 'preview_digest')),
  });
}

function sanitizeArtifactRefs(value) {
  const refs = denseArray(value, MAX_ARTIFACT_REFS).map(sanitizeArtifactRef);
  const seen = new Set();
  for (const ref of refs) {
    if (seen.has(ref.artifact_id)) fail();
    seen.add(ref.artifact_id);
  }
  return freezeDeep(refs);
}

function sanitizeReviewDecision(value) {
  exactObject(value, REVIEW_DECISION_KEYS);
  const decision = valueAt(value, 'decision');
  if (decision !== 'accepted') fail();
  return freezeDeep({
    review_id: safeReviewId(valueAt(value, 'review_id')),
    decision,
    reviewed_at_ms: safeTimestamp(valueAt(value, 'reviewed_at_ms')),
    decision_summary: safeText(valueAt(value, 'decision_summary'), 240),
  });
}

function sanitizeVerificationSummary(value) {
  exactObject(value, VERIFICATION_SUMMARY_KEYS);
  const status = valueAt(value, 'status');
  if (!['verified', 'verified_with_warnings'].includes(status)) fail();
  return freezeDeep({
    verification_receipt_digest: safeDigest(valueAt(value, 'verification_receipt_digest')),
    status,
    summary: safeText(valueAt(value, 'summary'), 400),
  });
}

function sanitizePublicSummary(value) {
  exactObject(value, PUBLIC_SUMMARY_KEYS);
  return freezeDeep({
    title: safeText(valueAt(value, 'title'), 120),
    description: safeText(valueAt(value, 'description'), 800),
    what_changed: safeText(valueAt(value, 'what_changed'), 800),
    how_to_continue: safeText(valueAt(value, 'how_to_continue'), 800),
  });
}

function safeCapsuleId(value) {
  if (value === null) return null;
  return safePattern(value, /^builder-work-capsule:[0-9a-f]{64}$/u, 85);
}

function sanitizeRemixMetadata(value) {
  exactObject(value, REMIX_METADATA_KEYS);
  return freezeDeep({
    source_capsule_id: safeCapsuleId(valueAt(value, 'source_capsule_id')),
    parent_revision_receipt_digest: safeNullableDigest(valueAt(value, 'parent_revision_receipt_digest')),
    compatibility_notes: safeNullableText(valueAt(value, 'compatibility_notes'), 800),
    license_intent: safeNullableText(valueAt(value, 'license_intent'), 120),
  });
}

function assertBindings({
  projectRevision,
  reviewDecision,
  verificationSummary,
  sessionAddress,
  taskAddress,
  createdAtMs,
}) {
  if (
    taskAddress.project_id !== projectRevision.project_id
    || taskAddress.session_id !== sessionAddress.session_id
    || taskAddress.conversation_id !== projectRevision.conversation_id
    || taskAddress.produced_revision_receipt_digest !== projectRevision.revision_receipt_digest
    || sessionAddress.project_id !== projectRevision.project_id
    || sessionAddress.root_conversation_id !== projectRevision.conversation_id
    || sessionAddress.status !== 'active'
    || sessionAddress.current_task_id !== taskAddress.task_address_id
    || !['completed', 'archived'].includes(taskAddress.status)
    || taskAddress.closed_at_ms === null
    || taskAddress.closed_at_ms > createdAtMs
    || projectRevision.selected_at_ms > createdAtMs
    || reviewDecision.review_id !== projectRevision.review_id
    || reviewDecision.reviewed_at_ms > createdAtMs
    || verificationSummary.verification_receipt_digest !== projectRevision.verification_receipt_digest
  ) fail();
}

function createBuilderWorkCapsuleManifest(rawInput) {
  exactObject(rawInput, INPUT_KEYS);
  const projectRevision = sanitizeProjectRevision(valueAt(rawInput, 'project_revision'));
  const artifactRefs = sanitizeArtifactRefs(valueAt(rawInput, 'artifact_refs'));
  const reviewDecision = sanitizeReviewDecision(valueAt(rawInput, 'review_decision'));
  const verificationSummary = sanitizeVerificationSummary(valueAt(rawInput, 'verification_summary'));
  const publicSummary = sanitizePublicSummary(valueAt(rawInput, 'public_summary'));
  const remixMetadata = sanitizeRemixMetadata(valueAt(rawInput, 'remix_metadata'));
  const sessionAddress = sanitizeBuilderSessionAddress(valueAt(rawInput, 'session_address'));
  const taskAddress = sanitizeBuilderTaskAddress(valueAt(rawInput, 'task_address'));
  const createdAtMs = safeTimestamp(valueAt(rawInput, 'created_at_ms'));
  assertBindings({
    projectRevision,
    reviewDecision,
    verificationSummary,
    sessionAddress,
    taskAddress,
    createdAtMs,
  });
  const body = freezeDeep({
    capsule_kind: 'local_work_capsule_manifest',
    project_id: projectRevision.project_id,
    session_id: sessionAddress.session_id,
    task_address_id: taskAddress.task_address_id,
    revision_receipt_digest: projectRevision.revision_receipt_digest,
    revision_number: projectRevision.revision_number,
    artifact_refs: artifactRefs,
    review_decision_ref: {
      review_id: reviewDecision.review_id,
      decision: reviewDecision.decision,
      reviewed_at_ms: reviewDecision.reviewed_at_ms,
      decision_summary: reviewDecision.decision_summary,
    },
    verification_summary: verificationSummary,
    public_summary: publicSummary,
    remix_metadata: remixMetadata,
    provenance: {
      source_authority: 'git_project_revision_and_sqlite_product_facts',
      project_revision_selected_at_ms: projectRevision.selected_at_ms,
      task_closed_at_ms: taskAddress.closed_at_ms,
      created_at_ms: createdAtMs,
    },
    lifecycle: { ...LIFECYCLE },
  });
  return freezeDeep({
    manifest_version: BUILDER_WORK_CAPSULE_MANIFEST_VERSION,
    capsule_id: manifestIdFor(body),
    ...body,
  });
}

module.exports = {
  BUILDER_WORK_CAPSULE_MANIFEST_VERSION,
  BuilderWorkCapsuleManifestError,
  createBuilderWorkCapsuleManifest,
};
