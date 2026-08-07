'use strict';

const nodeCrypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { types: utilTypes } = require('node:util');

const {
  BUILDER_PERMISSION_FACTS_READ_RESULT_VERSION,
  BUILDER_PERMISSION_POLICY_VERSION,
  BuilderPermissionAuthorityContractError,
  createBuilderPermissionEvaluator,
  sanitizeBuilderPermissionGrantRecord,
  sanitizeBuilderPermissionRevocationRecord,
} = require('./builder-permission-authority-contract.cjs');

const BUILDER_PERMISSION_FACT_STORE_VERSION = 'builder-permission-fact-store.v1';
const BUILDER_PERMISSION_FACT_STORE_RESULT_VERSION = 'builder-permission-fact-store-result.v1';
const BUILDER_PERMISSION_FACT_STORE_SCHEMA_VERSION = 'builder-permission-fact-store-schema.v1';
const BUILDER_PERMISSION_FACT_STORE_USER_VERSION = 1;
const DATABASE_ID = 'builder-permission-fact-store.v1';
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const PROJECT_ID_PATTERN = new RegExp(`^builder-project:${UUID_SOURCE}$`, 'u');
const ACTOR_ID_PATTERN = new RegExp(`^(?:builder-user|builder-agent):${UUID_SOURCE}$`, 'u');
const RESOURCE_ID_PATTERN = /^[a-z][a-z0-9._:/@-]{0,127}$/u;
const MAX_FACTS = 256;
const RECORD_GRANT_KEYS = Object.freeze(['grant']);
const RECORD_REVOCATION_KEYS = Object.freeze(['revocation']);
const READ_REQUEST_KEYS = Object.freeze(['policy_version', 'actor_id', 'action', 'resource', 'now_ms']);
const RESOURCE_KEYS = Object.freeze(['resource_kind', 'project_id', 'resource_id']);
const RESOURCE_KINDS = Object.freeze([
  'project',
  'conversation',
  'task',
  'run',
  'revision',
  'artifact',
  'secret',
  'filesystem',
  'network',
  'process',
  'provider',
  'publication',
  'permission',
]);
const ACTION_RESOURCE_KINDS = Object.freeze({
  'context.read': Object.freeze(['project', 'conversation', 'task', 'run', 'revision', 'artifact']),
  'context.disclose': Object.freeze(['provider']),
  'project.read': Object.freeze(['project', 'revision']),
  'project.edit': Object.freeze(['project']),
  'secret.read': Object.freeze(['secret']),
  'filesystem.read': Object.freeze(['filesystem']),
  'filesystem.write': Object.freeze(['filesystem']),
  'network.request': Object.freeze(['network']),
  'process.spawn': Object.freeze(['process']),
  'publication.create': Object.freeze(['publication']),
  'permission.grant': Object.freeze(['permission']),
});
const CREATE_SCHEMA_SQL = Object.freeze([
  `CREATE TABLE permission_grants (
    project_id TEXT NOT NULL,
    permission_id TEXT NOT NULL,
    record_version TEXT NOT NULL,
    policy_version TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    issuer_id TEXT NOT NULL,
    scope_kind TEXT NOT NULL,
    action TEXT NOT NULL,
    resource_kind TEXT NOT NULL,
    resource_project_id TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    issued_at_ms INTEGER NOT NULL,
    expires_at_ms INTEGER,
    schema_version TEXT NOT NULL,
    PRIMARY KEY (project_id, permission_id),
    CHECK (schema_version = 'builder-permission-fact-store-schema.v1'),
    CHECK (policy_version = 'builder-permission-policy.v1'),
    CHECK (scope_kind = 'project'),
    CHECK (resource_project_id = project_id),
    CHECK (issued_at_ms >= 0),
    CHECK (expires_at_ms IS NULL OR expires_at_ms > issued_at_ms)
  ) STRICT`,
  `CREATE TABLE permission_revocations (
    project_id TEXT NOT NULL,
    revocation_id TEXT NOT NULL,
    record_version TEXT NOT NULL,
    policy_version TEXT NOT NULL,
    permission_id TEXT NOT NULL,
    revoker_id TEXT NOT NULL,
    revoked_at_ms INTEGER NOT NULL,
    schema_version TEXT NOT NULL,
    PRIMARY KEY (project_id, revocation_id),
    UNIQUE (project_id, permission_id),
    CHECK (schema_version = 'builder-permission-fact-store-schema.v1'),
    CHECK (policy_version = 'builder-permission-policy.v1'),
    CHECK (revoked_at_ms >= 0),
    FOREIGN KEY (project_id, permission_id)
      REFERENCES permission_grants(project_id, permission_id)
      ON DELETE RESTRICT ON UPDATE RESTRICT
  ) STRICT`,
  `CREATE INDEX permission_grants_lookup_idx
    ON permission_grants(
      policy_version, actor_id, action, resource_kind, resource_project_id, resource_id, issued_at_ms
    )`,
  'CREATE INDEX permission_revocations_permission_idx ON permission_revocations(project_id, permission_id)',
]);
const ERROR_MESSAGES = Object.freeze({
  builder_permission_fact_store_invalid: 'Builder permission facts could not be verified.',
  builder_permission_fact_store_not_found: 'Builder permission facts are unavailable.',
  builder_permission_fact_store_conflict: 'Builder permission facts changed before they could be recorded.',
  builder_permission_fact_store_integrity_failed: 'Builder permission fact integrity could not be verified.',
  builder_permission_fact_store_resource_exceeded: 'Builder permission fact limits were reached.',
  builder_permission_fact_store_unavailable: 'Builder permission fact storage is unavailable.',
});

