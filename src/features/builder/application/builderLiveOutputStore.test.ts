import { describe, expect, it, vi } from 'vitest';

import {
  createBuilderLiveOutputStore,
  type BuilderLiveOutputFrameScheduler,
} from './builderLiveOutputStore';
import type { BuilderGenerationOutputEvent } from './builderPorts';

const REQUEST_ID = 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174000';

function manualScheduler() {
  let nextHandle = 1;
  const callbacks = new Map<number, () => void>();
  const scheduler: BuilderLiveOutputFrameScheduler = Object.freeze({
    request(callback) {
      const handle = nextHandle;
      nextHandle += 1;
      callbacks.set(handle, callback);
      return handle;
    },
    cancel(handle) {
      callbacks.delete(handle);
    },
  });
  return {
    scheduler,
    pending: () => callbacks.size,
    flush() {
      const batch = [...callbacks.values()];
      callbacks.clear();
      for (const callback of batch) callback();
    },
  };
}

function output(delta: string, requestId = REQUEST_ID): BuilderGenerationOutputEvent {
  return Object.freeze({
    event_version: 'builder-generation-output.v1',
    request_id: requestId,
    project_id: PROJECT_ID,
    conversation_id: 'builder-conversation:123e4567-e89b-42d3-a456-426614174000',
    turn_id: 'builder-turn:123e4567-e89b-42d3-a456-426614174001',
    task_id: 'builder-task:123e4567-e89b-42d3-a456-426614174001',
    run_id: 'builder-run:123e4567-e89b-42d3-a456-426614174001',
    display_delta_text: delta,
  });
}

function reset(retainTextBytes: number): BuilderGenerationOutputEvent {
  return Object.freeze({
    event_version: 'builder-generation-output-reset.v1',
    request_id: REQUEST_ID,
    project_id: PROJECT_ID,
    conversation_id: 'builder-conversation:123e4567-e89b-42d3-a456-426614174000',
    turn_id: 'builder-turn:123e4567-e89b-42d3-a456-426614174001',
    task_id: 'builder-task:123e4567-e89b-42d3-a456-426614174001',
    run_id: 'builder-run:123e4567-e89b-42d3-a456-426614174001',
    retain_text_bytes: retainTextBytes,
  });
}

function activity(
  text: string,
  activityKind: Extract<BuilderGenerationOutputEvent, {
    event_version: 'builder-generation-activity.v2';
  }>['activity_kind'] = 'reasoning',
): BuilderGenerationOutputEvent {
  return Object.freeze({
    event_version: 'builder-generation-activity.v2',
    request_id: REQUEST_ID,
    project_id: PROJECT_ID,
    conversation_id: 'builder-conversation:123e4567-e89b-42d3-a456-426614174000',
    turn_id: 'builder-turn:123e4567-e89b-42d3-a456-426614174001',
    task_id: 'builder-task:123e4567-e89b-42d3-a456-426614174001',
    run_id: 'builder-run:123e4567-e89b-42d3-a456-426614174001',
    activity_kind: activityKind,
    activity_text: text,
  });
}

it('replaces bounded activity status without appending it to assistant text', () => {
  const scheduler = manualScheduler();
  const store = createBuilderLiveOutputStore(scheduler.scheduler);
  store.start(Object.freeze({
    state: 'streaming',
    request_id: REQUEST_ID,
    project_id: PROJECT_ID,
    text: '',
    chunk_count: 0,
  }));

  expect(store.append(activity('正在思考'))).toBe(true);
  expect(store.getSnapshot()).toMatchObject({ text: '', waiting_text: '正在思考' });
  store.append(output('已完成分析。'));
  scheduler.flush();
  store.append(activity('正在验证结果'));

  expect(store.getSnapshot()).toMatchObject({
    text: '已完成分析。',
    activity_kind: 'reasoning',
    waiting_text: '正在验证结果',
  });
});

