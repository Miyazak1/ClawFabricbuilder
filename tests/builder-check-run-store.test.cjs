'use strict';

const assert = require('node:assert/strict');
const nodeCrypto = require('node:crypto');
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { types: utilTypes } = require('node:util');
const test = require('node:test');
const {
  checkRuntimeIdentity,
} = require('./helpers/builder-check-runtime-identity-fixture.cjs');

const STORE_PATH = path.join(__dirname, '..', 'electron', 'builder-check-run-store.cjs');
const CONTRACT_PATH = path.join(__dirname, '..', 'electron', 'builder-check-run.cjs');
const PROJECT_ID = 'builder-project:11111111-1111-4111-8111-111111111111';
const OTHER_PROJECT_ID = 'builder-project:22222222-2222-4222-8222-222222222222';
const CANDIDATE_ID = `builder-code-change-candidate:${'a'.repeat(64)}`;
const OTHER_CANDIDATE_ID = `builder-code-change-candidate:${'b'.repeat(64)}`;
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
const SUMMARY_BY_STATUS = Object.freeze({
  passed: 'Check completed successfully.',
  failed: 'Check failed. Review the project command before saving.',
  timed_out: 'Check stopped after reaching the time limit.',
  environment_unavailable: 'Check could not start in the current environment.',
  cancelled: 'Check was cancelled.',
  spawn_failed: 'Check could not be started.',
});
const FAILURE_BY_STATUS = Object.freeze({
  passed: 'none',
  failed: 'command_failed',
  timed_out: 'timed_out',
  environment_unavailable: 'environment_unavailable',
  cancelled: 'cancelled',
  spawn_failed: 'spawn_failed',
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

function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number' && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map(
      (key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`,
    ).join(',')}}`;
  }
  throw new Error('invalid assumed check run');
}

function digestBody(value) {
  return `sha256:${nodeCrypto.createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')}`;
}

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freezeDeep(nested);
    Object.freeze(value);
  }
  return value;
}

class AssumedBuilderCheckRunError extends Error {}

function assumedSanitizeBuilderCheckRun(value) {
  if (!isPlainObject(value) || Reflect.ownKeys(value).length !== RECORD_KEYS.length) {
    throw new AssumedBuilderCheckRunError();
  }
  for (const key of RECORD_KEYS) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      throw new AssumedBuilderCheckRunError();
    }
  }
  if (Reflect.ownKeys(value).some((key) => typeof key !== 'string' || !RECORD_KEYS.includes(key))) {
    throw new AssumedBuilderCheckRunError();
  }
  const normalized = JSON.parse(JSON.stringify(value));
  const body = { ...normalized };
  delete body.check_run_id;
  delete body.check_run_digest;
  const expected = digestBody(body);
  if (
    normalized.check_run_version !== 'builder-check-run.v1'
    || normalized.check_run_digest !== expected
    || normalized.check_run_id !== `builder-check-run:${expected.slice('sha256:'.length)}`
  ) throw new AssumedBuilderCheckRunError();
  return freezeDeep(normalized);
}

