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
  BUILDER_AGENT_GOAL_RECORD_VERSION,
  BUILDER_AGENT_GOAL_STATUS_RECORD_VERSION,
  BuilderAgentGoalContractError,
  sanitizeBuilderAgentGoalRecord,
  sanitizeBuilderAgentGoalStatusRecord,
} = require('./builder-agent-goal-contract.cjs');

const BUILDER_AGENT_GOAL_STORE_VERSION = 'builder-agent-goal-store.v1';
const BUILDER_AGENT_GOAL_STORE_RESULT_VERSION = 'builder-agent-goal-store-result.v1';
const BUILDER_AGENT_GOAL_STORE_READ_RESULT_VERSION = 'builder-agent-goal-store-read-result.v1';
const BUILDER_AGENT_GOAL_STORE_SCHEMA_VERSION = 'builder-agent-goal-store-schema.v1';
const BUILDER_AGENT_GOAL_STORE_USER_VERSION = 1;
const DATABASE_ID = 'builder-agent-goal-store.v1';
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const OWNER_ID_PATTERN = new RegExp(`^builder-user:${UUID_SOURCE}$`, 'u');
const AGENT_ID_PATTERN = new RegExp(`^builder-agent:${UUID_SOURCE}$`, 'u');
const AGENT_VERSION_ID_PATTERN = /^builder-agent-version:[0-9a-f]{64}$/u;
const PROJECT_ID_PATTERN = new RegExp(`^builder-project:${UUID_SOURCE}$`, 'u');
const CONVERSATION_ID_PATTERN = new RegExp(`^builder-conversation:${UUID_SOURCE}$`, 'u');
const TASK_ID_PATTERN = new RegExp(`^builder-task:${UUID_SOURCE}$`, 'u');
const GOAL_ID_PATTERN = /^builder-agent-goal:[0-9a-f]{64}$/u;
const GOAL_STATUS_ID_PATTERN = /^builder-agent-goal-status:[0-9a-f]{64}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const RECORD_GOAL_KEYS = Object.freeze(['definition', 'version', 'goal']);
const RECORD_STATUS_KEYS = Object.freeze(['status']);
const READ_GOAL_KEYS = Object.freeze(['goal_id', 'owner_id']);
const LIST_TASK_GOALS_KEYS = Object.freeze(['owner_id', 'project_id', 'task_id']);
const GOAL_LIFECYCLE = Object.freeze({
  goal: 'recorded_not_started',
  assignment: 'not_created_by_contract',
  run: 'not_created_by_contract',
  completion: 'requires_done_or_blocked_status_and_owner_review',
  source_materialization: 'not_performed_by_contract',
});
const GOAL_AUTHORITY = Object.freeze({
  record_authority: 'main_agent_goal_contract_v1',
  renderer_authority: 'not_present',
  model_dispatch: false,
  secret_access: 'not_present',
  source_read: 'not_performed_by_contract',
  source_write: 'not_performed_by_contract',
  tool_dispatch: 'not_performed_by_contract',
  process_run: 'not_performed_by_contract',
  revision_authority: 'not_present',
});
const STATUS_LIFECYCLE = Object.freeze({
  goal: 'verified_goal_record',
  status: 'owner_decision_recorded',
  assignment: 'not_created_by_contract',
  run: 'not_created_by_contract',
  completion: 'status_only_without_materialization',
});
const STATUS_AUTHORITY = Object.freeze({
  record_authority: 'main_agent_goal_status_contract_v1',
  goal_authority: 'main_agent_goal_contract_v1',
  renderer_authority: 'not_present',
  model_dispatch: false,
  source_write: 'not_performed_by_contract',
  tool_dispatch: 'not_performed_by_contract',
  process_run: 'not_performed_by_contract',
  revision_authority: 'not_present',
});
const MAX_TASK_GOALS = 64;
const MAX_STATUS_RECORDS = 512;
const CREATE_SCHEMA_SQL = Object.freeze([
  `CREATE TABLE agent_goals (
    goal_id TEXT NOT NULL PRIMARY KEY,
    definition_digest TEXT NOT NULL,
    record_version TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    agent_version_id TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    created_by TEXT NOT NULL,
    project_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    objective TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL,
    permission_boundary TEXT NOT NULL,
    supervision_policy TEXT NOT NULL,
    execution_contract TEXT NOT NULL,
    completion_contract TEXT NOT NULL,
    max_steps INTEGER NOT NULL,
    max_runs INTEGER NOT NULL,
    max_tool_calls INTEGER NOT NULL,
    max_runtime_ms INTEGER NOT NULL,
    max_private_source_bytes INTEGER NOT NULL,
    schema_version TEXT NOT NULL,
    UNIQUE (owner_id, project_id, task_id, agent_id),
    CHECK (schema_version = 'builder-agent-goal-store-schema.v1'),
    CHECK (record_version = 'builder-agent-goal-record.v1'),
    CHECK (created_at_ms >= 0),
    CHECK (created_by = owner_id),
    CHECK (permission_boundary = 'explicit_permission_required'),
    CHECK (supervision_policy = 'owner_supervised'),
    CHECK (execution_contract = 'continuous_until_done_or_blocked'),
    CHECK (completion_contract = 'owner_review_required_before_done'),
    CHECK (max_steps BETWEEN 1 AND 512),
    CHECK (max_runs BETWEEN 1 AND 64),
    CHECK (max_tool_calls BETWEEN 0 AND 1024),
    CHECK (max_runtime_ms BETWEEN 1000 AND 604800000),
    CHECK (max_private_source_bytes BETWEEN 0 AND 8388608)
  ) STRICT`,
  `CREATE TABLE agent_goal_status (
    goal_id TEXT NOT NULL,
    goal_status_id TEXT NOT NULL,
    definition_digest TEXT NOT NULL,
    record_version TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    decided_by TEXT NOT NULL,
    next_status TEXT NOT NULL,
    reason TEXT NOT NULL,
    decided_at_ms INTEGER NOT NULL,
    schema_version TEXT NOT NULL,
    PRIMARY KEY (goal_id, goal_status_id),
    CHECK (schema_version = 'builder-agent-goal-store-schema.v1'),
    CHECK (record_version = 'builder-agent-goal-status-record.v1'),
    CHECK (next_status IN ('proposed', 'active', 'paused', 'blocked', 'completed', 'cancelled')),
    CHECK (decided_at_ms >= 0),
    CHECK (decided_by = owner_id),
    FOREIGN KEY (goal_id)
      REFERENCES agent_goals(goal_id)
      ON DELETE RESTRICT ON UPDATE RESTRICT
  ) STRICT`,
  'CREATE INDEX agent_goals_owner_task_idx ON agent_goals(owner_id, project_id, task_id, created_at_ms, goal_id)',
  'CREATE INDEX agent_goals_agent_task_idx ON agent_goals(agent_id, task_id)',
  'CREATE INDEX agent_goal_status_lookup_idx ON agent_goal_status(goal_id, decided_at_ms, goal_status_id)',
]);
const ERROR_MESSAGES = Object.freeze({
  builder_agent_goal_store_invalid: 'Builder agent goals could not be verified.',
  builder_agent_goal_store_not_found: 'Builder agent goal is unavailable.',
  builder_agent_goal_store_conflict: 'Builder agent goals changed before they could be recorded.',
  builder_agent_goal_store_integrity_failed: 'Builder agent goal integrity could not be verified.',
  builder_agent_goal_store_resource_exceeded: 'Builder agent goal limits were reached.',
  builder_agent_goal_store_unavailable: 'Builder agent goal storage is unavailable.',
});

