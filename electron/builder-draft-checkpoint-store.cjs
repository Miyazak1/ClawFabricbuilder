'use strict';

const nodeCrypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { types: utilTypes } = require('node:util');

const {
  BUILDER_DRAFT_CHECKPOINT_VERSION,
  BuilderDraftCheckpointError,
  sanitizeBuilderDraftCheckpoint,
} = require('./builder-draft-checkpoint.cjs');

const BUILDER_DRAFT_CHECKPOINT_STORE_VERSION = 'builder-draft-checkpoint-store.v1';
const BUILDER_DRAFT_CHECKPOINT_STORE_RESULT_VERSION = 'builder-draft-checkpoint-store-result.v1';
const BUILDER_DRAFT_CHECKPOINT_STORE_READ_RESULT_VERSION = 'builder-draft-checkpoint-store-read-result.v1';
const BUILDER_DRAFT_CHECKPOINT_STORE_SCHEMA_VERSION = 'builder-draft-checkpoint-store-schema.v1';
const BUILDER_DRAFT_CHECKPOINT_STORE_USER_VERSION = 1;
const DATABASE_ID = 'builder-draft-checkpoint-store.v1';
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const PROJECT_ID_PATTERN = new RegExp(`^builder-project:${UUID_SOURCE}$`, 'u');
const TASK_ADDRESS_ID_PATTERN = new RegExp(`^builder-task-address:${UUID_SOURCE}$`, 'u');
const CHECKPOINT_ID_PATTERN = /^builder-draft-checkpoint:[0-9a-f]{64}$/u;
const RECORD_KEYS = Object.freeze(['draft_checkpoint']);
const READ_KEYS = Object.freeze(['project_id', 'checkpoint_id']);
const READ_LATEST_TASK_KEYS = Object.freeze(['project_id', 'task_address_id']);
const LIST_TASK_KEYS = Object.freeze(['project_id', 'task_address_id']);
const MAX_RECORD_JSON_BYTES = 96 * 1024;
const MAX_TASK_CHECKPOINTS = 128;
const CREATE_SCHEMA_SQL = Object.freeze([
  `CREATE TABLE draft_checkpoints (
    checkpoint_id TEXT NOT NULL PRIMARY KEY,
    checkpoint_version TEXT NOT NULL,
    project_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    task_address_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    turn_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    request_id TEXT NOT NULL,
    checkpoint_sequence INTEGER NOT NULL,
    candidate_id TEXT NOT NULL,
    candidate_digest TEXT NOT NULL,
    resulting_tree_digest TEXT NOT NULL,
    checkpoint_state TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL,
    record_json TEXT NOT NULL,
    schema_version TEXT NOT NULL,
    UNIQUE (project_id, task_address_id, checkpoint_sequence),
    UNIQUE (project_id, candidate_id),
    CHECK (schema_version = 'builder-draft-checkpoint-store-schema.v1'),
    CHECK (checkpoint_version = 'builder-draft-checkpoint.v1'),
    CHECK (checkpoint_state = 'active'),
    CHECK (checkpoint_sequence > 0),
    CHECK (created_at_ms >= 0),
    CHECK (length(record_json) BETWEEN 2 AND 98304)
  ) STRICT`,
  'CREATE INDEX draft_checkpoints_project_task_latest_idx ON draft_checkpoints(project_id, task_address_id, created_at_ms DESC, checkpoint_sequence DESC, checkpoint_id DESC)',
  'CREATE INDEX draft_checkpoints_project_candidate_idx ON draft_checkpoints(project_id, candidate_id)',
]);
const ERROR_MESSAGES = Object.freeze({
  builder_draft_checkpoint_store_invalid: 'Builder draft checkpoint storage request could not be verified.',
  builder_draft_checkpoint_store_conflict: 'Builder draft checkpoint changed before it could be recorded.',
  builder_draft_checkpoint_store_integrity_failed: 'Builder draft checkpoint storage integrity could not be verified.',
  builder_draft_checkpoint_store_resource_exceeded: 'Builder draft checkpoint storage limits were reached.',
  builder_draft_checkpoint_store_unavailable: 'Builder draft checkpoint storage is unavailable.',
});

