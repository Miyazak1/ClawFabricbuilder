export const BUILDER_PROJECT_PROPOSAL_KIND = 'builder_code_project' as const;
export const BUILDER_CODE_GENERATOR_AUTHORITY = 'builder_code_project_generator' as const;
export const BUILDER_CODE_PROJECT_PROMPT_VERSION = 'builder-code-project.v1' as const;
export const BUILDER_GENERATION_REQUEST_PROTOCOL = 'builder-generation-request.v1' as const;
export const BUILDER_GENERATION_RESULT_PROTOCOL = 'builder-generation-result.v1' as const;
export const BUILDER_PROJECT_RECORD_KIND = 'builder_project_revision' as const;
export const BUILDER_PROJECT_SCHEMA_VERSION = 1 as const;

export const BUILDER_PROJECT_TOTAL_MAX_UTF8_BYTES = 512 * 1024;
export const BUILDER_PROJECT_HTML_MAX_UTF8_BYTES = 256 * 1024;
export const BUILDER_PROJECT_CSS_MAX_UTF8_BYTES = 128 * 1024;
export const BUILDER_PROJECT_JS_MAX_UTF8_BYTES = 128 * 1024;

const TRUSTED_BUILDER_PROJECT_REVISIONS = new WeakSet<object>();

export type BuilderProjectFiles = {
  'index.html': string;
  'styles.css': string;
  'app.js': string;
};

export type BuilderProjectProposal = {
  kind: typeof BUILDER_PROJECT_PROPOSAL_KIND;
  title: string;
  summary: string;
  files: BuilderProjectFiles;
};

export type BuilderProjectParentRevision = {
  revision: number;
  revision_digest: string;
};

export type BuilderProjectProposalEvidence = {
  authority: typeof BUILDER_CODE_GENERATOR_AUTHORITY;
  prompt_version: typeof BUILDER_CODE_PROJECT_PROMPT_VERSION;
  request_version: typeof BUILDER_GENERATION_REQUEST_PROTOCOL;
  result_version: typeof BUILDER_GENERATION_RESULT_PROTOCOL;
  request_digest: string;
  proposal_digest: string;
  project_id: string;
  target_revision: number;
  parent_revision: BuilderProjectParentRevision | null;
};

export type BuilderProjectRevision = {
  schema_version: typeof BUILDER_PROJECT_SCHEMA_VERSION;
  record_kind: typeof BUILDER_PROJECT_RECORD_KIND;
  project_id: string;
  revision: number;
  revision_digest: string;
  parent_revision: BuilderProjectParentRevision | null;
  title: string;
  summary: string;
  files: BuilderProjectFiles;
  proposal_evidence: BuilderProjectProposalEvidence;
  execution_admission: 'not_evaluated';
  preview_script_admission: 'not_authorized';
};

export type CreateBuilderProjectRevisionInput = {
  projectId: unknown;
  proposal: unknown;
  proposalEvidence: unknown;
  requestDigest: unknown;
  parent?: unknown;
};

export function isTrustedBuilderProjectRevision(
  value: unknown,
): value is BuilderProjectRevision {
  return value !== null
    && typeof value === 'object'
    && TRUSTED_BUILDER_PROJECT_REVISIONS.has(value);
}

export type BuilderProjectErrorCode =
  | 'invalid_project_identity'
  | 'invalid_generated_project'
  | 'unsafe_generated_project'
  | 'invalid_project_version';

export class BuilderProjectError extends Error {
  readonly code: BuilderProjectErrorCode;

  constructor(code: BuilderProjectErrorCode) {
    const messages: Record<BuilderProjectErrorCode, string> = {
      invalid_project_identity: 'The local project could not be identified.',
      invalid_generated_project: 'The generated project could not be used.',
      unsafe_generated_project: 'The generated project contains content that cannot be saved safely.',
      invalid_project_version: 'The local project version could not be verified.',
    };
    super(messages[code]);
    this.name = 'BuilderProjectError';
    this.code = code;
  }
}

