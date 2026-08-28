'use strict';

const fs = require('node:fs');
const nodeCrypto = require('node:crypto');
const path = require('node:path');
const { types: utilTypes } = require('node:util');

const { sanitizeBuilderCheckRunAdmission } = require('./builder-check-run-admission.cjs');
const {
  BUILDER_CHECK_RUN_ACTIVITY_REGISTRY_VERSION,
} = require('./builder-check-run-activity-registry.cjs');
const { createBuilderCheckRun } = require('./builder-check-run.cjs');
const { sanitizeBuilderCheckRuntimeIdentity } = require('./builder-check-runtime-identity.cjs');

const BUILDER_CHECK_RUN_RUNNER_VERSION = 'builder-check-run-runner.v1';
const TERMINATION_CONFIRMATION_TIMEOUT_MS = 15_000;
const DIAGNOSTIC_OUTPUT_LIMIT_BYTES = 16 * 1024;
const CREATE_KEYS = Object.freeze([
  'spawn_process',
  'clock',
  'workspace_materializer',
  'runtime_registry',
  'activity_registry',
  'terminate_process_tree',
]);
const RUN_KEYS = Object.freeze([
  'check_run_admission',
  'workspace_admission',
  'runtime_identity',
]);
const CANCEL_KEYS = Object.freeze(['check_run_admission']);
const WORKSPACE_KEYS = Object.freeze([
  'admission_version',
  'admission_kind',
  'check_run_admission_id',
  'check_run_admission_digest',
  'project_id',
  'candidate_id',
  'candidate_digest',
  'resulting_tree_digest',
  'materialized_file_count',
  'authority',
]);

class BuilderCheckRunRunnerError extends Error {
  constructor(phaseCode = 'unknown') {
    super('The project check could not be run.');
    this.name = 'BuilderCheckRunRunnerError';
    this.code = 'builder_check_run_runner_failed';
    this.phase_code = typeof phaseCode === 'string' && /^[a-z0-9_]{1,96}$/u.test(phaseCode)
      ? phaseCode
      : 'unknown';
    this.retryable = false;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(phaseCode = 'unknown') { throw new BuilderCheckRunRunnerError(phaseCode); }

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || utilTypes.isProxy(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactObject(value, keys) {
  if (!isPlainObject(value)) fail();
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== keys.length || ownKeys.some(
    (key) => typeof key !== 'string' || !keys.includes(key),
  )) fail();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  }
  return descriptors;
}

function functionValue(descriptors, key) {
  const value = descriptors[key].value;
  if (typeof value !== 'function') fail();
  return value;
}

function methodValue(value, key) {
  if (value === null || typeof value !== 'object') fail();
  const method = value[key];
  if (typeof method !== 'function') fail();
  return method.bind(value);
}

function safeNow(nowMs) {
  const value = nowMs();
  if (!Number.isSafeInteger(value) || value < 0) fail();
  return value;
}

function safeAbsolutePath(value) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > 1_024
    || value.includes('\0')
    || !path.isAbsolute(value)
    || path.normalize(value) !== value
  ) fail();
  return value;
}

function assertWorkspaceBinding(rawWorkspace, admission) {
  const descriptors = exactObject(rawWorkspace, WORKSPACE_KEYS);
  const expected = {
    check_run_admission_id: admission.admission_id,
    check_run_admission_digest: admission.admission_digest,
    project_id: admission.project_id,
    candidate_id: admission.candidate_id,
    candidate_digest: admission.candidate_digest,
    resulting_tree_digest: admission.resulting_tree_digest,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (descriptors[key].value !== value) fail();
  }
}

