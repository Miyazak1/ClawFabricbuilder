import { useState, type Ref } from 'react';
import { CircleCheck, CircleX, Ellipsis, GitCompareArrows, LoaderCircle, Play, Save, Trash2 } from 'lucide-react';

import type { BuilderCheckRunProfile, BuilderCheckRunStatusProjection } from '../application/builderPorts';
import type { BuilderCheckRunOutcomeProjectionWire } from '../domain/builderCheckRunOutcomeProjection';
import type { BuilderSourceTreeChanges } from '../domain/builderSourceTreeChanges';
import type { BuilderReviewStateProjectionWire } from '../domain/builderReviewStateProjection';
import type { BuilderSourceTreePreviewProjection } from '../preview/builderSourceTreePreview';
import { builderChangesSummary, builderReviewPreviewStatus } from './builderReviewText';

export type BuilderReviewCheckpointProps = Readonly<{
  changes: BuilderSourceTreeChanges;
  canReject: boolean;
  canSave: boolean;
  checkRunOperation?: 'loading' | 'running' | 'skipping' | 'failed' | null;
  checkRunOutcome?: BuilderCheckRunOutcomeProjectionWire | null;
  checkRunProfiles?: readonly BuilderCheckRunProfile[];
  checkRunStatus?: BuilderCheckRunStatusProjection | null;
  discardLabel: string;
  hasContent: boolean;
  onRejectDraft?: () => void;
  onRunCheck?: (profile: BuilderCheckRunProfile) => void;
  onSkipCheck?: () => void;
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
  checkRunOperation = null,
  checkRunOutcome = null,
  checkRunProfiles = [],
  checkRunStatus = null,
  discardLabel,
  hasContent,
  onRejectDraft,
  onRunCheck,
  onSkipCheck,
  onSave,
  preview,
  reviewState,
  saveLabel,
  checkpointRef,
}: BuilderReviewCheckpointProps) {
  const restoredRunning = checkRunOperation === null && checkRunOutcome?.state === 'running';
  const checksBusy = checkRunOperation === 'loading'
    || checkRunOperation === 'running'
    || checkRunOperation === 'skipping'
    || restoredRunning;
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
            : 'Not checked.';
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
  const saveBlockedByReview = reviewState !== null && reviewState.can_save !== true;
  const showSaveAction = canSave || saveLabel !== 'Save version' || !saveBlockedByReview;
  const [secondaryActionsOpen, setSecondaryActionsOpen] = useState(false);
  const showSkipAction = typeof onSkipCheck === 'function';
  const showDiscardAction = typeof onRejectDraft === 'function';
  const showSecondaryActions = showSkipAction || showDiscardAction;
  return (
    <section
      aria-label="Draft review"
      className="cf-builder-review-checkpoint cf-builder-chat-flow-surface"
      data-builder-review-layout="compact-decision-actions"
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
        {checkRunProfiles.length > 0 ? (
          <div className="cf-builder-review-check-actions" data-builder-check-run-actions="true">
            {checkRunProfiles.map((profile) => (
              <button
                className="cf-builder-review-check-button inline-flex min-h-8 items-center justify-center gap-2 px-2.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50"
                data-builder-run-check={profile.command_profile_id}
                disabled={checksBusy || typeof onRunCheck !== 'function'}
                key={profile.command_profile_id}
                onClick={() => onRunCheck?.(profile)}
                type="button"
              >
                <Play aria-hidden="true" className="size-3.5" />
                Run {profile.command_display}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <div
        className="cf-builder-review-actions"
        data-builder-draft-review-actions="true"
        data-builder-review-actions="true"
      >
        {showSecondaryActions ? (
          <div className="cf-builder-review-more-wrap">
            <button
              aria-expanded={secondaryActionsOpen}
              aria-haspopup="menu"
              aria-label="More review actions"
              className="cf-builder-review-more-button inline-flex min-h-8 shrink-0 items-center justify-center px-2 text-xs font-medium"
              data-builder-review-more="true"
              onClick={() => setSecondaryActionsOpen((open) => !open)}
              title="More review actions"
              type="button"
            >
              <Ellipsis aria-hidden="true" className="size-3.5" />
            </button>
            {secondaryActionsOpen ? (
              <div
                className="cf-builder-review-more-menu"
                data-builder-review-more-menu="true"
                role="menu"
              >
                {showSkipAction ? (
                  <button
                    className="cf-builder-review-menu-item"
                    data-builder-skip-check="true"
                    disabled={checksBusy}
                    onClick={() => {
                      setSecondaryActionsOpen(false);
                      onSkipCheck?.();
                    }}
                    role="menuitem"
                    type="button"
                  >
                    <CircleCheck aria-hidden="true" className="size-3.5" />
                    Skip check
                  </button>
                ) : null}
                {showDiscardAction ? (
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
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
        {showSaveAction ? (
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
        ) : null}
      </div>
    </section>
  );
}
