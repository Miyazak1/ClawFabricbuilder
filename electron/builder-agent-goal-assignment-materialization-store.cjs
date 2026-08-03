'use strict';

const nodeCrypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { types: utilTypes } = require('node:util');

const {
  BUILDER_AGENT_GOAL_ASSIGNMENT_MATERIALIZATION_RECORD_KIND,
  BUILDER_AGENT_GOAL_ASSIGNMENT_MATERIALIZATION_RECORD_VERSION,
  BuilderAgentGoalAssignmentMaterializationError,
  sanitizeBuilderAgentGoalAssignmentMaterializationRecord,
} = require('./builder-agent-goal-assignment-materialization.cjs');

const BUILDER_AGENT_GOAL_ASSIGNMENT_MATERIALIZATION_STORE_VERSION =
  'builder-agent-goal-assignment-materialization-store.v1';
const BUILDER_AGENT_GOAL_ASSIGNMENT_MATERIALIZATION_STORE_RESULT_VERSION =
  'builder-agent-goal-assignment-materialization-store-result.v1';
const BUILDER_AGENT_GOAL_ASSIGNMENT_MATERIALIZATION_STORE_READ_RESULT_VERSION =
  'builder-agent-goal-assignment-materialization-store-read-result.v1';
const BUILDER_AGENT_GOAL_ASSIGNMENT_MATERIALIZATION_STORE_SCHEMA_VERSION =
  'builder-agent-goal-assignment-materialization-store-schema.v1';