it('retains semantic context compaction activity for the chat animation', () => {
  const store = createBuilderLiveOutputStore(manualScheduler().scheduler);
  store.start(Object.freeze({
    state: 'streaming',
    request_id: REQUEST_ID,
    project_id: PROJECT_ID,
    text: '',
    chunk_count: 0,
  }));

  expect(store.append(activity('上下文较长，正在整理', 'context_compacting'))).toBe(true);
  expect(store.getSnapshot()).toMatchObject({
    activity_kind: 'context_compacting',
    waiting_text: '上下文较长，正在整理',
  });
  expect(store.append(activity('上下文整理完成，继续处理', 'context_compacted'))).toBe(true);
  expect(store.getSnapshot()).toMatchObject({
    activity_kind: 'context_compacted',
    waiting_text: '上下文整理完成，继续处理',
  });
});

describe('builder live output store', () => {
  it('coalesces many provider deltas into one visual frame', () => {
    const frames = manualScheduler();
    const store = createBuilderLiveOutputStore(frames.scheduler);
    const listener = vi.fn();
    store.subscribe(listener);
    store.start(Object.freeze({
      state: 'streaming',
      request_id: REQUEST_ID,
      project_id: PROJECT_ID,
      text: '',
      chunk_count: 0,
    }));
    listener.mockClear();

    for (let index = 0; index < 100; index += 1) {
      expect(store.append(output(String(index % 10)))).toBe(true);
    }

    expect(frames.pending()).toBe(1);
    expect(listener).not.toHaveBeenCalled();
    expect(store.getSnapshot()?.text).toBe('');
    frames.flush();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()?.text).toHaveLength(100);
    expect(store.getSnapshot()?.chunk_count).toBe(100);
  });

  it('ignores cross-request output and cancels pending work when cleared', () => {
    const frames = manualScheduler();
    const store = createBuilderLiveOutputStore(frames.scheduler);
    store.start(Object.freeze({
      state: 'streaming',
      request_id: REQUEST_ID,
      project_id: PROJECT_ID,
      text: '',
      chunk_count: 0,
    }));

    expect(store.append(output('private', 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')))
      .toBe(false);
    expect(store.append(output('visible'))).toBe(true);
    expect(frames.pending()).toBe(1);
    store.clear();
    expect(frames.pending()).toBe(0);
    frames.flush();
    expect(store.getSnapshot()).toBeNull();
  });

  it('can start again after cleanup clears the current request', () => {
    const frames = manualScheduler();
    const store = createBuilderLiveOutputStore(frames.scheduler);
    store.start(Object.freeze({
      state: 'streaming',
      request_id: REQUEST_ID,
      project_id: PROJECT_ID,
      text: '',
      chunk_count: 0,
    }));
    expect(store.append(output('discarded'))).toBe(true);

    store.clear();
    store.start(Object.freeze({
      state: 'streaming',
      request_id: REQUEST_ID,
      project_id: PROJECT_ID,
      text: 'second:',
      chunk_count: 1,
    }));
    expect(store.append(output('visible'))).toBe(true);
    frames.flush();

    expect(store.getSnapshot()?.text).toBe('second:visible');
    expect(store.getSnapshot()?.chunk_count).toBe(2);
  });

  it('removes only the failed attempt tail when the runtime retries', () => {
    const frames = manualScheduler();
    const store = createBuilderLiveOutputStore(frames.scheduler);
    store.start(Object.freeze({
      state: 'streaming',
      request_id: REQUEST_ID,
      project_id: PROJECT_ID,
      text: '',
      chunk_count: 0,
    }));
    expect(store.append(output('Earlier explanation.'))).toBe(true);
    frames.flush();
    expect(store.append(output(' Failed partial.'))).toBe(true);
    expect(store.append(reset(new TextEncoder().encode('Earlier explanation.').byteLength))).toBe(true);
    expect(store.getSnapshot()?.text).toBe('Earlier explanation.');
    expect(frames.pending()).toBe(0);
    expect(store.append(output(' Recovered response.'))).toBe(true);
    frames.flush();
    expect(store.getSnapshot()?.text).toBe('Earlier explanation. Recovered response.');
  });
});
