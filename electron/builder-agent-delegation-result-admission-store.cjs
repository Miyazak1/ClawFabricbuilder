'use strict';

const nodeCrypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { types: utilTypes } = require('node:util');

const {
  BuilderAgentDelegationResultAdmissionContractError,
  BUILDER_AGENT_DELEGATION_RESULT_ADMISSION_RECORD_VERSION,
  sanitizeBuilderAgentDelegationResultAdmissionRecord,
} = require('./builder-agent-delegation-result-admission-contract.cjs');

const BUILDER_AGENT_DELEGATION_RESULT_ADMISSION_STORE_VERSION =
  'builder-agent-delegation-result-admission-store.v1';
const BUILDER_AGENT_DELEGATION_RESULT_ADMISSION_STORE_RESULT_VERSION =
  'builder-agent-delegation-result-admission-store-result.v1';
const BUILDER_AGENT_DELEGATION_RESULT_ADMISSION_STORE_READ_RESULT_VERSION =
  'builder-agent-delegation-result-admission-store-read-result.v1';
const BUILDER_AGENT_DELEGATION_RESULT_ADMISSION_STORE_SCHEMA_VERSION =
  'builder-agent-delegation-result-admission-store-schema.v1';
const BUILDER_AGENT_DELEGATION_RESULT_ADMISSION_STORE_USER_VERSION = 1;
const DATABASE_ID = 'builder-agent-delegation-result-admission-store.v1';
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
const DELEGATION_ID_PATTERN = /^builder-agent-delegation:[0-9a-f]{64}$/u;
const DELEGATION_RESULT_ID_PATTERN = /^builder-agent-delegation-result:[0-9a-f]{64}$/u;
const DELEGATION_RESULT_ADMISSION_ID_PATTERN =
  /^builder-agent-delegation-result-admission:[0-9a-f]{64}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const RECORD_ADMISSION_KEYS = Object.freeze(['delegation', 'result', 'admission']);
