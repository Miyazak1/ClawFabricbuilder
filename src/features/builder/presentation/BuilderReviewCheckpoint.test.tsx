// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BuilderCheckRunProfile, BuilderCheckRunStatusProjection } from '../application/builderPorts';
import type { BuilderCheckRunOutcomeProjectionWire } from '../domain/builderCheckRunOutcomeProjection';
import type { BuilderReviewStateProjectionWire } from '../domain/builderReviewStateProjection';
import {
  BuilderDraftCheckStatus,
  BuilderDraftWorkspaceActions,
} from './BuilderReviewCheckpoint';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mounted: Array<{ container: HTMLDivElement; root: Root }> = [];

afterEach(() => {
  for (const entry of mounted.splice(0)) {
    act(() => entry.root.unmount());
    entry.container.remove();
  }
});

function render(element: ReactNode): HTMLDivElement {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  mounted.push({ container, root });
  act(() => root.render(element));
  return container;
}

function click(container: HTMLElement, selector: string): void {
  const button = container.querySelector<HTMLButtonElement>(selector);
  expect(button).not.toBeNull();
  act(() => button?.click());
}

function reviewState(status: 'ready' | 'blocked'): BuilderReviewStateProjectionWire {
  const ready = status === 'ready';
  return Object.freeze({
    projection_version: 'builder-review-state-projection.v1',
    draft_id: `builder-generation-draft:${'5'.repeat(64)}`,
    status,
    label: ready ? 'Ready to review' : 'Review not ready',
    summary: ready
      ? 'A recoverable draft is ready to inspect and save.'
      : 'Waiting for a verified draft checkpoint before saving.',
    checkpoint_status: ready ? 'ready' : 'missing',
    preview_status: 'not_recorded',
    check_status: 'not_run',
    changed_file_count: ready ? 3 : null,
    can_save: ready,
    can_discard: true,
    blocking_reasons: ready ? Object.freeze([]) : Object.freeze(['checkpoint_missing']),
    authority: Object.freeze({
      projection_authority: 'main_owned_review_state_projection_v1',
      candidate_evidence: 'sqlite_conversation_replay_current_unreviewed_candidate',
      checkpoint_evidence: ready
        ? 'verified_latest_candidate_checkpoint'
        : 'missing_or_unverified',
      check_evidence: 'verified_absence',
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
  }) as BuilderReviewStateProjectionWire;
}

const checkProfile: BuilderCheckRunProfile = Object.freeze({
  command_profile_id: `builder-command-profile:${'1'.repeat(32)}`,
  command_kind: 'test',
  command_display: 'npm test',
  requires_user_approval: true,
});

const passedCheck: BuilderCheckRunStatusProjection = Object.freeze({
  projection_version: 'builder-check-run-status-projection.v1',
  project_id: 'builder-project:11111111-1111-4111-8111-111111111111',
  candidate_id: `builder-code-change-candidate:${'2'.repeat(64)}`,
  check_run_id: `builder-check-run:${'3'.repeat(64)}`,
  command_kind: 'test',
  command_label: 'Tests',
  status: 'passed',
  label: 'Checked',
  summary: 'The project check completed successfully.',
  environment_reason: 'none',
  completed_at_ms: 20,
  result_digest: `sha256:${'4'.repeat(64)}`,
});

function checkOutcome(state: 'running' | 'unavailable'): BuilderCheckRunOutcomeProjectionWire {
  const running = state === 'running';
  return Object.freeze({
    projection_version: 'builder-check-run-outcome-projection.v1',
    state,
    command_kind: null,
    command_label: null,
    status: state,
    label: running ? 'Running checks' : 'Check status unavailable',
    summary: running
      ? 'Checking the current draft before it is saved.'
      : 'Builder could not verify the check status for this draft.',
    environment_reason: 'none',
    completed_at_ms: null,
    authority: Object.freeze({
      projection_authority: 'main_owned_check_run_outcome_projection_v1',
      fact_source: running ? 'activity_registry' : 'status_unavailable',
      raw_output: 'not_present',
      runtime_paths: 'not_present',
      renderer_authority: 'read_only_projection',
      save_authority: false,
    }),
  });
}

describe('Builder draft review controls', () => {
  it('keeps review summaries out of chat and shows only compact check state', () => {
    const container = render(<BuilderDraftCheckStatus />);

    expect(container.querySelector('[data-builder-check-run-status="not_run"]')).toBeNull();
    expect(container.querySelector('[data-builder-review-checkpoint="true"]')).toBeNull();
    expect(container.textContent).not.toContain('Review before saving');
    expect(container.textContent).not.toContain('Result ready');
  });

  it('keeps draft mutation commands together in the workspace action group', () => {
    const onRejectDraft = vi.fn();
    const onSave = vi.fn();
    const onUndoDraft = vi.fn();
    const container = render(
      <BuilderDraftWorkspaceActions
        canReject
        canSave
        canUndo
        discardLabel="Discard draft"
        onRejectDraft={onRejectDraft}
        onSave={onSave}
        onUndoDraft={onUndoDraft}
        reviewState={reviewState('ready')}
        saveLabel="Save version"
      />,
    );

    expect(container.querySelector('[data-builder-workspace-draft-actions="true"]')).not.toBeNull();
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
    click(container, '[data-builder-undo-draft="true"]');
    expect(container.querySelector('[data-builder-discard-draft="true"]')).toBeNull();
    click(container, '[data-builder-review-more="true"]');
    expect(container.querySelector('[data-builder-save-version="true"]')?.textContent).toContain('Save version');
    expect(container.querySelector('[data-builder-discard-draft="true"]')?.textContent).toContain('Discard draft');
    click(container, '[data-builder-discard-draft="true"]');
    click(container, '[data-builder-review-more="true"]');
    click(container, '[data-builder-save-version="true"]');
    expect(onUndoDraft).toHaveBeenCalledTimes(1);
    expect(onRejectDraft).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('keeps blocked Save out of the workspace group while preserving discard', () => {
    const onRejectDraft = vi.fn();
    const onSave = vi.fn();
    const container = render(
      <BuilderDraftWorkspaceActions
        canReject
        canSave={false}
        canUndo
        discardLabel="Discard draft"
        onRejectDraft={onRejectDraft}
        onSave={onSave}
        onUndoDraft={() => undefined}
        reviewState={reviewState('blocked')}
        saveLabel="Save version"
      />,
    );

    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
    click(container, '[data-builder-review-more="true"]');
    expect(container.querySelector('[data-builder-discard-draft="true"]')).not.toBeNull();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('keeps passed automatic checks quiet in the workspace toolbar', () => {
    const container = render(
      <BuilderDraftCheckStatus
        checkRunProfiles={[checkProfile]}
        checkRunStatus={passedCheck}
      />,
    );

    expect(container.querySelector('[data-builder-check-run-status="passed"]')).toBeNull();
    expect(container.querySelector('[data-builder-check-run-actions="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-run-check]')).toBeNull();
  });

  it('restores running and unavailable outcomes from durable task activity', () => {
    const running = render(
      <BuilderDraftCheckStatus
        checkRunOutcome={checkOutcome('running')}
        checkRunProfiles={[checkProfile]}
      />,
    );
    expect(running.querySelector('[data-builder-check-run-status="running"]')?.textContent)
      .toContain('Running checks');
    expect(running.querySelector('[data-builder-run-check]')).toBeNull();

    const unavailable = render(
      <BuilderDraftCheckStatus
        checkRunOutcome={checkOutcome('unavailable')}
        checkRunProfiles={[checkProfile]}
      />,
    );
    expect(unavailable.querySelector('[data-builder-check-run-status="unavailable"]')?.textContent)
      .toContain('Check status unavailable');
  });

  it('can render draft check state as compact header chrome', () => {
    const container = render(
      <BuilderDraftCheckStatus
        checkRunOutcome={checkOutcome('running')}
        checkRunProfiles={[checkProfile]}
        presentation="compact"
      />,
    );

    const status = container.querySelector('[data-builder-check-run-status="running"]');
    expect(status?.getAttribute('data-builder-check-run-presentation')).toBe('compact');
    expect(status?.getAttribute('title')).toBe('Running checks...');
    expect(status?.querySelector('svg')).not.toBeNull();
    expect(status?.querySelector('span')?.classList.contains('cf-builder-visually-hidden')).toBe(true);
  });
});
