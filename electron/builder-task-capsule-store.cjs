'use strict';

const nodeCrypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { types: utilTypes } = require('node:util');

const {
  BUILDER_TASK_CAPSULE_UPDATE_VERSION,
  BuilderTaskCapsuleContractError,
  sanitizeBuilderTaskCapsuleUpdate,
} = require('./builder-task-capsule-contract.cjs');

const BUILDER_TASK_CAPSULE_STORE_VERSION = 'builder-task-capsule-store.v1';
const BUILDER_TASK_CAPSULE_STORE_RESULT_VERSION = 'builder-task-capsule-store-result.v1';
const BUILDER_TASK_CAPSULE_STORE_READ_RESULT_VERSION = 'builder-task-capsule-store-read-result.v1';
const BUILDER_TASK_CAPSULE_STORE_SCHEMA_VERSION = 'builder-task-capsule-store-schema.v1';
const BUILDER_TASK_CAPSULE_STORE_USER_VERSION = 1;
const DATABASE_ID = 'builder-task-capsule-store.v1';
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const PROJECT_ID_PATTERN = new RegExp(`^builder-project:${UUID_SOURCE}$`, 'u');
const TASK_ID_PATTERN = new RegExp(`^builder-task:${UUID_SOURCE}$`, 'u');
const UPDATE_ID_PATTERN = /^builder-task-capsule-update:[0-9a-f]{64}$/u;
const RECORD_KEYS = Object.freeze(['task_capsule_update']);
const READ_UPDATE_KEYS = Object.freeze(['project_id', 'update_id']);
const READ_LATEST_KEYS = Object.freeze(['project_id']);
const LIST_TASK_KEYS = Object.freeze(['project_id', 'task_id']);
const MAX_TASK_CAPSULE_UPDATES = 128;
const MAX_RECORD_JSON_BYTES = 64 * 1024;
const CREATE_SCHEMA_SQL = Object.freeze([
  `CREATE TABLE task_capsule_updates (
    update_id TEXT NOT NULL PRIMARY KEY,
    record_version TEXT NOT NULL,
    project_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    turn_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    route_decision_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    task_status TEXT NOT NULL,
    updated_at_ms INTEGER NOT NULL,
    record_json TEXT NOT NULL,
    schema_version TEXT NOT NULL,
    UNIQUE (project_id, route_decision_id),
    UNIQUE (project_id, message_id),
    CHECK (schema_version = 'builder-task-capsule-store-schema.v1'),
    CHECK (record_version = 'builder-task-capsule-update.v1'),
    CHECK (task_status = 'ready'),
    CHECK (updated_at_ms >= 0),
    CHECK (length(record_json) BETWEEN 2 AND 65536)
  ) STRICT`,
  'CREATE INDEX task_capsule_updates_project_latest_idx ON task_capsule_updates(project_id, updated_at_ms DESC, update_id DESC)',
  'CREATE INDEX task_capsule_updates_task_idx ON task_capsule_updates(project_id, task_id, updated_at_ms ASC, update_id ASC)',
]);
const ERROR_MESSAGES = Object.freeze({
  builder_task_capsule_store_invalid: 'Builder task capsule storage request could not be verified.',
  builder_task_capsule_store_conflict: 'Builder task capsule changed before it could be recorded.',
  builder_task_capsule_store_integrity_failed: 'Builder task capsule storage integrity could not be verified.',
  builder_task_capsule_store_resource_exceeded: 'Builder task capsule storage limits were reached.',
  builder_task_capsule_store_unavailable: 'Builder task capsule storage is unavailable.',
});

class BuilderTaskCapsuleStoreError extends Error {
  constructor(code = 'builder_task_capsule_store_invalid') {
    const selected = Object.hasOwn(ERROR_MESSAGES, code)
      ? code
      : 'builder_task_capsule_store_invalid';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderTaskCapsuleStoreError';
    this.code = selected;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) {
  throw new BuilderTaskCapsuleStoreError(code);
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
  if (!isPlainObject(value)) fail('builder_task_capsule_store_invalid');
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== keys.length
    || actual.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) fail('builder_task_capsule_store_invalid');
  for (const key of actual) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      fail('builder_task_capsule_store_invalid');
    }
  }
}

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
    fail('builder_task_capsule_store_invalid');
  }
  return descriptor.value;
}

