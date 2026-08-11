'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  APPROVED_PLAN_READ_RESULT_VERSION,
  createBuilderConversationMainService,
} = require('../electron/builder-conversation-main-service.cjs');
const {
  BUILDER_PERMISSION_DECISION_VERSION,
  BUILDER_PERMISSION_POLICY_VERSION,
} = require('../electron/builder-permission-authority-contract.cjs');
const {
  createBuilderProductMetadataDatabase,
} = require('../electron/builder-product-metadata-database.cjs');
const {
  replayBuilderConversation,
} = require('../electron/builder-conversation-replay.cjs');
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
  createBuilderToolResultRecord,
} = require('../electron/builder-tool-result-records.cjs');
const {
  FILESYSTEM_READ_TOOL_ADAPTER_ID,
  createBuilderToolAdapterSelectionAdmission,
} = require('../electron/builder-tool-adapter-selection-admission.cjs');
const {
  FILESYSTEM_READ_TOOL_RUNTIME_ID,
  createBuilderToolRuntimeInvocationAdmission,
} = require('../electron/builder-tool-runtime-invocation-admission.cjs');
const {
  createBuilderProjectSourceTree,
} = require('../electron/builder-project-source-tree.cjs');
const {
  createBuilderPlanProposalRecord,
} = require('../electron/builder-plan-proposal-records.cjs');
const {
  BUILDER_APPROVED_PLAN_CONTINUATION_ADMISSION_VERSION,
  createBuilderApprovedPlanContinuationAdmission,
  sanitizeBuilderApprovedPlanContinuationAdmission,
} = require('../electron/builder-approved-plan-continuation-admission.cjs');
const {
  createBuilderExecutionApproval,
} = require('../electron/builder-execution-approval.cjs');
const {
  createBuilderProgrammingRunAdmission,
} = require('../electron/builder-programming-run-admission.cjs');
const {
  createBuilderDraftContinuationAdmission,
} = require('../electron/builder-draft-continuation-admission.cjs');
const {
  createBuilderAgentStepProgressConversationAdmission,
} = require('../electron/builder-agent-step-progress-conversation-admission.cjs');
const {
  createBuilderWorkingContextState,
} = require('../electron/builder-working-context-state.cjs');

const PROJECT_ID = 'builder-project:11111111-1111-4111-8111-111111111111';
const REQUEST_DIGEST = `sha256:${'1'.repeat(64)}`;
const QUESTION_DIGEST = `sha256:${'0'.repeat(64)}`;
const CANDIDATE_DIGEST = `sha256:${'2'.repeat(64)}`;
const DRAFT_CONTINUATION_REQUEST_DIGEST = `sha256:${'d'.repeat(64)}`;
const TOOL_ACTOR_ID = 'builder-user:11111111-1111-4111-8111-111111111112';
const TOOL_CALL_ID = 'builder-tool-call:11111111-1111-4111-8111-111111111113';
const TOOL_STEP_ID = 'builder-run-step:11111111-1111-4111-8111-111111111114';
const AGENT_STEP_ID = 'builder-run-step:11111111-1111-4111-8111-111111111115';
const TOOL_PERMISSION_ID = `builder-permission:${'a'.repeat(64)}`;
const BASE_REVISION = Object.freeze({
  revision_receipt_digest: `sha256:${'3'.repeat(64)}`,
  commit_oid: '4'.repeat(40),
});
const COMPACTION_REF = Object.freeze({
  summary_digest: `sha256:${'5'.repeat(64)}`,
  source_range_digest: `sha256:${'6'.repeat(64)}`,
  compacted_at_ms: 998,
});
const HANDOFF_REF = Object.freeze({
  packet_digest: `sha256:${'7'.repeat(64)}`,
  inserted_at_ms: 997,
  adopted_at_ms: 999,
});

function uuidFactory(start = 1) {
  let value = start;
  return () => {
    const suffix = value.toString(16).padStart(12, '0');
    value += 1;
    return `00000000-0000-4000-8000-${suffix}`;
  };
}

function removeRoot(root) {
  let lastError = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      fs.rmSync(root, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      if (!error || typeof error !== 'object' || !['EBUSY', 'ENOTEMPTY', 'EPERM'].includes(error.code)) {
        throw error;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25 * (attempt + 1));
    }
  }
  if (lastError instanceof Error) throw lastError;
  throw new Error('Temporary test directory could not be removed.');
}

function fixture(uuidStart = 1, nowStart = 1_000, overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cfb-cms-'));
  const database = createBuilderProductMetadataDatabase(path.join(root, 'builder.sqlite'));
  let now = nowStart;
  const service = createBuilderConversationMainService({
    metadataAuthority: database,
    createUuid: uuidFactory(uuidStart),
    nowMs: () => now++,
    ...overrides,
  });
  return {
    root,
    database,
    service,
    setNow(next) {
      now = next;
    },
    close() {
      database.close();
      removeRoot(root);
    },
  };
}

function begin(service, baseRevision = null, instruction = 'Build a focused timer') {
  return service.begin_work({
    project_id: PROJECT_ID,
    instruction,
    request_digest: REQUEST_DIGEST,
    base_revision: baseRevision,
  });
}

function contextStatusProjection(overrides = {}) {
  const base = {
    projection_version: 'builder-context-status-projection.v1',
    label: 'Handoff received',
    tone: 'warning',
    next_action_hint: 'Review the handoff before the next change.',
    has_pending_handoff: true,
    pending_handoff_count: 1,
    needs_confirmation: true,
    can_contextual_execute: false,
    authority: {
      projection_authority: 'main_owned_context_status_projection_v1',
      working_context_state: 'verified_not_exposed',
      pending_handoff_packets: 'pending_count_only',
      renderer_authority: 'not_present',
      ipc_authority: 'not_present',
      provider_dispatch: false,
      tool_dispatch: false,
      source_read: 'not_present',
      source_write: 'not_present',
      git_mutation: false,
      permission_grant: false,
      revision_admission: 'not_created',
      secret_access: 'not_present',
    },
  };
  return {
    ...base,
    ...overrides,
    authority: {
      ...base.authority,
      ...(overrides.authority ?? {}),
    },
  };
}

function providerContextDisclosureStatusProjection(overrides = {}) {
  const base = {
    projection_version: 'builder-provider-context-disclosure-status-projection.v1',
    label: 'Allow AI to use current context',
    tone: 'warning',
    next_action_hint: 'Review this before Builder shares the current task context.',
    needs_user_approval: true,
    can_use_provider_context: false,
    blocked_reason: 'context_disclosure_not_approved',
    request_available: true,
    inspection: {
      title: 'Share current task context with the configured AI provider',
      summary: 'Allow Builder to build with current context using a bounded local context summary.',
      details: 'This request does not include source files, secrets, ids, digests, or raw context text.',
      purpose: 'contextual_build',
      provider_scope: 'configured_provider',
      context_surface: {
        working_context_state_status: 'approved_plan_ready',
        segment_count: 3,
        segment_kinds: ['latest_user_message', 'working_context_objective', 'approved_plan'],
        omitted_ref_count: 0,
        budget: {
          used_prompt_bytes: 512,
          max_prompt_bytes: 4096,
          reserved_response_bytes: 1024,
        },
        permission_gate: {
          workspace_state: 'bound',
          write_permission: 'ask',
          side_effect_ready: false,
        },
      },
    },
    authority: {
      projection_authority: 'main_owned_provider_context_disclosure_status_projection_v1',
      disclosure_request_preparation: 'verified_safe_inspection_only',
      renderer_authority: 'not_present',
      provider_context_body: 'not_present',
      provider_dispatch: false,
      tool_dispatch: false,
      source_read: 'not_present',
      source_write: 'not_present',
      git_mutation: false,
      sqlite_write: false,
      permission_grant: false,
      revision_admission: 'not_created',
      secret_access: 'not_present',
    },
  };
  return {
    ...base,
    ...overrides,
    authority: {
      ...base.authority,
      ...(overrides.authority ?? {}),
    },
  };
}

function draftCheckpointStatusProjection() {
  return {
    projection_version: 'builder-draft-checkpoint-status-projection.v1',
    status: 'ready',
    label: 'Checkpoint saved',
    tone: 'success',
    next_action_hint: 'You can compare, restore, continue, or save a version.',
    can_compare: true,
    can_restore: true,
    can_save_version: true,
    changed_file_count: 2,
    verification_status: 'candidate_verified',
    authority: {
      projection_authority: 'main_owned_draft_checkpoint_status_projection_v1',
      checkpoint_store_read: 'verified_latest_read_result',
      checkpoint_fact: 'verified_not_exposed',
      renderer_authority: 'not_present',
      ipc_authority: 'not_present',
      provider_dispatch: false,
      tool_dispatch: false,
      source_read: 'not_present',
      source_write: 'not_present',
      git_read: 'not_present',
      git_write: false,
      sqlite_write: false,
      permission_grant: false,
      revision_admission: 'not_created',
      save_authority: false,
      publication: false,
    },
  };
}

function checkRunStatusProjection(status = 'passed') {
  const details = status === 'passed'
    ? {
      label: 'Checked',
      summary: 'The project check completed successfully.',
    }
    : {
      label: 'Check failed',
      summary: 'The project check found a problem that needs review.',
    };
  return {
    projection_version: 'builder-check-run-status-projection.v1',
    project_id: PROJECT_ID,
    candidate_id: `builder-code-change-candidate:${'6'.repeat(64)}`,
    check_run_id: `builder-check-run:${'a'.repeat(64)}`,
    command_kind: 'test',
    command_label: 'Tests',
    status,
    ...details,
    completed_at_ms: 1_020,
    result_digest: `sha256:${'b'.repeat(64)}`,
    authority: {
      projection_authority: 'main_owned_check_run_status_projection_v1',
      check_run_authority: 'verified_check_run_contract',
      renderer_authority: 'read_only_projection',
      ipc_authority: 'projection_only',
      raw_output: 'not_present',
      runtime_paths: 'not_present',
      provider_dispatch: false,
      command_execution: false,
      source_write: 'not_present',
      git_write: false,
      sqlite_write: false,
      save_authority: false,
    },
  };
}

function beginQuestion(service, baseRevision = null, question = 'What changed in this project?') {
  return service.begin_question({
    project_id: PROJECT_ID,
    question,
    request_digest: QUESTION_DIGEST,
    base_revision: baseRevision,
  });
}

function agentProgressProjectionAuthority() {
  return {
    agent_step_source: 'main_owned_step_start_and_result_store_projection',
    step_start_receipt: 'verified_not_exposed',
    step_result_receipt: 'verified_not_exposed',
    renderer_authority: 'not_present',
    ipc_authority: 'not_present',
    provider_dispatch: false,
    model_dispatch: false,
    tool_dispatch: false,
    step_execution: false,
    permission_grant_authority: false,
    credential_storage: 'not_present',
    source_access: 'not_present',
    source_read: 'not_present',
    source_write: 'not_present',
    process_run: false,
    network_access: false,
    revision_authority: false,
    review_authority: false,
    artifact_authority: false,
    raw_output_storage: false,
    raw_context_storage: false,
  };
}

function agentProgressReadEvidence() {
  return {
    service_authority: 'main_owned_agent_step_progress_read_service',
    projection_authority: 'main_owned_step_start_and_result_store_projection',
    step_start_store_authority: 'main_owned_agent_step_start_store',
    step_result_store_authority: 'main_owned_agent_step_result_store',
    step_start_receipt: 'verified_not_exposed',
    step_result_receipt: 'verified_not_exposed',
    renderer_authority: 'not_present',
    ipc_authority: 'not_present',
    provider_dispatch: false,
    model_dispatch: false,
    tool_dispatch: false,
    step_execution: false,
    permission_grant_authority: false,
    credential_storage: 'not_present',
    source_access: 'not_present',
    source_read: 'not_present',
    source_write: 'not_present',
    process_run: false,
    network_access: false,
    revision_authority: false,
    review_authority: false,
    artifact_authority: false,
    raw_output_storage: false,
    raw_context_storage: false,
    recovery_model: 'read_only_store_projection_replay',
  };
}

function agentProgressItem(recordedState = 'start_recorded') {
  if (recordedState === 'start_recorded') {
    return {
      item_kind: 'agent_step_progress',
      step_id: AGENT_STEP_ID,
      step_index: 1,
      recorded_state: 'start_recorded',
      result: null,
      summary: {
        status: 'started',
        display_summary: 'Agent step start was recorded.',
      },
    };
  }
  return {
    item_kind: 'agent_step_progress',
    step_id: AGENT_STEP_ID,
    step_index: 1,
    recorded_state: 'result_recorded',
    result: {
      status: 'succeeded',
      summary_code: 'agent_step_completed_without_raw_output',
      display_summary: 'Agent step completed. Details were not kept.',
    },
    summary: {
      status: 'succeeded',
      display_summary: 'Agent step completed. Details were not kept.',
    },
  };
}

function agentProgressReadResult(context, items) {
  const resultCount = items.filter((item) => item.result !== null).length;
  return {
    result_version: 'builder-agent-step-progress-read-service-result.v1',
    service_version: 'builder-agent-step-progress-read-service.v1',
    operation: 'agent_step_progress_projected',
    status: 'ready',
    projection: {
      projection_version: 'builder-agent-step-progress-projection.v1',
      project_id: PROJECT_ID,
      task_id: context.ids.task_id,
      run_id: context.ids.run_id,
      progress: {
        window: {
          first_step_index: items[0].step_index,
          last_step_index: items.at(-1).step_index,
          has_earlier: false,
        },
        items,
      },
      authority: agentProgressProjectionAuthority(),
    },
    read_summary: {
      step_start_status: 'ready',
      step_result_status: resultCount === 0 ? 'absent' : 'ready',
      step_start_count: items.length,
      step_result_count: resultCount,
      truncated: false,
    },
    evidence: agentProgressReadEvidence(),
  };
}

function agentProgressAdmission(
  context,
  recordedState = 'start_recorded',
  overrides = {},
) {
  const items = overrides.items ?? (
    recordedState === 'start_recorded'
      ? [agentProgressItem('start_recorded')]
      : [agentProgressItem('result_recorded')]
  );
  return createBuilderAgentStepProgressConversationAdmission({
    project_id: overrides.project_id ?? PROJECT_ID,
    conversation_id: overrides.conversation_id ?? context.conversation.conversation_id,
    turn_id: overrides.turn_id ?? context.ids.turn_id,
    task_id: overrides.task_id ?? context.ids.task_id,
    run_id: overrides.run_id ?? context.ids.run_id,
    run_status: overrides.run_status ?? 'running',
    interrupt_requested: overrides.interrupt_requested ?? false,
    cancel_requested: overrides.cancel_requested ?? false,
    read_result: overrides.read_result ?? agentProgressReadResult(context, items),
    step_id: overrides.step_id ?? AGENT_STEP_ID,
    step_index: overrides.step_index ?? 1,
    recorded_state: recordedState,
    admitted_at_ms: overrides.admitted_at_ms ?? 50,
  });
}

function candidateResult(context) {
  return {
    draft_id: `builder-generation-draft:${'5'.repeat(64)}`,
    title: 'Focused timer',
    summary: 'A focused timer draft.',
    git_candidate_receipt: {
      receipt_version: 'builder-git-candidate-receipt.v1',
      repository_version: 'builder-git-project-repository.v1',
      project_id: PROJECT_ID,
      conversation_id: context.conversation.conversation_id,
      turn_id: context.ids.turn_id,
      task_id: context.ids.task_id,
      run_id: context.ids.run_id,
      request_id: `builder-git-request:${uuidFactory(900)()}`,
      candidate_id: `builder-code-change-candidate:${'6'.repeat(64)}`,
      candidate_digest: CANDIDATE_DIGEST,
      resulting_tree_digest: `sha256:${'7'.repeat(64)}`,
      semantic_identity_digest: `sha256:${'8'.repeat(64)}`,
      verification_receipt_digest: `sha256:${'9'.repeat(64)}`,
      object_format: 'sha1',
      commit_oid: 'a'.repeat(40),
      tree_oid: 'b'.repeat(40),
      parent_oid: null,
      expected_base_oid: null,
      code_authority: 'git_commit_candidate',
      product_revision_admission: 'not_recorded',
      replay: false,
    },
  };
}

function draftContinuationAdmission(context, terminal, candidate, overrides = {}) {
  return createBuilderDraftContinuationAdmission({
    pending_draft: {
      result_version: 'builder-generation-pending-draft.v2',
      draft_id: candidate.draft_id,
      restart_restore: 'not_persisted',
      conversation_event_admission: 'sqlite_recorded',
      git_request_id: candidate.git_candidate_receipt.request_id,
      title: candidate.title,
      summary: candidate.summary,
      conversation_head: terminal.head,
      candidate_proof: {
        proof_version: 'builder-generation-pending-candidate-proof.v1',
        project_id: PROJECT_ID,
        conversation_id: context.conversation.conversation_id,
        turn_id: context.ids.turn_id,
        task_id: context.ids.task_id,
        run_id: context.ids.run_id,
        request_digest: context.request_digest,
        git_request_id: candidate.git_candidate_receipt.request_id,
        candidate_id: candidate.git_candidate_receipt.candidate_id,
        candidate_digest: candidate.git_candidate_receipt.candidate_digest,
        resulting_tree_digest: candidate.git_candidate_receipt.resulting_tree_digest,
        expected_base_oid: candidate.git_candidate_receipt.expected_base_oid,
        base_revision: context.events[0].payload.base_revision,
      },
      ...overrides.pending_draft,
    },
    continuation_id: 'builder-draft-continuation:00000000-0000-4000-8000-000000000950',
    admitted_at_ms: 9_500,
    ...overrides.input,
  });
}

function sourceContextAuthority() {
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
  };
}

function sourceContextResult(context, overrides = {}) {
  const sourceTree = createBuilderProjectSourceTree({
    files: [{
      path: 'src/app.tsx',
      content: 'export const label = "ready";\n',
    }],
  });
  const files = sourceTree.files.map((file) => ({
    path: file.path,
    entry_kind: file.entry_kind,
    content: file.content,
    content_digest: file.content_digest,
    content_bytes: Buffer.byteLength(file.content, 'utf8'),
  }));
  return {
    result_version: 'builder-tool-source-context-result.v1',
    operation: 'project_source_context_collected',
    status: 'succeeded',
    context,
    private_source_context: {
      context_version: 'builder-private-source-context.v1',
      files,
    },
    reads: files.map((file, index) => ({
      resource_id: `project:/${file.path}`,
      status: 'succeeded',
      tool_call_id: `builder-tool-call:11111111-1111-4111-8111-${(600 + index).toString(16).padStart(12, '0')}`,
    })),
    authority: sourceContextAuthority(),
    ...overrides,
  };
}

function planProposalRecord(context, overrides = {}) {
  return createBuilderPlanProposalRecord({
    source_context_result: overrides.source_context_result ?? sourceContextResult(context),
    proposed_at_ms: overrides.proposed_at_ms ?? 500,
    title: overrides.title ?? 'Review the change plan',
    summary: overrides.summary ?? 'Prepare a bounded implementation before editing the project.',
    steps: overrides.steps ?? [
      {
        plan_step_id: 'builder-plan-step:11111111-1111-4111-8111-000000000701',
        title: 'Confirm the intended update',
        purpose: 'Keep the proposed work small and reviewable.',
        expected_change: 'The next step can be implemented and reviewed separately.',
        status: 'proposed',
      },
      {
        plan_step_id: 'builder-plan-step:11111111-1111-4111-8111-000000000702',
        title: 'Prepare the edit pass',
        purpose: 'Separate planning from source mutation.',
        expected_change: 'No source files change during planning.',
        status: 'proposed',
      },
    ],
  });
}

function toolPermissionRequest(overrides = {}) {
  return {
    tool_call_id: TOOL_CALL_ID,
    tool_name: 'filesystem.read',
    project_id: PROJECT_ID,
    action: 'filesystem.read',
    resource: {
      resource_kind: 'filesystem',
      project_id: PROJECT_ID,
      resource_id: 'project:/src/app.tsx',
    },
    ...overrides,
  };
}

