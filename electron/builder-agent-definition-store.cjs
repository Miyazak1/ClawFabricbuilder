'use strict';

const nodeCrypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { types: utilTypes } = require('node:util');

const {
  BuilderAgentDefinitionContractError,
  sanitizeBuilderAgentDefinitionRecord,
  sanitizeBuilderAgentLifecycleRecord,
  sanitizeBuilderAgentVersionRecord,
} = require('./builder-agent-definition-contract.cjs');

const BUILDER_AGENT_DEFINITION_STORE_VERSION = 'builder-agent-definition-store.v1';
const BUILDER_AGENT_DEFINITION_STORE_RESULT_VERSION = 'builder-agent-definition-store-result.v1';
const BUILDER_AGENT_DEFINITION_STORE_READ_RESULT_VERSION = 'builder-agent-definition-store-read-result.v1';
const BUILDER_AGENT_DEFINITION_STORE_SCHEMA_VERSION = 'builder-agent-definition-store-schema.v1';
const BUILDER_AGENT_DEFINITION_STORE_USER_VERSION = 1;
const DATABASE_ID = 'builder-agent-definition-store.v1';
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const OWNER_ID_PATTERN = new RegExp(`^builder-user:${UUID_SOURCE}$`, 'u');
const AGENT_ID_PATTERN = new RegExp(`^builder-agent:${UUID_SOURCE}$`, 'u');
const RECORD_DEFINITION_KEYS = Object.freeze(['definition']);
const RECORD_VERSION_KEYS = Object.freeze(['version']);
const RECORD_LIFECYCLE_KEYS = Object.freeze(['lifecycle']);
const READ_AGENT_KEYS = Object.freeze(['agent_id', 'owner_id']);
const MAX_AGENT_VERSIONS = 128;
const MAX_LIFECYCLE_RECORDS = 256;
const CREATE_SCHEMA_SQL = Object.freeze([
  `CREATE TABLE agent_definitions (
    agent_id TEXT NOT NULL PRIMARY KEY,
    definition_digest TEXT NOT NULL UNIQUE,
    record_version TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    display_name TEXT NOT NULL,
    purpose TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL,
    schema_version TEXT NOT NULL,
    CHECK (schema_version = 'builder-agent-definition-store-schema.v1'),
    CHECK (record_version = 'builder-agent-definition-record.v1'),
    CHECK (created_at_ms >= 0)
  ) STRICT`,
  `CREATE TABLE agent_versions (
    agent_id TEXT NOT NULL,
    agent_version_id TEXT NOT NULL,
    definition_digest TEXT NOT NULL,
    record_version TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    version_number INTEGER NOT NULL,
    instructions TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL,
    permission_boundary TEXT NOT NULL,
    schema_version TEXT NOT NULL,
    PRIMARY KEY (agent_id, agent_version_id),
    UNIQUE (agent_id, version_number),
    CHECK (schema_version = 'builder-agent-definition-store-schema.v1'),
    CHECK (record_version = 'builder-agent-version-record.v1'),
    CHECK (version_number >= 1),
    CHECK (created_at_ms >= 0),
    CHECK (permission_boundary = 'explicit_permission_required'),
    FOREIGN KEY (agent_id)
      REFERENCES agent_definitions(agent_id)
      ON DELETE RESTRICT ON UPDATE RESTRICT
  ) STRICT`,
  `CREATE TABLE agent_lifecycle (
    agent_id TEXT NOT NULL,
    agent_lifecycle_id TEXT NOT NULL,
    definition_digest TEXT NOT NULL,
    record_version TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    decided_by TEXT NOT NULL,
    next_status TEXT NOT NULL,
    reason TEXT NOT NULL,
    decided_at_ms INTEGER NOT NULL,
    schema_version TEXT NOT NULL,
    PRIMARY KEY (agent_id, agent_lifecycle_id),
    CHECK (schema_version = 'builder-agent-definition-store-schema.v1'),
    CHECK (record_version = 'builder-agent-lifecycle-record.v1'),
    CHECK (next_status IN ('active', 'archived', 'revoked')),
    CHECK (decided_at_ms >= 0),
    FOREIGN KEY (agent_id)
      REFERENCES agent_definitions(agent_id)
      ON DELETE RESTRICT ON UPDATE RESTRICT
  ) STRICT`,
  'CREATE INDEX agent_definitions_owner_idx ON agent_definitions(owner_id, agent_id)',
  'CREATE INDEX agent_versions_lookup_idx ON agent_versions(agent_id, version_number)',
  'CREATE INDEX agent_lifecycle_lookup_idx ON agent_lifecycle(agent_id, decided_at_ms, agent_lifecycle_id)',
]);
const ERROR_MESSAGES = Object.freeze({
  builder_agent_definition_store_invalid: 'Builder agent definitions could not be verified.',
  builder_agent_definition_store_not_found: 'Builder agent definition is unavailable.',
  builder_agent_definition_store_conflict: 'Builder agent definitions changed before they could be recorded.',
  builder_agent_definition_store_integrity_failed: 'Builder agent definition integrity could not be verified.',
  builder_agent_definition_store_resource_exceeded: 'Builder agent definition limits were reached.',
  builder_agent_definition_store_unavailable: 'Builder agent definition storage is unavailable.',
});

