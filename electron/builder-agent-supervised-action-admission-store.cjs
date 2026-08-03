'use strict';

const nodeCrypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { types: utilTypes } = require('node:util');

const {
  BUILDER_AGENT_SUPERVISED_ACTION_ADMISSION_VERSION,
  BuilderAgentSupervisedActionAdmissionError,
  sanitizeBuilderAgentSupervisedActionAdmission,
} = require('./builder-agent-supervised-action-admission.cjs');

const BUILDER_AGENT_SUPERVISED_ACTION_ADMISSION_STORE_VERSION =
  'builder-agent-supervised-action-admission-store.v1';
const BUILDER_AGENT_SUPERVISED_ACTION_ADMISSION_STORE_RESULT_VERSION =
  'builder-agent-supervised-action-admission-store-result.v1';
const BUILDER_AGENT_SUPERVISED_ACTION_ADMISSION_STORE_READ_RESULT_VERSION =
  'builder-agent-supervised-action-admission-store-read-result.v1';
const BUILDER_AGENT_SUPERVISED_ACTION_ADMISSION_STORE_SCHEMA_VERSION =
  'builder-agent-supervised-action-admission-store-schema.v1';
const BUILDER_AGENT_SUPERVISED_ACTION_ADMISSION_STORE_USER_VERSION = 1;
const DATABASE_ID = 'builder-agent-supervised-action-admission-store.v1';
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const OWNER_ID_PATTERN = new RegExp(`^builder-user:${UUID_SOURCE}$`, 'u');
const PROJECT_ID_PATTERN = new RegExp(`^builder-project:${UUID_SOURCE}$`, 'u');
const TASK_ID_PATTERN = new RegExp(`^builder-task:${UUID_SOURCE}$`, 'u');
const RUN_ID_PATTERN = new RegExp(`^builder-run:${UUID_SOURCE}$`, 'u');
const SNAPSHOT_ID_PATTERN = /^builder-agent-task-context-snapshot:[0-9a-f]{64}$/u;
const ADMISSION_ID_PATTERN = /^builder-agent-supervised-action-admission:[0-9a-f]{64}$/u;
const ACTION_REQUEST_ID_PATTERN = new RegExp(
  `^builder-agent-action-request:${UUID_SOURCE}$`,
  'u',
);
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const RECORD_KEYS = Object.freeze(['admission']);
const READ_ADMISSION_KEYS = Object.freeze(['admission_id', 'owner_id']);
const READ_BY_SNAPSHOT_KEYS = Object.freeze(['snapshot_id', 'owner_id']);
const LIST_TASK_ADMISSIONS_KEYS = Object.freeze(['owner_id', 'project_id', 'task_id']);
const LIST_RUN_ADMISSIONS_KEYS = Object.freeze(['owner_id', 'project_id', 'task_id', 'run_id']);
const MAX_ADMISSIONS = 128;
const MAX_RECEIPT_JSON_BYTES = 64 * 1024;
const CREATE_SCHEMA_SQL = Object.freeze([
  `CREATE TABLE agent_supervised_action_admissions (
    admission_id TEXT NOT NULL PRIMARY KEY,
    action_request_id TEXT NOT NULL,
    snapshot_id TEXT NOT NULL,
    context_digest TEXT NOT NULL,
    definition_digest TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    requested_next_action TEXT NOT NULL,
    next_gate TEXT NOT NULL,
    budget_audit_observed_at_ms INTEGER NOT NULL,
    snapshot_created_at_ms INTEGER NOT NULL,
    admitted_at_ms INTEGER NOT NULL,
    admission_digest TEXT NOT NULL,
    admission_version TEXT NOT NULL,
    admission_json TEXT NOT NULL,
    schema_version TEXT NOT NULL,
    UNIQUE (snapshot_id),
    UNIQUE (action_request_id),
    CHECK (schema_version = 'builder-agent-supervised-action-admission-store-schema.v1'),
    CHECK (admission_version = 'builder-agent-supervised-action-admission.v1'),
    CHECK (requested_next_action IN (
      'start_step',
      'call_tool',
      'read_private_source',
      'finish_for_review'
    )),
    CHECK (next_gate IN (
      'agent_step_runner_required_later',
      'tool_call_record_required_later',
      'source_context_collector_required_later',
      'project_work_result_required_later'
    )),
    CHECK (
      (requested_next_action = 'start_step' AND next_gate = 'agent_step_runner_required_later')
      OR (requested_next_action = 'call_tool' AND next_gate = 'tool_call_record_required_later')
      OR (requested_next_action = 'read_private_source' AND next_gate = 'source_context_collector_required_later')
      OR (requested_next_action = 'finish_for_review' AND next_gate = 'project_work_result_required_later')
    ),
    CHECK (budget_audit_observed_at_ms >= 0),
    CHECK (snapshot_created_at_ms >= budget_audit_observed_at_ms),
    CHECK (admitted_at_ms >= snapshot_created_at_ms),
    CHECK (length(admission_json) BETWEEN 2 AND 65536)
  ) STRICT`,
  'CREATE INDEX agent_supervised_action_admissions_task_idx ON agent_supervised_action_admissions(owner_id, project_id, task_id, admitted_at_ms, admission_id)',
  'CREATE INDEX agent_supervised_action_admissions_run_idx ON agent_supervised_action_admissions(owner_id, project_id, task_id, run_id, admitted_at_ms, admission_id)',
  'CREATE INDEX agent_supervised_action_admissions_snapshot_idx ON agent_supervised_action_admissions(owner_id, snapshot_id)',
]);
const ERROR_MESSAGES = Object.freeze({
  builder_agent_supervised_action_admission_store_invalid:
    'Builder agent supervised action admission storage request could not be verified.',
  builder_agent_supervised_action_admission_store_conflict:
    'Builder agent supervised action admission changed before it could be recorded.',
  builder_agent_supervised_action_admission_store_integrity_failed:
    'Builder agent supervised action admission storage integrity could not be verified.',
  builder_agent_supervised_action_admission_store_resource_exceeded:
    'Builder agent supervised action admission storage limits were reached.',
  builder_agent_supervised_action_admission_store_unavailable:
    'Builder agent supervised action admission storage is unavailable.',
});

