'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  digestBuilderProjectProposalRecord,
  digestBuilderProjectRevisionRecord,
} = require('../electron/builder-project-revision-record.cjs');
const {
  BuilderProjectRevisionIpcError,
  createBuilderProjectRevisionIpcAdapter,
} = require('../electron/builder-project-revision-ipc-adapter.cjs');

const PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174000';
const SOURCE_PATH = path.join(
  __dirname,
  '..',
  'electron',
  'builder-project-revision-ipc-adapter.cjs',
);

function fixture(overrides = {}) {
  const revision = overrides.revision ?? 1;
  const parent = overrides.parent_revision ?? null;
  const candidate = {
    schema_version: 1,
    record_kind: 'builder_project_revision',
    project_id: PROJECT_ID,
    revision,
    revision_digest: `sha256:${'0'.repeat(64)}`,
    parent_revision: parent,
    title: overrides.title ?? `Focus board ${revision}`,
    summary: 'A small board for today.',
    files: {
      'index.html': `<main>Revision ${revision}</main>`,
      'styles.css': 'main { display: grid; }',
      'app.js': 'const board = document.querySelector("main");\nvoid board;',
    },
    proposal_evidence: {
      authority: 'builder_code_project_generator',
      prompt_version: 'builder-code-project.v1',
      request_version: 'builder-generation-request.v1',
      result_version: 'builder-generation-result.v1',
      request_digest: `sha256:${'a'.repeat(64)}`,
      proposal_digest: `sha256:${'0'.repeat(64)}`,
      project_id: PROJECT_ID,
      target_revision: revision,
      parent_revision: parent,
    },
    execution_admission: 'not_evaluated',
    preview_script_admission: 'not_authorized',
  };
  candidate.proposal_evidence.proposal_digest = digestBuilderProjectProposalRecord(candidate);
  candidate.revision_digest = digestBuilderProjectRevisionRecord(candidate);
  return candidate;
}

function nextRevision(parent, title = 'Focus board 2') {
  return fixture({
    revision: parent.revision + 1,
    parent_revision: {
      revision: parent.revision,
      revision_digest: parent.revision_digest,
    },
    title,
  });
}

function temporaryRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawfabric-builder-ipc-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function activeWindow() {
  const webContents = { isDestroyed: () => false };
  return {
    webContents,
    isDestroyed: () => false,
  };
}

function adapter(t, windowRef = activeWindow()) {
  return {
    windowRef,
    value: createBuilderProjectRevisionIpcAdapter({
      rootPath: temporaryRoot(t),
      mainWindowRef: () => windowRef,
    }),
  };
}

function expectedPrevious(record) {
  return record.parent_revision === null ? null : { ...record.parent_revision };
}

async function expectIpcError(promise, code) {
  await assert.rejects(promise, (error) => error instanceof BuilderProjectRevisionIpcError
    && error.code === code
    && !error.message.includes(PROJECT_ID)
    && !error.message.includes(os.tmpdir())
    && error.stack === `${error.name}: ${error.message}`);
}

test('exposes only controlled Builder project revision channels', (t) => {
  const { value } = adapter(t);
  assert.equal(value.adapter_id, 'builder_project_revisions.controlled_ipc_adapter.v1');
  assert.equal(value.namespace, 'builderProjectRevisions');
  assert.equal(value.preload_namespace, 'window.clawfabricBuilder.projectRevisions');
  assert.deepEqual(value.exposed_methods, ['commit', 'loadCurrent']);
  assert.deepEqual(Object.keys(value.channels), ['commit', 'loadCurrent']);
  assert.equal(value.channels.commit.channel, 'clawfabric-builder:project-revisions:commit');
  assert.equal(
    value.channels.loadCurrent.channel,
    'clawfabric-builder:project-revisions:load-current',
  );
  assert.deepEqual(value.authority, {
    host_constructed_repository: true,
    main_process_composition: 'not_evaluated',
    active_renderer_required: true,
    direct_electron_registration: false,
    direct_preload_exposure: false,
    generic_draft_authority_reused: false,
    generic_provider_authority_reused: false,
  });
});