class BuilderAgentDefinitionStoreError extends Error {
  constructor(code = 'builder_agent_definition_store_invalid') {
    const selected = Object.hasOwn(ERROR_MESSAGES, code)
      ? code
      : 'builder_agent_definition_store_invalid';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderAgentDefinitionStoreError';
    this.code = selected;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) {
  throw new BuilderAgentDefinitionStoreError(code);
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
  if (!isPlainObject(value)) fail('builder_agent_definition_store_invalid');
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== keys.length
    || actual.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) fail('builder_agent_definition_store_invalid');
  for (const key of actual) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      fail('builder_agent_definition_store_invalid');
    }
  }
}

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
    fail('builder_agent_definition_store_invalid');
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
  fail('builder_agent_definition_store_invalid');
}

function sha256Canonical(value) {
  return nodeCrypto.createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

function safePattern(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) {
    fail('builder_agent_definition_store_invalid');
  }
  return value;
}

function safeAgentId(value) {
  return safePattern(value, AGENT_ID_PATTERN);
}

function safeOwnerId(value) {
  return safePattern(value, OWNER_ID_PATTERN);
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
  ) fail('builder_agent_definition_store_invalid');
  return value;
}

function assertParentDirectory(filePath) {
  let info;
  try {
    info = fs.lstatSync(path.dirname(filePath));
  } catch {
    fail('builder_agent_definition_store_unavailable');
  }
  if (!info.isDirectory() || info.isSymbolicLink()) {
    fail('builder_agent_definition_store_unavailable');
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
    fail('builder_agent_definition_store_integrity_failed');
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
  if (mode !== 'wal') fail('builder_agent_definition_store_unavailable');
  const pragmas = runtimePragmas(db);
  if (
    pragmas.foreign_keys !== 'on'
    || pragmas.trusted_schema !== 'off'
    || pragmas.synchronous !== 'full'
    || pragmas.journal_mode !== 'wal'
  ) fail('builder_agent_definition_store_unavailable');
}

function createSchema(db) {
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const sql of CREATE_SCHEMA_SQL) db.exec(sql);
    db.exec(`PRAGMA user_version = ${BUILDER_AGENT_DEFINITION_STORE_USER_VERSION}`);
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
    expectedDb.exec(`PRAGMA user_version = ${BUILDER_AGENT_DEFINITION_STORE_USER_VERSION}`);
    expectedSchemaFingerprint = canonicalJson(collectSchemaFingerprint(expectedDb));
    return expectedSchemaFingerprint;
  } finally {
    expectedDb.close();
  }
}

function validateSchema(db) {
  const actual = collectSchemaFingerprint(db);
  if (actual.foreign_key_check.length !== 0) fail('builder_agent_definition_store_integrity_failed');
  if (canonicalJson(actual) !== expectedFingerprint()) {
    fail('builder_agent_definition_store_integrity_failed');
  }
}

function initialize(db) {
  configurePragmas(db);
  const version = userVersion(db);
  if (version === 0) createSchema(db);
  else if (version !== BUILDER_AGENT_DEFINITION_STORE_USER_VERSION) {
    fail('builder_agent_definition_store_integrity_failed');
  }
  validateSchema(db);
}

function sanitizeDefinitionRequest(value) {
  exactObject(value, RECORD_DEFINITION_KEYS);
  try {
    return sanitizeBuilderAgentDefinitionRecord(valueAt(value, 'definition'));
  } catch (error) {
    if (error instanceof BuilderAgentDefinitionContractError) {
      fail('builder_agent_definition_store_invalid');
    }
    throw error;
  }
}

