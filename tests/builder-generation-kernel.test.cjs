'use strict';

const assert = require('node:assert/strict');
const nodeCrypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  BUILDER_GENERATION_PROMPT_DESCRIPTOR_VERSION,
  MAX_GENERATED_TEXT_BYTES,
  BuilderGenerationKernelError,
  createBuilderGenerationPromptDescriptor,
  projectBuilderGenerationResult,
  sanitizeBuilderGenerationRequest,
} = require('../electron/builder-generation-kernel.cjs');
const {
  digestBuilderProjectProposalRecord,
  digestBuilderProjectRevisionRecord,
  sanitizeBuilderProjectRevisionRecord,
} = require('../electron/builder-project-revision-record.cjs');

const PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174000';
const OTHER_PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174001';
const ZERO_DIGEST = `sha256:${'0'.repeat(64)}`;

function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`);
  return `{${entries.join(',')}}`;
}

function digest(value) {
  return `sha256:${nodeCrypto.createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')}`;
}

function proposal(overrides = {}) {
  return {
    kind: 'builder_code_project',
    title: 'Focus timer',
    summary: 'A calm timer for one focused task.',
    files: {
      'index.html': '<main><h1>Focus</h1><button id="start">Start</button></main>',
      'styles.css': 'main { max-width: 32rem; margin: 2rem auto; }',
      'app.js': 'const button = document.querySelector("#start");\nbutton?.addEventListener("click", () => {});',
    },
    ...overrides,
  };
}

function request({
  idea = 'Make a calm focus timer.',
  projectId = PROJECT_ID,
  targetRevision = 1,
  parentRevision = null,
} = {}) {
  const unsigned = {
    version: 'builder-generation-request.v1',
    idea,
    project_id: projectId,
    target_revision: targetRevision,
    parent_revision: parentRevision,
  };
  return { ...unsigned, request_digest: digest(unsigned) };
}

function revisionRecord({
  projectId = PROJECT_ID,
  revision = 1,
  parentRevision = null,
  sourceProposal = proposal(),
} = {}) {
  const proposalDigest = digestBuilderProjectProposalRecord(sourceProposal);
  const unsigned = {
    schema_version: 1,
    record_kind: 'builder_project_revision',
    project_id: projectId,
    revision,
    parent_revision: parentRevision,
    title: sourceProposal.title,
    summary: sourceProposal.summary,
    files: sourceProposal.files,
    proposal_evidence: {
      authority: 'builder_code_project_generator',
      prompt_version: 'builder-code-project.v1',
      request_version: 'builder-generation-request.v1',
      result_version: 'builder-generation-result.v1',
      request_digest: ZERO_DIGEST,
      proposal_digest: proposalDigest,
      project_id: projectId,
      target_revision: revision,
      parent_revision: parentRevision,
    },
    execution_admission: 'not_evaluated',
    preview_script_admission: 'not_authorized',
  };
  const revisionDigest = digestBuilderProjectRevisionRecord({
    ...unsigned,
    revision_digest: ZERO_DIGEST,
  });
  return sanitizeBuilderProjectRevisionRecord({ ...unsigned, revision_digest: revisionDigest });
}

function generatedText(sourceProposal = proposal()) {
  return JSON.stringify(sourceProposal);
}

function expectKernelError(fn, code, forbidden = []) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof BuilderGenerationKernelError);
    assert.equal(error.code, code);
    const serialized = JSON.stringify({ name: error.name, code: error.code, message: error.message, stack: error.stack });
    for (const marker of forbidden) assert.doesNotMatch(serialized, new RegExp(marker, 'iu'));
    return true;
  });
}

test('sanitizes a C0 generation request as a fresh deeply frozen value', () => {
  const raw = request();
  const safe = sanitizeBuilderGenerationRequest(raw);

  assert.deepEqual(safe, raw);
  assert.notEqual(safe, raw);
  assert.ok(Object.isFrozen(safe));
  assert.ok(Object.isFrozen(safe.parent_revision) || safe.parent_revision === null);
  raw.idea = 'changed';
  assert.equal(safe.idea, 'Make a calm focus timer.');
});