class BuilderDraftCheckpointStoreError extends Error {
  constructor(code = 'builder_draft_checkpoint_store_invalid') {
    const selected = Object.hasOwn(ERROR_MESSAGES, code)
      ? code
      : 'builder_draft_checkpoint_store_invalid';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderDraftCheckpointStoreError';
    this.code = selected;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) {
  throw new BuilderDraftCheckpointStoreError(code);
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
  if (!isPlainObject(value)) fail('builder_draft_checkpoint_store_invalid');
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== keys.length
    || actual.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) fail('builder_draft_checkpoint_store_invalid');
  for (const key of actual) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      fail('builder_draft_checkpoint_store_invalid');
    }
  }
}

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
    fail('builder_draft_checkpoint_store_invalid');
  }
  return descriptor.value;
}

function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(valueAt(value, key))}`
    )).join(',')}}`;
  }
  fail('builder_draft_checkpoint_store_invalid');
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
  if (typeof value !== 'string' || !pattern.test(value)) fail('builder_draft_checkpoint_store_invalid');
  return value;
}

function safeProjectId(value) {
  return safePattern(value, PROJECT_ID_PATTERN);
}

function safeTaskAddressId(value) {
  return safePattern(value, TASK_ADDRESS_ID_PATTERN);
}

function safeCheckpointId(value) {
  return safePattern(value, CHECKPOINT_ID_PATTERN);
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
  ) fail('builder_draft_checkpoint_store_invalid');
  return value;
}

