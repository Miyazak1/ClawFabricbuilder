'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { _electron: electron } = require('playwright-core');
const {
  PACKAGED_CANARY_USER_DATA_PREFIX, SELECTORS, captureGuardedUserDataRoot,
  createCanaryProjectRoot, copySavedProviderProfile, sanitizeLaunchEnvironment,
} = require('./verify-packaged-canary.cjs');

const INSTRUCTION = '我打算做一个博客，需要网页3D，做一个足球场，足球场上可以交互，对应我的博客页面。';

function readTerminalDiagnostics(userDataPath) {
  const databasePath = path.join(
    userDataPath, 'builder-agent-conversations-v1', 'agent-conversations.sqlite',
  );
  if (!fs.existsSync(databasePath)) return [];
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    return database.prepare(`
      SELECT payload_json
      FROM agent_conversation_events
      WHERE event_type = 'run_completed'
      ORDER BY sequence DESC
      LIMIT 2
    `).all().flatMap((row) => {
      try {
        const payload = JSON.parse(row.payload_json);
        return [{
          terminal_status: payload.terminal_status ?? null,
          result_kind: payload.result_kind ?? null,
          failure_code: typeof payload.failure_code === 'string' ? payload.failure_code : null,
          assistant_text_length: typeof payload.assistant_message?.text === 'string'
            ? payload.assistant_message.text.length : null,
        }];
      } catch {
        return [];
      }
    });
  } finally {
    database.close();
  }
}

async function run() {
  const argumentsList = process.argv.slice(2);
  const executableArgumentIndex = argumentsList.indexOf('--executable');
  const executablePath = executableArgumentIndex >= 0
    ? path.resolve(argumentsList[executableArgumentIndex + 1])
    : path.resolve('release/win-unpacked/ClawFabric Builder.exe');
  const outputArgumentIndex = argumentsList.indexOf('--output');
  const output = path.resolve(outputArgumentIndex >= 0
    ? argumentsList[outputArgumentIndex + 1]
    : 'release/agent-plan-deepseek-20260901');
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), PACKAGED_CANARY_USER_DATA_PREFIX));
  const root = captureGuardedUserDataRoot(userData);
  const projectRoot = createCanaryProjectRoot(root);
  let app = null;
  fs.mkdirSync(output, { recursive: true });
  try {
    copySavedProviderProfile({ mode: 'saved_profile',
      source_user_data_path: path.join(process.env.APPDATA, 'clawfabric-builder') }, root);
    app = await electron.launch({
      executablePath, args: [],
      env: { ...sanitizeLaunchEnvironment(process.env, root.path, projectRoot), BUILDER_PERF_TRACE: '1' },
    });
    const page = await app.firstWindow();
    await page.locator(SELECTORS.agentRosterItem).click();
    await page.locator(SELECTORS.composerAddMenuButton).click();
    await page.locator(SELECTORS.composerAddPlanMode).click();
    await page.evaluate(() => {
      const snapshots = [];
      let previous = '';
      const observer = new globalThis.MutationObserver(() => {
        const text = globalThis.document.querySelector('[data-builder-live-output="true"] .cf-builder-live-output-text')?.textContent ?? '';
        // Markdown reparsing changes textContent without starting another provider request.
        if (previous.length > 500 && text.length < previous.length / 2 && snapshots.length < 4) snapshots.push(previous);
        previous = text;
      });
      observer.observe(globalThis.document.body, { subtree: true, childList: true, characterData: true });
      globalThis.__canaryReadPlanSnapshots = () => [...snapshots, ...(previous ? [previous] : [])];
    });
    await page.locator(SELECTORS.idea).fill(INSTRUCTION);
    await page.locator(SELECTORS.submitTurn).click();
    const outcome = await Promise.race([
      page.locator('[data-builder-agent-plan-decision="true"]').waitFor({ state: 'visible', timeout: 180_000 }).then(() => 'review'),
      page.getByRole('alert').waitFor({ state: 'visible', timeout: 180_000 }).then(() => 'failed'),
    ]);
    await page.locator(SELECTORS.cancelWork).waitFor({ state: 'hidden', timeout: 15_000 });
    const snapshots = await page.evaluate(() => globalThis.__canaryReadPlanSnapshots());
    fs.writeFileSync(path.join(output, 'visible-plan-snapshots.json'), JSON.stringify(snapshots, null, 2));
    await page.screenshot({ path: path.join(output, 'result.png') });
    fs.writeFileSync(path.join(output, 'outcome.json'), JSON.stringify({ outcome }));
    await app.close();
    app = null;
    const trace = JSON.parse(fs.readFileSync(path.join(root.path, 'builder-performance-trace.v1.json'), 'utf8'));
    const validation = trace.metrics
      .filter((metric) => metric.name.startsWith('main.agent_plan.validation.'));
    const terminals = readTerminalDiagnostics(root.path);
    const result = { ok: outcome === 'review', outcome, validation, visible_snapshots: snapshots.length,
      terminals, original_profile_untouched: true, provider: 'configured_provider',
      source_unchanged: fs.readdirSync(projectRoot).length === 0 };
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    assert.equal(outcome, 'review', 'The full plan must finish ready for review.');
  } finally {
    if (app !== null) await app.close();
    const currentRoot = captureGuardedUserDataRoot(root.path);
    assert.deepEqual(currentRoot, root);
    fs.rmSync(currentRoot.path, { force: true, recursive: true });
  }
}

if (require.main === module) run().catch((error) => {
  process.stderr.write(`${error.stack}\n`);
  process.exitCode = 1;
});
