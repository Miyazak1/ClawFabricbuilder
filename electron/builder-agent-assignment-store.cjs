'use strict';

const nodeCrypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { types: utilTypes } = require('node:util');

const {
  BuilderAgentDefinitionContractError,
  sanitizeBuilderAgentDefinitionRecord,
  sanitizeBuilderAgentVersionRecord,
} = require('./builder-agent-definition-contract.cjs');
const {
  BUILDER_AGENT_ASSIGNMENT_RECORD_VERSION,
  BUILDER_AGENT_ASSIGNMENT_STATUS_RECORD_VERSION,
  BuilderAgentAssignmentContractError,
  sanitizeBuilderAgentAssignmentRecord,
  sanitizeBuilderAgentAssignmentStatusRecord,
} = require('./builder-agent-assignment-contract.cjs');

const BUILDER_AGENT_ASSIGNMENT_STORE_VERSION = 'builder-agent-assignment-store.v1';
const BUILDER_AGENT_ASSIGNMENT_STORE_RESULT_VERSION = 'builder-agent-assignment-store-result.v1';
const BUILDER_AGENT_ASSIGNMENT_STORE_READ_RESULT_VERSION = 'builder-agent-assignment-store-read-result.v1';
const BUILDER_AGENT_ASSIGNMENT_STORE_SCHEMA_VERSION = 'builder-agent-assignment-store-schema.v1';
const BUILDER_AGENT_ASSIGNMENT_STORE_USER_VERSION = 1;
const DATABASE_ID = 'builder-agent-assignment-store.v1';
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const OWNER_ID_PATTERN = new RegExp(`^builder-user:${UUID_SOURCE}$`, 'u');
const AGENT_ID_PATTERN = new RegExp(`^builder-agent:${UUID_SOURCE}$`, 'u');
const AGENT_VERSION_ID_PATTERN = /^builder-agent-version:[0-9a-f]{64}$/u;
const PROJECT_ID_PATTERN = new RegExp(`^builder-project:${UUID_SOURCE}$`, 'u');
const CONVERSATION_ID_PATTERN = new RegExp(`^builder-conversation:${UUID_SOURCE}$`, 'u');
const TASK_ID_PATTERN = new RegExp(`^builder-task:${UUID_SOURCE}$`, 'u');
const RUN_ID_PATTERN = new RegExp(`^builder-run:${UUID_SOURCE}$`, 'u');
const ASSIGNMENT_ID_PATTERN = /^builder-agent-assignment:[0-9a-f]{64}$/u;
const ASSIGNMENT_STATUS_ID_PATTERN = /^builder-agent-assignment-status:[0-9a-f]{64}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const RECORD_ASSIGNMENT_KEYS = Object.freeze(['definition', 'version', 'assignment']);
const RECORD_STATUS_KEYS = Object.freeze(['status']);
const READ_ASSIGNMENT_KEYS = Object.freeze(['assignment_id', 'owner_id']);
const LIST_TASK_ASSIGNMENTS_KEYS = Object.freeze(['owner_id', 'project_id', 'task_id']);
const MAX_TASK_ASSIGNMENTS = 64;
const MAX_STATUS_RECORDS = 256;
const CREATE_SCHEMA_SQL = Object.freeze([
  `CREATE TABLE agent_assignments (
    assignment_id TEXT NOT NULL PRIMARY KEY,
    definition_digest TEXT NOT NULL,
    record_version TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    agent_version_id TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    assigned_by TEXT NOT NULL,
    project_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    goal TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL,
    permission_boundary TEXT NOT NULL,
    supervision_policy TEXT NOT NULL,
    result_contract TEXT NOT NULL,
    max_steps INTEGER NOT NULL,
    max_tool_calls INTEGER NOT NULL,
    max_runtime_ms INTEGER NOT NULL,
    max_private_source_bytes INTEGER NOT NULL,
    schema_version TEXT NOT NULL,
    UNIQUE (agent_id, run_id),
    CHECK (schema_version = 'builder-agent-assignment-store-schema.v1'),
    CHECK (record_version = 'builder-agent-assignment-record.v1'),
    CHECK (created_at_ms >= 0),
    CHECK (assigned_by = owner_id),
    CHECK (permission_boundary = 'explicit_permission_required'),
    CHECK (supervision_policy = 'owner_supervised'),
    CHECK (result_contract = 'review_required_before_materialization'),
    CHECK (max_steps BETWEEN 1 AND 256),
    CHECK (max_tool_calls BETWEEN 0 AND 256),
    CHECK (max_runtime_ms BETWEEN 1000 AND 86400000),
    CHECK (max_private_source_bytes BETWEEN 0 AND 4194304)
  ) STRICT`,
  `CREATE TABLE agent_assignment_status (
    assignment_id TEXT NOT NULL,
    assignment_status_id TEXT NOT NULL,
    definition_digest TEXT NOT NULL,
    record_version TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    decided_by TEXT NOT NULL,
    next_status TEXT NOT NULL,
    reason TEXT NOT NULL,
    decided_at_ms INTEGER NOT NULL,
    schema_version TEXT NOT NULL,
    PRIMARY KEY (assignment_id, assignment_status_id),
    CHECK (schema_version = 'builder-agent-assignment-store-schema.v1'),
    CHECK (record_version = 'builder-agent-assignment-status-record.v1'),
    CHECK (next_status IN ('queued', 'active', 'paused', 'cancelled', 'completed')),
    CHECK (decided_at_ms >= 0),
    CHECK (decided_by = owner_id),
    FOREIGN KEY (assignment_id)
      REFERENCES agent_assignments(assignment_id)
      ON DELETE RESTRICT ON UPDATE RESTRICT
  ) STRICT`,
  'CREATE INDEX agent_assignments_owner_task_idx ON agent_assignments(owner_id, project_id, task_id, created_at_ms, assignment_id)',
  'CREATE INDEX agent_assignments_run_idx ON agent_assignments(run_id, agent_id)',
  'CREATE INDEX agent_assignment_status_lookup_idx ON agent_assignment_status(assignment_id, decided_at_ms, assignment_status_id)',
]);
const ERROR_MESSAGES = Object.freeze({
  builder_agent_assignment_store_invalid: 'Builder agent assignments could not be verified.',
  builder_agent_assignment_store_not_found: 'Builder agent assignment is unavailable.',
  builder_agent_assignment_store_conflict: 'Builder agent assignments changed before they could be recorded.',
  builder_agent_assignment_store_integrity_failed: 'Builder agent assignment integrity could not be verified.',
  builder_agent_assignment_store_resource_exceeded: 'Builder agent assignment limits were reached.',
  builder_agent_assignment_store_unavailable: 'Builder agent assignment storage is unavailable.',
});

