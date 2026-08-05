'use strict';

const nodeCrypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { types: utilTypes } = require('node:util');

const {
  BUILDER_SESSION_ADDRESS_VERSION,
  BUILDER_TASK_ADDRESS_VERSION,
  BuilderSessionTaskAddressError,
  sanitizeBuilderSessionAddress,
  sanitizeBuilderTaskAddress,
} = require('./builder-session-task-address.cjs');

const BUILDER_SESSION_TASK_ADDRESS_STORE_VERSION = 'builder-session-task-address-store.v1';
const BUILDER_SESSION_TASK_ADDRESS_STORE_RESULT_VERSION = 'builder-session-task-address-store-result.v1';
const BUILDER_SESSION_TASK_ADDRESS_STORE_READ_RESULT_VERSION = 'builder-session-task-address-store-read-result.v1';
const BUILDER_SESSION_TASK_ADDRESS_STORE_SCHEMA_VERSION = 'builder-session-task-address-store-schema.v1';
const BUILDER_SESSION_TASK_ADDRESS_STORE_USER_VERSION = 1;
const DATABASE_ID = 'builder-session-task-address-store.v1';
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const PROJECT_ID_PATTERN = new RegExp(`^builder-project:${UUID_SOURCE}$`, 'u');
const SESSION_ID_PATTERN = new RegExp(`^builder-session:${UUID_SOURCE}$`, 'u');
const TASK_ADDRESS_ID_PATTERN = new RegExp(`^builder-task-address:${UUID_SOURCE}$`, 'u');
const RECORD_SESSION_KEYS = Object.freeze(['session_address']);
const RECORD_TASK_KEYS = Object.freeze(['task_address']);
const READ_SESSION_KEYS = Object.freeze(['project_id', 'session_id']);
const READ_TASK_KEYS = Object.freeze(['project_id', 'task_address_id']);
const MAX_RECORD_JSON_BYTES = 96 * 1024;
const CREATE_SCHEMA_SQL = Object.freeze([
  `CREATE TABLE session_addresses (
    session_id TEXT NOT NULL PRIMARY KEY,
    address_id TEXT NOT NULL UNIQUE,
    record_version TEXT NOT NULL,
    project_id TEXT NOT NULL,
    status TEXT NOT NULL,
    updated_at_ms INTEGER NOT NULL,
    record_json TEXT NOT NULL,
    schema_version TEXT NOT NULL,
    CHECK (schema_version = 'builder-session-task-address-store-schema.v1'),
    CHECK (record_version = 'builder-session-address.v1'),
    CHECK (status IN ('active', 'archived', 'deleted_pending', 'deleted')),
    CHECK (updated_at_ms >= 0),
    CHECK (length(record_json) BETWEEN 2 AND 98304)
  ) STRICT`,
  `CREATE TABLE task_addresses (
    task_address_id TEXT NOT NULL PRIMARY KEY,
    address_id TEXT NOT NULL UNIQUE,
    record_version TEXT NOT NULL,
    session_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    status TEXT NOT NULL,
    updated_at_ms INTEGER NOT NULL,
    record_json TEXT NOT NULL,
    schema_version TEXT NOT NULL,
    CHECK (schema_version = 'builder-session-task-address-store-schema.v1'),
    CHECK (record_version = 'builder-task-address.v1'),
    CHECK (status IN ('draft', 'discussing', 'planned', 'active', 'blocked', 'review_needed', 'completed', 'archived')),
    CHECK (updated_at_ms >= 0),
    CHECK (length(record_json) BETWEEN 2 AND 98304),
    FOREIGN KEY (session_id)
      REFERENCES session_addresses(session_id)
      ON DELETE RESTRICT ON UPDATE RESTRICT
  ) STRICT`,
  'CREATE INDEX session_addresses_project_idx ON session_addresses(project_id, updated_at_ms DESC, session_id)',
  'CREATE INDEX task_addresses_session_idx ON task_addresses(project_id, session_id, updated_at_ms DESC, task_address_id)',
  'CREATE INDEX task_addresses_agent_idx ON task_addresses(project_id, agent_id, updated_at_ms DESC, task_address_id)',
]);
const ERROR_MESSAGES = Object.freeze({
  builder_session_task_address_store_invalid: 'Builder session and task address storage request could not be verified.',
  builder_session_task_address_store_conflict: 'Builder session and task address changed before it could be recorded.',
  builder_session_task_address_store_integrity_failed: 'Builder session and task address storage integrity could not be verified.',
  builder_session_task_address_store_unavailable: 'Builder session and task address storage is unavailable.',
});

