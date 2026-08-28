const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function sliceBetween(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  assert.notEqual(start, -1, `missing ${startNeedle}`);
  const end = source.indexOf(endNeedle, start);
  assert.notEqual(end, -1, `missing ${endNeedle}`);
  return source.slice(start, end);
}

test('pending draft restore waits for an active selected conversation read before probing', () => {
  const source = read('src/app/BuilderApp.tsx');
  const body = sliceBetween(
    source,
    'const restorePendingDraftFromActivity = useCallback((',
    'useLayoutEffect(() => {',
  );
  const busyGuardIndex = body.indexOf('currentConversation.busy');
  const probeIndex = body.indexOf('conversation.probe(visibleProjectId, taskAddressId)');

  assert.notEqual(busyGuardIndex, -1, 'restore activity should detect active selected conversation reads');
  assert.notEqual(probeIndex, -1, 'restore activity should keep probe fallback for unavailable loaded activity');
  assert.ok(
    busyGuardIndex < probeIndex,
    'restore activity should reschedule before opening a parallel probe read',
  );
  assert.match(
    body,
    /currentConversation\.busy[\s\S]*currentConversation\.project_id\s*===\s*visibleProjectId[\s\S]*currentConversation\.task_address_id\s*===\s*taskAddressId[\s\S]*setTimeout\(retryLoad,\s*PENDING_DRAFT_RESTORE_RETRY_DELAY_MS\);[\s\S]*return;/,
  );
});

test('B3 keeps task-stream read cost measurable without content fields', () => {
  const trace = read('src/features/builder/application/builderPerformanceTrace.ts');
  for (const metric of [
    'renderer.task_stream.read.duration_ms',
    'renderer.task_stream.read.result_bytes',
    'renderer.task_stream.cursor.full_count',
    'renderer.task_stream.cursor.incremental_count',
    'renderer.task_stream.cursor.unchanged_count',
    'renderer.task_stream.cursor.legacy_fallback_count',
    'renderer.task_stream.changed.coalesced_count',
    'renderer.task_stream.controller_publish_count',
  ]) {
    assert.match(trace, new RegExp(metric.replaceAll('.', '\\.'), 'u'), `missing trace metric ${metric}`);
  }
  assert.match(trace, /content_fields_recorded:\s*false/);
  assert.match(trace, /identifiers_recorded:\s*false/);

  const port = read('src/features/builder/infrastructure/builderDesktopTaskStreamPort.ts');
  assert.match(port, /measureBuilderPerformanceAsync\('renderer\.task_stream\.read\.duration_ms'/);
  assert.match(port, /'renderer\.task_stream\.read\.result_bytes'/);
});

test('B3 documentation records the broader stabilization boundary', () => {
  const doc = read('docs/BUILDER_B3_CHAT_RUNTIME_PERFORMANCE_STABILIZATION_2026_08_27.md');
  assert.match(doc, /send -> generate\/run -> stream -> terminal facts/);
  assert.match(doc, /Pending draft restore waits for an in-flight same-project\/same-task/);
  assert.match(doc, /Browser\/Preview status reads are independent capability reads/);
  assert.match(doc, /Dependency preparation remains A1-owned/);

  const readme = read('docs/README.md');
  assert.match(readme, /BUILDER_B3_CHAT_RUNTIME_PERFORMANCE_STABILIZATION_2026_08_27\.md/);
});
