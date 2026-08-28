'use strict';

const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const SOURCE_ROOT_ENV = 'BUILDER_HARNESS_SOURCE_ROOT';
const NODE_CARRIER_RELATIVE_PATH = path.join(
  'python',
  'sdk-runtime',
  'src',
  'deepseek_harness_runtime',
  'runtime',
  'node',
);

function fail(message) {
  throw new Error(`prepare-builder-harness-runtime: ${message}`);
}

function safeSourceRoot(value) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > 1_024
    || value.includes('\0')
    || /[&|<>^%!\r\n]/u.test(value)
  ) fail(`invalid ${SOURCE_ROOT_ENV}`);
  const root = path.resolve(value);
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  } catch {
    fail('source root is not a readable Harness checkout');
  }
  if (manifest?.name !== '@deepseek-ai/dsh-root') {
    fail('source root is not a DeepSeek Harness checkout');
  }
  return root;
}

function readManifest(filePath) {
  let value;
  try { value = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch {
    fail(`could not read ${filePath}`);
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(`invalid manifest ${filePath}`);
  }
  return value;
}

function copyPackage(source, destination) {
  const nestedNodeModules = path.join(source, 'node_modules');
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(source, destination, {
    recursive: true,
    dereference: true,
    filter(candidate) {
      return candidate !== nestedNodeModules
        && !candidate.startsWith(`${nestedNodeModules}${path.sep}`);
    },
  });
}

function restoreDirectDependencies(sourceRoot, stagingRoot) {
  const manifest = readManifest(path.join(stagingRoot, 'package.json'));
  const dependencies = Object.keys(manifest.dependencies ?? {}).sort();
  const sourceNodeModules = path.join(sourceRoot, 'python', 'sdk-runtime', 'node_modules');
  const restored = [];
  for (const dependency of dependencies) {
    const destination = path.join(stagingRoot, 'node_modules', dependency);
    if (fs.existsSync(destination)) continue;
    const source = path.join(sourceNodeModules, dependency);
    if (!fs.existsSync(source)) fail(`deployed dependency is missing: ${dependency}`);
    copyPackage(fs.realpathSync(source), destination);
    restored.push(dependency);
  }
  const missing = dependencies.filter((dependency) => (
    !fs.existsSync(path.join(stagingRoot, 'node_modules', dependency))
  ));
  if (missing.length > 0) fail(`staged dependencies remain missing: ${missing.join(', ')}`);
  return Object.freeze(restored);
}

function findLink(root) {
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const candidate = path.join(current, entry.name);
      const info = fs.lstatSync(candidate);
      if (info.isSymbolicLink()) return candidate;
      if (info.isDirectory()) pending.push(candidate);
    }
  }
  return null;
}

function materializeLinks(stagingRoot) {
  const nodeModules = path.join(stagingRoot, 'node_modules');
  let count = 0;
  let link = findLink(nodeModules);
  while (link !== null) {
    const relative = path.relative(nodeModules, link).split(path.sep);
    const binIndex = relative.lastIndexOf('.bin');
    if (binIndex >= 0) {
      fs.rmSync(path.join(nodeModules, ...relative.slice(0, binIndex + 1)), {
        recursive: true,
        force: true,
      });
    } else {
      const source = fs.realpathSync(link);
      fs.rmSync(link, { recursive: true, force: true });
      copyPackage(source, link);
      count += 1;
    }
    link = findLink(nodeModules);
  }
  return count;
}

function verifyRuntimeClosure(stagingRoot) {
  const packagedBin = path.join(
    stagingRoot,
    'node_modules',
    '@deepseek-ai',
    'dsh-sdk-jsonrpc-demo',
    'lib',
    'packaged-bin.js',
  );
  if (!fs.statSync(packagedBin).isFile()) fail('packaged JSON-RPC entry is missing');
  if (findLink(path.join(stagingRoot, 'node_modules')) !== null) {
    fail('runtime closure still contains links');
  }
  return packagedBin;
}

function deployRuntime(sourceRoot, stagingRoot) {
  const args = [
    '--filter',
    'dsh-jsonrpc-agent-pkg',
    'deploy',
    '--legacy',
    '--prod',
    '--config.node-linker=hoisted',
    '--config.auto-install-peers=false',
    '--config.link-workspace-packages=true',
    stagingRoot,
  ];
  let command = 'pnpm';
  let commandArgs = args;
  if (process.platform === 'win32') {
    const systemRoot = process.env.SystemRoot;
    if (typeof systemRoot !== 'string' || !path.isAbsolute(systemRoot)) {
      fail('Windows system root is unavailable');
    }
    const powershell = path.join(
      systemRoot,
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    );
    if (!fs.statSync(powershell).isFile()) fail('Windows PowerShell is unavailable');
    const quote = (value) => `'${value.replaceAll("'", "''")}'`;
    command = powershell;
    commandArgs = [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `& 'pnpm.cmd' ${args.map(quote).join(' ')}`,
    ];
  }
  const result = childProcess.spawnSync(command, commandArgs, {
    cwd: sourceRoot,
    shell: false,
    stdio: 'inherit',
  });
  if (result.error || result.status !== 0) fail('pnpm deploy failed');
}

function prepareBuilderHarnessRuntime(rawSourceRoot, options = {}) {
  const sourceRoot = safeSourceRoot(rawSourceRoot);
  const stagingRoot = path.resolve(sourceRoot, NODE_CARRIER_RELATIVE_PATH);
  const relative = path.relative(sourceRoot, stagingRoot);
  if (
    relative !== NODE_CARRIER_RELATIVE_PATH
    || relative.startsWith('..')
    || path.isAbsolute(relative)
  ) fail('unsafe staging root');
  if (options.skip_deploy !== true) {
    fs.rmSync(stagingRoot, { recursive: true, force: true });
    deployRuntime(sourceRoot, stagingRoot);
  }
  const restored = restoreDirectDependencies(sourceRoot, stagingRoot);
  const materializedLinkCount = materializeLinks(stagingRoot);
  const packagedBin = verifyRuntimeClosure(stagingRoot);
  return Object.freeze({
    result_version: 'builder-harness-runtime-preparation.v1',
    source_root: sourceRoot,
    runtime_root: stagingRoot,
    packaged_bin: packagedBin,
    restored_dependency_count: restored.length,
    materialized_link_count: materializedLinkCount,
  });
}

if (require.main === module) {
  try {
    const result = prepareBuilderHarnessRuntime(process.env[SOURCE_ROOT_ENV]);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'Runtime preparation failed.'}\n`);
    process.exitCode = 1;
  }
}

module.exports = Object.freeze({
  NODE_CARRIER_RELATIVE_PATH,
  materializeLinks,
  prepareBuilderHarnessRuntime,
  restoreDirectDependencies,
  verifyRuntimeClosure,
});
