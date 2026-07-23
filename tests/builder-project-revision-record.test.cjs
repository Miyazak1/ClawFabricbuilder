'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  BUILDER_PROJECT_CODE_CHANGE_EVIDENCE_VERSION,
  BUILDER_PROJECT_REVISION_INVALID_REASON,
  BUILDER_PROJECT_SCHEMA_VERSION_V2,
  BUILDER_PROJECT_STATIC_PREVIEW_REASON,
  MAX_RECORD_BYTES,
  MAX_V2_RECORD_BYTES,
  BuilderProjectRevisionRecordError,
  createBuilderProjectRevisionRecordV2,
  digestBuilderProjectProposalRecord,
  digestBuilderProjectRevisionRecord,
  digestBuilderProjectRevisionRecordV2,
  sanitizeBuilderProjectRevisionRecord,
  sanitizeBuilderProjectRevisionRecordV2,
  serializeBuilderProjectRevisionRecord,
  serializeBuilderProjectRevisionRecordV2,
} = require('../electron/builder-project-revision-record.cjs');
const {
  CONVERSATION_AUTHORITY,
  CONVERSATION_EVENT_KIND,
  CONVERSATION_EVENT_VERSION,
  createBuilderConversationEvent,
} = require('../electron/builder-conversation-records.cjs');
const {
  BUILDER_CODE_CHANGE_CANDIDATE_VERSION,
  BUILDER_PROJECT_BASE_REVISION_EVIDENCE_VERSION,
  createBuilderCodeChangeCandidate,
} = require('../electron/builder-code-change-kernel.cjs');
const {
  createBuilderProjectSourceTree,
} = require('../electron/builder-project-source-tree.cjs');

const UUID = '123e4567-e89b-42d3-a456-426614174000';
const PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174000';
const CONVERSATION_ID = `builder-conversation:${UUID}`;
const REQUEST_DIGEST = `sha256:${'a'.repeat(64)}`;
const ZERO_DIGEST = `sha256:${'0'.repeat(64)}`;

