'use strict';

const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');

const {
  SELECTORS,
  approveCurrentProjectWriteIfRequested,
  assertCustomChromeControls,
  createArtifactGate,
  fillProviderSettingsViaUi,
  readSanitizedTaskStreamEvidence,
  requireBuildWorkspaceBeforeDraftViaUi,
  sanitizeLaunchEnvironment,
} = require('./verify-packaged-canary.cjs');
const {
  createLocalCanaryProviderServer,
} = require('./verify-packaged-canary-default.cjs');

const USER_DATA_PREFIX = 'clawfabric-builder-packaged-canary-';
const PROCESS_SNAPSHOT_MAX_BYTES = 4 * 1024 * 1024;
const PACKAGED_CANARY_RUNTIME_IDLE_TIMEOUT_MS =
  'BUILDER_PACKAGED_CANARY_RUNTIME_IDLE_TIMEOUT_MS';
const ACTIONABLE_ENVIRONMENT_REASONS = Object.freeze([
  'dependency_workspace_missing',
  'host_toolchain_missing',
  'install_approval_required',
  'install_denied',
  'dependency_preparation_failed',
  'dependency_preparation_timed_out',
  'package_manager_unavailable',
]);

function runtimeIdleTimeoutMs(kind) {
  if (!['idle', 'crash'].includes(kind)) {
    throw new Error('Harness failure canary kind is invalid.');
  }
  return kind === 'idle' ? 10_000 : 30_000;
}

function packagedExecutable() {
  const configured = process.env.BUILDER_PACKAGED_EXECUTABLE_PATH;
  const candidate = typeof configured === 'string' && configured.length > 0
    ? path.resolve(configured)
    : path.resolve(__dirname, '../release/win-unpacked/ClawFabric Builder.exe');
  if (!fs.statSync(candidate).isFile()) throw new Error('Packaged executable is unavailable.');
  return candidate;
}

function removeCanaryRoot(root) {
  const resolved = path.resolve(root);
  if (
    path.dirname(resolved) !== path.resolve(os.tmpdir())
    || !path.basename(resolved).startsWith(USER_DATA_PREFIX)
  ) throw new Error('Harness failure canary cleanup root is invalid.');
  fs.rmSync(resolved, { recursive: true, force: true });
}

function parseWindowsProcessSnapshot(source) {
  if (typeof source !== 'string' || Buffer.byteLength(source, 'utf8') > PROCESS_SNAPSHOT_MAX_BYTES) {
    throw new Error('Windows process snapshot is invalid.');
  }
  const normalized = source.startsWith('\uFEFF') ? source.slice(1) : source;
  let parsed;
  try {
    parsed = JSON.parse(normalized);
  } catch {
    throw new Error('Windows process snapshot is invalid.');
  }
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  return Object.freeze(rows.map((row) => {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) {
      throw new Error('Windows process snapshot is invalid.');
    }
    const processId = row.ProcessId;
    const parentProcessId = row.ParentProcessId;
    const name = row.Name;
    const commandLine = row.CommandLine;
    if (
      !Number.isSafeInteger(processId)
      || processId < 0
      || !Number.isSafeInteger(parentProcessId)
      || parentProcessId < 0
      || typeof name !== 'string'
      || name.length < 1
      || name.length > 260
      || (commandLine !== null && (typeof commandLine !== 'string' || commandLine.length > 32_768))
    ) throw new Error('Windows process snapshot is invalid.');
    return Object.freeze({
      command_line: commandLine,
      name,
      parent_process_id: parentProcessId,
      process_id: processId,
    });
  }));
}

function harnessProcesses(snapshot) {
  if (!Array.isArray(snapshot)) throw new Error('Process tree input is invalid.');
  return Object.freeze(snapshot.filter((record) => {
    const commandLine = record.command_line;
    return typeof commandLine === 'string'
      && commandLine.includes('packaged-bin.js')
      && commandLine.includes('builder-coding-loop.cordis.yml');
  }));
}

function descendantProcesses(rootPid, snapshot) {
  if (!Number.isSafeInteger(rootPid) || rootPid < 1 || !Array.isArray(snapshot)) {
    throw new Error('Process tree input is invalid.');
  }
  const descendants = [];
  const discovered = new Set([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const processRecord of snapshot) {
      if (
        discovered.has(processRecord.process_id)
        || !discovered.has(processRecord.parent_process_id)
      ) continue;
      discovered.add(processRecord.process_id);
      descendants.push(processRecord);
      changed = true;
    }
  }
  return Object.freeze(descendants);
}

function readWindowsProcessSnapshot() {
  if (process.platform !== 'win32') throw new Error('Packaged process evidence requires Windows.');
  const command = "$ErrorActionPreference='Stop'; "
    + '@(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine) '
    + '| ConvertTo-Json -Compress';
  const result = childProcess.spawnSync(
    'powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command],
    {
      encoding: 'utf8',
      maxBuffer: PROCESS_SNAPSHOT_MAX_BYTES,
      timeout: 15_000,
      windowsHide: true,
    },
  );
  if (result.status !== 0 || typeof result.stdout !== 'string') {
    throw new Error('Windows process snapshot could not be read.');
  }
  return parseWindowsProcessSnapshot(result.stdout);
}

function matchingProcesses(snapshot, processIds) {
  const selected = new Set(processIds);
  return snapshot.filter((record) => selected.has(record.process_id));
}

async function delay(milliseconds) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitFor(predicate, code, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await predicate();
    if (result) return result;
    await delay(100);
  }
  throw new Error(code);
}

async function waitForProcessIdsGone(processIds) {
  await waitFor(
    () => matchingProcesses(readWindowsProcessSnapshot(), processIds).length === 0,
    'Harness child process was not cleaned up.',
    30_000,
  );
}

function terminateWindowsProcessTree(processId, failureMessage) {
  const result = childProcess.spawnSync(
    path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe'),
    ['/pid', String(processId), '/t', '/f'],
    { encoding: 'utf8', timeout: 10_000, windowsHide: true },
  );
  if (
    result.status !== 0
    && matchingProcesses(readWindowsProcessSnapshot(), [processId]).length === 1
  ) throw new Error(failureMessage);
  return result;
}

