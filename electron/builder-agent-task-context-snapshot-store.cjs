'use strict';

const nodeCrypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { types: utilTypes } = require('node:util');

const {
  BuilderAgentTaskContextSnapshotError,
  sanitizeBuilderAgentTaskContextSnapshot,
} = require('./builder-agent-task-context-snapshot.cjs');

const BUILDER_AGENT_TASK_CONTEXT_SNAPSHOT_STORE_VERSION =
  'builder-agent-task-context-snapshot-store.v1';
const BUILDER_AGENT_TASK_CONTEXT_SNAPSHOT_STORE_RESULT_VERSION =
  'builder-agent-task-context-snapshot-store-result.v1';
const BUILDER_AGENT_TASK_CONTEXT_SNAPSHOT_STORE_READ_RESULT_VERSION =
  'builder-agent-task-context-snapshot-store-read-result.v1';
const BUILDER_AGENT_TASK_CONTEXT_SNAPSHOT_STORE_SCHEMA_VERSION =
  'builder-agent-task-context-snapshot-store-schema.v1';
const BUILDER_AGENT_TASK_CONTEXT_SNAPSHOT_STORE_USER_VERSION = 1;
const DATABASE_ID = 'builder-agent-task-context-snapshot-store.v1';
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const OWNER_ID_PATTERN = new RegExp(`^builder-user:${UUID_SOURCE}$`, 'u');
const AGENT_ID_PATTERN = new RegExp(`^builder-agent:${UUID_SOURCE}$`, 'u');
const PROJECT_ID_PATTERN = new RegExp(`^builder-project:${UUID_SOURCE}$`, 'u');
const CONVERSATION_ID_PATTERN = new RegExp(`^builder-conversation:${UUID_SOURCE}$`, 'u');
const TASK_ID_PATTERN = new RegExp(`^builder-task:${UUID_SOURCE}$`, 'u');
const RUN_ID_PATTERN = new RegExp(`^builder-run:${UUID_SOURCE}$`, 'u');
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const AGENT_VERSION_ID_PATTERN = /^builder-agent-version:[0-9a-f]{64}$/u;
const ASSIGNMENT_ID_PATTERN = /^builder-agent-assignment:[0-9a-f]{64}$/u;
const ASSIGNMENT_STATUS_ID_PATTERN = /^builder-agent-assignment-status:[0-9a-f]{64}$/u;
const SUPERVISION_LEASE_ID_PATTERN = /^builder-agent-supervision-lease:[0-9a-f]{64}$/u;
const BUDGET_AUDIT_ID_PATTERN = /^builder-agent-budget-audit:[0-9a-f]{64}$/u;
const SNAPSHOT_ID_PATTERN = /^builder-agent-task-context-snapshot:[0-9a-f]{64}$/u;
const RECORD_KEYS = Object.freeze(['snapshot']);
const READ_SNAPSHOT_KEYS = Object.freeze(['snapshot_id', 'owner_id']);
const READ_BY_BUDGET_AUDIT_KEYS = Object.freeze(['budget_audit_id', 'owner_id']);
const LIST_TASK_SNAPSHOTS_KEYS = Object.freeze(['owner_id', 'project_id', 'task_id']);
const LIST_RUN_SNAPSHOTS_KEYS = Object.freeze(['owner_id', 'project_id', 'task_id', 'run_id']);
const MAX_TASK_SNAPSHOTS = 128;
const MAX_RECEIPT_JSON_BYTES = 96 * 1024;
const CREATE_SCHEMA_SQL = Object.freeze([
  `CREATE TABLE agent_task_context_snapshots (
    snapshot_id TEXT NOT NULL PRIMARY KEY,
    context_digest TEXT NOT NULL,
    definition_digest TEXT NOT NULL,
    assignment_id TEXT NOT NULL,
    assignment_status_id TEXT NOT NULL,
    lease_id TEXT NOT NULL,
    budget_audit_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    agent_version_id TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    context_kind TEXT NOT NULL,
    requested_next_action TEXT NOT NULL,
    budget_audit_observed_at_ms INTEGER NOT NULL,
    created_at_ms INTEGER NOT NULL,
    snapshot_json TEXT NOT NULL,
    schema_version TEXT NOT NULL,
    UNIQUE (budget_audit_id),
    CHECK (schema_version = 'builder-agent-task-context-snapshot-store-schema.v1'),
    CHECK (context_kind = 'agent_task_context_snapshot_before_supervised_action'),
    CHECK (length(snapshot_json) BETWEEN 2 AND 98304),
    CHECK (created_at_ms >= 0),
    CHECK (budget_audit_observed_at_ms >= 0),
    CHECK (budget_audit_observed_at_ms <= created_at_ms)
  ) STRICT`,
  'CREATE INDEX agent_task_context_snapshots_task_idx ON agent_task_context_snapshots(owner_id, project_id, task_id, created_at_ms, snapshot_id)',
  'CREATE INDEX agent_task_context_snapshots_run_idx ON agent_task_context_snapshots(owner_id, project_id, task_id, run_id, created_at_ms, snapshot_id)',
  'CREATE INDEX agent_task_context_snapshots_budget_audit_idx ON agent_task_context_snapshots(owner_id, budget_audit_id)',
]);
const ERROR_MESSAGES = Object.freeze({
  builder_agent_task_context_snapshot_store_invalid:
    'Builder agent task context snapshot could not be verified.',
  builder_agent_task_context_snapshot_store_not_found:
    'Builder agent task context snapshot is unavailable.',
  builder_agent_task_context_snapshot_store_conflict:
    'Builder agent task context snapshot changed before it could be recorded.',
  builder_agent_task_context_snapshot_store_integrity_failed:
    'Builder agent task context snapshot integrity could not be verified.',
  builder_agent_task_context_snapshot_store_resource_exceeded:
    'Builder agent task context snapshot limits were reached.',
  builder_agent_task_context_snapshot_store_unavailable:
    'Builder agent task context snapshot storage is unavailable.',
});