function sanitizeReadAgentRequest(value) {
  exactObject(value, READ_AGENT_KEYS);
  return freezeDeep({
    agent_id: safeAgentId(valueAt(value, 'agent_id')),
    owner_id: safeOwnerId(valueAt(value, 'owner_id')),
  });
}

function definitionFromRow(row) {
  if (!row) return null;
  try {
    return sanitizeBuilderAgentDefinitionRecord({
      definition_digest: row.definition_digest,
      record_version: row.record_version,
      agent_id: row.agent_id,
      owner_id: row.owner_id,
      display_name: row.display_name,
      purpose: row.purpose,
      created_at_ms: row.created_at_ms,
    });
  } catch {
    fail('builder_agent_definition_store_integrity_failed');
  }
}

function versionFromRow(row, definition) {
  if (!row) return null;
  try {
    return sanitizeBuilderAgentVersionRecord({
      agent_version_id: row.agent_version_id,
      definition_digest: row.definition_digest,
      record_version: row.record_version,
      agent_id: row.agent_id,
      owner_id: row.owner_id,
      version_number: row.version_number,
      instructions: row.instructions,
      created_at_ms: row.created_at_ms,
      permission_boundary: row.permission_boundary,
    }, definition);
  } catch {
    fail('builder_agent_definition_store_integrity_failed');
  }
}

function lifecycleFromRow(row, definition) {
  if (!row) return null;
  try {
    return sanitizeBuilderAgentLifecycleRecord({
      agent_lifecycle_id: row.agent_lifecycle_id,
      definition_digest: row.definition_digest,
      record_version: row.record_version,
      agent_id: row.agent_id,
      owner_id: row.owner_id,
      decided_by: row.decided_by,
      next_status: row.next_status,
      reason: row.reason,
      decided_at_ms: row.decided_at_ms,
    }, definition);
  } catch {
    fail('builder_agent_definition_store_integrity_failed');
  }
}

function loadDefinition(db, agentId) {
  return definitionFromRow(one(
    db,
    `SELECT agent_id, definition_digest, record_version, owner_id, display_name,
      purpose, created_at_ms
      FROM agent_definitions WHERE agent_id = ?`,
    [agentId],
  ));
}

function loadVersionById(db, definition, agentVersionId) {
  return versionFromRow(one(
    db,
    `SELECT agent_id, agent_version_id, definition_digest, record_version,
      owner_id, version_number, instructions, created_at_ms, permission_boundary
      FROM agent_versions WHERE agent_id = ? AND agent_version_id = ?`,
    [definition.agent_id, agentVersionId],
  ), definition);
}

function loadVersionByNumber(db, definition, versionNumber) {
  return versionFromRow(one(
    db,
    `SELECT agent_id, agent_version_id, definition_digest, record_version,
      owner_id, version_number, instructions, created_at_ms, permission_boundary
      FROM agent_versions WHERE agent_id = ? AND version_number = ?`,
    [definition.agent_id, versionNumber],
  ), definition);
}

function loadLifecycleById(db, definition, agentLifecycleId) {
  return lifecycleFromRow(one(
    db,
    `SELECT agent_id, agent_lifecycle_id, definition_digest, record_version,
      owner_id, decided_by, next_status, reason, decided_at_ms
      FROM agent_lifecycle WHERE agent_id = ? AND agent_lifecycle_id = ?`,
    [definition.agent_id, agentLifecycleId],
  ), definition);
}

function latestVersion(db, definition) {
  return versionFromRow(one(
    db,
    `SELECT agent_id, agent_version_id, definition_digest, record_version,
      owner_id, version_number, instructions, created_at_ms, permission_boundary
      FROM agent_versions
      WHERE agent_id = ?
      ORDER BY version_number DESC, agent_version_id DESC
      LIMIT 1`,
    [definition.agent_id],
  ), definition);
}

function latestLifecycle(db, definition) {
  return lifecycleFromRow(one(
    db,
    `SELECT agent_id, agent_lifecycle_id, definition_digest, record_version,
      owner_id, decided_by, next_status, reason, decided_at_ms
      FROM agent_lifecycle
      WHERE agent_id = ?
      ORDER BY decided_at_ms DESC, agent_lifecycle_id DESC
      LIMIT 1`,
    [definition.agent_id],
  ), definition);
}

