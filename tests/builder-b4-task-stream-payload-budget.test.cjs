const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('task-stream byte accounting reuses plain-data clone stats instead of whole-result stringify', () => {
  const main = read('electron/builder-task-stream-ipc-adapter.cjs');
  assert.match(main, /function clonePlainDataWithStats\(value\)/);
  assert.match(main, /value:\s*clonePlainData\(value,\s*state\)/);
  assert.match(main, /'main\.task_stream\.ipc\.result_bytes'[\s\S]*resultClone\.utf8Bytes/);
  assert.doesNotMatch(main, /Buffer\.byteLength\(JSON\.stringify\(result\)/);

  const renderer = read('src/features/builder/infrastructure/builderDesktopTaskStreamPort.ts');
  assert.match(renderer, /function clonePlainDataWithStats\(value:\s*unknown\)/);
  assert.match(renderer, /utf8Bytes:\s*clonedState\.bytes/);
  assert.match(renderer, /'renderer\.task_stream\.read\.result_bytes',\s*clonedResult\.utf8Bytes/);
  assert.doesNotMatch(renderer, /JSON\.stringify\(wire\)/);
});

test('task-stream payload and cursor metrics remain allowlisted without private fields', () => {
  const mainTrace = read('electron/builder-performance-trace.cjs');
  for (const metric of [
    'main.task_stream.read.count',
    'main.task_stream.ipc.duration_ms',
    'main.task_stream.ipc.result_bytes',
    'main.task_stream.cursor.full_count',
    'main.task_stream.cursor.incremental_count',
    'main.task_stream.cursor.unchanged_count',
    'renderer.task_stream.read.duration_ms',
    'renderer.task_stream.read.result_bytes',
    'renderer.task_stream.cursor.full_count',
    'renderer.task_stream.cursor.incremental_count',
    'renderer.task_stream.cursor.unchanged_count',
  ]) {
    const source = metric.startsWith('main.')
      ? mainTrace
      : read('src/features/builder/application/builderPerformanceTrace.ts');
    assert.match(source, new RegExp(metric.replaceAll('.', '\\.'), 'u'), `missing ${metric}`);
  }
});

test('B4 documentation keeps payload hardening scoped to task-stream IPC', () => {
  const doc = read('docs/BUILDER_B4_TASK_STREAM_PAYLOAD_BUDGET_AND_CURSOR_HARDENING_2026_08_27.md');
  assert.match(doc, /measuring large\s+conversations does not itself add another large serialization cost/);
  assert.match(doc, /Neither layer stringifies the whole task-stream result/);
  assert.match(doc, /Browser\/Preview and Side Workspace remain independent capability surfaces/);
  assert.match(doc, /Dependency preparation remains A1-owned/);

  const readme = read('docs/README.md');
  assert.match(readme, /BUILDER_B4_TASK_STREAM_PAYLOAD_BUDGET_AND_CURSOR_HARDENING_2026_08_27\.md/);
});
