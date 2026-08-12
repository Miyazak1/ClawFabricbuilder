'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  BUILDER_LIVE_PREVIEW_SOURCE_RESOLVER_RESULT_VERSION,
  BUILDER_LIVE_PREVIEW_SOURCE_RESOLVER_VERSION,
  BUILDER_LIVE_PREVIEW_SOURCE_SNAPSHOT_VERSION,
} = require('../electron/builder-live-preview-source-resolver.cjs');
const {
  createBuilderLivePreviewSourceAdmission,
} = require('../electron/builder-live-preview-source-admission.cjs');
const {
  BUILDER_LIVE_PREVIEW_CURRENT_DRAFT_SOURCE_RESULT_VERSION,
  BUILDER_LIVE_PREVIEW_CURRENT_DRAFT_SOURCE_SERVICE_VERSION,
} = require('../electron/builder-live-preview-current-draft-source-service.cjs');
const {
  BuilderSideWorkspaceFileMainServiceError,
  createBuilderSideWorkspaceFileMainService,
} = require('../electron/builder-side-workspace-file-main-service.cjs');
const {
  createBuilderProjectSourceTree,
} = require('../electron/builder-project-source-tree.cjs');

const UUID = '123e4567-e89b-42d3-a456-426614174000';
const PROJECT_ID = `builder-project:${UUID}`;
const CONVERSATION_ID = `builder-conversation:${UUID}`;
const DRAFT_ID = `builder-generation-draft:${'d'.repeat(64)}`;
const CHECKPOINT_ID = `builder-draft-checkpoint:${'8'.repeat(64)}`;
const CANDIDATE_ID = `builder-code-change-candidate:${'4'.repeat(64)}`;
const CANDIDATE_DIGEST = `sha256:${'5'.repeat(64)}`;
const COMMIT_OID = '1'.repeat(40);
const TREE_OID = '2'.repeat(40);

function sourceTree() {
  return createBuilderProjectSourceTree({
    files: [
      { path: 'index.html', content: '<main>Hello files</main>\n' },
      { path: 'src/app.ts', content: 'export const answer = 42;\n' },
    ],
  });
}

function sourceResolverAuthority() {
  return {
    source_resolver_authority: 'main_owned_live_preview_source_resolver_v1',
    renderer_source_tree: 'not_accepted',
    renderer_path_or_url: 'not_accepted',
    git_read: 'existing_authority_verified_candidate_only',
    sqlite_read: 'existing_revision_or_checkpoint_authority_only',
    source_write: 'not_performed',
    git_write: 'not_performed',
    sqlite_write: 'not_performed',
    provider_dispatch: false,
    tool_dispatch: false,
    command_execution: false,
    electron_view_attachment: false,
    ipc_registration: false,
    revision_admission: false,
    save_admission: false,
    permission_grant: false,
  };
}

function resolverResult(tree = sourceTree()) {
  return {
    result_version: BUILDER_LIVE_PREVIEW_SOURCE_RESOLVER_RESULT_VERSION,
    resolver_version: BUILDER_LIVE_PREVIEW_SOURCE_RESOLVER_VERSION,
    operation: 'current_draft_preview_source_resolved',
    source_kind: 'current_draft',
    status: 'ready',
    unavailable_reason: null,
    preview_source_snapshot: {
      snapshot_version: BUILDER_LIVE_PREVIEW_SOURCE_SNAPSHOT_VERSION,
      source_kind: 'current_draft',
      project_id: PROJECT_ID,
      conversation_id: CONVERSATION_ID,
      source_tree: tree,
      source_tree_digest: tree.source_tree_digest,
      source_ref: {
        source_ref_kind: 'current_draft_checkpoint_candidate',
        project_id: PROJECT_ID,
        conversation_id: CONVERSATION_ID,
        checkpoint_id: CHECKPOINT_ID,
        checkpoint_sequence: 3,
        candidate_id: CANDIDATE_ID,
        candidate_digest: CANDIDATE_DIGEST,
        resulting_tree_digest: tree.source_tree_digest,
        commit_oid: COMMIT_OID,
        tree_oid: TREE_OID,
      },
      admission: {
        preview_source_admission: 'main_owned_verified_preview_source',
        source_tree_digest: tree.source_tree_digest,
      },
      authority: sourceResolverAuthority(),
    },
  };
}

function sourceAdmission(tree = sourceTree()) {
  return createBuilderLivePreviewSourceAdmission({
    source_resolver_result: resolverResult(tree),
    selected_entry_path: 'index.html',
    preview_kind: 'live_static_web',
    admitted_at_ms: 10,
    expires_at_ms: 10 + 60_000,
  });
}

