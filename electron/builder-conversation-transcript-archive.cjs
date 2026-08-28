'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { types: utilTypes } = require('node:util');

const {
  createBuilderConversationCompactionProjection,
  createBuilderConversationExport,
} = require('./builder-conversation-export.cjs');

const BUILDER_CONVERSATION_TRANSCRIPT_ARCHIVE_VERSION =
  'builder-conversation-transcript-archive.v1';
const BUILDER_CONVERSATION_TRANSCRIPT_CHECKPOINT_VERSION =
  'builder-conversation-transcript-checkpoint.v1';
const BUILDER_CONVERSATION_TRANSCRIPT_RESULT_VERSION =
  'builder-conversation-transcript-archive-result.v1';
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const PROJECT_ID_PATTERN = new RegExp(`^builder-project:(${UUID_SOURCE})$`, 'u');
const CONVERSATION_ID_PATTERN = new RegExp(`^builder-conversation:(${UUID_SOURCE})$`, 'u');
const MESSAGE_ID_PATTERN = new RegExp(`^builder-message:${UUID_SOURCE}$`, 'u');
const TURN_ID_PATTERN = new RegExp(`^builder-turn:${UUID_SOURCE}$`, 'u');
const TASK_ID_PATTERN = new RegExp(`^builder-task:${UUID_SOURCE}$`, 'u');
const RUN_ID_PATTERN = new RegExp(`^builder-run:${UUID_SOURCE}$`, 'u');
const DRAFT_ID_PATTERN = /^builder-generation-draft:[0-9a-f]{64}$/u;
const EVENT_ID_PATTERN = /^builder-conversation-event:[0-9a-f]{64}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const EXPORT_ID_PATTERN = /^builder-conversation-export:[0-9a-f]{64}$/u;
const MAX_TEXT_LENGTH = 16 * 1024;
const MAX_PUBLIC_ENTRIES = 4096;
const MAX_CHECKPOINTS = 4096;
const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;

const ERROR_MESSAGES = Object.freeze({
  builder_conversation_transcript_invalid: 'Conversation transcript data could not be verified.',
  builder_conversation_transcript_integrity_failed: 'Conversation transcript integrity could not be verified.',
  builder_conversation_transcript_resource_exceeded: 'Conversation transcript storage limits were reached.',
  builder_conversation_transcript_unavailable: 'Conversation transcript storage is unavailable.',
});

class BuilderConversationTranscriptArchiveError extends Error {
  constructor(code = 'builder_conversation_transcript_invalid') {
    const selected = Object.hasOwn(ERROR_MESSAGES, code)
      ? code
      : 'builder_conversation_transcript_invalid';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderConversationTranscriptArchiveError';
    this.code = selected;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code = 'builder_conversation_transcript_invalid') {
  throw new BuilderConversationTranscriptArchiveError(code);
}

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freezeDeep(nested);
    Object.freeze(value);
  }
  return value;
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || utilTypes.isProxy(value)) {
    return false;
  }
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
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail();
  }
}

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail();
  return descriptor.value;
}

function safePattern(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) fail();
  return value;
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail();
  return value;
}

function safeSequence(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 1_000_000) fail();
  return value;
}

function safeText(value) {
  if (typeof value !== 'string' || value.length > MAX_TEXT_LENGTH) fail();
  return value;
}

function safeEnum(value, allowed) {
  if (typeof value !== 'string' || !allowed.includes(value)) fail();
  return value;
}

function denseArray(value, maximum = MAX_PUBLIC_ENTRIES) {
  if (!Array.isArray(value) || utilTypes.isProxy(value) || value.length > maximum) fail();
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== value.length + 1
    || !keys.includes('length')
    || keys.some((key) => typeof key === 'symbol')
  ) fail();
  const output = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail();
    output.push(descriptor.value);
  }
  return output;
}

function safeTask(value) {
  if (value === null) return null;
  exactObject(value, ['task_id', 'title']);
  return {
    task_id: safePattern(valueAt(value, 'task_id'), TASK_ID_PATTERN),
    title: safeText(valueAt(value, 'title')),
  };
}

function safeCandidate(value) {
  if (value === null) return null;
  exactObject(value, ['draft_id', 'title', 'summary']);
  return {
    draft_id: safePattern(valueAt(value, 'draft_id'), DRAFT_ID_PATTERN),
    title: safeText(valueAt(value, 'title')),
    summary: safeText(valueAt(value, 'summary')),
  };
}

