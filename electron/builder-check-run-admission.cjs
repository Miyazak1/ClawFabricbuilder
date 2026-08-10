'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const {
  sanitizeBuilderGitCandidateReceiptPair,
} = require('./builder-git-receipt-contract.cjs');
const {
  sanitizeBuilderProjectUnderstandingSnapshot,
} = require('./builder-project-understanding.cjs');

const BUILDER_CHECK_RUN_EXECUTION_APPROVAL_VERSION = 'builder-check-run-execution-approval.v1';
const BUILDER_CHECK_RUN_ADMISSION_VERSION = 'builder-check-run-admission.v1';
const APPROVAL_INPUT_KEYS = Object.freeze([
  'draft_id',
  'draft_checkpoint_ref',
  'git_candidate_receipt',
  'git_verification_receipt',
  'project_understanding_snapshot',
  'command_profile_id',
  'approved_at_ms',
  'expires_at_ms',
]);
const ADMISSION_INPUT_KEYS = Object.freeze([
  'execution_approval',
  'draft_checkpoint_ref',
  'git_candidate_receipt',
  'git_verification_receipt',
  'project_understanding_snapshot',
  'admitted_at_ms',
]);
const CHECKPOINT_REF_KEYS = Object.freeze([
  'checkpoint_id',
  'checkpoint_sequence',
  'candidate_id',
  'candidate_digest',
  'resulting_tree_digest',
]);
const APPROVAL_KEYS = Object.freeze([
  'approval_version',
  'approval_id',
  'project_id',
  'conversation_id',
  'turn_id',
  'task_id',
  'run_id',
  'draft_id',
  'draft_checkpoint_id',
  'draft_checkpoint_sequence',
  'candidate_id',
  'candidate_digest',
  'resulting_tree_digest',
  'verification_receipt_digest',
  'commit_oid',
  'tree_oid',
  'command_profile_id',
  'command_kind',
  'command_display',
  'script_digest',
  'invocation_digest',
  'approved_at_ms',
  'expires_at_ms',
  'status',
  'execution_policy',
  'authority',
  'approval_digest',
]);
const ADMISSION_KEYS = Object.freeze([
  'admission_version',
  'admission_id',
  'approval_id',
  'approval_digest',
  'project_id',
  'conversation_id',
  'turn_id',
  'task_id',
  'run_id',
  'draft_id',
  'draft_checkpoint_id',
  'draft_checkpoint_sequence',
  'candidate_id',
  'candidate_digest',
  'resulting_tree_digest',
  'verification_receipt_digest',
  'commit_oid',
  'tree_oid',
  'command_profile_id',
  'command_kind',
  'command_display',
  'script_digest',
  'invocation_digest',
  'timeout_ms',
  'output_budget_bytes',
  'status',
  'admitted_at_ms',
  'execution_policy',
  'lifecycle',
  'authority',
  'admission_digest',
]);
const EXECUTION_POLICY_KEYS = Object.freeze([
  'workspace_kind',
  'shell',
  'environment_policy',
  'sandbox_status',
  'filesystem_enforcement',
  'network_policy',
  'network_enforcement',
  'descendant_termination',
]);
const APPROVAL_AUTHORITY_KEYS = Object.freeze([
  'approval_authority',
  'candidate_authority',
  'command_profile_authority',
  'renderer_authority',
  'process_spawn_authority',
  'permission_scope',
  'provider_dispatch',
  'source_write',
  'git_write',
  'sqlite_write',
  'save_authority',
]);
const ADMISSION_LIFECYCLE_KEYS = Object.freeze([
  'approval',
  'candidate_verification',
  'draft_checkpoint',
  'command_profile',
  'workspace_materialization',
  'process_spawn',
  'check_result',
  'save_version',
]);
const ADMISSION_AUTHORITY_KEYS = Object.freeze([
  'admission_authority',
  'approval_authority',
  'candidate_authority',
  'command_profile_authority',
  'renderer_authority',
  'process_spawn_authority',
  'provider_dispatch',
  'source_write',
  'git_write',
  'sqlite_write',
  'save_authority',
]);
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const PROJECT_ID_PATTERN = new RegExp(`^builder-project:${UUID_SOURCE}$`, 'u');
const CONVERSATION_ID_PATTERN = new RegExp(`^builder-conversation:${UUID_SOURCE}$`, 'u');
const TURN_ID_PATTERN = new RegExp(`^builder-turn:${UUID_SOURCE}$`, 'u');
const TASK_ID_PATTERN = new RegExp(`^builder-task:${UUID_SOURCE}$`, 'u');
const RUN_ID_PATTERN = new RegExp(`^builder-run:${UUID_SOURCE}$`, 'u');
const DRAFT_ID_PATTERN = /^builder-generation-draft:[0-9a-f]{64}$/u;
const CHECKPOINT_ID_PATTERN = /^builder-draft-checkpoint:[0-9a-f]{64}$/u;
const CANDIDATE_ID_PATTERN = /^builder-code-change-candidate:[0-9a-f]{64}$/u;
const COMMAND_PROFILE_ID_PATTERN = /^builder-command-profile:[0-9a-f]{32}$/u;
const APPROVAL_ID_PATTERN = /^builder-check-run-execution-approval:[0-9a-f]{64}$/u;
const ADMISSION_ID_PATTERN = /^builder-check-run-admission:[0-9a-f]{64}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const OID_PATTERN = /^[0-9a-f]{40}$/u;
const MAX_APPROVAL_LIFETIME_MS = 5 * 60 * 1000;
const CHECK_TIMEOUT_MS = 2 * 60 * 1000;
const CHECK_OUTPUT_BUDGET_BYTES = 64 * 1024;
const COMMAND_KINDS = Object.freeze(['lint', 'typecheck', 'test', 'build']);
const COMMAND_DISPLAYS = Object.freeze({
  lint: Object.freeze(['npm run lint', 'pnpm run lint', 'yarn lint', 'bun run lint']),
  typecheck: Object.freeze(['npm run typecheck', 'pnpm run typecheck', 'yarn typecheck', 'bun run typecheck']),
  test: Object.freeze(['npm test', 'pnpm test', 'yarn test', 'bun test']),
  build: Object.freeze(['npm run build', 'pnpm run build', 'yarn build', 'bun run build']),
});
const EXECUTION_POLICY = Object.freeze({
  workspace_kind: 'main_owned_candidate_snapshot',
  shell: false,
  environment_policy: 'minimal_scrubbed',
  sandbox_status: 'unavailable',
  filesystem_enforcement: 'not_enforced_outside_temporary_workspace',
  network_policy: 'not_requested',
  network_enforcement: 'unavailable',
  descendant_termination: 'best_effort',
});
const APPROVAL_AUTHORITY = Object.freeze({
  approval_authority: 'main_owned_explicit_check_run_approval_v1',
  candidate_authority: 'verified_git_receipt_pair_and_current_checkpoint',
  command_profile_authority: 'candidate_project_understanding_snapshot',
  renderer_authority: 'profile_selection_only',
  process_spawn_authority: 'one_shot_candidate_profile_bound',
  permission_scope: 'single_check_run_not_project_grant',
  provider_dispatch: false,
  source_write: 'temporary_candidate_workspace_only',
  git_write: false,
  sqlite_write: false,
  save_authority: false,
});
const ADMISSION_LIFECYCLE = Object.freeze({
  approval: 'fresh_one_shot_verified',
  candidate_verification: 'git_receipt_pair_verified',
  draft_checkpoint: 'current_candidate_bound',
  command_profile: 'candidate_tree_script_digest_bound',
  workspace_materialization: 'not_performed',
  process_spawn: 'not_performed',
  check_result: 'not_recorded',
  save_version: 'not_authorized',
});
const ADMISSION_AUTHORITY = Object.freeze({
  admission_authority: 'main_owned_check_run_admission_v1',
  approval_authority: 'main_owned_explicit_check_run_approval_v1',
  candidate_authority: 'fresh_git_receipt_pair_and_current_checkpoint',
  command_profile_authority: 'fresh_candidate_project_understanding_snapshot',
  renderer_authority: 'not_present',
  process_spawn_authority: 'admitted_once_not_dispatched',
  provider_dispatch: false,
  source_write: 'not_performed',
  git_write: false,
  sqlite_write: false,
  save_authority: false,
});

