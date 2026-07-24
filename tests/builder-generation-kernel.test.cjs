'use strict';

const assert = require('node:assert/strict');
const nodeCrypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  BUILDER_GENERATED_OPERATIONS_KIND,
  BUILDER_GENERATION_PROMPT_DESCRIPTOR_VERSION,
  MAX_GENERATED_TEXT_BYTES,
  BuilderGenerationKernelError,
  createBuilderGenerationRequest,
  createBuilderGenerationPromptDescriptor,
  projectBuilderGenerationResult,
  sanitizeBuilderGenerationRequest,
} = require('../electron/builder-generation-kernel.cjs');
const {
  createBuilderConversationEvent,
} = require('../electron/builder-conversation-records.cjs');
const {
  createBuilderProjectSourceTree,
} = require('../electron/builder-project-source-tree.cjs');

const UUID = '123e4567-e89b-42d3-a456-426614174000';
const PROJECT_ID = `builder-project:${UUID}`;
const REVISION_RECEIPT_DIGEST = `sha256:${'1'.repeat(64)}`;
const COMMIT_OID = '2'.repeat(40);
const SOURCE_TREE_DIGEST = `sha256:${'3'.repeat(64)}`;
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

function request({
  instruction = 'Make a calm focus timer.',
  existingProjectId = null,
} = {}) {
  const unsigned = {
    version: 'builder-generation-request.v2',
    instruction,
    existing_project_id: existingProjectId,
  };
  return { ...unsigned, request_digest: digest(unsigned) };
}

function sourceTree(files = []) {
  return createBuilderProjectSourceTree({ files });
}

function baseEvidence(tree = sourceTree()) {
  return {
    evidence_version: 'builder-project-base-revision-evidence.v2',
    project_id: PROJECT_ID,
    revision_receipt_digest: REVISION_RECEIPT_DIGEST,
    commit_oid: COMMIT_OID,
    source_tree_digest: tree.source_tree_digest || SOURCE_TREE_DIGEST,
    verification_admission: 'git_sqlite_read_authority_verified',
  };
}

function conversationEvents({
  projectId = PROJECT_ID,
  instruction = 'Make a calm focus timer.',
  requestDigest = request().request_digest,
  baseRevision = null,
} = {}) {
  const conversationId = `builder-conversation:${projectId.slice('builder-project:'.length)}`;
  const first = createBuilderConversationEvent({
    record_version: 'builder-conversation-event.v2',
    record_kind: 'builder_conversation_event',
    project_id: projectId,
    conversation_id: conversationId,
    sequence: 1,
    command_id: 'builder-command:123e4567-e89b-42d3-a456-426614174001',
    event_type: 'turn_submitted',
    previous_event: null,
    payload: {
      message: { message_id: 'builder-message:123e4567-e89b-42d3-a456-426614174002', text: instruction },
      turn_id: 'builder-turn:123e4567-e89b-42d3-a456-426614174003',
      mode: 'work',
      task: { task_id: 'builder-task:123e4567-e89b-42d3-a456-426614174004', title: 'Create Builder project' },
      base_revision: baseRevision,
    },
    authority: {
      context_authority: 'project_local_conversation',
      permission_admission: 'not_granted',
      execution_admission: 'not_granted',
      revision_admission: 'not_created',
    },
  });
  const second = createBuilderConversationEvent({
    record_version: 'builder-conversation-event.v2',
    record_kind: 'builder_conversation_event',
    project_id: projectId,
    conversation_id: conversationId,
    sequence: 2,
    command_id: 'builder-command:123e4567-e89b-42d3-a456-426614174005',
    event_type: 'run_started',
    previous_event: {
      sequence: first.sequence,
      event_id: first.event_id,
      event_digest: first.event_digest,
    },
    payload: {
      turn_id: 'builder-turn:123e4567-e89b-42d3-a456-426614174003',
      run_id: 'builder-run:123e4567-e89b-42d3-a456-426614174006',
      task_id: 'builder-task:123e4567-e89b-42d3-a456-426614174004',
      attempt_number: 1,
      retry_of_run_id: null,
      input_digest: requestDigest,
    },
    authority: {
      context_authority: 'project_local_conversation',
      permission_admission: 'not_granted',
      execution_admission: 'not_granted',
      revision_admission: 'not_created',
    },
  });
  return [first, second];
}

