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
  captureGuardedUserDataRoot,
  createArtifactGate,
  createCanaryProjectRoot,
  fillProviderSettingsViaUi,
  sanitizeLaunchEnvironment,
} = require('./verify-packaged-canary.cjs');
const { createLocalCanaryProviderServer } = require('./verify-packaged-canary-default.cjs');

const DEFAULT_EXECUTABLE = path.join(__dirname, '..', 'release', 'win-unpacked', 'ClawFabric Builder.exe');
const RESULT_VERSION = 'builder-packaged-plan-mode-canary-result.v2';
const AUTO_QUESTION_INSTRUCTION = '这个项目是什么';
const AUTO_BUILD_ARTIFACT_INSTRUCTION = '做一个计划管理页面';
const ASK_MODE_INSTRUCTION = 'Make a timer.';
const BUILD_MODE_INSTRUCTION = '这个文件夹是什么结构？';
const CONTINUE_DRAFT_INSTRUCTION = '继续优化标题和说明，不要保存版本';
const SEMANTIC_PLAN_INSTRUCTION = '帮我做一个静态技术博客实施计划';
const PLAN_MODE_INSTRUCTION = '我打算做一个技术博客，静态的，帮我做成计划';

function fail(code, diagnostic = undefined) {
  const error = new Error(code);
  error.code = code;
  if (diagnostic !== undefined) error.diagnostic = diagnostic;
  throw error;
}

async function clickByRole(page, role, name) {
  await page.getByRole(role, { exact: true, name }).click();
}

async function optionalVisible(page, selector) {
  try {
    return await page.locator(selector).isVisible();
  } catch {
    return false;
  }
}

async function waitForSubmitEnabled(page, stage) {
  const submit = page.locator(SELECTORS.submitTurn);
  await submit.waitFor({ state: 'visible', timeout: 10_000 });
  try {
    await page.waitForFunction((selector) => {
      /* global document, HTMLButtonElement */
      const node = document.querySelector(selector);
      return node instanceof HTMLButtonElement && node.disabled === false;
    }, SELECTORS.submitTurn, { timeout: 10_000 });
  } catch {
    fail('plan_mode_submit_not_enabled', {
      stage,
      submit_disabled: await submit.isDisabled().catch(() => null),
      composer_status: await page.locator(SELECTORS.composerStatus).textContent().catch(() => null),
      project_status: await page.locator(SELECTORS.projectPage).
        getAttribute('data-builder-project-status').catch(() => null),
    });
  }
}

async function bindNewProjectWorkspace(page) {
  try {
    await page.locator(SELECTORS.workspacePicker).waitFor({ state: 'visible', timeout: 1_000 });
  } catch {
    await page.locator(SELECTORS.workspaceChip).click();
    await page.locator(SELECTORS.workspacePicker).waitFor({ state: 'visible', timeout: 10_000 });
  }
  const newProjectPanelAlreadyVisible = await optionalVisible(page, SELECTORS.newProjectPanel);
  if (!newProjectPanelAlreadyVisible) {
    await page.locator(SELECTORS.workspaceNewProject).click();
    await page.locator(SELECTORS.newProjectPanel).waitFor({ state: 'visible', timeout: 10_000 });
  }
  await page.locator(SELECTORS.addSourceFolder).click();
  await page.locator(SELECTORS.workspacePicker).waitFor({ state: 'hidden', timeout: 15_000 });
  await page.locator(`${SELECTORS.projectPage}[data-builder-project-status="ready"]`).
    waitFor({ state: 'visible', timeout: 15_000 });
}

async function approvePlanSourceReadIfRequested(page) {
  try {
    await page.locator(SELECTORS.planSourceReadApproval).
      waitFor({ state: 'visible', timeout: 5_000 });
  } catch {
    return false;
  }
  await page.locator(SELECTORS.approvePlanSourceRead).click();
  try {
    await page.locator(SELECTORS.planSourceReadApproval).
      waitFor({ state: 'hidden', timeout: 120_000 });
  } catch (error) {
    fail('plan_source_read_approval_stuck', {
      approval_text: await page.locator(SELECTORS.planSourceReadApproval).textContent().catch(() => null),
      approve_disabled: await page.locator(SELECTORS.approvePlanSourceRead).isDisabled().catch(() => null),
      composer_status: await page.locator(SELECTORS.composerStatus).textContent().catch(() => null),
      project_status: await page.locator(SELECTORS.projectPage).
        getAttribute('data-builder-project-status').catch(() => null),
      error_message: error instanceof Error ? error.message : String(error),
    });
  }
  return true;
}

