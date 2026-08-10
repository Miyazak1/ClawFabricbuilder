'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn: nodeSpawn } = require('node:child_process');
const { TextDecoder: NodeTextDecoder, types: utilTypes } = require('node:util');

const {
  resolveEmbeddedGitDir,
  resolveGitBinary,
} = require('dugite');

const ABORT_SIGNAL_ABORTED_GETTER = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted').get;
const EVENT_TARGET_ADD_EVENT_LISTENER = EventTarget.prototype.addEventListener;
const EVENT_TARGET_REMOVE_EVENT_LISTENER = EventTarget.prototype.removeEventListener;
const BUILDER_GIT_RUNNER_VERSION = 'builder-git-command-runner.v1';
const MAX_GIT_INPUT_BYTES = 8 * 1024 * 1024;
const MAX_GIT_OUTPUT_BYTES = 8 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;
const TERMINATION_GRACE_MS = 1_000;
const BUILDER_GIT_OBJECT_FORMAT = 'sha1';
const ZERO_OID = '0'.repeat(40);
const MAIN_REF = 'refs/heads/main';
const OID_PATTERN = /^[0-9a-f]{40}$/u;
const REQUEST_HASH_PATTERN = /^[0-9a-f]{64}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const SAFE_TRAILER_VALUE_PATTERN = /^[A-Za-z0-9:._-]+$/u;
const SAFE_PATH_PATTERN = /^(?!\/)(?!.*(?:^|\/)\.\.?\/)(?!.*\\)[^\0\r\n]+$/u;
const UTF8_DECODER = new NodeTextDecoder('utf-8', { fatal: true, ignoreBOM: true });

const ERROR_MESSAGES = Object.freeze({
  builder_git_command_invalid: 'The local Git request could not be verified.',
  builder_git_command_failed: 'The local Git operation failed.',
  builder_git_command_timeout: 'The local Git operation timed out.',
  builder_git_command_termination_failed: 'The local Git operation could not be stopped.',
  builder_git_command_cancelled: 'The local Git operation was cancelled.',
  builder_git_command_output_exceeded: 'The local Git operation returned too much data.',
  builder_git_command_unavailable: 'The bundled Git runtime is unavailable.',
});

class BuilderGitCommandRunnerError extends Error {
  constructor(code = 'builder_git_command_invalid') {
    const selected = Object.hasOwn(ERROR_MESSAGES, code)
      ? code
      : 'builder_git_command_invalid';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderGitCommandRunnerError';
    this.code = selected;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) {
  throw new BuilderGitCommandRunnerError(code);
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || utilTypes.isProxy(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertExactObject(value, expectedKeys) {
  if (!isPlainObject(value)) fail('builder_git_command_invalid');
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== expectedKeys.length
    || keys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))
  ) fail('builder_git_command_invalid');
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      fail('builder_git_command_invalid');
    }
  }
}

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
    fail('builder_git_command_invalid');
  }
  return descriptor.value;
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
  ) fail('builder_git_command_invalid');
  return value;
}

function canonicalRepositoryPath(value) {
  const selected = safeAbsolutePath(value);
  try {
    return fs.realpathSync.native(selected);
  } catch {
    return selected;
  }
}

function safeObjectFormat(value) {
  if (value !== BUILDER_GIT_OBJECT_FORMAT) fail('builder_git_command_invalid');
  return value;
}

function safeOid(value, objectFormat, nullable = false) {
  safeObjectFormat(objectFormat);
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || !OID_PATTERN.test(value)) fail('builder_git_command_invalid');
  return value;
}

function safeRequestHash(value) {
  if (typeof value !== 'string' || !REQUEST_HASH_PATTERN.test(value)) {
    fail('builder_git_command_invalid');
  }
  return value;
}

function safeDigest(value) {
  if (typeof value !== 'string' || !DIGEST_PATTERN.test(value)) {
    fail('builder_git_command_invalid');
  }
  return value;
}

