import type { BuilderSourceTreeChanges } from '../domain/builderSourceTreeChanges';
import type {
  BuilderSourceTreePreviewProjection,
  BuilderSourceTreePreviewRuntimeLimitation,
} from '../preview/builderSourceTreePreview';

export function builderChangesSummary(changes: BuilderSourceTreeChanges): string {
  if (changes.comparison_kind === 'no_draft') return 'No unsaved changes to review.';
  if (changes.total_count === 0) return 'This draft has no file changes.';
  const parts = [
    changes.added_count === 0 ? null : `${changes.added_count} added`,
    changes.modified_count === 0 ? null : `${changes.modified_count} changed`,
    changes.deleted_count === 0 ? null : `${changes.deleted_count} removed`,
  ].filter((part): part is string => part !== null);
  return `${changes.total_count} file ${changes.total_count === 1 ? 'change' : 'changes'}: ${parts.join(', ')}.`;
}

function previewLimitationLabels(
  limitations: readonly BuilderSourceTreePreviewRuntimeLimitation[],
): readonly string[] {
  const labels: string[] = [];
  for (const limitation of limitations) {
    if (limitation === 'javascript_module') labels.push('JavaScript modules');
    else if (limitation === 'three_js') labels.push('Three.js/WebGL');
    else if (limitation === 'canvas_animation') labels.push('canvas animation');
    else if (limitation === 'network_or_external_asset') labels.push('external assets');
    else if (limitation === 'backend_or_local_server') labels.push('local app runtime');
    else if (limitation === 'javascript_removed' && !limitations.includes('javascript_module')) {
      labels.push('JavaScript');
    }
  }
  return labels.slice(0, 4);
}

export function builderReviewPreviewStatus(
  preview: BuilderSourceTreePreviewProjection | null,
  hasContent: boolean,
): string {
  if (preview !== null) {
    const runtimeOnlyLimitations = preview.preview_runtime_limitations.filter(
      (limitation) => limitation !== 'javascript_removed',
    );
    const runtimeOnlyLabels = previewLimitationLabels(runtimeOnlyLimitations);
    if (runtimeOnlyLabels.length > 0) {
      return `Preview may need live support here: ${runtimeOnlyLabels.join(', ')} cannot run in the static preview. The files may still be ready for review.`;
    }
    if (preview.preview_runtime_limitations.includes('javascript_removed')) {
      return 'Static preview is ready. HTML and CSS are shown here; JavaScript is disabled in this preview.';
    }
    return 'Static preview is ready. HTML and CSS are shown here.';
  }
  return hasContent
    ? 'Preview unavailable. JavaScript modules, Three.js, canvas animation, network assets, local servers, or backend code need live preview support.'
    : 'Review this draft before saving.';
}
