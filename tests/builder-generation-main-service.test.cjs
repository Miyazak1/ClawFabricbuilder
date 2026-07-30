'use strict';

const assert = require('node:assert/strict');
const nodeCrypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  createBuilderGenerationMainService,
} = require('../electron/builder-generation-main-service.cjs');
const {
  createBuilderGitCandidateVerificationReceipt,
} = require('../electron/builder-git-receipt-contract.cjs');
const {
  CONVERSATION_AUTHORITY,
  CONVERSATION_EVENT_KIND,
  CONVERSATION_EVENT_VERSION,
  createBuilderConversationEvent,
} = require('../electron/builder-conversation-records.cjs');
const {
  createBuilderConversationMainService,
} = require('../electron/builder-conversation-main-service.cjs');
const {
  createBuilderProductMetadataDatabase,
} = require('../electron/builder-product-metadata-database.cjs');
const {
  createBuilderProviderConfig,
} = require('../electron/builder-provider-config.cjs');
const {
  createBuilderProviderConfigRepository,
} = require('../electron/builder-provider-config-repository.cjs');
const {
  createBuilderProviderSecretStore,
} = require('../electron/builder-provider-secret-store.cjs');
const {
  createBuilderProjectSourceTree,
} = require('../electron/builder-project-source-tree.cjs');
const {
  createBuilderApprovedPlanContinuationAdmission,
} = require('../electron/builder-approved-plan-continuation-admission.cjs');
const {
  sanitizeBuilderDraftContinuationAdmission,
} = require('../electron/builder-draft-continuation-admission.cjs');
const {
  sanitizeBuilderDraftContinuationBase,
} = require('../electron/builder-draft-continuation-base.cjs');

const UUIDS = Object.freeze([
  '123e4567-e89b-42d3-a456-426614174000',
  '123e4567-e89b-42d3-a456-426614174001',
  '123e4567-e89b-42d3-a456-426614174002',
  '123e4567-e89b-42d3-a456-426614174003',
  '123e4567-e89b-42d3-a456-426614174004',
  '123e4567-e89b-42d3-a456-426614174005',
  '123e4567-e89b-42d3-a456-426614174006',
  '123e4567-e89b-42d3-a456-426614174007',
  '123e4567-e89b-42d3-a456-426614174008',
  '123e4567-e89b-42d3-a456-426614174009',
]);
const PROJECT_ID = `builder-project:${UUIDS[0]}`;
const CONVERSATION_ID = `builder-conversation:${UUIDS[0]}`;
const APPROVED_PLAN_TURN_ID = `builder-turn:${UUIDS[2]}`;
const APPROVED_PLAN_TASK_ID = `builder-task:${UUIDS[3]}`;
const APPROVED_PLAN_RUN_ID = `builder-run:${UUIDS[4]}`;
const PRIVATE_MARKER = 'private-main-service-marker';

function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function digest(value) {
  return `sha256:${nodeCrypto.createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')}`;
}

function request({ instruction = 'Make a focus timer.', existingProjectId = null } = {}) {
  const unsigned = {
    version: 'builder-generation-request.v2',
    instruction,
    existing_project_id: existingProjectId,
  };
  return { ...unsigned, request_digest: digest(unsigned) };
}

function approvedPlanEditRequest(overrides = {}) {
  return {
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    turn_id: APPROVED_PLAN_TURN_ID,
    run_id: APPROVED_PLAN_RUN_ID,
    ...overrides,
  };
}

function createUuidFactory(seed = 0) {
  let index = seed;
  return () => {
    const value = UUIDS[index % UUIDS.length];
    index += 1;
    return value;
  };
}

function createUniqueUuidFactory(seed = 1) {
  let value = seed;
  return () => {
    const suffix = value.toString(16).padStart(12, '0');
    value += 1;
    return `00000000-0000-4000-8000-${suffix}`;
  };
}

function config(model = 'builder-model') {
  return createBuilderProviderConfig({
    base_url: 'https://provider.example/v1',
    model,
    timeout_ms: 30000,
    temperature: 0,
    max_tokens: 8192,
    secret_ref: {
      ref_version: 'builder-provider-secret-ref.v1',
      provider_id: 'builder-default',
      secret_id: 'builder-provider-secret:default',
    },
  });
}

function providerOutput(overrides = {}) {
  return {
    kind: 'builder_code_change_operations',
    title: 'Focus timer',
    summary: 'A quiet timer for focused work.',
    operations: [
      { operation: 'upsert', path: 'index.html', content: '<main><h1>Focus</h1></main>\n' },
      { operation: 'upsert', path: 'src/app.js', content: 'console.log("ready");\n' },
    ],
    ...overrides,
  };
}

function providerExplanation(overrides = {}) {
  return {
    kind: 'builder_conversation_explanation',
    title: 'Current project',
    summary: 'Explains the current project.',
    explanation: 'The current project is saved locally. This answer does not change files.',
    ...overrides,
  };
}

function providerPlan(overrides = {}) {
  return {
    kind: 'builder_project_plan_proposal',
    title: 'Review the change plan',
    summary: 'Prepare a bounded implementation before editing the project.',
    steps: [
      {
        title: 'Inspect the current project',
        purpose: 'Use the collected context to keep the edit focused.',
        expected_change: 'No source files change during planning.',
      },
      {
        title: 'Prepare the edit pass',
        purpose: 'Separate approval from source mutation.',
        expected_change: 'The next approved step can produce a draft.',
      },
    ],
    ...overrides,
  };
}

function eventHead(record) {
  return {
    sequence: record.sequence,
    event_id: record.event_id,
    event_digest: record.event_digest,
  };
}

function builderId(kind, index) {
  return `builder-${kind}:123e4567-e89b-42d3-a456-${index.toString(16).padStart(12, '0')}`;
}