class BuilderAgentSupervisedActionAdmissionStoreError extends Error {
  constructor(code = 'builder_agent_supervised_action_admission_store_invalid') {
    const selected = Object.hasOwn(ERROR_MESSAGES, code)
      ? code
      : 'builder_agent_supervised_action_admission_store_invalid';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderAgentSupervisedActionAdmissionStoreError';
    this.code = selected;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) {
  throw new BuilderAgentSupervisedActionAdmissionStoreError(code);
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
  if (!isPlainObject(value)) fail('builder_agent_supervised_action_admission_store_invalid');
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== keys.length
    || actual.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) fail('builder_agent_supervised_action_admission_store_invalid');
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      fail('builder_agent_supervised_action_admission_store_invalid');
    }
  }
  return value;
}

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
    fail('builder_agent_supervised_action_admission_store_invalid');
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
  fail('builder_agent_supervised_action_admission_store_invalid');
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
    fail('builder_agent_supervised_action_admission_store_invalid');
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

function safeSnapshotId(value) {
  return safePattern(value, SNAPSHOT_ID_PATTERN);
}

function safeAdmissionId(value) {
  return safePattern(value, ADMISSION_ID_PATTERN);
}

function safeActionRequestId(value) {
  return safePattern(value, ACTION_REQUEST_ID_PATTERN);
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail('builder_agent_supervised_action_admission_store_invalid');
  }
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
  ) fail('builder_agent_supervised_action_admission_store_invalid');
  return value;
}

function assertParentDirectory(filePath) {
  let info;
  try {
    info = fs.lstatSync(path.dirname(filePath));
  } catch {
    fail('builder_agent_supervised_action_admission_store_unavailable');
  }
  if (!info.isDirectory() || info.isSymbolicLink()) {
    fail('builder_agent_supervised_action_admission_store_unavailable');
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
    fail('builder_agent_supervised_action_admission_store_integrity_failed');
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
  if (mode !== 'wal') fail('builder_agent_supervised_action_admission_store_unavailable');
  const pragmas = runtimePragmas(db);
  if (
    pragmas.foreign_keys !== 'on'
    || pragmas.trusted_schema !== 'off'
    || pragmas.synchronous !== 'full'
    || pragmas.journal_mode !== 'wal'
  ) fail('builder_agent_supervised_action_admission_store_unavailable');
}

function createSchema(db) {
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const sql of CREATE_SCHEMA_SQL) db.exec(sql);
    db.exec(`PRAGMA user_version = ${BUILDER_AGENT_SUPERVISED_ACTION_ADMISSION_STORE_USER_VERSION}`);
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
    expectedDb.exec(`PRAGMA user_version = ${BUILDER_AGENT_SUPERVISED_ACTION_ADMISSION_STORE_USER_VERSION}`);
    expectedSchemaFingerprint = canonicalJson(collectSchemaFingerprint(expectedDb));
    return expectedSchemaFingerprint;
  } finally {
    expectedDb.close();
  }
}

