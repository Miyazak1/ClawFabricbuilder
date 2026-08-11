'use strict';

const nodeCrypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { _electron: electron } = require('playwright-core');

const {
  CANARY_INPUT_VERSION,
  PACKAGED_CANARY_USER_DATA_PREFIX,
  SELECTORS,
  approveCurrentProjectWriteIfRequested,
  captureGuardedUserDataRoot,
  createArtifactGate,
  createCanaryProjectRoot,
  fillProviderSettingsViaUi,
  generateProjectViaUi,
  readSanitizedBridgeEvidence,
  sanitizeLaunchEnvironment,
} = require('./verify-packaged-canary.cjs');

const DEFAULT_EXECUTABLE = path.join(__dirname, '..', 'release', 'win-unpacked', 'ClawFabric Builder.exe');
const RESULT_VERSION = 'builder-packaged-live-preview-canary-result.v1';
const LIVE_PREVIEW_IDEA = 'Make a small browser canvas demo.';
const LIVE_PREVIEW_UPDATE_INSTRUCTION = 'Add an animated canvas preview marker for the browser canary.';

function fail(code, diagnostic = undefined) {
  const error = new Error(code);
  error.code = code;
  if (diagnostic !== undefined) error.diagnostic = diagnostic;
  throw error;
}

function providerMessage(content) {
  return JSON.stringify({
    choices: [{
      finish_reason: 'stop',
      message: { role: 'assistant', content },
    }],
  });
}

function providerStream(content) {
  return [
    'data: {"choices":[{"finish_reason":null,"delta":{"role":"assistant"}}]}',
    '',
    `data: ${JSON.stringify({ choices: [{ finish_reason: null, delta: { content } }] })}`,
    '',
    'data: {"choices":[{"finish_reason":"stop","delta":{}}]}',
    '',
    'data: [DONE]',
    '',
  ].join('\n');
}

function explanationOutput() {
  return JSON.stringify({
    kind: 'builder_conversation_explanation',
    title: 'Live preview canary answer',
    summary: 'Answers without changing files.',
    explanation: 'This local canary answer verifies chat flow without changing project files.',
  });
}

function planOutput() {
  return JSON.stringify({
    kind: 'builder_project_plan_proposal',
    title: 'Live preview canary plan',
    summary: 'Prepare a bounded canvas demo before starting the browser preview.',
    steps: [
      {
        title: 'Create the canvas entry',
        purpose: 'Provide a local HTML entry that the preview browser can load.',
        expected_change: 'A draft can include index.html and main.js.',
      },
      {
        title: 'Start browser preview',
        purpose: 'Verify the packaged app can attach a live local preview.',
        expected_change: 'The preview status can become ready without saving a version.',
      },
    ],
  });
}

function codeChangeOutput(index) {
  const title = index <= 1 ? 'Canvas Canary' : 'Canvas Canary Updated';
  const accent = index <= 1 ? '#1b5e5a' : '#8a4d16';
  return JSON.stringify({
    kind: 'builder_code_change_operations',
    title: 'Canvas canary',
    summary: 'A local canvas page for live preview verification.',
    operations: [
      {
        operation: 'upsert',
        path: 'index.html',
        content: [
          '<!doctype html>',
          '<html lang="en">',
          '<head>',
          '  <meta charset="utf-8">',
          '  <meta name="viewport" content="width=device-width, initial-scale=1">',
          `  <title>${title}</title>`,
          '  <link rel="stylesheet" href="./style.css">',
          '  <script type="module" src="./main.js"></script>',
          '</head>',
          '<body>',
          '  <main>',
          `    <h1>${title}</h1>`,
          '    <p>Packaged live preview should execute this local module.</p>',
          '    <canvas id="live-canary-canvas" width="220" height="120"></canvas>',
          '  </main>',
          '</body>',
          '</html>',
          '',
        ].join('\n'),
      },
      {
        operation: 'upsert',
        path: 'style.css',
        content: [
          ':root { color-scheme: light; }',
          'body { margin: 0; font-family: Arial, sans-serif; background: #f7f8f1; color: #20241f; }',
          'main { min-height: 100vh; display: grid; place-items: center; align-content: center; gap: 16px; }',
          'h1 { margin: 0; font-size: 34px; }',
          'p { margin: 0; font-size: 16px; }',
          'canvas { border: 1px solid #ccd4c6; border-radius: 6px; background: white; }',
          '',
        ].join('\n'),
      },
      {
        operation: 'upsert',
        path: 'main.js',
        content: [
          "globalThis.__clawfabricLivePreviewCanary = 'module-executed';",
          "const canvas = document.querySelector('#live-canary-canvas');",
          "const context = canvas.getContext('2d');",
          "context.fillStyle = '#ffffff';",
          'context.fillRect(0, 0, canvas.width, canvas.height);',
          `context.fillStyle = '${accent}';`,
          'context.fillRect(18, 18, 82, 64);',
          "context.fillStyle = '#2b3b32';",
          "context.font = '18px sans-serif';",
          "context.fillText('Live', 120, 54);",
          '',
        ].join('\n'),
      },
      {
        operation: 'upsert',
        path: 'package.json',
        content: `${JSON.stringify({
          name: 'clawfabric-live-preview-canary',
          private: true,
          scripts: { test: 'node --check main.js' },
        }, null, 2)}\n`,
      },
    ],
  });
}