function safeTrailerValue(value, maximum = 200) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > maximum
    || !SAFE_TRAILER_VALUE_PATTERN.test(value)
  ) fail('builder_git_command_invalid');
  return value;
}

function safeIndexPath(value, repositoryPath) {
  const selected = safeAbsolutePath(value);
  const gitControlRoot = path.join(repositoryPath, '.git', 'clawfabric', 'indexes');
  const relative = path.relative(gitControlRoot, selected);
  if (
    relative.startsWith('..')
    || path.isAbsolute(relative)
    || relative.includes(path.sep)
    || !relative.endsWith('.index')
  ) fail('builder_git_command_invalid');
  for (const directory of [
    path.join(repositoryPath, '.git'),
    path.join(repositoryPath, '.git', 'clawfabric'),
    gitControlRoot,
  ]) {
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail('builder_git_command_invalid');
  }
  if (fs.existsSync(selected)) {
    const stat = fs.lstatSync(selected);
    if (!stat.isFile() || stat.isSymbolicLink()) fail('builder_git_command_invalid');
  }
  return selected;
}

function cleanupOperationIndexPath(indexPath) {
  if (!indexPath || !fs.existsSync(indexPath)) return;
  const stat = fs.lstatSync(indexPath);
  if (!stat.isFile() && !stat.isSymbolicLink()) fail('builder_git_command_invalid');
  fs.rmSync(indexPath, { force: true });
}

const poisonedRepositories = new Map();

function isRepositoryPoisoned(repositoryKey) {
  return poisonedRepositories.has(repositoryKey);
}

function poisonRepository(repositoryKey, token) {
  const tokens = poisonedRepositories.get(repositoryKey) || new Set();
  tokens.add(token);
  poisonedRepositories.set(repositoryKey, tokens);
}

function clearRepositoryPoison(repositoryKey, token) {
  const tokens = poisonedRepositories.get(repositoryKey);
  if (!tokens || !tokens.has(token)) return;
  tokens.delete(token);
  if (tokens.size === 0) poisonedRepositories.delete(repositoryKey);
}

function safeEntryPath(value) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > 1_024
    || !SAFE_PATH_PATTERN.test(value)
  ) fail('builder_git_command_invalid');
  return value;
}

function safeEntries(value) {
  if (!Array.isArray(value) || utilTypes.isProxy(value) || value.length > 512) {
    fail('builder_git_command_invalid');
  }
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key === 'symbol') || keys.length !== value.length + 1) {
    fail('builder_git_command_invalid');
  }
  return value.map((entry, index) => {
    if (!Object.hasOwn(value, index)) fail('builder_git_command_invalid');
    assertExactObject(entry, ['path', 'oid']);
    return {
      path: safeEntryPath(valueAt(entry, 'path')),
      oid: safeOid(valueAt(entry, 'oid'), BUILDER_GIT_OBJECT_FORMAT),
    };
  });
}

function safeTextInput(value, maximum = MAX_GIT_INPUT_BYTES) {
  if (
    typeof value !== 'string'
    || value.includes('\0')
    || Buffer.byteLength(value, 'utf8') > maximum
  ) fail('builder_git_command_invalid');
  return value;
}

function safeAuthorTime(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 4_102_444_800) {
    fail('builder_git_command_invalid');
  }
  return value;
}

function systemRoot() {
  if (process.platform !== 'win32') return null;
  const fallback = `${path.parse(process.execPath).root}Windows`;
  const candidate = process.env.SystemRoot || process.env.WINDIR || fallback;
  if (
    typeof candidate !== 'string'
    || !path.win32.isAbsolute(candidate)
    || candidate.includes('\0')
    || candidate.includes('\r')
    || candidate.includes('\n')
  ) return fallback;
  return path.win32.normalize(candidate);
}

