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
  message_kind?: string;
  mode?: string | null;
  task?: { task_id: string; title: string } | null;
  run_id?: string | null;
  task_id?: string | null;
  attempt_number?: number;
  retry_of_run_id?: string | null;
  recorded_state?: string;
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
  };
  lifecycle?: {
    permission_admission?: string;
    dispatch_admission?: string;
    execution_admission?: string;
    result_admission: string;
    raw_output_admission?: string;
    revision_admission?: string;
  };
  terminal_status?: string;
  result_kind?: string;
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

    const successAfterToolResult = toolResultWire();
    successAfterToolResult.conversation.head_sequence = 6;
    successAfterToolResult.conversation.recorded_active_turn_id = null;
    successAfterToolResult.conversation.window.last_sequence = 6;
    successAfterToolResult.conversation.items.push(
      {
        ...candidateWire().conversation.items[2]!,
        sequence: 5,
      },
      {
        ...candidateWire().conversation.items[3]!,
        sequence: 6,
      },
    );

    for (const value of [
      driftedDisplay,
      leakedDigest,
      leakedStdout,
      actionDrift,
      resourceDrift,
      resultBeforeRequest,
      duplicateResult,
      successAfterToolResult,
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
