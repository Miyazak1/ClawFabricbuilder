'use strict';

const nodeCrypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { types: utilTypes } = require('node:util');
const { _electron: defaultElectron } = require('playwright-core');
const { PNG } = require('pngjs');

const CANARY_INPUT_VERSION = 'builder-packaged-canary-input.v1';
const CANARY_RESULT_VERSION = 'builder-packaged-canary-result.v1';
const PACKAGED_CANARY_SENTINEL = 'BUILDER_PACKAGED_CANARY';
const PACKAGED_CANARY_USER_DATA_PATH = 'BUILDER_PACKAGED_CANARY_USER_DATA_PATH';
const PACKAGED_CANARY_USER_DATA_PREFIX = 'clawfabric-builder-packaged-canary-';
const LOCAL_STATE_FILE_NAME = 'Local State';
const PROVIDER_CONFIG_DIRECTORY_NAME = 'builder-provider-config-v1';
const PROVIDER_CONFIG_CURRENT_FILE_NAME = 'current.json';
const PROVIDER_SECRETS_DIRECTORY_NAME = 'builder-provider-secrets-v1';
const DEFAULT_EXECUTABLE = path.join(__dirname, '..', 'release', 'win-unpacked', 'ClawFabric Builder.exe');
const STDIN_MAX_BYTES = 128 * 1024;
const LOCAL_STATE_MAX_BYTES = 2 * 1024 * 1024;
const PROVIDER_CONFIG_MAX_BYTES = 128 * 1024;
const PROVIDER_SECRET_MAX_BYTES = 64 * 1024;
const PROVIDER_SECRET_MAX_FILES = 8;
const WINDOWS_ENV_ALLOWLIST = Object.freeze([
  'SystemRoot',
  'WINDIR',
  'PATH',
  'ComSpec',
  'TEMP',
  'TMP',
  'USERPROFILE',
  'LOCALAPPDATA',
]);
const SELECTORS = Object.freeze({
  apiKey: '#builder-provider-api-key',
  baseUrl: '#builder-provider-base-url',
  idea: '#builder-idea',
  maxTokens: '#builder-provider-max-tokens',
  model: '#builder-provider-model',
  providerPanel: '[data-builder-provider-settings-panel="true"]',
  projectCatalog: '[data-builder-project-catalog="true"]',
  projectPage: '[data-builder-page="true"]',
  preview: '[data-builder-static-preview="true"]',
  previewFrame: '[data-builder-static-preview="true"] iframe[title$=" preview"]',
  temperature: '#builder-provider-temperature',
  timeout: '#builder-provider-timeout',
});
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const CSS_IDENTIFIER_PATTERN = /^[a-z][a-z0-9_-]*$/u;

const ERROR_MESSAGES = Object.freeze({
  canary_input_invalid: 'Packaged canary input is invalid.',
  canary_secret_source_invalid: 'Packaged canary credential source is invalid.',
  canary_launch_failed: 'Packaged canary could not launch.',
  canary_ui_failed: 'Packaged canary UI flow failed.',
  canary_settings_navigation_failed: 'Packaged canary settings navigation failed.',
  canary_settings_panel_failed: 'Packaged canary settings panel failed.',
  canary_settings_save_failed: 'Packaged canary settings save failed.',
  canary_saved_profile_failed: 'Packaged canary saved profile setup failed.',
  canary_new_project_failed: 'Packaged canary new project failed.',
  canary_generation_terminal_failed: 'Packaged canary generation did not reach a terminal preview state.',
  canary_preview_failed: 'Packaged canary preview evidence failed.',
  canary_version_failed: 'Packaged canary revision version evidence failed.',
  canary_read_evidence_failed: 'Packaged canary read evidence failed.',
  canary_restart_failed: 'Packaged canary restart restore failed.',
  canary_custom_chrome_failed: 'Packaged canary custom window controls are unavailable.',
  canary_evidence_failed: 'Packaged canary evidence could not be verified.',
  canary_cleanup_failed: 'Packaged canary cleanup failed.',
});
const ERROR_STAGES = Object.freeze({
  canary_input_invalid: 'input',
  canary_secret_source_invalid: 'secret_source',
  canary_launch_failed: 'launch',
  canary_ui_failed: 'ui',
  canary_settings_navigation_failed: 'settings_navigation',
  canary_settings_panel_failed: 'settings_panel',
  canary_settings_save_failed: 'settings_save',
  canary_saved_profile_failed: 'saved_profile',
  canary_new_project_failed: 'new_project',
  canary_generation_terminal_failed: 'generation_terminal',
  canary_preview_failed: 'preview',
  canary_version_failed: 'version',
  canary_read_evidence_failed: 'read_evidence',
  canary_restart_failed: 'restart',
  canary_custom_chrome_failed: 'custom_chrome',
  canary_evidence_failed: 'evidence',
  canary_cleanup_failed: 'cleanup',
});

const CATALOG_RESULT_KEYS = Object.freeze(['catalog_evidence', 'projects', 'result_version']);
const CATALOG_PROJECT_KEYS = Object.freeze(['project_id', 'revision', 'revision_digest', 'summary', 'title']);
const CURRENT_RESULT_KEYS = Object.freeze([
  'head',
  'persistence_evidence',
  'record',
  'restart_restore',
  'result_version',
]);
const HEAD_KEYS = Object.freeze([
  'head_digest',
  'project_id',
  'record_kind',
  'revision',
  'revision_digest',
  'schema_version',
]);
const PROJECT_RECORD_KEYS = Object.freeze([
  'execution_admission',
  'files',
  'parent_revision',
  'preview_script_admission',
  'project_id',
  'proposal_evidence',
  'record_kind',
  'revision',
  'revision_digest',
  'schema_version',
  'summary',
  'title',
]);
const STATUS_KEYS = Object.freeze([
  'config_digest',
  'configured',
  'credential_status',
  'status_version',
]);
const READ_EVIDENCE_KEYS = Object.freeze(['catalog', 'current', 'status']);
const RUN_OPTION_KEYS = Object.freeze(['argv', 'electron', 'env', 'fs', 'os', 'userDataPath']);
const FIRST_CONFIG_INPUT_KEYS = Object.freeze(['executable_path', 'idea', 'provider', 'schema_version']);
const SAVED_PROFILE_INPUT_KEYS = Object.freeze([
  'executable_path',
  'idea',
  'mode',
  'schema_version',
  'source_user_data_path',
]);
const PROVIDER_SECRET_FILE_PATTERN = /^[0-9a-f]{64}\.json$/u;
const PROJECT_ID_PATTERN = /^builder-project:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const PROJECT_ID_LENGTH = 'builder-project:00000000-0000-0000-0000-000000000000'.length;

class BuilderPackagedCanaryError extends Error {
  constructor(code = 'canary_evidence_failed') {
    const selected = Object.hasOwn(ERROR_MESSAGES, code) ? code : 'canary_evidence_failed';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderPackagedCanaryError';
    this.code = selected;
    this.stage = ERROR_STAGES[selected];
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) {
  throw new BuilderPackagedCanaryError(code);
}

function fixedError(source, fallback = 'canary_evidence_failed') {
  let code = fallback;
  try {
    if (source !== null && typeof source === 'object' && !utilTypes.isProxy(source)) {
      const descriptor = Object.getOwnPropertyDescriptor(source, 'code');
      if (
        descriptor
        && descriptor.enumerable
        && !('get' in descriptor)
        && !('set' in descriptor)
        && Object.hasOwn(ERROR_MESSAGES, descriptor.value)
      ) code = descriptor.value;
    }
  } catch {
    code = fallback;
  }
  return new BuilderPackagedCanaryError(code);
}

function isObjectProxy(value) {
  return value !== null && typeof value === 'object' && utilTypes.isProxy(value);
}

function text(value, maxBytes = 64 * 1024) {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
    fail('canary_input_invalid');
  }
  if (Buffer.byteLength(value, 'utf8') > maxBytes) fail('canary_input_invalid');
  return value;
}

