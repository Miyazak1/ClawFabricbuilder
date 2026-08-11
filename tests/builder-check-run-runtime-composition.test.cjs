'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  createBuilderCheckRunActivityRegistry,
} = require('../electron/builder-check-run-activity-registry.cjs');
const {
  createBuilderCheckRunProcessAdapter,
} = require('../electron/builder-check-run-process-adapter.cjs');
const {
  CHECK_WORKSPACE_DIRECTORY,
  createBuilderCheckRunRuntimeComposition,
} = require('../electron/builder-check-run-runtime-composition.cjs');

function tempRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'builder-check-composition-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function dependencies(root) {
  const clock = {
    clock_version: 'builder-clock.v1',
    now_ms: () => 100,
    set_timeout: (callback, delay) => setTimeout(callback, delay),
    clear_timeout: (timer) => clearTimeout(timer),
  };
  return {
    user_data_path: root,
    launcher_path: path.resolve(process.execPath),
    worker_path: path.resolve(__dirname, '..', 'electron', 'builder-packaged-check-script-worker.cjs'),
    process_adapter: createBuilderCheckRunProcessAdapter({
      spawn_process() { throw new Error('not dispatched by composition test'); },
      platform: process.platform,
      windows_root: process.platform === 'win32'
        ? (process.env.SystemRoot ?? `${path.parse(process.execPath).root}Windows`)
        : null,
    }),
    clock,
    conversation_service: {
      service_version: 'builder-conversation-main-service.v1',
      read_candidate_draft() { throw new Error('not read by composition test'); },
    },
    git_authority: {
      read_verified_candidate() { throw new Error('not read by composition test'); },
    },
    automatic_draft_checkpoint_service: {
      service_version: 'builder-automatic-draft-checkpoint-service.v1',
      verify_current_candidate_checkpoint() { throw new Error('not read by composition test'); },
    },
    check_run_store: {
      store_version: 'builder-check-run-store.v1',
      record_check_run() { throw new Error('not written by composition test'); },
      read_latest_check_run() { throw new Error('not read by composition test'); },
    },
    check_skip_decision_store: {
      store_version: 'builder-check-skip-decision-store.v1',
      record_check_skip_decision() { throw new Error('not written by composition test'); },
      read_current_check_skip_decision() { throw new Error('not read by composition test'); },
    },
    check_run_status_service: {
      service_version: 'builder-check-run-status-service.v1',
      read_current_check_run_status() { throw new Error('not read by composition test'); },
    },
    activity_registry: createBuilderCheckRunActivityRegistry(),
  };
}

test('composes a current-draft service from one shared main-owned CheckRun runtime', (t) => {
  const root = tempRoot(t);
  const composition = createBuilderCheckRunRuntimeComposition(dependencies(root));
  assert.equal(composition.composition_version, 'builder-check-run-runtime-composition.v1');
  assert.equal(
    composition.current_draft_service.service_version,
    'builder-check-run-current-draft-service.v1',
  );
  assert.equal(
    composition.current_draft_skip_service.service_version,
    'builder-check-skip-current-draft-service.v1',
  );
  const workspaceRoot = path.join(root, CHECK_WORKSPACE_DIRECTORY);
  assert.equal(fs.lstatSync(workspaceRoot).isDirectory(), true);
  assert.equal(Object.isFrozen(composition), true);
});

test('fails closed before composition for extra options, bad paths, or malformed process authority', (t) => {
  const root = tempRoot(t);
  assert.throws(() => createBuilderCheckRunRuntimeComposition({
    ...dependencies(root),
    renderer: true,
  }), { code: 'builder_check_run_runtime_composition_failed' });
  assert.throws(() => createBuilderCheckRunRuntimeComposition({
    ...dependencies(root),
    launcher_path: 'relative.exe',
  }), { code: 'builder_check_run_runtime_composition_failed' });
  assert.throws(() => createBuilderCheckRunRuntimeComposition({
    ...dependencies(root),
    process_adapter: {},
  }), { code: 'builder_check_run_runtime_composition_failed' });
});

test('composition source contains no IPC, renderer, provider, save, or project mutation authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-check-run-runtime-composition.cjs'),
    'utf8',
  );
  assert.doesNotMatch(source, /ipcMain|contextBridge|preload|provider|save_draft|writeFile|git write/iu);
  assert.match(source, /createBuilderCheckRunRunner/u);
  assert.match(source, /createBuilderCheckRunCurrentDraftService/u);
});
