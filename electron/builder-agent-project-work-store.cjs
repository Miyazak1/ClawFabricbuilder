'use strict';

const nodeCrypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { types: utilTypes } = require('node:util');

const {
  BuilderAgentAssignmentContractError,
  sanitizeBuilderAgentAssignmentStatusRecord,
} = require('./builder-agent-assignment-contract.cjs');
const {
  BuilderAgentSupervisionLeaseContractError,
  sanitizeBuilderAgentSupervisionLeaseRecord,
} = require('./builder-agent-supervision-lease-contract.cjs');
const {
  BUILDER_AGENT_PROJECT_WORK_RESULT_RECORD_VERSION,
  BuilderAgentProjectWorkContractError,
  sanitizeBuilderAgentProjectWorkResultRecord,
} = require('./builder-agent-project-work-contract.cjs');

const BUILDER_AGENT_PROJECT_WORK_STORE_VERSION = 'builder-agent-project-work-store.v1';
const BUILDER_AGENT_PROJECT_WORK_STORE_RESULT_VERSION = 'builder-agent-project-work-store-result.v1';
const BUILDER_AGENT_PROJECT_WORK_STORE_READ_RESULT_VERSION = 'builder-agent-project-work-store-read-result.v1';
const BUILDER_AGENT_PROJECT_WORK_STORE_SCHEMA_VERSION = 'builder-agent-project-work-store-schema.v1';
const BUILDER_AGENT_PROJECT_WORK_STORE_USER_VERSION = 1;
const DATABASE_ID = 'builder-agent-project-work-store.v1';
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const OWNER_ID_PATTERN = new RegExp(`^builder-user:${UUID_SOURCE}$`, 'u');
const AGENT_ID_PATTERN = new RegExp(`^builder-agent:${UUID_SOURCE}$`, 'u');
const AGENT_VERSION_ID_PATTERN = /^builder-agent-version:[0-9a-f]{64}$/u;
const PROJECT_ID_PATTERN = new RegExp(`^builder-project:${UUID_SOURCE}$`, 'u');
const CONVERSATION_ID_PATTERN = new RegExp(`^builder-conversation:${UUID_SOURCE}$`, 'u');
const TASK_ID_PATTERN = new RegExp(`^builder-task:${UUID_SOURCE}$`, 'u');
const RUN_ID_PATTERN = new RegExp(`^builder-run:${UUID_SOURCE}$`, 'u');
const SUPERVISOR_ID_PATTERN = new RegExp(`^builder-supervisor:${UUID_SOURCE}$`, 'u');
const ASSIGNMENT_ID_PATTERN = /^builder-agent-assignment:[0-9a-f]{64}$/u;
const ASSIGNMENT_STATUS_ID_PATTERN = /^builder-agent-assignment-status:[0-9a-f]{64}$/u;
const LEASE_ID_PATTERN = /^builder-agent-supervision-lease:[0-9a-f]{64}$/u;
const WORK_RESULT_ID_PATTERN = /^builder-agent-project-work-result:[0-9a-f]{64}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const RECORD_RESULT_KEYS = Object.freeze(['assignment', 'status', 'lease', 'result']);
const READ_RESULT_KEYS = Object.freeze(['work_result_id', 'owner_id']);
const LIST_TASK_RESULTS_KEYS = Object.freeze(['owner_id', 'project_id', 'task_id']);
const MAX_TASK_WORK_RESULTS = 128;
const MAX_RECEIPT_JSON_BYTES = 64 * 1024;
const CREATE_SCHEMA_SQL = Object.freeze([
  `CREATE TABLE agent_project_work_results (
    work_result_id TEXT NOT NULL PRIMARY KEY,
    definition_digest TEXT NOT NULL,
    record_version TEXT NOT NULL,
    assignment_id TEXT NOT NULL,
    assignment_status_id TEXT NOT NULL,
    lease_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    agent_version_id TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    lease_holder_id TEXT NOT NULL,
    work_kind TEXT NOT NULL,
    observed_at_ms INTEGER NOT NULL,
    result_status TEXT NOT NULL,
    summary_code TEXT NOT NULL,
    assignment_json TEXT NOT NULL,
    status_json TEXT NOT NULL,
    lease_json TEXT NOT NULL,
    result_json TEXT NOT NULL,
    schema_version TEXT NOT NULL,
    UNIQUE (lease_id),
    CHECK (schema_version = 'builder-agent-project-work-store-schema.v1'),
    CHECK (record_version = 'builder-agent-project-work-result-record.v1'),
    CHECK (work_kind IN ('project_edit', 'project_test')),
    CHECK (observed_at_ms >= 0),
    CHECK (result_status IN ('proposed', 'blocked', 'failed')),
    CHECK (length(assignment_json) BETWEEN 2 AND 65536),
    CHECK (length(status_json) BETWEEN 2 AND 65536),
    CHECK (length(lease_json) BETWEEN 2 AND 65536),
    CHECK (length(result_json) BETWEEN 2 AND 65536)
  ) STRICT`,
  'CREATE INDEX agent_project_work_results_owner_task_idx ON agent_project_work_results(owner_id, project_id, task_id, observed_at_ms, work_result_id)',
  'CREATE INDEX agent_project_work_results_assignment_idx ON agent_project_work_results(owner_id, assignment_id, observed_at_ms, work_result_id)',
  'CREATE INDEX agent_project_work_results_lease_idx ON agent_project_work_results(lease_id)',
]);
const ERROR_MESSAGES = Object.freeze({
  builder_agent_project_work_store_invalid: 'Builder agent project work could not be verified.',
  builder_agent_project_work_store_not_found: 'Builder agent project work is unavailable.',
  builder_agent_project_work_store_conflict: 'Builder agent project work changed before it could be recorded.',
  builder_agent_project_work_store_integrity_failed: 'Builder agent project work integrity could not be verified.',
  builder_agent_project_work_store_resource_exceeded: 'Builder agent project work limits were reached.',
  builder_agent_project_work_store_unavailable: 'Builder agent project work storage is unavailable.',
});

