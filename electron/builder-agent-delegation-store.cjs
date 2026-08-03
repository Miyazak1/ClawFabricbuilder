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
  BuilderAgentDelegationContractError,
  BUILDER_AGENT_DELEGATION_RECORD_VERSION,
  sanitizeBuilderAgentDelegationRecord,
} = require('./builder-agent-delegation-contract.cjs');
const {
  BuilderAgentSupervisionLeaseContractError,
  sanitizeBuilderAgentSupervisionLeaseRecord,
} = require('./builder-agent-supervision-lease-contract.cjs');

const BUILDER_AGENT_DELEGATION_STORE_VERSION = 'builder-agent-delegation-store.v1';
const BUILDER_AGENT_DELEGATION_STORE_RESULT_VERSION = 'builder-agent-delegation-store-result.v1';
const BUILDER_AGENT_DELEGATION_STORE_READ_RESULT_VERSION = 'builder-agent-delegation-store-read-result.v1';
const BUILDER_AGENT_DELEGATION_STORE_SCHEMA_VERSION = 'builder-agent-delegation-store-schema.v1';
const BUILDER_AGENT_DELEGATION_STORE_USER_VERSION = 1;
const DATABASE_ID = 'builder-agent-delegation-store.v1';
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
const DELEGATION_ID_PATTERN = /^builder-agent-delegation:[0-9a-f]{64}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const RECORD_DELEGATION_KEYS = Object.freeze([
  'assignment',
  'status',
  'lease',
  'target_definition',
  'target_version',
  'delegation',
]);
const READ_DELEGATION_KEYS = Object.freeze(['delegation_id', 'owner_id']);
const LIST_PARENT_TASK_DELEGATIONS_KEYS = Object.freeze(['owner_id', 'project_id', 'parent_task_id']);
const LIST_CHILD_TASK_DELEGATIONS_KEYS = Object.freeze(['owner_id', 'project_id', 'child_task_id']);
const MAX_TASK_DELEGATIONS = 128;
const MAX_RECEIPT_JSON_BYTES = 64 * 1024;
const CREATE_SCHEMA_SQL = Object.freeze([
  `CREATE TABLE agent_delegations (
    delegation_id TEXT NOT NULL PRIMARY KEY,
    parent_definition_digest TEXT NOT NULL,
    target_definition_digest TEXT NOT NULL,
    record_version TEXT NOT NULL,
    parent_assignment_id TEXT NOT NULL,
    parent_assignment_status_id TEXT NOT NULL,
    parent_lease_id TEXT NOT NULL,
    from_agent_id TEXT NOT NULL,
    from_agent_version_id TEXT NOT NULL,
    to_agent_id TEXT NOT NULL,
    to_agent_version_id TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    parent_conversation_id TEXT NOT NULL,
    parent_task_id TEXT NOT NULL,
    parent_run_id TEXT NOT NULL,
    child_conversation_id TEXT NOT NULL,
    child_task_id TEXT NOT NULL,
    child_run_id TEXT NOT NULL,
    lease_holder_id TEXT NOT NULL,
    delegated_goal TEXT NOT NULL,
    delegated_at_ms INTEGER NOT NULL,
    child_max_steps INTEGER NOT NULL,
    child_max_tool_calls INTEGER NOT NULL,
    child_max_runtime_ms INTEGER NOT NULL,
    child_max_private_source_bytes INTEGER NOT NULL,
    cancellation_policy TEXT NOT NULL,
    result_contract TEXT NOT NULL,
    materialization_boundary TEXT NOT NULL,
    assignment_json TEXT NOT NULL,
    status_json TEXT NOT NULL,
    lease_json TEXT NOT NULL,
    target_definition_json TEXT NOT NULL,
    target_version_json TEXT NOT NULL,
    delegation_json TEXT NOT NULL,
    schema_version TEXT NOT NULL,
    UNIQUE (child_task_id),
    UNIQUE (child_run_id),
    CHECK (schema_version = 'builder-agent-delegation-store-schema.v1'),
    CHECK (record_version = 'builder-agent-delegation-record.v1'),
    CHECK (delegated_at_ms >= 0),
    CHECK (length(delegated_goal) BETWEEN 1 AND 2000),
    CHECK (child_max_steps BETWEEN 1 AND 256),
    CHECK (child_max_tool_calls BETWEEN 0 AND 256),
    CHECK (child_max_tool_calls <= child_max_steps),
    CHECK (child_max_runtime_ms BETWEEN 1000 AND 86400000),
    CHECK (child_max_private_source_bytes BETWEEN 0 AND 4194304),
    CHECK (cancellation_policy = 'parent_cancellation_propagates_to_child'),
    CHECK (result_contract = 'child_result_returns_for_parent_review'),
    CHECK (materialization_boundary = 'no_direct_parent_mutation'),
    CHECK (length(assignment_json) BETWEEN 2 AND 65536),
    CHECK (length(status_json) BETWEEN 2 AND 65536),
    CHECK (length(lease_json) BETWEEN 2 AND 65536),
    CHECK (length(target_definition_json) BETWEEN 2 AND 65536),
    CHECK (length(target_version_json) BETWEEN 2 AND 65536),
    CHECK (length(delegation_json) BETWEEN 2 AND 65536)
  ) STRICT`,
  'CREATE INDEX agent_delegations_parent_task_idx ON agent_delegations(owner_id, project_id, parent_task_id, delegated_at_ms, delegation_id)',
  'CREATE INDEX agent_delegations_child_task_idx ON agent_delegations(owner_id, project_id, child_task_id, delegated_at_ms, delegation_id)',
  'CREATE INDEX agent_delegations_parent_assignment_idx ON agent_delegations(owner_id, parent_assignment_id, delegated_at_ms, delegation_id)',
  'CREATE INDEX agent_delegations_parent_lease_idx ON agent_delegations(owner_id, parent_lease_id, delegated_at_ms, delegation_id)',
  'CREATE INDEX agent_delegations_target_agent_idx ON agent_delegations(owner_id, to_agent_id, delegated_at_ms, delegation_id)',
]);
const ERROR_MESSAGES = Object.freeze({
  builder_agent_delegation_store_invalid: 'Builder agent delegation could not be verified.',
  builder_agent_delegation_store_not_found: 'Builder agent delegation is unavailable.',
  builder_agent_delegation_store_conflict: 'Builder agent delegation changed before it could be recorded.',
  builder_agent_delegation_store_integrity_failed: 'Builder agent delegation integrity could not be verified.',
  builder_agent_delegation_store_resource_exceeded: 'Builder agent delegation limits were reached.',
  builder_agent_delegation_store_unavailable: 'Builder agent delegation storage is unavailable.',
});

