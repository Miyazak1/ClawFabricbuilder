'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { types: utilTypes } = require('node:util');

const {
  BUILDER_GIT_OBJECT_FORMAT,
  DEFAULT_TIMEOUT_MS,
  BuilderGitCommandRunnerError,
  createDefaultBuilderGitCommandRunner,
} = require('./builder-git-command-runner.cjs');
const {
  BuilderGitReceiptContractError,
  sanitizeBuilderGitCandidateReceipt,
  sanitizeBuilderGitCandidateReceiptPair,
} = require('./builder-git-receipt-contract.cjs');
const {
  BuilderProjectSourceTreeError,
  sanitizeBuilderProjectSourceTree,
} = require('./builder-project-source-tree.cjs');
const {
  BuilderLocalWorkspaceSourceTreeError,
  inspectBuilderLocalWorkspaceSourceTree,
} = require('./builder-local-workspace-source-tree.cjs');
const {
  BuilderWorktreeTransactionError,
  createBuilderWorktreeTransactionManager,
} = require('./builder-worktree-transaction.cjs');

const BUILDER_GIT_CURRENT_PROJECTION_VERSION = 'builder-git-current-projection.v1';
const BUILDER_GIT_CURRENT_PROJECTION_RESULT_VERSION =
  'builder-git-current-projection-result.v1';
const BUILDER_GIT_VERIFIED_CANDIDATE_READ_RESULT_VERSION =
  'builder-git-verified-candidate-read-result.v1';
const OPTION_KEYS = Object.freeze(['projects_root', 'git_runner', 'read_verified_candidate']);
const OPTION_KEYS_WITH_RESOLVER = Object.freeze([
  'projects_root',
  'git_runner',
  'read_verified_candidate',
  'resolve_project_root',
]);
const DEFAULT_OPTION_KEYS = Object.freeze(['projects_root', 'runtime_root', 'git_repository']);
const DEFAULT_OPTION_KEYS_WITH_RESOLVER = Object.freeze([
  'projects_root',
  'runtime_root',
  'git_repository',
  'resolve_project_root',
]);
const PROJECT_REQUEST_KEYS = Object.freeze([
  'candidate_receipt',
  'expected_workspace_source_tree_digest',
  'projection_mode',
]);
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const UUID_PATTERN = new RegExp(`^${UUID_SOURCE}$`, 'u');
const PROJECT_ID_PATTERN = new RegExp(`^builder-project:(${UUID_SOURCE})$`, 'u');
const OID_PATTERN = /^[0-9a-f]{40}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const PROTECTED_SOURCE_NAMES = new Set(['.git', '.gitmodules', '.gitattributes', '.clawfabric']);
const ERROR_MESSAGES = Object.freeze({
  builder_git_current_projection_invalid: 'The current project version could not be verified.',
  builder_git_current_projection_conflict:
    'The current project version changed before it could be projected.',
  builder_git_current_projection_unavailable: 'The current project version could not be projected.',
});

class BuilderGitCurrentProjectionError extends Error {
  constructor(code = 'builder_git_current_projection_unavailable') {
    const selected = Object.hasOwn(ERROR_MESSAGES, code)
      ? code
      : 'builder_git_current_projection_unavailable';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderGitCurrentProjectionError';
    this.code = selected;
    this.retryable = selected !== 'builder_git_current_projection_invalid';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) {
  throw new BuilderGitCurrentProjectionError(code);
}

function isPlainObject(value) {
  if (
    value === null
    || typeof value !== 'object'
    || Array.isArray(value)
    || utilTypes.isProxy(value)
  ) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertExactObject(value, expectedKeys) {
  if (!isPlainObject(value)) fail('builder_git_current_projection_invalid');
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== expectedKeys.length
    || keys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))
  ) fail('builder_git_current_projection_invalid');
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      fail('builder_git_current_projection_invalid');
    }
  }
}

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
    fail('builder_git_current_projection_invalid');
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
  ) fail('builder_git_current_projection_invalid');
  return value;
}

function optionKeys(value, withoutResolver, withResolver) {
  if (!isPlainObject(value)) fail('builder_git_current_projection_invalid');
  const keys = Reflect.ownKeys(value);
  const selected = keys.includes('resolve_project_root') ? withResolver : withoutResolver;
  assertExactObject(value, selected);
  return selected;
}

function safeProjectRootResolver(value) {
  if (value === undefined) return null;
  if (typeof value !== 'function' || utilTypes.isProxy(value)) fail('builder_git_current_projection_invalid');
  return value;
}

