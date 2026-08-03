'use strict';

const nodeCrypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { types: utilTypes } = require('node:util');

const {
  BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_RECORD_VERSION,
  BuilderAgentDelegationResultParentMaterializationError,
  sanitizeBuilderAgentDelegationResultParentMaterializationRecord,
} = require('./builder-agent-delegation-result-parent-materialization.cjs');

const BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_STORE_VERSION =
  'builder-agent-delegation-result-parent-materialization-store.v1';
const BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_STORE_RESULT_VERSION =
  'builder-agent-delegation-result-parent-materialization-store-result.v1';
const BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_STORE_READ_RESULT_VERSION =
  'builder-agent-delegation-result-parent-materialization-store-read-result.v1';
const BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_STORE_SCHEMA_VERSION =
  'builder-agent-delegation-result-parent-materialization-store-schema.v1';
const BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_STORE_USER_VERSION = 1;
const DATABASE_ID = 'builder-agent-delegation-result-parent-materialization-store.v1';
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
const DELEGATION_RESULT_REVIEW_ID_PATTERN =
  /^builder-agent-delegation-result-review:[0-9a-f]{64}$/u;
const ELIGIBILITY_ID_PATTERN =
  /^builder-agent-delegation-result-parent-materialization-eligibility:[0-9a-f]{64}$/u;
const MATERIALIZATION_ID_PATTERN =
  /^builder-agent-delegation-result-parent-materialization:[0-9a-f]{64}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const RECORD_MATERIALIZATION_KEYS = Object.freeze([
  'delegation',
  'result',
  'admission',
  'review',
  'eligibility',
  'materialization',
]);
const READ_MATERIALIZATION_KEYS = Object.freeze(['delegation_result_parent_materialization_id', 'owner_id']);
const READ_MATERIALIZATION_BY_ELIGIBILITY_KEYS = Object.freeze([
  'delegation_result_parent_materialization_eligibility_id',
  'owner_id',
]);
const LIST_PARENT_TASK_MATERIALIZATIONS_KEYS = Object.freeze(['owner_id', 'project_id', 'parent_task_id']);
const LIST_CHILD_TASK_MATERIALIZATIONS_KEYS = Object.freeze(['owner_id', 'project_id', 'child_task_id']);
const MAX_TASK_MATERIALIZATIONS = 128;
const MAX_RECEIPT_JSON_BYTES = 80 * 1024;
const CREATE_SCHEMA_SQL = Object.freeze([
  `CREATE TABLE agent_delegation_result_parent_materializations (
    delegation_result_parent_materialization_id TEXT NOT NULL PRIMARY KEY,
    delegation_result_parent_materialization_eligibility_id TEXT NOT NULL,
    delegation_result_review_id TEXT NOT NULL,
    delegation_result_admission_id TEXT NOT NULL,
    delegation_result_id TEXT NOT NULL,
    delegation_id TEXT NOT NULL,
    delegation_result_parent_materialization_eligibility_digest TEXT NOT NULL,
    delegation_result_review_digest TEXT NOT NULL,
    delegation_result_admission_digest TEXT NOT NULL,
    delegation_result_digest TEXT NOT NULL,
    delegation_definition_digest TEXT NOT NULL,
    target_definition_digest TEXT NOT NULL,
    record_version TEXT NOT NULL,
    record_kind TEXT NOT NULL,
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
    materialized_by TEXT NOT NULL,
    materialized_at_ms INTEGER NOT NULL,
    result_status TEXT NOT NULL,
    result_summary_code TEXT NOT NULL,
    decision TEXT NOT NULL,
    eligibility_status TEXT NOT NULL,
    parent_context_status TEXT NOT NULL,
    materialization_summary_code TEXT NOT NULL,
    materialization_contract TEXT NOT NULL,
    parent_materialization_boundary TEXT NOT NULL,
    delegation_json TEXT NOT NULL,
    result_json TEXT NOT NULL,
    admission_json TEXT NOT NULL,
    review_json TEXT NOT NULL,
    eligibility_json TEXT NOT NULL,
    materialization_json TEXT NOT NULL,
    schema_version TEXT NOT NULL,
    UNIQUE (delegation_result_parent_materialization_eligibility_id),
    UNIQUE (delegation_result_review_id),
    UNIQUE (delegation_result_admission_id),
    UNIQUE (delegation_result_id),
    CHECK (schema_version = 'builder-agent-delegation-result-parent-materialization-store-schema.v1'),
    CHECK (record_version = 'builder-agent-delegation-result-parent-materialization-record.v1'),
    CHECK (record_kind = 'builder_agent_delegation_result_parent_materialization_record'),
    CHECK (materialized_at_ms >= 0),
    CHECK (materialized_by = owner_id),
    CHECK (result_status = 'proposed'),
    CHECK (result_summary_code = 'delegated_child_result_ready_for_parent_review'),
    CHECK (decision = 'approved_for_parent_materialization'),
    CHECK (eligibility_status = 'eligible_for_parent_materialization_gate'),
    CHECK (parent_context_status = 'materialized_as_parent_task_context_receipt'),
    CHECK (materialization_summary_code = 'delegated_child_result_materialized_as_parent_context_receipt'),
    CHECK (materialization_contract = 'approved_delegated_result_recorded_as_parent_task_context_receipt'),
    CHECK (parent_materialization_boundary = 'no_source_no_artifact_no_revision_mutation'),
    CHECK (length(delegation_json) BETWEEN 2 AND 81920),
    CHECK (length(result_json) BETWEEN 2 AND 81920),
    CHECK (length(admission_json) BETWEEN 2 AND 81920),
    CHECK (length(review_json) BETWEEN 2 AND 81920),
    CHECK (length(eligibility_json) BETWEEN 2 AND 81920),
    CHECK (length(materialization_json) BETWEEN 2 AND 81920)
  ) STRICT`,
  'CREATE INDEX agent_delegation_result_parent_materializations_parent_task_idx ON agent_delegation_result_parent_materializations(owner_id, project_id, parent_task_id, materialized_at_ms, delegation_result_parent_materialization_id)',
  'CREATE INDEX agent_delegation_result_parent_materializations_child_task_idx ON agent_delegation_result_parent_materializations(owner_id, project_id, child_task_id, materialized_at_ms, delegation_result_parent_materialization_id)',
  'CREATE INDEX agent_delegation_result_parent_materializations_eligibility_idx ON agent_delegation_result_parent_materializations(owner_id, delegation_result_parent_materialization_eligibility_id)',
]);
const ERROR_MESSAGES = Object.freeze({
  builder_agent_delegation_result_parent_materialization_store_invalid:
    'Builder agent delegation result parent materialization could not be verified.',
  builder_agent_delegation_result_parent_materialization_store_not_found:
    'Builder agent delegation result parent materialization is unavailable.',
  builder_agent_delegation_result_parent_materialization_store_conflict:
    'Builder agent delegation result parent materialization changed before it could be recorded.',
  builder_agent_delegation_result_parent_materialization_store_integrity_failed:
    'Builder agent delegation result parent materialization integrity could not be verified.',
  builder_agent_delegation_result_parent_materialization_store_resource_exceeded:
    'Builder agent delegation result parent materialization limits were reached.',
  builder_agent_delegation_result_parent_materialization_store_unavailable:
    'Builder agent delegation result parent materialization storage is unavailable.',
});

