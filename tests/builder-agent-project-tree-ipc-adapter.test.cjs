'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  ARCHIVE_AGENT_PROJECT_CHANNEL,
  ARCHIVE_AGENT_TASK_CHANNEL,
  EXPORT_AGENT_TASK_TRANSCRIPT_CHANNEL,
  READ_AGENT_PROJECT_TREE_CHANNEL,
  RENAME_AGENT_PROJECT_CHANNEL,
  RENAME_AGENT_TASK_CHANNEL,
  createBuilderAgentProjectTreeIpcAdapter,
} = require('../electron/builder-agent-project-tree-ipc-adapter.cjs');

const AGENT_ID = 'builder-agent:123e4567-e89b-42d3-a456-426614174002';

test('exposes sender-bound Agent project tree read and bounded lifecycle requests', async () => {
  const webContents = {};
  const calls = [];
  const adapter = createBuilderAgentProjectTreeIpcAdapter({
    readTree(request) { calls.push(request); return Promise.resolve({ projection_version: 'agent-project-tree-projection.v1' }); },
    renameProject(request) { calls.push({ renameProject: request }); return Promise.resolve({ ok: true }); },
    archiveProject(request) { calls.push({ archiveProject: request }); return Promise.resolve({ ok: true }); },
    renameTask(request) { calls.push({ renameTask: request }); return Promise.resolve({ ok: true }); },
    archiveTask(request) { calls.push({ archiveTask: request }); return Promise.resolve({ ok: true }); },
    exportTaskTranscript(request) { calls.push({ exportTaskTranscript: request }); return Promise.resolve({ ok: true }); },
    mainWindowRef() { return { webContents }; },
  });
  assert.equal(adapter.channel, READ_AGENT_PROJECT_TREE_CHANNEL);
  assert.equal(adapter.authority.renderer_authority, 'agent_project_task_selection_only');
  assert.equal(adapter.authority.request_surface, 'read_and_bounded_lifecycle_methods_only');
  assert.equal(adapter.authority.read_only, false);
  assert.equal(adapter.authority.lifecycle_authority, 'main_owned_project_and_task_lifecycle_stores');
  assert.equal(adapter.channels.renameProject.channel, RENAME_AGENT_PROJECT_CHANNEL);
  assert.equal(adapter.channels.archiveProject.channel, ARCHIVE_AGENT_PROJECT_CHANNEL);
  assert.equal(adapter.channels.renameTask.channel, RENAME_AGENT_TASK_CHANNEL);
  assert.equal(adapter.channels.archiveTask.channel, ARCHIVE_AGENT_TASK_CHANNEL);
  assert.equal(adapter.channels.exportTaskTranscript.channel, EXPORT_AGENT_TASK_TRANSCRIPT_CHANNEL);
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
  assert.deepEqual(await adapter.channels.renameTask.invoke(
    { sender: webContents },
    {
      agent_id: AGENT_ID,
      project_id: 'builder-project:123e4567-e89b-42d3-a456-426614174200',
      task_address_id: 'builder-task-address:123e4567-e89b-42d3-a456-426614174201',
      title: 'Renamed task',
    },
  ), { ok: true });
  assert.deepEqual(await adapter.channels.archiveTask.invoke(
    { sender: webContents },
    {
      agent_id: AGENT_ID,
      project_id: 'builder-project:123e4567-e89b-42d3-a456-426614174200',
      task_address_id: 'builder-task-address:123e4567-e89b-42d3-a456-426614174201',
    },
  ), { ok: true });
  assert.deepEqual(await adapter.channels.exportTaskTranscript.invoke(
    { sender: webContents },
    {
      agent_id: AGENT_ID,
      project_id: 'builder-project:123e4567-e89b-42d3-a456-426614174200',
      task_address_id: 'builder-task-address:123e4567-e89b-42d3-a456-426614174201',
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
    {
      renameTask: {
        agent_id: AGENT_ID,
        project_id: 'builder-project:123e4567-e89b-42d3-a456-426614174200',
        task_address_id: 'builder-task-address:123e4567-e89b-42d3-a456-426614174201',
        title: 'Renamed task',
      },
    },
    {
      archiveTask: {
        agent_id: AGENT_ID,
        project_id: 'builder-project:123e4567-e89b-42d3-a456-426614174200',
        task_address_id: 'builder-task-address:123e4567-e89b-42d3-a456-426614174201',
      },
    },
    {
      exportTaskTranscript: {
        agent_id: AGENT_ID,
        project_id: 'builder-project:123e4567-e89b-42d3-a456-426614174200',
        task_address_id: 'builder-task-address:123e4567-e89b-42d3-a456-426614174201',
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
  await assert.rejects(adapter.channels.archiveTask.invoke(
    { sender: webContents },
    {
      agent_id: AGENT_ID,
      project_id: 'builder-project:123e4567-e89b-42d3-a456-426614174200',
      task_address_id: 'builder-task-address:123e4567-e89b-42d3-a456-426614174201',
      delete_files: true,
    },
  ), {
    code: 'builder_agent_project_tree_invalid',
  });
  await assert.rejects(adapter.channels.exportTaskTranscript.invoke(
    { sender: webContents },
    {
      agent_id: AGENT_ID,
      project_id: 'builder-project:123e4567-e89b-42d3-a456-426614174200',
      task_address_id: 'builder-task-address:123e4567-e89b-42d3-a456-426614174201',
      host_path: 'C:\\private\\task.md',
    },
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
    exportTaskTranscript() { throw new Error('must not run'); },
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
    exportTaskTranscript() { return { ok: true }; },
    mainWindowRef() { return { webContents: activeWebContents }; },
  });
  await assert.rejects(invalidOutput.invoke(
    { sender: activeWebContents },
    { agent_id: AGENT_ID },
  ), { code: 'builder_agent_project_tree_unavailable' });
});