class BuilderAgentDelegationStoreError extends Error {
  constructor(code = 'builder_agent_delegation_store_invalid') {
    const selected = Object.hasOwn(ERROR_MESSAGES, code)
      ? code
      : 'builder_agent_delegation_store_invalid';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderAgentDelegationStoreError';
    this.code = selected;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) {
  throw new BuilderAgentDelegationStoreError(code);
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
  if (!isPlainObject(value)) fail('builder_agent_delegation_store_invalid');
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== keys.length
    || actual.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) fail('builder_agent_delegation_store_invalid');
  for (const key of actual) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      fail('builder_agent_delegation_store_invalid');
    }
  }
}

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
    fail('builder_agent_delegation_store_invalid');
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
  fail('builder_agent_delegation_store_invalid');
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
    fail('builder_agent_delegation_store_invalid');
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

function safeDelegationId(value) {
  return safePattern(value, DELEGATION_ID_PATTERN);
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail('builder_agent_delegation_store_invalid');
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
  ) fail('builder_agent_delegation_store_invalid');
  return value;
}

function assertParentDirectory(filePath) {
  let info;
  try {
    info = fs.lstatSync(path.dirname(filePath));
  } catch {
    fail('builder_agent_delegation_store_unavailable');
  }
  if (!info.isDirectory() || info.isSymbolicLink()) {
    fail('builder_agent_delegation_store_unavailable');
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
    fail('builder_agent_delegation_store_integrity_failed');
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
  if (mode !== 'wal') fail('builder_agent_delegation_store_unavailable');
  const pragmas = runtimePragmas(db);
  if (
    pragmas.foreign_keys !== 'on'
    || pragmas.trusted_schema !== 'off'
    || pragmas.synchronous !== 'full'
    || pragmas.journal_mode !== 'wal'
  ) fail('builder_agent_delegation_store_unavailable');
}

function createSchema(db) {
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const sql of CREATE_SCHEMA_SQL) db.exec(sql);
    db.exec(`PRAGMA user_version = ${BUILDER_AGENT_DELEGATION_STORE_USER_VERSION}`);
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
    expectedDb.exec(`PRAGMA user_version = ${BUILDER_AGENT_DELEGATION_STORE_USER_VERSION}`);
    expectedSchemaFingerprint = canonicalJson(collectSchemaFingerprint(expectedDb));
    return expectedSchemaFingerprint;
  } finally {
    expectedDb.close();
  }
}