class BuilderAgentDelegationResultParentMaterializationStoreError extends Error {
  constructor(code = 'builder_agent_delegation_result_parent_materialization_store_invalid') {
    const selected = Object.hasOwn(ERROR_MESSAGES, code)
      ? code
      : 'builder_agent_delegation_result_parent_materialization_store_invalid';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderAgentDelegationResultParentMaterializationStoreError';
    this.code = selected;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) {
  throw new BuilderAgentDelegationResultParentMaterializationStoreError(code);
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
  if (!isPlainObject(value)) fail('builder_agent_delegation_result_parent_materialization_store_invalid');
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== keys.length
    || actual.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) fail('builder_agent_delegation_result_parent_materialization_store_invalid');
  for (const key of actual) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      fail('builder_agent_delegation_result_parent_materialization_store_invalid');
    }
  }
}

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
    fail('builder_agent_delegation_result_parent_materialization_store_invalid');
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
  fail('builder_agent_delegation_result_parent_materialization_store_invalid');
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
    fail('builder_agent_delegation_result_parent_materialization_store_invalid');
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

function safeEligibilityId(value) {
  return safePattern(value, ELIGIBILITY_ID_PATTERN);
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail('builder_agent_delegation_result_parent_materialization_store_invalid');
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
  ) fail('builder_agent_delegation_result_parent_materialization_store_invalid');
  return value;
}

