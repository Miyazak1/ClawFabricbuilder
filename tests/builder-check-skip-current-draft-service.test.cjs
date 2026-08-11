'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  BuilderCheckRunActivityRegistryError,
  createBuilderCheckRunActivityRegistry,
} = require('../electron/builder-check-run-activity-registry.cjs');
const {
  BUILDER_CHECK_RUN_CURRENT_DRAFT_MAIN_CANDIDATE_RESULT_VERSION,
  BUILDER_CHECK_RUN_CURRENT_DRAFT_SERVICE_VERSION,
} = require('../electron/builder-check-run-current-draft-service.cjs');
const {
  createBuilderCheckRunStore,
} = require('../electron/builder-check-run-store.cjs');
const {
  BuilderCheckSkipCurrentDraftServiceError,
  createBuilderCheckSkipCurrentDraftService,
} = require('../electron/builder-check-skip-current-draft-service.cjs');
const {
  createBuilderCheckSkipDecisionStore,
} = require('../electron/builder-check-skip-decision-store.cjs');
const { admittedCheck, checkRun } = require('./helpers/builder-check-run-fixture.cjs');

function currentCandidate(admission, overrides = {}) {
  return {
    project_id: admission.project_id,
    conversation_id: admission.conversation_id,
    turn_id: admission.turn_id,
    task_id: admission.task_id,
    run_id: admission.run_id,
    draft_id: admission.draft_id,
    draft_checkpoint_id: admission.draft_checkpoint_id,
    draft_checkpoint_sequence: admission.draft_checkpoint_sequence,
    candidate_id: admission.candidate_id,
    candidate_digest: admission.candidate_digest,
    resulting_tree_digest: admission.resulting_tree_digest,
    ...overrides,
  };
}

function resolvedCandidate(candidate) {
  return {
    result_version: BUILDER_CHECK_RUN_CURRENT_DRAFT_MAIN_CANDIDATE_RESULT_VERSION,
    service_version: BUILDER_CHECK_RUN_CURRENT_DRAFT_SERVICE_VERSION,
    operation: 'current_draft_candidate_resolved_for_main_only',
    current_candidate: candidate,
    authority: {
      caller: 'main_only',
      candidate_identity: 'verified_git_candidate_and_latest_checkpoint',
      renderer_projection: 'not_present',
      source_content: 'not_present',
    },
  };
}

