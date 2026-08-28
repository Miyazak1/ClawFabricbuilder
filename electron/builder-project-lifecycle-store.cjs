'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { types: utilTypes } = require('node:util');

const BUILDER_PROJECT_LIFECYCLE_STORE_VERSION = 'builder-project-lifecycle-store.v1';
const BUILDER_PROJECT_LIFECYCLE_RESULT_VERSION = 'builder-project-lifecycle-result.v1';
const BUILDER_PROJECT_LIFECYCLE_SCHEMA_VERSION = 'builder-project-lifecycle-schema.v1';
const BUILDER_PROJECT_LIFECYCLE_USER_VERSION = 1;
const PROJECT_ID_PATTERN =
  /^builder-project:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const REQUEST_PROJECT_KEYS = Object.freeze(['project_id']);
const RENAME_PROJECT_KEYS = Object.freeze(['project_id', 'title', 'updated_at_ms']);
const ARCHIVE_PROJECT_KEYS = Object.freeze(['project_id', 'archived_at_ms']);

class BuilderProjectLifecycleStoreError extends Error {
  constructor(code = 'builder_project_lifecycle_store_invalid') {
    super('Builder project lifecycle storage request could not be verified.');
    this.name = 'BuilderProjectLifecycleStoreError';
    this.code = code;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code = 'builder_project_lifecycle_store_invalid') {
  throw new BuilderProjectLifecycleStoreError(code);
}

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freezeDeep(nested);
    Object.freeze(value);
  }
  return value;
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || utilTypes.isProxy(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactObject(value, keys) {
  if (!isPlainObject(value)) fail();
  const actual = Reflect.ownKeys(value);
  if (actual.length !== keys.length || actual.some((key) => typeof key !== 'string' || !keys.includes(key))) fail();
  for (const key of actual) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail();
  }
}

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail();
  return descriptor.value;
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
  ) fail();
  return value;
}

function safeProjectId(value) {
  if (typeof value !== 'string' || !PROJECT_ID_PATTERN.test(value)) fail();
  return value;
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail();
  return value;
}

function safeTitle(value) {
  if (
    typeof value !== 'string'
    || value.length < 1
    || value.length > 80
    || value.trim() !== value
    || hasControlCharacter(value)
  ) fail();
  return value;
}

function one(db, sql, params = []) {
  return db.prepare(sql).get(...params) ?? null;
}

function run(db, sql, params = []) {
  return db.prepare(sql).run(...params);
}

function configurePragmas(db) {
  db.exec('PRAGMA trusted_schema = OFF');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA synchronous = FULL');
  db.exec('PRAGMA journal_mode = WAL');
}

function assertParentDirectory(filePath) {
  let info;
  try {
    info = fs.lstatSync(path.dirname(filePath));
  } catch {
    fail('builder_project_lifecycle_store_unavailable');
  }
  if (!info.isDirectory() || info.isSymbolicLink()) fail('builder_project_lifecycle_store_unavailable');
}

function createSchema(db) {
  db.exec(`CREATE TABLE project_lifecycle (
    project_id TEXT NOT NULL PRIMARY KEY,
    title_override TEXT,
    archived_at_ms INTEGER,
    updated_at_ms INTEGER NOT NULL,
    schema_version TEXT NOT NULL,
    CHECK (schema_version = 'builder-project-lifecycle-schema.v1'),
    CHECK (length(project_id) BETWEEN 1 AND 64),
    CHECK (title_override IS NULL OR length(title_override) BETWEEN 1 AND 80),
    CHECK (archived_at_ms IS NULL OR archived_at_ms >= 0),
    CHECK (updated_at_ms >= 0)
  ) STRICT`);
  db.exec(`PRAGMA user_version = ${BUILDER_PROJECT_LIFECYCLE_USER_VERSION}`);
}

function openDatabase(databasePath) {
  const filePath = safeDatabasePath(databasePath);
  assertParentDirectory(filePath);
  let db;
  try {
    db = new DatabaseSync(filePath);
    configurePragmas(db);
    const version = one(db, 'PRAGMA user_version')?.user_version;
    if (version === 0) createSchema(db);
    if (one(db, 'PRAGMA user_version')?.user_version !== BUILDER_PROJECT_LIFECYCLE_USER_VERSION) fail();
    if (one(db, "SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'project_lifecycle'") === null) fail();
    return db;
  } catch (error) {
    try { db?.close(); } catch { /* fixed failure below */ }
    if (error instanceof BuilderProjectLifecycleStoreError) throw error;
    fail('builder_project_lifecycle_store_unavailable');
  }
}

