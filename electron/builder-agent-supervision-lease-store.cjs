'use strict';

const nodeCrypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { types: utilTypes } = require('node:util');

const {
  BuilderAgentAssignmentContractError,
  sanitizeBuilderAgentAssignmentStatusRecord,
} = require('./builder-agent-assignment-contract.cjs');
const {
  BUILDER_AGENT_SUPERVISION_LEASE_RECORD_VERSION,
  BUILDER_AGENT_SUPERVISION_LEASE_RELEASE_RECORD_VERSION,
  BuilderAgentSupervisionLeaseContractError,
  sanitizeBuilderAgentSupervisionLeaseRecord,
  sanitizeBuilderAgentSupervisionLeaseReleaseRecord,
} = require('./builder-agent-supervision-lease-contract.cjs');

const BUILDER_AGENT_SUPERVISION_LEASE_STORE_VERSION = 'builder-agent-supervision-lease-store.v1';
const BUILDER_AGENT_SUPERVISION_LEASE_STORE_RESULT_VERSION = 'builder-agent-supervision-lease-store-result.v1';
const BUILDER_AGENT_SUPERVISION_LEASE_STORE_READ_RESULT_VERSION = 'builder-agent-supervision-lease-store-read-result.v1';
const BUILDER_AGENT_SUPERVISION_LEASE_STORE_SCHEMA_VERSION = 'builder-agent-supervision-lease-store-schema.v1';
const BUILDER_AGENT_SUPERVISION_LEASE_STORE_USER_VERSION = 1;
const DATABASE_ID = 'builder-agent-supervision-lease-store.v1';
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const OWNER_ID_PATTERN = new RegExp(`^builder-user:${UUID_SOURCE}$`, 'u');
const AGENT_ID_PATTERN = new RegExp(`^builder-agent:${UUID_SOURCE}$`, 'u');
const PROJECT_ID_PATTERN = new RegExp(`^builder-project:${UUID_SOURCE}$`, 'u');
const CONVERSATION_ID_PATTERN = new RegExp(`^builder-conversation:${UUID_SOURCE}$`, 'u');
const TASK_ID_PATTERN = new RegExp(`^builder-task:${UUID_SOURCE}$`, 'u');
const RUN_ID_PATTERN = new RegExp(`^builder-run:${UUID_SOURCE}$`, 'u');
const SUPERVISOR_ID_PATTERN = new RegExp(`^builder-supervisor:${UUID_SOURCE}$`, 'u');
const ASSIGNMENT_ID_PATTERN = /^builder-agent-assignment:[0-9a-f]{64}$/u;
const ASSIGNMENT_STATUS_ID_PATTERN = /^builder-agent-assignment-status:[0-9a-f]{64}$/u;
const LEASE_ID_PATTERN = /^builder-agent-supervision-lease:[0-9a-f]{64}$/u;
const RELEASE_ID_PATTERN = /^builder-agent-supervision-lease-release:[0-9a-f]{64}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const RECORD_LEASE_KEYS = Object.freeze(['assignment', 'status', 'lease']);
const RECORD_RELEASE_KEYS = Object.freeze(['release']);
const READ_LEASE_KEYS = Object.freeze(['lease_id', 'owner_id']);
const READ_ASSIGNMENT_LEASES_KEYS = Object.freeze(['assignment_id', 'owner_id', 'now_ms']);
const MAX_LEASES_PER_ASSIGNMENT = 256;
const CREATE_SCHEMA_SQL = Object.freeze([
  `CREATE TABLE agent_supervision_leases (
    lease_id TEXT NOT NULL PRIMARY KEY,
    definition_digest TEXT NOT NULL,
    record_version TEXT NOT NULL,
    assignment_id TEXT NOT NULL,
    assignment_status_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    lease_holder_id TEXT NOT NULL,
    lease_epoch INTEGER NOT NULL,
    acquired_at_ms INTEGER NOT NULL,
    expires_at_ms INTEGER NOT NULL,
    purpose TEXT NOT NULL,
    redispatch_policy TEXT NOT NULL,
    supervision_state TEXT NOT NULL,
    authority_boundary TEXT NOT NULL,
    schema_version TEXT NOT NULL,
    UNIQUE (assignment_id, lease_epoch),
    CHECK (schema_version = 'builder-agent-supervision-lease-store-schema.v1'),
    CHECK (record_version = 'builder-agent-supervision-lease-record.v1'),
    CHECK (lease_epoch >= 1),
    CHECK (acquired_at_ms >= 0),
    CHECK (expires_at_ms > acquired_at_ms),
    CHECK (expires_at_ms - acquired_at_ms <= 600000),
    CHECK (redispatch_policy = 'lease_required_no_duplicate_dispatch'),
    CHECK (supervision_state = 'active_assignment_only'),
    CHECK (authority_boundary = 'main_supervision_lease_only')
  ) STRICT`,
  `CREATE TABLE agent_supervision_lease_releases (
    lease_id TEXT NOT NULL,
    lease_release_id TEXT NOT NULL PRIMARY KEY,
    definition_digest TEXT NOT NULL,
    record_version TEXT NOT NULL,
    assignment_id TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    lease_holder_id TEXT NOT NULL,
    released_by TEXT NOT NULL,
    released_at_ms INTEGER NOT NULL,
    release_outcome TEXT NOT NULL,
    reason TEXT NOT NULL,
    schema_version TEXT NOT NULL,
    UNIQUE (lease_id),
    CHECK (schema_version = 'builder-agent-supervision-lease-store-schema.v1'),
    CHECK (record_version = 'builder-agent-supervision-lease-release-record.v1'),
    CHECK (released_at_ms >= 0),
    CHECK (release_outcome IN ('completed', 'cancelled', 'expired', 'failed', 'superseded')),
    CHECK (released_by = lease_holder_id),
    FOREIGN KEY (lease_id)
      REFERENCES agent_supervision_leases(lease_id)
      ON DELETE RESTRICT ON UPDATE RESTRICT
  ) STRICT`,
  'CREATE INDEX agent_supervision_leases_assignment_idx ON agent_supervision_leases(owner_id, assignment_id, lease_epoch, acquired_at_ms)',
  'CREATE INDEX agent_supervision_leases_expiry_idx ON agent_supervision_leases(assignment_id, expires_at_ms)',
  'CREATE INDEX agent_supervision_lease_releases_lookup_idx ON agent_supervision_lease_releases(lease_id, released_at_ms)',
]);
const ERROR_MESSAGES = Object.freeze({
  builder_agent_supervision_lease_store_invalid: 'Builder agent supervision leases could not be verified.',
  builder_agent_supervision_lease_store_not_found: 'Builder agent supervision lease is unavailable.',
  builder_agent_supervision_lease_store_conflict: 'Builder agent supervision leases changed before they could be recorded.',
  builder_agent_supervision_lease_store_integrity_failed: 'Builder agent supervision lease integrity could not be verified.',
  builder_agent_supervision_lease_store_resource_exceeded: 'Builder agent supervision lease limits were reached.',
  builder_agent_supervision_lease_store_unavailable: 'Builder agent supervision lease storage is unavailable.',
});

