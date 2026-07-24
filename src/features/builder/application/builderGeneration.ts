import {
  sanitizeBuilderProjectSourceTree,
  type BuilderProjectSourceTree,
} from '../domain/builderProjectSnapshot';

export const BUILDER_GENERATION_REQUEST_PROTOCOL = 'builder-generation-request.v2' as const;
export const BUILDER_GENERATION_RESULT_PROTOCOL = 'builder-generation-result.v2' as const;

export type BuilderGenerationRequest = Readonly<{
  version: typeof BUILDER_GENERATION_REQUEST_PROTOCOL;
  instruction: string;
  existing_project_id: string | null;
  request_digest: string;
}>;

export type BuilderGenerationDraft = Readonly<{
  version: typeof BUILDER_GENERATION_RESULT_PROTOCOL;
  request_id: string | null;
  draft_id: string;
  title: string;
  summary: string;
  project_id: string;
  existing_project_id: string | null;
  candidate: Readonly<{
    candidate_version: 'builder-code-change-candidate.v2';
    candidate_id: string;
    candidate_digest: string;
    resulting_tree_digest: string;
  }>;
  base_revision_evidence: Readonly<{
    evidence_version: 'builder-project-base-revision-evidence.v2';
    project_id: string;
    revision_receipt_digest: string;
    commit_oid: string;
    source_tree_digest: string;
    verification_admission: 'git_sqlite_read_authority_verified';
  }> | null;
  source_tree: BuilderProjectSourceTree;
  admissions: Readonly<{
    conversation: 'sqlite_recorded';
    draft: 'candidate_not_saved';
    save: 'not_performed';
    preview: 'not_evaluated';
    execution: 'not_evaluated';
  }>;
  restart_restore: 'not_persisted' | 'git_sqlite_verified';
}>;

export type BuilderGenerationAnswer = Readonly<{
  version: typeof BUILDER_GENERATION_RESULT_PROTOCOL;
  result_kind: 'explanation';
  title: string;
  summary: string;
  explanation: string;
  project_id: string;
  existing_project_id: string | null;
  admissions: Readonly<{
    conversation: 'sqlite_recorded';
    draft: 'not_created';
    save: 'not_performed';
    preview: 'not_applicable';
    execution: 'not_evaluated';
  }>;
}>;

export type BuilderGenerationErrorCode =
  | 'invalid_instruction'
  | 'invalid_generation_request'
  | 'invalid_generated_draft'
  | 'invalid_generated_answer';

export class BuilderGenerationError extends Error {
  readonly code: BuilderGenerationErrorCode;

  constructor(code: BuilderGenerationErrorCode) {
    super(code === 'invalid_instruction'
      ? 'Describe what you want to make.'
      : code === 'invalid_generation_request'
        ? 'This project request could not be verified.'
        : code === 'invalid_generated_answer'
          ? 'The answer could not be verified.'
          : 'The generated draft could not be verified.');
    this.name = 'BuilderGenerationError';
    this.code = code;
    this.stack = `${this.name}: ${this.message}`;
  }
}

const TEXT_ENCODER = new TextEncoder();
const REQUEST_KEYS = Object.freeze([
  'version',
  'instruction',
  'existing_project_id',
  'request_digest',
]);
const DRAFT_KEYS = Object.freeze([
  'version',
  'request_id',
  'draft_id',
  'title',
  'summary',
  'project_id',
  'existing_project_id',
  'candidate',
  'base_revision_evidence',
  'source_tree',
  'admissions',
  'restart_restore',
]);
const ANSWER_KEYS = Object.freeze([
  'version',
  'result_kind',
  'request_id',
  'project_id',
  'existing_project_id',
  'title',
  'summary',
  'explanation',
  'admissions',
]);
const CANDIDATE_KEYS = Object.freeze([
  'candidate_version',
  'candidate_id',
  'candidate_digest',
  'resulting_tree_digest',
]);
const BASE_EVIDENCE_KEYS = Object.freeze([
  'evidence_version',
  'project_id',
  'revision_receipt_digest',
  'commit_oid',
  'source_tree_digest',
  'verification_admission',
]);
const ADMISSION_KEYS = Object.freeze([
  'conversation',
  'draft',
  'save',
  'preview',
  'execution',
]);
const PROJECT_ID_PATTERN =
  /^builder-project:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DRAFT_ID_PATTERN = /^builder-generation-draft:[0-9a-f]{64}$/u;