function validateSchema(db) {
  const actual = collectSchemaFingerprint(db);
  if (actual.foreign_key_check.length !== 0) fail('builder_agent_delegation_store_integrity_failed');
  if (canonicalJson(actual) !== expectedFingerprint()) {
    fail('builder_agent_delegation_store_integrity_failed');
  }
}

function initialize(db) {
  configurePragmas(db);
  const version = userVersion(db);
  if (version === 0) createSchema(db);
  else if (version !== BUILDER_AGENT_DELEGATION_STORE_USER_VERSION) {
    fail('builder_agent_delegation_store_integrity_failed');
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
    if (error instanceof BuilderAgentDelegationStoreError) fail(code);
    throw error;
  }
  return parsed;
}

function sanitizeDelegationRequest(value) {
  exactObject(value, RECORD_DELEGATION_KEYS);
  const assignment = valueAt(value, 'assignment');
  const status = valueAt(value, 'status');
  const lease = valueAt(value, 'lease');
  const targetDefinition = valueAt(value, 'target_definition');
  const targetVersion = valueAt(value, 'target_version');
  const delegation = valueAt(value, 'delegation');
  try {
    const activeStatus = sanitizeBuilderAgentAssignmentStatusRecord(status, assignment);
    if (activeStatus.next_status !== 'active') fail('builder_agent_delegation_store_invalid');
    const activeLease = sanitizeBuilderAgentSupervisionLeaseRecord(lease, assignment, activeStatus);
    return freezeDeep({
      assignment,
      status: activeStatus,
      lease: activeLease,
      target_definition: targetDefinition,
      target_version: targetVersion,
      delegation: sanitizeBuilderAgentDelegationRecord(
        delegation,
        assignment,
        activeStatus,
        activeLease,
        targetVersion,
        targetDefinition,
      ),
    });
  } catch (error) {
    if (
      error instanceof BuilderAgentAssignmentContractError
      || error instanceof BuilderAgentSupervisionLeaseContractError
      || error instanceof BuilderAgentDelegationContractError
    ) fail('builder_agent_delegation_store_invalid');
    throw error;
  }
}

function delegationColumns() {
  return `delegation_id, parent_definition_digest, target_definition_digest,
    record_version, parent_assignment_id, parent_assignment_status_id,
    parent_lease_id, from_agent_id, from_agent_version_id, to_agent_id,
    to_agent_version_id, owner_id, project_id, parent_conversation_id,
    parent_task_id, parent_run_id, child_conversation_id, child_task_id,
    child_run_id, lease_holder_id, delegated_goal, delegated_at_ms,
    child_max_steps, child_max_tool_calls, child_max_runtime_ms,
    child_max_private_source_bytes, cancellation_policy, result_contract,
    materialization_boundary, assignment_json, status_json, lease_json,
    target_definition_json, target_version_json, delegation_json`;
}