async function allowedToolAdmission(overrides = {}) {
  const request = toolPermissionRequest(overrides.request ?? {});
  const guard = createBuilderToolPermissionAdmission({
    actor_id: TOOL_ACTOR_ID,
    now_ms: () => overrides.now_ms ?? 50,
    evaluate_permission: async (body) => ({
      decision_version: BUILDER_PERMISSION_DECISION_VERSION,
      policy_version: BUILDER_PERMISSION_POLICY_VERSION,
      actor_id: TOOL_ACTOR_ID,
      action: body.action,
      resource: body.resource,
      evaluated_at_ms: body.now_ms,
      decision: 'allowed',
      reason: 'matching_active_grant',
      permission_id: TOOL_PERMISSION_ID,
      permission_authority: 'builder_permission_facts_deny_by_default_v1',
      ui_selection_authority: 'not_permission',
      ...(overrides.decision ?? {}),
    }),
  });
  return guard.admit(request);
}

async function toolCallRecord(context, overrides = {}) {
  const recordOverrides = overrides.record ?? {};
  const projectId = recordOverrides.project_id ?? PROJECT_ID;
  const conversationId = recordOverrides.conversation_id ?? context.conversation.conversation_id;
  const turnId = recordOverrides.turn_id ?? context.ids.turn_id;
  const taskId = recordOverrides.task_id ?? context.ids.task_id;
  const runId = recordOverrides.run_id ?? context.ids.run_id;
  const sessionPolicy = createBuilderToolSessionPolicy({
    project_id: projectId,
    conversation_id: conversationId,
    turn_id: turnId,
    task_id: taskId,
    run_id: runId,
    issued_at_ms: 49,
    limits: { ...DEFAULT_BUILDER_TOOL_SESSION_LIMITS },
    ...(overrides.session_policy ?? {}),
  });
  return createBuilderToolCallRecord({
    project_id: projectId,
    conversation_id: conversationId,
    turn_id: turnId,
    task_id: taskId,
    run_id: runId,
    step_id: TOOL_STEP_ID,
    session_policy: sessionPolicy,
    admission: await allowedToolAdmission(overrides.admission ?? {}),
    requested_at_ms: 60,
    ...recordOverrides,
  });
}

function toolResultRecord(record, overrides = {}) {
  const {
    runtime_invocation_admission: runtime = toolRuntimeAdmission(record),
    ...rest
  } = overrides;
  return createBuilderToolResultRecord({
    runtime_invocation_admission: runtime,
    tool_call_record: record,
    observed_at_ms: Math.max(70, runtime.runtime_admitted_at_ms),
    result: {
      status: 'failed',
      summary_code: 'output_rejected',
    },
    ...rest,
  });
}

function existingToolCall(record) {
  return {
    step_id: record.step_id,
    tool_call_id: record.tool_call_id,
    tool_call_record: record,
    tool_result_record: null,
  };
}

function toolChainId(kind, record, offset) {
  const index = Number.parseInt(record.step_id.slice(-12), 16) + offset;
  return `builder-${kind}:11111111-1111-4111-8111-${index.toString(16).padStart(12, '0')}`;
}

function toolRuntimeAdmission(record) {
  const dispatch = createBuilderToolDispatchAdmission({
    project_id: record.project_id,
    conversation_id: record.conversation_id,
    turn_id: record.turn_id,
    task_id: record.task_id,
    run_id: record.run_id,
    run_status: 'running',
    interrupt_requested: false,
    cancel_requested: false,
    existing_tool_calls: [existingToolCall(record)],
    tool_call_record: record,
    dispatch_request_id: toolChainId('tool-dispatch-request', record, 1),
    admitted_at_ms: record.requested_at_ms,
  });
  const selection = createBuilderToolAdapterSelectionAdmission({
    dispatch_admission: dispatch,
    tool_call_record: record,
    adapter_id: FILESYSTEM_READ_TOOL_ADAPTER_ID,
    adapter_selection_id: toolChainId('tool-adapter-selection', record, 2),
    selected_at_ms: dispatch.admitted_at_ms,
  });
  return createBuilderToolRuntimeInvocationAdmission({
    adapter_selection_admission: selection,
    tool_call_record: record,
    runtime_id: FILESYSTEM_READ_TOOL_RUNTIME_ID,
    runtime_invocation_id: toolChainId('tool-runtime-invocation', record, 3),
    runtime_admitted_at_ms: selection.selected_at_ms,
  });
}

test('records start and terminal events before allowing a later turn to continue', () => {
  const item = fixture();
  try {
    const first = begin(item.service);
    assert.equal(first.start_head.sequence, 2);
    assert.deepEqual(first.events.map((event) => event.event_type), [
      'turn_submitted',
      'run_started',
    ]);
    assert.equal(first.events[0].payload.route_decision.route, 'build');
    assert.equal(first.events[0].payload.route_decision.dispatch, 'build');
    assert.deepEqual(first.events[0].payload.route_decision.required_permissions, ['write_project']);
    assert.equal(
      first.events[0].payload.route_decision.message_id,
      first.events[0].payload.message.message_id,
    );
    assert.equal(
      first.events[0].payload.route_decision.task_id,
      first.events[0].payload.task.task_id,
    );

    const terminal = item.service.complete_candidate({
      context: first,
      candidate_result: candidateResult(first),
      assistant_text: 'A timer draft is ready to review.',
    });
    assert.equal(terminal.head.sequence, 4);
    assert.equal(terminal.snapshot.active_turn_id, null);
    assert.equal(terminal.snapshot.turns[0].outcome, 'candidate_ready');
    assert.equal(terminal.snapshot.turns[0].messages[1].role, 'assistant');

    const second = begin(item.service, BASE_REVISION, 'Make the timer more compact');
    assert.equal(second.start_head.sequence, 6);
    assert.deepEqual(second.events.slice(-2).map((event) => event.event_type), [
      'turn_submitted',
      'run_started',
    ]);
  } finally {
    item.close();
  }
});

test('records fixed run progress while advancing the trusted context head', () => {
  const item = fixture();
  try {
    const first = begin(item.service);
    const contextReady = item.service.record_run_progress({
      context: first,
      stage: 'context_ready',
    });
    assert.equal(contextReady.start_head.sequence, 3);
    assert.equal(contextReady.events.at(-1).event_type, 'run_progress_recorded');
    assert.equal(contextReady.events.at(-1).payload.stage, 'context_ready');

    const requestStarted = item.service.record_run_progress({
      context: contextReady,
      stage: 'provider_request_started',
    });
    assert.equal(requestStarted.start_head.sequence, 4);
    assert.throws(() => item.service.record_run_progress({
      context: requestStarted,
      stage: 'provider_request_started',
    }));
    assert.throws(() => item.service.complete_candidate({
      context: first,
      candidate_result: candidateResult(first),
      assistant_text: 'A stale draft should not complete.',
    }));

    const terminal = item.service.complete_candidate({
      context: requestStarted,
      candidate_result: candidateResult(requestStarted),
      assistant_text: 'A timer draft is ready to review.',
    });
    assert.equal(terminal.head.sequence, 6);

    const stream = item.service.read_stream({ project_id: PROJECT_ID });
    assert.deepEqual(stream.conversation.items.slice(2, 4), [
      {
        item_kind: 'run_progress_recorded',
        sequence: 3,
        turn_id: first.ids.turn_id,
        run_id: first.ids.run_id,
        stage: 'context_ready',
        recorded_state: 'recorded',
      },
      {
        item_kind: 'run_progress_recorded',
        sequence: 4,
        turn_id: first.ids.turn_id,
        run_id: first.ids.run_id,
        stage: 'provider_request_started',
        recorded_state: 'recorded',
      },
    ]);
    assert.doesNotMatch(
      JSON.stringify(stream),
      /credential|source_tree|git_candidate_receipt|commit_oid|tree_oid|input_digest|prompt|token/iu,
    );
  } finally {
    item.close();
  }
});

test('records admitted Agent step progress while advancing the trusted context head', () => {
  const item = fixture();
  try {
    const first = begin(item.service);
    const started = item.service.record_agent_step_progress({
      context: first,
      progress_admission: agentProgressAdmission(first, 'start_recorded'),
    });
    assert.equal(started.start_head.sequence, 3);
    assert.equal(started.events.at(-1).event_type, 'agent_step_progress_recorded');
    assert.equal(
      started.events.at(-1).payload.progress_admission.recorded_state,
      'start_recorded',
    );

    const completed = item.service.record_agent_step_progress({
      context: started,
      progress_admission: agentProgressAdmission(started, 'result_recorded'),
    });
    assert.equal(completed.start_head.sequence, 4);
    assert.throws(() => item.service.complete_candidate({
      context: first,
      candidate_result: candidateResult(first),
      assistant_text: 'A stale draft should not complete.',
    }));

    const stream = item.service.read_stream({ project_id: PROJECT_ID });
    assert.deepEqual(stream.conversation.items.slice(2, 4), [
      {
        item_kind: 'agent_step_progress_recorded',
        sequence: 3,
        turn_id: first.ids.turn_id,
        run_id: first.ids.run_id,
        task_id: first.ids.task_id,
        step_id: AGENT_STEP_ID,
        step_index: 1,
        recorded_state: 'start_recorded',
        result: null,
        summary: {
          status: 'started',
          display_summary: 'Agent step start was recorded.',
        },
        lifecycle: {
          conversation_admission: 'verified_public_progress',
          raw_output_admission: 'not_included',
          revision_admission: 'not_created',
        },
      },
      {
        item_kind: 'agent_step_progress_recorded',
        sequence: 4,
        turn_id: first.ids.turn_id,
        run_id: first.ids.run_id,
        task_id: first.ids.task_id,
        step_id: AGENT_STEP_ID,
        step_index: 1,
        recorded_state: 'result_recorded',
        result: {
          status: 'succeeded',
          summary_code: 'agent_step_completed_without_raw_output',
          display_summary: 'Agent step completed. Details were not kept.',
        },
        summary: {
          status: 'succeeded',
          display_summary: 'Agent step completed. Details were not kept.',
        },
        lifecycle: {
          conversation_admission: 'verified_public_progress',
          raw_output_admission: 'not_included',
          revision_admission: 'not_created',
        },
      },
    ]);
    assert.doesNotMatch(
      JSON.stringify(stream),
      /progress_admission|admission_digest|read_service|step_start_count|step_result_count|credential|source_tree|stdout|stderr|commit_oid|tree_oid|input_digest|prompt|token/iu,
    );
  } finally {
    item.close();
  }
});

test('rejects Agent step progress recording outside the trusted active work run', () => {
  const item = fixture();
  try {
    const first = begin(item.service);
    const startAdmission = agentProgressAdmission(first, 'start_recorded');
    const resultAdmission = agentProgressAdmission(first, 'result_recorded');

    assert.throws(() => item.service.record_agent_step_progress({
      context: first,
      progress_admission: resultAdmission,
    }));

    const started = item.service.record_agent_step_progress({
      context: first,
      progress_admission: startAdmission,
    });
    const completed = item.service.record_agent_step_progress({
      context: started,
      progress_admission: agentProgressAdmission(started, 'result_recorded'),
    });
    assert.throws(() => item.service.record_agent_step_progress({
      context: completed,
      progress_admission: agentProgressAdmission(completed, 'result_recorded'),
    }));

    const questionItem = fixture(800);
    try {
      const question = beginQuestion(questionItem.service);
      assert.throws(() => questionItem.service.record_agent_step_progress({
        context: question,
        progress_admission: startAdmission,
      }));
    } finally {
      questionItem.close();
    }

    const cancelledItem = fixture(900);
    try {
      const cancellable = begin(cancelledItem.service);
      const cancelled = cancelledItem.service.request_cancel({ context: cancellable });
      assert.throws(() => cancelledItem.service.record_agent_step_progress({
        context: cancelled,
        progress_admission: agentProgressAdmission(cancellable, 'start_recorded'),
      }));
    } finally {
      cancelledItem.close();
    }

    assert.throws(() => item.service.record_agent_step_progress({
      context: started,
      progress_admission: {
        ...startAdmission,
        admission_digest: `sha256:${'f'.repeat(64)}`,
      },
    }));
    const futureItem = fixture(950);
    try {
      const futureContext = begin(futureItem.service);
      assert.throws(() => futureItem.service.record_agent_step_progress({
        context: futureContext,
        progress_admission: agentProgressAdmission(futureContext, 'start_recorded', {
          admitted_at_ms: 100_000,
        }),
      }));
    } finally {
      futureItem.close();
    }
  } finally {
    item.close();
  }
});

test('records a digest-bound run context snapshot before progress or tools', () => {
  const item = fixture();
  try {
    const first = begin(item.service);
    const workingContextState = createBuilderWorkingContextState({
      project_id: PROJECT_ID,
      session_id: 'builder-session:11111111-1111-4111-8111-111111111111',
      task_address_id: 'builder-task-address:11111111-1111-4111-8111-111111111111',
      conversation_id: first.conversation.conversation_id,
      objective_summary: null,
      confirmed_constraints: [],
      rejected_constraints: [],
      open_questions: [],
      latest_user_intent: 'Build a focused timer',
      source_refs: [],
      compaction_refs: [COMPACTION_REF],
      handoff_refs: [HANDOFF_REF],
      latest_task_capsule: null,
      approved_plan_ref: null,
      base_revision_ref: null,
      invalidated_by: null,
      updated_at_ms: 999,
    });
    const snapshotted = item.service.record_run_context_snapshot({
      context: first,
      working_context_state: workingContextState,
      project_understanding: null,
      context_assembly: null,
      provider_context_projection: null,
      provider_context_prompt_egress_gate: null,
    });
    const snapshotEvent = snapshotted.events.at(-1);

    assert.equal(snapshotted.start_head.sequence, 3);
    assert.equal(snapshotEvent.event_type, 'run_context_snapshot_recorded');
    assert.equal(snapshotEvent.payload.turn_id, first.ids.turn_id);
    assert.equal(snapshotEvent.payload.run_id, first.ids.run_id);
    assert.match(snapshotEvent.payload.snapshot.snapshot_id, /^builder-run-context-snapshot:/u);
    assert.equal(
      snapshotEvent.payload.snapshot.context_refs.working_context_state_id,
      workingContextState.state_id,
    );
    assert.deepEqual(snapshotEvent.payload.snapshot.context_refs.compaction_refs, [COMPACTION_REF]);
    assert.deepEqual(snapshotEvent.payload.snapshot.context_refs.handoff_refs, [HANDOFF_REF]);
    assert.equal(snapshotEvent.payload.snapshot.route_decision.route, 'build');
    assert.equal(snapshotEvent.payload.snapshot.capabilities.command_execution, 'not_included');
    assert.equal(snapshotEvent.payload.snapshot.capabilities.network_access, 'not_included');

    const replay = replayBuilderConversation(snapshotted.events);
    assert.equal(replay.turns[0].runs[0].context_snapshot.snapshot_id, snapshotEvent.payload.snapshot.snapshot_id);
    const stream = item.service.read_stream({ project_id: PROJECT_ID });
    assert.deepEqual(stream.conversation.items[2], {
      item_kind: 'run_context_snapshot_recorded',
      sequence: 3,
      turn_id: first.ids.turn_id,
      run_id: first.ids.run_id,
      task_id: first.ids.task_id,
      context: {
        recorded_state: 'recorded',
        route: 'build',
        dispatch: 'build',
        downgraded_from: null,
        downgrade_reason: null,
        brief: 'not_available',
        base: 'new_project_or_unsaved',
        permission_result: 'allowed',
        command_execution: 'not_included',
        network_access: 'not_included',
      },
    });
    assert.doesNotMatch(
      JSON.stringify(stream),
      /snapshot_id|context_digest|context_refs|working_context_state|summary_digest|packet_digest|route_decision|credential|source_tree|git_candidate_receipt|commit_oid|tree_oid/iu,
    );

    assert.throws(() => item.service.record_run_context_snapshot({
      context: first,
      working_context_state: null,
      project_understanding: null,
      context_assembly: null,
      provider_context_projection: null,
      provider_context_prompt_egress_gate: null,
    }), {
      code: 'builder_conversation_main_service_unavailable',
    });
    const progressed = item.service.record_run_progress({
      context: snapshotted,
      stage: 'context_ready',
    });
    assert.throws(() => item.service.record_run_context_snapshot({
      context: progressed,
      working_context_state: null,
      project_understanding: null,
      context_assembly: null,
      provider_context_projection: null,
      provider_context_prompt_egress_gate: null,
    }), {
      code: 'builder_conversation_main_service_unavailable',
    });
  } finally {
    item.close();
  }
});

test('records programming run admission after context snapshot and before progress', () => {
  const item = fixture();
  try {
    const first = begin(item.service);
    const snapshotted = item.service.record_run_context_snapshot({
      context: first,
      working_context_state: null,
      project_understanding: null,
      context_assembly: null,
      provider_context_projection: null,
      provider_context_prompt_egress_gate: null,
    });
    const snapshot = snapshotted.events.at(-1).payload.snapshot;
    const continuation = createBuilderApprovedPlanContinuationAdmission({
      approved_plan: {
        result_version: APPROVED_PLAN_READ_RESULT_VERSION,
        project_id: PROJECT_ID,
        conversation_id: first.conversation.conversation_id,
        turn_id: 'builder-turn:22222222-2222-4222-8222-222222222222',
        task_id: 'builder-task:33333333-3333-4333-8333-333333333333',
        run_id: 'builder-run:44444444-4444-4444-8444-444444444444',
        decision: 'approved',
        plan_result_digest: `sha256:${'8'.repeat(64)}`,
        conversation_head: {
          sequence: 7,
          event_id: `builder-conversation-event:${'9'.repeat(64)}`,
          event_digest: `sha256:${'a'.repeat(64)}`,
        },
        authority: {
          conversation: 'sqlite_replay_current_head_verified',
          plan_review: 'approved_current_head',
          renderer_authority: 'not_present',
          provider_dispatch: false,
          tool_dispatch: 'not_performed',
          source_mutation: 'not_performed',
          git_authority: 'not_present',
          revision_admission: 'not_created',
        },
      },
      continuation_id: 'builder-approved-plan-continuation:55555555-5555-4555-8555-555555555555',
      admitted_at_ms: 990,
    });
    const executionApproval = createBuilderExecutionApproval({
      approved_plan_continuation: continuation,
      write_permission_decision: {
        decision_version: BUILDER_PERMISSION_DECISION_VERSION,
        policy_version: BUILDER_PERMISSION_POLICY_VERSION,
        actor_id: 'builder-user:00000000-0000-4000-8000-000000000001',
        action: 'project.edit',
        resource: { resource_kind: 'project', project_id: PROJECT_ID, resource_id: 'project:self' },
        evaluated_at_ms: 995,
        decision: 'allowed',
        reason: 'matching_active_grant',
        permission_id: `builder-permission:${'b'.repeat(64)}`,
        permission_authority: 'builder_permission_facts_deny_by_default_v1',
        ui_selection_authority: 'not_permission',
      },
      provider_config_digest: `sha256:${'c'.repeat(64)}`,
      source_tree_digest: createBuilderProjectSourceTree({ files: [] }).source_tree_digest,
      project_understanding: null,
      approved_at_ms: 1_001,
      expires_at_ms: 31_001,
    });
    const programmingRunAdmission = createBuilderProgrammingRunAdmission({
      execution_approval: executionApproval,
      run_context_snapshot: snapshot,
      admitted_at_ms: 1_002,
    });
    const admitted = item.service.record_programming_run_admission({
      context: snapshotted,
      execution_approval: executionApproval,
      programming_run_admission: programmingRunAdmission,
    });

    assert.equal(admitted.events.at(-1).event_type, 'programming_run_admitted');
    const replay = replayBuilderConversation(admitted.events);
    const run = replay.turns[0].runs[0];
    assert.equal(run.execution_approval.approval_id, executionApproval.approval_id);
    assert.equal(run.programming_run_admission.admission_id, programmingRunAdmission.admission_id);
    assert.equal(run.programming_run_admission.context_snapshot_id, snapshot.snapshot_id);
    assert.throws(() => item.service.record_programming_run_admission({
      context: admitted,
      execution_approval: executionApproval,
      programming_run_admission: programmingRunAdmission,
    }), { code: 'builder_conversation_main_service_unavailable' });

    const stream = item.service.read_stream({ project_id: PROJECT_ID });
    assert.deepEqual(stream.conversation.items.at(-1), {
      item_kind: 'programming_run_admitted',
      sequence: 4,
      turn_id: snapshotted.ids.turn_id,
      run_id: snapshotted.ids.run_id,
      task_id: snapshotted.ids.task_id,
      recorded_state: 'admitted',
    });
    assert.doesNotMatch(
      JSON.stringify(stream),
      /execution_approval|programming_run_admission|provider_config_digest|permission_id/iu,
    );
  } finally {
    item.close();
  }
});

