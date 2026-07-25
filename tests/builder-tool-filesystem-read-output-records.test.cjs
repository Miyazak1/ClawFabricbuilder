'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  BUILDER_PERMISSION_DECISION_VERSION,
  BUILDER_PERMISSION_POLICY_VERSION,
} = require('../electron/builder-permission-authority-contract.cjs');
const {
  createBuilderToolPermissionAdmission,
} = require('../electron/builder-tool-permission-admission.cjs');
const {
  DEFAULT_BUILDER_TOOL_SESSION_LIMITS,
  createBuilderToolSessionPolicy,
} = require('../electron/builder-tool-session-policy.cjs');
const {
  createBuilderToolCallRecord,
} = require('../electron/builder-tool-call-records.cjs');
const {
  createBuilderToolDispatchAdmission,
} = require('../electron/builder-tool-dispatch-admission.cjs');
const {
  FILESYSTEM_READ_TOOL_ADAPTER_ID,
  createBuilderToolAdapterSelectionAdmission,
} = require('../electron/builder-tool-adapter-selection-admission.cjs');
const {
  FILESYSTEM_READ_TOOL_RUNTIME_ID,
  createBuilderToolRuntimeInvocationAdmission,
} = require('../electron/builder-tool-runtime-invocation-admission.cjs');
const {
  BUILDER_TOOL_FILESYSTEM_READ_OUTPUT_RECORD_VERSION,
  TOOL_FILESYSTEM_READ_OUTPUT_RECORD_KIND,
  BuilderToolFilesystemReadOutputRecordError,
  createBuilderToolFilesystemReadOutputRecord,
  sanitizeBuilderToolFilesystemReadOutputRecord,
} = require('../electron/builder-tool-filesystem-read-output-records.cjs');

const PROJECT_UUID = '123e4567-e89b-42d3-a456-426614174000';
const PROJECT_ID = `builder-project:${PROJECT_UUID}`;
const CONVERSATION_ID = `builder-conversation:${PROJECT_UUID}`;
const ACTOR_ID = 'builder-user:123e4567-e89b-42d3-a456-426614174001';
const TURN_ID = 'builder-turn:123e4567-e89b-42d3-a456-426614174002';
const TASK_ID = 'builder-task:123e4567-e89b-42d3-a456-426614174003';
const RUN_ID = 'builder-run:123e4567-e89b-42d3-a456-426614174004';
const PERMISSION_ID = `builder-permission:${'a'.repeat(64)}`;

function id(kind, index) {
  return `builder-${kind}:123e4567-e89b-42d3-a456-${index.toString(16).padStart(12, '0')}`;
}

function sessionPolicy(overrides = {}) {
  const { limits = {}, ...rest } = overrides;
  return createBuilderToolSessionPolicy({
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    turn_id: TURN_ID,
    task_id: TASK_ID,
    run_id: RUN_ID,
    issued_at_ms: 49,
    limits: {
      ...DEFAULT_BUILDER_TOOL_SESSION_LIMITS,
      ...limits,
    },
    ...rest,
  });
}

async function allowedAdmission(index, overrides = {}) {
  const action = overrides.action ?? 'filesystem.read';
  const resource = overrides.resource ?? {
    resource_kind: 'filesystem',
    project_id: PROJECT_ID,
    resource_id: `project:/src/file-${index}.tsx`,
  };
  const guard = createBuilderToolPermissionAdmission({
    actor_id: ACTOR_ID,
    now_ms: () => overrides.evaluated_at_ms ?? 50,
    evaluate_permission: async (body) => ({
      decision_version: BUILDER_PERMISSION_DECISION_VERSION,
      policy_version: BUILDER_PERMISSION_POLICY_VERSION,
      actor_id: ACTOR_ID,
      action: body.action,
      resource: body.resource,
      evaluated_at_ms: body.now_ms,
      decision: 'allowed',
      reason: 'matching_active_grant',
      permission_id: PERMISSION_ID,
      permission_authority: 'builder_permission_facts_deny_by_default_v1',
      ui_selection_authority: 'not_permission',
    }),
  });
  return guard.admit({
    tool_call_id: id('tool-call', index),
    tool_name: overrides.tool_name ?? action,
    project_id: PROJECT_ID,
    action,
    resource,
  });
}