function entryFromRow(row) {
  if (!row) return null;
  try {
    const assignment = parseCanonicalReceipt(row.assignment_json, 'builder_agent_delegation_store_integrity_failed');
    const status = parseCanonicalReceipt(row.status_json, 'builder_agent_delegation_store_integrity_failed');
    const lease = parseCanonicalReceipt(row.lease_json, 'builder_agent_delegation_store_integrity_failed');
    const targetDefinition = parseCanonicalReceipt(
      row.target_definition_json,
      'builder_agent_delegation_store_integrity_failed',
    );
    const targetVersion = parseCanonicalReceipt(
      row.target_version_json,
      'builder_agent_delegation_store_integrity_failed',
    );
    const parsedDelegation = parseCanonicalReceipt(
      row.delegation_json,
      'builder_agent_delegation_store_integrity_failed',
    );
    const activeStatus = sanitizeBuilderAgentAssignmentStatusRecord(status, assignment);
    const activeLease = sanitizeBuilderAgentSupervisionLeaseRecord(lease, assignment, activeStatus);
    const delegation = sanitizeBuilderAgentDelegationRecord(
      parsedDelegation,
      assignment,
      activeStatus,
      activeLease,
      targetVersion,
      targetDefinition,
    );
    const rowFacts = freezeDeep({
      delegation_id: safePattern(row.delegation_id, DELEGATION_ID_PATTERN),
      parent_definition_digest: safePattern(row.parent_definition_digest, DIGEST_PATTERN),
      target_definition_digest: safePattern(row.target_definition_digest, DIGEST_PATTERN),
      record_version: row.record_version,
      parent_assignment_id: safePattern(row.parent_assignment_id, ASSIGNMENT_ID_PATTERN),
      parent_assignment_status_id: safePattern(row.parent_assignment_status_id, ASSIGNMENT_STATUS_ID_PATTERN),
      parent_lease_id: safePattern(row.parent_lease_id, LEASE_ID_PATTERN),
      from_agent_id: safePattern(row.from_agent_id, AGENT_ID_PATTERN),
      from_agent_version_id: safePattern(row.from_agent_version_id, AGENT_VERSION_ID_PATTERN),
      to_agent_id: safePattern(row.to_agent_id, AGENT_ID_PATTERN),
      to_agent_version_id: safePattern(row.to_agent_version_id, AGENT_VERSION_ID_PATTERN),
      owner_id: safePattern(row.owner_id, OWNER_ID_PATTERN),
      project_id: safePattern(row.project_id, PROJECT_ID_PATTERN),
      parent_conversation_id: safePattern(row.parent_conversation_id, CONVERSATION_ID_PATTERN),
      parent_task_id: safePattern(row.parent_task_id, TASK_ID_PATTERN),
      parent_run_id: safePattern(row.parent_run_id, RUN_ID_PATTERN),
      child_conversation_id: safePattern(row.child_conversation_id, CONVERSATION_ID_PATTERN),
      child_task_id: safePattern(row.child_task_id, TASK_ID_PATTERN),
      child_run_id: safePattern(row.child_run_id, RUN_ID_PATTERN),
      lease_holder_id: safePattern(row.lease_holder_id, SUPERVISOR_ID_PATTERN),
      delegated_goal: row.delegated_goal,
      delegated_at_ms: safeTimestamp(row.delegated_at_ms),
      child_max_steps: row.child_max_steps,
      child_max_tool_calls: row.child_max_tool_calls,
      child_max_runtime_ms: row.child_max_runtime_ms,
      child_max_private_source_bytes: row.child_max_private_source_bytes,
      cancellation_policy: row.cancellation_policy,
      result_contract: row.result_contract,
      materialization_boundary: row.materialization_boundary,
    });
    if (
      rowFacts.delegation_id !== delegation.delegation_id
      || rowFacts.parent_definition_digest !== delegation.parent_definition_digest
      || rowFacts.target_definition_digest !== delegation.target_definition_digest
      || rowFacts.record_version !== BUILDER_AGENT_DELEGATION_RECORD_VERSION
      || rowFacts.record_version !== delegation.record_version
      || rowFacts.parent_assignment_id !== delegation.parent_assignment_id
      || rowFacts.parent_assignment_status_id !== delegation.parent_assignment_status_id
      || rowFacts.parent_lease_id !== delegation.parent_lease_id
      || rowFacts.from_agent_id !== delegation.from_agent_id
      || rowFacts.from_agent_version_id !== delegation.from_agent_version_id
      || rowFacts.to_agent_id !== delegation.to_agent_id
      || rowFacts.to_agent_version_id !== delegation.to_agent_version_id
      || rowFacts.owner_id !== delegation.owner_id
      || rowFacts.project_id !== delegation.project_id
      || rowFacts.parent_conversation_id !== delegation.parent_conversation_id
      || rowFacts.parent_task_id !== delegation.parent_task_id
      || rowFacts.parent_run_id !== delegation.parent_run_id
      || rowFacts.child_conversation_id !== delegation.child_conversation_id
      || rowFacts.child_task_id !== delegation.child_task_id
      || rowFacts.child_run_id !== delegation.child_run_id
      || rowFacts.lease_holder_id !== delegation.lease_holder_id
      || rowFacts.delegated_goal !== delegation.delegated_goal
      || rowFacts.delegated_at_ms !== delegation.delegated_at_ms
      || rowFacts.child_max_steps !== delegation.budget_intersection.max_steps
      || rowFacts.child_max_tool_calls !== delegation.budget_intersection.max_tool_calls
      || rowFacts.child_max_runtime_ms !== delegation.budget_intersection.max_runtime_ms
      || rowFacts.child_max_private_source_bytes !== delegation.budget_intersection.max_private_source_bytes
      || rowFacts.cancellation_policy !== delegation.cancellation_policy
      || rowFacts.result_contract !== delegation.result_contract
      || rowFacts.materialization_boundary !== delegation.materialization_boundary
    ) fail('builder_agent_delegation_store_integrity_failed');
    return freezeDeep({
      assignment,
      status: activeStatus,
      lease: activeLease,
      target_definition: targetDefinition,
      target_version: targetVersion,
      delegation,
    });
  } catch (error) {
    if (
      error instanceof BuilderAgentDelegationStoreError
      || error instanceof BuilderAgentAssignmentContractError
      || error instanceof BuilderAgentSupervisionLeaseContractError
      || error instanceof BuilderAgentDelegationContractError
    ) fail('builder_agent_delegation_store_integrity_failed');
    throw error;
  }
}