function validateSchema(db) {
  const actual = collectSchemaFingerprint(db);
  if (actual.foreign_key_check.length !== 0) {
    fail('builder_agent_supervised_action_admission_store_integrity_failed');
  }
  if (canonicalJson(actual) !== expectedFingerprint()) {
    fail('builder_agent_supervised_action_admission_store_integrity_failed');
  }
}

function initialize(db) {
  configurePragmas(db);
  const version = userVersion(db);
  if (version === 0) createSchema(db);
  else if (version !== BUILDER_AGENT_SUPERVISED_ACTION_ADMISSION_STORE_USER_VERSION) {
    fail('builder_agent_supervised_action_admission_store_integrity_failed');
  }
  validateSchema(db);
}

function canonicalReceipt(value) {
  const text = canonicalJson(value);
  if (text.length < 2 || text.length > MAX_RECEIPT_JSON_BYTES) {
    fail('builder_agent_supervised_action_admission_store_resource_exceeded');
  }
  return text;
}

function parseCanonicalAdmission(value, code) {
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
    return sanitizeBuilderAgentSupervisedActionAdmission(parsed);
  } catch (error) {
    if (
      error instanceof BuilderAgentSupervisedActionAdmissionStoreError
      || error instanceof BuilderAgentSupervisedActionAdmissionError
    ) fail(code);
    throw error;
  }
}

function sanitizeRecordRequest(value) {
  exactObject(value, RECORD_KEYS);
  try {
    return sanitizeBuilderAgentSupervisedActionAdmission(valueAt(value, 'admission'));
  } catch (error) {
    if (error instanceof BuilderAgentSupervisedActionAdmissionError) {
      fail('builder_agent_supervised_action_admission_store_invalid');
    }
    throw error;
  }
}

function admissionColumns() {
  return `admission_id, action_request_id, snapshot_id, context_digest,
    definition_digest, owner_id, project_id, task_id, run_id,
    requested_next_action, next_gate, budget_audit_observed_at_ms,
    snapshot_created_at_ms, admitted_at_ms, admission_digest,
    admission_version, admission_json`;
}

function safeRow(row) {
  if (row === null || row === undefined) return null;
  const admission = parseCanonicalAdmission(
    row.admission_json,
    'builder_agent_supervised_action_admission_store_integrity_failed',
  );
  if (
    admission.admission_id !== safeAdmissionId(row.admission_id)
    || admission.action_request_id !== safeActionRequestId(row.action_request_id)
    || admission.snapshot_id !== safeSnapshotId(row.snapshot_id)
    || admission.context_digest !== safePattern(row.context_digest, DIGEST_PATTERN)
    || admission.definition_digest !== safePattern(row.definition_digest, DIGEST_PATTERN)
    || admission.owner_id !== safeOwnerId(row.owner_id)
    || admission.project_id !== safeProjectId(row.project_id)
    || admission.task_id !== safeTaskId(row.task_id)
    || admission.run_id !== safeRunId(row.run_id)
    || admission.requested_next_action !== row.requested_next_action
    || admission.next_gate !== row.next_gate
    || admission.budget_audit_observed_at_ms !== safeTimestamp(row.budget_audit_observed_at_ms)
    || admission.snapshot_created_at_ms !== safeTimestamp(row.snapshot_created_at_ms)
    || admission.admitted_at_ms !== safeTimestamp(row.admitted_at_ms)
    || admission.admission_digest !== safePattern(row.admission_digest, DIGEST_PATTERN)
    || admission.admission_version !== row.admission_version
    || admission.admission_version !== BUILDER_AGENT_SUPERVISED_ACTION_ADMISSION_VERSION
    || canonicalReceipt(admission) !== row.admission_json
  ) fail('builder_agent_supervised_action_admission_store_integrity_failed');
  return freezeDeep({ admission });
}

