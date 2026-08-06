'use strict';

const nodeCrypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { types: utilTypes } = require('node:util');

const {
  BUILDER_HANDOFF_PACKET_VERSION,
  BuilderHandoffPacketError,
  sanitizeBuilderHandoffPacket,
} = require('./builder-handoff-packet.cjs');

const BUILDER_HANDOFF_PACKET_STORE_VERSION = 'builder-handoff-packet-store.v1';
const BUILDER_HANDOFF_PACKET_STORE_RESULT_VERSION = 'builder-handoff-packet-store-result.v1';
const BUILDER_HANDOFF_PACKET_STORE_READ_RESULT_VERSION = 'builder-handoff-packet-store-read-result.v1';
const BUILDER_HANDOFF_PACKET_STORE_SCHEMA_VERSION = 'builder-handoff-packet-store-schema.v1';
const BUILDER_HANDOFF_PACKET_STORE_USER_VERSION = 1;
const DATABASE_ID = 'builder-handoff-packet-store.v1';

const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const THREAD_ID_PATTERN = new RegExp(`^builder-session:${UUID_SOURCE}$`, 'u');
const HANDOFF_ID_PATTERN = /^builder-handoff-packet:[0-9a-f]{64}$/u;
const RECORD_KEYS = Object.freeze(['handoff_packet']);
const READ_KEYS = Object.freeze(['target_thread_id', 'handoff_id']);
const LIST_PENDING_KEYS = Object.freeze(['target_thread_id']);
const MAX_RECORD_JSON_BYTES = 128 * 1024;
const MAX_PENDING_HANDOFFS = 128;

const CREATE_SCHEMA_SQL = Object.freeze([
  `CREATE TABLE handoff_packets (
    handoff_id TEXT NOT NULL PRIMARY KEY,
    packet_version TEXT NOT NULL,
    status TEXT NOT NULL,
    source_thread_id TEXT NOT NULL,
    source_task_address_id TEXT NOT NULL,
    target_thread_id TEXT NOT NULL,
    digest TEXT NOT NULL,
    inserted_at_ms INTEGER NOT NULL,
    record_json TEXT NOT NULL,
    schema_version TEXT NOT NULL,
    UNIQUE (target_thread_id, digest),
    CHECK (schema_version = 'builder-handoff-packet-store-schema.v1'),
    CHECK (packet_version = 'builder-handoff-packet.v1'),
    CHECK (status = 'pending'),
    CHECK (inserted_at_ms >= 0),
    CHECK (length(record_json) BETWEEN 2 AND 131072)
  ) STRICT`,
  'CREATE INDEX handoff_packets_target_pending_idx ON handoff_packets(target_thread_id, inserted_at_ms ASC, handoff_id ASC)',
]);

const ERROR_MESSAGES = Object.freeze({
  builder_handoff_packet_store_invalid: 'Builder handoff packet storage request could not be verified.',
  builder_handoff_packet_store_conflict: 'Builder handoff packet changed before it could be recorded.',
  builder_handoff_packet_store_integrity_failed: 'Builder handoff packet storage integrity could not be verified.',
  builder_handoff_packet_store_resource_exceeded: 'Builder handoff packet storage limits were reached.',
  builder_handoff_packet_store_unavailable: 'Builder handoff packet storage is unavailable.',
});

class BuilderHandoffPacketStoreError extends Error {
  constructor(code = 'builder_handoff_packet_store_invalid') {
    const selected = Object.hasOwn(ERROR_MESSAGES, code) ? code : 'builder_handoff_packet_store_invalid';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderHandoffPacketStoreError';
    this.code = selected;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code = 'builder_handoff_packet_store_invalid') {
  throw new BuilderHandoffPacketStoreError(code);
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

function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(valueAt(value, key))}`
    )).join(',')}}`;
  }
  fail();
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
  if (typeof value !== 'string' || !pattern.test(value)) fail();
  return value;
}

function safeThreadId(value) {
  return safePattern(value, THREAD_ID_PATTERN);
}