function fullPlanContext(context) {
  return {
    ...context,
    start_head: {
      sequence: context.start_head.sequence + 2,
      event_id: `builder-conversation-event:${'7'.repeat(64)}`,
      event_digest: `sha256:${'6'.repeat(64)}`,
    },
    events: [
      ...context.events,
      { event_type: 'tool_call_requested' },
      { event_type: 'tool_call_result_recorded' },
    ],
    cancel_requested: false,
    ids: {
      turn_command_id: builderId('command', 1),
      run_command_id: builderId('command', 2),
      terminal_command_id: builderId('command', 3),
      turn_terminal_command_id: builderId('command', 4),
      cancel_command_id: builderId('command', 5),
      cancel_request_id: builderId('cancel-request', 6),
      interrupt_command_id: builderId('command', 7),
      interrupt_request_id: builderId('interrupt-request', 8),
      message_id: builderId('message', 9),
      assistant_message_id: builderId('message', 10),
      ...context.ids,
    },
  };
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

function sourceContextResult(context, rawFiles = [
  { path: 'src/app.tsx', content: 'export const ready = true;\n' },
]) {
  const tree = createBuilderProjectSourceTree({ files: rawFiles });
  const files = tree.files.map((file) => ({
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
    context: fullPlanContext(context),
    private_source_context: {
      context_version: 'builder-private-source-context.v1',
      files,
    },
    reads: files.map((file, index) => ({
      resource_id: `project:/${file.path}`,
      status: 'succeeded',
      tool_call_id: builderId('tool-call', index + 20),
    })),
    authority: sourceContextAuthority(),
  };
}

function taskStreamAbsent(projectId = PROJECT_ID) {
  return {
    stream_version: 'builder-task-stream-read-result.v1',
    project_id: projectId,
    conversation: null,
    authority: {
      conversation: 'sqlite_canonical_event_replay_or_absent',
      project_source: 'not_included',
      candidate_source: 'not_loaded',
      project_revision: 'not_inferred',
    },
  };
}

function taskStreamWithItems(projectId, items) {
  return {
    stream_version: 'builder-task-stream-read-result.v1',
    project_id: projectId,
    conversation: {
      conversation_id: `builder-conversation:${projectId.slice('builder-project:'.length)}`,
      created_at_ms: 1,
      head_sequence: items.at(-1).sequence,
      recorded_active_turn_id: null,
      window: {
        first_sequence: items[0].sequence,
        last_sequence: items.at(-1).sequence,
        has_earlier: false,
      },
      items,
    },
    authority: {
      conversation: 'sqlite_canonical_event_replay_or_absent',
      project_source: 'not_included',
      candidate_source: 'not_loaded',
      project_revision: 'not_inferred',
    },
  };
}

function recentChatProposalTaskStream(projectId = PROJECT_ID) {
  const turnId = `builder-turn:${UUIDS[1]}`;
  const runId = `builder-run:${UUIDS[2]}`;
  return taskStreamWithItems(projectId, [
    {
      item_kind: 'user_message',
      sequence: 1,
      turn_id: turnId,
      message: {
        message_id: `builder-message:${UUIDS[3]}`,
        text: '我们刚才确认要做一个带星空背景、鼠标视差和三维卡片的作品集首页。',
      },
      message_kind: 'submitted',
      mode: 'question',
      task: null,
    },
    {
      item_kind: 'run_completed',
      sequence: 2,
      turn_id: turnId,
      run_id: runId,
      terminal_status: 'succeeded',
      result_kind: 'explanation',
      assistant_message: {
        message_id: `builder-message:${UUIDS[4]}`,
        text: '方案是先做单页静态作品集，包含 hero、项目列表和联系入口，不加入后端。',
      },
      candidate: null,
    },
  ]);
}

function conversationService(options = {}) {
  let generation = 0;
  const candidateDrafts = new Map();
  const rejectedDrafts = new Set();
  const readStreamResult = Object.hasOwn(options, 'readStreamResult')
    ? options.readStreamResult
    : null;
  const calls = {
    begin: [],
    question: [],
    candidate: [],
    explanation: [],
    plan: [],
    failure: [],
    completeFailure: [],
    progress: [],
    retry: [],
    cancel: [],
    steering: [],
    readCandidate: [],
    rejectCandidate: [],
    readStream: [],
    readApprovedPlan: [],
    approvedPlanWork: [],
    approvedPlanContinuation: [],
    draftContinuationWork: [],
  };
  let progressCommand = 10_000;
  function nextProgressCommandId() {
    const suffix = progressCommand.toString(16).padStart(12, '0');
    progressCommand += 1;
    return `builder-command:00000000-0000-4000-8000-${suffix}`;
  }
  function progressEvent(context, stage) {
    return createBuilderConversationEvent({
      record_version: CONVERSATION_EVENT_VERSION,
      record_kind: CONVERSATION_EVENT_KIND,
      project_id: context.project.project_id,
      conversation_id: context.conversation.conversation_id,
      sequence: context.start_head.sequence + 1,
      command_id: nextProgressCommandId(),
      event_type: 'run_progress_recorded',
      previous_event: context.start_head,
      payload: {
        turn_id: context.ids.turn_id,
        run_id: context.ids.run_id,
        stage,
      },
      authority: { ...CONVERSATION_AUTHORITY },
    });
  }
  function steeringEvent(context, message) {
    return createBuilderConversationEvent({
      record_version: CONVERSATION_EVENT_VERSION,
      record_kind: CONVERSATION_EVENT_KIND,
      project_id: context.project.project_id,
      conversation_id: context.conversation.conversation_id,
      sequence: context.start_head.sequence + 1,
      command_id: nextProgressCommandId(),
      event_type: 'turn_steered',
      previous_event: context.start_head,
      payload: {
        turn_id: context.ids.turn_id,
        run_id: context.ids.run_id,
        message: {
          message_id: `builder-message:${UUIDS[(generation + 8) % UUIDS.length]}`,
          text: message,
        },
      },
      authority: { ...CONVERSATION_AUTHORITY },
    });
  }
  const service = {
    calls,
    reject_draft_for_test(draftId) {
      rejectedDrafts.add(draftId);
    },
    begin_work(input) {
      calls.begin.push(input);
      generation += 1;
      const suffix = UUIDS[(generation + 4) % UUIDS.length];
      const projectUuid = input.project_id.slice('builder-project:'.length);
      const conversationId = `builder-conversation:${projectUuid}`;
      const turnId = `builder-turn:${suffix}`;
      const taskId = `builder-task:${suffix}`;
      const runId = `builder-run:${suffix}`;
      const first = createBuilderConversationEvent({
        record_version: CONVERSATION_EVENT_VERSION,
        record_kind: CONVERSATION_EVENT_KIND,
        project_id: input.project_id,
        conversation_id: conversationId,
        sequence: 1,
        command_id: `builder-command:${UUIDS[(generation + 5) % UUIDS.length]}`,
        event_type: 'turn_submitted',
        previous_event: null,
        payload: {
          message: {
            message_id: `builder-message:${UUIDS[(generation + 6) % UUIDS.length]}`,
            text: input.instruction,
          },
          turn_id: turnId,
          mode: 'work',
          task: {
            task_id: taskId,
            title: input.base_revision === null
              ? 'Create Builder project'
              : 'Update Builder project',
          },
          base_revision: input.base_revision,
        },
        authority: { ...CONVERSATION_AUTHORITY },
      });
      const second = createBuilderConversationEvent({
        record_version: CONVERSATION_EVENT_VERSION,
        record_kind: CONVERSATION_EVENT_KIND,
        project_id: input.project_id,
        conversation_id: conversationId,
        sequence: 2,
        command_id: `builder-command:${UUIDS[(generation + 7) % UUIDS.length]}`,
        event_type: 'run_started',
        previous_event: eventHead(first),
        payload: {
          turn_id: turnId,
          run_id: runId,
          task_id: taskId,
          attempt_number: 1,
          retry_of_run_id: null,
          input_digest: input.request_digest,
        },
        authority: { ...CONVERSATION_AUTHORITY },
      });
      return {
        context_version: 'builder-conversation-run-context.v1',
        project: {
          project_id: input.project_id,
          created_at_ms: 1,
        },
        conversation: {
          project_id: input.project_id,
          conversation_id: conversationId,
          created_at_ms: 1,
        },
        request_digest: input.request_digest,
        start_head: eventHead(second),
        attempt_number: 1,
        mode: 'work',
        events: [first, second],
        run_terminal_failure_code: null,
        ids: {
          turn_id: turnId,
          task_id: taskId,
          run_id: runId,
        },
      };
    },
    begin_question(input) {
      calls.question.push(input);
      generation += 1;
      const suffix = UUIDS[(generation + 4) % UUIDS.length];
      const projectUuid = input.project_id.slice('builder-project:'.length);
      const conversationId = `builder-conversation:${projectUuid}`;
      const turnId = `builder-turn:${suffix}`;
      const runId = `builder-run:${suffix}`;
      const first = createBuilderConversationEvent({
        record_version: CONVERSATION_EVENT_VERSION,
        record_kind: CONVERSATION_EVENT_KIND,
        project_id: input.project_id,
        conversation_id: conversationId,
        sequence: 1,
        command_id: `builder-command:${UUIDS[(generation + 5) % UUIDS.length]}`,
        event_type: 'turn_submitted',
        previous_event: null,
        payload: {
          message: {
            message_id: `builder-message:${UUIDS[(generation + 6) % UUIDS.length]}`,
            text: input.question,
          },
          turn_id: turnId,
          mode: 'question',
          task: null,
          base_revision: input.base_revision,
        },
        authority: { ...CONVERSATION_AUTHORITY },
      });
      const second = createBuilderConversationEvent({
        record_version: CONVERSATION_EVENT_VERSION,
        record_kind: CONVERSATION_EVENT_KIND,
        project_id: input.project_id,
        conversation_id: conversationId,
        sequence: 2,
        command_id: `builder-command:${UUIDS[(generation + 7) % UUIDS.length]}`,
        event_type: 'run_started',
        previous_event: eventHead(first),
        payload: {
          turn_id: turnId,
          run_id: runId,
          task_id: null,
          attempt_number: 1,
          retry_of_run_id: null,
          input_digest: input.request_digest,
        },
        authority: { ...CONVERSATION_AUTHORITY },
      });
      return {
        context_version: 'builder-conversation-run-context.v1',
        mode: 'question',
        project: {
          project_id: input.project_id,
          created_at_ms: 1,
        },
        conversation: {
          project_id: input.project_id,
          conversation_id: conversationId,
          created_at_ms: 1,
        },
        request_digest: input.request_digest,
        start_head: eventHead(second),
        attempt_number: 1,
        events: [first, second],
        run_terminal_failure_code: null,
        ids: {
          turn_id: turnId,
          task_id: null,
          run_id: runId,
        },
      };
    },
    complete_candidate(input) {
      calls.candidate.push(input);
      const head = {
        sequence: input.context.start_head.sequence + 2,
        event_id: `builder-conversation-event:${'a'.repeat(64)}`,
        event_digest: `sha256:${'b'.repeat(64)}`,
      };
      const receipt = input.candidate_result.git_candidate_receipt;
      candidateDrafts.set(input.candidate_result.draft_id, {
        result_version: 'builder-conversation-candidate-draft-read-result.v1',
        draft_id: input.candidate_result.draft_id,
        project_id: receipt.project_id,
        conversation_id: receipt.conversation_id,
        turn_id: receipt.turn_id,
        task_id: receipt.task_id,
        run_id: receipt.run_id,
        candidate_digest: receipt.candidate_digest,
        base_revision: input.context.events[0].payload.base_revision,
        conversation_head: head,
        candidate_result: input.candidate_result,
        verification_admission: 'sqlite_replay_verified',
      });
      return { head };
    },
    complete_explanation(input) {
      calls.explanation.push(input);
      return {
        head: {
          sequence: input.context.start_head.sequence + 2,
          event_id: `builder-conversation-event:${'e'.repeat(64)}`,
          event_digest: `sha256:${'f'.repeat(64)}`,
        },
      };
    },
    complete_plan(input) {
      calls.plan.push(input);
      return {
        head: {
          sequence: input.context.start_head.sequence + 2,
          event_id: `builder-conversation-event:${'9'.repeat(64)}`,
          event_digest: `sha256:${'8'.repeat(64)}`,
        },
      };
    },
    complete_failure(input) {
      calls.completeFailure.push(input);
      return {
        head: {
          sequence: input.context.start_head.sequence + 2,
          event_id: `builder-conversation-event:${'c'.repeat(64)}`,
          event_digest: `sha256:${'d'.repeat(64)}`,
        },
      };
    },
    record_run_progress(input) {
      calls.progress.push(input);
      const event = progressEvent(input.context, input.stage);
      return {
        ...input.context,
        start_head: eventHead(event),
        events: [...input.context.events, event],
      };
    },
    record_retryable_failure(input) {
      calls.failure.push(input);
      return {
        ...input.context,
        run_terminal_failure_code: input.failure_code,
      };
    },
    retry_after_failure(input) {
      calls.retry.push(input);
      generation += 1;
      const suffix = UUIDS[(generation + 4) % UUIDS.length];
      const started = createBuilderConversationEvent({
        record_version: CONVERSATION_EVENT_VERSION,
        record_kind: CONVERSATION_EVENT_KIND,
        project_id: input.context.project.project_id,
        conversation_id: input.context.conversation.conversation_id,
        sequence: input.context.start_head.sequence + 1,
        command_id: `builder-command:${UUIDS[(generation + 7) % UUIDS.length]}`,
        event_type: 'run_started',
        previous_event: input.context.start_head,
        payload: {
          turn_id: input.context.ids.turn_id,
          run_id: `builder-run:${suffix}`,
          task_id: input.context.ids.task_id,
          attempt_number: input.context.attempt_number + 1,
          retry_of_run_id: input.context.ids.run_id,
          input_digest: input.context.request_digest,
        },
        authority: { ...CONVERSATION_AUTHORITY },
      });
      return {
        ...input.context,
        start_head: eventHead(started),
        attempt_number: input.context.attempt_number + 1,
        ids: {
          ...input.context.ids,
          run_id: `builder-run:${suffix}`,
        },
        events: [
          ...input.context.events,
          started,
        ],
        run_terminal_failure_code: null,
      };
    },
    request_cancel(input) {
      calls.cancel.push(input);
      return {
        ...input.context,
        cancel_requested: true,
      };
    },
    record_steering(input) {
      calls.steering.push(input);
      const event = steeringEvent(input.context, input.message);
      return {
        ...input.context,
        start_head: eventHead(event),
        events: [...input.context.events, event],
      };
    },
    read_candidate_draft(input) {
      calls.readCandidate.push(input);
      if (rejectedDrafts.has(input.draft_id)) {
        const error = new Error('candidate rejected');
        error.code = 'builder_conversation_main_service_unavailable';
        throw error;
      }
      const candidate = candidateDrafts.get(input.draft_id);
      if (candidate !== undefined) return candidate;
      const error = new Error('missing private draft');
      error.code = 'builder_product_metadata_not_found';
      throw error;
    },
    reject_candidate(input) {
      calls.rejectCandidate.push(input);
      const candidate = candidateDrafts.get(input.draft_id);
      if (candidate === undefined || rejectedDrafts.has(input.draft_id)) {
        const error = new Error('missing private draft');
        error.code = 'builder_conversation_main_service_unavailable';
        throw error;
      }
      rejectedDrafts.add(input.draft_id);
      return {
        result_version: 'builder-conversation-candidate-reject-result.v1',
        draft_id: input.draft_id,
        project_id: candidate.project_id,
        conversation_id: candidate.conversation_id,
        rejection_admission: 'sqlite_recorded',
      };
    },
    read_stream(input) {
      calls.readStream.push(input);
      if (typeof readStreamResult === 'function') return readStreamResult(input);
      if (readStreamResult !== null) return readStreamResult;
      return taskStreamAbsent(input.project_id);
    },
    read_approved_plan(input) {
      calls.readApprovedPlan.push(input);
      return {
        result_version: 'builder-conversation-approved-plan-read-result.v1',
        project_id: input.project_id,
        conversation_id: input.conversation_id,
        turn_id: input.turn_id,
        task_id: APPROVED_PLAN_TASK_ID,
        run_id: input.run_id,
        decision: 'approved',
        plan_result_digest: `sha256:${'a'.repeat(64)}`,
        approved_plan_public_text: 'Review the approved plan.\n\nPlan:\n1. Build the approved change.',
        conversation_head: {
          sequence: 7,
          event_id: `builder-conversation-event:${'b'.repeat(64)}`,
          event_digest: `sha256:${'c'.repeat(64)}`,
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
      };
    },
    admit_approved_plan_continuation(input) {
      calls.approvedPlanContinuation.push(input);
      return createBuilderApprovedPlanContinuationAdmission({
        approved_plan: {
          result_version: 'builder-conversation-approved-plan-read-result.v1',
          project_id: input.project_id,
          conversation_id: input.conversation_id,
          turn_id: input.turn_id,
          task_id: APPROVED_PLAN_TASK_ID,
          run_id: input.run_id,
          decision: 'approved',
          plan_result_digest: `sha256:${'a'.repeat(64)}`,
          conversation_head: {
            sequence: 7,
            event_id: `builder-conversation-event:${'b'.repeat(64)}`,
            event_digest: `sha256:${'c'.repeat(64)}`,
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
        continuation_id: `builder-approved-plan-continuation:${UUIDS[5]}`,
        admitted_at_ms: 8_000,
      });
    },
    begin_approved_plan_work(input) {
      calls.approvedPlanWork.push(input);
      return service.begin_work({
        project_id: input.project_id,
        instruction: input.instruction,
        request_digest: input.request_digest,
        base_revision: input.base_revision,
      });
    },
    begin_draft_continuation_work(input) {
      calls.draftContinuationWork.push(input);
      generation += 1;
      const draft = candidateDrafts.get(input.admission.draft_id);
      if (draft === undefined || rejectedDrafts.has(input.admission.draft_id)) {
        const error = new Error('missing private draft');
        error.code = 'builder_conversation_main_service_unavailable';
        throw error;
      }
      const suffix = UUIDS[(generation + 4) % UUIDS.length];
      const first = createBuilderConversationEvent({
        record_version: CONVERSATION_EVENT_VERSION,
        record_kind: CONVERSATION_EVENT_KIND,
        project_id: input.admission.project_id,
        conversation_id: input.admission.conversation_id,
        sequence: 1,
        command_id: `builder-command:${UUIDS[(generation + 5) % UUIDS.length]}`,
        event_type: 'turn_submitted',
        previous_event: null,
        payload: {
          message: {
            message_id: `builder-message:${UUIDS[(generation + 6) % UUIDS.length]}`,
            text: input.instruction,
          },
          turn_id: `builder-turn:${suffix}`,
          mode: 'work',
          task: {
            task_id: `builder-task:${suffix}`,
            title: 'Revise unsaved draft',
          },
          base_revision: draft.base_revision,
        },
        authority: { ...CONVERSATION_AUTHORITY },
      });
      const second = createBuilderConversationEvent({
        record_version: CONVERSATION_EVENT_VERSION,
        record_kind: CONVERSATION_EVENT_KIND,
        project_id: input.admission.project_id,
        conversation_id: input.admission.conversation_id,
        sequence: first.sequence + 1,
        command_id: `builder-command:${UUIDS[(generation + 7) % UUIDS.length]}`,
        event_type: 'run_started',
        previous_event: eventHead(first),
        payload: {
          turn_id: `builder-turn:${suffix}`,
          run_id: `builder-run:${suffix}`,
          task_id: `builder-task:${suffix}`,
          attempt_number: 1,
          retry_of_run_id: null,
          input_digest: input.request_digest,
        },
        authority: { ...CONVERSATION_AUTHORITY },
      });
      return {
        context_version: 'builder-conversation-run-context.v1',
        mode: 'work',
        project: {
          project_id: input.admission.project_id,
          created_at_ms: 1,
        },
        conversation: {
          project_id: input.admission.project_id,
          conversation_id: input.admission.conversation_id,
          created_at_ms: 1,
        },
        request_digest: input.request_digest,
        start_head: eventHead(second),
        attempt_number: 1,
        events: [first, second],
        run_terminal_failure_code: null,
        ids: {
          turn_id: `builder-turn:${suffix}`,
          task_id: `builder-task:${suffix}`,
          run_id: `builder-run:${suffix}`,
        },
        cancel_requested: false,
        draft_continuation: {
          admission_digest: input.admission.admission_digest,
          draft_id: input.admission.draft_id,
          previous_turn_id: input.admission.previous_turn_id,
          previous_task_id: input.admission.previous_task_id,
          previous_run_id: input.admission.previous_run_id,
          previous_candidate_digest: input.admission.candidate_digest,
        },
      };
    },
  };
  return service;
}

function gitAuthority() {
  const receipts = [];
  return {
    receipts,
    async persist_candidate_commit(input) {
      const provisional = {
        receipt_version: 'builder-git-candidate-receipt.v1',
        repository_version: 'builder-git-project-repository.v1',
        project_id: input.candidate.project_id,
        conversation_id: input.candidate.conversation_id,
        turn_id: input.candidate.turn_id,
        task_id: input.candidate.task_id,
        run_id: input.candidate.run_id,
        request_id: input.request_id,
        candidate_id: input.candidate.candidate_id,
        candidate_digest: input.candidate.candidate_digest,
        resulting_tree_digest: input.candidate.resulting_tree_digest,
        semantic_identity_digest: `sha256:${'e'.repeat(64)}`,
        verification_receipt_digest: `sha256:${'0'.repeat(64)}`,
        object_format: 'sha1',
        commit_oid: '1'.repeat(40),
        tree_oid: '2'.repeat(40),
        parent_oid: input.expected_base_oid,
        expected_base_oid: input.expected_base_oid,
        code_authority: 'git_commit_candidate',
        product_revision_admission: 'not_recorded',
        replay: false,
      };
      const verification = createBuilderGitCandidateVerificationReceipt(provisional);
      const receipt = {
        ...provisional,
        verification_receipt_digest: digest(verification),
      };
      receipts.push(receipt);
      return receipt;
    },
    async verify_candidate_receipt(receipt) {
      return createBuilderGitCandidateVerificationReceipt(receipt);
    },
    async read_verified_candidate() {
      throw new Error('unexpected private candidate read');
    },
  };
}

function readResult(sourceTree = createBuilderProjectSourceTree({
  files: [{ path: 'src/app.js', content: 'export const before = true;\n' }],
})) {
  return {
    result_version: 'builder-project-read-result.v1',
    operation: 'current_loaded',
    product_revision_receipt: {
      project_id: PROJECT_ID,
      revision_receipt_digest: `sha256:${'1'.repeat(64)}`,
      commit_oid: '2'.repeat(40),
      resulting_tree_digest: sourceTree.source_tree_digest,
    },
    current: {},
    source_tree: sourceTree,
    git_candidate_receipt: {},
    git_verification_receipt: {},
    authority_evidence: {},
  };
}

function revisionReadResult({
  sourceTree,
  revisionDigest = `sha256:${'3'.repeat(64)}`,
  commitOid = '4'.repeat(40),
} = {}) {
  const base = readResult(sourceTree ?? createBuilderProjectSourceTree({
    files: [{ path: 'src/app.js', content: 'export const restored = true;\n' }],
  }));
  return {
    ...base,
    operation: 'revision_loaded',
    product_revision_receipt: {
      ...base.product_revision_receipt,
      revision_receipt_digest: revisionDigest,
      commit_oid: commitOid,
      resulting_tree_digest: base.source_tree.source_tree_digest,
    },
  };
}

function repositories(overrides = {}) {
  let generation = 0;
  const providerConfigRepository = {
    bind_current_authority() {
      generation += 1;
      const boundConfig = config(`builder-model-${generation}`);
      const boundCredential = `credential-${generation}`;
      const state = new WeakMap();
      const authority = {
        readProviderConfig() { return state.get(this).config; },
        resolveSecret(secretRef) {
          return {
            resolution_version: 'builder-provider-secret-resolution.v1',
            secret_ref: secretRef,
            credential: state.get(this).credential,
          };
        },
      };
      state.set(authority, { config: boundConfig, credential: boundCredential });
      return authority;
    },
  };
  const projectReadAuthority = {
    load_current() { throw new Error('new project must not read current source'); },
  };
  return {
    providerConfigRepository,
    projectReadAuthority,
    conversationService: conversationService(),
    gitAuthority: gitAuthority(),
    createUuid: createUuidFactory(),
    ...overrides,
  };
}

test('binds provider snapshot and returns only a redacted unsaved draft packet', async () => {
  const transportInputs = [];
  const lifecycle = conversationService();
  const service = createBuilderGenerationMainService({
    ...repositories({ conversationService: lifecycle }),
    transport: async (input) => {
      transportInputs.push(input);
      return {
        transport_version: 'builder-openai-compatible-transport.v1',
        generated_text: JSON.stringify(providerOutput()),
      };
    },
  });

  assert.equal(service.service_version, 'builder-generation-main-service.v2');
  assert.deepEqual(service.availability(), {
    version: 'builder-generation-availability.v1',
    available: true,
    reason: 'ready',
    supports_cancel: true,
  });
  const result = await service.generate(request());
  assert.equal(result.version, 'builder-generation-result.v2');
  assert.match(result.draft_id, /^builder-generation-draft:[0-9a-f]{64}$/u);
  assert.equal(result.project_id, PROJECT_ID);
  assert.equal(result.existing_project_id, null);
  assert.equal(result.candidate.candidate_version, 'builder-code-change-candidate.v2');
  assert.equal(result.admissions.draft, 'candidate_not_saved');
  assert.equal(result.admissions.save, 'not_performed');
  assert.equal(result.admissions.conversation, 'sqlite_recorded');
  assert.equal(result.restart_restore, 'not_persisted');
  assert.equal(transportInputs.length, 1);
  assert.equal(transportInputs[0].model, 'builder-model-2');
  assert.equal(transportInputs[0].credential, 'credential-2');
  assert.equal(lifecycle.calls.begin.length, 1);
  assert.equal(lifecycle.calls.candidate.length, 1);
  assert.deepEqual(lifecycle.calls.progress.map((call) => call.stage), [
    'context_ready',
    'provider_request_started',
    'provider_response_received',
    'result_preparing',
  ]);
  assert.equal(lifecycle.calls.candidate[0].context.start_head.sequence, 6);
  assert.deepEqual(lifecycle.calls.candidate[0].context.events.slice(-4).map((event) => event.event_type), [
    'run_progress_recorded',
    'run_progress_recorded',
    'run_progress_recorded',
    'run_progress_recorded',
  ]);
  assert.equal(lifecycle.calls.failure.length, 0);
  assert.equal(lifecycle.calls.completeFailure.length, 0);
  assert.doesNotMatch(JSON.stringify(result), /credential|provider\.example|builder-model|operations|conversation_events|git_request_id/iu);
  assert.deepEqual(await service.restore_draft({ draft_id: result.draft_id }), result);
  assert.deepEqual(service.authority, {
    provider_config_snapshot_bound: true,
    project_read_authority_verified_source: true,
    pending_draft_restart_restore: 'git_sqlite_verified',
    conversation_event_admission: 'sqlite_recorded',
    approved_plan_edit_context: 'main_only_fresh_continuation_current_source_no_dispatch',
    approved_plan_generation: 'main_only_approved_plan_starts_work_run_before_provider',
    plan_proposal_generation: 'main_only_source_context_plan_no_source_mutation',
    draft_continuation_admission: 'main_only_pending_draft_identity_no_dispatch',
    draft_continuation_base: 'main_only_pending_candidate_git_base_no_dispatch',
    draft_continuation_generation: 'main_only_pending_candidate_context_squashed_to_project_base',
    draft_answer_generation: 'main_only_pending_candidate_source_explanation_no_mutation',
    history_restore_as_new_version: 'main_only_git_sqlite_candidate_no_current_rewrite',
    run_steering: 'request_id_only_main_conversation_fact',
    credential_exposed_to_renderer: false,
    electron_registration: false,
    preload_exposure: false,
  });
});

test('generates first draft for a bound local project before any saved revision exists', async () => {
  const currentReads = [];
  const identityReads = [];
  const transportInputs = [];
  const lifecycle = conversationService();
  const git = gitAuthority();
  const service = createBuilderGenerationMainService({
    ...repositories({
      conversationService: lifecycle,
      gitAuthority: git,
      projectReadAuthority: {
        load_current(input) {
          currentReads.push(input);
          throw new Error(PRIVATE_MARKER);
        },
      },
      projectIdentityAuthority: {
        load_project_identity(input) {
          identityReads.push(input);
          return {
            result_version: 'builder-product-metadata-result.v4',
            operation: 'project_identity_loaded',
            project: {
              project_id: input.project_id,
              created_at_ms: 1_000,
              current_revision_receipt_digest: null,
              current_revision_number: 0,
            },
            metadata_evidence: {},
          };
        },
      },
    }),
    transport: async (input) => {
      transportInputs.push(input);
      return {
        transport_version: 'builder-openai-compatible-transport.v1',
        generated_text: JSON.stringify(providerOutput({
          summary: 'Created the first local project draft.',
        })),
      };
    },
  });
  const raw = request({
    instruction: 'Build a compact local dashboard.',
    existingProjectId: PROJECT_ID,
  });

  const result = await service.generate(raw);

  assert.deepEqual(currentReads, [{ project_id: PROJECT_ID }]);
  assert.deepEqual(identityReads, [{ project_id: PROJECT_ID }]);
  assert.equal(transportInputs.length, 1);
  assert.match(transportInputs[0].messages[1].content, /Build a compact local dashboard/u);
  assert.doesNotMatch(transportInputs[0].messages[1].content, /private-main-service-marker/u);
  assert.equal(result.version, 'builder-generation-result.v2');
  assert.equal(result.project_id, PROJECT_ID);
  assert.equal(result.existing_project_id, PROJECT_ID);
  assert.equal(result.base_revision_evidence, null);
  assert.equal(result.summary, 'Created the first local project draft.');
  assert.equal(result.admissions.conversation, 'sqlite_recorded');
  assert.equal(result.restart_restore, 'not_persisted');
  assert.equal(lifecycle.calls.begin.length, 1);
  assert.equal(lifecycle.calls.begin[0].base_revision, null);
  assert.equal(lifecycle.calls.candidate[0].context.events[0].payload.task.title, 'Create Builder project');
  assert.equal(lifecycle.calls.candidate.length, 1);
  assert.equal(git.receipts.length, 1);
  assert.equal(git.receipts[0].expected_base_oid, null);
  assert.doesNotMatch(
    JSON.stringify(result),
    /provider_config|provider_secret|credential_secret|credential_value|secret_ref|provider\.example|builder-model|git_candidate_receipt|operations|conversation_events|private-main-service-marker/iu,
  );
});

test('restores a saved revision as a new unsaved Git candidate without provider dispatch', async () => {
  const currentSourceTree = createBuilderProjectSourceTree({
    files: [
      { path: 'index.html', content: '<main>Current</main>\n' },
      { path: 'src/old.js', content: 'export const old = true;\n' },
      { path: 'src/theme.css', content: 'body { color: black; }\n' },
    ],
  });
  const targetSourceTree = createBuilderProjectSourceTree({
    files: [
      { path: 'index.html', content: '<main>Restored</main>\n' },
      { path: 'README.md', content: '# Restored version\n' },
      { path: 'src/theme.css', content: 'body { color: black; }\n' },
    ],
  });
  const targetDigest = `sha256:${'3'.repeat(64)}`;
  const currentReads = [];
  const revisionReads = [];
  const lifecycle = conversationService();
  const git = gitAuthority();
  const service = createBuilderGenerationMainService({
    ...repositories({
      conversationService: lifecycle,
      gitAuthority: git,
      projectReadAuthority: {
        load_current(query) {
          currentReads.push(query);
          return readResult(currentSourceTree);
        },
        load_revision(query) {
          revisionReads.push(query);
          return revisionReadResult({
            sourceTree: targetSourceTree,
            revisionDigest: targetDigest,
          });
        },
      },
    }),
    transport: async () => {
      throw new Error('restore must not dispatch provider transport');
    },
  });

  const result = await service.restore_revision_as_draft({
    project_id: PROJECT_ID,
    revision_receipt_digest: targetDigest,
  });

  assert.equal(result.version, 'builder-generation-result.v2');
  assert.equal(result.title, 'Restored saved version');
  assert.equal(result.summary, 'Review this restored draft before saving it as a new version.');
  assert.equal(result.project_id, PROJECT_ID);
  assert.equal(result.existing_project_id, PROJECT_ID);
  assert.equal(result.admissions.draft, 'candidate_not_saved');
  assert.equal(result.admissions.save, 'not_performed');
  assert.equal(result.restart_restore, 'not_persisted');
  assert.equal(result.source_tree.source_tree_digest, targetSourceTree.source_tree_digest);
  assert.deepEqual(
    result.source_tree.files.map((file) => file.path),
    ['README.md', 'index.html', 'src/theme.css'],
  );
  assert.equal(result.base_revision_evidence.source_tree_digest, currentSourceTree.source_tree_digest);
  assert.deepEqual(currentReads, [{ project_id: PROJECT_ID }]);
  assert.deepEqual(revisionReads, [{
    project_id: PROJECT_ID,
    revision_receipt_digest: targetDigest,
  }]);
  assert.deepEqual(lifecycle.calls.begin.map((call) => call.instruction), [
    'Restore the selected saved version.',
  ]);
  assert.deepEqual(lifecycle.calls.progress.map((call) => call.stage), [
    'context_ready',
  ]);
  assert.equal(lifecycle.calls.candidate.length, 1);
  assert.equal(lifecycle.calls.candidate[0].context.start_head.sequence, 3);
  assert.equal(
    lifecycle.calls.candidate[0].candidate_result.git_candidate_receipt.request_id,
    git.receipts[0].request_id,
  );
  assert.equal(git.receipts.length, 1);
  assert.equal(git.receipts[0].project_id, PROJECT_ID);
  assert.equal(git.receipts[0].expected_base_oid, '2'.repeat(40));
  assert.equal(git.receipts[0].resulting_tree_digest, targetSourceTree.source_tree_digest);
  assert.doesNotMatch(
    JSON.stringify(result),
    /git_candidate_receipt|verification_receipt|provider|credential|operations|src\/old\.js/iu,
  );
});

test('does not create a restore candidate when the saved revision matches current source', async () => {
  const sourceTree = createBuilderProjectSourceTree({
    files: [{ path: 'index.html', content: '<main>Same</main>\n' }],
  });
  const targetDigest = `sha256:${'3'.repeat(64)}`;
  const lifecycle = conversationService();
  const git = gitAuthority();
  const service = createBuilderGenerationMainService({
    ...repositories({
      conversationService: lifecycle,
      gitAuthority: git,
      projectReadAuthority: {
        load_current() { return readResult(sourceTree); },
        load_revision() {
          return revisionReadResult({
            sourceTree,
            revisionDigest: targetDigest,
          });
        },
      },
    }),
    transport: async () => {
      throw new Error('restore must not dispatch provider transport');
    },
  });

  await assert.rejects(
    service.restore_revision_as_draft({
      project_id: PROJECT_ID,
      revision_receipt_digest: targetDigest,
    }),
    { code: 'builder_generation_service_unavailable' },
  );
  assert.equal(lifecycle.calls.begin.length, 0);
  assert.equal(lifecycle.calls.candidate.length, 0);
  assert.equal(git.receipts.length, 0);
});

test('observes display-safe provider output deltas through a redacted main-only envelope', async () => {
  const observed = [];
  const lifecycle = conversationService();
  const service = createBuilderGenerationMainService({
    ...repositories({ conversationService: lifecycle }),
    onProviderOutputDelta(event) {
      observed.push(event);
      throw new Error(PRIVATE_MARKER);
    },
    transport: async (_input, control) => {
      assert.equal(control.signal instanceof AbortSignal, true);
      assert.equal(typeof control.on_output_delta, 'function');
      await control.on_output_delta({ delta_text: '{"kind":"builder_code_change_operations","title":"Focus",' });
      await control.on_output_delta({ delta_text: '"summary":"A quiet' });
      await control.on_output_delta({ delta_text: ' timer","operations":[{"operation":"upsert","path":"index.html","content":"<main>secret</main>"}]}' });
      return {
        transport_version: 'builder-openai-compatible-transport.v1',
        generated_text: JSON.stringify(providerOutput()),
      };
    },
  });

  const raw = request();
  const result = await service.generate(raw);

  assert.equal(result.request_id, raw.request_digest);
  assert.equal(lifecycle.calls.candidate.length, 1);
  assert.deepEqual(observed.map((event) => event.display_delta_text), [
    'A quiet',
    ' timer',
  ]);
  assert.deepEqual(Reflect.ownKeys(observed[0]).sort(), [
    'conversation_id',
    'display_delta_text',
    'event_version',
    'project_id',
    'request_id',
    'run_id',
    'task_id',
    'turn_id',
  ]);
  assert.equal(observed[0].event_version, 'builder-generation-output.v1');
  assert.equal(observed[0].request_id, raw.request_digest);
  assert.equal(observed[0].project_id, PROJECT_ID);
  assert.match(observed[0].conversation_id, /^builder-conversation:/u);
  assert.match(observed[0].turn_id, /^builder-turn:/u);
  assert.match(observed[0].task_id, /^builder-task:/u);
  assert.match(observed[0].run_id, /^builder-run:/u);
  assert.equal(Object.isFrozen(observed[0]), true);
  assert.doesNotMatch(
    JSON.stringify(observed),
    /credential|provider\.example|builder-model|source_tree|operations|index\.html|<main>|secret|git_request|receipt/iu,
  );
});

test('prepares an approved-plan edit context from fresh conversation proof and current source without dispatch', async () => {
  const sourceTree = createBuilderProjectSourceTree({
    files: [{ path: 'src/app.js', content: 'export const before = true;\n' }],
  });
  const reads = [];
  const lifecycle = conversationService();
  const git = gitAuthority();
  let transportCalled = false;
  const service = createBuilderGenerationMainService({
    ...repositories({
      conversationService: lifecycle,
      gitAuthority: git,
      projectReadAuthority: {
        load_current(input) {
          reads.push(input);
          return readResult(sourceTree);
        },
      },
      providerConfigRepository: {
        bind_current_authority() {
          throw new Error(PRIVATE_MARKER);
        },
      },
    }),
    transport: async () => {
      transportCalled = true;
      throw new Error(PRIVATE_MARKER);
    },
  });

  const context = await service.prepare_approved_plan_edit_context(approvedPlanEditRequest());

  assert.equal(context.context_version, 'builder-approved-plan-edit-context.v1');
  assert.equal(context.project_id, PROJECT_ID);
  assert.equal(context.conversation_id, CONVERSATION_ID);
  assert.equal(context.turn_id, APPROVED_PLAN_TURN_ID);
  assert.equal(context.task_id, APPROVED_PLAN_TASK_ID);
  assert.equal(context.run_id, APPROVED_PLAN_RUN_ID);
  assert.equal(context.plan_result_digest, `sha256:${'a'.repeat(64)}`);
  assert.equal(
    context.approved_plan_public_text,
    'Review the approved plan.\n\nPlan:\n1. Build the approved change.',
  );
  assert.deepEqual(context.conversation_head, {
    sequence: 7,
    event_id: `builder-conversation-event:${'b'.repeat(64)}`,
    event_digest: `sha256:${'c'.repeat(64)}`,
  });
  assert.match(context.continuation_id, /^builder-approved-plan-continuation:[0-9a-f-]{36}$/u);
  assert.match(context.continuation_admission_digest, /^sha256:[0-9a-f]{64}$/u);
  assert.deepEqual(context.base_revision, {
    revision_receipt_digest: `sha256:${'1'.repeat(64)}`,
    commit_oid: '2'.repeat(40),
  });
  assert.deepEqual(context.base_revision_evidence, {
    evidence_version: 'builder-project-base-revision-evidence.v2',
    project_id: PROJECT_ID,
    revision_receipt_digest: `sha256:${'1'.repeat(64)}`,
    commit_oid: '2'.repeat(40),
    source_tree_digest: sourceTree.source_tree_digest,
    verification_admission: 'git_sqlite_read_authority_verified',
  });
  assert.equal(context.base_source_tree.source_tree_digest, sourceTree.source_tree_digest);
  assert.deepEqual(context.lifecycle, {
    approved_plan_continuation: 'fresh_current_head_verified',
    approved_plan_public_text: 'sqlite_public_assistant_message_verified',
    source_read: 'git_sqlite_current_verified',
    provider_dispatch: 'not_started',
    tool_dispatch: 'not_started',
    source_mutation: 'not_performed',
    git_candidate: 'not_created',
    revision_admission: 'not_created',
  });
  assert.deepEqual(context.authority, {
    context_authority: 'main_generation_approved_plan_edit_context_v1',
    conversation_binding: 'fresh_approved_plan_continuation_required',
    approved_plan_text_authority: 'sqlite_replay_public_assistant_message',
    project_read_authority: 'git_sqlite_current_source_verified',
    renderer_authority: 'not_present',
    provider_dispatch: false,
    credential_readback: false,
    tool_dispatch: 'not_performed',
    source_mutation: 'not_performed',
    git_authority: 'not_present',
    revision_authority: 'not_present',
  });
  assert.deepEqual(lifecycle.calls.readApprovedPlan, [approvedPlanEditRequest()]);
  assert.deepEqual(lifecycle.calls.approvedPlanContinuation, [approvedPlanEditRequest()]);
  assert.deepEqual(reads, [{ project_id: PROJECT_ID }]);
  assert.deepEqual(lifecycle.calls.begin, []);
  assert.deepEqual(lifecycle.calls.question, []);
  assert.deepEqual(lifecycle.calls.candidate, []);
  assert.deepEqual(lifecycle.calls.explanation, []);
  assert.deepEqual(lifecycle.calls.failure, []);
  assert.deepEqual(lifecycle.calls.completeFailure, []);
  assert.deepEqual(lifecycle.calls.cancel, []);
  assert.deepEqual(lifecycle.calls.readCandidate, []);
  assert.deepEqual(lifecycle.calls.rejectCandidate, []);
  assert.deepEqual(lifecycle.calls.approvedPlanWork, []);
  assert.equal(git.receipts.length, 0);
  assert.equal(transportCalled, false);
  assert.equal(Object.isFrozen(context), true);
  assert.equal(Object.isFrozen(context.conversation_head), true);
  assert.equal(Object.isFrozen(context.base_revision), true);
  assert.equal(Object.isFrozen(context.base_revision_evidence), true);
  assert.equal(Object.isFrozen(context.base_source_tree.files[0]), true);
  assert.doesNotMatch(
    JSON.stringify(context),
    /provider_config|provider_secret|credential_secret|credential_value|secret_ref|git_candidate_receipt|candidate_digest|save_admission|transport_version|builder-model|provider\.example/iu,
  );
});

test('generates an unsaved candidate from the current approved plan through main-only work start', async () => {
  const sourceTree = createBuilderProjectSourceTree({
    files: [{ path: 'src/app.js', content: 'export const before = true;\n' }],
  });
  const lifecycle = conversationService();
  const git = gitAuthority();
  const transportInputs = [];
  const started = [];
  const service = createBuilderGenerationMainService({
    ...repositories({
      conversationService: lifecycle,
      gitAuthority: git,
      projectReadAuthority: {
        load_current(input) {
          assert.deepEqual(input, { project_id: PROJECT_ID });
          return readResult(sourceTree);
        },
      },
    }),
    onGenerationStarted(event) {
      started.push(event);
    },
    transport: async (input) => {
      transportInputs.push(input);
      assert.match(input.messages[1].content, /Review the approved plan/u);
      return {
        transport_version: 'builder-openai-compatible-transport.v1',
        generated_text: JSON.stringify(providerOutput({
          summary: 'Applied the approved plan.',
        })),
      };
    },
  });

  const result = await service.generate_approved_plan(approvedPlanEditRequest());

  assert.equal(result.version, 'builder-generation-result.v2');
  assert.equal(result.project_id, PROJECT_ID);
  assert.match(result.draft_id, /^builder-generation-draft:[0-9a-f]{64}$/u);
  assert.equal(result.title, 'Focus timer');
  assert.equal(result.summary, 'Applied the approved plan.');
  assert.equal(result.admissions.conversation, 'sqlite_recorded');
  assert.equal(result.restart_restore, 'not_persisted');
  assert.equal(lifecycle.calls.readApprovedPlan.length, 1);
  assert.equal(lifecycle.calls.approvedPlanContinuation.length, 1);
  assert.equal(lifecycle.calls.approvedPlanWork.length, 1);
  assert.equal(lifecycle.calls.begin.length, 1);
  assert.equal(lifecycle.calls.begin[0].instruction, 'Review the approved plan.\n\nPlan:\n1. Build the approved change.');
  assert.equal(lifecycle.calls.begin[0].base_revision.commit_oid, '2'.repeat(40));
  assert.equal(lifecycle.calls.progress.length, 4);
  assert.equal(lifecycle.calls.candidate.length, 1);
  assert.equal(git.receipts.length, 1);
  assert.equal(transportInputs.length, 1);
  assert.equal(started.length, 1);
  assert.equal(started[0].project_id, PROJECT_ID);
  assert.doesNotMatch(
    JSON.stringify(result),
    /provider_config|provider_secret|credential_secret|credential_value|secret_ref|provider\.example|builder-model|git_candidate_receipt|operations|conversation_events/iu,
  );
});

test('fails approved-plan edit context closed on malformed request, stale continuation, or source drift', async () => {
  const malformedLifecycle = conversationService();
  const malformedReads = [];
  const malformedService = createBuilderGenerationMainService({
    ...repositories({
      conversationService: malformedLifecycle,
      projectReadAuthority: {
        load_current(input) {
          malformedReads.push(input);
          throw new Error(PRIVATE_MARKER);
        },
      },
      providerConfigRepository: {
        bind_current_authority() {
          throw new Error(PRIVATE_MARKER);
        },
      },
    }),
    transport: async () => {
      throw new Error(PRIVATE_MARKER);
    },
  });

  await assert.rejects(
    malformedService.prepare_approved_plan_edit_context(approvedPlanEditRequest({ unexpected: true })),
    (error) => error.code === 'builder_generation_service_unavailable'
      && !`${error.message}:${error.stack}`.includes(PRIVATE_MARKER),
  );
  assert.deepEqual(malformedLifecycle.calls.readApprovedPlan, []);
  assert.deepEqual(malformedLifecycle.calls.approvedPlanContinuation, []);
  assert.deepEqual(malformedReads, []);

  const staleLifecycle = conversationService();
  const staleReads = [];
  staleLifecycle.admit_approved_plan_continuation = function admitStaleContinuation(input) {
    staleLifecycle.calls.approvedPlanContinuation.push(input);
    return createBuilderApprovedPlanContinuationAdmission({
      approved_plan: {
        result_version: 'builder-conversation-approved-plan-read-result.v1',
        project_id: input.project_id,
        conversation_id: input.conversation_id,
        turn_id: `builder-turn:${UUIDS[6]}`,
        task_id: APPROVED_PLAN_TASK_ID,
        run_id: input.run_id,
        decision: 'approved',
        plan_result_digest: `sha256:${'a'.repeat(64)}`,
        conversation_head: {
          sequence: 7,
          event_id: `builder-conversation-event:${'b'.repeat(64)}`,
          event_digest: `sha256:${'c'.repeat(64)}`,
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
      continuation_id: `builder-approved-plan-continuation:${UUIDS[7]}`,
      admitted_at_ms: 9_000,
    });
  };
  const staleService = createBuilderGenerationMainService({
    ...repositories({
      conversationService: staleLifecycle,
      projectReadAuthority: {
        load_current(input) {
          staleReads.push(input);
          throw new Error(PRIVATE_MARKER);
        },
      },
    }),
    transport: async () => {
      throw new Error(PRIVATE_MARKER);
    },
  });

  await assert.rejects(
    staleService.prepare_approved_plan_edit_context(approvedPlanEditRequest()),
    (error) => error.code === 'builder_generation_service_unavailable'
      && !`${error.message}:${error.stack}`.includes(PRIVATE_MARKER),
  );
  assert.deepEqual(staleLifecycle.calls.readApprovedPlan, [approvedPlanEditRequest()]);
  assert.deepEqual(staleLifecycle.calls.approvedPlanContinuation, [approvedPlanEditRequest()]);
  assert.deepEqual(staleReads, []);

  const driftLifecycle = conversationService();
  const driftReads = [];
  const sourceTree = createBuilderProjectSourceTree({
    files: [{ path: 'src/app.js', content: 'export const drift = true;\n' }],
  });
  const driftResult = readResult(sourceTree);
  const driftService = createBuilderGenerationMainService({
    ...repositories({
      conversationService: driftLifecycle,
      projectReadAuthority: {
        load_current(input) {
          driftReads.push(input);
          return {
            ...driftResult,
            product_revision_receipt: {
              ...driftResult.product_revision_receipt,
              resulting_tree_digest: `sha256:${'f'.repeat(64)}`,
            },
          };
        },
      },
    }),
    transport: async () => {
      throw new Error(PRIVATE_MARKER);
    },
  });

  await assert.rejects(
    driftService.prepare_approved_plan_edit_context(approvedPlanEditRequest()),
    (error) => error.code === 'builder_generation_service_unavailable'
      && !`${error.message}:${error.stack}`.includes(PRIVATE_MARKER),
  );
  assert.deepEqual(driftLifecycle.calls.readApprovedPlan, [approvedPlanEditRequest()]);
  assert.deepEqual(driftLifecycle.calls.approvedPlanContinuation, [approvedPlanEditRequest()]);
  assert.deepEqual(driftReads, [{ project_id: PROJECT_ID }]);
});

test('revalidates cached pending drafts against durable conversation rejection', async () => {
  const lifecycle = conversationService();
  const service = createBuilderGenerationMainService({
    ...repositories({ conversationService: lifecycle }),
    transport: async () => ({
      transport_version: 'builder-openai-compatible-transport.v1',
      generated_text: JSON.stringify(providerOutput()),
    }),
  });
  const result = await service.generate(request());
  lifecycle.reject_draft_for_test(result.draft_id);

  await assert.rejects(
    service.restore_draft({ draft_id: result.draft_id }),
    (error) => error.code === 'builder_generation_service_unavailable'
      && !`${error.message}:${error.stack}`.includes(result.draft_id),
  );
  await assert.rejects(
    service.read_pending_draft({ draft_id: result.draft_id }),
    (error) => error.code === 'builder_generation_service_unavailable'
      && !`${error.message}:${error.stack}`.includes(result.draft_id),
  );
  assert.deepEqual(lifecycle.calls.readCandidate, [
    { draft_id: result.draft_id },
    { draft_id: result.draft_id },
  ]);
});

test('rejects a pending draft by draft id and releases main-only cache', async () => {
  const lifecycle = conversationService();
  const git = gitAuthority();
  const service = createBuilderGenerationMainService({
    ...repositories({ conversationService: lifecycle, gitAuthority: git }),
    transport: async () => ({
      transport_version: 'builder-openai-compatible-transport.v1',
      generated_text: JSON.stringify(providerOutput()),
    }),
  });
  const result = await service.generate(request());

  assert.deepEqual(service.reject_draft({ draft_id: result.draft_id }), {
    result_version: 'builder-generation-draft-rejection-result.v1',
    draft_id: result.draft_id,
    project_id: PROJECT_ID,
    rejected: true,
    pending_draft_released: true,
    conversation_event_admission: 'sqlite_recorded',
  });
  assert.deepEqual(lifecycle.calls.rejectCandidate, [{ draft_id: result.draft_id }]);
  await assert.rejects(
    service.read_pending_draft({ draft_id: result.draft_id }),
    (error) => error.code === 'builder_generation_service_unavailable'
      && !`${error.message}:${error.stack}`.includes(result.draft_id),
  );
  await assert.rejects(
    service.restore_draft({ draft_id: result.draft_id }),
    (error) => error.code === 'builder_generation_service_unavailable'
      && !`${error.message}:${error.stack}`.includes(result.draft_id),
  );
  assert.equal(git.receipts.length, 1);
});

test('records a provider explanation without creating Git candidate, draft, or save facts', async () => {
  const sourceTree = createBuilderProjectSourceTree({
    files: [{ path: 'src/app.js', content: 'export const saved = true;\n' }],
  });
  const reads = [];
  const transportInputs = [];
  const lifecycle = conversationService();
  const git = gitAuthority();
  const service = createBuilderGenerationMainService({
    ...repositories({
      conversationService: lifecycle,
      gitAuthority: git,
      projectReadAuthority: {
        load_current(query) {
          reads.push(query);
          return readResult(sourceTree);
        },
      },
    }),
    transport: async (input) => {
      transportInputs.push(input);
      return {
        transport_version: 'builder-openai-compatible-transport.v1',
        generated_text: JSON.stringify(providerExplanation()),
      };
    },
  });

  const result = await service.answer(request({
    instruction: 'What does this project do?',
    existingProjectId: PROJECT_ID,
  }));

  assert.deepEqual(reads, [{ project_id: PROJECT_ID }]);
  assert.equal(result.version, 'builder-generation-result.v2');
  assert.equal(result.result_kind, 'explanation');
  assert.equal(result.project_id, PROJECT_ID);
  assert.equal(result.existing_project_id, PROJECT_ID);
  assert.equal(result.admissions.conversation, 'sqlite_recorded');
  assert.equal(result.admissions.draft, 'not_created');
  assert.equal(result.admissions.save, 'not_performed');
  assert.match(result.explanation, /does not change files/u);
  assert.equal(lifecycle.calls.begin.length, 0);
  assert.equal(lifecycle.calls.question.length, 1);
  assert.equal(lifecycle.calls.question[0].question, 'What does this project do?');
  assert.equal(lifecycle.calls.question[0].base_revision.revision_receipt_digest, `sha256:${'1'.repeat(64)}`);
  assert.equal(lifecycle.calls.candidate.length, 0);
  assert.equal(lifecycle.calls.explanation.length, 1);
  assert.deepEqual(lifecycle.calls.progress.map((call) => call.stage), [
    'context_ready',
    'provider_request_started',
    'provider_response_received',
    'result_preparing',
  ]);
  assert.equal(lifecycle.calls.explanation[0].context.start_head.sequence, 6);
  assert.equal(lifecycle.calls.failure.length, 0);
  assert.equal(git.receipts.length, 0);
  assert.equal(transportInputs.length, 1);
  assert.match(transportInputs[0].messages[1].content, /export const saved = true/u);
  assert.equal(Object.hasOwn(result, 'draft_id'), false);
  assert.equal(Object.hasOwn(result, 'source_tree'), false);
  assert.doesNotMatch(
    JSON.stringify(result),
    /candidate|git_request|operations|source_tree|credential|provider\.example|builder-model/u,
  );
});

test('answers pending draft questions from verified candidate source without source mutation', async () => {
  const lifecycle = conversationService();
  const git = gitAuthority();
  const candidateSourceByRequestId = new Map();
  const persistCandidateCommit = git.persist_candidate_commit.bind(git);
  git.persist_candidate_commit = async (input) => {
    const receipt = await persistCandidateCommit(input);
    candidateSourceByRequestId.set(receipt.request_id, input.candidate.resulting_source_tree);
    return receipt;
  };
  git.read_verified_candidate = async (receipt) => ({
    result_version: 'builder-git-verified-candidate-read-result.v1',
    candidate_receipt: receipt,
    verification_receipt: createBuilderGitCandidateVerificationReceipt(receipt),
    source_tree: candidateSourceByRequestId.get(receipt.request_id),
    code_authority: 'git_commit_tree',
    read_admission: 'verified',
  });
  const transportInputs = [];
  const service = createBuilderGenerationMainService({
    ...repositories({
      conversationService: lifecycle,
      gitAuthority: git,
    }),
    transport: async (input) => {
      transportInputs.push(input);
      return {
        transport_version: 'builder-openai-compatible-transport.v1',
        generated_text: JSON.stringify(
          transportInputs.length === 1
            ? providerOutput()
            : providerExplanation({
              explanation: 'The draft currently contains a Focus heading and static files.',
            }),
        ),
      };
    },
  });

  const draft = await service.generate(request({ instruction: 'Make a focus timer.' }));
  const result = await service.answer_draft({
    draft_id: draft.draft_id,
    instruction: 'Why is the preview blank?',
    project_id: draft.project_id,
  });

  assert.equal(result.version, 'builder-generation-result.v2');
  assert.equal(result.result_kind, 'explanation');
  assert.equal(result.project_id, draft.project_id);
  assert.equal(result.existing_project_id, draft.project_id);
  assert.equal(result.admissions.conversation, 'sqlite_recorded');
  assert.equal(result.admissions.draft, 'not_created');
  assert.equal(result.admissions.save, 'not_performed');
  assert.match(result.explanation, /Focus heading/u);
  assert.equal(lifecycle.calls.readCandidate.length, 1);
  assert.deepEqual(lifecycle.calls.readCandidate[0], { draft_id: draft.draft_id });
  assert.equal(lifecycle.calls.question.length, 1);
  assert.equal(lifecycle.calls.question[0].project_id, draft.project_id);
  assert.equal(lifecycle.calls.question[0].question, 'Why is the preview blank?');
  assert.equal(lifecycle.calls.question[0].base_revision, null);
  assert.equal(lifecycle.calls.candidate.length, 1);
  assert.equal(lifecycle.calls.explanation.length, 1);
  assert.equal(git.receipts.length, 1);
  assert.equal(transportInputs.length, 2);
  assert.match(transportInputs[1].messages[1].content, /<main><h1>Focus<\/h1><\/main>/u);
  assert.equal(Object.hasOwn(result, 'draft_id'), false);
  assert.equal(Object.hasOwn(result, 'source_tree'), false);
  assert.doesNotMatch(
    JSON.stringify(result),
    /candidate|git_candidate_receipt|candidate_digest|source_tree|credential|provider\.example|builder-model|<main>/iu,
  );
});

test('records a main-only plan proposal from collected source context without source mutation', async () => {
  const currentSource = createBuilderProjectSourceTree({
    files: [{ path: 'src/app.tsx', content: 'export const before = true;\n' }],
  });
  const reads = [];
  const collected = [];
  const observed = [];
  const transportInputs = [];
  const started = [];
  const lifecycle = conversationService();
  const git = gitAuthority();
  const service = createBuilderGenerationMainService({
    ...repositories({
      conversationService: lifecycle,
      gitAuthority: git,
      projectReadAuthority: {
        load_current(query) {
          reads.push(query);
          return readResult(currentSource);
        },
      },
      sourceContextCollector: {
        collect_project_source_context(input) {
          collected.push(input);
          return sourceContextResult(input.context, [
            { path: 'src/app.tsx', content: 'export const Settings = () => null;\n' },
          ]);
        },
      },
    }),
    onGenerationStarted(event) {
      started.push(event);
    },
    onProviderOutputDelta(event) {
      observed.push(event);
      throw new Error(PRIVATE_MARKER);
    },
    transport: async (input, control) => {
      transportInputs.push(input);
      assert.equal(control.signal instanceof AbortSignal, true);
      assert.equal(typeof control.on_output_delta, 'function');
      await control.on_output_delta({ delta_text: '{"kind":"builder_project_plan_proposal","title":"Review",' });
      await control.on_output_delta({ delta_text: '"summary":"Prepare a bounded' });
      await control.on_output_delta({ delta_text: ' implementation before editing","steps":[{"title":"secret source text"}]}' });
      assert.match(input.messages[0].content, /builder_project_plan_proposal/u);
      assert.doesNotMatch(input.messages[0].content, /builder_code_change_operations|builder_conversation_explanation/u);
      assert.match(input.messages[1].content, /Plan a smaller settings panel/u);
      assert.match(input.messages[1].content, /export const Settings/u);
      return {
        transport_version: 'builder-openai-compatible-transport.v1',
        generated_text: JSON.stringify(providerPlan()),
      };
    },
  });
  const raw = request({
    instruction: 'Plan a smaller settings panel.',
    existingProjectId: PROJECT_ID,
  });

  const result = await service.propose_plan({
    request: raw,
    resource_ids: ['project:/src/app.tsx'],
  });

  assert.deepEqual(reads, [{ project_id: PROJECT_ID }]);
  assert.equal(result.version, 'builder-generation-result.v2');
  assert.equal(result.result_kind, 'plan');
  assert.equal(result.request_id, raw.request_digest);
  assert.equal(result.project_id, PROJECT_ID);
  assert.equal(result.existing_project_id, PROJECT_ID);
  assert.equal(result.title, 'Review the change plan');
  assert.deepEqual(result.steps.map((step) => step.status), ['proposed', 'proposed']);
  assert.deepEqual(result.admissions, {
    conversation: 'sqlite_recorded',
    draft: 'not_created',
    save: 'not_performed',
    preview: 'not_applicable',
    execution: 'not_evaluated',
    revision: 'not_created',
    review: 'not_recorded',
  });
  assert.deepEqual(result.conversation_head, {
    sequence: 10,
    event_id: `builder-conversation-event:${'9'.repeat(64)}`,
    event_digest: `sha256:${'8'.repeat(64)}`,
  });
  assert.equal(lifecycle.calls.begin.length, 1);
  assert.equal(lifecycle.calls.begin[0].instruction, 'Plan a smaller settings panel.');
  assert.equal(lifecycle.calls.begin[0].base_revision.commit_oid, '2'.repeat(40));
  assert.equal(collected.length, 1);
  assert.equal(collected[0].context.project.project_id, PROJECT_ID);
  assert.deepEqual(collected[0].resource_ids, ['project:/src/app.tsx']);
  assert.equal(lifecycle.calls.plan.length, 1);
  assert.equal(lifecycle.calls.plan[0].context.ids.turn_id, collected[0].context.ids.turn_id);
  assert.equal(lifecycle.calls.plan[0].context.start_head.sequence, 8);
  assert.equal(lifecycle.calls.plan[0].plan_proposal_record.context_binding.file_count, 1);
  assert.equal(lifecycle.calls.plan[0].plan_proposal_record.lifecycle.source_mutation, 'not_performed');
  assert.equal(lifecycle.calls.candidate.length, 0);
  assert.equal(lifecycle.calls.explanation.length, 0);
  assert.deepEqual(lifecycle.calls.progress.map((call) => call.stage), [
    'context_ready',
    'provider_request_started',
    'provider_response_received',
    'result_preparing',
  ]);
  assert.equal(lifecycle.calls.failure.length, 0);
  assert.equal(git.receipts.length, 0);
  assert.equal(transportInputs.length, 1);
  assert.deepEqual(started, [{
    event_version: 'builder-generation-started.v1',
    request_id: raw.request_digest,
    project_id: PROJECT_ID,
  }]);
  assert.deepEqual(observed.map((event) => event.display_delta_text), [
    'Prepare a bounded',
    ' implementation before editing',
  ]);
  assert.deepEqual(Reflect.ownKeys(observed[0]).sort(), [
    'conversation_id',
    'display_delta_text',
    'event_version',
    'project_id',
    'request_id',
    'run_id',
    'task_id',
    'turn_id',
  ]);
  assert.equal(observed[0].event_version, 'builder-generation-output.v1');
  assert.equal(observed[0].request_id, raw.request_digest);
  assert.equal(observed[0].project_id, PROJECT_ID);
  assert.match(observed[0].conversation_id, /^builder-conversation:/u);
  assert.match(observed[0].turn_id, /^builder-turn:/u);
  assert.match(observed[0].task_id, /^builder-task:/u);
  assert.match(observed[0].run_id, /^builder-run:/u);
  assert.equal(Object.isFrozen(observed[0]), true);
  assert.doesNotMatch(
    JSON.stringify(observed),
    /secret source text|credential|provider\.example|builder-model|source_tree|operations|src\/app|export const|commit_oid|tree_oid|receipt|record_digest/iu,
  );
  assert.equal(Object.hasOwn(result, 'draft_id'), false);
  assert.equal(Object.hasOwn(result, 'plan_proposal_record'), false);
  assert.equal(Object.hasOwn(result, 'source_context_result'), false);
  assert.doesNotMatch(
    JSON.stringify(result),
    /plan_proposal_record|private_source_context|context_digest|head_digest|record_digest|provider|credential|source_tree|export const|git_request|commit_oid|tree_oid|revision_receipt|operations|candidate_digest/iu,
  );
});

test('fails plan proposal closed without collector, existing project, or valid resource ids', async () => {
  const reads = [];
  const lifecycle = conversationService();
  const service = createBuilderGenerationMainService({
    ...repositories({
      conversationService: lifecycle,
      projectReadAuthority: {
        load_current(input) {
          reads.push(input);
          throw new Error(PRIVATE_MARKER);
        },
      },
    }),
    transport: async () => {
      throw new Error(PRIVATE_MARKER);
    },
  });
  const raw = request({
    instruction: 'Plan a smaller settings panel.',
    existingProjectId: PROJECT_ID,
  });

  await assert.rejects(
    service.propose_plan({ request: raw, resource_ids: ['project:/src/app.tsx'] }),
    (error) => error.code === 'builder_generation_service_unavailable'
      && !`${error.message}:${error.stack}`.includes(PRIVATE_MARKER),
  );
  await assert.rejects(
    service.propose_plan({ request: request(), resource_ids: ['project:/src/app.tsx'] }),
    { code: 'builder_generation_service_unavailable' },
  );

  const collected = [];
  const malformed = createBuilderGenerationMainService({
    ...repositories({
      conversationService: lifecycle,
      sourceContextCollector: {
        collect_project_source_context(input) {
          collected.push(input);
          return sourceContextResult(input.context);
        },
      },
    }),
    transport: async () => {
      throw new Error(PRIVATE_MARKER);
    },
  });
  await assert.rejects(
    malformed.propose_plan({ request: raw, resource_ids: ['project:/src/app.tsx', 'project:/../secret.ts'] }),
    { code: 'builder_generation_service_unavailable' },
  );
  assert.deepEqual(reads, []);
  assert.deepEqual(collected, []);
  assert.equal(lifecycle.calls.begin.length, 0);
  assert.equal(lifecycle.calls.plan.length, 0);
});

test('rejects plan proposal cross-route concurrency before creating a second turn', async () => {
  const lifecycle = conversationService();
  let planSignal;
  const service = createBuilderGenerationMainService({
    ...repositories({
      conversationService: lifecycle,
      projectReadAuthority: {
        load_current() {
          return readResult();
        },
      },
      sourceContextCollector: {
        collect_project_source_context(input) {
          return sourceContextResult(input.context);
        },
      },
    }),
    transport: async (_input, options) => {
      planSignal = options.signal;
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          const error = new Error(PRIVATE_MARKER);
          error.code = 'builder_provider_cancelled';
          reject(error);
        }, { once: true });
      });
    },
  });
  const raw = request({
    instruction: 'Plan a smaller settings panel.',
    existingProjectId: PROJECT_ID,
  });

  const plan = service.propose_plan({ request: raw, resource_ids: ['project:/src/app.tsx'] });
  while (planSignal === undefined) await new Promise((resolve) => setImmediate(resolve));

  await assert.rejects(service.generate(raw), { code: 'builder_generation_service_unavailable' });
  await assert.rejects(service.answer(raw), { code: 'builder_generation_service_unavailable' });
  assert.equal(lifecycle.calls.begin.length, 1);
  assert.equal(lifecycle.calls.question.length, 0);
  assert.equal(lifecycle.calls.candidate.length, 0);
  assert.equal(lifecycle.calls.explanation.length, 0);
  assert.equal(lifecycle.calls.plan.length, 0);

  assert.deepEqual(service.cancel({ request_id: raw.request_digest }), {
    request_id: raw.request_digest,
    cancelled: true,
  });
  await assert.rejects(plan, { code: 'builder_generation_cancelled' });
  assert.equal(lifecycle.calls.cancel.length, 1);
  assert.equal(lifecycle.calls.failure.length, 1);
  assert.equal(lifecycle.calls.failure[0].context.cancel_requested, true);
});

test('submits one composer turn through main-owned work or explanation routing', async () => {
  const sourceTree = createBuilderProjectSourceTree({
    files: [{ path: 'src/app.js', content: 'export const saved = true;\n' }],
  });
  const lifecycle = conversationService();
  const git = gitAuthority();
  const startedEvents = [];
  const service = createBuilderGenerationMainService({
    ...repositories({
      conversationService: lifecycle,
      gitAuthority: git,
      projectReadAuthority: {
        load_current() {
          return readResult(sourceTree);
        },
      },
    }),
    onGenerationStarted(event) {
      startedEvents.push(event);
    },
    transport: async (input) => ({
      transport_version: 'builder-openai-compatible-transport.v1',
      generated_text: input.messages[1].content.includes('"instruction":"开始吧"')
        || input.messages[1].content.includes('What does this project do')
        || input.messages[1].content.includes('这个项目是做什么')
        || input.messages[1].content.includes('怎么把按钮改红')
        || input.messages[1].content.includes('我想先聊一下这个页面怎么做')
        || input.messages[1].content.includes('我想创建一个登录页')
        || input.messages[1].content.includes('我想做一个登录页')
        || input.messages[1].content.includes('我要做一个登录页')
        || input.messages[1].content.includes('可以帮我做一个登录页吗')
        || input.messages[1].content.includes('Can you build a login page')
        || input.messages[1].content.includes('Should we create a dashboard')
        ? JSON.stringify(providerExplanation())
        : JSON.stringify(providerOutput()),
    }),
  });

  await assert.rejects(service.submit(request({ instruction: 'Make a timer.' })), {
    code: 'builder_generation_project_workspace_required',
  });
  const draft = await service.submit(request({
    instruction: 'Make a timer.',
    existingProjectId: PROJECT_ID,
  }));
  const chineseDirectDraft = await service.submit(request({
    instruction: '帮我做一个登录页',
    existingProjectId: PROJECT_ID,
  }));
  const chineseClearEditDraft = await service.submit(request({
    instruction: '把按钮颜色改红',
    existingProjectId: PROJECT_ID,
  }));
  const exploratoryDiscussionAnswer = await service.submit(request({
    instruction: '我想先聊一下这个页面怎么做',
    existingProjectId: PROJECT_ID,
  }));
  const exploratoryDesignQuestionAnswer = await service.submit(request({
    instruction: '我想创建一个登录页，你觉得怎么设计',
    existingProjectId: PROJECT_ID,
  }));
  const exploratoryBriefAnswer = await service.submit(request({
    instruction: '我想做一个登录页',
    existingProjectId: PROJECT_ID,
  }));
  const declarativeBriefAnswer = await service.submit(request({
    instruction: '我要做一个登录页',
    existingProjectId: PROJECT_ID,
  }));
  const chineseCapabilityQuestionAnswer = await service.submit(request({
    instruction: '可以帮我做一个登录页吗？',
    existingProjectId: PROJECT_ID,
  }));
  const englishCapabilityQuestionAnswer = await service.submit(request({
    instruction: 'Can you build a login page?',
    existingProjectId: PROJECT_ID,
  }));
  const englishDiscussionQuestionAnswer = await service.submit(request({
    instruction: 'Should we create a dashboard first?',
    existingProjectId: PROJECT_ID,
  }));
  const answer = await service.submit(request({
    instruction: 'What does this project do?',
    existingProjectId: PROJECT_ID,
  }));
  const chineseAnswer = await service.submit(request({
    instruction: '这个项目是做什么的？',
    existingProjectId: PROJECT_ID,
  }));
  const chineseHowToAnswer = await service.submit(request({
    instruction: '怎么把按钮改红？',
  }));
  const contextualWithoutBriefAnswer = await service.submit(request({
    instruction: '开始吧',
    existingProjectId: PROJECT_ID,
  }));

  assert.equal(draft.version, 'builder-generation-result.v2');
  assert.equal(draft.admissions.draft, 'candidate_not_saved');
  assert.equal(chineseDirectDraft.version, 'builder-generation-result.v2');
  assert.equal(chineseDirectDraft.admissions.draft, 'candidate_not_saved');
  assert.equal(chineseClearEditDraft.version, 'builder-generation-result.v2');
  assert.equal(chineseClearEditDraft.admissions.draft, 'candidate_not_saved');
  assert.equal(exploratoryDiscussionAnswer.result_kind, 'explanation');
  assert.equal(exploratoryDiscussionAnswer.admissions.draft, 'not_created');
  assert.equal(exploratoryDesignQuestionAnswer.result_kind, 'explanation');
  assert.equal(exploratoryDesignQuestionAnswer.admissions.draft, 'not_created');
  assert.equal(exploratoryBriefAnswer.result_kind, 'explanation');
  assert.equal(exploratoryBriefAnswer.admissions.draft, 'not_created');
  assert.equal(declarativeBriefAnswer.result_kind, 'explanation');
  assert.equal(declarativeBriefAnswer.admissions.draft, 'not_created');
  assert.equal(chineseCapabilityQuestionAnswer.result_kind, 'explanation');
  assert.equal(chineseCapabilityQuestionAnswer.admissions.draft, 'not_created');
  assert.equal(englishCapabilityQuestionAnswer.result_kind, 'explanation');
  assert.equal(englishCapabilityQuestionAnswer.admissions.draft, 'not_created');
  assert.equal(englishDiscussionQuestionAnswer.result_kind, 'explanation');
  assert.equal(englishDiscussionQuestionAnswer.admissions.draft, 'not_created');
  assert.equal(answer.result_kind, 'explanation');
  assert.equal(answer.admissions.draft, 'not_created');
  assert.equal(chineseAnswer.result_kind, 'explanation');
  assert.equal(chineseAnswer.admissions.draft, 'not_created');
  assert.equal(chineseHowToAnswer.result_kind, 'explanation');
  assert.equal(chineseHowToAnswer.admissions.draft, 'not_created');
  assert.equal(chineseHowToAnswer.existing_project_id, null);
  assert.equal(contextualWithoutBriefAnswer.result_kind, 'explanation');
  assert.equal(contextualWithoutBriefAnswer.admissions.draft, 'not_created');
  assert.equal(contextualWithoutBriefAnswer.project_id, PROJECT_ID);
  assert.equal(lifecycle.calls.begin.length, 3);
  assert.equal(lifecycle.calls.question.length, 11);
  assert.equal(lifecycle.calls.candidate.length, 3);
  assert.equal(lifecycle.calls.explanation.length, 11);
  assert.deepEqual(lifecycle.calls.readStream, [{ project_id: PROJECT_ID }]);
  assert.equal(git.receipts.length, 3);
  assert.deepEqual(startedEvents.map((event) => event.event_version), Array(14).fill('builder-generation-started.v1'));
  assert.deepEqual(startedEvents.map((event) => event.request_id), [
    draft.request_id,
    chineseDirectDraft.request_id,
    chineseClearEditDraft.request_id,
    exploratoryDiscussionAnswer.request_id,
    exploratoryDesignQuestionAnswer.request_id,
    exploratoryBriefAnswer.request_id,
    declarativeBriefAnswer.request_id,
    chineseCapabilityQuestionAnswer.request_id,
    englishCapabilityQuestionAnswer.request_id,
    englishDiscussionQuestionAnswer.request_id,
    answer.request_id,
    chineseAnswer.request_id,
    chineseHowToAnswer.request_id,
    contextualWithoutBriefAnswer.request_id,
  ]);
  assert.deepEqual(startedEvents.map((event) => event.project_id), [
    draft.project_id,
    chineseDirectDraft.project_id,
    chineseClearEditDraft.project_id,
    exploratoryDiscussionAnswer.project_id,
    exploratoryDesignQuestionAnswer.project_id,
    exploratoryBriefAnswer.project_id,
    declarativeBriefAnswer.project_id,
    chineseCapabilityQuestionAnswer.project_id,
    englishCapabilityQuestionAnswer.project_id,
    englishDiscussionQuestionAnswer.project_id,
    answer.project_id,
    chineseAnswer.project_id,
    chineseHowToAnswer.project_id,
    contextualWithoutBriefAnswer.project_id,
  ]);
  assert.doesNotMatch(
    JSON.stringify([
      draft,
      chineseDirectDraft,
      chineseClearEditDraft,
      exploratoryDiscussionAnswer,
      exploratoryDesignQuestionAnswer,
      exploratoryBriefAnswer,
      declarativeBriefAnswer,
      chineseCapabilityQuestionAnswer,
      englishCapabilityQuestionAnswer,
      englishDiscussionQuestionAnswer,
      answer,
      chineseAnswer,
      chineseHowToAnswer,
      contextualWithoutBriefAnswer,
    ]),
    /credential|provider\.example|builder-model|git_request_id/iu,
  );
});

test('allows contextual composer submit only with main-owned build context', async () => {
  const sourceTree = createBuilderProjectSourceTree({
    files: [{ path: 'src/app.js', content: 'export const saved = true;\n' }],
  });
  const lifecycle = conversationService({ readStreamResult: recentChatProposalTaskStream() });
  const git = gitAuthority();
  const service = createBuilderGenerationMainService({
    ...repositories({
      conversationService: lifecycle,
      gitAuthority: git,
      projectReadAuthority: {
        load_current() {
          return readResult(sourceTree);
        },
      },
    }),
    transport: async () => ({
      transport_version: 'builder-openai-compatible-transport.v1',
      generated_text: JSON.stringify(providerOutput()),
    }),
  });

  const draft = await service.submit(request({
    instruction: '好，开始吧',
    existingProjectId: PROJECT_ID,
  }));

  assert.equal(draft.version, 'builder-generation-result.v2');
  assert.equal(draft.admissions.draft, 'candidate_not_saved');
  assert.equal(draft.project_id, PROJECT_ID);
  assert.equal(lifecycle.calls.begin.length, 1);
  assert.equal(lifecycle.calls.question.length, 0);
  assert.equal(lifecycle.calls.candidate.length, 1);
  assert.equal(lifecycle.calls.explanation.length, 0);
  assert.deepEqual(lifecycle.calls.readStream, [{ project_id: PROJECT_ID }]);
  assert.equal(git.receipts.length, 1);
});

test('passes prior conversation working brief into contextual submit provider prompt', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawfabric-builder-contextual-brief-'));
  const database = createBuilderProductMetadataDatabase(path.join(root, 'builder.sqlite'));
  t.after(() => {
    database.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  let now = 7_000;
  const conversation = createBuilderConversationMainService({
    metadataAuthority: database,
    createUuid: createUniqueUuidFactory(700),
    nowMs: () => now++,
  });
  const priorRequest = request({
    instruction: '我们确认要做一个带星空背景、鼠标视差和三维项目卡片的作品集首页。',
    existingProjectId: PROJECT_ID,
  });
  const prior = conversation.begin_question({
    project_id: PROJECT_ID,
    question: priorRequest.instruction,
    request_digest: priorRequest.request_digest,
    base_revision: null,
  });
  conversation.complete_explanation({
    context: prior,
    assistant_text: '方案是做单页静态作品集，包含 hero、项目列表和联系入口，不加入后端。',
  });
  let transportInput;
  const service = createBuilderGenerationMainService({
    ...repositories({
      conversationService: conversation,
      gitAuthority: gitAuthority(),
      projectReadAuthority: {
        load_current() {
          return readResult(createBuilderProjectSourceTree({
            files: [{ path: 'src/app.js', content: 'export const saved = true;\n' }],
          }));
        },
      },
      createUuid: createUniqueUuidFactory(800),
    }),
    transport: async (input) => {
      transportInput = input;
      return {
        transport_version: 'builder-openai-compatible-transport.v1',
        generated_text: JSON.stringify(providerOutput({
          title: 'Portfolio homepage',
          summary: 'Builds the discussed portfolio homepage.',
        })),
      };
    },
  });

  const draft = await service.submit(request({
    instruction: '好，开始吧',
    existingProjectId: PROJECT_ID,
  }));
  const providerPrompt = JSON.parse(transportInput.messages[1].content);

  assert.equal(draft.title, 'Portfolio homepage');
  assert.equal(providerPrompt.instruction, '好，开始吧');
  assert.deepEqual(providerPrompt.conversation_brief.working_brief, {
    brief_version: 'builder-working-brief.v1',
    source: 'recent_chat_proposal',
    latest_user_goal: '我们确认要做一个带星空背景、鼠标视差和三维项目卡片的作品集首页。',
    assistant_proposal: '方案是做单页静态作品集，包含 hero、项目列表和联系入口，不加入后端。',
    approved_plan: null,
    use_when_instruction_is_contextual: true,
  });
  assert.equal(providerPrompt.conversation_brief.latest_plan, null);
  assert.match(transportInput.messages[0].content, /working_brief is requirements context/u);
  assert.match(transportInput.messages[1].content, /三维项目卡片/u);
  assert.doesNotMatch(
    transportInput.messages[1].content,
    /builder-(?:project|conversation|turn|task|run|message|conversation-event|command):|sha256:|request_digest|credential|provider|api[_-]?key|Bearer/iu,
  );
});

test('records a retryable terminal run outcome when provider generation fails', async () => {
  const lifecycle = conversationService();
  const service = createBuilderGenerationMainService({
    ...repositories({ conversationService: lifecycle }),
    transport: async () => {
      const error = new Error(PRIVATE_MARKER);
      error.code = 'builder_provider_timeout';
      throw error;
    },
  });

  await assert.rejects(
    service.generate(request()),
    (error) => error.code === 'builder_generation_timeout'
      && !`${error.message}:${error.stack}`.includes(PRIVATE_MARKER),
  );
  assert.equal(lifecycle.calls.begin.length, 1);
  assert.equal(lifecycle.calls.candidate.length, 0);
  assert.equal(lifecycle.calls.failure.length, 1);
  assert.equal(lifecycle.calls.failure[0].failure_code, 'builder_generation_timeout');
  assert.equal(lifecycle.calls.completeFailure.length, 0);
});

test('retries a provider failure as a second run on the same turn', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawfabric-builder-explicit-retry-'));
  const database = createBuilderProductMetadataDatabase(path.join(root, 'builder.sqlite'));
  t.after(() => {
    database.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  let now = 7_500;
  const conversation = createBuilderConversationMainService({
    metadataAuthority: database,
    createUuid: createUniqueUuidFactory(300),
    nowMs: () => now++,
  });
  const generationIds = [
    UUIDS[0],
    createUniqueUuidFactory(500)(),
    createUniqueUuidFactory(501)(),
  ];
  const fallbackGenerationUuid = createUniqueUuidFactory(600);
  let transportAttempts = 0;
  const service = createBuilderGenerationMainService({
    ...repositories({
      conversationService: conversation,
      createUuid: () => generationIds.shift() ?? fallbackGenerationUuid(),
    }),
    transport: async () => {
      transportAttempts += 1;
      if (transportAttempts === 1) {
        const error = new Error(PRIVATE_MARKER);
        error.code = 'builder_provider_failed';
        throw error;
      }
      return {
        transport_version: 'builder-openai-compatible-transport.v1',
        generated_text: JSON.stringify(providerOutput()),
      };
    },
  });

  const rawRequest = request();
  await assert.rejects(
    service.generate(rawRequest),
    (error) => error.code === 'builder_generation_failed'
      && !`${error.message}:${error.stack}`.includes(PRIVATE_MARKER),
  );
  const failedStream = conversation.read_stream({ project_id: PROJECT_ID });
  assert.equal(failedStream.conversation.head_sequence, 5);
  assert.equal(failedStream.conversation.recorded_active_turn_id, failedStream.conversation.items[0].turn_id);
  await assert.rejects(
    service.retry_generate(request({ instruction: 'Different retry should not bind.' })),
    (error) => error.code === 'builder_generation_service_unavailable'
      && transportAttempts === 1,
  );

  const result = await service.retry_generate(rawRequest);
  assert.equal(result.project_id, PROJECT_ID);
  assert.equal(result.request_id, rawRequest.request_digest);
  const stream = conversation.read_stream({ project_id: PROJECT_ID });
  assert.equal(stream.conversation.head_sequence, 12);
  assert.equal(stream.conversation.recorded_active_turn_id, null);
  assert.equal(stream.conversation.items[0].turn_id, stream.conversation.items[5].turn_id);
  assert.deepEqual(stream.conversation.items[5], {
    item_kind: 'run_started',
    sequence: 6,
    turn_id: stream.conversation.items[0].turn_id,
    run_id: stream.conversation.items[5].run_id,
    task_id: stream.conversation.items[0].task.task_id,
    attempt_number: 2,
    retry_of_run_id: stream.conversation.items[1].run_id,
    recorded_state: 'started',
  });
  assert.deepEqual(stream.conversation.items.slice(6, 10).map((item) => item.item_kind), [
    'run_progress_recorded',
    'run_progress_recorded',
    'run_progress_recorded',
    'run_progress_recorded',
  ]);
  assert.equal(stream.conversation.items[10].item_kind, 'run_completed');
  assert.equal(stream.conversation.items[10].run_id, stream.conversation.items[5].run_id);
  assert.equal(stream.conversation.items[10].result_kind, 'candidate');
  assert.equal(stream.conversation.items[11].outcome, 'candidate_ready');
  assert.doesNotMatch(JSON.stringify(stream), /credential|git_candidate_receipt|commit_oid|tree_oid|live|running/iu);
});

test('records real provider failures as retryable activity and closes them before distinct new work', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawfabric-builder-retryable-generation-'));
  const database = createBuilderProductMetadataDatabase(path.join(root, 'builder.sqlite'));
  t.after(() => {
    database.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  let now = 7_000;
  const conversation = createBuilderConversationMainService({
    metadataAuthority: database,
    createUuid: createUniqueUuidFactory(1),
    nowMs: () => now++,
  });
  const generationIds = [
    UUIDS[0],
    createUniqueUuidFactory(100)(),
    UUIDS[0],
    createUniqueUuidFactory(101)(),
  ];
  let transportAttempts = 0;
  const service = createBuilderGenerationMainService({
    ...repositories({
      conversationService: conversation,
      createUuid: () => generationIds.shift() ?? UUIDS[9],
    }),
    transport: async () => {
      transportAttempts += 1;
      if (transportAttempts === 1) {
        const error = new Error(PRIVATE_MARKER);
        error.code = 'builder_provider_failed';
        throw error;
      }
      return {
        transport_version: 'builder-openai-compatible-transport.v1',
        generated_text: JSON.stringify(providerOutput()),
      };
    },
  });

  await assert.rejects(
    service.generate(request()),
    (error) => error.code === 'builder_generation_failed'
      && !`${error.message}:${error.stack}`.includes(PRIVATE_MARKER),
  );
  const failedStream = conversation.read_stream({ project_id: PROJECT_ID });
  assert.equal(failedStream.conversation.head_sequence, 5);
  assert.equal(failedStream.conversation.recorded_active_turn_id, failedStream.conversation.items[0].turn_id);
  assert.equal(failedStream.conversation.items[4].item_kind, 'run_completed');
  assert.equal(failedStream.conversation.items[4].terminal_status, 'failed');
  assert.equal(failedStream.conversation.items[4].result_kind, 'failure');
  assert.equal(failedStream.conversation.items[4].candidate, null);

  const result = await service.generate(request({ instruction: 'Try a different timer layout.' }));
  assert.equal(result.project_id, PROJECT_ID);
  const stream = conversation.read_stream({ project_id: PROJECT_ID });
  assert.equal(stream.conversation.head_sequence, 14);
  assert.equal(stream.conversation.recorded_active_turn_id, null);
  assert.deepEqual(stream.conversation.items.slice(5, 8).map((item) => item.item_kind), [
    'turn_completed',
    'user_message',
    'run_started',
  ]);
  assert.equal(stream.conversation.items[5].outcome, 'failed');
  assert.equal(stream.conversation.items[6].message.text, 'Try a different timer layout.');
  assert.deepEqual(stream.conversation.items.slice(8, 12).map((item) => item.item_kind), [
    'run_progress_recorded',
    'run_progress_recorded',
    'run_progress_recorded',
    'run_progress_recorded',
  ]);
  assert.equal(stream.conversation.items[12].result_kind, 'candidate');
  assert.equal(stream.conversation.items[13].outcome, 'candidate_ready');
  assert.doesNotMatch(JSON.stringify(stream), /credential|git_candidate_receipt|commit_oid|tree_oid|live|running/iu);
});

test('records cancellation intent before aborting provider work and fails closed if recording fails', async () => {
  const attemptedRequest = request();
  const failedLifecycle = conversationService();
  let failedSignal;
  let releaseFailedTransport;
  failedLifecycle.request_cancel = () => {
    failedLifecycle.calls.cancel.push('record_attempt');
    throw new Error(PRIVATE_MARKER);
  };
  const failedService = createBuilderGenerationMainService({
    ...repositories({ conversationService: failedLifecycle }),
    transport: async (_input, options) => {
      failedSignal = options.signal;
      return new Promise((resolve) => {
        releaseFailedTransport = () => resolve({
          transport_version: 'builder-openai-compatible-transport.v1',
          generated_text: JSON.stringify(providerOutput()),
        });
      });
    },
  });
  const failedGeneration = failedService.generate(attemptedRequest);
  while (failedSignal === undefined) await new Promise((resolve) => setImmediate(resolve));
  assert.throws(
    () => failedService.cancel({ request_id: attemptedRequest.request_digest }),
    (error) => error.code === 'builder_generation_service_unavailable'
      && !`${error.message}:${error.stack}`.includes(PRIVATE_MARKER),
  );
  assert.equal(failedSignal.aborted, false);
  releaseFailedTransport();
  await failedGeneration;

  const order = [];
  const lifecycle = conversationService();
  const originalRequestCancel = lifecycle.request_cancel;
  lifecycle.request_cancel = (input) => {
    order.push('intent_recorded');
    return originalRequestCancel(input);
  };
  let activeSignal;
  const service = createBuilderGenerationMainService({
    ...repositories({ conversationService: lifecycle }),
    transport: async (_input, options) => {
      activeSignal = options.signal;
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          order.push('provider_aborted');
          const error = new Error(PRIVATE_MARKER);
          error.code = 'builder_provider_cancelled';
          reject(error);
        }, { once: true });
      });
    },
  });
  const generation = service.generate(attemptedRequest);
  while (activeSignal === undefined) await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(service.cancel({ request_id: attemptedRequest.request_digest }), {
    request_id: attemptedRequest.request_digest,
    cancelled: true,
  });
  await assert.rejects(generation, { code: 'builder_generation_cancelled' });
  assert.deepEqual(order, ['intent_recorded', 'provider_aborted']);
  assert.equal(lifecycle.calls.cancel.length, 1);
  assert.equal(lifecycle.calls.failure.length, 1);
  assert.equal(lifecycle.calls.failure[0].context.cancel_requested, true);
  assert.equal(lifecycle.calls.completeFailure.length, 0);

  const answerLifecycle = conversationService();
  const answerGit = gitAuthority();
  let answerSignal;
  const answerService = createBuilderGenerationMainService({
    ...repositories({
      conversationService: answerLifecycle,
      gitAuthority: answerGit,
    }),
    transport: async (_input, options) => {
      answerSignal = options.signal;
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          const error = new Error(PRIVATE_MARKER);
          error.code = 'builder_provider_cancelled';
          reject(error);
        }, { once: true });
      });
    },
  });
  const question = request({ instruction: 'What is this project?' });
  const answer = answerService.answer(question);
  while (answerSignal === undefined) await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(answerService.cancel({ request_id: question.request_digest }), {
    request_id: question.request_digest,
    cancelled: true,
  });
  await assert.rejects(answer, { code: 'builder_generation_cancelled' });
  assert.equal(answerLifecycle.calls.question.length, 1);
  assert.equal(answerLifecycle.calls.cancel.length, 1);
  assert.equal(answerLifecycle.calls.explanation.length, 0);
  assert.equal(answerLifecycle.calls.failure.length, 1);
  assert.equal(answerLifecycle.calls.failure[0].context.cancel_requested, true);
  assert.equal(answerLifecycle.calls.completeFailure.length, 0);
  assert.equal(answerGit.receipts.length, 0);
});

