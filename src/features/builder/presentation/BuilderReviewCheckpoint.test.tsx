// @vitest-environment jsdom
import { act, createRef, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BuilderSourceTreeChanges } from '../domain/builderSourceTreeChanges';
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
      check_evidence: 'not_present',
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

describe('BuilderReviewCheckpoint', () => {
  it('renders the draft review actions without changing public selectors', () => {
    const onOpenChanges = vi.fn();
    const onOpenPreview = vi.fn();
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
        onOpenChanges={onOpenChanges}
        onOpenPreview={onOpenPreview}
        onRejectDraft={onRejectDraft}
        onSave={onSave}
        preview={null}
        reviewState={reviewState('ready')}
        saveLabel="Save version"
      />,
    );

    const checkpoint = container.querySelector('[data-builder-review-checkpoint="true"]');
    expect(checkpoint).toBe(checkpointRef.current);
    expect(checkpoint?.getAttribute('data-builder-review-layout')).toBe('desktop-stacked-actions');
    expect(container.querySelector('[data-builder-review-title="true"]')?.textContent)
      .toBe('Review before saving');
    expect(container.querySelector('[data-builder-review-summary="true"]')?.textContent)
      .toBe('3 file changes: 2 added, 1 changed.');
    expect(container.querySelector('[data-builder-review-note="true"]')?.textContent)
      .toContain('Preview unavailable.');
    expect(container.querySelector('[data-builder-review-state="ready"]')?.textContent)
      .toContain('recoverable draft');

    click(container, '[data-builder-review-open-preview="true"]');
    click(container, '[data-builder-review-open-changes="true"]');
    click(container, '[data-builder-discard-draft="true"]');
    click(container, '[data-builder-save-version="true"]');
    expect(onOpenPreview).toHaveBeenCalledTimes(1);
    expect(onOpenChanges).toHaveBeenCalledTimes(1);
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
        onOpenChanges={() => undefined}
        onOpenPreview={() => undefined}
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
});