function embeddedArchitectureDirectory() {
  if (process.arch === 'x64') return 'mingw64';
  if (process.arch === 'arm64') return 'clangarm64';
  return 'mingw32';
}

function createMinimalEnvironment(runtimeRoot, gitRoot, operationEnvironment) {
  const home = path.join(runtimeRoot, 'home');
  const xdg = path.join(runtimeRoot, 'xdg');
  const temporary = path.join(runtimeRoot, 'tmp');
  const hooks = path.join(runtimeRoot, 'hooks');
  for (const directory of [runtimeRoot, home, xdg, temporary, hooks]) {
    fs.mkdirSync(directory, { recursive: true });
  }

  const nullDevice = process.platform === 'win32' ? 'NUL' : '/dev/null';
  const environment = {
    HOME: home,
    XDG_CONFIG_HOME: xdg,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: nullDevice,
    GIT_CONFIG_SYSTEM: nullDevice,
    GIT_TERMINAL_PROMPT: '0',
    GCM_INTERACTIVE: 'Never',
    GIT_OPTIONAL_LOCKS: operationEnvironment.writeOperation ? '1' : '0',
    GIT_NO_REPLACE_OBJECTS: '1',
    GIT_EXEC_PATH: process.platform === 'win32'
      ? path.join(gitRoot, embeddedArchitectureDirectory(), 'libexec', 'git-core')
      : path.join(gitRoot, 'libexec', 'git-core'),
    GIT_ATTR_NOSYSTEM: '1',
    LC_ALL: 'C',
    LANG: 'C',
    TEMP: temporary,
    TMP: temporary,
    TMPDIR: temporary,
    PATH: process.platform === 'win32'
      ? [
        path.join(gitRoot, embeddedArchitectureDirectory(), 'bin'),
        path.join(gitRoot, embeddedArchitectureDirectory(), 'usr', 'bin'),
      ].join(path.delimiter)
      : path.join(gitRoot, 'bin'),
  };
  if (process.platform === 'win32') {
    environment.SystemRoot = systemRoot();
    environment.WINDIR = environment.SystemRoot;
  }
  if (operationEnvironment.indexPath) environment.GIT_INDEX_FILE = operationEnvironment.indexPath;
  if (operationEnvironment.authorTime) {
    const timestamp = `${operationEnvironment.authorTime} +0000`;
    environment.GIT_AUTHOR_NAME = 'ClawFabric Builder';
    environment.GIT_AUTHOR_EMAIL = 'builder@localhost';
    environment.GIT_AUTHOR_DATE = timestamp;
    environment.GIT_COMMITTER_NAME = 'ClawFabric Builder';
    environment.GIT_COMMITTER_EMAIL = 'builder@localhost';
    environment.GIT_COMMITTER_DATE = timestamp;
  }
  return environment;
}

function fixedGitPrefix(runtimeRoot) {
  return [
    '--no-replace-objects',
    '-c', 'commit.gpgSign=false',
    '-c', `core.hooksPath=${path.join(runtimeRoot, 'hooks')}`,
    '-c', `core.attributesFile=${process.platform === 'win32' ? 'NUL' : '/dev/null'}`,
    '-c', 'core.fsmonitor=false',
    '-c', 'core.untrackedCache=false',
    '-c', 'core.preloadIndex=false',
    '-c', 'credential.helper=',
    '-c', 'core.askPass=',
    '-c', 'diff.external=',
    '-c', 'protocol.file.allow=never',
    '-c', 'protocol.allow=never',
  ];
}

function refNames(requestHash, semanticHash = '0'.repeat(64)) {
  const safeRequest = safeRequestHash(requestHash);
  const safeSemantic = safeRequestHash(semanticHash);
  return {
    pendingCandidate: `refs/clawfabric/pending/candidates/${safeSemantic}`,
    pendingRequest: `refs/clawfabric/pending/requests/${safeRequest}`,
    candidate: `refs/clawfabric/candidates/${safeSemantic}`,
    request: `refs/clawfabric/requests/${safeRequest}`,
  };
}

