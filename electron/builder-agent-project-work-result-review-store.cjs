'use strict';

const nodeCrypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { types: utilTypes } = require('node:util');

const {
  BuilderAgentProjectWorkResultReviewContractError,
  BUILDER_AGENT_PROJECT_WORK_RESULT_REVIEW_RECORD_VERSION,
  sanitizeBuilderAgentProjectWorkResultReviewRecord,
} = require('./builder-agent-project-work-result-review-contract.cjs');

const BUILDER_AGENT_PROJECT_WORK_RESULT_REVIEW_STORE_VERSION =
  'builder-agent-project-work-result-review-store.v1';
const BUILDER_AGENT_PROJECT_WORK_RESULT_REVIEW_STORE_RESULT_VERSION =
  'builder-agent-project-work-result-review-store-result.v1';
const BUILDER_AGENT_PROJECT_WORK_RESULT_REVIEW_STORE_READ_RESULT_VERSION =
  'builder-agent-project-work-result-review-store-read-result.v1';
const BUILDER_AGENT_PROJECT_WORK_RESULT_REVIEW_STORE_SCHEMA_VERSION =
  'builder-agent-project-work-result-review-store-schema.v1';
const BUILDER_AGENT_PROJECT_WORK_RESULT_REVIEW_STORE_USER_VERSION = 1;
const DATABASE_ID = 'builder-agent-project-work-result-review-store.v1';
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
const WORK_RESULT_REVIEW_ID_PATTERN = /^builder-agent-project-work-result-review:[0-9a-f]{64}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const RECORD_REVIEW_KEYS = Object.freeze(['assignment', 'status', 'lease', 'result', 'review']);
const READ_REVIEW_KEYS = Object.freeze(['work_result_review_id', 'owner_id']);
const READ_REVIEW_BY_RESULT_KEYS = Object.freeze(['work_result_id', 'owner_id']);
const LIST_TASK_REVIEWS_KEYS = Object.freeze(['owner_id', 'project_id', 'task_id']);
const MAX_TASK_REVIEWS = 128;
const MAX_RECEIPT_JSON_BYTES = 64 * 1024;
const CREATE_SCHEMA_SQL = Object.freeze([
  `CREATE TABLE agent_project_work_result_reviews (
    work_result_review_id TEXT NOT NULL PRIMARY KEY,
    work_result_id TEXT NOT NULL,
    work_result_digest TEXT NOT NULL,
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
    reviewed_by TEXT NOT NULL,
    reviewed_at_ms INTEGER NOT NULL,
    result_status TEXT NOT NULL,
    result_summary_code TEXT NOT NULL,
    decision TEXT NOT NULL,
    decision_summary_code TEXT NOT NULL,
    review_contract TEXT NOT NULL,
    materialization_boundary TEXT NOT NULL,
    assignment_json TEXT NOT NULL,
    status_json TEXT NOT NULL,
    lease_json TEXT NOT NULL,
    result_json TEXT NOT NULL,
    review_json TEXT NOT NULL,
    schema_version TEXT NOT NULL,
    UNIQUE (work_result_id),
    CHECK (schema_version = 'builder-agent-project-work-result-review-store-schema.v1'),
    CHECK (record_version = 'builder-agent-project-work-result-review-record.v1'),
    CHECK (work_kind IN ('project_edit', 'project_test')),
    CHECK (reviewed_at_ms >= 0),
    CHECK (result_status IN ('proposed', 'blocked', 'failed')),
    CHECK (result_summary_code IN (
      'project_edit_candidate_ready_for_review',
      'project_edit_needs_owner_attention',
      'project_edit_could_not_be_prepared',
      'project_check_plan_ready_for_review',
      'project_check_needs_owner_attention',
      'project_check_could_not_be_prepared'
    )),
    CHECK (decision IN (
      'approved_for_project_materialization',
      'rejected',
      'acknowledged_without_materialization'
    )),
    CHECK (decision_summary_code IN (
      'agent_project_work_result_approved_for_project_materialization',
      'agent_project_work_result_rejected_by_owner',
      'agent_project_work_result_acknowledged_without_materialization'
    )),
    CHECK (review_contract = 'owner_review_recorded_before_project_materialization'),
    CHECK (materialization_boundary = 'no_source_mutation_no_project_revision'),
    CHECK (length(assignment_json) BETWEEN 2 AND 65536),
    CHECK (length(status_json) BETWEEN 2 AND 65536),
    CHECK (length(lease_json) BETWEEN 2 AND 65536),
    CHECK (length(result_json) BETWEEN 2 AND 65536),
    CHECK (length(review_json) BETWEEN 2 AND 65536)
  ) STRICT`,
  'CREATE INDEX agent_project_work_result_reviews_task_idx ON agent_project_work_result_reviews(owner_id, project_id, task_id, reviewed_at_ms, work_result_review_id)',
  'CREATE INDEX agent_project_work_result_reviews_result_idx ON agent_project_work_result_reviews(owner_id, work_result_id)',
]);
const ERROR_MESSAGES = Object.freeze({
  builder_agent_project_work_result_review_store_invalid:
    'Builder agent project work result review could not be verified.',
  builder_agent_project_work_result_review_store_not_found:
    'Builder agent project work result review is unavailable.',
  builder_agent_project_work_result_review_store_conflict:
    'Builder agent project work result review changed before it could be recorded.',
  builder_agent_project_work_result_review_store_integrity_failed:
    'Builder agent project work result review integrity could not be verified.',
  builder_agent_project_work_result_review_store_resource_exceeded:
    'Builder agent project work result review limits were reached.',
  builder_agent_project_work_result_review_store_unavailable:
    'Builder agent project work result review storage is unavailable.',
});

