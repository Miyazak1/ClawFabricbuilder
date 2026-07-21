'use strict';

const nodeCrypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { TextDecoder: NodeTextDecoder, types: utilTypes } = require('node:util');

const {
  MAX_RECORD_BYTES,
  BuilderProjectRevisionRecordError,
  sanitizeBuilderProjectRevisionRecord,
  serializeBuilderProjectRevisionRecord,
} = require('./builder-project-revision-record.cjs');

const REPOSITORY_RESULT_VERSION = 'builder-project-repository-result.v1';
const CATALOG_RESULT_VERSION = 'builder-project-catalog-result.v1';
const HEAD_SCHEMA_VERSION = 1;
const HEAD_RECORD_KIND = 'builder_project_head';
const REPOSITORY_DIRECTORY_NAME = 'builder-project-revisions';
const MAX_HEAD_BYTES = 1_024;
const MAX_VERIFIED_CHAIN_LENGTH = 10_000;
const MAX_DISCOVERABLE_PROJECTS = 256;
const MAX_CATALOG_FILE_READS = 1_024;
const MAX_CATALOG_BYTES = 32 * 1024 * 1024;
const PROJECT_ID_PATTERN = /^builder-project:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const PROJECT_STORAGE_HASH_PATTERN = /^[0-9a-f]{64}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const NONCE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const COMMIT_KEYS = Object.freeze(['revision', 'expected_previous']);
const LOAD_CURRENT_KEYS = Object.freeze(['project_id']);
const LOAD_REVISION_KEYS = Object.freeze(['project_id', 'revision', 'revision_digest']);
const PARENT_KEYS = Object.freeze(['revision', 'revision_digest']);
const HEAD_BODY_KEYS = Object.freeze([
  'schema_version', 'record_kind', 'project_id', 'revision', 'revision_digest',
]);
const HEAD_KEYS = Object.freeze([...HEAD_BODY_KEYS, 'head_digest']);
const PROJECT_QUEUES = new Map();
const UTF8_DECODER = new NodeTextDecoder('utf-8', { fatal: true, ignoreBOM: true });

const ERROR_MESSAGES = Object.freeze({
  builder_project_repository_invalid: 'The local project request could not be verified.',
  builder_project_repository_not_found: 'The local project version is unavailable.',
  builder_project_repository_conflict: 'The local project changed before this version could be saved.',
  builder_project_repository_resource_exceeded: 'The saved project collection is too large to verify safely.',
  builder_project_repository_integrity_failed: 'The saved local project could not be verified.',
  builder_project_repository_persistence_failed: 'The local project could not be saved.',
  builder_project_repository_cleanup_failed: 'The local project storage could not be cleaned up safely.',
});

class BuilderProjectRevisionRepositoryError extends Error {
  constructor(code = 'builder_project_repository_invalid') {
    const selected = Object.hasOwn(ERROR_MESSAGES, code) ? code : 'builder_project_repository_invalid';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderProjectRevisionRepositoryError';
    this.code = selected;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) {
  throw new BuilderProjectRevisionRepositoryError(code);
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || utilTypes.isProxy(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertExactObject(value, expectedKeys, code = 'builder_project_repository_invalid') {
  if (!isPlainObject(value)) fail(code);
  const keys = Reflect.ownKeys(value);
  if (keys.length !== expectedKeys.length
    || keys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))) fail(code);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail(code);
  }
}

function valueAt(value, key, code = 'builder_project_repository_invalid') {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail(code);
  return descriptor.value;
}

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freezeDeep(nested);
    Object.freeze(value);
  }
  return value;
}

function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number' && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  if (isPlainObject(value)) {
    const entries = Object.keys(value)
      .sort((left, right) => left < right ? -1 : left > right ? 1 : 0)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
    return `{${entries.join(',')}}`;
  }
  fail('builder_project_repository_integrity_failed');
}

function sha256Hex(value) {
  return nodeCrypto.createHash('sha256').update(value).digest('hex');
}

function sha256Canonical(value) {
  return `sha256:${sha256Hex(Buffer.from(canonicalJson(value), 'utf8'))}`;
}

function safeProjectId(value, code = 'builder_project_repository_invalid') {
  if (typeof value !== 'string' || !PROJECT_ID_PATTERN.test(value)) fail(code);
  return value;
}