async function selectComposerMode(page, mode) {
  const selector = mode === 'ask'
    ? SELECTORS.composerAddAskMode
    : mode === 'build'
      ? SELECTORS.composerAddBuildMode
      : SELECTORS.composerAddPlanMode;
  await page.locator(SELECTORS.composerAddMenuButton).click();
  const option = page.locator(selector);
  await option.waitFor({ state: 'visible', timeout: 10_000 });
  if (await option.isDisabled().catch(() => false)) fail(`${mode}_mode_disabled`);
  await option.click();
  await page.locator(`[data-builder-composer-mode-chip="${mode}"]`).
    waitFor({ state: 'visible', timeout: 10_000 });
}

async function clearComposerMode(page, mode) {
  const chip = page.locator(`[data-builder-composer-mode-chip="${mode}"]`);
  await chip.waitFor({ state: 'visible', timeout: 10_000 });
  await page.locator(SELECTORS.composerClearMode).click();
  await chip.waitFor({ state: 'hidden', timeout: 10_000 });
}

async function readCanaryDebugFile(userDataPath) {
  try {
    const debugPath = path.join(userDataPath, 'builder-canary-generation-debug.jsonl');
    if (!fs.existsSync(debugPath)) return [];
    return fs.readFileSync(debugPath, 'utf8').trim().split(/\r?\n/u)
      .filter((line) => line.length > 0)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return { parse_error: true };
        }
      });
  } catch {
    return [];
  }
}

async function capturePlanModeDiagnostic(page, providerServer, userDataPath) {
  return Object.freeze({
    alerts: await page.getByRole('alert').allTextContents().catch(() => []),
    composer_status: await page.locator(SELECTORS.composerStatus).textContent().catch(() => null),
    composer_route: await page.locator(SELECTORS.composer).getAttribute('data-builder-route').catch(() => null),
    composer_dispatch: await page.locator(SELECTORS.composer).
      getAttribute('data-builder-route-dispatch').catch(() => null),
    project_status: await page.locator(SELECTORS.projectPage).
      getAttribute('data-builder-project-status').catch(() => null),
    plan_source_read_approval_visible: await optionalVisible(page, SELECTORS.planSourceReadApproval),
    plan_review_actions_visible: await optionalVisible(page, SELECTORS.planReviewActions),
    current_project_write_approval_visible: await optionalVisible(page, SELECTORS.currentProjectWriteApproval),
    unsaved_draft_visible: await optionalVisible(page, SELECTORS.unsavedDraft),
    save_version_visible: await optionalVisible(page, SELECTORS.saveVersion),
    provider_requests: providerServer.snapshot(),
    canary_generation_debug: await readCanaryDebugFile(userDataPath),
  });
}

function countProviderRequests(providerRequests, responseKind) {
  return providerRequests.filter((request) => request.response_kind === responseKind).length;
}

async function waitForProviderRequestCount(providerServer, responseKind, previousCount, code) {
  const deadline = Date.now() + 120_000;
  let snapshot = providerServer.snapshot();
  while (Date.now() < deadline) {
    snapshot = providerServer.snapshot();
    if (countProviderRequests(snapshot, responseKind) > previousCount) return snapshot;
    await delay(250);
  }
  fail(code, {
    previous_count: previousCount,
    provider_requests: snapshot,
    response_kind: responseKind,
  });
}

