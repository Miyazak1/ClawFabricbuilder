'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const {
  BuilderProjectSourceTreeError,
  sanitizeBuilderProjectSourceTree,
} = require('./builder-project-source-tree.cjs');

const BUILDER_PROJECT_UNDERSTANDING_SNAPSHOT_VERSION =
  'builder-project-understanding-snapshot.v1';
const BUILDER_COMMAND_PROFILE_VERSION = 'builder-command-profile.v1';
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const PROJECT_ID_PATTERN =
  /^builder-project:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MAX_ENTRYPOINTS = 8;
const MAX_IMPORTANT_PATHS = 16;
const MAX_COMMAND_PROFILES = 8;

const INPUT_KEYS = Object.freeze([
  'project_id',
  'root_digest',
  'source_tree',
  'previous_successful_check_runs',
  'updated_at_ms',
]);
const CHECK_RUN_KEYS = Object.freeze(['command_kind', 'command_display', 'cwd', 'completed_at_ms']);
const SNAPSHOT_KEYS = Object.freeze([
  'snapshot_version',
  'project_id',
  'root_digest',
  'source_tree_digest',
  'detected_stack',
  'package_manager',
  'entrypoints',
  'important_paths',
  'command_profiles',
  'command_profile_ids',
  'unknowns',
  'stale_reason',
  'updated_at_ms',
  'authority',
]);
const COMMAND_PROFILE_KEYS = Object.freeze([
  'command_profile_id',
  'command_profile_version',
  'project_id',
  'source_tree_digest',
  'command_kind',
  'command_display',
  'cwd',
  'confidence',
  'discovered_from',
  'requires_user_approval',
  'risk_class',
]);
const ENTRYPOINT_KEYS = Object.freeze(['path', 'entry_kind', 'confidence', 'discovered_from']);
const IMPORTANT_PATH_KEYS = Object.freeze(['path', 'path_kind', 'reason']);
const AUTHORITY_KEYS = Object.freeze([
  'understanding_authority',
  'source_tree_authority',
  'renderer_authority',
  'ipc_authority',
  'provider_dispatch',
  'tool_dispatch',
  'command_execution',
  'source_read',
  'source_write',
  'git_mutation',
  'permission_grant_authority',
  'revision_admission',
  'secret_access',
  'network_access',
]);
const COMMAND_KINDS = Object.freeze(['lint', 'typecheck', 'test', 'build']);
const DETECTED_STACKS = Object.freeze(['node', 'frontend', 'static_html', 'markdown_text', 'unknown']);
const PACKAGE_MANAGERS = Object.freeze(['npm', 'pnpm', 'yarn', 'bun', 'none']);
const COMMAND_CONFIDENCES = Object.freeze(['manifest_declared', 'verified_previous_success']);
const ENTRYPOINT_KINDS = Object.freeze([
  'node_main',
  'static_html_entry',
  'frontend_main',
  'documentation_entry',
]);
const ENTRYPOINT_CONFIDENCES = Object.freeze(['high', 'manifest_declared', 'manifest_or_file_hint', 'file_hint']);
const IMPORTANT_PATH_KINDS = Object.freeze(['manifest', 'lockfile', 'config', 'documentation', 'entrypoint']);
const UNKNOWNS = Object.freeze(['package_manifest_unreadable', 'no_known_check_commands', 'empty_project']);
const COMMAND_RISK_CLASS = 'read_only_project_check';
const SCRIPT_BY_KIND = Object.freeze({
  lint: 'lint',
  typecheck: 'typecheck',
  test: 'test',
  build: 'build',
});
const KNOWN_IMPORTANT_FILES = Object.freeze([
  'package.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'package-lock.json',
  'bun.lockb',
  'bun.lock',
  'vite.config.ts',
  'vite.config.js',
  'tsconfig.json',
  'README.md',
  'index.html',
]);

class BuilderProjectUnderstandingError extends Error {
  constructor() {
    super('Builder project understanding could not be created.');
    this.name = 'BuilderProjectUnderstandingError';
    this.code = 'builder_project_understanding_invalid';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderProjectUnderstandingError();
}

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freezeDeep(nested);
    Object.freeze(value);
  }
  return value;
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
  const own = Reflect.ownKeys(value);
  if (
    own.length !== keys.length
    || own.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) fail();
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      fail();
    }
  }
}

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  return descriptor.value;
}

function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number' && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(valueAt(value, key))}`
    )).join(',')}}`;
  }
  fail();
}

function sha256Canonical(value) {
  return `sha256:${nodeCrypto.createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')}`;
}