test('builds a deterministic create prompt without exposing host project identity', () => {
  const rawRequest = request();
  const first = createBuilderGenerationPromptDescriptor({
    request: rawRequest,
    parent_revision_record: null,
  });
  const second = createBuilderGenerationPromptDescriptor({
    request: structuredClone(rawRequest),
    parent_revision_record: null,
  });

  assert.deepEqual(first, second);
  assert.equal(first.version, BUILDER_GENERATION_PROMPT_DESCRIPTOR_VERSION);
  assert.equal(first.request_id, rawRequest.request_digest);
  assert.equal(first.prompt_version, 'builder-code-project.v2');
  assert.equal(first.max_generated_text_bytes, MAX_GENERATED_TEXT_BYTES);
  assert.deepEqual(first.output_contract, {
    kind: 'builder_code_project',
    exact_keys: ['kind', 'title', 'summary', 'files'],
    exact_file_keys: ['index.html', 'styles.css', 'app.js'],
    format: 'json_object_only',
  });
  assert.match(first.system_instruction, /stores and assembles these three files separately/iu);
  assert.match(first.system_instruction, /index\.html must not reference styles\.css or app\.js/iu);
  assert.match(first.system_instruction, /complete semantic structure, visible initial state/iu);
  assert.match(first.system_instruction, /state, rendering, event binding, and input validation/iu);
  assert.match(first.system_instruction, /selectors and ids consistent/iu);
  assert.match(first.system_instruction, /complete one coherent core flow and simplify optional features/iu);
  assert.match(first.system_instruction, /Do not include script, link, style, form, iframe, meta/iu);
  const examplePrefix = 'Example JSON object: ';
  const exampleLine = first.system_instruction.split('\n').find((line) => line.startsWith(examplePrefix));
  assert.ok(exampleLine);
  const example = JSON.parse(exampleLine.slice(examplePrefix.length));
  assert.deepEqual(Object.keys(example), ['kind', 'title', 'summary', 'files']);
  assert.equal(example.kind, 'builder_code_project');
  assert.deepEqual(Object.keys(example.files), ['index.html', 'styles.css', 'app.js']);
  assert.deepEqual(projectBuilderGenerationResult({
    request: rawRequest,
    parent_revision_record: null,
    generated_text: JSON.stringify(example),
  }).proposal, example);
  assert.deepEqual(JSON.parse(first.user_instruction), {
    current_project: null,
    idea: 'Make a calm focus timer.',
    mode: 'create',
    target_revision: 1,
  });
  assert.doesNotMatch(first.user_instruction, /builder-project:|revision_digest|request_digest/iu);
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.output_contract));
  assert.ok(Object.isFrozen(first.output_contract.exact_keys));
});

test('binds a revision prompt to the exact trusted parent source', () => {
  const parent = revisionRecord();
  const rawRequest = request({
    idea: 'Make the timer gentler.',
    targetRevision: 2,
    parentRevision: { revision: 1, revision_digest: parent.revision_digest },
  });
  const descriptor = createBuilderGenerationPromptDescriptor({
    request: rawRequest,
    parent_revision_record: parent,
  });
  const context = JSON.parse(descriptor.user_instruction);

  assert.equal(context.mode, 'revise');
  assert.equal(context.target_revision, 2);
  assert.deepEqual(context.current_project, {
    title: parent.title,
    summary: parent.summary,
    files: parent.files,
  });
  assert.doesNotMatch(descriptor.user_instruction, new RegExp(PROJECT_ID, 'u'));
  assert.doesNotMatch(descriptor.user_instruction, new RegExp(parent.revision_digest, 'u'));
});

test('projects generated JSON into the exact host-owned C0 result evidence', () => {
  const rawRequest = request();
  const sourceProposal = proposal({
    files: {
      'index.html': '<main><h1>Hello</h1></main>',
      'styles.css': 'main { color: navy; }',
      'app.js': '',
    },
  });
  const result = projectBuilderGenerationResult({
    request: rawRequest,
    parent_revision_record: null,
    generated_text: generatedText(sourceProposal),
  });

  assert.deepEqual(result, {
    version: 'builder-generation-result.v1',
    request_id: rawRequest.request_digest,
    proposal: sourceProposal,
    evidence: {
      authority: 'builder_code_project_generator',
      prompt_version: 'builder-code-project.v2',
      request_version: 'builder-generation-request.v1',
      result_version: 'builder-generation-result.v1',
      request_digest: rawRequest.request_digest,
      proposal_digest: digestBuilderProjectProposalRecord(sourceProposal),
      project_id: PROJECT_ID,
      target_revision: 1,
      parent_revision: null,
    },
    admissions: { execution: 'not_evaluated', preview_script: 'not_authorized' },
  });
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.proposal));
  assert.ok(Object.isFrozen(result.proposal.files));
  assert.ok(Object.isFrozen(result.evidence));
  assert.ok(Object.isFrozen(result.admissions));
});

