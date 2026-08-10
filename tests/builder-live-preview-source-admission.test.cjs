'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  BUILDER_LIVE_PREVIEW_SOURCE_RESOLVER_VERSION,
  BUILDER_LIVE_PREVIEW_SOURCE_RESOLVER_RESULT_VERSION,
  BUILDER_LIVE_PREVIEW_SOURCE_SNAPSHOT_VERSION,
} = require('../electron/builder-live-preview-source-resolver.cjs');
const {
  createBuilderLivePreviewSourceAdmission,
  sanitizeBuilderLivePreviewSourceAdmission,
} = require('../electron/builder-live-preview-source-admission.cjs');
const {
  createBuilderProjectSourceTree,
} = require('../electron/builder-project-source-tree.cjs');

const PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174000';
const CONVERSATION_ID = 'builder-conversation:123e4567-e89b-42d3-a456-426614174001';
const CHECKPOINT_ID = `builder-draft-checkpoint:${'1'.repeat(64)}`;
const REVISION_DIGEST = `sha256:${'2'.repeat(64)}`;
const CANDIDATE_ID = `builder-code-change-candidate:${'3'.repeat(64)}`;
const CANDIDATE_DIGEST = `sha256:${'4'.repeat(64)}`;
const COMMIT_OID = '5'.repeat(40);
const TREE_OID = '6'.repeat(40);

