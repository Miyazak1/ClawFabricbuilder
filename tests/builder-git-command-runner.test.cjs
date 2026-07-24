'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough, Writable } = require('node:stream');
const test = require('node:test');

const {
  BUILDER_GIT_RUNNER_VERSION,
  BuilderGitCommandRunnerError,
  ZERO_OID,
  createBuilderGitCommandRunner,
  createDefaultBuilderGitCommandRunner,
} = require('../electron/builder-git-command-runner.cjs');

function temporaryRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'clawfabric-builder-git-runner-'));
}

function fakeChild(onSpawn) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new Writable({
    write(chunk, encoding, callback) {
      onSpawn.stdin.push(Buffer.from(chunk));
      callback();
    },
    final(callback) {
      callback();
      setImmediate(() => {
        if (onSpawn.output) child.stdout.write(onSpawn.output);
        child.stdout.end();
        child.stderr.end();
        child.emit('close', onSpawn.exitCode ?? 0, null);
      });
    },
  });
  child.kill = () => {
    onSpawn.killed = true;
    return true;
  };
  return child;
}

function expectCode(code, forbidden = []) {
  return (error) => {
    assert.ok(error instanceof BuilderGitCommandRunnerError);
    assert.equal(error.code, code);
    const serialized = JSON.stringify({
      name: error.name,
      code: error.code,
      message: error.message,
      stack: error.stack,
    });
    for (const marker of forbidden) assert.doesNotMatch(serialized, new RegExp(marker, 'iu'));
    return true;
  };
}