class BuilderAgentTaskContextSnapshotStoreError extends Error {
  constructor(code = 'builder_agent_task_context_snapshot_store_invalid') {
    const selected = Object.hasOwn(ERROR_MESSAGES, code)
      ? code
      : 'builder_agent_task_context_snapshot_store_invalid';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderAgentTaskContextSnapshotStoreError';
    this.code = selected;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) {
  throw new BuilderAgentTaskContextSnapshotStoreError(code);
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
  if (!isPlainObject(value)) fail('builder_agent_task_context_snapshot_store_invalid');
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== keys.length
    || actual.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) fail('builder_agent_task_context_snapshot_store_invalid');
  for (const key of actual) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      fail('builder_agent_task_context_snapshot_store_invalid');
    }
  }
}

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
    fail('builder_agent_task_context_snapshot_store_invalid');
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
  fail('builder_agent_task_context_snapshot_store_invalid');
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
    fail('builder_agent_task_context_snapshot_store_invalid');
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

function safeRunId(value) {
  return safePattern(value, RUN_ID_PATTERN);
}

function safeSnapshotId(value) {
  return safePattern(value, SNAPSHOT_ID_PATTERN);
}

function safeBudgetAuditId(value) {
  return safePattern(value, BUDGET_AUDIT_ID_PATTERN);
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
  ) fail('builder_agent_task_context_snapshot_store_invalid');
  return value;
}

function assertParentDirectory(filePath) {
  let info;
  try {
    info = fs.lstatSync(path.dirname(filePath));
  } catch {
    fail('builder_agent_task_context_snapshot_store_unavailable');
  }
  if (!info.isDirectory() || info.isSymbolicLink()) {
    fail('builder_agent_task_context_snapshot_store_unavailable');
  }
}

function safeInteger(value) {
  if (!Number.isSafeInteger(value)) {
    fail('builder_agent_task_context_snapshot_store_integrity_failed');
  }
  return value;
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

function configureRuntime(db) {
  db.exec('PRAGMA trusted_schema = OFF');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA synchronous = FULL');
  const mode = String(one(db, 'PRAGMA journal_mode = WAL')?.journal_mode ?? '').toLowerCase();
  if (mode !== 'wal') fail('builder_agent_task_context_snapshot_store_unavailable');
  const pragmas = runtimePragmas(db);
  if (
    pragmas.foreign_keys !== 'on'
    || pragmas.trusted_schema !== 'off'
    || pragmas.synchronous !== 'full'
    || pragmas.journal_mode !== 'wal'
  ) fail('builder_agent_task_context_snapshot_store_unavailable');
}

function userVersion(db) {
  const row = one(db, 'PRAGMA user_version');
  if (!row || !Number.isSafeInteger(row.user_version)) {
    fail('builder_agent_task_context_snapshot_store_integrity_failed');
  }
  return row.user_version;
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function createSchema(db) {
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const sql of CREATE_SCHEMA_SQL) db.exec(sql);
    db.exec(`PRAGMA user_version = ${BUILDER_AGENT_TASK_CONTEXT_SNAPSHOT_STORE_USER_VERSION}`);
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
    expectedDb.exec(`PRAGMA user_version = ${BUILDER_AGENT_TASK_CONTEXT_SNAPSHOT_STORE_USER_VERSION}`);
    expectedSchemaFingerprint = canonicalJson(collectSchemaFingerprint(expectedDb));
    return expectedSchemaFingerprint;
  } finally {
    expectedDb.close();
  }
}

