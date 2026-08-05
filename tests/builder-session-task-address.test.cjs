'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  BUILDER_SESSION_ADDRESS_VERSION,
  BUILDER_TASK_ADDRESS_VERSION,
  BuilderSessionTaskAddressError,
  createBuilderSessionAddress,
  createBuilderTaskAddress,
  sanitizeBuilderSessionAddress,
  sanitizeBuilderTaskAddress,
} = require('../electron/builder-session-task-address.cjs');

const PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174200';
const SESSION_ID = 'builder-session:123e4567-e89b-42d3-a456-426614174201';
const PARENT_SESSION_ID = 'builder-session:123e4567-e89b-42d3-a456-426614174202';
const TASK_ADDRESS_ID = 'builder-task-address:123e4567-e89b-42d3-a456-426614174203';
const CHILD_TASK_ADDRESS_ID = 'builder-task-address:123e4567-e89b-42d3-a456-426614174204';
const CONVERSATION_ID = 'builder-conversation:123e4567-e89b-42d3-a456-426614174205';
const AGENT_ID = 'builder-agent:123e4567-e89b-42d3-a456-426614174206';

function digest(char) {
  return `sha256:${char.repeat(64)}`;
}

function sessionInput(overrides = {}) {
  return {
    session_id: SESSION_ID,
    project_id: PROJECT_ID,
    display_id: 'S-A1B2C3',
    title: 'Management dashboard work line',
    status: 'active',
    root_conversation_id: CONVERSATION_ID,
    current_task_id: TASK_ADDRESS_ID,
    parent_session_id: null,
    forked_from_session_id: null,
    forked_from_revision_receipt_digest: null,
    created_by: 'local-user',
    created_at_ms: 1000,
    updated_at_ms: 1100,
    archived_at_ms: null,
    ...overrides,
  };
}

function taskInput(overrides = {}) {
  return {
    task_address_id: TASK_ADDRESS_ID,
    session_id: SESSION_ID,
    project_id: PROJECT_ID,
    agent_id: AGENT_ID,
    parent_task_address_id: null,
    conversation_id: CONVERSATION_ID,
    title: 'Build management dashboard',
    goal: 'Create and refine a local management dashboard for review.',
    status: 'planned',
    current_brief_id: digest('1'),
    current_plan_id: digest('2'),
    base_revision_receipt_digest: null,
    produced_revision_receipt_digest: null,
    created_by: 'local-user',
    created_at_ms: 1000,
    updated_at_ms: 1100,
    closed_at_ms: null,
    ...overrides,
  };
}

function assertAddressError(fn) {
  assert.throws(
    fn,
    (error) => {
      assert.ok(error instanceof BuilderSessionTaskAddressError);
      assert.equal(error.code, 'builder_session_task_address_invalid');
      const text = `${error.name}:${error.message}:${error.stack}`;
      assert.doesNotMatch(
        text,
        /secret-value|credential|Authorization|Bearer|provider|source_tree|C:\\Users|SQLITE/iu,
      );
      return true;
    },
  );
}

test('creates deterministic read-only session and task address facts', () => {
  const session = createBuilderSessionAddress(sessionInput());
  const sameSession = createBuilderSessionAddress(sessionInput());
  const task = createBuilderTaskAddress(taskInput());
  const sameTask = createBuilderTaskAddress(taskInput());

  assert.deepEqual(session, sameSession);
  assert.deepEqual(task, sameTask);
  assert.equal(session.address_version, BUILDER_SESSION_ADDRESS_VERSION);
  assert.match(session.address_id, /^builder-session-address-record:[0-9a-f]{64}$/u);
  assert.equal(session.session_id, SESSION_ID);
  assert.equal(session.current_task_id, TASK_ADDRESS_ID);
  assert.equal(task.address_version, BUILDER_TASK_ADDRESS_VERSION);
  assert.match(task.address_id, /^builder-task-address-record:[0-9a-f]{64}$/u);
  assert.equal(task.task_address_id, TASK_ADDRESS_ID);
  assert.equal(task.session_id, SESSION_ID);
  assert.equal(task.project_id, PROJECT_ID);
  assert.equal(task.conversation_id, CONVERSATION_ID);
  assert.equal(session.lifecycle.address_authority, 'main_session_task_address_contract_v1');
  assert.equal(session.lifecycle.sqlite_write, 'not_performed');
  assert.equal(session.lifecycle.renderer_authority, 'not_present');
  assert.equal(session.lifecycle.provider_dispatch, 'not_performed');
  assert.equal(session.lifecycle.source_mutation, 'not_performed');
  assert.equal(session.lifecycle.git_mutation, 'not_performed');
  assert.equal(session.lifecycle.permission_grant, 'not_performed');
  assert.equal(task.lifecycle.sqlite_write, 'not_performed');
  assert.equal(task.lifecycle.export_materialization, 'not_performed');
  assert.equal(Object.isFrozen(session), true);
  assert.equal(Object.isFrozen(task), true);
  assert.deepEqual(sanitizeBuilderSessionAddress(structuredClone(session)), session);
  assert.deepEqual(sanitizeBuilderTaskAddress(structuredClone(task)), task);
});

