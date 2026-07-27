import { describe, expect, it, vi } from 'vitest';

import {
  createBuilderConversationController,
  isTrustedBuilderConversationControllerSnapshot,
} from './builderConversationController';
import type { BuilderTaskStreamPort } from './builderPorts';

const PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174000';
const OTHER_PROJECT_ID = 'builder-project:223e4567-e89b-42d3-a456-426614174000';
const UUID = '123e4567-e89b-42d3-a456-426614174000';
const OTHER_UUID = '223e4567-e89b-42d3-a456-426614174000';

function id(prefix: string, value = UUID): string {
  return `builder-${prefix}:${value}`;
}

function absentWire(projectId = PROJECT_ID): unknown {
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

function readyWire(projectId = PROJECT_ID, uuid = UUID): unknown {
  const turnId = id('turn', uuid);
  const runId = id('run', uuid);
  const assistantMessageUuid = uuid === UUID ? OTHER_UUID : UUID;
  return {
    stream_version: 'builder-task-stream-read-result.v1',
    project_id: projectId,
    conversation: {
      conversation_id: `builder-conversation:${uuid}`,
      created_at_ms: 1,
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
            message_id: id('message', uuid),
            text: 'Make a timer.',
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
          assistant_message: {
            message_id: `builder-message:${assistantMessageUuid}`,
            text: 'I prepared the project.',
          },
          candidate: null,
        },
        {
          item_kind: 'turn_completed',
          sequence: 4,
          turn_id: turnId,
          run_id: runId,
          outcome: 'answered',
        },
      ],
    },
    authority: {
      conversation: 'sqlite_canonical_event_replay_or_absent',
      project_source: 'not_included',
      candidate_source: 'not_loaded',
      project_revision: 'not_inferred',
    },
  };
}

function setup(read: BuilderTaskStreamPort['read'] = async () => readyWire()) {
  const readMock = vi.fn(read);
  const controller = createBuilderConversationController({
    read: readMock,
    subscribeChanged: () => () => undefined,
  });
  return { controller, read: readMock };
}

describe('Builder conversation controller', () => {
  it('loads a ready task stream without fabricating optimistic messages', async () => {
    let resolve!: (value: unknown) => void;
    const pending = new Promise<unknown>((next) => {
      resolve = next;
    });
    const { controller, read } = setup(async () => pending);

    const operation = controller.load(PROJECT_ID);
    expect(controller.getSnapshot()).toMatchObject({
      status: 'loading',
      project_id: PROJECT_ID,
      conversation: null,
      busy: true,
    });
    resolve(readyWire());
    const result = await operation;

    expect(read).toHaveBeenCalledExactlyOnceWith({ project_id: PROJECT_ID });
    expect(result.status).toBe('ready');
    expect(result.conversation?.state).toBe('ready');
    if (result.conversation?.state !== 'ready') throw new Error('expected ready stream');
    expect(result.conversation.conversation.items).toHaveLength(4);
    expect(isTrustedBuilderConversationControllerSnapshot(result)).toBe(true);
  });

  it('represents an absent conversation as a durable read result', async () => {
    const { controller } = setup(async () => absentWire());
    const result = await controller.load(PROJECT_ID);

    expect(result.status).toBe('absent');
    expect(result.conversation?.state).toBe('absent');
    expect(result.error).toBeNull();
  });

  it('coalesces repeated loads for the same in-flight project', async () => {
    let resolve!: (value: unknown) => void;
    const pending = new Promise<unknown>((next) => {
      resolve = next;
    });
    const { controller, read } = setup(async () => pending);

    const first = controller.load(PROJECT_ID);
    const second = controller.load(PROJECT_ID);
    resolve(absentWire());

    expect(await first).toBe(await second);
    expect(read).toHaveBeenCalledExactlyOnceWith({ project_id: PROJECT_ID });
  });

  it('retains the previous stream during manual refresh and marks it stale on failure', async () => {
    const { controller, read } = setup(async () => readyWire());
    await controller.load(PROJECT_ID);
    read.mockImplementation(async () => {
      throw new Error('private local database marker');
    });

    const refresh = controller.refresh();
    expect(controller.getSnapshot()).toMatchObject({
      status: 'refreshing',
      project_id: PROJECT_ID,
      conversation: { state: 'ready' },
    });
    const result = await refresh;

    expect(result.status).toBe('stale');
    expect(result.error).toBe('unavailable');
    expect(result.conversation?.state).toBe('ready');
    expect(JSON.stringify(result)).not.toContain('private local database marker');
  });

  it('ignores stale completions after a newer project selection starts', async () => {
    let resolveFirst!: (value: unknown) => void;
    const first = new Promise<unknown>((resolve) => {
      resolveFirst = resolve;
    });
    const { controller, read } = setup(async () => first);
    const firstLoad = controller.load(PROJECT_ID);
    read.mockImplementation(async () => readyWire(OTHER_PROJECT_ID, OTHER_UUID));

    const second = await controller.load(OTHER_PROJECT_ID);
    resolveFirst(readyWire());
    await firstLoad;

    expect(second.project_id).toBe(OTHER_PROJECT_ID);
    expect(controller.getSnapshot().project_id).toBe(OTHER_PROJECT_ID);
    expect(controller.getSnapshot().conversation?.project_id).toBe(OTHER_PROJECT_ID);
  });

  it('fails closed for invalid project identity and clears when no project is selected', async () => {
    const { controller, read } = setup();

    expect(await controller.load('bad-project-id')).toMatchObject({
      status: 'unavailable',
      project_id: null,
      conversation: null,
      error: 'unavailable',
    });
    expect(read).not.toHaveBeenCalled();

    expect(await controller.load(null)).toMatchObject({
      status: 'idle',
      project_id: null,
      conversation: null,
      error: null,
    });
  });
});
