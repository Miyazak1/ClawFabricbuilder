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
  createBuilderAgentSupervisedActionAdmissionStore,
} = require('../electron/builder-agent-supervised-action-admission-store.cjs');
const {
  createBuilderToolPermissionAdmission,
} = require('../electron/builder-tool-permission-admission.cjs');
const {
  createBuilderToolProjectWorkspaceAuthority,
} = require('../electron/builder-tool-project-workspace-admission.cjs');
const {
  createBuilderToolSourceContextCollector,
} = require('../electron/builder-tool-source-context-collector.cjs');
const {
  BUILDER_AGENT_PRIVATE_SOURCE_CONTEXT_RECORD_STORE_VERSION,
  createBuilderAgentPrivateSourceContextRecordStore,
} = require('../electron/builder-agent-private-source-context-record-store.cjs');
const {
  BUILDER_AGENT_PRIVATE_SOURCE_CONTEXT_SERVICE_RESULT_VERSION,
  BUILDER_AGENT_PRIVATE_SOURCE_CONTEXT_SERVICE_VERSION,
  BuilderAgentPrivateSourceContextServiceError,
  createBuilderAgentPrivateSourceContextService,
} = require('../electron/builder-agent-private-source-context-service.cjs');

const OWNER_ID = 'builder-user:11111111-1111-4111-8111-111111111111';
const AGENT_ID = 'builder-agent:22222222-2222-4222-8222-222222222222';
const USER_ID = 'builder-user:12111111-1111-4111-8111-111111111111';
const PROJECT_UUID = '33333333-3333-4333-8333-333333333333';
const PROJECT_ID = `builder-project:${PROJECT_UUID}`;
const CONVERSATION_ID = `builder-conversation:${PROJECT_UUID}`;
const SUPERVISOR_ID = 'builder-supervisor:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const MESSAGE_ID = 'builder-message:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const MEMORY_ID = `builder-agent-memory:${'a'.repeat(64)}`;
const ARTIFACT_ID = `builder-artifact:${'b'.repeat(64)}`;
const RUN_EVENT_ID = `builder-run-event:${'c'.repeat(64)}`;
const PERMISSION_REF_ID = `builder-permission:${'d'.repeat(64)}`;
const GRANT_PERMISSION_ID = `builder-permission:${'e'.repeat(64)}`;
const REQUEST_DIGEST = `sha256:${'1'.repeat(64)}`;

function uuidFactory(start = 1) {
  let value = start;
  return () => {
    const suffix = value.toString(16).padStart(12, '0');
    value += 1;
    return `123e4567-e89b-42d3-a456-${suffix}`;
  };
}

