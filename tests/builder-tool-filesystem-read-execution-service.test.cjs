'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  createBuilderConversationMainService,
} = require('../electron/builder-conversation-main-service.cjs');
const {
  createBuilderProductMetadataDatabase,
} = require('../electron/builder-product-metadata-database.cjs');
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
  createBuilderToolProjectWorkspaceAuthority,
} = require('../electron/builder-tool-project-workspace-admission.cjs');
const {
  BUILDER_TOOL_FILESYSTEM_READ_EXECUTION_SERVICE_VERSION,
  BuilderToolFilesystemReadExecutionServiceError,
  createBuilderToolFilesystemReadExecutionService,
} = require('../electron/builder-tool-filesystem-read-execution-service.cjs');

const PROJECT_UUID = '123e4567-e89b-42d3-a456-426614174000';
const PROJECT_ID = `builder-project:${PROJECT_UUID}`;
const REQUEST_DIGEST = `sha256:${'1'.repeat(64)}`;
const ACTOR_ID = 'builder-user:123e4567-e89b-42d3-a456-426614174001';
const PERMISSION_ID = `builder-permission:${'a'.repeat(64)}`;

function uuidFactory(start = 1) {
  let value = start;
  return () => {
    const suffix = value.toString(16).padStart(12, '0');
    value += 1;
    return `123e4567-e89b-42d3-a456-${suffix}`;
  };
}

function removeRoot(root) {
  fs.rmSync(root, { recursive: true, force: true });
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cfb-tool-exec-'));
  const database = createBuilderProductMetadataDatabase(path.join(root, 'builder.sqlite'));
  const projectsRoot = path.join(root, 'projects');
  const projectRoot = path.join(projectsRoot, PROJECT_UUID);
  fs.mkdirSync(path.join(projectRoot, 'src'), { recursive: true });
  let now = 1_000;
  const nowMs = () => {
    now += 1;
    return now;
  };
  const conversation = createBuilderConversationMainService({
    metadataAuthority: database,
    createUuid: uuidFactory(),
    nowMs,
  });
  const workspace = createBuilderToolProjectWorkspaceAuthority({
    projects_root: projectsRoot,
  });
  const execution = createBuilderToolFilesystemReadExecutionService({
    conversation_service: conversation,
    project_workspace_authority: workspace,
    now_ms: nowMs,
  });
  return {
    root,
    database,
    projectsRoot,
    projectRoot,
    conversation,
    workspace,
    execution,
    close() {
      database.close();
      removeRoot(root);
    },
  };
}

function begin(conversation) {
  return conversation.begin_work({
    project_id: PROJECT_ID,
    instruction: 'Read the app source before making a plan.',
    request_digest: REQUEST_DIGEST,
    base_revision: null,
  });
}

async function allowedAdmission(index, resourceId = 'project:/src/app.tsx') {
  const guard = createBuilderToolPermissionAdmission({
    actor_id: ACTOR_ID,
    now_ms: () => 60,
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
    tool_call_id: `builder-tool-call:${PROJECT_UUID.slice(0, -12)}${index.toString(16).padStart(12, '0')}`,
    tool_name: 'filesystem.read',
    project_id: PROJECT_ID,
    action: 'filesystem.read',
    resource: {
      resource_kind: 'filesystem',
      project_id: PROJECT_ID,
      resource_id: resourceId,
    },
  });
}

async function toolCallRecord(context, index, overrides = {}) {
  const sessionPolicy = createBuilderToolSessionPolicy({
    project_id: PROJECT_ID,
    conversation_id: context.conversation.conversation_id,
    turn_id: context.ids.turn_id,
    task_id: context.ids.task_id,
    run_id: context.ids.run_id,
    issued_at_ms: 50,
    limits: {
      ...DEFAULT_BUILDER_TOOL_SESSION_LIMITS,
      max_raw_output_bytes: overrides.max_raw_output_bytes ?? 1_024,
    },
  });
  return createBuilderToolCallRecord({
    project_id: PROJECT_ID,
    conversation_id: context.conversation.conversation_id,
    turn_id: context.ids.turn_id,
    task_id: context.ids.task_id,
    run_id: context.ids.run_id,
    step_id: `builder-run-step:${PROJECT_UUID.slice(0, -12)}${(index + 100).toString(16).padStart(12, '0')}`,
    session_policy: sessionPolicy,
    admission: await allowedAdmission(index, overrides.resource_id),
    requested_at_ms: 70 + index,
  });
}