function commandFor(operation, rawRequest) {
  switch (operation) {
    case 'init_repository': {
      assertExactObject(rawRequest, []);
      return {
        args: ['init', '--quiet', '--initial-branch=main', '--template='],
        stdin: '',
        writeOperation: true,
      };
    }
    case 'read_object_format': {
      assertExactObject(rawRequest, []);
      return {
        args: ['rev-parse', '--show-object-format'],
        stdin: '',
        writeOperation: false,
      };
    }
    case 'read_main_ref': {
      assertExactObject(rawRequest, ['object_format']);
      safeObjectFormat(valueAt(rawRequest, 'object_format'));
      return {
        args: [
          'rev-parse',
          '--verify',
          '--quiet',
          '--end-of-options',
          MAIN_REF,
        ],
        stdin: '',
        writeOperation: false,
        allowMissing: true,
      };
    }
    case 'hash_blob': {
      assertExactObject(rawRequest, ['object_format', 'content']);
      safeObjectFormat(valueAt(rawRequest, 'object_format'));
      return {
        args: ['hash-object', '--no-filters', '-w', '--stdin'],
        stdin: safeTextInput(valueAt(rawRequest, 'content'), 512 * 1_024),
        writeOperation: true,
      };
    }
    case 'write_index': {
      assertExactObject(rawRequest, ['index_path', 'entries']);
      const entries = safeEntries(valueAt(rawRequest, 'entries'));
      const stdin = entries.map((entry) => `100644 ${entry.oid}\t${entry.path}\0`).join('');
      return {
        args: ['update-index', '--add', '-z', '--index-info'],
        stdin,
        writeOperation: true,
        indexPath: valueAt(rawRequest, 'index_path'),
      };
    }
    case 'reset_index_empty': {
      assertExactObject(rawRequest, ['index_path']);
      return {
        args: ['read-tree', '--empty'],
        stdin: '',
        writeOperation: true,
        indexPath: valueAt(rawRequest, 'index_path'),
      };
    }
    case 'write_tree': {
      assertExactObject(rawRequest, ['index_path']);
      return {
        args: ['write-tree'],
        stdin: '',
        writeOperation: true,
        indexPath: valueAt(rawRequest, 'index_path'),
      };
    }
    case 'read_pending_candidate':
    case 'read_pending_request':
    case 'read_candidate':
    case 'read_request': {
      assertExactObject(rawRequest, ['object_format', 'request_hash', 'semantic_hash']);
      safeObjectFormat(valueAt(rawRequest, 'object_format'));
      const refs = refNames(
        valueAt(rawRequest, 'request_hash'),
        valueAt(rawRequest, 'semantic_hash'),
      );
      const ref = {
        read_pending_candidate: refs.pendingCandidate,
        read_pending_request: refs.pendingRequest,
        read_candidate: refs.candidate,
        read_request: refs.request,
      }[operation];
      return {
        args: [
          'rev-parse',
          '--verify',
          '--quiet',
          '--end-of-options',
          ref,
        ],
        stdin: '',
        writeOperation: false,
        allowMissing: true,
      };
    }
    case 'read_commit': {
      assertExactObject(rawRequest, ['object_format', 'oid']);
      return {
        args: [
          'cat-file',
          'commit',
          safeOid(valueAt(rawRequest, 'oid'), valueAt(rawRequest, 'object_format')),
        ],
        stdin: '',
        writeOperation: false,
      };
    }
    case 'list_tree': {
      assertExactObject(rawRequest, ['object_format', 'oid']);
      return {
        args: [
          'ls-tree',
          '-rz',
          '--full-tree',
          safeOid(valueAt(rawRequest, 'oid'), valueAt(rawRequest, 'object_format')),
        ],
        stdin: '',
        writeOperation: false,
      };
    }
    case 'read_blob': {
      assertExactObject(rawRequest, ['object_format', 'oid']);
      return {
        args: [
          'cat-file',
          'blob',
          safeOid(valueAt(rawRequest, 'oid'), valueAt(rawRequest, 'object_format')),
        ],
        stdin: '',
        writeOperation: false,
      };
    }
    case 'create_pending_refs': {
      assertExactObject(rawRequest, [
        'object_format', 'request_hash', 'semantic_hash', 'tree_oid', 'semantic_blob_oid',
      ]);
      const objectFormat = safeObjectFormat(valueAt(rawRequest, 'object_format'));
      const refs = refNames(
        valueAt(rawRequest, 'request_hash'),
        valueAt(rawRequest, 'semantic_hash'),
      );
      const treeOid = safeOid(valueAt(rawRequest, 'tree_oid'), objectFormat);
      const semanticBlobOid = safeOid(
        valueAt(rawRequest, 'semantic_blob_oid'),
        objectFormat,
      );
      return {
        args: ['update-ref', '--stdin'],
        stdin: [
          'start',
          `create ${refs.pendingCandidate} ${treeOid}`,
          `create ${refs.pendingRequest} ${semanticBlobOid}`,
          'prepare',
          'commit',
          '',
        ].join('\n'),
        writeOperation: true,
      };
    }
    case 'commit_tree': {
      assertExactObject(rawRequest, [
        'object_format',
        'tree_oid',
        'parent_oid',
        'project_id',
        'conversation_id',
        'turn_id',
        'task_id',
        'run_id',
        'request_id',
        'semantic_identity_digest',
        'candidate_digest',
        'base_source_tree_digest',
        'expected_base_oid',
        'author_time',
      ]);
      const objectFormat = safeObjectFormat(valueAt(rawRequest, 'object_format'));
      const treeOid = safeOid(valueAt(rawRequest, 'tree_oid'), objectFormat);
      const parentOid = safeOid(valueAt(rawRequest, 'parent_oid'), objectFormat, true);
      const candidateDigest = safeDigest(valueAt(rawRequest, 'candidate_digest'));
      const baseSourceTreeDigest = safeDigest(valueAt(rawRequest, 'base_source_tree_digest'));
      const semanticIdentityDigest = safeDigest(
        valueAt(rawRequest, 'semantic_identity_digest'),
      );
      const expectedBase = valueAt(rawRequest, 'expected_base_oid') === null
        ? 'none'
        : safeOid(valueAt(rawRequest, 'expected_base_oid'), objectFormat);
      const args = ['commit-tree', treeOid];
      if (parentOid !== null) args.push('-p', parentOid);
      return {
        args,
        stdin: [
          'ClawFabric Builder candidate',
          '',
          `Builder-Object-Format: ${objectFormat}`,
          `Builder-Project-Id: ${safeTrailerValue(valueAt(rawRequest, 'project_id'))}`,
          `Builder-Conversation-Id: ${safeTrailerValue(valueAt(rawRequest, 'conversation_id'))}`,
          `Builder-Turn-Id: ${safeTrailerValue(valueAt(rawRequest, 'turn_id'))}`,
          `Builder-Task-Id: ${safeTrailerValue(valueAt(rawRequest, 'task_id'))}`,
          `Builder-Run-Id: ${safeTrailerValue(valueAt(rawRequest, 'run_id'))}`,
          `Builder-Request-Id: ${safeTrailerValue(valueAt(rawRequest, 'request_id'))}`,
          `Builder-Semantic-Identity-Digest: ${semanticIdentityDigest}`,
          `Builder-Candidate-Digest: ${candidateDigest}`,
          `Builder-Base-Source-Tree-Digest: ${baseSourceTreeDigest}`,
          `Builder-Expected-Base-Oid: ${expectedBase}`,
          '',
        ].join('\n'),
        writeOperation: true,
        authorTime: safeAuthorTime(valueAt(rawRequest, 'author_time')),
      };
    }
    case 'persist_candidate_refs':
    case 'persist_candidate_commit_refs': {
      assertExactObject(rawRequest, [
        'object_format',
        'request_hash',
        'semantic_hash',
        'commit_oid',
        'tree_oid',
        'semantic_blob_oid',
      ]);
      const objectFormat = safeObjectFormat(valueAt(rawRequest, 'object_format'));
      const refs = refNames(
        valueAt(rawRequest, 'request_hash'),
        valueAt(rawRequest, 'semantic_hash'),
      );
      const commitOid = safeOid(valueAt(rawRequest, 'commit_oid'), objectFormat);
      const treeOid = safeOid(valueAt(rawRequest, 'tree_oid'), objectFormat);
      const semanticBlobOid = safeOid(
        valueAt(rawRequest, 'semantic_blob_oid'),
        objectFormat,
      );
      return {
        args: ['update-ref', '--stdin'],
        stdin: [
          'start',
          `create ${refs.candidate} ${commitOid}`,
          `create ${refs.request} ${commitOid}`,
          `delete ${refs.pendingCandidate} ${treeOid}`,
          `delete ${refs.pendingRequest} ${semanticBlobOid}`,
          'prepare',
          'commit',
          '',
        ].join('\n'),
        writeOperation: true,
      };
    }
    case 'update_main_ref': {
      assertExactObject(rawRequest, ['object_format', 'commit_oid', 'expected_old_oid']);
      const objectFormat = safeObjectFormat(valueAt(rawRequest, 'object_format'));
      const commitOid = safeOid(valueAt(rawRequest, 'commit_oid'), objectFormat);
      const expectedOldOid = safeOid(valueAt(rawRequest, 'expected_old_oid'), objectFormat, true);
      if (commitOid === ZERO_OID) fail('builder_git_command_invalid');
      return {
        args: ['update-ref', '--stdin'],
        stdin: [
          'start',
          `update ${MAIN_REF} ${commitOid} ${expectedOldOid ?? ZERO_OID}`,
          'prepare',
          'commit',
          '',
        ].join('\n'),
        writeOperation: true,
      };
    }
    default:
      fail('builder_git_command_invalid');
  }
}

