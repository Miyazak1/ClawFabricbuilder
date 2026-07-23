'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const {
  BuilderGitReceiptContractError,
} = require('./builder-git-receipt-contract.cjs');
const {
  BUILDER_PRODUCT_METADATA_RESULT_VERSION,
  BUILDER_PRODUCT_METADATA_SCHEMA_VERSION,
  BUILDER_PRODUCT_METADATA_USER_VERSION,
  CREATE_SCHEMA_SQL,
  BuilderProductMetadataSchemaError,
  canonicalJson,
  createRevisionReceipt,
  sha256Canonical,
  sanitizeLoadCurrentRequest,
  sanitizeReceiptRow,
  sanitizeRecordProjectRevisionRequest,
} = require('./builder-product-metadata-schema.cjs');

const DATABASE_ID = 'builder-product-metadata-database.v1';
const MAX_REVISION_CHAIN_DEPTH = 1024;
const ERROR_MESSAGES = Object.freeze({
  builder_product_metadata_invalid: 'Builder product metadata could not be verified.',
  builder_product_metadata_not_found: 'Builder product metadata is unavailable.',
  builder_product_metadata_conflict: 'Builder product metadata changed before it could be saved.',
  builder_product_metadata_idempotency_conflict: 'Builder product metadata idempotency could not be verified.',
  builder_product_metadata_integrity_failed: 'Builder product metadata integrity could not be verified.',
  builder_product_metadata_resource_exceeded: 'Builder product metadata limits were reached.',
  builder_product_metadata_unavailable: 'Builder product metadata storage is unavailable.',
});

class BuilderProductMetadataDatabaseError extends Error {
  constructor(code = 'builder_product_metadata_invalid') {
    const selected = Object.hasOwn(ERROR_MESSAGES, code)
      ? code
      : 'builder_product_metadata_invalid';
    super(ERROR_MESSAGES[selected]);
    this.name = 'BuilderProductMetadataDatabaseError';
    this.code = selected;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) {
  throw new BuilderProductMetadataDatabaseError(code);
}

function frozen(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) frozen(nested);
    Object.freeze(value);
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

function safeDatabasePath(value) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > 1024
    || value.trim() !== value
    || hasControlCharacter(value)
    || !path.isAbsolute(value)
    || path.resolve(value) !== value
  ) fail('builder_product_metadata_invalid');
  return value;
}

function assertParentDirectory(filePath) {
  let info;
  try {
    info = fs.lstatSync(path.dirname(filePath));
  } catch {
    fail('builder_product_metadata_unavailable');
  }
  if (!info.isDirectory() || info.isSymbolicLink()) {
    fail('builder_product_metadata_unavailable');
  }
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function one(db, sql, params = []) {
  return db.prepare(sql).get(...params);
}

function run(db, sql, params = []) {
  return db.prepare(sql).run(...params);
}

function all(db, sql, params = []) {
  return db.prepare(sql).all(...params);
}

function userVersion(db) {
  const row = one(db, 'PRAGMA user_version');
  if (!row || !Number.isSafeInteger(row.user_version)) {
    fail('builder_product_metadata_integrity_failed');
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
  if (mode !== 'wal') fail('builder_product_metadata_unavailable');
  const pragmas = runtimePragmas(db);
  if (
    pragmas.foreign_keys !== 'on'
    || pragmas.trusted_schema !== 'off'
    || pragmas.synchronous !== 'full'
    || pragmas.journal_mode !== 'wal'
  ) fail('builder_product_metadata_unavailable');
}

function createSchema(db) {
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const sql of CREATE_SCHEMA_SQL) db.exec(sql);
    db.exec(`PRAGMA user_version = ${BUILDER_PRODUCT_METADATA_USER_VERSION}`);
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
    expectedDb.exec(`PRAGMA user_version = ${BUILDER_PRODUCT_METADATA_USER_VERSION}`);
    expectedSchemaFingerprint = canonicalJson(collectSchemaFingerprint(expectedDb));
    return expectedSchemaFingerprint;
  } finally {
    expectedDb.close();
  }
}

