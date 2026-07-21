export const BUILDER_PROJECT_CATALOG_RESULT_VERSION = 'builder-project-catalog-result.v1' as const;

export type BuilderProjectCatalogItem = Readonly<{
  project_id: string;
  title: string;
  summary: string;
  revision: number;
  revision_digest: string;
}>;

export type BuilderProjectCatalogResult = Readonly<{
  result_version: typeof BUILDER_PROJECT_CATALOG_RESULT_VERSION;
  projects: readonly BuilderProjectCatalogItem[];
  catalog_evidence: Readonly<{
    source_authority: 'verified_project_head_and_revision_chain';
    ordering: 'project_id_ascending';
    recency: 'not_available';
    global_atomic_snapshot: 'not_proven';
    headless_orphans: 'excluded';
    write_activity: 'none';
    resource_bounds: Readonly<{
      max_project_directories: 256;
      max_file_reads: 1024;
      max_bytes: 33554432;
    }>;
  }>;
}>;

export class BuilderProjectCatalogError extends Error {
  readonly code = 'builder_project_catalog_invalid';

  constructor() {
    super('Saved projects are unavailable.');
    this.name = 'BuilderProjectCatalogError';
  }
}

const RESULT_KEYS = new Set(['result_version', 'projects', 'catalog_evidence']);
const ITEM_KEYS = new Set(['project_id', 'title', 'summary', 'revision', 'revision_digest']);
const EVIDENCE_KEYS = new Set([
  'source_authority',
  'ordering',
  'recency',
  'global_atomic_snapshot',
  'headless_orphans',
  'write_activity',
  'resource_bounds',
]);
const BOUNDS_KEYS = new Set(['max_project_directories', 'max_file_reads', 'max_bytes']);
const PROJECT_ID_PATTERN = /^builder-project:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const MAX_PROJECTS = 256;
const UTF8_ENCODER = new TextEncoder();
const UNSAFE_FORMAT_PATTERN = /[\p{Cf}\p{Bidi_Control}]/u;

function invalid(): BuilderProjectCatalogError {
  return new BuilderProjectCatalogError();
}

function exactRecord(value: unknown, keys: ReadonlySet<string>): Record<string, unknown> {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw invalid();
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw invalid();
    const ownKeys = Reflect.ownKeys(value);
    if (
      ownKeys.length !== keys.size
      || ownKeys.some((key) => typeof key !== 'string' || !keys.has(key))
    ) throw invalid();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const snapshot: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (
        descriptor === undefined
        || !descriptor.enumerable
        || 'get' in descriptor
        || 'set' in descriptor
      ) throw invalid();
      snapshot[key] = descriptor.value;
    }
    return snapshot;
  } catch {
    throw invalid();
  }
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return true;
  }
  return false;
}

function hasDisallowedControl(value: string): boolean {
  if (UNSAFE_FORMAT_PATTERN.test(value)) return true;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

function displayText(value: unknown, maxCodePoints: number, maxUtf8Bytes: number): string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.trim() !== value
    || value.length > maxCodePoints * 2
    || Array.from(value).length > maxCodePoints
    || value.normalize('NFC') !== value
    || hasUnpairedSurrogate(value)
    || hasDisallowedControl(value)
    || UTF8_ENCODER.encode(value).byteLength > maxUtf8Bytes
  ) throw invalid();
  return value;
}

function catalogItem(value: unknown): BuilderProjectCatalogItem {
  const source = exactRecord(value, ITEM_KEYS);
  if (
    typeof source.project_id !== 'string'
    || !PROJECT_ID_PATTERN.test(source.project_id)
    || !Number.isSafeInteger(source.revision)
    || Number(source.revision) < 1
    || typeof source.revision_digest !== 'string'
    || !DIGEST_PATTERN.test(source.revision_digest)
  ) throw invalid();
  return Object.freeze({
    project_id: source.project_id,
    title: displayText(source.title, 80, 320),
    summary: displayText(source.summary, 400, 1600),
    revision: Number(source.revision),
    revision_digest: source.revision_digest,
  });
}

export function sanitizeBuilderProjectCatalogResult(
  value: unknown,
): BuilderProjectCatalogResult {
  try {
    const source = exactRecord(value, RESULT_KEYS);
    const projectArray = source.projects;
    if (!Array.isArray(projectArray) || Object.getPrototypeOf(projectArray) !== Array.prototype) {
      throw invalid();
    }
    const projectKeys = Reflect.ownKeys(projectArray);
    const projectDescriptors = Object.getOwnPropertyDescriptors(projectArray) as unknown as Record<
      string,
      PropertyDescriptor
    >;
    const lengthDescriptor = projectDescriptors.length;
    if (
      !lengthDescriptor
      || 'get' in lengthDescriptor
      || 'set' in lengthDescriptor
      || !Number.isSafeInteger(lengthDescriptor.value)
      || Number(lengthDescriptor.value) < 0
      || Number(lengthDescriptor.value) > MAX_PROJECTS
      || projectKeys.length !== Number(lengthDescriptor.value) + 1
    ) throw invalid();
    const projectCount = Number(lengthDescriptor.value);
    if (
      source.result_version !== BUILDER_PROJECT_CATALOG_RESULT_VERSION
      || projectKeys.some((key) => (
        key !== 'length' && (typeof key !== 'string' || !/^(?:0|[1-9][0-9]*)$/.test(key))
      ))
    ) throw invalid();
    const projects: BuilderProjectCatalogItem[] = [];
    for (let index = 0; index < projectCount; index += 1) {
      const descriptor = projectDescriptors[String(index)];
      if (!descriptor || !descriptor.enumerable || 'get' in descriptor || 'set' in descriptor) {
        throw invalid();
      }
      projects.push(catalogItem(descriptor.value));
    }
    for (let index = 0; index < projects.length; index += 1) {
      if (
        (index > 0 && projects[index - 1].project_id >= projects[index].project_id)
        || (index > 0 && projects[index - 1].project_id === projects[index].project_id)
      ) throw invalid();
    }

    const evidence = exactRecord(source.catalog_evidence, EVIDENCE_KEYS);
    const bounds = exactRecord(evidence.resource_bounds, BOUNDS_KEYS);
    if (
      evidence.source_authority !== 'verified_project_head_and_revision_chain'
      || evidence.ordering !== 'project_id_ascending'
      || evidence.recency !== 'not_available'
      || evidence.global_atomic_snapshot !== 'not_proven'
      || evidence.headless_orphans !== 'excluded'
      || evidence.write_activity !== 'none'
      || bounds.max_project_directories !== 256
      || bounds.max_file_reads !== 1024
      || bounds.max_bytes !== 33554432
    ) throw invalid();

    return Object.freeze({
      result_version: BUILDER_PROJECT_CATALOG_RESULT_VERSION,
      projects: Object.freeze(projects),
      catalog_evidence: Object.freeze({
        source_authority: 'verified_project_head_and_revision_chain',
        ordering: 'project_id_ascending',
        recency: 'not_available',
        global_atomic_snapshot: 'not_proven',
        headless_orphans: 'excluded',
        write_activity: 'none',
        resource_bounds: Object.freeze({
          max_project_directories: 256,
          max_file_reads: 1024,
          max_bytes: 33554432,
        }),
      }),
    });
  } catch {
    throw invalid();
  }
}
