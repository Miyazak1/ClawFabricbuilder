'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');
const { PNG } = require('pngjs');

const {
  assertCustomChromeControls,
  createArtifactGate,
  createInitialDraftViaUi,
  fillProviderSettingsViaUi,
  readSanitizedTaskStreamEvidence,
  SELECTORS,
  sanitizeLaunchEnvironment,
} = require('./verify-packaged-canary.cjs');
const {
  createLocalCanaryProviderServer,
} = require('./verify-packaged-canary-default.cjs');
const {
  DEFAULT_BUILDER_AGENT_ID,
} = require('../electron/builder-default-agent-bootstrap.cjs');

const USER_DATA_PREFIX = 'clawfabric-builder-packaged-canary-';
const PERFORMANCE_TRACE_FILE = 'builder-performance-trace.v1.json';
const A04_PERFORMANCE_BUDGETS = Object.freeze({
  initial: Object.freeze({
    activity_commits: 100,
    builder_page_commits: 200,
    controller_publishes: 40,
    renderer_result_p95_bytes: 16 * 1024,
    side_workspace_commits: 20,
  }),
  restart: Object.freeze({
    activity_commits: 260,
    builder_page_commits: 280,
    controller_publishes: 50,
    renderer_read_p95_ms: 1_845.6,
    renderer_result_p95_bytes: 64 * 1024,
    side_workspace_commits: 40,
  }),
});

function sanitizePerformanceTrace(rawTrace, expectedVersion) {
  if (
    rawTrace === null
    || typeof rawTrace !== 'object'
    || Array.isArray(rawTrace)
    || rawTrace.trace_version !== expectedVersion
    || !Array.isArray(rawTrace.metrics)
    || rawTrace.privacy?.content_fields_recorded !== false
    || rawTrace.privacy?.identifiers_recorded !== false
    || rawTrace.privacy?.paths_recorded !== false
    || rawTrace.privacy?.urls_recorded !== false
  ) throw new Error('Packaged Harness performance trace is invalid.');
  const metrics = rawTrace.metrics.map((metric) => {
    if (
      metric === null
      || typeof metric !== 'object'
      || typeof metric.name !== 'string'
      || !/^(?:main|renderer)\.[a-z0-9_.]+$/u.test(metric.name)
      || !Number.isSafeInteger(metric.count)
      || metric.count < 0
      || !Number.isSafeInteger(metric.sample_count)
      || metric.sample_count < 0
      || !['total', 'median', 'p95', 'max'].every(
        (key) => Number.isFinite(metric[key]) && metric[key] >= 0,
      )
    ) throw new Error('Packaged Harness performance metric is invalid.');
    return Object.freeze({
      name: metric.name,
      count: metric.count,
      sample_count: metric.sample_count,
      total: metric.total,
      median: metric.median,
      p95: metric.p95,
      max: metric.max,
    });
  });
  const eventLoopWindows = (rawTrace.event_loop_windows ?? []).map((entry) => {
    if (
      entry === null
      || typeof entry !== 'object'
      || !/^[a-z0-9_]+$/u.test(entry.name ?? '')
      || !['active', 'completed'].includes(entry.status)
      || !Number.isSafeInteger(entry.started_at_ms)
      || entry.started_at_ms < 0
      || !Number.isSafeInteger(entry.sample_count)
      || entry.sample_count < 0
      || !['duration_ms', 'mean_ms', 'p95_ms', 'max_ms'].every(
        (key) => Number.isFinite(entry[key]) && entry[key] >= 0,
      )
    ) throw new Error('Packaged Harness event-loop window trace is invalid.');
    return Object.freeze({
      name: entry.name,
      status: entry.status,
      started_at_ms: entry.started_at_ms,
      duration_ms: entry.duration_ms,
      sample_count: entry.sample_count,
      mean_ms: entry.mean_ms,
      p95_ms: entry.p95_ms,
      max_ms: entry.max_ms,
    });
  });
  return Object.freeze({
    trace_version: rawTrace.trace_version,
    metrics: Object.freeze(metrics),
    privacy: Object.freeze({ ...rawTrace.privacy }),
    event_loop_windows: Object.freeze(eventLoopWindows),
    ...(rawTrace.event_loop_delay === undefined
      ? {}
      : { event_loop_delay: Object.freeze({ ...rawTrace.event_loop_delay }) }),
  });
}

function readMainPerformanceTrace(userDataPath) {
  const tracePath = path.join(userDataPath, PERFORMANCE_TRACE_FILE);
  return sanitizePerformanceTrace(
    JSON.parse(fs.readFileSync(tracePath, 'utf8')),
    'builder-performance-trace.v1',
  );
}

async function readRendererPerformanceTrace(page) {
  const trace = await page.evaluate(() => globalThis.__builderPerformanceTraceSnapshot?.() ?? null);
  return sanitizePerformanceTrace(trace, 'builder-renderer-performance-trace.v1');
}

function requiredMetric(trace, name) {
  const metric = trace.metrics.find((candidate) => candidate.name === name);
  if (metric === undefined) throw new Error(`Packaged Harness metric is missing: ${name}`);
  return metric;
}