function assertParentDirectory(filePath) {
  let info;
  try {
    info = fs.lstatSync(path.dirname(filePath));
  } catch {
    fail('builder_agent_delegation_result_parent_materialization_store_unavailable');
  }
  if (!info.isDirectory() || info.isSymbolicLink()) {
    fail('builder_agent_delegation_result_parent_materialization_store_unavailable');
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
    fail('builder_agent_delegation_result_parent_materialization_store_integrity_failed');
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
  if (mode !== 'wal') fail('builder_agent_delegation_result_parent_materialization_store_unavailable');
  const pragmas = runtimePragmas(db);
  if (
    pragmas.foreign_keys !== 'on'
    || pragmas.trusted_schema !== 'off'
    || pragmas.synchronous !== 'full'
    || pragmas.journal_mode !== 'wal'
  ) fail('builder_agent_delegation_result_parent_materialization_store_unavailable');
}

function createSchema(db) {
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const sql of CREATE_SCHEMA_SQL) db.exec(sql);
    db.exec(`PRAGMA user_version = ${
      BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_STORE_USER_VERSION
    }`);
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
    expectedDb.exec(`PRAGMA user_version = ${
      BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_STORE_USER_VERSION
    }`);
    expectedSchemaFingerprint = canonicalJson(collectSchemaFingerprint(expectedDb));
    return expectedSchemaFingerprint;
  } finally {
    expectedDb.close();
  }
}

function validateSchema(db) {
  const actual = collectSchemaFingerprint(db);
  if (actual.foreign_key_check.length !== 0) {
    fail('builder_agent_delegation_result_parent_materialization_store_integrity_failed');
  }
  if (canonicalJson(actual) !== expectedFingerprint()) {
    fail('builder_agent_delegation_result_parent_materialization_store_integrity_failed');
  }
}

function initialize(db) {
  configurePragmas(db);
  const version = userVersion(db);
  if (version === 0) createSchema(db);
  else if (version !== BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_STORE_USER_VERSION) {
    fail('builder_agent_delegation_result_parent_materialization_store_integrity_failed');
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
    if (error instanceof BuilderAgentDelegationResultParentMaterializationStoreError) fail(code);
    throw error;
  }
  return parsed;
}

function sanitizeMaterializationRequest(value) {
  exactObject(value, RECORD_MATERIALIZATION_KEYS);
  const delegation = valueAt(value, 'delegation');
  const result = valueAt(value, 'result');
  const admission = valueAt(value, 'admission');
  const review = valueAt(value, 'review');
  const eligibility = valueAt(value, 'eligibility');
  const materialization = valueAt(value, 'materialization');
  try {
    return freezeDeep({
      delegation,
      result,
      admission,
      review,
      eligibility,
      materialization: sanitizeBuilderAgentDelegationResultParentMaterializationRecord(
        materialization,
        eligibility,
        review,
        admission,
        result,
        delegation,
      ),
    });
  } catch (error) {
    if (error instanceof BuilderAgentDelegationResultParentMaterializationError) {
      fail('builder_agent_delegation_result_parent_materialization_store_invalid');
    }
    throw error;
  }
}

function materializationColumns() {
  return `delegation_result_parent_materialization_id,
    delegation_result_parent_materialization_eligibility_id,
    delegation_result_review_id, delegation_result_admission_id,
    delegation_result_id, delegation_id,
    delegation_result_parent_materialization_eligibility_digest,
    delegation_result_review_digest, delegation_result_admission_digest,
    delegation_result_digest, delegation_definition_digest,
    target_definition_digest, record_version, record_kind,
    parent_assignment_id, parent_assignment_status_id, parent_lease_id,
    from_agent_id, from_agent_version_id, to_agent_id, to_agent_version_id,
    owner_id, project_id, parent_conversation_id, parent_task_id,
    parent_run_id, child_conversation_id, child_task_id, child_run_id,
    lease_holder_id, materialized_by, materialized_at_ms, result_status,
    result_summary_code, decision, eligibility_status, parent_context_status,
    materialization_summary_code, materialization_contract,
    parent_materialization_boundary, delegation_json, result_json,
    admission_json, review_json, eligibility_json, materialization_json`;
}

