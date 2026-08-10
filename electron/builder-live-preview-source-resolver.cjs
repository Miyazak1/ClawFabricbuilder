'use strict';

const { types: utilTypes } = require('node:util');

const {
  sanitizeBuilderGitCandidateReceiptPair,
} = require('./builder-git-receipt-contract.cjs');
const {
  BUILDER_GIT_VERIFIED_CANDIDATE_READ_RESULT_VERSION,
} = require('./builder-git-project-repository.cjs');
const {
  sanitizeBuilderProjectSourceTree,
} = require('./builder-project-source-tree.cjs');

const BUILDER_LIVE_PREVIEW_SOURCE_RESOLVER_VERSION =
  'builder-live-preview-source-resolver.v1';
const BUILDER_LIVE_PREVIEW_SOURCE_RESOLVER_RESULT_VERSION =
  'builder-live-preview-source-resolver-result.v1';
const BUILDER_LIVE_PREVIEW_SOURCE_SNAPSHOT_VERSION =
  'builder-live-preview-source-snapshot.v1';
const BUILDER_AUTOMATIC_DRAFT_CHECKPOINT_SERVICE_VERSION =
  'builder-automatic-draft-checkpoint-service.v1';
const BUILDER_PROJECT_READ_RESULT_VERSION = 'builder-project-read-result.v1';
const OPTION_KEYS = Object.freeze([
  'automatic_draft_checkpoint_service',
  'git_authority',
  'project_read_authority',
]);
const CURRENT_DRAFT_KEYS = Object.freeze([
  'project_id',
  'conversation_id',
  'candidate_receipt',
  'candidate_verification',
]);
const SAVED_REVISION_KEYS = Object.freeze([
  'project_id',
  'conversation_id',
  'revision_receipt_digest',
]);
const GIT_READ_KEYS = Object.freeze([
  'result_version',
  'candidate_receipt',
  'verification_receipt',
  'source_tree',
  'code_authority',
  'read_admission',
]);
const CHECKPOINT_VERIFICATION_KEYS = Object.freeze([
  'result_version',
  'service_version',
  'operation',
  'status',
  'checkpoint_ref',
  'verification_admission',
]);
const CHECKPOINT_REF_KEYS = Object.freeze([
  'checkpoint_id',
  'checkpoint_sequence',
  'candidate_id',
  'candidate_digest',
  'resulting_tree_digest',
]);
const PROJECT_READ_KEYS = Object.freeze([
  'result_version',
  'product_revision_receipt',
  'current',
  'source_tree',
  'git_candidate_receipt',
  'git_verification_receipt',
  'authority_evidence',
  'operation',
]);
const PROJECT_ID_PATTERN =
  /^builder-project:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CONVERSATION_ID_PATTERN =
  /^builder-conversation:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CHECKPOINT_ID_PATTERN = /^builder-draft-checkpoint:[0-9a-f]{64}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;

class BuilderLivePreviewSourceResolverError extends Error {
  constructor() {
    super('Live preview source could not be resolved.');
    this.name = 'BuilderLivePreviewSourceResolverError';
    this.code = 'builder_live_preview_source_resolver_invalid';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderLivePreviewSourceResolverError();
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
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== keys.length
    || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) fail();
  for (const key of ownKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  }
}

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  return descriptor.value;
}

function safePattern(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) fail();
  return value;
}

function safeProjectId(value) {
  return safePattern(value, PROJECT_ID_PATTERN);
}

function safeConversationId(value) {
  return safePattern(value, CONVERSATION_ID_PATTERN);
}

function safeDigest(value) {
  return safePattern(value, DIGEST_PATTERN);
}

function ownMethod(value, method) {
  if (!isPlainObject(value)) return null;
  const descriptor = Object.getOwnPropertyDescriptor(value, method);
  if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') {
    return null;
  }
  return descriptor.value;
}

