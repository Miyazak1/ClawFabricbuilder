'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const {
  BuilderConversationReplayError,
  replayBuilderConversation,
} = require('./builder-conversation-replay.cjs');
const {
  BuilderProjectSourceTreeError,
  MAX_SOURCE_TREE_UTF8_BYTES,
  createBuilderProjectSourceTree,
  sanitizeBuilderProjectSourceTree,
} = require('./builder-project-source-tree.cjs');

const BUILDER_CODE_CHANGE_CANDIDATE_VERSION = 'builder-code-change-candidate.v2';
const BUILDER_CODE_CHANGE_RUN_BINDING_VERSION = 'builder-code-change-run-binding.v2';
const BUILDER_PROJECT_BASE_REVISION_EVIDENCE_VERSION =
  'builder-project-base-revision-evidence.v2';
const BUILDER_CODE_CHANGE_AUTHORITY = 'deterministic_source_tree_transform';
const MAX_CODE_CHANGE_OPERATIONS = 256;
const MAX_CODE_CHANGE_OPERATION_UTF8_BYTES = MAX_SOURCE_TREE_UTF8_BYTES;
const MAX_CODE_CHANGE_CANDIDATE_UTF8_BYTES = 16 * 1_024 * 1_024;

const PROJECT_ID_PATTERN = /^builder-project:([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/u;
const ID_PATTERNS = Object.freeze({
  conversation: /^builder-conversation:([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/u,
  event: /^builder-conversation-event:[0-9a-f]{64}$/u,
  turn: /^builder-turn:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
  task: /^builder-task:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
  run: /^builder-run:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
});
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const GIT_OID_PATTERN = /^[0-9a-f]{40}$/u;
const CANDIDATE_ID_PATTERN = /^builder-code-change-candidate:[0-9a-f]{64}$/u;

const CREATE_KEYS = Object.freeze([
  'conversation_events',
  'turn_id',
  'run_id',
  'base_revision_evidence',
  'base_source_tree',
  'operations',
]);
const BASE_REVISION_EVIDENCE_KEYS = Object.freeze([
  'evidence_version',
  'project_id',
  'revision_receipt_digest',
  'commit_oid',
  'source_tree_digest',
  'verification_admission',
]);
const RUN_BINDING_KEYS = Object.freeze([
  'binding_version',
  'project_id',
  'conversation_id',
  'turn_id',
  'task_id',
  'run_id',
  'request_digest',
  'conversation_head',
  'base_revision',
  'verification_admission',
]);
const CONVERSATION_HEAD_KEYS = Object.freeze(['sequence', 'event_id', 'event_digest']);
const CONVERSATION_BASE_REVISION_KEYS = Object.freeze(['revision_receipt_digest', 'commit_oid']);
const OPERATION_KEYS = Object.freeze(['operation', 'path', 'content', 'content_digest']);
const RAW_OPERATION_KEYS = Object.freeze(['operation', 'path', 'content']);
const AUTHORITY_KEYS = Object.freeze([
  'change_authority',
  'conversation_binding_admission',
  'base_revision_binding_admission',
  'revision_admission',
  'preview_admission',
  'execution_admission',
]);
const CANDIDATE_KEYS = Object.freeze([
  'candidate_version',
  'candidate_id',
  'project_id',
  'conversation_id',
  'turn_id',
  'task_id',
  'run_id',
  'base_revision_evidence',
  'base_source_tree',
  'request_digest',
  'run_binding',
  'operations',
  'resulting_source_tree',
  'resulting_tree_digest',
  'authority',
  'candidate_digest',
]);
const AUTHORITY = Object.freeze({
  change_authority: BUILDER_CODE_CHANGE_AUTHORITY,
  conversation_binding_admission: 'host_verification_required',
  base_revision_binding_admission: 'host_verification_required',
  revision_admission: 'not_created',
  preview_admission: 'not_evaluated',
  execution_admission: 'not_evaluated',
});

class BuilderCodeChangeKernelError extends Error {
  constructor() {
    super('The proposed code change could not be verified.');
    this.name = 'BuilderCodeChangeKernelError';
    this.code = 'builder_code_change_invalid';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderCodeChangeKernelError();
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || utilTypes.isProxy(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertExactObject(value, expectedKeys) {
  if (!isPlainObject(value)) fail();
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== expectedKeys.length
    || keys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))
  ) fail();
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  }
}

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  return descriptor.value;
}

function assertDenseArray(value) {
  if (
    !Array.isArray(value)
    || utilTypes.isProxy(value)
    || value.length === 0
    || value.length > MAX_CODE_CHANGE_OPERATIONS
  ) fail();
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key === 'symbol') || keys.length !== value.length + 1) fail();
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) fail();
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  }
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
      (key) => `${JSON.stringify(key)}:${canonicalJson(valueAt(value, key))}`,
    ).join(',')}}`;
  }
  fail();
}

function sha256Canonical(value) {
  return `sha256:${nodeCrypto.createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')}`;
}