function sanitizePublicEntry(value) {
  if (!isPlainObject(value)) fail();
  const kind = valueAt(value, 'entry_kind');
  if (kind === 'turn') {
    exactObject(value, ['entry_kind', 'turn_id', 'mode', 'status', 'task', 'outcome']);
    return freezeDeep({
      entry_kind: kind,
      turn_id: safePattern(valueAt(value, 'turn_id'), TURN_ID_PATTERN),
      mode: safeEnum(valueAt(value, 'mode'), ['question', 'work']),
      status: safeEnum(valueAt(value, 'status'), ['active', 'running', 'completed']),
      task: safeTask(valueAt(value, 'task')),
      outcome: valueAt(value, 'outcome') === null ? null : safeEnum(valueAt(value, 'outcome'), [
        'answered', 'responded', 'plan_proposed', 'candidate_ready', 'failed', 'interrupted', 'cancelled',
      ]),
    });
  }
  if (kind === 'message') {
    exactObject(value, ['entry_kind', 'turn_id', 'message_id', 'role', 'kind', 'text']);
    return freezeDeep({
      entry_kind: kind,
      turn_id: safePattern(valueAt(value, 'turn_id'), TURN_ID_PATTERN),
      message_id: safePattern(valueAt(value, 'message_id'), MESSAGE_ID_PATTERN),
      role: safeEnum(valueAt(value, 'role'), ['user', 'assistant']),
      kind: safeEnum(valueAt(value, 'kind'), ['submitted', 'steering', 'queued_followup', 'run_result']),
      text: safeText(valueAt(value, 'text')),
    });
  }
  if (kind === 'run') {
    exactObject(value, [
      'entry_kind', 'turn_id', 'run_id', 'attempt_number', 'status', 'terminal_status',
      'result_kind', 'progress_stages', 'candidate', 'candidate_review',
    ]);
    const attemptNumber = valueAt(value, 'attempt_number');
    if (!Number.isSafeInteger(attemptNumber) || attemptNumber < 1 || attemptNumber > 16) fail();
    return freezeDeep({
      entry_kind: kind,
      turn_id: safePattern(valueAt(value, 'turn_id'), TURN_ID_PATTERN),
      run_id: safePattern(valueAt(value, 'run_id'), RUN_ID_PATTERN),
      attempt_number: attemptNumber,
      status: safeEnum(valueAt(value, 'status'), ['running', 'completed']),
      terminal_status: valueAt(value, 'terminal_status') === null ? null : safeEnum(
        valueAt(value, 'terminal_status'),
        ['succeeded', 'failed', 'interrupted', 'cancelled'],
      ),
      result_kind: valueAt(value, 'result_kind') === null ? null : safeEnum(
        valueAt(value, 'result_kind'),
        ['explanation', 'plan', 'candidate', 'failure'],
      ),
      progress_stages: denseArray(valueAt(value, 'progress_stages'), 8).map((stage) => safeEnum(stage, [
        'context_ready', 'provider_request_started', 'provider_response_received', 'result_preparing',
      ])),
      candidate: safeCandidate(valueAt(value, 'candidate')),
      candidate_review: valueAt(value, 'candidate_review') === null ? null : safeEnum(
        valueAt(value, 'candidate_review'),
        ['accepted', 'rejected'],
      ),
    });
  }
  fail();
}

function publicEntryKey(entry) {
  if (entry.entry_kind === 'turn') return `turn:${entry.turn_id}`;
  if (entry.entry_kind === 'message') return `message:${entry.message_id}`;
  return `run:${entry.run_id}`;
}

function safeRootPath(value) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > 1024
    || value.trim() !== value
    || value.includes('\0')
    || !path.isAbsolute(value)
    || path.resolve(value) !== value
  ) fail();
  let stat;
  try { stat = fs.lstatSync(value); } catch { fail('builder_conversation_transcript_unavailable'); }
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail('builder_conversation_transcript_unavailable');
  return value;
}

function idParts(projectId, conversationId) {
  const projectMatch = PROJECT_ID_PATTERN.exec(projectId);
  const conversationMatch = CONVERSATION_ID_PATTERN.exec(conversationId);
  if (projectMatch === null || conversationMatch === null || projectMatch[1] !== conversationMatch[1]) fail();
  return { projectUuid: projectMatch[1], conversationUuid: conversationMatch[1] };
}

