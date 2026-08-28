'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  createBuilderProjectSourceTree,
} = require('../electron/builder-project-source-tree.cjs');
const {
  createBuilderProgrammingRuntimeDescriptor,
  createBuilderProgrammingRuntimeRunContract,
} = require('../electron/builder-programming-runtime-contract.cjs');
const {
  BuilderProgrammingWorkspaceToolsError,
  createBuilderProgrammingWorkspaceTools,
} = require('../electron/builder-programming-workspace-tools.cjs');

const UUID = '12345678-1234-4234-8234-123456789abc';
const DIGEST = `sha256:${'a'.repeat(64)}`;

function runtimeDescriptor() {
  return createBuilderProgrammingRuntimeDescriptor({
    runtime_kind: 'builder.native_tools',
    implementation_version: '0.1.0-test.1',
    capabilities: {
      streaming_text: true,
      reasoning_status: 'bounded_status',
      native_tool_calls: true,
      steering: 'queued',
      cancellation: 'cooperative',
      session_resume: 'none',
      context_compaction: false,
      parallel_read_tools: true,
    },
  });
}

function sourceTree(files = [
  { path: 'src/timer.js', content: 'export const seconds = 30;\n' },
  { path: 'README.md', content: '# Timer\n\nA small timer.\n' },
]) {
  return createBuilderProjectSourceTree({ files });
}

function runContract(tree, overrides = {}) {
  const mode = overrides.mode ?? 'build';
  const allowedTools = overrides.allowed_tools ?? ['read', 'search', 'edit', 'write'];
  return createBuilderProgrammingRuntimeRunContract({
    runtime_descriptor: runtimeDescriptor(),
    admission: {
      project_id: `builder-project:${UUID}`,
      conversation_id: `builder-conversation:${UUID}`,
      turn_id: `builder-turn:${UUID}`,
      task_id: `builder-task:${UUID}`,
      run_id: `builder-run:${UUID}`,
      mode,
      workspace_ref: {
        ref_version: 'builder-programming-workspace-ref.v1',
        workspace_id: `builder-programming-workspace:${'b'.repeat(64)}`,
        source_tree_digest: tree.source_tree_digest,
        writable: mode === 'build',
      },
      provider_config_digest: DIGEST,
      allowed_tools: allowedTools,
      limits: {
        max_steps: 16,
        max_duration_ms: 300_000,
        max_model_tokens: 32_768,
        max_tool_output_bytes: overrides.max_tool_output_bytes ?? 256 * 1_024,
      },
      admitted_at_ms: 100,
    },
    input: {
      message_id: `builder-message:${UUID}`,
      text: 'Update the timer and run its checks.',
    },
  });
}

function workspaceTools(tree = sourceTree(), overrides = {}) {
  return createBuilderProgrammingWorkspaceTools({
    run_contract: runContract(tree, overrides),
    source_tree: tree,
  });
}

function hasCode(code) {
  return (error) => error instanceof BuilderProgrammingWorkspaceToolsError
    && error.code === code;
}

test('reads, version-checks, edits, and snapshots the working source tree', async () => {
  const tools = workspaceTools();
  const before = await tools.read({ resource_id: 'project:/src/timer.js' });

  assert.equal(before.status, 'ready');
  assert.equal(before.content, 'export const seconds = 30;\n');
  assert.match(before.observed_version, /^sha256:[0-9a-f]{64}$/u);

  const edited = await tools.edit({
    resource_id: 'project:/src/timer.js',
    observed_version: before.observed_version,
    content: 'export const seconds = 60;\nexport const running = false;\n',
  });
  assert.equal(edited.status, 'changed');
  assert.equal(edited.added_lines, 2);
  assert.equal(edited.deleted_lines, 1);
  assert.notEqual(edited.observed_version, before.observed_version);

  const after = await tools.read({ resource_id: 'project:/src/timer.js' });
  assert.equal(after.content, 'export const seconds = 60;\nexport const running = false;\n');
  assert.equal(after.observed_version, edited.observed_version);

  const snapshot = await tools.snapshot();
  assert.equal(snapshot.source_tree_digest, edited.source_tree_digest);
  assert.ok(Object.isFrozen(snapshot));
  assert.ok(Object.isFrozen(snapshot.files));
});

