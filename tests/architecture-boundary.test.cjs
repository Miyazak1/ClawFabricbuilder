'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const forbidden = /ChatCreatePage|chat_planner|CanvasPage|JobMeta|CurrentState|ResultRail|AppLayout|AuthProvider|localProviderExecutor|clawfabricDesktop|desktop:builder|ClawFabric v5|\.\.\/\.\.\/ClawFabric/iu;
const safeStorageAllowed = path.join(root, 'electron', 'builder-provider-secret-store.cjs');

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(target);
    return /\.(?:cjs|js|ts|tsx)$/u.test(entry.name)
      && !/\.test\.(?:cjs|js|ts|tsx)$/u.test(entry.name)
      ? [target]
      : [];
  });
}

test('standalone sources do not import legacy product authorities or the old repository', () => {
  const files = [
    ...sourceFiles(path.join(root, 'electron')),
    ...sourceFiles(path.join(root, 'src')),
  ];
  for (const file of files) {
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), forbidden, path.relative(root, file));
  }
});

test('retired JSON revision storage and renderer write IPC are absent', () => {
  for (const retired of [
    'builder-project-revision-record.cjs',
    'builder-project-revision-repository.cjs',
    'builder-project-revision-ipc-adapter.cjs',
    'builder-project-catalog-ipc-adapter.cjs',
    'builder-project-ipc-runtime.cjs',
    'builder-conversation-repository.cjs',
  ]) {
    assert.equal(fs.existsSync(path.join(root, 'electron', retired)), false, retired);
  }
  const preload = fs.readFileSync(path.join(root, 'electron', 'preload.cjs'), 'utf8');
  assert.doesNotMatch(preload, /projectRevisions|projectCatalog|expected_previous|\brevision:\s*/u);
  assert.match(preload, /saveDraft/u);
});

test('provider settings storage is main-only and safeStorage is isolated to the secret store', () => {
  const files = [
    ...sourceFiles(path.join(root, 'electron')),
    ...sourceFiles(path.join(root, 'src')),
  ];
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    if (file === safeStorageAllowed) {
      assert.match(source, /safeStorage/u);
    } else {
      assert.doesNotMatch(source, /safeStorage/u, path.relative(root, file));
    }
    assert.doesNotMatch(source, /generic.*(?:config|secret)|secure-provider|local-provider-executor/iu);
  }

  const preload = fs.readFileSync(path.join(root, 'electron', 'preload.cjs'), 'utf8');
  assert.match(preload, /projectWorkspace/u);
  assert.match(preload, /\bopen\b/u);
  assert.match(preload, /openLocation/u);
  assert.match(preload, /clawfabric-builder:project-workspace:open-location/u);
  assert.match(preload, /createLocalProject/u);
  assert.match(preload, /clawfabric-builder:project-workspace:create-local/u);
  assert.match(preload, /saveDraft/u);
  assert.match(preload, /loadCurrent/u);
  assert.match(preload, /loadRevision/u);
  assert.match(preload, /clawfabric-builder:project-workspace:load-revision/u);
  assert.match(preload, /listCurrent/u);
  assert.match(preload, /listWorkspaces/u);
  assert.match(preload, /clawfabric-builder:project-workspace:list-workspaces/u);
  assert.match(preload, /listHistory/u);
  assert.doesNotMatch(preload, /projectRevisions|projectCatalog/u);
  assert.match(preload, /providerSettings/u);
  assert.match(preload, /\bsubmit\b/u);
  assert.match(preload, /clawfabric-builder:code-generator:submit/u);
  assert.match(preload, /continueDraft/u);
  assert.match(preload, /clawfabric-builder:code-generator:continue-draft/u);
  assert.match(preload, /generateApprovedPlan/u);
  assert.match(preload, /clawfabric-builder:code-generator:generate-approved-plan/u);
  assert.match(preload, /proposePlan/u);
  assert.match(preload, /clawfabric-builder:code-generator:propose-plan/u);
  assert.match(preload, /preparePlanSourceReadApproval/u);
  assert.match(preload, /clawfabric-builder:code-generator:prepare-plan-source-read-approval/u);
  assert.match(preload, /approvePlanSourceRead/u);
  assert.match(preload, /clawfabric-builder:code-generator:approve-plan-source-read/u);
  assert.match(preload, /prepareCurrentProjectWriteApproval/u);
  assert.match(preload, /clawfabric-builder:code-generator:prepare-current-project-write-approval/u);
  assert.match(preload, /approveCurrentProjectWrite/u);
  assert.match(preload, /clawfabric-builder:code-generator:approve-current-project-write/u);
  assert.match(preload, /\bretry\b/u);
  assert.match(preload, /clawfabric-builder:code-generator:retry/u);
  assert.match(preload, /\banswer\b/u);
  assert.match(preload, /clawfabric-builder:code-generator:answer/u);
  assert.match(preload, /answerDraft/u);
  assert.match(preload, /clawfabric-builder:code-generator:answer-draft/u);
  assert.match(preload, /restoreDraft/u);
  assert.match(preload, /clawfabric-builder:code-generator:restore-draft/u);
  assert.match(preload, /restoreRevisionAsDraft/u);
  assert.match(preload, /clawfabric-builder:code-generator:restore-revision-as-draft/u);
  assert.match(preload, /rejectDraft/u);
  assert.match(preload, /clawfabric-builder:code-generator:reject-draft/u);
  assert.match(preload, /\bsteer\b/u);
  assert.match(preload, /clawfabric-builder:code-generator:steer/u);
  assert.match(preload, /queueFollowup/u);
  assert.match(preload, /clawfabric-builder:code-generator:queue-followup/u);
  assert.match(preload, /taskStream/u);
  assert.match(preload, /clawfabric-builder:task-stream:read/u);
  assert.match(preload, /clawfabric-builder:task-stream:changed/u);
  assert.match(preload, /subscribeChanged/u);
  assert.match(preload, /planReview/u);
  assert.match(preload, /clawfabric-builder:plan-review:review/u);
  assert.match(preload, /permissions/u);
  assert.match(preload, /clawfabric-builder:permissions:evaluate/u);
  assert.match(preload, /livePreview/u);
  assert.match(preload, /clawfabric-builder:live-preview:request-current-draft/u);
  assert.match(preload, /clawfabric-builder:live-preview:reload-current/u);
  assert.match(preload, /clawfabric-builder:live-preview:stop-current/u);
  assert.match(preload, /clawfabric-builder:live-preview:read-current-status/u);
  assert.match(preload, /windowControls/u);
  assert.doesNotMatch(preload, /secret|safeStorage|credential|encrypted|binding|Authorization|Bearer/iu);
  assert.equal((preload.match(/ipcRenderer\.invoke/g) || []).length, 45);
});