class BuilderSessionTaskAddressStoreError extends Error {
  constructor(code = 'builder_session_task_address_store_invalid') {
    const selected = Object.hasOwn(ERROR_MESSAGES, code)
      ? code
      : 'builder_session_task_address_store_invalid';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderSessionTaskAddressStoreError';
    this.code = selected;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) {
  throw new BuilderSessionTaskAddressStoreError(code);
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
  if (!isPlainObject(value)) fail('builder_session_task_address_store_invalid');
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== keys.length
    || actual.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) fail('builder_session_task_address_store_invalid');
  for (const key of actual) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      fail('builder_session_task_address_store_invalid');
    }
  }
}

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
    fail('builder_session_task_address_store_invalid');
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
  fail('builder_session_task_address_store_invalid');
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
    fail('builder_session_task_address_store_invalid');
  }
  return value;
}

function safeProjectId(value) {
  return safePattern(value, PROJECT_ID_PATTERN);
}

function safeSessionId(value) {
  return safePattern(value, SESSION_ID_PATTERN);
}

function safeTaskAddressId(value) {
  return safePattern(value, TASK_ADDRESS_ID_PATTERN);
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
  ) fail('builder_session_task_address_store_invalid');
  return value;
}

function assertParentDirectory(filePath) {
  let info;
  try {
    info = fs.lstatSync(path.dirname(filePath));
  } catch {
    fail('builder_session_task_address_store_unavailable');
  }
  if (!info.isDirectory() || info.isSymbolicLink()) {
    fail('builder_session_task_address_store_unavailable');
  }
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
    fail('builder_session_task_address_store_integrity_failed');
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
  if (String(journal?.journal_mode ?? '').toLowerCase() !== 'wal') {
    fail('builder_session_task_address_store_unavailable');
  }
  const pragmas = runtimePragmas(db);
  if (
    pragmas.foreign_keys !== 'on'
    || pragmas.trusted_schema !== 'off'
    || pragmas.synchronous !== 'full'
    || pragmas.journal_mode !== 'wal'
  ) fail('builder_session_task_address_store_unavailable');
}

function createSchema(db) {
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const sql of CREATE_SCHEMA_SQL) db.exec(sql);
    db.exec(`PRAGMA user_version = ${BUILDER_SESSION_TASK_ADDRESS_STORE_USER_VERSION}`);
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
  ).map((row) => ({
    type: row.type,
    name: row.name,
    tbl_name: row.tbl_name,
    sql: row.sql,
  }));
  return freezeDeep({
    database_id: DATABASE_ID,
    schema_version: BUILDER_SESSION_TASK_ADDRESS_STORE_SCHEMA_VERSION,
    user_version: userVersion(db),
    objects: schema,
    digest: `sha256:${sha256Canonical({
      database_id: DATABASE_ID,
      schema_version: BUILDER_SESSION_TASK_ADDRESS_STORE_SCHEMA_VERSION,
      user_version: userVersion(db),
      objects: schema,
    })}`,
  });
}

function assertSchema(db) {
  if (userVersion(db) !== BUILDER_SESSION_TASK_ADDRESS_STORE_USER_VERSION) {
    fail('builder_session_task_address_store_integrity_failed');
  }
  const schema = collectSchemaFingerprint(db);
  const objectNames = schema.objects.map((item) => item.name);
  const expected = [
    'session_addresses_project_idx',
    'task_addresses_agent_idx',
    'task_addresses_session_idx',
    'session_addresses',
    'task_addresses',
  ];
  if (
    objectNames.length !== expected.length
    || expected.some((name, index) => objectNames[index] !== name)
  ) fail('builder_session_task_address_store_integrity_failed');
  return schema;
}

function openDatabase(databasePath) {
  const filePath = safeDatabasePath(databasePath);
  assertParentDirectory(filePath);
  let db;
  try {
    db = new DatabaseSync(filePath);
    configurePragmas(db);
    const hasSchema = one(
      db,
      "SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'session_addresses'",
    ) !== null;
    if (!hasSchema) createSchema(db);
    assertSchema(db);
    return db;
  } catch (error) {
    try { db?.close(); } catch { /* fixed failure below */ }
    if (error instanceof BuilderSessionTaskAddressStoreError) throw error;
    fail('builder_session_task_address_store_unavailable');
  }
}