function normalizeError(error) {
  if (
    error
    && typeof error === 'object'
    && !utilTypes.isProxy(error)
    && Object.getPrototypeOf(error) === BuilderGitCommandRunnerError.prototype
  ) {
    const descriptor = Object.getOwnPropertyDescriptor(error, 'code');
    if (
      descriptor
      && Object.hasOwn(descriptor, 'value')
      && Object.hasOwn(ERROR_MESSAGES, descriptor.value)
    ) {
      return new BuilderGitCommandRunnerError(descriptor.value);
    }
  }
  return new BuilderGitCommandRunnerError('builder_git_command_failed');
}

function abortSignalAborted(value) {
  if (!value || typeof value !== 'object' || utilTypes.isProxy(value)) {
    fail('builder_git_command_invalid');
  }
  try {
    return ABORT_SIGNAL_ABORTED_GETTER.call(value) === true;
  } catch {
    fail('builder_git_command_invalid');
  }
}

function safeAbortSignal(value) {
  abortSignalAborted(value);
  return value;
}

function exactExecutionKeys(value) {
  if (!isPlainObject(value)) fail('builder_git_command_invalid');
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== 'string')) fail('builder_git_command_invalid');
  return keys.includes('signal') ? ['timeout_ms', 'signal'] : ['timeout_ms'];
}

