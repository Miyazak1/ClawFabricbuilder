'use strict';

const nodeCrypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { types: utilTypes } = require('node:util');

const {
  BuilderAgentDelegationResultReviewContractError,
  BUILDER_AGENT_DELEGATION_RESULT_REVIEW_RECORD_VERSION,
  sanitizeBuilderAgentDelegationResultReviewRecord,
} = require('./builder-agent-delegation-result-review-contract.cjs');

const BUILDER_AGENT_DELEGATION_RESULT_REVIEW_STORE_VERSION =
  'builder-agent-delegation-result-review-store.v1';
const BUILDER_AGENT_DELEGATION_RESULT_REVIEW_STORE_RESULT_VERSION =
  'builder-agent-delegation-result-review-store-result.v1';
const BUILDER_AGENT_DELEGATION_RESULT_REVIEW_STORE_READ_RESULT_VERSION =
  'builder-agent-delegation-result-review-store-read-result.v1';
const BUILDER_AGENT_DELEGATION_RESULT_REVIEW_STORE_SCHEMA_VERSION =
  'builder-agent-delegation-result-review-store-schema.v1';
const BUILDER_AGENT_DELEGATION_RESULT_REVIEW_STORE_USER_VERSION = 1;
const DATABASE_ID = 'builder-agent-delegation-result-review-store.v1';
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
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const RECORD_REVIEW_KEYS = Object.freeze(['delegation', 'result', 'admission', 'review']);
const READ_REVIEW_KEYS = Object.freeze(['delegation_result_review_id', 'owner_id']);
const READ_REVIEW_BY_ADMISSION_KEYS = Object.freeze(['delegation_result_admission_id', 'owner_id']);
const LIST_PARENT_TASK_REVIEWS_KEYS = Object.freeze(['owner_id', 'project_id', 'parent_task_id']);
const LIST_CHILD_TASK_REVIEWS_KEYS = Object.freeze(['owner_id', 'project_id', 'child_task_id']);
const MAX_TASK_REVIEWS = 128;
const MAX_RECEIPT_JSON_BYTES = 64 * 1024;
const CREATE_SCHEMA_SQL = Object.freeze([
  `CREATE TABLE agent_delegation_result_reviews (
    delegation_result_review_id TEXT NOT NULL PRIMARY KEY,
    delegation_result_admission_id TEXT NOT NULL,
    delegation_result_id TEXT NOT NULL,
    delegation_id TEXT NOT NULL,
    delegation_result_admission_digest TEXT NOT NULL,
    delegation_result_digest TEXT NOT NULL,
    delegation_definition_digest TEXT NOT NULL,
    target_definition_digest TEXT NOT NULL,
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
    reviewed_by TEXT NOT NULL,
    reviewed_at_ms INTEGER NOT NULL,
    result_status TEXT NOT NULL,
    result_summary_code TEXT NOT NULL,
    decision TEXT NOT NULL,
    decision_summary_code TEXT NOT NULL,
    review_contract TEXT NOT NULL,
    parent_materialization_boundary TEXT NOT NULL,
    delegation_json TEXT NOT NULL,
    result_json TEXT NOT NULL,
    admission_json TEXT NOT NULL,
    review_json TEXT NOT NULL,
    schema_version TEXT NOT NULL,
    UNIQUE (delegation_result_admission_id),
    CHECK (schema_version = 'builder-agent-delegation-result-review-store-schema.v1'),
    CHECK (record_version = 'builder-agent-delegation-result-review-record.v1'),
    CHECK (reviewed_at_ms >= 0),
    CHECK (result_status IN ('proposed', 'blocked', 'failed')),
    CHECK (result_summary_code IN (
      'delegated_child_result_ready_for_parent_review',
      'delegated_child_result_needs_owner_attention',
      'delegated_child_result_could_not_be_prepared'
    )),
    CHECK (decision IN (
      'approved_for_parent_materialization',
      'rejected',
      'acknowledged_without_materialization'
    )),
    CHECK (decision_summary_code IN (
      'delegated_child_result_approved_for_parent_materialization',
      'delegated_child_result_rejected_by_owner',
      'delegated_child_result_acknowledged_without_materialization'
    )),
    CHECK (review_contract = 'owner_review_recorded_before_parent_materialization'),
    CHECK (parent_materialization_boundary = 'no_direct_parent_mutation'),
    CHECK (length(delegation_json) BETWEEN 2 AND 65536),
    CHECK (length(result_json) BETWEEN 2 AND 65536),
    CHECK (length(admission_json) BETWEEN 2 AND 65536),
    CHECK (length(review_json) BETWEEN 2 AND 65536)
  ) STRICT`,
  'CREATE INDEX agent_delegation_result_reviews_parent_task_idx ON agent_delegation_result_reviews(owner_id, project_id, parent_task_id, reviewed_at_ms, delegation_result_review_id)',
  'CREATE INDEX agent_delegation_result_reviews_child_task_idx ON agent_delegation_result_reviews(owner_id, project_id, child_task_id, reviewed_at_ms, delegation_result_review_id)',
  'CREATE INDEX agent_delegation_result_reviews_admission_idx ON agent_delegation_result_reviews(owner_id, delegation_result_admission_id)',
  'CREATE INDEX agent_delegation_result_reviews_result_idx ON agent_delegation_result_reviews(owner_id, delegation_result_id)',
]);
const ERROR_MESSAGES = Object.freeze({
  builder_agent_delegation_result_review_store_invalid:
    'Builder agent delegation result review could not be verified.',
  builder_agent_delegation_result_review_store_not_found:
    'Builder agent delegation result review is unavailable.',
  builder_agent_delegation_result_review_store_conflict:
    'Builder agent delegation result review changed before it could be recorded.',
  builder_agent_delegation_result_review_store_integrity_failed:
    'Builder agent delegation result review integrity could not be verified.',
  builder_agent_delegation_result_review_store_resource_exceeded:
    'Builder agent delegation result review limits were reached.',
  builder_agent_delegation_result_review_store_unavailable:
    'Builder agent delegation result review storage is unavailable.',
});

