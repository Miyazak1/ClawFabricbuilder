import {
  verifyBuilderProjectRevision,
  type BuilderProjectRevision,
} from '../domain/builderProject';

export const BUILDER_STATIC_PREVIEW_VERSION = 'builder-static-preview.v1' as const;
export const BUILDER_STATIC_PREVIEW_MAX_UTF8_BYTES = 520 * 1024;

export type BuilderStaticPreviewProjection = {
  version: typeof BUILDER_STATIC_PREVIEW_VERSION;
  project_id: string;
  revision: number;
  revision_digest: string;
  title: string;
  src_doc: string;
  preview_script_admission: 'not_authorized';
};

export class BuilderStaticPreviewError extends Error {
  readonly code = 'preview_unavailable';

  constructor() {
    super('The project preview is unavailable.');
    this.name = 'BuilderStaticPreviewError';
  }
}

const trustedProjections = new WeakSet<object>();
const PREVIEW_CSP = [
  "default-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "script-src 'none'",
  "style-src 'unsafe-inline'",
].join('; ');

function previewError(): BuilderStaticPreviewError {
  return new BuilderStaticPreviewError();
}

function utf8Size(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

function buildPreviewDocument(revision: BuilderProjectRevision): string {
  let document: Document;
  try {
    document = new DOMParser().parseFromString(revision.files['index.html'], 'text/html');
    const policy = document.createElement('meta');
    policy.setAttribute('http-equiv', 'Content-Security-Policy');
    policy.setAttribute('content', PREVIEW_CSP);
    document.head.prepend(policy);

    const style = document.createElement('style');
    style.setAttribute('data-builder-project-styles', 'true');
    style.textContent = revision.files['styles.css'];
    document.head.append(style);
  } catch {
    throw previewError();
  }

  const source = `<!doctype html>\n${document.documentElement.outerHTML}`;
  if (utf8Size(source) > BUILDER_STATIC_PREVIEW_MAX_UTF8_BYTES) throw previewError();
  return source;
}

export async function createBuilderStaticPreview(
  value: unknown,
): Promise<BuilderStaticPreviewProjection> {
  let revision: BuilderProjectRevision;
  try {
    revision = await verifyBuilderProjectRevision(value);
  } catch {
    throw previewError();
  }

  const projection = deepFreeze<BuilderStaticPreviewProjection>({
    version: BUILDER_STATIC_PREVIEW_VERSION,
    project_id: revision.project_id,
    revision: revision.revision,
    revision_digest: revision.revision_digest,
    title: revision.title,
    src_doc: buildPreviewDocument(revision),
    preview_script_admission: 'not_authorized',
  });
  trustedProjections.add(projection);
  return projection;
}

export function isTrustedBuilderStaticPreviewProjection(
  value: unknown,
): value is BuilderStaticPreviewProjection {
  return typeof value === 'object' && value !== null && trustedProjections.has(value);
}