function createBuilderGitCommandRunner(rawOptions) {
  assertExactObject(rawOptions, ['runtime_root', 'spawn_process']);
  const runtimeRoot = safeAbsolutePath(valueAt(rawOptions, 'runtime_root'));
  const spawnProcess = valueAt(rawOptions, 'spawn_process');
  if (typeof spawnProcess !== 'function') fail('builder_git_command_invalid');

  let gitBinary;
  let gitRoot;
  try {
    gitBinary = path.normalize(resolveGitBinary(''));
    gitRoot = path.normalize(resolveEmbeddedGitDir());
    if (!path.isAbsolute(gitBinary) || !fs.statSync(gitBinary).isFile()) {
      fail('builder_git_command_unavailable');
    }
  } catch (error) {
    if (error instanceof BuilderGitCommandRunnerError) throw error;
    fail('builder_git_command_unavailable');
  }

  function run(operation, repositoryPathValue, rawRequest, rawExecution = {}) {
    let repositoryPath;
    let repositoryKey;
    let command;
    let timeoutMs;
    let signal;
    let signalAlreadyAborted = false;
    try {
      repositoryPath = safeAbsolutePath(repositoryPathValue);
      repositoryKey = canonicalRepositoryPath(repositoryPath);
      if (isRepositoryPoisoned(repositoryKey)) {
        throw new BuilderGitCommandRunnerError('builder_git_command_termination_failed');
      }
      const executionKeys = exactExecutionKeys(rawExecution);
      assertExactObject(rawExecution, executionKeys);
      timeoutMs = valueAt(rawExecution, 'timeout_ms');
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) {
        fail('builder_git_command_invalid');
      }
      signal = executionKeys.includes('signal') ? safeAbortSignal(valueAt(rawExecution, 'signal')) : null;
      signalAlreadyAborted = signal !== null && abortSignalAborted(signal);
      command = commandFor(operation, rawRequest);
      if (command.indexPath) command.indexPath = safeIndexPath(command.indexPath, repositoryPath);
      if (Buffer.byteLength(command.stdin, 'utf8') > MAX_GIT_INPUT_BYTES) {
        fail('builder_git_command_invalid');
      }
    } catch (error) {
      return Promise.reject(normalizeError(error));
    }

    if (signalAlreadyAborted) {
      return Promise.reject(new BuilderGitCommandRunnerError('builder_git_command_cancelled'));
    }

    return new Promise((resolve, reject) => {
      let child;
      let settled = false;
      let terminationCode = null;
      let terminationTimer = null;
      let poisonToken = null;
      let outputBytes = 0;
      const stdoutChunks = [];
      const stderrChunks = [];
      const finish = (error, result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (terminationTimer) clearTimeout(terminationTimer);
        if (signal) {
          try {
            EVENT_TARGET_REMOVE_EVENT_LISTENER.call(signal, 'abort', onAbort);
          } catch {
            // The public result is already fixed.
          }
        }
        if (error) reject(error);
        else resolve(Object.freeze(result));
      };
      const terminate = (code) => {
        if (settled || terminationCode !== null) return;
        terminationCode = code;
        poisonToken = Symbol(operation);
        poisonRepository(repositoryKey, poisonToken);
        try {
          child.kill();
        } catch {
          // The close/error handlers below still provide the fixed redacted result.
        }
        if (process.platform === 'win32' && Number.isSafeInteger(child.pid)) {
          try {
            const killer = nodeSpawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], {
              shell: false,
              windowsHide: true,
              stdio: 'ignore',
            });
            killer.once('error', () => undefined);
          } catch {
            // The direct child kill remains the portable fallback.
          }
        }
        terminationTimer = setTimeout(() => {
          finish(new BuilderGitCommandRunnerError('builder_git_command_termination_failed'));
        }, TERMINATION_GRACE_MS);
      };
      const cleanupTerminatedOperation = () => {
        if (poisonToken) {
          clearRepositoryPoison(repositoryKey, poisonToken);
          poisonToken = null;
        }
        if (terminationCode !== null && command.indexPath) {
          try {
            cleanupOperationIndexPath(command.indexPath);
          } catch {
            // The public result is already fixed and redacted for terminated operations.
          }
        }
      };
      const capture = (target) => (chunk) => {
        if (terminationCode !== null) return;
        const copy = Buffer.from(chunk);
        outputBytes += copy.length;
        if (outputBytes > MAX_GIT_OUTPUT_BYTES) {
          terminate('builder_git_command_output_exceeded');
          return;
        }
        target.push(copy);
      };
      const onAbort = () => terminate('builder_git_command_cancelled');
      const timer = setTimeout(
        () => terminate('builder_git_command_timeout'),
        timeoutMs || DEFAULT_TIMEOUT_MS,
      );

      try {
        const env = createMinimalEnvironment(runtimeRoot, gitRoot, command);
        child = spawnProcess(
          gitBinary,
          [...fixedGitPrefix(runtimeRoot), ...command.args],
          {
            cwd: repositoryPath,
            env,
            shell: false,
            windowsHide: true,
            stdio: ['pipe', 'pipe', 'pipe'],
          },
        );
      } catch {
        finish(new BuilderGitCommandRunnerError('builder_git_command_failed'));
        return;
      }
      child.once('error', () => {
        if (terminationCode !== null) return;
        cleanupTerminatedOperation();
        finish(new BuilderGitCommandRunnerError('builder_git_command_failed'));
      });
      child.stdout.on('data', capture(stdoutChunks));
      child.stderr.on('data', capture(stderrChunks));
      child.once('close', (code, closeSignal) => {
        cleanupTerminatedOperation();
        if (settled) return;
        if (terminationCode !== null) {
          finish(new BuilderGitCommandRunnerError(terminationCode));
          return;
        }
        if (code !== 0 || closeSignal !== null) {
          if (command.allowMissing && code === 1 && closeSignal === null) {
            finish(null, {
              runner_version: BUILDER_GIT_RUNNER_VERSION,
              operation,
              found: false,
              stdout: '',
            });
            return;
          }
          finish(new BuilderGitCommandRunnerError('builder_git_command_failed'));
          return;
        }
        let stdout;
        try {
          stdout = UTF8_DECODER.decode(Buffer.concat(stdoutChunks));
          UTF8_DECODER.decode(Buffer.concat(stderrChunks));
        } catch {
          finish(new BuilderGitCommandRunnerError('builder_git_command_failed'));
          return;
        }
        finish(null, {
          runner_version: BUILDER_GIT_RUNNER_VERSION,
          operation,
          found: true,
          stdout,
        });
      });
      child.stdin.once('error', () => undefined);
      if (signal) {
        try {
          EVENT_TARGET_ADD_EVENT_LISTENER.call(signal, 'abort', onAbort, { once: true });
          if (abortSignalAborted(signal)) onAbort();
        } catch {
          finish(new BuilderGitCommandRunnerError('builder_git_command_invalid'));
          return;
        }
      }
      if (terminationCode === null) child.stdin.end(command.stdin, 'utf8');
      else child.stdin.end();
    });
  }

  return Object.freeze({
    run(operation, repositoryPath, request, execution = { timeout_ms: DEFAULT_TIMEOUT_MS }) {
      return run(operation, repositoryPath, request, execution);
    },
  });
}

module.exports = Object.freeze({
  BUILDER_GIT_OBJECT_FORMAT,
  BUILDER_GIT_RUNNER_VERSION,
  DEFAULT_TIMEOUT_MS,
  MAX_GIT_INPUT_BYTES,
  MAX_GIT_OUTPUT_BYTES,
  ZERO_OID,
  BuilderGitCommandRunnerError,
  createBuilderGitCommandRunner,
  createDefaultBuilderGitCommandRunner(options) {
    assertExactObject(options, ['runtime_root']);
    return createBuilderGitCommandRunner({
      runtime_root: valueAt(options, 'runtime_root'),
      spawn_process: nodeSpawn,
    });
  },
});
