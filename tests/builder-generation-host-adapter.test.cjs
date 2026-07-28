'use strict';

const assert = require('node:assert/strict');
const nodeCrypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  createBuilderGenerationHostAdapter,
} = require('../electron/builder-generation-host-adapter.cjs');
const {
  createBuilderConversationEvent,
} = require('../electron/builder-conversation-records.cjs');
const {
  createBuilderProviderConfig,
} = require('../electron/builder-provider-config.cjs');
const {
  createBuilderProjectSourceTree,
} = require('../electron/builder-project-source-tree.cjs');

const UUID = '123e4567-e89b-42d3-a456-426614174000';
const PROJECT_ID = `builder-project:${UUID}`;
const TURN_ID = 'builder-turn:123e4567-e89b-42d3-a456-426614174003';
const TASK_ID = 'builder-task:123e4567-e89b-42d3-a456-426614174004';
const RUN_ID = 'builder-run:123e4567-e89b-42d3-a456-426614174006';
const GIT_REQUEST_ID = 'builder-git-request:123e4567-e89b-42d3-a456-426614174007';
const PRIVATE_MARKER = 'private-secret-marker';

function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function digest(value) {
  return `sha256:${nodeCrypto.createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')}`;
}

function request({ instruction = 'Make a focus timer.', existingProjectId = null } = {}) {
  const unsigned = {
    version: 'builder-generation-request.v2',
    instruction,
    existing_project_id: existingProjectId,
  };
  return { ...unsigned, request_digest: digest(unsigned) };
}

function providerOutput(overrides = {}) {
  return {
    kind: 'builder_code_change_operations',
    title: 'Focus timer',
    summary: 'A quiet timer for focused work.',
    operations: [
      { operation: 'upsert', path: 'index.html', content: '<main><h1>Focus</h1></main>\n' },
      { operation: 'upsert', path: 'src/app.js', content: 'import process from "node:process";\nconsole.log(process.pid);\n' },
    ],
    ...overrides,
  };
}

function providerExplanation(overrides = {}) {
  return {
    kind: 'builder_conversation_explanation',
    title: 'Current project',
    summary: 'Explains the current project.',
    explanation: 'The current project is a local app. This answer does not change source.',
    ...overrides,
  };
}

function providerPlan(overrides = {}) {
  return {
    kind: 'builder_project_plan_proposal',
    title: 'Review the change plan',
    summary: 'Prepare a bounded implementation before editing the project.',
    steps: [
      {
        title: 'Inspect the current project',
        purpose: 'Use the collected context to keep the edit focused.',
        expected_change: 'No source files change during planning.',
      },
      {
        title: 'Prepare the edit pass',
        purpose: 'Separate approval from source mutation.',
        expected_change: 'The next approved step can produce a draft.',
      },
    ],
    ...overrides,
  };
}

function sourceTree(files = []) {
  return createBuilderProjectSourceTree({ files });
}