class BuilderAgentProjectWorkStoreError extends Error {
  constructor(code = 'builder_agent_project_work_store_invalid') {
    const selected = Object.hasOwn(ERROR_MESSAGES, code)
      ? code
      : 'builder_agent_project_work_store_invalid';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderAgentProjectWorkStoreError';
    this.code = selected;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) {
  throw new BuilderAgentProjectWorkStoreError(code);
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
    || utilTypes.isProxy(value)
    || Array.isArray(value)
  ) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactObject(value, keys) {
  if (!isPlainObject(value)) fail('builder_agent_project_work_store_invalid');
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== keys.length
    || actual.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) fail('builder_agent_project_work_store_invalid');
  for (const key of actual) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      fail('builder_agent_project_work_store_invalid');
    }
  }
}

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
    fail('builder_agent_project_work_store_invalid');
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
  fail('builder_agent_project_work_store_invalid');
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
    fail('builder_agent_project_work_store_invalid');
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

function safeWorkResultId(value) {
  return safePattern(value, WORK_RESULT_ID_PATTERN);
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail('builder_agent_project_work_store_invalid');
  return value;
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
  ) fail('builder_agent_project_work_store_invalid');
  return value;
}

function assertParentDirectory(filePath) {
  let info;
  try {
    info = fs.lstatSync(path.dirname(filePath));
  } catch {
    fail('builder_agent_project_work_store_unavailable');
  }
  if (!info.isDirectory() || info.isSymbolicLink()) {
    fail('builder_agent_project_work_store_unavailable');
  }
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function one(db, sql, params = []) {
  return db.prepare(sql).get(...params);
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
    fail('builder_agent_project_work_store_integrity_failed');
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
  if (mode !== 'wal') fail('builder_agent_project_work_store_unavailable');
  const pragmas = runtimePragmas(db);
  if (
    pragmas.foreign_keys !== 'on'
    || pragmas.trusted_schema !== 'off'
    || pragmas.synchronous !== 'full'
    || pragmas.journal_mode !== 'wal'
  ) fail('builder_agent_project_work_store_unavailable');
}

function createSchema(db) {
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const sql of CREATE_SCHEMA_SQL) db.exec(sql);
    db.exec(`PRAGMA user_version = ${BUILDER_AGENT_PROJECT_WORK_STORE_USER_VERSION}`);
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
    expectedDb.exec(`PRAGMA user_version = ${BUILDER_AGENT_PROJECT_WORK_STORE_USER_VERSION}`);
    expectedSchemaFingerprint = canonicalJson(collectSchemaFingerprint(expectedDb));
    return expectedSchemaFingerprint;
  } finally {
    expectedDb.close();
  }
}

