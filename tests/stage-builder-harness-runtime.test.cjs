'use strict';

const assert = require('node:assert/strict');
const nodeCrypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const asar = require('@electron/asar');

const {
  ENTRY_RELATIVE_PATH,
  stageBuilderHarnessRuntime,
} = require('../scripts/stage-builder-harness-runtime.cjs');

const COMMIT = '0123456789abcdef0123456789abcdef01234567';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'builder-harness-stage-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sourceRoot = path.join(root, 'source');
  const runtimeRoot = path.join(root, 'runtime');
  const outputRoot = path.join(root, 'output');
  fs.mkdirSync(path.join(runtimeRoot, path.dirname(ENTRY_RELATIVE_PATH)), { recursive: true });
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, 'package.json'), JSON.stringify({
    name: '@deepseek-ai/dsh-root', version: '0.1.0-rc.5',
  }));
  fs.writeFileSync(path.join(runtimeRoot, 'package.json'), JSON.stringify({
    name: 'dsh-jsonrpc-agent-pkg', version: '0.0.1',
  }));
  fs.writeFileSync(path.join(runtimeRoot, ENTRY_RELATIVE_PATH), 'export {};\n');
  return { sourceRoot, runtimeRoot, outputRoot };
}

test('stages a pinned link-free Harness closure as one verified ASAR resource', async (t) => {
  const value = fixture(t);
  const result = await stageBuilderHarnessRuntime({
    runtime_root: value.runtimeRoot,
    source_root: value.sourceRoot,
    output_root: value.outputRoot,
    allow_test_output: true,
    upstream_commit: COMMIT,
  });
  assert.equal(result.result_version, 'builder-harness-runtime-stage-result.v1');
  assert.equal(result.manifest.upstream_commit, COMMIT);
  assert.equal(result.manifest.file_count, 2);
  assert.equal(result.manifest.link_free, true);
  assert.equal(result.manifest.archive_sha256, `sha256:${nodeCrypto
    .createHash('sha256').update(fs.readFileSync(result.archive_path)).digest('hex')}`);
  const rawArchiveEntry = asar.listPackage(result.archive_path).find(
    (entry) => entry.replaceAll('\\', '/') === `/${ENTRY_RELATIVE_PATH}`,
  );
  assert.notEqual(rawArchiveEntry, undefined);
  assert.equal(
    asar.extractFile(result.archive_path, rawArchiveEntry.slice(1)).toString('utf8'),
    'export {};\n',
  );
});

test('rejects an unprepared closure before creating a release artifact', async (t) => {
  const value = fixture(t);
  fs.rmSync(path.join(value.runtimeRoot, ENTRY_RELATIVE_PATH));
  await assert.rejects(
    stageBuilderHarnessRuntime({
      runtime_root: value.runtimeRoot,
      source_root: value.sourceRoot,
      output_root: value.outputRoot,
      allow_test_output: true,
      upstream_commit: COMMIT,
    }),
    /packaged JSON-RPC entry is missing/u,
  );
  assert.equal(fs.existsSync(value.outputRoot), false);
});