test('records steering intent on an active run without cancelling provider work', async () => {
  const attemptedRequest = request();
  const lifecycle = conversationService();
  let activeSignal;
  let releaseTransport;
  const service = createBuilderGenerationMainService({
    ...repositories({ conversationService: lifecycle }),
    transport: async (_input, options) => {
      activeSignal = options.signal;
      return new Promise((resolve) => {
        releaseTransport = () => resolve({
          transport_version: 'builder-openai-compatible-transport.v1',
          generated_text: JSON.stringify(providerOutput()),
        });
      });
    },
  });
  const generation = service.generate(attemptedRequest);
  while (activeSignal === undefined) await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(service.steer({
    request_id: attemptedRequest.request_digest,
    message: 'Make the timer calmer and easier to scan.',
  }), {
    request_id: attemptedRequest.request_digest,
    steered: true,
  });
  assert.equal(activeSignal.aborted, false);
  assert.equal(lifecycle.calls.steering.length, 1);
  assert.equal(lifecycle.calls.steering[0].message, 'Make the timer calmer and easier to scan.');
  assert.equal(lifecycle.calls.cancel.length, 0);

  releaseTransport();
  const result = await generation;
  assert.equal(result.project_id, PROJECT_ID);
  assert.equal(lifecycle.calls.candidate.length, 1);
  assert.equal(
    lifecycle.calls.candidate[0].context.events.some((event) => event.event_type === 'turn_steered'),
    true,
  );
  assert.equal(lifecycle.calls.candidate[0].context.start_head.sequence, 7);
  assert.doesNotMatch(
    JSON.stringify(lifecycle.calls.steering[0]),
    /credential|source_tree|git_candidate_receipt|tree_oid/iu,
  );
});

