'use strict';

const nodeCrypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { types: utilTypes } = require('node:util');

const {
  BUILDER_TOOL_CALL_RECORD_VERSION,
  BuilderToolCallRecordError,
  sanitizeBuilderToolCallRecord,
} = require('./builder-tool-call-records.cjs');

const BUILDER_AGENT_TOOL_CALL_RECORD_STORE_VERSION =
  'builder-agent-tool-call-record-store.v1';
const BUILDER_AGENT_TOOL_CALL_RECORD_STORE_RESULT_VERSION =
  'builder-agent-tool-call-record-store-result.v1';
const BUILDER_AGENT_TOOL_CALL_RECORD_STORE_READ_RESULT_VERSION =
  'builder-agent-tool-call-record-store-read-result.v1';
const BUILDER_AGENT_TOOL_CALL_RECORD_STORE_SCHEMA_VERSION =
  'builder-agent-tool-call-record-store-schema.v1';
const BUILDER_AGENT_TOOL_CALL_RECORD_STORE_USER_VERSION = 1;
const DATABASE_ID = 'builder-agent-tool-call-record-store.v1';
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const OWNER_ID_PATTERN = new RegExp(`^builder-user:${UUID_SOURCE}$`, 'u');
const PROJECT_ID_PATTERN = new RegExp(`^builder-project:${UUID_SOURCE}$`, 'u');
const CONVERSATION_ID_PATTERN = new RegExp(`^builder-conversation:${UUID_SOURCE}$`, 'u');
const TURN_ID_PATTERN = new RegExp(`^builder-turn:${UUID_SOURCE}$`, 'u');
const TASK_ID_PATTERN = new RegExp(`^builder-task:${UUID_SOURCE}$`, 'u');
const RUN_ID_PATTERN = new RegExp(`^builder-run:${UUID_SOURCE}$`, 'u');
const STEP_ID_PATTERN = new RegExp(`^builder-run-step:${UUID_SOURCE}$`, 'u');
const ACTOR_ID_PATTERN = new RegExp(`^(?:builder-user|builder-agent):${UUID_SOURCE}$`, 'u');
const TOOL_CALL_ID_PATTERN = new RegExp(`^builder-tool-call:${UUID_SOURCE}$`, 'u');
const ADMISSION_ID_PATTERN = /^builder-agent-supervised-action-admission:[0-9a-f]{64}$/u;
const PERMISSION_ID_PATTERN = /^builder-permission:[0-9a-f]{64}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const TOOL_NAME_PATTERN = /^[a-z][a-z0-9.-]{0,63}$/u;
const ACTION_PATTERN = /^[a-z][a-z0-9.]{0,63}$/u;
const RESOURCE_KIND_PATTERN = /^[a-z][a-z0-9.-]{0,63}$/u;
const RESOURCE_ID_PATTERN = /^[a-z][a-z0-9._:/@-]{0,127}$/u;
const RECORD_KEYS = Object.freeze([
  'owner_id',
  'supervised_action_admission_id',
  'tool_call_record',
]);
const READ_TOOL_CALL_KEYS = Object.freeze(['tool_call_id', 'owner_id']);
const READ_ADMISSION_KEYS = Object.freeze(['supervised_action_admission_id', 'owner_id']);
const LIST_TASK_KEYS = Object.freeze(['owner_id', 'project_id', 'task_id']);
const LIST_RUN_KEYS = Object.freeze(['owner_id', 'project_id', 'task_id', 'run_id']);
const MAX_TOOL_CALLS = 256;
const MAX_RECORD_JSON_BYTES = 64 * 1024;
const CREATE_SCHEMA_SQL = Object.freeze([
  `CREATE TABLE agent_tool_call_records (
    tool_call_id TEXT NOT NULL PRIMARY KEY,
    entry_digest TEXT NOT NULL UNIQUE,
    record_digest TEXT NOT NULL UNIQUE,
    supervised_action_admission_id TEXT NOT NULL UNIQUE,
    owner_id TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    turn_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    step_id TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    action TEXT NOT NULL,
    resource_kind TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    permission_id TEXT NOT NULL,
    permission_evaluated_at_ms INTEGER NOT NULL,
    requested_at_ms INTEGER NOT NULL,
    record_version TEXT NOT NULL,
    record_json TEXT NOT NULL,
    schema_version TEXT NOT NULL,
    CHECK (schema_version = 'builder-agent-tool-call-record-store-schema.v1'),
    CHECK (record_version = 'builder-tool-call-record.v1'),
    CHECK (permission_evaluated_at_ms >= 0),
    CHECK (requested_at_ms >= permission_evaluated_at_ms),
    CHECK (length(record_json) BETWEEN 2 AND 65536)
  ) STRICT`,
  'CREATE INDEX agent_tool_call_records_task_idx ON agent_tool_call_records(owner_id, project_id, task_id, requested_at_ms, tool_call_id)',
  'CREATE INDEX agent_tool_call_records_run_idx ON agent_tool_call_records(owner_id, project_id, task_id, run_id, requested_at_ms, tool_call_id)',
  'CREATE INDEX agent_tool_call_records_admission_idx ON agent_tool_call_records(owner_id, supervised_action_admission_id)',
]);
const ERROR_MESSAGES = Object.freeze({
  builder_agent_tool_call_record_store_invalid:
    'Builder agent tool call record storage request could not be verified.',
  builder_agent_tool_call_record_store_conflict:
    'Builder agent tool call record changed before it could be recorded.',
  builder_agent_tool_call_record_store_integrity_failed:
    'Builder agent tool call record storage integrity could not be verified.',
  builder_agent_tool_call_record_store_resource_exceeded:
    'Builder agent tool call record storage limits were reached.',
  builder_agent_tool_call_record_store_unavailable:
    'Builder agent tool call record storage is unavailable.',
});

