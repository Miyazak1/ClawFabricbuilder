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
let livePreviewStartDiagnostic = null;

function livePreviewCanaryLaunchEnvironment(userDataPath, projectRootPath) {
  return sanitizeLaunchEnvironment({
    ...process.env,
    BUILDER_PROGRAMMING_RUNTIME: 'disabled',
  }, userDataPath, projectRootPath);
}

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
          '    <canvas id="live-canary-webgl" width="96" height="64"></canvas>',
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
          "const webglCanvas = document.querySelector('#live-canary-webgl');",
          "const gl = webglCanvas.getContext('webgl', { antialias: false, preserveDrawingBuffer: true }) || webglCanvas.getContext('experimental-webgl', { antialias: false, preserveDrawingBuffer: true });",
          'if (gl) {',
          '  gl.clearColor(0.05, 0.32, 0.28, 1);',
          '  gl.clear(gl.COLOR_BUFFER_BIT);',
          '  const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");',
          '  globalThis.__clawfabricLivePreviewWebgl = {',
          "    available: true,",
          '    vendor: debugInfo ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : "masked",',
          '    renderer: debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : "masked",',
          '  };',
          '} else {',
          '  globalThis.__clawfabricLivePreviewWebgl = { available: false, vendor: "unavailable", renderer: "unavailable" };',
          '}',
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
        return codeChangeOutput(messageContents.some((content) => (
          content.includes(LIVE_PREVIEW_UPDATE_INSTRUCTION)
        )) ? 2 : 1);
      }
    } catch {
      // Prompt repair messages are plain text; fall through to marker matching.
    }
  }
  const promptText = messageContents.join('\n');
  if (promptText.includes('builder_project_plan_proposal')) return planOutput();
  if (promptText.includes('builder_conversation_explanation')) return explanationOutput();
  state.codeChangeCount += 1;
  return codeChangeOutput(promptText.includes(LIVE_PREVIEW_UPDATE_INSTRUCTION) ? 2 : 1);
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
  return Object.freeze({ unsaved_draft_observed: true });
}

async function waitForButtonEnabled(page, selector, code) {
  const button = page.locator(selector).first();
  await button.waitFor({ state: 'visible', timeout: 30_000 });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await button.isEnabled().catch(() => false)) return;
    await delay(100);
  }
  fail(code, {
    text: await button.textContent().catch(() => null),
    disabled: await button.isDisabled().catch(() => null),
  });
}

async function readLivePreviewStatusProjection(page, projectId) {
  if (typeof projectId !== 'string') return null;
  const evidence = await readSanitizedBridgeEvidence(page, projectId).catch(() => null);
  const conversationId = evidence?.task_stream?.conversation?.conversation_id ?? null;
  if (typeof conversationId !== 'string') return null;
  return page.evaluate(async (request) => (
    globalThis.clawfabricBuilder.livePreview.readCurrentPreviewStatus(request)
  ), { project_id: projectId, conversation_id: conversationId }).catch(() => null);
}

async function requestLivePreviewThroughBridge(page, projectId) {
  if (typeof projectId !== 'string') return null;
  const evidence = await readSanitizedBridgeEvidence(page, projectId).catch(() => null);
  const conversationId = evidence?.task_stream?.conversation?.conversation_id ?? null;
  if (typeof conversationId !== 'string') return null;
  return page.evaluate(async (request) => (
    globalThis.clawfabricBuilder.livePreview.requestCurrentDraftPreview(request)
  ), { project_id: projectId, conversation_id: conversationId }).catch((error) => ({
    bridge_error: error instanceof Error ? error.message : 'unknown',
  }));
}

async function waitForLiveStatus(page, status, code, projectId = null) {
  const selector = `[data-builder-side-workspace-browser="true"][data-builder-live-preview-status="${status}"]`;
  try {
    await page.locator(selector).waitFor({ state: 'visible', timeout: 45_000 });
  } catch {
    const liveStatusProjection = await readLivePreviewStatusProjection(page, projectId);
    fail(code, {
      live_panel_text: await page.locator('[data-builder-side-workspace-browser="true"]').
        textContent().catch(() => null),
      live_status: await page.locator('[data-builder-side-workspace-browser="true"]').
        getAttribute('data-builder-live-preview-status').catch(() => null),
      live_message: await page.locator('[data-builder-live-preview-message="true"]').
        textContent().catch(() => null),
      live_reason: liveStatusProjection?.unavailable_reason ?? null,
      live_status_projection: liveStatusProjection,
      live_start_diagnostic: livePreviewStartDiagnostic,
    });
  }
}