class BuilderAgentGoalStoreError extends Error {
  constructor(code = 'builder_agent_goal_store_invalid') {
    const selected = Object.hasOwn(ERROR_MESSAGES, code)
      ? code
      : 'builder_agent_goal_store_invalid';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderAgentGoalStoreError';
    this.code = selected;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) {
  throw new BuilderAgentGoalStoreError(code);
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
  if (!isPlainObject(value)) fail('builder_agent_goal_store_invalid');
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== keys.length
    || actual.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) fail('builder_agent_goal_store_invalid');
  for (const key of actual) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      fail('builder_agent_goal_store_invalid');
    }
  }
}

function valueAt(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
    fail('builder_agent_goal_store_invalid');
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
  fail('builder_agent_goal_store_invalid');
}

function sha256Canonical(value) {
  return nodeCrypto.createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

function safePattern(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) {
    fail('builder_agent_goal_store_invalid');
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

function safeGoalId(value) {
  return safePattern(value, GOAL_ID_PATTERN);
}

function safeGoalStatusId(value) {
  return safePattern(value, GOAL_STATUS_ID_PATTERN);
}

function safeDigest(value) {
  return safePattern(value, DIGEST_PATTERN);
}

function safeTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail('builder_agent_goal_store_invalid');
  return value;
}

function safeIntegerRange(value, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    fail('builder_agent_goal_store_invalid');
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
  ) fail('builder_agent_goal_store_invalid');
  return value;
}

