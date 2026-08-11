'use strict';

const { types: utilTypes } = require('node:util');

const {
  BUILDER_AUTOMATIC_DRAFT_CHECKPOINT_SERVICE_VERSION,
} = require('./builder-automatic-draft-checkpoint-service.cjs');
const {
  BUILDER_CHECK_RUN_MAIN_RESULT_VERSION,
  BUILDER_CHECK_RUN_MAIN_SERVICE_VERSION,
} = require('./builder-check-run-main-service.cjs');
const {
  sanitizeBuilderCheckRunStatusProjection,
} = require('./builder-check-run-status-projection.cjs');
const {
  BUILDER_CONVERSATION_MAIN_SERVICE_VERSION,
} = require('./builder-conversation-main-service.cjs');
const {
  sanitizeBuilderGitCandidateReceipt,
  sanitizeBuilderGitCandidateReceiptPair,
  sha256Canonical,
} = require('./builder-git-receipt-contract.cjs');
const {
  BUILDER_GIT_VERIFIED_CANDIDATE_READ_RESULT_VERSION,
} = require('./builder-git-project-repository.cjs');
const {
  createBuilderProjectUnderstandingSnapshot,
} = require('./builder-project-understanding.cjs');
const {
  sanitizeBuilderProjectSourceTree,
} = require('./builder-project-source-tree.cjs');

const BUILDER_CHECK_RUN_CURRENT_DRAFT_SERVICE_VERSION =
  'builder-check-run-current-draft-service.v1';
const BUILDER_CHECK_RUN_CURRENT_DRAFT_READ_RESULT_VERSION =
  'builder-check-run-current-draft-read-result.v1';
const BUILDER_CHECK_RUN_CURRENT_DRAFT_RUN_RESULT_VERSION =
  'builder-check-run-current-draft-run-result.v1';
const BUILDER_CHECK_RUN_CURRENT_DRAFT_MAIN_CANDIDATE_RESULT_VERSION =
  'builder-check-run-current-draft-main-candidate-result.v1';
