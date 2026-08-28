'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const BUILDER_AGENT_CONVERSATION_SERVICE_VERSION = 'builder-agent-conversation-service.v1';
const BUILDER_AGENT_CONVERSATION_SCHEMA_VERSION = 'builder-agent-conversation-schema.v1';
const BUILDER_AGENT_CONVERSATION_USER_VERSION = 1;
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const AGENT_ID_PATTERN = new RegExp(`^builder-agent:(${UUID_SOURCE})$`, 'u');
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const MAX_CONTEXT_EVENTS = 4096;
const MAX_PUBLIC_MESSAGES = 512;
const MAX_TEXT_CODE_POINTS = 12_000;
const MAX_TEXT_BYTES = 48_000;

const CREATE_SCHEMA_SQL = Object.freeze([
  `CREATE TABLE agent_conversations (
    agent_id TEXT NOT NULL PRIMARY KEY,
    conversation_id TEXT NOT NULL UNIQUE,
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL,
    head_sequence INTEGER NOT NULL,
    schema_version TEXT NOT NULL,
    CHECK (schema_version = 'builder-agent-conversation-schema.v1'),
    CHECK (created_at_ms >= 0),
    CHECK (updated_at_ms >= created_at_ms),
    CHECK (head_sequence >= 0)
  ) STRICT`,
  `CREATE TABLE agent_conversation_events (
    agent_id TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    recorded_at_ms INTEGER NOT NULL,
    schema_version TEXT NOT NULL,
    PRIMARY KEY (agent_id, sequence),
    CHECK (schema_version = 'builder-agent-conversation-schema.v1'),
    CHECK (sequence >= 1),
    CHECK (recorded_at_ms >= 0),
    FOREIGN KEY (agent_id)
      REFERENCES agent_conversations(agent_id)
      ON DELETE RESTRICT ON UPDATE RESTRICT
  ) STRICT`,
  'CREATE INDEX agent_conversation_events_lookup_idx ON agent_conversation_events(agent_id, sequence)',
]);

class BuilderAgentConversationServiceError extends Error {
  constructor() {
    super('Builder agent conversation could not be verified.');
    this.name = 'BuilderAgentConversationServiceError';
    this.code = 'builder_agent_conversation_invalid';
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail() {
  throw new BuilderAgentConversationServiceError();
}

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freezeDeep(nested);
    Object.freeze(value);
  }
  return value;
}

function safeAgentId(value) {
  if (typeof value !== 'string' || !AGENT_ID_PATTERN.test(value)) fail();
  return value;
}

function safeDigest(value) {
  if (typeof value !== 'string' || !DIGEST_PATTERN.test(value)) fail();
  return value;
}

function safeText(value) {
  if (
    typeof value !== 'string'
    || value.trim().length === 0
    || [...value].length > MAX_TEXT_CODE_POINTS
    || Buffer.byteLength(value, 'utf8') > MAX_TEXT_BYTES
  ) fail();
  return value;
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail();
  return value;
}

function contextRouteFromDecision(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, 'route');
  if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) return undefined;
  const route = descriptor.value;
  if (route === 'clarify') {
    const matchedSignalsDescriptor = Object.getOwnPropertyDescriptor(value, 'matched_signals');
    const matchedSignals = matchedSignalsDescriptor !== undefined
      && Object.hasOwn(matchedSignalsDescriptor, 'value')
      && Array.isArray(matchedSignalsDescriptor.value)
      ? matchedSignalsDescriptor.value
      : [];
    if (matchedSignals.includes('work_discussion')) return 'update_brief';
  }
  return ['answer', 'clarify', 'update_brief', 'plan', 'build'].includes(route)
    ? route
    : undefined;
}

function safeUuid(createUuid) {
  const value = Reflect.apply(createUuid, undefined, []);
  if (typeof value !== 'string' || !new RegExp(`^${UUID_SOURCE}$`, 'u').test(value)) fail();
  return value;
}

function agentConversationId(agentId) {
  const match = AGENT_ID_PATTERN.exec(agentId);
  if (match === null) fail();
  return `builder-agent-conversation:${match[1]}`;
}

function validateDatabasePath(databasePath) {
  if (
    typeof databasePath !== 'string'
    || !path.isAbsolute(databasePath)
    || path.extname(databasePath).toLowerCase() !== '.sqlite'
  ) fail();
  fs.mkdirSync(path.dirname(databasePath), { recursive: true, mode: 0o700 });
}