class BuilderCheckRunAdmissionError extends Error {
  constructor() {
    super('The project check could not be approved.');
    this.name = 'BuilderCheckRunAdmissionError';
    this.code = 'builder_check_run_admission_invalid';
    this.retryable = false;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() { throw new BuilderCheckRunAdmissionError(); }

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
  if (ownKeys.length !== keys.length || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))) fail();
  for (const key of ownKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  }
  return value;
}

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  return descriptor.value;
}

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freezeDeep(nested);
    Object.freeze(value);
  }
  return value;
}

function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map(
      (key) => `${JSON.stringify(key)}:${canonicalJson(valueAt(value, key))}`,
    ).join(',')}}`;
  }
  fail();
}

function sha256Canonical(value) {
  return `sha256:${nodeCrypto.createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')}`;
}

function safePattern(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) fail();
  return value;
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail();
  return value;
}

function safeCommandKind(value) {
  if (typeof value !== 'string' || !COMMAND_KINDS.includes(value)) fail();
  return value;
}

function safeCommandDisplay(value, kind) {
  if (typeof value !== 'string' || !COMMAND_DISPLAYS[kind].includes(value)) fail();
  return value;
}

function sanitizeCheckpointRef(value) {
  exactObject(value, CHECKPOINT_REF_KEYS);
  const sequence = valueAt(value, 'checkpoint_sequence');
  if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence > 1_000_000) fail();
  return freezeDeep({
    checkpoint_id: safePattern(valueAt(value, 'checkpoint_id'), CHECKPOINT_ID_PATTERN),
    checkpoint_sequence: sequence,
    candidate_id: safePattern(valueAt(value, 'candidate_id'), CANDIDATE_ID_PATTERN),
    candidate_digest: safePattern(valueAt(value, 'candidate_digest'), DIGEST_PATTERN),
    resulting_tree_digest: safePattern(valueAt(value, 'resulting_tree_digest'), DIGEST_PATTERN),
  });
}

