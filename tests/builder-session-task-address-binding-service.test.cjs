'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  BuilderSessionTaskAddressBindingServiceError,
  RESULT_VERSION,
  SERVICE_VERSION,
  createBuilderSessionTaskAddressBindingService,
} = require('../electron/builder-session-task-address-binding-service.cjs');
const {
  createBuilderSessionAddress,
  createBuilderTaskAddress,
} = require('../electron/builder-session-task-address.cjs');
const {
  createBuilderSessionTaskAddressStore,
} = require('../electron/builder-session-task-address-store.cjs');

const PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174200';
const OTHER_PROJECT_ID = 'builder-project:223e4567-e89b-42d3-a456-426614174200';
const SESSION_ID = 'builder-session:123e4567-e89b-42d3-a456-426614174201';
const TASK_ADDRESS_ID = 'builder-task-address:123e4567-e89b-42d3-a456-426614174203';
const CONVERSATION_ID = 'builder-conversation:123e4567-e89b-42d3-a456-426614174205';
const TURN_ID = 'builder-turn:123e4567-e89b-42d3-a456-426614174206';
const RUN_ID = 'builder-run:123e4567-e89b-42d3-a456-426614174207';
const MESSAGE_ID = 'builder-message:123e4567-e89b-42d3-a456-426614174208';
const CONSUMING_TURN_ID = 'builder-turn:123e4567-e89b-42d3-a456-426614174209';
const CONSUMING_RUN_ID = 'builder-run:123e4567-e89b-42d3-a456-426614174210';
const CONSUMING_MESSAGE_ID = 'builder-message:123e4567-e89b-42d3-a456-426614174211';
const CONSUMING_TASK_ID = 'builder-task:123e4567-e89b-42d3-a456-426614174212';
const AGENT_ID = 'builder-agent:123e4567-e89b-42d3-a456-426614174213';
const APPROVED_PLAN_CONTINUATION_ID = 'builder-approved-plan-continuation:123e4567-e89b-42d3-a456-426614174214';
const DRAFT_CONTINUATION_ID = 'builder-draft-continuation:123e4567-e89b-42d3-a456-426614174215';
const DRAFT_ID = `builder-generation-draft:${'d'.repeat(64)}`;

function temporaryDatabase(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawfabric-builder-address-binding-'));
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  return path.join(root, 'session-task-addresses.sqlite');
}

function digest(char) {
  return `sha256:${char.repeat(64)}`;
}

function sessionAddress(overrides = {}) {
  return createBuilderSessionAddress({
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
  });
}

function taskAddress(overrides = {}) {
  return createBuilderTaskAddress({
    task_address_id: TASK_ADDRESS_ID,
    session_id: SESSION_ID,
    project_id: PROJECT_ID,
    agent_id: AGENT_ID,
    parent_task_address_id: null,
    conversation_id: CONVERSATION_ID,
    title: 'Build management dashboard',
    goal: 'Create and refine a local management dashboard for review.',
    status: 'active',
    current_brief_id: digest('1'),
    current_plan_id: digest('2'),
    base_revision_receipt_digest: null,
    produced_revision_receipt_digest: null,
    created_by: 'local-user',
    created_at_ms: 1000,
    updated_at_ms: 1100,
    closed_at_ms: null,
    ...overrides,
  });
}

function eventAt(sequence, eventType, payload) {
  return {
    record_version: 'builder-conversation-event.v1',
    record_kind: 'builder-conversation-event',
    event_id: `builder-conversation-event:${String(sequence).repeat(64).slice(0, 64)}`,
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    sequence,
    command_id: `builder-command:123e4567-e89b-42d3-a456-42661417420${sequence}`,
    event_type: eventType,
    previous_event: sequence === 1
      ? null
      : {
        sequence: sequence - 1,
        event_id: `builder-conversation-event:${String(sequence - 1).repeat(64).slice(0, 64)}`,
        event_digest: digest(String(sequence - 1)),
      },
    payload,
    authority: {
      storage: 'sqlite_conversation_event_chain',
      provider_dispatch: false,
      renderer_exposure: false,
    },
    command_digest: digest('c'),
    event_digest: digest(String(sequence)),
  };
}

function queuedFollowup() {
  return {
    turn_id: TURN_ID,
    run_id: RUN_ID,
    message_id: MESSAGE_ID,
  };
}