function safeProjectId(value) {
  if (typeof value !== 'string' || value.length !== 52 || !PROJECT_ID_PATTERN.test(value)) fail();
  return value;
}

function safeDigest(value) {
  if (typeof value !== 'string' || value.length !== 71 || !DIGEST_PATTERN.test(value)) fail();
  return value;
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail();
  return value;
}

function hasUnsafeTextControlCharacter(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function hasUnsafePathCharacter(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return /[<>:"|?*]/u.test(value);
}

function safeBoundedText(value, maximum) {
  if (
    typeof value !== 'string'
    || value.length < 1
    || value.length > maximum
    || value.trim() !== value
    || hasUnsafeTextControlCharacter(value)
  ) fail();
  return value;
}

function safeProjectPath(value) {
  if (
    typeof value !== 'string'
    || value.length < 1
    || value.length > 240
    || value.startsWith('/')
    || value.endsWith('/')
    || value.includes('\\')
    || value.includes('..')
    || hasUnsafePathCharacter(value)
  ) fail();
  return value;
}

function safeEnum(value, allowed) {
  if (!allowed.includes(value)) fail();
  return value;
}

function safeArray(value, maximum, itemFn) {
  if (!Array.isArray(value) || utilTypes.isProxy(value) || value.length > maximum) fail();
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key === 'symbol') || keys.length !== value.length + 1) fail();
  const result = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
    result.push(itemFn(descriptor.value));
  }
  return freezeDeep(result);
}

function safeCheckRuns(value) {
  return safeArray(value, 32, (run) => {
    exactObject(run, CHECK_RUN_KEYS);
    const commandKind = valueAt(run, 'command_kind');
    const commandDisplay = valueAt(run, 'command_display');
    const cwd = valueAt(run, 'cwd');
    if (
      !COMMAND_KINDS.includes(commandKind)
      || typeof commandDisplay !== 'string'
      || commandDisplay.length < 1
      || commandDisplay.length > 120
      || commandDisplay.trim() !== commandDisplay
      || typeof cwd !== 'string'
      || cwd !== '.'
    ) fail();
    return {
      command_kind: commandKind,
      command_display: commandDisplay,
      cwd,
      completed_at_ms: safeTimestamp(valueAt(run, 'completed_at_ms')),
    };
  });
}

function sanitizeAuthority(value) {
  exactObject(value, AUTHORITY_KEYS);
  const selected = {};
  for (const key of AUTHORITY_KEYS) selected[key] = valueAt(value, key);
  if (
    selected.understanding_authority !== 'main_owned_project_understanding_contract_v1'
    || selected.source_tree_authority !== 'verified_builder_project_source_tree'
    || selected.renderer_authority !== 'not_present'
    || selected.ipc_authority !== 'not_present'
    || selected.provider_dispatch !== false
    || selected.tool_dispatch !== false
    || selected.command_execution !== false
    || selected.source_read !== 'provided_snapshot_only'
    || selected.source_write !== 'not_present'
    || selected.git_mutation !== false
    || selected.permission_grant_authority !== false
    || selected.revision_admission !== 'not_created'
    || selected.secret_access !== 'not_present'
    || selected.network_access !== false
  ) fail();
  return freezeDeep(selected);
}

function sanitizeCommandProfile(value, projectId, sourceTreeDigest) {
  exactObject(value, COMMAND_PROFILE_KEYS);
  const withoutId = {
    command_profile_version: valueAt(value, 'command_profile_version'),
    project_id: safeProjectId(valueAt(value, 'project_id')),
    source_tree_digest: safeDigest(valueAt(value, 'source_tree_digest')),
    command_kind: safeEnum(valueAt(value, 'command_kind'), COMMAND_KINDS),
    command_display: safeBoundedText(valueAt(value, 'command_display'), 120),
    cwd: valueAt(value, 'cwd'),
    confidence: safeEnum(valueAt(value, 'confidence'), COMMAND_CONFIDENCES),
    discovered_from: valueAt(value, 'discovered_from'),
    requires_user_approval: valueAt(value, 'requires_user_approval'),
    risk_class: valueAt(value, 'risk_class'),
  };
  if (
    withoutId.command_profile_version !== BUILDER_COMMAND_PROFILE_VERSION
    || withoutId.project_id !== projectId
    || withoutId.source_tree_digest !== sourceTreeDigest
    || withoutId.cwd !== '.'
    || withoutId.discovered_from !== 'package.json:scripts'
    || withoutId.requires_user_approval !== true
    || withoutId.risk_class !== COMMAND_RISK_CLASS
  ) fail();
  const commandProfileIdValue = valueAt(value, 'command_profile_id');
  if (commandProfileIdValue !== commandProfileId(withoutId)) fail();
  return freezeDeep({
    command_profile_id: commandProfileIdValue,
    ...withoutId,
  });
}

