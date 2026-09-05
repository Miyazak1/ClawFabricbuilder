'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { types: utilTypes } = require('node:util');

const {
  sanitizeBuilderProjectSourceTree,
} = require('./builder-project-source-tree.cjs');

const BUILDER_RUNTIME_WORKSPACE_SNAPSHOT_STORE_VERSION =
  'builder-runtime-workspace-snapshot-store.v1';
const RECORD_VERSION = 'builder-runtime-workspace-snapshot.v1';
const MAX_RECORDS = 64;
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const PROJECT_ID_PATTERN = new RegExp(`^builder-project:${UUID_SOURCE}$`, 'u');
const CONVERSATION_ID_PATTERN = new RegExp(
  `^builder-conversation:${UUID_SOURCE}:${UUID_SOURCE}$`,
  'u',
);
const RUN_ID_PATTERN = new RegExp(`^builder-run:${UUID_SOURCE}$`, 'u');
const TOOL_CALL_ID_PATTERN = new RegExp(`^builder-tool-call:${UUID_SOURCE}$`, 'u');
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;

class BuilderRuntimeWorkspaceSnapshotStoreError extends Error {
  constructor() {
    super('The runtime workspace snapshot is unavailable.');
    this.name = 'BuilderRuntimeWorkspaceSnapshotStoreError';
    this.code = 'builder_runtime_workspace_snapshot_unavailable';
    this.retryable = false;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderRuntimeWorkspaceSnapshotStoreError();
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
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) fail();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  }
  return descriptors;
}

function safePattern(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) fail();
  return value;
}

function safeProjectPath(value) {
  if (
    typeof value !== 'string'
    || value.length < 1
    || value.length > 240
    || value.trim() !== value
    || value.startsWith('/')
    || value.endsWith('/')
    || value.includes('\\')
    || value.includes('..')
    || /[<>:"|?*\0]/u.test(value)
  ) fail();
  return value;
}

function safeRoot(value) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.includes('\0')
    || !path.isAbsolute(value)
    || path.normalize(value) !== value
  ) fail();
  fs.mkdirSync(value, { recursive: true, mode: 0o700 });
  return value;
}

function runFileName(runId) {
  return `${runId.slice('builder-run:'.length)}.json`;
}

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freezeDeep(nested);
    Object.freeze(value);
  }
  return value;
}

function safeIdentity(value) {
  const descriptors = exactObject(value, ['project_id', 'conversation_id', 'run_id']);
  const projectId = safePattern(descriptors.project_id.value, PROJECT_ID_PATTERN);
  const conversationId = safePattern(descriptors.conversation_id.value, CONVERSATION_ID_PATTERN);
  if (!conversationId.startsWith(
    `builder-conversation:${projectId.slice('builder-project:'.length)}:`,
  )) {
    fail();
  }
  return freezeDeep({
    project_id: projectId,
    conversation_id: conversationId,
    run_id: safePattern(descriptors.run_id.value, RUN_ID_PATTERN),
  });
}

function sanitizeTools(value) {
  if (!isPlainObject(value)) fail();
  const result = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') fail();
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true) fail();
    result[safePattern(key, TOOL_CALL_ID_PATTERN)] = safeProjectPath(descriptor.value);
  }
  return freezeDeep(result);
}

function sanitizeRecord(value) {
  const hasResume = isPlainObject(value) && Object.hasOwn(value, 'resume');
  const descriptors = exactObject(value, [
    'record_version', 'project_id', 'conversation_id', 'run_id',
    'source_tree', 'tools', 'updated_at_ms',
    ...(hasResume ? ['resume'] : []),
  ]);
  if (descriptors.record_version.value !== RECORD_VERSION) fail();
  const identity = safeIdentity({
    project_id: descriptors.project_id.value,
    conversation_id: descriptors.conversation_id.value,
    run_id: descriptors.run_id.value,
  });
  const updatedAtMs = descriptors.updated_at_ms.value;
  if (!Number.isSafeInteger(updatedAtMs) || updatedAtMs < 0) fail();
  return freezeDeep({
    record_version: RECORD_VERSION,
    ...identity,
    source_tree: sanitizeBuilderProjectSourceTree(descriptors.source_tree.value),
    tools: sanitizeTools(descriptors.tools.value),
    updated_at_ms: updatedAtMs,
    ...(hasResume ? { resume: sanitizeResume(descriptors.resume.value) } : {}),
  });
}

