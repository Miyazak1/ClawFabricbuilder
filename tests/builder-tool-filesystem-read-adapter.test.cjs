'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const os = require('node:os');
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
  createBuilderToolProjectWorkspaceAuthority,
} = require('../electron/builder-tool-project-workspace-admission.cjs');
const {
  BUILDER_TOOL_FILESYSTEM_READ_ADAPTER_VERSION,
  BuilderToolFilesystemReadAdapterError,
  readBuilderToolFilesystemReadAdapter,
} = require('../electron/builder-tool-filesystem-read-adapter.cjs');

const PROJECT_UUID = '123e4567-e89b-42d3-a456-426614174000';
const OTHER_PROJECT_UUID = '123e4567-e89b-42d3-a456-426614174099';
const PROJECT_ID = `builder-project:${PROJECT_UUID}`;
const OTHER_PROJECT_ID = `builder-project:${OTHER_PROJECT_UUID}`;
const CONVERSATION_ID = `builder-conversation:${PROJECT_UUID}`;
const ACTOR_ID = 'builder-user:123e4567-e89b-42d3-a456-426614174001';
const TURN_ID = 'builder-turn:123e4567-e89b-42d3-a456-426614174002';
const TASK_ID = 'builder-task:123e4567-e89b-42d3-a456-426614174003';
const RUN_ID = 'builder-run:123e4567-e89b-42d3-a456-426614174004';
const PERMISSION_ID = `builder-permission:${'a'.repeat(64)}`;

function id(kind, index) {
  return `builder-${kind}:123e4567-e89b-42d3-a456-${index.toString(16).padStart(12, '0')}`;
}

function removeRoot(root) {
  fs.rmSync(root, { recursive: true, force: true });
}