async function startFailingBuild(page) {
  await requireBuildWorkspaceBeforeDraftViaUi(
    page,
    'Build a small focus timer in this project.',
  );
  await approveCurrentProjectWriteIfRequested(page);
}

function reportStage(kind, stage) {
  process.stderr.write(`${JSON.stringify({ kind, stage })}\n`);
}

function reportDiagnostic(kind, diagnostic) {
  process.stderr.write(`${JSON.stringify({ kind, diagnostic })}\n`);
}

function failedRunEvidence(taskStream) {
  const conversation = taskStream?.conversation;
  const counts = conversation?.item_facts?.counts ?? null;
  return Object.freeze({
    active_turn_id: conversation?.recorded_active_turn_id ?? null,
    counts,
  });
}

function dependencyReadinessEvidence(taskStream, providerRequests = []) {
  const conversation = taskStream?.conversation;
  const counts = conversation?.item_facts?.counts ?? null;
  const outcome = taskStream?.check_run_outcome_projection ?? null;
  const responseKinds = Array.isArray(providerRequests)
    ? providerRequests
      .map((request) => request?.response_kind)
      .filter((kind) => typeof kind === 'string')
    : [];
  return Object.freeze({
    counts,
    check_status: typeof outcome?.status === 'string' ? outcome.status : null,
    environment_reason: typeof outcome?.environment_reason === 'string'
      ? outcome.environment_reason
      : null,
    repair_response_count: responseKinds.filter((kind) => (
      kind.includes('repair') || kind === 'harness_tool_edit_check.js'
    )).length,
    response_kinds: Object.freeze(responseKinds),
  });
}

async function dependencyPreparationButtonObservation(page) {
  const dependencyCard = page.locator('[data-builder-dependency-preparation="true"]').first();
  const allowButton = page.locator('[data-builder-allow-dependency-preparation="true"]').first();
  const [
    dependencyCardVisible,
    allowButtonVisible,
    allowButtonEnabled,
    allowButtonText,
    dependencyPreparationFailed,
  ] = await Promise.all([
    dependencyCard.isVisible().catch(() => false),
    allowButton.isVisible().catch(() => false),
    allowButton.isEnabled().catch(() => false),
    allowButton.textContent({ timeout: 250 }).catch(() => null),
    dependencyCard.getAttribute('data-builder-dependency-preparation-failed').catch(() => null),
  ]);
  return Object.freeze({
    allow_button_enabled: allowButtonEnabled,
    allow_button_text: typeof allowButtonText === 'string' ? allowButtonText.trim() : null,
    allow_button_visible: allowButtonVisible,
    dependency_card_visible: dependencyCardVisible,
    dependency_preparation_failed: dependencyPreparationFailed,
  });
}

async function waitForDependencyPreparationInFlight(page, projectId, providerServer, kind, code) {
  let lastObservation = null;
  const observation = await waitFor(async () => {
    const button = await dependencyPreparationButtonObservation(page);
    const taskStream = await readSanitizedTaskStreamEvidence(page, projectId)
      .catch(() => null);
    const evidence = dependencyReadinessEvidence(taskStream, providerServer.snapshot());
    lastObservation = Object.freeze({
      ...button,
      check_status: evidence.check_status,
      environment_reason: evidence.environment_reason,
      run_completed_count: evidence.counts?.run_completed_count ?? null,
    });
    if (
      button.dependency_card_visible
      && button.allow_button_visible
      && button.allow_button_enabled === false
      && typeof button.allow_button_text === 'string'
      && button.allow_button_text.includes('Preparing...')
    ) return lastObservation;
    return null;
  }, code, 7_500)
    .catch((error) => {
      reportDiagnostic(kind, {
        dependency_preparation_in_flight_timeout_observation: lastObservation,
      });
      throw error;
    });
  reportDiagnostic(kind, {
    dependency_preparation_in_flight_observed: true,
    dependency_preparation_in_flight: observation,
  });
  return observation;
}

async function conversationProjectId(page) {
  const projectId = await page.locator(SELECTORS.projectPage)
    .getAttribute('data-builder-conversation-project-id');
  return /^builder-project:[0-9a-f-]{36}$/u.test(projectId ?? '') ? projectId : null;
}

