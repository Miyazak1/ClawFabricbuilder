'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');

function read(...parts) {
  return fs.readFileSync(path.join(ROOT, ...parts), 'utf8');
}

test('task lifecycle boundary rejects root conversation lookup and reports soft archive authority', () => {
  const store = read('electron', 'builder-session-task-address-store.cjs');
  const ipc = read('electron', 'builder-agent-project-tree-ipc-adapter.cjs');
  const projection = read('electron', 'builder-agent-project-tree-projection.cjs');

  assert.match(store, /\bsanitizeBuilderTaskConversationAddress\b/);
  assert.match(store, /const conversationId = safeTaskConversationId/);
  assert.doesNotMatch(store, /const conversationId = safeConversationId/);
  assert.match(store, /archive_authority: 'main_owned_task_address_soft_archive'/);
  assert.match(store, /delete_authority: false/);
  assert.match(store, /fork_authority: false/);
  assert.match(store, /export_materialization: false/);

  assert.match(ipc, /renderer_authority: 'agent_project_task_selection_only'/);
  assert.match(ipc, /request_surface: 'read_and_bounded_lifecycle_methods_only'/);
  assert.match(ipc, /lifecycle_authority: 'main_owned_project_and_task_lifecycle_stores'/);
  assert.match(ipc, /read_only: false/);
  assert.match(ipc, /return invokeLifecycle\(event, args, options\.archiveTask, 'task_archive'\)/);
  assert.match(ipc, /task_export_transcript/);
  assert.match(ipc, /\['agent_id', 'project_id', 'task_address_id'\]/);
  assert.doesNotMatch(ipc, /delete_files|filesystem_delete|conversation_id|source_tree|commit_oid|tree_oid/);

  assert.match(projection, /sanitizeBuilderTaskAddress/);
  assert.match(projection, /task = sanitizeBuilderTaskAddress\(record\?\.task_address\)/);
});

test('stage document records the no-compatibility lifecycle decision', () => {
  const doc = read('docs', 'BUILDER_TASK_LIFECYCLE_NATIVE_BOUNDARY_GATE_2026_09_02.md');

  assert.match(doc, /Task lookup by conversation is task-scoped only/);
  assert.match(doc, /Task archive remains a Main-owned soft Task Address lifecycle update/);
  assert.match(doc, /Delete, fork, and export materialization are not implemented/);
  assert.match(doc, /No compatibility path from root conversation history to task conversation/);
});