function tree() {
  return createBuilderProjectSourceTree({
    files: [
      { path: 'app.js', content: 'document.body.dataset.live = "true";\n' },
      { path: 'index.html', content: '<main id="root">Live preview</main><script src="./app.js"></script>\n' },
      { path: 'nested/page.htm', content: '<main>Nested page</main>\n' },
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

function sourceRef(sourceTree, overrides = {}) {
  const sourceKind = overrides.source_kind ?? 'current_draft';
  if (sourceKind === 'saved_revision') {
    return {
      source_ref_kind: 'saved_project_revision',
      project_id: PROJECT_ID,
      conversation_id: CONVERSATION_ID,
      revision_receipt_digest: REVISION_DIGEST,
      revision_number: 3,
      candidate_id: CANDIDATE_ID,
      candidate_digest: CANDIDATE_DIGEST,
      resulting_tree_digest: sourceTree.source_tree_digest,
      commit_oid: COMMIT_OID,
      tree_oid: TREE_OID,
      ...(overrides.source_ref ?? {}),
    };
  }
  return {
    source_ref_kind: 'current_draft_checkpoint_candidate',
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    checkpoint_id: CHECKPOINT_ID,
    checkpoint_sequence: 2,
    candidate_id: CANDIDATE_ID,
    candidate_digest: CANDIDATE_DIGEST,
    resulting_tree_digest: sourceTree.source_tree_digest,
    commit_oid: COMMIT_OID,
    tree_oid: TREE_OID,
    ...(overrides.source_ref ?? {}),
  };
}

function resolverResult(overrides = {}) {
  const sourceTree = overrides.source_tree ?? tree();
  const sourceKind = overrides.source_kind ?? 'current_draft';
  const operation = sourceKind === 'saved_revision'
    ? 'saved_revision_preview_source_resolved'
    : 'current_draft_preview_source_resolved';
  return {
    result_version: BUILDER_LIVE_PREVIEW_SOURCE_RESOLVER_RESULT_VERSION,
    resolver_version: BUILDER_LIVE_PREVIEW_SOURCE_RESOLVER_VERSION,
    operation,
    source_kind: sourceKind,
    status: 'ready',
    unavailable_reason: null,
    preview_source_snapshot: {
      snapshot_version: BUILDER_LIVE_PREVIEW_SOURCE_SNAPSHOT_VERSION,
      source_kind: sourceKind,
      project_id: PROJECT_ID,
      conversation_id: CONVERSATION_ID,
      source_tree: sourceTree,
      source_tree_digest: sourceTree.source_tree_digest,
      source_ref: sourceRef(sourceTree, { source_kind: sourceKind, source_ref: overrides.source_ref }),
      admission: {
        preview_source_admission: 'main_owned_verified_preview_source',
        source_tree_digest: sourceTree.source_tree_digest,
      },
      authority: sourceResolverAuthority(),
      ...(overrides.preview_source_snapshot ?? {}),
    },
    ...Object.fromEntries(
      Object.entries(overrides).filter(([key]) => (
        key !== 'source_tree' && key !== 'source_kind' && key !== 'source_ref'
        && key !== 'preview_source_snapshot'
      )),
    ),
  };
}

function request(overrides = {}) {
  return {
    source_resolver_result: resolverResult(overrides.resolver ?? {}),
    selected_entry_path: 'index.html',
    preview_kind: 'live_static_web',
    admitted_at_ms: 1_000,
    expires_at_ms: 61_000,
    ...Object.fromEntries(
      Object.entries(overrides).filter(([key]) => key !== 'resolver'),
    ),
  };
}

function clone(value) {
  return structuredClone(value);
}

test('admits a current draft HTML entry from a ready preview source snapshot', () => {
  const admitted = createBuilderLivePreviewSourceAdmission(request());

  assert.match(admitted.admission_id, /^builder-live-preview-source-admission:[0-9a-f]{64}$/u);
  assert.equal(admitted.source_kind, 'current_draft');
  assert.equal(admitted.project_id, PROJECT_ID);
  assert.equal(admitted.conversation_id, CONVERSATION_ID);
  assert.equal(admitted.selected_entry_path, 'index.html');
  assert.equal(admitted.source_ref.source_ref_kind, 'current_draft_checkpoint_candidate');
  assert.equal(admitted.source_ref.checkpoint_id, CHECKPOINT_ID);
  assert.equal(admitted.source_tree.source_tree_digest, admitted.source_tree_digest);
  assert.equal(admitted.lifecycle.preview_server, 'not_started');
  assert.equal(admitted.lifecycle.webcontents_view, 'not_attached');
  assert.equal(admitted.authority.server_start, 'not_started');
  assert.equal(admitted.authority.electron_view_attachment, 'not_performed');
  assert.equal(admitted.authority.renderer_source_tree, 'not_accepted');
  assert.equal(Object.isFrozen(admitted.source_tree.files), true);
  assert.deepEqual(sanitizeBuilderLivePreviewSourceAdmission(admitted), admitted);
});

test('admits a saved revision HTML entry without draft or run authority', () => {
  const admitted = createBuilderLivePreviewSourceAdmission(request({
    resolver: { source_kind: 'saved_revision' },
    selected_entry_path: 'nested/page.htm',
  }));

  assert.equal(admitted.source_kind, 'saved_revision');
  assert.equal(admitted.source_ref.source_ref_kind, 'saved_project_revision');
  assert.equal(admitted.source_ref.revision_receipt_digest, REVISION_DIGEST);
  assert.equal(admitted.selected_entry_path, 'nested/page.htm');
  assert.equal(admitted.authority.revision_admission, 'not_created');
  assert.equal(admitted.authority.save_admission, 'not_performed');
});

test('rejects unavailable resolver results and renderer supplied source hints', () => {
  assert.throws(
    () => createBuilderLivePreviewSourceAdmission(request({
      resolver: {
        status: 'unavailable',
        unavailable_reason: 'preview_source_authority_unavailable',
        preview_source_snapshot: null,
      },
    })),
    { code: 'builder_live_preview_source_admission_invalid' },
  );
  assert.throws(
    () => createBuilderLivePreviewSourceAdmission({
      ...request(),
      source_tree: tree(),
    }),
    { code: 'builder_live_preview_source_admission_invalid' },
  );
  assert.throws(
    () => createBuilderLivePreviewSourceAdmission({
      ...request(),
      path: 'index.html',
    }),
    { code: 'builder_live_preview_source_admission_invalid' },
  );
});

test('rejects non-HTML, missing, and traversal entry paths', () => {
  for (const selectedEntryPath of ['app.js', 'missing.html', '../index.html', '/index.html']) {
    assert.throws(
      () => createBuilderLivePreviewSourceAdmission(request({ selected_entry_path: selectedEntryPath })),
      { code: 'builder_live_preview_source_admission_invalid' },
    );
  }
});

test('rejects snapshot digest, source ref, and authority drift', () => {
  assert.throws(
    () => createBuilderLivePreviewSourceAdmission(request({
      resolver: {
        preview_source_snapshot: {
          source_tree_digest: `sha256:${'9'.repeat(64)}`,
        },
      },
    })),
    { code: 'builder_live_preview_source_admission_invalid' },
  );
  assert.throws(
    () => createBuilderLivePreviewSourceAdmission(request({
      resolver: {
        source_ref: { resulting_tree_digest: `sha256:${'8'.repeat(64)}` },
      },
    })),
    { code: 'builder_live_preview_source_admission_invalid' },
  );
  assert.throws(
    () => createBuilderLivePreviewSourceAdmission(request({
      resolver: {
        preview_source_snapshot: {
          authority: {
            ...sourceResolverAuthority(),
            electron_view_attachment: true,
          },
        },
      },
    })),
    { code: 'builder_live_preview_source_admission_invalid' },
  );
});

test('rejects stale timing and tampered recorded admissions', () => {
  assert.throws(
    () => createBuilderLivePreviewSourceAdmission(request({ expires_at_ms: 1_000 })),
    { code: 'builder_live_preview_source_admission_invalid' },
  );
  assert.throws(
    () => createBuilderLivePreviewSourceAdmission(request({ expires_at_ms: 1_801_001 })),
    { code: 'builder_live_preview_source_admission_invalid' },
  );

  const admitted = createBuilderLivePreviewSourceAdmission(request());
  const tamperedId = clone(admitted);
  tamperedId.admission_id = `builder-live-preview-source-admission:${'f'.repeat(64)}`;
  assert.throws(
    () => sanitizeBuilderLivePreviewSourceAdmission(tamperedId),
    { code: 'builder_live_preview_source_admission_invalid' },
  );

  const tamperedEntry = clone(admitted);
  tamperedEntry.selected_entry_digest = `sha256:${'e'.repeat(64)}`;
  assert.throws(
    () => sanitizeBuilderLivePreviewSourceAdmission(tamperedEntry),
    { code: 'builder_live_preview_source_admission_invalid' },
  );
});

test('source admission stays preview-only and does not start runtime authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-live-preview-source-admission.cjs'),
    'utf8',
  );
  assert.match(source, /main_live_preview_source_admission_contract_v1/u);
  assert.match(source, /not_started/u);
  assert.doesNotMatch(
    source,
    /ipcMain|ipcRenderer|BrowserWindow|WebContentsView|BrowserView|contextBridge|preload\.cjs|createServer|listen\(|node:http|node:https|child_process|execFile|spawn\(|writeFile|appendFile|mkdir|rm\(|record_project_revision|save_project|provider_dispatch\s*:\s*true|tool_dispatch\s*:\s*true/iu,
  );
  assert.match(
    source,
    /const INPUT_KEYS = Object\.freeze\(\[\s*'source_resolver_result',\s*'selected_entry_path',\s*'preview_kind',\s*'admitted_at_ms',\s*'expires_at_ms',\s*\]\);/u,
  );
});