async function runDependencyReadinessScenario() {
  const kind = 'dependency_readiness';
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), USER_DATA_PREFIX));
  const projectRootPath = path.join(userDataPath, 'project-root');
  fs.mkdirSync(projectRootPath);
  const providerServer = await createLocalCanaryProviderServer({
    harnessDependencyWorkspaceMissing: true,
  });
  let app = null;
  let appPid = null;
  try {
    reportStage(kind, 'launch');
    const env = { ...process.env };
    delete env.BUILDER_PROGRAMMING_RUNTIME;
    delete env.BUILDER_HARNESS_RUNTIME_ROOT;
    app = await electron.launch({
      args: [],
      executablePath: packagedExecutable(),
      env: sanitizeLaunchEnvironment(env, userDataPath, projectRootPath),
    });
    appPid = app.process().pid;
    const page = await app.firstWindow();
    await assertCustomChromeControls(page);
    const gate = createArtifactGate();
    await fillProviderSettingsViaUi(page, {
      base_url: providerServer.baseUrl,
      credential: 'local-packaged-harness-readiness-canary-secret',
      max_tokens: 8192,
      model: 'deepseek-v4-flash',
      temperature: null,
      timeout_ms: 10_000,
    }, gate);
    reportStage(kind, 'build_start');
    await startFailingBuild(page);
    const projectId = await waitFor(
      () => conversationProjectId(page),
      'Dependency-readiness project identity is unavailable.',
      45_000,
    );
    let lastReadinessObservation = null;
    const settled = await waitFor(async () => {
      const taskStream = await readSanitizedTaskStreamEvidence(page, projectId)
        .catch(() => null);
      const evidence = dependencyReadinessEvidence(taskStream, providerServer.snapshot());
      lastReadinessObservation = Object.freeze({
        ...evidence,
        live_output_visible: await page.locator(SELECTORS.liveOutput).first()
          .isVisible().catch(() => false),
        project_error: await page.locator(SELECTORS.projectPage)
          .getAttribute('data-builder-project-error').catch(() => null),
        project_status: await page.locator(SELECTORS.projectPage)
          .getAttribute('data-builder-project-status').catch(() => null),
      });
      if (
        evidence.counts?.run_completed_count >= 1
        && evidence.check_status === 'incomplete'
        && ACTIONABLE_ENVIRONMENT_REASONS.includes(evidence.environment_reason)
      ) return Object.freeze({ taskStream, evidence });
      return null;
    }, 'Dependency-readiness check did not settle as an actionable environment block.', 120_000)
      .catch((error) => {
        reportDiagnostic(kind, {
          timeout_observation: lastReadinessObservation,
        });
        throw error;
      });
    const save = page.locator(SELECTORS.saveVersion).first();
    const saveVisible = await save.isVisible().catch(() => false);
    const saveEnabled = saveVisible && await save.isEnabled().catch(() => false);
    const liveOutputVisible = await page.locator(SELECTORS.liveOutput).first()
      .isVisible().catch(() => false);
    await page.locator(SELECTORS.idea).fill('Retry after preparing dependencies.');
    const composerRecovered = await page.locator(SELECTORS.submitTurn).first()
      .isEnabled().catch(() => false);
    await page.locator(SELECTORS.idea).fill('');
    reportDiagnostic(kind, {
      ...settled.evidence,
      composer_recovered: composerRecovered,
      live_output_visible: liveOutputVisible,
      save_enabled: saveEnabled,
      save_visible: saveVisible,
    });
    if (
      settled.evidence.repair_response_count !== 0
      || !composerRecovered
      || liveOutputVisible
      || saveEnabled
    ) {
      throw new Error('Dependency-readiness environment block did not settle safely.');
    }
    await page.locator('[data-builder-dependency-preparation="true"]').first()
      .waitFor({ state: 'visible', timeout: 45_000 })
      .catch(() => {
        throw new Error('Dependency-readiness block did not expose dependency preparation approval.');
      });
    await page.locator('[data-builder-deny-dependency-preparation="true"]').first().click();
    const denied = await waitFor(async () => {
      const taskStream = await readSanitizedTaskStreamEvidence(page, projectId)
        .catch(() => null);
      const evidence = dependencyReadinessEvidence(taskStream, providerServer.snapshot());
      if (evidence.environment_reason === 'install_denied') return evidence;
      return null;
    }, 'Dependency preparation denial did not settle as install_denied.', 45_000);
    const deniedSave = page.locator(SELECTORS.saveVersion).first();
    const deniedSaveVisible = await deniedSave.isVisible().catch(() => false);
    const deniedSaveEnabled = deniedSaveVisible && await deniedSave.isEnabled().catch(() => false);
    const deniedLiveOutputVisible = await page.locator(SELECTORS.liveOutput).first()
      .isVisible().catch(() => false);
    await page.locator(SELECTORS.idea).fill('Continue after declining dependency preparation.');
    const deniedComposerRecovered = await page.locator(SELECTORS.submitTurn).first()
      .isEnabled().catch(() => false);
    await page.locator(SELECTORS.idea).fill('');
    reportDiagnostic(kind, {
      denied_environment_reason: denied.environment_reason,
      denied_run_completed_count: denied.counts?.run_completed_count ?? null,
      denied_composer_recovered: deniedComposerRecovered,
      denied_live_output_visible: deniedLiveOutputVisible,
      denied_save_enabled: deniedSaveEnabled,
    });
    if (
      denied.repair_response_count !== 0
      || denied.environment_reason !== 'install_denied'
      || !deniedComposerRecovered
      || deniedLiveOutputVisible
      || deniedSaveEnabled
    ) {
      throw new Error('Dependency preparation denial did not settle safely.');
    }
    await app.close();
    app = null;
    await waitForProcessIdsGone([appPid]);
    reportStage(kind, 'complete');
    return Object.freeze({
      check_status: settled.evidence.check_status,
      composer_recovered: true,
      environment_reason: settled.evidence.environment_reason,
      dependency_preparation_card_visible: true,
      dependency_preparation_denial_recorded: true,
      live_output_cleared: !liveOutputVisible,
      repair_skipped: true,
      run_completed: settled.evidence.counts?.run_completed_count >= 1,
      save_not_enabled: true,
    });
  } finally {
    providerServer.releaseAll();
    if (app !== null) await app.close().catch(() => {});
    if (appPid !== null) await waitForProcessIdsGone([appPid]).catch(() => {});
    await providerServer.close();
    if (process.env.BUILDER_KEEP_HARNESS_FAILURE_CANARY_DATA === '1') {
      process.stderr.write(`${JSON.stringify({ stage: 'canary_data_retained', user_data_path: userDataPath })}\n`);
    } else {
      removeCanaryRoot(userDataPath);
    }
  }
}

