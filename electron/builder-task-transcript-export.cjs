'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const {
  createBuilderConversationExport,
} = require('./builder-conversation-export.cjs');
const {
  sanitizeBuilderTaskAddress,
} = require('./builder-session-task-address.cjs');

const BUILDER_TASK_TRANSCRIPT_EXPORT_VERSION = 'builder-task-transcript-export.v1';
const MAX_EXPORT_BYTES = 4 * 1024 * 1024;

const INPUT_KEYS = Object.freeze([
  'task_address',
  'loaded_conversation',
  'exported_at_ms',
]);

const LIFECYCLE = Object.freeze({
  export_authority: 'main_task_transcript_export_contract_v1',
  task_address_authority: 'main_owned_session_task_address_store',
  conversation_authority: 'sqlite_conversation_replay_read_only',
  renderer_authority: 'task_export_request_only',
  provider_dispatch: 'not_performed',
  source_read: 'not_performed',
  source_write: 'not_performed',
  git_mutation: 'not_performed',
  sqlite_write: 'not_performed',
  sqlite_delete: 'not_performed',
  export_materialization: 'not_performed',
});

const ERROR_MESSAGE = 'Builder task transcript export could not be verified.';

class BuilderTaskTranscriptExportError extends Error {
  constructor() {
    super(ERROR_MESSAGE);
    this.name = 'BuilderTaskTranscriptExportError';
    this.code = 'builder_task_transcript_export_invalid';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderTaskTranscriptExportError();
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
  for (const key of actual) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  }
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

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail();
  return value;
}

function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(valueAt(value, key))}`
    )).join(',')}}`;
  }
  fail();
}

function taskExportIdFor(body) {
  return `builder-task-transcript-export:${nodeCrypto.createHash('sha256')
    .update(canonicalJson(body), 'utf8')
    .digest('hex')}`;
}

function boundedText(text) {
  if (Buffer.byteLength(text, 'utf8') > MAX_EXPORT_BYTES) fail();
  return text;
}

function taskHeader(taskAddress) {
  return [
    '# ClawFabric Task Transcript',
    '',
    `Task: ${taskAddress.title}`,
    `Task address: ${taskAddress.task_address_id}`,
    `Project: ${taskAddress.project_id}`,
    `Conversation: ${taskAddress.conversation_id}`,
    `Status: ${taskAddress.status}`,
    '',
    '## Goal',
    '',
    taskAddress.goal,
    '',
    '## Conversation',
    '',
  ].join('\n');
}

function taskJsonlHeader(taskAddress, conversationExport, exportedAtMs) {
  return `${canonicalJson({
    entry_kind: 'task_transcript_export',
    export_version: BUILDER_TASK_TRANSCRIPT_EXPORT_VERSION,
    project_id: taskAddress.project_id,
    task_address_id: taskAddress.task_address_id,
    task_id: taskAddress.task_address_id,
    session_id: taskAddress.session_id,
    conversation_id: taskAddress.conversation_id,
    exported_at_ms: exportedAtMs,
    status: taskAddress.status,
    conversation_export_id: conversationExport.export_id,
    source_authority: 'main_task_address_to_sqlite_conversation_replay_read_only',
  })}\n`;
}

function createBuilderTaskTranscriptExport(rawInput) {
  exactObject(rawInput, INPUT_KEYS);
  const exportedAtMs = safeTimestamp(valueAt(rawInput, 'exported_at_ms'));
  const taskAddress = sanitizeBuilderTaskAddress(valueAt(rawInput, 'task_address'));
  let conversationExport;
  try {
    conversationExport = createBuilderConversationExport({
      loaded_conversation: valueAt(rawInput, 'loaded_conversation'),
      exported_at_ms: exportedAtMs,
    });
  } catch {
    fail();
  }
  if (
    conversationExport.project_id !== taskAddress.project_id
    || conversationExport.conversation_id !== taskAddress.conversation_id
  ) fail();
  const markdownText = boundedText(`${taskHeader(taskAddress)}${conversationExport.formats.markdown.text}`);
  const jsonlText = boundedText(
    `${taskJsonlHeader(taskAddress, conversationExport, exportedAtMs)}${conversationExport.formats.jsonl.text}`,
  );
  const body = freezeDeep({
    project_id: taskAddress.project_id,
    task_address_id: taskAddress.task_address_id,
    task_id: taskAddress.task_address_id,
    session_id: taskAddress.session_id,
    conversation_id: taskAddress.conversation_id,
    exported_at_ms: exportedAtMs,
    task: {
      title: taskAddress.title,
      goal: taskAddress.goal,
      status: taskAddress.status,
    },
    source: {
      authority: 'main_task_address_to_sqlite_conversation_replay_read_only',
      event_count: conversationExport.source.event_count,
      current_sequence: conversationExport.source.current_sequence,
      conversation_export_id: conversationExport.export_id,
    },
    formats: {
      jsonl: {
        media_type: 'application/x-ndjson',
        byte_length: Buffer.byteLength(jsonlText, 'utf8'),
        text: jsonlText,
      },
      markdown: {
        media_type: 'text/markdown; charset=utf-8',
        byte_length: Buffer.byteLength(markdownText, 'utf8'),
        text: markdownText,
      },
    },
    lifecycle: { ...LIFECYCLE },
  });
  return freezeDeep({
    export_version: BUILDER_TASK_TRANSCRIPT_EXPORT_VERSION,
    export_id: taskExportIdFor(body),
    ...body,
  });
}

module.exports = Object.freeze({
  BUILDER_TASK_TRANSCRIPT_EXPORT_VERSION,
  BuilderTaskTranscriptExportError,
  createBuilderTaskTranscriptExport,
});