function safePattern(value, pattern, maximum) {
  if (typeof value !== 'string' || value.length > maximum || !pattern.test(value)) fail();
  return value;
}

function safeDigest(value) {
  return safePattern(value, DIGEST_PATTERN, 71);
}

function safeGitOid(value) {
  return safePattern(value, GIT_OID_PATTERN, 40);
}

function safeIdentity(value, kind) {
  return safePattern(value, ID_PATTERNS[kind], 128);
}

function safeProjectId(value) {
  return safePattern(value, PROJECT_ID_PATTERN, 64);
}

function pathComparisonKey(value) {
  return value.normalize('NFKC').toUpperCase();
}

function sanitizeConversationBaseRevision(value) {
  if (value === null) return null;
  assertExactObject(value, CONVERSATION_BASE_REVISION_KEYS);
  return {
    revision_receipt_digest: safeDigest(valueAt(value, 'revision_receipt_digest')),
    commit_oid: safeGitOid(valueAt(value, 'commit_oid')),
  };
}

function sanitizeConversationHead(value) {
  assertExactObject(value, CONVERSATION_HEAD_KEYS);
  const sequence = valueAt(value, 'sequence');
  if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence > 4_096) fail();
  return {
    sequence,
    event_id: safeIdentity(valueAt(value, 'event_id'), 'event'),
    event_digest: safeDigest(valueAt(value, 'event_digest')),
  };
}

function sanitizeBaseRevisionEvidence(value, projectId, sourceTreeDigest, conversationBase) {
  if (value === null) {
    if (conversationBase !== null) fail();
    return null;
  }
  if (conversationBase === null) fail();
  assertExactObject(value, BASE_REVISION_EVIDENCE_KEYS);
  if (
    valueAt(value, 'evidence_version') !== BUILDER_PROJECT_BASE_REVISION_EVIDENCE_VERSION
    || valueAt(value, 'verification_admission') !== 'git_sqlite_read_authority_verified'
  ) fail();
  const evidence = {
    evidence_version: BUILDER_PROJECT_BASE_REVISION_EVIDENCE_VERSION,
    project_id: safeProjectId(valueAt(value, 'project_id')),
    revision_receipt_digest: safeDigest(valueAt(value, 'revision_receipt_digest')),
    commit_oid: safeGitOid(valueAt(value, 'commit_oid')),
    source_tree_digest: safeDigest(valueAt(value, 'source_tree_digest')),
    verification_admission: 'git_sqlite_read_authority_verified',
  };
  if (
    evidence.project_id !== projectId
    || evidence.revision_receipt_digest !== conversationBase.revision_receipt_digest
    || evidence.commit_oid !== conversationBase.commit_oid
    || evidence.source_tree_digest !== sourceTreeDigest
  ) fail();
  return evidence;
}