async function runDependencyPreparationAllowScenario() {
  const kind = 'dependency_preparation_allow';
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), USER_DATA_PREFIX));
  const projectRootPath = path.join(userDataPath, 'project-root');
  fs.mkdirSync(projectRootPath);
  const providerServer = await createLocalCanaryProviderServer({
    harnessDependencyLocalInstall: true,
  });
  let app = null;
  let appPid = null;
  try {
    reportStage(kind, 'launch');
    const env = { ...process.env };
    delete env.BUILDER_PROGRAMMING_RUNTIME;
    delete env.BUILDER_HARNESS_RUNTIME_ROOT;
    app = await electron.launch({
      args: [],
      executablePath: packagedExecutable(),
      env: sanitizeLaunchEnvironment(env, userDataPath, projectRootPath),
    });
    appPid = app.process().pid;
    const page = await app.firstWindow();
    await assertCustomChromeControls(page);
    const gate = createArtifactGate();
    await fillProviderSettingsViaUi(page, {
      base_url: providerServer.baseUrl,
      credential: 'local-packaged-harness-dependency-prepare-canary-secret',
      max_tokens: 8192,
      model: 'deepseek-v4-flash',
      temperature: null,
      timeout_ms: 10_000,
    }, gate);
    reportStage(kind, 'build_start');
    await startFailingBuild(page);
    const projectId = await waitFor(
      () => conversationProjectId(page),
      'Dependency-preparation project identity is unavailable.',
      45_000,
    );
    const blocked = await waitFor(async () => {
      const taskStream = await readSanitizedTaskStreamEvidence(page, projectId)
        .catch(() => null);
      const evidence = dependencyReadinessEvidence(taskStream, providerServer.snapshot());
      if (
        evidence.counts?.run_completed_count >= 1
        && evidence.check_status === 'incomplete'
        && ['dependency_workspace_missing', 'install_approval_required'].includes(evidence.environment_reason)
      ) return evidence;
      return null;
    }, 'Dependency preparation did not first settle as an approval-required dependency block.', 120_000);
    await page.locator('[data-builder-dependency-preparation="true"]').first()
      .waitFor({ state: 'visible', timeout: 45_000 });
    const allowButton = page.locator('[data-builder-allow-dependency-preparation="true"]').first();
    await allowButton.waitFor({ state: 'visible', timeout: 45_000 });
    const allowButtonEnabled = await allowButton.isEnabled().catch(() => false);
    if (!allowButtonEnabled) throw new Error('Dependency preparation approval button was not enabled.');
    await allowButton.click();
    const inFlightObservation = await waitForDependencyPreparationInFlight(
      page,
      projectId,
      providerServer,
      kind,
      'Dependency preparation approval did not keep the UI in Preparing state.',
    );
    reportDiagnostic(kind, {
      allow_button_enabled_before_click: allowButtonEnabled,
      duplicate_prepare_suppressed: inFlightObservation.allow_button_enabled === false,
      preparing_observed_after_click: true,
    });
    let lastPreparationObservation = null;
    const passed = await waitFor(async () => {
      const taskStream = await readSanitizedTaskStreamEvidence(page, projectId)
        .catch(() => null);
      const evidence = dependencyReadinessEvidence(taskStream, providerServer.snapshot());
      lastPreparationObservation = Object.freeze({
        ...evidence,
        dependency_card_visible: await page.locator('[data-builder-dependency-preparation="true"]').first()
          .isVisible().catch(() => false),
        live_output_visible: await page.locator(SELECTORS.liveOutput).first()
          .isVisible().catch(() => false),
        project_error: await page.locator(SELECTORS.projectPage)
          .getAttribute('data-builder-project-error').catch(() => null),
        project_status: await page.locator(SELECTORS.projectPage)
          .getAttribute('data-builder-project-status').catch(() => null),
      });
      if (
        evidence.check_status === 'passed'
        && evidence.environment_reason === 'none'
      ) return evidence;
      return null;
    }, 'Dependency preparation approval did not install local dependencies and pass the check.', 180_000)
      .catch((error) => {
        reportDiagnostic(kind, {
          preparation_timeout_observation: lastPreparationObservation,
        });
        throw error;
      });
    const liveOutputVisible = await page.locator(SELECTORS.liveOutput).first()
      .isVisible().catch(() => false);
    await page.locator(SELECTORS.idea).fill('Continue after dependency preparation passed.');
    const composerRecovered = await page.locator(SELECTORS.submitTurn).first()
      .isEnabled().catch(() => false);
    await page.locator(SELECTORS.idea).fill('');
    const save = page.locator(SELECTORS.saveVersion).first();
    const saveVisible = await save.isVisible().catch(() => false);
    const saveEnabled = saveVisible && await save.isEnabled().catch(() => false);
    const dependencyCardVisible = await page.locator('[data-builder-dependency-preparation="true"]').first()
      .isVisible().catch(() => false);
    const projectNodeModulesPresent = fs.existsSync(path.join(projectRootPath, 'node_modules'));
    const projectPackageLockPresent = fs.existsSync(path.join(projectRootPath, 'package-lock.json'));
    reportDiagnostic(kind, {
      blocked_environment_reason: blocked.environment_reason,
      blocked_run_completed_count: blocked.counts?.run_completed_count ?? null,
      passed_run_completed_count: passed.counts?.run_completed_count ?? null,
      composer_recovered: composerRecovered,
      dependency_card_visible_after_pass: dependencyCardVisible,
      live_output_visible: liveOutputVisible,
      project_node_modules_present: projectNodeModulesPresent,
      project_package_lock_present: projectPackageLockPresent,
      repair_response_count: passed.repair_response_count,
      save_enabled: saveEnabled,
      save_visible: saveVisible,
    });
    if (
      passed.repair_response_count !== 0
      || !composerRecovered
      || liveOutputVisible
      || !saveEnabled
      || dependencyCardVisible
      || projectNodeModulesPresent
      || projectPackageLockPresent
    ) {
      throw new Error('Dependency preparation approval did not settle safely.');
    }
    await app.close();
    app = null;
    await waitForProcessIdsGone([appPid]);
    reportStage(kind, 'complete');
    return Object.freeze({
      approved_once: true,
      check_passed_after_preparation: true,
      composer_recovered: true,
      duplicate_prepare_suppressed: true,
      dependency_preparation_card_cleared: true,
      isolated_workspace_only: true,
      live_output_cleared: true,
      no_repair_loop: true,
      project_package_lock_absent: true,
      project_node_modules_absent: true,
      save_enabled_after_pass: true,
    });
  } finally {
    providerServer.releaseAll();
    if (app !== null) await app.close().catch(() => {});
    if (appPid !== null) await waitForProcessIdsGone([appPid]).catch(() => {});
    await providerServer.close();
    if (process.env.BUILDER_KEEP_HARNESS_FAILURE_CANARY_DATA === '1') {
      process.stderr.write(`${JSON.stringify({ stage: 'canary_data_retained', user_data_path: userDataPath })}\n`);
    } else {
      removeCanaryRoot(userDataPath);
    }
  }
}

