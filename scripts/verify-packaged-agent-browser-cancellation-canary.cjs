'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { _electron: electron } = require('playwright-core');

const {
  PACKAGED_CANARY_USER_DATA_PREFIX,
  SELECTORS,
  approveCurrentProjectWriteIfRequested,
  assertCustomChromeControls,
  captureGuardedUserDataRoot,
  createArtifactGate,
  createCanaryProjectRoot,
  fillProviderSettingsViaUi,
  sanitizeLaunchEnvironment,
} = require('./verify-packaged-canary.cjs');
const { createLocalCanaryProviderServer } = require('./verify-packaged-canary-default.cjs');

const DEFAULT_EXECUTABLE = path.join(
  __dirname,
  '..',
  'release',
  'win-unpacked',
  'ClawFabric Builder.exe',
);
const RESULT_VERSION = 'builder-packaged-agent-browser-cancellation-canary-result.v1';
const CANCELLATION_INSTRUCTION = [
  'PACKAGED_AGENT_BROWSER_CANCEL',
  'Inspect the already saved local project in the isolated Agent Test browser.',
  'Do not change files.',
].join(' ');

function fail(code, diagnostic = undefined) {
  const error = new Error(code);
  error.code = code;
  if (diagnostic !== undefined) error.diagnostic = diagnostic;
  throw error;
}

async function waitUntil(check, code, diagnostic, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(100);
  }
  fail(code, typeof diagnostic === 'function' ? await diagnostic() : diagnostic);
}

