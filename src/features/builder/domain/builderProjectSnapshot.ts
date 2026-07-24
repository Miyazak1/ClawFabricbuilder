export const BUILDER_PROJECT_READ_RESULT_VERSION = 'builder-project-read-result.v1' as const;
export const BUILDER_PRODUCT_METADATA_RESULT_VERSION = 'builder-product-metadata-result.v2' as const;
export const BUILDER_PRODUCT_METADATA_SCHEMA_VERSION = 'builder-product-metadata-schema.v2' as const;
export const BUILDER_PRODUCT_METADATA_USER_VERSION = 2 as const;
export const BUILDER_GIT_PROJECT_REPOSITORY_VERSION = 'builder-git-project-repository.v1' as const;
export const BUILDER_GIT_CANDIDATE_RECEIPT_VERSION = 'builder-git-candidate-receipt.v1' as const;
export const BUILDER_GIT_CANDIDATE_VERIFICATION_RECEIPT_VERSION =
  'builder-git-candidate-verification-receipt.v1' as const;
export const BUILDER_PROJECT_SOURCE_TREE_VERSION = 'builder-project-source-tree.v1' as const;
export const BUILDER_PROJECT_SOURCE_ENTRY_KIND = 'text_file' as const;

export type BuilderProjectReadOperation = 'current_loaded' | 'revision_loaded';

export type BuilderProjectSourceFile = Readonly<{
  path: string;
  entry_kind: typeof BUILDER_PROJECT_SOURCE_ENTRY_KIND;
  content: string;
  content_digest: string;
}>;

export type BuilderProjectSourceTree = Readonly<{
  source_tree_version: typeof BUILDER_PROJECT_SOURCE_TREE_VERSION;
  files: readonly BuilderProjectSourceFile[];
  source_tree_digest: string;
}>;

export type BuilderProductRevisionReceipt = Readonly<{
  project_id: string;
  revision_receipt_digest: string;
  revision_number: number;
  previous_revision_receipt_digest: string | null;
  title: string;
  summary: string;
  conversation_id: string;
  turn_id: string;
  request_id: string;
  object_format: 'sha1';
  commit_oid: string;
  tree_oid: string;
  parent_oid: string | null;
  candidate_id: string;
  candidate_digest: string;
  resulting_tree_digest: string;
  semantic_identity_digest: string;
  verification_receipt_digest: string;
  task_id: string;
  run_id: string;
  review_id: string;
  selected_at_ms: number;
}>;

export type BuilderProjectCurrentSummary = Readonly<{
  project_id: string;
  title: string;
  summary: string;
  revision_receipt_digest: string;
  revision_number: number;
  object_format: 'sha1';
  commit_oid: string;
  tree_oid: string;
  parent_oid: string | null;
}>;

export type BuilderGitCandidateReceipt = Readonly<{
  receipt_version: typeof BUILDER_GIT_CANDIDATE_RECEIPT_VERSION;
  repository_version: typeof BUILDER_GIT_PROJECT_REPOSITORY_VERSION;
  project_id: string;
  conversation_id: string;
  turn_id: string;
  task_id: string;
  run_id: string;
  request_id: string;
  candidate_id: string;
  candidate_digest: string;
  resulting_tree_digest: string;
  semantic_identity_digest: string;
  verification_receipt_digest: string;
  object_format: 'sha1';
  commit_oid: string;
  tree_oid: string;
  parent_oid: string | null;
  expected_base_oid: string | null;
  code_authority: 'git_commit_candidate';
  product_revision_admission: 'not_recorded';
  replay: boolean;
}>;

export type BuilderGitCandidateVerificationReceipt = Readonly<{
  receipt_version: typeof BUILDER_GIT_CANDIDATE_VERIFICATION_RECEIPT_VERSION;
  repository_version: typeof BUILDER_GIT_PROJECT_REPOSITORY_VERSION;
  project_id: string;
  conversation_id: string;
  turn_id: string;
  task_id: string;
  run_id: string;
  request_id: string;
  candidate_id: string;
  candidate_digest: string;
  expected_base_oid: string | null;
  commit_oid: string;
  candidate_tree_oid: string;
  resulting_tree_digest: string;
  semantic_identity_digest: string;
  object_format: 'sha1';
  commit_ref_admission: 'verified';
  request_ref_admission: 'verified';
  commit_object_admission: 'verified';
  verification_admission: 'accepted';
}>;