class BuilderAgentSupervisionLeaseStoreError extends Error {
  constructor(code = 'builder_agent_supervision_lease_store_invalid') {
    const selected = Object.hasOwn(ERROR_MESSAGES, code)
      ? code
      : 'builder_agent_supervision_lease_store_invalid';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderAgentSupervisionLeaseStoreError';
    this.code = selected;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) {
  throw new BuilderAgentSupervisionLeaseStoreError(code);
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
  if (!isPlainObject(value)) fail('builder_agent_supervision_lease_store_invalid');
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== keys.length
    || actual.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) fail('builder_agent_supervision_lease_store_invalid');
  for (const key of actual) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      fail('builder_agent_supervision_lease_store_invalid');
    }
  }
}

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
    fail('builder_agent_supervision_lease_store_invalid');
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
  fail('builder_agent_supervision_lease_store_invalid');
}

function sha256Canonical(value) {
  return nodeCrypto.createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

function safePattern(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) {
    fail('builder_agent_supervision_lease_store_invalid');
  }
  return value;
}

function safeDigest(value) {
  return safePattern(value, DIGEST_PATTERN);
}

function safeLeaseId(value) {
  return safePattern(value, LEASE_ID_PATTERN);
}

function safeReleaseId(value) {
  return safePattern(value, RELEASE_ID_PATTERN);
}

