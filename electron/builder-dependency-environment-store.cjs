'use strict';

const fs = require('node:fs');
const nodeCrypto = require('node:crypto');
const path = require('node:path');
const { types: utilTypes } = require('node:util');

const {
  sanitizeBuilderCheckRunAdmission,
} = require('./builder-check-run-admission.cjs');
const {
  sanitizeBuilderProjectSourceTree,
} = require('./builder-project-source-tree.cjs');

const BUILDER_DEPENDENCY_ENVIRONMENT_STORE_VERSION =
  'builder-dependency-environment-store.v1';
const CREATE_KEYS = Object.freeze(['environment_root']);
const WORKSPACE_KEYS = Object.freeze([
  'check_run_admission',
  'source_tree',
  'workspace_path',
]);
const DEPENDENCY_FIELDS = Object.freeze([
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
]);
const LOCKFILES = Object.freeze([
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
]);
const ARTIFACTS = Object.freeze([
  'node_modules',
  '.npm-cache',
  'node-compile-cache',
]);
const ENVIRONMENT_KEY_PATTERN = /^builder-dependency-environment:[0-9a-f]{64}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;

class BuilderDependencyEnvironmentStoreError extends Error {
  constructor() {
    super('The prepared dependency environment could not be verified.');
    this.name = 'BuilderDependencyEnvironmentStoreError';
    this.code = 'builder_dependency_environment_store_invalid';
    this.retryable = false;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderDependencyEnvironmentStoreError();
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || utilTypes.isProxy(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactObject(value, keys) {
  if (!isPlainObject(value)) fail();
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== keys.length
    || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) fail();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  }
  return descriptors;
}

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
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
      (key) => `${JSON.stringify(key)}:${canonicalJson(valueAt(value, key))}`,
    ).join(',')}}`;
  }
  fail();
}

function sha256Canonical(value) {
  return `sha256:${nodeCrypto.createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')}`;
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

function checkedDirectory(targetPath, expectedRoot = null, allowPathAlias = false) {
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

function safeDigest(value) {
  if (typeof value !== 'string' || !DIGEST_PATTERN.test(value)) fail();
  return value;
}

function dependencySpecPaths(sourceTree) {
  const files = new Map(sourceTree.files.map((file) => [file.path, file]));
  const manifest = files.get('package.json');
  if (!manifest) return [];
  let parsed;
  try {
    parsed = JSON.parse(manifest.content);
  } catch {
    return [];
  }
  if (!isPlainObject(parsed)) return [];
  const selected = new Set(['package.json']);
  for (const lockfile of LOCKFILES) {
    if (files.has(lockfile)) selected.add(lockfile);
  }
  for (const field of DEPENDENCY_FIELDS) {
    const dependencies = parsed[field];
    if (dependencies === undefined) continue;
    if (!isPlainObject(dependencies) || utilTypes.isProxy(dependencies)) return [];
    for (const spec of Object.values(dependencies)) {
      if (typeof spec !== 'string' || !spec.startsWith('file:')) continue;
      const relative = spec.slice('file:'.length).replaceAll('\\', '/').replace(/^\.?\//u, '');
      if (
        relative.length === 0
        || relative.startsWith('../')
        || relative.includes('/../')
        || path.posix.isAbsolute(relative)
      ) return [];
      for (const file of sourceTree.files) {
        if (file.path === relative || file.path.startsWith(`${relative}/`)) {
          selected.add(file.path);
        }
      }
    }
  }
  return [...selected].sort();
}

function environmentKey(admission, sourceTree) {
  const paths = dependencySpecPaths(sourceTree);
  if (paths.length === 0) return null;
  const files = new Map(sourceTree.files.map((file) => [file.path, file]));
  const digest = sha256Canonical({
    package_manager: admission.package_manager,
    dependency_files: paths.map((filePath) => {
      const file = files.get(filePath);
      if (!file) fail();
      return {
        path: file.path,
        content_digest: safeDigest(file.content_digest),
      };
    }),
  });
  return `builder-dependency-environment:${digest.slice('sha256:'.length)}`;
}

function pathForKey(environmentRoot, key) {
  if (typeof key !== 'string' || !ENVIRONMENT_KEY_PATTERN.test(key)) fail();
  const target = path.join(environmentRoot, `env-${key.slice('builder-dependency-environment:'.length)}`);
  if (!isContained(environmentRoot, target)) fail();
  return target;
}

function artifactPath(rootPath, artifact) {
  const target = path.join(rootPath, artifact);
  if (!isContained(rootPath, target)) fail();
  return target;
}

function copyArtifact(sourceRoot, targetRoot, artifact) {
  const source = artifactPath(sourceRoot, artifact);
  if (!fs.existsSync(source)) return false;
  const target = artifactPath(targetRoot, artifact);
  if (fs.existsSync(target)) fail();
  try {
    fs.cpSync(source, target, {
      recursive: true,
      dereference: true,
      errorOnExist: true,
      force: false,
    });
  } catch {
    fail();
  }
  checkedDirectory(targetRoot);
  return true;
}

function safeWorkspaceInput(rawInput) {
  const input = exactObject(rawInput, WORKSPACE_KEYS);
  const admission = sanitizeBuilderCheckRunAdmission(input.check_run_admission.value);
  const sourceTree = sanitizeBuilderProjectSourceTree(input.source_tree.value);
  if (
    admission.project_id !== sourceTree.project_id
    && typeof sourceTree.project_id === 'string'
  ) fail();
  if (admission.resulting_tree_digest !== sourceTree.source_tree_digest) fail();
  const workspacePath = safeAbsolutePath(input.workspace_path.value);
  checkedDirectory(workspacePath);
  return { admission, sourceTree, workspacePath };
}

function receipt(status, key, restoredArtifactCount = 0) {
  return freezeDeep({
    receipt_version: 'builder-dependency-environment-store-receipt.v1',
    status,
    dependency_environment_key: key,
    restored_artifact_count: restoredArtifactCount,
    authority: {
      store_authority: 'main_owned_prepared_dependency_environment_v1',
      renderer_authority: 'not_present',
      provider_dispatch: false,
      project_workspace_write: false,
      check_workspace_write: true,
      path_disclosure: 'not_serialized',
    },
  });
}

function createBuilderDependencyEnvironmentStore(rawInput) {
  try {
    const descriptors = exactObject(rawInput, CREATE_KEYS);
    const environmentRoot = safeAbsolutePath(descriptors.environment_root.value);
    fs.mkdirSync(environmentRoot, { recursive: true, mode: 0o700 });
    const environmentRootRealPath = checkedDirectory(environmentRoot, null, true);

    return freezeDeep({
      store_version: BUILDER_DEPENDENCY_ENVIRONMENT_STORE_VERSION,
      restore_for_candidate(rawWorkspaceInput) {
        try {
          const { admission, sourceTree, workspacePath } = safeWorkspaceInput(rawWorkspaceInput);
          const key = environmentKey(admission, sourceTree);
          if (key === null) return receipt('not_applicable', null, 0);
          const preparedPath = pathForKey(environmentRootRealPath, key);
          if (!fs.existsSync(preparedPath)) return receipt('missing', key, 0);
          checkedDirectory(preparedPath, environmentRootRealPath);
          let restoredArtifactCount = 0;
          for (const artifact of ARTIFACTS) {
            if (copyArtifact(preparedPath, workspacePath, artifact)) restoredArtifactCount += 1;
          }
          return receipt('restored', key, restoredArtifactCount);
        } catch (error) {
          if (error instanceof BuilderDependencyEnvironmentStoreError) throw error;
          fail();
        }
      },
      capture_from_candidate(rawWorkspaceInput) {
        try {
          const { admission, sourceTree, workspacePath } = safeWorkspaceInput(rawWorkspaceInput);
          const key = environmentKey(admission, sourceTree);
          if (key === null) return receipt('not_applicable', null, 0);
          const preparedPath = pathForKey(environmentRootRealPath, key);
          if (fs.existsSync(path.join(preparedPath, 'node_modules'))) {
            checkedDirectory(preparedPath, environmentRootRealPath);
            return receipt('stored', key, 0);
          }
          const stagingPath = path.join(environmentRootRealPath, `staging-${nodeCrypto.randomBytes(16).toString('hex')}`);
          if (!isContained(environmentRootRealPath, stagingPath)) fail();
          fs.mkdirSync(stagingPath, { mode: 0o700 });
          let copiedArtifactCount = 0;
          try {
            for (const artifact of ARTIFACTS) {
              if (copyArtifact(workspacePath, stagingPath, artifact)) copiedArtifactCount += 1;
            }
            if (copiedArtifactCount === 0) {
              fs.rmSync(stagingPath, { recursive: true, force: true });
              return receipt('skipped', key, 0);
            }
            fs.renameSync(stagingPath, preparedPath);
            return receipt('stored', key, copiedArtifactCount);
          } catch (error) {
            try { fs.rmSync(stagingPath, { recursive: true, force: true }); } catch { /* fixed public failure */ }
            if (error && error.code === 'EEXIST') return receipt('stored', key, 0);
            throw error;
          }
        } catch (error) {
          if (error instanceof BuilderDependencyEnvironmentStoreError) throw error;
          fail();
        }
      },
    });
  } catch (error) {
    if (error instanceof BuilderDependencyEnvironmentStoreError) throw error;
    fail();
  }
}

module.exports = freezeDeep({
  BUILDER_DEPENDENCY_ENVIRONMENT_STORE_VERSION,
  BuilderDependencyEnvironmentStoreError,
  createBuilderDependencyEnvironmentStore,
});