test('records bounded steering on the active run without provider or source authority', () => {
  const item = fixture();
  try {
    const first = begin(item.service);
    const contextReady = item.service.record_run_progress({
      context: first,
      stage: 'context_ready',
    });
    const steered = item.service.record_steering({
      context: contextReady,
      message: 'Use a calmer layout before you finish.',
    });
    const steeredEvent = steered.events.at(-1);
    assert.equal(steered.start_head.sequence, 4);
    assert.equal(steeredEvent.event_type, 'turn_steered');
    assert.equal(steeredEvent.payload.turn_id, first.ids.turn_id);
    assert.equal(steeredEvent.payload.run_id, first.ids.run_id);
    assert.match(steeredEvent.payload.message.message_id, /^builder-message:/u);
    assert.equal(steeredEvent.payload.message.text, 'Use a calmer layout before you finish.');

    const stream = item.service.read_stream({ project_id: PROJECT_ID });
    assert.equal(stream.conversation.head_sequence, 4);
    assert.equal(stream.conversation.recorded_active_turn_id, first.ids.turn_id);
    assert.deepEqual(stream.conversation.items[3], {
      item_kind: 'user_message',
      sequence: 4,
      turn_id: first.ids.turn_id,
      message: {
        message_id: steeredEvent.payload.message.message_id,
        text: 'Use a calmer layout before you finish.',
      },
      message_kind: 'steering',
      mode: null,
      task: null,
    });
    assert.doesNotMatch(
      JSON.stringify(stream),
      /provider|credential|git_candidate_receipt|commit_oid|tree_oid|source_tree|save_admission|running|live/iu,
    );

    const terminal = item.service.complete_candidate({
      context: steered,
      candidate_result: candidateResult(steered),
      assistant_text: 'A calmer timer draft is ready to review.',
    });
    assert.equal(terminal.head.sequence, 6);
    assert.equal(terminal.snapshot.active_turn_id, null);
    assert.deepEqual(terminal.snapshot.turns[0].messages.map((message) => message.kind), [
      'submitted',
      'steering',
      'run_result',
    ]);
    assert.equal(terminal.snapshot.turns[0].messages[2].role, 'assistant');
    assert.equal(terminal.snapshot.turns[0].outcome, 'candidate_ready');
  } finally {
    item.close();
  }
});

test('records bounded queued follow-ups on the active run without provider or source authority', () => {
  const item = fixture();
  try {
    const first = begin(item.service);
    const contextReady = item.service.record_run_progress({
      context: first,
      stage: 'context_ready',
    });
    const queued = item.service.record_queued_followup({
      context: contextReady,
      message: 'After this finishes, make the summary shorter.',
    });
    const queuedEvent = queued.events.at(-1);
    assert.equal(queued.start_head.sequence, 4);
    assert.equal(queuedEvent.event_type, 'turn_followup_queued');
    assert.equal(queuedEvent.payload.turn_id, first.ids.turn_id);
    assert.equal(queuedEvent.payload.run_id, first.ids.run_id);
    assert.match(queuedEvent.payload.message.message_id, /^builder-message:/u);
    assert.equal(queuedEvent.payload.message.text, 'After this finishes, make the summary shorter.');

    const stream = item.service.read_stream({ project_id: PROJECT_ID });
    assert.equal(stream.conversation.head_sequence, 4);
    assert.equal(stream.conversation.recorded_active_turn_id, first.ids.turn_id);
    assert.deepEqual(stream.conversation.items[3], {
      item_kind: 'user_message',
      sequence: 4,
      turn_id: first.ids.turn_id,
      message: {
        message_id: queuedEvent.payload.message.message_id,
        text: 'After this finishes, make the summary shorter.',
      },
      message_kind: 'queued_followup',
      mode: null,
      task: null,
    });
    assert.doesNotMatch(
      JSON.stringify(stream),
      /provider|credential|git_candidate_receipt|commit_oid|tree_oid|source_tree|save_admission|running|live/iu,
    );

    const terminal = item.service.complete_candidate({
      context: queued,
      candidate_result: candidateResult(queued),
      assistant_text: 'A shorter summary draft is ready to review.',
    });
    assert.equal(terminal.head.sequence, 6);
    assert.equal(terminal.snapshot.active_turn_id, null);
    assert.deepEqual(terminal.snapshot.turns[0].messages.map((message) => message.kind), [
      'submitted',
      'queued_followup',
      'run_result',
    ]);
    assert.equal(terminal.snapshot.turns[0].messages[2].role, 'assistant');
    assert.equal(terminal.snapshot.turns[0].outcome, 'candidate_ready');
  } finally {
    item.close();
  }
});

test('starts queued follow-up work only through a replay-verified consumption receipt', () => {
  const item = fixture();
  try {
    const first = begin(item.service);
    const queued = item.service.record_queued_followup({
      context: first,
      message: 'After this finishes, make the summary shorter.',
    });
    const queuedEvent = queued.events.at(-1);
    item.service.complete_candidate({
      context: queued,
      candidate_result: candidateResult(queued),
      assistant_text: 'A shorter summary draft is ready to review.',
    });

    const followup = item.service.begin_queued_followup_work({
      project_id: PROJECT_ID,
      instruction: 'After this finishes, make the summary shorter.',
      request_digest: `sha256:${'a'.repeat(64)}`,
      base_revision: BASE_REVISION,
      queued_followup: {
        turn_id: first.ids.turn_id,
        run_id: first.ids.run_id,
        message_id: queuedEvent.payload.message.message_id,
      },
      route_decision_hint: {
        route: 'build',
        confidence: 'high',
        matched_signals: ['active_run_followup'],
        downgraded_from: null,
        downgrade_reason: null,
        required_permissions: ['write_project'],
        permission_result: 'allowed',
        dispatch: 'build',
      },
    });

    assert.deepEqual(followup.events.slice(-3).map((event) => event.event_type), [
      'turn_submitted',
      'turn_followup_consumed',
      'run_started',
    ]);
    const consumed = followup.events.at(-2);
    assert.equal(consumed.payload.turn_id, first.ids.turn_id);
    assert.equal(consumed.payload.run_id, first.ids.run_id);
    assert.equal(consumed.payload.message_id, queuedEvent.payload.message.message_id);
    assert.equal(consumed.payload.consuming_turn_id, followup.ids.turn_id);
    assert.equal(consumed.payload.consuming_message_id, followup.ids.message_id);
    const replayed = replayBuilderConversation(followup.events);
    assert.equal(replayed.active_turn_id, followup.ids.turn_id);
    assert.equal(replayed.turns[1].mode, 'work');
    assert.equal(replayed.turns[1].messages[0].text, 'After this finishes, make the summary shorter.');

    const stream = item.service.read_stream({ project_id: PROJECT_ID });
    assert.deepEqual(stream.conversation.items.slice(-3).map((entry) => entry.item_kind), [
      'user_message',
      'queued_followup_consumed',
      'run_started',
    ]);
    assert.deepEqual(stream.conversation.items.at(-2), {
      item_kind: 'queued_followup_consumed',
      sequence: 7,
      turn_id: first.ids.turn_id,
      run_id: first.ids.run_id,
      message_id: queuedEvent.payload.message.message_id,
      consumed_by: {
        turn_id: followup.ids.turn_id,
        message_id: followup.ids.message_id,
      },
      recorded_state: 'consumed',
    });
    assert.doesNotMatch(
      JSON.stringify(stream),
      /provider|credential|git_candidate_receipt|commit_oid|tree_oid|source_tree|save_admission|permission_admission|auto_dispatch/iu,
    );
  } finally {
    item.close();
  }
});

test('starts queued follow-up questions without write authority or task creation', () => {
  const item = fixture();
  try {
    const first = beginQuestion(item.service, null, 'What should I improve?');
    const queued = item.service.record_queued_followup({
      context: first,
      message: 'Also explain the tradeoffs.',
    });
    const queuedEvent = queued.events.at(-1);
    item.service.complete_explanation({
      context: queued,
      assistant_text: 'You could improve clarity, hierarchy, and copy.',
    });

    const followup = item.service.begin_queued_followup_question({
      project_id: PROJECT_ID,
      question: 'Also explain the tradeoffs.',
      request_digest: `sha256:${'b'.repeat(64)}`,
      base_revision: null,
      queued_followup: {
        turn_id: first.ids.turn_id,
        run_id: first.ids.run_id,
        message_id: queuedEvent.payload.message.message_id,
      },
      route_decision_hint: {
        route: 'answer',
        confidence: 'high',
        matched_signals: ['active_run_followup'],
        downgraded_from: null,
        downgrade_reason: null,
        required_permissions: [],
        permission_result: 'not_required',
        dispatch: 'reply',
      },
    });

    assert.deepEqual(followup.events.slice(-3).map((event) => event.event_type), [
      'turn_submitted',
      'turn_followup_consumed',
      'run_started',
    ]);
    assert.equal(followup.ids.task_id, null);
    const replayed = replayBuilderConversation(followup.events);
    assert.equal(replayed.turns[1].mode, 'question');
    assert.equal(followup.events.at(-2).payload.message_id, queuedEvent.payload.message.message_id);
    assert.equal(followup.events.at(-1).payload.task_id, null);
  } finally {
    item.close();
  }
});

test('rejects queued follow-up consumption before terminal completion or with mismatched text', () => {
  const item = fixture();
  try {
    const first = begin(item.service);
    const queued = item.service.record_queued_followup({
      context: first,
      message: 'After this finishes, make the summary shorter.',
    });
    const queuedEvent = queued.events.at(-1);
    assert.throws(() => item.service.begin_queued_followup_work({
      project_id: PROJECT_ID,
      instruction: 'After this finishes, make the summary shorter.',
      request_digest: `sha256:${'c'.repeat(64)}`,
      base_revision: BASE_REVISION,
      queued_followup: {
        turn_id: first.ids.turn_id,
        run_id: first.ids.run_id,
        message_id: queuedEvent.payload.message.message_id,
      },
    }), { code: 'builder_conversation_main_service_unavailable' });
    assert.equal(item.service.read_stream({ project_id: PROJECT_ID }).conversation.head_sequence, 3);

    item.service.complete_candidate({
      context: queued,
      candidate_result: candidateResult(queued),
      assistant_text: 'A shorter summary draft is ready to review.',
    });
    assert.throws(() => item.service.begin_queued_followup_work({
      project_id: PROJECT_ID,
      instruction: 'Use a very different follow-up instead.',
      request_digest: `sha256:${'d'.repeat(64)}`,
      base_revision: BASE_REVISION,
      queued_followup: {
        turn_id: first.ids.turn_id,
        run_id: first.ids.run_id,
        message_id: queuedEvent.payload.message.message_id,
      },
    }), { code: 'builder_conversation_main_service_unavailable' });
    assert.equal(item.service.read_stream({ project_id: PROJECT_ID }).conversation.head_sequence, 5);
  } finally {
    item.close();
  }
});

test('rejects steering after control or failure and rejects forged steering payloads', () => {
  const item = fixture();
  try {
    const first = begin(item.service);
    assert.throws(() => item.service.record_steering({
      context: Object.freeze({}),
      message: 'Use a calmer layout.',
    }), { code: 'builder_conversation_main_service_unavailable' });
    assert.throws(() => item.service.record_steering({
      context: first,
      message: 'Use a calmer layout.',
      provider_config: 'forged',
    }), { code: 'builder_conversation_main_service_unavailable' });

    const failed = item.service.record_retryable_failure({
      context: first,
      failure_code: 'builder_generation_failed',
    });
    assert.throws(() => item.service.record_steering({
      context: failed,
      message: 'Try again with less motion.',
    }), { code: 'builder_conversation_main_service_unavailable' });
  } finally {
    item.close();
  }

  const cancelledItem = fixture();
  try {
    const first = begin(cancelledItem.service);
    const cancelled = cancelledItem.service.request_cancel({ context: first });
    assert.throws(() => cancelledItem.service.record_steering({
      context: cancelled,
      message: 'Actually keep going.',
    }), { code: 'builder_conversation_main_service_unavailable' });
  } finally {
    cancelledItem.close();
  }
});

test('rejects queued follow-ups after control or failure and rejects forged payloads', () => {
  const item = fixture();
  try {
    const first = begin(item.service);
    assert.throws(() => item.service.record_queued_followup({
      context: Object.freeze({}),
      message: 'Queue a follow-up.',
    }), { code: 'builder_conversation_main_service_unavailable' });
    assert.throws(() => item.service.record_queued_followup({
      context: first,
      message: 'Queue a follow-up.',
      provider_config: 'forged',
    }), { code: 'builder_conversation_main_service_unavailable' });

    const failed = item.service.record_retryable_failure({
      context: first,
      failure_code: 'builder_generation_failed',
    });
    assert.throws(() => item.service.record_queued_followup({
      context: failed,
      message: 'After that, try again with less motion.',
    }), { code: 'builder_conversation_main_service_unavailable' });
  } finally {
    item.close();
  }

  const cancelledItem = fixture();
  try {
    const first = begin(cancelledItem.service);
    const cancelled = cancelledItem.service.request_cancel({ context: first });
    assert.throws(() => cancelledItem.service.record_queued_followup({
      context: cancelled,
      message: 'Actually keep going after this.',
    }), { code: 'builder_conversation_main_service_unavailable' });
  } finally {
    cancelledItem.close();
  }
});

test('notifies task stream readers after durable conversation appends', () => {
  const notifications = [];
  const item = fixture(1, 1_000, {
    onTaskStreamChanged(event) {
      notifications.push(event);
    },
  });
  try {
    const first = begin(item.service);
    item.service.complete_candidate({
      context: first,
      candidate_result: candidateResult(first),
      assistant_text: 'A timer draft is ready to review.',
    });

    assert.deepEqual(notifications, [
      {
        event_version: 'builder-task-stream-changed.v1',
        project_id: PROJECT_ID,
      },
      {
        event_version: 'builder-task-stream-changed.v1',
        project_id: PROJECT_ID,
      },
    ]);
    assert.equal(Object.isFrozen(notifications[0]), true);
  } finally {
    item.close();
  }
});

test('begins work for a bound local project before any saved revision exists', () => {
  const item = fixture(1, 9_000);
  try {
    item.database.bind_project_workspace({
      project_id: PROJECT_ID,
      project_title: 'Local dashboard',
      project_root_path: item.root,
      source_folder_name: path.basename(item.root),
      created_at_ms: 4_200,
      bound_at_ms: 4_300,
    });

    const context = begin(item.service);

    assert.equal(context.project.created_at_ms, 4_200);
    assert.equal(context.conversation.created_at_ms, 4_200);
    assert.equal(context.events[0].payload.base_revision, null);
    assert.equal(context.events[0].payload.task.title, 'Create Builder project');
    assert.equal(context.start_head.sequence, 2);
    assert.equal(item.service.read_stream({ project_id: PROJECT_ID }).conversation.head_sequence, 2);
  } finally {
    item.close();
  }
});

test('records a question explanation without creating task, candidate, or revision facts', () => {
  const item = fixture();
  let restartedDatabase = null;
  try {
    const context = beginQuestion(item.service);
    assert.equal(context.mode, 'question');
    assert.equal(context.ids.task_id, null);
    assert.equal(context.start_head.sequence, 2);
    assert.deepEqual(context.events.map((event) => event.event_type), [
      'turn_submitted',
      'run_started',
    ]);
    assert.equal(context.events[0].payload.mode, 'question');
    assert.equal(context.events[0].payload.task, null);
    assert.equal(context.events[0].payload.route_decision.route, 'answer');
    assert.equal(context.events[0].payload.route_decision.dispatch, 'reply');
    assert.equal(context.events[0].payload.route_decision.task_id, null);
    assert.equal(
      context.events[0].payload.route_decision.message_id,
      context.events[0].payload.message.message_id,
    );
    assert.equal(context.events[1].payload.task_id, null);

    const terminal = item.service.complete_explanation({
      context,
      assistant_text: 'This project is saved locally and can be revised without creating a new version.',
    });
    assert.equal(terminal.head.sequence, 4);
    assert.equal(terminal.snapshot.active_turn_id, null);
    assert.equal(terminal.snapshot.turns[0].mode, 'question');
    assert.equal(terminal.snapshot.turns[0].task, null);
    assert.equal(terminal.snapshot.turns[0].outcome, 'answered');
    assert.equal(terminal.snapshot.turns[0].runs[0].result_kind, 'explanation');
    assert.equal(terminal.snapshot.turns[0].runs[0].candidate_result, null);

    const followup = beginQuestion(item.service, null, 'Can I ask another question before saving?');
    assert.equal(followup.project.created_at_ms, context.project.created_at_ms);
    assert.equal(followup.conversation.created_at_ms, context.conversation.created_at_ms);
    assert.equal(followup.start_head.sequence, 6);
    assert.equal(followup.events[0].payload.mode, 'question');
    assert.equal(followup.events[0].payload.task, null);
    const followupTerminal = item.service.complete_explanation({
      context: followup,
      assistant_text: 'Yes. Questions can continue without creating a saved version.',
    });
    assert.equal(followupTerminal.head.sequence, 8);

    const stream = item.service.read_stream({ project_id: PROJECT_ID });
    assert.equal(stream.conversation.head_sequence, 8);
    assert.equal(stream.conversation.items[0].mode, 'question');
    assert.equal(stream.conversation.items[0].task, null);
    assert.equal(stream.conversation.items[1].task_id, null);
    assert.equal(stream.conversation.items[2].result_kind, 'explanation');
    assert.equal(stream.conversation.items[2].candidate, null);
    assert.equal(stream.conversation.items[3].outcome, 'answered');
    assert.equal(stream.conversation.items[4].mode, 'question');
    assert.equal(stream.conversation.items[4].task, null);
    assert.equal(stream.conversation.items[6].result_kind, 'explanation');
    assert.equal(stream.conversation.items[6].candidate, null);
    assert.equal(stream.conversation.items[7].outcome, 'answered');
    assert.doesNotMatch(
      JSON.stringify(stream),
      /candidate_digest|git_candidate_receipt|commit_oid|tree_oid|revision_receipt|save_admission|provider|credential/iu,
    );

    item.database.close();
    restartedDatabase = createBuilderProductMetadataDatabase(
      path.join(item.root, 'builder.sqlite'),
    );
    const restartedService = createBuilderConversationMainService({
      metadataAuthority: restartedDatabase,
      createUuid: uuidFactory(800),
      nowMs: () => 8_000,
    });
    assert.deepEqual(restartedService.read_stream({ project_id: PROJECT_ID }), stream);
  } finally {
    if (restartedDatabase !== null) restartedDatabase.close();
    try { item.database.close(); } catch { /* already closed during restart check */ }
    removeRoot(item.root);
  }
});