function safeGoalBudget(value) {
  return freezeDeep({
    max_steps: safeIntegerRange(value.max_steps, 1, 512),
    max_runs: safeIntegerRange(value.max_runs, 1, 64),
    max_tool_calls: safeIntegerRange(value.max_tool_calls, 0, 1_024),
    max_runtime_ms: safeIntegerRange(value.max_runtime_ms, 1_000, 604_800_000),
    max_private_source_bytes: safeIntegerRange(value.max_private_source_bytes, 0, 8 * 1_024 * 1_024),
  });
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
  ) fail('builder_agent_goal_store_invalid');
  return value;
}

function assertParentDirectory(filePath) {
  let info;
  try {
    info = fs.lstatSync(path.dirname(filePath));
  } catch {
    fail('builder_agent_goal_store_unavailable');
  }
  if (!info.isDirectory() || info.isSymbolicLink()) {
    fail('builder_agent_goal_store_unavailable');
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
    fail('builder_agent_goal_store_integrity_failed');
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
  if (mode !== 'wal') fail('builder_agent_goal_store_unavailable');
  const pragmas = runtimePragmas(db);
  if (
    pragmas.foreign_keys !== 'on'
    || pragmas.trusted_schema !== 'off'
    || pragmas.synchronous !== 'full'
    || pragmas.journal_mode !== 'wal'
  ) fail('builder_agent_goal_store_unavailable');
}

function createSchema(db) {
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const sql of CREATE_SCHEMA_SQL) db.exec(sql);
    db.exec(`PRAGMA user_version = ${BUILDER_AGENT_GOAL_STORE_USER_VERSION}`);
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
    expectedDb.exec(`PRAGMA user_version = ${BUILDER_AGENT_GOAL_STORE_USER_VERSION}`);
    expectedSchemaFingerprint = canonicalJson(collectSchemaFingerprint(expectedDb));
    return expectedSchemaFingerprint;
  } finally {
    expectedDb.close();
  }
}

function validateSchema(db) {
  const actual = collectSchemaFingerprint(db);
  if (actual.foreign_key_check.length !== 0) fail('builder_agent_goal_store_integrity_failed');
  if (canonicalJson(actual) !== expectedFingerprint()) {
    fail('builder_agent_goal_store_integrity_failed');
  }
}

function initialize(db) {
  configurePragmas(db);
  const version = userVersion(db);
  if (version === 0) createSchema(db);
  else if (version !== BUILDER_AGENT_GOAL_STORE_USER_VERSION) {
    fail('builder_agent_goal_store_integrity_failed');
  }
  validateSchema(db);
}

function goalIdFor(definitionDigest, fields) {
  return `builder-agent-goal:${sha256Canonical({
    agent_goal_identity: BUILDER_AGENT_GOAL_RECORD_VERSION,
    definition_digest: definitionDigest,
    fields,
  })}`;
}

function goalStatusIdFor(goal, fields) {
  return `builder-agent-goal-status:${sha256Canonical({
    agent_goal_status_identity: BUILDER_AGENT_GOAL_STATUS_RECORD_VERSION,
    goal_id: goal.goal_id,
    definition_digest: goal.definition_digest,
    fields,
  })}`;
}

