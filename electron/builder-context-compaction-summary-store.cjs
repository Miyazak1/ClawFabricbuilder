'use strict';

const nodeCrypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { types: utilTypes } = require('node:util');

const {
  BUILDER_CONTEXT_COMPACTION_SUMMARY_VERSION,
  BuilderContextCompactionSummaryError,
  sanitizeBuilderContextCompactionSummary,
} = require('./builder-context-compaction-summary.cjs');

const BUILDER_CONTEXT_COMPACTION_SUMMARY_STORE_VERSION = 'builder-context-compaction-summary-store.v1';
const BUILDER_CONTEXT_COMPACTION_SUMMARY_STORE_RESULT_VERSION = 'builder-context-compaction-summary-store-result.v1';
const BUILDER_CONTEXT_COMPACTION_SUMMARY_STORE_READ_RESULT_VERSION = 'builder-context-compaction-summary-store-read-result.v1';
const BUILDER_CONTEXT_COMPACTION_SUMMARY_STORE_SCHEMA_VERSION = 'builder-context-compaction-summary-store-schema.v1';
const BUILDER_CONTEXT_COMPACTION_SUMMARY_STORE_USER_VERSION = 1;
const DATABASE_ID = 'builder-context-compaction-summary-store.v1';

const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const CONVERSATION_ID_PATTERN = new RegExp(`^builder-conversation:${UUID_SOURCE}$`, 'u');
const TASK_ADDRESS_ID_PATTERN = new RegExp(`^builder-task-address:${UUID_SOURCE}$`, 'u');
const SUMMARY_ID_PATTERN = /^builder-context-compaction-summary:[0-9a-f]{64}$/u;
const RECORD_KEYS = Object.freeze(['context_compaction_summary']);
const READ_SUMMARY_KEYS = Object.freeze(['conversation_id', 'summary_id']);
const READ_LATEST_KEYS = Object.freeze(['conversation_id', 'task_address_id']);
const MAX_RECORD_JSON_BYTES = 128 * 1024;

const CREATE_SCHEMA_SQL = Object.freeze([
  `CREATE TABLE context_compaction_summaries (
    summary_id TEXT NOT NULL PRIMARY KEY,
    summary_version TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    task_address_id TEXT NOT NULL,
    source_event_start_id TEXT NOT NULL,
    source_event_end_id TEXT NOT NULL,
    source_event_count INTEGER NOT NULL,
    source_range_digest TEXT NOT NULL,
    token_budget_before INTEGER NOT NULL,
    token_budget_after INTEGER NOT NULL,
    digest TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL,
    record_json TEXT NOT NULL,
    schema_version TEXT NOT NULL,
    UNIQUE (conversation_id, task_address_id, source_range_digest),
    CHECK (schema_version = 'builder-context-compaction-summary-store-schema.v1'),
    CHECK (summary_version = 'builder-context-compaction-summary.v1'),
    CHECK (source_event_count > 0),
    CHECK (token_budget_before > token_budget_after),
    CHECK (token_budget_after > 0),
    CHECK (created_at_ms >= 0),
    CHECK (length(record_json) BETWEEN 2 AND 131072)
  ) STRICT`,
  'CREATE INDEX context_compaction_summaries_latest_idx ON context_compaction_summaries(conversation_id, task_address_id, created_at_ms DESC, summary_id DESC)',
]);

const ERROR_MESSAGES = Object.freeze({
  builder_context_compaction_summary_store_invalid: 'Builder context compaction storage request could not be verified.',
  builder_context_compaction_summary_store_conflict: 'Builder context compaction summary changed before it could be recorded.',
  builder_context_compaction_summary_store_integrity_failed: 'Builder context compaction storage integrity could not be verified.',
  builder_context_compaction_summary_store_resource_exceeded: 'Builder context compaction storage limits were reached.',
  builder_context_compaction_summary_store_unavailable: 'Builder context compaction storage is unavailable.',
});

