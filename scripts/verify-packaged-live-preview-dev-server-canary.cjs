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
  captureGuardedUserDataRoot,
  clickSaveVersionViaUi,
  createArtifactGate,
  createCanaryProjectRoot,
  createInitialDraftViaUi,
  fillProviderSettingsViaUi,
  readSanitizedBridgeEvidence,
  sanitizeLaunchEnvironment,
} = require('./verify-packaged-canary.cjs');

const DEFAULT_EXECUTABLE = path.join(__dirname, '..', 'release', 'win-unpacked', 'ClawFabric Builder.exe');
const RESULT_VERSION = 'builder-packaged-live-preview-dev-server-canary-result.v1';
const DEV_SERVER_IDEA = [
  'Create a small app-router style project without any HTML file.',
  'Use package.json, server.cjs, check.js, app/layout.tsx, and app/page.tsx.',
  'package.json must provide npm test with node check.js and npm run dev with node server.cjs.',
].join(' ');

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
    title: 'Dev server canary answer',
    summary: 'Explains the local dev-server canary project.',
    explanation: 'This project intentionally has no HTML entry. Run should use package.json scripts.dev.',
  });
}

function planOutput() {
  return JSON.stringify({
    kind: 'builder_project_plan_proposal',
    title: 'No-HTML dev-server preview canary',
    summary: 'Create a package-script dev server project without index.html.',
    steps: [
      {
        title: 'Create app-router shape',
        purpose: 'Keep the project representative of framework apps without HTML entries.',
        expected_change: 'Add package.json, app/layout.tsx, app/page.tsx, server.cjs, and check.js.',
      },
      {
        title: 'Verify local launch',
        purpose: 'Make npm test prove the no-HTML source tree and dev script are present.',
        expected_change: 'The saved project can later start with npm run dev.',
      },
    ],
  });
}

function codeChangeOutput() {
  const packageJson = {
    name: 'clawfabric-dev-server-preview-canary',
    private: true,
    scripts: {
      dev: 'node server.cjs',
      test: 'node check.js',
    },
  };
  return JSON.stringify({
    kind: 'builder_code_change_operations',
    title: 'Dev server preview canary',
    summary: 'A no-HTML project that must preview through package.json scripts.dev.',
    operations: [
      {
        operation: 'upsert',
        path: 'package.json',
        content: `${JSON.stringify(packageJson, null, 2)}\n`,
      },
      {
        operation: 'upsert',
        path: 'server.cjs',
        content: [
          "'use strict';",
          '',
          "const http = require('node:http');",
          '',
          "const host = process.env.HOST || '127.0.0.1';",
          'const port = Number.parseInt(process.env.PORT || "", 10);',
          'if (host !== "127.0.0.1" || !Number.isSafeInteger(port) || port < 1) {',
          '  throw new Error("Dev server canary requires a bounded local host and port.");',
          '}',
          '',
          'const page = [',
          '  "<!doctype html>",',
          '  "<html lang=\\"en\\">",',
          '  "<head>",',
          '  "  <meta charset=\\"utf-8\\">",',
          '  "  <meta name=\\"viewport\\" content=\\"width=device-width, initial-scale=1\\">",',
          '  "  <title>Dev Server Canary</title>",',
          '  "</head>",',
          '  "<body>",',
          '  "  <main data-dev-server-canary=\\"ready\\">",',
          '  "    <h1>Dev Server Canary</h1>",',
          '  "    <p>Preview came from npm run dev, not a static HTML entry.</p>",',
          '  "  </main>",',
          '  "  <script>globalThis.__clawfabricDevServerCanary = \\"module-executed\\";</script>",',
          '  "</body>",',
          '  "</html>",',
          '].join("\\n");',
          '',
          'http.createServer((request, response) => {',
          '  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });',
          '  response.end(page);',
          '}).listen(port, host);',
          '',
        ].join('\n'),
      },
      {
        operation: 'upsert',
        path: 'check.js',
        content: [
          "'use strict';",
          '',
          "const assert = require('node:assert/strict');",
          "const fs = require('node:fs');",
          '',
          "const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));",
          "assert.equal(pkg.scripts.dev, 'node server.cjs');",
          "assert.equal(pkg.scripts.test, 'node check.js');",
          "assert.equal(fs.existsSync('index.html'), false);",
          "assert.equal(fs.existsSync('app/page.tsx'), true);",
          "assert.equal(fs.existsSync('server.cjs'), true);",
          '',
        ].join('\n'),
      },
      {
        operation: 'upsert',
        path: 'app/layout.tsx',
        content: [
          'export default function Layout({ children }: { children: React.ReactNode }) {',
          '  return <html lang="en"><body>{children}</body></html>;',
          '}',
          '',
        ].join('\n'),
      },
      {
        operation: 'upsert',
        path: 'app/page.tsx',
        content: [
          'export default function Page() {',
          '  return <main><h1>Dev Server Canary</h1></main>;',
          '}',
          '',
        ].join('\n'),
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
        return codeChangeOutput();
      }
    } catch {
      // Prompt repair messages are plain text; fall through to marker matching.
    }
  }
  const promptText = messageContents.join('\n');
  if (promptText.includes('builder_project_plan_proposal')) return planOutput();
  if (promptText.includes('builder_conversation_explanation')) return explanationOutput();
  state.codeChangeCount += 1;
  return codeChangeOutput();
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        request.destroy();
        reject(new Error('dev server canary request too large'));
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

async function createProviderServer() {
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
      response.end(JSON.stringify({ error: 'local dev server canary provider failed' }));
    }
  });
  await listen(server);
  const address = server.address();
  if (!address || typeof address !== 'object' || !Number.isSafeInteger(address.port)) {
    await closeServer(server);
    fail('dev_server_provider_failed');
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
  ) fail('dev_server_project_evidence_failed', { catalog: evidence?.catalog ?? null });
  return project;
}