class BuilderPermissionFactStoreError extends Error {
  constructor(code = 'builder_permission_fact_store_invalid') {
    const selected = Object.hasOwn(ERROR_MESSAGES, code)
      ? code
      : 'builder_permission_fact_store_invalid';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderPermissionFactStoreError';
    this.code = selected;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) {
  throw new BuilderPermissionFactStoreError(code);
}

function frozen(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) frozen(nested);
    Object.freeze(value);
  }
  return value;
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || utilTypes.isProxy(value) || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactObject(value, keys) {
  if (!isPlainObject(value)) fail('builder_permission_fact_store_invalid');
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== keys.length
    || actual.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) fail('builder_permission_fact_store_invalid');
  for (const key of actual) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      fail('builder_permission_fact_store_invalid');
    }
  }
}

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
    fail('builder_permission_fact_store_invalid');
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
  fail('builder_permission_fact_store_invalid');
}

function sha256Canonical(value) {
  return nodeCrypto.createHash('sha256').update(canonicalJson(value)).digest('hex');
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
  ) fail('builder_permission_fact_store_invalid');
  return value;
}

function assertParentDirectory(filePath) {
  let info;
  try {
    info = fs.lstatSync(path.dirname(filePath));
  } catch {
    fail('builder_permission_fact_store_unavailable');
  }
  if (!info.isDirectory() || info.isSymbolicLink()) {
    fail('builder_permission_fact_store_unavailable');
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
    fail('builder_permission_fact_store_integrity_failed');
  }
  return row.user_version;
}

