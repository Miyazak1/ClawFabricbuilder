import type { Ref } from 'react';
import { Eye, GitCompareArrows, Save, Trash2 } from 'lucide-react';

import type { BuilderSourceTreeChanges } from '../domain/builderSourceTreeChanges';
import type { BuilderReviewStateProjectionWire } from '../domain/builderReviewStateProjection';
import type { BuilderSourceTreePreviewProjection } from '../preview/builderSourceTreePreview';
import { builderChangesSummary, builderReviewPreviewStatus } from './builderReviewText';

export type BuilderReviewCheckpointProps = Readonly<{
  changes: BuilderSourceTreeChanges;
  canReject: boolean;
  canSave: boolean;
  discardLabel: string;
  hasContent: boolean;
  onOpenChanges: () => void;
  onOpenPreview: () => void;
  onRejectDraft?: () => void;
  onSave?: () => void;
  preview: BuilderSourceTreePreviewProjection | null;
  reviewState: BuilderReviewStateProjectionWire | null;
  saveLabel: string;
  checkpointRef?: Ref<HTMLElement>;
}>;

export function BuilderReviewCheckpoint({
  changes,
  canReject,
  canSave,
  discardLabel,
  hasContent,
  onOpenChanges,
  onOpenPreview,
  onRejectDraft,
  onSave,
  preview,
  reviewState,
  saveLabel,
  checkpointRef,
}: BuilderReviewCheckpointProps) {
  return (
    <section
      aria-label="Draft review"
      className="cf-builder-review-checkpoint cf-builder-chat-flow-surface"
      data-builder-review-layout="desktop-stacked-actions"
      data-builder-review-checkpoint="true"
      ref={checkpointRef}
      tabIndex={-1}
    >
      <div className="cf-builder-review-copy" data-builder-review-copy="true">
        <div className="cf-builder-review-icon" aria-hidden="true">
          <GitCompareArrows className="size-4" />
        </div>
        <div className="cf-builder-review-copy-body min-w-0" data-builder-review-copy-body="true">
          <h2 className="cf-builder-review-title" data-builder-review-title="true">Review before saving</h2>
          <p className="cf-builder-review-summary" data-builder-review-summary="true">
            {builderChangesSummary(changes)}
          </p>
          <p className="cf-builder-review-note" data-builder-review-note="true">
            {builderReviewPreviewStatus(preview, hasContent)}
          </p>
          <p
            className="cf-builder-review-note"
            data-builder-review-state={reviewState?.status ?? 'unavailable'}
          >
            {reviewState?.summary ?? 'Review status is unavailable.'}
          </p>
        </div>
      </div>
      <div
        className="cf-builder-review-actions"
        data-builder-draft-review-actions="true"
        data-builder-review-actions="true"
      >
        <button
          className="cf-builder-secondary-button inline-flex min-h-8 shrink-0 items-center justify-center gap-2 px-2.5 text-xs font-medium"
          data-builder-review-open-preview="true"
          onClick={onOpenPreview}
          type="button"
        >
          <Eye aria-hidden="true" className="size-3.5" />
          Preview
        </button>
        <button
          className="cf-builder-secondary-button inline-flex min-h-8 shrink-0 items-center justify-center gap-2 px-2.5 text-xs font-medium"
          data-builder-review-open-changes="true"
          onClick={onOpenChanges}
          type="button"
        >
          <GitCompareArrows aria-hidden="true" className="size-3.5" />
          Changes
        </button>
        <button
          className="cf-builder-secondary-button inline-flex min-h-8 shrink-0 items-center justify-center gap-2 px-2.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50"
          data-builder-discard-draft="true"
          disabled={!canReject}
          onClick={onRejectDraft}
          type="button"
        >
          <Trash2 aria-hidden="true" className="size-3.5" />
          {discardLabel}
        </button>
        <button
          className="cf-builder-primary-button inline-flex min-h-8 shrink-0 items-center justify-center gap-2 px-2.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50"
          data-builder-save-version="true"
          disabled={!canSave}
          onClick={onSave}
          type="button"
        >
          <Save aria-hidden="true" className="size-3.5" />
          {saveLabel}
        </button>
      </div>
    </section>
  );
}