function loadByAdmissionId(db, admissionId) {
  return safeRow(one(
    db,
    `SELECT ${admissionColumns()} FROM agent_supervised_action_admissions WHERE admission_id = ?`,
    [admissionId],
  ));
}

function loadBySnapshotId(db, snapshotId) {
  return safeRow(one(
    db,
    `SELECT ${admissionColumns()} FROM agent_supervised_action_admissions WHERE snapshot_id = ?`,
    [snapshotId],
  ));
}

function loadByActionRequestId(db, actionRequestId) {
  return safeRow(one(
    db,
    `SELECT ${admissionColumns()} FROM agent_supervised_action_admissions WHERE action_request_id = ?`,
    [actionRequestId],
  ));
}

function taskEntries(db, ownerId, projectId, taskId) {
  const rows = all(
    db,
    `SELECT ${admissionColumns()}
      FROM agent_supervised_action_admissions
      WHERE owner_id = ? AND project_id = ? AND task_id = ?
      ORDER BY admitted_at_ms ASC, admission_id ASC
      LIMIT ?`,
    [ownerId, projectId, taskId, MAX_ADMISSIONS + 1],
  );
  if (rows.length > MAX_ADMISSIONS) {
    fail('builder_agent_supervised_action_admission_store_resource_exceeded');
  }
  return freezeDeep(rows.map(safeRow));
}

function runEntries(db, ownerId, projectId, taskId, runId) {
  const rows = all(
    db,
    `SELECT ${admissionColumns()}
      FROM agent_supervised_action_admissions
      WHERE owner_id = ? AND project_id = ? AND task_id = ? AND run_id = ?
      ORDER BY admitted_at_ms ASC, admission_id ASC
      LIMIT ?`,
    [ownerId, projectId, taskId, runId, MAX_ADMISSIONS + 1],
  );
  if (rows.length > MAX_ADMISSIONS) {
    fail('builder_agent_supervised_action_admission_store_resource_exceeded');
  }
  return freezeDeep(rows.map(safeRow));
}

function sameAdmission(left, right) {
  return canonicalJson(left.admission) === canonicalJson(right.admission);
}

function evidence(db, transaction) {
  return freezeDeep({
    database_id: DATABASE_ID,
    schema_version: BUILDER_AGENT_SUPERVISED_ACTION_ADMISSION_STORE_SCHEMA_VERSION,
    user_version: BUILDER_AGENT_SUPERVISED_ACTION_ADMISSION_STORE_USER_VERSION,
    schema_fingerprint_digest: `sha256:${sha256Canonical(collectSchemaFingerprint(db))}`,
    runtime_pragmas: runtimePragmas(db),
    transaction,
    admission_authority: 'main_owned_agent_supervised_action_admission_store',
    admission_contract_authority: 'main_agent_supervised_action_admission_contract_v1',
    renderer_authority: 'not_present',
    ipc_authority: 'not_present',
    provider_dispatch: false,
    model_dispatch: false,
    tool_dispatch: false,
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
    next_action_dispatch: false,
    recovery_model: 'idempotent_store_replay',
  });
}

function recordResult(db, operation, payload) {
  return freezeDeep({
    result_version: BUILDER_AGENT_SUPERVISED_ACTION_ADMISSION_STORE_RESULT_VERSION,
    operation,
    ...payload,
    admission_evidence: evidence(db, operation),
  });
}

function readResult(db, transaction, payload) {
  return freezeDeep({
    result_version: BUILDER_AGENT_SUPERVISED_ACTION_ADMISSION_STORE_READ_RESULT_VERSION,
    admission_authority: 'main_owned_agent_supervised_action_admission_store',
    ...payload,
    evidence: evidence(db, transaction),
  });
}