function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(valueAt(value, key))}`
    )).join(',')}}`;
  }
  fail('builder_task_capsule_store_invalid');
}

function sha256Canonical(value) {
  return nodeCrypto.createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

function hasControlCharacter(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function safePattern(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) {
    fail('builder_task_capsule_store_invalid');
  }
  return value;
}

function safeProjectId(value) {
  return safePattern(value, PROJECT_ID_PATTERN);
}

function safeTaskId(value) {
  return safePattern(value, TASK_ID_PATTERN);
}

function safeUpdateId(value) {
  return safePattern(value, UPDATE_ID_PATTERN);
}

function safeDatabasePath(value) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > 1024
    || value.trim() !== value
    || hasControlCharacter(value)
    || !path.isAbsolute(value)
    || path.resolve(value) !== value
  ) fail('builder_task_capsule_store_invalid');
  return value;
}

function assertParentDirectory(filePath) {
  let info;
  try {
    info = fs.lstatSync(path.dirname(filePath));
  } catch {
    fail('builder_task_capsule_store_unavailable');
  }
  if (!info.isDirectory() || info.isSymbolicLink()) {
    fail('builder_task_capsule_store_unavailable');
  }
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function one(db, sql, params = []) {
  return db.prepare(sql).get(...params) ?? null;
}

function all(db, sql, params = []) {
  return db.prepare(sql).all(...params);
}

function run(db, sql, params = []) {
  return db.prepare(sql).run(...params);
}

function userVersion(db) {
  const row = one(db, 'PRAGMA user_version');
  if (!row || !Number.isSafeInteger(row.user_version)) {
    fail('builder_task_capsule_store_integrity_failed');
  }
  return row.user_version;
}

function runtimePragmas(db) {
  const foreignKeys = Number(one(db, 'PRAGMA foreign_keys')?.foreign_keys);
  const trustedSchema = Number(one(db, 'PRAGMA trusted_schema')?.trusted_schema);
  const synchronous = Number(one(db, 'PRAGMA synchronous')?.synchronous);
  const journalMode = String(one(db, 'PRAGMA journal_mode')?.journal_mode ?? '').toLowerCase();
  return freezeDeep({
    foreign_keys: foreignKeys === 1 ? 'on' : 'unexpected',
    journal_mode: journalMode,
    synchronous: synchronous === 2 ? 'full' : 'unexpected',
    trusted_schema: trustedSchema === 0 ? 'off' : 'unexpected',
  });
}

function configurePragmas(db) {
  db.exec('PRAGMA trusted_schema = OFF');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA synchronous = FULL');
  const journal = one(db, 'PRAGMA journal_mode = WAL');
  const mode = String(journal?.journal_mode ?? '').toLowerCase();
  if (mode !== 'wal') fail('builder_task_capsule_store_unavailable');
  const pragmas = runtimePragmas(db);
  if (
    pragmas.foreign_keys !== 'on'
    || pragmas.trusted_schema !== 'off'
    || pragmas.synchronous !== 'full'
    || pragmas.journal_mode !== 'wal'
  ) fail('builder_task_capsule_store_unavailable');
}

function createSchema(db) {
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const sql of CREATE_SCHEMA_SQL) db.exec(sql);
    db.exec(`PRAGMA user_version = ${BUILDER_TASK_CAPSULE_STORE_USER_VERSION}`);
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* fixed failure below */ }
    throw error;
  }
}

