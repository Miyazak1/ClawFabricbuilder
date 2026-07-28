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
  BuilderAgentSupervisionLeaseContractError,
  sanitizeBuilderAgentSupervisionLeaseRecord,
} = require('./builder-agent-supervision-lease-contract.cjs');
const {
  BUILDER_AGENT_BUDGET_AUDIT_RECORD_VERSION,
  BuilderAgentBudgetAuditContractError,
  sanitizeBuilderAgentBudgetAuditRecord,
} = require('./builder-agent-budget-audit-contract.cjs');

const BUILDER_AGENT_BUDGET_AUDIT_STORE_VERSION = 'builder-agent-budget-audit-store.v1';
const BUILDER_AGENT_BUDGET_AUDIT_STORE_RESULT_VERSION = 'builder-agent-budget-audit-store-result.v1';
const BUILDER_AGENT_BUDGET_AUDIT_STORE_READ_RESULT_VERSION = 'builder-agent-budget-audit-store-read-result.v1';
const BUILDER_AGENT_BUDGET_AUDIT_STORE_SCHEMA_VERSION = 'builder-agent-budget-audit-store-schema.v1';
const BUILDER_AGENT_BUDGET_AUDIT_STORE_USER_VERSION = 1;
const DATABASE_ID = 'builder-agent-budget-audit-store.v1';
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
const BUDGET_AUDIT_ID_PATTERN = /^builder-agent-budget-audit:[0-9a-f]{64}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const RECORD_AUDIT_KEYS = Object.freeze(['assignment', 'status', 'lease', 'audit']);
const READ_AUDIT_KEYS = Object.freeze(['budget_audit_id', 'owner_id']);
const LIST_TASK_AUDITS_KEYS = Object.freeze(['owner_id', 'project_id', 'task_id']);
const LIST_LEASE_AUDITS_KEYS = Object.freeze(['lease_id', 'owner_id']);
const MAX_TASK_AUDITS = 256;
const MAX_LEASE_AUDITS = 256;
const MAX_RECEIPT_JSON_BYTES = 64 * 1024;
const CREATE_SCHEMA_SQL = Object.freeze([
  `CREATE TABLE agent_budget_audits (
    budget_audit_id TEXT NOT NULL PRIMARY KEY,
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
    observed_at_ms INTEGER NOT NULL,
    requested_next_action TEXT NOT NULL,
    decision TEXT NOT NULL,
    reason TEXT NOT NULL,
    step_count INTEGER NOT NULL,
    tool_call_count INTEGER NOT NULL,
    runtime_ms INTEGER NOT NULL,
    private_source_bytes INTEGER NOT NULL,
    max_steps INTEGER NOT NULL,
    max_tool_calls INTEGER NOT NULL,
    max_runtime_ms INTEGER NOT NULL,
    max_private_source_bytes INTEGER NOT NULL,
    assignment_json TEXT NOT NULL,
    status_json TEXT NOT NULL,
    lease_json TEXT NOT NULL,
    audit_json TEXT NOT NULL,
    schema_version TEXT NOT NULL,
    CHECK (schema_version = 'builder-agent-budget-audit-store-schema.v1'),
    CHECK (record_version = 'builder-agent-budget-audit-record.v1'),
    CHECK (requested_next_action IN ('start_step', 'call_tool', 'read_private_source', 'finish_for_review')),
    CHECK (decision IN ('allowed', 'denied')),
    CHECK (reason IN ('none', 'max_steps_reached', 'max_tool_calls_reached', 'max_runtime_reached', 'private_source_budget_reached')),
    CHECK (observed_at_ms >= 0),
    CHECK (step_count BETWEEN 0 AND max_steps),
    CHECK (tool_call_count BETWEEN 0 AND max_tool_calls),
    CHECK (runtime_ms BETWEEN 0 AND max_runtime_ms),
    CHECK (private_source_bytes BETWEEN 0 AND max_private_source_bytes),
    CHECK (max_steps BETWEEN 1 AND 256),
    CHECK (max_tool_calls BETWEEN 0 AND 256),
    CHECK (max_runtime_ms BETWEEN 1000 AND 86400000),
    CHECK (max_private_source_bytes BETWEEN 0 AND 4194304),
    CHECK (length(assignment_json) BETWEEN 2 AND 65536),
    CHECK (length(status_json) BETWEEN 2 AND 65536),
    CHECK (length(lease_json) BETWEEN 2 AND 65536),
    CHECK (length(audit_json) BETWEEN 2 AND 65536)
  ) STRICT`,
  'CREATE INDEX agent_budget_audits_owner_task_idx ON agent_budget_audits(owner_id, project_id, task_id, observed_at_ms, budget_audit_id)',
  'CREATE INDEX agent_budget_audits_lease_idx ON agent_budget_audits(owner_id, lease_id, observed_at_ms, budget_audit_id)',
  'CREATE INDEX agent_budget_audits_assignment_idx ON agent_budget_audits(owner_id, assignment_id, observed_at_ms, budget_audit_id)',
]);
const ERROR_MESSAGES = Object.freeze({
  builder_agent_budget_audit_store_invalid: 'Builder agent budget audits could not be verified.',
  builder_agent_budget_audit_store_not_found: 'Builder agent budget audit is unavailable.',
  builder_agent_budget_audit_store_conflict: 'Builder agent budget audits changed before they could be recorded.',
  builder_agent_budget_audit_store_integrity_failed: 'Builder agent budget audit integrity could not be verified.',
  builder_agent_budget_audit_store_resource_exceeded: 'Builder agent budget audit limits were reached.',
  builder_agent_budget_audit_store_unavailable: 'Builder agent budget audit storage is unavailable.',
});