function safeRowFacts(row) {
  return freezeDeep({
    delegation_result_parent_materialization_id: safePattern(
      row.delegation_result_parent_materialization_id,
      MATERIALIZATION_ID_PATTERN,
    ),
    delegation_result_parent_materialization_eligibility_id: safePattern(
      row.delegation_result_parent_materialization_eligibility_id,
      ELIGIBILITY_ID_PATTERN,
    ),
    delegation_result_review_id: safePattern(row.delegation_result_review_id, DELEGATION_RESULT_REVIEW_ID_PATTERN),
    delegation_result_admission_id: safePattern(
      row.delegation_result_admission_id,
      DELEGATION_RESULT_ADMISSION_ID_PATTERN,
    ),
    delegation_result_id: safePattern(row.delegation_result_id, DELEGATION_RESULT_ID_PATTERN),
    delegation_id: safePattern(row.delegation_id, DELEGATION_ID_PATTERN),
    delegation_result_parent_materialization_eligibility_digest: safePattern(
      row.delegation_result_parent_materialization_eligibility_digest,
      DIGEST_PATTERN,
    ),
    delegation_result_review_digest: safePattern(row.delegation_result_review_digest, DIGEST_PATTERN),
    delegation_result_admission_digest: safePattern(row.delegation_result_admission_digest, DIGEST_PATTERN),
    delegation_result_digest: safePattern(row.delegation_result_digest, DIGEST_PATTERN),
    delegation_definition_digest: safePattern(row.delegation_definition_digest, DIGEST_PATTERN),
    target_definition_digest: safePattern(row.target_definition_digest, DIGEST_PATTERN),
    record_version: row.record_version,
    record_kind: row.record_kind,
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
    materialized_by: safePattern(row.materialized_by, OWNER_ID_PATTERN),
    materialized_at_ms: safeTimestamp(row.materialized_at_ms),
    result_status: row.result_status,
    result_summary_code: row.result_summary_code,
    decision: row.decision,
    eligibility_status: row.eligibility_status,
    parent_context_status: row.parent_context_status,
    materialization_summary_code: row.materialization_summary_code,
    materialization_contract: row.materialization_contract,
    parent_materialization_boundary: row.parent_materialization_boundary,
  });
}

function entryFromRow(row) {
  if (!row) return null;
  try {
    const delegation = parseCanonicalReceipt(
      row.delegation_json,
      'builder_agent_delegation_result_parent_materialization_store_integrity_failed',
    );
    const result = parseCanonicalReceipt(
      row.result_json,
      'builder_agent_delegation_result_parent_materialization_store_integrity_failed',
    );
    const admission = parseCanonicalReceipt(
      row.admission_json,
      'builder_agent_delegation_result_parent_materialization_store_integrity_failed',
    );
    const review = parseCanonicalReceipt(
      row.review_json,
      'builder_agent_delegation_result_parent_materialization_store_integrity_failed',
    );
    const eligibility = parseCanonicalReceipt(
      row.eligibility_json,
      'builder_agent_delegation_result_parent_materialization_store_integrity_failed',
    );
    const parsedMaterialization = parseCanonicalReceipt(
      row.materialization_json,
      'builder_agent_delegation_result_parent_materialization_store_integrity_failed',
    );
    const materialization = sanitizeBuilderAgentDelegationResultParentMaterializationRecord(
      parsedMaterialization,
      eligibility,
      review,
      admission,
      result,
      delegation,
    );
    const rowFacts = safeRowFacts(row);
    if (
      rowFacts.delegation_result_parent_materialization_id
        !== materialization.delegation_result_parent_materialization_id
      || rowFacts.delegation_result_parent_materialization_eligibility_id
        !== materialization.delegation_result_parent_materialization_eligibility_id
      || rowFacts.delegation_result_review_id !== materialization.delegation_result_review_id
      || rowFacts.delegation_result_admission_id !== materialization.delegation_result_admission_id
      || rowFacts.delegation_result_id !== materialization.delegation_result_id
      || rowFacts.delegation_id !== materialization.delegation_id
      || rowFacts.delegation_result_parent_materialization_eligibility_digest
        !== materialization.delegation_result_parent_materialization_eligibility_digest
      || rowFacts.delegation_result_review_digest !== materialization.delegation_result_review_digest
      || rowFacts.delegation_result_admission_digest !== materialization.delegation_result_admission_digest
      || rowFacts.delegation_result_digest !== materialization.delegation_result_digest
      || rowFacts.delegation_definition_digest !== materialization.delegation_definition_digest
      || rowFacts.target_definition_digest !== materialization.target_definition_digest
      || rowFacts.record_version !== BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_RECORD_VERSION
      || rowFacts.record_version !== materialization.record_version
      || rowFacts.record_kind !== materialization.record_kind
      || rowFacts.parent_assignment_id !== materialization.parent_assignment_id
      || rowFacts.parent_assignment_status_id !== materialization.parent_assignment_status_id
      || rowFacts.parent_lease_id !== materialization.parent_lease_id
      || rowFacts.from_agent_id !== materialization.from_agent_id
      || rowFacts.from_agent_version_id !== materialization.from_agent_version_id
      || rowFacts.to_agent_id !== materialization.to_agent_id
      || rowFacts.to_agent_version_id !== materialization.to_agent_version_id
      || rowFacts.owner_id !== materialization.owner_id
      || rowFacts.project_id !== materialization.project_id
      || rowFacts.parent_conversation_id !== materialization.parent_conversation_id
      || rowFacts.parent_task_id !== materialization.parent_task_id
      || rowFacts.parent_run_id !== materialization.parent_run_id
      || rowFacts.child_conversation_id !== materialization.child_conversation_id
      || rowFacts.child_task_id !== materialization.child_task_id
      || rowFacts.child_run_id !== materialization.child_run_id
      || rowFacts.lease_holder_id !== materialization.lease_holder_id
      || rowFacts.materialized_by !== materialization.materialized_by
      || rowFacts.materialized_at_ms !== materialization.materialized_at_ms
      || rowFacts.result_status !== materialization.result.status
      || rowFacts.result_summary_code !== materialization.result.summary_code
      || rowFacts.decision !== materialization.decision
      || rowFacts.eligibility_status !== materialization.eligibility_status
      || rowFacts.parent_context_status !== materialization.parent_context_status
      || rowFacts.materialization_summary_code !== materialization.materialization_summary_code
      || rowFacts.materialization_contract !== materialization.materialization_contract
      || rowFacts.parent_materialization_boundary !== materialization.parent_materialization_boundary
    ) fail('builder_agent_delegation_result_parent_materialization_store_integrity_failed');
    return freezeDeep({ admission, delegation, eligibility, materialization, result, review });
  } catch (error) {
    if (
      error instanceof BuilderAgentDelegationResultParentMaterializationStoreError
      || error instanceof BuilderAgentDelegationResultParentMaterializationError
    ) fail('builder_agent_delegation_result_parent_materialization_store_integrity_failed');
    throw error;
  }
}