test('records route decision hints as main-bound turn evidence', () => {
  const item = fixture();
  try {
    const question = item.service.begin_question({
      project_id: PROJECT_ID,
      question: '我想先聊一下这个页面怎么做',
      request_digest: QUESTION_DIGEST,
      base_revision: null,
      route_decision_hint: {
        route: 'clarify',
        confidence: 'high',
        matched_signals: ['work_discussion'],
        downgraded_from: null,
        downgrade_reason: null,
        required_permissions: [],
        permission_result: 'not_required',
        dispatch: 'reply',
      },
    });
    assert.equal(question.events[0].payload.mode, 'question');
    assert.equal(question.events[0].payload.route_decision.route, 'clarify');
    assert.deepEqual(question.events[0].payload.route_decision.matched_signals, ['work_discussion']);
    item.service.complete_explanation({
      context: question,
      assistant_text: 'We can discuss the layout before making files.',
    });

    const plan = item.service.begin_work({
      project_id: PROJECT_ID,
      instruction: '先给我方案',
      request_digest: REQUEST_DIGEST,
      base_revision: null,
      route_decision_hint: {
        route: 'plan',
        confidence: 'high',
        matched_signals: ['explicit_plan'],
        downgraded_from: null,
        downgrade_reason: null,
        required_permissions: ['project_read'],
        permission_result: 'allowed',
        dispatch: 'plan',
      },
    });
    assert.equal(plan.events.at(-2).payload.route_decision.route, 'plan');
    assert.equal(plan.events.at(-2).payload.route_decision.dispatch, 'plan');
    assert.deepEqual(plan.events.at(-2).payload.route_decision.required_permissions, ['project_read']);
    assert.equal(plan.events.at(-1).payload.task_id, plan.ids.task_id);
  } finally {
    item.close();
  }
});

test('rejects route decision hints with non-public matched signals', () => {
  const item = fixture();
  try {
    assert.throws(() => item.service.begin_work({
      project_id: PROJECT_ID,
      instruction: 'Build a focused timer',
      request_digest: REQUEST_DIGEST,
      base_revision: null,
      route_decision_hint: {
        route: 'build',
        confidence: 'high',
        matched_signals: ['provider:deepseek'],
        downgraded_from: null,
        downgrade_reason: null,
        required_permissions: ['write_project'],
        permission_result: 'allowed',
        dispatch: 'build',
      },
    }), { code: 'builder_conversation_main_service_unavailable' });
    assert.equal(item.service.read_stream({ project_id: PROJECT_ID }).conversation, null);
  } finally {
    item.close();
  }
});

test('records update-brief turns as durable task capsule context without creating a draft', () => {
  const item = fixture();
  let restartedDatabase = null;
  try {
    const context = item.service.begin_question({
      project_id: PROJECT_ID,
      question: '我想先聊一下这个作品集首页怎么做。',
      request_digest: QUESTION_DIGEST,
      base_revision: null,
      route_decision_hint: {
        route: 'update_brief',
        confidence: 'medium',
        matched_signals: ['exploratory_work'],
        downgraded_from: null,
        downgrade_reason: null,
        required_permissions: [],
        permission_result: 'not_required',
        dispatch: 'brief_update',
      },
    });
    assert.deepEqual(context.events.map((event) => event.event_type), [
      'turn_submitted',
      'run_started',
    ]);
    assert.equal(context.events[0].payload.route_decision.route, 'update_brief');
    assert.equal(context.events[0].payload.route_decision.dispatch, 'brief_update');

    const terminal = item.service.complete_explanation({
      context,
      assistant_text: '可以先做一个带星空 hero、项目卡片和联系入口的单页作品集。',
    });
    assert.deepEqual(terminal.events.slice(-3).map((event) => event.event_type), [
      'run_completed',
      'task_brief_updated',
      'turn_completed',
    ]);
    const briefEvent = terminal.events.at(-2);
    assert.equal(briefEvent.payload.task_capsule.project_id, PROJECT_ID);
    assert.equal(briefEvent.payload.task_capsule.status, 'ready');
    assert.equal(
      briefEvent.payload.task_capsule.last_route_decision_id,
      context.events[0].payload.route_decision.decision_id,
    );
    assert.equal(
      briefEvent.payload.task_capsule.current_brief.use_when_instruction_is_contextual,
      true,
    );
    assert.equal(terminal.snapshot.turns[0].task, null);
    assert.equal(terminal.snapshot.turns[0].runs[0].candidate_result, null);

    const stream = item.service.read_stream({ project_id: PROJECT_ID });
    assert.deepEqual(stream.conversation.items.map((entry) => entry.item_kind), [
      'user_message',
      'run_started',
      'run_completed',
      'task_brief_updated',
      'turn_completed',
    ]);
    assert.equal(stream.conversation.items[3].brief.contextual_build_ready, true);
    assert.doesNotMatch(
      JSON.stringify(stream),
      /route_decision|candidate_digest|git_candidate_receipt|commit_oid|tree_oid|revision_receipt|save_admission|provider|credential|source_tree/iu,
    );

    item.database.close();
    restartedDatabase = createBuilderProductMetadataDatabase(
      path.join(item.root, 'builder.sqlite'),
    );
    const restartedService = createBuilderConversationMainService({
      metadataAuthority: restartedDatabase,
      createUuid: uuidFactory(900),
      nowMs: () => 9_000,
    });
    assert.deepEqual(restartedService.read_stream({ project_id: PROJECT_ID }), stream);
  } finally {
    if (restartedDatabase !== null) restartedDatabase.close();
    try { item.database.close(); } catch { /* already closed during restart check */ }
    removeRoot(item.root);
  }
});

test('records brief corrections as not-ready task capsule context without creating a draft', () => {
  const item = fixture();
  try {
    const context = item.service.begin_question({
      project_id: PROJECT_ID,
      question: '等等，先不要按这个做，我要重新整理方向。',
      request_digest: QUESTION_DIGEST,
      base_revision: null,
      route_decision_hint: {
        route: 'update_brief',
        confidence: 'high',
        matched_signals: ['brief_correction'],
        downgraded_from: null,
        downgrade_reason: null,
        required_permissions: [],
        permission_result: 'not_required',
        dispatch: 'brief_update',
      },
    });

    const terminal = item.service.complete_explanation({
      context,
      assistant_text: '旧方向先不执行。我们先重新确认新的目标和范围。',
    });
    assert.deepEqual(terminal.events.slice(-3).map((event) => event.event_type), [
      'run_completed',
      'task_brief_updated',
      'turn_completed',
    ]);
    const briefEvent = terminal.events.at(-2);
    assert.equal(briefEvent.payload.task_capsule.status, 'discussing');
    assert.equal(
      briefEvent.payload.task_capsule.current_brief.use_when_instruction_is_contextual,
      false,
    );
    assert.equal(terminal.snapshot.turns[0].task, null);
    assert.equal(terminal.snapshot.turns[0].runs[0].candidate_result, null);

    const stream = item.service.read_stream({ project_id: PROJECT_ID });
    assert.equal(stream.conversation.items[3].item_kind, 'task_brief_updated');
    assert.equal(stream.conversation.items[3].brief.status, 'discussing');
    assert.equal(stream.conversation.items[3].brief.contextual_build_ready, false);
    assert.doesNotMatch(
      JSON.stringify(stream),
      /route_decision|candidate_digest|git_candidate_receipt|commit_oid|tree_oid|revision_receipt|save_admission|provider|credential|source_tree/iu,
    );
  } finally {
    item.close();
  }
});

test('records task capsule source message ids in run context snapshots', () => {
  const item = fixture();
  try {
    const prior = item.service.begin_question({
      project_id: PROJECT_ID,
      question: '我想先聊一下这个作品集首页怎么做。',
      request_digest: QUESTION_DIGEST,
      base_revision: null,
      route_decision_hint: {
        route: 'update_brief',
        confidence: 'medium',
        matched_signals: ['exploratory_work'],
        downgraded_from: null,
        downgrade_reason: null,
        required_permissions: [],
        permission_result: 'not_required',
        dispatch: 'brief_update',
      },
    });
    const terminal = item.service.complete_explanation({
      context: prior,
      assistant_text: '可以先做一个带星空 hero、项目卡片和联系入口的单页作品集。',
    });
    const briefEvent = terminal.events.at(-2);
    assert.equal(briefEvent.event_type, 'task_brief_updated');

    const work = item.service.begin_work({
      project_id: PROJECT_ID,
      instruction: '按刚才方案做',
      request_digest: REQUEST_DIGEST,
      base_revision: null,
      route_decision_hint: {
        route: 'build',
        confidence: 'high',
        matched_signals: ['contextual_build_phrase'],
        downgraded_from: null,
        downgrade_reason: null,
        required_permissions: ['write_project'],
        permission_result: 'allowed',
        dispatch: 'build',
      },
    });
    const snapshotted = item.service.record_run_context_snapshot({
      context: work,
      working_context_state: null,
      project_understanding: null,
      context_assembly: null,
      provider_context_projection: null,
      provider_context_prompt_egress_gate: null,
    });
    const snapshot = snapshotted.events.at(-1).payload.snapshot;

    assert.deepEqual(snapshot.included_message_ids, [
      work.ids.message_id,
      briefEvent.payload.message_id,
    ]);
    assert.equal(snapshot.brief_reference.status, 'task_capsule_update');
    assert.equal(snapshot.brief_reference.task_id, briefEvent.payload.task_capsule.task_id);
    assert.equal(snapshot.brief_reference.source_message_id, briefEvent.payload.message_id);
    assert.equal(
      snapshot.brief_reference.last_route_decision_id,
      briefEvent.payload.task_capsule.last_route_decision_id,
    );
    const replay = replayBuilderConversation(snapshotted.events);
    assert.deepEqual(
      replay.turns.at(-1).runs[0].context_snapshot.included_message_ids,
      [work.ids.message_id, briefEvent.payload.message_id],
    );
    assert.doesNotMatch(
      JSON.stringify(item.service.read_stream({ project_id: PROJECT_ID })),
      /source_message_id|included_message_ids|snapshot_id|context_digest|assistant_proposal|latest_user_goal/iu,
    );
  } finally {
    item.close();
  }
});

test('does not cite stale task capsule brief after a newer not-ready correction', () => {
  const item = fixture();
  try {
    const prior = item.service.begin_question({
      project_id: PROJECT_ID,
      question: '我想先聊一下这个作品集首页怎么做。',
      request_digest: QUESTION_DIGEST,
      base_revision: null,
      route_decision_hint: {
        route: 'update_brief',
        confidence: 'medium',
        matched_signals: ['exploratory_work'],
        downgraded_from: null,
        downgrade_reason: null,
        required_permissions: [],
        permission_result: 'not_required',
        dispatch: 'brief_update',
      },
    });
    const priorTerminal = item.service.complete_explanation({
      context: prior,
      assistant_text: '可以先做一个带星空 hero、项目卡片和联系入口的单页作品集。',
    });
    const readyBriefEvent = priorTerminal.events.at(-2);
    assert.equal(readyBriefEvent.event_type, 'task_brief_updated');
    assert.equal(readyBriefEvent.payload.task_capsule.status, 'ready');

    const correction = item.service.begin_question({
      project_id: PROJECT_ID,
      question: '等等，先不要按这个做，我要重新整理方向。',
      request_digest: `${QUESTION_DIGEST.slice(0, -1)}2`,
      base_revision: null,
      route_decision_hint: {
        route: 'update_brief',
        confidence: 'high',
        matched_signals: ['brief_correction'],
        downgraded_from: null,
        downgrade_reason: null,
        required_permissions: [],
        permission_result: 'not_required',
        dispatch: 'brief_update',
      },
    });
    const correctionTerminal = item.service.complete_explanation({
      context: correction,
      assistant_text: '旧方向先不执行。我们先重新确认新的目标和范围。',
    });
    const correctionBriefEvent = correctionTerminal.events.at(-2);
    assert.equal(correctionBriefEvent.event_type, 'task_brief_updated');
    assert.equal(correctionBriefEvent.payload.task_capsule.status, 'discussing');

    const work = item.service.begin_work({
      project_id: PROJECT_ID,
      instruction: '新建一个干净的项目首页。',
      request_digest: REQUEST_DIGEST,
      base_revision: null,
      route_decision_hint: {
        route: 'build',
        confidence: 'high',
        matched_signals: ['clear_build'],
        downgraded_from: null,
        downgrade_reason: null,
        required_permissions: ['write_project'],
        permission_result: 'allowed',
        dispatch: 'build',
      },
    });
    const snapshotted = item.service.record_run_context_snapshot({
      context: work,
      working_context_state: null,
      project_understanding: null,
      context_assembly: null,
      provider_context_projection: null,
      provider_context_prompt_egress_gate: null,
    });
    const snapshot = snapshotted.events.at(-1).payload.snapshot;

    assert.deepEqual(snapshot.included_message_ids, [work.ids.message_id]);
    assert.deepEqual(snapshot.brief_reference, {
      status: 'not_available',
      task_id: null,
      source_message_id: null,
      last_route_decision_id: null,
      contextual_build_ready: false,
    });
  } finally {
    item.close();
  }
});

test('records a proposed plan from a run-bound plan record after successful tool context', async () => {
  const item = fixture();
  let restartedDatabase = null;
  try {
    const context = begin(item.service);
    const call = await toolCallRecord(context);
    const requested = item.service.record_tool_call_request({
      context,
      tool_call_record: call,
    });
    const resultRecord = toolResultRecord(call, {
      result: {
        status: 'succeeded',
        summary_code: 'completed_without_raw_output',
      },
    });
    const settled = item.service.record_tool_result({
      context: requested,
      runtime_invocation_admission: resultRecord.runtime_invocation_admission,
      tool_result_record: resultRecord,
    });
    assert.equal(settled.start_head.sequence, 4);

    const sourceContext = sourceContextResult(settled, {
      reads: [{
        resource_id: 'project:/src/app.tsx',
        status: 'succeeded',
        tool_call_id: call.tool_call_id,
      }],
    });
    const plan = planProposalRecord(settled, { source_context_result: sourceContext });
    const terminal = item.service.complete_plan({
      context: settled,
      source_context_result: sourceContext,
      plan_proposal_record: plan,
    });

    assert.equal(terminal.head.sequence, 6);
    assert.equal(terminal.snapshot.active_turn_id, null);
    assert.equal(terminal.snapshot.turns[0].outcome, 'plan_proposed');
    assert.equal(terminal.snapshot.turns[0].runs[0].result_kind, 'plan');
    assert.equal(terminal.snapshot.turns[0].runs[0].result_digest, plan.record_digest);
    assert.equal(terminal.snapshot.turns[0].runs[0].candidate_result, null);
    assert.match(terminal.snapshot.turns[0].messages[1].text, /Review the change plan/u);
    assert.match(terminal.snapshot.turns[0].messages[1].text, /1\. Confirm the intended update/u);

    const stream = item.service.read_stream({ project_id: PROJECT_ID });
    assert.equal(stream.conversation.head_sequence, 6);
    assert.equal(stream.conversation.items[2].item_kind, 'tool_call_requested');
    assert.equal(stream.conversation.items[3].item_kind, 'tool_call_result_recorded');
    assert.equal(stream.conversation.items[4].result_kind, 'plan');
    assert.equal(stream.conversation.items[4].candidate, null);
    assert.equal(stream.conversation.items[5].outcome, 'plan_proposed');
    assert.doesNotMatch(
      JSON.stringify(stream),
      /export const|src\/app|private_source_context|context_digest|head_digest|record_digest|provider|credential|git_candidate_receipt|commit_oid|tree_oid|revision_receipt|save_admission/iu,
    );

    assert.throws(
      () => item.service.read_approved_plan({
        project_id: PROJECT_ID,
        conversation_id: context.conversation.conversation_id,
        turn_id: context.ids.turn_id,
        run_id: context.ids.run_id,
      }),
      { code: 'builder_conversation_main_service_unavailable' },
    );
    const reviewed = item.service.review_plan({
      project_id: PROJECT_ID,
      conversation_id: context.conversation.conversation_id,
      turn_id: context.ids.turn_id,
      run_id: context.ids.run_id,
      decision: 'approved',
    });
    assert.deepEqual(reviewed, {
      result_version: 'builder-conversation-plan-review-result.v1',
      project_id: PROJECT_ID,
      conversation_id: context.conversation.conversation_id,
      turn_id: context.ids.turn_id,
      run_id: context.ids.run_id,
      decision: 'approved',
      review_admission: 'sqlite_recorded_no_execution',
    });
    const reviewedStream = item.service.read_stream({ project_id: PROJECT_ID });
    assert.equal(reviewedStream.conversation.head_sequence, 7);
    assert.deepEqual(reviewedStream.conversation.items.at(-1), {
      item_kind: 'plan_reviewed',
      sequence: 7,
      turn_id: context.ids.turn_id,
      run_id: context.ids.run_id,
      decision: 'approved',
      plan_state: 'approved',
    });
    assert.doesNotMatch(
      JSON.stringify(reviewedStream),
      /plan_result_digest|review_id|reviewer_id|reviewed_at_ms|export const|src\/app|private_source_context|context_digest|head_digest|record_digest|provider|credential|git_candidate_receipt|commit_oid|tree_oid|revision_receipt|save_admission/iu,
    );
    const approvedPlan = item.service.read_approved_plan({
      project_id: PROJECT_ID,
      conversation_id: context.conversation.conversation_id,
      turn_id: context.ids.turn_id,
      run_id: context.ids.run_id,
    });
    assert.equal(approvedPlan.result_version, APPROVED_PLAN_READ_RESULT_VERSION);
    assert.equal(approvedPlan.project_id, PROJECT_ID);
    assert.equal(approvedPlan.conversation_id, context.conversation.conversation_id);
    assert.equal(approvedPlan.turn_id, context.ids.turn_id);
    assert.equal(approvedPlan.task_id, context.ids.task_id);
    assert.equal(approvedPlan.run_id, context.ids.run_id);
    assert.equal(approvedPlan.decision, 'approved');
    assert.equal(approvedPlan.plan_result_digest, plan.record_digest);
    assert.equal(
      approvedPlan.approved_plan_public_text,
      terminal.snapshot.turns[0].messages[1].text,
    );
    assert.equal(approvedPlan.conversation_head.sequence, 7);
    assert.equal(approvedPlan.authority.conversation, 'sqlite_replay_current_head_verified');
    assert.equal(approvedPlan.authority.plan_review, 'approved_current_head');
    assert.equal(approvedPlan.authority.renderer_authority, 'not_present');
    assert.equal(approvedPlan.authority.provider_dispatch, false);
    assert.equal(approvedPlan.authority.tool_dispatch, 'not_performed');
    assert.equal(approvedPlan.authority.source_mutation, 'not_performed');
    assert.equal(approvedPlan.authority.git_authority, 'not_present');
    assert.equal(approvedPlan.authority.revision_admission, 'not_created');
    assert.equal(Object.isFrozen(approvedPlan), true);
    assert.equal(Object.isFrozen(approvedPlan.authority), true);
    assert.doesNotMatch(
      JSON.stringify(approvedPlan),
      /review_id|reviewer_id|reviewed_at_ms|export const|src\/app|private_source_context|context_digest|head_digest|provider_config|provider_secret|credential|base_url|model|git_candidate_receipt|commit_oid|tree_oid|revision_receipt|save_admission/iu,
    );
    const continuation = item.service.admit_approved_plan_continuation({
      project_id: PROJECT_ID,
      conversation_id: context.conversation.conversation_id,
      turn_id: context.ids.turn_id,
      run_id: context.ids.run_id,
    });
    assert.equal(
      continuation.admission_version,
      BUILDER_APPROVED_PLAN_CONTINUATION_ADMISSION_VERSION,
    );
    assert.equal(continuation.approved_plan_result_version, APPROVED_PLAN_READ_RESULT_VERSION);
    assert.equal(continuation.project_id, PROJECT_ID);
    assert.equal(continuation.conversation_id, context.conversation.conversation_id);
    assert.equal(continuation.turn_id, context.ids.turn_id);
    assert.equal(continuation.task_id, context.ids.task_id);
    assert.equal(continuation.run_id, context.ids.run_id);
    assert.equal(continuation.decision, 'approved');
    assert.equal(continuation.plan_result_digest, plan.record_digest);
    assert.deepEqual(continuation.conversation_head, approvedPlan.conversation_head);
    assert.match(continuation.continuation_id, /^builder-approved-plan-continuation:/u);
    assert.equal(continuation.lifecycle.continuation_admission, 'admitted_without_starting_run');
    assert.equal(continuation.lifecycle.provider_dispatch, 'not_started');
    assert.equal(continuation.lifecycle.tool_dispatch, 'not_started');
    assert.equal(continuation.lifecycle.source_mutation, 'not_performed');
    assert.equal(continuation.lifecycle.git_authority, 'not_present');
    assert.equal(continuation.lifecycle.revision_admission, 'not_created');
    assert.equal(continuation.authority.conversation_binding, 'approved_plan_read_current_head_required');
    assert.equal(continuation.authority.provider_dispatch, false);
    assert.equal(continuation.authority.credential_readback, false);
    assert.equal(continuation.authority.tool_dispatch, 'not_performed');
    assert.equal(continuation.authority.source_mutation, 'not_performed');
    assert.equal(continuation.authority.git_authority, 'not_present');
    assert.equal(continuation.authority.revision_authority, 'not_present');
    assert.deepEqual(sanitizeBuilderApprovedPlanContinuationAdmission(continuation), continuation);
    assert.equal(
      item.service.read_stream({ project_id: PROJECT_ID }).conversation.head_sequence,
      7,
    );
    assert.doesNotMatch(
      JSON.stringify(continuation),
      /review_id|reviewer_id|reviewed_at_ms|export const|src\/app|private_source_context|context_digest|source_tree|provider_config|provider_secret|credential_secret|credential_value|secret_ref|api[_-]?key|base_url|model|git_candidate_receipt|commit_oid|tree_oid|revision_receipt|save_admission/iu,
    );
    assert.throws(
      () => item.service.review_plan({
        project_id: PROJECT_ID,
        conversation_id: context.conversation.conversation_id,
        turn_id: context.ids.turn_id,
        run_id: context.ids.run_id,
        decision: 'rejected',
      }),
      { code: 'builder_conversation_main_service_unavailable' },
    );
    assert.throws(
      () => item.service.review_plan({
        project_id: PROJECT_ID,
        conversation_id: context.conversation.conversation_id,
        turn_id: context.ids.turn_id,
        run_id: context.ids.run_id,
        decision: 'accepted',
      }),
      { code: 'builder_conversation_main_service_unavailable' },
    );

    item.database.close();
    restartedDatabase = createBuilderProductMetadataDatabase(
      path.join(item.root, 'builder.sqlite'),
    );
    const restartedService = createBuilderConversationMainService({
      metadataAuthority: restartedDatabase,
      createUuid: uuidFactory(900),
      nowMs: () => 9_000,
    });
    assert.deepEqual(restartedService.read_stream({ project_id: PROJECT_ID }), reviewedStream);
    assert.deepEqual(
      restartedService.read_approved_plan({
        project_id: PROJECT_ID,
        conversation_id: context.conversation.conversation_id,
        turn_id: context.ids.turn_id,
        run_id: context.ids.run_id,
      }),
      approvedPlan,
    );
    const restartedContinuation = restartedService.admit_approved_plan_continuation({
      project_id: PROJECT_ID,
      conversation_id: context.conversation.conversation_id,
      turn_id: context.ids.turn_id,
      run_id: context.ids.run_id,
    });
    assert.equal(restartedContinuation.project_id, continuation.project_id);
    assert.equal(restartedContinuation.conversation_id, continuation.conversation_id);
    assert.equal(restartedContinuation.plan_result_digest, continuation.plan_result_digest);
    assert.deepEqual(restartedContinuation.conversation_head, continuation.conversation_head);
    assert.notEqual(restartedContinuation.continuation_id, continuation.continuation_id);
  } finally {
    if (restartedDatabase !== null) restartedDatabase.close();
    else item.database.close();
    removeRoot(item.root);
  }
});