function safeHandoffId(value) {
  return safePattern(value, HANDOFF_ID_PATTERN);
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
  ) fail();
  return value;
}

function assertParentDirectory(filePath) {
  let info;
  try {
    info = fs.lstatSync(path.dirname(filePath));
  } catch {
    fail('builder_handoff_packet_store_unavailable');
  }
  if (!info.isDirectory() || info.isSymbolicLink()) fail('builder_handoff_packet_store_unavailable');
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
  if (!row || !Number.isSafeInteger(row.user_version)) fail('builder_handoff_packet_store_integrity_failed');
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
  if (String(journal?.journal_mode ?? '').toLowerCase() !== 'wal') fail('builder_handoff_packet_store_unavailable');
  const pragmas = runtimePragmas(db);
  if (
    pragmas.foreign_keys !== 'on'
    || pragmas.trusted_schema !== 'off'
    || pragmas.synchronous !== 'full'
    || pragmas.journal_mode !== 'wal'
  ) fail('builder_handoff_packet_store_unavailable');
}

function createSchema(db) {
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const sql of CREATE_SCHEMA_SQL) db.exec(sql);
    db.exec(`PRAGMA user_version = ${BUILDER_HANDOFF_PACKET_STORE_USER_VERSION}`);
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
    expectedDb.exec(`PRAGMA user_version = ${BUILDER_HANDOFF_PACKET_STORE_USER_VERSION}`);
    expectedSchemaFingerprint = canonicalJson(collectSchemaFingerprint(expectedDb));
    return expectedSchemaFingerprint;
  } finally {
    expectedDb.close();
  }
}

function validateSchema(db) {
  const actual = collectSchemaFingerprint(db);
  if (actual.foreign_key_check.length !== 0 || canonicalJson(actual) !== expectedFingerprint()) {
    fail('builder_handoff_packet_store_integrity_failed');
  }
}

function initialize(db) {
  configurePragmas(db);
  const version = userVersion(db);
  if (version === 0) createSchema(db);
  else if (version !== BUILDER_HANDOFF_PACKET_STORE_USER_VERSION) fail('builder_handoff_packet_store_integrity_failed');
  validateSchema(db);
}

function canonicalRecord(value) {
  const text = canonicalJson(value);
  if (text.length < 2 || text.length > MAX_RECORD_JSON_BYTES) fail('builder_handoff_packet_store_resource_exceeded');
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
    return sanitizeBuilderHandoffPacket(parsed);
  } catch (error) {
    if (error instanceof BuilderHandoffPacketStoreError || error instanceof BuilderHandoffPacketError) fail(code);
    throw error;
  }
}

function sanitizeRecordRequest(value) {
  exactObject(value, RECORD_KEYS);
  try {
    return sanitizeBuilderHandoffPacket(valueAt(value, 'handoff_packet'));
  } catch (error) {
    if (error instanceof BuilderHandoffPacketError) fail();
    throw error;
  }
}

function columns() {
  return `handoff_id, packet_version, status, source_thread_id,
    source_task_address_id, target_thread_id, digest, inserted_at_ms, record_json`;
}

function safeRow(row) {
  if (row === null || row === undefined) return null;
  const record = parseCanonicalRecord(row.record_json, 'builder_handoff_packet_store_integrity_failed');
  if (
    record.handoff_id !== safeHandoffId(row.handoff_id)
    || record.packet_version !== row.packet_version
    || record.packet_version !== BUILDER_HANDOFF_PACKET_VERSION
    || row.status !== 'pending'
    || record.source_thread_id !== row.source_thread_id
    || record.source_task_address_id !== row.source_task_address_id
    || record.target_thread_id !== safeThreadId(row.target_thread_id)
    || record.digest !== row.digest
    || record.inserted_at_ms !== row.inserted_at_ms
    || canonicalRecord(record) !== row.record_json
  ) fail('builder_handoff_packet_store_integrity_failed');
  return freezeDeep({ status: 'pending', handoff_packet: record });
}

function loadByHandoffId(db, handoffId) {
  return safeRow(one(db, `SELECT ${columns()} FROM handoff_packets WHERE handoff_id = ?`, [handoffId]));
}