test('keeps steering request-id bound and inert when no active run exists', () => {
  const lifecycle = conversationService();
  const service = createBuilderGenerationMainService({
    ...repositories({ conversationService: lifecycle }),
  });
  const requestId = request().request_digest;

  assert.deepEqual(service.steer({
    request_id: requestId,
    message: 'Use a quieter layout.',
  }), {
    request_id: requestId,
    steered: false,
  });
  assert.equal(lifecycle.calls.steering.length, 0);
  assert.throws(
    () => service.steer({ request_id: requestId, message: ' leading space' }),
    { code: 'builder_generation_request_invalid' },
  );
});

test('fails closed when steering cannot be recorded and does not abort provider work', async () => {
  const attemptedRequest = request();
  const lifecycle = conversationService();
  lifecycle.record_steering = (input) => {
    lifecycle.calls.steering.push(input);
    throw new Error(PRIVATE_MARKER);
  };
  let activeSignal;
  let releaseTransport;
  const service = createBuilderGenerationMainService({
    ...repositories({ conversationService: lifecycle }),
    transport: async (_input, options) => {
      activeSignal = options.signal;
      return new Promise((resolve) => {
        releaseTransport = () => resolve({
          transport_version: 'builder-openai-compatible-transport.v1',
          generated_text: JSON.stringify(providerOutput()),
        });
      });
    },
  });
  const generation = service.generate(attemptedRequest);
  while (activeSignal === undefined) await new Promise((resolve) => setImmediate(resolve));

  assert.throws(
    () => service.steer({
      request_id: attemptedRequest.request_digest,
      message: 'Please make the timer quieter.',
    }),
    (error) => error.code === 'builder_generation_service_unavailable'
      && !`${error.message}:${error.stack}`.includes(PRIVATE_MARKER),
  );
  assert.equal(activeSignal.aborted, false);
  assert.equal(lifecycle.calls.cancel.length, 0);

  releaseTransport();
  const result = await generation;
  assert.equal(result.project_id, PROJECT_ID);
  assert.equal(lifecycle.calls.candidate.length, 1);
});