function assertA04PerformanceGate(performanceSessions) {
  const initial = performanceSessions.find((session) => (
    session.phase === 'initial_build_and_continuation'
  ));
  const restart = performanceSessions.find((session) => (
    session.phase === 'restart_recovery_multi_tool_preview_cancel_save'
  ));
  if (initial === undefined || restart === undefined) {
    throw new Error('Packaged Harness A0.4 performance sessions are incomplete.');
  }

  const qualification = Object.freeze({
    initial: Object.freeze({
      activity_commits: requiredMetric(initial.renderer, 'renderer.activity.commit_count').count,
      builder_page_commits: requiredMetric(
        initial.renderer,
        'renderer.builder_page.commit_count',
      ).count,
      controller_publishes: requiredMetric(
        initial.renderer,
        'renderer.task_stream.controller_publish_count',
      ).count,
      cursor_full: requiredMetric(initial.renderer, 'renderer.task_stream.cursor.full_count').count,
      cursor_incremental: requiredMetric(
        initial.renderer,
        'renderer.task_stream.cursor.incremental_count',
      ).count,
      cursor_unchanged: requiredMetric(
        initial.renderer,
        'renderer.task_stream.cursor.unchanged_count',
      ).count,
      renderer_result_p95_bytes: requiredMetric(
        initial.renderer,
        'renderer.task_stream.read.result_bytes',
      ).p95,
      side_workspace_commits: requiredMetric(
        initial.renderer,
        'renderer.side_workspace.commit_count',
      ).count,
      side_workspace_mounts: requiredMetric(
        initial.renderer,
        'renderer.side_workspace.mount_count',
      ).count,
    }),
    restart: Object.freeze({
      activity_commits: requiredMetric(restart.renderer, 'renderer.activity.commit_count').count,
      builder_page_commits: requiredMetric(
        restart.renderer,
        'renderer.builder_page.commit_count',
      ).count,
      controller_publishes: requiredMetric(
        restart.renderer,
        'renderer.task_stream.controller_publish_count',
      ).count,
      cursor_full: requiredMetric(restart.renderer, 'renderer.task_stream.cursor.full_count').count,
      cursor_incremental: requiredMetric(
        restart.renderer,
        'renderer.task_stream.cursor.incremental_count',
      ).count,
      cursor_unchanged: requiredMetric(
        restart.renderer,
        'renderer.task_stream.cursor.unchanged_count',
      ).count,
      renderer_read_p95_ms: requiredMetric(
        restart.renderer,
        'renderer.task_stream.read.duration_ms',
      ).p95,
      renderer_result_p95_bytes: requiredMetric(
        restart.renderer,
        'renderer.task_stream.read.result_bytes',
      ).p95,
      side_workspace_commits: requiredMetric(
        restart.renderer,
        'renderer.side_workspace.commit_count',
      ).count,
      side_workspace_mounts: requiredMetric(
        restart.renderer,
        'renderer.side_workspace.mount_count',
      ).count,
    }),
  });
  const cursorKindsObserved = [qualification.initial, qualification.restart].every((phase) => (
    phase.cursor_full > 0 && phase.cursor_incremental > 0 && phase.cursor_unchanged > 0
  ));
  const initialWithinBudget = (
    qualification.initial.activity_commits <= A04_PERFORMANCE_BUDGETS.initial.activity_commits
    && qualification.initial.builder_page_commits
      <= A04_PERFORMANCE_BUDGETS.initial.builder_page_commits
    && qualification.initial.controller_publishes
      <= A04_PERFORMANCE_BUDGETS.initial.controller_publishes
    && qualification.initial.renderer_result_p95_bytes
      <= A04_PERFORMANCE_BUDGETS.initial.renderer_result_p95_bytes
    && qualification.initial.side_workspace_commits
      <= A04_PERFORMANCE_BUDGETS.initial.side_workspace_commits
    && qualification.initial.side_workspace_mounts === 1
  );
  const restartWithinBudget = (
    qualification.restart.activity_commits <= A04_PERFORMANCE_BUDGETS.restart.activity_commits
    && qualification.restart.builder_page_commits
      <= A04_PERFORMANCE_BUDGETS.restart.builder_page_commits
    && qualification.restart.controller_publishes
      <= A04_PERFORMANCE_BUDGETS.restart.controller_publishes
    && qualification.restart.renderer_read_p95_ms
      <= A04_PERFORMANCE_BUDGETS.restart.renderer_read_p95_ms
    && qualification.restart.renderer_result_p95_bytes
      <= A04_PERFORMANCE_BUDGETS.restart.renderer_result_p95_bytes
    && qualification.restart.side_workspace_commits
      <= A04_PERFORMANCE_BUDGETS.restart.side_workspace_commits
    && qualification.restart.side_workspace_mounts === 1
  );
  if (!cursorKindsObserved || !initialWithinBudget || !restartWithinBudget) {
    throw new Error(`Packaged Harness A0.4 performance gate failed: ${JSON.stringify({
      budgets: A04_PERFORMANCE_BUDGETS,
      cursorKindsObserved,
      initialWithinBudget,
      qualification,
      restartWithinBudget,
    })}`);
  }
  return qualification;
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
  ) throw new Error('Canary cleanup root is invalid.');
  fs.rmSync(resolved, { recursive: true, force: true });
}

async function delay(milliseconds) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function harnessRequests(providerServer) {
  return providerServer.snapshot().filter((request) => (
    typeof request.response_kind === 'string'
    && request.response_kind.startsWith('harness_')
  ));
}

function currentUndoDraft(page) {
  return page.locator([
    '[data-builder-undo-draft="true"]:not([disabled]):visible',
    '[data-builder-chat-undo-checkpoint="true"]:not([disabled]):visible',
    '[data-builder-history-undo="true"]:not([disabled]):visible',
  ].join(', ')).last();
}

async function waitForSubmitEnabled(page) {
  const submit = page.locator(SELECTORS.submitTurn).first();
  await submit.waitFor({ state: 'visible', timeout: 30_000 });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await submit.isEnabled().catch(() => false)) return submit;
    await delay(100);
  }
  throw new Error('Packaged Harness continuation did not become sendable.');
}

async function selectBuildMode(page) {
  const chip = page.locator('[data-builder-composer-mode-chip="build"]');
  if (await chip.isVisible().catch(() => false)) return;
  await page.locator(SELECTORS.composerAddMenuButton).click();
  const option = page.locator(SELECTORS.composerAddBuildMode);
  await option.waitFor({ state: 'visible', timeout: 10_000 });
  if (await option.isDisabled().catch(() => false)) {
    throw new Error('Packaged Harness Build mode was disabled.');
  }
  await option.click();
  await chip.waitFor({ state: 'visible', timeout: 10_000 });
}

function screenshotHasVisualVariation(buffer) {
  const image = PNG.sync.read(buffer);
  if (image.width < 240 || image.height < 120) return false;
  const baseline = image.data.subarray(0, 4);
  let changedPixels = 0;
  for (let index = 0; index < image.data.length; index += 4) {
    const difference = Math.abs(image.data[index] - baseline[0])
      + Math.abs(image.data[index + 1] - baseline[1])
      + Math.abs(image.data[index + 2] - baseline[2]);
    if (difference >= 18 && image.data[index + 3] > 0) changedPixels += 1;
  }
  return changedPixels >= 200;
}

async function inspectCurrentRecoveryHistory(page) {
  await page.locator('[data-builder-workspace-menu-button="true"]').click();
  const historyMenuItem = page.locator('[data-builder-workspace-control-tab="versions"]');
  await historyMenuItem.waitFor({ state: 'visible', timeout: 10_000 });
  if ((await historyMenuItem.textContent())?.includes('History') !== true) {
    throw new Error('Packaged Harness History workspace was not named correctly.');
  }
  await historyMenuItem.click();
  const panel = page.locator('[data-builder-project-history="true"]');
  const recovery = panel.locator('[data-builder-draft-recovery-card="true"]');
  const timeline = panel.locator('[data-builder-checkpoint-timeline="true"]');
  const undo = recovery.locator('[data-builder-history-undo="true"]');
  await recovery.waitFor({ state: 'visible', timeout: 10_000 });
  await timeline.waitFor({ state: 'visible', timeout: 10_000 });
  if (
    (await recovery.textContent())?.includes('Checkpoint saved.') !== true
    || await timeline.locator('[data-builder-checkpoint-sequence]').count() < 1
    || await undo.isEnabled() !== true
  ) throw new Error('Packaged Harness current recovery history is incomplete.');
  const layout = await panel.evaluate((element) => {
    const recoveryElement = element.querySelector('[data-builder-draft-recovery-card="true"]');
    const timelineElement = element.querySelector('[data-builder-checkpoint-timeline="true"]');
    const undoElement = element.querySelector('[data-builder-history-undo="true"]');
    if (!(recoveryElement instanceof globalThis.HTMLElement)
      || !(timelineElement instanceof globalThis.HTMLElement)
      || !(undoElement instanceof globalThis.HTMLElement)) return null;
    const panelRect = element.getBoundingClientRect();
    const recoveryRect = recoveryElement.getBoundingClientRect();
    const undoRect = undoElement.getBoundingClientRect();
    const timelineRect = timelineElement.getBoundingClientRect();
    const summary = recoveryElement.querySelector('.cf-builder-version-summary');
    const timelineTitle = timelineElement.querySelector('.cf-builder-checkpoint-timeline-title');
    const summaryStyle = summary === null ? null : globalThis.getComputedStyle(summary);
    const timelineTitleStyle = timelineTitle === null
      ? null
      : globalThis.getComputedStyle(timelineTitle);
    return {
      panel_width: panelRect.width,
      recovery_inside_panel:
        recoveryRect.left >= panelRect.left - 1 && recoveryRect.right <= panelRect.right + 1,
      undo_inside_recovery:
        undoRect.left >= recoveryRect.left - 1 && undoRect.right <= recoveryRect.right + 1,
      timeline_inside_panel:
        timelineRect.left >= panelRect.left - 1 && timelineRect.right <= panelRect.right + 1,
      horizontal_overflow: element.scrollWidth > element.clientWidth + 1,
      summary_font_size: summaryStyle?.fontSize ?? null,
      summary_line_height: summaryStyle?.lineHeight ?? null,
      timeline_title_font_size: timelineTitleStyle?.fontSize ?? null,
    };
  });
  if (
    layout === null
    || layout.panel_width < 280
    || !layout.recovery_inside_panel
    || !layout.undo_inside_recovery
    || !layout.timeline_inside_panel
    || layout.horizontal_overflow
    || layout.summary_font_size !== '12px'
    || layout.timeline_title_font_size !== '12px'
  ) throw new Error(`Packaged Harness History layout is invalid: ${JSON.stringify(layout)}`);
  const screenshot = await panel.screenshot();
  if (!screenshotHasVisualVariation(screenshot)) {
    throw new Error('Packaged Harness History screenshot did not contain visible UI detail.');
  }
  return Object.freeze({
    current_recovery_visible: true,
    earlier_checkpoint_timeline_visible: true,
    undo_visible: true,
    visual_bounds_verified: true,
    screenshot_verified: true,
  });
}

