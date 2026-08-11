import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  BUILDER_TASK_STREAM_READ_RESULT_VERSION,
  BuilderConversationSnapshotError,
  sanitizeBuilderConversationSnapshot,
} from './builderConversationSnapshot';

const UUID = '123e4567-e89b-42d3-a456-426614174000';
const PROJECT_ID = `builder-project:${UUID}`;
const CONVERSATION_ID = `builder-conversation:${UUID}`;

type MutableMessage = {
  message_id: string;
  text: string;
};

type MutableCandidate = {
  draft_id: string;
  title: string;
  summary: string;
  candidate_state: string;
  source_availability: string;
};

type MutableConversationItem = {
  item_kind: string;
  sequence: number;
  turn_id: string;
  message?: MutableMessage;
  message_id?: string;
  message_kind?: string;
  mode?: string | null;
  task?: { task_id: string; title: string } | null;
  consumed_by?: { turn_id: string; message_id: string };
  context?: {
    recorded_state: string;
    route: string;
    dispatch: string;
    downgraded_from: string | null;
    downgrade_reason: string | null;
    brief: string;
    base: string;
    permission_result: string;
    command_execution: string;
    network_access: string;
  };
  brief?: {
    status: string;
    summary: string;
    contextual_build_ready: boolean;
  };
  run_id?: string | null;
  task_id?: string | null;
  attempt_number?: number;
  retry_of_run_id?: string | null;
  recorded_state?: string;
  stage?: string;
  action?: string;
  step_id?: string;
  tool_call_id?: string;
  tool_label?: string;
  resource?: { resource_kind: string; resource_id?: string };
  result?: {
    status: string;
    summary_code: string;
    display_summary: string;
    summary_digest?: string;
    stdout?: string;
  } | null;
  lifecycle?: {
    conversation_admission?: string;
    permission_admission?: string;
    dispatch_admission?: string;
    execution_admission?: string;
    result_admission?: string;
    raw_output_admission?: string;
    revision_admission?: string;
  };
  step_index?: number;
  summary?: {
    status: string;
    display_summary: string;
  };
  terminal_status?: string;
  result_kind?: string;
  failure_phase?: string;
  assistant_message?: MutableMessage | null;
  candidate?: MutableCandidate | null;
  draft_id?: string;
  decision?: string;
  candidate_state?: string;
  saved_revision?: { revision_number: number } | null;
  plan_state?: string;
  plan_result_digest?: string;
  review_id?: string;
  reviewer_id?: string;
  reviewed_at_ms?: number;
  outcome?: string;
};

type MutableWire = {
  stream_version: string;
  project_id: string;
  context_status_projection?: unknown;
  provider_context_disclosure_status_projection?: unknown;
  check_run_outcome_projection?: unknown;
  conversation: {
    conversation_id: string;
    created_at_ms: number;
    head_sequence: number;
    recorded_active_turn_id: string | null;
    window: {
      first_sequence: number;
      last_sequence: number;
      has_earlier: boolean;
    };
    items: MutableConversationItem[];
  };
  authority: {
    conversation: string;
    project_source: string;
    candidate_source: string;
    project_revision: string;
  };
};

function checkRunOutcomeProjection(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const base = {
    projection_version: 'builder-check-run-outcome-projection.v1',
    state: 'unavailable',
    command_kind: null,
    command_label: null,
    status: 'unavailable',
    label: 'Check status unavailable',
    summary: 'Builder could not verify the check status for this draft.',
    completed_at_ms: null,
    authority: {
      projection_authority: 'main_owned_check_run_outcome_projection_v1',
      fact_source: 'status_unavailable',
      raw_output: 'not_present',
      runtime_paths: 'not_present',
      renderer_authority: 'read_only_projection',
      save_authority: false,
    },
  };
  return {
    ...base,
    ...overrides,
    authority: {
      ...base.authority,
      ...((overrides.authority as Record<string, unknown> | undefined) ?? {}),
    },
  };
}

function contextStatusProjection(overrides: Record<string, unknown> = {}): Record<string, unknown> {
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
      ...((overrides.authority as Record<string, unknown> | undefined) ?? {}),
    },
  };
}

function providerContextDisclosureStatusProjection(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
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
      ...((overrides.authority as Record<string, unknown> | undefined) ?? {}),
    },
  };
}

function id(
  kind: 'message' | 'turn' | 'task' | 'run' | 'run-step' | 'tool-call',
  index: number,
): string {
  const suffix = index.toString(16).padStart(12, '0');
  return `builder-${kind}:123e4567-e89b-42d3-a456-${suffix}`;
}

function authority() {
  return {
    conversation: 'sqlite_canonical_event_replay_or_absent',
    project_source: 'not_included',
    candidate_source: 'not_loaded',
    project_revision: 'not_inferred',
  };
}

function candidateWire(): MutableWire {
  const turnId = id('turn', 1);
  const taskId = id('task', 2);
  const runId = id('run', 3);
  return {
    stream_version: BUILDER_TASK_STREAM_READ_RESULT_VERSION,
    project_id: PROJECT_ID,
    conversation: {
      conversation_id: CONVERSATION_ID,
      created_at_ms: 1000,
      head_sequence: 4,
      recorded_active_turn_id: null,
      window: {
        first_sequence: 1,
        last_sequence: 4,
        has_earlier: false,
      },
      items: [
        {
          item_kind: 'user_message',
          sequence: 1,
          turn_id: turnId,
          message: {
            message_id: id('message', 4),
            text: 'Build a focused timer.',
          },
          message_kind: 'submitted',
          mode: 'work',
          task: {
            task_id: taskId,
            title: 'Create Builder project',
          },
        },
        {
          item_kind: 'run_started',
          sequence: 2,
          turn_id: turnId,
          run_id: runId,
          task_id: taskId,
          attempt_number: 1,
          retry_of_run_id: null,
          recorded_state: 'started',
        },
        {
          item_kind: 'run_completed',
          sequence: 3,
          turn_id: turnId,
          run_id: runId,
          terminal_status: 'succeeded',
          result_kind: 'candidate',
          failure_phase: 'not_applicable',
          assistant_message: {
            message_id: id('message', 5),
            text: 'I prepared a focused timer draft.',
          },
          candidate: {
            draft_id: `builder-generation-draft:${'9'.repeat(64)}`,
            title: 'Focused timer',
            summary: 'A focused timer draft.',
            candidate_state: 'proposed',
            source_availability: 'not_loaded',
          },
        },
        {
          item_kind: 'turn_completed',
          sequence: 4,
          turn_id: turnId,
          run_id: runId,
          outcome: 'candidate_ready',
        },
      ],
    },
    authority: authority(),
  };
}

function rejectedCandidateWire(): MutableWire {
  const wire = candidateWire();
  wire.conversation.head_sequence = 5;
  wire.conversation.window.last_sequence = 5;
  wire.conversation.items.push({
    item_kind: 'candidate_reviewed',
    sequence: 5,
    turn_id: id('turn', 1),
    run_id: id('run', 3),
    draft_id: `builder-generation-draft:${'9'.repeat(64)}`,
    decision: 'rejected',
    candidate_state: 'rejected',
    saved_revision: null,
  });
  return wire;
}

function routeDowngradeWire(): MutableWire {
  const turnId = id('turn', 31);
  const runId = id('run', 32);
  return {
    stream_version: BUILDER_TASK_STREAM_READ_RESULT_VERSION,
    project_id: PROJECT_ID,
    conversation: {
      conversation_id: CONVERSATION_ID,
      created_at_ms: 1000,
      head_sequence: 3,
      recorded_active_turn_id: turnId,
      window: {
        first_sequence: 1,
        last_sequence: 3,
        has_earlier: false,
      },
      items: [
        {
          item_kind: 'user_message',
          sequence: 1,
          turn_id: turnId,
          message: {
            message_id: id('message', 33),
            text: '那就写',
          },
          message_kind: 'submitted',
          mode: 'question',
          task: null,
        },
        {
          item_kind: 'run_started',
          sequence: 2,
          turn_id: turnId,
          run_id: runId,
          task_id: null,
          attempt_number: 1,
          retry_of_run_id: null,
          recorded_state: 'started',
        },
        {
          item_kind: 'run_context_snapshot_recorded',
          sequence: 3,
          turn_id: turnId,
          run_id: runId,
          task_id: null,
          context: {
            recorded_state: 'recorded',
            route: 'clarify',
            dispatch: 'reply',
            downgraded_from: 'build',
            downgrade_reason: 'missing_prior_build_context',
            brief: 'not_available',
            base: 'new_project_or_unsaved',
            permission_result: 'not_required',
            command_execution: 'not_included',
            network_access: 'not_included',
          },
        },
      ],
    },
    authority: authority(),
  };
}