function validateSchema(db) {
  const actual = collectSchemaFingerprint(db);
  if (actual.foreign_key_check.length !== 0) fail('builder_product_metadata_integrity_failed');
  if (canonicalJson(actual) !== expectedFingerprint()) fail('builder_product_metadata_integrity_failed');
}

function initialize(db) {
  configurePragmas(db);
  const version = userVersion(db);
  if (version === 0) createSchema(db);
  else if (version !== BUILDER_PRODUCT_METADATA_USER_VERSION) {
    fail('builder_product_metadata_integrity_failed');
  }
  validateSchema(db);
}

function sameRow(row, expected) {
  for (const [key, value] of Object.entries(expected)) {
    if (row[key] !== value) return false;
  }
  return true;
}

function projectRow(db, projectId) {
  return one(db, 'SELECT * FROM projects WHERE project_id = ?', [projectId]);
}

function verifyProjectRow(db, row, project, fullChain) {
  if (!row || row.project_created_at_ms !== project.created_at_ms
    || row.metadata_schema_version !== BUILDER_PRODUCT_METADATA_SCHEMA_VERSION
    || !Number.isSafeInteger(row.current_revision_number)
    || ((row.current_revision_receipt_digest === null) !== (row.current_revision_number === 0))) {
    fail('builder_product_metadata_integrity_failed');
  }
  return validateProjectCurrentTuple(db, row, true, fullChain);
}

function ensureProject(db, project) {
  run(db, `INSERT INTO projects (
    project_id, project_created_at_ms, current_revision_receipt_digest,
    current_revision_number, metadata_schema_version
  ) VALUES (?, ?, NULL, 0, ?)`, [
    project.project_id,
    project.created_at_ms,
    BUILDER_PRODUCT_METADATA_SCHEMA_VERSION,
  ]);
  const row = projectRow(db, project.project_id);
  verifyProjectRow(db, row, project, false);
  return row;
}

function ensureConversation(db, conversation) {
  run(db, `INSERT OR IGNORE INTO conversations (
    project_id, conversation_id, created_at_ms
  ) VALUES (?, ?, ?)`, [
    conversation.project_id,
    conversation.conversation_id,
    conversation.created_at_ms,
  ]);
  const row = one(
    db,
    'SELECT * FROM conversations WHERE project_id = ? AND conversation_id = ?',
    [conversation.project_id, conversation.conversation_id],
  );
  if (!row || !sameRow(row, conversation)) fail('builder_product_metadata_integrity_failed');
}

function ensureTask(db, task) {
  run(db, `INSERT OR IGNORE INTO tasks (
    project_id, conversation_id, task_id, title, base_commit_oid, created_at_ms
  ) VALUES (?, ?, ?, ?, ?, ?)`, [
    task.project_id,
    task.conversation_id,
    task.task_id,
    task.title,
    task.base_commit_oid,
    task.created_at_ms,
  ]);
  const row = one(
    db,
    'SELECT * FROM tasks WHERE project_id = ? AND task_id = ?',
    [task.project_id, task.task_id],
  );
  if (!row || !sameRow(row, task)) fail('builder_product_metadata_integrity_failed');
}

function ensureRun(db, runRecord) {
  run(db, `INSERT OR IGNORE INTO runs (
    project_id, task_id, run_id, turn_id, request_id, candidate_id, status,
    result_kind, result_digest, completed_at_ms
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
    runRecord.project_id,
    runRecord.task_id,
    runRecord.run_id,
    runRecord.turn_id,
    runRecord.request_id,
    runRecord.candidate_id,
    runRecord.status,
    runRecord.result_kind,
    runRecord.result_digest,
    runRecord.completed_at_ms,
  ]);
  const row = one(
    db,
    'SELECT * FROM runs WHERE project_id = ? AND run_id = ?',
    [runRecord.project_id, runRecord.run_id],
  );
  if (!row || !sameRow(row, runRecord)) fail('builder_product_metadata_integrity_failed');
}

function ensureReview(db, review) {
  run(db, `INSERT OR IGNORE INTO reviews (
    project_id, task_id, run_id, review_id, subject_kind, subject_candidate_id,
    subject_candidate_digest, subject_verification_receipt_digest, decision,
    reviewer_id, reviewed_at_ms
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
    review.project_id,
    review.task_id,
    review.run_id,
    review.review_id,
    review.subject_kind,
    review.subject_candidate_id,
    review.subject_candidate_digest,
    review.subject_verification_receipt_digest,
    review.decision,
    review.reviewer_id,
    review.reviewed_at_ms,
  ]);
  const row = one(
    db,
    'SELECT * FROM reviews WHERE project_id = ? AND review_id = ?',
    [review.project_id, review.review_id],
  );
  if (!row || !sameRow(row, review)) fail('builder_product_metadata_integrity_failed');
}