function optionalNumber(value, minimum, maximum) {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    fail('canary_input_invalid');
  }
  return value;
}

function integer(value, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) fail('canary_input_invalid');
  return value;
}

function exactObject(value, expectedKeys) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || isObjectProxy(value)) {
    fail('canary_input_invalid');
  }
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== expectedKeys.length
    || keys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))
  ) fail('canary_input_invalid');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of expectedKeys) {
    const descriptor = descriptors[key];
    if (!descriptor || !descriptor.enumerable || 'get' in descriptor || 'set' in descriptor) {
      fail('canary_input_invalid');
    }
  }
  return descriptors;
}

function exactDataObject(value, expectedKeys, code = 'canary_evidence_failed') {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value) || isObjectProxy(value)) fail(code);
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== expectedKeys.length
      || keys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))
    ) fail(code);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const key of expectedKeys) {
      const descriptor = descriptors[key];
      if (!descriptor || !descriptor.enumerable || 'get' in descriptor || 'set' in descriptor) {
        fail(code);
      }
    }
    return descriptors;
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError) throw error;
    fail(code);
  }
}

function sanitizeProvider(value) {
  const descriptors = exactObject(value, [
    'base_url',
    'credential',
    'max_tokens',
    'model',
    'temperature',
    'timeout_ms',
  ]);
  const baseUrl = text(descriptors.base_url.value);
  if (!/^https:\/\/[^\s/$.?#].[^\s]*$/iu.test(baseUrl)) fail('canary_input_invalid');
  return Object.freeze({
    base_url: baseUrl,
    credential: text(descriptors.credential.value),
    max_tokens: optionalNumber(descriptors.max_tokens.value, 256, 65_536),
    model: text(descriptors.model.value),
    temperature: optionalNumber(descriptors.temperature.value, 0, 2),
    timeout_ms: integer(descriptors.timeout_ms.value, 1_000, 120_000),
  });
}

function sanitizedExecutablePath(value) {
  const executablePath = value === null
    ? DEFAULT_EXECUTABLE
    : text(value, 2_048);
  if (!isLocalAbsolutePath(executablePath)) fail('canary_input_invalid');
  return executablePath;
}

function isLocalAbsolutePath(value) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.trim() !== value
    || value.includes('\0')
    || !path.isAbsolute(value)
    || path.normalize(value) !== value
    || path.resolve(value) !== value
  ) {
    return false;
  }
  if (process.platform === 'win32') {
    if (/^\\\\/u.test(value)) return false;
    if (!/^[A-Za-z]:\\/u.test(value)) return false;
  }
  return true;
}

function inputDescriptors(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || isObjectProxy(value)) {
    fail('canary_input_invalid');
  }
  let keys;
  let descriptors;
  try {
    keys = Reflect.ownKeys(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    fail('canary_input_invalid');
  }
  const modeDescriptor = descriptors.mode;
  const expectedKeys = modeDescriptor === undefined
    ? FIRST_CONFIG_INPUT_KEYS
    : SAVED_PROFILE_INPUT_KEYS;
  if (
    keys.length !== expectedKeys.length
    || keys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))
  ) fail('canary_input_invalid');
  for (const key of expectedKeys) {
    const descriptor = descriptors[key];
    if (!descriptor || !descriptor.enumerable || 'get' in descriptor || 'set' in descriptor) {
      fail('canary_input_invalid');
    }
  }
  return Object.freeze({ descriptors, mode: modeDescriptor === undefined ? 'first_config' : modeDescriptor.value });
}

function sanitizeInput(value) {
  const { descriptors, mode } = inputDescriptors(value);
  if (descriptors.schema_version.value !== CANARY_INPUT_VERSION) fail('canary_input_invalid');
  const executablePath = sanitizedExecutablePath(descriptors.executable_path.value);
  if (mode === 'saved_profile') {
    const sourceUserDataPath = text(descriptors.source_user_data_path.value, 2_048);
    if (!isLocalAbsolutePath(sourceUserDataPath)) fail('canary_input_invalid');
    return Object.freeze({
      executable_path: executablePath,
      idea: text(descriptors.idea.value, 4_000),
      mode: 'saved_profile',
      schema_version: CANARY_INPUT_VERSION,
      source_user_data_path: sourceUserDataPath,
    });
  }
  if (mode !== 'first_config') fail('canary_input_invalid');
  return Object.freeze({
    executable_path: executablePath,
    idea: text(descriptors.idea.value, 4_000),
    provider: sanitizeProvider(descriptors.provider.value),
    schema_version: CANARY_INPUT_VERSION,
  });
}

function parseCanaryInput(source) {
  try {
    return sanitizeInput(JSON.parse(source));
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError) throw error;
    fail('canary_input_invalid');
  }
}

function ensureCredentialOnlyFromStdin(credential, argv, env) {
  if (argv.some((entry) => typeof entry === 'string' && entry.includes(credential))) {
    fail('canary_secret_source_invalid');
  }
  if (isObjectProxy(env)) fail('canary_secret_source_invalid');
  let descriptors;
  try {
    descriptors = Object.getOwnPropertyDescriptors(env);
  } catch {
    fail('canary_secret_source_invalid');
  }
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== 'string') continue;
    const descriptor = descriptors[key];
    if (!descriptor || 'get' in descriptor || 'set' in descriptor || typeof descriptor.value !== 'string') {
      continue;
    }
    if (descriptor.value.includes(credential)) fail('canary_secret_source_invalid');
  }
}

function redactInput(input) {
  const credentialSource = input.mode === 'saved_profile' ? 'saved_profile' : 'stdin';
  return Object.freeze({
    credential_source: credentialSource,
    idea_digest: digestText(input.idea),
    schema_version: input.schema_version,
  });
}

function digestText(value) {
  return `sha256:${nodeCrypto.createHash('sha256').update(value).digest('hex')}`;
}

function cssString(value) {
  return String(value).replace(/["\\\n\r\f]/gu, (character) => {
    if (character === '"') return '\\"';
    if (character === '\\') return '\\\\';
    if (character === '\n') return '\\a ';
    if (character === '\r') return '\\d ';
    return '\\c ';
  });
}

function attributeEqualsSelector(attributeName, value) {
  if (typeof attributeName !== 'string' || !CSS_IDENTIFIER_PATTERN.test(attributeName)) {
    fail('canary_evidence_failed');
  }
  return `[${attributeName}="${cssString(value)}"]`;
}

function createArtifactGate() {
  let allowed = false;
  return Object.freeze({
    allow() { allowed = true; },
    assertAllowed() {
      if (!allowed) fail('canary_secret_source_invalid');
    },
    get allowed() { return allowed; },
  });
}

