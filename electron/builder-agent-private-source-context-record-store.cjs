'use strict';

const nodeCrypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { types: utilTypes } = require('node:util');

const {
  BUILDER_AGENT_PRIVATE_SOURCE_CONTEXT_RECORD_VERSION,
  BuilderAgentPrivateSourceContextRecordError,
  sanitizeBuilderAgentPrivateSourceContextRecord,
} = require('./builder-agent-private-source-context-record.cjs');

const BUILDER_AGENT_PRIVATE_SOURCE_CONTEXT_RECORD_STORE_VERSION =
  'builder-agent-private-source-context-record-store.v1';
const BUILDER_AGENT_PRIVATE_SOURCE_CONTEXT_RECORD_STORE_RESULT_VERSION =
  'builder-agent-private-source-context-record-store-result.v1';
const BUILDER_AGENT_PRIVATE_SOURCE_CONTEXT_RECORD_STORE_READ_RESULT_VERSION =
  'builder-agent-private-source-context-record-store-read-result.v1';
const BUILDER_AGENT_PRIVATE_SOURCE_CONTEXT_RECORD_STORE_SCHEMA_VERSION =
  'builder-agent-private-source-context-record-store-schema.v1';
const BUILDER_AGENT_PRIVATE_SOURCE_CONTEXT_RECORD_STORE_USER_VERSION = 1;
const DATABASE_ID = 'builder-agent-private-source-context-record-store.v1';
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const OWNER_ID_PATTERN = new RegExp(`^builder-user:${UUID_SOURCE}$`, 'u');
const AGENT_ID_PATTERN = new RegExp(`^builder-agent:${UUID_SOURCE}$`, 'u');
const PROJECT_ID_PATTERN = new RegExp(`^builder-project:${UUID_SOURCE}$`, 'u');
const CONVERSATION_ID_PATTERN = new RegExp(`^builder-conversation:${UUID_SOURCE}$`, 'u');
const TURN_ID_PATTERN = new RegExp(`^builder-turn:${UUID_SOURCE}$`, 'u');
const TASK_ID_PATTERN = new RegExp(`^builder-task:${UUID_SOURCE}$`, 'u');
const RUN_ID_PATTERN = new RegExp(`^builder-run:${UUID_SOURCE}$`, 'u');
const ADMISSION_ID_PATTERN = /^builder-agent-supervised-action-admission:[0-9a-f]{64}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const STATUS_PATTERN = /^(?:succeeded|partial|failed)$/u;
const RECORD_KEYS = Object.freeze(['private_source_context_record']);
const READ_RECORD_KEYS = Object.freeze(['record_digest', 'owner_id']);
const READ_ADMISSION_KEYS = Object.freeze(['supervised_action_admission_id', 'owner_id']);
const LIST_TASK_KEYS = Object.freeze(['owner_id', 'project_id', 'task_id']);
const LIST_RUN_KEYS = Object.freeze(['owner_id', 'project_id', 'task_id', 'run_id']);
const MAX_CONTEXT_RECORDS = 256;
const MAX_RECORD_JSON_BYTES = 64 * 1024;
const MAX_CONTEXT_FILES = 8;
const MAX_CONTEXT_TOTAL_BYTES = 8 * 16 * 1024;
const CREATE_SCHEMA_SQL = Object.freeze([
  `CREATE TABLE agent_private_source_context_records (
    record_digest TEXT NOT NULL PRIMARY KEY,
    supervised_action_admission_id TEXT NOT NULL UNIQUE,
    owner_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    turn_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    source_context_status TEXT NOT NULL,
    resource_count INTEGER NOT NULL,
    file_count INTEGER NOT NULL,
    total_content_bytes INTEGER NOT NULL,
    head_sequence INTEGER NOT NULL,
    attempt_number INTEGER NOT NULL,
    request_digest TEXT NOT NULL,
    context_digest TEXT NOT NULL,
    head_digest TEXT NOT NULL,
    record_version TEXT NOT NULL,
    record_json TEXT NOT NULL,
    schema_version TEXT NOT NULL,
    CHECK (schema_version = 'builder-agent-private-source-context-record-store-schema.v1'),
    CHECK (record_version = 'builder-agent-private-source-context-record.v1'),
    CHECK (source_context_status IN ('succeeded', 'partial', 'failed')),
    CHECK (resource_count BETWEEN 1 AND 8),
    CHECK (file_count BETWEEN 0 AND 8),
    CHECK (file_count <= resource_count),
    CHECK (total_content_bytes BETWEEN 0 AND 131072),
    CHECK (head_sequence BETWEEN 1 AND 4096),
    CHECK (attempt_number BETWEEN 1 AND 16),
    CHECK (length(record_json) BETWEEN 2 AND 65536)
  ) STRICT`,
  'CREATE INDEX agent_private_source_context_records_task_idx ON agent_private_source_context_records(owner_id, project_id, task_id, head_sequence, record_digest)',
  'CREATE INDEX agent_private_source_context_records_run_idx ON agent_private_source_context_records(owner_id, project_id, task_id, run_id, head_sequence, record_digest)',
  'CREATE INDEX agent_private_source_context_records_admission_idx ON agent_private_source_context_records(owner_id, supervised_action_admission_id)',
]);
const ERROR_MESSAGES = Object.freeze({
  builder_agent_private_source_context_record_store_invalid:
    'Builder agent private source context record storage request could not be verified.',
  builder_agent_private_source_context_record_store_conflict:
    'Builder agent private source context record changed before it could be recorded.',
  builder_agent_private_source_context_record_store_integrity_failed:
    'Builder agent private source context record storage integrity could not be verified.',
  builder_agent_private_source_context_record_store_resource_exceeded:
    'Builder agent private source context record storage limits were reached.',
  builder_agent_private_source_context_record_store_unavailable:
    'Builder agent private source context record storage is unavailable.',
});

