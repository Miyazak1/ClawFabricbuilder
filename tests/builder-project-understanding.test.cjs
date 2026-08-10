'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  createBuilderProjectSourceTree,
} = require('../electron/builder-project-source-tree.cjs');
const {
  BUILDER_COMMAND_PROFILE_VERSION,
  BUILDER_PROJECT_UNDERSTANDING_SNAPSHOT_VERSION,
  BuilderProjectUnderstandingError,
  createBuilderProjectUnderstandingSnapshot,
} = require('../electron/builder-project-understanding.cjs');

const PROJECT_ID = 'builder-project:11111111-1111-4111-8111-111111111111';
const ROOT_DIGEST = `sha256:${'1'.repeat(64)}`;

function sourceTree(files) {
  return createBuilderProjectSourceTree({ files });
}

function request(overrides = {}) {
  return {
    project_id: PROJECT_ID,
    root_digest: ROOT_DIGEST,
    source_tree: sourceTree([
      {
        path: 'package.json',
        content: `${JSON.stringify({
          scripts: {
            build: 'vite build',
            lint: 'eslint .',
            test: 'vitest run',
            typecheck: 'tsc -b --pretty false',
          },
          dependencies: { '@vitejs/plugin-react': 'latest', vite: 'latest' },
          devDependencies: { typescript: 'latest' },
        })}\n`,
      },
      { path: 'package-lock.json', content: '{}\n' },
      { path: 'index.html', content: '<div id="root"></div>\n' },
      { path: 'src/main.tsx', content: 'import "./app";\n' },
      { path: 'vite.config.ts', content: 'export default {};\n' },
      { path: 'tsconfig.json', content: '{}\n' },
      { path: 'README.md', content: '# App\n' },
    ]),
    previous_successful_check_runs: [],
    updated_at_ms: 1_000,
    ...overrides,
  };
}

function expectInvalid(fn, forbidden = []) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof BuilderProjectUnderstandingError);
    assert.equal(error.code, 'builder_project_understanding_invalid');
    const serialized = JSON.stringify({
      name: error.name,
      code: error.code,
      message: error.message,
      stack: error.stack,
    });
    for (const marker of forbidden) assert.doesNotMatch(serialized, new RegExp(marker, 'iu'));
    return true;
  });
}

test('creates a Node/frontend project understanding snapshot with command profiles', () => {
  const snapshot = createBuilderProjectUnderstandingSnapshot(request({
    previous_successful_check_runs: [{
      command_kind: 'build',
      command_display: 'npm run build',
      cwd: '.',
      completed_at_ms: 900,
    }],
  }));

  assert.equal(snapshot.snapshot_version, BUILDER_PROJECT_UNDERSTANDING_SNAPSHOT_VERSION);
  assert.equal(snapshot.project_id, PROJECT_ID);
  assert.equal(snapshot.root_digest, ROOT_DIGEST);
  assert.deepEqual(snapshot.detected_stack, ['node', 'frontend']);
  assert.equal(snapshot.package_manager, 'npm');
  assert.equal(snapshot.entrypoints[0].path, 'index.html');
  assert.equal(snapshot.entrypoints[1].path, 'src/main.tsx');
  assert.deepEqual(
    snapshot.important_paths.map((item) => item.path),
    ['package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json', 'README.md', 'index.html'],
  );
  assert.deepEqual(
    snapshot.command_profiles.map((profile) => [profile.command_kind, profile.command_display]),
    [
      ['lint', 'npm run lint'],
      ['typecheck', 'npm run typecheck'],
      ['test', 'npm test'],
      ['build', 'npm run build'],
    ],
  );
  assert.ok(snapshot.command_profiles.every((profile) => (
    profile.command_profile_version === BUILDER_COMMAND_PROFILE_VERSION
    && profile.project_id === PROJECT_ID
    && profile.cwd === '.'
    && profile.requires_user_approval === true
    && profile.risk_class === 'read_only_project_check'
    && profile.discovered_from === 'package.json:scripts'
    && /^sha256:[0-9a-f]{64}$/u.test(profile.script_digest)
  )));
  assert.equal(snapshot.command_profiles.at(-1).confidence, 'verified_previous_success');
  assert.deepEqual(snapshot.command_profile_ids, snapshot.command_profiles.map((profile) => (
    profile.command_profile_id
  )));
  assert.deepEqual(snapshot.unknowns, []);
  assert.equal(snapshot.stale_reason, null);
  assert.equal(snapshot.authority.command_execution, false);
  assert.equal(snapshot.authority.provider_dispatch, false);
  assert.equal(snapshot.authority.source_write, 'not_present');
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.command_profiles[0]), true);
  assert.doesNotMatch(JSON.stringify(snapshot.command_profiles), /vite build|eslint \.|vitest run|tsc -b/iu);
});

test('binds each command profile identity to the exact package script body', () => {
  const treeFor = (testScript) => sourceTree([{
    path: 'package.json',
    content: `${JSON.stringify({ scripts: { test: testScript } })}\n`,
  }, {
    path: 'package-lock.json',
    content: '{}\n',
  }]);
  const first = createBuilderProjectUnderstandingSnapshot(request({
    source_tree: treeFor('vitest run'),
  }));
  const changed = createBuilderProjectUnderstandingSnapshot(request({
    source_tree: treeFor('node --test'),
  }));

  assert.equal(first.command_profiles.length, 1);
  assert.equal(changed.command_profiles.length, 1);
  assert.notEqual(first.command_profiles[0].script_digest, changed.command_profiles[0].script_digest);
  assert.notEqual(first.command_profiles[0].command_profile_id, changed.command_profiles[0].command_profile_id);
  assert.equal(first.command_profiles[0].command_display, 'npm test');
  assert.equal(changed.command_profiles[0].command_display, 'npm test');
});

