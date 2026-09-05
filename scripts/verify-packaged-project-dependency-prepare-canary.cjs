'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');

const {
  BuilderPackagedCanaryError,
  PACKAGED_CANARY_USER_DATA_PREFIX,
  SELECTORS,
  assertCustomChromeControls,
  approveCurrentProjectWriteIfRequested,
  captureSavedActivityEvidence,
  captureGuardedUserDataRoot,
  clickSaveVersionViaUi,
  createArtifactGate,
  createCanaryProjectRoot,
  fillProviderSettingsViaUi,
  openProjectFromCatalogById,
  readSanitizedTaskStreamEvidence,
  requireBuildWorkspaceBeforeDraftViaUi,
  readSanitizedBridgeEvidence,
  sanitizeLaunchEnvironment,
} = require('./verify-packaged-canary.cjs');
const {
  createLocalCanaryProviderServer,
} = require('./verify-packaged-canary-default.cjs');
const {
  dependencyReadinessEvidence,
} = require('./verify-packaged-harness-failure-canary.cjs');

const RESULT_VERSION = 'builder-packaged-project-dependency-prepare-canary-result.v1';
const DEFAULT_EXECUTABLE = path.join(__dirname, '..', 'release', 'win-unpacked', 'ClawFabric Builder.exe');
const IDEA = 'Create a tiny saved web project with a local dependency-backed test script.';

function fail(message) {
  const error = new BuilderPackagedCanaryError('canary_evidence_failed');
  error.message = message;
  throw error;
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitFor(fn, message, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const result = await fn().catch((error) => {
      last = { error: String(error?.message ?? 'unknown').slice(0, 240) };
      return null;
    });
    if (result) return result;
    if (result !== null) last = result;
    await wait(250);
  }
  const error = new BuilderPackagedCanaryError('canary_evidence_failed');
  error.diagnostic = Object.freeze({
    diagnostic_version: 'builder-packaged-project-dependency-prepare-timeout.v1',
    message,
    last,
  });
  throw error;
}

async function conversationProjectId(page) {
  const value = await page.locator(SELECTORS.projectPage)
    .getAttribute('data-builder-conversation-project-id')
    .catch(() => null);
  return typeof value === 'string' && value.startsWith('builder-project:') ? value : null;
}

async function createSavedDependencyProjectViaUi(page, idea, userDataRoot, providerServer) {
  await requireBuildWorkspaceBeforeDraftViaUi(page, idea);
  await approveCurrentProjectWriteIfRequested(page);
  const projectId = await waitFor(
    () => conversationProjectId(page),
    'Dependency project identity was not visible.',
    45_000,
  );
  await waitFor(async () => {
    const taskStream = await readSanitizedTaskStreamEvidence(page, projectId)
      .catch(() => null);
    const evidence = dependencyReadinessEvidence(taskStream, providerServer.snapshot());
    if (
      evidence.counts?.run_completed_count >= 1
      && evidence.check_status === 'incomplete'
      && ['dependency_workspace_missing', 'install_approval_required'].includes(evidence.environment_reason)
    ) return evidence;
    return null;
  }, 'Current draft dependency preparation prompt was not shown.', 120_000);
  const allowButton = page.locator('[data-builder-allow-dependency-preparation="true"]').first();
  await allowButton.waitFor({ state: 'visible', timeout: 45_000 });
  if (!await allowButton.isEnabled().catch(() => false)) {
    fail('Current draft dependency preparation approval button was disabled.');
  }
  await allowButton.click();
  const passed = await waitFor(async () => {
    const taskStream = await readSanitizedTaskStreamEvidence(page, projectId)
      .catch(() => null);
    const evidence = dependencyReadinessEvidence(taskStream, providerServer.snapshot());
    if (evidence.check_status === 'passed' && evidence.environment_reason === 'none') return evidence;
    return null;
  }, 'Current draft dependencies did not prepare and pass the check.', 180_000);
  const saveButton = page.locator(SELECTORS.saveVersion).first();
  await saveButton.waitFor({ state: 'visible', timeout: 45_000 });
  if (!await saveButton.isEnabled().catch(() => false)) {
    fail('Save Version was not enabled after the current draft check passed.');
  }
  await clickSaveVersionViaUi(page);
  await page.locator(SELECTORS.unsavedDraft).waitFor({ state: 'hidden', timeout: 45_000 });
  await captureSavedActivityEvidence(page, 1);
  return Object.freeze({
    current_draft_dependency_prepare_passed: true,
    current_draft_dependency_response_kinds: passed.response_kinds,
    project_id: projectId,
    saved_via_ui: true,
  });
}