function taskBriefWire(): MutableWire {
  const turnId = id('turn', 11);
  const runId = id('run', 12);
  return {
    stream_version: BUILDER_TASK_STREAM_READ_RESULT_VERSION,
    project_id: PROJECT_ID,
    conversation: {
      conversation_id: CONVERSATION_ID,
      created_at_ms: 1000,
      head_sequence: 5,
      recorded_active_turn_id: null,
      window: {
        first_sequence: 1,
        last_sequence: 5,
        has_earlier: false,
      },
      items: [
        {
          item_kind: 'user_message',
          sequence: 1,
          turn_id: turnId,
          message: {
            message_id: id('message', 13),
            text: '我想先聊一下这个作品集首页怎么做。',
          },
          message_kind: 'submitted',
          mode: 'question',
          task: null,
        },
        {
          item_kind: 'run_started',
          sequence: 2,
          turn_id: turnId,
          run_id: runId,
          task_id: null,
          attempt_number: 1,
          retry_of_run_id: null,
          recorded_state: 'started',
        },
        {
          item_kind: 'run_completed',
          sequence: 3,
          turn_id: turnId,
          run_id: runId,
          terminal_status: 'succeeded',
          result_kind: 'explanation',
          failure_phase: 'not_applicable',
          assistant_message: {
            message_id: id('message', 14),
            text: '可以先做一个单页作品集，包含 hero、项目卡片和联系入口。',
          },
          candidate: null,
        },
        {
          item_kind: 'task_brief_updated',
          sequence: 4,
          turn_id: turnId,
          run_id: runId,
          task: {
            task_id: id('task', 15),
            title: 'Current project brief',
          },
          brief: {
            status: 'ready',
            summary: '我想先聊一下这个作品集首页怎么做。 可以先做一个单页作品集，包含 hero、项目卡片和联系入口。',
            contextual_build_ready: true,
          },
          recorded_state: 'updated',
        },
        {
          item_kind: 'turn_completed',
          sequence: 5,
          turn_id: turnId,
          run_id: runId,
          outcome: 'answered',
        },
      ],
    },
    authority: authority(),
  };
}

function progressWire(): MutableWire {
  const wire = candidateWire();
  wire.conversation.head_sequence = 6;
  wire.conversation.window.last_sequence = 6;
  wire.conversation.items = [
    wire.conversation.items[0]!,
    wire.conversation.items[1]!,
    {
      item_kind: 'run_progress_recorded',
      sequence: 3,
      turn_id: id('turn', 1),
      run_id: id('run', 3),
      stage: 'context_ready',
      recorded_state: 'recorded',
    },
    {
      item_kind: 'run_progress_recorded',
      sequence: 4,
      turn_id: id('turn', 1),
      run_id: id('run', 3),
      stage: 'provider_request_started',
      recorded_state: 'recorded',
    },
    {
      ...wire.conversation.items[2]!,
      sequence: 5,
    },
    {
      ...wire.conversation.items[3]!,
      sequence: 6,
    },
  ];
  return wire;
}