class BuilderContextCompactionSummaryStoreError extends Error {
  constructor(code = 'builder_context_compaction_summary_store_invalid') {
    const selected = Object.hasOwn(ERROR_MESSAGES, code)
      ? code
      : 'builder_context_compaction_summary_store_invalid';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderContextCompactionSummaryStoreError';
    this.code = selected;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code = 'builder_context_compaction_summary_store_invalid') {
  throw new BuilderContextCompactionSummaryStoreError(code);
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

function safeConversationId(value) {
  return safePattern(value, CONVERSATION_ID_PATTERN);
}

function safeTaskAddressId(value) {
  return safePattern(value, TASK_ADDRESS_ID_PATTERN);
}

function safeSummaryId(value) {
  return safePattern(value, SUMMARY_ID_PATTERN);
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
    fail('builder_context_compaction_summary_store_unavailable');
  }
  if (!info.isDirectory() || info.isSymbolicLink()) {
    fail('builder_context_compaction_summary_store_unavailable');
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
    fail('builder_context_compaction_summary_store_integrity_failed');
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
    fail('builder_context_compaction_summary_store_unavailable');
  }
  const pragmas = runtimePragmas(db);
  if (
    pragmas.foreign_keys !== 'on'
    || pragmas.trusted_schema !== 'off'
    || pragmas.synchronous !== 'full'
    || pragmas.journal_mode !== 'wal'
  ) fail('builder_context_compaction_summary_store_unavailable');
}

function createSchema(db) {
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const sql of CREATE_SCHEMA_SQL) db.exec(sql);
    db.exec(`PRAGMA user_version = ${BUILDER_CONTEXT_COMPACTION_SUMMARY_STORE_USER_VERSION}`);
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
    expectedDb.exec(`PRAGMA user_version = ${BUILDER_CONTEXT_COMPACTION_SUMMARY_STORE_USER_VERSION}`);
    expectedSchemaFingerprint = canonicalJson(collectSchemaFingerprint(expectedDb));
    return expectedSchemaFingerprint;
  } finally {
    expectedDb.close();
  }
}

function validateSchema(db) {
  const actual = collectSchemaFingerprint(db);
  if (actual.foreign_key_check.length !== 0 || canonicalJson(actual) !== expectedFingerprint()) {
    fail('builder_context_compaction_summary_store_integrity_failed');
  }
}

function initialize(db) {
  configurePragmas(db);
  const version = userVersion(db);
  if (version === 0) createSchema(db);
  else if (version !== BUILDER_CONTEXT_COMPACTION_SUMMARY_STORE_USER_VERSION) {
    fail('builder_context_compaction_summary_store_integrity_failed');
  }
  validateSchema(db);
}

function canonicalRecord(value) {
  const text = canonicalJson(value);
  if (text.length < 2 || text.length > MAX_RECORD_JSON_BYTES) {
    fail('builder_context_compaction_summary_store_resource_exceeded');
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
    return sanitizeBuilderContextCompactionSummary(parsed);
  } catch (error) {
    if (
      error instanceof BuilderContextCompactionSummaryStoreError
      || error instanceof BuilderContextCompactionSummaryError
    ) fail(code);
    throw error;
  }
}

function sanitizeRecordRequest(value) {
  exactObject(value, RECORD_KEYS);
  try {
    return sanitizeBuilderContextCompactionSummary(valueAt(value, 'context_compaction_summary'));
  } catch (error) {
    if (error instanceof BuilderContextCompactionSummaryError) {
      fail('builder_context_compaction_summary_store_invalid');
    }
    throw error;
  }
}

function columns() {
  return `summary_id, summary_version, conversation_id, task_address_id,
    source_event_start_id, source_event_end_id, source_event_count,
    source_range_digest, token_budget_before, token_budget_after, digest,
    created_at_ms, record_json`;
}

function safeRow(row) {
  if (row === null || row === undefined) return null;
  const record = parseCanonicalRecord(
    row.record_json,
    'builder_context_compaction_summary_store_integrity_failed',
  );
  if (
    record.summary_id !== safeSummaryId(row.summary_id)
    || record.summary_version !== row.summary_version
    || record.summary_version !== BUILDER_CONTEXT_COMPACTION_SUMMARY_VERSION
    || record.conversation_id !== safeConversationId(row.conversation_id)
    || record.task_address_id !== safeTaskAddressId(row.task_address_id)
    || record.source_event_start_id !== row.source_event_start_id
    || record.source_event_end_id !== row.source_event_end_id
    || record.source_event_count !== row.source_event_count
    || record.source_range_digest !== row.source_range_digest
    || record.token_budget_before !== row.token_budget_before
    || record.token_budget_after !== row.token_budget_after
    || record.digest !== row.digest
    || record.created_at_ms !== row.created_at_ms
    || canonicalRecord(record) !== row.record_json
  ) fail('builder_context_compaction_summary_store_integrity_failed');
  return freezeDeep({ context_compaction_summary: record });
}

function loadBySummaryId(db, summaryId) {
  return safeRow(one(
    db,
    `SELECT ${columns()} FROM context_compaction_summaries WHERE summary_id = ?`,
    [summaryId],
  ));
}