class BuilderAgentBudgetAuditStoreError extends Error {
  constructor(code = 'builder_agent_budget_audit_store_invalid') {
    const selected = Object.hasOwn(ERROR_MESSAGES, code)
      ? code
      : 'builder_agent_budget_audit_store_invalid';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderAgentBudgetAuditStoreError';
    this.code = selected;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) {
  throw new BuilderAgentBudgetAuditStoreError(code);
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
  if (!isPlainObject(value)) fail('builder_agent_budget_audit_store_invalid');
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== keys.length
    || actual.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) fail('builder_agent_budget_audit_store_invalid');
  for (const key of actual) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      fail('builder_agent_budget_audit_store_invalid');
    }
  }
}

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
    fail('builder_agent_budget_audit_store_invalid');
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
  fail('builder_agent_budget_audit_store_invalid');
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
    fail('builder_agent_budget_audit_store_invalid');
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

function safeBudgetAuditId(value) {
  return safePattern(value, BUDGET_AUDIT_ID_PATTERN);
}

function safeLeaseId(value) {
  return safePattern(value, LEASE_ID_PATTERN);
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
  ) fail('builder_agent_budget_audit_store_invalid');
  return value;
}

function assertParentDirectory(filePath) {
  let info;
  try {
    info = fs.lstatSync(path.dirname(filePath));
  } catch {
    fail('builder_agent_budget_audit_store_unavailable');
  }
  if (!info.isDirectory() || info.isSymbolicLink()) {
    fail('builder_agent_budget_audit_store_unavailable');
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
    fail('builder_agent_budget_audit_store_integrity_failed');
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
  if (mode !== 'wal') fail('builder_agent_budget_audit_store_unavailable');
  const pragmas = runtimePragmas(db);
  if (
    pragmas.foreign_keys !== 'on'
    || pragmas.trusted_schema !== 'off'
    || pragmas.synchronous !== 'full'
    || pragmas.journal_mode !== 'wal'
  ) fail('builder_agent_budget_audit_store_unavailable');
}

function createSchema(db) {
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const sql of CREATE_SCHEMA_SQL) db.exec(sql);
    db.exec(`PRAGMA user_version = ${BUILDER_AGENT_BUDGET_AUDIT_STORE_USER_VERSION}`);
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
    expectedDb.exec(`PRAGMA user_version = ${BUILDER_AGENT_BUDGET_AUDIT_STORE_USER_VERSION}`);
    expectedSchemaFingerprint = canonicalJson(collectSchemaFingerprint(expectedDb));
    return expectedSchemaFingerprint;
  } finally {
    expectedDb.close();
  }
}

function validateSchema(db) {
  const actual = collectSchemaFingerprint(db);
  if (actual.foreign_key_check.length !== 0) fail('builder_agent_budget_audit_store_integrity_failed');
  if (canonicalJson(actual) !== expectedFingerprint()) {
    fail('builder_agent_budget_audit_store_integrity_failed');
  }
}

