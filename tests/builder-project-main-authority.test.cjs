'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  BUILDER_PROJECT_MAIN_AUTHORITY_VERSION,
  BuilderProjectMainAuthorityError,
  GIT_RUNTIME_DIRECTORY,
  METADATA_DATABASE,
  METADATA_DIRECTORY,
  PROJECT_REPOSITORY_DIRECTORY,
  createBuilderProjectMainAuthority,
} = require('../electron/builder-project-main-authority.cjs');

function temporaryUserData(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawfabric-builder-main-authority-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('owns Builder project Git, SQLite metadata, and read authority facades', (t) => {
  const userDataPath = temporaryUserData(t);
  const authority = createBuilderProjectMainAuthority({
    userDataPath,
    nowSeconds: () => 1_750_000_000,
  });

  assert.equal(authority.authority_version, BUILDER_PROJECT_MAIN_AUTHORITY_VERSION);
  assert.equal(fs.existsSync(path.join(userDataPath, PROJECT_REPOSITORY_DIRECTORY)), true);
  assert.equal(fs.existsSync(path.join(userDataPath, GIT_RUNTIME_DIRECTORY)), true);
  assert.equal(fs.existsSync(path.join(userDataPath, METADATA_DIRECTORY, METADATA_DATABASE)), true);
  assert.deepEqual(Object.keys(authority.git_authority).sort(), [
    'persist_candidate_commit',
    'read_candidate_workspace_base',
    'read_verified_candidate',
    'verify_candidate_receipt',
  ]);
  assert.deepEqual(Object.keys(authority.git_current_projection).sort(), [
    'project_current',
    'recover_project',
  ]);
  assert.deepEqual(Object.keys(authority.metadata_authority).sort(), [
    'append_conversation_events',
    'bind_project_workspace',
    'load_conversation_candidate_by_draft',
    'load_conversation',
    'load_project_identity',
    'load_project_workspace',
    'list_project_workspaces',
    'record_project_revision_receipt',
  ].sort());
  assert.deepEqual(Object.keys(authority.project_read_authority).sort(), [
    'list_current',
    'list_history',
    'load_current',
    'load_revision',
  ]);
  assert.deepEqual(Object.keys(authority.project_workspace_authority).sort(), [
    'admit_project_workspace',
  ]);
  assert.equal(authority.close(), true);
  assert.equal(authority.close(), false);
});

test('rejects malformed authority options without leaking paths or traps', (t) => {
  const userDataPath = temporaryUserData(t);
  const invalidValues = [
    null,
    {},
    { userDataPath: 'relative' },
    { userDataPath, nowSeconds: 'bad' },
    { userDataPath, extra: true },
    new Proxy({}, { getPrototypeOf() { throw new Error('private proxy trap'); } }),
  ];
  for (const value of invalidValues) {
    assert.throws(
      () => createBuilderProjectMainAuthority(value),
      (error) => error instanceof BuilderProjectMainAuthorityError
        && error.code === 'builder_project_main_authority_unavailable'
        && error.stack === `${error.name}: ${error.message}`
        && !`${error.message}:${error.stack}`.includes('private')
        && !`${error.message}:${error.stack}`.includes(userDataPath),
    );
  }
});

test('recovers private worktree journals before reopening the current project', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-project-main-authority.cjs'),
    'utf8',
  );
  const currentRead = source.indexOf('const current = await projectReadAuthorityFacade.load_current(request)');
  const recovery = source.indexOf('await gitCurrentProjectionAuthority.recover_project({');
  const publicReturn = source.indexOf('return current');
  assert.notEqual(recovery, -1);
  assert.notEqual(currentRead, -1);
  assert.notEqual(publicReturn, -1);
  assert.ok(currentRead < recovery);
  assert.ok(recovery < publicReturn);
  assert.doesNotMatch(
    source,
    /ipcMain|ipcRenderer|contextBridge|BrowserWindow|fetch\s*\(|https?:|Authorization|Bearer/iu,
  );
});