test('detects static HTML projects without inventing command profiles', () => {
  const snapshot = createBuilderProjectUnderstandingSnapshot(request({
    source_tree: sourceTree([
      { path: 'index.html', content: '<main>Hello</main>\n' },
      { path: 'styles.css', content: 'main { color: black; }\n' },
    ]),
  }));

  assert.deepEqual(snapshot.detected_stack, ['static_html']);
  assert.equal(snapshot.package_manager, 'none');
  assert.deepEqual(snapshot.command_profiles, []);
  assert.deepEqual(snapshot.command_profile_ids, []);
  assert.deepEqual(snapshot.unknowns, ['no_known_check_commands']);
  assert.deepEqual(snapshot.entrypoints, [{
    path: 'index.html',
    entry_kind: 'static_html_entry',
    confidence: 'high',
    discovered_from: 'file_tree',
  }]);
});

test('falls back to markdown text or unknown project facts without running discovery commands', () => {
  const markdown = createBuilderProjectUnderstandingSnapshot(request({
    source_tree: sourceTree([{ path: 'README.md', content: '# Notes\n' }]),
  }));
  const empty = createBuilderProjectUnderstandingSnapshot(request({
    source_tree: sourceTree([]),
  }));

  assert.deepEqual(markdown.detected_stack, ['markdown_text']);
  assert.deepEqual(markdown.unknowns, ['no_known_check_commands']);
  assert.deepEqual(markdown.entrypoints, [{
    path: 'README.md',
    entry_kind: 'documentation_entry',
    confidence: 'file_hint',
    discovered_from: 'file_tree',
  }]);
  assert.deepEqual(empty.detected_stack, ['unknown']);
  assert.deepEqual(empty.unknowns, ['no_known_check_commands', 'empty_project']);
  assert.deepEqual(empty.entrypoints, []);
  assert.equal(empty.authority.command_execution, false);
  assert.equal(empty.authority.network_access, false);
});

test('supports package-manager equivalents only when declared by the manifest', () => {
  const snapshot = createBuilderProjectUnderstandingSnapshot(request({
    source_tree: sourceTree([
      {
        path: 'package.json',
        content: `${JSON.stringify({
          scripts: {
            build: 'vite build',
            deploy: 'wrangler deploy',
            test: 'vitest run',
          },
        })}\n`,
      },
      { path: 'pnpm-lock.yaml', content: 'lockfileVersion: 9\n' },
    ]),
  }));

  assert.equal(snapshot.package_manager, 'pnpm');
  assert.deepEqual(
    snapshot.command_profiles.map((profile) => [profile.command_kind, profile.command_display]),
    [
      ['test', 'pnpm test'],
      ['build', 'pnpm run build'],
    ],
  );
  assert.doesNotMatch(JSON.stringify(snapshot), /deploy|wrangler/u);
});

test('fails closed on malformed input, proxies, accessors, and source digest drift', () => {
  const valid = request();
  const drifted = structuredClone(valid);
  drifted.source_tree.files[0].content += ' ';
  expectInvalid(() => createBuilderProjectUnderstandingSnapshot(drifted), ['package']);

  const extra = { ...valid, renderer_authority: true };
  expectInvalid(() => createBuilderProjectUnderstandingSnapshot(extra));

  const accessor = {};
  Object.defineProperty(accessor, 'project_id', {
    enumerable: true,
    get() {
      throw new Error('leak-marker');
    },
  });
  for (const key of ['root_digest', 'source_tree', 'previous_successful_check_runs', 'updated_at_ms']) {
    Object.defineProperty(accessor, key, { enumerable: true, value: valid[key] });
  }
  expectInvalid(() => createBuilderProjectUnderstandingSnapshot(accessor), ['leak-marker']);

  expectInvalid(() => createBuilderProjectUnderstandingSnapshot(new Proxy(valid, {})));
  expectInvalid(() => createBuilderProjectUnderstandingSnapshot({
    ...valid,
    previous_successful_check_runs: [{
      command_kind: 'build',
      command_display: 'npm run build',
      cwd: '..',
      completed_at_ms: 1,
    }],
  }));
});

test('source remains read-only project understanding without provider, command, fs, or IPC authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-project-understanding.cjs'),
    'utf8',
  );

  assert.match(source, /main_owned_project_understanding_contract_v1/u);
  assert.match(source, /command_execution:\s*false/u);
  assert.match(source, /provider_dispatch:\s*false/u);
  assert.match(source, /source_write:\s*'not_present'/u);
  assert.doesNotMatch(
    source,
    /ipcMain|ipcRenderer|contextBridge|BrowserWindow|safeStorage|child_process|spawn|execFile|exec\(|fetch\s*\(|require\(['"](?:node:fs|fs|node:http|node:https|http|https)['"]\)|builder-provider|builder-git-|credential|secret_ref/iu,
  );
});
