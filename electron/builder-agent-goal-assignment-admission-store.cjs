'use strict';

const nodeCrypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { types: utilTypes } = require('node:util');

const {
  BUILDER_AGENT_GOAL_ASSIGNMENT_ADMISSION_RECORD_VERSION,
  BuilderAgentGoalAssignmentAdmissionError,
  sanitizeBuilderAgentGoalAssignmentAdmissionRecord,
} = require('./builder-agent-goal-assignment-admission.cjs');

const BUILDER_AGENT_GOAL_ASSIGNMENT_ADMISSION_STORE_VERSION =
  'builder-agent-goal-assignment-admission-store.v1';
const BUILDER_AGENT_GOAL_ASSIGNMENT_ADMISSION_STORE_RESULT_VERSION =
  'builder-agent-goal-assignment-admission-store-result.v1';
const BUILDER_AGENT_GOAL_ASSIGNMENT_ADMISSION_STORE_READ_RESULT_VERSION =
  'builder-agent-goal-assignment-admission-store-read-result.v1';
const BUILDER_AGENT_GOAL_ASSIGNMENT_ADMISSION_STORE_SCHEMA_VERSION =
  'builder-agent-goal-assignment-admission-store-schema.v1';
const BUILDER_AGENT_GOAL_ASSIGNMENT_ADMISSION_STORE_USER_VERSION = 1;
const DATABASE_ID = 'builder-agent-goal-assignment-admission-store.v1';
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const OWNER_ID_PATTERN = new RegExp(`^builder-user:${UUID_SOURCE}$`, 'u');
const AGENT_ID_PATTERN = new RegExp(`^builder-agent:${UUID_SOURCE}$`, 'u');
const AGENT_VERSION_ID_PATTERN = /^builder-agent-version:[0-9a-f]{64}$/u;
const PROJECT_ID_PATTERN = new RegExp(`^builder-project:${UUID_SOURCE}$`, 'u');
const CONVERSATION_ID_PATTERN = new RegExp(`^builder-conversation:${UUID_SOURCE}$`, 'u');
const TASK_ID_PATTERN = new RegExp(`^builder-task:${UUID_SOURCE}$`, 'u');
const RUN_ID_PATTERN = new RegExp(`^builder-run:${UUID_SOURCE}$`, 'u');
const GOAL_ID_PATTERN = /^builder-agent-goal:[0-9a-f]{64}$/u;
const GOAL_STATUS_ID_PATTERN = /^builder-agent-goal-status:[0-9a-f]{64}$/u;
const ASSIGNMENT_ID_PATTERN = /^builder-agent-assignment:[0-9a-f]{64}$/u;
const ADMISSION_ID_PATTERN = /^builder-agent-goal-assignment-admission:[0-9a-f]{64}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const RECORD_ADMISSION_KEYS = Object.freeze(['goal', 'goal_status', 'assignment', 'admission']);
const READ_ADMISSION_KEYS = Object.freeze(['admission_id', 'owner_id']);
const READ_BY_ASSIGNMENT_KEYS = Object.freeze(['assignment_id', 'owner_id']);
const LIST_TASK_ADMISSIONS_KEYS = Object.freeze(['owner_id', 'project_id', 'task_id']);
const MAX_TASK_ADMISSIONS = 128;
const MAX_RECEIPT_JSON_BYTES = 64 * 1024;
const CREATE_SCHEMA_SQL = Object.freeze([
  `CREATE TABLE agent_goal_assignment_admissions (
    admission_id TEXT NOT NULL PRIMARY KEY,
    goal_id TEXT NOT NULL,
    goal_status_id TEXT NOT NULL,
    assignment_id TEXT NOT NULL,
    definition_digest TEXT NOT NULL,
    record_version TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    agent_version_id TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    admitted_by TEXT NOT NULL,
    admitted_at_ms INTEGER NOT NULL,
    admission_contract TEXT NOT NULL,
    materialization_boundary TEXT NOT NULL,
    goal_json TEXT NOT NULL,
    goal_status_json TEXT NOT NULL,
    assignment_json TEXT NOT NULL,
    admission_json TEXT NOT NULL,
    schema_version TEXT NOT NULL,
    UNIQUE (assignment_id),
    CHECK (schema_version = 'builder-agent-goal-assignment-admission-store-schema.v1'),
    CHECK (record_version = 'builder-agent-goal-assignment-admission-record.v1'),
    CHECK (admitted_at_ms >= 0),
    CHECK (admitted_by = owner_id),
    CHECK (admission_contract = 'active_goal_to_owner_supervised_assignment'),
    CHECK (materialization_boundary = 'assignment_record_required_before_execution'),
    CHECK (length(goal_json) BETWEEN 2 AND 65536),
    CHECK (length(goal_status_json) BETWEEN 2 AND 65536),
    CHECK (length(assignment_json) BETWEEN 2 AND 65536),
    CHECK (length(admission_json) BETWEEN 2 AND 65536)
  ) STRICT`,
  'CREATE INDEX agent_goal_assignment_admissions_goal_idx ON agent_goal_assignment_admissions(owner_id, goal_id, admitted_at_ms, admission_id)',
  'CREATE INDEX agent_goal_assignment_admissions_task_idx ON agent_goal_assignment_admissions(owner_id, project_id, task_id, admitted_at_ms, admission_id)',
  'CREATE INDEX agent_goal_assignment_admissions_assignment_idx ON agent_goal_assignment_admissions(owner_id, assignment_id)',
]);
const ERROR_MESSAGES = Object.freeze({
  builder_agent_goal_assignment_admission_store_invalid:
    'Builder agent goal assignment admission could not be verified.',
  builder_agent_goal_assignment_admission_store_not_found:
    'Builder agent goal assignment admission is unavailable.',
  builder_agent_goal_assignment_admission_store_conflict:
    'Builder agent goal assignment admission changed before it could be recorded.',
  builder_agent_goal_assignment_admission_store_integrity_failed:
    'Builder agent goal assignment admission integrity could not be verified.',
  builder_agent_goal_assignment_admission_store_resource_exceeded:
    'Builder agent goal assignment admission limits were reached.',
  builder_agent_goal_assignment_admission_store_unavailable:
    'Builder agent goal assignment admission storage is unavailable.',
});

