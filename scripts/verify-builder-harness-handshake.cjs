'use strict';

const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  createBuilderHarnessProcessAdapter,
} = require('../electron/builder-harness-process-adapter.cjs');
const {
  createBuilderHarnessProcessHost,
} = require('../electron/builder-harness-process-host.cjs');
const {
  createBuilderHarnessToolBrokerServer,
} = require('../electron/builder-harness-tool-broker-server.cjs');
const {
  resolveBuilderHarnessPackagedRuntime,
} = require('../electron/builder-harness-runtime-composition.cjs');
const {
  createBuilderProgrammingRuntimeDescriptor,
  createBuilderProgrammingRuntimeRunContract,
} = require('../electron/builder-programming-runtime-contract.cjs');
const {
  createBuilderProgrammingWorkspaceTools,
} = require('../electron/builder-programming-workspace-tools.cjs');
const {
  createBuilderProjectSourceTree,
} = require('../electron/builder-project-source-tree.cjs');

const UUID = '12345678-1234-4234-8234-123456789abc';

function fail(message) {
  throw new Error(message);
}

function harnessRuntimeRoot() {
  const value = process.env.BUILDER_HARNESS_RUNTIME_ROOT;
  if (typeof value !== 'string' || value.length === 0) {
    fail('Set BUILDER_HARNESS_RUNTIME_ROOT to a deployed Harness runtime closure.');
  }
  const resolved = path.resolve(value);
  const info = fs.statSync(resolved);
  if (!info.isDirectory() && !(info.isFile() && path.extname(resolved).toLowerCase() === '.asar')) {
    fail('BUILDER_HARNESS_RUNTIME_ROOT is not a runtime directory or ASAR.');
  }
  return resolved;
}

function canaryWorkspaceTools() {
  const tree = createBuilderProjectSourceTree({
    files: [{ path: 'README.md', content: '# Harness handshake canary\n' }],
  });
  const descriptor = createBuilderProgrammingRuntimeDescriptor({
    runtime_kind: 'deepseek_harness.v1',
    implementation_version: '1.0.0',
    capabilities: {
      streaming_text: true,
      reasoning_status: 'none',
      native_tool_calls: true,
      steering: 'none',
      cancellation: 'process',
      session_resume: 'none',
      context_compaction: true,
      parallel_read_tools: false,
    },
  });
  const runContract = createBuilderProgrammingRuntimeRunContract({
    runtime_descriptor: descriptor,
    admission: {
      project_id: `builder-project:${UUID}`,
      conversation_id: `builder-conversation:${UUID}`,
      turn_id: `builder-turn:${UUID}`,
      task_id: `builder-task:${UUID}`,
      run_id: `builder-run:${UUID}`,
      mode: 'build',
      workspace_ref: {
        ref_version: 'builder-programming-workspace-ref.v1',
        workspace_id: `builder-programming-workspace:${'b'.repeat(64)}`,
        source_tree_digest: tree.source_tree_digest,
        writable: true,
      },
      provider_config_digest: `sha256:${'a'.repeat(64)}`,
      allowed_tools: ['read', 'search', 'edit', 'write'],
      limits: {
        max_steps: 8,
        max_duration_ms: 30_000,
        max_model_tokens: 4_096,
        max_tool_output_bytes: 64 * 1_024,
      },
      admitted_at_ms: Date.now(),
    },
    input: {
      message_id: `builder-message:${UUID}`,
      text: 'Handshake only.',
    },
  });
  return createBuilderProgrammingWorkspaceTools({ run_contract: runContract, source_tree: tree });
}

async function main() {
  const runtimeRoot = harnessRuntimeRoot();
  const runtimeArtifact = resolveBuilderHarnessPackagedRuntime(runtimeRoot);
  const packagedBin = runtimeArtifact.packaged_bin;
  const config = path.resolve(__dirname, '../electron/harness/builder-coding-loop.cordis.yml');
  if (!fs.statSync(packagedBin).isFile()) fail('The Harness packaged JSON-RPC runtime was not built.');
  if (!fs.statSync(config).isFile()) fail('The Builder Harness config is missing.');

  const sessionRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'clawfabric-harness-handshake-'));
  const broker = createBuilderHarnessToolBrokerServer({ workspace_tools: canaryWorkspaceTools() });
  const access = await broker.start();
  const adapter = createBuilderHarnessProcessAdapter({
    spawn_process: childProcess.spawn,
    platform: process.platform,
    windows_root: process.platform === 'win32' ? path.resolve(process.env.SystemRoot) : null,
  });
  const environment = {
    PATH: process.env.PATH ?? path.dirname(process.execPath),
    ELECTRON_RUN_AS_NODE: '1',
    BUILDER_TOOL_BROKER_URL: access.endpoint,
    BUILDER_TOOL_BROKER_TOKEN: access.bearer_token,
    DEEPSEEK_API_KEY: 'builder-handshake-canary-no-provider-request',
    DSH_CWD: path.resolve(__dirname, '..'),
    DSH_SESSION_ROOT: sessionRoot,
    DSH_SYSTEM_PROMPT: 'Handshake only. Do not make a provider request.',
  };
  if (process.platform === 'win32' && process.env.SystemRoot) {
    environment.SystemRoot = process.env.SystemRoot;
  }
  const host = createBuilderHarnessProcessHost({
    process_adapter: adapter,
    launch: {
      executable: path.resolve(process.execPath),
      args: [packagedBin, config],
      cwd: path.resolve(__dirname, '..'),
      env: environment,
    },
    initialize: {
      cwd: path.resolve(__dirname, '..'),
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      max_tokens: 4_096,
    },
    on_notification() {},
    request_timeouts: {
      initialize_ms: 15_000,
      session_prompt_ms: null,
      shutdown_ms: 5_000,
    },
    shutdown_grace_ms: 5_000,
    eof_grace_ms: 1_000,
    set_timeout: setTimeout,
    clear_timeout: clearTimeout,
  });

  try {
    const identity = await host.start();
    await host.shutdown();
    process.stdout.write(`${JSON.stringify({
      canary: 'builder-harness-safe-handshake.v1',
      runtime_layout: runtimeArtifact.layout,
      identity,
      broker: broker.diagnostics(),
      host: host.diagnostics(),
      provider_request_made: false,
    }, null, 2)}\n`);
  } finally {
    try { await host.cancel(); } catch { /* host may already be closed */ }
    await broker.close();
    const expectedPrefix = `${path.resolve(os.tmpdir())}${path.sep}clawfabric-harness-handshake-`;
    if (path.resolve(sessionRoot).startsWith(expectedPrefix)) {
      fs.rmSync(sessionRoot, { recursive: true, force: true });
    }
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Harness handshake failed.'}\n`);
  process.exitCode = 1;
});