function assertParentDirectory(filePath) {
  let info;
  try {
    info = fs.lstatSync(path.dirname(filePath));
  } catch {
    fail('builder_draft_checkpoint_store_unavailable');
  }
  if (!info.isDirectory() || info.isSymbolicLink()) {
    fail('builder_draft_checkpoint_store_unavailable');
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

function userVersion(db) {
  const row = one(db, 'PRAGMA user_version');
  if (!row || !Number.isSafeInteger(row.user_version)) {
    fail('builder_draft_checkpoint_store_integrity_failed');
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
  if (String(journal?.journal_mode ?? '').toLowerCase() !== 'wal') {
    fail('builder_draft_checkpoint_store_unavailable');
  }
  const pragmas = runtimePragmas(db);
  if (
    pragmas.foreign_keys !== 'on'
    || pragmas.trusted_schema !== 'off'
    || pragmas.synchronous !== 'full'
    || pragmas.journal_mode !== 'wal'
  ) fail('builder_draft_checkpoint_store_unavailable');
}

function createSchema(db) {
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const sql of CREATE_SCHEMA_SQL) db.exec(sql);
    db.exec(`PRAGMA user_version = ${BUILDER_DRAFT_CHECKPOINT_STORE_USER_VERSION}`);
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
  ).map((row) => ({
    type: row.type,
    name: row.name,
    tbl_name: row.tbl_name,
    sql: row.sql,
  }));
  return freezeDeep({
    database_id: DATABASE_ID,
    schema_version: BUILDER_DRAFT_CHECKPOINT_STORE_SCHEMA_VERSION,
    user_version: userVersion(db),
    objects: schema,
    digest: `sha256:${sha256Canonical({
      database_id: DATABASE_ID,
      schema_version: BUILDER_DRAFT_CHECKPOINT_STORE_SCHEMA_VERSION,
      user_version: userVersion(db),
      objects: schema,
    })}`,
  });
}

function assertSchema(db) {
  if (userVersion(db) !== BUILDER_DRAFT_CHECKPOINT_STORE_USER_VERSION) {
    fail('builder_draft_checkpoint_store_integrity_failed');
  }
  const schema = collectSchemaFingerprint(db);
  const objectNames = schema.objects.map((item) => item.name);
  const expected = [
    'draft_checkpoints_project_candidate_idx',
    'draft_checkpoints_project_task_latest_idx',
    'draft_checkpoints',
  ];
  if (
    objectNames.length !== expected.length
    || expected.some((name, index) => objectNames[index] !== name)
  ) fail('builder_draft_checkpoint_store_integrity_failed');
  return schema;
}

function openDatabase(databasePath) {
  const filePath = safeDatabasePath(databasePath);
  assertParentDirectory(filePath);
  let db;
  try {
    db = new DatabaseSync(filePath, {
      allowExtension: false,
      enableForeignKeyConstraints: true,
      open: true,
      readOnly: false,
    });
    configurePragmas(db);
    const hasSchema = one(
      db,
      "SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'draft_checkpoints'",
    ) !== null;
    if (!hasSchema) createSchema(db);
    assertSchema(db);
    return db;
  } catch (error) {
    try { db?.close(); } catch { /* fixed failure below */ }
    if (error instanceof BuilderDraftCheckpointStoreError) throw error;
    fail('builder_draft_checkpoint_store_unavailable');
  }
}

function checkpointEvidence(db, transaction) {
  const schema = collectSchemaFingerprint(db);
  return freezeDeep({
    database_id: DATABASE_ID,
    schema_version: schema.schema_version,
    user_version: schema.user_version,
    schema_fingerprint_digest: schema.digest,
    runtime_pragmas: runtimePragmas(db),
    transaction,
    checkpoint_authority: 'main_owned_draft_checkpoint_store',
    checkpoint_contract_authority: 'main_draft_checkpoint_contract_v1',
    renderer_authority: 'not_present',
    ipc_authority: 'not_present',
    conversation_append: false,
    provider_dispatch: false,
    model_dispatch: false,
    source_read: 'not_present',
    source_write: 'not_present',
    git_mutation: false,
    permission_grant_authority: false,
    review_authority: false,
    revision_authority: false,
    save_authority: false,
    artifact_authority: false,
    command_execution: false,
    network_access: false,
    publication: false,
    work_capsule_authority: false,
    recovery_model: 'idempotent_store_replay',
  });
}

function canonicalRecord(value) {
  const text = canonicalJson(value);
  if (text.length < 2 || text.length > MAX_RECORD_JSON_BYTES) {
    fail('builder_draft_checkpoint_store_resource_exceeded');
  }
  return text;
}

function parseRecordJson(text) {
  if (
    typeof text !== 'string'
    || text.length < 2
    || text.length > MAX_RECORD_JSON_BYTES
    || hasControlCharacter(text)
  ) fail('builder_draft_checkpoint_store_integrity_failed');
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    fail('builder_draft_checkpoint_store_integrity_failed');
  }
  try {
    if (canonicalJson(parsed) !== text) fail('builder_draft_checkpoint_store_integrity_failed');
    return sanitizeBuilderDraftCheckpoint(parsed);
  } catch (error) {
    if (
      error instanceof BuilderDraftCheckpointError
      || error instanceof BuilderDraftCheckpointStoreError
    ) fail('builder_draft_checkpoint_store_integrity_failed');
    throw error;
  }
}

function rowColumns() {
  return `checkpoint_id, checkpoint_version, project_id, session_id,
    task_address_id, conversation_id, turn_id, task_id, run_id, request_id,
    checkpoint_sequence, candidate_id, candidate_digest, resulting_tree_digest,
    checkpoint_state, created_at_ms, record_json`;
}

