import {
  BUILDER_CODE_GENERATOR_AUTHORITY,
  BUILDER_CODE_PROJECT_PROMPT_VERSION,
  BUILDER_GENERATION_REQUEST_PROTOCOL,
  BUILDER_GENERATION_RESULT_PROTOCOL,
  createBuilderProjectRevision,
  containsUnsafeBuilderProjectMaterial,
  digestBuilderProjectProposal,
  sanitizeBuilderProjectProposal,
  verifyBuilderProjectRevision,
  type BuilderProjectParentRevision,
  type BuilderProjectProposal,
  type BuilderProjectRevision,
} from '../domain/builderProject';

export { BUILDER_GENERATION_REQUEST_PROTOCOL, BUILDER_GENERATION_RESULT_PROTOCOL };

export type BuilderGenerationRequest = {
  version: typeof BUILDER_GENERATION_REQUEST_PROTOCOL;
  idea: string;
  project_id: string;
  target_revision: number;
  parent_revision: BuilderProjectParentRevision | null;
  request_digest: string;
};

export type BuilderGenerationResultEvidence = {
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

export type BuilderGenerationResultAdmissions = {
  execution: 'not_evaluated';
  preview_script: 'not_authorized';
};

export type BuilderGenerationResult = {
  version: typeof BUILDER_GENERATION_RESULT_PROTOCOL;
  request_id: string;
  proposal: BuilderProjectProposal;
  evidence: BuilderGenerationResultEvidence;
  admissions: BuilderGenerationResultAdmissions;
};

export type PrepareBuilderGenerationInput = {
  idea: unknown;
  currentProject?: unknown;
};

export type BuilderGenerationDependencies = {
  createProjectId?: () => unknown;
};

export type ProjectBuilderGenerationInput = {
  request: unknown;
  result: unknown;
  currentProject?: unknown;
};

export type BuilderGenerationErrorCode =
  | 'invalid_idea'
  | 'identity_unavailable'
  | 'invalid_generation_request'
  | 'invalid_generated_project'
  | 'project_version_changed';

export class BuilderGenerationError extends Error {
  readonly code: BuilderGenerationErrorCode;

  constructor(code: BuilderGenerationErrorCode) {
    const messages: Record<BuilderGenerationErrorCode, string> = {
      invalid_idea: 'Describe the small project you want to make.',
      identity_unavailable: 'A new local project could not be prepared.',
      invalid_generation_request: 'This project request is no longer valid.',
      invalid_generated_project: 'The generated project could not be used. Try a simpler request.',
      project_version_changed: 'The project changed before this version could be saved.',
    };
    super(messages[code]);
    this.name = 'BuilderGenerationError';
    this.code = code;
  }
}

const REQUEST_KEYS = new Set([
  'version',
  'idea',
  'project_id',
  'target_revision',
  'parent_revision',
  'request_digest',
]);
const RESULT_KEYS = new Set(['version', 'request_id', 'proposal', 'evidence', 'admissions']);
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
const ADMISSIONS_KEYS = new Set(['execution', 'preview_script']);
const PARENT_KEYS = new Set(['revision', 'revision_digest']);
const PREPARE_INPUT_SHAPES = [new Set(['idea']), new Set(['idea', 'currentProject'])];
const PROJECT_INPUT_SHAPES = [
  new Set(['request', 'result']),
  new Set(['request', 'result', 'currentProject']),
];
const PROJECT_ID_PATTERN = /^builder-project:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const MAX_IDEA_CODE_POINTS = 4000;
const MAX_IDEA_UTF8_BYTES = 16 * 1024;
const MAX_DATA_TREE_NODES = 256;
const MAX_DATA_TREE_DEPTH = 8;
const MAX_UNKNOWN_STRING_CODE_UNITS = 560 * 1024;
const UNSAFE_UNICODE_FORMAT_PATTERN = /[\p{Cf}\p{Bidi_Control}]/u;

function generationError(code: BuilderGenerationErrorCode): BuilderGenerationError {
  return new BuilderGenerationError(code);
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

function hasDisallowedIdeaControl(value: string): boolean {
  if (UNSAFE_UNICODE_FORMAT_PATTERN.test(value)) return true;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if ((code >= 0x7f && code <= 0x9f) || (code <= 0x1f && ![0x09, 0x0a, 0x0d].includes(code))) return true;
  }
  return false;
}

function withinCodePointLimit(value: string, maximum: number): boolean {
  if (value.length > maximum * 2) return false;
  return Array.from(value).length <= maximum;
}

function safeIdea(value: unknown, code: 'invalid_idea' | 'invalid_generation_request'): string {
  if (
    typeof value !== 'string'
    || !value
    || value.trim() !== value
    || value.length > MAX_IDEA_UTF8_BYTES
    || value.normalize('NFC') !== value
    || !withinCodePointLimit(value, MAX_IDEA_CODE_POINTS)
    || utf8Size(value) > MAX_IDEA_UTF8_BYTES
    || hasUnpairedSurrogate(value)
    || hasDisallowedIdeaControl(value)
    || containsUnsafeBuilderProjectMaterial(value)
  ) {
    throw generationError(code);
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

function assertDataTree(
  value: unknown,
  code: 'invalid_idea' | 'invalid_generation_request' | 'invalid_generated_project',
  seen = new WeakSet<object>(),
  depth = 0,
  budget = { remaining: MAX_DATA_TREE_NODES },
): void {
  if (typeof value === 'string') {
    if (value.length > MAX_UNKNOWN_STRING_CODE_UNITS) throw generationError(code);
    return;
  }
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return;
  if (typeof value !== 'object') throw generationError(code);
  budget.remaining -= 1;
  if (budget.remaining < 0 || depth > MAX_DATA_TREE_DEPTH || seen.has(value)) throw generationError(code);
  seen.add(value);

  const prototype = Object.getPrototypeOf(value);
  const keys = Reflect.ownKeys(value);
  budget.remaining -= keys.length;
  if (budget.remaining < 0) throw generationError(code);
  if (Array.isArray(value)) {
    if (
      prototype !== Array.prototype
      || keys.some((key) => typeof key === 'symbol')
      || keys.some((key) => key !== 'length' && !/^(?:0|[1-9][0-9]*)$/.test(String(key)))
      || keys.length !== value.length + 1
    ) {
      throw generationError(code);
    }
  } else if (prototype !== Object.prototype && prototype !== null) {
    throw generationError(code);
  }

  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key === 'symbol') throw generationError(code);
    const descriptor = descriptors[key];
    if (!descriptor || 'get' in descriptor || 'set' in descriptor || !descriptor.enumerable) {
      if (key !== 'length') throw generationError(code);
      continue;
    }
    assertDataTree(descriptor.value, code, seen, depth + 1, budget);
  }
}

function exactRecord(
  value: unknown,
  keys: ReadonlySet<string>,
  code: 'invalid_idea' | 'invalid_generation_request' | 'invalid_generated_project',
): Record<string, unknown> {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw generationError(code);
    const initialKeys = Reflect.ownKeys(value);
    if (initialKeys.length !== keys.size || initialKeys.some((key) => typeof key !== 'string' || !keys.has(key))) {
      throw generationError(code);
    }
    assertDataTree(value, code);
    const clone = structuredClone(value);
    if (clone === null || typeof clone !== 'object' || Array.isArray(clone)) throw generationError(code);
    return clone as Record<string, unknown>;
  } catch (error) {
    if (error instanceof BuilderGenerationError) throw error;
    throw generationError(code);
  }
}

