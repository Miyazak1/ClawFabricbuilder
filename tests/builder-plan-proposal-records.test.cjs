'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  createBuilderProjectSourceTree,
} = require('../electron/builder-project-source-tree.cjs');
const {
  BUILDER_PLAN_PROPOSAL_RECORD_VERSION,
  PLAN_PROPOSAL_RECORD_KIND,
  BuilderPlanProposalRecordError,
  createBuilderPlanProposalRecord,
  sanitizeBuilderPlanProposalRecord,
} = require('../electron/builder-plan-proposal-records.cjs');

const PROJECT_UUID = '123e4567-e89b-42d3-a456-426614174000';
const PROJECT_ID = `builder-project:${PROJECT_UUID}`;
const CONVERSATION_ID = `builder-conversation:${PROJECT_UUID}`;
const REQUEST_DIGEST = `sha256:${'1'.repeat(64)}`;

function id(kind, index) {
  return `builder-${kind}:123e4567-e89b-42d3-a456-${index.toString(16).padStart(12, '0')}`;
}

function commandIds() {
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
    task_id: id('task', 12),
    run_id: id('run', 13),
  };
}

function sourceContextAuthority(overrides = {}) {
  return {
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
    ...overrides,
  };
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
    authority: sourceContextAuthority(overrides.authority),
    ...overrides.result,
  };
}

function planSteps(overrides = {}) {
  return [
    {
      plan_step_id: id('plan-step', 30),
      title: 'Review current structure',
      purpose: 'Use the collected context to identify the smallest useful change.',
      expected_change: 'A bounded implementation path is selected before editing begins.',
      status: 'proposed',
      ...(overrides.first ?? {}),
    },
    {
      plan_step_id: id('plan-step', 31),
      title: 'Prepare implementation',
      purpose: 'Separate inspection from the later edit and verification phases.',
      expected_change: 'The follow-up edit can be reviewed independently.',
      status: 'proposed',
      ...(overrides.second ?? {}),
    },
  ];
}

function planInput(overrides = {}) {
  return {
    source_context_result: sourceContextResult(),
    proposed_at_ms: 100,
    title: 'Propose a bounded update',
    summary: 'Use the inspected project context to prepare a small reviewed change.',
    steps: planSteps(),
    ...overrides,
  };
}

function assertPlanError(error) {
  assert.equal(error instanceof BuilderPlanProposalRecordError, true);
  assert.equal(error.code, 'builder_plan_proposal_record_invalid');
  assert.equal(error.message, 'The plan proposal record could not be verified.');
  assert.equal(error.retryable, false);
  assert.doesNotMatch(`${error.message}\n${error.stack}`, /src\/app|export const|Authorization|Bearer/iu);
  return true;
}

