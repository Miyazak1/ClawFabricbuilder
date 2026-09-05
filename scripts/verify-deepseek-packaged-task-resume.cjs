'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { _electron: electron } = require('playwright-core');
const { PACKAGED_CANARY_USER_DATA_PREFIX, SELECTORS, captureGuardedUserDataRoot,
  createCanaryProjectRoot, copySavedProviderProfile, sanitizeLaunchEnvironment,
  readSanitizedTaskStreamEvidence, clickSaveVersionViaUi } = require('./verify-packaged-canary.cjs');

const IDEA = [
  'Build a small working focus timer in this empty project using only index.html, package.json and check.js.',
  'Use no dependencies, external assets or network resources. Do not install packages.',
  'The h1 must be exactly "Restart Resume Flow". Include a Start button and a visible countdown.',
  'Put the CSS and JavaScript inline in index.html. package.json must provide npm test using node check.js.',
  'check.js must verify the h1 and the Start button in index.html. Run the Builder checks after implementation.',
].join(' ');
const COMPLETED_TASK_FOLLOWUP = [
  'Continue this same task using the retained session context.',
  'Modify only index.html. Keep the existing h1, Start button, countdown, package.json and check.js unchanged.',
  'Add a visible paragraph with the exact text "Retained session follow-up" and the attribute',
  'data-continuation-marker="retained-session". Run the existing Builder check after the edit.',
].join(' ');