function exactEnvelope(
  value: unknown,
  shapes: ReadonlyArray<ReadonlySet<string>>,
  code: 'invalid_idea' | 'invalid_generation_request',
): Record<string, unknown> {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw generationError(code);
    const ownKeys = Reflect.ownKeys(value);
    const shape = shapes.find((candidate) => (
      ownKeys.length === candidate.size
      && ownKeys.every((key) => typeof key === 'string' && candidate.has(key))
    ));
    if (!shape) throw generationError(code);
    return exactRecord(value, shape, code);
  } catch (error) {
    if (error instanceof BuilderGenerationError) throw error;
    throw generationError(code);
  }
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
  throw generationError('invalid_generation_request');
}

async function sha256(value: string, code: 'invalid_generation_request' | 'identity_unavailable'): Promise<string> {
  try {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
  } catch {
    throw generationError(code);
  }
}

function defaultProjectId(): string {
  try {
    return `builder-project:${globalThis.crypto.randomUUID()}`;
  } catch {
    throw generationError('identity_unavailable');
  }
}

function canonicalProjectId(value: unknown, code: BuilderGenerationErrorCode): string {
  if (typeof value !== 'string' || !PROJECT_ID_PATTERN.test(value)) throw generationError(code);
  return value;
}

function canonicalDigest(
  value: unknown,
  code: 'invalid_generation_request' | 'invalid_generated_project',
): string {
  if (typeof value !== 'string' || !DIGEST_PATTERN.test(value)) throw generationError(code);
  return value;
}