async function verifyAutoDeterministicRoutesSkipClassifier(page, providerServer) {
  const beforeQuestion = providerServer.snapshot();
  const answersBefore = await page.locator(SELECTORS.questionAnswer).count().catch(() => 0);
  await page.locator(SELECTORS.idea).fill(AUTO_QUESTION_INSTRUCTION);
  await waitForSubmitEnabled(page, 'auto_question_before_submit');
  await page.locator(SELECTORS.submitTurn).click();
  await page.locator(SELECTORS.questionAnswer).nth(answersBefore).
    waitFor({ state: 'visible', timeout: 120_000 });
  let composerRoute = await page.locator(SELECTORS.composer).getAttribute('data-builder-route');
  let composerDispatch = await page.locator(SELECTORS.composer).getAttribute('data-builder-route-dispatch');
  let composerSignals = await page.locator(SELECTORS.composer).getAttribute('data-builder-route-signals');
  let after = providerServer.snapshot();
  if (
    composerRoute !== 'answer'
    || composerDispatch !== 'reply'
    || composerSignals !== 'read_only'
  ) {
    fail('auto_question_route_mismatch', { composer_dispatch: composerDispatch, composer_route: composerRoute, composer_signals: composerSignals });
  }
  if (countProviderRequests(after, 'builder_semantic_route_classification')
    !== countProviderRequests(beforeQuestion, 'builder_semantic_route_classification')) {
    fail('auto_question_spent_semantic_classifier', { provider_requests: after });
  }

  const beforeBuild = providerServer.snapshot();
  await page.locator(SELECTORS.idea).fill(AUTO_BUILD_ARTIFACT_INSTRUCTION);
  await waitForSubmitEnabled(page, 'auto_build_artifact_before_submit');
  await page.locator(SELECTORS.submitTurn).click();
  await page.locator(SELECTORS.currentProjectWriteApproval).
    waitFor({ state: 'visible', timeout: 30_000 });
  composerRoute = await page.locator(SELECTORS.composer).getAttribute('data-builder-route');
  composerDispatch = await page.locator(SELECTORS.composer).getAttribute('data-builder-route-dispatch');
  composerSignals = await page.locator(SELECTORS.composer).getAttribute('data-builder-route-signals');
  after = providerServer.snapshot();
  if (
    composerRoute !== 'build'
    || composerDispatch !== 'ask_permission'
    || composerSignals !== 'clear_build'
  ) {
    fail('auto_build_artifact_route_mismatch', { composer_dispatch: composerDispatch, composer_route: composerRoute, composer_signals: composerSignals });
  }
  if (countProviderRequests(after, 'builder_semantic_route_classification')
    !== countProviderRequests(beforeBuild, 'builder_semantic_route_classification')) {
    fail('auto_build_artifact_spent_semantic_classifier', { provider_requests: after });
  }
  await page.locator(SELECTORS.dismissCurrentProjectWriteApproval).click();
  await page.locator(SELECTORS.currentProjectWriteApproval).
    waitFor({ state: 'hidden', timeout: 30_000 });
  return Object.freeze({
    auto_build_artifact_skipped_classifier: true,
    auto_question_skipped_classifier: true,
  });
}

async function verifyAskModePersistentAndClear(page, providerServer) {
  const before = providerServer.snapshot();
  const answersBefore = await page.locator(SELECTORS.questionAnswer).count().catch(() => 0);
  await selectComposerMode(page, 'ask');
  await page.locator(SELECTORS.idea).fill(ASK_MODE_INSTRUCTION);
  await waitForSubmitEnabled(page, 'ask_mode_before_submit');
  await page.locator(SELECTORS.submitTurn).click();
  await page.locator(SELECTORS.questionAnswer).nth(answersBefore).
    waitFor({ state: 'visible', timeout: 120_000 });
  const composerRoute = await page.locator(SELECTORS.composer).getAttribute('data-builder-route');
  const composerDispatch = await page.locator(SELECTORS.composer).
    getAttribute('data-builder-route-dispatch');
  const composerSignals = await page.locator(SELECTORS.composer).
    getAttribute('data-builder-route-signals');
  const after = providerServer.snapshot();
  if (
    composerRoute !== 'answer'
    || composerDispatch !== 'reply'
    || composerSignals !== 'composer_mode_ask'
  ) {
    fail('ask_mode_route_mismatch', { composer_dispatch: composerDispatch, composer_route: composerRoute, composer_signals: composerSignals });
  }
  if (countProviderRequests(after, 'builder_semantic_route_classification')
    !== countProviderRequests(before, 'builder_semantic_route_classification')) {
    fail('ask_mode_spent_semantic_classifier', { provider_requests: after });
  }
  await page.locator('[data-builder-composer-mode-chip="ask"]').
    waitFor({ state: 'visible', timeout: 10_000 });
  await clearComposerMode(page, 'ask');
  return Object.freeze({
    ask_answer_observed: true,
    ask_mode_persisted_until_cleared: true,
    ask_mode_skipped_classifier: true,
  });
}