function unavailable(operation, sourceKind, reason) {
  return freezeDeep({
    result_version: BUILDER_LIVE_PREVIEW_SOURCE_RESOLVER_RESULT_VERSION,
    resolver_version: BUILDER_LIVE_PREVIEW_SOURCE_RESOLVER_VERSION,
    operation,
    source_kind: sourceKind,
    status: 'unavailable',
    unavailable_reason: reason,
    preview_source_snapshot: null,
  });
}

function authority() {
  return freezeDeep({
    source_resolver_authority: 'main_owned_live_preview_source_resolver_v1',
    renderer_source_tree: 'not_accepted',
    renderer_path_or_url: 'not_accepted',
    git_read: 'existing_authority_verified_candidate_only',
    sqlite_read: 'existing_revision_or_checkpoint_authority_only',
    source_write: 'not_performed',
    git_write: 'not_performed',
    sqlite_write: 'not_performed',
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

function sanitizeGitReadResult(value, expectedReceipt) {
  exactObject(value, GIT_READ_KEYS);
  if (
    valueAt(value, 'result_version') !== BUILDER_GIT_VERIFIED_CANDIDATE_READ_RESULT_VERSION
    || valueAt(value, 'code_authority') !== 'git_commit_tree'
    || valueAt(value, 'read_admission') !== 'verified'
  ) fail();
  const pair = sanitizeBuilderGitCandidateReceiptPair(
    valueAt(value, 'candidate_receipt'),
    valueAt(value, 'verification_receipt'),
  );
  const sourceTree = sanitizeBuilderProjectSourceTree(valueAt(value, 'source_tree'));
  if (
    JSON.stringify(pair.candidate_receipt) !== JSON.stringify(expectedReceipt)
    || sourceTree.source_tree_digest !== expectedReceipt.resulting_tree_digest
  ) fail();
  return freezeDeep({
    candidate_receipt: pair.candidate_receipt,
    verification_receipt: pair.verification_receipt,
    source_tree: sourceTree,
  });
}

function sanitizeCheckpointVerification(value, receipt) {
  exactObject(value, CHECKPOINT_VERIFICATION_KEYS);
  if (
    valueAt(value, 'service_version') !== BUILDER_AUTOMATIC_DRAFT_CHECKPOINT_SERVICE_VERSION
    || valueAt(value, 'operation') !== 'current_candidate_checkpoint_verified'
    || valueAt(value, 'status') !== 'verified'
    || valueAt(value, 'verification_admission') !== 'main_owned_latest_checkpoint_verified'
  ) fail();
  const ref = valueAt(value, 'checkpoint_ref');
  exactObject(ref, CHECKPOINT_REF_KEYS);
  const checkpointId = safePattern(valueAt(ref, 'checkpoint_id'), CHECKPOINT_ID_PATTERN);
  const checkpointSequence = valueAt(ref, 'checkpoint_sequence');
  if (!Number.isSafeInteger(checkpointSequence) || checkpointSequence < 1) fail();
  if (
    valueAt(ref, 'candidate_id') !== receipt.candidate_id
    || valueAt(ref, 'candidate_digest') !== receipt.candidate_digest
    || valueAt(ref, 'resulting_tree_digest') !== receipt.resulting_tree_digest
  ) fail();
  return freezeDeep({
    checkpoint_id: checkpointId,
    checkpoint_sequence: checkpointSequence,
    candidate_id: receipt.candidate_id,
    candidate_digest: receipt.candidate_digest,
    resulting_tree_digest: receipt.resulting_tree_digest,
  });
}

function sanitizeProjectReadResult(value, request) {
  exactObject(value, PROJECT_READ_KEYS);
  if (
    valueAt(value, 'result_version') !== BUILDER_PROJECT_READ_RESULT_VERSION
    || valueAt(value, 'operation') !== 'revision_loaded'
  ) fail();
  const receipt = valueAt(value, 'product_revision_receipt');
  if (!isPlainObject(receipt)) fail();
  const sourceTree = sanitizeBuilderProjectSourceTree(valueAt(value, 'source_tree'));
  const gitPair = sanitizeBuilderGitCandidateReceiptPair(
    valueAt(value, 'git_candidate_receipt'),
    valueAt(value, 'git_verification_receipt'),
  );
  if (
    valueAt(receipt, 'project_id') !== request.project_id
    || valueAt(receipt, 'conversation_id') !== request.conversation_id
    || valueAt(receipt, 'revision_receipt_digest') !== request.revision_receipt_digest
    || valueAt(receipt, 'resulting_tree_digest') !== sourceTree.source_tree_digest
    || gitPair.candidate_receipt.project_id !== request.project_id
    || gitPair.candidate_receipt.conversation_id !== request.conversation_id
    || gitPair.candidate_receipt.resulting_tree_digest !== sourceTree.source_tree_digest
    || gitPair.candidate_receipt.commit_oid !== valueAt(receipt, 'commit_oid')
    || gitPair.candidate_receipt.tree_oid !== valueAt(receipt, 'tree_oid')
  ) fail();
  const evidence = valueAt(value, 'authority_evidence');
  if (
    !isPlainObject(evidence)
    || valueAt(evidence, 'product_authority') !== 'sqlite_product_revision_receipt'
    || valueAt(evidence, 'code_authority') !== 'git_commit_tree'
    || valueAt(evidence, 'source_read_admission') !== 'verified'
  ) fail();
  return freezeDeep({
    product_revision_receipt: receipt,
    source_tree: sourceTree,
    git_candidate_receipt: gitPair.candidate_receipt,
    git_verification_receipt: gitPair.verification_receipt,
  });
}

function ready(operation, sourceKind, sourceTree, sourceRef) {
  return freezeDeep({
    result_version: BUILDER_LIVE_PREVIEW_SOURCE_RESOLVER_RESULT_VERSION,
    resolver_version: BUILDER_LIVE_PREVIEW_SOURCE_RESOLVER_VERSION,
    operation,
    source_kind: sourceKind,
    status: 'ready',
    unavailable_reason: null,
    preview_source_snapshot: {
      snapshot_version: BUILDER_LIVE_PREVIEW_SOURCE_SNAPSHOT_VERSION,
      source_kind: sourceKind,
      project_id: sourceRef.project_id,
      conversation_id: sourceRef.conversation_id,
      source_tree: sourceTree,
      source_tree_digest: sourceTree.source_tree_digest,
      source_ref: sourceRef,
      admission: {
        preview_source_admission: 'main_owned_verified_preview_source',
        source_tree_digest: sourceTree.source_tree_digest,
      },
      authority: authority(),
    },
  });
}

function createBuilderLivePreviewSourceResolver(rawOptions) {
  exactObject(rawOptions, OPTION_KEYS);
  const checkpointService = valueAt(rawOptions, 'automatic_draft_checkpoint_service');
  const gitAuthority = valueAt(rawOptions, 'git_authority');
  const projectReadAuthority = valueAt(rawOptions, 'project_read_authority');

  return freezeDeep({
    resolver_version: BUILDER_LIVE_PREVIEW_SOURCE_RESOLVER_VERSION,

    async resolveCurrentDraftPreviewSource(rawRequest) {
      exactObject(rawRequest, CURRENT_DRAFT_KEYS);
      const pair = sanitizeBuilderGitCandidateReceiptPair(
        valueAt(rawRequest, 'candidate_receipt'),
        valueAt(rawRequest, 'candidate_verification'),
      );
      const receipt = pair.candidate_receipt;
      const projectId = safeProjectId(valueAt(rawRequest, 'project_id'));
      const conversationId = safeConversationId(valueAt(rawRequest, 'conversation_id'));
      if (receipt.project_id !== projectId || receipt.conversation_id !== conversationId) fail();
      const verifyCheckpoint = ownMethod(checkpointService, 'verify_current_candidate_checkpoint');
      const readVerifiedCandidate = ownMethod(gitAuthority, 'read_verified_candidate');
      if (
        !verifyCheckpoint
        || !readVerifiedCandidate
        || !isPlainObject(checkpointService)
        || valueAt(checkpointService, 'service_version') !==
          BUILDER_AUTOMATIC_DRAFT_CHECKPOINT_SERVICE_VERSION
      ) {
        return unavailable(
          'current_draft_preview_source_resolved',
          'current_draft',
          'preview_source_authority_unavailable',
        );
      }
      let checkpoint;
      let gitRead;
      try {
        checkpoint = await Reflect.apply(verifyCheckpoint, checkpointService, [{
          project_id: projectId,
          conversation_id: conversationId,
          task_id: receipt.task_id,
          run_id: receipt.run_id,
          candidate_id: receipt.candidate_id,
          candidate_digest: receipt.candidate_digest,
          resulting_tree_digest: receipt.resulting_tree_digest,
        }]);
        gitRead = await Reflect.apply(readVerifiedCandidate, gitAuthority, [receipt]);
      } catch {
        return unavailable(
          'current_draft_preview_source_resolved',
          'current_draft',
          'preview_source_authority_unavailable',
        );
      }
      const checkpointRef = sanitizeCheckpointVerification(checkpoint, receipt);
      const verified = sanitizeGitReadResult(gitRead, receipt);
      return ready(
        'current_draft_preview_source_resolved',
        'current_draft',
        verified.source_tree,
        {
          source_ref_kind: 'current_draft_checkpoint_candidate',
          project_id: projectId,
          conversation_id: conversationId,
          checkpoint_id: checkpointRef.checkpoint_id,
          checkpoint_sequence: checkpointRef.checkpoint_sequence,
          candidate_id: receipt.candidate_id,
          candidate_digest: receipt.candidate_digest,
          resulting_tree_digest: receipt.resulting_tree_digest,
          commit_oid: receipt.commit_oid,
          tree_oid: receipt.tree_oid,
        },
      );
    },

    async resolveSavedRevisionPreviewSource(rawRequest) {
      exactObject(rawRequest, SAVED_REVISION_KEYS);
      const request = freezeDeep({
        project_id: safeProjectId(valueAt(rawRequest, 'project_id')),
        conversation_id: safeConversationId(valueAt(rawRequest, 'conversation_id')),
        revision_receipt_digest: safeDigest(valueAt(rawRequest, 'revision_receipt_digest')),
      });
      const loadRevision = ownMethod(projectReadAuthority, 'load_revision');
      if (!loadRevision) {
        return unavailable(
          'saved_revision_preview_source_resolved',
          'saved_revision',
          'preview_source_authority_unavailable',
        );
      }
      let loaded;
      try {
        loaded = await Reflect.apply(loadRevision, projectReadAuthority, [{
          project_id: request.project_id,
          revision_receipt_digest: request.revision_receipt_digest,
        }]);
      } catch {
        return unavailable(
          'saved_revision_preview_source_resolved',
          'saved_revision',
          'preview_source_authority_unavailable',
        );
      }
      const verified = sanitizeProjectReadResult(loaded, request);
      const receipt = verified.product_revision_receipt;
      return ready(
        'saved_revision_preview_source_resolved',
        'saved_revision',
        verified.source_tree,
        {
          source_ref_kind: 'saved_project_revision',
          project_id: request.project_id,
          conversation_id: request.conversation_id,
          revision_receipt_digest: request.revision_receipt_digest,
          revision_number: valueAt(receipt, 'revision_number'),
          candidate_id: verified.git_candidate_receipt.candidate_id,
          candidate_digest: verified.git_candidate_receipt.candidate_digest,
          resulting_tree_digest: verified.source_tree.source_tree_digest,
          commit_oid: verified.git_candidate_receipt.commit_oid,
          tree_oid: verified.git_candidate_receipt.tree_oid,
        },
      );
    },
  });
}

module.exports = freezeDeep({
  BUILDER_LIVE_PREVIEW_SOURCE_RESOLVER_VERSION,
  BUILDER_LIVE_PREVIEW_SOURCE_RESOLVER_RESULT_VERSION,
  BUILDER_LIVE_PREVIEW_SOURCE_SNAPSHOT_VERSION,
  BuilderLivePreviewSourceResolverError,
  createBuilderLivePreviewSourceResolver,
});