class BuilderAgentAssignmentStoreError extends Error {
  constructor(code = 'builder_agent_assignment_store_invalid') {
    const selected = Object.hasOwn(ERROR_MESSAGES, code)
      ? code
      : 'builder_agent_assignment_store_invalid';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderAgentAssignmentStoreError';
    this.code = selected;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) {
  throw new BuilderAgentAssignmentStoreError(code);
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
  if (!isPlainObject(value)) fail('builder_agent_assignment_store_invalid');
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== keys.length
    || actual.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) fail('builder_agent_assignment_store_invalid');
  for (const key of actual) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      fail('builder_agent_assignment_store_invalid');
    }
  }
}

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
    fail('builder_agent_assignment_store_invalid');
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
  fail('builder_agent_assignment_store_invalid');
}

function sha256Canonical(value) {
  return nodeCrypto.createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

function safePattern(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) {
    fail('builder_agent_assignment_store_invalid');
  }
  return value;
}

function safeOwnerId(value) {
  return safePattern(value, OWNER_ID_PATTERN);
}

function safeAgentId(value) {
  return safePattern(value, AGENT_ID_PATTERN);
}

function safeAgentVersionId(value) {
  return safePattern(value, AGENT_VERSION_ID_PATTERN);
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

function safeAssignmentId(value) {
  return safePattern(value, ASSIGNMENT_ID_PATTERN);
}

function safeAssignmentStatusId(value) {
  return safePattern(value, ASSIGNMENT_STATUS_ID_PATTERN);
}

function safeDigest(value) {
  return safePattern(value, DIGEST_PATTERN);
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail('builder_agent_assignment_store_invalid');
  return value;
}

function safeIntegerRange(value, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    fail('builder_agent_assignment_store_invalid');
  }
  return value;
}