const READ_ADMISSION_KEYS = Object.freeze(['delegation_result_admission_id', 'owner_id']);
const READ_ADMISSION_BY_RESULT_KEYS = Object.freeze(['delegation_result_id', 'owner_id']);
const LIST_PARENT_TASK_ADMISSIONS_KEYS = Object.freeze(['owner_id', 'project_id', 'parent_task_id']);
const LIST_CHILD_TASK_ADMISSIONS_KEYS = Object.freeze(['owner_id', 'project_id', 'child_task_id']);
const MAX_TASK_ADMISSIONS = 128;
const MAX_RECEIPT_JSON_BYTES = 64 * 1024;
const CREATE_SCHEMA_SQL = Object.freeze([
  `CREATE TABLE agent_delegation_result_admissions (
    delegation_result_admission_id TEXT NOT NULL PRIMARY KEY,
    delegation_result_id TEXT NOT NULL,
    delegation_id TEXT NOT NULL,
    delegation_definition_digest TEXT NOT NULL,
    target_definition_digest TEXT NOT NULL,
    delegation_result_digest TEXT NOT NULL,
    record_version TEXT NOT NULL,
    parent_assignment_id TEXT NOT NULL,
    parent_assignment_status_id TEXT NOT NULL,
    parent_lease_id TEXT NOT NULL,
    from_agent_id TEXT NOT NULL,
    from_agent_version_id TEXT NOT NULL,
    to_agent_id TEXT NOT NULL,
    to_agent_version_id TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    parent_conversation_id TEXT NOT NULL,
    parent_task_id TEXT NOT NULL,
    parent_run_id TEXT NOT NULL,
    child_conversation_id TEXT NOT NULL,
    child_task_id TEXT NOT NULL,
    child_run_id TEXT NOT NULL,
    lease_holder_id TEXT NOT NULL,
    admitted_at_ms INTEGER NOT NULL,
    result_status TEXT NOT NULL,
    result_summary_code TEXT NOT NULL,
    admission_status TEXT NOT NULL,
    admission_summary_code TEXT NOT NULL,
    admission_contract TEXT NOT NULL,
    parent_review_contract TEXT NOT NULL,
    parent_materialization_boundary TEXT NOT NULL,
    delegation_json TEXT NOT NULL,
    result_json TEXT NOT NULL,
    admission_json TEXT NOT NULL,
    schema_version TEXT NOT NULL,
    UNIQUE (delegation_result_id),
    CHECK (schema_version = 'builder-agent-delegation-result-admission-store-schema.v1'),
    CHECK (record_version = 'builder-agent-delegation-result-admission-record.v1'),
    CHECK (admitted_at_ms >= 0),
    CHECK (result_status IN ('proposed', 'blocked', 'failed')),
    CHECK (result_summary_code IN (
      'delegated_child_result_ready_for_parent_review',
      'delegated_child_result_needs_owner_attention',
      'delegated_child_result_could_not_be_prepared'
    )),
    CHECK (admission_status = 'admitted_for_parent_review'),
    CHECK (admission_summary_code IN (
      'delegated_child_result_admitted_for_parent_review',
      'delegated_child_blocker_admitted_for_owner_attention',
      'delegated_child_failure_admitted_for_owner_attention'
    )),
    CHECK (admission_contract = 'local_contribution_admitted_for_parent_review'),
    CHECK (parent_review_contract = 'owner_review_required_before_materialization'),
    CHECK (parent_materialization_boundary = 'no_direct_parent_mutation'),
    CHECK (length(delegation_json) BETWEEN 2 AND 65536),
    CHECK (length(result_json) BETWEEN 2 AND 65536),
    CHECK (length(admission_json) BETWEEN 2 AND 65536)
  ) STRICT`,
  'CREATE INDEX agent_delegation_result_admissions_parent_task_idx ON agent_delegation_result_admissions(owner_id, project_id, parent_task_id, admitted_at_ms, delegation_result_admission_id)',
  'CREATE INDEX agent_delegation_result_admissions_child_task_idx ON agent_delegation_result_admissions(owner_id, project_id, child_task_id, admitted_at_ms, delegation_result_admission_id)',
  'CREATE INDEX agent_delegation_result_admissions_result_idx ON agent_delegation_result_admissions(owner_id, delegation_result_id)',
  'CREATE INDEX agent_delegation_result_admissions_delegation_idx ON agent_delegation_result_admissions(owner_id, delegation_id)',
]);
const ERROR_MESSAGES = Object.freeze({
  builder_agent_delegation_result_admission_store_invalid:
    'Builder agent delegation result admission could not be verified.',
  builder_agent_delegation_result_admission_store_not_found:
    'Builder agent delegation result admission is unavailable.',
  builder_agent_delegation_result_admission_store_conflict:
    'Builder agent delegation result admission changed before it could be recorded.',
  builder_agent_delegation_result_admission_store_integrity_failed:
    'Builder agent delegation result admission integrity could not be verified.',
  builder_agent_delegation_result_admission_store_resource_exceeded:
    'Builder agent delegation result admission limits were reached.',
  builder_agent_delegation_result_admission_store_unavailable:
    'Builder agent delegation result admission storage is unavailable.',
});

class BuilderAgentDelegationResultAdmissionStoreError extends Error {
  constructor(code = 'builder_agent_delegation_result_admission_store_invalid') {
    const selected = Object.hasOwn(ERROR_MESSAGES, code)
      ? code
      : 'builder_agent_delegation_result_admission_store_invalid';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderAgentDelegationResultAdmissionStoreError';
    this.code = selected;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) {
  throw new BuilderAgentDelegationResultAdmissionStoreError(code);
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
  if (!isPlainObject(value)) fail('builder_agent_delegation_result_admission_store_invalid');
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== keys.length
    || actual.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) fail('builder_agent_delegation_result_admission_store_invalid');
  for (const key of actual) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      fail('builder_agent_delegation_result_admission_store_invalid');
    }
  }
}

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
    fail('builder_agent_delegation_result_admission_store_invalid');
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
  fail('builder_agent_delegation_result_admission_store_invalid');
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
    fail('builder_agent_delegation_result_admission_store_invalid');
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

function safeDelegationResultAdmissionId(value) {
  return safePattern(value, DELEGATION_RESULT_ADMISSION_ID_PATTERN);
}

