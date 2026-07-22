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
const DEFAULT_EXECUTABLE = path.join(__dirname, '..', 'release', 'win-unpacked', 'ClawFabric Builder.exe');
const STDIN_MAX_BYTES = 128 * 1024;
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
  canary_evidence_failed: 'Packaged canary evidence could not be verified.',
  canary_cleanup_failed: 'Packaged canary cleanup failed.',
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

class BuilderPackagedCanaryError extends Error {
  constructor(code = 'canary_evidence_failed') {
    const selected = Object.hasOwn(ERROR_MESSAGES, code) ? code : 'canary_evidence_failed';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderPackagedCanaryError';
    this.code = selected;
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

function sanitizeInput(value) {
  const descriptors = exactObject(value, [
    'executable_path',
    'idea',
    'provider',
    'schema_version',
  ]);
  if (descriptors.schema_version.value !== CANARY_INPUT_VERSION) fail('canary_input_invalid');
  const executablePath = descriptors.executable_path.value === null
    ? DEFAULT_EXECUTABLE
    : text(descriptors.executable_path.value, 2_048);
  if (
    !path.isAbsolute(executablePath)
    || path.normalize(executablePath) !== executablePath
    || path.resolve(executablePath) !== executablePath
  ) {
    fail('canary_input_invalid');
  }
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
  return Object.freeze({
    credential_source: 'stdin',
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

async function fillProviderSettingsViaUi(page, provider, gate) {
  try {
    await clickByRole(page, 'button', 'Settings');
    await page.locator(SELECTORS.providerPanel).waitFor({ state: 'visible' });
    await page.locator(SELECTORS.baseUrl).fill(provider.base_url);
    await page.locator(SELECTORS.model).fill(provider.model);
    await page.locator(SELECTORS.apiKey).fill(provider.credential);
    await page.locator(SELECTORS.timeout).fill(String(provider.timeout_ms));
    await page.locator(SELECTORS.temperature).fill(provider.temperature === null ? '' : String(provider.temperature));
    await page.locator(SELECTORS.maxTokens).fill(provider.max_tokens === null ? '' : String(provider.max_tokens));
    await clickByRole(page, 'button', 'Save provider');
    await page.getByText('Provider settings saved.').waitFor({ state: 'visible' });
    await page.locator(SELECTORS.apiKey).waitFor({ state: 'visible' });
    const passwordValue = await page.locator(SELECTORS.apiKey).inputValue();
    if (passwordValue !== '') fail('canary_ui_failed');
    gate.allow();
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError) throw error;
    fail('canary_ui_failed');
  }
}

async function generateProjectViaUi(page, idea) {
  try {
    await clickByRole(page, 'button', 'New project');
    await page.locator(SELECTORS.projectPage).waitFor({ state: 'visible' });
    await page.locator(SELECTORS.idea).fill(idea);
    await clickByRole(page, 'button', 'Make it');
    await page.locator(SELECTORS.preview).waitFor({ state: 'visible' });
    await page.getByText('Version 1').waitFor({ state: 'visible' });
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError) throw error;
    fail('canary_ui_failed');
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
    fail('canary_evidence_failed');
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
    project_id: descriptors.project_id.value,
    revision: descriptors.revision.value,
    revision_digest: descriptors.revision_digest.value,
    summary: descriptors.summary.value,
    title: descriptors.title.value,
  });
  if (
    typeof project.project_id !== 'string'
    || project.revision !== 1
    || typeof project.revision_digest !== 'string'
    || !DIGEST_PATTERN.test(project.revision_digest)
    || typeof project.summary !== 'string'
    || typeof project.title !== 'string'
  ) fail('canary_evidence_failed');
  return project;
}

function sanitizeHead(value, expectedProject) {
  const descriptors = exactDataObject(value, HEAD_KEYS);
  const head = Object.freeze({
    head_digest: descriptors.head_digest.value,
    project_id: descriptors.project_id.value,
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
    project_id: descriptors.project_id.value,
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
    || typeof record.project_id !== 'string'
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

function networkRecorder() {
  const unexpected = [];
  return Object.freeze({
    attach(page) {
      page.on('request', (request) => {
        const url = request.url();
        if (!/^(?:https?|wss?):/iu.test(url)) return;
        unexpected.push(true);
      });
    },
    snapshot() {
      return Object.freeze({
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
  ) fail('canary_evidence_failed');
  const body = frame.contentFrame().locator('body');
  const bodyText = await body.innerText();
  if (typeof bodyText !== 'string' || bodyText.trim().length === 0) fail('canary_evidence_failed');
  const screenshot = await frame.screenshot();
  return Object.freeze({
    ...summarizePng(screenshot),
    frame_body_nonempty: true,
    sandbox: 'empty',
    script_src: 'none',
    srcdoc_digest: digestText(srcdoc),
  });
}

async function openProjectFromCatalogById(page, project) {
  try {
    const catalog = page.locator(SELECTORS.projectCatalog);
    await catalog.waitFor({ state: 'visible' });
    const projectButton = catalog.locator(`button${attributeEqualsSelector('data-builder-project-id', project.project_id)}`);
    await projectButton.waitFor({ state: 'visible' });
    await projectButton.getByText(project.title, { exact: true }).waitFor({ state: 'visible' });
    await projectButton.getByText(project.summary, { exact: true }).waitFor({ state: 'visible' });
    await projectButton.getByText(`Version ${project.revision}`, { exact: true }).waitFor({ state: 'visible' });
    await projectButton.click();
  } catch (error) {
    if (error instanceof BuilderPackagedCanaryError) throw error;
    fail('canary_evidence_failed');
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
  let userDataRoot = null;
  try {
    input = sanitizeInput(rawInput);
    const runOptions = sanitizeRunOptions(options);
    electron = runOptions.electron ?? defaultElectron;
    fsModule = runOptions.fs ?? fs;
    osModule = runOptions.os ?? os;
    env = runOptions.env ?? process.env;
    const argv = runOptions.argv ?? process.argv.slice(2);
    const userDataPath = runOptions.userDataPath ?? makeTempUserData(fsModule, osModule);
    userDataRoot = captureGuardedUserDataRoot(userDataPath, fsModule, osModule);
    gate = createArtifactGate();
    ensureCredentialOnlyFromStdin(input.provider.credential, argv, env);
    let executableExists = false;
    try {
      executableExists = fsModule.existsSync(input.executable_path);
    } catch {
      fail('canary_launch_failed');
    }
    if (!executableExists) fail('canary_launch_failed');

    app = await launchApp({ electron, env, executablePath: input.executable_path, userDataPath: userDataRoot.path });
    const page = await app.firstWindow();
    const recorder = networkRecorder();
    recorder.attach(page);
    await fillProviderSettingsViaUi(page, input.provider, gate);
    await generateProjectViaUi(page, input.idea);
    const firstEvidence = assertReadEvidence(await readOnlyBridgeEvidence(page));
    const project = projectFromCatalog(firstEvidence);
    const currentEvidence = assertReadEvidence(await readOnlyBridgeEvidence(page, project.project_id));
    const revision = assertExactRevision(currentEvidence, project);
    const firstPreviewEvidence = await capturePreviewEvidence(page, gate);
    await closeApp(app);
    app = null;

    app = await launchApp({ electron, env, executablePath: input.executable_path, userDataPath: userDataRoot.path });
    const restartedPage = await app.firstWindow();
    recorder.attach(restartedPage);
    await openProjectFromCatalogById(restartedPage, revision);
    await restartedPage.locator(SELECTORS.preview).waitFor({ state: 'visible' });
    await restartedPage.getByText('Version 1').waitFor({ state: 'visible' });
    const restartEvidence = assertReadEvidence(await readOnlyBridgeEvidence(restartedPage, project.project_id));
    assertExactRevision(restartEvidence, project);
    const restartProject = projectFromCatalog(restartEvidence);
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
        restart_generation_command_issued: false,
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
    removeDirectory(userDataRoot, fsModule, osModule);
  } catch {
    cleanupErrors.push(new BuilderPackagedCanaryError('canary_cleanup_failed'));
  }
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
  assertExactRevision,
  assertReadEvidence,
  captureGuardedUserDataRoot,
  capturePreviewEvidence,
  createArtifactGate,
  ensureCredentialOnlyFromStdin,
  fillProviderSettingsViaUi,
  generateProjectViaUi,
  networkRecorder,
  openProjectFromCatalogById,
  parseCanaryInput,
  readStdin,
  readOnlyBridgeEvidence,
  runCli,
  runPackagedCanary,
  sanitizeInput,
  sanitizeLaunchEnvironment,
  summarizePng,
};

if (require.main === module) {
  main().catch((error) => {
    const code = error instanceof BuilderPackagedCanaryError
      ? error.code
      : 'canary_evidence_failed';
    process.stderr.write(`${JSON.stringify({
      ok: false,
      code,
      message: Object.hasOwn(ERROR_MESSAGES, code)
        ? ERROR_MESSAGES[code]
        : ERROR_MESSAGES.canary_evidence_failed,
    })}\n`);
    process.exitCode = 1;
  });
}
