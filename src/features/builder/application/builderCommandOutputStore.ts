import type {
  BuilderCommandApprovalRequest,
  BuilderCommandOutputEvent,
} from './builderPorts';
import { incrementBuilderPerformance, observeBuilderPerformance } from './builderPerformanceTrace';

const MAX_COMMAND_OUTPUT_BYTES = 128 * 1024;
const OUTPUT_ENCODER = new TextEncoder();
const OUTPUT_DECODER = new TextDecoder('utf-8');

export type BuilderCommandOutputState =
  | 'awaiting_approval'
  | 'running'
  | 'denied'
  | 'completed'
  | 'failed';

export type BuilderCommandOutputSnapshot = Readonly<{
  project_id: string;
  conversation_id: string;
  run_id: string;
  command_profile_id: string;
  command_display: string;
  description: string;
  state: BuilderCommandOutputState;
  stdout_text: string;
  stderr_text: string;
  chunk_count: number;
  output_truncated: boolean;
  result_summary: string | null;
}>;

export type BuilderCommandOutputFrameScheduler = Readonly<{
  request(callback: () => void): number;
  cancel(handle: number): void;
}>;

export type BuilderCommandOutputStore = Readonly<{
  getSnapshot(): BuilderCommandOutputSnapshot | null;
  subscribe(listener: () => void): () => void;
  start(request: BuilderCommandApprovalRequest): void;
  append(event: BuilderCommandOutputEvent): boolean;
  setState(
    state: BuilderCommandOutputState,
    resultSummary?: string | null,
    outputTruncated?: boolean,
  ): boolean;
  clear(): void;
  dispose(): void;
}>;

function defaultFrameScheduler(): BuilderCommandOutputFrameScheduler {
  return Object.freeze({
    request: (callback: () => void) => globalThis.setTimeout(callback, 16) as unknown as number,
    cancel: (handle: number) => globalThis.clearTimeout(handle),
  });
}

function retainTail(text: string, maximumBytes: number): Readonly<{
  text: string;
  truncated: boolean;
}> {
  const encoded = OUTPUT_ENCODER.encode(text);
  if (encoded.byteLength <= maximumBytes) return Object.freeze({ text, truncated: false });
  const retained = OUTPUT_DECODER.decode(encoded.slice(encoded.byteLength - maximumBytes));
  return Object.freeze({ text: retained.replace(/^\uFFFD/, ''), truncated: true });
}

export function createBuilderCommandOutputStore(
  scheduler: BuilderCommandOutputFrameScheduler = defaultFrameScheduler(),
): BuilderCommandOutputStore {
  let current: BuilderCommandOutputSnapshot | null = null;
  let pendingStdout = '';
  let pendingStderr = '';
  let pendingChunks = 0;
  let frameHandle: number | null = null;
  let disposed = false;
  const listeners = new Set<() => void>();

  function publish(): void {
    for (const listener of [...listeners]) {
      try { listener(); } catch { /* observers cannot interrupt command output */ }
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
    incrementBuilderPerformance('renderer.command_output.flush_count');
    const stdout = retainTail(`${current.stdout_text}${pendingStdout}`, MAX_COMMAND_OUTPUT_BYTES);
    const stderr = retainTail(`${current.stderr_text}${pendingStderr}`, MAX_COMMAND_OUTPUT_BYTES);
    current = Object.freeze({
      ...current,
      stdout_text: stdout.text,
      stderr_text: stderr.text,
      chunk_count: current.chunk_count + pendingChunks,
      output_truncated: current.output_truncated || stdout.truncated || stderr.truncated,
    });
    pendingStdout = '';
    pendingStderr = '';
    pendingChunks = 0;
    observeBuilderPerformance(
      'renderer.command_output.retained_bytes',
      OUTPUT_ENCODER.encode(`${current.stdout_text}${current.stderr_text}`).byteLength,
    );
    publish();
  }

  function matches(event: BuilderCommandOutputEvent): boolean {
    return current !== null
      && current.project_id === event.project_id
      && current.conversation_id === event.conversation_id
      && current.run_id === event.run_id
      && current.command_profile_id === event.command_profile_id;
  }

  return Object.freeze({
    getSnapshot: () => current,
    subscribe(listener) {
      if (disposed) return () => undefined;
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start(request) {
      if (disposed) return;
      cancelFrame();
      pendingStdout = '';
      pendingStderr = '';
      pendingChunks = 0;
      current = Object.freeze({
        project_id: request.project_id,
        conversation_id: request.conversation_id,
        run_id: request.run_id,
        command_profile_id: request.command_profile_id,
        command_display: request.command_display,
        description: request.description,
        state: 'awaiting_approval',
        stdout_text: '',
        stderr_text: '',
        chunk_count: 0,
        output_truncated: false,
        result_summary: null,
      });
      publish();
    },
    append(event) {
      incrementBuilderPerformance('renderer.command_output.received_count');
      if (disposed || !matches(event)) return false;
      for (const chunk of event.chunks) {
        observeBuilderPerformance(
          'renderer.command_output.received_bytes',
          OUTPUT_ENCODER.encode(chunk.text).byteLength,
        );
        if (chunk.stream === 'stdout') pendingStdout += chunk.text;
        else pendingStderr += chunk.text;
        pendingChunks += 1;
      }
      if (pendingChunks === 0 || frameHandle !== null) return pendingChunks > 0;
      frameHandle = scheduler.request(flush);
      return true;
    },
    setState(state, resultSummary = null, outputTruncated = false) {
      if (disposed || current === null) return false;
      cancelFrame();
      flush();
      current = Object.freeze({
        ...current,
        state,
        output_truncated: current.output_truncated || outputTruncated,
        result_summary: resultSummary,
      });
      publish();
      return true;
    },
    clear() {
      if (disposed) return;
      const hadValue = current !== null;
      cancelFrame();
      current = null;
      pendingStdout = '';
      pendingStderr = '';
      pendingChunks = 0;
      if (hadValue) publish();
    },
    dispose() {
      if (disposed) return;
      cancelFrame();
      disposed = true;
      current = null;
      pendingStdout = '';
      pendingStderr = '';
      pendingChunks = 0;
      listeners.clear();
    },
  });
}