function safeAssignmentId(value) {
  return safePattern(value, ASSIGNMENT_ID_PATTERN);
}

function safeAssignmentStatusId(value) {
  return safePattern(value, ASSIGNMENT_STATUS_ID_PATTERN);
}

function safeAgentId(value) {
  return safePattern(value, AGENT_ID_PATTERN);
}

function safeOwnerId(value) {
  return safePattern(value, OWNER_ID_PATTERN);
}

function safeProjectId(value) {
  return safePattern(value, PROJECT_ID_PATTERN);
}

function safeConversationId(value) {
  return safePattern(value, CONVERSATION_ID_PATTERN);
}

function safeTaskId(value) {
  return safePattern(value, TASK_ID_PATTERN);
}

function safeRunId(value) {
  return safePattern(value, RUN_ID_PATTERN);
}

function safeSupervisorId(value) {
  return safePattern(value, SUPERVISOR_ID_PATTERN);
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail('builder_agent_supervision_lease_store_invalid');
  return value;
}

function safePositiveInteger(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 1_000_000) {
    fail('builder_agent_supervision_lease_store_invalid');
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

function safeText(value, minLength, maxLength) {
  if (
    typeof value !== 'string'
    || value.trim() !== value
    || value.length < minLength
    || value.length > maxLength
    || hasControlCharacter(value)
  ) fail('builder_agent_supervision_lease_store_invalid');
  return value;
}

function safeLeasePurpose(value) {
  return safeText(value, 1, 280);
}

function safeReleaseReason(value) {
  return safeText(value, 0, 280);
}

function safeReleaseOutcome(value) {
  if (
    value !== 'completed'
    && value !== 'cancelled'
    && value !== 'expired'
    && value !== 'failed'
    && value !== 'superseded'
  ) fail('builder_agent_supervision_lease_store_invalid');
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
  ) fail('builder_agent_supervision_lease_store_invalid');
  return value;
}

function assertParentDirectory(filePath) {
  let info;
  try {
    info = fs.lstatSync(path.dirname(filePath));
  } catch {
    fail('builder_agent_supervision_lease_store_unavailable');
  }
  if (!info.isDirectory() || info.isSymbolicLink()) {
    fail('builder_agent_supervision_lease_store_unavailable');
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
    fail('builder_agent_supervision_lease_store_integrity_failed');
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
  if (mode !== 'wal') fail('builder_agent_supervision_lease_store_unavailable');
  const pragmas = runtimePragmas(db);
  if (
    pragmas.foreign_keys !== 'on'
    || pragmas.trusted_schema !== 'off'
    || pragmas.synchronous !== 'full'
    || pragmas.journal_mode !== 'wal'
  ) fail('builder_agent_supervision_lease_store_unavailable');
}

function createSchema(db) {
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const sql of CREATE_SCHEMA_SQL) db.exec(sql);
    db.exec(`PRAGMA user_version = ${BUILDER_AGENT_SUPERVISION_LEASE_STORE_USER_VERSION}`);
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
    expectedDb.exec(`PRAGMA user_version = ${BUILDER_AGENT_SUPERVISION_LEASE_STORE_USER_VERSION}`);
    expectedSchemaFingerprint = canonicalJson(collectSchemaFingerprint(expectedDb));
    return expectedSchemaFingerprint;
  } finally {
    expectedDb.close();
  }
}

function validateSchema(db) {
  const actual = collectSchemaFingerprint(db);
  if (actual.foreign_key_check.length !== 0) fail('builder_agent_supervision_lease_store_integrity_failed');
  if (canonicalJson(actual) !== expectedFingerprint()) {
    fail('builder_agent_supervision_lease_store_integrity_failed');
  }
}

function initialize(db) {
  configurePragmas(db);
  const version = userVersion(db);
  if (version === 0) createSchema(db);
  else if (version !== BUILDER_AGENT_SUPERVISION_LEASE_STORE_USER_VERSION) {
    fail('builder_agent_supervision_lease_store_integrity_failed');
  }
  validateSchema(db);
}

function leaseIdFor(definitionDigest, fields) {
  return `builder-agent-supervision-lease:${sha256Canonical({
    agent_supervision_lease_identity: BUILDER_AGENT_SUPERVISION_LEASE_RECORD_VERSION,
    definition_digest: definitionDigest,
    fields,
  })}`;
}

