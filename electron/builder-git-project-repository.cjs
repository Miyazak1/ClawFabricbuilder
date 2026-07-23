'use strict';

const fs = require('node:fs');
const path = require('node:path');
const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const {
  BUILDER_GIT_OBJECT_FORMAT,
  DEFAULT_TIMEOUT_MS,
  BuilderGitCommandRunnerError,
  createDefaultBuilderGitCommandRunner,
} = require('./builder-git-command-runner.cjs');
const {
  BuilderCodeChangeKernelError,
  sanitizeBuilderCodeChangeCandidate,
} = require('./builder-code-change-kernel.cjs');
const {
  BuilderProjectSourceTreeError,
  MAX_SOURCE_FILE_UTF8_BYTES,
  MAX_SOURCE_FILES,
  MAX_SOURCE_TREE_UTF8_BYTES,
  createBuilderProjectSourceTree,
  sanitizeBuilderProjectSourceTree,
} = require('./builder-project-source-tree.cjs');
const {
  BUILDER_GIT_PROJECT_REPOSITORY_VERSION,
  BUILDER_GIT_CANDIDATE_RECEIPT_VERSION,
  BUILDER_GIT_CANDIDATE_VERIFICATION_VERSION,
  CODE_AUTHORITY,
  PRODUCT_REVISION_ADMISSION,
  BuilderGitReceiptContractError,
  canonicalJson,
  sha256Canonical,
  sanitizeBuilderGitCandidateReceipt,
  sanitizeBuilderGitCandidateVerificationReceipt,
  sanitizeBuilderGitCandidateReceiptPair,
  createBuilderGitCandidateVerificationReceipt,
} = require('./builder-git-receipt-contract.cjs');

const ZERO_OID = '0'.repeat(40);
const OID_PATTERN = /^[0-9a-f]{40}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const UUID_PATTERN = new RegExp(`^${UUID_SOURCE}$`, 'u');
const PROJECT_ID_PATTERN = new RegExp(`^builder-project:(${UUID_SOURCE})$`, 'u');
const BUILDER_ID_PATTERNS = Object.freeze({
  conversation_id: new RegExp(`^builder-conversation:${UUID_SOURCE}$`, 'u'),
  turn_id: new RegExp(`^builder-turn:${UUID_SOURCE}$`, 'u'),
  task_id: new RegExp(`^builder-task:${UUID_SOURCE}$`, 'u'),
  run_id: new RegExp(`^builder-run:${UUID_SOURCE}$`, 'u'),
  request_id: new RegExp(`^builder-git-request:${UUID_SOURCE}$`, 'u'),
  candidate_id: /^builder-code-change-candidate:[0-9a-f]{64}$/u,
});
const PREPARE_REQUEST_KEYS = Object.freeze(['request_id', 'expected_base_oid', 'candidate']);
const PROTECTED_PATHS = new Set(['.gitmodules', '.gitattributes']);
const COMMIT_TRAILER_ORDER = Object.freeze([
  'Object-Format',
  'Project-Id',
  'Conversation-Id',
  'Turn-Id',
  'Task-Id',
  'Run-Id',
  'Request-Id',
  'Semantic-Identity-Digest',
  'Candidate-Digest',
  'Expected-Base-Oid',
]);

const ERROR_MESSAGES = Object.freeze({
  builder_git_project_invalid: 'The project change could not be verified.',
  builder_git_project_conflict: 'The project change conflicts with another saved candidate.',
  builder_git_project_dirty: 'The project folder has local changes.',
  builder_git_project_integrity_failed: 'The project folder could not be verified.',
  builder_git_project_failed: 'The project change could not be saved.',
});
const BUILDER_GIT_VERIFIED_CANDIDATE_READ_RESULT_VERSION = 'builder-git-verified-candidate-read-result.v1';

class BuilderGitProjectRepositoryError extends Error {
  constructor(code = 'builder_git_project_invalid') {
    const selected = Object.hasOwn(ERROR_MESSAGES, code) ? code : 'builder_git_project_invalid';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderGitProjectRepositoryError';
    this.code = selected;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) {
  throw new BuilderGitProjectRepositoryError(code);
}

function safeOwnCode(error, ErrorClass) {
  if (
    !error
    || typeof error !== 'object'
    || utilTypes.isProxy(error)
    || Object.getPrototypeOf(error) !== ErrorClass.prototype
  ) return null;
  const descriptor = Object.getOwnPropertyDescriptor(error, 'code');
  if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'string') {
    return null;
  }
  return descriptor.value;
}

