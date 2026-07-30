'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  CREATE_LOCAL_PROJECT_CHANNEL,
  OPEN_PROJECT_CHANNEL,
  OPEN_PROJECT_LOCATION_CHANNEL,
  SAVE_DRAFT_CHANNEL,
  LOAD_CURRENT_CHANNEL,
  LOAD_REVISION_CHANNEL,
  LIST_CURRENT_CHANNEL,
  LIST_WORKSPACES_CHANNEL,
  LIST_HISTORY_CHANNEL,
  BuilderProjectWorkspaceIpcError,
  createBuilderProjectWorkspaceIpcAdapter,
} = require('../electron/builder-project-workspace-ipc-adapter.cjs');

const PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174000';
const DRAFT_ID = `builder-generation-draft:${'a'.repeat(64)}`;
const REVISION_DIGEST = `sha256:${'b'.repeat(64)}`;

function windowAuthority() {
  const webContents = Object.freeze({
    isDestroyed: () => false,
  });
  const window = Object.freeze({
    webContents,
    isDestroyed: () => false,
  });
  return { event: Object.freeze({ sender: webContents }), mainWindowRef: () => window };
}

function adapter(overrides = {}) {
  const authority = windowAuthority();
  const calls = [];
  const value = createBuilderProjectWorkspaceIpcAdapter({
    openProject: overrides.openProject ?? (async (request) => {
      calls.push(['open', request]);
      return request.project_id === null
        ? {
          result_version: 'builder-project-selection-result.v1',
          operation: 'new_selected',
          project_id: null,
        }
        : { result_version: 'builder-project-read-result.v1', project_id: request.project_id };
    }),
    openProjectLocation: overrides.openProjectLocation ?? (async (request) => {
      calls.push(['openLocation', request]);
      return {
        result_version: 'builder-project-location-open-result.v1',
        project_id: request.project_id,
        opened: true,
      };
    }),
    saveDraft: overrides.saveDraft ?? (async (request) => {
      calls.push(['save', request]);
      return { result_version: 'builder-project-save-result.v1', draft_id: request.draft_id };
    }),
    createLocalProject: overrides.createLocalProject ?? (async (request) => {
      calls.push(['createLocalProject', request]);
      return {
        result_version: 'builder-project-selection-result.v1',
        operation: 'local_project_bound',
        project_id: PROJECT_ID,
        project_title: request.project_title,
        source_folders: [{ name: 'focus-timer', status: 'selected' }],
      };
    }),
    loadCurrent: overrides.loadCurrent ?? (async (request) => {
      calls.push(['load', request]);
      return { result_version: 'builder-project-read-result.v1', project_id: request.project_id };
    }),
    loadRevision: overrides.loadRevision ?? (async (request) => {
      calls.push(['revision', request]);
      return {
        result_version: 'builder-project-read-result.v1',
        operation: 'revision_loaded',
        project_id: request.project_id,
        revision_receipt_digest: request.revision_receipt_digest,
      };
    }),
    listCurrent: overrides.listCurrent ?? (async () => {
      calls.push(['list']);
      return { result_version: 'builder-project-read-result.v1', projects: [] };
    }),
    listWorkspaces: overrides.listWorkspaces ?? (async () => {
      calls.push(['listWorkspaces']);
      return {
        result_version: 'builder-product-metadata-result.v4',
        operation: 'project_workspaces_listed',
        workspaces: [],
      };
    }),
    listHistory: overrides.listHistory ?? (async (request) => {
      calls.push(['history', request]);
      return { result_version: 'builder-project-read-result.v1', operation: 'history_listed', project_id: request.project_id };
    }),
    mainWindowRef: authority.mainWindowRef,
  });
  return { authority, calls, value };
}

