'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  ARCHIVE_AGENT_PROJECT_CHANNEL,
  READ_AGENT_PROJECT_TREE_CHANNEL,
  RENAME_AGENT_PROJECT_CHANNEL,
  createBuilderAgentProjectTreeIpcAdapter,
} = require('../electron/builder-agent-project-tree-ipc-adapter.cjs');

const AGENT_ID = 'builder-agent:123e4567-e89b-42d3-a456-426614174002';

test('exposes one sender-bound read-only Agent project tree request', async () => {
  const webContents = {};
  const calls = [];
  const adapter = createBuilderAgentProjectTreeIpcAdapter({
    readTree(request) { calls.push(request); return Promise.resolve({ projection_version: 'agent-project-tree-projection.v1' }); },
    renameProject(request) { calls.push({ renameProject: request }); return Promise.resolve({ ok: true }); },
    archiveProject(request) { calls.push({ archiveProject: request }); return Promise.resolve({ ok: true }); },
    renameTask(request) { calls.push({ renameTask: request }); return Promise.resolve({ ok: true }); },
    archiveTask(request) { calls.push({ archiveTask: request }); return Promise.resolve({ ok: true }); },
    mainWindowRef() { return { webContents }; },
  });
  assert.equal(adapter.channel, READ_AGENT_PROJECT_TREE_CHANNEL);
  assert.equal(adapter.channels.renameProject.channel, RENAME_AGENT_PROJECT_CHANNEL);
  assert.equal(adapter.channels.archiveProject.channel, ARCHIVE_AGENT_PROJECT_CHANNEL);
  assert.deepEqual(await adapter.invoke({ sender: webContents }, { agent_id: AGENT_ID }), {
    projection_version: 'agent-project-tree-projection.v1',
  });
  assert.deepEqual(await adapter.channels.renameProject.invoke(
    { sender: webContents },
    {
      agent_id: AGENT_ID,
      project_id: 'builder-project:123e4567-e89b-42d3-a456-426614174200',
      title: 'Renamed project',
    },
  ), { ok: true });
  assert.deepEqual(await adapter.channels.archiveProject.invoke(
    { sender: webContents },
    {
      agent_id: AGENT_ID,
      project_id: 'builder-project:123e4567-e89b-42d3-a456-426614174200',
    },
  ), { ok: true });
  assert.deepEqual(calls, [
    { agent_id: AGENT_ID },
    {
      renameProject: {
        agent_id: AGENT_ID,
        project_id: 'builder-project:123e4567-e89b-42d3-a456-426614174200',
        title: 'Renamed project',
      },
    },
    {
      archiveProject: {
        agent_id: AGENT_ID,
        project_id: 'builder-project:123e4567-e89b-42d3-a456-426614174200',
      },
    },
  ]);
  await assert.rejects(adapter.invoke({ sender: {} }, { agent_id: AGENT_ID }), {
    code: 'builder_agent_project_tree_forbidden',
  });
  await assert.rejects(adapter.invoke(
    { sender: webContents },
    { agent_id: AGENT_ID, extra: true },
  ), {
    code: 'builder_agent_project_tree_invalid',
  });
});

test('rejects destroyed renderers and non-plain projection output', async () => {
  const webContents = { isDestroyed: () => true };
  const destroyed = createBuilderAgentProjectTreeIpcAdapter({
    readTree() { throw new Error('must not run'); },
    renameProject() { throw new Error('must not run'); },
    archiveProject() { throw new Error('must not run'); },
    renameTask() { throw new Error('must not run'); },
    archiveTask() { throw new Error('must not run'); },
    mainWindowRef() { return { webContents }; },
  });
  await assert.rejects(destroyed.invoke({ sender: webContents }, { agent_id: AGENT_ID }), {
    code: 'builder_agent_project_tree_forbidden',
  });

  const activeWebContents = {};
  const invalidOutput = createBuilderAgentProjectTreeIpcAdapter({
    readTree() { return { unsafe: new Date(0) }; },
    renameProject() { return { ok: true }; },
    archiveProject() { return { ok: true }; },
    renameTask() { return { ok: true }; },
    archiveTask() { return { ok: true }; },
    mainWindowRef() { return { webContents: activeWebContents }; },
  });
  await assert.rejects(invalidOutput.invoke(
    { sender: activeWebContents },
    { agent_id: AGENT_ID },
  ), { code: 'builder_agent_project_tree_unavailable' });
});
