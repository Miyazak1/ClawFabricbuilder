import {
  isTrustedBuilderSourceTreePreviewProjection,
  type BuilderSourceTreePreviewProjection,
} from '../preview/builderSourceTreePreview';

export type BuilderStaticPreviewProps = {
  projection: BuilderSourceTreePreviewProjection | unknown;
};

export function BuilderStaticPreview({ projection }: BuilderStaticPreviewProps) {
  if (!isTrustedBuilderSourceTreePreviewProjection(projection)) {
    return (
      <section
        aria-label="Project preview unavailable"
        className="cf-builder-static-preview cf-builder-preview-unavailable flex min-h-0 flex-col gap-1.5"
        data-builder-preview-unavailable="true"
        role="status"
      >
        <h2 className="cf-builder-preview-unavailable-title">Preview unavailable</h2>
        <p className="cf-builder-preview-note">
          Visual preview is not available for this project. This safe preview can show static HTML
          and CSS only. Review the source files and changes before saving.
        </p>
        <p className="cf-builder-preview-note">
          JavaScript modules, Three.js, canvas animation, network assets, local servers, and backend
          code need runtime preview support.
        </p>
      </section>
    );
  }

  return (
    <section
      aria-label="Project preview"
      className="cf-builder-static-preview flex min-h-0 flex-col gap-2"
      data-builder-static-preview="true"
    >
      <header className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">{projection.title}</h2>
        <span className="text-xs text-muted-foreground">Static preview</span>
      </header>
      {projection.preview_script_admission === 'not_authorized' ? (
        <section
          aria-label="Static preview limitation"
          className="cf-builder-preview-runtime-notice"
          data-builder-preview-limitation="true"
          role="status"
        >
          <h3 className="cf-builder-preview-runtime-title">Static preview only</h3>
          <p className="cf-builder-preview-note">
            Interactive code is not running here. If this draft uses JavaScript modules, Three.js,
            canvas animation, network assets, local servers, or backend code, the preview can look
            blank even when the files were generated. Review Changes or Source before saving.
          </p>
        </section>
      ) : null}
      <iframe
        className="cf-builder-preview-frame min-h-80 w-full"
        referrerPolicy="no-referrer"
        sandbox=""
        srcDoc={projection.src_doc}
        title={`${projection.title} preview`}
      />
    </section>
  );
}