function normalizeError(error) {
  const repositoryCode = safeOwnCode(error, BuilderGitProjectRepositoryError);
  if (repositoryCode && Object.hasOwn(ERROR_MESSAGES, repositoryCode)) {
    return new BuilderGitProjectRepositoryError(repositoryCode);
  }
  const runnerCode = safeOwnCode(error, BuilderGitCommandRunnerError);
  if (runnerCode) {
    return new BuilderGitProjectRepositoryError(
      runnerCode === 'builder_git_command_invalid'
        ? 'builder_git_project_invalid'
        : 'builder_git_project_failed',
    );
  }
  if (safeOwnCode(error, BuilderGitReceiptContractError)) {
    return new BuilderGitProjectRepositoryError('builder_git_project_invalid');
  }
  if (
    safeOwnCode(error, BuilderCodeChangeKernelError) === 'builder_code_change_invalid'
    || safeOwnCode(error, BuilderProjectSourceTreeError) === 'builder_project_source_tree_invalid'
  ) {
    return new BuilderGitProjectRepositoryError('builder_git_project_invalid');
  }
  return new BuilderGitProjectRepositoryError('builder_git_project_failed');
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || utilTypes.isProxy(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertExactObject(value, expectedKeys) {
  if (!isPlainObject(value)) fail('builder_git_project_invalid');
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== expectedKeys.length
    || keys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))
  ) fail('builder_git_project_invalid');
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      fail('builder_git_project_invalid');
    }
  }
}

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
    fail('builder_git_project_invalid');
  }
  return descriptor.value;
}

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freezeDeep(nested);
    Object.freeze(value);
  }
  return value;
}

function sha256Hex(value) {
  return nodeCrypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function safeAbsolutePath(value) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > 1_024
    || value.includes('\0')
    || value.includes('\r')
    || value.includes('\n')
    || !path.isAbsolute(value)
    || path.normalize(value) !== value
  ) fail('builder_git_project_invalid');
  return value;
}

function safeOid(value, nullable = false) {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || !OID_PATTERN.test(value)) fail('builder_git_project_invalid');
  return value;
}

function safeBuilderId(value, key) {
  if (typeof value !== 'string' || !BUILDER_ID_PATTERNS[key].test(value)) {
    fail('builder_git_project_invalid');
  }
  return value;
}

function projectUuid(projectId) {
  if (typeof projectId !== 'string') fail('builder_git_project_invalid');
  const match = PROJECT_ID_PATTERN.exec(projectId);
  if (!match || !UUID_PATTERN.test(match[1])) fail('builder_git_project_invalid');
  return match[1];
}

function safeNowSeconds(value) {
  if (typeof value !== 'function') fail('builder_git_project_invalid');
  return () => {
    const timestamp = value();
    if (!Number.isSafeInteger(timestamp) || timestamp < 1 || timestamp > 4_102_444_800) {
      fail('builder_git_project_invalid');
    }
    return timestamp;
  };
}

function sanitizeRequest(rawRequest) {
  assertExactObject(rawRequest, PREPARE_REQUEST_KEYS);
  const candidate = sanitizeBuilderCodeChangeCandidate(valueAt(rawRequest, 'candidate'));
  const request = {
    request_id: safeBuilderId(valueAt(rawRequest, 'request_id'), 'request_id'),
    expected_base_oid: safeOid(valueAt(rawRequest, 'expected_base_oid'), true),
    candidate,
  };
  if (candidate.project_id !== candidate.run_binding.project_id) fail('builder_git_project_invalid');
  return request;
}

function semanticIdentity(request, treeOid) {
  const candidate = request.candidate;
  return {
    semantic_identity_version: 'builder-git-candidate-semantic-identity.v1',
    object_format: BUILDER_GIT_OBJECT_FORMAT,
    project_id: candidate.project_id,
    conversation_id: candidate.conversation_id,
    turn_id: candidate.turn_id,
    task_id: candidate.task_id,
    run_id: candidate.run_id,
    request_id: request.request_id,
    candidate_id: candidate.candidate_id,
    candidate_digest: candidate.candidate_digest,
    expected_base_oid: request.expected_base_oid,
    candidate_tree_oid: treeOid,
    resulting_tree_digest: candidate.resulting_tree_digest,
  };
}

function projectDirectory(projectsRoot, projectId) {
  return path.join(projectsRoot, projectUuid(projectId));
}

function gitControlIndexPath(projectRoot, semanticHash) {
  const operationId = nodeCrypto.randomBytes(16).toString('hex');
  return path.join(projectRoot, '.git', 'clawfabric', 'indexes', `${semanticHash}-${operationId}.index`);
}