class BuilderAgentDelegationResultReviewStoreError extends Error {
  constructor(code = 'builder_agent_delegation_result_review_store_invalid') {
    const selected = Object.hasOwn(ERROR_MESSAGES, code)
      ? code
      : 'builder_agent_delegation_result_review_store_invalid';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderAgentDelegationResultReviewStoreError';
    this.code = selected;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) {
  throw new BuilderAgentDelegationResultReviewStoreError(code);
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
  if (!isPlainObject(value)) fail('builder_agent_delegation_result_review_store_invalid');
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== keys.length
    || actual.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) fail('builder_agent_delegation_result_review_store_invalid');
  for (const key of actual) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      fail('builder_agent_delegation_result_review_store_invalid');
    }
  }
}

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
    fail('builder_agent_delegation_result_review_store_invalid');
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
  fail('builder_agent_delegation_result_review_store_invalid');
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
    fail('builder_agent_delegation_result_review_store_invalid');
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

function safeDelegationResultReviewId(value) {
  return safePattern(value, DELEGATION_RESULT_REVIEW_ID_PATTERN);
}

function safeDelegationResultAdmissionId(value) {
  return safePattern(value, DELEGATION_RESULT_ADMISSION_ID_PATTERN);
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail('builder_agent_delegation_result_review_store_invalid');
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
  ) fail('builder_agent_delegation_result_review_store_invalid');
  return value;
}

function assertParentDirectory(filePath) {
  let info;
  try {
    info = fs.lstatSync(path.dirname(filePath));
  } catch {
    fail('builder_agent_delegation_result_review_store_unavailable');
  }
  if (!info.isDirectory() || info.isSymbolicLink()) {
    fail('builder_agent_delegation_result_review_store_unavailable');
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
    fail('builder_agent_delegation_result_review_store_integrity_failed');
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
  if (mode !== 'wal') fail('builder_agent_delegation_result_review_store_unavailable');
  const pragmas = runtimePragmas(db);
  if (
    pragmas.foreign_keys !== 'on'
    || pragmas.trusted_schema !== 'off'
    || pragmas.synchronous !== 'full'
    || pragmas.journal_mode !== 'wal'
  ) fail('builder_agent_delegation_result_review_store_unavailable');
}

function createSchema(db) {
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const sql of CREATE_SCHEMA_SQL) db.exec(sql);
    db.exec(`PRAGMA user_version = ${BUILDER_AGENT_DELEGATION_RESULT_REVIEW_STORE_USER_VERSION}`);
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
    expectedDb.exec(`PRAGMA user_version = ${BUILDER_AGENT_DELEGATION_RESULT_REVIEW_STORE_USER_VERSION}`);
    expectedSchemaFingerprint = canonicalJson(collectSchemaFingerprint(expectedDb));
    return expectedSchemaFingerprint;
  } finally {
    expectedDb.close();
  }
}