function goalRecordForContract(goal) {
  return freezeDeep({
    ...goal,
    lifecycle: GOAL_LIFECYCLE,
    authority: GOAL_AUTHORITY,
  });
}

function goalStatusRecordForContract(status) {
  return freezeDeep({
    ...status,
    lifecycle: STATUS_LIFECYCLE,
    authority: STATUS_AUTHORITY,
  });
}

function safeGoalFromRow(row) {
  if (!row) return null;
  try {
    const goal = freezeDeep({
      goal_id: safeGoalId(row.goal_id),
      definition_digest: safeDigest(row.definition_digest),
      record_version: row.record_version,
      agent_id: safeAgentId(row.agent_id),
      agent_version_id: safeAgentVersionId(row.agent_version_id),
      owner_id: safeOwnerId(row.owner_id),
      created_by: safeOwnerId(row.created_by),
      project_id: safeProjectId(row.project_id),
      conversation_id: safeConversationId(row.conversation_id),
      task_id: safeTaskId(row.task_id),
      objective: safeText(row.objective, 1, 2_000),
      created_at_ms: safeTimestamp(row.created_at_ms),
      permission_boundary: row.permission_boundary,
      supervision_policy: row.supervision_policy,
      execution_contract: row.execution_contract,
      completion_contract: row.completion_contract,
      budget: safeGoalBudget({
        max_steps: row.max_steps,
        max_runs: row.max_runs,
        max_tool_calls: row.max_tool_calls,
        max_runtime_ms: row.max_runtime_ms,
        max_private_source_bytes: row.max_private_source_bytes,
      }),
    });
    if (
      goal.record_version !== BUILDER_AGENT_GOAL_RECORD_VERSION
      || goal.created_by !== goal.owner_id
      || goal.permission_boundary !== 'explicit_permission_required'
      || goal.supervision_policy !== 'owner_supervised'
      || goal.execution_contract !== 'continuous_until_done_or_blocked'
      || goal.completion_contract !== 'owner_review_required_before_done'
    ) fail('builder_agent_goal_store_integrity_failed');
    const fields = freezeDeep({
      record_version: goal.record_version,
      agent_id: goal.agent_id,
      agent_version_id: goal.agent_version_id,
      owner_id: goal.owner_id,
      created_by: goal.created_by,
      project_id: goal.project_id,
      conversation_id: goal.conversation_id,
      task_id: goal.task_id,
      objective: goal.objective,
      created_at_ms: goal.created_at_ms,
      permission_boundary: goal.permission_boundary,
      supervision_policy: goal.supervision_policy,
      execution_contract: goal.execution_contract,
      completion_contract: goal.completion_contract,
      budget: goal.budget,
    });
    if (goal.goal_id !== goalIdFor(goal.definition_digest, fields)) {
      fail('builder_agent_goal_store_integrity_failed');
    }
    return goalRecordForContract(goal);
  } catch (error) {
    if (error instanceof BuilderAgentGoalStoreError) {
      fail('builder_agent_goal_store_integrity_failed');
    }
    throw error;
  }
}

function statusFromRow(row, goal) {
  if (!row) return null;
  try {
    const status = freezeDeep({
      goal_status_id: safeGoalStatusId(row.goal_status_id),
      definition_digest: safeDigest(row.definition_digest),
      record_version: row.record_version,
      goal_id: safeGoalId(row.goal_id),
      agent_id: safeAgentId(row.agent_id),
      owner_id: safeOwnerId(row.owner_id),
      decided_by: safeOwnerId(row.decided_by),
      next_status: row.next_status,
      reason: safeText(row.reason, 0, 280),
      decided_at_ms: safeTimestamp(row.decided_at_ms),
    });
    const sanitized = sanitizeBuilderAgentGoalStatusRecord(goalStatusRecordForContract(status), goal);
    const fields = freezeDeep({
      record_version: sanitized.record_version,
      goal_id: sanitized.goal_id,
      agent_id: sanitized.agent_id,
      owner_id: sanitized.owner_id,
      decided_by: sanitized.decided_by,
      next_status: sanitized.next_status,
      reason: sanitized.reason,
      decided_at_ms: sanitized.decided_at_ms,
    });
    if (sanitized.goal_status_id !== goalStatusIdFor(goal, fields)) {
      fail('builder_agent_goal_store_integrity_failed');
    }
    return sanitized;
  } catch (error) {
    if (
      error instanceof BuilderAgentGoalStoreError
      || error instanceof BuilderAgentGoalContractError
    ) fail('builder_agent_goal_store_integrity_failed');
    throw error;
  }
}