async function runDependencyPreparationFailureScenario() {
  const kind = 'dependency_preparation_failure';
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), USER_DATA_PREFIX));
  const projectRootPath = path.join(userDataPath, 'project-root');
  fs.mkdirSync(projectRootPath);
  const providerServer = await createLocalCanaryProviderServer({
    harnessDependencyInstallFails: true,
  });
  let app = null;
  let appPid = null;
  try {
    reportStage(kind, 'launch');
    const env = { ...process.env };
    delete env.BUILDER_PROGRAMMING_RUNTIME;
    delete env.BUILDER_HARNESS_RUNTIME_ROOT;
    app = await electron.launch({
      args: [],
      executablePath: packagedExecutable(),
      env: sanitizeLaunchEnvironment(env, userDataPath, projectRootPath),
    });
    appPid = app.process().pid;
    const page = await app.firstWindow();
    await assertCustomChromeControls(page);
    const gate = createArtifactGate();
    await fillProviderSettingsViaUi(page, {
      base_url: providerServer.baseUrl,
      credential: 'local-packaged-harness-dependency-prepare-failure-canary-secret',
      max_tokens: 8192,
      model: 'deepseek-v4-flash',
      temperature: null,
      timeout_ms: 10_000,
    }, gate);
    reportStage(kind, 'build_start');
    await startFailingBuild(page);
    const projectId = await waitFor(
      () => conversationProjectId(page),
      'Dependency-preparation-failure project identity is unavailable.',
      45_000,
    );
    await waitFor(async () => {
      const taskStream = await readSanitizedTaskStreamEvidence(page, projectId).
        catch(() => null);
      const evidence = dependencyReadinessEvidence(taskStream, providerServer.snapshot());
      if (
        evidence.counts?.run_completed_count >= 1
        && evidence.check_status === 'incomplete'
        && ['dependency_workspace_missing', 'install_approval_required'].includes(evidence.environment_reason)
      ) return evidence;
      return null;
    }, 'Dependency preparation failure scenario did not first settle as an approval-required dependency block.', 120_000);
    const allowButton = page.locator('[data-builder-allow-dependency-preparation="true"]').first();
    await allowButton.waitFor({ state: 'visible', timeout: 45_000 });
    const allowButtonEnabled = await allowButton.isEnabled().catch(() => false);
    if (!allowButtonEnabled) throw new Error('Dependency preparation approval button was not enabled.');
    await allowButton.click();
    const inFlightObservation = await waitForDependencyPreparationInFlight(
      page,
      projectId,
      providerServer,
      kind,
      'Dependency preparation failure did not keep the UI in Preparing state.',
    );
    reportDiagnostic(kind, {
      allow_button_enabled_before_click: allowButtonEnabled,
      duplicate_prepare_suppressed: inFlightObservation.allow_button_enabled === false,
      preparing_observed_after_click: true,
    });
    const failed = await waitFor(async () => {
      const taskStream = await readSanitizedTaskStreamEvidence(page, projectId).
        catch(() => null);
      const evidence = dependencyReadinessEvidence(taskStream, providerServer.snapshot());
      if (
        evidence.check_status === 'incomplete'
        && evidence.environment_reason === 'dependency_preparation_failed'
      ) return evidence;
      return null;
    }, 'Dependency preparation failure did not settle as dependency_preparation_failed.', 120_000);
    const dependencyCard = page.locator('[data-builder-dependency-preparation="true"]').first();
    await dependencyCard.waitFor({ state: 'visible', timeout: 45_000 });
    const dependencyPreparationFailed = await dependencyCard.
      getAttribute('data-builder-dependency-preparation-failed').catch(() => null);
    const cardText = await dependencyCard.textContent().catch(() => '');
    const liveOutputVisible = await page.locator(SELECTORS.liveOutput).first().
      isVisible().catch(() => false);
    await page.locator(SELECTORS.idea).fill('Continue after dependency preparation failed.');
    const composerRecovered = await page.locator(SELECTORS.submitTurn).first().
      isEnabled().catch(() => false);
    await page.locator(SELECTORS.idea).fill('');
    const save = page.locator(SELECTORS.saveVersion).first();
    const saveVisible = await save.isVisible().catch(() => false);
    const saveEnabled = saveVisible && await save.isEnabled().catch(() => false);
    const projectNodeModulesPresent = fs.existsSync(path.join(projectRootPath, 'node_modules'));
    const projectPackageLockPresent = fs.existsSync(path.join(projectRootPath, 'package-lock.json'));
    reportDiagnostic(kind, {
      failed_run_completed_count: failed.counts?.run_completed_count ?? null,
      failed_environment_reason: failed.environment_reason,
      composer_recovered: composerRecovered,
      dependency_preparation_failed: dependencyPreparationFailed,
      dependency_card_text_has_failure: typeof cardText === 'string'
        && cardText.includes('Dependency preparation failed'),
      live_output_visible: liveOutputVisible,
      project_node_modules_present: projectNodeModulesPresent,
      project_package_lock_present: projectPackageLockPresent,
      repair_response_count: failed.repair_response_count,
      save_enabled: saveEnabled,
      save_visible: saveVisible,
    });
    if (
      failed.repair_response_count !== 0
      || !composerRecovered
      || liveOutputVisible
      || saveEnabled
      || dependencyPreparationFailed !== 'true'
      || typeof cardText !== 'string'
      || !cardText.includes('Dependency preparation failed')
      || projectNodeModulesPresent
      || projectPackageLockPresent
    ) {
      throw new Error('Dependency preparation failure did not settle safely.');
    }
    await app.close();
    app = null;
    await waitForProcessIdsGone([appPid]);
    reportStage(kind, 'complete');
    return Object.freeze({
      approved_once: true,
      check_remained_incomplete: true,
      composer_recovered: true,
      duplicate_prepare_suppressed: true,
      dependency_preparation_failed_visible: true,
      environment_reason: failed.environment_reason,
      isolated_workspace_only: true,
      live_output_cleared: true,
      no_repair_loop: true,
      project_package_lock_absent: true,
      project_node_modules_absent: true,
      save_not_enabled: true,
    });
  } finally {
    providerServer.releaseAll();
    if (app !== null) await app.close().catch(() => {});
    if (appPid !== null) await waitForProcessIdsGone([appPid]).catch(() => {});
    await providerServer.close();
    if (process.env.BUILDER_KEEP_HARNESS_FAILURE_CANARY_DATA === '1') {
      process.stderr.write(`${JSON.stringify({ stage: 'canary_data_retained', user_data_path: userDataPath })}\n`);
    } else {
      removeCanaryRoot(userDataPath);
    }
  }
}

