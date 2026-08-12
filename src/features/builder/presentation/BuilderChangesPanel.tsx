import { GitCompareArrows } from 'lucide-react';

import type {
  BuilderSourceTreeChange,
  BuilderSourceTreeChanges,
} from '../domain/builderSourceTreeChanges';
import { builderChangesSummary } from './builderReviewText';

export type BuilderChangesPanelProps = Readonly<{
  changes: BuilderSourceTreeChanges;
  onOpenChange: (open: boolean) => void;
  onOpenFile: (change: BuilderSourceTreeChange) => void;
  open: boolean;
  placement?: 'artifact' | 'flow';
}>;

function changeLabel(change: BuilderSourceTreeChange): string {
  if (change.change_kind === 'added') return 'Added';
  if (change.change_kind === 'deleted') return 'Removed';
  return 'Changed';
}

function lineSummary(change: BuilderSourceTreeChange): string {
  if (change.change_kind === 'added') {
    return `${change.after_line_count} ${change.after_line_count === 1 ? 'line' : 'lines'} added`;
  }
  if (change.change_kind === 'deleted') {
    return `${change.before_line_count} ${change.before_line_count === 1 ? 'line' : 'lines'} removed`;
  }
  return `${change.before_line_count} ${change.before_line_count === 1 ? 'line' : 'lines'} to ${change.after_line_count} ${change.after_line_count === 1 ? 'line' : 'lines'}`;
}

function diffMarker(lineKind: BuilderSourceTreeChange['diff_lines'][number]['line_kind']): string {
  if (lineKind === 'added') return '+';
  if (lineKind === 'removed') return '-';
  return ' ';
}

function lineNumberLabel(value: number | null): string {
  return value === null ? '' : String(value);
}

export function BuilderChangesPanel({
  changes,
  onOpenChange,
  onOpenFile,
  open,
  placement = 'flow',
}: BuilderChangesPanelProps) {
  const lockedOpen = placement === 'artifact';
  return (
    <section
      aria-label="Project changes"
      className="cf-builder-changes-panel"
      data-builder-changes-panel="true"
      data-builder-changes-placement={placement}
      id="builder-tool-changes"
      tabIndex={-1}
    >
      <details
        className="cf-builder-changes-disclosure"
        data-builder-changes-disclosure="true"
        onToggle={(event) => {
          if (lockedOpen && !event.currentTarget.open) {
            event.currentTarget.open = true;
            return;
          }
          onOpenChange(event.currentTarget.open);
        }}
        open={lockedOpen ? true : open}
        tabIndex={-1}
      >
        <summary
          className="cf-builder-panel-toolbar cf-builder-changes-summary-row"
          data-builder-changes-summary-placement={placement}
          onClick={(event) => {
            if (lockedOpen) event.preventDefault();
          }}
        >
          <GitCompareArrows aria-hidden="true" className="size-4" />
          <span className="cf-builder-changes-summary-main">
            {placement === 'flow' ? (
              <span className="cf-builder-changes-title">Changes</span>
            ) : null}
            <span className="cf-builder-changes-summary" data-builder-changes-summary="true">
              {builderChangesSummary(changes)}
            </span>
          </span>
        </summary>
        <div className="cf-builder-changes-body">
          {changes.files.length === 0 ? (
            <div className="cf-builder-empty flex min-h-32 items-center justify-center border border-dashed px-4 text-center text-sm">
              {changes.comparison_kind === 'no_draft'
                ? 'Make a draft to compare it with the current version.'
                : 'No file changes were found in this draft.'}
            </div>
          ) : (
            <ol className="cf-builder-changes-list">
              {changes.files.map((change) => (
                <li
                  className="cf-builder-change-item"
                  data-builder-change-card={`${changeLabel(change)} ${change.path}`}
                  data-builder-change-kind={change.change_kind}
                  key={`${change.change_kind}:${change.path}`}
                >
                  <span className="cf-builder-change-kind">{changeLabel(change)}</span>
                  <div className="min-w-0">
                    {change.change_kind === 'deleted' ? (
                      <span className="cf-builder-change-path">{change.path}</span>
                    ) : (
                      <button
                        className="cf-builder-change-path-button"
                        onClick={() => onOpenFile(change)}
                        type="button"
                      >
                        {change.path}
                      </button>
                    )}
                    <p className="cf-builder-change-lines">{lineSummary(change)}</p>
                    {change.diff_availability === 'too_large' ? (
                      <p className="cf-builder-change-diff-note" data-builder-change-diff-note={change.path}>
                        This change is too large for the inline comparison.
                      </p>
                    ) : (
                      <div
                        aria-label={`${change.path} comparison`}
                        className="cf-builder-change-diff"
                        data-builder-change-diff={change.path}
                      >
                        {change.diff_lines.map((line, index) => (
                          <div
                            className="cf-builder-change-diff-line"
                            data-builder-change-diff-line-kind={line.line_kind}
                            key={`${line.line_kind}:${line.before_line ?? ''}:${line.after_line ?? ''}:${index}`}
                          >
                            <span className="cf-builder-change-diff-number" aria-hidden="true">
                              {lineNumberLabel(line.before_line)}
                            </span>
                            <span className="cf-builder-change-diff-number" aria-hidden="true">
                              {lineNumberLabel(line.after_line)}
                            </span>
                            <span className="cf-builder-change-diff-marker" aria-hidden="true">
                              {diffMarker(line.line_kind)}
                            </span>
                            <code className="cf-builder-change-diff-text">
                              {line.text}
                            </code>
                          </div>
                        ))}
                        {change.omitted_line_count > 0 ? (
                          <p className="cf-builder-change-diff-note">
                            {change.omitted_line_count} {change.omitted_line_count === 1 ? 'line' : 'lines'} not shown.
                          </p>
                        ) : null}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </details>
    </section>
  );
}