test('records steering intent on an active answer run without creating Git evidence', async () => {
  const question = request({ instruction: 'What does this project do?' });
  const lifecycle = conversationService();
  const git = gitAuthority();
  let answerSignal;
  let releaseTransport;
  const service = createBuilderGenerationMainService({
    ...repositories({ conversationService: lifecycle, gitAuthority: git }),
    transport: async (_input, options) => {
      answerSignal = options.signal;
      return new Promise((resolve) => {
        releaseTransport = () => resolve({
          transport_version: 'builder-openai-compatible-transport.v1',
          generated_text: JSON.stringify(providerExplanation()),
        });
      });
    },
  });
  const answer = service.answer(question);
  while (answerSignal === undefined) await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(service.steer({
    request_id: question.request_digest,
    message: 'Explain it in plainer language.',
  }), {
    request_id: question.request_digest,
    steered: true,
  });
  releaseTransport();
  const result = await answer;

  assert.equal(result.result_kind, 'explanation');
  assert.equal(lifecycle.calls.question.length, 1);
  assert.equal(lifecycle.calls.explanation.length, 1);
  assert.equal(
    lifecycle.calls.explanation[0].context.events.some((event) => event.event_type === 'turn_steered'),
    true,
  );
  assert.equal(git.receipts.length, 0);
});

