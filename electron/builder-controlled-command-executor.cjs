'use strict';

const fs = require('node:fs');
const nodeCrypto = require('node:crypto');
const path = require('node:path');
const { monitorEventLoopDelay } = require('node:perf_hooks');
const { types: utilTypes } = require('node:util');

const {
  BUILDER_CONTROLLED_COMMAND_APPROVAL_SERVICE_VERSION,
} = require('./builder-controlled-command-approval-service.cjs');
const {
  BUILDER_CHECK_RUN_PROCESS_ADAPTER_VERSION,
} = require('./builder-check-run-process-adapter.cjs');
const {
  BUILDER_CHECK_RUNTIME_REGISTRY_VERSION,
  sanitizeBuilderCheckRuntimeIdentity,
} = require('./builder-check-runtime-identity.cjs');
const {
  BUILDER_PACKAGED_CHECK_RUNTIME_RESOLVER_VERSION,
} = require('./builder-packaged-check-runtime-resolver.cjs');
const {
  sanitizeBuilderProgrammingRuntimeRunContract,
} = require('./builder-programming-runtime-contract.cjs');
const {
  sanitizeBuilderProjectSourceTree,
} = require('./builder-project-source-tree.cjs');
const {
  builderPerformanceTrace,
} = require('./builder-performance-trace.cjs');

const BUILDER_CONTROLLED_COMMAND_EXECUTOR_VERSION = 'builder-controlled-command-executor.v1';
const BUILDER_CONTROLLED_COMMAND_RESULT_VERSION = 'builder-controlled-command-result.v1';
const COMMAND_TIMEOUT_MS = 2 * 60 * 1_000;
const OUTPUT_COALESCE_MS = 100;
const TERMINATION_CONFIRMATION_TIMEOUT_MS = 15_000;
const OUTPUT_PREVIEW_BYTES = 64 * 1_024;
const OUTPUT_PENDING_BYTES = 128 * 1_024;
const OUTPUT_PUBLIC_EVENT_BYTES = 256 * 1_024;
const OUTPUT_PRIVATE_RETENTION_BYTES = 16 * 1_024 * 1_024;
const OUTPUT_PAGE_MAX_BYTES = 64 * 1_024;
const OUTPUT_RETENTION_DIRECTORY = 'controlled-command-output-v1';

async function measureTraceWindow(windowName, metricName, callback) {
  const windowStarted = builderPerformanceTrace.beginEventLoopWindow(windowName);
  try {
    return await builderPerformanceTrace.measureAsync(metricName, callback);
  } finally {
    if (windowStarted) builderPerformanceTrace.endEventLoopWindow(windowName);
  }
}

const CREATE_KEYS = Object.freeze([
  'approval_service', 'runtime_resolver', 'runtime_registry', 'process_adapter',
  'command_root', 'clock', 'on_output',
]);
const EXECUTE_KEYS = Object.freeze([
  'execution_approval', 'run_contract', 'source_tree', 'command_profile_id',
]);
const CANCEL_KEYS = Object.freeze(['run_id']);
const READ_OUTPUT_KEYS = Object.freeze([
  'complete_output_ref', 'stream', 'offset', 'maximum_bytes',
]);
const OUTPUT_REF_PATTERN = /^builder-command-output:[0-9a-f]{64}$/u;
const OUTPUT_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const OUTPUT_RECEIPT_KEYS = Object.freeze([
  'receipt_version',
  'complete_output_ref',
  'run_id',
  'status',
  'completed_at_ms',
  'stdout_bytes',
  'stderr_bytes',
  'stdout_lines',
  'stderr_lines',
  'stdout_digest',
  'stderr_digest',
]);
// Terminal control sequences are never allowed into public command evidence.
// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))/gu;
const SECRET_ASSIGNMENT_PATTERN = /\b(?:api[_-]?key|access[_-]?token|authorization|password|secret|credential|private[_-]?key)\s*[:=]\s*[^\s]+/giu;

