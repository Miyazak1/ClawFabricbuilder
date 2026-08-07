import type { Ref } from 'react';
import { Eye, Maximize2 } from 'lucide-react';

import { BuilderStaticPreview } from '../components/BuilderStaticPreview';
import type { BuilderSourceTreePreviewProjection } from '../preview/builderSourceTreePreview';

export type BuilderResultPanelProps = Readonly<{
  onExpandPreview?: () => void;
  panelRef?: Ref<HTMLElement>;
  placement?: 'artifact' | 'expanded' | 'flow';
  projection: BuilderSourceTreePreviewProjection | null;
}>;

export function BuilderResultPanel({
  onExpandPreview,
  panelRef,
  placement = 'flow',
  projection,
}: BuilderResultPanelProps) {
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
      </div>
      <div className="cf-builder-flow-card-body">
        <BuilderStaticPreview projection={projection} />
      </div>
    </section>
  );
}
