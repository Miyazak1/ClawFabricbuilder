import { BUILDER_PROJECT_READ_RESULT_VERSION } from './builderProjectSnapshot';

export type BuilderProjectCatalogItem = Readonly<{
  project_id: string;
  title: string;
  summary: string;
  revision_number: number;
  revision_receipt_digest: string;
  commit_oid: string;
  tree_oid: string;
  selected_at_ms: number;
}>;

export type BuilderProjectCatalogResult = Readonly<{
  result_version: typeof BUILDER_PROJECT_READ_RESULT_VERSION;
  operation: 'current_listed';
  projects: readonly BuilderProjectCatalogItem[];
  authority_evidence: Readonly<{
    product_authority: 'sqlite_product_revision_receipt';
    code_authority: 'not_read_for_catalog';
    source_read_admission: 'not_requested';
    current_selection: 'sqlite_current_project_revision';
  }>;
}>;

export class BuilderProjectCatalogError extends Error {
  readonly code = 'builder_project_catalog_invalid';

  constructor() {
    super('Saved projects are unavailable.');
    this.name = 'BuilderProjectCatalogError';
  }
}

const RESULT_KEYS = Object.freeze(['result_version', 'operation', 'projects', 'authority_evidence']);
const ITEM_KEYS = Object.freeze([
  'project_id',
  'title',
  'summary',
  'revision_number',
  'revision_receipt_digest',
  'commit_oid',
  'tree_oid',
  'selected_at_ms',
]);
const EVIDENCE_KEYS = Object.freeze([
  'product_authority',
  'code_authority',
  'source_read_admission',
  'current_selection',
]);
const PROJECT_ID_PATTERN =
  /^builder-project:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const OID_PATTERN = /^[0-9a-f]{40}$/u;
const MAX_PROJECTS = 256;

function invalid(): BuilderProjectCatalogError {
  return new BuilderProjectCatalogError();
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw invalid();
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw invalid();
    const ownKeys = Reflect.ownKeys(value);
    if (
      ownKeys.length !== keys.length
      || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))
    ) throw invalid();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const result: Record<string, unknown> = {};
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw invalid();
      result[key] = descriptor.value;
    }
    return result;
  } catch {
    throw invalid();
  }
}

function denseArray(value: unknown): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > MAX_PROJECTS) {
    throw invalid();
  }
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== value.length + 1
    || keys.some((key) => typeof key === 'symbol')
    || !keys.includes('length')
  ) throw invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw invalid();
  }
  return value;
}

function displayText(value: unknown, maximum: number): string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.trim() !== value
    || value.length > maximum * 2
    || Array.from(value).length > maximum
  ) throw invalid();
  return value;
}

function item(value: unknown): BuilderProjectCatalogItem {
  const source = exactRecord(value, ITEM_KEYS);
  if (
    typeof source.project_id !== 'string'
    || !PROJECT_ID_PATTERN.test(source.project_id)
    || !Number.isSafeInteger(source.revision_number)
    || Number(source.revision_number) < 1
    || typeof source.revision_receipt_digest !== 'string'
    || !DIGEST_PATTERN.test(source.revision_receipt_digest)
    || typeof source.commit_oid !== 'string'
    || !OID_PATTERN.test(source.commit_oid)
    || typeof source.tree_oid !== 'string'
    || !OID_PATTERN.test(source.tree_oid)
    || !Number.isSafeInteger(source.selected_at_ms)
    || Number(source.selected_at_ms) < 0
  ) throw invalid();
  return Object.freeze({
    project_id: source.project_id,
    title: displayText(source.title, 80),
    summary: displayText(source.summary, 400),
    revision_number: Number(source.revision_number),
    revision_receipt_digest: source.revision_receipt_digest,
    commit_oid: source.commit_oid,
    tree_oid: source.tree_oid,
    selected_at_ms: Number(source.selected_at_ms),
  });
}

export function sanitizeBuilderProjectCatalogResult(value: unknown): BuilderProjectCatalogResult {
  const source = exactRecord(value, RESULT_KEYS);
  if (
    source.result_version !== BUILDER_PROJECT_READ_RESULT_VERSION
    || source.operation !== 'current_listed'
  ) throw invalid();
  const projects = denseArray(source.projects).map(item);
  for (let index = 1; index < projects.length; index += 1) {
    if (projects[index - 1].project_id >= projects[index].project_id) throw invalid();
  }
  const evidence = exactRecord(source.authority_evidence, EVIDENCE_KEYS);
  if (
    evidence.product_authority !== 'sqlite_product_revision_receipt'
    || evidence.code_authority !== 'not_read_for_catalog'
    || evidence.source_read_admission !== 'not_requested'
    || evidence.current_selection !== 'sqlite_current_project_revision'
  ) throw invalid();
  return Object.freeze({
    result_version: BUILDER_PROJECT_READ_RESULT_VERSION,
    operation: 'current_listed',
    projects: Object.freeze(projects),
    authority_evidence: Object.freeze({
      product_authority: 'sqlite_product_revision_receipt',
      code_authority: 'not_read_for_catalog',
      source_read_admission: 'not_requested',
      current_selection: 'sqlite_current_project_revision',
    }),
  });
}
