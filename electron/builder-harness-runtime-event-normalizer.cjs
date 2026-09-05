'use strict';

const nodeCrypto = require('node:crypto');
const path = require('node:path');
const { types: utilTypes } = require('node:util');

const {
  BUILDER_PROGRAMMING_RUNTIME_PROTOCOL_VERSION,
  sanitizeBuilderProgrammingRuntimeRunContract,
} = require('./builder-programming-runtime-contract.cjs');

const BUILDER_HARNESS_RUNTIME_EVENT_NORMALIZER_VERSION =
  'builder-harness-runtime-event-normalizer.v1';
const NOTIFICATION_METHODS = Object.freeze([
  'session.event',
  'session.status',
  'session.context-usage',
  'subagent.started',
  'subagent.finished',
]);
const IGNORED_SESSION_EVENTS = Object.freeze([
  'agent/inbox/spliced',
  'user/message',
  'request/header',
  'request/context',
  'session/end-seed',
  'session/title',
]);
const TOOL_MAP = Object.freeze({
  read: Object.freeze({ kind: 'read', presentation: 'file', active: 'Reading', completed: 'Read' }),
  grep: Object.freeze({ kind: 'search', presentation: 'search', active: 'Searching', completed: 'Searched' }),
  glob: Object.freeze({ kind: 'search', presentation: 'search', active: 'Searching', completed: 'Searched' }),
  edit: Object.freeze({ kind: 'edit', presentation: 'changes', active: 'Editing', completed: 'Edited' }),
  write: Object.freeze({ kind: 'write', presentation: 'changes', active: 'Writing', completed: 'Wrote' }),
  bash: Object.freeze({ kind: 'command', presentation: 'terminal', active: 'Running', completed: 'Ran' }),
  browser_open_local_app: Object.freeze({ kind: 'browser', presentation: 'browser', active: 'Opening', completed: 'Opened' }),
  browser_observe: Object.freeze({ kind: 'browser', presentation: 'browser', active: 'Observing', completed: 'Observed' }),
  browser_click: Object.freeze({ kind: 'browser', presentation: 'browser', active: 'Using', completed: 'Used' }),
  browser_type: Object.freeze({ kind: 'browser', presentation: 'browser', active: 'Using', completed: 'Used' }),
  browser_select_option: Object.freeze({ kind: 'browser', presentation: 'browser', active: 'Using', completed: 'Used' }),
  browser_press_key: Object.freeze({ kind: 'browser', presentation: 'browser', active: 'Using', completed: 'Used' }),
  browser_scroll: Object.freeze({ kind: 'browser', presentation: 'browser', active: 'Using', completed: 'Used' }),
  browser_reload_latest_source: Object.freeze({ kind: 'browser', presentation: 'browser', active: 'Reloading', completed: 'Reloaded' }),
  browser_close: Object.freeze({ kind: 'browser', presentation: 'browser', active: 'Closing', completed: 'Closed' }),
  ask_user_question: Object.freeze({
    kind: 'question', presentation: 'question', active: 'Waiting for your answer:', completed: 'Answered:',
  }),
});
const TOOL_MAP_ZH = Object.freeze({
  read: Object.freeze({ kind: 'read', presentation: 'file', active: '正在读取', completed: '已读取' }),
  grep: Object.freeze({ kind: 'search', presentation: 'search', active: '正在搜索', completed: '已搜索' }),
  glob: Object.freeze({ kind: 'search', presentation: 'search', active: '正在搜索', completed: '已搜索' }),
  edit: Object.freeze({ kind: 'edit', presentation: 'changes', active: '正在编辑', completed: '已编辑' }),
  write: Object.freeze({ kind: 'write', presentation: 'changes', active: '正在写入', completed: '已写入' }),
  bash: Object.freeze({ kind: 'command', presentation: 'terminal', active: '正在运行', completed: '已运行' }),
  browser_open_local_app: Object.freeze({ kind: 'browser', presentation: 'browser', active: '正在打开', completed: '已打开' }),
  browser_observe: Object.freeze({ kind: 'browser', presentation: 'browser', active: '正在观察', completed: '已观察' }),
  browser_click: Object.freeze({ kind: 'browser', presentation: 'browser', active: '正在操作', completed: '已操作' }),
  browser_type: Object.freeze({ kind: 'browser', presentation: 'browser', active: '正在操作', completed: '已操作' }),
  browser_select_option: Object.freeze({ kind: 'browser', presentation: 'browser', active: '正在操作', completed: '已操作' }),
  browser_press_key: Object.freeze({ kind: 'browser', presentation: 'browser', active: '正在操作', completed: '已操作' }),
  browser_scroll: Object.freeze({ kind: 'browser', presentation: 'browser', active: '正在操作', completed: '已操作' }),
  browser_reload_latest_source: Object.freeze({ kind: 'browser', presentation: 'browser', active: '正在重新加载', completed: '已重新加载' }),
  browser_close: Object.freeze({ kind: 'browser', presentation: 'browser', active: '正在关闭', completed: '已关闭' }),
  ask_user_question: Object.freeze({
    kind: 'question', presentation: 'question', active: '等待你的回答：', completed: '已回答：',
  }),
});
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const UNSAFE_TEXT_PATTERN = /[\p{Cf}\p{Bidi_Control}]/u;
const SECRET_LIKE_PATTERN = /(?:api[_-]?key|access[_-]?token|authorization|password|secret|credential|private[_-]?key)\s*[:=]/iu;
// Preserve upstream text-delta granularity for the renderer. Durable SQLite
// amplification is controlled downstream by the generation service batcher.
// Keep the durable conversation chain bounded without sacrificing sentence-level
// live progress. The final assistant/message event always flushes the remainder.
const ASSISTANT_DELTA_FLUSH_BYTES = 512;
const ASSISTANT_DELTA_MAX_BYTES = 16 * 1_024;

class BuilderHarnessRuntimeEventNormalizerError extends Error {
  constructor(code = 'builder_harness_runtime_event_invalid') {
    const selected = [
      'builder_harness_runtime_event_invalid',
      'builder_harness_runtime_event_conflict',
      'builder_harness_runtime_event_unsupported_tool',
      'builder_harness_runtime_event_closed',
    ].includes(code) ? code : 'builder_harness_runtime_event_invalid';
    const messages = {
      builder_harness_runtime_event_invalid: 'The Harness runtime event could not be verified.',
      builder_harness_runtime_event_conflict: 'The Harness runtime event conflicts with the active run.',
      builder_harness_runtime_event_unsupported_tool: 'The Harness runtime requested an unsupported tool.',
      builder_harness_runtime_event_closed: 'The Harness runtime event stream is closed.',
    };
    super(messages[selected]);
    this.name = 'BuilderHarnessRuntimeEventNormalizerError';
    this.code = selected;
    this.retryable = false;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) {
  throw new BuilderHarnessRuntimeEventNormalizerError(code);
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || utilTypes.isProxy(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function objectValue(value, key) {
  if (!isPlainObject(value)) fail();
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail();
  return descriptor.value;
}

function optionalObjectValue(value, key) {
  if (!isPlainObject(value)) fail();
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor) return undefined;
  if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail();
  return descriptor.value;
}

function safeString(value, maximumBytes = 16 * 1_024, allowFormatting = false) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.normalize('NFC') !== value
    || Buffer.byteLength(value, 'utf8') > maximumBytes
    || UNSAFE_TEXT_PATTERN.test(value)
  ) fail();
  if (!allowFormatting && /[\r\n\t]/u.test(value)) fail();
  return value;
}

function safePossiblyEmptyString(value, maximumBytes = 16 * 1_024) {
  if (
    typeof value !== 'string'
    || value.normalize('NFC') !== value
    || Buffer.byteLength(value, 'utf8') > maximumBytes
    || UNSAFE_TEXT_PATTERN.test(value)
  ) fail();
  return value;
}

