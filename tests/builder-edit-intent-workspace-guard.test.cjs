'use strict';

const assert = require('node:assert/strict');
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
  BUILDER_EDIT_INTENT_PLAN_VERSION,
  BUILDER_WORKSPACE_GUARD_REPORT_VERSION,
  LARGE_CHANGE_THRESHOLD,
  BuilderEditIntentWorkspaceGuardError,
  createBuilderEditIntentPlan,
  evaluateBuilderWorkspaceGuard,
  sanitizeBuilderEditIntentPlan,
  sanitizeBuilderWorkspaceGuardReport,
} = require('../electron/builder-edit-intent-workspace-guard.cjs');
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

function id(kind, index) {
  return `builder-${kind}:${uuid(index)}`;
}

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

function tree(files = []) {
  return createBuilderProjectSourceTree({ files });
}

function candidate({ base = tree(), operations } = {}) {
  return createBuilderCodeChangeCandidate({
    conversation_events: activeRunEvents(),
    turn_id: TURN_ID,
    run_id: RUN_ID,
    base_revision_evidence: null,
    base_source_tree: base,
    operations: operations ?? [
      { operation: 'upsert', path: 'src/app.js', content: 'export const ready = true;\n' },
    ],
  });
}

function planFor(value, createdAt = 100) {
  return createBuilderEditIntentPlan({ candidate: value, created_at_ms: createdAt });
}

function reportFor(value, observed = value.base_source_tree, evaluatedAt = 200) {
  return evaluateBuilderWorkspaceGuard({
    candidate: value,
    edit_intent_plan: planFor(value),
    observed_workspace_source_tree: observed,
    evaluated_at_ms: evaluatedAt,
  });
}

function expectInvalid(fn, forbidden = []) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof BuilderEditIntentWorkspaceGuardError);
    assert.equal(error.code, 'builder_edit_intent_workspace_guard_invalid');
    const serialized = JSON.stringify({
      name: error.name,
      code: error.code,
      message: error.message,
      stack: error.stack,
    });
    for (const marker of forbidden) assert.doesNotMatch(serialized, new RegExp(marker, 'iu'));
    return true;
  });
}

test('projects a deterministic candidate into an exact immutable EditIntentPlan', () => {
  const base = tree([
    { path: 'README.md', content: '# Before\n' },
    { path: 'src/old.js', content: 'export const old = true;\n' },
  ]);
  const value = candidate({
    base,
    operations: [
      { operation: 'upsert', path: 'README.md', content: '# After\n' },
      { operation: 'delete', path: 'src/old.js', content: null },
      { operation: 'upsert', path: 'src/new.js', content: 'export const next = true;\n' },
    ],
  });
  const first = planFor(value);
  const second = planFor(structuredClone(value));

  assert.deepEqual(first, second);
  assert.equal(first.plan_version, BUILDER_EDIT_INTENT_PLAN_VERSION);
  assert.equal(first.risk_class, 'destructive');
  assert.equal(first.status, 'proposed');
  assert.equal(first.reason, 'provider_proposed_code_change');
  assert.deepEqual(first.target_paths, ['README.md', 'src/new.js', 'src/old.js']);
  assert.deepEqual(first.file_operations.map(({ path, operation }) => ({ path, operation })), [
    { path: 'README.md', operation: 'update' },
    { path: 'src/new.js', operation: 'create' },
    { path: 'src/old.js', operation: 'delete' },
  ]);
  assert.equal(first.file_operations[0].expected_old_content_digest, base.files[0].content_digest);
  assert.equal(first.file_operations[1].expected_old_content_digest, null);
  assert.equal(first.file_operations[2].proposed_content_digest, null);
  assert.equal(first.authority.source_write, 'not_performed');
  assert.equal(first.authority.git_mutation, false);
  assert.equal(first.authority.renderer_authority, 'not_present');
  assert.equal(first.edit_intent_plan_id, `builder-edit-intent-plan:${first.plan_digest.slice(7)}`);
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.file_operations));
  assert.deepEqual(sanitizeBuilderEditIntentPlan(structuredClone(first)), first);
});

