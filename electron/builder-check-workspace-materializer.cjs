'use strict';

const fs = require('node:fs');
const nodeCrypto = require('node:crypto');
const path = require('node:path');
const { types: utilTypes } = require('node:util');

const {
  createBuilderProjectSourceTree,
  sanitizeBuilderProjectSourceTree,
} = require('./builder-project-source-tree.cjs');
const {
  sanitizeBuilderCheckRunAdmission,
} = require('./builder-check-run-admission.cjs');

const BUILDER_CHECK_WORKSPACE_MATERIALIZER_VERSION =
  'builder-check-workspace-materializer.v1';
const BUILDER_CHECK_WORKSPACE_ADMISSION_VERSION =
  'builder-check-workspace-admission.v1';
const ADMISSION_KIND = 'builder_check_workspace_admission';
const CREATE_KEYS = Object.freeze(['checks_root']);
const MATERIALIZE_KEYS = Object.freeze([
  'check_run_admission',
  'source_tree',
]);
const ADMISSION_KEYS = Object.freeze([
  'admission_version',
  'admission_kind',
  'check_run_admission_id',
  'check_run_admission_digest',
  'project_id',
  'candidate_id',
  'candidate_digest',
  'resulting_tree_digest',
  'materialized_file_count',
  'authority',
]);
const AUTHORITY_KEYS = Object.freeze([
  'materialization_authority',
  'workspace_path_disclosure',
  'renderer_authority',
  'provider_dispatch',
  'ipc_authority',
  'command_execution',
  'git_authority',
  'sqlite_authority',
  'project_workspace_write',
  'cleanup_authority',
]);
const AUTHORITY = Object.freeze({
  materialization_authority: 'main_only_candidate_check_workspace_v1',
  workspace_path_disclosure: 'trusted_admission_reader_only',
  renderer_authority: 'not_present',
  provider_dispatch: false,
  ipc_authority: 'not_present',
  command_execution: false,
  git_authority: 'not_present',
  sqlite_authority: 'not_present',
  project_workspace_write: false,
  cleanup_authority: 'trusted_admission_only',
});
const PROJECT_ID_PATTERN =
  /^builder-project:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CANDIDATE_ID_PATTERN = /^builder-code-change-candidate:[0-9a-f]{64}$/u;
const CHECK_RUN_ADMISSION_ID_PATTERN = /^builder-check-run-admission:[0-9a-f]{64}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const WORKSPACE_TOKEN_PATTERN = /^[0-9a-f]{32}$/u;
const TRUSTED_ADMISSIONS = new WeakSet();
const ADMISSION_STATE = new WeakMap();
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });

class BuilderCheckWorkspaceMaterializerError extends Error {
  constructor() {
    super('The candidate check workspace could not be prepared.');
    this.name = 'BuilderCheckWorkspaceMaterializerError';
    this.code = 'builder_check_workspace_materializer_invalid';
    this.retryable = false;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderCheckWorkspaceMaterializerError();
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

function exactObject(value, keys) {
  if (!isPlainObject(value)) fail();
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== keys.length
    || actual.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) fail();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      fail();
    }
  }
  return descriptors;
}

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freezeDeep(nested);
    Object.freeze(value);
  }
  return value;
}

function safePattern(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) fail();
  return value;
}

function safeAbsolutePath(value) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > 1_024
    || value.trim() !== value
    || value.includes('\0')
    || !path.isAbsolute(value)
    || path.normalize(value) !== value
  ) fail();
  return value;
}

function samePath(left, right) {
  return path.relative(left, right) === '' && path.relative(right, left) === '';
}