function projectUuid(projectId) {
  if (typeof projectId !== 'string') fail('builder_git_current_projection_invalid');
  const match = PROJECT_ID_PATTERN.exec(projectId);
  if (!match || !UUID_PATTERN.test(match[1])) fail('builder_git_current_projection_invalid');
  return match[1];
}

function safeDigest(value) {
  if (typeof value !== 'string' || !DIGEST_PATTERN.test(value)) {
    fail('builder_git_current_projection_invalid');
  }
  return value;
}

function projectDirectory(projectsRoot, projectId, resolveProjectRoot) {
  if (resolveProjectRoot === null) return path.join(projectsRoot, projectUuid(projectId));
  return safeAbsolutePath(Reflect.apply(resolveProjectRoot, undefined, [projectId]));
}

function assertSafeDirectory(value, allowMissing) {
  if (!fs.existsSync(value)) {
    if (allowMissing) return;
    fail('builder_git_current_projection_unavailable');
  }
  const stat = fs.lstatSync(value);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    fail('builder_git_current_projection_unavailable');
  }
}

function assertProjectRoot(projectsRoot, projectRoot, resolverBacked) {
  assertSafeDirectory(projectsRoot, false);
  assertSafeDirectory(projectRoot, false);
  assertSafeDirectory(path.join(projectRoot, '.git'), false);
  assertSafeProtectedRootEntries(projectRoot);
  if (resolverBacked) return;
  const relative = path.relative(projectsRoot, projectRoot);
  if (
    relative.startsWith('..')
    || path.isAbsolute(relative)
    || relative.includes(path.sep)
  ) fail('builder_git_current_projection_invalid');
}

function foldedName(value) {
  return value.normalize('NFKC').toLowerCase();
}

function assertSafeProtectedRootEntries(projectRoot) {
  let gitEntryCount = 0;
  let localConfigEntryCount = 0;
  for (const entry of fs.readdirSync(projectRoot, { withFileTypes: true })) {
    const folded = foldedName(entry.name);
    if (folded !== '.git' && folded !== '.clawfabric') continue;
    const target = path.join(projectRoot, entry.name);
    assertInsideProject(projectRoot, target);
    const stat = fs.lstatSync(target);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      fail('builder_git_current_projection_unavailable');
    }
    if (folded === '.git') {
      gitEntryCount += 1;
      if (entry.name !== '.git') fail('builder_git_current_projection_unavailable');
    } else {
      localConfigEntryCount += 1;
      if (entry.name !== '.clawfabric') fail('builder_git_current_projection_unavailable');
    }
  }
  if (gitEntryCount !== 1 || localConfigEntryCount > 1) {
    fail('builder_git_current_projection_unavailable');
  }
}

function hasProtectedSourcePath(value) {
  const foldedSegments = value.split('/').map((segment) => foldedName(segment));
  return foldedSegments.some((segment) => PROTECTED_SOURCE_NAMES.has(segment));
}

function safeRelativeProjectPath(value) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.startsWith('/')
    || value.includes('\\')
    || value.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
    || hasProtectedSourcePath(value)
  ) fail('builder_git_current_projection_invalid');
  return value;
}

function assertInsideProject(projectRoot, target) {
  const relative = path.relative(projectRoot, target);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    fail('builder_git_current_projection_invalid');
  }
}

function assertNoPathCollisions(sourceTree) {
  const filePaths = new Set(sourceTree.files.map((entry) => entry.path));
  for (const entry of sourceTree.files) {
    const segments = entry.path.split('/');
    let prefix = '';
    for (let index = 0; index < segments.length - 1; index += 1) {
      prefix = prefix === '' ? segments[index] : `${prefix}/${segments[index]}`;
      if (filePaths.has(prefix)) fail('builder_git_current_projection_invalid');
    }
  }
}

