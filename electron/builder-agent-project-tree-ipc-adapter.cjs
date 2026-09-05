'use strict';

const { types: utilTypes } = require('node:util');

const READ_AGENT_PROJECT_TREE_CHANNEL = 'clawfabric-builder:agent-project-tree:read';
const RENAME_AGENT_PROJECT_CHANNEL = 'clawfabric-builder:agent-project-tree:rename-project';
const ARCHIVE_AGENT_PROJECT_CHANNEL = 'clawfabric-builder:agent-project-tree:archive-project';
const RENAME_AGENT_TASK_CHANNEL = 'clawfabric-builder:agent-project-tree:rename-task';
const ARCHIVE_AGENT_TASK_CHANNEL = 'clawfabric-builder:agent-project-tree:archive-task';
const EXPORT_AGENT_TASK_TRANSCRIPT_CHANNEL =
  'clawfabric-builder:agent-project-tree:export-task-transcript';
const OPTION_KEYS = Object.freeze([
  'readTree',
  'renameProject',
  'archiveProject',
  'renameTask',
  'archiveTask',
  'exportTaskTranscript',
  'mainWindowRef',
]);
const AGENT_ID_PATTERN =
  /^builder-agent:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MAX_PLAIN_DATA_NODES = 20_000;
const MAX_PLAIN_DATA_ENTRIES = 20_000;
const MAX_PLAIN_DATA_UTF8_BYTES = 4 * 1024 * 1024;
const MAX_PLAIN_DATA_DEPTH = 64;
const ERROR_MESSAGES = Object.freeze({
  builder_agent_project_tree_forbidden: 'Builder agent navigation is unavailable.',
  builder_agent_project_tree_invalid: 'The Builder agent navigation request could not be verified.',
  builder_agent_project_tree_unavailable: 'Builder agent navigation is unavailable.',
});
const PROJECT_ID_PATTERN =
  /^builder-project:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const TASK_ADDRESS_ID_PATTERN =
  /^builder-task-address:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

class BuilderAgentProjectTreeIpcError extends Error {
  constructor(code = 'builder_agent_project_tree_unavailable') {
    const selected = Object.hasOwn(ERROR_MESSAGES, code)
      ? code
      : 'builder_agent_project_tree_unavailable';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderAgentProjectTreeIpcError';
    this.code = selected;
    this.retryable = selected === 'builder_agent_project_tree_unavailable';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function ipcError(code) {
  return new BuilderAgentProjectTreeIpcError(code);
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

function stableMethod(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (
    !descriptor
    || descriptor.enumerable !== true
    || !Object.hasOwn(descriptor, 'value')
    || typeof descriptor.value !== 'function'
    || utilTypes.isProxy(descriptor.value)
  ) throw ipcError();
  return descriptor.value;
}

function safeOptions(value) {
  try {
    if (!isPlainObject(value)) throw ipcError();
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== OPTION_KEYS.length
      || keys.some((key) => typeof key !== 'string' || !OPTION_KEYS.includes(key))
    ) throw ipcError();
    return Object.freeze({
      readTree: stableMethod(value, 'readTree'),
      renameProject: stableMethod(value, 'renameProject'),
      archiveProject: stableMethod(value, 'archiveProject'),
      renameTask: stableMethod(value, 'renameTask'),
      archiveTask: stableMethod(value, 'archiveTask'),
      exportTaskTranscript: stableMethod(value, 'exportTaskTranscript'),
      mainWindowRef: stableMethod(value, 'mainWindowRef'),
    });
  } catch {
    throw ipcError();
  }
}

function safeRequest(value) {
  try {
    if (!isPlainObject(value)) throw ipcError('builder_agent_project_tree_invalid');
    const keys = Reflect.ownKeys(value);
    if (keys.length !== 1 || keys[0] !== 'agent_id') {
      throw ipcError('builder_agent_project_tree_invalid');
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, 'agent_id');
    if (
      !descriptor
      || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value')
      || typeof descriptor.value !== 'string'
      || !AGENT_ID_PATTERN.test(descriptor.value)
    ) throw ipcError('builder_agent_project_tree_invalid');
    return Object.freeze({ agent_id: descriptor.value });
  } catch (error) {
    if (error instanceof BuilderAgentProjectTreeIpcError) throw error;
    throw ipcError('builder_agent_project_tree_invalid');
  }
}

function safeLifecycleText(value) {
  if (
    typeof value !== 'string'
    || value.length < 1
    || value.length > 160
    || value.trim() !== value
  ) throw ipcError('builder_agent_project_tree_invalid');
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) throw ipcError('builder_agent_project_tree_invalid');
  }
  return value;
}