function initializeDatabase(databasePath) {
  validateDatabasePath(databasePath);
  const database = new DatabaseSync(databasePath);
  try {
    database.exec('PRAGMA foreign_keys = ON');
    database.exec('PRAGMA journal_mode = WAL');
    const userVersion = Number(database.prepare('PRAGMA user_version').get().user_version);
    if (userVersion === 0) {
      database.exec('BEGIN IMMEDIATE');
      try {
        for (const sql of CREATE_SCHEMA_SQL) database.exec(sql);
        database.exec(`PRAGMA user_version = ${BUILDER_AGENT_CONVERSATION_USER_VERSION}`);
        database.exec('COMMIT');
      } catch (error) {
        try { database.exec('ROLLBACK'); } catch { /* preserve original failure */ }
        throw error;
      }
    } else if (userVersion !== BUILDER_AGENT_CONVERSATION_USER_VERSION) {
      fail();
    }
    return database;
  } catch (error) {
    try { database.close(); } catch { /* preserve original failure */ }
    throw error;
  }
}

function parseEventRow(row) {
  let payload;
  try { payload = JSON.parse(row.payload_json); } catch { fail(); }
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) fail();
  return freezeDeep({
    event_version: 'builder-agent-conversation-event.v1',
    sequence: Number(row.sequence),
    event_type: row.event_type,
    recorded_at_ms: Number(row.recorded_at_ms),
    payload,
  });
}