const BUILDER_AGENT_GOAL_ASSIGNMENT_MATERIALIZATION_STORE_USER_VERSION = 1;
const DATABASE_ID = 'builder-agent-goal-assignment-materialization-store.v1';
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
const ASSIGNMENT_STATUS_ID_PATTERN = /^builder-agent-assignment-status:[0-9a-f]{64}$/u;
const ADMISSION_ID_PATTERN = /^builder-agent-goal-assignment-admission:[0-9a-f]{64}$/u;
const MATERIALIZATION_ID_PATTERN = /^builder-agent-goal-assignment-materialization:[0-9a-f]{64}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const RECORD_MATERIALIZATION_KEYS = Object.freeze([
  'goal',
  'goal_status',
  'admission',
  'assignment_read',
  'materialization',
]);
const READ_MATERIALIZATION_KEYS = Object.freeze(['materialization_id', 'owner_id']);
const READ_BY_ASSIGNMENT_KEYS = Object.freeze(['assignment_id', 'owner_id']);
const READ_BY_ADMISSION_KEYS = Object.freeze(['admission_id', 'owner_id']);
const LIST_TASK_MATERIALIZATIONS_KEYS = Object.freeze(['owner_id', 'project_id', 'task_id']);
const MAX_TASK_MATERIALIZATIONS = 128;
const MAX_RECEIPT_JSON_BYTES = 128 * 1024;
const CREATE_SCHEMA_SQL = Object.freeze([
  `CREATE TABLE agent_goal_assignment_materializations (
    materialization_id TEXT NOT NULL PRIMARY KEY,
    admission_id TEXT NOT NULL,
    goal_id TEXT NOT NULL,
    goal_status_id TEXT NOT NULL,
    assignment_id TEXT NOT NULL,
    assignment_status_id TEXT NOT NULL,
    definition_digest TEXT NOT NULL,
    record_version TEXT NOT NULL,
    record_kind TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    agent_version_id TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    materialized_by TEXT NOT NULL,
    materialized_at_ms INTEGER NOT NULL,
    materialization_contract TEXT NOT NULL,
    execution_boundary TEXT NOT NULL,
    goal_json TEXT NOT NULL,
    goal_status_json TEXT NOT NULL,
    admission_json TEXT NOT NULL,
    assignment_read_json TEXT NOT NULL,
    materialization_json TEXT NOT NULL,
    schema_version TEXT NOT NULL,
    UNIQUE (admission_id),
    UNIQUE (assignment_id),
    CHECK (schema_version = 'builder-agent-goal-assignment-materialization-store-schema.v1'),
    CHECK (record_version = 'builder-agent-goal-assignment-materialization-record.v1'),
    CHECK (record_kind = 'builder_agent_goal_assignment_materialization_record'),
    CHECK (materialized_at_ms >= 0),
    CHECK (materialized_by = owner_id),
    CHECK (materialization_contract = 'admitted_goal_assignment_recorded_as_queued_assignment'),
    CHECK (execution_boundary = 'no_run_no_execution_no_source_materialization'),
    CHECK (length(goal_json) BETWEEN 2 AND 131072),
    CHECK (length(goal_status_json) BETWEEN 2 AND 131072),
    CHECK (length(admission_json) BETWEEN 2 AND 131072),
    CHECK (length(assignment_read_json) BETWEEN 2 AND 131072),
    CHECK (length(materialization_json) BETWEEN 2 AND 131072)
  ) STRICT`,
  'CREATE INDEX agent_goal_assignment_materializations_goal_idx ON agent_goal_assignment_materializations(owner_id, goal_id, materialized_at_ms, materialization_id)',
  'CREATE INDEX agent_goal_assignment_materializations_task_idx ON agent_goal_assignment_materializations(owner_id, project_id, task_id, materialized_at_ms, materialization_id)',
  'CREATE INDEX agent_goal_assignment_materializations_assignment_idx ON agent_goal_assignment_materializations(owner_id, assignment_id)',
  'CREATE INDEX agent_goal_assignment_materializations_admission_idx ON agent_goal_assignment_materializations(owner_id, admission_id)',
]);
const ERROR_MESSAGES = Object.freeze({
  builder_agent_goal_assignment_materialization_store_invalid:
    'Builder agent goal assignment materialization could not be verified.',
  builder_agent_goal_assignment_materialization_store_not_found:
    'Builder agent goal assignment materialization is unavailable.',
  builder_agent_goal_assignment_materialization_store_conflict:
    'Builder agent goal assignment materialization changed before it could be recorded.',
  builder_agent_goal_assignment_materialization_store_integrity_failed:
    'Builder agent goal assignment materialization integrity could not be verified.',
  builder_agent_goal_assignment_materialization_store_resource_exceeded:
    'Builder agent goal assignment materialization limits were reached.',
  builder_agent_goal_assignment_materialization_store_unavailable:
    'Builder agent goal assignment materialization storage is unavailable.',
});

class BuilderAgentGoalAssignmentMaterializationStoreError extends Error {
  constructor(code = 'builder_agent_goal_assignment_materialization_store_invalid') {
    const selected = Object.hasOwn(ERROR_MESSAGES, code)
      ? code
      : 'builder_agent_goal_assignment_materialization_store_invalid';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderAgentGoalAssignmentMaterializationStoreError';
    this.code = selected;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) {
  throw new BuilderAgentGoalAssignmentMaterializationStoreError(code);
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
  if (!isPlainObject(value)) fail('builder_agent_goal_assignment_materialization_store_invalid');
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== keys.length
    || actual.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) fail('builder_agent_goal_assignment_materialization_store_invalid');
  for (const key of actual) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      fail('builder_agent_goal_assignment_materialization_store_invalid');
    }
  }
}

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
    fail('builder_agent_goal_assignment_materialization_store_invalid');
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
  fail('builder_agent_goal_assignment_materialization_store_invalid');
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
    fail('builder_agent_goal_assignment_materialization_store_invalid');
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

function safeMaterializationId(value) {
  return safePattern(value, MATERIALIZATION_ID_PATTERN);
}

function safeAssignmentId(value) {
  return safePattern(value, ASSIGNMENT_ID_PATTERN);
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
  ) fail('builder_agent_goal_assignment_materialization_store_invalid');
  return value;
}