function receiptFromRow(row, missingCode = 'builder_product_metadata_not_found') {
  if (!row) fail(missingCode);
  try {
    return sanitizeReceiptRow({
      candidate_digest: row.candidate_digest,
      candidate_id: row.candidate_id,
      commit_oid: row.commit_oid,
      object_format: row.object_format,
      parent_oid: row.parent_oid,
      previous_revision_receipt_digest: row.previous_revision_receipt_digest,
      project_id: row.project_id,
      review_id: row.review_id,
      revision_number: row.revision_number,
      revision_receipt_digest: row.revision_receipt_digest,
      run_id: row.run_id,
      selected_at_ms: row.selected_at_ms,
      task_id: row.task_id,
      tree_oid: row.tree_oid,
      verification_receipt_digest: row.verification_receipt_digest,
    });
  } catch (error) {
    if (error instanceof BuilderProductMetadataSchemaError) {
      fail('builder_product_metadata_integrity_failed');
    }
    throw error;
  }
}

function verifyReceiptRelations(db, receipt) {
  const task = one(db, 'SELECT * FROM tasks WHERE project_id = ? AND task_id = ?', [
    receipt.project_id,
    receipt.task_id,
  ]);
  const runRecord = one(db, 'SELECT * FROM runs WHERE project_id = ? AND run_id = ?', [
    receipt.project_id,
    receipt.run_id,
  ]);
  const review = one(db, 'SELECT * FROM reviews WHERE project_id = ? AND review_id = ?', [
    receipt.project_id,
    receipt.review_id,
  ]);
  if (
    !task
    || !runRecord
    || !review
    || task.base_commit_oid !== receipt.parent_oid
    || runRecord.task_id !== receipt.task_id
    || runRecord.candidate_id !== receipt.candidate_id
    || runRecord.status !== 'succeeded'
    || runRecord.result_kind !== 'candidate'
    || runRecord.result_digest !== receipt.candidate_digest
    || review.task_id !== receipt.task_id
    || review.run_id !== receipt.run_id
    || review.subject_kind !== 'git_candidate'
    || review.subject_candidate_id !== receipt.candidate_id
    || review.subject_candidate_digest !== receipt.candidate_digest
    || review.subject_verification_receipt_digest !== receipt.verification_receipt_digest
    || review.decision !== 'accepted'
  ) fail('builder_product_metadata_integrity_failed');
}

function loadReceiptRow(db, projectId, digest, missingCode = 'builder_product_metadata_not_found') {
  return receiptFromRow(one(
    db,
    `SELECT project_id, revision_receipt_digest, revision_number,
      previous_revision_receipt_digest, object_format, commit_oid, tree_oid, parent_oid,
      candidate_id, candidate_digest, verification_receipt_digest, task_id, run_id,
      review_id, selected_at_ms
      FROM project_revisions WHERE project_id = ? AND revision_receipt_digest = ?`,
    [projectId, digest],
  ), missingCode);
}