function outputForRequest(body, state) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const messageContents = messages
    .map((message) => (typeof message?.content === 'string' ? message.content : ''))
    .filter((content) => content.length > 0);
  if (messageContents.some((content) => content.includes('builder_semantic_route_classification'))) {
    return JSON.stringify({
      kind: 'builder_semantic_route_classification',
      route: 'build',
      confidence: 'high',
      reason_code: 'requests_source_change',
    });
  }
  for (const content of messageContents) {
    try {
      const parsed = JSON.parse(content);
      const kind = parsed?.output_contract?.kind ?? null;
      if (kind === 'builder_project_plan_proposal') return planOutput();
      if (kind === 'builder_conversation_explanation') return explanationOutput();
      if (kind === 'builder_code_change_operations') {
        state.codeChangeCount += 1;
        return codeChangeOutput(state.codeChangeCount);
      }
    } catch {
      // Prompt repair messages are plain text; fall through to marker matching.
    }
  }
  const promptText = messageContents.join('\n');
  if (promptText.includes('builder_project_plan_proposal')) return planOutput();
  if (promptText.includes('builder_conversation_explanation')) return explanationOutput();
  state.codeChangeCount += 1;
  return codeChangeOutput(state.codeChangeCount);
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        request.destroy();
        reject(new Error('live preview canary request too large'));
      }
    });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
}

function closeServer(server) {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

async function createLivePreviewCanaryProviderServer() {
  const state = { codeChangeCount: 0, requests: [] };
  const server = http.createServer(async (request, response) => {
    try {
      if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
        response.writeHead(404, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: 'not found' }));
        return;
      }
      const rawBody = await readRequestBody(request);
      const body = JSON.parse(rawBody);
      const content = outputForRequest(body, state);
      let responseKind = null;
      try {
        responseKind = JSON.parse(content)?.kind ?? null;
      } catch {
        responseKind = null;
      }
      state.requests.push(Object.freeze({
        message_count: Array.isArray(body.messages) ? body.messages.length : null,
        response_kind: typeof responseKind === 'string' ? responseKind : null,
        stream: body.stream === true,
      }));
      if (body.stream === true) {
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        response.end(providerStream(content));
        return;
      }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(providerMessage(content));
    } catch {
      response.writeHead(500, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'local live preview canary provider failed' }));
    }
  });
  await listen(server);
  const address = server.address();
  if (!address || typeof address !== 'object' || !Number.isSafeInteger(address.port)) {
    await closeServer(server);
    fail('live_preview_provider_failed');
  }
  return Object.freeze({
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    close: () => closeServer(server),
    snapshot: () => Object.freeze(state.requests.map((item) => ({ ...item }))),
  });
}

function makeUserDataRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), PACKAGED_CANARY_USER_DATA_PREFIX));
}

function cleanupUserDataRoot(userDataPath) {
  if (typeof userDataPath !== 'string') return;
  const resolved = path.resolve(userDataPath);
  if (
    path.dirname(resolved) !== path.resolve(os.tmpdir())
    || !path.basename(resolved).startsWith(PACKAGED_CANARY_USER_DATA_PREFIX)
  ) return;
  fs.rmSync(resolved, { force: true, recursive: true });
}

