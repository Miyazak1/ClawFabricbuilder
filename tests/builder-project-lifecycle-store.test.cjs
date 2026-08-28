'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  BUILDER_PROJECT_LIFECYCLE_RESULT_VERSION,
  BuilderProjectLifecycleStoreError,
  createBuilderProjectLifecycleStore,
} = require('../electron/builder-project-lifecycle-store.cjs');

const PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174200';

function temporaryDatabase(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawfabric-builder-project-lifecycle-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return path.join(root, 'project-lifecycle.sqlite');
}

function assertStoreError(fn) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof BuilderProjectLifecycleStoreError);
    assert.doesNotMatch(`${error.name}:${error.message}:${error.stack}`, /credential|source_tree|commit_oid|C:\\/iu);
    return true;
  });
}

test('renames and archives projects through a main-owned soft lifecycle overlay', (t) => {
  const store = createBuilderProjectLifecycleStore(temporaryDatabase(t));
  const renamed = store.rename_project({
    project_id: PROJECT_ID,
    title: 'Renamed focus timer',
    updated_at_ms: 10,
  });
  assert.equal(renamed.result_version, BUILDER_PROJECT_LIFECYCLE_RESULT_VERSION);
  assert.equal(renamed.operation, 'project_renamed');
  assert.equal(renamed.project_lifecycle.title_override, 'Renamed focus timer');
  assert.equal(renamed.authority.lifecycle_authority, 'main_owned_project_lifecycle_store');
  assert.equal(renamed.authority.filesystem_delete, false);
  assert.equal(store.apply_to_project({
    project_id: PROJECT_ID,
    title: 'Focus timer',
    summary: 'Local project',
  }).title, 'Renamed focus timer');

  const archived = store.archive_project({ project_id: PROJECT_ID, archived_at_ms: 20 });
  assert.equal(archived.operation, 'project_archived');
  assert.equal(store.apply_to_project({
    project_id: PROJECT_ID,
    title: 'Focus timer',
    summary: 'Local project',
  }), null);
  store.close();
});

test('rejects malformed lifecycle requests without leaking private data', (t) => {
  const store = createBuilderProjectLifecycleStore(temporaryDatabase(t));
  assertStoreError(() => store.rename_project({
    project_id: PROJECT_ID,
    title: ' Bad title ',
    updated_at_ms: 1,
  }));
  assertStoreError(() => store.archive_project({
    project_id: 'not-a-project',
    archived_at_ms: 1,
  }));
  store.close();
});
