'use strict';

const nodeCrypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { types: utilTypes } = require('node:util');

const {
  BuilderCheckRunError,
  sanitizeBuilderCheckRun,
} = require('./builder-check-run.cjs');

const BUILDER_CHECK_RUN_STORE_VERSION = 'builder-check-run-store.v1';
const BUILDER_CHECK_RUN_STORE_RESULT_VERSION = 'builder-check-run-store-result.v1';
const BUILDER_CHECK_RUN_STORE_READ_RESULT_VERSION = 'builder-check-run-store-read-result.v1';
const BUILDER_CHECK_RUN_STORE_SCHEMA_VERSION = 'builder-check-run-store-schema.v1';
const BUILDER_CHECK_RUN_STORE_USER_VERSION = 1;
const DATABASE_ID = 'builder-check-run-store.v1';
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const PROJECT_ID_PATTERN = new RegExp(`^builder-project:${UUID_SOURCE}$`, 'u');
const CANDIDATE_ID_PATTERN = /^builder-code-change-candidate:[0-9a-f]{64}$/u;
const RECORD_KEYS = Object.freeze(['check_run']);
const READ_LATEST_KEYS = Object.freeze(['project_id', 'candidate_id']);
const LIST_KEYS = Object.freeze(['project_id', 'candidate_id', 'limit']);
const MAX_LIST_LIMIT = 32;
const MAX_RECORD_JSON_BYTES = 128 * 1024;
const CREATE_SCHEMA_SQL = Object.freeze([
  `CREATE TABLE check_runs (
    check_run_id TEXT NOT NULL PRIMARY KEY,
    check_run_version TEXT NOT NULL,
    check_run_digest TEXT NOT NULL UNIQUE,
    admission_id TEXT NOT NULL UNIQUE,
    admission_digest TEXT NOT NULL,
    approval_id TEXT NOT NULL UNIQUE,
    approval_digest TEXT NOT NULL,
    project_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    turn_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    draft_id TEXT NOT NULL,
    draft_checkpoint_id TEXT NOT NULL,
    draft_checkpoint_sequence INTEGER NOT NULL,
    candidate_id TEXT NOT NULL,
    candidate_digest TEXT NOT NULL,
    resulting_tree_digest TEXT NOT NULL,
    command_profile_id TEXT NOT NULL,
    command_kind TEXT NOT NULL,
    script_digest TEXT NOT NULL,
    invocation_digest TEXT NOT NULL,
    execution_policy_json TEXT NOT NULL,
    status TEXT NOT NULL,
    started_at_ms INTEGER NOT NULL,
    completed_at_ms INTEGER NOT NULL,
    record_json TEXT NOT NULL,
    schema_version TEXT NOT NULL,
    CHECK (schema_version = 'builder-check-run-store-schema.v1'),
    CHECK (check_run_version = 'builder-check-run.v1'),
    CHECK (draft_checkpoint_sequence BETWEEN 1 AND 1000000),
    CHECK (status IN ('passed', 'failed', 'timed_out', 'environment_unavailable', 'cancelled', 'spawn_failed')),
    CHECK (started_at_ms >= 0),
    CHECK (completed_at_ms >= started_at_ms),
    CHECK (length(record_json) BETWEEN 2 AND 131072)
  ) STRICT`,
  'CREATE INDEX check_runs_candidate_latest_idx ON check_runs(project_id, candidate_id, completed_at_ms DESC, started_at_ms DESC, check_run_id DESC)',
]);
const ERROR_MESSAGES = Object.freeze({
  builder_check_run_store_invalid: 'Builder check run storage request could not be verified.',
  builder_check_run_store_conflict: 'Builder check run changed before it could be recorded.',
  builder_check_run_store_integrity_failed: 'Builder check run storage integrity could not be verified.',
  builder_check_run_store_resource_exceeded: 'Builder check run storage limits were reached.',
  builder_check_run_store_unavailable: 'Builder check run storage is unavailable.',
});

class BuilderCheckRunStoreError extends Error {
  constructor(code = 'builder_check_run_store_invalid') {
    const selected = Object.hasOwn(ERROR_MESSAGES, code)
      ? code
      : 'builder_check_run_store_invalid';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderCheckRunStoreError';
    this.code = selected;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) {
  throw new BuilderCheckRunStoreError(code);
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
  if (!isPlainObject(value)) fail('builder_check_run_store_invalid');
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== keys.length
    || actual.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) fail('builder_check_run_store_invalid');
  for (const key of actual) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      fail('builder_check_run_store_invalid');
    }
  }
}

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
    fail('builder_check_run_store_invalid');
  }
  return descriptor.value;
}

