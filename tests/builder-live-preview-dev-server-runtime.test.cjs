'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  createBuilderCheckRunProcessAdapter,
} = require('../electron/builder-check-run-process-adapter.cjs');
const {
  createBuilderLivePreviewDevServerAdmission,
  createBuilderLivePreviewDevServerApproval,
} = require('../electron/builder-live-preview-dev-server-admission.cjs');
const {
  createBuilderLivePreviewDevServerRuntime,
  discoverBuilderLivePreviewDevServerProfile,
} = require('../electron/builder-live-preview-dev-server-runtime.cjs');
const {
  createBuilderLivePreviewSourceAdmission,
} = require('../electron/builder-live-preview-source-admission.cjs');
const {
  BUILDER_LIVE_PREVIEW_SOURCE_RESOLVER_RESULT_VERSION,
  BUILDER_LIVE_PREVIEW_SOURCE_RESOLVER_VERSION,
  BUILDER_LIVE_PREVIEW_SOURCE_SNAPSHOT_VERSION,
} = require('../electron/builder-live-preview-source-resolver.cjs');
const {
  createBuilderLivePreviewAdmission,
} = require('../electron/builder-live-preview-run.cjs');
const {
  readBuilderLocalWorkspaceSourceTree,
} = require('../electron/builder-local-workspace-source-tree.cjs');

const PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174000';
const CONVERSATION_ID =
  'builder-conversation:123e4567-e89b-42d3-a456-426614174000:223e4567-e89b-42d3-a456-426614174000';
const TASK_ID = 'builder-task:323e4567-e89b-42d3-a456-426614174000';
const RUN_ID = 'builder-run:423e4567-e89b-42d3-a456-426614174000';
const CHECKPOINT_ID = `builder-draft-checkpoint:${'1'.repeat(64)}`;
const CANDIDATE_ID = `builder-code-change-candidate:${'2'.repeat(64)}`;
const CANDIDATE_DIGEST = `sha256:${'3'.repeat(64)}`;

function authority() {
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

function sourceAdmission(sourceTree, now) {
  return createBuilderLivePreviewSourceAdmission({
    source_resolver_result: {
      result_version: BUILDER_LIVE_PREVIEW_SOURCE_RESOLVER_RESULT_VERSION,
      resolver_version: BUILDER_LIVE_PREVIEW_SOURCE_RESOLVER_VERSION,
      operation: 'current_draft_preview_source_resolved',
      source_kind: 'current_draft',
      status: 'ready',
      unavailable_reason: null,
      preview_source_snapshot: {
        snapshot_version: BUILDER_LIVE_PREVIEW_SOURCE_SNAPSHOT_VERSION,
        source_kind: 'current_draft',
        project_id: PROJECT_ID,
        conversation_id: CONVERSATION_ID,
        source_tree: sourceTree,
        source_tree_digest: sourceTree.source_tree_digest,
        source_ref: {
          source_ref_kind: 'current_draft_checkpoint_candidate',
          project_id: PROJECT_ID,
          conversation_id: CONVERSATION_ID,
          checkpoint_id: CHECKPOINT_ID,
          checkpoint_sequence: 1,
          candidate_id: CANDIDATE_ID,
          candidate_digest: CANDIDATE_DIGEST,
          resulting_tree_digest: sourceTree.source_tree_digest,
          commit_oid: '4'.repeat(40),
          tree_oid: '5'.repeat(40),
        },
        admission: {
          preview_source_admission: 'main_owned_verified_preview_source',
          source_tree_digest: sourceTree.source_tree_digest,
        },
        authority: authority(),
      },
    },
    selected_entry_path: 'index.html',
    preview_kind: 'live_static_web',
    admitted_at_ms: now,
    expires_at_ms: now + 60_000,
  });
}

function admissions(workspaceRootPath) {
  const now = Date.now();
  const sourceTree = readBuilderLocalWorkspaceSourceTree(workspaceRootPath);
  const source = sourceAdmission(sourceTree, now);
  const profile = discoverBuilderLivePreviewDevServerProfile({
    source_admission: source,
    source_tree: sourceTree,
    discovered_at_ms: now + 10,
  });
  assert.notEqual(profile, null);
  const approval = createBuilderLivePreviewDevServerApproval({
    source_admission: source,
    command_profile: profile,
    approved_at_ms: now + 20,
    expires_at_ms: now + 300_000,
  });
  const dev = createBuilderLivePreviewDevServerAdmission({
    source_admission: source,
    command_profile: profile,
    approval,
    admitted_at_ms: now + 30,
    expires_at_ms: now + 240_000,
  });
  const runtime = createBuilderLivePreviewAdmission({
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    task_id: TASK_ID,
    run_id: RUN_ID,
    draft_checkpoint_id: CHECKPOINT_ID,
    revision_receipt_digest: null,
    source_tree_digest: sourceTree.source_tree_digest,
    selected_entry_path: 'index.html',
    preview_kind: 'live_static_web',
    admitted_at_ms: now + 30,
    expires_at_ms: now + 240_000,
  });
  return { sourceTree, source, dev, runtime };
}

function processAdapter() {
  return createBuilderCheckRunProcessAdapter({
    spawn_process: spawn,
    platform: process.platform,
    windows_root: process.platform === 'win32' ? process.env.SystemRoot : null,
  });
}

function runtime(onOutput = () => undefined) {
  return createBuilderLivePreviewDevServerRuntime({
    process_adapter: processAdapter(),
    process_exec_path: path.resolve(process.execPath),
    worker_path: path.resolve(__dirname, '..', 'electron', 'builder-packaged-check-script-worker.cjs'),
    now_ms: () => Date.now(),
    on_output: onOutput,
  });
}

function writeProject(workspaceRootPath, devScript = 'node server.cjs') {
  fs.writeFileSync(path.join(workspaceRootPath, 'package.json'), `${JSON.stringify({
    private: true,
    scripts: { dev: devScript },
  })}\n`);
  fs.writeFileSync(path.join(workspaceRootPath, 'index.html'), '<main>Runtime preview</main>\n');
  fs.writeFileSync(path.join(workspaceRootPath, 'server.cjs'), [
    "const http = require('node:http');",
    "const value = (name) => process.argv[process.argv.indexOf(name) + 1];",
    "const host = value('--host');",
    "const port = Number(value('--port'));",
    "const server = http.createServer((_request, response) => {",
    "  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });",
    "  response.end('<main>Runtime preview is ready</main>');",
    '});',
    "server.listen(port, host, () => process.stdout.write(`ready ${host}:${port}\\n`));",
    "process.on('SIGTERM', () => server.close(() => process.exit(0)));",
  ].join('\n'));
}

test('does not require a dev server when package scripts omit dev', async (t) => {
  const workspaceRootPath = path.resolve(fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), 'builder-dev-preview-static-')),
  ));
  t.after(() => {
    fs.rmSync(workspaceRootPath, { recursive: true, force: true });
  });
  fs.writeFileSync(path.join(workspaceRootPath, 'package.json'), `${JSON.stringify({
    private: true,
    scripts: { test: 'node --check main.js' },
  })}\n`);
  fs.writeFileSync(path.join(workspaceRootPath, 'index.html'), '<main>Static preview</main>\n');
  fs.writeFileSync(path.join(workspaceRootPath, 'main.js'), 'document.body.dataset.ready = "true";\n');
  const now = Date.now();
  const sourceTree = readBuilderLocalWorkspaceSourceTree(workspaceRootPath);
  assert.equal(discoverBuilderLivePreviewDevServerProfile({
    source_admission: sourceAdmission(sourceTree, now),
    source_tree: sourceTree,
    discovered_at_ms: now + 10,
  }), null);
});