async function loopbackWebContentsCount(app) {
  return app.evaluate(({ webContents }) => webContents.getAllWebContents()
    .filter((item) => !item.isDestroyed() && /^http:\/\/127\.0\.0\.1:\d+\//u.test(item.getURL()))
    .length);
}

function cleanupUserDataRoot(userDataPath) {
  const resolved = path.resolve(userDataPath);
  if (
    path.dirname(resolved) === path.resolve(os.tmpdir())
    && path.basename(resolved).startsWith(PACKAGED_CANARY_USER_DATA_PREFIX)
  ) fs.rmSync(resolved, { force: true, recursive: true });
}

async function diagnostic(page, providerServer) {
  return Object.freeze({
    agent_surface_visible: await page.locator('[data-builder-agent-test-browser-surface="true"]')
      .first().isVisible().catch(() => false),
    cancel_visible: await page.locator(SELECTORS.cancelWork).first().isVisible().catch(() => false),
    pending_provider_responses: providerServer.pendingResponseCount(),
    project_status: await page.locator(SELECTORS.projectPage)
      .getAttribute('data-builder-project-status').catch(() => null),
    request_kinds: providerServer.snapshot().flatMap((request) => (
      typeof request.response_kind === 'string' ? [request.response_kind] : []
    )),
  });
}

async function run() {
  const executablePath = process.argv[2] ?? DEFAULT_EXECUTABLE;
  const providerServer = await createLocalCanaryProviderServer({
    harnessAgentBrowserCancellation: true,
    onRequest(request) {
      if (typeof request.response_kind === 'string' && request.response_kind.startsWith('harness_')) {
        process.stderr.write(`${JSON.stringify({ response_kind: request.response_kind })}\n`);
      }
    },
  });
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), PACKAGED_CANARY_USER_DATA_PREFIX));
  const userDataRoot = captureGuardedUserDataRoot(userDataPath, fs, os);
  const projectRootPath = createCanaryProjectRoot(userDataRoot, fs, os);
  const launchEnvironment = sanitizeLaunchEnvironment(process.env, userDataPath, projectRootPath);
  let app = null;
  try {
    app = await electron.launch({ args: [], executablePath, env: launchEnvironment });
    const page = await app.firstWindow();
    await assertCustomChromeControls(page);
    await fillProviderSettingsViaUi(page, Object.freeze({
      base_url: providerServer.baseUrl,
      credential: 'local-canary-provider-secret',
      max_tokens: 8192,
      model: 'local-canary-model',
      temperature: 0.2,
      timeout_ms: 30000,
    }), createArtifactGate());
    await page.locator(SELECTORS.idea).fill(CANCELLATION_INSTRUCTION);
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    const proposalActions = page.locator(SELECTORS.agentTaskProposalActions).first();
    await proposalActions.waitFor({ state: 'visible', timeout: 30_000 });
    const surface = page.locator('[data-builder-agent-test-browser-surface="true"]').first();
    const surfaceVisible = surface.waitFor({ state: 'visible', timeout: 120_000 });
    const createProject = proposalActions.getByRole('button', { name: 'New project', exact: true });
    await createProject.waitFor({ state: 'visible', timeout: 10_000 });
    if (await createProject.isDisabled()) fail('agent_browser_cancel_new_project_disabled');
    await createProject.scrollIntoViewIfNeeded();
    await createProject.click();
    await proposalActions.waitFor({ state: 'hidden', timeout: 30_000 });
    fs.writeFileSync(path.join(projectRootPath, 'index.html'), [
      '<!doctype html>',
      '<html lang="en">',
      '<head>',
      '<meta charset="utf-8"><title>Agent Browser Cancel</title>',
      '<script>const end = Date.now() + 7000; while (Date.now() < end) { /* isolated load hold */ }</script>',
      '</head>',
      '<body><main><h1>Agent Browser Cancel</h1></main></body>',
      '</html>',
      '',
    ].join('\n'), { encoding: 'utf8', flag: 'wx' });
    await approveCurrentProjectWriteIfRequested(page);
    await surfaceVisible;
    const cancel = page.locator(SELECTORS.cancelWork).first();
    try {
      await cancel.waitFor({ state: 'visible', timeout: 5_000 });
    } catch {
      fail('agent_browser_cancel_action_missing', await diagnostic(page, providerServer));
    }
    if (await loopbackWebContentsCount(app) !== 1) {
      fail('agent_browser_cancel_loopback_missing', await diagnostic(page, providerServer));
    }
    await cancel.click();
    await cancel.waitFor({ state: 'hidden', timeout: 30_000 });
    providerServer.releaseAll();
    await surface.waitFor({ state: 'hidden', timeout: 30_000 });
    await waitUntil(
      async () => await loopbackWebContentsCount(app) === 0,
      'agent_browser_cancel_loopback_leaked',
      () => diagnostic(page, providerServer),
      30_000,
    );
    if (!await page.locator(SELECTORS.idea).isEnabled().catch(() => false)) {
      fail('agent_browser_cancel_composer_not_recovered', await diagnostic(page, providerServer));
    }
    if (!providerServer.snapshot().some((request) => (
      request.response_kind === 'harness_agent_browser_open_for_cancel'
    ))) {
      fail('agent_browser_cancel_open_request_missing', await diagnostic(page, providerServer));
    }

    await app.close();
    app = await electron.launch({ args: [], executablePath, env: launchEnvironment });
    const restartedPage = await app.firstWindow();
    await assertCustomChromeControls(restartedPage);
    const [restartLoopbackCount, restartSurfaceVisible] = await Promise.all([
      loopbackWebContentsCount(app),
      restartedPage.locator('[data-builder-agent-test-browser-surface="true"]')
        .first().isVisible().catch(() => false),
    ]);
    if (restartLoopbackCount !== 0 || restartSurfaceVisible) {
      fail('agent_browser_cancel_restart_leak', Object.freeze({
        loopback_webcontents_count: restartLoopbackCount,
        surface_visible: restartSurfaceVisible,
      }));
    }
    const result = Object.freeze({
      result_version: RESULT_VERSION,
      active_agent_browser_surface_observed: true,
      active_loopback_webcontents_observed: true,
      cancellation_requested_from_ui: true,
      composer_recovered_after_cancel: true,
      ephemeral_webcontents_released_after_cancel: true,
      browser_load_held_during_cancel: true,
      restart_no_agent_browser_surface: true,
      restart_no_loopback_webcontents: true,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result;
  } finally {
    providerServer.releaseAll();
    if (app !== null) await app.close().catch(() => {});
    await providerServer.close();
    cleanupUserDataRoot(userDataPath);
  }
}

module.exports = Object.freeze({
  CANCELLATION_INSTRUCTION,
  RESULT_VERSION,
  run,
});

if (require.main === module) {
  run().catch((error) => {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      code: typeof error?.code === 'string'
        ? error.code
        : 'packaged_agent_browser_cancellation_canary_failed',
      diagnostic: error?.diagnostic ?? null,
      message: error instanceof Error ? error.message : 'Agent Browser cancellation canary failed.',
    })}\n`);
    process.exitCode = 1;
  });
}
