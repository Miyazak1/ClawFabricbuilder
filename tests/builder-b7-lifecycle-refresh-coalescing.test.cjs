const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('BuilderApp drains lifecycle refreshes through one coalesced queue', () => {
  const source = read('src/app/BuilderApp.tsx');
  assert.match(source, /const lifecycleRefreshInFlightRef = useRef<Promise<void> \| null>\(null\);/);
  assert.match(source, /const lifecycleRefreshQueuedRef = useRef\(false\);/);
  assert.match(source, /const lifecycleRefreshNeedsWorkbenchRef = useRef\(false\);/);
  assert.match(source, /while \(lifecycleRefreshQueuedRef\.current\)/);
  assert.match(source, /if \(lifecycleRefreshInFlightRef\.current !== null\) return lifecycleRefreshInFlightRef\.current;/);
  assert.match(source, /refreshCatalog[\s\S]*refreshLifecycleViews\(\{ agentWorkbench: false \}\)/);
});

test('B7 documentation keeps lifecycle coalescing separate from task-stream and Browser', () => {
  const doc = read('docs/BUILDER_B7_LIFECYCLE_REFRESH_COALESCING_2026_08_27.md');
  assert.match(doc, /one App-owned queue/);
  assert.match(doc, /Workbench refresh is opt-in/);
  assert.match(doc, /does not change Browser\/Preview WebContents behavior/);
  assert.match(doc, /known-task\s+terminal settlement still refreshes conversation activity directly/);

  const readme = read('docs/README.md');
  assert.match(readme, /BUILDER_B7_LIFECYCLE_REFRESH_COALESCING_2026_08_27\.md/);
});