function validateSchema(db) {
  const actual = collectSchemaFingerprint(db);
  if (actual.foreign_key_check.length !== 0) fail('builder_agent_project_work_store_integrity_failed');
  if (canonicalJson(actual) !== expectedFingerprint()) {
    fail('builder_agent_project_work_store_integrity_failed');
  }
}

function initialize(db) {
  configurePragmas(db);
  const version = userVersion(db);
  if (version === 0) createSchema(db);
  else if (version !== BUILDER_AGENT_PROJECT_WORK_STORE_USER_VERSION) {
    fail('builder_agent_project_work_store_integrity_failed');
  }
  validateSchema(db);
}

function safeJsonText(value, code) {
  if (
    typeof value !== 'string'
    || value.length < 2
    || value.length > MAX_RECEIPT_JSON_BYTES
    || hasControlCharacter(value)
  ) fail(code);
  return value;
}

function parseCanonicalReceipt(value, code) {
  const text = safeJsonText(value, code);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    fail(code);
  }
  if (!isPlainObject(parsed)) fail(code);
  try {
    if (canonicalJson(parsed) !== text) fail(code);
  } catch (error) {
    if (error instanceof BuilderAgentProjectWorkStoreError) fail(code);
    throw error;
  }
  return parsed;
}

function sanitizeResultRequest(value) {
  exactObject(value, RECORD_RESULT_KEYS);
  const assignment = valueAt(value, 'assignment');
  const status = valueAt(value, 'status');
  const lease = valueAt(value, 'lease');
  const result = valueAt(value, 'result');
  try {
    const activeStatus = sanitizeBuilderAgentAssignmentStatusRecord(status, assignment);
    if (activeStatus.next_status !== 'active') fail('builder_agent_project_work_store_invalid');
    const activeLease = sanitizeBuilderAgentSupervisionLeaseRecord(lease, assignment, activeStatus);
    return freezeDeep({
      assignment,
      status: activeStatus,
      lease: activeLease,
      result: sanitizeBuilderAgentProjectWorkResultRecord(result, assignment, activeStatus, activeLease),
    });
  } catch (error) {
    if (
      error instanceof BuilderAgentAssignmentContractError
      || error instanceof BuilderAgentSupervisionLeaseContractError
      || error instanceof BuilderAgentProjectWorkContractError
    ) fail('builder_agent_project_work_store_invalid');
    throw error;
  }
}

function resultColumns() {
  return `work_result_id, definition_digest, record_version, assignment_id,
    assignment_status_id, lease_id, agent_id, agent_version_id, owner_id,
    project_id, conversation_id, task_id, run_id, lease_holder_id, work_kind,
    observed_at_ms, result_status, summary_code, assignment_json, status_json,
    lease_json, result_json`;
}

