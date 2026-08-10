'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const {
  sanitizeBuilderCheckRunAdmission,
} = require('./builder-check-run-admission.cjs');

const BUILDER_CHECK_RUN_VERSION = 'builder-check-run.v1';
const INPUT_KEYS = Object.freeze([
  'check_run_admission',
  'status',
  'exit_code',
  'output_digest',
  'failure_class',
  'started_at_ms',
  'completed_at_ms',
]);
const RECORD_KEYS = Object.freeze([
  'check_run_version',
  'check_run_id',
  'admission_id',
  'admission_digest',
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
  'command_profile_id',
  'command_kind',
  'command_display',
  'script_digest',
  'runtime_identity_id',
  'runtime_identity_digest',
  'package_manager',
  'launcher_kind',
  'launcher_binary_digest',
  'cli_entry_digest',
  'package_manager_version',
  'invocation_digest',
  'execution_policy',
  'status',
  'exit_code',
  'output_digest',
  'failure_class',
  'started_at_ms',
  'completed_at_ms',
  'output_summary',
  'authority',
  'check_run_digest',
]);
const AUTHORITY_KEYS = Object.freeze([
  'record_authority',
  'admission_authority',
  'candidate_authority',
  'command_profile_authority',
  'renderer_authority',
  'ipc_authority',
  'provider_dispatch',
  'command_execution',
  'source_write',
  'git_write',
  'sqlite_write',
  'save_authority',
  'network_authority',
]);
const CHECK_RUN_ID_PATTERN = /^builder-check-run:[0-9a-f]{64}$/u;
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const ADMISSION_ID_PATTERN = /^builder-check-run-admission:[0-9a-f]{64}$/u;
const APPROVAL_ID_PATTERN = /^builder-check-run-execution-approval:[0-9a-f]{64}$/u;
const PROJECT_ID_PATTERN = new RegExp(`^builder-project:${UUID_SOURCE}$`, 'u');
const CONVERSATION_ID_PATTERN = new RegExp(`^builder-conversation:${UUID_SOURCE}$`, 'u');
const TURN_ID_PATTERN = new RegExp(`^builder-turn:${UUID_SOURCE}$`, 'u');
const TASK_ID_PATTERN = new RegExp(`^builder-task:${UUID_SOURCE}$`, 'u');
const RUN_ID_PATTERN = new RegExp(`^builder-run:${UUID_SOURCE}$`, 'u');
const DRAFT_ID_PATTERN = /^builder-generation-draft:[0-9a-f]{64}$/u;
const CHECKPOINT_ID_PATTERN = /^builder-draft-checkpoint:[0-9a-f]{64}$/u;
const CANDIDATE_ID_PATTERN = /^builder-code-change-candidate:[0-9a-f]{64}$/u;
const COMMAND_PROFILE_ID_PATTERN = /^builder-command-profile:[0-9a-f]{32}$/u;
const RUNTIME_IDENTITY_ID_PATTERN = /^builder-check-runtime-identity:[0-9a-f]{64}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const COMMAND_KINDS = Object.freeze(['lint', 'typecheck', 'test', 'build']);
const PACKAGE_MANAGERS = Object.freeze(['npm', 'pnpm', 'yarn', 'bun']);
const RUNTIME_VERSION_PATTERN = /^(?:unknown|[vV]?[0-9][0-9A-Za-z.+_-]{0,63})$/u;
const COMMAND_DISPLAYS = Object.freeze({
  lint: Object.freeze(['npm run lint', 'pnpm run lint', 'yarn lint', 'bun run lint']),
  typecheck: Object.freeze(['npm run typecheck', 'pnpm run typecheck', 'yarn typecheck', 'bun run typecheck']),
  test: Object.freeze(['npm test', 'pnpm test', 'yarn test', 'bun run test']),
  build: Object.freeze(['npm run build', 'pnpm run build', 'yarn build', 'bun run build']),
});
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
const STATUSES = Object.freeze([
  'passed',
  'failed',
  'timed_out',
  'environment_unavailable',
  'cancelled',
  'spawn_failed',
  'output_exceeded',
  'termination_failed',
]);
const FAILURE_CLASS_BY_STATUS = Object.freeze({
  passed: 'none',
  failed: 'command_failed',
  timed_out: 'timed_out',
  environment_unavailable: 'environment_unavailable',
  cancelled: 'cancelled',
  spawn_failed: 'spawn_failed',
  output_exceeded: 'output_exceeded',
  termination_failed: 'termination_failed',
});
const SUMMARY_BY_STATUS = Object.freeze({
  passed: 'Check completed successfully.',
  failed: 'Check failed. Review the project command before saving.',
  timed_out: 'Check stopped after reaching the time limit.',
  environment_unavailable: 'Check could not start in the current environment.',
  cancelled: 'Check was cancelled.',
  spawn_failed: 'Check could not be started.',
  output_exceeded: 'Check output exceeded the review limit.',
  termination_failed: 'Check termination could not be confirmed.',
});
const AUTHORITY = Object.freeze({
  record_authority: 'main_owned_check_run_contract_v1',
  admission_authority: 'verified_check_run_admission_v1',
  candidate_authority: 'admission_bound_verified_candidate',
  command_profile_authority: 'admission_bound_candidate_profile',
  renderer_authority: 'not_present',
  ipc_authority: 'not_present',
  provider_dispatch: false,
  command_execution: 'recorded_admitted_result_only',
  source_write: 'temporary_candidate_workspace_only',
  git_write: false,
  sqlite_write: false,
  save_authority: false,
  network_authority: 'not_granted_by_check_record',
});

