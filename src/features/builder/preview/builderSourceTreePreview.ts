import {
  sanitizeBuilderProjectSourceTree,
  type BuilderProjectSourceFile,
  type BuilderProjectSourceTree,
} from '../domain/builderProjectSnapshot';

export const BUILDER_SOURCE_TREE_PREVIEW_VERSION = 'builder-source-tree-static-preview.v2' as const;
export const BUILDER_SOURCE_TREE_PREVIEW_MAX_UTF8_BYTES = 520 * 1024;

export type BuilderSourceTreePreviewProjection = Readonly<{
  version: typeof BUILDER_SOURCE_TREE_PREVIEW_VERSION;
  project_id: string;
  title: string;
  source_tree_digest: string;
  selected_html_path: string;
  src_doc: string;
  preview_script_admission: 'not_authorized';
  preview_style_admission: 'inline_best_effort';
}>;

export class BuilderSourceTreePreviewError extends Error {
  readonly code = 'preview_unavailable';

  constructor() {
    super('The project preview is unavailable.');
    this.name = 'BuilderSourceTreePreviewError';
  }
}

const TRUSTED_PROJECTIONS = new WeakSet<object>();
const TEXT_ENCODER = new TextEncoder();
const PROJECT_ID_PATTERN =
  /^builder-project:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const PREVIEW_CSP = [
  "default-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "script-src 'none'",
  "style-src 'unsafe-inline'",
].join('; ');
const URL_ATTRIBUTE_NAMES = new Set([
  'action',
  'cite',
  'data',
  'formaction',
  'href',
  'ping',
  'poster',
  'src',
  'srcset',
]);

function previewError(): BuilderSourceTreePreviewError {
  return new BuilderSourceTreePreviewError();
}

function utf8Size(value: string): number {
  return TEXT_ENCODER.encode(value).byteLength;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

function selectHtmlFile(files: readonly BuilderProjectSourceFile[]): BuilderProjectSourceFile | null {
  return files.find((file) => file.path === 'index.html')
    ?? files.find((file) => file.path.endsWith('.html'))
    ?? null;
}

function cssFiles(files: readonly BuilderProjectSourceFile[]): readonly BuilderProjectSourceFile[] {
  return files.filter((file) => file.path.endsWith('.css'));
}

function safeInlineStyleText(value: string): string {
  return value.replace(/</gu, '\\3C ');
}

function removeUnsafeNodes(document: Document): void {
  document.querySelectorAll('script, meta[http-equiv], iframe, object, embed').forEach((node) => {
    const element = node as HTMLElement;
    if (
      element.tagName.toLowerCase() !== 'meta'
      || ['content-security-policy', 'refresh'].includes(
        element.getAttribute('http-equiv')?.toLowerCase() ?? '',
      )
    ) {
      element.remove();
    }
  });
}

function sanitizeAttributes(document: Document): void {
  document.querySelectorAll('*').forEach((node) => {
    const element = node as Element;
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim().toLowerCase();
      if (name.startsWith('on')) {
        element.removeAttribute(attribute.name);
      } else if (
        URL_ATTRIBUTE_NAMES.has(name)
        && (/^[a-z][a-z0-9+.-]*:/u.test(value) || value.startsWith('//'))
      ) {
        element.removeAttribute(attribute.name);
      }
    }
  });
}

function buildPreviewDocument(
  htmlFile: BuilderProjectSourceFile,
  files: readonly BuilderProjectSourceFile[],
): string {
  try {
    const document = new DOMParser().parseFromString(htmlFile.content, 'text/html');
    removeUnsafeNodes(document);
    sanitizeAttributes(document);
    const policy = document.createElement('meta');
    policy.setAttribute('http-equiv', 'Content-Security-Policy');
    policy.setAttribute('content', PREVIEW_CSP);
    document.head.prepend(policy);
    for (const file of cssFiles(files)) {
      const style = document.createElement('style');
      style.setAttribute('data-builder-source-tree-style', file.path);
      style.textContent = safeInlineStyleText(file.content);
      document.head.append(style);
    }
    const source = `<!doctype html>\n${document.documentElement.outerHTML}`;
    if (utf8Size(source) > BUILDER_SOURCE_TREE_PREVIEW_MAX_UTF8_BYTES) throw previewError();
    return source;
  } catch (error) {
    if (error instanceof BuilderSourceTreePreviewError) throw error;
    throw previewError();
  }
}

export async function createBuilderSourceTreePreview(input: Readonly<{
  project_id: string;
  title: string;
  source_tree: BuilderProjectSourceTree | unknown;
}>): Promise<BuilderSourceTreePreviewProjection> {
  try {
    if (
      input === null
      || typeof input !== 'object'
      || Reflect.ownKeys(input).length !== 3
      || !PROJECT_ID_PATTERN.test(input.project_id)
      || typeof input.title !== 'string'
      || input.title.length === 0
      || input.title.trim() !== input.title
    ) throw previewError();
    const sourceTree = await sanitizeBuilderProjectSourceTree(input.source_tree);
    const htmlFile = selectHtmlFile(sourceTree.files);
    if (!htmlFile) throw previewError();
    const projection = deepFreeze<BuilderSourceTreePreviewProjection>({
      version: BUILDER_SOURCE_TREE_PREVIEW_VERSION,
      project_id: input.project_id,
      title: input.title,
      source_tree_digest: sourceTree.source_tree_digest,
      selected_html_path: htmlFile.path,
      src_doc: buildPreviewDocument(htmlFile, sourceTree.files),
      preview_script_admission: 'not_authorized',
      preview_style_admission: 'inline_best_effort',
    });
    TRUSTED_PROJECTIONS.add(projection);
    return projection;
  } catch (error) {
    if (error instanceof BuilderSourceTreePreviewError) throw error;
    throw previewError();
  }
}

export function isTrustedBuilderSourceTreePreviewProjection(
  value: unknown,
): value is BuilderSourceTreePreviewProjection {
  return typeof value === 'object' && value !== null && TRUSTED_PROJECTIONS.has(value);
}