function approvedPlanContinuation(overrides = {}) {
  return {
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    approved_plan_turn_id: TURN_ID,
    approved_plan_task_id: 'builder-task:123e4567-e89b-42d3-a456-426614174215',
    approved_plan_run_id: RUN_ID,
    continuation_id: APPROVED_PLAN_CONTINUATION_ID,
    continuation_admission_digest: digest('a'),
    ...overrides,
  };
}

function draftContinuation(overrides = {}) {
  return {
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    draft_id: DRAFT_ID,
    previous_turn_id: TURN_ID,
    previous_task_id: 'builder-task:123e4567-e89b-42d3-a456-426614174216',
    previous_run_id: RUN_ID,
    continuation_id: DRAFT_CONTINUATION_ID,
    admission_digest: digest('b'),
    candidate_digest: digest('c'),
    ...overrides,
  };
}

function queuedWorkContext(overrides = {}) {
  return {
    context_version: 'builder-conversation-run-context.v1',
    mode: 'work',
    project: {
      project_id: PROJECT_ID,
      created_at_ms: 1000,
    },
    conversation: {
      project_id: PROJECT_ID,
      conversation_id: CONVERSATION_ID,
      created_at_ms: 1000,
    },
    request_digest: digest('1'),
    start_head: {
      sequence: 3,
      event_id: `builder-conversation-event:${'3'.repeat(64)}`,
      event_digest: digest('3'),
    },
    attempt_number: 1,
    events: [
      eventAt(1, 'turn_submitted', {
        turn_id: CONSUMING_TURN_ID,
      }),
      eventAt(2, 'turn_followup_consumed', {
        ...queuedFollowup(),
        consuming_turn_id: CONSUMING_TURN_ID,
        consuming_message_id: CONSUMING_MESSAGE_ID,
      }),
      eventAt(3, 'run_started', {
        turn_id: CONSUMING_TURN_ID,
        run_id: CONSUMING_RUN_ID,
        task_id: CONSUMING_TASK_ID,
        attempt_number: 1,
        retry_of_run_id: null,
        input_digest: digest('1'),
      }),
    ],
    run_terminal_failure_code: null,
    ids: {
      turn_command_id: 'builder-command:123e4567-e89b-42d3-a456-426614174220',
      run_command_id: 'builder-command:123e4567-e89b-42d3-a456-426614174221',
      terminal_command_id: 'builder-command:123e4567-e89b-42d3-a456-426614174222',
      turn_terminal_command_id: 'builder-command:123e4567-e89b-42d3-a456-426614174223',
      cancel_command_id: 'builder-command:123e4567-e89b-42d3-a456-426614174224',
      cancel_request_id: 'builder-cancel-request:123e4567-e89b-42d3-a456-426614174225',
      interrupt_command_id: 'builder-command:123e4567-e89b-42d3-a456-426614174226',
      interrupt_request_id: 'builder-interrupt-request:123e4567-e89b-42d3-a456-426614174227',
      message_id: CONSUMING_MESSAGE_ID,
      assistant_message_id: 'builder-message:123e4567-e89b-42d3-a456-426614174228',
      turn_id: CONSUMING_TURN_ID,
      task_id: CONSUMING_TASK_ID,
      run_id: CONSUMING_RUN_ID,
    },
    cancel_requested: false,
    ...overrides,
  };
}