test('records a proposed plan from an empty run-bound source context', async () => {
  const item = fixture();
  try {
    const context = begin(item.service);
    const sourceContext = sourceContextResult(context, {
      private_source_context: {
        context_version: 'builder-private-source-context.v1',
        files: [],
      },
      reads: [],
    });
    const plan = planProposalRecord(context, { source_context_result: sourceContext });
    const terminal = item.service.complete_plan({
      context,
      source_context_result: sourceContext,
      plan_proposal_record: plan,
    });

    assert.equal(terminal.head.sequence, 4);
    assert.equal(terminal.snapshot.active_turn_id, null);
    assert.equal(terminal.snapshot.turns[0].outcome, 'plan_proposed');
    assert.equal(terminal.snapshot.turns[0].runs[0].result_kind, 'plan');
    assert.equal(terminal.snapshot.turns[0].runs[0].result_digest, plan.record_digest);
    assert.equal(terminal.snapshot.turns[0].runs[0].candidate_result, null);

    const stream = item.service.read_stream({ project_id: PROJECT_ID });
    assert.equal(stream.conversation.head_sequence, 4);
    assert.equal(stream.conversation.items[2].result_kind, 'plan');
    assert.equal(stream.conversation.items[2].candidate, null);
    assert.equal(stream.conversation.items[3].outcome, 'plan_proposed');
    assert.doesNotMatch(
      JSON.stringify(stream),
      /private_source_context|context_digest|head_digest|record_digest|provider|credential|git_candidate_receipt|commit_oid|tree_oid|revision_receipt|save_admission/iu,
    );
  } finally {
    item.close();
  }
});

test('reads only the current approved plan and rejects stale or rejected plan facts', async () => {
  const approvedItem = fixture();
  const rejectedItem = fixture(300, 3_000);
  try {
    const approvedContext = begin(approvedItem.service);
    const call = await toolCallRecord(approvedContext);
    const requested = approvedItem.service.record_tool_call_request({
      context: approvedContext,
      tool_call_record: call,
    });
    const resultRecord = toolResultRecord(call, {
      result: {
        status: 'succeeded',
        summary_code: 'completed_without_raw_output',
      },
    });
    const settled = approvedItem.service.record_tool_result({
      context: requested,
      runtime_invocation_admission: resultRecord.runtime_invocation_admission,
      tool_result_record: resultRecord,
    });
    const sourceContext = sourceContextResult(settled, {
      reads: [{
        resource_id: 'project:/src/app.tsx',
        status: 'succeeded',
        tool_call_id: call.tool_call_id,
      }],
    });
    approvedItem.service.complete_plan({
      context: settled,
      source_context_result: sourceContext,
      plan_proposal_record: planProposalRecord(settled, { source_context_result: sourceContext }),
    });
    approvedItem.service.review_plan({
      project_id: PROJECT_ID,
      conversation_id: approvedContext.conversation.conversation_id,
      turn_id: approvedContext.ids.turn_id,
      run_id: approvedContext.ids.run_id,
      decision: 'approved',
    });
    const approvedPlan = approvedItem.service.read_approved_plan({
        project_id: PROJECT_ID,
        conversation_id: approvedContext.conversation.conversation_id,
        turn_id: approvedContext.ids.turn_id,
        run_id: approvedContext.ids.run_id,
      });
    assert.equal(approvedPlan.decision, 'approved');
    const approvedWork = approvedItem.service.begin_approved_plan_work({
      project_id: PROJECT_ID,
      conversation_id: approvedContext.conversation.conversation_id,
      turn_id: approvedContext.ids.turn_id,
      run_id: approvedContext.ids.run_id,
      instruction: approvedPlan.approved_plan_public_text,
      request_digest: CANDIDATE_DIGEST,
      base_revision: BASE_REVISION,
    });
    assert.equal(approvedWork.mode, 'work');
    assert.equal(approvedWork.request_digest, CANDIDATE_DIGEST);
    assert.equal(approvedWork.start_head.sequence, 9);
    assert.equal(approvedWork.events.at(-2).event_type, 'turn_submitted');
    assert.equal(approvedWork.events.at(-2).previous_event.sequence, 7);
    assert.equal(approvedWork.events.at(-2).payload.route_decision.route, 'build');
    assert.equal(approvedWork.events.at(-2).payload.route_decision.dispatch, 'build');
    assert.deepEqual(
      approvedWork.events.at(-2).payload.route_decision.matched_signals,
      ['approved_plan_continuation'],
    );
    assert.deepEqual(
      approvedWork.events.at(-2).payload.route_decision.required_permissions,
      ['write_project'],
    );
    assert.equal(approvedWork.events.at(-1).event_type, 'run_started');
    assert.equal(approvedWork.events.at(-1).payload.input_digest, CANDIDATE_DIGEST);
    assert.throws(
      () => approvedItem.service.read_approved_plan({
        project_id: PROJECT_ID,
        conversation_id: approvedContext.conversation.conversation_id,
        turn_id: approvedContext.ids.turn_id,
        run_id: approvedContext.ids.run_id,
      }),
      { code: 'builder_conversation_main_service_unavailable' },
    );
    assert.throws(
      () => approvedItem.service.admit_approved_plan_continuation({
        project_id: PROJECT_ID,
        conversation_id: approvedContext.conversation.conversation_id,
        turn_id: approvedContext.ids.turn_id,
        run_id: approvedContext.ids.run_id,
      }),
      { code: 'builder_conversation_main_service_unavailable' },
    );

    const rejectedContext = begin(rejectedItem.service);
    const rejectedCall = await toolCallRecord(rejectedContext);
    const rejectedRequested = rejectedItem.service.record_tool_call_request({
      context: rejectedContext,
      tool_call_record: rejectedCall,
    });
    const rejectedResultRecord = toolResultRecord(rejectedCall, {
      result: {
        status: 'succeeded',
        summary_code: 'completed_without_raw_output',
      },
    });
    const rejectedSettled = rejectedItem.service.record_tool_result({
      context: rejectedRequested,
      runtime_invocation_admission: rejectedResultRecord.runtime_invocation_admission,
      tool_result_record: rejectedResultRecord,
    });
    const rejectedSourceContext = sourceContextResult(rejectedSettled, {
      reads: [{
        resource_id: 'project:/src/app.tsx',
        status: 'succeeded',
        tool_call_id: rejectedCall.tool_call_id,
      }],
    });
    rejectedItem.service.complete_plan({
      context: rejectedSettled,
      source_context_result: rejectedSourceContext,
      plan_proposal_record: planProposalRecord(rejectedSettled, { source_context_result: rejectedSourceContext }),
    });
    rejectedItem.service.review_plan({
      project_id: PROJECT_ID,
      conversation_id: rejectedContext.conversation.conversation_id,
      turn_id: rejectedContext.ids.turn_id,
      run_id: rejectedContext.ids.run_id,
      decision: 'rejected',
    });
    assert.throws(
      () => rejectedItem.service.read_approved_plan({
        project_id: PROJECT_ID,
        conversation_id: rejectedContext.conversation.conversation_id,
        turn_id: rejectedContext.ids.turn_id,
        run_id: rejectedContext.ids.run_id,
      }),
      { code: 'builder_conversation_main_service_unavailable' },
    );
    assert.throws(
      () => rejectedItem.service.admit_approved_plan_continuation({
        project_id: PROJECT_ID,
        conversation_id: rejectedContext.conversation.conversation_id,
        turn_id: rejectedContext.ids.turn_id,
        run_id: rejectedContext.ids.run_id,
      }),
      { code: 'builder_conversation_main_service_unavailable' },
    );
  } finally {
    approvedItem.close();
    rejectedItem.close();
  }
});

test('rejects stale, pending, failed, or forged plan proposal completion without partial events', async () => {
  const item = fixture();
  try {
    const context = begin(item.service);
    const call = await toolCallRecord(context);
    const requested = item.service.record_tool_call_request({
      context,
      tool_call_record: call,
    });
    const pendingSourceContext = sourceContextResult(requested, {
      reads: [{
        resource_id: 'project:/src/app.tsx',
        status: 'succeeded',
        tool_call_id: call.tool_call_id,
      }],
    });
    const pendingPlan = planProposalRecord(requested, { source_context_result: pendingSourceContext });
    assert.throws(() => item.service.complete_plan({
      context: requested,
      source_context_result: pendingSourceContext,
      plan_proposal_record: pendingPlan,
    }), { code: 'builder_conversation_main_service_unavailable' });
    assert.equal(item.service.read_stream({ project_id: PROJECT_ID }).conversation.head_sequence, 3);

    const failedResult = toolResultRecord(call);
    const failed = item.service.record_tool_result({
      context: requested,
      runtime_invocation_admission: failedResult.runtime_invocation_admission,
      tool_result_record: failedResult,
    });
    const failedSourceContext = sourceContextResult(failed, {
      reads: [{
        resource_id: 'project:/src/app.tsx',
        status: 'succeeded',
        tool_call_id: call.tool_call_id,
      }],
    });
    assert.throws(() => item.service.complete_plan({
      context: failed,
      source_context_result: failedSourceContext,
      plan_proposal_record: planProposalRecord(failed, { source_context_result: failedSourceContext }),
    }), { code: 'builder_conversation_main_service_unavailable' });
    assert.equal(item.service.read_stream({ project_id: PROJECT_ID }).conversation.head_sequence, 4);
  } finally {
    item.close();
  }

  const drift = fixture();
  try {
    const context = begin(drift.service);
    const call = await toolCallRecord(context);
    const requested = drift.service.record_tool_call_request({
      context,
      tool_call_record: call,
    });
    const resultRecord = toolResultRecord(call, {
      result: {
        status: 'succeeded',
        summary_code: 'completed_without_raw_output',
      },
    });
    const settled = drift.service.record_tool_result({
      context: requested,
      runtime_invocation_admission: resultRecord.runtime_invocation_admission,
      tool_result_record: resultRecord,
    });
    const sourceContext = sourceContextResult(settled, {
      reads: [{
        resource_id: 'project:/src/app.tsx',
        status: 'succeeded',
        tool_call_id: call.tool_call_id,
      }],
    });
    const plan = planProposalRecord(settled, { source_context_result: sourceContext });
    assert.throws(() => drift.service.complete_plan({
      context,
      source_context_result: sourceContext,
      plan_proposal_record: plan,
    }), { code: 'builder_conversation_main_service_unavailable' });
    assert.throws(() => drift.service.complete_plan({
      context: settled,
      source_context_result: sourceContext,
      plan_proposal_record: {
        ...plan,
        project_id: 'builder-project:22222222-2222-4222-8222-222222222222',
      },
    }), { code: 'builder_conversation_main_service_unavailable' });
    assert.throws(() => drift.service.complete_plan({
      context: settled,
      source_context_result: sourceContext,
      plan_proposal_record: {
        ...plan,
        proposed_at_ms: 99_999,
      },
    }), { code: 'builder_conversation_main_service_unavailable' });
    assert.equal(drift.service.read_stream({ project_id: PROJECT_ID }).conversation.head_sequence, 4);
  } finally {
    drift.close();
  }
});

test('restores the same renderer-safe task stream after a real database restart', () => {
  const item = fixture();
  let restartedDatabase = null;
  try {
    const context = begin(item.service);
    item.service.complete_candidate({
      context,
      candidate_result: candidateResult(context),
      assistant_text: 'A timer draft is ready to review.',
    });
    const before = item.service.read_stream({ project_id: PROJECT_ID });
    assert.equal(before.stream_version, 'builder-task-stream-read-result.v1');
    assert.equal(before.conversation.head_sequence, 4);
    assert.equal(before.conversation.items[1].recorded_state, 'started');
    assert.equal(before.conversation.items[2].candidate.candidate_state, 'proposed');
    assert.equal(before.conversation.items[2].candidate.source_availability, 'not_loaded');
    assert.doesNotMatch(
      JSON.stringify(before),
      /git_candidate_receipt|candidate_digest|commit_oid|tree_oid|credential|provider|running|save_admission/iu,
    );

    item.database.close();
    restartedDatabase = createBuilderProductMetadataDatabase(
      path.join(item.root, 'builder.sqlite'),
    );
    const restartedService = createBuilderConversationMainService({
      metadataAuthority: restartedDatabase,
      createUuid: uuidFactory(300),
      nowMs: () => 3_000,
    });
    assert.deepEqual(restartedService.read_stream({ project_id: PROJECT_ID }), before);
  } finally {
    if (restartedDatabase !== null) restartedDatabase.close();
    try { item.database.close(); } catch { /* already closed during restart check */ }
    removeRoot(item.root);
  }
});

