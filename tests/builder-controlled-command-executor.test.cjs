'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const test = require('node:test');

const {
  createBuilderControlledCommandApprovalService,
} = require('../electron/builder-controlled-command-approval-service.cjs');
const {
  createBuilderControlledCommandExecutor,
  OUTPUT_PRIVATE_RETENTION_BYTES,
} = require('../electron/builder-controlled-command-executor.cjs');
const {
  BUILDER_CHECK_RUN_PROCESS_ADAPTER_VERSION,
  createBuilderCheckRunProcessAdapter,
} = require('../electron/builder-check-run-process-adapter.cjs');
const {
  createBuilderCheckRuntimeRegistry,
} = require('../electron/builder-check-runtime-identity.cjs');
const {
  createBuilderPackagedCheckRuntimeResolver,
} = require('../electron/builder-packaged-check-runtime-resolver.cjs');
const {
  createBuilderProgrammingRuntimeDescriptor,
  createBuilderProgrammingRuntimeRunContract,
} = require('../electron/builder-programming-runtime-contract.cjs');
const {
  createBuilderProjectSourceTree,
} = require('../electron/builder-project-source-tree.cjs');

function id(prefix) { return `${prefix}:${randomUUID()}`; }

function clock(commandTimeoutMs = null) {
  return Object.freeze({
    clock_version: 'builder-clock.v1',
    now_ms: () => Date.now(),
    set_timeout: (callback, delay) => setTimeout(
      callback,
      commandTimeoutMs !== null && delay === 2 * 60 * 1_000 ? commandTimeoutMs : delay,
    ),
    clear_timeout: (handle) => clearTimeout(handle),
  });
}

function fixture(scriptContent, testScript = 'node check.js', maxToolOutputBytes = 64 * 1_024) {
  const projectId = id('builder-project');
  const sourceTree = createBuilderProjectSourceTree({ files: [
    { path: 'package.json', content: JSON.stringify({ scripts: { test: testScript } }) },
    { path: 'check.js', content: scriptContent },
  ] });
  const descriptor = createBuilderProgrammingRuntimeDescriptor({
    runtime_kind: 'deepseek_harness',
    implementation_version: '1.0.0',
    capabilities: {
      streaming_text: true,
      reasoning_status: 'bounded_status',
      native_tool_calls: true,
      steering: 'queued',
      cancellation: 'cooperative',
      session_resume: 'runtime_local',
      context_compaction: true,
      parallel_read_tools: true,
    },
  });
  const runContract = createBuilderProgrammingRuntimeRunContract({
    runtime_descriptor: descriptor,
    admission: {
      project_id: projectId,
      conversation_id: `builder-conversation:${projectId.slice('builder-project:'.length)}:${randomUUID()}`,
      turn_id: id('builder-turn'),
      task_id: id('builder-task'),
      run_id: id('builder-run'),
      mode: 'build',
      workspace_ref: {
        ref_version: 'builder-programming-workspace-ref.v1',
        workspace_id: `builder-programming-workspace:${'2'.repeat(64)}`,
        source_tree_digest: sourceTree.source_tree_digest,
        writable: true,
      },
      provider_config_digest: `sha256:${'1'.repeat(64)}`,
      allowed_tools: ['read', 'search', 'edit', 'write', 'command', 'question'],
      limits: {
        max_steps: 20,
        max_duration_ms: 120_000,
        max_model_tokens: 100_000,
        max_tool_output_bytes: maxToolOutputBytes,
      },
      admitted_at_ms: Date.now(),
    },
    input: { message_id: id('builder-message'), text: 'Run the project check.' },
  });
  return { runContract, sourceTree };
}

function outputProcessAdapter(stdoutChunk) {
  return {
    adapter_version: BUILDER_CHECK_RUN_PROCESS_ADAPTER_VERSION,
    spawn_process() {
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      queueMicrotask(() => {
        child.emit('spawn');
        child.stdout.emit('data', stdoutChunk);
      });
      return child;
    },
    terminate_process_tree({ child }) {
      queueMicrotask(() => child.emit('close', null, 'SIGTERM'));
      return Promise.resolve(true);
    },
  };
}