function releaseIdFor(lease, fields) {
  return `builder-agent-supervision-lease-release:${sha256Canonical({
    agent_supervision_lease_release_identity: BUILDER_AGENT_SUPERVISION_LEASE_RELEASE_RECORD_VERSION,
    lease_id: lease.lease_id,
    definition_digest: lease.definition_digest,
    fields,
  })}`;
}

function leaseFromRow(row) {
  if (!row) return null;
  try {
    const lease = freezeDeep({
      lease_id: safeLeaseId(row.lease_id),
      definition_digest: safeDigest(row.definition_digest),
      record_version: row.record_version,
      assignment_id: safeAssignmentId(row.assignment_id),
      assignment_status_id: safeAssignmentStatusId(row.assignment_status_id),
      agent_id: safeAgentId(row.agent_id),
      owner_id: safeOwnerId(row.owner_id),
      project_id: safeProjectId(row.project_id),
      conversation_id: safeConversationId(row.conversation_id),
      task_id: safeTaskId(row.task_id),
      run_id: safeRunId(row.run_id),
      lease_holder_id: safeSupervisorId(row.lease_holder_id),
      lease_epoch: safePositiveInteger(row.lease_epoch),
      acquired_at_ms: safeTimestamp(row.acquired_at_ms),
      expires_at_ms: safeTimestamp(row.expires_at_ms),
      purpose: safeLeasePurpose(row.purpose),
      redispatch_policy: row.redispatch_policy,
      supervision_state: row.supervision_state,
      authority_boundary: row.authority_boundary,
    });
    const fields = freezeDeep({
      record_version: lease.record_version,
      assignment_id: lease.assignment_id,
      assignment_status_id: lease.assignment_status_id,
      agent_id: lease.agent_id,
      owner_id: lease.owner_id,
      project_id: lease.project_id,
      conversation_id: lease.conversation_id,
      task_id: lease.task_id,
      run_id: lease.run_id,
      lease_holder_id: lease.lease_holder_id,
      lease_epoch: lease.lease_epoch,
      acquired_at_ms: lease.acquired_at_ms,
      expires_at_ms: lease.expires_at_ms,
      purpose: lease.purpose,
      redispatch_policy: lease.redispatch_policy,
      supervision_state: lease.supervision_state,
      authority_boundary: lease.authority_boundary,
    });
    if (
      lease.record_version !== BUILDER_AGENT_SUPERVISION_LEASE_RECORD_VERSION
      || lease.expires_at_ms <= lease.acquired_at_ms
      || lease.expires_at_ms - lease.acquired_at_ms > 600_000
      || lease.redispatch_policy !== 'lease_required_no_duplicate_dispatch'
      || lease.supervision_state !== 'active_assignment_only'
      || lease.authority_boundary !== 'main_supervision_lease_only'
      || lease.lease_id !== leaseIdFor(lease.definition_digest, fields)
    ) fail('builder_agent_supervision_lease_store_integrity_failed');
    return lease;
  } catch (error) {
    if (error instanceof BuilderAgentSupervisionLeaseStoreError) {
      fail('builder_agent_supervision_lease_store_integrity_failed');
    }
    throw error;
  }
}

function releaseFromRow(row, lease) {
  if (!row) return null;
  try {
    const release = freezeDeep({
      lease_release_id: safeReleaseId(row.lease_release_id),
      definition_digest: safeDigest(row.definition_digest),
      record_version: row.record_version,
      lease_id: safeLeaseId(row.lease_id),
      assignment_id: safeAssignmentId(row.assignment_id),
      owner_id: safeOwnerId(row.owner_id),
      lease_holder_id: safeSupervisorId(row.lease_holder_id),
      released_by: safeSupervisorId(row.released_by),
      released_at_ms: safeTimestamp(row.released_at_ms),
      release_outcome: safeReleaseOutcome(row.release_outcome),
      reason: safeReleaseReason(row.reason),
    });
    const sanitized = sanitizeBuilderAgentSupervisionLeaseReleaseRecord(release, lease);
    const fields = freezeDeep({
      record_version: sanitized.record_version,
      lease_id: sanitized.lease_id,
      assignment_id: sanitized.assignment_id,
      owner_id: sanitized.owner_id,
      lease_holder_id: sanitized.lease_holder_id,
      released_by: sanitized.released_by,
      released_at_ms: sanitized.released_at_ms,
      release_outcome: sanitized.release_outcome,
      reason: sanitized.reason,
    });
    if (sanitized.lease_release_id !== releaseIdFor(lease, fields)) {
      fail('builder_agent_supervision_lease_store_integrity_failed');
    }
    return sanitized;
  } catch (error) {
    if (
      error instanceof BuilderAgentSupervisionLeaseStoreError
      || error instanceof BuilderAgentSupervisionLeaseContractError
    ) fail('builder_agent_supervision_lease_store_integrity_failed');
    throw error;
  }
}

