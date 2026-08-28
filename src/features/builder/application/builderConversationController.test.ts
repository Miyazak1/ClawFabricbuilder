import { describe, expect, it, vi } from 'vitest';

import {
  createBuilderConversationController,
  isTrustedBuilderConversationControllerSnapshot,
} from './builderConversationController';
import type { BuilderTaskStreamPort } from './builderPorts';

const PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174000';
const OTHER_PROJECT_ID = 'builder-project:223e4567-e89b-42d3-a456-426614174000';
const TASK_ADDRESS_ID = 'builder-task-address:123e4567-e89b-42d3-a456-426614174001';
const OTHER_TASK_ADDRESS_ID = 'builder-task-address:223e4567-e89b-42d3-a456-426614174001';
const AGENT_ID = 'builder-agent:123e4567-e89b-42d3-a456-426614174000';
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
      conversation_id:
        `builder-conversation:${uuid}:323e4567-e89b-42d3-a456-426614174000`,
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
          failure_phase: 'not_applicable',
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

function setupChanged(read: BuilderTaskStreamPort['read'] = async () => readyWire()) {
  let listener: Parameters<BuilderTaskStreamPort['subscribeChanged']>[0] | null = null;
  const unsubscribe = vi.fn();
  const readMock = vi.fn(read);
  const subscribeChanged = vi.fn((next: Parameters<BuilderTaskStreamPort['subscribeChanged']>[0]) => {
    listener = next;
    return unsubscribe;
  });
  const controller = createBuilderConversationController({
    read: readMock,
    subscribeChanged,
  });
  return {
    controller,
    read: readMock,
    subscribeChanged,
    unsubscribe,
    emitChanged(projectId = PROJECT_ID) {
      if (listener === null) throw new Error('missing changed listener');
      listener(Object.freeze({
        event_version: 'builder-task-stream-changed.v1',
        project_id: projectId,
      }));
    },
    emitLiveChanged(projectId = PROJECT_ID, cursor = 1) {
      if (listener === null) throw new Error('missing changed listener');
      listener(Object.freeze({
        event_version: 'builder-task-stream-changed.v2',
        project_id: projectId,
        change_kind: 'live_only',
        cursor,
      }));
    },
    emitDurableChanged(projectId = PROJECT_ID, cursor = 1) {
      if (listener === null) throw new Error('missing changed listener');
      listener(Object.freeze({
        event_version: 'builder-task-stream-changed.v2',
        project_id: projectId,
        change_kind: 'durable_append',
        cursor,
      }));
    },
  };
}

async function flushController(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 176));
}