function safeRelativeProjectPath(value) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.startsWith('/')
    || value.includes('\\')
    || value.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
    || PROTECTED_PATHS.has(value)
    || value.startsWith('.git/')
    || value.startsWith('.clawfabric/')
  ) fail('builder_git_project_invalid');
  return value;
}

function parseTreeEntries(source) {
  if (typeof source !== 'string' || source.includes('\r') || source.includes('\0\0')) {
    fail('builder_git_project_integrity_failed');
  }
  if (source === '') return [];
  const entries = [];
  const seen = new Set();
  for (const record of source.split('\0')) {
    if (record === '') continue;
    const match = /^(100644|120000|160000) (blob|commit) ([0-9a-f]{40})\t(.+)$/u.exec(record);
    if (!match) fail('builder_git_project_integrity_failed');
    const [, mode, objectType, oid, rawPath] = match;
    if (mode !== '100644' || objectType !== 'blob') fail('builder_git_project_integrity_failed');
    const filePath = safeRelativeProjectPath(rawPath);
    if (seen.has(filePath)) fail('builder_git_project_integrity_failed');
    seen.add(filePath);
    entries.push({ path: filePath, oid });
  }
  entries.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  return entries;
}

function assertSafeDirectory(value, allowMissing) {
  if (!fs.existsSync(value)) {
    if (allowMissing) return;
    fail('builder_git_project_integrity_failed');
  }
  const stat = fs.lstatSync(value);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail('builder_git_project_integrity_failed');
}

function assertSafeProjectRoot(projectRoot) {
  assertSafeDirectory(path.dirname(projectRoot), false);
  assertSafeDirectory(projectRoot, true);
  const gitRoot = path.join(projectRoot, '.git');
  if (fs.existsSync(gitRoot)) assertSafeDirectory(gitRoot, false);
}

function changeSummary(candidate) {
  const before = new Map(candidate.base_source_tree.files.map((file) => [file.path, file.content_digest]));
  const after = new Map(candidate.resulting_source_tree.files.map((file) => [file.path, file.content_digest]));
  const added = [];
  const modified = [];
  const deleted = [];
  for (const [filePath, digest] of after) {
    if (!before.has(filePath)) added.push(filePath);
    else if (before.get(filePath) !== digest) modified.push(filePath);
  }
  for (const filePath of before.keys()) {
    if (!after.has(filePath)) deleted.push(filePath);
  }
  return freezeDeep({
    added: added.sort(),
    modified: modified.sort(),
    deleted: deleted.sort(),
  });
}

function parseOidOutput(result) {
  const oid = result.stdout.trim();
  if (!OID_PATTERN.test(oid)) fail('builder_git_project_failed');
  return oid;
}

function parseCommitObject(source) {
  const separator = source.indexOf('\n\n');
  if (separator < 0 || source.includes('\r') || source.includes('\0')) {
    fail('builder_git_project_integrity_failed');
  }
  const headerLines = source.slice(0, separator).split('\n');
  const messageLines = source.slice(separator + 2).split('\n');
  const headers = [];
  for (const line of headerLines) {
    const match = /^([a-z]+) (.+)$/u.exec(line);
    if (!match || line.startsWith(' ')) fail('builder_git_project_integrity_failed');
    headers.push([match[1], match[2]]);
  }
  const names = headers.map(([name]) => name);
  const expectedNames = names.includes('parent')
    ? ['tree', 'parent', 'author', 'committer']
    : ['tree', 'author', 'committer'];
  if (JSON.stringify(names) !== JSON.stringify(expectedNames)) fail('builder_git_project_integrity_failed');
  const treeOid = headers[0][1];
  const parentOids = names.includes('parent') ? [headers[1][1]] : [];
  if (!OID_PATTERN.test(treeOid) || parentOids.some((oid) => !OID_PATTERN.test(oid))) {
    fail('builder_git_project_integrity_failed');
  }
  const author = headers.at(-2)[1];
  const committer = headers.at(-1)[1];
  const expectedMessageLength = 2 + COMMIT_TRAILER_ORDER.length + 1;
  if (
    messageLines.length !== expectedMessageLength
    || messageLines[0] !== 'ClawFabric Builder candidate'
    || messageLines[1] !== ''
    || messageLines.at(-1) !== ''
  ) fail('builder_git_project_integrity_failed');
  const trailers = new Map();
  for (let index = 0; index < COMMIT_TRAILER_ORDER.length; index += 1) {
    const expectedName = COMMIT_TRAILER_ORDER[index];
    const match = /^Builder-([A-Za-z-]+): ([A-Za-z0-9:._-]+)$/u.exec(messageLines[index + 2]);
    if (!match || match[1] !== expectedName || trailers.has(match[1])) {
      fail('builder_git_project_integrity_failed');
    }
    trailers.set(match[1], match[2]);
  }
  return {
    tree_oid: treeOid,
    parent_oids: parentOids,
    author,
    committer,
    trailers,
  };
}

