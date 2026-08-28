'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  BuilderConversationTranscriptArchiveError,
  createBuilderConversationTranscriptArchive,
} = require('../electron/builder-conversation-transcript-archive.cjs');
const {
  createBuilderConversationMainService,
} = require('../electron/builder-conversation-main-service.cjs');
const {
  createBuilderProductMetadataDatabase,
} = require('../electron/builder-product-metadata-database.cjs');

const UUID = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = `builder-project:${UUID}`;
const CONVERSATION_ID = `builder-conversation:${UUID}`;
const QUESTION_DIGEST = `sha256:${'0'.repeat(64)}`;

function uuidFactory() {
  let value = 1;
  return () => `00000000-0000-4000-8000-${String(value++).padStart(12, '0')}`;
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cfb-transcript-'));
  const transcriptRoot = path.join(root, 'builder-transcripts-v1');
  fs.mkdirSync(transcriptRoot, { mode: 0o700 });
  const database = createBuilderProductMetadataDatabase(path.join(root, 'builder.sqlite'));
  const archive = createBuilderConversationTranscriptArchive({ root_path: transcriptRoot });
  let now = 1_000;
  const service = createBuilderConversationMainService({
    metadataAuthority: database,
    createUuid: uuidFactory(),
    nowMs: () => now++,
    transcriptArchive: archive,
  });
  return {
    archive,
    database,
    root,
    service,
    transcriptRoot,
    close() {
      database.close();
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

function beginQuestion(service) {
  return service.begin_question({
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    question: 'What should I review?',
    request_digest: QUESTION_DIGEST,
    base_revision: null,
  });
}

function readArchive(archive) {
  return archive.read_latest({ project_id: PROJECT_ID, conversation_id: CONVERSATION_ID });
}

function transcriptFile(item) {
  return path.join(
    item.transcriptRoot,
    `builder-project-${UUID}`,
    `builder-conversation-${UUID}.jsonl`,
  );
}

test('archives committed SQLite conversations as incremental public JSONL checkpoints', () => {
  const item = fixture();
  try {
    const context = beginQuestion(item.service);
    const running = readArchive(item.archive);
    assert.equal(running.operation, 'archive_read');
    assert.equal(running.latest.sequence, 2);
    assert.deepEqual(running.public_entries.map((entry) => entry.entry_kind), [
      'turn', 'message', 'run',
    ]);
    assert.equal(running.public_entries[0].status, 'active');
    assert.equal(running.public_entries[2].status, 'running');

    item.service.complete_explanation({
      context,
      assistant_text: 'Review the current files and saved versions before changing anything.',
    });
    const completed = readArchive(item.archive);
    assert.equal(completed.latest.sequence, 4);
    assert.deepEqual(completed.public_entries.map((entry) => entry.entry_kind), [
      'turn', 'message', 'run', 'message',
    ]);
    assert.equal(completed.public_entries.find((entry) => entry.entry_kind === 'run').status, 'completed');
    assert.equal(completed.public_entries.at(-1).role, 'assistant');

    const lines = fs.readFileSync(transcriptFile(item), 'utf8').trimEnd().split('\n');
    assert.equal(lines.length, 2);
    assert.equal(JSON.parse(lines[0]).sequence, 2);
    assert.equal(JSON.parse(lines[1]).sequence, 4);
    assert.ok(JSON.parse(lines[1]).public_changes.length >= 3);
  } finally {
    item.close();
  }
});

test('repairs a missing transcript from SQLite without copying private metadata', () => {
  const item = fixture();
  try {
    const context = beginQuestion(item.service);
    item.service.complete_explanation({ context, assistant_text: 'The public answer.' });
    const loaded = structuredClone(item.database.load_conversation({
      project_id: PROJECT_ID,
      conversation_id: CONVERSATION_ID,
    }));
    loaded.metadata_evidence = {
      source_tree: 'private-source-tree-marker',
      credential: 'private-credential-marker',
      absolute_path: 'C:\\private\\workspace',
    };

    fs.rmSync(transcriptFile(item));
    const repaired = item.archive.repair_conversation({
      loaded_conversation: loaded,
      archived_at_ms: 2_000,
    });
    assert.equal(repaired.operation, 'archive_repaired');
    assert.equal(repaired.sequence, 4);
    const text = fs.readFileSync(transcriptFile(item), 'utf8');
    assert.equal(text.trimEnd().split('\n').length, 1);
    assert.doesNotMatch(text, /private-source-tree-marker|private-credential-marker|C:\\\\private/iu);
    assert.equal(
      readArchive(item.archive).public_entries.find((entry) => (
        entry.entry_kind === 'message' && entry.role === 'assistant'
      )).text,
      'The public answer.',
    );
  } finally {
    item.close();
  }
});

test('fails closed on a corrupted transcript and reports no local paths', () => {
  const item = fixture();
  try {
    beginQuestion(item.service);
    fs.appendFileSync(transcriptFile(item), '{"credential":"private-marker"}\n', 'utf8');
    assert.throws(
      () => readArchive(item.archive),
      (error) => {
        assert.ok(error instanceof BuilderConversationTranscriptArchiveError);
        assert.equal(error.code, 'builder_conversation_transcript_invalid');
        assert.doesNotMatch(`${error.message}\n${error.stack}`, /private-marker|builder-transcripts|cfb-transcript/iu);
        return true;
      },
    );
  } finally {
    item.close();
  }
});