describe('Builder conversation controller', () => {
  it('loads a ready task stream without fabricating optimistic messages', async () => {
    let resolve!: (value: unknown) => void;
    const pending = new Promise<unknown>((next) => {
      resolve = next;
    });
    const { controller, read } = setup(async () => pending);

    const operation = controller.load(PROJECT_ID, TASK_ADDRESS_ID);
    expect(controller.getSnapshot()).toMatchObject({
      status: 'loading',
      project_id: PROJECT_ID,
      conversation: null,
      busy: true,
    });
    resolve(readyWire());
    const result = await operation;

    expect(read).toHaveBeenCalledExactlyOnceWith({ project_id: PROJECT_ID, task_address_id: TASK_ADDRESS_ID });
    expect(result.status).toBe('ready');
    expect(result.conversation?.state).toBe('ready');
    if (result.conversation?.state !== 'ready') throw new Error('expected ready stream');
    expect(result.conversation.conversation.items).toHaveLength(4);
    expect(isTrustedBuilderConversationControllerSnapshot(result)).toBe(true);
  });

  it('represents an absent conversation as a durable read result', async () => {
    const { controller } = setup(async () => absentWire());
    const result = await controller.load(PROJECT_ID, TASK_ADDRESS_ID);

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

    const first = controller.load(PROJECT_ID, TASK_ADDRESS_ID);
    const second = controller.load(PROJECT_ID, TASK_ADDRESS_ID);
    resolve(absentWire());

    expect(await first).toBe(await second);
    expect(read).toHaveBeenCalledExactlyOnceWith({ project_id: PROJECT_ID, task_address_id: TASK_ADDRESS_ID });
  });

  it('retains the previous stream during manual refresh and marks it stale on failure', async () => {
    const { controller, read } = setup(async () => readyWire());
    await controller.load(PROJECT_ID, TASK_ADDRESS_ID);
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

  it('retains visible activity when the same project is loaded again', async () => {
    let resolveReload!: (value: unknown) => void;
    const reload = new Promise<unknown>((resolve) => {
      resolveReload = resolve;
    });
    const { controller, read } = setup(async () => readyWire());
    const loaded = await controller.load(PROJECT_ID, TASK_ADDRESS_ID);
    read.mockImplementationOnce(async () => reload);

    const operation = controller.load(PROJECT_ID, TASK_ADDRESS_ID);
    expect(controller.getSnapshot()).toMatchObject({
      status: 'refreshing',
      project_id: PROJECT_ID,
      conversation: loaded.conversation,
    });

    resolveReload(readyWire());
    expect((await operation).status).toBe('ready');
  });

  it('probes activity without publishing visible loading or replacing the current project', async () => {
    const { controller, read } = setup(async () => readyWire());
    const loaded = await controller.load(PROJECT_ID, TASK_ADDRESS_ID);
    read.mockImplementationOnce(async () => absentWire(OTHER_PROJECT_ID));
    const listener = vi.fn();
    controller.subscribe(listener);

    const result = await controller.probe(OTHER_PROJECT_ID, OTHER_TASK_ADDRESS_ID);

    expect(result.status).toBe('absent');
    expect(result.project_id).toBe(OTHER_PROJECT_ID);
    expect(controller.getSnapshot()).toBe(loaded);
    expect(listener).not.toHaveBeenCalled();
  });

  it('refreshes changed activity in the background and publishes only the new ready snapshot', async () => {
    let resolveRefresh!: (value: unknown) => void;
    const firstWire = readyWire();
    const secondWire = readyWire();
    const refresh = new Promise<unknown>((resolve) => {
      resolveRefresh = resolve;
    });
    const { controller, emitChanged, read, subscribeChanged } = setupChanged(async () => firstWire);
    const loaded = await controller.load(PROJECT_ID, TASK_ADDRESS_ID);
    const listener = vi.fn();
    controller.subscribe(listener);
    read.mockImplementationOnce(async () => refresh);

    emitChanged(PROJECT_ID);
    await flushController();

    expect(subscribeChanged).toHaveBeenCalledOnce();
    expect(read).toHaveBeenCalledTimes(2);
    expect(controller.getSnapshot()).toBe(loaded);
    expect(listener).not.toHaveBeenCalled();

    resolveRefresh(secondWire);
    await flushController();

    expect(controller.getSnapshot().status).toBe('ready');
    expect(controller.getSnapshot().conversation?.state).toBe('ready');
    expect(listener).toHaveBeenCalledOnce();
  });

  it('does not publish when a cursor refresh resolves to the normalized unchanged snapshot', async () => {
    const { controller, emitDurableChanged, read } = setupChanged(async () => readyWire());
    const loaded = await controller.load(PROJECT_ID, TASK_ADDRESS_ID);
    const listener = vi.fn();
    controller.subscribe(listener);
    read.mockResolvedValueOnce(loaded.conversation);

    emitDurableChanged(PROJECT_ID, 12);
    await flushController();

    expect(read).toHaveBeenCalledTimes(2);
    expect(controller.getSnapshot()).toBe(loaded);
    expect(listener).not.toHaveBeenCalled();
  });

  it('does not reacquire the durable task stream for 100 live-only delta hints', async () => {
    const { controller, emitLiveChanged, read } = setupChanged(async () => readyWire());
    await controller.load(PROJECT_ID, TASK_ADDRESS_ID);
    read.mockClear();

    for (let cursor = 12; cursor < 112; cursor += 1) {
      emitLiveChanged(PROJECT_ID, cursor);
    }
    await flushController();

    expect(read).not.toHaveBeenCalled();
    expect(controller.getSnapshot().status).toBe('ready');
  });

  it('coalesces a synchronous burst of durable changed hints into one refresh', async () => {
    const { controller, emitChanged, read } = setupChanged(async () => readyWire());
    await controller.load(PROJECT_ID, TASK_ADDRESS_ID);
    read.mockClear();

    for (let index = 0; index < 100; index += 1) emitChanged(PROJECT_ID);
    await flushController();

    expect(read).toHaveBeenCalledOnce();
    expect(controller.getSnapshot().status).toBe('ready');
  });

  it('cancels a queued durable changed refresh when a foreground refresh starts', async () => {
    const { controller, emitDurableChanged, read } = setupChanged(async () => readyWire());
    await controller.load(PROJECT_ID, TASK_ADDRESS_ID);
    read.mockClear();

    emitDurableChanged(PROJECT_ID, 12);
    const refreshed = await controller.refresh();

    expect(refreshed.status).toBe('ready');
    expect(read).toHaveBeenCalledExactlyOnceWith({
      project_id: PROJECT_ID,
      task_address_id: TASK_ADDRESS_ID,
    });

    await flushController();
    expect(read).toHaveBeenCalledOnce();
  });

  it('drops duplicate or older typed durable cursors after the latest refresh', async () => {
    const { controller, emitDurableChanged, read } = setupChanged(async () => readyWire());
    await controller.load(PROJECT_ID, TASK_ADDRESS_ID);
    read.mockClear();

    emitDurableChanged(PROJECT_ID, 12);
    emitDurableChanged(PROJECT_ID, 12);
    emitDurableChanged(PROJECT_ID, 11);
    await flushController();
    expect(read).toHaveBeenCalledOnce();

    read.mockClear();
    emitDurableChanged(PROJECT_ID, 12);
    await flushController();
    expect(read).not.toHaveBeenCalled();

    emitDurableChanged(PROJECT_ID, 13);
    await flushController();
    expect(read).toHaveBeenCalledOnce();
  });

  it('ignores other-project changed hints and unsubscribes on dispose', async () => {
    const { controller, emitChanged, read, unsubscribe } = setupChanged(async () => readyWire());
    await controller.load(PROJECT_ID, TASK_ADDRESS_ID);
    read.mockClear();

    emitChanged(OTHER_PROJECT_ID);
    await flushController();
    expect(read).not.toHaveBeenCalled();

    controller.dispose();
    expect(unsubscribe).toHaveBeenCalledOnce();
    emitChanged(PROJECT_ID);
    await flushController();
    expect(read).not.toHaveBeenCalled();
  });

  it('queues a follow-up refresh when a changed hint arrives during an active read', async () => {
    let resolveFirstRefresh!: (value: unknown) => void;
    let resolveSecondRefresh!: (value: unknown) => void;
    const firstRefresh = new Promise<unknown>((resolve) => {
      resolveFirstRefresh = resolve;
    });
    const secondRefresh = new Promise<unknown>((resolve) => {
      resolveSecondRefresh = resolve;
    });
    const { controller, emitChanged, read } = setupChanged(async () => readyWire());
    await controller.load(PROJECT_ID, TASK_ADDRESS_ID);
    read.mockImplementationOnce(async () => firstRefresh);
    read.mockImplementationOnce(async () => secondRefresh);

    emitChanged(PROJECT_ID);
    await flushController();
    expect(read).toHaveBeenCalledTimes(2);

    emitChanged(PROJECT_ID);
    await flushController();
    expect(read).toHaveBeenCalledTimes(2);

    resolveFirstRefresh(readyWire());
    await flushController();
    expect(read).toHaveBeenCalledTimes(3);

    resolveSecondRefresh(readyWire());
    await flushController();
    expect(controller.getSnapshot().status).toBe('ready');
    expect(read).toHaveBeenCalledTimes(3);
  });

  it('ignores stale completions after a newer project selection starts', async () => {
    let resolveFirst!: (value: unknown) => void;
    const first = new Promise<unknown>((resolve) => {
      resolveFirst = resolve;
    });
    const { controller, read } = setup(async () => first);
    const firstLoad = controller.load(PROJECT_ID, TASK_ADDRESS_ID);
    read.mockImplementation(async () => readyWire(OTHER_PROJECT_ID, OTHER_UUID));

    const second = await controller.load(OTHER_PROJECT_ID, OTHER_TASK_ADDRESS_ID);
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

  it('loads and refreshes the projectless Agent conversation by Agent identity', async () => {
    let changedListener: Parameters<BuilderTaskStreamPort['subscribeChanged']>[0] = () => undefined;
    const wire = {
      stream_version: 'builder-task-stream-read-result.v1',
      scope_kind: 'agent_conversation',
      agent_id: AGENT_ID,
      project_id: null,
      conversation: null,
      authority: {
        conversation: 'sqlite_canonical_agent_conversation',
        project_source: 'not_included',
        candidate_source: 'not_loaded',
        project_revision: 'not_inferred',
      },
    };
    const read = vi.fn(async () => wire);
    const controller = createBuilderConversationController({
      read,
      subscribeChanged(listener) {
        changedListener = listener;
        return () => undefined;
      },
    });

    const loaded = await controller.load(null, null, AGENT_ID);
    expect(loaded).toMatchObject({
      status: 'absent',
      agent_id: AGENT_ID,
      project_id: null,
      task_address_id: null,
    });
    expect(read).toHaveBeenCalledExactlyOnceWith({ agent_id: AGENT_ID });

    changedListener({
      event_version: 'builder-task-stream-changed.v1',
      agent_id: AGENT_ID,
    });
    await flushController();
    expect(read).toHaveBeenCalledTimes(2);
  });
});