test('projects a revision result without allowing generated text to choose identity', () => {
  const parent = revisionRecord();
  const rawRequest = request({
    targetRevision: 2,
    parentRevision: { revision: 1, revision_digest: parent.revision_digest },
  });
  const result = projectBuilderGenerationResult({
    request: rawRequest,
    parent_revision_record: parent,
    generated_text: generatedText(proposal({ title: 'Focus timer v2' })),
  });

  assert.equal(result.evidence.project_id, PROJECT_ID);
  assert.equal(result.evidence.target_revision, 2);
  assert.deepEqual(result.evidence.parent_revision, rawRequest.parent_revision);
  assert.notEqual(result.evidence.parent_revision, rawRequest.parent_revision);
  assert.equal(result.request_id, rawRequest.request_digest);
});

test('fails closed on malformed, drifted, unsafe, and forged generation requests', () => {
  const valid = request();
  const invalidRequests = [
    { ...valid, extra: true },
    Object.fromEntries(Object.entries(valid).filter(([key]) => key !== 'idea')),
    { ...valid, version: 'builder-generation-request.v2' },
    { ...valid, request_digest: ZERO_DIGEST },
    { ...valid, target_revision: 2 },
    { ...valid, idea: ' padded ' },
    { ...valid, idea: 'Cafe\u0301' },
    { ...valid, idea: 'bad\u0000idea' },
    { ...valid, idea: `api_key=${'x'.repeat(24)}` },
    { ...valid, idea: 'Read C:\\Users\\Alice\\secret.txt' },
    { ...valid, idea: '\ud800' },
    { ...valid, idea: 'x'.repeat(4001) },
  ];
  for (const candidate of invalidRequests) {
    expectKernelError(
      () => sanitizeBuilderGenerationRequest(candidate),
      'builder_generation_request_invalid',
      ['Alice', 'api_key'],
    );
  }

  const symbolRequest = { ...valid, [Symbol('hidden')]: true };
  expectKernelError(() => sanitizeBuilderGenerationRequest(symbolRequest), 'builder_generation_request_invalid');

  let getterCalls = 0;
  const accessorRequest = { ...valid };
  Object.defineProperty(accessorRequest, 'idea', {
    enumerable: true,
    get() { getterCalls += 1; return 'marker-accessor'; },
  });
  expectKernelError(
    () => sanitizeBuilderGenerationRequest(accessorRequest),
    'builder_generation_request_invalid',
    ['marker-accessor'],
  );
  assert.equal(getterCalls, 0);

  let proxyGets = 0;
  const proxyRequest = new Proxy(valid, { get(target, key, receiver) {
    proxyGets += 1;
    return Reflect.get(target, key, receiver);
  } });
  expectKernelError(() => sanitizeBuilderGenerationRequest(proxyRequest), 'builder_generation_request_invalid');
  assert.equal(proxyGets, 0);
});

test('requires exact trusted parent evidence before preparing or projecting a revision', () => {
  const parent = revisionRecord();
  const rawRequest = request({
    targetRevision: 2,
    parentRevision: { revision: 1, revision_digest: parent.revision_digest },
  });
  const badParents = [
    null,
    revisionRecord({ projectId: OTHER_PROJECT_ID }),
    { ...parent, revision_digest: ZERO_DIGEST },
    { ...parent, revision: 2 },
    { ...parent, extra: true },
  ];
  for (const candidate of badParents) {
    expectKernelError(
      () => createBuilderGenerationPromptDescriptor({
        request: rawRequest,
        parent_revision_record: candidate,
      }),
      'builder_generation_parent_invalid',
    );
    expectKernelError(
      () => projectBuilderGenerationResult({
        request: rawRequest,
        parent_revision_record: candidate,
        generated_text: generatedText(),
      }),
      'builder_generation_parent_invalid',
    );
  }

  expectKernelError(
    () => createBuilderGenerationPromptDescriptor({
      request: request(),
      parent_revision_record: parent,
    }),
    'builder_generation_parent_invalid',
  );
});

