'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  BuilderRuntimeWorkspaceSnapshotStoreError,
  createBuilderRuntimeWorkspaceSnapshotStore,
} = require('../electron/builder-runtime-workspace-snapshot-store.cjs');
const {
  createBuilderProjectSourceTree,
} = require('../electron/builder-project-source-tree.cjs');

const UUID = '123e4567-e89b-42d3-a456-426614174000';
const PROJECT_ID = `builder-project:${UUID}`;
const CONVERSATION_ID = `builder-conversation:${UUID}:223e4567-e89b-42d3-a456-426614174000`;
const RUN_ID = `builder-run:${UUID}`;
const TOOL_CALL_ID = `builder-tool-call:${UUID}`;

function sourceTree(content = 'before\n') {
  return createBuilderProjectSourceTree({
    files: [{ path: 'src/app.ts', content }],
  });
}

test('persists runtime file identity and the latest read-only source snapshot', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'builder-runtime-snapshot-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let now = 10;
  const createStore = () => createBuilderRuntimeWorkspaceSnapshotStore({
    root_directory: root,
    now_ms: () => now,
  });
  const store = createStore();
  await store.record_source_tree({
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    run_id: RUN_ID,
    source_tree: sourceTree(),
  });
  await store.bind_tool_file({
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    run_id: RUN_ID,
    tool_call_id: TOOL_CALL_ID,
    path: 'src/app.ts',
  });
  now = 20;
  const changed = sourceTree('after\n');
  await store.record_source_tree({
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    run_id: RUN_ID,
    source_tree: changed,
  });

  const reopened = createStore();
  const toolFile = await reopened.read_tool_file({
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    run_id: RUN_ID,
    tool_call_id: TOOL_CALL_ID,
  });
  assert.equal(toolFile.selected_path, 'src/app.ts');
  assert.equal(toolFile.source_tree.source_tree_digest, changed.source_tree_digest);
  assert.equal(toolFile.source_tree.files[0].content, 'after\n');

  const byDigest = await reopened.read_source_tree({
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    source_tree_digest: changed.source_tree_digest,
  });
  assert.equal(byDigest.run_id, RUN_ID);
  assert.equal(byDigest.source_tree.files[0].content, 'after\n');
});

test('rejects forged project, tool, and raw path selectors', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'builder-runtime-snapshot-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = createBuilderRuntimeWorkspaceSnapshotStore({
    root_directory: root,
    now_ms: () => 10,
  });
  await store.record_source_tree({
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    run_id: RUN_ID,
    source_tree: sourceTree(),
  });
  await assert.rejects(store.read_tool_file({
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    run_id: RUN_ID,
    tool_call_id: `builder-tool-call:223e4567-e89b-42d3-a456-426614174000`,
  }), BuilderRuntimeWorkspaceSnapshotStoreError);
  await assert.rejects(store.read_tool_file({
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    run_id: RUN_ID,
    tool_call_id: TOOL_CALL_ID,
    path: 'src/app.ts',
  }), BuilderRuntimeWorkspaceSnapshotStoreError);
});

test('retains the resume baseline and edited workspace across restart and refuses baseline replacement', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'builder-resume-snapshot-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const createStore = () => createBuilderRuntimeWorkspaceSnapshotStore({ root_directory: root, now_ms: () => 10 });
  const identity = { project_id: PROJECT_ID, conversation_id: CONVERSATION_ID, run_id: RUN_ID };
  const store = createStore();
  await store.record_source_tree({ ...identity, source_tree: sourceTree(),
    resume: { session_run_id: RUN_ID, base_source_tree: sourceTree() } });
  await store.record_source_tree({ ...identity, source_tree: sourceTree('edited') });
  const record = await createStore().read_run_source_tree(identity);
  assert.equal(record.source_tree.files[0].content, 'edited');
  assert.equal(record.resume.base_source_tree.files[0].content, 'before\n');
  assert.equal(record.resume.session_run_id, RUN_ID);
  await assert.rejects(store.record_source_tree({ ...identity, source_tree: sourceTree('edited'),
    resume: { session_run_id: RUN_ID, base_source_tree: sourceTree('forged') } }));
});