function harness(t, { clockValues = [400, 401] } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'builder-check-skip-current-'));
  const checkRunStore = createBuilderCheckRunStore(path.join(root, 'checks.sqlite'));
  const skipStore = createBuilderCheckSkipDecisionStore(path.join(root, 'skips.sqlite'));
  const activity = createBuilderCheckRunActivityRegistry();
  const selected = admittedCheck();
  const candidate = currentCandidate(selected.admission);
  const calls = { resolve: [], clock: 0 };
  const service = createBuilderCheckSkipCurrentDraftService({
    current_draft_check_run_service: {
      service_version: BUILDER_CHECK_RUN_CURRENT_DRAFT_SERVICE_VERSION,
      read_current_candidate_for_main_only(request) {
        calls.resolve.push(request);
        return resolvedCandidate(candidate);
      },
    },
    check_run_store: checkRunStore,
    check_skip_decision_store: skipStore,
    activity_registry: activity,
    clock: {
      clock_version: 'builder-clock.v1',
      now_ms() {
        const value = clockValues[calls.clock] ?? clockValues.at(-1);
        calls.clock += 1;
        return value;
      },
    },
  });
  t.after(() => {
    checkRunStore.close();
    skipStore.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { activity, calls, candidate, checkRunStore, selected, service, skipStore };
}

test('records and replays an explicit skip for the current verified candidate', async (t) => {
  const h = harness(t, { clockValues: [400, 999] });
  const first = await h.service.skip_current_draft_check({ draft_id: h.candidate.draft_id });
  const replay = await h.service.skip_current_draft_check({ draft_id: h.candidate.draft_id });

  assert.equal(first.operation, 'check_skip_decision_recorded');
  assert.equal(replay.operation, 'check_skip_decision_replayed');
  assert.deepEqual(replay.check_skip_decision, first.check_skip_decision);
  assert.equal(first.check_skip_decision.decided_at_ms, 400);
  assert.equal(h.calls.clock, 1);
  assert.deepEqual(h.calls.resolve, [
    { draft_id: h.candidate.draft_id },
    { draft_id: h.candidate.draft_id },
  ]);
  assert.equal(first.authority.save_version, 'not_performed');
  assert.equal(first.authority.check_execution, 'not_performed');
});

test('does not allow skip to bypass any existing check result', async (t) => {
  const h = harness(t);
  h.checkRunStore.record_check_run({ check_run: checkRun('failed') });

  await assert.rejects(
    h.service.skip_current_draft_check({ draft_id: h.candidate.draft_id }),
    (error) => error instanceof BuilderCheckSkipCurrentDraftServiceError
      && error.code === 'builder_check_skip_current_draft_check_exists',
  );
  assert.equal(h.calls.clock, 0);
  assert.equal(h.skipStore.read_current_check_skip_decision({
    project_id: h.candidate.project_id,
    candidate_id: h.candidate.candidate_id,
  }).status, 'absent');
});

test('shares the candidate activity lock with checks and saves', async (t) => {
  const h = harness(t);
  assert.equal(h.activity.begin_check_run({
    check_run_admission: h.selected.admission,
  }), true);
  await assert.rejects(
    h.service.skip_current_draft_check({ draft_id: h.candidate.draft_id }),
    (error) => error instanceof BuilderCheckSkipCurrentDraftServiceError
      && error.code === 'builder_check_skip_current_draft_busy',
  );
  assert.equal(h.activity.end_check_run({
    check_run_admission: h.selected.admission,
  }), true);

  const guard = h.activity.acquire_candidate_skip({ current_candidate: h.candidate });
  assert.throws(
    () => h.activity.acquire_candidate_save({ current_candidate: h.candidate }),
    (error) => error instanceof BuilderCheckRunActivityRegistryError
      && error.code === 'builder_check_run_activity_busy',
  );
  assert.equal(h.activity.release_candidate_skip({ skip_guard: guard }), true);
});

test('fails closed for forged requests and invalid main candidate results', async (t) => {
  const h = harness(t);
  await assert.rejects(
    h.service.skip_current_draft_check({
      draft_id: h.candidate.draft_id,
      candidate_id: h.candidate.candidate_id,
    }),
    (error) => error instanceof BuilderCheckSkipCurrentDraftServiceError
      && error.code === 'builder_check_skip_current_draft_invalid',
  );

  const service = createBuilderCheckSkipCurrentDraftService({
    current_draft_check_run_service: {
      service_version: BUILDER_CHECK_RUN_CURRENT_DRAFT_SERVICE_VERSION,
      read_current_candidate_for_main_only() {
        return resolvedCandidate({ ...h.candidate, draft_id: `builder-generation-draft:${'f'.repeat(64)}` });
      },
    },
    check_run_store: h.checkRunStore,
    check_skip_decision_store: h.skipStore,
    activity_registry: h.activity,
    clock: { clock_version: 'builder-clock.v1', now_ms() { return 1; } },
  });
  await assert.rejects(
    service.skip_current_draft_check({ draft_id: h.candidate.draft_id }),
    (error) => error instanceof BuilderCheckSkipCurrentDraftServiceError
      && error.code === 'builder_check_skip_current_draft_invalid',
  );
});

test('does not expose source, provider, command, or save authority', async (t) => {
  const h = harness(t);
  const result = await h.service.skip_current_draft_check({ draft_id: h.candidate.draft_id });
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /source_tree|file_contents|provider|credential|command_profile/iu);
  assert.equal(serialized.includes('save_version":"not_performed'), true);
});