async function toolCallRecord(index, overrides = {}) {
  return createBuilderToolCallRecord({
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    turn_id: TURN_ID,
    task_id: TASK_ID,
    run_id: RUN_ID,
    step_id: id('run-step', index),
    session_policy: overrides.session_policy ?? sessionPolicy(),
    admission: await allowedAdmission(index, overrides.admission ?? {}),
    requested_at_ms: overrides.requested_at_ms ?? 60,
  });
}

function existing(record) {
  return {
    step_id: record.step_id,
    tool_call_id: record.tool_call_id,
    tool_call_record: record,
    tool_result_record: null,
  };
}

function dispatchAdmission(record) {
  return createBuilderToolDispatchAdmission({
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    turn_id: TURN_ID,
    task_id: TASK_ID,
    run_id: RUN_ID,
    run_status: 'running',
    interrupt_requested: false,
    cancel_requested: false,
    existing_tool_calls: [existing(record)],
    tool_call_record: record,
    dispatch_request_id: id('tool-dispatch-request', 1),
    admitted_at_ms: record.requested_at_ms,
  });
}

function adapterSelection(dispatch, record) {
  return createBuilderToolAdapterSelectionAdmission({
    dispatch_admission: dispatch,
    tool_call_record: record,
    adapter_id: FILESYSTEM_READ_TOOL_ADAPTER_ID,
    adapter_selection_id: id('tool-adapter-selection', 1),
    selected_at_ms: dispatch.admitted_at_ms,
  });
}

function runtimeAdmission(record, overrides = {}) {
  const dispatch = dispatchAdmission(record);
  const selection = adapterSelection(dispatch, record);
  return createBuilderToolRuntimeInvocationAdmission({
    adapter_selection_admission: selection,
    tool_call_record: record,
    runtime_id: FILESYSTEM_READ_TOOL_RUNTIME_ID,
    runtime_invocation_id: id('tool-runtime-invocation', 1),
    runtime_admitted_at_ms: selection.selected_at_ms,
    ...overrides,
  });
}

async function outputContext(index, overrides = {}) {
  const record = await toolCallRecord(index, {
    session_policy: overrides.session_policy ?? sessionPolicy({
      limits: { max_raw_output_bytes: 1_024 },
    }),
    admission: overrides.admission,
  });
  const runtime = runtimeAdmission(record);
  return { record, runtime };
}

function outputInput(record, runtime, overrides = {}) {
  return {
    runtime_invocation_admission: runtime,
    tool_call_record: record,
    observed_at_ms: 70,
    content: 'export const answer = 42;\n',
    ...overrides,
  };
}

function assertOutputError(error) {
  assert.equal(error instanceof BuilderToolFilesystemReadOutputRecordError, true);
  assert.equal(error.code, 'builder_tool_filesystem_read_output_record_invalid');
  assert.equal(error.message, 'The filesystem read output could not be verified.');
  assert.equal(error.retryable, false);
  return true;
}

