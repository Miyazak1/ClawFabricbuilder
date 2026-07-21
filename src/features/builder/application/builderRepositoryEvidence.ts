import {
  verifyBuilderProjectRevision,
  type BuilderProjectRevision,
} from '../domain/builderProject';

export const BUILDER_PROJECT_REPOSITORY_RESULT_VERSION = 'builder-project-repository-result.v1' as const;

export type BuilderProjectRepositoryHead = {
  schema_version: 1;
  record_kind: 'builder_project_head';
  project_id: string;
  revision: number;
  revision_digest: string;
  head_digest: string;
};

export type BuilderProjectRepositoryCommitEvidence = {
  record: BuilderProjectRevision;
  head: BuilderProjectRepositoryHead;
  idempotent_replay: boolean;
};

export type BuilderProjectRepositoryCurrentEvidence = {
  record: BuilderProjectRevision;
  head: BuilderProjectRepositoryHead;
  restart_restore: true;
};

export class BuilderRepositoryEvidenceError extends Error {
  readonly code = 'repository_evidence_invalid';

  constructor() {
    super('The saved local project could not be verified.');
    this.name = 'BuilderRepositoryEvidenceError';
  }
}

const COMMIT_KEYS = new Set([
  'result_version',
  'record',
  'head',
  'idempotent_replay',
  'persistence_evidence',
]);
const CURRENT_KEYS = new Set([
  'result_version',
  'record',
  'head',
  'restart_restore',
  'persistence_evidence',
]);
const HEAD_KEYS = new Set([
  'schema_version',
  'record_kind',
  'project_id',
  'revision',
  'revision_digest',
  'head_digest',
]);
const PERSISTENCE_KEYS = new Set([
  'evidence_version',
  'operation',
  'authority_scope',
  'cross_process_cas',
  'sudden_power_loss_durability',
  'revision_file_fsync',
  'immutable_revision_publish',
  'revision_parent_directory_fsync',
  'head_file_fsync',
  'head_publish',
  'head_parent_directory_fsync',
  'reopened_hash_verified',
]);
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const COMMIT_REVISION_FSYNC = new Set(['proven', 'not_performed_existing_exact']);
const COMMIT_IMMUTABLE_PUBLISH = new Set(['no_clobber_completed', 'existing_exact']);
const DIRECTORY_FSYNC = new Set(['proven', 'not_proven']);

function evidenceError(): BuilderRepositoryEvidenceError {
  return new BuilderRepositoryEvidenceError();
}

function assertDataGraph(
  value: unknown,
  seen: WeakSet<object> = new WeakSet<object>(),
): void {
  if (value === null || ['boolean', 'number', 'string', 'undefined'].includes(typeof value)) return;
  if (typeof value !== 'object' || seen.has(value)) throw evidenceError();
  seen.add(value);
  try {
    const isArray = Array.isArray(value);
    const prototype = Object.getPrototypeOf(value);
    if (
      (isArray && prototype !== Array.prototype)
      || (!isArray && prototype !== Object.prototype && prototype !== null)
    ) {
      throw evidenceError();
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const key of Reflect.ownKeys(descriptors)) {
      if (typeof key !== 'string') throw evidenceError();
      const descriptor = descriptors[key];
      if (!descriptor || 'get' in descriptor || 'set' in descriptor) throw evidenceError();
      if (isArray && key === 'length') continue;
      if (!descriptor.enumerable) throw evidenceError();
      assertDataGraph(descriptor.value, seen);
    }
  } catch (error) {
    if (error instanceof BuilderRepositoryEvidenceError) throw error;
    throw evidenceError();
  }
}

function assertStructuredCloneable(value: unknown): void {
  assertDataGraph(value);
  try {
    structuredClone(value);
  } catch {
    throw evidenceError();
  }
}