const CANDIDATE_ID_PATTERN = /^builder-code-change-candidate:[0-9a-f]{64}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const OID_PATTERN = /^[0-9a-f]{40}$/u;
const MAX_INSTRUCTION_CODE_POINTS = 4000;
const MAX_INSTRUCTION_UTF8_BYTES = 16 * 1024;

function invalid(code: BuilderGenerationErrorCode): BuilderGenerationError {
  return new BuilderGenerationError(code);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
  code: BuilderGenerationErrorCode,
): Record<string, unknown> {
  try {
    if (!isPlainObject(value)) throw invalid(code);
    const ownKeys = Reflect.ownKeys(value);
    if (
      ownKeys.length !== keys.length
      || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))
    ) throw invalid(code);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const result: Record<string, unknown> = {};
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (
        !descriptor
        || !descriptor.enumerable
        || !Object.hasOwn(descriptor, 'value')
      ) throw invalid(code);
      result[key] = descriptor.value;
    }
    return result;
  } catch (error) {
    if (error instanceof BuilderGenerationError) throw error;
    throw invalid(code);
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
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if ((code >= 0x7f && code <= 0x9f) || (code <= 0x1f && ![0x09, 0x0a, 0x0d].includes(code))) {
      return true;
    }
  }
  return false;
}

function safeInstruction(value: unknown, code: BuilderGenerationErrorCode): string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.trim() !== value
    || value.normalize('NFC') !== value
    || value.length > MAX_INSTRUCTION_CODE_POINTS * 2
    || Array.from(value).length > MAX_INSTRUCTION_CODE_POINTS
    || hasUnpairedSurrogate(value)
    || hasDisallowedControl(value)
    || TEXT_ENCODER.encode(value).byteLength > MAX_INSTRUCTION_UTF8_BYTES
  ) throw invalid(code);
  return value;
}

function safeDisplayText(
  value: unknown,
  maximum: number,
  code: BuilderGenerationErrorCode = 'invalid_generated_draft',
): string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.trim() !== value
    || value.length > maximum * 2
    || Array.from(value).length > maximum
    || value.normalize('NFC') !== value
    || hasUnpairedSurrogate(value)
    || hasDisallowedControl(value)
  ) throw invalid(code);
  return value;
}

function safeProjectId(value: unknown, code: BuilderGenerationErrorCode): string {
  if (typeof value !== 'string' || !PROJECT_ID_PATTERN.test(value)) throw invalid(code);
  return value;
}

function safeDraftId(value: unknown): string {
  if (typeof value !== 'string' || !DRAFT_ID_PATTERN.test(value)) {
    throw invalid('invalid_generated_draft');
  }
  return value;
}

