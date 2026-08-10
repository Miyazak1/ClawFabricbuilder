'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  BuilderCheckRunMainServiceError,
  createBuilderCheckRunMainService,
} = require('../electron/builder-check-run-main-service.cjs');
const { createBuilderCheckRun } = require('../electron/builder-check-run.cjs');
const {
  projectBuilderCheckRunStatus,
} = require('../electron/builder-check-run-status-projection.cjs');
const { admittedCheck } = require('./helpers/builder-check-run-fixture.cjs');

function request(selected) {
  return {
    draft_id: selected.draft_id,
    draft_checkpoint_ref: selected.checkpoint,
    git_candidate_receipt: selected.candidate,
    git_verification_receipt: selected.verification,
    project_understanding_snapshot: selected.understanding,
    command_profile_id: selected.command_profile_id,
    source_tree: selected.tree,
  };
}

function harness(status = 'passed', overrides = {}) {
  const selected = admittedCheck();
  const calls = [];
  let stored = null;
  let workspace = null;
  const service = createBuilderCheckRunMainService({
    runtime_resolver: {
      resolver_version: 'builder-packaged-check-runtime-resolver.v1',
      resolve_npm_runtime() {
        calls.push('resolve');
        return selected.runtime;
      },
    },
    workspace_materializer: {
      materializer_version: 'builder-check-workspace-materializer.v1',
      materialize_candidate(input) {
        calls.push('materialize');
        assert.equal(input.source_tree, selected.tree);
        workspace = Object.freeze({ token: 'workspace' });
        return workspace;
      },
      cleanup(input) {
        calls.push('cleanup');
        assert.equal(input, workspace);
        workspace = null;
        return { cleaned: true, reason: 'removed' };
      },
    },
    check_run_runner: {
      runner_version: 'builder-check-run-runner.v1',
      async run_check(input) {
        calls.push('run');
        if (overrides.runnerError) throw new Error('private runtime path');
        workspace = null;
        return createBuilderCheckRun({
          check_run_admission: input.check_run_admission,
          status,
          exit_code: status === 'passed' ? 0 : status === 'failed' ? 2 : null,
          output_digest: `sha256:${'e'.repeat(64)}`,
          failure_class: status === 'passed' ? 'none' : status === 'failed' ? 'command_failed' : status,
          started_at_ms: 101,
          completed_at_ms: 120,
        });
      },
    },
    check_run_store: {
      store_version: 'builder-check-run-store.v1',
      record_check_run({ check_run: checkRun }) {
        calls.push('record');
        if (overrides.storeError) throw new Error('private sqlite path');
        stored = checkRun;
        return { operation: 'check_run_recorded' };
      },
    },
    check_run_status_service: {
      service_version: 'builder-check-run-status-service.v1',
      read_current_check_run_status(input) {
        calls.push('status');
        assert.equal(input.project_id, stored.project_id);
        assert.equal(input.candidate_id, stored.candidate_id);
        return {
          check_run_status_projection: projectBuilderCheckRunStatus({ check_run: stored }),
        };
      },
    },
    clock: {
      clock_version: 'builder-clock.v1',
      now_ms: () => 100,
    },
  });
  return { selected, service, calls, get stored() { return stored; } };
}

test('orchestrates approved candidate check through runtime, workspace, runner, store, and status', async () => {
  const h = harness();
  const result = await h.service.run_approved_check(request(h.selected));
  assert.equal(result.result_version, 'builder-check-run-main-result.v1');
  assert.equal(result.operation, 'approved_check_completed');
  assert.equal(result.check_run_status_projection.status, 'passed');
  assert.equal(result.check_run_status_projection.check_run_id, h.stored.check_run_id);
  assert.deepEqual(h.calls, ['resolve', 'materialize', 'run', 'record', 'status']);
  assert.ok(Object.isFrozen(result));
});

test('records a failed check as review evidence instead of turning it into a service failure', async () => {
  const h = harness('failed');
  const result = await h.service.run_approved_check(request(h.selected));
  assert.equal(result.check_run_status_projection.status, 'failed');
  assert.equal(result.check_run_status_projection.label, 'Check failed');
  assert.equal(h.stored.status, 'failed');
});

test('cleans a materialized workspace when the runner rejects before taking ownership', async () => {
  const h = harness('passed', { runnerError: true });
  await assert.rejects(h.service.run_approved_check(request(h.selected)), (error) => {
    assert.ok(error instanceof BuilderCheckRunMainServiceError);
    assert.equal(error.code, 'builder_check_run_main_service_failed');
    assert.doesNotMatch(JSON.stringify(error), /runtime path|workspace|candidate|secret/iu);
    return true;
  });
  assert.deepEqual(h.calls, ['resolve', 'materialize', 'run', 'cleanup']);
});

test('fails closed on storage failure, extra input, accessors, proxies, and malformed dependencies', async () => {
  const storage = harness('passed', { storeError: true });
  await assert.rejects(
    storage.service.run_approved_check(request(storage.selected)),
    BuilderCheckRunMainServiceError,
  );

  const h = harness();
  await assert.rejects(h.service.run_approved_check({
    ...request(h.selected),
    renderer_status: 'passed',
  }), BuilderCheckRunMainServiceError);
  await assert.rejects(
    h.service.run_approved_check(new Proxy(request(h.selected), {})),
    BuilderCheckRunMainServiceError,
  );
  let invoked = false;
  const hostile = {};
  Object.defineProperty(hostile, 'draft_id', {
    enumerable: true,
    get() { invoked = true; return h.selected.draft_id; },
  });
  await assert.rejects(h.service.run_approved_check(hostile), BuilderCheckRunMainServiceError);
  assert.equal(invoked, false);

  assert.throws(() => createBuilderCheckRunMainService({}), BuilderCheckRunMainServiceError);
});

test('source is main-only orchestration without Electron, IPC, provider, or save authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-check-run-main-service.cjs'),
    'utf8',
  );
  assert.doesNotMatch(source, /ipcMain|ipcRenderer|contextBridge|BrowserWindow|preload/iu);
  assert.doesNotMatch(source, /fetch\s*\(|https?:\/\/|provider|api[_-]?key|Authorization/iu);
  assert.doesNotMatch(source, /saveDraft|saveVersion|git\s+commit|DatabaseSync|node:sqlite/iu);
});