function insertAdmission(db, admission) {
  run(db, `INSERT INTO agent_supervised_action_admissions (
    admission_id, action_request_id, snapshot_id, context_digest,
    definition_digest, owner_id, project_id, task_id, run_id,
    requested_next_action, next_gate, budget_audit_observed_at_ms,
    snapshot_created_at_ms, admitted_at_ms, admission_digest,
    admission_version, admission_json, schema_version
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
    admission.admission_id,
    admission.action_request_id,
    admission.snapshot_id,
    admission.context_digest,
    admission.definition_digest,
    admission.owner_id,
    admission.project_id,
    admission.task_id,
    admission.run_id,
    admission.requested_next_action,
    admission.next_gate,
    admission.budget_audit_observed_at_ms,
    admission.snapshot_created_at_ms,
    admission.admitted_at_ms,
    admission.admission_digest,
    admission.admission_version,
    canonicalReceipt(admission),
    BUILDER_AGENT_SUPERVISED_ACTION_ADMISSION_STORE_SCHEMA_VERSION,
  ]);
}

function recordAdmission(db, rawRequest) {
  const admission = sanitizeRecordRequest(rawRequest);
  db.exec('BEGIN IMMEDIATE');
  try {
    const existing = loadByAdmissionId(db, admission.admission_id);
    const existingBySnapshot = loadBySnapshotId(db, admission.snapshot_id);
    const existingByActionRequest = loadByActionRequestId(db, admission.action_request_id);
    if (existing || existingBySnapshot || existingByActionRequest) {
      const candidate = existing ?? existingBySnapshot ?? existingByActionRequest;
      if (!sameAdmission(candidate, { admission })) {
        fail('builder_agent_supervised_action_admission_store_conflict');
      }
      db.exec('COMMIT');
      return recordResult(db, 'supervised_action_admission_replayed', {
        supervised_action_admission: candidate,
      });
    }
    insertAdmission(db, admission);
    const readback = loadByAdmissionId(db, admission.admission_id);
    if (!readback || !sameAdmission(readback, { admission })) {
      fail('builder_agent_supervised_action_admission_store_integrity_failed');
    }
    db.exec('COMMIT');
    return recordResult(db, 'supervised_action_admission_recorded', {
      supervised_action_admission: readback,
    });
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* fixed failure below */ }
    throw error;
  }
}

function readAdmission(db, rawRequest) {
  exactObject(rawRequest, READ_ADMISSION_KEYS);
  const admissionId = safeAdmissionId(valueAt(rawRequest, 'admission_id'));
  const ownerId = safeOwnerId(valueAt(rawRequest, 'owner_id'));
  const entry = loadByAdmissionId(db, admissionId);
  if (!entry || entry.admission.owner_id !== ownerId) {
    return readResult(db, 'supervised_action_admission_read', {
      status: 'absent',
      supervised_action_admission: null,
    });
  }
  return readResult(db, 'supervised_action_admission_read', {
    status: 'ready',
    supervised_action_admission: entry,
  });
}

function readAdmissionForSnapshot(db, rawRequest) {
  exactObject(rawRequest, READ_BY_SNAPSHOT_KEYS);
  const snapshotId = safeSnapshotId(valueAt(rawRequest, 'snapshot_id'));
  const ownerId = safeOwnerId(valueAt(rawRequest, 'owner_id'));
  const entry = loadBySnapshotId(db, snapshotId);
  if (!entry || entry.admission.owner_id !== ownerId) {
    return readResult(db, 'supervised_action_admission_snapshot_read', {
      status: 'absent',
      supervised_action_admission: null,
    });
  }
  return readResult(db, 'supervised_action_admission_snapshot_read', {
    status: 'ready',
    supervised_action_admission: entry,
  });
}

function listTaskAdmissions(db, rawRequest) {
  exactObject(rawRequest, LIST_TASK_ADMISSIONS_KEYS);
  const ownerId = safeOwnerId(valueAt(rawRequest, 'owner_id'));
  const projectId = safeProjectId(valueAt(rawRequest, 'project_id'));
  const taskId = safeTaskId(valueAt(rawRequest, 'task_id'));
  const admissions = taskEntries(db, ownerId, projectId, taskId);
  return readResult(db, 'supervised_action_admission_task_list', {
    status: admissions.length === 0 ? 'absent' : 'ready',
    supervised_action_admissions: admissions,
    truncated: admissions.length >= MAX_ADMISSIONS,
  });
}

function listRunAdmissions(db, rawRequest) {
  exactObject(rawRequest, LIST_RUN_ADMISSIONS_KEYS);
  const ownerId = safeOwnerId(valueAt(rawRequest, 'owner_id'));
  const projectId = safeProjectId(valueAt(rawRequest, 'project_id'));
  const taskId = safeTaskId(valueAt(rawRequest, 'task_id'));
  const runId = safeRunId(valueAt(rawRequest, 'run_id'));
  const admissions = runEntries(db, ownerId, projectId, taskId, runId);
  return readResult(db, 'supervised_action_admission_run_list', {
    status: admissions.length === 0 ? 'absent' : 'ready',
    supervised_action_admissions: admissions,
    truncated: admissions.length >= MAX_ADMISSIONS,
  });
}

function ownErrorField(error, key) {
  if (!error || typeof error !== 'object' || utilTypes.isProxy(error)) return null;
  const descriptor = Object.getOwnPropertyDescriptor(error, key);
  return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : null;
}

function normalizeOperationError(error) {
  if (error instanceof BuilderAgentSupervisedActionAdmissionStoreError) {
    return new BuilderAgentSupervisedActionAdmissionStoreError(error.code);
  }
  if (error instanceof BuilderAgentSupervisedActionAdmissionError) {
    return new BuilderAgentSupervisedActionAdmissionStoreError(
      'builder_agent_supervised_action_admission_store_invalid',
    );
  }
  const sqliteCode = ownErrorField(error, 'code');
  const sqliteErrstr = ownErrorField(error, 'errstr');
  const sqliteErrcode = ownErrorField(error, 'errcode');
  if (sqliteCode && /^SQLITE_CONSTRAINT/u.test(sqliteCode)) {
    return new BuilderAgentSupervisedActionAdmissionStoreError(
      'builder_agent_supervised_action_admission_store_integrity_failed',
    );
  }
  if (sqliteErrstr === 'constraint failed' || sqliteErrcode === 1555) {
    return new BuilderAgentSupervisedActionAdmissionStoreError(
      'builder_agent_supervised_action_admission_store_integrity_failed',
    );
  }
  if (sqliteCode && /^SQLITE_(CORRUPT|NOTADB|SCHEMA|INTERNAL|MISMATCH)/u.test(sqliteCode)) {
    return new BuilderAgentSupervisedActionAdmissionStoreError(
      'builder_agent_supervised_action_admission_store_integrity_failed',
    );
  }
  return new BuilderAgentSupervisedActionAdmissionStoreError(
    'builder_agent_supervised_action_admission_store_unavailable',
  );
}

function createBuilderAgentSupervisedActionAdmissionStore(databasePath) {
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
    store_version: BUILDER_AGENT_SUPERVISED_ACTION_ADMISSION_STORE_VERSION,

    close(...rawArguments) {
      if (rawArguments.length !== 0) {
        throw new BuilderAgentSupervisedActionAdmissionStoreError(
          'builder_agent_supervised_action_admission_store_invalid',
        );
      }
      try { db.close(); } catch (error) { throw normalizeOperationError(error); }
    },

    record_admission(rawRequest) {
      try { return recordAdmission(db, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },

    read_admission(rawRequest) {
      try { return readAdmission(db, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },

    read_admission_for_snapshot(rawRequest) {
      try { return readAdmissionForSnapshot(db, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },

    list_task_admissions(rawRequest) {
      try { return listTaskAdmissions(db, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },

    list_run_admissions(rawRequest) {
      try { return listRunAdmissions(db, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },
  });
}

module.exports = Object.freeze({
  BUILDER_AGENT_SUPERVISED_ACTION_ADMISSION_STORE_READ_RESULT_VERSION,
  BUILDER_AGENT_SUPERVISED_ACTION_ADMISSION_STORE_RESULT_VERSION,
  BUILDER_AGENT_SUPERVISED_ACTION_ADMISSION_STORE_SCHEMA_VERSION,
  BUILDER_AGENT_SUPERVISED_ACTION_ADMISSION_STORE_USER_VERSION,
  BUILDER_AGENT_SUPERVISED_ACTION_ADMISSION_STORE_VERSION,
  BuilderAgentSupervisedActionAdmissionStoreError,
  createBuilderAgentSupervisedActionAdmissionStore,
});