async function poll(read, accept, label, timeout = 60_000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    last = await read();
    if (accept(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out: ${label}; last=${JSON.stringify(last)}`);
}

function facts(stream) {
  const conversation = stream.conversation;
  const items = conversation.items;
  return {
    active_turn_id: conversation.recorded_active_turn_id,
    head_sequence: conversation.head_sequence,
    counts: {
      programming_runtime_check_passed_count: new Set(items.filter((item) =>
        item.item_kind === 'programming_runtime_tool_activity' && item.check_result?.status === 'passed')
        .map((item) => item.tool_call_id)).size,
      file_write_count: items.filter((item) => item.item_kind === 'programming_runtime_tool_activity'
        && ['write', 'edit'].includes(item.tool_kind) && item.state === 'completed'
        && item.presentation_detail?.detail_kind === 'diff').length,
    },
    runs: items.filter((item) => item.item_kind === 'run_started').map((item) => item.run_id),
    turn_ids: [...new Set(items.filter(item => item.item_kind === 'run_started').map(item => item.turn_id))],
    completed: items.filter((item) => item.item_kind === 'run_completed').map((item) => ({
      run_id: item.run_id, terminal_status: item.terminal_status, result_kind: item.result_kind,
    })),
    submitted: items.filter((item) => item.item_kind === 'user_message' && item.message_kind === 'submitted')
      .map((item) => item.message.text),
  };
}

function collectStorageDiagnostics(rootPath) {
  const files = [];
  const databases = [];
  const pending = [rootPath];
  while (pending.length > 0 && files.length < 200) {
    const directory = pending.pop();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(rootPath, absolute);
      if (entry.isDirectory()) {
        pending.push(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      const stat = fs.statSync(absolute);
      files.push({ path: relative, size: stat.size });
      if (!entry.name.endsWith('.sqlite')) continue;
      try {
        const database = new DatabaseSync(absolute, { open: true, readOnly: true });
        try {
          const tables = database.prepare(
            "SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name",
          ).all().map((row) => row.name);
          databases.push({
            path: relative,
            user_version: database.prepare('PRAGMA user_version').get().user_version,
            integrity_check: database.prepare('PRAGMA integrity_check').all(),
            tables,
            row_counts: Object.fromEntries(tables
              .filter((table) => table !== 'sqlite_sequence')
              .map((table) => [table, database.prepare(`SELECT count(*) AS count FROM "${table}"`)
                .get().count])),
          });
        } finally {
          database.close();
        }
      } catch (error) {
        databases.push({ path: relative, error: error.message });
      }
    }
  }
  return { files, databases };
}

function preserveFailureDiagnostics(rootPath, output) {
  const pending = [rootPath];
  let sessionCopied = false;
  while (pending.length > 0) {
    const directory = pending.pop();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        pending.push(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      if (entry.name === 'builder-canary-generation-debug.jsonl') {
        fs.copyFileSync(absolute, path.join(output, 'failure-generation-debug.jsonl'));
      }
      if (!sessionCopied && entry.name === 'session.jsonl') {
        fs.copyFileSync(absolute, path.join(output, 'failure-harness-session.jsonl'));
        sessionCopied = true;
      }
    }
  }
}

async function run(
  output = path.resolve('release/task-resume-deepseek-20260831'),
  manualPause = false,
  options = {},
) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), PACKAGED_CANARY_USER_DATA_PREFIX));
  const root = captureGuardedUserDataRoot(userData, fs, os);
  const sourceUserDataPath = typeof options.sourceUserDataPath === 'string'
    ? options.sourceUserDataPath
    : path.join(process.env.APPDATA, 'clawfabric-builder');
  const reportStage = typeof options.reportStage === 'function'
    ? options.reportStage
    : (value) => process.stdout.write(`${value}\n`);
  const writeSummary = options.writeSummary !== false;
  let app;
  let page;
  let projectId;
  let taskAddressId;
  let stage = 'setup';
  const launchDiagnostics = [];
  const startedAt = Date.now();
  fs.mkdirSync(output, { recursive: true });
  const mark = (value) => { stage = value; reportStage(stage); };
  try {
    const projectRoot = createCanaryProjectRoot(root, fs, os);
    copySavedProviderProfile({ mode: 'saved_profile',
      source_user_data_path: sourceUserDataPath }, root);
    const launch = async () => {
      app = await electron.launch({ executablePath: path.resolve('release/win-unpacked/ClawFabric Builder.exe'),
        args: [], env: sanitizeLaunchEnvironment(process.env, root.path, projectRoot) });
      const child = app.process();
      for (const [streamName, stream] of [['stdout', child.stdout], ['stderr', child.stderr]]) {
        stream?.on('data', (chunk) => {
          if (launchDiagnostics.length < 80) {
            launchDiagnostics.push(`${streamName}: ${String(chunk).slice(0, 1_000)}`);
          }
        });
      }
      page = await app.firstWindow();
      page.on('console', (message) => {
        if (launchDiagnostics.length < 80) launchDiagnostics.push(`console: ${message.text().slice(0, 1_000)}`);
      });
      page.on('pageerror', (error) => {
        if (launchDiagnostics.length < 80) launchDiagnostics.push(`pageerror: ${error.message.slice(0, 1_000)}`);
      });
      await page.locator(SELECTORS.agentRosterItem).waitFor({ state: 'visible', timeout: 30_000 });
    };
    const stream = () => page.evaluate((target) => globalThis.clawfabricBuilder.taskStream.read(target),
      { project_id: projectId, task_address_id: taskAddressId });
    const snapshot = async (name) => page.screenshot({ path: path.join(output, `${name}.png`) });
    mark('launch_isolated_desktop');
    await launch();
    await page.locator(SELECTORS.agentRosterItem).click();
    await page.locator(SELECTORS.idea).fill(IDEA);
    await page.locator(SELECTORS.submitTurn).click();
    await page.locator(SELECTORS.agentTaskProposalNewProject).waitFor({ state: 'visible', timeout: 30_000 });
    await page.locator(SELECTORS.agentTaskProposalNewProject).click();
    await page.locator(SELECTORS.cancelWork).waitFor({ state: 'visible', timeout: 30_000 });
    await page.locator('button[data-builder-project-id]').first().waitFor({ state: 'visible' });
    projectId = await page.locator('button[data-builder-project-id]').first().getAttribute('data-builder-project-id');
    assert.ok(projectId);
    taskAddressId = await page.locator(`button[data-builder-project-id="${projectId}"]`)
      .locator('xpath=ancestor::li[1]').locator('[data-builder-task-address-id]').first()
      .getAttribute('data-builder-task-address-id');
    mark('wait_for_real_provider_progress');
    await poll(stream, (value) => value.conversation.recorded_active_turn_id !== null
      && facts(value).counts.file_write_count >= 1,
    'real provider completed file write');
    const before = facts(await stream());
    assert.equal(before.runs.length, 1);
    await snapshot('01-running');
    if (manualPause) {
      mark('pause_running_task_via_composer_button');
      await page.getByRole('button', { name: 'Pause task', exact: true }).click();
    } else {
    mark('close_running_desktop_via_window_button');
    const closed = app.waitForEvent('close', { timeout: 30_000 });
    await page.getByRole('button', { name: 'Close window', exact: true }).click();
    await closed;
    app = null;
    mark('reopen_same_task');
    await launch();
    await page.locator(SELECTORS.agentRosterItem).click();
    const project = page.locator(`button[data-builder-project-id="${projectId}"]`).locator('xpath=ancestor::li[1]');
    const task = project.locator(`button[data-builder-task-address-id="${taskAddressId}"]`);
    if (!await task.isVisible()) await project.locator('.cf-builder-agent-project-toggle').click();
    await task.click();
    }
    const reopened = await stream();
    fs.writeFileSync(path.join(output, 'reopened.json'), JSON.stringify(reopened, null, 2));
    await snapshot('02-reopened');
    await page.locator('[data-builder-composer-state="paused"]').waitFor({ state: 'visible', timeout: 30_000 });
    const paused = facts(await stream());
    assert.equal(paused.active_turn_id, null);
    assert.equal(paused.completed.at(-1).terminal_status, 'interrupted');
    assert.deepEqual(paused.runs, before.runs);
    assert.equal(await page.locator(SELECTORS.cancelWork).count(), 0);
    await snapshot('02-paused');
    mark('click_resume_and_approve_current_project_if_requested');
    await page.locator('[data-builder-resume-interrupted-run="true"]').click();
    let writeApproved = false;
    const resumed = await poll(async () => {
      if (await page.locator(SELECTORS.approveCurrentProjectWrite).isVisible()) {
        await page.locator(SELECTORS.approveCurrentProjectWrite).click();
        writeApproved = true;
      }
      return facts(await stream());
    }, (value) => value.runs.length === 2 && value.active_turn_id !== null, 'resume dispatch');
    assert.equal(resumed.submitted.length, 1);
    assert.equal(resumed.turn_ids.length, 1);
    await snapshot('03-resumed');
    mark('wait_for_actual_files_and_passed_check');
    const completed = await poll(async () => {
      const value = facts(await stream());
      const status = await page.locator(SELECTORS.projectPage).getAttribute('data-builder-project-status');
      if (['generation_failed', 'submit_failed'].includes(status)) throw new Error(`Resume failed: ${JSON.stringify(value)}`);
      return { ...value, status };
    }, (value) => value.active_turn_id === null
      && value.completed.at(-1)?.terminal_status === 'succeeded'
      && value.counts.programming_runtime_check_passed_count >= 1
      && value.status === 'draft_ready', 'real resumed completion', 240_000);
    assert.equal(completed.runs.length, 2, 'Resume started duplicate runs');
    assert.equal(completed.submitted.length, 1);
    assert.equal(completed.turn_ids.length, 1);
    await readSanitizedTaskStreamEvidence(page, projectId, 'canary_read_evidence_failed', taskAddressId);
    const html = fs.readFileSync(path.join(projectRoot, 'index.html'), 'utf8');
    assert.match(html, /Restart Resume Flow/u);
    assert.match(html, /Start/u);
    assert.equal(JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8')).scripts.test, 'node check.js');
    assert.ok(fs.readFileSync(path.join(projectRoot, 'check.js'), 'utf8').length > 0);
    assert.equal(fs.existsSync(path.join(projectRoot, 'node_modules')), false);
    await snapshot('04-completed');
    assert.equal(await page.getByText('Activity could not be refreshed', { exact: false }).count(), 0);
    mark('save_version_via_ui');
    await clickSaveVersionViaUi(page);
    await page.locator(SELECTORS.versionSavedActivity).waitFor({ state: 'visible', timeout: 30_000 });
    await page.locator(SELECTORS.unsavedDraft).waitFor({ state: 'hidden', timeout: 30_000 });
    assert.equal(await page.locator(SELECTORS.cancelWork).count(), 0);
    assert.equal(await page.locator('[data-builder-resume-interrupted-run="true"]').count(), 0);
    await snapshot('05-saved');

    const packageBeforeFollowup = fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8');
    const checkBeforeFollowup = fs.readFileSync(path.join(projectRoot, 'check.js'), 'utf8');
    mark('restart_after_completed_task');
    const completedClose = app.waitForEvent('close', { timeout: 30_000 });
    await page.getByRole('button', { name: 'Close window', exact: true }).click();
    await completedClose;
    app = null;
    await launch();
    await page.locator(SELECTORS.agentRosterItem).click();
    const completedProject = page.locator(`button[data-builder-project-id="${projectId}"]`)
      .locator('xpath=ancestor::li[1]');
    const completedTask = completedProject.locator(
      `button[data-builder-task-address-id="${taskAddressId}"]`,
    );
    if (!await completedTask.isVisible()) {
      await completedProject.locator('.cf-builder-agent-project-toggle').click();
    }
    await completedTask.click();
    await snapshot('06-completed-task-reopened');

    mark('submit_completed_task_followup');
    await page.locator(SELECTORS.idea).fill(COMPLETED_TASK_FOLLOWUP);
    await page.locator(SELECTORS.submitTurn).click();
    let followupWriteApproved = false;
    const followupStarted = await poll(async () => {
      if (await page.locator(SELECTORS.approveCurrentProjectWrite).isVisible()) {
        await page.locator(SELECTORS.approveCurrentProjectWrite).click();
        followupWriteApproved = true;
      }
      return facts(await stream());
    }, (value) => value.runs.length === 3 && value.active_turn_id !== null,
    'completed task follow-up dispatch');
    assert.equal(followupStarted.submitted.length, 2);
    assert.equal(followupStarted.submitted.at(-1), COMPLETED_TASK_FOLLOWUP);
    assert.equal(followupStarted.turn_ids.length, 2);
    await snapshot('07-followup-running');

    mark('wait_for_completed_task_followup');
    const followupCompleted = await poll(async () => {
      const value = facts(await stream());
      const status = await page.locator(SELECTORS.projectPage)
        .getAttribute('data-builder-project-status');
      if (['generation_failed', 'submit_failed'].includes(status)) {
        throw new Error(`Completed task follow-up failed: ${JSON.stringify(value)}`);
      }
      return { ...value, status };
    }, (value) => value.active_turn_id === null
      && value.runs.length === 3
      && value.completed.at(-1)?.terminal_status === 'succeeded'
      && value.counts.programming_runtime_check_passed_count
        > completed.counts.programming_runtime_check_passed_count
      && value.status === 'draft_ready', 'completed task follow-up completion', 240_000);
    const followupHtml = fs.readFileSync(path.join(projectRoot, 'index.html'), 'utf8');
    assert.match(followupHtml, /Retained session follow-up/u);
    assert.match(followupHtml, /data-continuation-marker=["']retained-session["']/u);
    assert.equal(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'), packageBeforeFollowup);
    assert.equal(fs.readFileSync(path.join(projectRoot, 'check.js'), 'utf8'), checkBeforeFollowup);
    assert.equal(fs.existsSync(path.join(projectRoot, 'node_modules')), false);
    await snapshot('08-followup-completed');
    mark('save_followup_version_via_ui');
    await clickSaveVersionViaUi(page);
    await page.locator(SELECTORS.unsavedDraft).waitFor({ state: 'hidden', timeout: 30_000 });
    await snapshot('09-followup-saved');
    const result = { ok: true, duration_ms: Date.now() - startedAt, project_id: projectId,
      task_address_id: taskAddressId, original_profile_and_projects_untouched: true,
      dependencies_installed: false, closed_via_window_button: !manualPause, paused_via_ui: manualPause, resumed_via_ui: true,
      current_project_write_approved: writeApproved, saved_via_ui: true,
      completed_task_followup_after_restart: true,
      completed_task_followup_write_approved: followupWriteApproved,
      completed_task_followup_saved_via_ui: true,
      before, paused, resumed, completed, followup_started: followupStarted,
      followup_completed: followupCompleted };
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
    if (writeSummary) process.stdout.write(`${JSON.stringify({ ok: true, duration_ms: result.duration_ms })}\n`);
    return result;
  } catch (error) {
    const storageDiagnostics = collectStorageDiagnostics(root.realPath);
    preserveFailureDiagnostics(root.realPath, output);
    const launchState = page && !page.isClosed() ? await page.evaluate(async () => {
      const rootBridge = globalThis.clawfabricBuilder;
      const settled = await Promise.allSettled([
        rootBridge?.agentProjectTree?.read?.({ agent_id: 'builder-agent:123e4567-e89b-42d3-a456-426614174002' }),
        rootBridge?.agentWorkbench?.read?.({
          agent_id: 'builder-agent:123e4567-e89b-42d3-a456-426614174002',
          after_cursor: null,
          limit: 20,
        }),
      ]);
      return settled.map((item) => (item.status === 'fulfilled'
        ? { status: item.status, value: item.value }
        : { status: item.status, reason: String(item.reason?.message ?? item.reason) }));
    }).catch(() => null) : null;
    if (page && !page.isClosed() && projectId && taskAddressId) {
      const state = await page.evaluate((target) => globalThis.clawfabricBuilder.taskStream.read(target),
        { project_id: projectId, task_address_id: taskAddressId }).catch(() => null);
      fs.writeFileSync(path.join(output, 'failure-stream.json'), JSON.stringify(state, null, 2));
    }
    if (page && !page.isClosed()) await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
    fs.writeFileSync(path.join(output, 'failure.json'), JSON.stringify({ stage, message: error.message,
      code: error.code, diagnostic: error.diagnostic, launch_state: launchState,
      launch_diagnostics: launchDiagnostics, storage_diagnostics: storageDiagnostics }, null, 2));
    throw error;
  } finally {
    if (app) await app.close();
    assert.equal(fs.realpathSync.native(userData), root.realPath);
    assert.equal(path.dirname(root.realPath).toLowerCase(), fs.realpathSync.native(os.tmpdir()).toLowerCase());
    assert.ok(path.basename(root.realPath).startsWith(PACKAGED_CANARY_USER_DATA_PREFIX));
    fs.rmSync(root.realPath, { force: true, recursive: true });
  }
}

module.exports = Object.freeze({
  COMPLETED_TASK_FOLLOWUP,
  IDEA,
  run,
});

if (require.main === module) run(process.argv[2] ? path.resolve(process.argv[2]) : undefined, process.argv.includes('--pause')).catch((error) => {
  process.stderr.write(`${error.stack}\n`); process.exitCode = 1;
});