function loadStoreModule() {
  if (fs.existsSync(CONTRACT_PATH)) return require(STORE_PATH);
  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (request === './builder-check-run.cjs' && parent?.filename === STORE_PATH) {
      return {
        BuilderCheckRunError: AssumedBuilderCheckRunError,
        sanitizeBuilderCheckRun: assumedSanitizeBuilderCheckRun,
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require(STORE_PATH);
  } finally {
    Module._load = originalLoad;
  }
}

const {
  BUILDER_CHECK_RUN_STORE_READ_RESULT_VERSION,
  BUILDER_CHECK_RUN_STORE_RESULT_VERSION,
  BUILDER_CHECK_RUN_STORE_SCHEMA_VERSION,
  BUILDER_CHECK_RUN_STORE_USER_VERSION,
  BUILDER_CHECK_RUN_STORE_VERSION,
  BuilderCheckRunStoreError,
  createBuilderCheckRunStore,
} = loadStoreModule();

function temporaryDatabase(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawfabric-builder-check-run-store-'));
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  return path.join(root, 'check-runs.sqlite');
}

function hex(index, length = 64) {
  return (index % 16).toString(16).repeat(length);
}

function checkRun(index = 1, overrides = {}) {
  const runtime = checkRuntimeIdentity();
  const status = overrides.status ?? 'passed';
  const startedAtMs = overrides.started_at_ms ?? 10_000 + index * 100;
  const completedAtMs = overrides.completed_at_ms ?? startedAtMs + 25;
  const unsigned = {
    check_run_version: 'builder-check-run.v1',
    admission_id: overrides.admission_id ?? `builder-check-run-admission:${hex(index)}`,
    admission_digest: overrides.admission_digest ?? `sha256:${hex(index)}`,
    approval_id: overrides.approval_id ?? `builder-check-run-execution-approval:${hex(index + 1)}`,
    approval_digest: overrides.approval_digest ?? `sha256:${hex(index + 1)}`,
    project_id: overrides.project_id ?? PROJECT_ID,
    conversation_id: 'builder-conversation:33333333-3333-4333-8333-333333333333',
    turn_id: 'builder-turn:44444444-4444-4444-8444-444444444444',
    task_id: 'builder-task:55555555-5555-4555-8555-555555555555',
    run_id: 'builder-run:66666666-6666-4666-8666-666666666666',
    draft_id: `builder-generation-draft:${'7'.repeat(64)}`,
    draft_checkpoint_id: `builder-draft-checkpoint:${'8'.repeat(64)}`,
    draft_checkpoint_sequence: overrides.draft_checkpoint_sequence ?? 1,
    candidate_id: overrides.candidate_id ?? CANDIDATE_ID,
    candidate_digest: `sha256:${'9'.repeat(64)}`,
    resulting_tree_digest: `sha256:${'a'.repeat(64)}`,
    command_profile_id: `builder-command-profile:${hex(index, 32)}`,
    command_kind: 'lint',
    command_display: 'npm run lint',
    script_digest: `sha256:${hex(index + 2)}`,
    runtime_identity_id: runtime.runtime_identity_id,
    runtime_identity_digest: runtime.runtime_identity_digest,
    package_manager: runtime.package_manager,
    launcher_kind: runtime.launcher_kind,
    launcher_binary_digest: runtime.launcher_binary_digest,
    cli_entry_digest: runtime.cli_entry_digest,
    package_manager_version: runtime.package_manager_version,
    invocation_digest: `sha256:${hex(index + 3)}`,
    execution_policy: { ...EXECUTION_POLICY },
    status,
    exit_code: status === 'passed' ? 0 : status === 'failed' ? 1 : null,
    output_digest: overrides.output_digest ?? `sha256:${hex(index + 4)}`,
    failure_class: FAILURE_BY_STATUS[status],
    started_at_ms: startedAtMs,
    completed_at_ms: completedAtMs,
    output_summary: SUMMARY_BY_STATUS[status],
    authority: { ...AUTHORITY },
  };
  const digest = digestBody(unsigned);
  return freezeDeep({
    ...unsigned,
    check_run_id: `builder-check-run:${digest.slice('sha256:'.length)}`,
    check_run_digest: digest,
  });
}

function assertStoreError(fn, code = 'builder_check_run_store_invalid') {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof BuilderCheckRunStoreError);
    assert.equal(error.code, code);
    assert.doesNotMatch(
      `${error.name}:${error.message}:${error.stack}`,
      /npm run lint|candidate source|provider|credential|secret|api[_-]?key|C:\\|raw output/iu,
    );
    return true;
  });
}

