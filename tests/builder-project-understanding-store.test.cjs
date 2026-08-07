'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const test = require('node:test');

const {
  createBuilderProjectSourceTree,
} = require('../electron/builder-project-source-tree.cjs');
const {
  createBuilderProjectUnderstandingSnapshot,
} = require('../electron/builder-project-understanding.cjs');
const {
  BUILDER_PROJECT_UNDERSTANDING_STORE_READ_RESULT_VERSION,
  BUILDER_PROJECT_UNDERSTANDING_STORE_RESULT_VERSION,
  BUILDER_PROJECT_UNDERSTANDING_STORE_SCHEMA_VERSION,
  BUILDER_PROJECT_UNDERSTANDING_STORE_USER_VERSION,
  BUILDER_PROJECT_UNDERSTANDING_STORE_VERSION,
  BuilderProjectUnderstandingStoreError,
  createBuilderProjectUnderstandingStore,
} = require('../electron/builder-project-understanding-store.cjs');

const PROJECT_ID = 'builder-project:11111111-1111-4111-8111-111111111111';
const OTHER_PROJECT_ID = 'builder-project:22222222-2222-4222-8222-222222222222';

function temporaryDatabase(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawfabric-builder-project-understanding-'));
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  return path.join(root, 'understanding.sqlite');
}

function digest(char) {
  return `sha256:${char.repeat(64)}`;
}

function sourceTree(files) {
  return createBuilderProjectSourceTree({ files });
}

function snapshot(index = 1, overrides = {}) {
  return createBuilderProjectUnderstandingSnapshot({
    project_id: overrides.project_id ?? PROJECT_ID,
    root_digest: overrides.root_digest ?? digest(String(index)),
    source_tree: overrides.source_tree ?? sourceTree([
      {
        path: 'package.json',
        content: `${JSON.stringify({
          scripts: {
            build: 'vite build',
            lint: 'eslint .',
            test: 'vitest run',
          },
        })}\n`,
      },
      { path: 'package-lock.json', content: '{}\n' },
      { path: 'index.html', content: '<div id="root"></div>\n' },
      { path: 'src/main.tsx', content: 'import "./app";\n' },
    ]),
    previous_successful_check_runs: overrides.previous_successful_check_runs ?? [],
    updated_at_ms: overrides.updated_at_ms ?? 10_000 + index,
  });
}

function assertStoreError(fn, expectedCode = 'builder_project_understanding_store_invalid') {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof BuilderProjectUnderstandingStoreError);
    assert.equal(error.code, expectedCode);
    const text = `${error.name}:${error.message}:${error.stack}`;
    assert.doesNotMatch(
      text,
      /package\.json|src\/main|vite build|credential|provider|secret|api[_-]?key|C:\\|raw prompt/iu,
    );
    return true;
  });
}

test('records ProjectUnderstandingSnapshots and restores them after restart', (t) => {
  const databasePath = temporaryDatabase(t);
  const store = createBuilderProjectUnderstandingStore(databasePath);
  const first = snapshot(1);

  assert.equal(store.store_version, BUILDER_PROJECT_UNDERSTANDING_STORE_VERSION);
  const recorded = store.record_project_understanding_snapshot({
    project_understanding_snapshot: first,
  });
  assert.equal(recorded.result_version, BUILDER_PROJECT_UNDERSTANDING_STORE_RESULT_VERSION);
  assert.equal(recorded.operation, 'project_understanding_snapshot_recorded');
  assert.deepEqual(recorded.project_understanding.project_understanding_snapshot, first);
  assert.match(recorded.project_understanding.snapshot_digest, /^builder-project-understanding-snapshot:[0-9a-f]{64}$/u);
  assert.equal(recorded.store_evidence.store_authority, 'main_owned_project_understanding_store');
  assert.equal(recorded.store_evidence.understanding_contract_authority, 'main_owned_project_understanding_contract_v1');
  assert.equal(recorded.store_evidence.schema_version, BUILDER_PROJECT_UNDERSTANDING_STORE_SCHEMA_VERSION);
  assert.equal(recorded.store_evidence.user_version, BUILDER_PROJECT_UNDERSTANDING_STORE_USER_VERSION);
  assert.equal(recorded.store_evidence.renderer_authority, 'not_present');
  assert.equal(recorded.store_evidence.ipc_authority, 'not_present');
  assert.equal(recorded.store_evidence.provider_dispatch, false);
  assert.equal(recorded.store_evidence.tool_dispatch, false);
  assert.equal(recorded.store_evidence.command_execution, false);
  assert.equal(recorded.store_evidence.source_write, 'not_present');
  assert.equal(recorded.store_evidence.git_mutation, false);
  assert.equal(recorded.store_evidence.network_access, false);

  const replayed = store.record_project_understanding_snapshot({
    project_understanding_snapshot: first,
  });
  assert.equal(replayed.operation, 'project_understanding_snapshot_replayed');
  assert.deepEqual(replayed.project_understanding, recorded.project_understanding);

  const read = store.read_project_understanding_snapshot({
    project_id: PROJECT_ID,
    snapshot_digest: recorded.project_understanding.snapshot_digest,
  });
  assert.equal(read.result_version, BUILDER_PROJECT_UNDERSTANDING_STORE_READ_RESULT_VERSION);
  assert.equal(read.operation, 'project_understanding_snapshot_ready_read');
  assert.deepEqual(read.project_understanding, recorded.project_understanding);

  store.close();
  const restarted = createBuilderProjectUnderstandingStore(databasePath);
  const latest = restarted.read_latest_project_understanding_snapshot({ project_id: PROJECT_ID });
  assert.equal(latest.operation, 'project_understanding_latest_ready_read');
  assert.deepEqual(latest.project_understanding, recorded.project_understanding);
  restarted.close();
});

