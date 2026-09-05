// @vitest-environment jsdom
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BuilderApp } from './BuilderApp';
import {
  BUILDER_DESKTOP_BRIDGE_VERSION,
  type BuilderDesktopBridgeRoot,
} from './builderDesktopBridgeRoot';
import {
  CONVERSATION_ID,
  DRAFT_ID,
  PROJECT_ID,
  RUN_ID,
  TASK_ID,
  TURN_ID,
  createAcceptedTaskStreamWire,
  createAnswerTaskStreamWire,
  createCatalogWire,
  createWorkspaceCatalogWire,
  createGenerationAnswer,
  createGenerationDraft,
  createHistoryWire,
  createInterruptedTaskStreamWire,
  createPlanTaskStreamWire,
  createPlanReviewTaskStreamWire,
  createReadWire,
  createRejectedTaskStreamWire,
  createRestoredGenerationDraft,
  createSaveResult,
  createSourceTree,
  createTaskStreamWire,
  createTwoAnswerTaskStreamWire,
  digest,
} from '../test/builderV2Fixtures';
import { createBuilderGenerationRequest } from '../features/builder/application/builderGeneration';
import { decideBuilderComposerIntent } from '../features/builder/application/builderComposerIntent';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mounted: Array<{ root: Root; container: HTMLDivElement }> = [];
const PENDING_TURN_ID = 'builder-turn:123e4567-e89b-42d3-a456-426614174001';
const PENDING_TASK_ID = 'builder-task:123e4567-e89b-42d3-a456-426614174001';
const PENDING_RUN_ID = 'builder-run:123e4567-e89b-42d3-a456-426614174001';
const TASK_ADDRESS_ID = 'builder-task-address:123e4567-e89b-42d3-a456-426614174006';
const SESSION_ID = 'builder-session:123e4567-e89b-42d3-a456-426614174007';
const MATERIALIZED_TASK_ADDRESS_ID = 'builder-task-address:123e4567-e89b-42d3-a456-426614174008';
const MATERIALIZED_SESSION_ID = 'builder-session:123e4567-e89b-42d3-a456-426614174009';
const AGENT_ID = 'builder-agent:123e4567-e89b-42d3-a456-426614174002';
let consoleErrorSpy: ReturnType<typeof vi.spyOn> | null = null;

function livePreviewRuntimeLaunchProjection(request: unknown) {
  return {
    projection_version: 'builder-project-runtime-launch-projection.v1',
    project_id: (request as { project_id: string }).project_id,
    conversation_id: (request as { conversation_id: string }).conversation_id,
    preview_kind: 'live_static_web',
    source_status: 'main_owned_verified',
    command_profile: 'none',
    user_approval: 'not_required',
    command_execution: 'not_applicable',
    dependency_preparation: 'not_allowed',
    package_install: 'not_allowed',
    sandbox_policy: 'static_preview_no_command_execution',
    provider_dispatch: false,
    tool_dispatch: false,
    project_workspace_write: 'not_granted_by_preview',
    authority: {
      projection_authority: 'main_owned_project_runtime_launch_projection_v1',
      renderer_authority: 'status_projection_only',
      path_disclosure: 'not_serialized',
    },
  };
}

function isReactActWarning(args: readonly unknown[]): boolean {
  const message = typeof args[0] === 'string' ? args[0] : '';
  return message.includes('An update to %s inside a test was not wrapped in act')
    || message.includes('You seem to have overlapping act() calls');
}

function asAgentConversationWire(value: unknown, agentId: string) {
  const wire = value as {
    conversation?: null | {
      created_at_ms: number;
      head_sequence: number;
      recorded_active_turn_id: string | null;
      window: { has_earlier: boolean };
      items: readonly Record<string, unknown>[];
    };
  };
  const authority = {
    conversation: 'sqlite_canonical_agent_conversation',
    project_source: 'not_included',
    candidate_source: 'not_loaded',
    project_revision: 'not_inferred',
  } as const;
  if (wire.conversation == null) {
    return {
      stream_version: 'builder-task-stream-read-result.v1',
      scope_kind: 'agent_conversation',
      agent_id: agentId,
      project_id: null,
      conversation: null,
      authority,
    };
  }
  const items = wire.conversation.items.flatMap((item) => {
    if (item.item_kind === 'user_message') {
      const message = item.message as { text?: string } | undefined;
      const routeDecision = item.message_kind === 'submitted' && typeof message?.text === 'string'
        ? decideBuilderComposerIntent(message.text)
        : null;
      const contextRoute = routeDecision?.route === 'clarify'
        && routeDecision.matchedSignals.includes('work_discussion')
        ? 'update_brief'
        : routeDecision?.route;
      return [{
        item_kind: 'transcript_message',
        sequence: item.sequence,
        turn_id: item.turn_id,
        message: item.message,
        role: 'user',
        message_kind: item.message_kind,
        ...(contextRoute === undefined ? {} : { context_route: contextRoute }),
        recovery_admission: 'sqlite_derived_public_transcript_only',
      }];
    }
    if (item.item_kind === 'run_completed' && item.assistant_message !== null) {
      return [{
        item_kind: 'transcript_message',
        sequence: item.sequence,
        turn_id: item.turn_id,
        message: item.assistant_message,
        role: 'assistant',
        message_kind: 'run_result',
        recovery_admission: 'sqlite_derived_public_transcript_only',
      }];
    }
    return [];
  });
  const agentUuid = agentId.slice('builder-agent:'.length);
  return {
    stream_version: 'builder-task-stream-read-result.v1',
    scope_kind: 'agent_conversation',
    agent_id: agentId,
    project_id: null,
    conversation: {
      conversation_id: `builder-agent-conversation:${agentUuid}`,
      created_at_ms: wire.conversation.created_at_ms,
      head_sequence: wire.conversation.head_sequence,
      recorded_active_turn_id: wire.conversation.recorded_active_turn_id,
      source: 'sqlite_canonical_agent_conversation',
      window: {
        first_sequence: (items[0]?.sequence as number | undefined) ?? 0,
        last_sequence: wire.conversation.head_sequence,
        has_earlier: wire.conversation.window.has_earlier,
      },
      items,
    },
    authority,
  };
}

beforeEach(() => {
  const originalError = console.error.bind(console);
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    if (isReactActWarning(args)) return;
    originalError(...args);
  });
});

afterEach(() => {
  for (const entry of mounted.splice(0)) {
    act(() => entry.root.unmount());
    entry.container.remove();
  }
  consoleErrorSpy?.mockRestore();
  consoleErrorSpy = null;
});

async function waitFor(assertion: () => void, maximumAttempts = 80): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
  }
  throw lastError;
}

function createTaskTranscriptExportWire(taskAddressId = TASK_ADDRESS_ID): Record<string, unknown> {
  const markdown = [
    '# ClawFabric Task Transcript',
    '',
    'Task: Create Builder project',
    `Task address: ${taskAddressId}`,
    '',
    '## Conversation',
    '',
    'User: Make a small focus timer.',
    'Assistant: Done.',
    '',
  ].join('\n');
  const jsonl = `${JSON.stringify({
    entry_kind: 'task_transcript_export',
    task_address_id: taskAddressId,
  })}\n`;
  return {
    export_version: 'builder-task-transcript-export.v1',
    export_id: `builder-task-transcript-export:${'1'.repeat(64)}`,
    project_id: PROJECT_ID,
    task_address_id: taskAddressId,
    task_id: taskAddressId,
    session_id: SESSION_ID,
    conversation_id: CONVERSATION_ID,
    exported_at_ms: 1_700_000_000_000,
    task: {
      title: 'Create Builder project',
      goal: 'Create and improve the current project.',
      status: 'active',
    },
    source: {
      authority: 'main_task_address_to_sqlite_conversation_replay_read_only',
      event_count: 2,
      current_sequence: 2,
      conversation_export_id: `builder-conversation-export:${'2'.repeat(64)}`,
    },
    formats: {
      markdown: {
        media_type: 'text/markdown; charset=utf-8',
        byte_length: markdown.length,
        text: markdown,
      },
      jsonl: {
        media_type: 'application/x-ndjson',
        byte_length: jsonl.length,
        text: jsonl,
      },
    },
    lifecycle: {
      export_authority: 'main_task_transcript_export_contract_v1',
      renderer_authority: 'task_export_request_only',
      source_read: 'not_performed',
      source_write: 'not_performed',
      provider_dispatch: 'not_performed',
      git_mutation: 'not_performed',
    },
  };
}

function createContextualBuildTaskStreamWire() {
  const wire = createAnswerTaskStreamWire();
  return {
    ...wire,
    conversation: {
      ...wire.conversation,
      head_sequence: 5,
      window: {
        ...wire.conversation.window,
        last_sequence: 5,
      },
      items: [
        {
          item_kind: 'user_message',
          sequence: 1,
          turn_id: TURN_ID,
          message: {
            message_id: 'builder-message:123e4567-e89b-42d3-a456-426614174000',
            text: '我想先聊一下这个作品集首页怎么做，目标是星空背景和项目列表。',
          },
          message_kind: 'submitted',
          mode: 'question',
          task: null,
        },
        {
          item_kind: 'run_started',
          sequence: 2,
          turn_id: TURN_ID,
          run_id: RUN_ID,
          task_id: null,
          attempt_number: 1,
          retry_of_run_id: null,
          recorded_state: 'started',
        },
        {
          item_kind: 'run_completed',
          sequence: 3,
          turn_id: TURN_ID,
          run_id: RUN_ID,
          terminal_status: 'succeeded',
          result_kind: 'explanation',
          failure_phase: 'not_applicable',
          assistant_message: {
            message_id: 'builder-message:223e4567-e89b-42d3-a456-426614174000',
            text: '方案是先做单页静态作品集，包含 hero、项目卡片和联系入口。',
          },
          candidate: null,
        },
        {
          item_kind: 'task_brief_updated',
          sequence: 4,
          turn_id: TURN_ID,
          run_id: RUN_ID,
          task: {
            task_id: PENDING_TASK_ID,
            title: 'Current project brief',
          },
          brief: {
            status: 'ready',
            summary: '我想先聊一下这个作品集首页怎么做，目标是星空背景和项目列表。 方案是先做单页静态作品集，包含 hero、项目卡片和联系入口。',
            contextual_build_ready: true,
          },
          recorded_state: 'updated',
        },
        {
          item_kind: 'turn_completed',
          sequence: 5,
          turn_id: TURN_ID,
          run_id: RUN_ID,
          outcome: 'answered',
        },
      ],
    },
  };
}