class BuilderAgentGoalAssignmentAdmissionStoreError extends Error {
  constructor(code = 'builder_agent_goal_assignment_admission_store_invalid') {
    const selected = Object.hasOwn(ERROR_MESSAGES, code)
      ? code
      : 'builder_agent_goal_assignment_admission_store_invalid';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderAgentGoalAssignmentAdmissionStoreError';
    this.code = selected;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) {
  throw new BuilderAgentGoalAssignmentAdmissionStoreError(code);
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
  if (!isPlainObject(value)) fail('builder_agent_goal_assignment_admission_store_invalid');
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== keys.length
    || actual.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) fail('builder_agent_goal_assignment_admission_store_invalid');
  for (const key of actual) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      fail('builder_agent_goal_assignment_admission_store_invalid');
    }
  }
}

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
    fail('builder_agent_goal_assignment_admission_store_invalid');
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
  fail('builder_agent_goal_assignment_admission_store_invalid');
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
    fail('builder_agent_goal_assignment_admission_store_invalid');
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

function safeAdmissionId(value) {
  return safePattern(value, ADMISSION_ID_PATTERN);
}

function safeAssignmentId(value) {
  return safePattern(value, ASSIGNMENT_ID_PATTERN);
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail('builder_agent_goal_assignment_admission_store_invalid');
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
  ) fail('builder_agent_goal_assignment_admission_store_invalid');
  return value;
}

function assertParentDirectory(filePath) {
  let info;
  try {
    info = fs.lstatSync(path.dirname(filePath));
  } catch {
    fail('builder_agent_goal_assignment_admission_store_unavailable');
  }
  if (!info.isDirectory() || info.isSymbolicLink()) {
    fail('builder_agent_goal_assignment_admission_store_unavailable');
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
    fail('builder_agent_goal_assignment_admission_store_integrity_failed');
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
  if (mode !== 'wal') fail('builder_agent_goal_assignment_admission_store_unavailable');
  const pragmas = runtimePragmas(db);
  if (
    pragmas.foreign_keys !== 'on'
    || pragmas.trusted_schema !== 'off'
    || pragmas.synchronous !== 'full'
    || pragmas.journal_mode !== 'wal'
  ) fail('builder_agent_goal_assignment_admission_store_unavailable');
}

function createSchema(db) {
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const sql of CREATE_SCHEMA_SQL) db.exec(sql);
    db.exec(`PRAGMA user_version = ${BUILDER_AGENT_GOAL_ASSIGNMENT_ADMISSION_STORE_USER_VERSION}`);
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
    expectedDb.exec(`PRAGMA user_version = ${BUILDER_AGENT_GOAL_ASSIGNMENT_ADMISSION_STORE_USER_VERSION}`);
    expectedSchemaFingerprint = canonicalJson(collectSchemaFingerprint(expectedDb));
    return expectedSchemaFingerprint;
  } finally {
    expectedDb.close();
  }
}

