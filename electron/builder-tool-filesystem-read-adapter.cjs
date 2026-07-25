'use strict';

const fsPromises = require('node:fs/promises');
const path = require('node:path');
const { types: utilTypes } = require('node:util');

const {
  createBuilderToolFilesystemReadOutputRecord,
} = require('./builder-tool-filesystem-read-output-records.cjs');
const {
  sanitizeBuilderToolProjectWorkspaceAdmission,
} = require('./builder-tool-project-workspace-admission.cjs');

const BUILDER_TOOL_FILESYSTEM_READ_ADAPTER_VERSION = 'builder-tool-filesystem-read-adapter.v1';
const INPUT_KEYS = Object.freeze([
  'project_workspace_admission',
  'runtime_invocation_admission',
  'tool_call_record',
  'observed_at_ms',
]);
const UTF8 = new TextDecoder('utf-8', { fatal: true });

class BuilderToolFilesystemReadAdapterError extends Error {
  constructor() {
    super('The filesystem read tool could not read the requested file.');
    this.name = 'BuilderToolFilesystemReadAdapterError';
    this.code = 'builder_tool_filesystem_read_adapter_unavailable';
    this.retryable = false;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderToolFilesystemReadAdapterError();
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

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail();
  return value;
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

async function checkedLstat(targetPath) {
  try {
    return await fsPromises.lstat(targetPath);
  } catch {
    fail();
  }
}

async function checkedRealpath(targetPath) {
  try {
    return await fsPromises.realpath(targetPath);
  } catch {
    fail();
  }
}

async function verifiedProjectFilePath(projectRoot, relativeProjectPath) {
  const rootStat = await checkedLstat(projectRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) fail();
  const rootRealPath = await checkedRealpath(projectRoot);
  const segments = relativeProjectPath.split('/');
  let cursor = rootRealPath;
  for (let index = 0; index < segments.length; index += 1) {
    cursor = path.join(cursor, segments[index]);
    const stats = await checkedLstat(cursor);
    if (stats.isSymbolicLink()) fail();
    if (index < segments.length - 1) {
      if (!stats.isDirectory()) fail();
    } else if (!stats.isFile()) fail();
  }
  const targetRealPath = await checkedRealpath(cursor);
  if (!containedPath(rootRealPath, targetRealPath)) fail();
  return targetRealPath;
}

async function readBoundedUtf8File(targetPath, rootRealPath, maxRawOutputBytes) {
  const beforeStats = await checkedLstat(targetPath);
  if (
    !beforeStats.isFile()
    || beforeStats.isSymbolicLink()
    || !Number.isSafeInteger(beforeStats.size)
    || beforeStats.size > maxRawOutputBytes
  ) fail();
  let handle;
  try {
    handle = await fsPromises.open(targetPath, 'r');
    const afterStats = await handle.stat();
    const afterRealPath = await checkedRealpath(targetPath);
    if (
      !afterStats.isFile()
      || !Number.isSafeInteger(afterStats.size)
      || afterStats.size > maxRawOutputBytes
      || afterStats.dev !== beforeStats.dev
      || afterStats.ino !== beforeStats.ino
      || afterStats.size !== beforeStats.size
      || afterStats.mtimeMs !== beforeStats.mtimeMs
      || afterRealPath !== targetPath
      || !containedPath(rootRealPath, afterRealPath)
    ) fail();
    const buffer = Buffer.alloc(maxRawOutputBytes + 1);
    const result = await handle.read(buffer, 0, maxRawOutputBytes + 1, 0);
    if (result.bytesRead > maxRawOutputBytes) fail();
    const finalStats = await handle.stat();
    if (
      finalStats.dev !== beforeStats.dev
      || finalStats.ino !== beforeStats.ino
      || finalStats.size !== beforeStats.size
      || finalStats.mtimeMs !== beforeStats.mtimeMs
    ) fail();
    return UTF8.decode(buffer.subarray(0, result.bytesRead));
  } catch {
    fail();
  } finally {
    try { await handle?.close(); } catch { /* fixed failure below */ }
  }
}

async function readBuilderToolFilesystemReadAdapter(rawInput) {
  try {
    const descriptors = exactObject(rawInput, INPUT_KEYS);
    const workspaceAdmission = sanitizeBuilderToolProjectWorkspaceAdmission(
      descriptors.project_workspace_admission.value,
    );
    const runtimeAdmission = descriptors.runtime_invocation_admission.value;
    const toolCallRecord = descriptors.tool_call_record.value;
    const observedAtMs = safeTimestamp(descriptors.observed_at_ms.value);
    const preflight = createBuilderToolFilesystemReadOutputRecord({
      runtime_invocation_admission: runtimeAdmission,
      tool_call_record: toolCallRecord,
      observed_at_ms: observedAtMs,
      content: '',
    });
    if (workspaceAdmission.project_id !== preflight.project_id) fail();
    const targetPath = await verifiedProjectFilePath(
      workspaceAdmission.project_root_real_path,
      preflight.file.path,
    );
    const content = await readBoundedUtf8File(
      targetPath,
      workspaceAdmission.project_root_real_path,
      preflight.max_raw_output_bytes,
    );
    return createBuilderToolFilesystemReadOutputRecord({
      runtime_invocation_admission: runtimeAdmission,
      tool_call_record: toolCallRecord,
      observed_at_ms: observedAtMs,
      content,
    });
  } catch (error) {
    if (error instanceof BuilderToolFilesystemReadAdapterError) throw error;
    fail();
  }
}

module.exports = freezeDeep({
  BUILDER_TOOL_FILESYSTEM_READ_ADAPTER_VERSION,
  BuilderToolFilesystemReadAdapterError,
  readBuilderToolFilesystemReadAdapter,
});
