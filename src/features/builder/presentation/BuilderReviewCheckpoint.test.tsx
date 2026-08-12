// @vitest-environment jsdom
import { act, createRef, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BuilderSourceTreeChanges } from '../domain/builderSourceTreeChanges';
import type { BuilderCheckRunProfile, BuilderCheckRunStatusProjection } from '../application/builderPorts';
import type { BuilderCheckRunOutcomeProjectionWire } from '../domain/builderCheckRunOutcomeProjection';
import type { BuilderReviewStateProjectionWire } from '../domain/builderReviewStateProjection';
import { BuilderReviewCheckpoint } from './BuilderReviewCheckpoint';

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

function changes(overrides: Partial<BuilderSourceTreeChanges> = {}): BuilderSourceTreeChanges {
  return Object.freeze({
    changes_version: 'builder-source-tree-changes.v1',
    comparison_kind: 'new_project',
    added_count: 2,
    modified_count: 1,
    deleted_count: 0,
    total_count: 3,
    files: Object.freeze([]),
    ...overrides,
  }) as BuilderSourceTreeChanges;
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

describe('BuilderReviewCheckpoint', () => {
  it('renders compact draft decision actions without repeating artifact navigation', () => {
    const onRejectDraft = vi.fn();
    const onSave = vi.fn();
    const checkpointRef = createRef<HTMLElement>();
    const container = render(
      <BuilderReviewCheckpoint
        canReject
        canSave
        changes={changes()}
        checkpointRef={checkpointRef}
        discardLabel="Discard draft"
        hasContent
        onRejectDraft={onRejectDraft}
        onSave={onSave}
        preview={null}
        reviewState={reviewState('ready')}
        saveLabel="Save version"
      />,
    );

    const checkpoint = container.querySelector('[data-builder-review-checkpoint="true"]');
    expect(checkpoint).toBe(checkpointRef.current);
    expect(checkpoint?.getAttribute('data-builder-review-layout')).toBe('compact-decision-actions');
    expect(container.querySelector('[data-builder-review-title="true"]')?.textContent)
      .toBe('Review before saving');
    expect(container.querySelector('[data-builder-review-summary="true"]')?.textContent)
      .toBe('3 file changes: 2 added, 1 changed.');
    expect(container.querySelector('[data-builder-review-note="true"]')?.textContent)
      .toContain('Preview unavailable.');
    expect(container.querySelector('[data-builder-review-state="ready"]')?.textContent)
      .toContain('recoverable draft');
    expect(container.querySelector('[data-builder-review-open-preview="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-review-open-changes="true"]')).toBeNull();

    click(container, '[data-builder-discard-draft="true"]');
    click(container, '[data-builder-save-version="true"]');
    expect(onRejectDraft).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('keeps draft mutation actions disabled while preserving the visible labels', () => {
    const onRejectDraft = vi.fn();
    const onSave = vi.fn();
    const container = render(
      <BuilderReviewCheckpoint
        canReject={false}
        canSave={false}
        changes={changes({ comparison_kind: 'no_draft', total_count: 0, added_count: 0, modified_count: 0 })}
        discardLabel="Discarding..."
        hasContent={false}
        onRejectDraft={onRejectDraft}
        onSave={onSave}
        preview={null}
        reviewState={reviewState('blocked')}
        saveLabel="Saving..."
      />,
    );

    expect(container.querySelector('[data-builder-discard-draft="true"]')?.textContent)
      .toContain('Discarding...');
    expect(container.querySelector('[data-builder-save-version="true"]')?.textContent)
      .toContain('Saving...');
    expect(container.querySelector('[data-builder-review-state="blocked"]')?.textContent)
      .toContain('verified draft checkpoint');
    click(container, '[data-builder-discard-draft="true"]');
    click(container, '[data-builder-save-version="true"]');
    expect(onRejectDraft).not.toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('keeps blocked Save out of the chat flow until review is actually saveable', () => {
    const onSave = vi.fn();
    const container = render(
      <BuilderReviewCheckpoint
        canReject
        canSave={false}
        changes={changes()}
        discardLabel="Discard draft"
        hasContent
        onSave={onSave}
        preview={null}
        reviewState={reviewState('blocked')}
        saveLabel="Save version"
      />,
    );

    expect(container.querySelector('[data-builder-review-state="blocked"]')?.textContent)
      .toContain('verified draft checkpoint');
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-discard-draft="true"]')).not.toBeNull();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('offers only discovered checks and makes the selected check an explicit action', () => {
    const onRunCheck = vi.fn();
    const container = render(
      <BuilderReviewCheckpoint
        canReject
        canSave
        changes={changes()}
        checkRunProfiles={[checkProfile]}
        checkRunStatus={passedCheck}
        discardLabel="Discard draft"
        hasContent
        onRunCheck={onRunCheck}
        preview={null}
        reviewState={reviewState('ready')}
        saveLabel="Save version"
      />,
    );

    expect(container.querySelector('[data-builder-check-run-status="passed"]')?.textContent)
      .toContain('completed successfully');
    expect(container.querySelector('[data-builder-check-run-actions="true"]')?.textContent)
      .toContain('Run npm test');
    click(container, `[data-builder-run-check="${checkProfile.command_profile_id}"]`);
    expect(onRunCheck).toHaveBeenCalledTimes(1);
    expect(onRunCheck).toHaveBeenCalledWith(checkProfile);
  });

  it('restores running and unavailable outcomes from durable task activity', () => {
    const running = render(
      <BuilderReviewCheckpoint
        canReject
        canSave={false}
        changes={changes()}
        checkRunOutcome={checkOutcome('running')}
        checkRunProfiles={[checkProfile]}
        discardLabel="Discard draft"
        hasContent
        onRunCheck={() => undefined}
        preview={null}
        reviewState={reviewState('ready')}
        saveLabel="Save version"
      />,
    );
    expect(running.querySelector('[data-builder-check-run-status="running"]')?.textContent)
      .toContain('Running project check');
    expect(running.querySelector<HTMLButtonElement>('[data-builder-run-check]')?.disabled).toBe(true);

    const unavailable = render(
      <BuilderReviewCheckpoint
        canReject
        canSave={false}
        changes={changes()}
        checkRunOutcome={checkOutcome('unavailable')}
        checkRunProfiles={[checkProfile]}
        discardLabel="Discard draft"
        hasContent
        preview={null}
        reviewState={reviewState('ready')}
        saveLabel="Save version"
      />,
    );
    expect(unavailable.querySelector('[data-builder-check-run-status="unavailable"]')?.textContent)
      .toContain('could not verify the check status');
  });
});
