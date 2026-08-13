'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { _electron: electron } = require('playwright-core');

const {
  CANARY_INPUT_VERSION,
  PACKAGED_CANARY_USER_DATA_PREFIX,
  SELECTORS,
  approveCurrentProjectWriteIfRequested,
  bindNewProjectWorkspaceViaUi,
  captureGuardedUserDataRoot,
  clickSaveVersionViaUi,
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
const RESULT_VERSION = 'builder-packaged-active-followup-canary-result.v1';
const SETUP_INSTRUCTION = 'Build a compact focus timer.';
const INITIAL_INSTRUCTION = 'Improve the timer layout and supporting text.';
const FOLLOWUP_INSTRUCTION = 'Make it responsive and improve the heading.';
const QUEUED_FOLLOWUP_SELECTOR = '[data-builder-active-run-followup-queued="true"]';

function fail(code, diagnostic = undefined) {
  const error = new Error(code);
  error.code = code;
  if (diagnostic !== undefined) error.diagnostic = diagnostic;
  throw error;
}

async function waitUntil(check, code, diagnostic) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(100);
  }
  fail(code, typeof diagnostic === 'function' ? await diagnostic() : diagnostic);
}

async function clickByRole(page, role, name) {
  await page.getByRole(role, { exact: true, name }).click();
}

async function selectBuildMode(page) {
  await page.locator(SELECTORS.composerAddMenuButton).click();
  await page.locator(SELECTORS.composerAddBuildMode).click();
  await page.locator('[data-builder-composer-mode-chip="build"]').
    waitFor({ state: 'visible', timeout: 10_000 });
}

async function readTaskStream(page, projectId) {
  return page.evaluate(async (id) => {
    return globalThis.clawfabricBuilder.taskStream.read({ project_id: id });
  }, projectId);
}

function conversationItems(stream) {
  const items = stream?.conversation?.items;
  if (!Array.isArray(items)) fail('active_followup_task_stream_unavailable');
  return items;
}

function queuedFollowupItem(items) {
  return items.find((item) => (
    item?.item_kind === 'user_message'
    && item.message_kind === 'queued_followup'
    && item.message?.text === FOLLOWUP_INSTRUCTION
  )) ?? null;
}

function consumedFollowupItem(items, queued) {
  return items.find((item) => (
    item?.item_kind === 'queued_followup_consumed'
    && item.message_id === queued.message.message_id
    && item.recorded_state === 'consumed'
  )) ?? null;
}

