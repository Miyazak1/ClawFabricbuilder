'use strict';

const nodeCrypto = require('node:crypto');
const { types: utilTypes } = require('node:util');

const {
  BUILDER_CONVERSATION_AUTHORITY_RESULT_VERSION,
  eventHead,
} = require('./builder-conversation-authority-contract.cjs');
const {
  sanitizeBuilderConversationEvent,
} = require('./builder-conversation-records.cjs');
const {
  replayBuilderConversation,
  BuilderConversationReplayError,
} = require('./builder-conversation-replay.cjs');

const BUILDER_CONVERSATION_EXPORT_VERSION = 'builder-conversation-export.v1';
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const PROJECT_ID_PATTERN = new RegExp(`^builder-project:${UUID_SOURCE}$`, 'u');
const CONVERSATION_ID_PATTERN = new RegExp(`^builder-conversation:${UUID_SOURCE}$`, 'u');
const MESSAGE_ID_PATTERN = new RegExp(`^builder-message:${UUID_SOURCE}$`, 'u');
const TASK_ID_PATTERN = new RegExp(`^builder-task:${UUID_SOURCE}$`, 'u');
const TURN_ID_PATTERN = new RegExp(`^builder-turn:${UUID_SOURCE}$`, 'u');
const RUN_ID_PATTERN = new RegExp(`^builder-run:${UUID_SOURCE}$`, 'u');
const DRAFT_ID_PATTERN = /^builder-generation-draft:[0-9a-f]{64}$/u;
const MAX_TEXT_LENGTH = 16 * 1024;
const MAX_EXPORT_BYTES = 4 * 1024 * 1024;

const EXPORT_INPUT_KEYS = Object.freeze([
  'loaded_conversation',
  'exported_at_ms',
]);
const LOADED_CONVERSATION_KEYS = Object.freeze([
  'result_version',
  'operation',
  'conversation',
  'action_events',
  'current_head',
  'events',
  'snapshot',
  'metadata_evidence',
]);
const CONVERSATION_KEYS = Object.freeze([
  'project_id',
  'conversation_id',
  'created_at_ms',
]);
const HEAD_KEYS = Object.freeze([
  'sequence',
  'event_id',
  'event_digest',
]);
const MESSAGE_KEYS = Object.freeze([
  'message_id',
  'role',
  'kind',
  'text',
]);
const TASK_KEYS = Object.freeze([
  'task_id',
  'title',
]);
const CANDIDATE_KEYS = Object.freeze([
  'draft_id',
  'title',
  'summary',
]);

const LIFECYCLE = Object.freeze({
  export_authority: 'main_conversation_export_contract_v1',
  sqlite_read: 'provided_by_metadata_authority',
  sqlite_delete: 'not_performed',
  sqlite_vacuum: 'not_performed',
  export_materialization: 'not_performed',
  renderer_authority: 'not_present',
  provider_dispatch: 'not_performed',
  source_mutation: 'not_performed',
  git_mutation: 'not_performed',
});

const ERROR_MESSAGE = 'Builder conversation export could not be verified.';

class BuilderConversationExportError extends Error {
  constructor() {
    super(ERROR_MESSAGE);
    this.name = 'BuilderConversationExportError';
    this.code = 'builder_conversation_export_invalid';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderConversationExportError();
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

function safePattern(value, pattern, maximum) {
  if (typeof value !== 'string' || value.length > maximum || !pattern.test(value)) fail();
  return value;
}

function safeProjectId(value) {
  return safePattern(value, PROJECT_ID_PATTERN, 64);
}

function safeConversationId(value) {
  return safePattern(value, CONVERSATION_ID_PATTERN, 96);
}

function safeMessageId(value) {
  return safePattern(value, MESSAGE_ID_PATTERN, 64);
}

function safeTurnId(value) {
  return safePattern(value, TURN_ID_PATTERN, 64);
}

function safeTaskId(value) {
  return safePattern(value, TASK_ID_PATTERN, 64);
}

function safeRunId(value) {
  return safePattern(value, RUN_ID_PATTERN, 64);
}

function safeDraftId(value) {
  return safePattern(value, DRAFT_ID_PATTERN, 96);
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail();
  return value;
}

function safeSequence(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 1024) fail();
  return value;
}

function safeAttemptNumber(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 16) fail();
  return value;
}

function safeDigest(value) {
  if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value)) fail();
  return value;
}

function safeEventId(value) {
  if (typeof value !== 'string' || !/^builder-conversation-event:[0-9a-f]{64}$/u.test(value)) fail();
  return value;
}

function safeText(value) {
  if (typeof value !== 'string' || value.length > MAX_TEXT_LENGTH) fail();
  return value;
}

function sanitizeHead(value) {
  if (value === null) return null;
  exactObject(value, HEAD_KEYS);
  return freezeDeep({
    sequence: safeSequence(valueAt(value, 'sequence')),
    event_id: safeEventId(valueAt(value, 'event_id')),
    event_digest: safeDigest(valueAt(value, 'event_digest')),
  });
}