function samePath(left, right) {
  return process.platform === 'win32'
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

function pathIdentity(stat) {
  const dev = typeof stat.dev === 'bigint' || Number.isSafeInteger(stat.dev) ? stat.dev : null;
  const ino = typeof stat.ino === 'bigint' || Number.isSafeInteger(stat.ino) ? stat.ino : null;
  return Object.freeze({
    dev,
    ino,
  });
}

function guardedUserDataError() {
  throw new BuilderPackagedCanaryError('canary_cleanup_failed');
}

function lstatDirectory(fsModule, directoryPath) {
  let stat;
  try {
    stat = fsModule.lstatSync(directoryPath, { bigint: true });
  } catch {
    guardedUserDataError();
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) guardedUserDataError();
  return stat;
}

function realpath(fsModule, directoryPath) {
  try {
    return path.resolve(fsModule.realpathSync.native(directoryPath));
  } catch {
    guardedUserDataError();
  }
}

function captureGuardedUserDataRoot(rootPath, fsModule = fs, osModule = os) {
  if (
    typeof rootPath !== 'string'
    || rootPath.length === 0
    || rootPath.trim() !== rootPath
    || rootPath.includes('\0')
    || !path.isAbsolute(rootPath)
    || path.normalize(rootPath) !== rootPath
    || path.resolve(rootPath) !== rootPath
  ) guardedUserDataError();
  const tempRoot = path.resolve(osModule.tmpdir());
  const basename = path.basename(rootPath);
  if (path.dirname(rootPath) !== tempRoot || !basename.startsWith(PACKAGED_CANARY_USER_DATA_PREFIX)) {
    guardedUserDataError();
  }
  const tempStat = lstatDirectory(fsModule, tempRoot);
  void tempStat;
  const tempRealPath = realpath(fsModule, tempRoot);
  const rootStat = lstatDirectory(fsModule, rootPath);
  const rootRealPath = realpath(fsModule, rootPath);
  if (!samePath(path.dirname(rootRealPath), tempRealPath) || path.basename(rootRealPath) !== basename) {
    guardedUserDataError();
  }
  return Object.freeze({
    basename,
    identity: pathIdentity(rootStat),
    path: rootPath,
    realPath: rootRealPath,
  });
}

function reverifyGuardedUserDataRoot(rootIdentity, fsModule = fs, osModule = os) {
  const current = captureGuardedUserDataRoot(rootIdentity.path, fsModule, osModule);
  if (!samePath(current.realPath, rootIdentity.realPath)) guardedUserDataError();
  for (const key of ['dev', 'ino']) {
    if (
      rootIdentity.identity[key] !== null
      && current.identity[key] !== null
      && rootIdentity.identity[key] !== current.identity[key]
    ) guardedUserDataError();
  }
  return current;
}

function savedProfileError() {
  throw new BuilderPackagedCanaryError('canary_saved_profile_failed');
}

function normalizedFileStat(stat, maximumBytes) {
  const size = stat.size;
  if (typeof size !== 'bigint' && !Number.isSafeInteger(size)) savedProfileError();
  const normalizedSize = typeof size === 'bigint' ? size : BigInt(size);
  if (normalizedSize < 0n || normalizedSize > BigInt(maximumBytes)) savedProfileError();
  return Object.freeze({
    dev: typeof stat.dev === 'bigint' || Number.isSafeInteger(stat.dev) ? stat.dev : null,
    ino: typeof stat.ino === 'bigint' || Number.isSafeInteger(stat.ino) ? stat.ino : null,
    mtimeMs: (
      (typeof stat.mtimeMs === 'bigint')
      || (typeof stat.mtimeMs === 'number' && Number.isFinite(stat.mtimeMs))
    ) ? stat.mtimeMs : null,
    size: normalizedSize,
  });
}

function sourceProfileFileStat(fsModule, filePath, maximumBytes, options = {}) {
  let stat;
  try {
    stat = fsModule.lstatSync(filePath, { bigint: true });
  } catch {
    savedProfileError();
  }
  if (!stat.isFile() || stat.isSymbolicLink()) savedProfileError();
  const before = normalizedFileStat(stat, maximumBytes);
  let fd = null;
  try {
    fd = fsModule.openSync(filePath, 'r');
    const opened = normalizedFileStat(fsModule.fstatSync(fd, { bigint: true }), maximumBytes);
    compareSourceFileStat(before, opened);
    const buffer = readBoundedDescriptor(fsModule, fd, maximumBytes);
    const after = normalizedFileStat(fsModule.fstatSync(fd, { bigint: true }), maximumBytes);
    compareSourceFileStat(opened, after);
    if (BigInt(buffer.length) !== after.size) savedProfileError();
    const snapshot = {
      ...after,
      sha256: nodeCrypto.createHash('sha256').update(buffer).digest('hex'),
    };
    if (options.includeBuffer === true) snapshot.buffer = buffer;
    return Object.freeze(snapshot);
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError) throw error;
    savedProfileError();
  } finally {
    if (fd !== null) {
      try {
        fsModule.closeSync(fd);
      } catch {
        savedProfileError();
      }
    }
  }
}

function readBoundedDescriptor(fsModule, fd, maximumBytes) {
  const chunks = [];
  let total = 0;
  const chunkSize = Math.max(1, Math.min(64 * 1024, maximumBytes + 1));
  const buffer = Buffer.alloc(chunkSize);
  while (total <= maximumBytes) {
    const remaining = maximumBytes + 1 - total;
    const bytesRead = fsModule.readSync(fd, buffer, 0, Math.min(buffer.length, remaining), null);
    if (!Number.isSafeInteger(bytesRead) || bytesRead < 0) savedProfileError();
    if (bytesRead === 0) break;
    chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
    total += bytesRead;
  }
  if (total > maximumBytes) savedProfileError();
  return Buffer.concat(chunks, total);
}

function compareSourceFileStat(left, right) {
  if (left.size !== right.size) savedProfileError();
  if (left.sha256 !== undefined && right.sha256 !== undefined && left.sha256 !== right.sha256) {
    savedProfileError();
  }
  for (const key of ['dev', 'ino', 'mtimeMs']) {
    if (left[key] !== null && right[key] !== null && left[key] !== right[key]) savedProfileError();
  }
}

function captureSourceUserDataRoot(sourcePath, fsModule) {
  if (!isLocalAbsolutePath(sourcePath)) savedProfileError();
  return captureSourceDirectory(fsModule, sourcePath);
}

function captureSourceDirectory(fsModule, directoryPath) {
  let stat;
  let realPath;
  try {
    stat = fsModule.lstatSync(directoryPath, { bigint: true });
    realPath = path.resolve(fsModule.realpathSync.native(directoryPath));
  } catch {
    savedProfileError();
  }
  if (!stat.isDirectory() || stat.isSymbolicLink() || !samePath(realPath, directoryPath)) savedProfileError();
  return Object.freeze({
    identity: pathIdentity(stat),
    path: directoryPath,
    realPath,
  });
}

function compareSourceDirectoryIdentity(left, right) {
  if (!samePath(left.path, right.path) || !samePath(left.realPath, right.realPath)) savedProfileError();
  for (const key of ['dev', 'ino']) {
    if (left.identity[key] !== null && right.identity[key] !== null && left.identity[key] !== right.identity[key]) {
      savedProfileError();
    }
  }
}

function captureTargetProfileDirectories(userDataRoot, configDirectory, secretsDirectory, fsModule) {
  const root = captureSourceDirectory(fsModule, userDataRoot.path);
  compareSourceDirectoryIdentity(userDataRoot, root);
  return Object.freeze({
    config: captureSourceDirectory(fsModule, configDirectory),
    root,
    secrets: captureSourceDirectory(fsModule, secretsDirectory),
  });
}

function assertTargetProfileDirectoriesUnchanged(snapshot, fsModule) {
  compareSourceDirectoryIdentity(snapshot.root, captureSourceDirectory(fsModule, snapshot.root.path));
  compareSourceDirectoryIdentity(snapshot.config, captureSourceDirectory(fsModule, snapshot.config.path));
  compareSourceDirectoryIdentity(snapshot.secrets, captureSourceDirectory(fsModule, snapshot.secrets.path));
}

function assertTargetProfileWriteDirectory(snapshot, directoryKey, fsModule) {
  compareSourceDirectoryIdentity(snapshot.root, captureSourceDirectory(fsModule, snapshot.root.path));
  compareSourceDirectoryIdentity(snapshot[directoryKey], captureSourceDirectory(fsModule, snapshot[directoryKey].path));
}