function loadGoalById(db, goalId) {
  return safeGoalFromRow(one(
    db,
    `SELECT goal_id, definition_digest, record_version, agent_id,
      agent_version_id, owner_id, created_by, project_id, conversation_id,
      task_id, objective, created_at_ms, permission_boundary,
      supervision_policy, execution_contract, completion_contract, max_steps,
      max_runs, max_tool_calls, max_runtime_ms, max_private_source_bytes
      FROM agent_goals WHERE goal_id = ?`,
    [goalId],
  ));
}

function loadGoalByAgentTask(db, goal) {
  return safeGoalFromRow(one(
    db,
    `SELECT goal_id, definition_digest, record_version, agent_id,
      agent_version_id, owner_id, created_by, project_id, conversation_id,
      task_id, objective, created_at_ms, permission_boundary,
      supervision_policy, execution_contract, completion_contract, max_steps,
      max_runs, max_tool_calls, max_runtime_ms, max_private_source_bytes
      FROM agent_goals
      WHERE owner_id = ? AND project_id = ? AND task_id = ? AND agent_id = ?`,
    [goal.owner_id, goal.project_id, goal.task_id, goal.agent_id],
  ));
}

function loadStatusById(db, goal, statusId) {
  return statusFromRow(one(
    db,
    `SELECT goal_id, goal_status_id, definition_digest, record_version,
      agent_id, owner_id, decided_by, next_status, reason, decided_at_ms
      FROM agent_goal_status
      WHERE goal_id = ? AND goal_status_id = ?`,
    [goal.goal_id, statusId],
  ), goal);
}

function readStatuses(db, goal) {
  const rows = all(
    db,
    `SELECT goal_id, goal_status_id, definition_digest, record_version,
      agent_id, owner_id, decided_by, next_status, reason, decided_at_ms
      FROM agent_goal_status
      WHERE goal_id = ?
      ORDER BY decided_at_ms ASC, goal_status_id ASC
      LIMIT ?`,
    [goal.goal_id, MAX_STATUS_RECORDS + 1],
  );
  if (rows.length > MAX_STATUS_RECORDS) fail('builder_agent_goal_store_resource_exceeded');
  return freezeDeep(rows.map((row) => statusFromRow(row, goal)));
}

function latestStatus(db, goal) {
  return statusFromRow(one(
    db,
    `SELECT goal_id, goal_status_id, definition_digest, record_version,
      agent_id, owner_id, decided_by, next_status, reason, decided_at_ms
      FROM agent_goal_status
      WHERE goal_id = ?
      ORDER BY decided_at_ms DESC, goal_status_id DESC
      LIMIT 1`,
    [goal.goal_id],
  ), goal);
}