function approvedPlanWorkContext(overrides = {}) {
  return {
    context_version: 'builder-conversation-run-context.v1',
    mode: 'work',
    project: {
      project_id: PROJECT_ID,
      created_at_ms: 1000,
    },
    conversation: {
      project_id: PROJECT_ID,
      conversation_id: CONVERSATION_ID,
      created_at_ms: 1000,
    },
    request_digest: digest('1'),
    start_head: {
      sequence: 2,
      event_id: `builder-conversation-event:${'2'.repeat(64)}`,
      event_digest: digest('2'),
    },
    attempt_number: 1,
    events: [
      eventAt(1, 'turn_submitted', {
        message: {
          message_id: CONSUMING_MESSAGE_ID,
          text: 'Review the approved plan.\n\nPlan:\n1. Build the approved change.',
        },
        turn_id: CONSUMING_TURN_ID,
        mode: 'work',
        task: {
          task_id: CONSUMING_TASK_ID,
          title: 'Continue approved plan',
        },
        base_revision: null,
        route_decision: {
          route: 'build',
          confidence: 'high',
          matched_signals: ['approved_plan_continuation'],
        },
      }),
      eventAt(2, 'run_started', {
        turn_id: CONSUMING_TURN_ID,
        run_id: CONSUMING_RUN_ID,
        task_id: CONSUMING_TASK_ID,
        attempt_number: 1,
        retry_of_run_id: null,
        input_digest: digest('1'),
      }),
    ],
    run_terminal_failure_code: null,
    ids: {
      turn_command_id: 'builder-command:123e4567-e89b-42d3-a456-426614174220',
      run_command_id: 'builder-command:123e4567-e89b-42d3-a456-426614174221',
      terminal_command_id: 'builder-command:123e4567-e89b-42d3-a456-426614174222',
      turn_terminal_command_id: 'builder-command:123e4567-e89b-42d3-a456-426614174223',
      cancel_command_id: 'builder-command:123e4567-e89b-42d3-a456-426614174224',
      cancel_request_id: 'builder-cancel-request:123e4567-e89b-42d3-a456-426614174225',
      interrupt_command_id: 'builder-command:123e4567-e89b-42d3-a456-426614174226',
      interrupt_request_id: 'builder-interrupt-request:123e4567-e89b-42d3-a456-426614174227',
      message_id: CONSUMING_MESSAGE_ID,
      assistant_message_id: 'builder-message:123e4567-e89b-42d3-a456-426614174228',
      turn_id: CONSUMING_TURN_ID,
      task_id: CONSUMING_TASK_ID,
      run_id: CONSUMING_RUN_ID,
    },
    cancel_requested: false,
    ...overrides,
  };
}

function draftContinuationWorkContext(overrides = {}) {
  const continuation = draftContinuation();
  return approvedPlanWorkContext({
    draft_continuation: {
      admission_digest: continuation.admission_digest,
      draft_id: continuation.draft_id,
      previous_turn_id: continuation.previous_turn_id,
      previous_task_id: continuation.previous_task_id,
      previous_run_id: continuation.previous_run_id,
      previous_candidate_digest: continuation.candidate_digest,
    },
    ...overrides,
  });
}

function assertBindingError(fn) {
  assert.throws(
    fn,
    (error) => {
      assert.ok(error instanceof BuilderSessionTaskAddressBindingServiceError);
      assert.equal(error.code, 'builder_session_task_address_binding_invalid');
      const text = `${error.name}:${error.message}:${error.stack}`;
      assert.doesNotMatch(
        text,
        /secret-value|credential|provider|source_tree|C:\\|api[_-]?key|Authorization|Bearer|SQLITE|raw prompt/iu,
      );
      return true;
    },
  );
}

test('binds queued follow-up work to the current Session and Task Address by conversation', (t) => {
  const store = createBuilderSessionTaskAddressStore(temporaryDatabase(t));
  store.record_session_address({ session_address: sessionAddress() });
  store.record_task_address({ task_address: taskAddress() });
  const binder = createBuilderSessionTaskAddressBindingService({ address_store: store });
  const bound = binder.bind_queued_followup_work_to_current_task_address({
    context: queuedWorkContext(),
    queued_followup: queuedFollowup(),
  });

  assert.equal(binder.service_version, SERVICE_VERSION);
  assert.equal(bound.result_version, RESULT_VERSION);
  assert.equal(bound.operation, 'queued_followup_work_bound');
  assert.equal(bound.project_id, PROJECT_ID);
  assert.equal(bound.conversation_id, CONVERSATION_ID);
  assert.equal(bound.turn_id, CONSUMING_TURN_ID);
  assert.equal(bound.run_id, CONSUMING_RUN_ID);
  assert.equal(bound.low_level_task_id, CONSUMING_TASK_ID);
  assert.equal(bound.task_address.task_address.task_address_id, TASK_ADDRESS_ID);
  assert.equal(bound.task_address.task_address.conversation_id, CONVERSATION_ID);
  assert.equal(bound.session_address.session_address.session_id, SESSION_ID);
  assert.equal(bound.authority.address_binding, 'main_owned_read_only_session_task_address_lookup');
  assert.equal(bound.authority.conversation_append, false);
  assert.equal(bound.authority.provider_dispatch, false);
  assert.equal(bound.authority.source_mutation, false);
  assert.equal(bound.authority.git_mutation, false);
  assert.equal(bound.authority.permission_grant, false);
  assert.equal(Object.isFrozen(bound.task_address.task_address), true);
  store.close();
});