async function diagnostic(page, providerServer, projectId = null) {
  return Object.freeze({
    alerts: await page.getByRole('alert').allTextContents().catch(() => []),
    composer_dispatch: await page.locator(SELECTORS.composer).
      getAttribute('data-builder-route-dispatch').catch(() => null),
    composer_route: await page.locator(SELECTORS.composer).
      getAttribute('data-builder-route').catch(() => null),
    pending_provider_response_count: providerServer.pendingResponseCount(),
    project_id: projectId,
    project_status: await page.locator(SELECTORS.projectPage).
      getAttribute('data-builder-project-status').catch(() => null),
    provider_requests: providerServer.snapshot(),
    queued_notice: await page.locator(QUEUED_FOLLOWUP_SELECTOR).textContent().catch(() => null),
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

async function run() {
  const executablePath = process.argv[2] ?? DEFAULT_EXECUTABLE;
  const providerServer = await createLocalCanaryProviderServer({
    deferCodeChangeResponses: 1,
    deferCodeChangeResponsesAfter: 1,
  });
  const userDataPath = makeUserDataRoot();
  const userDataRoot = captureGuardedUserDataRoot(userDataPath, fs, os);
  const projectRootPath = createCanaryProjectRoot(userDataRoot, fs, os);
  const gate = createArtifactGate();
  let app = null;
  let projectId = null;
  try {
    app = await electron.launch({
      args: [],
      executablePath,
      env: sanitizeLaunchEnvironment(process.env, userDataPath, projectRootPath),
    });
    const page = await app.firstWindow();
    await fillProviderSettingsViaUi(page, Object.freeze({
      base_url: providerServer.baseUrl,
      credential: 'local-canary-provider-secret',
      max_tokens: 8192,
      model: 'local-canary-model',
      temperature: 0.2,
      timeout_ms: 30000,
    }), gate);
    await clickByRole(page, 'button', 'New project');
    await bindNewProjectWorkspaceViaUi(page);
    await selectBuildMode(page);
    await page.locator(SELECTORS.idea).fill(SETUP_INSTRUCTION);
    await page.locator(SELECTORS.submitTurn).click();
    const writeApproved = await approveCurrentProjectWriteIfRequested(page);
    if (!writeApproved) fail('active_followup_write_approval_missing');
    await page.locator(SELECTORS.unsavedDraft).
      getByText('Unsaved draft', { exact: true }).
      waitFor({ state: 'visible', timeout: 120_000 });
    await clickSaveVersionViaUi(page);
    await page.locator(SELECTORS.unsavedDraft).waitFor({ state: 'hidden', timeout: 30_000 });

    await page.locator(SELECTORS.idea).fill(INITIAL_INSTRUCTION);
    await page.locator(SELECTORS.submitTurn).click();

    await waitUntil(
      () => providerServer.pendingResponseCount() === 1,
      'active_followup_first_run_not_deferred',
      () => diagnostic(page, providerServer),
    );
    projectId = await page.locator(SELECTORS.projectPage).
      getAttribute('data-builder-conversation-project-id');
    if (typeof projectId !== 'string' || !projectId.startsWith('builder-project:')) {
      fail('active_followup_project_identity_missing', await diagnostic(page, providerServer));
    }

    await page.locator(SELECTORS.idea).fill(FOLLOWUP_INSTRUCTION);
    await page.locator(SELECTORS.submitTurn).waitFor({ state: 'visible', timeout: 10_000 });
    await waitUntil(
      async () => await page.locator(SELECTORS.submitTurn).getAttribute('aria-label') === 'Add context',
      'active_followup_composer_not_queueable',
      () => diagnostic(page, providerServer, projectId),
    );
    await page.locator(SELECTORS.submitTurn).click();
    const queuedNotice = page.locator(QUEUED_FOLLOWUP_SELECTOR);
    await queuedNotice.waitFor({ state: 'visible', timeout: 10_000 });
    const queuedNoticeText = await queuedNotice.textContent();
    if (!queuedNoticeText?.includes('will run after the current step finishes')) {
      fail('active_followup_queue_notice_missing', await diagnostic(page, providerServer, projectId));
    }
    const composerRoute = await page.locator(SELECTORS.composer).
      getAttribute('data-builder-route');
    const composerDispatch = await page.locator(SELECTORS.composer).
      getAttribute('data-builder-route-dispatch');
    if (composerRoute !== 'queue_followup' || composerDispatch !== 'queue_followup') {
      fail('active_followup_route_mismatch', await diagnostic(page, providerServer, projectId));
    }

    const queuedStream = await readTaskStream(page, projectId);
    const queued = queuedFollowupItem(conversationItems(queuedStream));
    if (queued === null) {
      fail('active_followup_durable_queue_missing', await diagnostic(page, providerServer, projectId));
    }
    if (!providerServer.releaseNext()) {
      fail('active_followup_first_run_release_failed', await diagnostic(page, providerServer, projectId));
    }

    const releasedCodeChangeRequestCount = providerServer.snapshot().filter((request) => (
      request.response_kind === 'builder_code_change_operations'
    )).length;
    await waitUntil(
      () => providerServer.snapshot().filter((request) => (
        request.response_kind === 'builder_code_change_operations'
      )).length > releasedCodeChangeRequestCount,
      'active_followup_continuation_request_missing',
      () => diagnostic(page, providerServer, projectId),
    );
    await waitUntil(async () => (
      await page.locator(SELECTORS.projectPage).getAttribute('data-builder-project-status')
    ) === 'draft_ready', 'active_followup_continuation_draft_missing', () => (
      diagnostic(page, providerServer, projectId)
    ));
    await page.locator(
      `${SELECTORS.checkRunStatus}[data-builder-check-run-status="passed"]`,
    ).waitFor({ state: 'visible', timeout: 120_000 });
    await page.locator(SELECTORS.unsavedDraft).
      getByText('Unsaved draft', { exact: true }).
      waitFor({ state: 'visible', timeout: 120_000 });
    await queuedNotice.waitFor({ state: 'hidden', timeout: 30_000 });

    let completedItems = [];
    let consumed = null;
    await waitUntil(async () => {
      try {
        const completedStream = await readTaskStream(page, projectId);
        completedItems = conversationItems(completedStream);
        consumed = consumedFollowupItem(completedItems, queued);
        return consumed !== null;
      } catch {
        return false;
      }
    }, 'active_followup_consumed_record_missing', () => diagnostic(page, providerServer, projectId));
    const consumingTurn = completedItems.find((item) => (
      item?.item_kind === 'user_message'
      && item.message_kind === 'submitted'
      && item.turn_id === consumed.consumed_by?.turn_id
      && item.message?.text === FOLLOWUP_INSTRUCTION
    ));
    if (consumingTurn === undefined) {
      fail('active_followup_continuation_turn_missing', await diagnostic(page, providerServer, projectId));
    }
    await page.locator(SELECTORS.saveVersion).waitFor({ state: 'visible', timeout: 30_000 });
    const saveVersionRemainedExplicit = await page.locator(SELECTORS.saveVersion).isVisible();
    if (!saveVersionRemainedExplicit) {
      fail('active_followup_save_version_missing', await diagnostic(page, providerServer, projectId));
    }

    const result = Object.freeze({
      result_version: RESULT_VERSION,
      schema_version: CANARY_INPUT_VERSION,
      executable_path: executablePath,
      project_root_basename: path.basename(projectRootPath),
      build_mode_used: true,
      current_project_write_approved: true,
      active_provider_response_deferred: true,
      composer_remained_available_during_run: true,
      queued_followup_route_observed: true,
      queued_followup_notice_visible: true,
      durable_queued_followup_recorded: true,
      first_run_released: true,
      continuation_provider_request_observed: true,
      queued_followup_consumed: true,
      continuation_turn_recorded: true,
      unsaved_draft_visible: true,
      save_version_remained_explicit: saveVersionRemainedExplicit,
      release_gate_integration: 'not_in_verify_release',
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result;
  } finally {
    providerServer.releaseAll();
    if (app !== null) await app.close();
    await providerServer.close();
    cleanupUserDataRoot(userDataPath);
  }
}

if (require.main === module) {
  run().catch((error) => {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      code: typeof error?.code === 'string'
        ? error.code
        : 'packaged_active_followup_canary_failed',
      message: error instanceof Error
        ? error.message
        : 'Packaged active follow-up canary failed.',
      diagnostic: error?.diagnostic,
    })}\n`);
    process.exitCode = 1;
  });
}

module.exports = Object.freeze({
  FOLLOWUP_INSTRUCTION,
  INITIAL_INSTRUCTION,
  RESULT_VERSION,
  SETUP_INSTRUCTION,
  run,
});
