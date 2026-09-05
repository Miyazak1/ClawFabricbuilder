'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');
const { copySavedBuilderWorkspaceProfile } = require('./verify-deepseek-packaged-agent-history-e2e-canary.cjs');
const { PACKAGED_CANARY_USER_DATA_PREFIX, SELECTORS, captureGuardedUserDataRoot,
  createCanaryProjectRoot, sanitizeLaunchEnvironment } = require('./verify-packaged-canary.cjs');

async function run() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), PACKAGED_CANARY_USER_DATA_PREFIX));
  const root = captureGuardedUserDataRoot(userData, fs, os);
  const output = path.resolve('release/composer-spacing-20260831');
  const executablePath = process.env.CLAWBUILDER_CANARY_EXECUTABLE
    ? path.resolve(process.env.CLAWBUILDER_CANARY_EXECUTABLE)
    : path.resolve('release/win-unpacked/ClawFabric Builder.exe');
  let app;
  try {
    const projectRoot = createCanaryProjectRoot(root, fs, os);
    // Layout only: copy test history but no provider configuration or credentials.
    copySavedBuilderWorkspaceProfile({ mode: 'saved_profile',
      source_user_data_path: path.join(process.env.APPDATA, 'clawfabric-builder') }, root);
    fs.mkdirSync(output, { recursive: true });
    app = await electron.launch({ executablePath,
      args: [], env: sanitizeLaunchEnvironment(process.env, root.path, projectRoot) });
    const page = await app.firstWindow();
    await page.locator(SELECTORS.agentRosterItem).click();
    await page.locator('[data-builder-task-monitor="true"]').waitFor({ state: 'visible' });
    const contextButton = page.locator('[data-builder-composer-context-button="true"]');
    const modelButton = page.locator('[data-builder-composer-model-menu-button="true"]');
    await contextButton.waitFor({ state: 'visible' });
    await modelButton.waitFor({ state: 'visible' });
    const actionOrder = await page.evaluate(() => {
      const context = globalThis.document.querySelector('[data-builder-composer-context-button="true"]')
        ?.getBoundingClientRect();
      const model = globalThis.document.querySelector('[data-builder-composer-model-menu-button="true"]')
        ?.getBoundingClientRect();
      return context && model ? { context_right: context.right, model_left: model.left } : null;
    });
    assert.ok(actionOrder, 'composer context and model controls must both be visible');
    assert.ok(actionOrder.context_right <= actionOrder.model_left,
      `context meter must precede model control: ${JSON.stringify(actionOrder)}`);
    await contextButton.hover();
    const contextTooltip = page.locator('[data-builder-composer-context-tooltip="true"]');
    await contextTooltip.waitFor({ state: 'visible' });
    const tooltipEvidence = await contextTooltip.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        bottom: rect.bottom,
        height: rect.height,
        left: rect.left,
        right: rect.right,
        text: element.textContent,
        top: rect.top,
        width: rect.width,
        viewport_height: globalThis.window.innerHeight,
        viewport_width: globalThis.window.innerWidth,
      };
    });
    assert.match(tooltipEvidence.text ?? '', /Context window/);
    assert.ok(tooltipEvidence.left >= 0 && tooltipEvidence.right <= tooltipEvidence.viewport_width,
      `context tooltip is horizontally clipped: ${JSON.stringify(tooltipEvidence)}`);
    assert.ok(tooltipEvidence.top >= 0 && tooltipEvidence.bottom <= tooltipEvidence.viewport_height,
      `context tooltip is vertically clipped: ${JSON.stringify(tooltipEvidence)}`);
    await page.screenshot({ path: path.join(output, 'context-tooltip-hover.png') });
    const evidence = [];
    async function measure(label, width) {
      await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(size, 900), width);
      await page.waitForTimeout(200);
      const gaps = await page.evaluate(() => {
        const doc = globalThis.document;
        const body = doc.querySelector('.cf-builder-surface-body').getBoundingClientRect();
        const composer = doc.querySelector('.cf-builder-composer-shell').getBoundingClientRect();
        const sidebar = [...doc.querySelectorAll('[data-builder-task-monitor="true"], [data-builder-artifact-sidebar="true"]')]
          .map((element) => element.getBoundingClientRect()).find((rect) => rect.width > 0 && rect.left >= composer.right);
        return { left: composer.left - body.left, right: (sidebar?.left ?? body.right) - composer.right,
          composer_width: composer.width, sidebar_beside: Boolean(sidebar) };
      });
      assert.ok(gaps.composer_width > 200, `${label}: composer is not usable`);
      assert.ok(Math.abs(gaps.left - gaps.right) <= 1, `${label}: asymmetric insets ${JSON.stringify(gaps)}`);
      evidence.push({ label, width, ...gaps });
      await page.screenshot({ path: path.join(output, `${label}.png`) });
    }
    await measure('agent-tasks-1280', 1280);
    await measure('agent-tasks-1920', 1920);
    await measure('agent-tasks-stacked-1024', 1024);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 900));
    await page.locator('[data-builder-task-monitor-toggle="true"]').click();
    await page.locator('[data-builder-task-monitor="true"]').waitFor({ state: 'hidden' });
    await measure('agent-tasks-collapsed-1280', 1280);
    await measure('agent-tasks-collapsed-1920', 1920);
    const result = { ok: true, executable_path: executablePath, action_order: actionOrder,
      context_tooltip: tooltipEvidence, cases: evidence };
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    if (app) await app.close();
    assert.equal(fs.realpathSync.native(userData), root.realPath);
    assert.equal(path.dirname(root.realPath).toLowerCase(), fs.realpathSync.native(os.tmpdir()).toLowerCase());
    assert.ok(path.basename(root.realPath).startsWith(PACKAGED_CANARY_USER_DATA_PREFIX));
    fs.rmSync(root.realPath, { force: true, recursive: true });
  }
}

if (require.main === module) run().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