class BuilderAgentToolCallRecordStoreError extends Error {
  constructor(code = 'builder_agent_tool_call_record_store_invalid') {
    const selected = Object.hasOwn(ERROR_MESSAGES, code)
      ? code
      : 'builder_agent_tool_call_record_store_invalid';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderAgentToolCallRecordStoreError';
    this.code = selected;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) {
  throw new BuilderAgentToolCallRecordStoreError(code);
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
  if (!isPlainObject(value)) fail('builder_agent_tool_call_record_store_invalid');
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== keys.length
    || actual.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) fail('builder_agent_tool_call_record_store_invalid');
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      fail('builder_agent_tool_call_record_store_invalid');
    }
  }
  return value;
}

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
    fail('builder_agent_tool_call_record_store_invalid');
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
  fail('builder_agent_tool_call_record_store_invalid');
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
    fail('builder_agent_tool_call_record_store_invalid');
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

function safeToolCallId(value) {
  return safePattern(value, TOOL_CALL_ID_PATTERN);
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
  ) fail('builder_agent_tool_call_record_store_invalid');
  return value;
}

function assertParentDirectory(filePath) {
  let info;
  try {
    info = fs.lstatSync(path.dirname(filePath));
  } catch {
    fail('builder_agent_tool_call_record_store_unavailable');
  }
  if (!info.isDirectory() || info.isSymbolicLink()) {
    fail('builder_agent_tool_call_record_store_unavailable');
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
    fail('builder_agent_tool_call_record_store_integrity_failed');
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
  if (mode !== 'wal') fail('builder_agent_tool_call_record_store_unavailable');
  const pragmas = runtimePragmas(db);
  if (
    pragmas.foreign_keys !== 'on'
    || pragmas.trusted_schema !== 'off'
    || pragmas.synchronous !== 'full'
    || pragmas.journal_mode !== 'wal'
  ) fail('builder_agent_tool_call_record_store_unavailable');
}

function createSchema(db) {
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const sql of CREATE_SCHEMA_SQL) db.exec(sql);
    db.exec(`PRAGMA user_version = ${BUILDER_AGENT_TOOL_CALL_RECORD_STORE_USER_VERSION}`);
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
    expectedDb.exec(`PRAGMA user_version = ${BUILDER_AGENT_TOOL_CALL_RECORD_STORE_USER_VERSION}`);
    expectedSchemaFingerprint = canonicalJson(collectSchemaFingerprint(expectedDb));
    return expectedSchemaFingerprint;
  } finally {
    expectedDb.close();
  }
}

function validateSchema(db) {
  const actual = collectSchemaFingerprint(db);
  if (actual.foreign_key_check.length !== 0) {
    fail('builder_agent_tool_call_record_store_integrity_failed');
  }
  if (canonicalJson(actual) !== expectedFingerprint()) {
    fail('builder_agent_tool_call_record_store_integrity_failed');
  }
}