test('records, replays, reads, and restores a revised admission-bound CheckRun', (t) => {
  const databasePath = temporaryDatabase(t);
  const current = checkRun(1);
  const store = createBuilderCheckRunStore(databasePath);

  assert.equal(store.store_version, BUILDER_CHECK_RUN_STORE_VERSION);
  const recorded = store.record_check_run({ check_run: current });
  assert.equal(recorded.result_version, BUILDER_CHECK_RUN_STORE_RESULT_VERSION);
  assert.equal(recorded.operation, 'check_run_recorded');
  assert.deepEqual(recorded.check_run, current);
  assert.equal(recorded.store_evidence.store_authority, 'main_owned_check_run_store');
  assert.equal(recorded.store_evidence.check_run_contract_authority, 'main_owned_check_run_contract_v1');
  assert.equal(recorded.store_evidence.schema_version, BUILDER_CHECK_RUN_STORE_SCHEMA_VERSION);
  assert.equal(recorded.store_evidence.user_version, BUILDER_CHECK_RUN_STORE_USER_VERSION);
  assert.equal(recorded.store_evidence.command_execution, false);
  assert.equal(recorded.store_evidence.ipc_authority, 'not_present');
  assert.equal(recorded.store_evidence.provider_dispatch, false);
  assert.equal(recorded.store_evidence.source_write, 'not_present');
  assert.equal(recorded.store_evidence.git_mutation, false);
  assert.equal(recorded.store_evidence.save_authority, false);

  const replayed = store.record_check_run({ check_run: current });
  assert.equal(replayed.operation, 'check_run_replayed');
  assert.deepEqual(replayed.check_run, current);

  const latest = store.read_latest_check_run({
    project_id: PROJECT_ID,
    candidate_id: CANDIDATE_ID,
  });
  assert.equal(latest.result_version, BUILDER_CHECK_RUN_STORE_READ_RESULT_VERSION);
  assert.equal(latest.operation, 'latest_check_run_read');
  assert.equal(latest.status, 'ready');
  assert.deepEqual(latest.check_run, current);

  store.close();
  const restarted = createBuilderCheckRunStore(databasePath);
  assert.deepEqual(restarted.read_latest_check_run({
    project_id: PROJECT_ID,
    candidate_id: CANDIDATE_ID,
  }).check_run, current);
  restarted.close();
});

test('reads latest and lists bounded CheckRuns only within project and candidate boundaries', (t) => {
  const store = createBuilderCheckRunStore(temporaryDatabase(t));
  const first = checkRun(1, { completed_at_ms: 1_100, started_at_ms: 1_000 });
  const second = checkRun(2, { completed_at_ms: 2_100, started_at_ms: 2_000 });
  const third = checkRun(3, { completed_at_ms: 3_100, started_at_ms: 3_000 });
  const otherCandidate = checkRun(4, {
    candidate_id: OTHER_CANDIDATE_ID,
    completed_at_ms: 4_100,
    started_at_ms: 4_000,
  });
  const otherProject = checkRun(5, {
    project_id: OTHER_PROJECT_ID,
    candidate_id: CANDIDATE_ID,
    completed_at_ms: 5_100,
    started_at_ms: 5_000,
  });
  for (const value of [first, second, third, otherCandidate, otherProject]) {
    store.record_check_run({ check_run: value });
  }

  assert.deepEqual(store.read_latest_check_run({
    project_id: PROJECT_ID,
    candidate_id: CANDIDATE_ID,
  }).check_run, third);
  const listed = store.list_check_runs({
    project_id: PROJECT_ID,
    candidate_id: CANDIDATE_ID,
    limit: 2,
  });
  assert.equal(listed.operation, 'check_runs_listed');
  assert.equal(listed.status, 'ready');
  assert.equal(listed.limit, 2);
  assert.equal(listed.truncated, true);
  assert.deepEqual(listed.check_runs, [third, second]);

  const absent = store.read_latest_check_run({
    project_id: OTHER_PROJECT_ID,
    candidate_id: OTHER_CANDIDATE_ID,
  });
  assert.equal(absent.status, 'absent');
  assert.equal(absent.check_run, null);
  store.close();
});

test('fails closed when one admission is replayed with a different terminal result', (t) => {
  const store = createBuilderCheckRunStore(temporaryDatabase(t));
  const passed = checkRun(1);
  const failed = checkRun(9, {
    admission_id: passed.admission_id,
    admission_digest: passed.admission_digest,
    approval_id: passed.approval_id,
    approval_digest: passed.approval_digest,
    status: 'failed',
    started_at_ms: passed.started_at_ms,
    completed_at_ms: passed.completed_at_ms,
  });
  store.record_check_run({ check_run: passed });
  assertStoreError(
    () => store.record_check_run({ check_run: failed }),
    'builder_check_run_store_conflict',
  );
  store.close();
});

