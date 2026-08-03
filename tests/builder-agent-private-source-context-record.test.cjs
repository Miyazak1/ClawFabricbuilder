'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  BUILDER_AGENT_DEFINITION_RECORD_VERSION,
  BUILDER_AGENT_VERSION_RECORD_VERSION,
  createBuilderAgentDefinitionRecord,
  createBuilderAgentVersionRecord,
} = require('../electron/builder-agent-definition-contract.cjs');
const {
  BUILDER_AGENT_ASSIGNMENT_RECORD_VERSION,
  BUILDER_AGENT_ASSIGNMENT_STATUS_RECORD_VERSION,
  createBuilderAgentAssignmentRecord,
  createBuilderAgentAssignmentStatusRecord,
} = require('../electron/builder-agent-assignment-contract.cjs');
const {
  BUILDER_AGENT_SUPERVISION_LEASE_RECORD_VERSION,
  createBuilderAgentSupervisionLeaseRecord,
} = require('../electron/builder-agent-supervision-lease-contract.cjs');
const {
  BUILDER_AGENT_BUDGET_AUDIT_RECORD_KIND,
  BUILDER_AGENT_BUDGET_AUDIT_RECORD_VERSION,
  createBuilderAgentBudgetAuditRecord,
} = require('../electron/builder-agent-budget-audit-contract.cjs');
const {
  createBuilderAgentTaskContextSnapshot,
} = require('../electron/builder-agent-task-context-snapshot.cjs');
const {
  createBuilderAgentSupervisedActionAdmission,
} = require('../electron/builder-agent-supervised-action-admission.cjs');
const {
  BUILDER_AGENT_PRIVATE_SOURCE_CONTEXT_RECORD_KIND,
  BUILDER_AGENT_PRIVATE_SOURCE_CONTEXT_RECORD_VERSION,
  BuilderAgentPrivateSourceContextRecordError,
  createBuilderAgentPrivateSourceContextRecord,
  sanitizeBuilderAgentPrivateSourceContextRecord,
} = require('../electron/builder-agent-private-source-context-record.cjs');
const {
  createBuilderProjectSourceTree,
} = require('../electron/builder-project-source-tree.cjs');

const OWNER_ID = 'builder-user:11111111-1111-4111-8111-111111111111';
const AGENT_ID = 'builder-agent:22222222-2222-4222-8222-222222222222';
const PROJECT_UUID = '33333333-3333-4333-8333-333333333333';
const PROJECT_ID = `builder-project:${PROJECT_UUID}`;
const CONVERSATION_ID = `builder-conversation:${PROJECT_UUID}`;
const TASK_ID = 'builder-task:55555555-5555-4555-8555-555555555555';
const RUN_ID = 'builder-run:66666666-6666-4666-8666-666666666666';
const SUPERVISOR_ID = 'builder-supervisor:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const MESSAGE_ID = 'builder-message:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const MEMORY_ID = `builder-agent-memory:${'a'.repeat(64)}`;
const ARTIFACT_ID = `builder-artifact:${'b'.repeat(64)}`;
const RUN_EVENT_ID = `builder-run-event:${'c'.repeat(64)}`;
const PERMISSION_REF_ID = `builder-permission:${'d'.repeat(64)}`;
const REQUEST_DIGEST = `sha256:${'1'.repeat(64)}`;
const SOURCE_CONTEXT_AUTHORITY = Object.freeze({
  collector_authority: 'main_tool_source_context_collector_v1',
  permission_authority: 'main_permission_decision_before_tool_dispatch_v1',
  policy_authority: 'main_tool_session_policy_contract_v1',
  conversation_authority: 'trusted_conversation_main_service_methods',
  execution_authority: 'main_tool_filesystem_read_execution_service_v1',
  renderer_authority: 'not_present',
  provider_dispatch: false,
  credential_readback: false,
  raw_output_storage: 'not_durable',
  conversation_event: 'tool_request_and_fixed_result_only',
  git_authority: 'not_present',
  revision_admission: 'not_created',
});

function id(kind, index) {
  return `builder-${kind}:123e4567-e89b-42d3-a456-${index.toString(16).padStart(12, '0')}`;
}

function actionRequestId(index = 1) {
  return `builder-agent-action-request:123e4567-e89b-42d3-a456-${index.toString(16).padStart(12, '0')}`;
}