test('records main-only tool request and fixed-code result facts without dispatching tools', async () => {
  const item = fixture();
  let restartedDatabase = null;
  try {
    const context = begin(item.service);
    const callRecord = await toolCallRecord(context);
    const requestedContext = item.service.record_tool_call_request({
      context,
      tool_call_record: callRecord,
    });
    assert.equal(requestedContext.start_head.sequence, 3);
    assert.equal(requestedContext.events.at(-1).event_type, 'tool_call_requested');

    const dispatchAdmission = item.service.admit_tool_dispatch({
      context: requestedContext,
      tool_call_id: TOOL_CALL_ID,
    });
    assert.equal(dispatchAdmission.admission_version, 'builder-tool-dispatch-admission.v1');
    assert.equal(dispatchAdmission.admission_kind, 'builder_tool_dispatch_admission');
    assert.equal(dispatchAdmission.tool_call_id, TOOL_CALL_ID);
    assert.equal(dispatchAdmission.record_digest, callRecord.record_digest);
    assert.equal(dispatchAdmission.authority.tool_dispatch, 'not_performed');
    assert.equal(dispatchAdmission.authority.adapter_selection, 'not_selected');
    assert.equal(dispatchAdmission.lifecycle.execution_admission, 'not_started');
    assert.equal(
      item.service.read_stream({ project_id: PROJECT_ID }).conversation.head_sequence,
      3,
    );

    const selectionAdmission = item.service.select_tool_adapter({
      context: requestedContext,
      tool_call_id: TOOL_CALL_ID,
      adapter_id: FILESYSTEM_READ_TOOL_ADAPTER_ID,
    });
    assert.equal(selectionAdmission.admission_version, 'builder-tool-adapter-selection-admission.v1');
    assert.equal(selectionAdmission.admission_kind, 'builder_tool_adapter_selection_admission');
    assert.equal(selectionAdmission.tool_call_id, TOOL_CALL_ID);
    assert.equal(selectionAdmission.record_digest, callRecord.record_digest);
    assert.equal(selectionAdmission.adapter_id, FILESYSTEM_READ_TOOL_ADAPTER_ID);
    assert.equal(selectionAdmission.action, 'filesystem.read');
    assert.equal(selectionAdmission.resource_kind, 'filesystem');
    assert.equal(selectionAdmission.authority.tool_dispatch, 'not_performed');
    assert.equal(selectionAdmission.authority.runtime_execution, 'not_started');
    assert.equal(selectionAdmission.lifecycle.execution_admission, 'not_started');
    assert.doesNotMatch(
      JSON.stringify(selectionAdmission),
      /resource_id|permission_id|permission_admission_receipt|source_tree|file_content|stdout|stderr|output_digest/iu,
    );
    assert.equal(
      item.service.read_stream({ project_id: PROJECT_ID }).conversation.head_sequence,
      3,
    );

    const runtimeAdmission = item.service.admit_tool_runtime_invocation({
      context: requestedContext,
      tool_call_id: TOOL_CALL_ID,
      adapter_selection_admission: selectionAdmission,
      runtime_id: FILESYSTEM_READ_TOOL_RUNTIME_ID,
    });
    assert.equal(runtimeAdmission.admission_version, 'builder-tool-runtime-invocation-admission.v1');
    assert.equal(runtimeAdmission.admission_kind, 'builder_tool_runtime_invocation_admission');
    assert.equal(runtimeAdmission.tool_call_id, TOOL_CALL_ID);
    assert.equal(runtimeAdmission.record_digest, callRecord.record_digest);
    assert.equal(runtimeAdmission.dispatch_request_id, selectionAdmission.dispatch_request_id);
    assert.equal(runtimeAdmission.dispatch_admission_digest, selectionAdmission.dispatch_admission_digest);
    assert.equal(runtimeAdmission.adapter_selection_id, selectionAdmission.adapter_selection_id);
    assert.equal(runtimeAdmission.adapter_selection_digest, selectionAdmission.admission_digest);
    assert.equal(runtimeAdmission.adapter_id, FILESYSTEM_READ_TOOL_ADAPTER_ID);
    assert.equal(runtimeAdmission.runtime_id, FILESYSTEM_READ_TOOL_RUNTIME_ID);
    assert.equal(runtimeAdmission.action, 'filesystem.read');
    assert.equal(runtimeAdmission.resource_kind, 'filesystem');
    assert.equal(runtimeAdmission.max_raw_output_bytes, 0);
    assert.equal(runtimeAdmission.max_chargeable_dispatches, 0);
    assert.equal(runtimeAdmission.authority.tool_dispatch, 'not_performed');
    assert.equal(runtimeAdmission.authority.runtime_execution, 'not_started');
    assert.equal(runtimeAdmission.authority.filesystem_read, 'not_performed');
    assert.equal(runtimeAdmission.lifecycle.runtime_admission, 'bounded_envelope_admitted');
    assert.equal(runtimeAdmission.lifecycle.execution_admission, 'not_started');
    assert.doesNotMatch(
      JSON.stringify(runtimeAdmission),
      /resource_id|permission_id|permission_admission_receipt|source_tree|file_content|stdout|stderr|output_digest/iu,
    );
    assert.equal(
      item.service.read_stream({ project_id: PROJECT_ID }).conversation.head_sequence,
      3,
    );

    const resultRecord = toolResultRecord(callRecord, {
      runtime_invocation_admission: runtimeAdmission,
    });
    const resultContext = item.service.record_tool_result({
      context: requestedContext,
      runtime_invocation_admission: runtimeAdmission,
      tool_result_record: resultRecord,
    });
    assert.equal(resultContext.start_head.sequence, 4);
    assert.equal(resultContext.events.at(-1).event_type, 'tool_call_result_recorded');

    const pendingStream = item.service.read_stream({ project_id: PROJECT_ID });
    assert.equal(pendingStream.conversation.head_sequence, 4);
    assert.deepEqual(pendingStream.conversation.items[2], {
      item_kind: 'tool_call_requested',
      sequence: 3,
      turn_id: context.ids.turn_id,
      run_id: context.ids.run_id,
      step_id: TOOL_STEP_ID,
      tool_call_id: TOOL_CALL_ID,
      tool_label: 'Read project file',
      action: 'filesystem.read',
      resource: {
        resource_kind: 'filesystem',
      },
      lifecycle: {
        permission_admission: 'verified_allowed',
        dispatch_admission: 'not_started',
        execution_admission: 'not_performed',
        result_admission: 'not_recorded',
      },
      recorded_state: 'requested',
    });
    assert.deepEqual(pendingStream.conversation.items[3], {
      item_kind: 'tool_call_result_recorded',
      sequence: 4,
      turn_id: context.ids.turn_id,
      run_id: context.ids.run_id,
      step_id: TOOL_STEP_ID,
      tool_call_id: TOOL_CALL_ID,
      tool_label: 'Read project file',
      action: 'filesystem.read',
      resource: {
        resource_kind: 'filesystem',
      },
      result: {
        status: 'failed',
        summary_code: 'output_rejected',
        display_summary: 'The tool output was not accepted.',
      },
      lifecycle: {
        result_admission: 'fixed_summary_code_recorded',
        raw_output_admission: 'not_included',
        revision_admission: 'not_created',
      },
      recorded_state: 'recorded',
    });
    assert.doesNotMatch(
      JSON.stringify(pendingStream),
      /tool_result_record|tool_call_record|session_policy|permission_id|permission_admission_receipt|record_digest|summary_digest|policy_digest|dispatch_request_id|dispatch_admission_digest|adapter_selection_id|adapter_selection_digest|runtime_invocation_id|runtime_invocation_digest|runtime_invocation_admission|adapter_id|runtime_id|resource_id|project:\/src\/app\.tsx|stdout|stderr|output_digest|git_candidate_receipt|commit_oid|tree_oid|provider|credential|source_tree|save_admission/iu,
    );

    const completed = item.service.complete_failure({
      context: resultContext,
      failure_code: 'builder_tool_step_failed',
    });
    assert.equal(completed.head.sequence, 6);
    assert.equal(completed.snapshot.turns[0].outcome, 'failed');
    assert.equal(completed.snapshot.turns[0].runs[0].terminal_status, 'failed');

    const completedStream = item.service.read_stream({ project_id: PROJECT_ID });
    assert.equal(completedStream.conversation.head_sequence, 6);
    assert.equal(completedStream.conversation.recorded_active_turn_id, null);
    assert.equal(completedStream.conversation.items[4].terminal_status, 'failed');
    assert.equal(completedStream.conversation.items[5].outcome, 'failed');
    assert.doesNotMatch(
      JSON.stringify(completedStream),
      /running|live_run|save_admission|revision_receipt|provider|credential/iu,
    );

    item.database.close();
    restartedDatabase = createBuilderProductMetadataDatabase(
      path.join(item.root, 'builder.sqlite'),
    );
    const restartedService = createBuilderConversationMainService({
      metadataAuthority: restartedDatabase,
      createUuid: uuidFactory(500),
      nowMs: () => 5_000,
    });
    assert.deepEqual(restartedService.read_stream({ project_id: PROJECT_ID }), completedStream);
  } finally {
    if (restartedDatabase !== null) restartedDatabase.close();
    try { item.database.close(); } catch { /* already closed during restart check */ }
    removeRoot(item.root);
  }
});

test('rejects invalid main-only tool fact recording without committing partial events', async () => {
  const item = fixture();
  const questionItem = fixture(700);
  try {
    const context = begin(item.service);
    const question = beginQuestion(questionItem.service);
    const callRecord = await toolCallRecord(context);
    const resultRecord = toolResultRecord(callRecord);
    const staleContext = Object.freeze({
      ...context,
      start_head: { ...context.start_head },
      events: context.events,
    });
    const otherRecord = await toolCallRecord(context, {
      admission: {
        request: {
          tool_call_id: 'builder-tool-call:11111111-1111-4111-8111-111111111115',
        },
      },
      record: {
        run_id: 'builder-run:11111111-1111-4111-8111-111111111119',
        step_id: 'builder-run-step:11111111-1111-4111-8111-111111111116',
      },
    });
    const futureRecord = await toolCallRecord(context, {
      admission: {
        request: {
          tool_call_id: 'builder-tool-call:11111111-1111-4111-8111-111111111117',
        },
      },
      record: {
        step_id: 'builder-run-step:11111111-1111-4111-8111-111111111118',
        requested_at_ms: 99_999,
      },
    });

    for (const action of [
      () => item.service.record_tool_call_request({
        context: staleContext,
        tool_call_record: callRecord,
      }),
      () => item.service.record_tool_call_request({
        context: question,
        tool_call_record: callRecord,
      }),
      () => item.service.record_tool_call_request({
        context,
        tool_call_record: otherRecord,
      }),
      () => item.service.record_tool_call_request({
        context,
        tool_call_record: futureRecord,
      }),
      () => item.service.record_tool_result({
        context,
        runtime_invocation_admission: resultRecord.runtime_invocation_admission,
        tool_result_record: resultRecord,
      }),
      () => item.service.admit_tool_dispatch({
        context,
        tool_call_id: TOOL_CALL_ID,
      }),
      () => item.service.select_tool_adapter({
        context,
        tool_call_id: TOOL_CALL_ID,
        adapter_id: FILESYSTEM_READ_TOOL_ADAPTER_ID,
      }),
      () => item.service.admit_tool_runtime_invocation({
        context,
        tool_call_id: TOOL_CALL_ID,
        adapter_selection_admission: {},
        runtime_id: FILESYSTEM_READ_TOOL_RUNTIME_ID,
      }),
    ]) {
      assert.throws(action, { code: 'builder_conversation_main_service_unavailable' });
    }
    assert.equal(item.service.read_stream({ project_id: PROJECT_ID }).conversation.head_sequence, 2);

    const requestedContext = item.service.record_tool_call_request({
      context,
      tool_call_record: callRecord,
    });
    assert.throws(() => item.service.select_tool_adapter({
      context: requestedContext,
      tool_call_id: TOOL_CALL_ID,
      adapter_id: 'builder-tool-adapter.project-edit.v1',
    }), { code: 'builder_conversation_main_service_unavailable' });
    const selectionAdmission = item.service.select_tool_adapter({
      context: requestedContext,
      tool_call_id: TOOL_CALL_ID,
      adapter_id: FILESYSTEM_READ_TOOL_ADAPTER_ID,
    });
    assert.throws(() => item.service.admit_tool_runtime_invocation({
      context: requestedContext,
      tool_call_id: TOOL_CALL_ID,
      adapter_selection_admission: selectionAdmission,
      runtime_id: 'builder-tool-runtime.project-edit.v1',
    }), { code: 'builder_conversation_main_service_unavailable' });
    assert.throws(() => item.service.admit_tool_runtime_invocation({
      context: requestedContext,
      tool_call_id: TOOL_CALL_ID,
      adapter_selection_admission: {
        ...selectionAdmission,
        adapter_selection_id: 'builder-tool-adapter-selection:00000000-0000-4000-8000-000000000999',
      },
      runtime_id: FILESYSTEM_READ_TOOL_RUNTIME_ID,
    }), { code: 'builder_conversation_main_service_unavailable' });
    const runtimeAdmission = item.service.admit_tool_runtime_invocation({
      context: requestedContext,
      tool_call_id: TOOL_CALL_ID,
      adapter_selection_admission: selectionAdmission,
      runtime_id: FILESYSTEM_READ_TOOL_RUNTIME_ID,
    });
    const runtimeBoundResult = toolResultRecord(callRecord, {
      runtime_invocation_admission: runtimeAdmission,
    });
    const alternateRuntimeAdmission = item.service.admit_tool_runtime_invocation({
      context: requestedContext,
      tool_call_id: TOOL_CALL_ID,
      adapter_selection_admission: selectionAdmission,
      runtime_id: FILESYSTEM_READ_TOOL_RUNTIME_ID,
    });
    assert.notEqual(alternateRuntimeAdmission.admission_digest, runtimeAdmission.admission_digest);
    assert.throws(() => item.service.record_tool_result({
      context: requestedContext,
      runtime_invocation_admission: alternateRuntimeAdmission,
      tool_result_record: runtimeBoundResult,
    }), { code: 'builder_conversation_main_service_unavailable' });
    assert.throws(() => item.service.record_tool_result({
      context: requestedContext,
      runtime_invocation_admission: {
        ...runtimeAdmission,
        runtime_invocation_id: 'builder-tool-runtime-invocation:00000000-0000-4000-8000-000000000999',
      },
      tool_result_record: runtimeBoundResult,
    }), { code: 'builder_conversation_main_service_unavailable' });
    const resultContext = item.service.record_tool_result({
      context: requestedContext,
      runtime_invocation_admission: runtimeAdmission,
      tool_result_record: runtimeBoundResult,
    });
    assert.throws(() => item.service.record_tool_result({
      context: resultContext,
      runtime_invocation_admission: runtimeAdmission,
      tool_result_record: runtimeBoundResult,
    }), { code: 'builder_conversation_main_service_unavailable' });
    assert.throws(() => item.service.admit_tool_dispatch({
      context: resultContext,
      tool_call_id: TOOL_CALL_ID,
    }), { code: 'builder_conversation_main_service_unavailable' });
    assert.throws(() => item.service.select_tool_adapter({
      context: resultContext,
      tool_call_id: TOOL_CALL_ID,
      adapter_id: FILESYSTEM_READ_TOOL_ADAPTER_ID,
    }), { code: 'builder_conversation_main_service_unavailable' });
    assert.throws(() => item.service.admit_tool_runtime_invocation({
      context: resultContext,
      tool_call_id: TOOL_CALL_ID,
      adapter_selection_admission: selectionAdmission,
      runtime_id: FILESYSTEM_READ_TOOL_RUNTIME_ID,
    }), { code: 'builder_conversation_main_service_unavailable' });
    assert.throws(() => item.service.complete_candidate({
      context: resultContext,
      candidate_result: candidateResult(context),
      assistant_text: 'A timer draft is ready.',
    }), { code: 'builder_conversation_main_service_unavailable' });
  } finally {
    questionItem.close();
    item.close();
  }
});

test('enforces main-only tool session state before appending tool facts', async () => {
  const item = fixture(900);
  const retryItem = fixture(1_000);
  try {
    const context = begin(item.service);
    const first = await toolCallRecord(context);
    const requestedContext = item.service.record_tool_call_request({
      context,
      tool_call_record: first,
    });
    assert.equal(requestedContext.start_head.sequence, 3);

    const pendingSecond = await toolCallRecord(context, {
      admission: {
        request: {
          tool_call_id: 'builder-tool-call:11111111-1111-4111-8111-111111111120',
        },
      },
      record: {
        step_id: 'builder-run-step:11111111-1111-4111-8111-111111111121',
        requested_at_ms: 80,
      },
    });
    assert.throws(() => item.service.record_tool_call_request({
      context: requestedContext,
      tool_call_record: pendingSecond,
    }), { code: 'builder_conversation_main_service_unavailable' });
    assert.equal(item.service.read_stream({ project_id: PROJECT_ID }).conversation.head_sequence, 3);

    const settledContext = item.service.record_tool_result({
      context: requestedContext,
      runtime_invocation_admission: toolRuntimeAdmission(first),
      tool_result_record: toolResultRecord(first, {
        runtime_invocation_admission: toolRuntimeAdmission(first),
        observed_at_ms: 90,
        result: {
          status: 'succeeded',
          summary_code: 'completed_without_raw_output',
        },
      }),
    });
    assert.equal(settledContext.start_head.sequence, 4);

    const driftedPolicy = await toolCallRecord(context, {
      admission: {
        request: {
          tool_call_id: 'builder-tool-call:11111111-1111-4111-8111-111111111122',
        },
      },
      session_policy: { issued_at_ms: 50 },
      record: {
        step_id: 'builder-run-step:11111111-1111-4111-8111-111111111123',
        requested_at_ms: 100,
      },
    });
    assert.throws(() => item.service.record_tool_call_request({
      context: settledContext,
      tool_call_record: driftedPolicy,
    }), { code: 'builder_conversation_main_service_unavailable' });
    assert.equal(item.service.read_stream({ project_id: PROJECT_ID }).conversation.head_sequence, 4);

    const retryContext = begin(retryItem.service);
    const retryPolicy = {
      limits: {
        ...DEFAULT_BUILDER_TOOL_SESSION_LIMITS,
        max_steps: 4,
        max_tool_calls: 4,
        max_retries: 1,
      },
    };
    const retryFirst = await toolCallRecord(retryContext, {
      session_policy: retryPolicy,
      admission: {
        request: {
          tool_call_id: 'builder-tool-call:11111111-1111-4111-8111-111111111124',
        },
      },
      record: {
        step_id: 'builder-run-step:11111111-1111-4111-8111-111111111125',
        requested_at_ms: 60,
      },
    });
    const retryFirstRequested = retryItem.service.record_tool_call_request({
      context: retryContext,
      tool_call_record: retryFirst,
    });
    const retryFirstResult = retryItem.service.record_tool_result({
      context: retryFirstRequested,
      runtime_invocation_admission: toolRuntimeAdmission(retryFirst),
      tool_result_record: toolResultRecord(retryFirst, {
        runtime_invocation_admission: toolRuntimeAdmission(retryFirst),
        observed_at_ms: 70,
      }),
    });
    const retrySecond = await toolCallRecord(retryContext, {
      session_policy: retryPolicy,
      admission: {
        request: {
          tool_call_id: 'builder-tool-call:11111111-1111-4111-8111-111111111126',
        },
      },
      record: {
        step_id: 'builder-run-step:11111111-1111-4111-8111-111111111127',
        requested_at_ms: 80,
      },
    });
    const retrySecondRequested = retryItem.service.record_tool_call_request({
      context: retryFirstResult,
      tool_call_record: retrySecond,
    });
    const retrySecondResult = retryItem.service.record_tool_result({
      context: retrySecondRequested,
      runtime_invocation_admission: toolRuntimeAdmission(retrySecond),
      tool_result_record: toolResultRecord(retrySecond, {
        runtime_invocation_admission: toolRuntimeAdmission(retrySecond),
        observed_at_ms: 90,
      }),
    });
    const exhausted = await toolCallRecord(retryContext, {
      session_policy: retryPolicy,
      admission: {
        request: {
          tool_call_id: 'builder-tool-call:11111111-1111-4111-8111-111111111128',
        },
      },
      record: {
        step_id: 'builder-run-step:11111111-1111-4111-8111-111111111129',
        requested_at_ms: 100,
      },
    });
    assert.throws(() => retryItem.service.record_tool_call_request({
      context: retrySecondResult,
      tool_call_record: exhausted,
    }), { code: 'builder_conversation_main_service_unavailable' });
    assert.equal(retryItem.service.read_stream({ project_id: PROJECT_ID }).conversation.head_sequence, 6);
  } finally {
    retryItem.close();
    item.close();
  }
});

test('uses durable tool record timestamps for replay-equivalent session admission', async () => {
  const item = fixture(1_100);
  try {
    const context = begin(item.service);
    const callRecord = await toolCallRecord(context, {
      admission: { now_ms: 1_002 },
      session_policy: { issued_at_ms: 1_001 },
      record: { requested_at_ms: 1_003 },
    });
    item.setNow(400_000);
    const requestedContext = item.service.record_tool_call_request({
      context,
      tool_call_record: callRecord,
    });
    assert.equal(requestedContext.start_head.sequence, 3);

    const resultRecord = toolResultRecord(callRecord, { observed_at_ms: 1_004 });
    item.setNow(400_001);
    const resultContext = item.service.record_tool_result({
      context: requestedContext,
      runtime_invocation_admission: resultRecord.runtime_invocation_admission,
      tool_result_record: resultRecord,
    });
    assert.equal(resultContext.start_head.sequence, 4);

    const stream = item.service.read_stream({ project_id: PROJECT_ID });
    assert.equal(stream.conversation.head_sequence, 4);
    assert.equal(stream.conversation.items[2].recorded_state, 'requested');
    assert.equal(stream.conversation.items[3].recorded_state, 'recorded');
  } finally {
    item.close();
  }
});

test('restores a main-only candidate draft proof after a real database restart', () => {
  const item = fixture();
  let restartedDatabase = null;
  try {
    const context = begin(item.service);
    const candidate = candidateResult(context);
    item.service.complete_candidate({
      context,
      candidate_result: candidate,
      assistant_text: 'A timer draft is ready to review.',
    });
    const before = item.service.read_candidate_draft({ draft_id: candidate.draft_id });
    assert.equal(before.result_version, 'builder-conversation-candidate-draft-read-result.v1');
    assert.equal(before.draft_id, candidate.draft_id);
    assert.equal(before.conversation_head.sequence, 4);
    assert.equal(before.base_revision, null);
    assert.equal(before.candidate_result.git_candidate_receipt.candidate_digest, CANDIDATE_DIGEST);
    assert.doesNotMatch(JSON.stringify(before), /source_tree|provider|credential|running|live/iu);

    item.database.close();
    restartedDatabase = createBuilderProductMetadataDatabase(
      path.join(item.root, 'builder.sqlite'),
    );
    const restartedService = createBuilderConversationMainService({
      metadataAuthority: restartedDatabase,
      createUuid: uuidFactory(500),
      nowMs: () => 5_000,
    });
    assert.deepEqual(
      restartedService.read_candidate_draft({ draft_id: candidate.draft_id }),
      before,
    );
  } finally {
    if (restartedDatabase !== null) restartedDatabase.close();
    try { item.database.close(); } catch { /* already closed during restart check */ }
    removeRoot(item.root);
  }
});

