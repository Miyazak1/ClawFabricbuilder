'use strict';

const { createHash, randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { types: utilTypes } = require('node:util');

const {
  BuilderProjectSourceTreeError,
  sanitizeBuilderProjectSourceTree,
} = require('./builder-project-source-tree.cjs');

const BUILDER_WORKTREE_TRANSACTION_VERSION = 'builder-worktree-transaction.v1';
const BUILDER_WORKTREE_TRANSACTION_JOURNAL_VERSION = 'builder-worktree-transaction-journal.v1';
const INPUT_KEYS = Object.freeze([
  'project_root',
  'base_source_tree',
  'resulting_source_tree',
  'expected_main_oid',
  'resulting_main_oid',
  'main_ref_mode',
]);
const RECOVERY_INPUT_KEYS = Object.freeze([
  'project_root',
  'current_main_oid',
  'selected_main_oid',
]);
const JOURNAL_KEYS = Object.freeze([
  'journal_version',
  'transaction_id',
  'expected_main_oid',
  'resulting_main_oid',
  'main_ref_mode',
  'operations',
]);
const JOURNAL_OPERATION_KEYS = Object.freeze(['kind', 'path', 'base_digest', 'next_digest']);
const EMPTY_OPTION_KEYS = Object.freeze([]);
const TEST_OPTION_KEYS = Object.freeze(['before_operation']);
const PROTECTED_SOURCE_NAMES = new Set(['.git', '.gitmodules', '.gitattributes', '.clawfabric']);
const OID_PATTERN = /^[0-9a-f]{40}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MAX_JOURNAL_BYTES = 262_144;
const MAX_SOURCE_FILE_BYTES = 512 * 1_024;
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

function safeOid(value, allowNull) {
  if (value === null && allowNull) return null;
  if (typeof value !== 'string' || !OID_PATTERN.test(value)) {
    fail('builder_worktree_transaction_invalid');
  }
  return value;
}

function contentDigest(value) {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

function safeDigest(value, allowNull) {
  if (value === null && allowNull) return null;
  if (typeof value !== 'string' || !DIGEST_PATTERN.test(value)) {
    fail('builder_worktree_transaction_invalid');
  }
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
  const expectedMainOid = safeOid(valueAt(rawInput, 'expected_main_oid'), true);
  const resultingMainOid = safeOid(valueAt(rawInput, 'resulting_main_oid'), false);
  const mainRefMode = valueAt(rawInput, 'main_ref_mode');
  if (
    !['cas_update', 'already_current'].includes(mainRefMode)
    || (mainRefMode === 'already_current' && expectedMainOid !== resultingMainOid)
    || (mainRefMode === 'cas_update' && expectedMainOid === resultingMainOid)
  ) fail('builder_worktree_transaction_invalid');
  return Object.freeze({
    projectRoot,
    baseSourceTree,
    resultingSourceTree,
    expectedMainOid,
    resultingMainOid,
    mainRefMode,
  });
}

function sanitizeRecoveryInput(rawInput) {
  assertExactObject(rawInput, RECOVERY_INPUT_KEYS);
  return Object.freeze({
    projectRoot: safeAbsolutePath(valueAt(rawInput, 'project_root')),
    currentMainOid: safeOid(valueAt(rawInput, 'current_main_oid'), true),
    selectedMainOid: safeOid(valueAt(rawInput, 'selected_main_oid'), true),
  });
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

function journalOperation(operation) {
  return Object.freeze({
    kind: operation.kind,
    path: operation.path,
    base_digest: operation.base_content === null ? null : contentDigest(operation.base_content),
    next_digest: operation.next_content === null ? null : contentDigest(operation.next_content),
  });
}

function writeJournal(transactionRoot, journal) {
  const journalPath = path.join(transactionRoot, 'journal.json');
  const serialized = `${JSON.stringify(journal)}\n`;
  if (Buffer.byteLength(serialized, 'utf8') > MAX_JOURNAL_BYTES) {
    fail('builder_worktree_transaction_invalid');
  }
  fs.writeFileSync(journalPath, serialized, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
}

function sanitizeJournalOperation(value) {
  assertExactObject(value, JOURNAL_OPERATION_KEYS);
  const kind = valueAt(value, 'kind');
  const relativePath = safeRelativePath(valueAt(value, 'path'));
  const baseDigest = safeDigest(valueAt(value, 'base_digest'), true);
  const nextDigest = safeDigest(valueAt(value, 'next_digest'), true);
  if (
    !['delete', 'upsert'].includes(kind)
    || (kind === 'delete' && (baseDigest === null || nextDigest !== null))
    || (kind === 'upsert' && nextDigest === null)
  ) fail('builder_worktree_transaction_invalid');
  return Object.freeze({
    kind,
    path: relativePath,
    base_digest: baseDigest,
    next_digest: nextDigest,
  });
}

function readJournal(transactionRoot, transactionId) {
  const journalPath = path.join(transactionRoot, 'journal.json');
  if (!fs.existsSync(journalPath)) return null;
  const stat = fs.lstatSync(journalPath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_JOURNAL_BYTES) {
    fail('builder_worktree_transaction_unavailable');
  }
  let value;
  try {
    value = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
  } catch {
    fail('builder_worktree_transaction_unavailable');
  }
  assertExactObject(value, JOURNAL_KEYS);
  const mainRefMode = valueAt(value, 'main_ref_mode');
  const expectedMainOid = safeOid(valueAt(value, 'expected_main_oid'), true);
  const resultingMainOid = safeOid(valueAt(value, 'resulting_main_oid'), false);
  const rawOperations = valueAt(value, 'operations');
  if (
    valueAt(value, 'journal_version') !== BUILDER_WORKTREE_TRANSACTION_JOURNAL_VERSION
    || valueAt(value, 'transaction_id') !== transactionId
    || !['cas_update', 'already_current'].includes(mainRefMode)
    || (mainRefMode === 'already_current' && expectedMainOid !== resultingMainOid)
    || (mainRefMode === 'cas_update' && expectedMainOid === resultingMainOid)
    || !Array.isArray(rawOperations)
    || utilTypes.isProxy(rawOperations)
    || rawOperations.length > 512
  ) fail('builder_worktree_transaction_unavailable');
  const operations = rawOperations.map(sanitizeJournalOperation);
  if (new Set(operations.map((operation) => operation.path)).size !== operations.length) {
    fail('builder_worktree_transaction_unavailable');
  }
  return Object.freeze({
    expectedMainOid,
    resultingMainOid,
    mainRefMode,
    operations,
  });
}

function fileDigest(target) {
  if (!fs.existsSync(target)) return null;
  const stat = fs.lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_SOURCE_FILE_BYTES) {
    fail('builder_worktree_transaction_unavailable');
  }
  return `sha256:${createHash('sha256').update(fs.readFileSync(target)).digest('hex')}`;
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
    const transactionId = randomUUID();
    const transactionRoot = path.join(
      input.projectRoot,
      '.git',
      'clawfabric',
      'worktree-transactions',
      transactionId,
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
      writeJournal(transactionRoot, Object.freeze({
        journal_version: BUILDER_WORKTREE_TRANSACTION_JOURNAL_VERSION,
        transaction_id: transactionId,
        expected_main_oid: input.expectedMainOid,
        resulting_main_oid: input.resultingMainOid,
        main_ref_mode: input.mainRefMode,
        operations: operations.map(journalOperation),
      }));
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

  function recover(rawInput) {
    let input;
    try {
      input = sanitizeRecoveryInput(rawInput);
      assertSafeDirectory(input.projectRoot);
      assertSafeDirectory(path.join(input.projectRoot, '.git'));
    } catch (error) {
      throw normalizeError(error);
    }
    const transactionsRoot = path.join(
      input.projectRoot,
      '.git',
      'clawfabric',
      'worktree-transactions',
    );
    if (!fs.existsSync(transactionsRoot)) {
      return Object.freeze({
        transaction_version: BUILDER_WORKTREE_TRANSACTION_VERSION,
        operation: 'recovery_checked',
        recovery: 'not_required',
        recovered_transaction_count: 0,
        main_ref_action: 'not_required',
        main_ref_target_oid: null,
      });
    }
    try {
      assertSafeDirectory(transactionsRoot);
      const entries = fs.readdirSync(transactionsRoot, { withFileTypes: true });
      if (entries.length > 16) fail('builder_worktree_transaction_unavailable');
      let rolledBack = 0;
      let completed = 0;
      let mainRefAction = 'not_required';
      let mainRefTargetOid = null;
      for (const entry of entries) {
        if (!UUID_PATTERN.test(entry.name) || !entry.isDirectory() || entry.isSymbolicLink()) {
          fail('builder_worktree_transaction_unavailable');
        }
        const transactionRoot = path.join(transactionsRoot, entry.name);
        assertInside(transactionsRoot, transactionRoot);
        assertSafeDirectory(transactionRoot);
        const journal = readJournal(transactionRoot, entry.name);
        if (journal === null) {
          fs.rmSync(transactionRoot, { recursive: true, force: false });
          continue;
        }
        let targetState;
        let retainForMainAdvance = false;
        if (input.selectedMainOid === journal.resultingMainOid) {
          if (input.currentMainOid === journal.resultingMainOid) {
            targetState = 'resulting';
          } else if (
            journal.mainRefMode === 'cas_update'
            && input.currentMainOid === journal.expectedMainOid
          ) {
            targetState = 'resulting';
            retainForMainAdvance = true;
          } else {
            fail('builder_worktree_transaction_conflict');
          }
        } else if (
          input.selectedMainOid === journal.expectedMainOid
          && input.currentMainOid === journal.expectedMainOid
        ) {
          targetState = 'base';
        } else {
          fail('builder_worktree_transaction_conflict');
        }
        if (journal.mainRefMode === 'already_current' && targetState !== 'resulting') {
          fail('builder_worktree_transaction_conflict');
        }
        if (journal.mainRefMode === 'already_current') {
          targetState = 'resulting';
        }

        const backupRoot = path.join(transactionRoot, 'backup');
        const nextRoot = path.join(transactionRoot, 'next');
        assertSafeDirectory(backupRoot);
        assertSafeDirectory(nextRoot);
        if (targetState === 'base') {
          for (const operation of [...journal.operations].reverse()) {
            const target = targetPath(input.projectRoot, operation.path);
            const backup = path.join(backupRoot, ...operation.path.split('/'));
            const targetDigest = fileDigest(target);
            const backupDigest = fileDigest(backup);
            if (operation.base_digest === null) {
              if (backupDigest !== null) fail('builder_worktree_transaction_unavailable');
              if (targetDigest === operation.next_digest) fs.rmSync(target, { force: false });
              else if (targetDigest !== null) fail('builder_worktree_transaction_conflict');
              continue;
            }
            if (backupDigest !== null) {
              if (backupDigest !== operation.base_digest) {
                fail('builder_worktree_transaction_unavailable');
              }
              if (targetDigest === operation.next_digest) fs.rmSync(target, { force: false });
              else if (targetDigest !== null) fail('builder_worktree_transaction_conflict');
              ensureParentDirectories(input.projectRoot, target);
              fs.renameSync(backup, target);
            } else if (targetDigest !== operation.base_digest) {
              fail('builder_worktree_transaction_conflict');
            }
          }
          rolledBack += 1;
        } else {
          for (const operation of journal.operations) {
            const target = targetPath(input.projectRoot, operation.path);
            const backup = path.join(backupRoot, ...operation.path.split('/'));
            const staged = path.join(nextRoot, ...operation.path.split('/'));
            let targetDigest = fileDigest(target);
            const backupDigest = fileDigest(backup);
            if (operation.next_digest === null) {
              if (targetDigest === operation.base_digest && backupDigest === null) {
                ensureParentDirectories(backupRoot, backup);
                fs.renameSync(target, backup);
                targetDigest = null;
              }
              if (targetDigest !== null) fail('builder_worktree_transaction_conflict');
              continue;
            }
            if (targetDigest === operation.next_digest) continue;
            if (operation.base_digest !== null && targetDigest === operation.base_digest) {
              if (backupDigest !== null) fail('builder_worktree_transaction_conflict');
              ensureParentDirectories(backupRoot, backup);
              fs.renameSync(target, backup);
              targetDigest = null;
            }
            if (targetDigest !== null) fail('builder_worktree_transaction_conflict');
            if (fileDigest(staged) !== operation.next_digest) {
              fail('builder_worktree_transaction_unavailable');
            }
            ensureParentDirectories(input.projectRoot, target);
            fs.renameSync(staged, target);
          }
          completed += 1;
        }
        if (retainForMainAdvance) {
          mainRefAction = 'advance_to_selected';
          mainRefTargetOid = journal.resultingMainOid;
          break;
        }
        fs.rmSync(transactionRoot, { recursive: true, force: false });
      }
      return Object.freeze({
        transaction_version: BUILDER_WORKTREE_TRANSACTION_VERSION,
        operation: 'recovery_checked',
        recovery: completed > 0 ? 'resulting_tree_completed' : rolledBack > 0 ? 'base_tree_restored' : 'not_required',
        recovered_transaction_count: completed + rolledBack,
        main_ref_action: mainRefAction,
        main_ref_target_oid: mainRefTargetOid,
      });
    } catch (error) {
      throw normalizeError(error);
    }
  }

  return Object.freeze({
    authority_version: BUILDER_WORKTREE_TRANSACTION_VERSION,
    begin,
    recover,
  });
}

module.exports = Object.freeze({
  BUILDER_WORKTREE_TRANSACTION_VERSION,
  BUILDER_WORKTREE_TRANSACTION_JOURNAL_VERSION,
  BuilderWorktreeTransactionError,
  createBuilderWorktreeTransactionManager,
});