function sanitizeVerifiedCandidateRead(value, expectedReceipt) {
  assertExactObject(value, [
    'result_version',
    'candidate_receipt',
    'verification_receipt',
    'source_tree',
    'code_authority',
    'read_admission',
  ]);
  const pair = sanitizeBuilderGitCandidateReceiptPair(
    valueAt(value, 'candidate_receipt'),
    valueAt(value, 'verification_receipt'),
  );
  const sourceTree = sanitizeBuilderProjectSourceTree(valueAt(value, 'source_tree'));
  if (
    valueAt(value, 'result_version') !== BUILDER_GIT_VERIFIED_CANDIDATE_READ_RESULT_VERSION
    || valueAt(value, 'code_authority') !== 'git_commit_tree'
    || valueAt(value, 'read_admission') !== 'verified'
    || pair.candidate_receipt.project_id !== expectedReceipt.project_id
    || pair.candidate_receipt.request_id !== expectedReceipt.request_id
    || pair.candidate_receipt.candidate_id !== expectedReceipt.candidate_id
    || pair.candidate_receipt.candidate_digest !== expectedReceipt.candidate_digest
    || pair.candidate_receipt.resulting_tree_digest !== expectedReceipt.resulting_tree_digest
    || pair.candidate_receipt.commit_oid !== expectedReceipt.commit_oid
    || pair.candidate_receipt.tree_oid !== expectedReceipt.tree_oid
    || pair.candidate_receipt.expected_base_oid !== expectedReceipt.expected_base_oid
    || sourceTree.source_tree_digest !== expectedReceipt.resulting_tree_digest
  ) fail('builder_git_current_projection_invalid');
  for (const entry of sourceTree.files) safeRelativeProjectPath(entry.path);
  assertNoPathCollisions(sourceTree);
  return freezeDeep({
    candidate_receipt: pair.candidate_receipt,
    verification_receipt: pair.verification_receipt,
    source_tree: sourceTree,
  });
}

function parseOidResult(result) {
  const oid = result.stdout.trim();
  if (!OID_PATTERN.test(oid)) fail('builder_git_current_projection_unavailable');
  return oid;
}

async function readMainRef(runner, projectRoot) {
  const result = await runner.run(
    'read_main_ref',
    projectRoot,
    { object_format: BUILDER_GIT_OBJECT_FORMAT },
    { timeout_ms: DEFAULT_TIMEOUT_MS },
  );
  return result.found ? parseOidResult(result) : null;
}

async function updateMainRef(runner, projectRoot, receipt, expectedOldOid) {
  try {
    await runner.run(
      'update_main_ref',
      projectRoot,
      {
        object_format: BUILDER_GIT_OBJECT_FORMAT,
        commit_oid: receipt.commit_oid,
        expected_old_oid: expectedOldOid,
      },
      { timeout_ms: DEFAULT_TIMEOUT_MS },
    );
  } catch (error) {
    const runnerCode = ownCode(error, BuilderGitCommandRunnerError);
    if (runnerCode === 'builder_git_command_invalid') {
      fail('builder_git_current_projection_invalid');
    }
    if (runnerCode === 'builder_git_command_failed') {
      let observedMainOid;
      try {
        observedMainOid = await readMainRef(runner, projectRoot);
      } catch {
        fail('builder_git_current_projection_unavailable');
      }
      if (observedMainOid === receipt.commit_oid) return;
      if (observedMainOid !== expectedOldOid) {
        fail('builder_git_current_projection_conflict');
      }
    }
    fail('builder_git_current_projection_unavailable');
  }
}

function ownCode(error, ErrorClass = null) {
  if (!error || typeof error !== 'object' || utilTypes.isProxy(error)) return null;
  try {
    if (ErrorClass !== null && Object.getPrototypeOf(error) !== ErrorClass.prototype) return null;
    const descriptor = Object.getOwnPropertyDescriptor(error, 'code');
    return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : null;
  } catch {
    return null;
  }
}

function normalizeError(error) {
  const ownProjectionCode = ownCode(error, BuilderGitCurrentProjectionError);
  if (ownProjectionCode && Object.hasOwn(ERROR_MESSAGES, ownProjectionCode)) {
    return new BuilderGitCurrentProjectionError(ownProjectionCode);
  }
  if (
    ownCode(error, BuilderGitReceiptContractError)
    || ownCode(error, BuilderProjectSourceTreeError)
    || ownCode(error, BuilderGitCommandRunnerError) === 'builder_git_command_invalid'
  ) return new BuilderGitCurrentProjectionError('builder_git_current_projection_invalid');
  if (ownCode(error, BuilderLocalWorkspaceSourceTreeError)) {
    return new BuilderGitCurrentProjectionError('builder_git_current_projection_conflict');
  }
  const worktreeCode = ownCode(error, BuilderWorktreeTransactionError);
  if (worktreeCode === 'builder_worktree_transaction_invalid') {
    return new BuilderGitCurrentProjectionError('builder_git_current_projection_invalid');
  }
  if (worktreeCode === 'builder_worktree_transaction_conflict') {
    return new BuilderGitCurrentProjectionError('builder_git_current_projection_conflict');
  }
  return new BuilderGitCurrentProjectionError('builder_git_current_projection_unavailable');
}