function initialize(db) {
  configurePragmas(db);
  const version = userVersion(db);
  if (version === 0) createSchema(db);
  else if (version !== BUILDER_AGENT_BUDGET_AUDIT_STORE_USER_VERSION) {
    fail('builder_agent_budget_audit_store_integrity_failed');
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
    if (error instanceof BuilderAgentBudgetAuditStoreError) fail(code);
    throw error;
  }
  return parsed;
}

function sanitizeAuditRequest(value) {
  exactObject(value, RECORD_AUDIT_KEYS);
  const assignment = valueAt(value, 'assignment');
  const status = valueAt(value, 'status');
  const lease = valueAt(value, 'lease');
  const audit = valueAt(value, 'audit');
  try {
    const activeStatus = sanitizeBuilderAgentAssignmentStatusRecord(status, assignment);
    if (activeStatus.next_status !== 'active') fail('builder_agent_budget_audit_store_invalid');
    const activeLease = sanitizeBuilderAgentSupervisionLeaseRecord(lease, assignment, activeStatus);
    return freezeDeep({
      assignment,
      status: activeStatus,
      lease: activeLease,
      audit: sanitizeBuilderAgentBudgetAuditRecord(audit, assignment, activeStatus, activeLease),
    });
  } catch (error) {
    if (
      error instanceof BuilderAgentAssignmentContractError
      || error instanceof BuilderAgentSupervisionLeaseContractError
      || error instanceof BuilderAgentBudgetAuditContractError
    ) fail('builder_agent_budget_audit_store_invalid');
    throw error;
  }
}

function auditColumns() {
  return `budget_audit_id, definition_digest, record_version, assignment_id,
    assignment_status_id, lease_id, agent_id, agent_version_id, owner_id,
    project_id, conversation_id, task_id, run_id, lease_holder_id,
    observed_at_ms, requested_next_action, decision, reason, step_count,
    tool_call_count, runtime_ms, private_source_bytes, max_steps,
    max_tool_calls, max_runtime_ms, max_private_source_bytes, assignment_json,
    status_json, lease_json, audit_json`;
}

function entryFromRow(row) {
  if (!row) return null;
  try {
    const assignment = parseCanonicalReceipt(row.assignment_json, 'builder_agent_budget_audit_store_integrity_failed');
    const status = parseCanonicalReceipt(row.status_json, 'builder_agent_budget_audit_store_integrity_failed');
    const lease = parseCanonicalReceipt(row.lease_json, 'builder_agent_budget_audit_store_integrity_failed');
    const parsedAudit = parseCanonicalReceipt(row.audit_json, 'builder_agent_budget_audit_store_integrity_failed');
    const audit = sanitizeBuilderAgentBudgetAuditRecord(parsedAudit, assignment, status, lease);
    if (
      safePattern(row.budget_audit_id, BUDGET_AUDIT_ID_PATTERN) !== audit.budget_audit_id
      || safePattern(row.definition_digest, DIGEST_PATTERN) !== audit.definition_digest
      || row.record_version !== BUILDER_AGENT_BUDGET_AUDIT_RECORD_VERSION
      || row.record_version !== audit.record_version
      || safePattern(row.assignment_id, ASSIGNMENT_ID_PATTERN) !== audit.assignment_id
      || safePattern(row.assignment_status_id, ASSIGNMENT_STATUS_ID_PATTERN) !== audit.assignment_status_id
      || safePattern(row.lease_id, LEASE_ID_PATTERN) !== audit.lease_id
      || safePattern(row.agent_id, AGENT_ID_PATTERN) !== audit.agent_id
      || safePattern(row.agent_version_id, AGENT_VERSION_ID_PATTERN) !== audit.agent_version_id
      || safePattern(row.owner_id, OWNER_ID_PATTERN) !== audit.owner_id
      || safePattern(row.project_id, PROJECT_ID_PATTERN) !== audit.project_id
      || safePattern(row.conversation_id, CONVERSATION_ID_PATTERN) !== audit.conversation_id
      || safePattern(row.task_id, TASK_ID_PATTERN) !== audit.task_id
      || safePattern(row.run_id, RUN_ID_PATTERN) !== audit.run_id
      || safePattern(row.lease_holder_id, SUPERVISOR_ID_PATTERN) !== audit.lease_holder_id
      || row.observed_at_ms !== audit.observed_at_ms
      || row.requested_next_action !== audit.requested_next_action
      || row.decision !== audit.outcome.decision
      || row.reason !== audit.outcome.reason
      || row.step_count !== audit.budget_usage.step_count
      || row.tool_call_count !== audit.budget_usage.tool_call_count
      || row.runtime_ms !== audit.budget_usage.runtime_ms
      || row.private_source_bytes !== audit.budget_usage.private_source_bytes
      || row.max_steps !== audit.budget_limits.max_steps
      || row.max_tool_calls !== audit.budget_limits.max_tool_calls
      || row.max_runtime_ms !== audit.budget_limits.max_runtime_ms
      || row.max_private_source_bytes !== audit.budget_limits.max_private_source_bytes
    ) fail('builder_agent_budget_audit_store_integrity_failed');
    return freezeDeep({ assignment, status, lease, audit });
  } catch (error) {
    if (
      error instanceof BuilderAgentBudgetAuditStoreError
      || error instanceof BuilderAgentAssignmentContractError
      || error instanceof BuilderAgentSupervisionLeaseContractError
      || error instanceof BuilderAgentBudgetAuditContractError
    ) fail('builder_agent_budget_audit_store_integrity_failed');
    throw error;
  }
}