function readExactDirectoryNames(fsModule, directoryPath, expectedNames, code = 'canary_saved_profile_failed') {
  let entries;
  try {
    entries = fsModule.readdirSync(directoryPath, { withFileTypes: true });
  } catch {
    fail(code);
  }
  if (!Array.isArray(entries)) fail(code);
  const names = entries.map((entry) => {
    if (
      entry === null
      || typeof entry !== 'object'
      || isObjectProxy(entry)
    ) fail(code);
    const descriptor = Object.getOwnPropertyDescriptor(entry, 'name');
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'string') fail(code);
    return descriptor.value;
  });
  if (
    names.length !== expectedNames.length
    || names.some((name) => !expectedNames.includes(name))
  ) fail(code);
  return Object.freeze(names);
}

function readSecretDirectoryNames(fsModule, directoryPath) {
  let entries;
  try {
    entries = fsModule.readdirSync(directoryPath, { withFileTypes: true });
  } catch {
    savedProfileError();
  }
  if (!Array.isArray(entries) || entries.length === 0 || entries.length > PROVIDER_SECRET_MAX_FILES) {
    savedProfileError();
  }
  const names = [];
  for (const entry of entries) {
    if (entry === null || typeof entry !== 'object' || isObjectProxy(entry)) savedProfileError();
    const nameDescriptor = Object.getOwnPropertyDescriptor(entry, 'name');
    if (!nameDescriptor || !Object.hasOwn(nameDescriptor, 'value') || typeof nameDescriptor.value !== 'string') {
      savedProfileError();
    }
    const name = nameDescriptor.value;
    if (!PROVIDER_SECRET_FILE_PATTERN.test(name)) savedProfileError();
    let isFile = false;
    try {
      isFile = typeof entry.isFile === 'function' ? Reflect.apply(entry.isFile, entry, []) : false;
    } catch {
      savedProfileError();
    }
    if (isFile !== true) savedProfileError();
    names.push(name);
  }
  names.sort();
  if (new Set(names).size !== names.length) savedProfileError();
  return Object.freeze(names);
}

function makeDirectory(fsModule, directoryPath) {
  try {
    fsModule.mkdirSync(directoryPath);
  } catch {
    savedProfileError();
  }
}

function writeExclusiveProfileFile(
  fsModule,
  targetPath,
  buffer,
  maximumBytes,
  expectedSha256,
  targetDirectories,
  directoryKey,
) {
  if (!Buffer.isBuffer(buffer) || buffer.length > maximumBytes) savedProfileError();
  let fd = null;
  try {
    assertTargetProfileWriteDirectory(targetDirectories, directoryKey, fsModule);
    fd = fsModule.openSync(targetPath, 'wx');
    let written = 0;
    while (written < buffer.length) {
      const bytesWritten = fsModule.writeSync(fd, buffer, written, buffer.length - written, written);
      if (!Number.isSafeInteger(bytesWritten) || bytesWritten <= 0) savedProfileError();
      written += bytesWritten;
    }
    fsModule.fsyncSync(fd);
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError) throw error;
    savedProfileError();
  } finally {
    if (fd !== null) {
      try {
        fsModule.closeSync(fd);
      } catch {
        savedProfileError();
      }
    }
  }
  assertTargetProfileWriteDirectory(targetDirectories, directoryKey, fsModule);
  const copied = sourceProfileFileStat(fsModule, targetPath, maximumBytes);
  if (copied.sha256 !== expectedSha256) savedProfileError();
  assertTargetProfileWriteDirectory(targetDirectories, directoryKey, fsModule);
  return copied;
}

function copyProfileFile(fsModule, sourcePath, targetPath, maximumBytes, targetDirectories, directoryKey) {
  assertTargetProfileWriteDirectory(targetDirectories, directoryKey, fsModule);
  const before = sourceProfileFileStat(fsModule, sourcePath, maximumBytes, { includeBuffer: true });
  writeExclusiveProfileFile(
    fsModule,
    targetPath,
    before.buffer,
    maximumBytes,
    before.sha256,
    targetDirectories,
    directoryKey,
  );
  assertTargetProfileWriteDirectory(targetDirectories, directoryKey, fsModule);
  const after = sourceProfileFileStat(fsModule, sourcePath, maximumBytes);
  compareSourceFileStat(before, after);
  return before;
}

function captureSavedProfileSnapshot(sourceRoot, fsModule) {
  const configDirectory = path.join(sourceRoot.path, PROVIDER_CONFIG_DIRECTORY_NAME);
  const secretsDirectory = path.join(sourceRoot.path, PROVIDER_SECRETS_DIRECTORY_NAME);
  const directories = Object.freeze({
    config: captureSourceDirectory(fsModule, configDirectory),
    root: captureSourceDirectory(fsModule, sourceRoot.path),
    secrets: captureSourceDirectory(fsModule, secretsDirectory),
  });
  readExactDirectoryNames(fsModule, configDirectory, [PROVIDER_CONFIG_CURRENT_FILE_NAME]);
  const secretNames = readSecretDirectoryNames(fsModule, secretsDirectory);
  const files = new Map();
  files.set(
    LOCAL_STATE_FILE_NAME,
    sourceProfileFileStat(fsModule, path.join(sourceRoot.path, LOCAL_STATE_FILE_NAME), LOCAL_STATE_MAX_BYTES),
  );
  files.set(
    `${PROVIDER_CONFIG_DIRECTORY_NAME}/${PROVIDER_CONFIG_CURRENT_FILE_NAME}`,
    sourceProfileFileStat(
      fsModule,
      path.join(configDirectory, PROVIDER_CONFIG_CURRENT_FILE_NAME),
      PROVIDER_CONFIG_MAX_BYTES,
    ),
  );
  for (const name of secretNames) {
    files.set(
      `${PROVIDER_SECRETS_DIRECTORY_NAME}/${name}`,
      sourceProfileFileStat(fsModule, path.join(secretsDirectory, name), PROVIDER_SECRET_MAX_BYTES),
    );
  }
  return Object.freeze({ directories, files, secretNames });
}

function assertSavedProfileUnchanged(snapshot, sourceRoot, fsModule) {
  const current = captureSavedProfileSnapshot(sourceRoot, fsModule);
  compareSourceDirectoryIdentity(snapshot.directories.root, current.directories.root);
  compareSourceDirectoryIdentity(snapshot.directories.config, current.directories.config);
  compareSourceDirectoryIdentity(snapshot.directories.secrets, current.directories.secrets);
  if (current.files.size !== snapshot.files.size) savedProfileError();
  for (const [name, before] of snapshot.files) {
    const after = current.files.get(name);
    if (!after) savedProfileError();
    compareSourceFileStat(before, after);
  }
}