test('rejects same-digest cross-route concurrency before creating a second conversation context', async () => {
  const lifecycle = conversationService();
  const git = gitAuthority();
  let generationSignal;
  const service = createBuilderGenerationMainService({
    ...repositories({
      conversationService: lifecycle,
      gitAuthority: git,
      projectReadAuthority: {
        load_current() { return readResult(); },
      },
    }),
    transport: async (_input, options) => {
      generationSignal = options.signal;
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          const error = new Error(PRIVATE_MARKER);
          error.code = 'builder_provider_cancelled';
          reject(error);
        }, { once: true });
      });
    },
  });
  const shared = request({
    instruction: 'Explain or change this project.',
    existingProjectId: PROJECT_ID,
  });
  const generation = service.generate(shared);
  while (generationSignal === undefined) await new Promise((resolve) => setImmediate(resolve));

  await assert.rejects(service.answer(shared), { code: 'builder_generation_service_unavailable' });
  assert.equal(lifecycle.calls.begin.length, 1);
  assert.equal(lifecycle.calls.question.length, 0);
  assert.equal(lifecycle.calls.cancel.length, 0);
  assert.equal(lifecycle.calls.failure.length, 0);
  assert.equal(lifecycle.calls.completeFailure.length, 0);

  assert.deepEqual(service.cancel({ request_id: shared.request_digest }), {
    request_id: shared.request_digest,
    cancelled: true,
  });
  await assert.rejects(generation, { code: 'builder_generation_cancelled' });
  assert.equal(lifecycle.calls.begin.length, 1);
  assert.equal(lifecycle.calls.question.length, 0);
  assert.equal(lifecycle.calls.cancel.length, 1);
  assert.equal(lifecycle.calls.failure.length, 1);
  assert.equal(lifecycle.calls.failure[0].context.ids.task_id === null, false);
  assert.equal(lifecycle.calls.completeFailure.length, 0);
  assert.equal(lifecycle.calls.candidate.length, 0);
  assert.equal(lifecycle.calls.explanation.length, 0);
  assert.equal(git.receipts.length, 0);

  const answerLifecycle = conversationService();
  const answerGit = gitAuthority();
  let answerSignal;
  const answerService = createBuilderGenerationMainService({
    ...repositories({
      conversationService: answerLifecycle,
      gitAuthority: answerGit,
      projectReadAuthority: {
        load_current() { return readResult(); },
      },
    }),
    transport: async (_input, options) => {
      answerSignal = options.signal;
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          const error = new Error(PRIVATE_MARKER);
          error.code = 'builder_provider_cancelled';
          reject(error);
        }, { once: true });
      });
    },
  });
  const answer = answerService.answer(shared);
  while (answerSignal === undefined) await new Promise((resolve) => setImmediate(resolve));

  await assert.rejects(answerService.generate(shared), { code: 'builder_generation_service_unavailable' });
  assert.equal(answerLifecycle.calls.begin.length, 0);
  assert.equal(answerLifecycle.calls.question.length, 1);
  assert.equal(answerLifecycle.calls.cancel.length, 0);
  assert.equal(answerLifecycle.calls.failure.length, 0);
  assert.equal(answerLifecycle.calls.completeFailure.length, 0);

  assert.deepEqual(answerService.cancel({ request_id: shared.request_digest }), {
    request_id: shared.request_digest,
    cancelled: true,
  });
  await assert.rejects(answer, { code: 'builder_generation_cancelled' });
  assert.equal(answerLifecycle.calls.begin.length, 0);
  assert.equal(answerLifecycle.calls.question.length, 1);
  assert.equal(answerLifecycle.calls.cancel.length, 1);
  assert.equal(answerLifecycle.calls.failure.length, 1);
  assert.equal(answerLifecycle.calls.failure[0].context.ids.task_id, null);
  assert.equal(answerLifecycle.calls.completeFailure.length, 0);
  assert.equal(answerLifecycle.calls.candidate.length, 0);
  assert.equal(answerLifecycle.calls.explanation.length, 0);
  assert.equal(answerGit.receipts.length, 0);
});

