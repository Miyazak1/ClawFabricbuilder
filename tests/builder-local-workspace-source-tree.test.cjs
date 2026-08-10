'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  BuilderLocalWorkspaceSourceTreeError,
  inspectBuilderLocalWorkspaceSourceTree,
  readBuilderLocalWorkspaceSourceTree,
} = require('../electron/builder-local-workspace-source-tree.cjs');

function fixture() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'builder-local-source-'));
}

test('reads deterministic managed text files while excluding protected and generated roots', () => {
  const root = fixture();
  try {
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.mkdirSync(path.join(root, '.git'), { recursive: true });
    fs.mkdirSync(path.join(root, '.clawfabric'), { recursive: true });
    fs.mkdirSync(path.join(root, 'node_modules', 'pkg'), { recursive: true });
    fs.writeFileSync(path.join(root, 'index.html'), '<main>Safe</main>\n');
    fs.writeFileSync(path.join(root, 'src', 'app.js'), 'export const safe = true;\n');
    fs.writeFileSync(path.join(root, '.git', 'config'), 'private');
    fs.writeFileSync(path.join(root, '.clawfabric', 'project.json'), '{}');
    fs.writeFileSync(path.join(root, 'node_modules', 'pkg', 'index.js'), 'ignored');

    const first = readBuilderLocalWorkspaceSourceTree(root);
    const second = readBuilderLocalWorkspaceSourceTree(root);

    assert.deepEqual(first, second);
    assert.deepEqual(first.files.map((file) => file.path), ['index.html', 'src/app.js']);
    assert.equal(Object.isFrozen(first), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('marks bounded scans incomplete instead of claiming a safe full workspace baseline', () => {
  const root = fixture();
  try {
    for (let index = 0; index < 513; index += 1) {
      fs.writeFileSync(path.join(root, `file-${String(index).padStart(3, '0')}.txt`), `${index}\n`);
    }
    const inspected = inspectBuilderLocalWorkspaceSourceTree(root);
    assert.equal(inspected.scan_status, 'incomplete');
    assert.deepEqual(inspected.incomplete_reasons, ['file_limit']);
    assert.equal(inspected.source_tree.files.length, 512);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('marks invalid UTF-8 and case-drifted protected roots incomplete', () => {
  const root = fixture();
  try {
    fs.mkdirSync(path.join(root, '.GIT'), { recursive: true });
    fs.writeFileSync(path.join(root, 'binary.bin'), Buffer.from([0xc3, 0x28]));
    fs.writeFileSync(path.join(root, 'index.html'), '<main>Safe</main>\n');

    const inspected = inspectBuilderLocalWorkspaceSourceTree(root);
    assert.equal(inspected.scan_status, 'incomplete');
    assert.deepEqual(inspected.incomplete_reasons, ['unsupported_file']);
    assert.deepEqual(inspected.source_tree.files.map((file) => file.path), ['index.html']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('fails closed for a symlinked workspace root', (context) => {
  if (process.platform === 'win32') {
    context.skip('Creating symlinks requires an elevated Windows token.');
    return;
  }
  const root = fixture();
  const link = `${root}-link`;
  try {
    fs.symlinkSync(root, link, 'dir');
    assert.throws(
      () => readBuilderLocalWorkspaceSourceTree(link),
      BuilderLocalWorkspaceSourceTreeError,
    );
  } finally {
    fs.rmSync(link, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('source boundary has no IPC, provider, Git mutation, or command authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-local-workspace-source-tree.cjs'),
    'utf8',
  );
  assert.doesNotMatch(
    source,
    /ipcMain|ipcRenderer|BrowserWindow|safeStorage|fetch\s*\(|https?:|provider|credential|child_process|spawn|execFile|persist_candidate_commit|update-ref|write_current/iu,
  );
});