async function verifyBuildModePersistentAndClear(page, providerServer) {
  const before = providerServer.snapshot();
  await selectComposerMode(page, 'build');
  await page.locator(SELECTORS.idea).fill(BUILD_MODE_INSTRUCTION);
  await waitForSubmitEnabled(page, 'build_mode_before_submit');
  await page.locator(SELECTORS.submitTurn).click();
  await page.locator(SELECTORS.currentProjectWriteApproval).
    waitFor({ state: 'visible', timeout: 30_000 });
  const composerRoute = await page.locator(SELECTORS.composer).getAttribute('data-builder-route');
  const composerDispatch = await page.locator(SELECTORS.composer).
    getAttribute('data-builder-route-dispatch');
  const composerSignals = await page.locator(SELECTORS.composer).
    getAttribute('data-builder-route-signals');
  const after = providerServer.snapshot();
  if (
    composerRoute !== 'build'
    || composerDispatch !== 'ask_permission'
    || composerSignals !== 'composer_mode_build'
  ) {
    fail('build_mode_route_mismatch', { composer_dispatch: composerDispatch, composer_route: composerRoute, composer_signals: composerSignals });
  }
  if (countProviderRequests(after, 'builder_semantic_route_classification')
    !== countProviderRequests(before, 'builder_semantic_route_classification')) {
    fail('build_mode_spent_semantic_classifier', { provider_requests: after });
  }
  await page.locator('[data-builder-composer-mode-chip="build"]').
    waitFor({ state: 'visible', timeout: 10_000 });
  await page.locator(SELECTORS.dismissCurrentProjectWriteApproval).click();
  await page.locator(SELECTORS.currentProjectWriteApproval).
    waitFor({ state: 'hidden', timeout: 30_000 });
  await clearComposerMode(page, 'build');
  return Object.freeze({
    build_mode_persisted_until_cleared: true,
    build_mode_requested_write_approval: true,
    build_mode_skipped_classifier: true,
  });
}

async function approvePlanAndWaitForDraft(page, providerServer, userDataPath) {
  await clickByRole(page, 'button', 'Approve plan');
  await page.locator(SELECTORS.planApproved).waitFor({ state: 'visible', timeout: 30_000 });
  const approvedCurrentProjectWrite = await approveCurrentProjectWriteIfRequested(page);
  const draftReady = page.locator(SELECTORS.unsavedDraft)
    .getByText('Unsaved draft', { exact: true })
    .waitFor({ state: 'visible', timeout: 120_000 })
    .then(() => 'draft_ready', () => 'draft_timeout');
  const alertReady = page.getByRole('alert')
    .waitFor({ state: 'visible', timeout: 120_000 })
    .then(() => 'alert_ready', () => 'alert_timeout');
  const draftOutcome = await Promise.race([draftReady, alertReady]);
  if (draftOutcome !== 'draft_ready') {
    fail('plan_mode_approved_plan_not_executed', await capturePlanModeDiagnostic(
      page,
      providerServer,
      userDataPath,
    ));
  }
  await page.locator(SELECTORS.saveVersion).waitFor({ state: 'visible', timeout: 30_000 });
  return approvedCurrentProjectWrite;
}

async function verifyContinueUnsavedDraftWithoutSave(page, providerServer, userDataPath) {
  const before = providerServer.snapshot();
  const beforeCodeChangeCount = countProviderRequests(before, 'builder_code_change_operations');
  await page.locator(SELECTORS.idea).fill(CONTINUE_DRAFT_INSTRUCTION);
  await waitForSubmitEnabled(page, 'continue_unsaved_draft_before_submit');
  await page.locator(SELECTORS.submitTurn).click();
  await waitForProviderRequestCount(
    providerServer,
    'builder_code_change_operations',
    beforeCodeChangeCount,
    'continue_unsaved_draft_provider_request_missing',
  );
  const draftReady = page.locator(SELECTORS.unsavedDraft).
    getByText('Unsaved draft', { exact: true }).
    waitFor({ state: 'visible', timeout: 120_000 }).
    then(() => 'draft_ready', () => 'draft_timeout');
  const alertReady = page.getByRole('alert').
    waitFor({ state: 'visible', timeout: 120_000 }).
    then(() => 'alert_ready', () => 'alert_timeout');
  const draftOutcome = await Promise.race([draftReady, alertReady]);
  if (draftOutcome !== 'draft_ready') {
    fail('continue_unsaved_draft_not_ready', await capturePlanModeDiagnostic(
      page,
      providerServer,
      userDataPath,
    ));
  }
  await page.locator(SELECTORS.saveVersion).waitFor({ state: 'visible', timeout: 30_000 });
  return Object.freeze({
    continuation_provider_request_observed: true,
    save_version_still_explicit: true,
    unsaved_draft_continued_without_save: true,
  });
}

