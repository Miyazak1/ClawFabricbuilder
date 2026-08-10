'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  BuilderCheckRunRunnerError,
  createBuilderCheckRunRunner,
} = require('../electron/builder-check-run-runner.cjs');
const {
  createBuilderCheckRunAdmission,
  createBuilderCheckRunExecutionApproval,
} = require('../electron/builder-check-run-admission.cjs');
const {
  createBuilderGitCandidateVerificationReceipt,
  sha256Canonical,
} = require('../electron/builder-git-receipt-contract.cjs');
const { createBuilderProjectSourceTree } = require('../electron/builder-project-source-tree.cjs');
const {
  createBuilderProjectUnderstandingSnapshot,
} = require('../electron/builder-project-understanding.cjs');
const { checkRuntimeIdentity } = require('./helpers/builder-check-runtime-identity-fixture.cjs');

const UUID = '123e4567-e89b-42d3-a456-426614174000';
const PROJECT_ID = `builder-project:${UUID}`;

function admittedCheck(manager = 'npm', kind = 'test') {
  const lock = manager === 'pnpm' ? 'pnpm-lock.yaml'
    : manager === 'yarn' ? 'yarn.lock'
      : manager === 'bun' ? 'bun.lock' : null;
  const files = [{
    path: 'package.json',
    content: `${JSON.stringify({ scripts: { [kind]: 'fixed-script' } })}\n`,
  }];
  if (lock) files.push({ path: lock, content: 'lock\n' });
  const tree = createBuilderProjectSourceTree({ files });
  const understanding = createBuilderProjectUnderstandingSnapshot({
    project_id: PROJECT_ID,
    root_digest: `sha256:${'1'.repeat(64)}`,
    source_tree: tree,
    previous_successful_check_runs: [],
    updated_at_ms: 90,
  });
  const seed = {
    receipt_version: 'builder-git-candidate-receipt.v1',
    repository_version: 'builder-git-project-repository.v1',
    project_id: PROJECT_ID,
    conversation_id: `builder-conversation:${UUID}`,
    turn_id: `builder-turn:${UUID}`,
    task_id: `builder-task:${UUID}`,
    run_id: `builder-run:${UUID}`,
    request_id: `builder-git-request:${UUID}`,
    candidate_id: `builder-code-change-candidate:${'a'.repeat(64)}`,
    candidate_digest: `sha256:${'2'.repeat(64)}`,
    resulting_tree_digest: tree.source_tree_digest,
    semantic_identity_digest: `sha256:${'3'.repeat(64)}`,
    verification_receipt_digest: `sha256:${'4'.repeat(64)}`,
    object_format: 'sha1',
    commit_oid: '5'.repeat(40),
    tree_oid: '6'.repeat(40),
    parent_oid: null,
    expected_base_oid: null,
    code_authority: 'git_commit_candidate',
    product_revision_admission: 'not_recorded',
    replay: false,
  };
  const candidate = {
    ...seed,
    verification_receipt_digest: sha256Canonical(
      createBuilderGitCandidateVerificationReceipt(seed),
    ),
  };
  const verification = createBuilderGitCandidateVerificationReceipt(candidate);
  const checkpoint = {
    checkpoint_id: `builder-draft-checkpoint:${'7'.repeat(64)}`,
    checkpoint_sequence: 1,
    candidate_id: candidate.candidate_id,
    candidate_digest: candidate.candidate_digest,
    resulting_tree_digest: candidate.resulting_tree_digest,
  };
  const runtime = checkRuntimeIdentity({
    package_manager: manager,
    launcher_kind: manager === 'bun' ? 'native_binary' : 'node_cli',
    cli_entry_digest: manager === 'bun' ? null : `sha256:${'b'.repeat(64)}`,
  });
  const approval = createBuilderCheckRunExecutionApproval({
    draft_id: `builder-generation-draft:${'d'.repeat(64)}`,
    draft_checkpoint_ref: checkpoint,
    git_candidate_receipt: candidate,
    git_verification_receipt: verification,
    project_understanding_snapshot: understanding,
    command_profile_id: understanding.command_profiles[0].command_profile_id,
    runtime_identity: runtime,
    approved_at_ms: 100,
    expires_at_ms: 300_100,
  });
  return {
    runtime,
    admission: createBuilderCheckRunAdmission({
      execution_approval: approval,
      draft_checkpoint_ref: checkpoint,
      git_candidate_receipt: candidate,
      git_verification_receipt: verification,
      project_understanding_snapshot: understanding,
      runtime_identity: runtime,
      admitted_at_ms: 101,
    }),
  };
}

