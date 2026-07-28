'use strict';

const fs = require('node:fs');
const nodeCrypto = require('node:crypto');
const path = require('node:path');
const { types: utilTypes } = require('node:util');

const BUILDER_TOOL_PROJECT_WORKSPACE_ADMISSION_VERSION =
  'builder-tool-project-workspace-admission.v1';
const BUILDER_TOOL_PROJECT_WORKSPACE_AUTHORITY_VERSION =
  'builder-tool-project-workspace-authority.v1';
const WORKSPACE_ADMISSION_KIND = 'builder_tool_project_workspace_admission';
const AUTHORITY_INPUT_KEYS = Object.freeze(['projects_root']);
const AUTHORITY_INPUT_KEYS_WITH_RESOLVER = Object.freeze(['projects_root', 'resolve_project_root']);
const ADMIT_INPUT_KEYS = Object.freeze([
  'project_id',
  'admitted_at_ms',
]);
const ADMISSION_KEYS = Object.freeze([
  'admission_version',
  'admission_kind',
  'project_id',
  'project_uuid',
  'projects_root_real_path',
  'project_root_real_path',
  'admitted_at_ms',
  'authority',
  'admission_digest',
]);
const AUTHORITY_KEYS = Object.freeze([
  'project_root_authority',
  'path_derivation',
  'root_directory_admission',
  'project_directory_admission',
  'renderer_authority',
  'provider_dispatch',
  'git_authority',
  'sqlite_authority',
  'filesystem_read',
]);
const AUTHORITY = Object.freeze({
  project_root_authority: 'main_project_workspace_root_contract_v1',
  path_derivation: 'projects_root_plus_project_id_uuid',
  root_directory_admission: 'real_directory_not_symlink',
  project_directory_admission: 'real_directory_not_symlink',
  renderer_authority: 'not_present',
  provider_dispatch: false,
  git_authority: 'not_present',
  sqlite_authority: 'not_present',
  filesystem_read: 'not_performed',
});
const SQLITE_IDENTITY_AUTHORITY = Object.freeze({
  ...AUTHORITY,
  path_derivation: 'sqlite_project_identity_root_path',
});
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const PROJECT_ID_PATTERN = new RegExp(`^builder-project:(${UUID_SOURCE})$`, 'u');
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const TRUSTED_WORKSPACE_ADMISSIONS = new WeakSet();

