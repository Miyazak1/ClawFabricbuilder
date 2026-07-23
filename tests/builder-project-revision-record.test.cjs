'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const revisionRecordModule = require('../electron/builder-project-revision-record.cjs');

const {
  BUILDER_PROJECT_REVISION_INVALID_REASON,
  BUILDER_PROJECT_STATIC_PREVIEW_REASON,
  BuilderProjectRevisionRecordError,
  digestBuilderProjectProposalRecord,
  digestBuilderProjectRevisionRecord,
  sanitizeBuilderProjectRevisionRecord,
  serializeBuilderProjectRevisionRecord,
} = revisionRecordModule;

const PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174000';
const REQUEST_DIGEST = `sha256:${'a'.repeat(64)}`;
const ZERO_DIGEST = `sha256:${'0'.repeat(64)}`;

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

function expectInvalid(value, reason = BUILDER_PROJECT_REVISION_INVALID_REASON) {
  assert.throws(
    () => sanitizeBuilderProjectRevisionRecord(value),
    (error) => error instanceof BuilderProjectRevisionRecordError
      && error.code === 'builder_project_revision_invalid'
      && error.reason === reason
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

test('rejects removed schema v2 records through the generic v1 entrypoints', () => {
  const v2Envelope = {
    schema_version: 2,
    record_kind: 'builder_project_revision',
    project_id: PROJECT_ID,
    revision: 1,
    revision_digest: ZERO_DIGEST,
    parent_revision: null,
    title: 'Removed schema',
    summary: 'The dead JSON v2 revision contract is no longer accepted.',
    source_tree: {
      tree_version: 'builder-project-source-tree.v1',
      files: [],
      source_tree_digest: ZERO_DIGEST,
    },
    source_tree_digest: ZERO_DIGEST,
    change_evidence: {
      evidence_version: 'builder-project-code-change-evidence.v1',
    },
    preview_admission: 'not_evaluated',
    execution_admission: 'not_evaluated',
  };
  for (const operation of [
    () => sanitizeBuilderProjectRevisionRecord(v2Envelope),
    () => digestBuilderProjectRevisionRecord(v2Envelope),
    () => serializeBuilderProjectRevisionRecord(v2Envelope),
  ]) {
    assert.throws(
      operation,
      (error) => error instanceof BuilderProjectRevisionRecordError
        && error.code === 'builder_project_revision_invalid'
        && error.reason === BUILDER_PROJECT_REVISION_INVALID_REASON,
    );
  }
  for (const removedExport of [
    'BUILDER_PROJECT_SCHEMA_VERSION_V2',
    'BUILDER_PROJECT_CODE_CHANGE_EVIDENCE_VERSION',
    'MAX_V2_RECORD_BYTES',
    'createBuilderProjectRevisionRecordV2',
    'digestBuilderProjectRevisionRecordV2',
    'sanitizeBuilderProjectRevisionRecordV2',
    'serializeBuilderProjectRevisionRecordV2',
  ]) {
    assert.equal(Object.hasOwn(revisionRecordModule, removedExport), false);
  }
});

test('record source has no product authority outside the Builder revision contract', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-project-revision-record.cjs'),
    'utf8',
  );
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|fetch\s*\(|axios|ipcRenderer|ipcMain/u);
  assert.doesNotMatch(source, /ChatCreatePage|chat_planner|localChat|Canvas|JobMeta|server workspace/iu);
  assert.doesNotMatch(source, /eval\s*\(|new Function|child_process|worker_threads/u);
  assert.doesNotMatch(source, /builder-code-change-kernel|builder-project-source-tree|RevisionRecordV2/u);
});
