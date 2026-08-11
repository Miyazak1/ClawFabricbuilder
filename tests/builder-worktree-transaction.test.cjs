'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  createBuilderProjectSourceTree,
} = require('../electron/builder-project-source-tree.cjs');
const {
  BUILDER_WORKTREE_TRANSACTION_VERSION,
  BuilderWorktreeTransactionError,
  createBuilderWorktreeTransactionManager,
} = require('../electron/builder-worktree-transaction.cjs');

function fixture(t) {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'clawfabric-worktree-transaction-'));
  fs.mkdirSync(path.join(projectRoot, '.git'), { recursive: true });
  t.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));
  return projectRoot;
}

function writeProjectFile(projectRoot, relativePath, content) {
  const target = path.join(projectRoot, ...relativePath.split('/'));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf8');
}

function transactionRoot(projectRoot) {
  return path.join(projectRoot, '.git', 'clawfabric', 'worktree-transactions');
}

test('applies changed files transactionally and commits without exposing private staging', (t) => {
  const projectRoot = fixture(t);
  writeProjectFile(projectRoot, 'delete.txt', 'remove me\n');
  writeProjectFile(projectRoot, 'index.html', '<main>Before</main>\n');
  const base = createBuilderProjectSourceTree({
    files: [
      { path: 'delete.txt', content: 'remove me\n' },
      { path: 'index.html', content: '<main>Before</main>\n' },
    ],
  });
  const resulting = createBuilderProjectSourceTree({
    files: [
      { path: 'index.html', content: '<main>After</main>\n' },
      { path: 'src/app.js', content: 'export const ready = true;\n' },
    ],
  });
  const manager = createBuilderWorktreeTransactionManager();

  const transaction = manager.begin({
    project_root: projectRoot,
    base_source_tree: base,
    resulting_source_tree: resulting,
  });
  const applied = transaction.apply();

  assert.equal(manager.authority_version, BUILDER_WORKTREE_TRANSACTION_VERSION);
  assert.deepEqual(applied, {
    transaction_version: BUILDER_WORKTREE_TRANSACTION_VERSION,
    state: 'applied',
    operation_count: 3,
  });
  assert.equal(fs.existsSync(path.join(projectRoot, 'delete.txt')), false);
  assert.equal(fs.readFileSync(path.join(projectRoot, 'index.html'), 'utf8'), '<main>After</main>\n');
  assert.equal(
    fs.readFileSync(path.join(projectRoot, 'src', 'app.js'), 'utf8'),
    'export const ready = true;\n',
  );

  transaction.commit();
  assert.equal(fs.existsSync(transactionRoot(projectRoot)), true);
  assert.deepEqual(fs.readdirSync(transactionRoot(projectRoot)), []);
});

test('rolls back every applied file when a later replacement fails', (t) => {
  const projectRoot = fixture(t);
  writeProjectFile(projectRoot, 'delete.txt', 'preserve after rollback\n');
  writeProjectFile(projectRoot, 'index.html', '<main>Before</main>\n');
  const base = createBuilderProjectSourceTree({
    files: [
      { path: 'delete.txt', content: 'preserve after rollback\n' },
      { path: 'index.html', content: '<main>Before</main>\n' },
    ],
  });
  const resulting = createBuilderProjectSourceTree({
    files: [
      { path: 'index.html', content: '<main>After</main>\n' },
      { path: 'later.txt', content: 'must not remain\n' },
    ],
  });
  const manager = createBuilderWorktreeTransactionManager({
    before_operation({ phase, path: relativePath }) {
      if (phase === 'before_install' && relativePath === 'later.txt') {
        throw new Error('private injected failure');
      }
    },
  });
  const transaction = manager.begin({
    project_root: projectRoot,
    base_source_tree: base,
    resulting_source_tree: resulting,
  });

  assert.throws(
    () => transaction.apply(),
    (error) => {
      assert.ok(error instanceof BuilderWorktreeTransactionError);
      assert.equal(error.code, 'builder_worktree_transaction_unavailable');
      assert.doesNotMatch(JSON.stringify(error), /private injected failure/u);
      return true;
    },
  );
  assert.equal(
    fs.readFileSync(path.join(projectRoot, 'delete.txt'), 'utf8'),
    'preserve after rollback\n',
  );
  assert.equal(fs.readFileSync(path.join(projectRoot, 'index.html'), 'utf8'), '<main>Before</main>\n');
  assert.equal(fs.existsSync(path.join(projectRoot, 'later.txt')), false);
  assert.deepEqual(fs.readdirSync(transactionRoot(projectRoot)), []);
});

test('supports explicit rollback after an applied transaction', (t) => {
  const projectRoot = fixture(t);
  writeProjectFile(projectRoot, 'index.html', '<main>Before</main>\n');
  const base = createBuilderProjectSourceTree({
    files: [{ path: 'index.html', content: '<main>Before</main>\n' }],
  });
  const resulting = createBuilderProjectSourceTree({
    files: [{ path: 'index.html', content: '<main>After</main>\n' }],
  });
  const transaction = createBuilderWorktreeTransactionManager().begin({
    project_root: projectRoot,
    base_source_tree: base,
    resulting_source_tree: resulting,
  });

  transaction.apply();
  transaction.rollback();

  assert.equal(fs.readFileSync(path.join(projectRoot, 'index.html'), 'utf8'), '<main>Before</main>\n');
  assert.deepEqual(fs.readdirSync(transactionRoot(projectRoot)), []);
});

test('detects workspace drift before staging or replacing files', (t) => {
  const projectRoot = fixture(t);
  writeProjectFile(projectRoot, 'index.html', '<main>User edit</main>\n');
  const base = createBuilderProjectSourceTree({
    files: [{ path: 'index.html', content: '<main>Before</main>\n' }],
  });
  const resulting = createBuilderProjectSourceTree({
    files: [{ path: 'index.html', content: '<main>After</main>\n' }],
  });

  assert.throws(
    () => createBuilderWorktreeTransactionManager().begin({
      project_root: projectRoot,
      base_source_tree: base,
      resulting_source_tree: resulting,
    }),
    (error) => {
      assert.ok(error instanceof BuilderWorktreeTransactionError);
      assert.equal(error.code, 'builder_worktree_transaction_conflict');
      return true;
    },
  );
  assert.equal(
    fs.readFileSync(path.join(projectRoot, 'index.html'), 'utf8'),
    '<main>User edit</main>\n',
  );
  assert.equal(fs.existsSync(transactionRoot(projectRoot)), false);
});

test('source boundary stays main-only and does not gain renderer, provider, or command authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-worktree-transaction.cjs'),
    'utf8',
  );
  assert.match(source, /worktree-transactions/u);
  assert.match(source, /rollback/u);
  assert.doesNotMatch(
    source,
    /require\(['"]electron['"]\)|ipcMain|ipcRenderer|contextBridge|BrowserWindow|safeStorage|fetch\s*\(|https?:|Authorization|Bearer|provider|credential|node:sqlite|better-sqlite|child_process|spawn\s*\(|exec\s*\(/iu,
  );
});
