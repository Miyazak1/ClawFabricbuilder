'use strict';

const assert = require('node:assert/strict');
const nodeCrypto = require('node:crypto');
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
  BUILDER_TOOL_RUNTIME_INVOCATION_ADMISSION_VERSION,
  FILESYSTEM_READ_TOOL_RUNTIME_ID,
  TOOL_RUNTIME_INVOCATION_ADMISSION_KIND,
  BuilderToolRuntimeInvocationAdmissionError,
  createBuilderToolRuntimeInvocationAdmission,
  sanitizeBuilderToolRuntimeInvocationAdmission,
} = require('../electron/builder-tool-runtime-invocation-admission.cjs');

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
  return createBuilderToolSessionPolicy({
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    turn_id: TURN_ID,
    task_id: TASK_ID,
    run_id: RUN_ID,
    issued_at_ms: overrides.issued_at_ms ?? 49,
    limits: {
      ...DEFAULT_BUILDER_TOOL_SESSION_LIMITS,
      ...(overrides.limits ?? {}),
    },
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

function existing(callRecord) {
  return {
    step_id: callRecord.step_id,
    tool_call_id: callRecord.tool_call_id,
    tool_call_record: callRecord,
    tool_result_record: null,
  };
}

function dispatchAdmission(callRecord, overrides = {}) {
  return createBuilderToolDispatchAdmission({
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    turn_id: TURN_ID,
    task_id: TASK_ID,
    run_id: RUN_ID,
    run_status: 'running',
    interrupt_requested: false,
    cancel_requested: false,
    existing_tool_calls: [existing(callRecord)],
    tool_call_record: callRecord,
    dispatch_request_id: id('tool-dispatch-request', 1),
    admitted_at_ms: callRecord.requested_at_ms,
    ...overrides,
  });
}

function adapterSelection(dispatch, callRecord, overrides = {}) {
  return createBuilderToolAdapterSelectionAdmission({
    dispatch_admission: dispatch,
    tool_call_record: callRecord,
    adapter_id: FILESYSTEM_READ_TOOL_ADAPTER_ID,
    adapter_selection_id: id('tool-adapter-selection', 1),
    selected_at_ms: dispatch.admitted_at_ms,
    ...overrides,
  });
}

function runtimeInput(selection, callRecord, overrides = {}) {
  return {
    adapter_selection_admission: selection,
    tool_call_record: callRecord,
    runtime_id: FILESYSTEM_READ_TOOL_RUNTIME_ID,
    runtime_invocation_id: id('tool-runtime-invocation', 1),
    runtime_admitted_at_ms: selection.selected_at_ms,
    ...overrides,
  };
}

function assertRuntimeError(error) {
  assert.equal(error instanceof BuilderToolRuntimeInvocationAdmissionError, true);
  assert.equal(error.code, 'builder_tool_runtime_invocation_admission_invalid');
  assert.equal(error.message, 'The tool runtime invocation could not be verified.');
  assert.equal(error.retryable, false);
  return true;
}

function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number' && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`
  )).join(',')}}`;
}

function digestSelection(value) {
  return `sha256:${nodeCrypto.createHash('sha256').update(canonicalJson({
    action: value.action,
    adapter_id: value.adapter_id,
    adapter_selection_id: value.adapter_selection_id,
    admission_kind: value.admission_kind,
    admission_version: value.admission_version,
    authority: value.authority,
    conversation_id: value.conversation_id,
    dispatch_admission_digest: value.dispatch_admission_digest,
    dispatch_admitted_at_ms: value.dispatch_admitted_at_ms,
    dispatch_request_id: value.dispatch_request_id,
    lifecycle: value.lifecycle,
    policy_digest: value.policy_digest,
    project_id: value.project_id,
    record_digest: value.record_digest,
    resource_kind: value.resource_kind,
    run_id: value.run_id,
    selected_at_ms: value.selected_at_ms,
    step_id: value.step_id,
    task_id: value.task_id,
    tool_call_id: value.tool_call_id,
    tool_name: value.tool_name,
    turn_id: value.turn_id,
  }), 'utf8').digest('hex')}`;
}

function digestRuntime(value) {
  return `sha256:${nodeCrypto.createHash('sha256').update(canonicalJson({
    action: value.action,
    adapter_id: value.adapter_id,
    adapter_selected_at_ms: value.adapter_selected_at_ms,
    adapter_selection_digest: value.adapter_selection_digest,
    adapter_selection_id: value.adapter_selection_id,
    admission_kind: value.admission_kind,
    admission_version: value.admission_version,
    authority: value.authority,
    conversation_id: value.conversation_id,
    dispatch_admission_digest: value.dispatch_admission_digest,
    dispatch_request_id: value.dispatch_request_id,
    lifecycle: value.lifecycle,
    max_chargeable_dispatches: value.max_chargeable_dispatches,
    max_raw_output_bytes: value.max_raw_output_bytes,
    policy_digest: value.policy_digest,
    project_id: value.project_id,
    record_digest: value.record_digest,
    resource_kind: value.resource_kind,
    run_id: value.run_id,
    runtime_admitted_at_ms: value.runtime_admitted_at_ms,
    runtime_id: value.runtime_id,
    runtime_invocation_id: value.runtime_invocation_id,
    step_id: value.step_id,
    task_id: value.task_id,
    tool_call_id: value.tool_call_id,
    tool_name: value.tool_name,
    turn_id: value.turn_id,
  }), 'utf8').digest('hex')}`;
}

function selectionForRecord(template, record) {
  const forged = {
    ...template,
    step_id: record.step_id,
    tool_call_id: record.tool_call_id,
    record_digest: record.record_digest,
    policy_digest: record.session_policy.policy_digest,
  };
  return {
    ...forged,
    admission_digest: digestSelection(forged),
  };
}

test('admits a bounded runtime envelope without reading files or executing the adapter', async () => {
  const record = await toolCallRecord(1);
  const dispatch = dispatchAdmission(record);
  const selection = adapterSelection(dispatch, record);
  const runtime = createBuilderToolRuntimeInvocationAdmission(runtimeInput(selection, record));

  assert.equal(runtime.admission_version, BUILDER_TOOL_RUNTIME_INVOCATION_ADMISSION_VERSION);
  assert.equal(runtime.admission_kind, TOOL_RUNTIME_INVOCATION_ADMISSION_KIND);
  assert.equal(runtime.project_id, PROJECT_ID);
  assert.equal(runtime.conversation_id, CONVERSATION_ID);
  assert.equal(runtime.turn_id, TURN_ID);
  assert.equal(runtime.task_id, TASK_ID);
  assert.equal(runtime.run_id, RUN_ID);
  assert.equal(runtime.step_id, record.step_id);
  assert.equal(runtime.tool_call_id, record.tool_call_id);
  assert.equal(runtime.dispatch_request_id, selection.dispatch_request_id);
  assert.equal(runtime.adapter_selection_id, selection.adapter_selection_id);
  assert.equal(runtime.dispatch_admission_digest, selection.dispatch_admission_digest);
  assert.equal(runtime.adapter_selection_digest, selection.admission_digest);
  assert.equal(runtime.record_digest, record.record_digest);
  assert.equal(runtime.policy_digest, record.session_policy.policy_digest);
  assert.equal(runtime.adapter_id, FILESYSTEM_READ_TOOL_ADAPTER_ID);
  assert.equal(runtime.runtime_id, FILESYSTEM_READ_TOOL_RUNTIME_ID);
  assert.equal(runtime.tool_name, 'filesystem.read');
  assert.equal(runtime.action, 'filesystem.read');
  assert.equal(runtime.resource_kind, 'filesystem');
  assert.equal(runtime.adapter_selected_at_ms, selection.selected_at_ms);
  assert.equal(runtime.runtime_admitted_at_ms, selection.selected_at_ms);
  assert.equal(runtime.max_raw_output_bytes, 0);
  assert.equal(runtime.max_chargeable_dispatches, 0);
  assert.deepEqual(runtime.lifecycle, {
    dispatch_admission: 'verified_bounded_main_admission',
    adapter_selection: 'verified_static_adapter',
    runtime_admission: 'bounded_envelope_admitted',
    runtime_invocation: 'admitted_without_execution',
    filesystem_read: 'not_performed',
    execution_admission: 'not_started',
    result_admission: 'not_recorded',
    raw_output_admission: 'not_included',
    revision_admission: 'not_created',
  });
  assert.deepEqual(runtime.authority, {
    runtime_authority: 'main_tool_runtime_invocation_contract_v1',
    selection_authority: 'main_tool_adapter_selection_contract_v1',
    adapter_registry_authority: 'static_main_tool_adapter_registry_v1',
    runtime_registry_authority: 'static_main_tool_runtime_registry_v1',
    conversation_binding: 'trusted_open_tool_call_required',
    renderer_authority: 'not_present',
    provider_dispatch: false,
    credential_readback: false,
    tool_dispatch: 'not_performed',
    runtime_execution: 'not_started',
    filesystem_read: 'not_performed',
    network_access: 'denied',
    process_access: 'denied',
    secret_access: 'denied',
    raw_output_storage: 'not_present',
    git_authority: 'not_present',
    cost_authority: 'no_chargeable_dispatch_without_runtime_meter_v1',
  });
  assert.deepEqual(sanitizeBuilderToolRuntimeInvocationAdmission(runtime), runtime);
  assert.equal(Object.isFrozen(runtime), true);
  assert.equal(Object.isFrozen(runtime.lifecycle), true);
  assert.equal(Object.isFrozen(runtime.authority), true);
  assert.doesNotMatch(
    JSON.stringify(runtime),
    /resource_id|permission_id|permission_admission_receipt|source_tree|file_content|stdout|stderr|output_digest|commit_oid|tree_oid/iu,
  );
});

test('rejects unsupported runtime, selection drift, unsafe resources, stale timing, and non-read tools', async () => {
  const record = await toolCallRecord(2);
  const selection = adapterSelection(dispatchAdmission(record), record);
  assert.throws(() => createBuilderToolRuntimeInvocationAdmission(runtimeInput(selection, record, {
    runtime_id: 'builder-tool-runtime.project-edit.v1',
  })), assertRuntimeError);

  const otherRecord = await toolCallRecord(3);
  assert.throws(() => createBuilderToolRuntimeInvocationAdmission(runtimeInput(selection, otherRecord)), assertRuntimeError);

  const shortPolicyRecord = await toolCallRecord(4, {
    session_policy: sessionPolicy({
      limits: {
        max_step_timeout_ms: 10,
        max_total_timeout_ms: 1_000,
      },
    }),
  });
  const shortSelection = adapterSelection(dispatchAdmission(shortPolicyRecord), shortPolicyRecord);
  assert.throws(() => createBuilderToolRuntimeInvocationAdmission(runtimeInput(
    shortSelection,
    shortPolicyRecord,
    { runtime_admitted_at_ms: shortPolicyRecord.requested_at_ms + 11 },
  )), assertRuntimeError);

  const unsafePath = await toolCallRecord(5, {
    admission: {
      resource: {
        resource_kind: 'filesystem',
        project_id: PROJECT_ID,
        resource_id: 'project:/c:/secret.txt',
      },
    },
  });
  assert.throws(() => createBuilderToolRuntimeInvocationAdmission(runtimeInput(
    selectionForRecord(selection, unsafePath),
    unsafePath,
  )), assertRuntimeError);

  const projectRead = await toolCallRecord(6, {
    admission: {
      tool_name: 'project.read',
      action: 'project.read',
      resource: {
        resource_kind: 'project',
        project_id: PROJECT_ID,
        resource_id: 'project:current',
      },
    },
  });
  assert.throws(() => createBuilderToolRuntimeInvocationAdmission(runtimeInput(
    selectionForRecord(selection, projectRead),
    projectRead,
  )), assertRuntimeError);
});

test('rejects forged runtime receipts and hostile input without leaking rejected material', async () => {
  const record = await toolCallRecord(7);
  const selection = adapterSelection(dispatchAdmission(record), record);
  const runtime = createBuilderToolRuntimeInvocationAdmission(runtimeInput(selection, record));

  const impossibleTime = {
    ...runtime,
    runtime_admitted_at_ms: runtime.adapter_selected_at_ms - 1,
  };
  assert.throws(() => sanitizeBuilderToolRuntimeInvocationAdmission({
    ...impossibleTime,
    admission_digest: digestRuntime(impossibleTime),
  }), assertRuntimeError);

  const forgedAction = {
    ...runtime,
    action: 'project.read',
  };
  assert.throws(() => sanitizeBuilderToolRuntimeInvocationAdmission({
    ...forgedAction,
    admission_digest: digestRuntime(forgedAction),
  }), assertRuntimeError);

  assert.throws(() => sanitizeBuilderToolRuntimeInvocationAdmission({
    ...runtime,
    authority: {
      ...runtime.authority,
      filesystem_read: 'performed',
    },
  }), assertRuntimeError);

  const accessorInput = runtimeInput(selection, record);
  Object.defineProperty(accessorInput, 'tool_call_record', {
    enumerable: true,
    get() { throw new Error('private marker'); },
  });
  assert.throws(() => createBuilderToolRuntimeInvocationAdmission(accessorInput), assertRuntimeError);
  assert.throws(() => createBuilderToolRuntimeInvocationAdmission(runtimeInput(
    new Proxy(selection, {}),
    record,
  )), assertRuntimeError);
});

test('source remains a pure runtime-invocation contract with no IPC, filesystem read, provider, Git, raw output, or execution authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-tool-runtime-invocation-admission.cjs'),
    'utf8',
  );
  assert.match(source, /builder-tool-runtime-invocation-admission\.v1/u);
  assert.match(source, /builder-tool-runtime\.filesystem-read-envelope\.v1/u);
  assert.match(source, /main_tool_runtime_invocation_contract_v1/u);
  assert.match(source, /static_main_tool_runtime_registry_v1/u);
  assert.match(source, /bounded_envelope_admitted/u);
  assert.match(source, /admitted_without_execution/u);
  assert.match(source, /filesystem_read:\s*'not_performed'/u);
  assert.match(source, /runtime_execution:\s*'not_started'/u);
  assert.match(source, /network_access:\s*'denied'/u);
  assert.match(source, /process_access:\s*'denied'/u);
  assert.match(source, /secret_access:\s*'denied'/u);
  assert.match(source, /runtimeAdmittedAtMs - record\.requested_at_ms > policy\.limits\.max_step_timeout_ms/u);
  assert.match(source, /policy\.limits\.max_chargeable_dispatches !== 0/u);
  assert.match(source, /selection\.record_digest !== record\.record_digest/u);
  assert.match(source, /suffix\.includes\(':'\)/u);
  assert.doesNotMatch(
    source,
    /require\(['"]electron['"]\)|require\(['"](?:node:fs\/promises|node:fs|fs|fs\/promises|node:path|path)['"]\)|ipcMain|ipcRenderer|contextBridge|BrowserWindow|safeStorage|builder-provider|builder-git|builder-project-main-authority|fetch\s*\(|https?:|Authorization|Bearer|child_process|execFile|spawn\s*\(|readFile|createReadStream|readdir|statSync|openSync|open\s*\(|eval\s*\(|new Function|shell:\s*true|record_grant|record_revocation|persist_candidate_commit|write_current|stdout|stderr|output_digest|exit_code|result_bytes|file_content|source_tree|commit_oid|tree_oid|provider_secret|credential_secret|credential_value|secret_ref|local-provider-executor|chat_planner|ChatCreatePage|Canvas|JobMeta/iu,
  );
});