function commandIds(overrides = {}) {
  return {
    turn_command_id: id('command', 1),
    run_command_id: id('command', 2),
    terminal_command_id: id('command', 3),
    turn_terminal_command_id: id('command', 4),
    cancel_command_id: id('command', 5),
    cancel_request_id: id('cancel-request', 6),
    interrupt_command_id: id('command', 7),
    interrupt_request_id: id('interrupt-request', 8),
    message_id: id('message', 9),
    assistant_message_id: id('message', 10),
    turn_id: id('turn', 11),
    task_id: TASK_ID,
    run_id: RUN_ID,
    ...overrides,
  };
}

function admissionFixture(action = 'read_private_source', index = 1) {
  const definition = createBuilderAgentDefinitionRecord({
    record_version: BUILDER_AGENT_DEFINITION_RECORD_VERSION,
    agent_id: AGENT_ID,
    owner_id: OWNER_ID,
    display_name: 'Builder Agent',
    purpose: 'Summarize private source context without storing raw source.',
    created_at_ms: 1,
  });
  const version = createBuilderAgentVersionRecord({
    record_version: BUILDER_AGENT_VERSION_RECORD_VERSION,
    agent_id: AGENT_ID,
    owner_id: OWNER_ID,
    version_number: 1,
    instructions: 'Use private project source only through digest-only records.',
    created_at_ms: 2,
    permission_boundary: 'explicit_permission_required',
  }, definition);
  const assignment = createBuilderAgentAssignmentRecord({
    record_version: BUILDER_AGENT_ASSIGNMENT_RECORD_VERSION,
    agent_id: AGENT_ID,
    agent_version_id: version.agent_version_id,
    owner_id: OWNER_ID,
    assigned_by: OWNER_ID,
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    task_id: TASK_ID,
    run_id: RUN_ID,
    goal: 'Read private source and keep only a receipt.',
    created_at_ms: 3,
    permission_boundary: 'explicit_permission_required',
    supervision_policy: 'owner_supervised',
    result_contract: 'review_required_before_materialization',
    budget: {
      max_steps: 12,
      max_tool_calls: 4,
      max_runtime_ms: 120_000,
      max_private_source_bytes: 32_768,
    },
  }, version, definition);
  const activeStatus = createBuilderAgentAssignmentStatusRecord({
    record_version: BUILDER_AGENT_ASSIGNMENT_STATUS_RECORD_VERSION,
    assignment_id: assignment.assignment_id,
    agent_id: AGENT_ID,
    owner_id: OWNER_ID,
    decided_by: OWNER_ID,
    next_status: 'active',
    reason: 'Owner started supervised work.',
    decided_at_ms: 4,
  }, assignment);
  const lease = createBuilderAgentSupervisionLeaseRecord({
    record_version: BUILDER_AGENT_SUPERVISION_LEASE_RECORD_VERSION,
    assignment_id: assignment.assignment_id,
    assignment_status_id: activeStatus.assignment_status_id,
    agent_id: AGENT_ID,
    owner_id: OWNER_ID,
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    task_id: TASK_ID,
    run_id: RUN_ID,
    lease_holder_id: SUPERVISOR_ID,
    lease_epoch: 1,
    acquired_at_ms: 20,
    expires_at_ms: 620,
    purpose: 'Supervise one private source context record.',
    redispatch_policy: 'lease_required_no_duplicate_dispatch',
    supervision_state: 'active_assignment_only',
    authority_boundary: 'main_supervision_lease_only',
  }, assignment, activeStatus);
  const budgetAudit = createBuilderAgentBudgetAuditRecord({
    record_version: BUILDER_AGENT_BUDGET_AUDIT_RECORD_VERSION,
    record_kind: BUILDER_AGENT_BUDGET_AUDIT_RECORD_KIND,
    assignment_id: assignment.assignment_id,
    assignment_status_id: activeStatus.assignment_status_id,
    lease_id: lease.lease_id,
    agent_id: AGENT_ID,
    agent_version_id: assignment.agent_version_id,
    owner_id: OWNER_ID,
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    task_id: TASK_ID,
    run_id: RUN_ID,
    lease_holder_id: SUPERVISOR_ID,
    observed_at_ms: 30 + index,
    requested_next_action: action,
    budget_limits: assignment.budget,
    budget_usage: {
      step_count: index,
      tool_call_count: 0,
      runtime_ms: 100 + index,
      private_source_bytes: 0,
    },
    outcome: {
      decision: 'allowed',
      reason: 'none',
    },
    audit_contract: 'assignment_budget_checked_before_agent_work',
  }, assignment, activeStatus, lease);
  const snapshot = createBuilderAgentTaskContextSnapshot({
    agent_definition: definition,
    agent_version: version,
    assignment,
    active_status: activeStatus,
    lease,
    budget_audit: budgetAudit,
    included_memory_ids: [MEMORY_ID],
    included_message_ids: [MESSAGE_ID],
    included_artifact_ids: [ARTIFACT_ID],
    included_run_event_ids: [RUN_EVENT_ID],
    included_permission_ids: [PERMISSION_REF_ID],
    parent_task_context_projection: null,
    base_project_revision: {
      status: 'available',
      revision_receipt_digest: `sha256:${'f'.repeat(64)}`,
      commit_oid: '1'.repeat(40),
    },
    token_budget: {
      max_input_tokens: 32_000,
      reserved_output_tokens: 4_096,
      selection_policy: 'deterministic_task_local_budget_v1',
    },
    created_at_ms: 40 + index,
  });
  return createBuilderAgentSupervisedActionAdmission({
    context_snapshot: snapshot,
    action_request_id: actionRequestId(index),
    requested_next_action: action,
    run_status: 'running',
    interrupt_requested: false,
    cancel_requested: false,
    admitted_at_ms: snapshot.created_at_ms + 2,
  });
}