function safeInteger(value, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) fail();
  return value;
}

function safeFiniteNumber(value, minimum = 0, maximum = 2_147_483_647) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    fail();
  }
  return value;
}

function sha256(value) {
  return `sha256:${nodeCrypto.createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

function digestRef(prefix, value) {
  return `${prefix}:${sha256(value).slice('sha256:'.length)}`;
}

function deterministicUuid(value) {
  const bytes = nodeCrypto.createHash('sha256').update(value, 'utf8').digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  if (!UUID_PATTERN.test(uuid)) fail();
  return uuid;
}

function scopedToolKey(record, callId) {
  return `${record.step_id}:${callId}`;
}

function safeRelativeTarget(rawValue, workspaceRoot) {
  const value = safeString(rawValue, 4 * 1_024).trim();
  if (value.length === 0 || value.includes('\0')) fail();
  let relative = value;
  if (path.isAbsolute(value)) {
    relative = path.relative(workspaceRoot, path.resolve(value));
  }
  relative = relative.replaceAll('\\', '/').replace(/^\.\//u, '');
  if (
    relative.length === 0
    || relative === '..'
    || relative.startsWith('../')
    || path.posix.isAbsolute(relative)
    || relative.length > 240
  ) fail('builder_harness_runtime_event_conflict');
  return relative;
}

function safeToolTarget(rawValue, workspaceRoot, fallback) {
  try {
    return Object.freeze({
      target: safeRelativeTarget(rawValue, workspaceRoot),
      requires_failure: false,
      rejection_code: null,
    });
  } catch (error) {
    if (
      error instanceof BuilderHarnessRuntimeEventNormalizerError
      && error.code === 'builder_harness_runtime_event_conflict'
    ) {
      return Object.freeze({
        target: fallback,
        requires_failure: true,
        rejection_code: 'builder_harness_runtime_event_conflict',
      });
    }
    throw error;
  }
}

function safeCommandDisplay(rawValue) {
  const command = safeString(rawValue, 8 * 1_024, true).replace(/[\r\n\t]+/gu, ' ').trim();
  if (command.length === 0) fail();
  if (SECRET_LIKE_PATTERN.test(command) || /(?:^|\s)(?:[A-Za-z]:[\\/]|\\\\|\/(?!\/))/u.test(command)) {
    return 'project command';
  }
  return command.length <= 160 ? command : `${command.slice(0, 157)}...`;
}

function parseArguments(rawValue) {
  const text = safeString(rawValue, 256 * 1_024, true);
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    fail();
  }
  if (!isPlainObject(value)) fail();
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || ['__proto__', 'prototype', 'constructor'].includes(key)) fail();
  }
  return { text, value };
}

function exactObjectWithOptional(value, requiredKeys, optionalKeys = []) {
  if (!isPlainObject(value)) fail();
  const keys = Reflect.ownKeys(value);
  const allowed = [...requiredKeys, ...optionalKeys];
  if (
    keys.some((key) => typeof key !== 'string' || !allowed.includes(key))
    || requiredKeys.some((key) => !keys.includes(key))
  ) fail();
  for (const key of keys) objectValue(value, key);
  return value;
}

function safeToolResultPresentationDetail(rawData, tool, workspaceRoot) {
  const rawMeta = optionalObjectValue(rawData, 'meta');
  if (rawMeta === undefined) return null;
  const kind = safeString(objectValue(rawMeta, 'kind'), 32);
  if (kind === 'read') {
    if (tool.kind !== 'read') fail('builder_harness_runtime_event_conflict');
    const meta = exactObjectWithOptional(
      rawMeta,
      ['kind', 'path', 'offset', 'lines', 'totalLines'],
      ['lang'],
    );
    const target = safeRelativeTarget(objectValue(meta, 'path'), workspaceRoot);
    if (target !== tool.target) fail('builder_harness_runtime_event_conflict');
    const rawLines = objectValue(meta, 'lines');
    if (!Array.isArray(rawLines) || rawLines.length > 100_000) fail();
    let firstLine = null;
    let lastLine = null;
    for (const rawLine of rawLines) {
      const line = exactObjectWithOptional(rawLine, ['number', 'text']);
      const number = safeInteger(objectValue(line, 'number'), 1);
      safePossiblyEmptyString(objectValue(line, 'text'), 64 * 1_024);
      if (lastLine !== null && number <= lastLine) fail();
      firstLine ??= number;
      lastLine = number;
    }
    const language = optionalObjectValue(meta, 'lang');
    return {
      detail_kind: 'read',
      path: target,
      offset: safeInteger(objectValue(meta, 'offset'), 1),
      returned_lines: rawLines.length,
      total_lines: safeInteger(objectValue(meta, 'totalLines')),
      first_line: firstLine,
      last_line: lastLine,
      language_hint: language === undefined ? null : safeString(language, 32),
    };
  }
  if (kind === 'search') {
    if (tool.kind !== 'search') fail('builder_harness_runtime_event_conflict');
    const meta = exactObjectWithOptional(rawMeta, [
      'kind', 'query', 'matches', 'truncated', 'total',
    ]);
    safeString(objectValue(meta, 'query'), 512, true);
    const rawMatches = objectValue(meta, 'matches');
    if (!Array.isArray(rawMatches) || rawMatches.length > 100) fail();
    const matches = rawMatches.map((rawMatch) => {
      const match = exactObjectWithOptional(rawMatch, ['path', 'line', 'column', 'preview']);
      const target = safeRelativeTarget(objectValue(match, 'path'), workspaceRoot);
      safePossiblyEmptyString(objectValue(match, 'preview'), 4 * 1_024);
      return {
        path: target,
        line: safeInteger(objectValue(match, 'line')),
        column: safeInteger(objectValue(match, 'column')),
      };
    });
    const truncated = objectValue(meta, 'truncated');
    if (typeof truncated !== 'boolean') fail();
    const total = safeInteger(objectValue(meta, 'total'));
    if (total < matches.length || (truncated && total <= matches.length)) fail();
    return { detail_kind: 'search', matches, truncated, total };
  }
  if (kind === 'diff') {
    if (!['edit', 'write'].includes(tool.kind)) fail('builder_harness_runtime_event_conflict');
    const meta = exactObjectWithOptional(rawMeta, [
      'kind', 'path', 'oldText', 'newText', 'addedLines', 'deletedLines',
    ]);
    const target = safeRelativeTarget(objectValue(meta, 'path'), workspaceRoot);
    if (target !== tool.target) fail('builder_harness_runtime_event_conflict');
    const oldText = objectValue(meta, 'oldText');
    if (oldText !== null) safePossiblyEmptyString(oldText, 512 * 1_024);
    safePossiblyEmptyString(objectValue(meta, 'newText'), 512 * 1_024);
    return {
      detail_kind: 'diff',
      path: target,
      added_lines: safeInteger(objectValue(meta, 'addedLines')),
      deleted_lines: safeInteger(objectValue(meta, 'deletedLines')),
    };
  }
  if (kind === 'command') {
    if (tool.kind !== 'command') fail('builder_harness_runtime_event_conflict');
    const meta = exactObjectWithOptional(rawMeta, [
      'kind', 'status', 'command', 'exitCode', 'durationMs',
      'stdoutPreview', 'stderrPreview', 'truncated',
    ]);
    const status = safeString(objectValue(meta, 'status'), 32);
    if (![
      'passed', 'failed', 'timed_out', 'cancelled', 'output_exceeded',
      'spawn_failed', 'termination_failed',
    ].includes(status)) fail();
    const command = safeCommandDisplay(objectValue(meta, 'command'));
    if (command !== tool.target) fail('builder_harness_runtime_event_conflict');
    const exitCode = objectValue(meta, 'exitCode');
    if (exitCode !== null) safeInteger(exitCode, 0);
    safePossiblyEmptyString(objectValue(meta, 'stdoutPreview'), 64 * 1_024);
    safePossiblyEmptyString(objectValue(meta, 'stderrPreview'), 64 * 1_024);
    const truncated = objectValue(meta, 'truncated');
    if (typeof truncated !== 'boolean') fail();
    return {
      detail_kind: 'command',
      status,
      command,
      exit_code: exitCode,
      duration_ms: safeInteger(objectValue(meta, 'durationMs')),
      truncated,
    };
  }
  fail();
}

function toolPresentation(name, args, workspaceRoot, useChinese) {
  const definition = (useChinese ? TOOL_MAP_ZH : TOOL_MAP)[name];
  if (!definition) return null;
  let target;
  let requiresFailure = false;
  let rejectionCode = null;
  if (name === 'bash') {
    target = safeCommandDisplay(objectValue(args, 'command'));
  } else if (name.startsWith('browser_')) {
    target = useChinese ? 'Agent Test 浏览器' : 'Agent Test browser';
  } else if (name === 'ask_user_question') {
    const questions = objectValue(args, 'questions');
    if (!Array.isArray(questions) || questions.length !== 1 || !isPlainObject(questions[0])) fail();
    const question = safeString(objectValue(questions[0], 'question'), 4 * 1_024);
    const rawOptions = optionalObjectValue(questions[0], 'options');
    let optionSuffix = '';
    if (rawOptions !== undefined) {
      if (!Array.isArray(rawOptions) || rawOptions.length > 3) fail();
      const labels = rawOptions.map((rawOption) => {
        if (!isPlainObject(rawOption)) fail();
        return safeString(objectValue(rawOption, 'label'), 512);
      });
      if (labels.length > 0) optionSuffix = ` (${labels.join(' / ')})`;
    }
    const display = `${question}${optionSuffix}`;
    target = display.length <= 112 ? display : `${display.slice(0, 109)}...`;
  } else if (name === 'grep' || name === 'glob') {
    const rawPath = optionalObjectValue(args, 'path');
    if (rawPath === undefined) {
      target = useChinese ? '项目文件' : 'project files';
    } else {
      const checkedTarget = safeToolTarget(
        rawPath,
        workspaceRoot,
        useChinese ? '项目文件' : 'project files',
      );
      target = checkedTarget.target;
      requiresFailure = checkedTarget.requires_failure;
      rejectionCode = checkedTarget.rejection_code;
    }
  } else {
    const rawPath = optionalObjectValue(args, 'file_path') ?? optionalObjectValue(args, 'path');
    if (rawPath === undefined) fail();
    const checkedTarget = safeToolTarget(
      rawPath,
      workspaceRoot,
      useChinese ? '项目文件' : 'project file',
    );
    target = checkedTarget.target;
    requiresFailure = checkedTarget.requires_failure;
    rejectionCode = checkedTarget.rejection_code;
  }
  return Object.freeze({
    ...definition,
    target,
    active_label: `${definition.active} ${target}`,
    completed_label: `${definition.completed} ${target}`,
    requires_failure: requiresFailure,
    rejection_code: rejectionCode,
  });
}

function assistantText(rawMessage) {
  if (objectValue(rawMessage, 'role') !== 'assistant') fail();
  const content = objectValue(rawMessage, 'content');
  if (!Array.isArray(content)) fail();
  let text = '';
  for (const block of content) {
    if (!isPlainObject(block)) fail();
    const type = objectValue(block, 'type');
    if (type === 'text') text += safeString(objectValue(block, 'text'), 256 * 1_024, true);
    else if (!['reasoning', 'tool-call'].includes(type)) fail();
  }
  return text;
}

function safeTokenUsage(rawUsage, contextWindowTokens) {
  if (!isPlainObject(rawUsage)) fail();
  const usage = {
    input_tokens: safeInteger(objectValue(rawUsage, 'inputTokens')),
    output_tokens: safeInteger(objectValue(rawUsage, 'outputTokens')),
    cache_read_tokens: null,
    cache_write_tokens: null,
    reasoning_tokens: null,
    context_window_tokens: contextWindowTokens,
  };
  for (const [sourceKey, targetKey] of [
    ['cacheReadTokens', 'cache_read_tokens'],
    ['cacheWriteTokens', 'cache_write_tokens'],
    ['reasoningTokens', 'reasoning_tokens'],
  ]) {
    const value = optionalObjectValue(rawUsage, sourceKey);
    if (value !== undefined) usage[targetKey] = safeInteger(value);
  }
  return Object.freeze(usage);
}

function safeFinishReason(rawReason) {
  if (!isPlainObject(rawReason)) fail();
  const kind = safeString(objectValue(rawReason, 'kind'), 80);
  if (!['stop', 'tool-calls', 'max-tokens', 'aborted', 'error'].includes(kind)) fail();
  if (kind === 'aborted' || kind === 'error') {
    const failure = objectValue(rawReason, 'failure');
    safeString(objectValue(failure, 'message'), 64 * 1_024, true);
    safeString(objectValue(failure, 'code'), 160);
  }
  return kind;
}

function toolResultFailed(rawData) {
  if (optionalObjectValue(rawData, 'error') !== undefined) return true;
  const message = objectValue(rawData, 'message');
  const content = objectValue(message, 'content');
  if (!Array.isArray(content) || content.length !== 1) fail();
  const block = content[0];
  if (objectValue(block, 'type') !== 'tool-result') fail();
  return optionalObjectValue(block, 'isError') === true;
}

function safeShadowedSelection(rawData, eventSeq) {
  const range = objectValue(rawData, 'shadowedRange');
  const start = safeInteger(objectValue(range, 'start'));
  const end = safeInteger(objectValue(range, 'end'));
  if (start > end || end >= eventSeq) fail('builder_harness_runtime_event_conflict');
  const shadowedSeqs = objectValue(rawData, 'shadowedSeqs');
  if (
    !Array.isArray(shadowedSeqs)
    || utilTypes.isProxy(shadowedSeqs)
    || shadowedSeqs.length < 1
    || shadowedSeqs.length > 4_096
  ) fail();
  for (let index = 0; index < shadowedSeqs.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(shadowedSeqs, String(index));
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail();
    const sourceSeq = safeInteger(descriptor.value);
    if (sourceSeq < start || sourceSeq > end || sourceSeq >= eventSeq) {
      fail('builder_harness_runtime_event_conflict');
    }
  }
}

function safeCompactionId(rawData) {
  return safeString(objectValue(rawData, 'compactionId'), 512);
}

function safeCompactionSummary(rawValue) {
  if (
    !Array.isArray(rawValue)
    || utilTypes.isProxy(rawValue)
    || rawValue.length < 1
    || rawValue.length > 256
  ) fail();
  const keys = Reflect.ownKeys(rawValue);
  if (keys.length !== rawValue.length + 1 || keys.some((key) => typeof key === 'symbol')) fail();
  let totalBytes = 0;
  for (let index = 0; index < rawValue.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(rawValue, String(index));
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail();
    const block = descriptor.value;
    if (objectValue(block, 'type') !== 'text') fail();
    const text = safeString(objectValue(block, 'text'), 512 * 1_024, true);
    totalBytes += Buffer.byteLength(text, 'utf8');
    if (totalBytes > 512 * 1_024) fail();
  }
}

function safeTodoSnapshot(rawData) {
  const todos = objectValue(rawData, 'todos');
  if (
    !Array.isArray(todos)
    || utilTypes.isProxy(todos)
    || todos.length > 128
  ) fail();
  let completed = 0;
  let inProgress = 0;
  for (let index = 0; index < todos.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(todos, String(index));
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail();
    const todo = descriptor.value;
    safeString(objectValue(todo, 'content'), 2 * 1_024, true);
    const status = safeString(objectValue(todo, 'status'), 32);
    if (!['pending', 'in_progress', 'completed'].includes(status)) fail();
    if (status === 'completed') completed += 1;
    if (status === 'in_progress') inProgress += 1;
  }
  return Object.freeze({ total: todos.length, completed, in_progress: inProgress });
}

function createBuilderHarnessRuntimeEventNormalizer(rawOptions) {
  if (!isPlainObject(rawOptions)) fail();
  const runContract = sanitizeBuilderProgrammingRuntimeRunContract(
    objectValue(rawOptions, 'run_contract'),
  );
  const useChinese = /\p{Script=Han}/u.test(runContract.input.text);
  const sink = objectValue(rawOptions, 'event_sink');
  const emitMethod = objectValue(sink, 'emit');
  const sessionId = safeString(objectValue(rawOptions, 'session_id'), 512);
  const workspaceRoot = path.resolve(safeString(objectValue(rawOptions, 'workspace_root'), 4 * 1_024));
  const clock = objectValue(rawOptions, 'clock');
  if (
    typeof emitMethod !== 'function'
    || utilTypes.isProxy(emitMethod)
    || typeof clock !== 'function'
    || utilTypes.isProxy(clock)
  ) fail();

  const seenSeq = new Map();
  let lastSeenSeq = -1;
  const steps = new Map();
  const tools = new Map();
  const retries = new Map();
  const compactions = new Map();
  let eventIndex = 0;
  let expectedStepIndex = 1;
  let runStarted = false;
  let turnStarted = false;
  let harnessTurnActive = false;
  let turnSettled = false;
  let settlementFinished = false;
  let successfulSettlement = false;
  let completed = false;
  let closed = false;
  let harnessTurn = null;
  let lastAssistantText = '';
  let lastReasoningStatus = null;
  let lastRuntimeActivity = null;
  let contextWindowTokens = null;
  let successfulMutationToolCallCount = 0;
  let verificationStepId = null;
  let verificationIndex = 0;
  let settlement;
  let settlementResolve;

  function resetSettlement() {
    settlementFinished = false;
    settlement = new Promise((resolve) => { settlementResolve = resolve; });
  }

  resetSettlement();

  function markFailed(error) {
    if (!settlementFinished) {
      settlementFinished = true;
      settlementResolve(Object.freeze({
        status: 'failed',
        failure_code: error instanceof BuilderHarnessRuntimeEventNormalizerError
          ? error.code
          : 'builder_harness_runtime_event_invalid',
      }));
    }
  }

  async function emit(eventType, payload, ids = {}, occurredAtMs) {
    eventIndex += 1;
    const occurredAt = occurredAtMs === undefined
      ? safeInteger(Number(Reflect.apply(clock, undefined, [])))
      : safeInteger(occurredAtMs);
    const candidate = Object.freeze({
      protocol_version: BUILDER_PROGRAMMING_RUNTIME_PROTOCOL_VERSION,
      runtime_event_ref: `harness:${eventIndex}:${eventType.replaceAll('_', '.')}`,
      run_id: runContract.admission.run_id,
      occurred_at_ms: occurredAt,
      turn_id: ids.turn_id ?? null,
      step_id: ids.step_id ?? null,
      tool_call_id: ids.tool_call_id ?? null,
      event_type: eventType,
      payload,
    });
    const result = await Promise.resolve(Reflect.apply(emitMethod, sink, [candidate]));
    if (isPlainObject(result) && optionalObjectValue(result, 'accepted') === false) {
      fail('builder_harness_runtime_event_conflict');
    }
  }

  function stepRecord(turn, step) {
    const key = `${turn}:${step}`;
    const record = steps.get(key);
    if (!record) fail('builder_harness_runtime_event_conflict');
    return record;
  }

  async function flushAssistantText(record, observedAtMs) {
    if (record.pending_text.length === 0) return;
    const deltaText = record.pending_text;
    record.pending_text = '';
    record.published_text += deltaText;
    await emit('assistant_text_delta', {
      message_id: record.message_id,
      delta_text: deltaText,
    }, {
      turn_id: runContract.admission.turn_id,
      step_id: record.step_id,
    }, observedAtMs);
  }

  async function emitReasoningStatus(status, record = null, observedAtMs) {
    if (!turnStarted || !harnessTurnActive || status === lastReasoningStatus) return false;
    await emit('assistant_reasoning_status', { status }, {
      turn_id: runContract.admission.turn_id,
      ...(record === null ? {} : { step_id: record.step_id }),
    }, observedAtMs);
    lastReasoningStatus = status;
    return true;
  }

  async function emitRuntimeActivity(activityKind, status, record = null, observedAtMs) {
    const identity = `${activityKind}:${status}`;
    if (identity === lastRuntimeActivity) return false;
    await emit('runtime_activity_status', { activity_kind: activityKind, status }, {
      ...(turnStarted && harnessTurnActive ? { turn_id: runContract.admission.turn_id } : {}),
      ...(record === null ? {} : { step_id: record.step_id }),
    }, observedAtMs);
    lastRuntimeActivity = identity;
    return true;
  }

  async function start() {
    if (closed) fail('builder_harness_runtime_event_closed');
    if (runStarted) fail('builder_harness_runtime_event_conflict');
    await emit('run_started', { mode: runContract.admission.mode });
    runStarted = true;
    return Object.freeze({ normalizer_version: BUILDER_HARNESS_RUNTIME_EVENT_NORMALIZER_VERSION });
  }

  async function handleSessionEvent(event) {
    const type = safeString(objectValue(event, 'type'), 160);
    const seq = safeInteger(objectValue(event, 'seq'));
    const sourceTime = safeInteger(objectValue(event, 'time'));
    const observedAtMs = safeInteger(Number(Reflect.apply(clock, undefined, [])));
    const data = objectValue(event, 'data');
    const digest = sha256(JSON.stringify(event));
    const existing = seenSeq.get(seq);
    if (existing !== undefined) {
      if (existing !== digest) fail('builder_harness_runtime_event_conflict');
      return false;
    }
    if (seq <= lastSeenSeq) fail('builder_harness_runtime_event_conflict');
    seenSeq.set(seq, digest);
    lastSeenSeq = seq;

    const surfaceOp = optionalObjectValue(event, 'surfaceOp');
    if (surfaceOp !== undefined && surfaceOp !== 'append') {
      if (!isPlainObject(surfaceOp) || objectValue(surfaceOp, 'op') !== 'replace') fail();
      if (!['user/message', 'tool/result'].includes(type)) fail();
      const start = safeInteger(objectValue(surfaceOp, 'start'));
      const end = safeInteger(objectValue(surfaceOp, 'end'));
      if (start > end || end >= seq) fail('builder_harness_runtime_event_conflict');
      const sourceEventSeqs = objectValue(event, 'sourceEventSeqs');
      if (!Array.isArray(sourceEventSeqs) || sourceEventSeqs.length < 1) fail();
      for (const sourceSeq of sourceEventSeqs) {
        if (safeInteger(sourceSeq) >= seq) fail('builder_harness_runtime_event_conflict');
      }
      return false;
    }

    if (type === 'request/context') {
      safeString(objectValue(data, 'provider'), 512);
      safeString(objectValue(data, 'model'), 512);
      const rawContextWindow = optionalObjectValue(data, 'contextWindow');
      contextWindowTokens = rawContextWindow === undefined
        ? null
        : safeInteger(rawContextWindow, 1);
      return false;
    }
    if (type === 'compaction/prune') {
      safeShadowedSelection(data, seq);
      safeFiniteNumber(objectValue(data, 'shadowedTokenCount'));
      return false;
    }
    if (type === 'compaction/start') {
      const compactionId = safeCompactionId(data);
      const turn = objectValue(data, 'turn');
      if (turn !== null) safeInteger(turn, 1);
      const sourceCommandId = optionalObjectValue(data, 'sourceCommandId');
      if (sourceCommandId !== undefined) safeString(sourceCommandId, 512);
      if (compactions.has(compactionId)) fail('builder_harness_runtime_event_conflict');
      compactions.set(compactionId, { summary_seen: false });
      await emitRuntimeActivity('context_compacting', '上下文较长，正在整理', null, observedAtMs);
      return false;
    }
    if (type === 'compaction/summary') {
      const compactionId = safeCompactionId(data);
      const record = compactions.get(compactionId);
      if (!record || record.summary_seen) fail('builder_harness_runtime_event_conflict');
      safeShadowedSelection(data, seq);
      safeFiniteNumber(objectValue(data, 'shadowedTokenCount'));
      safeString(objectValue(data, 'provider'), 512);
      safeString(objectValue(data, 'model'), 512);
      safeCompactionSummary(objectValue(data, 'summary'));
      record.summary_seen = true;
      return false;
    }
    if (type === 'compaction/end') {
      const compactionId = safeCompactionId(data);
      if (!compactions.has(compactionId)) fail('builder_harness_runtime_event_conflict');
      const turn = objectValue(data, 'turn');
      if (turn !== null) safeInteger(turn, 1);
      compactions.delete(compactionId);
      await emitRuntimeActivity('context_compacted', '上下文整理完成，继续处理', null, observedAtMs);
      return false;
    }

    if (type === 'turn/start') {
      if (!runStarted || harnessTurnActive || turnSettled) {
        fail('builder_harness_runtime_event_conflict');
      }
      harnessTurn = safeInteger(objectValue(data, 'turn'), 1);
      if (!turnStarted) {
        await emit('turn_started', { message_id: runContract.input.message_id }, {
          turn_id: runContract.admission.turn_id,
        }, observedAtMs);
        turnStarted = true;
      }
      harnessTurnActive = true;
      await emitRuntimeActivity('turn_preparing', '正在理解任务', null, observedAtMs);
      return true;
    }
    if (type === 'step/start') {
      const turn = safeInteger(objectValue(data, 'turn'), 1);
      const step = safeInteger(objectValue(data, 'step'), 1);
      if (!harnessTurnActive || turn !== harnessTurn) fail('builder_harness_runtime_event_conflict');
      const key = `${turn}:${step}`;
      if (steps.has(key) || [...steps.values()].some((item) => item.active)) {
        fail('builder_harness_runtime_event_conflict');
      }
      const record = {
        step_id: `builder-run-step:${deterministicUuid(`${runContract.admission.run_id}:harness:${key}`)}`,
        message_id: `builder-message:${deterministicUuid(`${runContract.admission.run_id}:harness:${key}:assistant`)}`,
        text: '',
        pending_text: '',
        published_text: '',
        text_completed: false,
        retry_waiting: false,
        reasoning_status_seen: false,
        usage: null,
        finish_reason: null,
        active: true,
      };
      steps.set(key, record);
      lastReasoningStatus = null;
      await emit('step_started', { step_index: expectedStepIndex }, {
        turn_id: runContract.admission.turn_id,
        step_id: record.step_id,
      }, observedAtMs);
      expectedStepIndex += 1;
      await emitRuntimeActivity('step_analyzing', '正在分析下一步', record, observedAtMs);
      return true;
    }
    if (type === 'assistant/chunk') {
      const turn = safeInteger(objectValue(data, 'turn'), 1);
      const step = safeInteger(objectValue(data, 'step'), 1);
      const record = stepRecord(turn, step);
      if (record.retry_waiting) fail('builder_harness_runtime_event_conflict');
      const chunk = objectValue(data, 'chunk');
      const chunkType = safeString(objectValue(chunk, 'type'), 80);
      if (!['usage', 'finish'].includes(chunkType)) safeInteger(objectValue(chunk, 'index'));
      if (chunkType === 'reasoning-delta') {
        // Validate and account for the upstream reasoning stream without
        // disclosing chain-of-thought text to the public conversation.
        const reasoningDelta = safePossiblyEmptyString(objectValue(chunk, 'text'), 16 * 1_024);
        if (reasoningDelta.length > 0 && !record.reasoning_status_seen) {
          record.reasoning_status_seen = true;
          await emitReasoningStatus('正在思考', record, observedAtMs);
        }
        return true;
      }
      if (chunkType === 'block-start') {
        const blockType = safeString(objectValue(chunk, 'blockType'), 80);
        if (!['text', 'reasoning', 'image', 'tool-call', 'tool-result'].includes(blockType)) fail();
        if (blockType === 'reasoning' && !record.reasoning_status_seen) {
          record.reasoning_status_seen = true;
          await emitReasoningStatus('正在思考', record, observedAtMs);
        } else if (blockType === 'tool-call') {
          await emitRuntimeActivity('generation_finishing', '正在准备工具调用', record, observedAtMs);
        }
        return true;
      }
      if (chunkType === 'tool-call-delta') {
        safeString(objectValue(chunk, 'id'), 512);
        const name = optionalObjectValue(chunk, 'name');
        if (name !== undefined) safeString(name, 160);
        safePossiblyEmptyString(objectValue(chunk, 'argumentsDelta'), 64 * 1_024);
        await emitRuntimeActivity('generation_finishing', '正在准备工具调用', record, observedAtMs);
        return true;
      }
      if (chunkType === 'block-end') {
        const block = objectValue(chunk, 'block');
        const blockType = safeString(objectValue(block, 'type'), 80);
        if (!['text', 'reasoning', 'image', 'tool-call', 'tool-result'].includes(blockType)) fail();
        return true;
      }
      if (chunkType === 'usage') {
        if (record.usage !== null) fail('builder_harness_runtime_event_conflict');
        record.usage = safeTokenUsage(objectValue(chunk, 'usage'), contextWindowTokens);
        await emit('model_usage_recorded', record.usage, {
          turn_id: runContract.admission.turn_id,
          step_id: record.step_id,
        }, observedAtMs);
        return true;
      }
      if (chunkType === 'finish') {
        if (record.finish_reason !== null) fail('builder_harness_runtime_event_conflict');
        record.finish_reason = safeFinishReason(objectValue(chunk, 'reason'));
        const replayState = optionalObjectValue(chunk, 'replayState');
        if (replayState !== undefined) {
          const serializedReplayState = JSON.stringify(replayState);
          if (
            serializedReplayState === undefined
            || Buffer.byteLength(serializedReplayState, 'utf8') > 1024 * 1024
          ) fail();
        }
        await emit('model_finish_recorded', { reason_kind: record.finish_reason }, {
          turn_id: runContract.admission.turn_id,
          step_id: record.step_id,
        }, observedAtMs);
        if (record.finish_reason !== 'tool-calls') {
          await emitRuntimeActivity('generation_finishing', '正在整理结果', record, observedAtMs);
        }
        return true;
      }
      if (chunkType !== 'text-delta') return false;
      const delta = safePossiblyEmptyString(objectValue(chunk, 'text'), 16 * 1_024);
      if (delta.length === 0) return true;
      record.text += delta;
      if (
        record.pending_text.length > 0
        && Buffer.byteLength(record.pending_text + delta, 'utf8') > ASSISTANT_DELTA_MAX_BYTES
      ) await flushAssistantText(record, observedAtMs);
      record.pending_text += delta;
      if (
        Buffer.byteLength(record.pending_text, 'utf8') >= ASSISTANT_DELTA_FLUSH_BYTES
        || /(?:\n\s*\n|[.!?。！？]\s*$)/u.test(record.pending_text)
      ) await flushAssistantText(record, observedAtMs);
      return true;
    }
    if (type === 'assistant/message') {
      const turn = safeInteger(objectValue(data, 'turn'), 1);
      const step = safeInteger(objectValue(data, 'step'), 1);
      const record = stepRecord(turn, step);
      if (record.retry_waiting) fail('builder_harness_runtime_event_conflict');
      if (record.text_completed) fail('builder_harness_runtime_event_conflict');
      const text = assistantText(objectValue(data, 'message'));
      const messageUsage = optionalObjectValue(data, 'usage');
      if (messageUsage !== undefined) {
        const usage = safeTokenUsage(messageUsage, contextWindowTokens);
        if (record.usage === null) {
          record.usage = usage;
          await emit('model_usage_recorded', usage, {
            turn_id: runContract.admission.turn_id,
            step_id: record.step_id,
          }, observedAtMs);
        } else if (JSON.stringify(record.usage) !== JSON.stringify(usage)) {
          fail('builder_harness_runtime_event_conflict');
        }
      }
      if (record.text.length > 0 && record.text !== text) fail('builder_harness_runtime_event_conflict');
      if (record.text.length === 0 && text.length > 0) {
        record.text = text;
        record.pending_text = text;
      }
      await flushAssistantText(record, observedAtMs);
      if (text.length > 0) {
        await emit('assistant_text_completed', {
          message_id: record.message_id,
          text_digest: sha256(text),
          text_bytes: Buffer.byteLength(text, 'utf8'),
        }, {
          turn_id: runContract.admission.turn_id,
          step_id: record.step_id,
        }, observedAtMs);
      }
      if (text.length > 0) lastAssistantText = text;
      record.text_completed = true;
      return true;
    }
    if (type === 'todo/write') {
      // The todo body remains Harness-owned. Builder exposes only a bounded
      // lifecycle cue so private task text is not copied into public activity.
      const todoSnapshot = safeTodoSnapshot(data);
      const activeRecord = [...steps.values()].find((record) => record.active) ?? null;
      const status = todoSnapshot.total === 0
        ? '已清空任务计划'
        : `已更新任务计划（${todoSnapshot.completed}/${todoSnapshot.total} 已完成）`;
      await emitRuntimeActivity('todo_updated', status, activeRecord, observedAtMs);
      return true;
    }
    if (type === 'llm/retry') {
      const turn = safeInteger(objectValue(data, 'turn'), 1);
      const step = safeInteger(objectValue(data, 'step'), 1);
      const record = stepRecord(turn, step);
      if (
        !record.active
        || record.text_completed
        || record.retry_waiting
        || [...tools.values()].some((tool) => tool.step_id === record.step_id && !tool.settled)
      ) fail('builder_harness_runtime_event_conflict');
      const retryId = safeString(objectValue(data, 'retryId'), 512);
      const retry = safeInteger(objectValue(data, 'retry'), 1);
      const mode = safeString(objectValue(data, 'mode'), 16);
      if (!['normal', 'always'].includes(mode)) fail();
      safeString(objectValue(data, 'provider'), 512);
      safeString(objectValue(data, 'policyKey'), 8 * 1_024);
      safeFiniteNumber(objectValue(data, 'delayMs'));
      const failure = objectValue(data, 'failure');
      safeString(objectValue(failure, 'message'), 64 * 1_024, true);
      safeString(objectValue(failure, 'code'), 160);
      if (mode === 'normal') {
        const maxRetries = safeInteger(objectValue(data, 'maxRetries'), 1);
        if (retry > maxRetries) fail();
      }
      const key = `${retryId}:${retry}`;
      if (retries.has(key)) fail('builder_harness_runtime_event_conflict');
      retries.set(key, { turn, step, started: false });
      if (record.published_text.length > 0) {
        await emit('assistant_text_discarded', {
          message_id: record.message_id,
          text_digest: sha256(record.published_text),
          text_bytes: Buffer.byteLength(record.published_text, 'utf8'),
        }, {
          turn_id: runContract.admission.turn_id,
          step_id: record.step_id,
        }, observedAtMs);
      }
      record.text = '';
      record.pending_text = '';
      record.published_text = '';
      record.retry_waiting = true;
      await emitRuntimeActivity('model_retry_waiting', `模型请求暂时失败，准备第 ${retry} 次重试`, record, observedAtMs);
      return false;
    }
    if (type === 'llm/retry-started') {
      const turn = safeInteger(objectValue(data, 'turn'), 1);
      const step = safeInteger(objectValue(data, 'step'), 1);
      const retryId = safeString(objectValue(data, 'retryId'), 512);
      const retry = safeInteger(objectValue(data, 'retry'), 1);
      const record = stepRecord(turn, step);
      const retryRecord = retries.get(`${retryId}:${retry}`);
      if (
        !record.active
        || !record.retry_waiting
        || retryRecord === undefined
        || retryRecord.started
        || retryRecord.turn !== turn
        || retryRecord.step !== step
      ) fail('builder_harness_runtime_event_conflict');
      retryRecord.started = true;
      record.retry_waiting = false;
      await emitRuntimeActivity('model_retrying', `正在进行第 ${retry} 次重试`, record, observedAtMs);
      return false;
    }
    if (type === 'tool/call') {
      const turn = safeInteger(objectValue(data, 'turn'), 1);
      const step = safeInteger(objectValue(data, 'step'), 1);
      const record = stepRecord(turn, step);
      await flushAssistantText(record, observedAtMs);
      const callId = safeString(objectValue(data, 'callId'), 512);
      const name = safeString(objectValue(data, 'name'), 160);
      const toolKey = scopedToolKey(record, callId);
      if (tools.has(toolKey)) fail('builder_harness_runtime_event_conflict');
      const parsed = parseArguments(objectValue(data, 'arguments'));
      const presentation = toolPresentation(name, parsed.value, workspaceRoot, useChinese);
      const toolCallId = `builder-tool-call:${deterministicUuid(`${runContract.admission.run_id}:harness-tool:${toolKey}`)}`;
      if (
        presentation === null
        || !runContract.admission.allowed_tools.includes(presentation.kind)
      ) {
        tools.set(toolKey, {
          tool_call_id: toolCallId,
          step_id: record.step_id,
          kind: null,
          completed_label: null,
          started_at_ms: sourceTime,
          settled: false,
          visible: false,
          requires_failure: true,
          rejection_code: 'builder_harness_runtime_event_unsupported_tool',
        });
        return true;
      }
      tools.set(toolKey, {
        tool_call_id: toolCallId,
        step_id: record.step_id,
        kind: presentation.kind,
        completed_label: presentation.completed_label,
        target: presentation.target,
        started_at_ms: sourceTime,
        settled: false,
        visible: true,
        requires_failure: presentation.requires_failure,
        rejection_code: presentation.rejection_code,
      });
      await emit('tool_call_started', {
        tool_kind: presentation.kind,
        active_label: presentation.active_label,
        completed_label: presentation.completed_label,
        target_label: presentation.target,
        presentation: presentation.presentation,
        argument_digest: sha256(parsed.text),
      }, {
        turn_id: runContract.admission.turn_id,
        step_id: record.step_id,
        tool_call_id: toolCallId,
      }, observedAtMs);
      return true;
    }
    if (type === 'tool/result') {
      const turn = safeInteger(objectValue(data, 'turn'), 1);
      const step = safeInteger(objectValue(data, 'step'), 1);
      const record = stepRecord(turn, step);
      const message = objectValue(data, 'message');
      const source = objectValue(message, 'source');
      const callId = safeString(objectValue(source, 'callId'), 512);
      const tool = tools.get(scopedToolKey(record, callId));
      if (!tool || tool.settled || tool.step_id !== record.step_id) {
        fail('builder_harness_runtime_event_conflict');
      }
      const durationMs = Math.max(0, sourceTime - tool.started_at_ms);
      const failed = toolResultFailed(data);
      if (tool.requires_failure && !failed) fail(tool.rejection_code);
      if (!tool.visible) {
        tool.settled = true;
        return true;
      }
      const ids = {
        turn_id: runContract.admission.turn_id,
        step_id: record.step_id,
        tool_call_id: tool.tool_call_id,
      };
      const presentationDetail = failed
        ? null
        : safeToolResultPresentationDetail(data, tool, workspaceRoot);
      const commandFailed = presentationDetail?.detail_kind === 'command'
        && presentationDetail.status !== 'passed';
      if (presentationDetail?.detail_kind === 'command') {
        await emit('check_result_recorded', {
          command_ref: digestRef(
            'builder-runtime-command-result',
            `${runContract.admission.run_id}:${callId}:${seq}:command`,
          ),
          status: commandFailed ? 'failed' : 'passed',
          duration_ms: presentationDetail.duration_ms,
          summary: commandFailed
            ? useChinese
              ? `${tool.target} 未通过（${presentationDetail.status}）。`
              : `${tool.target} did not pass (${presentationDetail.status}).`
            : useChinese ? `${tool.target} 已通过。` : `${tool.target} passed.`,
        }, ids, observedAtMs);
      }
      if (failed || commandFailed) {
        const failureClass = presentationDetail?.status === 'timed_out'
          ? 'timeout'
          : presentationDetail?.status === 'cancelled'
            ? 'cancelled'
            : presentationDetail?.detail_kind === 'command'
              ? 'check_failed'
              : 'runtime_failure';
        await emit('tool_call_failed', {
          duration_ms: presentationDetail?.duration_ms ?? durationMs,
          failure_class: failureClass,
          safe_message: commandFailed
            ? useChinese ? `${tool.target} 未通过。` : `${tool.target} did not pass.`
            : useChinese ? `${tool.completed_label}时出错。` : `${tool.completed_label} with an error.`,
        }, ids, observedAtMs);
      } else {
        await emit('tool_call_completed', {
          duration_ms: presentationDetail?.duration_ms ?? durationMs,
          result_kind: tool.kind,
          result_ref: digestRef('builder-runtime-tool-result', `${runContract.admission.run_id}:${callId}:${seq}`),
          summary: `${tool.completed_label}${useChinese ? '。' : '.'}`,
          presentation_detail: presentationDetail,
        }, ids, observedAtMs);
        if (tool.kind === 'edit' || tool.kind === 'write') {
          successfulMutationToolCallCount += 1;
        }
      }
      tool.settled = true;
      return true;
    }
    if (type === 'step/end') {
      const turn = safeInteger(objectValue(data, 'turn'), 1);
      const step = safeInteger(objectValue(data, 'step'), 1);
      const record = stepRecord(turn, step);
      if (!record.active || [...tools.values()].some((tool) => tool.step_id === record.step_id && !tool.settled)) {
        fail('builder_harness_runtime_event_conflict');
      }
      await emit('step_completed', { outcome: 'completed' }, {
        turn_id: runContract.admission.turn_id,
        step_id: record.step_id,
      }, observedAtMs);
      record.active = false;
      return true;
    }
    if (type === 'turn/end') {
      const turn = safeInteger(objectValue(data, 'turn'), 1);
      if (
        !turnStarted
        || !harnessTurnActive
        || turn !== harnessTurn
        || turnSettled
        || compactions.size > 0
        || [...steps.values()].some((record) => record.active)
      ) fail('builder_harness_runtime_event_conflict');
      const reason = objectValue(data, 'reason');
      const kind = safeString(objectValue(reason, 'kind'), 80);
      const successful = kind === 'completed' || kind === 'max-tokens';
      harnessTurnActive = false;
      turnSettled = true;
      if (successful) {
        if (runContract.admission.mode === 'build') {
          verificationIndex += 1;
          verificationStepId = `builder-run-step:${deterministicUuid(
            `${runContract.admission.run_id}:builder-verification:${verificationIndex}`,
          )}`;
          steps.set(`builder:verification:${verificationIndex}`, {
            step_id: verificationStepId,
            message_id: null,
            text: '',
            published_text: '',
            text_completed: true,
            retry_waiting: false,
            active: true,
          });
          await emit('step_started', { step_index: expectedStepIndex }, {
            turn_id: runContract.admission.turn_id,
            step_id: verificationStepId,
          }, observedAtMs);
          expectedStepIndex += 1;
        } else {
          await emit('turn_completed', { outcome: 'completed' }, {
            turn_id: runContract.admission.turn_id,
          }, observedAtMs);
        }
        successfulSettlement = true;
        if (!settlementFinished) {
          settlementFinished = true;
          settlementResolve(Object.freeze({ status: 'settled', reason: kind }));
        }
      } else if (kind === 'aborted') {
        await emit('turn_completed', { outcome: 'failed' }, {
          turn_id: runContract.admission.turn_id,
        }, observedAtMs);
        await emit('run_cancelled', {
          failure_class: 'cancelled',
          safe_message: 'The Harness coding run was cancelled.',
        }, { turn_id: runContract.admission.turn_id }, observedAtMs);
        closed = true;
        if (!settlementFinished) {
          settlementFinished = true;
          settlementResolve(Object.freeze({ status: 'cancelled', reason: kind }));
        }
      } else {
        await emit('turn_completed', { outcome: 'failed' }, {
          turn_id: runContract.admission.turn_id,
        }, observedAtMs);
        await emit('run_failed', {
          failure_class: kind === 'error' ? 'provider_failure' : 'runtime_failure',
          safe_message: 'The Harness coding run did not complete.',
        }, { turn_id: runContract.admission.turn_id }, observedAtMs);
        closed = true;
        if (!settlementFinished) {
          settlementFinished = true;
          settlementResolve(Object.freeze({ status: 'failed', reason: kind }));
        }
      }
      return true;
    }
    if (IGNORED_SESSION_EVENTS.includes(type) || optionalObjectValue(event, 'ignorable') === true) {
      return false;
    }
    fail();
  }

  async function handleNotification(rawNotification) {
    if (closed) fail('builder_harness_runtime_event_closed');
    try {
      const method = safeString(objectValue(rawNotification, 'method'), 80);
      if (!NOTIFICATION_METHODS.includes(method)) fail();
      const params = objectValue(rawNotification, 'params');
      if (method === 'subagent.started') {
        const parentSessionId = safeString(objectValue(params, 'parentSessionId'), 512);
        safeString(objectValue(params, 'childSessionId'), 512);
        if (parentSessionId !== sessionId) return false;
        return await emitRuntimeActivity('subagent_started', '已启动并行任务');
      }
      if (method === 'subagent.finished') {
        const parentSessionId = safeString(objectValue(params, 'parentSessionId'), 512);
        safeString(objectValue(params, 'childSessionId'), 512);
        safeString(objectValue(params, 'provider'), 512);
        safeString(objectValue(params, 'agentId'), 512);
        const status = safeString(objectValue(params, 'status'), 16);
        if (!['ok', 'error'].includes(status)) fail();
        const stopReason = safeString(objectValue(params, 'stopReason'), 80);
        if (!['completed', 'aborted', 'error', 'max-tokens', 'refusal'].includes(stopReason)) fail();
        const lastAssistantMessage = optionalObjectValue(params, 'lastAssistantMessage');
        if (lastAssistantMessage !== undefined && (
          !Array.isArray(lastAssistantMessage)
          || utilTypes.isProxy(lastAssistantMessage)
          || lastAssistantMessage.length > 256
        )) fail();
        if (parentSessionId !== sessionId) return false;
        return await emitRuntimeActivity(
          'subagent_finished',
          status === 'ok' ? '并行任务已完成' : '并行任务未完成',
        );
      }
      const notificationSessionId = safeString(objectValue(params, 'sessionId'), 512);
      if (notificationSessionId !== sessionId) return false;
      if (method === 'session.context-usage') {
        const projection = exactObjectWithOptional(params, [
          'sessionId',
          'projectionSeq',
          'uncachedInputTokens',
          'outputTokens',
          'cacheReadTokens',
          'cacheWriteTokens',
          'pressureTokens',
          'projectedTokens',
          'contextWindowTokens',
        ]);
        const nullableCount = (value, minimum = 0) => value === null
          ? null
          : safeInteger(value, minimum);
        const pressureTokens = nullableCount(objectValue(projection, 'pressureTokens'));
        const projectedTokens = nullableCount(objectValue(projection, 'projectedTokens'));
        if (projectedTokens !== null && pressureTokens === null) fail();
        await emit('context_usage_projected', {
          harness_projection_seq: safeInteger(objectValue(projection, 'projectionSeq'), -1),
          uncached_input_tokens: safeInteger(objectValue(projection, 'uncachedInputTokens')),
          output_tokens: safeInteger(objectValue(projection, 'outputTokens')),
          cache_read_tokens: safeInteger(objectValue(projection, 'cacheReadTokens')),
          cache_write_tokens: safeInteger(objectValue(projection, 'cacheWriteTokens')),
          pressure_tokens: pressureTokens,
          projected_tokens: projectedTokens,
          context_window_tokens: nullableCount(objectValue(projection, 'contextWindowTokens'), 1),
        });
        return true;
      }
      if (method === 'session.status') {
        const status = safeString(objectValue(params, 'status'), 80);
        if (!['running', 'idle'].includes(status)) fail();
        return await emitRuntimeActivity(
          status === 'running' ? 'session_running' : 'session_idle',
          status === 'running' ? '正在运行' : '已完成当前运行',
        );
      }
      return await handleSessionEvent(objectValue(params, 'event'));
    } catch (error) {
      markFailed(error);
      if (error instanceof BuilderHarnessRuntimeEventNormalizerError) throw error;
      fail();
    }
  }

  async function completeRun(rawCompletion) {
    if (closed || completed) fail('builder_harness_runtime_event_closed');
    if (!turnSettled || !successfulSettlement) fail('builder_harness_runtime_event_conflict');
    const checkpointStatus = objectValue(rawCompletion, 'checkpoint_status');
    const expected = runContract.admission.mode === 'build'
      ? ['not_applicable', 'created', 'updated']
      : ['not_applicable'];
    if (!expected.includes(checkpointStatus)) fail();
    if (runContract.admission.mode === 'build') {
      const verification = steps.get(`builder:verification:${verificationIndex}`);
      if (
        verificationStepId === null
        || !verification
        || verification.step_id !== verificationStepId
        || verification.active !== true
      ) fail('builder_harness_runtime_event_conflict');
      await emit('step_completed', { outcome: 'completed' }, {
        turn_id: runContract.admission.turn_id,
        step_id: verificationStepId,
      });
      verification.active = false;
      await emit('turn_completed', { outcome: 'completed' }, {
        turn_id: runContract.admission.turn_id,
      });
    }
    await emit('run_completed', {
      outcome: { ask: 'answered', plan: 'planned', build: 'built' }[runContract.admission.mode],
      checkpoint_status: checkpointStatus,
    });
    completed = true;
    closed = true;
    return Object.freeze({
      normalizer_version: BUILDER_HARNESS_RUNTIME_EVENT_NORMALIZER_VERSION,
      status: 'completed',
    });
  }

  function whenSettled() {
    return settlement;
  }

  async function prepareRepair(rawRepair) {
    if (!isPlainObject(rawRepair)) fail();
    const failureSummary = safeString(objectValue(rawRepair, 'failure_summary'), 1_440, true);
    if (
      closed
      || completed
      || runContract.admission.mode !== 'build'
      || !turnSettled
      || !successfulSettlement
      || verificationStepId === null
    ) fail('builder_harness_runtime_event_conflict');
    const verification = steps.get(`builder:verification:${verificationIndex}`);
    if (!verification || verification.step_id !== verificationStepId || verification.active !== true) {
      fail('builder_harness_runtime_event_conflict');
    }
    await emit('step_completed', { outcome: 'failed' }, {
      turn_id: runContract.admission.turn_id,
      step_id: verificationStepId,
    });
    void failureSummary;
    verification.active = false;
    verificationStepId = null;
    turnSettled = false;
    successfulSettlement = false;
    harnessTurn = null;
    lastAssistantText = '';
    resetSettlement();
    return Object.freeze({
      normalizer_version: BUILDER_HARNESS_RUNTIME_EVENT_NORMALIZER_VERSION,
      status: 'repair_ready',
    });
  }

  async function failRun(rawFailure = {}) {
    if (!isPlainObject(rawFailure)) fail();
    if (closed) return false;
    const failureClass = optionalObjectValue(rawFailure, 'failure_class') ?? 'invalid_event';
    if (![
      'cancelled',
      'timeout',
      'provider_failure',
      'runtime_failure',
      'invalid_event',
      'runtime_idle_timeout',
      'run_limit_reached',
    ].includes(failureClass)) {
      fail();
    }
    const safeMessage = optionalObjectValue(rawFailure, 'safe_message')
      ?? 'The Harness coding run stopped because its runtime events could not be verified.';
    safeString(safeMessage, 1_440);
    for (const tool of tools.values()) {
      if (tool.settled) continue;
      if (tool.visible) {
        await emit('tool_call_failed', {
          duration_ms: 0,
          failure_class: failureClass === 'cancelled' ? 'cancelled' : 'runtime_failure',
          safe_message: 'The active Harness tool did not complete.',
        }, {
          turn_id: runContract.admission.turn_id,
          step_id: tool.step_id,
          tool_call_id: tool.tool_call_id,
        });
      }
      tool.settled = true;
    }
    const activeStep = [...steps.values()].find((record) => record.active);
    if (activeStep) {
      await emit('step_completed', { outcome: 'failed' }, {
        turn_id: runContract.admission.turn_id,
        step_id: activeStep.step_id,
      });
      activeStep.active = false;
    }
    if (turnStarted && (!turnSettled || verificationStepId !== null)) {
      await emit('turn_completed', { outcome: 'failed' }, {
        turn_id: runContract.admission.turn_id,
      });
      turnSettled = true;
      verificationStepId = null;
    }
    if (runStarted) {
      await emit(failureClass === 'cancelled' ? 'run_cancelled' : 'run_failed', {
        failure_class: failureClass,
        safe_message: safeMessage,
      }, turnStarted ? { turn_id: runContract.admission.turn_id } : {});
    }
    closed = true;
    if (!settlementFinished) {
      settlementFinished = true;
      settlementResolve(Object.freeze({ status: 'failed', failure_code: failureClass }));
    }
    return true;
  }

  function snapshot() {
    return Object.freeze({
      normalizer_version: BUILDER_HARNESS_RUNTIME_EVENT_NORMALIZER_VERSION,
      run_started: runStarted,
      turn_started: turnStarted,
      harness_turn_active: harnessTurnActive,
      turn_settled: turnSettled,
      completed,
      closed,
      accepted_session_event_count: seenSeq.size,
      active_compaction_count: compactions.size,
      active_tool_count: [...tools.values()].filter((tool) => !tool.settled).length,
      tool_call_count: tools.size,
      successful_mutation_tool_call_count: successfulMutationToolCallCount,
      last_assistant_text: lastAssistantText,
      verification_step_id: verificationStepId,
    });
  }

  // SDK notifications and Builder repair/finalization share one mutable journal.
  // Keep the entire transition ordered, including its asynchronous persistence.
  let transitionChain = Promise.resolve();
  function serializeTransition(operation, args) {
    const result = transitionChain.then(() => Reflect.apply(operation, undefined, args));
    transitionChain = result.catch(() => {});
    return result;
  }

  return Object.freeze({
    normalizer_version: BUILDER_HARNESS_RUNTIME_EVENT_NORMALIZER_VERSION,
    start: (...args) => serializeTransition(start, args),
    handle_notification: (...args) => serializeTransition(handleNotification, args),
    when_settled: whenSettled,
    prepare_repair: (...args) => serializeTransition(prepareRepair, args),
    fail_run: (...args) => serializeTransition(failRun, args),
    complete_run: (...args) => serializeTransition(completeRun, args),
    snapshot,
  });
}

module.exports = Object.freeze({
  BUILDER_HARNESS_RUNTIME_EVENT_NORMALIZER_VERSION,
  BuilderHarnessRuntimeEventNormalizerError,
  createBuilderHarnessRuntimeEventNormalizer,
});
