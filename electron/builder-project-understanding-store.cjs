'use strict';

const nodeCrypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { types: utilTypes } = require('node:util');

const {
  BuilderProjectUnderstandingError,
  sanitizeBuilderProjectUnderstandingSnapshot,
} = require('./builder-project-understanding.cjs');

const BUILDER_PROJECT_UNDERSTANDING_STORE_VERSION = 'builder-project-understanding-store.v1';
const BUILDER_PROJECT_UNDERSTANDING_STORE_RESULT_VERSION =
  'builder-project-understanding-store-result.v1';
const BUILDER_PROJECT_UNDERSTANDING_STORE_READ_RESULT_VERSION =
  'builder-project-understanding-store-read-result.v1';
const BUILDER_PROJECT_UNDERSTANDING_STORE_SCHEMA_VERSION =
  'builder-project-understanding-store-schema.v1';
const BUILDER_PROJECT_UNDERSTANDING_STORE_USER_VERSION = 1;
const DATABASE_ID = 'builder-project-understanding-store.v1';
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const PROJECT_ID_PATTERN = new RegExp(`^builder-project:${UUID_SOURCE}$`, 'u');
const SNAPSHOT_DIGEST_PATTERN = /^builder-project-understanding-snapshot:[0-9a-f]{64}$/u;
const RECORD_KEYS = Object.freeze(['project_understanding_snapshot']);
const READ_KEYS = Object.freeze(['project_id', 'snapshot_digest']);
const READ_LATEST_KEYS = Object.freeze(['project_id']);
const MAX_RECORD_JSON_BYTES = 128 * 1024;
const CREATE_SCHEMA_SQL = Object.freeze([
  `CREATE TABLE project_understanding_snapshots (
    snapshot_digest TEXT NOT NULL PRIMARY KEY,
    snapshot_version TEXT NOT NULL,
    project_id TEXT NOT NULL,
    root_digest TEXT NOT NULL,
    source_tree_digest TEXT NOT NULL,
    detected_stack_json TEXT NOT NULL,
    package_manager TEXT NOT NULL,
    command_profile_count INTEGER NOT NULL,
    unknown_count INTEGER NOT NULL,
    stale_reason TEXT,
    updated_at_ms INTEGER NOT NULL,
    record_json TEXT NOT NULL,
    schema_version TEXT NOT NULL,
    UNIQUE (project_id, source_tree_digest),
    CHECK (schema_version = 'builder-project-understanding-store-schema.v1'),
    CHECK (snapshot_version = 'builder-project-understanding-snapshot.v1'),
    CHECK (command_profile_count BETWEEN 0 AND 8),
    CHECK (unknown_count BETWEEN 0 AND 8),
    CHECK (updated_at_ms >= 0),
    CHECK (length(record_json) BETWEEN 2 AND 131072)
  ) STRICT`,
  'CREATE INDEX project_understanding_latest_idx ON project_understanding_snapshots(project_id, updated_at_ms DESC, snapshot_digest DESC)',
]);
const ERROR_MESSAGES = Object.freeze({
  builder_project_understanding_store_invalid:
    'Builder project understanding storage request could not be verified.',
  builder_project_understanding_store_not_found:
    'Builder project understanding is unavailable.',
  builder_project_understanding_store_conflict:
    'Builder project understanding changed before it could be recorded.',
  builder_project_understanding_store_integrity_failed:
    'Builder project understanding storage integrity could not be verified.',
  builder_project_understanding_store_resource_exceeded:
    'Builder project understanding storage limits were reached.',
  builder_project_understanding_store_unavailable:
    'Builder project understanding storage is unavailable.',
});