function projectRunBinding(conversationEvents, requestedTurnId, requestedRunId) {
  const replay = replayBuilderConversation(conversationEvents);
  const turnId = safeIdentity(requestedTurnId, 'turn');
  const runId = safeIdentity(requestedRunId, 'run');
  const turn = replay.turns.find((item) => item.turn_id === turnId);
  if (
    !turn
    || turn.mode !== 'work'
    || turn.status !== 'active'
    || turn.task === null
    || replay.active_turn_id !== turnId
  ) fail();
  const run = turn.runs.find((item) => item.run_id === runId);
  if (!run || run !== turn.runs.at(-1) || run.status !== 'running') fail();
  return {
    binding_version: BUILDER_CODE_CHANGE_RUN_BINDING_VERSION,
    project_id: replay.project_id,
    conversation_id: replay.conversation_id,
    turn_id: turn.turn_id,
    task_id: turn.task.task_id,
    run_id: run.run_id,
    request_digest: run.input_digest,
    conversation_head: { ...replay.head },
    base_revision: turn.base_revision === null ? null : { ...turn.base_revision },
    verification_admission: 'host_verification_required',
  };
}

function sanitizeRunBinding(value) {
  assertExactObject(value, RUN_BINDING_KEYS);
  if (
    valueAt(value, 'binding_version') !== BUILDER_CODE_CHANGE_RUN_BINDING_VERSION
    || valueAt(value, 'verification_admission') !== 'host_verification_required'
  ) fail();
  const projectId = safeProjectId(valueAt(value, 'project_id'));
  const conversationId = safeIdentity(valueAt(value, 'conversation_id'), 'conversation');
  const projectMatch = PROJECT_ID_PATTERN.exec(projectId);
  const conversationMatch = ID_PATTERNS.conversation.exec(conversationId);
  if (!projectMatch || !conversationMatch || projectMatch[1] !== conversationMatch[1]) fail();
  return {
    binding_version: BUILDER_CODE_CHANGE_RUN_BINDING_VERSION,
    project_id: projectId,
    conversation_id: conversationId,
    turn_id: safeIdentity(valueAt(value, 'turn_id'), 'turn'),
    task_id: safeIdentity(valueAt(value, 'task_id'), 'task'),
    run_id: safeIdentity(valueAt(value, 'run_id'), 'run'),
    request_digest: safeDigest(valueAt(value, 'request_digest')),
    conversation_head: sanitizeConversationHead(valueAt(value, 'conversation_head')),
    base_revision: sanitizeConversationBaseRevision(valueAt(value, 'base_revision')),
    verification_admission: 'host_verification_required',
  };
}

function sanitizeAuthority(value) {
  assertExactObject(value, AUTHORITY_KEYS);
  for (const [key, expected] of Object.entries(AUTHORITY)) {
    if (valueAt(value, key) !== expected) fail();
  }
  return { ...AUTHORITY };
}

function sanitizeRawOperation(value) {
  assertExactObject(value, RAW_OPERATION_KEYS);
  const operation = valueAt(value, 'operation');
  if (operation !== 'upsert' && operation !== 'delete') fail();
  const content = valueAt(value, 'content');
  if ((operation === 'delete') !== (content === null)) fail();

  const single = createBuilderProjectSourceTree({
    files: [{ path: valueAt(value, 'path'), content: operation === 'upsert' ? content : '' }],
  }).files[0];
  return {
    operation,
    path: single.path,
    content: operation === 'upsert' ? single.content : null,
    content_digest: operation === 'upsert' ? single.content_digest : null,
  };
}

function sanitizeStoredOperation(value) {
  assertExactObject(value, OPERATION_KEYS);
  const raw = {
    operation: valueAt(value, 'operation'),
    path: valueAt(value, 'path'),
    content: valueAt(value, 'content'),
  };
  const safe = sanitizeRawOperation(raw);
  if (safe.content_digest !== valueAt(value, 'content_digest')) fail();
  return safe;
}