function loadBySourceRange(db, conversationId, taskAddressId, sourceRangeDigest) {
  return safeRow(one(
    db,
    `SELECT ${columns()} FROM context_compaction_summaries
      WHERE conversation_id = ? AND task_address_id = ? AND source_range_digest = ?`,
    [conversationId, taskAddressId, sourceRangeDigest],
  ));
}

function latestSummary(db, conversationId, taskAddressId) {
  return safeRow(one(
    db,
    `SELECT ${columns()} FROM context_compaction_summaries
      WHERE conversation_id = ? AND task_address_id = ?
      ORDER BY created_at_ms DESC, summary_id DESC
      LIMIT 1`,
    [conversationId, taskAddressId],
  ));
}

function sameSummary(left, right) {
  return canonicalJson(left.context_compaction_summary) === canonicalJson(right.context_compaction_summary);
}

function evidence(db, transaction) {
  return freezeDeep({
    database_id: DATABASE_ID,
    schema_version: BUILDER_CONTEXT_COMPACTION_SUMMARY_STORE_SCHEMA_VERSION,
    user_version: BUILDER_CONTEXT_COMPACTION_SUMMARY_STORE_USER_VERSION,
    schema_fingerprint_digest: `sha256:${sha256Canonical(collectSchemaFingerprint(db))}`,
    runtime_pragmas: runtimePragmas(db),
    transaction,
    compaction_summary_authority: 'main_owned_context_compaction_summary_store',
    compaction_summary_contract_authority: 'main_context_compaction_summary_contract_v1',
    renderer_authority: 'not_present',
    ipc_authority: 'not_present',
    conversation_append: false,
    conversation_delete: false,
    provider_dispatch: false,
    tool_dispatch: false,
    source_read: 'not_present',
    source_write: 'not_present',
    git_mutation: false,
    permission_grant_authority: false,
    readiness_authority: 'not_authoritative_for_readiness',
    recovery_model: 'idempotent_store_replay',
  });
}

function writeResult(db, operation, entry) {
  return freezeDeep({
    result_version: BUILDER_CONTEXT_COMPACTION_SUMMARY_STORE_RESULT_VERSION,
    operation,
    context_compaction_summary: entry,
    compaction_summary_evidence: evidence(db, operation),
  });
}

function readResult(db, transaction, payload) {
  return freezeDeep({
    result_version: BUILDER_CONTEXT_COMPACTION_SUMMARY_STORE_READ_RESULT_VERSION,
    compaction_summary_authority: 'main_owned_context_compaction_summary_store',
    ...payload,
    evidence: evidence(db, transaction),
  });
}