test('commits and restart-restores exact revisions only for the active renderer', async (t) => {
  const root = temporaryRoot(t);
  const windowRef = activeWindow();
  const first = createBuilderProjectRevisionIpcAdapter({ rootPath: root, mainWindowRef: windowRef });
  const revisionOne = fixture();
  const committed = await first.channels.commit.invoke(
    { sender: windowRef.webContents },
    { revision: revisionOne, expected_previous: null },
  );
  assert.deepEqual(committed.record, revisionOne);
  assert.equal(committed.idempotent_replay, false);

  const restarted = createBuilderProjectRevisionIpcAdapter({ rootPath: root, mainWindowRef: windowRef });
  const current = await restarted.channels.loadCurrent.invoke(
    { sender: windowRef.webContents },
    { project_id: PROJECT_ID },
  );
  assert.deepEqual(current.record, revisionOne);
  assert.equal(current.restart_restore, true);
});

test('rejects foreign and destroyed renderers before repository mutation', async (t) => {
  const root = temporaryRoot(t);
  const windowRef = activeWindow();
  const value = createBuilderProjectRevisionIpcAdapter({ rootPath: root, mainWindowRef: windowRef });
  const request = { revision: fixture(), expected_previous: null };

  await expectIpcError(
    value.channels.commit.invoke({ sender: {} }, request),
    'builder_project_revisions_forbidden',
  );
  windowRef.isDestroyed = () => true;
  await expectIpcError(
    value.channels.commit.invoke({ sender: windowRef.webContents }, request),
    'builder_project_revisions_forbidden',
  );

  const restoredWindow = activeWindow();
  const restarted = createBuilderProjectRevisionIpcAdapter({
    rootPath: root,
    mainWindowRef: restoredWindow,
  });
  await expectIpcError(
    restarted.channels.loadCurrent.invoke(
      { sender: restoredWindow.webContents },
      { project_id: PROJECT_ID },
    ),
    'builder_project_revisions_not_found',
  );
});

test('maps invalid, conflict, and integrity-sensitive errors to fixed safe failures', async (t) => {
  const { windowRef, value } = adapter(t);
  const event = { sender: windowRef.webContents };
  await expectIpcError(
    value.channels.commit.invoke(event, { secret: 'private-marker' }),
    'builder_project_revisions_invalid',
  );

  const revisionOne = fixture();
  await value.channels.commit.invoke(event, {
    revision: revisionOne,
    expected_previous: null,
  });
  await expectIpcError(
    value.channels.commit.invoke(event, {
      revision: fixture({ title: 'A conflicting first version' }),
      expected_previous: null,
    }),
    'builder_project_revisions_conflict',
  );

  const revisionTwo = nextRevision(revisionOne);
  const committed = await value.channels.commit.invoke(event, {
    revision: revisionTwo,
    expected_previous: expectedPrevious(revisionTwo),
  });
  assert.equal(committed.record.revision, 2);
});

test('keeps the adapter free of Electron registration and legacy authorities', () => {
  const source = fs.readFileSync(SOURCE_PATH, 'utf8');
  assert.doesNotMatch(source, /require\(['"]electron['"]\)|ipcMain|contextBridge|ipcRenderer|BrowserWindow/u);
  assert.doesNotMatch(source, /clawfabricDesktop|desktop:builder/iu);
  assert.doesNotMatch(
    source,
    /getDraft|saveDraft|clearDraft|chat_planner|ChatCreatePage|Canvas|\bJob\b|local-provider-executor|dispatch|fetch\(|https?\./iu,
  );
  assert.match(source, /createBuilderProjectRevisionRepository/u);
  assert.match(source, /event\.sender !== webContents/u);
});