function safeDigest(value, code = 'builder_project_repository_invalid') {
  if (typeof value !== 'string' || !DIGEST_PATTERN.test(value)) fail(code);
  return value;
}

function safeRevision(value, code = 'builder_project_repository_invalid') {
  if (!Number.isSafeInteger(value) || value < 1) fail(code);
  return value;
}

function safeRootPath(value) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > 1_024
    || value.trim() !== value
    || /[\u0000-\u001f\u007f]/u.test(value)
    || !path.isAbsolute(value)
    || path.resolve(value) !== value
  ) fail('builder_project_repository_invalid');
  return value;
}

function sanitizeParent(value) {
  if (value === null) return null;
  assertExactObject(value, PARENT_KEYS);
  return freezeDeep({
    revision: safeRevision(valueAt(value, 'revision')),
    revision_digest: safeDigest(valueAt(value, 'revision_digest')),
  });
}

function sameParent(left, right) {
  return left === null
    ? right === null
    : right !== null
      && left.revision === right.revision
      && left.revision_digest === right.revision_digest;
}

function sanitizeCommitRequest(value) {
  assertExactObject(value, COMMIT_KEYS);
  let revision;
  try { revision = sanitizeBuilderProjectRevisionRecord(valueAt(value, 'revision')); } catch (error) {
    if (error instanceof BuilderProjectRevisionRecordError) fail('builder_project_repository_invalid');
    throw error;
  }
  const expectedPrevious = sanitizeParent(valueAt(value, 'expected_previous'));
  if (!sameParent(revision.parent_revision, expectedPrevious)) {
    fail('builder_project_repository_invalid');
  }
  return freezeDeep({ revision, expected_previous: expectedPrevious });
}

function sanitizeLoadCurrentRequest(value) {
  assertExactObject(value, LOAD_CURRENT_KEYS);
  return freezeDeep({ project_id: safeProjectId(valueAt(value, 'project_id')) });
}

function sanitizeLoadRevisionRequest(value) {
  assertExactObject(value, LOAD_REVISION_KEYS);
  return freezeDeep({
    project_id: safeProjectId(valueAt(value, 'project_id')),
    revision: safeRevision(valueAt(value, 'revision')),
    revision_digest: safeDigest(valueAt(value, 'revision_digest')),
  });
}

function headBody(projectId, revision, revisionDigest) {
  return {
    schema_version: HEAD_SCHEMA_VERSION,
    record_kind: HEAD_RECORD_KIND,
    project_id: projectId,
    revision,
    revision_digest: revisionDigest,
  };
}

function createHead(record) {
  const body = headBody(record.project_id, record.revision, record.revision_digest);
  return freezeDeep({ ...body, head_digest: sha256Canonical(body) });
}

function sanitizeHead(value) {
  assertExactObject(value, HEAD_KEYS, 'builder_project_repository_integrity_failed');
  const body = headBody(
    safeProjectId(valueAt(value, 'project_id', 'builder_project_repository_integrity_failed'),
      'builder_project_repository_integrity_failed'),
    safeRevision(valueAt(value, 'revision', 'builder_project_repository_integrity_failed'),
      'builder_project_repository_integrity_failed'),
    safeDigest(valueAt(value, 'revision_digest', 'builder_project_repository_integrity_failed'),
      'builder_project_repository_integrity_failed'),
  );
  if (valueAt(value, 'schema_version', 'builder_project_repository_integrity_failed')
      !== HEAD_SCHEMA_VERSION
    || valueAt(value, 'record_kind', 'builder_project_repository_integrity_failed')
      !== HEAD_RECORD_KIND
    || safeDigest(valueAt(value, 'head_digest', 'builder_project_repository_integrity_failed'),
      'builder_project_repository_integrity_failed') !== sha256Canonical(body)) {
    fail('builder_project_repository_integrity_failed');
  }
  return freezeDeep({ ...body, head_digest: sha256Canonical(body) });
}

function serializeHead(value) {
  return `${canonicalJson(sanitizeHead(value))}\n`;
}