function selectedProfile(rawSnapshot, profileId, candidate) {
  const snapshot = sanitizeBuilderProjectUnderstandingSnapshot(rawSnapshot);
  const id = safePattern(profileId, COMMAND_PROFILE_ID_PATTERN);
  const profile = snapshot.command_profiles.find((entry) => entry.command_profile_id === id);
  if (
    profile === undefined
    || snapshot.project_id !== candidate.project_id
    || snapshot.source_tree_digest !== candidate.resulting_tree_digest
    || profile.source_tree_digest !== candidate.resulting_tree_digest
    || profile.requires_user_approval !== true
    || profile.risk_class !== 'read_only_project_check'
  ) fail();
  return profile;
}

function candidateFacts(rawCandidate, rawVerification, rawCheckpointRef) {
  const pair = sanitizeBuilderGitCandidateReceiptPair(rawCandidate, rawVerification);
  const candidate = pair.candidate_receipt;
  const verification = pair.verification_receipt;
  const checkpoint = sanitizeCheckpointRef(rawCheckpointRef);
  if (
    checkpoint.candidate_id !== candidate.candidate_id
    || checkpoint.candidate_digest !== candidate.candidate_digest
    || checkpoint.resulting_tree_digest !== candidate.resulting_tree_digest
  ) fail();
  return freezeDeep({ candidate, verification, checkpoint });
}

function invocationDigest(candidate, profile) {
  return sha256Canonical({
    project_id: candidate.project_id,
    candidate_id: candidate.candidate_id,
    candidate_digest: candidate.candidate_digest,
    resulting_tree_digest: candidate.resulting_tree_digest,
    command_profile_id: profile.command_profile_id,
    command_kind: profile.command_kind,
    command_display: profile.command_display,
    script_digest: profile.script_digest,
    execution_policy: EXECUTION_POLICY,
    timeout_ms: CHECK_TIMEOUT_MS,
    output_budget_bytes: CHECK_OUTPUT_BUDGET_BYTES,
  });
}

