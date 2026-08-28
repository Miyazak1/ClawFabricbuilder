const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const scriptPath = path.join(
  __dirname,
  '..',
  'scripts',
  'verify-packaged-agent-browser-cancellation-canary.cjs',
);

test('packaged Agent Browser cancellation canary cancels an active bounded load', () => {
  const source = fs.readFileSync(scriptPath, 'utf8');
  const surfaceWaitIndex = source.indexOf('const surfaceVisible = surface.waitFor');
  const createProjectClickIndex = source.indexOf('await createProject.click()');
  const awaitSurfaceIndex = source.indexOf('await surfaceVisible;');
  const cancelClickIndex = source.indexOf('await cancel.click()');

  assert.match(source, /PACKAGED_AGENT_BROWSER_CANCEL/);
  assert.match(source, /name: 'New project', exact: true/);
  assert.ok(surfaceWaitIndex >= 0 && surfaceWaitIndex < createProjectClickIndex);
  assert.ok(awaitSurfaceIndex >= 0 && awaitSurfaceIndex < cancelClickIndex);
  assert.match(source, /Date\.now\(\) \+ 7000/);
  assert.doesNotMatch(source, /Date\.now\(\) \+ 15000/);
  assert.match(source, /loopbackWebContentsCount\(app\) !== 1/);
  assert.match(source, /agent_browser_cancel_loopback_leaked/);
  assert.match(source, /composer_recovered_after_cancel: true/);
  assert.match(source, /restart_no_agent_browser_surface: true/);
  assert.match(source, /restart_no_loopback_webcontents: true/);
});