class BuilderAgentPrivateSourceContextRecordStoreError extends Error {
  constructor(code = 'builder_agent_private_source_context_record_store_invalid') {
    const selected = Object.hasOwn(ERROR_MESSAGES, code)
      ? code
      : 'builder_agent_private_source_context_record_store_invalid';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderAgentPrivateSourceContextRecordStoreError';
    this.code = selected;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) {
  throw new BuilderAgentPrivateSourceContextRecordStoreError(code);
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
  if (!isPlainObject(value)) fail('builder_agent_private_source_context_record_store_invalid');
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== keys.length
    || actual.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) fail('builder_agent_private_source_context_record_store_invalid');
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      fail('builder_agent_private_source_context_record_store_invalid');
    }
  }
  return value;
}

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
    fail('builder_agent_private_source_context_record_store_invalid');
  }
  return descriptor.value;
}

function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map(
      (key) => `${JSON.stringify(key)}:${canonicalJson(valueAt(value, key))}`,
    ).join(',')}}`;
  }
  fail('builder_agent_private_source_context_record_store_invalid');
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
    fail('builder_agent_private_source_context_record_store_invalid');
  }
  return value;
}

function safeOwnerId(value) {
  return safePattern(value, OWNER_ID_PATTERN);
}

function safeProjectId(value) {
  return safePattern(value, PROJECT_ID_PATTERN);
}

function safeTaskId(value) {
  return safePattern(value, TASK_ID_PATTERN);
}

function safeRunId(value) {
  return safePattern(value, RUN_ID_PATTERN);
}

function safeRecordDigest(value) {
  return safePattern(value, DIGEST_PATTERN);
}

function safeAdmissionId(value) {
  return safePattern(value, ADMISSION_ID_PATTERN);
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
  ) fail('builder_agent_private_source_context_record_store_invalid');
  return value;
}

function assertParentDirectory(filePath) {
  let info;
  try {
    info = fs.lstatSync(path.dirname(filePath));
  } catch {
    fail('builder_agent_private_source_context_record_store_unavailable');
  }
  if (!info.isDirectory() || info.isSymbolicLink()) {
    fail('builder_agent_private_source_context_record_store_unavailable');
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
    fail('builder_agent_private_source_context_record_store_integrity_failed');
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
  if (mode !== 'wal') fail('builder_agent_private_source_context_record_store_unavailable');
  const pragmas = runtimePragmas(db);
  if (
    pragmas.foreign_keys !== 'on'
    || pragmas.trusted_schema !== 'off'
    || pragmas.synchronous !== 'full'
    || pragmas.journal_mode !== 'wal'
  ) fail('builder_agent_private_source_context_record_store_unavailable');
}

function createSchema(db) {
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const sql of CREATE_SCHEMA_SQL) db.exec(sql);
    db.exec(`PRAGMA user_version = ${BUILDER_AGENT_PRIVATE_SOURCE_CONTEXT_RECORD_STORE_USER_VERSION}`);
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
    expectedDb.exec(`PRAGMA user_version = ${BUILDER_AGENT_PRIVATE_SOURCE_CONTEXT_RECORD_STORE_USER_VERSION}`);
    expectedSchemaFingerprint = canonicalJson(collectSchemaFingerprint(expectedDb));
    return expectedSchemaFingerprint;
  } finally {
    expectedDb.close();
  }
}

function validateSchema(db) {
  const actual = collectSchemaFingerprint(db);
  if (actual.foreign_key_check.length !== 0) {
    fail('builder_agent_private_source_context_record_store_integrity_failed');
  }
  if (canonicalJson(actual) !== expectedFingerprint()) {
    fail('builder_agent_private_source_context_record_store_integrity_failed');
  }
}

function initialize(db) {
  configurePragmas(db);
  const version = userVersion(db);
  if (version === 0) createSchema(db);
  else if (version !== BUILDER_AGENT_PRIVATE_SOURCE_CONTEXT_RECORD_STORE_USER_VERSION) {
    fail('builder_agent_private_source_context_record_store_integrity_failed');
  }
  validateSchema(db);
}

function canonicalRecord(value) {
  const text = canonicalJson(value);
  if (text.length < 2 || text.length > MAX_RECORD_JSON_BYTES) {
    fail('builder_agent_private_source_context_record_store_resource_exceeded');
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
    return sanitizeBuilderAgentPrivateSourceContextRecord(parsed);
  } catch (error) {
    if (
      error instanceof BuilderAgentPrivateSourceContextRecordStoreError
      || error instanceof BuilderAgentPrivateSourceContextRecordError
    ) fail(code);
    throw error;
  }
}

function sanitizeRecordRequest(value) {
  exactObject(value, RECORD_KEYS);
  try {
    return sanitizeBuilderAgentPrivateSourceContextRecord(
      valueAt(value, 'private_source_context_record'),
    );
  } catch (error) {
    if (error instanceof BuilderAgentPrivateSourceContextRecordError) {
      fail('builder_agent_private_source_context_record_store_invalid');
    }
    throw error;
  }
}

function recordColumns() {
  return `record_digest, supervised_action_admission_id, owner_id, agent_id,
    project_id, conversation_id, turn_id, task_id, run_id,
    source_context_status, resource_count, file_count, total_content_bytes,
    head_sequence, attempt_number, request_digest, context_digest, head_digest,
    record_version, record_json`;
}

function safeRow(row) {
  if (row === null || row === undefined) return null;
  const record = parseCanonicalRecord(
    row.record_json,
    'builder_agent_private_source_context_record_store_integrity_failed',
  );
  if (
    record.record_digest !== safeRecordDigest(row.record_digest)
    || record.supervised_action_admission_id !== safeAdmissionId(row.supervised_action_admission_id)
    || record.owner_id !== safeOwnerId(row.owner_id)
    || record.agent_id !== safePattern(row.agent_id, AGENT_ID_PATTERN)
    || record.project_id !== safeProjectId(row.project_id)
    || record.conversation_id !== safePattern(row.conversation_id, CONVERSATION_ID_PATTERN)
    || record.turn_id !== safePattern(row.turn_id, TURN_ID_PATTERN)
    || record.task_id !== safePattern(row.task_id, TASK_ID_PATTERN)
    || record.run_id !== safePattern(row.run_id, RUN_ID_PATTERN)
    || record.source_context_status !== safePattern(row.source_context_status, STATUS_PATTERN)
    || record.resource_count !== row.resource_count
    || record.file_count !== row.file_count
    || record.total_content_bytes !== row.total_content_bytes
    || record.context_binding.head_sequence !== row.head_sequence
    || record.context_binding.attempt_number !== row.attempt_number
    || record.context_binding.request_digest !== safePattern(row.request_digest, DIGEST_PATTERN)
    || record.context_binding.context_digest !== safePattern(row.context_digest, DIGEST_PATTERN)
    || record.context_binding.head_digest !== safePattern(row.head_digest, DIGEST_PATTERN)
    || record.record_version !== row.record_version
    || record.record_version !== BUILDER_AGENT_PRIVATE_SOURCE_CONTEXT_RECORD_VERSION
    || canonicalRecord(record) !== row.record_json
    || record.resource_count < 1
    || record.resource_count > MAX_CONTEXT_FILES
    || record.file_count < 0
    || record.file_count > MAX_CONTEXT_FILES
    || record.total_content_bytes < 0
    || record.total_content_bytes > MAX_CONTEXT_TOTAL_BYTES
  ) fail('builder_agent_private_source_context_record_store_integrity_failed');
  return freezeDeep({ private_source_context_record: record });
}

function loadByDigest(db, digest) {
  return safeRow(one(
    db,
    `SELECT ${recordColumns()} FROM agent_private_source_context_records WHERE record_digest = ?`,
    [digest],
  ));
}

function loadByAdmissionId(db, admissionId) {
  return safeRow(one(
    db,
    `SELECT ${recordColumns()} FROM agent_private_source_context_records
      WHERE supervised_action_admission_id = ?`,
    [admissionId],
  ));
}

function taskEntries(db, ownerId, projectId, taskId) {
  const rows = all(
    db,
    `SELECT ${recordColumns()}
      FROM agent_private_source_context_records
      WHERE owner_id = ? AND project_id = ? AND task_id = ?
      ORDER BY head_sequence ASC, record_digest ASC
      LIMIT ?`,
    [ownerId, projectId, taskId, MAX_CONTEXT_RECORDS + 1],
  );
  if (rows.length > MAX_CONTEXT_RECORDS) {
    fail('builder_agent_private_source_context_record_store_resource_exceeded');
  }
  return freezeDeep(rows.map(safeRow));
}

function runEntries(db, ownerId, projectId, taskId, runId) {
  const rows = all(
    db,
    `SELECT ${recordColumns()}
      FROM agent_private_source_context_records
      WHERE owner_id = ? AND project_id = ? AND task_id = ? AND run_id = ?
      ORDER BY head_sequence ASC, record_digest ASC
      LIMIT ?`,
    [ownerId, projectId, taskId, runId, MAX_CONTEXT_RECORDS + 1],
  );
  if (rows.length > MAX_CONTEXT_RECORDS) {
    fail('builder_agent_private_source_context_record_store_resource_exceeded');
  }
  return freezeDeep(rows.map(safeRow));
}

function sameEntry(left, record) {
  return canonicalJson(left.private_source_context_record) === canonicalJson(record);
}

function evidence(db, transaction) {
  return freezeDeep({
    database_id: DATABASE_ID,
    schema_version: BUILDER_AGENT_PRIVATE_SOURCE_CONTEXT_RECORD_STORE_SCHEMA_VERSION,
    user_version: BUILDER_AGENT_PRIVATE_SOURCE_CONTEXT_RECORD_STORE_USER_VERSION,
    schema_fingerprint_digest: `sha256:${sha256Canonical(collectSchemaFingerprint(db))}`,
    runtime_pragmas: runtimePragmas(db),
    transaction,
    private_source_context_record_authority: 'main_owned_agent_private_source_context_record_store',
    private_source_context_record_contract_authority:
      'main_agent_private_source_context_record_contract_v1',
    renderer_authority: 'not_present',
    ipc_authority: 'not_present',
    provider_dispatch: false,
    model_dispatch: false,
    tool_dispatch: false,
    execution_authority: false,
    permission_grant_authority: false,
    credential_storage: 'not_present',
    source_access: 'digest_only_private_source_context_receipt',
    source_read: 'not_performed_by_store',
    source_write: 'not_present',
    raw_source_storage: 'not_present',
    process_run: false,
    network_access: false,
    revision_authority: false,
    review_authority: false,
    artifact_authority: false,
    recovery_model: 'idempotent_store_replay',
  });
}

function writeResult(db, operation, payload) {
  return freezeDeep({
    result_version: BUILDER_AGENT_PRIVATE_SOURCE_CONTEXT_RECORD_STORE_RESULT_VERSION,
    operation,
    ...payload,
    private_source_context_record_evidence: evidence(db, operation),
  });
}

function readResult(db, transaction, payload) {
  return freezeDeep({
    result_version: BUILDER_AGENT_PRIVATE_SOURCE_CONTEXT_RECORD_STORE_READ_RESULT_VERSION,
    private_source_context_record_authority: 'main_owned_agent_private_source_context_record_store',
    ...payload,
    evidence: evidence(db, transaction),
  });
}

function insertRecord(db, record) {
  run(db, `INSERT INTO agent_private_source_context_records (
    record_digest, supervised_action_admission_id, owner_id, agent_id,
    project_id, conversation_id, turn_id, task_id, run_id,
    source_context_status, resource_count, file_count, total_content_bytes,
    head_sequence, attempt_number, request_digest, context_digest, head_digest,
    record_version, record_json, schema_version
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
    record.record_digest,
    record.supervised_action_admission_id,
    record.owner_id,
    record.agent_id,
    record.project_id,
    record.conversation_id,
    record.turn_id,
    record.task_id,
    record.run_id,
    record.source_context_status,
    record.resource_count,
    record.file_count,
    record.total_content_bytes,
    record.context_binding.head_sequence,
    record.context_binding.attempt_number,
    record.context_binding.request_digest,
    record.context_binding.context_digest,
    record.context_binding.head_digest,
    record.record_version,
    canonicalRecord(record),
    BUILDER_AGENT_PRIVATE_SOURCE_CONTEXT_RECORD_STORE_SCHEMA_VERSION,
  ]);
}