function sameFact(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function leaseColumns() {
  return `lease_id, definition_digest, record_version, assignment_id,
    assignment_status_id, agent_id, owner_id, project_id, conversation_id,
    task_id, run_id, lease_holder_id, lease_epoch, acquired_at_ms,
    expires_at_ms, purpose, redispatch_policy, supervision_state,
    authority_boundary`;
}

function releaseColumns() {
  return `lease_id, lease_release_id, definition_digest, record_version,
    assignment_id, owner_id, lease_holder_id, released_by, released_at_ms,
    release_outcome, reason`;
}

function loadLeaseById(db, leaseId) {
  return leaseFromRow(one(
    db,
    `SELECT ${leaseColumns()} FROM agent_supervision_leases WHERE lease_id = ?`,
    [leaseId],
  ));
}

function loadReleaseForLease(db, lease) {
  return releaseFromRow(one(
    db,
    `SELECT ${releaseColumns()} FROM agent_supervision_lease_releases WHERE lease_id = ?`,
    [lease.lease_id],
  ), lease);
}

function loadReleaseById(db, lease, releaseId) {
  return releaseFromRow(one(
    db,
    `SELECT ${releaseColumns()} FROM agent_supervision_lease_releases WHERE lease_release_id = ?`,
    [releaseId],
  ), lease);
}

function assignmentLeases(db, assignmentId) {
  return all(
    db,
    `SELECT ${leaseColumns()}
      FROM agent_supervision_leases
      WHERE assignment_id = ?
      ORDER BY lease_epoch ASC, acquired_at_ms ASC, lease_id ASC
      LIMIT ?`,
    [assignmentId, MAX_LEASES_PER_ASSIGNMENT + 1],
  ).map(leaseFromRow);
}

function latestLeaseForAssignment(db, assignmentId) {
  return leaseFromRow(one(
    db,
    `SELECT ${leaseColumns()}
      FROM agent_supervision_leases
      WHERE assignment_id = ?
      ORDER BY lease_epoch DESC, acquired_at_ms DESC, lease_id DESC
      LIMIT 1`,
    [assignmentId],
  ));
}

function leaseEntry(db, lease) {
  return freezeDeep({
    lease,
    release: loadReleaseForLease(db, lease),
  });
}

function evidence(db, transaction) {
  return freezeDeep({
    database_id: DATABASE_ID,
    schema_version: BUILDER_AGENT_SUPERVISION_LEASE_STORE_SCHEMA_VERSION,
    user_version: BUILDER_AGENT_SUPERVISION_LEASE_STORE_USER_VERSION,
    schema_fingerprint_digest: sha256Canonical(collectSchemaFingerprint(db)),
    runtime_pragmas: runtimePragmas(db),
    transaction,
    lease_authority: 'main_owned_agent_supervision_lease_store',
    renderer_authority: 'not_present',
    ipc_authority: 'not_present',
    provider_dispatch: false,
    tool_dispatch: false,
    permission_grant_authority: false,
    credential_storage: 'not_present',
    source_access: 'not_present',
    revision_authority: false,
    review_authority: false,
  });
}

function storeResult(db, operation, payload) {
  return freezeDeep({
    result_version: BUILDER_AGENT_SUPERVISION_LEASE_STORE_RESULT_VERSION,
    operation,
    ...payload,
    lease_evidence: evidence(db, operation),
  });
}

function sanitizeLeaseRequest(value) {
  exactObject(value, RECORD_LEASE_KEYS);
  const assignment = valueAt(value, 'assignment');
  const status = valueAt(value, 'status');
  const rawLease = valueAt(value, 'lease');
  try {
    const activeStatus = sanitizeBuilderAgentAssignmentStatusRecord(status, assignment);
    if (activeStatus.next_status !== 'active') fail('builder_agent_supervision_lease_store_invalid');
    return freezeDeep({
      assignment,
      status: activeStatus,
      lease: sanitizeBuilderAgentSupervisionLeaseRecord(rawLease, assignment, activeStatus),
    });
  } catch (error) {
    if (
      error instanceof BuilderAgentAssignmentContractError
      || error instanceof BuilderAgentSupervisionLeaseContractError
    ) fail('builder_agent_supervision_lease_store_invalid');
    throw error;
  }
}

function sanitizeReleaseRequest(db, value) {
  exactObject(value, RECORD_RELEASE_KEYS);
  const rawRelease = valueAt(value, 'release');
  if (!isPlainObject(rawRelease)) fail('builder_agent_supervision_lease_store_invalid');
  const leaseId = safeLeaseId(valueAt(rawRelease, 'lease_id'));
  const lease = loadLeaseById(db, leaseId);
  if (lease === null) fail('builder_agent_supervision_lease_store_not_found');
  try {
    return {
      lease,
      release: sanitizeBuilderAgentSupervisionLeaseReleaseRecord(rawRelease, lease),
    };
  } catch (error) {
    if (error instanceof BuilderAgentSupervisionLeaseContractError) {
      fail('builder_agent_supervision_lease_store_invalid');
    }
    throw error;
  }
}

function assertNoOverlappingLease(db, lease) {
  const leases = assignmentLeases(db, lease.assignment_id);
  if (leases.length > MAX_LEASES_PER_ASSIGNMENT) fail('builder_agent_supervision_lease_store_resource_exceeded');
  for (const existing of leases) {
    if (existing.lease_id === lease.lease_id) continue;
    const release = loadReleaseForLease(db, existing);
    const existingOpenAtAcquire = release === null || release.released_at_ms > lease.acquired_at_ms;
    const existingUnexpiredAtAcquire = existing.expires_at_ms > lease.acquired_at_ms;
    if (existingOpenAtAcquire && existingUnexpiredAtAcquire) {
      fail('builder_agent_supervision_lease_store_conflict');
    }
  }
}

function insertLease(db, lease) {
  run(db, `INSERT INTO agent_supervision_leases (
    lease_id, definition_digest, record_version, assignment_id,
    assignment_status_id, agent_id, owner_id, project_id, conversation_id,
    task_id, run_id, lease_holder_id, lease_epoch, acquired_at_ms,
    expires_at_ms, purpose, redispatch_policy, supervision_state,
    authority_boundary, schema_version
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
    lease.lease_id,
    lease.definition_digest,
    lease.record_version,
    lease.assignment_id,
    lease.assignment_status_id,
    lease.agent_id,
    lease.owner_id,
    lease.project_id,
    lease.conversation_id,
    lease.task_id,
    lease.run_id,
    lease.lease_holder_id,
    lease.lease_epoch,
    lease.acquired_at_ms,
    lease.expires_at_ms,
    lease.purpose,
    lease.redispatch_policy,
    lease.supervision_state,
    lease.authority_boundary,
    BUILDER_AGENT_SUPERVISION_LEASE_STORE_SCHEMA_VERSION,
  ]);
}

function insertRelease(db, release) {
  run(db, `INSERT INTO agent_supervision_lease_releases (
    lease_id, lease_release_id, definition_digest, record_version,
    assignment_id, owner_id, lease_holder_id, released_by, released_at_ms,
    release_outcome, reason, schema_version
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
    release.lease_id,
    release.lease_release_id,
    release.definition_digest,
    release.record_version,
    release.assignment_id,
    release.owner_id,
    release.lease_holder_id,
    release.released_by,
    release.released_at_ms,
    release.release_outcome,
    release.reason,
    BUILDER_AGENT_SUPERVISION_LEASE_STORE_SCHEMA_VERSION,
  ]);
}

function recordLease(db, rawRequest) {
  const { lease } = sanitizeLeaseRequest(rawRequest);
  db.exec('BEGIN IMMEDIATE');
  try {
    const existing = loadLeaseById(db, lease.lease_id);
    if (existing !== null) {
      if (!sameFact(existing, lease)) fail('builder_agent_supervision_lease_store_conflict');
      db.exec('COMMIT');
      return storeResult(db, 'lease_replayed', { lease: existing });
    }
    const latest = latestLeaseForAssignment(db, lease.assignment_id);
    if (latest !== null && lease.lease_epoch <= latest.lease_epoch) {
      fail('builder_agent_supervision_lease_store_conflict');
    }
    assertNoOverlappingLease(db, lease);
    insertLease(db, lease);
    const readback = loadLeaseById(db, lease.lease_id);
    if (readback === null || !sameFact(readback, lease)) {
      fail('builder_agent_supervision_lease_store_integrity_failed');
    }
    db.exec('COMMIT');
    return storeResult(db, 'lease_recorded', { lease: readback });
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* fixed failure below */ }
    throw error;
  }
}

