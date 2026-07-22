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
  assert.match(preload, /projectRevisions/u);
  assert.match(preload, /projectCatalog/u);
  assert.match(preload, /providerSettings/u);
  assert.match(preload, /windowControls/u);
  assert.doesNotMatch(preload, /secret|safeStorage|credential|encrypted|binding|Authorization|Bearer/iu);
  assert.equal((preload.match(/ipcRenderer\.invoke/g) || []).length, 13);
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

test('package identity and dependencies remain Builder-only', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(packageJson.name, 'clawfabric-builder');
  assert.equal(packageJson.build.appId, 'com.clawfabric.builder');
  assert.equal(packageJson.build.productName, 'ClawFabric Builder');
  assert.equal(packageJson.build.electronDist, 'node_modules/electron/dist');
  assert.equal(path.isAbsolute(packageJson.build.electronDist), false);
  assert.equal(packageJson.build.electronDist.includes('..'), false);
  assert.equal(packageJson.dependencies?.electron, undefined);
  assert.equal(typeof packageJson.devDependencies?.electron, 'string');
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
    for (const targetFile of entry.target_files || []) {
      assert.equal(fs.statSync(path.join(root, targetFile)).isFile(), true);
    }
  }
});