const PROPOSAL_KEYS = new Set(['kind', 'title', 'summary', 'files']);
const FILE_KEYS = new Set(['index.html', 'styles.css', 'app.js']);
const EVIDENCE_KEYS = new Set([
  'authority',
  'prompt_version',
  'request_version',
  'result_version',
  'request_digest',
  'proposal_digest',
  'project_id',
  'target_revision',
  'parent_revision',
]);
const PARENT_KEYS = new Set(['revision', 'revision_digest']);
const REVISION_KEYS = new Set([
  'schema_version',
  'record_kind',
  'project_id',
  'revision',
  'revision_digest',
  'parent_revision',
  'title',
  'summary',
  'files',
  'proposal_evidence',
  'execution_admission',
  'preview_script_admission',
]);
const PROJECT_ID_PATTERN = /^builder-project:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const FORBIDDEN_JAVASCRIPT_MODULE_PATTERN = /\b(?:import|export)\b/;
const LOCAL_PATH_PATTERN = /(?:file:\/{1,3}|\\\\|(?:^|[\s"'`=(,:])(?:[A-Za-z]:[\\/]|~[\\/]|\/(?!\/)[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*))/i;
const CREDENTIAL_ASSIGNMENT_PATTERN = /["'`]?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|password|secret|credential|client[_-]?secret|private[_-]?key|aws[_-]?secret[_-]?access[_-]?key)["'`]?\s*[:=]\s*(?!["'`]?\s*(?:null|undefined)\b)\S/i;
const AUTHORIZATION_BEARER_PATTERN = /["'`]?authorization["'`]?\s*[:=]\s*["'`]?bearer\s+[A-Za-z0-9._~+/-]{8,}/i;
const AUTHORIZATION_BASIC_PATTERN = /["'`]?authorization["'`]?\s*[:=]\s*["'`]?basic\s+[A-Za-z0-9+/=]{8,}/i;
const AUTHORIZATION_VALUE_PATTERN = /\b(?:basic|bearer)\s+[A-Za-z0-9._~+/=-]{16,}/i;
const PRIVATE_KEY_PATTERN = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;
const CREDENTIAL_URL_PATTERN = /https?:\/\/[^\s/:@]+:[^\s/@]+@/i;
const COMMON_SECRET_VALUE_PATTERN = /\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16})\b/;
const UNSAFE_CSS_PATTERN = /(?:@import\b|@font-face\b|url\s*\(|image-set\s*\(|expression\s*\(|behavior\s*:|-moz-binding\s*:|<\/style)/i;
const ACTIVE_HTML_ELEMENTS = new Set([
  'script',
  'iframe',
  'object',
  'embed',
  'base',
  'meta',
  'link',
  'form',
  'template',
]);
const URL_OR_NAVIGATION_ATTRIBUTE_NAMES = new Set([
  'action',
  'download',
  'formaction',
  'href',
  'ping',
  'poster',
  'src',
  'srcset',
  'target',
  'xlink:href',
]);
const UNSAFE_UNICODE_FORMAT_PATTERN = /[\p{Cf}\p{Bidi_Control}]/u;
const MAX_DATA_TREE_NODES = 64;
const MAX_DATA_TREE_DEPTH = 8;
const MAX_UNKNOWN_STRING_CODE_UNITS = BUILDER_PROJECT_TOTAL_MAX_UTF8_BYTES + 4096;

function projectError(code: BuilderProjectErrorCode): BuilderProjectError {
  return new BuilderProjectError(code);
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

function utf8Size(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function hasDisallowedControl(value: string, allowFormatting: boolean): boolean {
  if (UNSAFE_UNICODE_FORMAT_PATTERN.test(value)) return true;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0x7f && code <= 0x9f) return true;
    if (code <= 0x1f && (!allowFormatting || ![0x09, 0x0a, 0x0d].includes(code))) return true;
  }
  return false;
}

function withinCodePointLimit(value: string, maximum: number): boolean {
  if (value.length > maximum * 2) return false;
  return Array.from(value).length <= maximum;
}

function assertDataTree(
  value: unknown,
  seen = new WeakSet<object>(),
  depth = 0,
  budget = { remaining: MAX_DATA_TREE_NODES },
): void {
  if (typeof value === 'string') {
    if (value.length > MAX_UNKNOWN_STRING_CODE_UNITS) throw projectError('invalid_generated_project');
    return;
  }
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return;
  if (typeof value !== 'object') throw projectError('invalid_generated_project');
  budget.remaining -= 1;
  if (budget.remaining < 0 || depth > MAX_DATA_TREE_DEPTH) throw projectError('invalid_generated_project');
  if (seen.has(value)) throw projectError('invalid_generated_project');
  seen.add(value);

  const prototype = Object.getPrototypeOf(value);
  const keys = Reflect.ownKeys(value);
  budget.remaining -= keys.length;
  if (budget.remaining < 0) throw projectError('invalid_generated_project');
  if (Array.isArray(value)) {
    if (prototype !== Array.prototype) throw projectError('invalid_generated_project');
    if (
      keys.some((key) => typeof key === 'symbol')
      || keys.some((key) => key !== 'length' && !/^(?:0|[1-9][0-9]*)$/.test(String(key)))
      || keys.length !== value.length + 1
    ) {
      throw projectError('invalid_generated_project');
    }
  } else if (prototype !== Object.prototype && prototype !== null) {
    throw projectError('invalid_generated_project');
  }

  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key === 'symbol') throw projectError('invalid_generated_project');
    const descriptor = descriptors[key];
    if (!descriptor || 'get' in descriptor || 'set' in descriptor || !descriptor.enumerable) {
      if (key !== 'length') throw projectError('invalid_generated_project');
      continue;
    }
    assertDataTree(descriptor.value, seen, depth + 1, budget);
  }
}

function safeStructuredClone<T>(value: T): T {
  try {
    assertDataTree(value);
    return structuredClone(value);
  } catch (error) {
    if (error instanceof BuilderProjectError) throw error;
    throw projectError('invalid_generated_project');
  }
}

function asExactRecord(value: unknown, keys: ReadonlySet<string>, code: BuilderProjectErrorCode): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw projectError(code);
  let ownKeys: PropertyKey[];
  try {
    ownKeys = Reflect.ownKeys(value);
  } catch {
    throw projectError(code);
  }
  if (
    ownKeys.length !== keys.size
    || ownKeys.some((key) => typeof key !== 'string' || !keys.has(key))
  ) {
    throw projectError(code);
  }
  const cloned = safeStructuredClone(value);
  if (cloned === null || typeof cloned !== 'object' || Array.isArray(cloned)) throw projectError(code);
  return cloned as Record<string, unknown>;
}

function safeDisplayText(value: unknown, maximum: number): string {
  if (
    typeof value !== 'string'
    || !value
    || value.trim() !== value
    || !withinCodePointLimit(value, maximum)
    || value.normalize('NFC') !== value
    || hasUnpairedSurrogate(value)
    || hasDisallowedControl(value, false)
  ) {
    throw projectError('invalid_generated_project');
  }
  return value;
}

export function containsUnsafeBuilderProjectMaterial(value: string): boolean {
  const normalized = value.normalize('NFKC');
  return LOCAL_PATH_PATTERN.test(normalized)
    || CREDENTIAL_ASSIGNMENT_PATTERN.test(normalized)
    || AUTHORIZATION_BEARER_PATTERN.test(normalized)
    || AUTHORIZATION_BASIC_PATTERN.test(normalized)
    || AUTHORIZATION_VALUE_PATTERN.test(normalized)
    || PRIVATE_KEY_PATTERN.test(normalized)
    || CREDENTIAL_URL_PATTERN.test(normalized)
    || COMMON_SECRET_VALUE_PATTERN.test(normalized);
}

function safeCode(value: unknown, maximumBytes: number, allowEmpty: boolean): string {
  if (
    typeof value !== 'string'
    || value.length > maximumBytes
    || (!allowEmpty && !value.trim())
    || hasUnpairedSurrogate(value)
    || hasDisallowedControl(value, true)
    || utf8Size(value) > maximumBytes
  ) {
    throw projectError('invalid_generated_project');
  }
  if (containsUnsafeBuilderProjectMaterial(value)) throw projectError('unsafe_generated_project');
  return value;
}

function assertStaticHtml(value: string): void {
  let document: Document;
  try {
    document = new DOMParser().parseFromString(value, 'text/html');
  } catch {
    throw projectError('unsafe_generated_project');
  }
  for (const element of Array.from(document.querySelectorAll('*'))) {
    if (ACTIVE_HTML_ELEMENTS.has(element.localName.toLowerCase())) {
      throw projectError('unsafe_generated_project');
    }
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      if (
        name.startsWith('on')
        || name === 'srcdoc'
        || URL_OR_NAVIGATION_ATTRIBUTE_NAMES.has(name)
        || name.endsWith(':href')
        || (name === 'style' && unsafeCss(attribute.value))
      ) {
        throw projectError('unsafe_generated_project');
      }
    }
  }
  for (const style of Array.from(document.querySelectorAll('style'))) {
    if (unsafeCss(style.textContent ?? '')) throw projectError('unsafe_generated_project');
  }
}

function decodedCssForSafety(value: string): string {
  const withoutComments = value
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\\(?:\r\n|[\n\r\f])/g, '');
  return withoutComments
    .replace(/\\([0-9a-f]{1,6})(?:\r\n|[\t\n\f\r ])?/gi, (_match, hex: string) => {
      const codePoint = Number.parseInt(hex, 16);
      if (codePoint === 0 || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
        return '\ufffd';
      }
      return String.fromCodePoint(codePoint);
    })
    .replace(/\\([^0-9a-f\n\r\f])/gi, '$1');
}

function unsafeCss(value: string): boolean {
  return UNSAFE_CSS_PATTERN.test(decodedCssForSafety(value));
}

function assertStaticCss(value: string): void {
  if (unsafeCss(value)) throw projectError('unsafe_generated_project');
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`);
    return `{${entries.join(',')}}`;
  }
  throw projectError('invalid_project_version');
}

async function sha256(value: string): Promise<string> {
  try {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
  } catch {
    throw projectError('invalid_project_version');
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

function canonicalProjectId(
  value: unknown,
  code: BuilderProjectErrorCode = 'invalid_project_identity',
): string {
  if (typeof value !== 'string' || !PROJECT_ID_PATTERN.test(value)) {
    throw projectError(code);
  }
  return value;
}

function canonicalDigest(value: unknown, code: BuilderProjectErrorCode): string {
  if (typeof value !== 'string' || !DIGEST_PATTERN.test(value)) throw projectError(code);
  return value;
}

function sanitizeProposalEvidence(value: unknown): BuilderProjectProposalEvidence {
  const source = asExactRecord(value, EVIDENCE_KEYS, 'invalid_generated_project');
  if (
    source.authority !== BUILDER_CODE_GENERATOR_AUTHORITY
    || source.prompt_version !== BUILDER_CODE_PROJECT_PROMPT_VERSION
    || source.request_version !== BUILDER_GENERATION_REQUEST_PROTOCOL
    || source.result_version !== BUILDER_GENERATION_RESULT_PROTOCOL
    || !Number.isSafeInteger(source.target_revision)
    || Number(source.target_revision) < 1
  ) {
    throw projectError('invalid_generated_project');
  }
  return {
    authority: BUILDER_CODE_GENERATOR_AUTHORITY,
    prompt_version: BUILDER_CODE_PROJECT_PROMPT_VERSION,
    request_version: BUILDER_GENERATION_REQUEST_PROTOCOL,
    result_version: BUILDER_GENERATION_RESULT_PROTOCOL,
    request_digest: canonicalDigest(source.request_digest, 'invalid_generated_project'),
    proposal_digest: canonicalDigest(source.proposal_digest, 'invalid_generated_project'),
    project_id: canonicalProjectId(source.project_id, 'invalid_generated_project'),
    target_revision: Number(source.target_revision),
    parent_revision: sanitizeParentRevision(source.parent_revision, 'invalid_generated_project'),
  };
}

function sanitizeParentRevision(
  value: unknown,
  code: BuilderProjectErrorCode = 'invalid_project_version',
): BuilderProjectParentRevision | null {
  if (value === null) return null;
  const source = asExactRecord(value, PARENT_KEYS, code);
  if (!Number.isSafeInteger(source.revision) || Number(source.revision) < 1) {
    throw projectError(code);
  }
  return {
    revision: Number(source.revision),
    revision_digest: canonicalDigest(source.revision_digest, code),
  };
}

function sameParentRevision(
  left: BuilderProjectParentRevision | null,
  right: BuilderProjectParentRevision | null,
): boolean {
  return left === null
    ? right === null
    : right !== null
      && left.revision === right.revision
      && left.revision_digest === right.revision_digest;
}

export function sanitizeBuilderProjectProposal(value: unknown): BuilderProjectProposal {
  const source = asExactRecord(value, PROPOSAL_KEYS, 'invalid_generated_project');
  if (source.kind !== BUILDER_PROJECT_PROPOSAL_KIND) throw projectError('invalid_generated_project');
  const files = asExactRecord(source.files, FILE_KEYS, 'invalid_generated_project');
  const title = safeDisplayText(source.title, 80);
  const summary = safeDisplayText(source.summary, 400);
  const html = safeCode(files['index.html'], BUILDER_PROJECT_HTML_MAX_UTF8_BYTES, false);
  const css = safeCode(files['styles.css'], BUILDER_PROJECT_CSS_MAX_UTF8_BYTES, false);
  const javascript = safeCode(files['app.js'], BUILDER_PROJECT_JS_MAX_UTF8_BYTES, true);
  assertStaticHtml(html);
  assertStaticCss(css);
  if (FORBIDDEN_JAVASCRIPT_MODULE_PATTERN.test(javascript)) {
    throw projectError('unsafe_generated_project');
  }
  if (containsUnsafeBuilderProjectMaterial(title) || containsUnsafeBuilderProjectMaterial(summary)) {
    throw projectError('unsafe_generated_project');
  }
  const proposal: BuilderProjectProposal = {
    kind: BUILDER_PROJECT_PROPOSAL_KIND,
    title,
    summary,
    files: {
      'index.html': html,
      'styles.css': css,
      'app.js': javascript,
    },
  };
  if (utf8Size(JSON.stringify(proposal)) > BUILDER_PROJECT_TOTAL_MAX_UTF8_BYTES) {
    throw projectError('invalid_generated_project');
  }
  return deepFreeze(proposal);
}

export async function digestBuilderProjectProposal(proposal: BuilderProjectProposal): Promise<string> {
  const safeProposal = sanitizeBuilderProjectProposal(proposal);
  return sha256(canonicalJson(safeProposal));
}

function revisionDigestInput(revision: Omit<BuilderProjectRevision, 'revision_digest'>): unknown {
  return {
    execution_admission: revision.execution_admission,
    files: revision.files,
    parent_revision: revision.parent_revision,
    preview_script_admission: revision.preview_script_admission,
    project_id: revision.project_id,
    proposal_evidence: revision.proposal_evidence,
    record_kind: revision.record_kind,
    revision: revision.revision,
    schema_version: revision.schema_version,
    summary: revision.summary,
    title: revision.title,
  };
}

export async function createBuilderProjectRevision(
  input: CreateBuilderProjectRevisionInput,
): Promise<BuilderProjectRevision> {
  const projectId = canonicalProjectId(input.projectId);
  const proposal = sanitizeBuilderProjectProposal(input.proposal);
  const evidence = sanitizeProposalEvidence(input.proposalEvidence);
  const expectedProposalDigest = await digestBuilderProjectProposal(proposal);
  if (evidence.proposal_digest !== expectedProposalDigest) throw projectError('invalid_generated_project');
  if (evidence.request_digest !== canonicalDigest(input.requestDigest, 'invalid_generated_project')) {
    throw projectError('invalid_generated_project');
  }

  let parentRevision: BuilderProjectParentRevision | null = null;
  if (input.parent !== undefined) {
    const parent = await verifyBuilderProjectRevision(input.parent);
    if (parent.project_id !== projectId) throw projectError('invalid_project_version');
    parentRevision = { revision: parent.revision, revision_digest: parent.revision_digest };
  }
  const revision = parentRevision === null ? 1 : parentRevision.revision + 1;
  if (
    evidence.project_id !== projectId
    || evidence.target_revision !== revision
    || !sameParentRevision(evidence.parent_revision, parentRevision)
  ) {
    throw projectError('invalid_generated_project');
  }
  const unsignedRevision: Omit<BuilderProjectRevision, 'revision_digest'> = {
    schema_version: BUILDER_PROJECT_SCHEMA_VERSION,
    record_kind: BUILDER_PROJECT_RECORD_KIND,
    project_id: projectId,
    revision,
    parent_revision: parentRevision,
    title: proposal.title,
    summary: proposal.summary,
    files: {
      'index.html': proposal.files['index.html'],
      'styles.css': proposal.files['styles.css'],
      'app.js': proposal.files['app.js'],
    },
    proposal_evidence: evidence,
    execution_admission: 'not_evaluated',
    preview_script_admission: 'not_authorized',
  };
  const revisionDigest = await sha256(canonicalJson(revisionDigestInput(unsignedRevision)));
  const trustedRevision = deepFreeze({ ...unsignedRevision, revision_digest: revisionDigest });
  TRUSTED_BUILDER_PROJECT_REVISIONS.add(trustedRevision);
  return trustedRevision;
}

export async function verifyBuilderProjectRevision(value: unknown): Promise<BuilderProjectRevision> {
  let source: Record<string, unknown>;
  try {
    source = asExactRecord(value, REVISION_KEYS, 'invalid_project_version');
  } catch {
    throw projectError('invalid_project_version');
  }
  if (
    source.schema_version !== BUILDER_PROJECT_SCHEMA_VERSION
    || source.record_kind !== BUILDER_PROJECT_RECORD_KIND
    || source.execution_admission !== 'not_evaluated'
    || source.preview_script_admission !== 'not_authorized'
    || !Number.isSafeInteger(source.revision)
    || Number(source.revision) < 1
  ) {
    throw projectError('invalid_project_version');
  }
  const projectId = canonicalProjectId(source.project_id);
  const revision = Number(source.revision);
  const revisionDigest = canonicalDigest(source.revision_digest, 'invalid_project_version');
  const parentRevision = sanitizeParentRevision(source.parent_revision);
  if (
    (revision === 1 && parentRevision !== null)
    || (revision > 1 && parentRevision?.revision !== revision - 1)
  ) {
    throw projectError('invalid_project_version');
  }
  const proposal = sanitizeBuilderProjectProposal({
    kind: BUILDER_PROJECT_PROPOSAL_KIND,
    title: source.title,
    summary: source.summary,
    files: source.files,
  });
  const evidence = sanitizeProposalEvidence(source.proposal_evidence);
  if (
    evidence.project_id !== projectId
    || evidence.target_revision !== revision
    || !sameParentRevision(evidence.parent_revision, parentRevision)
    || await digestBuilderProjectProposal(proposal) !== evidence.proposal_digest
  ) {
    throw projectError('invalid_project_version');
  }
  const unsignedRevision: Omit<BuilderProjectRevision, 'revision_digest'> = {
    schema_version: BUILDER_PROJECT_SCHEMA_VERSION,
    record_kind: BUILDER_PROJECT_RECORD_KIND,
    project_id: projectId,
    revision,
    parent_revision: parentRevision,
    title: proposal.title,
    summary: proposal.summary,
    files: {
      'index.html': proposal.files['index.html'],
      'styles.css': proposal.files['styles.css'],
      'app.js': proposal.files['app.js'],
    },
    proposal_evidence: evidence,
    execution_admission: 'not_evaluated',
    preview_script_admission: 'not_authorized',
  };
  const expectedDigest = await sha256(canonicalJson(revisionDigestInput(unsignedRevision)));
  if (revisionDigest !== expectedDigest) throw projectError('invalid_project_version');
  const trustedRevision = deepFreeze({ ...unsignedRevision, revision_digest: revisionDigest });
  TRUSTED_BUILDER_PROJECT_REVISIONS.add(trustedRevision);
  return trustedRevision;
}