export type BuilderProjectReadSnapshot = Readonly<{
  result_version: typeof BUILDER_PROJECT_READ_RESULT_VERSION;
  operation: BuilderProjectReadOperation;
  target: BuilderProductRevisionReceipt;
  latestCurrent: BuilderProjectCurrentSummary;
  source_tree: BuilderProjectSourceTree;
  git_candidate_receipt: BuilderGitCandidateReceipt;
  git_verification_receipt: BuilderGitCandidateVerificationReceipt;
  authority_evidence: Readonly<{
    product_authority: 'sqlite_product_revision_receipt';
    code_authority: 'git_commit_tree';
    source_read_admission: 'verified';
    current_selection: 'sqlite_current_project_revision';
  }>;
}>;

export class BuilderProjectSnapshotError extends Error {
  readonly code = 'builder_project_snapshot_invalid';

  constructor() {
    super('The Builder project snapshot could not be verified.');
    this.name = 'BuilderProjectSnapshotError';
  }
}

const TEXT_ENCODER = new TextEncoder();
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const OID_PATTERN = /^[0-9a-f]{40}$/u;
const PROJECT_ID_PATTERN =
  /^builder-project:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const BUILDER_ID_PATTERNS = Object.freeze({
  conversation_id: /^builder-conversation:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
  turn_id: /^builder-turn:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
  task_id: /^builder-task:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
  run_id: /^builder-run:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
  request_id: /^builder-git-request:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
  candidate_id: /^builder-code-change-candidate:[0-9a-f]{64}$/u,
  review_id: /^builder-review:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
});
const RESULT_KEYS = Object.freeze([
  'result_version',
  'product_revision_receipt',
  'current',
  'source_tree',
  'git_candidate_receipt',
  'git_verification_receipt',
  'authority_evidence',
  'operation',
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
const PRODUCT_RECEIPT_KEYS = Object.freeze([
  'project_id',
  'revision_receipt_digest',
  'revision_number',
  'previous_revision_receipt_digest',
  'title',
  'summary',
  'conversation_id',
  'turn_id',
  'request_id',
  'object_format',
  'commit_oid',
  'tree_oid',
  'parent_oid',
  'candidate_id',
  'candidate_digest',
  'resulting_tree_digest',
  'semantic_identity_digest',
  'verification_receipt_digest',
  'task_id',
  'run_id',
  'review_id',
  'selected_at_ms',
]);
const CANDIDATE_RECEIPT_KEYS = Object.freeze([
  'receipt_version',
  'repository_version',
  'project_id',
  'conversation_id',
  'turn_id',
  'task_id',
  'run_id',
  'request_id',
  'candidate_id',
  'candidate_digest',
  'resulting_tree_digest',
  'semantic_identity_digest',
  'verification_receipt_digest',
  'object_format',
  'commit_oid',
  'tree_oid',
  'parent_oid',
  'expected_base_oid',
  'code_authority',
  'product_revision_admission',
  'replay',
]);
const VERIFICATION_RECEIPT_KEYS = Object.freeze([
  'receipt_version',
  'repository_version',
  'project_id',
  'conversation_id',
  'turn_id',
  'task_id',
  'run_id',
  'request_id',
  'candidate_id',
  'candidate_digest',
  'expected_base_oid',
  'commit_oid',
  'candidate_tree_oid',
  'resulting_tree_digest',
  'semantic_identity_digest',
  'object_format',
  'commit_ref_admission',
  'request_ref_admission',
  'commit_object_admission',
  'verification_admission',
]);
const SOURCE_TREE_KEYS = Object.freeze(['source_tree_version', 'files', 'source_tree_digest']);
const SOURCE_ENTRY_KEYS = Object.freeze(['path', 'entry_kind', 'content', 'content_digest']);
const AUTHORITY_EVIDENCE_KEYS = Object.freeze([
  'product_authority',
  'code_authority',
  'source_read_admission',
  'current_selection',
]);
const MAX_SOURCE_FILES = 512;
const MAX_SOURCE_PATH_CODE_POINTS = 240;
const MAX_SOURCE_PATH_UTF8_BYTES = 1024;
const MAX_SOURCE_PATH_SEGMENT_CODE_POINTS = 120;
const MAX_SOURCE_FILE_UTF8_BYTES = 512 * 1024;
const MAX_SOURCE_TREE_UTF8_BYTES = 4 * 1024 * 1024;
const WINDOWS_INVALID_PATH_CHARACTER_PATTERN = /[<>:"|?*]/u;
const WINDOWS_RESERVED_NAMES = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
]);

function invalid(): BuilderProjectSnapshotError {
  return new BuilderProjectSnapshotError();
}

function utf8Size(value: string): number {
  return TEXT_ENCODER.encode(value).byteLength;
}

function hasControlCharacter(value: string, allowFormatting = false): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0x7f && code <= 0x9f) return true;
    if (code <= 0x1f && (!allowFormatting || ![0x09, 0x0a, 0x0d].includes(code))) return true;
  }
  return false;
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