function sanitizeEntrypoint(value) {
  exactObject(value, ENTRYPOINT_KEYS);
  return freezeDeep({
    path: safeProjectPath(valueAt(value, 'path')),
    entry_kind: safeEnum(valueAt(value, 'entry_kind'), ENTRYPOINT_KINDS),
    confidence: safeEnum(valueAt(value, 'confidence'), ENTRYPOINT_CONFIDENCES),
    discovered_from: safeBoundedText(valueAt(value, 'discovered_from'), 80),
  });
}

function sanitizeImportantPath(value) {
  exactObject(value, IMPORTANT_PATH_KEYS);
  return freezeDeep({
    path: safeProjectPath(valueAt(value, 'path')),
    path_kind: safeEnum(valueAt(value, 'path_kind'), IMPORTANT_PATH_KINDS),
    reason: safeBoundedText(valueAt(value, 'reason'), 120),
  });
}

function sanitizeDetectedStack(value) {
  const stacks = safeArray(value, 4, (stack) => safeEnum(stack, DETECTED_STACKS));
  if (
    stacks.length < 1
    || new Set(stacks).size !== stacks.length
    || (stacks.includes('unknown') && stacks.length !== 1)
  ) fail();
  return stacks;
}

function sanitizeUnknowns(value) {
  const unknowns = safeArray(value, 8, (unknown) => safeEnum(unknown, UNKNOWNS));
  if (new Set(unknowns).size !== unknowns.length) fail();
  return unknowns;
}

function sanitizeBuilderProjectUnderstandingSnapshot(rawSnapshot) {
  exactObject(rawSnapshot, SNAPSHOT_KEYS);
  const snapshotVersion = valueAt(rawSnapshot, 'snapshot_version');
  const projectId = safeProjectId(valueAt(rawSnapshot, 'project_id'));
  const sourceTreeDigest = safeDigest(valueAt(rawSnapshot, 'source_tree_digest'));
  if (snapshotVersion !== BUILDER_PROJECT_UNDERSTANDING_SNAPSHOT_VERSION) fail();
  const profiles = safeArray(
    valueAt(rawSnapshot, 'command_profiles'),
    MAX_COMMAND_PROFILES,
    (profile) => sanitizeCommandProfile(profile, projectId, sourceTreeDigest),
  );
  const ids = safeArray(
    valueAt(rawSnapshot, 'command_profile_ids'),
    MAX_COMMAND_PROFILES,
    (id) => safeBoundedText(id, 96),
  );
  if (
    ids.length !== profiles.length
    || ids.some((id, index) => id !== profiles[index].command_profile_id)
  ) fail();
  const staleReason = valueAt(rawSnapshot, 'stale_reason');
  if (staleReason !== null && !['source_tree_changed', 'project_root_changed'].includes(staleReason)) {
    fail();
  }
  return freezeDeep({
    snapshot_version: snapshotVersion,
    project_id: projectId,
    root_digest: safeDigest(valueAt(rawSnapshot, 'root_digest')),
    source_tree_digest: sourceTreeDigest,
    detected_stack: sanitizeDetectedStack(valueAt(rawSnapshot, 'detected_stack')),
    package_manager: safeEnum(valueAt(rawSnapshot, 'package_manager'), PACKAGE_MANAGERS),
    entrypoints: safeArray(valueAt(rawSnapshot, 'entrypoints'), MAX_ENTRYPOINTS, sanitizeEntrypoint),
    important_paths: safeArray(
      valueAt(rawSnapshot, 'important_paths'),
      MAX_IMPORTANT_PATHS,
      sanitizeImportantPath,
    ),
    command_profiles: profiles,
    command_profile_ids: ids,
    unknowns: sanitizeUnknowns(valueAt(rawSnapshot, 'unknowns')),
    stale_reason: staleReason,
    updated_at_ms: safeTimestamp(valueAt(rawSnapshot, 'updated_at_ms')),
    authority: sanitizeAuthority(valueAt(rawSnapshot, 'authority')),
  });
}

function fileMap(sourceTree) {
  return new Map(sourceTree.files.map((file) => [file.path, file]));
}