test('binds approved-plan continuation work to the current Session and Task Address by conversation', (t) => {
  const store = createBuilderSessionTaskAddressStore(temporaryDatabase(t));
  store.record_session_address({ session_address: sessionAddress() });
  store.record_task_address({ task_address: taskAddress() });
  const binder = createBuilderSessionTaskAddressBindingService({ address_store: store });
  const continuation = approvedPlanContinuation();
  const bound = binder.bind_approved_plan_continuation_to_current_task_address({
    context: approvedPlanWorkContext(),
    approved_plan_continuation: continuation,
  });

  assert.equal(bound.result_version, RESULT_VERSION);
  assert.equal(bound.operation, 'approved_plan_continuation_bound');
  assert.equal(bound.project_id, PROJECT_ID);
  assert.equal(bound.conversation_id, CONVERSATION_ID);
  assert.equal(bound.turn_id, CONSUMING_TURN_ID);
  assert.equal(bound.run_id, CONSUMING_RUN_ID);
  assert.equal(bound.low_level_task_id, CONSUMING_TASK_ID);
  assert.deepEqual(bound.approved_plan_continuation, continuation);
  assert.equal(bound.task_address.task_address.task_address_id, TASK_ADDRESS_ID);
  assert.equal(bound.task_address.task_address.conversation_id, CONVERSATION_ID);
  assert.equal(bound.session_address.session_address.session_id, SESSION_ID);
  assert.equal(bound.authority.address_binding, 'main_owned_read_only_session_task_address_lookup');
  assert.equal(bound.authority.conversation_append, false);
  assert.equal(bound.authority.provider_dispatch, false);
  assert.equal(bound.authority.source_mutation, false);
  assert.equal(bound.authority.git_mutation, false);
  assert.equal(bound.authority.permission_grant, false);
  store.close();
});

test('binds draft continuation work to the current Session and Task Address by conversation', (t) => {
  const store = createBuilderSessionTaskAddressStore(temporaryDatabase(t));
  store.record_session_address({ session_address: sessionAddress() });
  store.record_task_address({ task_address: taskAddress() });
  const binder = createBuilderSessionTaskAddressBindingService({ address_store: store });
  const continuation = draftContinuation();
  const bound = binder.bind_draft_continuation_to_current_task_address({
    context: draftContinuationWorkContext(),
    draft_continuation: continuation,
  });

  assert.equal(bound.result_version, RESULT_VERSION);
  assert.equal(bound.operation, 'draft_continuation_bound');
  assert.equal(bound.project_id, PROJECT_ID);
  assert.equal(bound.conversation_id, CONVERSATION_ID);
  assert.equal(bound.turn_id, CONSUMING_TURN_ID);
  assert.equal(bound.run_id, CONSUMING_RUN_ID);
  assert.equal(bound.low_level_task_id, CONSUMING_TASK_ID);
  assert.deepEqual(bound.draft_continuation, continuation);
  assert.equal(bound.task_address.task_address.task_address_id, TASK_ADDRESS_ID);
  assert.equal(bound.task_address.task_address.conversation_id, CONVERSATION_ID);
  assert.equal(bound.session_address.session_address.session_id, SESSION_ID);
  assert.equal(bound.authority.address_binding, 'main_owned_read_only_session_task_address_lookup');
  assert.equal(bound.authority.conversation_append, false);
  assert.equal(bound.authority.provider_dispatch, false);
  assert.equal(bound.authority.source_mutation, false);
  assert.equal(bound.authority.git_mutation, false);
  assert.equal(bound.authority.permission_grant, false);
  store.close();
});

