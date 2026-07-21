import {
  isTrustedBuilderStaticPreviewProjection,
  type BuilderStaticPreviewProjection,
} from '../preview/builderStaticPreview';

export type BuilderStaticPreviewProps = {
  projection: BuilderStaticPreviewProjection | unknown;
};

export function BuilderStaticPreview({ projection }: BuilderStaticPreviewProps) {
  if (!isTrustedBuilderStaticPreviewProjection(projection)) {
    return <p role="alert">Preview unavailable.</p>;
  }

  return (
    <section
      aria-label="Project preview"
      className="flex min-h-0 flex-col gap-2"
      data-builder-static-preview="true"
    >
      <header className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">{projection.title}</h2>
        <span className="text-xs text-muted-foreground">Version {projection.revision}</span>
      </header>
      <iframe
        className="min-h-80 w-full border bg-white"
        referrerPolicy="no-referrer"
        sandbox=""
        srcDoc={projection.src_doc}
        title={`${projection.title} preview`}
      />
    </section>
  );
}