function isContained(rootPath, targetPath) {
  const relative = path.relative(rootPath, targetPath);
  return relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function checkedRealDirectory(targetPath, expectedRoot = null, allowPathAlias = false) {
  let stats;
  let realPath;
  try {
    stats = fs.lstatSync(targetPath);
    realPath = path.resolve(fs.realpathSync.native(targetPath));
  } catch {
    fail();
  }
  const resolved = path.resolve(targetPath);
  if (
    !stats.isDirectory()
    || stats.isSymbolicLink()
    || (!allowPathAlias && !samePath(resolved, realPath))
    || (expectedRoot !== null && !isContained(expectedRoot, realPath))
  ) fail();
  return realPath;
}

function checkedRealFile(targetPath, workspacePath) {
  let stats;
  let realPath;
  try {
    stats = fs.lstatSync(targetPath);
    realPath = path.resolve(fs.realpathSync.native(targetPath));
  } catch {
    fail();
  }
  if (
    !stats.isFile()
    || stats.isSymbolicLink()
    || !samePath(path.resolve(targetPath), realPath)
    || !isContained(workspacePath, realPath)
  ) fail();
  return realPath;
}

function protectedPath(sourcePath) {
  return sourcePath.split('/').some(
    (segment) => segment.normalize('NFKC').toLowerCase() === '.git',
  );
}

function safeWorkspaceToken() {
  let token;
  try {
    token = nodeCrypto.randomBytes(16).toString('hex');
  } catch {
    fail();
  }
  return safePattern(token, WORKSPACE_TOKEN_PATTERN);
}

function expectedDirectories(sourceTree) {
  const directories = new Set();
  for (const file of sourceTree.files) {
    const segments = file.path.split('/');
    for (let index = 1; index < segments.length; index += 1) {
      directories.add(segments.slice(0, index).join('/'));
    }
  }
  return [...directories].sort();
}

function nativeRelativePath(sourcePath) {
  return path.join(...sourcePath.split('/'));
}

function createParentDirectories(workspacePath, sourcePath) {
  const segments = sourcePath.split('/').slice(0, -1);
  let current = workspacePath;
  for (const segment of segments) {
    current = path.join(current, segment);
    if (!isContained(workspacePath, current)) fail();
    try {
      fs.mkdirSync(current, { mode: 0o700 });
    } catch (error) {
      if (!error || error.code !== 'EEXIST') fail();
    }
    checkedRealDirectory(current, workspacePath);
  }
}

function decodedUtf8(buffer) {
  try {
    return UTF8_DECODER.decode(buffer);
  } catch {
    fail();
  }
}

function assertMaterializedContent(file, buffer) {
  if (!Buffer.isBuffer(buffer) || decodedUtf8(buffer) !== file.content) fail();
  const recreated = createBuilderProjectSourceTree({
    files: [{ path: file.path, content: decodedUtf8(buffer) }],
  });
  if (recreated.files[0].content_digest !== file.content_digest) fail();
}

function writeExclusiveFile(workspacePath, file) {
  const targetPath = path.join(workspacePath, nativeRelativePath(file.path));
  if (!isContained(workspacePath, targetPath)) fail();
  createParentDirectories(workspacePath, file.path);
  const bytes = Buffer.from(file.content, 'utf8');
  if (decodedUtf8(bytes) !== file.content) fail();

  let descriptor = null;
  try {
    descriptor = fs.openSync(targetPath, 'wx', 0o600);
    let offset = 0;
    while (offset < bytes.length) {
      const written = fs.writeSync(descriptor, bytes, offset, bytes.length - offset, offset);
      if (!Number.isSafeInteger(written) || written <= 0) fail();
      offset += written;
    }
    fs.fsyncSync(descriptor);
  } catch (error) {
    if (error instanceof BuilderCheckWorkspaceMaterializerError) throw error;
    fail();
  } finally {
    if (descriptor !== null) {
      try {
        fs.closeSync(descriptor);
      } catch {
        fail();
      }
    }
  }

  checkedRealFile(targetPath, workspacePath);
  let persisted;
  try {
    persisted = fs.readFileSync(targetPath);
  } catch {
    fail();
  }
  assertMaterializedContent(file, persisted);
}

function scanWorkspace(workspacePath, sourceTree) {
  checkedRealDirectory(workspacePath);
  const foundDirectories = [];
  const foundFiles = [];

  function visit(currentPath, relativeSegments) {
    let entries;
    try {
      entries = fs.readdirSync(currentPath, { withFileTypes: true });
    } catch {
      fail();
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const sourcePath = [...relativeSegments, entry.name].join('/');
      if (protectedPath(sourcePath)) fail();
      const targetPath = path.join(currentPath, entry.name);
      let stats;
      try {
        stats = fs.lstatSync(targetPath);
      } catch {
        fail();
      }
      if (entry.isSymbolicLink() || stats.isSymbolicLink()) fail();
      if (entry.isDirectory() && stats.isDirectory()) {
        checkedRealDirectory(targetPath, workspacePath);
        foundDirectories.push(sourcePath);
        visit(targetPath, [...relativeSegments, entry.name]);
      } else if (entry.isFile() && stats.isFile()) {
        checkedRealFile(targetPath, workspacePath);
        foundFiles.push(sourcePath);
      } else {
        fail();
      }
    }
  }

  visit(workspacePath, []);
  const expectedDirectoryList = expectedDirectories(sourceTree);
  const expectedFileList = sourceTree.files.map((file) => file.path).sort();
  foundDirectories.sort();
  foundFiles.sort();
  if (
    foundDirectories.length !== expectedDirectoryList.length
    || foundDirectories.some((entry, index) => entry !== expectedDirectoryList[index])
    || foundFiles.length !== expectedFileList.length
    || foundFiles.some((entry, index) => entry !== expectedFileList[index])
  ) fail();

  for (const file of sourceTree.files) {
    let persisted;
    try {
      persisted = fs.readFileSync(path.join(workspacePath, nativeRelativePath(file.path)));
    } catch {
      fail();
    }
    assertMaterializedContent(file, persisted);
  }
}

function collectWorkspaceEntries(workspacePath) {
  checkedRealDirectory(workspacePath);
  const files = [];
  const directories = [];

  function visit(currentPath, relativeSegments) {
    let entries;
    try {
      entries = fs.readdirSync(currentPath, { withFileTypes: true });
    } catch {
      fail();
    }
    for (const entry of entries) {
      const sourcePath = [...relativeSegments, entry.name].join('/');
      if (protectedPath(sourcePath)) fail();
      const targetPath = path.join(currentPath, entry.name);
      let stats;
      try {
        stats = fs.lstatSync(targetPath);
      } catch {
        fail();
      }
      if (entry.isSymbolicLink() || stats.isSymbolicLink()) fail();
      if (entry.isDirectory() && stats.isDirectory()) {
        checkedRealDirectory(targetPath, workspacePath);
        visit(targetPath, [...relativeSegments, entry.name]);
        directories.push(targetPath);
      } else if (entry.isFile() && stats.isFile()) {
        checkedRealFile(targetPath, workspacePath);
        files.push(targetPath);
      } else {
        fail();
      }
    }
  }

  visit(workspacePath, []);
  return { files, directories };
}

function removeWorkspace(workspacePath, checksRootRealPath) {
  if (!isContained(checksRootRealPath, workspacePath)) fail();
  const { files, directories } = collectWorkspaceEntries(workspacePath);
  try {
    for (const filePath of files) {
      checkedRealFile(filePath, workspacePath);
      fs.unlinkSync(filePath);
    }
    for (const directoryPath of directories) {
      checkedRealDirectory(directoryPath, workspacePath);
      fs.rmdirSync(directoryPath);
    }
    checkedRealDirectory(workspacePath, checksRootRealPath);
    fs.rmdirSync(workspacePath);
  } catch (error) {
    if (error instanceof BuilderCheckWorkspaceMaterializerError) throw error;
    fail();
  }
}

function assertTrustedAdmission(admission) {
  if (!TRUSTED_ADMISSIONS.has(admission)) fail();
  const descriptors = exactObject(admission, ADMISSION_KEYS);
  if (descriptors.admission_version.value !== BUILDER_CHECK_WORKSPACE_ADMISSION_VERSION) fail();
  if (descriptors.admission_kind.value !== ADMISSION_KIND) fail();
  safePattern(descriptors.check_run_admission_id.value, CHECK_RUN_ADMISSION_ID_PATTERN);
  safePattern(descriptors.check_run_admission_digest.value, DIGEST_PATTERN);
  safePattern(descriptors.project_id.value, PROJECT_ID_PATTERN);
  const candidateId = safePattern(descriptors.candidate_id.value, CANDIDATE_ID_PATTERN);
  const candidateDigest = safePattern(descriptors.candidate_digest.value, DIGEST_PATTERN);
  if (candidateId !== `builder-code-change-candidate:${candidateDigest.slice(7)}`) fail();
  safePattern(descriptors.resulting_tree_digest.value, DIGEST_PATTERN);
  if (!Number.isSafeInteger(descriptors.materialized_file_count.value)
    || descriptors.materialized_file_count.value < 0) fail();
  const authorityDescriptors = exactObject(descriptors.authority.value, AUTHORITY_KEYS);
  for (const key of AUTHORITY_KEYS) {
    if (authorityDescriptors[key].value !== AUTHORITY[key]) fail();
  }
  const state = ADMISSION_STATE.get(admission);
  if (!state) fail();
  return state;
}

function createBuilderCheckWorkspaceMaterializer(rawInput) {
  try {
    const descriptors = exactObject(rawInput, CREATE_KEYS);
    const checksRoot = safeAbsolutePath(descriptors.checks_root.value);
    const checksRootRealPath = checkedRealDirectory(checksRoot, null, true);

    return freezeDeep({
      materializer_version: BUILDER_CHECK_WORKSPACE_MATERIALIZER_VERSION,
      materialize_candidate(rawMaterializeInput) {
        let workspacePath = null;
        try {
          const input = exactObject(rawMaterializeInput, MATERIALIZE_KEYS);
          const checkRunAdmission = sanitizeBuilderCheckRunAdmission(
            input.check_run_admission.value,
          );
          const projectId = checkRunAdmission.project_id;
          const candidateId = checkRunAdmission.candidate_id;
          const candidateDigest = checkRunAdmission.candidate_digest;
          const resultingTreeDigest = checkRunAdmission.resulting_tree_digest;
          const sourceTree = sanitizeBuilderProjectSourceTree(input.source_tree.value);
          if (resultingTreeDigest !== sourceTree.source_tree_digest) fail();
          if (sourceTree.files.some((file) => protectedPath(file.path))) fail();
          checkedRealDirectory(checksRootRealPath);

          workspacePath = path.join(checksRootRealPath, `candidate-${safeWorkspaceToken()}`);
          if (!isContained(checksRootRealPath, workspacePath)) fail();
          try {
            fs.mkdirSync(workspacePath, { mode: 0o700 });
          } catch {
            fail();
          }
          checkedRealDirectory(workspacePath, checksRootRealPath);
          for (const file of sourceTree.files) writeExclusiveFile(workspacePath, file);
          scanWorkspace(workspacePath, sourceTree);

          const admission = freezeDeep({
            admission_version: BUILDER_CHECK_WORKSPACE_ADMISSION_VERSION,
            admission_kind: ADMISSION_KIND,
            check_run_admission_id: checkRunAdmission.admission_id,
            check_run_admission_digest: checkRunAdmission.admission_digest,
            project_id: projectId,
            candidate_id: candidateId,
            candidate_digest: candidateDigest,
            resulting_tree_digest: resultingTreeDigest,
            materialized_file_count: sourceTree.files.length,
            authority: AUTHORITY,
          });
          TRUSTED_ADMISSIONS.add(admission);
          ADMISSION_STATE.set(admission, {
            checksRootRealPath,
            workspacePath,
            sourceTree,
            cleaned: false,
          });
          return admission;
        } catch (error) {
          if (workspacePath !== null) {
            try {
              removeWorkspace(workspacePath, checksRootRealPath);
            } catch {
              // Keep the public failure fixed and redacted even if defensive cleanup cannot proceed.
            }
          }
          if (error instanceof BuilderCheckWorkspaceMaterializerError) throw error;
          fail();
        }
      },
      read_workspace_path(rawAdmission) {
        try {
          const state = assertTrustedAdmission(rawAdmission);
          if (state.cleaned) fail();
          checkedRealDirectory(state.checksRootRealPath);
          scanWorkspace(state.workspacePath, state.sourceTree);
          return state.workspacePath;
        } catch (error) {
          if (error instanceof BuilderCheckWorkspaceMaterializerError) throw error;
          fail();
        }
      },
      cleanup(rawAdmission) {
        try {
          const state = assertTrustedAdmission(rawAdmission);
          if (state.cleaned) {
            return Object.freeze({ cleaned: false, reason: 'already_cleaned' });
          }
          checkedRealDirectory(state.checksRootRealPath);
          removeWorkspace(state.workspacePath, state.checksRootRealPath);
          state.cleaned = true;
          return Object.freeze({ cleaned: true, reason: 'removed' });
        } catch (error) {
          if (error instanceof BuilderCheckWorkspaceMaterializerError) throw error;
          fail();
        }
      },
    });
  } catch (error) {
    if (error instanceof BuilderCheckWorkspaceMaterializerError) throw error;
    fail();
  }
}

module.exports = freezeDeep({
  BUILDER_CHECK_WORKSPACE_MATERIALIZER_VERSION,
  BUILDER_CHECK_WORKSPACE_ADMISSION_VERSION,
  BuilderCheckWorkspaceMaterializerError,
  createBuilderCheckWorkspaceMaterializer,
});
