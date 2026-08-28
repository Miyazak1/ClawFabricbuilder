'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { types: utilTypes } = require('node:util');

const {
  BUILDER_WORKBENCH_MESSAGE_STATE_VERSION,
  builderWorkbenchMessageDigest,
  sanitizeBuilderWorkbenchMessageEnvelope,
  sanitizeBuilderWorkbenchMessageState,
  sanitizeBuilderWorkbenchThread,
} = require('./builder-workbench-message-contract.cjs');

const BUILDER_WORKBENCH_MESSAGE_STORE_VERSION = 'builder-workbench-message-store.v1';
const SCHEMA_VERSION = 'builder-workbench-message-schema.v1';
const USER_VERSION = 1;
const AGENT_ID_PATTERN = /^builder-agent:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MESSAGE_ID_PATTERN = /^builder-message:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CURSOR_PATTERN = /^builder-workbench-cursor:([1-9][0-9]*)$/u;
const MAX_PAGE_SIZE = 200;
const CREATE_SCHEMA_SQL = Object.freeze([
  `CREATE TABLE workbench_threads (
    thread_id TEXT NOT NULL PRIMARY KEY,
    agent_id TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    thread_json TEXT NOT NULL,
    thread_digest TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL,
    schema_version TEXT NOT NULL,
    CHECK (schema_version = 'builder-workbench-message-schema.v1')
  ) STRICT`,
  `CREATE TABLE workbench_messages (
    local_sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id TEXT NOT NULL UNIQUE,
    agent_id TEXT NOT NULL,
    thread_id TEXT,
    envelope_json TEXT NOT NULL,
    envelope_digest TEXT NOT NULL,
    attention TEXT NOT NULL,
    visibility TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL,
    received_at_ms INTEGER NOT NULL,
    schema_version TEXT NOT NULL,
    CHECK (schema_version = 'builder-workbench-message-schema.v1'),
    FOREIGN KEY (thread_id) REFERENCES workbench_threads(thread_id)
      ON DELETE RESTRICT ON UPDATE RESTRICT
  ) STRICT`,
  `CREATE TABLE workbench_message_states (
    message_id TEXT NOT NULL PRIMARY KEY,
    state_json TEXT NOT NULL,
    updated_at_ms INTEGER NOT NULL,
    schema_version TEXT NOT NULL,
    CHECK (schema_version = 'builder-workbench-message-schema.v1'),
    FOREIGN KEY (message_id) REFERENCES workbench_messages(message_id)
      ON DELETE RESTRICT ON UPDATE RESTRICT
  ) STRICT`,
  'CREATE INDEX workbench_messages_agent_sequence_idx ON workbench_messages(agent_id, local_sequence)',
  'CREATE INDEX workbench_messages_thread_sequence_idx ON workbench_messages(thread_id, local_sequence)',
]);

class BuilderWorkbenchMessageStoreError extends Error {
  constructor(code = 'builder_workbench_message_store_invalid') {
    super('Builder Workbench messages could not be stored.');
    this.name = 'BuilderWorkbenchMessageStoreError';
    this.code = code;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) {
  throw new BuilderWorkbenchMessageStoreError(code);
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || utilTypes.isProxy(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactObject(value, keys) {
  if (!isPlainObject(value)) fail();
  const actual = Reflect.ownKeys(value);
  if (actual.length !== keys.length || actual.some((key) => typeof key !== 'string' || !keys.includes(key))) fail();
  for (const key of actual) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) fail();
  }
}

function safeAgentId(value) {
  if (typeof value !== 'string' || !AGENT_ID_PATTERN.test(value)) fail();
  return value;
}

function safeMessageId(value) {
  if (typeof value !== 'string' || !MESSAGE_ID_PATTERN.test(value)) fail();
  return value;
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail();
  return value;
}

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freezeDeep(nested);
    Object.freeze(value);
  }
  return value;
}

function validateDatabasePath(databasePath) {
  if (
    typeof databasePath !== 'string'
    || !path.isAbsolute(databasePath)
    || path.extname(databasePath).toLowerCase() !== '.sqlite'
    || path.normalize(databasePath) !== databasePath
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
        database.exec(`PRAGMA user_version = ${USER_VERSION}`);
        database.exec('COMMIT');
      } catch (error) {
        try { database.exec('ROLLBACK'); } catch { /* preserve original */ }
        throw error;
      }
    } else if (userVersion !== USER_VERSION) {
      fail('builder_workbench_message_store_unavailable');
    }
    return database;
  } catch (error) {
    try { database.close(); } catch { /* preserve original */ }
    if (error instanceof BuilderWorkbenchMessageStoreError) throw error;
    fail('builder_workbench_message_store_unavailable');
  }
}

function parseJson(value) {
  try { return JSON.parse(value); } catch { fail('builder_workbench_message_store_integrity_failed'); }
}

function cursorSequence(value) {
  if (value === null) return null;
  if (typeof value !== 'string') fail();
  const match = CURSOR_PATTERN.exec(value);
  if (match === null) fail();
  const sequence = Number(match[1]);
  if (!Number.isSafeInteger(sequence) || sequence < 1) fail();
  return sequence;
}