function sanitizeOptions(value) {
  const keys = optionKeys(value, OPTION_KEYS, OPTION_KEYS_WITH_RESOLVER);
  const projectsRoot = safeAbsolutePath(valueAt(value, 'projects_root'));
  const gitRunner = valueAt(value, 'git_runner');
  const readVerifiedCandidate = valueAt(value, 'read_verified_candidate');
  if (
    !gitRunner
    || typeof gitRunner !== 'object'
    || utilTypes.isProxy(gitRunner)
    || typeof gitRunner.run !== 'function'
    || typeof readVerifiedCandidate !== 'function'
    || utilTypes.isProxy(readVerifiedCandidate)
  ) fail('builder_git_current_projection_invalid');
  const resolveProjectRoot = keys.includes('resolve_project_root')
    ? safeProjectRootResolver(valueAt(value, 'resolve_project_root'))
    : null;
  return Object.freeze({ projectsRoot, gitRunner, readVerifiedCandidate, resolveProjectRoot });
}

function sanitizeDefaultOptions(value) {
  const keys = optionKeys(value, DEFAULT_OPTION_KEYS, DEFAULT_OPTION_KEYS_WITH_RESOLVER);
  const projectsRoot = safeAbsolutePath(valueAt(value, 'projects_root'));
  const runtimeRoot = safeAbsolutePath(valueAt(value, 'runtime_root'));
  const gitRepository = valueAt(value, 'git_repository');
  if (!gitRepository || typeof gitRepository !== 'object' || utilTypes.isProxy(gitRepository)) {
    fail('builder_git_current_projection_invalid');
  }
  const descriptor = Object.getOwnPropertyDescriptor(gitRepository, 'read_verified_candidate');
  if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') {
    fail('builder_git_current_projection_invalid');
  }
  return Object.freeze({
    projectsRoot,
    runtimeRoot,
    gitRepository,
    readVerifiedCandidate: descriptor.value,
    resolveProjectRoot: keys.includes('resolve_project_root')
      ? safeProjectRootResolver(valueAt(value, 'resolve_project_root'))
      : null,
  });
}