function uuid(index) {
  return `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;
}

function id(kind, index) {
  return `builder-${kind}:${uuid(index)}`;
}

const TURN_ID = id('turn', 1);
const TASK_ID = id('task', 1);
const RUN_ID = id('run', 1);

function fixture(overrides = {}) {
  const revision = overrides.revision ?? 1;
  const parent = overrides.parent_revision ?? null;
  const projectId = overrides.project_id ?? PROJECT_ID;
  const candidate = {
    schema_version: 1,
    record_kind: 'builder_project_revision',
    project_id: projectId,
    revision,
    revision_digest: `sha256:${'0'.repeat(64)}`,
    parent_revision: parent,
    title: overrides.title ?? 'Daily focus board',
    summary: overrides.summary ?? 'A small board for today\'s priorities.',
    files: overrides.files ?? {
      'index.html': '<main><h1>Today</h1><section class="board"></section></main>',
      'styles.css': '.board { display: grid; gap: 1rem; }',
      'app.js': 'const board = document.querySelector(".board");\nvoid board;',
    },
    proposal_evidence: {
      authority: 'builder_code_project_generator',
      prompt_version: overrides.prompt_version ?? 'builder-code-project.v1',
      request_version: 'builder-generation-request.v1',
      result_version: 'builder-generation-result.v1',
      request_digest: REQUEST_DIGEST,
      proposal_digest: `sha256:${'0'.repeat(64)}`,
      project_id: projectId,
      target_revision: revision,
      parent_revision: parent,
    },
    execution_admission: 'not_evaluated',
    preview_script_admission: 'not_authorized',
  };
  candidate.proposal_evidence.proposal_digest = digestBuilderProjectProposalRecord(candidate);
  candidate.revision_digest = digestBuilderProjectRevisionRecord(candidate);
  return candidate;
}

function appendConversationEvent(events, eventType, payload) {
  const previous = events.at(-1) ?? null;
  return [...events, createBuilderConversationEvent({
    record_version: CONVERSATION_EVENT_VERSION,
    record_kind: CONVERSATION_EVENT_KIND,
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    sequence: events.length + 1,
    command_id: id('command', events.length + 1),
    event_type: eventType,
    previous_event: previous === null ? null : {
      sequence: previous.sequence,
      event_id: previous.event_id,
      event_digest: previous.event_digest,
    },
    payload,
    authority: { ...CONVERSATION_AUTHORITY },
  })];
}

function sourceTreeForFixtureRecord(parent) {
  if (parent === null) return createBuilderProjectSourceTree({ files: [] });
  if (parent.schema_version === BUILDER_PROJECT_SCHEMA_VERSION_V2) return parent.source_tree;
  return createBuilderProjectSourceTree({
    files: Object.entries(parent.files).map(([filePath, content]) => ({
      path: filePath,
      content,
    })),
  });
}

function candidateForParent(parent, operations = [
  { operation: 'upsert', path: 'src/main.py', content: 'print("hello")\n' },
  { operation: 'upsert', path: 'README.md', content: '# Hello\n' },
]) {
  const baseSourceTree = sourceTreeForFixtureRecord(parent);
  const baseRevision = parent === null ? null : {
    revision: parent.revision,
    revision_digest: parent.revision_digest,
  };
  let events = appendConversationEvent([], 'turn_submitted', {
    message: { message_id: id('message', 1), text: 'Build a useful project.' },
    turn_id: TURN_ID,
    mode: 'work',
    task: { task_id: TASK_ID, title: 'Build useful project' },
    base_revision: baseRevision,
  });
  events = appendConversationEvent(events, 'run_started', {
    turn_id: TURN_ID,
    run_id: RUN_ID,
    task_id: TASK_ID,
    attempt_number: 1,
    retry_of_run_id: null,
    input_digest: REQUEST_DIGEST,
  });
  return createBuilderCodeChangeCandidate({
    conversation_events: events,
    turn_id: TURN_ID,
    run_id: RUN_ID,
    base_revision_evidence: parent === null ? null : {
      evidence_version: BUILDER_PROJECT_BASE_REVISION_EVIDENCE_VERSION,
      project_id: PROJECT_ID,
      revision: parent.revision,
      revision_digest: parent.revision_digest,
      source_tree_digest: baseSourceTree.source_tree_digest,
      verification_admission: 'host_verification_required',
    },
    base_source_tree: baseSourceTree,
    operations,
  });
}

function v2Fixture(parent = fixture(), overrides = {}) {
  const candidate = overrides.candidate ?? candidateForParent(parent, overrides.operations);
  return createBuilderProjectRevisionRecordV2({
    candidate,
    parent_revision_record: Object.hasOwn(overrides, 'parent_revision_record')
      ? overrides.parent_revision_record
      : parent,
    title: overrides.title ?? 'Daily focus board v2',
    summary: overrides.summary ?? 'A multi-file project saved from a verified change candidate.',
  });
}

function expectInvalid(value, reason = BUILDER_PROJECT_REVISION_INVALID_REASON) {
  assert.throws(
    () => sanitizeBuilderProjectRevisionRecord(value),
    (error) => error instanceof BuilderProjectRevisionRecordError
      && error.code === 'builder_project_revision_invalid'
      && error.reason === reason
      && !JSON.stringify(error).includes(PROJECT_ID),
  );
}

function expectV2Invalid(value) {
  assert.throws(
    () => sanitizeBuilderProjectRevisionRecordV2(value),
    (error) => error instanceof BuilderProjectRevisionRecordError
      && error.code === 'builder_project_revision_invalid'
      && error.reason === BUILDER_PROJECT_REVISION_INVALID_REASON
      && !JSON.stringify(error).includes(PROJECT_ID),
  );
}

test('sanitizes the C0 BuilderProjectRevision wire into a fresh deeply frozen record', () => {
  const input = fixture();
  const result = sanitizeBuilderProjectRevisionRecord(input);

  assert.deepEqual(result, input);
  assert.notStrictEqual(result, input);
  assert.notStrictEqual(result.files, input.files);
  assert.notStrictEqual(result.proposal_evidence, input.proposal_evidence);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.files), true);
  assert.equal(Object.isFrozen(result.proposal_evidence), true);
  assert.equal(
    serializeBuilderProjectRevisionRecord(result),
    serializeBuilderProjectRevisionRecord(structuredClone(result)),
  );

  input.files['index.html'] = '<main>changed</main>';
  assert.match(result.files['index.html'], /Today/u);
});

test('keeps the legacy v1 digest and canonical bytes frozen', () => {
  const legacy = fixture();
  assert.equal(
    legacy.proposal_evidence.proposal_digest,
    'sha256:2d3ba66de468f8dd31bf60ab36ce3e95b60361e09a6d07511f407f7361e85af0',
  );
  assert.equal(
    legacy.revision_digest,
    'sha256:a70a6e02fdadf7c585ab007350f580f6f163120a62141a9b71bee4fa5c6887a9',
  );
  assert.equal(
    serializeBuilderProjectRevisionRecord(legacy),
    '{"execution_admission":"not_evaluated","files":{"app.js":"const board = document.querySelector(\\".board\\");\\nvoid board;","index.html":"<main><h1>Today</h1><section class=\\"board\\"></section></main>","styles.css":".board { display: grid; gap: 1rem; }"},"parent_revision":null,"preview_script_admission":"not_authorized","project_id":"builder-project:123e4567-e89b-42d3-a456-426614174000","proposal_evidence":{"authority":"builder_code_project_generator","parent_revision":null,"project_id":"builder-project:123e4567-e89b-42d3-a456-426614174000","prompt_version":"builder-code-project.v1","proposal_digest":"sha256:2d3ba66de468f8dd31bf60ab36ce3e95b60361e09a6d07511f407f7361e85af0","request_digest":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","request_version":"builder-generation-request.v1","result_version":"builder-generation-result.v1","target_revision":1},"record_kind":"builder_project_revision","revision":1,"revision_digest":"sha256:a70a6e02fdadf7c585ab007350f580f6f163120a62141a9b71bee4fa5c6887a9","schema_version":1,"summary":"A small board for today\'s priorities.","title":"Daily focus board"}\n',
  );
});

test('preserves legacy v1 evidence, accepts v2 evidence, and rejects unknown prompt versions', () => {
  const legacy = fixture();
  const legacySerialized = serializeBuilderProjectRevisionRecord(legacy);
  const safeLegacy = sanitizeBuilderProjectRevisionRecord(structuredClone(legacy));
  assert.equal(safeLegacy.proposal_evidence.prompt_version, 'builder-code-project.v1');
  assert.equal(safeLegacy.revision_digest, legacy.revision_digest);
  assert.equal(serializeBuilderProjectRevisionRecord(safeLegacy), legacySerialized);

  const current = fixture({ prompt_version: 'builder-code-project.v2' });
  const safeCurrent = sanitizeBuilderProjectRevisionRecord(current);
  assert.equal(safeCurrent.proposal_evidence.prompt_version, 'builder-code-project.v2');
  assert.equal(safeCurrent.revision_digest, current.revision_digest);

  const relabeledLegacy = structuredClone(legacy);
  relabeledLegacy.proposal_evidence.prompt_version = 'builder-code-project.v2';
  expectInvalid(relabeledLegacy);

  const unknown = structuredClone(current);
  unknown.proposal_evidence.prompt_version = 'builder-code-project.v3';
  expectInvalid(unknown);
});

test('binds proposal and revision digests to the complete canonical revision evidence', () => {
  const valid = fixture();
  for (const mutation of [
    (value) => { value.title = 'Changed'; },
    (value) => { value.files['styles.css'] = '.board { display: block; }'; },
    (value) => { value.proposal_evidence.request_digest = `sha256:${'b'.repeat(64)}`; },
    (value) => { value.proposal_evidence.result_version = 'builder-generation-result.v2'; },
    (value) => { value.project_id = 'builder-project:123e4567-e89b-42d3-a456-426614174001'; },
  ]) {
    const changed = structuredClone(valid);
    mutation(changed);
    expectInvalid(changed);
  }
});

test('enforces exact parent, project, generator, and non-execution facts', () => {
  const parent = fixture();
  const revisionTwo = fixture({
    revision: 2,
    parent_revision: { revision: parent.revision, revision_digest: parent.revision_digest },
  });
  assert.equal(sanitizeBuilderProjectRevisionRecord(revisionTwo).revision, 2);

  for (const mutation of [
    (value) => { value.parent_revision.revision = 7; },
    (value) => { value.proposal_evidence.parent_revision = null; },
    (value) => { value.proposal_evidence.authority = 'chat_planner'; },
    (value) => { value.execution_admission = 'authorized'; },
    (value) => { value.preview_script_admission = 'authorized'; },
  ]) {
    const changed = structuredClone(revisionTwo);
    mutation(changed);
    expectInvalid(changed);
  }
});

test('rejects active HTML, network CSS, modules, local paths, and credential material', () => {
  for (const [files, reason] of [
    [{ ...fixture().files, 'index.html': '<template><script>alert(1)</script></template>' }, BUILDER_PROJECT_STATIC_PREVIEW_REASON],
    [{ ...fixture().files, 'index.html': '<img srcset="https://example.test/a.png 1x">' }, BUILDER_PROJECT_STATIC_PREVIEW_REASON],
    [{ ...fixture().files, 'index.html': '<img/src="https://example.test/a.png">' }, BUILDER_PROJECT_STATIC_PREVIEW_REASON],
    [{ ...fixture().files, 'index.html': '<div/style="background:url(https://example.test/a.png)">' }, BUILDER_PROJECT_STATIC_PREVIEW_REASON],
    [{ ...fixture().files, 'styles.css': '.x { background: image-set("https://example.test/a.png" 1x); }' }, BUILDER_PROJECT_STATIC_PREVIEW_REASON],
    [{ ...fixture().files, 'app.js': 'import x from "./x.js";' }, BUILDER_PROJECT_STATIC_PREVIEW_REASON],
    [{ ...fixture().files, 'app.js': 'const p = "C:\\Users\\person\\private.txt";' }, BUILDER_PROJECT_REVISION_INVALID_REASON],
    [{ ...fixture().files, 'app.js': 'const api_key = "sk-abcdefghijklmnop";' }, BUILDER_PROJECT_REVISION_INVALID_REASON],
  ]) {
    const changed = fixture();
    changed.files = files;
    expectInvalid(changed, reason);
    assert.throws(
      () => digestBuilderProjectProposalRecord(changed),
      (error) => error instanceof BuilderProjectRevisionRecordError
        && error.reason === reason,
    );
  }
});

test('keeps internal error reasons fixed and allowlisted', () => {
  assert.equal(
    new BuilderProjectRevisionRecordError('private-reason-marker').reason,
    BUILDER_PROJECT_REVISION_INVALID_REASON,
  );
  assert.equal(
    new BuilderProjectRevisionRecordError(BUILDER_PROJECT_STATIC_PREVIEW_REASON).reason,
    BUILDER_PROJECT_STATIC_PREVIEW_REASON,
  );
});

test('rejects oversized, malformed Unicode, extra, accessor, symbol, and proxy surfaces', () => {
  const oversized = fixture();
  oversized.files['app.js'] = 'a'.repeat(128 * 1024 + 1);
  expectInvalid(oversized);

  const malformedUnicode = fixture();
  malformedUnicode.title = `bad${String.fromCharCode(0xd800)}`;
  expectInvalid(malformedUnicode);

  const extra = fixture();
  extra.raw_provider_result = { text: 'hidden' };
  expectInvalid(extra);

  const accessor = fixture();
  Object.defineProperty(accessor, 'hidden', { enumerable: false, get: () => 'secret-marker' });
  expectInvalid(accessor);

  const symbol = fixture();
  symbol[Symbol('hidden')] = 'secret-marker';
  expectInvalid(symbol);

  const proxied = new Proxy(fixture(), {
    ownKeys: (target) => Reflect.ownKeys(target),
  });
  expectInvalid(proxied);
});

test('digest helpers reject proxies and accessors without invoking attacker-controlled traps', () => {
  const valid = fixture();
  let proxyReads = 0;
  const proxied = new Proxy(valid, {
    get() {
      proxyReads += 1;
      throw new Error('secret-marker');
    },
  });
  assert.throws(
    () => digestBuilderProjectRevisionRecord(proxied),
    (error) => error instanceof BuilderProjectRevisionRecordError,
  );
  assert.equal(proxyReads, 0);

  let accessorReads = 0;
  const accessor = fixture();
  Object.defineProperty(accessor, 'title', {
    enumerable: true,
    get() {
      accessorReads += 1;
      throw new Error('secret-marker');
    },
  });
  assert.throws(
    () => digestBuilderProjectProposalRecord(accessor),
    (error) => error instanceof BuilderProjectRevisionRecordError,
  );
  assert.equal(accessorReads, 0);
});

test('creates a v2 multi-file revision over an exact legacy parent without granting execution', () => {
  const parent = fixture();
  const candidate = candidateForParent(parent, [
    { operation: 'upsert', path: 'src/main.py', content: 'print("hello")\n' },
    { operation: 'upsert', path: 'src/app.mjs', content: 'export const ready = true;\n' },
    {
      operation: 'upsert',
      path: 'index.html',
      content: '<script type="module" src="./src/app.mjs"></script>',
    },
  ]);
  const record = v2Fixture(parent, { candidate });

  assert.equal(record.schema_version, BUILDER_PROJECT_SCHEMA_VERSION_V2);
  assert.equal(record.revision, 2);
  assert.deepEqual(record.parent_revision, {
    revision: parent.revision,
    revision_digest: parent.revision_digest,
  });
  assert.equal(record.source_tree_digest, candidate.resulting_tree_digest);
  assert.deepEqual(record.source_tree, candidate.resulting_source_tree);
  assert.deepEqual(record.source_tree.files.map((entry) => entry.path), [
    'app.js',
    'index.html',
    'src/app.mjs',
    'src/main.py',
    'styles.css',
  ]);
  assert.deepEqual(record.change_evidence, {
    evidence_version: BUILDER_PROJECT_CODE_CHANGE_EVIDENCE_VERSION,
    candidate_version: BUILDER_CODE_CHANGE_CANDIDATE_VERSION,
    candidate_id: candidate.candidate_id,
    candidate_digest: candidate.candidate_digest,
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    turn_id: TURN_ID,
    task_id: TASK_ID,
    run_id: RUN_ID,
    request_digest: REQUEST_DIGEST,
    base_revision: {
      revision: parent.revision,
      revision_digest: parent.revision_digest,
      source_tree_digest: candidate.base_source_tree.source_tree_digest,
    },
    resulting_tree_digest: candidate.resulting_tree_digest,
    candidate_verification_admission: 'host_verification_required',
  });
  assert.equal(record.preview_admission, 'not_evaluated');
  assert.equal(record.execution_admission, 'not_evaluated');
  assert.equal(Object.hasOwn(record, 'files'), false);
  assert.equal(Object.hasOwn(record, 'proposal_evidence'), false);
  assert.equal(Object.isFrozen(record), true);
  assert.equal(Object.isFrozen(record.source_tree), true);
  assert.equal(Object.isFrozen(record.change_evidence), true);

  const safe = sanitizeBuilderProjectRevisionRecordV2(structuredClone(record));
  assert.deepEqual(safe, record);
  assert.notStrictEqual(safe, record);
  assert.notStrictEqual(safe.source_tree, record.source_tree);
  assert.equal(digestBuilderProjectRevisionRecordV2(record), record.revision_digest);
  assert.equal(
    serializeBuilderProjectRevisionRecordV2(record),
    serializeBuilderProjectRevisionRecordV2(safe),
  );
});

test('creates a v2 genesis revision and preserves host verification requirements', () => {
  const candidate = candidateForParent(null, [
    { operation: 'upsert', path: 'src/main.rs', content: 'fn main() {}\n' },
    { operation: 'upsert', path: 'Cargo.toml', content: '[package]\nname = "tool"\n' },
  ]);
  const record = v2Fixture(null, { candidate });

  assert.equal(record.revision, 1);
  assert.equal(record.parent_revision, null);
  assert.equal(record.change_evidence.base_revision, null);
  assert.equal(
    record.change_evidence.candidate_verification_admission,
    'host_verification_required',
  );
  assert.equal(record.preview_admission, 'not_evaluated');
  assert.equal(record.execution_admission, 'not_evaluated');
  assert.deepEqual(record.source_tree.files.map((entry) => entry.path), [
    'Cargo.toml',
    'src/main.rs',
  ]);
});

test('keeps v2 behind explicit APIs while generic repository entrypoints remain v1-only', () => {
  const record = v2Fixture();
  assert.deepEqual(sanitizeBuilderProjectRevisionRecordV2(record), record);
  assert.equal(digestBuilderProjectRevisionRecordV2(record), record.revision_digest);
  assert.match(serializeBuilderProjectRevisionRecordV2(record), /"schema_version":2/u);

  for (const operation of [
    () => sanitizeBuilderProjectRevisionRecord(record),
    () => digestBuilderProjectRevisionRecord(record),
    () => serializeBuilderProjectRevisionRecord(record),
  ]) {
    assert.throws(
      operation,
      (error) => error instanceof BuilderProjectRevisionRecordError
        && error.code === 'builder_project_revision_invalid',
    );
  }
});

test('uses the complete v2 parent source tree for the next candidate base', () => {
  const parent = v2Fixture(null, {
    candidate: candidateForParent(null, [
      { operation: 'upsert', path: 'src/main.go', content: 'package main\n' },
      { operation: 'upsert', path: 'go.mod', content: 'module example.test/tool\n' },
    ]),
  });
  const candidate = candidateForParent(parent, [
    {
      operation: 'upsert',
      path: 'src/main.go',
      content: 'package main\n\nfunc main() {}\n',
    },
  ]);
  const next = v2Fixture(parent, { candidate });

  assert.equal(next.revision, 2);
  assert.equal(
    next.change_evidence.base_revision.source_tree_digest,
    parent.source_tree_digest,
  );
  assert.equal(candidate.base_source_tree.source_tree_digest, parent.source_tree_digest);
  assert.deepEqual(next.parent_revision, {
    revision: parent.revision,
    revision_digest: parent.revision_digest,
  });
});

test('cross-checks the candidate project, base revision, parent, and resulting tree', () => {
  const parent = fixture();
  const candidate = candidateForParent(parent);
  const differentParent = fixture({ title: 'Different parent title' });

  for (const input of [
    {
      candidate,
      parent_revision_record: differentParent,
      title: 'Changed project',
      summary: 'This must not bind to a different parent digest.',
    },
    {
      candidate,
      parent_revision_record: null,
      title: 'Missing parent',
      summary: 'A based candidate cannot become a genesis revision.',
    },
  ]) {
    assert.throws(
      () => createBuilderProjectRevisionRecordV2(input),
      (error) => error instanceof BuilderProjectRevisionRecordError
        && error.code === 'builder_project_revision_invalid',
    );
  }

  const valid = v2Fixture(parent, { candidate });
  for (const mutation of [
    (value) => { value.source_tree.files[0].content = 'tampered'; },
    (value) => { value.source_tree_digest = ZERO_DIGEST; },
    (value) => { value.change_evidence.project_id = 'builder-project:123e4567-e89b-42d3-a456-426614174001'; },
    (value) => { value.change_evidence.candidate_id = `builder-code-change-candidate:${'1'.repeat(64)}`; },
    (value) => { value.change_evidence.base_revision.revision_digest = ZERO_DIGEST; },
    (value) => { value.change_evidence.resulting_tree_digest = ZERO_DIGEST; },
    (value) => { value.preview_admission = 'eligible'; },
    (value) => { value.execution_admission = 'authorized'; },
  ]) {
    const changed = structuredClone(valid);
    mutation(changed);
    expectV2Invalid(changed);
    assert.throws(
      () => digestBuilderProjectRevisionRecordV2(changed),
      (error) => error instanceof BuilderProjectRevisionRecordError,
    );
  }
});

test('allows bounded v2 source records larger than the legacy three-file envelope', () => {
  const contentA = 'a'.repeat(300 * 1024);
  const contentB = 'b'.repeat(300 * 1024);
  const record = v2Fixture(null, {
    candidate: candidateForParent(null, [
      { operation: 'upsert', path: 'src/a.txt', content: contentA },
      { operation: 'upsert', path: 'src/b.txt', content: contentB },
    ]),
  });
  const serialized = serializeBuilderProjectRevisionRecordV2(record);
  assert.ok(Buffer.byteLength(serialized, 'utf8') > MAX_RECORD_BYTES);
  assert.ok(Buffer.byteLength(serialized, 'utf8') <= MAX_V2_RECORD_BYTES);
});

test('rejects malformed v2 envelopes without leaking attacker-controlled material', () => {
  const record = v2Fixture();
  const cases = [];

  const extra = structuredClone(record);
  extra.provider_response = 'secret-marker';
  cases.push(extra);

  const hidden = structuredClone(record);
  Object.defineProperty(hidden, 'hidden', {
    enumerable: false,
    value: 'secret-marker',
  });
  cases.push(hidden);

  const symbol = structuredClone(record);
  symbol[Symbol('hidden')] = 'secret-marker';
  cases.push(symbol);

  const malformedUnicode = structuredClone(record);
  malformedUnicode.title = `bad${String.fromCharCode(0xd800)}`;
  cases.push(malformedUnicode);

  const unknownSchema = structuredClone(record);
  unknownSchema.schema_version = 3;
  cases.push(unknownSchema);

  for (const value of cases) expectV2Invalid(value);

  const createInput = {
    candidate: candidateForParent(null),
    parent_revision_record: null,
    title: 'Create input',
    summary: 'An exact v2 creation request.',
  };
  for (const value of [
    { ...createInput, provider_result: 'secret-marker' },
    { ...createInput, [Symbol('hidden')]: 'secret-marker' },
  ]) {
    assert.throws(
      () => createBuilderProjectRevisionRecordV2(value),
      (error) => error instanceof BuilderProjectRevisionRecordError
        && !JSON.stringify(error).includes('secret-marker'),
    );
  }

  let proxyReads = 0;
  const proxied = new Proxy(createInput, {
    get() {
      proxyReads += 1;
      throw new Error('secret-marker');
    },
  });
  assert.throws(
    () => createBuilderProjectRevisionRecordV2(proxied),
    (error) => {
      assert.ok(error instanceof BuilderProjectRevisionRecordError);
      assert.doesNotMatch(JSON.stringify(error), /secret-marker|builder-project:/iu);
      return true;
    },
  );
  assert.equal(proxyReads, 0);

  let createAccessorReads = 0;
  const createAccessor = { ...createInput };
  Object.defineProperty(createAccessor, 'title', {
    enumerable: true,
    get() {
      createAccessorReads += 1;
      throw new Error('secret-marker');
    },
  });
  assert.throws(
    () => createBuilderProjectRevisionRecordV2(createAccessor),
    (error) => error instanceof BuilderProjectRevisionRecordError,
  );
  assert.equal(createAccessorReads, 0);

  let accessorReads = 0;
  const accessor = structuredClone(record);
  Object.defineProperty(accessor, 'change_evidence', {
    enumerable: true,
    get() {
      accessorReads += 1;
      throw new Error('secret-marker');
    },
  });
  expectV2Invalid(accessor);
  assert.equal(accessorReads, 0);
});

test('rejects oversized display text before trim, normalization, or code-point allocation', () => {
  const oversized = structuredClone(v2Fixture());
  oversized.title = 'x'.repeat(161);
  const originalTrim = String.prototype.trim;
  const originalNormalize = String.prototype.normalize;
  const originalArrayFrom = Array.from;
  let expensiveCalls = 0;
  String.prototype.trim = function countedTrim(...args) {
    expensiveCalls += 1;
    return originalTrim.apply(this, args);
  };
  String.prototype.normalize = function countedNormalize(...args) {
    expensiveCalls += 1;
    return originalNormalize.apply(this, args);
  };
  Array.from = function countedArrayFrom(...args) {
    expensiveCalls += 1;
    return originalArrayFrom.apply(this, args);
  };
  let caught;
  try {
    sanitizeBuilderProjectRevisionRecordV2(oversized);
  } catch (error) {
    caught = error;
  } finally {
    String.prototype.trim = originalTrim;
    String.prototype.normalize = originalNormalize;
    Array.from = originalArrayFrom;
  }
  assert.ok(caught instanceof BuilderProjectRevisionRecordError);
  assert.equal(expensiveCalls, 0);
});

test('record source has no product authority outside the Builder revision contract', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-project-revision-record.cjs'),
    'utf8',
  );
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|fetch\s*\(|axios|ipcRenderer|ipcMain/u);
  assert.doesNotMatch(source, /ChatCreatePage|chat_planner|localChat|Canvas|JobMeta|server workspace/iu);
  assert.doesNotMatch(source, /eval\s*\(|new Function|child_process|worker_threads/u);
});
