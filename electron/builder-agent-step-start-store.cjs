'use strict';

const nodeCrypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { types: utilTypes } = require('node:util');

const {
  BUILDER_AGENT_STEP_START_RECEIPT_VERSION,
  BuilderAgentStepStartContractError,
  sanitizeBuilderAgentStepStartReceipt,
} = require('./builder-agent-step-start-contract.cjs');

const BUILDER_AGENT_STEP_START_STORE_VERSION =
  'builder-agent-step-start-store.v1';
const BUILDER_AGENT_STEP_START_STORE_RESULT_VERSION =
  'builder-agent-step-start-store-result.v1';
const BUILDER_AGENT_STEP_START_STORE_READ_RESULT_VERSION =
  'builder-agent-step-start-store-read-result.v1';
const BUILDER_AGENT_STEP_START_STORE_SCHEMA_VERSION =
  'builder-agent-step-start-store-schema.v1';
const BUILDER_AGENT_STEP_START_STORE_USER_VERSION = 1;
const DATABASE_ID = 'builder-agent-step-start-store.v1';
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const OWNER_ID_PATTERN = new RegExp(`^builder-user:${UUID_SOURCE}$`, 'u');
const PROJECT_ID_PATTERN = new RegExp(`^builder-project:${UUID_SOURCE}$`, 'u');
const TASK_ID_PATTERN = new RegExp(`^builder-task:${UUID_SOURCE}$`, 'u');
const RUN_ID_PATTERN = new RegExp(`^builder-run:${UUID_SOURCE}$`, 'u');
const STEP_ID_PATTERN = new RegExp(`^builder-run-step:${UUID_SOURCE}$`, 'u');
const ADMISSION_ID_PATTERN = /^builder-agent-supervised-action-admission:[0-9a-f]{64}$/u;
const BUDGET_AUDIT_ID_PATTERN = /^builder-agent-budget-audit:[0-9a-f]{64}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const RECORD_KEYS = Object.freeze(['step_start_receipt']);
const READ_STEP_KEYS = Object.freeze(['step_id', 'owner_id']);
const READ_ADMISSION_KEYS = Object.freeze(['supervised_action_admission_id', 'owner_id']);
const LIST_TASK_KEYS = Object.freeze(['owner_id', 'project_id', 'task_id']);
const LIST_RUN_KEYS = Object.freeze(['owner_id', 'project_id', 'task_id', 'run_id']);
const MAX_STEP_STARTS = 256;
const MAX_RECEIPT_JSON_BYTES = 64 * 1024;
const CREATE_SCHEMA_SQL = Object.freeze([
  `CREATE TABLE agent_step_starts (
    step_id TEXT NOT NULL PRIMARY KEY,
    step_start_receipt_digest TEXT NOT NULL UNIQUE,
    supervised_action_admission_id TEXT NOT NULL UNIQUE,
    budget_audit_id TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    step_index INTEGER NOT NULL,
    budget_step_count_before INTEGER NOT NULL,
    budget_max_steps INTEGER NOT NULL,
    budget_runtime_ms_before INTEGER NOT NULL,
    budget_max_runtime_ms INTEGER NOT NULL,
    budget_audit_observed_at_ms INTEGER NOT NULL,
    admitted_at_ms INTEGER NOT NULL,
    started_at_ms INTEGER NOT NULL,
    receipt_version TEXT NOT NULL,
    receipt_json TEXT NOT NULL,
    schema_version TEXT NOT NULL,
    CHECK (schema_version = 'builder-agent-step-start-store-schema.v1'),
    CHECK (receipt_version = 'builder-agent-step-start-receipt.v1'),
    CHECK (step_index BETWEEN 1 AND 256),
    CHECK (budget_step_count_before BETWEEN 0 AND 255),
    CHECK (budget_max_steps BETWEEN 1 AND 256),
    CHECK (step_index = budget_step_count_before + 1),
    CHECK (budget_step_count_before < budget_max_steps),
    CHECK (budget_runtime_ms_before BETWEEN 0 AND budget_max_runtime_ms - 1),
    CHECK (budget_max_runtime_ms BETWEEN 1000 AND 86400000),
    CHECK (budget_audit_observed_at_ms >= 0),
    CHECK (admitted_at_ms >= budget_audit_observed_at_ms),
    CHECK (started_at_ms >= admitted_at_ms),
    CHECK (length(receipt_json) BETWEEN 2 AND 65536)
  ) STRICT`,
  'CREATE INDEX agent_step_starts_task_idx ON agent_step_starts(owner_id, project_id, task_id, started_at_ms, step_id)',
  'CREATE INDEX agent_step_starts_run_idx ON agent_step_starts(owner_id, project_id, task_id, run_id, started_at_ms, step_id)',
  'CREATE INDEX agent_step_starts_admission_idx ON agent_step_starts(owner_id, supervised_action_admission_id)',
]);
const ERROR_MESSAGES = Object.freeze({
  builder_agent_step_start_store_invalid:
    'Builder agent step start storage request could not be verified.',
  builder_agent_step_start_store_conflict:
    'Builder agent step start changed before it could be recorded.',
  builder_agent_step_start_store_integrity_failed:
    'Builder agent step start storage integrity could not be verified.',
  builder_agent_step_start_store_resource_exceeded:
    'Builder agent step start storage limits were reached.',
  builder_agent_step_start_store_unavailable:
    'Builder agent step start storage is unavailable.',
});