function validateSchema(db) {
  const actual = collectSchemaFingerprint(db);
  if (actual.foreign_key_check.length !== 0) {
    fail('builder_agent_task_context_snapshot_store_integrity_failed');
  }
  if (canonicalJson(actual) !== expectedFingerprint()) {
    fail('builder_agent_task_context_snapshot_store_integrity_failed');
  }
}

function initialize(db) {
  configureRuntime(db);
  const version = userVersion(db);
  if (version === 0) createSchema(db);
  else if (version !== BUILDER_AGENT_TASK_CONTEXT_SNAPSHOT_STORE_USER_VERSION) {
    fail('builder_agent_task_context_snapshot_store_integrity_failed');
  }
  validateSchema(db);
}

function canonicalReceipt(value) {
  const text = canonicalJson(value);
  if (text.length < 2 || text.length > MAX_RECEIPT_JSON_BYTES) {
    fail('builder_agent_task_context_snapshot_store_resource_exceeded');
  }
  return text;
}

function parseCanonicalSnapshot(value, code) {
  if (
    typeof value !== 'string'
    || value.length < 2
    || value.length > MAX_RECEIPT_JSON_BYTES
    || hasControlCharacter(value)
  ) fail(code);
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    fail(code);
  }
  if (!isPlainObject(parsed)) fail(code);
  try {
    if (canonicalJson(parsed) !== value) fail(code);
    return sanitizeBuilderAgentTaskContextSnapshot(parsed);
  } catch (error) {
    if (
      error instanceof BuilderAgentTaskContextSnapshotStoreError
      || error instanceof BuilderAgentTaskContextSnapshotError
    ) fail(code);
    throw error;
  }
}

function sanitizeSnapshotRequest(value) {
  exactObject(value, RECORD_KEYS);
  try {
    return sanitizeBuilderAgentTaskContextSnapshot(valueAt(value, 'snapshot'));
  } catch (error) {
    if (error instanceof BuilderAgentTaskContextSnapshotError) {
      fail('builder_agent_task_context_snapshot_store_invalid');
    }
    throw error;
  }
}

function snapshotColumns() {
  return `snapshot_id, context_digest, definition_digest, assignment_id,
    assignment_status_id, lease_id, budget_audit_id, agent_id,
    agent_version_id, owner_id, project_id, conversation_id, task_id, run_id,
    context_kind, requested_next_action, budget_audit_observed_at_ms,
    created_at_ms, snapshot_json`;
}

function safeRowFacts(row) {
  return freezeDeep({
    snapshot_id: safePattern(row.snapshot_id, SNAPSHOT_ID_PATTERN),
    context_digest: safePattern(row.context_digest, DIGEST_PATTERN),
    definition_digest: safePattern(row.definition_digest, DIGEST_PATTERN),
    assignment_id: safePattern(row.assignment_id, ASSIGNMENT_ID_PATTERN),
    assignment_status_id: safePattern(row.assignment_status_id, ASSIGNMENT_STATUS_ID_PATTERN),
    lease_id: safePattern(row.lease_id, SUPERVISION_LEASE_ID_PATTERN),
    budget_audit_id: safePattern(row.budget_audit_id, BUDGET_AUDIT_ID_PATTERN),
    agent_id: safePattern(row.agent_id, AGENT_ID_PATTERN),
    agent_version_id: safePattern(row.agent_version_id, AGENT_VERSION_ID_PATTERN),
    owner_id: safePattern(row.owner_id, OWNER_ID_PATTERN),
    project_id: safePattern(row.project_id, PROJECT_ID_PATTERN),
    conversation_id: safePattern(row.conversation_id, CONVERSATION_ID_PATTERN),
    task_id: safePattern(row.task_id, TASK_ID_PATTERN),
    run_id: safePattern(row.run_id, RUN_ID_PATTERN),
    context_kind: String(row.context_kind),
    requested_next_action: String(row.requested_next_action),
    budget_audit_observed_at_ms: safeInteger(row.budget_audit_observed_at_ms),
    created_at_ms: safeInteger(row.created_at_ms),
  });
}