test('keeps session lifecycle status explicit for archive and delete scopes', () => {
  const archived = createBuilderSessionAddress(sessionInput({
    status: 'archived',
    current_task_id: null,
    parent_session_id: PARENT_SESSION_ID,
    forked_from_session_id: PARENT_SESSION_ID,
    forked_from_revision_receipt_digest: digest('a'),
    updated_at_ms: 1200,
    archived_at_ms: 1300,
  }));

  assert.equal(archived.status, 'archived');
  assert.equal(archived.current_task_id, null);
  assert.equal(archived.parent_session_id, PARENT_SESSION_ID);
  assert.equal(archived.forked_from_revision_receipt_digest, digest('a'));
  assertAddressError(() => createBuilderSessionAddress(sessionInput({
    status: 'active',
    archived_at_ms: 1200,
  })));
  assertAddressError(() => createBuilderSessionAddress(sessionInput({
    status: 'archived',
    archived_at_ms: null,
  })));
  assertAddressError(() => createBuilderSessionAddress(sessionInput({
    current_task_id: null,
  })));
  assertAddressError(() => createBuilderSessionAddress(sessionInput({
    parent_session_id: SESSION_ID,
  })));
});

test('keeps task address lifecycle tied to executable status and produced revision state', () => {
  const child = createBuilderTaskAddress(taskInput({
    task_address_id: CHILD_TASK_ADDRESS_ID,
    parent_task_address_id: TASK_ADDRESS_ID,
    status: 'review_needed',
    produced_revision_receipt_digest: digest('b'),
    updated_at_ms: 1300,
  }));
  const completed = createBuilderTaskAddress(taskInput({
    status: 'completed',
    produced_revision_receipt_digest: digest('c'),
    updated_at_ms: 1400,
    closed_at_ms: 1500,
  }));

  assert.equal(child.parent_task_address_id, TASK_ADDRESS_ID);
  assert.equal(child.status, 'review_needed');
  assert.equal(completed.status, 'completed');
  assert.equal(completed.closed_at_ms, 1500);
  assertAddressError(() => createBuilderTaskAddress(taskInput({
    parent_task_address_id: TASK_ADDRESS_ID,
  })));
  assertAddressError(() => createBuilderTaskAddress(taskInput({
    status: 'completed',
    closed_at_ms: null,
  })));
  assertAddressError(() => createBuilderTaskAddress(taskInput({
    status: 'active',
    closed_at_ms: 1500,
  })));
  assertAddressError(() => createBuilderTaskAddress(taskInput({
    status: 'active',
    produced_revision_receipt_digest: digest('d'),
  })));
});

test('fails closed on malformed addresses, proxies, accessors, and forged lifecycle authority', () => {
  let traps = 0;
  assertAddressError(() => createBuilderSessionAddress(new Proxy(sessionInput(), {
    ownKeys() {
      traps += 1;
      return [];
    },
  })));
  assert.equal(traps, 0);

  assertAddressError(() => createBuilderSessionAddress({
    ...sessionInput(),
    source_tree: 'secret-value',
  }));

  const accessor = sessionInput();
  Object.defineProperty(accessor, 'project_id', {
    enumerable: true,
    get: () => { throw new Error('secret-value'); },
  });
  assertAddressError(() => createBuilderSessionAddress(accessor));

  assertAddressError(() => createBuilderTaskAddress(taskInput({
    agent_id: 'builder-agent:not-a-uuid',
  })));
  assertAddressError(() => createBuilderTaskAddress(taskInput({
    title: '  padded title  ',
  })));

  const session = createBuilderSessionAddress(sessionInput());
  assertAddressError(() => sanitizeBuilderSessionAddress({
    ...structuredClone(session),
    lifecycle: {
      ...session.lifecycle,
      sqlite_write: 'performed',
    },
  }));

  const task = createBuilderTaskAddress(taskInput());
  assertAddressError(() => sanitizeBuilderTaskAddress({
    ...structuredClone(task),
    lifecycle: {
      ...task.lifecycle,
      provider_dispatch: 'performed',
    },
  }));
});