function assertFixedObject(value, keys, expected) {
  exactObject(value, keys);
  for (const key of keys) if (valueAt(value, key) !== expected[key]) fail();
  return freezeDeep({ ...expected });
}

function approvalBody(value) {
  const body = { ...value };
  delete body.approval_id;
  delete body.approval_digest;
  return body;
}

function admissionBody(value) {
  const body = { ...value };
  delete body.admission_id;
  delete body.admission_digest;
  return body;
}

function createBuilderCheckRunExecutionApproval(rawInput) {
  try {
    const input = exactObject(rawInput, APPROVAL_INPUT_KEYS);
    const facts = candidateFacts(
      valueAt(input, 'git_candidate_receipt'),
      valueAt(input, 'git_verification_receipt'),
      valueAt(input, 'draft_checkpoint_ref'),
    );
    const candidate = facts.candidate;
    const profile = selectedProfile(
      valueAt(input, 'project_understanding_snapshot'),
      valueAt(input, 'command_profile_id'),
      candidate,
    );
    const approvedAtMs = safeTimestamp(valueAt(input, 'approved_at_ms'));
    const expiresAtMs = safeTimestamp(valueAt(input, 'expires_at_ms'));
    if (expiresAtMs <= approvedAtMs || expiresAtMs - approvedAtMs > MAX_APPROVAL_LIFETIME_MS) fail();
    const unsigned = freezeDeep({
      approval_version: BUILDER_CHECK_RUN_EXECUTION_APPROVAL_VERSION,
      project_id: candidate.project_id,
      conversation_id: candidate.conversation_id,
      turn_id: candidate.turn_id,
      task_id: candidate.task_id,
      run_id: candidate.run_id,
      draft_id: safePattern(valueAt(input, 'draft_id'), DRAFT_ID_PATTERN),
      draft_checkpoint_id: facts.checkpoint.checkpoint_id,
      draft_checkpoint_sequence: facts.checkpoint.checkpoint_sequence,
      candidate_id: candidate.candidate_id,
      candidate_digest: candidate.candidate_digest,
      resulting_tree_digest: candidate.resulting_tree_digest,
      verification_receipt_digest: candidate.verification_receipt_digest,
      commit_oid: candidate.commit_oid,
      tree_oid: candidate.tree_oid,
      command_profile_id: profile.command_profile_id,
      command_kind: profile.command_kind,
      command_display: profile.command_display,
      script_digest: profile.script_digest,
      invocation_digest: invocationDigest(candidate, profile),
      approved_at_ms: approvedAtMs,
      expires_at_ms: expiresAtMs,
      status: 'approved_once',
      execution_policy: { ...EXECUTION_POLICY },
      authority: { ...APPROVAL_AUTHORITY },
    });
    const digest = sha256Canonical(unsigned);
    return freezeDeep({
      ...unsigned,
      approval_id: `builder-check-run-execution-approval:${digest.slice('sha256:'.length)}`,
      approval_digest: digest,
    });
  } catch (error) {
    if (error instanceof BuilderCheckRunAdmissionError) throw error;
    fail();
  }
}