function exactRecord(value: unknown, expectedKeys: ReadonlySet<string>): Record<string, unknown> {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw evidenceError();
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw evidenceError();
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== expectedKeys.size
      || keys.some((key) => typeof key !== 'string' || !expectedKeys.has(key))
    ) {
      throw evidenceError();
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const output: Record<string, unknown> = {};
    for (const key of expectedKeys) {
      const descriptor = descriptors[key];
      if (
        !descriptor
        || 'get' in descriptor
        || 'set' in descriptor
        || !descriptor.enumerable
      ) {
        throw evidenceError();
      }
      output[key] = descriptor.value;
    }
    return output;
  } catch (error) {
    if (error instanceof BuilderRepositoryEvidenceError) throw error;
    throw evidenceError();
  }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number' && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`)
      .join(',')}}`;
  }
  throw evidenceError();
}

async function sha256(value: string): Promise<string> {
  try {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return `sha256:${Array.from(
      new Uint8Array(digest),
      (byte) => byte.toString(16).padStart(2, '0'),
    ).join('')}`;
  } catch {
    throw evidenceError();
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

async function sanitizeHead(
  value: unknown,
  record: BuilderProjectRevision,
): Promise<BuilderProjectRepositoryHead> {
  const source = exactRecord(value, HEAD_KEYS);
  if (
    source.schema_version !== 1
    || source.record_kind !== 'builder_project_head'
    || source.project_id !== record.project_id
    || source.revision !== record.revision
    || source.revision_digest !== record.revision_digest
    || typeof source.head_digest !== 'string'
    || !DIGEST_PATTERN.test(source.head_digest)
  ) {
    throw evidenceError();
  }
  const body = {
    schema_version: 1,
    record_kind: 'builder_project_head',
    project_id: record.project_id,
    revision: record.revision,
    revision_digest: record.revision_digest,
  } as const;
  if (source.head_digest !== await sha256(canonicalJson(body))) throw evidenceError();
  return deepFreeze({ ...body, head_digest: source.head_digest });
}

function assertCommonPersistence(source: Record<string, unknown>): void {
  if (
    source.evidence_version !== BUILDER_PROJECT_REPOSITORY_RESULT_VERSION
    || source.authority_scope !== 'single_main_process_serialized_expected_head'
    || source.cross_process_cas !== 'not_proven'
    || source.sudden_power_loss_durability !== 'not_proven'
    || source.reopened_hash_verified !== true
  ) {
    throw evidenceError();
  }
}

function sanitizeCommitPersistence(value: unknown, replay: boolean): void {
  const source = exactRecord(value, PERSISTENCE_KEYS);
  assertCommonPersistence(source);
  if (replay) {
    if (
      source.operation !== 'replayed'
      || source.revision_file_fsync !== 'not_performed'
      || source.immutable_revision_publish !== 'not_performed'
      || source.revision_parent_directory_fsync !== 'not_performed'
      || source.head_file_fsync !== 'not_performed'
      || source.head_publish !== 'not_performed'
      || source.head_parent_directory_fsync !== 'not_performed'
    ) {
      throw evidenceError();
    }
    return;
  }
  if (
    source.operation !== 'committed'
    || typeof source.revision_file_fsync !== 'string'
    || !COMMIT_REVISION_FSYNC.has(source.revision_file_fsync)
    || typeof source.immutable_revision_publish !== 'string'
    || !COMMIT_IMMUTABLE_PUBLISH.has(source.immutable_revision_publish)
    || typeof source.revision_parent_directory_fsync !== 'string'
    || !DIRECTORY_FSYNC.has(source.revision_parent_directory_fsync)
    || source.head_file_fsync !== 'proven'
    || source.head_publish !== 'same_directory_replace_reopened'
    || typeof source.head_parent_directory_fsync !== 'string'
    || !DIRECTORY_FSYNC.has(source.head_parent_directory_fsync)
  ) {
    throw evidenceError();
  }
}

function sanitizeCurrentPersistence(value: unknown): void {
  const source = exactRecord(value, PERSISTENCE_KEYS);
  assertCommonPersistence(source);
  if (
    source.operation !== 'current_loaded'
    || source.revision_file_fsync !== 'not_performed'
    || source.immutable_revision_publish !== 'not_performed'
    || source.revision_parent_directory_fsync !== 'not_performed'
    || source.head_file_fsync !== 'not_performed'
    || source.head_publish !== 'not_performed'
    || source.head_parent_directory_fsync !== 'not_performed'
  ) {
    throw evidenceError();
  }
}

async function verifiedRecord(value: unknown): Promise<BuilderProjectRevision> {
  try {
    return await verifyBuilderProjectRevision(value);
  } catch {
    throw evidenceError();
  }
}

function sameRevision(left: BuilderProjectRevision, right: BuilderProjectRevision): boolean {
  return left.project_id === right.project_id
    && left.revision === right.revision
    && left.revision_digest === right.revision_digest;
}

export async function sanitizeBuilderRepositoryCommitEvidence(
  value: unknown,
  expectedRevision: unknown,
): Promise<BuilderProjectRepositoryCommitEvidence> {
  assertStructuredCloneable(value);
  const source = exactRecord(value, COMMIT_KEYS);
  if (source.result_version !== BUILDER_PROJECT_REPOSITORY_RESULT_VERSION) throw evidenceError();
  const expected = await verifiedRecord(expectedRevision);
  const record = await verifiedRecord(source.record);
  if (!sameRevision(record, expected)) throw evidenceError();
  const head = await sanitizeHead(source.head, record);
  if (typeof source.idempotent_replay !== 'boolean') throw evidenceError();
  sanitizeCommitPersistence(source.persistence_evidence, source.idempotent_replay);
  return deepFreeze({ record, head, idempotent_replay: source.idempotent_replay });
}

export async function sanitizeBuilderRepositoryCurrentEvidence(
  value: unknown,
  expectedRevision?: unknown,
): Promise<BuilderProjectRepositoryCurrentEvidence> {
  assertStructuredCloneable(value);
  const source = exactRecord(value, CURRENT_KEYS);
  if (
    source.result_version !== BUILDER_PROJECT_REPOSITORY_RESULT_VERSION
    || source.restart_restore !== true
  ) {
    throw evidenceError();
  }
  const record = await verifiedRecord(source.record);
  if (expectedRevision !== undefined) {
    const expected = await verifiedRecord(expectedRevision);
    if (!sameRevision(record, expected)) throw evidenceError();
  }
  const head = await sanitizeHead(source.head, record);
  sanitizeCurrentPersistence(source.persistence_evidence);
  return deepFreeze({ record, head, restart_restore: true });
}
