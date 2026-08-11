'use strict';

const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { types: utilTypes } = require('node:util');

const {
  BuilderProjectSourceTreeError,
  sanitizeBuilderProjectSourceTree,
} = require('./builder-project-source-tree.cjs');

const BUILDER_WORKTREE_TRANSACTION_VERSION = 'builder-worktree-transaction.v1';
const INPUT_KEYS = Object.freeze(['project_root', 'base_source_tree', 'resulting_source_tree']);
const EMPTY_OPTION_KEYS = Object.freeze([]);
const TEST_OPTION_KEYS = Object.freeze(['before_operation']);
const PROTECTED_SOURCE_NAMES = new Set(['.git', '.gitmodules', '.gitattributes', '.clawfabric']);
const ERROR_MESSAGES = Object.freeze({
  builder_worktree_transaction_invalid: 'The worktree transaction request is invalid.',
  builder_worktree_transaction_conflict: 'The project files changed before they could be updated.',
  builder_worktree_transaction_unavailable: 'The project files could not be updated safely.',
});

class BuilderWorktreeTransactionError extends Error {
  constructor(code = 'builder_worktree_transaction_unavailable') {
    const selected = Object.hasOwn(ERROR_MESSAGES, code)
      ? code
      : 'builder_worktree_transaction_unavailable';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderWorktreeTransactionError';
    this.code = selected;
    this.retryable = selected !== 'builder_worktree_transaction_invalid';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) {
  throw new BuilderWorktreeTransactionError(code);
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
  if (!isPlainObject(value)) fail('builder_worktree_transaction_invalid');
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== expectedKeys.length
    || keys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))
  ) fail('builder_worktree_transaction_invalid');
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      fail('builder_worktree_transaction_invalid');
    }
  }
}

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
    fail('builder_worktree_transaction_invalid');
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
  ) fail('builder_worktree_transaction_invalid');
  return value;
}

function foldedName(value) {
  return value.normalize('NFKC').toLowerCase();
}

function safeRelativePath(value) {
  const segments = typeof value === 'string' ? value.split('/') : [];
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.startsWith('/')
    || value.includes('\\')
    || segments.some((segment) => segment === '' || segment === '.' || segment === '..')
    || segments.some((segment) => PROTECTED_SOURCE_NAMES.has(foldedName(segment)))
  ) fail('builder_worktree_transaction_invalid');
  return value;
}

function assertInside(root, target) {
  const relative = path.relative(root, target);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    fail('builder_worktree_transaction_invalid');
  }
}

function assertSafeDirectory(target) {
  if (!fs.existsSync(target)) fail('builder_worktree_transaction_unavailable');
  const stat = fs.lstatSync(target);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    fail('builder_worktree_transaction_unavailable');
  }
}

function targetPath(projectRoot, relativePath) {
  const target = path.join(projectRoot, ...safeRelativePath(relativePath).split('/'));
  assertInside(projectRoot, target);
  return target;
}

function assertSafeParentChain(projectRoot, relativePath) {
  let current = projectRoot;
  for (const segment of relativePath.split('/').slice(0, -1)) {
    current = path.join(current, segment);
    assertInside(projectRoot, current);
    if (!fs.existsSync(current)) continue;
    const stat = fs.lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      fail('builder_worktree_transaction_conflict');
    }
  }
}

function ensureParentDirectories(root, target, createdDirectories = null) {
  const relative = path.relative(root, path.dirname(target));
  if (relative === '') return;
  let current = root;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    assertInside(root, current);
    if (fs.existsSync(current)) {
      const stat = fs.lstatSync(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        fail('builder_worktree_transaction_conflict');
      }
      continue;
    }
    fs.mkdirSync(current, { mode: 0o700 });
    if (createdDirectories !== null) createdDirectories.push(current);
  }
}

function assertCurrentFile(target, expectedContent) {
  if (!fs.existsSync(target)) fail('builder_worktree_transaction_conflict');
  const stat = fs.lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    fail('builder_worktree_transaction_conflict');
  }
  if (fs.readFileSync(target, 'utf8') !== expectedContent) {
    fail('builder_worktree_transaction_conflict');
  }
}