class BuilderAgentStepStartStoreError extends Error {
  constructor(code = 'builder_agent_step_start_store_invalid') {
    const selected = Object.hasOwn(ERROR_MESSAGES, code)
      ? code
      : 'builder_agent_step_start_store_invalid';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderAgentStepStartStoreError';
    this.code = selected;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) {
  throw new BuilderAgentStepStartStoreError(code);
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
  if (!isPlainObject(value)) fail('builder_agent_step_start_store_invalid');
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== keys.length
    || actual.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) fail('builder_agent_step_start_store_invalid');
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      fail('builder_agent_step_start_store_invalid');
    }
  }
  return value;
}

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
    fail('builder_agent_step_start_store_invalid');
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
  fail('builder_agent_step_start_store_invalid');
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
    fail('builder_agent_step_start_store_invalid');
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

function safeStepId(value) {
  return safePattern(value, STEP_ID_PATTERN);
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
  ) fail('builder_agent_step_start_store_invalid');
  return value;
}

function assertParentDirectory(filePath) {
  let info;
  try {
    info = fs.lstatSync(path.dirname(filePath));
  } catch {
    fail('builder_agent_step_start_store_unavailable');
  }
  if (!info.isDirectory() || info.isSymbolicLink()) {
    fail('builder_agent_step_start_store_unavailable');
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
    fail('builder_agent_step_start_store_integrity_failed');
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
  if (mode !== 'wal') fail('builder_agent_step_start_store_unavailable');
  const pragmas = runtimePragmas(db);
  if (
    pragmas.foreign_keys !== 'on'
    || pragmas.trusted_schema !== 'off'
    || pragmas.synchronous !== 'full'
    || pragmas.journal_mode !== 'wal'
  ) fail('builder_agent_step_start_store_unavailable');
}

function createSchema(db) {
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const sql of CREATE_SCHEMA_SQL) db.exec(sql);
    db.exec(`PRAGMA user_version = ${BUILDER_AGENT_STEP_START_STORE_USER_VERSION}`);
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
    expectedDb.exec(`PRAGMA user_version = ${BUILDER_AGENT_STEP_START_STORE_USER_VERSION}`);
    expectedSchemaFingerprint = canonicalJson(collectSchemaFingerprint(expectedDb));
    return expectedSchemaFingerprint;
  } finally {
    expectedDb.close();
  }
}

function validateSchema(db) {
  const actual = collectSchemaFingerprint(db);
  if (actual.foreign_key_check.length !== 0) {
    fail('builder_agent_step_start_store_integrity_failed');
  }
  if (canonicalJson(actual) !== expectedFingerprint()) {
    fail('builder_agent_step_start_store_integrity_failed');
  }
}

