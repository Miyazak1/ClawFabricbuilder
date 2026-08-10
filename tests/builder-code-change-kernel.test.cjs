'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  CONVERSATION_AUTHORITY,
  CONVERSATION_EVENT_KIND,
  CONVERSATION_EVENT_VERSION,
  createBuilderConversationEvent,
} = require('../electron/builder-conversation-records.cjs');
const {
  BUILDER_CODE_CHANGE_AUTHORITY,
  BUILDER_CODE_CHANGE_CANDIDATE_VERSION,
  BUILDER_CODE_CHANGE_RUN_BINDING_VERSION,
  BUILDER_PROJECT_BASE_REVISION_EVIDENCE_VERSION,
  MAX_CODE_CHANGE_CANDIDATE_UTF8_BYTES,
  MAX_CODE_CHANGE_OPERATION_UTF8_BYTES,
  BuilderCodeChangeKernelError,
  createBuilderCodeChangeCandidate,
  sanitizeBuilderCodeChangeCandidate,
} = require('../electron/builder-code-change-kernel.cjs');
const {
  MAX_SOURCE_FILE_UTF8_BYTES,
  createBuilderProjectSourceTree,
} = require('../electron/builder-project-source-tree.cjs');

const UUID = '123e4567-e89b-42d3-a456-426614174000';
const PROJECT_ID = `builder-project:${UUID}`;
const CONVERSATION_ID = `builder-conversation:${UUID}`;
const ZERO_DIGEST = `sha256:${'0'.repeat(64)}`;
const ONE_DIGEST = `sha256:${'1'.repeat(64)}`;
const COMMIT_OID = 'a'.repeat(40);
const OTHER_COMMIT_OID = 'b'.repeat(40);
const BASE_REVISION = Object.freeze({
  revision_receipt_digest: ONE_DIGEST,
  commit_oid: COMMIT_OID,
});