function assertParentDirectory(filePath) {
  let info;
  try {
    info = fs.lstatSync(path.dirname(filePath));
  } catch {
    fail('builder_agent_goal_assignment_materialization_store_unavailable');
  }
  if (!info.isDirectory() || info.isSymbolicLink()) {
    fail('builder_agent_goal_assignment_materialization_store_unavailable');
  }
}

function safeInteger(value) {
  if (!Number.isSafeInteger(value)) {
    fail('builder_agent_goal_assignment_materialization_store_integrity_failed');
  }
  return value;
}

function safeText(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) {
    fail('builder_agent_goal_assignment_materialization_store_integrity_failed');
  }
  return value;
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
    fail('builder_agent_goal_assignment_materialization_store_integrity_failed');
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

function configureRuntime(db) {
  db.exec('PRAGMA trusted_schema = OFF');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA synchronous = FULL');
  const mode = String(one(db, 'PRAGMA journal_mode = WAL')?.journal_mode ?? '').toLowerCase();
  if (mode !== 'wal') fail('builder_agent_goal_assignment_materialization_store_unavailable');
  const pragmas = runtimePragmas(db);
  if (
    pragmas.foreign_keys !== 'on'
    || pragmas.trusted_schema !== 'off'
    || pragmas.synchronous !== 'full'
    || pragmas.journal_mode !== 'wal'
  ) fail('builder_agent_goal_assignment_materialization_store_unavailable');
}

function collectSchemaFingerprint(db) {
  const rows = all(
    db,
    `SELECT type, name, tbl_name, sql
      FROM sqlite_schema
      WHERE type IN ('table', 'index', 'trigger', 'view')
        AND name NOT LIKE 'sqlite_%'
      ORDER BY type, name`,
  );
  return rows.map((row) => ({
    type: String(row.type),
    name: String(row.name),
    tbl_name: String(row.tbl_name),
    sql: row.sql === null ? null : String(row.sql),
  }));
}

function initialize(db) {
  configureRuntime(db);
  const existing = all(
    db,
    `SELECT name FROM sqlite_schema
      WHERE type IN ('table', 'index', 'trigger', 'view')
        AND name NOT LIKE 'sqlite_%'`,
  );
  if (existing.length === 0) {
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const statement of CREATE_SCHEMA_SQL) db.exec(statement);
      db.exec(`PRAGMA user_version = ${BUILDER_AGENT_GOAL_ASSIGNMENT_MATERIALIZATION_STORE_USER_VERSION}`);
      db.exec('COMMIT');
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch { /* fixed failure below */ }
      throw error;
    }
  }
  if (userVersion(db) !== BUILDER_AGENT_GOAL_ASSIGNMENT_MATERIALIZATION_STORE_USER_VERSION) {
    fail('builder_agent_goal_assignment_materialization_store_integrity_failed');
  }
  const actual = collectSchemaFingerprint(db);
  if (
    actual.length !== CREATE_SCHEMA_SQL.length
    || actual.some((row) => typeof row.sql !== 'string')
  ) fail('builder_agent_goal_assignment_materialization_store_integrity_failed');
  const fingerprintText = JSON.stringify(actual);
  if (
    !fingerprintText.includes('agent_goal_assignment_materializations')
    || !fingerprintText.includes('builder-agent-goal-assignment-materialization-store-schema.v1')
  ) {
    fail('builder_agent_goal_assignment_materialization_store_integrity_failed');
  }
  const integrity = one(db, 'PRAGMA integrity_check');
  const foreignKeyRows = all(db, 'PRAGMA foreign_key_check');
  if (!integrity || integrity.integrity_check !== 'ok' || foreignKeyRows.length !== 0) {
    fail('builder_agent_goal_assignment_materialization_store_integrity_failed');
  }
}

function canonicalReceipt(value) {
  const text = canonicalJson(value);
  if (text.length < 2 || text.length > MAX_RECEIPT_JSON_BYTES) {
    fail('builder_agent_goal_assignment_materialization_store_resource_exceeded');
  }
  return text;
}