function safeDelegationResultId(value) {
  return safePattern(value, DELEGATION_RESULT_ID_PATTERN);
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail('builder_agent_delegation_result_admission_store_invalid');
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
  ) fail('builder_agent_delegation_result_admission_store_invalid');
  return value;
}

function assertParentDirectory(filePath) {
  let info;
  try {
    info = fs.lstatSync(path.dirname(filePath));
  } catch {
    fail('builder_agent_delegation_result_admission_store_unavailable');
  }
  if (!info.isDirectory() || info.isSymbolicLink()) {
    fail('builder_agent_delegation_result_admission_store_unavailable');
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
    fail('builder_agent_delegation_result_admission_store_integrity_failed');
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
  if (mode !== 'wal') fail('builder_agent_delegation_result_admission_store_unavailable');
  const pragmas = runtimePragmas(db);
  if (
    pragmas.foreign_keys !== 'on'
    || pragmas.trusted_schema !== 'off'
    || pragmas.synchronous !== 'full'
    || pragmas.journal_mode !== 'wal'
  ) fail('builder_agent_delegation_result_admission_store_unavailable');
}

function createSchema(db) {
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const sql of CREATE_SCHEMA_SQL) db.exec(sql);
    db.exec(`PRAGMA user_version = ${BUILDER_AGENT_DELEGATION_RESULT_ADMISSION_STORE_USER_VERSION}`);
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
    expectedDb.exec(`PRAGMA user_version = ${BUILDER_AGENT_DELEGATION_RESULT_ADMISSION_STORE_USER_VERSION}`);
    expectedSchemaFingerprint = canonicalJson(collectSchemaFingerprint(expectedDb));
    return expectedSchemaFingerprint;
  } finally {
    expectedDb.close();
  }
}

function validateSchema(db) {
  const actual = collectSchemaFingerprint(db);
  if (actual.foreign_key_check.length !== 0) {
    fail('builder_agent_delegation_result_admission_store_integrity_failed');
  }
  if (canonicalJson(actual) !== expectedFingerprint()) {
    fail('builder_agent_delegation_result_admission_store_integrity_failed');
  }
}

function initialize(db) {
  configurePragmas(db);
  const version = userVersion(db);
  if (version === 0) createSchema(db);
  else if (version !== BUILDER_AGENT_DELEGATION_RESULT_ADMISSION_STORE_USER_VERSION) {
    fail('builder_agent_delegation_result_admission_store_integrity_failed');
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
    if (error instanceof BuilderAgentDelegationResultAdmissionStoreError) fail(code);
    throw error;
  }
  return parsed;
}

function sanitizeAdmissionRequest(value) {
  exactObject(value, RECORD_ADMISSION_KEYS);
  const delegation = valueAt(value, 'delegation');
  const result = valueAt(value, 'result');
  const admission = valueAt(value, 'admission');
  try {
    return freezeDeep({
      delegation,
      result,
      admission: sanitizeBuilderAgentDelegationResultAdmissionRecord(admission, result, delegation),
    });
  } catch (error) {
    if (error instanceof BuilderAgentDelegationResultAdmissionContractError) {
      fail('builder_agent_delegation_result_admission_store_invalid');
    }
    throw error;
  }
}

function admissionColumns() {
  return `delegation_result_admission_id, delegation_result_id, delegation_id,
    delegation_definition_digest, target_definition_digest, delegation_result_digest,
    record_version, parent_assignment_id, parent_assignment_status_id,
    parent_lease_id, from_agent_id, from_agent_version_id, to_agent_id,
    to_agent_version_id, owner_id, project_id, parent_conversation_id,
    parent_task_id, parent_run_id, child_conversation_id, child_task_id,
    child_run_id, lease_holder_id, admitted_at_ms, result_status,
    result_summary_code, admission_status, admission_summary_code,
    admission_contract, parent_review_contract, parent_materialization_boundary,
    delegation_json, result_json, admission_json`;
}

