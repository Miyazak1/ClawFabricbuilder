import { useState, type Ref } from 'react';
import { CircleCheck, CircleX, Ellipsis, GitCompareArrows, LoaderCircle, Save, Trash2 } from 'lucide-react';

import type { BuilderCheckRunProfile, BuilderCheckRunStatusProjection } from '../application/builderPorts';
import type { BuilderCheckRunOutcomeProjectionWire } from '../domain/builderCheckRunOutcomeProjection';
import type { BuilderSourceTreeChanges } from '../domain/builderSourceTreeChanges';
import type { BuilderReviewStateProjectionWire } from '../domain/builderReviewStateProjection';
import type { BuilderSourceTreePreviewProjection } from '../preview/builderSourceTreePreview';
import { builderChangesSummary, builderReviewPreviewStatus } from './builderReviewText';

export type BuilderReviewCheckpointProps = Readonly<{
  changes: BuilderSourceTreeChanges;
  checkRunOperation?: 'loading' | 'running' | 'skipping' | 'failed' | null;
  checkRunOutcome?: BuilderCheckRunOutcomeProjectionWire | null;
  checkRunProfiles?: readonly BuilderCheckRunProfile[];
  checkRunStatus?: BuilderCheckRunStatusProjection | null;
  hasContent: boolean;
  preview: BuilderSourceTreePreviewProjection | null;
  reviewState: BuilderReviewStateProjectionWire | null;
  checkpointRef?: Ref<HTMLElement>;
}>;

export type BuilderDraftWorkspaceActionsProps = Readonly<{
  canReject: boolean;
  canSave: boolean;
  discardLabel: string;
  onRejectDraft?: () => void;
  onSave?: () => void;
  reviewState: BuilderReviewStateProjectionWire | null;
  saveLabel: string;
}>;

export function BuilderDraftWorkspaceActions({
  canReject,
  canSave,
  discardLabel,
  onRejectDraft,
  onSave,
  reviewState,
  saveLabel,
}: BuilderDraftWorkspaceActionsProps) {
  const saveBlockedByReview = reviewState !== null && reviewState.can_save !== true;
  const showSaveAction = canSave || saveLabel !== 'Save version' || !saveBlockedByReview;
  const [secondaryActionsOpen, setSecondaryActionsOpen] = useState(false);
  const showDiscardAction = typeof onRejectDraft === 'function';
  return (
    <div
      aria-label="Draft actions"
      className="cf-builder-workspace-draft-actions"
      data-builder-workspace-draft-actions="true"
      role="group"
    >
      {showSaveAction ? (
        <button
          className="cf-builder-primary-button cf-builder-workspace-save-button"
          data-builder-save-version="true"
          disabled={!canSave}
          onClick={onSave}
          type="button"
        >
          <Save aria-hidden="true" className="size-3.5" />
          {saveLabel}
        </button>
      ) : null}
      {showDiscardAction ? (
        <div className="cf-builder-workspace-draft-more-wrap">
          <button
            aria-expanded={secondaryActionsOpen}
            aria-haspopup="menu"
            aria-label="More review actions"
            className="cf-builder-workspace-control-button"
            data-builder-review-more="true"
            onClick={() => setSecondaryActionsOpen((open) => !open)}
            title="More review actions"
            type="button"
          >
            <Ellipsis aria-hidden="true" className="size-3.5" />
          </button>
          {secondaryActionsOpen ? (
            <div
              className="cf-builder-review-more-menu cf-builder-workspace-draft-more-menu"
              data-builder-review-more-menu="true"
              role="menu"
            >
              <button
                className="cf-builder-review-menu-item cf-builder-review-danger-action"
                data-builder-discard-draft="true"
                disabled={!canReject}
                onClick={() => {
                  setSecondaryActionsOpen(false);
                  onRejectDraft?.();
                }}
                role="menuitem"
                type="button"
              >
                <Trash2 aria-hidden="true" className="size-3.5" />
                {discardLabel}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function BuilderReviewCheckpoint({
  changes,
  checkRunOperation = null,
  checkRunOutcome = null,
  checkRunProfiles = [],
  checkRunStatus = null,
  hasContent,
  preview,
  reviewState,
  checkpointRef,
}: BuilderReviewCheckpointProps) {
  const restoredRunning = checkRunOperation === null && checkRunOutcome?.state === 'running';
  const recordedStatus = checkRunStatus ?? (
    checkRunOutcome?.state === 'completed'
      || checkRunOutcome?.state === 'skipped'
      || checkRunOutcome?.state === 'unavailable'
      ? checkRunOutcome
      : null
  );
  const checkStatusText = checkRunOperation === 'loading'
    ? 'Finding project checks...'
    : checkRunOperation === 'running' || restoredRunning
      ? 'Running project check...'
      : checkRunOperation === 'skipping'
        ? 'Recording your choice to skip checks...'
      : checkRunOperation === 'failed'
        ? 'Project checks are unavailable. Try again.'
        : recordedStatus !== null
          ? `${recordedStatus.label}. ${recordedStatus.summary}`
          : checkRunProfiles.length === 0
            ? 'No project checks found.'
            : 'Checking automatically...';
  const CheckStatusIcon = checkRunOperation === 'loading'
    || checkRunOperation === 'running'
    || checkRunOperation === 'skipping'
    || restoredRunning
    ? LoaderCircle
    : recordedStatus?.status === 'passed' || recordedStatus?.status === 'skipped'
      ? CircleCheck
      : recordedStatus !== null
        ? CircleX
        : null;
  return (
    <section
      aria-label="Draft review"
      className="cf-builder-review-checkpoint cf-builder-chat-flow-surface"
      data-builder-review-layout="status-only"
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
        className="cf-builder-review-checks"
        data-builder-check-run-operation={checkRunOperation ?? 'idle'}
        data-builder-review-checks="true"
      >
        <div
          className="cf-builder-review-check-status"
          data-builder-check-run-status={recordedStatus?.status ?? (restoredRunning ? 'running' : 'not_run')}
        >
          <span className="cf-builder-review-check-label">Checks</span>
          <span className="cf-builder-review-check-summary" role={checkRunOperation === 'failed' ? 'alert' : undefined}>
            {CheckStatusIcon === null ? null : (
              <CheckStatusIcon
                aria-hidden="true"
                className={checkRunOperation === 'loading'
                  || checkRunOperation === 'running'
                  || checkRunOperation === 'skipping'
                  || restoredRunning
                  ? 'size-3.5 animate-spin'
                  : 'size-3.5'}
              />
            )}
            {checkStatusText}
          </span>
        </div>
      </div>
    </section>
  );
}