function recordPrivateSourceContext(db, rawRequest) {
  const record = sanitizeRecordRequest(rawRequest);
  db.exec('BEGIN IMMEDIATE');
  try {
    const existing = loadByDigest(db, record.record_digest);
    const existingByAdmission = loadByAdmissionId(db, record.supervised_action_admission_id);
    if (existing || existingByAdmission) {
      const candidate = existing ?? existingByAdmission;
      if (!sameEntry(candidate, record)) {
        fail('builder_agent_private_source_context_record_store_conflict');
      }
      db.exec('COMMIT');
      return writeResult(db, 'agent_private_source_context_record_replayed', {
        agent_private_source_context_record: candidate,
      });
    }
    insertRecord(db, record);
    const readback = loadByDigest(db, record.record_digest);
    if (!readback || !sameEntry(readback, record)) {
      fail('builder_agent_private_source_context_record_store_integrity_failed');
    }
    db.exec('COMMIT');
    return writeResult(db, 'agent_private_source_context_record_recorded', {
      agent_private_source_context_record: readback,
    });
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* fixed failure below */ }
    throw error;
  }
}

function readPrivateSourceContext(db, rawRequest) {
  exactObject(rawRequest, READ_RECORD_KEYS);
  const recordDigest = safeRecordDigest(valueAt(rawRequest, 'record_digest'));
  const ownerId = safeOwnerId(valueAt(rawRequest, 'owner_id'));
  const entry = loadByDigest(db, recordDigest);
  if (!entry || entry.private_source_context_record.owner_id !== ownerId) {
    return readResult(db, 'agent_private_source_context_record_absent_read', {
      status: 'absent',
      agent_private_source_context_record: null,
    });
  }
  return readResult(db, 'agent_private_source_context_record_ready_read', {
    status: 'ready',
    agent_private_source_context_record: entry,
  });
}

