'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PNG } = require('pngjs');
const { runDeepSeekPackagedAgentHistoryE2ECanary } = require('./verify-deepseek-packaged-agent-history-e2e-canary.cjs');

const PLAN = [
  'Prepare a complete implementation plan in the Agent conversation. Do not edit files yet.',
  'Build a small interactive focus timer with only index.html, package.json and check.js, no dependencies.',
  'The h1 must be exactly "Agent History Flow" and the subtitle exactly "Preview first version".',
  'Inline JavaScript must provide button#preview-start (Start) and output#preview-state initially showing idle.',
  'Clicking Start must change preview-state text to running and start the timer.',
  'Include canvas#preview-canvas with a colorful animated progress indicator drawn continuously using requestAnimationFrame.',
  'The page must fit a 320px-wide preview without horizontal overflow. No external network resources.',
  'package.json must provide npm test using node check.js. check.js verifies only the fixed h1, not the mutable subtitle.',
  'Request Builder to run checks after implementation. Specify full requirements, steps, file ownership and acceptance criteria.',
].join(' ');
const UPDATE = [
  'Continue this existing project. Edit only index.html, preserve all interactive behavior and the canvas.',
  'Keep h1 "Agent History Flow" and replace subtitle "Preview first version" with "Second Agent Task".',
  'Do not change package.json or check.js. Run the Builder checks after editing.',
].join(' ');

async function clickEnabled(page, selector) {
  await page.locator(selector).first().waitFor({ state: 'visible', timeout: 30_000 });
  await page.waitForFunction((query) => {
    const button = globalThis.document.querySelector(query);
    return button instanceof globalThis.HTMLButtonElement && !button.disabled;
  }, selector, { timeout: 30_000 });
  await page.locator(selector).first().click();
}

async function readyUrl(page) {
  const selector = '[data-builder-side-workspace-browser="true"][data-builder-live-preview-status="ready"]';
  await page.locator(selector).waitFor({ state: 'visible', timeout: 30_000 });
  await page.waitForFunction((query) => {
    const reload = globalThis.document.querySelector(`${query} [data-builder-live-preview-reload="true"]`);
    return reload instanceof globalThis.HTMLButtonElement && !reload.disabled;
  }, selector, { timeout: 30_000 });
  const url = await page.locator(selector).locator('input').inputValue();
  assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\//u);
  return url;
}

async function observe(app, url, click = false) {
  return app.evaluate(async ({ BrowserWindow, webContents }, input) => {
    const target = webContents.getAllWebContents().find((item) => !item.isDestroyed() && item.getURL() === input.url);
    if (!target) throw new Error('Expected live preview WebContents is absent');
    const view = BrowserWindow.getAllWindows().flatMap((window) => window.contentView.children)
      .find((candidate) => candidate.webContents?.id === target.id);
    if (!view?.getVisible()) throw new Error('Expected live preview is not attached and visible');
    const read = async () => target.executeJavaScript(`(() => {
      const canvas = document.querySelector('#preview-canvas');
      const button = document.querySelector('#preview-start');
      const rect = button?.getBoundingClientRect();
      const pixels = canvas?.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height).data;
      let hash = 2166136261, painted = 0;
      for (let i = 0; pixels && i < pixels.length; i += 4) {
        hash = Math.imul(hash ^ pixels[i] ^ (pixels[i + 1] << 8) ^ (pixels[i + 2] << 16), 16777619);
        if (pixels[i + 3] && (pixels[i] < 240 || pixels[i + 1] < 240 || pixels[i + 2] < 240)) painted++;
      }
      return { h1: document.querySelector('h1')?.textContent, text: document.body.innerText,
        state: document.querySelector('#preview-state')?.textContent?.trim(),
        canvas_hash: hash >>> 0, painted, width: innerWidth, height: innerHeight,
        overflow: document.documentElement.scrollWidth > innerWidth + 2,
        button: rect && { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) } };
    })()`);
    const before = await read();
    if (input.click) {
      if (!before.button) throw new Error('Generated Start button is absent');
      target.sendInputEvent({ type: 'mouseMove', ...before.button });
      target.sendInputEvent({ type: 'mouseDown', ...before.button, button: 'left', clickCount: 1 });
      target.sendInputEvent({ type: 'mouseUp', ...before.button, button: 'left', clickCount: 1 });
    }
    await new Promise((resolve) => setTimeout(resolve, 350));
    const after = await read();
    return { before, after, bounds: view.getBounds(), image: (await target.capturePage()).toPNG().toString('base64') };
  }, { url, click });
}

async function captureAppWindow(app, url) {
  return app.evaluate(async ({ BrowserWindow, desktopCapturer }, previewUrl) => {
    const window = BrowserWindow.getAllWindows().find((candidate) => candidate.contentView.children
      .some((view) => view.webContents && !view.webContents.isDestroyed() && view.webContents.getURL() === previewUrl));
    if (!window) throw new Error('Preview owner window is absent');
    const bounds = window.getBounds();
    const sources = await desktopCapturer.getSources({ types: ['window'],
      thumbnailSize: { width: bounds.width, height: bounds.height }, fetchWindowIcons: false });
    const source = sources.find((item) => item.id === window.getMediaSourceId());
    if (!source || source.thumbnail.isEmpty()) throw new Error('App window capture is unavailable');
    return source.thumbnail.toPNG().toString('base64');
  }, url);
}