test('creates a bounded private filesystem read output record from runtime and call receipts', async () => {
  const { record, runtime } = await outputContext(1);
  const output = createBuilderToolFilesystemReadOutputRecord(outputInput(record, runtime));

  assert.equal(output.record_version, BUILDER_TOOL_FILESYSTEM_READ_OUTPUT_RECORD_VERSION);
  assert.equal(output.record_kind, TOOL_FILESYSTEM_READ_OUTPUT_RECORD_KIND);
  assert.equal(output.project_id, PROJECT_ID);
  assert.equal(output.tool_call_id, record.tool_call_id);
  assert.equal(output.action, 'filesystem.read');
  assert.equal(output.resource_kind, 'filesystem');
  assert.equal(output.resource_id, 'project:/src/file-1.tsx');
  assert.equal(output.runtime_invocation_digest, runtime.admission_digest);
  assert.equal(output.max_raw_output_bytes, 1_024);
  assert.deepEqual(output.file, {
    path: 'src/file-1.tsx',
    entry_kind: 'text_file',
    content: 'export const answer = 42;\n',
    content_digest: output.file.content_digest,
    content_bytes: Buffer.byteLength('export const answer = 42;\n', 'utf8'),
  });
  assert.match(output.file.content_digest, /^sha256:[0-9a-f]{64}$/u);
  assert.deepEqual(output.lifecycle, {
    permission_admission: 'verified_allowed',
    tool_call_admission: 'verified_pre_dispatch_record',
    runtime_admission: 'verified_runtime_invocation',
    filesystem_read: 'bounded_private_file_content_recorded',
    raw_output_admission: 'private_bounded_not_projected',
    provider_admission: 'not_dispatched',
    revision_admission: 'not_created',
  });
  assert.deepEqual(output.authority, {
    record_authority: 'main_tool_filesystem_read_output_record_contract_v1',
    tool_call_authority: 'main_tool_call_record_contract_v1',
    runtime_invocation_authority: 'main_tool_runtime_invocation_contract_v1',
    content_authority: 'caller_supplied_adapter_output_sanitized',
    conversation_binding: 'verified_tool_call_record_and_runtime_invocation',
    renderer_authority: 'not_present',
    provider_dispatch: false,
    credential_readback: false,
    filesystem_read: 'bounded_project_resource_output_only',
    raw_output_storage: 'not_durable_by_record_contract',
    conversation_event: 'not_admitted',
    git_authority: 'not_present',
  });
  assert.match(output.record_digest, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(Object.isFrozen(output), true);
  assert.equal(Object.isFrozen(output.file), true);
  assert.equal(Object.isFrozen(output.tool_call_record), true);
  assert.equal(Object.isFrozen(output.runtime_invocation_admission), true);
  const sanitized = sanitizeBuilderToolFilesystemReadOutputRecord(structuredClone(output));
  assert.deepEqual(sanitized, output);
  assert.notEqual(sanitized, output);
});

test('fails closed without an explicit private raw output budget', async () => {
  const record = await toolCallRecord(2);
  const runtime = runtimeAdmission(record);

  assert.equal(runtime.max_raw_output_bytes, 0);
  assert.throws(
    () => createBuilderToolFilesystemReadOutputRecord(outputInput(record, runtime)),
    assertOutputError,
  );
});

test('rejects stale timing, mismatched receipts, unsafe paths, excess output, and secrets', async () => {
  const { record, runtime } = await outputContext(3);
  const other = await outputContext(4);
  const unsafe = await outputContext(5, {
    admission: {
      resource: {
        resource_kind: 'filesystem',
        project_id: PROJECT_ID,
        resource_id: 'project:/con',
      },
    },
  });

  for (const invalidInput of [
    outputInput(record, runtime, { observed_at_ms: 59 }),
    outputInput(other.record, runtime),
    outputInput(record, { ...runtime, runtime_id: 'builder-tool-runtime.project-edit.v1' }),
    outputInput(record, { ...runtime, record_digest: `sha256:${'0'.repeat(64)}` }),
    outputInput(record, runtime, { content: 'a'.repeat(1_025) }),
    outputInput(record, runtime, { content: 'const api_key = "abcdefghijklmnopqrstuvwx";' }),
    outputInput(unsafe.record, unsafe.runtime),
  ]) {
    assert.throws(
      () => createBuilderToolFilesystemReadOutputRecord(invalidInput),
      assertOutputError,
    );
  }
});

test('rejects hostile input and record drift without invoking getters', async () => {
  const { record, runtime } = await outputContext(6);
  const output = createBuilderToolFilesystemReadOutputRecord(outputInput(record, runtime));
  let getterCalls = 0;
  const accessorInput = {
    runtime_invocation_admission: runtime,
    tool_call_record: record,
    observed_at_ms: 70,
  };
  Object.defineProperty(accessorInput, 'content', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return 'export const answer = 42;\n';
    },
  });

  assert.throws(
    () => createBuilderToolFilesystemReadOutputRecord(accessorInput),
    assertOutputError,
  );
  assert.throws(
    () => createBuilderToolFilesystemReadOutputRecord(new Proxy(outputInput(record, runtime), {})),
    assertOutputError,
  );
  assert.throws(
    () => sanitizeBuilderToolFilesystemReadOutputRecord({
      ...output,
      file: { ...output.file, content_bytes: output.file.content_bytes + 1 },
    }),
    assertOutputError,
  );
  assert.throws(
    () => sanitizeBuilderToolFilesystemReadOutputRecord({
      ...output,
      authority: { ...output.authority, conversation_event: 'recorded' },
    }),
    assertOutputError,
  );
  assert.equal(getterCalls, 0);
});

