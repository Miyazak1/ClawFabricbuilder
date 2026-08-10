import { useState, type Ref } from 'react';
import { Eye, Maximize2, Play, RefreshCw, StopCircle } from 'lucide-react';

import { BuilderStaticPreview } from '../components/BuilderStaticPreview';
import type { BuilderLivePreviewStatusProjection } from '../application/builderPorts';
import type { BuilderSourceTreePreviewProjection } from '../preview/builderSourceTreePreview';

export type BuilderResultPanelProps = Readonly<{
  livePreviewOperation?: 'starting' | 'reloading' | 'stopping' | null;
  livePreviewStatus?: BuilderLivePreviewStatusProjection | null;
  onExpandPreview?: () => void;
  onReloadLivePreview?: () => Promise<unknown> | void;
  onRequestLivePreview?: () => Promise<unknown> | void;
  onStopLivePreview?: () => Promise<unknown> | void;
  panelRef?: Ref<HTMLElement>;
  placement?: 'artifact' | 'expanded' | 'flow';
  projection: BuilderSourceTreePreviewProjection | null;
}>;

export function BuilderResultPanel({
  livePreviewOperation = null,
  livePreviewStatus = null,
  onExpandPreview,
  onReloadLivePreview,
  onRequestLivePreview,
  onStopLivePreview,
  panelRef,
  placement = 'flow',
  projection,
}: BuilderResultPanelProps) {
  const [previewMode, setPreviewMode] = useState<'static' | 'live'>('static');
  const className = placement === 'artifact'
    ? 'cf-builder-flow-card cf-builder-preview-panel cf-builder-result-card cf-builder-artifact-preview-card'
    : placement === 'expanded'
      ? 'cf-builder-preview-panel cf-builder-result-card cf-builder-expanded-preview-card'
      : 'cf-builder-flow-card cf-builder-preview-panel cf-builder-result-card cf-builder-chat-flow-surface';
  return (
    <section
      aria-label="Project result"
      className={className}
      data-builder-preview-flow="true"
      data-builder-result-placement={placement}
      data-builder-result-flow="true"
      id="builder-tool-preview"
      ref={panelRef}
      tabIndex={-1}
    >
      <div className="cf-builder-result-toolbar">
        <span className="cf-builder-result-toolbar-label">
          <Eye aria-hidden="true" className="size-4" />
          Result
        </span>
        <span className="cf-builder-preview-mode-switch" role="group" aria-label="Preview mode">
          <button
            aria-pressed={previewMode === 'static'}
            className="cf-builder-preview-mode-button"
            data-active={previewMode === 'static' ? 'true' : undefined}
            data-builder-preview-mode="static"
            onClick={() => setPreviewMode('static')}
            type="button"
          >
            Static
          </button>
          <button
            aria-pressed={previewMode === 'live'}
            className="cf-builder-preview-mode-button"
            data-active={previewMode === 'live' ? 'true' : undefined}
            data-builder-preview-mode="live"
            onClick={() => setPreviewMode('live')}
            type="button"
          >
            Live
          </button>
        </span>
        <span className="cf-builder-result-toolbar-actions">
          {previewMode === 'live' ? (
            <>
              <button
                aria-label="Start live preview"
                className="cf-builder-secondary-button cf-builder-icon-button inline-flex size-8 items-center justify-center"
                data-builder-live-preview-start="true"
                disabled={
                  livePreviewOperation !== null
                  || typeof onRequestLivePreview !== 'function'
                  || livePreviewStatus === null
                  || livePreviewStatus?.can_start === false
                }
                onClick={() => { void onRequestLivePreview?.(); }}
                title="Start live preview"
                type="button"
              >
                <Play aria-hidden="true" className="size-3.5" />
              </button>
              <button
                aria-label="Reload live preview"
                className="cf-builder-secondary-button cf-builder-icon-button inline-flex size-8 items-center justify-center"
                data-builder-live-preview-reload="true"
                disabled={
                  livePreviewOperation !== null
                  || typeof onReloadLivePreview !== 'function'
                  || livePreviewStatus?.can_reload !== true
                }
                onClick={() => { void onReloadLivePreview?.(); }}
                title="Reload live preview"
                type="button"
              >
                <RefreshCw aria-hidden="true" className="size-3.5" />
              </button>
              <button
                aria-label="Stop live preview"
                className="cf-builder-secondary-button cf-builder-icon-button inline-flex size-8 items-center justify-center"
                data-builder-live-preview-stop="true"
                disabled={
                  livePreviewOperation !== null
                  || typeof onStopLivePreview !== 'function'
                  || livePreviewStatus?.can_stop !== true
                }
                onClick={() => { void onStopLivePreview?.(); }}
                title="Stop live preview"
                type="button"
              >
                <StopCircle aria-hidden="true" className="size-3.5" />
              </button>
            </>
          ) : null}
          {placement === 'artifact' && typeof onExpandPreview === 'function' ? (
            <button
              aria-label="Expand preview"
              className="cf-builder-secondary-button cf-builder-icon-button inline-flex size-8 items-center justify-center"
              data-builder-expand-preview="true"
              onClick={onExpandPreview}
              title="Expand preview"
              type="button"
            >
              <Maximize2 aria-hidden="true" className="size-3.5" />
            </button>
          ) : null}
        </span>
      </div>
      <div className="cf-builder-flow-card-body">
        {previewMode === 'live' ? (
          <section
            aria-label="Live preview"
            className="cf-builder-live-preview-panel"
            data-builder-live-preview-panel="true"
            data-builder-live-preview-status={livePreviewStatus?.status ?? 'unknown'}
          >
            <p className="cf-builder-live-preview-title">
              {livePreviewOperation === null
                ? livePreviewStatus?.status === 'ready'
                  ? 'Live preview ready'
                  : 'Live preview'
                : livePreviewOperation === 'starting'
                  ? 'Starting live preview'
                  : livePreviewOperation === 'reloading'
                    ? 'Reloading live preview'
                    : 'Stopping live preview'}
            </p>
            <p className="cf-builder-preview-note" data-builder-live-preview-message="true">
              {livePreviewStatus?.message
                ?? 'Live preview is unavailable until a main-owned preview source resolver is connected.'}
            </p>
          </section>
        ) : (
          <BuilderStaticPreview projection={projection} />
        )}
      </div>
    </section>
  );
}