function safeText(value, minLength, maxLength) {
  if (
    typeof value !== 'string'
    || value.trim() !== value
    || value.length < minLength
    || value.length > maxLength
    || hasControlCharacter(value)
  ) fail('builder_agent_assignment_store_invalid');
  return value;
}

function safeAssignmentBudget(value) {
  return freezeDeep({
    max_steps: safeIntegerRange(value.max_steps, 1, 256),
    max_tool_calls: safeIntegerRange(value.max_tool_calls, 0, 256),
    max_runtime_ms: safeIntegerRange(value.max_runtime_ms, 1_000, 86_400_000),
    max_private_source_bytes: safeIntegerRange(value.max_private_source_bytes, 0, 4 * 1_024 * 1_024),
  });
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
  ) fail('builder_agent_assignment_store_invalid');
  return value;
}

function assertParentDirectory(filePath) {
  let info;
  try {
    info = fs.lstatSync(path.dirname(filePath));
  } catch {
    fail('builder_agent_assignment_store_unavailable');
  }
  if (!info.isDirectory() || info.isSymbolicLink()) {
    fail('builder_agent_assignment_store_unavailable');
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
    fail('builder_agent_assignment_store_integrity_failed');
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
  if (mode !== 'wal') fail('builder_agent_assignment_store_unavailable');
  const pragmas = runtimePragmas(db);
  if (
    pragmas.foreign_keys !== 'on'
    || pragmas.trusted_schema !== 'off'
    || pragmas.synchronous !== 'full'
    || pragmas.journal_mode !== 'wal'
  ) fail('builder_agent_assignment_store_unavailable');
}

function createSchema(db) {
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const sql of CREATE_SCHEMA_SQL) db.exec(sql);
    db.exec(`PRAGMA user_version = ${BUILDER_AGENT_ASSIGNMENT_STORE_USER_VERSION}`);
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
    expectedDb.exec(`PRAGMA user_version = ${BUILDER_AGENT_ASSIGNMENT_STORE_USER_VERSION}`);
    expectedSchemaFingerprint = canonicalJson(collectSchemaFingerprint(expectedDb));
    return expectedSchemaFingerprint;
  } finally {
    expectedDb.close();
  }
}

function validateSchema(db) {
  const actual = collectSchemaFingerprint(db);
  if (actual.foreign_key_check.length !== 0) fail('builder_agent_assignment_store_integrity_failed');
  if (canonicalJson(actual) !== expectedFingerprint()) {
    fail('builder_agent_assignment_store_integrity_failed');
  }
}

function initialize(db) {
  configurePragmas(db);
  const version = userVersion(db);
  if (version === 0) createSchema(db);
  else if (version !== BUILDER_AGENT_ASSIGNMENT_STORE_USER_VERSION) {
    fail('builder_agent_assignment_store_integrity_failed');
  }
  validateSchema(db);
}

function assignmentIdFor(definitionDigest, fields) {
  return `builder-agent-assignment:${sha256Canonical({
    agent_assignment_identity: BUILDER_AGENT_ASSIGNMENT_RECORD_VERSION,
    definition_digest: definitionDigest,
    fields,
  })}`;
}

function assignmentStatusIdFor(assignment, fields) {
  return `builder-agent-assignment-status:${sha256Canonical({
    agent_assignment_status_identity: BUILDER_AGENT_ASSIGNMENT_STATUS_RECORD_VERSION,
    assignment_id: assignment.assignment_id,
    definition_digest: assignment.definition_digest,
    fields,
  })}`;
}