test('starts an admitted dev server on a runtime-owned loopback port and stops its process tree', async (t) => {
  const workspaceRootPath = path.resolve(fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), 'builder-dev-preview-')),
  ));
  const output = [];
  const selectedRuntime = runtime((event) => output.push(event));
  t.after(async () => {
    await selectedRuntime.shutdown();
    fs.rmSync(workspaceRootPath, { recursive: true, force: true });
  });
  writeProject(workspaceRootPath);
  const selected = admissions(workspaceRootPath);

  let server;
  try {
    server = await selectedRuntime.start({
      source_admission: selected.source,
      source_tree: selected.sourceTree,
      runtime_admission: selected.runtime,
      dev_admission: selected.dev,
      workspace_root_path: workspaceRootPath,
    });
  } catch (error) {
    assert.fail(`${error.code}: ${JSON.stringify(output)}`);
  }

  assert.match(server.entry_url, /^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}\/$/u);
  assert.equal(new URL(server.entry_url).hostname, '127.0.0.1');
  assert.match(await (await fetch(server.entry_url)).text(), /Runtime preview is ready/u);
  assert.equal(output.some((event) => event.stream === 'stdout' && event.text.includes('ready')), true);

  const restarted = await selectedRuntime.start({
    source_admission: selected.source,
    source_tree: selected.sourceTree,
    runtime_admission: selected.runtime,
    dev_admission: selected.dev,
    workspace_root_path: workspaceRootPath,
  });
  assert.deepEqual(await server.stop(), { stopped: false, reason: 'already_stopped' });
  assert.match(await (await fetch(restarted.entry_url)).text(), /Runtime preview is ready/u);
  assert.deepEqual(await restarted.stop(), { stopped: true, reason: 'process_tree_closed' });
  await assert.rejects(fetch(restarted.entry_url));
  assert.deepEqual(await server.stop(), { stopped: false, reason: 'already_stopped' });
});

test('rejects source drift and a discovered public bind before process start', async (t) => {
  const workspaceRootPath = path.resolve(fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), 'builder-dev-preview-drift-')),
  ));
  const selectedRuntime = runtime();
  t.after(async () => {
    await selectedRuntime.shutdown();
    fs.rmSync(workspaceRootPath, { recursive: true, force: true });
  });
  writeProject(workspaceRootPath);
  const selected = admissions(workspaceRootPath);
  fs.appendFileSync(path.join(workspaceRootPath, 'index.html'), '<!-- drift -->\n');

  await assert.rejects(selectedRuntime.start({
    source_admission: selected.source,
    source_tree: selected.sourceTree,
    runtime_admission: selected.runtime,
    dev_admission: selected.dev,
    workspace_root_path: workspaceRootPath,
  }), { code: 'builder_live_preview_dev_server_source_drift' });

  writeProject(workspaceRootPath, 'vite --host 0.0.0.0');
  const publicTree = readBuilderLocalWorkspaceSourceTree(workspaceRootPath);
  const publicSource = sourceAdmission(publicTree, Date.now());
  assert.throws(() => discoverBuilderLivePreviewDevServerProfile({
    source_admission: publicSource,
    source_tree: publicTree,
    discovered_at_ms: Date.now(),
  }), { code: 'builder_live_preview_dev_server_public_bind_forbidden' });
});