function initialize(db) {
  configurePragmas(db);
  const version = userVersion(db);
  if (version === 0) createSchema(db);
  else if (version !== BUILDER_AGENT_TOOL_CALL_RECORD_STORE_USER_VERSION) {
    fail('builder_agent_tool_call_record_store_integrity_failed');
  }
  validateSchema(db);
}

function canonicalRecord(value) {
  const text = canonicalJson(value);
  if (text.length < 2 || text.length > MAX_RECORD_JSON_BYTES) {
    fail('builder_agent_tool_call_record_store_resource_exceeded');
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
    return sanitizeBuilderToolCallRecord(parsed);
  } catch (error) {
    if (
      error instanceof BuilderAgentToolCallRecordStoreError
      || error instanceof BuilderToolCallRecordError
    ) fail(code);
    throw error;
  }
}

function sanitizeRecordRequest(value) {
  const source = exactObject(value, RECORD_KEYS);
  const ownerId = safeOwnerId(valueAt(source, 'owner_id'));
  const admissionId = safeAdmissionId(valueAt(source, 'supervised_action_admission_id'));
  try {
    return freezeDeep({
      owner_id: ownerId,
      supervised_action_admission_id: admissionId,
      tool_call_record: sanitizeBuilderToolCallRecord(valueAt(source, 'tool_call_record')),
    });
  } catch (error) {
    if (error instanceof BuilderToolCallRecordError) {
      fail('builder_agent_tool_call_record_store_invalid');
    }
    throw error;
  }
}

function entryDigest(entry) {
  return `sha256:${sha256Canonical({
    owner_id: entry.owner_id,
    supervised_action_admission_id: entry.supervised_action_admission_id,
    tool_call_record_digest: entry.tool_call_record.record_digest,
  })}`;
}

function toolCallColumns() {
  return `tool_call_id, entry_digest, record_digest, supervised_action_admission_id,
    owner_id, actor_id, project_id, conversation_id, turn_id, task_id, run_id,
    step_id, tool_name, action, resource_kind, resource_id, permission_id,
    permission_evaluated_at_ms, requested_at_ms, record_version, record_json`;
}

function safeRow(row) {
  if (row === null || row === undefined) return null;
  const record = parseCanonicalRecord(
    row.record_json,
    'builder_agent_tool_call_record_store_integrity_failed',
  );
  if (
    record.tool_call_id !== safeToolCallId(row.tool_call_id)
    || entryDigest({
      owner_id: row.owner_id,
      supervised_action_admission_id: row.supervised_action_admission_id,
      tool_call_record: record,
    }) !== safePattern(row.entry_digest, DIGEST_PATTERN)
    || record.record_digest !== safePattern(row.record_digest, DIGEST_PATTERN)
    || safeAdmissionId(row.supervised_action_admission_id) !== row.supervised_action_admission_id
    || safeOwnerId(row.owner_id) !== row.owner_id
    || record.permission_admission_receipt.actor_id !== safePattern(row.actor_id, ACTOR_ID_PATTERN)
    || record.project_id !== safeProjectId(row.project_id)
    || record.conversation_id !== safePattern(row.conversation_id, CONVERSATION_ID_PATTERN)
    || record.turn_id !== safePattern(row.turn_id, TURN_ID_PATTERN)
    || record.task_id !== safePattern(row.task_id, TASK_ID_PATTERN)
    || record.run_id !== safePattern(row.run_id, RUN_ID_PATTERN)
    || record.step_id !== safePattern(row.step_id, STEP_ID_PATTERN)
    || record.tool_name !== safePattern(row.tool_name, TOOL_NAME_PATTERN)
    || record.action !== safePattern(row.action, ACTION_PATTERN)
    || record.resource.resource_kind !== safePattern(row.resource_kind, RESOURCE_KIND_PATTERN)
    || record.resource.resource_id !== safePattern(row.resource_id, RESOURCE_ID_PATTERN)
    || record.permission_admission_receipt.permission_id !== safePattern(row.permission_id, PERMISSION_ID_PATTERN)
    || record.permission_admission_receipt.evaluated_at_ms !== row.permission_evaluated_at_ms
    || record.requested_at_ms !== row.requested_at_ms
    || record.record_version !== row.record_version
    || record.record_version !== BUILDER_TOOL_CALL_RECORD_VERSION
    || canonicalRecord(record) !== row.record_json
  ) fail('builder_agent_tool_call_record_store_integrity_failed');
  return freezeDeep({
    owner_id: row.owner_id,
    supervised_action_admission_id: row.supervised_action_admission_id,
    tool_call_record: record,
  });
}