function validateRevisionChain(db, tipReceipt) {
  const seen = new Set();
  let receipt = tipReceipt;
  let expectedNumber = tipReceipt.revision_number;
  for (let depth = 0; depth < MAX_REVISION_CHAIN_DEPTH; depth += 1) {
    if (seen.has(receipt.revision_receipt_digest)) fail('builder_product_metadata_integrity_failed');
    seen.add(receipt.revision_receipt_digest);
    if (receipt.project_id !== tipReceipt.project_id || receipt.revision_number !== expectedNumber) {
      fail('builder_product_metadata_integrity_failed');
    }
    verifyReceiptRelations(db, receipt);
    if (receipt.revision_number === 1) {
      if (receipt.previous_revision_receipt_digest !== null || receipt.parent_oid !== null) {
        fail('builder_product_metadata_integrity_failed');
      }
      return;
    }
    if (receipt.previous_revision_receipt_digest === null || receipt.parent_oid === null) {
      fail('builder_product_metadata_integrity_failed');
    }
    const previous = loadReceiptRow(
      db,
      receipt.project_id,
      receipt.previous_revision_receipt_digest,
      'builder_product_metadata_integrity_failed',
    );
    if (
      previous.revision_number !== receipt.revision_number - 1
      || previous.commit_oid !== receipt.parent_oid
    ) fail('builder_product_metadata_integrity_failed');
    receipt = previous;
    expectedNumber -= 1;
  }
  fail('builder_product_metadata_integrity_failed');
}

function loadReceipt(db, projectId, digest) {
  const receipt = loadReceiptShallow(db, projectId, digest);
  validateRevisionChain(db, receipt);
  return receipt;
}

function loadReceiptShallow(db, projectId, digest) {
  const receipt = loadReceiptRow(db, projectId, digest);
  verifyReceiptRelations(db, receipt);
  return receipt;
}

function validateProjectCurrentTuple(db, row, allowEmpty, fullChain) {
  if (!row) fail('builder_product_metadata_not_found');
  if ((row.current_revision_receipt_digest === null) !== (row.current_revision_number === 0)) {
    fail('builder_product_metadata_integrity_failed');
  }
  if (row.current_revision_receipt_digest === null) {
    if (allowEmpty) return null;
    fail('builder_product_metadata_not_found');
  }
  const receipt = fullChain
    ? loadReceipt(db, row.project_id, row.current_revision_receipt_digest)
    : loadReceiptShallow(db, row.project_id, row.current_revision_receipt_digest);
  if (receipt.revision_number !== row.current_revision_number) {
    fail('builder_product_metadata_integrity_failed');
  }
  return receipt;
}

function loadCurrentReceipt(db, projectId, fullChain) {
  const row = one(
    db,
    `SELECT project_id, current_revision_receipt_digest, current_revision_number
      FROM projects WHERE project_id = ?`,
    [projectId],
  );
  return validateProjectCurrentTuple(db, row, false, fullChain);
}

function currentSummary(receipt) {
  return frozen({
    project_id: receipt.project_id,
    revision_receipt_digest: receipt.revision_receipt_digest,
    revision_number: receipt.revision_number,
    object_format: receipt.object_format,
    commit_oid: receipt.commit_oid,
    tree_oid: receipt.tree_oid,
    parent_oid: receipt.parent_oid,
  });
}

function result(db, operation, actionReceipt, currentReceipt) {
  return frozen({
    result_version: BUILDER_PRODUCT_METADATA_RESULT_VERSION,
    operation,
    receipt: actionReceipt,
    current: currentSummary(currentReceipt),
    metadata_evidence: {
      database_id: DATABASE_ID,
      schema_fingerprint_digest: sha256Canonical(collectSchemaFingerprint(db)),
      schema_version: BUILDER_PRODUCT_METADATA_SCHEMA_VERSION,
      user_version: BUILDER_PRODUCT_METADATA_USER_VERSION,
      runtime_pragmas: runtimePragmas(db),
      transaction: operation === 'recorded'
        ? 'insert_receipt_expected_current_cas'
        : operation === 'replayed'
          ? 'idempotent_replay_action_receipt_latest_current'
          : 'current_readback',
      git_object_verification: 'not_performed_by_metadata_database',
      source_bytes_stored: false,
      credential_storage: 'not_present',
      ui_state_storage: 'not_present',
    },
  });
}

function currentMatches(row, expected, expectedNumber) {
  return expected === null
    ? row.current_revision_receipt_digest === null && row.current_revision_number === expectedNumber
    : row.current_revision_receipt_digest === expected && row.current_revision_number === expectedNumber;
}