function context(overrides = {}) {
  return {
    context_version: 'builder-conversation-run-context.v1',
    mode: 'work',
    project: {
      project_id: PROJECT_ID,
      created_at_ms: 10,
    },
    conversation: {
      project_id: PROJECT_ID,
      conversation_id: CONVERSATION_ID,
      created_at_ms: 11,
    },
    request_digest: REQUEST_DIGEST,
    start_head: {
      sequence: 6,
      event_id: `builder-conversation-event:${'a'.repeat(64)}`,
      event_digest: `sha256:${'b'.repeat(64)}`,
    },
    attempt_number: 1,
    events: [],
    run_terminal_failure_code: null,
    ids: commandIds(),
    cancel_requested: false,
    ...overrides,
  };
}

function privateFiles(rawFiles) {
  const sourceTree = createBuilderProjectSourceTree({
    files: rawFiles.map((file) => ({ path: file.path, content: file.content })),
  });
  return sourceTree.files.map((file) => ({
    path: file.path,
    entry_kind: file.entry_kind,
    content: file.content,
    content_digest: file.content_digest,
    content_bytes: Buffer.byteLength(file.content, 'utf8'),
  }));
}

function sourceContextResult(rawFiles = [
  { path: 'src/app.tsx', content: 'export const answer = 42;\n' },
  { path: 'src/view.tsx', content: 'export const label = "ready";\n' },
], overrides = {}) {
  const files = privateFiles(rawFiles);
  return {
    result_version: 'builder-tool-source-context-result.v1',
    operation: 'project_source_context_collected',
    status: 'succeeded',
    context: context(overrides.context),
    private_source_context: {
      context_version: 'builder-private-source-context.v1',
      files,
      ...(overrides.private_source_context ?? {}),
    },
    reads: files.map((file, index) => ({
      resource_id: `project:/${file.path}`,
      status: 'succeeded',
      tool_call_id: id('tool-call', index + 20),
    })),
    authority: {
      ...SOURCE_CONTEXT_AUTHORITY,
      ...(overrides.authority ?? {}),
    },
    ...overrides.result,
  };
}

function recordInput(overrides = {}) {
  return {
    supervised_action_admission: admissionFixture(
      overrides.admission_action ?? 'read_private_source',
      overrides.admission_index ?? 1,
    ),
    source_context_result: sourceContextResult(undefined, overrides.source_context_result ?? {}),
    ...overrides.input,
  };
}

function assertRecordError(fn) {
  assert.throws(
    fn,
    (error) => {
      assert.ok(error instanceof BuilderAgentPrivateSourceContextRecordError);
      assert.equal(error.code, 'builder_agent_private_source_context_record_invalid');
      assert.equal(error.message, 'Builder agent private source context record could not be verified.');
      assert.equal(error.retryable, false);
      assert.doesNotMatch(
        `${error.name}\n${error.message}\n${error.stack}`,
        /src\/app|src\/view|export const|ready|secret-value|api\.deepseek|Authorization|Bearer|credential|raw prompt|file content|patch body/iu,
      );
      return true;
    },
  );
}