function copySavedProviderProfile(input, userDataRoot, fsModule = fs) {
  if (input.mode !== 'saved_profile') return null;
  const sourceRoot = captureSourceUserDataRoot(input.source_user_data_path, fsModule);
  const snapshot = captureSavedProfileSnapshot(sourceRoot, fsModule);
  const targetConfigDirectory = path.join(userDataRoot.path, PROVIDER_CONFIG_DIRECTORY_NAME);
  const targetSecretsDirectory = path.join(userDataRoot.path, PROVIDER_SECRETS_DIRECTORY_NAME);
  makeDirectory(fsModule, targetConfigDirectory);
  makeDirectory(fsModule, targetSecretsDirectory);
  const targetDirectories = captureTargetProfileDirectories(
    userDataRoot,
    targetConfigDirectory,
    targetSecretsDirectory,
    fsModule,
  );
  copyProfileFile(
    fsModule,
    path.join(sourceRoot.path, LOCAL_STATE_FILE_NAME),
    path.join(userDataRoot.path, LOCAL_STATE_FILE_NAME),
    LOCAL_STATE_MAX_BYTES,
    targetDirectories,
    'root',
  );
  copyProfileFile(
    fsModule,
    path.join(sourceRoot.path, PROVIDER_CONFIG_DIRECTORY_NAME, PROVIDER_CONFIG_CURRENT_FILE_NAME),
    path.join(targetConfigDirectory, PROVIDER_CONFIG_CURRENT_FILE_NAME),
    PROVIDER_CONFIG_MAX_BYTES,
    targetDirectories,
    'config',
  );
  for (const name of snapshot.secretNames) {
    copyProfileFile(
      fsModule,
      path.join(sourceRoot.path, PROVIDER_SECRETS_DIRECTORY_NAME, name),
      path.join(targetSecretsDirectory, name),
      PROVIDER_SECRET_MAX_BYTES,
      targetDirectories,
      'secrets',
    );
  }
  assertTargetProfileDirectoriesUnchanged(targetDirectories, fsModule);
  return Object.freeze({ sourceRoot, snapshot });
}

function sanitizeLaunchEnvironment(sourceEnv, userDataPath) {
  const output = {};
  let descriptors;
  try {
    if (isObjectProxy(sourceEnv)) fail('canary_launch_failed');
    descriptors = Object.getOwnPropertyDescriptors(sourceEnv);
  } catch {
    fail('canary_launch_failed');
  }
  for (const allowedName of WINDOWS_ENV_ALLOWLIST) {
    const descriptorKey = Reflect.ownKeys(descriptors).find((key) => (
      typeof key === 'string'
      && key.toLowerCase() === allowedName.toLowerCase()
    ));
    if (descriptorKey === undefined) continue;
    const descriptor = descriptors[descriptorKey];
    if (
      !descriptor
      || !descriptor.enumerable
      || 'get' in descriptor
      || 'set' in descriptor
      || typeof descriptor.value !== 'string'
      || descriptor.value.includes('\0')
    ) continue;
    output[allowedName] = descriptor.value;
  }
  output[PACKAGED_CANARY_SENTINEL] = '1';
  output[PACKAGED_CANARY_USER_DATA_PATH] = userDataPath;
  return Object.freeze(output);
}

function sanitizeRunOptions(value) {
  if (value === undefined) return Object.freeze({});
  if (value === null || typeof value !== 'object' || Array.isArray(value) || isObjectProxy(value)) {
    fail('canary_launch_failed');
  }
  let keys;
  let descriptors;
  try {
    keys = Reflect.ownKeys(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    fail('canary_launch_failed');
  }
  if (keys.some((key) => typeof key !== 'string' || !RUN_OPTION_KEYS.includes(key))) {
    fail('canary_launch_failed');
  }
  const output = {};
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || !descriptor.enumerable || 'get' in descriptor || 'set' in descriptor) {
      fail('canary_launch_failed');
    }
    output[key] = descriptor.value;
  }
  return Object.freeze(output);
}

async function clickByRole(page, role, name) {
  const locator = page.getByRole(role, { name });
  await locator.click();
}

async function waitForGenerationTerminal(page) {
  const preview = page.locator(SELECTORS.preview).waitFor({ state: 'visible' })
    .then(() => 'preview', () => 'preview_timeout');
  const alert = page.getByRole('alert').waitFor({ state: 'visible' })
    .then(() => 'alert', () => 'alert_unavailable');
  const outcome = await Promise.race([alert, preview]);
  if (outcome === 'preview') return;
  if (outcome === 'alert') fail('canary_generation_terminal_failed');
  fail('canary_preview_failed');
}

async function fillProviderSettingsViaUi(page, provider, gate) {
  try {
    await clickByRole(page, 'button', 'Settings');
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError) throw error;
    fail('canary_settings_navigation_failed');
  }
  try {
    await page.locator(SELECTORS.providerPanel).waitFor({ state: 'visible' });
    await page.locator(SELECTORS.baseUrl).fill(provider.base_url);
    await page.locator(SELECTORS.model).fill(provider.model);
    await page.locator(SELECTORS.apiKey).fill(provider.credential);
    await page.locator(SELECTORS.timeout).fill(String(provider.timeout_ms));
    await page.locator(SELECTORS.temperature).fill(provider.temperature === null ? '' : String(provider.temperature));
    await page.locator(SELECTORS.maxTokens).fill(provider.max_tokens === null ? '' : String(provider.max_tokens));
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError) throw error;
    fail('canary_settings_panel_failed');
  }
  try {
    await clickByRole(page, 'button', 'Save provider');
    await page.getByText('Provider settings saved.').waitFor({ state: 'visible' });
    await page.locator(SELECTORS.apiKey).waitFor({ state: 'visible' });
    const passwordValue = await page.locator(SELECTORS.apiKey).inputValue();
    if (passwordValue !== '') fail('canary_settings_save_failed');
    gate.allow();
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError) throw error;
    fail('canary_settings_save_failed');
  }
}

async function generateProjectViaUi(page, idea) {
  try {
    await clickByRole(page, 'button', 'New project');
    await page.locator(SELECTORS.projectPage).waitFor({ state: 'visible' });
    await page.locator(SELECTORS.idea).fill(idea);
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError) throw error;
    fail('canary_new_project_failed');
  }
  try {
    await clickByRole(page, 'button', 'Make it');
    await waitForGenerationTerminal(page);
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError) throw error;
    fail('canary_generation_terminal_failed');
  }
  try {
    await page.getByText('Version 1').waitFor({ state: 'visible' });
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError) throw error;
    fail('canary_version_failed');
  }
}

async function readOnlyBridgeEvidence(page, projectId = null) {
  try {
    return await page.evaluate(async (request) => {
      const bridge = globalThis.clawfabricBuilder;
      const status = await bridge.providerSettings.status();
      const catalog = await bridge.projectCatalog.listCurrent();
      const current = request.projectId === null
        ? null
        : await bridge.projectRevisions.loadCurrent({ project_id: request.projectId });
      return { catalog, current, status };
    }, { projectId });
  } catch {
    fail('canary_read_evidence_failed');
  }
}

async function readSanitizedBridgeEvidence(page, projectId = null) {
  try {
    return assertReadEvidence(await readOnlyBridgeEvidence(page, projectId));
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError && error.code === 'canary_read_evidence_failed') {
      throw error;
    }
    fail('canary_read_evidence_failed');
  }
}

function assertReadEvidence(value) {
  const evidenceDescriptors = exactDataObject(value, READ_EVIDENCE_KEYS);
  const status = sanitizeStatus(evidenceDescriptors.status.value);
  const catalog = sanitizeCatalog(evidenceDescriptors.catalog.value);
  const current = evidenceDescriptors.current.value === null
    ? null
    : sanitizeCurrent(evidenceDescriptors.current.value);
  return Object.freeze({ catalog, current, status });
}

function sanitizeStatus(value) {
  const descriptors = exactDataObject(value, STATUS_KEYS);
  const statusVersion = descriptors.status_version.value;
  const configured = descriptors.configured.value;
  const credentialStatus = descriptors.credential_status.value;
  const configDigest = descriptors.config_digest.value;
  if (
    statusVersion !== 'builder-provider-settings-status.v1'
    || configured !== true
    || credentialStatus !== 'stored'
    || typeof configDigest !== 'string'
    || !DIGEST_PATTERN.test(configDigest)
  ) fail('canary_evidence_failed');
  return Object.freeze({
    config_digest: configDigest,
    configured,
    credential_status: credentialStatus,
    status_version: statusVersion,
  });
}

