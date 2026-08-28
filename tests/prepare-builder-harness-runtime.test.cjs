'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  NODE_CARRIER_RELATIVE_PATH,
  prepareBuilderHarnessRuntime,
} = require('../scripts/prepare-builder-harness-runtime.cjs');

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

test('prepares a link-free Harness node carrier from an official source checkout', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'builder-harness-prepare-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sourceRoot = path.join(root, 'harness');
  const sourceNodeModules = path.join(sourceRoot, 'python', 'sdk-runtime', 'node_modules');
  const stagingRoot = path.join(sourceRoot, NODE_CARRIER_RELATIVE_PATH);
  const demoSource = path.join(sourceNodeModules, '@deepseek-ai', 'dsh-sdk-jsonrpc-demo');
  const supportSource = path.join(sourceNodeModules, '@deepseek-ai', 'dsh-support');
  const demoDestination = path.join(
    stagingRoot,
    'node_modules',
    '@deepseek-ai',
    'dsh-sdk-jsonrpc-demo',
  );

  writeJson(path.join(sourceRoot, 'package.json'), { name: '@deepseek-ai/dsh-root' });
  writeJson(path.join(stagingRoot, 'package.json'), {
    dependencies: {
      '@deepseek-ai/dsh-sdk-jsonrpc-demo': 'workspace:^',
      '@deepseek-ai/dsh-support': 'workspace:^',
    },
  });
  fs.mkdirSync(path.join(demoSource, 'lib'), { recursive: true });
  fs.writeFileSync(path.join(demoSource, 'lib', 'packaged-bin.js'), '// fixture\n');
  fs.mkdirSync(supportSource, { recursive: true });
  fs.writeFileSync(path.join(supportSource, 'index.js'), '// support\n');
  fs.mkdirSync(path.dirname(demoDestination), { recursive: true });
  fs.symlinkSync(demoSource, demoDestination, 'junction');

  const result = prepareBuilderHarnessRuntime(sourceRoot, { skip_deploy: true });

  assert.equal(result.runtime_root, stagingRoot);
  assert.equal(result.restored_dependency_count, 1);
  assert.equal(result.materialized_link_count, 1);
  assert.equal(fs.lstatSync(demoDestination).isSymbolicLink(), false);
  assert.equal(
    fs.readFileSync(path.join(demoDestination, 'lib', 'packaged-bin.js'), 'utf8'),
    '// fixture\n',
  );
  assert.equal(
    fs.readFileSync(
      path.join(stagingRoot, 'node_modules', '@deepseek-ai', 'dsh-support', 'index.js'),
      'utf8',
    ),
    '// support\n',
  );
});

test('rejects a directory that is not a Harness source checkout', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'builder-harness-prepare-invalid-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeJson(path.join(root, 'package.json'), { name: 'different-project' });
  assert.throws(
    () => prepareBuilderHarnessRuntime(root, { skip_deploy: true }),
    /not a DeepSeek Harness checkout/u,
  );
});
