import {
  isTrustedBuilderSourceTreePreviewProjection,
  type BuilderSourceTreePreviewProjection,
  type BuilderSourceTreePreviewRuntimeLimitation,
} from '../preview/builderSourceTreePreview';

export type BuilderStaticPreviewProps = {
  projection: BuilderSourceTreePreviewProjection | unknown;
};

function limitationText(limitation: BuilderSourceTreePreviewRuntimeLimitation): string {
  if (limitation === 'javascript_removed') {
    return 'This draft includes JavaScript that the safe preview does not run.';
  }
  if (limitation === 'javascript_module') {
    return 'It uses JavaScript modules, so the visible result may be incomplete here.';
  }
  if (limitation === 'three_js') {
    return 'It appears to use Three.js or WebGL, which can make the static preview look blank.';
  }
  if (limitation === 'canvas_animation') {
    return 'It uses canvas or animation work that needs full preview support.';
  }
  if (limitation === 'network_or_external_asset') {
    return 'It references external assets or requests that are blocked in this preview.';
  }
  return 'It includes app or server code that needs a local live preview.';
}

function hasReadableStaticBody(srcDoc: string): boolean {
  try {
    const document = new DOMParser().parseFromString(srcDoc, 'text/html');
    return (document.body.textContent ?? '').trim().length > 0;
  } catch {
    return false;
  }
}

function shouldShowRuntimeUnavailable(projection: BuilderSourceTreePreviewProjection): boolean {
  if (hasReadableStaticBody(projection.src_doc)) return false;
  return projection.preview_runtime_limitations.some((limitation) => limitation !== 'javascript_removed');
}

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
          The files were generated, but this preview cannot run this kind of project yet. Review
          the source files and changes before saving.
        </p>
        <p className="cf-builder-preview-note">
          3D/WebGL, JavaScript modules, canvas animation, network assets, local servers, and backend
          code need live preview support.
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
      {shouldShowRuntimeUnavailable(projection) ? (
        <section
          aria-label="Static preview unavailable"
          className="cf-builder-preview-runtime-notice cf-builder-preview-runtime-blocked"
          data-builder-preview-limitation="true"
          data-builder-preview-runtime-blocked="true"
          role="status"
        >
          <h3 className="cf-builder-preview-runtime-title">Preview unavailable here</h3>
          <p className="cf-builder-preview-note">
            The files were generated, but this draft needs live preview support before it can be
            shown here. Review Changes or Source before saving.
          </p>
          {projection.preview_runtime_limitations.length > 0 ? (
            <ul className="cf-builder-preview-limitation-list">
              {projection.preview_runtime_limitations.map((limitation) => (
                <li key={limitation}>{limitationText(limitation)}</li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : (
        <>
          {projection.preview_script_admission === 'not_authorized' ? (
            <section
              aria-label="Static preview limitation"
              className="cf-builder-preview-runtime-notice"
              data-builder-preview-limitation="true"
              role="status"
            >
              <h3 className="cf-builder-preview-runtime-title">Static preview</h3>
              <p className="cf-builder-preview-note">
                HTML and CSS are shown here. JavaScript is disabled, so controls or animations may
                need live preview support before saving.
              </p>
              {projection.preview_runtime_limitations.length > 0 ? (
                <ul className="cf-builder-preview-limitation-list">
                  {projection.preview_runtime_limitations.map((limitation) => (
                    <li key={limitation}>{limitationText(limitation)}</li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}
          <iframe
            className="cf-builder-preview-frame min-h-80 w-full"
            referrerPolicy="no-referrer"
            sandbox=""
            srcDoc={projection.src_doc}
            title={`${projection.title} preview`}
          />
        </>
      )}
    </section>
  );
}