function sameFact(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function evidence(db, transaction) {
  return freezeDeep({
    database_id: DATABASE_ID,
    schema_version: BUILDER_AGENT_GOAL_STORE_SCHEMA_VERSION,
    user_version: BUILDER_AGENT_GOAL_STORE_USER_VERSION,
    schema_fingerprint_digest: sha256Canonical(collectSchemaFingerprint(db)),
    runtime_pragmas: runtimePragmas(db),
    transaction,
    goal_authority: 'main_owned_agent_goal_store',
    renderer_authority: 'not_present',
    ipc_authority: 'not_present',
    provider_dispatch: false,
    tool_dispatch: false,
    assignment_authority: false,
    run_authority: false,
    permission_grant_authority: false,
    credential_storage: 'not_present',
    source_access: 'not_present',
    revision_authority: false,
    review_authority: false,
  });
}

function storeResult(db, operation, payload) {
  return freezeDeep({
    result_version: BUILDER_AGENT_GOAL_STORE_RESULT_VERSION,
    operation,
    ...payload,
    goal_evidence: evidence(db, operation),
  });
}

function sanitizeGoalRequest(value) {
  exactObject(value, RECORD_GOAL_KEYS);
  try {
    const definition = sanitizeBuilderAgentDefinitionRecord(valueAt(value, 'definition'));
    const version = sanitizeBuilderAgentVersionRecord(valueAt(value, 'version'), definition);
    const goal = sanitizeBuilderAgentGoalRecord(valueAt(value, 'goal'), version, definition);
    if (goal.created_at_ms < version.created_at_ms) {
      fail('builder_agent_goal_store_invalid');
    }
    return freezeDeep({ definition, version, goal });
  } catch (error) {
    if (
      error instanceof BuilderAgentDefinitionContractError
      || error instanceof BuilderAgentGoalContractError
    ) fail('builder_agent_goal_store_invalid');
    throw error;
  }
}

function sanitizeStatusRequest(db, value) {
  exactObject(value, RECORD_STATUS_KEYS);
  const rawStatus = valueAt(value, 'status');
  if (!isPlainObject(rawStatus)) fail('builder_agent_goal_store_invalid');
  const goalId = safeGoalId(valueAt(rawStatus, 'goal_id'));
  const goal = loadGoalById(db, goalId);
  if (goal === null) fail('builder_agent_goal_store_not_found');
  try {
    return {
      goal,
      status: sanitizeBuilderAgentGoalStatusRecord(rawStatus, goal),
    };
  } catch (error) {
    if (error instanceof BuilderAgentGoalContractError) {
      fail('builder_agent_goal_store_invalid');
    }
    throw error;
  }
}

function insertGoal(db, goal) {
  run(db, `INSERT INTO agent_goals (
    goal_id, definition_digest, record_version, agent_id,
    agent_version_id, owner_id, created_by, project_id, conversation_id,
    task_id, objective, created_at_ms, permission_boundary,
    supervision_policy, execution_contract, completion_contract, max_steps,
    max_runs, max_tool_calls, max_runtime_ms, max_private_source_bytes,
    schema_version
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
    goal.goal_id,
    goal.definition_digest,
    goal.record_version,
    goal.agent_id,
    goal.agent_version_id,
    goal.owner_id,
    goal.created_by,
    goal.project_id,
    goal.conversation_id,
    goal.task_id,
    goal.objective,
    goal.created_at_ms,
    goal.permission_boundary,
    goal.supervision_policy,
    goal.execution_contract,
    goal.completion_contract,
    goal.budget.max_steps,
    goal.budget.max_runs,
    goal.budget.max_tool_calls,
    goal.budget.max_runtime_ms,
    goal.budget.max_private_source_bytes,
    BUILDER_AGENT_GOAL_STORE_SCHEMA_VERSION,
  ]);
}

function insertStatus(db, status) {
  run(db, `INSERT INTO agent_goal_status (
    goal_id, goal_status_id, definition_digest, record_version,
    agent_id, owner_id, decided_by, next_status, reason, decided_at_ms,
    schema_version
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
    status.goal_id,
    status.goal_status_id,
    status.definition_digest,
    status.record_version,
    status.agent_id,
    status.owner_id,
    status.decided_by,
    status.next_status,
    status.reason,
    status.decided_at_ms,
    BUILDER_AGENT_GOAL_STORE_SCHEMA_VERSION,
  ]);
}

function recordGoal(db, rawRequest) {
  const { goal } = sanitizeGoalRequest(rawRequest);
  db.exec('BEGIN IMMEDIATE');
  try {
    const existing = loadGoalById(db, goal.goal_id);
    if (existing !== null) {
      if (!sameFact(existing, goal)) fail('builder_agent_goal_store_conflict');
      db.exec('COMMIT');
      return storeResult(db, 'goal_replayed', { goal: existing });
    }
    const sameAgentTask = loadGoalByAgentTask(db, goal);
    if (sameAgentTask !== null) fail('builder_agent_goal_store_conflict');
    insertGoal(db, goal);
    const readback = loadGoalById(db, goal.goal_id);
    if (readback === null || !sameFact(readback, goal)) {
      fail('builder_agent_goal_store_integrity_failed');
    }
    db.exec('COMMIT');
    return storeResult(db, 'goal_recorded', { goal: readback });
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* fixed failure below */ }
    throw error;
  }
}