test('provider settings IPC runtime is wired only through Electron main and preload channels', () => {
  const runtime = fs.readFileSync(
    path.join(root, 'electron', 'builder-provider-settings-ipc-runtime.cjs'),
    'utf8',
  );
  assert.match(runtime, /createBuilderProviderSettingsIpcAdapter/u);
  assert.match(runtime, /createBuilderProviderConfigRepository/u);
  assert.doesNotMatch(
    runtime,
    /require\(['"]electron['"]\)|ipcRenderer|contextBridge|BrowserWindow|safeStorage|fetch\s*\(|local-provider-executor|chat_planner|ChatCreatePage|Canvas|JobMeta|generic.*(?:config|secret)/iu,
  );

  const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
  const preload = fs.readFileSync(path.join(root, 'electron', 'preload.cjs'), 'utf8');
  assert.match(main, /createBuilderProviderSettingsIpcRuntime/u);
  assert.doesNotMatch(main, /clawfabric-builder:provider-settings:|credential|safeStorage/iu);
  assert.match(preload, /providerSettings/u);
  assert.match(preload, /clawfabric-builder:provider-settings:read-current/u);
  assert.match(preload, /clawfabric-builder:provider-settings:replace-current/u);
  assert.match(preload, /clawfabric-builder:provider-settings:status/u);
  assert.doesNotMatch(preload, /credential|secret_ref|secret_binding|encrypted_secret_digest|safeStorage/iu);
});

test('conversation lifecycle authority stays main-only and cannot dispatch providers or mutate Git', () => {
  const lifecycle = fs.readFileSync(
    path.join(root, 'electron', 'builder-conversation-main-service.cjs'),
    'utf8',
  );
  const taskStream = fs.readFileSync(
    path.join(root, 'electron', 'builder-task-stream-projection.cjs'),
    'utf8',
  );
  const taskStreamAdapter = fs.readFileSync(
    path.join(root, 'electron', 'builder-task-stream-ipc-adapter.cjs'),
    'utf8',
  );
  const generationRuntime = fs.readFileSync(
    path.join(root, 'electron', 'builder-generation-ipc-runtime.cjs'),
    'utf8',
  );
  assert.match(lifecycle, /sqlite_conversation_event_chain/u);
  assert.match(lifecycle, /append_conversation_events/u);
  assert.match(lifecycle, /load_conversation/u);
  assert.match(lifecycle, /verify_candidate:\s*verifyCandidate/u);
  assert.match(lifecycle, /accept_candidate:\s*acceptCandidate/u);
  assert.match(lifecycle, /read_stream:\s*readStream/u);
  assert.match(lifecycle, /builder-git-receipt-contract\.cjs/u);
  assert.match(taskStream, /builder-task-stream-read-result\.v1/u);
  assert.match(taskStream, /MAX_PUBLIC_ITEMS = 128/u);
  assert.match(taskStream, /MAX_PUBLIC_BYTES = 4 \* 1_024 \* 1_024/u);
  assert.match(taskStream, /replayBuilderConversation/u);
  assert.match(generationRuntime, /createBuilderConversationMainService/u);
  assert.match(generationRuntime, /createBuilderTaskStreamIpcAdapter/u);
  assert.match(generationRuntime, /READ_TASK_STREAM_CHANNEL/u);
  assert.match(generationRuntime, /TASK_STREAM_CHANGED_CHANNEL/u);
  assert.match(generationRuntime, /GENERATION_STARTED_CHANNEL/u);
  assert.match(generationRuntime, /builder-generation-started\.v1/u);
  assert.match(taskStreamAdapter, /renderer_authority:\s*'project_id_only'/u);
  assert.match(taskStreamAdapter, /read_only:\s*true/u);
  assert.match(taskStreamAdapter, /change_notification:\s*'project_id_only'/u);
  assert.match(taskStreamAdapter, /active_renderer_required:\s*true/u);
  assert.match(taskStreamAdapter, /direct_electron_registration:\s*false/u);
  assert.match(taskStreamAdapter, /direct_preload_exposure:\s*false/u);
  assert.doesNotMatch(
    lifecycle,
    /require\(['"]electron['"]\)|ipcMain|ipcRenderer|contextBridge|BrowserWindow|safeStorage|builder-provider|builder-git-(?:command-runner|project-repository)|persist_candidate_commit|fetch\s*\(|https?:|local-provider-executor/iu,
  );
  assert.doesNotMatch(
    taskStream,
    /node:sqlite|node:fs|builder-product-metadata|builder-git|ipcMain|ipcRenderer|BrowserWindow|preload|fetch\s*\(|provider_(?:secret|config|envelope|dispatch|context_body)|credential|source_tree/iu,
  );
  assert.doesNotMatch(
    taskStreamAdapter,
    /require\(['"]electron['"]\)|ipcMain|ipcRenderer|contextBridge|BrowserWindow|safeStorage|builder-provider|builder-git-|node:sqlite|fetch\s*\(|https?:|saveDraft|generate|persist_candidate_commit|write_current|local-provider-executor/iu,
  );
});

test('package identity and dependencies remain Builder-only', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(packageJson.name, 'clawfabric-builder');
  assert.equal(packageJson.build.appId, 'com.clawfabric.builder');
  assert.equal(packageJson.build.productName, 'ClawFabric Builder');
  assert.equal(packageJson.build.electronDist, 'node_modules/electron/dist');
  assert.deepEqual(packageJson.build.asarUnpack, [
    'electron/builder-packaged-check-script-worker.cjs',
    'electron/builder-packaged-check-runtime-contract.cjs',
    'node_modules/@npmcli/promise-spawn/**/*',
    'node_modules/which/**/*',
    'node_modules/isexe/**/*',
    'node_modules/dugite/git/**/*',
    'node_modules/dugite/LICENSE',
    'node_modules/dugite/git/LICENSE.txt',
  ]);
  assert.equal(path.isAbsolute(packageJson.build.electronDist), false);
  assert.equal(packageJson.build.electronDist.includes('..'), false);
  assert.equal(packageJson.dependencies?.electron, undefined);
  assert.equal(packageJson.dependencies?.dugite, '3.2.2');
  assert.equal(typeof packageJson.devDependencies?.electron, 'string');
  assert.equal(packageJson.devDependencies?.dugite, undefined);
  const verifier = fs.readFileSync(path.join(root, 'scripts', 'verify-package.cjs'), 'utf8');
  assert.match(verifier, /entry === rootPath\.slice\(0, -1\) \|\| entry\.startsWith\(rootPath\)/u);
  assert.match(verifier, /allowedPackagedNodeModuleRoots/u);
  assert.doesNotMatch(verifier, /startsWith\('\/node_modules\/'\)\), false/u);
  for (const dependency of ['axios', '@xyflow/react', 'electron-updater', 'ajv']) {
    assert.equal(packageJson.dependencies?.[dependency], undefined);
    assert.equal(packageJson.devDependencies?.[dependency], undefined);
  }
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  for (const [packagePath, metadata] of Object.entries(lock.packages || {})) {
    assert.doesNotMatch(packagePath, /ClawFabric v5|\.\.\//iu);
    assert.notEqual(metadata && metadata.link, true);
  }
});

test('frontend extraction provenance is pinned without creating an old-repository dependency', () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, 'provenance', 'extraction-manifest.json'), 'utf8'),
  );
  assert.equal(manifest.manifest_version, 'clawfabric-builder-extraction.v1');
  assert.equal(manifest.source_commit, '87a948102e6f67aa628fe23944e65d2f5993ab69');
  assert.equal(manifest.target_repository, 'clawfabric-builder');
  assert.equal(manifest.extraction_policy, 'copied_then_independently_maintained');
  assert.deepEqual(manifest.documentation_migration.dependency_effect, {
    runtime: 'none',
    package: 'none',
    import: 'none',
    data: 'none',
  });
  assert.equal(manifest.documentation_migration.policy, 'rewritten_not_copied');
  assert.equal(manifest.documentation_migration.authority, 'target_repository_docs');
  assert.equal(manifest.documentation_migration.source_commit, manifest.source_commit);
  assert.deepEqual(
    manifest.documentation_migration.rewritten_sources.map((entry) => entry.source_path),
    [
      'docs/CLAWFABRIC_AGENTIC_WORKFLOW_ENGINEERING_PRODUCT_STRATEGY_2026_07_15.md',
      'docs/CLAWFABRIC_AGENTIC_WORKFLOW_ENGINEERING_REFACTOR_TRANSITION_ROADMAP_2026_07_15.md',
      'docs/CLAWFABRIC_AGENTIC_WORKFLOW_ENGINEERING_EXECUTION_INDEX_2026_07_15.md',
      'docs/AI_NATIVE_COLLABORATION_AGENT_COWORKER_AUTOMATION_POLICY_P3.md',
      'docs/AI_NATIVE_COLLABORATION_COMMUNITY_AND_DELIVERY_NETWORK_P3.md',
      'docs/AI_NATIVE_COLLABORATION_DOMAIN_MODEL_P3.md',
    ],
  );
  for (const migration of manifest.documentation_migration.rewritten_sources) {
    assert.equal(Array.isArray(migration.target_paths), true);
    assert.equal(migration.target_paths.length > 0, true);
    for (const targetPath of migration.target_paths) {
      assert.equal(fs.statSync(path.join(root, targetPath)).isFile(), true);
    }
  }
  assert.deepEqual(
    manifest.entries.map((entry) => [entry.group, entry.file_count]),
    [
      ['builder_frontend_core', 22],
      ['builder_react_hooks', 4],
      ['builder_renderer_ports', 6],
      ['builder_revision_repository', 4],
      ['builder_revision_catalog_ipc_adapters', 4],
    ],
  );
  for (const entry of manifest.entries) {
    assert.match(entry.source_inventory_sha256, /^[0-9a-f]{64}$/u);
    assert.match(entry.target_inventory_sha256_at_extraction, /^[0-9a-f]{64}$/u);
    const targetRoots = entry.target_roots || [entry.target_root];
    for (const targetRoot of targetRoots) {
      assert.equal(fs.statSync(path.join(root, targetRoot)).isDirectory(), true);
    }
    if (entry.current_status === 'retired_after_git_sqlite_cutover') {
      assert.equal(Array.isArray(entry.replacement_authorities), true);
      assert.equal(entry.replacement_authorities.length > 0, true);
      for (const replacement of entry.replacement_authorities) {
        assert.equal(fs.statSync(path.join(root, replacement)).isFile(), true);
      }
    } else {
      for (const targetFile of entry.target_files || []) {
        assert.equal(fs.statSync(path.join(root, targetFile)).isFile(), true);
      }
    }
  }
});