function sameHead(left, right) {
  if (left === null || right === null) return left === right;
  return left.sequence === right.sequence
    && left.event_id === right.event_id
    && left.event_digest === right.event_digest;
}

function denseArray(value) {
  if (!Array.isArray(value) || utilTypes.isProxy(value) || value.length > 1024) fail();
  const keys = Reflect.ownKeys(value);
  const expected = new Set(['length', ...Array.from({ length: value.length }, (_, index) => String(index))]);
  if (keys.length !== expected.size || keys.some((key) => typeof key === 'symbol' || !expected.has(key))) fail();
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  }
  return value;
}

function sanitizeConversation(value) {
  exactObject(value, CONVERSATION_KEYS);
  return freezeDeep({
    project_id: safeProjectId(valueAt(value, 'project_id')),
    conversation_id: safeConversationId(valueAt(value, 'conversation_id')),
    created_at_ms: safeTimestamp(valueAt(value, 'created_at_ms')),
  });
}

function sanitizeLoadedConversation(value) {
  exactObject(value, LOADED_CONVERSATION_KEYS);
  if (valueAt(value, 'result_version') !== BUILDER_CONVERSATION_AUTHORITY_RESULT_VERSION) fail();
  if (valueAt(value, 'operation') !== 'conversation_loaded') fail();
  const conversation = sanitizeConversation(valueAt(value, 'conversation'));
  if (denseArray(valueAt(value, 'action_events')).length !== 0) fail();
  const currentHead = sanitizeHead(valueAt(value, 'current_head'));
  const rawEvents = denseArray(valueAt(value, 'events'));
  const events = freezeDeep(rawEvents.map((item) => sanitizeBuilderConversationEvent(item)));
  const actualHead = events.length === 0 ? null : eventHead(events.at(-1));
  if (!sameHead(actualHead, currentHead)) fail();
  for (const event of events) {
    if (
      event.project_id !== conversation.project_id
      || event.conversation_id !== conversation.conversation_id
    ) fail();
  }
  return freezeDeep({
    conversation,
    current_head: currentHead,
    events,
  });
}

