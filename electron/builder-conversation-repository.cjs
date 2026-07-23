'use strict';

const nodeCrypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { TextDecoder: NodeTextDecoder, types: utilTypes } = require('node:util');

const {
  MAX_EVENT_SEQUENCE,
  MAX_EVENT_RECORD_BYTES,
  BuilderConversationRecordError,
  sanitizeBuilderConversationEvent,
  serializeBuilderConversationEvent,
} = require('./builder-conversation-records.cjs');
const {
  BuilderConversationReplayError,
  replayBuilderConversation,
} = require('./builder-conversation-replay.cjs');

const CONVERSATION_REPOSITORY_RESULT_VERSION = 'builder-conversation-repository-result.v1';
const REPOSITORY_DIRECTORY_NAME = 'builder-conversations';
const HEAD_SCHEMA_VERSION = 1;
const HEAD_RECORD_KIND = 'builder_conversation_head';
const MAX_HEAD_BYTES = 2_048;
const MAX_CHAIN_READ_BYTES = 32 * 1_024 * 1_024;
const MAX_CHAIN_FILE_READS = MAX_EVENT_SEQUENCE + 1;
const MAX_APPEND_FILE_READS = (MAX_EVENT_SEQUENCE * 2) + 4;
const MAX_APPEND_READ_BYTES = (MAX_CHAIN_READ_BYTES * 2)
  + (MAX_EVENT_RECORD_BYTES * 2) + (MAX_HEAD_BYTES * 3);
const MAX_LOAD_FILE_READS = MAX_EVENT_SEQUENCE + 1;
const MAX_LOAD_READ_BYTES = MAX_CHAIN_READ_BYTES + MAX_HEAD_BYTES;
const PROJECT_ID_PATTERN = /^builder-project:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CONVERSATION_ID_PATTERN = /^builder-conversation:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const EVENT_ID_PATTERN = /^builder-conversation-event:[0-9a-f]{64}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const NONCE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const APPEND_KEYS = Object.freeze(['event', 'expected_head']);
const LOAD_KEYS = Object.freeze(['project_id']);
const EXPECTED_HEAD_KEYS = Object.freeze([
  'conversation_id', 'sequence', 'event_id', 'event_digest',
]);
const HEAD_BODY_KEYS = Object.freeze([
  'schema_version', 'record_kind', 'project_id', 'conversation_id', 'sequence', 'event_id',
  'event_digest',
]);
const HEAD_KEYS = Object.freeze([...HEAD_BODY_KEYS, 'head_digest']);
const PROJECT_QUEUES = new Map();
const UTF8_DECODER = new NodeTextDecoder('utf-8', { fatal: true, ignoreBOM: true });

const ERROR_MESSAGES = Object.freeze({
  builder_conversation_repository_invalid: 'The local conversation request could not be verified.',
  builder_conversation_repository_not_found: 'The local conversation is unavailable.',
  builder_conversation_repository_conflict: 'The local conversation changed before this event could be saved.',
  builder_conversation_repository_idempotency_conflict: 'This local conversation command was already used for different content.',
  builder_conversation_repository_resource_exceeded: 'The local conversation is too large to verify safely.',
  builder_conversation_repository_integrity_failed: 'The saved local conversation could not be verified.',
  builder_conversation_repository_persistence_failed: 'The local conversation event could not be saved.',
  builder_conversation_repository_cleanup_failed: 'The local conversation storage could not be cleaned up safely.',
});

class BuilderConversationRepositoryError extends Error {
  constructor(code = 'builder_conversation_repository_invalid') {
    const selected = Object.hasOwn(ERROR_MESSAGES, code)
      ? code : 'builder_conversation_repository_invalid';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderConversationRepositoryError';
    this.code = selected;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) { throw new BuilderConversationRepositoryError(code); }

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || utilTypes.isProxy(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertExactObject(value, keys, code = 'builder_conversation_repository_invalid') {
  if (!isPlainObject(value)) fail(code);
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== keys.length
    || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))) fail(code);
  for (const key of ownKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail(code);
  }
}

