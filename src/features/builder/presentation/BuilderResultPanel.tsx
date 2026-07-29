import type { Ref } from 'react';
import { Eye } from 'lucide-react';

import { BuilderStaticPreview } from '../components/BuilderStaticPreview';
import type { BuilderSourceTreePreviewProjection } from '../preview/builderSourceTreePreview';

export type BuilderResultPanelProps = Readonly<{
  panelRef?: Ref<HTMLElement>;
  placement?: 'artifact' | 'flow';
  projection: BuilderSourceTreePreviewProjection | null;
}>;

export function BuilderResultPanel({
  panelRef,
  placement = 'flow',
  projection,
}: BuilderResultPanelProps) {
  const className = placement === 'artifact'
    ? 'cf-builder-flow-card cf-builder-preview-panel cf-builder-result-card cf-builder-artifact-preview-card'
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
        <Eye aria-hidden="true" className="size-4" />
        Result
      </div>
      <div className="cf-builder-flow-card-body">
        <BuilderStaticPreview projection={projection} />
      </div>
    </section>
  );
}