function replay(events) {
  if (events.length === 0) return null;
  try {
    return replayBuilderConversation(events);
  } catch (error) {
    if (error instanceof BuilderConversationReplayError) fail();
    throw error;
  }
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

function exportIdFor(body) {
  return `builder-conversation-export:${nodeCrypto.createHash('sha256')
    .update(canonicalJson(body), 'utf8')
    .digest('hex')}`;
}

function sanitizeMessage(message) {
  exactObject(message, MESSAGE_KEYS);
  const role = valueAt(message, 'role');
  const kind = valueAt(message, 'kind');
  if (!['user', 'assistant'].includes(role)) fail();
  if (!['submitted', 'steering', 'queued_followup', 'run_result'].includes(kind)) fail();
  return {
    message_id: safeMessageId(valueAt(message, 'message_id')),
    role,
    kind,
    text: safeText(valueAt(message, 'text')),
  };
}

function publicTask(task) {
  if (task === null) return null;
  exactObject(task, TASK_KEYS);
  return {
    task_id: safeTaskId(valueAt(task, 'task_id')),
    title: safeText(valueAt(task, 'title')),
  };
}

function publicCandidate(candidate) {
  if (candidate === null) return null;
  exactObject(candidate, [...CANDIDATE_KEYS, 'git_candidate_receipt']);
  return {
    draft_id: safeDraftId(valueAt(candidate, 'draft_id')),
    title: safeText(valueAt(candidate, 'title')),
    summary: safeText(valueAt(candidate, 'summary')),
  };
}

function safeRunStatus(value) {
  if (!['running', 'completed'].includes(value)) fail();
  return value;
}

function safeTurnMode(value) {
  if (!['question', 'work'].includes(value)) fail();
  return value;
}

function safeTurnStatus(value) {
  if (!['running', 'completed'].includes(value)) fail();
  return value;
}

function safeTurnOutcome(value) {
  if (value === null) return null;
  if (![
    'answered',
    'responded',
    'plan_proposed',
    'candidate_ready',
    'failed',
    'interrupted',
    'cancelled',
  ].includes(value)) fail();
  return value;
}

function safeTerminalStatus(value) {
  if (value === null) return null;
  if (!['succeeded', 'failed', 'interrupted', 'cancelled'].includes(value)) fail();
  return value;
}

function safeResultKind(value) {
  if (value === null) return null;
  if (!['explanation', 'plan', 'candidate', 'failure'].includes(value)) fail();
  return value;
}

function safeProgressStage(value) {
  if (![
    'context_ready',
    'provider_request_started',
    'provider_response_received',
    'result_preparing',
  ].includes(value)) fail();
  return value;
}

function safeCandidateReview(value) {
  if (value === null) return null;
  if (!['accepted', 'rejected'].includes(value)) fail();
  return value;
}

function runEntry(turn, run) {
  const candidate = publicCandidate(run.candidate_result);
  const candidateReview = safeCandidateReview(
    run.candidate_review === null ? null : run.candidate_review.decision,
  );
  return {
    entry_kind: 'run',
    turn_id: safeTurnId(turn.turn_id),
    run_id: safeRunId(run.run_id),
    attempt_number: safeAttemptNumber(run.attempt_number),
    status: safeRunStatus(run.status),
    terminal_status: safeTerminalStatus(run.terminal_status),
    result_kind: safeResultKind(run.result_kind),
    progress_stages: denseArray(run.progress_stages).map(safeProgressStage),
    candidate,
    candidate_review: candidateReview,
  };
}

function exportEntries(loaded, snapshot, exportedAtMs) {
  const currentSequence = loaded.current_head === null ? 0 : loaded.current_head.sequence;
  const entries = [{
    entry_kind: 'conversation_export',
    export_version: BUILDER_CONVERSATION_EXPORT_VERSION,
    project_id: loaded.conversation.project_id,
    conversation_id: loaded.conversation.conversation_id,
    exported_at_ms: exportedAtMs,
    current_sequence: currentSequence,
    event_count: loaded.events.length,
    source_authority: 'sqlite_conversation_replay_read_only',
  }];
  if (snapshot === null) return freezeDeep(entries);
  for (const turn of snapshot.turns) {
    entries.push({
      entry_kind: 'turn',
      turn_id: safeTurnId(turn.turn_id),
      mode: safeTurnMode(turn.mode),
      status: safeTurnStatus(turn.status),
      task: publicTask(turn.task),
      outcome: safeTurnOutcome(turn.outcome),
    });
    for (const message of turn.messages) {
      entries.push({
        entry_kind: 'message',
        turn_id: safeTurnId(turn.turn_id),
        ...sanitizeMessage(message),
      });
    }
    for (const run of turn.runs) entries.push(runEntry(turn, run));
  }
  return freezeDeep(entries);
}

function formatJsonl(entries) {
  return `${entries.map((entry) => canonicalJson(entry)).join('\n')}\n`;
}

function markdownLine(text) {
  return safeText(text).replaceAll('\r\n', '\n').replaceAll('\r', '\n');
}

function formatMarkdown(loaded, snapshot, exportedAtMs) {
  const lines = [
    '# ClawFabric Conversation Export',
    '',
    `Project: ${loaded.conversation.project_id}`,
    `Conversation: ${loaded.conversation.conversation_id}`,
    `Exported at: ${exportedAtMs}`,
    `Events: ${loaded.events.length}`,
    '',
  ];
  if (snapshot === null) {
    lines.push('No conversation events have been recorded yet.', '');
    return lines.join('\n');
  }
  for (const [index, turn] of snapshot.turns.entries()) {
    lines.push(`## Turn ${index + 1} (${turn.mode})`, '');
    if (turn.task !== null) lines.push(`Task: ${turn.task.title}`, '');
    for (const message of turn.messages) {
      const label = message.role === 'assistant' ? 'Assistant' : 'User';
      lines.push(`### ${label}`, '', markdownLine(message.text), '');
    }
    for (const run of turn.runs) {
      lines.push(`Run: ${run.status}${run.terminal_status === null ? '' : ` / ${run.terminal_status}`}`);
      if (run.result_kind !== null) lines.push(`Result: ${run.result_kind}`);
      if (run.candidate_result !== null) {
        lines.push(`Candidate: ${run.candidate_result.title}`);
        lines.push(run.candidate_result.summary);
      }
      if (run.candidate_review !== null) lines.push(`Candidate review: ${run.candidate_review.decision}`);
      lines.push('');
    }
  }
  return lines.join('\n');
}

function boundedText(text) {
  if (Buffer.byteLength(text, 'utf8') > MAX_EXPORT_BYTES) fail();
  return text;
}

function createBuilderConversationExport(rawInput) {
  exactObject(rawInput, EXPORT_INPUT_KEYS);
  const exportedAtMs = safeTimestamp(valueAt(rawInput, 'exported_at_ms'));
  const loaded = sanitizeLoadedConversation(valueAt(rawInput, 'loaded_conversation'));
  const snapshot = replay(loaded.events);
  const entries = exportEntries(loaded, snapshot, exportedAtMs);
  const jsonlText = boundedText(formatJsonl(entries));
  const markdownText = boundedText(formatMarkdown(loaded, snapshot, exportedAtMs));
  const body = freezeDeep({
    project_id: loaded.conversation.project_id,
    conversation_id: loaded.conversation.conversation_id,
    exported_at_ms: exportedAtMs,
    source: {
      authority: 'sqlite_conversation_replay_read_only',
      event_count: loaded.events.length,
      current_sequence: loaded.current_head === null ? 0 : loaded.current_head.sequence,
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
    export_version: BUILDER_CONVERSATION_EXPORT_VERSION,
    export_id: exportIdFor(body),
    ...body,
  });
}

module.exports = {
  BUILDER_CONVERSATION_EXPORT_VERSION,
  BuilderConversationExportError,
  createBuilderConversationExport,
};