test('uses Dugite embedded Git even when PATH and LOCAL_GIT_DIRECTORY are hostile', async () => {
  const root = temporaryRoot();
  const repository = path.join(root, 'project');
  const runtime = path.join(root, 'runtime');
  fs.mkdirSync(repository);
  const previous = {
    PATH: process.env.PATH,
    LOCAL_GIT_DIRECTORY: process.env.LOCAL_GIT_DIRECTORY,
    PROVIDER_API_KEY: process.env.PROVIDER_API_KEY,
  };
  process.env.PATH = '';
  process.env.LOCAL_GIT_DIRECTORY = path.join(root, 'not-git');
  process.env.PROVIDER_API_KEY = 'runner-secret-canary-value';
  try {
    const runner = createDefaultBuilderGitCommandRunner({ runtime_root: runtime });
    const initialized = await runner.run('init_repository', repository, {});
    const format = await runner.run('read_object_format', repository, {});
    assert.equal(initialized.runner_version, BUILDER_GIT_RUNNER_VERSION);
    assert.equal(format.stdout.trim(), 'sha1');
    assert.doesNotMatch(JSON.stringify([initialized, format]), /runner-secret|not-git/iu);
    assert.equal(fs.statSync(path.join(repository, '.git')).isDirectory(), true);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('passes a fixed plumbing argv and exact minimal environment to the child', async () => {
  const root = temporaryRoot();
  const repository = path.join(root, 'project');
  fs.mkdirSync(repository);
  const evidence = { stdin: [] };
  const secretMarker = 'private-provider-env-canary';
  process.env.BUILDER_PROVIDER_SECRET = secretMarker;
  process.env.LOCAL_GIT_DIRECTORY = path.join(root, 'override');
  process.env.GIT_CONFIG_COUNT = '9';
  process.env.GIT_ASKPASS = secretMarker;
  process.env.SSH_AUTH_SOCK = secretMarker;
  try {
    const runner = createBuilderGitCommandRunner({
      runtime_root: path.join(root, 'runtime'),
      spawn_process(command, args, options) {
        evidence.command = command;
        evidence.args = args;
        evidence.options = options;
        evidence.output = 'sha1\n';
        return fakeChild(evidence);
      },
    });
    const result = await runner.run('read_object_format', repository, {});
    assert.equal(result.stdout, 'sha1\n');
    assert.match(evidence.command.replaceAll('\\', '/'), /node_modules\/dugite\/git\/cmd\/git\.exe$/iu);
    assert.deepEqual(evidence.args.slice(-2), ['rev-parse', '--show-object-format']);
    assert.equal(evidence.args[0], '--no-replace-objects');
    assert.equal(evidence.options.shell, false);
    assert.equal(evidence.options.env.GIT_CONFIG_NOSYSTEM, '1');
    assert.equal(evidence.options.env.GIT_TERMINAL_PROMPT, '0');
    assert.equal(evidence.options.env.GIT_OPTIONAL_LOCKS, '0');
    assert.equal(evidence.options.env.GIT_NO_REPLACE_OBJECTS, '1');
    assert.equal(evidence.options.env.GIT_CONFIG_COUNT, undefined);
    assert.equal(evidence.options.env.LOCAL_GIT_DIRECTORY, undefined);
    assert.equal(evidence.options.env.GIT_ASKPASS, undefined);
    assert.equal(evidence.options.env.SSH_AUTH_SOCK, undefined);
    assert.equal(evidence.options.env.BUILDER_PROVIDER_SECRET, undefined);
    assert.doesNotMatch(JSON.stringify(evidence), new RegExp(secretMarker, 'u'));
  } finally {
    delete process.env.BUILDER_PROVIDER_SECRET;
    delete process.env.LOCAL_GIT_DIRECTORY;
    delete process.env.GIT_CONFIG_COUNT;
    delete process.env.GIT_ASKPASS;
    delete process.env.SSH_AUTH_SOCK;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('ignores hostile local config, replace refs, hooks, attributes, and filters', async () => {
  const root = temporaryRoot();
  const repository = path.join(root, 'project');
  const runtime = path.join(root, 'runtime');
  fs.mkdirSync(repository);
  const runner = createDefaultBuilderGitCommandRunner({ runtime_root: runtime });
  try {
    await runner.run('init_repository', repository, {});
    fs.writeFileSync(
      path.join(repository, '.git', 'config'),
      [
        '[core]',
        '\thooksPath = .git/hooks',
        '[filter "evil"]',
        '\tclean = powershell.exe -NoProfile -Command "Write-Output poisoned"',
        '',
      ].join('\n'),
    );
    fs.mkdirSync(path.join(repository, '.git', 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(repository, '.git', 'hooks', 'pre-commit'), 'exit 1\n');
    fs.writeFileSync(path.join(repository, '.gitattributes'), '* filter=evil\n');

    const safe = await runner.run('hash_blob', repository, {
      object_format: 'sha1',
      content: 'safe content\n',
    });
    const poison = await runner.run('hash_blob', repository, {
      object_format: 'sha1',
      content: 'poisoned content\n',
    });
    const safeOid = safe.stdout.trim();
    const poisonOid = poison.stdout.trim();
    fs.mkdirSync(path.join(repository, '.git', 'refs', 'replace'), { recursive: true });
    fs.writeFileSync(path.join(repository, '.git', 'refs', 'replace', safeOid), `${poisonOid}\n`);

    const read = await runner.run('read_blob', repository, {
      object_format: 'sha1',
      oid: safeOid,
    });
    assert.equal(read.stdout, 'safe content\n');

    const indexPath = path.join(repository, '.git', 'clawfabric', 'indexes', 'hostile.index');
    fs.mkdirSync(path.dirname(indexPath), { recursive: true });
    await runner.run('reset_index_empty', repository, { index_path: indexPath });
    await runner.run('write_index', repository, {
      index_path: indexPath,
      entries: [{ path: 'index.html', oid: safeOid }],
    });
    const tree = await runner.run('write_tree', repository, { index_path: indexPath });
    const commit = await runner.run('commit_tree', repository, {
      object_format: 'sha1',
      tree_oid: tree.stdout.trim(),
      parent_oid: null,
      project_id: 'builder-project:123e4567-e89b-42d3-a456-426614174000',
      conversation_id: 'builder-conversation:123e4567-e89b-42d3-a456-426614174000',
      turn_id: 'builder-turn:00000000-0000-4000-8000-000000000001',
      task_id: 'builder-task:00000000-0000-4000-8000-000000000001',
      run_id: 'builder-run:00000000-0000-4000-8000-000000000001',
      request_id: 'builder-git-request:00000000-0000-4000-8000-000000000001',
      semantic_identity_digest: `sha256:${'1'.repeat(64)}`,
      candidate_digest: `sha256:${'2'.repeat(64)}`,
      expected_base_oid: null,
      author_time: 1_750_000_000,
    });
    assert.match(commit.stdout.trim(), /^[0-9a-f]{40}$/u);
    const missingMain = await runner.run('read_main_ref', repository, {
      object_format: 'sha1',
    });
    assert.equal(missingMain.found, false);
    await runner.run('update_main_ref', repository, {
      object_format: 'sha1',
      commit_oid: commit.stdout.trim(),
      expected_old_oid: null,
    });
    const main = await runner.run('read_main_ref', repository, {
      object_format: 'sha1',
    });
    assert.equal(main.stdout.trim(), commit.stdout.trim());
    await assert.rejects(
      runner.run('update_main_ref', repository, {
        object_format: 'sha1',
        commit_oid: commit.stdout.trim(),
        expected_old_oid: ZERO_OID,
      }),
      expectCode('builder_git_command_failed'),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rejects raw commands, malformed refs, and index files outside Git control storage', async () => {
  const root = temporaryRoot();
  const repository = path.join(root, 'project');
  fs.mkdirSync(repository);
  const runner = createDefaultBuilderGitCommandRunner({ runtime_root: path.join(root, 'runtime') });
  try {
    await assert.rejects(
      runner.run('status', repository, {}),
      expectCode('builder_git_command_invalid'),
    );
    await assert.rejects(
      runner.run('read_request', repository, { request_hash: '../main' }),
      expectCode('builder_git_command_invalid'),
    );
    await assert.rejects(
      runner.run('read_main_ref', repository, { object_format: 'sha1', ref: 'refs/heads/dev' }),
      expectCode('builder_git_command_invalid'),
    );
    await assert.rejects(
      runner.run('update_main_ref', repository, {
        object_format: 'sha1',
        commit_oid: 'not-an-oid',
        expected_old_oid: null,
      }),
      expectCode('builder_git_command_invalid'),
    );
    await assert.rejects(
      runner.run('update_main_ref', repository, {
        object_format: 'sha1',
        commit_oid: ZERO_OID,
        expected_old_oid: null,
      }),
      expectCode('builder_git_command_invalid'),
    );
    await assert.rejects(
      runner.run('write_tree', repository, { index_path: path.join(root, 'outside.index') }),
      expectCode('builder_git_command_invalid'),
    );
    await runner.run('init_repository', repository, {});
    const clawfabricControl = path.join(repository, '.git', 'clawfabric');
    const linkedIndexes = path.join(clawfabricControl, 'indexes');
    const externalIndexes = path.join(root, 'external-indexes');
    fs.mkdirSync(clawfabricControl, { recursive: true });
    fs.mkdirSync(externalIndexes);
    fs.symlinkSync(externalIndexes, linkedIndexes, 'junction');
    await assert.rejects(
      runner.run('write_tree', repository, { index_path: path.join(linkedIndexes, 'linked.index') }),
      expectCode('builder_git_command_invalid'),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('returns fixed redacted failures and enforces cancellation before spawn', async () => {
  const root = temporaryRoot();
  const repository = path.join(root, 'project');
  fs.mkdirSync(repository);
  const marker = 'stderr-secret-canary';
  let spawnCount = 0;
  const runner = createBuilderGitCommandRunner({
    runtime_root: path.join(root, 'runtime'),
    spawn_process() {
      spawnCount += 1;
      const evidence = { stdin: [], output: '', exitCode: 9 };
      const child = fakeChild(evidence);
      setImmediate(() => child.stderr.write(marker));
      return child;
    },
  });
  try {
    await assert.rejects(
      runner.run('read_object_format', repository, {}),
      expectCode('builder_git_command_failed', [marker]),
    );
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      runner.run('read_object_format', repository, {}, {
        timeout_ms: 100,
        signal: controller.signal,
      }),
      expectCode('builder_git_command_cancelled'),
    );
    assert.equal(spawnCount, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rejects hostile execution options without invoking proxy traps or accessors', async () => {
  const root = temporaryRoot();
  const repository = path.join(root, 'project');
  fs.mkdirSync(repository);
  let traps = 0;
  const runner = createBuilderGitCommandRunner({
    runtime_root: path.join(root, 'runtime'),
    spawn_process() {
      throw new Error('should-not-spawn');
    },
  });
  const proxyOptions = new Proxy({ timeout_ms: 100 }, {
    ownKeys() {
      traps += 1;
      return ['timeout_ms'];
    },
    getOwnPropertyDescriptor() {
      traps += 1;
      return { configurable: true, enumerable: true, value: 100 };
    },
  });
  const accessorOptions = {};
  Object.defineProperty(accessorOptions, 'timeout_ms', {
    enumerable: true,
    get: () => { throw new Error('private execution marker'); },
  });
  const proxySignal = new Proxy({}, {
    getPrototypeOf() {
      traps += 1;
      return AbortSignal.prototype;
    },
    getOwnPropertyDescriptor() {
      traps += 1;
      return { configurable: true, enumerable: true, value: false };
    },
  });
  const forgedSignal = Object.create(AbortSignal.prototype);
  Object.defineProperty(forgedSignal, 'aborted', {
    enumerable: true,
    get: () => { throw new Error('private signal marker'); },
  });
  Object.defineProperty(forgedSignal, 'addEventListener', {
    enumerable: true,
    get: () => { throw new Error('private listener marker'); },
  });
  try {
    await assert.rejects(
      runner.run('read_object_format', repository, {}, proxyOptions),
      expectCode('builder_git_command_invalid'),
    );
    assert.equal(traps, 0);
    await assert.rejects(
      runner.run('read_object_format', repository, {}, accessorOptions),
      expectCode('builder_git_command_invalid', ['private execution marker']),
    );
    await assert.rejects(
      runner.run('read_object_format', repository, {}, { timeout_ms: 100, signal: proxySignal }),
      expectCode('builder_git_command_invalid'),
    );
    assert.equal(traps, 0);
    await assert.rejects(
      runner.run('read_object_format', repository, {}, { timeout_ms: 100, signal: forgedSignal }),
      expectCode('builder_git_command_invalid', ['private signal marker', 'private listener marker']),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('honors cancellation that happens during synchronous spawn setup', async () => {
  const root = temporaryRoot();
  const repository = path.join(root, 'project');
  fs.mkdirSync(repository);
  const controller = new AbortController();
  const evidence = { spawnCount: 0, stdin: [] };
  const runner = createBuilderGitCommandRunner({
    runtime_root: path.join(root, 'runtime'),
    spawn_process() {
      evidence.spawnCount += 1;
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.stdin = new Writable({
        write(chunk, encoding, callback) {
          evidence.stdin.push(Buffer.from(chunk));
          callback();
        },
      });
      child.kill = () => {
        evidence.killed = true;
        child.emit('close', null, 'SIGTERM');
        return true;
      };
      controller.abort();
      return child;
    },
  });
  try {
    const startedAt = Date.now();
    await assert.rejects(
      runner.run('read_object_format', repository, {}, {
        timeout_ms: 10_000,
        signal: controller.signal,
      }),
      expectCode('builder_git_command_cancelled'),
    );
    assert.equal(evidence.spawnCount, 1);
    assert.equal(evidence.killed, true);
    assert.equal(Buffer.concat(evidence.stdin).toString('utf8'), '');
    assert.ok(Date.now() - startedAt < 1_000);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('terminates a bounded child on timeout without exposing process output', async () => {
  const root = temporaryRoot();
  const repository = path.join(root, 'project');
  fs.mkdirSync(repository);
  const evidence = { stdin: [] };
  const runner = createBuilderGitCommandRunner({
    runtime_root: path.join(root, 'runtime'),
    spawn_process() {
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.stdin = new Writable({ write(chunk, encoding, callback) { callback(); } });
      child.kill = () => {
        evidence.killed = true;
        setTimeout(() => child.emit('close', null, 'SIGTERM'), 25);
        return true;
      };
      return child;
    },
  });
  try {
    let settled = false;
    const pending = runner.run('read_object_format', repository, {}, { timeout_ms: 10 })
      .finally(() => {
        settled = true;
      });
    await new Promise((resolve) => { setTimeout(resolve, 15); });
    assert.equal(evidence.killed, true);
    assert.equal(settled, false);
    await assert.rejects(
      pending,
      expectCode('builder_git_command_timeout'),
    );
    assert.equal(evidence.killed, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('poisons only the same repository after termination supervision fails until child close', async () => {
  const root = temporaryRoot();
  const repository = path.join(root, 'project');
  const otherRepository = path.join(root, 'other-project');
  fs.mkdirSync(repository);
  fs.mkdirSync(otherRepository);
  const evidence = { children: [] };
  const runner = createBuilderGitCommandRunner({
    runtime_root: path.join(root, 'runtime'),
    spawn_process(command, args, options) {
      if (evidence.nextOutput) {
        const result = { stdin: [], output: evidence.nextOutput };
        evidence.nextOutput = null;
        evidence.spawnCount = (evidence.spawnCount || 0) + 1;
        return fakeChild(result);
      }
      const child = new EventEmitter();
      evidence.children.push(child);
      evidence.spawnCount = (evidence.spawnCount || 0) + 1;
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.stdin = new Writable({ write(chunk, encoding, callback) { callback(); } });
      child.kill = () => {
        evidence.killed = true;
        if (options.env.GIT_INDEX_FILE) {
          setTimeout(() => {
            fs.mkdirSync(path.dirname(options.env.GIT_INDEX_FILE), { recursive: true });
            fs.writeFileSync(options.env.GIT_INDEX_FILE, 'late index\n');
          }, 20);
        }
        return true;
      };
      return child;
    },
  });
  try {
    await assert.rejects(
      runner.run('read_object_format', repository, {}, { timeout_ms: 10 }),
      expectCode('builder_git_command_termination_failed'),
    );
    assert.equal(evidence.killed, true);
    assert.equal(evidence.spawnCount, 1);
    await assert.rejects(
      runner.run('read_object_format', repository, {}, { timeout_ms: 10 }),
      expectCode('builder_git_command_termination_failed'),
    );
    assert.equal(evidence.spawnCount, 1);
    await assert.rejects(
      runner.run('read_object_format', otherRepository, {}, { timeout_ms: 10 }),
      expectCode('builder_git_command_termination_failed'),
    );
    assert.equal(evidence.spawnCount, 2);
    evidence.children[0].emit('close', null, 'SIGTERM');
    evidence.children[1].emit('close', null, 'SIGTERM');
    evidence.nextOutput = 'sha1\n';
    const retry = await runner.run('read_object_format', repository, {}, { timeout_ms: 100 });
    assert.equal(retry.stdout, 'sha1\n');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('ignores child error after termination until close or grace poison', async () => {
  const root = temporaryRoot();
  const repository = path.join(root, 'project');
  fs.mkdirSync(repository);
  const evidence = { spawnCount: 0 };
  const runner = createBuilderGitCommandRunner({
    runtime_root: path.join(root, 'runtime'),
    spawn_process() {
      evidence.spawnCount += 1;
      if (evidence.successNext) {
        evidence.successNext = false;
        return fakeChild({ stdin: [], output: 'sha1\n' });
      }
      const child = new EventEmitter();
      evidence.child = child;
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.stdin = new Writable({ write(chunk, encoding, callback) { callback(); } });
      child.kill = () => {
        setTimeout(() => child.emit('error', new Error('late kill failure marker')), 20);
        return true;
      };
      return child;
    },
  });
  try {
    let settled = false;
    const pending = runner.run('read_object_format', repository, {}, { timeout_ms: 10 }).
      finally(() => {
        settled = true;
      });
    await new Promise((resolve) => { setTimeout(resolve, 60); });
    assert.equal(settled, false);
    await assert.rejects(
      pending,
      expectCode('builder_git_command_termination_failed', ['late kill failure marker']),
    );
    assert.equal(evidence.spawnCount, 1);
    await assert.rejects(
      runner.run('read_object_format', repository, {}, { timeout_ms: 10 }),
      expectCode('builder_git_command_termination_failed'),
    );
    assert.equal(evidence.spawnCount, 1);
    evidence.child.emit('close', null, 'SIGTERM');
    evidence.successNext = true;
    assert.equal(
      (await runner.run('read_object_format', repository, {}, { timeout_ms: 100 })).stdout,
      'sha1\n',
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('poisons same repository immediately before grace while allowing other repositories', async () => {
  const root = temporaryRoot();
  const repository = path.join(root, 'project');
  const otherRepository = path.join(root, 'other-project');
  fs.mkdirSync(repository);
  fs.mkdirSync(otherRepository);
  const evidence = { spawnCount: 0 };
  const runner = createBuilderGitCommandRunner({
    runtime_root: path.join(root, 'runtime'),
    spawn_process() {
      evidence.spawnCount += 1;
      if (evidence.successNext) {
        evidence.successNext = false;
        return fakeChild({ stdin: [], output: 'sha1\n' });
      }
      const child = new EventEmitter();
      evidence.child = child;
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.stdin = new Writable({ write(chunk, encoding, callback) { callback(); } });
      child.kill = () => true;
      return child;
    },
  });
  try {
    let settled = false;
    const pending = runner.run('read_object_format', repository, {}, { timeout_ms: 10 }).
      finally(() => {
        settled = true;
      });
    await new Promise((resolve) => { setTimeout(resolve, 40); });
    assert.equal(settled, false);
    assert.equal(evidence.spawnCount, 1);
    await assert.rejects(
      runner.run('read_object_format', repository, {}, { timeout_ms: 100 }),
      expectCode('builder_git_command_termination_failed'),
    );
    assert.equal(evidence.spawnCount, 1);
    evidence.successNext = true;
    assert.equal(
      (await runner.run('read_object_format', otherRepository, {}, { timeout_ms: 100 })).stdout,
      'sha1\n',
    );
    assert.equal(evidence.spawnCount, 2);
    evidence.child.emit('close', null, 'SIGTERM');
    await assert.rejects(pending, expectCode('builder_git_command_timeout'));
    evidence.successNext = true;
    assert.equal(
      (await runner.run('read_object_format', repository, {}, { timeout_ms: 100 })).stdout,
      'sha1\n',
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('shares termination poison across runner instances for the same repository', async () => {
  const root = temporaryRoot();
  const repository = path.join(root, 'project');
  fs.mkdirSync(repository);
  const firstEvidence = { spawnCount: 0 };
  const secondEvidence = { spawnCount: 0 };
  const firstRunner = createBuilderGitCommandRunner({
    runtime_root: path.join(root, 'runtime-a'),
    spawn_process() {
      firstEvidence.spawnCount += 1;
      const child = new EventEmitter();
      firstEvidence.child = child;
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.stdin = new Writable({ write(chunk, encoding, callback) { callback(); } });
      child.kill = () => true;
      return child;
    },
  });
  const secondRunner = createBuilderGitCommandRunner({
    runtime_root: path.join(root, 'runtime-b'),
    spawn_process() {
      secondEvidence.spawnCount += 1;
      if (secondEvidence.successNext) {
        secondEvidence.successNext = false;
        return fakeChild({ stdin: [], output: 'sha1\n' });
      }
      return fakeChild({ stdin: [], output: 'unexpected\n' });
    },
  });
  try {
    const pending = firstRunner.run('read_object_format', repository, {}, { timeout_ms: 10 });
    await new Promise((resolve) => { setTimeout(resolve, 40); });
    await assert.rejects(
      secondRunner.run('read_object_format', repository, {}, { timeout_ms: 100 }),
      expectCode('builder_git_command_termination_failed'),
    );
    assert.equal(firstEvidence.spawnCount, 1);
    assert.equal(secondEvidence.spawnCount, 0);
    firstEvidence.child.emit('close', null, 'SIGTERM');
    await assert.rejects(pending, expectCode('builder_git_command_timeout'));
    secondEvidence.successNext = true;
    assert.equal(
      (await secondRunner.run('read_object_format', repository, {}, { timeout_ms: 100 })).stdout,
      'sha1\n',
    );
    assert.equal(secondEvidence.spawnCount, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('keeps repository poisoned until every terminated child identity closes', async () => {
  const root = temporaryRoot();
  const repository = path.join(root, 'project');
  fs.mkdirSync(repository);
  const children = [];
  const runner = createBuilderGitCommandRunner({
    runtime_root: path.join(root, 'runtime'),
    spawn_process() {
      if (children.successNext) {
        children.successNext = false;
        return fakeChild({ stdin: [], output: 'sha1\n' });
      }
      const child = new EventEmitter();
      children.push(child);
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.stdin = new Writable({ write(chunk, encoding, callback) { callback(); } });
      child.kill = () => true;
      return child;
    },
  });
  try {
    await Promise.all([
      assert.rejects(
        runner.run('read_object_format', repository, {}, { timeout_ms: 10 }),
        expectCode('builder_git_command_termination_failed'),
      ),
      assert.rejects(
        runner.run('read_object_format', repository, {}, { timeout_ms: 10 }),
        expectCode('builder_git_command_termination_failed'),
      ),
    ]);
    assert.equal(children.length, 2);
    children[0].emit('close', null, 'SIGTERM');
    await assert.rejects(
      runner.run('read_object_format', repository, {}, { timeout_ms: 10 }),
      expectCode('builder_git_command_termination_failed'),
    );
    assert.equal(children.length, 2);
    children[1].emit('close', null, 'SIGTERM');
    children.successNext = true;
    assert.equal(
      (await runner.run('read_object_format', repository, {}, { timeout_ms: 100 })).stdout,
      'sha1\n',
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('cleans a terminated operation index after the late child finally closes', async () => {
  const root = temporaryRoot();
  const repository = path.join(root, 'project');
  const indexPath = path.join(repository, '.git', 'clawfabric', 'indexes', 'late-operation.index');
  fs.mkdirSync(path.dirname(indexPath), { recursive: true });
  const evidence = {};
  const runner = createBuilderGitCommandRunner({
    runtime_root: path.join(root, 'runtime'),
    spawn_process(command, args, options) {
      const child = new EventEmitter();
      evidence.child = child;
      evidence.indexPath = options.env.GIT_INDEX_FILE;
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.stdin = new Writable({ write(chunk, encoding, callback) { callback(); } });
      child.kill = () => {
        setTimeout(() => {
          fs.writeFileSync(options.env.GIT_INDEX_FILE, 'late child index\n');
        }, 20);
        return true;
      };
      return child;
    },
  });
  try {
    await assert.rejects(
      runner.run('write_tree', repository, { index_path: indexPath }, { timeout_ms: 10 }),
      expectCode('builder_git_command_termination_failed'),
    );
    assert.equal(evidence.indexPath, indexPath);
    assert.equal(fs.existsSync(indexPath), true);
    evidence.child.emit('close', null, 'SIGTERM');
    assert.equal(fs.existsSync(indexPath), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('source boundary contains no shell, Dugite execution helper, network, or provider authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-git-command-runner.cjs'),
    'utf8',
  );
  assert.match(source, /resolveGitBinary\(''\)/u);
  assert.match(source, /shell:\s*false/u);
  assert.match(source, /GIT_CONFIG_NOSYSTEM/u);
  assert.match(source, /GIT_TERMINAL_PROMPT/u);
  assert.doesNotMatch(
    source,
    /\bexecSync\b|\bexecFile\b|dugite\.(?:exec|spawn)|setupEnvironment|shell:\s*true|fetch\s*\(|https?:|Authorization|Bearer|safeStorage|ipcMain|ipcRenderer|\bpreload\b|sqlite/iu,
  );
});