function initialize(db) {
  configurePragmas(db);
  const version = userVersion(db);
  if (version === 0) createSchema(db);
  else if (version !== BUILDER_AGENT_STEP_START_STORE_USER_VERSION) {
    fail('builder_agent_step_start_store_integrity_failed');
  }
  validateSchema(db);
}

function canonicalReceipt(value) {
  const text = canonicalJson(value);
  if (text.length < 2 || text.length > MAX_RECEIPT_JSON_BYTES) {
    fail('builder_agent_step_start_store_resource_exceeded');
  }
  return text;
}

function parseCanonicalReceipt(value, code) {
  if (
    typeof value !== 'string'
    || value.length < 2
    || value.length > MAX_RECEIPT_JSON_BYTES
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
    return sanitizeBuilderAgentStepStartReceipt(parsed);
  } catch (error) {
    if (
      error instanceof BuilderAgentStepStartStoreError
      || error instanceof BuilderAgentStepStartContractError
    ) fail(code);
    throw error;
  }
}

function sanitizeRecordRequest(value) {
  exactObject(value, RECORD_KEYS);
  try {
    return sanitizeBuilderAgentStepStartReceipt(valueAt(value, 'step_start_receipt'));
  } catch (error) {
    if (error instanceof BuilderAgentStepStartContractError) {
      fail('builder_agent_step_start_store_invalid');
    }
    throw error;
  }
}

function stepStartColumns() {
  return `step_id, step_start_receipt_digest, supervised_action_admission_id,
    budget_audit_id, owner_id, project_id, task_id, run_id, step_index,
    budget_step_count_before, budget_max_steps, budget_runtime_ms_before,
    budget_max_runtime_ms, budget_audit_observed_at_ms, admitted_at_ms,
    started_at_ms, receipt_version, receipt_json`;
}

function safeRow(row) {
  if (row === null || row === undefined) return null;
  const receipt = parseCanonicalReceipt(
    row.receipt_json,
    'builder_agent_step_start_store_integrity_failed',
  );
  if (
    receipt.step_id !== safeStepId(row.step_id)
    || receipt.step_start_receipt_digest !== safePattern(row.step_start_receipt_digest, DIGEST_PATTERN)
    || receipt.supervised_action_admission_id !== safeAdmissionId(row.supervised_action_admission_id)
    || receipt.budget_audit_id !== safePattern(row.budget_audit_id, BUDGET_AUDIT_ID_PATTERN)
    || receipt.owner_id !== safeOwnerId(row.owner_id)
    || receipt.project_id !== safeProjectId(row.project_id)
    || receipt.task_id !== safeTaskId(row.task_id)
    || receipt.run_id !== safeRunId(row.run_id)
    || receipt.step_index !== row.step_index
    || receipt.budget_step_count_before !== row.budget_step_count_before
    || receipt.budget_max_steps !== row.budget_max_steps
    || receipt.budget_runtime_ms_before !== row.budget_runtime_ms_before
    || receipt.budget_max_runtime_ms !== row.budget_max_runtime_ms
    || receipt.budget_audit_observed_at_ms !== row.budget_audit_observed_at_ms
    || receipt.admitted_at_ms !== row.admitted_at_ms
    || receipt.started_at_ms !== row.started_at_ms
    || receipt.receipt_version !== row.receipt_version
    || receipt.receipt_version !== BUILDER_AGENT_STEP_START_RECEIPT_VERSION
    || canonicalReceipt(receipt) !== row.receipt_json
  ) fail('builder_agent_step_start_store_integrity_failed');
  return freezeDeep({ step_start_receipt: receipt });
}

function loadByStepId(db, stepId) {
  return safeRow(one(
    db,
    `SELECT ${stepStartColumns()} FROM agent_step_starts WHERE step_id = ?`,
    [stepId],
  ));
}