test('creates a digest-only private source context record bound to supervised admission', () => {
  const record = createBuilderAgentPrivateSourceContextRecord(recordInput());

  assert.equal(record.record_version, BUILDER_AGENT_PRIVATE_SOURCE_CONTEXT_RECORD_VERSION);
  assert.equal(record.record_kind, BUILDER_AGENT_PRIVATE_SOURCE_CONTEXT_RECORD_KIND);
  assert.equal(record.owner_id, OWNER_ID);
  assert.equal(record.agent_id, AGENT_ID);
  assert.equal(record.project_id, PROJECT_ID);
  assert.equal(record.conversation_id, CONVERSATION_ID);
  assert.equal(record.task_id, TASK_ID);
  assert.equal(record.run_id, RUN_ID);
  assert.equal(record.source_context_status, 'succeeded');
  assert.equal(record.resource_count, 2);
  assert.equal(record.file_count, 2);
  assert.equal(record.total_content_bytes, 56);
  assert.equal(record.context_binding.source_context_result_version, 'builder-tool-source-context-result.v1');
  assert.equal(record.context_binding.source_context_operation, 'project_source_context_collected');
  assert.equal(record.context_binding.collector_authority, 'main_tool_source_context_collector_v1');
  assert.equal(record.context_binding.head_sequence, 6);
  assert.match(record.context_binding.context_digest, /^sha256:[0-9a-f]{64}$/u);
  assert.match(record.context_binding.head_digest, /^sha256:[0-9a-f]{64}$/u);
  assert.deepEqual(record.read_summaries.map((read) => read.status), ['succeeded', 'succeeded']);
  assert.deepEqual(record.file_summaries.map((file) => file.entry_kind), ['text_file', 'text_file']);
  assert.deepEqual(record.lifecycle, {
    supervised_action_admission: 'verified_read_private_source_admission',
    source_context_collection: 'collector_result_summarized',
    raw_source_storage: 'not_persisted',
    provider_dispatch: 'not_started',
    tool_dispatch: 'collector_internal_request_result_facts_only',
    source_mutation: 'not_performed',
    result_for_review_admission: 'not_created',
    revision_admission: 'not_created',
  });
  assert.deepEqual(record.authority, {
    record_authority: 'main_agent_private_source_context_record_contract_v1',
    supervised_action_admission_authority: 'main_agent_supervised_action_admission_contract_v1',
    source_context_authority: 'main_tool_source_context_collector_v1',
    conversation_binding: 'ids_only_host_replay_required',
    renderer_authority: 'not_present',
    ipc_authority: 'not_present',
    provider_dispatch: false,
    model_dispatch: false,
    tool_dispatch: 'collector_internal_request_result_facts_only',
    execution_authority: 'collector_internal_filesystem_read_only',
    permission_grant_authority: false,
    credential_storage: 'not_present',
    source_access: 'digest_only_private_source_context_receipt',
    source_read: 'bounded_project_files_already_collected',
    source_write: 'not_present',
    raw_source_storage: 'not_present',
    process_run: false,
    network_access: false,
    revision_authority: false,
    review_authority: false,
    artifact_authority: false,
  });
  assert.match(record.record_digest, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(Object.isFrozen(record), true);
  assert.equal(Object.isFrozen(record.context_binding), true);
  assert.equal(Object.isFrozen(record.file_summaries[0]), true);

  for (const read of record.read_summaries) {
    assert.equal(Object.hasOwn(read, 'resource_id'), false);
    assert.match(read.resource_id_digest, /^sha256:[0-9a-f]{64}$/u);
  }
  for (const file of record.file_summaries) {
    assert.equal(Object.hasOwn(file, 'path'), false);
    assert.equal(Object.hasOwn(file, 'content'), false);
    assert.match(file.content_digest, /^sha256:[0-9a-f]{64}$/u);
  }
  const serialized = JSON.stringify(record);
  assert.doesNotMatch(
    serialized,
    /src\/app|src\/view|export const answer|export const label|"resource_id"|"content":|"private_source_context"|"source_tree_digest"|provider_config|provider_secret|credential_secret|credential_value|secret_ref|commit_oid|tree_oid/iu,
  );

  const sanitized = sanitizeBuilderAgentPrivateSourceContextRecord(structuredClone(record));
  assert.deepEqual(sanitized, record);
  assert.notEqual(sanitized, record);

  const changedContent = createBuilderAgentPrivateSourceContextRecord(recordInput({
    source_context_result: {
      private_source_context: {
        files: privateFiles([
          { path: 'src/app.tsx', content: 'export const answer = 43;\n' },
          { path: 'src/view.tsx', content: 'export const label = "ready";\n' },
        ]),
      },
    },
  }));
  assert.notEqual(changedContent.context_binding.context_digest, record.context_binding.context_digest);
  const changedRequest = createBuilderAgentPrivateSourceContextRecord(recordInput({
    source_context_result: {
      context: { request_digest: `sha256:${'2'.repeat(64)}` },
    },
  }));
  assert.notEqual(changedRequest.context_binding.context_digest, record.context_binding.context_digest);
  const changedHead = createBuilderAgentPrivateSourceContextRecord(recordInput({
    source_context_result: {
      context: {
        start_head: {
          sequence: 7,
          event_id: `builder-conversation-event:${'c'.repeat(64)}`,
          event_digest: `sha256:${'d'.repeat(64)}`,
        },
      },
    },
  }));
  assert.notEqual(changedHead.context_binding.head_digest, record.context_binding.head_digest);
});

test('records partial and failed source context summaries without raw source content', () => {
  const partialFile = privateFiles([{ path: 'src/app.tsx', content: 'export const answer = 42;\n' }]);
  const partial = createBuilderAgentPrivateSourceContextRecord(recordInput({
    source_context_result: {
      result: {
        status: 'partial',
        reads: [
          { resource_id: 'project:/src/app.tsx', status: 'succeeded', tool_call_id: id('tool-call', 20) },
          { resource_id: 'project:/src/missing.ts', status: 'failed', tool_call_id: id('tool-call', 21) },
        ],
      },
      private_source_context: { files: partialFile },
    },
  }));
  assert.equal(partial.source_context_status, 'partial');
  assert.equal(partial.resource_count, 2);
  assert.equal(partial.file_count, 1);
  assert.equal(partial.total_content_bytes, 26);
  assert.deepEqual(partial.read_summaries.map((read) => read.status), ['succeeded', 'failed']);
  assert.doesNotMatch(JSON.stringify(partial), /src\/app|missing\.ts|export const answer|"private_source_context"/iu);

  const failed = createBuilderAgentPrivateSourceContextRecord(recordInput({
    source_context_result: {
      result: {
        status: 'failed',
        reads: [
          { resource_id: 'project:/src/missing.ts', status: 'failed', tool_call_id: id('tool-call', 20) },
        ],
      },
      private_source_context: { files: [] },
    },
  }));
  assert.equal(failed.source_context_status, 'failed');
  assert.equal(failed.resource_count, 1);
  assert.equal(failed.file_count, 0);
  assert.equal(failed.total_content_bytes, 0);
  assert.deepEqual(failed.file_summaries, []);
  assert.doesNotMatch(JSON.stringify(failed), /missing\.ts|"private_source_context"/iu);
});

test('rejects admission drift, source context drift, forged reads, and hostile shapes', () => {
  const valid = recordInput();
  const driftedFile = {
    ...valid.source_context_result.private_source_context.files[0],
    content: 'export const answer = 9000;\n',
  };
  let getterCalls = 0;
  const accessorInput = {
    supervised_action_admission: valid.supervised_action_admission,
  };
  Object.defineProperty(accessorInput, 'source_context_result', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return valid.source_context_result;
    },
  });

  for (const invalid of [
    null,
    { ...valid, extra: true },
    new Proxy(valid, {}),
    accessorInput,
    recordInput({ admission_action: 'call_tool' }),
    {
      ...valid,
      source_context_result: sourceContextResult(undefined, {
        context: { ids: commandIds({ task_id: id('task', 88) }) },
      }),
    },
    {
      ...valid,
      source_context_result: sourceContextResult(undefined, {
        authority: { provider_dispatch: true },
      }),
    },
    {
      ...valid,
      source_context_result: sourceContextResult(undefined, {
        authority: { renderer_authority: 'renderer_claimed' },
      }),
    },
    {
      ...valid,
      source_context_result: sourceContextResult(undefined, {
        private_source_context: {
          files: [
            driftedFile,
            valid.source_context_result.private_source_context.files[1],
          ],
        },
      }),
    },
    {
      ...valid,
      source_context_result: sourceContextResult(undefined, {
        result: {
          reads: [
            { resource_id: 'project:/src/app.tsx', status: 'succeeded', tool_call_id: id('tool-call', 20) },
            { resource_id: 'project:/src/app.tsx', status: 'succeeded', tool_call_id: id('tool-call', 21) },
          ],
        },
      }),
    },
    {
      ...valid,
      source_context_result: sourceContextResult(undefined, {
        result: {
          reads: [
            { resource_id: 'project:/src/app.tsx', status: 'succeeded', tool_call_id: id('tool-call', 20) },
            { resource_id: 'project:/src/view.tsx', status: 'succeeded', tool_call_id: id('tool-call', 20) },
          ],
        },
      }),
    },
    {
      ...valid,
      source_context_result: sourceContextResult(undefined, {
        result: {
          reads: [
            { resource_id: 'project:/src/app.tsx', status: 'failed', tool_call_id: id('tool-call', 20) },
            { resource_id: 'project:/src/view.tsx', status: 'succeeded', tool_call_id: id('tool-call', 21) },
          ],
        },
      }),
    },
    {
      ...valid,
      source_context_result: sourceContextResult(undefined, {
        context: {
          events: Array.from({ length: 65 }, (_, index) => ({
            event_id: `builder-conversation-event:${index.toString(16).padStart(64, '0')}`,
          })),
        },
      }),
    },
  ]) {
    assertRecordError(() => createBuilderAgentPrivateSourceContextRecord(invalid));
  }
  assert.equal(getterCalls, 0);
});

