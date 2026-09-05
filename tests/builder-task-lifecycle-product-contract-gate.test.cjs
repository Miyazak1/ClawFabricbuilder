'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');

function read(...parts) {
  return fs.readFileSync(path.join(ROOT, ...parts), 'utf8');
}

test('resume product contract is interrupted-run specific with no legacy resume-task alias', () => {
  const files = [
    ['electron', 'preload.cjs'],
    ['electron', 'builder-generation-ipc-adapter.cjs'],
    ['electron', 'builder-generation-ipc-runtime.cjs'],
    ['electron', 'builder-generation-main-service.cjs'],
    ['src', 'features', 'builder', 'application', 'builderPorts.ts'],
    ['src', 'features', 'builder', 'application', 'builderProjectController.ts'],
    ['src', 'features', 'builder', 'hooks', 'useBuilderProjectController.ts'],
    ['src', 'features', 'builder', 'infrastructure', 'builderDesktopCodeGeneratorPort.ts'],
    ['src', 'app', 'BuilderApp.tsx'],
    ['src', 'features', 'builder', 'presentation', 'BuilderPage.tsx'],
    ['src', 'features', 'builder', 'presentation', 'BuilderComposer.tsx'],
  ];

  for (const file of files) {
    const source = read(...file);
    assert.match(
      source,
      /resumeInterruptedRun|onResumeInterruptedRun|data-builder-resume-interrupted-run|resume_interrupted_run|prepare_resume_interrupted_run/u,
    );
    assert.doesNotMatch(source, /resumeTask|RESUME_TASK_CHANNEL|resume-task|data-builder-resume-task|onResumeTask/u);
  }

  const preload = read('electron', 'preload.cjs');
  const adapter = read('electron', 'builder-generation-ipc-adapter.cjs');
  assert.match(preload, /clawfabric-builder:code-generator:resume-interrupted-run/u);
  assert.match(adapter, /RESUME_INTERRUPTED_RUN_CHANNEL/u);
  assert.match(adapter, /method: 'resumeInterruptedRun'/u);
});

test('task lifecycle product surface exposes rename, soft archive, task transcript export, and interrupted-run resume', () => {
  const projectTreeIpc = read('electron', 'builder-agent-project-tree-ipc-adapter.cjs');
  const store = read('electron', 'builder-session-task-address-store.cjs');
  const preload = read('electron', 'preload.cjs');

  assert.match(projectTreeIpc, /RENAME_AGENT_TASK_CHANNEL/u);
  assert.match(projectTreeIpc, /ARCHIVE_AGENT_TASK_CHANNEL/u);
  assert.match(projectTreeIpc, /EXPORT_AGENT_TASK_TRANSCRIPT_CHANNEL/u);
  assert.match(projectTreeIpc, /exportTaskTranscript/u);
  assert.doesNotMatch(projectTreeIpc, /DELETE_AGENT_TASK_CHANNEL|FORK_AGENT_TASK_CHANNEL/u);
  assert.doesNotMatch(projectTreeIpc, /deleteTask|forkTask|delete_files|host_path|source_tree|commit_oid|tree_oid/u);

  assert.match(store, /archive_authority: 'main_owned_task_address_soft_archive'/u);
  assert.match(store, /delete_authority: false/u);
  assert.match(store, /fork_authority: false/u);
  assert.match(store, /export_materialization: false/u);

  assert.match(preload, /resumeInterruptedRun/u);
  assert.match(preload, /exportTaskTranscript/u);
  assert.doesNotMatch(preload, /deleteTask|forkTask/u);
});

test('stage document records external baseline and no-compatibility product contract', () => {
  const doc = read('docs', 'BUILDER_TASK_LIFECYCLE_PRODUCT_CONTRACT_GATE_2026_09_02.md');

  assert.match(doc, /DeepSeek Harness documents session state as the runtime continuity unit/u);
  assert.match(doc, /resumeInterruptedRun/u);
  assert.match(doc, /exportTaskTranscript/u);
  assert.match(doc, /No legacy channel compatibility/u);
  assert.match(doc, /No alias from `resumeTask` to `resumeInterruptedRun`/u);
  assert.match(doc, /Generic `exportTask` stays absent/u);
});