function loadByAdmissionId(db, admissionId) {
  return safeRow(one(
    db,
    `SELECT ${stepStartColumns()} FROM agent_step_starts
      WHERE supervised_action_admission_id = ?`,
    [admissionId],
  ));
}

function loadByDigest(db, digest) {
  return safeRow(one(
    db,
    `SELECT ${stepStartColumns()} FROM agent_step_starts
      WHERE step_start_receipt_digest = ?`,
    [digest],
  ));
}

function taskEntries(db, ownerId, projectId, taskId) {
  const rows = all(
    db,
    `SELECT ${stepStartColumns()}
      FROM agent_step_starts
      WHERE owner_id = ? AND project_id = ? AND task_id = ?
      ORDER BY started_at_ms ASC, step_index ASC, step_id ASC
      LIMIT ?`,
    [ownerId, projectId, taskId, MAX_STEP_STARTS + 1],
  );
  if (rows.length > MAX_STEP_STARTS) {
    fail('builder_agent_step_start_store_resource_exceeded');
  }
  return freezeDeep(rows.map(safeRow));
}

function runEntries(db, ownerId, projectId, taskId, runId) {
  const rows = all(
    db,
    `SELECT ${stepStartColumns()}
      FROM agent_step_starts
      WHERE owner_id = ? AND project_id = ? AND task_id = ? AND run_id = ?
      ORDER BY started_at_ms ASC, step_index ASC, step_id ASC
      LIMIT ?`,
    [ownerId, projectId, taskId, runId, MAX_STEP_STARTS + 1],
  );
  if (rows.length > MAX_STEP_STARTS) {
    fail('builder_agent_step_start_store_resource_exceeded');
  }
  return freezeDeep(rows.map(safeRow));
}

function sameReceipt(left, right) {
  return canonicalJson(left.step_start_receipt) === canonicalJson(right.step_start_receipt);
}

function evidence(db, transaction) {
  return freezeDeep({
    database_id: DATABASE_ID,
    schema_version: BUILDER_AGENT_STEP_START_STORE_SCHEMA_VERSION,
    user_version: BUILDER_AGENT_STEP_START_STORE_USER_VERSION,
    schema_fingerprint_digest: `sha256:${sha256Canonical(collectSchemaFingerprint(db))}`,
    runtime_pragmas: runtimePragmas(db),
    transaction,
    step_start_authority: 'main_owned_agent_step_start_store',
    step_start_receipt_authority: 'main_agent_step_start_receipt_contract_v1',
    renderer_authority: 'not_present',
    ipc_authority: 'not_present',
    provider_dispatch: false,
    model_dispatch: false,
    tool_dispatch: false,
    step_execution: false,
    permission_grant_authority: false,
    credential_storage: 'not_present',
    source_access: 'not_present',
    source_read: 'not_present',
    source_write: 'not_present',
    process_run: false,
    network_access: false,
    revision_authority: false,
    review_authority: false,
    artifact_authority: false,
    raw_context_storage: false,
    recovery_model: 'idempotent_store_replay',
  });
}

function writeResult(db, operation, payload) {
  return freezeDeep({
    result_version: BUILDER_AGENT_STEP_START_STORE_RESULT_VERSION,
    operation,
    ...payload,
    step_start_evidence: evidence(db, operation),
  });
}

function readResult(db, transaction, payload) {
  return freezeDeep({
    result_version: BUILDER_AGENT_STEP_START_STORE_READ_RESULT_VERSION,
    step_start_authority: 'main_owned_agent_step_start_store',
    ...payload,
    evidence: evidence(db, transaction),
  });
}