function sanitizeOperations(value, stored) {
  assertDenseArray(value);
  const operations = [];
  let totalContentBytes = 0;
  for (const operation of value) {
    const safe = stored ? sanitizeStoredOperation(operation) : sanitizeRawOperation(operation);
    if (safe.content !== null) {
      totalContentBytes += Buffer.byteLength(safe.content, 'utf8');
      if (totalContentBytes > MAX_CODE_CHANGE_OPERATION_UTF8_BYTES) fail();
    }
    operations.push(safe);
  }
  operations.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  const seen = new Set();
  for (const operation of operations) {
    const key = pathComparisonKey(operation.path);
    if (seen.has(key)) fail();
    seen.add(key);
  }
  return operations;
}

function applyOperations(baseSourceTree, operations) {
  const byPath = new Map(baseSourceTree.files.map((file) => [pathComparisonKey(file.path), {
    path: file.path,
    content: file.content,
  }]));
  for (const operation of operations) {
    const key = pathComparisonKey(operation.path);
    if (operation.operation === 'delete') {
      if (!byPath.has(key)) fail();
      byPath.delete(key);
    } else {
      byPath.set(key, { path: operation.path, content: operation.content });
    }
  }
  return createBuilderProjectSourceTree({ files: [...byPath.values()] });
}

function candidateDigestBody(candidate) {
  return {
    authority: candidate.authority,
    base_revision_evidence: candidate.base_revision_evidence,
    base_source_tree: candidate.base_source_tree,
    candidate_version: candidate.candidate_version,
    conversation_id: candidate.conversation_id,
    operations: candidate.operations,
    project_id: candidate.project_id,
    request_digest: candidate.request_digest,
    resulting_source_tree: candidate.resulting_source_tree,
    resulting_tree_digest: candidate.resulting_tree_digest,
    run_binding: candidate.run_binding,
    run_id: candidate.run_id,
    task_id: candidate.task_id,
    turn_id: candidate.turn_id,
  };
}

function assertCandidateBound(value) {
  if (Buffer.byteLength(canonicalJson(candidateDigestBody(value)), 'utf8')
    > MAX_CODE_CHANGE_CANDIDATE_UTF8_BYTES) fail();
}

function createBuilderCodeChangeCandidate(value) {
  assertExactObject(value, CREATE_KEYS);
  const runBinding = projectRunBinding(
    valueAt(value, 'conversation_events'),
    valueAt(value, 'turn_id'),
    valueAt(value, 'run_id'),
  );
  const baseSourceTree = sanitizeBuilderProjectSourceTree(valueAt(value, 'base_source_tree'));
  const baseRevisionEvidence = sanitizeBaseRevisionEvidence(
    valueAt(value, 'base_revision_evidence'),
    runBinding.project_id,
    baseSourceTree.source_tree_digest,
    runBinding.base_revision,
  );
  const operations = sanitizeOperations(valueAt(value, 'operations'), false);
  const resultingSourceTree = applyOperations(baseSourceTree, operations);
  if (resultingSourceTree.source_tree_digest === baseSourceTree.source_tree_digest) fail();

  const unsigned = {
    candidate_version: BUILDER_CODE_CHANGE_CANDIDATE_VERSION,
    project_id: runBinding.project_id,
    conversation_id: runBinding.conversation_id,
    turn_id: runBinding.turn_id,
    task_id: runBinding.task_id,
    run_id: runBinding.run_id,
    base_revision_evidence: baseRevisionEvidence,
    base_source_tree: baseSourceTree,
    request_digest: runBinding.request_digest,
    run_binding: runBinding,
    operations,
    resulting_source_tree: resultingSourceTree,
    resulting_tree_digest: resultingSourceTree.source_tree_digest,
    authority: { ...AUTHORITY },
  };
  assertCandidateBound(unsigned);
  const candidateDigest = sha256Canonical(candidateDigestBody(unsigned));
  return freezeDeep({
    ...unsigned,
    candidate_id: `builder-code-change-candidate:${candidateDigest.slice('sha256:'.length)}`,
    candidate_digest: candidateDigest,
  });
}