function npmCliPath() {
  return path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
}

function projectTestPasses(projectRootPath) {
  const result = spawnSync(process.execPath, [npmCliPath(), 'test'], {
    cwd: projectRootPath,
    encoding: 'utf8',
    env: {
      ...process.env,
      CI: '1',
      FORCE_COLOR: '0',
      NO_COLOR: '1',
    },
    windowsHide: true,
  });
  return Object.freeze({
    status: result.status,
    signal: result.signal,
    stdout: typeof result.stdout === 'string' ? result.stdout.slice(0, 200) : '',
    stderr: typeof result.stderr === 'string' ? result.stderr.slice(0, 200) : '',
  });
}

function projectRootFacts(projectRootPath) {
  let entries = [];
  let packageJson = null;
  try {
    entries = fs.readdirSync(projectRootPath).sort();
  } catch {
    entries = [];
  }
  try {
    packageJson = JSON.parse(fs.readFileSync(path.join(projectRootPath, 'package.json'), 'utf8'));
  } catch {
    packageJson = null;
  }
  return Object.freeze({
    package_json_present: fs.existsSync(path.join(projectRootPath, 'package.json')),
    package_lock_present: fs.existsSync(path.join(projectRootPath, 'package-lock.json')),
    node_modules_present: fs.existsSync(path.join(projectRootPath, 'node_modules')),
    local_tool_manifest_present: fs.existsSync(path.join(
      projectRootPath,
      'tools',
      'clawfabric-local-check-tool',
      'package.json',
    )),
    package_json_scripts: packageJson !== null && typeof packageJson === 'object'
      ? packageJson.scripts ?? null
      : null,
    package_json_dev_dependency_keys:
      packageJson !== null
        && typeof packageJson === 'object'
        && packageJson.devDependencies !== null
        && typeof packageJson.devDependencies === 'object'
        && !Array.isArray(packageJson.devDependencies)
        ? Object.keys(packageJson.devDependencies).sort()
        : [],
    entries,
  });
}

async function collectSetupCardDiagnostic(page, projectId, projectRootPath, providerServer) {
  let directDiagnosis = null;
  try {
    directDiagnosis = await page.evaluate(async (targetProjectId) => (
      await globalThis.clawfabricBuilder.checkRun.diagnoseProjectEnvironment({
        project_id: targetProjectId,
      })
    ), projectId);
  } catch (error) {
    directDiagnosis = Object.freeze({
      error: String(error?.message ?? 'unknown').slice(0, 240),
    });
  }
  return Object.freeze({
    diagnostic_version: 'builder-packaged-project-dependency-prepare-setup-card-diagnostic.v1',
    project_page_status: await page.locator(SELECTORS.projectPage)
      .getAttribute('data-builder-project-status')
      .catch(() => null),
    conversation_status: await page.locator(SELECTORS.projectPage)
      .getAttribute('data-builder-conversation-status')
      .catch(() => null),
    unsaved_draft_visible: await page.locator(SELECTORS.unsavedDraft)
      .isVisible()
      .catch(() => false),
    setup_card_visible: await page.locator('[data-builder-project-environment-setup="true"]')
      .isVisible()
      .catch(() => false),
    direct_diagnosis: directDiagnosis,
    project_root_facts: projectRootFacts(projectRootPath),
    provider_requests: providerServer.snapshot(),
  });
}