function generatedText(overrides = {}) {
  return JSON.stringify({
    kind: BUILDER_GENERATED_OPERATIONS_KIND,
    title: 'Focus timer',
    summary: 'A calm timer for one focused task.',
    operations: [
      { operation: 'upsert', path: 'index.html', content: '<main><h1>Focus</h1></main>\n' },
      { operation: 'upsert', path: 'src/app.js', content: 'import process from "node:process";\nconsole.log(process.pid);\n' },
    ],
    ...overrides,
  });
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

test('sanitizes a v2 renderer request with only instruction, nullable project, and digest', () => {
  const raw = request({ existingProjectId: PROJECT_ID });
  const safe = sanitizeBuilderGenerationRequest(raw);

  assert.deepEqual(safe, raw);
  assert.notEqual(safe, raw);
  assert.ok(Object.isFrozen(safe));
  assert.equal(safe.existing_project_id, PROJECT_ID);
  raw.instruction = 'changed';
  assert.equal(safe.instruction, 'Make a calm focus timer.');
});

test('creates the full deterministic v2 request only from host-owned project selection', () => {
  const first = createBuilderGenerationRequest({
    instruction: 'Make a calm focus timer.',
    existing_project_id: PROJECT_ID,
  });
  const second = createBuilderGenerationRequest({
    instruction: 'Make a calm focus timer.',
    existing_project_id: PROJECT_ID,
  });

  assert.deepEqual(first, second);
  assert.deepEqual(first, request({ existingProjectId: PROJECT_ID }));
  assert.ok(Object.isFrozen(first));
  for (const invalid of [
    { instruction: 'Make a timer.' },
    { instruction: 'Make a timer.', existing_project_id: null, request_digest: ZERO_DIGEST },
    { instruction: 'Make a timer.', existing_project_id: 'builder-project:bad' },
  ]) {
    expectKernelError(
      () => createBuilderGenerationRequest(invalid),
      'builder_generation_request_invalid',
    );
  }
});

test('builds a deterministic operations prompt without exposing host identities', () => {
  const rawRequest = request();
  const base = sourceTree();
  const first = createBuilderGenerationPromptDescriptor({ request: rawRequest, base_source_tree: base });
  const second = createBuilderGenerationPromptDescriptor({ request: structuredClone(rawRequest), base_source_tree: base });

  assert.deepEqual(first, second);
  assert.equal(first.version, BUILDER_GENERATION_PROMPT_DESCRIPTOR_VERSION);
  assert.equal(first.request_id, rawRequest.request_digest);
  assert.equal(first.prompt_version, 'builder-code-project.v3');
  assert.equal(first.max_generated_text_bytes, MAX_GENERATED_TEXT_BYTES);
  assert.deepEqual(first.output_contract, {
    kind: BUILDER_GENERATED_OPERATIONS_KIND,
    exact_keys: ['kind', 'title', 'summary', 'operations'],
    operation_keys: ['operation', 'path', 'content'],
    format: 'json_object_only',
  });
  assert.match(first.system_instruction, /You may generate general source code in any language/iu);
  assert.match(first.system_instruction, /imports, process APIs, networking code/iu);
  assert.doesNotMatch(first.system_instruction, /index\.html.*styles\.css.*app\.js/iu);
  assert.deepEqual(JSON.parse(first.user_instruction), {
    instruction: 'Make a calm focus timer.',
    mode: 'create',
    current_source_tree: { files: [] },
  });
  assert.doesNotMatch(first.user_instruction, /builder-project:|revision_digest|request_digest|candidate_digest/iu);
});

test('includes verified source text for existing-project revision prompts', () => {
  const rawRequest = request({ existingProjectId: PROJECT_ID, instruction: 'Add keyboard shortcuts.' });
  const base = sourceTree([
    { path: 'src/app.js', content: 'export const count = 1;\n' },
  ]);
  const descriptor = createBuilderGenerationPromptDescriptor({ request: rawRequest, base_source_tree: base });
  const context = JSON.parse(descriptor.user_instruction);

  assert.equal(context.mode, 'revise');
  assert.deepEqual(context.current_source_tree.files, [
    { path: 'src/app.js', content: 'export const count = 1;\n' },
  ]);
  assert.doesNotMatch(descriptor.user_instruction, new RegExp(PROJECT_ID, 'u'));
});

test('projects provider operations into a host-owned unsaved code-change candidate', () => {
  const rawRequest = request();
  const base = sourceTree();
  const result = projectBuilderGenerationResult({
    request: rawRequest,
    base_revision_evidence: null,
    base_source_tree: base,
    conversation_events: conversationEvents(),
    turn_id: 'builder-turn:123e4567-e89b-42d3-a456-426614174003',
    run_id: 'builder-run:123e4567-e89b-42d3-a456-426614174006',
    generated_text: generatedText(),
  });

  assert.equal(result.version, 'builder-generation-result.v2');
  assert.equal(result.request_id, rawRequest.request_digest);
  assert.equal(result.title, 'Focus timer');
  assert.equal(result.candidate.candidate_version, 'builder-code-change-candidate.v2');
  assert.equal(result.candidate.project_id, PROJECT_ID);
  assert.equal(result.candidate.request_digest, rawRequest.request_digest);
  assert.equal(result.candidate.authority.revision_admission, 'not_created');
  assert.equal(result.candidate.authority.preview_admission, 'not_evaluated');
  assert.equal(result.candidate.authority.execution_admission, 'not_evaluated');
  assert.equal(result.admissions.draft, 'candidate_not_saved');
  assert.equal(result.admissions.save, 'not_performed');
  assert.equal(result.admissions.conversation, 'candidate_local_not_recorded');
  assert.ok(result.candidate.resulting_source_tree.files.some((file) => file.path === 'src/app.js'));
});

test('cross-binds existing-project base evidence to conversation and source tree', () => {
  const base = sourceTree([{ path: 'src/app.js', content: 'export const before = true;\n' }]);
  const rawRequest = request({ existingProjectId: PROJECT_ID });
  const baseRevision = { revision_receipt_digest: REVISION_RECEIPT_DIGEST, commit_oid: COMMIT_OID };
  const result = projectBuilderGenerationResult({
    request: rawRequest,
    base_revision_evidence: baseEvidence(base),
    base_source_tree: base,
    conversation_events: conversationEvents({
      requestDigest: rawRequest.request_digest,
      baseRevision,
    }),
    turn_id: 'builder-turn:123e4567-e89b-42d3-a456-426614174003',
    run_id: 'builder-run:123e4567-e89b-42d3-a456-426614174006',
    generated_text: generatedText({
      operations: [{ operation: 'upsert', path: 'src/app.js', content: 'export const before = false;\n' }],
    }),
  });

  assert.deepEqual(result.candidate.base_revision_evidence, baseEvidence(base));
  assert.deepEqual(result.candidate.run_binding.base_revision, baseRevision);
  assert.equal(result.candidate.base_source_tree.source_tree_digest, base.source_tree_digest);
});

test('fails closed on malformed, drifted, unsafe, and forged generation requests', () => {
  const valid = request();
  const invalidRequests = [
    { ...valid, extra: true },
    Object.fromEntries(Object.entries(valid).filter(([key]) => key !== 'instruction')),
    { ...valid, version: 'builder-generation-request.v1' },
    { ...valid, request_digest: ZERO_DIGEST },
    { ...valid, existing_project_id: 'builder-project:not-a-uuid' },
    { ...valid, instruction: ' padded ' },
    { ...valid, instruction: 'Cafe\u0301' },
    { ...valid, instruction: 'bad\u0000idea' },
    { ...valid, instruction: `api_key=${'x'.repeat(24)}` },
    { ...valid, instruction: 'Read C:\\Users\\Alice\\secret.txt' },
    { ...valid, instruction: '\ud800' },
    { ...valid, instruction: 'x'.repeat(4001) },
  ];
  for (const candidate of invalidRequests) {
    expectKernelError(
      () => sanitizeBuilderGenerationRequest(candidate),
      'builder_generation_request_invalid',
      ['Alice', 'api_key'],
    );
  }

  let getterCalls = 0;
  const accessorRequest = { ...valid };
  Object.defineProperty(accessorRequest, 'instruction', {
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

test('classifies malformed generated text and rejects forged provider authority', () => {
  const rawRequest = request();
  const common = {
    request: rawRequest,
    base_revision_evidence: null,
    base_source_tree: sourceTree(),
    conversation_events: conversationEvents(),
    turn_id: 'builder-turn:123e4567-e89b-42d3-a456-426614174003',
    run_id: 'builder-run:123e4567-e89b-42d3-a456-426614174006',
  };
  for (const generated_text of [
    '',
    ` ${generatedText()}`,
    `${generatedText()}\n`,
    `\`\`\`json\n${generatedText()}\n\`\`\``,
    '{',
    'null',
    '[]',
    '42',
    '"text"',
    'x'.repeat(MAX_GENERATED_TEXT_BYTES + 1),
  ]) {
    expectKernelError(
      () => projectBuilderGenerationResult({ ...common, generated_text }),
      'builder_generation_structured_response_invalid',
    );
  }
  for (const body of [
    { kind: 'builder_code_project', title: 'A', summary: 'B', operations: [] },
    {
      kind: BUILDER_GENERATED_OPERATIONS_KIND,
      title: 'A',
      summary: 'B',
      operations: [],
      candidate_id: 'builder-code-change-candidate:forged',
    },
    {
      kind: BUILDER_GENERATED_OPERATIONS_KIND,
      title: ' padded ',
      summary: 'B',
      operations: [{ operation: 'upsert', path: 'a.txt', content: 'a' }],
    },
    {
      kind: BUILDER_GENERATED_OPERATIONS_KIND,
      title: 'A',
      summary: `Bearer ${'a'.repeat(24)}`,
      operations: [{ operation: 'upsert', path: 'a.txt', content: 'a' }],
    },
    {
      kind: BUILDER_GENERATED_OPERATIONS_KIND,
      title: 'A',
      summary: 'B',
      operations: [{ operation: 'upsert', path: 'C:\\Users\\Alice\\secret.txt', content: 'x' }],
    },
    {
      kind: BUILDER_GENERATED_OPERATIONS_KIND,
      title: 'A',
      summary: 'B',
      operations: [{ operation: 'upsert', path: 'safe.txt', content: 'api_key=abcd1234abcd1234abcd1234' }],
    },
  ]) {
    expectKernelError(
      () => projectBuilderGenerationResult({ ...common, generated_text: JSON.stringify(body) }),
      'builder_generation_structured_response_invalid',
      ['Alice', 'Bearer', 'api_key'],
    );
  }
});

test('returns only fixed safe errors without reflecting rejected material', () => {
  const requestMarker = 'request-marker-do-not-leak';
  expectKernelError(
    () => sanitizeBuilderGenerationRequest(request({ instruction: `${requestMarker} api_key=abcdefghijklmno` })),
    'builder_generation_request_invalid',
    [requestMarker, 'abcdefghijklmno', PROJECT_ID],
  );

  const responseMarker = 'response-marker-do-not-leak';
  expectKernelError(
    () => projectBuilderGenerationResult({
      request: request(),
      base_revision_evidence: null,
      base_source_tree: sourceTree(),
      conversation_events: conversationEvents(),
      turn_id: 'builder-turn:123e4567-e89b-42d3-a456-426614174003',
      run_id: 'builder-run:123e4567-e89b-42d3-a456-426614174006',
      generated_text: responseMarker,
    }),
    'builder_generation_structured_response_invalid',
    [responseMarker, PROJECT_ID],
  );
});

test('stays aligned with the v2 draft protocol and avoids old revision or sandbox authority', () => {
  const root = path.resolve(__dirname, '..');
  const source = fs.readFileSync(path.join(root, 'electron', 'builder-generation-kernel.cjs'), 'utf8');
  const requires = [...source.matchAll(/require\((['"])([^'"]+)\1\)/gu)].map((match) => match[2]);

  assert.deepEqual(requires, [
    'node:crypto',
    'node:util',
    './builder-code-change-kernel.cjs',
    './builder-project-source-tree.cjs',
  ]);
  for (const literal of [
    'builder-generation-request.v2',
    'builder-generation-result.v2',
    'builder-code-project.v3',
    'builder_code_change_operations',
    'candidate_not_saved',
    'not_performed',
  ]) {
    assert.match(source, new RegExp(literal.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  }
  assert.doesNotMatch(source, /builder-project-revision-record|revision_digest|target_revision|parent_revision|static_preview|index\.html.*styles\.css.*app\.js/iu);
  assert.doesNotMatch(source, /(?:fetch\s*\(|node:https|node:http|electron|ipcMain|ipcRenderer|local-provider|chat_planner|ChatCreatePage|Canvas|JobMeta|secure-provider|repository\.commit|localStorage|sessionStorage|indexedDB|child_process|worker_threads|\beval\s*\(|new Function)/u);
});