async function waitForTaskStreamCounts(page, projectId, predicate, code) {
  const deadline = Date.now() + 120_000;
  let counts = null;
  while (Date.now() < deadline) {
    const taskStream = await readSanitizedTaskStreamEvidence(page, projectId).catch(() => null);
    counts = taskStream?.conversation?.item_facts?.counts ?? null;
    if (counts !== null && predicate(counts)) return counts;
    await delay(250);
  }
  throw new Error(`${code}: ${JSON.stringify(counts)}`);
}

async function readRuntimeNarrationEvidence(page) {
  return page.evaluate(() => {
    const entries = Array.from(globalThis.document.querySelectorAll(
      '[data-builder-runtime-assistant-message], [data-builder-runtime-tool-kind]',
    )).map((node) => ({
      kind: node.hasAttribute('data-builder-runtime-assistant-message') ? 'narration' : 'tool',
      text: node.textContent?.replace(/\s+/gu, ' ').trim() ?? '',
    }));
    const narration = entries.filter((entry) => entry.kind === 'narration');
    const completions = Array.from(globalThis.document.querySelectorAll(
      '[data-builder-run-completion-message]',
    )).map((node) => node.textContent?.replace(/\s+/gu, ' ').trim() ?? '');
    const firstNarrationIndex = entries.findIndex((entry) => entry.kind === 'narration');
    const firstToolIndex = entries.findIndex((entry) => entry.kind === 'tool');
    const bodyText = globalThis.document.body.innerText;
    return {
      narration_count: narration.length,
      narration_precedes_first_tool:
        firstNarrationIndex >= 0 && firstToolIndex >= 0 && firstNarrationIndex < firstToolIndex,
      initial_context_narration_visible: narration.some((entry) => (
        entry.text.includes('I will inspect the current project before deciding which files need to change.')
      )),
      chinese_final_summary_count: completions.filter((text) => (
        text.includes('编码任务已完成')
        && text.includes('自动检查')
        && text.includes('使用方式')
      )).length,
      fixed_lifecycle_copy_visible:
        bodyText.includes('Preparing review') || bodyText.includes('Changing files'),
    };
  });
}

async function assertCompletedActionLayout(page) {
  const actions = page.locator('[data-builder-completed-action-group] .cf-builder-completion-work-action:visible');
  const count = await actions.count();
  if (count < 1) throw new Error('Packaged Harness completed actions were unavailable.');
  const measurements = await actions.evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect();
    const parentRect = element.parentElement?.getBoundingClientRect() ?? null;
    const ancestors = [];
    let current = element;
    for (let depth = 0; depth < 8 && current instanceof globalThis.HTMLElement; depth += 1) {
      const currentRect = current.getBoundingClientRect();
      const style = globalThis.getComputedStyle(current);
      ancestors.push({
        class_name: current.className,
        width: currentRect.width,
        display: style.display,
        css_width: style.width,
        max_width: style.maxWidth,
        grid_template_columns: style.gridTemplateColumns,
        justify_self: style.justifySelf,
      });
      current = current.parentElement;
    }
    return {
      width: rect.width,
      parent_width: parentRect?.width ?? 0,
      horizontal_overflow: element.scrollWidth > element.clientWidth + 1,
      ancestors,
    };
  }));
  if (measurements.some((measurement) => (
    measurement.width < 160
    || measurement.parent_width < 160
    || measurement.horizontal_overflow
  ))) throw new Error(`Packaged Harness completed action layout collapsed: ${JSON.stringify(measurements)}`);
  return Object.freeze({ completed_action_layout_verified: true });
}

async function waitForHarnessRequestIncrease(providerServer, previousCount, increase, code) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const requests = harnessRequests(providerServer);
    if (requests.length >= previousCount + increase) return requests;
    await delay(100);
  }
  throw new Error(`${code}: ${JSON.stringify(providerServer.snapshot())}`);
}

async function waitForCancellationHarnessRequest(page, providerServer, previousCount) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const requests = harnessRequests(providerServer);
    if (requests.length > previousCount) return requests;
    await delay(100);
  }
  const composer = page.locator(SELECTORS.composer);
  const submit = page.locator(SELECTORS.submitTurn).first();
  throw new Error(`Packaged Harness cancellation request did not reach the provider: ${JSON.stringify({
    build_mode_visible: await page.locator('[data-builder-composer-mode-chip="build"]')
      .isVisible().catch(() => false),
    composer_dispatch: await composer.getAttribute('data-builder-route-dispatch').catch(() => null),
    composer_route: await composer.getAttribute('data-builder-route').catch(() => null),
    composer_signals: await composer.getAttribute('data-builder-route-signals').catch(() => null),
    failure_visible: await page.locator(SELECTORS.generationFailedNotice).isVisible().catch(() => false),
    idea_value: await page.locator(SELECTORS.idea).inputValue().catch(() => null),
    project_status: await page.locator(SELECTORS.projectPage)
      .getAttribute('data-builder-project-status').catch(() => null),
    submit_disabled: await submit.isDisabled().catch(() => null),
    requests: providerServer.snapshot(),
  })}`);
}

async function submitHarnessContinuation({
  page,
  projectId,
  providerServer,
  instruction,
  expectedRunCompletedCount,
}) {
  const previousRequestCount = harnessRequests(providerServer).length;
  const baselineCounts = await waitForTaskStreamCounts(
    page,
    projectId,
    () => true,
    'Packaged Harness continuation baseline was unavailable',
  );
  const terminalRunCompletedCount = Math.max(
    expectedRunCompletedCount,
    baselineCounts.run_completed_count + 1,
  );
  await page.locator(SELECTORS.idea).fill(instruction);
  const submit = await waitForSubmitEnabled(page);
  await submit.click();
  const requests = await waitForHarnessRequestIncrease(
    providerServer,
    previousRequestCount,
    3,
    'Packaged Harness continuation provider requests were incomplete',
  );
  const counts = await waitForTaskStreamCounts(
    page,
    projectId,
    (current) => (
      current.candidate_ready_count >= 1
      && current.programming_runtime_check_passed_count >= 1
      && current.run_completed_count >= terminalRunCompletedCount
    ),
    'Packaged Harness continuation task stream was incomplete',
  );
  await page.locator(SELECTORS.unsavedDraft).waitFor({ state: 'visible', timeout: 30_000 });
  await currentUndoDraft(page).waitFor({ state: 'visible', timeout: 30_000 });
  await page.locator(SELECTORS.saveVersion).waitFor({ state: 'visible', timeout: 30_000 });
  return Object.freeze({ counts, requests });
}

