import { describe, expect, it, vi } from 'vitest';

import {
  createBuilderCommandOutputStore,
  type BuilderCommandOutputFrameScheduler,
} from './builderCommandOutputStore';
import type { BuilderCommandApprovalRequest, BuilderCommandOutputEvent } from './builderPorts';

const request = Object.freeze({
  request_version: 'builder-controlled-command-approval-request.v1',
  approval_request_id: 'builder-command-approval:123e4567-e89b-42d3-a456-426614174000',
  project_id: 'builder-project:123e4567-e89b-42d3-a456-426614174000',
  conversation_id: 'builder-conversation:123e4567-e89b-42d3-a456-426614174000',
  turn_id: 'builder-turn:123e4567-e89b-42d3-a456-426614174000',
  task_id: 'builder-task:123e4567-e89b-42d3-a456-426614174000',
  run_id: 'builder-run:123e4567-e89b-42d3-a456-426614174000',
  command_profile_id: 'builder-command-profile:test',
  command_kind: 'test',
  command_display: 'npm test',
  description: 'Run project tests.',
  source_tree_digest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  requested_at_ms: 1,
  expires_at_ms: 2,
  risk_notice: 'This project script may modify files or use the network.',
  decisions: ['allow_once', 'deny'],
} as const satisfies BuilderCommandApprovalRequest);

function output(
  chunks: BuilderCommandOutputEvent['chunks'],
  runId: string = request.run_id,
): BuilderCommandOutputEvent {
  return Object.freeze({
    event_version: 'builder-controlled-command-output.v1',
    project_id: request.project_id,
    conversation_id: request.conversation_id,
    turn_id: request.turn_id,
    task_id: request.task_id,
    run_id: runId,
    command_profile_id: request.command_profile_id,
    chunks,
  });
}

function manualScheduler() {
  let callback: (() => void) | null = null;
  const scheduler: BuilderCommandOutputFrameScheduler = Object.freeze({
    request(next) { callback = next; return 1; },
    cancel() { callback = null; },
  });
  return {
    scheduler,
    flush() { const next = callback; callback = null; next?.(); },
  };
}

describe('builder command output store', () => {
  it('starts at approval and coalesces stdout and stderr into one visual frame', () => {
    const frame = manualScheduler();
    const store = createBuilderCommandOutputStore(frame.scheduler);
    const listener = vi.fn();
    store.subscribe(listener);
    store.start(request);
    listener.mockClear();

    expect(store.append(output([
      { stream: 'stdout', text: 'one\n' },
      { stream: 'stderr', text: 'warning\n' },
    ]))).toBe(true);
    expect(listener).not.toHaveBeenCalled();
    frame.flush();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()).toMatchObject({
      state: 'awaiting_approval',
      stdout_text: 'one\n',
      stderr_text: 'warning\n',
      chunk_count: 2,
    });
  });

  it('rejects output from another run and records a terminal result state', () => {
    const frame = manualScheduler();
    const store = createBuilderCommandOutputStore(frame.scheduler);
    store.start(request);

    expect(store.append(output([], 'builder-run:123e4567-e89b-42d3-a456-426614174099'))).toBe(false);
    expect(store.setState('completed', 'Tests passed.', true)).toBe(true);
    expect(store.getSnapshot()).toMatchObject({
      state: 'completed',
      output_truncated: true,
      result_summary: 'Tests passed.',
    });
  });
});
