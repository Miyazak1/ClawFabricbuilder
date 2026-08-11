import { describe, expect, it } from 'vitest';

import { sanitizeBuilderCheckRunOutcomeProjectionWire } from './builderCheckRunOutcomeProjection';

function unavailable() {
  return {
    projection_version: 'builder-check-run-outcome-projection.v1',
    state: 'unavailable',
    command_kind: null,
    command_label: null,
    status: 'unavailable',
    label: 'Check status unavailable',
    summary: 'Builder could not verify the check status for this draft.',
    completed_at_ms: null,
    authority: {
      projection_authority: 'main_owned_check_run_outcome_projection_v1',
      fact_source: 'status_unavailable',
      raw_output: 'not_present',
      runtime_paths: 'not_present',
      renderer_authority: 'read_only_projection',
      save_authority: false,
    },
  };
}

describe('sanitizeBuilderCheckRunOutcomeProjectionWire', () => {
  it('accepts the exact unavailable projection', () => {
    const value = unavailable();
    expect(sanitizeBuilderCheckRunOutcomeProjectionWire(value)).toBe(value);
  });

  it('accepts fixed completed check copy without private identity', () => {
    const value = {
      ...unavailable(),
      state: 'completed',
      command_kind: 'test',
      command_label: 'Tests',
      status: 'failed',
      label: 'Check failed',
      summary: 'The project check found a problem that needs review.',
      completed_at_ms: 100,
      authority: {
        ...unavailable().authority,
        fact_source: 'verified_current_candidate_check_run',
      },
    };
    expect(sanitizeBuilderCheckRunOutcomeProjectionWire(value)).toBe(value);
  });

  it('rejects forged copy and capability drift', () => {
    expect(sanitizeBuilderCheckRunOutcomeProjectionWire({
      ...unavailable(),
      summary: 'Probably fine.',
    })).toBeNull();
    expect(sanitizeBuilderCheckRunOutcomeProjectionWire({
      ...unavailable(),
      authority: { ...unavailable().authority, save_authority: true },
    })).toBeNull();
  });
});
