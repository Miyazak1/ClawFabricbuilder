import { BUILDER_PROJECT_READ_RESULT_VERSION } from './builderProjectSnapshot';

export const BUILDER_PROJECT_HISTORY_LIMIT = 128 as const;

export type BuilderProjectHistoryCurrent = Readonly<{
  project_id: string;
  title: string;
  summary: string;
  revision_number: number;
  revision_receipt_digest: string;
}>;

export type BuilderProjectHistoryRevision = Readonly<{
  project_id: string;
  title: string;
  summary: string;
  revision_number: number;
  revision_receipt_digest: string;
  previous_revision_receipt_digest: string | null;
  selected_at_ms: number;
  is_current: boolean;
}>;

export type BuilderProjectHistoryResult = Readonly<{
  result_version: typeof BUILDER_PROJECT_READ_RESULT_VERSION;
  operation: 'history_listed';
  project_id: string;
  current: BuilderProjectHistoryCurrent;
  revisions: readonly BuilderProjectHistoryRevision[];
  authority_evidence: Readonly<{
    product_authority: 'sqlite_product_revision_receipt';
    code_authority: 'git_commit_tree';
    source_read_admission: 'verified';
    current_selection: 'sqlite_current_project_revision';
    history_selection: 'sqlite_project_revision_receipts';
  }>;
}>;

type BuilderProjectHistoryRevisionEvidence = BuilderProjectHistoryRevision & Readonly<{
  commit_oid: string;
  tree_oid: string;
  parent_oid: string | null;
}>;

type BuilderProjectHistoryCurrentEvidence = BuilderProjectHistoryCurrent & Readonly<{
  object_format: 'sha1';
  commit_oid: string;
  tree_oid: string;
  parent_oid: string | null;
}>;

export class BuilderProjectHistoryError extends Error {
  readonly code = 'builder_project_history_unavailable';
  readonly retryable = true;

  constructor() {
    super('Project history is unavailable.');
    this.name = 'BuilderProjectHistoryError';
    this.stack = `${this.name}: ${this.message}`;
  }
}

const TEXT_ENCODER = new TextEncoder();
const UUID_SOURCE =
  '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const PROJECT_ID_PATTERN = new RegExp(`^builder-project:${UUID_SOURCE}$`, 'u');
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const OID_PATTERN = /^[0-9a-f]{40}$/u;
const UNSAFE_UNICODE_FORMAT_PATTERN = /[\p{Cf}\p{Bidi_Control}]/u;
const RESULT_KEYS = Object.freeze([
  'result_version',
  'operation',
  'project_id',
  'current',
  'revisions',
  'authority_evidence',
]);
const CURRENT_KEYS = Object.freeze([
  'project_id',
  'title',
  'summary',
  'revision_receipt_digest',
  'revision_number',
  'object_format',
  'commit_oid',
  'tree_oid',
  'parent_oid',
]);
const REVISION_KEYS = Object.freeze([
  'project_id',
  'title',
  'summary',
  'revision_number',
  'revision_receipt_digest',
  'previous_revision_receipt_digest',
  'commit_oid',
  'tree_oid',
  'parent_oid',
  'selected_at_ms',
  'is_current',
]);
const AUTHORITY_EVIDENCE_KEYS = Object.freeze([
  'product_authority',
  'code_authority',
  'source_read_admission',
  'current_selection',
  'history_selection',
]);

function unavailable(): BuilderProjectHistoryError {
  return new BuilderProjectHistoryError();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!isPlainObject(value)) throw unavailable();
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== keys.length
    || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) throw unavailable();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (
      !descriptor
      || !descriptor.enumerable
      || !Object.hasOwn(descriptor, 'value')
    ) throw unavailable();
    result[key] = descriptor.value;
  }
  return result;
}

