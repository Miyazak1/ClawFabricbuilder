'use strict';

const nodeCrypto = require('node:crypto');
const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const asar = require('@electron/asar');

const WORKSPACE_ROOT = path.resolve(__dirname, '..');
const DEFAULT_OUTPUT_ROOT = path.join(WORKSPACE_ROOT, '.release-runtime');
const ARCHIVE_NAME = 'harness-runtime.asar';
const MANIFEST_NAME = 'harness-runtime-manifest.json';
const ENTRY_RELATIVE_PATH = 'node_modules/@deepseek-ai/dsh-sdk-jsonrpc-demo/lib/packaged-bin.js';
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/u;

function fail(message) {
  throw new Error(`stage-builder-harness-runtime: ${message}`);
}

function absoluteDirectory(value, label) {
  if (
    typeof value !== 'string' || value.length === 0 || value.includes('\0')
    || !path.isAbsolute(value) || path.normalize(value) !== value
  ) fail(`${label} must be a normalized absolute directory.`);
  let info;
  try { info = fs.statSync(value); } catch { fail(`${label} is unavailable.`); }
  if (!info.isDirectory()) fail(`${label} is unavailable.`);
  return value;
}

function runtimeRootFromEnvironment() {
  const configured = process.env.BUILDER_HARNESS_RUNTIME_ROOT;
  if (typeof configured !== 'string' || configured.length === 0) {
    fail('set BUILDER_HARNESS_RUNTIME_ROOT to the prepared link-free runtime closure.');
  }
  return absoluteDirectory(path.normalize(configured), 'runtime root');
}

function sourceRootFromEnvironment() {
  const configured = process.env.BUILDER_HARNESS_SOURCE_ROOT;
  if (typeof configured !== 'string' || configured.length === 0) {
    fail('set BUILDER_HARNESS_SOURCE_ROOT to the pinned Harness checkout.');
  }
  return absoluteDirectory(path.normalize(configured), 'source root');
}

function packageVersion(root, expectedName) {
  let value;
  try { value = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')); } catch {
    fail('runtime or source package metadata is unreadable.');
  }
  if (value?.name !== expectedName || typeof value?.version !== 'string' || value.version.length === 0) {
    fail('runtime or source package identity is invalid.');
  }
  return value.version;
}

function upstreamCommit(sourceRoot) {
  let output;
  try {
    output = execFileSync('git', [
      '-c', `safe.directory=${sourceRoot}`,
      '-C', sourceRoot,
      'rev-parse', 'HEAD',
    ], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    fail('the pinned Harness commit could not be read.');
  }
  if (!COMMIT_PATTERN.test(output)) fail('the pinned Harness commit is invalid.');
  return output;
}

async function inspectRuntimeTree(runtimeRoot) {
  let fileCount = 0;
  let sourceBytes = 0;
  const queue = [runtimeRoot];
  while (queue.length > 0) {
    const directory = queue.pop();
    const entries = await fsPromises.readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));
    for (const entry of entries) {
      const candidate = path.join(directory, entry.name);
      const info = await fsPromises.lstat(candidate);
      if (info.isSymbolicLink()) fail('the runtime closure still contains a symbolic link or junction.');
      if (info.isDirectory()) {
        queue.push(candidate);
        continue;
      }
      if (!info.isFile()) fail('the runtime closure contains an unsupported filesystem entry.');
      fileCount += 1;
      sourceBytes += info.size;
    }
  }
  return Object.freeze({ file_count: fileCount, source_bytes: sourceBytes });
}

async function sha256File(filePath) {
  const hash = nodeCrypto.createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  return `sha256:${hash.digest('hex')}`;
}