function runtimePragmas(db) {
  const foreignKeys = Number(one(db, 'PRAGMA foreign_keys')?.foreign_keys);
  const trustedSchema = Number(one(db, 'PRAGMA trusted_schema')?.trusted_schema);
  const synchronous = Number(one(db, 'PRAGMA synchronous')?.synchronous);
  const journalMode = String(one(db, 'PRAGMA journal_mode')?.journal_mode ?? '').toLowerCase();
  return frozen({
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
  if (mode !== 'wal') fail('builder_permission_fact_store_unavailable');
  const pragmas = runtimePragmas(db);
  if (
    pragmas.foreign_keys !== 'on'
    || pragmas.trusted_schema !== 'off'
    || pragmas.synchronous !== 'full'
    || pragmas.journal_mode !== 'wal'
  ) fail('builder_permission_fact_store_unavailable');
}

function createSchema(db) {
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const sql of CREATE_SCHEMA_SQL) db.exec(sql);
    db.exec(`PRAGMA user_version = ${BUILDER_PERMISSION_FACT_STORE_USER_VERSION}`);
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
  return frozen({
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
    expectedDb.exec(`PRAGMA user_version = ${BUILDER_PERMISSION_FACT_STORE_USER_VERSION}`);
    expectedSchemaFingerprint = canonicalJson(collectSchemaFingerprint(expectedDb));
    return expectedSchemaFingerprint;
  } finally {
    expectedDb.close();
  }
}

function validateSchema(db) {
  const actual = collectSchemaFingerprint(db);
  if (actual.foreign_key_check.length !== 0) fail('builder_permission_fact_store_integrity_failed');
  if (canonicalJson(actual) !== expectedFingerprint()) {
    fail('builder_permission_fact_store_integrity_failed');
  }
}

function initialize(db) {
  configurePragmas(db);
  const version = userVersion(db);
  if (version === 0) createSchema(db);
  else if (version !== BUILDER_PERMISSION_FACT_STORE_USER_VERSION) {
    fail('builder_permission_fact_store_integrity_failed');
  }
  validateSchema(db);
}

function safePattern(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) fail('builder_permission_fact_store_invalid');
  return value;
}

function safeProjectId(value) {
  return safePattern(value, PROJECT_ID_PATTERN);
}

function safeActorId(value) {
  return safePattern(value, ACTOR_ID_PATTERN);
}

function safeAction(value) {
  if (typeof value !== 'string' || !Object.hasOwn(ACTION_RESOURCE_KINDS, value)) {
    fail('builder_permission_fact_store_invalid');
  }
  return value;
}

function safeResourceKind(value) {
  if (typeof value !== 'string' || !RESOURCE_KINDS.includes(value)) {
    fail('builder_permission_fact_store_invalid');
  }
  return value;
}

function safeResourceId(value) {
  if (
    typeof value !== 'string'
    || value.trim() !== value
    || !RESOURCE_ID_PATTERN.test(value)
  ) fail('builder_permission_fact_store_invalid');
  return value;
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail('builder_permission_fact_store_invalid');
  return value;
}

function sanitizeResource(value) {
  exactObject(value, RESOURCE_KEYS);
  return frozen({
    resource_kind: safeResourceKind(valueAt(value, 'resource_kind')),
    project_id: safeProjectId(valueAt(value, 'project_id')),
    resource_id: safeResourceId(valueAt(value, 'resource_id')),
  });
}

function sanitizeReadRequest(value) {
  exactObject(value, READ_REQUEST_KEYS);
  const action = safeAction(valueAt(value, 'action'));
  const resource = sanitizeResource(valueAt(value, 'resource'));
  if (!ACTION_RESOURCE_KINDS[action].includes(resource.resource_kind)) {
    fail('builder_permission_fact_store_invalid');
  }
  if (valueAt(value, 'policy_version') !== BUILDER_PERMISSION_POLICY_VERSION) {
    fail('builder_permission_fact_store_invalid');
  }
  return frozen({
    policy_version: BUILDER_PERMISSION_POLICY_VERSION,
    actor_id: safeActorId(valueAt(value, 'actor_id')),
    action,
    resource,
    now_ms: safeTimestamp(valueAt(value, 'now_ms')),
  });
}

function sanitizeGrantRequest(value) {
  exactObject(value, RECORD_GRANT_KEYS);
  try {
    return sanitizeBuilderPermissionGrantRecord(valueAt(value, 'grant'));
  } catch (error) {
    if (error instanceof BuilderPermissionAuthorityContractError) {
      fail('builder_permission_fact_store_invalid');
    }
    throw error;
  }
}

function sanitizeRevocationRequest(value) {
  exactObject(value, RECORD_REVOCATION_KEYS);
  try {
    return sanitizeBuilderPermissionRevocationRecord(valueAt(value, 'revocation'));
  } catch (error) {
    if (error instanceof BuilderPermissionAuthorityContractError) {
      fail('builder_permission_fact_store_invalid');
    }
    throw error;
  }
}

function grantFromRow(row) {
  if (!row) return null;
  try {
    return sanitizeBuilderPermissionGrantRecord({
      permission_id: row.permission_id,
      record_version: row.record_version,
      policy_version: row.policy_version,
      project_id: row.project_id,
      actor_id: row.actor_id,
      issuer_id: row.issuer_id,
      scope_kind: row.scope_kind,
      action: row.action,
      resource: {
        resource_kind: row.resource_kind,
        project_id: row.resource_project_id,
        resource_id: row.resource_id,
      },
      issued_at_ms: row.issued_at_ms,
      expires_at_ms: row.expires_at_ms,
    });
  } catch {
    fail('builder_permission_fact_store_integrity_failed');
  }
}

function revocationFromRow(row) {
  if (!row) return null;
  try {
    return sanitizeBuilderPermissionRevocationRecord({
      revocation_id: row.revocation_id,
      record_version: row.record_version,
      policy_version: row.policy_version,
      permission_id: row.permission_id,
      project_id: row.project_id,
      revoker_id: row.revoker_id,
      revoked_at_ms: row.revoked_at_ms,
    });
  } catch {
    fail('builder_permission_fact_store_integrity_failed');
  }
}

function loadGrant(db, projectId, permissionId) {
  return grantFromRow(one(
    db,
    `SELECT project_id, permission_id, record_version, policy_version, actor_id, issuer_id,
      scope_kind, action, resource_kind, resource_project_id, resource_id, issued_at_ms,
      expires_at_ms
      FROM permission_grants WHERE project_id = ? AND permission_id = ?`,
    [projectId, permissionId],
  ));
}

function loadRevocationByPermission(db, projectId, permissionId) {
  return revocationFromRow(one(
    db,
    `SELECT project_id, revocation_id, record_version, policy_version, permission_id,
      revoker_id, revoked_at_ms
      FROM permission_revocations WHERE project_id = ? AND permission_id = ?`,
    [projectId, permissionId],
  ));
}

function sameFact(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function evidence(db, transaction) {
  return frozen({
    database_id: DATABASE_ID,
    schema_version: BUILDER_PERMISSION_FACT_STORE_SCHEMA_VERSION,
    user_version: BUILDER_PERMISSION_FACT_STORE_USER_VERSION,
    schema_fingerprint_digest: sha256Canonical(collectSchemaFingerprint(db)),
    runtime_pragmas: runtimePragmas(db),
    transaction,
    permission_authority: 'main_owned_permission_fact_store',
    renderer_authority: 'not_present',
    provider_dispatch: false,
    credential_storage: 'not_present',
  });
}

function grantResult(db, operation, grant) {
  return frozen({
    result_version: BUILDER_PERMISSION_FACT_STORE_RESULT_VERSION,
    operation,
    grant,
    permission_evidence: evidence(db, operation === 'grant_recorded'
      ? 'permission_grant_insert_readback'
      : 'permission_grant_replay_readback'),
  });
}

function revocationResult(db, operation, revocation) {
  return frozen({
    result_version: BUILDER_PERMISSION_FACT_STORE_RESULT_VERSION,
    operation,
    revocation,
    permission_evidence: evidence(db, operation === 'revocation_recorded'
      ? 'permission_revocation_insert_readback'
      : 'permission_revocation_replay_readback'),
  });
}

function insertGrant(db, grant) {
  run(db, `INSERT INTO permission_grants (
    project_id, permission_id, record_version, policy_version, actor_id, issuer_id,
    scope_kind, action, resource_kind, resource_project_id, resource_id, issued_at_ms,
    expires_at_ms, schema_version
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
    grant.project_id,
    grant.permission_id,
    grant.record_version,
    grant.policy_version,
    grant.actor_id,
    grant.issuer_id,
    grant.scope_kind,
    grant.action,
    grant.resource.resource_kind,
    grant.resource.project_id,
    grant.resource.resource_id,
    grant.issued_at_ms,
    grant.expires_at_ms,
    BUILDER_PERMISSION_FACT_STORE_SCHEMA_VERSION,
  ]);
}

function insertRevocation(db, revocation) {
  run(db, `INSERT INTO permission_revocations (
    project_id, revocation_id, record_version, policy_version, permission_id,
    revoker_id, revoked_at_ms, schema_version
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [
    revocation.project_id,
    revocation.revocation_id,
    revocation.record_version,
    revocation.policy_version,
    revocation.permission_id,
    revocation.revoker_id,
    revocation.revoked_at_ms,
    BUILDER_PERMISSION_FACT_STORE_SCHEMA_VERSION,
  ]);
}

function recordGrant(db, rawRequest) {
  const grant = sanitizeGrantRequest(rawRequest);
  db.exec('BEGIN IMMEDIATE');
  try {
    const existing = loadGrant(db, grant.project_id, grant.permission_id);
    if (existing !== null) {
      if (!sameFact(existing, grant)) fail('builder_permission_fact_store_integrity_failed');
      db.exec('COMMIT');
      return grantResult(db, 'grant_replayed', existing);
    }
    insertGrant(db, grant);
    const readback = loadGrant(db, grant.project_id, grant.permission_id);
    if (readback === null || !sameFact(readback, grant)) {
      fail('builder_permission_fact_store_integrity_failed');
    }
    db.exec('COMMIT');
    return grantResult(db, 'grant_recorded', readback);
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* fixed failure below */ }
    throw error;
  }
}

function recordRevocation(db, rawRequest) {
  const revocation = sanitizeRevocationRequest(rawRequest);
  db.exec('BEGIN IMMEDIATE');
  try {
    const grant = loadGrant(db, revocation.project_id, revocation.permission_id);
    if (grant === null) fail('builder_permission_fact_store_not_found');
    if (revocation.revoked_at_ms < grant.issued_at_ms) {
      fail('builder_permission_fact_store_invalid');
    }
    const existing = loadRevocationByPermission(db, revocation.project_id, revocation.permission_id);
    if (existing !== null) {
      if (!sameFact(existing, revocation)) fail('builder_permission_fact_store_conflict');
      db.exec('COMMIT');
      return revocationResult(db, 'revocation_replayed', existing);
    }
    insertRevocation(db, revocation);
    const readback = loadRevocationByPermission(db, revocation.project_id, revocation.permission_id);
    if (readback === null || !sameFact(readback, revocation)) {
      fail('builder_permission_fact_store_integrity_failed');
    }
    db.exec('COMMIT');
    return revocationResult(db, 'revocation_recorded', readback);
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* fixed failure below */ }
    throw error;
  }
}

function matchingGrants(db, request) {
  const rows = all(
    db,
    `SELECT project_id, permission_id, record_version, policy_version, actor_id, issuer_id,
      scope_kind, action, resource_kind, resource_project_id, resource_id, issued_at_ms,
      expires_at_ms
      FROM permission_grants
      WHERE policy_version = ? AND actor_id = ? AND action = ?
        AND resource_kind = ? AND resource_project_id = ? AND resource_id = ?
      ORDER BY issued_at_ms ASC, permission_id ASC
      LIMIT ?`,
    [
      request.policy_version,
      request.actor_id,
      request.action,
      request.resource.resource_kind,
      request.resource.project_id,
      request.resource.resource_id,
      MAX_FACTS + 1,
    ],
  );
  if (rows.length > MAX_FACTS) fail('builder_permission_fact_store_resource_exceeded');
  return frozen(rows.map(grantFromRow));
}

function matchingRevocations(db, request, grants) {
  if (grants.length === 0) return frozen([]);
  const placeholders = grants.map(() => '?').join(', ');
  const rows = all(
    db,
    `SELECT project_id, revocation_id, record_version, policy_version, permission_id,
      revoker_id, revoked_at_ms
      FROM permission_revocations
      WHERE project_id = ? AND permission_id IN (${placeholders})
      ORDER BY revoked_at_ms ASC, revocation_id ASC
      LIMIT ?`,
    [request.resource.project_id, ...grants.map((grant) => grant.permission_id), MAX_FACTS + 1],
  );
  if (rows.length > MAX_FACTS) fail('builder_permission_fact_store_resource_exceeded');
  return frozen(rows.map(revocationFromRow));
}

function readPermissionFacts(db, rawRequest) {
  const request = sanitizeReadRequest(rawRequest);
  const grants = matchingGrants(db, request);
  const revocations = matchingRevocations(db, request, grants);
  return frozen({
    result_version: BUILDER_PERMISSION_FACTS_READ_RESULT_VERSION,
    permission_authority: 'main_owned_permission_fact_store',
    policy_version: request.policy_version,
    actor_id: request.actor_id,
    action: request.action,
    resource: request.resource,
    grants,
    revocations,
  });
}

function ownErrorField(error, key) {
  if (!error || typeof error !== 'object' || utilTypes.isProxy(error)) return null;
  const descriptor = Object.getOwnPropertyDescriptor(error, key);
  return descriptor && Object.hasOwn(descriptor, 'value')
    ? descriptor.value
    : null;
}

function normalizeOperationError(error) {
  if (error instanceof BuilderPermissionFactStoreError) {
    return new BuilderPermissionFactStoreError(error.code);
  }
  if (error instanceof BuilderPermissionAuthorityContractError) {
    return new BuilderPermissionFactStoreError('builder_permission_fact_store_invalid');
  }
  const sqliteCode = ownErrorField(error, 'code');
  const sqliteErrstr = ownErrorField(error, 'errstr');
  const sqliteErrcode = ownErrorField(error, 'errcode');
  if (sqliteCode && /^SQLITE_CONSTRAINT/u.test(sqliteCode)) {
    return new BuilderPermissionFactStoreError('builder_permission_fact_store_integrity_failed');
  }
  if (sqliteErrstr === 'constraint failed' || sqliteErrcode === 1555) {
    return new BuilderPermissionFactStoreError('builder_permission_fact_store_integrity_failed');
  }
  if (sqliteCode && /^SQLITE_(CORRUPT|NOTADB|SCHEMA|INTERNAL|MISMATCH)/u.test(sqliteCode)) {
    return new BuilderPermissionFactStoreError('builder_permission_fact_store_integrity_failed');
  }
  return new BuilderPermissionFactStoreError('builder_permission_fact_store_unavailable');
}

function createBuilderPermissionFactStore(databasePath) {
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

  return frozen({
    store_version: BUILDER_PERMISSION_FACT_STORE_VERSION,

    close(...rawArguments) {
      if (rawArguments.length !== 0) {
        throw new BuilderPermissionFactStoreError('builder_permission_fact_store_invalid');
      }
      try { db.close(); } catch (error) { throw normalizeOperationError(error); }
    },

    record_grant(rawRequest) {
      try { return recordGrant(db, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },

    record_revocation(rawRequest) {
      try { return recordRevocation(db, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },

    read_permission_facts(rawRequest) {
      try { return readPermissionFacts(db, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },

    create_evaluator(...rawArguments) {
      if (rawArguments.length !== 0) {
        throw new BuilderPermissionFactStoreError('builder_permission_fact_store_invalid');
      }
      return createBuilderPermissionEvaluator({
        read_permission_facts: (request) => readPermissionFacts(db, request),
      });
    },
  });
}

module.exports = frozen({
  BUILDER_PERMISSION_FACT_STORE_VERSION,
  BUILDER_PERMISSION_FACT_STORE_RESULT_VERSION,
  BUILDER_PERMISSION_FACT_STORE_SCHEMA_VERSION,
  BUILDER_PERMISSION_FACT_STORE_USER_VERSION,
  BuilderPermissionFactStoreError,
  createBuilderPermissionFactStore,
});