function loadByTargetDigest(db, targetThreadId, digest) {
  return safeRow(one(
    db,
    `SELECT ${columns()} FROM handoff_packets WHERE target_thread_id = ? AND digest = ?`,
    [targetThreadId, digest],
  ));
}

function pendingForTarget(db, targetThreadId) {
  const rows = all(
    db,
    `SELECT ${columns()} FROM handoff_packets
      WHERE target_thread_id = ? AND status = 'pending'
      ORDER BY inserted_at_ms ASC, handoff_id ASC
      LIMIT ?`,
    [targetThreadId, MAX_PENDING_HANDOFFS + 1],
  );
  if (rows.length > MAX_PENDING_HANDOFFS) fail('builder_handoff_packet_store_resource_exceeded');
  return freezeDeep(rows.map(safeRow));
}

function samePacket(left, right) {
  return canonicalJson(left.handoff_packet) === canonicalJson(right.handoff_packet);
}

function evidence(db, transaction) {
  return freezeDeep({
    database_id: DATABASE_ID,
    schema_version: BUILDER_HANDOFF_PACKET_STORE_SCHEMA_VERSION,
    user_version: BUILDER_HANDOFF_PACKET_STORE_USER_VERSION,
    schema_fingerprint_digest: `sha256:${sha256Canonical(collectSchemaFingerprint(db))}`,
    runtime_pragmas: runtimePragmas(db),
    transaction,
    handoff_packet_authority: 'main_owned_handoff_packet_store',
    handoff_packet_contract_authority: 'main_handoff_packet_contract_v1',
    renderer_authority: 'not_present',
    ipc_authority: 'not_present',
    provider_dispatch: false,
    tool_dispatch: false,
    source_read: 'not_present',
    source_write: 'not_present',
    git_mutation: false,
    permission_grant_authority: false,
    plan_approval_authority: false,
    publication_authority: false,
    readiness_authority: 'not_authoritative_for_readiness',
    recovery_model: 'pending_inbox_replay',
  });
}

function writeResult(db, operation, entry) {
  return freezeDeep({
    result_version: BUILDER_HANDOFF_PACKET_STORE_RESULT_VERSION,
    operation,
    handoff_packet: entry,
    handoff_packet_evidence: evidence(db, operation),
  });
}

function readResult(db, transaction, payload) {
  return freezeDeep({
    result_version: BUILDER_HANDOFF_PACKET_STORE_READ_RESULT_VERSION,
    handoff_packet_authority: 'main_owned_handoff_packet_store',
    ...payload,
    evidence: evidence(db, transaction),
  });
}