function projectFixture() {
  const projectsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cfb-tool-read-'));
  const projectRoot = path.join(projectsRoot, PROJECT_UUID);
  fs.mkdirSync(path.join(projectRoot, 'src'), { recursive: true });
  return { projectsRoot, projectRoot };
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
    session_policy: overrides.session_policy ?? sessionPolicy({
      limits: { max_raw_output_bytes: 1_024 },
    }),
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

function runtimeAdmission(record, overrides = {}) {
  const dispatch = createBuilderToolDispatchAdmission({
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
  const selection = createBuilderToolAdapterSelectionAdmission({
    dispatch_admission: dispatch,
    tool_call_record: record,
    adapter_id: FILESYSTEM_READ_TOOL_ADAPTER_ID,
    adapter_selection_id: id('tool-adapter-selection', 1),
    selected_at_ms: dispatch.admitted_at_ms,
  });
  return createBuilderToolRuntimeInvocationAdmission({
    adapter_selection_admission: selection,
    tool_call_record: record,
    runtime_id: FILESYSTEM_READ_TOOL_RUNTIME_ID,
    runtime_invocation_id: id('tool-runtime-invocation', 1),
    runtime_admitted_at_ms: selection.selected_at_ms,
    ...overrides,
  });
}

async function readContext(index, overrides = {}) {
  const record = await toolCallRecord(index, overrides);
  return { record, runtime: runtimeAdmission(record) };
}

function workspaceAdmission(projectsRoot, overrides = {}) {
  const authority = createBuilderToolProjectWorkspaceAuthority({
    projects_root: projectsRoot,
  });
  return authority.admit_project_workspace({
    project_id: PROJECT_ID,
    admitted_at_ms: 61,
    ...overrides,
  });
}

function adapterInput(projectsRoot, record, runtime, overrides = {}) {
  return {
    project_workspace_admission: workspaceAdmission(projectsRoot),
    runtime_invocation_admission: runtime,
    tool_call_record: record,
    observed_at_ms: 70,
    ...overrides,
  };
}

function assertAdapterError(error) {
  assert.equal(error instanceof BuilderToolFilesystemReadAdapterError, true);
  assert.equal(error.code, 'builder_tool_filesystem_read_adapter_unavailable');
  assert.equal(error.message, 'The filesystem read tool could not read the requested file.');
  assert.equal(error.retryable, false);
  assert.doesNotMatch(`${error.message}\n${error.stack}`, /src|secret|api[_-]?key|Authorization|Bearer/iu);
  return true;
}

test('reads one bounded UTF-8 project file and returns a private output record', async () => {
  const { projectsRoot, projectRoot } = projectFixture();
  try {
    fs.writeFileSync(path.join(projectRoot, 'src', 'file-1.tsx'), 'export const answer = 42;\n');
    const { record, runtime } = await readContext(1);
    const output = await readBuilderToolFilesystemReadAdapter(
      adapterInput(projectsRoot, record, runtime),
    );

    assert.equal(BUILDER_TOOL_FILESYSTEM_READ_ADAPTER_VERSION, 'builder-tool-filesystem-read-adapter.v1');
    assert.equal(output.record_version, 'builder-tool-filesystem-read-output-record.v1');
    assert.equal(output.tool_call_id, record.tool_call_id);
    assert.equal(output.runtime_invocation_digest, runtime.admission_digest);
    assert.equal(output.max_raw_output_bytes, 1_024);
    assert.deepEqual(output.file, {
      path: 'src/file-1.tsx',
      entry_kind: 'text_file',
      content: 'export const answer = 42;\n',
      content_digest: output.file.content_digest,
      content_bytes: Buffer.byteLength('export const answer = 42;\n', 'utf8'),
    });
    assert.equal(output.authority.conversation_event, 'not_admitted');
    assert.equal(output.authority.git_authority, 'not_present');
    assert.equal(output.lifecycle.revision_admission, 'not_created');
    assert.equal(Object.isFrozen(output), true);
  } finally {
    removeRoot(projectsRoot);
  }
});

test('fails before opening files when no explicit raw output budget exists', async () => {
  const { projectsRoot } = projectFixture();
  try {
    const record = await toolCallRecord(2, {
      session_policy: sessionPolicy(),
    });
    const runtime = runtimeAdmission(record);
    assert.equal(runtime.max_raw_output_bytes, 0);
    await assert.rejects(
      () => readBuilderToolFilesystemReadAdapter(adapterInput(projectsRoot, record, runtime)),
      assertAdapterError,
    );
  } finally {
    removeRoot(projectsRoot);
  }
});

test('rejects missing files, directories, over-limit files, invalid UTF-8, and secrets', async () => {
  const { projectsRoot, projectRoot } = projectFixture();
  try {
    const missing = await readContext(3);
    await assert.rejects(
      () => readBuilderToolFilesystemReadAdapter(adapterInput(projectsRoot, missing.record, missing.runtime)),
      assertAdapterError,
    );

    fs.mkdirSync(path.join(projectRoot, 'src', 'file-4.tsx'));
    const directory = await readContext(4);
    await assert.rejects(
      () => readBuilderToolFilesystemReadAdapter(adapterInput(projectsRoot, directory.record, directory.runtime)),
      assertAdapterError,
    );

    fs.writeFileSync(path.join(projectRoot, 'src', 'file-5.tsx'), '123456789');
    const overLimit = await readContext(5, {
      session_policy: sessionPolicy({ limits: { max_raw_output_bytes: 8 } }),
    });
    await assert.rejects(
      () => readBuilderToolFilesystemReadAdapter(adapterInput(projectsRoot, overLimit.record, overLimit.runtime)),
      assertAdapterError,
    );

    fs.writeFileSync(path.join(projectRoot, 'src', 'file-6.tsx'), Buffer.from([0xff]));
    const invalidUtf8 = await readContext(6);
    await assert.rejects(
      () => readBuilderToolFilesystemReadAdapter(adapterInput(projectsRoot, invalidUtf8.record, invalidUtf8.runtime)),
      assertAdapterError,
    );

    fs.writeFileSync(path.join(projectRoot, 'src', 'file-7.tsx'), 'const api_key = "abcdefghijklmnopqrstuvwx";');
    const secret = await readContext(7);
    await assert.rejects(
      () => readBuilderToolFilesystemReadAdapter(adapterInput(projectsRoot, secret.record, secret.runtime)),
      assertAdapterError,
    );
  } finally {
    removeRoot(projectsRoot);
  }
});

test('rejects unsafe project resources, mismatched receipts, stale time, and hostile input', async () => {
  const { projectsRoot, projectRoot } = projectFixture();
  try {
    fs.writeFileSync(path.join(projectRoot, 'src', 'file-8.tsx'), 'export const ok = true;\n');
    const first = await readContext(8);
    const second = await readContext(9);
    await assert.rejects(
      () => readBuilderToolFilesystemReadAdapter(adapterInput(projectsRoot, second.record, first.runtime)),
      assertAdapterError,
    );
    await assert.rejects(
      () => readBuilderToolFilesystemReadAdapter(adapterInput(projectsRoot, first.record, first.runtime, {
        observed_at_ms: 59,
      })),
      assertAdapterError,
    );

    const unsafe = await readContext(10, {
      admission: {
        resource: {
          resource_kind: 'filesystem',
          project_id: PROJECT_ID,
          resource_id: 'project:/con',
        },
      },
    });
    await assert.rejects(
      () => readBuilderToolFilesystemReadAdapter(adapterInput(projectsRoot, unsafe.record, unsafe.runtime)),
      assertAdapterError,
    );

    fs.mkdirSync(path.join(projectsRoot, OTHER_PROJECT_UUID, 'src'), { recursive: true });
    const wrongProjectWorkspace = workspaceAdmission(projectsRoot, { project_id: OTHER_PROJECT_ID });
    await assert.rejects(
      () => readBuilderToolFilesystemReadAdapter({
        ...adapterInput(projectsRoot, first.record, first.runtime),
        project_workspace_admission: wrongProjectWorkspace,
      }),
      assertAdapterError,
    );

    const clonedWorkspaceAdmission = { ...workspaceAdmission(projectsRoot) };
    await assert.rejects(
      () => readBuilderToolFilesystemReadAdapter({
        ...adapterInput(projectsRoot, first.record, first.runtime),
        project_workspace_admission: clonedWorkspaceAdmission,
      }),
      assertAdapterError,
    );

    fs.writeFileSync(path.join(projectRoot, 'src', 'file-11.tsx'), 'before swap\n');
    const swapped = await readContext(11);
    const originalOpen = fsPromises.open;
    let swappedBeforeOpen = false;
    fsPromises.open = async function openWithSwap(targetPath, ...args) {
      if (!swappedBeforeOpen && targetPath.endsWith(`${path.sep}file-11.tsx`)) {
        swappedBeforeOpen = true;
        fs.writeFileSync(targetPath, 'after swap with a different size\n');
      }
      return Reflect.apply(originalOpen, this, [targetPath, ...args]);
    };
    try {
      await assert.rejects(
        () => readBuilderToolFilesystemReadAdapter(adapterInput(projectsRoot, swapped.record, swapped.runtime)),
        assertAdapterError,
      );
    } finally {
      fsPromises.open = originalOpen;
    }
    assert.equal(swappedBeforeOpen, true);

    let getterCalls = 0;
    const accessorInput = {
      project_workspace_admission: workspaceAdmission(projectsRoot),
      runtime_invocation_admission: first.runtime,
      tool_call_record: first.record,
      observed_at_ms: 70,
    };
    Object.defineProperty(accessorInput, 'project_workspace_admission', {
      enumerable: true,
      get() {
        getterCalls += 1;
        return workspaceAdmission(projectsRoot);
      },
    });
    await assert.rejects(
      () => readBuilderToolFilesystemReadAdapter(accessorInput),
      assertAdapterError,
    );
    await assert.rejects(
      () => readBuilderToolFilesystemReadAdapter(new Proxy(adapterInput(projectsRoot, first.record, first.runtime), {})),
      assertAdapterError,
    );
    assert.equal(getterCalls, 0);
  } finally {
    removeRoot(projectsRoot);
  }
});

test('source is a main-only read adapter with no IPC, provider, Git, or write authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-tool-filesystem-read-adapter.cjs'),
    'utf8',
  );
  assert.match(source, /builder-tool-filesystem-read-adapter\.v1/u);
  assert.match(source, /node:fs\/promises/u);
  assert.match(source, /node:path/u);
  assert.match(source, /TextDecoder\('utf-8', \{ fatal: true \}\)/u);
  assert.match(source, /createBuilderToolFilesystemReadOutputRecord/u);
  assert.match(source, /sanitizeBuilderToolProjectWorkspaceAdmission/u);
  assert.match(source, /project_workspace_admission/u);
  assert.match(source, /isSymbolicLink\(\)/u);
  assert.match(source, /handle\.stat\(\)/u);
  assert.match(source, /afterStats\.dev !== beforeStats\.dev/u);
  assert.match(source, /finalStats\.mtimeMs !== beforeStats\.mtimeMs/u);
  assert.match(source, /Buffer\.alloc\(maxRawOutputBytes \+ 1\)/u);
  assert.match(source, /handle\.read\(buffer, 0, maxRawOutputBytes \+ 1, 0\)/u);
  assert.doesNotMatch(
    source,
    /require\(['"]electron['"]\)|ipcMain|ipcRenderer|contextBridge|BrowserWindow|safeStorage|builder-provider|builder-git|builder-conversation|builder-project-main-authority|fetch\s*\(|https?:|Authorization|Bearer|child_process|execFile|spawn\s*\(|readFile|createReadStream|readdir|statSync|openSync|writeFile|appendFile|createWriteStream|unlink|rmSync|rm\s*\(|mkdir|eval\s*\(|new Function|shell:\s*true|persist_candidate_commit|write_current|commit_oid|tree_oid|provider_secret|credential_secret|credential_value|secret_ref|local-provider-executor|chat_planner|ChatCreatePage|Canvas|JobMeta/iu,
  );
});