function safeAssignmentFromRow(row) {
  if (!row) return null;
  try {
    const recordVersion = row.record_version;
    const permissionBoundary = row.permission_boundary;
    const supervisionPolicy = row.supervision_policy;
    const resultContract = row.result_contract;
    if (
      recordVersion !== BUILDER_AGENT_ASSIGNMENT_RECORD_VERSION
      || permissionBoundary !== 'explicit_permission_required'
      || supervisionPolicy !== 'owner_supervised'
      || resultContract !== 'review_required_before_materialization'
    ) fail('builder_agent_assignment_store_integrity_failed');
    const assignment = freezeDeep({
      assignment_id: safeAssignmentId(row.assignment_id),
      definition_digest: safeDigest(row.definition_digest),
      record_version: recordVersion,
      agent_id: safeAgentId(row.agent_id),
      agent_version_id: safeAgentVersionId(row.agent_version_id),
      owner_id: safeOwnerId(row.owner_id),
      assigned_by: safeOwnerId(row.assigned_by),
      project_id: safeProjectId(row.project_id),
      conversation_id: safeConversationId(row.conversation_id),
      task_id: safeTaskId(row.task_id),
      run_id: safeRunId(row.run_id),
      goal: safeText(row.goal, 1, 2_000),
      created_at_ms: safeTimestamp(row.created_at_ms),
      permission_boundary: permissionBoundary,
      supervision_policy: supervisionPolicy,
      result_contract: resultContract,
      budget: safeAssignmentBudget({
        max_steps: row.max_steps,
        max_tool_calls: row.max_tool_calls,
        max_runtime_ms: row.max_runtime_ms,
        max_private_source_bytes: row.max_private_source_bytes,
      }),
    });
    if (assignment.assigned_by !== assignment.owner_id) fail('builder_agent_assignment_store_integrity_failed');
    const fields = freezeDeep({
      record_version: assignment.record_version,
      agent_id: assignment.agent_id,
      agent_version_id: assignment.agent_version_id,
      owner_id: assignment.owner_id,
      assigned_by: assignment.assigned_by,
      project_id: assignment.project_id,
      conversation_id: assignment.conversation_id,
      task_id: assignment.task_id,
      run_id: assignment.run_id,
      goal: assignment.goal,
      created_at_ms: assignment.created_at_ms,
      permission_boundary: assignment.permission_boundary,
      supervision_policy: assignment.supervision_policy,
      result_contract: assignment.result_contract,
      budget: assignment.budget,
    });
    if (assignment.assignment_id !== assignmentIdFor(assignment.definition_digest, fields)) {
      fail('builder_agent_assignment_store_integrity_failed');
    }
    try {
      sanitizeBuilderAgentAssignmentStatusRecord({
        assignment_status_id: assignmentStatusIdFor(assignment, {
          record_version: BUILDER_AGENT_ASSIGNMENT_STATUS_RECORD_VERSION,
          assignment_id: assignment.assignment_id,
          agent_id: assignment.agent_id,
          owner_id: assignment.owner_id,
          decided_by: assignment.owner_id,
          next_status: 'queued',
          reason: '',
          decided_at_ms: assignment.created_at_ms,
        }),
        definition_digest: assignment.definition_digest,
        record_version: BUILDER_AGENT_ASSIGNMENT_STATUS_RECORD_VERSION,
        assignment_id: assignment.assignment_id,
        agent_id: assignment.agent_id,
        owner_id: assignment.owner_id,
        decided_by: assignment.owner_id,
        next_status: 'queued',
        reason: '',
        decided_at_ms: assignment.created_at_ms,
      }, assignment);
    } catch {
      fail('builder_agent_assignment_store_integrity_failed');
    }
    return assignment;
  } catch (error) {
    if (error instanceof BuilderAgentAssignmentStoreError) {
      fail('builder_agent_assignment_store_integrity_failed');
    }
    throw error;
  }
}