function expectedCommitTrailers(receipt) {
  return new Map([
    ['Object-Format', BUILDER_GIT_OBJECT_FORMAT],
    ['Project-Id', receipt.project_id],
    ['Conversation-Id', receipt.conversation_id],
    ['Turn-Id', receipt.turn_id],
    ['Task-Id', receipt.task_id],
    ['Run-Id', receipt.run_id],
    ['Request-Id', receipt.request_id],
    ['Semantic-Identity-Digest', receipt.semantic_identity_digest],
    ['Candidate-Digest', receipt.candidate_digest],
    ['Expected-Base-Oid', receipt.expected_base_oid ?? 'none'],
  ]);
}

function assertCommitMatchesReceipt(parsed, receipt) {
  if (parsed.tree_oid !== receipt.tree_oid) fail('builder_git_project_integrity_failed');
  const expectedParents = receipt.expected_base_oid === null ? [] : [receipt.expected_base_oid];
  if (JSON.stringify(parsed.parent_oids) !== JSON.stringify(expectedParents)) {
    fail('builder_git_project_integrity_failed');
  }
  if (
    !/^ClawFabric Builder <builder@localhost> \d+ \+0000$/u.test(parsed.author)
    || !/^ClawFabric Builder <builder@localhost> \d+ \+0000$/u.test(parsed.committer)
    || parsed.author !== parsed.committer
  ) fail('builder_git_project_integrity_failed');
  const expectedTrailers = expectedCommitTrailers(receipt);
  if (parsed.trailers.size !== expectedTrailers.size) fail('builder_git_project_integrity_failed');
  for (const [key, value] of expectedTrailers) {
    if (parsed.trailers.get(key) !== value) fail('builder_git_project_integrity_failed');
  }
}

async function readExistingRef(runner, projectRoot, operation, requestHash, semanticHash, timeoutMs) {
  const result = await runner.run(
    operation,
    projectRoot,
    {
      object_format: BUILDER_GIT_OBJECT_FORMAT,
      request_hash: requestHash,
      semantic_hash: semanticHash,
    },
    { timeout_ms: timeoutMs },
  );
  if (!result.found) return null;
  return parseOidOutput(result);
}

function createReceipt(request, semantic, commitOid, replay) {
  const verification = sanitizeBuilderGitCandidateVerificationReceipt({
    receipt_version: BUILDER_GIT_CANDIDATE_VERIFICATION_VERSION,
    repository_version: BUILDER_GIT_PROJECT_REPOSITORY_VERSION,
    project_id: request.candidate.project_id,
    conversation_id: request.candidate.conversation_id,
    turn_id: request.candidate.turn_id,
    task_id: request.candidate.task_id,
    run_id: request.candidate.run_id,
    request_id: request.request_id,
    candidate_id: request.candidate.candidate_id,
    candidate_digest: request.candidate.candidate_digest,
    expected_base_oid: request.expected_base_oid,
    commit_oid: commitOid,
    candidate_tree_oid: semantic.candidate_tree_oid,
    resulting_tree_digest: request.candidate.resulting_tree_digest,
    semantic_identity_digest: `sha256:${semantic.semantic_hash}`,
    object_format: BUILDER_GIT_OBJECT_FORMAT,
    commit_ref_admission: 'verified',
    request_ref_admission: 'verified',
    commit_object_admission: 'verified',
    verification_admission: 'accepted',
  });
  const receipt = sanitizeBuilderGitCandidateReceipt({
    receipt_version: BUILDER_GIT_CANDIDATE_RECEIPT_VERSION,
    repository_version: BUILDER_GIT_PROJECT_REPOSITORY_VERSION,
    project_id: request.candidate.project_id,
    conversation_id: request.candidate.conversation_id,
    turn_id: request.candidate.turn_id,
    task_id: request.candidate.task_id,
    run_id: request.candidate.run_id,
    request_id: request.request_id,
    candidate_id: request.candidate.candidate_id,
    candidate_digest: request.candidate.candidate_digest,
    resulting_tree_digest: request.candidate.resulting_tree_digest,
    semantic_identity_digest: `sha256:${semantic.semantic_hash}`,
    verification_receipt_digest: sha256Canonical(verification),
    object_format: BUILDER_GIT_OBJECT_FORMAT,
    commit_oid: commitOid,
    tree_oid: semantic.candidate_tree_oid,
    parent_oid: request.expected_base_oid,
    expected_base_oid: request.expected_base_oid,
    code_authority: CODE_AUTHORITY,
    product_revision_admission: PRODUCT_REVISION_ADMISSION,
    replay,
  });
  sanitizeBuilderGitCandidateReceiptPair(receipt, verification);
  return receipt;
}