function assertDirectory(directory, allowCreate) {
  if (!fs.existsSync(directory)) {
    if (!allowCreate) fail('builder_project_repository_invalid');
    try { fs.mkdirSync(directory, { recursive: false }); } catch (error) {
      if (!error || error.code !== 'EEXIST') fail('builder_project_repository_persistence_failed');
    }
  }
  let info;
  try { info = fs.lstatSync(directory); } catch { fail('builder_project_repository_persistence_failed'); }
  if (!info.isDirectory() || info.isSymbolicLink()) fail('builder_project_repository_integrity_failed');
}

function captureDirectoryIdentity(directory) {
  let info;
  let realPath;
  try {
    info = fs.lstatSync(directory, { bigint: true });
    realPath = fs.realpathSync.native(directory);
  } catch {
    fail('builder_project_repository_integrity_failed');
  }
  if (!info.isDirectory() || info.isSymbolicLink() || realPath !== directory) {
    fail('builder_project_repository_integrity_failed');
  }
  return freezeDeep({ path: directory, dev: info.dev, ino: info.ino });
}

function assertDirectoryIdentity(identity) {
  const current = captureDirectoryIdentity(identity.path);
  if (current.dev !== identity.dev || current.ino !== identity.ino) {
    fail('builder_project_repository_integrity_failed');
  }
}

function assertRepositoryAuthority(context) {
  assertDirectoryIdentity(context.root_identity);
  assertDirectoryIdentity(context.projects_identity);
}

function projectStorageHash(projectId) {
  return sha256Hex(Buffer.from(`builder-project-repository/project\0${projectId}`, 'utf8'));
}

function storagePaths(context, projectId, create) {
  assertRepositoryAuthority(context);
  const projectsDirectory = context.projects_directory;
  const projectHash = projectStorageHash(projectId);
  const projectDirectory = path.join(projectsDirectory, projectHash);
  const revisionsDirectory = path.join(projectDirectory, 'revisions');
  if (create) {
    assertDirectory(projectDirectory, true);
    assertDirectory(revisionsDirectory, true);
  } else {
    if (!fs.existsSync(projectDirectory)) fail('builder_project_repository_not_found');
    assertDirectory(projectDirectory, false);
    assertDirectory(revisionsDirectory, false);
  }
  const projectIdentity = captureDirectoryIdentity(projectDirectory);
  const revisionsIdentity = captureDirectoryIdentity(revisionsDirectory);
  return freezeDeep({
    project_hash: projectHash,
    project_directory: projectDirectory,
    revisions_directory: revisionsDirectory,
    head_path: path.join(projectDirectory, 'head.json'),
    project_identity: projectIdentity,
    revisions_identity: revisionsIdentity,
  });
}

function assertStorageAuthority(paths) {
  assertDirectoryIdentity(paths.project_identity);
  assertDirectoryIdentity(paths.revisions_identity);
}

function revisionPath(paths, revision, revisionDigest) {
  const digestHex = safeDigest(revisionDigest, 'builder_project_repository_integrity_failed').slice(7);
  return path.join(paths.revisions_directory, `${safeRevision(
    revision, 'builder_project_repository_integrity_failed',
  )}-${digestHex}.json`);
}

function decodeStrictUtf8(bytes, code) {
  try {
    const text = UTF8_DECODER.decode(bytes);
    if (!Buffer.from(text, 'utf8').equals(bytes)) fail(code);
    return text;
  } catch (error) {
    if (error instanceof BuilderProjectRevisionRepositoryError) throw error;
    fail(code);
  }
}

function consumeReadBudget(readBudget, size) {
  if (readBudget === null) return;
  const byteLength = Number(size);
  if (
    readBudget.files + 1 > MAX_CATALOG_FILE_READS
    || readBudget.bytes + byteLength > MAX_CATALOG_BYTES
  ) {
    fail('builder_project_repository_resource_exceeded');
  }
  readBudget.files += 1;
  readBudget.bytes += byteLength;
}