function statusFromRow(row, assignment) {
  if (!row) return null;
  try {
    const status = freezeDeep({
      assignment_status_id: safeAssignmentStatusId(row.assignment_status_id),
      definition_digest: safeDigest(row.definition_digest),
      record_version: row.record_version,
      assignment_id: safeAssignmentId(row.assignment_id),
      agent_id: safeAgentId(row.agent_id),
      owner_id: safeOwnerId(row.owner_id),
      decided_by: safeOwnerId(row.decided_by),
      next_status: row.next_status,
      reason: safeText(row.reason, 0, 280),
      decided_at_ms: safeTimestamp(row.decided_at_ms),
    });
    const sanitized = sanitizeBuilderAgentAssignmentStatusRecord(status, assignment);
    const fields = freezeDeep({
      record_version: sanitized.record_version,
      assignment_id: sanitized.assignment_id,
      agent_id: sanitized.agent_id,
      owner_id: sanitized.owner_id,
      decided_by: sanitized.decided_by,
      next_status: sanitized.next_status,
      reason: sanitized.reason,
      decided_at_ms: sanitized.decided_at_ms,
    });
    if (sanitized.assignment_status_id !== assignmentStatusIdFor(assignment, fields)) {
      fail('builder_agent_assignment_store_integrity_failed');
    }
    return sanitized;
  } catch (error) {
    if (
      error instanceof BuilderAgentAssignmentStoreError
      || error instanceof BuilderAgentAssignmentContractError
    ) {
      fail('builder_agent_assignment_store_integrity_failed');
    }
    throw error;
  }
}

function loadAssignmentById(db, assignmentId) {
  return safeAssignmentFromRow(one(
    db,
    `SELECT assignment_id, definition_digest, record_version, agent_id,
      agent_version_id, owner_id, assigned_by, project_id, conversation_id,
      task_id, run_id, goal, created_at_ms, permission_boundary,
      supervision_policy, result_contract, max_steps, max_tool_calls,
      max_runtime_ms, max_private_source_bytes
      FROM agent_assignments WHERE assignment_id = ?`,
    [assignmentId],
  ));
}

function loadAssignmentByAgentRun(db, agentId, runId) {
  return safeAssignmentFromRow(one(
    db,
    `SELECT assignment_id, definition_digest, record_version, agent_id,
      agent_version_id, owner_id, assigned_by, project_id, conversation_id,
      task_id, run_id, goal, created_at_ms, permission_boundary,
      supervision_policy, result_contract, max_steps, max_tool_calls,
      max_runtime_ms, max_private_source_bytes
      FROM agent_assignments WHERE agent_id = ? AND run_id = ?`,
    [agentId, runId],
  ));
}

function loadStatusById(db, assignment, assignmentStatusId) {
  return statusFromRow(one(
    db,
    `SELECT assignment_id, assignment_status_id, definition_digest,
      record_version, agent_id, owner_id, decided_by, next_status, reason,
      decided_at_ms
      FROM agent_assignment_status
      WHERE assignment_id = ? AND assignment_status_id = ?`,
    [assignment.assignment_id, assignmentStatusId],
  ), assignment);
}

function readStatuses(db, assignment) {
  const rows = all(
    db,
    `SELECT assignment_id, assignment_status_id, definition_digest,
      record_version, agent_id, owner_id, decided_by, next_status, reason,
      decided_at_ms
      FROM agent_assignment_status
      WHERE assignment_id = ?
      ORDER BY decided_at_ms ASC, assignment_status_id ASC
      LIMIT ?`,
    [assignment.assignment_id, MAX_STATUS_RECORDS + 1],
  );
  if (rows.length > MAX_STATUS_RECORDS) fail('builder_agent_assignment_store_resource_exceeded');
  return freezeDeep(rows.map((row) => statusFromRow(row, assignment)));
}

function latestStatus(db, assignment) {
  return statusFromRow(one(
    db,
    `SELECT assignment_id, assignment_status_id, definition_digest,
      record_version, agent_id, owner_id, decided_by, next_status, reason,
      decided_at_ms
      FROM agent_assignment_status
      WHERE assignment_id = ?
      ORDER BY decided_at_ms DESC, assignment_status_id DESC
      LIMIT 1`,
    [assignment.assignment_id],
  ), assignment);
}