test('sanitizer rejects lifecycle, authority, count, binding, and digest drift', () => {
  const record = createBuilderAgentPrivateSourceContextRecord(recordInput());

  for (const invalid of [
    { ...record, record_digest: `sha256:${'0'.repeat(64)}` },
    { ...record, resource_count: 3 },
    { ...record, file_count: 3 },
    { ...record, total_content_bytes: 1 },
    {
      ...record,
      context_binding: {
        ...record.context_binding,
        source_context_operation: 'other_operation',
      },
    },
    {
      ...record,
      lifecycle: {
        ...record.lifecycle,
        raw_source_storage: 'persisted',
      },
    },
    {
      ...record,
      authority: {
        ...record.authority,
        raw_source_storage: 'present',
      },
    },
    {
      ...record,
      authority: {
        ...record.authority,
        provider_dispatch: true,
      },
    },
    {
      ...record,
      read_summaries: [
        {
          ...record.read_summaries[0],
          resource_id_digest: record.read_summaries[1].resource_id_digest,
        },
        record.read_summaries[1],
      ],
    },
    {
      ...record,
      file_summaries: [
        {
          ...record.file_summaries[0],
          content_bytes: 999,
        },
        record.file_summaries[1],
      ],
    },
  ]) {
    assertRecordError(() => sanitizeBuilderAgentPrivateSourceContextRecord(invalid));
  }
  assert.equal(Object.hasOwn(record, 'source_context_result'), false);
  assert.equal(Object.hasOwn(record, 'private_source_context'), false);
});