function valueAt(value, key, code = 'builder_conversation_repository_invalid') {
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
    return `{${Object.keys(value).sort().map(
      (key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`,
    ).join(',')}}`;
  }
  fail('builder_conversation_repository_integrity_failed');
}

function sha256Hex(value) { return nodeCrypto.createHash('sha256').update(value).digest('hex'); }
function sha256Canonical(value) { return `sha256:${sha256Hex(Buffer.from(canonicalJson(value), 'utf8'))}`; }

function safePattern(value, pattern, maximum, code) {
  if (typeof value !== 'string' || value.length > maximum || !pattern.test(value)) fail(code);
  return value;
}

function safeProjectId(value, code = 'builder_conversation_repository_invalid') {
  return safePattern(value, PROJECT_ID_PATTERN, 64, code);
}
function safeConversationId(value, code = 'builder_conversation_repository_invalid') {
  return safePattern(value, CONVERSATION_ID_PATTERN, 96, code);
}
function safeEventId(value, code = 'builder_conversation_repository_invalid') {
  return safePattern(value, EVENT_ID_PATTERN, 128, code);
}
function safeDigest(value, code = 'builder_conversation_repository_invalid') {
  return safePattern(value, DIGEST_PATTERN, 71, code);
}
function safeSequence(value, code = 'builder_conversation_repository_invalid') {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_EVENT_SEQUENCE) fail(code);
  return value;
}

function hasPathControl(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function safeRootPath(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 1_024
    || value.trim() !== value || hasPathControl(value)
    || !path.isAbsolute(value) || path.resolve(value) !== value) {
    fail('builder_conversation_repository_invalid');
  }
  return value;
}

function sanitizeExpectedHead(value) {
  if (value === null) return null;
  assertExactObject(value, EXPECTED_HEAD_KEYS);
  return freezeDeep({
    conversation_id: safeConversationId(valueAt(value, 'conversation_id')),
    sequence: safeSequence(valueAt(value, 'sequence')),
    event_id: safeEventId(valueAt(value, 'event_id')),
    event_digest: safeDigest(valueAt(value, 'event_digest')),
  });
}

function sameHead(left, right) {
  return left === null ? right === null : right !== null
    && left.conversation_id === right.conversation_id
    && left.sequence === right.sequence
    && left.event_id === right.event_id
    && left.event_digest === right.event_digest;
}

function sanitizeAppendRequest(value) {
  assertExactObject(value, APPEND_KEYS);
  let event;
  try { event = sanitizeBuilderConversationEvent(valueAt(value, 'event')); } catch (error) {
    if (error instanceof BuilderConversationRecordError) fail('builder_conversation_repository_invalid');
    throw error;
  }
  const expectedHead = sanitizeExpectedHead(valueAt(value, 'expected_head'));
  if (event.previous_event === null) {
    if (expectedHead !== null) fail('builder_conversation_repository_invalid');
  } else if (expectedHead === null
    || expectedHead.conversation_id !== event.conversation_id
    || event.previous_event.sequence !== expectedHead.sequence
    || event.previous_event.event_id !== expectedHead.event_id
    || event.previous_event.event_digest !== expectedHead.event_digest) {
    fail('builder_conversation_repository_invalid');
  }
  return freezeDeep({ event, expected_head: expectedHead });
}

function sanitizeLoadRequest(value) {
  assertExactObject(value, LOAD_KEYS);
  return freezeDeep({ project_id: safeProjectId(valueAt(value, 'project_id')) });
}

function headBody(event) {
  return {
    schema_version: HEAD_SCHEMA_VERSION,
    record_kind: HEAD_RECORD_KIND,
    project_id: event.project_id,
    conversation_id: event.conversation_id,
    sequence: event.sequence,
    event_id: event.event_id,
    event_digest: event.event_digest,
  };
}

function createHead(event) {
  const body = headBody(event);
  return freezeDeep({ ...body, head_digest: sha256Canonical(body) });
}

function sanitizeHead(value) {
  assertExactObject(value, HEAD_KEYS, 'builder_conversation_repository_integrity_failed');
  const body = {
    schema_version: valueAt(value, 'schema_version', 'builder_conversation_repository_integrity_failed'),
    record_kind: valueAt(value, 'record_kind', 'builder_conversation_repository_integrity_failed'),
    project_id: safeProjectId(valueAt(value, 'project_id', 'builder_conversation_repository_integrity_failed'), 'builder_conversation_repository_integrity_failed'),
    conversation_id: safeConversationId(valueAt(value, 'conversation_id', 'builder_conversation_repository_integrity_failed'), 'builder_conversation_repository_integrity_failed'),
    sequence: safeSequence(valueAt(value, 'sequence', 'builder_conversation_repository_integrity_failed'), 'builder_conversation_repository_integrity_failed'),
    event_id: safeEventId(valueAt(value, 'event_id', 'builder_conversation_repository_integrity_failed'), 'builder_conversation_repository_integrity_failed'),
    event_digest: safeDigest(valueAt(value, 'event_digest', 'builder_conversation_repository_integrity_failed'), 'builder_conversation_repository_integrity_failed'),
  };
  const headDigest = safeDigest(valueAt(value, 'head_digest', 'builder_conversation_repository_integrity_failed'), 'builder_conversation_repository_integrity_failed');
  if (body.schema_version !== HEAD_SCHEMA_VERSION || body.record_kind !== HEAD_RECORD_KIND
    || headDigest !== sha256Canonical(body)) fail('builder_conversation_repository_integrity_failed');
  return freezeDeep({ ...body, head_digest: headDigest });
}

function serializeHead(value) { return `${canonicalJson(sanitizeHead(value))}\n`; }

function assertDirectory(directory, allowCreate) {
  if (!fs.existsSync(directory)) {
    if (!allowCreate) fail('builder_conversation_repository_not_found');
    try { fs.mkdirSync(directory, { recursive: false }); } catch (error) {
      if (!error || error.code !== 'EEXIST') fail('builder_conversation_repository_persistence_failed');
    }
  }
  let info;
  try { info = fs.lstatSync(directory); } catch { fail('builder_conversation_repository_persistence_failed'); }
  if (!info.isDirectory() || info.isSymbolicLink()) fail('builder_conversation_repository_integrity_failed');
}

function captureDirectoryIdentity(directory) {
  try {
    const info = fs.lstatSync(directory, { bigint: true });
    const realPath = fs.realpathSync.native(directory);
    if (!info.isDirectory() || info.isSymbolicLink() || realPath !== directory) throw new Error();
    return freezeDeep({ path: directory, dev: info.dev, ino: info.ino });
  } catch { fail('builder_conversation_repository_integrity_failed'); }
}

function assertDirectoryIdentity(identity) {
  const current = captureDirectoryIdentity(identity.path);
  if (current.dev !== identity.dev || current.ino !== identity.ino) {
    fail('builder_conversation_repository_integrity_failed');
  }
}

function captureDescriptorFileIdentity(descriptor) {
  try {
    const info = fs.fstatSync(descriptor, { bigint: true });
    if (!info.isFile()) throw new Error();
    return freezeDeep({ dev: info.dev, ino: info.ino });
  } catch {
    fail('builder_conversation_repository_persistence_failed');
  }
}

function assertPathFileIdentity(filePath, identity) {
  try {
    const info = fs.lstatSync(filePath, { bigint: true });
    if (!info.isFile() || info.isSymbolicLink()
      || info.dev !== identity.dev || info.ino !== identity.ino) throw new Error();
  } catch {
    fail('builder_conversation_repository_integrity_failed');
  }
}

function removeOwnedTemp(filePath, identity) {
  assertPathFileIdentity(filePath, identity);
  try { fs.unlinkSync(filePath); } catch {
    fail('builder_conversation_repository_cleanup_failed');
  }
}

function assertRepositoryAuthority(context) {
  assertDirectoryIdentity(context.root_identity);
  assertDirectoryIdentity(context.conversations_identity);
}

function projectStorageHash(projectId) {
  return sha256Hex(Buffer.from(`builder-conversation-repository/project\0${projectId}`, 'utf8'));
}

function storagePaths(context, projectId, create) {
  assertRepositoryAuthority(context);
  const projectDirectory = path.join(context.conversations_directory, projectStorageHash(projectId));
  const eventsDirectory = path.join(projectDirectory, 'events');
  if (create) {
    assertDirectory(projectDirectory, true);
    assertDirectory(eventsDirectory, true);
  } else {
    assertDirectory(projectDirectory, false);
    assertDirectory(eventsDirectory, false);
  }
  return freezeDeep({
    project_directory: projectDirectory,
    events_directory: eventsDirectory,
    head_path: path.join(projectDirectory, 'head.json'),
    project_identity: captureDirectoryIdentity(projectDirectory),
    events_identity: captureDirectoryIdentity(eventsDirectory),
  });
}

function assertStorageAuthority(paths) {
  assertDirectoryIdentity(paths.project_identity);
  assertDirectoryIdentity(paths.events_identity);
}

function eventPath(paths, sequence, digest) {
  return path.join(paths.events_directory, `${safeSequence(
    sequence, 'builder_conversation_repository_integrity_failed',
  )}-${safeDigest(digest, 'builder_conversation_repository_integrity_failed').slice(7)}.json`);
}

function decodeStrictUtf8(bytes) {
  try {
    const text = UTF8_DECODER.decode(bytes);
    if (!Buffer.from(text, 'utf8').equals(bytes)) throw new Error();
    return text;
  } catch { fail('builder_conversation_repository_integrity_failed'); }
}

function consumeReadBudget(budget, size) {
  const bytes = Number(size);
  if (budget.files + 1 > MAX_CHAIN_FILE_READS || budget.bytes + bytes > MAX_CHAIN_READ_BYTES) {
    fail('builder_conversation_repository_resource_exceeded');
  }
  budget.files += 1;
  budget.bytes += bytes;
}

function readBoundedFile(filePath, maximumBytes, notFoundCode, budget) {
  let descriptor = null;
  try {
    const pathInfo = fs.lstatSync(filePath, { bigint: true });
    if (!pathInfo.isFile() || pathInfo.isSymbolicLink()) throw new Error();
    descriptor = fs.openSync(filePath, 'r');
    const info = fs.fstatSync(descriptor, { bigint: true });
    if (!info.isFile() || info.dev !== pathInfo.dev || info.ino !== pathInfo.ino
      || info.size < 1n || info.size > BigInt(maximumBytes)) throw new Error();
    if (budget !== null) consumeReadBudget(budget, info.size);
    const size = Number(info.size);
    const buffer = Buffer.allocUnsafe(size + 1);
    const count = fs.readSync(descriptor, buffer, 0, buffer.length, 0);
    const reopened = fs.fstatSync(descriptor, { bigint: true });
    if (count !== size || reopened.dev !== info.dev || reopened.ino !== info.ino
      || reopened.size !== info.size) throw new Error();
    fs.closeSync(descriptor);
    descriptor = null;
    return buffer.subarray(0, size);
  } catch (error) {
    if (descriptor !== null) { try { fs.closeSync(descriptor); } catch { /* fixed below */ } }
    if (error instanceof BuilderConversationRepositoryError) throw error;
    if (error && error.code === 'ENOENT') fail(notFoundCode);
    fail('builder_conversation_repository_integrity_failed');
  }
}

function readEvent(filePath, budget = null) {
  const text = decodeStrictUtf8(readBoundedFile(
    filePath, MAX_EVENT_RECORD_BYTES, 'builder_conversation_repository_integrity_failed', budget,
  ));
  let parsed;
  try { parsed = JSON.parse(text); } catch { fail('builder_conversation_repository_integrity_failed'); }
  let event;
  try { event = sanitizeBuilderConversationEvent(parsed); } catch {
    fail('builder_conversation_repository_integrity_failed');
  }
  if (serializeBuilderConversationEvent(event) !== text) {
    fail('builder_conversation_repository_integrity_failed');
  }
  return event;
}

function readHead(headPath, missingAllowed, budget = null) {
  let bytes;
  try {
    bytes = readBoundedFile(
      headPath, MAX_HEAD_BYTES, 'builder_conversation_repository_not_found', budget,
    );
  } catch (error) {
    if (missingAllowed && error instanceof BuilderConversationRepositoryError
      && error.code === 'builder_conversation_repository_not_found') return null;
    throw error;
  }
  const text = decodeStrictUtf8(bytes);
  let parsed;
  try { parsed = JSON.parse(text); } catch { fail('builder_conversation_repository_integrity_failed'); }
  const head = sanitizeHead(parsed);
  if (serializeHead(head) !== text) fail('builder_conversation_repository_integrity_failed');
  return head;
}

function readExactEvent(paths, projectId, sequence, eventId, eventDigest, budget) {
  assertStorageAuthority(paths);
  const event = readEvent(eventPath(paths, sequence, eventDigest), budget);
  assertStorageAuthority(paths);
  if (event.project_id !== projectId || event.sequence !== sequence
    || event.event_id !== eventId || event.event_digest !== eventDigest) {
    fail('builder_conversation_repository_integrity_failed');
  }
  return event;
}

function reconstruct(paths, projectId, head) {
  const budget = { files: 1, bytes: 0 };
  const reversed = [];
  let pointer = {
    sequence: head.sequence,
    event_id: head.event_id,
    event_digest: head.event_digest,
  };
  while (pointer !== null) {
    if (reversed.length >= MAX_EVENT_SEQUENCE) {
      fail('builder_conversation_repository_resource_exceeded');
    }
    const event = readExactEvent(
      paths, projectId, pointer.sequence, pointer.event_id, pointer.event_digest, budget,
    );
    reversed.push(event);
    pointer = event.previous_event;
  }
  const events = reversed.reverse();
  let replay;
  try { replay = replayBuilderConversation(events); } catch (error) {
    if (error instanceof BuilderConversationReplayError) {
      fail('builder_conversation_repository_integrity_failed');
    }
    throw error;
  }
  if (replay.project_id !== head.project_id || replay.conversation_id !== head.conversation_id
    || replay.head.sequence !== head.sequence || replay.head.event_id !== head.event_id
    || replay.head.event_digest !== head.event_digest) {
    fail('builder_conversation_repository_integrity_failed');
  }
  return freezeDeep({ events: events.map((event) => ({ ...event })), replay });
}

function tryFsyncDirectory(directory) {
  let descriptor = null;
  try {
    descriptor = fs.openSync(directory, 'r');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    return 'proven';
  } catch {
    if (descriptor !== null) { try { fs.closeSync(descriptor); } catch { /* not proven */ } }
    return 'not_proven';
  }
}

function safeNonce() {
  const nonce = nodeCrypto.randomUUID();
  if (!NONCE_PATTERN.test(nonce)) fail('builder_conversation_repository_persistence_failed');
  return nonce;
}

function writeImmutableEvent(paths, event) {
  assertStorageAuthority(paths);
  const targetPath = eventPath(paths, event.sequence, event.event_digest);
  const tempPath = path.join(paths.events_directory,
    `.${event.sequence}-${event.event_digest.slice(7)}-${safeNonce()}.pending`);
  const text = serializeBuilderConversationEvent(event);
  let descriptor = null;
  let tempExists = false;
  let tempIdentity = null;
  try {
    descriptor = fs.openSync(tempPath, 'wx');
    tempExists = true;
    tempIdentity = captureDescriptorFileIdentity(descriptor);
    fs.writeFileSync(descriptor, text, 'utf8');
    fs.fsyncSync(descriptor);
    const completedIdentity = captureDescriptorFileIdentity(descriptor);
    if (completedIdentity.dev !== tempIdentity.dev || completedIdentity.ino !== tempIdentity.ino) {
      fail('builder_conversation_repository_integrity_failed');
    }
    fs.closeSync(descriptor);
    descriptor = null;
    assertPathFileIdentity(tempPath, tempIdentity);
    assertStorageAuthority(paths);
    try { fs.linkSync(tempPath, targetPath); } catch (error) {
      if (!error || error.code !== 'EEXIST') throw error;
      const existing = readEvent(targetPath);
      if (serializeBuilderConversationEvent(existing) !== text) {
        fail('builder_conversation_repository_integrity_failed');
      }
      removeOwnedTemp(tempPath, tempIdentity);
      tempExists = false;
      assertStorageAuthority(paths);
      return freezeDeep({
        event: existing,
        file_fsync: 'not_performed_existing_exact',
        immutable_publish: 'existing_exact',
        parent_directory_fsync: 'not_performed',
      });
    }
    assertStorageAuthority(paths);
    removeOwnedTemp(tempPath, tempIdentity);
    tempExists = false;
    const parentDirectoryFsync = tryFsyncDirectory(paths.events_directory);
    const reopened = readEvent(targetPath);
    assertStorageAuthority(paths);
    if (serializeBuilderConversationEvent(reopened) !== text) {
      fail('builder_conversation_repository_integrity_failed');
    }
    return freezeDeep({
      event: reopened,
      file_fsync: 'proven',
      immutable_publish: 'no_clobber_completed',
      parent_directory_fsync: parentDirectoryFsync,
    });
  } catch (error) {
    if (descriptor !== null) { try { fs.closeSync(descriptor); } catch { /* fixed below */ } }
    if (tempExists) {
      if (tempIdentity === null) fail('builder_conversation_repository_cleanup_failed');
      removeOwnedTemp(tempPath, tempIdentity);
    }
    if (error instanceof BuilderConversationRepositoryError) throw error;
    fail('builder_conversation_repository_persistence_failed');
  }
}

function publishHead(paths, expectedHead, event) {
  assertStorageAuthority(paths);
  if (!sameHead(expectedHead, readHead(paths.head_path, true))) {
    fail('builder_conversation_repository_conflict');
  }
  const head = createHead(event);
  const text = serializeHead(head);
  const tempPath = path.join(paths.project_directory, `.head-${safeNonce()}.pending`);
  let descriptor = null;
  let tempExists = false;
  let tempIdentity = null;
  try {
    descriptor = fs.openSync(tempPath, 'wx');
    tempExists = true;
    tempIdentity = captureDescriptorFileIdentity(descriptor);
    fs.writeFileSync(descriptor, text, 'utf8');
    fs.fsyncSync(descriptor);
    const completedIdentity = captureDescriptorFileIdentity(descriptor);
    if (completedIdentity.dev !== tempIdentity.dev || completedIdentity.ino !== tempIdentity.ino) {
      fail('builder_conversation_repository_integrity_failed');
    }
    fs.closeSync(descriptor);
    descriptor = null;
    assertPathFileIdentity(tempPath, tempIdentity);
    assertStorageAuthority(paths);
    const candidate = readExactEvent(
      paths, event.project_id, event.sequence, event.event_id, event.event_digest, null,
    );
    if (serializeBuilderConversationEvent(candidate) !== serializeBuilderConversationEvent(event)) {
      fail('builder_conversation_repository_integrity_failed');
    }
    assertStorageAuthority(paths);
    assertPathFileIdentity(tempPath, tempIdentity);
    fs.renameSync(tempPath, paths.head_path);
    tempExists = false;
    assertStorageAuthority(paths);
    const parentDirectoryFsync = tryFsyncDirectory(paths.project_directory);
    const reopened = readHead(paths.head_path, false);
    assertStorageAuthority(paths);
    if (serializeHead(reopened) !== text) fail('builder_conversation_repository_integrity_failed');
    return freezeDeep({ head: reopened, parent_directory_fsync: parentDirectoryFsync });
  } catch (error) {
    if (descriptor !== null) { try { fs.closeSync(descriptor); } catch { /* fixed below */ } }
    if (tempExists) {
      if (tempIdentity === null) fail('builder_conversation_repository_cleanup_failed');
      removeOwnedTemp(tempPath, tempIdentity);
    }
    if (error instanceof BuilderConversationRepositoryError) throw error;
    fail('builder_conversation_repository_persistence_failed');
  }
}

function persistenceEvidence(operation, eventEvidence = null, headEvidence = null) {
  return freezeDeep({
    evidence_version: CONVERSATION_REPOSITORY_RESULT_VERSION,
    operation,
    authority_scope: 'single_main_process_serialized_expected_head',
    cross_process_cas: 'not_proven',
    sudden_power_loss_durability: 'not_proven',
    event_file_fsync: eventEvidence?.file_fsync ?? 'not_performed',
    immutable_event_publish: eventEvidence?.immutable_publish ?? 'not_performed',
    event_parent_directory_fsync: eventEvidence?.parent_directory_fsync ?? 'not_performed',
    head_file_fsync: operation === 'appended' ? 'proven' : 'not_performed',
    head_publish: operation === 'appended' ? 'same_directory_replace_reopened' : 'not_performed',
    head_parent_directory_fsync: headEvidence?.parent_directory_fsync ?? 'not_performed',
    reopened_hash_verified: true,
    chain_reconstruction: 'full_digest_chain_and_replay_verified',
    orphan_events: 'not_current_without_head_reference',
    context_authority: 'local_collaboration_context_only',
    permission_authority: 'not_granted',
    execution_authority: 'not_granted',
    revision_authority: 'not_created',
    resource_bounds: {
      per_chain_max_events: MAX_EVENT_SEQUENCE,
      per_chain_max_file_reads: MAX_EVENT_SEQUENCE,
      per_chain_max_bytes: MAX_CHAIN_READ_BYTES,
      append_max_file_reads: MAX_APPEND_FILE_READS,
      append_max_bytes: MAX_APPEND_READ_BYTES,
      load_max_file_reads: MAX_LOAD_FILE_READS,
      load_max_bytes: MAX_LOAD_READ_BYTES,
    },
  });
}

function snapshot(head, reconstructed) {
  return freezeDeep({
    head: { ...head },
    events: reconstructed.events.map((event) => ({ ...event })),
    replay: reconstructed.replay,
  });
}

function result(head, reconstructed, options) {
  return freezeDeep({
    result_version: CONVERSATION_REPOSITORY_RESULT_VERSION,
    action_event: options.action_event === null ? null : { ...options.action_event },
    current_snapshot: snapshot(head, reconstructed),
    idempotent_replay: options.idempotent_replay,
    restart_restore: options.restart_restore,
    persistence_evidence: options.persistence_evidence,
  });
}

function appendEvent(context, request) {
  const paths = storagePaths(context, request.event.project_id, true);
  const currentHead = readHead(paths.head_path, true);
  let priorEvents = [];
  let current = null;
  if (currentHead !== null) {
    current = reconstruct(paths, request.event.project_id, currentHead);
    priorEvents = current.events;
    if (current.replay.conversation_id !== request.event.conversation_id) {
      fail('builder_conversation_repository_conflict');
    }
    const priorCommand = priorEvents.find(
      (event) => event.command_id === request.event.command_id,
    );
    if (priorCommand !== undefined) {
      if (priorCommand.command_digest !== request.event.command_digest) {
        fail('builder_conversation_repository_idempotency_conflict');
      }
      return result(currentHead, current, {
        action_event: priorCommand,
        idempotent_replay: true,
        restart_restore: false,
        persistence_evidence: persistenceEvidence('replayed'),
      });
    }
  }
  if (!sameHead(request.expected_head, currentHead)) {
    fail('builder_conversation_repository_conflict');
  }
  try { replayBuilderConversation([...priorEvents, request.event]); } catch (error) {
    if (error instanceof BuilderConversationReplayError) {
      fail('builder_conversation_repository_invalid');
    }
    throw error;
  }
  const eventEvidence = writeImmutableEvent(paths, request.event);
  const headEvidence = publishHead(paths, request.expected_head, eventEvidence.event);
  const reconstructed = reconstruct(paths, request.event.project_id, headEvidence.head);
  return result(headEvidence.head, reconstructed, {
    action_event: eventEvidence.event,
    idempotent_replay: false,
    restart_restore: false,
    persistence_evidence: persistenceEvidence('appended', eventEvidence, headEvidence),
  });
}

function loadCurrent(context, request) {
  const paths = storagePaths(context, request.project_id, false);
  const head = readHead(paths.head_path, false);
  if (head.project_id !== request.project_id) fail('builder_conversation_repository_integrity_failed');
  return result(head, reconstruct(paths, request.project_id, head), {
    action_event: null,
    idempotent_replay: false,
    restart_restore: true,
    persistence_evidence: persistenceEvidence('current_loaded'),
  });
}

function normalizeOperationError(error) {
  if (error instanceof BuilderConversationRepositoryError) return error;
  if (error instanceof BuilderConversationRecordError || error instanceof BuilderConversationReplayError) {
    return new BuilderConversationRepositoryError('builder_conversation_repository_invalid');
  }
  return new BuilderConversationRepositoryError('builder_conversation_repository_persistence_failed');
}

function enqueueProject(queueKey, operation) {
  const previous = PROJECT_QUEUES.get(queueKey) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(operation);
  const tracked = run.then(() => undefined, () => undefined).finally(() => {
    if (PROJECT_QUEUES.get(queueKey) === tracked) PROJECT_QUEUES.delete(queueKey);
  });
  PROJECT_QUEUES.set(queueKey, tracked);
  return run;
}

function createBuilderConversationRepository(rootPath) {
  const requestedRoot = safeRootPath(rootPath);
  assertDirectory(requestedRoot, false);
  let repositoryRoot;
  try { repositoryRoot = safeRootPath(fs.realpathSync.native(requestedRoot)); } catch (error) {
    if (error instanceof BuilderConversationRepositoryError) throw error;
    fail('builder_conversation_repository_invalid');
  }
  const conversationsDirectory = path.join(repositoryRoot, REPOSITORY_DIRECTORY_NAME);
  assertDirectory(conversationsDirectory, true);
  const context = freezeDeep({
    repository_root: repositoryRoot,
    conversations_directory: conversationsDirectory,
    root_identity: captureDirectoryIdentity(repositoryRoot),
    conversations_identity: captureDirectoryIdentity(conversationsDirectory),
  });

  return freezeDeep({
    append(rawRequest) {
      let request;
      try { request = sanitizeAppendRequest(rawRequest); } catch (error) {
        return Promise.reject(normalizeOperationError(error));
      }
      const queueKey = `${repositoryRoot}\0${projectStorageHash(request.event.project_id)}`;
      return enqueueProject(queueKey, () => appendEvent(context, request))
        .catch((error) => { throw normalizeOperationError(error); });
    },
    load_current(rawRequest) {
      let request;
      try { request = sanitizeLoadRequest(rawRequest); } catch (error) {
        return Promise.reject(normalizeOperationError(error));
      }
      const queueKey = `${repositoryRoot}\0${projectStorageHash(request.project_id)}`;
      return enqueueProject(queueKey, () => loadCurrent(context, request))
        .catch((error) => { throw normalizeOperationError(error); });
    },
  });
}

module.exports = Object.freeze({
  CONVERSATION_REPOSITORY_RESULT_VERSION,
  BuilderConversationRepositoryError,
  createBuilderConversationRepository,
});