test('reads the latest snapshot per project without crossing project boundaries', (t) => {
  const store = createBuilderProjectUnderstandingStore(temporaryDatabase(t));
  const first = snapshot(1, { updated_at_ms: 1_000 });
  const second = snapshot(2, {
    updated_at_ms: 2_000,
    source_tree: sourceTree([
      { path: 'index.html', content: '<main>Static</main>\n' },
    ]),
  });
  const other = snapshot(3, {
    project_id: OTHER_PROJECT_ID,
    updated_at_ms: 3_000,
    source_tree: sourceTree([{ path: 'README.md', content: '# Other\n' }]),
  });

  const recordedFirst = store.record_project_understanding_snapshot({
    project_understanding_snapshot: first,
  }).project_understanding;
  const recordedSecond = store.record_project_understanding_snapshot({
    project_understanding_snapshot: second,
  }).project_understanding;
  const recordedOther = store.record_project_understanding_snapshot({
    project_understanding_snapshot: other,
  }).project_understanding;

  assert.notDeepEqual(recordedFirst, recordedSecond);
  assert.deepEqual(
    store.read_latest_project_understanding_snapshot({ project_id: PROJECT_ID }).project_understanding,
    recordedSecond,
  );
  assert.deepEqual(
    store.read_latest_project_understanding_snapshot({ project_id: OTHER_PROJECT_ID }).project_understanding,
    recordedOther,
  );
  const absent = store.read_latest_project_understanding_snapshot({
    project_id: 'builder-project:33333333-3333-4333-8333-333333333333',
  });
  assert.equal(absent.operation, 'project_understanding_latest_absent_read');
  assert.equal(absent.project_understanding, null);
  store.close();
});

test('rejects conflicting snapshots for the same source tree digest', (t) => {
  const store = createBuilderProjectUnderstandingStore(temporaryDatabase(t));
  const first = snapshot(1);
  const changed = {
    ...first,
    updated_at_ms: first.updated_at_ms + 1,
  };

  store.record_project_understanding_snapshot({ project_understanding_snapshot: first });
  assertStoreError(
    () => store.record_project_understanding_snapshot({ project_understanding_snapshot: changed }),
    'builder_project_understanding_store_conflict',
  );
  store.close();
});

test('fails closed on malformed input, unsafe paths, and tampered rows', (t) => {
  const databasePath = temporaryDatabase(t);
  const store = createBuilderProjectUnderstandingStore(databasePath);
  const current = snapshot(1);
  const recorded = store.record_project_understanding_snapshot({
    project_understanding_snapshot: current,
  }).project_understanding;

  assertStoreError(() => store.record_project_understanding_snapshot({
    project_understanding_snapshot: { ...current, renderer_authority: true },
  }));
  assertStoreError(() => store.read_project_understanding_snapshot({
    project_id: PROJECT_ID,
    snapshot_digest: 'builder-project-understanding-snapshot:not-a-digest',
  }));
  assertStoreError(
    () => createBuilderProjectUnderstandingStore(path.join('relative', 'understanding.sqlite')),
  );
  const accessor = {};
  Object.defineProperty(accessor, 'project_understanding_snapshot', {
    enumerable: true,
    get() {
      throw new Error('secret marker');
    },
  });
  assertStoreError(() => store.record_project_understanding_snapshot(accessor), 'builder_project_understanding_store_invalid');
  store.close();

  const db = new DatabaseSync(databasePath);
  db.prepare(
    `UPDATE project_understanding_snapshots
        SET package_manager = 'pnpm'
      WHERE snapshot_digest = ?`,
  ).run(recorded.snapshot_digest);
  db.close();

  const corrupted = createBuilderProjectUnderstandingStore(databasePath);
  assertStoreError(
    () => corrupted.read_latest_project_understanding_snapshot({ project_id: PROJECT_ID }),
    'builder_project_understanding_store_integrity_failed',
  );
  corrupted.close();
});

test('source remains a main-owned store without renderer, provider, command, Git, or network authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-project-understanding-store.cjs'),
    'utf8',
  );

  assert.match(source, /main_owned_project_understanding_store/u);
  assert.match(source, /command_execution:\s*false/u);
  assert.match(source, /provider_dispatch:\s*false/u);
  assert.match(source, /source_write:\s*'not_present'/u);
  assert.doesNotMatch(
    source,
    /ipcMain|ipcRenderer|contextBridge|BrowserWindow|safeStorage|child_process|spawn|execFile|fetch\s*\(|require\(['"](?:node:http|node:https|http|https)['"]\)|builder-provider|builder-git-|credential|secret_ref/iu,
  );
});