test('starts draft continuation work only from the current pending candidate head', () => {
  const item = fixture();
  try {
    const context = begin(item.service);
    const candidate = candidateResult(context);
    const terminal = item.service.complete_candidate({
      context,
      candidate_result: candidate,
      assistant_text: 'A timer draft is ready to review.',
    });
    const admission = draftContinuationAdmission(context, terminal, candidate);

    const continuation = item.service.begin_draft_continuation_work({
      admission,
      instruction: 'Make the timer more compact before saving.',
      request_digest: DRAFT_CONTINUATION_REQUEST_DIGEST,
    });

    assert.equal(continuation.context_version, 'builder-conversation-run-context.v1');
    assert.equal(continuation.mode, 'work');
    assert.equal(continuation.request_digest, DRAFT_CONTINUATION_REQUEST_DIGEST);
    assert.equal(continuation.start_head.sequence, 6);
    assert.equal(continuation.events.at(-2).event_type, 'turn_submitted');
    assert.equal(continuation.events.at(-2).previous_event.sequence, 4);
    assert.equal(continuation.events.at(-2).payload.message.text, 'Make the timer more compact before saving.');
    assert.equal(continuation.events.at(-2).payload.task.title, 'Revise unsaved draft');
    assert.equal(continuation.events.at(-2).payload.base_revision, null);
    assert.equal(continuation.events.at(-1).event_type, 'run_started');
    assert.equal(continuation.events.at(-1).payload.input_digest, DRAFT_CONTINUATION_REQUEST_DIGEST);
    assert.deepEqual(continuation.draft_continuation, {
      admission_digest: admission.admission_digest,
      draft_id: candidate.draft_id,
      previous_turn_id: context.ids.turn_id,
      previous_task_id: context.ids.task_id,
      previous_run_id: context.ids.run_id,
      previous_candidate_digest: CANDIDATE_DIGEST,
    });
    assert.deepEqual(item.service.read_stream({ project_id: PROJECT_ID }).conversation.items.slice(-2).map((entry) => entry.item_kind), [
      'user_message',
      'run_started',
    ]);
    assert.doesNotMatch(
      JSON.stringify({
        draft_continuation: continuation.draft_continuation,
        events: continuation.events.slice(-2),
      }),
      /git_candidate_receipt|commit_oid|tree_oid|provider|credential|source_tree|revision_receipt|save_admission/iu,
    );
  } finally {
    item.close();
  }
});

test('rejects draft continuation work after head drift or candidate review', () => {
  const staleItem = fixture();
  const rejectedItem = fixture(300, 3_000);
  const acceptedItem = fixture(600, 6_000);
  try {
    const staleContext = begin(staleItem.service);
    const staleCandidate = candidateResult(staleContext);
    const staleTerminal = staleItem.service.complete_candidate({
      context: staleContext,
      candidate_result: staleCandidate,
      assistant_text: 'A timer draft is ready to review.',
    });
    const staleAdmission = draftContinuationAdmission(staleContext, staleTerminal, staleCandidate);
    staleItem.service.begin_question({
      project_id: PROJECT_ID,
      question: 'What does this draft do?',
      request_digest: QUESTION_DIGEST,
      base_revision: null,
    });
    assert.throws(
      () => staleItem.service.begin_draft_continuation_work({
        admission: staleAdmission,
        instruction: 'Make the draft smaller.',
        request_digest: DRAFT_CONTINUATION_REQUEST_DIGEST,
      }),
      { code: 'builder_conversation_main_service_unavailable' },
    );

    const rejectedContext = begin(rejectedItem.service);
    const rejectedCandidate = candidateResult(rejectedContext);
    const rejectedTerminal = rejectedItem.service.complete_candidate({
      context: rejectedContext,
      candidate_result: rejectedCandidate,
      assistant_text: 'A timer draft is ready to review.',
    });
    const rejectedAdmission = draftContinuationAdmission(rejectedContext, rejectedTerminal, rejectedCandidate);
    rejectedItem.service.reject_candidate({ draft_id: rejectedCandidate.draft_id });
    assert.throws(
      () => rejectedItem.service.begin_draft_continuation_work({
        admission: rejectedAdmission,
        instruction: 'Make the rejected draft smaller.',
        request_digest: DRAFT_CONTINUATION_REQUEST_DIGEST,
      }),
      { code: 'builder_conversation_main_service_unavailable' },
    );

    const acceptedContext = begin(acceptedItem.service);
    const acceptedCandidate = candidateResult(acceptedContext);
    const acceptedTerminal = acceptedItem.service.complete_candidate({
      context: acceptedContext,
      candidate_result: acceptedCandidate,
      assistant_text: 'A timer draft is ready to review.',
    });
    const acceptedAdmission = draftContinuationAdmission(acceptedContext, acceptedTerminal, acceptedCandidate);
    acceptedItem.service.accept_candidate({
      draft_id: acceptedCandidate.draft_id,
      review_id: 'builder-review:00000000-0000-4000-8000-000000000951',
      reviewer_id: 'builder-user:00000000-0000-4000-8000-000000000952',
      reviewed_at_ms: 9_520,
      revision: {
        revision_receipt_digest: `sha256:${'e'.repeat(64)}`,
        revision_number: 1,
      },
    });
    assert.throws(
      () => acceptedItem.service.begin_draft_continuation_work({
        admission: acceptedAdmission,
        instruction: 'Make the saved draft smaller.',
        request_digest: DRAFT_CONTINUATION_REQUEST_DIGEST,
      }),
      { code: 'builder_conversation_main_service_unavailable' },
    );
  } finally {
    staleItem.close();
    rejectedItem.close();
    acceptedItem.close();
  }
});

test('records durable candidate rejection and does not restore or verify it afterward', () => {
  const item = fixture();
  let restartedDatabase = null;
  try {
    const context = begin(item.service);
    const candidate = candidateResult(context);
    const terminal = item.service.complete_candidate({
      context,
      candidate_result: candidate,
      assistant_text: 'A timer draft is ready to review.',
    });
    const rejected = item.service.reject_candidate({ draft_id: candidate.draft_id });
    assert.deepEqual(rejected, {
      result_version: 'builder-conversation-candidate-reject-result.v1',
      draft_id: candidate.draft_id,
      project_id: PROJECT_ID,
      conversation_id: context.conversation.conversation_id,
      rejection_admission: 'sqlite_recorded',
    });

    const stream = item.service.read_stream({ project_id: PROJECT_ID });
    assert.equal(stream.conversation.head_sequence, 5);
    assert.deepEqual(stream.conversation.items.at(-1), {
      item_kind: 'candidate_reviewed',
      sequence: 5,
      turn_id: context.ids.turn_id,
      run_id: context.ids.run_id,
      draft_id: candidate.draft_id,
      decision: 'rejected',
      candidate_state: 'rejected',
      saved_revision: null,
    });
    assert.doesNotMatch(
      JSON.stringify(stream),
      /review_id|reviewer_id|reviewed_at_ms|git_candidate_receipt|candidate_digest|commit_oid|tree_oid|provider|credential/iu,
    );
    assert.throws(
      () => item.service.read_candidate_draft({ draft_id: candidate.draft_id }),
      { code: 'builder_conversation_main_service_unavailable' },
    );
    assert.throws(
      () => item.service.verify_candidate({
        project_id: PROJECT_ID,
        conversation_id: context.conversation.conversation_id,
        turn_id: context.ids.turn_id,
        task_id: context.ids.task_id,
        run_id: context.ids.run_id,
        candidate_digest: CANDIDATE_DIGEST,
        conversation_head: terminal.head,
      }),
      { code: 'builder_conversation_main_service_unavailable' },
    );
    assert.throws(
      () => item.service.reject_candidate({ draft_id: candidate.draft_id }),
      { code: 'builder_conversation_main_service_unavailable' },
    );

    item.database.close();
    restartedDatabase = createBuilderProductMetadataDatabase(
      path.join(item.root, 'builder.sqlite'),
    );
    const restartedService = createBuilderConversationMainService({
      metadataAuthority: restartedDatabase,
      createUuid: uuidFactory(750),
      nowMs: () => 7_500,
    });
    assert.throws(
      () => restartedService.read_candidate_draft({ draft_id: candidate.draft_id }),
      { code: 'builder_conversation_main_service_unavailable' },
    );
    assert.deepEqual(restartedService.read_stream({ project_id: PROJECT_ID }), stream);
  } finally {
    if (restartedDatabase !== null) restartedDatabase.close();
    try { item.database.close(); } catch { /* already closed during restart check */ }
    removeRoot(item.root);
  }
});

test('records durable candidate acceptance and does not restore or review it afterward', () => {
  const item = fixture();
  let restartedDatabase = null;
  try {
    const context = begin(item.service);
    const candidate = candidateResult(context);
    const terminal = item.service.complete_candidate({
      context,
      candidate_result: candidate,
      assistant_text: 'A timer draft is ready to review.',
    });
    const accepted = item.service.accept_candidate({
      draft_id: candidate.draft_id,
      review_id: 'builder-review:00000000-0000-4000-8000-000000000900',
      reviewer_id: 'builder-user:00000000-0000-4000-8000-000000000901',
      reviewed_at_ms: 9_000,
      revision: {
        revision_receipt_digest: `sha256:${'a'.repeat(64)}`,
        revision_number: 1,
      },
    });
    assert.deepEqual(accepted, {
      result_version: 'builder-conversation-candidate-accept-result.v1',
      draft_id: candidate.draft_id,
      project_id: PROJECT_ID,
      conversation_id: context.conversation.conversation_id,
      acceptance_admission: 'sqlite_recorded',
    });

    const stream = item.service.read_stream({ project_id: PROJECT_ID });
    assert.equal(stream.conversation.head_sequence, 5);
    assert.deepEqual(stream.conversation.items.at(-1), {
      item_kind: 'candidate_reviewed',
      sequence: 5,
      turn_id: context.ids.turn_id,
      run_id: context.ids.run_id,
      draft_id: candidate.draft_id,
      decision: 'accepted',
      candidate_state: 'saved',
      saved_revision: { revision_number: 1 },
    });
    assert.doesNotMatch(
      JSON.stringify(stream),
      /review_id|reviewer_id|reviewed_at_ms|revision_receipt|git_candidate_receipt|candidate_digest|commit_oid|tree_oid|provider|credential/iu,
    );
    assert.throws(
      () => item.service.read_candidate_draft({ draft_id: candidate.draft_id }),
      { code: 'builder_conversation_main_service_unavailable' },
    );
    assert.throws(
      () => item.service.verify_candidate({
        project_id: PROJECT_ID,
        conversation_id: context.conversation.conversation_id,
        turn_id: context.ids.turn_id,
        task_id: context.ids.task_id,
        run_id: context.ids.run_id,
        candidate_digest: CANDIDATE_DIGEST,
        conversation_head: terminal.head,
      }),
      { code: 'builder_conversation_main_service_unavailable' },
    );
    assert.throws(
      () => item.service.reject_candidate({ draft_id: candidate.draft_id }),
      { code: 'builder_conversation_main_service_unavailable' },
    );
    assert.throws(
      () => item.service.accept_candidate({
        draft_id: candidate.draft_id,
        review_id: 'builder-review:00000000-0000-4000-8000-000000000902',
        reviewer_id: 'builder-user:00000000-0000-4000-8000-000000000903',
        reviewed_at_ms: 9_001,
        revision: {
          revision_receipt_digest: `sha256:${'b'.repeat(64)}`,
          revision_number: 2,
        },
      }),
      { code: 'builder_conversation_main_service_unavailable' },
    );

    item.database.close();
    restartedDatabase = createBuilderProductMetadataDatabase(
      path.join(item.root, 'builder.sqlite'),
    );
    const restartedService = createBuilderConversationMainService({
      metadataAuthority: restartedDatabase,
      createUuid: uuidFactory(850),
      nowMs: () => 8_500,
    });
    assert.throws(
      () => restartedService.read_candidate_draft({ draft_id: candidate.draft_id }),
      { code: 'builder_conversation_main_service_unavailable' },
    );
    assert.deepEqual(restartedService.read_stream({ project_id: PROJECT_ID }), stream);
  } finally {
    if (restartedDatabase !== null) restartedDatabase.close();
    try { item.database.close(); } catch { /* already closed during restart check */ }
    removeRoot(item.root);
  }
});

test('returns a legal empty stream when the project has no conversation', () => {
  const item = fixture();
  try {
    assert.deepEqual(item.service.read_stream({ project_id: PROJECT_ID }), {
      stream_version: 'builder-task-stream-read-result.v1',
      project_id: PROJECT_ID,
      conversation: null,
      authority: {
        conversation: 'sqlite_canonical_event_replay_or_absent',
        project_source: 'not_included',
        candidate_source: 'not_loaded',
        project_revision: 'not_inferred',
      },
    });
    assert.throws(() => item.service.read_stream({
      project_id: PROJECT_ID,
      extra: 'private-marker',
    }), {
      code: 'builder_task_stream_unavailable',
      message: 'Project activity is unavailable.',
      retryable: true,
    });
  } finally {
    item.close();
  }
});

test('read_stream carries main-owned Working Context status projection when available', () => {
  const requests = [];
  const item = fixture(1, 1_000, {
    workingContextStateService: {
      read_current_working_context_state_for_conversation(request) {
        requests.push(request);
        return {
          context_status_projection: contextStatusProjection(),
        };
      },
    },
  });
  try {
    const context = begin(item.service);
    const stream = item.service.read_stream({ project_id: PROJECT_ID });

    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0], {
      project_id: PROJECT_ID,
      conversation_id: context.conversation.conversation_id,
      objective_summary: null,
      confirmed_constraints: [],
      rejected_constraints: [],
      open_questions: [],
      latest_user_intent: null,
      source_refs: [],
      compaction_refs: [],
      handoff_refs: [],
      approved_plan_ref: null,
      base_revision_ref: null,
      invalidated_by: null,
      updated_at_ms: 0,
    });
    assert.equal(stream.context_status_projection.label, 'Handoff received');
    assert.equal(stream.context_status_projection.pending_handoff_count, 1);
    assert.equal(stream.context_status_projection.can_contextual_execute, false);
    assert.doesNotMatch(
      JSON.stringify(stream.context_status_projection),
      /WorkingContext|Task Capsule|builder-handoff-packet|builder-task-address:|builder-conversation:|sha256:|provider_(?:secret|config|envelope)|credential|source_tree/iu,
    );
  } finally {
    item.close();
  }
});

test('read_stream carries main-owned provider context disclosure status when available', () => {
  const requests = [];
  const item = fixture(1, 1_000, {
    providerContextDisclosureStatusService: {
      read_current_provider_context_disclosure_status_for_conversation(request) {
        requests.push(request);
        return {
          provider_context_disclosure_status_projection:
            providerContextDisclosureStatusProjection(),
        };
      },
    },
  });
  try {
    const context = begin(item.service);
    const stream = item.service.read_stream({ project_id: PROJECT_ID });

    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0], {
      project_id: PROJECT_ID,
      conversation_id: context.conversation.conversation_id,
    });
    assert.equal(
      stream.provider_context_disclosure_status_projection.label,
      'Allow AI to use current context',
    );
    assert.equal(stream.provider_context_disclosure_status_projection.needs_user_approval, true);
    assert.equal(stream.provider_context_disclosure_status_projection.can_use_provider_context, false);
    assert.equal(stream.provider_context_disclosure_status_projection.request_available, true);
    assert.doesNotMatch(
      JSON.stringify(stream.provider_context_disclosure_status_projection),
      /builder-provider-context-disclosure-request|builder-context-assembly|request_id|assembly_id|context_digest|builder-task-address:|builder-conversation:|sha256:|"provider_context":|api[_-]?key|credential|source_tree/iu,
    );
  } finally {
    item.close();
  }
});

test('read_stream projects checkpoint only while the latest candidate is unreviewed', () => {
  const requests = [];
  const checkRequests = [];
  const activityRequests = [];
  const item = fixture(1, 1_000, {
    automaticDraftCheckpointService: {
      read_current_checkpoint_status(request) {
        requests.push(request);
        return {
          draft_checkpoint_status_projection: draftCheckpointStatusProjection(),
        };
      },
    },
    checkRunStatusService: {
      read_current_check_run_status(request) {
        checkRequests.push(request);
        return { check_run_status_projection: checkRunStatusProjection() };
      },
    },
    checkRunActivityRegistry: {
      read_candidate_activity(request) {
        activityRequests.push(request);
        return {
          result_version: 'builder-check-run-candidate-activity-result.v1',
          project_id: request.project_id,
          candidate_id: request.candidate_id,
          activity: 'check_run',
        };
      },
    },
  });
  try {
    const context = begin(item.service);
    const candidate = candidateResult(context);
    item.service.complete_candidate({
      context,
      candidate_result: candidate,
      assistant_text: 'A timer draft is ready to review.',
    });

    const ready = item.service.read_stream({ project_id: PROJECT_ID });
    assert.equal(ready.draft_checkpoint_status_projection.label, 'Checkpoint saved');
    assert.equal(ready.draft_checkpoint_status_projection.changed_file_count, 2);
    assert.equal(ready.review_state_projection.status, 'ready');
    assert.equal(ready.review_state_projection.check_status, 'passed');
    assert.equal(
      ready.review_state_projection.summary,
      'A recoverable draft is checked and ready to inspect and save.',
    );
    assert.equal(ready.review_state_projection.can_save, true);
    assert.equal(ready.review_state_projection.can_discard, true);
    assert.equal(ready.review_state_projection.authority.save_authority, false);
    assert.equal(ready.agent_activity_projection.current.phase, 'running_checks');
    assert.equal(ready.agent_activity_projection.current.label, 'Running checks');
    assert.deepEqual(requests, [{
      project_id: PROJECT_ID,
      conversation_id: context.conversation.conversation_id,
      candidate_id: candidate.git_candidate_receipt.candidate_id,
    }]);
    assert.deepEqual(checkRequests, [{
      project_id: PROJECT_ID,
      candidate_id: candidate.git_candidate_receipt.candidate_id,
    }]);
    assert.deepEqual(activityRequests, [{
      project_id: PROJECT_ID,
      candidate_id: candidate.git_candidate_receipt.candidate_id,
    }]);

    item.service.reject_candidate({ draft_id: candidate.draft_id });
    const rejected = item.service.read_stream({ project_id: PROJECT_ID });
    assert.equal(Object.hasOwn(rejected, 'draft_checkpoint_status_projection'), false);
    assert.equal(Object.hasOwn(rejected, 'review_state_projection'), false);
    assert.equal(requests.length, 1);
    assert.equal(checkRequests.length, 1);
    assert.equal(activityRequests.length, 1);
  } finally {
    item.close();
  }
});

test('read_stream keeps activity available when Working Context status projection is absent or invalid', () => {
  let calls = 0;
  const item = fixture(1, 1_000, {
    workingContextStateService: {
      read_current_working_context_state_for_conversation() {
        calls += 1;
        return {
          context_status_projection: contextStatusProjection({
            authority: {
              source_read: 'allowed',
            },
          }),
        };
      },
    },
  });
  try {
    assert.equal(item.service.read_stream({ project_id: PROJECT_ID }).conversation, null);
    assert.equal(calls, 0);

    begin(item.service);
    const stream = item.service.read_stream({ project_id: PROJECT_ID });
    assert.equal(calls, 1);
    assert.equal(stream.conversation.head_sequence, 2);
    assert.equal(Object.hasOwn(stream, 'context_status_projection'), false);
  } finally {
    item.close();
  }
});

test('read_stream keeps activity available when provider context disclosure status is absent or invalid', () => {
  let calls = 0;
  const item = fixture(1, 1_000, {
    providerContextDisclosureStatusService: {
      read_current_provider_context_disclosure_status_for_conversation() {
        calls += 1;
        return {
          provider_context_disclosure_status_projection:
            providerContextDisclosureStatusProjection({
              authority: {
                permission_grant: true,
              },
            }),
        };
      },
    },
  });
  try {
    assert.equal(item.service.read_stream({ project_id: PROJECT_ID }).conversation, null);
    assert.equal(calls, 0);

    begin(item.service);
    const stream = item.service.read_stream({ project_id: PROJECT_ID });
    assert.equal(calls, 1);
    assert.equal(stream.conversation.head_sequence, 2);
    assert.equal(
      Object.hasOwn(stream, 'provider_context_disclosure_status_projection'),
      false,
    );
  } finally {
    item.close();
  }
});