async function readCurrentDraftFile(page, filePath) {
  const sourcePanel = page.locator(
    `${SELECTORS.sideWorkspaceFiles}`
    + '[data-builder-side-workspace-file-source-kind="current_draft"]',
  ).first();
  if (!await sourcePanel.isVisible().catch(() => false)) {
    await page.locator(SELECTORS.workspaceMenuButton).first().click();
    await page.locator(SELECTORS.workspaceControlSource).first().click();
  }
  await sourcePanel.waitFor({ state: 'visible', timeout: 30_000 });
  const entry = page.locator(`[data-builder-side-workspace-file-entry="${filePath}"]`).first();
  await entry.waitFor({ state: 'visible', timeout: 30_000 });
  await entry.click();
  const content = page.locator(
    `[data-builder-side-workspace-file-content="${filePath}"][data-builder-side-workspace-file-content-status="ready"]`,
  ).first();
  await content.waitFor({ state: 'visible', timeout: 30_000 });
  return content.textContent();
}

async function openRuntimeFileFromChat(page, filePath) {
  const fileGroup = page.locator(
    '[data-builder-runtime-tool-group="file"]'
    + ' > details[data-builder-runtime-history-details="file"]',
  ).last();
  const runtimeButton = () => page.locator(
    '[data-builder-runtime-tool-kind="edit"], '
    + '[data-builder-runtime-tool-kind="write"]',
  ).filter({ hasText: filePath })
    .locator('button.cf-builder-tool-evidence-action:visible')
    .last();
  let button = runtimeButton();
  if (await button.count() === 0 && await fileGroup.count() === 1) {
    const summary = fileGroup.locator(':scope > summary');
    await summary.evaluate((element) => {
      element.scrollIntoView({ block: 'center', inline: 'nearest' });
    });
    if (!await summary.isVisible().catch(() => false)) {
      const layout = await summary.evaluate((element) => {
        const ancestors = [];
        let current = element;
        for (let depth = 0; current !== null && depth < 8; depth += 1) {
          const style = globalThis.getComputedStyle(current);
          const rect = current.getBoundingClientRect();
          ancestors.push({
            tag: current.tagName.toLowerCase(),
            class_name: current.className,
            display: style.display,
            visibility: style.visibility,
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          });
          current = current.parentElement;
        }
        return ancestors;
      });
      throw new Error(`Packaged Harness runtime file history is hidden: ${JSON.stringify(layout)}`);
    }
    await summary.click();
    button = runtimeButton();
  }
  await button.waitFor({ state: 'visible', timeout: 30_000 });
  await button.click();
  const sourcePanel = page.locator(
    '[data-builder-side-workspace-files="true"]'
    + '[data-builder-side-workspace-file-source-kind="runtime_snapshot"]',
  ).first();
  await sourcePanel.waitFor({ state: 'visible', timeout: 30_000 });
  const content = sourcePanel.locator(
    `[data-builder-side-workspace-file-content="${filePath}"]`
    + '[data-builder-side-workspace-file-content-status="ready"]',
  ).first();
  await content.waitFor({ state: 'visible', timeout: 30_000 });
  return content.textContent();
}

async function waitForCurrentDraftFile(page, filePath, pattern, code) {
  const deadline = Date.now() + 120_000;
  let content = null;
  while (Date.now() < deadline) {
    content = await readCurrentDraftFile(page, filePath).catch(() => null);
    if (typeof content === 'string' && pattern.test(content)) return content;
    await delay(100);
  }
  const panelText = await page.locator(SELECTORS.sideWorkspaceFiles).first().textContent()
    .catch(() => null);
  const projectStatus = await page.locator(SELECTORS.projectPage).first()
    .getAttribute('data-builder-project-status')
    .catch(() => null);
  throw new Error(`${code}: ${JSON.stringify({ filePath, content, panelText, projectStatus })}`);
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
  await projectPage.waitFor({
    state: 'visible',
    timeout: 120_000,
  });
  await page.locator(SELECTORS.unsavedDraft).waitFor({ state: 'visible', timeout: 120_000 });
  await currentUndoDraft(page).waitFor({ state: 'visible', timeout: 30_000 });
  await page.locator(SELECTORS.saveVersion).waitFor({ state: 'visible', timeout: 30_000 });
}

