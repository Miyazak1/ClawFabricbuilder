'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { types: utilTypes } = require('node:util');

const {
  createDefaultBuilderGitProjectRepository,
} = require('./builder-git-project-repository.cjs');
const {
  createBuilderProductMetadataDatabase,
} = require('./builder-product-metadata-database.cjs');
const {
  createBuilderProjectReadAuthority,
} = require('./builder-project-read-authority.cjs');

const BUILDER_PROJECT_MAIN_AUTHORITY_VERSION = 'builder-project-main-authority.v1';
const PROJECT_REPOSITORY_DIRECTORY = 'builder-projects-v2';
const GIT_RUNTIME_DIRECTORY = 'builder-git-runtime-v2';
const METADATA_DIRECTORY = 'builder-product-metadata-v3';
const METADATA_DATABASE = 'builder.sqlite';
const OPTION_KEYS = Object.freeze(['userDataPath', 'nowSeconds']);
const ERROR_MESSAGE = 'Builder project authority is unavailable.';

class BuilderProjectMainAuthorityError extends Error {
  constructor() {
    super(ERROR_MESSAGE);
    this.name = 'BuilderProjectMainAuthorityError';
    this.code = 'builder_project_main_authority_unavailable';
    this.retryable = false;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderProjectMainAuthorityError();
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

function exactOptions(value) {
  if (!isPlainObject(value)) fail();
  const keys = Reflect.ownKeys(value);
  if (
    keys.length < 1
    || keys.length > OPTION_KEYS.length
    || keys.some((key) => typeof key !== 'string' || !OPTION_KEYS.includes(key))
    || !keys.includes('userDataPath')
  ) fail();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  }
  const userDataPath = descriptors.userDataPath.value;
  const nowSeconds = keys.includes('nowSeconds')
    ? descriptors.nowSeconds.value
    : () => Math.floor(Date.now() / 1000);
  if (
    typeof userDataPath !== 'string'
    || userDataPath.length === 0
    || userDataPath.length > 1024
    || userDataPath.trim() !== userDataPath
    || userDataPath.includes('\0')
    || !path.isAbsolute(userDataPath)
    || path.normalize(userDataPath) !== userDataPath
    || typeof nowSeconds !== 'function'
    || utilTypes.isProxy(nowSeconds)
  ) fail();
  return Object.freeze({ userDataPath, nowSeconds });
}

function methodFacade(target, keys) {
  const facade = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(target, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') fail();
    facade[key] = (...args) => Reflect.apply(descriptor.value, target, args);
  }
  return Object.freeze(facade);
}

function createBuilderProjectMainAuthority(rawOptions) {
  const options = exactOptions(rawOptions);
  let metadataDatabase = null;
  try {
    const projectsRoot = path.join(options.userDataPath, PROJECT_REPOSITORY_DIRECTORY);
    const runtimeRoot = path.join(options.userDataPath, GIT_RUNTIME_DIRECTORY);
    const metadataRoot = path.join(options.userDataPath, METADATA_DIRECTORY);
    fs.mkdirSync(projectsRoot, { recursive: true, mode: 0o700 });
    fs.mkdirSync(runtimeRoot, { recursive: true, mode: 0o700 });
    fs.mkdirSync(metadataRoot, { recursive: true, mode: 0o700 });
    metadataDatabase = createBuilderProductMetadataDatabase(path.join(metadataRoot, METADATA_DATABASE));
    const gitRepository = createDefaultBuilderGitProjectRepository({
      projects_root: projectsRoot,
      runtime_root: runtimeRoot,
      now_seconds: options.nowSeconds,
    });
    const projectReadAuthority = createBuilderProjectReadAuthority({
      metadata_database: metadataDatabase,
      git_repository: gitRepository,
    });
    const gitAuthority = methodFacade(gitRepository, [
      'persist_candidate_commit',
      'verify_candidate_receipt',
      'read_verified_candidate',
    ]);
    const metadataAuthority = methodFacade(metadataDatabase, [
      'append_conversation_events',
      'load_conversation',
      'load_project_identity',
      'record_project_revision_receipt',
    ]);
    const readAuthority = methodFacade(projectReadAuthority, [
      'load_current',
      'load_revision',
      'list_current',
    ]);
    let closed = false;
    return Object.freeze({
      authority_version: BUILDER_PROJECT_MAIN_AUTHORITY_VERSION,
      git_authority: gitAuthority,
      metadata_authority: metadataAuthority,
      project_read_authority: readAuthority,
      close() {
        if (closed) return false;
        try {
          metadataDatabase.close();
          closed = true;
          return true;
        } catch {
          fail();
        }
      },
    });
  } catch {
    try { metadataDatabase?.close(); } catch { /* fixed failure below */ }
    fail();
  }
}

module.exports = Object.freeze({
  BUILDER_PROJECT_MAIN_AUTHORITY_VERSION,
  PROJECT_REPOSITORY_DIRECTORY,
  GIT_RUNTIME_DIRECTORY,
  METADATA_DIRECTORY,
  METADATA_DATABASE,
  BuilderProjectMainAuthorityError,
  createBuilderProjectMainAuthority,
});