function sameFact(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function evidence(db, transaction) {
  return freezeDeep({
    database_id: DATABASE_ID,
    schema_version: BUILDER_AGENT_ASSIGNMENT_STORE_SCHEMA_VERSION,
    user_version: BUILDER_AGENT_ASSIGNMENT_STORE_USER_VERSION,
    schema_fingerprint_digest: sha256Canonical(collectSchemaFingerprint(db)),
    runtime_pragmas: runtimePragmas(db),
    transaction,
    assignment_authority: 'main_owned_agent_assignment_store',
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
    result_version: BUILDER_AGENT_ASSIGNMENT_STORE_RESULT_VERSION,
    operation,
    ...payload,
    assignment_evidence: evidence(db, operation),
  });
}

function sanitizeAssignmentRequest(value) {
  exactObject(value, RECORD_ASSIGNMENT_KEYS);
  try {
    const definition = sanitizeBuilderAgentDefinitionRecord(valueAt(value, 'definition'));
    const version = sanitizeBuilderAgentVersionRecord(valueAt(value, 'version'), definition);
    const assignment = sanitizeBuilderAgentAssignmentRecord(valueAt(value, 'assignment'), version, definition);
    if (assignment.created_at_ms < version.created_at_ms) {
      fail('builder_agent_assignment_store_invalid');
    }
    return freezeDeep({ definition, version, assignment });
  } catch (error) {
    if (
      error instanceof BuilderAgentDefinitionContractError
      || error instanceof BuilderAgentAssignmentContractError
    ) fail('builder_agent_assignment_store_invalid');
    throw error;
  }
}

function sanitizeStatusRequest(db, value) {
  exactObject(value, RECORD_STATUS_KEYS);
  const rawStatus = valueAt(value, 'status');
  if (!isPlainObject(rawStatus)) fail('builder_agent_assignment_store_invalid');
  const assignmentId = safeAssignmentId(valueAt(rawStatus, 'assignment_id'));
  const assignment = loadAssignmentById(db, assignmentId);
  if (assignment === null) fail('builder_agent_assignment_store_not_found');
  try {
    return {
      assignment,
      status: sanitizeBuilderAgentAssignmentStatusRecord(rawStatus, assignment),
    };
  } catch (error) {
    if (error instanceof BuilderAgentAssignmentContractError) {
      fail('builder_agent_assignment_store_invalid');
    }
    throw error;
  }
}

function insertAssignment(db, assignment) {
  run(db, `INSERT INTO agent_assignments (
    assignment_id, definition_digest, record_version, agent_id,
    agent_version_id, owner_id, assigned_by, project_id, conversation_id,
    task_id, run_id, goal, created_at_ms, permission_boundary,
    supervision_policy, result_contract, max_steps, max_tool_calls,
    max_runtime_ms, max_private_source_bytes, schema_version
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
    assignment.assignment_id,
    assignment.definition_digest,
    assignment.record_version,
    assignment.agent_id,
    assignment.agent_version_id,
    assignment.owner_id,
    assignment.assigned_by,
    assignment.project_id,
    assignment.conversation_id,
    assignment.task_id,
    assignment.run_id,
    assignment.goal,
    assignment.created_at_ms,
    assignment.permission_boundary,
    assignment.supervision_policy,
    assignment.result_contract,
    assignment.budget.max_steps,
    assignment.budget.max_tool_calls,
    assignment.budget.max_runtime_ms,
    assignment.budget.max_private_source_bytes,
    BUILDER_AGENT_ASSIGNMENT_STORE_SCHEMA_VERSION,
  ]);
}

function insertStatus(db, status) {
  run(db, `INSERT INTO agent_assignment_status (
    assignment_id, assignment_status_id, definition_digest, record_version,
    agent_id, owner_id, decided_by, next_status, reason, decided_at_ms,
    schema_version
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
    status.assignment_id,
    status.assignment_status_id,
    status.definition_digest,
    status.record_version,
    status.agent_id,
    status.owner_id,
    status.decided_by,
    status.next_status,
    status.reason,
    status.decided_at_ms,
    BUILDER_AGENT_ASSIGNMENT_STORE_SCHEMA_VERSION,
  ]);
}

function recordAssignment(db, rawRequest) {
  const { assignment } = sanitizeAssignmentRequest(rawRequest);
  db.exec('BEGIN IMMEDIATE');
  try {
    const existing = loadAssignmentById(db, assignment.assignment_id);
    if (existing !== null) {
      if (!sameFact(existing, assignment)) fail('builder_agent_assignment_store_conflict');
      db.exec('COMMIT');
      return storeResult(db, 'assignment_replayed', { assignment: existing });
    }
    const sameAgentRun = loadAssignmentByAgentRun(db, assignment.agent_id, assignment.run_id);
    if (sameAgentRun !== null) fail('builder_agent_assignment_store_conflict');
    insertAssignment(db, assignment);
    const readback = loadAssignmentById(db, assignment.assignment_id);
    if (readback === null || !sameFact(readback, assignment)) {
      fail('builder_agent_assignment_store_integrity_failed');
    }
    db.exec('COMMIT');
    return storeResult(db, 'assignment_recorded', { assignment: readback });
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* fixed failure below */ }
    throw error;
  }
}

