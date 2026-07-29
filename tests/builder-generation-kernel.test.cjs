'use strict';

const assert = require('node:assert/strict');
const nodeCrypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  BUILDER_GENERATED_EXPLANATION_KIND,
  BUILDER_GENERATED_OPERATIONS_KIND,
  BUILDER_GENERATED_PLAN_KIND,
  BUILDER_GENERATION_PROMPT_DESCRIPTOR_VERSION,
  MAX_GENERATED_TEXT_BYTES,
  BuilderGenerationKernelError,
  createBuilderGenerationRequest,
  createBuilderExplanationPromptDescriptor,
  createBuilderGenerationPromptDescriptor,
  createBuilderPlanPromptDescriptor,
  projectBuilderExplanationResult,
  projectBuilderDraftContinuationGenerationResult,
  projectBuilderGenerationResult,
  projectBuilderPlanProposalResult,
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

function builderId(kind, index) {
  return `builder-${kind}:123e4567-e89b-42d3-a456-${index.toString(16).padStart(12, '0')}`;
}

function planSourceContextResult(
  rawRequest = request({ existingProjectId: PROJECT_ID }),
  rawFiles = [
    { path: 'src/app.tsx', content: 'export const ready = true;\n' },
  ],
  conversationEventRecords = conversationEvents({ requestDigest: rawRequest.request_digest }),
) {
  const tree = sourceTree(rawFiles);
  const files = tree.files.map((file) => ({
    path: file.path,
    entry_kind: file.entry_kind,
    content: file.content,
    content_digest: file.content_digest,
    content_bytes: Buffer.byteLength(file.content, 'utf8'),
  }));
  return {
    result_version: 'builder-tool-source-context-result.v1',
    operation: 'project_source_context_collected',
    status: 'succeeded',
    context: {
      context_version: 'builder-conversation-run-context.v1',
      mode: 'work',
      project: {
        project_id: PROJECT_ID,
        created_at_ms: 10,
      },
      conversation: {
        project_id: PROJECT_ID,
        conversation_id: `builder-conversation:${UUID}`,
        created_at_ms: 11,
      },
      request_digest: rawRequest.request_digest,
      start_head: {
        sequence: 4,
        event_id: `builder-conversation-event:${'a'.repeat(64)}`,
        event_digest: `sha256:${'b'.repeat(64)}`,
      },
      attempt_number: 1,
      events: conversationEventRecords,
      run_terminal_failure_code: null,
      ids: {
        turn_command_id: builderId('command', 1),
        run_command_id: builderId('command', 2),
        terminal_command_id: builderId('command', 3),
        turn_terminal_command_id: builderId('command', 4),
        cancel_command_id: builderId('command', 5),
        cancel_request_id: builderId('cancel-request', 6),
        interrupt_command_id: builderId('command', 7),
        interrupt_request_id: builderId('interrupt-request', 8),
        message_id: builderId('message', 9),
        assistant_message_id: builderId('message', 10),
        turn_id: builderId('turn', 11),
        task_id: builderId('task', 12),
        run_id: builderId('run', 13),
      },
      cancel_requested: false,
    },
    private_source_context: {
      context_version: 'builder-private-source-context.v1',
      files,
    },
    reads: files.map((file, index) => ({
      resource_id: `project:/${file.path}`,
      status: 'succeeded',
      tool_call_id: builderId('tool-call', index + 20),
    })),
    authority: {
      collector_authority: 'main_tool_source_context_collector_v1',
      permission_authority: 'main_permission_decision_before_tool_dispatch_v1',
      policy_authority: 'main_tool_session_policy_contract_v1',
      conversation_authority: 'trusted_conversation_main_service_methods',
      execution_authority: 'main_tool_filesystem_read_execution_service_v1',
      renderer_authority: 'not_present',
      provider_dispatch: false,
      credential_readback: false,
      raw_output_storage: 'not_durable',
      conversation_event: 'tool_request_and_fixed_result_only',
      git_authority: 'not_present',
      revision_admission: 'not_created',
    },
  };
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

function priorConversationEvents(currentRequest) {
  return [
    {
      event_type: 'turn_submitted',
      payload: {
        turn_id: 'builder-turn:prior-discussion',
        mode: 'question',
        message: {
          text: '我们刚才确认要做一个带星空背景、鼠标视差和三维卡片的作品集首页。',
        },
      },
    },
    {
      event_type: 'run_completed',
      payload: {
        turn_id: 'builder-turn:prior-discussion',
        result_kind: 'explanation',
        assistant_message: {
          text: '方案是先做单页静态作品集，包含 hero、项目列表和联系入口，不加入后端。',
        },
      },
    },
    {
      event_type: 'turn_submitted',
      payload: {
        turn_id: 'builder-turn:unsafe-discussion',
        mode: 'work',
        message: {
          text: `api_key=${'x'.repeat(24)}`,
        },
      },
    },
    {
      event_type: 'turn_submitted',
      payload: {
        turn_id: 'builder-turn:current',
        mode: 'work',
        message: {
          text: currentRequest.instruction,
        },
      },
    },
    {
      event_type: 'run_started',
      payload: {
        turn_id: 'builder-turn:current',
        input_digest: currentRequest.request_digest,
      },
    },
  ];
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

function generatedExplanationText(overrides = {}) {
  return JSON.stringify({
    kind: BUILDER_GENERATED_EXPLANATION_KIND,
    title: 'Current project',
    summary: 'Explains the current local project.',
    explanation: 'The current project is a local Builder project. This answer does not change files.',
    ...overrides,
  });
}

function generatedPlanText(overrides = {}) {
  return JSON.stringify({
    kind: BUILDER_GENERATED_PLAN_KIND,
    title: 'Review the change plan',
    summary: 'Prepare a bounded implementation before editing the project.',
    steps: [
      {
        title: 'Inspect the current shape',
        purpose: 'Use the collected context to choose a small implementation path.',
        expected_change: 'No source files change during planning.',
      },
      {
        title: 'Prepare the edit pass',
        purpose: 'Keep source mutation separate from approval.',
        expected_change: 'The next approved step can create a draft.',
      },
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
  const currentEvents = conversationEvents({ requestDigest: rawRequest.request_digest });
  const first = createBuilderGenerationPromptDescriptor({
    request: rawRequest,
    base_source_tree: base,
    conversation_events: currentEvents,
  });
  const second = createBuilderGenerationPromptDescriptor({
    request: structuredClone(rawRequest),
    base_source_tree: base,
    conversation_events: structuredClone(currentEvents),
  });

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
  assert.doesNotMatch(first.system_instruction, /builder_conversation_explanation|question\/explanation request/iu);
  assert.match(first.system_instruction, /imports, process APIs, networking code/iu);
  assert.doesNotMatch(first.system_instruction, /index\.html.*styles\.css.*app\.js/iu);
  assert.deepEqual(JSON.parse(first.user_instruction), {
    instruction: 'Make a calm focus timer.',
    mode: 'create',
    conversation_brief: {
      context_version: 'builder-conversation-brief.v1',
      selection: 'recent_prior_user_and_assistant_messages',
      entries: [],
    },
    current_source_tree: { files: [] },
  });
  assert.doesNotMatch(first.user_instruction, /builder-project:|revision_digest|request_digest|candidate_digest/iu);
});

test('includes a bounded prior conversation brief for context-grounded build prompts', () => {
  const rawRequest = request({ instruction: '按刚才方案实现', existingProjectId: PROJECT_ID });
  const descriptor = createBuilderGenerationPromptDescriptor({
    request: rawRequest,
    base_source_tree: sourceTree([{ path: 'src/app.js', content: 'export const existing = true;\n' }]),
    conversation_events: priorConversationEvents(rawRequest),
  });
  const context = JSON.parse(descriptor.user_instruction);

  assert.equal(context.instruction, '按刚才方案实现');
  assert.deepEqual(context.conversation_brief, {
    context_version: 'builder-conversation-brief.v1',
    selection: 'recent_prior_user_and_assistant_messages',
    entries: [
      {
        role: 'user',
        kind: 'question',
        text: '我们刚才确认要做一个带星空背景、鼠标视差和三维卡片的作品集首页。',
      },
      {
        role: 'assistant',
        kind: 'explanation',
        text: '方案是先做单页静态作品集，包含 hero、项目列表和联系入口，不加入后端。',
      },
    ],
  });
  assert.match(descriptor.user_instruction, /星空背景/u);
  assert.match(descriptor.user_instruction, /单页静态作品集/u);
  assert.doesNotMatch(
    descriptor.user_instruction,
    /builder-(?:project|turn|run|message|conversation-event|command):|sha256:|request_digest|credential|provider|api[_-]?key|Bearer|按刚才方案实现.*按刚才方案实现/iu,
  );
});

test('builds a route-specific explanation prompt without allowing source operations', () => {
  const rawRequest = request({ instruction: 'What does this project do?', existingProjectId: PROJECT_ID });
  const base = sourceTree([{ path: 'src/app.js', content: 'export const saved = true;\n' }]);
  const descriptor = createBuilderExplanationPromptDescriptor({
    request: rawRequest,
    base_source_tree: base,
    conversation_events: conversationEvents({ requestDigest: rawRequest.request_digest }),
  });

  assert.equal(descriptor.version, BUILDER_GENERATION_PROMPT_DESCRIPTOR_VERSION);
  assert.equal(descriptor.prompt_version, 'builder-project-explanation.v1');
  assert.equal(descriptor.request_id, rawRequest.request_digest);
  assert.deepEqual(descriptor.output_contract, {
    kind: BUILDER_GENERATED_EXPLANATION_KIND,
    exact_keys: ['kind', 'title', 'summary', 'explanation'],
    format: 'json_object_only',
  });
  assert.match(descriptor.system_instruction, /Do not include source-change operations/u);
  assert.doesNotMatch(descriptor.system_instruction, /builder_code_change_operations|operation must be upsert/u);
  assert.match(descriptor.user_instruction, /export const saved = true/u);
  assert.doesNotMatch(descriptor.user_instruction, /builder-project:|revision_digest|request_digest|candidate_digest/iu);
});

test('builds a route-specific plan prompt from bounded private source context', () => {
  const rawRequest = request({ instruction: 'Plan a smaller settings panel.', existingProjectId: PROJECT_ID });
  const sourceContext = planSourceContextResult(rawRequest, [
    { path: 'src/app.tsx', content: 'export const Settings = () => null;\n' },
  ]);
  const descriptor = createBuilderPlanPromptDescriptor({
    request: rawRequest,
    source_context_result: sourceContext,
  });

  assert.equal(descriptor.version, BUILDER_GENERATION_PROMPT_DESCRIPTOR_VERSION);
  assert.equal(descriptor.prompt_version, 'builder-project-plan.v1');
  assert.equal(descriptor.request_id, rawRequest.request_digest);
  assert.deepEqual(descriptor.output_contract, {
    kind: BUILDER_GENERATED_PLAN_KIND,
    exact_keys: ['kind', 'title', 'summary', 'steps'],
    step_keys: ['title', 'purpose', 'expected_change'],
    format: 'json_object_only',
  });
  assert.match(descriptor.system_instruction, /Do not include source-change operations/u);
  assert.match(descriptor.user_instruction, /Plan a smaller settings panel/u);
  assert.match(descriptor.user_instruction, /export const Settings/u);
  assert.deepEqual(JSON.parse(descriptor.user_instruction).conversation_brief, {
    context_version: 'builder-conversation-brief.v1',
    selection: 'recent_prior_user_and_assistant_messages',
    entries: [],
  });
  assert.deepEqual(JSON.parse(descriptor.user_instruction).current_source_context.files, [
    { path: 'src/app.tsx', content: 'export const Settings = () => null;\n' },
  ]);
  assert.doesNotMatch(
    descriptor.user_instruction,
    /builder-project:|request_digest|context_digest|record_digest|tool_call_id|credential|provider/iu,
  );
});

test('includes a bounded prior conversation brief for context-grounded plan prompts', () => {
  const rawRequest = request({ instruction: '先规划一下', existingProjectId: PROJECT_ID });
  const sourceContext = planSourceContextResult(
    rawRequest,
    [{ path: 'src/app.tsx', content: 'export const Gallery = () => null;\n' }],
    priorConversationEvents(rawRequest),
  );
  const descriptor = createBuilderPlanPromptDescriptor({
    request: rawRequest,
    source_context_result: sourceContext,
  });
  const context = JSON.parse(descriptor.user_instruction);

  assert.equal(context.mode, 'plan');
  assert.deepEqual(context.conversation_brief, {
    context_version: 'builder-conversation-brief.v1',
    selection: 'recent_prior_user_and_assistant_messages',
    entries: [
      {
        role: 'user',
        kind: 'question',
        text: '我们刚才确认要做一个带星空背景、鼠标视差和三维卡片的作品集首页。',
      },
      {
        role: 'assistant',
        kind: 'explanation',
        text: '方案是先做单页静态作品集，包含 hero、项目列表和联系入口，不加入后端。',
      },
    ],
  });
  assert.match(descriptor.user_instruction, /星空背景/u);
  assert.match(descriptor.user_instruction, /export const Gallery/u);
  assert.doesNotMatch(
    descriptor.user_instruction,
    /builder-(?:project|turn|run|message|conversation-event|command):|sha256:|request_digest|context_digest|credential|provider|api[_-]?key|Bearer|先规划一下.*先规划一下/iu,
  );
});

test('includes verified source text for existing-project revision prompts', () => {
  const rawRequest = request({ existingProjectId: PROJECT_ID, instruction: 'Add keyboard shortcuts.' });
  const base = sourceTree([
    { path: 'src/app.js', content: 'export const count = 1;\n' },
  ]);
  const descriptor = createBuilderGenerationPromptDescriptor({
    request: rawRequest,
    base_source_tree: base,
    conversation_events: conversationEvents({ requestDigest: rawRequest.request_digest }),
  });
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
  assert.equal(result.result_kind, 'candidate');
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

test('squashes draft continuation output back onto the current product base', () => {
  const rawRequest = request({ instruction: 'Make the pending draft calmer.', existingProjectId: PROJECT_ID });
  const productBase = sourceTree([
    { path: 'index.html', content: '<main><h1>Saved</h1></main>\n' },
    { path: 'src/app.js', content: 'export const saved = true;\n' },
  ]);
  const pendingDraftBase = sourceTree([
    { path: 'index.html', content: '<main><h1>Draft</h1><p>Ready</p></main>\n' },
    { path: 'src/app.js', content: 'export const saved = false;\n' },
    { path: 'src/draft.js', content: 'export const pending = true;\n' },
  ]);
  const result = projectBuilderDraftContinuationGenerationResult({
    request: rawRequest,
    prompt_base_source_tree: pendingDraftBase,
    candidate_base_revision_evidence: baseEvidence(productBase),
    candidate_base_source_tree: productBase,
    conversation_events: conversationEvents({
      requestDigest: rawRequest.request_digest,
      baseRevision: {
        revision_receipt_digest: REVISION_RECEIPT_DIGEST,
        commit_oid: COMMIT_OID,
      },
    }),
    turn_id: 'builder-turn:123e4567-e89b-42d3-a456-426614174003',
    run_id: 'builder-run:123e4567-e89b-42d3-a456-426614174006',
    generated_text: generatedText({
      title: 'Calmer draft',
      summary: 'The pending draft was revised before saving.',
      operations: [
        { operation: 'upsert', path: 'src/draft.js', content: 'export const pending = "calm";\n' },
        { operation: 'upsert', path: 'styles.css', content: 'body { color: #123; }\n' },
      ],
    }),
  });

  assert.equal(result.version, 'builder-generation-result.v2');
  assert.equal(result.result_kind, 'candidate');
  assert.equal(result.title, 'Calmer draft');
  assert.equal(result.request_id, rawRequest.request_digest);
  assert.deepEqual(result.candidate.base_revision_evidence, baseEvidence(productBase));
  assert.deepEqual(result.candidate.base_source_tree, productBase);
  assert.deepEqual(result.candidate.run_binding.base_revision, {
    revision_receipt_digest: REVISION_RECEIPT_DIGEST,
    commit_oid: COMMIT_OID,
  });
  assert.deepEqual(result.candidate.resulting_source_tree.files.map((file) => file.path), [
    'index.html',
    'src/app.js',
    'src/draft.js',
    'styles.css',
  ]);
  assert.equal(
    result.candidate.resulting_source_tree.files.find((file) => file.path === 'index.html').content,
    '<main><h1>Draft</h1><p>Ready</p></main>\n',
  );
  assert.equal(
    result.candidate.resulting_source_tree.files.find((file) => file.path === 'src/draft.js').content,
    'export const pending = "calm";\n',
  );
  assert.deepEqual(result.candidate.operations.map((operation) => operation.path), [
    'index.html',
    'src/app.js',
    'src/draft.js',
    'styles.css',
  ]);
  assert.deepEqual(result.admissions, {
    conversation: 'candidate_local_not_recorded',
    draft: 'candidate_not_saved',
    save: 'not_performed',
    preview: 'not_evaluated',
    execution: 'not_evaluated',
  });
});

test('projects provider explanation without creating a candidate or source change', () => {
  const rawRequest = request({ instruction: 'What does this project do?', existingProjectId: PROJECT_ID });
  const result = projectBuilderExplanationResult({
    request: rawRequest,
    generated_text: generatedExplanationText(),
  });

  assert.equal(result.version, 'builder-generation-result.v2');
  assert.equal(result.result_kind, 'explanation');
  assert.equal(result.request_id, rawRequest.request_digest);
  assert.equal(result.title, 'Current project');
  assert.match(result.explanation, /does not change files/u);
  assert.deepEqual(result.admissions, {
    conversation: 'explanation_local_not_recorded',
    draft: 'not_created',
    save: 'not_performed',
    preview: 'not_applicable',
    execution: 'not_evaluated',
  });
  assert.doesNotMatch(JSON.stringify(result), /candidate|source_tree|revision_receipt|commit_oid|credential|provider/iu);
});

test('projects provider plan into a proposed record without creating source changes', () => {
  const rawRequest = request({ instruction: 'Plan a settings panel update.', existingProjectId: PROJECT_ID });
  const sourceContext = planSourceContextResult(rawRequest);
  const result = projectBuilderPlanProposalResult({
    request: rawRequest,
    source_context_result: sourceContext,
    proposed_at_ms: 100,
    generated_text: generatedPlanText(),
  });

  assert.equal(result.version, 'builder-generation-result.v2');
  assert.equal(result.result_kind, 'plan');
  assert.equal(result.request_id, rawRequest.request_digest);
  assert.equal(result.title, 'Review the change plan');
  assert.deepEqual(result.steps.map((step) => step.status), ['proposed', 'proposed']);
  assert.equal(result.plan_proposal_record.record_version, 'builder-plan-proposal-record.v1');
  assert.equal(result.plan_proposal_record.project_id, PROJECT_ID);
  assert.equal(result.plan_proposal_record.context_binding.file_count, 1);
  assert.equal(result.plan_proposal_record.lifecycle.source_mutation, 'not_performed');
  assert.equal(result.plan_proposal_record.authority.provider_dispatch, false);
  assert.deepEqual(result.admissions, {
    conversation: 'plan_local_not_recorded',
    draft: 'not_created',
    save: 'not_performed',
    preview: 'not_applicable',
    execution: 'not_evaluated',
    revision: 'not_created',
  });
  assert.equal(Object.hasOwn(result, 'candidate'), false);
  assert.doesNotMatch(
    JSON.stringify(result),
    /"private_source_context"|"content_digest"|"source_tree"|"tool_call_id"|export const|credential_value|credential_secret|"secret_ref"|api[_-]?key|provider\.example|builder-model|"commit_oid"|"tree_oid"|"revision_receipt"|"operations"/iu,
  );
});

test('keeps generated plan step titles aligned with the proposal record bounds', () => {
  const rawRequest = request({ instruction: 'Plan a settings panel update.', existingProjectId: PROJECT_ID });
  const sourceContext = planSourceContextResult(rawRequest);
  const bounded = projectBuilderPlanProposalResult({
    request: rawRequest,
    source_context_result: sourceContext,
    proposed_at_ms: 100,
    generated_text: generatedPlanText({
      steps: [{
        title: 'T'.repeat(120),
        purpose: 'Keep the next step reviewable before editing.',
        expected_change: 'No source files change during planning.',
      }],
    }),
  });

  assert.equal(bounded.steps[0].title.length, 120);
  expectKernelError(
    () => projectBuilderPlanProposalResult({
      request: rawRequest,
      source_context_result: sourceContext,
      proposed_at_ms: 100,
      generated_text: generatedPlanText({
        steps: [{
          title: 'T'.repeat(121),
          purpose: 'Keep the next step reviewable before editing.',
          expected_change: 'No source files change during planning.',
        }],
      }),
    }),
    'builder_generation_structured_response_invalid',
  );
});

test('accepts generated JSON with provider outer whitespace while preserving exact inner contracts', () => {
  const rawCandidateRequest = request();
  const rawProjectRequest = request({ existingProjectId: PROJECT_ID });
  const common = {
    request: rawCandidateRequest,
    base_revision_evidence: null,
    base_source_tree: sourceTree(),
    conversation_events: conversationEvents({ requestDigest: rawCandidateRequest.request_digest }),
    turn_id: 'builder-turn:123e4567-e89b-42d3-a456-426614174003',
    run_id: 'builder-run:123e4567-e89b-42d3-a456-426614174006',
  };
  const candidate = projectBuilderGenerationResult({
    ...common,
    generated_text: `\n  ${generatedText()}  \n`,
  });
  const explanation = projectBuilderExplanationResult({
    request: rawProjectRequest,
    generated_text: `\n${generatedExplanationText()}\n`,
  });
  const plan = projectBuilderPlanProposalResult({
    request: rawProjectRequest,
    source_context_result: planSourceContextResult(rawProjectRequest),
    proposed_at_ms: 100,
    generated_text: `  ${generatedPlanText()}  `,
  });

  assert.equal(candidate.result_kind, 'candidate');
  assert.equal(explanation.result_kind, 'explanation');
  assert.equal(plan.result_kind, 'plan');
});

test('rejects provider output when it belongs to the other generation route', () => {
  const rawRequest = request({ instruction: 'Explain or change this project.' });
  const candidateContext = {
    request: rawRequest,
    base_revision_evidence: null,
    base_source_tree: sourceTree(),
    conversation_events: conversationEvents({ requestDigest: rawRequest.request_digest }),
    turn_id: 'builder-turn:123e4567-e89b-42d3-a456-426614174003',
    run_id: 'builder-run:123e4567-e89b-42d3-a456-426614174006',
  };

  expectKernelError(
    () => projectBuilderGenerationResult({
      ...candidateContext,
      generated_text: generatedExplanationText(),
    }),
    'builder_generation_structured_response_invalid',
  );
  expectKernelError(
    () => projectBuilderExplanationResult({
      request: rawRequest,
      generated_text: generatedText(),
    }),
    'builder_generation_structured_response_invalid',
  );
  expectKernelError(
    () => projectBuilderGenerationResult({
      ...candidateContext,
      generated_text: generatedPlanText(),
    }),
    'builder_generation_structured_response_invalid',
  );
  expectKernelError(
    () => projectBuilderPlanProposalResult({
      request: rawRequest,
      source_context_result: planSourceContextResult(request({
        instruction: 'Explain or change this project.',
        existingProjectId: PROJECT_ID,
      })),
      proposed_at_ms: 100,
      generated_text: generatedText(),
    }),
    'builder_generation_structured_response_invalid',
  );
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
    {
      kind: BUILDER_GENERATED_EXPLANATION_KIND,
      title: 'A',
      summary: 'B',
      explanation: `Bearer ${'a'.repeat(24)}`,
    },
    {
      kind: BUILDER_GENERATED_EXPLANATION_KIND,
      title: 'A',
      summary: 'B',
      explanation: '',
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
    './builder-plan-proposal-records.cjs',
  ]);
  for (const literal of [
    'builder-generation-request.v2',
    'builder-generation-result.v2',
    'builder-code-project.v3',
    'builder_code_change_operations',
    'builder-project-plan.v1',
    'builder_project_plan_proposal',
    'candidate_not_saved',
    'not_performed',
  ]) {
    assert.match(source, new RegExp(literal.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  }
  assert.doesNotMatch(source, /builder-project-revision-record|revision_digest|target_revision|parent_revision|static_preview|index\.html.*styles\.css.*app\.js/iu);
  assert.doesNotMatch(source, /(?:fetch\s*\(|node:https|node:http|electron|ipcMain|ipcRenderer|local-provider|chat_planner|ChatCreatePage|Canvas|JobMeta|secure-provider|repository\.commit|localStorage|sessionStorage|indexedDB|child_process|worker_threads|\beval\s*\(|new Function)/u);
});