function childProcess() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.pid = 42;
  return child;
}

function harness(selected = admittedCheck(), overrides = {}) {
  let now = 102;
  let nextTimerId = 1;
  const timers = new Map();
  let spawnCall = null;
  let cleaned = 0;
  const child = childProcess();
  const workspace = {
    admission_version: 'builder-check-workspace-admission.v1',
    admission_kind: 'builder_check_workspace_admission',
    check_run_admission_id: selected.admission.admission_id,
    check_run_admission_digest: selected.admission.admission_digest,
    project_id: selected.admission.project_id,
    candidate_id: selected.admission.candidate_id,
    candidate_digest: selected.admission.candidate_digest,
    resulting_tree_digest: selected.admission.resulting_tree_digest,
    materialized_file_count: 1,
    authority: {},
  };
  const launcher = path.resolve('C:\\runtime\\node.exe');
  const cli = selected.admission.package_manager === 'bun'
    ? null : path.resolve('C:\\runtime\\cli.cjs');
  const runner = createBuilderCheckRunRunner({
    spawn_process(file, args, options) {
      spawnCall = { file, args, options };
      if (overrides.spawnError) throw new Error('secret spawn path');
      return child;
    },
    clock: {
      now_ms: () => now,
      set_timeout(callback, delayMs) {
        const timerId = nextTimerId;
        nextTimerId += 1;
        timers.set(timerId, { callback, delayMs });
        return timerId;
      },
      clear_timeout(timerId) { timers.delete(timerId); },
    },
    workspace_materializer: {
      read_workspace_path: () => path.resolve('C:\\checks\\candidate'),
      cleanup() { cleaned += 1; },
    },
    runtime_registry: {
      read_private_runtime: ({ runtime_identity: identity }) => ({
        runtime_identity: identity,
        launcher_path: launcher,
        cli_entry_path: cli,
      }),
    },
    terminate_process_tree: overrides.terminate ?? (async () => true),
  });
  return {
    selected, workspace, child, runner,
    get spawnCall() { return spawnCall; },
    get cleaned() { return cleaned; },
    setNow(value) { now = value; },
    fireTimer(delayMs) {
      const entry = [...timers.entries()].find(([, timer]) => timer.delayMs === delayMs);
      assert.ok(entry, `missing timer for ${delayMs}ms`);
      timers.delete(entry[0]);
      entry[1].callback();
    },
  };
}

function runInput(h) {
  return {
    check_run_admission: h.selected.admission,
    workspace_admission: h.workspace,
    runtime_identity: h.selected.runtime,
  };
}

test('derives fixed shell-free argv for npm, pnpm, yarn, and bun', async () => {
  for (const [manager, expected] of [
    ['npm', ['run-script', 'test']],
    ['pnpm', ['run', 'test']],
    ['yarn', ['run', 'test']],
    ['bun', ['run', 'test']],
  ]) {
    const h = harness(admittedCheck(manager));
    const pending = h.runner.run_check(runInput(h));
    h.child.emit('close', 0, null);
    const result = await pending;
    assert.deepEqual(h.spawnCall.args.slice(manager === 'bun' ? 0 : 1), expected);
    assert.equal(h.spawnCall.options.shell, false);
    assert.doesNotMatch(h.spawnCall.file, /cmd\.exe|npm\.cmd/iu);
    assert.equal(result.status, 'passed');
    assert.equal(h.cleaned, 1);
  }
});

test('uses a minimal environment and strips inherited secrets', async () => {
  process.env.CLAWFABRIC_TEST_API_KEY = 'secret-value';
  const h = harness();
  const pending = h.runner.run_check(runInput(h));
  h.child.emit('close', 0, null);
  await pending;
  assert.equal(Object.hasOwn(h.spawnCall.options.env, 'CLAWFABRIC_TEST_API_KEY'), false);
  assert.equal(Object.hasOwn(h.spawnCall.options.env, 'NODE_OPTIONS'), false);
  assert.equal(h.spawnCall.options.env.CI, '1');
  delete process.env.CLAWFABRIC_TEST_API_KEY;
});