function sanitizeBuilderCheckRunExecutionApproval(rawValue) {
  try {
    const value = exactObject(rawValue, APPROVAL_KEYS);
    const normalized = {
      approval_version: valueAt(value, 'approval_version'),
      approval_id: safePattern(valueAt(value, 'approval_id'), APPROVAL_ID_PATTERN),
      project_id: safePattern(valueAt(value, 'project_id'), PROJECT_ID_PATTERN),
      conversation_id: safePattern(valueAt(value, 'conversation_id'), CONVERSATION_ID_PATTERN),
      turn_id: safePattern(valueAt(value, 'turn_id'), TURN_ID_PATTERN),
      task_id: safePattern(valueAt(value, 'task_id'), TASK_ID_PATTERN),
      run_id: safePattern(valueAt(value, 'run_id'), RUN_ID_PATTERN),
      draft_id: safePattern(valueAt(value, 'draft_id'), DRAFT_ID_PATTERN),
      draft_checkpoint_id: safePattern(valueAt(value, 'draft_checkpoint_id'), CHECKPOINT_ID_PATTERN),
      draft_checkpoint_sequence: valueAt(value, 'draft_checkpoint_sequence'),
      candidate_id: safePattern(valueAt(value, 'candidate_id'), CANDIDATE_ID_PATTERN),
      candidate_digest: safePattern(valueAt(value, 'candidate_digest'), DIGEST_PATTERN),
      resulting_tree_digest: safePattern(valueAt(value, 'resulting_tree_digest'), DIGEST_PATTERN),
      verification_receipt_digest: safePattern(valueAt(value, 'verification_receipt_digest'), DIGEST_PATTERN),
      commit_oid: safePattern(valueAt(value, 'commit_oid'), OID_PATTERN),
      tree_oid: safePattern(valueAt(value, 'tree_oid'), OID_PATTERN),
      command_profile_id: safePattern(valueAt(value, 'command_profile_id'), COMMAND_PROFILE_ID_PATTERN),
      command_kind: safeCommandKind(valueAt(value, 'command_kind')),
      command_display: null,
      script_digest: safePattern(valueAt(value, 'script_digest'), DIGEST_PATTERN),
      invocation_digest: safePattern(valueAt(value, 'invocation_digest'), DIGEST_PATTERN),
      approved_at_ms: safeTimestamp(valueAt(value, 'approved_at_ms')),
      expires_at_ms: safeTimestamp(valueAt(value, 'expires_at_ms')),
      status: valueAt(value, 'status'),
      execution_policy: assertFixedObject(
        valueAt(value, 'execution_policy'),
        EXECUTION_POLICY_KEYS,
        EXECUTION_POLICY,
      ),
      authority: assertFixedObject(
        valueAt(value, 'authority'),
        APPROVAL_AUTHORITY_KEYS,
        APPROVAL_AUTHORITY,
      ),
      approval_digest: safePattern(valueAt(value, 'approval_digest'), DIGEST_PATTERN),
    };
    normalized.command_display = safeCommandDisplay(
      valueAt(value, 'command_display'),
      normalized.command_kind,
    );
    if (
      normalized.approval_version !== BUILDER_CHECK_RUN_EXECUTION_APPROVAL_VERSION
      || normalized.status !== 'approved_once'
      || !Number.isSafeInteger(normalized.draft_checkpoint_sequence)
      || normalized.draft_checkpoint_sequence < 1
      || normalized.draft_checkpoint_sequence > 1_000_000
      || normalized.expires_at_ms <= normalized.approved_at_ms
      || normalized.expires_at_ms - normalized.approved_at_ms > MAX_APPROVAL_LIFETIME_MS
    ) fail();
    const expectedDigest = sha256Canonical(approvalBody(normalized));
    if (
      normalized.approval_digest !== expectedDigest
      || normalized.approval_id !== `builder-check-run-execution-approval:${expectedDigest.slice('sha256:'.length)}`
    ) fail();
    return freezeDeep(normalized);
  } catch (error) {
    if (error instanceof BuilderCheckRunAdmissionError) throw error;
    fail();
  }
}

function sameApprovalFacts(approval, facts, profile) {
  const candidate = facts.candidate;
  return approval.project_id === candidate.project_id
    && approval.conversation_id === candidate.conversation_id
    && approval.turn_id === candidate.turn_id
    && approval.task_id === candidate.task_id
    && approval.run_id === candidate.run_id
    && approval.draft_checkpoint_id === facts.checkpoint.checkpoint_id
    && approval.draft_checkpoint_sequence === facts.checkpoint.checkpoint_sequence
    && approval.candidate_id === candidate.candidate_id
    && approval.candidate_digest === candidate.candidate_digest
    && approval.resulting_tree_digest === candidate.resulting_tree_digest
    && approval.verification_receipt_digest === candidate.verification_receipt_digest
    && approval.commit_oid === candidate.commit_oid
    && approval.tree_oid === candidate.tree_oid
    && approval.command_profile_id === profile.command_profile_id
    && approval.command_kind === profile.command_kind
    && approval.command_display === profile.command_display
    && approval.script_digest === profile.script_digest
    && approval.invocation_digest === invocationDigest(candidate, profile);
}

