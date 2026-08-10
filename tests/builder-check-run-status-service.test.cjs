'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  BuilderCheckRunStatusServiceError,
  createBuilderCheckRunStatusService,
} = require('../electron/builder-check-run-status-service.cjs');
const {
  BUILDER_CHECK_RUN_STORE_READ_RESULT_VERSION,
} = require('../electron/builder-check-run-store.cjs');
const {
  checkRun,
  PROJECT_ID,
} = require('./helpers/builder-check-run-fixture.cjs');

function storeResult(status, run) {
  return {
    result_version: BUILDER_CHECK_RUN_STORE_READ_RESULT_VERSION,
    operation: 'latest_check_run_read',
    status,
    check_run: run,
    store_evidence: {},
  };
}

function serviceFor(result, requests = []) {
  return createBuilderCheckRunStatusService({
    check_run_store: {
      read_latest_check_run(request) {
        requests.push(request);
        return result;
      },
    },
  });
}

function assertServiceError(fn) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof BuilderCheckRunStatusServiceError);
    assert.equal(error.code, 'builder_check_run_status_service_unavailable');
    assert.equal(error.message, 'Builder check status is unavailable.');
    assert.doesNotMatch(JSON.stringify(error), /sha256|candidate|runtime|output|secret/iu);
    return true;
  });
}

test('reads and projects the latest current-candidate CheckRun', () => {
  const run = checkRun();
  const requests = [];
  const service = serviceFor(storeResult('ready', run), requests);
  const result = service.read_current_check_run_status({
    project_id: run.project_id,
    candidate_id: run.candidate_id,
  });
  assert.deepEqual(requests, [{
    project_id: run.project_id,
    candidate_id: run.candidate_id,
  }]);
  assert.equal(result.check_run_status_projection.status, 'passed');
  assert.equal(result.check_run_status_projection.result_digest, run.check_run_digest);
  assert.ok(Object.isFrozen(result));
});

test('returns an explicit null projection when no check was recorded', () => {
  const result = serviceFor(storeResult('absent', null)).read_current_check_run_status({
    project_id: PROJECT_ID,
    candidate_id: `builder-code-change-candidate:${'a'.repeat(64)}`,
  });
  assert.deepEqual(result, { check_run_status_projection: null });
});

test('fails closed on store drift, cross-candidate results, proxies, and extras', () => {
  const run = checkRun();
  assertServiceError(() => serviceFor(storeResult('ready', run)).read_current_check_run_status({
    project_id: run.project_id,
    candidate_id: `builder-code-change-candidate:${'f'.repeat(64)}`,
  }));
  assertServiceError(() => serviceFor({
    ...storeResult('ready', run),
    operation: 'forged_read',
  }).read_current_check_run_status({
    project_id: run.project_id,
    candidate_id: run.candidate_id,
  }));
  assertServiceError(() => serviceFor(storeResult('ready', run)).read_current_check_run_status({
    project_id: run.project_id,
    candidate_id: run.candidate_id,
    raw_output: true,
  }));
  assertServiceError(() => createBuilderCheckRunStatusService(new Proxy({}, {})));
});

test('source remains a read-only store projection without execution or mutation authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-check-run-status-service.cjs'),
    'utf8',
  );
  assert.match(source, /read_latest_check_run/u);
  assert.doesNotMatch(source, /child_process|\bspawn\b|execFile|shell:\s*true|ipcMain|preload/iu);
  assert.doesNotMatch(source, /record_check_run|git\s+commit|saveDraft|saveVersion|fetch\s*\(/iu);
});