class BuilderAgentProjectWorkResultReviewStoreError extends Error {
  constructor(code = 'builder_agent_project_work_result_review_store_invalid') {
    const selected = Object.hasOwn(ERROR_MESSAGES, code)
      ? code
      : 'builder_agent_project_work_result_review_store_invalid';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderAgentProjectWorkResultReviewStoreError';
    this.code = selected;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) {
  throw new BuilderAgentProjectWorkResultReviewStoreError(code);
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
  if (!isPlainObject(value)) fail('builder_agent_project_work_result_review_store_invalid');
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== keys.length
    || actual.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) fail('builder_agent_project_work_result_review_store_invalid');
  for (const key of actual) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      fail('builder_agent_project_work_result_review_store_invalid');
    }
  }
}

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
    fail('builder_agent_project_work_result_review_store_invalid');
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
  fail('builder_agent_project_work_result_review_store_invalid');
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
    fail('builder_agent_project_work_result_review_store_invalid');
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

function safeWorkResultReviewId(value) {
  return safePattern(value, WORK_RESULT_REVIEW_ID_PATTERN);
}

function safeWorkResultId(value) {
  return safePattern(value, WORK_RESULT_ID_PATTERN);
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail('builder_agent_project_work_result_review_store_invalid');
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
  ) fail('builder_agent_project_work_result_review_store_invalid');
  return value;
}

function assertParentDirectory(filePath) {
  let info;
  try {
    info = fs.lstatSync(path.dirname(filePath));
  } catch {
    fail('builder_agent_project_work_result_review_store_unavailable');
  }
  if (!info.isDirectory() || info.isSymbolicLink()) {
    fail('builder_agent_project_work_result_review_store_unavailable');
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
    fail('builder_agent_project_work_result_review_store_integrity_failed');
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
  if (mode !== 'wal') fail('builder_agent_project_work_result_review_store_unavailable');
  const pragmas = runtimePragmas(db);
  if (
    pragmas.foreign_keys !== 'on'
    || pragmas.trusted_schema !== 'off'
    || pragmas.synchronous !== 'full'
    || pragmas.journal_mode !== 'wal'
  ) fail('builder_agent_project_work_result_review_store_unavailable');
}

function createSchema(db) {
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const sql of CREATE_SCHEMA_SQL) db.exec(sql);
    db.exec(`PRAGMA user_version = ${BUILDER_AGENT_PROJECT_WORK_RESULT_REVIEW_STORE_USER_VERSION}`);
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
    expectedDb.exec(`PRAGMA user_version = ${BUILDER_AGENT_PROJECT_WORK_RESULT_REVIEW_STORE_USER_VERSION}`);
    expectedSchemaFingerprint = canonicalJson(collectSchemaFingerprint(expectedDb));
    return expectedSchemaFingerprint;
  } finally {
    expectedDb.close();
  }
}

function validateSchema(db) {
  const actual = collectSchemaFingerprint(db);
  if (actual.foreign_key_check.length !== 0) {
    fail('builder_agent_project_work_result_review_store_integrity_failed');
  }
  if (canonicalJson(actual) !== expectedFingerprint()) {
    fail('builder_agent_project_work_result_review_store_integrity_failed');
  }
}