function insertPacket(db, record) {
  run(db, `INSERT INTO handoff_packets (
    handoff_id, packet_version, status, source_thread_id, source_task_address_id,
    target_thread_id, digest, inserted_at_ms, record_json, schema_version
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
    record.handoff_id,
    record.packet_version,
    'pending',
    record.source_thread_id,
    record.source_task_address_id,
    record.target_thread_id,
    record.digest,
    record.inserted_at_ms,
    canonicalRecord(record),
    BUILDER_HANDOFF_PACKET_STORE_SCHEMA_VERSION,
  ]);
}

function recordHandoffPacket(db, rawRequest) {
  const record = sanitizeRecordRequest(rawRequest);
  db.exec('BEGIN IMMEDIATE');
  try {
    const existing = loadByHandoffId(db, record.handoff_id);
    const existingDigest = loadByTargetDigest(db, record.target_thread_id, record.digest);
    if (existing || existingDigest) {
      const candidate = existing ?? existingDigest;
      if (!samePacket(candidate, { handoff_packet: record })) fail('builder_handoff_packet_store_conflict');
      db.exec('COMMIT');
      return writeResult(db, 'handoff_packet_replayed', candidate);
    }
    insertPacket(db, record);
    const readback = loadByHandoffId(db, record.handoff_id);
    if (!readback || !samePacket(readback, { handoff_packet: record })) {
      fail('builder_handoff_packet_store_integrity_failed');
    }
    db.exec('COMMIT');
    return writeResult(db, 'handoff_packet_recorded', readback);
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* fixed failure below */ }
    throw error;
  }
}

function readHandoffPacket(db, rawRequest) {
  exactObject(rawRequest, READ_KEYS);
  const targetThreadId = safeThreadId(valueAt(rawRequest, 'target_thread_id'));
  const handoffId = safeHandoffId(valueAt(rawRequest, 'handoff_id'));
  const entry = loadByHandoffId(db, handoffId);
  if (!entry || entry.handoff_packet.target_thread_id !== targetThreadId) {
    return readResult(db, 'handoff_packet_absent_read', {
      status: 'absent',
      handoff_packet: null,
    });
  }
  return readResult(db, 'handoff_packet_pending_read', {
    status: 'pending',
    handoff_packet: entry,
  });
}

function listPendingHandoffPackets(db, rawRequest) {
  exactObject(rawRequest, LIST_PENDING_KEYS);
  const targetThreadId = safeThreadId(valueAt(rawRequest, 'target_thread_id'));
  const entries = pendingForTarget(db, targetThreadId);
  return readResult(db, entries.length === 0 ? 'pending_handoff_packets_absent_read' : 'pending_handoff_packets_ready_read', {
    status: entries.length === 0 ? 'absent' : 'ready',
    handoff_packets: entries,
    truncated: entries.length >= MAX_PENDING_HANDOFFS,
  });
}

function ownErrorField(error, key) {
  if (!error || typeof error !== 'object' || utilTypes.isProxy(error)) return null;
  const descriptor = Object.getOwnPropertyDescriptor(error, key);
  return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : null;
}

function normalizeOperationError(error) {
  if (error instanceof BuilderHandoffPacketStoreError) return new BuilderHandoffPacketStoreError(error.code);
  if (error instanceof BuilderHandoffPacketError) return new BuilderHandoffPacketStoreError();
  const sqliteCode = ownErrorField(error, 'code');
  const sqliteErrstr = ownErrorField(error, 'errstr');
  const sqliteErrcode = ownErrorField(error, 'errcode');
  if (sqliteCode && /^SQLITE_CONSTRAINT/u.test(sqliteCode)) {
    return new BuilderHandoffPacketStoreError('builder_handoff_packet_store_integrity_failed');
  }
  if (sqliteErrstr === 'constraint failed' || sqliteErrcode === 1555) {
    return new BuilderHandoffPacketStoreError('builder_handoff_packet_store_integrity_failed');
  }
  if (sqliteCode && /^SQLITE_(CORRUPT|NOTADB|SCHEMA|INTERNAL|MISMATCH)/u.test(sqliteCode)) {
    return new BuilderHandoffPacketStoreError('builder_handoff_packet_store_integrity_failed');
  }
  return new BuilderHandoffPacketStoreError('builder_handoff_packet_store_unavailable');
}

function createBuilderHandoffPacketStore(databasePath) {
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
    store_version: BUILDER_HANDOFF_PACKET_STORE_VERSION,

    close(...rawArguments) {
      if (rawArguments.length !== 0) throw new BuilderHandoffPacketStoreError();
      try { db.close(); } catch (error) { throw normalizeOperationError(error); }
    },

    record_handoff_packet(rawRequest) {
      try { return recordHandoffPacket(db, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },

    read_handoff_packet(rawRequest) {
      try { return readHandoffPacket(db, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },

    list_pending_handoff_packets(rawRequest) {
      try { return listPendingHandoffPackets(db, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },
  });
}

module.exports = Object.freeze({
  BUILDER_HANDOFF_PACKET_STORE_READ_RESULT_VERSION,
  BUILDER_HANDOFF_PACKET_STORE_RESULT_VERSION,
  BUILDER_HANDOFF_PACKET_STORE_SCHEMA_VERSION,
  BUILDER_HANDOFF_PACKET_STORE_USER_VERSION,
  BUILDER_HANDOFF_PACKET_STORE_VERSION,
  BuilderHandoffPacketStoreError,
  createBuilderHandoffPacketStore,
});
