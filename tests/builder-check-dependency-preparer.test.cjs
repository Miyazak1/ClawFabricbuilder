'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  createBuilderCheckDependencyPreparer,
  sanitizeBuilderCheckDependencyPreparationReceipt,
} = require('../electron/builder-check-dependency-preparer.cjs');
const { admittedCheck } = require('./helpers/builder-check-run-fixture.cjs');

function tempRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'builder-check-deps-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function childProcess() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => true;
  return child;
}

function harness(t, options = {}) {
  const root = tempRoot(t);
  const workspace = Object.freeze({ token: 'workspace' });
  const calls = [];
  let now = 10;
  let timeoutCallback = null;
  let timeoutDelay = null;
  const child = options.child ?? childProcess();
  const recordPreparedDependencies = options.recordPreparedDependencies;
  const preparer = createBuilderCheckDependencyPreparer({
    spawn_process(file, args, spawnOptions) {
      calls.push(['spawn', file, args, spawnOptions]);
      return child;
    },
    terminate_process_tree(request) {
      calls.push(['terminate', request.reason, request.child === child]);
      return true;
    },
    workspace_materializer: {
      read_workspace_path(input) {
        calls.push(['read_workspace_path', input === workspace]);
        return root;
      },
      ...(recordPreparedDependencies === undefined ? {} : {
        record_prepared_dependencies(input) {
          calls.push(['record_prepared_dependencies', input === workspace]);
          return recordPreparedDependencies(input);
        },
      }),
    },
    clock: {
      now_ms() { return now++; },
      set_timeout(callback, delay) {
        timeoutCallback = callback;
        timeoutDelay = delay;
        return Object.freeze({ timer: 'dependency' });
      },
      clear_timeout(timer) {
        calls.push(['clear_timeout', timer.timer]);
      },
    },
  });
  return {
    calls,
    child,
    root,
    selected: admittedCheck('npm', 'test', { devDependencies: { vite: '^5.0.0' } }),
    preparer,
    workspace,
    get timeoutCallback() { return timeoutCallback; },
    get timeoutDelay() { return timeoutDelay; },
  };
}

test('runs npm install in the isolated check workspace and returns a redacted receipt', async (t) => {
  const h = harness(t);
  const pending = h.preparer.prepare_dependencies({
    check_run_admission: h.selected.admission,
    workspace_admission: h.workspace,
    package_manager: 'npm',
  });
  h.child.stdout.emit('data', 'installed ok');
  h.child.stderr.emit('data', Buffer.from('warn only'));
  h.child.emit('close', 0, null);
  const receipt = sanitizeBuilderCheckDependencyPreparationReceipt(await pending);
  const spawn = h.calls.find((entry) => entry[0] === 'spawn');

  assert.equal(spawn[1], process.platform === 'win32' ? (process.env.ComSpec || path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'cmd.exe')) : 'npm');
  assert.deepEqual(spawn[2], process.platform === 'win32'
    ? ['/d', '/s', '/c', 'npm', 'install', '--ignore-scripts', '--no-audit', '--no-fund']
    : ['install', '--ignore-scripts', '--no-audit', '--no-fund']);
  assert.equal(spawn[3].cwd, h.root);
  assert.equal(spawn[3].shell, false);
  assert.equal(spawn[3].stdio[0], 'ignore');
  assert.equal(spawn[3].windowsHide, true);
  assert.equal(spawn[3].env.HOME, h.root);
  assert.equal(spawn[3].env.USERPROFILE, h.root);
  assert.equal(receipt.status, 'prepared');
  assert.equal(receipt.install_command, 'npm install');
  assert.equal(receipt.authority.project_workspace_write, false);
  assert.equal(receipt.authority.check_workspace_write, true);
  assert.equal(receipt.authority.raw_output, 'digest_only');
  assert.equal(JSON.stringify(receipt).includes(h.root), false);
  assert.equal(JSON.stringify(receipt).includes('installed ok'), false);
  assert.equal(Object.isFrozen(receipt), true);
});

test('uses npm ci when the candidate check workspace has a package lockfile', async (t) => {
  const h = harness(t);
  fs.writeFileSync(path.join(h.root, 'package-lock.json'), '{}\n');
  const pending = h.preparer.prepare_dependencies({
    check_run_admission: h.selected.admission,
    workspace_admission: h.workspace,
    package_manager: 'npm',
  });
  h.child.emit('close', 0, null);
  const receipt = await pending;
  const spawn = h.calls.find((entry) => entry[0] === 'spawn');

  assert.deepEqual(spawn[2], process.platform === 'win32'
    ? ['/d', '/s', '/c', 'npm', 'ci', '--ignore-scripts', '--no-audit', '--no-fund']
    : ['ci', '--ignore-scripts', '--no-audit', '--no-fund']);
  assert.equal(receipt.install_command, 'npm ci');
});

test('records a reusable dependency environment only after npm exits successfully', async (t) => {
  const h = harness(t, {
    recordPreparedDependencies() {
      return Object.freeze({ status: 'stored' });
    },
  });
  const pending = h.preparer.prepare_dependencies({
    check_run_admission: h.selected.admission,
    workspace_admission: h.workspace,
    package_manager: 'npm',
  });
  h.child.emit('close', 0, null);
  const receipt = await pending;

  assert.equal(receipt.status, 'prepared');
  assert.deepEqual(h.calls.filter((entry) => entry[0] === 'record_prepared_dependencies'), [
    ['record_prepared_dependencies', true],
  ]);
});

test('does not record a dependency environment when npm fails', async (t) => {
  const h = harness(t, {
    recordPreparedDependencies() {
      throw new Error('record must not run after a failed install');
    },
  });
  const pending = h.preparer.prepare_dependencies({
    check_run_admission: h.selected.admission,
    workspace_admission: h.workspace,
    package_manager: 'npm',
  });
  h.child.emit('close', 1, null);
  const receipt = await pending;

  assert.equal(receipt.status, 'failed');
  assert.deepEqual(h.calls.filter((entry) => entry[0] === 'record_prepared_dependencies'), []);
});

test('terminates and records a timed-out receipt without leaking output', async (t) => {
  const h = harness(t);
  const pending = h.preparer.prepare_dependencies({
    check_run_admission: h.selected.admission,
    workspace_admission: h.workspace,
    package_manager: 'npm',
  });
  h.child.stdout.emit('data', 'partial private output');
  assert.equal(h.timeoutDelay, 180000);
  h.timeoutCallback();
  const receipt = await pending;

  assert.equal(receipt.status, 'timed_out');
  assert.equal(receipt.exit_code, null);
  assert.deepEqual(h.calls.filter((entry) => entry[0] === 'terminate'), [
    ['terminate', 'dependency_prepare_timed_out', true],
  ]);
  assert.equal(JSON.stringify(receipt).includes('partial private output'), false);
});

test('source boundary keeps dependency preparation main-owned and non-renderer', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-check-dependency-preparer.cjs'),
    'utf8',
  );
  assert.doesNotMatch(source, /ipcMain|ipcRenderer|contextBridge|BrowserWindow|fetch\(|api[_-]?key|Authorization/iu);
  assert.doesNotMatch(source, /saveDraft|saveVersion|git\s+commit|DatabaseSync|node:sqlite/iu);
  assert.match(source, /shell:\s*false/u);
  assert.match(source, /cmd\.exe/u);
  assert.match(source, /project_workspace_write:\s*false/u);
  assert.match(source, /raw_output:\s*'digest_only'/u);
});