class BuilderProjectUnderstandingStoreError extends Error {
  constructor(code = 'builder_project_understanding_store_invalid') {
    const selected = Object.hasOwn(ERROR_MESSAGES, code)
      ? code
      : 'builder_project_understanding_store_invalid';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderProjectUnderstandingStoreError';
    this.code = selected;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) {
  throw new BuilderProjectUnderstandingStoreError(code);
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
  if (!isPlainObject(value)) fail('builder_project_understanding_store_invalid');
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== keys.length
    || actual.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) fail('builder_project_understanding_store_invalid');
  for (const key of actual) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      fail('builder_project_understanding_store_invalid');
    }
  }
}

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
    fail('builder_project_understanding_store_invalid');
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
  fail('builder_project_understanding_store_invalid');
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
    fail('builder_project_understanding_store_invalid');
  }
  return value;
}

function safeProjectId(value) {
  return safePattern(value, PROJECT_ID_PATTERN);
}

function safeSnapshotDigest(value) {
  return safePattern(value, SNAPSHOT_DIGEST_PATTERN);
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
  ) fail('builder_project_understanding_store_invalid');
  return value;
}

function assertParentDirectory(filePath) {
  let info;
  try {
    info = fs.lstatSync(path.dirname(filePath));
  } catch {
    fail('builder_project_understanding_store_unavailable');
  }
  if (!info.isDirectory() || info.isSymbolicLink()) {
    fail('builder_project_understanding_store_unavailable');
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
    fail('builder_project_understanding_store_unavailable');
  }
}

function createSchema(db) {
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const sql of CREATE_SCHEMA_SQL) db.exec(sql);
    db.exec(`PRAGMA user_version = ${BUILDER_PROJECT_UNDERSTANDING_STORE_USER_VERSION}`);
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* fixed failure below */ }
    throw error;
  }
}

function schemaFingerprint(db) {
  const rows = all(
    db,
    `SELECT type, name, tbl_name, sql
       FROM sqlite_schema
      WHERE name NOT LIKE 'sqlite_%'
      ORDER BY type, name, tbl_name`,
  );
  return `sha256:${sha256Canonical(rows)}`;
}

function verifySchema(db) {
  const row = one(db, 'PRAGMA user_version');
  if (!row || row.user_version !== BUILDER_PROJECT_UNDERSTANDING_STORE_USER_VERSION) {
    fail('builder_project_understanding_store_integrity_failed');
  }
  const table = one(
    db,
    `SELECT sql FROM sqlite_schema
      WHERE type = 'table' AND name = 'project_understanding_snapshots'`,
  );
  if (!table || !String(table.sql).includes(BUILDER_PROJECT_UNDERSTANDING_STORE_SCHEMA_VERSION)) {
    fail('builder_project_understanding_store_integrity_failed');
  }
}

function openDatabase(databasePath) {
  const safePath = safeDatabasePath(databasePath);
  assertParentDirectory(safePath);
  let exists = false;
  try {
    const info = fs.lstatSync(safePath);
    if (!info.isFile() || info.isSymbolicLink()) {
      fail('builder_project_understanding_store_unavailable');
    }
    exists = true;
  } catch (error) {
    if (error instanceof BuilderProjectUnderstandingStoreError) throw error;
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
    if (error instanceof BuilderProjectUnderstandingStoreError) throw error;
    fail('builder_project_understanding_store_unavailable');
  }
}

function snapshotDigest(snapshot) {
  return `builder-project-understanding-snapshot:${sha256Canonical(snapshot)}`;
}

function normalizeSnapshotError(error) {
  if (error instanceof BuilderProjectUnderstandingStoreError) return error;
  if (error instanceof BuilderProjectUnderstandingError) {
    return new BuilderProjectUnderstandingStoreError('builder_project_understanding_store_invalid');
  }
  return new BuilderProjectUnderstandingStoreError('builder_project_understanding_store_unavailable');
}

function safeSnapshot(rawValue) {
  try {
    return sanitizeBuilderProjectUnderstandingSnapshot(rawValue);
  } catch (error) {
    throw normalizeSnapshotError(error);
  }
}

function recordJson(snapshot) {
  const serialized = canonicalJson(snapshot);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_RECORD_JSON_BYTES) {
    fail('builder_project_understanding_store_resource_exceeded');
  }
  return serialized;
}