function onlyCatalogProject(evidence, expectedRevisionNumber) {
  const project = evidence?.catalog?.projects?.[0] ?? null;
  if (
    evidence?.catalog?.projects?.length !== 1
    || project === null
    || project.revision_number !== expectedRevisionNumber
    || typeof project.project_id !== 'string'
  ) fail('live_preview_project_evidence_failed', { catalog: evidence?.catalog ?? null });
  return project;
}

async function createUnsavedDraftViaUi(page, instruction) {
  await page.locator(SELECTORS.idea).fill(instruction);
  await page.locator(SELECTORS.submitTurn).click();
  await approveCurrentProjectWriteIfRequested(page);
  const draftReady = page.locator(SELECTORS.unsavedDraft)
    .getByText('Unsaved draft', { exact: true })
    .waitFor({ state: 'visible', timeout: 120_000 })
    .then(() => 'draft_ready', () => 'draft_timeout');
  const alertReady = page.getByRole('alert')
    .waitFor({ state: 'visible', timeout: 120_000 })
    .then(() => 'alert_ready', () => 'alert_timeout');
  const outcome = await Promise.race([draftReady, alertReady]);
  if (outcome !== 'draft_ready') {
    fail('live_preview_update_draft_failed', {
      alert_text: await page.getByRole('alert').textContent().catch(() => null),
      composer_status: await page.locator(SELECTORS.composerStatus).textContent().catch(() => null),
      project_status: await page.locator(SELECTORS.projectPage).
        getAttribute('data-builder-project-status').catch(() => null),
    });
  }
  await page.locator(SELECTORS.saveVersion).waitFor({ state: 'visible', timeout: 30_000 });
  return Object.freeze({ unsaved_draft_observed: true });
}

async function waitForButtonEnabled(page, selector, code) {
  const button = page.locator(selector).first();
  await button.waitFor({ state: 'visible', timeout: 30_000 });
  try {
    await page.waitForFunction((targetSelector) => {
      /* global document, HTMLButtonElement */
      const node = document.querySelector(targetSelector);
      return node instanceof HTMLButtonElement && node.disabled === false;
    }, selector, { timeout: 30_000 });
  } catch {
    fail(code, {
      text: await button.textContent().catch(() => null),
      disabled: await button.isDisabled().catch(() => null),
    });
  }
}

async function waitForLiveStatus(page, status, code) {
  const selector = `[data-builder-live-preview-panel="true"][data-builder-live-preview-status="${status}"]`;
  try {
    await page.locator(selector).waitFor({ state: 'visible', timeout: 45_000 });
  } catch {
    fail(code, {
      live_panel_text: await page.locator('[data-builder-live-preview-panel="true"]').
        textContent().catch(() => null),
      live_status: await page.locator('[data-builder-live-preview-panel="true"]').
        getAttribute('data-builder-live-preview-status').catch(() => null),
    });
  }
}