async function openRestoredDraft(page, projectId) {
  const projectPage = page.locator(
    `${SELECTORS.projectPage}[data-builder-conversation-project-id="${projectId}"]`,
  ).first();
  if (!await projectPage.isVisible().catch(() => false)) {
    const catalogDraft = page.locator(`[data-builder-workspace-catalog-project="${projectId}"]`).first();
    await catalogDraft.waitFor({ state: 'visible', timeout: 30_000 });
    await catalogDraft.click();
  }
  await projectPage.waitFor({ state: 'visible', timeout: 120_000 });
  await page.locator(SELECTORS.unsavedDraft).waitFor({ state: 'visible', timeout: 120_000 });
  await page.locator(SELECTORS.undoDraft).waitFor({ state: 'visible', timeout: 30_000 });
  await page.locator(SELECTORS.saveVersion).waitFor({ state: 'hidden', timeout: 30_000 });
}

async function runInterruptedCheckpointScenario() {
  const kind = 'interrupted_checkpoint';
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), USER_DATA_PREFIX));
  const projectRootPath = path.join(userDataPath, 'project-root');
  fs.mkdirSync(projectRootPath);
  const providerServer = await createLocalCanaryProviderServer({
    deferHarnessResponses: 1,
    deferHarnessResponsesAfter: 2,
  });
  let app = null;
  let appPid = null;
  let capturedDescendantPids = [];
  try {
    reportStage(kind, 'launch');
    const env = { ...process.env };
    delete env.BUILDER_PROGRAMMING_RUNTIME;
    delete env.BUILDER_HARNESS_RUNTIME_ROOT;
    app = await electron.launch({
      args: [],
      executablePath: packagedExecutable(),
      env: sanitizeLaunchEnvironment(env, userDataPath, projectRootPath),
    });
    appPid = app.process().pid;
    const page = await app.firstWindow();
    await assertCustomChromeControls(page);
    const gate = createArtifactGate();
    await fillProviderSettingsViaUi(page, {
      base_url: providerServer.baseUrl,
      credential: 'local-packaged-harness-recovery-canary-secret',
      max_tokens: 8192,
      model: 'deepseek-v4-flash',
      temperature: null,
      timeout_ms: 2_000,
    }, gate);
    await startFailingBuild(page);
    await waitFor(
      () => providerServer.pendingResponseCount() === 1,
      'Harness interrupted-checkpoint response was not held after the first write.',
      45_000,
    );
    const projectId = await conversationProjectId(page);
    if (projectId === null) throw new Error('Interrupted checkpoint project identity is unavailable.');
    const runningTree = descendantProcesses(appPid, readWindowsProcessSnapshot());
    const harnessChildren = harnessProcesses(runningTree);
    if (harnessChildren.length !== 1) {
      throw new Error('Expected one Harness child before interrupted-checkpoint recovery.');
    }
    capturedDescendantPids = runningTree.map((record) => record.process_id);
    const harnessPid = harnessChildren[0].process_id;
    reportDiagnostic(kind, {
      app_pid: appPid,
      harness_pid: harnessPid,
      process_tree: runningTree.map((record) => ({
        process_id: record.process_id,
        parent_process_id: record.parent_process_id,
        name: record.name,
        harness_runtime: record.process_id === harnessPid,
      })),
    });
    terminateWindowsProcessTree(
      harnessPid,
      'Interrupted-checkpoint Harness process could not be terminated.',
    );
    reportStage(kind, 'child_killed');
    providerServer.releaseAll();
    await delay(2_000);
    const interruptedTaskStream = await readSanitizedTaskStreamEvidence(page, projectId);
    reportDiagnostic(kind, {
      harness_present_after_taskkill: matchingProcesses(
        readWindowsProcessSnapshot(),
        [harnessPid],
      ).length === 1,
      pending_provider_response_count: providerServer.pendingResponseCount(),
      project_status: await page.locator(SELECTORS.projectPage)
        .getAttribute('data-builder-project-status'),
      project_error: await page.locator(SELECTORS.projectPage)
        .getAttribute('data-builder-project-error'),
      counts: interruptedTaskStream?.conversation?.item_facts?.counts ?? null,
      provider_response_kinds: providerServer.snapshot()
        .map((request) => request.response_kind)
        .filter((responseKind) => typeof responseKind === 'string'),
    });
    await page.locator(SELECTORS.unsavedDraft).waitFor({ state: 'visible', timeout: 45_000 });
    await page.locator(SELECTORS.undoDraft).waitFor({ state: 'visible', timeout: 30_000 });
    await page.locator(SELECTORS.saveVersion).waitFor({ state: 'hidden', timeout: 30_000 });
    const beforeRestart = await readSanitizedTaskStreamEvidence(page, projectId);
    const beforeCounts = beforeRestart?.conversation?.item_facts?.counts ?? null;
    const beforeReviewMoreVisible = await page.locator(SELECTORS.reviewMore)
      .isVisible().catch(() => false);
    if (
      beforeCounts?.candidate_ready_count !== 1
      || beforeCounts?.programming_runtime_check_passed_count !== 0
    ) {
      throw new Error(`Interrupted checkpoint was not exposed for review: ${JSON.stringify(beforeCounts)}`);
    }
    await page.locator(SELECTORS.idea).fill('Continue from the recovered checkpoint.');
    if (!await page.locator(SELECTORS.submitTurn).first().isEnabled().catch(() => false)) {
      throw new Error('Interrupted checkpoint could not be continued before restart.');
    }
    await page.locator(SELECTORS.idea).fill('');

    await app.close();
    app = null;
    await waitForProcessIdsGone([appPid, ...capturedDescendantPids]);
    capturedDescendantPids = [];
    app = await electron.launch({
      args: [],
      executablePath: packagedExecutable(),
      env: sanitizeLaunchEnvironment(env, userDataPath, projectRootPath),
    });
    appPid = app.process().pid;
    const restartedPage = await app.firstWindow();
    await assertCustomChromeControls(restartedPage);
    await openRestoredDraft(restartedPage, projectId);
    const afterRestart = await readSanitizedTaskStreamEvidence(restartedPage, projectId);
    const afterCounts = afterRestart?.conversation?.item_facts?.counts ?? null;
    await restartedPage.locator(SELECTORS.idea).fill('Continue after restart.');
    const continuationEnabled = await restartedPage.locator(SELECTORS.submitTurn).first()
      .isEnabled().catch(() => false);
    await restartedPage.locator(SELECTORS.idea).fill('');
    const afterReviewMoreVisible = await restartedPage.locator(SELECTORS.reviewMore)
      .isVisible().catch(() => false);
    if (
      afterCounts?.candidate_ready_count !== beforeCounts.candidate_ready_count
      || afterCounts?.programming_runtime_check_passed_count !== 0
      || !continuationEnabled
    ) {
      throw new Error(`Interrupted checkpoint did not recover after restart: ${JSON.stringify(afterCounts)}`);
    }
    await app.close();
    app = null;
    await waitForProcessIdsGone([appPid]);
    reportStage(kind, 'complete');
    return Object.freeze({
      checkpoint_recovered_after_restart: true,
      continue_available: true,
      formal_save_required: false,
      review_available: beforeReviewMoreVisible || afterReviewMoreVisible,
      unchecked_state_preserved: true,
      undo_available: true,
    });
  } finally {
    providerServer.releaseAll();
    if (app !== null) await app.close().catch(() => {});
    if (appPid !== null) {
      await waitForProcessIdsGone([appPid, ...capturedDescendantPids]).catch(() => {});
    }
    await providerServer.close();
    if (process.env.BUILDER_KEEP_HARNESS_FAILURE_CANARY_DATA === '1') {
      process.stderr.write(`${JSON.stringify({ stage: 'canary_data_retained', user_data_path: userDataPath })}\n`);
    } else {
      removeCanaryRoot(userDataPath);
    }
  }
}