function evidence(db, operation) {
  return freezeDeep({
    store_authority: 'main_owned_project_understanding_store',
    understanding_contract_authority: 'main_owned_project_understanding_contract_v1',
    operation,
    schema_version: BUILDER_PROJECT_UNDERSTANDING_STORE_SCHEMA_VERSION,
    user_version: BUILDER_PROJECT_UNDERSTANDING_STORE_USER_VERSION,
    database_id: DATABASE_ID,
    schema_fingerprint_digest: schemaFingerprint(db),
    renderer_authority: 'not_present',
    ipc_authority: 'not_present',
    provider_dispatch: false,
    tool_dispatch: false,
    command_execution: false,
    source_read: 'snapshot_record_only',
    source_write: 'not_present',
    git_mutation: false,
    permission_grant_authority: false,
    revision_authority: false,
    secret_access: 'not_present',
    network_access: false,
    recovery_model: 'idempotent_store_replay',
  });
}

function rowToSnapshot(row) {
  if (row === null) return null;
  let parsed;
  try {
    parsed = JSON.parse(row.record_json);
  } catch {
    fail('builder_project_understanding_store_integrity_failed');
  }
  const snapshot = safeSnapshot(parsed);
  if (
    row.snapshot_digest !== snapshotDigest(snapshot)
    || row.snapshot_version !== snapshot.snapshot_version
    || row.project_id !== snapshot.project_id
    || row.root_digest !== snapshot.root_digest
    || row.source_tree_digest !== snapshot.source_tree_digest
    || row.detected_stack_json !== canonicalJson(snapshot.detected_stack)
    || row.package_manager !== snapshot.package_manager
    || row.command_profile_count !== snapshot.command_profiles.length
    || row.unknown_count !== snapshot.unknowns.length
    || row.stale_reason !== snapshot.stale_reason
    || row.updated_at_ms !== snapshot.updated_at_ms
  ) fail('builder_project_understanding_store_integrity_failed');
  return freezeDeep({
    snapshot_digest: row.snapshot_digest,
    project_understanding_snapshot: snapshot,
  });
}

function snapshotColumns() {
  return [
    'snapshot_digest',
    'snapshot_version',
    'project_id',
    'root_digest',
    'source_tree_digest',
    'detected_stack_json',
    'package_manager',
    'command_profile_count',
    'unknown_count',
    'stale_reason',
    'updated_at_ms',
    'record_json',
  ].join(', ');
}

function writeResult(db, operation, payload) {
  return freezeDeep({
    result_version: BUILDER_PROJECT_UNDERSTANDING_STORE_RESULT_VERSION,
    operation,
    ...payload,
    store_evidence: evidence(db, operation),
  });
}

function readResult(db, operation, payload) {
  return freezeDeep({
    result_version: BUILDER_PROJECT_UNDERSTANDING_STORE_READ_RESULT_VERSION,
    operation,
    ...payload,
    store_evidence: evidence(db, operation),
  });
}