function parseCanonicalReceipt(value, failureCode) {
  if (
    typeof value !== 'string'
    || value.length < 2
    || value.length > MAX_RECEIPT_JSON_BYTES
    || hasControlCharacter(value)
  ) fail(failureCode);
  try {
    const parsed = JSON.parse(value);
    if (canonicalJson(parsed) !== value) fail(failureCode);
    return parsed;
  } catch {
    fail(failureCode);
  }
}

function safeMaterializationFromRow(row) {
  const materialization = {
    materialization_id: safeText(row.materialization_id, MATERIALIZATION_ID_PATTERN),
    definition_digest: safeText(row.definition_digest, DIGEST_PATTERN),
    record_version: String(row.record_version),
    record_kind: String(row.record_kind),
    admission_id: safeText(row.admission_id, ADMISSION_ID_PATTERN),
    goal_id: safeText(row.goal_id, GOAL_ID_PATTERN),
    goal_status_id: safeText(row.goal_status_id, GOAL_STATUS_ID_PATTERN),
    assignment_id: safeText(row.assignment_id, ASSIGNMENT_ID_PATTERN),
    assignment_status_id: safeText(
      row.assignment_status_id,
      ASSIGNMENT_STATUS_ID_PATTERN,
    ),
    agent_id: safeText(row.agent_id, AGENT_ID_PATTERN),
    agent_version_id: safeText(row.agent_version_id, AGENT_VERSION_ID_PATTERN),
    owner_id: safeText(row.owner_id, OWNER_ID_PATTERN),
    project_id: safeText(row.project_id, PROJECT_ID_PATTERN),
    conversation_id: safeText(row.conversation_id, CONVERSATION_ID_PATTERN),
    task_id: safeText(row.task_id, TASK_ID_PATTERN),
    run_id: safeText(row.run_id, RUN_ID_PATTERN),
    materialized_by: safeText(row.materialized_by, OWNER_ID_PATTERN),
    materialized_at_ms: safeInteger(row.materialized_at_ms),
    materialization_contract: String(row.materialization_contract),
    execution_boundary: String(row.execution_boundary),
  };
  if (
    materialization.record_version !== BUILDER_AGENT_GOAL_ASSIGNMENT_MATERIALIZATION_RECORD_VERSION
    || materialization.record_kind !== BUILDER_AGENT_GOAL_ASSIGNMENT_MATERIALIZATION_RECORD_KIND
    || materialization.materialized_by !== materialization.owner_id
    || materialization.materialization_contract !== 'admitted_goal_assignment_recorded_as_queued_assignment'
    || materialization.execution_boundary !== 'no_run_no_execution_no_source_materialization'
  ) fail('builder_agent_goal_assignment_materialization_store_integrity_failed');
  return freezeDeep(materialization);
}