async function run() {
  const executablePath = process.argv[2] ?? DEFAULT_EXECUTABLE;
  const providerServer = await createLocalCanaryProviderServer({
    harnessDependencyLocalInstall: true,
    projectRootDependencyLocalInstall: true,
  });
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), PACKAGED_CANARY_USER_DATA_PREFIX));
  const userDataRoot = captureGuardedUserDataRoot(userDataPath, fs, os);
  const projectRootPath = createCanaryProjectRoot(userDataRoot, fs, os);
  let app = null;
  let step = 'launch';
  try {
    const env = { ...process.env };
    delete env.BUILDER_PROGRAMMING_RUNTIME;
    delete env.BUILDER_HARNESS_RUNTIME_ROOT;
    app = await electron.launch({
      args: [],
      executablePath,
      env: sanitizeLaunchEnvironment(env, userDataPath, projectRootPath),
    });
    const page = await app.firstWindow();
    await assertCustomChromeControls(page);
    const gate = createArtifactGate();
    step = 'provider_settings';
    await fillProviderSettingsViaUi(page, {
      base_url: providerServer.baseUrl,
      credential: 'local-project-dependency-prepare-canary-secret',
      max_tokens: 8192,
      model: 'local-project-dependency-prepare-canary-model',
      temperature: 0.2,
      timeout_ms: 30_000,
    }, gate);
    step = 'generate_saved_project';
    const savedProject = await createSavedDependencyProjectViaUi(page, IDEA, userDataRoot, providerServer);
    const evidence = await readSanitizedBridgeEvidence(page);
    const project = evidence.catalog.projects[0] ?? null;
    if (project === null || typeof project.project_id !== 'string') fail('Saved project was not recorded.');
    if (project.project_id !== savedProject.project_id) fail('Saved project identity drifted.');
    if (fs.existsSync(path.join(projectRootPath, 'node_modules'))) {
      fail('Project root unexpectedly had dependencies before Prepare once.');
    }
    step = 'open_saved_project';
    await openProjectFromCatalogById(page, project, 'canary_restart_open_failed');
    step = 'setup_card';
    try {
      await page.locator('[data-builder-project-environment-setup="true"]')
        .waitFor({ state: 'visible', timeout: 45_000 });
    } catch (error) {
      const wrapped = new BuilderPackagedCanaryError('canary_evidence_failed');
      wrapped.message = error instanceof Error ? error.message : 'Project setup card was not visible.';
      wrapped.diagnostic = await collectSetupCardDiagnostic(
        page,
        project.project_id,
        projectRootPath,
        providerServer,
      );
      throw wrapped;
    }
    const prepareButton = page.locator('[data-builder-prepare-project-dependencies="true"]').first();
    await prepareButton.waitFor({ state: 'visible', timeout: 10_000 });
    const commandText = await page.locator('[data-builder-project-environment-setup="true"]')
      .textContent();
    step = 'prepare_once';
    await prepareButton.click();
    await waitFor(async () => {
      if (fs.existsSync(path.join(projectRootPath, 'node_modules'))) return true;
      return null;
    }, 'Project node_modules did not appear after Prepare once.', 180_000);
    await page.locator('[data-builder-project-environment-setup="true"]')
      .waitFor({ state: 'hidden', timeout: 45_000 });
    step = 'npm_test';
    const testResult = projectTestPasses(projectRootPath);
    if (testResult.status !== 0 || testResult.signal !== null) {
      const error = new BuilderPackagedCanaryError('canary_evidence_failed');
      error.diagnostic = Object.freeze({
        diagnostic_version: 'builder-packaged-project-dependency-prepare-npm-test.v1',
        test_result: testResult,
      });
      throw error;
    }
    const result = Object.freeze({
      result_version: RESULT_VERSION,
      dependency_setup_card_observed: true,
      local_file_dependency_installed: true,
      node_modules_present_after_prepare: true,
      package_lock_present_after_prepare: fs.existsSync(path.join(projectRootPath, 'package-lock.json')),
      project_test_passed_after_prepare: true,
      setup_card_text_mentions_prepare_once:
        typeof commandText === 'string' && commandText.includes('Prepare once'),
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result;
  } catch (error) {
    if (typeof error?.code === 'string') {
      error.diagnostic = Object.freeze({
        ...(error.diagnostic ?? {}),
        packaged_project_dependency_prepare_step: step,
      });
    }
    throw error;
  } finally {
    if (app !== null) await app.close().catch(() => {});
    await providerServer.close();
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
}

module.exports = Object.freeze({
  RESULT_VERSION,
  run,
});

if (require.main === module) {
  run().catch((error) => {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      code: typeof error?.code === 'string' ? error.code : 'canary_evidence_failed',
      message: error instanceof Error ? error.message : 'Packaged project dependency prepare canary failed.',
      diagnostic: error?.diagnostic ?? null,
    }, null, 2)}\n`);
    process.exitCode = 1;
  });
}