function replayIdempotency(db, request) {
  const existing = one(
    db,
    `SELECT semantic_hash, result_project_id, result_digest
      FROM idempotency_records WHERE project_id = ? AND idempotency_key = ?`,
    [request.project.project_id, request.idempotency.idempotency_key],
  );
  if (!existing) return null;
  if (existing.semantic_hash !== request.semantic_hash) {
    fail('builder_product_metadata_idempotency_conflict');
  }
  if (existing.result_project_id !== request.project.project_id) {
    fail('builder_product_metadata_integrity_failed');
  }
  const actionReceipt = loadReceipt(db, existing.result_project_id, existing.result_digest);
  const latestCurrent = loadCurrentReceipt(db, request.project.project_id, true);
  return result(db, 'replayed', actionReceipt, latestCurrent);
}

function deriveReceiptForCurrent(request, projectRow, verifiedCurrent) {
  let revisionNumber;
  let previousRevisionDigest;
  let expectedRevisionNumber;
  if (request.expected_current_revision_receipt_digest === null) {
    if (verifiedCurrent !== null) fail('builder_product_metadata_conflict');
    expectedRevisionNumber = 0;
    if (!currentMatches(projectRow, null, expectedRevisionNumber)) {
      fail('builder_product_metadata_conflict');
    }
    revisionNumber = 1;
    previousRevisionDigest = null;
  } else {
    const parent = verifiedCurrent;
    if (
      !parent
      || parent.revision_receipt_digest !== request.expected_current_revision_receipt_digest
    ) fail('builder_product_metadata_conflict');
    expectedRevisionNumber = parent.revision_number;
    if (!currentMatches(
      projectRow,
      request.expected_current_revision_receipt_digest,
      expectedRevisionNumber,
    )) fail('builder_product_metadata_conflict');
    if (
      request.revision.parent_oid !== parent.commit_oid
      || request.task.base_commit_oid !== parent.commit_oid
      || request.git_candidate_verification_receipt.expected_base_oid !== parent.commit_oid
    ) fail('builder_product_metadata_invalid');
    revisionNumber = parent.revision_number + 1;
    previousRevisionDigest = parent.revision_receipt_digest;
  }
  if (revisionNumber > MAX_REVISION_CHAIN_DEPTH) {
    fail('builder_product_metadata_resource_exceeded');
  }
  return {
    expectedRevisionNumber,
    receipt: createRevisionReceipt({
      ...request.receipt_input,
      revision_number: revisionNumber,
      previous_revision_receipt_digest: previousRevisionDigest,
    }),
  };
}