function recordRelease(db, rawRequest) {
  const { lease, release } = sanitizeReleaseRequest(db, rawRequest);
  db.exec('BEGIN IMMEDIATE');
  try {
    const existingForLease = loadReleaseForLease(db, lease);
    if (existingForLease !== null) {
      if (!sameFact(existingForLease, release)) fail('builder_agent_supervision_lease_store_conflict');
      db.exec('COMMIT');
      return storeResult(db, 'release_replayed', { release: existingForLease });
    }
    const existing = loadReleaseById(db, lease, release.lease_release_id);
    if (existing !== null) fail('builder_agent_supervision_lease_store_conflict');
    insertRelease(db, release);
    const readback = loadReleaseForLease(db, lease);
    if (readback === null || !sameFact(readback, release)) {
      fail('builder_agent_supervision_lease_store_integrity_failed');
    }
    db.exec('COMMIT');
    return storeResult(db, 'release_recorded', { release: readback });
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* fixed failure below */ }
    throw error;
  }
}

function readLease(db, rawRequest) {
  exactObject(rawRequest, READ_LEASE_KEYS);
  const leaseId = safeLeaseId(valueAt(rawRequest, 'lease_id'));
  const ownerId = safeOwnerId(valueAt(rawRequest, 'owner_id'));
  const lease = loadLeaseById(db, leaseId);
  if (lease === null || lease.owner_id !== ownerId) {
    return freezeDeep({
      result_version: BUILDER_AGENT_SUPERVISION_LEASE_STORE_READ_RESULT_VERSION,
      lease_authority: 'main_owned_agent_supervision_lease_store',
      status: 'absent',
      lease_id: leaseId,
      owner_id: ownerId,
      lease: null,
      release: null,
      evidence: evidence(db, 'lease_absent_read'),
    });
  }
  return freezeDeep({
    result_version: BUILDER_AGENT_SUPERVISION_LEASE_STORE_READ_RESULT_VERSION,
    lease_authority: 'main_owned_agent_supervision_lease_store',
    status: 'ready',
    lease_id: leaseId,
    owner_id: ownerId,
    lease,
    release: loadReleaseForLease(db, lease),
    evidence: evidence(db, 'lease_ready_read'),
  });
}