async function runFailureScenario(kind) {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), USER_DATA_PREFIX));
  const projectRootPath = path.join(userDataPath, 'project-root');
  fs.mkdirSync(projectRootPath);
  const providerServer = await createLocalCanaryProviderServer({ deferHarnessResponses: 8 });
  let app = null;
  let appPid = null;
  let capturedDescendantPids = [];
  try {
    reportStage(kind, 'launch');
    const env = { ...process.env };
    delete env.BUILDER_PROGRAMMING_RUNTIME;
    delete env.BUILDER_HARNESS_RUNTIME_ROOT;
    // Crash detection must win independently of idle supervision. Process-tree
    // discovery can itself take a few seconds on Windows, so a short idle
    // timeout would classify the run as stalled before taskkill exercises the
    // host termination path.
    env[PACKAGED_CANARY_RUNTIME_IDLE_TIMEOUT_MS] = String(runtimeIdleTimeoutMs(kind));
    app = await electron.launch({
      args: [],
      executablePath: packagedExecutable(),
      env: sanitizeLaunchEnvironment(env, userDataPath, projectRootPath),
    });
    reportStage(kind, 'app_launched');
    appPid = app.process().pid;
    if (!Number.isSafeInteger(appPid) || appPid < 1) throw new Error('Packaged app PID is unavailable.');
    const page = await app.firstWindow();
    reportStage(kind, 'window_ready');
    await assertCustomChromeControls(page);
    reportStage(kind, 'chrome_ready');
    const gate = createArtifactGate();
    await fillProviderSettingsViaUi(page, {
      base_url: providerServer.baseUrl,
      credential: 'local-packaged-harness-failure-canary-secret',
      max_tokens: 8192,
      model: 'deepseek-v4-flash',
      temperature: null,
      timeout_ms: 5_000,
    }, gate);
    reportStage(kind, 'provider_saved');
    const providerStatus = await page.evaluate(
      async () => globalThis.clawfabricBuilder.providerSettings.readCurrent(),
    );
    const expectedTimeoutMs = 5_000;
    if (providerStatus?.config?.timeout_ms !== expectedTimeoutMs) {
      throw new Error(`Provider timeout was not saved for ${kind}.`);
    }
    reportStage(kind, 'build_start');
    await startFailingBuild(page);
    await waitFor(
      () => providerServer.pendingResponseCount() >= 1,
      `Harness ${kind} provider request was not held.`,
    );
    reportStage(kind, 'provider_held');
    const runningTree = descendantProcesses(appPid, readWindowsProcessSnapshot());
    const harnessChildren = harnessProcesses(runningTree);
    if (harnessChildren.length !== 1) {
      throw new Error(`Expected one Harness child process during ${kind}.`);
    }
    capturedDescendantPids = runningTree.map((record) => record.process_id);
    const harnessPid = harnessChildren[0].process_id;
    reportDiagnostic(kind, {
      app_pid: appPid,
      descendant_count: runningTree.length,
      harness_pid: harnessPid,
      harness_parent_pid: harnessChildren[0].parent_process_id,
      harness_is_direct_child: harnessChildren[0].parent_process_id === appPid,
    });
    const failureStartedAtMs = Date.now();
    if (kind === 'crash') {
      terminateWindowsProcessTree(harnessPid, 'Harness process tree could not be terminated.');
      await delay(500);
      reportDiagnostic(kind, {
        harness_present_after_taskkill: matchingProcesses(
          readWindowsProcessSnapshot(),
          [harnessPid],
        ).length === 1,
      });
    }

    reportStage(kind, kind === 'crash' ? 'child_killed' : 'waiting_for_idle_supervision');
    if (kind === 'idle') {
      await delay(7_000);
      const projectId = await conversationProjectId(page);
      const taskStream = projectId !== null
        ? await readSanitizedTaskStreamEvidence(page, projectId)
        : null;
      const counts = taskStream?.conversation?.item_facts?.counts ?? null;
      reportDiagnostic(kind, {
        harness_process_active: matchingProcesses(readWindowsProcessSnapshot(), [harnessPid]).length === 1,
        project_status: await page.locator(SELECTORS.projectPage)
          .getAttribute('data-builder-project-status'),
        project_error: await page.locator(SELECTORS.projectPage)
          .getAttribute('data-builder-project-error'),
        conversation_present: taskStream?.conversation !== null,
        retry_turn_retained: taskStream?.conversation?.recorded_active_turn_id !== null,
        run_completed_count: counts?.run_completed_count ?? null,
        turn_completed_count: counts?.turn_completed_count ?? null,
      });
    }
    await waitFor(async () => {
      const status = await page.locator(SELECTORS.projectPage)
        .getAttribute('data-builder-project-status');
      return status === 'submit_failed' || status === 'generation_failed';
    }, `Harness ${kind} failure did not become visible.`, 45_000);
    const settledStatus = await page.locator(SELECTORS.projectPage)
      .getAttribute('data-builder-project-status');
    const failureLatencyMs = Date.now() - failureStartedAtMs;
    if (kind === 'crash' && failureLatencyMs > 10_000) {
      throw new Error('Harness process crash did not become visible promptly.');
    }
    await page.locator(`[data-builder-conversation-notice="${settledStatus}"]`)
      .waitFor({ state: 'visible', timeout: 30_000 });
    reportStage(kind, 'failure_visible');
    const projectId = await conversationProjectId(page);
    if (projectId === null) {
      throw new Error('Harness failure project identity is unavailable.');
    }
    const taskStream = await readSanitizedTaskStreamEvidence(page, projectId);
    const evidence = failedRunEvidence(taskStream);
    const projectError = await page.locator(SELECTORS.projectPage)
      .getAttribute('data-builder-project-error');
    const sourceEntries = fs.readdirSync(projectRootPath);
    const unsavedDraftVisible = await page.locator(SELECTORS.unsavedDraft)
      .isVisible().catch(() => false);
    const retryDraftVisible = await page.locator('[data-builder-retry-draft="true"]')
      .isVisible().catch(() => false);
    const expectedProjectError = kind === 'idle'
      ? 'builder_generation_runtime_stalled'
      : 'builder_generation_failed';
    reportDiagnostic(kind, {
      settled_status: settledStatus,
      failure_latency_ms: failureLatencyMs,
      project_error: projectError,
      evidence,
      source_entry_count: sourceEntries.length,
      unsaved_draft_visible: unsavedDraftVisible,
      retry_draft_visible: retryDraftVisible,
    });
    if (
      evidence.counts?.run_completed_count !== 1
      || evidence.counts?.turn_completed_count !== 0
      || evidence.counts?.candidate_ready_count !== 0
      || evidence.active_turn_id === null
      || sourceEntries.length !== 0
      || unsavedDraftVisible
      || projectError !== expectedProjectError
      || !retryDraftVisible
    ) {
      throw new Error(`Harness ${kind} failure did not settle safely.`);
    }

    providerServer.releaseAll();
    await waitForProcessIdsGone([harnessPid]);
    reportStage(kind, 'child_reaped');
    await page.locator(SELECTORS.idea).fill('Retry after the runtime failure.');
    const submit = page.locator(SELECTORS.submitTurn).first();
    await waitFor(() => submit.isEnabled().catch(() => false), `Composer did not recover after ${kind}.`);
    await page.locator(SELECTORS.idea).fill('');

    reportStage(kind, 'app_close');
    const descendantsBeforeClose = descendantProcesses(appPid, readWindowsProcessSnapshot())
      .map((record) => record.process_id);
    await app.close();
    app = null;
    await waitForProcessIdsGone([appPid, ...descendantsBeforeClose]);
    reportStage(kind, 'complete');
    return Object.freeze({
      candidate_count_unchanged: evidence.counts.candidate_ready_count === 0,
      composer_recovered: true,
      failure_recorded: true,
      failure_latency_ms: failureLatencyMs,
      harness_child_observed: true,
      harness_child_reaped: true,
      process_tree_cleaned_after_close: true,
      project_error: typeof projectError === 'string' ? projectError : null,
      source_unchanged: true,
    });
  } finally {
    providerServer.releaseAll();
    if (app !== null) await app.close().catch(() => {});
    if (appPid !== null) {
      await waitForProcessIdsGone([appPid, ...capturedDescendantPids]).catch(() => {});
    }
    await providerServer.close();
    if (process.env.BUILDER_KEEP_HARNESS_FAILURE_CANARY_DATA === '1') {
      process.stderr.write(`${JSON.stringify({ stage: 'canary_data_retained', user_data_path: userDataPath })}\n`);
    } else {
      removeCanaryRoot(userDataPath);
    }
  }
}

