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
  createBuilderToolProjectWorkspaceAuthority,
} = require('../electron/builder-tool-project-workspace-admission.cjs');
const {
  BUILDER_TOOL_SOURCE_CONTEXT_COLLECTOR_VERSION,
  BuilderToolSourceContextCollectorError,
  createBuilderToolSourceContextCollector,
} = require('../electron/builder-tool-source-context-collector.cjs');

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

function fixture({ denied = false, deniedResourceIds = [] } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cfb-source-context-'));
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
  const permissionCalls = [];
  const deniedResources = new Set(deniedResourceIds);
  const permissionAdmission = createBuilderToolPermissionAdmission({
    actor_id: ACTOR_ID,
    now_ms: nowMs,
    evaluate_permission: async (body) => {
      const shouldDeny = denied || deniedResources.has(body.resource.resource_id);
      permissionCalls.push(body);
      return {
        decision_version: BUILDER_PERMISSION_DECISION_VERSION,
        policy_version: BUILDER_PERMISSION_POLICY_VERSION,
        actor_id: ACTOR_ID,
        action: body.action,
        resource: body.resource,
        evaluated_at_ms: body.now_ms,
        decision: shouldDeny ? 'denied' : 'allowed',
        reason: shouldDeny ? 'no_matching_active_grant' : 'matching_active_grant',
        permission_id: shouldDeny ? null : PERMISSION_ID,
        permission_authority: 'builder_permission_facts_deny_by_default_v1',
        ui_selection_authority: 'not_permission',
      };
    },
  });
  const collector = createBuilderToolSourceContextCollector({
    conversation_service: conversation,
    permission_admission: permissionAdmission,
    project_workspace_authority: workspace,
    create_uuid: uuidFactory(100),
    now_ms: nowMs,
  });
  return {
    root,
    database,
    projectRoot,
    conversation,
    collector,
    permissionCalls,
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

function assertCollectorError(error) {
  assert.equal(error instanceof BuilderToolSourceContextCollectorError, true);
  assert.equal(error.code, 'builder_tool_source_context_collector_unavailable');
  assert.equal(error.message, 'The project source context could not be collected.');
  assert.equal(error.retryable, false);
  assert.doesNotMatch(`${error.message}\n${error.stack}`, /src\/app|secret|api[_-]?key|Authorization|Bearer/iu);
  return true;
}

test('collects bounded project source through permission, tool request, execution, and fixed public results', async () => {
  const item = fixture();
  try {
    fs.writeFileSync(path.join(item.projectRoot, 'src', 'app.tsx'), 'export const answer = 42;\n');
    fs.writeFileSync(path.join(item.projectRoot, 'src', 'util.ts'), 'export const label = "ready";\n');
    const context = begin(item.conversation);

    const result = await item.collector.collect_project_source_context({
      context,
      resource_ids: ['project:/src/app.tsx', 'project:/src/util.ts'],
    });

    assert.equal(item.collector.collector_version, BUILDER_TOOL_SOURCE_CONTEXT_COLLECTOR_VERSION);
    assert.equal(result.result_version, 'builder-tool-source-context-result.v1');
    assert.equal(result.operation, 'project_source_context_collected');
    assert.equal(result.status, 'succeeded');
    assert.equal(result.authority.collector_authority, 'main_tool_source_context_collector_v1');
    assert.equal(result.authority.renderer_authority, 'not_present');
    assert.equal(result.authority.provider_dispatch, false);
    assert.equal(result.authority.revision_admission, 'not_created');
    assert.equal(result.private_source_context.context_version, 'builder-private-source-context.v1');
    assert.deepEqual(
      result.private_source_context.files.map((file) => [file.path, file.content]),
      [
        ['src/app.tsx', 'export const answer = 42;\n'],
        ['src/util.ts', 'export const label = "ready";\n'],
      ],
    );
    assert.deepEqual(item.permissionCalls.map((call) => call.resource.resource_id), [
      'project:/src/app.tsx',
      'project:/src/util.ts',
    ]);
    assert.equal(result.context.start_head.sequence, 6);

    const stream = item.conversation.read_stream({ project_id: PROJECT_ID });
    assert.equal(stream.conversation.head_sequence, 6);
    assert.equal(stream.conversation.items.filter((entry) => entry.item_kind === 'tool_call_requested').length, 2);
    assert.equal(
      stream.conversation.items.filter((entry) => entry.item_kind === 'tool_call_result_recorded').length,
      2,
    );
    const publicText = JSON.stringify(stream);
    assert.doesNotMatch(
      publicText,
      /export const answer|ready|src\/app\.tsx|src\/util\.ts|permission_id|private_source_context|runtime_invocation|adapter_selection|dispatch_request|record_digest|policy_digest|provider|credential|commit_oid|tree_oid/iu,
    );
  } finally {
    item.close();
  }
});

test('records a fixed failed result for an admitted missing project file without leaking raw details', async () => {
  const item = fixture();
  try {
    const context = begin(item.conversation);
    const result = await item.collector.collect_project_source_context({
      context,
      resource_ids: ['project:/src/missing.ts'],
    });

    assert.equal(result.status, 'failed');
    assert.deepEqual(result.private_source_context.files, []);
    assert.deepEqual(result.reads.map((read) => read.status), ['failed']);
    assert.equal(result.context.start_head.sequence, 4);

    const stream = item.conversation.read_stream({ project_id: PROJECT_ID });
    assert.equal(stream.conversation.head_sequence, 4);
    assert.equal(stream.conversation.items[3].item_kind, 'tool_call_result_recorded');
    assert.equal(stream.conversation.items[3].result.status, 'failed');
    assert.equal(stream.conversation.items[3].result.summary_code, 'adapter_unavailable');
    assert.doesNotMatch(
      JSON.stringify(stream),
      /missing\.ts|ENOENT|no such file|private_source_context|runtime_invocation|permission_id|record_digest|policy_digest/iu,
    );
  } finally {
    item.close();
  }
});

test('denies before recording tool facts and rejects hostile collector requests without partial events', async () => {
  const denied = fixture({ denied: true });
  try {
    const context = begin(denied.conversation);
    await assert.rejects(
      denied.collector.collect_project_source_context({
        context,
        resource_ids: ['project:/src/app.tsx'],
      }),
      assertCollectorError,
    );
    assert.equal(denied.permissionCalls.length, 1);
    assert.equal(denied.conversation.read_stream({ project_id: PROJECT_ID }).conversation.head_sequence, 2);
  } finally {
    denied.close();
  }

  const mixed = fixture({ deniedResourceIds: ['project:/src/blocked.ts'] });
  try {
    const context = begin(mixed.conversation);
    fs.writeFileSync(path.join(mixed.projectRoot, 'src', 'app.tsx'), 'export const allowed = true;\n');
    await assert.rejects(
      mixed.collector.collect_project_source_context({
        context,
        resource_ids: ['project:/src/app.tsx', 'project:/src/blocked.ts'],
      }),
      assertCollectorError,
    );
    assert.deepEqual(mixed.permissionCalls.map((call) => call.resource.resource_id), [
      'project:/src/app.tsx',
      'project:/src/blocked.ts',
    ]);
    assert.equal(mixed.conversation.read_stream({ project_id: PROJECT_ID }).conversation.head_sequence, 2);
  } finally {
    mixed.close();
  }

  const item = fixture();
  try {
    const context = begin(item.conversation);
    let getterCalls = 0;
    const accessorRequest = {};
    Object.defineProperties(accessorRequest, {
      context: {
        enumerable: true,
        value: context,
      },
      resource_ids: {
        enumerable: true,
        get() {
          getterCalls += 1;
          return ['project:/src/app.tsx'];
        },
      },
    });
    for (const invalid of [
      null,
      {},
      { context, resource_ids: [] },
      { context, resource_ids: ['project:/src/app.tsx', 'project:/src/app.tsx'] },
      { context, resource_ids: ['project:/../secret.txt'] },
      { context: { ...context, mode: 'question' }, resource_ids: ['project:/src/app.tsx'] },
      accessorRequest,
      new Proxy({ context, resource_ids: ['project:/src/app.tsx'] }, {
        getPrototypeOf() {
          throw new Error('private proxy marker');
        },
      }),
    ]) {
      await assert.rejects(
        item.collector.collect_project_source_context(invalid),
        assertCollectorError,
      );
    }
    assert.equal(getterCalls, 0);
    assert.equal(item.permissionCalls.length, 0);
    assert.equal(item.conversation.read_stream({ project_id: PROJECT_ID }).conversation.head_sequence, 2);
  } finally {
    item.close();
  }
});

test('source collector remains main-only and depends only on prior tool contracts', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-tool-source-context-collector.cjs'),
    'utf8',
  );
  assert.match(source, /builder-tool-source-context-collector\.v1/u);
  assert.match(source, /main_tool_source_context_collector_v1/u);
  assert.match(source, /createBuilderToolSessionPolicy/u);
  assert.match(source, /createBuilderToolCallRecord/u);
  assert.match(source, /createBuilderToolFilesystemReadExecutionService/u);
  assert.match(source, /record_tool_call_request/u);
  assert.match(source, /tool_request_and_fixed_result_only/u);
  assert.doesNotMatch(
    source,
    /require\(['"](?:node:fs|node:fs\/promises|fs|fs\/promises|node:path|path|node:process|process)['"]\)|\bprocess\.|ipcMain|ipcRenderer|contextBridge|BrowserWindow|safeStorage|providerConfig|resolveSecret|secret_ref|api[_-]?key|bearer|fetch\(|node:http|node:https|child_process|worker_threads|\beval\s*\(|new Function|repository\.commit|createRevision|save_version|readFile|createReadStream|writeFile|appendFile|unlink|rm\(|mkdir|legacy|chat_planner|ChatCreatePage|Canvas|JobMeta/iu,
  );
});