function loadEntryByMaterializationId(db, materializationId) {
  return entryFromRow(one(
    db,
    `SELECT ${materializationColumns()} FROM agent_delegation_result_parent_materializations
      WHERE delegation_result_parent_materialization_id = ?`,
    [materializationId],
  ));
}

function loadEntryByEligibilityId(db, eligibilityId) {
  return entryFromRow(one(
    db,
    `SELECT ${materializationColumns()} FROM agent_delegation_result_parent_materializations
      WHERE delegation_result_parent_materialization_eligibility_id = ?`,
    [eligibilityId],
  ));
}

function parentTaskEntries(db, ownerId, projectId, parentTaskId) {
  const rows = all(
    db,
    `SELECT ${materializationColumns()}
      FROM agent_delegation_result_parent_materializations
      WHERE owner_id = ? AND project_id = ? AND parent_task_id = ?
      ORDER BY materialized_at_ms ASC, delegation_result_parent_materialization_id ASC
      LIMIT ?`,
    [ownerId, projectId, parentTaskId, MAX_TASK_MATERIALIZATIONS + 1],
  );
  if (rows.length > MAX_TASK_MATERIALIZATIONS) {
    fail('builder_agent_delegation_result_parent_materialization_store_resource_exceeded');
  }
  return freezeDeep(rows.map(entryFromRow));
}

function childTaskEntries(db, ownerId, projectId, childTaskId) {
  const rows = all(
    db,
    `SELECT ${materializationColumns()}
      FROM agent_delegation_result_parent_materializations
      WHERE owner_id = ? AND project_id = ? AND child_task_id = ?
      ORDER BY materialized_at_ms ASC, delegation_result_parent_materialization_id ASC
      LIMIT ?`,
    [ownerId, projectId, childTaskId, MAX_TASK_MATERIALIZATIONS + 1],
  );
  if (rows.length > MAX_TASK_MATERIALIZATIONS) {
    fail('builder_agent_delegation_result_parent_materialization_store_resource_exceeded');
  }
  return freezeDeep(rows.map(entryFromRow));
}