test('workspace adapter exposes only open, save, verified reads, and catalog commands', async () => {
  const { authority, calls, value } = adapter();
  assert.equal(value.namespace, 'builderProjectWorkspace');
  assert.deepEqual(value.exposed_methods, ['open', 'openLocation', 'createLocalProject', 'saveDraft', 'loadCurrent', 'loadRevision', 'listCurrent', 'listWorkspaces', 'listHistory']);
  assert.deepEqual(Object.keys(value.channels), ['open', 'openLocation', 'saveDraft', 'createLocalProject', 'loadCurrent', 'loadRevision', 'listCurrent', 'listWorkspaces', 'listHistory']);
  assert.equal(value.channels.open.channel, OPEN_PROJECT_CHANNEL);
  assert.equal(value.channels.openLocation.channel, OPEN_PROJECT_LOCATION_CHANNEL);
  assert.equal(value.channels.createLocalProject.channel, CREATE_LOCAL_PROJECT_CHANNEL);
  assert.equal(value.channels.saveDraft.channel, SAVE_DRAFT_CHANNEL);
  assert.equal(value.channels.loadCurrent.channel, LOAD_CURRENT_CHANNEL);
  assert.equal(value.channels.loadRevision.channel, LOAD_REVISION_CHANNEL);
  assert.equal(value.channels.listCurrent.channel, LIST_CURRENT_CHANNEL);
  assert.equal(value.channels.listWorkspaces.channel, LIST_WORKSPACES_CHANNEL);
  assert.equal(value.channels.listHistory.channel, LIST_HISTORY_CHANNEL);

  const selected = await value.channels.open.invoke(authority.event, {
    project_id: null,
  });
  const locationOpened = await value.channels.openLocation.invoke(authority.event, {
    project_id: PROJECT_ID,
  });
  const saved = await value.channels.saveDraft.invoke(authority.event, {
    draft_id: DRAFT_ID,
  });
  const created = await value.channels.createLocalProject.invoke(authority.event, {
    project_id: null,
    project_title: 'Focus timer',
  });
  const loaded = await value.channels.loadCurrent.invoke(authority.event, {
    project_id: PROJECT_ID,
  });
  const revision = await value.channels.loadRevision.invoke(authority.event, {
    project_id: PROJECT_ID,
    revision_receipt_digest: REVISION_DIGEST,
  });
  const listed = await value.channels.listCurrent.invoke(authority.event);
  const listedWorkspaces = await value.channels.listWorkspaces.invoke(authority.event);
  const history = await value.channels.listHistory.invoke(authority.event, {
    project_id: PROJECT_ID,
    limit: 32,
  });
  assert.equal(selected.operation, 'new_selected');
  assert.equal(locationOpened.result_version, 'builder-project-location-open-result.v1');
  assert.equal(locationOpened.opened, true);
  assert.equal(saved.result_version, 'builder-project-save-result.v1');
  assert.equal(created.operation, 'local_project_bound');
  assert.equal(loaded.result_version, 'builder-project-read-result.v1');
  assert.equal(revision.operation, 'revision_loaded');
  assert.deepEqual(listed.projects, []);
  assert.deepEqual(listedWorkspaces.workspaces, []);
  assert.equal(history.operation, 'history_listed');
  assert.deepEqual(calls, [
    ['open', { project_id: null }],
    ['openLocation', { project_id: PROJECT_ID }],
    ['save', { draft_id: DRAFT_ID }],
    ['createLocalProject', { project_id: null, project_title: 'Focus timer' }],
    ['load', { project_id: PROJECT_ID }],
    ['revision', { project_id: PROJECT_ID, revision_receipt_digest: REVISION_DIGEST }],
    ['list'],
    ['listWorkspaces'],
    ['history', { project_id: PROJECT_ID, limit: 32 }],
  ]);
  assert.equal(Object.isFrozen(saved), true);
  assert.equal(Object.isFrozen(locationOpened), true);
  assert.equal(Object.isFrozen(revision), true);
  assert.equal(Object.isFrozen(listed.projects), true);
  assert.equal(Object.isFrozen(history), true);
});

test('workspace adapter rejects inactive senders and extra arguments before authority calls', async () => {
  const { authority, calls, value } = adapter();
  const inactive = Object.freeze({ sender: Object.freeze({}) });
  await assert.rejects(
    value.channels.saveDraft.invoke(inactive, { draft_id: DRAFT_ID }),
    (error) => error instanceof BuilderProjectWorkspaceIpcError
      && error.code === 'builder_project_workspace_forbidden',
  );
  await assert.rejects(
    value.channels.openLocation.invoke(authority.event, {
      project_id: PROJECT_ID,
    }, {}),
    (error) => error instanceof BuilderProjectWorkspaceIpcError
      && error.code === 'builder_project_workspace_invalid',
  );
  await assert.rejects(
    value.channels.listCurrent.invoke(authority.event, {}),
    (error) => error instanceof BuilderProjectWorkspaceIpcError
      && error.code === 'builder_project_workspace_invalid',
  );
  await assert.rejects(
    value.channels.listWorkspaces.invoke(authority.event, {}),
    (error) => error instanceof BuilderProjectWorkspaceIpcError
      && error.code === 'builder_project_workspace_invalid',
  );
  await assert.rejects(
    value.channels.listHistory.invoke(authority.event),
    (error) => error instanceof BuilderProjectWorkspaceIpcError
      && error.code === 'builder_project_workspace_invalid',
  );
  await assert.rejects(
    value.channels.createLocalProject.invoke(authority.event),
    (error) => error instanceof BuilderProjectWorkspaceIpcError
      && error.code === 'builder_project_workspace_invalid',
  );
  await assert.rejects(
    value.channels.loadRevision.invoke(authority.event, {
      project_id: PROJECT_ID,
    }, {
      revision_receipt_digest: REVISION_DIGEST,
    }),
    (error) => error instanceof BuilderProjectWorkspaceIpcError
      && error.code === 'builder_project_workspace_invalid',
  );
  assert.deepEqual(calls, []);
});