test('creates a proposed plan record bound to private source context without content or path leakage', () => {
  const record = createBuilderPlanProposalRecord(planInput());

  assert.equal(record.record_version, BUILDER_PLAN_PROPOSAL_RECORD_VERSION);
  assert.equal(record.record_kind, PLAN_PROPOSAL_RECORD_KIND);
  assert.equal(record.project_id, PROJECT_ID);
  assert.equal(record.conversation_id, CONVERSATION_ID);
  assert.equal(record.result_kind, 'plan');
  assert.equal(record.plan_state, 'proposed');
  assert.equal(record.context_binding.source_context_result_version, 'builder-tool-source-context-result.v1');
  assert.equal(record.context_binding.collector_authority, 'main_tool_source_context_collector_v1');
  assert.equal(record.context_binding.context_status, 'succeeded');
  assert.equal(record.context_binding.file_count, 2);
  assert.equal(record.context_binding.total_content_bytes, 56);
  assert.equal(record.context_binding.head_sequence, 6);
  assert.match(record.context_binding.context_digest, /^sha256:[0-9a-f]{64}$/u);
  assert.match(record.context_binding.head_digest, /^sha256:[0-9a-f]{64}$/u);
  assert.deepEqual(record.lifecycle, {
    source_context_admission: 'bounded_private_source_context_digest_only',
    plan_admission: 'proposed_not_approved',
    approval_admission: 'not_approved',
    tool_dispatch: 'not_performed',
    provider_dispatch: 'not_performed_by_record_contract',
    source_mutation: 'not_performed',
    verification_admission: 'not_started',
    revision_admission: 'not_created',
  });
  assert.deepEqual(record.authority, {
    record_authority: 'main_plan_proposal_record_contract_v1',
    source_context_authority: 'main_tool_source_context_collector_v1',
    conversation_binding: 'ids_only_host_replay_required',
    renderer_authority: 'not_present',
    provider_dispatch: false,
    credential_readback: false,
    tool_dispatch: 'not_performed',
    source_mutation: 'not_performed',
    raw_source_storage: 'not_present',
    conversation_event: 'not_admitted_by_record_contract',
    git_authority: 'not_present',
    revision_admission: 'not_created',
  });
  assert.match(record.record_digest, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(Object.isFrozen(record), true);
  assert.equal(Object.isFrozen(record.context_binding), true);
  assert.equal(Object.isFrozen(record.steps[0]), true);

  const serialized = JSON.stringify(record);
  assert.doesNotMatch(
    serialized,
    /src\/app|src\/view|export const answer|export const label|"content_digest"|"source_tree_digest"|"private_source_context"|"tool_call_id"|provider_config|provider_secret|credential_secret|credential_value|secret_ref|commit_oid|tree_oid/iu,
  );

  const changed = createBuilderPlanProposalRecord({
    ...planInput(),
    source_context_result: sourceContextResult([
      { path: 'src/app.tsx', content: 'export const answer = 43;\n' },
      { path: 'src/view.tsx', content: 'export const label = "ready";\n' },
    ]),
  });
  assert.notEqual(changed.context_binding.context_digest, record.context_binding.context_digest);
  const changedRequest = createBuilderPlanProposalRecord({
    ...planInput(),
    source_context_result: sourceContextResult(undefined, {
      context: { request_digest: `sha256:${'2'.repeat(64)}` },
    }),
  });
  assert.notEqual(changedRequest.context_binding.context_digest, record.context_binding.context_digest);
  const changedHead = createBuilderPlanProposalRecord({
    ...planInput(),
    source_context_result: sourceContextResult(undefined, {
      context: {
        start_head: {
          sequence: 6,
          event_id: `builder-conversation-event:${'c'.repeat(64)}`,
          event_digest: `sha256:${'d'.repeat(64)}`,
        },
      },
    }),
  });
  assert.notEqual(changedHead.context_binding.context_digest, record.context_binding.context_digest);
  assert.notEqual(changedHead.context_binding.head_digest, record.context_binding.head_digest);

  const sanitized = sanitizeBuilderPlanProposalRecord(structuredClone(record));
  assert.deepEqual(sanitized, record);
  assert.notEqual(sanitized, record);
});

test('rejects forged source context drift, hostile shapes, duplicate steps, and unsafe plan text', () => {
  const valid = planInput();
  const driftedFile = {
    ...valid.source_context_result.private_source_context.files[0],
    content: 'export const answer = 9000;\n',
  };
  let getterCalls = 0;
  const accessorInput = {
    source_context_result: valid.source_context_result,
    proposed_at_ms: 100,
    title: 'Propose a bounded update',
    summary: 'Use the inspected project context to prepare a small reviewed change.',
  };
  Object.defineProperty(accessorInput, 'steps', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return planSteps();
    },
  });

  for (const invalid of [
    null,
    { ...valid, extra: true },
    new Proxy(valid, {}),
    accessorInput,
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
            {
              resource_id: 'project:/src/other.tsx',
              status: 'succeeded',
              tool_call_id: id('tool-call', 20),
            },
            {
              resource_id: 'project:/src/view.tsx',
              status: 'succeeded',
              tool_call_id: id('tool-call', 21),
            },
          ],
        },
      }),
    },
    {
      ...valid,
      source_context_result: sourceContextResult(undefined, {
        context: {
          conversation: {
            project_id: `builder-project:${'223e4567-e89b-42d3-a456-426614174000'}`,
            conversation_id: CONVERSATION_ID,
            created_at_ms: 11,
          },
        },
      }),
    },
    {
      ...valid,
      steps: planSteps({ second: { plan_step_id: id('plan-step', 30) } }),
    },
    {
      ...valid,
      summary: 'Read src/app.tsx and then continue.',
    },
    {
      ...valid,
      steps: planSteps({ first: { purpose: 'Use api_key = "abcdefghijklmnopqrstuvwx".' } }),
    },
  ]) {
    assert.throws(
      () => createBuilderPlanProposalRecord(invalid),
      assertPlanError,
    );
  }
  assert.equal(getterCalls, 0);
});