function withinCodePointLimit(value: string, maximum: number): boolean {
  return value.length <= maximum * 2 && Array.from(value).length <= maximum;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!isPlainObject(value)) throw invalid();
  const actual = Reflect.ownKeys(value);
  if (actual.length !== keys.length || actual.some((key) => typeof key !== 'string' || !keys.includes(key))) {
    throw invalid();
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const output: Record<string, unknown> = {};
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw invalid();
    output[key] = descriptor.value;
  }
  return output;
}

function denseArray(value: unknown, maximum: number): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum) {
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
  return value as unknown[];
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

function safeProjectId(value: unknown): string {
  if (typeof value !== 'string' || value.length > 80 || !PROJECT_ID_PATTERN.test(value)) throw invalid();
  return value;
}

function safeBuilderId(value: unknown, key: keyof typeof BUILDER_ID_PATTERNS): string {
  if (typeof value !== 'string' || !BUILDER_ID_PATTERNS[key].test(value)) throw invalid();
  return value;
}

function safeDigest(value: unknown): string {
  if (typeof value !== 'string' || value.length !== 71 || !DIGEST_PATTERN.test(value)) throw invalid();
  return value;
}

function safeOid(value: unknown): string;
function safeOid(value: unknown, nullable: true): string | null;
function safeOid(value: unknown, nullable = false): string | null {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || !OID_PATTERN.test(value)) throw invalid();
  return value;
}

function safeText(value: unknown, maximum: number): string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > maximum
    || value.trim() !== value
    || hasControlCharacter(value)
  ) throw invalid();
  return value;
}

function safeInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw invalid();
  return Number(value);
}

function safePositiveInteger(value: unknown, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > maximum) throw invalid();
  return Number(value);
}

function safeSourcePath(value: unknown): string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > MAX_SOURCE_PATH_CODE_POINTS * 2
    || value.normalize('NFC') !== value
    || hasUnpairedSurrogate(value)
    || hasControlCharacter(value)
    || !withinCodePointLimit(value, MAX_SOURCE_PATH_CODE_POINTS)
    || utf8Size(value) > MAX_SOURCE_PATH_UTF8_BYTES
    || value.startsWith('/')
    || value.endsWith('/')
    || value.includes('\\')
    || /^[A-Za-z]:/u.test(value)
    || value.startsWith('//')
  ) throw invalid();
  for (const segment of value.split('/')) {
    if (
      segment.length === 0
      || segment === '.'
      || segment === '..'
      || segment.endsWith('.')
      || segment.endsWith(' ')
      || WINDOWS_INVALID_PATH_CHARACTER_PATTERN.test(segment)
      || !withinCodePointLimit(segment, MAX_SOURCE_PATH_SEGMENT_CODE_POINTS)
    ) throw invalid();
    if (WINDOWS_RESERVED_NAMES.has(segment.split('.')[0].normalize('NFKC').toLowerCase())) throw invalid();
  }
  return value;
}