function sanitizeCatalog(value) {
  const descriptors = exactDataObject(value, CATALOG_RESULT_KEYS);
  const resultVersion = descriptors.result_version.value;
  const projects = descriptors.projects.value;
  if (
    resultVersion !== 'builder-project-catalog-result.v1'
    || !Array.isArray(projects)
    || isObjectProxy(projects)
  ) fail('canary_evidence_failed');
  let projectDescriptors;
  try {
    const keys = Reflect.ownKeys(projects);
    const expectedKeys = ['length'];
    for (let index = 0; index < projects.length; index += 1) expectedKeys.push(String(index));
    if (
      keys.length !== expectedKeys.length
      || keys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))
    ) fail('canary_evidence_failed');
    projectDescriptors = Object.getOwnPropertyDescriptors(projects);
    const lengthDescriptor = projectDescriptors.length;
    if (
      !lengthDescriptor
      || lengthDescriptor.enumerable !== false
      || !Object.hasOwn(lengthDescriptor, 'value')
      || lengthDescriptor.value !== projects.length
    ) fail('canary_evidence_failed');
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError) throw error;
    fail('canary_evidence_failed');
  }
  const sanitizedProjects = [];
  for (let index = 0; index < projects.length; index += 1) {
    const descriptor = projectDescriptors[String(index)];
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      fail('canary_evidence_failed');
    }
    sanitizedProjects.push(sanitizeCatalogProject(descriptor.value));
  }
  return Object.freeze({
    catalog_evidence: descriptors.catalog_evidence.value,
    projects: Object.freeze(sanitizedProjects),
    result_version: resultVersion,
  });
}

function sanitizeCatalogProject(value) {
  const descriptors = exactDataObject(value, CATALOG_PROJECT_KEYS);
  const project = Object.freeze({
    project_id: safeProjectId(descriptors.project_id.value),
    revision: descriptors.revision.value,
    revision_digest: descriptors.revision_digest.value,
    summary: descriptors.summary.value,
    title: descriptors.title.value,
  });
  if (
    project.revision !== 1
    || typeof project.revision_digest !== 'string'
    || !DIGEST_PATTERN.test(project.revision_digest)
    || typeof project.summary !== 'string'
    || typeof project.title !== 'string'
  ) fail('canary_evidence_failed');
  return project;
}

function safeProjectId(value) {
  if (
    typeof value !== 'string'
    || value.length !== PROJECT_ID_LENGTH
    || !PROJECT_ID_PATTERN.test(value)
  ) fail('canary_evidence_failed');
  return value;
}

function sanitizeHead(value, expectedProject) {
  const descriptors = exactDataObject(value, HEAD_KEYS);
  const head = Object.freeze({
    head_digest: descriptors.head_digest.value,
    project_id: safeProjectId(descriptors.project_id.value),
    record_kind: descriptors.record_kind.value,
    revision: descriptors.revision.value,
    revision_digest: descriptors.revision_digest.value,
    schema_version: descriptors.schema_version.value,
  });
  if (
    head.schema_version !== 1
    || head.record_kind !== 'builder_project_head'
    || head.project_id !== expectedProject.project_id
    || head.revision !== expectedProject.revision
    || head.revision_digest !== expectedProject.revision_digest
    || typeof head.head_digest !== 'string'
    || !DIGEST_PATTERN.test(head.head_digest)
  ) fail('canary_evidence_failed');
  return head;
}

function sanitizeProjectRecord(value) {
  const descriptors = exactDataObject(value, PROJECT_RECORD_KEYS);
  const record = Object.freeze({
    execution_admission: descriptors.execution_admission.value,
    files: descriptors.files.value,
    parent_revision: descriptors.parent_revision.value,
    preview_script_admission: descriptors.preview_script_admission.value,
    project_id: safeProjectId(descriptors.project_id.value),
    proposal_evidence: descriptors.proposal_evidence.value,
    record_kind: descriptors.record_kind.value,
    revision: descriptors.revision.value,
    revision_digest: descriptors.revision_digest.value,
    schema_version: descriptors.schema_version.value,
    summary: descriptors.summary.value,
    title: descriptors.title.value,
  });
  if (
    record.schema_version !== 1
    || record.record_kind !== 'builder_project_revision'
    || record.revision !== 1
    || typeof record.revision_digest !== 'string'
    || !DIGEST_PATTERN.test(record.revision_digest)
    || record.parent_revision !== null
    || typeof record.title !== 'string'
    || typeof record.summary !== 'string'
    || record.files === null
    || typeof record.files !== 'object'
    || record.proposal_evidence === null
    || typeof record.proposal_evidence !== 'object'
    || record.execution_admission !== 'not_evaluated'
    || record.preview_script_admission !== 'not_authorized'
  ) fail('canary_evidence_failed');
  return record;
}

function sanitizeCurrent(value) {
  const descriptors = exactDataObject(value, CURRENT_RESULT_KEYS);
  const record = sanitizeProjectRecord(descriptors.record.value);
  const current = Object.freeze({
    head: sanitizeHead(descriptors.head.value, record),
    persistence_evidence: descriptors.persistence_evidence.value,
    record,
    restart_restore: descriptors.restart_restore.value,
    result_version: descriptors.result_version.value,
  });
  if (
    current.result_version !== 'builder-project-repository-result.v1'
    || current.restart_restore !== true
    || current.persistence_evidence === null
    || typeof current.persistence_evidence !== 'object'
  ) fail('canary_evidence_failed');
  return current;
}

function projectFromCatalog(evidence) {
  const catalog = assertReadEvidence(evidence).catalog;
  if (catalog.projects.length !== 1) fail('canary_evidence_failed');
  const project = catalog.projects[0];
  if (
    project === null
    || typeof project !== 'object'
    || typeof project.project_id !== 'string'
    || project.revision !== 1
    || typeof project.revision_digest !== 'string'
    || !DIGEST_PATTERN.test(project.revision_digest)
  ) fail('canary_evidence_failed');
  return project;
}

function projectFromReadEvidence(evidence) {
  try {
    return projectFromCatalog(evidence);
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError) fail('canary_read_evidence_failed');
    throw error;
  }
}

function assertExactRevision(evidence, expectedProject) {
  const sanitized = assertReadEvidence(evidence);
  const current = sanitized.current;
  if (
    current === null
    || current.record.project_id !== expectedProject.project_id
    || current.record.revision !== 1
    || current.record.revision_digest !== expectedProject.revision_digest
  ) fail('canary_evidence_failed');
  return current.record;
}

function exactRevisionFromReadEvidence(evidence, expectedProject) {
  try {
    return assertExactRevision(evidence, expectedProject);
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError) fail('canary_read_evidence_failed');
    throw error;
  }
}

function networkRecorder() {
  const unexpected = [];
  let attachedApplicationCount = 0;
  function observe(request) {
    const url = request.url();
    if (!/^(?:https?|wss?):/iu.test(url)) return;
    unexpected.push(true);
  }
  return Object.freeze({
    attachApplication(app) {
      if (app === null || typeof app !== 'object' || typeof app.context !== 'function') return false;
      let context;
      try {
        context = app.context();
      } catch {
        return false;
      }
      if (context === null || typeof context !== 'object' || typeof context.on !== 'function') return false;
      context.on('request', observe);
      attachedApplicationCount += 1;
      return true;
    },
    attachPage(page) {
      page.on('request', observe);
    },
    snapshot() {
      return Object.freeze({
        application_observer_count: attachedApplicationCount,
        unexpected_network_count: unexpected.length,
      });
    },
  });
}

