import { describe, expect, it, vi } from 'vitest';

import {
  composerStatusFromContextProjection,
  type BuilderComposerContextStatus,
} from './builderContextStatusProjection';

const AUTHORITY = Object.freeze({
  git_mutation: false,
  ipc_authority: 'not_present',
  pending_handoff_packets: 'none',
  permission_grant: false,
  projection_authority: 'main_owned_context_status_projection_v1',
  provider_dispatch: false,
  renderer_authority: 'not_present',
  revision_admission: 'not_created',
  secret_access: 'not_present',
  source_read: 'not_present',
  source_write: 'not_present',
  tool_dispatch: false,
  working_context_state: 'verified_not_exposed',
});

type ProjectionInput = Readonly<{
  can_contextual_execute: boolean;
  has_pending_handoff: boolean;
  label: string;
  needs_confirmation: boolean;
  next_action_hint: string;
  pending_handoff_count: number;
  tone: string;
}>;

function projection(input: ProjectionInput): Readonly<Record<string, unknown>> {
  return Object.freeze({
    projection_version: 'builder-context-status-projection.v1',
    ...input,
    authority: Object.freeze({
      ...AUTHORITY,
      pending_handoff_packets: input.has_pending_handoff ? 'pending_count_only' : 'none',
    }),
  });
}

describe('composerStatusFromContextProjection', () => {
  it('maps main-owned context status projections into safe composer chip states', () => {
    const cases: ReadonlyArray<readonly [ProjectionInput, BuilderComposerContextStatus]> = Object.freeze([
      [
        {
          can_contextual_execute: false,
          has_pending_handoff: false,
          label: 'No direction yet',
          needs_confirmation: false,
          next_action_hint: 'Describe what you want to make or change.',
          pending_handoff_count: 0,
          tone: 'neutral',
        },
        null,
      ],
      [
        {
          can_contextual_execute: false,
          has_pending_handoff: false,
          label: 'Direction updated',
          needs_confirmation: false,
          next_action_hint: 'Ask me to make the change when the direction is ready.',
          pending_handoff_count: 0,
          tone: 'info',
        },
        null,
      ],
      [
        {
          can_contextual_execute: true,
          has_pending_handoff: false,
          label: 'Ready to execute current direction',
          needs_confirmation: false,
          next_action_hint: 'You can ask me to make the change.',
          pending_handoff_count: 0,
          tone: 'success',
        },
        'ready_to_execute',
      ],
      [
        {
          can_contextual_execute: false,
          has_pending_handoff: false,
          label: 'Direction changed',
          needs_confirmation: true,
          next_action_hint: 'Confirm the new direction before I change files.',
          pending_handoff_count: 0,
          tone: 'warning',
        },
        'direction_changed',
      ],
      [
        {
          can_contextual_execute: true,
          has_pending_handoff: false,
          label: 'Using approved plan',
          needs_confirmation: false,
          next_action_hint: 'You can ask me to apply the approved plan.',
          pending_handoff_count: 0,
          tone: 'success',
        },
        'using_approved_plan',
      ],
      [
        {
          can_contextual_execute: false,
          has_pending_handoff: false,
          label: 'Needs confirmation',
          needs_confirmation: true,
          next_action_hint: 'Answer the open question before I change files.',
          pending_handoff_count: 0,
          tone: 'warning',
        },
        'needs_confirmation',
      ],
      [
        {
          can_contextual_execute: false,
          has_pending_handoff: true,
          label: 'Handoff received',
          needs_confirmation: true,
          next_action_hint: 'Review the handoff before the next change.',
          pending_handoff_count: 2,
          tone: 'warning',
        },
        'handoff_received',
      ],
    ]);

    for (const [input, expected] of cases) {
      expect(composerStatusFromContextProjection(projection(input))).toBe(expected);
    }
  });

  it('fails closed for malformed, drifting, or authority-bearing values', () => {
    const valid = projection({
      can_contextual_execute: true,
      has_pending_handoff: false,
      label: 'Ready to execute current direction',
      needs_confirmation: false,
      next_action_hint: 'You can ask me to make the change.',
      pending_handoff_count: 0,
      tone: 'success',
    });

    expect(composerStatusFromContextProjection(null)).toBeNull();
    expect(composerStatusFromContextProjection({ ...valid, extra: true })).toBeNull();
    expect(composerStatusFromContextProjection({ ...valid, label: 'Ready sha256:aaaaaaaa' })).toBeNull();
    expect(composerStatusFromContextProjection({ ...valid, can_contextual_execute: false })).toBeNull();
    expect(composerStatusFromContextProjection({
      ...valid,
      authority: { ...AUTHORITY, renderer_authority: 'trusted' },
    })).toBeNull();
    expect(composerStatusFromContextProjection({
      ...valid,
      authority: { ...AUTHORITY, source_read: 'allowed' },
    })).toBeNull();
  });

  it('does not invoke getters while checking untrusted renderer values', () => {
    const getter = vi.fn(() => 'Ready to execute current direction');
    const value = {};
    Object.defineProperty(value, 'label', {
      enumerable: true,
      get: getter,
    });

    expect(composerStatusFromContextProjection(value)).toBeNull();
    expect(getter).not.toHaveBeenCalled();
  });
});