function assertExecutionError(error) {
  assert.equal(error instanceof BuilderToolFilesystemReadExecutionServiceError, true);
  assert.equal(error.code, 'builder_tool_filesystem_read_execution_service_unavailable');
  assert.equal(error.message, 'The filesystem read tool could not be completed.');
  assert.equal(error.retryable, false);
  assert.doesNotMatch(`${error.message}\n${error.stack}`, /src\/app|secret|api[_-]?key|Authorization|Bearer/iu);
  return true;
}

test('executes a bounded project file read and records only a fixed public result', async () => {
  const item = fixture();
  try {
    fs.writeFileSync(path.join(item.projectRoot, 'src', 'app.tsx'), 'export const answer = 42;\n');
    const context = begin(item.conversation);
    const callRecord = await toolCallRecord(context, 1);
    const requestedContext = item.conversation.record_tool_call_request({
      context,
      tool_call_record: callRecord,
    });

    const result = await item.execution.execute_filesystem_read({
      context: requestedContext,
      tool_call_record: callRecord,
    });

    assert.equal(item.execution.service_version, BUILDER_TOOL_FILESYSTEM_READ_EXECUTION_SERVICE_VERSION);
    assert.equal(result.result_version, 'builder-tool-filesystem-read-execution-result.v1');
    assert.equal(result.operation, 'filesystem_read_tool_executed');
    assert.equal(result.status, 'succeeded');
    assert.equal(result.tool_result_record.result.status, 'succeeded');
    assert.equal(result.tool_result_record.result.summary_code, 'completed_without_raw_output');
    assert.equal(result.private_filesystem_read_output_record.file.content, 'export const answer = 42;\n');
    assert.equal(result.private_filesystem_read_output_record.file.path, 'src/app.tsx');
    assert.equal(result.context.start_head.sequence, 4);
    assert.equal(result.authority.renderer_authority, 'not_present');
    assert.equal(result.authority.provider_dispatch, false);
    assert.equal(result.authority.raw_output_storage, 'not_durable');
    assert.equal(result.authority.conversation_event, 'fixed_result_summary_only');

    const stream = item.conversation.read_stream({ project_id: PROJECT_ID });
    assert.equal(stream.conversation.head_sequence, 4);
    assert.equal(stream.conversation.items[2].item_kind, 'tool_call_requested');
    assert.equal(stream.conversation.items[3].item_kind, 'tool_call_result_recorded');
    assert.equal(stream.conversation.items[3].result.status, 'succeeded');
    assert.doesNotMatch(
      JSON.stringify(stream),
      /export const answer|src\/app\.tsx|private_filesystem_read_output_record|runtime_invocation|adapter_selection|dispatch_request|record_digest|policy_digest|provider|credential|commit_oid|tree_oid/iu,
    );
  } finally {
    item.close();
  }
});

test('records a fixed failed result when the private read is unavailable', async () => {
  const item = fixture();
  try {
    const context = begin(item.conversation);
    const callRecord = await toolCallRecord(context, 2, {
      resource_id: 'project:/src/missing.tsx',
    });
    const requestedContext = item.conversation.record_tool_call_request({
      context,
      tool_call_record: callRecord,
    });

    const result = await item.execution.execute_filesystem_read({
      context: requestedContext,
      tool_call_record: callRecord,
    });

    assert.equal(result.status, 'failed');
    assert.equal(result.private_filesystem_read_output_record, null);
    assert.equal(result.tool_result_record.result.status, 'failed');
    assert.equal(result.tool_result_record.result.summary_code, 'adapter_unavailable');
    const stream = item.conversation.read_stream({ project_id: PROJECT_ID });
    assert.equal(stream.conversation.head_sequence, 4);
    assert.equal(stream.conversation.items[3].result.status, 'failed');
    assert.equal(stream.conversation.items[3].result.summary_code, 'adapter_unavailable');
    assert.doesNotMatch(JSON.stringify(stream), /missing\.tsx|adapter_id|runtime_id|provider|credential/iu);
  } finally {
    item.close();
  }
});

