'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  BUILDER_WORKING_BRIEF_VERSION,
  BUILDER_TASK_CAPSULE_VERSION,
  BUILDER_TASK_CAPSULE_UPDATE_VERSION,
  TASK_CAPSULE_UPDATE_AUTHORITY,
  BuilderTaskCapsuleContractError,
  createBuilderWorkingBrief,
  createBuilderTaskCapsule,
  createBuilderTaskCapsuleUpdate,
  sanitizeBuilderWorkingBrief,
  sanitizeBuilderTaskCapsule,
  sanitizeBuilderTaskCapsuleUpdate,
} = require('../electron/builder-task-capsule-contract.cjs');
const {
  CONVERSATION_AUTHORITY,
  CONVERSATION_EVENT_KIND,
  CONVERSATION_EVENT_VERSION,
  createBuilderConversationEvent,
} = require('../electron/builder-conversation-records.cjs');

const PROJECT_ID = 'builder-project:11111111-1111-4111-8111-111111111111';
const CONVERSATION_ID = 'builder-conversation:11111111-1111-4111-8111-111111111111';
const TURN_ID = 'builder-turn:11111111-1111-4111-8111-111111111111';
const RUN_ID = 'builder-run:11111111-1111-4111-8111-111111111111';
const MESSAGE_ID = 'builder-message:11111111-1111-4111-8111-111111111111';
const TASK_ID = 'builder-task:11111111-1111-4111-8111-111111111111';
const ROUTE_DECISION_ID = 'builder-route-decision:11111111-1111-4111-8111-111111111111';
const COMMAND_ID = 'builder-command:11111111-1111-4111-8111-111111111111';

function assertCapsuleError(fn) {
  assert.throws(fn, (error) => (
    error instanceof BuilderTaskCapsuleContractError
    && error.code === 'builder_task_capsule_invalid'
    && !/api[_-]?key|Bearer|credential|provider|source_tree|C:\\|secret-value/iu.test(String(error.stack))
  ));
}

function workingBrief(overrides = {}) {
  return {
    brief_version: BUILDER_WORKING_BRIEF_VERSION,
    source: 'task_capsule_update',
    latest_user_goal: 'Build a portfolio home page with a project gallery.',
    assistant_proposal: 'Use a compact hero, featured project cards, and a contact section.',
    approved_plan: null,
    use_when_instruction_is_contextual: true,
    ...overrides,
  };
}

function taskCapsule(overrides = {}) {
  return {
    capsule_version: BUILDER_TASK_CAPSULE_VERSION,
    task_id: TASK_ID,
    project_id: PROJECT_ID,
    title: 'Portfolio home page',
    goal: 'Create a polished portfolio home page based on the prior discussion.',
    status: 'ready',
    current_brief: workingBrief(),
    last_route_decision_id: ROUTE_DECISION_ID,
    updated_at_ms: 1_234,
    ...overrides,
  };
}

function updateInput(overrides = {}) {
  return {
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    turn_id: TURN_ID,
    run_id: RUN_ID,
    message_id: MESSAGE_ID,
    route_decision_id: ROUTE_DECISION_ID,
    task_capsule: taskCapsule(),
    updated_at_ms: 1_234,
    ...overrides,
  };
}

test('creates and sanitizes working brief and task capsule facts without authority side effects', () => {
  const brief = createBuilderWorkingBrief(workingBrief());
  assert.equal(Object.isFrozen(brief), true);
  assert.deepEqual(sanitizeBuilderWorkingBrief(brief), brief);
  assert.equal(brief.approved_plan, null);
  assert.equal(brief.use_when_instruction_is_contextual, true);

  const discussingBrief = createBuilderWorkingBrief(workingBrief({
    use_when_instruction_is_contextual: false,
  }));
  const discussingCapsule = createBuilderTaskCapsule(taskCapsule({
    status: 'discussing',
    current_brief: discussingBrief,
  }));
  assert.equal(discussingCapsule.status, 'discussing');
  assert.equal(discussingCapsule.current_brief.use_when_instruction_is_contextual, false);

  const capsule = createBuilderTaskCapsule(taskCapsule({ current_brief: brief }));
  assert.equal(Object.isFrozen(capsule), true);
  assert.equal(Object.isFrozen(capsule.current_brief), true);
  assert.deepEqual(sanitizeBuilderTaskCapsule(capsule), capsule);
  assert.deepEqual(Object.keys(capsule), [
    'capsule_version',
    'task_id',
    'project_id',
    'title',
    'goal',
    'status',
    'current_brief',
    'last_route_decision_id',
    'updated_at_ms',
  ]);
  assert.doesNotMatch(
    JSON.stringify(capsule),
    /provider|credential|source_tree|git_candidate|revision_receipt|permission_grant/iu,
  );
});