function collectSchemaFingerprint(db) {
  const schema = all(
    db,
    `SELECT type, name, tbl_name, sql
      FROM sqlite_schema
      WHERE name NOT LIKE 'sqlite_%'
      ORDER BY type, name`,
  );
  const tableNames = all(
    db,
    `SELECT name
      FROM pragma_table_list
      WHERE schema = 'main' AND type = 'table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name`,
  ).map((row) => row.name);
  const tables = tableNames.map((tableName) => {
    const table = quoteIdentifier(tableName);
    const indexes = all(db, `PRAGMA index_list(${table})`)
      .sort((left, right) => String(left.name).localeCompare(String(right.name)))
      .map((indexRow) => ({
        ...indexRow,
        xinfo: all(db, `PRAGMA index_xinfo(${quoteIdentifier(indexRow.name)})`),
      }));
    return {
      name: tableName,
      foreign_key_list: all(db, `PRAGMA foreign_key_list(${table})`),
      index_list: indexes,
      table_xinfo: all(db, `PRAGMA table_xinfo(${table})`),
    };
  });
  return freezeDeep({
    foreign_key_check: all(db, 'PRAGMA foreign_key_check'),
    schema,
    tables,
    user_version: userVersion(db),
  });
}

let expectedSchemaFingerprint;
function expectedFingerprint() {
  if (expectedSchemaFingerprint) return expectedSchemaFingerprint;
  const expectedDb = new DatabaseSync(':memory:', {
    allowExtension: false,
    enableForeignKeyConstraints: true,
    open: true,
    readOnly: false,
  });
  try {
    expectedDb.exec('PRAGMA trusted_schema = OFF');
    expectedDb.exec('PRAGMA foreign_keys = ON');
    for (const sql of CREATE_SCHEMA_SQL) expectedDb.exec(sql);
    expectedDb.exec(`PRAGMA user_version = ${BUILDER_TASK_CAPSULE_STORE_USER_VERSION}`);
    expectedSchemaFingerprint = canonicalJson(collectSchemaFingerprint(expectedDb));
    return expectedSchemaFingerprint;
  } finally {
    expectedDb.close();
  }
}

function validateSchema(db) {
  const actual = collectSchemaFingerprint(db);
  if (actual.foreign_key_check.length !== 0) {
    fail('builder_task_capsule_store_integrity_failed');
  }
  if (canonicalJson(actual) !== expectedFingerprint()) {
    fail('builder_task_capsule_store_integrity_failed');
  }
}

function initialize(db) {
  configurePragmas(db);
  const version = userVersion(db);
  if (version === 0) createSchema(db);
  else if (version !== BUILDER_TASK_CAPSULE_STORE_USER_VERSION) {
    fail('builder_task_capsule_store_integrity_failed');
  }
  validateSchema(db);
}

function canonicalRecord(value) {
  const text = canonicalJson(value);
  if (text.length < 2 || text.length > MAX_RECORD_JSON_BYTES) {
    fail('builder_task_capsule_store_resource_exceeded');
  }
  return text;
}

function parseCanonicalRecord(value, code) {
  if (
    typeof value !== 'string'
    || value.length < 2
    || value.length > MAX_RECORD_JSON_BYTES
    || hasControlCharacter(value)
  ) fail(code);
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    fail(code);
  }
  if (!isPlainObject(parsed)) fail(code);
  try {
    if (canonicalJson(parsed) !== value) fail(code);
    return sanitizeBuilderTaskCapsuleUpdate(parsed);
  } catch (error) {
    if (
      error instanceof BuilderTaskCapsuleStoreError
      || error instanceof BuilderTaskCapsuleContractError
    ) fail(code);
    throw error;
  }
}

function sanitizeRecordRequest(value) {
  exactObject(value, RECORD_KEYS);
  try {
    return sanitizeBuilderTaskCapsuleUpdate(valueAt(value, 'task_capsule_update'));
  } catch (error) {
    if (error instanceof BuilderTaskCapsuleContractError) {
      fail('builder_task_capsule_store_invalid');
    }
    throw error;
  }
}