function loadEntryByAuditId(db, budgetAuditId) {
  return entryFromRow(one(
    db,
    `SELECT ${auditColumns()} FROM agent_budget_audits WHERE budget_audit_id = ?`,
    [budgetAuditId],
  ));
}

function taskEntries(db, ownerId, projectId, taskId) {
  const rows = all(
    db,
    `SELECT ${auditColumns()}
      FROM agent_budget_audits
      WHERE owner_id = ? AND project_id = ? AND task_id = ?
      ORDER BY observed_at_ms ASC, budget_audit_id ASC
      LIMIT ?`,
    [ownerId, projectId, taskId, MAX_TASK_AUDITS + 1],
  );
  if (rows.length > MAX_TASK_AUDITS) fail('builder_agent_budget_audit_store_resource_exceeded');
  return freezeDeep(rows.map(entryFromRow));
}

function leaseEntries(db, ownerId, leaseId) {
  const rows = all(
    db,
    `SELECT ${auditColumns()}
      FROM agent_budget_audits
      WHERE owner_id = ? AND lease_id = ?
      ORDER BY observed_at_ms ASC, budget_audit_id ASC
      LIMIT ?`,
    [ownerId, leaseId, MAX_LEASE_AUDITS + 1],
  );
  if (rows.length > MAX_LEASE_AUDITS) fail('builder_agent_budget_audit_store_resource_exceeded');
  return freezeDeep(rows.map(entryFromRow));
}