function insertStepStart(db, receipt) {
  run(db, `INSERT INTO agent_step_starts (
    step_id, step_start_receipt_digest, supervised_action_admission_id,
    budget_audit_id, owner_id, project_id, task_id, run_id, step_index,
    budget_step_count_before, budget_max_steps, budget_runtime_ms_before,
    budget_max_runtime_ms, budget_audit_observed_at_ms, admitted_at_ms,
    started_at_ms, receipt_version, receipt_json, schema_version
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
    receipt.step_id,
    receipt.step_start_receipt_digest,
    receipt.supervised_action_admission_id,
    receipt.budget_audit_id,
    receipt.owner_id,
    receipt.project_id,
    receipt.task_id,
    receipt.run_id,
    receipt.step_index,
    receipt.budget_step_count_before,
    receipt.budget_max_steps,
    receipt.budget_runtime_ms_before,
    receipt.budget_max_runtime_ms,
    receipt.budget_audit_observed_at_ms,
    receipt.admitted_at_ms,
    receipt.started_at_ms,
    receipt.receipt_version,
    canonicalReceipt(receipt),
    BUILDER_AGENT_STEP_START_STORE_SCHEMA_VERSION,
  ]);
}

function recordStepStart(db, rawRequest) {
  const receipt = sanitizeRecordRequest(rawRequest);
  db.exec('BEGIN IMMEDIATE');
  try {
    const existing = loadByStepId(db, receipt.step_id);
    const existingByAdmission = loadByAdmissionId(db, receipt.supervised_action_admission_id);
    const existingByDigest = loadByDigest(db, receipt.step_start_receipt_digest);
    if (existing || existingByAdmission || existingByDigest) {
      const candidate = existing ?? existingByAdmission ?? existingByDigest;
      if (!sameReceipt(candidate, { step_start_receipt: receipt })) {
        fail('builder_agent_step_start_store_conflict');
      }
      db.exec('COMMIT');
      return writeResult(db, 'agent_step_start_replayed', { agent_step_start: candidate });
    }
    insertStepStart(db, receipt);
    const readback = loadByStepId(db, receipt.step_id);
    if (!readback || !sameReceipt(readback, { step_start_receipt: receipt })) {
      fail('builder_agent_step_start_store_integrity_failed');
    }
    db.exec('COMMIT');
    return writeResult(db, 'agent_step_start_recorded', { agent_step_start: readback });
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* fixed failure below */ }
    throw error;
  }
}

function readStepStart(db, rawRequest) {
  exactObject(rawRequest, READ_STEP_KEYS);
  const stepId = safeStepId(valueAt(rawRequest, 'step_id'));
  const ownerId = safeOwnerId(valueAt(rawRequest, 'owner_id'));
  const entry = loadByStepId(db, stepId);
  if (!entry || entry.step_start_receipt.owner_id !== ownerId) {
    return readResult(db, 'agent_step_start_absent_read', {
      status: 'absent',
      agent_step_start: null,
    });
  }
  return readResult(db, 'agent_step_start_ready_read', {
    status: 'ready',
    agent_step_start: entry,
  });
}

function readStepStartForAdmission(db, rawRequest) {
  exactObject(rawRequest, READ_ADMISSION_KEYS);
  const admissionId = safeAdmissionId(valueAt(rawRequest, 'supervised_action_admission_id'));
  const ownerId = safeOwnerId(valueAt(rawRequest, 'owner_id'));
  const entry = loadByAdmissionId(db, admissionId);
  if (!entry || entry.step_start_receipt.owner_id !== ownerId) {
    return readResult(db, 'agent_step_start_admission_absent_read', {
      status: 'absent',
      agent_step_start: null,
    });
  }
  return readResult(db, 'agent_step_start_admission_ready_read', {
    status: 'ready',
    agent_step_start: entry,
  });
}

function listTaskStepStarts(db, rawRequest) {
  exactObject(rawRequest, LIST_TASK_KEYS);
  const ownerId = safeOwnerId(valueAt(rawRequest, 'owner_id'));
  const projectId = safeProjectId(valueAt(rawRequest, 'project_id'));
  const taskId = safeTaskId(valueAt(rawRequest, 'task_id'));
  const starts = taskEntries(db, ownerId, projectId, taskId);
  return readResult(db, starts.length === 0 ? 'agent_task_step_starts_absent_read' : 'agent_task_step_starts_ready_read', {
    status: starts.length === 0 ? 'absent' : 'ready',
    agent_step_starts: starts,
    truncated: starts.length >= MAX_STEP_STARTS,
  });
}

function listRunStepStarts(db, rawRequest) {
  exactObject(rawRequest, LIST_RUN_KEYS);
  const ownerId = safeOwnerId(valueAt(rawRequest, 'owner_id'));
  const projectId = safeProjectId(valueAt(rawRequest, 'project_id'));
  const taskId = safeTaskId(valueAt(rawRequest, 'task_id'));
  const runId = safeRunId(valueAt(rawRequest, 'run_id'));
  const starts = runEntries(db, ownerId, projectId, taskId, runId);
  return readResult(db, starts.length === 0 ? 'agent_run_step_starts_absent_read' : 'agent_run_step_starts_ready_read', {
    status: starts.length === 0 ? 'absent' : 'ready',
    agent_step_starts: starts,
    truncated: starts.length >= MAX_STEP_STARTS,
  });
}

function ownErrorField(error, key) {
  if (!error || typeof error !== 'object' || utilTypes.isProxy(error)) return null;
  const descriptor = Object.getOwnPropertyDescriptor(error, key);
  return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : null;
}

function normalizeOperationError(error) {
  if (error instanceof BuilderAgentStepStartStoreError) {
    return new BuilderAgentStepStartStoreError(error.code);
  }
  if (error instanceof BuilderAgentStepStartContractError) {
    return new BuilderAgentStepStartStoreError(
      'builder_agent_step_start_store_invalid',
    );
  }
  const sqliteCode = ownErrorField(error, 'code');
  const sqliteErrstr = ownErrorField(error, 'errstr');
  const sqliteErrcode = ownErrorField(error, 'errcode');
  if (sqliteCode && /^SQLITE_CONSTRAINT/u.test(sqliteCode)) {
    return new BuilderAgentStepStartStoreError(
      'builder_agent_step_start_store_integrity_failed',
    );
  }
  if (sqliteErrstr === 'constraint failed' || sqliteErrcode === 1555) {
    return new BuilderAgentStepStartStoreError(
      'builder_agent_step_start_store_integrity_failed',
    );
  }
  if (sqliteCode && /^SQLITE_(CORRUPT|NOTADB|SCHEMA|INTERNAL|MISMATCH)/u.test(sqliteCode)) {
    return new BuilderAgentStepStartStoreError(
      'builder_agent_step_start_store_integrity_failed',
    );
  }
  return new BuilderAgentStepStartStoreError(
    'builder_agent_step_start_store_unavailable',
  );
}

function createBuilderAgentStepStartStore(databasePath) {
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
    store_version: BUILDER_AGENT_STEP_START_STORE_VERSION,

    close(...rawArguments) {
      if (rawArguments.length !== 0) {
        throw new BuilderAgentStepStartStoreError('builder_agent_step_start_store_invalid');
      }
      try { db.close(); } catch (error) { throw normalizeOperationError(error); }
    },

    record_step_start(rawRequest) {
      try { return recordStepStart(db, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },

    read_step_start(rawRequest) {
      try { return readStepStart(db, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },

    read_step_start_for_admission(rawRequest) {
      try { return readStepStartForAdmission(db, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },

    list_task_step_starts(rawRequest) {
      try { return listTaskStepStarts(db, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },

    list_run_step_starts(rawRequest) {
      try { return listRunStepStarts(db, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },
  });
}

module.exports = Object.freeze({
  BUILDER_AGENT_STEP_START_STORE_READ_RESULT_VERSION,
  BUILDER_AGENT_STEP_START_STORE_RESULT_VERSION,
  BUILDER_AGENT_STEP_START_STORE_SCHEMA_VERSION,
  BUILDER_AGENT_STEP_START_STORE_USER_VERSION,
  BUILDER_AGENT_STEP_START_STORE_VERSION,
  BuilderAgentStepStartStoreError,
  createBuilderAgentStepStartStore,
});