function sameFact(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function sameEntry(left, right) {
  return sameFact(left.delegation, right.delegation)
    && sameFact(left.result, right.result)
    && sameFact(left.admission, right.admission)
    && sameFact(left.review, right.review)
    && sameFact(left.eligibility, right.eligibility)
    && sameFact(left.materialization, right.materialization);
}

function evidence(db, transaction) {
  return freezeDeep({
    database_id: DATABASE_ID,
    schema_version: BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_STORE_SCHEMA_VERSION,
    user_version: BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_STORE_USER_VERSION,
    schema_fingerprint_digest: sha256Canonical(collectSchemaFingerprint(db)),
    runtime_pragmas: runtimePragmas(db),
    transaction,
    delegation_result_parent_materialization_authority:
      'main_owned_agent_delegation_result_parent_materialization_store',
    renderer_authority: 'not_present',
    ipc_authority: 'not_present',
    child_assignment_authority: false,
    model_dispatch: false,
    tool_dispatch: false,
    permission_grant: false,
    source_read: 'not_present',
    source_write: 'not_present',
    process_run: false,
    network_access: false,
    revision_authority: false,
    review_row_authority: false,
    artifact_authority: false,
    parent_source_mutation_authority: false,
  });
}

function result(operation, entry, db, transaction) {
  return freezeDeep({
    result_version: BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_STORE_RESULT_VERSION,
    operation,
    delegation_result_parent_materialization: entry,
    delegation_result_parent_materialization_evidence: evidence(db, transaction),
  });
}

function insertMaterialization(db, entry) {
  run(
    db,
    `INSERT INTO agent_delegation_result_parent_materializations (
      delegation_result_parent_materialization_id,
      delegation_result_parent_materialization_eligibility_id,
      delegation_result_review_id,
      delegation_result_admission_id,
      delegation_result_id,
      delegation_id,
      delegation_result_parent_materialization_eligibility_digest,
      delegation_result_review_digest,
      delegation_result_admission_digest,
      delegation_result_digest,
      delegation_definition_digest,
      target_definition_digest,
      record_version,
      record_kind,
      parent_assignment_id,
      parent_assignment_status_id,
      parent_lease_id,
      from_agent_id,
      from_agent_version_id,
      to_agent_id,
      to_agent_version_id,
      owner_id,
      project_id,
      parent_conversation_id,
      parent_task_id,
      parent_run_id,
      child_conversation_id,
      child_task_id,
      child_run_id,
      lease_holder_id,
      materialized_by,
      materialized_at_ms,
      result_status,
      result_summary_code,
      decision,
      eligibility_status,
      parent_context_status,
      materialization_summary_code,
      materialization_contract,
      parent_materialization_boundary,
      delegation_json,
      result_json,
      admission_json,
      review_json,
      eligibility_json,
      materialization_json,
      schema_version
    ) VALUES (${Array.from({ length: 47 }, () => '?').join(', ')})`,
    [
      entry.materialization.delegation_result_parent_materialization_id,
      entry.materialization.delegation_result_parent_materialization_eligibility_id,
      entry.materialization.delegation_result_review_id,
      entry.materialization.delegation_result_admission_id,
      entry.materialization.delegation_result_id,
      entry.materialization.delegation_id,
      entry.materialization.delegation_result_parent_materialization_eligibility_digest,
      entry.materialization.delegation_result_review_digest,
      entry.materialization.delegation_result_admission_digest,
      entry.materialization.delegation_result_digest,
      entry.materialization.delegation_definition_digest,
      entry.materialization.target_definition_digest,
      entry.materialization.record_version,
      entry.materialization.record_kind,
      entry.materialization.parent_assignment_id,
      entry.materialization.parent_assignment_status_id,
      entry.materialization.parent_lease_id,
      entry.materialization.from_agent_id,
      entry.materialization.from_agent_version_id,
      entry.materialization.to_agent_id,
      entry.materialization.to_agent_version_id,
      entry.materialization.owner_id,
      entry.materialization.project_id,
      entry.materialization.parent_conversation_id,
      entry.materialization.parent_task_id,
      entry.materialization.parent_run_id,
      entry.materialization.child_conversation_id,
      entry.materialization.child_task_id,
      entry.materialization.child_run_id,
      entry.materialization.lease_holder_id,
      entry.materialization.materialized_by,
      entry.materialization.materialized_at_ms,
      entry.materialization.result.status,
      entry.materialization.result.summary_code,
      entry.materialization.decision,
      entry.materialization.eligibility_status,
      entry.materialization.parent_context_status,
      entry.materialization.materialization_summary_code,
      entry.materialization.materialization_contract,
      entry.materialization.parent_materialization_boundary,
      canonicalJson(entry.delegation),
      canonicalJson(entry.result),
      canonicalJson(entry.admission),
      canonicalJson(entry.review),
      canonicalJson(entry.eligibility),
      canonicalJson(entry.materialization),
      BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_STORE_SCHEMA_VERSION,
    ],
  );
}

function recordDelegationResultParentMaterialization(db, rawRequest) {
  const entry = sanitizeMaterializationRequest(rawRequest);
  const existing = loadEntryByMaterializationId(
    db,
    entry.materialization.delegation_result_parent_materialization_id,
  ) ?? loadEntryByEligibilityId(
    db,
    entry.materialization.delegation_result_parent_materialization_eligibility_id,
  );
  if (existing) {
    if (!sameEntry(existing, entry)) {
      fail('builder_agent_delegation_result_parent_materialization_store_conflict');
    }
    return result('delegation_result_parent_materialization_replayed', existing, db, 'read_existing');
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    insertMaterialization(db, entry);
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* fixed failure below */ }
    throw error;
  }
  const recorded = loadEntryByMaterializationId(
    db,
    entry.materialization.delegation_result_parent_materialization_id,
  );
  if (!recorded || !sameEntry(recorded, entry)) {
    fail('builder_agent_delegation_result_parent_materialization_store_integrity_failed');
  }
  return result('delegation_result_parent_materialization_recorded', recorded, db, 'insert_committed');
}