function allowedStatusTransition(current, next) {
  if (current === null) return next === 'proposed' || next === 'active';
  if (current === 'proposed') return next === 'active' || next === 'cancelled';
  if (current === 'active') return next === 'paused' || next === 'blocked' || next === 'completed' || next === 'cancelled';
  if (current === 'paused') return next === 'active' || next === 'cancelled';
  if (current === 'blocked') return next === 'active' || next === 'cancelled';
  return false;
}

function recordStatus(db, rawRequest) {
  const { goal, status } = sanitizeStatusRequest(db, rawRequest);
  db.exec('BEGIN IMMEDIATE');
  try {
    const existing = loadStatusById(db, goal, status.goal_status_id);
    if (existing !== null) {
      if (!sameFact(existing, status)) fail('builder_agent_goal_store_conflict');
      db.exec('COMMIT');
      return storeResult(db, 'status_replayed', { status: existing });
    }
    if (status.decided_at_ms < goal.created_at_ms) {
      fail('builder_agent_goal_store_invalid');
    }
    const previous = latestStatus(db, goal);
    if (previous !== null && status.decided_at_ms < previous.decided_at_ms) {
      fail('builder_agent_goal_store_invalid');
    }
    const currentStatus = previous === null ? null : previous.next_status;
    if (!allowedStatusTransition(currentStatus, status.next_status)) {
      fail('builder_agent_goal_store_conflict');
    }
    insertStatus(db, status);
    const readback = loadStatusById(db, goal, status.goal_status_id);
    if (readback === null || !sameFact(readback, status)) {
      fail('builder_agent_goal_store_integrity_failed');
    }
    db.exec('COMMIT');
    return storeResult(db, 'status_recorded', { status: readback });
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* fixed failure below */ }
    throw error;
  }
}

function readGoal(db, rawRequest) {
  exactObject(rawRequest, READ_GOAL_KEYS);
  const goalId = safeGoalId(valueAt(rawRequest, 'goal_id'));
  const ownerId = safeOwnerId(valueAt(rawRequest, 'owner_id'));
  const goal = loadGoalById(db, goalId);
  if (goal === null || goal.owner_id !== ownerId) {
    return freezeDeep({
      result_version: BUILDER_AGENT_GOAL_STORE_READ_RESULT_VERSION,
      goal_authority: 'main_owned_agent_goal_store',
      status: 'absent',
      goal_id: goalId,
      owner_id: ownerId,
      goal: null,
      statuses: [],
      current_status: null,
      evidence: evidence(db, 'goal_absent_read'),
    });
  }
  const statuses = readStatuses(db, goal);
  const currentStatus = statuses.at(-1) ?? null;
  return freezeDeep({
    result_version: BUILDER_AGENT_GOAL_STORE_READ_RESULT_VERSION,
    goal_authority: 'main_owned_agent_goal_store',
    status: 'ready',
    goal_id: goalId,
    owner_id: ownerId,
    goal,
    statuses,
    current_status: currentStatus === null ? null : currentStatus.next_status,
    evidence: evidence(db, 'goal_ready_read'),
  });
}

function goalEntry(db, goal) {
  const statuses = readStatuses(db, goal);
  const currentStatus = statuses.at(-1) ?? null;
  return freezeDeep({
    goal,
    statuses,
    current_status: currentStatus === null ? null : currentStatus.next_status,
  });
}

