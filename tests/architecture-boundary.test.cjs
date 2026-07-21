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
    return /\.(?:cjs|js|ts|tsx)$/u.test(entry.name) ? [target] : [];
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