function readDelegationResultParentMaterialization(db, rawRequest) {
  exactObject(rawRequest, READ_MATERIALIZATION_KEYS);
  const materializationId = safeMaterializationId(valueAt(rawRequest, 'delegation_result_parent_materialization_id'));
  const ownerId = safeOwnerId(valueAt(rawRequest, 'owner_id'));
  const entry = loadEntryByMaterializationId(db, materializationId);
  const visible = entry && entry.materialization.owner_id === ownerId ? entry : null;
  return freezeDeep({
    result_version: BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_STORE_READ_RESULT_VERSION,
    delegation_result_parent_materialization_authority:
      'main_owned_agent_delegation_result_parent_materialization_store',
    status: visible ? 'ready' : 'absent',
    owner_id: ownerId,
    delegation_result_parent_materialization_id: materializationId,
    delegation_result_parent_materialization: visible,
    evidence: evidence(db, visible
      ? 'delegation_result_parent_materialization_ready_read'
      : 'delegation_result_parent_materialization_absent_read'),
  });
}

function readDelegationResultParentMaterializationForEligibility(db, rawRequest) {
  exactObject(rawRequest, READ_MATERIALIZATION_BY_ELIGIBILITY_KEYS);
  const eligibilityId = safeEligibilityId(valueAt(
    rawRequest,
    'delegation_result_parent_materialization_eligibility_id',
  ));
  const ownerId = safeOwnerId(valueAt(rawRequest, 'owner_id'));
  const entry = loadEntryByEligibilityId(db, eligibilityId);
  const visible = entry && entry.materialization.owner_id === ownerId ? entry : null;
  return freezeDeep({
    result_version: BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_STORE_READ_RESULT_VERSION,
    delegation_result_parent_materialization_authority:
      'main_owned_agent_delegation_result_parent_materialization_store',
    status: visible ? 'ready' : 'absent',
    owner_id: ownerId,
    delegation_result_parent_materialization_eligibility_id: eligibilityId,
    delegation_result_parent_materialization: visible,
    evidence: evidence(db, visible
      ? 'delegation_result_parent_materialization_for_eligibility_ready_read'
      : 'delegation_result_parent_materialization_for_eligibility_absent_read'),
  });
}

function listParentTaskDelegationResultParentMaterializations(db, rawRequest) {
  exactObject(rawRequest, LIST_PARENT_TASK_MATERIALIZATIONS_KEYS);
  const ownerId = safeOwnerId(valueAt(rawRequest, 'owner_id'));
  const projectId = safeProjectId(valueAt(rawRequest, 'project_id'));
  const parentTaskId = safeTaskId(valueAt(rawRequest, 'parent_task_id'));
  const materializations = parentTaskEntries(db, ownerId, projectId, parentTaskId);
  return freezeDeep({
    result_version: BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_STORE_READ_RESULT_VERSION,
    delegation_result_parent_materialization_authority:
      'main_owned_agent_delegation_result_parent_materialization_store',
    status: materializations.length === 0 ? 'absent' : 'ready',
    owner_id: ownerId,
    project_id: projectId,
    parent_task_id: parentTaskId,
    delegation_result_parent_materializations: materializations,
    evidence: evidence(db, materializations.length === 0
      ? 'parent_task_delegation_result_parent_materializations_absent_read'
      : 'parent_task_delegation_result_parent_materializations_ready_read'),
  });
}