function entryFromRow(row) {
  if (!row) return null;
  try {
    const assignment = parseCanonicalReceipt(row.assignment_json, 'builder_agent_project_work_store_integrity_failed');
    const status = parseCanonicalReceipt(row.status_json, 'builder_agent_project_work_store_integrity_failed');
    const lease = parseCanonicalReceipt(row.lease_json, 'builder_agent_project_work_store_integrity_failed');
    const parsedResult = parseCanonicalReceipt(row.result_json, 'builder_agent_project_work_store_integrity_failed');
    const result = sanitizeBuilderAgentProjectWorkResultRecord(parsedResult, assignment, status, lease);
    const rowFacts = freezeDeep({
      work_result_id: safePattern(row.work_result_id, WORK_RESULT_ID_PATTERN),
      definition_digest: safePattern(row.definition_digest, DIGEST_PATTERN),
      record_version: row.record_version,
      assignment_id: safePattern(row.assignment_id, ASSIGNMENT_ID_PATTERN),
      assignment_status_id: safePattern(row.assignment_status_id, ASSIGNMENT_STATUS_ID_PATTERN),
      lease_id: safePattern(row.lease_id, LEASE_ID_PATTERN),
      agent_id: safePattern(row.agent_id, AGENT_ID_PATTERN),
      agent_version_id: safePattern(row.agent_version_id, AGENT_VERSION_ID_PATTERN),
      owner_id: safePattern(row.owner_id, OWNER_ID_PATTERN),
      project_id: safePattern(row.project_id, PROJECT_ID_PATTERN),
      conversation_id: safePattern(row.conversation_id, CONVERSATION_ID_PATTERN),
      task_id: safePattern(row.task_id, TASK_ID_PATTERN),
      run_id: safePattern(row.run_id, RUN_ID_PATTERN),
      lease_holder_id: safePattern(row.lease_holder_id, SUPERVISOR_ID_PATTERN),
      work_kind: row.work_kind,
      observed_at_ms: safeTimestamp(row.observed_at_ms),
      result_status: row.result_status,
      summary_code: row.summary_code,
    });
    if (
      rowFacts.work_result_id !== result.work_result_id
      || rowFacts.definition_digest !== result.definition_digest
      || rowFacts.record_version !== BUILDER_AGENT_PROJECT_WORK_RESULT_RECORD_VERSION
      || rowFacts.record_version !== result.record_version
      || rowFacts.assignment_id !== result.assignment_id
      || rowFacts.assignment_status_id !== result.assignment_status_id
      || rowFacts.lease_id !== result.lease_id
      || rowFacts.agent_id !== result.agent_id
      || rowFacts.agent_version_id !== result.agent_version_id
      || rowFacts.owner_id !== result.owner_id
      || rowFacts.project_id !== result.project_id
      || rowFacts.conversation_id !== result.conversation_id
      || rowFacts.task_id !== result.task_id
      || rowFacts.run_id !== result.run_id
      || rowFacts.lease_holder_id !== result.lease_holder_id
      || rowFacts.work_kind !== result.work_kind
      || rowFacts.observed_at_ms !== result.observed_at_ms
      || rowFacts.result_status !== result.result.status
      || rowFacts.summary_code !== result.result.summary_code
    ) fail('builder_agent_project_work_store_integrity_failed');
    return freezeDeep({ assignment, status, lease, result });
  } catch (error) {
    if (
      error instanceof BuilderAgentProjectWorkStoreError
      || error instanceof BuilderAgentAssignmentContractError
      || error instanceof BuilderAgentSupervisionLeaseContractError
      || error instanceof BuilderAgentProjectWorkContractError
    ) fail('builder_agent_project_work_store_integrity_failed');
    throw error;
  }
}

function loadEntryByResultId(db, workResultId) {
  return entryFromRow(one(
    db,
    `SELECT ${resultColumns()} FROM agent_project_work_results WHERE work_result_id = ?`,
    [workResultId],
  ));
}

function loadEntryByLeaseId(db, leaseId) {
  return entryFromRow(one(
    db,
    `SELECT ${resultColumns()} FROM agent_project_work_results WHERE lease_id = ?`,
    [leaseId],
  ));
}

function taskEntries(db, ownerId, projectId, taskId) {
  const rows = all(
    db,
    `SELECT ${resultColumns()}
      FROM agent_project_work_results
      WHERE owner_id = ? AND project_id = ? AND task_id = ?
      ORDER BY observed_at_ms ASC, work_result_id ASC
      LIMIT ?`,
    [ownerId, projectId, taskId, MAX_TASK_WORK_RESULTS + 1],
  );
  if (rows.length > MAX_TASK_WORK_RESULTS) fail('builder_agent_project_work_store_resource_exceeded');
  return freezeDeep(rows.map(entryFromRow));
}