function events({ requestDigest = request().request_digest, baseRevision = null } = {}) {
  const first = createBuilderConversationEvent({
    record_version: 'builder-conversation-event.v2',
    record_kind: 'builder_conversation_event',
    project_id: PROJECT_ID,
    conversation_id: `builder-conversation:${UUID}`,
    sequence: 1,
    command_id: 'builder-command:123e4567-e89b-42d3-a456-426614174001',
    event_type: 'turn_submitted',
    previous_event: null,
    payload: {
      message: { message_id: 'builder-message:123e4567-e89b-42d3-a456-426614174002', text: 'Make a focus timer.' },
      turn_id: TURN_ID,
      mode: 'work',
      task: { task_id: TASK_ID, title: 'Create Builder project' },
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
    project_id: PROJECT_ID,
    conversation_id: `builder-conversation:${UUID}`,
    sequence: 2,
    command_id: 'builder-command:123e4567-e89b-42d3-a456-426614174005',
    event_type: 'run_started',
    previous_event: { sequence: first.sequence, event_id: first.event_id, event_digest: first.event_digest },
    payload: {
      turn_id: TURN_ID,
      run_id: RUN_ID,
      task_id: TASK_ID,
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

function builderId(kind, index) {
  return `builder-${kind}:123e4567-e89b-42d3-a456-${index.toString(16).padStart(12, '0')}`;
}

function planSourceContextResult(raw = request({ existingProjectId: PROJECT_ID }), rawFiles = [
  { path: 'src/app.tsx', content: 'export const ready = true;\n' },
]) {
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
      request_digest: raw.request_digest,
      start_head: {
        sequence: 4,
        event_id: `builder-conversation-event:${'a'.repeat(64)}`,
        event_digest: `sha256:${'b'.repeat(64)}`,
      },
      attempt_number: 1,
      events: events({ requestDigest: raw.request_digest }),
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
        turn_id: TURN_ID,
        task_id: TASK_ID,
        run_id: RUN_ID,
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

function contextFor(raw = request(), overrides = {}) {
  const base = overrides.base_source_tree ?? sourceTree();
  return {
    project_id: PROJECT_ID,
    base_revision_evidence: overrides.base_revision_evidence ?? null,
    base_source_tree: base,
    conversation_events: overrides.conversation_events ?? events({ requestDigest: raw.request_digest }),
    turn_id: TURN_ID,
    task_id: TASK_ID,
    run_id: RUN_ID,
    git_request_id: GIT_REQUEST_ID,
  };
}

function draftContinuationContextFor(raw = request({ existingProjectId: PROJECT_ID }), overrides = {}) {
  return {
    project_id: PROJECT_ID,
    prompt_base_source_tree: overrides.prompt_base_source_tree ?? sourceTree([
      { path: 'index.html', content: '<main><h1>Draft</h1></main>\n' },
    ]),
    candidate_base_revision_evidence: overrides.candidate_base_revision_evidence ?? null,
    candidate_base_source_tree: overrides.candidate_base_source_tree ?? sourceTree(),
    conversation_events: overrides.conversation_events ?? events({ requestDigest: raw.request_digest }),
    turn_id: TURN_ID,
    task_id: TASK_ID,
    run_id: RUN_ID,
    git_request_id: GIT_REQUEST_ID,
  };
}

function explanationContextFor(raw = request(), overrides = {}) {
  const base = overrides.base_source_tree ?? sourceTree();
  return {
    project_id: PROJECT_ID,
    base_revision_evidence: overrides.base_revision_evidence ?? null,
    base_source_tree: base,
    conversation_events: overrides.conversation_events ?? events({ requestDigest: raw.request_digest }),
    turn_id: TURN_ID,
    task_id: null,
    run_id: RUN_ID,
  };
}

function planContextFor(raw = request({ existingProjectId: PROJECT_ID }), overrides = {}) {
  return {
    project_id: PROJECT_ID,
    source_context_result: overrides.source_context_result ?? planSourceContextResult(raw),
    conversation_events: overrides.conversation_events ?? events({ requestDigest: raw.request_digest }),
    turn_id: TURN_ID,
    task_id: TASK_ID,
    run_id: RUN_ID,
    proposed_at_ms: 100,
  };
}

function providerConfig() {
  return createBuilderProviderConfig({
    base_url: 'https://provider.example/v1',
    model: 'builder-model',
    timeout_ms: 30000,
    temperature: 0,
    max_tokens: 8192,
    secret_ref: {
      ref_version: 'builder-provider-secret-ref.v1',
      provider_id: 'builder-default',
      secret_id: 'builder-provider-secret:default',
    },
  });
}

function dependencies(overrides = {}) {
  const config = providerConfig();
  return {
    readProviderConfig: () => config,
    resolveSecret: () => ({
      resolution_version: 'builder-provider-secret-resolution.v1',
      secret_ref: config.secret_ref,
      credential: 'real-key-value',
    }),
    buildGenerationContext: (raw) => contextFor(raw),
    buildDraftContinuationContext: (raw) => draftContinuationContextFor(raw),
    buildExplanationContext: (raw) => explanationContextFor(raw),
    buildPlanContext: (raw) => planContextFor(raw),
    transport: async () => ({
      transport_version: 'builder-openai-compatible-transport.v1',
      generated_text: JSON.stringify(providerOutput()),
    }),
    ...overrides,
  };
}

test('generates an unsaved code-change candidate from verified base context', async () => {
  let contextReads = 0;
  let transportInput;
  const rawRequest = request();
  const adapter = createBuilderGenerationHostAdapter(dependencies({
    buildGenerationContext: (raw) => {
      contextReads += 1;
      return contextFor(raw);
    },
    transport: async (...args) => {
      transportInput = args;
      return {
        transport_version: 'builder-openai-compatible-transport.v1',
        generated_text: JSON.stringify(providerOutput()),
      };
    },
  }));
  const result = await adapter.generate(rawRequest);

  assert.equal(contextReads, 1);
  assert.equal(result.request_id, rawRequest.request_digest);
  assert.equal(result.title, 'Focus timer');
  assert.equal(result.candidate.project_id, PROJECT_ID);
  assert.equal(result.candidate.authority.revision_admission, 'not_created');
  assert.equal(result.candidate.authority.preview_admission, 'not_evaluated');
  assert.equal(result.context.git_request_id, GIT_REQUEST_ID);
  assert.equal(transportInput[0].base_url, 'https://provider.example/v1');
  assert.equal(transportInput[0].credential, 'real-key-value');
  assert.equal(transportInput[1].signal instanceof AbortSignal, true);
  assert.match(transportInput[0].messages[0].content, /builder_code_change_operations/u);
  assert.doesNotMatch(transportInput[0].messages[0].content, /builder_conversation_explanation/u);
  assert.doesNotMatch(JSON.stringify(result), /real-key|provider\.example|builder-model/iu);
});

test('reports fixed generation progress stages around provider transport', async () => {
  const stages = [];
  const rawRequest = request();
  const adapter = createBuilderGenerationHostAdapter(dependencies({
    onProgress: ({ context, stage }) => {
      stages.push({
        stage,
        eventCount: context.conversation_events.length,
      });
      return context;
    },
    transport: async () => ({
      transport_version: 'builder-openai-compatible-transport.v1',
      generated_text: JSON.stringify(providerOutput()),
    }),
  }));

  await adapter.generate(rawRequest);

  assert.deepEqual(stages, [
    { stage: 'context_ready', eventCount: 2 },
    { stage: 'provider_request_started', eventCount: 2 },
    { stage: 'provider_response_received', eventCount: 2 },
    { stage: 'result_preparing', eventCount: 2 },
  ]);
});

test('observes provider output deltas with the current run context', async () => {
  const observed = [];
  let controlKeys = [];
  const rawRequest = request();
  const adapter = createBuilderGenerationHostAdapter(dependencies({
    onOutputDelta(event) {
      observed.push(event);
      throw new Error(PRIVATE_MARKER);
    },
    transport: async (_input, control) => {
      controlKeys = Reflect.ownKeys(control).sort();
      await control.on_output_delta({ delta_text: '{"kind"' });
      await control.on_output_delta({ delta_text: ':"builder_code_project"}' });
      return {
        transport_version: 'builder-openai-compatible-transport.v1',
        generated_text: JSON.stringify(providerOutput()),
      };
    },
  }));

  const result = await adapter.generate(rawRequest);

  assert.equal(result.request_id, rawRequest.request_digest);
  assert.deepEqual(controlKeys, ['on_output_delta', 'signal']);
  assert.deepEqual(observed.map((event) => event.delta_text), [
    '{"kind"',
    ':"builder_code_project"}',
  ]);
  assert.equal(observed[0].context.project_id, PROJECT_ID);
  assert.equal(observed[0].context.turn_id, TURN_ID);
  assert.equal(observed[0].context.task_id, TASK_ID);
  assert.equal(observed[0].context.run_id, RUN_ID);
  assert.equal(Object.isFrozen(observed[0]), true);
  assert.doesNotMatch(JSON.stringify(observed), /real-key|provider\.example|builder-model/iu);
});

test('generates a bounded explanation without candidate or Git context', async () => {
  const rawRequest = request({ instruction: 'What does this project do?', existingProjectId: PROJECT_ID });
  const base = sourceTree([{ path: 'src/app.js', content: 'export const saved = true;\n' }]);
  let transportInput;
  const adapter = createBuilderGenerationHostAdapter(dependencies({
    buildExplanationContext: (raw) => explanationContextFor(raw, { base_source_tree: base }),
    transport: async (...args) => {
      transportInput = args;
      return {
        transport_version: 'builder-openai-compatible-transport.v1',
        generated_text: JSON.stringify(providerExplanation()),
      };
    },
  }));

  const result = await adapter.explain(rawRequest);
  assert.equal(result.version, 'builder-generation-result.v2');
  assert.equal(result.result_kind, 'explanation');
  assert.equal(result.request_id, rawRequest.request_digest);
  assert.equal(result.context.task_id, null);
  assert.equal(result.context.project_id, PROJECT_ID);
  assert.match(transportInput[0].messages[0].content, /builder_conversation_explanation/u);
  assert.doesNotMatch(transportInput[0].messages[0].content, /builder_code_change_operations/u);
  assert.match(transportInput[0].messages[1].content, /export const saved = true/u);
  assert.equal(transportInput[1].signal instanceof AbortSignal, true);
  assert.equal(Object.hasOwn(result, 'candidate'), false);
  assert.equal(Object.hasOwn(result.context, 'git_request_id'), false);
  assert.doesNotMatch(JSON.stringify(result), /real-key|provider\.example|builder-model|candidate_digest|git_request|operations/iu);
});

test('generates a bounded plan proposal from source context without creating Git evidence', async () => {
  const rawRequest = request({ instruction: 'Plan a smaller settings panel.', existingProjectId: PROJECT_ID });
  const sourceContext = planSourceContextResult(rawRequest, [
    { path: 'src/app.tsx', content: 'export const Settings = () => null;\n' },
  ]);
  const stages = [];
  let planContexts = 0;
  let transportInput;
  const observed = [];
  const adapter = createBuilderGenerationHostAdapter(dependencies({
    buildPlanContext: (raw) => {
      planContexts += 1;
      return planContextFor(raw, { source_context_result: sourceContext });
    },
    onProgress: ({ context, stage }) => {
      stages.push({
        stage,
        eventCount: context.conversation_events.length,
      });
      return context;
    },
    onOutputDelta(event) {
      observed.push(event);
      throw new Error(PRIVATE_MARKER);
    },
    transport: async (...args) => {
      transportInput = args;
      await args[1].on_output_delta({ delta_text: '{"kind":"builder_project_plan_proposal",' });
      await args[1].on_output_delta({ delta_text: '"summary":"Prepare a bounded' });
      await args[1].on_output_delta({ delta_text: ' implementation","steps":[]}' });
      return {
        transport_version: 'builder-openai-compatible-transport.v1',
        generated_text: JSON.stringify(providerPlan()),
      };
    },
  }));

  const result = await adapter.plan(rawRequest);

  assert.equal(planContexts, 1);
  assert.equal(result.version, 'builder-generation-result.v2');
  assert.equal(result.result_kind, 'plan');
  assert.equal(result.request_id, rawRequest.request_digest);
  assert.equal(result.context.project_id, PROJECT_ID);
  assert.equal(result.context.task_id, TASK_ID);
  assert.equal(result.plan_proposal_record.project_id, PROJECT_ID);
  assert.equal(result.plan_proposal_record.context_binding.file_count, 1);
  assert.equal(result.admissions.conversation, 'plan_local_not_recorded');
  assert.equal(result.admissions.draft, 'not_created');
  assert.equal(Object.hasOwn(result, 'candidate'), false);
  assert.match(transportInput[0].messages[0].content, /builder_project_plan_proposal/u);
  assert.doesNotMatch(transportInput[0].messages[0].content, /builder_code_change_operations|builder_conversation_explanation/u);
  assert.match(transportInput[0].messages[1].content, /Plan a smaller settings panel/u);
  assert.match(transportInput[0].messages[1].content, /export const Settings/u);
  assert.equal(transportInput[1].signal instanceof AbortSignal, true);
  assert.equal(typeof transportInput[1].on_output_delta, 'function');
  assert.deepEqual(stages, [
    { stage: 'context_ready', eventCount: 2 },
    { stage: 'provider_request_started', eventCount: 2 },
    { stage: 'provider_response_received', eventCount: 2 },
    { stage: 'result_preparing', eventCount: 2 },
  ]);
  assert.deepEqual(observed.map((event) => event.delta_text), [
    '{"kind":"builder_project_plan_proposal",',
    '"summary":"Prepare a bounded',
    ' implementation","steps":[]}',
  ]);
  assert.equal(observed[0].context.project_id, PROJECT_ID);
  assert.equal(observed[0].context.turn_id, TURN_ID);
  assert.equal(observed[0].context.task_id, TASK_ID);
  assert.equal(observed[0].context.run_id, RUN_ID);
  assert.match(
    result.context.source_context_result.private_source_context.files[0].content,
    /export const Settings/u,
  );
  assert.doesNotMatch(
    JSON.stringify({
      version: result.version,
      result_kind: result.result_kind,
      request_id: result.request_id,
      title: result.title,
      summary: result.summary,
      steps: result.steps,
      plan_proposal_record: result.plan_proposal_record,
      admissions: result.admissions,
    }),
    /real-key|provider\.example|builder-model|"private_source_context"|export const Settings|credential_value|credential_secret|"secret_ref"|api[_-]?key|"git_request"|"commit_oid"|"tree_oid"|"operations"/iu,
  );
});

test('repairs a malformed plan response once while keeping the final plan exact', async () => {
  const rawRequest = request({ instruction: 'Plan a compact update.', existingProjectId: PROJECT_ID });
  const sourceContext = planSourceContextResult(rawRequest, [
    { path: 'src/app.tsx', content: 'export const App = () => null;\n' },
  ]);
  const transportInputs = [];
  const adapter = createBuilderGenerationHostAdapter(dependencies({
    buildPlanContext: (raw) => planContextFor(raw, { source_context_result: sourceContext }),
    transport: async (...args) => {
      transportInputs.push(args);
      return {
        transport_version: 'builder-openai-compatible-transport.v1',
        generated_text: transportInputs.length === 1
          ? '{}'
          : JSON.stringify(providerPlan({ title: 'Repaired plan' })),
      };
    },
  }));

  const result = await adapter.plan(rawRequest);

  assert.equal(result.result_kind, 'plan');
  assert.equal(result.title, 'Repaired plan');
  assert.equal(transportInputs.length, 2);
  assert.equal(transportInputs[0][0].messages.length, 2);
  assert.equal(transportInputs[1][0].messages.length, 3);
  assert.match(transportInputs[1][0].messages[2].content, /previous plan response could not be verified/iu);
  assert.match(transportInputs[1][0].messages[2].content, /120 characters or fewer/iu);
  assert.match(transportInputs[1][0].messages[2].content, /1200 characters or fewer/iu);
  assert.match(transportInputs[1][0].messages[2].content, /360 characters or fewer/iu);
  assert.doesNotMatch(
    JSON.stringify({
      version: result.version,
      result_kind: result.result_kind,
      request_id: result.request_id,
      title: result.title,
      summary: result.summary,
      steps: result.steps,
      plan_proposal_record: result.plan_proposal_record,
      admissions: result.admissions,
    }),
    /"\{\}"|"operations"|"private_source_context"|credential_value|credential_secret|"secret_ref"|api[_-]?key|provider\.example|builder_code_change_operations/iu,
  );
});

test('passes verified current source into the prompt for an existing project', async () => {
  const rawRequest = request({ existingProjectId: PROJECT_ID, instruction: 'Add a pause button.' });
  const base = sourceTree([{ path: 'src/app.js', content: 'export const before = true;\n' }]);
  const baseRevision = {
    revision_receipt_digest: `sha256:${'1'.repeat(64)}`,
    commit_oid: '2'.repeat(40),
  };
  let userPrompt = '';
  const adapter = createBuilderGenerationHostAdapter(dependencies({
    buildGenerationContext: () => contextFor(rawRequest, {
      base_source_tree: base,
      base_revision_evidence: {
        evidence_version: 'builder-project-base-revision-evidence.v2',
        project_id: PROJECT_ID,
        revision_receipt_digest: baseRevision.revision_receipt_digest,
        commit_oid: baseRevision.commit_oid,
        source_tree_digest: base.source_tree_digest,
        verification_admission: 'git_sqlite_read_authority_verified',
      },
      conversation_events: events({
        requestDigest: rawRequest.request_digest,
        baseRevision,
      }),
    }),
    transport: async (input) => {
      userPrompt = input.messages[1].content;
      return {
        transport_version: 'builder-openai-compatible-transport.v1',
        generated_text: JSON.stringify(providerOutput({
          operations: [{ operation: 'upsert', path: 'src/app.js', content: 'export const before = false;\n' }],
        })),
      };
    },
  }));
  const result = await adapter.generate(rawRequest);

  assert.match(userPrompt, /Add a pause button/u);
  assert.match(userPrompt, /export const before = true/u);
  assert.equal(result.candidate.base_source_tree.source_tree_digest, base.source_tree_digest);
});

test('generates a draft continuation from pending candidate source while squashing to product base', async () => {
  const rawRequest = request({ existingProjectId: PROJECT_ID, instruction: 'Make the draft calmer.' });
  const productBase = sourceTree([
    { path: 'index.html', content: '<main><h1>Saved</h1></main>\n' },
  ]);
  const pendingBase = sourceTree([
    { path: 'index.html', content: '<main><h1>Draft</h1></main>\n' },
    { path: 'src/draft.js', content: 'export const pending = true;\n' },
  ]);
  const baseRevision = {
    revision_receipt_digest: `sha256:${'1'.repeat(64)}`,
    commit_oid: '2'.repeat(40),
  };
  const stages = [];
  let userPrompt = '';
  const adapter = createBuilderGenerationHostAdapter(dependencies({
    buildDraftContinuationContext: () => draftContinuationContextFor(rawRequest, {
      prompt_base_source_tree: pendingBase,
      candidate_base_source_tree: productBase,
      candidate_base_revision_evidence: {
        evidence_version: 'builder-project-base-revision-evidence.v2',
        project_id: PROJECT_ID,
        revision_receipt_digest: baseRevision.revision_receipt_digest,
        commit_oid: baseRevision.commit_oid,
        source_tree_digest: productBase.source_tree_digest,
        verification_admission: 'git_sqlite_read_authority_verified',
      },
      conversation_events: events({
        requestDigest: rawRequest.request_digest,
        baseRevision,
      }),
    }),
    onProgress: ({ context, stage }) => {
      stages.push({
        stage,
        promptDigest: context.prompt_base_source_tree.source_tree_digest,
        candidateDigest: context.candidate_base_source_tree.source_tree_digest,
      });
      return context;
    },
    transport: async (input) => {
      userPrompt = input.messages[1].content;
      return {
        transport_version: 'builder-openai-compatible-transport.v1',
        generated_text: JSON.stringify(providerOutput({
          operations: [
            { operation: 'upsert', path: 'src/draft.js', content: 'export const pending = "calm";\n' },
          ],
        })),
      };
    },
  }));

  const result = await adapter.generateDraftContinuation(rawRequest);

  assert.match(userPrompt, /Make the draft calmer/u);
  assert.match(userPrompt, /export const pending = true/u);
  assert.doesNotMatch(userPrompt, /<main><h1>Saved<\/h1><\/main>/u);
  assert.deepEqual(stages.map((stage) => stage.stage), [
    'context_ready',
    'provider_request_started',
    'provider_response_received',
    'result_preparing',
  ]);
  assert.equal(stages.every((stage) => stage.promptDigest === pendingBase.source_tree_digest), true);
  assert.equal(stages.every((stage) => stage.candidateDigest === productBase.source_tree_digest), true);
  assert.equal(result.candidate.base_source_tree.source_tree_digest, productBase.source_tree_digest);
  assert.equal(result.candidate.base_revision_evidence.commit_oid, baseRevision.commit_oid);
  assert.deepEqual(result.candidate.resulting_source_tree.files.map((file) => file.path), [
    'index.html',
    'src/draft.js',
  ]);
  assert.equal(
    result.candidate.resulting_source_tree.files.find((file) => file.path === 'src/draft.js').content,
    'export const pending = "calm";\n',
  );
  assert.doesNotMatch(JSON.stringify(result), /real-key|provider\.example|builder-model/iu);
});

test('shares exact concurrent requests and releases single-flight after completion', async () => {
  let resolveTransport;
  let calls = 0;
  const pending = new Promise((resolve) => { resolveTransport = resolve; });
  const adapter = createBuilderGenerationHostAdapter(dependencies({
    transport: async () => { calls += 1; return pending; },
  }));
  const raw = request();
  const first = adapter.generate(raw);
  const second = adapter.generate(structuredClone(raw));
  assert.equal(first, second);
  resolveTransport({
    transport_version: 'builder-openai-compatible-transport.v1',
    generated_text: JSON.stringify(providerOutput()),
  });
  await Promise.all([first, second]);
  await adapter.generate(raw);
  assert.equal(calls, 2);
});

test('cancels only the exact active request and propagates abort to transport', async () => {
  const adapter = createBuilderGenerationHostAdapter(dependencies({
    transport: async (_input, control) => new Promise((_resolve, reject) => {
      control.signal.addEventListener('abort', () => {
        const error = new Error('cancelled');
        error.code = 'builder_provider_cancelled';
        reject(error);
      }, { once: true });
    }),
  }));
  const raw = request();
  const pending = adapter.generate(raw);
  assert.deepEqual(adapter.cancel({ request_id: raw.request_digest }), {
    request_id: raw.request_digest,
    cancelled: true,
  });
  await assert.rejects(pending, { code: 'builder_generation_cancelled' });
  assert.deepEqual(adapter.cancel({ request_id: raw.request_digest }), {
    request_id: raw.request_digest,
    cancelled: false,
  });

  const answerAdapter = createBuilderGenerationHostAdapter(dependencies({
    transport: async (_input, control) => new Promise((_resolve, reject) => {
      control.signal.addEventListener('abort', () => {
        const error = new Error('cancelled');
        error.code = 'builder_provider_cancelled';
        reject(error);
      }, { once: true });
    }),
  }));
  const answer = answerAdapter.explain(raw);
  assert.deepEqual(answerAdapter.cancel({ request_id: raw.request_digest }), {
    request_id: raw.request_digest,
    cancelled: true,
  });
  await assert.rejects(answer, { code: 'builder_generation_cancelled' });

  const continuationAdapter = createBuilderGenerationHostAdapter(dependencies({
    transport: async (_input, control) => new Promise((_resolve, reject) => {
      control.signal.addEventListener('abort', () => {
        const error = new Error('cancelled');
        error.code = 'builder_provider_cancelled';
        reject(error);
      }, { once: true });
    }),
  }));
  const continuation = continuationAdapter.generateDraftContinuation(request({ existingProjectId: PROJECT_ID }));
  assert.deepEqual(continuationAdapter.cancel({ request_id: request({ existingProjectId: PROJECT_ID }).request_digest }), {
    request_id: request({ existingProjectId: PROJECT_ID }).request_digest,
    cancelled: true,
  });
  await assert.rejects(continuation, { code: 'builder_generation_cancelled' });

  const planAdapter = createBuilderGenerationHostAdapter(dependencies({
    transport: async (_input, control) => new Promise((_resolve, reject) => {
      control.signal.addEventListener('abort', () => {
        const error = new Error('cancelled');
        error.code = 'builder_provider_cancelled';
        reject(error);
      }, { once: true });
    }),
  }));
  const plan = planAdapter.plan(request({ existingProjectId: PROJECT_ID }));
  assert.deepEqual(planAdapter.cancel({ request_id: raw.request_digest }), {
    request_id: raw.request_digest,
    cancelled: false,
  });
  assert.deepEqual(planAdapter.cancel({ request_id: request({ existingProjectId: PROJECT_ID }).request_digest }), {
    request_id: request({ existingProjectId: PROJECT_ID }).request_digest,
    cancelled: true,
  });
  await assert.rejects(plan, { code: 'builder_generation_cancelled' });
});

test('cancels a stalled base read without invoking provider authority', async () => {
  let providerReads = 0;
  const adapter = createBuilderGenerationHostAdapter(dependencies({
    readProviderConfig: () => { providerReads += 1; return providerConfig(); },
    buildGenerationContext: async () => new Promise(() => {}),
  }));
  const raw = request();
  const pending = adapter.generate(raw);
  assert.equal(adapter.cancel({ request_id: raw.request_digest }).cancelled, true);
  await assert.rejects(pending, { code: 'builder_generation_cancelled' });
  assert.equal(providerReads, 0);
});

test('reports availability only when config and encrypted secret resolution are valid', () => {
  assert.deepEqual(createBuilderGenerationHostAdapter(dependencies()).availability(), {
    version: 'builder-generation-availability.v1',
    available: true,
    reason: 'ready',
    supports_cancel: true,
  });
  const unavailable = createBuilderGenerationHostAdapter(dependencies({
    resolveSecret: () => { throw new Error(PRIVATE_MARKER); },
  }));
  assert.deepEqual(unavailable.availability(), {
    version: 'builder-generation-availability.v1',
    available: false,
    reason: 'not_configured',
    supports_cancel: true,
  });
  const malformedCredential = createBuilderGenerationHostAdapter(dependencies({
    resolveSecret: () => ({
      resolution_version: 'builder-provider-secret-resolution.v1',
      secret_ref: providerConfig().secret_ref,
      credential: 'key\nvalue',
    }),
  }));
  assert.equal(malformedCredential.availability().available, false);
});

test('fails closed on base, config, secret, transport, and provider response drift', async () => {
  const cases = [
    [dependencies({ readProviderConfig: () => ({}) }), request(), 'builder_generation_provider_unavailable'],
    [dependencies({ resolveSecret: () => ({ credential: PRIVATE_MARKER }) }), request(), 'builder_generation_provider_unavailable'],
    [dependencies({ buildGenerationContext: () => ({}) }), request(), 'builder_generation_base_unavailable'],
    [dependencies({ transport: async () => ({ generated_text: '{}' }) }), request(), 'builder_generation_structured_response_invalid'],
    [dependencies({ transport: async () => ({ transport_version: 'builder-openai-compatible-transport.v1', generated_text: '{}' }) }), request(), 'builder_generation_structured_response_invalid'],
  ];
  for (const [deps, raw, code] of cases) {
    const adapter = createBuilderGenerationHostAdapter(deps);
    await assert.rejects(adapter.generate(raw), (error) => {
      assert.equal(error.code, code);
      assert.doesNotMatch(`${error.message}:${error.stack}`, /private|real-key|provider\.example/iu);
      return true;
    });
  }
});

test('maps timeout and provider failures without reflecting raw errors', async () => {
  for (const [transportCode, expected] of [
    ['builder_provider_timeout', 'builder_generation_timeout'],
    ['builder_provider_http_error', 'builder_generation_provider_http_error'],
    ['builder_provider_structured_response_invalid', 'builder_generation_structured_response_invalid'],
    ['builder_provider_response_too_large', 'builder_generation_structured_response_invalid'],
    ['builder_provider_failed', 'builder_generation_failed'],
  ]) {
    const adapter = createBuilderGenerationHostAdapter(dependencies({
      transport: async () => {
        const error = new Error(PRIVATE_MARKER);
        error.code = transportCode;
        throw error;
      },
    }));
    await assert.rejects(adapter.generate(request()), (error) => {
      assert.equal(error.code, expected);
      assert.doesNotMatch(`${error.message}:${error.stack}`, /private/iu);
      return true;
    });
  }
});

test('contains no IPC, renderer, legacy dispatcher, generic Chat, save, or old revision authority', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'electron', 'builder-generation-host-adapter.cjs'), 'utf8');
  assert.doesNotMatch(
    source,
    /ipcMain|ipcRenderer|contextBridge|BrowserWindow|chat_planner|local-provider-executor|ChatCreatePage|Canvas|JobMeta|repository\.commit|safeStorage|builder-project-revision|revision_digest|static_preview|child_process|worker_threads|\beval\s*\(|new Function/iu,
  );
});
