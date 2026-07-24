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
  terminal_status?: string;
  result_kind?: string;
  assistant_message?: MutableMessage | null;
  candidate?: MutableCandidate | null;
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

function id(kind: 'message' | 'turn' | 'task' | 'run', index: number): string {
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

    for (const value of [
      questionCandidate,
      steeringAfterControl,
      completedButActive,
      prefixQuestionCandidate,
      reusedTurn,
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
