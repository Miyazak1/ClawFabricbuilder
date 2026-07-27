import {
  isTrustedBuilderSourceTreePreviewProjection,
  type BuilderSourceTreePreviewProjection,
} from '../preview/builderSourceTreePreview';

export type BuilderStaticPreviewProps = {
  projection: BuilderSourceTreePreviewProjection | unknown;
};

export function BuilderStaticPreview({ projection }: BuilderStaticPreviewProps) {
  if (!isTrustedBuilderSourceTreePreviewProjection(projection)) {
    return <p className="cf-builder-alert cf-builder-alert-danger text-sm" role="alert">Preview unavailable.</p>;
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
        <p className="cf-builder-preview-note" data-builder-preview-limitation="true">
          This preview shows static HTML and CSS only. Projects that rely on JavaScript modules, Three.js,
          canvas animation, or live network assets may appear blank here; review the source files before saving.
        </p>
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