function loadByToolCallId(db, toolCallId) {
  return safeRow(one(
    db,
    `SELECT ${toolCallColumns()} FROM agent_tool_call_records WHERE tool_call_id = ?`,
    [toolCallId],
  ));
}

function loadByAdmissionId(db, admissionId) {
  return safeRow(one(
    db,
    `SELECT ${toolCallColumns()} FROM agent_tool_call_records
      WHERE supervised_action_admission_id = ?`,
    [admissionId],
  ));
}

function loadByDigest(db, digest) {
  return safeRow(one(
    db,
    `SELECT ${toolCallColumns()} FROM agent_tool_call_records
      WHERE record_digest = ?`,
    [digest],
  ));
}

function taskEntries(db, ownerId, projectId, taskId) {
  const rows = all(
    db,
    `SELECT ${toolCallColumns()}
      FROM agent_tool_call_records
      WHERE owner_id = ? AND project_id = ? AND task_id = ?
      ORDER BY requested_at_ms ASC, tool_call_id ASC
      LIMIT ?`,
    [ownerId, projectId, taskId, MAX_TOOL_CALLS + 1],
  );
  if (rows.length > MAX_TOOL_CALLS) {
    fail('builder_agent_tool_call_record_store_resource_exceeded');
  }
  return freezeDeep(rows.map(safeRow));
}

function runEntries(db, ownerId, projectId, taskId, runId) {
  const rows = all(
    db,
    `SELECT ${toolCallColumns()}
      FROM agent_tool_call_records
      WHERE owner_id = ? AND project_id = ? AND task_id = ? AND run_id = ?
      ORDER BY requested_at_ms ASC, tool_call_id ASC
      LIMIT ?`,
    [ownerId, projectId, taskId, runId, MAX_TOOL_CALLS + 1],
  );
  if (rows.length > MAX_TOOL_CALLS) {
    fail('builder_agent_tool_call_record_store_resource_exceeded');
  }
  return freezeDeep(rows.map(safeRow));
}

function sameEntry(left, right) {
  return left.owner_id === right.owner_id
    && left.supervised_action_admission_id === right.supervised_action_admission_id
    && canonicalJson(left.tool_call_record) === canonicalJson(right.tool_call_record);
}

function evidence(db, transaction) {
  return freezeDeep({
    database_id: DATABASE_ID,
    schema_version: BUILDER_AGENT_TOOL_CALL_RECORD_STORE_SCHEMA_VERSION,
    user_version: BUILDER_AGENT_TOOL_CALL_RECORD_STORE_USER_VERSION,
    schema_fingerprint_digest: `sha256:${sha256Canonical(collectSchemaFingerprint(db))}`,
    runtime_pragmas: runtimePragmas(db),
    transaction,
    tool_call_record_authority: 'main_owned_agent_tool_call_record_store',
    tool_call_record_contract_authority: 'main_tool_call_record_contract_v1',
    renderer_authority: 'not_present',
    ipc_authority: 'not_present',
    provider_dispatch: false,
    model_dispatch: false,
    tool_dispatch: false,
    execution_authority: false,
    permission_grant_authority: false,
    credential_storage: 'not_present',
    source_access: 'not_present',
    source_read: 'not_present',
    source_write: 'not_present',
    raw_output_storage: 'not_present',
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
    result_version: BUILDER_AGENT_TOOL_CALL_RECORD_STORE_RESULT_VERSION,
    operation,
    ...payload,
    tool_call_record_evidence: evidence(db, operation),
  });
}

function readResult(db, transaction, payload) {
  return freezeDeep({
    result_version: BUILDER_AGENT_TOOL_CALL_RECORD_STORE_READ_RESULT_VERSION,
    tool_call_record_authority: 'main_owned_agent_tool_call_record_store',
    ...payload,
    evidence: evidence(db, transaction),
  });
}