function allowedStatusTransition(current, next) {
  if (current === null) return next === 'queued';
  if (current === 'queued') return next === 'active' || next === 'cancelled';
  if (current === 'active') return next === 'paused' || next === 'cancelled' || next === 'completed';
  if (current === 'paused') return next === 'active' || next === 'cancelled';
  return false;
}

function recordStatus(db, rawRequest) {
  const { assignment, status } = sanitizeStatusRequest(db, rawRequest);
  db.exec('BEGIN IMMEDIATE');
  try {
    const existing = loadStatusById(db, assignment, status.assignment_status_id);
    if (existing !== null) {
      if (!sameFact(existing, status)) fail('builder_agent_assignment_store_conflict');
      db.exec('COMMIT');
      return storeResult(db, 'status_replayed', { status: existing });
    }
    if (status.decided_at_ms < assignment.created_at_ms) {
      fail('builder_agent_assignment_store_invalid');
    }
    const previous = latestStatus(db, assignment);
    if (previous !== null && status.decided_at_ms < previous.decided_at_ms) {
      fail('builder_agent_assignment_store_invalid');
    }
    const currentStatus = previous === null ? null : previous.next_status;
    if (!allowedStatusTransition(currentStatus, status.next_status)) {
      fail('builder_agent_assignment_store_conflict');
    }
    insertStatus(db, status);
    const readback = loadStatusById(db, assignment, status.assignment_status_id);
    if (readback === null || !sameFact(readback, status)) {
      fail('builder_agent_assignment_store_integrity_failed');
    }
    db.exec('COMMIT');
    return storeResult(db, 'status_recorded', { status: readback });
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* fixed failure below */ }
    throw error;
  }
}

function readAssignment(db, rawRequest) {
  exactObject(rawRequest, READ_ASSIGNMENT_KEYS);
  const assignmentId = safeAssignmentId(valueAt(rawRequest, 'assignment_id'));
  const ownerId = safeOwnerId(valueAt(rawRequest, 'owner_id'));
  const assignment = loadAssignmentById(db, assignmentId);
  if (assignment === null || assignment.owner_id !== ownerId) {
    return freezeDeep({
      result_version: BUILDER_AGENT_ASSIGNMENT_STORE_READ_RESULT_VERSION,
      assignment_authority: 'main_owned_agent_assignment_store',
      status: 'absent',
      assignment_id: assignmentId,
      owner_id: ownerId,
      assignment: null,
      statuses: [],
      current_status: null,
      evidence: evidence(db, 'assignment_absent_read'),
    });
  }
  const statuses = readStatuses(db, assignment);
  const currentStatus = statuses.at(-1) ?? null;
  return freezeDeep({
    result_version: BUILDER_AGENT_ASSIGNMENT_STORE_READ_RESULT_VERSION,
    assignment_authority: 'main_owned_agent_assignment_store',
    status: 'ready',
    assignment_id: assignmentId,
    owner_id: ownerId,
    assignment,
    statuses,
    current_status: currentStatus === null ? null : currentStatus.next_status,
    evidence: evidence(db, 'assignment_ready_read'),
  });
}

function assignmentEntry(db, assignment) {
  const statuses = readStatuses(db, assignment);
  const currentStatus = statuses.at(-1) ?? null;
  return freezeDeep({
    assignment,
    statuses,
    current_status: currentStatus === null ? null : currentStatus.next_status,
  });
}