function safeLifecycleRequest(value, kind) {
  try {
    const keys = kind === 'project_rename'
      ? ['agent_id', 'project_id', 'title']
      : kind === 'project_archive'
        ? ['agent_id', 'project_id']
      : kind === 'task_rename'
        ? ['agent_id', 'project_id', 'task_address_id', 'title']
        : kind === 'task_archive' || kind === 'task_export_transcript'
          ? ['agent_id', 'project_id', 'task_address_id']
          : null;
    if (keys === null) throw ipcError('builder_agent_project_tree_invalid');
    if (!isPlainObject(value)) throw ipcError('builder_agent_project_tree_invalid');
    const actual = Reflect.ownKeys(value);
    if (actual.length !== keys.length || actual.some((key) => typeof key !== 'string' || !keys.includes(key))) {
      throw ipcError('builder_agent_project_tree_invalid');
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
        throw ipcError('builder_agent_project_tree_invalid');
      }
    }
    const agentId = descriptors.agent_id.value;
    const projectId = descriptors.project_id.value;
    if (typeof agentId !== 'string' || !AGENT_ID_PATTERN.test(agentId)) throw ipcError('builder_agent_project_tree_invalid');
    if (typeof projectId !== 'string' || !PROJECT_ID_PATTERN.test(projectId)) throw ipcError('builder_agent_project_tree_invalid');
    const base = { agent_id: agentId, project_id: projectId };
    if (kind === 'project_rename') return Object.freeze({ ...base, title: safeLifecycleText(descriptors.title.value) });
    if (kind === 'project_archive') return Object.freeze(base);
    const taskAddressId = descriptors.task_address_id.value;
    if (typeof taskAddressId !== 'string' || !TASK_ADDRESS_ID_PATTERN.test(taskAddressId)) {
      throw ipcError('builder_agent_project_tree_invalid');
    }
    if (kind === 'task_rename') {
      return Object.freeze({
        ...base,
        task_address_id: taskAddressId,
        title: safeLifecycleText(descriptors.title.value),
      });
    }
    return Object.freeze({ ...base, task_address_id: taskAddressId });
  } catch (error) {
    if (error instanceof BuilderAgentProjectTreeIpcError) throw error;
    throw ipcError('builder_agent_project_tree_invalid');
  }
}

function accountUtf8(value, state) {
  if (value.length > MAX_PLAIN_DATA_UTF8_BYTES - state.utf8Bytes) throw ipcError();
  const bytes = Buffer.byteLength(value, 'utf8');
  if (bytes > MAX_PLAIN_DATA_UTF8_BYTES - state.utf8Bytes) throw ipcError();
  state.utf8Bytes += bytes;
}

function clonePlainData(value, state = {
  entries: 0,
  nodes: 0,
  seen: new WeakSet(),
  utf8Bytes: 0,
}, depth = 0) {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    accountUtf8(value, state);
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (
    typeof value !== 'object'
    || utilTypes.isProxy(value)
    || state.seen.has(value)
    || depth > MAX_PLAIN_DATA_DEPTH
    || state.nodes >= MAX_PLAIN_DATA_NODES
  ) throw ipcError();
  state.seen.add(value);
  state.nodes += 1;
  const isArray = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (
    (isArray && prototype !== Array.prototype)
    || (!isArray && prototype !== Object.prototype && prototype !== null)
  ) throw ipcError();
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== 'string')) throw ipcError();
  const entryCount = keys.length - (isArray ? 1 : 0);
  if (entryCount > MAX_PLAIN_DATA_ENTRIES - state.entries) throw ipcError();
  state.entries += entryCount;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const output = isArray ? [] : {};
  for (const key of keys) {
    accountUtf8(key, state);
    const descriptor = descriptors[key];
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw ipcError();
    if (isArray && key === 'length') continue;
    if (
      !descriptor.enumerable
      || (isArray && !/^(?:0|[1-9][0-9]*)$/u.test(key))
      || (!isArray && ['__proto__', 'prototype', 'constructor'].includes(key))
    ) throw ipcError();
    output[key] = clonePlainData(descriptor.value, state, depth + 1);
  }
  return Object.freeze(output);
}