function createBuilderProjectUnderstandingStore(databasePath) {
  const db = openDatabase(databasePath);

  function recordProjectUnderstandingSnapshot(rawRequest) {
    try {
      exactObject(rawRequest, RECORD_KEYS);
      const snapshot = safeSnapshot(valueAt(rawRequest, 'project_understanding_snapshot'));
      const digest = snapshotDigest(snapshot);
      const json = recordJson(snapshot);
      try {
        run(
          db,
          `INSERT INTO project_understanding_snapshots (
            snapshot_digest, snapshot_version, project_id, root_digest, source_tree_digest,
            detected_stack_json, package_manager, command_profile_count, unknown_count,
            stale_reason, updated_at_ms, record_json, schema_version
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            digest,
            snapshot.snapshot_version,
            snapshot.project_id,
            snapshot.root_digest,
            snapshot.source_tree_digest,
            canonicalJson(snapshot.detected_stack),
            snapshot.package_manager,
            snapshot.command_profiles.length,
            snapshot.unknowns.length,
            snapshot.stale_reason,
            snapshot.updated_at_ms,
            json,
            BUILDER_PROJECT_UNDERSTANDING_STORE_SCHEMA_VERSION,
          ],
        );
      } catch {
        const existing = rowToSnapshot(one(
          db,
          `SELECT ${snapshotColumns()}
             FROM project_understanding_snapshots
            WHERE project_id = ? AND source_tree_digest = ?`,
          [snapshot.project_id, snapshot.source_tree_digest],
        ));
        if (existing && canonicalJson(existing.project_understanding_snapshot) === canonicalJson(snapshot)) {
          return writeResult(db, 'project_understanding_snapshot_replayed', {
            project_understanding: existing,
          });
        }
        fail('builder_project_understanding_store_conflict');
      }
      return writeResult(db, 'project_understanding_snapshot_recorded', {
        project_understanding: freezeDeep({
          snapshot_digest: digest,
          project_understanding_snapshot: snapshot,
        }),
      });
    } catch (error) {
      throw normalizeSnapshotError(error);
    }
  }

  function readProjectUnderstandingSnapshot(rawRequest) {
    try {
      exactObject(rawRequest, READ_KEYS);
      const projectId = safeProjectId(valueAt(rawRequest, 'project_id'));
      const digest = safeSnapshotDigest(valueAt(rawRequest, 'snapshot_digest'));
      const snapshot = rowToSnapshot(one(
        db,
        `SELECT ${snapshotColumns()}
           FROM project_understanding_snapshots
          WHERE project_id = ? AND snapshot_digest = ?`,
        [projectId, digest],
      ));
      if (snapshot === null) {
        return readResult(db, 'project_understanding_snapshot_absent_read', {
          project_understanding: null,
        });
      }
      return readResult(db, 'project_understanding_snapshot_ready_read', {
        project_understanding: snapshot,
      });
    } catch (error) {
      throw normalizeSnapshotError(error);
    }
  }

  function readLatestProjectUnderstandingSnapshot(rawRequest) {
    try {
      exactObject(rawRequest, READ_LATEST_KEYS);
      const projectId = safeProjectId(valueAt(rawRequest, 'project_id'));
      const snapshot = rowToSnapshot(one(
        db,
        `SELECT ${snapshotColumns()}
           FROM project_understanding_snapshots
          WHERE project_id = ?
          ORDER BY updated_at_ms DESC, snapshot_digest DESC
          LIMIT 1`,
        [projectId],
      ));
      if (snapshot === null) {
        return readResult(db, 'project_understanding_latest_absent_read', {
          project_understanding: null,
        });
      }
      return readResult(db, 'project_understanding_latest_ready_read', {
        project_understanding: snapshot,
      });
    } catch (error) {
      throw normalizeSnapshotError(error);
    }
  }

  return freezeDeep({
    store_version: BUILDER_PROJECT_UNDERSTANDING_STORE_VERSION,
    record_project_understanding_snapshot: recordProjectUnderstandingSnapshot,
    read_project_understanding_snapshot: readProjectUnderstandingSnapshot,
    read_latest_project_understanding_snapshot: readLatestProjectUnderstandingSnapshot,
    close() {
      db.close();
    },
  });
}

module.exports = Object.freeze({
  BUILDER_PROJECT_UNDERSTANDING_STORE_READ_RESULT_VERSION,
  BUILDER_PROJECT_UNDERSTANDING_STORE_RESULT_VERSION,
  BUILDER_PROJECT_UNDERSTANDING_STORE_SCHEMA_VERSION,
  BUILDER_PROJECT_UNDERSTANDING_STORE_USER_VERSION,
  BUILDER_PROJECT_UNDERSTANDING_STORE_VERSION,
  BuilderProjectUnderstandingStoreError,
  createBuilderProjectUnderstandingStore,
});