function agentStepProgressWire(): MutableWire {
  const wire = candidateWire();
  wire.conversation.head_sequence = 6;
  wire.conversation.window.last_sequence = 6;
  wire.conversation.items = [
    wire.conversation.items[0]!,
    wire.conversation.items[1]!,
    {
      item_kind: 'agent_step_progress_recorded',
      sequence: 3,
      turn_id: id('turn', 1),
      run_id: id('run', 3),
      task_id: id('task', 2),
      step_id: id('run-step', 30),
      step_index: 30,
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
      turn_id: id('turn', 1),
      run_id: id('run', 3),
      task_id: id('task', 2),
      step_id: id('run-step', 30),
      step_index: 30,
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
    {
      ...wire.conversation.items[2]!,
      sequence: 5,
    },
    {
      ...wire.conversation.items[3]!,
      sequence: 6,
    },
  ];
  return wire;
}

function acceptedCandidateWire(): MutableWire {
  const wire = candidateWire();
  wire.conversation.head_sequence = 5;
  wire.conversation.window.last_sequence = 5;
  wire.conversation.items.push({
    item_kind: 'candidate_reviewed',
    sequence: 5,
    turn_id: id('turn', 1),
    run_id: id('run', 3),
    draft_id: `builder-generation-draft:${'9'.repeat(64)}`,
    decision: 'accepted',
    candidate_state: 'saved',
    saved_revision: { revision_number: 1 },
  });
  return wire;
}

function planWire(): MutableWire {
  const wire = candidateWire();
  wire.conversation.items[2] = {
    ...wire.conversation.items[2]!,
    terminal_status: 'succeeded',
    result_kind: 'plan',
    failure_phase: 'not_applicable',
    assistant_message: {
      message_id: id('message', 5),
      text: 'Review the proposed plan before files change.',
    },
    candidate: null,
  };
  wire.conversation.items[3] = {
    ...wire.conversation.items[3]!,
    outcome: 'plan_proposed',
  };
  return wire;
}

function reviewedPlanWire(decision: 'approved' | 'rejected' = 'approved'): MutableWire {
  const wire = planWire();
  wire.conversation.head_sequence = 5;
  wire.conversation.window.last_sequence = 5;
  wire.conversation.items.push({
    item_kind: 'plan_reviewed',
    sequence: 5,
    turn_id: id('turn', 1),
    run_id: id('run', 3),
    decision,
    plan_state: decision,
  });
  return wire;
}

function toolCallWire(): MutableWire {
  const wire = candidateWire();
  wire.conversation.head_sequence = 3;
  wire.conversation.recorded_active_turn_id = id('turn', 1);
  wire.conversation.window.last_sequence = 3;
  wire.conversation.items = wire.conversation.items.slice(0, 2);
  wire.conversation.items.push({
    item_kind: 'tool_call_requested',
    sequence: 3,
    turn_id: id('turn', 1),
    run_id: id('run', 3),
    step_id: id('run-step', 4),
    tool_call_id: id('tool-call', 5),
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
  return wire;
}

function toolResultWire(): MutableWire {
  const wire = toolCallWire();
  wire.conversation.head_sequence = 4;
  wire.conversation.window.last_sequence = 4;
  wire.conversation.items.push({
    item_kind: 'tool_call_result_recorded',
    sequence: 4,
    turn_id: id('turn', 1),
    run_id: id('run', 3),
    step_id: id('run-step', 4),
    tool_call_id: id('tool-call', 5),
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
  return wire;
}

function successfulToolCandidateWire(): MutableWire {
  const wire = toolResultWire();
  wire.conversation.head_sequence = 6;
  wire.conversation.recorded_active_turn_id = null;
  wire.conversation.window.last_sequence = 6;
  wire.conversation.items[3]!.result = {
    status: 'succeeded',
    summary_code: 'completed_without_raw_output',
    display_summary: 'This step completed. Details were not kept.',
  };
  wire.conversation.items.push(
    {
      item_kind: 'run_completed',
      sequence: 5,
      turn_id: id('turn', 1),
      run_id: id('run', 3),
      terminal_status: 'succeeded',
      result_kind: 'candidate',
      failure_phase: 'not_applicable',
      assistant_message: {
        message_id: id('message', 6),
        text: 'I prepared the draft after checking the file.',
      },
      candidate: {
        draft_id: `builder-generation-draft:${'8'.repeat(64)}`,
        title: 'Checked draft',
        summary: 'A draft prepared after checking the project file.',
        candidate_state: 'proposed',
        source_availability: 'not_loaded',
      },
    },
    {
      item_kind: 'turn_completed',
      sequence: 6,
      turn_id: id('turn', 1),
      run_id: id('run', 3),
      outcome: 'candidate_ready',
    },
  );
  return wire;
}

function completedTurnItems(
  turnIndex: number,
  firstSequence: number,
): MutableConversationItem[] {
  const wire = candidateWire();
  const turnId = id('turn', turnIndex * 10 + 1);
  const taskId = id('task', turnIndex * 10 + 2);
  const runId = id('run', turnIndex * 10 + 3);
  const userMessageId = id('message', turnIndex * 10 + 4);
  const assistantMessageId = id('message', turnIndex * 10 + 5);
  const items = structuredClone(wire.conversation.items);
  items[0] = {
    ...items[0],
    sequence: firstSequence,
    turn_id: turnId,
    message: { message_id: userMessageId, text: `Build timer ${turnIndex}.` },
    task: { task_id: taskId, title: `Create timer ${turnIndex}` },
  };
  items[1] = {
    ...items[1],
    sequence: firstSequence + 1,
    turn_id: turnId,
    run_id: runId,
    task_id: taskId,
  };
  items[2] = {
    ...items[2],
    sequence: firstSequence + 2,
    turn_id: turnId,
    run_id: runId,
    assistant_message: {
      message_id: assistantMessageId,
      text: `Timer ${turnIndex} is ready.`,
    },
    candidate: {
      ...items[2]!.candidate!,
      draft_id: `builder-generation-draft:${turnIndex.toString(16).padStart(64, '0')}`,
      title: `Timer ${turnIndex}`,
      summary: `Timer ${turnIndex} draft.`,
    },
  };
  items[3] = {
    ...items[3],
    sequence: firstSequence + 3,
    turn_id: turnId,
    run_id: runId,
  };
  return items;
}

function truncatedWire(): MutableWire {
  const wire = candidateWire();
  wire.conversation.items = Array.from(
    { length: 32 },
    (_, index) => completedTurnItems(index + 1, 5 + index * 4),
  ).flat();
  wire.conversation.head_sequence = 132;
  wire.conversation.recorded_active_turn_id = null;
  wire.conversation.window = {
    first_sequence: 5,
    last_sequence: 132,
    has_earlier: true,
  };
  return wire;
}

function expectUnavailable(value: unknown): void {
  expect(() => sanitizeBuilderConversationSnapshot(value)).toThrowError(
    BuilderConversationSnapshotError,
  );
  try {
    sanitizeBuilderConversationSnapshot(value);
  } catch (error) {
    expect(error).toMatchObject({
      code: 'builder_conversation_snapshot_unavailable',
      retryable: true,
      state: 'unavailable',
      message: 'Project activity is unavailable.',
    });
    expect(String((error as Error).stack)).not.toContain('private-marker');
  }
}

describe('Builder conversation snapshot', () => {
  it('sanitizes a ready task stream into a fresh deeply frozen snapshot', () => {
    const wire = candidateWire();
    const snapshot = sanitizeBuilderConversationSnapshot(wire);

    expect(snapshot.state).toBe('ready');
    if (snapshot.state !== 'ready') throw new Error('expected ready snapshot');
    expect(snapshot.project_id).toBe(PROJECT_ID);
    expect(snapshot.conversation.head_sequence).toBe(4);
    expect(snapshot.conversation.items[1]).toEqual({
      item_kind: 'run_started',
      sequence: 2,
      turn_id: id('turn', 1),
      run_id: id('run', 3),
      task_id: id('task', 2),
      attempt_number: 1,
      retry_of_run_id: null,
      recorded_state: 'started',
    });
    expect(snapshot.conversation.items[2]).toMatchObject({
      item_kind: 'run_completed',
      terminal_status: 'succeeded',
      result_kind: 'candidate',
      candidate: {
        candidate_state: 'proposed',
        source_availability: 'not_loaded',
      },
    });
    expect(snapshot).not.toBe(wire);
    expect(snapshot.conversation).not.toBe(wire.conversation);
    expect(snapshot.conversation.items).not.toBe(wire.conversation.items);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.conversation)).toBe(true);
    expect(Object.isFrozen(snapshot.conversation.items)).toBe(true);
    expect(Object.isFrozen(snapshot.conversation.items[2])).toBe(true);
  });

  it('restores a renderer-safe CheckRun outcome and rejects forged save authority', () => {
    const wire = candidateWire();
    wire.check_run_outcome_projection = checkRunOutcomeProjection();

    const snapshot = sanitizeBuilderConversationSnapshot(wire);
    expect(snapshot.state).toBe('ready');
    if (snapshot.state !== 'ready') throw new Error('expected ready snapshot');
    expect(snapshot.check_run_outcome_projection).toMatchObject({
      state: 'unavailable',
      status: 'unavailable',
      label: 'Check status unavailable',
    });
    expect(Object.isFrozen(snapshot.check_run_outcome_projection)).toBe(true);

    wire.check_run_outcome_projection = checkRunOutcomeProjection({
      authority: { save_authority: true },
    });
    expectUnavailable(wire);
  });

  it('accepts a queued active-run follow-up without treating it as a submitted turn', () => {
    const wire = candidateWire();
    const runStarted = wire.conversation.items[1]!;
    wire.conversation.head_sequence = 3;
    wire.conversation.recorded_active_turn_id = runStarted.turn_id;
    wire.conversation.window.last_sequence = 3;
    wire.conversation.items = [
      wire.conversation.items[0]!,
      runStarted,
      {
        item_kind: 'user_message',
        sequence: 3,
        turn_id: runStarted.turn_id,
        message: {
          message_id: id('message', 40),
          text: 'After this, make the summary shorter.',
        },
        message_kind: 'queued_followup',
        mode: null,
        task: null,
      },
    ];

    const snapshot = sanitizeBuilderConversationSnapshot(wire);

    expect(snapshot.state).toBe('ready');
    if (snapshot.state !== 'ready') throw new Error('expected ready snapshot');
    expect(snapshot.conversation.recorded_active_turn_id).toBe(runStarted.turn_id);
    expect(snapshot.conversation.items[2]).toEqual({
      item_kind: 'user_message',
      sequence: 3,
      turn_id: runStarted.turn_id,
      message: {
        message_id: id('message', 40),
        text: 'After this, make the summary shorter.',
      },
      message_kind: 'queued_followup',
      mode: null,
      task: null,
    });
  });

  it('accepts a consumed queued follow-up only before the consuming run starts', () => {
    const wire = candidateWire();
    const turnId = id('turn', 1);
    const runId = id('run', 3);
    const queuedMessageId = id('message', 40);
    const consumingTurnId = id('turn', 41);
    const consumingMessageId = id('message', 42);
    wire.conversation.head_sequence = 7;
    wire.conversation.recorded_active_turn_id = consumingTurnId;
    wire.conversation.window.last_sequence = 7;
    wire.conversation.items = [
      wire.conversation.items[0]!,
      wire.conversation.items[1]!,
      {
        item_kind: 'user_message',
        sequence: 3,
        turn_id: turnId,
        message: {
          message_id: queuedMessageId,
          text: 'Then make the summary shorter.',
        },
        message_kind: 'queued_followup',
        mode: null,
        task: null,
      },
      { ...wire.conversation.items[2]!, sequence: 4 },
      { ...wire.conversation.items[3]!, sequence: 5 },
      {
        item_kind: 'user_message',
        sequence: 6,
        turn_id: consumingTurnId,
        message: {
          message_id: consumingMessageId,
          text: 'Then make the summary shorter.',
        },
        message_kind: 'submitted',
        mode: 'work',
        task: {
          task_id: id('task', 43),
          title: 'Shorten summary',
        },
      },
      {
        item_kind: 'queued_followup_consumed',
        sequence: 7,
        turn_id: turnId,
        run_id: runId,
        message_id: queuedMessageId,
        consumed_by: {
          turn_id: consumingTurnId,
          message_id: consumingMessageId,
        },
        recorded_state: 'consumed',
      },
    ];

    const snapshot = sanitizeBuilderConversationSnapshot(wire);

    expect(snapshot.state).toBe('ready');
    if (snapshot.state !== 'ready') throw new Error('expected ready snapshot');
    expect(snapshot.conversation.recorded_active_turn_id).toBe(consumingTurnId);
    expect(snapshot.conversation.items.at(-1)).toEqual({
      item_kind: 'queued_followup_consumed',
      sequence: 7,
      turn_id: turnId,
      run_id: runId,
      message_id: queuedMessageId,
      consumed_by: {
        turn_id: consumingTurnId,
        message_id: consumingMessageId,
      },
      recorded_state: 'consumed',
    });

    wire.conversation.head_sequence = 8;
    wire.conversation.window.last_sequence = 8;
    wire.conversation.items.splice(6, 0, {
      item_kind: 'run_started',
      sequence: 7,
      turn_id: consumingTurnId,
      run_id: id('run', 44),
      task_id: id('task', 43),
      attempt_number: 1,
      retry_of_run_id: null,
      recorded_state: 'started',
    });
    wire.conversation.items[7]!.sequence = 8;
    expect(() => sanitizeBuilderConversationSnapshot(wire)).toThrowError(
      BuilderConversationSnapshotError,
    );
  });

  it('accepts a durable task brief update after a question explanation', () => {
    const snapshot = sanitizeBuilderConversationSnapshot(taskBriefWire());

    expect(snapshot.state).toBe('ready');
    if (snapshot.state !== 'ready') throw new Error('expected ready snapshot');
    expect(snapshot.conversation.items[3]).toEqual({
      item_kind: 'task_brief_updated',
      sequence: 4,
      turn_id: id('turn', 11),
      run_id: id('run', 12),
      task: {
        task_id: id('task', 15),
        title: 'Current project brief',
      },
      brief: {
        status: 'ready',
        summary: '我想先聊一下这个作品集首页怎么做。 可以先做一个单页作品集，包含 hero、项目卡片和联系入口。',
        contextual_build_ready: true,
      },
      recorded_state: 'updated',
    });
    expect(JSON.stringify(snapshot)).not.toMatch(
      /route_decision|provider|credential|source_tree|revision_receipt|commit_oid/iu,
    );
  });

  it('keeps optional context status projection as a safe top-level renderer fact', () => {
    const wire = candidateWire();
    wire.context_status_projection = contextStatusProjection();

    const snapshot = sanitizeBuilderConversationSnapshot(wire);

    expect(snapshot.state).toBe('ready');
    expect(snapshot.context_status_projection?.label).toBe('Handoff received');
    expect(snapshot.context_status_projection?.pending_handoff_count).toBe(1);
    expect(snapshot.context_status_projection?.can_contextual_execute).toBe(false);
    expect(Object.isFrozen(snapshot.context_status_projection)).toBe(true);
    expect(JSON.stringify(snapshot.context_status_projection))
      .not.toMatch(/WorkingContext|Task Capsule|builder-handoff-packet|builder-task-address:|sha256:|provider_(?:secret|config|envelope)|credential|source_tree/iu);
  });

  it('keeps optional provider context disclosure status as a safe top-level renderer fact', () => {
    const wire = candidateWire();
    wire.provider_context_disclosure_status_projection =
      providerContextDisclosureStatusProjection();

    const snapshot = sanitizeBuilderConversationSnapshot(wire);

    expect(snapshot.state).toBe('ready');
    expect(snapshot.provider_context_disclosure_status_projection?.label)
      .toBe('Allow AI to use current context');
    expect(snapshot.provider_context_disclosure_status_projection?.needs_user_approval)
      .toBe(true);
    expect(snapshot.provider_context_disclosure_status_projection?.can_use_provider_context)
      .toBe(false);
    expect(snapshot.provider_context_disclosure_status_projection?.request_available)
      .toBe(true);
    expect(snapshot.provider_context_disclosure_status_projection?.inspection?.purpose)
      .toBe('contextual_build');
    expect(snapshot.provider_context_disclosure_status_projection?.inspection?.context_surface.segment_count)
      .toBe(3);
    expect(Object.isFrozen(snapshot.provider_context_disclosure_status_projection)).toBe(true);
    expect(Object.isFrozen(snapshot.provider_context_disclosure_status_projection?.inspection))
      .toBe(true);
    expect(JSON.stringify(snapshot.provider_context_disclosure_status_projection))
      .not.toMatch(/builder-provider-context-disclosure-request|builder-context-assembly|builder-task-address:|sha256:|"provider_context":|api[_-]?key|credential|source_tree/iu);
  });

  it('rejects forged context status projection before it reaches the renderer snapshot', () => {
    const forgedLabel = candidateWire();
    forgedLabel.context_status_projection = contextStatusProjection({
      label: 'Handoff received sha256:aaaaaaaa',
    });
    expect(() => sanitizeBuilderConversationSnapshot(forgedLabel)).toThrowError(
      BuilderConversationSnapshotError,
    );

    const forgedAuthority = candidateWire();
    forgedAuthority.context_status_projection = contextStatusProjection({
      authority: {
        renderer_authority: 'trusted',
      },
    });
    expect(() => sanitizeBuilderConversationSnapshot(forgedAuthority)).toThrowError(
      BuilderConversationSnapshotError,
    );
  });

  it('rejects forged provider context disclosure status before it reaches the renderer snapshot', () => {
    const forgedCapability = candidateWire();
    forgedCapability.provider_context_disclosure_status_projection =
      providerContextDisclosureStatusProjection({
        can_use_provider_context: true,
      });
    expect(() => sanitizeBuilderConversationSnapshot(forgedCapability)).toThrowError(
      BuilderConversationSnapshotError,
    );

    const forgedAuthority = candidateWire();
    forgedAuthority.provider_context_disclosure_status_projection =
      providerContextDisclosureStatusProjection({
        authority: {
          permission_grant: true,
        },
      });
    expect(() => sanitizeBuilderConversationSnapshot(forgedAuthority)).toThrowError(
      BuilderConversationSnapshotError,
    );
  });

  it('represents an absent conversation without treating it as unavailable', () => {
    expect(sanitizeBuilderConversationSnapshot({
      stream_version: BUILDER_TASK_STREAM_READ_RESULT_VERSION,
      project_id: PROJECT_ID,
      conversation: null,
      authority: authority(),
    })).toEqual({
      state: 'absent',
      stream_version: BUILDER_TASK_STREAM_READ_RESULT_VERSION,
      project_id: PROJECT_ID,
      conversation: null,
      authority: authority(),
    });
  });

  it('preserves recorded facts without inferring a live run or saved revision', () => {
    const wire = candidateWire();
    wire.conversation.head_sequence = 2;
    wire.conversation.recorded_active_turn_id = id('turn', 1);
    wire.conversation.window.last_sequence = 2;
    wire.conversation.items = wire.conversation.items.slice(0, 2);

    const snapshot = sanitizeBuilderConversationSnapshot(wire);
    expect(snapshot.state).toBe('ready');
    const serialized = JSON.stringify(snapshot);
    expect(serialized).toContain('"recorded_state":"started"');
    expect(serialized).not.toMatch(
      /"running"|live_run|saved|save_admission|git_|receipt|digest|provider|credential|secret|source_tree/iu,
    );
  });

  it('accepts safe route downgrade facts without exposing route authority', () => {
    const snapshot = sanitizeBuilderConversationSnapshot(routeDowngradeWire());

    expect(snapshot.state).toBe('ready');
    if (snapshot.state !== 'ready') throw new Error('expected ready snapshot');
    expect(snapshot.conversation.items[2]).toEqual({
      item_kind: 'run_context_snapshot_recorded',
      sequence: 3,
      turn_id: id('turn', 31),
      run_id: id('run', 32),
      task_id: null,
      context: {
        recorded_state: 'recorded',
        route: 'clarify',
        dispatch: 'reply',
        downgraded_from: 'build',
        downgrade_reason: 'missing_prior_build_context',
        brief: 'not_available',
        base: 'new_project_or_unsaved',
        permission_result: 'not_required',
        command_execution: 'not_included',
        network_access: 'not_included',
      },
    });
    expect(JSON.stringify(snapshot)).not.toMatch(
      /route_decision|builder-route-decision|required_permissions|confidence|provider|credential|source_tree|revision_receipt|commit_oid/iu,
    );
  });

  it('rejects forged route downgrade facts in run context snapshots', () => {
    const invalidReason = routeDowngradeWire();
    invalidReason.conversation.items[2]!.context!.downgrade_reason = 'provider_failure';
    const leakedContext = routeDowngradeWire();
    (leakedContext.conversation.items[2]!.context as Record<string, unknown>).provider = 'private-marker';

    expectUnavailable(invalidReason);
    expectUnavailable(leakedContext);
  });

  it('accepts fixed run progress facts without exposing provider or source evidence', () => {
    const snapshot = sanitizeBuilderConversationSnapshot(progressWire());

    expect(snapshot.state).toBe('ready');
    if (snapshot.state !== 'ready') throw new Error('expected ready snapshot');
    expect(snapshot.conversation.items[2]).toEqual({
      item_kind: 'run_progress_recorded',
      sequence: 3,
      turn_id: id('turn', 1),
      run_id: id('run', 3),
      stage: 'context_ready',
      recorded_state: 'recorded',
    });
    expect(snapshot.conversation.items[3]).toEqual({
      item_kind: 'run_progress_recorded',
      sequence: 4,
      turn_id: id('turn', 1),
      run_id: id('run', 3),
      stage: 'provider_request_started',
      recorded_state: 'recorded',
    });
    expect(JSON.stringify(snapshot)).not.toMatch(
      /credential|source_tree|git_|receipt|digest|prompt|token|secret/iu,
    );
  });

  it('accepts fixed failed-run phases only when they match visible progress', () => {
    const wire = progressWire();
    wire.conversation.items[4] = {
      ...wire.conversation.items[4]!,
      terminal_status: 'failed',
      result_kind: 'failure',
      failure_phase: 'provider_request_started',
      assistant_message: {
        message_id: id('message', 5),
        text: 'The AI request ended before it returned a usable draft.',
      },
      candidate: null,
    };
    wire.conversation.items[5] = {
      ...wire.conversation.items[5]!,
      outcome: 'failed',
    };

    const snapshot = sanitizeBuilderConversationSnapshot(wire);
    expect(snapshot.state).toBe('ready');
    if (snapshot.state !== 'ready') throw new Error('expected ready snapshot');
    expect(snapshot.conversation.items[4]).toMatchObject({
      item_kind: 'run_completed',
      terminal_status: 'failed',
      result_kind: 'failure',
      failure_phase: 'provider_request_started',
    });

    const forgedPhase = structuredClone(wire);
    forgedPhase.conversation.items[4]!.failure_phase = 'context_ready';
    const forgedSuccess = progressWire();
    forgedSuccess.conversation.items[4]!.failure_phase = 'provider_request_started';

    expectUnavailable(forgedPhase);
    expectUnavailable(forgedSuccess);
    expect(JSON.stringify(snapshot)).not.toMatch(
      /provider_secret|credential|source_tree|git_|receipt|digest|prompt|token/iu,
    );
  });

  it('rejects forged, skipped, or duplicate run progress facts', () => {
    const leaked = progressWire();
    (leaked.conversation.items[2] as Record<string, unknown>).provider = 'private-model';

    const skipped = progressWire();
    skipped.conversation.items[2]!.stage = 'provider_request_started';

    const duplicate = progressWire();
    duplicate.conversation.items[3]!.stage = 'context_ready';

    const afterControl = progressWire();
    afterControl.conversation.head_sequence = 7;
    afterControl.conversation.window.last_sequence = 7;
    afterControl.conversation.items = [
      afterControl.conversation.items[0]!,
      afterControl.conversation.items[1]!,
      afterControl.conversation.items[2]!,
      {
        item_kind: 'run_control_requested',
        sequence: 4,
        turn_id: id('turn', 1),
        run_id: id('run', 3),
        action: 'cancel',
      },
      {
        ...afterControl.conversation.items[3]!,
        sequence: 5,
      },
      {
        ...afterControl.conversation.items[4]!,
        sequence: 6,
      },
      {
        ...afterControl.conversation.items[5]!,
        sequence: 7,
      },
    ];

    for (const value of [leaked, skipped, duplicate, afterControl]) {
      expectUnavailable(value);
    }
  });

  it('accepts admitted Agent step progress facts without exposing admission evidence', () => {
    const snapshot = sanitizeBuilderConversationSnapshot(agentStepProgressWire());

    expect(snapshot.state).toBe('ready');
    if (snapshot.state !== 'ready') throw new Error('expected ready snapshot');
    expect(snapshot.conversation.items[2]).toEqual({
      item_kind: 'agent_step_progress_recorded',
      sequence: 3,
      turn_id: id('turn', 1),
      run_id: id('run', 3),
      task_id: id('task', 2),
      step_id: id('run-step', 30),
      step_index: 30,
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
    });
    expect(snapshot.conversation.items[3]).toEqual({
      item_kind: 'agent_step_progress_recorded',
      sequence: 4,
      turn_id: id('turn', 1),
      run_id: id('run', 3),
      task_id: id('task', 2),
      step_id: id('run-step', 30),
      step_index: 30,
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
    });
    expect(JSON.stringify(snapshot)).not.toMatch(
      /progress_admission|admission_digest|read_service|step_start_count|step_result_count|provider|credential|source_tree|stdout|stderr|commit_oid|tree_oid|input_digest|prompt|token|secret/iu,
    );
  });

  it('rejects forged or out-of-order Agent step progress facts', () => {
    const leaked = agentStepProgressWire();
    (leaked.conversation.items[2] as Record<string, unknown>).admission_digest =
      `sha256:${'a'.repeat(64)}`;

    const resultBeforeStart = agentStepProgressWire();
    resultBeforeStart.conversation.items.splice(2, 1);
    resultBeforeStart.conversation.items = resultBeforeStart.conversation.items.map(
      (item, index) => ({ ...item, sequence: index + 1 }),
    );
    resultBeforeStart.conversation.head_sequence = 5;
    resultBeforeStart.conversation.window.last_sequence = 5;

    const mismatchedSummary = agentStepProgressWire();
    mismatchedSummary.conversation.items[3]!.summary = {
      status: 'failed',
      display_summary: 'Agent step completed. Details were not kept.',
    };

    const afterControl = agentStepProgressWire();
    afterControl.conversation.head_sequence = 7;
    afterControl.conversation.window.last_sequence = 7;
    afterControl.conversation.items.splice(3, 0, {
      item_kind: 'run_control_requested',
      sequence: 4,
      turn_id: id('turn', 1),
      run_id: id('run', 3),
      action: 'cancel',
    });
    afterControl.conversation.items = afterControl.conversation.items.map(
      (item, index) => ({ ...item, sequence: index + 1 }),
    );

    for (const value of [leaked, resultBeforeStart, mismatchedSummary, afterControl]) {
      expectUnavailable(value);
    }
  });

  it('accepts pre-dispatch tool call facts without exposing permission or resource evidence', () => {
    const snapshot = sanitizeBuilderConversationSnapshot(toolCallWire());

    expect(snapshot.state).toBe('ready');
    if (snapshot.state !== 'ready') throw new Error('expected ready snapshot');
    expect(snapshot.conversation.recorded_active_turn_id).toBe(id('turn', 1));
    expect(snapshot.conversation.items[2]).toEqual({
      item_kind: 'tool_call_requested',
      sequence: 3,
      turn_id: id('turn', 1),
      run_id: id('run', 3),
      step_id: id('run-step', 4),
      tool_call_id: id('tool-call', 5),
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
    expect(JSON.stringify(snapshot)).not.toMatch(
      /permission_id|permission_admission_receipt|record_digest|evidence_digest|resource_id|project:\/src\/app\.tsx|git_|receipt|digest|provider|credential|source_tree/iu,
    );
  });

  it('accepts fixed-code tool result facts without exposing records, raw output, or revisions', () => {
    const snapshot = sanitizeBuilderConversationSnapshot(toolResultWire());

    expect(snapshot.state).toBe('ready');
    if (snapshot.state !== 'ready') throw new Error('expected ready snapshot');
    expect(snapshot.conversation.recorded_active_turn_id).toBe(id('turn', 1));
    expect(snapshot.conversation.items[3]).toEqual({
      item_kind: 'tool_call_result_recorded',
      sequence: 4,
      turn_id: id('turn', 1),
      run_id: id('run', 3),
      step_id: id('run-step', 4),
      tool_call_id: id('tool-call', 5),
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
    expect(JSON.stringify(snapshot)).not.toMatch(
      /tool_result_record|tool_call_record|summary_digest|output_digest|stdout|stderr|permission_id|permission_admission_receipt|record_digest|evidence_digest|resource_id|project:\/src\/app\.tsx|git_|receipt|provider|credential|source_tree/iu,
    );
  });

  it('accepts a successful run after its tool result is recorded', () => {
    const snapshot = sanitizeBuilderConversationSnapshot(successfulToolCandidateWire());

    expect(snapshot.state).toBe('ready');
    if (snapshot.state !== 'ready') throw new Error('expected ready snapshot');
    expect(snapshot.conversation.recorded_active_turn_id).toBeNull();
    expect(snapshot.conversation.items.map((item) => item.item_kind)).toEqual([
      'user_message',
      'run_started',
      'tool_call_requested',
      'tool_call_result_recorded',
      'run_completed',
      'turn_completed',
    ]);
    expect(snapshot.conversation.items[4]).toMatchObject({
      item_kind: 'run_completed',
      terminal_status: 'succeeded',
      result_kind: 'candidate',
      assistant_message: {
        text: 'I prepared the draft after checking the file.',
      },
      candidate: {
        draft_id: `builder-generation-draft:${'8'.repeat(64)}`,
        candidate_state: 'proposed',
        source_availability: 'not_loaded',
      },
    });
  });

  it('accepts a successful run after a recorded failed tool step', () => {
    const wire = toolResultWire();
    wire.conversation.head_sequence = 6;
    wire.conversation.recorded_active_turn_id = null;
    wire.conversation.window.last_sequence = 6;
    wire.conversation.items.push(
      {
        ...candidateWire().conversation.items[2]!,
        sequence: 5,
      },
      {
        ...candidateWire().conversation.items[3]!,
        sequence: 6,
      },
    );

    const snapshot = sanitizeBuilderConversationSnapshot(wire);
    expect(snapshot.state).toBe('ready');
    if (snapshot.state !== 'ready') throw new Error('expected ready snapshot');
    expect(snapshot.conversation.items[3]).toMatchObject({
      item_kind: 'tool_call_result_recorded',
      result: {
        status: 'failed',
        summary_code: 'output_rejected',
      },
    });
    expect(snapshot.conversation.items[4]).toMatchObject({
      item_kind: 'run_completed',
      terminal_status: 'succeeded',
      result_kind: 'candidate',
    });
  });

  it('rejects tool call facts that imply execution, leaked resources, or unobserved success', () => {
    const executed = toolCallWire();
    executed.conversation.items[2]!.lifecycle!.execution_admission = 'performed';

    const leakedResource = toolCallWire();
    leakedResource.conversation.items[2]!.resource = {
      resource_kind: 'filesystem',
      resource_id: 'project:/src/app.tsx',
    };

    const leakedToolName = toolCallWire();
    leakedToolName.conversation.items[2]!.tool_label = 'credential.dump';

    const successAfterToolCall = toolCallWire();
    successAfterToolCall.conversation.head_sequence = 5;
    successAfterToolCall.conversation.recorded_active_turn_id = null;
    successAfterToolCall.conversation.window.last_sequence = 5;
    successAfterToolCall.conversation.items.push(
      {
        ...candidateWire().conversation.items[2]!,
        sequence: 4,
      },
      {
        ...candidateWire().conversation.items[3]!,
        sequence: 5,
      },
    );

    for (const value of [
      executed,
      leakedResource,
      leakedToolName,
      successAfterToolCall,
    ]) {
      expectUnavailable(value);
    }
  });

  it('rejects forged tool result facts and results that appear outside the requested step', () => {
    const driftedDisplay = toolResultWire();
    driftedDisplay.conversation.items[3]!.result!.display_summary = 'Ran filesystem.read.';

    const leakedDigest = toolResultWire();
    leakedDigest.conversation.items[3]!.result!.summary_digest = `sha256:${'a'.repeat(64)}`;

    const leakedStdout = toolResultWire();
    leakedStdout.conversation.items[3]!.result!.stdout = 'raw project bytes';

    const actionDrift = toolResultWire();
    actionDrift.conversation.items[3]!.action = 'context.read';
    actionDrift.conversation.items[3]!.tool_label = 'Read project context';

    const resourceDrift = toolResultWire();
    resourceDrift.conversation.items[3]!.action = 'project.edit';
    resourceDrift.conversation.items[3]!.tool_label = 'Prepare project edit';
    resourceDrift.conversation.items[3]!.resource = {
      resource_kind: 'project',
    };

    const resultBeforeRequest = toolResultWire();
    resultBeforeRequest.conversation.items = [
      resultBeforeRequest.conversation.items[0]!,
      resultBeforeRequest.conversation.items[1]!,
      {
        ...resultBeforeRequest.conversation.items[3]!,
        sequence: 3,
      },
      {
        ...resultBeforeRequest.conversation.items[2]!,
        sequence: 4,
      },
    ];

    const duplicateResult = toolResultWire();
    duplicateResult.conversation.head_sequence = 5;
    duplicateResult.conversation.window.last_sequence = 5;
    duplicateResult.conversation.items.push({
      ...duplicateResult.conversation.items[3]!,
      sequence: 5,
    });

    for (const value of [
      driftedDisplay,
      leakedDigest,
      leakedStdout,
      actionDrift,
      resourceDrift,
      resultBeforeRequest,
      duplicateResult,
    ]) {
      expectUnavailable(value);
    }
  });

  it('accepts rejected candidate review facts without exposing review identity', () => {
    const wire = rejectedCandidateWire();
    const snapshot = sanitizeBuilderConversationSnapshot(wire);

    expect(snapshot.state).toBe('ready');
    if (snapshot.state !== 'ready') throw new Error('expected ready snapshot');
    expect(snapshot.conversation.items[4]).toEqual({
      item_kind: 'candidate_reviewed',
      sequence: 5,
      turn_id: id('turn', 1),
      run_id: id('run', 3),
      draft_id: `builder-generation-draft:${'9'.repeat(64)}`,
      decision: 'rejected',
      candidate_state: 'rejected',
      saved_revision: null,
    });
    expect(JSON.stringify(snapshot)).not.toMatch(
      /review_id|reviewer_id|reviewed_at_ms|git_|receipt|digest|provider|credential|source_tree/iu,
    );
  });

  it('accepts saved candidate review facts with only the public version number', () => {
    const wire = acceptedCandidateWire();
    const snapshot = sanitizeBuilderConversationSnapshot(wire);

    expect(snapshot.state).toBe('ready');
    if (snapshot.state !== 'ready') throw new Error('expected ready snapshot');
    expect(snapshot.conversation.items[4]).toEqual({
      item_kind: 'candidate_reviewed',
      sequence: 5,
      turn_id: id('turn', 1),
      run_id: id('run', 3),
      draft_id: `builder-generation-draft:${'9'.repeat(64)}`,
      decision: 'accepted',
      candidate_state: 'saved',
      saved_revision: { revision_number: 1 },
    });
    expect(JSON.stringify(snapshot)).not.toMatch(
      /review_id|reviewer_id|reviewed_at_ms|revision_receipt|git_|receipt|digest|provider|credential|source_tree/iu,
    );
  });

  it('accepts plan review facts without exposing review identity or plan evidence', () => {
    const wire = reviewedPlanWire('approved');
    const snapshot = sanitizeBuilderConversationSnapshot(wire);

    expect(snapshot.state).toBe('ready');
    if (snapshot.state !== 'ready') throw new Error('expected ready snapshot');
    expect(snapshot.conversation.items[2]).toMatchObject({
      item_kind: 'run_completed',
      terminal_status: 'succeeded',
      result_kind: 'plan',
      candidate: null,
    });
    expect(snapshot.conversation.items[4]).toEqual({
      item_kind: 'plan_reviewed',
      sequence: 5,
      turn_id: id('turn', 1),
      run_id: id('run', 3),
      decision: 'approved',
      plan_state: 'approved',
    });
    expect(JSON.stringify(snapshot)).not.toMatch(
      /plan_result_digest|review_id|reviewer_id|reviewed_at_ms|plan_body|git_|receipt|digest|provider|credential|source_tree/iu,
    );
  });

  it('requires plan review facts to stay minimal and follow a completed proposed plan', () => {
    const missingState = reviewedPlanWire();
    delete missingState.conversation.items[4]!.plan_state;

    const mismatchedState = reviewedPlanWire();
    mismatchedState.conversation.items[4]!.plan_state = 'rejected';

    const leakedDigest = reviewedPlanWire();
    leakedDigest.conversation.items[4]!.plan_result_digest = `sha256:${'f'.repeat(64)}`;

    const candidateRunReviewed = candidateWire();
    candidateRunReviewed.conversation.head_sequence = 5;
    candidateRunReviewed.conversation.window.last_sequence = 5;
    candidateRunReviewed.conversation.items.push({
      item_kind: 'plan_reviewed',
      sequence: 5,
      turn_id: id('turn', 1),
      run_id: id('run', 3),
      decision: 'approved',
      plan_state: 'approved',
    });

    const reviewWhileTurnOpen = planWire();
    reviewWhileTurnOpen.conversation.recorded_active_turn_id = id('turn', 1);
    reviewWhileTurnOpen.conversation.head_sequence = 4;
    reviewWhileTurnOpen.conversation.window.last_sequence = 4;
    reviewWhileTurnOpen.conversation.items = reviewWhileTurnOpen.conversation.items.slice(0, 3);
    reviewWhileTurnOpen.conversation.items.push({
      item_kind: 'plan_reviewed',
      sequence: 4,
      turn_id: id('turn', 1),
      run_id: id('run', 3),
      decision: 'approved',
      plan_state: 'approved',
    });

    const duplicateReview = reviewedPlanWire();
    duplicateReview.conversation.head_sequence = 6;
    duplicateReview.conversation.window.last_sequence = 6;
    duplicateReview.conversation.items.push({
      item_kind: 'plan_reviewed',
      sequence: 6,
      turn_id: id('turn', 1),
      run_id: id('run', 3),
      decision: 'rejected',
      plan_state: 'rejected',
    });

    expectUnavailable(missingState);
    expectUnavailable(mismatchedState);
    expectUnavailable(leakedDigest);
    expectUnavailable(candidateRunReviewed);
    expectUnavailable(reviewWhileTurnOpen);
    expectUnavailable(duplicateReview);
  });

  it('requires accepted review facts to stay minimal and internally consistent', () => {
    const missingRevision = acceptedCandidateWire();
    delete missingRevision.conversation.items[4]!.saved_revision;

    const leakedRevision = acceptedCandidateWire();
    leakedRevision.conversation.items[4]!.saved_revision = {
      revision_number: 1,
      revision_receipt_digest: `sha256:${'f'.repeat(64)}`,
    } as unknown as { revision_number: number };

    const mismatchedState = acceptedCandidateWire();
    mismatchedState.conversation.items[4]!.candidate_state = 'rejected';

    const rejectedWithRevision = rejectedCandidateWire();
    rejectedWithRevision.conversation.items[4]!.saved_revision = { revision_number: 1 };

    expectUnavailable(missingRevision);
    expectUnavailable(leakedRevision);
    expectUnavailable(mismatchedState);
    expectUnavailable(rejectedWithRevision);
  });

  it('accepts a bounded truncated window without inventing omitted history', () => {
    const wire = truncatedWire();

    const snapshot = sanitizeBuilderConversationSnapshot(wire);
    expect(snapshot.state).toBe('ready');
    if (snapshot.state !== 'ready') throw new Error('expected ready snapshot');
    expect(snapshot.conversation.items).toHaveLength(128);
    expect(snapshot.conversation.window).toEqual({
      first_sequence: 5,
      last_sequence: 132,
      has_earlier: true,
    });
  });

  it('requires the exact Electron window size when earlier events are omitted', () => {
    const truncated = truncatedWire();
    truncated.conversation.items = truncated.conversation.items.slice(1);
    truncated.conversation.window.first_sequence = 6;

    const falseWithOmittedHistory = candidateWire();
    falseWithOmittedHistory.conversation.items =
      falseWithOmittedHistory.conversation.items.map((item) => ({
        ...item,
        sequence: item.sequence + 4,
      }));
    falseWithOmittedHistory.conversation.head_sequence = 8;
    falseWithOmittedHistory.conversation.window = {
      first_sequence: 5,
      last_sequence: 8,
      has_earlier: false,
    };

    expectUnavailable(truncated);
    expectUnavailable(falseWithOmittedHistory);
  });

  it('accepts a truncated suffix whose first event depends on omitted state', () => {
    const wire = truncatedWire();
    const firstTurn = wire.conversation.items.slice(0, 4);
    const lastTurnId = id('turn', 999);
    const lastTaskId = id('task', 998);
    const lastRunId = id('run', 997);
    wire.conversation.items = [
      {
        ...firstTurn[2],
        sequence: 5,
        terminal_status: 'cancelled',
        result_kind: 'failure',
        assistant_message: null,
        candidate: null,
      },
      {
        ...firstTurn[3],
        sequence: 6,
        outcome: 'cancelled',
      },
      ...Array.from(
        { length: 31 },
        (_, index) => completedTurnItems(index + 40, 7 + index * 4),
      ).flat(),
      {
        ...firstTurn[0],
        sequence: 131,
        turn_id: lastTurnId,
        message: {
          message_id: id('message', 996),
          text: 'Build one more timer.',
        },
        task: {
          task_id: lastTaskId,
          title: 'Create one more timer',
        },
      },
      {
        ...firstTurn[1],
        sequence: 132,
        turn_id: lastTurnId,
        run_id: lastRunId,
        task_id: lastTaskId,
      },
    ];
    wire.conversation.recorded_active_turn_id = lastTurnId;

    const snapshot = sanitizeBuilderConversationSnapshot(wire);
    expect(snapshot.state).toBe('ready');
    if (snapshot.state !== 'ready') throw new Error('expected ready snapshot');
    expect(snapshot.conversation.recorded_active_turn_id).toBe(lastTurnId);
  });

  it('accepts a truncated prefix tool call followed by a failed run retry', () => {
    const wire = truncatedWire();
    const prefixTurnId = id('turn', 700);
    const prefixRunId = id('run', 701);
    const retryRunId = id('run', 702);
    const retryTaskId = id('task', 703);
    const tailTurnId = id('turn', 12001);
    const tailTaskId = id('task', 12002);
    const tailRunId = id('run', 12003);
    wire.conversation.items = [
      {
        item_kind: 'tool_call_requested',
        sequence: 5,
        turn_id: prefixTurnId,
        run_id: prefixRunId,
        step_id: id('run-step', 704),
        tool_call_id: id('tool-call', 705),
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
      },
      {
        item_kind: 'run_completed',
        sequence: 6,
        turn_id: prefixTurnId,
        run_id: prefixRunId,
        terminal_status: 'failed',
        result_kind: 'failure',
        failure_phase: 'not_recorded',
        assistant_message: {
          message_id: id('message', 706),
          text: 'The file read could not finish.',
        },
        candidate: null,
      },
      {
        item_kind: 'run_started',
        sequence: 7,
        turn_id: prefixTurnId,
        run_id: retryRunId,
        task_id: retryTaskId,
        attempt_number: 2,
        retry_of_run_id: prefixRunId,
        recorded_state: 'started',
      },
      {
        item_kind: 'run_completed',
        sequence: 8,
        turn_id: prefixTurnId,
        run_id: retryRunId,
        terminal_status: 'failed',
        result_kind: 'failure',
        failure_phase: 'not_recorded',
        assistant_message: {
          message_id: id('message', 707),
          text: 'The retry also failed.',
        },
        candidate: null,
      },
      {
        item_kind: 'turn_completed',
        sequence: 9,
        turn_id: prefixTurnId,
        run_id: retryRunId,
        outcome: 'failed',
      },
      ...completedTurnItems(800, 10),
      ...Array.from(
        { length: 29 },
        (_, index) => completedTurnItems(index + 900, 14 + index * 4),
      ).flat(),
      {
        item_kind: 'user_message',
        sequence: 130,
        turn_id: tailTurnId,
        message: {
          message_id: id('message', 12004),
          text: 'Build another timer.',
        },
        message_kind: 'submitted',
        mode: 'work',
        task: {
          task_id: tailTaskId,
          title: 'Create another timer',
        },
      },
      {
        item_kind: 'run_started',
        sequence: 131,
        turn_id: tailTurnId,
        run_id: tailRunId,
        task_id: tailTaskId,
        attempt_number: 1,
        retry_of_run_id: null,
        recorded_state: 'started',
      },
      {
        item_kind: 'tool_call_requested',
        sequence: 132,
        turn_id: tailTurnId,
        run_id: tailRunId,
        step_id: id('run-step', 12005),
        tool_call_id: id('tool-call', 12006),
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
      },
    ].slice(0, 128);
    wire.conversation.head_sequence = 132;
    wire.conversation.window = {
      first_sequence: 5,
      last_sequence: 132,
      has_earlier: true,
    };
    wire.conversation.recorded_active_turn_id = tailTurnId;

    const snapshot = sanitizeBuilderConversationSnapshot(wire);
    expect(snapshot.state).toBe('ready');
    if (snapshot.state !== 'ready') throw new Error('expected ready snapshot');
    expect(snapshot.conversation.items[2]).toMatchObject({
      item_kind: 'run_started',
      run_id: retryRunId,
      task_id: retryTaskId,
    });
  });

  it('accepts a truncated prefix tool result whose request is in omitted history', () => {
    const wire = truncatedWire();
    const prefixTurnId = id('turn', 730);
    const prefixRunId = id('run', 731);
    const prefixStepId = id('run-step', 732);
    const prefixToolCallId = id('tool-call', 733);
    const tailTurnId = id('turn', 24001);
    const tailTaskId = id('task', 24002);
    wire.conversation.items = [
      {
        item_kind: 'tool_call_result_recorded',
        sequence: 5,
        turn_id: prefixTurnId,
        run_id: prefixRunId,
        step_id: prefixStepId,
        tool_call_id: prefixToolCallId,
        tool_label: 'Read project file',
        action: 'filesystem.read',
        resource: {
          resource_kind: 'filesystem',
        },
        result: {
          status: 'failed',
          summary_code: 'adapter_unavailable',
          display_summary: 'The tool was unavailable.',
        },
        lifecycle: {
          result_admission: 'fixed_summary_code_recorded',
          raw_output_admission: 'not_included',
          revision_admission: 'not_created',
        },
        recorded_state: 'recorded',
      },
      {
        item_kind: 'run_completed',
        sequence: 6,
        turn_id: prefixTurnId,
        run_id: prefixRunId,
        terminal_status: 'failed',
        result_kind: 'failure',
        failure_phase: 'not_recorded',
        assistant_message: {
          message_id: id('message', 734),
          text: 'The project step was unavailable.',
        },
        candidate: null,
      },
      {
        item_kind: 'turn_completed',
        sequence: 7,
        turn_id: prefixTurnId,
        run_id: prefixRunId,
        outcome: 'failed',
      },
      ...Array.from(
        { length: 31 },
        (_, index) => completedTurnItems(index + 1300, 8 + index * 4),
      ).flat(),
      {
        item_kind: 'user_message',
        sequence: 132,
        turn_id: tailTurnId,
        message: {
          message_id: id('message', 24003),
          text: 'Continue this project.',
        },
        message_kind: 'submitted',
        mode: 'work',
        task: {
          task_id: tailTaskId,
          title: 'Continue project',
        },
      },
    ];
    wire.conversation.head_sequence = 132;
    wire.conversation.window = {
      first_sequence: 5,
      last_sequence: 132,
      has_earlier: true,
    };
    wire.conversation.recorded_active_turn_id = tailTurnId;

    const snapshot = sanitizeBuilderConversationSnapshot(wire);
    expect(snapshot.state).toBe('ready');
    if (snapshot.state !== 'ready') throw new Error('expected ready snapshot');
    expect(snapshot.conversation.items[0]).toMatchObject({
      item_kind: 'tool_call_result_recorded',
      result: {
        summary_code: 'adapter_unavailable',
        display_summary: 'The tool was unavailable.',
      },
    });
  });

  it('accepts a truncated candidate rejection whose reviewed run is in omitted history', () => {
    const wire = truncatedWire();
    const omittedTurnId = id('turn', 777);
    const omittedRunId = id('run', 778);
    wire.conversation.items = [
      ...wire.conversation.items,
      {
        item_kind: 'candidate_reviewed',
        sequence: 133,
        turn_id: omittedTurnId,
        run_id: omittedRunId,
        draft_id: `builder-generation-draft:${'8'.repeat(64)}`,
        decision: 'rejected',
        candidate_state: 'rejected',
        saved_revision: null,
      },
    ].slice(1);
    wire.conversation.head_sequence = 133;
    wire.conversation.window = {
      first_sequence: 6,
      last_sequence: 133,
      has_earlier: true,
    };

    const snapshot = sanitizeBuilderConversationSnapshot(wire);
    expect(snapshot.state).toBe('ready');
    if (snapshot.state !== 'ready') throw new Error('expected ready snapshot');
    expect(snapshot.conversation.items.at(-1)).toEqual({
      item_kind: 'candidate_reviewed',
      sequence: 133,
      turn_id: omittedTurnId,
      run_id: omittedRunId,
      draft_id: `builder-generation-draft:${'8'.repeat(64)}`,
      decision: 'rejected',
      candidate_state: 'rejected',
      saved_revision: null,
    });
  });

  it('rejects impossible relationships proven inside a truncated suffix', () => {
    const questionCandidate = truncatedWire();
    questionCandidate.conversation.items[0] = {
      ...questionCandidate.conversation.items[0],
      mode: 'question',
      task: null,
    };
    questionCandidate.conversation.items[1] = {
      ...questionCandidate.conversation.items[1],
      task_id: null,
    };

    const steeringAfterControl = truncatedWire();
    const lastOffset = steeringAfterControl.conversation.items.length - 4;
    const lastTurn = steeringAfterControl.conversation.items[lastOffset]!;
    const lastRun = steeringAfterControl.conversation.items[lastOffset + 1]!;
    steeringAfterControl.conversation.items.splice(
      lastOffset,
      4,
      lastTurn,
      lastRun,
      {
        item_kind: 'run_control_requested',
        sequence: 131,
        turn_id: lastTurn.turn_id,
        run_id: lastRun.run_id,
        action: 'cancel',
      },
      {
        item_kind: 'user_message',
        sequence: 132,
        turn_id: lastTurn.turn_id,
        message: {
          message_id: id('message', 995),
          text: 'Keep the controls compact.',
        },
        message_kind: 'steering',
        mode: null,
        task: null,
      },
    );
    steeringAfterControl.conversation.recorded_active_turn_id =
      lastTurn.turn_id;

    const completedButActive = truncatedWire();
    completedButActive.conversation.recorded_active_turn_id =
      completedButActive.conversation.items.at(-1)!.turn_id;

    const prefixQuestionCandidate = truncatedWire();
    const prefixTurn = completedTurnItems(500, 5);
    const activeTurn = completedTurnItems(900, 132)[0]!;
    prefixQuestionCandidate.conversation.items = [
      {
        ...prefixTurn[1],
        sequence: 5,
        task_id: null,
      },
      {
        ...prefixTurn[2],
        sequence: 6,
      },
      {
        ...prefixTurn[3],
        sequence: 7,
      },
      ...Array.from(
        { length: 31 },
        (_, index) => completedTurnItems(index + 600, 8 + index * 4),
      ).flat(),
      activeTurn,
    ];
    prefixQuestionCandidate.conversation.recorded_active_turn_id =
      activeTurn.turn_id;

    const reusedTurn = truncatedWire();
    const reusedTurnId = reusedTurn.conversation.items[0]!.turn_id;
    for (
      let index = reusedTurn.conversation.items.length - 4;
      index < reusedTurn.conversation.items.length;
      index += 1
    ) {
      reusedTurn.conversation.items[index] = {
        ...reusedTurn.conversation.items[index]!,
        turn_id: reusedTurnId,
      };
    }

    const visibleDraftPoison = truncatedWire();
    const visibleDraftId = visibleDraftPoison.conversation.items.at(-2)!.candidate!.draft_id;
    visibleDraftPoison.conversation.items = [
      ...visibleDraftPoison.conversation.items,
      {
        item_kind: 'candidate_reviewed',
        sequence: 133,
        turn_id: id('turn', 777),
        run_id: id('run', 778),
        draft_id: visibleDraftId,
        decision: 'rejected',
        candidate_state: 'rejected',
        saved_revision: null,
      },
    ].slice(1);
    visibleDraftPoison.conversation.head_sequence = 133;
    visibleDraftPoison.conversation.window = {
      first_sequence: 6,
      last_sequence: 133,
      has_earlier: true,
    };

    for (const value of [
      questionCandidate,
      steeringAfterControl,
      completedButActive,
      prefixQuestionCandidate,
      reusedTurn,
      visibleDraftPoison,
    ]) {
      expectUnavailable(value);
    }
  });

  it('accepts explanation, cancel, interrupt, and fixed failure terminal facts', () => {
    for (const terminal of [
      {
        terminal_status: 'succeeded',
        result_kind: 'explanation',
        failure_phase: 'not_applicable',
        assistant_message: {
          message_id: id('message', 5),
          text: 'The current project contains a timer.',
        },
        outcome: 'answered',
        mode: 'question',
        task: null,
      },
      {
        terminal_status: 'failed',
        result_kind: 'failure',
        failure_phase: 'not_recorded',
        assistant_message: {
          message_id: id('message', 5),
          text: 'The draft could not be made.',
        },
        outcome: 'failed',
        mode: 'work',
        task: { task_id: id('task', 2), title: 'Update Builder project' },
      },
    ] as const) {
      const wire = candidateWire();
      wire.conversation.items[0] = {
        ...wire.conversation.items[0],
        mode: terminal.mode,
        task: terminal.task,
      };
      wire.conversation.items[1] = {
        ...wire.conversation.items[1],
        task_id: terminal.task?.task_id ?? null,
      };
      wire.conversation.items[2] = {
        ...wire.conversation.items[2],
        terminal_status: terminal.terminal_status,
        result_kind: terminal.result_kind,
        failure_phase: terminal.failure_phase,
        assistant_message: terminal.assistant_message,
        candidate: null,
      };
      wire.conversation.items[3] = {
        ...wire.conversation.items[3],
        outcome: terminal.outcome,
      };
      expect(sanitizeBuilderConversationSnapshot(wire).state).toBe('ready');
    }

    for (const [action, terminalStatus] of [
      ['cancel', 'cancelled'],
      ['interrupt', 'interrupted'],
    ] as const) {
      const wire = candidateWire();
      wire.conversation.head_sequence = 5;
      wire.conversation.window.last_sequence = 5;
      wire.conversation.items.splice(2, 0, {
        item_kind: 'run_control_requested',
        sequence: 3,
        turn_id: id('turn', 1),
        run_id: id('run', 3),
        action,
      });
      wire.conversation.items[3] = {
        ...wire.conversation.items[3],
        sequence: 4,
        terminal_status: terminalStatus,
        result_kind: 'failure',
        assistant_message: null,
        candidate: null,
      };
      wire.conversation.items[4] = {
        ...wire.conversation.items[4],
        sequence: 5,
        outcome: terminalStatus,
      };
      expect(sanitizeBuilderConversationSnapshot(wire).state).toBe('ready');
    }
  });

  it('rejects missing, extra, hidden, accessor, symbol, sparse, and custom prototype data', () => {
    const missing = structuredClone(candidateWire()) as Record<string, unknown>;
    delete missing.authority;
    const extra = { ...candidateWire(), internal: 'private-marker' };
    const hidden = candidateWire();
    Object.defineProperty(hidden, 'internal', { value: 'private-marker' });
    const accessor = candidateWire();
    Object.defineProperty(accessor, 'authority', {
      enumerable: true,
      get() {
        throw new Error('private-marker');
      },
    });
    const symbol = candidateWire();
    Object.defineProperty(symbol, Symbol('private-marker'), { value: true });
    const sparse = candidateWire();
    delete sparse.conversation.items[1];
    let customMapReads = 0;
    const customArrayPrototype = Object.create(Array.prototype) as object;
    Object.defineProperty(customArrayPrototype, 'map', {
      get() {
        customMapReads += 1;
        throw new Error('private-marker');
      },
    });
    const customPrototype = candidateWire();
    Object.setPrototypeOf(customPrototype.conversation.items, customArrayPrototype);

    for (const value of [
      missing,
      extra,
      hidden,
      accessor,
      symbol,
      sparse,
      customPrototype,
    ]) {
      expectUnavailable(value);
    }
    expect(customMapReads).toBe(0);
  });

  it('rejects identity, authority, sequence, state, and cross-field drift', () => {
    const values: unknown[] = [];
    const crossProject = candidateWire();
    crossProject.conversation.conversation_id =
      'builder-conversation:223e4567-e89b-42d3-a456-426614174000';
    values.push(crossProject);
    const badAuthority = candidateWire();
    badAuthority.authority.project_revision = 'saved';
    values.push(badAuthority);
    const badWindow = candidateWire();
    badWindow.conversation.window.last_sequence = 3;
    values.push(badWindow);
    const gap = candidateWire();
    gap.conversation.items[2]!.sequence = 9;
    values.push(gap);
    const live = candidateWire();
    live.conversation.items[1]!.recorded_state = 'running';
    values.push(live);
    const saved = candidateWire();
    saved.conversation.items[2]!.candidate!.candidate_state = 'saved';
    values.push(saved);
    const badReviewState = rejectedCandidateWire();
    badReviewState.conversation.items[4]!.candidate_state = 'saved';
    values.push(badReviewState);
    const reviewBeforeTurnCompleted = rejectedCandidateWire();
    reviewBeforeTurnCompleted.conversation.items.splice(
      3,
      2,
      { ...reviewBeforeTurnCompleted.conversation.items[4]!, sequence: 4 },
      { ...reviewBeforeTurnCompleted.conversation.items[3]!, sequence: 5 },
    );
    values.push(reviewBeforeTurnCompleted);
    const badTerminal = candidateWire();
    badTerminal.conversation.items[2]!.terminal_status = 'failed';
    values.push(badTerminal);
    const badOutcome = candidateWire();
    badOutcome.conversation.items[3]!.outcome = 'responded';
    values.push(badOutcome);
    const badActive = candidateWire();
    badActive.conversation.recorded_active_turn_id = id('turn', 1);
    values.push(badActive);

    for (const value of values) expectUnavailable(value);
  });

  it('rejects unsafe text, lone surrogates, and resource overflow', () => {
    const secret = candidateWire();
    secret.conversation.items[0]!.message!.text =
      'api_key=private-marker-private-marker';
    const path = candidateWire();
    path.conversation.items[0]!.message!.text = 'Open C:\\private\\file.txt';
    const surrogate = candidateWire();
    surrogate.conversation.items[2]!.candidate!.summary = '\ud800';
    const oversized = candidateWire();
    oversized.conversation.items[0]!.message!.text = 'a'.repeat(8193);
    const tooMany = candidateWire();
    tooMany.conversation.items = Array.from(
      { length: 129 },
      (_, index) => ({
        ...candidateWire().conversation.items[0],
        sequence: index + 1,
      }),
    );
    tooMany.conversation.head_sequence = 129;
    tooMany.conversation.window.last_sequence = 129;
    const sequenceOverflow = truncatedWire();
    sequenceOverflow.conversation.items =
      sequenceOverflow.conversation.items.map((item) => ({
        ...item,
        sequence: item.sequence + 893,
      }));
    sequenceOverflow.conversation.head_sequence = 1025;
    sequenceOverflow.conversation.window = {
      first_sequence: 898,
      last_sequence: 1025,
      has_earlier: true,
    };

    for (const value of [
      secret,
      path,
      surrogate,
      oversized,
      tooMany,
      sequenceOverflow,
    ]) {
      expectUnavailable(value);
    }
  });

  it('does not import React, host bridges, storage, Git, SQLite, or legacy Chat', () => {
    const source = readFileSync(
      join(
        process.cwd(),
        'src',
        'features',
        'builder',
        'domain',
        'builderConversationSnapshot.ts',
      ),
      'utf8',
    );
    expect(source).not.toMatch(
      /from ['"]react|ipcRenderer|contextBridge|preload|localStorage|sessionStorage|indexedDB|node:sqlite|better-sqlite|builder-git|node:fs|fetch\s*\(|ChatCreatePage|chat_planner|AppLayout|Canvas|\bJobMeta\b/iu,
    );
    expect(source).toContain("'recorded_state'");
    expect(source).toContain("project_revision: 'not_inferred'");
  });
});