async function verifyNaturalLanguagePlanAndReject(page, providerServer, userDataPath) {
  await page.locator(SELECTORS.idea).fill(SEMANTIC_PLAN_INSTRUCTION);
  await waitForSubmitEnabled(page, 'semantic_plan_before_submit');
  await page.locator(SELECTORS.submitTurn).click();
  const approvedSourceRead = await approvePlanSourceReadIfRequested(page);
  const planReady = page.locator(SELECTORS.planReviewActions).
    waitFor({ state: 'visible', timeout: 120_000 }).
    then(() => 'plan_ready', () => 'plan_timeout');
  const alertReady = page.getByRole('alert').waitFor({ state: 'visible', timeout: 120_000 }).
    then(() => 'alert_ready', () => 'alert_timeout');
  if (await Promise.race([planReady, alertReady]) !== 'plan_ready') {
    fail('semantic_plan_not_ready', await capturePlanModeDiagnostic(
      page,
      providerServer,
      userDataPath,
    ));
  }
  const composerRoute = await page.locator(SELECTORS.composer).getAttribute('data-builder-route');
  const composerDispatch = await page.locator(SELECTORS.composer).
    getAttribute('data-builder-route-dispatch');
  const composerSignals = await page.locator(SELECTORS.composer).
    getAttribute('data-builder-route-signals');
  const providerRequests = providerServer.snapshot();
  if (!providerRequests.some((request) => (
    request.response_kind === 'builder_semantic_route_classification'
  ))) {
    fail('semantic_plan_classifier_request_missing', { provider_requests: providerRequests });
  }
  if (!providerRequests.some((request) => request.response_kind === 'builder_project_plan_proposal')) {
    fail('semantic_plan_provider_request_missing', { provider_requests: providerRequests });
  }
  if (composerRoute !== 'plan' || composerDispatch !== 'plan') {
    fail('semantic_plan_route_mismatch', { composer_dispatch: composerDispatch, composer_route: composerRoute });
  }
  if (composerSignals !== 'semantic_route') {
    fail('semantic_plan_signal_mismatch', { composer_signals: composerSignals });
  }
  await clickByRole(page, 'button', 'Reject');
  await page.locator(SELECTORS.planRejected).waitFor({ state: 'visible', timeout: 30_000 });
  await page.locator(SELECTORS.planReviewActions).waitFor({ state: 'hidden', timeout: 30_000 });
  return Object.freeze({
    plan_source_read_approved: approvedSourceRead,
    semantic_classifier_observed: true,
    semantic_plan_rejected: true,
    semantic_plan_route_signal_observed: true,
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
  ) {
    return;
  }
  fs.rmSync(resolved, { force: true, recursive: true });
}

async function run() {
  const executablePath = process.argv[2] ?? DEFAULT_EXECUTABLE;
  const providerServer = await createLocalCanaryProviderServer();
  const userDataPath = makeUserDataRoot();
  const userDataRoot = captureGuardedUserDataRoot(userDataPath, fs, os);
  const projectRootPath = createCanaryProjectRoot(userDataRoot, fs, os);
  const gate = createArtifactGate();
  let app = null;
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
    await bindNewProjectWorkspace(page);
    const autoRoutes = await verifyAutoDeterministicRoutesSkipClassifier(page, providerServer);
    const askMode = await verifyAskModePersistentAndClear(page, providerServer);
    const semanticPlan = await verifyNaturalLanguagePlanAndReject(
      page,
      providerServer,
      userDataPath,
    );
    const buildMode = await verifyBuildModePersistentAndClear(page, providerServer);
    await page.locator(SELECTORS.idea).fill(PLAN_MODE_INSTRUCTION);
    await waitForSubmitEnabled(page, 'manual_plan_before_mode_select');
    await selectComposerMode(page, 'plan');
    await waitForSubmitEnabled(page, 'manual_plan_after_mode_select');
    await page.locator(SELECTORS.submitTurn).click();
    const approvedSourceRead = await approvePlanSourceReadIfRequested(page);
    const planReady = page.locator(SELECTORS.planReviewActions).
      waitFor({ state: 'visible', timeout: 120_000 }).
      then(() => 'plan_ready', () => 'plan_timeout');
    const alertReady = page.getByRole('alert').waitFor({ state: 'visible', timeout: 120_000 }).
      then(() => 'alert_ready', () => 'alert_timeout');
    const planOutcome = await Promise.race([planReady, alertReady]);
    if (planOutcome !== 'plan_ready') {
      fail('plan_mode_plan_not_ready', await capturePlanModeDiagnostic(
        page,
        providerServer,
        userDataPath,
      ));
    }
    const composerRoute = await page.locator(SELECTORS.composer).getAttribute('data-builder-route');
    const composerDispatch = await page.locator(SELECTORS.composer).getAttribute('data-builder-route-dispatch');
    const providerRequests = providerServer.snapshot();
    if (!providerRequests.some((request) => request.response_kind === 'builder_project_plan_proposal')) {
      fail('plan_provider_request_missing', { provider_requests: providerRequests });
    }
    const approvedCurrentProjectWrite = await approvePlanAndWaitForDraft(
      page,
      providerServer,
      userDataPath,
    );
    const providerRequestsAfterApproval = providerServer.snapshot();
    if (!providerRequestsAfterApproval.some((request) => request.response_kind === 'builder_code_change_operations')) {
      fail('approved_plan_provider_request_missing', { provider_requests: providerRequestsAfterApproval });
    }
    const continuation = await verifyContinueUnsavedDraftWithoutSave(
      page,
      providerServer,
      userDataPath,
    );
    const result = Object.freeze({
      result_version: RESULT_VERSION,
      executable_path: executablePath,
      instruction_digest: `sha256:${require('node:crypto').
        createHash('sha256').update(PLAN_MODE_INSTRUCTION).digest('hex')}`,
      auto_build_artifact_skipped_classifier: autoRoutes.auto_build_artifact_skipped_classifier,
      auto_question_skipped_classifier: autoRoutes.auto_question_skipped_classifier,
      ask_mode_answer_observed: askMode.ask_answer_observed,
      ask_mode_persisted_until_cleared: askMode.ask_mode_persisted_until_cleared,
      ask_mode_skipped_classifier: askMode.ask_mode_skipped_classifier,
      build_mode_persisted_until_cleared: buildMode.build_mode_persisted_until_cleared,
      build_mode_requested_write_approval: buildMode.build_mode_requested_write_approval,
      build_mode_skipped_classifier: buildMode.build_mode_skipped_classifier,
      plan_mode_enabled: true,
      plan_mode_chip_visible: true,
      semantic_classifier_observed: semanticPlan.semantic_classifier_observed,
      semantic_plan_rejected: semanticPlan.semantic_plan_rejected,
      semantic_plan_route_signal_observed: semanticPlan.semantic_plan_route_signal_observed,
      semantic_plan_source_read_approved: semanticPlan.plan_source_read_approved,
      plan_source_read_approved: approvedSourceRead,
      plan_review_actions_visible: true,
      plan_approved: true,
      current_project_write_approved: approvedCurrentProjectWrite,
      approved_plan_executed: true,
      continuation_provider_request_observed: continuation.continuation_provider_request_observed,
      save_version_still_explicit: continuation.save_version_still_explicit,
      unsaved_draft_continued_without_save: continuation.unsaved_draft_continued_without_save,
      unsaved_draft_visible: true,
      save_version_visible: true,
      composer_route: composerRoute,
      composer_dispatch: composerDispatch,
      provider_plan_request_observed: true,
      provider_code_change_request_observed: true,
      project_root_basename: path.basename(projectRootPath),
      release_gate_integration: 'included_in_verify_release',
      schema_version: CANARY_INPUT_VERSION,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result;
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
      code: typeof error?.code === 'string' ? error.code : 'packaged_plan_mode_canary_failed',
      message: error instanceof Error ? error.message : 'Packaged Plan mode canary failed.',
      diagnostic: error?.diagnostic,
    })}\n`);
    process.exitCode = 1;
  });
}

module.exports = Object.freeze({
  PLAN_MODE_INSTRUCTION,
  RESULT_VERSION,
  SEMANTIC_PLAN_INSTRUCTION,
  run,
});
