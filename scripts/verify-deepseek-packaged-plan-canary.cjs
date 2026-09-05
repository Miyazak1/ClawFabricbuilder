'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');

const {
  PACKAGED_CANARY_USER_DATA_PREFIX,
  SELECTORS,
  approveCurrentProjectWriteIfRequested,
  approvePlanSourceReadIfRequested,
  assertCustomChromeControls,
  captureGuardedUserDataRoot,
  copySavedProviderProfile,
  createCanaryProjectRoot,
  readSanitizedTaskStreamEvidence,
  readStdin,
  sanitizeLaunchEnvironment,
} = require('./verify-packaged-canary.cjs');
const {
  parseDeepSeekCanaryInput,
  sanitizeDeepSeekCanaryInput,
  toPackagedCanaryInput,
} = require('./verify-deepseek-packaged-canary.cjs');

const RESULT_VERSION = 'builder-deepseek-packaged-plan-canary-result.v1';
const DEFAULT_SCENARIO = 'existing_fixture_plan';
const EMPTY_APPROVED_PLAN_SCENARIO = 'empty_approved_plan';
const PLAN_INSTRUCTION = [
  '为当前的专注计时器制定一个简短实施计划。',
  '计划只包含：将标题改为“专注时间”、添加一句中文副标题、运行 npm test。',
  '现在只生成计划，不要编辑文件。',
].join(' ');
const EMPTY_PROJECT_PLAN_INSTRUCTION = [
  '为这个空项目制定一个简短实施计划。',
  '计划只包含：创建一个最小 Focus Timer 页面，写入 index.html、package.json 和 check.js。',
  'index.html 需要包含 h1 文本“专注时间”和一句中文副标题。',
  'package.json 需要提供 npm test，check.js 需要验证 index.html 中的 h1。',
  '现在只生成计划，不要编辑文件。',
].join(' ');
const SEMANTIC_PLAN_INSTRUCTION = '帮我做一个当前专注计时器的实施方案，只改中文标题和副标题，最后运行 npm test。';
const FOLLOW_UP_QUESTION = '刚才的计划现在是什么状态？请用中文简短回答。';
const PROJECT_USAGE_QUESTION = '这个已完成的项目应该怎么运行和使用？请根据当前项目文件用中文给出具体步骤。';
const PLAN_TIMEOUT_MS = 180_000;
const BUILD_TIMEOUT_MS = 600_000;

class DeepSeekPackagedPlanCanaryError extends Error {
  constructor(code, diagnostic = undefined) {
    super('The real-provider Plan canary did not complete.');
    this.name = 'DeepSeekPackagedPlanCanaryError';
    this.code = typeof code === 'string' ? code : 'deepseek_plan_canary_failed';
    this.diagnostic = diagnostic;
  }
}

function fail(code, diagnostic = undefined) {
  throw new DeepSeekPackagedPlanCanaryError(code, diagnostic);
}