function validateSchema(db) {
  const actual = collectSchemaFingerprint(db);
  if (actual.foreign_key_check.length !== 0) {
    fail('builder_agent_delegation_result_review_store_integrity_failed');
  }
  if (canonicalJson(actual) !== expectedFingerprint()) {
    fail('builder_agent_delegation_result_review_store_integrity_failed');
  }
}

function initialize(db) {
  configurePragmas(db);
  const version = userVersion(db);
  if (version === 0) createSchema(db);
  else if (version !== BUILDER_AGENT_DELEGATION_RESULT_REVIEW_STORE_USER_VERSION) {
    fail('builder_agent_delegation_result_review_store_integrity_failed');
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
    if (error instanceof BuilderAgentDelegationResultReviewStoreError) fail(code);
    throw error;
  }
  return parsed;
}

function sanitizeReviewRequest(value) {
  exactObject(value, RECORD_REVIEW_KEYS);
  const delegation = valueAt(value, 'delegation');
  const result = valueAt(value, 'result');
  const admission = valueAt(value, 'admission');
  const review = valueAt(value, 'review');
  try {
    return freezeDeep({
      delegation,
      result,
      admission,
      review: sanitizeBuilderAgentDelegationResultReviewRecord(review, admission, result, delegation),
    });
  } catch (error) {
    if (error instanceof BuilderAgentDelegationResultReviewContractError) {
      fail('builder_agent_delegation_result_review_store_invalid');
    }
    throw error;
  }
}

function reviewColumns() {
  return `delegation_result_review_id, delegation_result_admission_id,
    delegation_result_id, delegation_id, delegation_result_admission_digest,
    delegation_result_digest, delegation_definition_digest,
    target_definition_digest, record_version, parent_assignment_id,
    parent_assignment_status_id, parent_lease_id, from_agent_id,
    from_agent_version_id, to_agent_id, to_agent_version_id, owner_id,
    project_id, parent_conversation_id, parent_task_id, parent_run_id,
    child_conversation_id, child_task_id, child_run_id, lease_holder_id,
    reviewed_by, reviewed_at_ms, result_status, result_summary_code, decision,
    decision_summary_code, review_contract, parent_materialization_boundary,
    delegation_json, result_json, admission_json, review_json`;
}

function safeRowFacts(row) {
  return freezeDeep({
    delegation_result_review_id: safePattern(row.delegation_result_review_id, DELEGATION_RESULT_REVIEW_ID_PATTERN),
    delegation_result_admission_id: safePattern(
      row.delegation_result_admission_id,
      DELEGATION_RESULT_ADMISSION_ID_PATTERN,
    ),
    delegation_result_id: safePattern(row.delegation_result_id, DELEGATION_RESULT_ID_PATTERN),
    delegation_id: safePattern(row.delegation_id, DELEGATION_ID_PATTERN),
    delegation_result_admission_digest: safePattern(row.delegation_result_admission_digest, DIGEST_PATTERN),
    delegation_result_digest: safePattern(row.delegation_result_digest, DIGEST_PATTERN),
    delegation_definition_digest: safePattern(row.delegation_definition_digest, DIGEST_PATTERN),
    target_definition_digest: safePattern(row.target_definition_digest, DIGEST_PATTERN),
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
    reviewed_by: safePattern(row.reviewed_by, OWNER_ID_PATTERN),
    reviewed_at_ms: safeTimestamp(row.reviewed_at_ms),
    result_status: row.result_status,
    result_summary_code: row.result_summary_code,
    decision: row.decision,
    decision_summary_code: row.decision_summary_code,
    review_contract: row.review_contract,
    parent_materialization_boundary: row.parent_materialization_boundary,
  });
}