async function ensureBrowserPreviewOpen(page) {
  const browser = page.locator('[data-builder-side-workspace-browser="true"]').first();
  if (await browser.isVisible().catch(() => false)) return;
  await page.locator(SELECTORS.workspaceMenuButton).click();
  await page.locator(SELECTORS.workspaceControlPreview).waitFor({ state: 'visible', timeout: 10_000 });
  await page.locator(SELECTORS.workspaceControlPreview).click();
  await browser.waitFor({ state: 'visible', timeout: 10_000 });
}

async function readMainProcessLivePreviewEvidence(app) {
  return app.evaluate(async ({ BrowserWindow, webContents }) => {
    const mainWindow = BrowserWindow.getAllWindows().find((item) => !item.isDestroyed()) ?? null;
    const attachedViews = mainWindow?.contentView?.children?.map((view) => ({
      bounds: view.getBounds(),
      visible: view.getVisible(),
    })) ?? [];
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
            const webglCanvas = document.querySelector('#live-canary-webgl');
            let webglEvidence = { available: false, nonblank_pixel_count: 0, renderer_digest_source: 'unavailable' };
            if (webglCanvas instanceof HTMLCanvasElement) {
              const gl = webglCanvas.getContext('webgl') || webglCanvas.getContext('experimental-webgl');
              if (gl) {
                const webglPixels = new Uint8Array(webglCanvas.width * webglCanvas.height * 4);
                gl.readPixels(0, 0, webglCanvas.width, webglCanvas.height, gl.RGBA, gl.UNSIGNED_BYTE, webglPixels);
                let webglNonblank = 0;
                for (let index = 0; index < webglPixels.length; index += 4) {
                  if (
                    webglPixels[index] !== 0
                    || webglPixels[index + 1] !== 0
                    || webglPixels[index + 2] !== 0
                    || webglPixels[index + 3] !== 0
                  ) webglNonblank += 1;
                }
                const marker = globalThis.__clawfabricLivePreviewWebgl ?? null;
                webglEvidence = {
                  available: marker?.available === true,
                  nonblank_pixel_count: webglNonblank,
                  renderer_digest_source: String(marker?.vendor ?? 'unknown')
                    + ':'
                    + String(marker?.renderer ?? 'unknown'),
                };
              }
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
              viewport_height: window.innerHeight,
              viewport_width: window.innerWidth,
              webgl_available: webglEvidence.available,
              webgl_nonblank_pixel_count: webglEvidence.nonblank_pixel_count,
              webgl_renderer_digest_source: webglEvidence.renderer_digest_source,
            };
          })()
        `, true);
      }
    }
    return {
      attached_views: attachedViews,
      preview_webcontents_count: candidates.length,
      preview_url_loopback: selected?.url ?? null,
      canvas: canvasEvidence,
    };
  });
}

async function readPreviewBounds(page, selector, code) {
  const bounds = await page.locator(selector).
    first().boundingBox().catch(() => null);
  if (bounds === null || bounds.width <= 0 || bounds.height <= 0) {
    fail(code, { bounds, selector });
  }
  return Object.freeze({
    height: Math.round(bounds.height),
    width: Math.round(bounds.width),
  });
}

async function readBrowserPreviewBounds(page) {
  return readPreviewBounds(
    page,
    '[data-builder-result-placement="artifact"]',
    'live_preview_browser_panel_bounds_unavailable',
  );
}

async function waitForPreviewViewportToMatch(app, expectedBounds, code) {
  const deadline = Date.now() + 15_000;
  let evidence = null;
  while (Date.now() < deadline) {
    evidence = await readMainProcessLivePreviewEvidence(app).catch(() => null);
    const viewportWidth = evidence?.canvas?.viewport_width;
    const viewportHeight = evidence?.canvas?.viewport_height;
    if (
      Number.isFinite(viewportWidth)
      && Number.isFinite(viewportHeight)
      && Math.abs(viewportWidth - expectedBounds.width) <= 2
      && Math.abs(viewportHeight - expectedBounds.height) <= 2
    ) return evidence;
    await delay(100);
  }
  fail(code, {
    attached_views: evidence?.attached_views ?? null,
    expected_bounds: expectedBounds,
    observed_viewport: evidence?.canvas === null || evidence?.canvas === undefined
      ? null
      : {
          height: evidence.canvas.viewport_height,
          width: evidence.canvas.viewport_width,
        },
  });
}

async function verifyLivePreviewFollowsArtifactResize(page, app) {
  const initialBounds = await readBrowserPreviewBounds(page);
  await waitForPreviewViewportToMatch(app, initialBounds, 'live_preview_initial_bounds_mismatch');

  const resizeHandle = page.locator('[data-builder-artifact-resize-handle="true"]').first();
  const declaredMinWidth = Number.parseInt(await resizeHandle.getAttribute('aria-valuemin') ?? '', 10);
  await resizeHandle.focus();
  await resizeHandle.press('Home');
  await delay(100);
  const narrowBounds = await readBrowserPreviewBounds(page);
  await waitForPreviewViewportToMatch(app, narrowBounds, 'live_preview_narrow_bounds_mismatch');

  await resizeHandle.press('End');
  await delay(100);
  const declaredMaxWidth = Number.parseInt(await resizeHandle.getAttribute('aria-valuemax') ?? '', 10);
  const wideBounds = await readBrowserPreviewBounds(page);
  await waitForPreviewViewportToMatch(app, wideBounds, 'live_preview_wide_bounds_mismatch');

  if (
    !Number.isSafeInteger(declaredMinWidth)
    || !Number.isSafeInteger(declaredMaxWidth)
    || declaredMaxWidth < declaredMinWidth
    || Math.abs(narrowBounds.width - declaredMinWidth) > 8
    || Math.abs(wideBounds.width - declaredMaxWidth) > 8
    || wideBounds.width <= narrowBounds.width
  ) {
    fail('live_preview_resize_range_too_small', {
      declared_max_width: Number.isSafeInteger(declaredMaxWidth) ? declaredMaxWidth : null,
      declared_min_width: Number.isSafeInteger(declaredMinWidth) ? declaredMinWidth : null,
      initial_bounds: initialBounds,
      narrow_bounds: narrowBounds,
      wide_bounds: wideBounds,
    });
  }

  await page.locator('[data-builder-expand-preview="true"]').first().click();
  const expandedBounds = await readPreviewBounds(
    page,
    '[data-builder-expanded-preview-content="true"]',
    'live_preview_expanded_bounds_unavailable',
  );
  await waitForPreviewViewportToMatch(app, expandedBounds, 'live_preview_expanded_bounds_mismatch');
  if (expandedBounds.width <= wideBounds.width) {
    fail('live_preview_expanded_width_not_larger', {
      expanded_bounds: expandedBounds,
      wide_bounds: wideBounds,
    });
  }

  await page.locator('[data-builder-close-expanded-preview="true"]').first().click();
  await waitForPreviewViewportToMatch(app, wideBounds, 'live_preview_collapsed_bounds_mismatch');
  return Object.freeze({
    expanded_bounds: expandedBounds,
    initial_bounds: initialBounds,
    narrow_bounds: narrowBounds,
    wide_bounds: wideBounds,
  });
}

async function waitForMainProcessLivePreviewEvidence(app) {
  const deadline = Date.now() + 45_000;
  let evidence = null;
  while (Date.now() < deadline) {
    evidence = await readMainProcessLivePreviewEvidence(app).catch(() => null);
    if (
      evidence !== null
      && evidence.preview_webcontents_count === 1
      && /^http:\/\/127\.0\.0\.1:\d+\//u.test(evidence.preview_url_loopback ?? '')
      && evidence.canvas?.canvas_present === true
      && evidence.canvas?.canary_marker === 'module-executed'
      && evidence.canvas?.document_title === 'Canvas Canary Updated'
      && evidence.canvas?.external_fetch_blocked === true
      && evidence.canvas?.external_navigation_blocked === true
      && evidence.canvas?.external_window_open_blocked === true
      && evidence.canvas?.nonblank_pixel_count > 0
      && evidence.canvas?.webgl_available === true
      && evidence.canvas?.webgl_nonblank_pixel_count > 0
    ) return evidence;
    await delay(250);
  }
  fail('live_preview_webcontents_evidence_failed', evidence);
}

async function startLivePreviewAndReadEvidence(page, app, projectId) {
  await waitForButtonEnabled(page, '[data-builder-run-project="true"]', 'live_preview_start_disabled');
  await page.locator('[data-builder-run-project="true"]').first().click();
  await delay(750);
  const statusAfterUiClick = await readLivePreviewStatusProjection(page, projectId);
  const directProbe = statusAfterUiClick?.status === 'idle'
    ? await requestLivePreviewThroughBridge(page, projectId)
    : null;
  livePreviewStartDiagnostic = Object.freeze({
    status_after_ui_click: statusAfterUiClick,
    direct_bridge_probe: directProbe,
  });
  if (directProbe?.status === 'ready') {
    fail('live_preview_ui_click_did_not_dispatch', {
      status_after_ui_click: statusAfterUiClick,
      direct_bridge_probe: directProbe,
    });
  }
  await waitForLiveStatus(page, 'ready', 'live_preview_not_ready', projectId);
  return waitForMainProcessLivePreviewEvidence(app);
}

async function stopLivePreviewAndVerifyDisposed(page, app, projectId) {
  await waitForButtonEnabled(page, '[data-builder-stop-project="true"]', 'live_preview_stop_disabled');
  await page.locator('[data-builder-stop-project="true"]').first().click();
  await waitForLiveStatus(page, 'stopped', 'live_preview_stop_not_observed', projectId);
  const stoppedEvidence = await readMainProcessLivePreviewEvidence(app);
  if ((stoppedEvidence?.preview_webcontents_count ?? 1) !== 0) {
    fail('live_preview_stop_did_not_dispose', stoppedEvidence);
  }
}

async function verifyLivePreviewControls(page, app, projectId) {
  await ensureBrowserPreviewOpen(page);
  const staticPreviewVisible = await page.locator(SELECTORS.preview).isVisible().catch(() => false);
  const mainEvidence = await startLivePreviewAndReadEvidence(page, app, projectId);
  const layoutEvidence = await verifyLivePreviewFollowsArtifactResize(page, app);
  const reloadSelector = '[data-builder-side-workspace-browser="true"] [data-builder-live-preview-reload="true"]';
  await waitForButtonEnabled(page, reloadSelector, 'live_preview_reload_disabled');
  await page.locator(reloadSelector).first().click();
  await waitForLiveStatus(page, 'ready', 'live_preview_reload_not_ready', projectId);
  const reloadEvidence = await waitForMainProcessLivePreviewEvidence(app);
  if (reloadEvidence.preview_webcontents_count !== 1) {
    fail('live_preview_reload_leaked_webcontents', reloadEvidence);
  }
  const previewUrlDigest = `sha256:${nodeCrypto.createHash('sha256').
    update(mainEvidence.preview_url_loopback).digest('hex')}`;
  const reloadPreviewUrlDigest = `sha256:${nodeCrypto.createHash('sha256').
    update(reloadEvidence.preview_url_loopback).digest('hex')}`;
  const webglRendererDigest = `sha256:${nodeCrypto.createHash('sha256').
    update(mainEvidence.canvas.webgl_renderer_digest_source).digest('hex')}`;
  if (reloadPreviewUrlDigest !== previewUrlDigest) {
    fail('live_preview_reload_origin_drifted', {
      previewUrlDigest,
      reloadPreviewUrlDigest,
    });
  }
  const blockedSummary = page.locator('[data-builder-live-preview-blocked-count="true"]').first();
  await blockedSummary.waitFor({ state: 'visible', timeout: 20_000 }).catch(async () => {
    fail('live_preview_blocked_count_not_visible', {
      live_panel_text: await page.locator('[data-builder-live-preview-panel="true"]').
        first().textContent().catch(() => null),
    });
  });
  const blockedSummaryText = await blockedSummary.textContent();
  const blockedMatch = /Blocked\s+([1-9]\d*)\s+unsafe preview request/u.exec(blockedSummaryText ?? '');
  if (blockedMatch === null) {
    fail('live_preview_blocked_count_invalid', { blockedSummaryText });
  }
  const rendererBlockedCount = Number.parseInt(blockedMatch[1], 10);
  await stopLivePreviewAndVerifyDisposed(page, app, projectId);
  return Object.freeze({
    canvas_nonblank: true,
    external_fetch_blocked: true,
    external_navigation_blocked: true,
    external_window_open_blocked: true,
    javascript_executed: true,
    loopback_webcontents_observed: true,
    preview_expanded_and_restored: true,
    preview_expanded_width: layoutEvidence.expanded_bounds.width,
    preview_followed_sidebar_resize: true,
    preview_initial_width: layoutEvidence.initial_bounds.width,
    preview_matched_browser_panel: true,
    preview_narrow_width: layoutEvidence.narrow_bounds.width,
    preview_document_title_observed: mainEvidence.canvas.document_title,
    preview_url_loopback_digest: previewUrlDigest,
    reload_canvas_nonblank: true,
    reload_javascript_executed: true,
    reload_loopback_webcontents_observed: true,
    reload_preview_url_loopback_digest: reloadPreviewUrlDigest,
    reload_ready_observed: true,
    renderer_blocked_request_count_minimum: rendererBlockedCount,
    renderer_block_count_visible: true,
    static_fallback_visible_before_live: staticPreviewVisible,
    stop_disposed_webcontents: true,
    preview_wide_width: layoutEvidence.wide_bounds.width,
    webgl_available: true,
    webgl_nonblank: true,
    webgl_renderer_digest: webglRendererDigest,
  });
}

async function verifyLivePreviewAppRestartCleanup({
  app,
  executablePath,
  page,
  projectRootPath,
  userDataPath,
}) {
  const preCloseEvidence = await startLivePreviewAndReadEvidence(page, app);
  if (preCloseEvidence.preview_webcontents_count !== 1) {
    fail('live_preview_restart_cleanup_precondition_failed', preCloseEvidence);
  }
  await app.close();
  await delay(500);
  const restartedApp = await electron.launch({
    args: [],
    executablePath,
    env: livePreviewCanaryLaunchEnvironment(userDataPath, projectRootPath),
  });
  try {
    const restartedPage = await restartedApp.firstWindow();
    await readSanitizedBridgeEvidence(restartedPage);
    const restartedEvidence = await readMainProcessLivePreviewEvidence(restartedApp);
    if ((restartedEvidence?.preview_webcontents_count ?? 1) !== 0) {
      fail('live_preview_app_restart_leaked_webcontents', restartedEvidence);
    }
    return Object.freeze({
      app_restart_cleanup_checked: true,
      app_restart_cleanup_closed_active_preview: true,
      app_restart_no_loopback_webcontents: true,
      app_restart_reopened_with_same_user_data: true,
      restartedApp,
    });
  } catch (error) {
    await restartedApp.close().catch(() => {});
    throw error;
  }
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
      env: livePreviewCanaryLaunchEnvironment(userDataPath, projectRootPath),
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
    const livePreview = await verifyLivePreviewControls(page, app, savedProject.project_id);
    step = 'verify_live_preview_restart_cleanup';
    const restartCleanup = await verifyLivePreviewAppRestartCleanup({
      app,
      executablePath,
      page,
      projectRootPath,
      userDataPath,
    });
    app = restartCleanup.restartedApp;
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
      app_restart_cleanup_checked: restartCleanup.app_restart_cleanup_checked,
      app_restart_cleanup_closed_active_preview: restartCleanup.app_restart_cleanup_closed_active_preview,
      app_restart_no_loopback_webcontents: restartCleanup.app_restart_no_loopback_webcontents,
      app_restart_reopened_with_same_user_data: restartCleanup.app_restart_reopened_with_same_user_data,
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