function entryFromRow(row) {
  if (!row) return null;
  const snapshot = parseCanonicalSnapshot(
    row.snapshot_json,
    'builder_agent_task_context_snapshot_store_integrity_failed',
  );
  const facts = safeRowFacts(row);
  if (
    facts.snapshot_id !== snapshot.snapshot_id
    || facts.context_digest !== snapshot.context_digest
    || facts.definition_digest !== snapshot.definition_digest
    || facts.assignment_id !== snapshot.assignment_id
    || facts.assignment_status_id !== snapshot.assignment_status_id
    || facts.lease_id !== snapshot.lease_id
    || facts.budget_audit_id !== snapshot.budget_audit_id
    || facts.agent_id !== snapshot.agent_id
    || facts.agent_version_id !== snapshot.agent_version_id
    || facts.owner_id !== snapshot.owner_id
    || facts.project_id !== snapshot.project_id
    || facts.conversation_id !== snapshot.conversation_id
    || facts.task_id !== snapshot.task_id
    || facts.run_id !== snapshot.run_id
    || facts.context_kind !== snapshot.context_kind
    || facts.requested_next_action !== snapshot.action_admission.requested_next_action
    || facts.budget_audit_observed_at_ms !== snapshot.action_admission.budget_audit_observed_at_ms
    || facts.created_at_ms !== snapshot.created_at_ms
  ) fail('builder_agent_task_context_snapshot_store_integrity_failed');
  return freezeDeep({ snapshot });
}

function loadBySnapshotId(db, snapshotId) {
  const row = one(
    db,
    `SELECT ${snapshotColumns()} FROM agent_task_context_snapshots WHERE snapshot_id = ?`,
    [snapshotId],
  );
  return row === null ? null : entryFromRow(row);
}

function loadByBudgetAuditId(db, budgetAuditId) {
  const row = one(
    db,
    `SELECT ${snapshotColumns()} FROM agent_task_context_snapshots WHERE budget_audit_id = ?`,
    [budgetAuditId],
  );
  return row === null ? null : entryFromRow(row);
}

function taskEntries(db, ownerId, projectId, taskId) {
  return freezeDeep(all(
    db,
    `SELECT ${snapshotColumns()}
      FROM agent_task_context_snapshots
      WHERE owner_id = ? AND project_id = ? AND task_id = ?
      ORDER BY created_at_ms ASC, snapshot_id ASC
      LIMIT ?`,
    [ownerId, projectId, taskId, MAX_TASK_SNAPSHOTS],
  ).map(entryFromRow));
}

function runEntries(db, ownerId, projectId, taskId, runId) {
  return freezeDeep(all(
    db,
    `SELECT ${snapshotColumns()}
      FROM agent_task_context_snapshots
      WHERE owner_id = ? AND project_id = ? AND task_id = ? AND run_id = ?
      ORDER BY created_at_ms ASC, snapshot_id ASC
      LIMIT ?`,
    [ownerId, projectId, taskId, runId, MAX_TASK_SNAPSHOTS],
  ).map(entryFromRow));
}

function evidence(db, transaction) {
  return freezeDeep({
    database_id: DATABASE_ID,
    schema_version: BUILDER_AGENT_TASK_CONTEXT_SNAPSHOT_STORE_SCHEMA_VERSION,
    user_version: BUILDER_AGENT_TASK_CONTEXT_SNAPSHOT_STORE_USER_VERSION,
    schema_fingerprint_digest: `sha256:${sha256Canonical(collectSchemaFingerprint(db))}`,
    runtime_pragmas: runtimePragmas(db),
    transaction,
    snapshot_authority: 'main_owned_agent_task_context_snapshot_store',
    context_snapshot_contract_authority: 'main_agent_task_context_snapshot_contract_v1',
    renderer_authority: 'not_present',
    ipc_authority: 'not_present',
    provider_dispatch: false,
    model_dispatch: false,
    tool_dispatch: false,
    permission_grant_authority: false,
    credential_storage: 'not_present',
    source_access: 'not_present',
    source_write: 'not_present',
    process_run: false,
    network_access: false,
    revision_authority: false,
    review_authority: false,
    artifact_authority: false,
    raw_context_storage: false,
    recovery_model: 'idempotent_store_replay',
  });
}

