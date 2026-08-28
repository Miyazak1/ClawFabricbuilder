'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { types: utilTypes } = require('node:util');
const {
  sanitizeBuilderTaskAttentionRecord,
} = require('./builder-task-attention-record.cjs');

const STORE_VERSION = 'builder-task-attention-store.v1';
const RESULT_VERSION = 'builder-task-attention-store-result.v1';
const SCHEMA_VERSION = 'builder-task-attention-store-schema.v1';
const USER_VERSION = 1;
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const PROJECT = new RegExp(`^builder-project:${UUID}$`, 'u');
const TASK = new RegExp(`^builder-task-address:${UUID}$`, 'u');

class BuilderTaskAttentionStoreError extends Error {
  constructor(code = 'builder_task_attention_store_invalid') {
    super(code === 'builder_task_attention_store_conflict'
      ? 'Task attention changed before it could be recorded.'
      : 'Task attention storage is unavailable.');
    this.name = 'BuilderTaskAttentionStoreError';
    this.code = code;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) { throw new BuilderTaskAttentionStoreError(code); }
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freeze(nested);
    Object.freeze(value);
  }
  return value;
}
function plain(value, keys) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || utilTypes.isProxy(value)) fail('builder_task_attention_store_invalid');
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail('builder_task_attention_store_invalid');
  const actual = Reflect.ownKeys(value);
  if (actual.length !== keys.length || actual.some((key) => typeof key !== 'string' || !keys.includes(key))) fail('builder_task_attention_store_invalid');
  for (const key of actual) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail('builder_task_attention_store_invalid');
  }
  return value;
}
function safePath(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || path.resolve(value) !== value || value.length > 1024) fail('builder_task_attention_store_invalid');
  let parent;
  try {
    parent = fs.lstatSync(path.dirname(value));
  } catch {
    fail('builder_task_attention_store_invalid');
  }
  if (!parent.isDirectory() || parent.isSymbolicLink()) fail('builder_task_attention_store_invalid');
  return value;
}
function safeId(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) fail('builder_task_attention_store_invalid');
  return value;
}
function stableJson(value) { return JSON.stringify(value); }

function createBuilderTaskAttentionStore(databasePath) {
  const db = new DatabaseSync(safePath(databasePath));
  let closed = false;
  db.exec('PRAGMA trusted_schema = OFF');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA synchronous = FULL');
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(`CREATE TABLE IF NOT EXISTS task_attention_events (
    attention_id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL,
    task_address_id TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK (revision >= 1),
    state TEXT NOT NULL CHECK (state IN ('ready','waiting_permission','waiting_user_input','waiting_resource','paused')),
    updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0),
    record_json TEXT NOT NULL CHECK (length(record_json) BETWEEN 2 AND 16384),
    schema_version TEXT NOT NULL CHECK (schema_version = '${SCHEMA_VERSION}'),
    UNIQUE(task_address_id, revision)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS task_attention_latest_idx
    ON task_attention_events(project_id, task_address_id, revision DESC);
  PRAGMA user_version = ${USER_VERSION};`);
  const active = () => {
    if (closed) fail('builder_task_attention_store_unavailable');
    return db;
  };
  const latest = (projectId, taskAddressId) => active().prepare(
    `SELECT record_json FROM task_attention_events
      WHERE project_id = ? AND task_address_id = ?
      ORDER BY revision DESC LIMIT 1`,
  ).get(projectId, taskAddressId) ?? null;
  return freeze({
    store_version: STORE_VERSION,
    record_task_attention(request) {
      plain(request, ['attention']);
      const attention = sanitizeBuilderTaskAttentionRecord(request.attention);
      const existing = latest(attention.project_id, attention.task_address_id);
      if (existing !== null) {
        const previous = sanitizeBuilderTaskAttentionRecord(JSON.parse(existing.record_json));
        if (attention.revision !== previous.revision + 1 || attention.updated_at_ms < previous.updated_at_ms) {
          fail('builder_task_attention_store_conflict');
        }
      } else if (attention.revision !== 1) {
        fail('builder_task_attention_store_conflict');
      }
      try {
        active().prepare(`INSERT INTO task_attention_events
          (attention_id, project_id, task_address_id, revision, state, updated_at_ms, record_json, schema_version)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(attention.attention_id, attention.project_id, attention.task_address_id,
            attention.revision, attention.state, attention.updated_at_ms, stableJson(attention), SCHEMA_VERSION);
      } catch (error) {
        if (String(error?.message ?? '').includes('UNIQUE')) fail('builder_task_attention_store_conflict');
        throw error;
      }
      return freeze({ result_version: RESULT_VERSION, status: 'recorded', attention });
    },
    read_task_attention(request) {
      plain(request, ['project_id', 'task_address_id']);
      const projectId = safeId(request.project_id, PROJECT);
      const taskAddressId = safeId(request.task_address_id, TASK);
      const row = latest(projectId, taskAddressId);
      return freeze({
        result_version: RESULT_VERSION,
        status: row === null ? 'absent' : 'ready',
        attention: row === null ? null : sanitizeBuilderTaskAttentionRecord(JSON.parse(row.record_json)),
      });
    },
    close() {
      if (closed) return;
      closed = true;
      db.close();
    },
    [Symbol.dispose]() { this.close(); },
  });
}

module.exports = Object.freeze({
  RESULT_VERSION,
  SCHEMA_VERSION,
  STORE_VERSION,
  BuilderTaskAttentionStoreError,
  createBuilderTaskAttentionStore,
});