test('consumes each one-shot execution approval at most once', (t) => {
  const store = createBuilderCheckRunStore(temporaryDatabase(t));
  const first = checkRun(1);
  const reusedApproval = checkRun(2, {
    approval_id: first.approval_id,
    approval_digest: first.approval_digest,
  });
  store.record_check_run({ check_run: first });
  assertStoreError(
    () => store.record_check_run({ check_run: reusedApproval }),
    'builder_check_run_store_conflict',
  );
  store.close();
});

test('rejects malformed payloads, accessors, proxies, and unsafe list limits', (t) => {
  const store = createBuilderCheckRunStore(temporaryDatabase(t));
  const current = checkRun(1);
  assertStoreError(() => store.record_check_run({ check_run: current, ipc: true }));
  assertStoreError(() => store.record_check_run(new Proxy({ check_run: current }, {})));
  const accessor = {};
  Object.defineProperty(accessor, 'check_run', {
    enumerable: true,
    get() {
      throw new Error('raw output marker');
    },
  });
  assertStoreError(() => store.record_check_run(accessor));
  assertStoreError(() => store.list_check_runs({
    project_id: PROJECT_ID,
    candidate_id: CANDIDATE_ID,
    limit: 33,
  }));
  assertStoreError(() => store.read_latest_check_run({
    project_id: PROJECT_ID,
    candidate_id: `builder-code-change-candidate:${'z'.repeat(64)}`,
  }));
  store.close();
});

test('revalidates canonical JSON and indexed integrity on every read', (t) => {
  const databasePath = temporaryDatabase(t);
  const store = createBuilderCheckRunStore(databasePath);
  const current = checkRun(1);
  store.record_check_run({ check_run: current });
  store.close();

  const db = new DatabaseSync(databasePath);
  db.prepare('UPDATE check_runs SET invocation_digest = ? WHERE check_run_id = ?').run(
    `sha256:${'f'.repeat(64)}`,
    current.check_run_id,
  );
  db.close();

  const corrupted = createBuilderCheckRunStore(databasePath);
  assertStoreError(
    () => corrupted.read_latest_check_run({
      project_id: PROJECT_ID,
      candidate_id: CANDIDATE_ID,
    }),
    'builder_check_run_store_integrity_failed',
  );
  corrupted.close();
});

test('rejects schema drift and unsafe database paths', (t) => {
  assertStoreError(
    () => createBuilderCheckRunStore(path.join('relative', 'check-runs.sqlite')),
  );
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawfabric-builder-check-run-path-'));
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  assertStoreError(
    () => createBuilderCheckRunStore(path.join(root, 'missing', 'check-runs.sqlite')),
    'builder_check_run_store_unavailable',
  );
  assertStoreError(
    () => createBuilderCheckRunStore(root),
    'builder_check_run_store_unavailable',
  );

  const databasePath = path.join(root, 'schema.sqlite');
  const store = createBuilderCheckRunStore(databasePath);
  store.close();
  const db = new DatabaseSync(databasePath);
  db.exec('CREATE TABLE unexpected_schema_entry (value TEXT) STRICT');
  db.close();
  assertStoreError(
    () => createBuilderCheckRunStore(databasePath),
    'builder_check_run_store_integrity_failed',
  );
});

test('source remains a main-only SQLite store without runtime or mutation authority', () => {
  const source = fs.readFileSync(STORE_PATH, 'utf8');
  assert.match(source, /main_owned_check_run_store/u);
  assert.match(source, /sanitizeBuilderCheckRun/u);
  assert.match(source, /command_execution:\s*false/u);
  assert.match(source, /provider_dispatch:\s*false/u);
  assert.match(source, /source_write:\s*'not_present'/u);
  assert.match(source, /save_authority:\s*false/u);
  assert.doesNotMatch(
    source,
    /ipcMain|ipcRenderer|contextBridge|BrowserWindow|safeStorage|child_process|spawn\s*\(|execFile|fetch\s*\(|require\(['"](?:node:http|node:https|http|https)['"]\)|builder-provider|builder-git-|credential|secret_ref/iu,
  );
});
