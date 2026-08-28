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
  BuilderHarnessCandidateProjectorError,
  projectBuilderHarnessCandidate,
} = require('../electron/builder-harness-candidate-projector.cjs');
const {
  createBuilderProjectSourceTree,
} = require('../electron/builder-project-source-tree.cjs');

const UUID = '123e4567-e89b-42d3-a456-426614174000';
const PROJECT_ID = `builder-project:${UUID}`;
const CONVERSATION_ID = `builder-conversation:${UUID}`;
const TURN_ID = 'builder-turn:00000000-0000-4000-8000-000000000001';
const TASK_ID = 'builder-task:00000000-0000-4000-8000-000000000001';
const RUN_ID = 'builder-run:00000000-0000-4000-8000-000000000001';
const MESSAGE_ID = 'builder-message:00000000-0000-4000-8000-000000000001';
const ZERO_DIGEST = `sha256:${'0'.repeat(64)}`;

function eventId(kind, index) {
  return `builder-${kind}:00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;
}

function append(events, eventType, payload) {
  const previous = events.at(-1) ?? null;
  return [...events, createBuilderConversationEvent({
    record_version: CONVERSATION_EVENT_VERSION,
    record_kind: CONVERSATION_EVENT_KIND,
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    sequence: events.length + 1,
    command_id: eventId('command', events.length + 1),
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
  const message = { message_id: MESSAGE_ID, text: 'Update the project.' };
  const task = { task_id: TASK_ID, title: 'Update project' };
  let events = append([], 'turn_submitted', {
    message,
    turn_id: TURN_ID,
    mode: 'work',
    task,
    base_revision: null,
    route_decision: {
      decision_id: `builder-route-decision:${MESSAGE_ID.slice('builder-message:'.length)}`,
      decision_version: 'builder-composer-route-decision.v1',
      project_id: PROJECT_ID,
      message_id: MESSAGE_ID,
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

function request(base, resulting) {
  return {
    conversation_events: activeRunEvents(),
    turn_id: TURN_ID,
    run_id: RUN_ID,
    base_revision_evidence: null,
    base_source_tree: base,
    resulting_source_tree: resulting,
  };
}

test('projects Harness workspace edits, additions, and removals into one Builder candidate', () => {
  const base = createBuilderProjectSourceTree({ files: [
    { path: 'README.md', content: '# Before\n' },
    { path: 'src/old.js', content: 'export const old = true;\n' },
  ] });
  const resulting = createBuilderProjectSourceTree({ files: [
    { path: 'README.md', content: '# After\n' },
    { path: 'src/new.js', content: 'export const ready = true;\n' },
  ] });

  const candidate = projectBuilderHarnessCandidate(request(base, resulting));

  assert.deepEqual(candidate.operations.map(({ operation, path }) => ({ operation, path })), [
    { operation: 'upsert', path: 'README.md' },
    { operation: 'upsert', path: 'src/new.js' },
    { operation: 'delete', path: 'src/old.js' },
  ]);
  assert.equal(candidate.resulting_tree_digest, resulting.source_tree_digest);
  assert.deepEqual(candidate.resulting_source_tree, resulting);
});

test('fails explicitly when a Harness turn did not change the workspace', () => {
  const tree = createBuilderProjectSourceTree({ files: [
    { path: 'README.md', content: '# Same\n' },
  ] });
  assert.throws(
    () => projectBuilderHarnessCandidate(request(tree, tree)),
    (error) => error instanceof BuilderHarnessCandidateProjectorError
      && error.code === 'builder_harness_candidate_projection_unchanged',
  );
});

test('does not accept a target tree that differs from the projected candidate', () => {
  const base = createBuilderProjectSourceTree({ files: [] });
  assert.throws(
    () => projectBuilderHarnessCandidate(request(base, createBuilderProjectSourceTree({ files: [
      { path: '../outside.txt', content: 'no' },
    ] }))),
    (error) => error instanceof BuilderHarnessCandidateProjectorError
      || error?.code === 'builder_project_source_tree_invalid',
  );
});