class BuilderControlledCommandExecutorError extends Error {
  constructor(code = 'builder_controlled_command_executor_failed') {
    const selected = [
      'builder_controlled_command_executor_failed',
      'builder_controlled_command_executor_busy',
      'builder_controlled_command_executor_cleanup_failed',
    ].includes(code) ? code : 'builder_controlled_command_executor_failed';
    const messages = {
      builder_controlled_command_executor_failed: 'The approved project command could not be run.',
      builder_controlled_command_executor_busy: 'A project command is already running.',
      builder_controlled_command_executor_cleanup_failed: 'The project command process could not be cleaned up.',
    };
    super(messages[selected]);
    this.name = 'BuilderControlledCommandExecutorError';
    this.code = selected;
    this.retryable = false;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) { throw new BuilderControlledCommandExecutorError(code); }

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

function serviceMethod(value, versionKey, version, methodKey) {
  if (!isPlainObject(value) || value[versionKey] !== version) fail();
  const method = value[methodKey];
  if (typeof method !== 'function' || utilTypes.isProxy(method)) fail();
  return method.bind(value);
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

function safeNow(nowMs) {
  const value = Number(nowMs());
  if (!Number.isSafeInteger(value) || value < 0) fail();
  return value;
}

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freezeDeep(nested);
    Object.freeze(value);
  }
  return value;
}