function listChildTaskDelegationResultParentMaterializations(db, rawRequest) {
  exactObject(rawRequest, LIST_CHILD_TASK_MATERIALIZATIONS_KEYS);
  const ownerId = safeOwnerId(valueAt(rawRequest, 'owner_id'));
  const projectId = safeProjectId(valueAt(rawRequest, 'project_id'));
  const childTaskId = safeTaskId(valueAt(rawRequest, 'child_task_id'));
  const materializations = childTaskEntries(db, ownerId, projectId, childTaskId);
  return freezeDeep({
    result_version: BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_STORE_READ_RESULT_VERSION,
    delegation_result_parent_materialization_authority:
      'main_owned_agent_delegation_result_parent_materialization_store',
    status: materializations.length === 0 ? 'absent' : 'ready',
    owner_id: ownerId,
    project_id: projectId,
    child_task_id: childTaskId,
    delegation_result_parent_materializations: materializations,
    evidence: evidence(db, materializations.length === 0
      ? 'child_task_delegation_result_parent_materializations_absent_read'
      : 'child_task_delegation_result_parent_materializations_ready_read'),
  });
}

function ownErrorField(error, key) {
  if (!error || typeof error !== 'object' || utilTypes.isProxy(error)) return null;
  const descriptor = Object.getOwnPropertyDescriptor(error, key);
  return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : null;
}

function normalizeOperationError(error) {
  if (error instanceof BuilderAgentDelegationResultParentMaterializationStoreError) {
    return new BuilderAgentDelegationResultParentMaterializationStoreError(error.code);
  }
  if (error instanceof BuilderAgentDelegationResultParentMaterializationError) {
    return new BuilderAgentDelegationResultParentMaterializationStoreError(
      'builder_agent_delegation_result_parent_materialization_store_invalid',
    );
  }
  const sqliteCode = ownErrorField(error, 'code');
  const sqliteErrstr = ownErrorField(error, 'errstr');
  const sqliteErrcode = ownErrorField(error, 'errcode');
  if (sqliteCode && /^SQLITE_CONSTRAINT/u.test(sqliteCode)) {
    return new BuilderAgentDelegationResultParentMaterializationStoreError(
      'builder_agent_delegation_result_parent_materialization_store_integrity_failed',
    );
  }
  if (sqliteErrstr === 'constraint failed' || sqliteErrcode === 1555) {
    return new BuilderAgentDelegationResultParentMaterializationStoreError(
      'builder_agent_delegation_result_parent_materialization_store_integrity_failed',
    );
  }
  if (sqliteCode && /^SQLITE_(CORRUPT|NOTADB|SCHEMA|INTERNAL|MISMATCH)/u.test(sqliteCode)) {
    return new BuilderAgentDelegationResultParentMaterializationStoreError(
      'builder_agent_delegation_result_parent_materialization_store_integrity_failed',
    );
  }
  return new BuilderAgentDelegationResultParentMaterializationStoreError(
    'builder_agent_delegation_result_parent_materialization_store_unavailable',
  );
}

function createBuilderAgentDelegationResultParentMaterializationStore(databasePath) {
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
    store_version: BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_STORE_VERSION,

    close(...rawArguments) {
      if (rawArguments.length !== 0) {
        throw new BuilderAgentDelegationResultParentMaterializationStoreError(
          'builder_agent_delegation_result_parent_materialization_store_invalid',
        );
      }
      try { db.close(); } catch (error) { throw normalizeOperationError(error); }
    },

    record_materialization(rawRequest) {
      try {
        return recordDelegationResultParentMaterialization(db, rawRequest);
      } catch (error) {
        throw normalizeOperationError(error);
      }
    },

    read_materialization(rawRequest) {
      try {
        return readDelegationResultParentMaterialization(db, rawRequest);
      } catch (error) {
        throw normalizeOperationError(error);
      }
    },

    read_materialization_for_eligibility(rawRequest) {
      try {
        return readDelegationResultParentMaterializationForEligibility(db, rawRequest);
      } catch (error) {
        throw normalizeOperationError(error);
      }
    },

    list_parent_task_materializations(rawRequest) {
      try {
        return listParentTaskDelegationResultParentMaterializations(db, rawRequest);
      } catch (error) {
        throw normalizeOperationError(error);
      }
    },

    list_child_task_materializations(rawRequest) {
      try {
        return listChildTaskDelegationResultParentMaterializations(db, rawRequest);
      } catch (error) {
        throw normalizeOperationError(error);
      }
    },
  });
}

module.exports = Object.freeze({
  BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_STORE_READ_RESULT_VERSION,
  BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_STORE_RESULT_VERSION,
  BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_STORE_SCHEMA_VERSION,
  BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_STORE_USER_VERSION,
  BUILDER_AGENT_DELEGATION_RESULT_PARENT_MATERIALIZATION_STORE_VERSION,
  BuilderAgentDelegationResultParentMaterializationStoreError,
  createBuilderAgentDelegationResultParentMaterializationStore,
});