test('records timeout, cancellation, and output overflow after process-tree termination', async () => {
  const timeout = harness();
  const timed = timeout.runner.run_check(runInput(timeout));
  timeout.setNow(120_102);
  timeout.fireTimer(timeout.selected.admission.timeout_ms);
  assert.equal(timeout.cleaned, 0);
  timeout.child.emit('close', null, 'SIGTERM');
  assert.equal((await timed).status, 'timed_out');
  assert.equal(timeout.cleaned, 1);

  const cancelled = harness();
  const cancelling = cancelled.runner.run_check(runInput(cancelled));
  assert.equal(cancelled.runner.cancel_check({
    check_run_admission: cancelled.selected.admission,
  }), true);
  assert.equal(cancelled.cleaned, 0);
  cancelled.child.emit('close', null, 'SIGTERM');
  assert.equal((await cancelling).status, 'cancelled');
  assert.equal(cancelled.cleaned, 1);

  const overflow = harness();
  const overflowing = overflow.runner.run_check(runInput(overflow));
  overflow.child.stdout.emit('data', Buffer.alloc(overflow.selected.admission.output_budget_bytes + 1));
  assert.equal(overflow.cleaned, 0);
  overflow.child.emit('close', null, 'SIGTERM');
  assert.equal((await overflowing).status, 'output_exceeded');
  assert.equal(overflow.cleaned, 1);
});

test('records spawn and termination failures with fixed redacted results', async () => {
  const spawn = harness(admittedCheck(), { spawnError: true });
  assert.equal((await spawn.runner.run_check(runInput(spawn))).status, 'spawn_failed');
  assert.equal(spawn.cleaned, 1);

  const termination = harness(admittedCheck(), { terminate: async () => false });
  const pending = termination.runner.run_check(runInput(termination));
  termination.fireTimer(termination.selected.admission.timeout_ms);
  assert.equal((await pending).status, 'termination_failed');
  assert.equal(termination.cleaned, 0);

  const unconfirmed = harness();
  const unconfirmedPending = unconfirmed.runner.run_check(runInput(unconfirmed));
  unconfirmed.fireTimer(unconfirmed.selected.admission.timeout_ms);
  await Promise.resolve();
  unconfirmed.setNow(135_102);
  unconfirmed.fireTimer(15_000);
  assert.equal((await unconfirmedPending).status, 'termination_failed');
  assert.equal(unconfirmed.cleaned, 0);

  const hangingTerminator = harness(admittedCheck(), {
    terminate: () => new Promise(() => {}),
  });
  const hangingPending = hangingTerminator.runner.run_check(runInput(hangingTerminator));
  hangingTerminator.fireTimer(hangingTerminator.selected.admission.timeout_ms);
  hangingTerminator.setNow(135_102);
  hangingTerminator.fireTimer(15_000);
  assert.equal((await hangingPending).status, 'termination_failed');
  assert.equal(hangingTerminator.cleaned, 0);
});

test('hashes bounded stdout and stderr independently of stream chunking', async () => {
  const first = harness();
  const firstPending = first.runner.run_check(runInput(first));
  first.child.stdout.emit('data', Buffer.from('hello '));
  first.child.stdout.emit('data', Buffer.from('world'));
  first.child.stderr.emit('data', Buffer.from('warning'));
  first.child.emit('close', 0, null);

  const second = harness();
  const secondPending = second.runner.run_check(runInput(second));
  second.child.stdout.emit('data', Buffer.from('hello world'));
  second.child.stderr.emit('data', Buffer.from('war'));
  second.child.stderr.emit('data', Buffer.from('ning'));
  second.child.emit('close', 0, null);

  assert.equal((await firstPending).output_digest, (await secondPending).output_digest);
});

test('rejects runtime and workspace identity mismatch with a fixed error', async () => {
  const h = harness();
  await assert.rejects(h.runner.run_check({
    ...runInput(h),
    runtime_identity: checkRuntimeIdentity({
      launcher_binary_digest: `sha256:${'f'.repeat(64)}`,
    }),
  }), (error) => {
    assert.ok(error instanceof BuilderCheckRunRunnerError);
    assert.equal(error.code, 'builder_check_run_runner_failed');
    assert.equal(error.message, 'The project check could not be run.');
    assert.doesNotMatch(JSON.stringify(error), /runtime|candidate|sha256|secret|path/iu);
    return true;
  });
});

test('source remains a shell-free main runner without provider, Git, SQLite, or save authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-check-run-runner.cjs'),
    'utf8',
  );
  assert.match(source, /shell: false/u);
  assert.doesNotMatch(source, /shell:\s*true|npm\.cmd|cmd\.exe['"]\s*,\s*\[/iu);
  assert.doesNotMatch(source, /\.\.\.process\.env|API_KEY|TOKEN|AUTHORIZATION/u);
  assert.doesNotMatch(source, /ipcMain|preload|BrowserWindow|fetch\s*\(|https?:\/\//iu);
  assert.doesNotMatch(source, /DatabaseSync|node:sqlite|git\s+commit|saveDraft|saveVersion/iu);
});
