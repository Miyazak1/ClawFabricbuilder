'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createBuilderProjectSourceTree,
} = require('../electron/builder-project-source-tree.cjs');
const {
  BuilderSideWorkspaceFileProjectionError,
  createBuilderSideWorkspaceFileContentProjection,
  createBuilderSideWorkspaceFileTreeProjection,
} = require('../electron/builder-side-workspace-file-projection.cjs');

const UUID = '123e4567-e89b-42d3-a456-426614174000';
const PROJECT_ID = `builder-project:${UUID}`;
const CONVERSATION_ID = `builder-conversation:${UUID}`;

function tree(files = [
  { path: 'index.html', content: '<main>Home</main>\n' },
  { path: 'src/app.ts', content: 'export const answer = 42;\n' },
  { path: 'src/styles.css', content: 'main { color: #123; }\n' },
]) {
  return createBuilderProjectSourceTree({ files });
}

function sourceRef(sourceTree) {
  return {
    source_ref_kind: 'current_draft_checkpoint_candidate',
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    checkpoint_id: `builder-draft-checkpoint:${'7'.repeat(64)}`,
    checkpoint_sequence: 2,
    candidate_id: `builder-code-change-candidate:${'a'.repeat(64)}`,
    candidate_digest: `sha256:${'2'.repeat(64)}`,
    resulting_tree_digest: sourceTree.source_tree_digest,
    commit_oid: '5'.repeat(40),
    tree_oid: '6'.repeat(40),
  };
}

function treeProjection(sourceTree = tree(), overrides = {}) {
  return createBuilderSideWorkspaceFileTreeProjection({
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    source_kind: 'current_draft',
    root_label: 'Current draft',
    source_tree: sourceTree,
    source_ref: sourceRef(sourceTree),
    selected_path: 'src/app.ts',
    ...overrides,
  });
}

test('creates a read-only side workspace file tree without file bodies', () => {
  const sourceTree = tree();
  const projection = treeProjection(sourceTree);

  assert.equal(projection.projection_version, 'builder-side-workspace-file-tree.v1');
  assert.equal(projection.project_id, PROJECT_ID);
  assert.equal(projection.source_kind, 'current_draft');
  assert.equal(projection.source_tree_digest, sourceTree.source_tree_digest);
  assert.equal(projection.selected_file_ref.path, 'src/app.ts');
  assert.equal(projection.selected_file_ref.source_tree_digest, sourceTree.source_tree_digest);
  assert.deepEqual(
    projection.entries.map((entry) => [entry.entry_kind, entry.path]),
    [
      ['text_file', 'index.html'],
      ['directory', 'src'],
      ['text_file', 'src/app.ts'],
      ['text_file', 'src/styles.css'],
    ],
  );
  assert.equal(projection.entries.some((entry) => Object.hasOwn(entry, 'content')), false);
  assert.equal(projection.authority.renderer_source_tree, 'not_accepted');
  assert.equal(projection.authority.renderer_path_authority, 'main_issued_file_ref_only');
  assert.equal(projection.authority.source_write, 'not_performed');
  assert.equal(projection.authority.command_execution, false);
  assert.equal(Object.isFrozen(projection.entries[0]), true);
});

test('creates bounded content projection only for a main-issued file ref', () => {
  const sourceTree = tree();
  const fileTree = treeProjection(sourceTree);
  const appRef = fileTree.selected_file_ref;
  const content = createBuilderSideWorkspaceFileContentProjection({
    file_tree_projection: fileTree,
    source_tree: sourceTree,
    file_ref: appRef,
  });

  assert.equal(content.projection_version, 'builder-side-workspace-file-content.v1');
  assert.equal(content.path, 'src/app.ts');
  assert.equal(content.language_hint, 'typescript');
  assert.equal(content.content_status, 'ready');
  assert.equal(content.text_preview, 'export const answer = 42;\n');
  assert.equal(content.binary_summary, null);
  assert.deepEqual(content.file_ref, appRef);
  assert.equal(content.authority.provider_dispatch, false);
  assert.equal(content.authority.git_write, 'not_performed');
});

test('truncates large file content with an explicit status', () => {
  const sourceTree = tree([
    { path: 'README.md', content: `${'a'.repeat(120 * 1_024)}\n` },
  ]);
  const fileTree = treeProjection(sourceTree, { selected_path: 'README.md' });
  const content = createBuilderSideWorkspaceFileContentProjection({
    file_tree_projection: fileTree,
    source_tree: sourceTree,
    file_ref: fileTree.selected_file_ref,
  });

  assert.equal(content.path, 'README.md');
  assert.equal(content.language_hint, 'markdown');
  assert.equal(content.content_status, 'truncated');
  assert.equal(content.text_preview.length, 96 * 1_024);
});

test('fails closed on stale source trees, forged refs, raw path authority, and malformed input', () => {
  const first = tree();
  const second = tree([{ path: 'src/app.ts', content: 'changed\n' }]);
  const fileTree = treeProjection(first);
  const forgedRef = {
    ...fileTree.selected_file_ref,
    source_tree_digest: second.source_tree_digest,
  };

  for (const createInvalidProjection of [
    () => createBuilderSideWorkspaceFileTreeProjection({
      project_id: PROJECT_ID,
      conversation_id: CONVERSATION_ID,
      source_kind: 'current_draft',
      root_label: 'Current draft',
      source_tree: first,
      source_ref: sourceRef(first),
      selected_path: 'missing.ts',
    }),
    () => createBuilderSideWorkspaceFileTreeProjection({
      project_id: PROJECT_ID,
      conversation_id: CONVERSATION_ID,
      source_kind: 'current_draft',
      root_label: 'Current draft',
      source_tree: first,
      source_ref: sourceRef(first),
      selected_path: 'src/app.ts',
      path: 'src/app.ts',
    }),
    () => createBuilderSideWorkspaceFileTreeProjection({
      project_id: PROJECT_ID,
      conversation_id: CONVERSATION_ID,
      source_kind: 'current_draft',
      root_label: 'Current draft',
      source_tree: first,
      source_ref: { ...sourceRef(first), source_tree: first },
      selected_path: 'src/app.ts',
    }),
  ]) {
    assert.throws(
      createInvalidProjection,
      BuilderSideWorkspaceFileProjectionError,
    );
  }

  assert.throws(
    () => createBuilderSideWorkspaceFileContentProjection({
      file_tree_projection: fileTree,
      source_tree: second,
      file_ref: fileTree.selected_file_ref,
    }),
    BuilderSideWorkspaceFileProjectionError,
  );
  assert.throws(
    () => createBuilderSideWorkspaceFileContentProjection({
      file_tree_projection: fileTree,
      source_tree: first,
      file_ref: forgedRef,
    }),
    BuilderSideWorkspaceFileProjectionError,
  );
  assert.throws(
    () => createBuilderSideWorkspaceFileContentProjection({
      file_tree_projection: fileTree,
      source_tree: first,
      path: 'src/app.ts',
    }),
    BuilderSideWorkspaceFileProjectionError,
  );
});

test('projection source stays side-workspace specific without IPC or mutation authority', () => {
  const source = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'electron', 'builder-side-workspace-file-projection.cjs'),
    'utf8',
  );

  assert.doesNotMatch(source, /ipcMain|handle\(|contextBridge|execute|spawn|writeFile|commit|saveDraft/iu);
  assert.match(source, /renderer_source_tree:\s*'not_accepted'/u);
  assert.match(source, /renderer_path_authority:\s*'main_issued_file_ref_only'/u);
});