function rowToLifecycle(row) {
  if (row === null) return null;
  if (
    typeof row.project_id !== 'string'
    || !PROJECT_ID_PATTERN.test(row.project_id)
    || (row.title_override !== null && typeof row.title_override !== 'string')
    || (row.archived_at_ms !== null && !Number.isSafeInteger(row.archived_at_ms))
    || !Number.isSafeInteger(row.updated_at_ms)
    || row.schema_version !== BUILDER_PROJECT_LIFECYCLE_SCHEMA_VERSION
  ) fail('builder_project_lifecycle_store_integrity_failed');
  return freezeDeep({
    project_id: row.project_id,
    title_override: row.title_override,
    archived_at_ms: row.archived_at_ms,
    updated_at_ms: row.updated_at_ms,
  });
}

function result(operation, projectLifecycle) {
  return freezeDeep({
    result_version: BUILDER_PROJECT_LIFECYCLE_RESULT_VERSION,
    operation,
    project_lifecycle: projectLifecycle,
    authority: {
      lifecycle_authority: 'main_owned_project_lifecycle_store',
      renderer_authority: 'bounded_request_only',
      source_write: false,
      git_mutation: false,
      filesystem_delete: false,
    },
  });
}

function createBuilderProjectLifecycleStore(databasePath) {
  const db = openDatabase(databasePath);
  let closed = false;
  function activeDb() {
    if (closed) fail('builder_project_lifecycle_store_unavailable');
    return db;
  }
  function readLifecycle(projectId) {
    return rowToLifecycle(one(activeDb(), 'SELECT * FROM project_lifecycle WHERE project_id = ?', [projectId]));
  }
  return freezeDeep({
    store_version: BUILDER_PROJECT_LIFECYCLE_STORE_VERSION,
    read_project_lifecycle(rawRequest) {
      exactObject(rawRequest, REQUEST_PROJECT_KEYS);
      return result('project_lifecycle_read', readLifecycle(safeProjectId(valueAt(rawRequest, 'project_id'))));
    },
    rename_project(rawRequest) {
      exactObject(rawRequest, RENAME_PROJECT_KEYS);
      const projectId = safeProjectId(valueAt(rawRequest, 'project_id'));
      const title = safeTitle(valueAt(rawRequest, 'title'));
      const updatedAtMs = safeTimestamp(valueAt(rawRequest, 'updated_at_ms'));
      const existing = readLifecycle(projectId);
      run(activeDb(), `INSERT INTO project_lifecycle (
        project_id, title_override, archived_at_ms, updated_at_ms, schema_version
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(project_id) DO UPDATE SET
        title_override = excluded.title_override,
        archived_at_ms = project_lifecycle.archived_at_ms,
        updated_at_ms = excluded.updated_at_ms`, [
        projectId,
        title,
        existing?.archived_at_ms ?? null,
        updatedAtMs,
        BUILDER_PROJECT_LIFECYCLE_SCHEMA_VERSION,
      ]);
      return result('project_renamed', readLifecycle(projectId));
    },
    archive_project(rawRequest) {
      exactObject(rawRequest, ARCHIVE_PROJECT_KEYS);
      const projectId = safeProjectId(valueAt(rawRequest, 'project_id'));
      const archivedAtMs = safeTimestamp(valueAt(rawRequest, 'archived_at_ms'));
      const existing = readLifecycle(projectId);
      run(activeDb(), `INSERT INTO project_lifecycle (
        project_id, title_override, archived_at_ms, updated_at_ms, schema_version
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(project_id) DO UPDATE SET
        title_override = project_lifecycle.title_override,
        archived_at_ms = excluded.archived_at_ms,
        updated_at_ms = excluded.updated_at_ms`, [
        projectId,
        existing?.title_override ?? null,
        archivedAtMs,
        archivedAtMs,
        BUILDER_PROJECT_LIFECYCLE_SCHEMA_VERSION,
      ]);
      return result('project_archived', readLifecycle(projectId));
    },
    apply_to_project(project) {
      if (!isPlainObject(project)) fail();
      const projectId = safeProjectId(valueAt(project, 'project_id'));
      const lifecycle = readLifecycle(projectId);
      if (lifecycle?.archived_at_ms !== null && lifecycle?.archived_at_ms !== undefined) return null;
      if (lifecycle?.title_override === null || lifecycle?.title_override === undefined) return project;
      return freezeDeep({ ...project, title: lifecycle.title_override });
    },
    close() {
      if (closed) return;
      closed = true;
      db.close();
    },
    [Symbol.dispose]() {
      this.close();
    },
  });
}

module.exports = Object.freeze({
  BUILDER_PROJECT_LIFECYCLE_RESULT_VERSION,
  BUILDER_PROJECT_LIFECYCLE_SCHEMA_VERSION,
  BUILDER_PROJECT_LIFECYCLE_STORE_VERSION,
  BUILDER_PROJECT_LIFECYCLE_USER_VERSION,
  BuilderProjectLifecycleStoreError,
  createBuilderProjectLifecycleStore,
});