function insertSummary(db, record) {
  run(db, `INSERT INTO context_compaction_summaries (
    summary_id, summary_version, conversation_id, task_address_id,
    source_event_start_id, source_event_end_id, source_event_count,
    source_range_digest, token_budget_before, token_budget_after, digest,
    created_at_ms, record_json, schema_version
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
    record.summary_id,
    record.summary_version,
    record.conversation_id,
    record.task_address_id,
    record.source_event_start_id,
    record.source_event_end_id,
    record.source_event_count,
    record.source_range_digest,
    record.token_budget_before,
    record.token_budget_after,
    record.digest,
    record.created_at_ms,
    canonicalRecord(record),
    BUILDER_CONTEXT_COMPACTION_SUMMARY_STORE_SCHEMA_VERSION,
  ]);
}

function recordContextCompactionSummary(db, rawRequest) {
  const record = sanitizeRecordRequest(rawRequest);
  db.exec('BEGIN IMMEDIATE');
  try {
    const existing = loadBySummaryId(db, record.summary_id);
    const existingRange = loadBySourceRange(
      db,
      record.conversation_id,
      record.task_address_id,
      record.source_range_digest,
    );
    if (existing || existingRange) {
      const candidate = existing ?? existingRange;
      if (!sameSummary(candidate, { context_compaction_summary: record })) {
        fail('builder_context_compaction_summary_store_conflict');
      }
      db.exec('COMMIT');
      return writeResult(db, 'context_compaction_summary_replayed', candidate);
    }
    insertSummary(db, record);
    const readback = loadBySummaryId(db, record.summary_id);
    if (!readback || !sameSummary(readback, { context_compaction_summary: record })) {
      fail('builder_context_compaction_summary_store_integrity_failed');
    }
    db.exec('COMMIT');
    return writeResult(db, 'context_compaction_summary_recorded', readback);
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* fixed failure below */ }
    throw error;
  }
}

function readContextCompactionSummary(db, rawRequest) {
  exactObject(rawRequest, READ_SUMMARY_KEYS);
  const conversationId = safeConversationId(valueAt(rawRequest, 'conversation_id'));
  const summaryId = safeSummaryId(valueAt(rawRequest, 'summary_id'));
  const entry = loadBySummaryId(db, summaryId);
  if (!entry || entry.context_compaction_summary.conversation_id !== conversationId) {
    return readResult(db, 'context_compaction_summary_absent_read', {
      status: 'absent',
      context_compaction_summary: null,
    });
  }
  return readResult(db, 'context_compaction_summary_ready_read', {
    status: 'ready',
    context_compaction_summary: entry,
  });
}

function readLatestContextCompactionSummary(db, rawRequest) {
  exactObject(rawRequest, READ_LATEST_KEYS);
  const conversationId = safeConversationId(valueAt(rawRequest, 'conversation_id'));
  const taskAddressId = safeTaskAddressId(valueAt(rawRequest, 'task_address_id'));
  const entry = latestSummary(db, conversationId, taskAddressId);
  if (!entry) {
    return readResult(db, 'latest_context_compaction_summary_absent_read', {
      status: 'absent',
      context_compaction_summary: null,
    });
  }
  return readResult(db, 'latest_context_compaction_summary_ready_read', {
    status: 'ready',
    context_compaction_summary: entry,
  });
}

function ownErrorField(error, key) {
  if (!error || typeof error !== 'object' || utilTypes.isProxy(error)) return null;
  const descriptor = Object.getOwnPropertyDescriptor(error, key);
  return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : null;
}

function normalizeOperationError(error) {
  if (error instanceof BuilderContextCompactionSummaryStoreError) {
    return new BuilderContextCompactionSummaryStoreError(error.code);
  }
  if (error instanceof BuilderContextCompactionSummaryError) {
    return new BuilderContextCompactionSummaryStoreError('builder_context_compaction_summary_store_invalid');
  }
  const sqliteCode = ownErrorField(error, 'code');
  const sqliteErrstr = ownErrorField(error, 'errstr');
  const sqliteErrcode = ownErrorField(error, 'errcode');
  if (sqliteCode && /^SQLITE_CONSTRAINT/u.test(sqliteCode)) {
    return new BuilderContextCompactionSummaryStoreError('builder_context_compaction_summary_store_integrity_failed');
  }
  if (sqliteErrstr === 'constraint failed' || sqliteErrcode === 1555) {
    return new BuilderContextCompactionSummaryStoreError('builder_context_compaction_summary_store_integrity_failed');
  }
  if (sqliteCode && /^SQLITE_(CORRUPT|NOTADB|SCHEMA|INTERNAL|MISMATCH)/u.test(sqliteCode)) {
    return new BuilderContextCompactionSummaryStoreError('builder_context_compaction_summary_store_integrity_failed');
  }
  return new BuilderContextCompactionSummaryStoreError('builder_context_compaction_summary_store_unavailable');
}

function createBuilderContextCompactionSummaryStore(databasePath) {
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
    store_version: BUILDER_CONTEXT_COMPACTION_SUMMARY_STORE_VERSION,

    close(...rawArguments) {
      if (rawArguments.length !== 0) {
        throw new BuilderContextCompactionSummaryStoreError(
          'builder_context_compaction_summary_store_invalid',
        );
      }
      try { db.close(); } catch (error) { throw normalizeOperationError(error); }
    },

    record_context_compaction_summary(rawRequest) {
      try { return recordContextCompactionSummary(db, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },

    read_context_compaction_summary(rawRequest) {
      try { return readContextCompactionSummary(db, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },

    read_latest_context_compaction_summary(rawRequest) {
      try { return readLatestContextCompactionSummary(db, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },
  });
}

module.exports = Object.freeze({
  BUILDER_CONTEXT_COMPACTION_SUMMARY_STORE_READ_RESULT_VERSION,
  BUILDER_CONTEXT_COMPACTION_SUMMARY_STORE_RESULT_VERSION,
  BUILDER_CONTEXT_COMPACTION_SUMMARY_STORE_SCHEMA_VERSION,
  BUILDER_CONTEXT_COMPACTION_SUMMARY_STORE_USER_VERSION,
  BUILDER_CONTEXT_COMPACTION_SUMMARY_STORE_VERSION,
  BuilderContextCompactionSummaryStoreError,
  createBuilderContextCompactionSummaryStore,
});