function normalizeError(error) {
  if (error instanceof BuilderWorktreeTransactionError) return error;
  if (error instanceof BuilderProjectSourceTreeError) {
    return new BuilderWorktreeTransactionError('builder_worktree_transaction_invalid');
  }
  return new BuilderWorktreeTransactionError('builder_worktree_transaction_unavailable');
}

function sanitizeOptions(rawOptions) {
  const value = rawOptions === undefined ? {} : rawOptions;
  if (!isPlainObject(value)) fail('builder_worktree_transaction_invalid');
  const keys = Reflect.ownKeys(value);
  const expectedKeys = keys.includes('before_operation') ? TEST_OPTION_KEYS : EMPTY_OPTION_KEYS;
  assertExactObject(value, expectedKeys);
  if (!keys.includes('before_operation')) return Object.freeze({ beforeOperation: null });
  const beforeOperation = valueAt(value, 'before_operation');
  if (typeof beforeOperation !== 'function' || utilTypes.isProxy(beforeOperation)) {
    fail('builder_worktree_transaction_invalid');
  }
  return Object.freeze({ beforeOperation });
}

function sanitizeInput(rawInput) {
  assertExactObject(rawInput, INPUT_KEYS);
  const projectRoot = safeAbsolutePath(valueAt(rawInput, 'project_root'));
  const baseSourceTree = sanitizeBuilderProjectSourceTree(valueAt(rawInput, 'base_source_tree'));
  const resultingSourceTree = sanitizeBuilderProjectSourceTree(valueAt(rawInput, 'resulting_source_tree'));
  for (const entry of [...baseSourceTree.files, ...resultingSourceTree.files]) {
    safeRelativePath(entry.path);
  }
  return Object.freeze({ projectRoot, baseSourceTree, resultingSourceTree });
}

function changedOperations(baseSourceTree, resultingSourceTree) {
  const base = new Map(baseSourceTree.files.map((entry) => [entry.path, entry.content]));
  const resulting = new Map(resultingSourceTree.files.map((entry) => [entry.path, entry.content]));
  const deletes = [];
  const upserts = [];
  for (const [relativePath, content] of base) {
    if (!resulting.has(relativePath)) {
      deletes.push({ kind: 'delete', path: relativePath, base_content: content, next_content: null });
    }
  }
  for (const [relativePath, content] of resulting) {
    if (!base.has(relativePath) || base.get(relativePath) !== content) {
      upserts.push({
        kind: 'upsert',
        path: relativePath,
        base_content: base.has(relativePath) ? base.get(relativePath) : null,
        next_content: content,
      });
    }
  }
  deletes.sort((left, right) => right.path.length - left.path.length || left.path.localeCompare(right.path));
  upserts.sort((left, right) => left.path.length - right.path.length || left.path.localeCompare(right.path));
  return [...deletes, ...upserts];
}