function rowToRecord(row) {
  if (row === null || row === undefined) return null;
  const checkpoint = parseRecordJson(row.record_json);
  if (
    row.checkpoint_id !== checkpoint.checkpoint_id
    || row.checkpoint_version !== BUILDER_DRAFT_CHECKPOINT_VERSION
    || row.project_id !== checkpoint.project_id
    || row.session_id !== checkpoint.session_id
    || row.task_address_id !== checkpoint.task_address_id
    || row.conversation_id !== checkpoint.conversation_id
    || row.turn_id !== checkpoint.turn_id
    || row.task_id !== checkpoint.task_id
    || row.run_id !== checkpoint.run_id
    || row.request_id !== checkpoint.request_id
    || row.checkpoint_sequence !== checkpoint.checkpoint_sequence
    || row.candidate_id !== checkpoint.candidate_ref.candidate_id
    || row.candidate_digest !== checkpoint.candidate_ref.candidate_digest
    || row.resulting_tree_digest !== checkpoint.candidate_ref.resulting_tree_digest
    || row.checkpoint_state !== checkpoint.checkpoint_state
    || row.created_at_ms !== checkpoint.created_at_ms
  ) fail('builder_draft_checkpoint_store_integrity_failed');
  return freezeDeep({ draft_checkpoint: checkpoint });
}

function loadByCheckpointId(db, checkpointId) {
  return rowToRecord(one(
    db,
    `SELECT ${rowColumns()} FROM draft_checkpoints WHERE checkpoint_id = ?`,
    [checkpointId],
  ));
}

function loadByCandidateId(db, projectId, candidateId) {
  return rowToRecord(one(
    db,
    `SELECT ${rowColumns()} FROM draft_checkpoints
      WHERE project_id = ? AND candidate_id = ?`,
    [projectId, candidateId],
  ));
}

function loadBySequence(db, projectId, taskAddressId, checkpointSequence) {
  return rowToRecord(one(
    db,
    `SELECT ${rowColumns()} FROM draft_checkpoints
      WHERE project_id = ? AND task_address_id = ? AND checkpoint_sequence = ?`,
    [projectId, taskAddressId, checkpointSequence],
  ));
}

function latestForTask(db, projectId, taskAddressId) {
  return rowToRecord(one(
    db,
    `SELECT ${rowColumns()} FROM draft_checkpoints
      WHERE project_id = ? AND task_address_id = ?
      ORDER BY created_at_ms DESC, checkpoint_sequence DESC, checkpoint_id DESC
      LIMIT 1`,
    [projectId, taskAddressId],
  ));
}

function listForTask(db, projectId, taskAddressId) {
  const rows = all(
    db,
    `SELECT ${rowColumns()} FROM draft_checkpoints
      WHERE project_id = ? AND task_address_id = ?
      ORDER BY checkpoint_sequence ASC, created_at_ms ASC, checkpoint_id ASC
      LIMIT ?`,
    [projectId, taskAddressId, MAX_TASK_CHECKPOINTS + 1],
  );
  if (rows.length > MAX_TASK_CHECKPOINTS) fail('builder_draft_checkpoint_store_resource_exceeded');
  return freezeDeep(rows.map(rowToRecord));
}

function sameRecord(left, right) {
  return canonicalJson(left.draft_checkpoint) === canonicalJson(right.draft_checkpoint);
}