function readPrivateSourceContextForAdmission(db, rawRequest) {
  exactObject(rawRequest, READ_ADMISSION_KEYS);
  const admissionId = safeAdmissionId(valueAt(rawRequest, 'supervised_action_admission_id'));
  const ownerId = safeOwnerId(valueAt(rawRequest, 'owner_id'));
  const entry = loadByAdmissionId(db, admissionId);
  if (!entry || entry.private_source_context_record.owner_id !== ownerId) {
    return readResult(db, 'agent_private_source_context_record_admission_absent_read', {
      status: 'absent',
      agent_private_source_context_record: null,
    });
  }
  return readResult(db, 'agent_private_source_context_record_admission_ready_read', {
    status: 'ready',
    agent_private_source_context_record: entry,
  });
}

function listTaskPrivateSourceContexts(db, rawRequest) {
  exactObject(rawRequest, LIST_TASK_KEYS);
  const ownerId = safeOwnerId(valueAt(rawRequest, 'owner_id'));
  const projectId = safeProjectId(valueAt(rawRequest, 'project_id'));
  const taskId = safeTaskId(valueAt(rawRequest, 'task_id'));
  const records = taskEntries(db, ownerId, projectId, taskId);
  return readResult(db, records.length === 0
    ? 'agent_task_private_source_context_records_absent_read'
    : 'agent_task_private_source_context_records_ready_read', {
    status: records.length === 0 ? 'absent' : 'ready',
    agent_private_source_context_records: records,
    truncated: records.length >= MAX_CONTEXT_RECORDS,
  });
}