function parsePackageJson(file) {
  if (!file) return null;
  try {
    const parsed = JSON.parse(file.content);
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function safePackageScripts(parsedPackage) {
  if (parsedPackage === null) return null;
  const scripts = parsedPackage.scripts;
  if (!isPlainObject(scripts) || utilTypes.isProxy(scripts)) return null;
  const safe = {};
  for (const kind of COMMAND_KINDS) {
    const scriptName = SCRIPT_BY_KIND[kind];
    const descriptor = Object.getOwnPropertyDescriptor(scripts, scriptName);
    if (
      descriptor
      && descriptor.enumerable === true
      && Object.hasOwn(descriptor, 'value')
      && typeof descriptor.value === 'string'
      && descriptor.value.trim().length > 0
    ) safe[kind] = scriptName;
  }
  return safe;
}

function detectPackageManager(files) {
  if (files.has('pnpm-lock.yaml')) return 'pnpm';
  if (files.has('yarn.lock')) return 'yarn';
  if (files.has('bun.lockb') || files.has('bun.lock')) return 'bun';
  if (files.has('package-lock.json') || files.has('package.json')) return 'npm';
  return 'none';
}

function commandDisplay(packageManager, kind) {
  const scriptName = SCRIPT_BY_KIND[kind];
  if (packageManager === 'pnpm') return kind === 'test' ? 'pnpm test' : `pnpm run ${scriptName}`;
  if (packageManager === 'yarn') return kind === 'test' ? 'yarn test' : `yarn ${scriptName}`;
  if (packageManager === 'bun') return kind === 'test' ? 'bun test' : `bun run ${scriptName}`;
  return kind === 'test' ? 'npm test' : `npm run ${scriptName}`;
}

function commandProfileId(input) {
  const digest = sha256Canonical(input);
  return `builder-command-profile:${digest.slice('sha256:'.length, 'sha256:'.length + 32)}`;
}

function commandProfiles(projectId, sourceTree, packageManager, packageScripts, previousRuns) {
  if (packageScripts === null) return freezeDeep([]);
  const previous = new Set(previousRuns.map((run) => `${run.command_kind}\n${run.command_display}`));
  const profiles = [];
  for (const kind of COMMAND_KINDS) {
    if (!Object.hasOwn(packageScripts, kind)) continue;
    const display = commandDisplay(packageManager, kind);
    const confidence = previous.has(`${kind}\n${display}`) ? 'verified_previous_success' : 'manifest_declared';
    const body = {
      command_profile_version: BUILDER_COMMAND_PROFILE_VERSION,
      project_id: projectId,
      source_tree_digest: sourceTree.source_tree_digest,
      command_kind: kind,
      command_display: display,
      cwd: '.',
      confidence,
      discovered_from: 'package.json:scripts',
      requires_user_approval: true,
      risk_class: COMMAND_RISK_CLASS,
    };
    profiles.push(freezeDeep({
      command_profile_id: commandProfileId(body),
      ...body,
    }));
  }
  return freezeDeep(profiles.slice(0, MAX_COMMAND_PROFILES));
}

function detectStacks(files, parsedPackage) {
  const stacks = [];
  if (parsedPackage !== null) stacks.push('node');
  const hasFrontendHints = files.has('index.html')
    || files.has('vite.config.ts')
    || files.has('vite.config.js')
    || Array.from(files.keys()).some((filePath) => /^src\/(?:App|app|main|index)\.(?:tsx|ts|jsx|js)$/u.test(filePath));
  if (parsedPackage !== null && hasFrontendHints) stacks.push('frontend');
  if (parsedPackage === null && files.has('index.html')) stacks.push('static_html');
  if (
    stacks.length === 0
    && Array.from(files.keys()).some((filePath) => /\.md$/iu.test(filePath) || /\.txt$/iu.test(filePath))
  ) stacks.push('markdown_text');
  if (stacks.length === 0) stacks.push('unknown');
  return freezeDeep(stacks);
}

function entrypoints(files, parsedPackage, stacks) {
  const selected = [];
  const add = (filePath, kind, confidence, discoveredFrom) => {
    if (files.has(filePath) && !selected.some((entry) => entry.path === filePath)) {
      selected.push(freezeDeep({
        path: filePath,
        entry_kind: kind,
        confidence,
        discovered_from: discoveredFrom,
      }));
    }
  };
  if (parsedPackage !== null) {
    const main = parsedPackage.main;
    if (typeof main === 'string') add(main, 'node_main', 'manifest_declared', 'package.json:main');
  }
  add('index.html', 'static_html_entry', stacks.includes('static_html') ? 'high' : 'manifest_or_file_hint', 'file_tree');
  for (const filePath of ['src/main.tsx', 'src/main.ts', 'src/main.jsx', 'src/main.js']) {
    add(filePath, 'frontend_main', 'file_hint', 'file_tree');
  }
  if (selected.length === 0) add('README.md', 'documentation_entry', 'file_hint', 'file_tree');
  return freezeDeep(selected.slice(0, MAX_ENTRYPOINTS));
}

function importantPaths(files) {
  const paths = [];
  const add = (filePath, pathKind, reason) => {
    if (files.has(filePath)) {
      paths.push(freezeDeep({ path: filePath, path_kind: pathKind, reason }));
    }
  };
  for (const filePath of KNOWN_IMPORTANT_FILES) {
    if (filePath === 'package.json') add(filePath, 'manifest', 'Node project manifest');
    else if (filePath.includes('lock')) {
      add(filePath, 'lockfile', 'Package manager lockfile');
    } else if (filePath.startsWith('vite.config')) add(filePath, 'config', 'Frontend build config');
    else if (filePath === 'tsconfig.json') add(filePath, 'config', 'TypeScript config');
    else if (filePath === 'README.md') add(filePath, 'documentation', 'Project documentation');
    else if (filePath === 'index.html') add(filePath, 'entrypoint', 'Static HTML entry');
  }
  return freezeDeep(paths.slice(0, MAX_IMPORTANT_PATHS));
}

function unknowns(files, parsedPackage, profiles) {
  const result = [];
  if (parsedPackage === null && files.has('package.json')) result.push('package_manifest_unreadable');
  if (profiles.length === 0) result.push('no_known_check_commands');
  if (files.size === 0) result.push('empty_project');
  return freezeDeep(result);
}

function authority() {
  return freezeDeep({
    understanding_authority: 'main_owned_project_understanding_contract_v1',
    source_tree_authority: 'verified_builder_project_source_tree',
    renderer_authority: 'not_present',
    ipc_authority: 'not_present',
    provider_dispatch: false,
    tool_dispatch: false,
    command_execution: false,
    source_read: 'provided_snapshot_only',
    source_write: 'not_present',
    git_mutation: false,
    permission_grant_authority: false,
    revision_admission: 'not_created',
    secret_access: 'not_present',
    network_access: false,
  });
}

function createBuilderProjectUnderstandingSnapshot(rawInput) {
  exactObject(rawInput, INPUT_KEYS);
  const projectId = safeProjectId(valueAt(rawInput, 'project_id'));
  const rootDigest = safeDigest(valueAt(rawInput, 'root_digest'));
  let sourceTree;
  try {
    sourceTree = sanitizeBuilderProjectSourceTree(valueAt(rawInput, 'source_tree'));
  } catch (error) {
    if (error instanceof BuilderProjectSourceTreeError) fail();
    fail();
  }
  const previousRuns = safeCheckRuns(valueAt(rawInput, 'previous_successful_check_runs'));
  const updatedAtMs = safeTimestamp(valueAt(rawInput, 'updated_at_ms'));
  const files = fileMap(sourceTree);
  const parsedPackage = parsePackageJson(files.get('package.json'));
  const packageManager = detectPackageManager(files);
  const packageScripts = safePackageScripts(parsedPackage);
  const detectedStack = detectStacks(files, parsedPackage);
  const profiles = commandProfiles(projectId, sourceTree, packageManager, packageScripts, previousRuns);
  return freezeDeep({
    snapshot_version: BUILDER_PROJECT_UNDERSTANDING_SNAPSHOT_VERSION,
    project_id: projectId,
    root_digest: rootDigest,
    source_tree_digest: sourceTree.source_tree_digest,
    detected_stack: detectedStack,
    package_manager: packageManager,
    entrypoints: entrypoints(files, parsedPackage, detectedStack),
    important_paths: importantPaths(files),
    command_profiles: profiles,
    command_profile_ids: profiles.map((profile) => profile.command_profile_id),
    unknowns: unknowns(files, parsedPackage, profiles),
    stale_reason: null,
    updated_at_ms: updatedAtMs,
    authority: authority(),
  });
}

function safeBoundary(fn) {
  return (...args) => {
    try {
      return fn(...args);
    } catch (error) {
      if (error instanceof BuilderProjectUnderstandingError) throw error;
      fail();
    }
  };
}

module.exports = Object.freeze({
  BUILDER_COMMAND_PROFILE_VERSION,
  BUILDER_PROJECT_UNDERSTANDING_SNAPSHOT_VERSION,
  BuilderProjectUnderstandingError,
  createBuilderProjectUnderstandingSnapshot: safeBoundary(createBuilderProjectUnderstandingSnapshot),
  sanitizeBuilderProjectUnderstandingSnapshot: safeBoundary(sanitizeBuilderProjectUnderstandingSnapshot),
});