function assertRuntimeBinding(handle, identity, admission) {
  if (handle === null || typeof handle !== 'object') fail();
  const normalized = sanitizeBuilderCheckRuntimeIdentity(handle.runtime_identity);
  if (
    normalized.runtime_identity_id !== identity.runtime_identity_id
    || normalized.runtime_identity_digest !== identity.runtime_identity_digest
    || normalized.runtime_identity_id !== admission.runtime_identity_id
    || normalized.runtime_identity_digest !== admission.runtime_identity_digest
    || normalized.package_manager !== admission.package_manager
    || normalized.launcher_kind !== admission.launcher_kind
    || normalized.launcher_binary_digest !== admission.launcher_binary_digest
    || normalized.cli_entry_digest !== admission.cli_entry_digest
  ) fail();
  const launcherPath = safeAbsolutePath(handle.launcher_path);
  const cliEntryPath = handle.cli_entry_path === null ? null : safeAbsolutePath(handle.cli_entry_path);
  if ((admission.package_manager === 'bun') !== (cliEntryPath === null)) fail();
  return Object.freeze({ launcherPath, cliEntryPath });
}

function commandFor(admission, runtime) {
  const name = admission.command_kind;
  if (admission.package_manager === 'bun') {
    return Object.freeze({ file: runtime.launcherPath, args: Object.freeze(['run', name]) });
  }
  const verb = admission.package_manager === 'npm' ? 'run-script' : 'run';
  return Object.freeze({
    file: runtime.launcherPath,
    args: Object.freeze([runtime.cliEntryPath, verb, name, admission.script_digest]),
  });
}

function minimalEnvironment(workspacePath, launcherPath, runtimeIdentity) {
  const env = {
    CI: '1',
    FORCE_COLOR: '0',
    HOME: workspacePath,
    NO_COLOR: '1',
    PATH: path.dirname(launcherPath),
    TEMP: workspacePath,
    TMP: workspacePath,
    USERPROFILE: workspacePath,
    npm_config_cache: workspacePath,
    NPM_CONFIG_UPDATE_NOTIFIER: 'false',
  };
  if (process.platform === 'win32' && typeof process.env.SystemRoot === 'string') {
    const systemRoot = path.normalize(process.env.SystemRoot);
    env.SystemRoot = systemRoot;
    env.ComSpec = path.join(systemRoot, 'System32', 'cmd.exe');
    env.PATH = `${env.PATH}${path.delimiter}${path.join(systemRoot, 'System32')}`;
    if (typeof process.env.PATHEXT === 'string') env.PATHEXT = process.env.PATHEXT;
  } else {
    env.PATH = `${env.PATH}${path.delimiter}/usr/bin${path.delimiter}/bin`;
  }
  if (runtimeIdentity.resolution_source === 'packaged_runtime') {
    env.ELECTRON_RUN_AS_NODE = '1';
  }
  return Object.freeze(env);
}

function declaredDependencyNames(workspacePath) {
  try {
    const packageJsonPath = path.join(workspacePath, 'package.json');
    if (!fs.existsSync(packageJsonPath)) return Object.freeze(new Set());
    const parsed = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return Object.freeze(new Set());
    }
    const names = new Set();
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
      const dependencies = parsed[field];
      if (dependencies === null || typeof dependencies !== 'object' || Array.isArray(dependencies)) continue;
      for (const name of Object.keys(dependencies)) {
        if (/^(?:@[a-z0-9_.-]+\/)?[a-z0-9_.-]+$/iu.test(name)) names.add(name);
      }
    }
    return Object.freeze(names);
  } catch {
    return Object.freeze(new Set());
  }
}

function packageRoot(name) {
  if (typeof name !== 'string') return null;
  const normalized = name.trim();
  if (normalized.length === 0 || normalized.startsWith('.') || path.isAbsolute(normalized)) return null;
  const parts = normalized.split('/');
  if (normalized.startsWith('@')) return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null;
  return parts[0] ?? null;
}

function dependencyForBinary(binaryName) {
  const root = packageRoot(binaryName);
  if (root === null) return null;
  const aliases = {
    tsc: 'typescript',
    ng: '@angular/cli',
    vue: '@vue/cli-service',
  };
  return aliases[root] ?? root;
}