function listRunPrivateSourceContexts(db, rawRequest) {
  exactObject(rawRequest, LIST_RUN_KEYS);
  const ownerId = safeOwnerId(valueAt(rawRequest, 'owner_id'));
  const projectId = safeProjectId(valueAt(rawRequest, 'project_id'));
  const taskId = safeTaskId(valueAt(rawRequest, 'task_id'));
  const runId = safeRunId(valueAt(rawRequest, 'run_id'));
  const records = runEntries(db, ownerId, projectId, taskId, runId);
  return readResult(db, records.length === 0
    ? 'agent_run_private_source_context_records_absent_read'
    : 'agent_run_private_source_context_records_ready_read', {
    status: records.length === 0 ? 'absent' : 'ready',
    agent_private_source_context_records: records,
    truncated: records.length >= MAX_CONTEXT_RECORDS,
  });
}

function ownErrorField(error, key) {
  if (!error || typeof error !== 'object' || utilTypes.isProxy(error)) return null;
  const descriptor = Object.getOwnPropertyDescriptor(error, key);
  return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : null;
}

function normalizeOperationError(error) {
  if (error instanceof BuilderAgentPrivateSourceContextRecordStoreError) {
    return new BuilderAgentPrivateSourceContextRecordStoreError(error.code);
  }
  if (error instanceof BuilderAgentPrivateSourceContextRecordError) {
    return new BuilderAgentPrivateSourceContextRecordStoreError(
      'builder_agent_private_source_context_record_store_invalid',
    );
  }
  const sqliteCode = ownErrorField(error, 'code');
  const sqliteErrstr = ownErrorField(error, 'errstr');
  const sqliteErrcode = ownErrorField(error, 'errcode');
  if (sqliteCode && /^SQLITE_CONSTRAINT/u.test(sqliteCode)) {
    return new BuilderAgentPrivateSourceContextRecordStoreError(
      'builder_agent_private_source_context_record_store_integrity_failed',
    );
  }
  if (sqliteErrstr === 'constraint failed' || sqliteErrcode === 1555) {
    return new BuilderAgentPrivateSourceContextRecordStoreError(
      'builder_agent_private_source_context_record_store_integrity_failed',
    );
  }
  if (sqliteCode && /^SQLITE_(CORRUPT|NOTADB|SCHEMA|INTERNAL|MISMATCH)/u.test(sqliteCode)) {
    return new BuilderAgentPrivateSourceContextRecordStoreError(
      'builder_agent_private_source_context_record_store_integrity_failed',
    );
  }
  return new BuilderAgentPrivateSourceContextRecordStoreError(
    'builder_agent_private_source_context_record_store_unavailable',
  );
}

