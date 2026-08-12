'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  READ_CURRENT_DRAFT_FILE_CONTENT_CHANNEL,
  READ_CURRENT_DRAFT_FILE_TREE_CHANNEL,
  BuilderSideWorkspaceFileIpcError,
  createBuilderSideWorkspaceFileIpcAdapter,
} = require('../electron/builder-side-workspace-file-ipc-adapter.cjs');
const {
  createBuilderProjectSourceTree,
} = require('../electron/builder-project-source-tree.cjs');
const {
  createBuilderSideWorkspaceFileContentProjection,
  createBuilderSideWorkspaceFileTreeProjection,
} = require('../electron/builder-side-workspace-file-projection.cjs');

const UUID = '123e4567-e89b-42d3-a456-426614174000';
const PROJECT_ID = `builder-project:${UUID}`;
const CONVERSATION_ID = `builder-conversation:${UUID}`;

function windowAuthority() {
  const webContents = Object.freeze({ isDestroyed: () => false });
  const window = Object.freeze({ webContents, isDestroyed: () => false });
  return { event: Object.freeze({ sender: webContents }), mainWindowRef: () => window };
}

function tree() {
  return createBuilderProjectSourceTree({
    files: [
      { path: 'index.html', content: '<main>Hello</main>\n' },
      { path: 'src/app.ts', content: 'export const ok = true;\n' },
    ],
  });
}

function sourceRef(sourceTree) {
  return {
    source_ref_kind: 'current_draft_checkpoint_candidate',
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    checkpoint_id: `builder-draft-checkpoint:${'8'.repeat(64)}`,
    checkpoint_sequence: 1,
    candidate_id: `builder-code-change-candidate:${'4'.repeat(64)}`,
    candidate_digest: `sha256:${'5'.repeat(64)}`,
    resulting_tree_digest: sourceTree.source_tree_digest,
    commit_oid: '1'.repeat(40),
    tree_oid: '2'.repeat(40),
  };
}

function treeProjection(sourceTree = tree(), selectedPath = null) {
  return createBuilderSideWorkspaceFileTreeProjection({
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    source_kind: 'current_draft',
    root_label: 'Current draft 1',
    source_tree: sourceTree,
    source_ref: sourceRef(sourceTree),
    selected_path: selectedPath,
  });
}

function contentProjection(sourceTree, fileRef) {
  return createBuilderSideWorkspaceFileContentProjection({
    file_tree_projection: treeProjection(sourceTree, fileRef.path),
    source_tree: sourceTree,
    file_ref: fileRef,
  });
}

function request(overrides = {}) {
  return {
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    ...overrides,
  };
}

function adapter(overrides = {}) {
  const active = windowAuthority();
  const sourceTree = tree();
  const calls = [];
  const fileTree = treeProjection(sourceTree);
  const fileEntry = fileTree.entries.find((entry) => entry.path === 'src/app.ts');
  const value = createBuilderSideWorkspaceFileIpcAdapter({
    readCurrentDraftFileTree: overrides.readCurrentDraftFileTree ?? (async (body) => {
      calls.push(['tree', body]);
      return fileTree;
    }),
    readCurrentDraftFileContent: overrides.readCurrentDraftFileContent ?? (async (body) => {
      calls.push(['content', body]);
      return contentProjection(sourceTree, body.file_ref);
    }),
    mainWindowRef: active.mainWindowRef,
  });
  return { active, calls, fileEntry, fileTree, sourceTree, value };
}

test('side workspace file adapter exposes fixed read-only channels only', async () => {
  const { active, calls, value } = adapter();

  assert.equal(value.adapter_id, 'builder_side_workspace_files.controlled_ipc_adapter.v1');
  assert.equal(value.namespace, 'builderSideWorkspaceFiles');
  assert.equal(value.preload_namespace, 'window.clawfabricBuilder.sideWorkspaceFiles');
  assert.deepEqual(value.exposed_methods, [
    'readCurrentDraftFileTree',
    'readCurrentDraftFileContent',
  ]);
  assert.deepEqual(Object.keys(value.channels), [
    'readCurrentDraftFileTree',
    'readCurrentDraftFileContent',
  ]);
  assert.equal(value.channels.readCurrentDraftFileTree.channel, READ_CURRENT_DRAFT_FILE_TREE_CHANNEL);
  assert.equal(value.channels.readCurrentDraftFileContent.channel, READ_CURRENT_DRAFT_FILE_CONTENT_CHANNEL);
  assert.equal(value.authority.active_renderer_required, true);
  assert.equal(value.authority.source_tree_from_renderer, false);
  assert.equal(value.authority.raw_path_from_renderer, false);
  assert.equal(value.authority.command_execution, false);
  assert.equal(value.authority.source_mutation, false);

  const projected = await value.channels.readCurrentDraftFileTree.invoke(active.event, request());

  assert.deepEqual(calls, [['tree', request()]]);
  assert.equal(projected.projection_version, 'builder-side-workspace-file-tree.v1');
  assert.equal(projected.entries.some((entry) => entry.path === 'src/app.ts'), true);
  assert.equal(Object.isFrozen(projected), true);
  assert.equal(Object.isFrozen(projected.entries), true);
  assert.doesNotMatch(JSON.stringify(projected), /"content":|"text_preview":|"source_tree":/u);
});