function activeLeaseAt(db, leases, nowMs) {
  const active = leases.filter((lease) => {
    const release = loadReleaseForLease(db, lease);
    return release === null && lease.acquired_at_ms <= nowMs && nowMs < lease.expires_at_ms;
  });
  if (active.length > 1) fail('builder_agent_supervision_lease_store_integrity_failed');
  return active.at(0) ?? null;
}

function readAssignmentLeases(db, rawRequest) {
  exactObject(rawRequest, READ_ASSIGNMENT_LEASES_KEYS);
  const assignmentId = safeAssignmentId(valueAt(rawRequest, 'assignment_id'));
  const ownerId = safeOwnerId(valueAt(rawRequest, 'owner_id'));
  const nowMs = safeTimestamp(valueAt(rawRequest, 'now_ms'));
  const leases = assignmentLeases(db, assignmentId);
  if (leases.length > MAX_LEASES_PER_ASSIGNMENT) fail('builder_agent_supervision_lease_store_resource_exceeded');
  const ownerLeases = leases.filter((lease) => lease.owner_id === ownerId);
  if (ownerLeases.length === 0) {
    return freezeDeep({
      result_version: BUILDER_AGENT_SUPERVISION_LEASE_STORE_READ_RESULT_VERSION,
      lease_authority: 'main_owned_agent_supervision_lease_store',
      status: 'absent',
      assignment_id: assignmentId,
      owner_id: ownerId,
      now_ms: nowMs,
      leases: [],
      active_lease: null,
      evidence: evidence(db, 'assignment_leases_absent_read'),
    });
  }
  const active = activeLeaseAt(db, ownerLeases, nowMs);
  return freezeDeep({
    result_version: BUILDER_AGENT_SUPERVISION_LEASE_STORE_READ_RESULT_VERSION,
    lease_authority: 'main_owned_agent_supervision_lease_store',
    status: 'ready',
    assignment_id: assignmentId,
    owner_id: ownerId,
    now_ms: nowMs,
    leases: ownerLeases.map((lease) => leaseEntry(db, lease)),
    active_lease: active === null ? null : leaseEntry(db, active),
    evidence: evidence(db, 'assignment_leases_ready_read'),
  });
}