const CREATE_KEYS = Object.freeze([
  'conversation_service',
  'git_authority',
  'automatic_draft_checkpoint_service',
  'check_run_main_service',
  'clock',
]);
const READ_KEYS = Object.freeze(['draft_id']);
const RUN_KEYS = Object.freeze(['draft_id', 'command_profile_id']);
const CONVERSATION_DRAFT_KEYS = Object.freeze([
  'result_version',
  'draft_id',
  'project_id',
  'conversation_id',
  'turn_id',
  'task_id',
  'run_id',
  'candidate_digest',
  'base_revision',
  'conversation_head',
  'candidate_result',
  'verification_admission',
]);
const CANDIDATE_RESULT_KEYS = Object.freeze([
  'draft_id',
  'title',
  'summary',
  'git_candidate_receipt',
]);
const GIT_READ_KEYS = Object.freeze([
  'result_version',
  'candidate_receipt',
  'verification_receipt',
  'source_tree',
  'code_authority',
  'read_admission',
]);
const CHECKPOINT_RESULT_KEYS = Object.freeze([
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
const MAIN_RESULT_KEYS = Object.freeze([
  'result_version',
  'operation',
  'check_run_status_projection',
]);
const DRAFT_ID_PATTERN = /^builder-generation-draft:[0-9a-f]{64}$/u;
const COMMAND_PROFILE_ID_PATTERN = /^builder-command-profile:[0-9a-f]{32}$/u;
const CHECKPOINT_ID_PATTERN = /^builder-draft-checkpoint:[0-9a-f]{64}$/u;

class BuilderCheckRunCurrentDraftServiceError extends Error {
  constructor() {
    super('The current draft could not be prepared for a project check.');
    this.name = 'BuilderCheckRunCurrentDraftServiceError';
    this.code = 'builder_check_run_current_draft_failed';
    this.retryable = true;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() { throw new BuilderCheckRunCurrentDraftServiceError(); }

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freezeDeep(nested);
    Object.freeze(value);
  }
  return value;
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || utilTypes.isProxy(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactObject(value, keys) {
  if (!isPlainObject(value)) fail();
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== keys.length || ownKeys.some(
    (key) => typeof key !== 'string' || !keys.includes(key),
  )) fail();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  }
  return descriptors;
}

function safePattern(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) fail();
  return value;
}

function serviceMethod(value, versionKey, expectedVersion, methodKey) {
  if (!isPlainObject(value)) fail();
  const version = Object.getOwnPropertyDescriptor(value, versionKey);
  const method = Object.getOwnPropertyDescriptor(value, methodKey);
  if (
    !version
    || !Object.hasOwn(version, 'value')
    || version.value !== expectedVersion
    || !method
    || !Object.hasOwn(method, 'value')
    || typeof method.value !== 'function'
    || utilTypes.isProxy(method.value)
  ) fail();
  return method.value.bind(value);
}

function ownMethod(value, methodKey) {
  if (!isPlainObject(value)) fail();
  const method = Object.getOwnPropertyDescriptor(value, methodKey);
  if (
    !method
    || !Object.hasOwn(method, 'value')
    || typeof method.value !== 'function'
    || utilTypes.isProxy(method.value)
  ) fail();
  return method.value.bind(value);
}

function candidateFromConversation(rawValue, expectedDraftId) {
  const value = exactObject(rawValue, CONVERSATION_DRAFT_KEYS);
  if (
    value.result_version.value !== 'builder-conversation-candidate-draft-read-result.v1'
    || value.draft_id.value !== expectedDraftId
    || value.verification_admission.value !== 'sqlite_replay_verified'
  ) fail();
  const candidateResult = exactObject(value.candidate_result.value, CANDIDATE_RESULT_KEYS);
  if (candidateResult.draft_id.value !== expectedDraftId) fail();
  const receipt = sanitizeBuilderGitCandidateReceipt(candidateResult.git_candidate_receipt.value);
  if (
    receipt.project_id !== value.project_id.value
    || receipt.conversation_id !== value.conversation_id.value
    || receipt.turn_id !== value.turn_id.value
    || receipt.task_id !== value.task_id.value
    || receipt.run_id !== value.run_id.value
    || receipt.candidate_digest !== value.candidate_digest.value
  ) fail();
  return receipt;
}

function verifiedCandidate(rawValue, expectedReceipt) {
  const value = exactObject(rawValue, GIT_READ_KEYS);
  if (
    value.result_version.value !== BUILDER_GIT_VERIFIED_CANDIDATE_READ_RESULT_VERSION
    || value.code_authority.value !== 'git_commit_tree'
    || value.read_admission.value !== 'verified'
  ) fail();
  const pair = sanitizeBuilderGitCandidateReceiptPair(
    value.candidate_receipt.value,
    value.verification_receipt.value,
  );
  if (sha256Canonical(pair.candidate_receipt) !== sha256Canonical(expectedReceipt)) fail();
  const sourceTree = sanitizeBuilderProjectSourceTree(value.source_tree.value);
  if (sourceTree.source_tree_digest !== pair.candidate_receipt.resulting_tree_digest) fail();
  return freezeDeep({ pair, source_tree: sourceTree });
}

function verifiedCheckpoint(rawValue, receipt) {
  const value = exactObject(rawValue, CHECKPOINT_RESULT_KEYS);
  if (
    value.result_version.value !== 'builder-automatic-draft-checkpoint-result.v1'
    || value.service_version.value !== BUILDER_AUTOMATIC_DRAFT_CHECKPOINT_SERVICE_VERSION
    || value.operation.value !== 'current_candidate_checkpoint_verified'
    || value.status.value !== 'verified'
    || value.verification_admission.value !== 'main_owned_latest_checkpoint_verified'
  ) fail();
  const ref = exactObject(value.checkpoint_ref.value, CHECKPOINT_REF_KEYS);
  const sequence = ref.checkpoint_sequence.value;
  if (
    safePattern(ref.checkpoint_id.value, CHECKPOINT_ID_PATTERN) !== ref.checkpoint_id.value
    || !Number.isSafeInteger(sequence)
    || sequence < 1
    || sequence > 1_000_000
    || ref.candidate_id.value !== receipt.candidate_id
    || ref.candidate_digest.value !== receipt.candidate_digest
    || ref.resulting_tree_digest.value !== receipt.resulting_tree_digest
  ) fail();
  return freezeDeep(Object.fromEntries(
    CHECKPOINT_REF_KEYS.map((key) => [key, ref[key].value]),
  ));
}

function candidateRootDigest(receipt) {
  return sha256Canonical({
    source_kind: 'verified_git_candidate',
    project_id: receipt.project_id,
    candidate_id: receipt.candidate_id,
    candidate_digest: receipt.candidate_digest,
    resulting_tree_digest: receipt.resulting_tree_digest,
    verification_receipt_digest: receipt.verification_receipt_digest,
    commit_oid: receipt.commit_oid,
    tree_oid: receipt.tree_oid,
  });
}

function publicProfiles(snapshot) {
  return freezeDeep(snapshot.command_profiles.map((profile) => ({
    command_profile_id: profile.command_profile_id,
    command_kind: profile.command_kind,
    command_display: profile.command_display,
    requires_user_approval: profile.requires_user_approval,
  })));
}

function createBuilderCheckRunCurrentDraftService(rawOptions) {
  const options = exactObject(rawOptions, CREATE_KEYS);
  const conversationService = options.conversation_service.value;
  const readCandidateDraft = serviceMethod(
    conversationService,
    'service_version',
    BUILDER_CONVERSATION_MAIN_SERVICE_VERSION,
    'read_candidate_draft',
  );
  const gitAuthority = options.git_authority.value;
  const readVerifiedCandidate = ownMethod(gitAuthority, 'read_verified_candidate');
  const checkpointService = options.automatic_draft_checkpoint_service.value;
  const verifyCurrentCheckpoint = serviceMethod(
    checkpointService,
    'service_version',
    BUILDER_AUTOMATIC_DRAFT_CHECKPOINT_SERVICE_VERSION,
    'verify_current_candidate_checkpoint',
  );
  const checkRunMainService = options.check_run_main_service.value;
  const runApprovedCheck = serviceMethod(
    checkRunMainService,
    'service_version',
    BUILDER_CHECK_RUN_MAIN_SERVICE_VERSION,
    'run_approved_check',
  );
  const clock = options.clock.value;
  const nowMs = serviceMethod(clock, 'clock_version', 'builder-clock.v1', 'now_ms');

  async function resolveCurrentDraft(draftId) {
    const receipt = candidateFromConversation(
      await readCandidateDraft({ draft_id: draftId }),
      draftId,
    );
    const verified = verifiedCandidate(
      await readVerifiedCandidate(receipt),
      receipt,
    );
    const checkpoint = verifiedCheckpoint(await verifyCurrentCheckpoint({
      project_id: receipt.project_id,
      conversation_id: receipt.conversation_id,
      task_id: receipt.task_id,
      run_id: receipt.run_id,
      candidate_id: receipt.candidate_id,
      candidate_digest: receipt.candidate_digest,
      resulting_tree_digest: receipt.resulting_tree_digest,
    }), receipt);
    const updatedAtMs = nowMs();
    if (!Number.isSafeInteger(updatedAtMs) || updatedAtMs < 0) fail();
    const understanding = createBuilderProjectUnderstandingSnapshot({
      project_id: receipt.project_id,
      root_digest: candidateRootDigest(receipt),
      source_tree: verified.source_tree,
      previous_successful_check_runs: [],
      updated_at_ms: updatedAtMs,
    });
    return freezeDeep({
      receipt: verified.pair.candidate_receipt,
      verification: verified.pair.verification_receipt,
      checkpoint,
      source_tree: verified.source_tree,
      understanding,
    });
  }

  return freezeDeep({
    service_version: BUILDER_CHECK_RUN_CURRENT_DRAFT_SERVICE_VERSION,

    async read_available_checks(rawRequest) {
      try {
        const request = exactObject(rawRequest, READ_KEYS);
        const draftId = safePattern(request.draft_id.value, DRAFT_ID_PATTERN);
        const current = await resolveCurrentDraft(draftId);
        const availableChecks = publicProfiles(current.understanding);
        return freezeDeep({
          result_version: BUILDER_CHECK_RUN_CURRENT_DRAFT_READ_RESULT_VERSION,
          service_version: BUILDER_CHECK_RUN_CURRENT_DRAFT_SERVICE_VERSION,
          operation: 'current_draft_available_checks_read',
          status: availableChecks.length === 0 ? 'no_checks' : 'ready',
          draft_id: draftId,
          project_id: current.receipt.project_id,
          candidate_id: current.receipt.candidate_id,
          available_checks: availableChecks,
        });
      } catch (error) {
        if (error instanceof BuilderCheckRunCurrentDraftServiceError) throw error;
        fail();
      }
    },

    async read_current_candidate_for_main_only(rawRequest) {
      try {
        const request = exactObject(rawRequest, READ_KEYS);
        const draftId = safePattern(request.draft_id.value, DRAFT_ID_PATTERN);
        const current = await resolveCurrentDraft(draftId);
        return freezeDeep({
          result_version: BUILDER_CHECK_RUN_CURRENT_DRAFT_MAIN_CANDIDATE_RESULT_VERSION,
          service_version: BUILDER_CHECK_RUN_CURRENT_DRAFT_SERVICE_VERSION,
          operation: 'current_draft_candidate_resolved_for_main_only',
          current_candidate: {
            project_id: current.receipt.project_id,
            conversation_id: current.receipt.conversation_id,
            turn_id: current.receipt.turn_id,
            task_id: current.receipt.task_id,
            run_id: current.receipt.run_id,
            draft_id: draftId,
            draft_checkpoint_id: current.checkpoint.checkpoint_id,
            draft_checkpoint_sequence: current.checkpoint.checkpoint_sequence,
            candidate_id: current.receipt.candidate_id,
            candidate_digest: current.receipt.candidate_digest,
            resulting_tree_digest: current.receipt.resulting_tree_digest,
          },
          authority: {
            caller: 'main_only',
            candidate_identity: 'verified_git_candidate_and_latest_checkpoint',
            renderer_projection: 'not_present',
            source_content: 'not_present',
          },
        });
      } catch (error) {
        if (error instanceof BuilderCheckRunCurrentDraftServiceError) throw error;
        fail();
      }
    },

    async run_approved_check(rawRequest) {
      try {
        const request = exactObject(rawRequest, RUN_KEYS);
        const draftId = safePattern(request.draft_id.value, DRAFT_ID_PATTERN);
        const commandProfileId = safePattern(
          request.command_profile_id.value,
          COMMAND_PROFILE_ID_PATTERN,
        );
        const current = await resolveCurrentDraft(draftId);
        if (!current.understanding.command_profile_ids.includes(commandProfileId)) fail();
        const result = await runApprovedCheck({
          draft_id: draftId,
          draft_checkpoint_ref: current.checkpoint,
          git_candidate_receipt: current.receipt,
          git_verification_receipt: current.verification,
          project_understanding_snapshot: current.understanding,
          command_profile_id: commandProfileId,
          source_tree: current.source_tree,
        });
        const mainResult = exactObject(result, MAIN_RESULT_KEYS);
        if (
          mainResult.result_version.value !== BUILDER_CHECK_RUN_MAIN_RESULT_VERSION
          || mainResult.operation.value !== 'approved_check_completed'
        ) fail();
        const projection = sanitizeBuilderCheckRunStatusProjection(
          mainResult.check_run_status_projection.value,
        );
        const selectedProfile = current.understanding.command_profiles.find(
          (profile) => profile.command_profile_id === commandProfileId,
        );
        if (
          selectedProfile === undefined
          || projection.project_id !== current.receipt.project_id
          || projection.candidate_id !== current.receipt.candidate_id
          || projection.command_kind !== selectedProfile.command_kind
        ) fail();
        return freezeDeep({
          result_version: BUILDER_CHECK_RUN_CURRENT_DRAFT_RUN_RESULT_VERSION,
          service_version: BUILDER_CHECK_RUN_CURRENT_DRAFT_SERVICE_VERSION,
          operation: 'current_draft_approved_check_completed',
          draft_id: draftId,
          project_id: current.receipt.project_id,
          candidate_id: current.receipt.candidate_id,
          check_run_status_projection: projection,
        });
      } catch (error) {
        if (error instanceof BuilderCheckRunCurrentDraftServiceError) throw error;
        fail();
      }
    },
  });
}

module.exports = freezeDeep({
  BUILDER_CHECK_RUN_CURRENT_DRAFT_READ_RESULT_VERSION,
  BUILDER_CHECK_RUN_CURRENT_DRAFT_RUN_RESULT_VERSION,
  BUILDER_CHECK_RUN_CURRENT_DRAFT_MAIN_CANDIDATE_RESULT_VERSION,
  BUILDER_CHECK_RUN_CURRENT_DRAFT_SERVICE_VERSION,
  BuilderCheckRunCurrentDraftServiceError,
  createBuilderCheckRunCurrentDraftService,
});
