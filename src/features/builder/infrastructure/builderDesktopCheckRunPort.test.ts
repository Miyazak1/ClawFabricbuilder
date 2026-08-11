import { describe, expect, it, vi } from 'vitest';

import {
  BuilderDesktopCheckRunPortError,
  createBuilderDesktopCheckRunPort,
} from './builderDesktopCheckRunPort';

const DRAFT_ID = `builder-generation-draft:${'a'.repeat(64)}`;
const PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174000';
const CANDIDATE_ID = `builder-code-change-candidate:${'b'.repeat(64)}`;
const PROFILE_ID = `builder-command-profile:${'c'.repeat(32)}`;

function authority() {
  return {
    projection_authority: 'main_owned_check_run_status_projection_v1',
    check_run_authority: 'verified_check_run_contract',
    renderer_authority: 'read_only_projection',
    ipc_authority: 'projection_only',
    raw_output: 'not_present',
    runtime_paths: 'not_present',
    provider_dispatch: false,
    command_execution: false,
    source_write: 'not_present',
    git_write: false,
    sqlite_write: false,
    save_authority: false,
  };
}

function available() {
  return {
    result_version: 'builder-check-run-current-draft-read-result.v1',
    service_version: 'builder-check-run-current-draft-service.v1',
    operation: 'current_draft_available_checks_read',
    status: 'ready',
    draft_id: DRAFT_ID,
    project_id: PROJECT_ID,
    candidate_id: CANDIDATE_ID,
    available_checks: [{
      command_profile_id: PROFILE_ID,
      command_kind: 'test',
      command_display: 'npm test',
      requires_user_approval: true,
    }],
  };
}

function completed() {
  return {
    result_version: 'builder-check-run-current-draft-run-result.v1',
    service_version: 'builder-check-run-current-draft-service.v1',
    operation: 'current_draft_approved_check_completed',
    draft_id: DRAFT_ID,
    project_id: PROJECT_ID,
    candidate_id: CANDIDATE_ID,
    check_run_status_projection: {
      projection_version: 'builder-check-run-status-projection.v1',
      project_id: PROJECT_ID,
      candidate_id: CANDIDATE_ID,
      check_run_id: `builder-check-run:${'d'.repeat(64)}`,
      command_kind: 'test',
      command_label: 'Tests',
      status: 'passed',
      label: 'Checked',
      summary: 'The project check completed successfully.',
      completed_at_ms: 20,
      result_digest: `sha256:${'e'.repeat(64)}`,
      authority: authority(),
    },
  };
}

function bridge(overrides = {}) {
  return {
    readCurrentDraftAvailableChecks: vi.fn(async () => available()),
    approveAndRunCurrentDraftCheck: vi.fn(async () => completed()),
    skipCurrentDraftCheck: vi.fn(async () => ({
      result_version: 'builder-check-skip-current-draft-public-result.v1',
      operation: 'current_draft_check_skipped',
      draft_id: DRAFT_ID,
      project_id: PROJECT_ID,
      candidate_id: CANDIDATE_ID,
      status: 'skipped',
    })),
    ...overrides,
  };
}

describe('createBuilderDesktopCheckRunPort', () => {
  it('forwards only draft and displayed profile identity then projects safe results', async () => {
    const source = bridge();
    const port = createBuilderDesktopCheckRunPort(source);
    const read = await port.readCurrentDraftAvailableChecks({ draft_id: DRAFT_ID });
    const run = await port.approveAndRunCurrentDraftCheck({
      draft_id: DRAFT_ID,
      command_profile_id: PROFILE_ID,
    });
    const skipped = await port.skipCurrentDraftCheck({ draft_id: DRAFT_ID });
    expect(source.readCurrentDraftAvailableChecks).toHaveBeenCalledExactlyOnceWith({ draft_id: DRAFT_ID });
    expect(source.approveAndRunCurrentDraftCheck).toHaveBeenCalledExactlyOnceWith({
      draft_id: DRAFT_ID,
      command_profile_id: PROFILE_ID,
    });
    expect(source.skipCurrentDraftCheck).toHaveBeenCalledExactlyOnceWith({ draft_id: DRAFT_ID });
    expect(read.available_checks[0]?.command_display).toBe('npm test');
    expect(run.check_run_status_projection.status).toBe('passed');
    expect(run.check_run_status_projection).not.toHaveProperty('authority');
    expect(skipped.status).toBe('skipped');
    expect(Object.isFrozen(read)).toBe(true);
    expect(Object.isFrozen(run)).toBe(true);
    expect(Object.isFrozen(skipped)).toBe(true);
  });

  it('rejects malformed requests before bridge invocation', async () => {
    const source = bridge();
    const port = createBuilderDesktopCheckRunPort(source);
    await expect(port.readCurrentDraftAvailableChecks({
      draft_id: 'bad',
      source_tree: {},
    } as never)).rejects.toBeInstanceOf(BuilderDesktopCheckRunPortError);
    await expect(port.approveAndRunCurrentDraftCheck({
      draft_id: DRAFT_ID,
      command_profile_id: PROFILE_ID,
      command: 'npm test',
    } as never)).rejects.toBeInstanceOf(BuilderDesktopCheckRunPortError);
    expect(source.readCurrentDraftAvailableChecks).not.toHaveBeenCalled();
    expect(source.approveAndRunCurrentDraftCheck).not.toHaveBeenCalled();
  });

  it('rejects script, raw output, runtime path, and identity drift in results', async () => {
    for (const leaked of [
      { ...available(), source_tree: {} },
      { ...available(), available_checks: [{ ...available().available_checks[0], script_body: 'secret' }] },
      { ...completed(), raw_output: 'private' },
      {
        ...completed(),
        check_run_status_projection: {
          ...completed().check_run_status_projection,
          candidate_id: `builder-code-change-candidate:${'f'.repeat(64)}`,
        },
      },
    ]) {
      const port = createBuilderDesktopCheckRunPort(bridge({
        readCurrentDraftAvailableChecks: async () => leaked,
        approveAndRunCurrentDraftCheck: async () => leaked,
      }));
      await expect(port.readCurrentDraftAvailableChecks({ draft_id: DRAFT_ID }))
        .rejects.toBeInstanceOf(BuilderDesktopCheckRunPortError);
      await expect(port.approveAndRunCurrentDraftCheck({
        draft_id: DRAFT_ID,
        command_profile_id: PROFILE_ID,
      })).rejects.toBeInstanceOf(BuilderDesktopCheckRunPortError);
    }
  });

  it('rejects malformed bridges and hostile accessors without invoking them', async () => {
    expect(() => createBuilderDesktopCheckRunPort({})).toThrow(BuilderDesktopCheckRunPortError);
    let getterCalls = 0;
    const port = createBuilderDesktopCheckRunPort(bridge({
      readCurrentDraftAvailableChecks: async () => Object.defineProperty({}, 'result_version', {
        enumerable: true,
        get() { getterCalls += 1; return 'never'; },
      }),
    }));
    await expect(port.readCurrentDraftAvailableChecks({ draft_id: DRAFT_ID }))
      .rejects.toBeInstanceOf(BuilderDesktopCheckRunPortError);
    expect(getterCalls).toBe(0);
  });
});