function createBuilderCheckRunAdmission(rawInput) {
  try {
    const input = exactObject(rawInput, ADMISSION_INPUT_KEYS);
    const approval = sanitizeBuilderCheckRunExecutionApproval(valueAt(input, 'execution_approval'));
    const facts = candidateFacts(
      valueAt(input, 'git_candidate_receipt'),
      valueAt(input, 'git_verification_receipt'),
      valueAt(input, 'draft_checkpoint_ref'),
    );
    const profile = selectedProfile(
      valueAt(input, 'project_understanding_snapshot'),
      approval.command_profile_id,
      facts.candidate,
    );
    const admittedAtMs = safeTimestamp(valueAt(input, 'admitted_at_ms'));
    if (
      admittedAtMs < approval.approved_at_ms
      || admittedAtMs >= approval.expires_at_ms
      || !sameApprovalFacts(approval, facts, profile)
    ) fail();
    const unsigned = freezeDeep({
      admission_version: BUILDER_CHECK_RUN_ADMISSION_VERSION,
      approval_id: approval.approval_id,
      approval_digest: approval.approval_digest,
      project_id: approval.project_id,
      conversation_id: approval.conversation_id,
      turn_id: approval.turn_id,
      task_id: approval.task_id,
      run_id: approval.run_id,
      draft_id: approval.draft_id,
      draft_checkpoint_id: approval.draft_checkpoint_id,
      draft_checkpoint_sequence: approval.draft_checkpoint_sequence,
      candidate_id: approval.candidate_id,
      candidate_digest: approval.candidate_digest,
      resulting_tree_digest: approval.resulting_tree_digest,
      verification_receipt_digest: approval.verification_receipt_digest,
      commit_oid: approval.commit_oid,
      tree_oid: approval.tree_oid,
      command_profile_id: approval.command_profile_id,
      command_kind: approval.command_kind,
      command_display: approval.command_display,
      script_digest: approval.script_digest,
      invocation_digest: approval.invocation_digest,
      timeout_ms: CHECK_TIMEOUT_MS,
      output_budget_bytes: CHECK_OUTPUT_BUDGET_BYTES,
      status: 'admitted',
      admitted_at_ms: admittedAtMs,
      execution_policy: { ...EXECUTION_POLICY },
      lifecycle: { ...ADMISSION_LIFECYCLE },
      authority: { ...ADMISSION_AUTHORITY },
    });
    const digest = sha256Canonical(unsigned);
    return freezeDeep({
      ...unsigned,
      admission_id: `builder-check-run-admission:${digest.slice('sha256:'.length)}`,
      admission_digest: digest,
    });
  } catch (error) {
    if (error instanceof BuilderCheckRunAdmissionError) throw error;
    fail();
  }
}

