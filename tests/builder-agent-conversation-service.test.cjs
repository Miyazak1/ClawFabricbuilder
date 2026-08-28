'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  createBuilderAgentConversationService,
} = require('../electron/builder-agent-conversation-service.cjs');

const AGENT_ID = 'builder-agent:123e4567-e89b-42d3-a456-426614174002';
const REQUEST_DIGEST = `sha256:${'a'.repeat(64)}`;
const UUIDS = Object.freeze([
  '123e4567-e89b-42d3-a456-426614174010',
  '123e4567-e89b-42d3-a456-426614174011',
  '123e4567-e89b-42d3-a456-426614174012',
  '123e4567-e89b-42d3-a456-426614174013',
  '123e4567-e89b-42d3-a456-426614174014',
]);

function fixture(databasePath, changed = []) {
  let uuidIndex = 0;
  let timestamp = 100;
  return createBuilderAgentConversationService({
    databasePath,
    agentId: AGENT_ID,
    createUuid() {
      const value = UUIDS[uuidIndex];
      uuidIndex += 1;
      assert.notEqual(value, undefined);
      return value;
    },
    nowMs: () => timestamp++,
    onChanged: (event) => changed.push(event),
  });
}

test('persists an agent-scoped conversation without creating a project identity', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'builder-agent-conversation-'));
  const databasePath = path.join(root, 'agent-conversations.sqlite');
  const changed = [];
  const service = fixture(databasePath, changed);

  const initial = service.read_stream({ agent_id: AGENT_ID });
  assert.equal(initial.conversation, null);
  assert.equal(initial.project_id, null);
  assert.equal(initial.agent_id, AGENT_ID);

  let context = service.begin_question({
    agent_id: AGENT_ID,
    question: 'Help me think through the product structure.',
    request_digest: REQUEST_DIGEST,
    route_decision_hint: { route: 'answer', dispatch: 'reply' },
  });
  assert.equal(context.scope_kind, 'agent_conversation');
  assert.equal(context.project.project_id, null);
  context = service.record_run_progress({ context, stage: 'context_ready' });
  service.complete_explanation({
    context,
    assistant_text: 'We can treat the agent chat as the control plane.',
  });

  const ready = service.read_stream({ agent_id: AGENT_ID });
  assert.notEqual(ready.conversation, null);
  assert.equal(ready.project_id, null);
  assert.match(ready.conversation.conversation_id, /^builder-agent-conversation:/u);
  assert.deepEqual(
    ready.conversation.items.map((item) => [item.role, item.message.text]),
    [
      ['user', 'Help me think through the product structure.'],
      ['assistant', 'We can treat the agent chat as the control plane.'],
    ],
  );
  assert.equal(changed.every((event) => event.agent_id === AGENT_ID), true);
  service.close();

  const restarted = fixture(databasePath);
  assert.deepEqual(restarted.read_stream({ agent_id: AGENT_ID }), ready);
  restarted.close();
  fs.rmSync(root, { recursive: true, force: true });
});

test('projects work discussion as resumable Agent context without promoting every clarification', () => {
  const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'builder-agent-work-context-'));
  const workService = fixture(path.join(workRoot, 'agent-conversations.sqlite'));
  const workContext = workService.begin_question({
    agent_id: AGENT_ID,
    question: 'Let us first discuss how the portfolio should work.',
    request_digest: REQUEST_DIGEST,
    route_decision_hint: {
      route: 'clarify',
      dispatch: 'reply',
      matched_signals: ['work_discussion'],
    },
  });
  workService.complete_explanation({
    context: workContext,
    assistant_text: 'Use a focused single-page portfolio with a project grid.',
  });
  assert.equal(
    workService.read_stream({ agent_id: AGENT_ID }).conversation.items[0].context_route,
    'update_brief',
  );
  workService.close();
  fs.rmSync(workRoot, { recursive: true, force: true });

  const capabilityRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'builder-agent-capability-context-'));
  const capabilityService = fixture(path.join(capabilityRoot, 'agent-conversations.sqlite'));
  const capabilityContext = capabilityService.begin_question({
    agent_id: AGENT_ID,
    question: 'Can you build websites?',
    request_digest: REQUEST_DIGEST,
    route_decision_hint: {
      route: 'clarify',
      dispatch: 'reply',
      matched_signals: ['capability_question'],
    },
  });
  capabilityService.complete_explanation({
    context: capabilityContext,
    assistant_text: 'Yes, I can help with that.',
  });
  assert.equal(
    capabilityService.read_stream({ agent_id: AGENT_ID }).conversation.items[0].context_route,
    'clarify',
  );
  capabilityService.close();
  fs.rmSync(capabilityRoot, { recursive: true, force: true });
});

test('records active-run control messages in the durable agent transcript', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'builder-agent-control-'));
  const service = fixture(path.join(root, 'agent-conversations.sqlite'));
  let context = service.begin_question({
    agent_id: AGENT_ID,
    question: 'Start with the navigation model.',
    request_digest: REQUEST_DIGEST,
    route_decision_hint: { route: 'answer', dispatch: 'reply' },
  });
  context = service.record_steering({ context, message: 'Also account for parallel tasks.' });
  service.record_queued_followup({ context, message: 'Then summarize the decision.' });

  const stream = service.read_stream({ agent_id: AGENT_ID });
  assert.deepEqual(
    stream.conversation.items.map((item) => item.message_kind),
    ['submitted', 'steering', 'queued_followup'],
  );
  service.close();
  fs.rmSync(root, { recursive: true, force: true });
});