function listTaskGoals(db, rawRequest) {
  exactObject(rawRequest, LIST_TASK_GOALS_KEYS);
  const ownerId = safeOwnerId(valueAt(rawRequest, 'owner_id'));
  const projectId = safeProjectId(valueAt(rawRequest, 'project_id'));
  const taskId = safeTaskId(valueAt(rawRequest, 'task_id'));
  const rows = all(
    db,
    `SELECT goal_id, definition_digest, record_version, agent_id,
      agent_version_id, owner_id, created_by, project_id, conversation_id,
      task_id, objective, created_at_ms, permission_boundary,
      supervision_policy, execution_contract, completion_contract, max_steps,
      max_runs, max_tool_calls, max_runtime_ms, max_private_source_bytes
      FROM agent_goals
      WHERE owner_id = ? AND project_id = ? AND task_id = ?
      ORDER BY created_at_ms ASC, goal_id ASC
      LIMIT ?`,
    [ownerId, projectId, taskId, MAX_TASK_GOALS + 1],
  );
  if (rows.length > MAX_TASK_GOALS) fail('builder_agent_goal_store_resource_exceeded');
  return freezeDeep({
    result_version: BUILDER_AGENT_GOAL_STORE_READ_RESULT_VERSION,
    goal_authority: 'main_owned_agent_goal_store',
    status: 'ready',
    owner_id: ownerId,
    project_id: projectId,
    task_id: taskId,
    goals: rows.map((row) => goalEntry(db, safeGoalFromRow(row))),
    evidence: evidence(db, 'task_goals_read'),
  });
}

function ownErrorField(error, key) {
  if (!error || typeof error !== 'object' || utilTypes.isProxy(error)) return null;
  const descriptor = Object.getOwnPropertyDescriptor(error, key);
  return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : null;
}

function normalizeOperationError(error) {
  if (error instanceof BuilderAgentGoalStoreError) {
    return new BuilderAgentGoalStoreError(error.code);
  }
  if (
    error instanceof BuilderAgentGoalContractError
    || error instanceof BuilderAgentDefinitionContractError
  ) {
    return new BuilderAgentGoalStoreError('builder_agent_goal_store_invalid');
  }
  const sqliteCode = ownErrorField(error, 'code');
  const sqliteErrstr = ownErrorField(error, 'errstr');
  const sqliteErrcode = ownErrorField(error, 'errcode');
  if (sqliteCode && /^SQLITE_CONSTRAINT/u.test(sqliteCode)) {
    return new BuilderAgentGoalStoreError('builder_agent_goal_store_integrity_failed');
  }
  if (sqliteErrstr === 'constraint failed' || sqliteErrcode === 1555) {
    return new BuilderAgentGoalStoreError('builder_agent_goal_store_integrity_failed');
  }
  if (sqliteCode && /^SQLITE_(CORRUPT|NOTADB|SCHEMA|INTERNAL|MISMATCH)/u.test(sqliteCode)) {
    return new BuilderAgentGoalStoreError('builder_agent_goal_store_integrity_failed');
  }
  return new BuilderAgentGoalStoreError('builder_agent_goal_store_unavailable');
}

function createBuilderAgentGoalStore(databasePath) {
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
    store_version: BUILDER_AGENT_GOAL_STORE_VERSION,

    close(...rawArguments) {
      if (rawArguments.length !== 0) {
        throw new BuilderAgentGoalStoreError('builder_agent_goal_store_invalid');
      }
      try { db.close(); } catch (error) { throw normalizeOperationError(error); }
    },

    record_goal(rawRequest) {
      try { return recordGoal(db, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },

    record_status(rawRequest) {
      try { return recordStatus(db, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },

    read_goal(rawRequest) {
      try { return readGoal(db, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },

    list_task_goals(rawRequest) {
      try { return listTaskGoals(db, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },
  });
}

module.exports = Object.freeze({
  BUILDER_AGENT_GOAL_STORE_READ_RESULT_VERSION,
  BUILDER_AGENT_GOAL_STORE_RESULT_VERSION,
  BUILDER_AGENT_GOAL_STORE_SCHEMA_VERSION,
  BUILDER_AGENT_GOAL_STORE_USER_VERSION,
  BUILDER_AGENT_GOAL_STORE_VERSION,
  BuilderAgentGoalStoreError,
  createBuilderAgentGoalStore,
});