async function main() {
  const selectedScenario = process.env.BUILDER_HARNESS_FAILURE_SCENARIO;
  if (
    selectedScenario !== undefined
    && ![
      'idle',
      'crash',
      'interrupted_checkpoint',
      'dependency_readiness',
      'dependency_preparation_allow',
      'dependency_preparation_failure',
    ].includes(selectedScenario)
  ) {
    throw new Error('Harness failure canary scenario is invalid.');
  }
  const idle = selectedScenario !== undefined && selectedScenario !== 'idle'
    ? null
    : await runFailureScenario('idle');
  const crash = selectedScenario !== undefined && selectedScenario !== 'crash'
    ? null
    : await runFailureScenario('crash');
  const interruptedCheckpoint = selectedScenario !== undefined && selectedScenario !== 'interrupted_checkpoint'
    ? null
    : await runInterruptedCheckpointScenario();
  const dependencyReadiness = selectedScenario !== undefined && selectedScenario !== 'dependency_readiness'
    ? null
    : await runDependencyReadinessScenario();
  const dependencyPreparationAllow = selectedScenario !== undefined && selectedScenario !== 'dependency_preparation_allow'
    ? null
    : await runDependencyPreparationAllowScenario();
  const dependencyPreparationFailure = selectedScenario !== undefined && selectedScenario !== 'dependency_preparation_failure'
    ? null
    : await runDependencyPreparationFailureScenario();
  process.stdout.write(`${JSON.stringify({
    result_version: 'builder-packaged-harness-failure-canary.v4',
    runtime_kind: 'deepseek_harness.v1',
    idle,
    crash,
    interrupted_checkpoint: interruptedCheckpoint,
    dependency_readiness: dependencyReadiness,
    dependency_preparation_allow: dependencyPreparationAllow,
    dependency_preparation_failure: dependencyPreparationFailure,
  }, null, 2)}\n`);
}

module.exports = Object.freeze({
  dependencyReadinessEvidence,
  descendantProcesses,
  failedRunEvidence,
  harnessProcesses,
  parseWindowsProcessSnapshot,
  runDependencyPreparationAllowScenario,
  runDependencyPreparationFailureScenario,
  runtimeIdleTimeoutMs,
  runDependencyReadinessScenario,
  runInterruptedCheckpointScenario,
  runFailureScenario,
});

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      code: 'canary_evidence_failed',
      diagnostic: error instanceof Error && error.diagnostic !== undefined
        ? error.diagnostic
        : null,
      message: error instanceof Error ? error.message : 'Packaged Harness failure canary failed.',
    })}\n`);
    process.exitCode = 1;
  });
}