function parentRevision(
  value: unknown,
  code: 'invalid_generation_request' | 'invalid_generated_project',
): BuilderProjectParentRevision | null {
  if (value === null) return null;
  const source = exactRecord(value, PARENT_KEYS, code);
  if (!Number.isSafeInteger(source.revision) || Number(source.revision) < 1) throw generationError(code);
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

async function requestDigest(
  request: Omit<BuilderGenerationRequest, 'request_digest'>,
  code: 'invalid_generation_request' | 'identity_unavailable',
): Promise<string> {
  return sha256(canonicalJson(request), code);
}

async function sanitizeGenerationRequest(value: unknown): Promise<BuilderGenerationRequest> {
  const source = exactRecord(value, REQUEST_KEYS, 'invalid_generation_request');
  if (
    source.version !== BUILDER_GENERATION_REQUEST_PROTOCOL
    || !Number.isSafeInteger(source.target_revision)
    || Number(source.target_revision) < 1
  ) {
    throw generationError('invalid_generation_request');
  }
  const idea = safeIdea(source.idea, 'invalid_generation_request');
  const projectId = canonicalProjectId(source.project_id, 'invalid_generation_request');
  const targetRevision = Number(source.target_revision);
  const parent = parentRevision(source.parent_revision, 'invalid_generation_request');
  const digest = canonicalDigest(source.request_digest, 'invalid_generation_request');
  if (
    (targetRevision === 1 && parent !== null)
    || (targetRevision > 1 && parent?.revision !== targetRevision - 1)
  ) {
    throw generationError('invalid_generation_request');
  }
  const unsignedRequest: Omit<BuilderGenerationRequest, 'request_digest'> = {
    version: BUILDER_GENERATION_REQUEST_PROTOCOL,
    idea,
    project_id: projectId,
    target_revision: targetRevision,
    parent_revision: parent,
  };
  if (await requestDigest(unsignedRequest, 'invalid_generation_request') !== digest) {
    throw generationError('invalid_generation_request');
  }
  return deepFreeze({ ...unsignedRequest, request_digest: digest });
}

async function sanitizeGenerationResult(
  value: unknown,
  request: BuilderGenerationRequest,
): Promise<BuilderGenerationResult> {
  const source = exactRecord(value, RESULT_KEYS, 'invalid_generated_project');
  if (source.version !== BUILDER_GENERATION_RESULT_PROTOCOL) throw generationError('invalid_generated_project');
  const requestId = canonicalDigest(source.request_id, 'invalid_generated_project');
  if (requestId !== request.request_digest) throw generationError('invalid_generated_project');

  const evidenceSource = exactRecord(source.evidence, EVIDENCE_KEYS, 'invalid_generated_project');
  if (
    evidenceSource.authority !== BUILDER_CODE_GENERATOR_AUTHORITY
    || evidenceSource.prompt_version !== BUILDER_CODE_PROJECT_PROMPT_VERSION
    || evidenceSource.request_version !== request.version
    || evidenceSource.result_version !== source.version
    || evidenceSource.request_digest !== request.request_digest
    || evidenceSource.project_id !== request.project_id
    || evidenceSource.target_revision !== request.target_revision
  ) {
    throw generationError('invalid_generated_project');
  }
  const evidenceParent = parentRevision(evidenceSource.parent_revision, 'invalid_generated_project');
  if (!sameParentRevision(evidenceParent, request.parent_revision)) {
    throw generationError('invalid_generated_project');
  }
  const evidence: BuilderGenerationResultEvidence = {
    authority: BUILDER_CODE_GENERATOR_AUTHORITY,
    prompt_version: BUILDER_CODE_PROJECT_PROMPT_VERSION,
    request_version: BUILDER_GENERATION_REQUEST_PROTOCOL,
    result_version: BUILDER_GENERATION_RESULT_PROTOCOL,
    request_digest: canonicalDigest(evidenceSource.request_digest, 'invalid_generated_project'),
    proposal_digest: canonicalDigest(evidenceSource.proposal_digest, 'invalid_generated_project'),
    project_id: canonicalProjectId(evidenceSource.project_id, 'invalid_generated_project'),
    target_revision: Number(evidenceSource.target_revision),
    parent_revision: evidenceParent,
  };

  const admissionsSource = exactRecord(source.admissions, ADMISSIONS_KEYS, 'invalid_generated_project');
  if (admissionsSource.execution !== 'not_evaluated' || admissionsSource.preview_script !== 'not_authorized') {
    throw generationError('invalid_generated_project');
  }
  const proposal = sanitizeBuilderProjectProposal(source.proposal);
  if (await digestBuilderProjectProposal(proposal) !== evidence.proposal_digest) {
    throw generationError('invalid_generated_project');
  }
  return deepFreeze({
    version: BUILDER_GENERATION_RESULT_PROTOCOL,
    request_id: requestId,
    proposal,
    evidence,
    admissions: { execution: 'not_evaluated', preview_script: 'not_authorized' },
  });
}

export async function prepareBuilderGeneration(
  input: PrepareBuilderGenerationInput,
  dependencies: BuilderGenerationDependencies = {},
): Promise<BuilderGenerationRequest> {
  const envelope = exactEnvelope(input, PREPARE_INPUT_SHAPES, 'invalid_idea');
  const idea = safeIdea(envelope.idea, 'invalid_idea');
  let currentProject: BuilderProjectRevision | null = null;
  if (Object.hasOwn(envelope, 'currentProject')) {
    try {
      currentProject = await verifyBuilderProjectRevision(envelope.currentProject);
    } catch {
      throw generationError('project_version_changed');
    }
  }

  let projectId: string;
  if (currentProject !== null) {
    projectId = currentProject.project_id;
  } else {
    let generated: unknown;
    try {
      generated = (dependencies.createProjectId ?? defaultProjectId)();
    } catch {
      throw generationError('identity_unavailable');
    }
    projectId = canonicalProjectId(generated, 'identity_unavailable');
  }
  const parent = currentProject === null
    ? null
    : { revision: currentProject.revision, revision_digest: currentProject.revision_digest };
  const unsignedRequest: Omit<BuilderGenerationRequest, 'request_digest'> = {
    version: BUILDER_GENERATION_REQUEST_PROTOCOL,
    idea,
    project_id: projectId,
    target_revision: parent === null ? 1 : parent.revision + 1,
    parent_revision: parent,
  };
  const digest = await requestDigest(unsignedRequest, 'identity_unavailable');
  return deepFreeze({ ...unsignedRequest, request_digest: digest });
}

export async function projectBuilderGeneration(
  input: ProjectBuilderGenerationInput,
): Promise<BuilderProjectRevision> {
  const envelope = exactEnvelope(input, PROJECT_INPUT_SHAPES, 'invalid_generation_request');
  const request = await sanitizeGenerationRequest(envelope.request);
  const hasCurrentProject = Object.hasOwn(envelope, 'currentProject');
  let currentProject: BuilderProjectRevision | undefined;
  if (request.parent_revision !== null) {
    if (!hasCurrentProject) throw generationError('project_version_changed');
    try {
      currentProject = await verifyBuilderProjectRevision(envelope.currentProject);
    } catch {
      throw generationError('project_version_changed');
    }
    if (
      currentProject.project_id !== request.project_id
      || currentProject.revision !== request.parent_revision.revision
      || currentProject.revision_digest !== request.parent_revision.revision_digest
    ) {
      throw generationError('project_version_changed');
    }
  } else if (hasCurrentProject) {
    throw generationError('invalid_generation_request');
  }

  try {
    const result = await sanitizeGenerationResult(envelope.result, request);
    const revision = await createBuilderProjectRevision({
      projectId: request.project_id,
      proposal: result.proposal,
      proposalEvidence: result.evidence,
      requestDigest: request.request_digest,
      ...(currentProject === undefined ? {} : { parent: currentProject }),
    });
    if (revision.revision !== request.target_revision) throw generationError('project_version_changed');
    return revision;
  } catch (error) {
    if (error instanceof BuilderGenerationError) throw error;
    throw generationError('invalid_generated_project');
  }
}