function sourceResult(tree = sourceTree()) {
  return {
    result_version: BUILDER_LIVE_PREVIEW_CURRENT_DRAFT_SOURCE_RESULT_VERSION,
    service_version: BUILDER_LIVE_PREVIEW_CURRENT_DRAFT_SOURCE_SERVICE_VERSION,
    operation: 'current_draft_live_preview_source_admitted',
    draft_id: DRAFT_ID,
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    source_admission: sourceAdmission(tree),
  };
}

function serviceFixture(tree = sourceTree()) {
  const calls = [];
  const service = createBuilderSideWorkspaceFileMainService({
    current_draft_source_service: {
      service_version: BUILDER_LIVE_PREVIEW_CURRENT_DRAFT_SOURCE_SERVICE_VERSION,
      resolve_current_draft_preview_source(request) {
        calls.push(request);
        return sourceResult(tree);
      },
    },
  });
  return { calls, service, tree };
}

test('reads current draft file tree from main-owned source admission', async () => {
  const fixture = serviceFixture();

  const projection = await fixture.service.read_current_draft_file_tree({
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
  });

  assert.equal(projection.projection_version, 'builder-side-workspace-file-tree.v1');
  assert.equal(projection.project_id, PROJECT_ID);
  assert.equal(projection.conversation_id, CONVERSATION_ID);
  assert.equal(projection.source_kind, 'current_draft');
  assert.equal(projection.root_label, 'Current draft 3');
  assert.equal(projection.source_tree_digest, fixture.tree.source_tree_digest);
  assert.equal(projection.entries.some((entry) => entry.path === 'src/app.ts'), true);
  assert.equal(JSON.stringify(projection).includes('Hello files'), false);
  assert.equal(projection.authority.renderer_source_tree, 'not_accepted');
  assert.equal(projection.authority.command_execution, false);
  assert.deepEqual(fixture.calls, [{ project_id: PROJECT_ID, conversation_id: CONVERSATION_ID }]);
});

test('reads current draft file content only through a projected file ref', async () => {
  const fixture = serviceFixture();
  const treeProjection = await fixture.service.read_current_draft_file_tree({
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
  });
  const fileEntry = treeProjection.entries.find((entry) => entry.path === 'src/app.ts');

  const content = await fixture.service.read_current_draft_file_content({
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    file_ref: fileEntry.file_ref,
  });

  assert.equal(content.projection_version, 'builder-side-workspace-file-content.v1');
  assert.equal(content.path, 'src/app.ts');
  assert.equal(content.language_hint, 'typescript');
  assert.equal(content.text_preview, 'export const answer = 42;\n');
  assert.equal(content.authority.renderer_path_authority, 'main_issued_file_ref_only');
});

test('rejects renderer source, raw path, and stale file refs before reading content', async () => {
  const fixture = serviceFixture();
  await assert.rejects(
    fixture.service.read_current_draft_file_tree({
      project_id: PROJECT_ID,
      conversation_id: CONVERSATION_ID,
      source_tree: fixture.tree,
    }),
    BuilderSideWorkspaceFileMainServiceError,
  );
  await assert.rejects(
    fixture.service.read_current_draft_file_content({
      project_id: PROJECT_ID,
      conversation_id: CONVERSATION_ID,
      path: 'src/app.ts',
    }),
    BuilderSideWorkspaceFileMainServiceError,
  );
  await assert.rejects(
    fixture.service.read_current_draft_file_content({
      project_id: PROJECT_ID,
      conversation_id: CONVERSATION_ID,
      file_ref: {
        file_ref_version: 'builder-side-workspace-file-ref.v1',
        source_tree_digest: `sha256:${'a'.repeat(64)}`,
        path: 'src/app.ts',
        content_digest: `sha256:${'b'.repeat(64)}`,
      },
    }),
    BuilderSideWorkspaceFileMainServiceError,
  );
});

test('source remains file-projection service only without runtime, mutation, or provider authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-side-workspace-file-main-service.cjs'),
    'utf8',
  );
  assert.match(source, /file_ref/u);
  assert.doesNotMatch(
    source,
    /require\(['"]electron['"]\)|ipcMain|ipcRenderer|contextBridge|BrowserWindow|WebContentsView|createServer|listen\(|child_process|execFile|spawn\(|writeFile|saveDraft|record_project_revision|provider_dispatch\s*:\s*true|tool_dispatch\s*:\s*true/iu,
  );
});