async function setup(rawFixture, commandTimeoutMs = null, processAdapterOverride = null) {
  const tempRoot = fs.realpathSync.native(os.tmpdir());
  const root = fs.mkdtempSync(path.join(tempRoot, 'builder-controlled-command-test-'));
  const commandRoot = path.join(root, 'commands');
  fs.mkdirSync(commandRoot);
  const requests = [];
  const selectedClock = clock(commandTimeoutMs);
  let approvalService;
  approvalService = createBuilderControlledCommandApprovalService({
    now_ms: selectedClock.now_ms,
    on_approval_requested(request) {
      requests.push(request);
      setImmediate(() => approvalService.decide({
        run_id: request.run_id,
        approval_request_id: request.approval_request_id,
        decision: 'allow_once',
      }));
    },
  });
  const approval = await approvalService.request_approval({
    run_contract: rawFixture.runContract,
    source_tree: rawFixture.sourceTree,
    command: 'npm test',
    description: '验证当前项目',
  });
  const runtimeRegistry = createBuilderCheckRuntimeRegistry();
  const runtimeResolver = createBuilderPackagedCheckRuntimeResolver({
    runtime_registry: runtimeRegistry,
    launcher_path: process.execPath,
    worker_path: path.resolve(__dirname, '../electron/builder-packaged-check-script-worker.cjs'),
    clock: selectedClock,
  });
  const processAdapter = processAdapterOverride ?? createBuilderCheckRunProcessAdapter({
    spawn_process: childProcess.spawn,
    platform: process.platform,
    windows_root: process.platform === 'win32' ? path.normalize(process.env.SystemRoot) : null,
  });
  const output = [];
  const executor = createBuilderControlledCommandExecutor({
    approval_service: approvalService,
    runtime_resolver: runtimeResolver,
    runtime_registry: runtimeRegistry,
    process_adapter: processAdapter,
    command_root: commandRoot,
    clock: selectedClock,
    on_output: (event) => output.push(event),
  });
  return {
    root, commandRoot, approval, requests, output, executor,
    request: {
      execution_approval: approval,
      run_contract: rawFixture.runContract,
      source_tree: rawFixture.sourceTree,
      command_profile_id: approval.command_profile_id,
    },
  };
}

function cleanup(root) {
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
}

test('runs an approved digest-bound script, streams redacted output, and cleans its workspace', async () => {
  const input = fixture([
    "process.stdout.write('\\u001b[32mok\\u001b[0m\\n');",
    "process.stdout.write('API_KEY=do-not-publish\\n');",
    "process.stdout.write(process.cwd() + '\\n');",
  ].join('\n'));
  const harness = await setup(input);
  try {
    const result = await harness.executor.execute(harness.request);
    assert.equal(result.status, 'passed');
    assert.equal(result.exit_code, 0);
    assert.match(result.stdout_preview, /ok/u);
    assert.equal(result.stdout_preview.includes(String.fromCharCode(27)), false);
    assert.doesNotMatch(result.stdout_preview, /do-not-publish/u);
    assert.match(result.stdout_preview, /<project>/u);
    assert.equal(harness.output.length > 0, true);
    assert.equal(fs.readdirSync(harness.commandRoot).length, 0);
    await assert.rejects(harness.executor.execute(harness.request), /already used/u);
  } finally {
    cleanup(harness.root);
  }
});

test('preserves a non-zero exit code as a failed structured result', async () => {
  const harness = await setup(fixture("process.stderr.write('broken\\n'); process.exit(7);\n"));
  try {
    const result = await harness.executor.execute(harness.request);
    assert.equal(result.status, 'failed');
    assert.equal(result.exit_code, 7);
    assert.match(result.stderr_preview, /broken/u);
    assert.equal(fs.readdirSync(harness.commandRoot).length, 0);
  } finally {
    cleanup(harness.root);
  }
});

test('waits for process-tree confirmation after child close before settling cancellation', async () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  let confirmTermination;
  const processAdapter = {
    adapter_version: BUILDER_CHECK_RUN_PROCESS_ADAPTER_VERSION,
    spawn_process() {
      queueMicrotask(() => child.emit('spawn'));
      return child;
    },
    terminate_process_tree() {
      return new Promise((resolve) => { confirmTermination = resolve; });
    },
  };
  const input = fixture("process.stdout.write('started\\n'); setInterval(() => {}, 1_000);\n");
  const harness = await setup(input, null, processAdapter);
  try {
    let settled = false;
    const running = harness.executor.execute(harness.request).then((result) => {
      settled = true;
      return result;
    });
    const activeDeadline = Date.now() + 5_000;
    while (harness.executor.active_count() === 0 && Date.now() < activeDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(harness.executor.cancel({ run_id: input.runContract.admission.run_id }), true);
    child.emit('close', null, 'SIGTERM');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(settled, false);
    assert.equal(fs.readdirSync(harness.commandRoot).length, 1);

    confirmTermination(true);
    const result = await running;
    assert.equal(result.status, 'cancelled');
    assert.equal(settled, true);
    assert.equal(fs.readdirSync(harness.commandRoot).length, 0);
  } finally {
    cleanup(harness.root);
  }
});

test('times out an active command through the same process-tree settlement path', async () => {
  const harness = await setup(
    fixture("process.stdout.write('started\\n'); setInterval(() => {}, 1_000);\n"),
    30,
  );
  try {
    const result = await harness.executor.execute(harness.request);
    assert.equal(result.status, 'timed_out');
    assert.equal(result.exit_code, null);
    assert.equal(harness.executor.active_count(), 0);
    assert.equal(fs.readdirSync(harness.commandRoot).length, 0);
  } finally {
    cleanup(harness.root);
  }
});

