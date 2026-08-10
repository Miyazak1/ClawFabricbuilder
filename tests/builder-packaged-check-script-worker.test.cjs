'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { sha256Canonical } = require('../electron/builder-git-receipt-contract.cjs');
const {
  BuilderPackagedCheckScriptWorkerError,
  PACKAGED_NPM_SCRIPT_RUNTIME_VERSION,
  verifyBoundScript,
} = require('../electron/builder-packaged-check-script-worker.cjs');

const WORKER_PATH = path.join(
  __dirname,
  '..',
  'electron',
  'builder-packaged-check-script-worker.cjs',
);

function fixture(t, scripts) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cfb-packaged-check-'));
  fs.writeFileSync(path.join(root, 'package.json'), `${JSON.stringify({ scripts })}\n`);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function digest(kind, scripts) {
  return sha256Canonical({
    script_name: kind,
    lifecycle_scripts: {
      pre: scripts[`pre${kind}`] ?? null,
      main: scripts[kind],
      post: scripts[`post${kind}`] ?? null,
    },
  });
}

test('verifies an exact manifest script digest without executing it', (t) => {
  const scripts = { pretest: 'echo pre', test: 'echo checked', posttest: 'echo post' };
  const root = fixture(t, scripts);
  const verified = verifyBoundScript({
    workspace_path: root,
    command_kind: 'test',
    script_digest: digest('test', scripts),
  });
  assert.equal(verified.event, 'test');
  assert.equal(verified.script, 'echo checked');
  assert.equal(PACKAGED_NPM_SCRIPT_RUNTIME_VERSION, '9.0.1');
});

test('runs only the admitted main script and leaves pre/post lifecycle scripts inert', (t) => {
  const scripts = {
    pretest: 'echo PRE_SHOULD_NOT_RUN',
    test: 'echo CHECK_MAIN_RAN',
    posttest: 'echo POST_SHOULD_NOT_RUN',
  };
  const root = fixture(t, scripts);
  const result = spawnSync(process.execPath, [
    WORKER_PATH,
    'run-script',
    'test',
    digest('test', scripts),
  ], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /CHECK_MAIN_RAN/u);
  assert.doesNotMatch(result.stdout, /PRE_SHOULD_NOT_RUN|POST_SHOULD_NOT_RUN/u);
});

test('fails closed when argv, script content, digest, or package metadata drifts', (t) => {
  const scripts = { test: 'echo original' };
  const root = fixture(t, scripts);
  const expectedDigest = digest('test', scripts);
  fs.writeFileSync(path.join(root, 'package.json'), `${JSON.stringify({
    scripts: { test: 'echo changed' },
  })}\n`);

  assert.throws(() => verifyBoundScript({
    workspace_path: root,
    command_kind: 'test',
    script_digest: expectedDigest,
  }), BuilderPackagedCheckScriptWorkerError);
  assert.throws(() => verifyBoundScript({
    workspace_path: root,
    command_kind: 'install',
    script_digest: expectedDigest,
  }), BuilderPackagedCheckScriptWorkerError);

  const result = spawnSync(process.execPath, [WORKER_PATH, 'test'], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(result.status, 1);
  assert.equal(result.stderr.trim(), 'The approved project check could not be started.');
  assert.doesNotMatch(result.stderr, /echo changed|package\.json|sha256|cfb-packaged-check/iu);
});

test('worker source has no provider, Git, SQLite, install, IPC, or save authority', () => {
  const source = fs.readFileSync(WORKER_PATH, 'utf8');
  assert.doesNotMatch(source, /ipcMain|ipcRenderer|BrowserWindow|fetch\s*\(|https?:\/\//iu);
  assert.doesNotMatch(source, /DatabaseSync|node:sqlite|git\s+commit|saveDraft|saveVersion/iu);
  assert.doesNotMatch(source, /npm\s+(?:install|ci)|pnpm\s+install|yarn\s+install/iu);
});