function contained(root, target) {
  const relative = path.relative(root, target);
  return relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function ensureRoot(rawRoot) {
  const root = safeAbsolutePath(rawRoot);
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const stats = fs.lstatSync(root);
  const real = path.resolve(fs.realpathSync.native(root));
  if (!stats.isDirectory() || stats.isSymbolicLink() || real !== path.resolve(root)) fail();
  return real;
}

function materialize(root, sourceTree) {
  const workspace = fs.mkdtempSync(path.join(root, 'command-'));
  const realWorkspace = path.resolve(fs.realpathSync.native(workspace));
  if (!contained(root, realWorkspace)) fail();
  try {
    for (const file of sourceTree.files) {
      if (file.path.split('/').some((segment) => segment.toLowerCase() === '.git')) fail();
      const target = path.join(realWorkspace, ...file.path.split('/'));
      if (!contained(realWorkspace, target)) fail();
      fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
      fs.writeFileSync(target, file.content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    }
    return realWorkspace;
  } catch (error) {
    try { fs.rmSync(realWorkspace, { recursive: true, force: true }); } catch { /* fixed error below */ }
    if (error instanceof BuilderControlledCommandExecutorError) throw error;
    fail();
  }
}

function cleanup(root, workspace) {
  const resolved = path.resolve(workspace);
  if (!contained(root, resolved) || path.basename(resolved).startsWith('command-') === false) fail();
  try {
    fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  } catch {
    fail('builder_controlled_command_executor_cleanup_failed');
  }
}

function minimalEnvironment(workspace, launcherPath, identity) {
  const env = {
    CI: '1',
    FORCE_COLOR: '0',
    HOME: workspace,
    NO_COLOR: '1',
    PATH: path.dirname(launcherPath),
    TEMP: workspace,
    TMP: workspace,
    USERPROFILE: workspace,
    npm_config_cache: workspace,
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
  if (identity.resolution_source === 'packaged_runtime') env.ELECTRON_RUN_AS_NODE = '1';
  return Object.freeze(env);
}

function commandFor(profile, handle) {
  const identity = sanitizeBuilderCheckRuntimeIdentity(handle.runtime_identity);
  const launcherPath = safeAbsolutePath(handle.launcher_path);
  const cliEntryPath = safeAbsolutePath(handle.cli_entry_path);
  if (identity.package_manager !== 'npm' || identity.launcher_kind !== 'node_cli') fail();
  return Object.freeze({
    identity,
    launcherPath,
    args: Object.freeze([cliEntryPath, 'run-script', profile.command_kind, profile.script_digest]),
  });
}

function redactedPreview(buffer, workspace) {
  return buffer.toString('utf8')
    .replace(ANSI_PATTERN, '')
    .replaceAll(workspace, '<project>')
    .replaceAll(workspace.replaceAll('\\', '/'), '<project>')
    .replace(SECRET_ASSIGNMENT_PATTERN, '[redacted]');
}

function writeAll(fd, buffer) {
  let offset = 0;
  while (offset < buffer.length) offset += fs.writeSync(fd, buffer, offset);
}

function outputToken(runId) {
  return nodeCrypto.createHash('sha256').update(runId, 'utf8').digest('hex');
}

function outputPaths(root, token) {
  return Object.freeze({
    metadata: path.join(root, `${token}.json`),
    stderr: path.join(root, `${token}.stderr.log`),
    stdout: path.join(root, `${token}.stdout.log`),
  });
}

function retainedTextTail(text, maximumBytes) {
  const encoded = Buffer.from(text, 'utf8');
  if (encoded.length <= maximumBytes) return text;
  return encoded.subarray(encoded.length - maximumBytes).toString('utf8').replace(/^\uFFFD/u, '');
}

function splitTextChunks(text, maximumBytes) {
  const chunks = [];
  let current = '';
  let currentBytes = 0;
  for (const symbol of text) {
    const symbolBytes = Buffer.byteLength(symbol, 'utf8');
    if (currentBytes + symbolBytes > maximumBytes && current.length > 0) {
      chunks.push(current);
      current = '';
      currentBytes = 0;
    }
    current += symbol;
    currentBytes += symbolBytes;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

function retainedOutputReceipt(value, expectedRef) {
  const descriptors = exactObject(value, OUTPUT_RECEIPT_KEYS);
  const receipt = Object.fromEntries(OUTPUT_RECEIPT_KEYS.map((key) => [key, descriptors[key].value]));
  if (
    receipt.receipt_version !== 'builder-command-output-retention-receipt.v1'
    || receipt.complete_output_ref !== expectedRef
    || typeof receipt.run_id !== 'string'
    || receipt.run_id.length === 0
    || receipt.run_id.length > 256
    || !['passed', 'failed', 'cancelled', 'timed_out', 'output_exceeded', 'spawn_failed', 'termination_failed']
      .includes(receipt.status)
    || !Number.isSafeInteger(receipt.completed_at_ms)
    || receipt.completed_at_ms < 0
    || !['stdout_bytes', 'stderr_bytes', 'stdout_lines', 'stderr_lines'].every(
      (key) => Number.isSafeInteger(receipt[key]) && receipt[key] >= 0,
    )
    || !OUTPUT_DIGEST_PATTERN.test(receipt.stdout_digest)
    || !OUTPUT_DIGEST_PATTERN.test(receipt.stderr_digest)
  ) fail();
  return Object.freeze(receipt);
}

function createBuilderControlledCommandExecutor(rawOptions) {
  const options = exactObject(rawOptions, CREATE_KEYS);
  const approvalService = options.approval_service.value;
  const consumeApproval = serviceMethod(
    approvalService,
    'service_version',
    BUILDER_CONTROLLED_COMMAND_APPROVAL_SERVICE_VERSION,
    'consume',
  );
  const runtimeResolver = options.runtime_resolver.value;
  const resolveRuntimeMethod = typeof runtimeResolver?.resolve_npm_runtime_async === 'function'
    ? 'resolve_npm_runtime_async'
    : 'resolve_npm_runtime';
  const resolveRuntime = serviceMethod(
    runtimeResolver,
    'resolver_version',
    BUILDER_PACKAGED_CHECK_RUNTIME_RESOLVER_VERSION,
    resolveRuntimeMethod,
  );
  const runtimeRegistry = options.runtime_registry.value;
  const readPrivateRuntimeMethod = typeof runtimeRegistry?.read_private_runtime_async === 'function'
    ? 'read_private_runtime_async'
    : 'read_private_runtime';
  const readPrivateRuntime = serviceMethod(
    runtimeRegistry,
    'registry_version',
    BUILDER_CHECK_RUNTIME_REGISTRY_VERSION,
    readPrivateRuntimeMethod,
  );
  const processAdapter = options.process_adapter.value;
  const spawnProcess = serviceMethod(
    processAdapter,
    'adapter_version',
    BUILDER_CHECK_RUN_PROCESS_ADAPTER_VERSION,
    'spawn_process',
  );
  const terminateProcessTree = serviceMethod(
    processAdapter,
    'adapter_version',
    BUILDER_CHECK_RUN_PROCESS_ADAPTER_VERSION,
    'terminate_process_tree',
  );
  const commandRoot = ensureRoot(options.command_root.value);
  const outputRoot = ensureRoot(path.join(path.dirname(commandRoot), OUTPUT_RETENTION_DIRECTORY));
  const clock = options.clock.value;
  const nowMs = serviceMethod(clock, 'clock_version', 'builder-clock.v1', 'now_ms');
  const setTimer = serviceMethod(clock, 'clock_version', 'builder-clock.v1', 'set_timeout');
  const clearTimer = serviceMethod(clock, 'clock_version', 'builder-clock.v1', 'clear_timeout');
  const onOutput = options.on_output.value;
  if (typeof onOutput !== 'function' || utilTypes.isProxy(onOutput)) fail();
  const inFlight = new Map();

  async function execute(rawRequest) {
    return await measureTraceWindow(
      'command_executor_execute',
      'main.command_executor.execute.duration_ms',
      () => executeImpl(rawRequest),
    );
  }

  async function executeImpl(rawRequest) {
    const request = exactObject(rawRequest, EXECUTE_KEYS);
    const runContract = sanitizeBuilderProgrammingRuntimeRunContract(request.run_contract.value);
    const runId = runContract.admission.run_id;
    if (inFlight.has(runId)) fail('builder_controlled_command_executor_busy');
    const sourceTree = sanitizeBuilderProjectSourceTree(request.source_tree.value);
    const profile = consumeApproval({
      execution_approval: request.execution_approval.value,
      run_contract: runContract,
      source_tree: sourceTree,
      command_profile_id: request.command_profile_id.value,
    });
    let workspace = null;
    let child = null;
    let processClosed = false;
    let settled = false;
    let stopStatus = null;
    let timer = null;
    let terminationTimer = null;
    let flushTimer = null;
    const startedAtMs = safeNow(nowMs);
    const publicOutputBudget = Math.min(
      OUTPUT_PUBLIC_EVENT_BYTES,
      runContract.admission.limits.max_tool_output_bytes,
    );
    const captured = { stdout: [], stderr: [] };
    const capturedBytes = { stdout: 0, stderr: 0 };
    const hashes = { stdout: nodeCrypto.createHash('sha256'), stderr: nodeCrypto.createHash('sha256') };
    const lineCounts = { stdout: 0, stderr: 0 };
    const streamBytes = { stdout: 0, stderr: 0 };
    let totalOutputBytes = 0;
    const pendingOutput = { stdout: '', stderr: '' };
    const publicOutputBytes = { stdout: 0, stderr: 0 };
    const streamPublicOutputBudget = Math.floor(publicOutputBudget / 2);
    const token = outputToken(runId);
    const completeOutputRef = `builder-command-output:${token}`;
    const retainedPaths = outputPaths(outputRoot, token);
    let outputFiles = null;
    const commandEventLoopHistogram = builderPerformanceTrace.enabled()
      ? monitorEventLoopDelay({ resolution: 10 })
      : null;

    function digest(stream) { return `sha256:${hashes[stream].digest('hex')}`; }
    function flushOutput() {
      if (flushTimer !== null) clearTimer(flushTimer);
      flushTimer = null;
      const chunks = ['stdout', 'stderr'].flatMap((stream) => {
        const text = pendingOutput[stream];
        if (text.length === 0) return [];
        pendingOutput[stream] = '';
        const bytes = Buffer.byteLength(text, 'utf8');
        publicOutputBytes[stream] += bytes;
        return splitTextChunks(text, OUTPUT_PREVIEW_BYTES).map((chunk) => (
          Object.freeze({ stream, text: chunk })
        ));
      });
      if (chunks.length === 0) return;
      const eventBytes = chunks.reduce(
        (total, chunk) => total + Buffer.byteLength(chunk.text, 'utf8'),
        0,
      );
      builderPerformanceTrace.observe('main.command_output.public_event_bytes', eventBytes);
      try {
        Reflect.apply(onOutput, undefined, [freezeDeep({
          event_version: 'builder-controlled-command-output.v1',
          project_id: runContract.admission.project_id,
          conversation_id: runContract.admission.conversation_id,
          turn_id: runContract.admission.turn_id,
          task_id: runContract.admission.task_id,
          run_id: runId,
          command_profile_id: profile.command_profile_id,
          chunks,
        })]);
      } catch { /* output observers cannot interrupt the process */ }
    }
    function queueOutput(stream, text) {
      const available = Math.min(
        OUTPUT_PENDING_BYTES,
        Math.max(0, streamPublicOutputBudget - publicOutputBytes[stream]),
      );
      if (available === 0) return;
      pendingOutput[stream] = retainedTextTail(`${pendingOutput[stream]}${text}`, available);
      if (flushTimer === null) flushTimer = setTimer(flushOutput, OUTPUT_COALESCE_MS);
    }

    try {
      commandEventLoopHistogram?.enable();
      if (commandEventLoopHistogram !== null) {
        await new Promise((resolve) => setImmediate(resolve));
      }
      workspace = builderPerformanceTrace.measureSync(
        'main.command_executor.materialize.duration_ms',
        () => materialize(commandRoot, sourceTree),
      );
      outputFiles = Object.freeze({
        stderr: fs.openSync(retainedPaths.stderr, 'wx', 0o600),
        stdout: fs.openSync(retainedPaths.stdout, 'wx', 0o600),
      });
      const identity = await builderPerformanceTrace.measureAsync(
        'main.command_executor.resolve_runtime.duration_ms',
        resolveRuntime,
      );
      const handle = await builderPerformanceTrace.measureAsync(
        'main.command_executor.read_private_runtime.duration_ms',
        () => readPrivateRuntime({
          runtime_identity: identity,
          read_at_ms: safeNow(nowMs),
        }),
      );
      const command = commandFor(profile, handle);
      const result = await measureTraceWindow('command_executor_process_run', 'main.command_executor.process_run.duration_ms', () => new Promise((resolve) => {
        let childCloseObserved = false;
        let terminationConfirmed = false;
        function clearTimers() {
          if (timer !== null) clearTimer(timer);
          if (terminationTimer !== null) clearTimer(terminationTimer);
          if (flushTimer !== null) flushOutput();
        }
        function finish(status, exitCode = null, closed = true) {
          if (settled) return;
          builderPerformanceTrace.measureSync('main.command_executor.finish.duration_ms', () => {
            settled = true;
            processClosed = closed;
            clearTimers();
            inFlight.delete(runId);
            const completedAtMs = safeNow(nowMs);
            for (const fd of Object.values(outputFiles ?? {})) fs.closeSync(fd);
            outputFiles = null;
            const stdoutDigest = digest('stdout');
            const stderrDigest = digest('stderr');
            const outputTruncated = totalOutputBytes > capturedBytes.stdout + capturedBytes.stderr;
            fs.writeFileSync(retainedPaths.metadata, `${JSON.stringify({
              receipt_version: 'builder-command-output-retention-receipt.v1',
              complete_output_ref: completeOutputRef,
              run_id: runId,
              status,
              completed_at_ms: completedAtMs,
              stdout_bytes: streamBytes.stdout,
              stderr_bytes: streamBytes.stderr,
              stdout_lines: lineCounts.stdout,
              stderr_lines: lineCounts.stderr,
              stdout_digest: stdoutDigest,
              stderr_digest: stderrDigest,
            })}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
            builderPerformanceTrace.observe('main.command_output.spill_retained_bytes', totalOutputBytes);
            resolve(freezeDeep({
              result_version: BUILDER_CONTROLLED_COMMAND_RESULT_VERSION,
              status,
              command_kind: profile.command_kind,
              command_display: profile.command_display,
              command_profile_id: profile.command_profile_id,
              source_tree_digest: sourceTree.source_tree_digest,
              exit_code: exitCode,
              duration_ms: completedAtMs - startedAtMs,
              stdout_digest: stdoutDigest,
              stderr_digest: stderrDigest,
              stdout_preview: redactedPreview(Buffer.concat(captured.stdout), workspace),
              stderr_preview: redactedPreview(Buffer.concat(captured.stderr), workspace),
              output_truncated: outputTruncated,
              complete_output_ref: completeOutputRef,
            }));
          });
        }
        function requestStop(status) {
          if (settled || stopStatus !== null) return;
          stopStatus = status;
          if (timer !== null) clearTimer(timer);
          terminationTimer = setTimer(
            () => finish('termination_failed', null, false),
            TERMINATION_CONFIRMATION_TIMEOUT_MS,
          );
          Promise.resolve(terminateProcessTree({ child, reason: status })).then(
            (terminated) => {
              if (settled) return;
              if (terminated !== true) {
                finish('termination_failed', null, false);
                return;
              }
              terminationConfirmed = true;
              if (childCloseObserved) finish(stopStatus, null, true);
            },
            () => finish('termination_failed', null, false),
          );
        }
        function capture(stream) {
          return (rawChunk) => {
            if (settled || stopStatus !== null) return;
            const chunk = Buffer.from(rawChunk);
            builderPerformanceTrace.observe('main.command_output.received_bytes', chunk.length);
            const remaining = Math.max(0, OUTPUT_PRIVATE_RETENTION_BYTES - totalOutputBytes);
            const retainedChunk = chunk.subarray(0, remaining);
            hashes[stream].update(retainedChunk);
            totalOutputBytes += retainedChunk.length;
            streamBytes[stream] += retainedChunk.length;
            for (const byte of retainedChunk) {
              if (byte === 0x0a) lineCounts[stream] += 1;
            }
            if (retainedChunk.length > 0) {
              builderPerformanceTrace.measureSync('main.command_output.spill_write.duration_ms', () => {
                writeAll(outputFiles[stream], retainedChunk);
              });
            }
            const remainingPreview = Math.max(0, OUTPUT_PREVIEW_BYTES - capturedBytes[stream]);
            if (remainingPreview > 0) {
              const accepted = retainedChunk.subarray(0, remainingPreview);
              captured[stream].push(accepted);
              capturedBytes[stream] += accepted.length;
            }
            if (retainedChunk.length > 0) {
              queueOutput(stream, redactedPreview(retainedChunk, workspace));
            }
            if (retainedChunk.length !== chunk.length) requestStop('output_exceeded');
          };
        }
        try {
          child = builderPerformanceTrace.measureSync(
            'main.command_executor.spawn.duration_ms',
            () => spawnProcess(command.launcherPath, [...command.args], {
              cwd: workspace,
              env: minimalEnvironment(workspace, command.launcherPath, command.identity),
              shell: false,
              stdio: ['ignore', 'pipe', 'pipe'],
              windowsHide: true,
            }),
          );
        } catch {
          finish('spawn_failed');
          return;
        }
        child.stdout.on('data', capture('stdout'));
        child.stderr.on('data', capture('stderr'));
        child.once('spawn', () => {
          if (settled || stopStatus !== null || timer !== null) return;
          timer = setTimer(() => requestStop('timed_out'), COMMAND_TIMEOUT_MS);
        });
        child.once('error', () => requestStop('spawn_failed'));
        child.once('close', (code, signal) => {
          if (settled) return;
          if (stopStatus !== null) {
            childCloseObserved = true;
            if (terminationConfirmed) finish(stopStatus, null, true);
          }
          else if (signal !== null || !Number.isSafeInteger(code)) finish('spawn_failed');
          else if (code === 0) finish('passed', 0);
          else finish('failed', Math.min(255, Math.max(1, code)));
        });
        inFlight.set(runId, requestStop);
      }));
      return result;
    } finally {
      if (commandEventLoopHistogram !== null) {
        commandEventLoopHistogram.disable();
        builderPerformanceTrace.observe(
          'main.command_output.event_loop_delay_ms',
          Number(commandEventLoopHistogram.max) / 1_000_000,
        );
      }
      inFlight.delete(runId);
      if (workspace !== null && (child === null || processClosed)) {
        builderPerformanceTrace.measureSync(
          'main.command_executor.cleanup.duration_ms',
          () => cleanup(commandRoot, workspace),
        );
      }
      if (outputFiles !== null) {
        for (const fd of Object.values(outputFiles)) {
          try { fs.closeSync(fd); } catch { /* fixed execution result owns the error */ }
        }
        outputFiles = null;
      }
    }
  }

  return freezeDeep({
    executor_version: BUILDER_CONTROLLED_COMMAND_EXECUTOR_VERSION,
    execute,
    cancel(rawRequest) {
      const request = exactObject(rawRequest, CANCEL_KEYS);
      const requestStop = inFlight.get(request.run_id.value);
      if (requestStop === undefined) return false;
      requestStop('cancelled');
      return true;
    },
    active_count() { return inFlight.size; },
    read_output(rawRequest) {
      const request = exactObject(rawRequest, READ_OUTPUT_KEYS);
      const completeOutputRefValue = request.complete_output_ref.value;
      const stream = request.stream.value;
      const offset = request.offset.value;
      const maximumBytes = request.maximum_bytes.value;
      if (
        typeof completeOutputRefValue !== 'string'
        || !OUTPUT_REF_PATTERN.test(completeOutputRefValue)
        || !['stdout', 'stderr'].includes(stream)
        || !Number.isSafeInteger(offset)
        || offset < 0
        || !Number.isSafeInteger(maximumBytes)
        || maximumBytes < 1
        || maximumBytes > OUTPUT_PAGE_MAX_BYTES
      ) fail();
      const outputTokenValue = completeOutputRefValue.slice('builder-command-output:'.length);
      const retained = outputPaths(outputRoot, outputTokenValue);
      let metadata;
      try {
        const metadataStats = fs.lstatSync(retained.metadata);
        if (!metadataStats.isFile() || metadataStats.isSymbolicLink()) fail();
        metadata = retainedOutputReceipt(
          JSON.parse(fs.readFileSync(retained.metadata, 'utf8')),
          completeOutputRefValue,
        );
      } catch (error) {
        if (error instanceof BuilderControlledCommandExecutorError) throw error;
        fail();
      }
      const totalBytes = stream === 'stdout' ? metadata.stdout_bytes : metadata.stderr_bytes;
      if (!Number.isSafeInteger(totalBytes) || totalBytes < 0 || offset > totalBytes) fail();
      const length = Math.min(maximumBytes, totalBytes - offset);
      const buffer = Buffer.alloc(length);
      let fd = null;
      try {
        const outputStats = fs.lstatSync(retained[stream]);
        if (
          !outputStats.isFile()
          || outputStats.isSymbolicLink()
          || outputStats.size !== totalBytes
        ) fail();
        fd = fs.openSync(retained[stream], 'r');
        if (fs.fstatSync(fd).size !== totalBytes) fail();
        if (fs.readSync(fd, buffer, 0, length, offset) !== length) fail();
      } catch (error) {
        if (error instanceof BuilderControlledCommandExecutorError) throw error;
        fail();
      } finally {
        if (fd !== null) fs.closeSync(fd);
      }
      return freezeDeep({
        page_version: 'builder-command-output-page.v1',
        complete_output_ref: completeOutputRefValue,
        stream,
        offset,
        next_offset: offset + length,
        total_bytes: totalBytes,
        eof: offset + length === totalBytes,
        content_base64: buffer.toString('base64'),
      });
    },
  });
}

module.exports = freezeDeep({
  BUILDER_CONTROLLED_COMMAND_EXECUTOR_VERSION,
  BUILDER_CONTROLLED_COMMAND_RESULT_VERSION,
  COMMAND_TIMEOUT_MS,
  OUTPUT_COALESCE_MS,
  OUTPUT_PAGE_MAX_BYTES,
  OUTPUT_PRIVATE_RETENTION_BYTES,
  OUTPUT_PUBLIC_EVENT_BYTES,
  BuilderControlledCommandExecutorError,
  createBuilderControlledCommandExecutor,
});