function uuid(index) {
  return `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;
}
function id(kind, index) {
  return `builder-${kind}:${uuid(index)}`;
}

function routeDecision(payload) {
  const route = payload.mode === 'work' ? 'build' : 'answer';
  return {
    decision_id: `builder-route-decision:${payload.message.message_id.slice('builder-message:'.length)}`,
    decision_version: 'builder-composer-route-decision.v1',
    project_id: PROJECT_ID,
    message_id: payload.message.message_id,
    task_id: payload.task === null ? null : payload.task.task_id,
    route,
    confidence: 'high',
    matched_signals: [payload.mode === 'work' ? 'clear_build' : 'read_only'],
    downgraded_from: null,
    downgrade_reason: null,
    required_permissions: route === 'build' ? ['write_project'] : [],
    permission_result: route === 'build' ? 'allowed' : 'not_required',
    dispatch: route === 'build' ? 'build' : 'reply',
    decided_at_ms: 1,
  };
}

const TURN_ID = id('turn', 1);
const TASK_ID = id('task', 1);
const RUN_ID = id('run', 1);

function append(events, eventType, payload, commandIndex = events.length + 1) {
  const previous = events.at(-1) ?? null;
  const normalizedPayload = eventType === 'turn_submitted'
    ? {
      ...payload,
      route_decision: Object.hasOwn(payload, 'route_decision')
        ? payload.route_decision
        : routeDecision(payload),
    }
    : payload;
  return [...events, createBuilderConversationEvent({
    record_version: CONVERSATION_EVENT_VERSION,
    record_kind: CONVERSATION_EVENT_KIND,
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    sequence: events.length + 1,
    command_id: id('command', commandIndex),
    event_type: eventType,
    previous_event: previous === null ? null : {
      sequence: previous.sequence,
      event_id: previous.event_id,
      event_digest: previous.event_digest,
    },
    payload: normalizedPayload,
    authority: { ...CONVERSATION_AUTHORITY },
  })];
}

function activeRunEvents({ baseRevision = null, inputDigest = ZERO_DIGEST } = {}) {
  let events = [];
  events = append(events, 'turn_submitted', {
    message: { message_id: id('message', 1), text: 'Build a useful project.' },
    turn_id: TURN_ID,
    mode: 'work',
    task: { task_id: TASK_ID, title: 'Build useful project' },
    base_revision: baseRevision,
  });
  return append(events, 'run_started', {
    turn_id: TURN_ID,
    run_id: RUN_ID,
    task_id: TASK_ID,
    attempt_number: 1,
    retry_of_run_id: null,
    input_digest: inputDigest,
  });
}

function expectInvalid(fn, forbidden = []) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof BuilderCodeChangeKernelError);
    assert.equal(error.code, 'builder_code_change_invalid');
    const serialized = JSON.stringify({
      name: error.name,
      code: error.code,
      message: error.message,
      stack: error.stack,
    });
    for (const marker of forbidden) assert.doesNotMatch(serialized, new RegExp(marker, 'iu'));
    return true;
  });
}

function baseEvidence(baseSourceTree, overrides = {}) {
  return {
    evidence_version: BUILDER_PROJECT_BASE_REVISION_EVIDENCE_VERSION,
    project_id: PROJECT_ID,
    revision_receipt_digest: ONE_DIGEST,
    commit_oid: COMMIT_OID,
    source_tree_digest: baseSourceTree.source_tree_digest,
    verification_admission: 'git_sqlite_read_authority_verified',
    ...overrides,
  };
}

function candidateInput(overrides = {}) {
  const baseSourceTree = overrides.base_source_tree || createBuilderProjectSourceTree({ files: [] });
  return {
    conversation_events: activeRunEvents(),
    turn_id: TURN_ID,
    run_id: RUN_ID,
    base_revision_evidence: null,
    base_source_tree: baseSourceTree,
    operations: [
      { operation: 'upsert', path: 'src/main.py', content: 'print("hello")\n' },
      { operation: 'upsert', path: 'README.md', content: '# Hello\n' },
    ],
    ...overrides,
  };
}

test('creates a deterministic multi-file candidate from a replayed active work run', () => {
  const first = createBuilderCodeChangeCandidate(candidateInput());
  const second = createBuilderCodeChangeCandidate(candidateInput({
    operations: [...candidateInput().operations].reverse(),
  }));

  assert.deepEqual(first, second);
  assert.equal(first.candidate_version, BUILDER_CODE_CHANGE_CANDIDATE_VERSION);
  assert.equal(first.candidate_version, 'builder-code-change-candidate.v2');
  assert.equal(first.project_id, PROJECT_ID);
  assert.equal(first.conversation_id, CONVERSATION_ID);
  assert.equal(first.turn_id, TURN_ID);
  assert.equal(first.task_id, TASK_ID);
  assert.equal(first.run_id, RUN_ID);
  assert.equal(first.request_digest, ZERO_DIGEST);
  assert.equal(first.base_revision_evidence, null);
  assert.equal(first.run_binding.binding_version, BUILDER_CODE_CHANGE_RUN_BINDING_VERSION);
  assert.equal(first.run_binding.binding_version, 'builder-code-change-run-binding.v2');
  assert.equal(first.run_binding.conversation_head.sequence, 2);
  assert.equal(first.resulting_tree_digest, first.resulting_source_tree.source_tree_digest);
  assert.deepEqual(first.resulting_source_tree.files.map((entry) => entry.path), [
    'README.md',
    'src/main.py',
  ]);
  assert.deepEqual(first.authority, {
    change_authority: BUILDER_CODE_CHANGE_AUTHORITY,
    conversation_binding_admission: 'host_verification_required',
    base_revision_binding_admission: 'host_verification_required',
    revision_admission: 'not_created',
    preview_admission: 'not_evaluated',
    execution_admission: 'not_evaluated',
  });
  assert.equal(
    first.candidate_id,
    `builder-code-change-candidate:${first.candidate_digest.slice('sha256:'.length)}`,
  );
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.run_binding));
  assert.ok(Object.isFrozen(first.operations));
});

test('allows an unsaved local workspace source tree before the first saved revision', () => {
  const base = createBuilderProjectSourceTree({
    files: [{ path: 'index.html', content: '<main>Local workspace</main>\n' }],
  });
  const value = createBuilderCodeChangeCandidate(candidateInput({
    base_source_tree: base,
    base_revision_evidence: null,
    operations: [
      { operation: 'upsert', path: 'index.html', content: '<main><h1>Focus</h1></main>\n' },
      { operation: 'upsert', path: 'src/app.js', content: 'console.log("ready");\n' },
    ],
  }));

  assert.equal(value.base_revision_evidence, null);
  assert.equal(value.run_binding.base_revision, null);
  assert.deepEqual(value.resulting_source_tree.files.map((entry) => entry.path), [
    'index.html',
    'src/app.js',
  ]);
});

test('cross-binds the replayed turn base to explicit Git and SQLite read evidence', () => {
  const base = createBuilderProjectSourceTree({
    files: [
      { path: 'README.md', content: '# Old\n' },
      { path: 'src/app.js', content: 'export const old = true;\n' },
      { path: 'src/data.json', content: '{"old":true}\n' },
    ],
  });
  const value = createBuilderCodeChangeCandidate(candidateInput({
    conversation_events: activeRunEvents({ baseRevision: BASE_REVISION, inputDigest: ONE_DIGEST }),
    base_source_tree: base,
    base_revision_evidence: baseEvidence(base),
    operations: [
      { operation: 'delete', path: 'src/data.json', content: null },
      { operation: 'upsert', path: 'src/app.js', content: 'export const old = false;\n' },
      { operation: 'upsert', path: 'src/view.tsx', content: 'export function View() { return null; }\n' },
    ],
  }));

  assert.equal(value.request_digest, ONE_DIGEST);
  assert.deepEqual(value.run_binding.base_revision, BASE_REVISION);
  assert.deepEqual(value.base_revision_evidence, baseEvidence(base));
  assert.deepEqual(value.resulting_source_tree.files.map((entry) => entry.path), [
    'README.md',
    'src/app.js',
    'src/view.tsx',
  ]);
});

test('revalidates stored candidate transforms but honestly retains host verification requirements', () => {
  const value = createBuilderCodeChangeCandidate(candidateInput());
  const safe = sanitizeBuilderCodeChangeCandidate(structuredClone(value));
  assert.deepEqual(safe, value);
  assert.notEqual(safe, value);
  assert.equal(safe.authority.conversation_binding_admission, 'host_verification_required');

  const changedOperation = structuredClone(value);
  changedOperation.operations[0].content = '# Changed\n';
  expectInvalid(() => sanitizeBuilderCodeChangeCandidate(changedOperation));

  const changedBinding = structuredClone(value);
  changedBinding.run_binding.request_digest = ONE_DIGEST;
  expectInvalid(() => sanitizeBuilderCodeChangeCandidate(changedBinding));

  const changedAuthority = structuredClone(value);
  changedAuthority.authority.conversation_binding_admission = 'verified';
  expectInvalid(() => sanitizeBuilderCodeChangeCandidate(changedAuthority));

  const oldCandidateVersion = structuredClone(value);
  oldCandidateVersion.candidate_version = 'builder-code-change-candidate.v1';
  expectInvalid(() => sanitizeBuilderCodeChangeCandidate(oldCandidateVersion));

  const oldRunBindingVersion = structuredClone(value);
  oldRunBindingVersion.run_binding.binding_version = 'builder-code-change-run-binding.v1';
  expectInvalid(() => sanitizeBuilderCodeChangeCandidate(oldRunBindingVersion));
});

test('rejects fabricated lifecycle selections and stale or missing base evidence', () => {
  expectInvalid(() => createBuilderCodeChangeCandidate(candidateInput({
    turn_id: id('turn', 2),
  })));
  expectInvalid(() => createBuilderCodeChangeCandidate(candidateInput({
    run_id: id('run', 2),
  })));

  const base = createBuilderProjectSourceTree({
    files: [{ path: 'src/app.js', content: 'export const value = 1;\n' }],
  });
  expectInvalid(() => createBuilderCodeChangeCandidate(candidateInput({
    conversation_events: activeRunEvents({
      baseRevision: BASE_REVISION,
    }),
    base_source_tree: base,
    base_revision_evidence: null,
  })));
  expectInvalid(() => createBuilderCodeChangeCandidate(candidateInput({
    conversation_events: activeRunEvents({
      baseRevision: BASE_REVISION,
    }),
    base_source_tree: base,
    base_revision_evidence: baseEvidence(base, { revision_receipt_digest: ZERO_DIGEST }),
  })));
  expectInvalid(() => createBuilderCodeChangeCandidate(candidateInput({
    conversation_events: activeRunEvents({
      baseRevision: BASE_REVISION,
    }),
    base_source_tree: base,
    base_revision_evidence: baseEvidence(base, { commit_oid: OTHER_COMMIT_OID }),
  })));
  expectInvalid(() => createBuilderCodeChangeCandidate(candidateInput({
    conversation_events: activeRunEvents({
      baseRevision: BASE_REVISION,
    }),
    base_source_tree: base,
    base_revision_evidence: {
      evidence_version: 'builder-project-base-revision-evidence.v1',
      project_id: PROJECT_ID,
      revision: 7,
      revision_digest: ONE_DIGEST,
      source_tree_digest: base.source_tree_digest,
      verification_admission: 'host_verification_required',
    },
  })));
  expectInvalid(() => createBuilderCodeChangeCandidate(candidateInput({
    base_source_tree: base,
    base_revision_evidence: baseEvidence(base),
  })));
});

test('rejects missing deletes, folded duplicate paths, semantic no-ops, and hidden properties', () => {
  const base = createBuilderProjectSourceTree({
    files: [{ path: 'src/app.js', content: 'export const value = 1;\n' }],
  });
  const common = {
    conversation_events: activeRunEvents({ baseRevision: BASE_REVISION }),
    base_source_tree: base,
    base_revision_evidence: baseEvidence(base),
  };
  expectInvalid(() => createBuilderCodeChangeCandidate(candidateInput({
    ...common,
    operations: [{ operation: 'delete', path: 'missing.js', content: null }],
  })));
  expectInvalid(() => createBuilderCodeChangeCandidate(candidateInput({
    operations: [
      { operation: 'upsert', path: 'src/Ａpp.js', content: 'one' },
      { operation: 'upsert', path: 'src/app.js', content: 'two' },
    ],
  })));
  expectInvalid(() => createBuilderCodeChangeCandidate(candidateInput({
    ...common,
    operations: [{ operation: 'upsert', path: 'src/app.js', content: 'export const value = 1;\n' }],
  })));

  const accessor = {};
  Object.defineProperty(accessor, 'operation', { enumerable: true, get: () => 'upsert' });
  Object.defineProperty(accessor, 'path', { enumerable: true, value: 'a.txt' });
  Object.defineProperty(accessor, 'content', { enumerable: true, value: 'a' });
  expectInvalid(() => createBuilderCodeChangeCandidate(candidateInput({ operations: [accessor] })));

  let trapCalls = 0;
  const proxiedEvents = new Proxy(activeRunEvents(), {
    ownKeys() {
      trapCalls += 1;
      return ['0', '1', 'length'];
    },
  });
  expectInvalid(() => createBuilderCodeChangeCandidate(candidateInput({
    conversation_events: proxiedEvents,
  })));
  assert.equal(trapCalls, 0);
});

test('enforces aggregate operation and candidate bounds and redacts rejected source', () => {
  const largeOperations = Array.from({ length: 9 }, (_, index) => ({
    operation: 'upsert',
    path: `files/${index}.txt`,
    content: 'a'.repeat(MAX_SOURCE_FILE_UTF8_BYTES),
  }));
  expectInvalid(() => createBuilderCodeChangeCandidate(candidateInput({
    operations: largeOperations,
  })));
  const marker = 'sk-abcdefghijklmnopqrstuv';
  expectInvalid(() => createBuilderCodeChangeCandidate(candidateInput({
    operations: [{ operation: 'upsert', path: 'config.js', content: marker }],
  })), [marker]);

  assert.equal(MAX_CODE_CHANGE_OPERATION_UTF8_BYTES, 4 * 1_024 * 1_024);
  assert.equal(MAX_CODE_CHANGE_CANDIDATE_UTF8_BYTES, 16 * 1_024 * 1_024);
});

test('stays pure and requires a future host to load committed conversation and revision evidence', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-code-change-kernel.cjs'),
    'utf8',
  );
  assert.doesNotMatch(
    source,
    /ipcMain|ipcRenderer|preload|repository|provider|child_process|fetch\s*\(|spawn\s*\(|execFile\s*\(|ChatCreatePage|Canvas|JobMeta|local-provider-executor/iu,
  );
  assert.match(source, /replayBuilderConversation/u);
  assert.match(source, /host_verification_required/u);
  assert.match(source, /revision_admission: 'not_created'/u);
  assert.match(source, /execution_admission: 'not_evaluated'/u);
  assert.ok(
    source.indexOf('totalContentBytes += Buffer.byteLength')
      < source.indexOf('operations.push(safe)'),
  );
});