function entryFromRow(row) {
  if (!row) return null;
  try {
    const delegation = parseCanonicalReceipt(
      row.delegation_json,
      'builder_agent_delegation_result_review_store_integrity_failed',
    );
    const result = parseCanonicalReceipt(
      row.result_json,
      'builder_agent_delegation_result_review_store_integrity_failed',
    );
    const admission = parseCanonicalReceipt(
      row.admission_json,
      'builder_agent_delegation_result_review_store_integrity_failed',
    );
    const parsedReview = parseCanonicalReceipt(
      row.review_json,
      'builder_agent_delegation_result_review_store_integrity_failed',
    );
    const review = sanitizeBuilderAgentDelegationResultReviewRecord(
      parsedReview,
      admission,
      result,
      delegation,
    );
    const rowFacts = safeRowFacts(row);
    if (
      rowFacts.delegation_result_review_id !== review.delegation_result_review_id
      || rowFacts.delegation_result_admission_id !== review.delegation_result_admission_id
      || rowFacts.delegation_result_id !== review.delegation_result_id
      || rowFacts.delegation_id !== review.delegation_id
      || rowFacts.delegation_result_admission_digest !== review.delegation_result_admission_digest
      || rowFacts.delegation_result_digest !== review.delegation_result_digest
      || rowFacts.delegation_definition_digest !== review.delegation_definition_digest
      || rowFacts.target_definition_digest !== review.target_definition_digest
      || rowFacts.record_version !== BUILDER_AGENT_DELEGATION_RESULT_REVIEW_RECORD_VERSION
      || rowFacts.record_version !== review.record_version
      || rowFacts.parent_assignment_id !== review.parent_assignment_id
      || rowFacts.parent_assignment_status_id !== review.parent_assignment_status_id
      || rowFacts.parent_lease_id !== review.parent_lease_id
      || rowFacts.from_agent_id !== review.from_agent_id
      || rowFacts.from_agent_version_id !== review.from_agent_version_id
      || rowFacts.to_agent_id !== review.to_agent_id
      || rowFacts.to_agent_version_id !== review.to_agent_version_id
      || rowFacts.owner_id !== review.owner_id
      || rowFacts.project_id !== review.project_id
      || rowFacts.parent_conversation_id !== review.parent_conversation_id
      || rowFacts.parent_task_id !== review.parent_task_id
      || rowFacts.parent_run_id !== review.parent_run_id
      || rowFacts.child_conversation_id !== review.child_conversation_id
      || rowFacts.child_task_id !== review.child_task_id
      || rowFacts.child_run_id !== review.child_run_id
      || rowFacts.lease_holder_id !== review.lease_holder_id
      || rowFacts.reviewed_by !== review.reviewed_by
      || rowFacts.reviewed_at_ms !== review.reviewed_at_ms
      || rowFacts.result_status !== review.result.status
      || rowFacts.result_summary_code !== review.result.summary_code
      || rowFacts.decision !== review.decision
      || rowFacts.decision_summary_code !== review.decision_summary_code
      || rowFacts.review_contract !== review.review_contract
      || rowFacts.parent_materialization_boundary !== review.parent_materialization_boundary
    ) fail('builder_agent_delegation_result_review_store_integrity_failed');
    return freezeDeep({ admission, delegation, result, review });
  } catch (error) {
    if (
      error instanceof BuilderAgentDelegationResultReviewStoreError
      || error instanceof BuilderAgentDelegationResultReviewContractError
    ) fail('builder_agent_delegation_result_review_store_integrity_failed');
    throw error;
  }
}

function loadEntryByReviewId(db, reviewId) {
  return entryFromRow(one(
    db,
    `SELECT ${reviewColumns()} FROM agent_delegation_result_reviews
      WHERE delegation_result_review_id = ?`,
    [reviewId],
  ));
}

function loadEntryByAdmissionId(db, admissionId) {
  return entryFromRow(one(
    db,
    `SELECT ${reviewColumns()} FROM agent_delegation_result_reviews
      WHERE delegation_result_admission_id = ?`,
    [admissionId],
  ));
}

function parentTaskEntries(db, ownerId, projectId, parentTaskId) {
  const rows = all(
    db,
    `SELECT ${reviewColumns()}
      FROM agent_delegation_result_reviews
      WHERE owner_id = ? AND project_id = ? AND parent_task_id = ?
      ORDER BY reviewed_at_ms ASC, delegation_result_review_id ASC
      LIMIT ?`,
    [ownerId, projectId, parentTaskId, MAX_TASK_REVIEWS + 1],
  );
  if (rows.length > MAX_TASK_REVIEWS) {
    fail('builder_agent_delegation_result_review_store_resource_exceeded');
  }
  return freezeDeep(rows.map(entryFromRow));
}

