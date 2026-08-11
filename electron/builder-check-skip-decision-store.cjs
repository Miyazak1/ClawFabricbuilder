'use strict';

const nodeCrypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { types: utilTypes } = require('node:util');

const {
  BuilderCheckSkipDecisionError,
  sanitizeBuilderCheckSkipDecision,
} = require('./builder-check-skip-decision.cjs');

const BUILDER_CHECK_SKIP_DECISION_STORE_VERSION = 'builder-check-skip-decision-store.v1';
const BUILDER_CHECK_SKIP_DECISION_STORE_RESULT_VERSION = 'builder-check-skip-decision-store-result.v1';
const BUILDER_CHECK_SKIP_DECISION_STORE_READ_RESULT_VERSION = 'builder-check-skip-decision-store-read-result.v1';
const BUILDER_CHECK_SKIP_DECISION_STORE_SCHEMA_VERSION = 'builder-check-skip-decision-store-schema.v1';
const BUILDER_CHECK_SKIP_DECISION_STORE_USER_VERSION = 1;
const DATABASE_ID = 'builder-check-skip-decision-store.v1';
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const PROJECT_ID_PATTERN = new RegExp(`^builder-project:${UUID_SOURCE}$`, 'u');
const CANDIDATE_ID_PATTERN = /^builder-code-change-candidate:[0-9a-f]{64}$/u;
const RECORD_KEYS = Object.freeze(['check_skip_decision']);
const READ_KEYS = Object.freeze(['project_id', 'candidate_id']);
const MAX_RECORD_JSON_BYTES = 32 * 1024;
const CREATE_SCHEMA_SQL = Object.freeze([
  `CREATE TABLE check_skip_decisions (
    decision_id TEXT NOT NULL PRIMARY KEY,
    decision_version TEXT NOT NULL,
    decision_digest TEXT NOT NULL UNIQUE,
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
    reason_code TEXT NOT NULL,
    decided_at_ms INTEGER NOT NULL,
    record_json TEXT NOT NULL,
    schema_version TEXT NOT NULL,
    UNIQUE(project_id, candidate_id),
    CHECK (schema_version = 'builder-check-skip-decision-store-schema.v1'),
    CHECK (decision_version = 'builder-check-skip-decision.v1'),
    CHECK (reason_code = 'user_chose_save_without_check'),
    CHECK (draft_checkpoint_sequence BETWEEN 1 AND 1000000),
    CHECK (decided_at_ms >= 0),
    CHECK (length(record_json) BETWEEN 2 AND 32768)
  ) STRICT`,
  'CREATE INDEX check_skip_decisions_candidate_idx ON check_skip_decisions(project_id, candidate_id, decided_at_ms DESC)',
]);
const ERROR_MESSAGES = Object.freeze({
  builder_check_skip_decision_store_invalid: 'Builder check skip storage request could not be verified.',
  builder_check_skip_decision_store_conflict: 'Builder check skip decision changed before it could be recorded.',
  builder_check_skip_decision_store_integrity_failed: 'Builder check skip storage integrity could not be verified.',
  builder_check_skip_decision_store_resource_exceeded: 'Builder check skip storage limits were reached.',
  builder_check_skip_decision_store_unavailable: 'Builder check skip storage is unavailable.',
});

class BuilderCheckSkipDecisionStoreError extends Error {
  constructor(code = 'builder_check_skip_decision_store_invalid') {
    const selected = Object.hasOwn(ERROR_MESSAGES, code)
      ? code
      : 'builder_check_skip_decision_store_invalid';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderCheckSkipDecisionStoreError';
    this.code = selected;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) { throw new BuilderCheckSkipDecisionStoreError(code); }

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freezeDeep(nested);
    Object.freeze(value);
  }
  return value;
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || utilTypes.isProxy(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactObject(value, keys) {
  if (!isPlainObject(value)) fail('builder_check_skip_decision_store_invalid');
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== keys.length || ownKeys.some(
    (key) => typeof key !== 'string' || !keys.includes(key),
  )) fail('builder_check_skip_decision_store_invalid');
  for (const key of ownKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      fail('builder_check_skip_decision_store_invalid');
    }
  }
  return value;
}

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
    fail('builder_check_skip_decision_store_invalid');
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
  fail('builder_check_skip_decision_store_invalid');
}

function sha256Canonical(value) {
  return nodeCrypto.createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

function safePattern(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) {
    fail('builder_check_skip_decision_store_invalid');
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
  ) fail('builder_check_skip_decision_store_invalid');
  return value;
}

function assertParentDirectory(filePath) {
  let info;
  try { info = fs.lstatSync(path.dirname(filePath)); } catch { fail('builder_check_skip_decision_store_unavailable'); }
  if (!info.isDirectory() || info.isSymbolicLink()) fail('builder_check_skip_decision_store_unavailable');
}