function ownErrorField(error, key) {
  if (!error || typeof error !== 'object' || utilTypes.isProxy(error)) return null;
  const descriptor = Object.getOwnPropertyDescriptor(error, key);
  return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : null;
}

function normalizeOperationError(error) {
  if (error instanceof BuilderAgentSupervisionLeaseStoreError) {
    return new BuilderAgentSupervisionLeaseStoreError(error.code);
  }
  if (
    error instanceof BuilderAgentSupervisionLeaseContractError
    || error instanceof BuilderAgentAssignmentContractError
  ) {
    return new BuilderAgentSupervisionLeaseStoreError('builder_agent_supervision_lease_store_invalid');
  }
  const sqliteCode = ownErrorField(error, 'code');
  const sqliteErrstr = ownErrorField(error, 'errstr');
  const sqliteErrcode = ownErrorField(error, 'errcode');
  if (sqliteCode && /^SQLITE_CONSTRAINT/u.test(sqliteCode)) {
    return new BuilderAgentSupervisionLeaseStoreError('builder_agent_supervision_lease_store_integrity_failed');
  }
  if (sqliteErrstr === 'constraint failed' || sqliteErrcode === 1555) {
    return new BuilderAgentSupervisionLeaseStoreError('builder_agent_supervision_lease_store_integrity_failed');
  }
  if (sqliteCode && /^SQLITE_(CORRUPT|NOTADB|SCHEMA|INTERNAL|MISMATCH)/u.test(sqliteCode)) {
    return new BuilderAgentSupervisionLeaseStoreError('builder_agent_supervision_lease_store_integrity_failed');
  }
  return new BuilderAgentSupervisionLeaseStoreError('builder_agent_supervision_lease_store_unavailable');
}

function createBuilderAgentSupervisionLeaseStore(databasePath) {
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
    store_version: BUILDER_AGENT_SUPERVISION_LEASE_STORE_VERSION,

    close(...rawArguments) {
      if (rawArguments.length !== 0) {
        throw new BuilderAgentSupervisionLeaseStoreError('builder_agent_supervision_lease_store_invalid');
      }
      try { db.close(); } catch (error) { throw normalizeOperationError(error); }
    },

    record_lease(rawRequest) {
      try { return recordLease(db, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },

    record_release(rawRequest) {
      try { return recordRelease(db, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },

    read_lease(rawRequest) {
      try { return readLease(db, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },

    read_assignment_leases(rawRequest) {
      try { return readAssignmentLeases(db, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },
  });
}

module.exports = Object.freeze({
  BUILDER_AGENT_SUPERVISION_LEASE_STORE_READ_RESULT_VERSION,
  BUILDER_AGENT_SUPERVISION_LEASE_STORE_RESULT_VERSION,
  BUILDER_AGENT_SUPERVISION_LEASE_STORE_SCHEMA_VERSION,
  BUILDER_AGENT_SUPERVISION_LEASE_STORE_USER_VERSION,
  BUILDER_AGENT_SUPERVISION_LEASE_STORE_VERSION,
  BuilderAgentSupervisionLeaseStoreError,
  createBuilderAgentSupervisionLeaseStore,
});