function sameFact(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function sameBundle(left, right) {
  return sameFact(left.goal, right.goal)
    && sameFact(left.goal_status, right.goal_status)
    && sameFact(left.admission, right.admission)
    && sameFact(left.assignment_read, right.assignment_read)
    && sameFact(left.materialization, right.materialization);
}

function sanitizeMaterializationBundle(value) {
  exactObject(value, RECORD_MATERIALIZATION_KEYS);
  const goal = valueAt(value, 'goal');
  const goalStatus = valueAt(value, 'goal_status');
  const admission = valueAt(value, 'admission');
  const assignmentRead = valueAt(value, 'assignment_read');
  const materialization = valueAt(value, 'materialization');
  try {
    const sanitized = sanitizeBuilderAgentGoalAssignmentMaterializationRecord(
      materialization,
      goal,
      goalStatus,
      admission,
      assignmentRead,
    );
    return freezeDeep({
      goal,
      goal_status: goalStatus,
      admission,
      assignment_read: assignmentRead,
      materialization: sanitized,
    });
  } catch (error) {
    if (error instanceof BuilderAgentGoalAssignmentMaterializationError) {
      fail('builder_agent_goal_assignment_materialization_store_invalid');
    }
    throw error;
  }
}

function safeRow(row) {
  const indexed = safeMaterializationFromRow(row);
  const goal = parseCanonicalReceipt(row.goal_json, 'builder_agent_goal_assignment_materialization_store_integrity_failed');
  const goalStatus = parseCanonicalReceipt(
    row.goal_status_json,
    'builder_agent_goal_assignment_materialization_store_integrity_failed',
  );
  const admission = parseCanonicalReceipt(
    row.admission_json,
    'builder_agent_goal_assignment_materialization_store_integrity_failed',
  );
  const assignmentRead = parseCanonicalReceipt(
    row.assignment_read_json,
    'builder_agent_goal_assignment_materialization_store_integrity_failed',
  );
  const parsedMaterialization = parseCanonicalReceipt(
    row.materialization_json,
    'builder_agent_goal_assignment_materialization_store_integrity_failed',
  );
  let materialization;
  try {
    materialization = sanitizeBuilderAgentGoalAssignmentMaterializationRecord(
      parsedMaterialization,
      goal,
      goalStatus,
      admission,
      assignmentRead,
    );
  } catch {
    fail('builder_agent_goal_assignment_materialization_store_integrity_failed');
  }
  for (const key of Object.keys(indexed)) {
    if (materialization[key] !== indexed[key]) {
      fail('builder_agent_goal_assignment_materialization_store_integrity_failed');
    }
  }
  return freezeDeep({ goal, goal_status: goalStatus, admission, assignment_read: assignmentRead, materialization });
}

function loadByMaterializationId(db, materializationId) {
  const row = one(
    db,
    `SELECT materialization_id, admission_id, goal_id, goal_status_id,
      assignment_id, assignment_status_id, definition_digest, record_version,
      record_kind, agent_id, agent_version_id, owner_id, project_id,
      conversation_id, task_id, run_id, materialized_by, materialized_at_ms,
      materialization_contract, execution_boundary, goal_json,
      goal_status_json, admission_json, assignment_read_json, materialization_json
      FROM agent_goal_assignment_materializations
      WHERE materialization_id = ?`,
    [materializationId],
  );
  return row === null ? null : safeRow(row);
}

function loadByAssignmentId(db, assignmentId) {
  const row = one(
    db,
    `SELECT materialization_id, admission_id, goal_id, goal_status_id,
      assignment_id, assignment_status_id, definition_digest, record_version,
      record_kind, agent_id, agent_version_id, owner_id, project_id,
      conversation_id, task_id, run_id, materialized_by, materialized_at_ms,
      materialization_contract, execution_boundary, goal_json,
      goal_status_json, admission_json, assignment_read_json, materialization_json
      FROM agent_goal_assignment_materializations
      WHERE assignment_id = ?`,
    [assignmentId],
  );
  return row === null ? null : safeRow(row);
}

function loadByAdmissionId(db, admissionId) {
  const row = one(
    db,
    `SELECT materialization_id, admission_id, goal_id, goal_status_id,
      assignment_id, assignment_status_id, definition_digest, record_version,
      record_kind, agent_id, agent_version_id, owner_id, project_id,
      conversation_id, task_id, run_id, materialized_by, materialized_at_ms,
      materialization_contract, execution_boundary, goal_json,
      goal_status_json, admission_json, assignment_read_json, materialization_json
      FROM agent_goal_assignment_materializations
      WHERE admission_id = ?`,
    [admissionId],
  );
  return row === null ? null : safeRow(row);
}

function evidence(db, transaction) {
  return freezeDeep({
    database_id: DATABASE_ID,
    schema_version: BUILDER_AGENT_GOAL_ASSIGNMENT_MATERIALIZATION_STORE_SCHEMA_VERSION,
    user_version: BUILDER_AGENT_GOAL_ASSIGNMENT_MATERIALIZATION_STORE_USER_VERSION,
    schema_fingerprint_digest: sha256Canonical(collectSchemaFingerprint(db)),
    runtime_pragmas: runtimePragmas(db),
    transaction,
    materialization_authority: 'main_owned_agent_goal_assignment_materialization_store',
    renderer_authority: 'not_present',
    ipc_authority: 'not_present',
    provider_dispatch: false,
    tool_dispatch: false,
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
    result_version: BUILDER_AGENT_GOAL_ASSIGNMENT_MATERIALIZATION_STORE_RESULT_VERSION,
    operation,
    ...payload,
    materialization_evidence: evidence(db, operation),
  });
}

function readResult(db, transaction, payload) {
  return freezeDeep({
    result_version: BUILDER_AGENT_GOAL_ASSIGNMENT_MATERIALIZATION_STORE_READ_RESULT_VERSION,
    materialization_authority: 'main_owned_agent_goal_assignment_materialization_store',
    ...payload,
    evidence: evidence(db, transaction),
  });
}

function insertMaterialization(db, bundle) {
  const { materialization } = bundle;
  run(db, `INSERT INTO agent_goal_assignment_materializations (
    materialization_id, admission_id, goal_id, goal_status_id,
    assignment_id, assignment_status_id, definition_digest, record_version,
    record_kind, agent_id, agent_version_id, owner_id, project_id,
    conversation_id, task_id, run_id, materialized_by, materialized_at_ms,
    materialization_contract, execution_boundary, goal_json, goal_status_json,
    admission_json, assignment_read_json, materialization_json, schema_version
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
    materialization.materialization_id,
    materialization.admission_id,
    materialization.goal_id,
    materialization.goal_status_id,
    materialization.assignment_id,
    materialization.assignment_status_id,
    materialization.definition_digest,
    materialization.record_version,
    materialization.record_kind,
    materialization.agent_id,
    materialization.agent_version_id,
    materialization.owner_id,
    materialization.project_id,
    materialization.conversation_id,
    materialization.task_id,
    materialization.run_id,
    materialization.materialized_by,
    materialization.materialized_at_ms,
    materialization.materialization_contract,
    materialization.execution_boundary,
    canonicalReceipt(bundle.goal),
    canonicalReceipt(bundle.goal_status),
    canonicalReceipt(bundle.admission),
    canonicalReceipt(bundle.assignment_read),
    canonicalReceipt(bundle.materialization),
    BUILDER_AGENT_GOAL_ASSIGNMENT_MATERIALIZATION_STORE_SCHEMA_VERSION,
  ]);
}

function recordMaterialization(db, rawRequest) {
  const bundle = sanitizeMaterializationBundle(rawRequest);
  db.exec('BEGIN IMMEDIATE');
  try {
    const existing = loadByMaterializationId(db, bundle.materialization.materialization_id);
    if (existing !== null) {
      if (!sameBundle(existing, bundle)) fail('builder_agent_goal_assignment_materialization_store_conflict');
      db.exec('COMMIT');
      return storeResult(db, 'materialization_replayed', {
        materialization: existing.materialization,
      });
    }
    const sameAssignment = loadByAssignmentId(db, bundle.materialization.assignment_id);
    if (sameAssignment !== null) fail('builder_agent_goal_assignment_materialization_store_conflict');
    const sameAdmission = loadByAdmissionId(db, bundle.materialization.admission_id);
    if (sameAdmission !== null) fail('builder_agent_goal_assignment_materialization_store_conflict');
    insertMaterialization(db, bundle);
    const readback = loadByMaterializationId(db, bundle.materialization.materialization_id);
    if (readback === null || !sameBundle(readback, bundle)) {
      fail('builder_agent_goal_assignment_materialization_store_integrity_failed');
    }
    db.exec('COMMIT');
    return storeResult(db, 'materialization_recorded', { materialization: readback.materialization });
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* fixed failure below */ }
    throw error;
  }
}

function readMaterialization(db, rawRequest) {
  exactObject(rawRequest, READ_MATERIALIZATION_KEYS);
  const materializationId = safeMaterializationId(valueAt(rawRequest, 'materialization_id'));
  const ownerId = safeOwnerId(valueAt(rawRequest, 'owner_id'));
  const bundle = loadByMaterializationId(db, materializationId);
  if (bundle === null || bundle.materialization.owner_id !== ownerId) {
    return readResult(db, 'materialization_absent_read', {
      status: 'absent',
      materialization_id: materializationId,
      owner_id: ownerId,
      goal: null,
      goal_status: null,
      admission: null,
      assignment_read: null,
      materialization: null,
    });
  }
  return readResult(db, 'materialization_ready_read', {
    status: 'ready',
    materialization_id: materializationId,
    owner_id: ownerId,
    ...bundle,
  });
}

function readMaterializationByAssignment(db, rawRequest) {
  exactObject(rawRequest, READ_BY_ASSIGNMENT_KEYS);
  const assignmentId = safeAssignmentId(valueAt(rawRequest, 'assignment_id'));
  const ownerId = safeOwnerId(valueAt(rawRequest, 'owner_id'));
  const bundle = loadByAssignmentId(db, assignmentId);
  if (bundle === null || bundle.materialization.owner_id !== ownerId) {
    return readResult(db, 'assignment_materialization_absent_read', {
      status: 'absent',
      assignment_id: assignmentId,
      owner_id: ownerId,
      goal: null,
      goal_status: null,
      admission: null,
      assignment_read: null,
      materialization: null,
    });
  }
  return readResult(db, 'assignment_materialization_ready_read', {
    status: 'ready',
    assignment_id: assignmentId,
    owner_id: ownerId,
    ...bundle,
  });
}

function readMaterializationByAdmission(db, rawRequest) {
  exactObject(rawRequest, READ_BY_ADMISSION_KEYS);
  const admissionId = safeAdmissionId(valueAt(rawRequest, 'admission_id'));
  const ownerId = safeOwnerId(valueAt(rawRequest, 'owner_id'));
  const bundle = loadByAdmissionId(db, admissionId);
  if (bundle === null || bundle.materialization.owner_id !== ownerId) {
    return readResult(db, 'admission_materialization_absent_read', {
      status: 'absent',
      admission_id: admissionId,
      owner_id: ownerId,
      goal: null,
      goal_status: null,
      admission: null,
      assignment_read: null,
      materialization: null,
    });
  }
  return readResult(db, 'admission_materialization_ready_read', {
    status: 'ready',
    admission_id: admissionId,
    owner_id: ownerId,
    ...bundle,
  });
}

function listTaskMaterializations(db, rawRequest) {
  exactObject(rawRequest, LIST_TASK_MATERIALIZATIONS_KEYS);
  const ownerId = safeOwnerId(valueAt(rawRequest, 'owner_id'));
  const projectId = safeProjectId(valueAt(rawRequest, 'project_id'));
  const taskId = safeTaskId(valueAt(rawRequest, 'task_id'));
  const rows = all(
    db,
    `SELECT materialization_id, admission_id, goal_id, goal_status_id,
      assignment_id, assignment_status_id, definition_digest, record_version,
      record_kind, agent_id, agent_version_id, owner_id, project_id,
      conversation_id, task_id, run_id, materialized_by, materialized_at_ms,
      materialization_contract, execution_boundary, goal_json, goal_status_json,
      admission_json, assignment_read_json, materialization_json
      FROM agent_goal_assignment_materializations
      WHERE owner_id = ? AND project_id = ? AND task_id = ?
      ORDER BY materialized_at_ms ASC, materialization_id ASC
      LIMIT ?`,
    [ownerId, projectId, taskId, MAX_TASK_MATERIALIZATIONS + 1],
  );
  if (rows.length > MAX_TASK_MATERIALIZATIONS) {
    fail('builder_agent_goal_assignment_materialization_store_resource_exceeded');
  }
  return readResult(db, 'task_materializations_read', {
    status: 'ready',
    owner_id: ownerId,
    project_id: projectId,
    task_id: taskId,
    materializations: freezeDeep(rows.map((row) => safeRow(row))),
  });
}

function ownErrorField(error, key) {
  if (!error || typeof error !== 'object' || utilTypes.isProxy(error)) return null;
  const descriptor = Object.getOwnPropertyDescriptor(error, key);
  return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : null;
}

function normalizeOperationError(error) {
  if (error instanceof BuilderAgentGoalAssignmentMaterializationStoreError) {
    return new BuilderAgentGoalAssignmentMaterializationStoreError(error.code);
  }
  if (error instanceof BuilderAgentGoalAssignmentMaterializationError) {
    return new BuilderAgentGoalAssignmentMaterializationStoreError(
      'builder_agent_goal_assignment_materialization_store_invalid',
    );
  }
  const sqliteCode = ownErrorField(error, 'code');
  const sqliteErrstr = ownErrorField(error, 'errstr');
  const sqliteErrcode = ownErrorField(error, 'errcode');
  if (sqliteCode && /^SQLITE_CONSTRAINT/u.test(sqliteCode)) {
    return new BuilderAgentGoalAssignmentMaterializationStoreError(
      'builder_agent_goal_assignment_materialization_store_integrity_failed',
    );
  }
  if (sqliteErrstr === 'constraint failed' || sqliteErrcode === 1555) {
    return new BuilderAgentGoalAssignmentMaterializationStoreError(
      'builder_agent_goal_assignment_materialization_store_integrity_failed',
    );
  }
  if (sqliteCode && /^SQLITE_(CORRUPT|NOTADB|SCHEMA|INTERNAL|MISMATCH)/u.test(sqliteCode)) {
    return new BuilderAgentGoalAssignmentMaterializationStoreError(
      'builder_agent_goal_assignment_materialization_store_integrity_failed',
    );
  }
  return new BuilderAgentGoalAssignmentMaterializationStoreError(
    'builder_agent_goal_assignment_materialization_store_unavailable',
  );
}

function createBuilderAgentGoalAssignmentMaterializationStore(databasePath) {
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
    store_version: BUILDER_AGENT_GOAL_ASSIGNMENT_MATERIALIZATION_STORE_VERSION,

    close(...rawArguments) {
      if (rawArguments.length !== 0) {
        throw new BuilderAgentGoalAssignmentMaterializationStoreError(
          'builder_agent_goal_assignment_materialization_store_invalid',
        );
      }
      try { db.close(); } catch (error) { throw normalizeOperationError(error); }
    },

    record_materialization(rawRequest) {
      try { return recordMaterialization(db, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },

    read_materialization(rawRequest) {
      try { return readMaterialization(db, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },

    read_materialization_by_assignment(rawRequest) {
      try { return readMaterializationByAssignment(db, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },

    read_materialization_by_admission(rawRequest) {
      try { return readMaterializationByAdmission(db, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },

    list_task_materializations(rawRequest) {
      try { return listTaskMaterializations(db, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },
  });
}

module.exports = Object.freeze({
  BUILDER_AGENT_GOAL_ASSIGNMENT_MATERIALIZATION_STORE_READ_RESULT_VERSION,
  BUILDER_AGENT_GOAL_ASSIGNMENT_MATERIALIZATION_STORE_RESULT_VERSION,
  BUILDER_AGENT_GOAL_ASSIGNMENT_MATERIALIZATION_STORE_SCHEMA_VERSION,
  BUILDER_AGENT_GOAL_ASSIGNMENT_MATERIALIZATION_STORE_USER_VERSION,
  BUILDER_AGENT_GOAL_ASSIGNMENT_MATERIALIZATION_STORE_VERSION,
  BuilderAgentGoalAssignmentMaterializationStoreError,
  createBuilderAgentGoalAssignmentMaterializationStore,
});
