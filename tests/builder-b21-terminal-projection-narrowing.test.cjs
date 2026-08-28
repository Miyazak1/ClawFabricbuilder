const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('conversation controller cancels queued durable refreshes for foreground reads', () => {
  const source = read('src/features/builder/application/builderConversationController.ts');
  const runStart = source.indexOf('function run(');
  assert.notEqual(runStart, -1, 'conversation controller should define run');
  const runEnd = source.indexOf('function handleChangedEvent', runStart);
  assert.notEqual(runEnd, -1, 'run should appear before handleChangedEvent');
  const body = source.slice(runStart, runEnd);

  assert.match(
    body,
    /if\s*\(\s*active\s*!==\s*null\s*\)\s*return\s+active;\s*if\s*\(\s*!background\s*\)\s*\{[\s\S]*clearChangedRefreshTimer\(\);[\s\S]*pendingChanged\s*=\s*false;/,
    'foreground reads should cancel queued durable changed refreshes before issuing their own read',
  );
});

test('B2.1 documentation records projection narrowing without moving unrelated surfaces', () => {
  const doc = read('docs/BUILDER_B21_TERMINAL_SETTLEMENT_PROJECTION_NARROWING_2026_08_27.md');
  assert.match(doc, /foreground controller reads cancel any queued durable/);
  assert.match(doc, /Browser\/Preview status reads are not driven by terminal settlement/);
  assert.match(doc, /Side Workspace file tree\/content reads remain explicit/);

  const readme = read('docs/README.md');
  assert.match(readme, /BUILDER_B21_TERMINAL_SETTLEMENT_PROJECTION_NARROWING_2026_08_27\.md/);
});