test('does not abort provider work before a durable conversation context exists', async () => {
  let releaseProjectRead;
  const projectReadStarted = new Promise((resolve) => {
    releaseProjectRead = resolve;
  });
  let loadCurrent;
  const loadBlocked = new Promise((resolve) => {
    loadCurrent = resolve;
  });
  let transportCalled = false;
  const existingRequest = request({ existingProjectId: PROJECT_ID });
  const service = createBuilderGenerationMainService({
    ...repositories({
      projectReadAuthority: {
        async load_current() {
          releaseProjectRead();
          return loadBlocked;
        },
      },
    }),
    transport: async () => {
      transportCalled = true;
      return {
        transport_version: 'builder-openai-compatible-transport.v1',
        generated_text: JSON.stringify(providerOutput()),
      };
    },
  });
  const generation = service.generate(existingRequest);
  await projectReadStarted;
  assert.deepEqual(service.cancel({ request_id: existingRequest.request_digest }), {
    request_id: existingRequest.request_digest,
    cancelled: false,
  });
  assert.equal(transportCalled, false);
  loadCurrent(readResult());
  await generation;
  assert.equal(transportCalled, true);
});

test('uses read authority for existing projects and stores a main-only pending draft', async () => {
  const sourceTree = createBuilderProjectSourceTree({
    files: [{ path: 'src/app.js', content: 'export const before = true;\n' }],
  });
  const reads = [];
  const service = createBuilderGenerationMainService({
    ...repositories({
      createUuid: createUuidFactory(1),
      projectReadAuthority: {
        load_current(query) {
          reads.push(query);
          return readResult(sourceTree);
        },
      },
    }),
    transport: async () => ({
      transport_version: 'builder-openai-compatible-transport.v1',
      generated_text: JSON.stringify(providerOutput({
        operations: [{ operation: 'upsert', path: 'src/app.js', content: 'export const before = false;\n' }],
      })),
    }),
  });

  const result = await service.generate(request({ existingProjectId: PROJECT_ID }));
  assert.deepEqual(reads, [{ project_id: PROJECT_ID }]);
  assert.equal(result.project_id, PROJECT_ID);
  assert.equal(result.base_revision_evidence.revision_receipt_digest, `sha256:${'1'.repeat(64)}`);
  assert.equal(result.source_tree.source_tree_digest, result.candidate.resulting_tree_digest);
  assert.equal(Object.hasOwn(result.candidate, 'operations'), false);

  const pending = await service.read_pending_draft({ draft_id: result.draft_id });
  assert.equal(pending.result_version, 'builder-generation-pending-draft.v2');
  assert.equal(pending.draft_id, result.draft_id);
  assert.match(pending.git_request_id, /^builder-git-request:/u);
  assert.equal(pending.candidate_proof.candidate_digest, result.candidate.candidate_digest);
  assert.equal(pending.candidate_proof.resulting_tree_digest, result.candidate.resulting_tree_digest);
  assert.equal(pending.conversation_head.sequence, 8);
  assert.equal(pending.conversation_event_admission, 'sqlite_recorded');
  assert.equal(pending.restart_restore, 'not_persisted');

  assert.throws(
    () => service.release_pending_draft({
      draft_id: result.draft_id,
      candidate_digest: `sha256:${'f'.repeat(64)}`,
    }),
    (error) => error.code === 'builder_generation_draft_conflict'
      && !`${error.message}:${error.stack}`.includes(result.draft_id),
  );
  assert.equal((await service.read_pending_draft({ draft_id: result.draft_id })).draft_id, result.draft_id);
  assert.deepEqual(service.release_pending_draft({
    draft_id: result.draft_id,
    candidate_digest: result.candidate.candidate_digest,
  }), {
    result_version: 'builder-generation-pending-draft.v2',
    draft_id: result.draft_id,
    released: true,
    pending_draft_restart_restore: 'not_persisted',
    conversation_event_admission: 'sqlite_recorded',
  });
  await assert.rejects(
    service.read_pending_draft({ draft_id: result.draft_id }),
    (error) => error.code === 'builder_generation_service_unavailable',
  );
});

test('prepares draft continuation admission from a pending draft without dispatching replacement work', async () => {
  const sourceTree = createBuilderProjectSourceTree({
    files: [{ path: 'src/app.js', content: 'export const before = true;\n' }],
  });
  const lifecycle = conversationService();
  const git = gitAuthority();
  const transportInputs = [];
  const service = createBuilderGenerationMainService({
    ...repositories({
      conversationService: lifecycle,
      createUuid: createUniqueUuidFactory(900),
      gitAuthority: git,
      projectReadAuthority: {
        load_current() {
          return readResult(sourceTree);
        },
      },
    }),
    transport: async (input) => {
      transportInputs.push(input);
      return {
        transport_version: 'builder-openai-compatible-transport.v1',
        generated_text: JSON.stringify(providerOutput({
          operations: [{ operation: 'upsert', path: 'src/app.js', content: 'export const before = false;\n' }],
        })),
      };
    },
  });

  const result = await service.generate(request({ existingProjectId: PROJECT_ID }));
  const pending = await service.read_pending_draft({ draft_id: result.draft_id });
  const admission = await service.prepare_draft_continuation({ draft_id: result.draft_id });

  assert.deepEqual(sanitizeBuilderDraftContinuationAdmission(admission), admission);
  assert.equal(admission.admission_version, 'builder-draft-continuation-admission.v1');
  assert.equal(admission.admission_kind, 'builder_draft_continuation_admission');
  assert.equal(admission.project_id, PROJECT_ID);
  assert.equal(admission.conversation_id, pending.candidate_proof.conversation_id);
  assert.equal(admission.previous_turn_id, pending.candidate_proof.turn_id);
  assert.equal(admission.previous_task_id, pending.candidate_proof.task_id);
  assert.equal(admission.previous_run_id, pending.candidate_proof.run_id);
  assert.equal(admission.previous_request_digest, pending.candidate_proof.request_digest);
  assert.equal(admission.draft_id, result.draft_id);
  assert.equal(admission.candidate_id, pending.candidate_proof.candidate_id);
  assert.equal(admission.candidate_digest, result.candidate.candidate_digest);
  assert.equal(admission.resulting_tree_digest, result.candidate.resulting_tree_digest);
  assert.equal(admission.pending_draft_restart_restore, 'not_persisted');
  assert.deepEqual(admission.conversation_head, pending.conversation_head);
  assert.match(admission.continuation_id, /^builder-draft-continuation:/u);
  assert.equal(admission.lifecycle.continuation_admission, 'admitted_without_starting_run');
  assert.equal(admission.lifecycle.provider_dispatch, 'not_started');
  assert.equal(admission.lifecycle.tool_dispatch, 'not_started');
  assert.equal(admission.lifecycle.prior_candidate_release, 'not_performed');
  assert.equal(admission.lifecycle.git_authority, 'not_present');
  assert.equal(admission.lifecycle.revision_admission, 'not_created');
  assert.equal(admission.lifecycle.save_admission, 'not_performed');
  assert.equal(admission.authority.renderer_authority, 'not_present');
  assert.equal(admission.authority.provider_dispatch, false);
  assert.equal(admission.authority.credential_readback, false);
  assert.equal(admission.authority.source_mutation, 'not_performed');
  assert.equal(admission.authority.git_authority, 'not_present');
  assert.equal(admission.authority.save_authority, 'not_present');
  assert.deepEqual(await service.read_pending_draft({ draft_id: result.draft_id }), pending);
  assert.equal(transportInputs.length, 1);
  assert.equal(lifecycle.calls.begin.length, 1);
  assert.equal(lifecycle.calls.candidate.length, 1);
  assert.equal(lifecycle.calls.rejectCandidate.length, 0);
  assert.equal(git.receipts.length, 1);
  assert.doesNotMatch(
    JSON.stringify(admission),
    /title|summary|source_tree|operations|provider_config|provider_secret|credential_secret|credential_value|secret_ref|api[_-]?key|Authorization|Bearer|git_candidate_receipt|commit_oid|tree_oid|revision_receipt|save_result/iu,
  );
});