async function main() {
  const outsideMarker = 'builder-harness-outside-content-must-not-reach-provider';
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), USER_DATA_PREFIX));
  const projectRootPath = path.join(userDataPath, 'project-root');
  const outsidePath = path.join(userDataPath, 'outside.txt');
  fs.mkdirSync(projectRootPath);
  fs.writeFileSync(outsidePath, outsideMarker, { encoding: 'utf8', flag: 'wx' });
  const providerServer = await createLocalCanaryProviderServer({
    delayedHarnessStreamResponses: 1,
    forbiddenHarnessText: outsideMarker,
    harnessAdversarialBoundaries: true,
    harnessFailedCheckRepair: true,
    harnessStreamEventDelayMs: 1_250,
    deferHarnessResponses: 1,
    deferHarnessResponsesAfter: 28,
    onRequest(request) {
      process.stderr.write(`${JSON.stringify({
        stage: 'provider_request',
        response_kind: request.response_kind,
      })}\n`);
    },
  });
  let app = null;
  const performanceSessions = [];
  try {
    const env = { ...process.env };
    delete env.BUILDER_PROGRAMMING_RUNTIME;
    delete env.BUILDER_HARNESS_RUNTIME_ROOT;
    const launchEnvironment = Object.freeze({
      ...sanitizeLaunchEnvironment(env, userDataPath, projectRootPath),
      BUILDER_PERF_TRACE: '1',
    });
    app = await electron.launch({
      args: [],
      executablePath: packagedExecutable(),
      env: launchEnvironment,
    });
    const page = await app.firstWindow();
    await assertCustomChromeControls(page);
    const gate = createArtifactGate();
    await fillProviderSettingsViaUi(page, {
      base_url: providerServer.baseUrl,
      credential: 'local-packaged-harness-ui-canary-secret',
      max_tokens: 8192,
      model: 'deepseek-v4-flash',
      temperature: null,
      timeout_ms: 2_000,
    }, gate);
    const initialDraftStartedAtMs = Date.now();
    let initialDraft;
    try {
      initialDraft = await createInitialDraftViaUi(
        page,
        'Make a small focus timer.',
        { path: userDataPath },
      );
    } catch (error) {
      const uiDiagnostic = await page.evaluate(() => ({
        body_text: globalThis.document.body.innerText.slice(0, 4_000),
        project_error: globalThis.document.querySelector('[data-builder-project-error]')
          ?.getAttribute('data-builder-project-error') ?? null,
        project_status: globalThis.document.querySelector('[data-builder-project-status]')
          ?.getAttribute('data-builder-project-status') ?? null,
        unsaved_draft_visible:
          globalThis.document.querySelector('[data-builder-unsaved-draft="true"]') !== null,
      })).catch(() => null);
      process.stderr.write(`${JSON.stringify({ stage: 'initial_ui_terminal_failed', ui: uiDiagnostic })}\n`);
      throw error;
    }
    const initialDraftDurationMs = Date.now() - initialDraftStartedAtMs;
    const projectId = await page.locator('[data-builder-route-project-id]').first()
      .getAttribute('data-builder-route-project-id');
    if (!/^builder-project:[0-9a-f-]{36}$/u.test(projectId ?? '')) {
      throw new Error('Packaged Harness UI project identity is unavailable.');
    }
    const taskStream = await readSanitizedTaskStreamEvidence(page, projectId);
    const initialHarnessRequests = harnessRequests(providerServer);
    const taskStreamCounts = taskStream.conversation?.item_facts.counts ?? null;
    const initialWorkspaceMaterialization = taskStream.conversation?.item_facts
      .latestCandidate?.candidate?.workspace_materialization?.status ?? null;
    const runtimeNarration = await readRuntimeNarrationEvidence(page);
    const evidence = {
      automatic_check_status: initialDraft?.check_run?.status ?? null,
      factual_candidate_change_in_chat:
        initialDraft?.review_diff?.factual_candidate_change_in_chat === true,
      factual_command_in_chat: initialDraft?.review_diff?.factual_command_in_chat === true,
      harness_provider_request_count: initialHarnessRequests.length,
      initial_draft_duration_ms: initialDraftDurationMs,
      initial_stream_event_delay_ms: initialHarnessRequests[0]?.stream_event_delay_ms ?? null,
      initial_workspace_materialization: initialWorkspaceMaterialization,
      failed_check_fact_count: taskStreamCounts?.programming_runtime_check_failed_count ?? 0,
      legacy_provider_lifecycle_hidden:
        initialDraft?.review_diff?.provider_lifecycle_steps_hidden === true,
      read_request_count: initialHarnessRequests.filter(
        (request) => request.response_kind?.startsWith('harness_tool_read'),
      ).length,
      repair_edit_request_count: initialHarnessRequests.filter(
        (request) => request.response_kind === 'harness_tool_edit_check.js',
      ).length,
      repaired_text_response_count: initialHarnessRequests.filter(
        (request) => request.response_kind === 'harness_text_repaired',
      ).length,
      passed_check_fact_count: taskStreamCounts?.programming_runtime_check_passed_count ?? 0,
      runtime_assistant_message_count:
        taskStreamCounts?.programming_runtime_assistant_message_count ?? 0,
      runtime_narration: runtimeNarration,
      runtime_tool_activity_count:
        taskStreamCounts?.programming_runtime_tool_activity_count ?? 0,
      text_response_count: initialHarnessRequests.filter(
        (request) => request.response_kind === 'harness_text_completed',
      ).length,
      write_request_count: initialHarnessRequests.filter(
        (request) => request.response_kind.includes('harness_tool_write_'),
      ).length,
    };
    if (
      initialHarnessRequests.length < 9
      || initialDraftDurationMs < 3_000
      || initialHarnessRequests[0]?.stream_event_delay_ms !== 1_250
      || !initialHarnessRequests.some((request) => request.response_kind === 'harness_tool_read')
      || initialHarnessRequests.filter((request) => request.response_kind.includes('harness_tool_write_')).length !== 4
      || !initialHarnessRequests.some((request) => request.response_kind === 'harness_text_completed')
      || !initialHarnessRequests.some((request) => request.response_kind === 'harness_tool_read_repair')
      || !initialHarnessRequests.some((request) => request.response_kind === 'harness_tool_edit_check.js')
      || !initialHarnessRequests.some((request) => request.response_kind === 'harness_text_repaired')
      || taskStreamCounts?.programming_runtime_check_failed_count !== 1
      || (taskStreamCounts?.programming_runtime_check_passed_count ?? 0) < 1
      || taskStreamCounts?.programming_runtime_assistant_message_count < 6
      || runtimeNarration.narration_count < 6
      || runtimeNarration.narration_precedes_first_tool !== true
      || runtimeNarration.initial_context_narration_visible !== true
      || runtimeNarration.chinese_final_summary_count < 1
      || runtimeNarration.fixed_lifecycle_copy_visible
      || initialDraft?.check_run?.status !== 'passed'
      || initialDraft?.review_diff?.factual_candidate_change_in_chat !== true
      || initialDraft?.review_diff?.factual_command_in_chat !== true
      || initialDraft?.review_diff?.provider_lifecycle_steps_hidden !== true
      || initialDraft?.unsaved_draft_observed !== true
      || initialWorkspaceMaterialization !== 'materialized'
    ) throw new Error(`Packaged Harness UI evidence is incomplete: ${JSON.stringify(evidence)}`);
    const runtimeIndex = await openRuntimeFileFromChat(page, 'index.html');
    if (!/<h1>Focus Timer<\/h1>/u.test(runtimeIndex ?? '')) {
      throw new Error('Initial Harness runtime file was not opened from chat.');
    }
    const initialIndex = await waitForCurrentDraftFile(
      page,
      'index.html',
      /<h1>Focus Timer<\/h1>/u,
      'Initial Harness source was not visible',
    );
    const materializedIndexPath = path.join(projectRootPath, 'index.html');
    const initialMaterializedIndex = fs.existsSync(materializedIndexPath)
      ? fs.readFileSync(materializedIndexPath, 'utf8')
      : null;
    if (
      initialMaterializedIndex === null
      || !/<h1>Focus Timer<\/h1>/u.test(initialMaterializedIndex)
    ) {
      throw new Error('Initial Harness candidate was not materialized to the project folder.');
    }
    await submitHarnessContinuation({
      page,
      projectId,
      providerServer,
      instruction: 'Continue improving the focus timer heading and subtitle.',
      expectedRunCompletedCount: 2,
    });
    let continuedIndex;
    try {
      continuedIndex = await waitForCurrentDraftFile(
        page,
        'index.html',
        /<h1>Focus Timer Updated<\/h1>/u,
        'Continued Harness source was not visible',
      );
    } catch (error) {
      const diagnostic = await page.evaluate(async ({ defaultAgentId, targetProjectId }) => {
        const conversationId = targetProjectId.replace(
          'builder-project:',
          'builder-conversation:',
        );
        const tree = await globalThis.clawfabricBuilder.agentProjectTree.read({
          agent_id: defaultAgentId,
        });
        const project = tree?.projects?.find(
          (candidate) => candidate?.project_id === targetProjectId,
        );
        const taskAddressId = project?.tasks?.find(
          (task) => typeof task?.task_address_id === 'string',
        )?.task_address_id;
        if (typeof taskAddressId !== 'string') throw new Error('task address unavailable');
        const taskStream = await globalThis.clawfabricBuilder.taskStream.read({
          project_id: targetProjectId,
          task_address_id: taskAddressId,
        });
        let files;
        try {
          files = {
            ok: true,
            value: await globalThis.clawfabricBuilder.sideWorkspaceFiles
              .readCurrentDraftFileTree({
                project_id: targetProjectId,
                conversation_id: conversationId,
              }),
          };
        } catch (filesError) {
          files = {
            ok: false,
            code: filesError?.code ?? null,
            message: filesError instanceof Error ? filesError.message : null,
            name: filesError?.name ?? null,
          };
        }
        return {
          check_run_outcome_projection: taskStream.check_run_outcome_projection ?? null,
          draft_checkpoint_status_projection:
            taskStream.draft_checkpoint_status_projection ?? null,
          files,
          review_state_projection: taskStream.review_state_projection ?? null,
          task_stream_keys: Object.keys(taskStream),
        };
      }, { defaultAgentId: DEFAULT_BUILDER_AGENT_ID, targetProjectId: projectId });
      throw new Error(`${error instanceof Error ? error.message : 'Continued source failed.'}; authority=${JSON.stringify(diagnostic)}`);
    }
    const continuedMaterializedIndex = fs.readFileSync(materializedIndexPath, 'utf8');
    if (!/<h1>Focus Timer Updated<\/h1>/u.test(continuedMaterializedIndex)) {
      throw new Error('Continued Harness candidate was not materialized to the project folder.');
    }

    const initialRendererPerformance = await readRendererPerformanceTrace(page);
    await app.close();
    app = null;
    performanceSessions.push(Object.freeze({
      phase: 'initial_build_and_continuation',
      main: readMainPerformanceTrace(userDataPath),
      renderer: initialRendererPerformance,
    }));
    app = await electron.launch({
      args: [],
      executablePath: packagedExecutable(),
      env: launchEnvironment,
    });
    const restartedPage = await app.firstWindow();
    await assertCustomChromeControls(restartedPage);
    await openRestoredDraft(restartedPage, projectId);
    const restartCounts = await waitForTaskStreamCounts(
      restartedPage,
      projectId,
      (current) => (
        current.candidate_ready_count >= 1
        && current.programming_runtime_check_passed_count >= 1
        && current.run_completed_count >= 2
      ),
      'Restarted Harness task stream was incomplete',
    );
    await waitForCurrentDraftFile(
      restartedPage,
      'index.html',
      /<h1>Focus Timer Updated<\/h1>/u,
      'Restarted Harness source did not preserve the latest checkpoint',
    );
    if (fs.readFileSync(materializedIndexPath, 'utf8') !== continuedMaterializedIndex) {
      throw new Error('Restart changed the materialized Harness project folder.');
    }
    const historyEvidence = await inspectCurrentRecoveryHistory(restartedPage);

    const externalIndexPath = materializedIndexPath;
    const externalIndexContent = '<!doctype html>\n<h1>External user edit</h1>\n';
    fs.writeFileSync(externalIndexPath, externalIndexContent, { encoding: 'utf8' });
    process.stderr.write(`${JSON.stringify({ stage: 'external_conflict_undo' })}\n`);
    await currentUndoDraft(restartedPage).click();
    const conflictPage = restartedPage.locator(
      `${SELECTORS.projectPage}`
      + '[data-builder-project-status="generation_failed"]'
      + '[data-builder-project-error="builder_generation_workspace_changed"]',
    ).first();
    try {
      await conflictPage.waitFor({ state: 'visible', timeout: 30_000 });
    } catch (error) {
      const diagnostic = await restartedPage.evaluate(async ({ defaultAgentId, targetProjectId }) => {
        const pageElement = globalThis.document.querySelector('[data-builder-page="true"]');
        const tree = await globalThis.clawfabricBuilder.agentProjectTree.read({
          agent_id: defaultAgentId,
        });
        const project = tree?.projects?.find(
          (candidate) => candidate?.project_id === targetProjectId,
        );
        const taskAddressId = project?.tasks?.find(
          (task) => typeof task?.task_address_id === 'string',
        )?.task_address_id;
        if (typeof taskAddressId !== 'string') throw new Error('task address unavailable');
        const taskStream = await globalThis.clawfabricBuilder.taskStream.read({
          project_id: targetProjectId,
          task_address_id: taskAddressId,
        });
        return {
          project_status: pageElement?.getAttribute('data-builder-project-status') ?? null,
          project_error: pageElement?.getAttribute('data-builder-project-error') ?? null,
          conversation_text: globalThis.document.querySelector('[aria-label="Project conversation"]')?.textContent ?? null,
          review_state_projection: taskStream.review_state_projection ?? null,
          recent_items: taskStream.conversation?.items?.slice(-8) ?? null,
        };
      }, { defaultAgentId: DEFAULT_BUILDER_AGENT_ID, targetProjectId: projectId });
      throw new Error(
        `${error instanceof Error ? error.message : 'External conflict was not visible.'}`
        + `; external_source_preserved=${fs.readFileSync(externalIndexPath, 'utf8') === externalIndexContent}`
        + `; authority=${JSON.stringify(diagnostic)}`
        + `; main_debug=${fs.existsSync(path.join(userDataPath, 'builder-canary-generation-debug.jsonl'))
          ? fs.readFileSync(path.join(userDataPath, 'builder-canary-generation-debug.jsonl'), 'utf8')
          : 'not_recorded'}`,
      );
    }
    await conflictPage.getByLabel('Project conversation', { exact: true }).getByText(
      'The project changed while I was working. Review it, then retry.',
      { exact: true },
    ).waitFor({ state: 'visible', timeout: 30_000 });
    if (fs.readFileSync(externalIndexPath, 'utf8') !== externalIndexContent) {
      throw new Error('Harness checkpoint conflict overwrote an external project edit.');
    }
    const conflictCounts = await waitForTaskStreamCounts(
      restartedPage,
      projectId,
      (current) => current.candidate_ready_count === restartCounts.candidate_ready_count,
      'Harness checkpoint conflict unexpectedly created a candidate',
    );
    fs.writeFileSync(externalIndexPath, continuedMaterializedIndex, { encoding: 'utf8' });

    process.stderr.write(`${JSON.stringify({ stage: 'restored_source_undo' })}\n`);
    await currentUndoDraft(restartedPage).click();
    const undoCounts = await waitForTaskStreamCounts(
      restartedPage,
      projectId,
      (current) => (
        current.candidate_ready_count >= 1
        && current.run_completed_count > conflictCounts.run_completed_count
      ),
      'Harness checkpoint undo was not recorded',
    );
    const undoneIndex = await waitForCurrentDraftFile(
      restartedPage,
      'index.html',
      /<h1>Focus Timer<\/h1>/u,
      'Harness checkpoint undo did not restore the prior source',
    );
    if (/Focus Timer Updated/u.test(undoneIndex ?? '')) {
      throw new Error('Harness checkpoint undo retained the newer source.');
    }
    const completedActionLayout = await assertCompletedActionLayout(restartedPage);

    const postUndoContinuation = await submitHarnessContinuation({
      page: restartedPage,
      projectId,
      providerServer,
      instruction: 'Continue from this restored checkpoint and complete the focus timer copy.',
      expectedRunCompletedCount: undoCounts.run_completed_count + 1,
    });
    await waitForCurrentDraftFile(
      restartedPage,
      'index.html',
      /<h1>Focus Timer Complete<\/h1>/u,
      'Post-undo Harness continuation source was not visible',
    );
    const boundaryRun = await submitHarnessContinuation({
      page: restartedPage,
      projectId,
      providerServer,
      instruction: [
        'Change index.html to use a Boundary Safe heading.',
        'Exercise Builder workspace boundaries and recover safely.',
      ].join(' '),
      expectedRunCompletedCount: postUndoContinuation.counts.run_completed_count + 1,
    });
    const boundaryIndexContent = await waitForCurrentDraftFile(
      restartedPage,
      'index.html',
      /<h1>Boundary Safe<\/h1>/u,
      'Harness boundary recovery source was not visible',
    );
    if (
      /Boundary Stale Should Not Win/u.test(boundaryIndexContent ?? '')
      || fs.readFileSync(outsidePath, 'utf8') !== outsideMarker
    ) {
      throw new Error('Harness boundary recovery accepted stale work or changed outside source.');
    }
    const noChangeRequestBaseline = harnessRequests(providerServer).length;
    const noChangeCountsBaseline = boundaryRun.counts;
    const noChangeSearchBaseline = await restartedPage.locator(
      '[data-builder-runtime-tool-kind="search"]',
    ).count();
    await selectBuildMode(restartedPage);
    await restartedPage.locator(SELECTORS.idea).fill(
      'Inspect the current project and explain what detail is still needed. Do not change files.',
    );
    const noChangeSubmit = await waitForSubmitEnabled(restartedPage);
    await noChangeSubmit.click();
    await waitForHarnessRequestIncrease(
      providerServer,
      noChangeRequestBaseline,
      3,
      'Packaged Harness unchanged response requests were incomplete',
    );
    const noChangeCounts = await waitForTaskStreamCounts(
      restartedPage,
      projectId,
      (current) => (
        current.explanation_result_count
          > noChangeCountsBaseline.explanation_result_count
        && current.turn_completed_count > noChangeCountsBaseline.turn_completed_count
        && current.candidate_ready_count === noChangeCountsBaseline.candidate_ready_count
        && current.programming_runtime_check_passed_count
          === noChangeCountsBaseline.programming_runtime_check_passed_count
      ),
      'Packaged Harness unchanged response did not settle as a normal reply',
    );
    await restartedPage.getByText(
      'I inspected index.html, but I need the exact replacement text before changing files.',
      { exact: true },
    ).last().waitFor({ state: 'visible', timeout: 30_000 });
    const noChangeSearchCount = await restartedPage.locator(
      '[data-builder-runtime-tool-kind="search"]',
    ).count();
    const noChangeSourceAfter = await readCurrentDraftFile(restartedPage, 'index.html');
    if (
      noChangeSourceAfter !== boundaryIndexContent
      || noChangeSearchCount <= noChangeSearchBaseline
      || await restartedPage.locator(SELECTORS.generationFailedNotice).isVisible().catch(() => false)
    ) {
      throw new Error('Harness unchanged response changed source or surfaced as a failure.');
    }
    const finalHarnessRequests = harnessRequests(providerServer);
    if (
      finalHarnessRequests.length !== 28
      || finalHarnessRequests.filter(
        (request) => request.response_kind === 'harness_tool_edit_index.html',
      ).length !== 3
      || finalHarnessRequests.filter(
        (request) => request.response_kind === 'harness_text_completed',
      ).length !== 4
      || !finalHarnessRequests.some(
        (request) => request.response_kind === 'harness_adversarial_escape_read',
      )
      || !finalHarnessRequests.some(
        (request) => request.response_kind === 'harness_adversarial_stale_edit_batch',
      )
      || !finalHarnessRequests.some(
        (request) => request.response_kind === 'harness_adversarial_unsupported_tool',
      )
      || !finalHarnessRequests.some(
        (request) => request.response_kind === 'harness_adversarial_repaired_edit',
      )
      || !finalHarnessRequests.some(
        (request) => request.response_kind === 'harness_adversarial_completed',
      )
      || !finalHarnessRequests.some(
        (request) => request.response_kind === 'harness_no_change_search',
      )
      || !finalHarnessRequests.some(
        (request) => request.response_kind === 'harness_no_change_read',
      )
      || !finalHarnessRequests.some(
        (request) => request.response_kind === 'harness_no_change_completed',
      )
    ) {
      throw new Error(`Packaged Harness continuation request sequence is incomplete: ${JSON.stringify(finalHarnessRequests)}`);
    }

    const cancellationBaseline = noChangeCounts;
    const cancellationSourceBefore = await readCurrentDraftFile(restartedPage, 'index.html');
    await restartedPage.locator(
      `${SELECTORS.projectPage}[data-builder-project-status="draft_ready"]`,
    ).waitFor({ state: 'visible', timeout: 30_000 });
    await selectBuildMode(restartedPage);
    await restartedPage.locator(SELECTORS.idea).fill(
      'Start another focus timer change, but wait before applying it.',
    );
    const cancellationSubmit = await waitForSubmitEnabled(restartedPage);
    await cancellationSubmit.click();
    await waitForCancellationHarnessRequest(
      restartedPage,
      providerServer,
      finalHarnessRequests.length,
    );
    const cancelButton = restartedPage.locator(SELECTORS.cancelWork).first();
    await cancelButton.waitFor({ state: 'visible', timeout: 30_000 });
    if (providerServer.pendingResponseCount() !== 1) {
      throw new Error('Packaged Harness cancellation provider response was not held.');
    }
    await cancelButton.click();
    await cancelButton.waitFor({ state: 'hidden', timeout: 30_000 });
    const cancelledCounts = await waitForTaskStreamCounts(
      restartedPage,
      projectId,
      (current) => (
        current.run_started_count > cancellationBaseline.run_started_count
        && current.run_control_cancel_count > cancellationBaseline.run_control_cancel_count
        && current.candidate_ready_count === cancellationBaseline.candidate_ready_count
      ),
      'Packaged Harness cancellation task stream did not settle',
    );
    const cancellationRecorded = cancelledCounts.run_control_cancel_count
      > cancellationBaseline.run_control_cancel_count;
    if (!providerServer.releaseNext()) {
      throw new Error('Packaged Harness cancellation provider response could not be released.');
    }
    await delay(250);
    const cancellationSourceAfter = await readCurrentDraftFile(restartedPage, 'index.html');
    if (
      !cancellationRecorded
      || cancelledCounts.candidate_ready_count !== cancellationBaseline.candidate_ready_count
      || cancellationSourceAfter !== cancellationSourceBefore
      || await restartedPage.locator(SELECTORS.generationFailedNotice).isVisible().catch(() => false)
    ) {
      throw new Error(`Packaged Harness cancellation evidence is incomplete: ${JSON.stringify({
        cancellationRecorded,
        candidateCountBefore: cancellationBaseline.candidate_ready_count,
        candidateCountAfter: cancelledCounts.candidate_ready_count,
        sourcePreserved: cancellationSourceAfter === cancellationSourceBefore,
      })}`);
    }
    const completedHarnessRequests = harnessRequests(providerServer);
    const saveButton = restartedPage.locator(`${SELECTORS.saveVersion}:visible`).last();
    await saveButton.waitFor({ state: 'visible', timeout: 30_000 });
    const saveDeadline = Date.now() + 30_000;
    while (Date.now() < saveDeadline && !await saveButton.isEnabled().catch(() => false)) {
      await delay(100);
    }
    if (!await saveButton.isEnabled().catch(() => false)) {
      throw new Error('Packaged Harness Save version did not become available.');
    }
    const saveDecision = restartedPage.locator(
      `${SELECTORS.composerVersionDecision}:visible`,
    ).last();
    const latestActivity = restartedPage.locator(
      `${SELECTORS.conversationActivity} .cf-builder-activity-list > li:visible`,
    ).last();
    let saveDecisionBox = null;
    let latestActivityBox = null;
    const layoutDeadline = Date.now() + 10_000;
    while (Date.now() < layoutDeadline) {
      [saveDecisionBox, latestActivityBox] = await Promise.all([
        saveDecision.boundingBox(),
        latestActivity.boundingBox(),
      ]);
      if (
        saveDecisionBox !== null
        && latestActivityBox !== null
        && latestActivityBox.y + latestActivityBox.height <= saveDecisionBox.y + 2
      ) break;
      await delay(100);
    }
    if (
      saveDecisionBox === null
      || latestActivityBox === null
      || latestActivityBox.y + latestActivityBox.height > saveDecisionBox.y + 2
    ) {
      const chatScrollDiagnostic = await restartedPage.locator(
        '[data-builder-chat-scroll="true"]',
      ).evaluate((element) => ({
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
        scrollTop: element.scrollTop,
        distanceFromBottom: element.scrollHeight - element.scrollTop - element.clientHeight,
      })).catch(() => null);
      throw new Error(`Packaged Harness latest output is obscured by Save version: ${JSON.stringify({
        latestActivityBox,
        saveDecisionBox,
        chatScrollDiagnostic,
      })}`);
    }
    await saveButton.click();
    await restartedPage.locator(`${SELECTORS.unsavedDraft}:visible`).waitFor({
      state: 'hidden',
      timeout: 60_000,
    });
    await restartedPage.locator(`${SELECTORS.saveVersion}:visible`).waitFor({
      state: 'hidden',
      timeout: 60_000,
    });
    await restartedPage.locator(SELECTORS.versionSavedActivity).last().waitFor({
      state: 'visible',
      timeout: 60_000,
    });
    await restartedPage.locator(SELECTORS.workspaceMenuButton).first().click();
    await restartedPage.locator(SELECTORS.workspaceControlVersions).first().click();
    const savedMilestone = restartedPage.locator('[data-builder-version-card]').last();
    await savedMilestone.waitFor({ state: 'visible', timeout: 60_000 });
    const finalRendererPerformance = await readRendererPerformanceTrace(restartedPage);
    await app.close();
    app = null;
    performanceSessions.push(Object.freeze({
      phase: 'restart_recovery_multi_tool_preview_cancel_save',
      main: readMainPerformanceTrace(userDataPath),
      renderer: finalRendererPerformance,
    }));
    const a04PerformanceQualification = assertA04PerformanceGate(performanceSessions);

    process.stdout.write(`${JSON.stringify({
      result_version: 'builder-packaged-harness-ui-canary.v2',
      runtime_kind: 'deepseek_harness.v1',
      default_runtime_selection: true,
      bundled_runtime_auto_discovered: true,
      configured_provider_timeout_ms: 2_000,
      healthy_progress_survived_old_provider_timeout: initialDraftDurationMs > 2_000,
      initial_draft_duration_ms: initialDraftDurationMs,
      harness_provider_request_count: completedHarnessRequests.length,
      failed_check_recorded: true,
      repair_turn_observed: true,
      repaired_edit_observed: true,
      passed_check_recorded: true,
      real_file_facts_visible_in_chat: true,
      runtime_file_opened_from_chat: true,
      real_search_fact_visible_in_chat: true,
      real_command_fact_visible_in_chat: true,
      completed_action_layout_verified:
        completedActionLayout.completed_action_layout_verified,
      model_narration_visible_between_real_actions: true,
      model_narration_precedes_first_tool: true,
      final_runtime_summary_not_duplicated: true,
      legacy_provider_lifecycle_hidden: true,
      automatic_check_status: initialDraft.check_run.status,
      consecutive_build_turns_without_save: true,
      first_checkpoint_source_verified: /Focus Timer/u.test(initialIndex ?? ''),
      second_checkpoint_source_verified: /Focus Timer Updated/u.test(continuedIndex ?? ''),
      first_candidate_materialized_to_project_folder: true,
      continued_candidate_materialized_to_project_folder: true,
      restart_preserved_materialized_project_folder: true,
      restart_restored_unsaved_checkpoint: true,
      history_current_recovery_visible: historyEvidence.current_recovery_visible,
      history_earlier_checkpoint_timeline_visible:
        historyEvidence.earlier_checkpoint_timeline_visible,
      history_undo_visible: historyEvidence.undo_visible,
      history_visual_bounds_verified: historyEvidence.visual_bounds_verified,
      history_screenshot_verified: historyEvidence.screenshot_verified,
      checkpoint_undo_external_conflict_blocked: true,
      checkpoint_undo_external_source_preserved: true,
      checkpoint_undo_conflict_candidate_count_unchanged:
        conflictCounts.candidate_ready_count === restartCounts.candidate_ready_count,
      checkpoint_undo_restored_prior_source: true,
      continued_after_restart_and_undo: true,
      cancellation_request_recorded: true,
      cancellation_blocked_late_candidate: true,
      cancellation_preserved_checkpoint_source: true,
      cancellation_provider_response_held_until_terminal: true,
      workspace_escape_denied_without_context_leak: true,
      stale_edit_rejected_and_recovered: true,
      unsupported_tool_rejected_and_recovered: true,
      unchanged_work_response_visible: true,
      unchanged_work_candidate_count_preserved:
        noChangeCounts.candidate_ready_count === noChangeCountsBaseline.candidate_ready_count,
      unchanged_work_check_count_preserved:
        noChangeCounts.programming_runtime_check_passed_count
          === noChangeCountsBaseline.programming_runtime_check_passed_count,
      unchanged_work_source_preserved: noChangeSourceAfter === boundaryIndexContent,
      candidate_ready_count: boundaryRun.counts.candidate_ready_count,
      passing_check_count: boundaryRun.counts.programming_runtime_check_passed_count,
      save_version_required: true,
      latest_output_above_save_card: true,
      save_card_dismissed_after_save: true,
      saved_milestone_visible: true,
      performance_trace_privacy_verified: true,
      a04_performance_gate_verified: true,
      a04_performance_qualification: a04PerformanceQualification,
      performance_scenario_coverage: Object.freeze([
        'PB-01',
        'PB-02',
        'PB-04',
        'PB-05',
        'PB-07',
        'PB-10',
      ]),
      performance_sessions: Object.freeze(performanceSessions),
      unsaved_draft_preserved_until_save: true,
    }, null, 2)}\n`);
  } finally {
    if (app !== null) await app.close().catch(() => {});
    await providerServer.close();
    if (process.env.BUILDER_KEEP_HARNESS_CANARY_DATA === '1') {
      process.stderr.write(`${JSON.stringify({
        stage: 'canary_data_retained',
        user_data_path: userDataPath,
      })}\n`);
    } else {
      removeCanaryRoot(userDataPath);
    }
  }
}

module.exports = Object.freeze({
  delay,
  harnessRequests,
  packagedExecutable,
  readMainPerformanceTrace,
  readRendererPerformanceTrace,
  removeCanaryRoot,
  requiredMetric,
  selectBuildMode,
  waitForSubmitEnabled,
  waitForTaskStreamCounts,
});

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      code: error?.code ?? 'canary_evidence_failed',
      diagnostic: error?.diagnostic ?? null,
      message: error instanceof Error ? error.message : 'Packaged Harness UI canary failed.',
    })}\n`);
    process.exitCode = 1;
  });
}
