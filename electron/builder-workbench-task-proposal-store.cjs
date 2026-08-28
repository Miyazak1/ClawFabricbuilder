'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { types: utilTypes } = require('node:util');
const {
  sanitizeBuilderWorkbenchTaskProposal,
  sanitizeBuilderWorkbenchTaskProposalDecision,
  sanitizeBuilderWorkbenchTaskMaterialization,
} = require('./builder-workbench-task-proposal-contract.cjs');

const STORE_VERSION = 'builder-workbench-task-proposal-store.v1';
const SCHEMA_VERSION = 'builder-workbench-task-proposal-store-schema.v1';

class BuilderWorkbenchTaskProposalStoreError extends Error {
  constructor(code = 'builder_workbench_task_proposal_store_unavailable') {
    super('Builder Workbench task proposal store is unavailable.');
    this.name = 'BuilderWorkbenchTaskProposalStoreError';
    this.code = code;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code) { throw new BuilderWorkbenchTaskProposalStoreError(code); }
function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freezeDeep(nested);
    Object.freeze(value);
  }
  return value;
}
function plain(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || utilTypes.isProxy(value)) fail('builder_workbench_task_proposal_store_invalid');
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail('builder_workbench_task_proposal_store_invalid');
}
function exact(value, keys) {
  plain(value);
  const actual = Reflect.ownKeys(value);
  if (actual.length !== keys.length || actual.some((key) => typeof key !== 'string' || !keys.includes(key))) fail('builder_workbench_task_proposal_store_invalid');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of keys) if (!descriptors[key]?.enumerable || !Object.hasOwn(descriptors[key], 'value')) fail('builder_workbench_task_proposal_store_invalid');
  return descriptors;
}
function stableJson(value) { return JSON.stringify(value); }
function parse(text, sanitizer) {
  try { return sanitizer(JSON.parse(text)); } catch { fail('builder_workbench_task_proposal_store_integrity_failed'); }
}
function proposalRow(row) {
  if (!row) return null;
  const proposal = parse(row.proposal_json, sanitizeBuilderWorkbenchTaskProposal);
  if (row.proposal_id !== proposal.proposal_id || row.request_id !== proposal.request_id || row.action_id !== proposal.action_id) fail('builder_workbench_task_proposal_store_integrity_failed');
  return proposal;
}
function decisionRow(row) {
  if (!row?.decision_json) return null;
  const decision = parse(row.decision_json, sanitizeBuilderWorkbenchTaskProposalDecision);
  if (row.proposal_id !== decision.proposal_id) fail('builder_workbench_task_proposal_store_integrity_failed');
  return decision;
}
function materializationRow(row) {
  if (!row?.materialization_json) return null;
  const materialization = parse(row.materialization_json, sanitizeBuilderWorkbenchTaskMaterialization);
  if (row.proposal_id !== materialization.proposal_id) fail('builder_workbench_task_proposal_store_integrity_failed');
  return materialization;
}

