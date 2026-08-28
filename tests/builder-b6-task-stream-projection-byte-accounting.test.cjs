const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('Main task-stream projection byte metrics avoid whole-result stringify', () => {
  const source = read('electron/builder-conversation-main-service.cjs');
  assert.match(source, /function projectionUtf8Bytes\(value\)/);
  assert.match(source, /function accountProjectionBytes\(value,\s*state/);
  assert.match(source, /'main\.task_stream\.projection\.result_bytes'[\s\S]*projectionUtf8Bytes\(projected\)/);
  assert.doesNotMatch(source, /Buffer\.byteLength\(JSON\.stringify\(projected\)/);
});

test('B6 documentation keeps projection accounting scoped below IPC authority', () => {
  const doc = read('docs/BUILDER_B6_TASK_STREAM_PROJECTION_BYTE_ACCOUNTING_2026_08_27.md');
  assert.match(doc, /no longer calls\s+`JSON\.stringify\(projected\)`/);
  assert.match(doc, /task-stream IPC adapter still owns the exact plain-data validation/);
  assert.match(doc, /B7 should coalesce lifecycle refreshes/);

  const readme = read('docs/README.md');
  assert.match(readme, /BUILDER_B6_TASK_STREAM_PROJECTION_BYTE_ACCOUNTING_2026_08_27\.md/);
});