function validateEvidence(evidence, subtitle, clicked) {
  assert.equal(evidence.after.h1, 'Agent History Flow');
  assert.ok(evidence.after.text.includes(subtitle), `Expected subtitle: ${subtitle}`);
  assert.equal(evidence.after.overflow, false, 'Generated preview overflows horizontally');
  assert.ok(evidence.after.painted > 50, 'Canvas is blank');
  assert.notEqual(evidence.before.canvas_hash, evidence.after.canvas_hash, 'Canvas is not moving');
  if (clicked) {
    assert.equal(evidence.before.state, 'idle');
    assert.equal(evidence.after.state, 'running', 'Real mouse input did not activate the generated control');
  }
  assert.ok(Math.abs(evidence.bounds.width - evidence.after.width) <= 2);
  assert.ok(Math.abs(evidence.bounds.height - evidence.after.height) <= 2);
  const png = PNG.sync.read(Buffer.from(evidence.image, 'base64'));
  const colors = new Set();
  for (let index = 0; index < png.data.length; index += 4) {
    colors.add(`${png.data[index]},${png.data[index + 1]},${png.data[index + 2]}`);
    if (colors.size > 30) break;
  }
  assert.ok(colors.size > 30, 'Captured native page is blank');
}

async function runPreviewClosureCanary(input, outputDirectory) {
  fs.mkdirSync(outputDirectory, { recursive: true });
  const evidence = [];
  let secondInitialUrl = null;
  async function capture(page, app, label, subtitle, clicked) {
    const url = await readyUrl(page);
    const observation = await observe(app, url, clicked);
    validateEvidence(observation, subtitle, clicked);
    fs.writeFileSync(path.join(outputDirectory, `${label}-page.png`), Buffer.from(observation.image, 'base64'));
    // Renderer screenshots omit the native child view. Capture only this app's
    // exact window for layout evidence; keep native page pixels separately.
    fs.writeFileSync(path.join(outputDirectory, `${label}-desktop.png`),
      Buffer.from(await captureAppWindow(app, url), 'base64'));
    const { before, after, bounds } = observation;
    evidence.push({ label, before, after, bounds });
    process.stdout.write(`${label}: actual page, input and canvas verified\n`);
    return url;
  }
  const result = await runDeepSeekPackagedAgentHistoryE2ECanary(input, {
    planInstruction: PLAN, updateInstruction: UPDATE,
    onFirstDraft: async (page, app) => {
      await clickEnabled(page, '[data-builder-run-project="true"]');
      await capture(page, app, 'first-draft', 'Preview first version', true);
      const resize = page.locator('[data-builder-artifact-resize-handle="true"]');
      await resize.focus();
      await resize.press('Home');
      await page.waitForTimeout(250);
      await capture(page, app, 'narrow', 'Preview first version', false);
      await resize.press('End');
      await page.waitForTimeout(250);
      await capture(page, app, 'wide', 'Preview first version', false);
    },
    onFirstSaved: async (page, _root, app) => {
      await clickEnabled(page, '[data-builder-side-workspace-browser="true"] [data-builder-live-preview-reload="true"]');
      await capture(page, app, 'saved-first', 'Preview first version', true);
    },
    onSecondTaskStarted: async (page, app) => {
      await clickEnabled(page, '[data-builder-run-project="true"]');
      secondInitialUrl = await capture(page, app, 'second-task-original', 'Preview first version', true);
    },
    onSecondDraft: async (page, app) => {
      await clickEnabled(page, '[data-builder-run-project="true"]');
      const prior = await observe(app, await readyUrl(page));
      assert.ok(prior.after.text.includes('Preview first version'), 'Old snapshot baseline unexpectedly replaced');
      await clickEnabled(page, '[data-builder-side-workspace-browser="true"] [data-builder-live-preview-reload="true"]');
      const url = await capture(page, app, 'updated-draft', 'Second Agent Task', true);
      assert.notEqual(url, secondInitialUrl, 'Reload retained the outdated snapshot server');
    },
    onSaved: async (page, app) => {
      await clickEnabled(page, '[data-builder-side-workspace-browser="true"] [data-builder-live-preview-reload="true"]');
      await capture(page, app, 'saved-second', 'Second Agent Task', true);
      await clickEnabled(page, '[data-builder-stop-project="true"]');
      const remaining = await app.evaluate(({ webContents }) => webContents.getAllWebContents()
        .filter((item) => !item.isDestroyed() && /^http:\/\/127\.0\.0\.1:\d+\//u.test(item.getURL())).length);
      assert.equal(remaining, 0, 'Stop did not dispose the native page');
    },
    onFailure: async (page, stage) => {
      fs.writeFileSync(path.join(outputDirectory, 'failure-stage.json'), JSON.stringify({ stage }));
      await page.screenshot({ path: path.join(outputDirectory, 'failure.png'), timeout: 10_000 });
    },
  });
  const combined = { ...result, preview_closure: evidence, preview_stop_disposed: true };
  fs.writeFileSync(path.join(outputDirectory, 'result.json'), JSON.stringify(combined, null, 2));
  return combined;
}

if (require.main === module) {
  const output = path.resolve(process.argv[2] ?? 'release/preview-closure-20260831/round-1');
  runPreviewClosureCanary({
    schema_version: 'builder-deepseek-packaged-canary-input.v2', mode: 'saved_profile',
    executable_path: path.resolve('release/win-unpacked/ClawFabric Builder.exe'),
    source_user_data_path: path.join(process.env.APPDATA, 'clawfabric-builder'),
  }, output).then((result) => process.stdout.write(JSON.stringify({ ok: true, duration_ms: result.total_duration_ms }) + '\n'))
    .catch((error) => {
      fs.writeFileSync(path.join(output, 'failure.json'), JSON.stringify({ code: error.code, message: error.message,
        diagnostic: error.diagnostic }, null, 2));
      process.stderr.write(JSON.stringify({ ok: false, code: error.code, message: error.message }) + '\n');
      process.exitCode = 1;
    });
}

module.exports = { PLAN, UPDATE, validateEvidence, runPreviewClosureCanary };