test('prepares a draft continuation base from verified pending candidate Git evidence', async () => {
  const sourceTree = createBuilderProjectSourceTree({
    files: [{ path: 'src/app.js', content: 'export const before = true;\n' }],
  });
  const lifecycle = conversationService();
  const git = gitAuthority();
  const transportInputs = [];
  const service = createBuilderGenerationMainService({
    ...repositories({
      conversationService: lifecycle,
      createUuid: createUniqueUuidFactory(950),
      gitAuthority: {
        ...git,
        async read_verified_candidate(receipt) {
          return {
            result_version: 'builder-git-verified-candidate-read-result.v1',
            candidate_receipt: receipt,
            verification_receipt: createBuilderGitCandidateVerificationReceipt(receipt),
            source_tree: generatedSourceTree,
            code_authority: 'git_commit_tree',
            read_admission: 'verified',
          };
        },
      },
      projectReadAuthority: {
        load_current() {
          return readResult(sourceTree);
        },
      },
    }),
    transport: async (input) => {
      transportInputs.push(input);
      return {
        transport_version: 'builder-openai-compatible-transport.v1',
        generated_text: JSON.stringify(providerOutput({
          operations: [{ operation: 'upsert', path: 'src/app.js', content: 'export const before = false;\n' }],
        })),
      };
    },
  });

  const result = await service.generate(request({ existingProjectId: PROJECT_ID }));
  const generatedSourceTree = createBuilderProjectSourceTree({
    files: result.source_tree.files.map((file) => ({
      path: file.path,
      content: file.content,
    })),
  });
  const base = await service.prepare_draft_continuation_base({ draft_id: result.draft_id });

  assert.deepEqual(sanitizeBuilderDraftContinuationBase(base), base);
  assert.equal(base.base_version, 'builder-draft-continuation-base.v1');
  assert.equal(base.base_kind, 'pending_candidate_git_base');
  assert.equal(base.project_id, PROJECT_ID);
  assert.equal(base.draft_id, result.draft_id);
  assert.equal(base.previous_candidate_id, result.candidate.candidate_id);
  assert.equal(base.previous_candidate_digest, result.candidate.candidate_digest);
  assert.equal(base.previous_resulting_tree_digest, result.candidate.resulting_tree_digest);
  assert.equal(base.parent_candidate_request_id, git.receipts[0].request_id);
  assert.equal(base.parent_candidate_commit_oid, git.receipts[0].commit_oid);
  assert.equal(base.parent_candidate_tree_oid, git.receipts[0].tree_oid);
  assert.equal(base.parent_candidate_expected_base_oid, git.receipts[0].expected_base_oid);
  assert.equal(base.base_source_tree_digest, result.source_tree.source_tree_digest);
  assert.deepEqual(base.base_source_tree, generatedSourceTree);
  assert.equal(base.authority.renderer_authority, 'not_present');
  assert.equal(base.authority.provider_dispatch, false);
  assert.equal(base.authority.source_read, 'main_verified_candidate_source_tree');
  assert.equal(base.authority.source_mutation, 'not_performed');
  assert.equal(base.authority.git_parent_authority, 'verified_pending_candidate_commit');
  assert.equal(base.authority.project_revision_authority, 'not_present');
  assert.equal(base.authority.save_authority, 'not_present');
  assert.equal(base.authority.base_revision_semantics, 'not_a_project_revision');
  assert.equal(transportInputs.length, 1);
  assert.equal(lifecycle.calls.begin.length, 1);
  assert.equal(lifecycle.calls.candidate.length, 1);
  assert.equal(lifecycle.calls.rejectCandidate.length, 0);
  assert.equal(git.receipts.length, 1);
  assert.doesNotMatch(
    JSON.stringify(base.authority),
    /project_revision_authority":"present|base_revision_semantics":"project_revision|save_authority":"present|renderer_authority":"present/iu,
  );
});

test('generates a replacement draft from pending candidate source squashed onto project base', async () => {
  const savedSourceTree = createBuilderProjectSourceTree({
    files: [{ path: 'src/app.js', content: 'export const before = true;\n' }],
  });
  let firstGeneratedSourceTree = null;
  const readCurrentCalls = [];
  const transportInputs = [];
  const lifecycle = conversationService();
  const git = gitAuthority();
  const service = createBuilderGenerationMainService({
    ...repositories({
      conversationService: lifecycle,
      createUuid: createUniqueUuidFactory(1_000),
      gitAuthority: {
        ...git,
        async read_verified_candidate(receipt) {
          if (firstGeneratedSourceTree === null) throw new Error(PRIVATE_MARKER);
          return {
            result_version: 'builder-git-verified-candidate-read-result.v1',
            candidate_receipt: receipt,
            verification_receipt: createBuilderGitCandidateVerificationReceipt(receipt),
            source_tree: firstGeneratedSourceTree,
            code_authority: 'git_commit_tree',
            read_admission: 'verified',
          };
        },
      },
      projectReadAuthority: {
        load_current(input) {
          readCurrentCalls.push(input);
          return readResult(savedSourceTree);
        },
      },
    }),
    transport: async (input) => {
      transportInputs.push(input);
      return {
        transport_version: 'builder-openai-compatible-transport.v1',
        generated_text: JSON.stringify(transportInputs.length === 1
          ? providerOutput({
            operations: [
              { operation: 'upsert', path: 'src/app.js', content: 'export const before = false;\n' },
              { operation: 'upsert', path: 'src/draft.js', content: 'export const draft = true;\n' },
            ],
          })
          : providerOutput({
            title: 'Calmer draft',
            summary: 'The pending draft was revised before saving.',
            operations: [
              { operation: 'upsert', path: 'src/draft.js', content: 'export const draft = "calm";\n' },
              { operation: 'upsert', path: 'styles.css', content: 'body { color: #123; }\n' },
            ],
          })),
      };
    },
  });

  const first = await service.generate(request({ existingProjectId: PROJECT_ID }));
  firstGeneratedSourceTree = createBuilderProjectSourceTree({
    files: first.source_tree.files.map((file) => ({
      path: file.path,
      content: file.content,
    })),
  });
  const replacement = await service.generate_draft_continuation({
    draft_id: first.draft_id,
    instruction: 'Make this pending draft calmer before saving.',
  });

  assert.equal(transportInputs.length, 2);
  assert.match(transportInputs[1].messages[1].content, /Make this pending draft calmer/u);
  assert.match(transportInputs[1].messages[1].content, /export const draft = true/u);
  assert.match(transportInputs[1].messages[1].content, /export const before = false/u);
  assert.doesNotMatch(transportInputs[1].messages[1].content, /export const before = true/u);
  assert.deepEqual(readCurrentCalls, [{ project_id: PROJECT_ID }, { project_id: PROJECT_ID }]);
  assert.equal(lifecycle.calls.begin.length, 1);
  assert.equal(lifecycle.calls.draftContinuationWork.length, 1);
  assert.equal(lifecycle.calls.draftContinuationWork[0].admission.draft_id, first.draft_id);
  assert.equal(lifecycle.calls.draftContinuationWork[0].instruction, 'Make this pending draft calmer before saving.');
  assert.equal(lifecycle.calls.draftContinuationWork[0].request_digest, replacement.request_id);
  assert.equal(lifecycle.calls.candidate.length, 2);
  assert.equal(lifecycle.calls.candidate[1].context.events[0].payload.task.title, 'Revise unsaved draft');
  assert.deepEqual(lifecycle.calls.progress.map((call) => call.stage), [
    'context_ready',
    'provider_request_started',
    'provider_response_received',
    'result_preparing',
    'context_ready',
    'provider_request_started',
    'provider_response_received',
    'result_preparing',
  ]);
  assert.equal(git.receipts.length, 2);
  assert.equal(git.receipts[0].expected_base_oid, '2'.repeat(40));
  assert.equal(git.receipts[1].expected_base_oid, '2'.repeat(40));
  assert.equal(replacement.version, 'builder-generation-result.v2');
  assert.equal(replacement.project_id, PROJECT_ID);
  assert.equal(replacement.existing_project_id, PROJECT_ID);
  assert.notEqual(replacement.draft_id, first.draft_id);
  assert.equal(replacement.title, 'Calmer draft');
  assert.equal(replacement.base_revision_evidence.source_tree_digest, savedSourceTree.source_tree_digest);
  assert.equal(replacement.base_revision_evidence.commit_oid, '2'.repeat(40));
  assert.deepEqual(replacement.source_tree.files.map((file) => file.path), [
    'src/app.js',
    'src/draft.js',
    'styles.css',
  ]);
  assert.equal(
    replacement.source_tree.files.find((file) => file.path === 'src/draft.js').content,
    'export const draft = "calm";\n',
  );
  assert.equal(
    replacement.source_tree.files.find((file) => file.path === 'styles.css').content,
    'body { color: #123; }\n',
  );
  const pending = await service.read_pending_draft({ draft_id: replacement.draft_id });
  assert.equal(pending.candidate_proof.candidate_digest, replacement.candidate.candidate_digest);
  assert.equal(pending.candidate_proof.expected_base_oid, '2'.repeat(40));
  assert.doesNotMatch(
    JSON.stringify(replacement),
    /git_candidate_receipt|verification_receipt|operations|provider\.example|credential|secret|Authorization|Bearer/iu,
  );
});

test('restores a pending draft from conversation proof and verified Git source after memory loss', async () => {
  const baseSource = createBuilderProjectSourceTree({
    files: [{ path: 'src/app.js', content: 'export const before = true;\n' }],
  });
  const restoredBaseReads = [];
  const lifecycle = conversationService();
  const git = gitAuthority();
  const service = createBuilderGenerationMainService({
    ...repositories({
      conversationService: lifecycle,
      gitAuthority: git,
      projectReadAuthority: { load_current: () => readResult(baseSource) },
    }),
    transport: async () => ({
      transport_version: 'builder-openai-compatible-transport.v1',
      generated_text: JSON.stringify(providerOutput()),
    }),
  });
  const result = await service.generate(request({ existingProjectId: PROJECT_ID }));
  const recorded = lifecycle.calls.candidate[0].candidate_result;

  const restoredLifecycle = conversationService();
  restoredLifecycle.read_candidate_draft = (input) => {
    restoredLifecycle.calls.readCandidate.push(input);
    return {
      result_version: 'builder-conversation-candidate-draft-read-result.v1',
      draft_id: result.draft_id,
      project_id: recorded.git_candidate_receipt.project_id,
      conversation_id: recorded.git_candidate_receipt.conversation_id,
      turn_id: recorded.git_candidate_receipt.turn_id,
      task_id: recorded.git_candidate_receipt.task_id,
      run_id: recorded.git_candidate_receipt.run_id,
      candidate_digest: recorded.git_candidate_receipt.candidate_digest,
      base_revision: {
        revision_receipt_digest: result.base_revision_evidence.revision_receipt_digest,
        commit_oid: result.base_revision_evidence.commit_oid,
      },
      conversation_head: {
        sequence: 4,
        event_id: `builder-conversation-event:${'a'.repeat(64)}`,
        event_digest: `sha256:${'b'.repeat(64)}`,
      },
      candidate_result: recorded,
      verification_admission: 'sqlite_replay_verified',
    };
  };
  const restoredGit = gitAuthority();
  restoredGit.read_verified_candidate = async (receipt) => ({
    result_version: 'builder-git-verified-candidate-read-result.v1',
    candidate_receipt: receipt,
    verification_receipt: createBuilderGitCandidateVerificationReceipt(receipt),
    source_tree: result.source_tree,
    code_authority: 'git_commit_tree',
    read_admission: 'verified',
  });
  const restoredService = createBuilderGenerationMainService({
    ...repositories({
      conversationService: restoredLifecycle,
      gitAuthority: restoredGit,
      projectReadAuthority: {
        load_current(query) {
          restoredBaseReads.push(query);
          return readResult(baseSource);
        },
      },
    }),
    transport: async () => {
      throw new Error('provider must not be called for pending restore');
    },
  });

  const pending = await restoredService.read_pending_draft({ draft_id: result.draft_id });
  assert.equal(pending.result_version, 'builder-generation-pending-draft.v2');
  assert.equal(pending.restart_restore, 'git_sqlite_verified');
  assert.equal(pending.draft_id, result.draft_id);
  assert.equal(pending.git_request_id, recorded.git_candidate_receipt.request_id);
  assert.equal(pending.candidate_proof.candidate_digest, result.candidate.candidate_digest);
  assert.equal(pending.candidate_proof.request_digest, null);
  assert.deepEqual(restoredLifecycle.calls.readCandidate, [{ draft_id: result.draft_id }]);
  assert.doesNotMatch(JSON.stringify(pending), /source_tree|operations|provider|credential/iu);

  const restored = await restoredService.restore_draft({ draft_id: result.draft_id });
  assert.equal(restored.version, 'builder-generation-result.v2');
  assert.equal(restored.request_id, null);
  assert.equal(restored.draft_id, result.draft_id);
  assert.equal(restored.project_id, PROJECT_ID);
  assert.equal(restored.existing_project_id, PROJECT_ID);
  assert.equal(restored.restart_restore, 'git_sqlite_verified');
  assert.equal(restored.candidate.candidate_digest, result.candidate.candidate_digest);
  assert.equal(restored.source_tree.source_tree_digest, result.source_tree.source_tree_digest);
  assert.equal(
    restored.base_revision_evidence.source_tree_digest,
    baseSource.source_tree_digest,
  );
  assert.deepEqual(restoredBaseReads, [{ project_id: PROJECT_ID }]);
  assert.deepEqual(restoredLifecycle.calls.readCandidate, [
    { draft_id: result.draft_id },
    { draft_id: result.draft_id },
  ]);
  assert.doesNotMatch(JSON.stringify(restored), /git_candidate_receipt|verification_receipt|provider|credential|operations/iu);
});

test('generates through persisted provider authority without exposing its credential', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawfabric-builder-main-service-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const safeStorage = {
    isEncryptionAvailable() { return true; },
    encryptString(value) { return Buffer.from(`encrypted:${value}`, 'utf8'); },
    decryptString(value) {
      const text = value.toString('utf8');
      if (!text.startsWith('encrypted:')) throw new Error(PRIVATE_MARKER);
      return text.slice('encrypted:'.length);
    },
  };
  const secretStore = createBuilderProviderSecretStore(root, { safeStorage });
  const providerConfigRepository = createBuilderProviderConfigRepository(root, { secretStore });
  providerConfigRepository.write_current({
    config: {
      base_url: 'https://provider.example/v1',
      model: 'persisted-builder-model',
      timeout_ms: 30000,
      temperature: 0,
      max_tokens: 8192,
      secret_ref: {
        ref_version: 'builder-provider-secret-ref.v1',
        provider_id: 'builder-default',
        secret_id: 'builder-provider-secret:default',
      },
    },
    credential: PRIVATE_MARKER,
  });
  const transportInputs = [];
  const service = createBuilderGenerationMainService({
    ...repositories({ providerConfigRepository }),
    transport: async (input) => {
      transportInputs.push(input);
      return {
        transport_version: 'builder-openai-compatible-transport.v1',
        generated_text: JSON.stringify(providerOutput()),
      };
    },
  });

  const result = await service.generate(request());
  assert.equal(transportInputs.length, 1);
  assert.equal(transportInputs[0].model, 'persisted-builder-model');
  assert.equal(transportInputs[0].credential, PRIVATE_MARKER);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(`${PRIVATE_MARKER}|provider\\.example|persisted-builder-model`, 'iu'));
});

test('fails closed for malformed repositories, read authority, authority pairs, and accessor options', async () => {
  const cases = [
    null,
    {},
    { providerConfigRepository: {}, projectReadAuthority: {} },
    new Proxy({}, { getPrototypeOf() { throw new Error(PRIVATE_MARKER); } }),
  ];
  for (const value of cases) {
    assert.throws(() => createBuilderGenerationMainService(value), (error) => {
      assert.equal(error.code, 'builder_generation_service_unavailable');
      assert.doesNotMatch(`${error.message}:${error.stack}`, new RegExp(PRIVATE_MARKER, 'u'));
      return true;
    });
  }

  const options = repositories();
  Object.defineProperty(options, 'transport', {
    enumerable: true,
    get() { throw new Error(PRIVATE_MARKER); },
  });
  assert.throws(() => createBuilderGenerationMainService(options), {
    code: 'builder_generation_service_unavailable',
  });

  const invalidAuthority = createBuilderGenerationMainService({
    ...repositories({
      providerConfigRepository: { bind_current_authority: () => ({}) },
    }),
    transport: async () => ({ transport_version: 'builder-openai-compatible-transport.v1', generated_text: '{}' }),
  });
  assert.equal(invalidAuthority.availability().available, false);

  const malformedRead = createBuilderGenerationMainService({
    ...repositories({
      projectReadAuthority: {
        load_current() { return {}; },
      },
    }),
    transport: async () => ({ transport_version: 'builder-openai-compatible-transport.v1', generated_text: JSON.stringify(providerOutput()) }),
  });
  await assert.rejects(
    malformedRead.generate(request({ existingProjectId: PROJECT_ID })),
    { code: 'builder_generation_base_unavailable' },
  );
});

test('does not register Electron, save, old revision, or expose provider credential authority', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'electron', 'builder-generation-main-service.cjs'), 'utf8');
  assert.match(source, /prepare_approved_plan_edit_context/u);
  assert.match(source, /generate_approved_plan/u);
  assert.match(source, /main_generation_approved_plan_edit_context_v1/u);
  assert.match(source, /main_only_fresh_continuation_current_source_no_dispatch/u);
  assert.match(source, /main_only_approved_plan_starts_work_run_before_provider/u);
  assert.match(source, /prepare_draft_continuation/u);
  assert.match(source, /main_only_pending_draft_identity_no_dispatch/u);
  assert.match(source, /prepare_draft_continuation_base/u);
  assert.match(source, /main_only_pending_candidate_git_base_no_dispatch/u);
  assert.match(source, /generate_draft_continuation/u);
  assert.match(source, /main_only_pending_candidate_context_squashed_to_project_base/u);
  assert.match(source, /propose_plan/u);
  assert.match(source, /main_only_source_context_plan_no_source_mutation/u);
  for (const forbidden of [
    /require\(['"]electron['"]\)/u,
    /ipcMain|ipcRenderer|contextBridge|BrowserWindow/u,
    /safeStorage|write_current|publish\(/u,
    /builder-project-revision|projectRevisionRepository/u,
    /local-provider-executor|chat_planner|ChatCreatePage|Canvas|JobMeta/u,
  ]) assert.doesNotMatch(source, forbidden);
});