function safeDigest(value: unknown): string {
  if (typeof value !== 'string' || !DIGEST_PATTERN.test(value)) {
    throw invalid('invalid_generated_draft');
  }
  return value;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number' && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(Object.getOwnPropertyDescriptor(value, key)?.value)}`
    )).join(',')}}`;
  }
  throw invalid('invalid_generation_request');
}

async function sha256Canonical(value: unknown): Promise<string> {
  try {
    const bytes = TEXT_ENCODER.encode(canonicalJson(value));
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return `sha256:${Array.from(
      new Uint8Array(digest),
      (byte) => byte.toString(16).padStart(2, '0'),
    ).join('')}`;
  } catch (error) {
    if (error instanceof BuilderGenerationError) throw error;
    throw invalid('invalid_generation_request');
  }
}

export async function createBuilderGenerationRequest(
  instructionValue: unknown,
  existingProjectIdValue: unknown = null,
): Promise<BuilderGenerationRequest> {
  const instruction = safeInstruction(instructionValue, 'invalid_instruction');
  const existingProjectId = existingProjectIdValue === null
    ? null
    : safeProjectId(existingProjectIdValue, 'invalid_generation_request');
  const unsigned = {
    version: BUILDER_GENERATION_REQUEST_PROTOCOL,
    instruction,
    existing_project_id: existingProjectId,
  };
  return deepFreeze({
    ...unsigned,
    request_digest: await sha256Canonical(unsigned),
  });
}

export async function sanitizeBuilderGenerationRequest(
  value: unknown,
): Promise<BuilderGenerationRequest> {
  const source = exactRecord(value, REQUEST_KEYS, 'invalid_generation_request');
  if (source.version !== BUILDER_GENERATION_REQUEST_PROTOCOL) {
    throw invalid('invalid_generation_request');
  }
  const instruction = safeInstruction(source.instruction, 'invalid_generation_request');
  const existingProjectId = source.existing_project_id === null
    ? null
    : safeProjectId(source.existing_project_id, 'invalid_generation_request');
  const unsigned = {
    version: BUILDER_GENERATION_REQUEST_PROTOCOL,
    instruction,
    existing_project_id: existingProjectId,
  };
  const requestDigest = source.request_digest;
  if (
    typeof requestDigest !== 'string'
    || !DIGEST_PATTERN.test(requestDigest)
    || await sha256Canonical(unsigned) !== requestDigest
  ) throw invalid('invalid_generation_request');
  return deepFreeze({ ...unsigned, request_digest: requestDigest });
}

function sanitizeBaseEvidence(
  value: unknown,
  expectedProjectId: string,
  required: boolean,
): BuilderGenerationDraft['base_revision_evidence'] {
  if (value === null) {
    if (required) throw invalid('invalid_generated_draft');
    return null;
  }
  if (!required) throw invalid('invalid_generated_draft');
  const source = exactRecord(value, BASE_EVIDENCE_KEYS, 'invalid_generated_draft');
  if (
    source.evidence_version !== 'builder-project-base-revision-evidence.v2'
    || safeProjectId(source.project_id, 'invalid_generated_draft') !== expectedProjectId
    || typeof source.revision_receipt_digest !== 'string'
    || !DIGEST_PATTERN.test(source.revision_receipt_digest)
    || typeof source.commit_oid !== 'string'
    || !OID_PATTERN.test(source.commit_oid)
    || typeof source.source_tree_digest !== 'string'
    || !DIGEST_PATTERN.test(source.source_tree_digest)
    || source.verification_admission !== 'git_sqlite_read_authority_verified'
  ) throw invalid('invalid_generated_draft');
  return deepFreeze({
    evidence_version: 'builder-project-base-revision-evidence.v2',
    project_id: expectedProjectId,
    revision_receipt_digest: source.revision_receipt_digest,
    commit_oid: source.commit_oid,
    source_tree_digest: source.source_tree_digest,
    verification_admission: 'git_sqlite_read_authority_verified',
  });
}

export async function sanitizeBuilderGenerationDraft(
  value: unknown,
  expectedRequest: BuilderGenerationRequest,
): Promise<BuilderGenerationDraft> {
  try {
    const request = await sanitizeBuilderGenerationRequest(expectedRequest);
    const source = exactRecord(value, DRAFT_KEYS, 'invalid_generated_draft');
    if (
      source.version !== BUILDER_GENERATION_RESULT_PROTOCOL
      || source.request_id !== request.request_digest
      || source.restart_restore !== 'not_persisted'
    ) throw invalid('invalid_generated_draft');
    const draftId = safeDraftId(source.draft_id);
    const projectId = safeProjectId(source.project_id, 'invalid_generated_draft');
    if (
      source.existing_project_id !== request.existing_project_id
      || (request.existing_project_id !== null && projectId !== request.existing_project_id)
    ) throw invalid('invalid_generated_draft');
    const candidate = exactRecord(source.candidate, CANDIDATE_KEYS, 'invalid_generated_draft');
    if (
      candidate.candidate_version !== 'builder-code-change-candidate.v2'
      || typeof candidate.candidate_id !== 'string'
      || !CANDIDATE_ID_PATTERN.test(candidate.candidate_id)
    ) throw invalid('invalid_generated_draft');
    const candidateDigest = safeDigest(candidate.candidate_digest);
    const resultingTreeDigest = safeDigest(candidate.resulting_tree_digest);
    const sourceTree = await sanitizeBuilderProjectSourceTree(source.source_tree);
    if (sourceTree.source_tree_digest !== resultingTreeDigest) {
      throw invalid('invalid_generated_draft');
    }
    const admissions = exactRecord(source.admissions, ADMISSION_KEYS, 'invalid_generated_draft');
    if (
      admissions.conversation !== 'sqlite_recorded'
      || admissions.draft !== 'candidate_not_saved'
      || admissions.save !== 'not_performed'
      || admissions.preview !== 'not_evaluated'
      || admissions.execution !== 'not_evaluated'
    ) throw invalid('invalid_generated_draft');
    return deepFreeze({
      version: BUILDER_GENERATION_RESULT_PROTOCOL,
      request_id: request.request_digest,
      draft_id: draftId,
      title: safeDisplayText(source.title, 80),
      summary: safeDisplayText(source.summary, 400),
      project_id: projectId,
      existing_project_id: request.existing_project_id,
      candidate: {
        candidate_version: 'builder-code-change-candidate.v2',
        candidate_id: candidate.candidate_id,
        candidate_digest: candidateDigest,
        resulting_tree_digest: resultingTreeDigest,
      },
      base_revision_evidence: sanitizeBaseEvidence(
        source.base_revision_evidence,
        projectId,
        request.existing_project_id !== null,
      ),
      source_tree: sourceTree,
      admissions: {
        conversation: 'sqlite_recorded',
        draft: 'candidate_not_saved',
        save: 'not_performed',
        preview: 'not_evaluated',
        execution: 'not_evaluated',
      },
      restart_restore: 'not_persisted',
    });
  } catch (error) {
    if (error instanceof BuilderGenerationError) throw error;
    throw invalid('invalid_generated_draft');
  }
}

export async function sanitizeBuilderGenerationAnswer(
  value: unknown,
  expectedRequest: BuilderGenerationRequest,
): Promise<BuilderGenerationAnswer> {
  try {
    const request = await sanitizeBuilderGenerationRequest(expectedRequest);
    const source = exactRecord(value, ANSWER_KEYS, 'invalid_generated_answer');
    if (
      source.version !== BUILDER_GENERATION_RESULT_PROTOCOL
      || source.result_kind !== 'explanation'
      || source.request_id !== request.request_digest
    ) throw invalid('invalid_generated_answer');
    const projectId = safeProjectId(source.project_id, 'invalid_generated_answer');
    const existingProjectId = source.existing_project_id === null
      ? null
      : safeProjectId(source.existing_project_id, 'invalid_generated_answer');
    if (
      existingProjectId !== request.existing_project_id
      || (existingProjectId !== null && projectId !== existingProjectId)
    ) throw invalid('invalid_generated_answer');
    const admissions = exactRecord(source.admissions, ADMISSION_KEYS, 'invalid_generated_answer');
    if (
      admissions.conversation !== 'sqlite_recorded'
      || admissions.draft !== 'not_created'
      || admissions.save !== 'not_performed'
      || admissions.preview !== 'not_applicable'
      || admissions.execution !== 'not_evaluated'
    ) throw invalid('invalid_generated_answer');
    return deepFreeze({
      version: BUILDER_GENERATION_RESULT_PROTOCOL,
      result_kind: 'explanation',
      title: safeDisplayText(source.title, 80, 'invalid_generated_answer'),
      summary: safeDisplayText(source.summary, 400, 'invalid_generated_answer'),
      explanation: safeDisplayText(source.explanation, 4000, 'invalid_generated_answer'),
      project_id: projectId,
      existing_project_id: existingProjectId,
      admissions: {
        conversation: 'sqlite_recorded',
        draft: 'not_created',
        save: 'not_performed',
        preview: 'not_applicable',
        execution: 'not_evaluated',
      },
    });
  } catch (error) {
    if (error instanceof BuilderGenerationError) throw error;
    throw invalid('invalid_generated_answer');
  }
}

export async function sanitizeRestoredBuilderGenerationDraft(
  value: unknown,
  expectedDraftId: string,
): Promise<BuilderGenerationDraft> {
  try {
    const expected = safeDraftId(expectedDraftId);
    const source = exactRecord(value, DRAFT_KEYS, 'invalid_generated_draft');
    const restartRestore = source.restart_restore;
    if (
      source.version !== BUILDER_GENERATION_RESULT_PROTOCOL
      || (restartRestore !== 'not_persisted' && restartRestore !== 'git_sqlite_verified')
    ) throw invalid('invalid_generated_draft');
    const draftId = safeDraftId(source.draft_id);
    if (draftId !== expected) throw invalid('invalid_generated_draft');
    let requestId: string | null;
    if (restartRestore === 'git_sqlite_verified') {
      if (source.request_id !== null) throw invalid('invalid_generated_draft');
      requestId = null;
    } else {
      requestId = safeDigest(source.request_id);
    }
    const projectId = safeProjectId(source.project_id, 'invalid_generated_draft');
    const existingProjectId = source.existing_project_id === null
      ? null
      : safeProjectId(source.existing_project_id, 'invalid_generated_draft');
    if (existingProjectId !== null && existingProjectId !== projectId) {
      throw invalid('invalid_generated_draft');
    }
    const candidate = exactRecord(source.candidate, CANDIDATE_KEYS, 'invalid_generated_draft');
    if (
      candidate.candidate_version !== 'builder-code-change-candidate.v2'
      || typeof candidate.candidate_id !== 'string'
      || !CANDIDATE_ID_PATTERN.test(candidate.candidate_id)
    ) throw invalid('invalid_generated_draft');
    const candidateDigest = safeDigest(candidate.candidate_digest);
    const resultingTreeDigest = safeDigest(candidate.resulting_tree_digest);
    const sourceTree = await sanitizeBuilderProjectSourceTree(source.source_tree);
    if (sourceTree.source_tree_digest !== resultingTreeDigest) {
      throw invalid('invalid_generated_draft');
    }
    const admissions = exactRecord(source.admissions, ADMISSION_KEYS, 'invalid_generated_draft');
    if (
      admissions.conversation !== 'sqlite_recorded'
      || admissions.draft !== 'candidate_not_saved'
      || admissions.save !== 'not_performed'
      || admissions.preview !== 'not_evaluated'
      || admissions.execution !== 'not_evaluated'
    ) throw invalid('invalid_generated_draft');
    return deepFreeze({
      version: BUILDER_GENERATION_RESULT_PROTOCOL,
      request_id: requestId,
      draft_id: draftId,
      title: safeDisplayText(source.title, 80),
      summary: safeDisplayText(source.summary, 400),
      project_id: projectId,
      existing_project_id: existingProjectId,
      candidate: {
        candidate_version: 'builder-code-change-candidate.v2',
        candidate_id: candidate.candidate_id,
        candidate_digest: candidateDigest,
        resulting_tree_digest: resultingTreeDigest,
      },
      base_revision_evidence: sanitizeBaseEvidence(
        source.base_revision_evidence,
        projectId,
        existingProjectId !== null,
      ),
      source_tree: sourceTree,
      admissions: {
        conversation: 'sqlite_recorded',
        draft: 'candidate_not_saved',
        save: 'not_performed',
        preview: 'not_evaluated',
        execution: 'not_evaluated',
      },
      restart_restore: restartRestore,
    });
  } catch (error) {
    if (error instanceof BuilderGenerationError) throw error;
    throw invalid('invalid_generated_draft');
  }
}