function archivePath(rootPath, projectId, conversationId, createProjectDirectory) {
  const parts = idParts(projectId, conversationId);
  const projectDirectory = path.join(rootPath, `builder-project-${parts.projectUuid}`);
  try {
    if (createProjectDirectory) fs.mkdirSync(projectDirectory, { recursive: true, mode: 0o700 });
    if (!createProjectDirectory && !fs.existsSync(projectDirectory)) {
      return path.join(projectDirectory, `builder-conversation-${parts.conversationUuid}.jsonl`);
    }
    const stat = fs.lstatSync(projectDirectory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail('builder_conversation_transcript_unavailable');
  } catch (error) {
    if (error instanceof BuilderConversationTranscriptArchiveError) throw error;
    fail('builder_conversation_transcript_unavailable');
  }
  const filePath = path.join(projectDirectory, `builder-conversation-${parts.conversationUuid}.jsonl`);
  if (path.dirname(filePath) !== projectDirectory) fail();
  return filePath;
}

function parsePublicEntries(exported) {
  let lines;
  try {
    lines = exported.formats.jsonl.text.trimEnd().split('\n').map((line) => JSON.parse(line));
  } catch {
    fail('builder_conversation_transcript_integrity_failed');
  }
  if (lines.length < 1 || lines[0]?.entry_kind !== 'conversation_export') {
    fail('builder_conversation_transcript_integrity_failed');
  }
  return freezeDeep(lines.slice(1).map(sanitizePublicEntry));
}

function checkpointFromExport(exported, sourceHead, archivedAtMs, changes) {
  return freezeDeep({
    schema_version: BUILDER_CONVERSATION_TRANSCRIPT_CHECKPOINT_VERSION,
    project_id: exported.project_id,
    conversation_id: exported.conversation_id,
    sequence: safeSequence(exported.source.current_sequence),
    event_id: safePattern(sourceHead.current_event_id, EVENT_ID_PATTERN),
    event_digest: safePattern(sourceHead.current_event_digest, DIGEST_PATTERN),
    archived_at_ms: safeTimestamp(archivedAtMs),
    export_id: safePattern(exported.export_id, EXPORT_ID_PATTERN),
    source_authority: 'sqlite_conversation_replay_read_only',
    public_changes: freezeDeep(changes.map(sanitizePublicEntry)),
  });
}

function sanitizeCheckpoint(value) {
  exactObject(value, [
    'schema_version', 'project_id', 'conversation_id', 'sequence', 'event_id', 'event_digest',
    'archived_at_ms', 'export_id', 'source_authority', 'public_changes',
  ]);
  if (
    valueAt(value, 'schema_version') !== BUILDER_CONVERSATION_TRANSCRIPT_CHECKPOINT_VERSION
    || valueAt(value, 'source_authority') !== 'sqlite_conversation_replay_read_only'
  ) fail('builder_conversation_transcript_integrity_failed');
  const projectId = safePattern(valueAt(value, 'project_id'), PROJECT_ID_PATTERN);
  const conversationId = safePattern(valueAt(value, 'conversation_id'), CONVERSATION_ID_PATTERN);
  idParts(projectId, conversationId);
  return freezeDeep({
    schema_version: BUILDER_CONVERSATION_TRANSCRIPT_CHECKPOINT_VERSION,
    project_id: projectId,
    conversation_id: conversationId,
    sequence: safeSequence(valueAt(value, 'sequence')),
    event_id: safePattern(valueAt(value, 'event_id'), EVENT_ID_PATTERN),
    event_digest: safePattern(valueAt(value, 'event_digest'), DIGEST_PATTERN),
    archived_at_ms: safeTimestamp(valueAt(value, 'archived_at_ms')),
    export_id: safePattern(valueAt(value, 'export_id'), EXPORT_ID_PATTERN),
    source_authority: 'sqlite_conversation_replay_read_only',
    public_changes: freezeDeep(denseArray(valueAt(value, 'public_changes')).map(sanitizePublicEntry)),
  });
}

function readArchive(filePath, expectedProjectId, expectedConversationId) {
  if (!fs.existsSync(filePath)) return null;
  let stat;
  let text;
  try {
    stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_ARCHIVE_BYTES) {
      fail('builder_conversation_transcript_integrity_failed');
    }
    text = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if (error instanceof BuilderConversationTranscriptArchiveError) throw error;
    fail('builder_conversation_transcript_unavailable');
  }
  const rawLines = text.split('\n').filter((line) => line.length > 0);
  if (rawLines.length < 1 || rawLines.length > MAX_CHECKPOINTS) {
    fail('builder_conversation_transcript_integrity_failed');
  }
  const ordered = [];
  const byKey = new Map();
  let latest = null;
  for (const rawLine of rawLines) {
    let checkpoint;
    try { checkpoint = sanitizeCheckpoint(JSON.parse(rawLine)); } catch (error) {
      if (error instanceof BuilderConversationTranscriptArchiveError) throw error;
      fail('builder_conversation_transcript_integrity_failed');
    }
    if (
      checkpoint.project_id !== expectedProjectId
      || checkpoint.conversation_id !== expectedConversationId
      || (latest !== null && checkpoint.sequence <= latest.sequence)
    ) fail('builder_conversation_transcript_integrity_failed');
    for (const entry of checkpoint.public_changes) {
      const key = publicEntryKey(entry);
      if (!byKey.has(key)) ordered.push(key);
      byKey.set(key, entry);
    }
    latest = checkpoint;
  }
  return freezeDeep({
    latest,
    public_entries: freezeDeep(ordered.map((key) => byKey.get(key))),
  });
}