test('source remains a main-only digest receipt contract without runtime or raw-source authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-agent-private-source-context-record.cjs'),
    'utf8',
  );

  assert.match(source, /builder-agent-private-source-context-record\.v1/u);
  assert.match(source, /main_agent_private_source_context_record_contract_v1/u);
  assert.match(source, /digest_only_private_source_context_receipt/u);
  assert.match(source, /collector_result_summarized/u);
  assert.match(source, /verified_read_private_source_admission/u);
  assert.match(source, /createBuilderProjectSourceTree/u);
  assert.match(source, /raw_source_storage: 'not_present'/u);
  assert.match(source, /source_write: 'not_present'/u);
  assert.match(source, /provider_dispatch: false/u);
  assert.match(source, /tool_dispatch: 'collector_internal_request_result_facts_only'/u);
  assert.doesNotMatch(
    source,
    /require\(['"](?:electron|node:fs|node:fs\/promises|fs|fs\/promises|node:path|path|node:process|process)['"]\)|\bprocess\.|ipcMain|ipcRenderer|contextBridge|BrowserWindow|safeStorage|builder-provider|builder-git|builder-conversation-main-service|builder-project-main-authority|fetch\s*\(|node:http|node:https|child_process|execFile|spawn\s*\(|readFile|createReadStream|writeFile|appendFile|unlink|rm\(|mkdir|eval\s*\(|new Function|shell:\s*true|persist_candidate_commit|write_current|commit_oid|tree_oid|provider_secret|credential_secret|credential_value|secret_ref|local-provider-executor|chat_planner|ChatCreatePage|Canvas|JobMeta/iu,
  );
});