function createBuilderAgentPrivateSourceContextRecordStore(databasePath) {
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
    store_version: BUILDER_AGENT_PRIVATE_SOURCE_CONTEXT_RECORD_STORE_VERSION,

    close(...rawArguments) {
      if (rawArguments.length !== 0) {
        throw new BuilderAgentPrivateSourceContextRecordStoreError(
          'builder_agent_private_source_context_record_store_invalid',
        );
      }
      try { db.close(); } catch (error) { throw normalizeOperationError(error); }
    },

    record_private_source_context(rawRequest) {
      try { return recordPrivateSourceContext(db, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },

    read_private_source_context(rawRequest) {
      try { return readPrivateSourceContext(db, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },

    read_private_source_context_for_admission(rawRequest) {
      try { return readPrivateSourceContextForAdmission(db, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },

    list_task_private_source_contexts(rawRequest) {
      try { return listTaskPrivateSourceContexts(db, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },

    list_run_private_source_contexts(rawRequest) {
      try { return listRunPrivateSourceContexts(db, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },
  });
}

module.exports = Object.freeze({
  BUILDER_AGENT_PRIVATE_SOURCE_CONTEXT_RECORD_STORE_READ_RESULT_VERSION,
  BUILDER_AGENT_PRIVATE_SOURCE_CONTEXT_RECORD_STORE_RESULT_VERSION,
  BUILDER_AGENT_PRIVATE_SOURCE_CONTEXT_RECORD_STORE_SCHEMA_VERSION,
  BUILDER_AGENT_PRIVATE_SOURCE_CONTEXT_RECORD_STORE_USER_VERSION,
  BUILDER_AGENT_PRIVATE_SOURCE_CONTEXT_RECORD_STORE_VERSION,
  BuilderAgentPrivateSourceContextRecordStoreError,
  createBuilderAgentPrivateSourceContextRecordStore,
});
