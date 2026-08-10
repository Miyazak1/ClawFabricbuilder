'use strict';

const fs = require('node:fs');
const nodeCrypto = require('node:crypto');
const path = require('node:path');

const promiseSpawn = require('@npmcli/promise-spawn');
const {
  PACKAGED_NPM_SCRIPT_RUNTIME_VERSION,
} = require('./builder-packaged-check-runtime-contract.cjs');

const BUILDER_PACKAGED_CHECK_SCRIPT_WORKER_VERSION = 'builder-packaged-check-script-worker.v1';
const COMMAND_KINDS = Object.freeze(['lint', 'typecheck', 'test', 'build']);
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const MAX_PACKAGE_JSON_BYTES = 1024 * 1024;

class BuilderPackagedCheckScriptWorkerError extends Error {
  constructor() {
    super('The approved project check could not be started.');
    this.name = 'BuilderPackagedCheckScriptWorkerError';
    this.code = 'builder_packaged_check_script_invalid';
    this.retryable = false;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() { throw new BuilderPackagedCheckScriptWorkerError(); }

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function canonicalJson(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number' && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map(
      (key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`,
    ).join(',')}}`;
  }
  fail();
}

function scriptValue(scripts, name, required) {
  const descriptor = Object.getOwnPropertyDescriptor(scripts, name);
  if (descriptor === undefined) return required ? fail() : null;
  if (
    descriptor.enumerable !== true
    || !Object.hasOwn(descriptor, 'value')
    || typeof descriptor.value !== 'string'
    || descriptor.value.trim().length === 0
    || descriptor.value.length > 512
    || descriptor.value.includes('\0')
  ) fail();
  return descriptor.value;
}

function readPackageJson(workspacePath) {
  const packagePath = path.join(workspacePath, 'package.json');
  let stats;
  let source;
  try {
    stats = fs.lstatSync(packagePath);
    if (!stats.isFile() || stats.isSymbolicLink() || stats.size < 2 || stats.size > MAX_PACKAGE_JSON_BYTES) {
      fail();
    }
    source = fs.readFileSync(packagePath, 'utf8');
  } catch (error) {
    if (error instanceof BuilderPackagedCheckScriptWorkerError) throw error;
    fail();
  }
  try {
    const parsed = JSON.parse(source);
    if (!isPlainObject(parsed)) fail();
    return parsed;
  } catch (error) {
    if (error instanceof BuilderPackagedCheckScriptWorkerError) throw error;
    fail();
  }
}

function verifyBoundScript(rawInput) {
  if (!isPlainObject(rawInput) || Object.keys(rawInput).length !== 3) fail();
  const { workspace_path: workspacePath, command_kind: commandKind, script_digest: scriptDigest } = rawInput;
  if (
    typeof workspacePath !== 'string'
    || !path.isAbsolute(workspacePath)
    || path.normalize(workspacePath) !== workspacePath
    || !COMMAND_KINDS.includes(commandKind)
    || typeof scriptDigest !== 'string'
    || !DIGEST_PATTERN.test(scriptDigest)
  ) fail();
  const pkg = readPackageJson(workspacePath);
  if (!isPlainObject(pkg.scripts)) fail();
  const lifecycleScripts = {
    pre: scriptValue(pkg.scripts, `pre${commandKind}`, false),
    main: scriptValue(pkg.scripts, commandKind, true),
    post: scriptValue(pkg.scripts, `post${commandKind}`, false),
  };
  const actualDigest = `sha256:${nodeCrypto.createHash('sha256').update(canonicalJson({
    script_name: commandKind,
    lifecycle_scripts: lifecycleScripts,
  }), 'utf8').digest('hex')}`;
  if (actualDigest !== scriptDigest) fail();
  return Object.freeze({
    event: commandKind,
    script: lifecycleScripts.main,
    package_json_path: path.join(workspacePath, 'package.json'),
  });
}

function scriptEnvironment(workspacePath, verified) {
  const env = {};
  for (const key of [
    'CI',
    'ComSpec',
    'ELECTRON_RUN_AS_NODE',
    'FORCE_COLOR',
    'HOME',
    'NO_COLOR',
    'NPM_CONFIG_UPDATE_NOTIFIER',
    'PATH',
    'SystemRoot',
    'TEMP',
    'TMP',
    'USERPROFILE',
    'npm_config_cache',
  ]) {
    if (typeof process.env[key] === 'string') env[key] = process.env[key];
  }
  const currentPath = env.PATH ?? '';
  env.PATH = `${path.join(workspacePath, 'node_modules', '.bin')}${path.delimiter}${currentPath}`;
  env.npm_lifecycle_event = verified.event;
  env.npm_lifecycle_script = verified.script;
  env.npm_package_json = verified.package_json_path;
  return env;
}

async function executeBoundScript(rawInput) {
  const verified = verifyBoundScript(rawInput);
  const shell = process.platform === 'win32'
    ? process.env.ComSpec
    : '/bin/sh';
  if (typeof shell !== 'string' || shell.length === 0) fail();
  return promiseSpawn(verified.script, [], {
    cwd: rawInput.workspace_path,
    env: scriptEnvironment(rawInput.workspace_path, verified),
    shell,
    stdio: ['ignore', 'inherit', 'inherit'],
    stdioString: false,
    windowsHide: true,
  });
}

async function main(argv = process.argv.slice(2)) {
  if (
    !Array.isArray(argv)
    || argv.length !== 3
    || argv[0] !== 'run-script'
  ) fail();
  const runtimePackage = require('@npmcli/promise-spawn/package.json');
  if (runtimePackage.version !== PACKAGED_NPM_SCRIPT_RUNTIME_VERSION) fail();
  await executeBoundScript({
    workspace_path: path.resolve(process.cwd()),
    command_kind: argv[1],
    script_digest: argv[2],
  });
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof BuilderPackagedCheckScriptWorkerError
      ? error.message
      : 'The approved project check failed.'}\n`);
    process.exitCode = 1;
  });
}

module.exports = Object.freeze({
  BUILDER_PACKAGED_CHECK_SCRIPT_WORKER_VERSION,
  PACKAGED_NPM_SCRIPT_RUNTIME_VERSION,
  BuilderPackagedCheckScriptWorkerError,
  executeBoundScript,
  verifyBoundScript,
});