test('reads a restarted active run as recorded without mutating durable events', () => {
  const item = fixture();
  let restartedDatabase = null;
  try {
    const context = begin(item.service);
    const request = {
      project_id: PROJECT_ID,
      conversation_id: context.conversation.conversation_id,
    };
    const beforeRestart = item.database.load_conversation(request);
    assert.equal(beforeRestart.current_head.sequence, 2);

    item.database.close();
    restartedDatabase = createBuilderProductMetadataDatabase(
      path.join(item.root, 'builder.sqlite'),
    );
    const durableBeforeRead = restartedDatabase.load_conversation(request);
    const restartedService = createBuilderConversationMainService({
      metadataAuthority: restartedDatabase,
      createUuid: uuidFactory(400),
      nowMs: () => 4_000,
    });
    const stream = restartedService.read_stream({ project_id: PROJECT_ID });
    assert.equal(stream.conversation.head_sequence, 2);
    assert.equal(stream.conversation.recorded_active_turn_id, context.ids.turn_id);
    assert.equal(stream.conversation.items.at(-1).recorded_state, 'started');
    assert.doesNotMatch(JSON.stringify(stream), /running|live/iu);
    const durableAfterRead = restartedDatabase.load_conversation(request);
    assert.deepEqual(durableAfterRead, durableBeforeRead);
  } finally {
    if (restartedDatabase !== null) restartedDatabase.close();
    try { item.database.close(); } catch { /* already closed during restart check */ }
    removeRoot(item.root);
  }
});

test('recovers a running turn as interrupted without redispatching a provider', () => {
  const item = fixture();
  let restartedDatabase = null;
  try {
    const abandoned = begin(item.service);
    assert.equal(abandoned.start_head.sequence, 2);

    item.database.close();
    restartedDatabase = createBuilderProductMetadataDatabase(
      path.join(item.root, 'builder.sqlite'),
    );
    const restartedService = createBuilderConversationMainService({
      metadataAuthority: restartedDatabase,
      createUuid: uuidFactory(200),
      nowMs: () => 2_000,
    });
    const resumed = begin(restartedService, BASE_REVISION, 'Try a new direction');
    assert.equal(resumed.start_head.sequence, 7);
    assert.deepEqual(resumed.events.map((event) => event.event_type), [
      'turn_submitted',
      'run_started',
      'run_interrupt_requested',
      'run_completed',
      'turn_completed',
      'turn_submitted',
      'run_started',
    ]);
    const replayed = replayBuilderConversation(resumed.events);
    assert.equal(replayed.turns[0].outcome, 'interrupted');
    assert.equal(replayed.turns[1].status, 'active');
  } finally {
    if (restartedDatabase !== null) restartedDatabase.close();
    try { item.database.close(); } catch { /* already closed during restart check */ }
    removeRoot(item.root);
  }
});

test('records fixed failed, cancelled, and timeout-interrupted terminal outcomes', () => {
  const cases = [
    ['builder_generation_failed', 'failed', 4],
    ['builder_generation_cancelled', 'cancelled', 5],
    ['builder_generation_timeout', 'interrupted', 5],
  ];
  for (const [failureCode, outcome, expectedSequence] of cases) {
    const item = fixture();
    try {
      const context = begin(item.service);
      const terminal = item.service.complete_failure({
        context,
        failure_code: failureCode,
      });
      assert.equal(terminal.head.sequence, expectedSequence);
      assert.equal(terminal.snapshot.turns[0].outcome, outcome);
      assert.equal(
        terminal.snapshot.turns[0].runs[0].terminal_status,
        outcome,
      );
      assert.doesNotMatch(JSON.stringify(terminal), /provider\.example|credential|api[_-]?key/iu);
    } finally {
      item.close();
    }
  }
});

test('records a deliberate retry as a second run on the same active turn', () => {
  const item = fixture();
  let restartedDatabase = null;
  try {
    const first = begin(item.service);
    const retry = item.service.retry_after_failure({
      context: first,
      failure_code: 'builder_generation_failed',
    });
    assert.equal(retry.attempt_number, 2);
    assert.equal(retry.ids.turn_id, first.ids.turn_id);
    assert.equal(retry.ids.task_id, first.ids.task_id);
    assert.notEqual(retry.ids.run_id, first.ids.run_id);
    assert.equal(retry.start_head.sequence, 4);
    assert.deepEqual(retry.events.map((event) => event.event_type), [
      'turn_submitted',
      'run_started',
      'run_completed',
      'run_started',
    ]);

    const pending = item.service.read_stream({ project_id: PROJECT_ID });
    assert.equal(pending.conversation.head_sequence, 4);
    assert.equal(pending.conversation.recorded_active_turn_id, first.ids.turn_id);
    assert.deepEqual(pending.conversation.items[3], {
      item_kind: 'run_started',
      sequence: 4,
      turn_id: first.ids.turn_id,
      run_id: retry.ids.run_id,
      task_id: first.ids.task_id,
      attempt_number: 2,
      retry_of_run_id: first.ids.run_id,
      recorded_state: 'started',
    });
    assert.doesNotMatch(JSON.stringify(pending), /provider|credential|git_candidate_receipt|commit_oid|tree_oid|live|running/iu);

    const terminal = item.service.complete_candidate({
      context: retry,
      candidate_result: candidateResult(retry),
      assistant_text: 'The retry prepared a timer draft.',
    });
    assert.equal(terminal.head.sequence, 6);
    assert.equal(terminal.snapshot.active_turn_id, null);
    assert.equal(terminal.snapshot.turns.length, 1);
    assert.deepEqual(terminal.snapshot.turns[0].runs.map((run) => ({
      attempt_number: run.attempt_number,
      retry_of_run_id: run.retry_of_run_id,
      run_id: run.run_id,
      terminal_status: run.terminal_status,
    })), [
      {
        attempt_number: 1,
        retry_of_run_id: null,
        run_id: first.ids.run_id,
        terminal_status: 'failed',
      },
      {
        attempt_number: 2,
        retry_of_run_id: first.ids.run_id,
        run_id: retry.ids.run_id,
        terminal_status: 'succeeded',
      },
    ]);
    assert.equal(terminal.snapshot.turns[0].outcome, 'candidate_ready');
    const completedStream = item.service.read_stream({ project_id: PROJECT_ID });
    assert.equal(completedStream.conversation.head_sequence, 6);
    assert.equal(completedStream.conversation.recorded_active_turn_id, null);
    assert.equal(completedStream.conversation.items[4].result_kind, 'candidate');

    item.database.close();
    restartedDatabase = createBuilderProductMetadataDatabase(
      path.join(item.root, 'builder.sqlite'),
    );
    const restartedService = createBuilderConversationMainService({
      metadataAuthority: restartedDatabase,
      createUuid: uuidFactory(950),
      nowMs: () => 9_500,
    });
    assert.deepEqual(restartedService.read_stream({ project_id: PROJECT_ID }), completedStream);
  } finally {
    if (restartedDatabase !== null) restartedDatabase.close();
    try { item.database.close(); } catch { /* already closed during restart check */ }
    removeRoot(item.root);
  }
});

test('records a retryable failed run without completing the turn before deliberate retry', () => {
  const item = fixture();
  let restartedDatabase = null;
  try {
    const first = begin(item.service);
    const failed = item.service.record_retryable_failure({
      context: first,
      failure_code: 'builder_generation_failed',
    });
    assert.equal(failed.attempt_number, 1);
    assert.equal(failed.run_terminal_failure_code, 'builder_generation_failed');
    assert.equal(failed.ids.run_id, first.ids.run_id);
    assert.equal(failed.start_head.sequence, 3);
    assert.deepEqual(failed.events.map((event) => event.event_type), [
      'turn_submitted',
      'run_started',
      'run_completed',
    ]);

    const failedStream = item.service.read_stream({ project_id: PROJECT_ID });
    assert.equal(failedStream.conversation.head_sequence, 3);
    assert.equal(failedStream.conversation.recorded_active_turn_id, first.ids.turn_id);
    assert.deepEqual(failedStream.conversation.items[2], {
      item_kind: 'run_completed',
      sequence: 3,
      turn_id: first.ids.turn_id,
      run_id: first.ids.run_id,
      terminal_status: 'failed',
      result_kind: 'failure',
      failure_phase: 'not_recorded',
      assistant_message: {
        message_id: first.ids.assistant_message_id,
        text: 'The draft could not be made.',
      },
      candidate: null,
    });
    assert.throws(() => item.service.record_retryable_failure({
      context: failed,
      failure_code: 'builder_generation_failed',
    }), { code: 'builder_conversation_main_service_unavailable' });

    const retry = item.service.retry_after_failure({
      context: failed,
      failure_code: 'builder_generation_failed',
    });
    assert.equal(retry.attempt_number, 2);
    assert.equal(retry.run_terminal_failure_code, null);
    assert.equal(retry.ids.turn_id, first.ids.turn_id);
    assert.equal(retry.ids.task_id, first.ids.task_id);
    assert.equal(retry.start_head.sequence, 4);
    assert.deepEqual(retry.events.map((event) => event.event_type), [
      'turn_submitted',
      'run_started',
      'run_completed',
      'run_started',
    ]);

    const pendingRetry = item.service.read_stream({ project_id: PROJECT_ID });
    assert.equal(pendingRetry.conversation.head_sequence, 4);
    assert.equal(pendingRetry.conversation.recorded_active_turn_id, first.ids.turn_id);
    assert.deepEqual(pendingRetry.conversation.items[3], {
      item_kind: 'run_started',
      sequence: 4,
      turn_id: first.ids.turn_id,
      run_id: retry.ids.run_id,
      task_id: first.ids.task_id,
      attempt_number: 2,
      retry_of_run_id: first.ids.run_id,
      recorded_state: 'started',
    });

    const terminal = item.service.complete_candidate({
      context: retry,
      candidate_result: candidateResult(retry),
      assistant_text: 'The retry prepared a timer draft.',
    });
    assert.equal(terminal.head.sequence, 6);
    const completedStream = item.service.read_stream({ project_id: PROJECT_ID });
    assert.equal(completedStream.conversation.head_sequence, 6);
    assert.equal(completedStream.conversation.recorded_active_turn_id, null);
    assert.equal(completedStream.conversation.items[4].result_kind, 'candidate');
    assert.doesNotMatch(JSON.stringify(completedStream), /provider|credential|git_candidate_receipt|commit_oid|tree_oid|live|running/iu);

    item.database.close();
    restartedDatabase = createBuilderProductMetadataDatabase(
      path.join(item.root, 'builder.sqlite'),
    );
    const restartedService = createBuilderConversationMainService({
      metadataAuthority: restartedDatabase,
      createUuid: uuidFactory(975),
      nowMs: () => 9_750,
    });
    assert.deepEqual(restartedService.read_stream({ project_id: PROJECT_ID }), completedStream);
  } finally {
    if (restartedDatabase !== null) restartedDatabase.close();
    try { item.database.close(); } catch { /* already closed during restart check */ }
    removeRoot(item.root);
  }
});

test('explains generic failures after the AI request starts without exposing provider details', () => {
  const item = fixture();
  const questionItem = fixture(1_200, 12_000);
  const serviceItem = fixture(1_300, 13_000);
  try {
    const first = begin(item.service, null, 'Build a static blog.');
    const contextReady = item.service.record_run_progress({
      context: first,
      stage: 'context_ready',
    });
    const requestStarted = item.service.record_run_progress({
      context: contextReady,
      stage: 'provider_request_started',
    });
    item.service.record_retryable_failure({
      context: requestStarted,
      failure_code: 'builder_generation_failed',
    });

    const failedStream = item.service.read_stream({ project_id: PROJECT_ID });
    assert.deepEqual(failedStream.conversation.items[4], {
      item_kind: 'run_completed',
      sequence: 5,
      turn_id: first.ids.turn_id,
      run_id: first.ids.run_id,
      terminal_status: 'failed',
      result_kind: 'failure',
      failure_phase: 'provider_request_started',
      assistant_message: {
        message_id: first.ids.assistant_message_id,
        text: 'The AI request ended before it returned a usable draft.',
      },
      candidate: null,
    });

    const question = beginQuestion(questionItem.service, null, 'What happened?');
    const questionReady = questionItem.service.record_run_progress({
      context: question,
      stage: 'context_ready',
    });
    const questionRequestStarted = questionItem.service.record_run_progress({
      context: questionReady,
      stage: 'provider_request_started',
    });
    questionItem.service.record_retryable_failure({
      context: questionRequestStarted,
      failure_code: 'builder_generation_failed',
    });

    const questionStream = questionItem.service.read_stream({ project_id: PROJECT_ID });
    assert.equal(
      questionStream.conversation.items[4].assistant_message.text,
      'The AI request ended before it returned a usable answer.',
    );
    assert.doesNotMatch(
      JSON.stringify([failedStream, questionStream]),
      /provider\.example|credential|api[_-]?key|Bearer/u,
    );

    const serviceFailure = begin(serviceItem.service, null, 'Build a static blog.');
    const serviceContextReady = serviceItem.service.record_run_progress({
      context: serviceFailure,
      stage: 'context_ready',
    });
    const serviceRequestStarted = serviceItem.service.record_run_progress({
      context: serviceContextReady,
      stage: 'provider_request_started',
    });
    serviceItem.service.record_retryable_failure({
      context: serviceRequestStarted,
      failure_code: 'builder_generation_service_unavailable',
    });

    const serviceFailureStream = serviceItem.service.read_stream({ project_id: PROJECT_ID });
    assert.equal(
      serviceFailureStream.conversation.items[4].assistant_message.text,
      'The AI request ended before it returned a usable draft.',
    );
    assert.doesNotMatch(
      JSON.stringify(serviceFailureStream),
      /provider\.example|credential|api[_-]?key|Bearer/u,
    );
  } finally {
    item.close();
    questionItem.close();
    serviceItem.close();
  }
});

test('records fixed public failure summaries for provider connection failures', () => {
  const item = fixture();
  try {
    const first = begin(item.service, null, 'Build a static blog.');
    item.service.record_retryable_failure({
      context: first,
      failure_code: 'builder_generation_provider_transport_error',
    });

    const failedStream = item.service.read_stream({ project_id: PROJECT_ID });
    assert.deepEqual(failedStream.conversation.items[2], {
      item_kind: 'run_completed',
      sequence: 3,
      turn_id: first.ids.turn_id,
      run_id: first.ids.run_id,
      terminal_status: 'failed',
      result_kind: 'failure',
      failure_phase: 'not_recorded',
      assistant_message: {
        message_id: first.ids.assistant_message_id,
        text: 'The AI service could not be reached. Check your network or proxy.',
      },
      candidate: null,
    });
  } finally {
    item.database.close();
    removeRoot(item.root);
  }
});

test('records fixed public failure summaries for workspace guard outcomes', () => {
  const cases = [
    [
      'builder_generation_workspace_changed',
      'The project changed while I was working. Review it, then retry.',
    ],
    [
      'builder_generation_workspace_guard_denied',
      'I blocked these file changes to protect the project.',
    ],
    [
      'builder_generation_workspace_guard_approval_required',
      'These file changes need additional approval before I can continue.',
    ],
  ];

  for (const [failureCode, expectedText] of cases) {
    const item = fixture();
    try {
      const context = begin(item.service, null, 'Update the project safely.');
      item.service.record_retryable_failure({
        context,
        failure_code: failureCode,
      });

      const stream = item.service.read_stream({ project_id: PROJECT_ID });
      const terminal = stream.conversation.items.find((entry) => entry.item_kind === 'run_completed');
      assert.equal(terminal.assistant_message.text, expectedText);
      assert.doesNotMatch(
        JSON.stringify(stream),
        /provider\.example|credential|api[_-]?key|Bearer/u,
      );
    } finally {
      item.database.close();
      removeRoot(item.root);
    }
  }
});

test('closes a retryable failed turn before starting a distinct new turn', () => {
  const item = fixture();
  try {
    const first = begin(item.service);
    item.service.record_retryable_failure({
      context: first,
      failure_code: 'builder_generation_failed',
    });
    const failedStream = item.service.read_stream({ project_id: PROJECT_ID });
    assert.equal(failedStream.conversation.head_sequence, 3);
    assert.equal(failedStream.conversation.recorded_active_turn_id, first.ids.turn_id);

    const second = begin(item.service, null, 'Try a different timer layout');
    assert.equal(second.start_head.sequence, 6);
    assert.notEqual(second.ids.turn_id, first.ids.turn_id);
    assert.notEqual(second.ids.run_id, first.ids.run_id);
    assert.deepEqual(second.events.map((event) => event.event_type), [
      'turn_submitted',
      'run_started',
      'run_completed',
      'turn_completed',
      'turn_submitted',
      'run_started',
    ]);

    const stream = item.service.read_stream({ project_id: PROJECT_ID });
    assert.equal(stream.conversation.head_sequence, 6);
    assert.equal(stream.conversation.recorded_active_turn_id, second.ids.turn_id);
    assert.deepEqual(stream.conversation.items[3], {
      item_kind: 'turn_completed',
      sequence: 4,
      turn_id: first.ids.turn_id,
      run_id: first.ids.run_id,
      outcome: 'failed',
    });
    assert.deepEqual(stream.conversation.items[4], {
      item_kind: 'user_message',
      sequence: 5,
      turn_id: second.ids.turn_id,
      message: {
        message_id: second.ids.message_id,
        text: 'Try a different timer layout',
      },
      message_kind: 'submitted',
      mode: 'work',
      task: {
        task_id: second.ids.task_id,
        title: 'Create Builder project',
      },
    });
    assert.doesNotMatch(JSON.stringify(stream), /provider|credential|git_candidate_receipt|commit_oid|tree_oid|live|running/iu);
  } finally {
    item.close();
  }
});

test('rejects forged contexts and stays isolated from provider, IPC, renderer, and Git authority', () => {
  const item = fixture();
  try {
    const work = begin(item.service);
    const question = beginQuestion(item.service, BASE_REVISION);
    assert.throws(() => item.service.complete_candidate({
      context: Object.freeze({}),
      candidate_result: candidateResult(work),
      assistant_text: 'Ready.',
    }), { code: 'builder_conversation_main_service_unavailable' });
    assert.throws(() => item.service.complete_candidate({
      context: question,
      candidate_result: candidateResult(work),
      assistant_text: 'Ready.',
    }), { code: 'builder_conversation_main_service_unavailable' });
    assert.throws(() => item.service.complete_explanation({
      context: work,
      assistant_text: 'This is an answer.',
    }), { code: 'builder_conversation_main_service_unavailable' });
    assert.throws(() => item.service.retry_after_failure({
      context: Object.freeze({}),
      failure_code: 'builder_generation_failed',
    }), { code: 'builder_conversation_main_service_unavailable' });
    assert.throws(() => item.service.record_retryable_failure({
      context: Object.freeze({}),
      failure_code: 'builder_generation_failed',
    }), { code: 'builder_conversation_main_service_unavailable' });
  } finally {
    item.close();
  }

  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-conversation-main-service.cjs'),
    'utf8',
  );
  assert.match(source, /read_approved_plan/u);
  assert.match(source, /admit_approved_plan_continuation/u);
  assert.match(source, /begin_approved_plan_work/u);
  assert.match(source, /begin_draft_continuation_work/u);
  assert.match(source, /begin_queued_followup_work/u);
  assert.match(source, /begin_queued_followup_question/u);
  assert.match(source, /main_only_current_head_approval_gate/u);
  assert.match(source, /main_only_fresh_approved_plan_no_execution/u);
  assert.match(source, /main_only_current_head_approved_plan_starts_new_work_run/u);
  assert.match(source, /main_only_pending_draft_current_head_starts_new_work_run/u);
  assert.match(source, /main_only_replay_verified_followup_starts_normal_turn/u);
  assert.doesNotMatch(
    source,
    /BrowserWindow|ipcMain|ipcRenderer|preload|fetch\(|openai|deepseek|safeStorage|persist_candidate_commit|builder-git-project-repository/iu,
  );
});