class BuilderToolProjectWorkspaceAdmissionError extends Error {
  constructor() {
    super('The project workspace root could not be verified.');
    this.name = 'BuilderToolProjectWorkspaceAdmissionError';
    this.code = 'builder_tool_project_workspace_admission_invalid';
    this.retryable = false;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderToolProjectWorkspaceAdmissionError();
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

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
    fail();
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

function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number' && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
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

function safeProjectId(value) {
  if (typeof value !== 'string') fail();
  const match = PROJECT_ID_PATTERN.exec(value);
  if (!match) fail();
  return Object.freeze({ projectId: value, projectUuid: match[1] });
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

function safeProjectRootResolver(value) {
  if (value === undefined) return null;
  if (typeof value !== 'function' || utilTypes.isProxy(value)) fail();
  return value;
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail();
  return value;
}

function checkedDirectoryRealPath(targetPath) {
  let stats;
  try {
    stats = fs.lstatSync(targetPath);
  } catch {
    fail();
  }
  if (!stats.isDirectory() || stats.isSymbolicLink()) fail();
  try {
    return safeAbsolutePath(path.resolve(fs.realpathSync.native(targetPath)));
  } catch {
    fail();
  }
}

function containedPath(rootRealPath, targetRealPath) {
  const relative = path.relative(rootRealPath, targetRealPath);
  return relative === ''
    || (
      relative.length > 0
      && !relative.startsWith('..')
      && !path.isAbsolute(relative)
    );
}

function digestAdmission(admission) {
  return sha256Canonical({
    ...admission,
    admission_digest: null,
  });
}

function assertAdmission(admission, { requireTrusted }) {
  if (requireTrusted && !TRUSTED_WORKSPACE_ADMISSIONS.has(admission)) fail();
  exactObject(admission, ADMISSION_KEYS);
  if (valueAt(admission, 'admission_version') !== BUILDER_TOOL_PROJECT_WORKSPACE_ADMISSION_VERSION) fail();
  if (valueAt(admission, 'admission_kind') !== WORKSPACE_ADMISSION_KIND) fail();
  const { projectId, projectUuid } = safeProjectId(valueAt(admission, 'project_id'));
  if (valueAt(admission, 'project_uuid') !== projectUuid) fail();
  safeAbsolutePath(valueAt(admission, 'projects_root_real_path'));
  safeAbsolutePath(valueAt(admission, 'project_root_real_path'));
  safeTimestamp(valueAt(admission, 'admitted_at_ms'));
  exactObject(valueAt(admission, 'authority'), AUTHORITY_KEYS);
  const authority = valueAt(admission, 'authority');
  const pathDerivation = valueAt(authority, 'path_derivation');
  const expectedAuthority = pathDerivation === SQLITE_IDENTITY_AUTHORITY.path_derivation
    ? SQLITE_IDENTITY_AUTHORITY
    : AUTHORITY;
  for (const key of AUTHORITY_KEYS) {
    if (valueAt(authority, key) !== expectedAuthority[key]) fail();
  }
  if (typeof valueAt(admission, 'admission_digest') !== 'string'
    || !DIGEST_PATTERN.test(valueAt(admission, 'admission_digest'))) fail();
  const expectedRoot = path.join(
    valueAt(admission, 'projects_root_real_path'),
    projectUuid,
  );
  if (pathDerivation === AUTHORITY.path_derivation) {
    if (path.normalize(expectedRoot) !== expectedRoot) fail();
    if (valueAt(admission, 'project_root_real_path') !== expectedRoot) fail();
    if (!containedPath(
      valueAt(admission, 'projects_root_real_path'),
      valueAt(admission, 'project_root_real_path'),
    )) fail();
  }
  if (digestAdmission(admission) !== valueAt(admission, 'admission_digest')) fail();
  return { projectId, projectUuid };
}

function signedAdmission({
  projectsRootRealPath,
  projectRootPath,
  projectId,
  projectUuid,
  admittedAtMs,
  authority,
}) {
  const projectRoot = projectRootPath ?? path.join(projectsRootRealPath, projectUuid);
  if (path.normalize(projectRoot) !== projectRoot) fail();
  const projectRootRealPath = checkedDirectoryRealPath(projectRoot);
  if (projectRootRealPath !== projectRoot) fail();
  if (authority.path_derivation === AUTHORITY.path_derivation
    && !containedPath(projectsRootRealPath, projectRootRealPath)) fail();
  const admission = {
    admission_version: BUILDER_TOOL_PROJECT_WORKSPACE_ADMISSION_VERSION,
    admission_kind: WORKSPACE_ADMISSION_KIND,
    project_id: projectId,
    project_uuid: projectUuid,
    projects_root_real_path: projectsRootRealPath,
    project_root_real_path: projectRootRealPath,
    admitted_at_ms: admittedAtMs,
    authority,
    admission_digest: null,
  };
  admission.admission_digest = digestAdmission(admission);
  assertAdmission(admission, { requireTrusted: false });
  freezeDeep(admission);
  TRUSTED_WORKSPACE_ADMISSIONS.add(admission);
  return admission;
}

function createBuilderToolProjectWorkspaceAuthority(rawInput) {
  try {
    const inputKeys = isPlainObject(rawInput) && Reflect.ownKeys(rawInput).includes('resolve_project_root')
      ? AUTHORITY_INPUT_KEYS_WITH_RESOLVER
      : AUTHORITY_INPUT_KEYS;
    const descriptors = exactObject(rawInput, inputKeys);
    const projectsRoot = safeAbsolutePath(descriptors.projects_root.value);
    const resolveProjectRoot = inputKeys.includes('resolve_project_root')
      ? safeProjectRootResolver(descriptors.resolve_project_root.value)
      : null;
    const projectsRootRealPath = checkedDirectoryRealPath(projectsRoot);
    return freezeDeep({
      authority_version: BUILDER_TOOL_PROJECT_WORKSPACE_AUTHORITY_VERSION,
      admit_project_workspace(rawAdmitInput) {
        try {
          const admitDescriptors = exactObject(rawAdmitInput, ADMIT_INPUT_KEYS);
          const { projectId, projectUuid } = safeProjectId(admitDescriptors.project_id.value);
          const admittedAtMs = safeTimestamp(admitDescriptors.admitted_at_ms.value);
          const projectRootPath = resolveProjectRoot === null
            ? null
            : safeAbsolutePath(Reflect.apply(resolveProjectRoot, undefined, [projectId]));
          return signedAdmission({
            projectsRootRealPath,
            projectRootPath,
            projectId,
            projectUuid,
            admittedAtMs,
            authority: resolveProjectRoot === null ? AUTHORITY : SQLITE_IDENTITY_AUTHORITY,
          });
        } catch (error) {
          if (error instanceof BuilderToolProjectWorkspaceAdmissionError) throw error;
          fail();
        }
      },
    });
  } catch (error) {
    if (error instanceof BuilderToolProjectWorkspaceAdmissionError) throw error;
    fail();
  }
}

function sanitizeBuilderToolProjectWorkspaceAdmission(rawAdmission) {
  try {
    assertAdmission(rawAdmission, { requireTrusted: true });
    return freezeDeep({
      admission_version: valueAt(rawAdmission, 'admission_version'),
      admission_kind: valueAt(rawAdmission, 'admission_kind'),
      project_id: valueAt(rawAdmission, 'project_id'),
      project_uuid: valueAt(rawAdmission, 'project_uuid'),
      projects_root_real_path: valueAt(rawAdmission, 'projects_root_real_path'),
      project_root_real_path: valueAt(rawAdmission, 'project_root_real_path'),
      admitted_at_ms: valueAt(rawAdmission, 'admitted_at_ms'),
      authority: {
        project_root_authority: valueAt(valueAt(rawAdmission, 'authority'), 'project_root_authority'),
        path_derivation: valueAt(valueAt(rawAdmission, 'authority'), 'path_derivation'),
        root_directory_admission: valueAt(valueAt(rawAdmission, 'authority'), 'root_directory_admission'),
        project_directory_admission: valueAt(valueAt(rawAdmission, 'authority'), 'project_directory_admission'),
        renderer_authority: valueAt(valueAt(rawAdmission, 'authority'), 'renderer_authority'),
        provider_dispatch: valueAt(valueAt(rawAdmission, 'authority'), 'provider_dispatch'),
        git_authority: valueAt(valueAt(rawAdmission, 'authority'), 'git_authority'),
        sqlite_authority: valueAt(valueAt(rawAdmission, 'authority'), 'sqlite_authority'),
        filesystem_read: valueAt(valueAt(rawAdmission, 'authority'), 'filesystem_read'),
      },
      admission_digest: valueAt(rawAdmission, 'admission_digest'),
    });
  } catch (error) {
    if (error instanceof BuilderToolProjectWorkspaceAdmissionError) throw error;
    fail();
  }
}

module.exports = freezeDeep({
  BUILDER_TOOL_PROJECT_WORKSPACE_ADMISSION_VERSION,
  BUILDER_TOOL_PROJECT_WORKSPACE_AUTHORITY_VERSION,
  WORKSPACE_ADMISSION_KIND,
  BuilderToolProjectWorkspaceAdmissionError,
  createBuilderToolProjectWorkspaceAuthority,
  sanitizeBuilderToolProjectWorkspaceAdmission,
});