function entryFromRow(row) {
  if (!row) return null;
  try {
    const delegation = parseCanonicalReceipt(
      row.delegation_json,
      'builder_agent_delegation_result_admission_store_integrity_failed',
    );
    const result = parseCanonicalReceipt(
      row.result_json,
      'builder_agent_delegation_result_admission_store_integrity_failed',
    );
    const parsedAdmission = parseCanonicalReceipt(
      row.admission_json,
      'builder_agent_delegation_result_admission_store_integrity_failed',
    );
    const admission = sanitizeBuilderAgentDelegationResultAdmissionRecord(
      parsedAdmission,
      result,
      delegation,
    );
    const rowFacts = freezeDeep({
      delegation_result_admission_id: safePattern(
        row.delegation_result_admission_id,
        DELEGATION_RESULT_ADMISSION_ID_PATTERN,
      ),
      delegation_result_id: safePattern(row.delegation_result_id, DELEGATION_RESULT_ID_PATTERN),
      delegation_id: safePattern(row.delegation_id, DELEGATION_ID_PATTERN),
      delegation_definition_digest: safePattern(row.delegation_definition_digest, DIGEST_PATTERN),
      target_definition_digest: safePattern(row.target_definition_digest, DIGEST_PATTERN),
      delegation_result_digest: safePattern(row.delegation_result_digest, DIGEST_PATTERN),
      record_version: row.record_version,
      parent_assignment_id: safePattern(row.parent_assignment_id, ASSIGNMENT_ID_PATTERN),
      parent_assignment_status_id: safePattern(row.parent_assignment_status_id, ASSIGNMENT_STATUS_ID_PATTERN),
      parent_lease_id: safePattern(row.parent_lease_id, LEASE_ID_PATTERN),
      from_agent_id: safePattern(row.from_agent_id, AGENT_ID_PATTERN),
      from_agent_version_id: safePattern(row.from_agent_version_id, AGENT_VERSION_ID_PATTERN),
      to_agent_id: safePattern(row.to_agent_id, AGENT_ID_PATTERN),
      to_agent_version_id: safePattern(row.to_agent_version_id, AGENT_VERSION_ID_PATTERN),
      owner_id: safePattern(row.owner_id, OWNER_ID_PATTERN),
      project_id: safePattern(row.project_id, PROJECT_ID_PATTERN),
      parent_conversation_id: safePattern(row.parent_conversation_id, CONVERSATION_ID_PATTERN),
      parent_task_id: safePattern(row.parent_task_id, TASK_ID_PATTERN),
      parent_run_id: safePattern(row.parent_run_id, RUN_ID_PATTERN),
      child_conversation_id: safePattern(row.child_conversation_id, CONVERSATION_ID_PATTERN),
      child_task_id: safePattern(row.child_task_id, TASK_ID_PATTERN),
      child_run_id: safePattern(row.child_run_id, RUN_ID_PATTERN),
      lease_holder_id: safePattern(row.lease_holder_id, SUPERVISOR_ID_PATTERN),
      admitted_at_ms: safeTimestamp(row.admitted_at_ms),
      result_status: row.result_status,
      result_summary_code: row.result_summary_code,
      admission_status: row.admission_status,
      admission_summary_code: row.admission_summary_code,
      admission_contract: row.admission_contract,
      parent_review_contract: row.parent_review_contract,
      parent_materialization_boundary: row.parent_materialization_boundary,
    });
    if (
      rowFacts.delegation_result_admission_id !== admission.delegation_result_admission_id
      || rowFacts.delegation_result_id !== admission.delegation_result_id
      || rowFacts.delegation_id !== admission.delegation_id
      || rowFacts.delegation_definition_digest !== admission.delegation_definition_digest
      || rowFacts.target_definition_digest !== admission.target_definition_digest
      || rowFacts.delegation_result_digest !== admission.delegation_result_digest
      || rowFacts.record_version !== BUILDER_AGENT_DELEGATION_RESULT_ADMISSION_RECORD_VERSION
      || rowFacts.record_version !== admission.record_version
      || rowFacts.parent_assignment_id !== admission.parent_assignment_id
      || rowFacts.parent_assignment_status_id !== admission.parent_assignment_status_id
      || rowFacts.parent_lease_id !== admission.parent_lease_id
      || rowFacts.from_agent_id !== admission.from_agent_id
      || rowFacts.from_agent_version_id !== admission.from_agent_version_id
      || rowFacts.to_agent_id !== admission.to_agent_id
      || rowFacts.to_agent_version_id !== admission.to_agent_version_id
      || rowFacts.owner_id !== admission.owner_id
      || rowFacts.project_id !== admission.project_id
      || rowFacts.parent_conversation_id !== admission.parent_conversation_id
      || rowFacts.parent_task_id !== admission.parent_task_id
      || rowFacts.parent_run_id !== admission.parent_run_id
      || rowFacts.child_conversation_id !== admission.child_conversation_id
      || rowFacts.child_task_id !== admission.child_task_id
      || rowFacts.child_run_id !== admission.child_run_id
      || rowFacts.lease_holder_id !== admission.lease_holder_id
      || rowFacts.admitted_at_ms !== admission.admitted_at_ms
      || rowFacts.result_status !== admission.result.status
      || rowFacts.result_summary_code !== admission.result.summary_code
      || rowFacts.admission_status !== admission.admission_status
      || rowFacts.admission_summary_code !== admission.admission_summary_code
      || rowFacts.admission_contract !== admission.admission_contract
      || rowFacts.parent_review_contract !== admission.parent_review_contract
      || rowFacts.parent_materialization_boundary !== admission.parent_materialization_boundary
    ) fail('builder_agent_delegation_result_admission_store_integrity_failed');
    return freezeDeep({ admission, delegation, result });
  } catch (error) {
    if (
      error instanceof BuilderAgentDelegationResultAdmissionStoreError
      || error instanceof BuilderAgentDelegationResultAdmissionContractError
    ) fail('builder_agent_delegation_result_admission_store_integrity_failed');
    throw error;
  }
}

