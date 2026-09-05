'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  BUILDER_CONVERSATION_AUTHORITY_RESULT_VERSION,
} = require('../electron/builder-conversation-authority-contract.cjs');
const {
  createBuilderTaskAddress,
} = require('../electron/builder-session-task-address.cjs');
const {
  BUILDER_TASK_TRANSCRIPT_EXPORT_VERSION,
  BuilderTaskTranscriptExportError,
  createBuilderTaskTranscriptExport,
} = require('../electron/builder-task-transcript-export.cjs');

const PROJECT_UUID = '123e4567-e89b-42d3-a456-426614174000';
const TASK_UUID = '223e4567-e89b-42d3-a456-426614174000';
const SESSION_UUID = '323e4567-e89b-42d3-a456-426614174000';
const AGENT_UUID = '423e4567-e89b-42d3-a456-426614174000';
const PROJECT_ID = `builder-project:${PROJECT_UUID}`;
const TASK_ADDRESS_ID = `builder-task-address:${TASK_UUID}`;
const SESSION_ID = `builder-session:${SESSION_UUID}`;
const AGENT_ID = `builder-agent:${AGENT_UUID}`;
const CONVERSATION_ID = `builder-conversation:${PROJECT_UUID}:${TASK_UUID}`;

function digest(char) {
  return `sha256:${char.repeat(64)}`;
}

function taskAddress() {
  return createBuilderTaskAddress({
    task_address_id: TASK_ADDRESS_ID,
    session_id: SESSION_ID,
    project_id: PROJECT_ID,
    agent_id: AGENT_ID,
    parent_task_address_id: null,
    conversation_id: CONVERSATION_ID,
    title: 'Export current task',
    goal: 'Provide a clean public transcript for review.',
    status: 'active',
    current_brief_id: null,
    current_plan_id: null,
    base_revision_receipt_digest: digest('a'),
    produced_revision_receipt_digest: null,
    created_by: 'local-user',
    created_at_ms: 1,
    updated_at_ms: 2,
    closed_at_ms: null,
  });
}

function loadedConversation(conversationId = CONVERSATION_ID) {
  return {
    result_version: BUILDER_CONVERSATION_AUTHORITY_RESULT_VERSION,
    operation: 'conversation_loaded',
    conversation: {
      project_id: PROJECT_ID,
      conversation_id: conversationId,
      created_at_ms: 1,
    },
    action_events: [],
    current_head: null,
    events: [],
    snapshot: null,
    metadata_evidence: {
      credential: 'private-credential-marker',
      source_tree: 'private-source-tree-marker',
      commit_oid: '1'.repeat(40),
    },
  };
}

function assertExportError(error) {
  assert.ok(error instanceof BuilderTaskTranscriptExportError);
  assert.equal(error.code, 'builder_task_transcript_export_invalid');
  assert.doesNotMatch(`${error.message}\n${error.stack}`, /private-credential-marker|private-source-tree-marker|commit_oid/iu);
  return true;
}

test('exports a Main-owned task transcript without source, git, or credential leakage', () => {
  const exported = createBuilderTaskTranscriptExport({
    task_address: taskAddress(),
    loaded_conversation: loadedConversation(),
    exported_at_ms: 1234,
  });

  assert.equal(exported.export_version, BUILDER_TASK_TRANSCRIPT_EXPORT_VERSION);
  assert.match(exported.export_id, /^builder-task-transcript-export:[0-9a-f]{64}$/u);
  assert.equal(exported.project_id, PROJECT_ID);
  assert.equal(exported.task_address_id, TASK_ADDRESS_ID);
  assert.equal(exported.conversation_id, CONVERSATION_ID);
  assert.equal(exported.task.title, 'Export current task');
  assert.equal(exported.source.current_sequence, 0);
  assert.equal(exported.lifecycle.export_authority, 'main_task_transcript_export_contract_v1');
  assert.equal(exported.lifecycle.renderer_authority, 'task_export_request_only');
  assert.equal(exported.lifecycle.export_materialization, 'not_performed');
  assert.match(exported.formats.markdown.text, /# ClawFabric Task Transcript/u);
  assert.match(exported.formats.markdown.text, /Provide a clean public transcript for review\./u);
  assert.match(exported.formats.jsonl.text, /"entry_kind":"task_transcript_export"/u);
  assert.doesNotMatch(
    JSON.stringify(exported),
    /private-credential-marker|private-source-tree-marker|commit_oid|tree_oid|source_tree|provider_payload/iu,
  );
  assert.equal(Object.isFrozen(exported), true);
});

test('is deterministic for the same task and exported timestamp', () => {
  const input = {
    task_address: taskAddress(),
    loaded_conversation: loadedConversation(),
    exported_at_ms: 5678,
  };

  assert.deepEqual(
    createBuilderTaskTranscriptExport(input),
    createBuilderTaskTranscriptExport(structuredClone(input)),
  );
});

test('fails closed on task to conversation drift and non-plain inputs', () => {
  assert.throws(
    () => createBuilderTaskTranscriptExport({
      task_address: taskAddress(),
      loaded_conversation: loadedConversation(`builder-conversation:${PROJECT_UUID}:523e4567-e89b-42d3-a456-426614174000`),
      exported_at_ms: 1,
    }),
    assertExportError,
  );

  let traps = 0;
  assert.throws(
    () => createBuilderTaskTranscriptExport(new Proxy({
      task_address: taskAddress(),
      loaded_conversation: loadedConversation(),
      exported_at_ms: 1,
    }, {
      ownKeys() {
        traps += 1;
        return [];
      },
    })),
    assertExportError,
  );
  assert.equal(traps, 0);
});