function safeSourceContent(value: unknown): string {
  if (
    typeof value !== 'string'
    || value.length > MAX_SOURCE_FILE_UTF8_BYTES
    || hasUnpairedSurrogate(value)
    || hasControlCharacter(value, true)
    || utf8Size(value) > MAX_SOURCE_FILE_UTF8_BYTES
  ) throw invalid();
  return value;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(Object.getOwnPropertyDescriptor(value, key)?.value)}`
    )).join(',')}}`;
  }
  throw invalid();
}

async function sha256Canonical(value: unknown): Promise<string> {
  try {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', TEXT_ENCODER.encode(canonicalJson(value)));
    return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
  } catch (error) {
    if (error instanceof BuilderProjectSnapshotError) throw error;
    throw invalid();
  }
}

async function sanitizeSourceEntry(value: unknown): Promise<BuilderProjectSourceFile> {
  const source = exactRecord(value, SOURCE_ENTRY_KEYS);
  if (source.entry_kind !== BUILDER_PROJECT_SOURCE_ENTRY_KIND) throw invalid();
  const entry = {
    path: safeSourcePath(source.path),
    entry_kind: BUILDER_PROJECT_SOURCE_ENTRY_KIND,
    content: safeSourceContent(source.content),
  };
  const contentDigest = safeDigest(source.content_digest);
  if (await sha256Canonical(entry) !== contentDigest) throw invalid();
  return deepFreeze({ ...entry, content_digest: contentDigest });
}

async function sanitizeSourceTree(value: unknown): Promise<BuilderProjectSourceTree> {
  const source = exactRecord(value, SOURCE_TREE_KEYS);
  if (source.source_tree_version !== BUILDER_PROJECT_SOURCE_TREE_VERSION) throw invalid();
  const rawFiles = denseArray(source.files, MAX_SOURCE_FILES);
  const files: BuilderProjectSourceFile[] = [];
  let totalBytes = 0;
  for (const rawFile of rawFiles) {
    const file = await sanitizeSourceEntry(rawFile);
    totalBytes += utf8Size(file.content);
    if (totalBytes > MAX_SOURCE_TREE_UTF8_BYTES) throw invalid();
    files.push(file);
  }
  for (let index = 1; index < files.length; index += 1) {
    if (files[index - 1].path >= files[index].path) throw invalid();
    if (files[index - 1].path.normalize('NFKC').toUpperCase() >= files[index].path.normalize('NFKC').toUpperCase()) {
      throw invalid();
    }
  }
  const unsigned = {
    files,
    source_tree_version: BUILDER_PROJECT_SOURCE_TREE_VERSION,
  };
  const digest = safeDigest(source.source_tree_digest);
  if (await sha256Canonical(unsigned) !== digest) throw invalid();
  return deepFreeze({
    source_tree_version: BUILDER_PROJECT_SOURCE_TREE_VERSION,
    files,
    source_tree_digest: digest,
  });
}

export async function sanitizeBuilderProjectSourceTree(
  value: unknown,
): Promise<BuilderProjectSourceTree> {
  try {
    return await sanitizeSourceTree(value);
  } catch (error) {
    if (error instanceof BuilderProjectSnapshotError) throw error;
    throw invalid();
  }
}