function appendCheckpoint(filePath, checkpoint) {
  const line = `${JSON.stringify(checkpoint)}\n`;
  if (Buffer.byteLength(line, 'utf8') > MAX_ARCHIVE_BYTES) fail('builder_conversation_transcript_resource_exceeded');
  let descriptor = null;
  try {
    descriptor = fs.openSync(filePath, 'a', 0o600);
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.size > MAX_ARCHIVE_BYTES - Buffer.byteLength(line, 'utf8')) {
      fail('builder_conversation_transcript_resource_exceeded');
    }
    fs.writeFileSync(descriptor, line, 'utf8');
    fs.fsyncSync(descriptor);
  } catch (error) {
    if (error instanceof BuilderConversationTranscriptArchiveError) throw error;
    fail('builder_conversation_transcript_unavailable');
  } finally {
    if (descriptor !== null) {
      try { fs.closeSync(descriptor); } catch { /* operation result is already fixed */ }
    }
  }
}

function replaceArchive(filePath, checkpoint) {
  const temporaryPath = `${filePath}.repair-${process.pid}-${Date.now()}`;
  let descriptor = null;
  try {
    descriptor = fs.openSync(temporaryPath, 'wx', 0o600);
    fs.writeFileSync(descriptor, `${JSON.stringify(checkpoint)}\n`, 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    fs.renameSync(temporaryPath, filePath);
  } catch (error) {
    if (descriptor !== null) {
      try { fs.closeSync(descriptor); } catch { /* fixed failure below */ }
    }
    try { fs.unlinkSync(temporaryPath); } catch { /* best-effort temporary cleanup */ }
    if (error instanceof BuilderConversationTranscriptArchiveError) throw error;
    fail('builder_conversation_transcript_unavailable');
  }
}

function result(operation, checkpoint, entryCount) {
  return freezeDeep({
    result_version: BUILDER_CONVERSATION_TRANSCRIPT_RESULT_VERSION,
    operation,
    project_id: checkpoint.project_id,
    conversation_id: checkpoint.conversation_id,
    sequence: checkpoint.sequence,
    event_id: checkpoint.event_id,
    event_digest: checkpoint.event_digest,
    public_entry_count: entryCount,
    authority: 'sqlite_derived_non_authoritative_transcript',
  });
}

function createBuilderConversationTranscriptArchive(rawOptions) {
  exactObject(rawOptions, ['root_path']);
  const rootPath = safeRootPath(valueAt(rawOptions, 'root_path'));

  function exportedConversation(rawRequest) {
    exactObject(rawRequest, ['loaded_conversation', 'archived_at_ms']);
    const archivedAtMs = safeTimestamp(valueAt(rawRequest, 'archived_at_ms'));
    let exported;
    let compactionProjection;
    try {
      exported = createBuilderConversationExport({
        loaded_conversation: valueAt(rawRequest, 'loaded_conversation'),
        exported_at_ms: archivedAtMs,
      });
      compactionProjection = createBuilderConversationCompactionProjection({
        loaded_conversation: valueAt(rawRequest, 'loaded_conversation'),
      });
    } catch {
      fail();
    }
    if (
      exported.source.current_sequence < 1
      || compactionProjection.project_id !== exported.project_id
      || compactionProjection.conversation_id !== exported.conversation_id
      || compactionProjection.source.event_count !== exported.source.event_count
      || compactionProjection.source.current_sequence !== exported.source.current_sequence
    ) fail();
    return {
      archivedAtMs,
      exported,
      sourceHead: compactionProjection.source,
      publicEntries: parsePublicEntries(exported),
    };
  }

  return freezeDeep({
    archive_version: BUILDER_CONVERSATION_TRANSCRIPT_ARCHIVE_VERSION,
    record_committed_conversation(rawRequest) {
      const current = exportedConversation(rawRequest);
      const filePath = archivePath(
        rootPath,
        current.exported.project_id,
        current.exported.conversation_id,
        true,
      );
      const prior = readArchive(filePath, current.exported.project_id, current.exported.conversation_id);
      if (prior !== null && prior.latest.sequence === current.exported.source.current_sequence) {
        if (
          prior.latest.event_id !== current.exported.source.current_event_id
          || prior.latest.event_digest !== current.exported.source.current_event_digest
        ) fail('builder_conversation_transcript_integrity_failed');
        return result('already_current', prior.latest, prior.public_entries.length);
      }
      if (prior !== null && prior.latest.sequence > current.exported.source.current_sequence) {
        fail('builder_conversation_transcript_integrity_failed');
      }
      const priorByKey = new Map((prior?.public_entries ?? []).map((entry) => [
        publicEntryKey(entry), JSON.stringify(entry),
      ]));
      const changes = current.publicEntries.filter((entry) => (
        priorByKey.get(publicEntryKey(entry)) !== JSON.stringify(entry)
      ));
      const checkpoint = checkpointFromExport(
        current.exported,
        current.sourceHead,
        current.archivedAtMs,
        changes,
      );
      appendCheckpoint(filePath, checkpoint);
      return result('checkpoint_appended', checkpoint, current.publicEntries.length);
    },
    repair_conversation(rawRequest) {
      const current = exportedConversation(rawRequest);
      const filePath = archivePath(
        rootPath,
        current.exported.project_id,
        current.exported.conversation_id,
        true,
      );
      const checkpoint = checkpointFromExport(
        current.exported,
        current.sourceHead,
        current.archivedAtMs,
        current.publicEntries,
      );
      replaceArchive(filePath, checkpoint);
      return result('archive_repaired', checkpoint, current.publicEntries.length);
    },
    read_latest(rawRequest) {
      exactObject(rawRequest, ['project_id', 'conversation_id']);
      const projectId = safePattern(valueAt(rawRequest, 'project_id'), PROJECT_ID_PATTERN);
      const conversationId = safePattern(valueAt(rawRequest, 'conversation_id'), CONVERSATION_ID_PATTERN);
      const filePath = archivePath(rootPath, projectId, conversationId, false);
      const archive = readArchive(filePath, projectId, conversationId);
      if (archive === null) return freezeDeep({
        result_version: BUILDER_CONVERSATION_TRANSCRIPT_RESULT_VERSION,
        operation: 'archive_absent',
        project_id: projectId,
        conversation_id: conversationId,
        latest: null,
        public_entries: [],
        authority: 'sqlite_derived_non_authoritative_transcript',
      });
      return freezeDeep({
        result_version: BUILDER_CONVERSATION_TRANSCRIPT_RESULT_VERSION,
        operation: 'archive_read',
        project_id: projectId,
        conversation_id: conversationId,
        latest: archive.latest,
        public_entries: archive.public_entries,
        authority: 'sqlite_derived_non_authoritative_transcript',
      });
    },
  });
}

module.exports = Object.freeze({
  BUILDER_CONVERSATION_TRANSCRIPT_ARCHIVE_VERSION,
  BUILDER_CONVERSATION_TRANSCRIPT_CHECKPOINT_VERSION,
  BUILDER_CONVERSATION_TRANSCRIPT_RESULT_VERSION,
  BuilderConversationTranscriptArchiveError,
  createBuilderConversationTranscriptArchive,
});