function insertCheckpoint(db, checkpoint) {
  run(db, `INSERT INTO draft_checkpoints (
    checkpoint_id, checkpoint_version, project_id, session_id, task_address_id,
    conversation_id, turn_id, task_id, run_id, request_id, checkpoint_sequence,
    candidate_id, candidate_digest, resulting_tree_digest, checkpoint_state,
    created_at_ms, record_json, schema_version
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
    checkpoint.checkpoint_id,
    checkpoint.checkpoint_version,
    checkpoint.project_id,
    checkpoint.session_id,
    checkpoint.task_address_id,
    checkpoint.conversation_id,
    checkpoint.turn_id,
    checkpoint.task_id,
    checkpoint.run_id,
    checkpoint.request_id,
    checkpoint.checkpoint_sequence,
    checkpoint.candidate_ref.candidate_id,
    checkpoint.candidate_ref.candidate_digest,
    checkpoint.candidate_ref.resulting_tree_digest,
    checkpoint.checkpoint_state,
    checkpoint.created_at_ms,
    canonicalRecord(checkpoint),
    BUILDER_DRAFT_CHECKPOINT_STORE_SCHEMA_VERSION,
  ]);
}

function writeResult(db, operation, entry) {
  return freezeDeep({
    result_version: BUILDER_DRAFT_CHECKPOINT_STORE_RESULT_VERSION,
    operation,
    draft_checkpoint: entry,
    checkpoint_evidence: checkpointEvidence(db, operation),
  });
}

function readResult(db, transaction, payload) {
  return freezeDeep({
    result_version: BUILDER_DRAFT_CHECKPOINT_STORE_READ_RESULT_VERSION,
    checkpoint_authority: 'main_owned_draft_checkpoint_store',
    ...payload,
    checkpoint_evidence: checkpointEvidence(db, transaction),
  });
}

function sanitizeRecordRequest(value) {
  exactObject(value, RECORD_KEYS);
  try {
    return sanitizeBuilderDraftCheckpoint(valueAt(value, 'draft_checkpoint'));
  } catch (error) {
    if (error instanceof BuilderDraftCheckpointError) {
      fail('builder_draft_checkpoint_store_invalid');
    }
    throw error;
  }
}

function recordDraftCheckpoint(db, rawRequest) {
  const checkpoint = sanitizeRecordRequest(rawRequest);
  db.exec('BEGIN IMMEDIATE');
  try {
    const existing = loadByCheckpointId(db, checkpoint.checkpoint_id);
    const existingCandidate = loadByCandidateId(db, checkpoint.project_id, checkpoint.candidate_ref.candidate_id);
    const existingSequence = loadBySequence(
      db,
      checkpoint.project_id,
      checkpoint.task_address_id,
      checkpoint.checkpoint_sequence,
    );
    if (existing || existingCandidate || existingSequence) {
      const candidate = existing ?? existingCandidate ?? existingSequence;
      if (!sameRecord(candidate, { draft_checkpoint: checkpoint })) {
        fail('builder_draft_checkpoint_store_conflict');
      }
      db.exec('COMMIT');
      return writeResult(db, 'draft_checkpoint_replayed', candidate);
    }
    insertCheckpoint(db, checkpoint);
    const readback = loadByCheckpointId(db, checkpoint.checkpoint_id);
    if (!readback || !sameRecord(readback, { draft_checkpoint: checkpoint })) {
      fail('builder_draft_checkpoint_store_integrity_failed');
    }
    db.exec('COMMIT');
    return writeResult(db, 'draft_checkpoint_recorded', readback);
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* fixed failure below */ }
    throw error;
  }
}

function readDraftCheckpoint(db, rawRequest) {
  exactObject(rawRequest, READ_KEYS);
  const projectId = safeProjectId(valueAt(rawRequest, 'project_id'));
  const checkpointId = safeCheckpointId(valueAt(rawRequest, 'checkpoint_id'));
  const entry = loadByCheckpointId(db, checkpointId);
  if (!entry || entry.draft_checkpoint.project_id !== projectId) {
    return readResult(db, 'draft_checkpoint_absent_read', {
      status: 'absent',
      draft_checkpoint: null,
    });
  }
  return readResult(db, 'draft_checkpoint_ready_read', {
    status: 'ready',
    draft_checkpoint: entry,
  });
}

function readLatestDraftCheckpointForTask(db, rawRequest) {
  exactObject(rawRequest, READ_LATEST_TASK_KEYS);
  const projectId = safeProjectId(valueAt(rawRequest, 'project_id'));
  const taskAddressId = safeTaskAddressId(valueAt(rawRequest, 'task_address_id'));
  const entry = latestForTask(db, projectId, taskAddressId);
  if (!entry) {
    return readResult(db, 'latest_draft_checkpoint_absent_read', {
      status: 'absent',
      draft_checkpoint: null,
    });
  }
  return readResult(db, 'latest_draft_checkpoint_ready_read', {
    status: 'ready',
    draft_checkpoint: entry,
  });
}

function listDraftCheckpointsForTask(db, rawRequest) {
  exactObject(rawRequest, LIST_TASK_KEYS);
  const projectId = safeProjectId(valueAt(rawRequest, 'project_id'));
  const taskAddressId = safeTaskAddressId(valueAt(rawRequest, 'task_address_id'));
  const entries = listForTask(db, projectId, taskAddressId);
  return readResult(db, entries.length === 0 ? 'draft_checkpoints_absent_read' : 'draft_checkpoints_ready_read', {
    status: entries.length === 0 ? 'absent' : 'ready',
    draft_checkpoints: entries,
    truncated: entries.length >= MAX_TASK_CHECKPOINTS,
  });
}

function ownErrorField(error, key) {
  if (!error || typeof error !== 'object' || utilTypes.isProxy(error)) return null;
  const descriptor = Object.getOwnPropertyDescriptor(error, key);
  return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : null;
}

function normalizeOperationError(error) {
  if (error instanceof BuilderDraftCheckpointStoreError) {
    return new BuilderDraftCheckpointStoreError(error.code);
  }
  if (error instanceof BuilderDraftCheckpointError) {
    return new BuilderDraftCheckpointStoreError('builder_draft_checkpoint_store_invalid');
  }
  const sqliteCode = ownErrorField(error, 'code');
  const sqliteErrstr = ownErrorField(error, 'errstr');
  const sqliteErrcode = ownErrorField(error, 'errcode');
  if (sqliteCode && /^SQLITE_CONSTRAINT/u.test(sqliteCode)) {
    return new BuilderDraftCheckpointStoreError('builder_draft_checkpoint_store_integrity_failed');
  }
  if (sqliteErrstr === 'constraint failed' || sqliteErrcode === 1555) {
    return new BuilderDraftCheckpointStoreError('builder_draft_checkpoint_store_integrity_failed');
  }
  if (sqliteCode && /^SQLITE_(CORRUPT|NOTADB|SCHEMA|INTERNAL|MISMATCH)/u.test(sqliteCode)) {
    return new BuilderDraftCheckpointStoreError('builder_draft_checkpoint_store_integrity_failed');
  }
  return new BuilderDraftCheckpointStoreError('builder_draft_checkpoint_store_unavailable');
}

function createBuilderDraftCheckpointStore(databasePath) {
  let db;
  try {
    db = openDatabase(databasePath);
  } catch (error) {
    throw normalizeOperationError(error);
  }
  let closed = false;

  function activeDb() {
    if (closed) fail('builder_draft_checkpoint_store_unavailable');
    return db;
  }

  return freezeDeep({
    store_version: BUILDER_DRAFT_CHECKPOINT_STORE_VERSION,
    close(...rawArguments) {
      if (rawArguments.length !== 0) {
        throw new BuilderDraftCheckpointStoreError('builder_draft_checkpoint_store_invalid');
      }
      if (closed) return;
      closed = true;
      try { db.close(); } catch (error) { throw normalizeOperationError(error); }
    },
    record_draft_checkpoint(rawRequest) {
      try { return recordDraftCheckpoint(activeDb(), rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },
    read_draft_checkpoint(rawRequest) {
      try { return readDraftCheckpoint(activeDb(), rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },
    read_latest_draft_checkpoint_for_task(rawRequest) {
      try { return readLatestDraftCheckpointForTask(activeDb(), rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },
    list_draft_checkpoints_for_task(rawRequest) {
      try { return listDraftCheckpointsForTask(activeDb(), rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },
  });
}

module.exports = Object.freeze({
  BUILDER_DRAFT_CHECKPOINT_STORE_READ_RESULT_VERSION,
  BUILDER_DRAFT_CHECKPOINT_STORE_RESULT_VERSION,
  BUILDER_DRAFT_CHECKPOINT_STORE_SCHEMA_VERSION,
  BUILDER_DRAFT_CHECKPOINT_STORE_USER_VERSION,
  BUILDER_DRAFT_CHECKPOINT_STORE_VERSION,
  BuilderDraftCheckpointStoreError,
  createBuilderDraftCheckpointStore,
});
