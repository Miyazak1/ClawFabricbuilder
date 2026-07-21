'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const forbidden = /ChatCreatePage|chat_planner|CanvasPage|JobMeta|CurrentState|ResultRail|AppLayout|AuthProvider|localProviderExecutor|ClawFabric v5|\.\.\/\.\.\/ClawFabric/iu;

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

test('package identity and dependencies remain Builder-only', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(packageJson.name, 'clawfabric-builder');
  assert.equal(packageJson.build.appId, 'com.clawfabric.builder');
  assert.equal(packageJson.build.productName, 'ClawFabric Builder');
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
  assert.deepEqual(
    manifest.entries.map((entry) => [entry.group, entry.file_count]),
    [
      ['builder_frontend_core', 22],
      ['builder_react_hooks', 4],
      ['builder_renderer_ports', 6],
      ['builder_revision_repository', 4],
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