test('serializes same-file edits and rejects the stale concurrent mutation', async () => {
  const tools = workspaceTools();
  const before = await tools.read({ resource_id: 'project:/src/timer.js' });
  const results = await Promise.allSettled([
    tools.edit({
      resource_id: 'project:/src/timer.js',
      observed_version: before.observed_version,
      content: 'export const seconds = 45;\n',
    }),
    tools.edit({
      resource_id: 'project:/src/timer.js',
      observed_version: before.observed_version,
      content: 'export const seconds = 90;\n',
    }),
  ]);

  assert.equal(results[0].status, 'fulfilled');
  assert.equal(results[1].status, 'rejected');
  assert.ok(hasCode('builder_programming_workspace_stale_file')(results[1].reason));
  assert.equal(results[1].reason.retryable, true);
  assert.equal(
    (await tools.read({ resource_id: 'project:/src/timer.js' })).content,
    'export const seconds = 45;\n',
  );
});

test('closing a run rejects queued mutations and every later tool request', async () => {
  const tree = sourceTree();
  const tools = workspaceTools(tree);
  const before = await tools.read({ resource_id: 'project:/src/timer.js' });
  const queuedEdit = tools.edit({
    resource_id: 'project:/src/timer.js',
    observed_version: before.observed_version,
    content: 'export const seconds = 90;\n',
  });
  const queuedWrite = tools.write({
    resource_id: 'project:/src/late.js',
    expected_absent: true,
    content: 'export const late = true;\n',
  });

  const closedSnapshot = await tools.close();
  const settlements = await Promise.allSettled([queuedEdit, queuedWrite]);

  assert.equal(settlements[0].status, 'rejected');
  assert.equal(settlements[1].status, 'rejected');
  assert.ok(hasCode('builder_programming_workspace_closed')(settlements[0].reason));
  assert.ok(hasCode('builder_programming_workspace_closed')(settlements[1].reason));
  assert.equal(closedSnapshot.source_tree_digest, tree.source_tree_digest);
  assert.deepEqual(closedSnapshot.files, tree.files);

  await assert.rejects(
    tools.read({ resource_id: 'project:/src/timer.js' }),
    hasCode('builder_programming_workspace_closed'),
  );
  await assert.rejects(
    tools.search({ query: 'timer', max_results: 10 }),
    hasCode('builder_programming_workspace_closed'),
  );
  assert.equal((await tools.close()).source_tree_digest, tree.source_tree_digest);
});

test('creates only absent files and exposes the new version through read', async () => {
  const tools = workspaceTools();
  const created = await tools.write({
    resource_id: 'project:/src/check.js',
    expected_absent: true,
    content: 'export function check() { return true; }\n',
  });

  assert.equal(created.status, 'created');
  assert.equal(created.added_lines, 1);
  assert.equal(
    (await tools.read({ resource_id: 'project:/src/check.js' })).observed_version,
    created.observed_version,
  );
  await assert.rejects(
    tools.write({
      resource_id: 'project:/src/check.js',
      expected_absent: true,
      content: 'export const duplicate = true;\n',
    }),
    hasCode('builder_programming_workspace_file_exists'),
  );
});

test('rejects protected mutation paths before they can poison the final candidate', async () => {
  const tools = workspaceTools();

  for (const resourceId of [
    'project:/images/placeholder.png',
    'project:/.env',
    'project:/dist/app.js',
  ]) {
    await assert.rejects(
      tools.write({
        resource_id: resourceId,
        expected_absent: true,
        content: '<svg xmlns="http://www.w3.org/2000/svg"></svg>\n',
      }),
      (error) => hasCode('builder_programming_workspace_path_denied')(error)
        && error.retryable === true,
    );
  }

  const snapshot = await tools.snapshot();
  assert.equal(snapshot.files.length, 2);
});