function extractMissingDependency(outputText) {
  for (const pattern of [
    /Cannot find package ['"]([^'"]+)['"]/iu,
    /Cannot find module ['"]([^'"]+)['"]/iu,
    /Error \[ERR_MODULE_NOT_FOUND\]: Cannot find package ['"]([^'"]+)['"]/iu,
  ]) {
    const match = pattern.exec(outputText);
    const root = packageRoot(match?.[1]);
    if (root !== null) return Object.freeze({ kind: 'module', name: root });
  }
  for (const pattern of [
    /['"]([^'"\r\n]+)['"] is not recognized as an internal or external command/iu,
    /(?:^|\n)sh: \d+: ([^\s:]+): not found/iu,
    /(?:^|\n)([^\s:]+): command not found/iu,
  ]) {
    const match = pattern.exec(outputText);
    const dependency = dependencyForBinary(match?.[1]);
    if (dependency !== null) return Object.freeze({ kind: 'binary', name: dependency });
  }
  return null;
}

function hasDependencyInstall(workspacePath) {
  try {
    return fs.existsSync(path.join(workspacePath, 'node_modules'));
  } catch {
    return false;
  }
}

function classifyFailedCheck(workspacePath, diagnosticOutput) {
  const declared = declaredDependencyNames(workspacePath);
  if (declared.size === 0) return 'failed';
  const missing = extractMissingDependency(diagnosticOutput);
  if (missing !== null && declared.has(missing.name)) return 'environment_unavailable';
  if (missing?.kind === 'binary' && !hasDependencyInstall(workspacePath)) {
    return 'environment_unavailable';
  }
  return 'failed';
}

function createOutputDigest(outputHashes, acceptedOutputBytes) {
  const digest = nodeCrypto.createHash('sha256');
  for (const streamName of ['stdout', 'stderr']) {
    digest.update(streamName, 'utf8');
    digest.update('\0', 'utf8');
    digest.update(outputHashes[streamName].digest());
    digest.update(String(acceptedOutputBytes[streamName]), 'utf8');
    digest.update('\0', 'utf8');
  }
  return `sha256:${digest.digest('hex')}`;
}