test('side workspace file adapter reads content through a bounded file ref only', async () => {
  const { active, calls, fileEntry, value } = adapter();

  const projected = await value.channels.readCurrentDraftFileContent.invoke(active.event, {
    ...request(),
    file_ref: fileEntry.file_ref,
  });

  assert.deepEqual(calls, [['content', { ...request(), file_ref: fileEntry.file_ref }]]);
  assert.equal(projected.projection_version, 'builder-side-workspace-file-content.v1');
  assert.equal(projected.path, 'src/app.ts');
  assert.equal(projected.text_preview, 'export const ok = true;\n');
  assert.equal(projected.authority.renderer_path_authority, 'main_issued_file_ref_only');
});

test('side workspace file adapter rejects inactive sender, raw path, source, url, and forged payloads', async () => {
  const { active, calls, fileEntry, value } = adapter();
  await assert.rejects(
    value.channels.readCurrentDraftFileTree.invoke(Object.freeze({ sender: Object.freeze({}) }), request()),
    (error) => error instanceof BuilderSideWorkspaceFileIpcError
      && error.code === 'builder_side_workspace_file_forbidden',
  );
  for (const payload of [
    undefined,
    request({ project_id: 'bad' }),
    request({ conversation_id: 'bad' }),
    request({ draft_id: 'bad' }),
    request({ source_tree: { files: [] } }),
    request({ path: 'src/app.ts' }),
    request({ url: 'file:///x' }),
  ]) {
    await assert.rejects(
      value.channels.readCurrentDraftFileTree.invoke(active.event, payload),
      { code: 'builder_side_workspace_file_invalid' },
    );
  }
  for (const payload of [
    request({ file_ref: fileEntry.file_ref, path: 'src/app.ts' }),
    request({ file_ref: { ...fileEntry.file_ref, path: '../secret.txt' } }),
  ]) {
    await assert.rejects(
      value.channels.readCurrentDraftFileContent.invoke(active.event, payload),
      { code: 'builder_side_workspace_file_invalid' },
    );
  }
  assert.deepEqual(calls, []);
  await assert.rejects(
    value.channels.readCurrentDraftFileContent.invoke(active.event, request({
      file_ref: { ...fileEntry.file_ref, source_tree_digest: `sha256:${'a'.repeat(64)}` },
    })),
    { code: 'builder_side_workspace_file_unavailable' },
  );
  assert.equal(calls.length, 1);
});

test('side workspace file adapter maps service and output failures to fixed redacted errors', async () => {
  const source = new Error('private file marker');
  source.code = 'private_file_code';
  const failing = adapter({
    readCurrentDraftFileTree: async () => { throw source; },
  });
  await assert.rejects(
    failing.value.channels.readCurrentDraftFileTree.invoke(failing.active.event, request()),
    (error) => error instanceof BuilderSideWorkspaceFileIpcError
      && error.code === 'builder_side_workspace_file_unavailable'
      && !`${error.message}:${error.stack}`.includes('private file marker'),
  );

  const leaking = adapter({
    readCurrentDraftFileTree: async () => ({
      ...treeProjection(tree()),
      source_tree: { files: [] },
    }),
  });
  await assert.rejects(
    leaking.value.channels.readCurrentDraftFileTree.invoke(leaking.active.event, request()),
    { code: 'builder_side_workspace_file_unavailable' },
  );
});

test('side workspace file adapter source has no Electron registration, provider, command, or mutation authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-side-workspace-file-ipc-adapter.cjs'),
    'utf8',
  );
  assert.match(source, /active_renderer_required:\s*true/u);
  assert.match(source, /source_tree_from_renderer:\s*false/u);
  assert.match(source, /raw_path_from_renderer:\s*false/u);
  assert.match(source, /direct_electron_registration:\s*false/u);
  assert.match(source, /direct_preload_exposure:\s*false/u);
  assert.doesNotMatch(
    source,
    /require\(['"]electron['"]\)|ipcMain|ipcRenderer|contextBridge|BrowserWindow|WebContentsView|safeStorage|node:sqlite|DatabaseSync|builder-git-|fetch\s*\(|https?:|saveDraft|generate|persist_candidate_commit|write_current|local-provider-executor/iu,
  );
});
