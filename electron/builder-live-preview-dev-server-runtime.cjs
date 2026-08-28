'use strict';

const fs = require('node:fs');
const nodeCrypto = require('node:crypto');
const nodeHttp = require('node:http');
const nodeNet = require('node:net');
const path = require('node:path');
const { types: utilTypes } = require('node:util');

const {
  createBuilderLivePreviewDevServerCommandProfile,
  sanitizeBuilderLivePreviewDevServerAdmission,
} = require('./builder-live-preview-dev-server-admission.cjs');
const {
  sanitizeBuilderLivePreviewSourceAdmission,
} = require('./builder-live-preview-source-admission.cjs');
const {
  sanitizeBuilderLivePreviewAdmission,
} = require('./builder-live-preview-run.cjs');
const {
  BUILDER_LIVE_PREVIEW_STATIC_SERVER_VERSION,
} = require('./builder-live-preview-static-server.cjs');
const {
  readBuilderLocalWorkspaceSourceTree,
} = require('./builder-local-workspace-source-tree.cjs');
const {
  sanitizeBuilderProjectSourceTree,
} = require('./builder-project-source-tree.cjs');
const {
  BUILDER_CHECK_RUN_PROCESS_ADAPTER_VERSION,
} = require('./builder-check-run-process-adapter.cjs');
const {
  verifyBoundScript,
} = require('./builder-packaged-check-script-worker.cjs');

const BUILDER_LIVE_PREVIEW_DEV_SERVER_RUNTIME_VERSION =
  'builder-live-preview-dev-server-runtime.v1';
const HOST = '127.0.0.1';
const STARTUP_TIMEOUT_MS = 15_000;
const STOP_TIMEOUT_MS = 5_000;
const OPTION_KEYS = Object.freeze([
  'process_adapter', 'process_exec_path', 'worker_path', 'now_ms', 'on_output',
]);
const START_KEYS = Object.freeze([
  'source_admission', 'source_tree', 'runtime_admission', 'dev_admission',
  'workspace_root_path',
]);

class BuilderLivePreviewDevServerRuntimeError extends Error {
  constructor(code = 'builder_live_preview_dev_server_runtime_unavailable') {
    super('The project development server could not be started.');
    this.name = 'BuilderLivePreviewDevServerRuntimeError';
    this.code = code;
    this.retryable = true;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) { throw new BuilderLivePreviewDevServerRuntimeError(code); }

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || utilTypes.isProxy(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactObject(value, keys) {
  if (!isPlainObject(value)) fail();
  const actual = Reflect.ownKeys(value);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) fail();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  }
  return descriptors;
}

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freezeDeep(nested);
    Object.freeze(value);
  }
  return value;
}

function serviceMethod(value, versionKey, expectedVersion, methodKey) {
  if (!isPlainObject(value)) fail();
  const version = Object.getOwnPropertyDescriptor(value, versionKey);
  const method = Object.getOwnPropertyDescriptor(value, methodKey);
  if (
    !version || version.value !== expectedVersion
    || !method || typeof method.value !== 'function' || utilTypes.isProxy(method.value)
  ) fail();
  return method.value.bind(value);
}

function safeAbsolutePath(value) {
  if (
    typeof value !== 'string' || value.length < 1 || value.length > 1_024
    || value.includes('\0') || !path.isAbsolute(value) || path.normalize(value) !== value
  ) fail();
  return value;
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
    descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')
    || typeof descriptor.value !== 'string' || descriptor.value.trim().length === 0
    || descriptor.value.length > 512 || descriptor.value.includes('\0')
  ) fail();
  return descriptor.value;
}

function packageManagerFor(sourceTree) {
  const paths = new Set(sourceTree.files.map((file) => file.path));
  if (paths.has('pnpm-lock.yaml')) return 'pnpm';
  if (paths.has('yarn.lock')) return 'yarn';
  if (paths.has('bun.lockb') || paths.has('bun.lock')) return 'bun';
  return 'npm';
}