function insertRecord(db, entry) {
  const record = entry.tool_call_record;
  run(db, `INSERT INTO agent_tool_call_records (
    tool_call_id, entry_digest, record_digest, supervised_action_admission_id,
    owner_id, actor_id, project_id, conversation_id, turn_id, task_id, run_id,
    step_id, tool_name, action, resource_kind, resource_id, permission_id,
    permission_evaluated_at_ms, requested_at_ms, record_version, record_json,
    schema_version
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
    record.tool_call_id,
    entryDigest(entry),
    record.record_digest,
    entry.supervised_action_admission_id,
    entry.owner_id,
    record.permission_admission_receipt.actor_id,
    record.project_id,
    record.conversation_id,
    record.turn_id,
    record.task_id,
    record.run_id,
    record.step_id,
    record.tool_name,
    record.action,
    record.resource.resource_kind,
    record.resource.resource_id,
    record.permission_admission_receipt.permission_id,
    record.permission_admission_receipt.evaluated_at_ms,
    record.requested_at_ms,
    record.record_version,
    canonicalRecord(record),
    BUILDER_AGENT_TOOL_CALL_RECORD_STORE_SCHEMA_VERSION,
  ]);
}

function recordToolCall(db, rawRequest) {
  const requested = sanitizeRecordRequest(rawRequest);
  db.exec('BEGIN IMMEDIATE');
  try {
    const existing = loadByToolCallId(db, requested.tool_call_record.tool_call_id);
    const existingByAdmission = loadByAdmissionId(db, requested.supervised_action_admission_id);
    const existingByDigest = loadByDigest(db, requested.tool_call_record.record_digest);
    if (existing || existingByAdmission || existingByDigest) {
      const candidate = existing ?? existingByAdmission ?? existingByDigest;
      if (!sameEntry(candidate, requested)) {
        fail('builder_agent_tool_call_record_store_conflict');
      }
      db.exec('COMMIT');
      return writeResult(db, 'agent_tool_call_record_replayed', { agent_tool_call_record: candidate });
    }
    insertRecord(db, requested);
    const readback = loadByToolCallId(db, requested.tool_call_record.tool_call_id);
    if (!readback || !sameEntry(readback, requested)) {
      fail('builder_agent_tool_call_record_store_integrity_failed');
    }
    db.exec('COMMIT');
    return writeResult(db, 'agent_tool_call_record_recorded', { agent_tool_call_record: readback });
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* fixed failure below */ }
    throw error;
  }
}

function readToolCall(db, rawRequest) {
  exactObject(rawRequest, READ_TOOL_CALL_KEYS);
  const toolCallId = safeToolCallId(valueAt(rawRequest, 'tool_call_id'));
  const ownerId = safeOwnerId(valueAt(rawRequest, 'owner_id'));
  const entry = loadByToolCallId(db, toolCallId);
  if (!entry || entry.owner_id !== ownerId) {
    return readResult(db, 'agent_tool_call_record_absent_read', {
      status: 'absent',
      agent_tool_call_record: null,
    });
  }
  return readResult(db, 'agent_tool_call_record_ready_read', {
    status: 'ready',
    agent_tool_call_record: entry,
  });
}

function readToolCallForAdmission(db, rawRequest) {
  exactObject(rawRequest, READ_ADMISSION_KEYS);
  const admissionId = safeAdmissionId(valueAt(rawRequest, 'supervised_action_admission_id'));
  const ownerId = safeOwnerId(valueAt(rawRequest, 'owner_id'));
  const entry = loadByAdmissionId(db, admissionId);
  if (!entry || entry.owner_id !== ownerId) {
    return readResult(db, 'agent_tool_call_record_admission_absent_read', {
      status: 'absent',
      agent_tool_call_record: null,
    });
  }
  return readResult(db, 'agent_tool_call_record_admission_ready_read', {
    status: 'ready',
    agent_tool_call_record: entry,
  });
}

function listTaskToolCalls(db, rawRequest) {
  exactObject(rawRequest, LIST_TASK_KEYS);
  const ownerId = safeOwnerId(valueAt(rawRequest, 'owner_id'));
  const projectId = safeProjectId(valueAt(rawRequest, 'project_id'));
  const taskId = safeTaskId(valueAt(rawRequest, 'task_id'));
  const records = taskEntries(db, ownerId, projectId, taskId);
  return readResult(db, records.length === 0 ? 'agent_task_tool_call_records_absent_read' : 'agent_task_tool_call_records_ready_read', {
    status: records.length === 0 ? 'absent' : 'ready',
    agent_tool_call_records: records,
    truncated: records.length >= MAX_TOOL_CALLS,
  });
}

function listRunToolCalls(db, rawRequest) {
  exactObject(rawRequest, LIST_RUN_KEYS);
  const ownerId = safeOwnerId(valueAt(rawRequest, 'owner_id'));
  const projectId = safeProjectId(valueAt(rawRequest, 'project_id'));
  const taskId = safeTaskId(valueAt(rawRequest, 'task_id'));
  const runId = safeRunId(valueAt(rawRequest, 'run_id'));
  const records = runEntries(db, ownerId, projectId, taskId, runId);
  return readResult(db, records.length === 0 ? 'agent_run_tool_call_records_absent_read' : 'agent_run_tool_call_records_ready_read', {
    status: records.length === 0 ? 'absent' : 'ready',
    agent_tool_call_records: records,
    truncated: records.length >= MAX_TOOL_CALLS,
  });
}

function ownErrorField(error, key) {
  if (!error || typeof error !== 'object' || utilTypes.isProxy(error)) return null;
  const descriptor = Object.getOwnPropertyDescriptor(error, key);
  return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : null;
}

function normalizeOperationError(error) {
  if (error instanceof BuilderAgentToolCallRecordStoreError) {
    return new BuilderAgentToolCallRecordStoreError(error.code);
  }
  if (error instanceof BuilderToolCallRecordError) {
    return new BuilderAgentToolCallRecordStoreError(
      'builder_agent_tool_call_record_store_invalid',
    );
  }
  const sqliteCode = ownErrorField(error, 'code');
  const sqliteErrstr = ownErrorField(error, 'errstr');
  const sqliteErrcode = ownErrorField(error, 'errcode');
  if (sqliteCode && /^SQLITE_CONSTRAINT/u.test(sqliteCode)) {
    return new BuilderAgentToolCallRecordStoreError(
      'builder_agent_tool_call_record_store_integrity_failed',
    );
  }
  if (sqliteErrstr === 'constraint failed' || sqliteErrcode === 1555) {
    return new BuilderAgentToolCallRecordStoreError(
      'builder_agent_tool_call_record_store_integrity_failed',
    );
  }
  if (sqliteCode && /^SQLITE_(CORRUPT|NOTADB|SCHEMA|INTERNAL|MISMATCH)/u.test(sqliteCode)) {
    return new BuilderAgentToolCallRecordStoreError(
      'builder_agent_tool_call_record_store_integrity_failed',
    );
  }
  return new BuilderAgentToolCallRecordStoreError(
    'builder_agent_tool_call_record_store_unavailable',
  );
}

function createBuilderAgentToolCallRecordStore(databasePath) {
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
    store_version: BUILDER_AGENT_TOOL_CALL_RECORD_STORE_VERSION,

    close(...rawArguments) {
      if (rawArguments.length !== 0) {
        throw new BuilderAgentToolCallRecordStoreError(
          'builder_agent_tool_call_record_store_invalid',
        );
      }
      try { db.close(); } catch (error) { throw normalizeOperationError(error); }
    },

    record_tool_call(rawRequest) {
      try { return recordToolCall(db, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },

    read_tool_call(rawRequest) {
      try { return readToolCall(db, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },

    read_tool_call_for_admission(rawRequest) {
      try { return readToolCallForAdmission(db, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },

    list_task_tool_calls(rawRequest) {
      try { return listTaskToolCalls(db, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },

    list_run_tool_calls(rawRequest) {
      try { return listRunToolCalls(db, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },
  });
}

module.exports = Object.freeze({
  BUILDER_AGENT_TOOL_CALL_RECORD_STORE_READ_RESULT_VERSION,
  BUILDER_AGENT_TOOL_CALL_RECORD_STORE_RESULT_VERSION,
  BUILDER_AGENT_TOOL_CALL_RECORD_STORE_SCHEMA_VERSION,
  BUILDER_AGENT_TOOL_CALL_RECORD_STORE_USER_VERSION,
  BUILDER_AGENT_TOOL_CALL_RECORD_STORE_VERSION,
  BuilderAgentToolCallRecordStoreError,
  createBuilderAgentToolCallRecordStore,
});
