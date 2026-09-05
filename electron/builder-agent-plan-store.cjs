'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const {
  sanitizeBuilderAgentPlanArtifact,
  sanitizeBuilderAgentPlanDecision,
} = require('./builder-agent-plan-contract.cjs');

const STORE_VERSION = 'builder-agent-plan-store.v1';
const SCHEMA_VERSION = 'builder-agent-plan-store-schema.v1';

class BuilderAgentPlanStoreError extends Error {
  constructor(code = 'builder_agent_plan_store_unavailable') {
    super('Builder Agent plan store is unavailable.');
    this.name = 'BuilderAgentPlanStoreError';
    this.code = code;
    this.stack = `${this.name}: ${this.message}`;
  }
}
function fail(code) { throw new BuilderAgentPlanStoreError(code); }
function freeze(value) { return Object.freeze(value); }
function parse(value, sanitizer) { try { return sanitizer(JSON.parse(value)); } catch { fail('builder_agent_plan_store_integrity_failed'); } }

function createBuilderAgentPlanStore(databasePath) {
  if (typeof databasePath !== 'string' || !path.isAbsolute(databasePath) || path.resolve(databasePath) !== databasePath) fail('builder_agent_plan_store_invalid');
  const parent = fs.lstatSync(path.dirname(databasePath));
  if (!parent.isDirectory() || parent.isSymbolicLink()) fail();
  const database = new DatabaseSync(databasePath);
  database.exec('PRAGMA trusted_schema = OFF; PRAGMA foreign_keys = ON; PRAGMA synchronous = FULL; PRAGMA journal_mode = WAL;');
  database.exec(`
    CREATE TABLE IF NOT EXISTS agent_plans (
      agent_plan_id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      source_conversation_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      content_digest TEXT NOT NULL UNIQUE,
      artifact_json TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL,
      schema_version TEXT NOT NULL CHECK (schema_version = '${SCHEMA_VERSION}'),
      UNIQUE(agent_id, source_conversation_id, version)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS agent_plan_decisions (
      agent_plan_id TEXT PRIMARY KEY REFERENCES agent_plans(agent_plan_id),
      decision_json TEXT NOT NULL,
      schema_version TEXT NOT NULL CHECK (schema_version = '${SCHEMA_VERSION}')
    ) STRICT;
    CREATE TABLE IF NOT EXISTS agent_plan_dispatches (
      agent_plan_id TEXT PRIMARY KEY REFERENCES agent_plans(agent_plan_id),
      proposal_id TEXT NOT NULL UNIQUE,
      task_address_id TEXT UNIQUE,
      schema_version TEXT NOT NULL CHECK (schema_version = '${SCHEMA_VERSION}')
    ) STRICT;
  `);
  let closed = false;
  const db = () => { if (closed) fail(); return database; };
  const artifactFrom = (row) => row ? parse(row.artifact_json, sanitizeBuilderAgentPlanArtifact) : null;
  const decisionFrom = (row) => row ? parse(row.decision_json, sanitizeBuilderAgentPlanDecision) : null;
  function bundle(row) {
    if (!row) return freeze({ status: 'absent', artifact: null, decision: null });
    const artifact = artifactFrom(row);
    const decision = decisionFrom(db().prepare('SELECT decision_json FROM agent_plan_decisions WHERE agent_plan_id = ?').get(artifact.agent_plan_id));
    return freeze({ status: 'ready', artifact, decision });
  }
  return freeze({
    store_version: STORE_VERSION,
    record_artifact({ artifact: rawArtifact }) {
      let artifact;
      try { artifact = sanitizeBuilderAgentPlanArtifact(rawArtifact); } catch { fail('builder_agent_plan_store_invalid'); }
      const existing = db().prepare('SELECT * FROM agent_plans WHERE agent_plan_id = ? OR content_digest = ?').get(artifact.agent_plan_id, artifact.content_digest);
      if (existing) {
        const stored = artifactFrom(existing);
        if (JSON.stringify(stored) !== JSON.stringify(artifact)) fail('builder_agent_plan_store_conflict');
        return freeze({ operation: 'artifact_replayed', artifact: stored });
      }
      db().prepare('INSERT INTO agent_plans VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
        artifact.agent_plan_id, artifact.agent_id, artifact.source_conversation_id, artifact.version,
        artifact.content_digest, JSON.stringify(artifact), artifact.created_at_ms, SCHEMA_VERSION,
      );
      return freeze({ operation: 'artifact_recorded', artifact });
    },
    record_decision({ decision: rawDecision }) {
      let decision;
      try { decision = sanitizeBuilderAgentPlanDecision(rawDecision); } catch { fail('builder_agent_plan_store_invalid'); }
      const artifact = artifactFrom(db().prepare('SELECT * FROM agent_plans WHERE agent_plan_id = ?').get(decision.agent_plan_id));
      if (!artifact || artifact.content_digest !== decision.content_digest) fail('builder_agent_plan_store_conflict');
      const existing = decisionFrom(db().prepare('SELECT decision_json FROM agent_plan_decisions WHERE agent_plan_id = ?').get(decision.agent_plan_id));
      if (existing) {
        if (JSON.stringify(existing) !== JSON.stringify(decision)) fail('builder_agent_plan_store_conflict');
        return freeze({ operation: 'decision_replayed', decision: existing });
      }
      db().prepare('INSERT INTO agent_plan_decisions VALUES (?, ?, ?)').run(decision.agent_plan_id, JSON.stringify(decision), SCHEMA_VERSION);
      return freeze({ operation: 'decision_recorded', decision });
    },
    read({ agent_plan_id: planId }) { return bundle(db().prepare('SELECT * FROM agent_plans WHERE agent_plan_id = ?').get(planId)); },
    read_latest({ agent_id: agentId, source_conversation_id: conversationId }) {
      return bundle(db().prepare('SELECT * FROM agent_plans WHERE agent_id = ? AND source_conversation_id = ? ORDER BY version DESC LIMIT 1').get(agentId, conversationId));
    },
    record_dispatch({ agent_plan_id: planId, proposal_id: proposalId }) {
      const existing = db().prepare('SELECT * FROM agent_plan_dispatches WHERE agent_plan_id = ? OR proposal_id = ?').get(planId, proposalId);
      if (existing) {
        if (existing.agent_plan_id !== planId || existing.proposal_id !== proposalId) fail('builder_agent_plan_store_conflict');
        return freeze({ operation: 'dispatch_replayed', agent_plan_id: planId, proposal_id: proposalId, task_address_id: existing.task_address_id });
      }
      const selected = bundle(db().prepare('SELECT * FROM agent_plans WHERE agent_plan_id = ?').get(planId));
      if (selected.status !== 'ready' || selected.decision?.decision !== 'approved') fail('builder_agent_plan_store_conflict');
      db().prepare('INSERT INTO agent_plan_dispatches VALUES (?, ?, NULL, ?)').run(planId, proposalId, SCHEMA_VERSION);
      return freeze({ operation: 'dispatch_recorded', agent_plan_id: planId, proposal_id: proposalId, task_address_id: null });
    },
    bind_dispatch_task({ proposal_id: proposalId, task_address_id: taskAddressId }) {
      const existing = db().prepare('SELECT * FROM agent_plan_dispatches WHERE proposal_id = ?').get(proposalId);
      if (!existing) return freeze({ operation: 'dispatch_absent', agent_plan_id: null, proposal_id: proposalId, task_address_id: null });
      if (existing.task_address_id !== null && existing.task_address_id !== taskAddressId) fail('builder_agent_plan_store_conflict');
      if (existing.task_address_id === null) db().prepare('UPDATE agent_plan_dispatches SET task_address_id = ? WHERE proposal_id = ?').run(taskAddressId, proposalId);
      return freeze({ operation: existing.task_address_id === null ? 'dispatch_bound' : 'dispatch_binding_replayed', agent_plan_id: existing.agent_plan_id, proposal_id: proposalId, task_address_id: taskAddressId });
    },
    read_by_task({ task_address_id: taskAddressId }) {
      const row = db().prepare('SELECT agent_plan_id FROM agent_plan_dispatches WHERE task_address_id = ?').get(taskAddressId);
      return row ? bundle(db().prepare('SELECT * FROM agent_plans WHERE agent_plan_id = ?').get(row.agent_plan_id)) : freeze({ status: 'absent', artifact: null, decision: null });
    },
    close() { if (closed) return false; database.close(); closed = true; return true; },
  });
}

module.exports = Object.freeze({ STORE_VERSION, SCHEMA_VERSION, BuilderAgentPlanStoreError, createBuilderAgentPlanStore });