test('record stays private and does not claim renderer, provider, Git, revision, or conversation authority', async () => {
  const { record, runtime } = await outputContext(7);
  const output = createBuilderToolFilesystemReadOutputRecord(outputInput(record, runtime));
  const serialized = JSON.stringify(output);

  assert.equal(output.authority.renderer_authority, 'not_present');
  assert.equal(output.authority.provider_dispatch, false);
  assert.equal(output.authority.credential_readback, false);
  assert.equal(output.authority.conversation_event, 'not_admitted');
  assert.equal(output.authority.git_authority, 'not_present');
  assert.equal(output.lifecycle.revision_admission, 'not_created');
  assert.equal(Object.hasOwn(output, 'git_candidate_receipt'), false);
  assert.equal(Object.hasOwn(output, 'conversation_event'), false);
  assert.doesNotMatch(
    serialized,
    /provider_id|provider_config|provider_secret|credential_secret|credential_value|secret_ref|Authorization|Bearer|ipcRenderer|BrowserWindow|commit_oid|tree_oid|persist_candidate_commit|write_current/iu,
  );
});

test('source remains a main-only private output record contract without filesystem execution authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-tool-filesystem-read-output-records.cjs'),
    'utf8',
  );
  assert.match(source, /builder-tool-filesystem-read-output-record\.v1/u);
  assert.match(source, /main_tool_filesystem_read_output_record_contract_v1/u);
  assert.match(source, /createBuilderProjectSourceTree/u);
  assert.match(source, /sanitizeBuilderToolRuntimeInvocationAdmission/u);
  assert.match(source, /private_bounded_not_projected/u);
  assert.match(source, /conversation_event:\s*'not_admitted'/u);
  assert.match(source, /raw_output_storage:\s*'not_durable_by_record_contract'/u);
  assert.match(source, /Buffer\.byteLength\(content,\s*'utf8'\) > maxRawOutputBytes/u);
  assert.doesNotMatch(
    source,
    /require\(['"]electron['"]\)|require\(['"](?:node:fs\/promises|node:fs|fs|fs\/promises|node:path|path)['"]\)|ipcMain|ipcRenderer|contextBridge|BrowserWindow|safeStorage|builder-provider|builder-git|builder-project-main-authority|fetch\s*\(|https?:|Authorization|Bearer|child_process|execFile|spawn\s*\(|readFile|createReadStream|readdir|statSync|openSync|open\s*\(|eval\s*\(|new Function|shell:\s*true|record_tool|append|persist_candidate_commit|write_current|commit_oid|tree_oid|provider_secret|credential_secret|credential_value|secret_ref|local-provider-executor|chat_planner|ChatCreatePage|Canvas|JobMeta/iu,
  );
});
