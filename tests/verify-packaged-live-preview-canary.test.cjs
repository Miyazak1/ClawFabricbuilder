'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const {
  RESULT_VERSION,
  createLivePreviewCanaryProviderServer,
} = require('../scripts/verify-packaged-live-preview-canary.cjs');

const root = path.resolve(__dirname, '..');
const SOURCE_PATH = path.join(root, 'scripts', 'verify-packaged-live-preview-canary.cjs');
const PACKAGE_PATH = path.join(root, 'package.json');

async function request(server, marker, stream = false) {
  const response = await fetch(`${server.baseUrl}/chat/completions`, {
    body: JSON.stringify({
      messages: [
        { role: 'system', content: 'Return JSON.' },
        {
          role: 'user',
          content: JSON.stringify({
            instruction: marker,
            output_contract: { kind: marker },
          }),
        },
      ],
      model: 'local-live-preview-canary-model',
      stream,
    }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });
  assert.equal(response.status, 200);
  return response.text();
}

test('live preview canary provider returns local canvas and module source', async (t) => {
  const server = await createLivePreviewCanaryProviderServer();
  t.after(async () => {
    await server.close();
  });
  const text = await request(server, 'builder_code_change_operations');
  const payload = JSON.parse(JSON.parse(text).choices[0].message.content);
  assert.equal(payload.kind, 'builder_code_change_operations');
  const operations = payload.operations.map((operation) => [operation.path, operation.content]);
  assert.equal(operations.some(([file]) => file === 'index.html'), true);
  assert.equal(operations.some(([file]) => file === 'main.js'), true);
  assert.match(JSON.stringify(payload), /live-canary-canvas/u);
  assert.match(JSON.stringify(payload), /__clawfabricLivePreviewCanary/u);
  assert.equal(server.snapshot().some((item) => item.response_kind === 'builder_code_change_operations'), true);
});

test('live preview canary script is independent from release and verifies browser evidence', () => {
  const source = fs.readFileSync(SOURCE_PATH, 'utf8');
  const packageJson = JSON.parse(fs.readFileSync(PACKAGE_PATH, 'utf8'));
  assert.equal(
    packageJson.scripts['verify:packaged-live-preview'],
    'node scripts/verify-packaged-live-preview-canary.cjs',
  );
  assert.doesNotMatch(
    packageJson.scripts['verify:release'],
    /verify:packaged-live-preview/u,
  );
  assert.match(source, new RegExp(RESULT_VERSION.replaceAll('.', String.raw`\.`), 'u'));
  assert.match(source, /app\.evaluate\(async \(\{ webContents \}\)/u);
  assert.match(source, /webContents\.getAllWebContents\(\)/u);
  assert.match(source, /executeJavaScript/u);
  assert.match(source, /preview_url_loopback_digest/u);
  assert.match(source, /canvas_nonblank:\s*true/u);
  assert.match(source, /javascript_executed:\s*true/u);
  assert.match(source, /release_gate_integration:\s*['"]not_in_verify_release['"]/u);
  assert.doesNotMatch(source, /providerSettings\.replaceCurrent|projectWorkspace\.saveDraft/u);
  assert.doesNotMatch(source, /source_tree_from_renderer|renderer_source_tree|Authorization|Bearer/u);
});