function sanitizeBuilderCodeChangeCandidate(value) {
  assertExactObject(value, CANDIDATE_KEYS);
  if (valueAt(value, 'candidate_version') !== BUILDER_CODE_CHANGE_CANDIDATE_VERSION) fail();
  const runBinding = sanitizeRunBinding(valueAt(value, 'run_binding'));
  const baseSourceTree = sanitizeBuilderProjectSourceTree(valueAt(value, 'base_source_tree'));
  const baseRevisionEvidence = sanitizeBaseRevisionEvidence(
    valueAt(value, 'base_revision_evidence'),
    runBinding.project_id,
    baseSourceTree.source_tree_digest,
    runBinding.base_revision,
  );
  const operations = sanitizeOperations(valueAt(value, 'operations'), true);
  const resultingSourceTree = sanitizeBuilderProjectSourceTree(
    valueAt(value, 'resulting_source_tree'),
  );
  const unsigned = {
    candidate_version: BUILDER_CODE_CHANGE_CANDIDATE_VERSION,
    project_id: safeProjectId(valueAt(value, 'project_id')),
    conversation_id: safeIdentity(valueAt(value, 'conversation_id'), 'conversation'),
    turn_id: safeIdentity(valueAt(value, 'turn_id'), 'turn'),
    task_id: safeIdentity(valueAt(value, 'task_id'), 'task'),
    run_id: safeIdentity(valueAt(value, 'run_id'), 'run'),
    base_revision_evidence: baseRevisionEvidence,
    base_source_tree: baseSourceTree,
    request_digest: safeDigest(valueAt(value, 'request_digest')),
    run_binding: runBinding,
    operations,
    resulting_source_tree: resultingSourceTree,
    resulting_tree_digest: safeDigest(valueAt(value, 'resulting_tree_digest')),
    authority: sanitizeAuthority(valueAt(value, 'authority')),
  };
  if (
    unsigned.project_id !== runBinding.project_id
    || unsigned.conversation_id !== runBinding.conversation_id
    || unsigned.turn_id !== runBinding.turn_id
    || unsigned.task_id !== runBinding.task_id
    || unsigned.run_id !== runBinding.run_id
    || unsigned.request_digest !== runBinding.request_digest
    || unsigned.resulting_tree_digest !== resultingSourceTree.source_tree_digest
  ) fail();
  const rebuiltSourceTree = applyOperations(baseSourceTree, operations);
  if (rebuiltSourceTree.source_tree_digest !== resultingSourceTree.source_tree_digest) fail();
  assertCandidateBound(unsigned);
  const candidateDigest = safeDigest(valueAt(value, 'candidate_digest'));
  const candidateId = safePattern(valueAt(value, 'candidate_id'), CANDIDATE_ID_PATTERN, 160);
  if (
    sha256Canonical(candidateDigestBody(unsigned)) !== candidateDigest
    || candidateId !== `builder-code-change-candidate:${candidateDigest.slice('sha256:'.length)}`
  ) fail();
  return freezeDeep({
    ...unsigned,
    candidate_id: candidateId,
    candidate_digest: candidateDigest,
  });
}

function safeBoundary(fn) {
  return (...args) => {
    try {
      return fn(...args);
    } catch (error) {
      if (error instanceof BuilderCodeChangeKernelError) throw error;
      if (
        error instanceof BuilderProjectSourceTreeError
        || error instanceof BuilderConversationReplayError
      ) fail();
      fail();
    }
  };
}

module.exports = Object.freeze({
  BUILDER_CODE_CHANGE_CANDIDATE_VERSION,
  BUILDER_CODE_CHANGE_RUN_BINDING_VERSION,
  BUILDER_PROJECT_BASE_REVISION_EVIDENCE_VERSION,
  BUILDER_CODE_CHANGE_AUTHORITY,
  MAX_CODE_CHANGE_OPERATIONS,
  MAX_CODE_CHANGE_OPERATION_UTF8_BYTES,
  MAX_CODE_CHANGE_CANDIDATE_UTF8_BYTES,
  BuilderCodeChangeKernelError,
  createBuilderCodeChangeCandidate: safeBoundary(createBuilderCodeChangeCandidate),
  sanitizeBuilderCodeChangeCandidate: safeBoundary(sanitizeBuilderCodeChangeCandidate),
});
