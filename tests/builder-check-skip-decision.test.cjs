'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  BuilderCheckSkipDecisionError,
  createBuilderCheckSkipDecision,
  sanitizeBuilderCheckSkipDecision,
} = require('../electron/builder-check-skip-decision.cjs');

function input(overrides = {}) {
  return {
    project_id: 'builder-project:123e4567-e89b-42d3-a456-426614174000',
    conversation_id: 'builder-conversation:123e4567-e89b-42d3-a456-426614174000',
    turn_id: 'builder-turn:123e4567-e89b-42d3-a456-426614174000',
    task_id: 'builder-task:123e4567-e89b-42d3-a456-426614174000',
    run_id: 'builder-run:123e4567-e89b-42d3-a456-426614174000',
    draft_id: `builder-generation-draft:${'1'.repeat(64)}`,
    draft_checkpoint_id: `builder-draft-checkpoint:${'2'.repeat(64)}`,
    draft_checkpoint_sequence: 2,
    candidate_id: `builder-code-change-candidate:${'3'.repeat(64)}`,
    candidate_digest: `sha256:${'4'.repeat(64)}`,
    resulting_tree_digest: `sha256:${'5'.repeat(64)}`,
    reason_code: 'user_chose_save_without_check',
    decided_at_ms: 1_800_000_000_000,
    ...overrides,
  };
}

test('creates a deterministic candidate-bound explicit check skip decision', () => {
  const first = createBuilderCheckSkipDecision(input());
  const second = createBuilderCheckSkipDecision(input());
  assert.deepEqual(first, second);
  assert.match(first.decision_id, /^builder-check-skip-decision:[0-9a-f]{64}$/u);
  assert.match(first.decision_digest, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(first.authority.intent_evidence, 'explicit_user_action_admitted_by_main');
  assert.equal(first.authority.check_execution, 'not_performed_by_decision');
  assert.equal(first.authority.save_authority, 'not_granted');
  assert.equal(Object.isFrozen(first), true);
  assert.deepEqual(sanitizeBuilderCheckSkipDecision(first), first);
});

test('binds decision identity to every current draft and candidate fact', () => {
  const baseline = createBuilderCheckSkipDecision(input());
  const drifts = [
    { conversation_id: 'builder-conversation:223e4567-e89b-42d3-a456-426614174000' },
    { turn_id: 'builder-turn:223e4567-e89b-42d3-a456-426614174000' },
    { task_id: 'builder-task:223e4567-e89b-42d3-a456-426614174000' },
    { run_id: 'builder-run:223e4567-e89b-42d3-a456-426614174000' },
    { draft_id: `builder-generation-draft:${'a'.repeat(64)}` },
    { draft_checkpoint_id: `builder-draft-checkpoint:${'b'.repeat(64)}` },
    { draft_checkpoint_sequence: 3 },
    { candidate_id: `builder-code-change-candidate:${'c'.repeat(64)}` },
    { candidate_digest: `sha256:${'d'.repeat(64)}` },
    { resulting_tree_digest: `sha256:${'e'.repeat(64)}` },
    { decided_at_ms: input().decided_at_ms + 1 },
  ];
  for (const drift of drifts) {
    assert.notEqual(createBuilderCheckSkipDecision(input(drift)).decision_id, baseline.decision_id);
  }
});

test('rejects forged authority, malformed reason, extras, accessors, and proxies', () => {
  const decision = createBuilderCheckSkipDecision(input());
  const invalid = [
    input({ reason_code: 'automatic_skip' }),
    { ...input(), save_authority: true },
    new Proxy(input(), {}),
    { ...decision, decision_digest: `sha256:${'f'.repeat(64)}` },
    { ...decision, authority: { ...decision.authority, save_authority: 'granted' } },
  ];
  for (const value of invalid) {
    assert.throws(
      () => value.decision_version === undefined
        ? createBuilderCheckSkipDecision(value)
        : sanitizeBuilderCheckSkipDecision(value),
      (error) => error instanceof BuilderCheckSkipDecisionError,
    );
  }
  const accessor = input();
  Object.defineProperty(accessor, 'candidate_id', {
    enumerable: true,
    get() { throw new Error('private marker'); },
  });
  assert.throws(
    () => createBuilderCheckSkipDecision(accessor),
    (error) => error instanceof BuilderCheckSkipDecisionError
      && !String(error.message).includes('private marker'),
  );
});

test('source remains a pure fact contract without runtime or storage authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-check-skip-decision.cjs'),
    'utf8',
  );
  assert.doesNotMatch(source, /node:fs|node:sqlite|electron|ipcMain|webContents|fetch\(|child_process|spawn\(|exec\(|safeStorage/iu);
  assert.doesNotMatch(source, /writeFile|rename|unlink|commit_oid|update-ref|provider|source_tree/iu);
});