function summarizePng(buffer, pngModule = PNG) {
  let image;
  try {
    image = pngModule.sync.read(buffer);
  } catch {
    fail('canary_evidence_failed');
  }
  let coloredPixels = 0;
  const colors = new Set();
  for (let offset = 0; offset < image.data.length; offset += 4) {
    const alpha = image.data[offset + 3];
    if (alpha === 0) continue;
    const red = image.data[offset];
    const green = image.data[offset + 1];
    const blue = image.data[offset + 2];
    colors.add(`${red},${green},${blue},${alpha}`);
    if (!(red > 248 && green > 248 && blue > 248)) coloredPixels += 1;
  }
  if (colors.size < 2 || coloredPixels < 16) fail('canary_evidence_failed');
  return Object.freeze({
    colored_pixels: coloredPixels,
    height: image.height,
    pixel_digest: digestText(buffer),
    unique_colors: colors.size,
    width: image.width,
  });
}

async function capturePreviewEvidence(page, gate) {
  try {
    gate.assertAllowed();
    const section = page.locator(SELECTORS.preview);
    await section.waitFor({ state: 'visible' });
    const frame = page.locator(SELECTORS.previewFrame);
    await frame.waitFor({ state: 'visible' });
    const sandbox = await frame.getAttribute('sandbox');
    const srcdoc = await frame.getAttribute('srcdoc');
    if (
      sandbox !== ''
      || typeof srcdoc !== 'string'
      || !/Content-Security-Policy/iu.test(srcdoc)
      || !/script-src 'none'/iu.test(srcdoc)
    ) fail('canary_preview_failed');
    const body = frame.contentFrame().locator('body');
    const bodyText = await body.innerText();
    if (typeof bodyText !== 'string' || bodyText.trim().length === 0) fail('canary_preview_failed');
    const screenshot = await frame.screenshot();
    return Object.freeze({
      ...summarizePng(screenshot),
      frame_body_nonempty: true,
      sandbox: 'empty',
      script_src: 'none',
      srcdoc_digest: digestText(srcdoc),
    });
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError
      && error.code === 'canary_secret_source_invalid') throw error;
    fail('canary_preview_failed');
  }
}

async function openProjectFromCatalogById(page, project) {
  try {
    const projectId = safeProjectId(project.project_id);
    const catalog = page.locator(SELECTORS.projectCatalog);
    await catalog.waitFor({ state: 'visible' });
    const projectButton = catalog.locator(`button${attributeEqualsSelector('data-builder-project-id', projectId)}`);
    await projectButton.waitFor({ state: 'visible' });
    await projectButton.getByText(project.title, { exact: true }).waitFor({ state: 'visible' });
    await projectButton.getByText(project.summary, { exact: true }).waitFor({ state: 'visible' });
    await projectButton.getByText(`Version ${project.revision}`, { exact: true }).waitFor({ state: 'visible' });
    await projectButton.click();
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError) throw error;
    fail('canary_restart_failed');
  }
}

async function assertCustomChromeControls(page) {
  try {
    const minimize = page.getByRole('button', { name: 'Minimize window' });
    const maximizeOrRestore = page.getByRole('button', { name: /^(?:Maximize|Restore) window$/u });
    const close = page.getByRole('button', { name: 'Close window' });
    await minimize.waitFor({ state: 'visible' });
    await maximizeOrRestore.waitFor({ state: 'visible' });
    await close.waitFor({ state: 'visible' });
    if (
      typeof minimize.isEnabled !== 'function'
      || typeof maximizeOrRestore.isEnabled !== 'function'
      || typeof close.isEnabled !== 'function'
      || await minimize.isEnabled() !== true
      || await maximizeOrRestore.isEnabled() !== true
      || await close.isEnabled() !== true
    ) fail('canary_custom_chrome_failed');
    return Object.freeze({
      close_enabled: true,
      maximize_or_restore_enabled: true,
      minimize_enabled: true,
      window_controls_enabled: true,
    });
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError) throw error;
    fail('canary_custom_chrome_failed');
  }
}

function makeTempUserData(fsModule = fs, osModule = os) {
  return fsModule.mkdtempSync(path.join(osModule.tmpdir(), PACKAGED_CANARY_USER_DATA_PREFIX));
}

function removeDirectory(rootIdentity, fsModule = fs, osModule = os) {
  if (!rootIdentity) return;
  reverifyGuardedUserDataRoot(rootIdentity, fsModule, osModule);
  fsModule.rmSync(rootIdentity.path, { force: true, recursive: true });
}

function removeRawTempUserDataPath(rawPath, fsModule = fs, osModule = os) {
  if (
    typeof rawPath !== 'string'
    || rawPath.length === 0
    || rawPath.trim() !== rawPath
    || rawPath.includes('\0')
    || !path.isAbsolute(rawPath)
    || path.normalize(rawPath) !== rawPath
    || path.resolve(rawPath) !== rawPath
  ) return;
  const tempRoot = path.resolve(osModule.tmpdir());
  if (path.dirname(rawPath) !== tempRoot || !path.basename(rawPath).startsWith(PACKAGED_CANARY_USER_DATA_PREFIX)) {
    return;
  }
  try {
    const root = captureGuardedUserDataRoot(rawPath, fsModule, osModule);
    removeDirectory(root, fsModule, osModule);
    return;
  } catch {
    // Fall back only for the direct mkdtemp path when lstat still proves a plain directory.
  }
  try {
    const stat = fsModule.lstatSync(rawPath, { bigint: true });
    if (!stat.isDirectory() || stat.isSymbolicLink()) return;
    fsModule.rmSync(rawPath, { force: true, recursive: true });
  } catch {
    // Cleanup is best-effort before a trusted root identity exists.
  }
}

function attachApplicationNetworkRecorder(recorder, app) {
  return recorder.attachApplication(app) === true;
}

async function launchApp({ electron, executablePath, userDataPath, env }) {
  try {
    return await electron.launch({
      args: [],
      executablePath,
      env: sanitizeLaunchEnvironment(env, userDataPath),
    });
  } catch {
    fail('canary_launch_failed');
  }
}

async function closeApp(app) {
  if (!app) return;
  await app.close();
}