function loadEntryByDelegationId(db, delegationId) {
  return entryFromRow(one(
    db,
    `SELECT ${delegationColumns()} FROM agent_delegations WHERE delegation_id = ?`,
    [delegationId],
  ));
}

function loadEntryByChildTaskId(db, childTaskId) {
  return entryFromRow(one(
    db,
    `SELECT ${delegationColumns()} FROM agent_delegations WHERE child_task_id = ?`,
    [childTaskId],
  ));
}

function loadEntryByChildRunId(db, childRunId) {
  return entryFromRow(one(
    db,
    `SELECT ${delegationColumns()} FROM agent_delegations WHERE child_run_id = ?`,
    [childRunId],
  ));
}

function parentTaskEntries(db, ownerId, projectId, parentTaskId) {
  const rows = all(
    db,
    `SELECT ${delegationColumns()}
      FROM agent_delegations
      WHERE owner_id = ? AND project_id = ? AND parent_task_id = ?
      ORDER BY delegated_at_ms ASC, delegation_id ASC
      LIMIT ?`,
    [ownerId, projectId, parentTaskId, MAX_TASK_DELEGATIONS + 1],
  );
  if (rows.length > MAX_TASK_DELEGATIONS) fail('builder_agent_delegation_store_resource_exceeded');
  return freezeDeep(rows.map(entryFromRow));
}