test('allows ordinary creates and updates only against a fresh matching workspace snapshot', () => {
  const base = tree([{ path: 'src/app.js', content: 'export const value = 1;\n' }]);
  const value = candidate({
    base,
    operations: [
      { operation: 'upsert', path: 'src/app.js', content: 'export const value = 2;\n' },
      { operation: 'upsert', path: 'src/view.js', content: 'export const view = true;\n' },
    ],
  });
  const report = reportFor(value);

  assert.equal(report.report_version, BUILDER_WORKSPACE_GUARD_REPORT_VERSION);
  assert.equal(report.status, 'allowed');
  assert.deepEqual(report.decisions.map(({ path, decision, reason }) => ({ path, decision, reason })), [
    { path: 'src/app.js', decision: 'allowed', reason: 'ordinary_project_file' },
    { path: 'src/view.js', decision: 'allowed', reason: 'ordinary_project_file' },
  ]);
  assert.deepEqual(report.summary, {
    allowed_count: 2,
    approval_required_count: 0,
    denied_count: 0,
    changed_path_count: 2,
    workspace_conflict_count: 0,
    external_workspace_conflict_check: 'verified_no_workspace_drift',
  });
  assert.equal(report.observed_workspace_source_tree_digest, base.source_tree_digest);
  assert.equal(report.authority.source_read, 'candidate_and_fresh_workspace_snapshots');
  assert.equal(report.authority.source_write, 'not_performed');
  assert.equal(report.authority.permission_grant_authority, false);
  assert.ok(Object.isFrozen(report));
  assert.deepEqual(sanitizeBuilderWorkspaceGuardReport(structuredClone(report)), report);
});

test('requires visible approval for deletes, lockfiles, and large multi-file changes', () => {
  const deleteBase = tree([{ path: 'src/old.js', content: 'old\n' }]);
  const deletion = candidate({
    base: deleteBase,
    operations: [{ operation: 'delete', path: 'src/old.js', content: null }],
  });
  const deleteReport = reportFor(deletion);
  assert.equal(deleteReport.status, 'approval_required');
  assert.equal(deleteReport.decisions[0].reason, 'file_delete_requires_approval');

  const lockfile = candidate({
    operations: [{ operation: 'upsert', path: 'package-lock.json', content: '{"lockfileVersion":3}\n' }],
  });
  const lockReport = reportFor(lockfile);
  assert.equal(lockReport.status, 'approval_required');
  assert.equal(lockReport.decisions[0].reason, 'lockfile_change_requires_approval');

  const many = candidate({
    operations: Array.from({ length: LARGE_CHANGE_THRESHOLD + 1 }, (_, index) => ({
      operation: 'upsert',
      path: `src/file-${String(index).padStart(2, '0')}.js`,
      content: `export const value${index} = ${index};\n`,
    })),
  });
  const manyReport = reportFor(many);
  assert.equal(manyReport.status, 'approval_required');
  assert.equal(manyReport.summary.approval_required_count, LARGE_CHANGE_THRESHOLD + 1);
  assert.ok(manyReport.decisions.every(
    (decision) => decision.reason === 'large_multi_file_change_requires_approval',
  ));
});

test('denies secret, binary, Git-internal, and generated-output paths', () => {
  const cases = [
    ['.env', 'MODE=development\n', 'protected_secret_file'],
    ['certs/local.pem', 'not a real certificate\n', 'protected_secret_file'],
    ['assets/logo.png', 'not binary data\n', 'protected_binary_file'],
    ['dist/app.js', 'console.log("generated");\n', 'protected_generated_output'],
    ['.git/config', '[core]\nrepositoryformatversion = 0\n', 'protected_git_internal'],
    ['.clawfabric/project.json', '{"project":"local"}\n', 'protected_builder_internal'],
  ];
  for (const [path, content, reason] of cases) {
    const value = candidate({ operations: [{ operation: 'upsert', path, content }] });
    const report = reportFor(value);
    assert.equal(report.status, 'denied', path);
    assert.equal(report.decisions[0].decision, 'denied', path);
    assert.equal(report.decisions[0].reason, reason, path);
  }
});

