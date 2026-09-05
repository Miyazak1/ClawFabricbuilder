'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance: nodePerformance } = require('node:perf_hooks');
const { createBuilderGenerationIpcRuntime } = require('../electron/builder-generation-ipc-runtime.cjs');
const { DEFAULT_BUILDER_AGENT_ID } = require('../electron/builder-default-agent-bootstrap.cjs');
const { READ_AGENT_WORKBENCH_CHANNEL } = require('../electron/builder-workbench-ipc-adapter.cjs');
const { RENAME_AGENT_TASK_CHANNEL } = require('../electron/builder-agent-project-tree-ipc-adapter.cjs');
const { builderPerformanceTrace } = require('../electron/builder-performance-trace.cjs');
const { copySavedBuilderWorkspaceProfile } = require('./verify-deepseek-packaged-agent-history-e2e-canary.cjs');

async function measureHistory(sourcePath) {
  const prefix = 'builder-workbench-measure-';
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const realRoot = fs.realpathSync.native(root);
  let runtime;
  try {
    copySavedBuilderWorkspaceProfile({ mode: 'saved_profile', source_user_data_path: sourcePath }, { realPath: realRoot });
    builderPerformanceTrace.configure({ enabled: true, output_path: path.join(realRoot, 'trace.json') });
    const handlers = new Map();
    const webContents = { isDestroyed: () => false, send() {} };
    runtime = createBuilderGenerationIpcRuntime({
      fetchImpl: async () => { throw new Error('Network is forbidden in the history benchmark.'); },
      grantPermissionForExplicitApproval: async () => { throw new Error('Approvals are forbidden in the history benchmark.'); },
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler), removeHandler: (channel) => handlers.delete(channel) },
      mainWindowRef: () => ({ webContents, isDestroyed: () => false }),
      userDataPath: realRoot,
    });
    runtime.register();
    const invoke = (channel, request) => handlers.get(channel)({ sender: webContents }, request);
    const read = () => invoke(READ_AGENT_WORKBENCH_CHANNEL, { agent_id: DEFAULT_BUILDER_AGENT_ID, after_cursor: null, limit: 80 });
    let monitor;
    for (let attempt = 0; attempt < 300; attempt += 1) {
      monitor = (await read()).task_monitor;
      if (monitor.tasks.every((task) => task.status_label !== 'Loading task history')) break;
      await new Promise((resolve) => setImmediate(resolve));
    }
    assert.ok(monitor.tasks.length > 0);
    assert.ok(monitor.tasks.every((task) => task.status_label !== 'Loading task history'));
    const shape = (value) => value.tasks.map((task) => [task.task_address_id, task.state, task.latest_result?.result_id ?? null]).sort();
    const expected = shape(monitor);
    const durations = [];
    // Same-title writes invalidate exactly the same saved tasks in each comparison.
    for (let round = 0; round < 3; round += 1) {
      for (const task of monitor.tasks) {
        const start = nodePerformance.now();
        await invoke(RENAME_AGENT_TASK_CHANNEL, {
          agent_id: DEFAULT_BUILDER_AGENT_ID, project_id: task.project_id,
          task_address_id: task.task_address_id, title: task.title,
        });
        durations.push(nodePerformance.now() - start);
        let refreshed;
        for (let attempt = 0; attempt < 300; attempt += 1) {
          refreshed = (await read()).task_monitor;
          if (refreshed.tasks.every((item) => item.status_label !== 'Loading task history')) break;
          await new Promise((resolve) => setImmediate(resolve));
        }
        assert.deepEqual(shape(refreshed), expected);
      }
    }
    return { task_count: monitor.tasks.length, rounds: 3, states_preserved: true,
      invalidation_ms: { max: Math.max(...durations), total: durations.reduce((sum, value) => sum + value, 0) },
      trace: builderPerformanceTrace.snapshot() };
  } finally {
    runtime?.dispose();
    assert.equal(fs.realpathSync.native(root), realRoot);
    assert.equal(path.dirname(realRoot).toLowerCase(), fs.realpathSync.native(os.tmpdir()).toLowerCase());
    assert.ok(path.basename(realRoot).startsWith(prefix));
    fs.rmSync(realRoot, { recursive: true, force: true });
  }
}

module.exports = { measureHistory };
if (require.main === module) {
  const [source, output] = process.argv.slice(2);
  assert.ok(source && output && path.isAbsolute(source) && path.isAbsolute(output));
  measureHistory(source).then((result) => {
    fs.writeFileSync(output, JSON.stringify(result, null, 2));
    process.stdout.write(JSON.stringify({ task_count: result.task_count, invalidation_ms: result.invalidation_ms,
      metrics: result.trace.metrics.filter((metric) => metric.name.startsWith('main.workbench')) }) + '\n');
  }).catch((error) => { process.stderr.write(`${error.code ?? error.message}\n`); process.exitCode = 1; });
}