function childTaskEntries(db, ownerId, projectId, childTaskId) {
  const rows = all(
    db,
    `SELECT ${delegationColumns()}
      FROM agent_delegations
      WHERE owner_id = ? AND project_id = ? AND child_task_id = ?
      ORDER BY delegated_at_ms ASC, delegation_id ASC
      LIMIT ?`,
    [ownerId, projectId, childTaskId, MAX_TASK_DELEGATIONS + 1],
  );
  if (rows.length > MAX_TASK_DELEGATIONS) fail('builder_agent_delegation_store_resource_exceeded');
  return freezeDeep(rows.map(entryFromRow));
}

function sameFact(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function sameEntry(left, right) {
  return sameFact(left.assignment, right.assignment)
    && sameFact(left.status, right.status)
    && sameFact(left.lease, right.lease)
    && sameFact(left.target_definition, right.target_definition)
    && sameFact(left.target_version, right.target_version)
    && sameFact(left.delegation, right.delegation);
}

function evidence(db, transaction) {
  return freezeDeep({
    database_id: DATABASE_ID,
    schema_version: BUILDER_AGENT_DELEGATION_STORE_SCHEMA_VERSION,
    user_version: BUILDER_AGENT_DELEGATION_STORE_USER_VERSION,
    schema_fingerprint_digest: sha256Canonical(collectSchemaFingerprint(db)),
    runtime_pragmas: runtimePragmas(db),
    transaction,
    delegation_authority: 'main_owned_agent_delegation_store',
    renderer_authority: 'not_present',
    ipc_authority: 'not_present',
    child_assignment_authority: false,
    model_dispatch: false,
    tool_dispatch: false,
    permission_grant_authority: false,
    credential_storage: 'not_present',
    source_read: 'not_present',
    source_write: 'not_present',
    process_run: false,
    network_access: false,
    revision_authority: false,
    review_authority: false,
    artifact_authority: false,
  });
}

function storeResult(db, operation, payload) {
  return freezeDeep({
    result_version: BUILDER_AGENT_DELEGATION_STORE_RESULT_VERSION,
    operation,
    ...payload,
    delegation_evidence: evidence(db, operation),
  });
}

function insertDelegation(db, entry) {
  const delegation = entry.delegation;
  run(db, `INSERT INTO agent_delegations (
    delegation_id, parent_definition_digest, target_definition_digest,
    record_version, parent_assignment_id, parent_assignment_status_id,
    parent_lease_id, from_agent_id, from_agent_version_id, to_agent_id,
    to_agent_version_id, owner_id, project_id, parent_conversation_id,
    parent_task_id, parent_run_id, child_conversation_id, child_task_id,
    child_run_id, lease_holder_id, delegated_goal, delegated_at_ms,
    child_max_steps, child_max_tool_calls, child_max_runtime_ms,
    child_max_private_source_bytes, cancellation_policy, result_contract,
    materialization_boundary, assignment_json, status_json, lease_json,
    target_definition_json, target_version_json, delegation_json, schema_version
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
    delegation.delegation_id,
    delegation.parent_definition_digest,
    delegation.target_definition_digest,
    delegation.record_version,
    delegation.parent_assignment_id,
    delegation.parent_assignment_status_id,
    delegation.parent_lease_id,
    delegation.from_agent_id,
    delegation.from_agent_version_id,
    delegation.to_agent_id,
    delegation.to_agent_version_id,
    delegation.owner_id,
    delegation.project_id,
    delegation.parent_conversation_id,
    delegation.parent_task_id,
    delegation.parent_run_id,
    delegation.child_conversation_id,
    delegation.child_task_id,
    delegation.child_run_id,
    delegation.lease_holder_id,
    delegation.delegated_goal,
    delegation.delegated_at_ms,
    delegation.budget_intersection.max_steps,
    delegation.budget_intersection.max_tool_calls,
    delegation.budget_intersection.max_runtime_ms,
    delegation.budget_intersection.max_private_source_bytes,
    delegation.cancellation_policy,
    delegation.result_contract,
    delegation.materialization_boundary,
    canonicalJson(entry.assignment),
    canonicalJson(entry.status),
    canonicalJson(entry.lease),
    canonicalJson(entry.target_definition),
    canonicalJson(entry.target_version),
    canonicalJson(delegation),
    BUILDER_AGENT_DELEGATION_STORE_SCHEMA_VERSION,
  ]);
}

function recordDelegation(db, rawRequest) {
  const requested = sanitizeDelegationRequest(rawRequest);
  db.exec('BEGIN IMMEDIATE');
  try {
    const existing = loadEntryByDelegationId(db, requested.delegation.delegation_id);
    if (existing !== null) {
      if (!sameEntry(existing, requested)) fail('builder_agent_delegation_store_conflict');
      db.exec('COMMIT');
      return storeResult(db, 'delegation_replayed', { delegation: existing });
    }
    if (loadEntryByChildTaskId(db, requested.delegation.child_task_id) !== null) {
      fail('builder_agent_delegation_store_conflict');
    }
    if (loadEntryByChildRunId(db, requested.delegation.child_run_id) !== null) {
      fail('builder_agent_delegation_store_conflict');
    }
    insertDelegation(db, requested);
    const readback = loadEntryByDelegationId(db, requested.delegation.delegation_id);
    if (readback === null || !sameEntry(readback, requested)) {
      fail('builder_agent_delegation_store_integrity_failed');
    }
    db.exec('COMMIT');
    return storeResult(db, 'delegation_recorded', { delegation: readback });
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* fixed failure below */ }
    throw error;
  }
}

function readDelegation(db, rawRequest) {
  exactObject(rawRequest, READ_DELEGATION_KEYS);
  const delegationId = safeDelegationId(valueAt(rawRequest, 'delegation_id'));
  const ownerId = safeOwnerId(valueAt(rawRequest, 'owner_id'));
  const entry = loadEntryByDelegationId(db, delegationId);
  if (entry === null || entry.delegation.owner_id !== ownerId) {
    return freezeDeep({
      result_version: BUILDER_AGENT_DELEGATION_STORE_READ_RESULT_VERSION,
      delegation_authority: 'main_owned_agent_delegation_store',
      status: 'absent',
      delegation_id: delegationId,
      owner_id: ownerId,
      delegation: null,
      evidence: evidence(db, 'delegation_absent_read'),
    });
  }
  return freezeDeep({
    result_version: BUILDER_AGENT_DELEGATION_STORE_READ_RESULT_VERSION,
    delegation_authority: 'main_owned_agent_delegation_store',
    status: 'ready',
    delegation_id: delegationId,
    owner_id: ownerId,
    delegation: entry,
    evidence: evidence(db, 'delegation_ready_read'),
  });
}

function listParentTaskDelegations(db, rawRequest) {
  exactObject(rawRequest, LIST_PARENT_TASK_DELEGATIONS_KEYS);
  const ownerId = safeOwnerId(valueAt(rawRequest, 'owner_id'));
  const projectId = safeProjectId(valueAt(rawRequest, 'project_id'));
  const parentTaskId = safeTaskId(valueAt(rawRequest, 'parent_task_id'));
  const delegations = parentTaskEntries(db, ownerId, projectId, parentTaskId);
  return freezeDeep({
    result_version: BUILDER_AGENT_DELEGATION_STORE_READ_RESULT_VERSION,
    delegation_authority: 'main_owned_agent_delegation_store',
    status: delegations.length === 0 ? 'absent' : 'ready',
    owner_id: ownerId,
    project_id: projectId,
    parent_task_id: parentTaskId,
    delegations,
    evidence: evidence(db, delegations.length === 0 ? 'parent_task_delegations_absent_read' : 'parent_task_delegations_ready_read'),
  });
}

function listChildTaskDelegations(db, rawRequest) {
  exactObject(rawRequest, LIST_CHILD_TASK_DELEGATIONS_KEYS);
  const ownerId = safeOwnerId(valueAt(rawRequest, 'owner_id'));
  const projectId = safeProjectId(valueAt(rawRequest, 'project_id'));
  const childTaskId = safeTaskId(valueAt(rawRequest, 'child_task_id'));
  const delegations = childTaskEntries(db, ownerId, projectId, childTaskId);
  return freezeDeep({
    result_version: BUILDER_AGENT_DELEGATION_STORE_READ_RESULT_VERSION,
    delegation_authority: 'main_owned_agent_delegation_store',
    status: delegations.length === 0 ? 'absent' : 'ready',
    owner_id: ownerId,
    project_id: projectId,
    child_task_id: childTaskId,
    delegations,
    evidence: evidence(db, delegations.length === 0 ? 'child_task_delegations_absent_read' : 'child_task_delegations_ready_read'),
  });
}

function ownErrorField(error, key) {
  if (!error || typeof error !== 'object' || utilTypes.isProxy(error)) return null;
  const descriptor = Object.getOwnPropertyDescriptor(error, key);
  return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : null;
}

function normalizeOperationError(error) {
  if (error instanceof BuilderAgentDelegationStoreError) {
    return new BuilderAgentDelegationStoreError(error.code);
  }
  if (
    error instanceof BuilderAgentAssignmentContractError
    || error instanceof BuilderAgentSupervisionLeaseContractError
    || error instanceof BuilderAgentDelegationContractError
  ) {
    return new BuilderAgentDelegationStoreError('builder_agent_delegation_store_invalid');
  }
  const sqliteCode = ownErrorField(error, 'code');
  const sqliteErrstr = ownErrorField(error, 'errstr');
  const sqliteErrcode = ownErrorField(error, 'errcode');
  if (sqliteCode && /^SQLITE_CONSTRAINT/u.test(sqliteCode)) {
    return new BuilderAgentDelegationStoreError('builder_agent_delegation_store_integrity_failed');
  }
  if (sqliteErrstr === 'constraint failed' || sqliteErrcode === 1555) {
    return new BuilderAgentDelegationStoreError('builder_agent_delegation_store_integrity_failed');
  }
  if (sqliteCode && /^SQLITE_(CORRUPT|NOTADB|SCHEMA|INTERNAL|MISMATCH)/u.test(sqliteCode)) {
    return new BuilderAgentDelegationStoreError('builder_agent_delegation_store_integrity_failed');
  }
  return new BuilderAgentDelegationStoreError('builder_agent_delegation_store_unavailable');
}

function createBuilderAgentDelegationStore(databasePath) {
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
    store_version: BUILDER_AGENT_DELEGATION_STORE_VERSION,

    close(...rawArguments) {
      if (rawArguments.length !== 0) {
        throw new BuilderAgentDelegationStoreError('builder_agent_delegation_store_invalid');
      }
      try { db.close(); } catch (error) { throw normalizeOperationError(error); }
    },

    record_delegation(rawRequest) {
      try { return recordDelegation(db, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },

    read_delegation(rawRequest) {
      try { return readDelegation(db, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },

    list_parent_task_delegations(rawRequest) {
      try { return listParentTaskDelegations(db, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },

    list_child_task_delegations(rawRequest) {
      try { return listChildTaskDelegations(db, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },
  });
}

module.exports = Object.freeze({
  BUILDER_AGENT_DELEGATION_STORE_READ_RESULT_VERSION,
  BUILDER_AGENT_DELEGATION_STORE_RESULT_VERSION,
  BUILDER_AGENT_DELEGATION_STORE_SCHEMA_VERSION,
  BUILDER_AGENT_DELEGATION_STORE_USER_VERSION,
  BUILDER_AGENT_DELEGATION_STORE_VERSION,
  BuilderAgentDelegationStoreError,
  createBuilderAgentDelegationStore,
});