function childTaskEntries(db, ownerId, projectId, childTaskId) {
  const rows = all(
    db,
    `SELECT ${reviewColumns()}
      FROM agent_delegation_result_reviews
      WHERE owner_id = ? AND project_id = ? AND child_task_id = ?
      ORDER BY reviewed_at_ms ASC, delegation_result_review_id ASC
      LIMIT ?`,
    [ownerId, projectId, childTaskId, MAX_TASK_REVIEWS + 1],
  );
  if (rows.length > MAX_TASK_REVIEWS) {
    fail('builder_agent_delegation_result_review_store_resource_exceeded');
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
    && sameFact(left.review, right.review);
}

function evidence(db, transaction) {
  return freezeDeep({
    database_id: DATABASE_ID,
    schema_version: BUILDER_AGENT_DELEGATION_RESULT_REVIEW_STORE_SCHEMA_VERSION,
    user_version: BUILDER_AGENT_DELEGATION_RESULT_REVIEW_STORE_USER_VERSION,
    schema_fingerprint_digest: sha256Canonical(collectSchemaFingerprint(db)),
    runtime_pragmas: runtimePragmas(db),
    transaction,
    delegation_result_review_authority: 'main_owned_agent_delegation_result_review_store',
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
    review_row_authority: false,
    artifact_authority: false,
    parent_materialization_authority: false,
  });
}

function storeResult(db, operation, payload) {
  return freezeDeep({
    result_version: BUILDER_AGENT_DELEGATION_RESULT_REVIEW_STORE_RESULT_VERSION,
    operation,
    ...payload,
    delegation_result_review_evidence: evidence(db, operation),
  });
}

function insertReview(db, entry) {
  const review = entry.review;
  run(db, `INSERT INTO agent_delegation_result_reviews (
    delegation_result_review_id, delegation_result_admission_id,
    delegation_result_id, delegation_id, delegation_result_admission_digest,
    delegation_result_digest, delegation_definition_digest,
    target_definition_digest, record_version, parent_assignment_id,
    parent_assignment_status_id, parent_lease_id, from_agent_id,
    from_agent_version_id, to_agent_id, to_agent_version_id, owner_id,
    project_id, parent_conversation_id, parent_task_id, parent_run_id,
    child_conversation_id, child_task_id, child_run_id, lease_holder_id,
    reviewed_by, reviewed_at_ms, result_status, result_summary_code, decision,
    decision_summary_code, review_contract, parent_materialization_boundary,
    delegation_json, result_json, admission_json, review_json, schema_version
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
    review.delegation_result_review_id,
    review.delegation_result_admission_id,
    review.delegation_result_id,
    review.delegation_id,
    review.delegation_result_admission_digest,
    review.delegation_result_digest,
    review.delegation_definition_digest,
    review.target_definition_digest,
    review.record_version,
    review.parent_assignment_id,
    review.parent_assignment_status_id,
    review.parent_lease_id,
    review.from_agent_id,
    review.from_agent_version_id,
    review.to_agent_id,
    review.to_agent_version_id,
    review.owner_id,
    review.project_id,
    review.parent_conversation_id,
    review.parent_task_id,
    review.parent_run_id,
    review.child_conversation_id,
    review.child_task_id,
    review.child_run_id,
    review.lease_holder_id,
    review.reviewed_by,
    review.reviewed_at_ms,
    review.result.status,
    review.result.summary_code,
    review.decision,
    review.decision_summary_code,
    review.review_contract,
    review.parent_materialization_boundary,
    canonicalJson(entry.delegation),
    canonicalJson(entry.result),
    canonicalJson(entry.admission),
    canonicalJson(review),
    BUILDER_AGENT_DELEGATION_RESULT_REVIEW_STORE_SCHEMA_VERSION,
  ]);
}

function recordDelegationResultReview(db, rawRequest) {
  const requested = sanitizeReviewRequest(rawRequest);
  db.exec('BEGIN IMMEDIATE');
  try {
    const existing = loadEntryByReviewId(db, requested.review.delegation_result_review_id);
    if (existing !== null) {
      if (!sameEntry(existing, requested)) {
        fail('builder_agent_delegation_result_review_store_conflict');
      }
      db.exec('COMMIT');
      return storeResult(db, 'delegation_result_review_replayed', {
        delegation_result_review: existing,
      });
    }
    if (loadEntryByAdmissionId(db, requested.review.delegation_result_admission_id) !== null) {
      fail('builder_agent_delegation_result_review_store_conflict');
    }
    insertReview(db, requested);
    const readback = loadEntryByReviewId(db, requested.review.delegation_result_review_id);
    if (readback === null || !sameEntry(readback, requested)) {
      fail('builder_agent_delegation_result_review_store_integrity_failed');
    }
    db.exec('COMMIT');
    return storeResult(db, 'delegation_result_review_recorded', {
      delegation_result_review: readback,
    });
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* fixed failure below */ }
    throw error;
  }
}

function readyReadResult(db, entry, transaction) {
  return freezeDeep({
    result_version: BUILDER_AGENT_DELEGATION_RESULT_REVIEW_STORE_READ_RESULT_VERSION,
    delegation_result_review_authority: 'main_owned_agent_delegation_result_review_store',
    status: 'ready',
    delegation_result_review: entry,
    evidence: evidence(db, transaction),
  });
}

function absentReadResult(db, payload, transaction) {
  return freezeDeep({
    result_version: BUILDER_AGENT_DELEGATION_RESULT_REVIEW_STORE_READ_RESULT_VERSION,
    delegation_result_review_authority: 'main_owned_agent_delegation_result_review_store',
    status: 'absent',
    ...payload,
    delegation_result_review: null,
    evidence: evidence(db, transaction),
  });
}

function readDelegationResultReview(db, rawRequest) {
  exactObject(rawRequest, READ_REVIEW_KEYS);
  const reviewId = safeDelegationResultReviewId(valueAt(rawRequest, 'delegation_result_review_id'));
  const ownerId = safeOwnerId(valueAt(rawRequest, 'owner_id'));
  const entry = loadEntryByReviewId(db, reviewId);
  if (entry === null || entry.review.owner_id !== ownerId) {
    return absentReadResult(db, {
      delegation_result_review_id: reviewId,
      owner_id: ownerId,
    }, 'delegation_result_review_absent_read');
  }
  return freezeDeep({
    ...readyReadResult(db, entry, 'delegation_result_review_ready_read'),
    delegation_result_review_id: reviewId,
    owner_id: ownerId,
  });
}

function readDelegationResultReviewForAdmission(db, rawRequest) {
  exactObject(rawRequest, READ_REVIEW_BY_ADMISSION_KEYS);
  const admissionId = safeDelegationResultAdmissionId(valueAt(rawRequest, 'delegation_result_admission_id'));
  const ownerId = safeOwnerId(valueAt(rawRequest, 'owner_id'));
  const entry = loadEntryByAdmissionId(db, admissionId);
  if (entry === null || entry.review.owner_id !== ownerId) {
    return absentReadResult(db, {
      delegation_result_admission_id: admissionId,
      owner_id: ownerId,
    }, 'delegation_result_review_for_admission_absent_read');
  }
  return freezeDeep({
    ...readyReadResult(db, entry, 'delegation_result_review_for_admission_ready_read'),
    delegation_result_admission_id: admissionId,
    owner_id: ownerId,
  });
}

function listParentTaskDelegationResultReviews(db, rawRequest) {
  exactObject(rawRequest, LIST_PARENT_TASK_REVIEWS_KEYS);
  const ownerId = safeOwnerId(valueAt(rawRequest, 'owner_id'));
  const projectId = safeProjectId(valueAt(rawRequest, 'project_id'));
  const parentTaskId = safeTaskId(valueAt(rawRequest, 'parent_task_id'));
  const reviews = parentTaskEntries(db, ownerId, projectId, parentTaskId);
  return freezeDeep({
    result_version: BUILDER_AGENT_DELEGATION_RESULT_REVIEW_STORE_READ_RESULT_VERSION,
    delegation_result_review_authority: 'main_owned_agent_delegation_result_review_store',
    status: reviews.length === 0 ? 'absent' : 'ready',
    owner_id: ownerId,
    project_id: projectId,
    parent_task_id: parentTaskId,
    delegation_result_reviews: reviews,
    evidence: evidence(db, reviews.length === 0
      ? 'parent_task_delegation_result_reviews_absent_read'
      : 'parent_task_delegation_result_reviews_ready_read'),
  });
}

function listChildTaskDelegationResultReviews(db, rawRequest) {
  exactObject(rawRequest, LIST_CHILD_TASK_REVIEWS_KEYS);
  const ownerId = safeOwnerId(valueAt(rawRequest, 'owner_id'));
  const projectId = safeProjectId(valueAt(rawRequest, 'project_id'));
  const childTaskId = safeTaskId(valueAt(rawRequest, 'child_task_id'));
  const reviews = childTaskEntries(db, ownerId, projectId, childTaskId);
  return freezeDeep({
    result_version: BUILDER_AGENT_DELEGATION_RESULT_REVIEW_STORE_READ_RESULT_VERSION,
    delegation_result_review_authority: 'main_owned_agent_delegation_result_review_store',
    status: reviews.length === 0 ? 'absent' : 'ready',
    owner_id: ownerId,
    project_id: projectId,
    child_task_id: childTaskId,
    delegation_result_reviews: reviews,
    evidence: evidence(db, reviews.length === 0
      ? 'child_task_delegation_result_reviews_absent_read'
      : 'child_task_delegation_result_reviews_ready_read'),
  });
}

function ownErrorField(error, key) {
  if (!error || typeof error !== 'object' || utilTypes.isProxy(error)) return null;
  const descriptor = Object.getOwnPropertyDescriptor(error, key);
  return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : null;
}

function normalizeOperationError(error) {
  if (error instanceof BuilderAgentDelegationResultReviewStoreError) {
    return new BuilderAgentDelegationResultReviewStoreError(error.code);
  }
  if (error instanceof BuilderAgentDelegationResultReviewContractError) {
    return new BuilderAgentDelegationResultReviewStoreError(
      'builder_agent_delegation_result_review_store_invalid',
    );
  }
  const sqliteCode = ownErrorField(error, 'code');
  const sqliteErrstr = ownErrorField(error, 'errstr');
  const sqliteErrcode = ownErrorField(error, 'errcode');
  if (sqliteCode && /^SQLITE_CONSTRAINT/u.test(sqliteCode)) {
    return new BuilderAgentDelegationResultReviewStoreError(
      'builder_agent_delegation_result_review_store_integrity_failed',
    );
  }
  if (sqliteErrstr === 'constraint failed' || sqliteErrcode === 1555) {
    return new BuilderAgentDelegationResultReviewStoreError(
      'builder_agent_delegation_result_review_store_integrity_failed',
    );
  }
  if (sqliteCode && /^SQLITE_(CORRUPT|NOTADB|SCHEMA|INTERNAL|MISMATCH)/u.test(sqliteCode)) {
    return new BuilderAgentDelegationResultReviewStoreError(
      'builder_agent_delegation_result_review_store_integrity_failed',
    );
  }
  return new BuilderAgentDelegationResultReviewStoreError(
    'builder_agent_delegation_result_review_store_unavailable',
  );
}

function createBuilderAgentDelegationResultReviewStore(databasePath) {
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
    store_version: BUILDER_AGENT_DELEGATION_RESULT_REVIEW_STORE_VERSION,

    close(...rawArguments) {
      if (rawArguments.length !== 0) {
        throw new BuilderAgentDelegationResultReviewStoreError(
          'builder_agent_delegation_result_review_store_invalid',
        );
      }
      try { db.close(); } catch (error) { throw normalizeOperationError(error); }
    },

    record_review(rawRequest) {
      try { return recordDelegationResultReview(db, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },

    read_review(rawRequest) {
      try { return readDelegationResultReview(db, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },

    read_review_for_admission(rawRequest) {
      try { return readDelegationResultReviewForAdmission(db, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },

    list_parent_task_reviews(rawRequest) {
      try { return listParentTaskDelegationResultReviews(db, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },

    list_child_task_reviews(rawRequest) {
      try { return listChildTaskDelegationResultReviews(db, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },
  });
}

module.exports = Object.freeze({
  BUILDER_AGENT_DELEGATION_RESULT_REVIEW_STORE_READ_RESULT_VERSION,
  BUILDER_AGENT_DELEGATION_RESULT_REVIEW_STORE_RESULT_VERSION,
  BUILDER_AGENT_DELEGATION_RESULT_REVIEW_STORE_SCHEMA_VERSION,
  BUILDER_AGENT_DELEGATION_RESULT_REVIEW_STORE_USER_VERSION,
  BUILDER_AGENT_DELEGATION_RESULT_REVIEW_STORE_VERSION,
  BuilderAgentDelegationResultReviewStoreError,
  createBuilderAgentDelegationResultReviewStore,
});