function recordProjectRevision(db, rawRequest) {
  const sanitized = sanitizeRecordProjectRevisionRequest(rawRequest);
  const request = { ...sanitized, database: db };
  db.exec('BEGIN IMMEDIATE');
  try {
    const replayed = replayIdempotency(db, request);
    if (replayed !== null) {
      db.exec('COMMIT');
      return replayed;
    }
    const existingProject = projectRow(db, request.project.project_id);
    const verifiedCurrent = existingProject
      ? verifyProjectRow(db, existingProject, request.project, true)
      : null;
    const project = existingProject || ensureProject(db, request.project);
    const derived = deriveReceiptForCurrent(request, project, verifiedCurrent);
    const receipt = derived.receipt;
    ensureConversation(db, request.conversation);
    ensureTask(db, request.task);
    ensureRun(db, request.run);
    ensureReview(db, request.review);
    run(db, `INSERT INTO project_revisions (
      project_id, revision_receipt_digest, revision_number, previous_revision_receipt_digest,
      object_format, commit_oid, tree_oid, parent_oid, candidate_id, candidate_digest,
      verification_receipt_digest, task_id, run_id, review_id, selected_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
      receipt.project_id,
      receipt.revision_receipt_digest,
      receipt.revision_number,
      receipt.previous_revision_receipt_digest,
      receipt.object_format,
      receipt.commit_oid,
      receipt.tree_oid,
      receipt.parent_oid,
      receipt.candidate_id,
      receipt.candidate_digest,
      receipt.verification_receipt_digest,
      receipt.task_id,
      receipt.run_id,
      receipt.review_id,
      receipt.selected_at_ms,
    ]);
    const updated = run(
      db,
      `UPDATE projects
        SET current_revision_receipt_digest = ?, current_revision_number = ?
        WHERE project_id = ?
          AND current_revision_number = ?
          AND (current_revision_receipt_digest IS ?
            OR current_revision_receipt_digest = ?)`,
      [
        receipt.revision_receipt_digest,
        receipt.revision_number,
        request.project.project_id,
        derived.expectedRevisionNumber,
        request.expected_current_revision_receipt_digest,
        request.expected_current_revision_receipt_digest,
      ],
    );
    if (updated.changes !== 1) fail('builder_product_metadata_conflict');
    run(db, `INSERT INTO idempotency_records (
      project_id, idempotency_key, operation, semantic_hash, result_project_id,
      result_digest, created_at_ms
    ) VALUES (?, ?, 'record_project_revision_receipt', ?, ?, ?, ?)`, [
      request.project.project_id,
      request.idempotency.idempotency_key,
      request.semantic_hash,
      receipt.project_id,
      receipt.revision_receipt_digest,
      request.revision.selected_at_ms,
    ]);
    const actionReceipt = loadReceiptShallow(db, receipt.project_id, receipt.revision_receipt_digest);
    const latestCurrent = loadCurrentReceipt(db, request.project.project_id, false);
    db.exec('COMMIT');
    return result(db, 'recorded', actionReceipt, latestCurrent);
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* fixed failure below */ }
    throw error;
  }
}

function loadCurrent(db, rawRequest) {
  const request = sanitizeLoadCurrentRequest(rawRequest);
  const current = loadCurrentReceipt(db, request.project_id, true);
  return result(db, 'current_loaded', current, current);
}

function ownErrorField(error, key) {
  if (!error || typeof error !== 'object') return null;
  const descriptor = Object.getOwnPropertyDescriptor(error, key);
  return descriptor && Object.hasOwn(descriptor, 'value')
    ? descriptor.value
    : null;
}

function normalizeOperationError(error) {
  if (error instanceof BuilderProductMetadataDatabaseError) {
    return new BuilderProductMetadataDatabaseError(error.code);
  }
  if (error instanceof BuilderProductMetadataSchemaError) {
    return new BuilderProductMetadataDatabaseError('builder_product_metadata_invalid');
  }
  if (error instanceof BuilderGitReceiptContractError) {
    return new BuilderProductMetadataDatabaseError('builder_product_metadata_invalid');
  }
  const sqliteCode = ownErrorField(error, 'code');
  const sqliteErrstr = ownErrorField(error, 'errstr');
  const sqliteErrcode = ownErrorField(error, 'errcode');
  if (sqliteCode && /^SQLITE_CONSTRAINT/u.test(sqliteCode)) {
    return new BuilderProductMetadataDatabaseError('builder_product_metadata_integrity_failed');
  }
  if (sqliteErrstr === 'constraint failed' || sqliteErrcode === 1555) {
    return new BuilderProductMetadataDatabaseError('builder_product_metadata_integrity_failed');
  }
  if (sqliteCode && /^SQLITE_(CORRUPT|NOTADB|SCHEMA|INTERNAL|MISMATCH)/u.test(sqliteCode)) {
    return new BuilderProductMetadataDatabaseError('builder_product_metadata_integrity_failed');
  }
  return new BuilderProductMetadataDatabaseError('builder_product_metadata_unavailable');
}

function createBuilderProductMetadataDatabase(databasePath) {
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
    close(...rawArguments) {
      if (rawArguments.length !== 0) {
        throw new BuilderProductMetadataDatabaseError('builder_product_metadata_invalid');
      }
      try { db.close(); } catch (error) { throw normalizeOperationError(error); }
    },

    load_current_project_revision(rawRequest) {
      try { return loadCurrent(db, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },

    record_project_revision_receipt(rawRequest) {
      try { return recordProjectRevision(db, rawRequest); } catch (error) {
        throw normalizeOperationError(error);
      }
    },
  });
}

module.exports = Object.freeze({
  BUILDER_PRODUCT_METADATA_RESULT_VERSION,
  BuilderProductMetadataDatabaseError,
  createBuilderProductMetadataDatabase,
});