function temporaryRoot(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function removeRoot(root) {
  fs.rmSync(root, { recursive: true, force: true });
}

function actionRequestId(index = 1) {
  return `builder-agent-action-request:123e4567-e89b-42d3-a456-${index.toString(16).padStart(12, '0')}`;
}

function definitionInput(overrides = {}) {
  return {
    record_version: BUILDER_AGENT_DEFINITION_RECORD_VERSION,
    agent_id: AGENT_ID,
    owner_id: OWNER_ID,
    display_name: 'Builder Agent',
    purpose: 'Read bounded project source before continuing supervised work.',
    created_at_ms: 1,
    ...overrides,
  };
}

function versionInput(overrides = {}) {
  return {
    record_version: BUILDER_AGENT_VERSION_RECORD_VERSION,
    agent_id: AGENT_ID,
    owner_id: OWNER_ID,
    version_number: 1,
    instructions: 'Use private project source only after supervised admission.',
    created_at_ms: 2,
    permission_boundary: 'explicit_permission_required',
    ...overrides,
  };
}

function createAdmissionForContext(context, action = 'read_private_source', index = 1) {
  const definition = createBuilderAgentDefinitionRecord(definitionInput());
  const version = createBuilderAgentVersionRecord(versionInput(), definition);
  const assignment = createBuilderAgentAssignmentRecord({
    record_version: BUILDER_AGENT_ASSIGNMENT_RECORD_VERSION,
    agent_id: AGENT_ID,
    agent_version_id: version.agent_version_id,
    owner_id: OWNER_ID,
    assigned_by: OWNER_ID,
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    task_id: context.ids.task_id,
    run_id: context.ids.run_id,
    goal: 'Collect private source context for the current supervised run.',
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
    task_id: context.ids.task_id,
    run_id: context.ids.run_id,
    lease_holder_id: SUPERVISOR_ID,
    lease_epoch: 1,
    acquired_at_ms: 20,
    expires_at_ms: 620,
    purpose: 'Supervise one private source context collection.',
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
    task_id: context.ids.task_id,
    run_id: context.ids.run_id,
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
  const admission = createBuilderAgentSupervisedActionAdmission({
    context_snapshot: snapshot,
    action_request_id: actionRequestId(index),
    requested_next_action: action,
    run_status: 'running',
    interrupt_requested: false,
    cancel_requested: false,
    admitted_at_ms: snapshot.created_at_ms + 2,
  });
  return { admission };
}

function fixture({
  action = 'read_private_source',
  index = 1,
  seedAdmission = true,
  denied = false,
  deniedResourceIds = [],
} = {}) {
  const root = temporaryRoot('clawfabric-builder-agent-private-source-context-service-');
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
  const context = conversation.begin_work({
    project_id: PROJECT_ID,
    instruction: 'Read source before the agent continues.',
    request_digest: REQUEST_DIGEST,
    base_revision: null,
  });
  const store = createBuilderAgentSupervisedActionAdmissionStore(
    path.join(root, 'action-admissions.sqlite'),
  );
  const recordStorePath = path.join(root, 'private-source-context-records.sqlite');
  const recordStore = createBuilderAgentPrivateSourceContextRecordStore(recordStorePath);
  const { admission } = createAdmissionForContext(context, action, index);
  if (seedAdmission) store.record_admission({ admission });
  const permissionCalls = [];
  const deniedResources = new Set(deniedResourceIds);
  const permissionAdmission = createBuilderToolPermissionAdmission({
    actor_id: AGENT_ID,
    now_ms: nowMs,
    evaluate_permission: async (body) => {
      const shouldDeny = denied || deniedResources.has(body.resource.resource_id);
      permissionCalls.push(body);
      return {
        decision_version: BUILDER_PERMISSION_DECISION_VERSION,
        policy_version: BUILDER_PERMISSION_POLICY_VERSION,
        actor_id: AGENT_ID,
        action: body.action,
        resource: body.resource,
        evaluated_at_ms: body.now_ms,
        decision: shouldDeny ? 'denied' : 'allowed',
        reason: shouldDeny ? 'no_matching_active_grant' : 'matching_active_grant',
        permission_id: shouldDeny ? null : GRANT_PERMISSION_ID,
        permission_authority: 'builder_permission_facts_deny_by_default_v1',
        ui_selection_authority: 'not_permission',
      };
    },
  });
  const collector = createBuilderToolSourceContextCollector({
    conversation_service: conversation,
    permission_admission: permissionAdmission,
    project_workspace_authority: createBuilderToolProjectWorkspaceAuthority({
      projects_root: projectsRoot,
    }),
    create_uuid: uuidFactory(100),
    now_ms: nowMs,
  });
  const service = createBuilderAgentPrivateSourceContextService({
    private_source_context_record_store: recordStore,
    supervised_action_admission_store: store,
    source_context_collector: collector,
  });
  return {
    root,
    database,
    projectRoot,
    conversation,
    context,
    admission,
    recordStore,
    recordStorePath,
    store,
    permissionCalls,
    service,
    close() {
      try { store.close(); } catch { /* best-effort test cleanup */ }
      try { this.recordStore?.close(); } catch { /* best-effort test cleanup */ }
      database.close();
      removeRoot(root);
    },
  };
}

function request(item, overrides = {}) {
  return {
    owner_id: overrides.owner_id ?? OWNER_ID,
    supervised_action_admission_id:
      overrides.supervised_action_admission_id ?? item.admission.admission_id,
    context: overrides.context ?? item.context,
    resource_ids: overrides.resource_ids ?? ['project:/src/app.tsx'],
  };
}

function tamperContext(context, ids) {
  return {
    ...context,
    ids: {
      ...context.ids,
      ...ids,
    },
  };
}

function assertServiceError(error, code = 'builder_agent_private_source_context_service_invalid') {
  assert.equal(error instanceof BuilderAgentPrivateSourceContextServiceError, true);
  assert.equal(error.code, code);
  assert.doesNotMatch(
    `${error.message}\n${error.stack}`,
    /export const|secret|credential|api[_-]?key|Authorization|Bearer|permission_id|private_source_context|src\/app\.tsx|raw output/iu,
  );
  return true;
}

test('collects private source context only from a store-backed read-private-source action admission', async () => {
  const item = fixture();
  try {
    fs.writeFileSync(path.join(item.projectRoot, 'src', 'app.tsx'), 'export const answer = 42;\n');

    const result = await item.service.collect_agent_private_source_context(request(item));

    assert.equal(result.result_version, BUILDER_AGENT_PRIVATE_SOURCE_CONTEXT_SERVICE_RESULT_VERSION);
    assert.equal(result.service_version, BUILDER_AGENT_PRIVATE_SOURCE_CONTEXT_SERVICE_VERSION);
    assert.equal(result.operation, 'agent_private_source_context_collected');
    assert.equal(result.status, 'succeeded');
    assert.equal(result.requested_next_action, 'read_private_source');
    assert.equal(result.next_gate, 'source_context_collector_required_later');
    assert.equal(result.supervised_action_admission.admission_id, item.admission.admission_id);
    assert.equal(result.supervised_action_admission_read.status, 'ready');
    assert.equal(result.action_task_admissions.supervised_action_admissions.length, 1);
    assert.equal(result.action_run_admissions.supervised_action_admissions.length, 1);
    assert.deepEqual(result.resource_ids, ['project:/src/app.tsx']);
    assert.equal(result.source_context_result.result_version, 'builder-tool-source-context-result.v1');
    assert.equal(result.source_context_result.operation, 'project_source_context_collected');
    assert.equal(result.source_context_result.context.ids.task_id, item.context.ids.task_id);
    assert.equal(result.source_context_result.context.ids.run_id, item.context.ids.run_id);
    assert.deepEqual(
      result.source_context_result.private_source_context.files.map((file) => [file.path, file.content]),
      [['src/app.tsx', 'export const answer = 42;\n']],
    );
    assert.equal(result.private_source_context_record.owner_id, OWNER_ID);
    assert.equal(result.private_source_context_record.project_id, PROJECT_ID);
    assert.equal(result.private_source_context_record.task_id, item.context.ids.task_id);
    assert.equal(result.private_source_context_record.run_id, item.context.ids.run_id);
    assert.equal(result.private_source_context_record.source_context_status, 'succeeded');
    assert.equal(result.private_source_context_record.resource_count, 1);
    assert.equal(result.private_source_context_record.file_count, 1);
    assert.equal(result.private_source_context_record_store_write.operation, 'agent_private_source_context_record_recorded');
    assert.equal(result.private_source_context_record_read.status, 'ready');
    assert.equal(result.admission_private_source_context_record_read.status, 'ready');
    assert.equal(result.task_private_source_context_records.status, 'ready');
    assert.equal(result.task_private_source_context_records.agent_private_source_context_records.length, 1);
    assert.equal(result.run_private_source_context_records.status, 'ready');
    assert.equal(result.run_private_source_context_records.agent_private_source_context_records.length, 1);
    assert.equal(result.operations.private_source_context_record_store, 'agent_private_source_context_record_recorded');
    assert.equal(
      result.private_source_context_record.authority.source_access,
      'digest_only_private_source_context_receipt',
    );
    assert.doesNotMatch(
      JSON.stringify(result.private_source_context_record),
      /src\/app\.tsx|export const answer|"private_source_context"|"resource_id"|provider_secret|credential_secret|commit_oid|tree_oid/iu,
    );
    assert.equal(result.evidence.service_authority, 'main_owned_agent_private_source_context_service');
    assert.equal(result.evidence.source_context_collector_authority, 'main_tool_source_context_collector_v1');
    assert.equal(
      result.evidence.private_source_context_record_store_authority,
      'main_owned_agent_private_source_context_record_store',
    );
    assert.equal(
      result.evidence.private_source_context_record_authority,
      'main_agent_private_source_context_record_contract_v1',
    );
    assert.equal(result.evidence.renderer_authority, 'not_present');
    assert.equal(result.evidence.provider_dispatch, false);
    assert.equal(result.evidence.model_dispatch, false);
    assert.equal(result.evidence.source_access, 'private_main_only_collector_result');
    assert.equal(result.evidence.source_write, 'not_present');
    assert.equal(result.evidence.revision_authority, false);
    assert.equal(result.evidence.private_source_context_record_storage, 'digest_only_receipt_store');

    const stream = item.conversation.read_stream({ project_id: PROJECT_ID });
    assert.equal(stream.conversation.head_sequence, 4);
    assert.equal(stream.conversation.items.filter((entry) => entry.item_kind === 'tool_call_requested').length, 1);
    assert.equal(
      stream.conversation.items.filter((entry) => entry.item_kind === 'tool_call_result_recorded').length,
      1,
    );
    assert.doesNotMatch(
      JSON.stringify(stream),
      /export const answer|src\/app\.tsx|private_source_context|permission_id|record_digest|policy_digest|provider|credential|commit_oid|tree_oid/iu,
    );
    assert.equal(item.permissionCalls.length, 1);
    await assert.rejects(
      item.service.collect_agent_private_source_context(request(item)),
      (error) => assertServiceError(error, 'builder_agent_private_source_context_service_conflict'),
    );
    assert.equal(item.permissionCalls.length, 1);
    assert.equal(item.conversation.read_stream({ project_id: PROJECT_ID }).conversation.head_sequence, 4);

    item.recordStore.close();
    item.recordStore = null;
    const restartedRecordStore = createBuilderAgentPrivateSourceContextRecordStore(item.recordStorePath);
    try {
      assert.equal(restartedRecordStore.store_version, BUILDER_AGENT_PRIVATE_SOURCE_CONTEXT_RECORD_STORE_VERSION);
      const restored = restartedRecordStore.read_private_source_context_for_admission({
        supervised_action_admission_id: item.admission.admission_id,
        owner_id: OWNER_ID,
      });
      assert.equal(restored.status, 'ready');
      assert.deepEqual(
        restored.agent_private_source_context_record.private_source_context_record,
        result.private_source_context_record,
      );
    } finally {
      restartedRecordStore.close();
    }
  } finally {
    item.close();
  }
});

test('fails closed without a read-private-source admission or when context and resources drift', async () => {
  const missing = fixture({ seedAdmission: false, index: 2 });
  try {
    await assert.rejects(
      missing.service.collect_agent_private_source_context(request(missing)),
      (error) => assertServiceError(error, 'builder_agent_private_source_context_service_conflict'),
    );
  } finally {
    missing.close();
  }

  const wrongAction = fixture({ action: 'call_tool', index: 3 });
  try {
    await assert.rejects(
      wrongAction.service.collect_agent_private_source_context(request(wrongAction)),
      (error) => assertServiceError(error),
    );
  } finally {
    wrongAction.close();
  }

  const drift = fixture({ index: 4 });
  try {
    await assert.rejects(
      drift.service.collect_agent_private_source_context(request(drift, {
        context: tamperContext(drift.context, {
          run_id: 'builder-run:99999999-9999-4999-8999-999999999999',
        }),
      })),
      (error) => assertServiceError(error),
    );
    await assert.rejects(
      drift.service.collect_agent_private_source_context(request(drift, {
        owner_id: USER_ID,
      })),
      (error) => assertServiceError(error, 'builder_agent_private_source_context_service_conflict'),
    );
    await assert.rejects(
      drift.service.collect_agent_private_source_context(request(drift, {
        resource_ids: ['project:/src/app.tsx', 'project:/src/app.tsx'],
      })),
      (error) => assertServiceError(error),
    );
    assert.equal(drift.permissionCalls.length, 0);
    assert.equal(drift.conversation.read_stream({ project_id: PROJECT_ID }).conversation.head_sequence, 2);
  } finally {
    drift.close();
  }
});

test('normalizes collector denial and hostile requests without leaking or appending partial facts', async () => {
  const denied = fixture({ denied: true, index: 5 });
  try {
    await assert.rejects(
      denied.service.collect_agent_private_source_context(request(denied)),
      (error) => assertServiceError(error, 'builder_agent_private_source_context_service_unavailable'),
    );
    assert.equal(denied.permissionCalls.length, 1);
    assert.equal(denied.conversation.read_stream({ project_id: PROJECT_ID }).conversation.head_sequence, 2);
  } finally {
    denied.close();
  }

  const item = fixture({ index: 6 });
  try {
    let getterCalls = 0;
    const hostile = request(item);
    Object.defineProperty(hostile, 'resource_ids', {
      enumerable: true,
      get() {
        getterCalls += 1;
        return ['project:/src/app.tsx'];
      },
    });
    await assert.rejects(
      item.service.collect_agent_private_source_context(hostile),
      (error) => assertServiceError(error),
    );
    await assert.rejects(
      item.service.collect_agent_private_source_context(new Proxy(request(item), {})),
      (error) => assertServiceError(error),
    );
    assert.equal(getterCalls, 0);
    assert.equal(item.permissionCalls.length, 0);
    assert.equal(item.conversation.read_stream({ project_id: PROJECT_ID }).conversation.head_sequence, 2);
  } finally {
    item.close();
  }
});

test('source boundary stays main-only and exposes no renderer, provider, Git, or write authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-agent-private-source-context-service.cjs'),
    'utf8',
  );

  assert.match(source, /builder-agent-private-source-context-service\.v1/u);
  assert.match(source, /main_owned_agent_private_source_context_service/u);
  assert.match(source, /main_owned_agent_supervised_action_admission_store/u);
  assert.match(source, /main_tool_source_context_collector_v1/u);
  assert.match(source, /main_owned_agent_private_source_context_record_store/u);
  assert.match(source, /main_agent_private_source_context_record_contract_v1/u);
  assert.match(source, /record_private_source_context/u);
  assert.match(source, /read_private_source_context_for_admission/u);
  assert.match(source, /list_task_private_source_contexts/u);
  assert.match(source, /list_run_private_source_contexts/u);
  assert.match(source, /admission\.requested_next_action !== 'read_private_source'/u);
  assert.match(source, /source_context_collector_required_later/u);
  assert.match(source, /collect_project_source_context/u);
  assert.match(source, /private_main_only_collector_result/u);
  assert.match(source, /digest_only_receipt_store/u);
  assert.match(source, /source_write: 'not_present'/u);
  assert.doesNotMatch(
    source,
    /require\(['"](?:electron|node:fs|fs|node:http|node:https|http|https|node:child_process|child_process)['"]\)|ipcMain|ipcRenderer|contextBridge|BrowserWindow|safeStorage|builder-provider|builder-git|fetch\s*\(|https?:|Authorization|Bearer|execFile|spawn\s*\(|writeFile|readFile|createReadStream|eval\s*\(|new Function|shell:\s*true|record_grant|record_revocation|provider_secret|credential_secret|commit_oid|tree_oid|stdout|stderr|local-provider-executor|chat_planner|ChatCreatePage|Canvas|JobMeta/iu,
  );
});