test('workspace adapter rejects forged request fields before authority calls', async () => {
  const { authority, calls, value } = adapter();
  const accessorRequest = {};
  Object.defineProperty(accessorRequest, 'project_id', {
    enumerable: true,
    get() {
      throw new Error('private request accessor marker');
    },
  });
  const cases = [
    () => value.channels.open.invoke(authority.event, {
      project_id: null,
      source_tree: { files: [] },
    }),
    () => value.channels.createLocalProject.invoke(authority.event, {
      project_id: null,
      project_title: 'Focus timer',
      project_root_path: 'renderer-forged',
    }),
    () => value.channels.createLocalProject.invoke(authority.event, {
      project_id: null,
      project_title: '',
    }),
    () => value.channels.createLocalProject.invoke(authority.event, {
      project_title: 'Focus timer',
    }),
    () => value.channels.createLocalProject.invoke(authority.event, {
      project_id: 'not-a-builder-project',
      project_title: 'Focus timer',
    }),
    () => value.channels.open.invoke(authority.event, {
      project_id: 'not-a-builder-project',
    }),
    () => value.channels.openLocation.invoke(authority.event, {
      project_id: PROJECT_ID,
      project_root_path: 'renderer-forged',
    }),
    () => value.channels.openLocation.invoke(authority.event, {
      project_id: null,
    }),
    () => value.channels.saveDraft.invoke(authority.event, {
      draft_id: DRAFT_ID,
      source_tree: { files: [] },
    }),
    () => value.channels.saveDraft.invoke(authority.event, {
      draft_id: `builder-generation-draft:${'g'.repeat(64)}`,
    }),
    () => value.channels.loadCurrent.invoke(authority.event, {
      project_id: PROJECT_ID,
      authority: 'renderer-forged',
    }),
    () => value.channels.loadCurrent.invoke(authority.event, accessorRequest),
    () => value.channels.loadRevision.invoke(authority.event, {
      project_id: PROJECT_ID,
      revision_receipt_digest: REVISION_DIGEST,
      commit_oid: '1'.repeat(40),
    }),
    () => value.channels.loadRevision.invoke(authority.event, {
      project_id: PROJECT_ID,
      revision_receipt_digest: 'bad',
    }),
    () => value.channels.listHistory.invoke(authority.event, {
      project_id: PROJECT_ID,
      limit: 32,
      receipt: `sha256:${'e'.repeat(64)}`,
    }),
    () => value.channels.listHistory.invoke(authority.event, {
      project_id: PROJECT_ID,
      limit: 257,
    }),
  ];
  for (const run of cases) {
    await assert.rejects(
      run(),
      (error) => error instanceof BuilderProjectWorkspaceIpcError
        && error.code === 'builder_project_workspace_invalid'
        && !`${error.message}:${error.stack}`.includes('private request accessor marker'),
    );
  }
  assert.deepEqual(calls, []);
});

test('workspace adapter maps trusted authority failures to fixed public errors', async () => {
  const source = new Error('private marker');
  source.code = 'builder_project_save_conflict';
  const { authority, value } = adapter({
    saveDraft: async () => { throw source; },
  });
  await assert.rejects(
    value.channels.saveDraft.invoke(authority.event, {
      draft_id: DRAFT_ID,
    }),
    (error) => error instanceof BuilderProjectWorkspaceIpcError
      && error.code === 'builder_project_workspace_conflict'
      && !`${error.message}:${error.stack}`.includes('private marker'),
  );
});

test('workspace adapter fails closed on proxy outputs without invoking traps', async () => {
  let traps = 0;
  const hostile = new Proxy({}, {
    ownKeys() {
      traps += 1;
      throw new Error('private marker');
    },
  });
  const { authority, value } = adapter({
    loadCurrent: async () => hostile,
  });
  await assert.rejects(
    value.channels.loadCurrent.invoke(authority.event, {
      project_id: PROJECT_ID,
    }),
    (error) => error instanceof BuilderProjectWorkspaceIpcError
      && error.code === 'builder_project_workspace_unavailable',
  );
  assert.equal(traps, 0);
});

test('workspace adapter normalizes hostile proxy errors without invoking traps', async () => {
  let traps = 0;
  const hostile = new Proxy({}, {
    getPrototypeOf() {
      traps += 1;
      throw new Error('private marker');
    },
    getOwnPropertyDescriptor() {
      traps += 1;
      throw new Error('private marker');
    },
  });
  const { authority, value } = adapter({
    saveDraft: async () => { throw hostile; },
  });
  await assert.rejects(
    value.channels.saveDraft.invoke(authority.event, {
      draft_id: DRAFT_ID,
    }),
    (error) => error instanceof BuilderProjectWorkspaceIpcError
      && error.code === 'builder_project_workspace_unavailable',
  );
  assert.equal(traps, 0);
});

test('workspace adapter source has no storage, provider, or legacy revision authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-project-workspace-ipc-adapter.cjs'),
    'utf8',
  );
  assert.doesNotMatch(
    source,
    /builder-project-revision|revision-repository|head\.json|node:fs|node:path|node:sqlite|dugite|safeStorage|fetch\s*\(|ipcMain|ipcRenderer|contextBridge|BrowserWindow/iu,
  );
});