function readBoundedFile(filePath, maximumBytes, notFoundCode, readBudget = null) {
  let descriptor = null;
  try {
    const pathInfo = fs.lstatSync(filePath, { bigint: true });
    if (!pathInfo.isFile() || pathInfo.isSymbolicLink()) {
      fail('builder_project_repository_integrity_failed');
    }
    descriptor = fs.openSync(filePath, 'r');
    const descriptorInfo = fs.fstatSync(descriptor, { bigint: true });
    if (!descriptorInfo.isFile()
      || descriptorInfo.dev !== pathInfo.dev
      || descriptorInfo.ino !== pathInfo.ino
      || descriptorInfo.size < 1n
      || descriptorInfo.size > BigInt(maximumBytes)) {
      fail('builder_project_repository_integrity_failed');
    }
    consumeReadBudget(readBudget, descriptorInfo.size);
    const expectedBytes = Number(descriptorInfo.size);
    const boundedBytes = Buffer.allocUnsafe(expectedBytes + 1);
    const bytesRead = fs.readSync(descriptor, boundedBytes, 0, boundedBytes.length, 0);
    const reopenedInfo = fs.fstatSync(descriptor, { bigint: true });
    if (bytesRead !== expectedBytes
      || !reopenedInfo.isFile()
      || reopenedInfo.dev !== descriptorInfo.dev
      || reopenedInfo.ino !== descriptorInfo.ino
      || reopenedInfo.size !== descriptorInfo.size) {
      fail('builder_project_repository_integrity_failed');
    }
    const bytes = boundedBytes.subarray(0, expectedBytes);
    fs.closeSync(descriptor);
    descriptor = null;
    return bytes;
  } catch (error) {
    if (descriptor !== null) {
      try { fs.closeSync(descriptor); } catch { /* stable error below */ }
    }
    if (error instanceof BuilderProjectRevisionRepositoryError) throw error;
    if (error && typeof error === 'object' && error.code === 'ENOENT') fail(notFoundCode);
    fail('builder_project_repository_integrity_failed');
  }
}

function readRevision(
  filePath,
  notFoundCode = 'builder_project_repository_not_found',
  readBudget = null,
) {
  const text = decodeStrictUtf8(readBoundedFile(
    filePath, MAX_RECORD_BYTES, notFoundCode, readBudget,
  ),
    'builder_project_repository_integrity_failed');
  let parsed;
  try { parsed = JSON.parse(text); } catch { fail('builder_project_repository_integrity_failed'); }
  let record;
  try { record = sanitizeBuilderProjectRevisionRecord(parsed); } catch {
    fail('builder_project_repository_integrity_failed');
  }
  if (serializeBuilderProjectRevisionRecord(record) !== text) {
    fail('builder_project_repository_integrity_failed');
  }
  return record;
}

function readHead(headPath, missingAllowed, readBudget = null) {
  let bytes;
  try {
    bytes = readBoundedFile(
      headPath, MAX_HEAD_BYTES, 'builder_project_repository_not_found', readBudget,
    );
  } catch (error) {
    if (missingAllowed && error instanceof BuilderProjectRevisionRepositoryError
      && error.code === 'builder_project_repository_not_found') return null;
    throw error;
  }
  const text = decodeStrictUtf8(bytes, 'builder_project_repository_integrity_failed');
  let parsed;
  try { parsed = JSON.parse(text); } catch { fail('builder_project_repository_integrity_failed'); }
  const head = sanitizeHead(parsed);
  if (serializeHead(head) !== text) fail('builder_project_repository_integrity_failed');
  return head;
}

function readExactRevision(
  paths,
  projectId,
  revision,
  revisionDigest,
  notFoundCode,
  readBudget = null,
) {
  assertStorageAuthority(paths);
  const record = readRevision(
    revisionPath(paths, revision, revisionDigest), notFoundCode, readBudget,
  );
  assertStorageAuthority(paths);
  if (record.project_id !== projectId
    || record.revision !== revision
    || record.revision_digest !== revisionDigest) {
    fail('builder_project_repository_integrity_failed');
  }
  return record;
}

function verifyChainToGenesis(paths, current, readBudget = null) {
  if (current.revision > MAX_VERIFIED_CHAIN_LENGTH) {
    fail('builder_project_repository_integrity_failed');
  }
  let record = current;
  while (record.parent_revision !== null) {
    const parent = record.parent_revision;
    const previous = readExactRevision(
      paths, current.project_id, parent.revision, parent.revision_digest,
      'builder_project_repository_integrity_failed',
      readBudget,
    );
    if (previous.revision !== record.revision - 1) {
      fail('builder_project_repository_integrity_failed');
    }
    record = previous;
  }
  if (record.revision !== 1) fail('builder_project_repository_integrity_failed');
}