test('denies update, delete, and create conflicts caused by user changes during the AI request', () => {
  const base = tree([
    { path: 'src/app.js', content: 'export const value = 1;\n' },
    { path: 'src/old.js', content: 'export const old = true;\n' },
  ]);
  const value = candidate({
    base,
    operations: [
      { operation: 'upsert', path: 'src/app.js', content: 'export const value = 2;\n' },
      { operation: 'delete', path: 'src/old.js', content: null },
      { operation: 'upsert', path: 'src/new.js', content: 'export const next = true;\n' },
    ],
  });
  const observed = tree([
    { path: 'src/app.js', content: 'export const userValue = 99;\n' },
    { path: 'src/new.js', content: 'export const userCreated = true;\n' },
  ]);
  const report = reportFor(value, observed);

  assert.equal(report.status, 'denied');
  assert.equal(report.summary.workspace_conflict_count, 3);
  assert.equal(report.summary.denied_count, 3);
  assert.equal(report.summary.external_workspace_conflict_check, 'workspace_drift_detected');
  assert.ok(report.decisions.every(
    (decision) => decision.reason === 'user_changed_file_conflict' && decision.decision === 'denied',
  ));
});

test('fails closed on unrelated workspace drift while save still projects a complete candidate tree', () => {
  const base = tree([{ path: 'src/app.js', content: 'export const value = 1;\n' }]);
  const value = candidate({
    base,
    operations: [{ operation: 'upsert', path: 'src/app.js', content: 'export const value = 2;\n' }],
  });
  const observed = tree([
    { path: 'notes.txt', content: 'user notes\n' },
    { path: 'src/app.js', content: 'export const value = 1;\n' },
  ]);
  const report = reportFor(value, observed);

  assert.equal(report.status, 'denied');
  assert.equal(report.summary.workspace_conflict_count, 1);
  assert.equal(report.decisions[0].reason, 'user_changed_file_conflict');
  assert.equal(report.summary.external_workspace_conflict_check, 'workspace_drift_detected');
});

test('fails closed on candidate, plan, fresh workspace, digest, authority, and decision drift', () => {
  const value = candidate();
  const plan = planFor(value);
  const report = reportFor(value);

  const changedCandidate = structuredClone(value);
  changedCandidate.operations[0].content = 'private changed source marker\n';
  expectInvalid(() => createBuilderEditIntentPlan({ candidate: changedCandidate, created_at_ms: 100 }), [
    'private changed source marker',
  ]);

  const changedRisk = structuredClone(plan);
  changedRisk.risk_class = 'sensitive';
  expectInvalid(() => sanitizeBuilderEditIntentPlan(changedRisk));

  const changedPlanDigest = structuredClone(plan);
  changedPlanDigest.plan_digest = ZERO_DIGEST;
  expectInvalid(() => evaluateBuilderWorkspaceGuard({
    candidate: value,
    edit_intent_plan: changedPlanDigest,
    observed_workspace_source_tree: value.base_source_tree,
    evaluated_at_ms: 200,
  }));

  const changedWorkspace = structuredClone(value.base_source_tree);
  changedWorkspace.files.push({ private: 'workspace marker' });
  expectInvalid(() => evaluateBuilderWorkspaceGuard({
    candidate: value,
    edit_intent_plan: plan,
    observed_workspace_source_tree: changedWorkspace,
    evaluated_at_ms: 200,
  }), ['workspace marker']);

  const changedAuthority = structuredClone(report);
  changedAuthority.authority.source_write = 'performed';
  expectInvalid(() => sanitizeBuilderWorkspaceGuardReport(changedAuthority));

  const changedDecisionId = structuredClone(report);
  changedDecisionId.decisions[0].guard_decision_id = `builder-workspace-guard-decision:${'f'.repeat(64)}`;
  expectInvalid(() => sanitizeBuilderWorkspaceGuardReport(changedDecisionId));

  const extra = { ...plan, renderer_claim: 'private renderer marker' };
  expectInvalid(() => sanitizeBuilderEditIntentPlan(extra), ['private renderer marker']);
});

test('rejects proxies and accessors without invoking their traps', () => {
  let invoked = false;
  const trap = () => {
    invoked = true;
    throw new Error('private trap marker');
  };
  const proxy = new Proxy({}, {
    getOwnPropertyDescriptor: trap,
    getPrototypeOf: trap,
    ownKeys: trap,
  });
  expectInvalid(() => createBuilderEditIntentPlan(proxy), ['private trap marker']);
  assert.equal(invoked, false);

  const value = candidate();
  const accessor = { candidate: value, created_at_ms: 100 };
  Object.defineProperty(accessor, 'candidate', {
    enumerable: true,
    get: trap,
  });
  expectInvalid(() => createBuilderEditIntentPlan(accessor), ['private trap marker']);
  assert.equal(invoked, false);
});