function providerContextDisclosureStatusProjection() {
  return {
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
}

function reviewReadyTaskStreamWire() {
  return {
    ...createTaskStreamWire(),
    check_run_outcome_projection: {
      projection_version: 'builder-check-run-outcome-projection.v1',
      state: 'skipped',
      command_kind: null,
      command_label: null,
      status: 'skipped',
      label: 'Check skipped',
      summary: 'You chose to save this draft without running a project check.',
      environment_reason: 'none',
      completed_at_ms: null,
      authority: {
        projection_authority: 'main_owned_check_run_outcome_projection_v1',
        fact_source: 'verified_explicit_skip_decision',
        raw_output: 'not_present',
        runtime_paths: 'not_present',
        renderer_authority: 'read_only_projection',
        save_authority: false,
      },
    },
    draft_checkpoint_status_projection: {
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
    },
    review_state_projection: {
      projection_version: 'builder-review-state-projection.v1',
      draft_id: DRAFT_ID,
      status: 'ready',
      label: 'Ready to review',
      summary: 'You chose to save this recoverable draft without running a project check.',
      checkpoint_status: 'ready',
      preview_status: 'not_recorded',
      check_status: 'skipped',
      changed_file_count: 2,
      can_save: true,
      can_discard: true,
      blocking_reasons: [],
      authority: {
        projection_authority: 'main_owned_review_state_projection_v1',
        candidate_evidence: 'sqlite_conversation_replay_current_unreviewed_candidate',
        checkpoint_evidence: 'verified_latest_candidate_checkpoint',
        check_evidence: 'verified_explicit_skip_decision',
        renderer_authority: 'not_present',
        ipc_authority: 'projection_only',
        provider_dispatch: false,
        tool_dispatch: false,
        source_read: 'not_present',
        source_write: 'not_present',
        git_write: false,
        sqlite_write: false,
        permission_grant: false,
        revision_admission: 'not_created',
        save_authority: false,
        publication: false,
      },
    },
  } as const;
}

function uncheckedReviewTaskStreamWire() {
  const wire = reviewReadyTaskStreamWire();
  return {
    ...wire,
    check_run_outcome_projection: {
      ...wire.check_run_outcome_projection,
      state: 'not_run',
      status: 'not_run',
      label: 'Not checked',
      summary: 'No project check has been recorded for this draft.',
      authority: {
        ...wire.check_run_outcome_projection.authority,
        fact_source: 'verified_absence',
      },
    },
    review_state_projection: {
      ...wire.review_state_projection,
      status: 'blocked',
      label: 'Review not ready',
      summary: 'Builder has not finished checking this draft yet.',
      check_status: 'not_run',
      can_save: false,
      blocking_reasons: ['check_not_run'],
      authority: {
        ...wire.review_state_projection.authority,
        check_evidence: 'verified_absence',
      },
    },
  } as const;
}

function checkedReviewTaskStreamWire() {
  const wire = reviewReadyTaskStreamWire();
  return {
    ...wire,
    check_run_outcome_projection: {
      ...wire.check_run_outcome_projection,
      state: 'completed',
      command_kind: 'test',
      command_label: 'Tests',
      status: 'passed',
      label: 'Checked',
      summary: 'The project check completed successfully.',
      environment_reason: 'none',
      completed_at_ms: 20,
      authority: {
        ...wire.check_run_outcome_projection.authority,
        fact_source: 'verified_current_candidate_check_run',
      },
    },
    review_state_projection: {
      ...wire.review_state_projection,
      summary: 'A recoverable draft is checked and ready to inspect and save.',
      check_status: 'passed',
      authority: {
        ...wire.review_state_projection.authority,
        check_evidence: 'verified_current_candidate_check_projection',
      },
    },
  } as const;
}

function dependencyBlockedReviewTaskStreamWire() {
  const wire = reviewReadyTaskStreamWire();
  return {
    ...wire,
    check_run_outcome_projection: {
      ...wire.check_run_outcome_projection,
      state: 'completed',
      command_kind: 'test',
      command_label: 'Tests',
      status: 'incomplete',
      label: 'Check unavailable',
      summary: 'This draft declares project dependencies, but the isolated check workspace has not prepared them yet.',
      environment_reason: 'dependency_workspace_missing',
      completed_at_ms: 20,
      authority: {
        ...wire.check_run_outcome_projection.authority,
        fact_source: 'verified_current_candidate_check_run',
      },
    },
    review_state_projection: {
      ...wire.review_state_projection,
      status: 'blocked',
      label: 'Review not ready',
      summary: 'The latest project check did not finish. Run it again before saving.',
      check_status: 'incomplete',
      can_save: false,
      blocking_reasons: ['check_incomplete'],
      authority: {
        ...wire.review_state_projection.authority,
        check_evidence: 'verified_current_candidate_check_projection',
      },
    },
  } as const;
}

function createReadOnlyPageQuestionTaskStreamWire() {
  const wire = createAnswerTaskStreamWire();
  return {
    ...wire,
    conversation: {
      ...wire.conversation,
      items: [
        {
          item_kind: 'user_message',
          sequence: 1,
          turn_id: TURN_ID,
          message: {
            message_id: 'builder-message:123e4567-e89b-42d3-a456-426614174000',
            text: '为什么这个页面预览空白？',
          },
          message_kind: 'submitted',
          mode: 'question',
          task: null,
        },
        {
          item_kind: 'run_started',
          sequence: 2,
          turn_id: TURN_ID,
          run_id: RUN_ID,
          task_id: null,
          attempt_number: 1,
          retry_of_run_id: null,
          recorded_state: 'started',
        },
        {
          item_kind: 'run_completed',
          sequence: 3,
          turn_id: TURN_ID,
          run_id: RUN_ID,
          terminal_status: 'succeeded',
          result_kind: 'explanation',
          failure_phase: 'not_applicable',
          assistant_message: {
            message_id: 'builder-message:223e4567-e89b-42d3-a456-426614174000',
            text: '这个页面可能因为静态预览不运行 JavaScript 而空白，可以先查看预览限制和文件内容。',
          },
          candidate: null,
        },
        {
          item_kind: 'turn_completed',
          sequence: 4,
          turn_id: TURN_ID,
          run_id: RUN_ID,
          outcome: 'answered',
        },
      ],
    },
  };
}

async function setup(options: Readonly<{
  answerActivity?: boolean;
  briefUpdateActivity?: boolean;
  contextualBuildActivity?: boolean;
  deferredAnswer?: boolean;
  deferredFailedFirstAnswer?: boolean;
  deferredFailedAnswerAfterFirst?: boolean;
  deferAnswerAfterFirst?: boolean;
  deferredApprovedPlanGenerate?: boolean;
  deferredGenerate?: boolean;
  deferredPlanProposal?: boolean;
  failFirstAnswer?: boolean;
  failAnswerAfterFirst?: boolean;
  retainedIncompleteAnswer?: boolean;
  consecutiveAnswerActivity?: boolean;
  recordedFirstAnswerAfterFailedPublicResult?: boolean;
  recordedAnswerAfterFailedPublicResult?: boolean;
  failGenerate?: boolean;
  failQueueFollowup?: boolean;
  failApprovedPlanGenerateOnce?: boolean;
  failPlanReview?: boolean;
  failTaskStreamAfterPlanReview?: boolean;
  deferredPlanReview?: boolean;
  failSubmitOnce?: boolean;
  initiallySaved?: boolean;
  livePreviewReply?: (operation: 'read' | 'start', status: Record<string, unknown>) => Promise<Record<string, unknown>>;
  planSourceReadApprovalRequired?: boolean;
  failPlanSourceReadApprovalPrepare?: boolean;
  failPlanSourceReadApproval?: boolean;
  currentProjectWriteApprovalRequired?: boolean;
  failCurrentProjectWriteApproval?: boolean;
  failTaskStreamReadAttempts?: number;
  hangAgentProjectTreeAfterPlan?: boolean;
  planAfterPropose?: boolean;
  pendingBuildConfirmationActivity?: boolean;
  pendingActivity?: boolean;
  pendingActivityAfterSave?: boolean;
  staleActivityReadAttemptsBeforePendingRestore?: number;
  staleActivityBeforePendingRestore?: boolean;
  pendingPlanActivity?: boolean;
  rejectedPlanActivity?: boolean;
  pendingAfterRevisionView?: boolean;
  acceptedPendingActivity?: boolean;
  supersededAcceptedPendingActivity?: boolean;
  rejectActivityAfterDiscard?: boolean;
  rejectedPendingActivity?: boolean;
  restoreAvailable?: boolean;
  failFirstRestoreDraft?: boolean;
  failRestoreDraftAttempts?: number;
  runningActivity?: boolean;
  readOnlyPageQuestionActivity?: boolean;
  taskStreamWireOverride?: unknown;
  validHistoryPreview?: boolean;
  multipleWorkspaceOnlyCatalog?: boolean;
  workspaceOnlyCatalog?: boolean;
  checkRunAvailable?: boolean;
  deferredCheckRunRead?: boolean;
  failCheckRunReadAttempts?: number;
  failSideWorkspaceFileTreeReadAttempts?: number;
  sideWorkspaceSourceKind?: 'current_draft' | 'saved_revision';
  checkRunStatus?: 'passed' | 'failed' | 'incomplete';
  dependencyBlockedCheck?: boolean;
  dependencyBlockedUntilPreparation?: boolean;
  deferredDependencyPreparation?: boolean;
  sideWorkspaceFilesAvailable?: boolean;
  uncheckedUntilSkip?: boolean;
  semanticIntentRoute?: 'answer' | 'clarify' | 'update_brief' | 'plan' | 'build';
  agentTaskIncubation?: boolean;
  agentTaskProposalPending?: boolean;
  agentTaskProposalMaterializes?: boolean;
  agentTaskReturn?: boolean;
  strictMode?: boolean;
}> = {}) {
  const historicalWire = options.validHistoryPreview === true
    ? await createReadWire(await createSourceTree([
      { path: 'index.html', content: '<main>Earlier</main>\n' },
    ]))
    : null;
  const readWire = options.validHistoryPreview === true && historicalWire !== null
    ? await readWireAsRevision(
      await createReadWire(await createSourceTree([
        { path: 'index.html', content: '<main>Current</main>\n' },
      ])),
      2,
      historicalWire.product_revision_receipt.revision_receipt_digest,
    )
    : await createReadWire();
  const catalogWire = await createCatalogWire();
  let saved = options.initiallySaved === true;
  let selectedProjectId: string | null = null;
  let latestAnswerInstruction: string | null = null;
  const answerInstructions: string[] = [];
  let latestDraft = await createGenerationDraft();
  let restoredDraft = await createRestoredDraftForReadWire(readWire);
  let resolveAnswer: (() => Promise<void>) | null = null;
  let answerAttempts = 0;
  const taskStreamChangedListeners = new Set<(event: unknown) => void>();
  let resolveGenerate: (() => Promise<void>) | null = null;
  let resolvePlanProposal: (() => Promise<void>) | null = null;
  let resolvePlanReview: (() => Promise<void>) | null = null;
  let approvedPlanGenerateAttempts = 0;
  let checkRunReadAttempts = 0;
  let resolveDeferredCheckRunRead: (() => void) | null = null;
  let resolveDeferredDependencyPreparation: (() => void) | null = null;
  let sideWorkspaceFileTreeReadAttempts = 0;
  let currentProjectWriteAllowed = options.currentProjectWriteApprovalRequired !== true;
  let planReviewRecorded = false;
  const readCurrentDraftAvailableChecks = vi.fn(async (request: unknown) => {
    checkRunReadAttempts += 1;
    if (options.deferredCheckRunRead === true && checkRunReadAttempts === 1) {
      await new Promise<void>((resolve) => {
        resolveDeferredCheckRunRead = resolve;
      });
    }
    if (checkRunReadAttempts <= (options.failCheckRunReadAttempts ?? 0)) {
      throw new Error('check run discovery is temporarily unavailable');
    }
    const draftId = (request as { draft_id: string }).draft_id;
    return {
      result_version: 'builder-check-run-current-draft-read-result.v1',
      service_version: 'builder-check-run-current-draft-service.v1',
      operation: 'current_draft_available_checks_read',
      status: options.checkRunAvailable === true ? 'ready' : 'no_checks',
      draft_id: draftId,
      project_id: PROJECT_ID,
      candidate_id: `builder-code-change-candidate:${'0'.repeat(64)}`,
      available_checks: options.checkRunAvailable === true ? [{
        command_profile_id: `builder-command-profile:${'1'.repeat(32)}`,
        command_kind: 'test',
        command_display: 'npm test',
        requires_user_approval: true,
      }] : [],
    };
  });
  const approveAndRunCurrentDraftCheck = vi.fn(async (request: unknown) => {
    const draftId = (request as { draft_id: string }).draft_id;
    const status = options.checkRunStatus ?? 'passed';
    const [label, summary] = status === 'passed'
      ? ['Checked', 'The project check completed successfully.']
      : status === 'failed'
        ? ['Check failed', 'The project check found a problem that needs review.']
        : ['Check incomplete', 'The project check reached its time limit.'];
    return {
      result_version: 'builder-check-run-current-draft-run-result.v1',
      service_version: 'builder-check-run-current-draft-service.v1',
      operation: 'current_draft_approved_check_completed',
      draft_id: draftId,
      project_id: PROJECT_ID,
      candidate_id: `builder-code-change-candidate:${'0'.repeat(64)}`,
      check_run_status_projection: {
        projection_version: 'builder-check-run-status-projection.v1',
        project_id: PROJECT_ID,
        candidate_id: `builder-code-change-candidate:${'0'.repeat(64)}`,
        check_run_id: `builder-check-run:${'2'.repeat(64)}`,
        command_kind: 'test',
        command_label: 'Tests',
        status,
        label,
        summary,
        environment_reason: 'none',
        completed_at_ms: 20,
        result_digest: `sha256:${'3'.repeat(64)}`,
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
      },
    };
  });
  const diagnoseCurrentDraftCheckEnvironment = vi.fn(async (request: unknown) => {
    const draftId = (request as { draft_id: string }).draft_id;
    const commandProfileId = (request as { command_profile_id: string }).command_profile_id;
    return {
      result_version: 'builder-check-run-current-draft-environment-diagnosis-result.v1',
      service_version: 'builder-check-run-current-draft-service.v1',
      operation: 'current_draft_check_environment_diagnosed',
      draft_id: draftId,
      project_id: PROJECT_ID,
      candidate_id: `builder-code-change-candidate:${'0'.repeat(64)}`,
      environment_diagnosis: {
        diagnosis_version: 'builder-environment-readiness-diagnosis.v1',
        diagnosis_id: `builder-environment-readiness-diagnosis:${'4'.repeat(64)}`,
        project_id: PROJECT_ID,
        candidate_id: `builder-code-change-candidate:${'0'.repeat(64)}`,
        source_tree_digest: `sha256:${'5'.repeat(64)}`,
        command_profile_id: commandProfileId,
        command_kind: 'test',
        command_display: 'npm test',
        package_manager: 'npm',
        package_manifest: 'present',
        dependency_manifest: 'present',
        lockfile: 'package-lock.json',
        project_dependency_state: 'install_missing',
        check_workspace_dependency_state: 'install_missing',
        host_toolchain_state: 'visible',
        host_node_version: '22.17.0',
        host_package_manager_version: '10.9.2',
        install_permission: 'required',
        dependency_strategy: 'needs_prepared_dependency_workspace',
        readiness_state: 'dependencies_not_prepared',
        primary_action: 'prepare_once',
        safe_summary: 'The isolated check workspace has not prepared this draft\'s dependencies yet.',
        authority: {
          diagnosis_authority: 'main_owned_read_only_environment_diagnosis_v1',
          readiness_authority: 'verified_builder_runtime_readiness_snapshot_v1',
          renderer_authority: 'redacted_projection_only',
          browser_preview_authority: 'readiness_context_only_no_install_decision',
          provider_dispatch: false,
          harness_dispatch: false,
          command_execution: false,
          dependency_preparation: false,
          project_workspace_write: false,
          check_workspace_write: false,
          git_write: false,
          sqlite_write: false,
          save_authority: false,
          path_disclosure: 'not_serialized',
          environment_variable_disclosure: false,
          raw_output: 'not_present',
          secret_access: 'not_present',
          network_access: false,
        },
        diagnosed_at_ms: 1234,
        diagnosis_digest: `sha256:${'6'.repeat(64)}`,
      },
    };
  });
  const diagnoseProjectEnvironment = vi.fn(async (request: unknown) => {
    const projectId = (request as { project_id: string }).project_id;
    return {
      result_version: 'builder-project-environment-diagnosis-result.v1',
      service_version: 'builder-project-environment-diagnosis-service.v1',
      operation: 'project_environment_diagnosed',
      project_id: projectId,
      environment_diagnosis: {
        diagnosis_version: 'builder-project-environment-diagnosis.v1',
        diagnosis_id: `builder-project-environment-diagnosis:${'7'.repeat(64)}`,
        project_id: projectId,
        source_tree_digest: `sha256:${'8'.repeat(64)}`,
        package_manager: 'npm',
        package_manifest: 'present',
        dependency_manifest: 'present',
        lockfile: 'package-lock.json',
        project_dependency_state: 'install_missing',
        toolchains: {
          node: { state: 'visible', version: '22.17.0' },
          npm: { state: 'visible', version: '10.9.2' },
          pnpm: { state: 'missing', version: null },
          yarn: { state: 'missing', version: null },
          git: { state: 'visible', version: '2.50.0' },
        },
        readiness_state: 'project_dependencies_missing',
        primary_action: 'show_project_dependency_setup',
        safe_summary: 'This project declares dependencies, but the project folder does not have installed dependencies.',
        authority: {
          diagnosis_authority: 'main_owned_read_only_project_environment_diagnosis_v1',
          source_authority: 'main_owned_current_project_source_tree',
          toolchain_probe_authority: 'main_owned_bounded_toolchain_version_probe_v1',
          renderer_authority: 'redacted_projection_only',
          browser_preview_authority: 'readiness_context_only_no_install_decision',
          provider_dispatch: false,
          harness_dispatch: false,
          command_execution: false,
          dependency_preparation: false,
          project_workspace_write: false,
          check_workspace_write: false,
          git_write: false,
          sqlite_write: false,
          save_authority: false,
          path_disclosure: 'not_serialized',
          environment_variable_disclosure: false,
          raw_output: 'not_present',
          secret_access: 'not_present',
          network_access: false,
        },
        diagnosed_at_ms: 1235,
        diagnosis_digest: `sha256:${'9'.repeat(64)}`,
      },
    };
  });
  const decideCurrentDraftDependencyPreparation = vi.fn(async (request: unknown) => {
    if (options.deferredDependencyPreparation === true) {
      await new Promise<void>((resolve) => {
        resolveDeferredDependencyPreparation = resolve;
      });
    }
    return approveAndRunCurrentDraftCheck(request);
  });
  const prepareProjectDependencies = vi.fn(async (request: unknown) => {
    const projectId = (request as { project_id: string }).project_id;
    const diagnosed = await diagnoseProjectEnvironment({ project_id: projectId });
    return {
      result_version: 'builder-project-dependency-preparation-result.v1',
      service_version: 'builder-project-dependency-preparer.v1',
      operation: 'project_dependencies_prepared',
      project_id: projectId,
      preparation_receipt: {
        receipt_version: 'builder-project-dependency-preparation-receipt.v1',
        project_id: projectId,
        package_manager: 'npm',
        install_command: 'npm ci',
        status: 'prepared',
        exit_code: 0,
        started_at_ms: 1236,
        completed_at_ms: 1240,
        output_digest: `sha256:${'a'.repeat(64)}`,
        authority: {
          preparation_authority: 'main_owned_project_dependency_preparation_v1',
          workspace_authority: 'main_owned_bound_project_workspace_path',
          renderer_authority: 'project_id_only_explicit_user_action',
          browser_preview_authority: 'readiness_context_only_no_install_decision',
          provider_dispatch: false,
          harness_dispatch: false,
          command_execution: true,
          dependency_preparation: true,
          project_workspace_write: true,
          check_workspace_write: false,
          git_write: false,
          sqlite_write: false,
          save_authority: false,
          network_access: 'package_manager_default',
          install_authority: 'explicit_project_prepare_once',
          raw_output: 'digest_only',
          path_disclosure: 'not_serialized',
          environment_variable_disclosure: false,
          secret_access: 'not_present',
        },
        receipt_digest: `sha256:${'b'.repeat(64)}`,
      },
      environment_diagnosis: {
        ...diagnosed.environment_diagnosis,
        project_dependency_state: 'install_present',
        readiness_state: 'ready',
        primary_action: 'none',
        safe_summary: 'The project environment appears ready.',
      },
    };
  });
  const skipCurrentDraftCheck = vi.fn(async (request: unknown) => ({
    result_version: 'builder-check-skip-current-draft-public-result.v1',
    operation: 'current_draft_check_skipped',
    draft_id: (request as { draft_id: string }).draft_id,
    project_id: PROJECT_ID,
    candidate_id: `builder-code-change-candidate:${'0'.repeat(64)}`,
    status: 'skipped',
  }));
  const sideWorkspaceSourceTreeDigest = `sha256:${'8'.repeat(64)}`;
  const sideWorkspaceFileContentDigest = `sha256:${'9'.repeat(64)}`;
  const sideWorkspaceSourceKind = options.sideWorkspaceSourceKind ?? 'current_draft';
  const sideWorkspaceFileRef = Object.freeze({
    file_ref_version: 'builder-side-workspace-file-ref.v1' as const,
    source_kind: sideWorkspaceSourceKind,
    source_tree_digest: sideWorkspaceSourceTreeDigest,
    path: 'index.html',
    content_digest: sideWorkspaceFileContentDigest,
  });
  const sideWorkspaceFileAuthority = Object.freeze({
    file_projection_authority: 'main_owned_side_workspace_file_projection_v1' as const,
    renderer_source_tree: 'not_accepted' as const,
    renderer_path_authority: 'main_issued_file_ref_only' as const,
    source_read: 'main_owned_verified_source_tree_only' as const,
    source_write: 'not_performed' as const,
    git_write: 'not_performed' as const,
    sqlite_write: 'not_performed' as const,
    provider_dispatch: false as const,
    tool_dispatch: false as const,
    command_execution: false as const,
    electron_view_attachment: false as const,
    ipc_registration: false as const,
    revision_admission: false as const,
    save_admission: false as const,
    permission_grant: false as const,
  });
  const readCurrentDraftFileTree = vi.fn(async (request: unknown) => {
    sideWorkspaceFileTreeReadAttempts += 1;
    if (
      sideWorkspaceFileTreeReadAttempts
      <= (options.failSideWorkspaceFileTreeReadAttempts ?? 0)
    ) {
      throw new Error('current draft file projection is still converging');
    }
    const ids = request as { project_id: string; conversation_id: string };
    return {
      projection_version: 'builder-side-workspace-file-tree.v1' as const,
      project_id: ids.project_id,
      conversation_id: ids.conversation_id,
      source_kind: sideWorkspaceSourceKind,
      root_label: sideWorkspaceSourceKind === 'saved_revision' ? 'Saved revision 1' : 'Current draft',
      source_tree_digest: sideWorkspaceSourceTreeDigest,
      entries: [{
        entry_kind: 'text_file' as const,
        path: 'index.html',
        name: 'index.html',
        parent_path: null,
        depth: 0,
        content_digest: sideWorkspaceFileContentDigest,
        file_ref: sideWorkspaceFileRef,
      }],
      selected_file_ref: sideWorkspaceFileRef,
      source_ref: sideWorkspaceSourceKind === 'saved_revision'
        ? { source_ref_kind: 'saved_project_revision' }
        : { source_ref_kind: 'current_draft_checkpoint_candidate' },
      authority: sideWorkspaceFileAuthority,
    };
  });
  const readCurrentDraftFileContent = vi.fn(async (request: unknown) => {
    const ids = request as { project_id: string; conversation_id: string };
    return {
      projection_version: 'builder-side-workspace-file-content.v1' as const,
      project_id: ids.project_id,
      conversation_id: ids.conversation_id,
      source_kind: sideWorkspaceSourceKind,
      source_tree_digest: sideWorkspaceSourceTreeDigest,
      file_ref: sideWorkspaceFileRef,
      path: 'index.html',
      language_hint: 'html' as const,
      content_status: 'ready' as const,
      text_preview: '<main>Focus timer</main>\n',
      binary_summary: null,
      authority: sideWorkspaceFileAuthority,
    };
  });
  async function createDraftForCurrentProject(
    hostRequest: Awaited<ReturnType<typeof createBuilderGenerationRequest>>,
    sourceTree = readWire.source_tree,
  ) {
    const draft = await createGenerationDraft(hostRequest, sourceTree);
    return saved ? draft : { ...draft, base_revision_evidence: null };
  }
  const hostRequestFor = (request: unknown, instruction: string, projectId = selectedProjectId) => (
    createBuilderGenerationRequest(
      instruction,
      projectId,
      (request as { task_address_id?: string | null }).task_address_id ?? null,
    )
  );
  const publishTaskStreamChanged = () => {
    const event = selectedProjectId === null
      ? {
        event_version: 'builder-task-stream-changed.v1',
        agent_id: AGENT_ID,
      }
      : {
        event_version: 'builder-task-stream-changed.v1',
        project_id: selectedProjectId,
      };
    act(() => {
      for (const listener of [...taskStreamChangedListeners]) listener(event);
    });
  };
  const resumeInterruptedRun = vi.fn(async (request: unknown): Promise<unknown> => { void request; return null; });
  const generate = vi.fn(async (request: unknown) => {
    const instruction = (request as { instruction: string }).instruction;
    const hostRequest = await hostRequestFor(request, instruction);
    if (options.failGenerate === true) {
      return {
        version: 'builder-generation-ipc-result.v1',
        ok: false,
        error: {
          code: 'builder_generation_provider_http_error',
          retryable: true,
        },
      };
    }
    if (options.deferredGenerate === true) {
      return new Promise<unknown>((resolve) => {
        resolveGenerate = async () => {
          latestDraft = await createDraftForCurrentProject(hostRequest);
          resolve({
            version: 'builder-generation-ipc-result.v1',
            ok: true,
            result: latestDraft,
          });
        };
      });
    }
    latestDraft = await createDraftForCurrentProject(hostRequest);
    return {
      version: 'builder-generation-ipc-result.v1',
      ok: true,
      result: latestDraft,
    };
  });
  const retry = vi.fn(async (request: unknown) => {
    const instruction = (request as { instruction: string }).instruction;
    const hostRequest = await hostRequestFor(request, instruction);
    latestDraft = await createDraftForCurrentProject(hostRequest);
    return {
      version: 'builder-generation-ipc-result.v1',
      ok: true,
      result: latestDraft,
    };
  });
  const continueDraft = vi.fn(async (request: unknown) => {
    expect(request).toEqual({
      draft_id: latestDraft.draft_id,
      instruction: (request as { instruction: string }).instruction,
    });
    const instruction = (request as { instruction: string }).instruction;
    const hostRequest = await createBuilderGenerationRequest(instruction, selectedProjectId);
    latestDraft = await createDraftForCurrentProject(hostRequest);
    return {
      version: 'builder-generation-ipc-result.v1',
      ok: true,
      result: latestDraft,
    };
  });
  let completedAgentPlanMarkdown: string | null = null;
  const answer = vi.fn(async (request: unknown, projectId = selectedProjectId) => {
    answerAttempts += 1;
    const instruction = (request as { instruction: string }).instruction;
    latestAnswerInstruction = instruction;
    answerInstructions.push(instruction);
    const hostRequest = await hostRequestFor(request, instruction, projectId);
    const shouldFailAnswer = (options.failFirstAnswer === true && answerAttempts === 1)
      || (options.failAnswerAfterFirst === true && answerAttempts > 1);
    if (shouldFailAnswer) {
      const recordedAnswerExists = (
        options.recordedFirstAnswerAfterFailedPublicResult === true
        && answerAttempts === 1
      ) || (
        options.recordedAnswerAfterFailedPublicResult === true
        && answerAttempts > 1
      );
      if (
        (options.deferredFailedFirstAnswer === true && answerAttempts === 1)
        || (options.deferredFailedAnswerAfterFirst === true && answerAttempts > 1)
      ) {
        return new Promise<unknown>((resolve) => {
          resolveAnswer = async () => {
            if (recordedAnswerExists) publishTaskStreamChanged();
            resolve({
              version: 'builder-generation-ipc-result.v1',
              ok: false,
              error: {
                code: 'builder_generation_structured_response_invalid',
                retryable: true,
              },
            });
          };
        });
      }
      if (recordedAnswerExists) publishTaskStreamChanged();
      return {
        version: 'builder-generation-ipc-result.v1',
        ok: false,
        error: {
          code: 'builder_generation_structured_response_invalid',
          retryable: true,
        },
      };
    }
    if (options.deferredAnswer === true || (options.deferAnswerAfterFirst === true && answerAttempts > 1)) {
      return new Promise<unknown>((resolve) => {
        resolveAnswer = async () => {
          const result = await createGenerationAnswer(hostRequest);
          publishTaskStreamChanged();
          resolve({
            version: 'builder-generation-ipc-result.v1',
            ok: true,
            result,
          });
        };
      });
    }
    const result = await createGenerationAnswer(hostRequest);
    publishTaskStreamChanged();
    return {
      version: 'builder-generation-ipc-result.v1',
      ok: true,
      result,
    };
  });
  const answerPlan = vi.fn(async (request: unknown) => {
    const response = await answer(request, null) as { ok: boolean; result?: { explanation: string } };
    if (response.ok && response.result) completedAgentPlanMarkdown = response.result.explanation;
    return response;
  });
  const answerDraft = vi.fn(async (request: unknown) => {
    expect(request).toEqual({
      draft_id: latestDraft.draft_id,
      instruction: (request as { instruction: string }).instruction,
    });
    const instruction = (request as { instruction: string }).instruction;
    const hostRequest = await createBuilderGenerationRequest(instruction, selectedProjectId);
    return {
      version: 'builder-generation-ipc-result.v1',
      ok: true,
      result: await createGenerationAnswer(hostRequest),
    };
  });
  let submitAttempts = 0;
  const submit = vi.fn(async (request: unknown) => {
    submitAttempts += 1;
    const instruction = (request as { instruction: string }).instruction;
    const hostRequest = await hostRequestFor(request, instruction);
    if (options.briefUpdateActivity === true && /(?:我想|我要|我们要|希望|需要|保存这个方向|would like|want|save this|use this as)/iu.test(instruction)) {
      return {
        version: 'builder-generation-ipc-result.v1',
        ok: true,
        result: await createGenerationAnswer(hostRequest),
      };
    }
    if (/[?\uFF1F]\s*$/u.test(instruction)) {
      return {
        version: 'builder-generation-ipc-result.v1',
        ok: true,
        result: await createGenerationAnswer(hostRequest),
      };
    }
    if (options.failSubmitOnce === true && submitAttempts === 1) {
      return {
        version: 'builder-generation-ipc-result.v1',
        ok: false,
        error: {
          code: 'builder_generation_provider_http_error',
          retryable: true,
        },
      };
    }
    if (options.failGenerate === true) {
      return {
        version: 'builder-generation-ipc-result.v1',
        ok: false,
        error: {
          code: 'builder_generation_provider_http_error',
          retryable: true,
        },
      };
    }
    if (options.deferredGenerate === true) {
      return new Promise<unknown>((resolve) => {
        resolveGenerate = async () => {
          latestDraft = await createDraftForCurrentProject(hostRequest);
          resolve({
            version: 'builder-generation-ipc-result.v1',
            ok: true,
            result: latestDraft,
          });
        };
      });
    }
    latestDraft = await createDraftForCurrentProject(hostRequest);
    return {
      version: 'builder-generation-ipc-result.v1',
      ok: true,
      result: latestDraft,
    };
  });
  const saveDraft = vi.fn(async (request: unknown) => {
    expect(request).toEqual({ draft_id: latestDraft.draft_id });
    saved = true;
    return createSaveResult(latestDraft, readWire);
  });
  let restoreDraftAttempts = 0;
  const restoreDraft = vi.fn(async (request: unknown) => {
    restoreDraftAttempts += 1;
    const failedRestoreAttempts = options.failRestoreDraftAttempts ?? (options.failFirstRestoreDraft === true ? 1 : 0);
    if (options.restoreAvailable !== true || restoreDraftAttempts <= failedRestoreAttempts) {
      return {
        version: 'builder-generation-ipc-result.v1',
        ok: false,
        error: {
          code: 'builder_generation_parent_unavailable',
          retryable: true,
        },
      };
    }
    restoredDraft = options.workspaceOnlyCatalog === true && !saved
      ? await createRestoredDraftForUnsavedWorkspaceWire(readWire)
      : await createRestoredDraftForReadWire(readWire);
    expect(request).toEqual({ draft_id: restoredDraft.draft_id });
    return {
      version: 'builder-generation-ipc-result.v1',
      ok: true,
      result: restoredDraft,
    };
  });
  const restoreRevisionAsDraft = vi.fn(async (request: unknown) => {
    const revisionReceiptDigest = (request as { revision_receipt_digest: string }).revision_receipt_digest;
    expect((request as { project_id: string }).project_id).toBe(PROJECT_ID);
    const sourceTree = historicalWire !== null
      && revisionReceiptDigest === historicalWire.product_revision_receipt.revision_receipt_digest
      ? historicalWire.source_tree
      : readWire.source_tree;
    const hostRequest = await createBuilderGenerationRequest('Restore an earlier saved version.', PROJECT_ID);
    latestDraft = await createGenerationDraft(hostRequest, sourceTree);
    latestDraft = {
      ...latestDraft,
      base_revision_evidence: latestDraft.base_revision_evidence === null
        ? null
        : {
          ...latestDraft.base_revision_evidence,
          revision_receipt_digest: readWire.product_revision_receipt.revision_receipt_digest,
          commit_oid: readWire.product_revision_receipt.commit_oid,
          source_tree_digest: readWire.source_tree.source_tree_digest,
        },
    };
    return {
      version: 'builder-generation-ipc-result.v1',
      ok: true,
      result: latestDraft,
    };
  });
  const restorePreviousCheckpointAsDraft = vi.fn(async (request: unknown) => {
    expect(request).toEqual({ draft_id: latestDraft?.draft_id });
    return {
      version: 'builder-generation-ipc-result.v1',
      ok: true,
      result: latestDraft,
    };
  });
  const rejectDraft = vi.fn(async (request: unknown) => {
    expect(request).toEqual({ draft_id: latestDraft.draft_id });
    return {
      version: 'builder-generation-ipc-result.v1',
      ok: true,
      result: {
        result_version: 'builder-generation-draft-rejection-result.v1',
        draft_id: latestDraft.draft_id,
        project_id: PROJECT_ID,
        rejected: true,
        pending_draft_released: true,
        conversation_event_admission: 'sqlite_recorded',
      },
    };
  });
  const cancel = vi.fn(async (request: unknown) => ({
    request_id: (request as { request_id: string }).request_id,
    cancelled: true,
  }));
  const steer = vi.fn(async (request: unknown) => ({
    request_id: (request as { request_id: string }).request_id,
    steered: true,
  }));
  const queueFollowup = vi.fn(async (request: unknown) => ({
    request_id: (request as { request_id: string }).request_id,
    queued: options.failQueueFollowup === true ? false : true,
    queued_followup: options.failQueueFollowup === true
      ? null
      : {
        turn_id: TURN_ID,
        run_id: RUN_ID,
        message_id: 'builder-message:123e4567-e89b-42d3-a456-426614174088',
      },
  }));
  const reviewPlan = vi.fn(async (request: unknown) => {
    const result = {
      result_version: 'builder-conversation-plan-review-result.v1',
      ...(request as object),
      review_admission: 'sqlite_recorded_no_execution',
    };
    if (options.failPlanReview === true) throw new Error('plan review unavailable');
    if (options.deferredPlanReview === true) {
      return new Promise<unknown>((resolve) => {
        resolvePlanReview = async () => {
          planReviewRecorded = true;
          resolve(result);
        };
      });
    }
    planReviewRecorded = true;
    return result;
  });
  const generateApprovedPlan = vi.fn(async (request: unknown) => {
    expect(request).toEqual({
      project_id: PROJECT_ID,
      conversation_id: CONVERSATION_ID,
      turn_id: TURN_ID,
      run_id: RUN_ID,
    });
    approvedPlanGenerateAttempts += 1;
    if (options.failApprovedPlanGenerateOnce === true && approvedPlanGenerateAttempts === 1) {
      return {
        version: 'builder-generation-ipc-result.v1',
        ok: false,
        error: {
          code: 'builder_generation_provider_http_error',
          retryable: true,
        },
      };
    }
    const hostRequest = await createBuilderGenerationRequest('Review the approved plan.', PROJECT_ID);
    if (options.deferredApprovedPlanGenerate === true) {
      return new Promise<unknown>((resolve) => {
        resolveGenerate = async () => {
          latestDraft = await createDraftForCurrentProject(hostRequest);
          resolve({
            version: 'builder-generation-ipc-result.v1',
            ok: true,
            result: latestDraft,
          });
        };
      });
    }
    latestDraft = await createDraftForCurrentProject(hostRequest);
    return {
      version: 'builder-generation-ipc-result.v1',
      ok: true,
      result: latestDraft,
    };
  });
  const proposePlan = vi.fn(async (request: unknown) => {
    const instruction = (request as { instruction: string }).instruction;
    const hostRequest = await hostRequestFor(request, instruction, PROJECT_ID);
    const result = {
      version: 'builder-generation-ipc-result.v1',
      ok: true,
      result: {
        version: 'builder-generation-result.v2',
        result_kind: 'plan',
        request_id: hostRequest.request_digest,
        project_id: PROJECT_ID,
        existing_project_id: PROJECT_ID,
        title: 'Project update plan',
        summary: 'Review the saved project before editing.',
        steps: [
          {
            title: 'Review current files',
            purpose: 'Understand the saved project before editing.',
            expected_change: 'No files change in this step.',
            status: 'proposed',
          },
        ],
        admissions: {
          conversation: 'sqlite_recorded',
          draft: 'not_created',
          save: 'not_performed',
          preview: 'not_applicable',
          execution: 'not_evaluated',
          revision: 'not_created',
          review: 'not_recorded',
        },
        conversation_head: {
          sequence: 3,
          event_id: `builder-conversation-event:${'1'.repeat(64)}`,
          event_digest: `sha256:${'2'.repeat(64)}`,
        },
      },
    };
    if (options.deferredPlanProposal === true) {
      return new Promise<unknown>((resolve) => {
        resolvePlanProposal = async () => {
          resolve(result);
        };
      });
    }
    return result;
  });
  const preparePlanSourceReadApproval = vi.fn(async (request: unknown) => {
    if (options.failPlanSourceReadApprovalPrepare === true) throw new Error('approval prepare unavailable');
    return {
      version: 'builder-generation-ipc-result.v1',
      ok: true,
      result: {
        result_version: 'builder-plan-source-read-approval-status.v1',
        project_id: (request as { project_id: string }).project_id,
        state: options.planSourceReadApprovalRequired === true ? 'approval_required' : 'ready',
        file_count: 3,
        approval_scope: 'current_project_plan_source_read',
        authority: 'main_selected_project_bounded_filesystem_read_v1',
      },
    };
  });
  const approvePlanSourceRead = vi.fn(async (request: unknown) => {
    if (options.failPlanSourceReadApproval === true) throw new Error('approval unavailable');
    return {
      version: 'builder-generation-ipc-result.v1',
      ok: true,
      result: {
        result_version: 'builder-plan-source-read-approval-result.v1',
        project_id: (request as { project_id: string }).project_id,
        operation: 'approval_recorded',
        file_count: 3,
        approval_scope: 'current_project_plan_source_read',
        authority: 'main_selected_project_bounded_filesystem_read_v1',
      },
    };
  });
  const prepareCurrentProjectWriteApproval = vi.fn(async (request: unknown) => ({
    version: 'builder-generation-ipc-result.v1',
    ok: true,
    result: {
      result_version: 'builder-current-project-write-approval-status.v1',
      project_id: (request as { project_id: string }).project_id,
      state: currentProjectWriteAllowed ? 'ready' : 'approval_required',
      approval_scope: 'current_project_write',
      authority: 'main_selected_project_project_edit_v1',
    },
  }));
  const approveCurrentProjectWrite = vi.fn(async (request: unknown) => {
    if (options.failCurrentProjectWriteApproval === true) throw new Error('approval unavailable');
    currentProjectWriteAllowed = true;
    return {
      version: 'builder-generation-ipc-result.v1',
      ok: true,
      result: {
        result_version: 'builder-current-project-write-approval-result.v1',
        project_id: (request as { project_id: string }).project_id,
        operation: 'approval_recorded',
        approval_scope: 'current_project_write',
        authority: 'main_selected_project_project_edit_v1',
      },
    };
  });
  const approveCurrentProviderContextDisclosure = vi.fn(async (request: unknown) => ({
    result_version: 'builder-provider-context-disclosure-current-approval-gate.v1',
    project_id: (request as { project_id: string }).project_id,
    conversation_id: (request as { conversation_id: string }).conversation_id,
    operation: 'approval_recorded',
    approval_scope: 'configured_provider_purpose',
    provider_scope: 'configured_provider',
    purpose: 'contextual_build',
    authority: {
      current_approval_gate: 'main_owned_current_disclosure_preparation_gate_v1',
      status_service: 'main_only_in_memory_preparation_reader',
      approval_service: 'main_owned_prepared_disclosure_request_approval_v1',
      renderer_authority: 'not_accepted',
      provider_context_body: 'not_present',
      provider_dispatch: false,
      prompt_bridge: false,
      tool_dispatch: false,
      source_read: 'not_performed',
      source_write: 'not_performed',
      git_mutation: false,
      sqlite_write: false,
      revision_admission: 'not_created',
      ipc_registration: 'not_performed',
      preload_exposure: false,
    },
  }));
  const loadCurrent = vi.fn(async () => readWire);
  let loadRevisionCalls = 0;
  let taskStreamReadAttempts = 0;
  const generationStartedListeners = new Set<(event: unknown) => void>();
  const generationOutputListeners = new Set<(event: unknown) => void>();
  const commandApprovalListeners = new Set<(event: unknown) => void>();
  const commandOutputListeners = new Set<(event: unknown) => void>();
  const workbenchChangedListeners = new Set<(event: unknown) => void>();
  const readTaskStream = vi.fn(async (request: { agent_id: string } | {
    project_id: string;
    task_address_id: string;
  }) => {
    if ('project_id' in request) taskStreamReadAttempts += 1;
    if (
      'project_id' in request
      && taskStreamReadAttempts <= (options.failTaskStreamReadAttempts ?? 0)
    ) {
      throw new Error('activity temporarily unavailable');
    }
    if (options.failTaskStreamAfterPlanReview === true && planReviewRecorded) {
      throw new Error('activity unavailable');
    }
    if (
      'agent_id' in request
      && answerAttempts === 0
      && options.taskStreamWireOverride === undefined
    ) {
      return asAgentConversationWire({ conversation: null }, request.agent_id);
    }
    if (
      options.uncheckedUntilSkip === true
      && (submit.mock.calls.length > 0 || generate.mock.calls.length > 0)
    ) {
      return skipCurrentDraftCheck.mock.calls.length > 0
        ? reviewReadyTaskStreamWire()
        : uncheckedReviewTaskStreamWire();
    }
    if (
      options.checkRunAvailable === true
      && (submit.mock.calls.length > 0 || generate.mock.calls.length > 0)
    ) return options.dependencyBlockedCheck === true
      && !(options.dependencyBlockedUntilPreparation === true
        && decideCurrentDraftDependencyPreparation.mock.calls.length > 0)
      ? dependencyBlockedReviewTaskStreamWire()
      : checkedReviewTaskStreamWire();
    const wire = completedAgentPlanMarkdown !== null && 'agent_id' in request
      ? createAnswerTaskStreamWire({
        questionText: latestAnswerInstruction ?? 'Plan',
        answerText: completedAgentPlanMarkdown,
      })
      : options.planAfterPropose === true && proposePlan.mock.calls.length > 0
      ? createPlanTaskStreamWire()
      : options.rejectedPlanActivity === true
        ? createPlanReviewTaskStreamWire('rejected')
      : options.pendingPlanActivity === true && planReviewRecorded
        ? createPlanReviewTaskStreamWire('approved')
        : options.pendingPlanActivity === true
          ? createPlanTaskStreamWire()
          : options.pendingBuildConfirmationActivity === true
            ? pendingBuildConfirmationTaskStreamWire()
            : options.pendingActivityAfterSave === true && saveDraft.mock.calls.length > 0
              ? pendingCandidateTaskStreamWire('proposed')
            : options.rejectActivityAfterDiscard === true && rejectDraft.mock.calls.length > 0
            ? createRejectedTaskStreamWire()
            : options.briefUpdateActivity === true && (
              submit.mock.calls.length > 0
              || (latestAnswerInstruction !== null
                && /(?:我想|我要|我们要|希望|需要|保存这个方向|would like|want|save this|use this as)/iu
                  .test(latestAnswerInstruction))
            )
              ? createContextualBuildTaskStreamWire()
            : options.consecutiveAnswerActivity === true
              && answerAttempts > 1
              && answerInstructions.length > 1
              ? createTwoAnswerTaskStreamWire({
                firstQuestionText: answerInstructions[0],
                secondAnswerText: 'This is the second read-only answer.',
                secondQuestionText: answerInstructions.at(-1) ?? 'What did I just ask?',
              })
            : options.consecutiveAnswerActivity === true
              && answerAttempts > 0
              && latestAnswerInstruction !== null
              ? createAnswerTaskStreamWire({
                questionText: latestAnswerInstruction,
              })
            : options.recordedAnswerAfterFailedPublicResult === true
              && options.failAnswerAfterFirst === true
              && answerAttempts > 1
              && latestAnswerInstruction !== null
              ? createTwoAnswerTaskStreamWire({
                firstQuestionText: 'hi',
                secondAnswerText: '我是由深度求索（DeepSeek）公司创造的 DeepSeek 模型。',
                secondQuestionText: latestAnswerInstruction,
              })
            : options.recordedFirstAnswerAfterFailedPublicResult === true
              && options.failFirstAnswer === true
              && answerAttempts > 0
              && latestAnswerInstruction !== null
              ? createAnswerTaskStreamWire({
                answerText: '我是DeepSeek最新版本模型，由深度求索公司创造。我可以回答问题、提供建议、协助创作等。',
                questionText: latestAnswerInstruction,
              })
            : options.taskStreamWireOverride !== undefined
              ? options.taskStreamWireOverride
            : options.answerActivity === true
              ? createAnswerTaskStreamWire()
              : options.readOnlyPageQuestionActivity === true
                ? createReadOnlyPageQuestionTaskStreamWire()
              : options.contextualBuildActivity === true
                ? createContextualBuildTaskStreamWire()
                : options.staleActivityBeforePendingRestore === true
                  ? taskStreamReadAttempts <= (options.staleActivityReadAttemptsBeforePendingRestore ?? 1)
                    ? reviewReadyTaskStreamWire()
                    : pendingCandidateTaskStreamWire('proposed')
                : options.supersededAcceptedPendingActivity === true
                  ? acceptedCandidateAfterSupersededCandidateTaskStreamWire()
                : options.acceptedPendingActivity === true
                ? pendingCandidateTaskStreamWire('accepted')
                : options.rejectedPendingActivity === true
                  ? pendingCandidateTaskStreamWire('rejected')
                  : options.pendingAfterRevisionView === true && loadRevisionCalls > 0
                    ? pendingCandidateTaskStreamWire('proposed')
                    : options.runningActivity === true
                      ? runningTaskStreamWire(
                        queueFollowup.mock.calls.length > 0
                          ? ((queueFollowup.mock.calls.at(-1)?.[0] as { message?: string } | undefined)?.message)
                          : undefined,
                      )
                      : options.pendingActivity === true
                        ? pendingCandidateTaskStreamWire('proposed')
                        : reviewReadyTaskStreamWire();
    if (!('agent_id' in request)) return wire;
    const agentWire = asAgentConversationWire(wire, request.agent_id);
    if (options.retainedIncompleteAnswer && answerAttempts > 1) {
      const retained = agentWire.conversation?.items.filter((item) => item.role === 'assistant').at(-1);
      if (retained) retained.message_kind = 'incomplete_result';
    }
    return agentWire;
  });
  const readAgentWorkbench = vi.fn(async (request: {
    agent_id: string;
    after_cursor: string | null;
    limit: number;
  }) => {
    const stream = await readTaskStream({ agent_id: request.agent_id }) as {
      conversation: null | {
        created_at_ms: number;
        items: Array<{
          item_kind: string;
          message: { message_id: string; text: string };
          role: 'user' | 'assistant';
          sequence: number;
        }>;
      };
    };
    const conversation = stream.conversation;
    const items = conversation === null ? [] : conversation.items
      .filter((item) => item.item_kind === 'transcript_message')
      .map((item) => ({
        message_id: item.message.message_id,
        thread_id: 'builder-workbench-thread:123e4567-e89b-42d3-a456-426614174000',
        presentation_family: 'conversation',
        content_type: item.role === 'user'
          ? 'builder.chat.user_message.v1'
          : 'builder.chat.agent_message.v1',
        source_label: item.role === 'user' ? 'You' : 'Agent',
        fallback_text: item.message.text,
        presentation: {
          presentation_version: 'builder-workbench-declarative-presentation.v1',
          body_kind: item.role === 'user' ? 'plain_text' : 'markdown',
          body_text: item.message.text,
          metadata: [],
        },
        attention: 'normal',
        trust_label: 'local',
        state: { unread: item.role === 'assistant', acknowledged: false, archived: false },
        actions: [],
        task_ref: null,
        created_at_ms: (conversation?.created_at_ms ?? 0) + item.sequence,
      }));
    const proposalMaterialized = decideTaskProposal.mock.calls.length > 0;
    const pendingProposalItem = {
      message_id: 'builder-message:123e4567-e89b-42d3-a456-426614174097',
      thread_id: null,
      presentation_family: 'proposal',
      content_type: 'builder.task.proposal.v1',
      source_label: 'Builder',
      fallback_text: 'Task proposal',
      presentation: {
        presentation_version: 'builder-workbench-declarative-presentation.v1',
        body_kind: 'markdown',
        body_text: 'Task proposal',
        metadata: [],
      },
      attention: 'action_required',
      trust_label: 'local',
      state: { unread: true, acknowledged: false, archived: false },
      task_ref: null,
      actions: [{
        action_version: 'builder-workbench-task-proposal-action.v1',
        action_id: 'builder-workbench-action:123e4567e89b42d3a456426614174097123e4567e89b42d3a456426614174097',
        proposal_id: 'builder-task-proposal:123e4567-e89b-42d3-a456-426614174097',
        status: proposalMaterialized ? 'materialized' : 'pending',
        objective: '按这个计划创建一个专注计时器：先写 index.html，再运行检查。',
        requested_outcome: 'build',
        execution_mode: 'foreground',
        project_id: proposalMaterialized ? PROJECT_ID : null,
        task_address_id: proposalMaterialized ? MATERIALIZED_TASK_ADDRESS_ID : null,
        conversation_id: proposalMaterialized ? CONVERSATION_ID : null,
        operations: proposalMaterialized ? ['open_task'] : ['approve_existing_project', 'reject'],
      }],
      created_at_ms: (conversation?.created_at_ms ?? 0) + 90,
    };
    const workbenchItems = options.agentTaskReturn === true
      ? [...items, {
          message_id: 'builder-message:123e4567-e89b-42d3-a456-426614174099',
          thread_id: null,
          presentation_family: 'result',
          content_type: 'builder.task.result.v1',
          source_label: 'Builder',
          fallback_text: 'Changes are ready for review.',
          presentation: {
            presentation_version: 'builder-workbench-declarative-presentation.v1',
            body_kind: 'markdown',
            body_text: 'Changes are ready for review.',
            metadata: [],
          },
          attention: 'normal',
          trust_label: 'local',
          state: { unread: true, acknowledged: false, archived: false },
          actions: [],
          task_ref: {
            project_id: PROJECT_ID,
            task_address_id: TASK_ADDRESS_ID,
            operation: 'open_task',
          },
          created_at_ms: (conversation?.created_at_ms ?? 0) + 100,
        }]
      : (options.agentTaskProposalPending === true ? [...items, pendingProposalItem] : items);
    return {
      projection_version: 'builder-agent-workbench-projection.v2',
      agent_id: request.agent_id,
      agent_plan: completedAgentPlanMarkdown === null ? null : {
        status: 'ready',
        artifact: {
          artifact_version: 'builder-agent-plan-artifact.v1',
          content_digest: `sha256:${'d'.repeat(64)}`,
          agent_plan_id: 'builder-agent-plan:123e4567-e89b-42d3-a456-426614174030',
          agent_id: request.agent_id,
          source_conversation_id: `builder-agent-conversation:${request.agent_id.slice('builder-agent:'.length)}`,
          source_turn_id: TURN_ID,
          source_run_id: RUN_ID,
          source_message_id: items.filter((item) => item.content_type === 'builder.chat.agent_message.v1').at(-1)!.message_id,
          version: 1,
          markdown: completedAgentPlanMarkdown,
          state: 'proposed',
          created_at_ms: 5,
        },
        decision: null,
      },
      stream: {
        items: workbenchItems,
        after_cursor: request.after_cursor,
        next_cursor: workbenchItems.length === 0
          ? null
          : `builder-workbench-cursor:${workbenchItems.length}`,
        has_more: false,
      },
      task_monitor: {
        projection_version: 'builder-workbench-task-monitor.v2',
        agent_id: request.agent_id,
        tasks: options.agentTaskReturn === true ? [{
          task_address_id: TASK_ADDRESS_ID,
          project_id: PROJECT_ID,
          conversation_id: CONVERSATION_ID,
          title: 'Review changes',
          goal: 'Review the pending draft.',
          group: 'attention',
          state: 'waiting_review',
          status_label: 'Review changes',
          latest_activity_at_ms: 100,
          latest_result: null,
          attention: null,
          operations: ['open_task'],
        }] : [],
        counts: options.agentTaskReturn === true
          ? { active: 0, attention: 1, recent: 0 }
          : { active: 0, attention: 0, recent: 0 },
        authority: {
          task_identity: 'main_owned_session_task_address_store',
          task_state: 'sqlite_canonical_event_replay_plus_task_attention',
          renderer_authority: 'selection_only',
          provider_dispatch: false,
          permission_grant: false,
          source_read: false,
          source_write: false,
        },
      },
      inbox: {
        unread_count: items.filter((item: { state: { unread: boolean } }) => item.state.unread).length,
        action_required_count: 0,
        mention_count: 0,
        active_task_count: 0,
      },
      authority: {
        canonical_messages: 'main_owned_workbench_message_store',
        user_state: 'main_owned_workbench_message_state_store',
        task_state: 'sqlite_canonical_event_replay_plus_task_attention',
        renderer_authority: 'selection_and_bounded_state_requests_only',
        plugin_payload_exposure: 'not_exposed',
        permission_grant: false,
        provider_dispatch: false,
        source_read: false,
        source_write: false,
      },
    };
  });
  const open = vi.fn(async (request: { project_id: string | null }) => {
    selectedProjectId = request.project_id;
    if (request.project_id === null) {
      return {
        result_version: 'builder-project-selection-result.v1',
        operation: 'new_selected',
        project_id: null,
      };
    }
    if ((options.workspaceOnlyCatalog === true || options.multipleWorkspaceOnlyCatalog === true) && !saved) {
      return {
        result_version: 'builder-project-selection-result.v1',
        operation: 'local_project_bound',
        project_id: request.project_id,
        project_title: 'Unsaved dashboard',
        source_folders: [{
          name: 'site-source',
          status: 'selected',
        }],
      };
    }
    return readWire;
  });
  const createLocalProject = vi.fn(async (request: Readonly<{ project_id: string | null; project_title: string }>) => {
    const projectId = request.project_id ?? PROJECT_ID;
    selectedProjectId = projectId;
    return {
      result_version: 'builder-project-selection-result.v1',
      operation: 'local_project_bound',
      project_id: projectId,
      project_title: request.project_title,
      source_folders: [
        {
          name: 'focus-timer',
          status: 'selected',
        },
      ],
    };
  });
  const openLocation = vi.fn(async (request: Readonly<{ project_id: string }>) => ({
    result_version: 'builder-project-location-open-result.v1',
    project_id: request.project_id,
    opened: true,
  }));
  const listCurrent = vi.fn(async () => (
    saved ? catalogWire : { ...catalogWire, projects: [] }
  ));
  const listWorkspaces = vi.fn(async () => createWorkspaceCatalogWire(
    options.multipleWorkspaceOnlyCatalog === true
      ? [
        {
          project_id: PROJECT_ID,
          title: 'Unsaved dashboard',
          source_folders: [{ name: 'site-source', status: 'selected' }],
          bound_at_ms: 20,
          has_current_revision: false,
          current_revision_number: 0,
        },
        {
          project_id: 'builder-project:22222222-2222-4222-8222-222222222222',
          title: 'Second unsaved dashboard',
          source_folders: [{ name: 'second-source', status: 'selected' }],
          bound_at_ms: 10,
          has_current_revision: false,
          current_revision_number: 0,
        },
      ]
      : options.workspaceOnlyCatalog === true
      ? [{
        project_id: PROJECT_ID,
        title: 'Unsaved dashboard',
        source_folders: [{ name: 'site-source', status: 'selected' }],
        bound_at_ms: 20,
        has_current_revision: false,
        current_revision_number: 0,
      }]
      : [],
  ));
  const listHistory = vi.fn(async (request: unknown) => (
    options.validHistoryPreview === true && historicalWire !== null
      ? createValidHistoryWire((request as { project_id: string }).project_id, readWire, historicalWire)
      : createHistoryWire((request as { project_id: string }).project_id, 1)
  ));
  const loadRevision = vi.fn(async (request: unknown) => {
    loadRevisionCalls += 1;
    if (options.validHistoryPreview === true && historicalWire !== null) {
      const revisionReceiptDigest = (request as { revision_receipt_digest: string }).revision_receipt_digest;
      if (revisionReceiptDigest === historicalWire.product_revision_receipt.revision_receipt_digest) {
        return {
          ...historicalWire,
          operation: 'revision_loaded',
          current: readWire.current,
        };
      }
    }
    return {
      ...readWire,
      operation: 'revision_loaded',
      current: readWire.current,
    };
  });
  const classifyIntent = vi.fn(async () => ({
    version: 'builder-generation-ipc-result.v1',
    ok: true,
    result: {
      result_version: 'builder-semantic-route-classification.v1',
      request_digest: `sha256:${'a'.repeat(64)}`,
      route: options.semanticIntentRoute,
      confidence: 'high',
      needs_confirmation: false,
      reason_code: options.semanticIntentRoute === 'plan'
        ? 'requests_plan_or_proposal'
        : options.semanticIntentRoute === 'build'
          ? 'requests_source_change'
          : 'asks_to_discuss_or_refine',
      matched_signal: 'semantic_route',
      authority: {
        classifier: 'main_owned_provider_semantic_route_v1',
        context_scope: 'current_instruction_and_bounded_product_state',
        conversation_text: 'not_disclosed',
        working_brief_text: 'not_disclosed',
        source_read: 'not_performed',
        source_write: 'not_performed',
        tool_dispatch: false,
        command_execution: false,
        permission_grant: false,
        git_mutation: false,
        sqlite_write: false,
        save_admission: false,
      },
    },
  }));
  const projectedTask = (
    taskAddressId = TASK_ADDRESS_ID,
    sessionId = SESSION_ID,
    title = 'Create Builder project',
  ) => ({
    task_address_id: taskAddressId,
    task_id: taskAddressId,
    session_id: sessionId,
    conversation_id: CONVERSATION_ID,
    project_id: PROJECT_ID,
    agent_id: AGENT_ID,
    title,
    goal: 'Create and improve the current project.',
    status: 'active' as const,
    current_plan_id: null,
    has_unreviewed_draft: false,
    needs_permission: false,
    latest_activity_at_ms: 30,
  });
  const workRequests = () => [
    ...submit.mock.calls,
    ...generate.mock.calls,
    ...proposePlan.mock.calls,
  ];
  const hasNewlyMaterializedTask = () => workRequests().some((call) => (
    (call[0] as { task_address_id?: string | null } | undefined)?.task_address_id === null
  ));
  const projectedTasks = () => {
    const newlyMaterialized = hasNewlyMaterializedTask()
      ? [projectedTask(
        MATERIALIZED_TASK_ADDRESS_ID,
        MATERIALIZED_SESSION_ID,
        'New Builder task',
      )]
      : [];
    return saved ? [...newlyMaterialized, projectedTask()] : newlyMaterialized;
  };
  const readAgentProjectTree = vi.fn(async () => {
    if (options.hangAgentProjectTreeAfterPlan === true && proposePlan.mock.calls.length > 0) {
      return await new Promise<never>(() => undefined);
    }
    const savedProject = saved ? catalogWire.projects[0] : null;
    const workspaceHasPersistedTask = options.workspaceOnlyCatalog === true && (
      options.pendingActivity === true
      || options.pendingAfterRevisionView === true
      || options.acceptedPendingActivity === true
      || options.supersededAcceptedPendingActivity === true
      || options.rejectedPendingActivity === true
      || options.runningActivity === true
      || options.restoreAvailable === true
      || options.staleActivityBeforePendingRestore === true
      || options.pendingPlanActivity === true
      || options.rejectedPlanActivity === true
    );
    const workspaceTasks = projectedTasks().length > 0
      ? projectedTasks()
      : (workspaceHasPersistedTask ? [projectedTask()] : []);
    const workspaceProject = !saved && (
      options.workspaceOnlyCatalog === true
      || selectedProjectId === PROJECT_ID
    )
      ? {
        project_id: PROJECT_ID,
        title: 'Unsaved dashboard',
        summary: 'Local project in site-source',
        source_boundary_label: 'Source folder: site-source',
        revision_number: null,
        status: 'workspace' as const,
        task_count: workspaceTasks.length,
        active_task_count: workspaceTasks.length,
        latest_activity_at_ms: 20,
        tasks: workspaceTasks,
      }
      : null;
    const projects = savedProject === null
      ? (workspaceProject === null ? [] : [workspaceProject])
      : [{
        project_id: savedProject.project_id,
        title: savedProject.title,
        summary: savedProject.summary,
        source_boundary_label: null,
        revision_number: savedProject.revision_number,
        status: 'saved' as const,
        task_count: projectedTasks().length,
        active_task_count: projectedTasks().length,
        latest_activity_at_ms: savedProject.selected_at_ms,
        tasks: projectedTasks(),
      }];
    return {
      projection_version: 'agent-project-tree-projection.v1',
      agent_id: AGENT_ID,
      agent: {
        display_name: 'Builder',
        purpose: 'Plan, build, review, and maintain local projects.',
        lifecycle_status: 'active',
        agent_version_id: `builder-agent-version:${'a'.repeat(64)}`,
        version_number: 1,
      },
      projects,
      orphaned_tasks: projects.length === 0 ? projectedTasks() : [],
      authority: {
        agent_identity: 'main_owned_agent_definition_store',
        project_catalog: 'main_owned_project_authorities',
        project_lifecycle: 'main_owned_project_lifecycle_store',
        task_identity: 'main_owned_session_task_address_store',
        renderer_authority: 'selection_only',
        permission_grant: false,
        source_read: false,
        source_write: false,
        git_mutation: false,
        provider_dispatch: false,
      },
    };
  });
  const createTaskProposal = vi.fn(async (request: unknown) => {
    if (options.agentTaskIncubation !== true) throw new Error('task incubation unavailable');
    return { operation: 'proposal_created', request };
  });
  const decideTaskProposal = vi.fn(async (request: unknown) => {
    if (options.agentTaskProposalMaterializes === true) {
      const proposalId = (request as { proposal_id: string }).proposal_id;
      return {
        status: 'ready',
        projection: {
          projection_version: 'builder-agent-workbench-projection.v2',
          agent_id: AGENT_ID,
          stream: {
            items: [{
              message_id: 'builder-message:123e4567-e89b-42d3-a456-426614174098',
              thread_id: null,
              presentation_family: 'proposal',
              content_type: 'builder.task.proposal.v1',
              source_label: 'Builder',
              fallback_text: 'Task proposal materialized.',
              presentation: {
                presentation_version: 'builder-workbench-declarative-presentation.v1',
                body_kind: 'markdown',
                body_text: 'Task proposal materialized.',
                metadata: [],
              },
              attention: 'normal',
              trust_label: 'local',
              state: { unread: false, acknowledged: true, archived: false },
              task_ref: null,
              actions: [{
                action_version: 'builder-workbench-task-proposal-action.v1',
                action_id: 'builder-workbench-action:123e4567e89b42d3a456426614174098123e4567e89b42d3a456426614174098',
                proposal_id: proposalId,
                status: 'materialized',
                objective: '按这个计划创建一个专注计时器：先写 index.html，再运行检查。',
                requested_outcome: 'build',
                execution_mode: 'foreground',
                project_id: PROJECT_ID,
                task_address_id: MATERIALIZED_TASK_ADDRESS_ID,
                conversation_id: CONVERSATION_ID,
                operations: ['open_task'],
              }],
              created_at_ms: 30,
            }],
            after_cursor: null,
            next_cursor: 'builder-workbench-cursor:1',
            has_more: false,
          },
          task_monitor: {
            projection_version: 'builder-workbench-task-monitor.v2',
            agent_id: AGENT_ID,
            tasks: [],
            counts: { active: 0, attention: 0, recent: 0 },
            authority: {
              task_identity: 'main_owned_session_task_address_store',
              task_state: 'sqlite_canonical_event_replay_plus_task_attention',
              renderer_authority: 'selection_only',
              provider_dispatch: false,
              permission_grant: false,
              source_read: false,
              source_write: false,
            },
          },
          inbox: { unread_count: 0, action_required_count: 0, mention_count: 0, active_task_count: 0 },
          authority: {
            canonical_messages: 'main_owned_workbench_message_store',
            user_state: 'main_owned_workbench_message_state_store',
            task_state: 'sqlite_canonical_event_replay_plus_task_attention',
            renderer_authority: 'selection_and_bounded_state_requests_only',
            plugin_payload_exposure: 'not_exposed',
            permission_grant: false,
            provider_dispatch: false,
            source_read: false,
            source_write: false,
          },
        },
      };
    }
    return {
      operation: 'proposal_rejected',
      request,
    };
  });
  const decideCommandApproval = vi.fn(async () => ({
    version: 'builder-generation-ipc-result.v1',
    ok: true,
    result: {
      result_version: 'builder-controlled-command-approval-decision-result.v1',
      operation: 'command_approval_decided',
    },
  }));
  const exportTaskTranscript = vi.fn(async (request: unknown) => createTaskTranscriptExportWire(
    (request as { task_address_id?: string }).task_address_id ?? TASK_ADDRESS_ID,
  ));
  const userWebStatus = () => ({
    status_version: 'builder-user-web-status.v1' as const,
    status: 'idle' as const,
    current_url: null,
    can_go_back: false,
    can_go_forward: false,
    can_reload: false,
    can_stop: false,
    navigation_block_count: 0,
    permission_block_count: 0,
    download_block_count: 0,
    window_open_block_count: 0,
    message: 'Enter a URL to browse.',
    updated_at_ms: 0,
    authority: {
      user_web_authority: 'builder_main_user_web_v1' as const,
      renderer_authority: 'explicit_navigation_and_layout_only' as const,
      provider_authority: 'none' as const,
      provider_observation: false as const,
      command_execution: false as const,
      dependency_installation: false as const,
      project_write: false as const,
      downloads: 'blocked_pending_separate_admission' as const,
      permissions: 'denied' as const,
      popup_windows: 'blocked' as const,
      partition_visibility: 'main_private' as const,
    },
  });
  const bridge: BuilderDesktopBridgeRoot = {
    bridgeVersion: BUILDER_DESKTOP_BRIDGE_VERSION,
    agentProjectTree: {
      read: readAgentProjectTree,
      renameProject: vi.fn(async (request: unknown) => ({ operation: 'project_renamed', request })),
      archiveProject: vi.fn(async (request: unknown) => ({ operation: 'project_archived', request })),
      renameTask: vi.fn(async (request: unknown) => ({ operation: 'task_address_renamed', request })),
      archiveTask: vi.fn(async (request: unknown) => ({ operation: 'task_address_archived', request })),
      exportTaskTranscript,
    },
    agentWorkbench: {
      read: readAgentWorkbench,
      updateMessageState: vi.fn(async () => ({ operation: 'message_state_updated' })),
      createTaskProposal,
      decideTaskProposal,
      decideAgentPlan: vi.fn(async () => ({ operation: 'decision_recorded' })),
      controlTask: vi.fn(async () => ({ operation: 'task_not_active' })),
      subscribeChanged(listener: (event: unknown) => void) {
        workbenchChangedListeners.add(listener);
        return () => { workbenchChangedListeners.delete(listener); };
      },
    },
    codeGenerator: {
      ...(options.semanticIntentRoute === undefined ? {} : { classifyIntent }),
      submit,
      generate,
      resumeInterruptedRun,
      continueDraft,
      generateApprovedPlan,
      proposePlan,
      preparePlanSourceReadApproval,
      approvePlanSourceRead,
      prepareCurrentProjectWriteApproval,
      approveCurrentProjectWrite,
      retry,
      answer,
      answerPlan,
      answerDraft,
      restoreDraft,
      restoreRevisionAsDraft,
      restorePreviousCheckpointAsDraft,
      rejectDraft,
      cancel,
      steer,
      queueFollowup,
      availability: async () => null,
      subscribeStarted(listener: (event: unknown) => void) {
        generationStartedListeners.add(listener);
        return () => {
          generationStartedListeners.delete(listener);
        };
      },
      subscribeOutput(listener: (event: unknown) => void) {
        generationOutputListeners.add(listener);
        return () => {
          generationOutputListeners.delete(listener);
        };
      },
      decideCommandApproval,
      subscribeCommandApproval(listener: (event: unknown) => void) {
        commandApprovalListeners.add(listener);
        return () => { commandApprovalListeners.delete(listener); };
      },
      subscribeCommandOutput(listener: (event: unknown) => void) {
        commandOutputListeners.add(listener);
        return () => { commandOutputListeners.delete(listener); };
      },
    },
    projectWorkspace: {
      open,
      openLocation,
      createLocalProject,
      saveDraft,
      loadCurrent,
      loadRevision,
      listCurrent,
      listWorkspaces,
      listHistory,
    },
    providerSettings: {},
    permissions: {},
    planReview: {
      review: reviewPlan,
    },
    providerContextDisclosureApproval: {
      approveCurrent: approveCurrentProviderContextDisclosure,
    },
    checkRun: {
      readCurrentDraftAvailableChecks,
      diagnoseCurrentDraftCheckEnvironment,
      diagnoseProjectEnvironment,
      prepareProjectDependencies,
      approveAndRunCurrentDraftCheck,
      decideCurrentDraftDependencyPreparation,
      skipCurrentDraftCheck,
    },
    livePreview: {
      requestCurrentDraftPreview: async (request: unknown) => ({
        status_version: 'builder-live-preview-status-projection.v1',
        project_id: (request as { project_id: string }).project_id,
        conversation_id: (request as { conversation_id: string }).conversation_id,
        preview_kind: 'live_static_web',
        entry_url: null,
        status: 'unavailable',
        can_start: false,
        can_reload: false,
        can_stop: false,
        blocked_request_count: 0,
        navigation_block_count: 0,
        network_block_count: 0,
        permission_block_count: 0,
        download_block_count: 0,
        window_open_block_count: 0,
        message: 'Live preview is unavailable until a main-owned preview source resolver is connected.',
        unavailable_reason: 'preview_source_resolver_not_connected',
        dev_server_approval: null,
        runtime_launch_projection: livePreviewRuntimeLaunchProjection(request),
        updated_at_ms: 10,
        authority: {
          live_preview_authority: 'main_owned_live_preview_ipc_adapter_v1',
          renderer_authority: 'current_project_conversation_only',
          active_renderer_required: true,
          source_tree_from_renderer: 'not_accepted',
          source_read: 'main_owned_preview_source_resolver_or_not_performed',
          source_write: 'not_performed',
          provider_dispatch: false,
          tool_dispatch: false,
          command_execution: false,
          git_mutation: false,
          sqlite_write: false,
          permission_grant: false,
          revision_admission: false,
          save_admission: false,
          electron_view_attachment: 'main_only_not_exposed_to_renderer',
          preview_content_ipc: false,
          node_integration: false,
          preload: false,
        },
      }),
      reloadCurrentPreview: async (request: unknown) => ({
        status_version: 'builder-live-preview-status-projection.v1',
        project_id: (request as { project_id: string }).project_id,
        conversation_id: (request as { conversation_id: string }).conversation_id,
        preview_kind: 'live_static_web',
        entry_url: null,
        status: 'unavailable',
        can_start: false,
        can_reload: false,
        can_stop: false,
        blocked_request_count: 0,
        navigation_block_count: 0,
        network_block_count: 0,
        permission_block_count: 0,
        download_block_count: 0,
        window_open_block_count: 0,
        message: 'Live preview is unavailable until a main-owned preview source resolver is connected.',
        unavailable_reason: 'preview_source_resolver_not_connected',
        dev_server_approval: null,
        runtime_launch_projection: livePreviewRuntimeLaunchProjection(request),
        updated_at_ms: 10,
        authority: {
          live_preview_authority: 'main_owned_live_preview_ipc_adapter_v1',
          renderer_authority: 'current_project_conversation_only',
          active_renderer_required: true,
          source_tree_from_renderer: 'not_accepted',
          source_read: 'main_owned_preview_source_resolver_or_not_performed',
          source_write: 'not_performed',
          provider_dispatch: false,
          tool_dispatch: false,
          command_execution: false,
          git_mutation: false,
          sqlite_write: false,
          permission_grant: false,
          revision_admission: false,
          save_admission: false,
          electron_view_attachment: 'main_only_not_exposed_to_renderer',
          preview_content_ipc: false,
          node_integration: false,
          preload: false,
        },
      }),
      stopCurrentPreview: async (request: unknown) => ({
        status_version: 'builder-live-preview-status-projection.v1',
        project_id: (request as { project_id: string }).project_id,
        conversation_id: (request as { conversation_id: string }).conversation_id,
        preview_kind: 'live_static_web',
        entry_url: null,
        status: 'stopped',
        can_start: false,
        can_reload: false,
        can_stop: false,
        blocked_request_count: 0,
        navigation_block_count: 0,
        network_block_count: 0,
        permission_block_count: 0,
        download_block_count: 0,
        window_open_block_count: 0,
        message: 'Live preview is stopped.',
        unavailable_reason: null,
        dev_server_approval: null,
        runtime_launch_projection: livePreviewRuntimeLaunchProjection(request),
        updated_at_ms: 10,
        authority: {
          live_preview_authority: 'main_owned_live_preview_ipc_adapter_v1',
          renderer_authority: 'current_project_conversation_only',
          active_renderer_required: true,
          source_tree_from_renderer: 'not_accepted',
          source_read: 'main_owned_preview_source_resolver_or_not_performed',
          source_write: 'not_performed',
          provider_dispatch: false,
          tool_dispatch: false,
          command_execution: false,
          git_mutation: false,
          sqlite_write: false,
          permission_grant: false,
          revision_admission: false,
          save_admission: false,
          electron_view_attachment: 'main_only_not_exposed_to_renderer',
          preview_content_ipc: false,
          node_integration: false,
          preload: false,
        },
      }),
      readCurrentPreviewStatus: async (request: unknown) => ({
        status_version: 'builder-live-preview-status-projection.v1',
        project_id: (request as { project_id: string }).project_id,
        conversation_id: (request as { conversation_id: string }).conversation_id,
        preview_kind: 'live_static_web',
        entry_url: null,
        status: 'unavailable',
        can_start: false,
        can_reload: false,
        can_stop: false,
        blocked_request_count: 0,
        navigation_block_count: 0,
        network_block_count: 0,
        permission_block_count: 0,
        download_block_count: 0,
        window_open_block_count: 0,
        message: 'Live preview is unavailable until a main-owned preview source resolver is connected.',
        unavailable_reason: 'preview_source_resolver_not_connected',
        dev_server_approval: null,
        runtime_launch_projection: livePreviewRuntimeLaunchProjection(request),
        updated_at_ms: 10,
        authority: {
          live_preview_authority: 'main_owned_live_preview_ipc_adapter_v1',
          renderer_authority: 'current_project_conversation_only',
          active_renderer_required: true,
          source_tree_from_renderer: 'not_accepted',
          source_read: 'main_owned_preview_source_resolver_or_not_performed',
          source_write: 'not_performed',
          provider_dispatch: false,
          tool_dispatch: false,
          command_execution: false,
          git_mutation: false,
          sqlite_write: false,
          permission_grant: false,
          revision_admission: false,
          save_admission: false,
          electron_view_attachment: 'main_only_not_exposed_to_renderer',
          preview_content_ipc: false,
          node_integration: false,
          preload: false,
        },
      }),
      updateCurrentPreviewLayout: async (request: unknown) => ({
        status_version: 'builder-live-preview-status-projection.v1',
        project_id: (request as { project_id: string }).project_id,
        conversation_id: (request as { conversation_id: string }).conversation_id,
        preview_kind: 'live_static_web',
        entry_url: null,
        status: 'unavailable',
        can_start: false,
        can_reload: false,
        can_stop: false,
        blocked_request_count: 0,
        navigation_block_count: 0,
        network_block_count: 0,
        permission_block_count: 0,
        download_block_count: 0,
        window_open_block_count: 0,
        message: 'Live preview is unavailable until a main-owned preview source resolver is connected.',
        unavailable_reason: 'preview_source_resolver_not_connected',
        dev_server_approval: null,
        runtime_launch_projection: livePreviewRuntimeLaunchProjection(request),
        updated_at_ms: 10,
        authority: {
          live_preview_authority: 'main_owned_live_preview_ipc_adapter_v1',
          renderer_authority: 'current_project_conversation_only',
          active_renderer_required: true,
          source_tree_from_renderer: 'not_accepted',
          source_read: 'main_owned_preview_source_resolver_or_not_performed',
          source_write: 'not_performed',
          provider_dispatch: false,
          tool_dispatch: false,
          command_execution: false,
          git_mutation: false,
          sqlite_write: false,
          permission_grant: false,
          revision_admission: false,
          save_admission: false,
          electron_view_attachment: 'main_only_not_exposed_to_renderer',
          preview_content_ipc: false,
          node_integration: false,
          preload: false,
        },
      }),
      decideDevServerApproval: async (request: unknown) => ({
        status_version: 'builder-live-preview-status-projection.v1',
        project_id: (request as { project_id: string }).project_id,
        conversation_id: (request as { conversation_id: string }).conversation_id,
        preview_kind: 'live_static_web',
        entry_url: null,
        status: 'stopped',
        can_start: false,
        can_reload: false,
        can_stop: false,
        blocked_request_count: 0,
        navigation_block_count: 0,
        network_block_count: 0,
        permission_block_count: 0,
        download_block_count: 0,
        window_open_block_count: 0,
        message: 'Live preview is stopped.',
        unavailable_reason: null,
        dev_server_approval: null,
        runtime_launch_projection: livePreviewRuntimeLaunchProjection(request),
        updated_at_ms: 10,
        authority: {
          live_preview_authority: 'main_owned_live_preview_ipc_adapter_v1',
          renderer_authority: 'current_project_conversation_only',
          active_renderer_required: true,
          source_tree_from_renderer: 'not_accepted',
          source_read: 'main_owned_preview_source_resolver_or_not_performed',
          source_write: 'not_performed',
          provider_dispatch: false,
          tool_dispatch: false,
          command_execution: false,
          git_mutation: false,
          sqlite_write: false,
          permission_grant: false,
          revision_admission: false,
          save_admission: false,
          electron_view_attachment: 'main_only_not_exposed_to_renderer',
          preview_content_ipc: false,
          node_integration: false,
          preload: false,
        },
      }),
    },
    agentTestBrowser: {
      updateLayout: vi.fn(async (request: {
        owner_run_id: string;
        view_bounds: { x: number; y: number; width: number; height: number } | null;
      }) => ({
        result_version: 'builder-agent-test-browser-layout-result.v1',
        owner_run_id: request.owner_run_id,
        operation: 'not_active',
        visible: false,
        applied_bounds: null,
      })),
    },
    userWeb: {
      navigate: vi.fn(async () => userWebStatus()),
      goBack: vi.fn(async () => userWebStatus()),
      goForward: vi.fn(async () => userWebStatus()),
      reload: vi.fn(async () => userWebStatus()),
      stop: vi.fn(async () => userWebStatus()),
      readStatus: vi.fn(async () => userWebStatus()),
      updateLayout: vi.fn(async () => userWebStatus()),
    },
    sideWorkspaceFiles: options.sideWorkspaceFilesAvailable === true ? {
      readCurrentDraftFileTree,
      readCurrentDraftFileContent,
      readRuntimeToolFileTree: readCurrentDraftFileTree,
    } : {},
    taskStream: {
      read: readTaskStream,
      subscribeChanged(listener: (event: unknown) => void) {
        taskStreamChangedListeners.add(listener);
        return () => {
          taskStreamChangedListeners.delete(listener);
        };
      },
    },
    windowControls: {
      close: async () => ({ result_version: 'builder-window-control-result.v1', ok: true }),
      minimize: async () => ({ result_version: 'builder-window-control-result.v1', ok: true }),
      readState: async () => ({ state_version: 'builder-window-state.v1', maximized: false }),
      toggleMaximize: async () => ({
        result_version: 'builder-window-control-result.v1',
        ok: true,
      }),
    },
  };
  if (options.livePreviewReply) {
    const previewBridge = bridge.livePreview as Record<string, (request: unknown) => Promise<Record<string, unknown>>>;
    for (const [method, operation] of [['readCurrentPreviewStatus', 'read'], ['requestCurrentDraftPreview', 'start']] as const) {
      const original = previewBridge[method];
      previewBridge[method] = async (request) => options.livePreviewReply!(operation, await original(request));
    }
  }
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  await act(async () => {
    root.render(options.strictMode === true
      ? <StrictMode><BuilderApp bridgeRoot={bridge} /></StrictMode>
      : <BuilderApp bridgeRoot={bridge} />);
  });
  return {
    approveAndRunCurrentDraftCheck,
    classifyIntent,
    createTaskProposal,
    decideCurrentDraftDependencyPreparation,
    diagnoseCurrentDraftCheckEnvironment,
    diagnoseProjectEnvironment,
    prepareProjectDependencies,
    decideTaskProposal,
    skipCurrentDraftCheck,
    container,
    answer,
    answerPlan,
    answerDraft,
    cancel,
    continueDraft,
    createLocalProject,
    openLocation,
    readCurrentDraftAvailableChecks,
    readCurrentDraftFileTree,
    resolveDeferredCheckRunRead: async () => {
      if (resolveDeferredCheckRunRead !== null) resolveDeferredCheckRunRead();
      await act(async () => {
        await Promise.resolve();
      });
    },
    resolveDeferredDependencyPreparation: async () => {
      if (resolveDeferredDependencyPreparation !== null) resolveDeferredDependencyPreparation();
      await act(async () => {
        await Promise.resolve();
      });
    },
    generate,
    resumeInterruptedRun,
    generateApprovedPlan,
    resolveAnswer: async () => {
      for (let attempt = 0; resolveAnswer === null && attempt < 20; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      }
      if (resolveAnswer === null) throw new Error('answer was not deferred');
      await resolveAnswer();
    },
    resolvePlanReview: async () => {
      if (resolvePlanReview === null) throw new Error('plan review was not deferred');
      await resolvePlanReview();
    },
    resolvePlanProposal: async () => {
      for (let attempt = 0; resolvePlanProposal === null && attempt < 20; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      }
      if (resolvePlanProposal === null) throw new Error('plan proposal was not deferred');
      await resolvePlanProposal();
      await act(async () => {
        await Promise.resolve();
      });
    },
    proposePlan,
    preparePlanSourceReadApproval,
    approvePlanSourceRead,
    prepareCurrentProjectWriteApproval,
    approveCurrentProjectWrite,
    approveCurrentProviderContextDisclosure,
    submit,
    retry,
    steer,
    queueFollowup,
    listHistory,
    loadRevision,
    listCurrent,
    listWorkspaces,
    loadCurrent,
    open,
    readAgentProjectTree,
    readTaskStream,
    exportTaskTranscript,
    decideCommandApproval,
    emitTaskStreamChanged(projectId = PROJECT_ID) {
      const listenerCount = taskStreamChangedListeners.size;
      act(() => {
        for (const listener of [...taskStreamChangedListeners]) {
          listener({
            event_version: 'builder-task-stream-changed.v1',
            project_id: projectId,
          });
        }
      });
      return listenerCount;
    },
    emitGenerationStarted(requestId: string, projectId: string | null = PROJECT_ID) {
      const listenerCount = generationStartedListeners.size;
      act(() => {
        for (const listener of [...generationStartedListeners]) {
          listener({
            event_version: 'builder-generation-started.v1',
            request_id: requestId,
            project_id: projectId,
          });
        }
      });
      return listenerCount;
    },
    emitGenerationStartedWithoutAct(requestId: string, projectId: string | null = PROJECT_ID) {
      const listenerCount = generationStartedListeners.size;
      for (const listener of [...generationStartedListeners]) {
        listener({
          event_version: 'builder-generation-started.v1',
          request_id: requestId,
          project_id: projectId,
        });
      }
      return listenerCount;
    },
    emitGenerationOutput(requestId: string, text: string, projectId: string | null = PROJECT_ID) {
      const listenerCount = generationOutputListeners.size;
      act(() => {
        for (const listener of [...generationOutputListeners]) {
          listener({
            event_version: 'builder-generation-output.v1',
            request_id: requestId,
            project_id: projectId,
            conversation_id: projectId === null
              ? `builder-agent-conversation:${AGENT_ID.slice('builder-agent:'.length)}`
              : projectId === PROJECT_ID
                ? CONVERSATION_ID
                : `builder-conversation:${projectId.slice('builder-project:'.length)}:223e4567-e89b-42d3-a456-426614174000`,
            turn_id: 'builder-turn:123e4567-e89b-42d3-a456-426614174001',
            task_id: projectId === null
              ? null
              : 'builder-task:123e4567-e89b-42d3-a456-426614174001',
            run_id: 'builder-run:123e4567-e89b-42d3-a456-426614174001',
            display_delta_text: text,
          });
        }
      });
      return listenerCount;
    },
    emitCommandApproval() {
      const listenerCount = commandApprovalListeners.size;
      act(() => {
        for (const listener of [...commandApprovalListeners]) {
          listener({
            request_version: 'builder-controlled-command-approval-request.v1',
            approval_request_id:
              'builder-controlled-command-approval-request:123e4567-e89b-42d3-a456-426614174000',
            project_id: PROJECT_ID,
            conversation_id: CONVERSATION_ID,
            turn_id: PENDING_TURN_ID,
            task_id: PENDING_TASK_ID,
            run_id: PENDING_RUN_ID,
            command_profile_id: `builder-command-profile:${'a'.repeat(32)}`,
            command_kind: 'test',
            command_display: 'npm test',
            description: 'Verify the current project before finishing.',
            source_tree_digest: `sha256:${'b'.repeat(64)}`,
            requested_at_ms: 1_000,
            expires_at_ms: 301_000,
            risk_notice: 'This project script may modify files or use the network.',
            decisions: ['allow_once', 'deny'],
          });
        }
      });
      return listenerCount;
    },
    emitCommandOutput(chunks: readonly Readonly<{ stream: 'stdout' | 'stderr'; text: string }>[]) {
      const listenerCount = commandOutputListeners.size;
      act(() => {
        for (const listener of [...commandOutputListeners]) {
          listener({
            event_version: 'builder-controlled-command-output.v1',
            project_id: PROJECT_ID,
            conversation_id: CONVERSATION_ID,
            turn_id: PENDING_TURN_ID,
            task_id: PENDING_TASK_ID,
            run_id: PENDING_RUN_ID,
            command_profile_id: `builder-command-profile:${'a'.repeat(32)}`,
            chunks,
          });
        }
      });
      return listenerCount;
    },
    reviewPlan,
    rejectDraft,
    restoreDraft,
    restoreRevisionAsDraft,
    restorePreviousCheckpointAsDraft,
    async resolveGenerate() {
      await resolveGenerate?.();
    },
    saveDraft,
  };
}

type ReadWire = Awaited<ReturnType<typeof createReadWire>>;

async function readWireAsRevision(
  wire: ReadWire,
  revisionNumber: number,
  previousRevisionReceiptDigest: string | null,
): Promise<ReadWire> {
  const unsignedReceipt = {
    ...wire.product_revision_receipt,
    revision_number: revisionNumber,
    previous_revision_receipt_digest: previousRevisionReceiptDigest,
  };
  const receiptBody = { ...unsignedReceipt };
  delete (receiptBody as { revision_receipt_digest?: string }).revision_receipt_digest;
  const revisionReceiptDigest = await digest(receiptBody);
  return {
    ...wire,
    product_revision_receipt: {
      ...unsignedReceipt,
      revision_receipt_digest: revisionReceiptDigest,
    },
    current: {
      ...wire.current,
      revision_number: revisionNumber,
      revision_receipt_digest: revisionReceiptDigest,
    },
  } as unknown as ReadWire;
}

function historyRevision(wire: ReadWire, isCurrent: boolean, parentOid: string | null = wire.product_revision_receipt.parent_oid) {
  return {
    project_id: wire.product_revision_receipt.project_id,
    title: wire.product_revision_receipt.title,
    summary: wire.product_revision_receipt.summary,
    revision_number: wire.product_revision_receipt.revision_number,
    revision_receipt_digest: wire.product_revision_receipt.revision_receipt_digest,
    previous_revision_receipt_digest: wire.product_revision_receipt.previous_revision_receipt_digest,
    commit_oid: wire.product_revision_receipt.commit_oid,
    tree_oid: wire.product_revision_receipt.tree_oid,
    parent_oid: parentOid,
    selected_at_ms: wire.product_revision_receipt.selected_at_ms,
    is_current: isCurrent,
  };
}

function createValidHistoryWire(projectId: string, currentWire: ReadWire, historicalWire: ReadWire) {
  const currentParentOid = historicalWire.product_revision_receipt.commit_oid;
  return {
    result_version: 'builder-project-read-result.v1',
    operation: 'history_listed',
    project_id: projectId,
    current: {
      ...currentWire.current,
      parent_oid: currentParentOid,
    },
    revisions: [
      historyRevision(currentWire, true, currentParentOid),
      historyRevision(historicalWire, false),
    ],
    authority_evidence: {
      product_authority: 'sqlite_product_revision_receipt',
      code_authority: 'git_commit_tree',
      source_read_admission: 'verified',
      current_selection: 'sqlite_current_project_revision',
      history_selection: 'sqlite_project_revision_receipts',
    },
  };
}

function click(container: HTMLElement, label: string): void {
  const button = label.startsWith('[')
    ? container.querySelector<HTMLButtonElement>(label)
    : [...container.querySelectorAll<HTMLButtonElement>('button')]
      .find((candidate) => candidate.textContent?.includes(label));
  expect(button, label).not.toBeUndefined();
  act(() => button?.click());
}

function setComposerInstruction(container: HTMLElement, instruction: string): void {
  const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea');
  expect(textarea).not.toBeNull();
  act(() => {
    if (textarea === null) return;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      ?.call(textarea, instruction);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

async function waitForComposerSubmitReady(container: HTMLElement): Promise<void> {
  await waitFor(() => {
    expect(container.querySelector<HTMLButtonElement>('[data-builder-submit-turn="true"]')?.disabled)
      .toBe(false);
  });
}

function expectDraftDecisionCard(container: HTMLElement): HTMLElement {
  expect(container.querySelector('[data-builder-unsaved-draft="true"]')).not.toBeNull();
  const card = container.querySelector<HTMLElement>('[data-builder-composer-version-decision="true"]');
  expect(card).not.toBeNull();
  expect(card?.textContent).toContain('Save this draft?');
  expect(card?.textContent).toContain('Save version');
  expect(card?.textContent).toContain('Discard draft');
  return card!;
}

function expectDraftWaitingForReviewEvidence(container: HTMLElement): void {
  expect(container.querySelector('[data-builder-unsaved-draft="true"]')).not.toBeNull();
  expect(container.querySelector('[data-builder-composer-version-decision="true"]')).toBeNull();
  expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
  expect(container.querySelector('[data-builder-discard-draft="true"]')).toBeNull();
}

function artifactPreviewSrcdoc(container: HTMLElement): string | null {
  return container
    .querySelector('[data-builder-artifact-sidebar="true"] [data-builder-result-flow="true"] iframe')
    ?.getAttribute('srcdoc') ?? null;
}

async function openSavedProject(
  container: HTMLElement,
  acceptedStatuses: readonly string[] = ['ready'],
): Promise<void> {
  await waitFor(() => {
    expect(container.querySelector(`[data-builder-project-id="${PROJECT_ID}"]`)).not.toBeNull();
  });
  click(container, 'Hello project');
  await waitFor(() => {
    expect(acceptedStatuses).toContain(
      container.querySelector('[data-builder-page="true"]')?.getAttribute('data-builder-project-status'),
    );
    expect(container.querySelector('h1')?.textContent).toBe('Hello project');
  });
}

async function openVersionsPanel(container: HTMLElement): Promise<void> {
  await waitFor(() => {
    expect(container.querySelector('[data-builder-page="true"]')
      ?.getAttribute('data-builder-project-status')).toBe('ready');
  });
  await waitFor(() => {
    expect(container.querySelector('[data-builder-workspace-menu-button="true"]')).not.toBeNull();
  });
  click(container, '[data-builder-workspace-menu-button="true"]');
  await waitFor(() => {
    expect(container.querySelector('[data-builder-workspace-menu="true"]')).not.toBeNull();
  });
  click(container, '[data-builder-workspace-control-tab="versions"]');
  await waitFor(() => {
    expect(container.querySelector('[data-builder-artifact-sidebar="true"]')
      ?.getAttribute('data-builder-artifact-tab-active')).toBe('versions');
  });
}

async function createRestoredDraftForReadWire(
  readWire: Awaited<ReturnType<typeof createReadWire>>,
) {
  const draft = await createRestoredGenerationDraft(readWire.source_tree);
  if (draft.base_revision_evidence === null) return draft;
  return {
    ...draft,
    base_revision_evidence: {
      ...draft.base_revision_evidence,
      project_id: readWire.product_revision_receipt.project_id,
      revision_receipt_digest: readWire.product_revision_receipt.revision_receipt_digest,
      commit_oid: readWire.product_revision_receipt.commit_oid,
      source_tree_digest: readWire.source_tree.source_tree_digest,
    },
  };
}

async function createRestoredDraftForUnsavedWorkspaceWire(
  readWire: Awaited<ReturnType<typeof createReadWire>>,
) {
  const request = await createBuilderGenerationRequest('Add a local-project change.');
  const draft = await createGenerationDraft(request, readWire.source_tree);
  return {
    ...draft,
    request_id: null,
    restart_restore: 'git_sqlite_verified' as const,
  };
}

function pendingCandidateTaskStreamWire(state: 'accepted' | 'proposed' | 'rejected') {
  const wire = state === 'accepted'
    ? createAcceptedTaskStreamWire(1)
    : state === 'rejected'
      ? createRejectedTaskStreamWire()
      : reviewReadyTaskStreamWire();
  return {
    ...wire,
    conversation: {
      ...wire.conversation,
      items: wire.conversation.items.map((item) => {
        if (item.item_kind === 'user_message') {
          return {
            ...item,
            turn_id: PENDING_TURN_ID,
            task: 'task' in item && item.task !== null
              ? { ...item.task, task_id: PENDING_TASK_ID }
              : null,
          };
        }
        if (item.item_kind === 'run_started') {
          return {
            ...item,
            turn_id: PENDING_TURN_ID,
            run_id: PENDING_RUN_ID,
            task_id: PENDING_TASK_ID,
          };
        }
        if (item.item_kind === 'run_completed') {
          return {
            ...item,
            turn_id: PENDING_TURN_ID,
            run_id: PENDING_RUN_ID,
          };
        }
        return {
          ...item,
          turn_id: PENDING_TURN_ID,
          run_id: PENDING_RUN_ID,
        };
      }),
    },
  };
}

function acceptedCandidateAfterSupersededCandidateTaskStreamWire() {
  const wire = pendingCandidateTaskStreamWire('accepted');
  const [userMessage, runStarted, runCompleted, turnCompleted, candidateReviewed] =
    wire.conversation.items;
  const completed = runCompleted as typeof runCompleted & {
    assistant_message: { message_id: string; text: string };
    candidate: {
      draft_id: string;
      title: string;
      summary: string;
      candidate_state: string;
      source_availability: string;
    };
  };
  const latestDraftId = `builder-generation-draft:${'f'.repeat(64)}`;
  return {
    ...wire,
    conversation: {
      ...wire.conversation,
      head_sequence: 7,
      window: {
        ...wire.conversation.window,
        last_sequence: 7,
      },
      items: [
        userMessage,
        {
          ...runStarted,
          sequence: 2,
          run_id: RUN_ID,
          attempt_number: 1,
          retry_of_run_id: null,
        },
        {
          ...completed,
          sequence: 3,
          run_id: RUN_ID,
        },
        {
          ...runStarted,
          sequence: 4,
          run_id: PENDING_RUN_ID,
          attempt_number: 2,
          retry_of_run_id: RUN_ID,
        },
        {
          ...completed,
          sequence: 5,
          run_id: PENDING_RUN_ID,
          assistant_message: {
            ...completed.assistant_message,
            message_id: 'builder-message:323e4567-e89b-42d3-a456-426614174001',
          },
          candidate: {
            ...completed.candidate,
            draft_id: latestDraftId,
          },
        },
        {
          ...turnCompleted,
          sequence: 6,
          run_id: PENDING_RUN_ID,
        },
        {
          ...candidateReviewed,
          sequence: 7,
          run_id: PENDING_RUN_ID,
          draft_id: latestDraftId,
        },
      ],
    },
  };
}

function runningTaskStreamWire(queuedFollowupText?: string) {
  const wire = createTaskStreamWire();
  const items: unknown[] = wire.conversation.items.slice(0, 2);
  if (queuedFollowupText !== undefined) {
    items.push({
      item_kind: 'user_message',
      sequence: 3,
      turn_id: TURN_ID,
      message: {
        message_id: 'builder-message:123e4567-e89b-42d3-a456-426614174088',
        text: queuedFollowupText,
      },
      message_kind: 'queued_followup',
      mode: null,
      task: null,
    });
  }
  return {
    ...wire,
    conversation: {
      ...wire.conversation,
      head_sequence: queuedFollowupText === undefined ? 2 : 3,
      recorded_active_turn_id: TURN_ID,
      window: {
        ...wire.conversation.window,
        last_sequence: queuedFollowupText === undefined ? 2 : 3,
      },
      items,
    },
  };
}

function waitingForUserAnswerTaskStreamWire() {
  const wire = runningTaskStreamWire();
  return {
    ...wire,
    conversation: {
      ...wire.conversation,
      head_sequence: 3,
      window: {
        ...wire.conversation.window,
        last_sequence: 3,
      },
      items: [
        ...wire.conversation.items,
        {
          item_kind: 'programming_runtime_status',
          sequence: 3,
          turn_id: TURN_ID,
          run_id: RUN_ID,
          step_id: null,
          status_kind: 'attention',
          activity_kind: null,
          attention_class: 'user_input_required',
          failure_class: null,
          status: '你希望使用 React 还是原生 JavaScript？',
        },
      ],
    },
  };
}

function pendingBuildConfirmationTaskStreamWire() {
  const wire = createAcceptedTaskStreamWire(1);
  return {
    ...wire,
    conversation: {
      ...wire.conversation,
      head_sequence: 9,
      window: {
        ...wire.conversation.window,
        last_sequence: 9,
      },
      items: [
        ...wire.conversation.items,
        {
          item_kind: 'user_message',
          sequence: 6,
          turn_id: PENDING_TURN_ID,
          message: {
            message_id: 'builder-message:123e4567-e89b-42d3-a456-426614174066',
            text: '改下颜色',
          },
          message_kind: 'submitted',
          mode: 'question',
          task: null,
        },
        {
          item_kind: 'run_started',
          sequence: 7,
          turn_id: PENDING_TURN_ID,
          run_id: PENDING_RUN_ID,
          task_id: null,
          attempt_number: 1,
          retry_of_run_id: null,
          recorded_state: 'started',
        },
        {
          item_kind: 'run_completed',
          sequence: 8,
          turn_id: PENDING_TURN_ID,
          run_id: PENDING_RUN_ID,
          terminal_status: 'succeeded',
          result_kind: 'explanation',
          failure_phase: 'not_applicable',
          assistant_message: {
            message_id: 'builder-message:123e4567-e89b-42d3-a456-426614174067',
            text: '可以把侧边栏改成深蓝、卡片改成浅蓝。需要我直接修改这些颜色吗？',
          },
          candidate: null,
        },
        {
          item_kind: 'turn_completed',
          sequence: 9,
          turn_id: PENDING_TURN_ID,
          run_id: PENDING_RUN_ID,
          outcome: 'answered',
        },
      ],
    },
  };
}

describe('BuilderApp v2', () => {
  it('renders the Agent conversation without a Projects column when no projects exist', async () => {
    const { container } = await setup();
    expect(container.querySelectorAll('main')).toHaveLength(1);
    expect(container.querySelector('[data-builder-workbench="true"]')).not.toBeNull();
    expect(container.textContent).toContain('Agents');
    expect(container.textContent).toContain('Settings');
    const railLabels = Array.from(container.querySelectorAll('.cf-builder-rail-button'))
      .map((button) => button.textContent);
    expect(railLabels).toEqual(['Agents', 'Settings']);
    expect(container.querySelector('[data-builder-workbench-rail="true"] .cf-builder-rail-brand')).toBeNull();
    expect(container.querySelector('[data-builder-rail-item="settings"]')?.textContent).toBe('Settings');
    expect(container.querySelector('[data-builder-workbench-agent-roster="true"]')).not.toBeNull();
    expect(container.querySelector('[data-builder-agent-id]')?.textContent).toContain('Builder');
    expect(container.querySelector('.cf-builder-shell')?.getAttribute('data-builder-projects')).toBe('absent');
    expect(container.querySelector('[data-builder-workbench-context="true"]')).toBeNull();
    expect(container.querySelector('.cf-builder-agent-projects-toggle')).toBeNull();
    expect(railLabels).not.toContain('Canvas');
    expect(railLabels).not.toContain('Chat');
  });

  it('shows existing projects by default and lets the user collapse and restore the column', async () => {
    const { container } = await setup({ initiallySaved: true });

    await waitFor(() => {
      expect(container.querySelector('.cf-builder-shell')?.getAttribute('data-builder-projects'))
        .toBe('expanded');
      expect(container.querySelector('[data-builder-workbench-context="true"]')?.textContent)
        .toContain('Projects');
    });

    click(container, '[aria-label="Hide projects"]');
    expect(container.querySelector('.cf-builder-shell')?.getAttribute('data-builder-projects'))
      .toBe('collapsed');
    expect(container.querySelector('[data-builder-workbench-context="true"]')).toBeNull();

    click(container, '[aria-label="Show projects"]');
    expect(container.querySelector('.cf-builder-shell')?.getAttribute('data-builder-projects'))
      .toBe('expanded');
    expect(container.querySelector('[data-builder-workbench-context="true"]')).not.toBeNull();
  });

  it('ignores a late preview operation after leaving and reopening a task', async () => {
    let resolveStart: (() => void) | null = null;
    const { container } = await setup({ initiallySaved: true,
      livePreviewReply: async (operation, status) => {
        if (operation === 'start') return new Promise((resolve) => {
          resolveStart = () => resolve({ ...status, status: 'ready', can_start: false, can_reload: true,
            can_stop: true, unavailable_reason: null, entry_url: 'http://127.0.0.1:34567/index.html' });
        });
        return { ...status, status: 'idle', can_start: true, unavailable_reason: null };
      },
    });
    await openSavedProject(container);
    await waitFor(() => expect(container.querySelector<HTMLButtonElement>('[data-builder-run-project="true"]')?.disabled).toBe(false));
    click(container, '[data-builder-run-project="true"]');
    await waitFor(() => expect(resolveStart).not.toBeNull());
    click(container, '[data-builder-agent-id]');
    await waitFor(() => expect(container.querySelector('[data-builder-agent-id]')?.getAttribute('data-selected')).toBe('true'));
    await openSavedProject(container);
    await waitFor(() => expect(container.querySelector<HTMLButtonElement>('[data-builder-run-project="true"]')?.disabled).toBe(false));
    await act(async () => { (resolveStart as (() => void) | null)?.(); });
    expect(container.querySelector('[data-builder-live-preview-status="ready"]')).toBeNull();
    expect(container.querySelector<HTMLButtonElement>('[data-builder-run-project="true"]')?.disabled).toBe(false);
  });

  it('resumes a reopened paused task only after an explicit click and the normal write approval', async () => {
    const wire = createInterruptedTaskStreamWire();
    const { container, submit, generate, resumeInterruptedRun, answer, approveCurrentProjectWrite } = await setup({
      initiallySaved: true, currentProjectWriteApprovalRequired: true, taskStreamWireOverride: wire,
    });
    await openSavedProject(container);
    await waitFor(() => expect(container.querySelector('[data-builder-resume-interrupted-run="true"]')).not.toBeNull());
    expect(submit).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(answer).not.toHaveBeenCalled();
    click(container, '[data-builder-resume-interrupted-run="true"]');
    await waitFor(() => expect(container.querySelector('[data-builder-approve-current-project-write="true"]')).not.toBeNull());
    expect(submit).not.toHaveBeenCalled();
    expect(approveCurrentProjectWrite).not.toHaveBeenCalled();
    click(container, '[data-builder-approve-current-project-write="true"]');
    await waitFor(() => expect(resumeInterruptedRun).toHaveBeenCalledOnce());
    expect(resumeInterruptedRun).toHaveBeenCalledWith({
      run_id: expect.stringMatching(/^builder-run:/u), task_address_id: TASK_ADDRESS_ID,
    });
    expect(generate).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    expect(approveCurrentProjectWrite).toHaveBeenCalledOnce();
  });

  it('keeps the Agent conversation reachable after opening a project task', async () => {
    const { container, readTaskStream } = await setup({ initiallySaved: true });
    await openSavedProject(container);

    const agent = container.querySelector<HTMLButtonElement>('[data-builder-agent-id]');
    expect(agent?.getAttribute('aria-current')).toBeNull();
    expect(agent?.getAttribute('data-selected')).toBe('false');
    expect(container.querySelector(`[data-builder-task-address-id="${TASK_ADDRESS_ID}"]`)
      ?.getAttribute('data-selected')).toBe('true');
    readTaskStream.mockClear();

    click(container, '[data-builder-agent-id]');

    await waitFor(() => {
      expect(readTaskStream).toHaveBeenCalledWith({ agent_id: AGENT_ID });
      expect(agent?.getAttribute('aria-current')).toBe('page');
      expect(agent?.getAttribute('data-selected')).toBe('true');
    });
    expect(container.querySelector('.cf-builder-shell')?.getAttribute('data-builder-projects')).
      toBe('expanded');
    expect(container.querySelector('[data-builder-workbench-context="true"]')).not.toBeNull();
    expect(container.querySelector(`[data-builder-task-address-id="${TASK_ADDRESS_ID}"]`)
      ?.getAttribute('data-selected')).toBe('false');
  });

  it('shows the main-owned task objective when an opened task has no conversation events yet', async () => {
    const { container, readTaskStream } = await setup({
      agentTaskReturn: true,
      initiallySaved: true,
      taskStreamWireOverride: {
        stream_version: 'builder-task-stream-read-result.v1',
        project_id: PROJECT_ID,
        conversation: null,
        authority: {
          conversation: 'sqlite_canonical_event_replay_or_absent',
          project_source: 'not_included',
          candidate_source: 'not_loaded',
          project_revision: 'not_inferred',
        },
      },
    });

    await waitFor(() => {
      expect(container.querySelector(
        `[data-builder-agent-result-open-task="true"][data-builder-task-address-id="${TASK_ADDRESS_ID}"]`,
      )).not.toBeNull();
    });
    click(
      container,
      `[data-builder-agent-result-open-task="true"][data-builder-task-address-id="${TASK_ADDRESS_ID}"]`,
    );

    await waitFor(() => {
      expect(readTaskStream).toHaveBeenCalledWith({
        project_id: PROJECT_ID,
        task_address_id: TASK_ADDRESS_ID,
      });
      expect(container.querySelector(
        `[data-builder-task-conversation-seed="${TASK_ADDRESS_ID}"]`,
      )).not.toBeNull();
    });
    expect(container.querySelector('[data-builder-task-seed-message="true"]')?.textContent)
      .toContain('Create and improve the current project.');
    expect(container.querySelector('[data-builder-task-seed-status="active"]')?.textContent)
      .toContain('no recorded conversation activity yet.');
  });

  it('keeps the main-owned task objective visible when its conversation read is temporarily unavailable', async () => {
    const { container, readTaskStream } = await setup({
      agentTaskReturn: true,
      failTaskStreamReadAttempts: 10_000,
      initiallySaved: true,
    });

    await waitFor(() => {
      expect(container.querySelector(
        `[data-builder-agent-result-open-task="true"][data-builder-task-address-id="${TASK_ADDRESS_ID}"]`,
      )).not.toBeNull();
    });
    click(
      container,
      `[data-builder-agent-result-open-task="true"][data-builder-task-address-id="${TASK_ADDRESS_ID}"]`,
    );

    await waitFor(() => {
      expect(readTaskStream).toHaveBeenCalledWith({
        project_id: PROJECT_ID,
        task_address_id: TASK_ADDRESS_ID,
      });
      expect(container.querySelector(
        `[data-builder-task-conversation-seed="${TASK_ADDRESS_ID}"]`,
      )).not.toBeNull();
    }, 240);
    expect(container.querySelector('[data-builder-task-seed-message="true"]')?.textContent)
      .toContain('Create and improve the current project.');
  }, 15_000);

  it('does not duplicate the task objective after canonical conversation events are available', async () => {
    const { container } = await setup({ initiallySaved: true });

    await openSavedProject(container);

    await waitFor(() => {
      expect(container.querySelector('[data-builder-activity-card]')).not.toBeNull();
    });
    expect(container.querySelector('[data-builder-task-conversation-seed]')).toBeNull();
  });

  it('returns an unsaved draft from Agent Workbench to the exact originating Task', async () => {
    const { container, restoreDraft } = await setup({
      agentTaskReturn: true,
      initiallySaved: true,
      pendingActivity: true,
      restoreAvailable: true,
    });
    await openSavedProject(container, ['ready', 'draft_ready']);
    await waitFor(() => {
      expect(container.querySelector('[data-builder-unsaved-draft="true"]')).not.toBeNull();
    });
    restoreDraft.mockClear();

    click(container, '[data-builder-agent-id]');
    await waitFor(() => {
      expect(container.querySelector(
        `[data-builder-agent-result-open-task="true"][data-builder-task-address-id="${TASK_ADDRESS_ID}"]`,
      )).not.toBeNull();
    });
    click(
      container,
      `[data-builder-agent-result-open-task="true"][data-builder-task-address-id="${TASK_ADDRESS_ID}"]`,
    );

    await waitFor(() => {
      expect(container.querySelector('[data-builder-unsaved-draft="true"]')).not.toBeNull();
    });
    expect(container.querySelector('[data-builder-agent-workbench-stream="true"]')).toBeNull();
    expect(container.querySelector(`[data-builder-task-address-id="${TASK_ADDRESS_ID}"]`)
      ?.getAttribute('data-selected')).toBe('true');
    expect(restoreDraft.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it('keeps a project new-task draft unsent, then selects its main-materialized Task Address', async () => {
    const {
      container,
      generate,
      readAgentProjectTree,
      readTaskStream,
    } = await setup({ initiallySaved: true });
    await openSavedProject(container);
    readAgentProjectTree.mockClear();
    readTaskStream.mockClear();

    click(container, '[aria-label="New task in Hello project"]');

    expect(generate).not.toHaveBeenCalled();
    expect(readAgentProjectTree).not.toHaveBeenCalled();
    expect(readTaskStream).not.toHaveBeenCalled();
    expect(container.querySelector(`[data-builder-task-address-id="${TASK_ADDRESS_ID}"]`)
      ?.getAttribute('data-selected')).toBe('false');

    setComposerInstruction(container, 'Make a fresh focus timer.');
    await waitForComposerSubmitReady(container);
    click(container, '[data-builder-composer-add-menu-button="true"]');
    click(container, '[data-builder-composer-add-build-mode="true"]');
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(generate).toHaveBeenCalledExactlyOnceWith({
        instruction: 'Make a fresh focus timer.',
        task_address_id: null,
      });
      expect(container.querySelector(
        `[data-builder-task-address-id="${MATERIALIZED_TASK_ADDRESS_ID}"]`,
      )?.getAttribute('data-selected')).toBe('true');
      expect(readTaskStream).toHaveBeenCalledWith({
        project_id: PROJECT_ID,
        task_address_id: MATERIALIZED_TASK_ADDRESS_ID,
      });
    });
  });

  it('opens a historical task through its exact Task Address', async () => {
    const { container, readTaskStream } = await setup({ initiallySaved: true });
    await openSavedProject(container);
    readTaskStream.mockClear();

    click(container, `[data-builder-task-address-id="${TASK_ADDRESS_ID}"]`);

    await waitFor(() => {
      expect(readTaskStream).toHaveBeenCalledWith({
        project_id: PROJECT_ID,
        task_address_id: TASK_ADDRESS_ID,
      });
    });
  });

  it('downloads a Markdown transcript from the task context menu', async () => {
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    const originalBlob = globalThis.Blob;
    const createdBlobParts: BlobPart[][] = [];
    class RecordingBlob extends originalBlob {
      constructor(parts?: BlobPart[], options?: BlobPropertyBag) {
        super(parts, options);
        createdBlobParts.push([...(parts ?? [])]);
      }
    }
    const createObjectURL = vi.fn((blob: Blob) => {
      void blob;
      return 'blob:builder-task-transcript';
    });
    const revokeObjectURL = vi.fn();
    let clickedDownload: string | null = null;
    let clickedHref: string | null = null;
    Object.defineProperty(globalThis, 'Blob', { configurable: true, value: RecordingBlob });
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function clickAnchor(
      this: HTMLAnchorElement,
    ) {
      clickedDownload = this.download;
      clickedHref = this.href;
    });
    try {
      const { container, exportTaskTranscript } = await setup({ initiallySaved: true });
      await waitFor(() => {
        expect(container.querySelector(`[data-builder-task-address-id="${TASK_ADDRESS_ID}"]`)).not.toBeNull();
      });

      act(() => {
        container.querySelector<HTMLElement>(`[data-builder-task-address-id="${TASK_ADDRESS_ID}"]`)
          ?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 36, clientY: 72 }));
      });
      click(container, `[data-builder-agent-context-export-task-transcript="${TASK_ADDRESS_ID}"]`);

      await waitFor(() => expect(createObjectURL).toHaveBeenCalledOnce());
      expect(exportTaskTranscript).toHaveBeenCalledExactlyOnceWith({
        agent_id: AGENT_ID,
        project_id: PROJECT_ID,
        task_address_id: TASK_ADDRESS_ID,
      });
      const blob = createObjectURL.mock.calls[0]?.[0];
      expect(blob).toBeInstanceOf(Blob);
      if (!(blob instanceof Blob)) throw new Error('missing transcript blob');
      expect(String(createdBlobParts[0]?.[0])).toContain('# ClawFabric Task Transcript');
      expect(clickedDownload).toBe('clawfabric-create-builder-project-transcript-2023-11-14T22-13-20-000Z.md');
      expect(clickedHref).toBe('blob:builder-task-transcript');
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:builder-task-transcript');
      expect(container.querySelector('[data-builder-task-transcript-export-status="ready"]')?.textContent)
        .toContain('Downloaded clawfabric-create-builder-project-transcript');
    } finally {
      clickSpy.mockRestore();
      Object.defineProperty(globalThis, 'Blob', { configurable: true, value: originalBlob });
      Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: originalCreateObjectURL });
      Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: originalRevokeObjectURL });
    }
  });

  it('shows a failure when the task transcript export result is not downloadable', async () => {
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    const createObjectURL = vi.fn((blob: Blob) => {
      void blob;
      return 'blob:builder-task-transcript';
    });
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    try {
      const { container, exportTaskTranscript } = await setup({ initiallySaved: true });
      exportTaskTranscript.mockResolvedValueOnce({ export_version: 'builder-task-transcript-export.v1' });
      await waitFor(() => {
        expect(container.querySelector(`[data-builder-task-address-id="${TASK_ADDRESS_ID}"]`)).not.toBeNull();
      });

      act(() => {
        container.querySelector<HTMLElement>(`[data-builder-task-address-id="${TASK_ADDRESS_ID}"]`)
          ?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 36, clientY: 72 }));
      });
      click(container, `[data-builder-agent-context-export-task-transcript="${TASK_ADDRESS_ID}"]`);

      await waitFor(() => {
        const failure = container.querySelector('[data-builder-task-transcript-export-status="failed"]');
        expect(failure?.getAttribute('role')).toBe('alert');
        expect(failure?.textContent).toContain('Transcript export failed.');
      });
      expect(createObjectURL).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: originalCreateObjectURL });
      Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: originalRevokeObjectURL });
    }
  });

  it('opens the selected project location through the main-owned workspace port', async () => {
    const { container, openLocation } = await setup({ initiallySaved: true });
    await openSavedProject(container);

    click(container, '[data-builder-open-project-location="true"]');

    expect(openLocation).toHaveBeenCalledExactlyOnceWith({ project_id: PROJECT_ID });
  });

  it('does not expose current workspace clearing from the composer', async () => {
    const { container, createLocalProject, open, submit } = await setup({ initiallySaved: true });
    await openSavedProject(container);
    open.mockClear();

    setComposerInstruction(container, 'Create a notes page.');
    expect(container.querySelector('[data-builder-clear-workspace-selection="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-workspace-chip="true"]')).toBeNull();
    expect(open).not.toHaveBeenCalled();
    expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value).toBe('Create a notes page.');
    await waitFor(() => {
      expect(container.querySelector(`[data-builder-project-id="${PROJECT_ID}"]`)?.textContent)
        .toContain('Hello project');
    });

    await waitForComposerSubmitReady(container);
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(submit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ instruction: 'Create a notes page.' }));
    });
    expect(container.querySelector('[data-builder-workspace-picker="true"]')).toBeNull();
    expect(createLocalProject).not.toHaveBeenCalled();
  });

  it('creates a new local project from the sidebar command without submitting work', async () => {
    const { container, createLocalProject, generate, submit } = await setup();

    click(container, '[data-builder-catalog-new-project="true"]');

    await waitFor(() => {
      expect(createLocalProject).toHaveBeenCalledExactlyOnceWith({
        project_id: null,
        project_title: 'New project',
      });
    });
    expect(container.querySelector('[data-builder-new-project-panel="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-workspace-picker="true"]')).toBeNull();
    expect(submit).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(container.querySelector('[data-builder-page="true"]')?.getAttribute('data-builder-project-status'))
        .toBe('ready');
    });
    expect(container.querySelector('[data-builder-agent-workbench-stream="true"]')).toBeNull();
    expect(submit).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });

  it('keeps prior read-only chat visible while the next answer is running without a source folder', async () => {
    const { answer, container, readTaskStream, resolveAnswer } = await setup({
      answerActivity: true,
      deferAnswerAfterFirst: true,
    });

    setComposerInstruction(container, 'hi');
    await waitForComposerSubmitReady(container);
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(answer).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ instruction: 'hi' }));
      expect(container.textContent).toContain('This answer does not change files.');
    });
    expect(readTaskStream).toHaveBeenCalledWith({ agent_id: AGENT_ID });

    setComposerInstruction(container, '你是什么大模型');
    await waitForComposerSubmitReady(container);
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(answer).toHaveBeenCalledTimes(2);
      expect(container.querySelector('[data-builder-conversation-notice="answering"]')?.textContent)
        .toContain('Answering');
    });
    expect(container.querySelector('[data-builder-agent-workbench-stream="true"]')).not.toBeNull();
    expect(container.textContent).toContain('This answer does not change files.');
    expect(container.textContent).not.toContain('Activity is unavailable');

    await resolveAnswer();
  });

  it('keeps both consecutive read-only chat turns visible without a source folder', async () => {
    const { answer, container, generate, readTaskStream, saveDraft, submit } = await setup({
      consecutiveAnswerActivity: true,
    });

    setComposerInstruction(container, 'hi');
    await waitForComposerSubmitReady(container);
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(answer).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ instruction: 'hi' }));
      expect(container.textContent).toContain('hi');
      expect(container.textContent).toContain('This answer does not change files.');
    });

    setComposerInstruction(container, '你对当下的 LLM 有什么看法？');
    await waitForComposerSubmitReady(container);
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(answer).toHaveBeenCalledTimes(2);
      expect(container.textContent).toContain('hi');
      expect(container.textContent).toContain('This answer does not change files.');
      expect(container.textContent).toContain('你对当下的 LLM 有什么看法？');
      expect(container.textContent).toContain('This is the second read-only answer.');
    });

    expect(readTaskStream).toHaveBeenCalledWith({ agent_id: AGENT_ID });
    expect(submit).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-current-version="true"]')).toBeNull();
  });

  it('keeps both consecutive saved-project chat turns visible without creating a draft', async () => {
    const { answer, container, generate, readTaskStream, saveDraft, submit } = await setup({
      consecutiveAnswerActivity: true,
      initiallySaved: true,
    });
    await openSavedProject(container);
    readTaskStream.mockClear();

    setComposerInstruction(container, 'What should I consider before changing this project?');
    await waitForComposerSubmitReady(container);
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(answer).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ instruction: 'What should I consider before changing this project?' }));
      expect(container.textContent).toContain('What should I consider before changing this project?');
      expect(container.textContent).toContain('This answer does not change files.');
    });

    setComposerInstruction(container, 'Can we discuss the audience more?');
    await waitForComposerSubmitReady(container);
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(answer).toHaveBeenCalledTimes(2);
      expect(container.textContent).toContain('What should I consider before changing this project?');
      expect(container.textContent).toContain('This answer does not change files.');
      expect(container.textContent).toContain('Can we discuss the audience more?');
      expect(container.textContent).toContain('This is the second read-only answer.');
    });

    expect(readTaskStream).toHaveBeenCalledWith({ project_id: PROJECT_ID, task_address_id: TASK_ADDRESS_ID });
    expect(submit).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
  });

  it('keeps prior read-only chat visible when the next answer fails without a source folder', async () => {
    const { answer, container, generate, readTaskStream, saveDraft, submit } = await setup({
      answerActivity: true,
      failAnswerAfterFirst: true,
    });

    setComposerInstruction(container, 'hi');
    await waitForComposerSubmitReady(container);
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(answer).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ instruction: 'hi' }));
      expect(container.textContent).toContain('This answer does not change files.');
    });
    expect(readTaskStream).toHaveBeenCalledWith({ agent_id: AGENT_ID });

    setComposerInstruction(container, '你是什么大模型');
    await waitForComposerSubmitReady(container);
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(answer).toHaveBeenCalledTimes(2);
      expect(container.textContent).toContain('暂时无法完成回答，请重试。');
    });
    expect(submit).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(container.querySelector('[data-builder-agent-workbench-stream="true"]')).not.toBeNull();
    expect(container.textContent).toContain('This answer does not change files.');
    expect(container.textContent).not.toContain('Activity is unavailable');
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
  });

  it('does not show answer failed notice when the same answer was recorded in the chat stream', async () => {
    const { answer, container, generate, saveDraft, submit } = await setup({
      answerActivity: true,
      failAnswerAfterFirst: true,
      recordedAnswerAfterFailedPublicResult: true,
    });

    setComposerInstruction(container, 'hi');
    await waitForComposerSubmitReady(container);
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(answer).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ instruction: 'hi' }));
      expect(container.textContent).toContain('This answer does not change files.');
    });

    setComposerInstruction(container, '你是什么大模型');
    await waitForComposerSubmitReady(container);
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(answer).toHaveBeenCalledTimes(2);
      expect(container.textContent).toContain('我是由深度求索（DeepSeek）公司创造的 DeepSeek 模型。');
    });
    await waitFor(() => {
      expect(container.textContent).toContain('This answer does not change files.');
      expect(container.textContent).not.toContain('The answer could not be prepared. Try again.');
      expect(container.querySelector('[data-builder-conversation-notice="answer_failed"]')).toBeNull();
      expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value).toBe('');
    });
    expect(submit).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
  });

  it('uses the started Agent scope when a first read-only answer was recorded before public failure', async () => {
    const {
      answer,
      container,
      emitGenerationStarted,
      generate,
      readTaskStream,
      resolveAnswer,
      saveDraft,
      submit,
    } = await setup({
      deferredFailedFirstAnswer: true,
      failFirstAnswer: true,
      recordedFirstAnswerAfterFailedPublicResult: true,
    });

    const question = '你是什么大模型';
    setComposerInstruction(container, question);
    await waitForComposerSubmitReady(container);
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(answer).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ instruction: question }));
    });
    const request = await createBuilderGenerationRequest(question, null);
    expect(emitGenerationStarted(request.request_digest, null)).toBeGreaterThan(0);

    await act(async () => {
      await resolveAnswer();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(readTaskStream).toHaveBeenCalledWith({ agent_id: AGENT_ID });
      expect(container.textContent).toContain('我是DeepSeek最新版本模型，由深度求索公司创造。');
    });
    expect(container.textContent).not.toContain('The answer could not be prepared. Try again.');
    expect(container.querySelector('[data-builder-conversation-notice="answer_failed"]')).toBeNull();
    expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value).toBe('');
    expect(submit).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
  });

  it('uses the started Agent scope before live output state commits for a first recorded answer failure', async () => {
    const {
      answer,
      container,
      emitGenerationStartedWithoutAct,
      generate,
      readTaskStream,
      resolveAnswer,
      saveDraft,
      submit,
    } = await setup({
      deferredFailedFirstAnswer: true,
      failFirstAnswer: true,
      recordedFirstAnswerAfterFailedPublicResult: true,
    });

    const question = '你是什么大模型';
    setComposerInstruction(container, question);
    await waitForComposerSubmitReady(container);
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(answer).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ instruction: question }));
    });
    const request = await createBuilderGenerationRequest(question, null);

    await act(async () => {
      expect(emitGenerationStartedWithoutAct(request.request_digest, null)).toBeGreaterThan(0);
      await resolveAnswer();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(readTaskStream).toHaveBeenCalledWith({ agent_id: AGENT_ID });
      expect(container.textContent).toContain('我是DeepSeek最新版本模型，由深度求索公司创造。');
    });
    expect(container.querySelector('[data-builder-live-output="true"]')).toBeNull();
    expect(container.textContent).not.toContain('The answer could not be prepared. Try again.');
    expect(container.querySelector('[data-builder-conversation-notice="answer_failed"]')).toBeNull();
    expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value).toBe('');
    expect(submit).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
  });

  it('does not keep provisional live answer text as a durable answer after terminal failure', async () => {
    const {
      answer,
      container,
      emitGenerationOutput,
      emitGenerationStarted,
      generate,
      resolveAnswer,
      saveDraft,
      submit,
    } = await setup({
      answerActivity: true,
      deferredFailedAnswerAfterFirst: true,
      failAnswerAfterFirst: true,
    });

    setComposerInstruction(container, 'hi');
    await waitForComposerSubmitReady(container);
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(answer).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ instruction: 'hi' }));
      expect(container.textContent).toContain('This answer does not change files.');
    });

    const question = '你是什么大模型';
    setComposerInstruction(container, question);
    await waitForComposerSubmitReady(container);
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(answer).toHaveBeenCalledTimes(2);
    });
    const request = await createBuilderGenerationRequest(question, null);
    expect(emitGenerationStarted(request.request_digest, null)).toBeGreaterThan(0);
    expect(emitGenerationOutput(request.request_digest, '我是 DeepSeek 模型。', null)).toBeGreaterThan(0);

    await waitFor(() => {
      expect(container.querySelector('[data-builder-live-output="true"]')?.textContent)
        .toContain('我是 DeepSeek 模型。');
    });

    await act(async () => {
      await resolveAnswer();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(container.querySelector('[data-builder-conversation-notice="answer_failed"]')?.textContent)
        .toContain('暂时无法完成回答，请重试。');
      expect(container.querySelector('[data-builder-live-output="true"]')).toBeNull();
    });
    expect(container.textContent).toContain('This answer does not change files.');
    expect(container.textContent).not.toContain('我是 DeepSeek 模型。');
    expect(submit).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
  });

  it('incubates a projectless Agent build request as a task proposal', async () => {
    const { container, createTaskProposal, generate, submit } = await setup({
      agentTaskIncubation: true,
    });
    setComposerInstruction(container, 'Make a timer.');
    await waitForComposerSubmitReady(container);
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(createTaskProposal).toHaveBeenCalledOnce();
      expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value).toBe('');
    });
    expect(createTaskProposal).toHaveBeenCalledWith(expect.objectContaining({
      agent_id: AGENT_ID,
      objective: 'Make a timer.',
      requested_outcome: 'build',
      execution_mode: 'foreground',
    }));
    expect(container.querySelector('[data-builder-workspace-picker="true"]')).toBeNull();
    expect(submit).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });

  it.each([false, true])('finishes and shows Agent plan review without another reply (retained project: %s)', async (initiallySaved) => {
    const {
      answerPlan,
      container,
      createTaskProposal,
      emitGenerationOutput,
      emitGenerationStarted,
      resolveAnswer,
      open,
    } = await setup({
      agentTaskIncubation: true,
      deferredAnswer: true,
      initiallySaved,
    });
    if (initiallySaved) {
      click(container, `[data-builder-project-id="${PROJECT_ID}"]`);
      await waitFor(() => expect(open).toHaveBeenCalledWith({ project_id: PROJECT_ID }));
      await waitFor(() => expect(container.querySelector('[data-builder-page="true"]')?.getAttribute(
        'data-builder-project-status',
      )).toBe('ready'));
      click(container, '[data-builder-agent-id]');
    }
    const instruction = '为摄影博客制定完整实施计划。';
    await waitFor(() => {
      expect(container.querySelector('[data-builder-agent-workbench-stream="true"]')).not.toBeNull();
    });
    setComposerInstruction(container, instruction);
    await waitForComposerSubmitReady(container);
    click(container, '[data-builder-composer-add-menu-button="true"]');
    expect(container.querySelector<HTMLButtonElement>(
      '[data-builder-composer-add-plan-mode="true"]',
    )?.disabled).toBe(false);
    click(container, '[data-builder-composer-add-plan-mode="true"]');
    expect(container.querySelector('[data-builder-composer-mode-chip="plan"]')?.textContent)
      .toContain('Plan mode');
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(answerPlan).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ instruction }));
    });
    const request = await createBuilderGenerationRequest(instruction, null);
    expect(emitGenerationStarted(request.request_digest, null)).toBeGreaterThan(0);
    expect(emitGenerationOutput(
      request.request_digest,
      '## 实施计划\n\n1. 建立内容结构\n2. 完成响应式页面',
      null,
    )).toBeGreaterThan(0);
    await waitFor(() => {
      const livePlan = container.querySelector('[data-builder-live-output="true"]');
      expect(livePlan?.textContent).toContain('实施计划');
      expect(livePlan?.textContent).toContain('建立内容结构');
      expect(livePlan?.querySelector('h2')?.textContent).toBe('实施计划');
    });
    expect(createTaskProposal).not.toHaveBeenCalled();
    expect(container.querySelector('[data-builder-agent-plan-decision="true"]')).toBeNull();

    await act(async () => {
      await resolveAnswer();
      await Promise.resolve();
    });
    expect(createTaskProposal).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(container.querySelector('[data-builder-conversation-notice="answer_failed"]')).toBeNull();
      expect(container.querySelector('[data-builder-submit-in-flight="true"]')).toBeNull();
      const review = container.querySelector('[data-builder-agent-plan-decision="true"]');
      expect(review?.textContent).toContain('Ready for review');
      expect(review?.querySelector<HTMLButtonElement>('button')?.disabled).toBe(false);
      expect(container.querySelector('[data-builder-agent-workbench-stream="true"]')).not.toBeNull();
      expect(container.querySelector('[data-builder-live-output="true"]')).toBeNull();
    });
    expect(answerPlan).toHaveBeenCalledOnce();
  });

  it.each(['cancel', 'complete'] as const)('retains an Agent plan across Task navigation until %s', async (ending) => {
    const { container, answerPlan, cancel, emitGenerationStarted, emitGenerationOutput, resolveAnswer } = await setup({
      agentTaskIncubation: true, deferredAnswer: true, initiallySaved: true,
    });
    const instruction = 'Prepare a complete implementation plan.';
    setComposerInstruction(container, instruction);
    click(container, '[data-builder-composer-add-menu-button="true"]');
    click(container, '[data-builder-composer-add-plan-mode="true"]');
    await waitForComposerSubmitReady(container);
    click(container, '[data-builder-submit-turn="true"]');
    await waitFor(() => expect(answerPlan).toHaveBeenCalledOnce());
    const request = await createBuilderGenerationRequest(instruction, null);
    act(() => {
      emitGenerationStarted(request.request_digest, null);
      emitGenerationOutput(request.request_digest, '## Plan\n\nFirst step.', null);
    });
    await waitFor(() => expect(container.querySelector('[data-builder-live-output="true"]')?.textContent).toContain('First step.'));
    click(container, `[data-builder-task-address-id="${TASK_ADDRESS_ID}"]`);
    await waitFor(() => {
      expect(container.querySelector('[data-builder-agent-workbench-stream="true"]')).toBeNull();
      expect(container.querySelector('[data-builder-cancel-work="true"]')).toBeNull();
      expect(container.querySelector('[data-builder-live-output="true"]')).toBeNull();
    });
    expect(cancel).not.toHaveBeenCalled();
    act(() => { emitGenerationOutput(request.request_digest, '\n\nSecond step while hidden.', null); });
    if (ending === 'complete') {
      await act(async () => { await resolveAnswer(); });
      await waitFor(() => expect(container.querySelector('[data-builder-cancel-work="true"]')).toBeNull());
    }
    click(container, '[data-builder-agent-id]');
    await waitFor(() => expect(container.querySelector('[data-builder-composer-mode-chip="plan"]')).not.toBeNull());
    if (ending === 'cancel') {
      await waitFor(() => {
        expect(container.querySelector('[data-builder-cancel-work="true"]')).not.toBeNull();
        expect(container.querySelector('[data-builder-live-output="true"]')?.textContent).toContain('Second step while hidden.');
      });
      click(container, '[data-builder-cancel-work="true"]');
      await waitFor(() => expect(cancel).toHaveBeenCalledExactlyOnceWith({ request_id: request.request_digest }));
      await act(async () => { await resolveAnswer(); });
    }
    await waitFor(() => {
      expect(container.querySelector('[data-builder-cancel-work="true"]')).toBeNull();
      expect(container.querySelector('[data-builder-submit-in-flight="true"]')).toBeNull();
      expect(container.querySelector('[data-builder-live-output="true"]')).toBeNull();
    });
    if (ending === 'complete') {
      await waitFor(() => expect(container.querySelector('[data-builder-agent-plan-decision="true"]')?.textContent).toContain('Ready for review'));
    }
    expect(answerPlan).toHaveBeenCalledOnce();
  });

  it('restores a failed projectless Agent Plan request for an immediate retry', async () => {
    const { answer, answerPlan, container } = await setup({
      answerActivity: true,
      failAnswerAfterFirst: true,
    });
    setComposerInstruction(container, 'hi');
    await waitForComposerSubmitReady(container);
    click(container, '[data-builder-submit-turn="true"]');
    await waitFor(() => expect(answer).toHaveBeenCalledOnce());

    const instruction = '为一个空项目制定完整实施计划。';
    setComposerInstruction(container, instruction);
    click(container, '[data-builder-composer-add-menu-button="true"]');
    click(container, '[data-builder-composer-add-plan-mode="true"]');
    await waitForComposerSubmitReady(container);
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(answerPlan).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ instruction }));
      expect(container.querySelector('[data-builder-conversation-notice="answer_failed"]')).not.toBeNull();
      expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value).toBe(instruction);
    });
  });

  it('does not mistake a retained incomplete Agent plan for a successful answer', async () => {
    const { answer, answerPlan, container } = await setup({
      answerActivity: true, failAnswerAfterFirst: true,
      recordedAnswerAfterFailedPublicResult: true, retainedIncompleteAnswer: true,
    });
    setComposerInstruction(container, 'hi');
    await waitForComposerSubmitReady(container);
    click(container, '[data-builder-submit-turn="true"]');
    await waitFor(() => expect(answer).toHaveBeenCalledOnce());
    const instruction = 'Prepare a complete implementation plan.';
    setComposerInstruction(container, instruction);
    click(container, '[data-builder-composer-add-menu-button="true"]');
    click(container, '[data-builder-composer-add-plan-mode="true"]');
    await waitForComposerSubmitReady(container);
    click(container, '[data-builder-submit-turn="true"]');
    await waitFor(() => {
      expect(answerPlan).toHaveBeenCalledOnce();
      expect(container.querySelector('[data-builder-conversation-notice="answer_failed"]')).not.toBeNull();
      expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value).toBe(instruction);
      expect(container.querySelector('[data-builder-agent-plan-decision="true"]')).toBeNull();
      expect(container.querySelector('[data-builder-cancel-work="true"]')).toBeNull();
    });
  });

  it('auto-starts a foreground Agent task proposal after creating a new project', async () => {
    const {
      container,
      approveCurrentProjectWrite,
      createLocalProject,
      decideTaskProposal,
      generate,
      open,
      prepareCurrentProjectWriteApproval,
      saveDraft,
      submit,
    } = await setup({
      agentTaskProposalMaterializes: true,
      agentTaskProposalPending: true,
      currentProjectWriteApprovalRequired: true,
      initiallySaved: true,
    });

    click(container, `[data-builder-project-id="${PROJECT_ID}"]`);
    await waitFor(() => {
      expect(open).toHaveBeenCalledWith({ project_id: PROJECT_ID });
      expect(container.querySelector('[data-builder-page="true"]')?.getAttribute(
        'data-builder-project-status',
      )).toBe('ready');
    });
    click(container, '[data-builder-agent-id]');
    await waitFor(() => {
      expect(container.querySelector('[data-builder-agent-task-proposal-new-project="true"]')).not.toBeNull();
    });
    const newProjectButton = container.querySelector<HTMLButtonElement>(
      '[data-builder-agent-task-proposal-new-project="true"]',
    );
    expect(newProjectButton?.disabled).toBe(false);
    await act(async () => {
      newProjectButton?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(createLocalProject).toHaveBeenCalledExactlyOnceWith({
        project_id: null,
        project_title: '按这个计划创建一个专注计时器：先写 index.html，再运行检查。',
      });
      expect(decideTaskProposal).toHaveBeenCalledExactlyOnceWith({
        agent_id: AGENT_ID,
        proposal_id: 'builder-task-proposal:123e4567-e89b-42d3-a456-426614174097',
        operation: 'approve_existing_project',
        project_id: PROJECT_ID,
      });
      expect(generate).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
        instruction: '按这个计划创建一个专注计时器：先写 index.html，再运行检查。',
        task_address_id: MATERIALIZED_TASK_ADDRESS_ID,
      }));
    });
    expect(approveCurrentProjectWrite).toHaveBeenCalledExactlyOnceWith({
      project_id: PROJECT_ID,
      task_address_id: MATERIALIZED_TASK_ADDRESS_ID,
    });
    expect(prepareCurrentProjectWriteApproval).toHaveBeenCalledWith({
      project_id: PROJECT_ID,
      task_address_id: MATERIALIZED_TASK_ADDRESS_ID,
    });
    expect(container.querySelector('[data-builder-current-project-write-approval="true"]')).toBeNull();
    await waitFor(() => {
      expect(container.querySelector('[data-builder-submit-in-flight="true"]')).toBeNull();
    });
    expect(submit).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
  });

  it('keeps Agent task proposal project creation single-shot while materialization is pending', async () => {
    const {
      container,
      createLocalProject,
      decideTaskProposal,
      generate,
    } = await setup({
      agentTaskProposalMaterializes: true,
      agentTaskProposalPending: true,
      initiallySaved: true,
    });

    click(container, '[data-builder-agent-id]');
    await waitFor(() => {
      expect(container.querySelector('[data-builder-agent-task-proposal-new-project="true"]')).not.toBeNull();
    });
    const newProjectButton = container.querySelector<HTMLButtonElement>(
      '[data-builder-agent-task-proposal-new-project="true"]',
    );
    expect(newProjectButton?.disabled).toBe(false);
    await act(async () => {
      newProjectButton?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      newProjectButton?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(generate).toHaveBeenCalledOnce();
    });
    expect(createLocalProject).toHaveBeenCalledOnce();
    expect(decideTaskProposal).toHaveBeenCalledOnce();
  });

  it('keeps a gated build turn pending without a composer workspace picker', async () => {
    const { container, createLocalProject, generate, listCurrent, saveDraft, submit } = await setup();
    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea');
    expect(textarea).not.toBeNull();
    act(() => {
      if (textarea) {
        const setter = Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          'value',
        )?.set;
        setter?.call(textarea, 'Make a timer.');
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(container.querySelector('[data-builder-composer="true"]')?.getAttribute('data-builder-route-dispatch'))
        .toBe('ask_workspace');
    });
    expect(container.querySelector('[data-builder-workspace-picker="true"]')).toBeNull();
    expect(createLocalProject).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(listCurrent.mock.results.at(-1)?.value).toBeInstanceOf(Promise);
    expect(container.querySelector('[data-builder-current-version="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();
    expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value).toBe('Make a timer.');
    const composer = container.querySelector('[data-builder-composer="true"]');
    expect(composer?.getAttribute('data-builder-route')).toBe('build');
    expect(composer?.getAttribute('data-builder-route-dispatch')).toBe('ask_workspace');
    expect(composer?.getAttribute('data-builder-route-decision-id')).
      toBe('builder-composer-route-decision:local:1');
    expect(composer?.getAttribute('data-builder-route-message-id')).
      toBe('builder-composer-message:local:1');
    expect(composer?.getAttribute('data-builder-route-project-id')).toBeNull();

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(createLocalProject).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value).toBe('Make a timer.');
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();
  });

  it('does not auto-start the first build after a source folder is bound from the sidebar', async () => {
    const {
      container,
      createLocalProject,
      submit,
    } = await setup({ deferredGenerate: true });
    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea');
    expect(textarea).not.toBeNull();
    act(() => {
      if (textarea) {
        const setter = Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          'value',
        )?.set;
        setter?.call(textarea, 'Make a timer.');
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    click(container, '[data-builder-submit-turn="true"]');
    await waitFor(() => {
      expect(container.querySelector('[data-builder-composer="true"]')?.getAttribute('data-builder-route-dispatch'))
        .toBe('ask_workspace');
    });
    expect(container.querySelector('[data-builder-workspace-picker="true"]')).toBeNull();

    click(container, '[data-builder-catalog-new-project="true"]');
    await waitFor(() => {
      expect(container.querySelector('[data-builder-new-project-panel="true"]')).toBeNull();
    });

    await waitFor(() => {
      expect(createLocalProject).not.toHaveBeenCalled();
    });
    expect(submit).not.toHaveBeenCalled();
    expect(container.querySelector('[data-builder-live-output="true"]')).toBeNull();
    expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value).toBe('');
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();
  });

  it('continues an unsaved draft from the same composer without saving first', async () => {
    const { container, continueDraft, generate, saveDraft, submit } = await setup({ initiallySaved: true });
    await openSavedProject(container);
    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea');
    expect(textarea).not.toBeNull();
    act(() => {
      if (textarea) {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
          ?.call(textarea, 'Make a timer.');
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    click(container, '[data-builder-submit-turn="true"]');
    await waitFor(() => {
      expectDraftDecisionCard(container);
    });
    expect(submit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ instruction: 'Make a timer.' }));
    expect(generate).not.toHaveBeenCalled();
    expect(continueDraft).not.toHaveBeenCalled();
    expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.placeholder)
      .toBe('Ask about this draft, or describe the next change...');

    const draftTextarea = container.querySelector<HTMLTextAreaElement>('#builder-idea');
    act(() => {
      if (draftTextarea) {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
          ?.call(draftTextarea, 'Make it responsive.');
        draftTextarea.dispatchEvent(new Event('input', { bubbles: true }));
        draftTextarea.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(continueDraft).toHaveBeenCalledExactlyOnceWith({
        draft_id: expect.stringMatching(/^builder-generation-draft:/u),
        instruction: 'Make it responsive.',
      });
    });
    expect(submit).toHaveBeenCalledOnce();
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value).toBe('');
    await waitFor(() => {
      expectDraftWaitingForReviewEvidence(container);
    });
  });

  it('continues a current unsaved draft in Auto mode without letting semantic routing turn the edit into chat', async () => {
    const {
      classifyIntent,
      container,
      continueDraft,
      generate,
      saveDraft,
      submit,
    } = await setup({
      initiallySaved: true,
      semanticIntentRoute: 'answer',
    });
    await openSavedProject(container);
    setComposerInstruction(container, 'Make a timer.');
    await waitForComposerSubmitReady(container);
    click(container, '[data-builder-composer-add-menu-button="true"]');
    click(container, '[data-builder-composer-add-build-mode="true"]');
    click(container, '[data-builder-submit-turn="true"]');
    await waitFor(() => {
      expectDraftDecisionCard(container);
    });
    expect(generate).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ instruction: 'Make a timer.' }));
    expect(submit).not.toHaveBeenCalled();
    expect(classifyIntent).not.toHaveBeenCalled();

    click(container, '[data-builder-clear-composer-mode="true"]');
    await waitFor(() => {
      expect(container.querySelector('[data-builder-composer-mode-chip="build"]')).toBeNull();
    });
    setComposerInstruction(container, 'Continue improving the focus timer heading and subtitle.');
    await waitForComposerSubmitReady(container);
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(continueDraft).toHaveBeenCalledExactlyOnceWith({
        draft_id: expect.stringMatching(/^builder-generation-draft:/u),
        instruction: 'Continue improving the focus timer heading and subtitle.',
      });
    });
    expect(classifyIntent).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    expect(generate).toHaveBeenCalledOnce();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value).toBe('');
    await waitFor(() => {
      expectDraftWaitingForReviewEvidence(container);
    });
  });

  it('keeps current-draft plan/proposal wording on the plan route instead of direct draft edits', async () => {
    const {
      answer,
      answerDraft,
      classifyIntent,
      container,
      continueDraft,
      generate,
      saveDraft,
      submit,
    } = await setup({
      initiallySaved: true,
      semanticIntentRoute: 'plan',
    });
    await openSavedProject(container);
    setComposerInstruction(container, 'Make a timer.');
    await waitForComposerSubmitReady(container);
    click(container, '[data-builder-composer-add-menu-button="true"]');
    click(container, '[data-builder-composer-add-build-mode="true"]');
    click(container, '[data-builder-submit-turn="true"]');
    await waitFor(() => {
      expectDraftDecisionCard(container);
    });
    expect(generate).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ instruction: 'Make a timer.' }));
    expect(submit).not.toHaveBeenCalled();
    expect(classifyIntent).not.toHaveBeenCalled();

    click(container, '[data-builder-clear-composer-mode="true"]');
    await waitFor(() => {
      expect(container.querySelector('[data-builder-composer-mode-chip="build"]')).toBeNull();
    });
    setComposerInstruction(container, '给当前文件夹做一个优化方案');
    await waitForComposerSubmitReady(container);
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(answerDraft).toHaveBeenCalledExactlyOnceWith({
        draft_id: expect.stringMatching(/^builder-generation-draft:/u),
        instruction: '给当前文件夹做一个优化方案',
      });
    });
    expect(classifyIntent).not.toHaveBeenCalled();
    expect(answer).not.toHaveBeenCalled();
    expect(continueDraft).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    expect(generate).toHaveBeenCalledOnce();
    expect(saveDraft).not.toHaveBeenCalled();
    const composer = container.querySelector('[data-builder-composer="true"]');
    expect(composer?.getAttribute('data-builder-route')).toBe('plan');
    expect(composer?.getAttribute('data-builder-route-signals')).toBe('clear_plan_deliverable');
  });

  it('creates a clean local project from a gated build without a composer workspace picker', async () => {
    const { container, createLocalProject, generate, saveDraft, submit } = await setup();
    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea');
    expect(textarea).not.toBeNull();
    act(() => {
      if (textarea) {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
          ?.call(textarea, 'Make a timer.');
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(container.querySelector('[data-builder-composer="true"]')?.getAttribute('data-builder-route-dispatch'))
        .toBe('ask_workspace');
      expect(container.querySelector('[data-builder-workspace-picker="true"]')).toBeNull();
    });

    click(container, '[data-builder-composer-add-menu-button="true"]');
    expect(container.querySelector('[data-builder-composer-add-files="true"]')).toBeNull();
    click(container, '[data-builder-catalog-new-project="true"]');
    await waitFor(() => {
      expect(container.querySelector('[data-builder-new-project-panel="true"]')).toBeNull();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(createLocalProject).toHaveBeenCalledExactlyOnceWith({
      project_id: null,
      project_title: 'New project',
    });
    expect(submit).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value).toBe('');
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
  });

  it('keeps edited composer text when build is gated without a source-folder action', async () => {
    const { container, createLocalProject, generate, saveDraft, submit } = await setup();
    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea');
    expect(textarea).not.toBeNull();
    act(() => {
      if (textarea) {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
          ?.call(textarea, 'Make a timer.');
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(container.querySelector('[data-builder-composer="true"]')?.getAttribute('data-builder-route-dispatch'))
        .toBe('ask_workspace');
    });
    expect(container.querySelector('[data-builder-workspace-picker="true"]')).toBeNull();
    act(() => {
      if (textarea) {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
          ?.call(textarea, 'Make a clock.');
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    expect(container.querySelector('[data-builder-workspace-new-project="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-add-source-folder="true"]')).toBeNull();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(createLocalProject).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value).toBe('Make a clock.');
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
  });

  it('auto-opens a single bound unsaved workspace after restart', async () => {
    const { container, createLocalProject, listCurrent, listWorkspaces, open, submit } = await setup({
      workspaceOnlyCatalog: true,
    });

    await waitFor(() => {
      expect(listCurrent).toHaveBeenCalled();
      expect(listWorkspaces).toHaveBeenCalled();
      expect(open).toHaveBeenCalledWith({ project_id: PROJECT_ID });
      expect(container.querySelector('[data-builder-workspace-chip="true"]')).toBeNull();
    });

    expect(createLocalProject).not.toHaveBeenCalled();
    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea');
    act(() => {
      if (textarea) {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
          ?.call(textarea, 'Make a timer.');
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(submit).toHaveBeenCalledOnce();
    });
  });

  it('restores a pending draft after auto-opening a single unsaved workspace', async () => {
    const { container, listCurrent, listWorkspaces, open, readTaskStream, restoreDraft, saveDraft } = await setup({
      pendingActivity: true,
      restoreAvailable: true,
      workspaceOnlyCatalog: true,
    });

    await waitFor(() => {
      expect(listCurrent).toHaveBeenCalled();
      expect(listWorkspaces).toHaveBeenCalled();
      expect(open).toHaveBeenCalledWith({ project_id: PROJECT_ID });
    });
    await waitFor(() => {
      expect(readTaskStream).toHaveBeenCalledWith({ project_id: PROJECT_ID, task_address_id: TASK_ADDRESS_ID });
      expect(restoreDraft).toHaveBeenCalledExactlyOnceWith({
        draft_id: expect.stringMatching(/^builder-generation-draft:/u),
      });
      expect(container.querySelector('[data-builder-unsaved-draft="true"]')).not.toBeNull();
    });
    expect(container.querySelector('[data-builder-current-version="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-workspace-chip="true"]')).toBeNull();
    expectDraftDecisionCard(container);
    expect(saveDraft).not.toHaveBeenCalled();
  });

  it('does not open an existing bound workspace from a gated composer build', async () => {
    const { container, createLocalProject, listCurrent, listWorkspaces, open, submit } = await setup({
      multipleWorkspaceOnlyCatalog: true,
    });

    await waitFor(() => {
      expect(listCurrent).toHaveBeenCalled();
      expect(listWorkspaces).toHaveBeenCalled();
    });
    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea');
    expect(textarea).not.toBeNull();
    act(() => {
      if (textarea) {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
          ?.call(textarea, 'Make a timer.');
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(container.querySelector('[data-builder-composer="true"]')?.getAttribute('data-builder-route-dispatch'))
        .toBe('ask_workspace');
      expect(container.querySelector('[data-builder-workspace-picker="true"]')).toBeNull();
    });
    expect(open).not.toHaveBeenCalled();
    expect(createLocalProject).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value).toBe('Make a timer.');
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
  });

  it('keeps a later build turn gated when there is no composer workspace picker', async () => {
    const { answer, container, createLocalProject, generate, saveDraft, submit } = await setup({
      answerActivity: true,
    });
    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea');
    expect(textarea).not.toBeNull();
    act(() => {
      if (textarea) {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
          ?.call(textarea, 'hi');
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(answer).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ instruction: 'hi' }));
    });
    expect(submit).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value).toBe('');
    await waitFor(() => {
      expect(container.querySelector<HTMLButtonElement>('[data-builder-submit-turn="true"]')).not.toBeNull();
    });

    const buildTextarea = container.querySelector<HTMLTextAreaElement>('#builder-idea');
    expect(buildTextarea).not.toBeNull();
    act(() => {
      if (buildTextarea) {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
          ?.call(buildTextarea, 'Make a timer.');
        buildTextarea.dispatchEvent(new Event('input', { bubbles: true }));
        buildTextarea.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    await waitFor(() => {
      expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value)
        .toBe('Make a timer.');
    });
    const send = container.querySelector<HTMLButtonElement>('[data-builder-submit-turn="true"]');
    expect(send?.disabled).toBe(false);
    act(() => send?.click());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(answer).toHaveBeenCalledOnce();
    expect(submit).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(container.querySelector('[data-builder-composer="true"]')?.getAttribute('data-builder-route-dispatch'))
        .toBe('ask_workspace');
    });
    expect(container.querySelector('[data-builder-workspace-picker="true"]')).toBeNull();
    expect(createLocalProject).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();

    expect(container.querySelector('[data-builder-workspace-new-project="true"]')).toBeNull();
    expect(createLocalProject).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value).toBe('Make a timer.');
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();
  });

  it('routes clear Chinese edit turns to workspace gating before any draft work', async () => {
    const { answer, container, createLocalProject, generate, saveDraft, submit } = await setup();
    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea');
    expect(textarea).not.toBeNull();
    act(() => {
      if (textarea) {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
          ?.call(textarea, '把按钮颜色改红');
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });

    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(container.querySelector('[data-builder-composer="true"]')?.getAttribute('data-builder-route-dispatch'))
        .toBe('ask_workspace');
    });
    expect(container.querySelector('[data-builder-workspace-picker="true"]')).toBeNull();
    expect(answer).not.toHaveBeenCalled();
    expect(createLocalProject).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
    expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value)
      .toBe('把按钮颜色改红');
  });

  it('routes clear Chinese 3D build turns to submit once a workspace is bound', async () => {
    const { answer, container, createLocalProject, generate, saveDraft, submit } = await setup({
      initiallySaved: true,
    });
    await openSavedProject(container);
    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea');
    expect(textarea).not.toBeNull();
    act(() => {
      if (textarea) {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
          ?.call(textarea, '帮我做一个网页3D');
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });

    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(submit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ instruction: '帮我做一个网页3D' }));
    });
    expect(answer).not.toHaveBeenCalled();
    expect(createLocalProject).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(container.querySelector('[data-builder-workspace-picker="true"]')).toBeNull();
    expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value).toBe('');
    await waitFor(() => {
      expectDraftDecisionCard(container);
    });
  });

  it('routes local Markdown artifact requests to project-bound draft generation', async () => {
    const { answer, container, createLocalProject, generate, saveDraft, submit } = await setup({
      initiallySaved: true,
    });
    await openSavedProject(container);
    setComposerInstruction(container, '新建一个 README.md，写项目说明');
    await waitForComposerSubmitReady(container);

    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(submit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ instruction: '新建一个 README.md，写项目说明' }));
    });
    expect(answer).not.toHaveBeenCalled();
    expect(createLocalProject).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(container.querySelector('[data-builder-workspace-picker="true"]')).toBeNull();
    const composer = container.querySelector('[data-builder-composer="true"]');
    expect(composer?.getAttribute('data-builder-route')).toBe('build');
    expect(composer?.getAttribute('data-builder-route-signals')).toBe('local_file_artifact');
    expect(composer?.getAttribute('data-builder-route-dispatch')).toBe('build');
    expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value).toBe('');
  });

  it('asks for current-project write approval before a selected workspace build can start', async () => {
    const {
      approveCurrentProjectWrite,
      container,
      generate,
      prepareCurrentProjectWriteApproval,
      saveDraft,
      submit,
    } = await setup({
      currentProjectWriteApprovalRequired: true,
      initiallySaved: true,
    });
    await openSavedProject(container);
    setComposerInstruction(container, 'Make a timer.');
    await waitForComposerSubmitReady(container);

    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(prepareCurrentProjectWriteApproval).toHaveBeenCalledExactlyOnceWith({
        project_id: PROJECT_ID,
        task_address_id: TASK_ADDRESS_ID,
      });
      expect(container.querySelector('[data-builder-current-project-write-approval="true"]')?.textContent)
        .toContain('Allow current project changes?');
    });
    expect(submit).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value).toBe('');
    const composer = container.querySelector('[data-builder-composer="true"]');
    expect(composer?.getAttribute('data-builder-route')).toBe('build');
    expect(composer?.getAttribute('data-builder-route-dispatch')).toBe('ask_permission');
    expect(composer?.getAttribute('data-builder-route-permission')).toBe('ask');

    click(container, 'Allow and continue');

    await waitFor(() => {
      expect(approveCurrentProjectWrite).toHaveBeenCalledExactlyOnceWith({
        project_id: PROJECT_ID,
        task_address_id: TASK_ADDRESS_ID,
      });
      expect(submit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ instruction: 'Make a timer.' }));
      expect(container.querySelector('[data-builder-current-project-write-approval="true"]')).toBeNull();
      expectDraftDecisionCard(container);
    });
    expect(JSON.stringify(approveCurrentProjectWrite.mock.calls)).not.toMatch(
      /resource_id|permission_id|source_tree|credential|provider/iu,
    );
  });

  it('continues a pending build when Allow current project is selected from the composer menu', async () => {
    const {
      approveCurrentProjectWrite,
      container,
      generate,
      prepareCurrentProjectWriteApproval,
      saveDraft,
      submit,
    } = await setup({
      currentProjectWriteApprovalRequired: true,
      initiallySaved: true,
    });
    await openSavedProject(container);
    setComposerInstruction(container, 'Make a timer.');
    await waitForComposerSubmitReady(container);

    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(container.querySelector('[data-builder-current-project-write-approval="true"]')?.textContent)
        .toContain('Allow current project changes?');
      expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value).toBe('');
    });

    click(container, '[data-builder-composer-approval-menu-button="true"]');
    click(container, '[data-builder-composer-approval-mode-option="allow_current_project"]');

    await waitFor(() => {
      expect(approveCurrentProjectWrite).toHaveBeenCalledExactlyOnceWith({
        project_id: PROJECT_ID,
        task_address_id: TASK_ADDRESS_ID,
      });
      expect(submit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ instruction: 'Make a timer.' }));
      expect(container.querySelector('[data-builder-current-project-write-approval="true"]')).toBeNull();
      expect(container.querySelector('[data-builder-approval-mode-chip="true"]')).toBeNull();
      expectDraftDecisionCard(container);
    });
    expect(prepareCurrentProjectWriteApproval).toHaveBeenCalledTimes(2);
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
  });

  it('restores the build request to the composer when current-project write approval is dismissed', async () => {
    const {
      approveCurrentProjectWrite,
      container,
      generate,
      prepareCurrentProjectWriteApproval,
      saveDraft,
      submit,
    } = await setup({
      currentProjectWriteApprovalRequired: true,
      initiallySaved: true,
    });
    await openSavedProject(container);
    setComposerInstruction(container, 'Make a timer.');
    await waitForComposerSubmitReady(container);

    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(container.querySelector('[data-builder-current-project-write-approval="true"]')?.textContent)
        .toContain('Allow current project changes?');
      expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value).toBe('');
    });

    click(container, 'Not now');

    await waitFor(() => {
      expect(container.querySelector('[data-builder-current-project-write-approval="true"]')).toBeNull();
      expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value).toBe('Make a timer.');
    });
    expect(prepareCurrentProjectWriteApproval).toHaveBeenCalledExactlyOnceWith({
      project_id: PROJECT_ID,
      task_address_id: TASK_ADDRESS_ID,
    });
    expect(approveCurrentProjectWrite).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
  });

  it('keeps explicit build requests in chat while read-only approval mode is selected', async () => {
    const {
      answer,
      approveCurrentProjectWrite,
      container,
      generate,
      prepareCurrentProjectWriteApproval,
      saveDraft,
      submit,
    } = await setup({
      initiallySaved: true,
    });
    await openSavedProject(container);

    click(container, '[data-builder-composer-approval-menu-button="true"]');
    click(container, '[data-builder-composer-approval-mode-option="read_only_chat"]');

    expect(container.querySelector('[data-builder-approval-mode-chip="true"]')).toBeNull();

    setComposerInstruction(container, 'Make a timer.');
    await waitForComposerSubmitReady(container);
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(answer).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ instruction: 'Make a timer.' }));
    });
    expect(submit).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(prepareCurrentProjectWriteApproval).not.toHaveBeenCalled();
    expect(approveCurrentProjectWrite).not.toHaveBeenCalled();
    expect(container.querySelector('[data-builder-current-project-write-approval="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
    const composer = container.querySelector('[data-builder-composer="true"]');
    expect(composer?.getAttribute('data-builder-route')).toBe('build');
    expect(composer?.getAttribute('data-builder-route-dispatch')).toBe('blocked');
    expect(composer?.getAttribute('data-builder-route-permission')).toBe('denied');
  });

  it('records allow-current-project mode through main approval before a build', async () => {
    const {
      answer,
      approveCurrentProjectWrite,
      container,
      generate,
      prepareCurrentProjectWriteApproval,
      saveDraft,
      submit,
    } = await setup({
      currentProjectWriteApprovalRequired: true,
      initiallySaved: true,
    });
    await openSavedProject(container);

    click(container, '[data-builder-composer-approval-menu-button="true"]');
    click(container, '[data-builder-composer-approval-mode-option="allow_current_project"]');

    await waitFor(() => {
      expect(approveCurrentProjectWrite).toHaveBeenCalledExactlyOnceWith({
        project_id: PROJECT_ID,
        task_address_id: TASK_ADDRESS_ID,
      });
      expect(container.querySelector('[data-builder-approval-mode-chip="true"]')).toBeNull();
    });

    setComposerInstruction(container, 'Make a timer.');
    await waitForComposerSubmitReady(container);
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(prepareCurrentProjectWriteApproval).toHaveBeenCalledExactlyOnceWith({
        project_id: PROJECT_ID,
        task_address_id: TASK_ADDRESS_ID,
      });
      expect(submit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ instruction: 'Make a timer.' }));
    });
    expect(answer).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(container.querySelector('[data-builder-current-project-write-approval="true"]')).toBeNull();
    const composer = container.querySelector('[data-builder-composer="true"]');
    expect(composer?.getAttribute('data-builder-route')).toBe('build');
    expect(composer?.getAttribute('data-builder-route-dispatch')).toBe('build');
    expect(composer?.getAttribute('data-builder-route-permission')).toBe('allowed');
    expect(JSON.stringify(approveCurrentProjectWrite.mock.calls)).not.toMatch(
      /resource_id|permission_id|source_tree|credential|provider/iu,
    );
  });

  it('keeps exploratory workspace turns in chat after a source folder is bound', async () => {
    const { answer, container, createLocalProject, generate, saveDraft, submit } = await setup({
      answerActivity: true,
      initiallySaved: true,
    });
    await openSavedProject(container);

    for (const instruction of [
      '我想先聊一下这个页面怎么做',
      '我们先确定风格',
      '我打算做一个周杰伦相关的网站，帮我出下方案',
      '我想创建一个登录页，你觉得怎么设计',
      '可以帮我做一个登录页吗？',
      'Can you build a login page?',
      'Should we create a dashboard first?',
      '这里字都重叠了',
      '右侧内容挤坏了',
    ]) {
      const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea');
      expect(textarea).not.toBeNull();
      act(() => {
        if (textarea) {
          Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
            ?.call(textarea, instruction);
          textarea.dispatchEvent(new Event('input', { bubbles: true }));
          textarea.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
      await waitFor(() => {
        expect(container.querySelector<HTMLButtonElement>('[data-builder-submit-turn="true"]')?.disabled)
          .toBe(false);
      });

      click(container, '[data-builder-submit-turn="true"]');

      await waitFor(() => {
        expect(answer).toHaveBeenCalledExactlyOnceWith({
          instruction,
          task_address_id: TASK_ADDRESS_ID,
        });
      });
      expect(submit).not.toHaveBeenCalled();
      expect(createLocalProject).not.toHaveBeenCalled();
      expect(generate).not.toHaveBeenCalled();
      expect(saveDraft).not.toHaveBeenCalled();
      expect(container.querySelector('[data-builder-workspace-picker="true"]')).toBeNull();
      expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();
      expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
      expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value).toBe('');
      answer.mockClear();
    }
  });

  it('keeps exploratory product intent in read-only chat after a workspace is selected', async () => {
    const { answer, container, createLocalProject, generate, saveDraft, submit } = await setup({
      briefUpdateActivity: true,
      initiallySaved: true,
    });
    await openSavedProject(container);

    setComposerInstruction(container, '我想做一个登录页');
    await waitForComposerSubmitReady(container);
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(answer).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ instruction: '我想做一个登录页' }));
    });
    expect(submit).not.toHaveBeenCalled();
    expect(createLocalProject).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(container.querySelector('[data-builder-current-project-write-approval="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-workspace-picker="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
    const composer = container.querySelector('[data-builder-composer="true"]');
    expect(composer?.getAttribute('data-builder-route')).toBe('update_brief');
    expect(composer?.getAttribute('data-builder-route-dispatch')).toBe('brief_update');
    expect(composer?.getAttribute('data-builder-route-task-id')).toBeNull();
    expect(container.querySelector('[data-builder-composer-brief="true"]')).toBeNull();
    expect(container.textContent).not.toContain('Current brief');
    await waitFor(() => {
      expect(container.textContent).toContain('星空背景');
    });
  });

  it('does not treat future Goal mode requests as current build or brief authority', async () => {
    const { answer, container, createLocalProject, generate, saveDraft, submit } = await setup({
      answerActivity: true,
      initiallySaved: true,
    });
    await openSavedProject(container);

    setComposerInstruction(container, '进入目标模式，一直帮我改到完成为止');
    await waitForComposerSubmitReady(container);
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(answer).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ instruction: '进入目标模式，一直帮我改到完成为止' }));
    });
    expect(submit).not.toHaveBeenCalled();
    expect(createLocalProject).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(container.querySelector('[data-builder-current-project-write-approval="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-workspace-picker="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
    const composer = container.querySelector('[data-builder-composer="true"]');
    expect(composer?.getAttribute('data-builder-route')).toBe('clarify');
    expect(composer?.getAttribute('data-builder-route-dispatch')).toBe('reply');
    expect(composer?.getAttribute('data-builder-route-permission')).toBe('not_required');
    expect(composer?.getAttribute('data-builder-route-signals')).toBe('goal_mode_request');
  });

  it('keeps context updates internal while removing the Brief menu entry', async () => {
    const { answer, container, createLocalProject, generate, saveDraft, submit } = await setup({
      briefUpdateActivity: true,
      initiallySaved: true,
    });
    await openSavedProject(container);

    click(container, '[data-builder-composer-add-menu-button="true"]');
    const addMenu = container.querySelector('[data-builder-composer-add-menu="true"]');
    expect(addMenu?.textContent).not.toContain('Brief');
    expect(container.querySelector('[data-builder-composer-add-brief="true"]')).toBeNull();

    const instruction = '保存这个方向，后面按这个来：目标用户是小团队，视觉要克制';
    setComposerInstruction(container, instruction);
    await waitForComposerSubmitReady(container);
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(answer).toHaveBeenCalledExactlyOnceWith({
        instruction,
        task_address_id: TASK_ADDRESS_ID,
      });
    });
    expect(submit).not.toHaveBeenCalled();
    expect(createLocalProject).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(container.querySelector('[data-builder-current-project-write-approval="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
    const composer = container.querySelector('[data-builder-composer="true"]');
    expect(composer?.getAttribute('data-builder-route')).toBe('update_brief');
    expect(composer?.getAttribute('data-builder-route-dispatch')).toBe('brief_update');
    expect(composer?.getAttribute('data-builder-route-signals')).toBe('explicit_brief');
    expect(container.querySelector('[data-builder-composer-brief="true"]')).toBeNull();
    expect(container.textContent).not.toContain('Current brief');
  });

  it('projects the latest route decision for chat, brief update, and admitted build turns', async () => {
    const { answer, container, submit } = await setup({
      briefUpdateActivity: true,
      initiallySaved: true,
    });
    await openSavedProject(container);

    setComposerInstruction(container, 'hi');
    await waitForComposerSubmitReady(container);
    click(container, '[data-builder-submit-turn="true"]');
    await waitFor(() => {
      expect(answer).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ instruction: 'hi' }));
    });
    let composer = container.querySelector('[data-builder-composer="true"]');
    expect(composer?.getAttribute('data-builder-route')).toBe('answer');
    expect(composer?.getAttribute('data-builder-route-dispatch')).toBe('reply');
    expect(composer?.getAttribute('data-builder-route-permission')).toBe('not_required');
    expect(composer?.getAttribute('data-builder-route-signals')).toBe('read_only');
    expect(composer?.getAttribute('data-builder-route-decision-id')).
      toBe('builder-composer-route-decision:local:1');
    expect(composer?.getAttribute('data-builder-route-message-id')).
      toBe('builder-composer-message:local:1');
    expect(composer?.getAttribute('data-builder-route-project-id')).toBe(PROJECT_ID);
    expect(composer?.getAttribute('data-builder-route-task-id')).toBeNull();
    expect(composer?.getAttribute('data-builder-route-created-at')).
      toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u);

    answer.mockClear();
    setComposerInstruction(container, '我想做一个登录页');
    await waitForComposerSubmitReady(container);
    click(container, '[data-builder-submit-turn="true"]');
    await waitFor(() => {
      expect(answer).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ instruction: '我想做一个登录页' }));
    });
    expect(submit).not.toHaveBeenCalled();
    composer = container.querySelector('[data-builder-composer="true"]');
    expect(composer?.getAttribute('data-builder-route')).toBe('update_brief');
    expect(composer?.getAttribute('data-builder-route-dispatch')).toBe('brief_update');
    expect(composer?.getAttribute('data-builder-route-permission')).toBe('not_required');
    expect(composer?.getAttribute('data-builder-route-signals')).toBe('exploratory_work');
    expect(composer?.getAttribute('data-builder-route-decision-id')).
      toBe('builder-composer-route-decision:local:2');
    expect(composer?.getAttribute('data-builder-route-message-id')).
      toBe('builder-composer-message:local:2');
    expect(composer?.getAttribute('data-builder-route-project-id')).toBe(PROJECT_ID);
    expect(composer?.getAttribute('data-builder-route-task-id')).toBeNull();
    expect(container.querySelector('[data-builder-composer-brief="true"]')).toBeNull();
    answer.mockClear();

    setComposerInstruction(container, '把按钮颜色改红');
    await waitForComposerSubmitReady(container);
    click(container, '[data-builder-submit-turn="true"]');
    await waitFor(() => {
      expect(submit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ instruction: '把按钮颜色改红' }));
    });
    composer = container.querySelector('[data-builder-composer="true"]');
    expect(composer?.getAttribute('data-builder-route')).toBe('build');
    expect(composer?.getAttribute('data-builder-route-dispatch')).toBe('build');
    expect(composer?.getAttribute('data-builder-route-permission')).toBe('allowed');
    expect(composer?.getAttribute('data-builder-route-signals')).toBe('clear_build');
    expect(composer?.getAttribute('data-builder-route-decision-id')).
      toBe('builder-composer-route-decision:local:3');
    expect(composer?.getAttribute('data-builder-route-message-id')).
      toBe('builder-composer-message:local:3');
    expect(composer?.getAttribute('data-builder-route-project-id')).toBe(PROJECT_ID);
    expect(composer?.getAttribute('data-builder-route-task-id')).toBe(PENDING_TASK_ID);
  });

  it('builds from a contextual execution phrase only after prior discussion creates work context', async () => {
    const { answer, container, createLocalProject, generate, saveDraft, submit } = await setup({
      contextualBuildActivity: true,
      initiallySaved: true,
    });
    await openSavedProject(container);
    await waitFor(() => {
      expect(container.textContent).toContain('作品集首页');
      expect(container.querySelector('[data-builder-composer-status="true"]')).toBeNull();
    });
    expect(container.textContent).not.toMatch(/working_brief|recent_chat_proposal|builder-conversation/iu);

    const discussionTextarea = container.querySelector<HTMLTextAreaElement>('#builder-idea');
    expect(discussionTextarea).not.toBeNull();
    act(() => {
      if (discussionTextarea) {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
          ?.call(discussionTextarea, '我想先聊一下这个页面怎么做');
        discussionTextarea.dispatchEvent(new Event('input', { bubbles: true }));
        discussionTextarea.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    await waitFor(() => {
      expect(container.querySelector<HTMLButtonElement>('[data-builder-submit-turn="true"]')?.disabled)
        .toBe(false);
    });
    click(container, '[data-builder-submit-turn="true"]');
    await waitFor(() => {
      expect(answer).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ instruction: '我想先聊一下这个页面怎么做' }));
    });
    expect(submit).not.toHaveBeenCalled();

    const executeTextarea = container.querySelector<HTMLTextAreaElement>('#builder-idea');
    expect(executeTextarea).not.toBeNull();
    act(() => {
      if (executeTextarea) {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
          ?.call(executeTextarea, '按刚才方案做');
        executeTextarea.dispatchEvent(new Event('input', { bubbles: true }));
        executeTextarea.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    await waitFor(() => {
      expect(container.querySelector<HTMLButtonElement>('[data-builder-submit-turn="true"]')?.disabled)
        .toBe(false);
    });
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(submit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ instruction: '按刚才方案做' }));
    });
    expect(answer).toHaveBeenCalledOnce();
    expect(createLocalProject).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(container.querySelector('[data-builder-workspace-picker="true"]')).toBeNull();
    expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value).toBe('');
  });

  it('builds from natural Chinese rewrite shortcuts when current result context exists', async () => {
    const { answer, container, createLocalProject, generate, saveDraft, submit } = await setup({
      contextualBuildActivity: true,
      initiallySaved: true,
    });
    await openSavedProject(container);
    await waitFor(() => {
      expect(container.querySelector('[data-builder-composer-status="true"]')).toBeNull();
    });
    expect(container.querySelector('[data-builder-composer-brief="true"]')).toBeNull();

    setComposerInstruction(container, '那就写');
    await waitForComposerSubmitReady(container);
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(submit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ instruction: '那就写' }));
    });
    expect(answer).not.toHaveBeenCalled();
    expect(createLocalProject).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    const composer = container.querySelector('[data-builder-composer="true"]');
    expect(composer?.getAttribute('data-builder-route')).toBe('build');
    expect(composer?.getAttribute('data-builder-route-dispatch')).toBe('build');
    expect(composer?.getAttribute('data-builder-route-signals')).toBe('contextual_build_phrase');
    expect(composer?.getAttribute('data-builder-route-task-id')).toBe(PENDING_TASK_ID);
  });

  it('builds concise current-result edits when current result context exists', async () => {
    const { answer, container, createLocalProject, generate, saveDraft, submit } = await setup({
      contextualBuildActivity: true,
      initiallySaved: true,
    });
    await openSavedProject(container);
    await waitFor(() => {
      expect(container.textContent).toContain('作品集首页');
    });

    setComposerInstruction(container, '改下颜色');
    await waitForComposerSubmitReady(container);
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(submit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ instruction: '改下颜色' }));
    });
    expect(answer).not.toHaveBeenCalled();
    expect(createLocalProject).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    const composer = container.querySelector('[data-builder-composer="true"]');
    expect(composer?.getAttribute('data-builder-route')).toBe('build');
    expect(composer?.getAttribute('data-builder-route-dispatch')).toBe('build');
    expect(composer?.getAttribute('data-builder-route-signals')).toBe('current_artifact_direct_change');
    expect(composer?.getAttribute('data-builder-route-task-id')).toBe(PENDING_TASK_ID);
  });

  it('confirms the latest assistant execution proposal with a short Chinese answer', async () => {
    const { answer, container, createLocalProject, generate, saveDraft, submit } = await setup({
      initiallySaved: true,
      pendingBuildConfirmationActivity: true,
    });
    await openSavedProject(container);
    await waitFor(() => {
      expect(container.textContent).toContain('需要我直接修改这些颜色吗？');
    });

    setComposerInstruction(container, '要');
    await waitForComposerSubmitReady(container);
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(submit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ instruction: '要' }));
    });
    expect(answer).not.toHaveBeenCalled();
    expect(createLocalProject).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    const composer = container.querySelector('[data-builder-composer="true"]');
    expect(composer?.getAttribute('data-builder-route')).toBe('build');
    expect(composer?.getAttribute('data-builder-route-dispatch')).toBe('build');
    expect(composer?.getAttribute('data-builder-route-signals')).toBe('pending_build_confirmation');
    expect(composer?.getAttribute('data-builder-route-task-id')).toBe(TASK_ID);
  });

  it('keeps isolated short confirmations in chat when no assistant execution proposal is pending', async () => {
    const { answer, container, createLocalProject, generate, saveDraft, submit } = await setup({
      contextualBuildActivity: true,
      initiallySaved: true,
    });
    await openSavedProject(container);
    await waitFor(() => {
      expect(container.textContent).toContain('作品集首页');
    });

    setComposerInstruction(container, '要');
    await waitForComposerSubmitReady(container);
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(answer).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ instruction: '要' }));
    });
    expect(submit).not.toHaveBeenCalled();
    expect(createLocalProject).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    const composer = container.querySelector('[data-builder-composer="true"]');
    expect(composer?.getAttribute('data-builder-route')).toBe('answer');
    expect(composer?.getAttribute('data-builder-route-dispatch')).toBe('reply');
    expect(composer?.getAttribute('data-builder-route-signals')).toBe('chat_default');
  });

  it('uses main-owned context status projection before falling back to task stream inference', async () => {
    const taskStreamWire = {
      ...createContextualBuildTaskStreamWire(),
      context_status_projection: {
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
      },
    };
    const { container } = await setup({
      initiallySaved: true,
      taskStreamWireOverride: taskStreamWire,
    });
    await openSavedProject(container);

    await waitFor(() => {
      const status = container.querySelector('[data-builder-composer-status="true"]');
      expect(status?.textContent).toContain('Handoff received');
      expect(status?.getAttribute('data-builder-composer-context-status')).toBe('handoff_received');
    });
    expect(container.querySelector('[data-builder-composer-status="true"]')?.textContent)
      .not.toContain('Ready to execute current direction');
    expect(container.textContent).not.toMatch(/WorkingContext|builder-handoff-packet|sha256:|provider_secret|credential/iu);
  });

  it('uses main-owned provider context disclosure status as the live composer status', async () => {
    const taskStreamWire = {
      ...createContextualBuildTaskStreamWire(),
      context_status_projection: {
        projection_version: 'builder-context-status-projection.v1',
        label: 'Ready to execute current direction',
        tone: 'success',
        next_action_hint: 'You can ask me to make the change.',
        has_pending_handoff: false,
        pending_handoff_count: 0,
        needs_confirmation: false,
        can_contextual_execute: true,
        authority: {
          projection_authority: 'main_owned_context_status_projection_v1',
          working_context_state: 'verified_not_exposed',
          pending_handoff_packets: 'none',
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
      },
      provider_context_disclosure_status_projection: providerContextDisclosureStatusProjection(),
    };
    const { container } = await setup({
      initiallySaved: true,
      taskStreamWireOverride: taskStreamWire,
    });
    await openSavedProject(container);

    await waitFor(() => {
      const status = container.querySelector('[data-builder-composer-status="true"]');
      expect(status?.textContent).toContain('Allow AI to use current context');
      expect(status?.getAttribute('data-builder-composer-provider-context-status')).toBe('needs_approval');
      expect(status?.getAttribute('data-builder-composer-context-status')).toBeNull();
    });
    expect(container.textContent).not.toContain('Ready to execute current direction');
    expect(container.textContent)
      .not.toMatch(/builder-provider-context|builder-context-assembly|sha256:|provider_secret|credential|permission_id/iu);
  });

  it('approves current provider context disclosure from the permissions panel only by project and conversation', async () => {
    const taskStreamWire = {
      ...createContextualBuildTaskStreamWire(),
      provider_context_disclosure_status_projection: providerContextDisclosureStatusProjection(),
    };
    const { approveCurrentProviderContextDisclosure, container } = await setup({
      initiallySaved: true,
      taskStreamWireOverride: taskStreamWire,
    });
    await openSavedProject(container);

    click(container, '[data-builder-workspace-menu-button="true"]');
    click(container, '[data-builder-workspace-control-tab="permissions"]');
    await waitFor(() => {
      expect(container.querySelector('[data-builder-approve-provider-context-disclosure="true"]'))
        .not.toBeNull();
    });

    click(container, '[data-builder-approve-provider-context-disclosure="true"]');

    await waitFor(() => {
      expect(approveCurrentProviderContextDisclosure).toHaveBeenCalledExactlyOnceWith({
        project_id: PROJECT_ID,
        conversation_id: CONVERSATION_ID,
      });
    });
    expect(JSON.stringify(approveCurrentProviderContextDisclosure.mock.calls)).not.toMatch(
      /builder-provider-context-disclosure-request|builder-context-assembly|sha256:|provider_context|source_tree|credential|permission_id/iu,
    );
  });

  it('keeps current brief memory hidden before contextual execution', async () => {
    const { answer, container, createLocalProject, generate, saveDraft, submit } = await setup({
      contextualBuildActivity: true,
      initiallySaved: true,
    });
    await openSavedProject(container);
    await waitFor(() => {
      expect(container.querySelector('[data-builder-composer-status="true"]')).toBeNull();
    });
    expect(container.querySelector('[data-builder-composer-brief="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-clear-composer-brief="true"]')).toBeNull();
    const composer = container.querySelector('[data-builder-composer="true"]');
    expect(composer?.textContent).not.toContain('Current brief');
    expect(composer?.textContent).not.toContain('星空背景');
    expect(composer?.textContent).not.toContain('项目卡片');
    expect(composer?.textContent)
      .not.toMatch(/working_brief|recent_chat_proposal|builder-conversation|sha256:|provider|credential|source_tree|receipt/iu);

    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea');
    expect(textarea).not.toBeNull();
    act(() => {
      if (textarea) {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
          ?.call(textarea, '按刚才方案做');
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(submit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ instruction: '按刚才方案做' }));
    });
    expect(answer).not.toHaveBeenCalled();
    expect(createLocalProject).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
  });

  it('routes contextual execution phrases to the project picker before a workspace is bound', async () => {
    const { answer, container, createLocalProject, generate, saveDraft, submit } = await setup({
      contextualBuildActivity: true,
    });
    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea');
    expect(textarea).not.toBeNull();
    act(() => {
      if (textarea) {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
          ?.call(textarea, '这个方案是什么');
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(answer).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ instruction: '这个方案是什么' }));
      expect(container.textContent).toContain('作品集首页');
    });

    const executionTextarea = container.querySelector<HTMLTextAreaElement>('#builder-idea');
    expect(executionTextarea).not.toBeNull();
    act(() => {
      if (executionTextarea) {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
          ?.call(executionTextarea, '就这样做');
        executionTextarea.dispatchEvent(new Event('input', { bubbles: true }));
        executionTextarea.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(container.querySelector('[data-builder-composer="true"]')?.getAttribute('data-builder-route-dispatch'))
        .toBe('ask_workspace');
    });
    expect(container.querySelector('[data-builder-workspace-picker="true"]')).toBeNull();
    expect(answer).toHaveBeenCalledOnce();
    expect(createLocalProject).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
    expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value).toBe('就这样做');
  });

  it('keeps execution phrases in chat after explanatory page questions without a proposal', async () => {
    const { answer, container, createLocalProject, generate, saveDraft, submit } = await setup({
      initiallySaved: true,
      readOnlyPageQuestionActivity: true,
    });
    await openSavedProject(container);
    await waitFor(() => {
      expect(container.textContent).toContain('为什么这个页面预览空白？');
    });
    expect(container.querySelector('[data-builder-composer-status="true"]')).toBeNull();
    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea');
    expect(textarea).not.toBeNull();
    act(() => {
      if (textarea) {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
          ?.call(textarea, '开始吧');
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });

    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(answer).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ instruction: '开始吧' }));
    });
    expect(submit).not.toHaveBeenCalled();
    expect(createLocalProject).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(container.querySelector('[data-builder-workspace-picker="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
    expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value).toBe('');
  });

  it('routes natural approval phrases to submit once a workspace is bound', async () => {
    const { answer, container, createLocalProject, generate, saveDraft, submit } = await setup({
      contextualBuildActivity: true,
      initiallySaved: true,
    });
    await openSavedProject(container);
    await waitFor(() => {
      expect(container.textContent).toContain('作品集首页');
    });
    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea');
    expect(textarea).not.toBeNull();
    act(() => {
      if (textarea) {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
          ?.call(textarea, '好，开始吧');
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });

    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(submit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ instruction: '好，开始吧' }));
    });
    expect(answer).not.toHaveBeenCalled();
    expect(createLocalProject).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(container.querySelector('[data-builder-workspace-picker="true"]')).toBeNull();
    expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value).toBe('');
    await waitFor(() => {
      expectDraftWaitingForReviewEvidence(container);
    });
  });

  it('routes current result defect feedback to submit only when prior work context exists', async () => {
    const { answer, container, createLocalProject, generate, saveDraft, submit } = await setup({
      contextualBuildActivity: true,
      initiallySaved: true,
    });
    await openSavedProject(container);
    await waitFor(() => {
      expect(container.textContent).toContain('作品集首页');
      expect(container.querySelector('[data-builder-composer-status="true"]')).toBeNull();
    });
    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea');
    expect(textarea).not.toBeNull();
    act(() => {
      if (textarea) {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
          ?.call(textarea, '这里字都重叠了');
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });

    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(submit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ instruction: '这里字都重叠了' }));
    });
    expect(answer).not.toHaveBeenCalled();
    expect(createLocalProject).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(container.querySelector('[data-builder-workspace-picker="true"]')).toBeNull();
    expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value).toBe('');
  });

  it('approves a pending plan from a contextual execution phrase through review authority', async () => {
    const {
      answer,
      classifyIntent,
      container,
      createLocalProject,
      generate,
      generateApprovedPlan,
      reviewPlan,
      saveDraft,
      submit,
    } = await setup({
      initiallySaved: true,
      pendingPlanActivity: true,
    });
    await openSavedProject(container);
    await waitFor(() => {
      expect(container.querySelector('[data-builder-plan-review-actions="true"]')).not.toBeNull();
    });
    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea');
    expect(textarea).not.toBeNull();
    act(() => {
      if (textarea) {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
          ?.call(textarea, '按这个做');
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });

    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(reviewPlan).toHaveBeenCalledExactlyOnceWith({
        project_id: PROJECT_ID,
        conversation_id: CONVERSATION_ID,
        turn_id: 'builder-turn:123e4567-e89b-42d3-a456-426614174000',
        run_id: 'builder-run:123e4567-e89b-42d3-a456-426614174000',
        decision: 'approved',
      });
      expect(generateApprovedPlan).toHaveBeenCalledExactlyOnceWith({
        project_id: PROJECT_ID,
        conversation_id: CONVERSATION_ID,
        turn_id: 'builder-turn:123e4567-e89b-42d3-a456-426614174000',
        run_id: 'builder-run:123e4567-e89b-42d3-a456-426614174000',
      });
    });
    expect(answer).not.toHaveBeenCalled();
    expect(classifyIntent).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    expect(createLocalProject).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(container.querySelector('[data-builder-workspace-picker="true"]')).toBeNull();
    await waitFor(() => {
      expect(container.querySelector('[data-builder-unsaved-draft="true"]')).not.toBeNull();
      expectDraftWaitingForReviewEvidence(container);
    });
    expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value).toBe('');
  });

  it('does not revive a rejected plan with a contextual execution phrase', async () => {
    const { answer, container, createLocalProject, generate, reviewPlan, saveDraft, submit } = await setup({
      initiallySaved: true,
      rejectedPlanActivity: true,
    });
    await openSavedProject(container);
    await waitFor(() => {
      expect(container.querySelector('[data-builder-plan-review-decision="rejected"]')?.textContent)
        .toContain('No project files were changed.');
      expect(container.querySelector('[data-builder-composer-status="true"]')?.textContent)
        .toContain('Direction changed');
    });
    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea');
    expect(textarea).not.toBeNull();
    act(() => {
      if (textarea) {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
          ?.call(textarea, '按这个做');
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });

    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(answer).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ instruction: '按这个做' }));
    });
    expect(reviewPlan).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    expect(createLocalProject).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(container.querySelector('[data-builder-workspace-picker="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
  });

  it('keeps one composer turn editable and retryable after submit failure', async () => {
    const { container, generate, readTaskStream, retry, saveDraft, submit } = await setup({
      failSubmitOnce: true,
      initiallySaved: true,
    });
    await openSavedProject(container);
    await waitFor(() => {
      expect(readTaskStream).toHaveBeenCalledWith({ project_id: PROJECT_ID, task_address_id: TASK_ADDRESS_ID });
    });
    readTaskStream.mockClear();
    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
        ?.call(textarea, 'Make a timer.');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.dispatchEvent(new Event('change', { bubbles: true }));
    });
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(container.querySelector('[data-builder-conversation-notice="submit_failed"]')?.textContent)
        .toContain('AI 服务拒绝了请求，请检查 API Key、模型或账户状态。');
    });
    expect(container.querySelector('[data-builder-retry-draft="true"]')).not.toBeNull();
    expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value)
      .toBe('Make a timer.');

    click(container, '[data-builder-retry-draft="true"]');

    await waitFor(() => {
      expect(container.querySelector('[data-builder-unsaved-draft="true"]')).not.toBeNull();
    });
    expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value).toBe('');
    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit.mock.calls[0][0]).toEqual({ instruction: 'Make a timer.', task_address_id: TASK_ADDRESS_ID });
    expect(submit.mock.calls[1][0]).toEqual({ instruction: 'Make a timer.', task_address_id: TASK_ADDRESS_ID });
    expect(generate).not.toHaveBeenCalled();
    expect(retry).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(readTaskStream).toHaveBeenCalledWith({ project_id: PROJECT_ID, task_address_id: TASK_ADDRESS_ID });
  });

  it('starts a different composer turn after submit failure without using retry', async () => {
    const { container, generate, readTaskStream, retry, saveDraft, submit } = await setup({
      failSubmitOnce: true,
      initiallySaved: true,
    });
    await openSavedProject(container);
    await waitFor(() => {
      expect(readTaskStream).toHaveBeenCalledWith({ project_id: PROJECT_ID, task_address_id: TASK_ADDRESS_ID });
    });
    readTaskStream.mockClear();
    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
        ?.call(textarea, 'Make a timer.');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.dispatchEvent(new Event('change', { bubbles: true }));
    });
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(container.querySelector('[data-builder-retry-draft="true"]')).not.toBeNull();
    });
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
        ?.call(textarea, 'Make a different timer.');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.dispatchEvent(new Event('change', { bubbles: true }));
    });
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(container.querySelector('[data-builder-unsaved-draft="true"]')).not.toBeNull();
    });
    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit.mock.calls[0][0]).toEqual({ instruction: 'Make a timer.', task_address_id: TASK_ADDRESS_ID });
    expect(submit.mock.calls[1][0]).toEqual({ instruction: 'Make a different timer.', task_address_id: TASK_ADDRESS_ID });
    expect(generate).not.toHaveBeenCalled();
    expect(retry).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(readTaskStream).toHaveBeenCalledWith({ project_id: PROJECT_ID, task_address_id: TASK_ADDRESS_ID });
    expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value).toBe('');
    expect(container.textContent).not.toMatch(/request_digest|existing_project_id|provider|credential/iu);
  });

  it('does not refill the original instruction when paused work settles late', async () => {
    const { cancel, container, readTaskStream, emitTaskStreamChanged, resolveGenerate, submit, saveDraft } = await setup({
      deferredGenerate: true, initiallySaved: true,
    });
    await openSavedProject(container);
    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(textarea, 'Make a timer.');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    click(container, '[data-builder-submit-turn="true"]');
    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
    readTaskStream.mockResolvedValue(waitingForUserAnswerTaskStreamWire());
    emitTaskStreamChanged(PROJECT_ID);
    await waitFor(() => expect(container.querySelector('[data-builder-pause-task="true"]')).not.toBeNull());
    readTaskStream.mockResolvedValue(createInterruptedTaskStreamWire());
    click(container, '[data-builder-pause-task="true"]');
    await waitFor(() => expect(cancel).toHaveBeenCalledWith({ request_id: expect.any(String), pause: true }));
    await act(async () => { await resolveGenerate(); });
    await waitFor(() => expect(container.querySelector('[data-builder-resume-interrupted-run="true"]')).not.toBeNull());
    expect(textarea.value).toBe('');
    expect(submit).toHaveBeenCalledOnce();
    expect(saveDraft).not.toHaveBeenCalled();
  });

  it('cancels active draft generation through request-id-only control', async () => {
    const { cancel, container, generate, resolveGenerate, saveDraft, submit } = await setup({
      deferredGenerate: true,
      initiallySaved: true,
    });
    await openSavedProject(container);
    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
        ?.call(textarea, 'Make a timer.');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(submit).toHaveBeenCalledOnce();
      expect(container.querySelector('[data-builder-cancel-work="true"]')).not.toBeNull();
    });
    expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value).toBe('');
    expect(generate).not.toHaveBeenCalled();
    const expected = await createBuilderGenerationRequest('Make a timer.', PROJECT_ID, TASK_ADDRESS_ID);
    click(container, '[data-builder-cancel-work="true"]');

    await waitFor(() => {
      expect(cancel).toHaveBeenCalledExactlyOnceWith({ request_id: expected.request_digest });
      expect(container.querySelector('[data-builder-cancel-work="true"]')).toBeNull();
    });
    expect(cancel.mock.calls[0][0]).not.toHaveProperty('instruction');
    expect(cancel.mock.calls[0][0]).not.toHaveProperty('source_tree');
    expect(saveDraft).not.toHaveBeenCalled();

    await act(async () => {
      await resolveGenerate();
      await Promise.resolve();
    });
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();
    expect(saveDraft).not.toHaveBeenCalled();
  });

  it('does not restore submitted text when the send command is triggered again while work is pending', async () => {
    const { container, resolveGenerate, submit } = await setup({
      deferredGenerate: true,
      initiallySaved: true,
    });
    await openSavedProject(container);
    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
        ?.call(textarea, 'Make a timer.');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const send = container.querySelector<HTMLButtonElement>('[data-builder-submit-turn="true"]')!;

    act(() => {
      send.click();
      send.click();
    });

    await waitFor(() => {
      expect(submit).toHaveBeenCalledOnce();
      expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value).toBe('');
    });

    await act(async () => {
      await resolveGenerate();
      await Promise.resolve();
    });

    expect(submit).toHaveBeenCalledOnce();
    expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value).toBe('');
  });

  it('loads the visible project activity through the read-only task stream bridge', async () => {
    const { container, readTaskStream } = await setup({ initiallySaved: true });
    await openSavedProject(container);
    await waitFor(() => {
      expect(readTaskStream).toHaveBeenCalledWith({ project_id: PROJECT_ID, task_address_id: TASK_ADDRESS_ID });
    });
    readTaskStream.mockClear();
    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
        ?.call(textarea, 'Make a timer.');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(container.querySelector('[data-builder-unsaved-draft="true"]')).not.toBeNull();
      expect(container.querySelector('[data-builder-activity-card="Draft proposed"]')?.textContent)
        .toContain('I prepared a draft for review.');
    });
    await waitFor(() => {
      expect(readTaskStream).toHaveBeenCalledExactlyOnceWith({ project_id: PROJECT_ID, task_address_id: TASK_ADDRESS_ID });
    });
    expect(container.textContent).not.toContain('builder-generation-draft:');
    expect(container.textContent).not.toContain('sqlite');
  });

  it('loads live project activity after main binds a new submit to a working project id', async () => {
    const {
      container,
      emitGenerationStarted,
      emitTaskStreamChanged,
      readTaskStream,
      resolveGenerate,
      submit,
    } = await setup({ deferredGenerate: true, initiallySaved: true, runningActivity: true });
    await openSavedProject(container);
    await waitFor(() => {
      expect(readTaskStream).toHaveBeenCalledWith({ project_id: PROJECT_ID, task_address_id: TASK_ADDRESS_ID });
    });
    readTaskStream.mockClear();
    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
        ?.call(textarea, 'Make a timer.');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(submit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ instruction: 'Make a timer.' }));
    });
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();
    const expected = await createBuilderGenerationRequest('Make a timer.', PROJECT_ID, TASK_ADDRESS_ID);
    expect(emitGenerationStarted(expected.request_digest, PROJECT_ID)).toBeGreaterThan(0);
    await waitFor(() => {
      expect(container.querySelector('[data-builder-cancel-work="true"]')).not.toBeNull();
    });
    expect(container.querySelector('[data-builder-live-output="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-conversation-notice="submitting"]')).toBeNull();
    expect(container.querySelector('[data-builder-conversation-notice="generating"]')).toBeNull();
    const startedWorkStatus = container.querySelector('[data-builder-work-status="true"]');
    expect(startedWorkStatus).toBeNull();
    readTaskStream.mockClear();
    expect(emitTaskStreamChanged(PROJECT_ID)).toBe(1);
    await waitFor(() => {
      expect(readTaskStream).toHaveBeenCalledExactlyOnceWith({ project_id: PROJECT_ID, task_address_id: TASK_ADDRESS_ID });
    });
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();
    const workStatus = container.querySelector('[data-builder-work-status="true"]');
    expect(workStatus).toBeNull();
    expect(container.textContent).not.toMatch(/request_id|provider|credential|commit_oid|tree_oid/iu);

    await act(async () => {
      await resolveGenerate();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(readTaskStream).toHaveBeenCalledTimes(2);
    });
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).not.toBeNull();
  });

  it('shows a current-run command approval from the desktop bridge and records one-shot consent', async () => {
    const {
      container,
      decideCommandApproval,
      emitCommandApproval,
      emitCommandOutput,
      resolveGenerate,
      submit,
    } = await setup({ deferredGenerate: true, initiallySaved: true, runningActivity: true });
    await openSavedProject(container);
    click(container, '[data-builder-workspace-menu-button="true"]');
    click(container, '[data-builder-workspace-control-tab="preview"]');
    const stablePreview = container.querySelector('[data-builder-static-preview="true"]');
    expect(stablePreview).not.toBeNull();
    stablePreview?.setAttribute('data-test-stable-preview', 'true');
    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
        ?.call(textarea, 'Make a timer.');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    click(container, '[data-builder-submit-turn="true"]');
    await waitFor(() => {
      expect(submit).toHaveBeenCalledOnce();
      expect(container.querySelector('[data-builder-cancel-work="true"]')).not.toBeNull();
    });

    expect(emitCommandApproval()).toBe(1);
    await waitFor(() => {
      expect(container.querySelector('[data-builder-command-approval="true"]')?.textContent)
        .toContain('npm test');
    });
    click(container, '[data-builder-allow-command-once="true"]');
    await waitFor(() => {
      expect(decideCommandApproval).toHaveBeenCalledExactlyOnceWith({
        run_id: PENDING_RUN_ID,
        approval_request_id:
          'builder-controlled-command-approval-request:123e4567-e89b-42d3-a456-426614174000',
        decision: 'allow_once',
      });
      expect(container.querySelector('[data-builder-command-approval="true"]')).toBeNull();
      expect(container.querySelector('[data-builder-command-terminal="running"]')).not.toBeNull();
    });

    expect(emitCommandOutput([
      { stream: 'stdout', text: 'PASS focus timer\n' },
      { stream: 'stderr', text: 'experimental warning\n' },
    ])).toBe(1);
    await waitFor(() => {
      expect(container.querySelector('[data-builder-command-stdout="true"]')?.textContent)
        .toContain('PASS focus timer');
      expect(container.querySelector('[data-builder-command-stderr="true"]')?.textContent)
        .toContain('experimental warning');
      expect(container.querySelector('[data-builder-artifact-tab-active="terminal_placeholder"]'))
        .not.toBeNull();
    });
    click(container, '[data-builder-side-workspace-tool="preview"]');
    await waitFor(() => {
      expect(container.querySelector('[data-builder-artifact-tab-active="preview"]')).not.toBeNull();
      expect(container.querySelector('[data-test-stable-preview="true"]')).toBe(stablePreview);
    });

    await act(async () => {
      await resolveGenerate();
      await Promise.resolve();
    });
  });

  it('renders display-safe live AI output as an assistant message while work is active', async () => {
    const {
      container,
      emitGenerationOutput,
      emitGenerationStarted,
      resolveGenerate,
      submit,
    } = await setup({ deferredGenerate: true, initiallySaved: true, strictMode: true });
    await openSavedProject(container);
    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
        ?.call(textarea, 'Make a timer.');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(submit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ instruction: 'Make a timer.' }));
    });
    const expected = await createBuilderGenerationRequest('Make a timer.', PROJECT_ID, TASK_ADDRESS_ID);
    expect(emitGenerationStarted(expected.request_digest, PROJECT_ID)).toBeGreaterThan(0);
    expect(emitGenerationOutput(
      expected.request_digest,
      'Planning a quiet timer UI.\n\n- Create the markup\n- Run the check',
      PROJECT_ID,
    )).toBeGreaterThan(0);
    expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value).toBe('');

    await waitFor(() => {
      expect(container.querySelector('[data-builder-live-output="true"]')?.textContent)
        .toContain('Planning a quiet timer UI.');
    });
    const liveOutput = container.querySelector('[data-builder-live-output="true"]');
    expect(liveOutput?.querySelector('[data-builder-conversation-markdown="true"]')).not.toBeNull();
    expect(liveOutput?.querySelectorAll('li').length).toBe(2);
    expect(liveOutput?.getAttribute('data-builder-activity-role')).toBe('assistant');
    expect(liveOutput?.querySelector('[data-builder-message-surface]')?.getAttribute('data-builder-message-surface'))
      .toBe('plain');
    expect(liveOutput?.textContent).not.toMatch(/provider|credential|source_tree|request_id|builder-run/iu);

    await act(async () => {
      await resolveGenerate();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(container.querySelector('[data-builder-live-output="true"]')).toBeNull();
      expect(container.querySelector('[data-builder-unsaved-draft="true"]')).not.toBeNull();
    });
  });

  it('queues desktop composer follow-up while live work is active instead of steering by default', async () => {
    const {
      container,
      continueDraft,
      emitGenerationStarted,
      queueFollowup,
      readTaskStream,
      resolveGenerate,
      steer,
      submit,
    } = await setup({ deferredGenerate: true, initiallySaved: true, runningActivity: true });
    await openSavedProject(container);
    await waitFor(() => {
      expect(readTaskStream).toHaveBeenCalledWith({ project_id: PROJECT_ID, task_address_id: TASK_ADDRESS_ID });
    });
    readTaskStream.mockClear();
    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
        ?.call(textarea, 'Make a timer.');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.dispatchEvent(new Event('change', { bubbles: true }));
    });
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(submit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ instruction: 'Make a timer.' }));
    });
    const expected = await createBuilderGenerationRequest('Make a timer.', PROJECT_ID, TASK_ADDRESS_ID);
    expect(emitGenerationStarted(expected.request_digest, PROJECT_ID)).toBeGreaterThan(0);
    await waitFor(() => {
      expect(container.querySelector('[data-builder-work-status="true"]')).toBeNull();
      expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.disabled).toBe(false);
      expect(container.querySelector('[data-builder-cancel-work="true"]')?.getAttribute('aria-label'))
        .toBe('Stop');
      expect(container.querySelector('[data-builder-submit-turn="true"]')).toBeNull();
    });
    expect(container.querySelector('[data-builder-live-output="true"]')).toBeNull();
    await act(async () => {
      await Promise.resolve();
    });
    readTaskStream.mockClear();
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
        ?.call(textarea, 'Make it responsive.');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await waitFor(() => {
      expect(container.querySelector('[data-builder-submit-turn="true"]')?.getAttribute('aria-label'))
        .toBe('Add context');
      expect(container.querySelector('[data-builder-cancel-work="true"]')).toBeNull();
    });
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(container.querySelector('[data-builder-active-run-followup-queued="true"]')?.textContent)
        .toContain('will run after the current step finishes');
    });
    await waitFor(() => {
      expect(readTaskStream).toHaveBeenCalledWith({ project_id: PROJECT_ID, task_address_id: TASK_ADDRESS_ID });
      expect(container.querySelector('[data-builder-activity-card="You queued a follow-up"]')?.textContent)
        .toContain('Make it responsive.');
    });
    const activeComposer = container.querySelector('[data-builder-composer="true"]');
    expect(activeComposer?.getAttribute('data-builder-route')).toBe('queue_followup');
    expect(activeComposer?.getAttribute('data-builder-route-dispatch')).toBe('queue_followup');
    expect(activeComposer?.getAttribute('data-builder-route-active-run-input')).toBe('queued_followup');
    expect(activeComposer?.getAttribute('data-builder-route-signals')).toBe('active_run_followup');
    expect(queueFollowup).toHaveBeenCalledExactlyOnceWith({
      request_id: expected.request_digest,
      message: 'Make it responsive.',
    });
    expect(queueFollowup.mock.calls[0][0]).not.toHaveProperty('instruction');
    expect(queueFollowup.mock.calls[0][0]).not.toHaveProperty('source_tree');
    expect(queueFollowup.mock.calls[0][0]).not.toHaveProperty('project_id');
    expect(steer).not.toHaveBeenCalled();
    expect(submit).toHaveBeenCalledOnce();
    expect(continueDraft).not.toHaveBeenCalled();
    expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value).toBe('');

    await act(async () => {
      await resolveGenerate();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(continueDraft).toHaveBeenCalledExactlyOnceWith({
        draft_id: expect.stringMatching(/^builder-generation-draft:/u),
        instruction: 'Make it responsive.',
        queued_followup: {
          message_id: 'builder-message:123e4567-e89b-42d3-a456-426614174088',
          run_id: 'builder-run:123e4567-e89b-42d3-a456-426614174000',
          turn_id: 'builder-turn:123e4567-e89b-42d3-a456-426614174000',
        },
      });
    });
    expect(steer).not.toHaveBeenCalled();
  });

  it('answers a native Harness user question in the active run instead of queueing new work', async () => {
    const {
      container,
      emitGenerationStarted,
      queueFollowup,
      resolveGenerate,
      steer,
      submit,
    } = await setup({
      deferredGenerate: true,
      initiallySaved: true,
      taskStreamWireOverride: waitingForUserAnswerTaskStreamWire(),
    });
    await openSavedProject(container);
    setComposerInstruction(container, 'Make a timer.');
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(submit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ instruction: 'Make a timer.' }));
    });
    const expected = await createBuilderGenerationRequest('Make a timer.', PROJECT_ID, TASK_ADDRESS_ID);
    expect(emitGenerationStarted(expected.request_digest, PROJECT_ID)).toBeGreaterThan(0);
    await waitFor(() => {
      expect(container.textContent).toContain('你希望使用 React 还是原生 JavaScript？');
      expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.disabled).toBe(false);
    });

    setComposerInstruction(container, '使用 React。');
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(steer).toHaveBeenCalledExactlyOnceWith({
        request_id: expected.request_digest,
        message: '使用 React。',
      });
    });
    expect(queueFollowup).not.toHaveBeenCalled();
    expect(submit).toHaveBeenCalledOnce();
    expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value).toBe('');

    await act(async () => {
      await resolveGenerate();
      await Promise.resolve();
    });
  });

  it('keeps active-run follow-up input when the durable queue record is not accepted', async () => {
    const {
      container,
      emitGenerationStarted,
      queueFollowup,
      readTaskStream,
      resolveGenerate,
      steer,
      submit,
    } = await setup({
      deferredGenerate: true,
      failQueueFollowup: true,
      initiallySaved: true,
      runningActivity: true,
    });
    await openSavedProject(container);
    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea')!;
    setComposerInstruction(container, 'Make a timer.');
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(submit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ instruction: 'Make a timer.' }));
    });
    const expected = await createBuilderGenerationRequest('Make a timer.', PROJECT_ID, TASK_ADDRESS_ID);
    expect(emitGenerationStarted(expected.request_digest, PROJECT_ID)).toBeGreaterThan(0);
    await waitFor(() => {
      expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.disabled).toBe(false);
      expect(container.querySelector('[data-builder-submit-turn="true"]')).toBeNull();
    });
    readTaskStream.mockClear();

    setComposerInstruction(container, 'Make it responsive.');
    await waitFor(() => {
      expect(container.querySelector('[data-builder-submit-turn="true"]')?.getAttribute('aria-label'))
        .toBe('Add context');
    });
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(queueFollowup).toHaveBeenCalledExactlyOnceWith({
        request_id: expected.request_digest,
        message: 'Make it responsive.',
      });
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(container.querySelector('[data-builder-active-run-followup-queued="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-activity-card="You queued a follow-up"]')).toBeNull();
    expect(readTaskStream).not.toHaveBeenCalled();
    expect(textarea.value).toBe('Make it responsive.');
    expect(steer).not.toHaveBeenCalled();

    await act(async () => {
      await resolveGenerate();
      await Promise.resolve();
    });
    expect(submit).toHaveBeenCalledOnce();
  });

  it('queues a build command as an active-run follow-up while an answer is active', async () => {
    const {
      answer,
      container,
      emitGenerationStarted,
      queueFollowup,
      resolveAnswer,
      steer,
      submit,
    } = await setup({ deferredAnswer: true, initiallySaved: true });
    await openSavedProject(container);
    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea')!;
    const question = 'What should I improve before changing files?';
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
        ?.call(textarea, question);
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.dispatchEvent(new Event('change', { bubbles: true }));
    });
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(answer).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ instruction: question }));
    });
    const expected = await createBuilderGenerationRequest(question, PROJECT_ID, TASK_ADDRESS_ID);
    expect(emitGenerationStarted(expected.request_digest, PROJECT_ID)).toBeGreaterThan(0);
    await waitFor(() => {
      expect(container.querySelector('[data-builder-live-output="true"]')).toBeNull();
      expect(container.querySelector('[data-builder-cancel-work="true"]')?.getAttribute('aria-label'))
        .toBe('Stop');
      expect(container.querySelector('[data-builder-submit-turn="true"]')).toBeNull();
    });

    const change = 'Change the main heading to My Notes.';
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
        ?.call(textarea, change);
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await waitFor(() => {
      expect(container.querySelector('[data-builder-submit-turn="true"]')?.getAttribute('aria-label'))
        .toBe('Add context');
      expect(container.querySelector('[data-builder-cancel-work="true"]')).toBeNull();
    });
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(container.querySelector('[data-builder-active-run-followup-queued="true"]')?.textContent)
        .toContain('will run after the current step finishes');
    });
    expect(steer).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value).toBe('');
    const composer = container.querySelector('[data-builder-composer="true"]');
    expect(composer?.getAttribute('data-builder-route')).toBe('queue_followup');
    expect(composer?.getAttribute('data-builder-route-dispatch')).toBe('queue_followup');
    expect(composer?.getAttribute('data-builder-route-active-run-input')).toBe('queued_followup');
    expect(composer?.getAttribute('data-builder-route-signals')).toBe('active_run_followup');
    expect(queueFollowup).toHaveBeenCalledExactlyOnceWith({
      request_id: expected.request_digest,
      message: change,
    });

    await act(async () => {
      await resolveAnswer();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(container.querySelector('[data-builder-active-run-followup-queued="true"]')).toBeNull();
    });
    await waitFor(() => {
      expect(submit).toHaveBeenCalledExactlyOnceWith({
        instruction: change,
        task_address_id: TASK_ADDRESS_ID,
        queued_followup: {
          turn_id: TURN_ID,
          run_id: RUN_ID,
          message_id: 'builder-message:123e4567-e89b-42d3-a456-426614174088',
        },
      });
    });
    expect(steer).not.toHaveBeenCalled();
  });

  it('queues Chinese contextual execution after internal brief readiness while an answer is active', async () => {
    const {
      answer,
      container,
      emitGenerationStarted,
      queueFollowup,
      resolveAnswer,
      steer,
      submit,
    } = await setup({
      contextualBuildActivity: true,
      deferredAnswer: true,
      initiallySaved: true,
    });
    await openSavedProject(container);
    await waitFor(() => {
      expect(container.querySelector('[data-builder-composer-status="true"]')).toBeNull();
    });
    expect(container.querySelector('[data-builder-composer-brief="true"]')).toBeNull();

    const question = '这个方案还有什么风险？';
    setComposerInstruction(container, question);
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(answer).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ instruction: question }));
    });
    const expected = await createBuilderGenerationRequest(question, PROJECT_ID, TASK_ADDRESS_ID);
    expect(emitGenerationStarted(expected.request_digest, PROJECT_ID)).toBeGreaterThan(0);
    await waitFor(() => {
      expect(container.querySelector('[data-builder-live-output="true"]')).toBeNull();
      expect(container.querySelector('[data-builder-cancel-work="true"]')).not.toBeNull();
    });

    const contextualExecution = '那就写';
    setComposerInstruction(container, contextualExecution);
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(container.querySelector('[data-builder-active-run-followup-queued="true"]')).not.toBeNull();
    });
    expect(steer).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    const composer = container.querySelector('[data-builder-composer="true"]');
    expect(composer?.getAttribute('data-builder-route')).toBe('queue_followup');
    expect(composer?.getAttribute('data-builder-route-dispatch')).toBe('queue_followup');
    expect(composer?.getAttribute('data-builder-route-active-run-input')).toBe('queued_followup');
    expect(composer?.getAttribute('data-builder-route-signals')).toBe('active_run_followup');
    expect(composer?.getAttribute('data-builder-route-task-id')).toBeNull();
    expect(queueFollowup).toHaveBeenCalledExactlyOnceWith({
      request_id: expected.request_digest,
      message: contextualExecution,
    });
    expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value).toBe('');

    await act(async () => {
      await resolveAnswer();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(container.querySelector('[data-builder-active-run-followup-queued="true"]')).toBeNull();
    });
    await waitFor(() => {
      expect(submit).toHaveBeenCalledExactlyOnceWith({
        instruction: contextualExecution,
        task_address_id: TASK_ADDRESS_ID,
        queued_followup: {
          turn_id: TURN_ID,
          run_id: RUN_ID,
          message_id: 'builder-message:123e4567-e89b-42d3-a456-426614174088',
        },
      });
    });
    expect(steer).not.toHaveBeenCalled();
  });

  it('keeps queued active-run build follow-ups behind current-project write approval', async () => {
    const {
      answer,
      container,
      emitGenerationStarted,
      prepareCurrentProjectWriteApproval,
      queueFollowup,
      resolveAnswer,
      steer,
      submit,
    } = await setup({
      currentProjectWriteApprovalRequired: true,
      deferredAnswer: true,
      initiallySaved: true,
    });
    await openSavedProject(container);
    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea')!;
    const question = 'What should I improve before changing files?';
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
        ?.call(textarea, question);
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.dispatchEvent(new Event('change', { bubbles: true }));
    });
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(answer).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ instruction: question }));
    });
    const expected = await createBuilderGenerationRequest(question, PROJECT_ID, TASK_ADDRESS_ID);
    expect(emitGenerationStarted(expected.request_digest, PROJECT_ID)).toBeGreaterThan(0);
    await waitFor(() => {
      expect(container.querySelector('[data-builder-live-output="true"]')).toBeNull();
      expect(container.querySelector('[data-builder-cancel-work="true"]')).not.toBeNull();
    });

    const change = 'Change the main heading to My Notes.';
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
        ?.call(textarea, change);
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.dispatchEvent(new Event('change', { bubbles: true }));
    });
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(container.querySelector('[data-builder-active-run-followup-queued="true"]')).not.toBeNull();
    });
    expect(queueFollowup).toHaveBeenCalledExactlyOnceWith({
      request_id: expected.request_digest,
      message: change,
    });
    expect(steer).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();

    await act(async () => {
      await resolveAnswer();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(prepareCurrentProjectWriteApproval).toHaveBeenCalledWith({
        project_id: PROJECT_ID,
        task_address_id: TASK_ADDRESS_ID,
      });
      expect(container.querySelector('[data-builder-current-project-write-approval="true"]')).not.toBeNull();
    });
    expect(submit).not.toHaveBeenCalled();
    expect(steer).not.toHaveBeenCalled();
    expect(container.querySelector('[data-builder-current-project-write-approval="true"]')?.textContent)
      .toContain('Allow current project changes');
  });

  it('proposes a saved-project plan from the desktop composer without generating or saving', async () => {
    const {
      container,
      generate,
      preparePlanSourceReadApproval,
      proposePlan,
      readTaskStream,
      saveDraft,
      submit,
    } = await setup({
      initiallySaved: true,
      planAfterPropose: true,
    });
    await openSavedProject(container);
    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea')!;
    await waitFor(() => {
      expect(container.querySelector('[data-builder-composer-add-menu-button="true"]')).not.toBeNull();
    });
    readTaskStream.mockClear();
    expect(container.querySelector('[data-builder-propose-plan="true"]')).toBeNull();
    click(container, '[data-builder-composer-add-menu-button="true"]');
    await waitFor(() => {
      expect(container.querySelector('[data-builder-composer-add-plan-mode="true"]')).not.toBeNull();
    });
    click(container, '[data-builder-composer-add-plan-mode="true"]');
    expect(proposePlan).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(container.querySelector('[data-builder-composer-mode-chip="plan"]')?.textContent)
        .toContain('Plan mode');
    });
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
        ?.call(textarea, 'Plan the next project update.');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await waitForComposerSubmitReady(container);
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(proposePlan).toHaveBeenCalledOnce();
      expect(container.querySelector('[data-builder-plan-review-actions="true"]')).not.toBeNull();
    });
    expect(preparePlanSourceReadApproval).toHaveBeenCalledExactlyOnceWith({
      project_id: PROJECT_ID,
      task_address_id: TASK_ADDRESS_ID,
    });
    expect(proposePlan).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ instruction: 'Plan the next project update.' }));
    expect(submit).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(textarea.value).toBe('');
    expect(readTaskStream).toHaveBeenCalledWith({ project_id: PROJECT_ID, task_address_id: TASK_ADDRESS_ID });
  });

  it('shows a pending user message immediately while a plan proposal is still running', async () => {
    const {
      container,
      proposePlan,
      resolvePlanProposal,
    } = await setup({
      deferredPlanProposal: true,
      initiallySaved: true,
      planAfterPropose: true,
    });
    await openSavedProject(container);
    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea')!;
    await waitFor(() => {
      expect(container.querySelector('[data-builder-composer-add-menu-button="true"]')).not.toBeNull();
    });
    click(container, '[data-builder-composer-add-menu-button="true"]');
    await waitFor(() => {
      expect(container.querySelector('[data-builder-composer-add-plan-mode="true"]')).not.toBeNull();
    });
    click(container, '[data-builder-composer-add-plan-mode="true"]');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
        ?.call(textarea, 'Plan the first usable screen.');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await waitForComposerSubmitReady(container);
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(proposePlan).toHaveBeenCalledOnce();
      expect(container.querySelector('[data-builder-activity-pending="true"]')?.textContent)
        .toContain('Plan the first usable screen.');
    });
    expect(container.querySelector('[data-builder-plan-review-actions="true"]')).toBeNull();

    await resolvePlanProposal();
    await waitFor(() => {
      expect(container.querySelector('[data-builder-plan-review-actions="true"]')).not.toBeNull();
    });
  });

  it('settles a completed plan without refreshing the project tree when the task address is already known', async () => {
    const { container, proposePlan, readAgentProjectTree } = await setup({
      hangAgentProjectTreeAfterPlan: true,
      initiallySaved: true,
      planAfterPropose: true,
    });
    await openSavedProject(container);
    click(container, '[data-builder-composer-add-menu-button="true"]');
    await waitFor(() => {
      expect(container.querySelector('[data-builder-composer-add-plan-mode="true"]')).not.toBeNull();
    });
    click(container, '[data-builder-composer-add-plan-mode="true"]');
    readAgentProjectTree.mockClear();
    setComposerInstruction(container, 'Plan the next project update.');
    await waitForComposerSubmitReady(container);
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(proposePlan).toHaveBeenCalledOnce();
      expect(container.querySelector('[data-builder-plan-review-actions="true"]')).not.toBeNull();
    });
    expect(readAgentProjectTree).not.toHaveBeenCalled();
    expect(container.querySelector('[data-builder-live-output="true"]')).toBeNull();
    expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.disabled).toBe(false);

    setComposerInstruction(container, 'What should happen next?');
    await waitForComposerSubmitReady(container);
    expect(container.querySelector<HTMLButtonElement>('[data-builder-submit-turn="true"]')?.disabled)
      .toBe(false);
  });

  it('routes natural-language plan requests to plan proposal without submitting a draft', async () => {
    const {
      container,
      generate,
      preparePlanSourceReadApproval,
      proposePlan,
      saveDraft,
      submit,
    } = await setup({
      initiallySaved: true,
      planAfterPropose: true,
    });
    await openSavedProject(container);
    setComposerInstruction(container, '帮我先做下方案');
    await waitForComposerSubmitReady(container);
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(proposePlan).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ instruction: '帮我先做下方案' }));
      expect(container.querySelector('[data-builder-plan-review-actions="true"]')).not.toBeNull();
      expect(container.querySelector('[data-builder-composer-status="true"]')?.textContent)
        .toContain('Needs confirmation');
    });
    expect(preparePlanSourceReadApproval).toHaveBeenCalledExactlyOnceWith({
      project_id: PROJECT_ID,
      task_address_id: TASK_ADDRESS_ID,
    });
    expect(submit).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    const composer = container.querySelector('[data-builder-composer="true"]');
    expect(composer?.getAttribute('data-builder-route')).toBe('plan');
    expect(composer?.getAttribute('data-builder-route-dispatch')).toBe('plan');
    expect(composer?.getAttribute('data-builder-route-permission')).toBe('not_required');
    expect(composer?.getAttribute('data-builder-route-signals')).toBe('explicit_plan');
    expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value).toBe('');
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
  });

  it('routes an implementation plan deliverable directly to plan', async () => {
    const {
      classifyIntent,
      container,
      generate,
      preparePlanSourceReadApproval,
      proposePlan,
      submit,
    } = await setup({
      initiallySaved: true,
      planAfterPropose: true,
      semanticIntentRoute: 'plan',
    });
    await openSavedProject(container);
    setComposerInstruction(container, '帮我做一个静态技术博客实施计划');
    await waitForComposerSubmitReady(container);
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(proposePlan).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ instruction: '帮我做一个静态技术博客实施计划' }));
      expect(container.querySelector('[data-builder-plan-review-actions="true"]')).not.toBeNull();
    });
    expect(classifyIntent).not.toHaveBeenCalled();
    expect(preparePlanSourceReadApproval).toHaveBeenCalledExactlyOnceWith({
      project_id: PROJECT_ID,
      task_address_id: TASK_ADDRESS_ID,
    });
    expect(submit).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    const composer = container.querySelector('[data-builder-composer="true"]');
    expect(composer?.getAttribute('data-builder-route')).toBe('plan');
    expect(composer?.getAttribute('data-builder-route-signals')).toBe('clear_plan_deliverable');
  });

  it('routes clear plan deliverables to plan when semantic routing is unavailable', async () => {
    const {
      answer,
      classifyIntent,
      container,
      generate,
      preparePlanSourceReadApproval,
      proposePlan,
      submit,
    } = await setup({
      initiallySaved: true,
      planAfterPropose: true,
      currentProjectWriteApprovalRequired: true,
    });
    await openSavedProject(container);
    setComposerInstruction(container, '帮我做一个静态技术博客实施计划');
    await waitForComposerSubmitReady(container);
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(proposePlan).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ instruction: '帮我做一个静态技术博客实施计划' }));
      expect(container.querySelector('[data-builder-plan-review-actions="true"]')).not.toBeNull();
    });
    expect(answer).not.toHaveBeenCalled();
    expect(classifyIntent).not.toHaveBeenCalled();
    expect(preparePlanSourceReadApproval).toHaveBeenCalledExactlyOnceWith({
      project_id: PROJECT_ID,
      task_address_id: TASK_ADDRESS_ID,
    });
    expect(submit).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(container.querySelector('[data-builder-current-project-write-approval="true"]')).toBeNull();
    const composer = container.querySelector('[data-builder-composer="true"]');
    expect(composer?.getAttribute('data-builder-route')).toBe('plan');
    expect(composer?.getAttribute('data-builder-route-signals')).toBe('clear_plan_deliverable');
  });

  it('keeps a plan management page as a build artifact without spending semantic routing', async () => {
    const { classifyIntent, container, proposePlan, submit } = await setup({
      initiallySaved: true,
      semanticIntentRoute: 'build',
    });
    await openSavedProject(container);
    setComposerInstruction(container, '做一个计划管理页面');
    await waitForComposerSubmitReady(container);
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(submit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ instruction: '做一个计划管理页面' }));
    });
    expect(classifyIntent).not.toHaveBeenCalled();
    expect(proposePlan).not.toHaveBeenCalled();
    const composer = container.querySelector('[data-builder-composer="true"]');
    expect(composer?.getAttribute('data-builder-route')).toBe('build');
    expect(composer?.getAttribute('data-builder-route-signals')).toBe('clear_build');
  });

  it('keeps plain read-only questions off the semantic classifier path', async () => {
    const { answer, classifyIntent, container, submit } = await setup({
      initiallySaved: true,
      semanticIntentRoute: 'build',
    });
    await openSavedProject(container);
    setComposerInstruction(container, '这个项目是什么');
    await waitForComposerSubmitReady(container);
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(answer).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ instruction: '这个项目是什么' }));
    });
    expect(classifyIntent).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    const composer = container.querySelector('[data-builder-composer="true"]');
    expect(composer?.getAttribute('data-builder-route')).toBe('answer');
    expect(composer?.getAttribute('data-builder-route-signals')).toBe('read_only');
  });

  it('routes natural-language plan requests for an unsaved bound workspace without submitting a draft', async () => {
    const {
      container,
      generate,
      listWorkspaces,
      open,
      preparePlanSourceReadApproval,
      proposePlan,
      saveDraft,
      submit,
    } = await setup({
      planAfterPropose: true,
      workspaceOnlyCatalog: true,
    });
    await waitFor(() => {
      expect(listWorkspaces).toHaveBeenCalled();
      expect(open).toHaveBeenCalledWith({ project_id: PROJECT_ID });
      expect(container.querySelector('[data-builder-workspace-chip="true"]')).toBeNull();
    });
    setComposerInstruction(container, '帮我先做下方案');
    await waitForComposerSubmitReady(container);
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(proposePlan).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ instruction: '帮我先做下方案' }));
      expect(container.querySelector('[data-builder-plan-review-actions="true"]')).not.toBeNull();
    });
    expect(preparePlanSourceReadApproval).toHaveBeenCalledExactlyOnceWith({
      project_id: PROJECT_ID,
      task_address_id: null,
    });
    expect(submit).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    const composer = container.querySelector('[data-builder-composer="true"]');
    expect(composer?.getAttribute('data-builder-route')).toBe('plan');
    expect(composer?.getAttribute('data-builder-route-dispatch')).toBe('plan');
    expect(composer?.getAttribute('data-builder-route-signals')).toBe('explicit_plan');
    expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value).toBe('');
    expect(container.querySelector('[data-builder-current-version="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
  });

  it('keeps submit available for a plan request after a direction update in an unsaved workspace', async () => {
    const {
      answer,
      container,
      generate,
      listWorkspaces,
      open,
      preparePlanSourceReadApproval,
      proposePlan,
      saveDraft,
      submit,
    } = await setup({
      briefUpdateActivity: true,
      planAfterPropose: true,
      workspaceOnlyCatalog: true,
    });
    await waitFor(() => {
      expect(listWorkspaces).toHaveBeenCalled();
      expect(open).toHaveBeenCalledWith({ project_id: PROJECT_ID });
      expect(container.querySelector('[data-builder-workspace-chip="true"]')).toBeNull();
    });

    setComposerInstruction(container, '我打算做一个博客，给我一些建议');
    await waitForComposerSubmitReady(container);
    click(container, '[data-builder-submit-turn="true"]');
    await waitFor(() => {
      expect(answer).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ instruction: '我打算做一个博客，给我一些建议' }));
      expect(container.querySelector('[data-builder-composer-status="true"]')).toBeNull();
    });

    setComposerInstruction(container, '帮我做成计划');
    await waitForComposerSubmitReady(container);
    expect(container.querySelector<HTMLButtonElement>('[data-builder-submit-turn="true"]')?.disabled)
      .toBe(false);
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(proposePlan).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ instruction: '帮我做成计划' }));
      expect(container.querySelector('[data-builder-plan-review-actions="true"]')).not.toBeNull();
    });
    expect(preparePlanSourceReadApproval).toHaveBeenCalledExactlyOnceWith({
      project_id: PROJECT_ID,
      task_address_id: null,
    });
    expect(submit).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    const composer = container.querySelector('[data-builder-composer="true"]');
    expect(composer?.getAttribute('data-builder-route')).toBe('plan');
    expect(composer?.getAttribute('data-builder-route-dispatch')).toBe('plan');
    expect(composer?.getAttribute('data-builder-route-signals')).toBe('explicit_plan');
    expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value).toBe('');
    expect(container.querySelector('[data-builder-current-version="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
  });

  it('routes plan requests after a recorded direction update even when the public answer result failed', async () => {
    const {
      answer,
      container,
      generate,
      listWorkspaces,
      open,
      preparePlanSourceReadApproval,
      proposePlan,
      saveDraft,
      submit,
    } = await setup({
      briefUpdateActivity: true,
      failFirstAnswer: true,
      planAfterPropose: true,
      workspaceOnlyCatalog: true,
    });
    await waitFor(() => {
      expect(listWorkspaces).toHaveBeenCalled();
      expect(open).toHaveBeenCalledWith({ project_id: PROJECT_ID });
      expect(container.querySelector('[data-builder-workspace-chip="true"]')).toBeNull();
    });

    const firstInstruction = '我想先聊一下这个作品集首页怎么做，目标是星空背景和项目列表。';
    setComposerInstruction(container, firstInstruction);
    await waitForComposerSubmitReady(container);
    click(container, '[data-builder-submit-turn="true"]');
    await waitFor(() => {
      expect(answer).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ instruction: firstInstruction }));
      expect(container.querySelector('[data-builder-composer-status="true"]')).toBeNull();
    });
    await waitFor(() => {
      const submitButton = container.querySelector<HTMLButtonElement>('[data-builder-submit-turn="true"]');
      expect(submitButton?.getAttribute('aria-label')).toBe('Send');
      expect(submitButton?.disabled).toBe(false);
    });

    setComposerInstruction(container, '帮我做成计划');
    await waitForComposerSubmitReady(container);
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(proposePlan).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ instruction: '帮我做成计划' }));
      expect(container.querySelector('[data-builder-plan-review-actions="true"]')).not.toBeNull();
    });
    expect(preparePlanSourceReadApproval).toHaveBeenCalledExactlyOnceWith({
      project_id: PROJECT_ID,
      task_address_id: null,
    });
    expect(answer).toHaveBeenCalledOnce();
    expect(submit).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    const composer = container.querySelector('[data-builder-composer="true"]');
    expect(composer?.getAttribute('data-builder-route')).toBe('plan');
    expect(composer?.getAttribute('data-builder-route-dispatch')).toBe('plan');
    expect(composer?.getAttribute('data-builder-route-signals')).toBe('explicit_plan');
    expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value).toBe('');
  });

  it('routes the add-menu Plan mode through plan evidence even for build-like wording', async () => {
    const {
      container,
      generate,
      preparePlanSourceReadApproval,
      proposePlan,
      saveDraft,
      submit,
    } = await setup({
      initiallySaved: true,
      planAfterPropose: true,
    });
    await openSavedProject(container);
    setComposerInstruction(container, 'Make a timer.');
    await waitForComposerSubmitReady(container);

    click(container, '[data-builder-composer-add-menu-button="true"]');
    click(container, '[data-builder-composer-add-plan-mode="true"]');
    expect(container.querySelector('[data-builder-composer-mode-chip="plan"]')?.textContent)
      .toContain('Plan mode');

    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(proposePlan).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ instruction: 'Make a timer.' }));
    });
    expect(preparePlanSourceReadApproval).toHaveBeenCalledExactlyOnceWith({
      project_id: PROJECT_ID,
      task_address_id: TASK_ADDRESS_ID,
    });
    expect(submit).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    const composer = container.querySelector('[data-builder-composer="true"]');
    expect(composer?.getAttribute('data-builder-route')).toBe('plan');
    expect(composer?.getAttribute('data-builder-route-dispatch')).toBe('plan');
    expect(composer?.getAttribute('data-builder-route-permission')).toBe('not_required');
    expect(composer?.getAttribute('data-builder-route-signals')).toBe('composer_mode_plan');
    expect(composer?.getAttribute('data-builder-route-downgrade')).toBeNull();
    expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value).toBe('');
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
  });

  it('keeps Ask mode persistent and skips semantic routing for build-like wording', async () => {
    const {
      answer,
      classifyIntent,
      container,
      submit,
    } = await setup({
      initiallySaved: true,
      semanticIntentRoute: 'build',
    });
    await openSavedProject(container);
    setComposerInstruction(container, 'Make a timer.');
    await waitForComposerSubmitReady(container);

    click(container, '[data-builder-composer-add-menu-button="true"]');
    click(container, '[data-builder-composer-add-ask-mode="true"]');
    expect(container.querySelector('[data-builder-composer-mode-chip="ask"]')?.textContent)
      .toContain('Ask mode');

    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(answer).toHaveBeenCalledOnce();
    });
    expect(classifyIntent).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    const composer = container.querySelector('[data-builder-composer="true"]');
    expect(composer?.getAttribute('data-builder-route')).toBe('answer');
    expect(composer?.getAttribute('data-builder-route-dispatch')).toBe('reply');
    expect(composer?.getAttribute('data-builder-route-signals')).toBe('composer_mode_ask');
    expect(container.querySelector('[data-builder-composer-mode-chip="ask"]')).not.toBeNull();
  });

  it('keeps Build mode persistent and routes question-like wording through write approval', async () => {
    const {
      classifyIntent,
      container,
      generate,
      prepareCurrentProjectWriteApproval,
      submit,
    } = await setup({
      currentProjectWriteApprovalRequired: true,
      initiallySaved: true,
      semanticIntentRoute: 'answer',
    });
    await openSavedProject(container);
    setComposerInstruction(container, '这个文件夹是什么结构？');
    await waitForComposerSubmitReady(container);

    click(container, '[data-builder-composer-add-menu-button="true"]');
    click(container, '[data-builder-composer-add-build-mode="true"]');
    expect(container.querySelector('[data-builder-composer-mode-chip="build"]')?.textContent)
      .toContain('Build mode');

    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(prepareCurrentProjectWriteApproval).toHaveBeenCalledExactlyOnceWith({
        project_id: PROJECT_ID,
        task_address_id: TASK_ADDRESS_ID,
      });
      expect(container.querySelector('[data-builder-current-project-write-approval="true"]')).not.toBeNull();
    });
    expect(classifyIntent).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    const composer = container.querySelector('[data-builder-composer="true"]');
    expect(composer?.getAttribute('data-builder-route')).toBe('build');
    expect(composer?.getAttribute('data-builder-route-dispatch')).toBe('ask_permission');
    expect(composer?.getAttribute('data-builder-route-signals')).toBe('composer_mode_build');
    expect(container.querySelector('[data-builder-composer-mode-chip="build"]')).not.toBeNull();

    click(container, '[data-builder-approve-current-project-write="true"]');
    await waitFor(() => {
      expect(generate).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ instruction: '这个文件夹是什么结构？' }));
    });
    expect(submit).not.toHaveBeenCalled();
    expect(container.querySelector('[data-builder-composer-mode-chip="build"]')).not.toBeNull();
  });

  it('routes add-menu Plan mode for a bound local workspace before the first saved version', async () => {
    const {
      container,
      generate,
      listWorkspaces,
      open,
      preparePlanSourceReadApproval,
      proposePlan,
      saveDraft,
      submit,
    } = await setup({
      planAfterPropose: true,
      workspaceOnlyCatalog: true,
    });
    await waitFor(() => {
      expect(listWorkspaces).toHaveBeenCalled();
      expect(open).toHaveBeenCalledWith({ project_id: PROJECT_ID });
      expect(container.querySelector('[data-builder-workspace-chip="true"]')).toBeNull();
    });
    setComposerInstruction(container, 'Make a timer.');
    await waitForComposerSubmitReady(container);

    click(container, '[data-builder-composer-add-menu-button="true"]');
    const planMode = container.querySelector<HTMLButtonElement>(
      '[data-builder-composer-add-plan-mode="true"]',
    );
    expect(planMode).not.toBeNull();
    expect(planMode?.disabled).toBe(false);
    click(container, '[data-builder-composer-add-plan-mode="true"]');
    expect(container.querySelector('[data-builder-composer-mode-chip="plan"]')?.textContent)
      .toContain('Plan mode');

    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(proposePlan).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ instruction: 'Make a timer.' }));
      expect(container.querySelector('[data-builder-plan-review-actions="true"]')).not.toBeNull();
    });
    expect(preparePlanSourceReadApproval).toHaveBeenCalledExactlyOnceWith({
      project_id: PROJECT_ID,
      task_address_id: null,
    });
    expect(submit).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    const composer = container.querySelector('[data-builder-composer="true"]');
    expect(composer?.getAttribute('data-builder-route')).toBe('plan');
    expect(composer?.getAttribute('data-builder-route-dispatch')).toBe('plan');
    expect(composer?.getAttribute('data-builder-route-signals')).toBe('composer_mode_plan');
    expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value).toBe('');
    expect(container.querySelector('[data-builder-current-version="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
  });

  it('asks for visible project-read approval before a saved-project plan needs source context', async () => {
    const {
      approvePlanSourceRead,
      container,
      preparePlanSourceReadApproval,
      proposePlan,
      readTaskStream,
    } = await setup({
      initiallySaved: true,
      planAfterPropose: true,
      planSourceReadApprovalRequired: true,
    });
    await openSavedProject(container);
    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
        ?.call(textarea, 'Plan the next project update.');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await waitFor(() => {
      expect(container.querySelector('[data-builder-composer-add-menu-button="true"]')).not.toBeNull();
    });
    readTaskStream.mockClear();
    expect(container.querySelector('[data-builder-propose-plan="true"]')).toBeNull();
    click(container, '[data-builder-composer-add-menu-button="true"]');
    await waitFor(() => {
      expect(container.querySelector('[data-builder-composer-add-plan-mode="true"]')).not.toBeNull();
    });
    click(container, '[data-builder-composer-add-plan-mode="true"]');
    expect(proposePlan).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(container.querySelector('[data-builder-composer-mode-chip="plan"]')?.textContent)
        .toContain('Plan mode');
    });
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(preparePlanSourceReadApproval).toHaveBeenCalledExactlyOnceWith({
        project_id: PROJECT_ID,
        task_address_id: TASK_ADDRESS_ID,
      });
      expect(container.querySelector('[data-builder-plan-source-read-approval="true"]')?.textContent).
        toContain('Allow project reading?');
    });
    expect(proposePlan).not.toHaveBeenCalled();
    expect(textarea.value).toBe('');

    click(container, 'Allow and continue');

    await waitFor(() => {
      expect(approvePlanSourceRead).toHaveBeenCalledExactlyOnceWith({
        project_id: PROJECT_ID,
        task_address_id: TASK_ADDRESS_ID,
      });
      expect(proposePlan).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ instruction: 'Plan the next project update.' }));
      expect(container.querySelector('[data-builder-plan-review-actions="true"]')).not.toBeNull();
    });
    expect(container.querySelector('[data-builder-plan-source-read-approval="true"]')).toBeNull();
    expect(JSON.stringify(approvePlanSourceRead.mock.calls)).not.toMatch(/resource_id|permission_id|source_tree/iu);
  });

  it('shows a visible failure when project-read approval cannot be prepared for a plan', async () => {
    const {
      container,
      preparePlanSourceReadApproval,
      proposePlan,
    } = await setup({
      failPlanSourceReadApprovalPrepare: true,
      initiallySaved: true,
      planAfterPropose: true,
    });
    await openSavedProject(container);
    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
        ?.call(textarea, '帮我做成计划');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.dispatchEvent(new Event('change', { bubbles: true }));
    });
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(preparePlanSourceReadApproval).toHaveBeenCalledExactlyOnceWith({
        project_id: PROJECT_ID,
        task_address_id: TASK_ADDRESS_ID,
      });
      expect(container.querySelector('[data-builder-plan-source-read-approval="true"]')?.textContent)
        .toContain('I could not prepare project reading for this plan.');
      expect(container.querySelector('[data-builder-plan-source-read-approval="true"]')?.textContent)
        .toContain('I could not prepare or record that approval. Try again.');
    });
    expect(proposePlan).not.toHaveBeenCalled();
    expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value).toBe('');
  });

  it('restores the plan request to the composer when project-read approval is dismissed', async () => {
    const {
      approvePlanSourceRead,
      container,
      generate,
      preparePlanSourceReadApproval,
      proposePlan,
      saveDraft,
      submit,
    } = await setup({
      initiallySaved: true,
      planAfterPropose: true,
      planSourceReadApprovalRequired: true,
    });
    await openSavedProject(container);
    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
        ?.call(textarea, 'Plan the next project update.');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await waitFor(() => {
      expect(container.querySelector('[data-builder-composer-add-menu-button="true"]')).not.toBeNull();
    });

    expect(container.querySelector('[data-builder-propose-plan="true"]')).toBeNull();
    click(container, '[data-builder-composer-add-menu-button="true"]');
    await waitFor(() => {
      expect(container.querySelector('[data-builder-composer-add-plan-mode="true"]')).not.toBeNull();
    });
    click(container, '[data-builder-composer-add-plan-mode="true"]');
    expect(proposePlan).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(container.querySelector('[data-builder-composer-mode-chip="plan"]')?.textContent)
        .toContain('Plan mode');
    });
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(container.querySelector('[data-builder-plan-source-read-approval="true"]')?.textContent)
        .toContain('Allow project reading?');
      expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value).toBe('');
    });

    click(container, 'Not now');

    await waitFor(() => {
      expect(container.querySelector('[data-builder-plan-source-read-approval="true"]')).toBeNull();
      expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value)
        .toBe('Plan the next project update.');
    });
    expect(preparePlanSourceReadApproval).toHaveBeenCalledExactlyOnceWith({
      project_id: PROJECT_ID,
      task_address_id: TASK_ADDRESS_ID,
    });
    expect(approvePlanSourceRead).not.toHaveBeenCalled();
    expect(proposePlan).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
  });

  it('records plan approval then continues into an unsaved draft without saving', async () => {
    const {
      container,
      emitGenerationOutput,
      emitGenerationStarted,
      generate,
      generateApprovedPlan,
      readTaskStream,
      reviewPlan,
      resolveGenerate,
      saveDraft,
    } = await setup({
      deferredApprovedPlanGenerate: true,
      initiallySaved: true,
      pendingPlanActivity: true,
    });
    await waitFor(() => {
      expect(container.querySelector(`[data-builder-project-id="${PROJECT_ID}"]`)).not.toBeNull();
    });
    click(container, 'Hello project');
    await waitFor(() => {
      expect(container.querySelector('[data-builder-plan-review-actions="true"]')).not.toBeNull();
    });
    readTaskStream.mockClear();
    click(container, 'Approve plan');

    await waitFor(() => {
      expect(reviewPlan).toHaveBeenCalledOnce();
      expect(container.querySelector('[data-builder-plan-review-decision="approved"]')?.textContent)
        .toContain('Continuing with the approved plan.');
      expect(container.querySelector('[data-builder-composer-status="true"]')?.textContent)
        .toContain('Using approved plan');
      expect(generateApprovedPlan).toHaveBeenCalledOnce();
    });
    expect(reviewPlan).toHaveBeenCalledExactlyOnceWith({
      project_id: PROJECT_ID,
      conversation_id: CONVERSATION_ID,
      turn_id: 'builder-turn:123e4567-e89b-42d3-a456-426614174000',
      run_id: 'builder-run:123e4567-e89b-42d3-a456-426614174000',
      decision: 'approved',
    });
    expect(generateApprovedPlan).toHaveBeenCalledExactlyOnceWith({
      project_id: PROJECT_ID,
      conversation_id: CONVERSATION_ID,
      turn_id: 'builder-turn:123e4567-e89b-42d3-a456-426614174000',
      run_id: 'builder-run:123e4567-e89b-42d3-a456-426614174000',
    });
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();
    const expected = await createBuilderGenerationRequest('Review the approved plan.', PROJECT_ID);
    expect(emitGenerationStarted(expected.request_digest, PROJECT_ID)).toBeGreaterThan(0);
    expect(container.querySelector('[data-builder-live-output="true"]')).toBeNull();
    expect(emitGenerationOutput(expected.request_digest, 'Applying the approved plan.', PROJECT_ID))
      .toBeGreaterThan(0);
    await waitFor(() => {
      expect(container.querySelector('[data-builder-live-output="true"]')?.textContent)
        .toContain('Applying the approved plan.');
    });
    await act(async () => {
      await resolveGenerate();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(container.querySelector('[data-builder-live-output="true"]')).toBeNull();
      expect(container.querySelector('[data-builder-unsaved-draft="true"]')).not.toBeNull();
    });
    expect(readTaskStream).toHaveBeenCalledWith({ project_id: PROJECT_ID, task_address_id: TASK_ADDRESS_ID });
    expect(saveDraft).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expectDraftWaitingForReviewEvidence(container);
    expect(container.textContent).not.toMatch(
      /plan_result_digest|review_id|reviewer_id|reviewed_at_ms|source_tree|commit_oid|tree_oid|provider|credential/iu,
    );
  });

  it('executes an approved plan for a bound local workspace before the first saved version', async () => {
    const {
      container,
      generate,
      generateApprovedPlan,
      listWorkspaces,
      open,
      reviewPlan,
      saveDraft,
    } = await setup({
      pendingPlanActivity: true,
      workspaceOnlyCatalog: true,
    });
    await waitFor(() => {
      expect(listWorkspaces).toHaveBeenCalled();
      expect(open).toHaveBeenCalledWith({ project_id: PROJECT_ID });
      expect(container.querySelector('[data-builder-workspace-chip="true"]')).toBeNull();
      expect(container.querySelector('[data-builder-current-version="true"]')).toBeNull();
      expect(container.querySelector('[data-builder-plan-review-actions="true"]')).not.toBeNull();
    });

    click(container, 'Approve plan');

    await waitFor(() => {
      expect(reviewPlan).toHaveBeenCalledOnce();
      expect(generateApprovedPlan).toHaveBeenCalledOnce();
      expect(container.querySelector('[data-builder-plan-review-decision="approved"]')?.textContent)
        .toContain('Continuing with the approved plan.');
      expect(container.querySelector('[data-builder-unsaved-draft="true"]')).not.toBeNull();
    });
    expect(generateApprovedPlan).toHaveBeenCalledExactlyOnceWith({
      project_id: PROJECT_ID,
      conversation_id: CONVERSATION_ID,
      turn_id: 'builder-turn:123e4567-e89b-42d3-a456-426614174000',
      run_id: 'builder-run:123e4567-e89b-42d3-a456-426614174000',
    });
    expect(container.querySelector('[data-builder-current-version="true"]')).toBeNull();
    expectDraftWaitingForReviewEvidence(container);
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(container.textContent).not.toMatch(
      /plan_result_digest|review_id|reviewer_id|reviewed_at_ms|source_tree|commit_oid|tree_oid|provider|credential|ipc|schema|receipt/iu,
    );
  });

  it('asks for current-project write approval before executing an approved plan', async () => {
    const {
      approveCurrentProjectWrite,
      container,
      generate,
      generateApprovedPlan,
      prepareCurrentProjectWriteApproval,
      reviewPlan,
      saveDraft,
    } = await setup({
      currentProjectWriteApprovalRequired: true,
      initiallySaved: true,
      pendingPlanActivity: true,
    });
    await waitFor(() => {
      expect(container.querySelector(`[data-builder-project-id="${PROJECT_ID}"]`)).not.toBeNull();
    });
    click(container, 'Hello project');
    await waitFor(() => {
      expect(container.querySelector('[data-builder-plan-review-actions="true"]')).not.toBeNull();
    });

    click(container, 'Approve plan');

    await waitFor(() => {
      expect(reviewPlan).toHaveBeenCalledOnce();
      expect(prepareCurrentProjectWriteApproval).toHaveBeenCalledExactlyOnceWith({
        project_id: PROJECT_ID,
        task_address_id: TASK_ADDRESS_ID,
      });
      expect(container.querySelector('[data-builder-plan-review-decision="approved"]')?.textContent)
        .toContain('Continuing with the approved plan.');
      expect(container.querySelector('[data-builder-current-project-write-approval="true"]')?.textContent)
        .toContain('Allow current project changes?');
    });
    expect(generateApprovedPlan).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();

    click(container, 'Allow and continue');

    await waitFor(() => {
      expect(approveCurrentProjectWrite).toHaveBeenCalledExactlyOnceWith({
        project_id: PROJECT_ID,
        task_address_id: TASK_ADDRESS_ID,
      });
      expect(generateApprovedPlan).toHaveBeenCalledExactlyOnceWith({
        project_id: PROJECT_ID,
        conversation_id: CONVERSATION_ID,
        turn_id: 'builder-turn:123e4567-e89b-42d3-a456-426614174000',
        run_id: 'builder-run:123e4567-e89b-42d3-a456-426614174000',
      });
      expect(container.querySelector('[data-builder-current-project-write-approval="true"]')).toBeNull();
      expect(container.querySelector('[data-builder-unsaved-draft="true"]')).not.toBeNull();
    });
    expect(reviewPlan).toHaveBeenCalledOnce();
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expectDraftWaitingForReviewEvidence(container);
    expect(container.textContent).not.toMatch(
      /plan_result_digest|review_id|reviewer_id|reviewed_at_ms|source_tree|commit_oid|tree_oid|provider|credential|ipc|schema|receipt/iu,
    );
  });

  it('keeps approved plan continuation retryable when the draft is not created', async () => {
    const {
      container,
      generateApprovedPlan,
      readTaskStream,
      retry,
      reviewPlan,
      saveDraft,
    } = await setup({
      failApprovedPlanGenerateOnce: true,
      initiallySaved: true,
      pendingPlanActivity: true,
    });
    await waitFor(() => {
      expect(container.querySelector(`[data-builder-project-id="${PROJECT_ID}"]`)).not.toBeNull();
    });
    click(container, 'Hello project');
    await waitFor(() => {
      expect(container.querySelector('[data-builder-plan-review-actions="true"]')).not.toBeNull();
    });
    readTaskStream.mockClear();

    click(container, 'Approve plan');

    await waitFor(() => {
      expect(reviewPlan).toHaveBeenCalledOnce();
      expect(generateApprovedPlan).toHaveBeenCalledOnce();
      expect(container.querySelector('[data-builder-plan-review-decision="approved"]')?.textContent)
        .toContain('Continuing with the approved plan.');
      expect(container.querySelector('[data-builder-conversation-notice="generation_failed"]')?.textContent)
        .toContain('计划已批准，但草稿未能生成；重试后会从该计划继续。');
      expect(container.querySelector('[data-builder-retry-draft="true"]')).not.toBeNull();
    });
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();
    expect(readTaskStream).toHaveBeenCalledWith({ project_id: PROJECT_ID, task_address_id: TASK_ADDRESS_ID });
    expect(retry).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();

    click(container, '[data-builder-retry-draft="true"]');

    await waitFor(() => {
      expect(generateApprovedPlan).toHaveBeenCalledTimes(2);
      expect(container.querySelector('[data-builder-unsaved-draft="true"]')).not.toBeNull();
    });
    expect(retry).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(container.textContent).not.toMatch(
      /plan_result_digest|review_id|reviewer_id|reviewed_at_ms|source_tree|commit_oid|tree_oid|provider|credential|ipc|schema|receipt/iu,
    );
  });

  it('keeps plan approval single-shot while the review decision is recording', async () => {
    const {
      container,
      generateApprovedPlan,
      readTaskStream,
      resolvePlanReview,
      reviewPlan,
      saveDraft,
    } = await setup({
      deferredPlanReview: true,
      initiallySaved: true,
      pendingPlanActivity: true,
    });
    await waitFor(() => {
      expect(container.querySelector(`[data-builder-project-id="${PROJECT_ID}"]`)).not.toBeNull();
    });
    click(container, 'Hello project');
    await waitFor(() => {
      expect(container.querySelector('[data-builder-plan-review-actions="true"]')).not.toBeNull();
    });

    const approve = container.querySelector<HTMLButtonElement>('[data-builder-approve-plan="true"]');
    expect(approve).not.toBeNull();
    readTaskStream.mockClear();
    act(() => {
      approve?.click();
      approve?.click();
    });

    expect(reviewPlan).toHaveBeenCalledOnce();
    expect(generateApprovedPlan).not.toHaveBeenCalled();
    await waitFor(() => {
      const actions = container.querySelector('[data-builder-plan-review-actions="true"]');
      expect(actions?.getAttribute('data-builder-plan-review-state')).toBe('recording');
      expect(actions?.textContent).toContain('Recording your decision...');
      expect(container.querySelector<HTMLButtonElement>('[data-builder-approve-plan="true"]')?.disabled)
        .toBe(true);
      expect(container.querySelector<HTMLButtonElement>('[data-builder-reject-plan="true"]')?.disabled)
        .toBe(true);
    });

    await act(async () => {
      await resolvePlanReview();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(generateApprovedPlan).toHaveBeenCalledOnce();
      expect(container.querySelector('[data-builder-unsaved-draft="true"]')).not.toBeNull();
    });
    expect(reviewPlan).toHaveBeenCalledExactlyOnceWith({
      project_id: PROJECT_ID,
      conversation_id: CONVERSATION_ID,
      turn_id: 'builder-turn:123e4567-e89b-42d3-a456-426614174000',
      run_id: 'builder-run:123e4567-e89b-42d3-a456-426614174000',
      decision: 'approved',
    });
    expect(saveDraft).not.toHaveBeenCalled();
    expect(container.textContent).not.toMatch(
      /plan_result_digest|review_id|reviewer_id|reviewed_at_ms|source_tree|commit_oid|tree_oid|provider|credential/iu,
    );
  });

  it('keeps plan approval retryable when the review decision is not recorded', async () => {
    const {
      container,
      generateApprovedPlan,
      reviewPlan,
      saveDraft,
    } = await setup({
      failPlanReview: true,
      initiallySaved: true,
      pendingPlanActivity: true,
    });
    await waitFor(() => {
      expect(container.querySelector(`[data-builder-project-id="${PROJECT_ID}"]`)).not.toBeNull();
    });
    click(container, 'Hello project');
    await waitFor(() => {
      expect(container.querySelector('[data-builder-plan-review-actions="true"]')).not.toBeNull();
    });

    click(container, 'Approve plan');
    await waitFor(() => {
      expect(reviewPlan).toHaveBeenCalledOnce();
      const actions = container.querySelector('[data-builder-plan-review-actions="true"]');
      expect(actions?.getAttribute('data-builder-plan-review-state')).toBe('failed');
      expect(actions?.querySelector('[role="alert"]')?.textContent)
        .toContain('That decision could not be recorded. Try again.');
      expect(container.querySelector<HTMLButtonElement>('[data-builder-approve-plan="true"]')?.disabled)
        .toBe(false);
    });
    expect(generateApprovedPlan).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(container.querySelector('[data-builder-plan-review-decision="approved"]')).toBeNull();
    expect(container.textContent).not.toMatch(
      /plan_result_digest|review_id|reviewer_id|reviewed_at_ms|source_tree|commit_oid|tree_oid|provider|credential|ipc|schema|receipt/iu,
    );
  });

  it('keeps recorded plan decisions locked when activity refresh is stale', async () => {
    const {
      container,
      generateApprovedPlan,
      readTaskStream,
      reviewPlan,
      saveDraft,
    } = await setup({
      failTaskStreamAfterPlanReview: true,
      initiallySaved: true,
      pendingPlanActivity: true,
    });
    await waitFor(() => {
      expect(container.querySelector(`[data-builder-project-id="${PROJECT_ID}"]`)).not.toBeNull();
    });
    click(container, 'Hello project');
    await waitFor(() => {
      expect(container.querySelector('[data-builder-plan-review-actions="true"]')).not.toBeNull();
    });
    readTaskStream.mockClear();

    click(container, 'Reject');
    await waitFor(() => {
      expect(reviewPlan).toHaveBeenCalledOnce();
      expect(readTaskStream).toHaveBeenCalledWith({ project_id: PROJECT_ID, task_address_id: TASK_ADDRESS_ID });
      const actions = container.querySelector('[data-builder-plan-review-actions="true"]');
      expect(actions?.getAttribute('data-builder-plan-review-state')).toBe('recorded');
      expect(actions?.textContent).toContain('Decision recorded. Updating the conversation...');
      expect(container.querySelector<HTMLButtonElement>('[data-builder-approve-plan="true"]')?.disabled)
        .toBe(true);
      expect(container.querySelector<HTMLButtonElement>('[data-builder-reject-plan="true"]')?.disabled)
        .toBe(true);
    });
    click(container, '[data-builder-approve-plan="true"]');
    expect(reviewPlan).toHaveBeenCalledOnce();
    expect(generateApprovedPlan).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(container.querySelector('[data-builder-plan-review-decision="rejected"]')).toBeNull();
    expect(container.textContent).not.toMatch(
      /plan_result_digest|review_id|reviewer_id|reviewed_at_ms|source_tree|commit_oid|tree_oid|provider|credential|ipc|schema|receipt/iu,
    );
  });

  it('discards an unsaved draft through draft-id-only control and refreshes activity', async () => {
    const {
      cancel,
      container,
      loadCurrent,
      readTaskStream,
      rejectDraft,
      restoreDraft,
      saveDraft,
    } = await setup({ initiallySaved: true, rejectActivityAfterDiscard: true });
    await openSavedProject(container);
    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
        ?.call(textarea, 'Make a timer.');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    click(container, '[data-builder-submit-turn="true"]');
    await waitFor(() => {
      expectDraftDecisionCard(container);
    });
    readTaskStream.mockClear();
    click(container, '[data-builder-discard-draft="true"]');

    await waitFor(() => {
      expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();
      expect(container.querySelector('[data-builder-activity-card="Draft rejected"]')?.textContent)
        .toContain('The draft was discarded and is no longer available for review.');
    });
    expect(rejectDraft).toHaveBeenCalledExactlyOnceWith({
      draft_id: expect.stringMatching(/^builder-generation-draft:/u),
    });
    expect(rejectDraft.mock.calls[0][0]).not.toHaveProperty('instruction');
    expect(rejectDraft.mock.calls[0][0]).not.toHaveProperty('source_tree');
    expect(saveDraft).not.toHaveBeenCalled();
    expect(loadCurrent).not.toHaveBeenCalled();
    expect(restoreDraft).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(readTaskStream).toHaveBeenCalledExactlyOnceWith({ project_id: PROJECT_ID, task_address_id: TASK_ADDRESS_ID });
    });
    expect(container.textContent).not.toMatch(/builder-generation-draft:|sha256:|provider|credential/iu);
  });

  it('answers a question through the chat bridge without draft, save, or revision UI', async () => {
    const { answer, container, generate, readTaskStream, saveDraft, submit } = await setup({
      answerActivity: true,
    });
    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
        ?.call(textarea, 'What does this project do?');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(container.querySelector('[data-builder-agent-workbench-stream="true"]')?.textContent)
        .toContain('This answer does not change files.');
    });

    expect(answer).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ instruction: 'What does this project do?' }));
    expect(submit).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(readTaskStream).toHaveBeenCalledWith({ agent_id: AGENT_ID });
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-current-version="true"]')).toBeNull();
    expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value).toBe('');
    expect(container.textContent).not.toContain('builder-generation-draft:');
    expect(container.textContent).not.toContain('request_id');
  });

  it('keeps casual composer turns in chat without starting draft generation', async () => {
    const { answer, container, generate, saveDraft, submit } = await setup({
      answerActivity: true,
    });
    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
        ?.call(textarea, 'hi');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(container.querySelector('[data-builder-agent-workbench-stream="true"]')?.textContent)
        .toContain('This answer does not change files.');
    });

    expect(answer).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ instruction: 'hi' }));
    expect(submit).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
    expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value).toBe('');
  });

  it('keeps exploratory brief updates as chat when no project workspace is selected', async () => {
    const { answer, container, createLocalProject, generate, saveDraft, submit } = await setup({
      answerActivity: true,
    });
    setComposerInstruction(container, '我想做一个登录页');
    await waitForComposerSubmitReady(container);

    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(answer).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ instruction: '我想做一个登录页' }));
    });
    expect(createLocalProject).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(container.querySelector('[data-builder-workspace-picker="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
    const composer = container.querySelector('[data-builder-composer="true"]');
    expect(composer?.getAttribute('data-builder-route')).toBe('update_brief');
    expect(composer?.getAttribute('data-builder-route-dispatch')).toBe('brief_update');
    expect(composer?.getAttribute('data-builder-route-task-id')).toBeNull();
  });

  it('keeps Chinese how-to questions in chat without opening the project picker', async () => {
    const { answer, container, createLocalProject, generate, saveDraft, submit } = await setup({
      answerActivity: true,
    });
    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
        ?.call(textarea, '怎么把按钮改红？');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });

    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(container.querySelector('[data-builder-agent-workbench-stream="true"]')?.textContent)
        .toContain('This answer does not change files.');
    });

    expect(answer).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ instruction: '怎么把按钮改红？' }));
    expect(createLocalProject).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(container.querySelector('[data-builder-workspace-picker="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
    expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value).toBe('');
  });

  it('keeps vague improvement requests in chat until the user gives a clear target', async () => {
    const { answer, container, createLocalProject, generate, saveDraft, submit } = await setup({
      answerActivity: true,
    });
    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
        ?.call(textarea, '帮我优化一下');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });

    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(container.querySelector('[data-builder-agent-workbench-stream="true"]')?.textContent)
        .toContain('This answer does not change files.');
    });

    expect(answer).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ instruction: '帮我优化一下' }));
    expect(createLocalProject).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(container.querySelector('[data-builder-workspace-picker="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
    expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value).toBe('');
  });

  it('restores a pending draft from project activity after opening a saved project', async () => {
    const { container, open, readTaskStream, restoreDraft, saveDraft } = await setup({
      initiallySaved: true,
      pendingActivity: true,
      restoreAvailable: true,
    });
    await waitFor(() => {
      expect(container.querySelector(`[data-builder-project-id="${PROJECT_ID}"]`)).not.toBeNull();
    });
    click(container, 'Hello project');

    await waitFor(() => {
      expect(container.querySelector('[data-builder-unsaved-draft="true"]')).not.toBeNull();
    });

    expect(open).toHaveBeenCalledWith({ project_id: PROJECT_ID });
    expect(readTaskStream).toHaveBeenCalledWith({ project_id: PROJECT_ID, task_address_id: TASK_ADDRESS_ID });
    expect(restoreDraft).toHaveBeenCalledExactlyOnceWith({
      draft_id: expect.stringMatching(/^builder-generation-draft:/u),
    });
    expect(saveDraft).not.toHaveBeenCalled();
    expect(container.querySelector('[data-builder-current-version="true"]')).toBeNull();
    expectDraftDecisionCard(container);
  });

  it('retries pending draft restore when the first automatic restore is transiently unavailable', async () => {
    const { container, restoreDraft, saveDraft } = await setup({
      initiallySaved: true,
      pendingActivity: true,
      restoreAvailable: true,
      failRestoreDraftAttempts: 3,
    });
    await waitFor(() => {
      expect(container.querySelector(`[data-builder-project-id="${PROJECT_ID}"]`)).not.toBeNull();
    });
    click(container, 'Hello project');

    await waitFor(() => {
      expect(container.querySelector('[data-builder-unsaved-draft="true"]')).not.toBeNull();
    });

    expect(restoreDraft).toHaveBeenCalledTimes(4);
    expect(saveDraft).not.toHaveBeenCalled();
    expectDraftDecisionCard(container);
  });

  it('retries project activity loading before restoring a pending draft after restart', async () => {
    const { container, open, readTaskStream, restoreDraft, saveDraft } = await setup({
      initiallySaved: true,
      pendingActivity: true,
      restoreAvailable: true,
      failTaskStreamReadAttempts: 3,
    });
    await waitFor(() => {
      expect(container.querySelector(`[data-builder-project-id="${PROJECT_ID}"]`)).not.toBeNull();
    });
    click(container, 'Hello project');

    await waitFor(() => {
      expect(open).toHaveBeenCalledWith({ project_id: PROJECT_ID });
      expect(readTaskStream.mock.calls.filter((call) => (
        ((call as readonly unknown[])[0] as { project_id?: string } | undefined)?.project_id === PROJECT_ID
      )).length).toBeGreaterThanOrEqual(4);
      expect(restoreDraft).toHaveBeenCalledExactlyOnceWith({
        draft_id: expect.stringMatching(/^builder-generation-draft:/u),
      });
      expect(container.querySelector('[data-builder-unsaved-draft="true"]')).not.toBeNull();
    });

    expect(saveDraft).not.toHaveBeenCalled();
    expectDraftDecisionCard(container);
  });

  it('reloads stale project activity before restoring a pending draft after restart', async () => {
    const { container, open, readTaskStream, restoreDraft, saveDraft } = await setup({
      initiallySaved: true,
      staleActivityBeforePendingRestore: true,
      staleActivityReadAttemptsBeforePendingRestore: 3,
      restoreAvailable: true,
    });
    await waitFor(() => {
      expect(container.querySelector(`[data-builder-project-id="${PROJECT_ID}"]`)).not.toBeNull();
    });
    click(container, 'Hello project');

    await waitFor(() => {
      expect(open).toHaveBeenCalledWith({ project_id: PROJECT_ID });
      expect(readTaskStream.mock.calls.filter((call) => (
        ((call as readonly unknown[])[0] as { project_id?: string } | undefined)?.project_id === PROJECT_ID
      )).length).toBeGreaterThanOrEqual(4);
      expect(restoreDraft).toHaveBeenCalledExactlyOnceWith({
        draft_id: expect.stringMatching(/^builder-generation-draft:/u),
      });
      expect(container.querySelector('[data-builder-unsaved-draft="true"]')).not.toBeNull();
    });

    expect(saveDraft).not.toHaveBeenCalled();
    expectDraftDecisionCard(container);
  });

  it('does not restore a pending draft after project activity records rejection', async () => {
    const { container, open, readTaskStream, restoreDraft, saveDraft } = await setup({
      initiallySaved: true,
      rejectedPendingActivity: true,
      restoreAvailable: true,
    });
    await waitFor(() => {
      expect(container.querySelector(`[data-builder-project-id="${PROJECT_ID}"]`)).not.toBeNull();
    });
    click(container, 'Hello project');

    await waitFor(() => {
      expect(container.querySelector('[data-builder-activity-card="Draft rejected"]')?.textContent)
        .toContain('The draft was discarded and is no longer available for review.');
    });

    expect(open).toHaveBeenCalledWith({ project_id: PROJECT_ID });
    expect(readTaskStream).toHaveBeenCalledWith({ project_id: PROJECT_ID, task_address_id: TASK_ADDRESS_ID });
    expect(restoreDraft).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-current-version="true"]')).toBeNull();
  });

  it('does not restore a pending draft after project activity records acceptance', async () => {
    const { container, open, readTaskStream, restoreDraft, saveDraft } = await setup({
      initiallySaved: true,
      acceptedPendingActivity: true,
      restoreAvailable: true,
    });
    await waitFor(() => {
      expect(container.querySelector(`[data-builder-project-id="${PROJECT_ID}"]`)).not.toBeNull();
    });
    click(container, 'Hello project');

    await waitFor(() => {
      expect(container.querySelector('[data-builder-activity-card="Version saved"]')?.textContent)
        .toContain('This draft was saved as Version 1.');
    });

    expect(open).toHaveBeenCalledWith({ project_id: PROJECT_ID });
    expect(readTaskStream).toHaveBeenCalledWith({ project_id: PROJECT_ID, task_address_id: TASK_ADDRESS_ID });
    expect(restoreDraft).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-current-version="true"]')).toBeNull();
  });

  it('does not restore an older superseded candidate after the latest candidate was accepted', async () => {
    const { container, open, readTaskStream, restoreDraft, saveDraft } = await setup({
      initiallySaved: true,
      supersededAcceptedPendingActivity: true,
      restoreAvailable: true,
    });
    await waitFor(() => {
      expect(container.querySelector(`[data-builder-project-id="${PROJECT_ID}"]`)).not.toBeNull();
    });
    click(container, 'Hello project');

    await waitFor(() => {
      expect(container.querySelector('h1')?.textContent).toBe('Hello project');
    });

    expect(open).toHaveBeenCalledWith({ project_id: PROJECT_ID });
    expect(readTaskStream).toHaveBeenCalledWith({ project_id: PROJECT_ID, task_address_id: TASK_ADDRESS_ID });
    expect(restoreDraft).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();
  });

  it('does not consume pending draft restore while viewing saved history', async () => {
    const { container, readTaskStream, restoreDraft } = await setup({
      initiallySaved: true,
      pendingAfterRevisionView: true,
      restoreAvailable: true,
      validHistoryPreview: true,
    });
    await waitFor(() => {
      expect(container.querySelector(`[data-builder-project-id="${PROJECT_ID}"]`)).not.toBeNull();
    });
    click(container, 'Hello project');
    await openVersionsPanel(container);
    await waitFor(() => {
      expect(container.querySelector('[data-builder-view-version="Version 1"]')).not.toBeNull();
    });
    act(() => {
      container.querySelector<HTMLButtonElement>('[data-builder-view-version="Version 1"]')?.click();
    });
    await waitFor(() => {
      expect(container.querySelector('[data-builder-history-preview="true"]')?.textContent)
        .toContain('Viewing Version 1');
    });
    readTaskStream.mockClear();
    expect(container.querySelector<HTMLButtonElement>(
      '[data-builder-activity="true"] button[aria-label="Refresh conversation"]',
    )).toBeNull();
    expect(restoreDraft).not.toHaveBeenCalled();

    click(container, 'Back to current');
    await waitFor(() => {
      expect(readTaskStream).toHaveBeenCalledWith({ project_id: PROJECT_ID, task_address_id: TASK_ADDRESS_ID });
    });
    await waitFor(() => {
      expect(restoreDraft).toHaveBeenCalledExactlyOnceWith({
        draft_id: expect.stringMatching(/^builder-generation-draft:/u),
      });
      expect(container.querySelector('[data-builder-unsaved-draft="true"]')).not.toBeNull();
    });
  });

  it('returns from saved history to the current desktop preview with one Back action', async () => {
    const { container, loadRevision } = await setup({
      initiallySaved: true,
      validHistoryPreview: true,
    });
    await waitFor(() => {
      expect(container.querySelector(`[data-builder-project-id="${PROJECT_ID}"]`)).not.toBeNull();
    });
    click(container, 'Hello project');
    await openVersionsPanel(container);
    await waitFor(() => {
      expect(container.querySelector('[data-builder-view-version="Version 1"]')).not.toBeNull();
      expect(container.querySelector('[data-builder-artifact-sidebar="true"]')?.getAttribute('data-builder-artifact-tab-active'))
        .toBe('versions');
    });

    act(() => {
      container.querySelector<HTMLButtonElement>('[data-builder-view-version="Version 1"]')?.click();
    });
    await waitFor(() => {
      expect(container.querySelector('[data-builder-history-preview="true"]')?.textContent)
        .toContain('Viewing Version 1');
      expect(artifactPreviewSrcdoc(container)).toContain('<main>Earlier</main>');
      expect(container.querySelector('[data-builder-artifact-sidebar="true"]')?.getAttribute('data-builder-artifact-tab-active'))
        .toBe('preview');
    });
    expect(loadRevision).toHaveBeenCalledOnce();
    expect(container.querySelectorAll('[data-builder-show-current-version="true"]')).toHaveLength(1);

    click(container, 'Back to current');
    await waitFor(() => {
      expect(container.querySelector('[data-builder-history-preview="true"]')).toBeNull();
      expect(artifactPreviewSrcdoc(container)).toContain('<main>Current</main>');
      expect(container.querySelector('[data-builder-artifact-sidebar="true"]')?.getAttribute('data-builder-artifact-tab-active'))
        .toBe('preview');
    });
  });

  it('restores a saved history item as an unsaved draft without saving immediately', async () => {
    const {
      container,
      readTaskStream,
      restoreDraft,
      restoreRevisionAsDraft,
      saveDraft,
    } = await setup({
      initiallySaved: true,
      validHistoryPreview: true,
    });
    await waitFor(() => {
      expect(container.querySelector(`[data-builder-project-id="${PROJECT_ID}"]`)).not.toBeNull();
    });
    click(container, 'Hello project');
    await openVersionsPanel(container);
    await waitFor(() => {
      expect(container.querySelector('[data-builder-restore-version="Version 1"]')).not.toBeNull();
    });
    readTaskStream.mockClear();

    act(() => {
      container.querySelector<HTMLButtonElement>('[data-builder-restore-version="Version 1"]')?.click();
    });

    await waitFor(() => {
      expect(restoreRevisionAsDraft).toHaveBeenCalledExactlyOnceWith({
        project_id: PROJECT_ID,
        revision_receipt_digest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
      });
      expect(container.querySelector('[data-builder-unsaved-draft="true"]')).not.toBeNull();
      expectDraftDecisionCard(container);
    });
    expect(readTaskStream).toHaveBeenCalledWith({ project_id: PROJECT_ID, task_address_id: TASK_ADDRESS_ID });
    expect(saveDraft).not.toHaveBeenCalled();
    expect(restoreDraft).not.toHaveBeenCalled();
  });

  it('saves only after the explicit command, then shows the verified Git/SQLite version', async () => {
    const {
      container,
      listHistory,
      loadCurrent,
      readTaskStream,
      restoreDraft,
      saveDraft,
    } = await setup({ initiallySaved: true, pendingActivityAfterSave: true });
    await openSavedProject(container);
    await waitFor(() => {
      expect(readTaskStream).toHaveBeenCalledWith({ project_id: PROJECT_ID, task_address_id: TASK_ADDRESS_ID });
    });
    readTaskStream.mockClear();
    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
        ?.call(textarea, 'Make a timer.');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    click(container, '[data-builder-submit-turn="true"]');
    await waitFor(() => {
      expectDraftDecisionCard(container);
    });
    expect(container.querySelector<HTMLButtonElement>('[data-builder-save-version="true"]')?.disabled)
      .toBe(false);
    await waitFor(() => {
      expect(readTaskStream).toHaveBeenCalledWith({ project_id: PROJECT_ID, task_address_id: TASK_ADDRESS_ID });
    });
    readTaskStream.mockClear();
    click(container, '[data-builder-save-version="true"]');
    await waitFor(() => {
      expect(saveDraft).toHaveBeenCalledOnce();
    });
    await waitFor(() => {
      expect(loadCurrent).toHaveBeenCalledWith({ project_id: PROJECT_ID });
    });
    expect(container.querySelector('[data-builder-current-version="true"]')).toBeNull();

    expect(saveDraft).toHaveBeenCalledOnce();
    expect(saveDraft.mock.calls[0][0]).toEqual({
      draft_id: expect.stringMatching(/^builder-generation-draft:/u),
    });
    expect(loadCurrent).toHaveBeenCalledWith({ project_id: PROJECT_ID });
    await waitFor(() => {
      expect(readTaskStream).toHaveBeenCalledExactlyOnceWith({ project_id: PROJECT_ID, task_address_id: TASK_ADDRESS_ID });
    });
    expect(listHistory).toHaveBeenCalledWith({
      project_id: PROJECT_ID,
      limit: 128,
    });
    expect(restoreDraft).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();
    });
    await openVersionsPanel(container);
    await waitFor(() => {
      expect(container.querySelector('[data-builder-version-card="Version 1"]')?.textContent)
        .toContain('Current');
    });
    expect(container.textContent).not.toMatch(/sha256:|commit_oid|tree_oid|parent_oid|credential|provider/iu);
  });

  it('reads the main-owned automatic check result without executing a command from renderer', async () => {
    const {
      approveAndRunCurrentDraftCheck,
      container,
      readCurrentDraftAvailableChecks,
    } = await setup({
      initiallySaved: true,
      checkRunAvailable: true,
      checkRunStatus: 'passed',
    });
    await openSavedProject(container);
    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
        ?.call(textarea, 'Make a timer.');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(readCurrentDraftAvailableChecks).toHaveBeenCalledWith({
        draft_id: expect.stringMatching(/^builder-generation-draft:/u),
      });
    });
    expect(container.querySelector('[data-builder-run-check]')).toBeNull();

    await waitFor(() => {
      const checkStatus = container.querySelector('[data-builder-command-status="passed"]');
      expect(checkStatus?.textContent).toContain('Ran npm test');
      expect(checkStatus?.textContent).toContain('completed successfully');
    });
    expect(approveAndRunCurrentDraftCheck).not.toHaveBeenCalled();
    expect(container.querySelector<HTMLButtonElement>('[data-builder-save-version="true"]')?.disabled)
      .toBe(false);
  });

  it('retries read-only check discovery without moving command execution into renderer', async () => {
    const {
      approveAndRunCurrentDraftCheck,
      container,
      readCurrentDraftAvailableChecks,
    } = await setup({
      initiallySaved: true,
      checkRunAvailable: true,
      checkRunStatus: 'passed',
      failCheckRunReadAttempts: 2,
    });
    await openSavedProject(container);
    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
        ?.call(textarea, 'Make a timer.');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(readCurrentDraftAvailableChecks).toHaveBeenCalledTimes(3);
    });
    expect(approveAndRunCurrentDraftCheck).not.toHaveBeenCalled();
    expect(container.querySelector(
      '[data-builder-command-status="passed"]',
    )).not.toBeNull();
    expectDraftDecisionCard(container);
  });

  it('diagnoses dependency-blocked checks without preparing dependencies from the renderer', async () => {
    const {
      container,
      decideCurrentDraftDependencyPreparation,
      diagnoseCurrentDraftCheckEnvironment,
      readCurrentDraftAvailableChecks,
    } = await setup({
      initiallySaved: true,
      checkRunAvailable: true,
      dependencyBlockedCheck: true,
    });
    await openSavedProject(container);
    setComposerInstruction(container, 'Make a timer.');
    await waitForComposerSubmitReady(container);
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(readCurrentDraftAvailableChecks).toHaveBeenCalledWith({
        draft_id: expect.stringMatching(/^builder-generation-draft:/u),
      });
      expect(container.querySelector('[data-builder-dependency-preparation="true"]')).not.toBeNull();
    });
    click(container, '[data-builder-diagnose-check-environment="true"]');

    await waitFor(() => {
      expect(diagnoseCurrentDraftCheckEnvironment).toHaveBeenCalledExactlyOnceWith({
        draft_id: expect.stringMatching(/^builder-generation-draft:/u),
        command_profile_id: `builder-command-profile:${'1'.repeat(32)}`,
      });
      const diagnosis = container.querySelector('[data-builder-check-environment-diagnosis="ready"]');
      expect(diagnosis?.textContent).toContain('Readiness: The isolated check workspace has not prepared this draft\'s dependencies yet.');
      expect(diagnosis?.textContent).toContain('Toolchain: visible');
      expect(diagnosis?.textContent).toContain('Check workspace: install_missing');
      expect(diagnosis?.textContent).toContain('Package manager: npm');
    });
    expect(decideCurrentDraftDependencyPreparation).not.toHaveBeenCalled();
  });

  it('retries current draft file discovery while its durable projection is converging', async () => {
    const {
      container,
      readCurrentDraftFileTree,
    } = await setup({
      initiallySaved: true,
      sideWorkspaceFilesAvailable: true,
      failSideWorkspaceFileTreeReadAttempts: 2,
    });
    await openSavedProject(container);
    setComposerInstruction(container, 'Make a timer.');
    await waitForComposerSubmitReady(container);
    click(container, '[data-builder-submit-turn="true"]');
    await waitFor(() => {
      expectDraftDecisionCard(container);
    });

    click(container, '[data-builder-workspace-menu-button="true"]');
    await waitFor(() => {
      expect(container.querySelector('[data-builder-workspace-menu="true"]')).not.toBeNull();
    });
    click(container, '[data-builder-workspace-control-tab="source"]');

    await waitFor(() => {
      expect(readCurrentDraftFileTree).toHaveBeenCalledTimes(3);
      expect(container.querySelector(
        '[data-builder-side-workspace-files-status="ready"]',
      )).not.toBeNull();
      expect(container.querySelector(
        '[data-builder-side-workspace-file-content="index.html"]',
      )?.textContent).toContain('Focus timer');
    });
    expect(container.textContent).not.toContain('Current draft files are not available yet.');
  });

  it('loads saved project files from the side workspace when no draft is active', async () => {
    const {
      container,
      readCurrentDraftFileTree,
    } = await setup({
      initiallySaved: true,
      sideWorkspaceFilesAvailable: true,
      sideWorkspaceSourceKind: 'saved_revision',
    });
    await openSavedProject(container);

    click(container, '[data-builder-workspace-menu-button="true"]');
    await waitFor(() => {
      expect(container.querySelector('[data-builder-workspace-menu="true"]')).not.toBeNull();
    });
    click(container, '[data-builder-workspace-control-tab="source"]');

    await waitFor(() => {
      expect(readCurrentDraftFileTree).toHaveBeenCalledWith({
        project_id: PROJECT_ID,
        conversation_id: expect.stringMatching(/^builder-conversation:/u),
      });
      expect(container.querySelector(
        '[data-builder-side-workspace-files-status="ready"]',
      )).not.toBeNull();
      expect(container.querySelector('[data-builder-side-workspace-files="true"]')?.textContent)
        .toContain('Saved revision 1');
      expect(container.querySelector(
        '[data-builder-side-workspace-file-content="index.html"]',
      )?.textContent).toContain('Focus timer');
    });
    expect(container.textContent).not.toContain('Loading files...');
  });

  it('keeps unchecked drafts blocked without exposing manual check controls', async () => {
    const {
      container,
      saveDraft,
      skipCurrentDraftCheck,
    } = await setup({
      initiallySaved: true,
      uncheckedUntilSkip: true,
    });
    await openSavedProject(container);
    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
        ?.call(textarea, 'Make a timer.');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      const card = container.querySelector<HTMLElement>('[data-builder-composer-version-decision="true"]');
      expect(card).toBeNull();
      expect(container.textContent).not.toContain('Checking draft');
      expect(container.textContent).not.toContain('Finishing checks');
      expect(container.textContent).not.toContain('Save this draft?');
      expect(container.textContent).not.toContain('Builder has not finished checking this draft yet.');
      expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
      expect(container.querySelector('[data-builder-discard-draft="true"]')).toBeNull();
    });
    expect(saveDraft).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain('Skip check');
    expect(skipCurrentDraftCheck).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
  });

  it('keeps project instruction state when visiting Settings and returning', async () => {
    const { container } = await setup();
    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
        ?.call(textarea, 'Keep this instruction.');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    click(container, 'Settings');
    expect(container.textContent).toContain('AI provider settings');
    click(container, 'Back to project');
    expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value)
      .toBe('Keep this instruction.');
  });

  it('explains Settings environment diagnosis before a current draft exists without side effects', async () => {
    const {
      container,
      decideCurrentDraftDependencyPreparation,
      diagnoseCurrentDraftCheckEnvironment,
      diagnoseProjectEnvironment,
    } = await setup();

    click(container, 'Settings');
    await waitFor(() => {
      const card = container.querySelector('[data-builder-environment-diagnosis-settings="true"]');
      expect(card?.textContent).toContain('No current draft is available.');
      expect(card?.textContent).toContain('without preparing dependencies or running checks');
      expect(container.querySelector<HTMLButtonElement>(
        '[data-builder-settings-diagnose-environment="true"]',
      )?.disabled).toBe(true);
    });
    expect(diagnoseCurrentDraftCheckEnvironment).not.toHaveBeenCalled();
    expect(diagnoseProjectEnvironment).not.toHaveBeenCalled();
    expect(decideCurrentDraftDependencyPreparation).not.toHaveBeenCalled();
  });

  it('diagnoses the selected saved project environment before local launch actions', async () => {
    const {
      container,
      decideCurrentDraftDependencyPreparation,
      diagnoseCurrentDraftCheckEnvironment,
      diagnoseProjectEnvironment,
      prepareProjectDependencies,
    } = await setup({ initiallySaved: true });
    await openSavedProject(container);

    await waitFor(() => {
      const setupCard = container.querySelector('[data-builder-project-environment-setup="true"]');
      expect(setupCard?.textContent).toContain('Saved project dependencies needed');
      expect(setupCard?.textContent).toContain('Prepare once runs npm install in the saved project folder for local launch');
      expect(setupCard?.textContent).toContain('Current-draft checks still use their isolated workspace.');
    });
    expect(diagnoseProjectEnvironment).toHaveBeenCalledExactlyOnceWith({
      project_id: PROJECT_ID,
    });

    click(container, '[data-builder-prepare-project-dependencies="true"]');
    await waitFor(() => {
      expect(prepareProjectDependencies).toHaveBeenCalledExactlyOnceWith({
        project_id: PROJECT_ID,
      });
      expect(container.querySelector('[data-builder-project-environment-setup="true"]')).toBeNull();
    });

    click(container, 'Settings');

    await waitFor(() => {
      const card = container.querySelector('[data-builder-environment-diagnosis-settings="true"]');
      expect(card?.textContent).toContain('The project environment appears ready.');
      expect(card?.textContent).toContain('Project dependencies');
      expect(container.querySelector(
        '[data-builder-settings-environment-section="toolchain"]',
      )?.textContent).toContain('Node');
      expect(container.querySelector(
        '[data-builder-settings-environment-section="toolchain"]',
      )?.textContent).toContain('Git');
      expect(container.querySelector(
        '[data-builder-settings-environment-row="project_dependency_state"]',
      )?.textContent).toContain('Install Present');
      expect(container.querySelector(
        '[data-builder-settings-environment-diagnosis="ready"]',
      )?.getAttribute('data-builder-settings-environment-primary-action'))
        .toBe('none');
      expect(container.querySelector('[data-builder-settings-prepare-dependencies="true"]')).toBeNull();
      expect(container.querySelector(
        '[data-builder-settings-project-dependency-setup-read-only="true"]',
      )?.textContent).toContain('Settings only diagnoses and never installs into the project folder.');
    });
    expect(diagnoseCurrentDraftCheckEnvironment).not.toHaveBeenCalled();
    expect(decideCurrentDraftDependencyPreparation).not.toHaveBeenCalled();
  });

  it('shows check discovery loading in Settings without starting diagnosis or preparation', async () => {
    const {
      container,
      decideCurrentDraftDependencyPreparation,
      diagnoseCurrentDraftCheckEnvironment,
      readCurrentDraftAvailableChecks,
      resolveDeferredCheckRunRead,
    } = await setup({
      initiallySaved: true,
      checkRunAvailable: true,
      deferredCheckRunRead: true,
    });
    await openSavedProject(container);
    setComposerInstruction(container, 'Make a timer.');
    await waitForComposerSubmitReady(container);
    click(container, '[data-builder-submit-turn="true"]');
    await waitFor(() => {
      expect(readCurrentDraftAvailableChecks).toHaveBeenCalledOnce();
    });

    click(container, 'Settings');
    await waitFor(() => {
      const card = container.querySelector('[data-builder-environment-diagnosis-settings="true"]');
      expect(card?.textContent).toContain('Builder is discovering approved check commands for this draft.');
      expect(container.querySelector<HTMLButtonElement>(
        '[data-builder-settings-diagnose-environment="true"]',
      )?.disabled).toBe(true);
    });
    expect(diagnoseCurrentDraftCheckEnvironment).not.toHaveBeenCalled();
    expect(decideCurrentDraftDependencyPreparation).not.toHaveBeenCalled();
    await resolveDeferredCheckRunRead();
  });

  it('explains Settings environment diagnosis when a current draft has no approved checks', async () => {
    const {
      container,
      decideCurrentDraftDependencyPreparation,
      diagnoseCurrentDraftCheckEnvironment,
      readCurrentDraftAvailableChecks,
    } = await setup({
      initiallySaved: true,
      checkRunAvailable: false,
    });
    await openSavedProject(container);
    setComposerInstruction(container, 'Make a timer.');
    await waitForComposerSubmitReady(container);
    click(container, '[data-builder-submit-turn="true"]');
    await waitFor(() => {
      expect(readCurrentDraftAvailableChecks).toHaveBeenCalledWith({
        draft_id: expect.stringMatching(/^builder-generation-draft:/u),
      });
    });

    click(container, 'Settings');
    await waitFor(() => {
      const card = container.querySelector('[data-builder-environment-diagnosis-settings="true"]');
      expect(card?.textContent).toContain('No approved check command is available for the current draft.');
      expect(container.querySelector<HTMLButtonElement>(
        '[data-builder-settings-diagnose-environment="true"]',
      )?.disabled).toBe(true);
    });
    expect(diagnoseCurrentDraftCheckEnvironment).not.toHaveBeenCalled();
    expect(decideCurrentDraftDependencyPreparation).not.toHaveBeenCalled();
  });

  it('explains Settings environment diagnosis when check discovery fails', async () => {
    const {
      container,
      decideCurrentDraftDependencyPreparation,
      diagnoseCurrentDraftCheckEnvironment,
      readCurrentDraftAvailableChecks,
    } = await setup({
      initiallySaved: true,
      checkRunAvailable: true,
      failCheckRunReadAttempts: 12,
    });
    await openSavedProject(container);
    setComposerInstruction(container, 'Make a timer.');
    await waitForComposerSubmitReady(container);
    click(container, '[data-builder-submit-turn="true"]');
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 1300));
    });
    await waitFor(() => {
      expect(readCurrentDraftAvailableChecks).toHaveBeenCalledTimes(12);
    }, 160);

    click(container, 'Settings');
    await waitFor(() => {
      const card = container.querySelector('[data-builder-environment-diagnosis-settings="true"]');
      expect(card?.textContent).toContain('Builder could not discover approved check commands for this draft.');
      expect(container.querySelector<HTMLButtonElement>(
        '[data-builder-settings-diagnose-environment="true"]',
      )?.disabled).toBe(true);
    });
    expect(diagnoseCurrentDraftCheckEnvironment).not.toHaveBeenCalled();
    expect(decideCurrentDraftDependencyPreparation).not.toHaveBeenCalled();
  });

  it('shows a read-only environment diagnosis entry in Settings for the current draft check', async () => {
    const {
      container,
      decideCurrentDraftDependencyPreparation,
      diagnoseCurrentDraftCheckEnvironment,
    } = await setup({
      initiallySaved: true,
      checkRunAvailable: true,
      dependencyBlockedCheck: true,
    });
    await openSavedProject(container);
    setComposerInstruction(container, 'Make a timer.');
    await waitForComposerSubmitReady(container);
    click(container, '[data-builder-submit-turn="true"]');
    await waitFor(() => {
      expect(container.querySelector('[data-builder-dependency-preparation="true"]')).not.toBeNull();
    });

    click(container, 'Settings');
    await waitFor(() => {
      expect(container.querySelector('[data-builder-environment-diagnosis-settings="true"]')).not.toBeNull();
    });
    click(container, '[data-builder-settings-diagnose-environment="true"]');

    await waitFor(() => {
      expect(diagnoseCurrentDraftCheckEnvironment).toHaveBeenCalledExactlyOnceWith({
        draft_id: expect.stringMatching(/^builder-generation-draft:/u),
        command_profile_id: `builder-command-profile:${'1'.repeat(32)}`,
      });
      const diagnosis = container.querySelector('[data-builder-settings-environment-diagnosis="ready"]');
      expect(diagnosis?.textContent).toContain('The isolated check workspace has not prepared this draft\'s dependencies yet.');
      expect(diagnosis?.getAttribute('data-builder-settings-environment-primary-action')).toBe('prepare_once');
      expect(container.querySelector(
        '[data-builder-settings-environment-section="toolchain"]',
      )?.textContent).toContain('Host toolchain');
      expect(container.querySelector(
        '[data-builder-settings-environment-row="host_toolchain_state"]',
      )?.textContent).toContain('Visible');
      expect(container.querySelector(
        '[data-builder-settings-environment-row="package_manager"]',
      )?.textContent).toContain('npm 10.9.2');
      expect(container.querySelector(
        '[data-builder-settings-environment-row="lockfile"]',
      )?.textContent).toContain('package-lock.json');
      expect(container.querySelector(
        '[data-builder-settings-environment-section="check_workspace"]',
      )?.textContent).toContain('Check workspace');
      expect(container.querySelector(
        '[data-builder-settings-environment-row="check_workspace_dependency_state"]',
      )?.textContent).toContain('Install Missing');
    });
    expect(decideCurrentDraftDependencyPreparation).not.toHaveBeenCalled();
  });

  it('prepares current-draft check dependencies from Settings only after one-shot approval', async () => {
    const {
      container,
      decideCurrentDraftDependencyPreparation,
      diagnoseCurrentDraftCheckEnvironment,
      resolveDeferredDependencyPreparation,
    } = await setup({
      initiallySaved: true,
      checkRunAvailable: true,
      dependencyBlockedCheck: true,
      dependencyBlockedUntilPreparation: true,
      deferredDependencyPreparation: true,
    });
    await openSavedProject(container);
    setComposerInstruction(container, 'Make a timer.');
    await waitForComposerSubmitReady(container);
    click(container, '[data-builder-submit-turn="true"]');
    await waitFor(() => {
      expect(container.querySelector('[data-builder-dependency-preparation="true"]')).not.toBeNull();
    });

    click(container, 'Settings');
    await waitFor(() => {
      expect(container.querySelector('[data-builder-environment-diagnosis-settings="true"]')).not.toBeNull();
    });
    click(container, '[data-builder-settings-diagnose-environment="true"]');
    await waitFor(() => {
      expect(diagnoseCurrentDraftCheckEnvironment).toHaveBeenCalledExactlyOnceWith({
        draft_id: expect.stringMatching(/^builder-generation-draft:/u),
        command_profile_id: `builder-command-profile:${'1'.repeat(32)}`,
      });
      expect(container.querySelector('[data-builder-settings-prepare-dependencies="true"]')).not.toBeNull();
    });

    click(container, '[data-builder-settings-prepare-dependencies="true"]');
    await waitFor(() => {
      const button = container.querySelector<HTMLButtonElement>(
        '[data-builder-settings-prepare-dependencies="true"]',
      );
      expect(button?.textContent).toContain('Preparing...');
      expect(button?.disabled).toBe(true);
      expect(decideCurrentDraftDependencyPreparation).toHaveBeenCalledExactlyOnceWith({
        draft_id: expect.stringMatching(/^builder-generation-draft:/u),
        command_profile_id: `builder-command-profile:${'1'.repeat(32)}`,
        decision: 'allow_once',
      });
    });
    click(container, '[data-builder-settings-prepare-dependencies="true"]');
    expect(decideCurrentDraftDependencyPreparation).toHaveBeenCalledOnce();

    await resolveDeferredDependencyPreparation();
    await waitFor(() => {
      expect(container.querySelector('[data-builder-settings-prepare-dependencies="true"]')).toBeNull();
      expect(container.querySelector('[data-builder-settings-environment-diagnosis="ready"]')).toBeNull();
    });
  });
});
