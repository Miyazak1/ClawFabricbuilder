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
  sanitizeBuilderGitCandidateReceiptPair,
  sha256Canonical,
} = require('./builder-git-receipt-contract.cjs');
const {
  sanitizeBuilderProjectSourceTree,
} = require('./builder-project-source-tree.cjs');
const {
  createBuilderProjectUnderstandingSnapshot,
} = require('./builder-project-understanding.cjs');
const {
  createBuilderCheckSkipDecision,
} = require('./builder-check-skip-decision.cjs');
const {
  BUILDER_CHECK_SKIP_DECISION_STORE_VERSION,
} = require('./builder-check-skip-decision-store.cjs');

const BUILDER_CODING_LOOP_CHECK_COORDINATOR_VERSION =
  'builder-coding-loop-check-coordinator.v1';
const BUILDER_CODING_LOOP_CHECK_RESULT_VERSION =
  'builder-coding-loop-check-result.v1';
const CREATE_KEYS = Object.freeze([
  'automatic_draft_checkpoint_service',
  'check_run_main_service',
  'check_skip_decision_store',
  'activity_registry',
  'clock',
]);
const RUN_KEYS = Object.freeze([
  'draft_id',
  'candidate_receipt',
  'candidate_verification',
  'source_tree',
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
const CHECKPOINT_ID_PATTERN = /^builder-draft-checkpoint:[0-9a-f]{64}$/u;
const CHECK_PRIORITY = Object.freeze(['test', 'typecheck', 'build', 'lint']);

class BuilderCodingLoopCheckCoordinatorError extends Error {
  constructor(runtimeCode = 'coordinator_contract', runtimeCauseCode = 'unknown') {
    super('The automatic project check could not be coordinated.');
    this.name = 'BuilderCodingLoopCheckCoordinatorError';
    this.code = 'builder_coding_loop_check_coordinator_failed';
    this.runtime_code = runtimeCode;
    this.runtime_cause_code = runtimeCauseCode;
    this.retryable = true;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() { throw new BuilderCodingLoopCheckCoordinatorError(); }

function diagnosticProperty(error, key) {
  try {
    if (error === null || (typeof error !== 'object' && typeof error !== 'function')) return 'unknown';
    const descriptor = Object.getOwnPropertyDescriptor(error, key);
    return descriptor
      && Object.hasOwn(descriptor, 'value')
      && typeof descriptor.value === 'string'
      && /^[a-z0-9_]{1,96}$/u.test(descriptor.value)
      ? descriptor.value
      : 'unknown';
  } catch {
    return 'unknown';
  }
}

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

function safeNow(nowMs) {
  const value = nowMs();
  if (!Number.isSafeInteger(value) || value < 0) fail();
  return value;
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
    typeof ref.checkpoint_id.value !== 'string'
    || !CHECKPOINT_ID_PATTERN.test(ref.checkpoint_id.value)
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

function selectedProfile(understanding) {
  for (const kind of CHECK_PRIORITY) {
    const profile = understanding.command_profiles.find((entry) => entry.command_kind === kind);
    if (profile !== undefined) return profile;
  }
  return null;
}

function publicProfile(profile) {
  return profile === null ? null : freezeDeep({
    command_profile_id: profile.command_profile_id,
    command_kind: profile.command_kind,
    command_display: profile.command_display,
  });
}

function createBuilderCodingLoopCheckCoordinator(rawOptions) {
  const options = exactObject(rawOptions, CREATE_KEYS);
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
  const recordCheckSkipDecision = serviceMethod(
    options.check_skip_decision_store.value,
    'store_version',
    BUILDER_CHECK_SKIP_DECISION_STORE_VERSION,
    'record_check_skip_decision',
  );
  const notifyCandidateProjectionChanged = serviceMethod(
    options.activity_registry.value,
    'registry_version',
    'builder-check-run-activity-registry.v1',
    'notify_candidate_projection_changed',
  );
  const nowMs = serviceMethod(options.clock.value, 'clock_version', 'builder-clock.v1', 'now_ms');

  return freezeDeep({
    coordinator_version: BUILDER_CODING_LOOP_CHECK_COORDINATOR_VERSION,

    async run_automatic_candidate_check(rawRequest) {
      let runtimeCode = 'request_validation';
      try {
        const request = exactObject(rawRequest, RUN_KEYS);
        const draftId = request.draft_id.value;
        if (typeof draftId !== 'string' || !DRAFT_ID_PATTERN.test(draftId)) fail();
        const pair = sanitizeBuilderGitCandidateReceiptPair(
          request.candidate_receipt.value,
          request.candidate_verification.value,
        );
        const receipt = pair.candidate_receipt;
        const sourceTree = sanitizeBuilderProjectSourceTree(request.source_tree.value);
        if (sourceTree.source_tree_digest !== receipt.resulting_tree_digest) fail();
        runtimeCode = 'checkpoint_verification';
        const checkpoint = verifiedCheckpoint(await verifyCurrentCheckpoint({
          project_id: receipt.project_id,
          conversation_id: receipt.conversation_id,
          task_id: receipt.task_id,
          run_id: receipt.run_id,
          candidate_id: receipt.candidate_id,
          candidate_digest: receipt.candidate_digest,
          resulting_tree_digest: receipt.resulting_tree_digest,
        }), receipt);
        runtimeCode = 'command_discovery';
        const understanding = createBuilderProjectUnderstandingSnapshot({
          project_id: receipt.project_id,
          root_digest: candidateRootDigest(receipt),
          source_tree: sourceTree,
          previous_successful_check_runs: [],
          updated_at_ms: safeNow(nowMs),
        });
        const profile = selectedProfile(understanding);
        if (profile === null) {
          recordCheckSkipDecision({
            check_skip_decision: createBuilderCheckSkipDecision({
              project_id: receipt.project_id,
              conversation_id: receipt.conversation_id,
              turn_id: receipt.turn_id,
              task_id: receipt.task_id,
              run_id: receipt.run_id,
              draft_id: draftId,
              draft_checkpoint_id: checkpoint.checkpoint_id,
              draft_checkpoint_sequence: checkpoint.checkpoint_sequence,
              candidate_id: receipt.candidate_id,
              candidate_digest: receipt.candidate_digest,
              resulting_tree_digest: receipt.resulting_tree_digest,
              reason_code: 'no_project_checks_detected',
              decided_at_ms: safeNow(nowMs),
            }),
          });
          notifyCandidateProjectionChanged({
            project_id: receipt.project_id,
            candidate_id: receipt.candidate_id,
          });
          return freezeDeep({
            result_version: BUILDER_CODING_LOOP_CHECK_RESULT_VERSION,
            coordinator_version: BUILDER_CODING_LOOP_CHECK_COORDINATOR_VERSION,
            status: 'no_checks',
            project_id: receipt.project_id,
            candidate_id: receipt.candidate_id,
            profile: null,
            check_run_status_projection: null,
            duration_ms: 0,
            authority: 'main_owned_verified_candidate_auto_check',
          });
        }
        const startedAtMs = safeNow(nowMs);
        runtimeCode = 'check_execution';
        const result = exactObject(await runApprovedCheck({
          draft_id: draftId,
          draft_checkpoint_ref: checkpoint,
          git_candidate_receipt: receipt,
          git_verification_receipt: pair.verification_receipt,
          project_understanding_snapshot: understanding,
          command_profile_id: profile.command_profile_id,
          source_tree: sourceTree,
        }), MAIN_RESULT_KEYS);
        runtimeCode = 'check_result_validation';
        if (
          result.result_version.value !== BUILDER_CHECK_RUN_MAIN_RESULT_VERSION
          || result.operation.value !== 'approved_check_completed'
        ) fail();
        const projection = sanitizeBuilderCheckRunStatusProjection(
          result.check_run_status_projection.value,
        );
        if (
          projection.project_id !== receipt.project_id
          || projection.candidate_id !== receipt.candidate_id
          || projection.command_kind !== profile.command_kind
        ) fail();
        const completedAtMs = safeNow(nowMs);
        if (completedAtMs < startedAtMs) fail();
        return freezeDeep({
          result_version: BUILDER_CODING_LOOP_CHECK_RESULT_VERSION,
          coordinator_version: BUILDER_CODING_LOOP_CHECK_COORDINATOR_VERSION,
          status: 'completed',
          project_id: receipt.project_id,
          candidate_id: receipt.candidate_id,
          profile: publicProfile(profile),
          check_run_status_projection: projection,
          duration_ms: completedAtMs - startedAtMs,
          authority: 'main_owned_verified_candidate_auto_check',
        });
      } catch (error) {
        const nestedRuntimeCode = diagnosticProperty(error, 'runtime_code');
        const nestedRuntimeCauseCode = diagnosticProperty(error, 'runtime_cause_code');
        throw new BuilderCodingLoopCheckCoordinatorError(
          runtimeCode,
          nestedRuntimeCauseCode !== 'unknown'
            ? nestedRuntimeCauseCode
            : nestedRuntimeCode !== 'unknown'
              ? nestedRuntimeCode
            : diagnosticProperty(error, 'code'),
        );
      }
    },
  });
}

module.exports = freezeDeep({
  BUILDER_CODING_LOOP_CHECK_COORDINATOR_VERSION,
  BUILDER_CODING_LOOP_CHECK_RESULT_VERSION,
  BuilderCodingLoopCheckCoordinatorError,
  createBuilderCodingLoopCheckCoordinator,
});
