'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  CONVERSATION_AUTHORITY,
  CONVERSATION_EVENT_KIND,
  CONVERSATION_EVENT_VERSION,
  createBuilderConversationEvent,
} = require('../electron/builder-conversation-records.cjs');
const {
  createBuilderCodeChangeCandidate,
} = require('../electron/builder-code-change-kernel.cjs');
const {
  createBuilderEditIntentPlan,
  evaluateBuilderWorkspaceGuard,
} = require('../electron/builder-edit-intent-workspace-guard.cjs');
const {
  BUILDER_EDIT_ATTEMPT_VERSION,
  BuilderEditAttemptError,
  createBuilderEditAttempt,
  projectBuilderEditAttemptRef,
  sanitizeBuilderEditAttempt,
} = require('../electron/builder-edit-attempt.cjs');
const {
  createBuilderProjectSourceTree,
} = require('../electron/builder-project-source-tree.cjs');

const UUID = '123e4567-e89b-42d3-a456-426614174000';
const PROJECT_ID = `builder-project:${UUID}`;
const CONVERSATION_ID = `builder-conversation:${UUID}`;
const TURN_ID = `builder-turn:${UUID}`;
const TASK_ID = `builder-task:${UUID}`;
const RUN_ID = `builder-run:${UUID}`;
const ZERO_DIGEST = `sha256:${'0'.repeat(64)}`;