test('fails closed for absent addresses, forged context, malformed input, accessors, and proxies', (t) => {
  const store = createBuilderSessionTaskAddressStore(temporaryDatabase(t));
  const binder = createBuilderSessionTaskAddressBindingService({ address_store: store });

  assertBindingError(() => binder.bind_queued_followup_work_to_current_task_address({
    context: queuedWorkContext(),
    queued_followup: queuedFollowup(),
  }));
  assertBindingError(() => binder.bind_approved_plan_continuation_to_current_task_address({
    context: approvedPlanWorkContext(),
    approved_plan_continuation: approvedPlanContinuation({
      conversation_id: 'builder-conversation:223e4567-e89b-42d3-a456-426614174205',
    }),
  }));
  assertBindingError(() => binder.bind_approved_plan_continuation_to_current_task_address({
    context: approvedPlanWorkContext({
      events: approvedPlanWorkContext().events.slice(0, 1),
    }),
    approved_plan_continuation: approvedPlanContinuation(),
  }));
  assertBindingError(() => binder.bind_draft_continuation_to_current_task_address({
    context: draftContinuationWorkContext(),
    draft_continuation: draftContinuation({ candidate_digest: digest('e') }),
  }));
  assertBindingError(() => binder.bind_draft_continuation_to_current_task_address({
    context: approvedPlanWorkContext(),
    draft_continuation: draftContinuation(),
  }));
  store.record_session_address({ session_address: sessionAddress() });
  store.record_task_address({ task_address: taskAddress() });
  assertBindingError(() => binder.bind_queued_followup_work_to_current_task_address({
    context: queuedWorkContext({
      project: {
        project_id: OTHER_PROJECT_ID,
        created_at_ms: 1000,
      },
    }),
    queued_followup: queuedFollowup(),
  }));
  assertBindingError(() => binder.bind_queued_followup_work_to_current_task_address({
    context: queuedWorkContext(),
    queued_followup: {
      ...queuedFollowup(),
      run_id: 'builder-run:223e4567-e89b-42d3-a456-426614174207',
    },
  }));
  assertBindingError(() => binder.bind_queued_followup_work_to_current_task_address({
    context: queuedWorkContext(),
    queued_followup: queuedFollowup(),
    extra: true,
  }));

  let getterCalls = 0;
  const accessor = {};
  Object.defineProperty(accessor, 'context', {
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new Error('private marker');
    },
  });
  Object.defineProperty(accessor, 'queued_followup', {
    enumerable: true,
    value: queuedFollowup(),
  });
  assertBindingError(() => binder.bind_queued_followup_work_to_current_task_address(accessor));
  assert.equal(getterCalls, 0);

  let proxyTrapInvoked = false;
  const proxyTrap = () => {
    proxyTrapInvoked = true;
    throw new Error('private proxy marker');
  };
  assertBindingError(() => createBuilderSessionTaskAddressBindingService(new Proxy(
    { address_store: store },
    {
      getOwnPropertyDescriptor: proxyTrap,
      getPrototypeOf: proxyTrap,
      ownKeys: proxyTrap,
    },
  )));
  assert.equal(proxyTrapInvoked, false);
  store.close();
});

test('source boundary remains a read-only main binding service without runtime authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-session-task-address-binding-service.cjs'),
    'utf8',
  );
  assert.match(source, /main_owned_read_only_session_task_address_lookup/u);
  assert.match(source, /bind_queued_followup_work_to_current_task_address/u);
  assert.match(source, /bind_approved_plan_continuation_to_current_task_address/u);
  assert.match(source, /bind_draft_continuation_to_current_task_address/u);
  assert.match(source, /read_current_session_task_for_conversation/u);
  assert.match(source, /conversation_append: false/u);
  assert.match(source, /provider_dispatch: false/u);
  assert.match(source, /source_mutation: false/u);
  assert.match(source, /git_mutation: false/u);
  assert.doesNotMatch(
    source,
    /require\(['"](?:electron|node:sqlite|node:http|node:https|http|https|node:fs|fs)['"]\)|ipcMain|ipcRenderer|contextBridge|BrowserWindow|safeStorage|builder-provider|builder-git|dugite|fetch\s*\(|https?:|Authorization|Bearer|child_process|execFile|spawn\s*\(|writeFile|rmSync|shell:\s*true|localStorage|sessionStorage|indexedDB|eval\s*\(|new Function|provider_secret|credential_secret|source_tree|commit_oid|tree_oid|stdout|stderr/iu,
  );
});