function loadEntryByAdmissionId(db, admissionId) {
  return entryFromRow(one(
    db,
    `SELECT ${admissionColumns()} FROM agent_delegation_result_admissions
      WHERE delegation_result_admission_id = ?`,
    [admissionId],
  ));
}

function loadEntryByResultId(db, delegationResultId) {
  return entryFromRow(one(
    db,
    `SELECT ${admissionColumns()} FROM agent_delegation_result_admissions
      WHERE delegation_result_id = ?`,
    [delegationResultId],
  ));
}

function parentTaskEntries(db, ownerId, projectId, parentTaskId) {
  const rows = all(
    db,
    `SELECT ${admissionColumns()}
      FROM agent_delegation_result_admissions
      WHERE owner_id = ? AND project_id = ? AND parent_task_id = ?
      ORDER BY admitted_at_ms ASC, delegation_result_admission_id ASC
      LIMIT ?`,
    [ownerId, projectId, parentTaskId, MAX_TASK_ADMISSIONS + 1],
  );
  if (rows.length > MAX_TASK_ADMISSIONS) {
    fail('builder_agent_delegation_result_admission_store_resource_exceeded');
  }
  return freezeDeep(rows.map(entryFromRow));
}

function childTaskEntries(db, ownerId, projectId, childTaskId) {
  const rows = all(
    db,
    `SELECT ${admissionColumns()}
      FROM agent_delegation_result_admissions
      WHERE owner_id = ? AND project_id = ? AND child_task_id = ?
      ORDER BY admitted_at_ms ASC, delegation_result_admission_id ASC
      LIMIT ?`,
    [ownerId, projectId, childTaskId, MAX_TASK_ADMISSIONS + 1],
  );
  if (rows.length > MAX_TASK_ADMISSIONS) {
    fail('builder_agent_delegation_result_admission_store_resource_exceeded');
  }
  return freezeDeep(rows.map(entryFromRow));
}

