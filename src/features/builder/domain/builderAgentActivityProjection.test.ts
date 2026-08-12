import { describe, expect, it } from 'vitest';

import { sanitizeBuilderAgentActivityProjectionWire } from './builderAgentActivityProjection';

const UUID = '11111111-1111-4111-8111-111111111111';

function projection() {
  return {
    projection_version: 'builder-agent-activity-projection.v1',
    project_id: `builder-project:${UUID}`,
    conversation_id: `builder-conversation:${UUID}`,
    head_sequence: 4,
    current: {
      phase: 'editing',
      status: 'active',
      label: 'Changing files',
      summary: 'Applying the approved changes to the project.',
      turn_id: 'builder-turn:22222222-2222-4222-8222-222222222222',
      run_id: 'builder-run:33333333-3333-4333-8333-333333333333',
    },
    authority: {
      projection_authority: 'main_owned_agent_activity_projection_v1',
      fact_source: 'recorded_activity',
      consumer_role: 'read_only',
      side_effect_authority: 'none',
    },
  };
}

describe('sanitizeBuilderAgentActivityProjectionWire', () => {
  it('accepts an exact read-only activity projection', () => {
    const value = projection();
    expect(sanitizeBuilderAgentActivityProjectionWire(value)).toBe(value);
  });

  it('accepts the fixed public running-checks phase', () => {
    const value = {
      ...projection(),
      current: {
        ...projection().current,
        phase: 'running_checks',
        label: 'Running checks',
        summary: 'Checking the current draft before it is saved.',
      },
      authority: {
        ...projection().authority,
        fact_source: 'recorded_activity_and_review',
      },
    };
    expect(sanitizeBuilderAgentActivityProjectionWire(value)).toBe(value);
  });

  it('accepts the fixed public waiting-for-check phase', () => {
    const value = {
      ...projection(),
      current: {
        ...projection().current,
        phase: 'waiting_for_check',
        status: 'waiting',
        label: 'Ready for review',
        summary: 'Builder has not finished checking this draft yet.',
      },
      authority: {
        ...projection().authority,
        fact_source: 'recorded_activity_and_review',
      },
    };
    expect(sanitizeBuilderAgentActivityProjectionWire(value)).toBe(value);
  });

  it('rejects mismatched copy and side-effect authority', () => {
    expect(sanitizeBuilderAgentActivityProjectionWire({
      ...projection(),
      current: { ...projection().current, label: 'Writing files' },
    })).toBeNull();
    expect(sanitizeBuilderAgentActivityProjectionWire({
      ...projection(),
      authority: { ...projection().authority, side_effect_authority: 'write' },
    })).toBeNull();
  });
});