function recordResult(db, operation, payload) {
  return freezeDeep({
    result_version: BUILDER_AGENT_TASK_CONTEXT_SNAPSHOT_STORE_RESULT_VERSION,
    operation,
    ...payload,
    snapshot_evidence: evidence(db, operation),
  });
}

function readResult(db, transaction, payload) {
  return freezeDeep({
    result_version: BUILDER_AGENT_TASK_CONTEXT_SNAPSHOT_STORE_READ_RESULT_VERSION,
    snapshot_authority: 'main_owned_agent_task_context_snapshot_store',
    ...payload,
    evidence: evidence(db, transaction),
  });
}

function insertSnapshot(db, snapshot) {
  const text = canonicalReceipt(snapshot);
  run(db, `INSERT INTO agent_task_context_snapshots (
    snapshot_id, context_digest, definition_digest, assignment_id,
    assignment_status_id, lease_id, budget_audit_id, agent_id,
    agent_version_id, owner_id, project_id, conversation_id, task_id, run_id,
    context_kind, requested_next_action, budget_audit_observed_at_ms,
    created_at_ms, snapshot_json, schema_version
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
    snapshot.snapshot_id,
    snapshot.context_digest,
    snapshot.definition_digest,
    snapshot.assignment_id,
    snapshot.assignment_status_id,
    snapshot.lease_id,
    snapshot.budget_audit_id,
    snapshot.agent_id,
    snapshot.agent_version_id,
    snapshot.owner_id,
    snapshot.project_id,
    snapshot.conversation_id,
    snapshot.task_id,
    snapshot.run_id,
    snapshot.context_kind,
    snapshot.action_admission.requested_next_action,
    snapshot.action_admission.budget_audit_observed_at_ms,
    snapshot.created_at_ms,
    text,
    BUILDER_AGENT_TASK_CONTEXT_SNAPSHOT_STORE_SCHEMA_VERSION,
  ]);
}

function sameSnapshot(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function createBuilderAgentTaskContextSnapshotStore(databasePath) {
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
    if (db) {
      try { db.close(); } catch { /* fixed failure below */ }
    }
    if (error instanceof BuilderAgentTaskContextSnapshotStoreError) throw error;
    fail('builder_agent_task_context_snapshot_store_unavailable');
  }
  function recordSnapshot(rawRequest) {
    try {
      const snapshot = sanitizeSnapshotRequest(rawRequest);
      db.exec('BEGIN IMMEDIATE');
      try {
        const existing = loadBySnapshotId(db, snapshot.snapshot_id);
        const existingByBudgetAudit = loadByBudgetAuditId(db, snapshot.budget_audit_id);
        if (existing || existingByBudgetAudit) {
          const candidate = existing ?? existingByBudgetAudit;
          if (!sameSnapshot(candidate.snapshot, snapshot)) {
            fail('builder_agent_task_context_snapshot_store_conflict');
          }
          db.exec('COMMIT');
          return recordResult(db, 'agent_task_context_snapshot_replayed', {
            agent_task_context_snapshot: candidate,
          });
        }
        insertSnapshot(db, snapshot);
        const inserted = loadBySnapshotId(db, snapshot.snapshot_id);
        if (!inserted || !sameSnapshot(inserted.snapshot, snapshot)) {
          fail('builder_agent_task_context_snapshot_store_integrity_failed');
        }
        db.exec('COMMIT');
        return recordResult(db, 'agent_task_context_snapshot_recorded', {
          agent_task_context_snapshot: inserted,
        });
      } catch (error) {
        try { db.exec('ROLLBACK'); } catch { /* fixed failure below */ }
        throw error;
      }
    } catch (error) {
      if (error instanceof BuilderAgentTaskContextSnapshotStoreError) throw error;
      fail('builder_agent_task_context_snapshot_store_unavailable');
    }
  }
  function readSnapshot(rawRequest) {
    exactObject(rawRequest, READ_SNAPSHOT_KEYS);
    const snapshotId = safeSnapshotId(valueAt(rawRequest, 'snapshot_id'));
    const ownerId = safeOwnerId(valueAt(rawRequest, 'owner_id'));
    const entry = loadBySnapshotId(db, snapshotId);
    if (!entry || entry.snapshot.owner_id !== ownerId) {
      return readResult(db, 'agent_task_context_snapshot_read', {
        status: 'absent',
        agent_task_context_snapshot: null,
      });
    }
    return readResult(db, 'agent_task_context_snapshot_read', {
      status: 'ready',
      agent_task_context_snapshot: entry,
    });
  }
  function readSnapshotForBudgetAudit(rawRequest) {
    exactObject(rawRequest, READ_BY_BUDGET_AUDIT_KEYS);
    const budgetAuditId = safeBudgetAuditId(valueAt(rawRequest, 'budget_audit_id'));
    const ownerId = safeOwnerId(valueAt(rawRequest, 'owner_id'));
    const entry = loadByBudgetAuditId(db, budgetAuditId);
    if (!entry || entry.snapshot.owner_id !== ownerId) {
      return readResult(db, 'agent_task_context_snapshot_budget_audit_read', {
        status: 'absent',
        agent_task_context_snapshot: null,
      });
    }
    return readResult(db, 'agent_task_context_snapshot_budget_audit_read', {
      status: 'ready',
      agent_task_context_snapshot: entry,
    });
  }
  function listTaskSnapshots(rawRequest) {
    exactObject(rawRequest, LIST_TASK_SNAPSHOTS_KEYS);
    const ownerId = safeOwnerId(valueAt(rawRequest, 'owner_id'));
    const projectId = safeProjectId(valueAt(rawRequest, 'project_id'));
    const taskId = safeTaskId(valueAt(rawRequest, 'task_id'));
    const entries = taskEntries(db, ownerId, projectId, taskId);
    return readResult(db, 'agent_task_context_snapshot_task_list', {
      status: entries.length === 0 ? 'absent' : 'ready',
      agent_task_context_snapshots: entries,
      truncated: entries.length >= MAX_TASK_SNAPSHOTS,
    });
  }
  function listRunSnapshots(rawRequest) {
    exactObject(rawRequest, LIST_RUN_SNAPSHOTS_KEYS);
    const ownerId = safeOwnerId(valueAt(rawRequest, 'owner_id'));
    const projectId = safeProjectId(valueAt(rawRequest, 'project_id'));
    const taskId = safeTaskId(valueAt(rawRequest, 'task_id'));
    const runId = safeRunId(valueAt(rawRequest, 'run_id'));
    const entries = runEntries(db, ownerId, projectId, taskId, runId);
    return readResult(db, 'agent_task_context_snapshot_run_list', {
      status: entries.length === 0 ? 'absent' : 'ready',
      agent_task_context_snapshots: entries,
      truncated: entries.length >= MAX_TASK_SNAPSHOTS,
    });
  }
  function close() {
    db.close();
  }
  return freezeDeep({
    store_version: BUILDER_AGENT_TASK_CONTEXT_SNAPSHOT_STORE_VERSION,
    record_snapshot: recordSnapshot,
    read_snapshot: readSnapshot,
    read_snapshot_for_budget_audit: readSnapshotForBudgetAudit,
    list_task_snapshots: listTaskSnapshots,
    list_run_snapshots: listRunSnapshots,
    close,
  });
}

module.exports = Object.freeze({
  BUILDER_AGENT_TASK_CONTEXT_SNAPSHOT_STORE_READ_RESULT_VERSION,
  BUILDER_AGENT_TASK_CONTEXT_SNAPSHOT_STORE_RESULT_VERSION,
  BUILDER_AGENT_TASK_CONTEXT_SNAPSHOT_STORE_SCHEMA_VERSION,
  BUILDER_AGENT_TASK_CONTEXT_SNAPSHOT_STORE_USER_VERSION,
  BUILDER_AGENT_TASK_CONTEXT_SNAPSHOT_STORE_VERSION,
  BuilderAgentTaskContextSnapshotStoreError,
  createBuilderAgentTaskContextSnapshotStore,
});