function createBuilderCheckRunRunner(rawOptions) {
  const options = exactObject(rawOptions, CREATE_KEYS);
  const spawnProcess = functionValue(options, 'spawn_process');
  const terminateProcessTree = functionValue(options, 'terminate_process_tree');
  const clock = options.clock.value;
  const nowMs = methodValue(clock, 'now_ms');
  const setTimer = methodValue(clock, 'set_timeout');
  const clearTimer = methodValue(clock, 'clear_timeout');
  const materializer = options.workspace_materializer.value;
  const readWorkspacePath = methodValue(materializer, 'read_workspace_path');
  const cleanupWorkspace = methodValue(materializer, 'cleanup');
  const readWorkspaceReadinessSnapshot =
    typeof materializer.read_workspace_readiness_snapshot === 'function'
      ? materializer.read_workspace_readiness_snapshot.bind(materializer)
      : null;
  const registry = options.runtime_registry.value;
  const readPrivateRuntime = methodValue(registry, 'read_private_runtime');
  const activityRegistry = options.activity_registry.value;
  if (
    activityRegistry === null
    || typeof activityRegistry !== 'object'
    || activityRegistry.registry_version !== BUILDER_CHECK_RUN_ACTIVITY_REGISTRY_VERSION
  ) fail();
  const beginCheckRun = methodValue(activityRegistry, 'begin_check_run');
  const endCheckRun = methodValue(activityRegistry, 'end_check_run');
  const usedAdmissions = new Set();
  const inFlight = new Map();

  async function runCheck(rawInput) {
    const input = exactObject(rawInput, RUN_KEYS);
    const admission = sanitizeBuilderCheckRunAdmission(input.check_run_admission.value);
    if (usedAdmissions.has(admission.admission_id)) fail();
    usedAdmissions.add(admission.admission_id);
    const rawIdentity = input.runtime_identity.value;
    const identity = sanitizeBuilderCheckRuntimeIdentity(rawIdentity);
    if (
      identity.runtime_identity_id !== admission.runtime_identity_id
      || identity.runtime_identity_digest !== admission.runtime_identity_digest
    ) fail();
    const startedAtMs = safeNow(nowMs);
    let runtimeHandle;
    try {
      runtimeHandle = readPrivateRuntime({
        runtime_identity: rawIdentity,
        read_at_ms: startedAtMs,
      });
    } catch (error) {
      if (error instanceof BuilderCheckRunRunnerError) throw error;
      fail('private_runtime_read');
    }
    const runtime = assertRuntimeBinding(runtimeHandle, identity, admission);
    const workspaceAdmission = input.workspace_admission.value;
    assertWorkspaceBinding(workspaceAdmission, admission);
    let cleanupRequired = false;
    let cleanupSafe = false;
    let activityRegistered = false;
    let terminalResultProduced = false;
    try {
      if (beginCheckRun({ check_run_admission: admission }) !== true) fail('activity_begin');
      activityRegistered = true;
      let workspacePath;
      try {
        workspacePath = safeAbsolutePath(readWorkspacePath(workspaceAdmission));
      } catch (error) {
        if (error instanceof BuilderCheckRunRunnerError) throw error;
        fail('workspace_read');
      }
      cleanupRequired = true;
      if (readWorkspaceReadinessSnapshot !== null) {
        try {
          readWorkspaceReadinessSnapshot({
            check_run_admission: admission,
            workspace_admission: workspaceAdmission,
            project_root_path: null,
            host_toolchain_state: 'visible',
            toolchain_probe: null,
            install_permission: 'not_requested',
            updated_at_ms: startedAtMs,
          });
        } catch (error) {
          if (error instanceof BuilderCheckRunRunnerError) throw error;
          fail('workspace_readiness');
        }
      }
      const command = commandFor(admission, runtime);
      const outputHashes = {
        stdout: nodeCrypto.createHash('sha256'),
        stderr: nodeCrypto.createHash('sha256'),
      };
      const acceptedOutputBytes = { stdout: 0, stderr: 0 };
      const diagnosticOutput = [];
      let diagnosticOutputBytes = 0;
      let outputBytes = 0;
      let outputClosed = false;
      let child;
      let timer = null;
      let terminationTimer = null;
      let settled = false;
      let stopStatus = null;

      const result = await new Promise((resolve, reject) => {
        const digestOutput = () => {
          if (outputClosed) fail();
          outputClosed = true;
          return createOutputDigest(outputHashes, acceptedOutputBytes);
        };
        const clearTimers = () => {
          if (timer !== null) clearTimer(timer);
          if (terminationTimer !== null) clearTimer(terminationTimer);
        };
        const finish = (status, exitCode = null, processClosed = true) => {
          if (settled) return;
          settled = true;
          cleanupSafe = processClosed;
          clearTimers();
          inFlight.delete(admission.admission_id);
          try {
            const completedAtMs = safeNow(nowMs);
            resolve(createBuilderCheckRun({
              check_run_admission: admission,
              status,
              exit_code: exitCode,
              output_digest: digestOutput(),
              failure_class: status === 'passed' ? 'none' : status === 'failed' ? 'command_failed' : status,
              environment_reason: status === 'environment_unavailable'
                ? 'dependency_workspace_missing'
                : undefined,
              started_at_ms: startedAtMs,
              completed_at_ms: completedAtMs,
            }));
          } catch (error) {
            reject(error);
          }
        };
        const requestStop = (status) => {
          if (settled || stopStatus !== null) return;
          stopStatus = status;
          if (timer !== null) clearTimer(timer);
          try {
            terminationTimer = setTimer(
              () => finish('termination_failed', null, false),
              TERMINATION_CONFIRMATION_TIMEOUT_MS,
            );
            Promise.resolve(terminateProcessTree({ child, reason: status })).then(
              (terminated) => {
                if (!settled && terminated !== true) {
                  finish('termination_failed', null, false);
                }
              },
              () => finish('termination_failed', null, false),
            );
          } catch {
            finish('termination_failed', null, false);
          }
        };
        const capture = (streamName) => (chunk) => {
          if (settled || stopStatus !== null) return;
          const bytes = Buffer.from(chunk);
          if (diagnosticOutputBytes < DIAGNOSTIC_OUTPUT_LIMIT_BYTES) {
            const remainingDiagnosticBytes = DIAGNOSTIC_OUTPUT_LIMIT_BYTES - diagnosticOutputBytes;
            const diagnosticBytes = bytes.subarray(0, remainingDiagnosticBytes);
            diagnosticOutput.push(diagnosticBytes);
            diagnosticOutputBytes += diagnosticBytes.length;
          }
          const remaining = Math.max(0, admission.output_budget_bytes - outputBytes);
          const accepted = bytes.subarray(0, remaining);
          outputHashes[streamName].update(accepted);
          acceptedOutputBytes[streamName] += accepted.length;
          outputBytes += bytes.length;
          if (outputBytes > admission.output_budget_bytes) requestStop('output_exceeded');
        };
        try {
          child = spawnProcess(command.file, [...command.args], {
            cwd: workspacePath,
            env: minimalEnvironment(workspacePath, command.file, identity),
            shell: false,
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
          });
          if (
            child === null
            || typeof child !== 'object'
            || typeof child.once !== 'function'
            || !child.stdout
            || typeof child.stdout.on !== 'function'
            || !child.stderr
            || typeof child.stderr.on !== 'function'
          ) fail('spawn_handle');
        } catch {
          finish('spawn_failed', null, true);
          return;
        }
        child.stdout.on('data', capture('stdout'));
        child.stderr.on('data', capture('stderr'));
        child.once('error', () => requestStop('spawn_failed'));
        child.once('close', (code, signal) => {
          if (settled) return;
          if (stopStatus !== null) {
            finish(stopStatus, null, true);
            return;
          }
          if (signal !== null || !Number.isSafeInteger(code)) finish('spawn_failed');
          else if (code === 0) finish('passed', 0);
          else {
            const failureStatus = classifyFailedCheck(
              workspacePath,
              Buffer.concat(diagnosticOutput).toString('utf8'),
            );
            finish(
              failureStatus,
              failureStatus === 'failed' ? Math.min(255, Math.max(1, code)) : null,
            );
          }
        });
        inFlight.set(admission.admission_id, requestStop);
        timer = setTimer(() => requestStop('timed_out'), admission.timeout_ms);
      });
      terminalResultProduced = true;
      return result;
    } catch (error) {
      if (error instanceof BuilderCheckRunRunnerError) throw error;
      fail('unexpected');
    } finally {
      inFlight.delete(admission.admission_id);
      let finalizationFailed = false;
      if (cleanupRequired && cleanupSafe) {
        try { cleanupWorkspace(workspaceAdmission); } catch { finalizationFailed = true; }
      }
      if (activityRegistered) {
        try {
          if (endCheckRun({ check_run_admission: admission }) !== true) finalizationFailed = true;
        } catch {
          finalizationFailed = true;
        }
      }
      if (finalizationFailed && !terminalResultProduced) fail('finalization');
    }
  }

  return Object.freeze({
    runner_version: BUILDER_CHECK_RUN_RUNNER_VERSION,
    run_check(rawInput) {
      return runCheck(rawInput).catch((error) => {
        if (error instanceof BuilderCheckRunRunnerError) throw error;
        fail();
      });
    },
    cancel_check(rawInput) {
      try {
        const input = exactObject(rawInput, CANCEL_KEYS);
        const admission = sanitizeBuilderCheckRunAdmission(input.check_run_admission.value);
        const requestStop = inFlight.get(admission.admission_id);
        if (!requestStop) return false;
        requestStop('cancelled');
        return true;
      } catch (error) {
        if (error instanceof BuilderCheckRunRunnerError) throw error;
        fail();
      }
    },
  });
}

module.exports = Object.freeze({
  BUILDER_CHECK_RUN_RUNNER_VERSION,
  TERMINATION_CONFIRMATION_TIMEOUT_MS,
  BuilderCheckRunRunnerError,
  createBuilderCheckRunRunner,
});