test('rejects partial source contexts and authority drift before a plan can be proposed', () => {
  const valid = planInput();
  for (const invalid of [
    {
      ...valid,
      source_context_result: sourceContextResult(undefined, {
        result: { status: 'partial' },
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
        private_source_context: { files: [] },
      }),
    },
    {
      ...valid,
      source_context_result: sourceContextResult(undefined, {
        result: {
          reads: [
            {
              resource_id: 'project:/src/app.tsx',
              status: 'failed',
              tool_call_id: id('tool-call', 20),
            },
            {
              resource_id: 'project:/src/view.tsx',
              status: 'succeeded',
              tool_call_id: id('tool-call', 21),
            },
          ],
        },
      }),
    },
  ]) {
    assert.throws(
      () => createBuilderPlanProposalRecord(invalid),
      assertPlanError,
    );
  }
});

test('sanitizer rejects record drift and keeps the proposal non-authoritative', () => {
  const record = createBuilderPlanProposalRecord(planInput());

  assert.throws(
    () => sanitizeBuilderPlanProposalRecord({
      ...record,
      plan_state: 'approved',
    }),
    assertPlanError,
  );
  assert.throws(
    () => sanitizeBuilderPlanProposalRecord({
      ...record,
      context_binding: {
        ...record.context_binding,
        head_digest: `sha256:${'1'.repeat(64)}`,
      },
    }),
    assertPlanError,
  );
  assert.throws(
    () => sanitizeBuilderPlanProposalRecord({
      ...record,
      context_binding: {
        ...record.context_binding,
        context_digest: `sha256:${'0'.repeat(64)}`,
      },
    }),
    assertPlanError,
  );
  assert.throws(
    () => sanitizeBuilderPlanProposalRecord({
      ...record,
      authority: {
        ...record.authority,
        git_authority: 'present',
      },
    }),
    assertPlanError,
  );

  assert.equal(record.authority.renderer_authority, 'not_present');
  assert.equal(record.authority.provider_dispatch, false);
  assert.equal(record.authority.tool_dispatch, 'not_performed');
  assert.equal(record.authority.source_mutation, 'not_performed');
  assert.equal(record.authority.git_authority, 'not_present');
  assert.equal(record.authority.revision_admission, 'not_created');
  assert.equal(record.lifecycle.approval_admission, 'not_approved');
  assert.equal(record.lifecycle.verification_admission, 'not_started');
  assert.equal(Object.hasOwn(record, 'git_candidate_receipt'), false);
  assert.equal(Object.hasOwn(record, 'source_context_result'), false);
});

test('source remains a main-only bounded plan record contract', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-plan-proposal-records.cjs'),
    'utf8',
  );
  assert.match(source, /builder-plan-proposal-record\.v1/u);
  assert.match(source, /main_plan_proposal_record_contract_v1/u);
  assert.match(source, /builder-private-source-context\.v1/u);
  assert.match(source, /createBuilderProjectSourceTree/u);
  assert.match(source, /bounded_private_source_context_digest_only/u);
  assert.match(source, /proposed_not_approved/u);
  assert.match(source, /not_admitted_by_record_contract/u);
  assert.doesNotMatch(
    source,
    /require\(['"](?:electron|node:fs|node:fs\/promises|fs|fs\/promises|node:path|path|node:process|process)['"]\)|\bprocess\.|ipcMain|ipcRenderer|contextBridge|BrowserWindow|safeStorage|builder-provider|builder-git|builder-conversation-main-service|builder-project-main-authority|fetch\s*\(|node:http|node:https|child_process|execFile|spawn\s*\(|readFile|createReadStream|writeFile|appendFile|unlink|rm\(|mkdir|eval\s*\(|new Function|shell:\s*true|persist_candidate_commit|write_current|commit_oid|tree_oid|provider_secret|credential_secret|credential_value|secret_ref|local-provider-executor|chat_planner|ChatCreatePage|Canvas|JobMeta/iu,
  );
});