async function sanitizeProductReceipt(value: unknown): Promise<BuilderProductRevisionReceipt> {
  const source = exactRecord(value, PRODUCT_RECEIPT_KEYS);
  const receipt = deepFreeze({
    candidate_digest: safeDigest(source.candidate_digest),
    candidate_id: safeBuilderId(source.candidate_id, 'candidate_id'),
    commit_oid: safeOid(source.commit_oid),
    conversation_id: safeBuilderId(source.conversation_id, 'conversation_id'),
    object_format: 'sha1' as const,
    parent_oid: safeOid(source.parent_oid, true),
    previous_revision_receipt_digest: source.previous_revision_receipt_digest === null
      ? null
      : safeDigest(source.previous_revision_receipt_digest),
    project_id: safeProjectId(source.project_id),
    request_id: safeBuilderId(source.request_id, 'request_id'),
    resulting_tree_digest: safeDigest(source.resulting_tree_digest),
    review_id: safeBuilderId(source.review_id, 'review_id'),
    revision_number: safePositiveInteger(source.revision_number),
    run_id: safeBuilderId(source.run_id, 'run_id'),
    selected_at_ms: safeInteger(source.selected_at_ms),
    semantic_identity_digest: safeDigest(source.semantic_identity_digest),
    summary: safeText(source.summary, 400),
    task_id: safeBuilderId(source.task_id, 'task_id'),
    title: safeText(source.title, 80),
    tree_oid: safeOid(source.tree_oid),
    turn_id: safeBuilderId(source.turn_id, 'turn_id'),
    verification_receipt_digest: safeDigest(source.verification_receipt_digest),
  });
  if (source.object_format !== 'sha1') throw invalid();
  if ((receipt.revision_number === 1) !== (receipt.previous_revision_receipt_digest === null)) throw invalid();
  const digest = safeDigest(source.revision_receipt_digest);
  if (await sha256Canonical(receipt) !== digest) throw invalid();
  return deepFreeze({ ...receipt, revision_receipt_digest: digest });
}

function sanitizeCurrent(value: unknown): BuilderProjectCurrentSummary {
  const source = exactRecord(value, CURRENT_KEYS);
  if (source.object_format !== 'sha1') throw invalid();
  return deepFreeze({
    project_id: safeProjectId(source.project_id),
    title: safeText(source.title, 80),
    summary: safeText(source.summary, 400),
    revision_receipt_digest: safeDigest(source.revision_receipt_digest),
    revision_number: safePositiveInteger(source.revision_number),
    object_format: 'sha1',
    commit_oid: safeOid(source.commit_oid),
    tree_oid: safeOid(source.tree_oid),
    parent_oid: safeOid(source.parent_oid, true),
  });
}

function sanitizeCandidateReceipt(value: unknown): BuilderGitCandidateReceipt {
  const source = exactRecord(value, CANDIDATE_RECEIPT_KEYS);
  if (
    source.receipt_version !== BUILDER_GIT_CANDIDATE_RECEIPT_VERSION
    || source.repository_version !== BUILDER_GIT_PROJECT_REPOSITORY_VERSION
    || source.object_format !== 'sha1'
    || source.code_authority !== 'git_commit_candidate'
    || source.product_revision_admission !== 'not_recorded'
    || typeof source.replay !== 'boolean'
  ) throw invalid();
  return deepFreeze({
    receipt_version: BUILDER_GIT_CANDIDATE_RECEIPT_VERSION,
    repository_version: BUILDER_GIT_PROJECT_REPOSITORY_VERSION,
    project_id: safeProjectId(source.project_id),
    conversation_id: safeBuilderId(source.conversation_id, 'conversation_id'),
    turn_id: safeBuilderId(source.turn_id, 'turn_id'),
    task_id: safeBuilderId(source.task_id, 'task_id'),
    run_id: safeBuilderId(source.run_id, 'run_id'),
    request_id: safeBuilderId(source.request_id, 'request_id'),
    candidate_id: safeBuilderId(source.candidate_id, 'candidate_id'),
    candidate_digest: safeDigest(source.candidate_digest),
    resulting_tree_digest: safeDigest(source.resulting_tree_digest),
    semantic_identity_digest: safeDigest(source.semantic_identity_digest),
    verification_receipt_digest: safeDigest(source.verification_receipt_digest),
    object_format: 'sha1',
    commit_oid: safeOid(source.commit_oid),
    tree_oid: safeOid(source.tree_oid),
    parent_oid: safeOid(source.parent_oid, true),
    expected_base_oid: safeOid(source.expected_base_oid, true),
    code_authority: 'git_commit_candidate',
    product_revision_admission: 'not_recorded',
    replay: source.replay,
  });
}