function sameFact(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function sameEntry(left, right) {
  return sameFact(left.assignment, right.assignment)
    && sameFact(left.status, right.status)
    && sameFact(left.lease, right.lease)
    && sameFact(left.result, right.result);
}

function evidence(db, transaction) {
  return freezeDeep({
    database_id: DATABASE_ID,
    schema_version: BUILDER_AGENT_PROJECT_WORK_STORE_SCHEMA_VERSION,
    user_version: BUILDER_AGENT_PROJECT_WORK_STORE_USER_VERSION,
    schema_fingerprint_digest: sha256Canonical(collectSchemaFingerprint(db)),
    runtime_pragmas: runtimePragmas(db),
    transaction,
    work_result_authority: 'main_owned_agent_project_work_store',
    renderer_authority: 'not_present',
    ipc_authority: 'not_present',
    model_dispatch: false,
    tool_dispatch: false,
    permission_grant_authority: false,
    credential_storage: 'not_present',
    source_read: 'not_present',
    source_write: 'not_present',
    process_run: false,
    revision_authority: false,
    review_authority: false,
  });
}

function storeResult(db, operation, payload) {
  return freezeDeep({
    result_version: BUILDER_AGENT_PROJECT_WORK_STORE_RESULT_VERSION,
    operation,
    ...payload,
    work_result_evidence: evidence(db, operation),
  });
}

function insertResult(db, entry) {
  const result = entry.result;
  run(db, `INSERT INTO agent_project_work_results (
    work_result_id, definition_digest, record_version, assignment_id,
    assignment_status_id, lease_id, agent_id, agent_version_id, owner_id,
    project_id, conversation_id, task_id, run_id, lease_holder_id, work_kind,
    observed_at_ms, result_status, summary_code, assignment_json, status_json,
    lease_json, result_json, schema_version
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
    result.work_result_id,
    result.definition_digest,
    result.record_version,
    result.assignment_id,
    result.assignment_status_id,
    result.lease_id,
    result.agent_id,
    result.agent_version_id,
    result.owner_id,
    result.project_id,
    result.conversation_id,
    result.task_id,
    result.run_id,
    result.lease_holder_id,
    result.work_kind,
    result.observed_at_ms,
    result.result.status,
    result.result.summary_code,
    canonicalJson(entry.assignment),
    canonicalJson(entry.status),
    canonicalJson(entry.lease),
    canonicalJson(result),
    BUILDER_AGENT_PROJECT_WORK_STORE_SCHEMA_VERSION,
  ]);
}

function recordResult(db, rawRequest) {
  const requested = sanitizeResultRequest(rawRequest);
  db.exec('BEGIN IMMEDIATE');
  try {
    const existing = loadEntryByResultId(db, requested.result.work_result_id);
    if (existing !== null) {
      if (!sameEntry(existing, requested)) fail('builder_agent_project_work_store_conflict');
      db.exec('COMMIT');
      return storeResult(db, 'work_result_replayed', { work_result: existing });
    }
    const existingForLease = loadEntryByLeaseId(db, requested.lease.lease_id);
    if (existingForLease !== null) fail('builder_agent_project_work_store_conflict');
    insertResult(db, requested);
    const readback = loadEntryByResultId(db, requested.result.work_result_id);
    if (readback === null || !sameEntry(readback, requested)) {
      fail('builder_agent_project_work_store_integrity_failed');
    }
    db.exec('COMMIT');
    return storeResult(db, 'work_result_recorded', { work_result: readback });
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* fixed failure below */ }
    throw error;
  }
}

function readWorkResult(db, rawRequest) {
  exactObject(rawRequest, READ_RESULT_KEYS);
  const workResultId = safeWorkResultId(valueAt(rawRequest, 'work_result_id'));
  const ownerId = safeOwnerId(valueAt(rawRequest, 'owner_id'));
  const entry = loadEntryByResultId(db, workResultId);
  if (entry === null || entry.result.owner_id !== ownerId) {
    return freezeDeep({
      result_version: BUILDER_AGENT_PROJECT_WORK_STORE_READ_RESULT_VERSION,
      work_result_authority: 'main_owned_agent_project_work_store',
      status: 'absent',
      work_result_id: workResultId,
      owner_id: ownerId,
      work_result: null,
      evidence: evidence(db, 'work_result_absent_read'),
    });
  }
  return freezeDeep({
    result_version: BUILDER_AGENT_PROJECT_WORK_STORE_READ_RESULT_VERSION,
    work_result_authority: 'main_owned_agent_project_work_store',
    status: 'ready',
    work_result_id: workResultId,
    owner_id: ownerId,
    work_result: entry,
    evidence: evidence(db, 'work_result_ready_read'),
  });
}

function listTaskWorkResults(db, rawRequest) {
  exactObject(rawRequest, LIST_TASK_RESULTS_KEYS);
  const ownerId = safeOwnerId(valueAt(rawRequest, 'owner_id'));
  const projectId = safeProjectId(valueAt(rawRequest, 'project_id'));
  const taskId = safeTaskId(valueAt(rawRequest, 'task_id'));
  const results = taskEntries(db, ownerId, projectId, taskId);
  return freezeDeep({
    result_version: BUILDER_AGENT_PROJECT_WORK_STORE_READ_RESULT_VERSION,
    work_result_authority: 'main_owned_agent_project_work_store',
    status: results.length === 0 ? 'absent' : 'ready',
    owner_id: ownerId,
    project_id: projectId,
    task_id: taskId,
    work_results: results,
    evidence: evidence(db, results.length === 0 ? 'task_work_results_absent_read' : 'task_work_results_ready_read'),
  });
}

function ownErrorField(error, key) {
  if (!error || typeof error !== 'object' || utilTypes.isProxy(error)) return null;
  const descriptor = Object.getOwnPropertyDescriptor(error, key);
  return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : null;
}

function normalizeOperationError(error) {
  if (error instanceof BuilderAgentProjectWorkStoreError) {
    return new BuilderAgentProjectWorkStoreError(error.code);
  }
  if (
    error instanceof BuilderAgentAssignmentContractError
    || error instanceof BuilderAgentSupervisionLeaseContractError
    || error instanceof BuilderAgentProjectWorkContractError
  ) {
    return new BuilderAgentProjectWorkStoreError('builder_agent_project_work_store_invalid');
  }
  const sqliteCode = ownErrorField(error, 'code');
  const sqliteErrstr = ownErrorField(error, 'errstr');
  const sqliteErrcode = ownErrorField(error, 'errcode');
  if (sqliteCode && /^SQLITE_CONSTRAINT/u.test(sqliteCode)) {
    return new BuilderAgentProjectWorkStoreError('builder_agent_project_work_store_integrity_failed');
  }
  if (sqliteErrstr === 'constraint failed' || sqliteErrcode === 1555) {
    return new BuilderAgentProjectWorkStoreError('builder_agent_project_work_store_integrity_failed');
  }
  if (sqliteCode && /^SQLITE_(CORRUPT|NOTADB|SCHEMA|INTERNAL|MISMATCH)/u.test(sqliteCode)) {
    return new BuilderAgentProjectWorkStoreError('builder_agent_project_work_store_integrity_failed');
  }
  return new BuilderAgentProjectWorkStoreError('builder_agent_project_work_store_unavailable');
}

function createBuilderAgentProjectWorkStore(databasePath) {
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
    store_version: BUILDER_AGENT_PROJECT_WORK_STORE_VERSION,

    close(...rawArguments) {
      if (rawArguments.length !== 0) {
        throw new BuilderAgentProjectWorkStoreError('builder_agent_project_work_store_invalid');
      }
      try { db.close(); } catch (error) { throw normalizeOperationError(error); }
    },

    record_result(rawRequest) {
      try { return recordResult(db, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },

    read_result(rawRequest) {
      try { return readWorkResult(db, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },

    list_task_results(rawRequest) {
      try { return listTaskWorkResults(db, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },
  });
}

module.exports = Object.freeze({
  BUILDER_AGENT_PROJECT_WORK_STORE_READ_RESULT_VERSION,
  BUILDER_AGENT_PROJECT_WORK_STORE_RESULT_VERSION,
  BUILDER_AGENT_PROJECT_WORK_STORE_SCHEMA_VERSION,
  BUILDER_AGENT_PROJECT_WORK_STORE_USER_VERSION,
  BUILDER_AGENT_PROJECT_WORK_STORE_VERSION,
  BuilderAgentProjectWorkStoreError,
  createBuilderAgentProjectWorkStore,
});