function createBuilderAgentConversationService(rawOptions) {
  if (rawOptions === null || typeof rawOptions !== 'object' || Array.isArray(rawOptions)) fail();
  const {
    databasePath,
    agentId: rawAgentId,
    createUuid,
    nowMs,
    onChanged = () => undefined,
  } = rawOptions;
  if (
    typeof createUuid !== 'function'
    || typeof nowMs !== 'function'
    || typeof onChanged !== 'function'
  ) fail();
  const agentId = safeAgentId(rawAgentId);
  const conversationId = agentConversationId(agentId);
  const database = initializeDatabase(databasePath);
  let closed = false;

  function now() {
    return safeTimestamp(Reflect.apply(nowMs, undefined, []));
  }

  function assertOpen() {
    if (closed) fail();
  }

  function ensureConversation() {
    assertOpen();
    const existing = database.prepare(
      'SELECT agent_id, conversation_id, created_at_ms, updated_at_ms, head_sequence FROM agent_conversations WHERE agent_id = ?',
    ).get(agentId);
    if (existing !== undefined) {
      if (existing.conversation_id !== conversationId) fail();
      return existing;
    }
    const recordedAtMs = now();
    database.prepare(
      `INSERT INTO agent_conversations (
        agent_id, conversation_id, created_at_ms, updated_at_ms, head_sequence, schema_version
      ) VALUES (?, ?, ?, ?, 0, ?)`,
    ).run(agentId, conversationId, recordedAtMs, recordedAtMs, BUILDER_AGENT_CONVERSATION_SCHEMA_VERSION);
    return database.prepare(
      'SELECT agent_id, conversation_id, created_at_ms, updated_at_ms, head_sequence FROM agent_conversations WHERE agent_id = ?',
    ).get(agentId);
  }

  function readEvents(limit = MAX_CONTEXT_EVENTS) {
    const rows = database.prepare(
      `SELECT sequence, event_type, payload_json, recorded_at_ms
       FROM agent_conversation_events
       WHERE agent_id = ?
       ORDER BY sequence DESC
       LIMIT ?`,
    ).all(agentId, limit);
    return rows.reverse().map(parseEventRow);
  }

  function publishChanged() {
    try {
      Reflect.apply(onChanged, undefined, [freezeDeep({
        event_version: 'builder-task-stream-changed.v1',
        agent_id: agentId,
      })]);
    } catch {
      // Change notification is opportunistic; SQLite remains authoritative.
    }
  }

  function appendEvents(expectedHead, rawEvents) {
    assertOpen();
    const recordedAtMs = now();
    database.exec('BEGIN IMMEDIATE');
    try {
      const conversation = ensureConversation();
      if (Number(conversation.head_sequence) !== expectedHead) fail();
      let sequence = expectedHead;
      const insert = database.prepare(
        `INSERT INTO agent_conversation_events (
          agent_id, sequence, event_type, payload_json, recorded_at_ms, schema_version
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      );
      for (const rawEvent of rawEvents) {
        sequence += 1;
        insert.run(
          agentId,
          sequence,
          rawEvent.event_type,
          JSON.stringify(rawEvent.payload),
          recordedAtMs,
          BUILDER_AGENT_CONVERSATION_SCHEMA_VERSION,
        );
      }
      database.prepare(
        'UPDATE agent_conversations SET head_sequence = ?, updated_at_ms = ? WHERE agent_id = ?',
      ).run(sequence, recordedAtMs, agentId);
      database.exec('COMMIT');
      publishChanged();
      return sequence;
    } catch (error) {
      try { database.exec('ROLLBACK'); } catch { /* preserve original failure */ }
      throw error;
    }
  }

  function assertContext(context) {
    if (
      context === null
      || typeof context !== 'object'
      || context.scope_kind !== 'agent_conversation'
      || context.agent?.agent_id !== agentId
      || context.project?.project_id !== null
      || context.conversation?.conversation_id !== conversationId
      || !Number.isSafeInteger(context.start_head?.sequence)
    ) fail();
    return context;
  }

  function contextFor(ids, requestDigest, startHead) {
    const conversation = ensureConversation();
    return freezeDeep({
      scope_kind: 'agent_conversation',
      agent: { agent_id: agentId },
      project: { project_id: null },
      conversation: {
        conversation_id: conversationId,
        created_at_ms: Number(conversation.created_at_ms),
      },
      ids,
      request_digest: requestDigest,
      start_head: { sequence: startHead },
      events: readEvents(),
      run_terminal_failure_code: null,
      cancel_requested: false,
    });
  }

  function updatedContext(context, head, overrides = {}) {
    return freezeDeep({
      ...context,
      ...overrides,
      start_head: { sequence: head },
      events: readEvents(),
    });
  }

  function beginQuestion(request) {
    assertOpen();
    if (
      request === null
      || typeof request !== 'object'
      || safeAgentId(request.agent_id) !== agentId
    ) fail();
    const question = safeText(request.question);
    const requestDigest = safeDigest(request.request_digest);
    const conversation = ensureConversation();
    const turnId = `builder-turn:${safeUuid(createUuid)}`;
    const messageId = `builder-message:${safeUuid(createUuid)}`;
    const runId = `builder-run:${safeUuid(createUuid)}`;
    const routeDecision = request.route_decision_hint ?? null;
    const head = appendEvents(Number(conversation.head_sequence), [
      {
        event_type: 'turn_submitted',
        payload: {
          turn_id: turnId,
          message: { message_id: messageId, text: question },
          mode: 'question',
          task: null,
          base_revision: null,
          route_decision: routeDecision,
        },
      },
      {
        event_type: 'run_started',
        payload: {
          turn_id: turnId,
          task_id: null,
          run_id: runId,
          attempt_number: 1,
          retry_of_run_id: null,
          input_digest: requestDigest,
        },
      },
    ]);
    return contextFor({ turn_id: turnId, task_id: null, run_id: runId }, requestDigest, head);
  }

  function recordRunProgress({ context: rawContext, stage }) {
    const context = assertContext(rawContext);
    if (!['context_ready', 'provider_request_started', 'provider_response_received', 'result_preparing'].includes(stage)) {
      fail();
    }
    const head = appendEvents(context.start_head.sequence, [{
      event_type: 'run_progress_recorded',
      payload: {
        turn_id: context.ids.turn_id,
        run_id: context.ids.run_id,
        stage,
      },
    }]);
    return updatedContext(context, head);
  }

  function completeExplanation({ context: rawContext, assistant_text: rawAssistantText }) {
    const context = assertContext(rawContext);
    const assistantText = safeText(rawAssistantText);
    const assistantMessageId = `builder-message:${safeUuid(createUuid)}`;
    const head = appendEvents(context.start_head.sequence, [
      {
        event_type: 'run_completed',
        payload: {
          turn_id: context.ids.turn_id,
          run_id: context.ids.run_id,
          terminal_status: 'succeeded',
          result_kind: 'explanation',
          failure_phase: 'not_applicable',
          assistant_message: { message_id: assistantMessageId, text: assistantText },
          candidate: null,
        },
      },
      {
        event_type: 'turn_completed',
        payload: {
          turn_id: context.ids.turn_id,
          run_id: context.ids.run_id,
          outcome: 'answered',
        },
      },
    ]);
    return updatedContext(context, head);
  }

  function recordRetryableFailure({ context: rawContext, failure_code: failureCode }) {
    const context = assertContext(rawContext);
    const code = typeof failureCode === 'string' && /^[a-z0-9_]{1,120}$/u.test(failureCode)
      ? failureCode
      : 'builder_generation_failed';
    const head = appendEvents(context.start_head.sequence, [
      {
        event_type: 'run_completed',
        payload: {
          turn_id: context.ids.turn_id,
          run_id: context.ids.run_id,
          terminal_status: context.cancel_requested ? 'cancelled' : 'failed',
          result_kind: 'failure',
          failure_phase: 'not_recorded',
          failure_code: code,
          assistant_message: null,
          candidate: null,
        },
      },
      {
        event_type: 'turn_completed',
        payload: {
          turn_id: context.ids.turn_id,
          run_id: context.ids.run_id,
          outcome: context.cancel_requested ? 'cancelled' : 'failed',
        },
      },
    ]);
    return updatedContext(context, head, { run_terminal_failure_code: code });
  }

  function requestCancel({ context: rawContext }) {
    const context = assertContext(rawContext);
    const head = appendEvents(context.start_head.sequence, [{
      event_type: 'run_control_requested',
      payload: {
        turn_id: context.ids.turn_id,
        run_id: context.ids.run_id,
        action: 'cancel',
      },
    }]);
    return updatedContext(context, head, { cancel_requested: true });
  }

  function appendActiveRunMessage(rawRequest, eventType) {
    const context = assertContext(rawRequest.context);
    const message = safeText(rawRequest.message);
    const head = appendEvents(context.start_head.sequence, [{
      event_type: eventType,
      payload: {
        turn_id: context.ids.turn_id,
        run_id: context.ids.run_id,
        message: {
          message_id: `builder-message:${safeUuid(createUuid)}`,
          text: message,
        },
      },
    }]);
    return updatedContext(context, head);
  }

  function transcriptItems(events) {
    const items = [];
    for (const event of events) {
      const payload = event.payload;
      if (event.event_type === 'turn_submitted') {
        const contextRoute = contextRouteFromDecision(payload.route_decision);
        items.push({
          item_kind: 'transcript_message',
          sequence: event.sequence,
          turn_id: payload.turn_id,
          message: payload.message,
          role: 'user',
          message_kind: 'submitted',
          ...(contextRoute === undefined ? {} : { context_route: contextRoute }),
          recovery_admission: 'sqlite_derived_public_transcript_only',
        });
      } else if (event.event_type === 'turn_steered' || event.event_type === 'turn_followup_queued') {
        items.push({
          item_kind: 'transcript_message',
          sequence: event.sequence,
          turn_id: payload.turn_id,
          message: payload.message,
          role: 'user',
          message_kind: event.event_type === 'turn_steered' ? 'steering' : 'queued_followup',
          recovery_admission: 'sqlite_derived_public_transcript_only',
        });
      } else if (event.event_type === 'run_completed' && payload.assistant_message !== null) {
        items.push({
          item_kind: 'transcript_message',
          sequence: event.sequence,
          turn_id: payload.turn_id,
          message: payload.assistant_message,
          role: 'assistant',
          message_kind: 'run_result',
          recovery_admission: 'sqlite_derived_public_transcript_only',
        });
      }
    }
    return items.slice(-MAX_PUBLIC_MESSAGES);
  }

  function readStream(request) {
    assertOpen();
    if (
      request === null
      || typeof request !== 'object'
      || safeAgentId(request.agent_id) !== agentId
    ) fail();
    const conversation = ensureConversation();
    const headSequence = Number(conversation.head_sequence);
    const authority = {
      conversation: 'sqlite_canonical_agent_conversation',
      project_source: 'not_included',
      candidate_source: 'not_loaded',
      project_revision: 'not_inferred',
    };
    if (headSequence === 0) {
      return freezeDeep({
        stream_version: 'builder-task-stream-read-result.v1',
        scope_kind: 'agent_conversation',
        agent_id: agentId,
        project_id: null,
        conversation: null,
        authority,
      });
    }
    const events = readEvents(MAX_CONTEXT_EVENTS);
    const items = transcriptItems(events);
    const completedTurnIds = new Set(events
      .filter((event) => event.event_type === 'turn_completed')
      .map((event) => event.payload.turn_id));
    const active = [...events].reverse().find((event) => (
      event.event_type === 'turn_submitted' && !completedTurnIds.has(event.payload.turn_id)
    ));
    return freezeDeep({
      stream_version: 'builder-task-stream-read-result.v1',
      scope_kind: 'agent_conversation',
      agent_id: agentId,
      project_id: null,
      conversation: {
        conversation_id: conversationId,
        created_at_ms: Number(conversation.created_at_ms),
        head_sequence: headSequence,
        recorded_active_turn_id: active?.payload.turn_id ?? null,
        source: 'sqlite_canonical_agent_conversation',
        window: {
          first_sequence: items[0].sequence,
          last_sequence: headSequence,
          has_earlier: items.length === MAX_PUBLIC_MESSAGES && items[0].sequence > 1,
        },
        items,
      },
      authority,
    });
  }

  ensureConversation();

  return Object.freeze({
    service_version: BUILDER_AGENT_CONVERSATION_SERVICE_VERSION,
    agent_id: agentId,
    conversation_id: conversationId,
    begin_question: beginQuestion,
    record_run_progress: recordRunProgress,
    complete_explanation: completeExplanation,
    record_retryable_failure: recordRetryableFailure,
    request_cancel: requestCancel,
    record_steering(request) {
      return appendActiveRunMessage(request, 'turn_steered');
    },
    record_queued_followup(request) {
      return appendActiveRunMessage(request, 'turn_followup_queued');
    },
    read_stream: readStream,
    close() {
      if (closed) return;
      closed = true;
      database.close();
    },
  });
}

module.exports = Object.freeze({
  BUILDER_AGENT_CONVERSATION_SERVICE_VERSION,
  BuilderAgentConversationServiceError,
  createBuilderAgentConversationService,
});