class BuilderCheckRunError extends Error {
  constructor() {
    super('The project check result could not be verified.');
    this.name = 'BuilderCheckRunError';
    this.code = 'builder_check_run_invalid';
    this.retryable = false;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() { throw new BuilderCheckRunError(); }

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

function safeStatus(value) {
  if (typeof value !== 'string' || !STATUSES.includes(value)) fail();
  return value;
}

function safeCommandKind(value) {
  if (typeof value !== 'string' || !COMMAND_KINDS.includes(value)) fail();
  return value;
}

function safePackageManager(value) {
  if (typeof value !== 'string' || !PACKAGE_MANAGERS.includes(value)) fail();
  return value;
}

function safeLauncherKind(value, packageManager) {
  const expected = packageManager === 'bun' ? 'native_binary' : 'node_cli';
  if (value !== expected) fail();
  return value;
}

function safeCliEntryDigest(value, launcherKind) {
  if (launcherKind === 'native_binary') {
    if (value !== null) fail();
    return null;
  }
  return safePattern(value, DIGEST_PATTERN);
}

function safeCommandDisplay(value, kind) {
  if (typeof value !== 'string' || !COMMAND_DISPLAYS[kind].includes(value)) fail();
  return value;
}

function safeExitCode(value, status) {
  if (status === 'passed') {
    if (value !== 0) fail();
    return 0;
  }
  if (status === 'failed') {
    if (!Number.isSafeInteger(value) || value < 1 || value > 255) fail();
    return value;
  }
  if (value !== null) fail();
  return null;
}

function resultFacts(rawValue) {
  const source = exactObject(rawValue, INPUT_KEYS);
  const admission = sanitizeBuilderCheckRunAdmission(valueAt(source, 'check_run_admission'));
  const status = safeStatus(valueAt(source, 'status'));
  const startedAtMs = safeTimestamp(valueAt(source, 'started_at_ms'));
  const completedAtMs = safeTimestamp(valueAt(source, 'completed_at_ms'));
  if (
    startedAtMs < admission.admitted_at_ms
    || completedAtMs < startedAtMs
    || completedAtMs - startedAtMs > admission.timeout_ms + 30_000
  ) fail();
  const failureClass = valueAt(source, 'failure_class');
  if (failureClass !== FAILURE_CLASS_BY_STATUS[status]) fail();
  return freezeDeep({
    admission,
    status,
    exit_code: safeExitCode(valueAt(source, 'exit_code'), status),
    output_digest: safePattern(valueAt(source, 'output_digest'), DIGEST_PATTERN),
    failure_class: failureClass,
    started_at_ms: startedAtMs,
    completed_at_ms: completedAtMs,
  });
}

function checkRunBody(value) {
  const body = { ...value };
  delete body.check_run_id;
  delete body.check_run_digest;
  return body;
}

function assertAuthority(value) {
  exactObject(value, AUTHORITY_KEYS);
  for (const key of AUTHORITY_KEYS) if (valueAt(value, key) !== AUTHORITY[key]) fail();
  return freezeDeep({ ...AUTHORITY });
}

function assertExecutionPolicy(value) {
  exactObject(value, EXECUTION_POLICY_KEYS);
  for (const key of EXECUTION_POLICY_KEYS) {
    if (valueAt(value, key) !== EXECUTION_POLICY[key]) fail();
  }
  return freezeDeep({ ...EXECUTION_POLICY });
}

function createBuilderCheckRun(rawInput) {
  try {
    const result = resultFacts(rawInput);
    const admission = result.admission;
    const unsigned = freezeDeep({
      check_run_version: BUILDER_CHECK_RUN_VERSION,
      admission_id: admission.admission_id,
      admission_digest: admission.admission_digest,
      approval_id: admission.approval_id,
      approval_digest: admission.approval_digest,
      project_id: admission.project_id,
      conversation_id: admission.conversation_id,
      turn_id: admission.turn_id,
      task_id: admission.task_id,
      run_id: admission.run_id,
      draft_id: admission.draft_id,
      draft_checkpoint_id: admission.draft_checkpoint_id,
      draft_checkpoint_sequence: admission.draft_checkpoint_sequence,
      candidate_id: admission.candidate_id,
      candidate_digest: admission.candidate_digest,
      resulting_tree_digest: admission.resulting_tree_digest,
      command_profile_id: admission.command_profile_id,
      command_kind: admission.command_kind,
      command_display: admission.command_display,
      script_digest: admission.script_digest,
      runtime_identity_id: admission.runtime_identity_id,
      runtime_identity_digest: admission.runtime_identity_digest,
      package_manager: admission.package_manager,
      launcher_kind: admission.launcher_kind,
      launcher_binary_digest: admission.launcher_binary_digest,
      cli_entry_digest: admission.cli_entry_digest,
      package_manager_version: admission.package_manager_version,
      invocation_digest: admission.invocation_digest,
      execution_policy: admission.execution_policy,
      status: result.status,
      exit_code: result.exit_code,
      output_digest: result.output_digest,
      failure_class: result.failure_class,
      started_at_ms: result.started_at_ms,
      completed_at_ms: result.completed_at_ms,
      output_summary: SUMMARY_BY_STATUS[result.status],
      authority: { ...AUTHORITY },
    });
    const digest = sha256Canonical(unsigned);
    return freezeDeep({
      ...unsigned,
      check_run_id: `builder-check-run:${digest.slice('sha256:'.length)}`,
      check_run_digest: digest,
    });
  } catch (error) {
    if (error instanceof BuilderCheckRunError) throw error;
    fail();
  }
}

function sanitizeBuilderCheckRun(rawValue) {
  try {
    const value = exactObject(rawValue, RECORD_KEYS);
    const commandKind = safeCommandKind(valueAt(value, 'command_kind'));
    const normalized = {
      check_run_version: valueAt(value, 'check_run_version'),
      check_run_id: safePattern(valueAt(value, 'check_run_id'), CHECK_RUN_ID_PATTERN),
      admission_id: safePattern(valueAt(value, 'admission_id'), ADMISSION_ID_PATTERN),
      admission_digest: safePattern(valueAt(value, 'admission_digest'), DIGEST_PATTERN),
      approval_id: safePattern(valueAt(value, 'approval_id'), APPROVAL_ID_PATTERN),
      approval_digest: safePattern(valueAt(value, 'approval_digest'), DIGEST_PATTERN),
      project_id: safePattern(valueAt(value, 'project_id'), PROJECT_ID_PATTERN),
      conversation_id: safePattern(valueAt(value, 'conversation_id'), CONVERSATION_ID_PATTERN),
      turn_id: safePattern(valueAt(value, 'turn_id'), TURN_ID_PATTERN),
      task_id: safePattern(valueAt(value, 'task_id'), TASK_ID_PATTERN),
      run_id: safePattern(valueAt(value, 'run_id'), RUN_ID_PATTERN),
      draft_id: safePattern(valueAt(value, 'draft_id'), DRAFT_ID_PATTERN),
      draft_checkpoint_id: safePattern(
        valueAt(value, 'draft_checkpoint_id'),
        CHECKPOINT_ID_PATTERN,
      ),
      draft_checkpoint_sequence: valueAt(value, 'draft_checkpoint_sequence'),
      candidate_id: safePattern(valueAt(value, 'candidate_id'), CANDIDATE_ID_PATTERN),
      candidate_digest: safePattern(valueAt(value, 'candidate_digest'), DIGEST_PATTERN),
      resulting_tree_digest: safePattern(
        valueAt(value, 'resulting_tree_digest'),
        DIGEST_PATTERN,
      ),
      command_profile_id: safePattern(
        valueAt(value, 'command_profile_id'),
        COMMAND_PROFILE_ID_PATTERN,
      ),
      command_kind: commandKind,
      command_display: safeCommandDisplay(valueAt(value, 'command_display'), commandKind),
      script_digest: safePattern(valueAt(value, 'script_digest'), DIGEST_PATTERN),
      runtime_identity_id: safePattern(
        valueAt(value, 'runtime_identity_id'),
        RUNTIME_IDENTITY_ID_PATTERN,
      ),
      runtime_identity_digest: safePattern(
        valueAt(value, 'runtime_identity_digest'),
        DIGEST_PATTERN,
      ),
      package_manager: safePackageManager(valueAt(value, 'package_manager')),
      launcher_kind: null,
      launcher_binary_digest: safePattern(
        valueAt(value, 'launcher_binary_digest'),
        DIGEST_PATTERN,
      ),
      cli_entry_digest: null,
      package_manager_version: safePattern(
        valueAt(value, 'package_manager_version'),
        RUNTIME_VERSION_PATTERN,
      ),
      invocation_digest: safePattern(valueAt(value, 'invocation_digest'), DIGEST_PATTERN),
      execution_policy: assertExecutionPolicy(valueAt(value, 'execution_policy')),
      output_digest: safePattern(valueAt(value, 'output_digest'), DIGEST_PATTERN),
      status: safeStatus(valueAt(value, 'status')),
      exit_code: valueAt(value, 'exit_code'),
      failure_class: valueAt(value, 'failure_class'),
      started_at_ms: safeTimestamp(valueAt(value, 'started_at_ms')),
      completed_at_ms: safeTimestamp(valueAt(value, 'completed_at_ms')),
      output_summary: valueAt(value, 'output_summary'),
      authority: assertAuthority(valueAt(value, 'authority')),
      check_run_digest: safePattern(valueAt(value, 'check_run_digest'), DIGEST_PATTERN),
    };
    normalized.launcher_kind = safeLauncherKind(
      valueAt(value, 'launcher_kind'),
      normalized.package_manager,
    );
    normalized.cli_entry_digest = safeCliEntryDigest(
      valueAt(value, 'cli_entry_digest'),
      normalized.launcher_kind,
    );
    if (
      normalized.check_run_version !== BUILDER_CHECK_RUN_VERSION
      || normalized.output_summary !== SUMMARY_BY_STATUS[normalized.status]
      || normalized.failure_class !== FAILURE_CLASS_BY_STATUS[normalized.status]
      || !Number.isSafeInteger(normalized.draft_checkpoint_sequence)
      || normalized.draft_checkpoint_sequence < 1
      || normalized.draft_checkpoint_sequence > 1_000_000
      || normalized.admission_id !== `builder-check-run-admission:${normalized.admission_digest.slice('sha256:'.length)}`
      || normalized.approval_id !== `builder-check-run-execution-approval:${normalized.approval_digest.slice('sha256:'.length)}`
      || normalized.completed_at_ms < normalized.started_at_ms
      || normalized.completed_at_ms - normalized.started_at_ms > 150_000
    ) fail();
    safeExitCode(normalized.exit_code, normalized.status);
    const expectedDigest = sha256Canonical(checkRunBody(normalized));
    if (
      normalized.check_run_digest !== expectedDigest
      || normalized.check_run_id !== `builder-check-run:${expectedDigest.slice('sha256:'.length)}`
    ) fail();
    return freezeDeep(normalized);
  } catch (error) {
    if (error instanceof BuilderCheckRunError) throw error;
    fail();
  }
}

module.exports = freezeDeep({
  BUILDER_CHECK_RUN_VERSION,
  BuilderCheckRunError,
  createBuilderCheckRun,
  sanitizeBuilderCheckRun,
});