function sanitizeVerificationReceipt(value: unknown): BuilderGitCandidateVerificationReceipt {
  const source = exactRecord(value, VERIFICATION_RECEIPT_KEYS);
  if (
    source.receipt_version !== BUILDER_GIT_CANDIDATE_VERIFICATION_RECEIPT_VERSION
    || source.repository_version !== BUILDER_GIT_PROJECT_REPOSITORY_VERSION
    || source.object_format !== 'sha1'
    || source.commit_ref_admission !== 'verified'
    || source.request_ref_admission !== 'verified'
    || source.commit_object_admission !== 'verified'
    || source.verification_admission !== 'accepted'
  ) throw invalid();
  return deepFreeze({
    receipt_version: BUILDER_GIT_CANDIDATE_VERIFICATION_RECEIPT_VERSION,
    repository_version: BUILDER_GIT_PROJECT_REPOSITORY_VERSION,
    project_id: safeProjectId(source.project_id),
    conversation_id: safeBuilderId(source.conversation_id, 'conversation_id'),
    turn_id: safeBuilderId(source.turn_id, 'turn_id'),
    task_id: safeBuilderId(source.task_id, 'task_id'),
    run_id: safeBuilderId(source.run_id, 'run_id'),
    request_id: safeBuilderId(source.request_id, 'request_id'),
    candidate_id: safeBuilderId(source.candidate_id, 'candidate_id'),
    candidate_digest: safeDigest(source.candidate_digest),
    expected_base_oid: safeOid(source.expected_base_oid, true),
    commit_oid: safeOid(source.commit_oid),
    candidate_tree_oid: safeOid(source.candidate_tree_oid),
    resulting_tree_digest: safeDigest(source.resulting_tree_digest),
    semantic_identity_digest: safeDigest(source.semantic_identity_digest),
    object_format: 'sha1',
    commit_ref_admission: 'verified',
    request_ref_admission: 'verified',
    commit_object_admission: 'verified',
    verification_admission: 'accepted',
  });
}

async function assertCandidatePair(
  candidate: BuilderGitCandidateReceipt,
  verification: BuilderGitCandidateVerificationReceipt,
): Promise<void> {
  if (
    candidate.project_id !== verification.project_id
    || candidate.conversation_id !== verification.conversation_id
    || candidate.turn_id !== verification.turn_id
    || candidate.task_id !== verification.task_id
    || candidate.run_id !== verification.run_id
    || candidate.request_id !== verification.request_id
    || candidate.candidate_id !== verification.candidate_id
    || candidate.candidate_digest !== verification.candidate_digest
    || candidate.expected_base_oid !== verification.expected_base_oid
    || candidate.parent_oid !== verification.expected_base_oid
    || candidate.commit_oid !== verification.commit_oid
    || candidate.tree_oid !== verification.candidate_tree_oid
    || candidate.resulting_tree_digest !== verification.resulting_tree_digest
    || candidate.semantic_identity_digest !== verification.semantic_identity_digest
    || candidate.object_format !== verification.object_format
    || candidate.verification_receipt_digest !== await sha256Canonical(verification)
  ) throw invalid();
}

function sanitizeAuthorityEvidence(value: unknown): BuilderProjectReadSnapshot['authority_evidence'] {
  const source = exactRecord(value, AUTHORITY_EVIDENCE_KEYS);
  if (
    source.product_authority !== 'sqlite_product_revision_receipt'
    || source.code_authority !== 'git_commit_tree'
    || source.source_read_admission !== 'verified'
    || source.current_selection !== 'sqlite_current_project_revision'
  ) throw invalid();
  return deepFreeze({
    product_authority: 'sqlite_product_revision_receipt',
    code_authority: 'git_commit_tree',
    source_read_admission: 'verified',
    current_selection: 'sqlite_current_project_revision',
  });
}