test('searches paths and content with deterministic result and output limits', async () => {
  const tree = sourceTree([
    { path: 'src/timer.js', content: 'export const timer = true;\nconst timerLabel = "Timer";\n' },
    { path: 'README.md', content: '# Timer\n' },
  ]);
  const tools = workspaceTools(tree);
  const result = await tools.search({ query: 'timer', max_results: 2 });

  assert.equal(result.status, 'completed');
  assert.equal(result.matches.length, 2);
  assert.equal(result.truncated, true);
  assert.equal(result.total_matches, 4);
  assert.deepEqual(result.matches[0], {
    resource_id: 'project:/README.md',
    line: 1,
    column: 3,
    preview: '# Timer',
  });
  assert.equal(result.matches[1].resource_id, 'project:/src/timer.js');
  assert.equal(result.matches[1].line, 0);

  const smallLimitTools = workspaceTools(
    sourceTree([{ path: 'large.txt', content: 'x'.repeat(2_048) }]),
    { max_tool_output_bytes: 1_024 },
  );
  const read = await smallLimitTools.read({ resource_id: 'project:/large.txt' });
  assert.equal(read.status, 'too_large');
  assert.equal(read.content, null);
  assert.equal(read.content_bytes, 2_048);
});

test('refreshes the per-run search index after edit and write tools update the working tree', async () => {
  const tools = workspaceTools();
  const before = await tools.search({ query: 'polished', max_results: 10 });
  assert.equal(before.total_matches, 0);

  const read = await tools.read({ resource_id: 'project:/src/timer.js' });
  await tools.edit({
    resource_id: 'project:/src/timer.js',
    observed_version: read.observed_version,
    content: 'export const label = "Polished timer";\n',
  });
  await tools.write({
    resource_id: 'project:/src/polished-view.js',
    expected_absent: true,
    content: 'export const view = "ready";\n',
  });

  const after = await tools.search({ query: 'polished', max_results: 10 });
  assert.equal(after.total_matches, 2);
  assert.deepEqual(after.matches.map((match) => [match.resource_id, match.line]), [
    ['project:/src/polished-view.js', 0],
    ['project:/src/timer.js', 1],
  ]);
});

test('rejects path escapes, unsafe contents, missing files, and forged source authority', async () => {
  const tree = sourceTree();
  const tools = workspaceTools(tree);
  await assert.rejects(
    tools.read({ resource_id: 'project:/../outside.txt' }),
    hasCode('builder_programming_workspace_tool_invalid'),
  );
  await assert.rejects(
    tools.edit({
      resource_id: 'project:/missing.js',
      observed_version: DIGEST,
      content: 'export const missing = true;\n',
    }),
    hasCode('builder_programming_workspace_file_missing'),
  );

  const before = await tools.read({ resource_id: 'project:/src/timer.js' });
  await assert.rejects(
    tools.edit({
      resource_id: 'project:/src/timer.js',
      observed_version: before.observed_version,
      content: '-----BEGIN PRIVATE KEY-----\nnot-a-real-key\n',
    }),
    hasCode('builder_programming_workspace_tool_invalid'),
  );

  const otherTree = sourceTree([{ path: 'other.js', content: 'export {};\n' }]);
  assert.throws(
    () => createBuilderProgrammingWorkspaceTools({
      run_contract: runContract(tree),
      source_tree: otherTree,
    }),
    hasCode('builder_programming_workspace_tool_invalid'),
  );
});

test('enforces the admitted mode and exact tool allowlist', async () => {
  const tree = sourceTree();
  const tools = workspaceTools(tree, { allowed_tools: ['read', 'search'] });
  const before = await tools.read({ resource_id: 'project:/src/timer.js' });
  await assert.rejects(
    tools.edit({
      resource_id: 'project:/src/timer.js',
      observed_version: before.observed_version,
      content: 'export const seconds = 60;\n',
    }),
    hasCode('builder_programming_workspace_tool_not_allowed'),
  );

  const askContract = runContract(tree, {
    mode: 'ask',
    allowed_tools: ['read', 'search'],
  });
  assert.throws(
    () => createBuilderProgrammingWorkspaceTools({
      run_contract: askContract,
      source_tree: tree,
    }),
    hasCode('builder_programming_workspace_tool_invalid'),
  );
});

test('workspace tools keep filesystem, process, renderer, and provider authority outside the module', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-programming-workspace-tools.cjs'),
    'utf8',
  );

  assert.doesNotMatch(source, /\b(?:fetch|ipcMain|ipcRenderer|contextBridge|BrowserWindow)\b/u);
  assert.doesNotMatch(source, /\b(?:child_process|spawn|execFile|DatabaseSync|node:sqlite)\b/u);
  assert.doesNotMatch(source, /\b(?:readFile|writeFile|absolute_path|workspace_path)\b/u);
  assert.doesNotMatch(source, /api[_-]?key|Bearer|credential_value|secret_store/u);
});