function createBuilderWorktreeTransactionManager(rawOptions) {
  const options = sanitizeOptions(rawOptions);

  function begin(rawInput) {
    let input;
    try {
      input = sanitizeInput(rawInput);
      assertSafeDirectory(input.projectRoot);
      assertSafeDirectory(path.join(input.projectRoot, '.git'));
    } catch (error) {
      throw normalizeError(error);
    }

    const operations = changedOperations(input.baseSourceTree, input.resultingSourceTree);
    const transactionRoot = path.join(
      input.projectRoot,
      '.git',
      'clawfabric',
      'worktree-transactions',
      randomUUID(),
    );
    const nextRoot = path.join(transactionRoot, 'next');
    const backupRoot = path.join(transactionRoot, 'backup');
    const applied = [];
    const createdDirectories = [];
    let state = 'preparing';

    function notify(phase, relativePath) {
      if (options.beforeOperation === null) return;
      Reflect.apply(options.beforeOperation, undefined, [Object.freeze({ phase, path: relativePath })]);
    }

    function cleanupTransactionRoot() {
      try {
        fs.rmSync(transactionRoot, { recursive: true, force: true });
      } catch {
        // A committed projection remains valid even if private transaction cleanup is deferred.
      }
    }

    function rollbackApplied() {
      for (const operation of [...applied].reverse()) {
        const target = targetPath(input.projectRoot, operation.path);
        if (operation.installed && fs.existsSync(target)) {
          const stat = fs.lstatSync(target);
          if (!stat.isFile() || stat.isSymbolicLink()) {
            fail('builder_worktree_transaction_unavailable');
          }
          fs.rmSync(target, { force: false });
        }
        if (operation.backup_moved) {
          const backup = path.join(backupRoot, ...operation.path.split('/'));
          ensureParentDirectories(input.projectRoot, target);
          fs.renameSync(backup, target);
        }
      }
      for (const directory of [...createdDirectories].reverse()) {
        if (!fs.existsSync(directory)) continue;
        const stat = fs.lstatSync(directory);
        if (stat.isDirectory() && !stat.isSymbolicLink() && fs.readdirSync(directory).length === 0) {
          fs.rmdirSync(directory);
        }
      }
      cleanupTransactionRoot();
      state = 'rolled_back';
    }

    try {
      for (const operation of operations) {
        const target = targetPath(input.projectRoot, operation.path);
        assertSafeParentChain(input.projectRoot, operation.path);
        if (operation.base_content === null) {
          if (fs.existsSync(target)) fail('builder_worktree_transaction_conflict');
        } else {
          assertCurrentFile(target, operation.base_content);
        }
      }
      fs.mkdirSync(nextRoot, { recursive: true, mode: 0o700 });
      fs.mkdirSync(backupRoot, { recursive: true, mode: 0o700 });
      for (const operation of operations) {
        if (operation.next_content === null) continue;
        const staged = path.join(nextRoot, ...operation.path.split('/'));
        ensureParentDirectories(nextRoot, staged);
        fs.writeFileSync(staged, operation.next_content, { encoding: 'utf8', mode: 0o600 });
      }
      state = 'prepared';
    } catch (error) {
      cleanupTransactionRoot();
      throw normalizeError(error);
    }

    function apply() {
      if (state !== 'prepared') fail('builder_worktree_transaction_invalid');
      state = 'applying';
      try {
        for (const operation of operations) {
          const target = targetPath(input.projectRoot, operation.path);
          const backup = path.join(backupRoot, ...operation.path.split('/'));
          const staged = path.join(nextRoot, ...operation.path.split('/'));
          const record = {
            path: operation.path,
            backup_moved: false,
            installed: false,
          };
          applied.push(record);
          notify('before_backup', operation.path);
          if (operation.base_content !== null) {
            ensureParentDirectories(backupRoot, backup);
            fs.renameSync(target, backup);
            record.backup_moved = true;
          }
          if (operation.next_content !== null) {
            ensureParentDirectories(input.projectRoot, target, createdDirectories);
            notify('before_install', operation.path);
            fs.renameSync(staged, target);
            record.installed = true;
          }
        }
        state = 'applied';
        return Object.freeze({
          transaction_version: BUILDER_WORKTREE_TRANSACTION_VERSION,
          state: 'applied',
          operation_count: operations.length,
        });
      } catch (error) {
        try {
          rollbackApplied();
        } catch {
          throw new BuilderWorktreeTransactionError('builder_worktree_transaction_unavailable');
        }
        throw normalizeError(error);
      }
    }

    function rollback() {
      if (state === 'rolled_back') return;
      if (state === 'committed') fail('builder_worktree_transaction_invalid');
      if (state === 'prepared') {
        cleanupTransactionRoot();
        state = 'rolled_back';
        return;
      }
      if (state !== 'applied' && state !== 'applying') {
        fail('builder_worktree_transaction_invalid');
      }
      try {
        rollbackApplied();
      } catch {
        throw new BuilderWorktreeTransactionError('builder_worktree_transaction_unavailable');
      }
    }

    function commit() {
      if (state !== 'applied') fail('builder_worktree_transaction_invalid');
      state = 'committed';
      cleanupTransactionRoot();
    }

    return Object.freeze({
      transaction_version: BUILDER_WORKTREE_TRANSACTION_VERSION,
      apply,
      rollback,
      commit,
    });
  }

  return Object.freeze({
    authority_version: BUILDER_WORKTREE_TRANSACTION_VERSION,
    begin,
  });
}

module.exports = Object.freeze({
  BUILDER_WORKTREE_TRANSACTION_VERSION,
  BuilderWorktreeTransactionError,
  createBuilderWorktreeTransactionManager,
});