function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number' && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map(
      (key) => `${JSON.stringify(key)}:${canonicalJson(valueAt(value, key))}`,
    ).join(',')}}`;
  }
  fail('builder_check_run_store_invalid');
}

function sha256Canonical(value) {
  return nodeCrypto.createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

function safePattern(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) {
    fail('builder_check_run_store_invalid');
  }
  return value;
}

function safeProjectId(value) {
  return safePattern(value, PROJECT_ID_PATTERN);
}

function safeCandidateId(value) {
  return safePattern(value, CANDIDATE_ID_PATTERN);
}

function safeLimit(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_LIST_LIMIT) {
    fail('builder_check_run_store_invalid');
  }
  return value;
}

function hasControlCharacter(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
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
  ) fail('builder_check_run_store_invalid');
  return value;
}

function assertParentDirectory(filePath) {
  let info;
  try {
    info = fs.lstatSync(path.dirname(filePath));
  } catch {
    fail('builder_check_run_store_unavailable');
  }
  if (!info.isDirectory() || info.isSymbolicLink()) {
    fail('builder_check_run_store_unavailable');
  }
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

function configurePragmas(db) {
  db.exec('PRAGMA trusted_schema = OFF');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA synchronous = FULL');
  const journal = one(db, 'PRAGMA journal_mode = WAL');
  if (String(journal?.journal_mode ?? '').toLowerCase() !== 'wal') {
    fail('builder_check_run_store_unavailable');
  }
}

function createSchema(db) {
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const sql of CREATE_SCHEMA_SQL) db.exec(sql);
    db.exec(`PRAGMA user_version = ${BUILDER_CHECK_RUN_STORE_USER_VERSION}`);
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* fixed failure below */ }
    throw error;
  }
}

function schemaRows(db) {
  return all(
    db,
    `SELECT type, name, tbl_name, sql
       FROM sqlite_schema
      WHERE name NOT LIKE 'sqlite_%'
      ORDER BY type, name, tbl_name`,
  );
}

let expectedSchemaFingerprint;
function expectedFingerprint() {
  if (expectedSchemaFingerprint !== undefined) return expectedSchemaFingerprint;
  const db = new DatabaseSync(':memory:');
  try {
    for (const sql of CREATE_SCHEMA_SQL) db.exec(sql);
    expectedSchemaFingerprint = canonicalJson(schemaRows(db));
    return expectedSchemaFingerprint;
  } finally {
    db.close();
  }
}

function schemaFingerprint(db) {
  return `sha256:${sha256Canonical(schemaRows(db))}`;
}

function verifySchema(db) {
  const version = one(db, 'PRAGMA user_version');
  if (
    !version
    || version.user_version !== BUILDER_CHECK_RUN_STORE_USER_VERSION
    || canonicalJson(schemaRows(db)) !== expectedFingerprint()
  ) fail('builder_check_run_store_integrity_failed');
}

function openDatabase(databasePath) {
  const safePath = safeDatabasePath(databasePath);
  assertParentDirectory(safePath);
  let exists = false;
  try {
    const info = fs.lstatSync(safePath);
    if (!info.isFile() || info.isSymbolicLink()) {
      fail('builder_check_run_store_unavailable');
    }
    exists = true;
  } catch (error) {
    if (error instanceof BuilderCheckRunStoreError) throw error;
  }
  let db;
  try {
    db = new DatabaseSync(safePath);
    configurePragmas(db);
    if (!exists) createSchema(db);
    verifySchema(db);
    return db;
  } catch (error) {
    try { db?.close(); } catch { /* fixed failure below */ }
    if (error instanceof BuilderCheckRunStoreError) throw error;
    fail('builder_check_run_store_unavailable');
  }
}

function normalizeCheckRunError(error) {
  if (error instanceof BuilderCheckRunStoreError) return error;
  if (BuilderCheckRunError && error instanceof BuilderCheckRunError) {
    return new BuilderCheckRunStoreError('builder_check_run_store_invalid');
  }
  return new BuilderCheckRunStoreError('builder_check_run_store_unavailable');
}

function safeCheckRun(rawValue) {
  try {
    return sanitizeBuilderCheckRun(rawValue);
  } catch (error) {
    throw normalizeCheckRunError(error);
  }
}

function recordJson(checkRun) {
  const serialized = canonicalJson(checkRun);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_RECORD_JSON_BYTES) {
    fail('builder_check_run_store_resource_exceeded');
  }
  return serialized;
}

function evidence(db, operation) {
  return freezeDeep({
    store_authority: 'main_owned_check_run_store',
    check_run_contract_authority: 'main_owned_check_run_contract_v1',
    operation,
    schema_version: BUILDER_CHECK_RUN_STORE_SCHEMA_VERSION,
    user_version: BUILDER_CHECK_RUN_STORE_USER_VERSION,
    database_id: DATABASE_ID,
    schema_fingerprint_digest: schemaFingerprint(db),
    renderer_authority: 'not_present',
    ipc_authority: 'not_present',
    provider_dispatch: false,
    command_execution: false,
    source_read: 'check_run_record_only',
    source_write: 'not_present',
    git_mutation: false,
    save_authority: false,
    permission_grant_authority: false,
    secret_access: 'not_present',
    network_access: false,
    recovery_model: 'canonical_sqlite_restart_replay',
  });
}

function checkRunColumns() {
  return [
    'check_run_id',
    'check_run_version',
    'check_run_digest',
    'admission_id',
    'admission_digest',
    'approval_id',
    'approval_digest',
    'project_id',
    'conversation_id',
    'turn_id',
    'task_id',
    'run_id',
    'draft_id',
    'draft_checkpoint_id',
    'draft_checkpoint_sequence',
    'candidate_id',
    'candidate_digest',
    'resulting_tree_digest',
    'command_profile_id',
    'command_kind',
    'script_digest',
    'invocation_digest',
    'execution_policy_json',
    'status',
    'started_at_ms',
    'completed_at_ms',
    'record_json',
  ].join(', ');
}

function rowToCheckRun(row) {
  if (row === null) return null;
  let parsed;
  try {
    parsed = JSON.parse(row.record_json);
  } catch {
    fail('builder_check_run_store_integrity_failed');
  }
  let checkRun;
  try {
    checkRun = safeCheckRun(parsed);
  } catch {
    fail('builder_check_run_store_integrity_failed');
  }
  if (
    canonicalJson(checkRun) !== row.record_json
    || row.check_run_id !== checkRun.check_run_id
    || row.check_run_version !== checkRun.check_run_version
    || row.check_run_digest !== checkRun.check_run_digest
    || row.admission_id !== checkRun.admission_id
    || row.admission_digest !== checkRun.admission_digest
    || row.approval_id !== checkRun.approval_id
    || row.approval_digest !== checkRun.approval_digest
    || row.project_id !== checkRun.project_id
    || row.conversation_id !== checkRun.conversation_id
    || row.turn_id !== checkRun.turn_id
    || row.task_id !== checkRun.task_id
    || row.run_id !== checkRun.run_id
    || row.draft_id !== checkRun.draft_id
    || row.draft_checkpoint_id !== checkRun.draft_checkpoint_id
    || row.draft_checkpoint_sequence !== checkRun.draft_checkpoint_sequence
    || row.candidate_id !== checkRun.candidate_id
    || row.candidate_digest !== checkRun.candidate_digest
    || row.resulting_tree_digest !== checkRun.resulting_tree_digest
    || row.command_profile_id !== checkRun.command_profile_id
    || row.command_kind !== checkRun.command_kind
    || row.script_digest !== checkRun.script_digest
    || row.invocation_digest !== checkRun.invocation_digest
    || row.execution_policy_json !== canonicalJson(checkRun.execution_policy)
    || row.status !== checkRun.status
    || row.started_at_ms !== checkRun.started_at_ms
    || row.completed_at_ms !== checkRun.completed_at_ms
  ) fail('builder_check_run_store_integrity_failed');
  return checkRun;
}

function writeResult(db, operation, checkRun) {
  return freezeDeep({
    result_version: BUILDER_CHECK_RUN_STORE_RESULT_VERSION,
    operation,
    check_run: checkRun,
    store_evidence: evidence(db, operation),
  });
}

function readResult(db, operation, payload) {
  return freezeDeep({
    result_version: BUILDER_CHECK_RUN_STORE_READ_RESULT_VERSION,
    operation,
    ...payload,
    store_evidence: evidence(db, operation),
  });
}

function sameCheckRun(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function createBuilderCheckRunStore(databasePath) {
  const db = openDatabase(databasePath);

  function recordCheckRun(rawRequest) {
    try {
      exactObject(rawRequest, RECORD_KEYS);
      const checkRun = safeCheckRun(valueAt(rawRequest, 'check_run'));
      const json = recordJson(checkRun);
      db.exec('BEGIN IMMEDIATE');
      try {
        const existing = rowToCheckRun(one(
          db,
          `SELECT ${checkRunColumns()} FROM check_runs
            WHERE check_run_id = ? OR admission_id = ? OR approval_id = ?`,
          [checkRun.check_run_id, checkRun.admission_id, checkRun.approval_id],
        ));
        if (existing !== null) {
          if (!sameCheckRun(existing, checkRun)) {
            fail('builder_check_run_store_conflict');
          }
          db.exec('COMMIT');
          return writeResult(db, 'check_run_replayed', existing);
        }
        run(
          db,
          `INSERT INTO check_runs (
            check_run_id, check_run_version, check_run_digest, admission_id, admission_digest,
            approval_id, approval_digest, project_id, conversation_id, turn_id, task_id, run_id,
            draft_id, draft_checkpoint_id, draft_checkpoint_sequence, candidate_id,
            candidate_digest, resulting_tree_digest, command_profile_id, command_kind,
            script_digest, invocation_digest, execution_policy_json, status,
            started_at_ms, completed_at_ms, record_json, schema_version
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)` ,
          [
            checkRun.check_run_id,
            checkRun.check_run_version,
            checkRun.check_run_digest,
            checkRun.admission_id,
            checkRun.admission_digest,
            checkRun.approval_id,
            checkRun.approval_digest,
            checkRun.project_id,
            checkRun.conversation_id,
            checkRun.turn_id,
            checkRun.task_id,
            checkRun.run_id,
            checkRun.draft_id,
            checkRun.draft_checkpoint_id,
            checkRun.draft_checkpoint_sequence,
            checkRun.candidate_id,
            checkRun.candidate_digest,
            checkRun.resulting_tree_digest,
            checkRun.command_profile_id,
            checkRun.command_kind,
            checkRun.script_digest,
            checkRun.invocation_digest,
            canonicalJson(checkRun.execution_policy),
            checkRun.status,
            checkRun.started_at_ms,
            checkRun.completed_at_ms,
            json,
            BUILDER_CHECK_RUN_STORE_SCHEMA_VERSION,
          ],
        );
        const inserted = rowToCheckRun(one(
          db,
          `SELECT ${checkRunColumns()} FROM check_runs WHERE check_run_id = ?`,
          [checkRun.check_run_id],
        ));
        if (inserted === null || !sameCheckRun(inserted, checkRun)) {
          fail('builder_check_run_store_integrity_failed');
        }
        db.exec('COMMIT');
        return writeResult(db, 'check_run_recorded', inserted);
      } catch (error) {
        try { db.exec('ROLLBACK'); } catch { /* fixed failure below */ }
        throw error;
      }
    } catch (error) {
      throw normalizeCheckRunError(error);
    }
  }

  function readLatestCheckRun(rawRequest) {
    try {
      exactObject(rawRequest, READ_LATEST_KEYS);
      const projectId = safeProjectId(valueAt(rawRequest, 'project_id'));
      const candidateId = safeCandidateId(valueAt(rawRequest, 'candidate_id'));
      const checkRun = rowToCheckRun(one(
        db,
        `SELECT ${checkRunColumns()} FROM check_runs
          WHERE project_id = ? AND candidate_id = ?
          ORDER BY completed_at_ms DESC, started_at_ms DESC, check_run_id DESC
          LIMIT 1`,
        [projectId, candidateId],
      ));
      return readResult(db, 'latest_check_run_read', {
        status: checkRun === null ? 'absent' : 'ready',
        check_run: checkRun,
      });
    } catch (error) {
      throw normalizeCheckRunError(error);
    }
  }

  function listCheckRuns(rawRequest) {
    try {
      exactObject(rawRequest, LIST_KEYS);
      const projectId = safeProjectId(valueAt(rawRequest, 'project_id'));
      const candidateId = safeCandidateId(valueAt(rawRequest, 'candidate_id'));
      const limit = safeLimit(valueAt(rawRequest, 'limit'));
      const rows = all(
        db,
        `SELECT ${checkRunColumns()} FROM check_runs
          WHERE project_id = ? AND candidate_id = ?
          ORDER BY completed_at_ms DESC, started_at_ms DESC, check_run_id DESC
          LIMIT ?`,
        [projectId, candidateId, limit + 1],
      );
      const checkRuns = rows.slice(0, limit).map(rowToCheckRun);
      return readResult(db, 'check_runs_listed', {
        status: checkRuns.length === 0 ? 'absent' : 'ready',
        check_runs: checkRuns,
        truncated: rows.length > limit,
        limit,
      });
    } catch (error) {
      throw normalizeCheckRunError(error);
    }
  }

  return freezeDeep({
    store_version: BUILDER_CHECK_RUN_STORE_VERSION,
    record_check_run: recordCheckRun,
    read_latest_check_run: readLatestCheckRun,
    list_check_runs: listCheckRuns,
    close() {
      db.close();
    },
  });
}

module.exports = Object.freeze({
  BUILDER_CHECK_RUN_STORE_READ_RESULT_VERSION,
  BUILDER_CHECK_RUN_STORE_RESULT_VERSION,
  BUILDER_CHECK_RUN_STORE_SCHEMA_VERSION,
  BUILDER_CHECK_RUN_STORE_USER_VERSION,
  BUILDER_CHECK_RUN_STORE_VERSION,
  BuilderCheckRunStoreError,
  createBuilderCheckRunStore,
});