async function readMainProcessLivePreviewEvidence(app) {
  return app.evaluate(async ({ webContents }) => {
    const candidates = webContents.getAllWebContents()
      .filter((item) => !item.isDestroyed())
      .map((item) => ({
        id: item.id,
        title: item.getTitle(),
        url: item.getURL(),
      }))
      .filter((item) => /^http:\/\/127\.0\.0\.1:\d+\//u.test(item.url));
    const selected = candidates[0] ?? null;
    let canvasEvidence = null;
    if (selected !== null) {
      const selectedContents = webContents.getAllWebContents()
        .find((item) => item.id === selected.id);
      if (selectedContents) {
        canvasEvidence = await selectedContents.executeJavaScript(`
          (async () => {
            const originalHref = location.href;
            const canvas = document.querySelector('#live-canary-canvas');
            if (!(canvas instanceof HTMLCanvasElement)) {
              return { canvas_present: false };
            }
            const context = canvas.getContext('2d');
            const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
            let nonblank = 0;
            for (let index = 0; index < pixels.length; index += 4) {
              if (
                pixels[index] !== 255
                || pixels[index + 1] !== 255
                || pixels[index + 2] !== 255
                || pixels[index + 3] !== 255
              ) nonblank += 1;
            }
            let external_fetch_blocked = false;
            try {
              const controller = new AbortController();
              const timer = setTimeout(() => controller.abort(), 1000);
              await fetch('https://example.com/clawfabric-live-preview-canary', {
                cache: 'no-store',
                signal: controller.signal,
              });
              clearTimeout(timer);
            } catch {
              external_fetch_blocked = true;
            }
            const opened = window.open('https://example.com/clawfabric-live-preview-popup');
            const external_window_open_blocked = opened === null;
            try {
              if (opened !== null) opened.close();
            } catch {
              // The preview policy should deny windows; ignore closed proxy quirks.
            }
            const link = document.createElement('a');
            link.href = 'https://example.com/clawfabric-live-preview-navigation';
            link.textContent = 'external navigation canary';
            document.body.append(link);
            link.click();
            await new Promise((resolve) => setTimeout(resolve, 250));
            return {
              canvas_present: true,
              canvas_width: canvas.width,
              canvas_height: canvas.height,
              canary_marker: globalThis.__clawfabricLivePreviewCanary ?? null,
              document_title: document.title,
              external_fetch_blocked,
              external_navigation_blocked: location.href === originalHref,
              external_window_open_blocked,
              nonblank_pixel_count: nonblank,
            };
          })()
        `, true);
      }
    }
    return {
      preview_webcontents_count: candidates.length,
      preview_url_loopback: selected?.url ?? null,
      canvas: canvasEvidence,
    };
  });
}

async function waitForMainProcessLivePreviewEvidence(app) {
  const deadline = Date.now() + 45_000;
  let evidence = null;
  while (Date.now() < deadline) {
    evidence = await readMainProcessLivePreviewEvidence(app).catch(() => null);
    if (
      evidence !== null
      && evidence.preview_webcontents_count >= 1
      && /^http:\/\/127\.0\.0\.1:\d+\//u.test(evidence.preview_url_loopback ?? '')
      && evidence.canvas?.canvas_present === true
      && evidence.canvas?.canary_marker === 'module-executed'
      && evidence.canvas?.external_fetch_blocked === true
      && evidence.canvas?.external_navigation_blocked === true
      && evidence.canvas?.external_window_open_blocked === true
      && evidence.canvas?.nonblank_pixel_count > 0
    ) return evidence;
    await delay(250);
  }
  fail('live_preview_webcontents_evidence_failed', evidence);
}

async function verifyLivePreviewControls(page, app) {
  await page.locator(SELECTORS.artifactTabPreview).click().catch(() => {});
  const staticPreviewVisible = await page.locator(SELECTORS.preview).isVisible().catch(() => false);
  await waitForButtonEnabled(page, '[data-builder-preview-mode="live"]', 'live_preview_mode_disabled');
  await page.locator('[data-builder-preview-mode="live"]').first().click();
  await waitForButtonEnabled(page, '[data-builder-live-preview-start="true"]', 'live_preview_start_disabled');
  await page.locator('[data-builder-live-preview-start="true"]').first().click();
  await waitForLiveStatus(page, 'ready', 'live_preview_not_ready');
  const mainEvidence = await waitForMainProcessLivePreviewEvidence(app);
  await waitForButtonEnabled(page, '[data-builder-live-preview-reload="true"]', 'live_preview_reload_disabled');
  await page.locator('[data-builder-live-preview-reload="true"]').first().click();
  await waitForLiveStatus(page, 'ready', 'live_preview_reload_not_ready');
  const blockedSummary = page.locator('[data-builder-live-preview-blocked-count="true"]').first();
  await blockedSummary.waitFor({ state: 'visible', timeout: 20_000 }).catch(async () => {
    fail('live_preview_blocked_count_not_visible', {
      live_panel_text: await page.locator('[data-builder-live-preview-panel="true"]').
        first().textContent().catch(() => null),
    });
  });
  const blockedSummaryText = await blockedSummary.textContent();
  if (!/Blocked\s+[1-9]\d*\s+unsafe preview request/u.test(blockedSummaryText ?? '')) {
    fail('live_preview_blocked_count_invalid', { blockedSummaryText });
  }
  await waitForButtonEnabled(page, '[data-builder-live-preview-stop="true"]', 'live_preview_stop_disabled');
  await page.locator('[data-builder-live-preview-stop="true"]').first().click();
  await waitForLiveStatus(page, 'stopped', 'live_preview_stop_not_observed');
  const stoppedEvidence = await readMainProcessLivePreviewEvidence(app);
  if ((stoppedEvidence?.preview_webcontents_count ?? 1) !== 0) {
    fail('live_preview_stop_did_not_dispose', stoppedEvidence);
  }
  return Object.freeze({
    canvas_nonblank: true,
    external_fetch_blocked: true,
    external_navigation_blocked: true,
    external_window_open_blocked: true,
    javascript_executed: true,
    loopback_webcontents_observed: true,
    preview_url_loopback_digest: `sha256:${nodeCrypto.createHash('sha256').
      update(mainEvidence.preview_url_loopback).digest('hex')}`,
    reload_ready_observed: true,
    renderer_block_count_visible: true,
    static_fallback_visible_before_live: staticPreviewVisible,
    stop_disposed_webcontents: true,
  });
}

async function run() {
  const executablePath = process.argv[2] ?? DEFAULT_EXECUTABLE;
  const providerServer = await createLivePreviewCanaryProviderServer();
  const userDataPath = makeUserDataRoot();
  const userDataRoot = captureGuardedUserDataRoot(userDataPath, fs, os);
  const projectRootPath = createCanaryProjectRoot(userDataRoot, fs, os);
  const gate = createArtifactGate();
  let app = null;
  let step = 'launch';
  try {
    step = 'launch';
    app = await electron.launch({
      args: [],
      executablePath,
      env: sanitizeLaunchEnvironment(process.env, userDataPath, projectRootPath),
    });
    step = 'first_window';
    const page = await app.firstWindow();
    step = 'provider_settings';
    await fillProviderSettingsViaUi(page, Object.freeze({
      base_url: providerServer.baseUrl,
      credential: 'local-live-preview-canary-secret',
      max_tokens: 8192,
      model: 'local-live-preview-canary-model',
      temperature: 0.2,
      timeout_ms: 30000,
    }), gate);
    step = 'generate_saved_baseline';
    await generateProjectViaUi(page, LIVE_PREVIEW_IDEA);
    step = 'read_saved_evidence';
    const savedEvidence = await readSanitizedBridgeEvidence(page);
    const savedProject = onlyCatalogProject(savedEvidence, 1);
    step = 'create_unsaved_update_draft';
    await createUnsavedDraftViaUi(page, LIVE_PREVIEW_UPDATE_INSTRUCTION);
    step = 'verify_live_preview';
    const livePreview = await verifyLivePreviewControls(page, app);
    const result = Object.freeze({
      result_version: RESULT_VERSION,
      executable_path: executablePath,
      instruction_digest: `sha256:${nodeCrypto.createHash('sha256').
        update(LIVE_PREVIEW_UPDATE_INSTRUCTION).digest('hex')}`,
      browser_preview_started: true,
      current_draft_required: true,
      provider_code_change_request_observed: providerServer.snapshot().
        some((request) => request.response_kind === 'builder_code_change_operations'),
      release_gate_integration: 'not_in_verify_release',
      schema_version: CANARY_INPUT_VERSION,
      saved_project_id_digest: `sha256:${nodeCrypto.createHash('sha256').
        update(savedProject.project_id).digest('hex')}`,
      ...livePreview,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result;
  } catch (error) {
    if (typeof error?.code === 'string') {
      error.diagnostic = Object.freeze({
        ...(error.diagnostic ?? {}),
        live_preview_canary_step: step,
        provider_requests: providerServer.snapshot(),
      });
    }
    throw error;
  } finally {
    if (app !== null) await app.close();
    await providerServer.close();
    cleanupUserDataRoot(userDataPath);
  }
}

if (require.main === module) {
  run().catch((error) => {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      code: typeof error?.code === 'string' ? error.code : 'packaged_live_preview_canary_failed',
      message: error instanceof Error ? error.message : 'Packaged Live Preview canary failed.',
      diagnostic: error?.diagnostic,
    })}\n`);
    process.exitCode = 1;
  });
}

module.exports = Object.freeze({
  LIVE_PREVIEW_IDEA,
  LIVE_PREVIEW_UPDATE_INSTRUCTION,
  RESULT_VERSION,
  createLivePreviewCanaryProviderServer,
  run,
});