function createBuilderWorkbenchTaskProposalStore(databasePath) {
  if (typeof databasePath !== 'string' || !path.isAbsolute(databasePath) || path.resolve(databasePath) !== databasePath) fail('builder_workbench_task_proposal_store_invalid');
  const parent = fs.lstatSync(path.dirname(databasePath));
  if (!parent.isDirectory() || parent.isSymbolicLink()) fail('builder_workbench_task_proposal_store_unavailable');
  const database = new DatabaseSync(databasePath);
  database.exec('PRAGMA trusted_schema = OFF');
  database.exec('PRAGMA foreign_keys = ON');
  database.exec('PRAGMA synchronous = FULL');
  database.exec('PRAGMA journal_mode = WAL');
  database.exec(`
    CREATE TABLE IF NOT EXISTS proposals (
      proposal_id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL UNIQUE,
      action_id TEXT NOT NULL UNIQUE,
      agent_id TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL,
      proposal_json TEXT NOT NULL,
      schema_version TEXT NOT NULL CHECK (schema_version = '${SCHEMA_VERSION}')
    ) STRICT;
    CREATE INDEX IF NOT EXISTS proposals_agent_created_idx
      ON proposals(agent_id, created_at_ms DESC);
    CREATE TABLE IF NOT EXISTS decisions (
      proposal_id TEXT PRIMARY KEY REFERENCES proposals(proposal_id),
      decision_json TEXT NOT NULL,
      schema_version TEXT NOT NULL CHECK (schema_version = '${SCHEMA_VERSION}')
    ) STRICT;
    CREATE TABLE IF NOT EXISTS materializations (
      proposal_id TEXT PRIMARY KEY REFERENCES proposals(proposal_id),
      task_address_id TEXT NOT NULL UNIQUE,
      materialization_json TEXT NOT NULL,
      schema_version TEXT NOT NULL CHECK (schema_version = '${SCHEMA_VERSION}')
    ) STRICT;
  `);
  let closed = false;
  function db() {
    if (closed) fail('builder_workbench_task_proposal_store_unavailable');
    return database;
  }
  function readBundle(proposalId) {
    const proposalRecord = db().prepare('SELECT * FROM proposals WHERE proposal_id = ?').get(proposalId);
    if (!proposalRecord) return freezeDeep({ status: 'absent', proposal: null, decision: null, materialization: null });
    return freezeDeep({
      status: 'ready',
      proposal: proposalRow(proposalRecord),
      decision: decisionRow(db().prepare('SELECT * FROM decisions WHERE proposal_id = ?').get(proposalId)),
      materialization: materializationRow(db().prepare('SELECT * FROM materializations WHERE proposal_id = ?').get(proposalId)),
    });
  }
  return freezeDeep({
    store_version: STORE_VERSION,
    record_proposal(request) {
      const input = exact(request, ['proposal']);
      let proposal;
      try { proposal = sanitizeBuilderWorkbenchTaskProposal(input.proposal.value); } catch { fail('builder_workbench_task_proposal_store_invalid'); }
      const existing = db().prepare('SELECT * FROM proposals WHERE proposal_id = ? OR request_id = ? OR action_id = ?').get(proposal.proposal_id, proposal.request_id, proposal.action_id);
      if (existing) {
        const stored = proposalRow(existing);
        if (stableJson(stored) !== stableJson(proposal)) fail('builder_workbench_task_proposal_store_conflict');
        return freezeDeep({ operation: 'proposal_replayed', proposal: stored });
      }
      db().prepare('INSERT INTO proposals (proposal_id, request_id, action_id, agent_id, created_at_ms, proposal_json, schema_version) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
        proposal.proposal_id, proposal.request_id, proposal.action_id, proposal.agent_id,
        proposal.created_at_ms, stableJson(proposal), SCHEMA_VERSION,
      );
      return freezeDeep({ operation: 'proposal_recorded', proposal });
    },
    record_decision(request) {
      const input = exact(request, ['decision']);
      let decision;
      try { decision = sanitizeBuilderWorkbenchTaskProposalDecision(input.decision.value); } catch { fail('builder_workbench_task_proposal_store_invalid'); }
      if (!db().prepare('SELECT 1 FROM proposals WHERE proposal_id = ?').get(decision.proposal_id)) fail('builder_workbench_task_proposal_store_conflict');
      const existing = db().prepare('SELECT * FROM decisions WHERE proposal_id = ?').get(decision.proposal_id);
      if (existing) {
        const stored = decisionRow(existing);
        if (stableJson(stored) !== stableJson(decision)) fail('builder_workbench_task_proposal_store_conflict');
        return freezeDeep({ operation: 'decision_replayed', decision: stored });
      }
      db().prepare('INSERT INTO decisions (proposal_id, decision_json, schema_version) VALUES (?, ?, ?)').run(decision.proposal_id, stableJson(decision), SCHEMA_VERSION);
      return freezeDeep({ operation: 'decision_recorded', decision });
    },
    record_materialization(request) {
      const input = exact(request, ['materialization']);
      let materialization;
      try { materialization = sanitizeBuilderWorkbenchTaskMaterialization(input.materialization.value); } catch { fail('builder_workbench_task_proposal_store_invalid'); }
      const decision = decisionRow(db().prepare('SELECT * FROM decisions WHERE proposal_id = ?').get(materialization.proposal_id));
      if (!decision || decision.decision !== 'approve_existing_project' || decision.project_id !== materialization.project_id) fail('builder_workbench_task_proposal_store_conflict');
      const existing = db().prepare('SELECT * FROM materializations WHERE proposal_id = ? OR task_address_id = ?').get(materialization.proposal_id, materialization.task_address_id);
      if (existing) {
        const stored = materializationRow(existing);
        if (stableJson(stored) !== stableJson(materialization)) fail('builder_workbench_task_proposal_store_conflict');
        return freezeDeep({ operation: 'materialization_replayed', materialization: stored });
      }
      db().prepare('INSERT INTO materializations (proposal_id, task_address_id, materialization_json, schema_version) VALUES (?, ?, ?, ?)').run(materialization.proposal_id, materialization.task_address_id, stableJson(materialization), SCHEMA_VERSION);
      return freezeDeep({ operation: 'materialization_recorded', materialization });
    },
    read_by_proposal_id(request) {
      const input = exact(request, ['proposal_id']);
      if (typeof input.proposal_id.value !== 'string') fail('builder_workbench_task_proposal_store_invalid');
      return readBundle(input.proposal_id.value);
    },
    read_by_action_ref(request) {
      const input = exact(request, ['action_id']);
      if (typeof input.action_id.value !== 'string') fail('builder_workbench_task_proposal_store_invalid');
      const row = db().prepare('SELECT proposal_id FROM proposals WHERE action_id = ?').get(input.action_id.value);
      return row ? readBundle(row.proposal_id) : freezeDeep({ status: 'absent', proposal: null, decision: null, materialization: null });
    },
    close() {
      if (closed) return false;
      database.close();
      closed = true;
      return true;
    },
  });
}

module.exports = Object.freeze({
  STORE_VERSION,
  SCHEMA_VERSION,
  BuilderWorkbenchTaskProposalStoreError,
  createBuilderWorkbenchTaskProposalStore,
});