function addressEvidence(db) {
  const schema = collectSchemaFingerprint(db);
  return freezeDeep({
    address_authority: 'main_owned_session_task_address_store',
    address_contract_authority: 'main_session_task_address_contract_v1',
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
    export_materialization: false,
    archive_authority: false,
    delete_authority: false,
    fork_authority: false,
    schema_version: schema.schema_version,
    user_version: schema.user_version,
    schema_fingerprint_digest: schema.digest,
    recovery_model: 'idempotent_store_replay',
  });
}

function parseRecordJson(text, sanitizer) {
  if (typeof text !== 'string' || text.length < 2 || text.length > MAX_RECORD_JSON_BYTES) {
    fail('builder_session_task_address_store_integrity_failed');
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    fail('builder_session_task_address_store_integrity_failed');
  }
  try {
    return sanitizer(parsed);
  } catch (error) {
    if (error instanceof BuilderSessionTaskAddressError) {
      fail('builder_session_task_address_store_integrity_failed');
    }
    throw error;
  }
}

function sessionRowToRecord(row) {
  const sessionAddress = parseRecordJson(row.record_json, sanitizeBuilderSessionAddress);
  if (
    row.session_id !== sessionAddress.session_id
    || row.address_id !== sessionAddress.address_id
    || row.record_version !== BUILDER_SESSION_ADDRESS_VERSION
    || row.project_id !== sessionAddress.project_id
    || row.status !== sessionAddress.status
    || row.updated_at_ms !== sessionAddress.updated_at_ms
  ) fail('builder_session_task_address_store_integrity_failed');
  return freezeDeep({ session_address: sessionAddress });
}

function taskRowToRecord(row) {
  const taskAddress = parseRecordJson(row.record_json, sanitizeBuilderTaskAddress);
  if (
    row.task_address_id !== taskAddress.task_address_id
    || row.address_id !== taskAddress.address_id
    || row.record_version !== BUILDER_TASK_ADDRESS_VERSION
    || row.session_id !== taskAddress.session_id
    || row.project_id !== taskAddress.project_id
    || row.agent_id !== taskAddress.agent_id
    || row.status !== taskAddress.status
    || row.updated_at_ms !== taskAddress.updated_at_ms
  ) fail('builder_session_task_address_store_integrity_failed');
  return freezeDeep({ task_address: taskAddress });
}

function insertSession(db, sessionAddress) {
  const recordJson = canonicalJson(sessionAddress);
  if (recordJson.length > MAX_RECORD_JSON_BYTES) {
    fail('builder_session_task_address_store_invalid');
  }
  run(
    db,
    `INSERT INTO session_addresses (
      session_id, address_id, record_version, project_id, status, updated_at_ms,
      record_json, schema_version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      sessionAddress.session_id,
      sessionAddress.address_id,
      sessionAddress.address_version,
      sessionAddress.project_id,
      sessionAddress.status,
      sessionAddress.updated_at_ms,
      recordJson,
      BUILDER_SESSION_TASK_ADDRESS_STORE_SCHEMA_VERSION,
    ],
  );
}

function insertTask(db, taskAddress) {
  const recordJson = canonicalJson(taskAddress);
  if (recordJson.length > MAX_RECORD_JSON_BYTES) {
    fail('builder_session_task_address_store_invalid');
  }
  run(
    db,
    `INSERT INTO task_addresses (
      task_address_id, address_id, record_version, session_id, project_id, agent_id,
      status, updated_at_ms, record_json, schema_version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      taskAddress.task_address_id,
      taskAddress.address_id,
      taskAddress.address_version,
      taskAddress.session_id,
      taskAddress.project_id,
      taskAddress.agent_id,
      taskAddress.status,
      taskAddress.updated_at_ms,
      recordJson,
      BUILDER_SESSION_TASK_ADDRESS_STORE_SCHEMA_VERSION,
    ],
  );
}

function result(db, operation, payload) {
  return freezeDeep({
    result_version: BUILDER_SESSION_TASK_ADDRESS_STORE_RESULT_VERSION,
    operation,
    ...payload,
    address_evidence: addressEvidence(db),
  });
}

function readResult(db, status, payload) {
  return freezeDeep({
    result_version: BUILDER_SESSION_TASK_ADDRESS_STORE_READ_RESULT_VERSION,
    status,
    ...payload,
    address_evidence: addressEvidence(db),
  });
}