test('records deterministic task capsule update evidence without dispatching build or writes', () => {
  const first = createBuilderTaskCapsuleUpdate(updateInput());
  const second = createBuilderTaskCapsuleUpdate(updateInput());
  assert.equal(first.update_id, second.update_id);
  assert.equal(first.record_version, BUILDER_TASK_CAPSULE_UPDATE_VERSION);
  assert.deepEqual(first.authority, TASK_CAPSULE_UPDATE_AUTHORITY);
  assert.equal(first.authority.conversation_append, 'not_performed');
  assert.equal(first.authority.sqlite_write, 'not_performed');
  assert.equal(first.authority.provider_dispatch, 'not_performed');
  assert.equal(first.authority.source_mutation, 'not_performed');
  assert.equal(first.authority.git_mutation, 'not_performed');
  assert.equal(first.authority.permission_grant, 'not_performed');
  assert.equal(first.authority.revision_admission, 'not_created');
  assert.deepEqual(sanitizeBuilderTaskCapsuleUpdate(first), first);

  for (const drift of [
    { ...first, update_id: first.update_id.replace(/.$/u, '0') },
    { ...first, project_id: 'builder-project:22222222-2222-4222-8222-222222222222' },
    { ...first, task_capsule: { ...first.task_capsule, last_route_decision_id: 'builder-route-decision:22222222-2222-4222-8222-222222222222' } },
    { ...first, authority: { ...first.authority, provider_dispatch: 'performed' } },
  ]) {
    assertCapsuleError(() => sanitizeBuilderTaskCapsuleUpdate(drift));
  }
});

test('fails closed on malformed brief and capsule inputs', () => {
  for (const invalid of [
    workingBrief({ approved_plan: { state: 'approved' } }),
    workingBrief({ use_when_instruction_is_contextual: null }),
    workingBrief({ source: 'approved_plan' }),
    workingBrief({ latest_user_goal: 'Read C:\\Users\\Admin\\secret.txt' }),
    workingBrief({ assistant_proposal: 'api_key: secret-value' }),
    taskCapsule({ status: 'building' }),
    taskCapsule({ status: 'ready', current_brief: workingBrief({ use_when_instruction_is_contextual: false }) }),
    taskCapsule({ status: 'discussing' }),
    taskCapsule({ current_brief: workingBrief({ brief_version: 'builder-working-brief.v2' }) }),
  ]) {
    if (Object.hasOwn(invalid, 'brief_version')) {
      assertCapsuleError(() => createBuilderWorkingBrief(invalid));
    } else {
      assertCapsuleError(() => createBuilderTaskCapsule(invalid));
    }
  }

  assertCapsuleError(() => createBuilderTaskCapsuleUpdate(updateInput({
    project_id: 'builder-project:22222222-2222-4222-8222-222222222222',
  })));
  assertCapsuleError(() => createBuilderTaskCapsuleUpdate(updateInput({
    route_decision_id: 'builder-route-decision:22222222-2222-4222-8222-222222222222',
  })));
  assertCapsuleError(() => createBuilderTaskCapsuleUpdate(updateInput({
    task_capsule: taskCapsule({ updated_at_ms: 999 }),
  })));
  assertCapsuleError(() => createBuilderTaskCapsuleUpdate(updateInput({
    task_capsule: taskCapsule({ status: 'discussing' }),
  })));
  assertCapsuleError(() => createBuilderTaskCapsuleUpdate(updateInput({
    task_capsule: taskCapsule({
      status: 'discussing',
      current_brief: workingBrief({ use_when_instruction_is_contextual: false }),
    }),
  })));
});

test('rejects proxies, accessors, and forged conversation payloads at the conversation boundary', () => {
  assertCapsuleError(() => createBuilderTaskCapsule(new Proxy(taskCapsule(), {})));
  const accessor = taskCapsule();
  Object.defineProperty(accessor, 'title', {
    enumerable: true,
    get() { return 'Hidden title'; },
  });
  assertCapsuleError(() => createBuilderTaskCapsule(accessor));

  assert.throws(() => createBuilderConversationEvent({
    record_version: CONVERSATION_EVENT_VERSION,
    record_kind: CONVERSATION_EVENT_KIND,
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    sequence: 2,
    command_id: COMMAND_ID,
    event_type: 'task_brief_updated',
    previous_event: {
      sequence: 1,
      event_id: `builder-conversation-event:${'a'.repeat(64)}`,
      event_digest: `sha256:${'b'.repeat(64)}`,
    },
    payload: {
      turn_id: TURN_ID,
      run_id: RUN_ID,
      message_id: MESSAGE_ID,
      task_capsule: taskCapsule({
        project_id: 'builder-project:22222222-2222-4222-8222-222222222222',
      }),
    },
    authority: { ...CONVERSATION_AUTHORITY },
  }), { code: 'builder_conversation_record_invalid' });
});