function activeWebContents(mainWindowRef) {
  try {
    const windowRef = Reflect.apply(mainWindowRef, undefined, []);
    if (!windowRef || (typeof windowRef.isDestroyed === 'function' && windowRef.isDestroyed())) return null;
    const webContents = windowRef.webContents;
    if (!webContents || (typeof webContents.isDestroyed === 'function' && webContents.isDestroyed())) return null;
    return webContents;
  } catch {
    return null;
  }
}

function createBuilderAgentProjectTreeIpcAdapter(rawOptions) {
  const options = safeOptions(rawOptions);
  async function invokeLifecycle(event, args, method, kind) {
    try {
      if (!event || event.sender !== activeWebContents(options.mainWindowRef)) {
        throw ipcError('builder_agent_project_tree_forbidden');
      }
      if (args.length !== 1) throw ipcError('builder_agent_project_tree_invalid');
      const result = await Reflect.apply(method, undefined, [safeLifecycleRequest(args[0], kind)]);
      return clonePlainData(result);
    } catch (error) {
      if (error instanceof BuilderAgentProjectTreeIpcError) throw error;
      throw ipcError();
    }
  }
  return Object.freeze({
    adapter_version: 'builder-agent-project-tree-ipc-adapter.v1',
    channel: READ_AGENT_PROJECT_TREE_CHANNEL,
    authority: Object.freeze({
      renderer_authority: 'agent_project_task_selection_only',
      main_owned_agent_authority: true,
      main_owned_task_address_authority: true,
      active_renderer_required: true,
      request_surface: 'read_and_bounded_lifecycle_methods_only',
      read_only: false,
      lifecycle_authority: 'main_owned_project_and_task_lifecycle_stores',
      provider_dispatch: false,
      permission_grant: false,
      source_read: false,
      source_write: false,
      git_mutation: false,
      direct_electron_registration: false,
      direct_preload_exposure: false,
    }),
    async invoke(event, ...args) {
      try {
        if (!event || event.sender !== activeWebContents(options.mainWindowRef)) {
          throw ipcError('builder_agent_project_tree_forbidden');
        }
        if (args.length !== 1) throw ipcError('builder_agent_project_tree_invalid');
        const result = await Reflect.apply(options.readTree, undefined, [safeRequest(args[0])]);
        return clonePlainData(result);
      } catch (error) {
        if (error instanceof BuilderAgentProjectTreeIpcError) throw error;
        throw ipcError();
      }
    },
    channels: Object.freeze({
      renameProject: Object.freeze({
        channel: RENAME_AGENT_PROJECT_CHANNEL,
        invoke(event, ...args) {
          return invokeLifecycle(event, args, options.renameProject, 'project_rename');
        },
      }),
      archiveProject: Object.freeze({
        channel: ARCHIVE_AGENT_PROJECT_CHANNEL,
        invoke(event, ...args) {
          return invokeLifecycle(event, args, options.archiveProject, 'project_archive');
        },
      }),
      renameTask: Object.freeze({
        channel: RENAME_AGENT_TASK_CHANNEL,
        invoke(event, ...args) {
          return invokeLifecycle(event, args, options.renameTask, 'task_rename');
        },
      }),
      archiveTask: Object.freeze({
        channel: ARCHIVE_AGENT_TASK_CHANNEL,
        invoke(event, ...args) {
          return invokeLifecycle(event, args, options.archiveTask, 'task_archive');
        },
      }),
      exportTaskTranscript: Object.freeze({
        channel: EXPORT_AGENT_TASK_TRANSCRIPT_CHANNEL,
        invoke(event, ...args) {
          return invokeLifecycle(event, args, options.exportTaskTranscript, 'task_export_transcript');
        },
      }),
    }),
  });
}

module.exports = Object.freeze({
  ARCHIVE_AGENT_PROJECT_CHANNEL,
  ARCHIVE_AGENT_TASK_CHANNEL,
  EXPORT_AGENT_TASK_TRANSCRIPT_CHANNEL,
  READ_AGENT_PROJECT_TREE_CHANNEL,
  RENAME_AGENT_PROJECT_CHANNEL,
  RENAME_AGENT_TASK_CHANNEL,
  BuilderAgentProjectTreeIpcError,
  createBuilderAgentProjectTreeIpcAdapter,
});