function sanitizeBuilderCheckRunAdmission(rawValue) {
  try {
    const value = exactObject(rawValue, ADMISSION_KEYS);
    const normalized = {
      admission_version: valueAt(value, 'admission_version'),
      admission_id: safePattern(valueAt(value, 'admission_id'), ADMISSION_ID_PATTERN),
      approval_id: safePattern(valueAt(value, 'approval_id'), APPROVAL_ID_PATTERN),
      approval_digest: safePattern(valueAt(value, 'approval_digest'), DIGEST_PATTERN),
      project_id: safePattern(valueAt(value, 'project_id'), PROJECT_ID_PATTERN),
      conversation_id: safePattern(valueAt(value, 'conversation_id'), CONVERSATION_ID_PATTERN),
      turn_id: safePattern(valueAt(value, 'turn_id'), TURN_ID_PATTERN),
      task_id: safePattern(valueAt(value, 'task_id'), TASK_ID_PATTERN),
      run_id: safePattern(valueAt(value, 'run_id'), RUN_ID_PATTERN),
      draft_id: safePattern(valueAt(value, 'draft_id'), DRAFT_ID_PATTERN),
      draft_checkpoint_id: safePattern(valueAt(value, 'draft_checkpoint_id'), CHECKPOINT_ID_PATTERN),
      draft_checkpoint_sequence: valueAt(value, 'draft_checkpoint_sequence'),
      candidate_id: safePattern(valueAt(value, 'candidate_id'), CANDIDATE_ID_PATTERN),
      candidate_digest: safePattern(valueAt(value, 'candidate_digest'), DIGEST_PATTERN),
      resulting_tree_digest: safePattern(valueAt(value, 'resulting_tree_digest'), DIGEST_PATTERN),
      verification_receipt_digest: safePattern(valueAt(value, 'verification_receipt_digest'), DIGEST_PATTERN),
      commit_oid: safePattern(valueAt(value, 'commit_oid'), OID_PATTERN),
      tree_oid: safePattern(valueAt(value, 'tree_oid'), OID_PATTERN),
      command_profile_id: safePattern(valueAt(value, 'command_profile_id'), COMMAND_PROFILE_ID_PATTERN),
      command_kind: safeCommandKind(valueAt(value, 'command_kind')),
      command_display: null,
      script_digest: safePattern(valueAt(value, 'script_digest'), DIGEST_PATTERN),
      invocation_digest: safePattern(valueAt(value, 'invocation_digest'), DIGEST_PATTERN),
      timeout_ms: valueAt(value, 'timeout_ms'),
      output_budget_bytes: valueAt(value, 'output_budget_bytes'),
      status: valueAt(value, 'status'),
      admitted_at_ms: safeTimestamp(valueAt(value, 'admitted_at_ms')),
      execution_policy: assertFixedObject(
        valueAt(value, 'execution_policy'),
        EXECUTION_POLICY_KEYS,
        EXECUTION_POLICY,
      ),
      lifecycle: assertFixedObject(
        valueAt(value, 'lifecycle'),
        ADMISSION_LIFECYCLE_KEYS,
        ADMISSION_LIFECYCLE,
      ),
      authority: assertFixedObject(
        valueAt(value, 'authority'),
        ADMISSION_AUTHORITY_KEYS,
        ADMISSION_AUTHORITY,
      ),
      admission_digest: safePattern(valueAt(value, 'admission_digest'), DIGEST_PATTERN),
    };
    normalized.command_display = safeCommandDisplay(
      valueAt(value, 'command_display'),
      normalized.command_kind,
    );
    if (
      normalized.admission_version !== BUILDER_CHECK_RUN_ADMISSION_VERSION
      || normalized.timeout_ms !== CHECK_TIMEOUT_MS
      || normalized.output_budget_bytes !== CHECK_OUTPUT_BUDGET_BYTES
      || normalized.status !== 'admitted'
      || !Number.isSafeInteger(normalized.draft_checkpoint_sequence)
      || normalized.draft_checkpoint_sequence < 1
      || normalized.draft_checkpoint_sequence > 1_000_000
    ) fail();
    const expectedDigest = sha256Canonical(admissionBody(normalized));
    if (
      normalized.admission_digest !== expectedDigest
      || normalized.admission_id !== `builder-check-run-admission:${expectedDigest.slice('sha256:'.length)}`
    ) fail();
    return freezeDeep(normalized);
  } catch (error) {
    if (error instanceof BuilderCheckRunAdmissionError) throw error;
    fail();
  }
}

module.exports = freezeDeep({
  BUILDER_CHECK_RUN_ADMISSION_VERSION,
  BUILDER_CHECK_RUN_EXECUTION_APPROVAL_VERSION,
  BuilderCheckRunAdmissionError,
  createBuilderCheckRunAdmission,
  createBuilderCheckRunExecutionApproval,
  sanitizeBuilderCheckRunAdmission,
  sanitizeBuilderCheckRunExecutionApproval,
});