test('rejects malformed or decorated generated text before it can become evidence', () => {
  const rawRequest = request();
  const validText = generatedText();
  const invalidText = [
    '',
    ` ${validText}`,
    `${validText}\n`,
    `\`\`\`json\n${validText}\n\`\`\``,
    `prefix${validText}`,
    `${validText}suffix`,
    '{',
    'null',
    '[]',
    '42',
    '"text"',
    'x'.repeat(MAX_GENERATED_TEXT_BYTES + 1),
  ];
  for (const candidate of invalidText) {
    expectKernelError(
      () => projectBuilderGenerationResult({
        request: rawRequest,
        parent_revision_record: null,
        generated_text: candidate,
      }),
      'builder_generation_response_invalid',
      ['prefix', 'suffix'],
    );
  }
});

test('rejects generated identity, evidence, admissions, extras, and unsafe project material', () => {
  const rawRequest = request();
  const cases = [
    { ...proposal(), project_id: OTHER_PROJECT_ID },
    { ...proposal(), evidence: { authority: 'model' } },
    { ...proposal(), admissions: { execution: 'authorized' } },
    { ...proposal(), kind: 'other' },
    { ...proposal(), title: ' padded ' },
    { ...proposal(), summary: `Bearer ${'a'.repeat(24)}` },
    { ...proposal(), files: { ...proposal().files, extra: 'x' } },
    { ...proposal(), files: { ...proposal().files, 'index.html': '<script>alert(1)</script>' } },
    { ...proposal(), files: { ...proposal().files, 'index.html': '<img src="asset.png">' } },
    { ...proposal(), files: { ...proposal().files, 'styles.css': 'body{background:url(asset.png)}' } },
    { ...proposal(), files: { ...proposal().files, 'styles.css': '@font-face{font-family:x}' } },
    { ...proposal(), files: { ...proposal().files, 'app.js': 'import x from "./x.js";' } },
    { ...proposal(), files: { ...proposal().files, 'app.js': 'const p = "C:\\\\Users\\\\Alice";' } },
    { ...proposal(), files: { ...proposal().files, 'app.js': '\ud800' } },
  ];
  for (const candidate of cases) {
    expectKernelError(
      () => projectBuilderGenerationResult({
        request: rawRequest,
        parent_revision_record: null,
        generated_text: JSON.stringify(candidate),
      }),
      'builder_generation_response_invalid',
      ['Alice', 'Bearer'],
    );
  }
});

test('returns only fixed safe errors without reflecting untrusted request or generated text', () => {
  const requestMarker = 'request-marker-do-not-leak';
  expectKernelError(
    () => sanitizeBuilderGenerationRequest(request({ idea: `${requestMarker} api_key=abcdefghijklmno` })),
    'builder_generation_request_invalid',
    [requestMarker, 'abcdefghijklmno', PROJECT_ID],
  );

  const responseMarker = 'response-marker-do-not-leak';
  expectKernelError(
    () => projectBuilderGenerationResult({
      request: request(),
      parent_revision_record: null,
      generated_text: responseMarker,
    }),
    'builder_generation_response_invalid',
    [responseMarker, PROJECT_ID],
  );
});

test('stays aligned with the committed C0 protocol and avoids product authority imports', () => {
  const root = path.resolve(__dirname, '..');
  const source = fs.readFileSync(path.join(root, 'electron', 'builder-generation-kernel.cjs'), 'utf8');
  const frontend = fs.readFileSync(
    path.join(root, 'src', 'features', 'builder', 'application', 'builderGeneration.ts'),
    'utf8',
  );
  const domain = fs.readFileSync(
    path.join(root, 'src', 'features', 'builder', 'domain', 'builderProject.ts'),
    'utf8',
  );
  const contractSource = `${domain}\n${frontend}`;
  const requires = [...source.matchAll(/require\((['"])([^'"]+)\1\)/gu)].map((match) => match[2]);

  assert.deepEqual(requires, ['node:crypto', 'node:util', './builder-project-revision-record.cjs']);
  for (const literal of [
    'builder-generation-request.v1',
    'builder-generation-result.v1',
    'builder_code_project_generator',
    'builder-code-project.v2',
    'request_digest',
    'proposal_digest',
    "execution: 'not_evaluated'",
    "preview_script: 'not_authorized'",
  ]) {
    assert.match(contractSource, new RegExp(literal.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
    assert.match(source, new RegExp(literal.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  }
  assert.match(contractSource, /builder-code-project\.v1/u);
  assert.doesNotMatch(source, /(?:fetch\s*\(|node:https|node:http|electron|ipcMain|ipcRenderer|local-provider|chat_planner|ChatCreatePage|Canvas|JobMeta|secure-provider|repository\.commit|localStorage|sessionStorage|indexedDB|child_process|worker_threads|\beval\s*\(|new Function)/u);
});