test('retains a 10 MiB mixed output burst privately while public events and reads stay bounded', async () => {
  const chunkBytes = 64 * 1_024;
  const chunkCount = 80;
  const streamBytes = chunkBytes * chunkCount;
  const script = [
    `const stdoutChunk = \`${'O'.repeat(chunkBytes - 1)}\\n\`;`,
    `const stderrChunk = \`${'E'.repeat(chunkBytes - 1)}\\n\`;`,
    `for (let index = 0; index < ${chunkCount}; index += 1) {`,
    '  process.stdout.write(stdoutChunk);',
    '  process.stderr.write(stderrChunk);',
    '}',
  ].join('\n');
  const harness = await setup(fixture(script, 'node check.js', 12 * 1_024 * 1_024));
  try {
    const result = await harness.executor.execute(harness.request);
    const publicChunks = harness.output.flatMap((event) => event.chunks);
    const publicBytes = publicChunks.reduce(
      (total, chunk) => total + Buffer.byteLength(chunk.text, 'utf8'),
      0,
    );
    const publicStreamBytes = Object.fromEntries(['stdout', 'stderr'].map((stream) => [
      stream,
      publicChunks.filter((chunk) => chunk.stream === stream).reduce(
        (total, chunk) => total + Buffer.byteLength(chunk.text, 'utf8'),
        0,
      ),
    ]));
    assert.equal(publicChunks.every(
      (chunk) => Buffer.byteLength(chunk.text, 'utf8') <= 64 * 1_024,
    ), true);
    assert.equal(result.status, 'passed');
    assert.equal(result.output_truncated, true);
    assert.match(result.complete_output_ref, /^builder-command-output:[0-9a-f]{64}$/u);
    assert.equal(publicBytes, 256 * 1_024);
    assert.deepEqual(publicStreamBytes, { stdout: 128 * 1_024, stderr: 128 * 1_024 });

    const firstPage = harness.executor.read_output({
      complete_output_ref: result.complete_output_ref,
      stream: 'stdout',
      offset: 0,
      maximum_bytes: 64 * 1_024,
    });
    assert.equal(firstPage.total_bytes, streamBytes);
    assert.equal(firstPage.next_offset, 64 * 1_024);
    assert.equal(firstPage.eof, false);
    assert.equal(Buffer.from(firstPage.content_base64, 'base64').length, 64 * 1_024);

    const lastPage = harness.executor.read_output({
      complete_output_ref: result.complete_output_ref,
      stream: 'stderr',
      offset: streamBytes - 32,
      maximum_bytes: 64,
    });
    assert.equal(lastPage.total_bytes, streamBytes);
    assert.equal(lastPage.next_offset, streamBytes);
    assert.equal(lastPage.eof, true);
    assert.equal(Buffer.from(lastPage.content_base64, 'base64').at(-1), 0x0a);
  } finally {
    cleanup(harness.root);
  }
});

test('terminates output above the independent private retention hard limit', async () => {
  const oversizedOutput = Buffer.alloc(OUTPUT_PRIVATE_RETENTION_BYTES + 1_024 * 1_024, 88);
  const script = `process.stdout.write(Buffer.alloc(${oversizedOutput.length}, 88));\n`;
  const harness = await setup(fixture(script), null, outputProcessAdapter(oversizedOutput));
  try {
    const result = await harness.executor.execute(harness.request);
    assert.equal(result.status, 'output_exceeded');
    assert.equal(result.output_truncated, true);
    const lastPage = harness.executor.read_output({
      complete_output_ref: result.complete_output_ref,
      stream: 'stdout',
      offset: OUTPUT_PRIVATE_RETENTION_BYTES - 32,
      maximum_bytes: 64,
    });
    assert.equal(lastPage.total_bytes, OUTPUT_PRIVATE_RETENTION_BYTES);
    assert.equal(lastPage.next_offset, OUTPUT_PRIVATE_RETENTION_BYTES);
    assert.equal(lastPage.eof, true);
  } finally {
    cleanup(harness.root);
  }
});

test('rejects a retained output receipt whose opaque reference no longer matches', async () => {
  const harness = await setup(fixture("process.stdout.write('retained output\\n');\n"));
  try {
    const result = await harness.executor.execute(harness.request);
    const token = result.complete_output_ref.slice('builder-command-output:'.length);
    const receiptPath = path.join(harness.root, 'controlled-command-output-v1', `${token}.json`);
    const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    receipt.complete_output_ref = `builder-command-output:${'0'.repeat(64)}`;
    fs.writeFileSync(receiptPath, `${JSON.stringify(receipt)}\n`, 'utf8');
    assert.throws(() => harness.executor.read_output({
      complete_output_ref: result.complete_output_ref,
      stream: 'stdout',
      offset: 0,
      maximum_bytes: 64,
    }), /could not be run/u);
  } finally {
    cleanup(harness.root);
  }
});