function launchEnvironment(userDataPath, projectRootPath) {
  return sanitizeLaunchEnvironment({
    ...process.env,
    BUILDER_PROGRAMMING_RUNTIME: 'disabled',
  }, userDataPath, projectRootPath);
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

async function readSavedProjectFile(page, filePath) {
  const sourcePanel = page.locator(
    `${SELECTORS.sideWorkspaceFiles}`
    + '[data-builder-side-workspace-file-source-kind="saved_revision"]'
    + '[data-builder-side-workspace-files-status="ready"]',
  ).first();
  if (!await sourcePanel.isVisible().catch(() => false)) {
    await page.locator(SELECTORS.workspaceMenuButton).first().click();
    await page.locator(SELECTORS.workspaceControlSource).first().click();
  }
  await sourcePanel.waitFor({ state: 'visible', timeout: 30_000 });
  const entry = sourcePanel.locator(`[data-builder-side-workspace-file-entry="${filePath}"]`).first();
  await entry.waitFor({ state: 'visible', timeout: 30_000 });
  await entry.click();
  const content = sourcePanel.locator(
    `[data-builder-side-workspace-file-content="${filePath}"]`
    + '[data-builder-side-workspace-file-content-status="ready"]',
  ).first();
  await content.waitFor({ state: 'visible', timeout: 30_000 });
  return content.textContent();
}

async function verifySavedProjectFiles(page) {
  const packageText = await readSavedProjectFile(page, 'package.json');
  const appPageText = await readSavedProjectFile(page, 'app/page.tsx');
  if (
    typeof packageText !== 'string'
    || !packageText.includes('"dev": "node server.cjs"')
    || !packageText.includes('"test": "node check.js"')
    || typeof appPageText !== 'string'
    || !appPageText.includes('Dev Server Canary')
  ) {
    fail('saved_project_files_content_invalid', {
      app_page_text: typeof appPageText === 'string' ? appPageText.slice(0, 400) : null,
      package_text: typeof packageText === 'string' ? packageText.slice(0, 400) : null,
    });
  }
  const panelText = await page.locator(SELECTORS.sideWorkspaceFiles).first().textContent().catch(() => null);
  if (typeof panelText !== 'string' || panelText.includes('Loading files...')) {
    fail('saved_project_files_stuck_loading', { panel_text: panelText });
  }
  return Object.freeze({
    saved_files_loaded: true,
    saved_files_source_kind: 'saved_revision',
    saved_package_json_read: true,
    saved_app_page_read: true,
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

async function waitForLiveStatus(page, status, projectId, code) {
  const selector = `[data-builder-side-workspace-browser="true"][data-builder-live-preview-status="${status}"]`;
  try {
    await page.locator(selector).waitFor({ state: 'visible', timeout: 45_000 });
  } catch {
    fail(code, {
      live_panel_text: await page.locator('[data-builder-side-workspace-browser="true"]')
        .textContent().catch(() => null),
      live_status_projection: await readLivePreviewStatusProjection(page, projectId),
    });
  }
}

async function readDevServerEvidence(app) {
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
    let pageEvidence = null;
    if (selected !== null) {
      const selectedContents = webContents.getAllWebContents()
        .find((item) => item.id === selected.id);
      if (selectedContents) {
        pageEvidence = await selectedContents.executeJavaScript(`
          (() => ({
            document_title: document.title,
            heading: document.querySelector('h1')?.textContent ?? null,
            marker: globalThis.__clawfabricDevServerCanary ?? null,
            source: document.querySelector('[data-dev-server-canary]')?.getAttribute('data-dev-server-canary') ?? null,
          }))()
        `, true);
      }
    }
    return {
      page: pageEvidence,
      preview_webcontents_count: candidates.length,
      preview_url_loopback: selected?.url ?? null,
    };
  });
}

async function waitForDevServerEvidence(app) {
  const deadline = Date.now() + 45_000;
  let evidence = null;
  while (Date.now() < deadline) {
    evidence = await readDevServerEvidence(app).catch(() => null);
    if (
      evidence?.preview_webcontents_count === 1
      && /^http:\/\/127\.0\.0\.1:\d+\//u.test(evidence.preview_url_loopback ?? '')
      && evidence.page?.document_title === 'Dev Server Canary'
      && evidence.page?.heading === 'Dev Server Canary'
      && evidence.page?.marker === 'module-executed'
      && evidence.page?.source === 'ready'
    ) return evidence;
    await delay(250);
  }
  fail('dev_server_preview_evidence_failed', evidence);
}

async function ensurePreviewOpen(page) {
  const browser = page.locator('[data-builder-side-workspace-browser="true"]').first();
  if (await browser.isVisible().catch(() => false)) return;
  await page.locator(SELECTORS.workspaceMenuButton).click();
  await page.locator(SELECTORS.workspaceControlPreview).waitFor({ state: 'visible', timeout: 10_000 });
  await page.locator(SELECTORS.workspaceControlPreview).click();
  await browser.waitFor({ state: 'visible', timeout: 10_000 });
}

async function run() {
  const executablePath = process.argv[2] ?? DEFAULT_EXECUTABLE;
  const providerServer = await createProviderServer();
  const userDataPath = makeUserDataRoot();
  const userDataRoot = captureGuardedUserDataRoot(userDataPath, fs, os);
  const projectRootPath = createCanaryProjectRoot(userDataRoot, fs, os);
  const gate = createArtifactGate();
  let app = null;
  let step = 'launch';
  try {
    app = await electron.launch({
      args: [],
      executablePath,
      env: launchEnvironment(userDataPath, projectRootPath),
    });
    step = 'first_window';
    const page = await app.firstWindow();
    step = 'provider_settings';
    await fillProviderSettingsViaUi(page, Object.freeze({
      base_url: providerServer.baseUrl,
      credential: 'local-dev-server-canary-secret',
      max_tokens: 8192,
      model: 'local-dev-server-canary-model',
      temperature: 0.2,
      timeout_ms: 30000,
    }), gate);
    step = 'create_initial_draft';
    await createInitialDraftViaUi(page, DEV_SERVER_IDEA, userDataRoot);
    step = 'save_no_html_project';
    await clickSaveVersionViaUi(page);
    await page.locator(SELECTORS.unsavedDraft).waitFor({ state: 'hidden', timeout: 45_000 });
    const savedEvidence = await readSanitizedBridgeEvidence(page);
    const savedProject = onlyCatalogProject(savedEvidence, 1);
    if (fs.existsSync(path.join(projectRootPath, 'index.html'))) {
      fail('dev_server_canary_html_entry_created');
    }
    if (!fs.existsSync(path.join(projectRootPath, 'package.json'))) {
      fail('dev_server_canary_package_missing');
    }
    step = 'verify_saved_project_files';
    const savedFiles = await verifySavedProjectFiles(page);
    step = 'open_preview';
    await ensurePreviewOpen(page);
    step = 'request_dev_server_preview';
    await waitForButtonEnabled(page, '[data-builder-run-project="true"]', 'dev_server_run_button_disabled');
    await page.locator('[data-builder-run-project="true"]').first().click();
    await waitForLiveStatus(page, 'approval_required', savedProject.project_id, 'dev_server_approval_not_visible');
    const approvalBefore = await readLivePreviewStatusProjection(page, savedProject.project_id);
    if (
      approvalBefore?.preview_kind !== 'live_dev_server_web'
      || approvalBefore?.runtime_launch_projection?.command_execution !== 'approval_required'
      || approvalBefore?.dev_server_approval?.command_display !== 'npm run dev'
    ) fail('dev_server_approval_projection_invalid', approvalBefore);
    step = 'approve_dev_server';
    await page.locator('[data-builder-allow-live-preview-dev-server-once="true"]').click();
    await waitForLiveStatus(page, 'ready', savedProject.project_id, 'dev_server_preview_not_ready');
    const readyStatus = await readLivePreviewStatusProjection(page, savedProject.project_id);
    if (
      readyStatus?.preview_kind !== 'live_dev_server_web'
      || readyStatus?.runtime_launch_projection?.command_execution !== 'started'
      || readyStatus?.runtime_launch_projection?.dependency_preparation !== 'not_allowed'
      || readyStatus?.runtime_launch_projection?.package_install !== 'not_allowed'
    ) fail('dev_server_ready_projection_invalid', readyStatus);
    const previewEvidence = await waitForDevServerEvidence(app);
    const result = Object.freeze({
      result_version: RESULT_VERSION,
      executable_path: executablePath,
      schema_version: CANARY_INPUT_VERSION,
      instruction_digest: `sha256:${nodeCrypto.createHash('sha256')
        .update(DEV_SERVER_IDEA).digest('hex')}`,
      browser_preview_started: true,
      dev_server_approval_observed: true,
      dev_server_preview_ready: true,
      ...savedFiles,
      no_html_entry: true,
      package_entry_admitted: approvalBefore?.runtime_launch_projection?.preview_kind === 'live_dev_server_web',
      provider_code_change_request_observed: providerServer.snapshot()
        .some((request) => request.response_kind === 'builder_code_change_operations'),
      saved_project_id_digest: `sha256:${nodeCrypto.createHash('sha256')
        .update(savedProject.project_id).digest('hex')}`,
      preview_url_loopback_digest: `sha256:${nodeCrypto.createHash('sha256')
        .update(previewEvidence.preview_url_loopback).digest('hex')}`,
      runtime_command: approvalBefore.dev_server_approval.command_display,
      runtime_dependency_preparation: readyStatus.runtime_launch_projection.dependency_preparation,
      runtime_package_install: readyStatus.runtime_launch_projection.package_install,
      runtime_sandbox_policy: readyStatus.runtime_launch_projection.sandbox_policy,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result;
  } catch (error) {
    if (typeof error?.code === 'string') {
      error.diagnostic = Object.freeze({
        ...(error.diagnostic ?? {}),
        dev_server_canary_step: step,
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
      code: typeof error?.code === 'string' ? error.code : 'packaged_live_preview_dev_server_canary_failed',
      message: error instanceof Error ? error.message : 'Packaged Live Preview dev-server canary failed.',
      diagnostic: error?.diagnostic,
    })}\n`);
    process.exitCode = 1;
  });
}

module.exports = Object.freeze({
  DEV_SERVER_IDEA,
  RESULT_VERSION,
  createProviderServer,
  run,
});