async function runPackagedCanary(rawInput, options = {}) {
  let app = null;
  let electron = defaultElectron;
  let env = process.env;
  let fsModule = fs;
  let gate = null;
  let input = null;
  let osModule = os;
  let primaryError = null;
  let result = null;
  let savedProfile = null;
  let rawUserDataPath = null;
  let recorder = null;
  let userDataRoot = null;
  try {
    input = sanitizeInput(rawInput);
    const runOptions = sanitizeRunOptions(options);
    electron = runOptions.electron ?? defaultElectron;
    fsModule = runOptions.fs ?? fs;
    osModule = runOptions.os ?? os;
    env = runOptions.env ?? process.env;
    const argv = runOptions.argv ?? process.argv.slice(2);
    rawUserDataPath = runOptions.userDataPath ?? makeTempUserData(fsModule, osModule);
    userDataRoot = captureGuardedUserDataRoot(rawUserDataPath, fsModule, osModule);
    gate = createArtifactGate();
    savedProfile = copySavedProviderProfile(input, userDataRoot, fsModule);
    if (input.mode !== 'saved_profile') {
      ensureCredentialOnlyFromStdin(input.provider.credential, argv, env);
    }
    let executableExists = false;
    try {
      executableExists = fsModule.existsSync(input.executable_path);
    } catch {
      fail('canary_launch_failed');
    }
    if (!executableExists) fail('canary_launch_failed');

    recorder = networkRecorder();
    app = await launchApp({ electron, env, executablePath: input.executable_path, userDataPath: userDataRoot.path });
    const applicationObserver = attachApplicationNetworkRecorder(recorder, app);
    const page = await app.firstWindow();
    if (applicationObserver !== true) recorder.attachPage(page);
    const customChrome = await assertCustomChromeControls(page);
    if (input.mode !== 'saved_profile') {
      await fillProviderSettingsViaUi(page, input.provider, gate);
    } else {
      await readSanitizedBridgeEvidence(page);
      gate.allow();
    }
    await generateProjectViaUi(page, input.idea);
    const firstEvidence = await readSanitizedBridgeEvidence(page);
    const project = projectFromReadEvidence(firstEvidence);
    const currentEvidence = await readSanitizedBridgeEvidence(page, project.project_id);
    const revision = exactRevisionFromReadEvidence(currentEvidence, project);
    const firstPreviewEvidence = await capturePreviewEvidence(page, gate);
    await closeApp(app);
    app = null;

    app = await launchApp({ electron, env, executablePath: input.executable_path, userDataPath: userDataRoot.path });
    const restartApplicationObserver = attachApplicationNetworkRecorder(recorder, app);
    const restartedPage = await app.firstWindow();
    if (restartApplicationObserver !== true) recorder.attachPage(restartedPage);
    await assertCustomChromeControls(restartedPage);
    await openProjectFromCatalogById(restartedPage, revision);
    try {
      await restartedPage.locator(SELECTORS.preview).waitFor({ state: 'visible' });
    } catch (error) {
      if (error instanceof BuilderPackagedCanaryError) throw error;
      fail('canary_restart_failed');
    }
    try {
      await restartedPage.getByText('Version 1').waitFor({ state: 'visible' });
    } catch (error) {
      if (error instanceof BuilderPackagedCanaryError) throw error;
      fail('canary_version_failed');
    }
    const restartEvidence = await readSanitizedBridgeEvidence(restartedPage, project.project_id);
    try {
      assertExactRevision(restartEvidence, project);
    } catch (error) {
      if (error instanceof BuilderPackagedCanaryError) fail('canary_restart_failed');
      throw error;
    }
    const restartProject = projectFromReadEvidence(restartEvidence);
    const restartPreviewEvidence = await capturePreviewEvidence(restartedPage, gate);
    const network = recorder.snapshot();
    if (network.unexpected_network_count !== 0) fail('canary_evidence_failed');
    const restartRevisionUnchanged = (
      restartEvidence.catalog.projects.length === firstEvidence.catalog.projects.length
      && restartProject.project_id === project.project_id
      && restartProject.revision === project.revision
      && restartProject.revision_digest === project.revision_digest
      && restartPreviewEvidence.srcdoc_digest === firstPreviewEvidence.srcdoc_digest
    );
    if (!restartRevisionUnchanged) fail('canary_evidence_failed');

    result = Object.freeze({
      result_version: CANARY_RESULT_VERSION,
      artifacts_after_password_clear: gate.allowed,
      custom_chrome: customChrome,
      input: redactInput(input),
      network,
      preview: Object.freeze({
        first: firstPreviewEvidence,
        restart: restartPreviewEvidence,
        restart_srcdoc_unchanged: true,
      }),
      project: Object.freeze({
        catalog_project_count: firstEvidence.catalog.projects.length,
        restart_catalog_project_count: restartEvidence.catalog.projects.length,
        restart_new_revision_observed: false,
        restart_revision_unchanged: true,
        project_id: project.project_id,
        restart_restored: true,
        revision: 1,
        revision_digest: project.revision_digest,
      }),
      safe_storage: Object.freeze({
        credential_status: restartEvidence.status.credential_status,
        configured: restartEvidence.status.configured,
      }),
      user_data: Object.freeze({
        ...(input.mode === 'saved_profile' ? { source_profile_unchanged: true } : {}),
        temporary: true,
      }),
    });
  } catch (error) {
    primaryError = fixedError(error);
  }

  const cleanupErrors = [];
  try {
    await closeApp(app);
  } catch {
    cleanupErrors.push(new BuilderPackagedCanaryError('canary_cleanup_failed'));
  }
  try {
    if (savedProfile !== null) {
      assertSavedProfileUnchanged(savedProfile.snapshot, savedProfile.sourceRoot, fsModule);
    }
  } catch {
    cleanupErrors.push(new BuilderPackagedCanaryError('canary_saved_profile_failed'));
  }
  try {
    if (userDataRoot !== null) {
      removeDirectory(userDataRoot, fsModule, osModule);
    } else {
      removeRawTempUserDataPath(rawUserDataPath, fsModule, osModule);
    }
  } catch {
    cleanupErrors.push(new BuilderPackagedCanaryError('canary_cleanup_failed'));
  }
  if (primaryError !== null && primaryError.code === 'canary_saved_profile_failed') throw primaryError;
  if (cleanupErrors.length > 0) throw cleanupErrors[0];
  if (primaryError !== null) throw primaryError;
  return result;
}

function readStdin(stream = process.stdin, maxBytes = STDIN_MAX_BYTES) {
  return new Promise((resolve, reject) => {
    let body = '';
    let bytes = 0;
    let settled = false;
    const rejectFixed = () => {
      if (settled) return;
      settled = true;
      reject(new BuilderPackagedCanaryError('canary_input_invalid'));
    };
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      if (settled) return;
      bytes += Buffer.byteLength(chunk, 'utf8');
      if (bytes > maxBytes) {
        rejectFixed();
        if (typeof stream.destroy === 'function') stream.destroy();
        return;
      }
      body += chunk;
    });
    stream.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(body);
    });
    stream.on('error', () => rejectFixed());
  });
}

async function runCli({
  argv = process.argv.slice(2),
  stdin = process.stdin,
  stdout = process.stdout,
  run = runPackagedCanary,
} = {}) {
  if (!Array.isArray(argv) || argv.length !== 1 || argv[0] !== '--execute') {
    fail('canary_input_invalid');
  }
  const result = await run(parseCanaryInput(await readStdin(stdin)));
  stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

async function main() {
  await runCli();
}

module.exports = {
  BuilderPackagedCanaryError,
  CANARY_INPUT_VERSION,
  CANARY_RESULT_VERSION,
  PACKAGED_CANARY_SENTINEL,
  PACKAGED_CANARY_USER_DATA_PATH,
  PACKAGED_CANARY_USER_DATA_PREFIX,
  SELECTORS,
  assertCustomChromeControls,
  assertExactRevision,
  assertReadEvidence,
  captureGuardedUserDataRoot,
  capturePreviewEvidence,
  copySavedProviderProfile,
  createArtifactGate,
  ensureCredentialOnlyFromStdin,
  fillProviderSettingsViaUi,
  generateProjectViaUi,
  networkRecorder,
  openProjectFromCatalogById,
  parseCanaryInput,
  readStdin,
  readOnlyBridgeEvidence,
  readSanitizedBridgeEvidence,
  runCli,
  runPackagedCanary,
  sanitizeInput,
  sanitizeLaunchEnvironment,
  summarizePng,
  waitForGenerationTerminal,
};

if (require.main === module) {
  main().catch((error) => {
    const code = error instanceof BuilderPackagedCanaryError
      ? error.code
      : 'canary_evidence_failed';
    const stage = Object.hasOwn(ERROR_STAGES, code)
      ? ERROR_STAGES[code]
      : ERROR_STAGES.canary_evidence_failed;
    process.stderr.write(`${JSON.stringify({
      ok: false,
      code,
      message: Object.hasOwn(ERROR_MESSAGES, code)
        ? ERROR_MESSAGES[code]
        : ERROR_MESSAGES.canary_evidence_failed,
      stage,
    })}\n`);
    process.exitCode = 1;
  });
}
