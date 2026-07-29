import type { Ref } from 'react';
import { Eye } from 'lucide-react';

import { BuilderStaticPreview } from '../components/BuilderStaticPreview';
import type { BuilderSourceTreePreviewProjection } from '../preview/builderSourceTreePreview';

export type BuilderResultPanelProps = Readonly<{
  panelRef?: Ref<HTMLElement>;
  projection: BuilderSourceTreePreviewProjection | null;
}>;

export function BuilderResultPanel({ panelRef, projection }: BuilderResultPanelProps) {
  return (
    <section
      aria-label="Project result"
      className="cf-builder-flow-card cf-builder-preview-panel cf-builder-result-card cf-builder-chat-flow-surface"
      data-builder-preview-flow="true"
      data-builder-result-flow="true"
      id="builder-tool-preview"
      ref={panelRef}
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