function validateSchema(db) {
  const actual = collectSchemaFingerprint(db);
  if (actual.foreign_key_check.length !== 0) {
    fail('builder_agent_goal_assignment_admission_store_integrity_failed');
  }
  if (canonicalJson(actual) !== expectedFingerprint()) {
    fail('builder_agent_goal_assignment_admission_store_integrity_failed');
  }
}

function initialize(db) {
  configurePragmas(db);
  const version = userVersion(db);
  if (version === 0) createSchema(db);
  else if (version !== BUILDER_AGENT_GOAL_ASSIGNMENT_ADMISSION_STORE_USER_VERSION) {
    fail('builder_agent_goal_assignment_admission_store_integrity_failed');
  }
  validateSchema(db);
}

function canonicalReceipt(value) {
  const text = canonicalJson(value);
  if (text.length > MAX_RECEIPT_JSON_BYTES) {
    fail('builder_agent_goal_assignment_admission_store_resource_exceeded');
  }
  return text;
}

function parseReceipt(text) {
  if (
    typeof text !== 'string'
    || text.length < 2
    || text.length > MAX_RECEIPT_JSON_BYTES
    || hasControlCharacter(text)
  ) fail('builder_agent_goal_assignment_admission_store_integrity_failed');
  try {
    const value = JSON.parse(text);
    return isPlainObject(value) ? value : fail('builder_agent_goal_assignment_admission_store_integrity_failed');
  } catch {
    fail('builder_agent_goal_assignment_admission_store_integrity_failed');
  }
}

function sanitizeAdmissionBundle(value) {
  exactObject(value, RECORD_ADMISSION_KEYS);
  try {
    const goal = valueAt(value, 'goal');
    const goalStatus = valueAt(value, 'goal_status');
    const assignment = valueAt(value, 'assignment');
    const admission = sanitizeBuilderAgentGoalAssignmentAdmissionRecord(
      valueAt(value, 'admission'),
      goal,
      goalStatus,
      assignment,
    );
    return freezeDeep({
      goal,
      goal_status: goalStatus,
      assignment,
      admission,
    });
  } catch (error) {
    if (error instanceof BuilderAgentGoalAssignmentAdmissionError) {
      fail('builder_agent_goal_assignment_admission_store_invalid');
    }
    throw error;
  }
}

