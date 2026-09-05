'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');

function read(...parts) {
  return fs.readFileSync(path.join(ROOT, ...parts), 'utf8');
}

test('task transcript export is an explicit Main-owned product contract', () => {
  const contract = read('electron', 'builder-task-transcript-export.cjs');
  const ipc = read('electron', 'builder-agent-project-tree-ipc-adapter.cjs');
  const runtime = read('electron', 'builder-generation-ipc-runtime.cjs');
  const preload = read('electron', 'preload.cjs');
  const port = read('src', 'features', 'builder', 'infrastructure', 'builderDesktopAgentProjectTreePort.ts');
  const sidebar = read('src', 'features', 'builder', 'presentation', 'BuilderAgentSidebar.tsx');

  assert.match(contract, /BUILDER_TASK_TRANSCRIPT_EXPORT_VERSION = 'builder-task-transcript-export\.v1'/u);
  assert.match(contract, /createBuilderTaskTranscriptExport/u);
  assert.match(contract, /sanitizeBuilderTaskAddress/u);
  assert.match(contract, /createBuilderConversationExport/u);
  assert.match(contract, /export_authority: 'main_task_transcript_export_contract_v1'/u);
  assert.match(contract, /renderer_authority: 'task_export_request_only'/u);
  assert.match(contract, /source_read: 'not_performed'/u);
  assert.match(contract, /source_write: 'not_performed'/u);
  assert.match(contract, /git_mutation: 'not_performed'/u);
  assert.match(contract, /provider_dispatch: 'not_performed'/u);
  assert.match(contract, /export_materialization: 'not_performed'/u);

  assert.match(ipc, /EXPORT_AGENT_TASK_TRANSCRIPT_CHANNEL/u);
  assert.match(ipc, /task_export_transcript/u);
  assert.match(runtime, /sessionTaskAddressStore\.read_task_address/u);
  assert.match(runtime, /projectMainAuthority\.metadata_authority\.load_conversation/u);
  assert.match(runtime, /createBuilderTaskTranscriptExport/u);
  assert.match(preload, /exportTaskTranscript\(request\)/u);
  assert.match(port, /exportTaskTranscript/u);
  assert.match(sidebar, /data-builder-agent-context-export-task-transcript/u);
});

test('task transcript export keeps generic and dangerous lifecycle shortcuts absent', () => {
  const files = [
    read('electron', 'builder-agent-project-tree-ipc-adapter.cjs'),
    read('electron', 'preload.cjs'),
    read('src', 'features', 'builder', 'infrastructure', 'builderDesktopAgentProjectTreePort.ts'),
    read('src', 'features', 'builder', 'presentation', 'BuilderAgentSidebar.tsx'),
  ].join('\n');

  assert.doesNotMatch(files, /\bexportTask\s*[:(]/u);
  assert.doesNotMatch(files, /DELETE_AGENT_TASK_CHANNEL|FORK_AGENT_TASK_CHANNEL|deleteTask|forkTask/u);
  assert.doesNotMatch(files, /delete_files|host_path|destination_path|source_tree|commit_oid|tree_oid/u);
});

test('stage document records the external baseline and no-compatibility export decision', () => {
  const doc = read('docs', 'BUILDER_TASK_LIFECYCLE_EXPORT_FIRST_GATE_2026_09_02.md');

  assert.match(doc, /DeepSeek Harness keeps the Session log as the source of truth/u);
  assert.match(doc, /Cursor exposes chat history management and exports conversations to Markdown/u);
  assert.match(doc, /exportTaskTranscript/u);
  assert.match(doc, /Renderer supplies only `agent_id`, `project_id`, and `task_address_id`/u);
  assert.match(doc, /No `exportTask` compatibility method/u);
  assert.match(doc, /No host-path file writer/u);
});