function assertCurrentMatchesReceipt(current: BuilderProjectCurrentSummary, receipt: BuilderProductRevisionReceipt): void {
  if (
    current.project_id !== receipt.project_id
    || current.title !== receipt.title
    || current.summary !== receipt.summary
    || current.revision_receipt_digest !== receipt.revision_receipt_digest
    || current.revision_number !== receipt.revision_number
    || current.object_format !== receipt.object_format
    || current.commit_oid !== receipt.commit_oid
    || current.tree_oid !== receipt.tree_oid
    || current.parent_oid !== receipt.parent_oid
  ) throw invalid();
}

function assertReceiptMatchesGit(
  receipt: BuilderProductRevisionReceipt,
  candidate: BuilderGitCandidateReceipt,
  verification: BuilderGitCandidateVerificationReceipt,
  sourceTree: BuilderProjectSourceTree,
): void {
  if (
    receipt.project_id !== candidate.project_id
    || receipt.project_id !== verification.project_id
    || receipt.conversation_id !== candidate.conversation_id
    || receipt.conversation_id !== verification.conversation_id
    || receipt.turn_id !== candidate.turn_id
    || receipt.turn_id !== verification.turn_id
    || receipt.task_id !== candidate.task_id
    || receipt.task_id !== verification.task_id
    || receipt.run_id !== candidate.run_id
    || receipt.run_id !== verification.run_id
    || receipt.request_id !== candidate.request_id
    || receipt.request_id !== verification.request_id
    || receipt.candidate_id !== candidate.candidate_id
    || receipt.candidate_id !== verification.candidate_id
    || receipt.candidate_digest !== candidate.candidate_digest
    || receipt.candidate_digest !== verification.candidate_digest
    || receipt.resulting_tree_digest !== candidate.resulting_tree_digest
    || receipt.resulting_tree_digest !== verification.resulting_tree_digest
    || receipt.resulting_tree_digest !== sourceTree.source_tree_digest
    || receipt.semantic_identity_digest !== candidate.semantic_identity_digest
    || receipt.semantic_identity_digest !== verification.semantic_identity_digest
    || receipt.verification_receipt_digest !== candidate.verification_receipt_digest
    || receipt.object_format !== candidate.object_format
    || receipt.object_format !== verification.object_format
    || receipt.commit_oid !== candidate.commit_oid
    || receipt.commit_oid !== verification.commit_oid
    || receipt.tree_oid !== candidate.tree_oid
    || receipt.tree_oid !== verification.candidate_tree_oid
    || receipt.parent_oid !== candidate.parent_oid
    || receipt.parent_oid !== verification.expected_base_oid
  ) throw invalid();
}

export async function sanitizeBuilderProjectReadSnapshot(value: unknown): Promise<BuilderProjectReadSnapshot> {
  try {
    const source = exactRecord(value, RESULT_KEYS);
    if (source.result_version !== BUILDER_PROJECT_READ_RESULT_VERSION) throw invalid();
    const operation = source.operation;
    if (operation !== 'current_loaded' && operation !== 'revision_loaded') throw invalid();
    const target = await sanitizeProductReceipt(source.product_revision_receipt);
    const latestCurrent = sanitizeCurrent(source.current);
    const sourceTree = await sanitizeSourceTree(source.source_tree);
    const candidate = sanitizeCandidateReceipt(source.git_candidate_receipt);
    const verification = sanitizeVerificationReceipt(source.git_verification_receipt);
    const authorityEvidence = sanitizeAuthorityEvidence(source.authority_evidence);
    await assertCandidatePair(candidate, verification);
    assertReceiptMatchesGit(target, candidate, verification, sourceTree);
    if (latestCurrent.project_id !== target.project_id) throw invalid();
    if (operation === 'current_loaded') assertCurrentMatchesReceipt(latestCurrent, target);
    return deepFreeze({
      result_version: BUILDER_PROJECT_READ_RESULT_VERSION,
      operation,
      target,
      latestCurrent,
      source_tree: sourceTree,
      git_candidate_receipt: candidate,
      git_verification_receipt: verification,
      authority_evidence: authorityEvidence,
    });
  } catch (error) {
    if (error instanceof BuilderProjectSnapshotError) throw error;
    throw invalid();
  }
}
