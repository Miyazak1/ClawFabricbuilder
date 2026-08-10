import { describe, expect, it, vi } from 'vitest';

import { sanitizeBuilderReviewStateProjectionWire } from './builderReviewStateProjection';

const DRAFT_ID = `builder-generation-draft:${'a'.repeat(64)}`;

function readyProjection(): Readonly<Record<string, unknown>> {
  return Object.freeze({
    projection_version: 'builder-review-state-projection.v1',
    draft_id: DRAFT_ID,
    status: 'ready',
    label: 'Ready to review',
    summary: 'A recoverable draft is ready to inspect and save.',
    checkpoint_status: 'ready',
    preview_status: 'not_recorded',
    check_status: 'not_run',
    changed_file_count: 2,
    can_save: true,
    can_discard: true,
    blocking_reasons: Object.freeze([]),
    authority: Object.freeze({
      projection_authority: 'main_owned_review_state_projection_v1',
      candidate_evidence: 'sqlite_conversation_replay_current_unreviewed_candidate',
      checkpoint_evidence: 'verified_latest_candidate_checkpoint',
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
    }),
  });
}

describe('sanitizeBuilderReviewStateProjectionWire', () => {
  it('accepts the exact main-owned ready projection', () => {
    expect(sanitizeBuilderReviewStateProjectionWire(readyProjection())).toEqual(readyProjection());
  });

  it('fails closed for capability drift and extra fields', () => {
    expect(sanitizeBuilderReviewStateProjectionWire({
      ...readyProjection(),
      can_save: false,
    })).toBeNull();
    expect(sanitizeBuilderReviewStateProjectionWire({
      ...readyProjection(),
      save_authority: true,
    })).toBeNull();
  });

  it('does not invoke getters while checking untrusted values', () => {
    const getter = vi.fn(() => 'ready');
    const value = {};
    Object.defineProperty(value, 'status', {
      enumerable: true,
      get: getter,
    });

    expect(sanitizeBuilderReviewStateProjectionWire(value)).toBeNull();
    expect(getter).not.toHaveBeenCalled();
  });
});