test('rejects unrequested, mismatched, hostile, and malformed execution requests without partial result events', async () => {
  const item = fixture();
  try {
    fs.writeFileSync(path.join(item.projectRoot, 'src', 'app.tsx'), 'export const ok = true;\n');
    const context = begin(item.conversation);
    const callRecord = await toolCallRecord(context, 3);

    await assert.rejects(
      () => item.execution.execute_filesystem_read({
        context,
        tool_call_record: callRecord,
      }),
      assertExecutionError,
    );
    assert.equal(item.conversation.read_stream({ project_id: PROJECT_ID }).conversation.head_sequence, 2);

    const requestedContext = item.conversation.record_tool_call_request({
      context,
      tool_call_record: callRecord,
    });
    const otherRecord = await toolCallRecord(context, 4);
    await assert.rejects(
      () => item.execution.execute_filesystem_read({
        context: requestedContext,
        tool_call_record: otherRecord,
      }),
      assertExecutionError,
    );
    assert.equal(item.conversation.read_stream({ project_id: PROJECT_ID }).conversation.head_sequence, 3);

    let getterCalls = 0;
    const accessorRequest = { context: requestedContext };
    Object.defineProperty(accessorRequest, 'tool_call_record', {
      enumerable: true,
      get() {
        getterCalls += 1;
        return callRecord;
      },
    });
    await assert.rejects(
      () => item.execution.execute_filesystem_read(accessorRequest),
      assertExecutionError,
    );
    await assert.rejects(
      () => item.execution.execute_filesystem_read(new Proxy({
        context: requestedContext,
        tool_call_record: callRecord,
      }, {})),
      assertExecutionError,
    );
    assert.equal(getterCalls, 0);
    assert.equal(item.conversation.read_stream({ project_id: PROJECT_ID }).conversation.head_sequence, 3);
  } finally {
    item.close();
  }
});

test('source remains main-only and does not expose IPC, provider, Git, process, or write authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-tool-filesystem-read-execution-service.cjs'),
    'utf8',
  );
  assert.match(source, /builder-tool-filesystem-read-execution-service\.v1/u);
  assert.match(source, /main_tool_filesystem_read_execution_service_v1/u);
  assert.match(source, /readBuilderToolFilesystemReadAdapter/u);
  assert.match(source, /createBuilderToolResultRecord/u);
  assert.match(source, /select_tool_adapter/u);
  assert.match(source, /admit_tool_runtime_invocation/u);
  assert.match(source, /record_tool_result/u);
  assert.match(source, /admit_project_workspace/u);
  assert.match(source, /fixed_result_summary_only/u);
  assert.doesNotMatch(
    source,
    /require\(['"]electron['"]\)|ipcMain|ipcRenderer|contextBridge|BrowserWindow|safeStorage|builder-provider|builder-git|builder-conversation-main-service|builder-project-main-authority|fetch\s*\(|https?:|Authorization|Bearer|child_process|execFile|spawn\s*\(|readFile|createReadStream|readdir|statSync|openSync|writeFile|appendFile|createWriteStream|unlink|rmSync|rm\s*\(|mkdir|eval\s*\(|new Function|shell:\s*true|persist_candidate_commit|write_current|commit_oid|tree_oid|source_tree|provider_secret|credential_secret|credential_value|secret_ref|local-provider-executor|chat_planner|ChatCreatePage|Canvas|JobMeta/iu,
  );
});
