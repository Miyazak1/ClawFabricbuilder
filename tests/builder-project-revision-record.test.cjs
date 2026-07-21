'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  BuilderProjectRevisionRecordError,
  digestBuilderProjectProposalRecord,
  digestBuilderProjectRevisionRecord,
  sanitizeBuilderProjectRevisionRecord,
  serializeBuilderProjectRevisionRecord,
} = require('../electron/builder-project-revision-record.cjs');

const PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174000';
const REQUEST_DIGEST = `sha256:${'a'.repeat(64)}`;

function fixture(overrides = {}) {
  const revision = overrides.revision ?? 1;
  const parent = overrides.parent_revision ?? null;
  const candidate = {
    schema_version: 1,
    record_kind: 'builder_project_revision',
    project_id: PROJECT_ID,
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
      prompt_version: 'builder-code-project.v1',
      request_version: 'builder-generation-request.v1',
      result_version: 'builder-generation-result.v1',
      request_digest: REQUEST_DIGEST,
      proposal_digest: `sha256:${'0'.repeat(64)}`,
      project_id: PROJECT_ID,
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

function expectInvalid(value) {
  assert.throws(
    () => sanitizeBuilderProjectRevisionRecord(value),
    (error) => error instanceof BuilderProjectRevisionRecordError
      && error.code === 'builder_project_revision_invalid'
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
  for (const files of [
    { ...fixture().files, 'index.html': '<template><script>alert(1)</script></template>' },
    { ...fixture().files, 'index.html': '<img srcset="https://example.test/a.png 1x">' },
    { ...fixture().files, 'index.html': '<img/src="https://example.test/a.png">' },
    { ...fixture().files, 'index.html': '<div/style="background:url(https://example.test/a.png)">' },
    { ...fixture().files, 'styles.css': '.x { background: image-set("https://example.test/a.png" 1x); }' },
    { ...fixture().files, 'app.js': 'import x from "./x.js";' },
    { ...fixture().files, 'app.js': 'const p = "C:\\Users\\person\\private.txt";' },
    { ...fixture().files, 'app.js': 'const api_key = "sk-abcdefghijklmnop";' },
  ]) {
    const changed = fixture();
    changed.files = files;
    expectInvalid(changed);
    assert.throws(
      () => digestBuilderProjectProposalRecord(changed),
      (error) => error instanceof BuilderProjectRevisionRecordError,
    );
  }
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

test('record source has no product authority outside the Builder revision contract', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-project-revision-record.cjs'),
    'utf8',
  );
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|fetch\s*\(|axios|ipcRenderer|ipcMain/u);
  assert.doesNotMatch(source, /ChatCreatePage|chat_planner|localChat|Canvas|JobMeta|server workspace/iu);
  assert.doesNotMatch(source, /eval\s*\(|new Function|child_process|worker_threads/u);
});