function sameFact(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function sameEntry(left, right) {
  return sameFact(left.delegation, right.delegation)
    && sameFact(left.result, right.result)
    && sameFact(left.admission, right.admission);
}

function evidence(db, transaction) {
  return freezeDeep({
    database_id: DATABASE_ID,
    schema_version: BUILDER_AGENT_DELEGATION_RESULT_ADMISSION_STORE_SCHEMA_VERSION,
    user_version: BUILDER_AGENT_DELEGATION_RESULT_ADMISSION_STORE_USER_VERSION,
    schema_fingerprint_digest: sha256Canonical(collectSchemaFingerprint(db)),
    runtime_pragmas: runtimePragmas(db),
    transaction,
    delegation_result_admission_authority: 'main_owned_agent_delegation_result_admission_store',
    renderer_authority: 'not_present',
    ipc_authority: 'not_present',
    child_assignment_authority: false,
    model_dispatch: false,
    tool_dispatch: false,
    permission_grant_authority: false,
    credential_storage: 'not_present',
    source_read: 'not_present',
    source_write: 'not_present',
    process_run: false,
    network_access: false,
    revision_authority: false,
    review_authority: false,
    artifact_authority: false,
  });
}

function storeResult(db, operation, payload) {
  return freezeDeep({
    result_version: BUILDER_AGENT_DELEGATION_RESULT_ADMISSION_STORE_RESULT_VERSION,
    operation,
    ...payload,
    delegation_result_admission_evidence: evidence(db, operation),
  });
}

function insertAdmission(db, entry) {
  const admission = entry.admission;
  run(db, `INSERT INTO agent_delegation_result_admissions (
    delegation_result_admission_id, delegation_result_id, delegation_id,
    delegation_definition_digest, target_definition_digest, delegation_result_digest,
    record_version, parent_assignment_id, parent_assignment_status_id,
    parent_lease_id, from_agent_id, from_agent_version_id, to_agent_id,
    to_agent_version_id, owner_id, project_id, parent_conversation_id,
    parent_task_id, parent_run_id, child_conversation_id, child_task_id,
    child_run_id, lease_holder_id, admitted_at_ms, result_status,
    result_summary_code, admission_status, admission_summary_code,
    admission_contract, parent_review_contract, parent_materialization_boundary,
    delegation_json, result_json, admission_json, schema_version
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
    admission.delegation_result_admission_id,
    admission.delegation_result_id,
    admission.delegation_id,
    admission.delegation_definition_digest,
    admission.target_definition_digest,
    admission.delegation_result_digest,
    admission.record_version,
    admission.parent_assignment_id,
    admission.parent_assignment_status_id,
    admission.parent_lease_id,
    admission.from_agent_id,
    admission.from_agent_version_id,
    admission.to_agent_id,
    admission.to_agent_version_id,
    admission.owner_id,
    admission.project_id,
    admission.parent_conversation_id,
    admission.parent_task_id,
    admission.parent_run_id,
    admission.child_conversation_id,
    admission.child_task_id,
    admission.child_run_id,
    admission.lease_holder_id,
    admission.admitted_at_ms,
    admission.result.status,
    admission.result.summary_code,
    admission.admission_status,
    admission.admission_summary_code,
    admission.admission_contract,
    admission.parent_review_contract,
    admission.parent_materialization_boundary,
    canonicalJson(entry.delegation),
    canonicalJson(entry.result),
    canonicalJson(admission),
    BUILDER_AGENT_DELEGATION_RESULT_ADMISSION_STORE_SCHEMA_VERSION,
  ]);
}

function recordDelegationResultAdmission(db, rawRequest) {
  const requested = sanitizeAdmissionRequest(rawRequest);
  db.exec('BEGIN IMMEDIATE');
  try {
    const existing = loadEntryByAdmissionId(db, requested.admission.delegation_result_admission_id);
    if (existing !== null) {
      if (!sameEntry(existing, requested)) {
        fail('builder_agent_delegation_result_admission_store_conflict');
      }
      db.exec('COMMIT');
      return storeResult(db, 'delegation_result_admission_replayed', {
        delegation_result_admission: existing,
      });
    }
    if (loadEntryByResultId(db, requested.admission.delegation_result_id) !== null) {
      fail('builder_agent_delegation_result_admission_store_conflict');
    }
    insertAdmission(db, requested);
    const readback = loadEntryByAdmissionId(db, requested.admission.delegation_result_admission_id);
    if (readback === null || !sameEntry(readback, requested)) {
      fail('builder_agent_delegation_result_admission_store_integrity_failed');
    }
    db.exec('COMMIT');
    return storeResult(db, 'delegation_result_admission_recorded', {
      delegation_result_admission: readback,
    });
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* fixed failure below */ }
    throw error;
  }
}

function readyReadResult(db, entry, transaction) {
  return freezeDeep({
    result_version: BUILDER_AGENT_DELEGATION_RESULT_ADMISSION_STORE_READ_RESULT_VERSION,
    delegation_result_admission_authority: 'main_owned_agent_delegation_result_admission_store',
    status: 'ready',
    delegation_result_admission: entry,
    evidence: evidence(db, transaction),
  });
}

function absentReadResult(db, payload, transaction) {
  return freezeDeep({
    result_version: BUILDER_AGENT_DELEGATION_RESULT_ADMISSION_STORE_READ_RESULT_VERSION,
    delegation_result_admission_authority: 'main_owned_agent_delegation_result_admission_store',
    status: 'absent',
    ...payload,
    delegation_result_admission: null,
    evidence: evidence(db, transaction),
  });
}

function readDelegationResultAdmission(db, rawRequest) {
  exactObject(rawRequest, READ_ADMISSION_KEYS);
  const admissionId = safeDelegationResultAdmissionId(valueAt(rawRequest, 'delegation_result_admission_id'));
  const ownerId = safeOwnerId(valueAt(rawRequest, 'owner_id'));
  const entry = loadEntryByAdmissionId(db, admissionId);
  if (entry === null || entry.admission.owner_id !== ownerId) {
    return absentReadResult(db, {
      delegation_result_admission_id: admissionId,
      owner_id: ownerId,
    }, 'delegation_result_admission_absent_read');
  }
  return freezeDeep({
    ...readyReadResult(db, entry, 'delegation_result_admission_ready_read'),
    delegation_result_admission_id: admissionId,
    owner_id: ownerId,
  });
}

function readDelegationResultAdmissionForResult(db, rawRequest) {
  exactObject(rawRequest, READ_ADMISSION_BY_RESULT_KEYS);
  const resultId = safeDelegationResultId(valueAt(rawRequest, 'delegation_result_id'));
  const ownerId = safeOwnerId(valueAt(rawRequest, 'owner_id'));
  const entry = loadEntryByResultId(db, resultId);
  if (entry === null || entry.admission.owner_id !== ownerId) {
    return absentReadResult(db, {
      delegation_result_id: resultId,
      owner_id: ownerId,
    }, 'delegation_result_admission_for_result_absent_read');
  }
  return freezeDeep({
    ...readyReadResult(db, entry, 'delegation_result_admission_for_result_ready_read'),
    delegation_result_id: resultId,
    owner_id: ownerId,
  });
}

function listParentTaskDelegationResultAdmissions(db, rawRequest) {
  exactObject(rawRequest, LIST_PARENT_TASK_ADMISSIONS_KEYS);
  const ownerId = safeOwnerId(valueAt(rawRequest, 'owner_id'));
  const projectId = safeProjectId(valueAt(rawRequest, 'project_id'));
  const parentTaskId = safeTaskId(valueAt(rawRequest, 'parent_task_id'));
  const admissions = parentTaskEntries(db, ownerId, projectId, parentTaskId);
  return freezeDeep({
    result_version: BUILDER_AGENT_DELEGATION_RESULT_ADMISSION_STORE_READ_RESULT_VERSION,
    delegation_result_admission_authority: 'main_owned_agent_delegation_result_admission_store',
    status: admissions.length === 0 ? 'absent' : 'ready',
    owner_id: ownerId,
    project_id: projectId,
    parent_task_id: parentTaskId,
    delegation_result_admissions: admissions,
    evidence: evidence(db, admissions.length === 0
      ? 'parent_task_delegation_result_admissions_absent_read'
      : 'parent_task_delegation_result_admissions_ready_read'),
  });
}

function listChildTaskDelegationResultAdmissions(db, rawRequest) {
  exactObject(rawRequest, LIST_CHILD_TASK_ADMISSIONS_KEYS);
  const ownerId = safeOwnerId(valueAt(rawRequest, 'owner_id'));
  const projectId = safeProjectId(valueAt(rawRequest, 'project_id'));
  const childTaskId = safeTaskId(valueAt(rawRequest, 'child_task_id'));
  const admissions = childTaskEntries(db, ownerId, projectId, childTaskId);
  return freezeDeep({
    result_version: BUILDER_AGENT_DELEGATION_RESULT_ADMISSION_STORE_READ_RESULT_VERSION,
    delegation_result_admission_authority: 'main_owned_agent_delegation_result_admission_store',
    status: admissions.length === 0 ? 'absent' : 'ready',
    owner_id: ownerId,
    project_id: projectId,
    child_task_id: childTaskId,
    delegation_result_admissions: admissions,
    evidence: evidence(db, admissions.length === 0
      ? 'child_task_delegation_result_admissions_absent_read'
      : 'child_task_delegation_result_admissions_ready_read'),
  });
}

function ownErrorField(error, key) {
  if (!error || typeof error !== 'object' || utilTypes.isProxy(error)) return null;
  const descriptor = Object.getOwnPropertyDescriptor(error, key);
  return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : null;
}

function normalizeOperationError(error) {
  if (error instanceof BuilderAgentDelegationResultAdmissionStoreError) {
    return new BuilderAgentDelegationResultAdmissionStoreError(error.code);
  }
  if (error instanceof BuilderAgentDelegationResultAdmissionContractError) {
    return new BuilderAgentDelegationResultAdmissionStoreError(
      'builder_agent_delegation_result_admission_store_invalid',
    );
  }
  const sqliteCode = ownErrorField(error, 'code');
  const sqliteErrstr = ownErrorField(error, 'errstr');
  const sqliteErrcode = ownErrorField(error, 'errcode');
  if (sqliteCode && /^SQLITE_CONSTRAINT/u.test(sqliteCode)) {
    return new BuilderAgentDelegationResultAdmissionStoreError(
      'builder_agent_delegation_result_admission_store_integrity_failed',
    );
  }
  if (sqliteErrstr === 'constraint failed' || sqliteErrcode === 1555) {
    return new BuilderAgentDelegationResultAdmissionStoreError(
      'builder_agent_delegation_result_admission_store_integrity_failed',
    );
  }
  if (sqliteCode && /^SQLITE_(CORRUPT|NOTADB|SCHEMA|INTERNAL|MISMATCH)/u.test(sqliteCode)) {
    return new BuilderAgentDelegationResultAdmissionStoreError(
      'builder_agent_delegation_result_admission_store_integrity_failed',
    );
  }
  return new BuilderAgentDelegationResultAdmissionStoreError(
    'builder_agent_delegation_result_admission_store_unavailable',
  );
}

function createBuilderAgentDelegationResultAdmissionStore(databasePath) {
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
    store_version: BUILDER_AGENT_DELEGATION_RESULT_ADMISSION_STORE_VERSION,

    close(...rawArguments) {
      if (rawArguments.length !== 0) {
        throw new BuilderAgentDelegationResultAdmissionStoreError(
          'builder_agent_delegation_result_admission_store_invalid',
        );
      }
      try { db.close(); } catch (error) { throw normalizeOperationError(error); }
    },

    record_admission(rawRequest) {
      try { return recordDelegationResultAdmission(db, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },

    read_admission(rawRequest) {
      try { return readDelegationResultAdmission(db, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },

    read_admission_for_result(rawRequest) {
      try { return readDelegationResultAdmissionForResult(db, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },

    list_parent_task_admissions(rawRequest) {
      try { return listParentTaskDelegationResultAdmissions(db, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },

    list_child_task_admissions(rawRequest) {
      try { return listChildTaskDelegationResultAdmissions(db, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },
  });
}

module.exports = Object.freeze({
  BUILDER_AGENT_DELEGATION_RESULT_ADMISSION_STORE_READ_RESULT_VERSION,
  BUILDER_AGENT_DELEGATION_RESULT_ADMISSION_STORE_RESULT_VERSION,
  BUILDER_AGENT_DELEGATION_RESULT_ADMISSION_STORE_SCHEMA_VERSION,
  BUILDER_AGENT_DELEGATION_RESULT_ADMISSION_STORE_USER_VERSION,
  BUILDER_AGENT_DELEGATION_RESULT_ADMISSION_STORE_VERSION,
  BuilderAgentDelegationResultAdmissionStoreError,
  createBuilderAgentDelegationResultAdmissionStore,
});