function tryFsyncDirectory(directory) {
  let descriptor = null;
  try {
    descriptor = fs.openSync(directory, 'r');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    return 'proven';
  } catch {
    if (descriptor !== null) {
      try { fs.closeSync(descriptor); } catch { /* remains not_proven */ }
    }
    return 'not_proven';
  }
}

function safeNonce() {
  const nonce = nodeCrypto.randomUUID();
  if (!NONCE_PATTERN.test(nonce)) fail('builder_project_repository_persistence_failed');
  return nonce;
}

function writeImmutableRevision(paths, record) {
  assertStorageAuthority(paths);
  const targetPath = revisionPath(paths, record.revision, record.revision_digest);
  const tempPath = path.join(paths.revisions_directory,
    `.${record.revision}-${record.revision_digest.slice(7)}-${safeNonce()}.pending`);
  const text = serializeBuilderProjectRevisionRecord(record);
  let descriptor = null;
  let tempExists = false;
  try {
    descriptor = fs.openSync(tempPath, 'wx');
    tempExists = true;
    fs.writeFileSync(descriptor, text, 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    try {
      fs.linkSync(tempPath, targetPath);
    } catch (error) {
      if (!error || error.code !== 'EEXIST') throw error;
      const existing = readRevision(targetPath, 'builder_project_repository_integrity_failed');
      if (existing.revision_digest !== record.revision_digest
        || serializeBuilderProjectRevisionRecord(existing) !== text) {
        fail('builder_project_repository_integrity_failed');
      }
      fs.unlinkSync(tempPath);
      tempExists = false;
      return freezeDeep({
        record: existing,
        file_fsync: 'not_performed_existing_exact',
        immutable_publish: 'existing_exact',
        parent_directory_fsync: 'not_performed',
      });
    }
    fs.unlinkSync(tempPath);
    tempExists = false;
    const parentDirectoryFsync = tryFsyncDirectory(paths.revisions_directory);
    const reopened = readRevision(targetPath, 'builder_project_repository_integrity_failed');
    if (reopened.revision_digest !== record.revision_digest
      || serializeBuilderProjectRevisionRecord(reopened) !== text) {
      fail('builder_project_repository_integrity_failed');
    }
    return freezeDeep({
      record: reopened,
      file_fsync: 'proven',
      immutable_publish: 'no_clobber_completed',
      parent_directory_fsync: parentDirectoryFsync,
    });
  } catch (error) {
    if (descriptor !== null) {
      try { fs.closeSync(descriptor); } catch { /* exact cleanup below */ }
    }
    if (tempExists) {
      try { fs.unlinkSync(tempPath); } catch { fail('builder_project_repository_cleanup_failed'); }
    }
    if (error instanceof BuilderProjectRevisionRepositoryError) throw error;
    fail('builder_project_repository_persistence_failed');
  }
}

function publishHead(paths, expectedPrevious, record) {
  assertStorageAuthority(paths);
  const observed = readHead(paths.head_path, true);
  if (expectedPrevious === null ? observed !== null : observed === null
    || (expectedPrevious !== null && (observed.revision !== expectedPrevious.revision
      || observed.revision_digest !== expectedPrevious.revision_digest))) {
    fail('builder_project_repository_conflict');
  }

  const head = createHead(record);
  const text = serializeHead(head);
  const tempPath = path.join(paths.project_directory, `.head-${safeNonce()}.pending`);
  let descriptor = null;
  let tempExists = false;
  try {
    descriptor = fs.openSync(tempPath, 'wx');
    tempExists = true;
    fs.writeFileSync(descriptor, text, 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    fs.renameSync(tempPath, paths.head_path);
    tempExists = false;
    const parentDirectoryFsync = tryFsyncDirectory(paths.project_directory);
    const reopened = readHead(paths.head_path, false);
    if (reopened.head_digest !== head.head_digest || serializeHead(reopened) !== text) {
      fail('builder_project_repository_integrity_failed');
    }
    return freezeDeep({
      head: reopened,
      file_fsync: 'proven',
      publish: 'same_directory_replace_reopened',
      parent_directory_fsync: parentDirectoryFsync,
    });
  } catch (error) {
    if (descriptor !== null) {
      try { fs.closeSync(descriptor); } catch { /* exact cleanup below */ }
    }
    if (tempExists) {
      try { fs.unlinkSync(tempPath); } catch { fail('builder_project_repository_cleanup_failed'); }
    }
    if (error instanceof BuilderProjectRevisionRepositoryError) throw error;
    fail('builder_project_repository_persistence_failed');
  }
}

function persistenceEvidence(operation, revisionEvidence, headEvidence) {
  return freezeDeep({
    evidence_version: REPOSITORY_RESULT_VERSION,
    operation,
    authority_scope: 'single_main_process_serialized_expected_head',
    cross_process_cas: 'not_proven',
    sudden_power_loss_durability: 'not_proven',
    revision_file_fsync: revisionEvidence,
    immutable_revision_publish: headEvidence === null ? 'not_performed' : headEvidence.immutable_publish,
    revision_parent_directory_fsync: headEvidence === null
      ? 'not_performed' : headEvidence.parent_directory_fsync,
    head_file_fsync: operation === 'committed' ? 'proven' : 'not_performed',
    head_publish: operation === 'committed' ? 'same_directory_replace_reopened' : 'not_performed',
    head_parent_directory_fsync: operation === 'committed'
      ? headEvidence.head_parent_directory_fsync : 'not_performed',
    reopened_hash_verified: true,
  });
}

function commitRevision(context, request) {
  const { revision, expected_previous: expectedPrevious } = request;
  const paths = storagePaths(context, revision.project_id, true);
  const current = readHead(paths.head_path, true);
  if (current !== null
    && current.revision === revision.revision
    && current.revision_digest === revision.revision_digest) {
    const existing = readExactRevision(
      paths, revision.project_id, revision.revision, revision.revision_digest,
      'builder_project_repository_integrity_failed',
    );
    verifyChainToGenesis(paths, existing);
    return freezeDeep({
      result_version: REPOSITORY_RESULT_VERSION,
      record: existing,
      head: current,
      idempotent_replay: true,
      persistence_evidence: persistenceEvidence('replayed', 'not_performed', null),
    });
  }
  if (expectedPrevious === null ? current !== null : current === null
    || (expectedPrevious !== null && (current.revision !== expectedPrevious.revision
      || current.revision_digest !== expectedPrevious.revision_digest))) {
    fail('builder_project_repository_conflict');
  }
  if (current !== null) {
    readExactRevision(
      paths, revision.project_id, current.revision, current.revision_digest,
      'builder_project_repository_integrity_failed',
    );
  }
  const persisted = writeImmutableRevision(paths, revision);
  verifyChainToGenesis(paths, persisted.record);
  const published = publishHead(paths, expectedPrevious, persisted.record);
  return freezeDeep({
    result_version: REPOSITORY_RESULT_VERSION,
    record: persisted.record,
    head: published.head,
    idempotent_replay: false,
    persistence_evidence: persistenceEvidence('committed', persisted.file_fsync, {
      immutable_publish: persisted.immutable_publish,
      parent_directory_fsync: persisted.parent_directory_fsync,
      head_parent_directory_fsync: published.parent_directory_fsync,
    }),
  });
}

function loadCurrentFromPaths(paths, projectId, readBudget = null) {
  assertStorageAuthority(paths);
  if (paths.project_hash !== projectStorageHash(projectId)) {
    fail('builder_project_repository_integrity_failed');
  }
  const head = readHead(paths.head_path, false, readBudget);
  assertStorageAuthority(paths);
  if (head.project_id !== projectId) fail('builder_project_repository_integrity_failed');
  const record = readExactRevision(
    paths, projectId, head.revision, head.revision_digest,
    'builder_project_repository_integrity_failed', readBudget,
  );
  verifyChainToGenesis(paths, record, readBudget);
  assertStorageAuthority(paths);
  return freezeDeep({
    result_version: REPOSITORY_RESULT_VERSION,
    record,
    head,
    restart_restore: true,
    persistence_evidence: persistenceEvidence('current_loaded', 'not_performed', null),
  });
}

function loadCurrent(context, request) {
  const paths = storagePaths(context, request.project_id, false);
  return loadCurrentFromPaths(paths, request.project_id);
}

function readProjectDirectoryEntries(context) {
  assertRepositoryAuthority(context);
  let directory = null;
  const entries = [];
  try {
    directory = fs.opendirSync(context.projects_directory);
    while (true) {
      const entry = directory.readSync();
      if (entry === null) break;
      if (entries.length >= MAX_DISCOVERABLE_PROJECTS) {
        fail('builder_project_repository_resource_exceeded');
      }
      if (
        typeof entry.name !== 'string'
        || !PROJECT_STORAGE_HASH_PATTERN.test(entry.name)
        || !entry.isDirectory()
        || entry.isSymbolicLink()
      ) {
        fail('builder_project_repository_integrity_failed');
      }
      const projectDirectory = path.join(context.projects_directory, entry.name);
      entries.push({
        project_hash: entry.name,
        project_identity: captureDirectoryIdentity(projectDirectory),
      });
    }
    directory.closeSync();
    directory = null;
  } catch (error) {
    if (directory !== null) {
      try { directory.closeSync(); } catch { /* stable integrity error below */ }
    }
    if (error instanceof BuilderProjectRevisionRepositoryError) throw error;
    fail('builder_project_repository_integrity_failed');
  }
  entries.sort((left, right) => (
    left.project_hash < right.project_hash ? -1 : left.project_hash > right.project_hash ? 1 : 0
  ));
  return entries;
}

function listCurrent(context) {
  const projects = [];
  const readBudget = { files: 0, bytes: 0 };
  for (const entry of readProjectDirectoryEntries(context)) {
    assertRepositoryAuthority(context);
    const projectHash = entry.project_hash;
    const projectDirectory = path.join(context.projects_directory, projectHash);
    assertDirectoryIdentity(entry.project_identity);
    const head = readHead(path.join(projectDirectory, 'head.json'), true, readBudget);
    assertDirectoryIdentity(entry.project_identity);
    if (head === null) continue;
    if (projectStorageHash(head.project_id) !== projectHash) {
      fail('builder_project_repository_integrity_failed');
    }
    const revisionsDirectory = path.join(projectDirectory, 'revisions');
    const paths = freezeDeep({
      project_hash: projectHash,
      project_directory: projectDirectory,
      revisions_directory: revisionsDirectory,
      head_path: path.join(projectDirectory, 'head.json'),
      project_identity: entry.project_identity,
      revisions_identity: captureDirectoryIdentity(revisionsDirectory),
    });
    assertDirectoryIdentity(entry.project_identity);
    const current = loadCurrentFromPaths(paths, head.project_id, readBudget);
    if (
      current.head.project_id !== head.project_id
      || projectStorageHash(current.record.project_id) !== projectHash
    ) {
      fail('builder_project_repository_integrity_failed');
    }
    projects.push({
      project_id: current.record.project_id,
      title: current.record.title,
      summary: current.record.summary,
      revision: current.record.revision,
      revision_digest: current.record.revision_digest,
    });
  }
  projects.sort((left, right) => (
    left.project_id < right.project_id ? -1 : left.project_id > right.project_id ? 1 : 0
  ));
  return freezeDeep({
    result_version: CATALOG_RESULT_VERSION,
    projects,
    catalog_evidence: {
      source_authority: 'verified_project_head_and_revision_chain',
      ordering: 'project_id_ascending',
      recency: 'not_available',
      global_atomic_snapshot: 'not_proven',
      headless_orphans: 'excluded',
      write_activity: 'none',
      resource_bounds: {
        max_project_directories: MAX_DISCOVERABLE_PROJECTS,
        max_file_reads: MAX_CATALOG_FILE_READS,
        max_bytes: MAX_CATALOG_BYTES,
      },
    },
  });
}

function readReachableRevision(paths, request) {
  assertStorageAuthority(paths);
  const head = readHead(paths.head_path, false);
  if (head.project_id !== request.project_id || request.revision > head.revision) {
    fail('builder_project_repository_not_found');
  }
  let current = readExactRevision(
    paths, request.project_id, head.revision, head.revision_digest,
    'builder_project_repository_integrity_failed',
  );
  let selected = null;
  let visited = 0;
  while (true) {
    visited += 1;
    if (visited > MAX_VERIFIED_CHAIN_LENGTH) fail('builder_project_repository_integrity_failed');
    if (current.revision === request.revision
      && current.revision_digest === request.revision_digest) selected = current;
    if (current.parent_revision === null) break;
    current = readExactRevision(
      paths,
      request.project_id,
      current.parent_revision.revision,
      current.parent_revision.revision_digest,
      'builder_project_repository_integrity_failed',
    );
  }
  if (current.revision !== 1) fail('builder_project_repository_integrity_failed');
  if (selected === null) fail('builder_project_repository_not_found');
  return selected;
}

function loadRevision(context, request) {
  const paths = storagePaths(context, request.project_id, false);
  const record = readReachableRevision(paths, request);
  return freezeDeep({
    result_version: REPOSITORY_RESULT_VERSION,
    record,
    restart_restore: true,
    persistence_evidence: persistenceEvidence('revision_loaded', 'not_performed', null),
  });
}

function normalizeOperationError(error) {
  if (error instanceof BuilderProjectRevisionRepositoryError) return error;
  if (error instanceof BuilderProjectRevisionRecordError) {
    return new BuilderProjectRevisionRepositoryError('builder_project_repository_invalid');
  }
  return new BuilderProjectRevisionRepositoryError('builder_project_repository_persistence_failed');
}

function enqueueProject(queueKey, operation) {
  const previous = PROJECT_QUEUES.get(queueKey) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(operation);
  const tracked = run.then(
    () => undefined,
    () => undefined,
  ).finally(() => {
    if (PROJECT_QUEUES.get(queueKey) === tracked) PROJECT_QUEUES.delete(queueKey);
  });
  PROJECT_QUEUES.set(queueKey, tracked);
  return run;
}

function createBuilderProjectRevisionRepository(rootPath) {
  const requestedRoot = safeRootPath(rootPath);
  assertDirectory(requestedRoot, false);
  let repositoryRoot;
  try { repositoryRoot = safeRootPath(fs.realpathSync.native(requestedRoot)); } catch (error) {
    if (error instanceof BuilderProjectRevisionRepositoryError) throw error;
    fail('builder_project_repository_invalid');
  }
  const projectsDirectory = path.join(repositoryRoot, REPOSITORY_DIRECTORY_NAME);
  assertDirectory(projectsDirectory, true);
  const context = freezeDeep({
    repository_root: repositoryRoot,
    projects_directory: projectsDirectory,
    root_identity: captureDirectoryIdentity(repositoryRoot),
    projects_identity: captureDirectoryIdentity(projectsDirectory),
  });

  return freezeDeep({
    commit(rawRequest) {
      let request;
      try { request = sanitizeCommitRequest(rawRequest); } catch (error) {
        return Promise.reject(normalizeOperationError(error));
      }
      const queueKey = `${repositoryRoot}\0${projectStorageHash(request.revision.project_id)}`;
      return enqueueProject(queueKey, () => commitRevision(context, request))
        .catch((error) => { throw normalizeOperationError(error); });
    },

    load_current(rawRequest) {
      let request;
      try { request = sanitizeLoadCurrentRequest(rawRequest); } catch (error) {
        return Promise.reject(normalizeOperationError(error));
      }
      const queueKey = `${repositoryRoot}\0${projectStorageHash(request.project_id)}`;
      return enqueueProject(queueKey, () => loadCurrent(context, request))
        .catch((error) => { throw normalizeOperationError(error); });
    },

    list_current(...rawArguments) {
      if (rawArguments.length !== 0) {
        return Promise.reject(new BuilderProjectRevisionRepositoryError(
          'builder_project_repository_invalid',
        ));
      }
      return Promise.resolve()
        .then(() => listCurrent(context))
        .catch((error) => { throw normalizeOperationError(error); });
    },

    load_revision(rawRequest) {
      let request;
      try { request = sanitizeLoadRevisionRequest(rawRequest); } catch (error) {
        return Promise.reject(normalizeOperationError(error));
      }
      const queueKey = `${repositoryRoot}\0${projectStorageHash(request.project_id)}`;
      return enqueueProject(queueKey, () => loadRevision(context, request))
        .catch((error) => { throw normalizeOperationError(error); });
    },
  });
}

module.exports = Object.freeze({
  REPOSITORY_RESULT_VERSION,
  CATALOG_RESULT_VERSION,
  BuilderProjectRevisionRepositoryError,
  createBuilderProjectRevisionRepository,
});
