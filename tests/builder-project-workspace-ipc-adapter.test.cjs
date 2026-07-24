'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  OPEN_PROJECT_CHANNEL,
  SAVE_DRAFT_CHANNEL,
  LOAD_CURRENT_CHANNEL,
  LIST_CURRENT_CHANNEL,
  LIST_HISTORY_CHANNEL,
  BuilderProjectWorkspaceIpcError,
  createBuilderProjectWorkspaceIpcAdapter,
} = require('../electron/builder-project-workspace-ipc-adapter.cjs');

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
    saveDraft: overrides.saveDraft ?? (async (request) => {
      calls.push(['save', request]);
      return { result_version: 'builder-project-save-result.v1', draft_id: request.draft_id };
    }),
    loadCurrent: overrides.loadCurrent ?? (async (request) => {
      calls.push(['load', request]);
      return { result_version: 'builder-project-read-result.v1', project_id: request.project_id };
    }),
    listCurrent: overrides.listCurrent ?? (async () => {
      calls.push(['list']);
      return { result_version: 'builder-project-read-result.v1', projects: [] };
    }),
    listHistory: overrides.listHistory ?? (async (request) => {
      calls.push(['history', request]);
      return { result_version: 'builder-project-read-result.v1', operation: 'history_listed', project_id: request.project_id };
    }),
    mainWindowRef: authority.mainWindowRef,
  });
  return { authority, calls, value };
}

test('workspace adapter exposes only open, save, verified read, and catalog commands', async () => {
  const { authority, calls, value } = adapter();
  assert.equal(value.namespace, 'builderProjectWorkspace');
  assert.deepEqual(value.exposed_methods, ['open', 'saveDraft', 'loadCurrent', 'listCurrent', 'listHistory']);
  assert.deepEqual(Object.keys(value.channels), ['open', 'saveDraft', 'loadCurrent', 'listCurrent', 'listHistory']);
  assert.equal(value.channels.open.channel, OPEN_PROJECT_CHANNEL);
  assert.equal(value.channels.saveDraft.channel, SAVE_DRAFT_CHANNEL);
  assert.equal(value.channels.loadCurrent.channel, LOAD_CURRENT_CHANNEL);
  assert.equal(value.channels.listCurrent.channel, LIST_CURRENT_CHANNEL);
  assert.equal(value.channels.listHistory.channel, LIST_HISTORY_CHANNEL);

  const selected = await value.channels.open.invoke(authority.event, {
    project_id: null,
  });
  const saved = await value.channels.saveDraft.invoke(authority.event, {
    draft_id: `builder-generation-draft:${'a'.repeat(64)}`,
  });
  const loaded = await value.channels.loadCurrent.invoke(authority.event, {
    project_id: 'builder-project:123e4567-e89b-42d3-a456-426614174000',
  });
  const listed = await value.channels.listCurrent.invoke(authority.event);
  const history = await value.channels.listHistory.invoke(authority.event, {
    project_id: 'builder-project:123e4567-e89b-42d3-a456-426614174000',
    limit: 32,
  });
  assert.equal(selected.operation, 'new_selected');
  assert.equal(saved.result_version, 'builder-project-save-result.v1');
  assert.equal(loaded.result_version, 'builder-project-read-result.v1');
  assert.deepEqual(listed.projects, []);
  assert.equal(history.operation, 'history_listed');
  assert.deepEqual(calls.map(([operation]) => operation), ['open', 'save', 'load', 'list', 'history']);
  assert.equal(Object.isFrozen(saved), true);
  assert.equal(Object.isFrozen(listed.projects), true);
  assert.equal(Object.isFrozen(history), true);
});

test('workspace adapter rejects inactive senders and extra arguments before authority calls', async () => {
  const { authority, calls, value } = adapter();
  const inactive = Object.freeze({ sender: Object.freeze({}) });
  await assert.rejects(
    value.channels.saveDraft.invoke(inactive, { draft_id: `builder-generation-draft:${'a'.repeat(64)}` }),
    (error) => error instanceof BuilderProjectWorkspaceIpcError
      && error.code === 'builder_project_workspace_forbidden',
  );
  await assert.rejects(
    value.channels.listCurrent.invoke(authority.event, {}),
    (error) => error instanceof BuilderProjectWorkspaceIpcError
      && error.code === 'builder_project_workspace_invalid',
  );
  await assert.rejects(
    value.channels.listHistory.invoke(authority.event),
    (error) => error instanceof BuilderProjectWorkspaceIpcError
      && error.code === 'builder_project_workspace_invalid',
  );
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
      draft_id: `builder-generation-draft:${'a'.repeat(64)}`,
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
      project_id: 'builder-project:123e4567-e89b-42d3-a456-426614174000',
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
      draft_id: `builder-generation-draft:${'a'.repeat(64)}`,
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