function initialize(db) {
  configurePragmas(db);
  const version = userVersion(db);
  if (version === 0) createSchema(db);
  else if (version !== BUILDER_AGENT_PROJECT_WORK_RESULT_REVIEW_STORE_USER_VERSION) {
    fail('builder_agent_project_work_result_review_store_integrity_failed');
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
    if (error instanceof BuilderAgentProjectWorkResultReviewStoreError) fail(code);
    throw error;
  }
  return parsed;
}

function sanitizeReviewRequest(value) {
  exactObject(value, RECORD_REVIEW_KEYS);
  const assignment = valueAt(value, 'assignment');
  const status = valueAt(value, 'status');
  const lease = valueAt(value, 'lease');
  const result = valueAt(value, 'result');
  const review = valueAt(value, 'review');
  try {
    return freezeDeep({
      assignment,
      status,
      lease,
      result,
      review: sanitizeBuilderAgentProjectWorkResultReviewRecord(
        review,
        result,
        assignment,
        status,
        lease,
      ),
    });
  } catch (error) {
    if (error instanceof BuilderAgentProjectWorkResultReviewContractError) {
      fail('builder_agent_project_work_result_review_store_invalid');
    }
    throw error;
  }
}

function reviewColumns() {
  return `work_result_review_id, work_result_id, work_result_digest,
    definition_digest, record_version, assignment_id, assignment_status_id,
    lease_id, agent_id, agent_version_id, owner_id, project_id,
    conversation_id, task_id, run_id, lease_holder_id, work_kind, reviewed_by,
    reviewed_at_ms, result_status, result_summary_code, decision,
    decision_summary_code, review_contract, materialization_boundary,
    assignment_json, status_json, lease_json, result_json, review_json`;
}

function safeRowFacts(row) {
  return freezeDeep({
    work_result_review_id: safePattern(row.work_result_review_id, WORK_RESULT_REVIEW_ID_PATTERN),
    work_result_id: safePattern(row.work_result_id, WORK_RESULT_ID_PATTERN),
    work_result_digest: safePattern(row.work_result_digest, DIGEST_PATTERN),
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
    reviewed_by: safePattern(row.reviewed_by, OWNER_ID_PATTERN),
    reviewed_at_ms: safeTimestamp(row.reviewed_at_ms),
    result_status: row.result_status,
    result_summary_code: row.result_summary_code,
    decision: row.decision,
    decision_summary_code: row.decision_summary_code,
    review_contract: row.review_contract,
    materialization_boundary: row.materialization_boundary,
  });
}

function entryFromRow(row) {
  if (!row) return null;
  try {
    const assignment = parseCanonicalReceipt(
      row.assignment_json,
      'builder_agent_project_work_result_review_store_integrity_failed',
    );
    const status = parseCanonicalReceipt(
      row.status_json,
      'builder_agent_project_work_result_review_store_integrity_failed',
    );
    const lease = parseCanonicalReceipt(
      row.lease_json,
      'builder_agent_project_work_result_review_store_integrity_failed',
    );
    const result = parseCanonicalReceipt(
      row.result_json,
      'builder_agent_project_work_result_review_store_integrity_failed',
    );
    const parsedReview = parseCanonicalReceipt(
      row.review_json,
      'builder_agent_project_work_result_review_store_integrity_failed',
    );
    const review = sanitizeBuilderAgentProjectWorkResultReviewRecord(
      parsedReview,
      result,
      assignment,
      status,
      lease,
    );
    const rowFacts = safeRowFacts(row);
    if (
      rowFacts.work_result_review_id !== review.work_result_review_id
      || rowFacts.work_result_id !== review.work_result_id
      || rowFacts.work_result_digest !== review.work_result_digest
      || rowFacts.definition_digest !== review.definition_digest
      || rowFacts.record_version !== BUILDER_AGENT_PROJECT_WORK_RESULT_REVIEW_RECORD_VERSION
      || rowFacts.record_version !== review.record_version
      || rowFacts.assignment_id !== review.assignment_id
      || rowFacts.assignment_status_id !== review.assignment_status_id
      || rowFacts.lease_id !== review.lease_id
      || rowFacts.agent_id !== review.agent_id
      || rowFacts.agent_version_id !== review.agent_version_id
      || rowFacts.owner_id !== review.owner_id
      || rowFacts.project_id !== review.project_id
      || rowFacts.conversation_id !== review.conversation_id
      || rowFacts.task_id !== review.task_id
      || rowFacts.run_id !== review.run_id
      || rowFacts.lease_holder_id !== review.lease_holder_id
      || rowFacts.work_kind !== review.work_kind
      || rowFacts.reviewed_by !== review.reviewed_by
      || rowFacts.reviewed_at_ms !== review.reviewed_at_ms
      || rowFacts.result_status !== review.result.status
      || rowFacts.result_summary_code !== review.result.summary_code
      || rowFacts.decision !== review.decision
      || rowFacts.decision_summary_code !== review.decision_summary_code
      || rowFacts.review_contract !== review.review_contract
      || rowFacts.materialization_boundary !== review.materialization_boundary
    ) fail('builder_agent_project_work_result_review_store_integrity_failed');
    return freezeDeep({ assignment, status, lease, result, review });
  } catch (error) {
    if (
      error instanceof BuilderAgentProjectWorkResultReviewStoreError
      || error instanceof BuilderAgentProjectWorkResultReviewContractError
    ) fail('builder_agent_project_work_result_review_store_integrity_failed');
    throw error;
  }
}