function uuid(index) {
  return `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;
}

function id(kind, index) { return `builder-${kind}:${uuid(index)}`; }

function append(events, eventType, payload, commandIndex = events.length + 1) {
  const previous = events.at(-1) ?? null;
  return [...events, createBuilderConversationEvent({
    record_version: CONVERSATION_EVENT_VERSION,
    record_kind: CONVERSATION_EVENT_KIND,
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    sequence: events.length + 1,
    command_id: id('command', commandIndex),
    event_type: eventType,
    previous_event: previous === null ? null : {
      sequence: previous.sequence,
      event_id: previous.event_id,
      event_digest: previous.event_digest,
    },
    payload,
    authority: { ...CONVERSATION_AUTHORITY },
  })];
}

function activeRunEvents() {
  const messageId = id('message', 1);
  let events = append([], 'turn_submitted', {
    message: { message_id: messageId, text: 'Update the selected project.' },
    turn_id: TURN_ID,
    mode: 'work',
    task: { task_id: TASK_ID, title: 'Update project' },
    base_revision: null,
    route_decision: {
      decision_id: `builder-route-decision:${messageId.slice('builder-message:'.length)}`,
      decision_version: 'builder-composer-route-decision.v1',
      project_id: PROJECT_ID,
      message_id: messageId,
      task_id: TASK_ID,
      route: 'build',
      confidence: 'high',
      matched_signals: ['clear_build'],
      downgraded_from: null,
      downgrade_reason: null,
      required_permissions: ['write_project'],
      permission_result: 'allowed',
      dispatch: 'build',
      decided_at_ms: 1,
    },
  });
  events = append(events, 'run_started', {
    turn_id: TURN_ID,
    run_id: RUN_ID,
    task_id: TASK_ID,
    attempt_number: 1,
    retry_of_run_id: null,
    input_digest: ZERO_DIGEST,
  });
  return events;
}

function admittedEvidence() {
  const base = createBuilderProjectSourceTree({ files: [
    { path: 'README.md', content: '# Before\n' },
  ] });
  const candidate = createBuilderCodeChangeCandidate({
    conversation_events: activeRunEvents(),
    turn_id: TURN_ID,
    run_id: RUN_ID,
    base_revision_evidence: null,
    base_source_tree: base,
    operations: [
      { operation: 'upsert', path: 'README.md', content: '# After\n' },
      { operation: 'upsert', path: 'src/app.js', content: 'export const ready = true;\n' },
    ],
  });
  const plan = createBuilderEditIntentPlan({ candidate, created_at_ms: 100 });
  const report = evaluateBuilderWorkspaceGuard({
    candidate,
    edit_intent_plan: plan,
    observed_workspace_source_tree: base,
    evaluated_at_ms: 200,
  });
  return { base, candidate, plan, report };
}

function attemptInput(overrides = {}) {
  const evidence = admittedEvidence();
  return {
    candidate: evidence.candidate,
    edit_intent_plan: evidence.plan,
    workspace_guard_report: evidence.report,
    attempted_at_ms: 300,
    ...overrides,
  };
}

function expectInvalid(fn, forbidden = []) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof BuilderEditAttemptError);
    assert.equal(error.code, 'builder_edit_attempt_invalid');
    const serialized = JSON.stringify(error);
    for (const marker of forbidden) assert.doesNotMatch(serialized, new RegExp(marker, 'iu'));
    return true;
  });
}

test('records an immutable successful EditAttempt from an allowed guarded candidate transform', () => {
  const first = createBuilderEditAttempt(attemptInput());
  const second = createBuilderEditAttempt(structuredClone(attemptInput()));

  assert.deepEqual(first, second);
  assert.equal(first.attempt_version, BUILDER_EDIT_ATTEMPT_VERSION);
  assert.equal(first.status, 'succeeded');
  assert.equal(first.attempt_number, 1);
  assert.deepEqual(first.changed_paths, ['README.md', 'src/app.js']);
  assert.deepEqual(first.operation_summary, {
    create_count: 1,
    update_count: 1,
    delete_count: 0,
  });
  assert.equal(first.expected_old_verification, 'candidate_base_and_fresh_workspace_verified');
  assert.equal(first.conflict_summary, null);
  assert.equal(first.authority.source_write, 'not_performed');
  assert.equal(first.authority.git_mutation, false);
  assert.equal(first.authority.rollback_model, 'atomic_in_memory_transform_no_partial_write');
  assert.equal(Object.isFrozen(first), true);
  assert.deepEqual(sanitizeBuilderEditAttempt(structuredClone(first)), first);
});

test('projects a bounded EditAttempt reference for durable checkpoint evidence', () => {
  const attempt = createBuilderEditAttempt(attemptInput());
  assert.deepEqual(projectBuilderEditAttemptRef(attempt), {
    edit_attempt_id: attempt.edit_attempt_id,
    edit_attempt_digest: attempt.edit_attempt_digest,
    status: 'succeeded',
    candidate_id: attempt.candidate_id,
    candidate_digest: attempt.candidate_digest,
    resulting_tree_digest: attempt.resulting_tree_digest,
  });
});

test('fails closed when the guard was not allowed or no longer matches the candidate', () => {
  const evidence = admittedEvidence();
  const deniedReport = structuredClone(evidence.report);
  deniedReport.status = 'denied';
  expectInvalid(() => createBuilderEditAttempt({
    candidate: evidence.candidate,
    edit_intent_plan: evidence.plan,
    workspace_guard_report: deniedReport,
    attempted_at_ms: 300,
  }));

  const changedCandidate = structuredClone(evidence.candidate);
  changedCandidate.resulting_tree_digest = ZERO_DIGEST;
  expectInvalid(() => createBuilderEditAttempt({
    candidate: changedCandidate,
    edit_intent_plan: evidence.plan,
    workspace_guard_report: evidence.report,
    attempted_at_ms: 300,
  }));
});

test('rejects forged attempt facts, extras, accessors, and proxies without leaking payloads', () => {
  const attempt = createBuilderEditAttempt(attemptInput());
  expectInvalid(() => sanitizeBuilderEditAttempt({
    ...attempt,
    edit_attempt_digest: ZERO_DIGEST,
  }));
  expectInvalid(() => createBuilderEditAttempt({ ...attemptInput(), provider_secret: 'secret-value' }), [
    'secret-value',
  ]);

  let invoked = false;
  const trap = () => { invoked = true; throw new Error('secret-value'); };
  const accessor = attemptInput();
  Object.defineProperty(accessor, 'candidate', { enumerable: true, get: trap });
  expectInvalid(() => createBuilderEditAttempt(accessor), ['secret-value']);
  expectInvalid(() => createBuilderEditAttempt(new Proxy({}, {
    getOwnPropertyDescriptor: trap,
    getPrototypeOf: trap,
    ownKeys: trap,
  })), ['secret-value']);
  assert.equal(invoked, false);
});

test('source remains a pure main-side fact contract without mutation or dispatch authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-edit-attempt.cjs'),
    'utf8',
  );
  assert.match(source, /builder-edit-attempt\.v1/u);
  assert.match(source, /atomic_in_memory_transform_no_partial_write/u);
  assert.doesNotMatch(
    source,
    /require\(['"]electron['"]\)|ipcMain|ipcRenderer|contextBridge|BrowserWindow|safeStorage|fetch\s*\(|https?:|Authorization|Bearer|provider_secret|credential_value|child_process|execFile|spawn\s*\(|writeFile|appendFile|mkdir|rm\(|unlink|persist_candidate_commit|record_project_revision|saveDraft|record_grant|publish|upload/iu,
  );
});