function sanitizeProjectRequest(value) {
  assertExactObject(value, PROJECT_REQUEST_KEYS);
  const projectionMode = valueAt(value, 'projection_mode');
  if (!['base_cas', 'sqlite_current_repair'].includes(projectionMode)) {
    fail('builder_git_current_projection_invalid');
  }
  return freezeDeep({
    candidate_receipt: sanitizeBuilderGitCandidateReceipt(valueAt(value, 'candidate_receipt')),
    expected_workspace_source_tree_digest:
      safeDigest(valueAt(value, 'expected_workspace_source_tree_digest')),
    projection_mode: projectionMode,
  });
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

function createBuilderGitCurrentProjection(rawOptions) {
  const options = sanitizeOptions(rawOptions);
  const runExclusive = createProjectQueue();
  const worktreeTransactions = createBuilderWorktreeTransactionManager();

  async function projectTransaction(projectRoot, baseSourceTree, sourceTree, updateMain) {
    const transaction = worktreeTransactions.begin({
      project_root: projectRoot,
      base_source_tree: baseSourceTree,
      resulting_source_tree: sourceTree,
    });
    try {
      transaction.apply();
      await updateMain();
      transaction.commit();
    } catch (error) {
      try {
        transaction.rollback();
      } catch {
        fail('builder_git_current_projection_unavailable');
      }
      throw error;
    }
  }

  async function projectCurrent(rawRequest) {
    let receipt;
    let projectionMode;
    let expectedWorkspaceSourceTreeDigest;
    try {
      const request = sanitizeProjectRequest(rawRequest);
      receipt = request.candidate_receipt;
      projectionMode = request.projection_mode;
      expectedWorkspaceSourceTreeDigest = request.expected_workspace_source_tree_digest;
    } catch (error) {
      return Promise.reject(normalizeError(error));
    }
    return runExclusive(receipt.project_id, async () => {
      try {
        const projectRoot = projectDirectory(
          options.projectsRoot,
          receipt.project_id,
          options.resolveProjectRoot,
        );
        const verified = sanitizeVerifiedCandidateRead(
          await Reflect.apply(options.readVerifiedCandidate, undefined, [receipt]),
          receipt,
        );
        assertProjectRoot(options.projectsRoot, projectRoot, options.resolveProjectRoot !== null);
        const previousMainOid = await readMainRef(options.gitRunner, projectRoot);
        const workspace = inspectBuilderLocalWorkspaceSourceTree(projectRoot);
        const expectedWorkspaceDigest = previousMainOid === receipt.commit_oid
          ? receipt.resulting_tree_digest
          : expectedWorkspaceSourceTreeDigest;
        if (
          workspace.scan_status !== 'complete'
          || workspace.source_tree.source_tree_digest !== expectedWorkspaceDigest
        ) fail('builder_git_current_projection_conflict');
        if (previousMainOid === receipt.commit_oid) {
          await projectTransaction(
            projectRoot,
            workspace.source_tree,
            verified.source_tree,
            async () => undefined,
          );
          return freezeDeep({
            result_version: BUILDER_GIT_CURRENT_PROJECTION_RESULT_VERSION,
            project_id: receipt.project_id,
            commit_oid: receipt.commit_oid,
            tree_oid: receipt.tree_oid,
            expected_base_oid: receipt.expected_base_oid,
            previous_main_oid: previousMainOid,
            main_ref: 'already_current',
            worktree: 'materialized',
            worktree_file_count: verified.source_tree.files.length,
            projection_authority: 'git_main_ref_and_materialized_worktree',
            source_admission: 'git_verified_candidate',
          });
        }
        if (previousMainOid !== receipt.expected_base_oid) {
          if (projectionMode !== 'sqlite_current_repair') {
            fail('builder_git_current_projection_conflict');
          }
          await projectTransaction(
            projectRoot,
            workspace.source_tree,
            verified.source_tree,
            () => updateMainRef(options.gitRunner, projectRoot, receipt, previousMainOid),
          );
          return freezeDeep({
            result_version: BUILDER_GIT_CURRENT_PROJECTION_RESULT_VERSION,
            project_id: receipt.project_id,
            commit_oid: receipt.commit_oid,
            tree_oid: receipt.tree_oid,
            expected_base_oid: receipt.expected_base_oid,
            previous_main_oid: previousMainOid,
            main_ref: 'repaired',
            worktree: 'materialized',
            worktree_file_count: verified.source_tree.files.length,
            projection_authority: 'git_main_ref_and_materialized_worktree',
            source_admission: 'git_verified_candidate',
          });
        }
        await projectTransaction(
          projectRoot,
          workspace.source_tree,
          verified.source_tree,
          () => updateMainRef(options.gitRunner, projectRoot, receipt, previousMainOid),
        );
        return freezeDeep({
          result_version: BUILDER_GIT_CURRENT_PROJECTION_RESULT_VERSION,
          project_id: receipt.project_id,
          commit_oid: receipt.commit_oid,
          tree_oid: receipt.tree_oid,
          expected_base_oid: receipt.expected_base_oid,
          previous_main_oid: previousMainOid,
          main_ref: 'updated',
          worktree: 'materialized',
          worktree_file_count: verified.source_tree.files.length,
          projection_authority: 'git_main_ref_and_materialized_worktree',
          source_admission: 'git_verified_candidate',
        });
      } catch (error) {
        return Promise.reject(normalizeError(error));
      }
    });
  }

  return freezeDeep({
    authority_version: BUILDER_GIT_CURRENT_PROJECTION_VERSION,
    project_current: projectCurrent,
  });
}

function createDefaultBuilderGitCurrentProjection(rawOptions) {
  const options = sanitizeDefaultOptions(rawOptions);
  const projectionOptions = {
    projects_root: options.projectsRoot,
    git_runner: createDefaultBuilderGitCommandRunner({ runtime_root: options.runtimeRoot }),
    read_verified_candidate: (receipt) => Reflect.apply(
      options.readVerifiedCandidate,
      options.gitRepository,
      [receipt],
    ),
  };
  if (options.resolveProjectRoot !== null) {
    projectionOptions.resolve_project_root = options.resolveProjectRoot;
  }
  return createBuilderGitCurrentProjection(projectionOptions);
}

module.exports = Object.freeze({
  BUILDER_GIT_CURRENT_PROJECTION_VERSION,
  BUILDER_GIT_CURRENT_PROJECTION_RESULT_VERSION,
  BuilderGitCurrentProjectionError,
  createBuilderGitCurrentProjection,
  createDefaultBuilderGitCurrentProjection,
});