function sameFact(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function safeRow(row) {
  if (row === null || row === undefined) return null;
  try {
    const goal = parseReceipt(row.goal_json);
    const goalStatus = parseReceipt(row.goal_status_json);
    const assignment = parseReceipt(row.assignment_json);
    const admission = sanitizeBuilderAgentGoalAssignmentAdmissionRecord(
      parseReceipt(row.admission_json),
      goal,
      goalStatus,
      assignment,
    );
    if (
      admission.admission_id !== safeAdmissionId(row.admission_id)
      || admission.goal_id !== safePattern(row.goal_id, GOAL_ID_PATTERN)
      || admission.goal_status_id !== safePattern(row.goal_status_id, GOAL_STATUS_ID_PATTERN)
      || admission.assignment_id !== safeAssignmentId(row.assignment_id)
      || admission.definition_digest !== safePattern(row.definition_digest, DIGEST_PATTERN)
      || admission.record_version !== row.record_version
      || admission.agent_id !== safePattern(row.agent_id, AGENT_ID_PATTERN)
      || admission.agent_version_id !== safePattern(row.agent_version_id, AGENT_VERSION_ID_PATTERN)
      || admission.owner_id !== safeOwnerId(row.owner_id)
      || admission.project_id !== safeProjectId(row.project_id)
      || admission.conversation_id !== safePattern(row.conversation_id, CONVERSATION_ID_PATTERN)
      || admission.task_id !== safeTaskId(row.task_id)
      || admission.run_id !== safePattern(row.run_id, RUN_ID_PATTERN)
      || admission.admitted_by !== safeOwnerId(row.admitted_by)
      || admission.admitted_at_ms !== safeTimestamp(row.admitted_at_ms)
      || admission.admission_contract !== row.admission_contract
      || admission.materialization_boundary !== row.materialization_boundary
      || admission.record_version !== BUILDER_AGENT_GOAL_ASSIGNMENT_ADMISSION_RECORD_VERSION
      || admission.admission_contract !== 'active_goal_to_owner_supervised_assignment'
      || admission.materialization_boundary !== 'assignment_record_required_before_execution'
      || canonicalReceipt(goal) !== row.goal_json
      || canonicalReceipt(goalStatus) !== row.goal_status_json
      || canonicalReceipt(assignment) !== row.assignment_json
      || canonicalReceipt(admission) !== row.admission_json
    ) fail('builder_agent_goal_assignment_admission_store_integrity_failed');
    return freezeDeep({
      goal,
      goal_status: goalStatus,
      assignment,
      admission,
    });
  } catch (error) {
    if (
      error instanceof BuilderAgentGoalAssignmentAdmissionStoreError
      || error instanceof BuilderAgentGoalAssignmentAdmissionError
    ) fail('builder_agent_goal_assignment_admission_store_integrity_failed');
    throw error;
  }
}

function loadByAdmissionId(db, admissionId) {
  return safeRow(one(
    db,
    `SELECT admission_id, goal_id, goal_status_id, assignment_id,
      definition_digest, record_version, agent_id, agent_version_id,
      owner_id, project_id, conversation_id, task_id, run_id,
      admitted_by, admitted_at_ms, admission_contract, materialization_boundary,
      goal_json, goal_status_json, assignment_json, admission_json
      FROM agent_goal_assignment_admissions
      WHERE admission_id = ?`,
    [admissionId],
  ));
}

function loadByAssignmentId(db, assignmentId) {
  return safeRow(one(
    db,
    `SELECT admission_id, goal_id, goal_status_id, assignment_id,
      definition_digest, record_version, agent_id, agent_version_id,
      owner_id, project_id, conversation_id, task_id, run_id,
      admitted_by, admitted_at_ms, admission_contract, materialization_boundary,
      goal_json, goal_status_json, assignment_json, admission_json
      FROM agent_goal_assignment_admissions
      WHERE assignment_id = ?`,
    [assignmentId],
  ));
}

function evidence(db, transaction) {
  return freezeDeep({
    database_id: DATABASE_ID,
    schema_version: BUILDER_AGENT_GOAL_ASSIGNMENT_ADMISSION_STORE_SCHEMA_VERSION,
    user_version: BUILDER_AGENT_GOAL_ASSIGNMENT_ADMISSION_STORE_USER_VERSION,
    schema_fingerprint_digest: sha256Canonical(collectSchemaFingerprint(db)),
    runtime_pragmas: runtimePragmas(db),
    transaction,
    admission_authority: 'main_owned_agent_goal_assignment_admission_store',
    renderer_authority: 'not_present',
    ipc_authority: 'not_present',
    provider_dispatch: false,
    tool_dispatch: false,
    assignment_store_authority: false,
    run_authority: false,
    permission_grant_authority: false,
    credential_storage: 'not_present',
    source_access: 'not_present',
    revision_authority: false,
    review_authority: false,
    artifact_authority: false,
  });
}

function storeResult(db, operation, payload) {
  return freezeDeep({
    result_version: BUILDER_AGENT_GOAL_ASSIGNMENT_ADMISSION_STORE_RESULT_VERSION,
    operation,
    ...payload,
    admission_evidence: evidence(db, operation),
  });
}

function readResult(db, transaction, payload) {
  return freezeDeep({
    result_version: BUILDER_AGENT_GOAL_ASSIGNMENT_ADMISSION_STORE_READ_RESULT_VERSION,
    admission_authority: 'main_owned_agent_goal_assignment_admission_store',
    ...payload,
    evidence: evidence(db, transaction),
  });
}

function insertAdmission(db, bundle) {
  const { admission } = bundle;
  run(db, `INSERT INTO agent_goal_assignment_admissions (
    admission_id, goal_id, goal_status_id, assignment_id,
    definition_digest, record_version, agent_id, agent_version_id,
    owner_id, project_id, conversation_id, task_id, run_id,
    admitted_by, admitted_at_ms, admission_contract, materialization_boundary,
    goal_json, goal_status_json, assignment_json, admission_json,
    schema_version
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
    admission.admission_id,
    admission.goal_id,
    admission.goal_status_id,
    admission.assignment_id,
    admission.definition_digest,
    admission.record_version,
    admission.agent_id,
    admission.agent_version_id,
    admission.owner_id,
    admission.project_id,
    admission.conversation_id,
    admission.task_id,
    admission.run_id,
    admission.admitted_by,
    admission.admitted_at_ms,
    admission.admission_contract,
    admission.materialization_boundary,
    canonicalReceipt(bundle.goal),
    canonicalReceipt(bundle.goal_status),
    canonicalReceipt(bundle.assignment),
    canonicalReceipt(bundle.admission),
    BUILDER_AGENT_GOAL_ASSIGNMENT_ADMISSION_STORE_SCHEMA_VERSION,
  ]);
}

function recordAdmission(db, rawRequest) {
  const bundle = sanitizeAdmissionBundle(rawRequest);
  db.exec('BEGIN IMMEDIATE');
  try {
    const existing = loadByAdmissionId(db, bundle.admission.admission_id);
    if (existing !== null) {
      if (!sameFact(existing, bundle)) fail('builder_agent_goal_assignment_admission_store_conflict');
      db.exec('COMMIT');
      return storeResult(db, 'admission_replayed', { admission: existing.admission });
    }
    const sameAssignment = loadByAssignmentId(db, bundle.admission.assignment_id);
    if (sameAssignment !== null) fail('builder_agent_goal_assignment_admission_store_conflict');
    insertAdmission(db, bundle);
    const readback = loadByAdmissionId(db, bundle.admission.admission_id);
    if (readback === null || !sameFact(readback, bundle)) {
      fail('builder_agent_goal_assignment_admission_store_integrity_failed');
    }
    db.exec('COMMIT');
    return storeResult(db, 'admission_recorded', { admission: readback.admission });
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* fixed failure below */ }
    throw error;
  }
}

function readAdmission(db, rawRequest) {
  exactObject(rawRequest, READ_ADMISSION_KEYS);
  const admissionId = safeAdmissionId(valueAt(rawRequest, 'admission_id'));
  const ownerId = safeOwnerId(valueAt(rawRequest, 'owner_id'));
  const bundle = loadByAdmissionId(db, admissionId);
  if (bundle === null || bundle.admission.owner_id !== ownerId) {
    return readResult(db, 'admission_absent_read', {
      status: 'absent',
      admission_id: admissionId,
      owner_id: ownerId,
      goal: null,
      goal_status: null,
      assignment: null,
      admission: null,
    });
  }
  return readResult(db, 'admission_ready_read', {
    status: 'ready',
    admission_id: admissionId,
    owner_id: ownerId,
    ...bundle,
  });
}

function readAdmissionByAssignment(db, rawRequest) {
  exactObject(rawRequest, READ_BY_ASSIGNMENT_KEYS);
  const assignmentId = safeAssignmentId(valueAt(rawRequest, 'assignment_id'));
  const ownerId = safeOwnerId(valueAt(rawRequest, 'owner_id'));
  const bundle = loadByAssignmentId(db, assignmentId);
  if (bundle === null || bundle.admission.owner_id !== ownerId) {
    return readResult(db, 'assignment_admission_absent_read', {
      status: 'absent',
      assignment_id: assignmentId,
      owner_id: ownerId,
      goal: null,
      goal_status: null,
      assignment: null,
      admission: null,
    });
  }
  return readResult(db, 'assignment_admission_ready_read', {
    status: 'ready',
    assignment_id: assignmentId,
    owner_id: ownerId,
    ...bundle,
  });
}

function listTaskAdmissions(db, rawRequest) {
  exactObject(rawRequest, LIST_TASK_ADMISSIONS_KEYS);
  const ownerId = safeOwnerId(valueAt(rawRequest, 'owner_id'));
  const projectId = safeProjectId(valueAt(rawRequest, 'project_id'));
  const taskId = safeTaskId(valueAt(rawRequest, 'task_id'));
  const rows = all(
    db,
    `SELECT admission_id, goal_id, goal_status_id, assignment_id,
      definition_digest, record_version, agent_id, agent_version_id,
      owner_id, project_id, conversation_id, task_id, run_id,
      admitted_by, admitted_at_ms, admission_contract, materialization_boundary,
      goal_json, goal_status_json, assignment_json, admission_json
      FROM agent_goal_assignment_admissions
      WHERE owner_id = ? AND project_id = ? AND task_id = ?
      ORDER BY admitted_at_ms ASC, admission_id ASC
      LIMIT ?`,
    [ownerId, projectId, taskId, MAX_TASK_ADMISSIONS + 1],
  );
  if (rows.length > MAX_TASK_ADMISSIONS) fail('builder_agent_goal_assignment_admission_store_resource_exceeded');
  return readResult(db, 'task_admissions_read', {
    status: 'ready',
    owner_id: ownerId,
    project_id: projectId,
    task_id: taskId,
    admissions: freezeDeep(rows.map((row) => safeRow(row))),
  });
}

function ownErrorField(error, key) {
  if (!error || typeof error !== 'object' || utilTypes.isProxy(error)) return null;
  const descriptor = Object.getOwnPropertyDescriptor(error, key);
  return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : null;
}

function normalizeOperationError(error) {
  if (error instanceof BuilderAgentGoalAssignmentAdmissionStoreError) {
    return new BuilderAgentGoalAssignmentAdmissionStoreError(error.code);
  }
  if (error instanceof BuilderAgentGoalAssignmentAdmissionError) {
    return new BuilderAgentGoalAssignmentAdmissionStoreError(
      'builder_agent_goal_assignment_admission_store_invalid',
    );
  }
  const sqliteCode = ownErrorField(error, 'code');
  const sqliteErrstr = ownErrorField(error, 'errstr');
  const sqliteErrcode = ownErrorField(error, 'errcode');
  if (sqliteCode && /^SQLITE_CONSTRAINT/u.test(sqliteCode)) {
    return new BuilderAgentGoalAssignmentAdmissionStoreError(
      'builder_agent_goal_assignment_admission_store_integrity_failed',
    );
  }
  if (sqliteErrstr === 'constraint failed' || sqliteErrcode === 1555) {
    return new BuilderAgentGoalAssignmentAdmissionStoreError(
      'builder_agent_goal_assignment_admission_store_integrity_failed',
    );
  }
  if (sqliteCode && /^SQLITE_(CORRUPT|NOTADB|SCHEMA|INTERNAL|MISMATCH)/u.test(sqliteCode)) {
    return new BuilderAgentGoalAssignmentAdmissionStoreError(
      'builder_agent_goal_assignment_admission_store_integrity_failed',
    );
  }
  return new BuilderAgentGoalAssignmentAdmissionStoreError(
    'builder_agent_goal_assignment_admission_store_unavailable',
  );
}

function createBuilderAgentGoalAssignmentAdmissionStore(databasePath) {
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
    store_version: BUILDER_AGENT_GOAL_ASSIGNMENT_ADMISSION_STORE_VERSION,

    close(...rawArguments) {
      if (rawArguments.length !== 0) {
        throw new BuilderAgentGoalAssignmentAdmissionStoreError(
          'builder_agent_goal_assignment_admission_store_invalid',
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

    read_admission_by_assignment(rawRequest) {
      try { return readAdmissionByAssignment(db, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },

    list_task_admissions(rawRequest) {
      try { return listTaskAdmissions(db, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },
  });
}

module.exports = Object.freeze({
  BUILDER_AGENT_GOAL_ASSIGNMENT_ADMISSION_STORE_READ_RESULT_VERSION,
  BUILDER_AGENT_GOAL_ASSIGNMENT_ADMISSION_STORE_RESULT_VERSION,
  BUILDER_AGENT_GOAL_ASSIGNMENT_ADMISSION_STORE_SCHEMA_VERSION,
  BUILDER_AGENT_GOAL_ASSIGNMENT_ADMISSION_STORE_USER_VERSION,
  BUILDER_AGENT_GOAL_ASSIGNMENT_ADMISSION_STORE_VERSION,
  BuilderAgentGoalAssignmentAdmissionStoreError,
  createBuilderAgentGoalAssignmentAdmissionStore,
});