function sameFact(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function evidence(db, transaction) {
  return freezeDeep({
    database_id: DATABASE_ID,
    schema_version: BUILDER_AGENT_DEFINITION_STORE_SCHEMA_VERSION,
    user_version: BUILDER_AGENT_DEFINITION_STORE_USER_VERSION,
    schema_fingerprint_digest: sha256Canonical(collectSchemaFingerprint(db)),
    runtime_pragmas: runtimePragmas(db),
    transaction,
    agent_authority: 'main_owned_agent_definition_store',
    renderer_authority: 'not_present',
    ipc_authority: 'not_present',
    tool_dispatch: false,
    permission_grant_authority: false,
    credential_storage: 'not_present',
  });
}

function storeResult(db, operation, payload) {
  return freezeDeep({
    result_version: BUILDER_AGENT_DEFINITION_STORE_RESULT_VERSION,
    operation,
    ...payload,
    agent_evidence: evidence(db, operation),
  });
}

function insertDefinition(db, definition) {
  run(db, `INSERT INTO agent_definitions (
    agent_id, definition_digest, record_version, owner_id, display_name,
    purpose, created_at_ms, schema_version
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [
    definition.agent_id,
    definition.definition_digest,
    definition.record_version,
    definition.owner_id,
    definition.display_name,
    definition.purpose,
    definition.created_at_ms,
    BUILDER_AGENT_DEFINITION_STORE_SCHEMA_VERSION,
  ]);
}

function insertVersion(db, version) {
  run(db, `INSERT INTO agent_versions (
    agent_id, agent_version_id, definition_digest, record_version, owner_id,
    version_number, instructions, created_at_ms, permission_boundary, schema_version
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
    version.agent_id,
    version.agent_version_id,
    version.definition_digest,
    version.record_version,
    version.owner_id,
    version.version_number,
    version.instructions,
    version.created_at_ms,
    version.permission_boundary,
    BUILDER_AGENT_DEFINITION_STORE_SCHEMA_VERSION,
  ]);
}

function insertLifecycle(db, lifecycle) {
  run(db, `INSERT INTO agent_lifecycle (
    agent_id, agent_lifecycle_id, definition_digest, record_version, owner_id,
    decided_by, next_status, reason, decided_at_ms, schema_version
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
    lifecycle.agent_id,
    lifecycle.agent_lifecycle_id,
    lifecycle.definition_digest,
    lifecycle.record_version,
    lifecycle.owner_id,
    lifecycle.decided_by,
    lifecycle.next_status,
    lifecycle.reason,
    lifecycle.decided_at_ms,
    BUILDER_AGENT_DEFINITION_STORE_SCHEMA_VERSION,
  ]);
}

function recordDefinition(db, rawRequest) {
  const definition = sanitizeDefinitionRequest(rawRequest);
  db.exec('BEGIN IMMEDIATE');
  try {
    const existing = loadDefinition(db, definition.agent_id);
    if (existing !== null) {
      if (!sameFact(existing, definition)) fail('builder_agent_definition_store_conflict');
      db.exec('COMMIT');
      return storeResult(db, 'definition_replayed', { definition: existing });
    }
    insertDefinition(db, definition);
    const readback = loadDefinition(db, definition.agent_id);
    if (readback === null || !sameFact(readback, definition)) {
      fail('builder_agent_definition_store_integrity_failed');
    }
    db.exec('COMMIT');
    return storeResult(db, 'definition_recorded', { definition: readback });
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* fixed failure below */ }
    throw error;
  }
}

function sanitizeVersionRequest(db, value) {
  exactObject(value, RECORD_VERSION_KEYS);
  const rawVersion = valueAt(value, 'version');
  if (!isPlainObject(rawVersion)) fail('builder_agent_definition_store_invalid');
  const agentId = safeAgentId(valueAt(rawVersion, 'agent_id'));
  const definition = loadDefinition(db, agentId);
  if (definition === null) fail('builder_agent_definition_store_not_found');
  try {
    return {
      definition,
      version: sanitizeBuilderAgentVersionRecord(rawVersion, definition),
    };
  } catch (error) {
    if (error instanceof BuilderAgentDefinitionContractError) {
      fail('builder_agent_definition_store_invalid');
    }
    throw error;
  }
}

function recordVersion(db, rawRequest) {
  const { definition, version } = sanitizeVersionRequest(db, rawRequest);
  db.exec('BEGIN IMMEDIATE');
  try {
    const existing = loadVersionById(db, definition, version.agent_version_id);
    if (existing !== null) {
      if (!sameFact(existing, version)) fail('builder_agent_definition_store_conflict');
      db.exec('COMMIT');
      return storeResult(db, 'version_replayed', { version: existing });
    }
    const sameNumber = loadVersionByNumber(db, definition, version.version_number);
    if (sameNumber !== null) fail('builder_agent_definition_store_conflict');
    const previous = latestVersion(db, definition);
    if (version.created_at_ms < definition.created_at_ms) fail('builder_agent_definition_store_invalid');
    if (previous === null) {
      if (version.version_number !== 1) fail('builder_agent_definition_store_invalid');
    } else {
      if (
        version.version_number !== previous.version_number + 1
        || version.created_at_ms < previous.created_at_ms
      ) fail('builder_agent_definition_store_invalid');
    }
    insertVersion(db, version);
    const readback = loadVersionById(db, definition, version.agent_version_id);
    if (readback === null || !sameFact(readback, version)) {
      fail('builder_agent_definition_store_integrity_failed');
    }
    db.exec('COMMIT');
    return storeResult(db, 'version_recorded', { version: readback });
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* fixed failure below */ }
    throw error;
  }
}

function sanitizeLifecycleRequest(db, value) {
  exactObject(value, RECORD_LIFECYCLE_KEYS);
  const rawLifecycle = valueAt(value, 'lifecycle');
  if (!isPlainObject(rawLifecycle)) fail('builder_agent_definition_store_invalid');
  const agentId = safeAgentId(valueAt(rawLifecycle, 'agent_id'));
  const definition = loadDefinition(db, agentId);
  if (definition === null) fail('builder_agent_definition_store_not_found');
  try {
    return {
      definition,
      lifecycle: sanitizeBuilderAgentLifecycleRecord(rawLifecycle, definition),
    };
  } catch (error) {
    if (error instanceof BuilderAgentDefinitionContractError) {
      fail('builder_agent_definition_store_invalid');
    }
    throw error;
  }
}

function recordLifecycle(db, rawRequest) {
  const { definition, lifecycle } = sanitizeLifecycleRequest(db, rawRequest);
  db.exec('BEGIN IMMEDIATE');
  try {
    const existing = loadLifecycleById(db, definition, lifecycle.agent_lifecycle_id);
    if (existing !== null) {
      if (!sameFact(existing, lifecycle)) fail('builder_agent_definition_store_conflict');
      db.exec('COMMIT');
      return storeResult(db, 'lifecycle_replayed', { lifecycle: existing });
    }
    const previous = latestLifecycle(db, definition);
    if (lifecycle.decided_at_ms < definition.created_at_ms) fail('builder_agent_definition_store_invalid');
    if (previous !== null) {
      if (previous.next_status === 'revoked') fail('builder_agent_definition_store_conflict');
      if (lifecycle.decided_at_ms < previous.decided_at_ms) {
        fail('builder_agent_definition_store_invalid');
      }
    }
    insertLifecycle(db, lifecycle);
    const readback = loadLifecycleById(db, definition, lifecycle.agent_lifecycle_id);
    if (readback === null || !sameFact(readback, lifecycle)) {
      fail('builder_agent_definition_store_integrity_failed');
    }
    db.exec('COMMIT');
    return storeResult(db, 'lifecycle_recorded', { lifecycle: readback });
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* fixed failure below */ }
    throw error;
  }
}

function readVersions(db, definition) {
  const rows = all(
    db,
    `SELECT agent_id, agent_version_id, definition_digest, record_version,
      owner_id, version_number, instructions, created_at_ms, permission_boundary
      FROM agent_versions
      WHERE agent_id = ?
      ORDER BY version_number ASC, agent_version_id ASC
      LIMIT ?`,
    [definition.agent_id, MAX_AGENT_VERSIONS + 1],
  );
  if (rows.length > MAX_AGENT_VERSIONS) fail('builder_agent_definition_store_resource_exceeded');
  return freezeDeep(rows.map((row) => versionFromRow(row, definition)));
}

function readLifecycle(db, definition) {
  const rows = all(
    db,
    `SELECT agent_id, agent_lifecycle_id, definition_digest, record_version,
      owner_id, decided_by, next_status, reason, decided_at_ms
      FROM agent_lifecycle
      WHERE agent_id = ?
      ORDER BY decided_at_ms ASC, agent_lifecycle_id ASC
      LIMIT ?`,
    [definition.agent_id, MAX_LIFECYCLE_RECORDS + 1],
  );
  if (rows.length > MAX_LIFECYCLE_RECORDS) fail('builder_agent_definition_store_resource_exceeded');
  return freezeDeep(rows.map((row) => lifecycleFromRow(row, definition)));
}

function readAgent(db, rawRequest) {
  const request = sanitizeReadAgentRequest(rawRequest);
  const definition = loadDefinition(db, request.agent_id);
  if (definition === null || definition.owner_id !== request.owner_id) {
    return freezeDeep({
      result_version: BUILDER_AGENT_DEFINITION_STORE_READ_RESULT_VERSION,
      agent_authority: 'main_owned_agent_definition_store',
      status: 'absent',
      agent_id: request.agent_id,
      owner_id: request.owner_id,
      definition: null,
      versions: [],
      lifecycle: [],
      current_status: null,
      current_version: null,
      evidence: evidence(db, 'agent_absent_read'),
    });
  }
  const versions = readVersions(db, definition);
  const lifecycle = readLifecycle(db, definition);
  const currentLifecycle = lifecycle.at(-1) ?? null;
  const currentVersion = versions.at(-1) ?? null;
  return freezeDeep({
    result_version: BUILDER_AGENT_DEFINITION_STORE_READ_RESULT_VERSION,
    agent_authority: 'main_owned_agent_definition_store',
    status: 'ready',
    agent_id: request.agent_id,
    owner_id: request.owner_id,
    definition,
    versions,
    lifecycle,
    current_status: currentLifecycle === null ? null : currentLifecycle.next_status,
    current_version: currentVersion,
    evidence: evidence(db, 'agent_ready_read'),
  });
}

function ownErrorField(error, key) {
  if (!error || typeof error !== 'object' || utilTypes.isProxy(error)) return null;
  const descriptor = Object.getOwnPropertyDescriptor(error, key);
  return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : null;
}

function normalizeOperationError(error) {
  if (error instanceof BuilderAgentDefinitionStoreError) {
    return new BuilderAgentDefinitionStoreError(error.code);
  }
  if (error instanceof BuilderAgentDefinitionContractError) {
    return new BuilderAgentDefinitionStoreError('builder_agent_definition_store_invalid');
  }
  const sqliteCode = ownErrorField(error, 'code');
  const sqliteErrstr = ownErrorField(error, 'errstr');
  const sqliteErrcode = ownErrorField(error, 'errcode');
  if (sqliteCode && /^SQLITE_CONSTRAINT/u.test(sqliteCode)) {
    return new BuilderAgentDefinitionStoreError('builder_agent_definition_store_integrity_failed');
  }
  if (sqliteErrstr === 'constraint failed' || sqliteErrcode === 1555) {
    return new BuilderAgentDefinitionStoreError('builder_agent_definition_store_integrity_failed');
  }
  if (sqliteCode && /^SQLITE_(CORRUPT|NOTADB|SCHEMA|INTERNAL|MISMATCH)/u.test(sqliteCode)) {
    return new BuilderAgentDefinitionStoreError('builder_agent_definition_store_integrity_failed');
  }
  return new BuilderAgentDefinitionStoreError('builder_agent_definition_store_unavailable');
}

function createBuilderAgentDefinitionStore(databasePath) {
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
    store_version: BUILDER_AGENT_DEFINITION_STORE_VERSION,

    close(...rawArguments) {
      if (rawArguments.length !== 0) {
        throw new BuilderAgentDefinitionStoreError('builder_agent_definition_store_invalid');
      }
      try { db.close(); } catch (error) { throw normalizeOperationError(error); }
    },

    record_definition(rawRequest) {
      try { return recordDefinition(db, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },

    record_version(rawRequest) {
      try { return recordVersion(db, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },

    record_lifecycle(rawRequest) {
      try { return recordLifecycle(db, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },

    read_agent(rawRequest) {
      try { return readAgent(db, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },
  });
}

module.exports = freezeDeep({
  BUILDER_AGENT_DEFINITION_STORE_READ_RESULT_VERSION,
  BUILDER_AGENT_DEFINITION_STORE_RESULT_VERSION,
  BUILDER_AGENT_DEFINITION_STORE_SCHEMA_VERSION,
  BUILDER_AGENT_DEFINITION_STORE_USER_VERSION,
  BUILDER_AGENT_DEFINITION_STORE_VERSION,
  BuilderAgentDefinitionStoreError,
  createBuilderAgentDefinitionStore,
});