function sanitizeResume(value) {
  const descriptors = exactObject(value, ['session_run_id', 'base_source_tree']);
  return freezeDeep({
    session_run_id: safePattern(descriptors.session_run_id.value, RUN_ID_PATTERN),
    base_source_tree: sanitizeBuilderProjectSourceTree(descriptors.base_source_tree.value),
  });
}

function createBuilderRuntimeWorkspaceSnapshotStore(rawOptions) {
  const options = exactObject(rawOptions, ['root_directory', 'now_ms']);
  const root = safeRoot(options.root_directory.value);
  const nowMs = options.now_ms.value;
  if (typeof nowMs !== 'function' || utilTypes.isProxy(nowMs)) fail();
  const records = new Map();
  const queues = new Map();

  function recordPath(runId) {
    return path.join(root, runFileName(runId));
  }

  function readDisk(runId) {
    try {
      return sanitizeRecord(JSON.parse(fs.readFileSync(recordPath(runId), 'utf8')));
    } catch {
      return null;
    }
  }

  function current(identity) {
    const existing = records.get(identity.run_id) ?? readDisk(identity.run_id);
    if (
      existing === null
      || existing.project_id !== identity.project_id
      || existing.conversation_id !== identity.conversation_id
    ) return null;
    records.set(identity.run_id, existing);
    return existing;
  }

  function persist(record) {
    const target = recordPath(record.run_id);
    const temporary = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(record), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporary, target);
    records.set(record.run_id, record);
    const files = fs.readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /^[0-9a-f-]{36}\.json$/u.test(entry.name))
      .map((entry) => ({
        name: entry.name,
        mtime: fs.statSync(path.join(root, entry.name)).mtimeMs,
      }))
      .sort((left, right) => right.mtime - left.mtime);
    for (const stale of files.slice(MAX_RECORDS)) {
      // Resumable work is durable task state, not an evictable file-preview cache.
      if (readDisk(`builder-run:${stale.name.slice(0, -5)}`)?.resume !== undefined) continue;
      try { fs.unlinkSync(path.join(root, stale.name)); } catch { /* bounded cleanup is best effort */ }
    }
  }

  function enqueue(runId, operation) {
    const previous = queues.get(runId) ?? Promise.resolve();
    const next = previous.then(operation, operation);
    const settled = next.then(() => undefined, () => undefined);
    queues.set(runId, settled);
    void settled.finally(() => {
      if (queues.get(runId) === settled) queues.delete(runId);
    });
    return next;
  }

  async function recordSourceTree(rawRequest) {
    const hasResume = isPlainObject(rawRequest) && Object.hasOwn(rawRequest, 'resume');
    const descriptors = exactObject(rawRequest, ['project_id', 'conversation_id', 'run_id', 'source_tree', ...(hasResume ? ['resume'] : [])]);
    const identity = safeIdentity({
      project_id: descriptors.project_id.value,
      conversation_id: descriptors.conversation_id.value,
      run_id: descriptors.run_id.value,
    });
    const sourceTree = sanitizeBuilderProjectSourceTree(descriptors.source_tree.value);
    const resume = hasResume ? sanitizeResume(descriptors.resume.value) : null;
    return enqueue(identity.run_id, () => {
      const existing = current(identity);
      if (resume !== null && existing?.resume !== undefined
        && JSON.stringify(resume) !== JSON.stringify(existing.resume)) fail();
      const record = sanitizeRecord({
        record_version: RECORD_VERSION,
        ...identity,
        source_tree: sourceTree,
        tools: existing?.tools ?? {},
        updated_at_ms: Number(Reflect.apply(nowMs, undefined, [])),
        ...((resume ?? existing?.resume) === undefined || (resume ?? existing?.resume) === null
          ? {} : { resume: resume ?? existing.resume }),
      });
      persist(record);
      return record;
    });
  }

  async function bindToolFile(rawRequest) {
    const descriptors = exactObject(rawRequest, [
      'project_id', 'conversation_id', 'run_id', 'tool_call_id', 'path',
    ]);
    const identity = safeIdentity({
      project_id: descriptors.project_id.value,
      conversation_id: descriptors.conversation_id.value,
      run_id: descriptors.run_id.value,
    });
    const toolCallId = safePattern(descriptors.tool_call_id.value, TOOL_CALL_ID_PATTERN);
    const selectedPath = safeProjectPath(descriptors.path.value);
    return enqueue(identity.run_id, () => {
      const existing = current(identity);
      if (existing === null) fail();
      const record = sanitizeRecord({
        ...existing,
        tools: { ...existing.tools, [toolCallId]: selectedPath },
        updated_at_ms: Number(Reflect.apply(nowMs, undefined, [])),
      });
      persist(record);
      return record;
    });
  }

  async function readToolFile(rawRequest) {
    const descriptors = exactObject(rawRequest, [
      'project_id', 'conversation_id', 'run_id', 'tool_call_id',
    ]);
    const identity = safeIdentity({
      project_id: descriptors.project_id.value,
      conversation_id: descriptors.conversation_id.value,
      run_id: descriptors.run_id.value,
    });
    await (queues.get(identity.run_id) ?? Promise.resolve());
    const record = current(identity);
    if (record === null) fail();
    const toolCallId = safePattern(descriptors.tool_call_id.value, TOOL_CALL_ID_PATTERN);
    const selectedPath = record.tools[toolCallId];
    if (selectedPath === undefined || !record.source_tree.files.some((file) => file.path === selectedPath)) fail();
    return freezeDeep({
      store_version: BUILDER_RUNTIME_WORKSPACE_SNAPSHOT_STORE_VERSION,
      ...identity,
      tool_call_id: toolCallId,
      selected_path: selectedPath,
      source_tree: record.source_tree,
    });
  }

  async function readSourceTree(rawRequest) {
    const descriptors = exactObject(rawRequest, [
      'project_id', 'conversation_id', 'source_tree_digest',
    ]);
    const projectId = safePattern(descriptors.project_id.value, PROJECT_ID_PATTERN);
    const conversationId = safePattern(descriptors.conversation_id.value, CONVERSATION_ID_PATTERN);
    const digest = safePattern(descriptors.source_tree_digest.value, DIGEST_PATTERN);
    const files = fs.readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /^[0-9a-f-]{36}\.json$/u.test(entry.name));
    for (const file of files) {
      const runId = `builder-run:${file.name.slice(0, -'.json'.length)}`;
      const record = records.get(runId) ?? readDisk(runId);
      if (
        record !== null
        && record.project_id === projectId
        && record.conversation_id === conversationId
        && record.source_tree.source_tree_digest === digest
      ) {
        records.set(runId, record);
        return freezeDeep({
          store_version: BUILDER_RUNTIME_WORKSPACE_SNAPSHOT_STORE_VERSION,
          project_id: projectId,
          conversation_id: conversationId,
          run_id: runId,
          source_tree: record.source_tree,
        });
      }
    }
    fail();
  }

  return freezeDeep({
    store_version: BUILDER_RUNTIME_WORKSPACE_SNAPSHOT_STORE_VERSION,
    record_source_tree: recordSourceTree,
    bind_tool_file: bindToolFile,
    read_tool_file: readToolFile,
    read_source_tree: readSourceTree,
    async read_run_source_tree(rawRequest) {
      const identity = safeIdentity(rawRequest);
      await (queues.get(identity.run_id) ?? Promise.resolve());
      const record = current(identity);
      if (record === null) fail();
      return record;
    },
  });
}

module.exports = freezeDeep({
  BUILDER_RUNTIME_WORKSPACE_SNAPSHOT_STORE_VERSION,
  BuilderRuntimeWorkspaceSnapshotStoreError,
  createBuilderRuntimeWorkspaceSnapshotStore,
});