function createBuilderSessionTaskAddressStore(databasePath) {
  const db = openDatabase(databasePath);
  let closed = false;

  function activeDb() {
    if (closed) fail('builder_session_task_address_store_unavailable');
    return db;
  }

  return freezeDeep({
    store_version: BUILDER_SESSION_TASK_ADDRESS_STORE_VERSION,
    record_session_address(rawRequest) {
      exactObject(rawRequest, RECORD_SESSION_KEYS);
      const sessionAddress = sanitizeBuilderSessionAddress(valueAt(rawRequest, 'session_address'));
      const database = activeDb();
      const existing = one(
        database,
        'SELECT * FROM session_addresses WHERE session_id = ?',
        [sessionAddress.session_id],
      );
      if (existing !== null) {
        const record = sessionRowToRecord(existing);
        if (record.session_address.address_id !== sessionAddress.address_id) {
          fail('builder_session_task_address_store_conflict');
        }
        return result(database, 'session_address_replayed', { session_address: record });
      }
      try {
        insertSession(database, sessionAddress);
      } catch (error) {
        if (String(error?.message ?? '').includes('UNIQUE')) {
          fail('builder_session_task_address_store_conflict');
        }
        throw error;
      }
      const row = one(database, 'SELECT * FROM session_addresses WHERE session_id = ?', [sessionAddress.session_id]);
      return result(database, 'session_address_recorded', { session_address: sessionRowToRecord(row) });
    },
    record_task_address(rawRequest) {
      exactObject(rawRequest, RECORD_TASK_KEYS);
      const taskAddress = sanitizeBuilderTaskAddress(valueAt(rawRequest, 'task_address'));
      const database = activeDb();
      const session = one(
        database,
        'SELECT * FROM session_addresses WHERE session_id = ?',
        [taskAddress.session_id],
      );
      if (session === null || session.project_id !== taskAddress.project_id) {
        fail('builder_session_task_address_store_conflict');
      }
      const existing = one(
        database,
        'SELECT * FROM task_addresses WHERE task_address_id = ?',
        [taskAddress.task_address_id],
      );
      if (existing !== null) {
        const record = taskRowToRecord(existing);
        if (record.task_address.address_id !== taskAddress.address_id) {
          fail('builder_session_task_address_store_conflict');
        }
        return result(database, 'task_address_replayed', { task_address: record });
      }
      try {
        insertTask(database, taskAddress);
      } catch (error) {
        if (String(error?.message ?? '').includes('UNIQUE')) {
          fail('builder_session_task_address_store_conflict');
        }
        throw error;
      }
      const row = one(database, 'SELECT * FROM task_addresses WHERE task_address_id = ?', [taskAddress.task_address_id]);
      return result(database, 'task_address_recorded', { task_address: taskRowToRecord(row) });
    },
    read_session_address(rawRequest) {
      exactObject(rawRequest, READ_SESSION_KEYS);
      const projectId = safeProjectId(valueAt(rawRequest, 'project_id'));
      const sessionId = safeSessionId(valueAt(rawRequest, 'session_id'));
      const database = activeDb();
      const row = one(
        database,
        'SELECT * FROM session_addresses WHERE project_id = ? AND session_id = ?',
        [projectId, sessionId],
      );
      if (row === null) return readResult(database, 'absent', { session_address: null });
      return readResult(database, 'ready', { session_address: sessionRowToRecord(row) });
    },
    read_task_address(rawRequest) {
      exactObject(rawRequest, READ_TASK_KEYS);
      const projectId = safeProjectId(valueAt(rawRequest, 'project_id'));
      const taskAddressId = safeTaskAddressId(valueAt(rawRequest, 'task_address_id'));
      const database = activeDb();
      const row = one(
        database,
        'SELECT * FROM task_addresses WHERE project_id = ? AND task_address_id = ?',
        [projectId, taskAddressId],
      );
      if (row === null) return readResult(database, 'absent', { task_address: null });
      return readResult(database, 'ready', { task_address: taskRowToRecord(row) });
    },
    close() {
      if (closed) return;
      closed = true;
      db.close();
    },
    [Symbol.dispose]() {
      this.close();
    },
  });
}

module.exports = Object.freeze({
  BUILDER_SESSION_TASK_ADDRESS_STORE_READ_RESULT_VERSION,
  BUILDER_SESSION_TASK_ADDRESS_STORE_RESULT_VERSION,
  BUILDER_SESSION_TASK_ADDRESS_STORE_SCHEMA_VERSION,
  BUILDER_SESSION_TASK_ADDRESS_STORE_USER_VERSION,
  BUILDER_SESSION_TASK_ADDRESS_STORE_VERSION,
  BuilderSessionTaskAddressStoreError,
  createBuilderSessionTaskAddressStore,
});
