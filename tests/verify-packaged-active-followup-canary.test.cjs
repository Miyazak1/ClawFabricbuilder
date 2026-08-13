'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const {
  RESULT_VERSION,
} = require('../scripts/verify-packaged-active-followup-canary.cjs');
const {
  createLocalCanaryProviderServer,
} = require('../scripts/verify-packaged-canary-default.cjs');

const root = path.resolve(__dirname, '..');
const SOURCE_PATH = path.join(root, 'scripts', 'verify-packaged-active-followup-canary.cjs');
const PACKAGE_PATH = path.join(root, 'package.json');

function codeChangeRequest() {
  return fetch;
}

test('local canary provider can defer and release one code-change response', async (t) => {
  const server = await createLocalCanaryProviderServer({ deferCodeChangeResponses: 1 });
  t.after(async () => {
    await server.close();
  });
  const responsePromise = codeChangeRequest()(`${server.baseUrl}/chat/completions`, {
    body: JSON.stringify({
      messages: [{
        role: 'user',
        content: JSON.stringify({
          instruction: 'Build a timer.',
          output_contract: { kind: 'builder_code_change_operations' },
        }),
      }],
      model: 'local-canary-model',
    }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });
  while (server.pendingResponseCount() === 0) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(server.snapshot()[0].response_kind, 'builder_code_change_operations');
  assert.equal(server.releaseNext(), true);
  const response = await responsePromise;
  assert.equal(response.status, 200);
  assert.equal(server.pendingResponseCount(), 0);
});

test('active follow-up canary drives the packaged composer and verifies durable consumption', () => {
  const source = fs.readFileSync(SOURCE_PATH, 'utf8');
  const packageJson = JSON.parse(fs.readFileSync(PACKAGE_PATH, 'utf8'));
  assert.equal(
    packageJson.scripts['verify:packaged-active-followup'],
    'node scripts/verify-packaged-active-followup-canary.cjs',
  );
  assert.match(
    packageJson.scripts['verify:packaged-experience'],
    /verify:packaged-active-followup/u,
  );
  assert.doesNotMatch(
    packageJson.scripts['verify:release'],
    /verify:packaged-active-followup/u,
  );
  assert.match(source, new RegExp(RESULT_VERSION.replaceAll('.', String.raw`\.`), 'u'));
  assert.match(source, /deferCodeChangeResponses:\s*1/u);
  assert.match(source, /deferCodeChangeResponsesAfter:\s*1/u);
  assert.match(source, /aria-label['"]\) === ['"]Add context/u);
  assert.match(source, /message_kind === ['"]queued_followup['"]/u);
  assert.match(source, /item_kind === ['"]queued_followup_consumed['"]/u);
  assert.match(source, /durable_queued_followup_recorded:\s*true/u);
  assert.match(source, /queued_followup_consumed:\s*true/u);
  assert.match(source, /continuation_provider_request_observed:\s*true/u);
  assert.match(source, /release_gate_integration:\s*['"]not_in_verify_release['"]/u);
  assert.doesNotMatch(
    source,
    /codeGenerator\.(?:generate|continueDraft|submit|queueFollowup)|projectWorkspace\.saveDraft/u,
  );
  assert.doesNotMatch(source, /source_tree|Authorization|Bearer/u);
});
