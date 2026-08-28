import type { BuilderGenerationOutputEvent } from './builderPorts';
import { incrementBuilderPerformance } from './builderPerformanceTrace';

const MAX_LIVE_OUTPUT_TEXT_BYTES = 16 * 1024;
const LIVE_OUTPUT_ENCODER = new TextEncoder();
const LIVE_OUTPUT_DECODER = new TextDecoder('utf-8', { fatal: true });

export type BuilderLiveOutputSnapshot = Readonly<{
  state: 'streaming';
  request_id: string;
  project_id: string | null;
  text: string;
  chunk_count: number;
  waiting_text?: string;
}>;

export type BuilderLiveOutputFrameScheduler = Readonly<{
  request(callback: () => void): number;
  cancel(handle: number): void;
}>;

export type BuilderLiveOutputStore = Readonly<{
  getSnapshot(): BuilderLiveOutputSnapshot | null;
  subscribe(listener: () => void): () => void;
  start(snapshot: BuilderLiveOutputSnapshot): void;
  append(event: BuilderGenerationOutputEvent): boolean;
  clear(): void;
  dispose(): void;
}>;

function defaultFrameScheduler(): BuilderLiveOutputFrameScheduler {
  if (
    typeof globalThis.requestAnimationFrame === 'function'
    && typeof globalThis.cancelAnimationFrame === 'function'
  ) {
    return Object.freeze({
      request: (callback: () => void) => globalThis.requestAnimationFrame(callback),
      cancel: (handle: number) => globalThis.cancelAnimationFrame(handle),
    });
  }
  return Object.freeze({
    request: (callback: () => void) => globalThis.setTimeout(callback, 16) as unknown as number,
    cancel: (handle: number) => globalThis.clearTimeout(handle),
  });
}

export function createBuilderLiveOutputStore(
  scheduler: BuilderLiveOutputFrameScheduler = defaultFrameScheduler(),
): BuilderLiveOutputStore {
  let current: BuilderLiveOutputSnapshot | null = null;
  let currentBytes = 0;
  let pendingText = '';
  let pendingChunks = 0;
  let frameHandle: number | null = null;
  let disposed = false;
  const listeners = new Set<() => void>();

  function publish(): void {
    for (const listener of [...listeners]) {
      try { listener(); } catch { /* observers cannot interrupt live output */ }
    }
  }

  function cancelFrame(): void {
    if (frameHandle === null) return;
    try { scheduler.cancel(frameHandle); } catch { /* cancellation is best-effort */ }
    frameHandle = null;
  }

  function flush(): void {
    frameHandle = null;
    if (disposed || current === null || pendingChunks === 0) return;
    incrementBuilderPerformance('renderer.live_output.flush_count');
    current = Object.freeze({
      ...current,
      text: `${current.text}${pendingText}`,
      chunk_count: current.chunk_count + pendingChunks,
    });
    pendingText = '';
    pendingChunks = 0;
    publish();
  }

  function scheduleFlush(): void {
    if (frameHandle !== null) return;
    frameHandle = scheduler.request(flush);
  }

  return Object.freeze({
    getSnapshot: () => current,
    subscribe(listener) {
      if (disposed) return () => undefined;
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start(snapshot) {
      if (disposed) return;
      cancelFrame();
      pendingText = '';
      pendingChunks = 0;
      current = Object.freeze({ ...snapshot });
      currentBytes = LIVE_OUTPUT_ENCODER.encode(snapshot.text).byteLength;
      publish();
    },
    append(event) {
      incrementBuilderPerformance('renderer.live_output.received_count');
      if (
        disposed
        || current === null
        || current.request_id !== event.request_id
        || current.project_id !== event.project_id
      ) {
        incrementBuilderPerformance('renderer.live_output.dropped_count');
        return false;
      }
      if (event.event_version === 'builder-generation-output-reset.v1') {
        cancelFrame();
        const bufferedText = `${current.text}${pendingText}`;
        const bufferedBytes = LIVE_OUTPUT_ENCODER.encode(bufferedText);
        const retainedBytes = Math.min(event.retain_text_bytes, bufferedBytes.byteLength);
        let retainedText: string;
        try {
          retainedText = LIVE_OUTPUT_DECODER.decode(bufferedBytes.slice(0, retainedBytes));
        } catch {
          incrementBuilderPerformance('renderer.live_output.dropped_count');
          return false;
        }
        current = Object.freeze({
          ...current,
          text: retainedText,
          chunk_count: current.chunk_count + pendingChunks,
        });
        currentBytes = retainedBytes;
        pendingText = '';
        pendingChunks = 0;
        publish();
        return true;
      }
      if (event.event_version === 'builder-generation-activity.v1') {
        cancelFrame();
        flush();
        current = Object.freeze({
          ...current,
          waiting_text: event.activity_text,
        });
        publish();
        return true;
      }
      if (event.display_delta_text.length === 0) {
        incrementBuilderPerformance('renderer.live_output.dropped_count');
        return false;
      }
      const deltaBytes = LIVE_OUTPUT_ENCODER.encode(event.display_delta_text).byteLength;
      if (currentBytes + deltaBytes > MAX_LIVE_OUTPUT_TEXT_BYTES) {
        incrementBuilderPerformance('renderer.live_output.dropped_count');
        return false;
      }
      currentBytes += deltaBytes;
      pendingText += event.display_delta_text;
      pendingChunks += 1;
      scheduleFlush();
      return true;
    },
    clear() {
      if (disposed) return;
      const hadOutput = current !== null;
      cancelFrame();
      current = null;
      currentBytes = 0;
      pendingText = '';
      pendingChunks = 0;
      if (hadOutput) publish();
    },
    dispose() {
      if (disposed) return;
      cancelFrame();
      disposed = true;
      current = null;
      currentBytes = 0;
      pendingText = '';
      pendingChunks = 0;
      listeners.clear();
    },
  });
}
