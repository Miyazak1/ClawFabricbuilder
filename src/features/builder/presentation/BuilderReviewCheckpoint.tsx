import { useState } from 'react';
import { CircleCheck, CircleX, Ellipsis, LoaderCircle, Save, Trash2, Undo2 } from 'lucide-react';

import type { BuilderCheckRunProfile, BuilderCheckRunStatusProjection } from '../application/builderPorts';
import type { BuilderCheckRunOutcomeProjectionWire } from '../domain/builderCheckRunOutcomeProjection';
import type { BuilderReviewStateProjectionWire } from '../domain/builderReviewStateProjection';

export type BuilderDraftCheckStatusProps = Readonly<{
  checkRunOperation?: 'loading' | 'running' | 'preparing_dependencies' | 'skipping' | 'failed' | null;
  checkRunOutcome?: BuilderCheckRunOutcomeProjectionWire | null;
  checkRunProfiles?: readonly BuilderCheckRunProfile[];
  checkRunStatus?: BuilderCheckRunStatusProjection | null;
  presentation?: 'compact' | 'default';
}>;

export type BuilderDraftWorkspaceActionsProps = Readonly<{
  canReject: boolean;
  canSave: boolean;
  canUndo: boolean;
  discardLabel: string;
  onRejectDraft?: () => void;
  onSave?: () => void;
  onUndoDraft?: () => void;
  reviewState: BuilderReviewStateProjectionWire | null;
  saveLabel: string;
}>;

export function BuilderDraftWorkspaceActions({
  canReject,
  canSave,
  canUndo,
  discardLabel,
  onRejectDraft,
  onSave,
  onUndoDraft,
  reviewState,
  saveLabel,
}: BuilderDraftWorkspaceActionsProps) {
  const saveBlockedByReview = reviewState !== null && reviewState.can_save !== true;
  const showSaveAction = typeof onSave === 'function'
    && (canSave || saveLabel !== 'Save version' || !saveBlockedByReview);
  const [secondaryActionsOpen, setSecondaryActionsOpen] = useState(false);
  const showDiscardAction = typeof onRejectDraft === 'function';
  const showUndoAction = typeof onUndoDraft === 'function';
  const showSecondaryActions = showSaveAction || showDiscardAction;
  return (
    <div
      aria-label="Draft actions"
      className="cf-builder-workspace-draft-actions"
      data-builder-workspace-draft-actions="true"
      role="group"
    >
      {saveBlockedByReview ? (
        <span
          className="cf-builder-workspace-review-state"
          data-builder-review-state={reviewState.status}
          role="status"
          title={reviewState.summary}
        >
          <CircleX aria-hidden="true" className="size-3.5" />
          <span>{reviewState.summary}</span>
        </span>
      ) : null}
      {showUndoAction ? (
        <button
          aria-label="Undo latest AI change"
          className="cf-builder-workspace-control-button"
          data-builder-undo-draft="true"
          disabled={!canUndo}
          onClick={onUndoDraft}
          title="Undo latest AI change"
          type="button"
        >
          <Undo2 aria-hidden="true" className="size-3.5" />
        </button>
      ) : null}
      {showSecondaryActions ? (
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
              {showSaveAction ? (
                <button
                  className="cf-builder-review-menu-item"
                  data-builder-save-version="true"
                  disabled={!canSave}
                  onClick={() => {
                    setSecondaryActionsOpen(false);
                    onSave?.();
                  }}
                  role="menuitem"
                  type="button"
                >
                  <Save aria-hidden="true" className="size-3.5" />
                  {saveLabel}
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
    </div>
  );
}

export function BuilderDraftCheckStatus({
  checkRunOperation = null,
  checkRunOutcome = null,
  checkRunProfiles = [],
  checkRunStatus = null,
  presentation = 'default',
}: BuilderDraftCheckStatusProps) {
  const restoredRunning = checkRunOperation === null && checkRunOutcome?.state === 'running';
  const recordedStatus = checkRunStatus ?? (
    checkRunOutcome?.state === 'completed'
      || checkRunOutcome?.state === 'skipped'
      || checkRunOutcome?.state === 'unavailable'
      ? checkRunOutcome
      : null
  );
  const checkStatusText = checkRunOperation === 'loading'
    ? 'Finding checks...'
    : checkRunOperation === 'running' || restoredRunning
      ? 'Running checks...'
      : checkRunOperation === 'preparing_dependencies'
        ? 'Preparing dependencies...'
        : checkRunOperation === 'skipping'
          ? 'Skipping checks...'
          : checkRunOperation === 'failed'
            ? 'Checks unavailable'
            : recordedStatus !== null
              ? recordedStatus.label
              : checkRunProfiles.length === 0
                ? 'No checks found'
                : 'Checking...';
  const checkStatusTitle = recordedStatus?.summary ?? checkStatusText;
  const CheckStatusIcon = checkRunOperation === 'loading'
    || checkRunOperation === 'running'
    || checkRunOperation === 'preparing_dependencies'
    || checkRunOperation === 'skipping'
    || restoredRunning
    ? LoaderCircle
    : recordedStatus?.status === 'passed' || recordedStatus?.status === 'skipped'
      ? CircleCheck
      : recordedStatus !== null
        ? CircleX
        : null;
  if (
    checkRunOperation === null
    && !restoredRunning
    && (
      recordedStatus === null
      || recordedStatus.status === 'passed'
      || recordedStatus.status === 'skipped'
    )
  ) {
    return null;
  }
  return (
    <div
      aria-label="Draft check status"
      className="cf-builder-workspace-check-status"
      data-builder-check-run-operation={checkRunOperation ?? 'idle'}
      data-builder-check-run-presentation={presentation}
      data-builder-check-run-status={recordedStatus?.status ?? (restoredRunning ? 'running' : 'not_run')}
      role="status"
      title={checkStatusTitle}
    >
      {CheckStatusIcon === null ? null : (
        <CheckStatusIcon
          aria-hidden="true"
          className={checkRunOperation === 'loading'
            || checkRunOperation === 'running'
            || checkRunOperation === 'preparing_dependencies'
            || checkRunOperation === 'skipping'
            || restoredRunning
            ? 'size-3.5 animate-spin'
            : 'size-3.5'}
        />
      )}
      <span className={presentation === 'compact' ? 'cf-builder-visually-hidden' : undefined}>
        {checkStatusText}
      </span>
    </div>
  );
}