function discoverBuilderLivePreviewDevServerProfile(rawInput) {
  const input = exactObject(rawInput, ['source_admission', 'source_tree', 'discovered_at_ms']);
  const sourceAdmission = sanitizeBuilderLivePreviewSourceAdmission(input.source_admission.value);
  const sourceTree = sanitizeBuilderProjectSourceTree(input.source_tree.value);
  if (sourceTree.source_tree_digest !== sourceAdmission.source_tree_digest) fail();
  const packageFile = sourceTree.files.find((file) => file.path === 'package.json');
  if (packageFile === undefined) return null;
  let pkg;
  try { pkg = JSON.parse(packageFile.content); } catch { return null; }
  if (!isPlainObject(pkg) || !isPlainObject(pkg.scripts)) return null;
  const devScript = scriptValue(pkg.scripts, 'dev', false);
  if (devScript === null) return null;
  const lifecycleScripts = {
    pre: scriptValue(pkg.scripts, 'predev', false),
    main: devScript,
    post: scriptValue(pkg.scripts, 'postdev', false),
  };
  if (/\b0\.0\.0\.0\b|\[::\]|--host(?:=|\s+)(?:0\.0\.0\.0|::)/iu.test(lifecycleScripts.main)) {
    fail('builder_live_preview_dev_server_public_bind_forbidden');
  }
  const scriptDigest = `sha256:${nodeCrypto.createHash('sha256').update(canonicalJson({
    script_name: 'dev', lifecycle_scripts: lifecycleScripts,
  }), 'utf8').digest('hex')}`;
  return createBuilderLivePreviewDevServerCommandProfile({
    project_id: sourceAdmission.project_id,
    source_tree_digest: sourceTree.source_tree_digest,
    package_manager: packageManagerFor(sourceTree),
    script_name: 'dev',
    script_digest: scriptDigest,
    discovered_at_ms: input.discovered_at_ms.value,
  });
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = nodeNet.createServer();
    server.once('error', reject);
    server.listen(0, HOST, () => {
      const address = server.address();
      if (address === null || typeof address !== 'object' || address.address !== HOST) {
        server.close();
        reject(new Error('invalid address'));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

function probe(url) {
  return new Promise((resolve) => {
    const request = nodeHttp.get(url, { timeout: 400 }, (response) => {
      response.resume();
      resolve(response.statusCode !== undefined && response.statusCode < 500);
    });
    request.once('timeout', () => { request.destroy(); resolve(false); });
    request.once('error', () => resolve(false));
  });
}

function delay(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }

function minimalEnvironment(workspaceRootPath) {
  const env = {
    ELECTRON_RUN_AS_NODE: '1', FORCE_COLOR: '0', NO_COLOR: '1',
    HOME: workspaceRootPath, USERPROFILE: workspaceRootPath,
    TEMP: workspaceRootPath, TMP: workspaceRootPath,
    npm_config_cache: path.join(workspaceRootPath, '.clawfabric-dev-cache-v1'),
  };
  for (const key of ['ComSpec', 'PATH', 'PATHEXT', 'SystemRoot']) {
    if (typeof process.env[key] === 'string') env[key] = process.env[key];
  }
  return env;
}

function createBuilderLivePreviewDevServerRuntime(rawOptions) {
  const options = exactObject(rawOptions, OPTION_KEYS);
  const processAdapter = options.process_adapter.value;
  const spawnProcess = serviceMethod(
    processAdapter, 'adapter_version', BUILDER_CHECK_RUN_PROCESS_ADAPTER_VERSION, 'spawn_process',
  );
  const terminateProcessTree = serviceMethod(
    processAdapter, 'adapter_version', BUILDER_CHECK_RUN_PROCESS_ADAPTER_VERSION,
    'terminate_process_tree',
  );
  const processExecPath = safeAbsolutePath(options.process_exec_path.value);
  const workerPath = safeAbsolutePath(options.worker_path.value);
  const nowMs = options.now_ms.value;
  const onOutput = options.on_output.value;
  if (
    typeof nowMs !== 'function' || utilTypes.isProxy(nowMs)
    || typeof onOutput !== 'function' || utilTypes.isProxy(onOutput)
  ) fail();
  let active = null;

  async function stopSelected(selected, reason = 'cancelled') {
    if (active !== selected) return false;
    active = null;
    if (!selected.closed) await terminateProcessTree({ child: selected.child, reason });
    await Promise.race([selected.closedPromise, delay(STOP_TIMEOUT_MS)]);
    return true;
  }

  async function stopActive(reason = 'cancelled') {
    return active === null ? false : stopSelected(active, reason);
  }

  async function start(rawStart) {
    const input = exactObject(rawStart, START_KEYS);
    const sourceAdmission = sanitizeBuilderLivePreviewSourceAdmission(input.source_admission.value);
    const sourceTree = sanitizeBuilderProjectSourceTree(input.source_tree.value);
    const runtimeAdmission = sanitizeBuilderLivePreviewAdmission(input.runtime_admission.value);
    const devAdmission = sanitizeBuilderLivePreviewDevServerAdmission(input.dev_admission.value);
    const workspaceRootPath = safeAbsolutePath(input.workspace_root_path.value);
    if (
      sourceTree.source_tree_digest !== sourceAdmission.source_tree_digest
      || devAdmission.source_admission_id !== sourceAdmission.admission_id
      || devAdmission.source_tree_digest !== sourceTree.source_tree_digest
      || runtimeAdmission.project_id !== sourceAdmission.project_id
      || runtimeAdmission.source_tree_digest !== sourceTree.source_tree_digest
    ) fail();
    const stats = fs.lstatSync(workspaceRootPath);
    const realRoot = path.resolve(fs.realpathSync.native(workspaceRootPath));
    if (!stats.isDirectory() || stats.isSymbolicLink() || realRoot !== path.resolve(workspaceRootPath)) fail();
    const freshSourceTree = readBuilderLocalWorkspaceSourceTree(realRoot);
    if (freshSourceTree.source_tree_digest !== sourceTree.source_tree_digest) {
      fail('builder_live_preview_dev_server_source_drift');
    }
    verifyBoundScript({
      workspace_path: realRoot,
      command_kind: 'dev',
      script_digest: devAdmission.command_profile_ref.script_digest,
    });
    await stopActive();
    const port = await reservePort();
    const previewOrigin = `http://${HOST}:${port}`;
    const entryUrl = `${previewOrigin}/`;
    const child = spawnProcess(processExecPath, [
      workerPath,
      'run-dev-script',
      'dev',
      devAdmission.command_profile_ref.script_digest,
      HOST,
      String(port),
    ], {
      cwd: realRoot,
      env: minimalEnvironment(realRoot),
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let closed = false;
    let closeCode = null;
    let resolveClosed;
    const closedPromise = new Promise((resolve) => { resolveClosed = resolve; });
    const selected = { child, closed, closedPromise };
    active = selected;
    child.stdout.on('data', (chunk) => {
      try { onOutput(Object.freeze({ stream: 'stdout', text: String(chunk) })); } catch { /* observer */ }
    });
    child.stderr.on('data', (chunk) => {
      try { onOutput(Object.freeze({ stream: 'stderr', text: String(chunk) })); } catch { /* observer */ }
    });
    const settle = (code) => {
      closed = true;
      selected.closed = true;
      closeCode = code;
      resolveClosed();
    };
    child.once('error', () => settle(null));
    child.once('close', (code) => settle(code));
    const startedAtMs = Number(Reflect.apply(nowMs, undefined, []));
    while (Number(Reflect.apply(nowMs, undefined, [])) - startedAtMs < STARTUP_TIMEOUT_MS) {
      if (closed) {
        active = null;
        fail(closeCode === 0
          ? 'builder_live_preview_dev_server_exited_early'
          : 'builder_live_preview_dev_server_failed');
      }
      if (await probe(entryUrl)) {
        let stopped = false;
        return Object.freeze({
          server_version: BUILDER_LIVE_PREVIEW_STATIC_SERVER_VERSION,
          project_id: runtimeAdmission.project_id,
          admission_id: runtimeAdmission.admission_id,
          source_tree_digest: runtimeAdmission.source_tree_digest,
          preview_origin: previewOrigin,
          entry_url: entryUrl,
          async stop() {
            if (stopped) return Object.freeze({ stopped: false, reason: 'already_stopped' });
            const stoppedProcess = await stopSelected(selected);
            stopped = true;
            return Object.freeze({
              stopped: stoppedProcess,
              reason: stoppedProcess ? 'process_tree_closed' : 'already_stopped',
            });
          },
        });
      }
      await delay(100);
    }
    await stopActive('timed_out');
    fail('builder_live_preview_dev_server_start_timeout');
  }

  return freezeDeep({
    runtime_version: BUILDER_LIVE_PREVIEW_DEV_SERVER_RUNTIME_VERSION,
    start,
    stop: () => stopActive(),
    shutdown: () => stopActive(),
  });
}

module.exports = freezeDeep({
  BUILDER_LIVE_PREVIEW_DEV_SERVER_RUNTIME_VERSION,
  BuilderLivePreviewDevServerRuntimeError,
  createBuilderLivePreviewDevServerRuntime,
  discoverBuilderLivePreviewDevServerProfile,
});