function denseArray(value: unknown): readonly unknown[] {
  if (
    !Array.isArray(value)
    || Object.getPrototypeOf(value) !== Array.prototype
    || value.length < 1
    || value.length > BUILDER_PROJECT_HISTORY_LIMIT
  ) throw unavailable();
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== value.length + 1
    || ownKeys.some((key) => typeof key === 'symbol')
    || !ownKeys.includes('length')
  ) throw unavailable();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const result: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (
      !descriptor
      || !descriptor.enumerable
      || !Object.hasOwn(descriptor, 'value')
    ) throw unavailable();
    result.push(descriptor.value);
  }
  return result;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      deepFreeze(nested);
    }
    Object.freeze(value);
  }
  return value;
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function withinCodePointLimit(value: string, maximum: number): boolean {
  let count = 0;
  for (const codePoint of value) {
    if (codePoint.length === 0) continue;
    count += 1;
    if (count > maximum) return false;
  }
  return true;
}

function hasControl(value: string): boolean {
  if (UNSAFE_UNICODE_FORMAT_PATTERN.test(value)) return true;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

function safeText(value: unknown, maximumCodePoints: number, maximumBytes: number): string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > maximumCodePoints * 2
    || value.trim() !== value
    || value.normalize('NFC') !== value
    || hasUnpairedSurrogate(value)
    || hasControl(value)
    || !withinCodePointLimit(value, maximumCodePoints)
    || TEXT_ENCODER.encode(value).byteLength > maximumBytes
  ) throw unavailable();
  return value;
}

function safeProjectId(value: unknown): string {
  if (typeof value !== 'string' || !PROJECT_ID_PATTERN.test(value)) throw unavailable();
  return value;
}

function safeDigest(value: unknown): string {
  if (typeof value !== 'string' || !DIGEST_PATTERN.test(value)) throw unavailable();
  return value;
}

function nullableDigest(value: unknown): string | null {
  return value === null ? null : safeDigest(value);
}

function safeOid(value: unknown): string;
function safeOid(value: unknown, nullable: true): string | null;
function safeOid(value: unknown, nullable = false): string | null {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || !OID_PATTERN.test(value)) throw unavailable();
  return value;
}

function safePositiveInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw unavailable();
  return Number(value);
}

function safeNonNegativeInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw unavailable();
  return Number(value);
}

function sanitizeCurrent(value: unknown): BuilderProjectHistoryCurrentEvidence {
  const source = exactRecord(value, CURRENT_KEYS);
  if (source.object_format !== 'sha1') throw unavailable();
  return {
    project_id: safeProjectId(source.project_id),
    title: safeText(source.title, 80, 1024),
    summary: safeText(source.summary, 400, 4096),
    revision_number: safePositiveInteger(source.revision_number),
    revision_receipt_digest: safeDigest(source.revision_receipt_digest),
    object_format: 'sha1',
    commit_oid: safeOid(source.commit_oid),
    tree_oid: safeOid(source.tree_oid),
    parent_oid: safeOid(source.parent_oid, true),
  };
}

function sanitizeRevision(value: unknown): BuilderProjectHistoryRevisionEvidence {
  const source = exactRecord(value, REVISION_KEYS);
  if (typeof source.is_current !== 'boolean') throw unavailable();
  const revision = {
    project_id: safeProjectId(source.project_id),
    title: safeText(source.title, 80, 1024),
    summary: safeText(source.summary, 400, 4096),
    revision_number: safePositiveInteger(source.revision_number),
    revision_receipt_digest: safeDigest(source.revision_receipt_digest),
    previous_revision_receipt_digest: nullableDigest(source.previous_revision_receipt_digest),
    commit_oid: safeOid(source.commit_oid),
    tree_oid: safeOid(source.tree_oid),
    parent_oid: safeOid(source.parent_oid, true),
    selected_at_ms: safeNonNegativeInteger(source.selected_at_ms),
    is_current: source.is_current,
  };
  const isGenesis = revision.revision_number === 1;
  const hasReceiptParent = revision.previous_revision_receipt_digest !== null;
  const hasGitParent = revision.parent_oid !== null;
  if (
    (isGenesis && (hasReceiptParent || hasGitParent))
    || (!isGenesis && (!hasReceiptParent || !hasGitParent))
  ) throw unavailable();
  return revision;
}