function loadEntryByReviewId(db, reviewId) {
  return entryFromRow(one(
    db,
    `SELECT ${reviewColumns()} FROM agent_project_work_result_reviews
      WHERE work_result_review_id = ?`,
    [reviewId],
  ));
}

function loadEntryByWorkResultId(db, workResultId) {
  return entryFromRow(one(
    db,
    `SELECT ${reviewColumns()} FROM agent_project_work_result_reviews
      WHERE work_result_id = ?`,
    [workResultId],
  ));
}

function taskEntries(db, ownerId, projectId, taskId) {
  const rows = all(
    db,
    `SELECT ${reviewColumns()}
      FROM agent_project_work_result_reviews
      WHERE owner_id = ? AND project_id = ? AND task_id = ?
      ORDER BY reviewed_at_ms ASC, work_result_review_id ASC
      LIMIT ?`,
    [ownerId, projectId, taskId, MAX_TASK_REVIEWS + 1],
  );
  if (rows.length > MAX_TASK_REVIEWS) {
    fail('builder_agent_project_work_result_review_store_resource_exceeded');
  }
  return freezeDeep(rows.map(entryFromRow));
}

function sameFact(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function sameEntry(left, right) {
  return sameFact(left.assignment, right.assignment)
    && sameFact(left.status, right.status)
    && sameFact(left.lease, right.lease)
    && sameFact(left.result, right.result)
    && sameFact(left.review, right.review);
}

function evidence(db, transaction) {
  return freezeDeep({
    database_id: DATABASE_ID,
    schema_version: BUILDER_AGENT_PROJECT_WORK_RESULT_REVIEW_STORE_SCHEMA_VERSION,
    user_version: BUILDER_AGENT_PROJECT_WORK_RESULT_REVIEW_STORE_USER_VERSION,
    schema_fingerprint_digest: sha256Canonical(collectSchemaFingerprint(db)),
    runtime_pragmas: runtimePragmas(db),
    transaction,
    project_work_result_review_authority: 'main_owned_agent_project_work_result_review_store',
    renderer_authority: 'not_present',
    ipc_authority: 'not_present',
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
    materialization_authority: false,
  });
}

function storeResult(db, operation, payload) {
  return freezeDeep({
    result_version: BUILDER_AGENT_PROJECT_WORK_RESULT_REVIEW_STORE_RESULT_VERSION,
    operation,
    ...payload,
    project_work_result_review_evidence: evidence(db, operation),
  });
}

function insertReview(db, entry) {
  const review = entry.review;
  run(db, `INSERT INTO agent_project_work_result_reviews (
    work_result_review_id, work_result_id, work_result_digest,
    definition_digest, record_version, assignment_id, assignment_status_id,
    lease_id, agent_id, agent_version_id, owner_id, project_id,
    conversation_id, task_id, run_id, lease_holder_id, work_kind, reviewed_by,
    reviewed_at_ms, result_status, result_summary_code, decision,
    decision_summary_code, review_contract, materialization_boundary,
    assignment_json, status_json, lease_json, result_json, review_json,
    schema_version
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
    review.work_result_review_id,
    review.work_result_id,
    review.work_result_digest,
    review.definition_digest,
    review.record_version,
    review.assignment_id,
    review.assignment_status_id,
    review.lease_id,
    review.agent_id,
    review.agent_version_id,
    review.owner_id,
    review.project_id,
    review.conversation_id,
    review.task_id,
    review.run_id,
    review.lease_holder_id,
    review.work_kind,
    review.reviewed_by,
    review.reviewed_at_ms,
    review.result.status,
    review.result.summary_code,
    review.decision,
    review.decision_summary_code,
    review.review_contract,
    review.materialization_boundary,
    canonicalJson(entry.assignment),
    canonicalJson(entry.status),
    canonicalJson(entry.lease),
    canonicalJson(entry.result),
    canonicalJson(review),
    BUILDER_AGENT_PROJECT_WORK_RESULT_REVIEW_STORE_SCHEMA_VERSION,
  ]);
}

function recordProjectWorkResultReview(db, rawRequest) {
  const requested = sanitizeReviewRequest(rawRequest);
  db.exec('BEGIN IMMEDIATE');
  try {
    const existing = loadEntryByReviewId(db, requested.review.work_result_review_id);
    if (existing !== null) {
      if (!sameEntry(existing, requested)) {
        fail('builder_agent_project_work_result_review_store_conflict');
      }
      db.exec('COMMIT');
      return storeResult(db, 'project_work_result_review_replayed', {
        project_work_result_review: existing,
      });
    }
    if (loadEntryByWorkResultId(db, requested.review.work_result_id) !== null) {
      fail('builder_agent_project_work_result_review_store_conflict');
    }
    insertReview(db, requested);
    const readback = loadEntryByReviewId(db, requested.review.work_result_review_id);
    if (readback === null || !sameEntry(readback, requested)) {
      fail('builder_agent_project_work_result_review_store_integrity_failed');
    }
    db.exec('COMMIT');
    return storeResult(db, 'project_work_result_review_recorded', {
      project_work_result_review: readback,
    });
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* fixed failure below */ }
    throw error;
  }
}

function readyReadResult(db, entry, transaction) {
  return freezeDeep({
    result_version: BUILDER_AGENT_PROJECT_WORK_RESULT_REVIEW_STORE_READ_RESULT_VERSION,
    project_work_result_review_authority: 'main_owned_agent_project_work_result_review_store',
    status: 'ready',
    project_work_result_review: entry,
    evidence: evidence(db, transaction),
  });
}

function absentReadResult(db, payload, transaction) {
  return freezeDeep({
    result_version: BUILDER_AGENT_PROJECT_WORK_RESULT_REVIEW_STORE_READ_RESULT_VERSION,
    project_work_result_review_authority: 'main_owned_agent_project_work_result_review_store',
    status: 'absent',
    ...payload,
    project_work_result_review: null,
    evidence: evidence(db, transaction),
  });
}

function readProjectWorkResultReview(db, rawRequest) {
  exactObject(rawRequest, READ_REVIEW_KEYS);
  const reviewId = safeWorkResultReviewId(valueAt(rawRequest, 'work_result_review_id'));
  const ownerId = safeOwnerId(valueAt(rawRequest, 'owner_id'));
  const entry = loadEntryByReviewId(db, reviewId);
  if (entry === null || entry.review.owner_id !== ownerId) {
    return absentReadResult(db, {
      work_result_review_id: reviewId,
      owner_id: ownerId,
    }, 'project_work_result_review_absent_read');
  }
  return freezeDeep({
    ...readyReadResult(db, entry, 'project_work_result_review_ready_read'),
    work_result_review_id: reviewId,
    owner_id: ownerId,
  });
}

function readProjectWorkResultReviewForResult(db, rawRequest) {
  exactObject(rawRequest, READ_REVIEW_BY_RESULT_KEYS);
  const workResultId = safeWorkResultId(valueAt(rawRequest, 'work_result_id'));
  const ownerId = safeOwnerId(valueAt(rawRequest, 'owner_id'));
  const entry = loadEntryByWorkResultId(db, workResultId);
  if (entry === null || entry.review.owner_id !== ownerId) {
    return absentReadResult(db, {
      work_result_id: workResultId,
      owner_id: ownerId,
    }, 'project_work_result_review_for_result_absent_read');
  }
  return freezeDeep({
    ...readyReadResult(db, entry, 'project_work_result_review_for_result_ready_read'),
    work_result_id: workResultId,
    owner_id: ownerId,
  });
}

function listTaskProjectWorkResultReviews(db, rawRequest) {
  exactObject(rawRequest, LIST_TASK_REVIEWS_KEYS);
  const ownerId = safeOwnerId(valueAt(rawRequest, 'owner_id'));
  const projectId = safeProjectId(valueAt(rawRequest, 'project_id'));
  const taskId = safeTaskId(valueAt(rawRequest, 'task_id'));
  const reviews = taskEntries(db, ownerId, projectId, taskId);
  return freezeDeep({
    result_version: BUILDER_AGENT_PROJECT_WORK_RESULT_REVIEW_STORE_READ_RESULT_VERSION,
    project_work_result_review_authority: 'main_owned_agent_project_work_result_review_store',
    status: reviews.length === 0 ? 'absent' : 'ready',
    owner_id: ownerId,
    project_id: projectId,
    task_id: taskId,
    project_work_result_reviews: reviews,
    evidence: evidence(db, reviews.length === 0
      ? 'task_project_work_result_reviews_absent_read'
      : 'task_project_work_result_reviews_ready_read'),
  });
}

function ownErrorField(error, key) {
  if (!error || typeof error !== 'object' || utilTypes.isProxy(error)) return null;
  const descriptor = Object.getOwnPropertyDescriptor(error, key);
  return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : null;
}

function normalizeOperationError(error) {
  if (error instanceof BuilderAgentProjectWorkResultReviewStoreError) {
    return new BuilderAgentProjectWorkResultReviewStoreError(error.code);
  }
  if (error instanceof BuilderAgentProjectWorkResultReviewContractError) {
    return new BuilderAgentProjectWorkResultReviewStoreError(
      'builder_agent_project_work_result_review_store_invalid',
    );
  }
  const sqliteCode = ownErrorField(error, 'code');
  const sqliteErrstr = ownErrorField(error, 'errstr');
  const sqliteErrcode = ownErrorField(error, 'errcode');
  if (sqliteCode && /^SQLITE_CONSTRAINT/u.test(sqliteCode)) {
    return new BuilderAgentProjectWorkResultReviewStoreError(
      'builder_agent_project_work_result_review_store_integrity_failed',
    );
  }
  if (sqliteErrstr === 'constraint failed' || sqliteErrcode === 1555) {
    return new BuilderAgentProjectWorkResultReviewStoreError(
      'builder_agent_project_work_result_review_store_integrity_failed',
    );
  }
  if (sqliteCode && /^SQLITE_(CORRUPT|NOTADB|SCHEMA|INTERNAL|MISMATCH)/u.test(sqliteCode)) {
    return new BuilderAgentProjectWorkResultReviewStoreError(
      'builder_agent_project_work_result_review_store_integrity_failed',
    );
  }
  return new BuilderAgentProjectWorkResultReviewStoreError(
    'builder_agent_project_work_result_review_store_unavailable',
  );
}

function createBuilderAgentProjectWorkResultReviewStore(databasePath) {
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
    store_version: BUILDER_AGENT_PROJECT_WORK_RESULT_REVIEW_STORE_VERSION,

    close(...rawArguments) {
      if (rawArguments.length !== 0) {
        throw new BuilderAgentProjectWorkResultReviewStoreError(
          'builder_agent_project_work_result_review_store_invalid',
        );
      }
      try { db.close(); } catch (error) { throw normalizeOperationError(error); }
    },

    record_review(rawRequest) {
      try { return recordProjectWorkResultReview(db, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },

    read_review(rawRequest) {
      try { return readProjectWorkResultReview(db, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },

    read_review_for_result(rawRequest) {
      try { return readProjectWorkResultReviewForResult(db, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },

    list_task_reviews(rawRequest) {
      try { return listTaskProjectWorkResultReviews(db, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },
  });
}

module.exports = Object.freeze({
  BUILDER_AGENT_PROJECT_WORK_RESULT_REVIEW_STORE_READ_RESULT_VERSION,
  BUILDER_AGENT_PROJECT_WORK_RESULT_REVIEW_STORE_RESULT_VERSION,
  BUILDER_AGENT_PROJECT_WORK_RESULT_REVIEW_STORE_SCHEMA_VERSION,
  BUILDER_AGENT_PROJECT_WORK_RESULT_REVIEW_STORE_USER_VERSION,
  BUILDER_AGENT_PROJECT_WORK_RESULT_REVIEW_STORE_VERSION,
  BuilderAgentProjectWorkResultReviewStoreError,
  createBuilderAgentProjectWorkResultReviewStore,
});