function one(db, sql, params = []) { return db.prepare(sql).get(...params) ?? null; }
function all(db, sql, params = []) { return db.prepare(sql).all(...params); }

function configurePragmas(db) {
  db.exec('PRAGMA trusted_schema = OFF');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA synchronous = FULL');
  const journal = one(db, 'PRAGMA journal_mode = WAL');
  if (String(journal?.journal_mode ?? '').toLowerCase() !== 'wal') {
    fail('builder_check_skip_decision_store_unavailable');
  }
}

function createSchema(db) {
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const sql of CREATE_SCHEMA_SQL) db.exec(sql);
    db.exec(`PRAGMA user_version = ${BUILDER_CHECK_SKIP_DECISION_STORE_USER_VERSION}`);
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* fixed failure below */ }
    throw error;
  }
}

function schemaRows(db) {
  return all(db, `SELECT type, name, tbl_name, sql
    FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name, tbl_name`);
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

function schemaFingerprint(db) { return `sha256:${sha256Canonical(schemaRows(db))}`; }

function verifySchema(db) {
  const version = one(db, 'PRAGMA user_version');
  if (
    !version
    || version.user_version !== BUILDER_CHECK_SKIP_DECISION_STORE_USER_VERSION
    || canonicalJson(schemaRows(db)) !== expectedFingerprint()
  ) fail('builder_check_skip_decision_store_integrity_failed');
}

function openDatabase(databasePath) {
  const selected = safeDatabasePath(databasePath);
  assertParentDirectory(selected);
  let exists = false;
  try {
    const info = fs.lstatSync(selected);
    if (!info.isFile() || info.isSymbolicLink()) fail('builder_check_skip_decision_store_unavailable');
    exists = true;
  } catch (error) {
    if (error instanceof BuilderCheckSkipDecisionStoreError) throw error;
  }
  let db;
  try {
    db = new DatabaseSync(selected);
    configurePragmas(db);
    if (!exists) createSchema(db);
    verifySchema(db);
    return db;
  } catch (error) {
    try { db?.close(); } catch { /* fixed failure below */ }
    if (error instanceof BuilderCheckSkipDecisionStoreError) throw error;
    fail('builder_check_skip_decision_store_unavailable');
  }
}

function safeDecision(value) {
  try { return sanitizeBuilderCheckSkipDecision(value); } catch (error) {
    if (error instanceof BuilderCheckSkipDecisionError) {
      fail('builder_check_skip_decision_store_invalid');
    }
    fail('builder_check_skip_decision_store_unavailable');
  }
}

function recordJson(decision) {
  const json = canonicalJson(decision);
  if (Buffer.byteLength(json, 'utf8') > MAX_RECORD_JSON_BYTES) {
    fail('builder_check_skip_decision_store_resource_exceeded');
  }
  return json;
}

function evidence(db, operation) {
  return freezeDeep({
    store_authority: 'main_owned_check_skip_decision_store',
    decision_contract_authority: 'main_owned_check_skip_decision_contract_v1',
    operation,
    schema_version: BUILDER_CHECK_SKIP_DECISION_STORE_SCHEMA_VERSION,
    user_version: BUILDER_CHECK_SKIP_DECISION_STORE_USER_VERSION,
    database_id: DATABASE_ID,
    schema_fingerprint_digest: schemaFingerprint(db),
    renderer_authority: 'not_present',
    ipc_authority: 'not_present',
    provider_dispatch: false,
    command_execution: false,
    source_read: 'decision_record_only',
    source_write: 'not_present',
    git_mutation: false,
    save_authority: false,
    permission_grant_authority: false,
    secret_access: 'not_present',
    network_access: false,
    recovery_model: 'canonical_sqlite_restart_replay',
  });
}

const COLUMNS = [
  'decision_id', 'decision_version', 'decision_digest', 'project_id', 'conversation_id',
  'turn_id', 'task_id', 'run_id', 'draft_id', 'draft_checkpoint_id',
  'draft_checkpoint_sequence', 'candidate_id', 'candidate_digest', 'resulting_tree_digest',
  'reason_code', 'decided_at_ms', 'record_json',
].join(', ');

function rowToDecision(row) {
  if (row === null) return null;
  let parsed;
  try { parsed = JSON.parse(row.record_json); } catch { fail('builder_check_skip_decision_store_integrity_failed'); }
  let decision;
  try { decision = safeDecision(parsed); } catch { fail('builder_check_skip_decision_store_integrity_failed'); }
  for (const key of [
    'decision_id', 'decision_version', 'decision_digest', 'project_id', 'conversation_id',
    'turn_id', 'task_id', 'run_id', 'draft_id', 'draft_checkpoint_id',
    'draft_checkpoint_sequence', 'candidate_id', 'candidate_digest', 'resulting_tree_digest',
    'reason_code', 'decided_at_ms',
  ]) {
    if (row[key] !== decision[key]) fail('builder_check_skip_decision_store_integrity_failed');
  }
  if (row.record_json !== canonicalJson(decision)) fail('builder_check_skip_decision_store_integrity_failed');
  return decision;
}

function writeResult(db, operation, decision) {
  return freezeDeep({
    result_version: BUILDER_CHECK_SKIP_DECISION_STORE_RESULT_VERSION,
    operation,
    check_skip_decision: decision,
    store_evidence: evidence(db, operation),
  });
}

function readResult(db, status, decision) {
  return freezeDeep({
    result_version: BUILDER_CHECK_SKIP_DECISION_STORE_READ_RESULT_VERSION,
    operation: 'current_check_skip_decision_read',
    status,
    check_skip_decision: decision,
    store_evidence: evidence(db, 'current_check_skip_decision_read'),
  });
}

function createBuilderCheckSkipDecisionStore(databasePath) {
  const db = openDatabase(databasePath);
  let closed = false;
  function assertOpen() { if (closed) fail('builder_check_skip_decision_store_unavailable'); }

  return freezeDeep({
    store_version: BUILDER_CHECK_SKIP_DECISION_STORE_VERSION,

    record_check_skip_decision(rawRequest) {
      assertOpen();
      const request = exactObject(rawRequest, RECORD_KEYS);
      const decision = safeDecision(valueAt(request, 'check_skip_decision'));
      const json = recordJson(decision);
      db.exec('BEGIN IMMEDIATE');
      try {
        const existing = rowToDecision(one(
          db,
          `SELECT ${COLUMNS} FROM check_skip_decisions
            WHERE decision_id = ? OR (project_id = ? AND candidate_id = ?)`,
          [decision.decision_id, decision.project_id, decision.candidate_id],
        ));
        if (existing !== null) {
          if (canonicalJson(existing) !== json) fail('builder_check_skip_decision_store_conflict');
          db.exec('COMMIT');
          return writeResult(db, 'check_skip_decision_replayed', existing);
        }
        db.prepare(`INSERT INTO check_skip_decisions (
          decision_id, decision_version, decision_digest, project_id, conversation_id,
          turn_id, task_id, run_id, draft_id, draft_checkpoint_id, draft_checkpoint_sequence,
          candidate_id, candidate_digest, resulting_tree_digest, reason_code, decided_at_ms,
          record_json, schema_version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          decision.decision_id,
          decision.decision_version,
          decision.decision_digest,
          decision.project_id,
          decision.conversation_id,
          decision.turn_id,
          decision.task_id,
          decision.run_id,
          decision.draft_id,
          decision.draft_checkpoint_id,
          decision.draft_checkpoint_sequence,
          decision.candidate_id,
          decision.candidate_digest,
          decision.resulting_tree_digest,
          decision.reason_code,
          decision.decided_at_ms,
          json,
          BUILDER_CHECK_SKIP_DECISION_STORE_SCHEMA_VERSION,
        );
        db.exec('COMMIT');
        return writeResult(db, 'check_skip_decision_recorded', decision);
      } catch (error) {
        try { db.exec('ROLLBACK'); } catch { /* normalized below */ }
        if (error instanceof BuilderCheckSkipDecisionStoreError) throw error;
        fail('builder_check_skip_decision_store_unavailable');
      }
    },

    read_current_check_skip_decision(rawRequest) {
      assertOpen();
      const request = exactObject(rawRequest, READ_KEYS);
      const projectId = safePattern(valueAt(request, 'project_id'), PROJECT_ID_PATTERN);
      const candidateId = safePattern(valueAt(request, 'candidate_id'), CANDIDATE_ID_PATTERN);
      let decision;
      try {
        decision = rowToDecision(one(
          db,
          `SELECT ${COLUMNS} FROM check_skip_decisions WHERE project_id = ? AND candidate_id = ?`,
          [projectId, candidateId],
        ));
      } catch (error) {
        if (error instanceof BuilderCheckSkipDecisionStoreError) throw error;
        fail('builder_check_skip_decision_store_unavailable');
      }
      return readResult(db, decision === null ? 'absent' : 'ready', decision);
    },

    close() {
      if (closed) return;
      closed = true;
      try { db.close(); } catch { fail('builder_check_skip_decision_store_unavailable'); }
    },
  });
}

module.exports = freezeDeep({
  BUILDER_CHECK_SKIP_DECISION_STORE_READ_RESULT_VERSION,
  BUILDER_CHECK_SKIP_DECISION_STORE_RESULT_VERSION,
  BUILDER_CHECK_SKIP_DECISION_STORE_SCHEMA_VERSION,
  BUILDER_CHECK_SKIP_DECISION_STORE_VERSION,
  BuilderCheckSkipDecisionStoreError,
  createBuilderCheckSkipDecisionStore,
});