function sanitizeAuthorityEvidence(value: unknown): BuilderProjectHistoryResult['authority_evidence'] {
  const source = exactRecord(value, AUTHORITY_EVIDENCE_KEYS);
  if (
    source.product_authority !== 'sqlite_product_revision_receipt'
    || source.code_authority !== 'git_commit_tree'
    || source.source_read_admission !== 'verified'
    || source.current_selection !== 'sqlite_current_project_revision'
    || source.history_selection !== 'sqlite_project_revision_receipts'
  ) throw unavailable();
  return {
    product_authority: 'sqlite_product_revision_receipt',
    code_authority: 'git_commit_tree',
    source_read_admission: 'verified',
    current_selection: 'sqlite_current_project_revision',
    history_selection: 'sqlite_project_revision_receipts',
  };
}

function publicCurrent(current: BuilderProjectHistoryCurrentEvidence): BuilderProjectHistoryCurrent {
  return {
    project_id: current.project_id,
    title: current.title,
    summary: current.summary,
    revision_number: current.revision_number,
    revision_receipt_digest: current.revision_receipt_digest,
  };
}

function publicRevision(
  revision: BuilderProjectHistoryRevisionEvidence,
): BuilderProjectHistoryRevision {
  return {
    project_id: revision.project_id,
    title: revision.title,
    summary: revision.summary,
    revision_number: revision.revision_number,
    revision_receipt_digest: revision.revision_receipt_digest,
    previous_revision_receipt_digest: revision.previous_revision_receipt_digest,
    selected_at_ms: revision.selected_at_ms,
    is_current: revision.is_current,
  };
}

function assertCurrentMatchesFirstRevision(
  current: BuilderProjectHistoryCurrentEvidence,
  first: BuilderProjectHistoryRevisionEvidence,
  projectId: string,
): void {
  if (
    current.project_id !== projectId
    || first.project_id !== projectId
    || current.title !== first.title
    || current.summary !== first.summary
    || current.revision_number !== first.revision_number
    || current.revision_receipt_digest !== first.revision_receipt_digest
    || current.commit_oid !== first.commit_oid
    || current.tree_oid !== first.tree_oid
    || current.parent_oid !== first.parent_oid
    || first.is_current !== true
  ) throw unavailable();
}

function assertRevisionChain(
  revisions: readonly BuilderProjectHistoryRevisionEvidence[],
  projectId: string,
): void {
  const seen = new Set<string>();
  for (let index = 0; index < revisions.length; index += 1) {
    const revision = revisions[index];
    if (
      revision.project_id !== projectId
      || seen.has(revision.revision_receipt_digest)
      || revision.is_current !== (index === 0)
    ) throw unavailable();
    seen.add(revision.revision_receipt_digest);
    if (index === 0) continue;
    const newer = revisions[index - 1];
    if (
      revision.revision_number !== newer.revision_number - 1
      || newer.previous_revision_receipt_digest !== revision.revision_receipt_digest
      || newer.parent_oid !== revision.commit_oid
    ) throw unavailable();
  }
}

export function sanitizeBuilderProjectHistoryResult(
  value: unknown,
): BuilderProjectHistoryResult {
  try {
    const source = exactRecord(value, RESULT_KEYS);
    if (
      source.result_version !== BUILDER_PROJECT_READ_RESULT_VERSION
      || source.operation !== 'history_listed'
    ) throw unavailable();
    const projectId = safeProjectId(source.project_id);
    const current = sanitizeCurrent(source.current);
    const revisions = denseArray(source.revisions).map(sanitizeRevision);
    const authorityEvidence = sanitizeAuthorityEvidence(source.authority_evidence);
    assertCurrentMatchesFirstRevision(current, revisions[0], projectId);
    assertRevisionChain(revisions, projectId);
    return deepFreeze({
      result_version: BUILDER_PROJECT_READ_RESULT_VERSION,
      operation: 'history_listed',
      project_id: projectId,
      current: publicCurrent(current),
      revisions: revisions.map(publicRevision),
      authority_evidence: authorityEvidence,
    });
  } catch (error) {
    if (error instanceof BuilderProjectHistoryError) throw error;
    throw unavailable();
  }
}
