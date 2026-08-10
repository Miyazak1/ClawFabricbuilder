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
  BuilderCheckRunSaveGateError,
  createBuilderCheckRunSaveGate,
} = require('../electron/builder-check-run-save-gate.cjs');
const {
  createBuilderCheckRunStore,
} = require('../electron/builder-check-run-store.cjs');
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

function harness(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'builder-check-save-gate-'));
  const store = createBuilderCheckRunStore(path.join(root, 'checks.sqlite'));
  const activity = createBuilderCheckRunActivityRegistry();
  const gate = createBuilderCheckRunSaveGate({
    check_run_store: store,
    activity_registry: activity,
  });
  t.after(() => {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { store, activity, gate };
}

test('allows an inactive current candidate with no check or a matching passed check', async (t) => {
  const h = harness(t);
  const selected = admittedCheck();
  const absent = await h.gate.with_current_candidate_save_gate(
    currentCandidate(selected.admission),
    (admission) => admission,
  );
  assert.deepEqual(absent, { save_admission: 'allow_not_run', check_run: null });

  const passed = checkRun('passed');
  h.store.record_check_run({ check_run: passed });
  const admitted = await h.gate.with_current_candidate_save_gate(
    currentCandidate(passed),
    (admission) => admission,
  );
  assert.equal(admitted.save_admission, 'allow_passed');
  assert.equal(admitted.check_run.check_run_id, passed.check_run_id);
});

test('blocks save while a check is active and releases the candidate afterward', async (t) => {
  const h = harness(t);
  const selected = admittedCheck();
  assert.equal(h.activity.begin_check_run({ check_run_admission: selected.admission }), true);
  await assert.rejects(
    h.gate.with_current_candidate_save_gate(
      currentCandidate(selected.admission),
      () => true,
    ),
    (error) => error instanceof BuilderCheckRunSaveGateError
      && error.code === 'builder_check_run_save_gate_active',
  );
  assert.equal(h.activity.end_check_run({ check_run_admission: selected.admission }), true);
  assert.equal(await h.gate.with_current_candidate_save_gate(
    currentCandidate(selected.admission),
    () => true,
  ), true);
});

test('holds a save guard across the operation so a check cannot start concurrently', async (t) => {
  const h = harness(t);
  const selected = admittedCheck();
  await h.gate.with_current_candidate_save_gate(
    currentCandidate(selected.admission),
    async () => {
      assert.throws(
        () => h.activity.begin_check_run({ check_run_admission: selected.admission }),
        (error) => error instanceof BuilderCheckRunActivityRegistryError
          && error.code === 'builder_check_run_activity_busy',
      );
    },
  );
  assert.equal(h.activity.begin_check_run({ check_run_admission: selected.admission }), true);
  assert.equal(h.activity.end_check_run({ check_run_admission: selected.admission }), true);

  const operationFailure = new Error('private save failure');
  await assert.rejects(
    h.gate.with_current_candidate_save_gate(
      currentCandidate(selected.admission),
      () => { throw operationFailure; },
    ),
    operationFailure,
  );
  assert.equal(h.activity.begin_check_run({ check_run_admission: selected.admission }), true);
  assert.equal(h.activity.end_check_run({ check_run_admission: selected.admission }), true);
});

test('fails closed for failed, incomplete, stale, malformed, and unavailable results', async (t) => {
  for (const status of [
    'failed',
    'timed_out',
    'environment_unavailable',
    'cancelled',
    'spawn_failed',
    'output_exceeded',
    'termination_failed',
  ]) {
    const h = harness(t);
    const result = checkRun(status);
    h.store.record_check_run({ check_run: result });
    await assert.rejects(
      h.gate.with_current_candidate_save_gate(currentCandidate(result), () => true),
      (error) => error instanceof BuilderCheckRunSaveGateError
        && error.code === 'builder_check_run_save_gate_failed',
    );
  }

  const staleHarness = harness(t);
  const passed = checkRun('passed');
  staleHarness.store.record_check_run({ check_run: passed });
  for (const overrides of [
    { conversation_id: 'builder-conversation:223e4567-e89b-42d3-a456-426614174000' },
    { turn_id: 'builder-turn:223e4567-e89b-42d3-a456-426614174000' },
    { task_id: 'builder-task:223e4567-e89b-42d3-a456-426614174000' },
    { run_id: 'builder-run:223e4567-e89b-42d3-a456-426614174000' },
    { draft_id: `builder-generation-draft:${'f'.repeat(64)}` },
    { draft_checkpoint_id: `builder-draft-checkpoint:${'f'.repeat(64)}` },
    { draft_checkpoint_sequence: passed.draft_checkpoint_sequence + 1 },
    { candidate_digest: `sha256:${'f'.repeat(64)}` },
    { resulting_tree_digest: `sha256:${'f'.repeat(64)}` },
  ]) {
    await assert.rejects(
      staleHarness.gate.with_current_candidate_save_gate(
        currentCandidate(passed, overrides),
        () => true,
      ),
      (error) => error instanceof BuilderCheckRunSaveGateError
        && error.code === 'builder_check_run_save_gate_stale',
    );
  }

  const newCandidate = currentCandidate(passed, {
    candidate_id: `builder-code-change-candidate:${'f'.repeat(64)}`,
    candidate_digest: `sha256:${'f'.repeat(64)}`,
  });
  assert.equal(await staleHarness.gate.with_current_candidate_save_gate(
    newCandidate,
    (admission) => admission.save_admission,
  ), 'allow_not_run');

  const activity = createBuilderCheckRunActivityRegistry();
  for (const read_latest_check_run of [
    () => ({ status: 'absent', check_run: null }),
    () => { throw new Error('private database path'); },
  ]) {
    const store = {
      store_version: 'builder-check-run-store.v1',
      read_latest_check_run,
    };
    const gate = createBuilderCheckRunSaveGate({
      check_run_store: store,
      activity_registry: activity,
    });
    await assert.rejects(
      gate.with_current_candidate_save_gate(
        currentCandidate(admittedCheck().admission),
        () => true,
      ),
      (error) => error instanceof BuilderCheckRunSaveGateError,
    );
  }
});

test('rejects extra fields and proxy inputs without invoking the operation', async (t) => {
  const h = harness(t);
  const selected = admittedCheck();
  let invoked = 0;
  for (const request of [
    { ...currentCandidate(selected.admission), source_tree: [] },
    new Proxy(currentCandidate(selected.admission), {}),
  ]) {
    await assert.rejects(
      h.gate.with_current_candidate_save_gate(request, () => { invoked += 1; }),
      (error) => error instanceof BuilderCheckRunSaveGateError,
    );
  }
  assert.equal(invoked, 0);
});