function sameFact(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function sameEntry(left, right) {
  return sameFact(left.assignment, right.assignment)
    && sameFact(left.status, right.status)
    && sameFact(left.lease, right.lease)
    && sameFact(left.audit, right.audit);
}

function evidence(db, transaction) {
  return freezeDeep({
    database_id: DATABASE_ID,
    schema_version: BUILDER_AGENT_BUDGET_AUDIT_STORE_SCHEMA_VERSION,
    user_version: BUILDER_AGENT_BUDGET_AUDIT_STORE_USER_VERSION,
    schema_fingerprint_digest: sha256Canonical(collectSchemaFingerprint(db)),
    runtime_pragmas: runtimePragmas(db),
    transaction,
    budget_audit_authority: 'main_owned_agent_budget_audit_store',
    renderer_authority: 'not_present',
    ipc_authority: 'not_present',
    model_dispatch: false,
    tool_dispatch: false,
    permission_grant_authority: false,
    credential_storage: 'not_present',
    source_read: 'not_present',
    source_write: 'not_present',
    process_run: false,
    revision_authority: false,
    review_authority: false,
  });
}

function storeResult(db, operation, payload) {
  return freezeDeep({
    result_version: BUILDER_AGENT_BUDGET_AUDIT_STORE_RESULT_VERSION,
    operation,
    ...payload,
    budget_audit_evidence: evidence(db, operation),
  });
}

function insertAudit(db, entry) {
  const audit = entry.audit;
  run(db, `INSERT INTO agent_budget_audits (
    budget_audit_id, definition_digest, record_version, assignment_id,
    assignment_status_id, lease_id, agent_id, agent_version_id, owner_id,
    project_id, conversation_id, task_id, run_id, lease_holder_id,
    observed_at_ms, requested_next_action, decision, reason, step_count,
    tool_call_count, runtime_ms, private_source_bytes, max_steps,
    max_tool_calls, max_runtime_ms, max_private_source_bytes, assignment_json,
    status_json, lease_json, audit_json, schema_version
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
    audit.budget_audit_id,
    audit.definition_digest,
    audit.record_version,
    audit.assignment_id,
    audit.assignment_status_id,
    audit.lease_id,
    audit.agent_id,
    audit.agent_version_id,
    audit.owner_id,
    audit.project_id,
    audit.conversation_id,
    audit.task_id,
    audit.run_id,
    audit.lease_holder_id,
    audit.observed_at_ms,
    audit.requested_next_action,
    audit.outcome.decision,
    audit.outcome.reason,
    audit.budget_usage.step_count,
    audit.budget_usage.tool_call_count,
    audit.budget_usage.runtime_ms,
    audit.budget_usage.private_source_bytes,
    audit.budget_limits.max_steps,
    audit.budget_limits.max_tool_calls,
    audit.budget_limits.max_runtime_ms,
    audit.budget_limits.max_private_source_bytes,
    canonicalJson(entry.assignment),
    canonicalJson(entry.status),
    canonicalJson(entry.lease),
    canonicalJson(audit),
    BUILDER_AGENT_BUDGET_AUDIT_STORE_SCHEMA_VERSION,
  ]);
}

function recordAudit(db, rawRequest) {
  const requested = sanitizeAuditRequest(rawRequest);
  db.exec('BEGIN IMMEDIATE');
  try {
    const existing = loadEntryByAuditId(db, requested.audit.budget_audit_id);
    if (existing !== null) {
      if (!sameEntry(existing, requested)) fail('builder_agent_budget_audit_store_conflict');
      db.exec('COMMIT');
      return storeResult(db, 'budget_audit_replayed', { budget_audit: existing });
    }
    insertAudit(db, requested);
    const readback = loadEntryByAuditId(db, requested.audit.budget_audit_id);
    if (readback === null || !sameEntry(readback, requested)) {
      fail('builder_agent_budget_audit_store_integrity_failed');
    }
    db.exec('COMMIT');
    return storeResult(db, 'budget_audit_recorded', { budget_audit: readback });
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* fixed failure below */ }
    throw error;
  }
}

function readAudit(db, rawRequest) {
  exactObject(rawRequest, READ_AUDIT_KEYS);
  const budgetAuditId = safeBudgetAuditId(valueAt(rawRequest, 'budget_audit_id'));
  const ownerId = safeOwnerId(valueAt(rawRequest, 'owner_id'));
  const entry = loadEntryByAuditId(db, budgetAuditId);
  if (entry === null || entry.audit.owner_id !== ownerId) {
    return freezeDeep({
      result_version: BUILDER_AGENT_BUDGET_AUDIT_STORE_READ_RESULT_VERSION,
      budget_audit_authority: 'main_owned_agent_budget_audit_store',
      status: 'absent',
      budget_audit_id: budgetAuditId,
      owner_id: ownerId,
      budget_audit: null,
      evidence: evidence(db, 'budget_audit_absent_read'),
    });
  }
  return freezeDeep({
    result_version: BUILDER_AGENT_BUDGET_AUDIT_STORE_READ_RESULT_VERSION,
    budget_audit_authority: 'main_owned_agent_budget_audit_store',
    status: 'ready',
    budget_audit_id: budgetAuditId,
    owner_id: ownerId,
    budget_audit: entry,
    evidence: evidence(db, 'budget_audit_ready_read'),
  });
}

function listTaskAudits(db, rawRequest) {
  exactObject(rawRequest, LIST_TASK_AUDITS_KEYS);
  const ownerId = safeOwnerId(valueAt(rawRequest, 'owner_id'));
  const projectId = safeProjectId(valueAt(rawRequest, 'project_id'));
  const taskId = safeTaskId(valueAt(rawRequest, 'task_id'));
  const audits = taskEntries(db, ownerId, projectId, taskId);
  return freezeDeep({
    result_version: BUILDER_AGENT_BUDGET_AUDIT_STORE_READ_RESULT_VERSION,
    budget_audit_authority: 'main_owned_agent_budget_audit_store',
    status: audits.length === 0 ? 'absent' : 'ready',
    owner_id: ownerId,
    project_id: projectId,
    task_id: taskId,
    budget_audits: audits,
    evidence: evidence(db, audits.length === 0 ? 'task_budget_audits_absent_read' : 'task_budget_audits_ready_read'),
  });
}

function listLeaseAudits(db, rawRequest) {
  exactObject(rawRequest, LIST_LEASE_AUDITS_KEYS);
  const leaseId = safeLeaseId(valueAt(rawRequest, 'lease_id'));
  const ownerId = safeOwnerId(valueAt(rawRequest, 'owner_id'));
  const audits = leaseEntries(db, ownerId, leaseId);
  return freezeDeep({
    result_version: BUILDER_AGENT_BUDGET_AUDIT_STORE_READ_RESULT_VERSION,
    budget_audit_authority: 'main_owned_agent_budget_audit_store',
    status: audits.length === 0 ? 'absent' : 'ready',
    lease_id: leaseId,
    owner_id: ownerId,
    budget_audits: audits,
    evidence: evidence(db, audits.length === 0 ? 'lease_budget_audits_absent_read' : 'lease_budget_audits_ready_read'),
  });
}

function ownErrorField(error, key) {
  if (!error || typeof error !== 'object' || utilTypes.isProxy(error)) return null;
  const descriptor = Object.getOwnPropertyDescriptor(error, key);
  return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : null;
}

function normalizeOperationError(error) {
  if (error instanceof BuilderAgentBudgetAuditStoreError) {
    return new BuilderAgentBudgetAuditStoreError(error.code);
  }
  if (
    error instanceof BuilderAgentAssignmentContractError
    || error instanceof BuilderAgentSupervisionLeaseContractError
    || error instanceof BuilderAgentBudgetAuditContractError
  ) {
    return new BuilderAgentBudgetAuditStoreError('builder_agent_budget_audit_store_invalid');
  }
  const sqliteCode = ownErrorField(error, 'code');
  const sqliteErrstr = ownErrorField(error, 'errstr');
  const sqliteErrcode = ownErrorField(error, 'errcode');
  if (sqliteCode && /^SQLITE_CONSTRAINT/u.test(sqliteCode)) {
    return new BuilderAgentBudgetAuditStoreError('builder_agent_budget_audit_store_integrity_failed');
  }
  if (sqliteErrstr === 'constraint failed' || sqliteErrcode === 1555) {
    return new BuilderAgentBudgetAuditStoreError('builder_agent_budget_audit_store_integrity_failed');
  }
  if (sqliteCode && /^SQLITE_(CORRUPT|NOTADB|SCHEMA|INTERNAL|MISMATCH)/u.test(sqliteCode)) {
    return new BuilderAgentBudgetAuditStoreError('builder_agent_budget_audit_store_integrity_failed');
  }
  return new BuilderAgentBudgetAuditStoreError('builder_agent_budget_audit_store_unavailable');
}

function createBuilderAgentBudgetAuditStore(databasePath) {
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
    store_version: BUILDER_AGENT_BUDGET_AUDIT_STORE_VERSION,

    close(...rawArguments) {
      if (rawArguments.length !== 0) {
        throw new BuilderAgentBudgetAuditStoreError('builder_agent_budget_audit_store_invalid');
      }
      try { db.close(); } catch (error) { throw normalizeOperationError(error); }
    },

    record_audit(rawRequest) {
      try { return recordAudit(db, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },

    read_audit(rawRequest) {
      try { return readAudit(db, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },

    list_task_audits(rawRequest) {
      try { return listTaskAudits(db, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },

    list_lease_audits(rawRequest) {
      try { return listLeaseAudits(db, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },
  });
}

module.exports = Object.freeze({
  BUILDER_AGENT_BUDGET_AUDIT_STORE_READ_RESULT_VERSION,
  BUILDER_AGENT_BUDGET_AUDIT_STORE_RESULT_VERSION,
  BUILDER_AGENT_BUDGET_AUDIT_STORE_SCHEMA_VERSION,
  BUILDER_AGENT_BUDGET_AUDIT_STORE_USER_VERSION,
  BUILDER_AGENT_BUDGET_AUDIT_STORE_VERSION,
  BuilderAgentBudgetAuditStoreError,
  createBuilderAgentBudgetAuditStore,
});