function updateColumns() {
  return `update_id, record_version, project_id, conversation_id, turn_id,
    run_id, message_id, route_decision_id, task_id, task_status, updated_at_ms,
    record_json`;
}

function safeRow(row) {
  if (row === null || row === undefined) return null;
  const record = parseCanonicalRecord(
    row.record_json,
    'builder_task_capsule_store_integrity_failed',
  );
  if (
    record.update_id !== safeUpdateId(row.update_id)
    || record.record_version !== row.record_version
    || record.record_version !== BUILDER_TASK_CAPSULE_UPDATE_VERSION
    || record.project_id !== safeProjectId(row.project_id)
    || record.conversation_id !== row.conversation_id
    || record.turn_id !== row.turn_id
    || record.run_id !== row.run_id
    || record.message_id !== row.message_id
    || record.route_decision_id !== row.route_decision_id
    || record.task_capsule.task_id !== safeTaskId(row.task_id)
    || record.task_capsule.status !== row.task_status
    || record.task_capsule.status !== 'ready'
    || record.updated_at_ms !== row.updated_at_ms
    || canonicalRecord(record) !== row.record_json
  ) fail('builder_task_capsule_store_integrity_failed');
  return freezeDeep({ task_capsule_update: record });
}

function loadByUpdateId(db, updateId) {
  return safeRow(one(
    db,
    `SELECT ${updateColumns()} FROM task_capsule_updates WHERE update_id = ?`,
    [updateId],
  ));
}

function loadByRouteDecisionId(db, projectId, routeDecisionId) {
  return safeRow(one(
    db,
    `SELECT ${updateColumns()} FROM task_capsule_updates
      WHERE project_id = ? AND route_decision_id = ?`,
    [projectId, routeDecisionId],
  ));
}

function loadByMessageId(db, projectId, messageId) {
  return safeRow(one(
    db,
    `SELECT ${updateColumns()} FROM task_capsule_updates
      WHERE project_id = ? AND message_id = ?`,
    [projectId, messageId],
  ));
}

function latestProjectUpdate(db, projectId) {
  return safeRow(one(
    db,
    `SELECT ${updateColumns()} FROM task_capsule_updates
      WHERE project_id = ?
      ORDER BY updated_at_ms DESC, update_id DESC
      LIMIT 1`,
    [projectId],
  ));
}

function taskUpdates(db, projectId, taskId) {
  const rows = all(
    db,
    `SELECT ${updateColumns()} FROM task_capsule_updates
      WHERE project_id = ? AND task_id = ?
      ORDER BY updated_at_ms ASC, update_id ASC
      LIMIT ?`,
    [projectId, taskId, MAX_TASK_CAPSULE_UPDATES + 1],
  );
  if (rows.length > MAX_TASK_CAPSULE_UPDATES) {
    fail('builder_task_capsule_store_resource_exceeded');
  }
  return freezeDeep(rows.map(safeRow));
}

function sameUpdate(left, right) {
  return canonicalJson(left.task_capsule_update) === canonicalJson(right.task_capsule_update);
}

function evidence(db, transaction) {
  return freezeDeep({
    database_id: DATABASE_ID,
    schema_version: BUILDER_TASK_CAPSULE_STORE_SCHEMA_VERSION,
    user_version: BUILDER_TASK_CAPSULE_STORE_USER_VERSION,
    schema_fingerprint_digest: `sha256:${sha256Canonical(collectSchemaFingerprint(db))}`,
    runtime_pragmas: runtimePragmas(db),
    transaction,
    task_capsule_authority: 'main_owned_task_capsule_store',
    task_capsule_contract_authority: 'main_task_capsule_contract_v1',
    renderer_authority: 'not_present',
    ipc_authority: 'not_present',
    conversation_append: false,
    provider_dispatch: false,
    model_dispatch: false,
    source_read: 'not_present',
    source_write: 'not_present',
    git_mutation: false,
    permission_grant_authority: false,
    review_authority: false,
    revision_authority: false,
    artifact_authority: false,
    command_execution: false,
    network_access: false,
    credential_storage: 'not_present',
    recovery_model: 'idempotent_store_replay',
  });
}