function listTaskAssignments(db, rawRequest) {
  exactObject(rawRequest, LIST_TASK_ASSIGNMENTS_KEYS);
  const ownerId = safeOwnerId(valueAt(rawRequest, 'owner_id'));
  const projectId = safeProjectId(valueAt(rawRequest, 'project_id'));
  const taskId = safeTaskId(valueAt(rawRequest, 'task_id'));
  const rows = all(
    db,
    `SELECT assignment_id, definition_digest, record_version, agent_id,
      agent_version_id, owner_id, assigned_by, project_id, conversation_id,
      task_id, run_id, goal, created_at_ms, permission_boundary,
      supervision_policy, result_contract, max_steps, max_tool_calls,
      max_runtime_ms, max_private_source_bytes
      FROM agent_assignments
      WHERE owner_id = ? AND project_id = ? AND task_id = ?
      ORDER BY created_at_ms ASC, assignment_id ASC
      LIMIT ?`,
    [ownerId, projectId, taskId, MAX_TASK_ASSIGNMENTS + 1],
  );
  if (rows.length > MAX_TASK_ASSIGNMENTS) fail('builder_agent_assignment_store_resource_exceeded');
  return freezeDeep({
    result_version: BUILDER_AGENT_ASSIGNMENT_STORE_READ_RESULT_VERSION,
    assignment_authority: 'main_owned_agent_assignment_store',
    status: 'ready',
    owner_id: ownerId,
    project_id: projectId,
    task_id: taskId,
    assignments: rows.map((row) => assignmentEntry(db, safeAssignmentFromRow(row))),
    evidence: evidence(db, 'task_assignments_read'),
  });
}

function ownErrorField(error, key) {
  if (!error || typeof error !== 'object' || utilTypes.isProxy(error)) return null;
  const descriptor = Object.getOwnPropertyDescriptor(error, key);
  return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : null;
}

function normalizeOperationError(error) {
  if (error instanceof BuilderAgentAssignmentStoreError) {
    return new BuilderAgentAssignmentStoreError(error.code);
  }
  if (
    error instanceof BuilderAgentAssignmentContractError
    || error instanceof BuilderAgentDefinitionContractError
  ) {
    return new BuilderAgentAssignmentStoreError('builder_agent_assignment_store_invalid');
  }
  const sqliteCode = ownErrorField(error, 'code');
  const sqliteErrstr = ownErrorField(error, 'errstr');
  const sqliteErrcode = ownErrorField(error, 'errcode');
  if (sqliteCode && /^SQLITE_CONSTRAINT/u.test(sqliteCode)) {
    return new BuilderAgentAssignmentStoreError('builder_agent_assignment_store_integrity_failed');
  }
  if (sqliteErrstr === 'constraint failed' || sqliteErrcode === 1555) {
    return new BuilderAgentAssignmentStoreError('builder_agent_assignment_store_integrity_failed');
  }
  if (sqliteCode && /^SQLITE_(CORRUPT|NOTADB|SCHEMA|INTERNAL|MISMATCH)/u.test(sqliteCode)) {
    return new BuilderAgentAssignmentStoreError('builder_agent_assignment_store_integrity_failed');
  }
  return new BuilderAgentAssignmentStoreError('builder_agent_assignment_store_unavailable');
}

function createBuilderAgentAssignmentStore(databasePath) {
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
    store_version: BUILDER_AGENT_ASSIGNMENT_STORE_VERSION,

    close(...rawArguments) {
      if (rawArguments.length !== 0) {
        throw new BuilderAgentAssignmentStoreError('builder_agent_assignment_store_invalid');
      }
      try { db.close(); } catch (error) { throw normalizeOperationError(error); }
    },

    record_assignment(rawRequest) {
      try { return recordAssignment(db, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },

    record_status(rawRequest) {
      try { return recordStatus(db, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },

    read_assignment(rawRequest) {
      try { return readAssignment(db, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },

    list_task_assignments(rawRequest) {
      try { return listTaskAssignments(db, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },
  });
}

module.exports = Object.freeze({
  BUILDER_AGENT_ASSIGNMENT_STORE_READ_RESULT_VERSION,
  BUILDER_AGENT_ASSIGNMENT_STORE_RESULT_VERSION,
  BUILDER_AGENT_ASSIGNMENT_STORE_SCHEMA_VERSION,
  BUILDER_AGENT_ASSIGNMENT_STORE_USER_VERSION,
  BUILDER_AGENT_ASSIGNMENT_STORE_VERSION,
  BuilderAgentAssignmentStoreError,
  createBuilderAgentAssignmentStore,
});
