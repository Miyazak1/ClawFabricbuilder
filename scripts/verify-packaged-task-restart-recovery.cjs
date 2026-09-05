'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { _electron: electron } = require('playwright-core');
const { createBuilderProductMetadataDatabase } = require('../electron/builder-product-metadata-database.cjs');
const { createBuilderSessionTaskAddressStore } = require('../electron/builder-session-task-address-store.cjs');
const { createBuilderConversationMainService } = require('../electron/builder-conversation-main-service.cjs');
const { DEFAULT_BUILDER_AGENT_ID } = require('../electron/builder-default-agent-bootstrap.cjs');
const { copySavedBuilderWorkspaceProfile } = require('./verify-deepseek-packaged-agent-history-e2e-canary.cjs');
const { PACKAGED_CANARY_USER_DATA_PREFIX, SELECTORS, captureGuardedUserDataRoot,
  createCanaryProjectRoot, sanitizeLaunchEnvironment } = require('./verify-packaged-canary.cjs');

function inspectHistory(root) {
  const database = createBuilderProductMetadataDatabase(path.join(root, 'builder-product-metadata-v6', 'builder.sqlite'));
  const addresses = createBuilderSessionTaskAddressStore(path.join(root, 'builder-session-task-addresses-v2', 'session-task-addresses.sqlite'));
  try {
    const service = createBuilderConversationMainService({ metadataAuthority: database, createUuid: randomUUID, nowMs: Date.now });
    return addresses.list_task_addresses_for_agent({ agent_id: DEFAULT_BUILDER_AGENT_ID, limit: 512 }).task_addresses.map(({ task_address: task }) => {
      let conversation;
      try {
        conversation = service.read_stream({ project_id: task.project_id, conversation_id: task.conversation_id }).conversation;
      } catch {
        return { project_id: task.project_id, task_address_id: task.task_address_id, active_turn_id: null, read_error: true };
      }
      const items = conversation?.items ?? [];
      return { project_id: task.project_id, task_address_id: task.task_address_id,
        active_turn_id: conversation?.recorded_active_turn_id ?? null,
        head_sequence: conversation?.head_sequence ?? 0,
        latest_runtime_status: items.findLast((item) => item.item_kind === 'programming_runtime_status')?.status ?? null,
        run_count: items.filter((item) => item.item_kind === 'run_started').length,
        terminal: items.findLast((item) => item.item_kind === 'run_completed')?.terminal_status ?? null };
    });
  } finally { addresses.close(); database.close(); }
}

async function run(diagnoseOnly = false) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), PACKAGED_CANARY_USER_DATA_PREFIX));
  const root = captureGuardedUserDataRoot(userData, fs, os);
  const output = path.resolve('release/task-restart-recovery-20260831');
  let app;
  try {
    const projectRoot = createCanaryProjectRoot(root, fs, os);
    copySavedBuilderWorkspaceProfile({ mode: 'saved_profile', source_user_data_path: path.join(process.env.APPDATA, 'clawfabric-builder') }, root);
    const before = inspectHistory(root.realPath);
    const target = before.find((task) => task.active_turn_id !== null);
    fs.mkdirSync(output, { recursive: true });
    if (diagnoseOnly) {
      fs.writeFileSync(path.join(output, 'before.json'), JSON.stringify(before, null, 2));
      process.stdout.write(`${JSON.stringify({ tasks: before.length, target, history: before })}\n`);
      return;
    }
    assert.ok(target, 'Saved test history must contain the interrupted task.');
    async function openTask() {
      app = await electron.launch({ executablePath: path.resolve('release/win-unpacked/ClawFabric Builder.exe'),
        args: [], env: sanitizeLaunchEnvironment(process.env, root.path, projectRoot) });
      const page = await app.firstWindow();
      await page.locator(SELECTORS.agentRosterItem).click();
      const project = page.locator(`button[data-builder-project-id="${target.project_id}"]`);
      await project.waitFor({ state: 'visible' });
      const projectItem = project.locator('xpath=ancestor::li[1]');
      const task = projectItem.locator(`button[data-builder-task-address-id="${target.task_address_id}"]`);
      if (!await task.isVisible()) await projectItem.locator('.cf-builder-agent-project-toggle').click();
      await task.click();
      await page.locator('[data-builder-composer-state="paused"]').waitFor({ state: 'visible', timeout: 30_000 });
      assert.equal(await page.locator('[data-builder-resume-interrupted-run="true"]').isEnabled(), true);
      assert.equal(await page.locator('[data-builder-task-paused="true"]').count(), 0);
      assert.equal(await page.locator('[data-builder-cancel-work="true"]').count(), 0);
      assert.equal(await page.locator('.animate-spin:visible, .cf-builder-activity-spinner:visible').count(), 0);
      return page;
    }
    let page = await openTask();
    await page.screenshot({ path: path.join(output, 'paused-task.png') });
    await app.close(); app = null;
    const recovered = inspectHistory(root.realPath).find((task) => task.task_address_id === target.task_address_id);
    assert.equal(recovered.active_turn_id, null);
    assert.equal(recovered.terminal, 'interrupted');
    assert.equal(recovered.run_count, target.run_count);
    page = await openTask();
    await page.screenshot({ path: path.join(output, 'paused-task-reopened.png') });
    await app.close(); app = null;
    const reopened = inspectHistory(root.realPath).find((task) => task.task_address_id === target.task_address_id);
    assert.deepEqual(reopened, recovered);
    const result = { ok: true, before: target, recovered, second_restart_unchanged: true,
      provider_configuration_copied: false, automatic_execution: false };
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    if (app) await app.close();
    assert.equal(fs.realpathSync.native(userData), root.realPath);
    assert.equal(path.dirname(root.realPath).toLowerCase(), fs.realpathSync.native(os.tmpdir()).toLowerCase());
    assert.ok(path.basename(root.realPath).startsWith(PACKAGED_CANARY_USER_DATA_PREFIX));
    fs.rmSync(root.realPath, { force: true, recursive: true });
  }
}

if (require.main === module) run(process.argv.includes('--diagnose')).catch((error) => {
  process.stderr.write(`${error.stack}\n`); process.exitCode = 1;
});