function seedFixture(projectRoot) {
  fs.writeFileSync(path.join(projectRoot, 'index.html'), [
    '<!doctype html>',
    '<html lang="zh-CN">',
    '<head><meta charset="utf-8"><title>Focus Timer</title></head>',
    '<body><main><h1>Focus Timer</h1><p>A compact timer.</p></main></body>',
    '</html>',
    '',
  ].join('\n'), { encoding: 'utf8', flag: 'wx' });
  fs.writeFileSync(path.join(projectRoot, 'package.json'), `${JSON.stringify({
    name: 'builder-deepseek-plan-canary',
    private: true,
    scripts: { test: 'node check.js' },
    version: '1.0.0',
  }, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  fs.writeFileSync(path.join(projectRoot, 'check.js'), [
    "'use strict';",
    "const fs = require('node:fs');",
    "const html = fs.readFileSync('index.html', 'utf8');",
    "if (!html.includes('<h1>专注时间</h1>')) process.exit(1);",
    '',
  ].join('\n'), { encoding: 'utf8', flag: 'wx' });
}

async function optionalVisible(page, selector) {
  try { return await page.locator(selector).first().isVisible(); } catch { return false; }
}

async function diagnostic(page, stage, projectId = null) {
  let counts = null;
  if (projectId !== null) {
    try {
      counts = (await readSanitizedTaskStreamEvidence(page, projectId)).conversation?.item_facts?.counts ?? null;
    } catch { counts = null; }
  }
  return Object.freeze({
    stage,
    project_status: await page.locator(SELECTORS.projectPage)
      .getAttribute('data-builder-project-status').catch(() => null),
    conversation_project_id: await page.locator(SELECTORS.projectPage)
      .getAttribute('data-builder-conversation-project-id').catch(() => null),
    composer_visible: await optionalVisible(page, SELECTORS.composer),
    composer_status: await page.locator(SELECTORS.composerStatus).textContent().catch(() => null),
    composer_route: await page.locator(SELECTORS.composer).getAttribute('data-builder-route').catch(() => null),
    composer_dispatch: await page.locator(SELECTORS.composer)
      .getAttribute('data-builder-route-dispatch').catch(() => null),
    submit_disabled: await page.locator(SELECTORS.submitTurn).isDisabled().catch(() => null),
    input_disabled: await page.locator(SELECTORS.idea).isDisabled().catch(() => null),
    live_output_visible: await optionalVisible(page, SELECTORS.liveOutput),
    busy_work_visible: await optionalVisible(page, '[data-builder-busy-work="true"]'),
    plan_review_visible: await optionalVisible(page, SELECTORS.planReviewActions),
    source_read_approval_visible: await optionalVisible(page, SELECTORS.planSourceReadApproval),
    write_approval_visible: await optionalVisible(page, SELECTORS.currentProjectWriteApproval),
    generation_failed_visible: await optionalVisible(page, SELECTORS.generationFailedNotice),
    task_stream_counts: counts,
  });
}

async function waitForSidebarNewProjectReady(page) {
  try {
    await page.locator(`${SELECTORS.projectPage}[data-builder-project-status="ready"]`).
      waitFor({ state: 'visible', timeout: 45_000 });
    await page.locator(SELECTORS.composer).waitFor({ state: 'visible', timeout: 15_000 });
    await page.waitForFunction((selector) => {
      const node = document.querySelector(selector);
      return node !== null
        && node.tagName === 'TEXTAREA'
        && node.disabled === false;
    }, SELECTORS.idea, { timeout: 15_000 });
  } catch (error) {
    if (error instanceof DeepSeekPackagedPlanCanaryError) throw error;
    fail('deepseek_plan_workspace_bind_failed', Object.freeze({
      ...(await diagnostic(page, 'workspace_bind')),
      agent_workbench_visible: await optionalVisible(page, '[data-builder-agent-workbench-stream="true"]'),
      new_project_panel_visible: await optionalVisible(page, SELECTORS.newProjectPanel),
      workspace_picker_visible: await optionalVisible(page, SELECTORS.workspacePicker),
    }));
  }
}

async function waitForSubmitEnabled(page, projectId, stage, timeoutMs = 15_000) {
  try {
    await page.waitForFunction((selector) => {
      /* global document, HTMLButtonElement */
      const node = document.querySelector(selector);
      return node instanceof HTMLButtonElement && node.disabled === false;
    }, SELECTORS.submitTurn, { timeout: timeoutMs });
  } catch {
    fail('deepseek_plan_submit_remained_locked', await diagnostic(page, stage, projectId));
  }
}

async function assertPlanTerminalUi(page, projectId, stage) {
  try {
    await page.locator(`${SELECTORS.projectPage}[data-builder-project-status="ready"]`)
      .waitFor({ state: 'visible', timeout: 15_000 });
    await page.locator(SELECTORS.liveOutput).waitFor({ state: 'hidden', timeout: 15_000 });
    await page.locator('[data-builder-busy-work="true"]')
      .waitFor({ state: 'hidden', timeout: 15_000 });
    if (
      await page.locator(SELECTORS.approvePlan).isDisabled()
      || await page.locator(SELECTORS.rejectPlan).isDisabled()
    ) fail('deepseek_plan_review_actions_disabled', await diagnostic(page, stage, projectId));
  } catch (error) {
    if (error instanceof DeepSeekPackagedPlanCanaryError) throw error;
    fail('deepseek_plan_terminal_ui_stuck', await diagnostic(page, stage, projectId));
  }
}

async function selectMode(page, mode) {
  const selector = mode === 'ask'
    ? SELECTORS.composerAddAskMode
    : mode === 'build'
      ? SELECTORS.composerAddBuildMode
      : SELECTORS.composerAddPlanMode;
  await page.locator(SELECTORS.composerAddMenuButton).click();
  await page.locator(selector).click();
  await page.locator(`[data-builder-composer-mode-chip="${mode}"]`)
    .waitFor({ state: 'visible', timeout: 10_000 });
}

async function submitPlan(page, instruction, explicitMode) {
  if (explicitMode) await selectMode(page, 'plan');
  await page.locator(SELECTORS.idea).fill(instruction);
  await page.locator(SELECTORS.submitTurn).click();
  await approvePlanSourceReadIfRequested(page);
  const outcome = await Promise.race([
    page.locator(SELECTORS.planReviewActions).waitFor({ state: 'visible', timeout: PLAN_TIMEOUT_MS })
      .then(() => 'ready', () => 'timeout'),
    page.locator(SELECTORS.generationFailedNotice).waitFor({ state: 'visible', timeout: PLAN_TIMEOUT_MS })
      .then(() => 'failed', () => 'failure_timeout'),
  ]);
  if (outcome !== 'ready') fail('deepseek_plan_not_ready', await diagnostic(page, 'plan_generation'));
  await page.locator(SELECTORS.planMarkdown).last().waitFor({ state: 'visible', timeout: 30_000 });
}

async function waitForBuildClosure(page, projectId) {
  const deadline = Date.now() + BUILD_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const evidence = await readSanitizedTaskStreamEvidence(page, projectId)
      .catch(() => null);
    const stream = evidence?.conversation;
    const counts = stream?.item_facts?.counts;
    if (
      stream?.recorded_active_turn_id === null
      && counts?.candidate_ready_count >= 1
      && counts?.programming_runtime_check_passed_count >= 1
    ) return counts;
    if (await optionalVisible(page, SELECTORS.generationFailedNotice)) {
      fail('deepseek_plan_build_failed', await diagnostic(page, 'approved_plan_build', projectId));
    }
    await page.waitForTimeout(500);
  }
  fail('deepseek_plan_build_timeout', await diagnostic(page, 'approved_plan_build', projectId));
}

function removeGuardedRoot(root) {
  const resolved = path.resolve(root.path);
  if (
    path.dirname(resolved) !== path.resolve(os.tmpdir())
    || !path.basename(resolved).startsWith(PACKAGED_CANARY_USER_DATA_PREFIX)
  ) fail('deepseek_plan_cleanup_failed');
  fs.rmSync(resolved, { recursive: true, force: true });
}

async function runDeepSeekPackagedPlanCanary(rawInput, options = {}) {
  const input = sanitizeDeepSeekCanaryInput(rawInput);
  const packagedInput = toPackagedCanaryInput(input);
  const rawEnv = options.env ?? process.env;
  const scenario = options.scenario
    ?? (rawEnv.BUILDER_DEEPSEEK_PLAN_CANARY_SCENARIO === EMPTY_APPROVED_PLAN_SCENARIO
      ? EMPTY_APPROVED_PLAN_SCENARIO
      : DEFAULT_SCENARIO);
  const rawUserDataPath = options.userDataPath
    ?? fs.mkdtempSync(path.join(os.tmpdir(), PACKAGED_CANARY_USER_DATA_PREFIX));
  let app = null;
  let root = null;
  let result = null;
  let primaryError = null;
  let stage = 'setup';
  try {
    root = captureGuardedUserDataRoot(rawUserDataPath, fs, os);
    const projectRoot = createCanaryProjectRoot(root, fs, os);
    copySavedProviderProfile(packagedInput, root, fs);
    stage = 'launch';
    app = await (options.electron ?? electron).launch({
      args: [],
      executablePath: packagedInput.executable_path,
      env: sanitizeLaunchEnvironment(rawEnv, root.path, projectRoot),
    });
    const page = await app.firstWindow();
    stage = 'workspace_create';
    await assertCustomChromeControls(page);
    await page.locator(SELECTORS.catalogNewProject).first().click();
    stage = 'workspace_bind';
    await waitForSidebarNewProjectReady(page);
    stage = 'fixture_seed';
    if (scenario === DEFAULT_SCENARIO) seedFixture(projectRoot);
    stage = 'explicit_plan';
    await submitPlan(
      page,
      scenario === EMPTY_APPROVED_PLAN_SCENARIO ? EMPTY_PROJECT_PLAN_INSTRUCTION : PLAN_INSTRUCTION,
      true,
    );
    const projectId = await page.locator('[data-builder-route-project-id]').first()
      .getAttribute('data-builder-route-project-id');
    if (!/^builder-project:[0-9a-f-]{36}$/u.test(projectId ?? '')) {
      fail('deepseek_plan_project_identity_failed');
    }
    await assertPlanTerminalUi(page, projectId, 'explicit_plan_ready');
    if (scenario === EMPTY_APPROVED_PLAN_SCENARIO) {
      stage = 'empty_approved_plan_build';
      await page.getByRole('button', { exact: true, name: 'Approve plan' }).click();
      await approveCurrentProjectWriteIfRequested(page);
      const counts = await waitForBuildClosure(page, projectId);
      await page.locator(SELECTORS.draftProposed).last()
        .waitFor({ state: 'visible', timeout: 30_000 });
      result = Object.freeze({
        result_version: RESULT_VERSION,
        scenario,
        empty_project_plan_ready: true,
        empty_project_approved_plan_reached_harness_build:
          counts.programming_runtime_assistant_message_count > 0
          && counts.programming_runtime_tool_activity_count > 0,
        empty_project_candidate_ready: counts.candidate_ready_count >= 1,
        empty_project_check_passed: counts.programming_runtime_check_passed_count >= 1,
        composer_reenabled_after_completion: true,
      });
    } else {
      await page.getByRole('button', { exact: true, name: 'Reject' }).click();
      await page.locator(SELECTORS.planReviewActions).waitFor({ state: 'hidden', timeout: 30_000 });

      stage = 'rejected_plan_follow_up';
      await selectMode(page, 'ask');
      const answersBefore = await page.locator(SELECTORS.questionAnswer).count();
      await page.locator(SELECTORS.idea).fill(FOLLOW_UP_QUESTION);
      await waitForSubmitEnabled(page, projectId, 'after_plan_reject');
      await page.locator(SELECTORS.submitTurn).click();
      await page.locator(SELECTORS.questionAnswer).nth(answersBefore)
        .waitFor({ state: 'visible', timeout: PLAN_TIMEOUT_MS });
      await page.locator(SELECTORS.composerClearMode).click();

      stage = 'semantic_plan';
      await submitPlan(page, SEMANTIC_PLAN_INSTRUCTION, false);
      await assertPlanTerminalUi(page, projectId, 'semantic_plan_ready');
      const route = await page.locator(SELECTORS.composer).getAttribute('data-builder-route');
      const dispatch = await page.locator(SELECTORS.composer).getAttribute('data-builder-route-dispatch');
      if (route !== 'plan' || dispatch !== 'plan') {
        fail('deepseek_semantic_plan_route_failed', await diagnostic(page, 'semantic_plan_route', projectId));
      }
      stage = 'approved_plan_build';
      await page.getByRole('button', { exact: true, name: 'Approve plan' }).click();
      await approveCurrentProjectWriteIfRequested(page);
      const counts = await waitForBuildClosure(page, projectId);
      await page.locator(SELECTORS.draftProposed).last()
        .waitFor({ state: 'visible', timeout: 30_000 });
      stage = 'completed_project_usage_follow_up';
      await selectMode(page, 'ask');
      const usageAnswersBefore = await page.locator(SELECTORS.questionAnswer).count();
      await page.locator(SELECTORS.idea).fill(PROJECT_USAGE_QUESTION);
      await waitForSubmitEnabled(page, projectId, 'approved_plan_completed', 30_000);
      await page.locator(SELECTORS.submitTurn).click();
      const usageAnswer = page.locator(SELECTORS.questionAnswer).nth(usageAnswersBefore);
      await usageAnswer.waitFor({ state: 'visible', timeout: PLAN_TIMEOUT_MS });
      const usageAnswerText = (await usageAnswer.textContent())?.trim() ?? '';
      if (!/npm test|index\.html/u.test(usageAnswerText)) {
        fail('deepseek_plan_usage_answer_not_grounded', Object.freeze({
          answer_length: usageAnswerText.length,
          contains_chinese: /[\u3400-\u9fff]/u.test(usageAnswerText),
        }));
      }

      result = Object.freeze({
        result_version: RESULT_VERSION,
        scenario,
        explicit_plan_terminal_ui_settled: true,
        explicit_plan_rejected_and_followed_up: true,
        natural_language_plan_routed: true,
        approved_plan_reached_harness_build:
          counts.programming_runtime_assistant_message_count > 0
          && counts.programming_runtime_tool_activity_count > 0,
        approved_plan_check_passed: counts.programming_runtime_check_passed_count >= 1,
        final_summary_visible: true,
        composer_reenabled_after_completion: true,
        project_usage_answer_grounded: true,
      });
    }
  } catch (error) {
    primaryError = error instanceof DeepSeekPackagedPlanCanaryError
      ? error
      : new DeepSeekPackagedPlanCanaryError('deepseek_plan_canary_failed', Object.freeze({
        stage,
        cause_code: typeof error?.code === 'string' ? error.code.slice(0, 96) : null,
        cause_diagnostic: error?.diagnostic ?? null,
        cause_message: error instanceof Error ? error.message.slice(0, 500) : null,
      }));
  }
  try { if (app !== null) await app.close(); } catch {
    if (primaryError === null) primaryError = new DeepSeekPackagedPlanCanaryError('deepseek_plan_cleanup_failed');
  }
  try { if (root !== null) removeGuardedRoot(root); } catch {
    if (primaryError === null) primaryError = new DeepSeekPackagedPlanCanaryError('deepseek_plan_cleanup_failed');
  }
  if (primaryError !== null) throw primaryError;
  return result;
}

async function runCli({ argv = process.argv.slice(2), stdin = process.stdin, stdout = process.stdout } = {}) {
  if (!Array.isArray(argv) || argv.length !== 1 || argv[0] !== '--execute') {
    fail('deepseek_plan_canary_input_invalid');
  }
  const result = await runDeepSeekPackagedPlanCanary(
    parseDeepSeekCanaryInput(await readStdin(stdin)),
  );
  stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

module.exports = Object.freeze({
  DeepSeekPackagedPlanCanaryError,
  PLAN_INSTRUCTION,
  EMPTY_APPROVED_PLAN_SCENARIO,
  EMPTY_PROJECT_PLAN_INSTRUCTION,
  RESULT_VERSION,
  SEMANTIC_PLAN_INSTRUCTION,
  runCli,
  runDeepSeekPackagedPlanCanary,
});

if (require.main === module) {
  runCli().catch((error) => {
    const fixed = error instanceof DeepSeekPackagedPlanCanaryError
      ? error
      : new DeepSeekPackagedPlanCanaryError('deepseek_plan_canary_failed');
    process.stderr.write(`${JSON.stringify({
      ok: false,
      code: fixed.code,
      message: fixed.message,
      diagnostic: fixed.diagnostic,
    })}\n`);
    process.exitCode = 1;
  });
}