function cursorFromSequence(sequence) {
  return sequence === null ? null : `builder-workbench-cursor:${sequence}`;
}

function defaultMessageState(message) {
  return sanitizeBuilderWorkbenchMessageState({
    state_version: BUILDER_WORKBENCH_MESSAGE_STATE_VERSION,
    message_id: message.message_id,
    read_at_ms: message.source.source_kind === 'owner' ? message.received_at_ms : null,
    acknowledged_at_ms: null,
    archived_at_ms: null,
    muted: false,
    saved: false,
    selected_reaction: null,
    updated_at_ms: message.received_at_ms,
  });
}

function createBuilderWorkbenchMessageStore(databasePath) {
  const database = initializeDatabase(databasePath);
  let closed = false;

  function assertOpen() {
    if (closed) fail('builder_workbench_message_store_unavailable');
  }

  function recordThread(request) {
    assertOpen();
    exactObject(request, ['thread']);
    let thread;
    try { thread = sanitizeBuilderWorkbenchThread(request.thread); } catch { fail(); }
    const serialized = JSON.stringify(thread);
    const digest = `sha256:${require('node:crypto').createHash('sha256').update(serialized, 'utf8').digest('hex')}`;
    const existing = database.prepare(
      'SELECT thread_json, thread_digest FROM workbench_threads WHERE thread_id = ?',
    ).get(thread.thread_id);
    if (existing !== undefined) {
      if (existing.thread_digest !== digest || existing.thread_json !== serialized) {
        fail('builder_workbench_message_store_conflict');
      }
      return freezeDeep({ operation: 'thread_exists', thread });
    }
    database.prepare(
      `INSERT INTO workbench_threads (
        thread_id, agent_id, owner_id, thread_json, thread_digest,
        created_at_ms, updated_at_ms, schema_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      thread.thread_id,
      thread.agent_id,
      thread.owner_id,
      serialized,
      digest,
      thread.created_at_ms,
      thread.updated_at_ms,
      SCHEMA_VERSION,
    );
    return freezeDeep({ operation: 'thread_recorded', thread });
  }

  function recordMessage(request) {
    assertOpen();
    exactObject(request, ['message']);
    let message;
    try { message = sanitizeBuilderWorkbenchMessageEnvelope(request.message); } catch { fail(); }
    const serialized = JSON.stringify(message);
    const digest = builderWorkbenchMessageDigest(message);
    const existing = database.prepare(
      'SELECT local_sequence, envelope_json, envelope_digest FROM workbench_messages WHERE message_id = ?',
    ).get(message.message_id);
    if (existing !== undefined) {
      if (existing.envelope_digest !== digest || existing.envelope_json !== serialized) {
        fail('builder_workbench_message_store_conflict');
      }
      return freezeDeep({
        operation: 'message_exists',
        local_sequence: Number(existing.local_sequence),
        message,
      });
    }
    if (message.address.thread_id !== null) {
      const thread = database.prepare(
        'SELECT agent_id FROM workbench_threads WHERE thread_id = ?',
      ).get(message.address.thread_id);
      if (thread === undefined || thread.agent_id !== message.agent_id) fail();
    }
    const state = defaultMessageState(message);
    database.exec('BEGIN IMMEDIATE');
    try {
      const inserted = database.prepare(
        `INSERT INTO workbench_messages (
          message_id, agent_id, thread_id, envelope_json, envelope_digest,
          attention, visibility, created_at_ms, received_at_ms, schema_version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        message.message_id,
        message.agent_id,
        message.address.thread_id,
        serialized,
        digest,
        message.delivery.attention,
        message.delivery.visibility,
        message.created_at_ms,
        message.received_at_ms,
        SCHEMA_VERSION,
      );
      database.prepare(
        `INSERT INTO workbench_message_states (
          message_id, state_json, updated_at_ms, schema_version
        ) VALUES (?, ?, ?, ?)`,
      ).run(message.message_id, JSON.stringify(state), state.updated_at_ms, SCHEMA_VERSION);
      database.exec('COMMIT');
      return freezeDeep({
        operation: 'message_recorded',
        local_sequence: Number(inserted.lastInsertRowid),
        message,
      });
    } catch (error) {
      try { database.exec('ROLLBACK'); } catch { /* preserve original */ }
      if (error instanceof BuilderWorkbenchMessageStoreError) throw error;
      fail('builder_workbench_message_store_unavailable');
    }
  }

  function readTimeline(request) {
    assertOpen();
    exactObject(request, ['agent_id', 'after_cursor', 'limit']);
    const agentId = safeAgentId(request.agent_id);
    const afterSequence = cursorSequence(request.after_cursor);
    if (!Number.isSafeInteger(request.limit) || request.limit < 1 || request.limit > MAX_PAGE_SIZE) fail();
    const queryLimit = request.limit + 1;
    const rows = afterSequence === null
      ? database.prepare(
        `SELECT m.local_sequence, m.envelope_json, s.state_json
         FROM workbench_messages m
         JOIN workbench_message_states s ON s.message_id = m.message_id
         WHERE m.agent_id = ?
         ORDER BY m.local_sequence DESC
         LIMIT ?`,
      ).all(agentId, queryLimit).reverse()
      : database.prepare(
        `SELECT m.local_sequence, m.envelope_json, s.state_json
         FROM workbench_messages m
         JOIN workbench_message_states s ON s.message_id = m.message_id
         WHERE m.agent_id = ? AND m.local_sequence > ?
         ORDER BY m.local_sequence ASC
         LIMIT ?`,
      ).all(agentId, afterSequence, queryLimit);
    const hasMore = rows.length > request.limit;
    const selectedRows = afterSequence === null && hasMore
      ? rows.slice(rows.length - request.limit)
      : rows.slice(0, request.limit);
    const items = selectedRows.map((row) => {
      try {
        return freezeDeep({
          local_sequence: Number(row.local_sequence),
          message: sanitizeBuilderWorkbenchMessageEnvelope(parseJson(row.envelope_json)),
          state: sanitizeBuilderWorkbenchMessageState(parseJson(row.state_json)),
        });
      } catch {
        fail('builder_workbench_message_store_integrity_failed');
      }
    });
    const lastSequence = items.length === 0
      ? afterSequence
      : items[items.length - 1].local_sequence;
    return freezeDeep({
      result_version: 'builder-workbench-message-timeline.v1',
      agent_id: agentId,
      items,
      after_cursor: request.after_cursor,
      next_cursor: cursorFromSequence(lastSequence),
      has_more: hasMore,
    });
  }

  function readInboxCounts(request) {
    assertOpen();
    exactObject(request, ['agent_id']);
    const agentId = safeAgentId(request.agent_id);
    const rows = database.prepare(
      `SELECT m.attention, s.state_json
       FROM workbench_messages m
       JOIN workbench_message_states s ON s.message_id = m.message_id
       WHERE m.agent_id = ?`,
    ).all(agentId);
    let unreadCount = 0;
    let actionRequiredCount = 0;
    for (const row of rows) {
      let state;
      try { state = sanitizeBuilderWorkbenchMessageState(parseJson(row.state_json)); } catch {
        fail('builder_workbench_message_store_integrity_failed');
      }
      if (state.archived_at_ms !== null) continue;
      if (state.read_at_ms === null) unreadCount += 1;
      if (row.attention === 'action_required' && state.acknowledged_at_ms === null) {
        actionRequiredCount += 1;
      }
    }
    return freezeDeep({ unread_count: unreadCount, action_required_count: actionRequiredCount });
  }

  function updateMessageState(request) {
    assertOpen();
    exactObject(request, ['agent_id', 'message_id', 'operation', 'updated_at_ms']);
    const agentId = safeAgentId(request.agent_id);
    const messageId = safeMessageId(request.message_id);
    const updatedAtMs = safeTimestamp(request.updated_at_ms);
    if (!['mark_read', 'acknowledge', 'archive', 'unarchive', 'save', 'unsave'].includes(request.operation)) fail();
    const row = database.prepare(
      `SELECT s.state_json
       FROM workbench_message_states s
       JOIN workbench_messages m ON m.message_id = s.message_id
       WHERE s.message_id = ? AND m.agent_id = ?`,
    ).get(messageId, agentId);
    if (row === undefined) fail('builder_workbench_message_store_not_found');
    let current;
    try { current = sanitizeBuilderWorkbenchMessageState(parseJson(row.state_json)); } catch {
      fail('builder_workbench_message_store_integrity_failed');
    }
    if (updatedAtMs < current.updated_at_ms) fail('builder_workbench_message_store_conflict');
    const next = sanitizeBuilderWorkbenchMessageState({
      ...current,
      read_at_ms: request.operation === 'mark_read' || request.operation === 'acknowledge'
        ? updatedAtMs
        : current.read_at_ms,
      acknowledged_at_ms: request.operation === 'acknowledge' ? updatedAtMs : current.acknowledged_at_ms,
      archived_at_ms: request.operation === 'archive'
        ? updatedAtMs
        : request.operation === 'unarchive' ? null : current.archived_at_ms,
      saved: request.operation === 'save' ? true : request.operation === 'unsave' ? false : current.saved,
      updated_at_ms: updatedAtMs,
    });
    database.prepare(
      'UPDATE workbench_message_states SET state_json = ?, updated_at_ms = ? WHERE message_id = ?',
    ).run(JSON.stringify(next), updatedAtMs, messageId);
    return freezeDeep({ operation: 'message_state_updated', state: next });
  }

  return freezeDeep({
    store_version: BUILDER_WORKBENCH_MESSAGE_STORE_VERSION,
    record_thread: recordThread,
    record_message: recordMessage,
    read_timeline: readTimeline,
    read_inbox_counts: readInboxCounts,
    update_message_state: updateMessageState,
    close() {
      if (closed) return false;
      try {
        database.close();
        closed = true;
        return true;
      } catch {
        fail('builder_workbench_message_store_unavailable');
      }
    },
  });
}

module.exports = Object.freeze({
  BUILDER_WORKBENCH_MESSAGE_STORE_VERSION,
  BuilderWorkbenchMessageStoreError,
  createBuilderWorkbenchMessageStore,
});