function createProjectQueue() {
  const queues = new Map();
  return function runExclusive(projectId, task) {
    const key = projectUuid(projectId);
    const previous = queues.get(key) || Promise.resolve();
    const next = previous.then(task, task);
    const scheduled = next.catch(() => undefined).finally(() => {
      if (queues.get(key) === scheduled) queues.delete(key);
    });
    queues.set(key, scheduled);
    return next;
  };
}

function createBuilderGitProjectRepository(rawOptions) {
  assertExactObject(rawOptions, ['projects_root', 'runtime_root', 'git_runner', 'now_seconds']);
  const projectsRoot = safeAbsolutePath(valueAt(rawOptions, 'projects_root'));
  const runtimeRoot = safeAbsolutePath(valueAt(rawOptions, 'runtime_root'));
  const runner = valueAt(rawOptions, 'git_runner');
  if (!runner || typeof runner.run !== 'function') fail('builder_git_project_invalid');
  const nowSeconds = safeNowSeconds(valueAt(rawOptions, 'now_seconds'));
  fs.mkdirSync(projectsRoot, { recursive: true });
  fs.mkdirSync(runtimeRoot, { recursive: true });
  const runExclusive = createProjectQueue();

  async function ensureRepository(projectRoot) {
    assertSafeProjectRoot(projectRoot);
    fs.mkdirSync(projectRoot, { recursive: true });
    if (!fs.existsSync(path.join(projectRoot, '.git'))) {
      await runner.run('init_repository', projectRoot, {}, { timeout_ms: DEFAULT_TIMEOUT_MS });
    }
    assertSafeDirectory(path.join(projectRoot, '.git'), false);
    const format = await runner.run('read_object_format', projectRoot, {}, {
      timeout_ms: DEFAULT_TIMEOUT_MS,
    });
    if (format.stdout.trim() !== BUILDER_GIT_OBJECT_FORMAT) fail('builder_git_project_integrity_failed');
  }

  async function assertExistingRepository(projectRoot) {
    assertSafeDirectory(projectRoot, false);
    assertSafeDirectory(path.join(projectRoot, '.git'), false);
    const format = await runner.run('read_object_format', projectRoot, {}, {
      timeout_ms: DEFAULT_TIMEOUT_MS,
    });
    if (format.stdout.trim() !== BUILDER_GIT_OBJECT_FORMAT) fail('builder_git_project_integrity_failed');
  }

  async function buildTreeFromSourceTree(projectRoot, sourceTree, semanticHashHint) {
    const tree = sanitizeBuilderProjectSourceTree(sourceTree);
    const entries = [];
    for (const file of tree.files) {
      safeRelativeProjectPath(file.path);
      const blob = await runner.run(
        'hash_blob',
        projectRoot,
        { object_format: BUILDER_GIT_OBJECT_FORMAT, content: file.content },
        { timeout_ms: DEFAULT_TIMEOUT_MS },
      );
      entries.push({ path: file.path, oid: parseOidOutput(blob) });
    }
    const indexPath = gitControlIndexPath(projectRoot, semanticHashHint);
    fs.mkdirSync(path.dirname(indexPath), { recursive: true });
    try {
      await runner.run('reset_index_empty', projectRoot, { index_path: indexPath }, {
        timeout_ms: DEFAULT_TIMEOUT_MS,
      });
      if (entries.length > 0) {
        await runner.run('write_index', projectRoot, { index_path: indexPath, entries }, {
          timeout_ms: DEFAULT_TIMEOUT_MS,
        });
      }
      return parseOidOutput(await runner.run('write_tree', projectRoot, { index_path: indexPath }, {
        timeout_ms: DEFAULT_TIMEOUT_MS,
      }));
    } finally {
      fs.rmSync(indexPath, { force: true });
    }
  }

  async function assertExpectedBase(projectRoot, request, baseTreeOid) {
    if (request.expected_base_oid === null) {
      if (request.candidate.base_source_tree.files.length !== 0) fail('builder_git_project_invalid');
      return;
    }
    const parent = await runner.run(
      'read_commit',
      projectRoot,
      { object_format: BUILDER_GIT_OBJECT_FORMAT, oid: request.expected_base_oid },
      { timeout_ms: DEFAULT_TIMEOUT_MS },
    );
    const parsed = parseCommitObject(parent.stdout);
    if (parsed.tree_oid !== baseTreeOid) fail('builder_git_project_conflict');
    if (parsed.trailers.get('Project-Id') !== request.candidate.project_id) {
      fail('builder_git_project_conflict');
    }
    const parentSemantic = parsed.trailers.get('Semantic-Identity-Digest');
    const parentRequestId = parsed.trailers.get('Request-Id');
    if (!DIGEST_PATTERN.test(parentSemantic) || !BUILDER_ID_PATTERNS.request_id.test(parentRequestId)) {
      fail('builder_git_project_integrity_failed');
    }
    const semanticHash = parentSemantic.slice('sha256:'.length);
    const requestHash = sha256Hex(parentRequestId);
    const parentCandidateRef = await readExistingRef(
      runner,
      projectRoot,
      'read_candidate',
      requestHash,
      semanticHash,
      DEFAULT_TIMEOUT_MS,
    );
    const parentRequestRef = await readExistingRef(
      runner,
      projectRoot,
      'read_request',
      requestHash,
      semanticHash,
      DEFAULT_TIMEOUT_MS,
    );
    if (parentCandidateRef !== request.expected_base_oid || parentRequestRef !== request.expected_base_oid) {
      fail('builder_git_project_conflict');
    }
  }

  async function readSourceTreeFromGitTree(projectRoot, treeOid) {
    const listed = await runner.run(
      'list_tree',
      projectRoot,
      { object_format: BUILDER_GIT_OBJECT_FORMAT, oid: treeOid },
      { timeout_ms: DEFAULT_TIMEOUT_MS },
    );
    const entries = parseTreeEntries(listed.stdout);
    if (entries.length > MAX_SOURCE_FILES) fail('builder_git_project_integrity_failed');
    const files = [];
    let totalBytes = 0;
    for (const entry of entries) {
      const blob = await runner.run(
        'read_blob',
        projectRoot,
        { object_format: BUILDER_GIT_OBJECT_FORMAT, oid: entry.oid },
        { timeout_ms: DEFAULT_TIMEOUT_MS },
      );
      const blobBytes = Buffer.byteLength(blob.stdout, 'utf8');
      totalBytes += blobBytes;
      if (blobBytes > MAX_SOURCE_FILE_UTF8_BYTES || totalBytes > MAX_SOURCE_TREE_UTF8_BYTES) {
        fail('builder_git_project_integrity_failed');
      }
      files.push({ path: entry.path, content: blob.stdout });
    }
    return createBuilderProjectSourceTree({ files });
  }

  async function verifyReceiptAndSourceFromDisk(rawReceipt) {
    try {
      const receipt = sanitizeBuilderGitCandidateReceipt(rawReceipt);
      const projectRoot = projectDirectory(projectsRoot, receipt.project_id);
      await assertExistingRepository(projectRoot);
      const requestHash = sha256Hex(receipt.request_id);
      const semanticHash = receipt.semantic_identity_digest.slice('sha256:'.length);
      const candidateRef = await readExistingRef(
        runner,
        projectRoot,
        'read_candidate',
        requestHash,
        semanticHash,
        DEFAULT_TIMEOUT_MS,
      );
      const requestRef = await readExistingRef(
        runner,
        projectRoot,
        'read_request',
        requestHash,
        semanticHash,
        DEFAULT_TIMEOUT_MS,
      );
      if (candidateRef !== receipt.commit_oid || requestRef !== receipt.commit_oid) {
        fail('builder_git_project_integrity_failed');
      }
      const sourceTree = await readSourceTreeFromGitTree(projectRoot, receipt.tree_oid);
      if (sourceTree.source_tree_digest !== receipt.resulting_tree_digest) {
        fail('builder_git_project_integrity_failed');
      }
      const commit = await runner.run(
        'read_commit',
        projectRoot,
        { object_format: BUILDER_GIT_OBJECT_FORMAT, oid: receipt.commit_oid },
        { timeout_ms: DEFAULT_TIMEOUT_MS },
      );
      assertCommitMatchesReceipt(parseCommitObject(commit.stdout), receipt);
      const verification = createBuilderGitCandidateVerificationReceipt(receipt);
      sanitizeBuilderGitCandidateReceiptPair(receipt, verification);
      return freezeDeep({
        candidate_receipt: receipt,
        verification_receipt: verification,
        source_tree: sourceTree,
      });
    } catch (error) {
      return Promise.reject(normalizeError(error));
    }
  }

  async function verifyReceiptFromDisk(rawReceipt) {
    const verified = await verifyReceiptAndSourceFromDisk(rawReceipt);
    return verified.verification_receipt;
  }

  async function readVerifiedCandidate(rawReceipt) {
    const verified = await verifyReceiptAndSourceFromDisk(rawReceipt);
    return freezeDeep({
      result_version: BUILDER_GIT_VERIFIED_CANDIDATE_READ_RESULT_VERSION,
      candidate_receipt: verified.candidate_receipt,
      verification_receipt: verified.verification_receipt,
      source_tree: verified.source_tree,
      code_authority: 'git_commit_tree',
      read_admission: 'verified',
    });
  }

  async function prepareInternal(request) {
    const projectRoot = projectDirectory(projectsRoot, request.candidate.project_id);
    await ensureRepository(projectRoot);
    const preSemanticHash = sha256Hex(canonicalJson({
      project_id: request.candidate.project_id,
      request_id: request.request_id,
      candidate_digest: request.candidate.candidate_digest,
      expected_base_oid: request.expected_base_oid,
    }));
    const baseTreeOid = await buildTreeFromSourceTree(
      projectRoot,
      request.candidate.base_source_tree,
      `${preSemanticHash}-base`,
    );
    await assertExpectedBase(projectRoot, request, baseTreeOid);
    const treeOid = await buildTreeFromSourceTree(
      projectRoot,
      request.candidate.resulting_source_tree,
      preSemanticHash,
    );
    const semanticBody = semanticIdentity(request, treeOid);
    const semantic = {
      ...semanticBody,
      request_hash: sha256Hex(request.request_id),
      semantic_hash: sha256Hex(canonicalJson(semanticBody)),
      candidate_tree_oid: treeOid,
    };

    const existingRequestCommit = await readExistingRef(
      runner,
      projectRoot,
      'read_request',
      semantic.request_hash,
      semantic.semantic_hash,
      DEFAULT_TIMEOUT_MS,
    );
    if (existingRequestCommit !== null) {
      const existingCandidateCommit = await readExistingRef(
        runner,
        projectRoot,
        'read_candidate',
        semantic.request_hash,
        semantic.semantic_hash,
        DEFAULT_TIMEOUT_MS,
      );
      if (existingCandidateCommit !== existingRequestCommit) fail('builder_git_project_conflict');
      const receipt = createReceipt(request, semantic, existingRequestCommit, true);
      await verifyReceiptFromDisk(receipt);
      return { request, projectRoot, semantic, persisted: receipt };
    }

    const existingDifferentSemanticRequest = await readExistingRef(
      runner,
      projectRoot,
      'read_request',
      semantic.request_hash,
      '0'.repeat(64),
      DEFAULT_TIMEOUT_MS,
    );
    if (existingDifferentSemanticRequest !== null) fail('builder_git_project_conflict');

    const semanticBlob = await runner.run(
      'hash_blob',
      projectRoot,
      { object_format: BUILDER_GIT_OBJECT_FORMAT, content: `${canonicalJson(semantic)}\n` },
      { timeout_ms: DEFAULT_TIMEOUT_MS },
    );
    const semanticBlobOid = parseOidOutput(semanticBlob);
    const pendingTree = await readExistingRef(
      runner,
      projectRoot,
      'read_pending_candidate',
      semantic.request_hash,
      semantic.semantic_hash,
      DEFAULT_TIMEOUT_MS,
    );
    const pendingRequest = await readExistingRef(
      runner,
      projectRoot,
      'read_pending_request',
      semantic.request_hash,
      semantic.semantic_hash,
      DEFAULT_TIMEOUT_MS,
    );
    if ((pendingTree === null) !== (pendingRequest === null)) fail('builder_git_project_conflict');
    if (pendingTree !== null && (pendingTree !== treeOid || pendingRequest !== semanticBlobOid)) {
      fail('builder_git_project_conflict');
    }
    if (pendingTree === null) {
      await runner.run(
        'create_pending_refs',
        projectRoot,
        {
          object_format: BUILDER_GIT_OBJECT_FORMAT,
          request_hash: semantic.request_hash,
          semantic_hash: semantic.semantic_hash,
          tree_oid: treeOid,
          semantic_blob_oid: semanticBlobOid,
        },
        { timeout_ms: DEFAULT_TIMEOUT_MS },
      );
    }
    return {
      request,
      projectRoot,
      semantic,
      semanticBlobOid,
      persisted: null,
    };
  }

  async function prepareChange(rawRequest) {
    let request;
    try {
      request = sanitizeRequest(rawRequest);
    } catch (error) {
      return Promise.reject(normalizeError(error));
    }
    return runExclusive(request.candidate.project_id, async () => {
      try {
        const prepared = await prepareInternal(request);
        return freezeDeep({
          repository_version: BUILDER_GIT_PROJECT_REPOSITORY_VERSION,
          state: prepared.persisted ? 'candidate_persisted' : 'pending_confirmation',
          replay: prepared.persisted !== null,
          project_id: prepared.request.candidate.project_id,
          candidate_id: prepared.request.candidate.candidate_id,
          candidate_digest: prepared.request.candidate.candidate_digest,
          request_id: prepared.request.request_id,
          expected_base_oid: prepared.request.expected_base_oid,
          candidate_tree_oid: prepared.semantic.candidate_tree_oid,
          semantic_identity_digest: `sha256:${prepared.semantic.semantic_hash}`,
          code_authority: 'not_committed',
          product_revision_admission: PRODUCT_REVISION_ADMISSION,
          changes: changeSummary(prepared.request.candidate),
        });
      } catch (error) {
        return Promise.reject(normalizeError(error));
      }
    });
  }

  async function persistCandidateCommit(rawRequest) {
    let request;
    try {
      request = sanitizeRequest(rawRequest);
    } catch (error) {
      return Promise.reject(normalizeError(error));
    }
    return runExclusive(request.candidate.project_id, async () => {
      try {
        const prepared = await prepareInternal(request);
        if (prepared.persisted) return prepared.persisted;
        const commit = await runner.run(
          'commit_tree',
          prepared.projectRoot,
          {
            object_format: BUILDER_GIT_OBJECT_FORMAT,
            tree_oid: prepared.semantic.candidate_tree_oid,
            parent_oid: prepared.request.expected_base_oid,
            project_id: prepared.request.candidate.project_id,
            conversation_id: prepared.request.candidate.conversation_id,
            turn_id: prepared.request.candidate.turn_id,
            task_id: prepared.request.candidate.task_id,
            run_id: prepared.request.candidate.run_id,
            request_id: prepared.request.request_id,
            semantic_identity_digest: `sha256:${prepared.semantic.semantic_hash}`,
            candidate_digest: prepared.request.candidate.candidate_digest,
            expected_base_oid: prepared.request.expected_base_oid,
            author_time: nowSeconds(),
          },
          { timeout_ms: DEFAULT_TIMEOUT_MS },
        );
        const commitOid = parseOidOutput(commit);
        await runner.run(
          'persist_candidate_commit_refs',
          prepared.projectRoot,
          {
            object_format: BUILDER_GIT_OBJECT_FORMAT,
            request_hash: prepared.semantic.request_hash,
            semantic_hash: prepared.semantic.semantic_hash,
            commit_oid: commitOid,
            tree_oid: prepared.semantic.candidate_tree_oid,
            semantic_blob_oid: prepared.semanticBlobOid,
          },
          { timeout_ms: DEFAULT_TIMEOUT_MS },
        );
        const receipt = createReceipt(
          prepared.request,
          prepared.semantic,
          commitOid,
          false,
        );
        await verifyReceiptFromDisk(receipt);
        return receipt;
      } catch (error) {
        return Promise.reject(normalizeError(error));
      }
    });
  }

  return Object.freeze({
    prepare_change: prepareChange,
    persist_candidate_commit: persistCandidateCommit,
    read_verified_candidate: readVerifiedCandidate,
    verify_candidate_receipt: verifyReceiptFromDisk,
  });
}

function createDefaultBuilderGitProjectRepository(options) {
  assertExactObject(options, ['projects_root', 'runtime_root', 'now_seconds']);
  const runtimeRoot = valueAt(options, 'runtime_root');
  return createBuilderGitProjectRepository({
    projects_root: valueAt(options, 'projects_root'),
    runtime_root: runtimeRoot,
    git_runner: createDefaultBuilderGitCommandRunner({ runtime_root: runtimeRoot }),
    now_seconds: valueAt(options, 'now_seconds'),
  });
}

module.exports = Object.freeze({
  BUILDER_GIT_PROJECT_REPOSITORY_VERSION,
  BUILDER_GIT_CANDIDATE_RECEIPT_VERSION,
  BUILDER_GIT_CANDIDATE_VERIFICATION_VERSION,
  BUILDER_GIT_VERIFIED_CANDIDATE_READ_RESULT_VERSION,
  CODE_AUTHORITY,
  PRODUCT_REVISION_ADMISSION,
  ZERO_OID,
  BuilderGitProjectRepositoryError,
  createBuilderGitProjectRepository,
  createDefaultBuilderGitProjectRepository,
});