async function existingStagedRuntime(outputRoot) {
  const archivePath = path.join(outputRoot, ARCHIVE_NAME);
  const manifestPath = path.join(outputRoot, MANIFEST_NAME);
  let manifest;
  try {
    manifest = JSON.parse(await fsPromises.readFile(manifestPath, 'utf8'));
  } catch {
    return null;
  }
  if (
    manifest?.manifest_version !== 'builder-harness-runtime-manifest.v1'
    || manifest.upstream_repository !== 'https://github.com/deepseek-ai/deepseek-harness'
    || !COMMIT_PATTERN.test(manifest.upstream_commit)
    || !DIGEST_PATTERN.test(manifest.archive_sha256)
    || manifest.entry_relative_path !== ENTRY_RELATIVE_PATH
    || manifest.link_free !== true
    || !Number.isSafeInteger(manifest.file_count) || manifest.file_count < 1
    || !Number.isSafeInteger(manifest.source_bytes) || manifest.source_bytes < 1
    || !Number.isSafeInteger(manifest.archive_bytes) || manifest.archive_bytes < 1
  ) return null;
  let archiveInfo;
  try { archiveInfo = await fsPromises.stat(archivePath); } catch { return null; }
  if (!archiveInfo.isFile() || archiveInfo.size !== manifest.archive_bytes) return null;
  if (await sha256File(archivePath) !== manifest.archive_sha256) return null;
  const hasEntry = asar.listPackage(archivePath).some(
    (entry) => entry.replaceAll('\\', '/') === `/${ENTRY_RELATIVE_PATH}`,
  );
  if (!hasEntry) return null;
  return Object.freeze({
    result_version: 'builder-harness-runtime-stage-result.v1',
    archive_path: archivePath,
    manifest_path: manifestPath,
    manifest: Object.freeze(manifest),
    reused: true,
  });
}

async function stageBuilderHarnessRuntime(options = {}) {
  const outputRoot = path.resolve(options.output_root ?? DEFAULT_OUTPUT_ROOT);
  if (outputRoot !== DEFAULT_OUTPUT_ROOT && options.allow_test_output !== true) {
    fail('output root is outside the Builder release-runtime directory.');
  }
  if (options.runtime_root === undefined && !process.env.BUILDER_HARNESS_RUNTIME_ROOT) {
    const staged = await existingStagedRuntime(outputRoot);
    if (staged !== null) return staged;
  }
  const runtimeRoot = absoluteDirectory(
    path.normalize(options.runtime_root ?? runtimeRootFromEnvironment()),
    'runtime root',
  );
  const sourceRoot = absoluteDirectory(
    path.normalize(options.source_root ?? sourceRootFromEnvironment()),
    'source root',
  );
  const entryPath = path.join(runtimeRoot, ENTRY_RELATIVE_PATH);
  if (!fs.statSync(entryPath, { throwIfNoEntry: false })?.isFile()) fail('the packaged JSON-RPC entry is missing.');
  const sourceVersion = packageVersion(sourceRoot, '@deepseek-ai/dsh-root');
  const runtimeVersion = packageVersion(runtimeRoot, 'dsh-jsonrpc-agent-pkg');
  const commit = options.upstream_commit ?? upstreamCommit(sourceRoot);
  if (!COMMIT_PATTERN.test(commit)) fail('the pinned Harness commit is invalid.');
  const tree = await inspectRuntimeTree(runtimeRoot);
  await fsPromises.mkdir(outputRoot, { recursive: true });
  const archivePath = path.join(outputRoot, ARCHIVE_NAME);
  const manifestPath = path.join(outputRoot, MANIFEST_NAME);
  const temporaryArchive = path.join(outputRoot, `${ARCHIVE_NAME}.${process.pid}.tmp`);
  await fsPromises.rm(temporaryArchive, { force: true });
  try {
    await asar.createPackage(runtimeRoot, temporaryArchive);
    const archiveInfo = await fsPromises.stat(temporaryArchive);
    const archiveDigest = await sha256File(temporaryArchive);
    if (!DIGEST_PATTERN.test(archiveDigest)) fail('the runtime archive digest is invalid.');
    await fsPromises.rm(archivePath, { force: true });
    await fsPromises.rename(temporaryArchive, archivePath);
    const manifest = Object.freeze({
      manifest_version: 'builder-harness-runtime-manifest.v1',
      upstream_repository: 'https://github.com/deepseek-ai/deepseek-harness',
      upstream_commit: commit,
      upstream_version: sourceVersion,
      runtime_package_version: runtimeVersion,
      entry_relative_path: ENTRY_RELATIVE_PATH,
      file_count: tree.file_count,
      source_bytes: tree.source_bytes,
      archive_bytes: archiveInfo.size,
      archive_sha256: archiveDigest,
      link_free: true,
    });
    await fsPromises.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    return Object.freeze({
      result_version: 'builder-harness-runtime-stage-result.v1',
      archive_path: archivePath,
      manifest_path: manifestPath,
      manifest,
    });
  } finally {
    await fsPromises.rm(temporaryArchive, { force: true });
  }
}

if (require.main === module) {
  stageBuilderHarnessRuntime().then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

module.exports = Object.freeze({
  ARCHIVE_NAME,
  ENTRY_RELATIVE_PATH,
  MANIFEST_NAME,
  stageBuilderHarnessRuntime,
});