function writeResult(db, operation, entry) {
  return freezeDeep({
    result_version: BUILDER_TASK_CAPSULE_STORE_RESULT_VERSION,
    operation,
    task_capsule_update: entry,
    task_capsule_evidence: evidence(db, operation),
  });
}

function readResult(db, transaction, payload) {
  return freezeDeep({
    result_version: BUILDER_TASK_CAPSULE_STORE_READ_RESULT_VERSION,
    task_capsule_authority: 'main_owned_task_capsule_store',
    ...payload,
    evidence: evidence(db, transaction),
  });
}

function insertUpdate(db, record) {
  run(db, `INSERT INTO task_capsule_updates (
    update_id, record_version, project_id, conversation_id, turn_id, run_id,
    message_id, route_decision_id, task_id, task_status, updated_at_ms,
    record_json, schema_version
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
    record.update_id,
    record.record_version,
    record.project_id,
    record.conversation_id,
    record.turn_id,
    record.run_id,
    record.message_id,
    record.route_decision_id,
    record.task_capsule.task_id,
    record.task_capsule.status,
    record.updated_at_ms,
    canonicalRecord(record),
    BUILDER_TASK_CAPSULE_STORE_SCHEMA_VERSION,
  ]);
}

function recordTaskCapsuleUpdate(db, rawRequest) {
  const record = sanitizeRecordRequest(rawRequest);
  db.exec('BEGIN IMMEDIATE');
  try {
    const existing = loadByUpdateId(db, record.update_id);
    const existingByRoute = loadByRouteDecisionId(db, record.project_id, record.route_decision_id);
    const existingByMessage = loadByMessageId(db, record.project_id, record.message_id);
    if (existing || existingByRoute || existingByMessage) {
      const candidate = existing ?? existingByRoute ?? existingByMessage;
      if (!sameUpdate(candidate, { task_capsule_update: record })) {
        fail('builder_task_capsule_store_conflict');
      }
      db.exec('COMMIT');
      return writeResult(db, 'task_capsule_update_replayed', candidate);
    }
    insertUpdate(db, record);
    const readback = loadByUpdateId(db, record.update_id);
    if (!readback || !sameUpdate(readback, { task_capsule_update: record })) {
      fail('builder_task_capsule_store_integrity_failed');
    }
    db.exec('COMMIT');
    return writeResult(db, 'task_capsule_update_recorded', readback);
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* fixed failure below */ }
    throw error;
  }
}

function readTaskCapsuleUpdate(db, rawRequest) {
  exactObject(rawRequest, READ_UPDATE_KEYS);
  const projectId = safeProjectId(valueAt(rawRequest, 'project_id'));
  const updateId = safeUpdateId(valueAt(rawRequest, 'update_id'));
  const entry = loadByUpdateId(db, updateId);
  if (!entry || entry.task_capsule_update.project_id !== projectId) {
    return readResult(db, 'task_capsule_update_absent_read', {
      status: 'absent',
      task_capsule_update: null,
    });
  }
  return readResult(db, 'task_capsule_update_ready_read', {
    status: 'ready',
    task_capsule_update: entry,
  });
}

function readLatestTaskCapsule(db, rawRequest) {
  exactObject(rawRequest, READ_LATEST_KEYS);
  const projectId = safeProjectId(valueAt(rawRequest, 'project_id'));
  const entry = latestProjectUpdate(db, projectId);
  if (!entry) {
    return readResult(db, 'latest_task_capsule_absent_read', {
      status: 'absent',
      task_capsule_update: null,
    });
  }
  return readResult(db, 'latest_task_capsule_ready_read', {
    status: 'ready',
    task_capsule_update: entry,
  });
}

function listTaskCapsuleUpdates(db, rawRequest) {
  exactObject(rawRequest, LIST_TASK_KEYS);
  const projectId = safeProjectId(valueAt(rawRequest, 'project_id'));
  const taskId = safeTaskId(valueAt(rawRequest, 'task_id'));
  const entries = taskUpdates(db, projectId, taskId);
  return readResult(db, entries.length === 0 ? 'task_capsule_updates_absent_read' : 'task_capsule_updates_ready_read', {
    status: entries.length === 0 ? 'absent' : 'ready',
    task_capsule_updates: entries,
    truncated: entries.length >= MAX_TASK_CAPSULE_UPDATES,
  });
}

function ownErrorField(error, key) {
  if (!error || typeof error !== 'object' || utilTypes.isProxy(error)) return null;
  const descriptor = Object.getOwnPropertyDescriptor(error, key);
  return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : null;
}

function normalizeOperationError(error) {
  if (error instanceof BuilderTaskCapsuleStoreError) {
    return new BuilderTaskCapsuleStoreError(error.code);
  }
  if (error instanceof BuilderTaskCapsuleContractError) {
    return new BuilderTaskCapsuleStoreError('builder_task_capsule_store_invalid');
  }
  const sqliteCode = ownErrorField(error, 'code');
  const sqliteErrstr = ownErrorField(error, 'errstr');
  const sqliteErrcode = ownErrorField(error, 'errcode');
  if (sqliteCode && /^SQLITE_CONSTRAINT/u.test(sqliteCode)) {
    return new BuilderTaskCapsuleStoreError('builder_task_capsule_store_integrity_failed');
  }
  if (sqliteErrstr === 'constraint failed' || sqliteErrcode === 1555) {
    return new BuilderTaskCapsuleStoreError('builder_task_capsule_store_integrity_failed');
  }
  if (sqliteCode && /^SQLITE_(CORRUPT|NOTADB|SCHEMA|INTERNAL|MISMATCH)/u.test(sqliteCode)) {
    return new BuilderTaskCapsuleStoreError('builder_task_capsule_store_integrity_failed');
  }
  return new BuilderTaskCapsuleStoreError('builder_task_capsule_store_unavailable');
}

function createBuilderTaskCapsuleStore(databasePath) {
  const safePath = safeDatabasePath(databasePath);
  assertParentDirectory(safePath);
  let db;
  try {
    db = new DatabaseSync(safePath, {
      allowExtension: false,
      enableForeignKeyConstraints: true,
      open: true,
      readOnly: false,
    });
    initialize(db);
  } catch (error) {
    if (db?.isOpen) {
      try { db.close(); } catch { /* fixed failure below */ }
    }
    throw normalizeOperationError(error);
  }

  return freezeDeep({
    store_version: BUILDER_TASK_CAPSULE_STORE_VERSION,

    close(...rawArguments) {
      if (rawArguments.length !== 0) {
        throw new BuilderTaskCapsuleStoreError('builder_task_capsule_store_invalid');
      }
      try { db.close(); } catch (error) { throw normalizeOperationError(error); }
    },

    record_task_capsule_update(rawRequest) {
      try { return recordTaskCapsuleUpdate(db, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },

    read_task_capsule_update(rawRequest) {
      try { return readTaskCapsuleUpdate(db, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },

    read_latest_task_capsule(rawRequest) {
      try { return readLatestTaskCapsule(db, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },

    list_task_capsule_updates(rawRequest) {
      try { return listTaskCapsuleUpdates(db, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },
  });
}

module.exports = Object.freeze({
  BUILDER_TASK_CAPSULE_STORE_READ_RESULT_VERSION,
  BUILDER_TASK_CAPSULE_STORE_RESULT_VERSION,
  BUILDER_TASK_CAPSULE_STORE_SCHEMA_VERSION,
  BUILDER_TASK_CAPSULE_STORE_USER_VERSION,
  BUILDER_TASK_CAPSULE_STORE_VERSION,
  BuilderTaskCapsuleStoreError,
  createBuilderTaskCapsuleStore,
});
