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
  createBuilderOpenAICompatibleTransport,
} = require('../electron/builder-openai-compatible-transport.cjs');
const {
  projectBuilderExplanationResult,
} = require('../electron/builder-generation-kernel.cjs');
const {
  createBuilderConversationEvent,
} = require('../electron/builder-conversation-records.cjs');
const {
  createBuilderProviderConfig,
} = require('../electron/builder-provider-config.cjs');
const {
  createBuilderProjectSourceTree,
} = require('../electron/builder-project-source-tree.cjs');
const {
  createBuilderSemanticRouteRequest,
} = require('../electron/builder-semantic-route-classifier.cjs');

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
  const taskAddressId = existingProjectId === null
    ? null
    : `builder-task-address:${UUID}`;
  const unsigned = {
    version: 'builder-generation-request.v3',
    instruction,
    existing_project_id: existingProjectId,
    task_address_id: taskAddressId,
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

function completePlanMarkdown() {
  return `# Product goals and boundaries

- Deliver an interactive football-themed technical blog with a navigable 3D stadium as its primary content interface.
- Keep article reading, search, keyboard navigation, and reduced-motion access fully usable without WebGL.

## Users and end-to-end flows

- A first-time visitor enters the stadium, selects a marked area, opens the associated article preview, and continues to the article page.
- A returning reader searches or filters posts without replaying the introductory camera sequence.

## Functional and interaction specification

- Define loading, ready, selected, article-open, empty, and recoverable-error states with visible feedback for every control.
- Support pointer, touch, keyboard, and screen-reader paths for stadium navigation and article selection.

## Visual and 3D behavior

- Use a bounded camera, labelled interaction markers, stable lighting, and progressive model quality so the scene remains legible and responsive.
- Respect reduced-motion preferences by replacing camera travel and ambient animation with immediate state changes.

## Technical architecture

- Separate the content domain, page routing, 3D scene adapter, interaction state, and persistence boundaries so article rendering does not depend on WebGL.
- Load the stadium client-side behind a capability check while server-rendering indexable article metadata and fallback navigation.

## Data, interfaces, modules, and files

- Define typed Post, Category, StadiumMarker, SceneState, and NavigationIntent contracts with validated identifiers and explicit empty states.
- Place content access, scene rendering, marker controls, article surfaces, and analytics behind separate modules with focused tests.

## Implementation phases and dependencies

- Phase one delivers content schemas, routes, fallback navigation, and acceptance fixtures before any 3D dependency is introduced.
- Phase two delivers the optimized stadium scene and marker interactions; phase three integrates content, accessibility, and production telemetry.

## Acceptance and verification matrix

- Verify article discovery, marker selection, browser history, deep links, refresh recovery, mobile input, keyboard input, and no-WebGL fallback.
- Measure initial content render, scene-ready time, frame stability, bundle size, memory use, and interaction latency against documented budgets.

## Security, privacy, accessibility, and performance

- Sanitize authored content, constrain external assets, avoid collecting interaction data without consent, and document retention behavior.
- Meet WCAG interaction requirements with semantic alternatives, visible focus, sufficient contrast, descriptive labels, and reduced motion.

## Risks, recovery, deployment, and maintenance

- Treat GPU failure, oversized assets, content/schema drift, and route-state divergence as explicit risks with fallback and rollback procedures.
- Deploy behind a feature flag, observe client errors and scene performance, retain the non-3D experience, and document content and asset updates.
`.trim();
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

function routeDecision(payload, projectId = PROJECT_ID) {
  const route = payload.mode === 'work' ? 'build' : 'answer';
  return {
    decision_id: `builder-route-decision:${payload.message.message_id.slice('builder-message:'.length)}`,
    decision_version: 'builder-composer-route-decision.v1',
    project_id: projectId,
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

function events({
  requestDigest = request().request_digest,
  baseRevision = null,
  route = 'build',
  projectId = PROJECT_ID,
} = {}) {
  const turnPayload = {
    message: { message_id: 'builder-message:123e4567-e89b-42d3-a456-426614174002', text: 'Make a focus timer.' },
    turn_id: TURN_ID,
    mode: ['build', 'plan'].includes(route) ? 'work' : 'question',
    task: projectId === null ? null : { task_id: TASK_ID, title: 'Create Builder project' },
    base_revision: baseRevision,
  };
  const submittedRouteDecision = route === 'plan'
    ? {
        ...routeDecision(turnPayload, projectId),
        route: 'plan',
        matched_signals: ['explicit_plan'],
        required_permissions: ['project_read'],
        permission_result: 'allowed',
        dispatch: 'plan',
      }
    : routeDecision(turnPayload, projectId);
  const first = createBuilderConversationEvent({
    record_version: 'builder-conversation-event.v2',
    record_kind: 'builder_conversation_event',
    project_id: projectId,
    conversation_id: `builder-conversation:${UUID}`,
    sequence: 1,
    command_id: 'builder-command:123e4567-e89b-42d3-a456-426614174001',
    event_type: 'turn_submitted',
    previous_event: null,
    payload: { ...turnPayload, route_decision: submittedRouteDecision },
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
    conversation_id: `builder-conversation:${UUID}`,
    sequence: 2,
    command_id: 'builder-command:123e4567-e89b-42d3-a456-426614174005',
    event_type: 'run_started',
    previous_event: { sequence: first.sequence, event_id: first.event_id, event_digest: first.event_digest },
    payload: {
      turn_id: TURN_ID,
      run_id: RUN_ID,
      task_id: projectId === null ? null : TASK_ID,
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

function priorProposalEvents(currentRequest) {
  const conversationId = `builder-conversation:${UUID}`;
  const authority = {
    context_authority: 'project_local_conversation',
    permission_admission: 'not_granted',
    execution_admission: 'not_granted',
    revision_admission: 'not_created',
  };
  const priorTurnId = 'builder-turn:123e4567-e89b-42d3-a456-426614174101';
  const priorRunId = 'builder-run:123e4567-e89b-42d3-a456-426614174102';
  const priorPayload = {
    message: {
      message_id: 'builder-message:123e4567-e89b-42d3-a456-426614174104',
      text: '我们确认要做一个带星空背景、鼠标视差和三维项目卡片的作品集首页。',
    },
    turn_id: priorTurnId,
    mode: 'question',
    task: null,
    base_revision: null,
  };
  const priorSubmitted = createBuilderConversationEvent({
    record_version: 'builder-conversation-event.v2',
    record_kind: 'builder_conversation_event',
    project_id: PROJECT_ID,
    conversation_id: conversationId,
    sequence: 1,
    command_id: 'builder-command:123e4567-e89b-42d3-a456-426614174103',
    event_type: 'turn_submitted',
    previous_event: null,
    payload: { ...priorPayload, route_decision: routeDecision(priorPayload) },
    authority,
  });
  const priorStarted = createBuilderConversationEvent({
    record_version: 'builder-conversation-event.v2',
    record_kind: 'builder_conversation_event',
    project_id: PROJECT_ID,
    conversation_id: conversationId,
    sequence: 2,
    command_id: 'builder-command:123e4567-e89b-42d3-a456-426614174105',
    event_type: 'run_started',
    previous_event: {
      sequence: priorSubmitted.sequence,
      event_id: priorSubmitted.event_id,
      event_digest: priorSubmitted.event_digest,
    },
    payload: {
      turn_id: priorTurnId,
      run_id: priorRunId,
      task_id: null,
      attempt_number: 1,
      retry_of_run_id: null,
      input_digest: `sha256:${'3'.repeat(64)}`,
    },
    authority,
  });
  const priorCompleted = createBuilderConversationEvent({
    record_version: 'builder-conversation-event.v2',
    record_kind: 'builder_conversation_event',
    project_id: PROJECT_ID,
    conversation_id: conversationId,
    sequence: 3,
    command_id: 'builder-command:123e4567-e89b-42d3-a456-426614174106',
    event_type: 'run_completed',
    previous_event: {
      sequence: priorStarted.sequence,
      event_id: priorStarted.event_id,
      event_digest: priorStarted.event_digest,
    },
    payload: {
      turn_id: priorTurnId,
      run_id: priorRunId,
      terminal_status: 'succeeded',
      result_kind: 'explanation',
      result_digest: `sha256:${'4'.repeat(64)}`,
      assistant_message: {
        message_id: 'builder-message:123e4567-e89b-42d3-a456-426614174107',
        text: '方案是做单页静态作品集，包含 hero、项目列表和联系入口，不加入后端。',
      },
      candidate_result: null,
      plan_admission: null,
    },
    authority,
  });
  const priorTurnCompleted = createBuilderConversationEvent({
    record_version: 'builder-conversation-event.v2',
    record_kind: 'builder_conversation_event',
    project_id: PROJECT_ID,
    conversation_id: conversationId,
    sequence: 4,
    command_id: 'builder-command:123e4567-e89b-42d3-a456-426614174108',
    event_type: 'turn_completed',
    previous_event: {
      sequence: priorCompleted.sequence,
      event_id: priorCompleted.event_id,
      event_digest: priorCompleted.event_digest,
    },
    payload: {
      turn_id: priorTurnId,
      run_id: priorRunId,
      outcome: 'answered',
    },
    authority,
  });
  const currentPayload = {
    message: {
      message_id: 'builder-message:123e4567-e89b-42d3-a456-426614174110',
      text: currentRequest.instruction,
    },
    turn_id: TURN_ID,
    mode: 'work',
    task: { task_id: TASK_ID, title: 'Create Builder project' },
    base_revision: null,
  };
  const currentSubmitted = createBuilderConversationEvent({
    record_version: 'builder-conversation-event.v2',
    record_kind: 'builder_conversation_event',
    project_id: PROJECT_ID,
    conversation_id: conversationId,
    sequence: 5,
    command_id: 'builder-command:123e4567-e89b-42d3-a456-426614174109',
    event_type: 'turn_submitted',
    previous_event: {
      sequence: priorTurnCompleted.sequence,
      event_id: priorTurnCompleted.event_id,
      event_digest: priorTurnCompleted.event_digest,
    },
    payload: { ...currentPayload, route_decision: routeDecision(currentPayload) },
    authority,
  });
  const currentStarted = createBuilderConversationEvent({
    record_version: 'builder-conversation-event.v2',
    record_kind: 'builder_conversation_event',
    project_id: PROJECT_ID,
    conversation_id: conversationId,
    sequence: 6,
    command_id: 'builder-command:123e4567-e89b-42d3-a456-426614174111',
    event_type: 'run_started',
    previous_event: {
      sequence: currentSubmitted.sequence,
      event_id: currentSubmitted.event_id,
      event_digest: currentSubmitted.event_digest,
    },
    payload: {
      turn_id: TURN_ID,
      run_id: RUN_ID,
      task_id: TASK_ID,
      attempt_number: 1,
      retry_of_run_id: null,
      input_digest: currentRequest.request_digest,
    },
    authority,
  });
  return [priorSubmitted, priorStarted, priorCompleted, priorTurnCompleted, currentSubmitted, currentStarted];
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

test('classifies the complete instruction through a bounded provider request without source context', async () => {
  let transportInput;
  let transportCallCount = 0;
  const adapter = createBuilderGenerationHostAdapter(dependencies({
    transport: async (...args) => {
      transportCallCount += 1;
      transportInput = args;
      return {
        transport_version: 'builder-openai-compatible-transport.v1',
        generated_text: JSON.stringify({
          kind: 'builder_semantic_route_classification',
          route: 'plan',
          confidence: 'high',
          reason_code: 'requests_plan_or_proposal',
        }),
      };
    },
  }));
  const routeRequest = createBuilderSemanticRouteRequest({
    instruction: '帮我做一个静态技术博客实施计划',
    context: {
      has_workspace: true,
      has_prior_build_context: false,
      has_pending_build_confirmation: false,
      has_unsaved_draft: false,
      working_context_status: 'discussing',
    },
  });

  const result = await adapter.classifyIntent(routeRequest);

  assert.equal(result.route, 'plan');
  assert.equal(transportCallCount, 1);
  assert.equal(result.confidence, 'high');
  assert.equal(result.authority.source_read, 'not_performed');
  assert.equal(transportInput[0].temperature, 0);
  assert.equal(transportInput[0].max_tokens, 256);
  assert.deepEqual(JSON.parse(transportInput[0].messages[1].content), {
    instruction: '帮我做一个静态技术博客实施计划',
    product_state: routeRequest.context,
  });
  assert.doesNotMatch(JSON.stringify(transportInput[0].messages), /source_tree|conversation_events|api[_-]?key/u);
});

test('does not issue a second classifier request when provider JSON is invalid', async () => {
  let transportCallCount = 0;
  const adapter = createBuilderGenerationHostAdapter(dependencies({
    transport: async () => {
      transportCallCount += 1;
      return {
        transport_version: 'builder-openai-compatible-transport.v1',
        generated_text: 'not-json',
      };
    },
  }));
  const routeRequest = createBuilderSemanticRouteRequest({
    instruction: '帮我做一个静态技术博客实施计划',
    context: {
      has_workspace: true,
      has_prior_build_context: false,
      has_pending_build_confirmation: false,
      has_unsaved_draft: false,
      working_context_status: 'discussing',
    },
  });

  await assert.rejects(() => adapter.classifyIntent(routeRequest), {
    code: 'builder_generation_structured_response_invalid',
  });
  assert.equal(transportCallCount, 1);
});

test('generates an unsaved Markdown file candidate through the normal review path', async () => {
  let transportInput;
  const rawRequest = request({
    instruction: 'Create a Markdown notes file for the launch checklist.',
    existingProjectId: PROJECT_ID,
  });
  const base = sourceTree([{ path: 'README.md', content: '# Existing\n' }]);
  const baseRevision = {
    revision_receipt_digest: `sha256:${'1'.repeat(64)}`,
    commit_oid: '2'.repeat(40),
  };
  const adapter = createBuilderGenerationHostAdapter(dependencies({
    buildGenerationContext: (raw) => contextFor(raw, {
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
        requestDigest: raw.request_digest,
        baseRevision,
      }),
    }),
    transport: async (...args) => {
      transportInput = args;
      return {
        transport_version: 'builder-openai-compatible-transport.v1',
        generated_text: JSON.stringify(providerOutput({
          title: 'Launch checklist notes',
          summary: 'Adds a Markdown launch checklist for local review.',
          operations: [
            {
              operation: 'upsert',
              path: 'docs/launch-checklist.md',
              content: '# Launch checklist\n\n- Confirm project settings.\n- Review the draft before saving.\n',
            },
          ],
        })),
      };
    },
  }));
  const result = await adapter.generate(rawRequest);
  const userPrompt = JSON.parse(transportInput[0].messages[1].content);

  assert.equal(result.title, 'Launch checklist notes');
  assert.equal(result.candidate.authority.revision_admission, 'not_created');
  assert.equal(result.admissions.save, 'not_performed');
  assert.match(transportInput[0].messages[0].content, /Markdown, README, notes, a \.md file, or a text document/iu);
  assert.match(userPrompt.instruction, /Markdown notes file/u);
  assert.deepEqual(
    result.candidate.operations.map(({ operation, path, content }) => ({ operation, path, content })),
    [
      {
        operation: 'upsert',
        path: 'docs/launch-checklist.md',
        content: '# Launch checklist\n\n- Confirm project settings.\n- Review the draft before saving.\n',
      },
    ],
  );
  assert.equal(
    result.candidate.resulting_source_tree.files.find((file) => file.path === 'docs/launch-checklist.md').content,
    '# Launch checklist\n\n- Confirm project settings.\n- Review the draft before saving.\n',
  );
  assert.doesNotMatch(JSON.stringify(result), /real-key|provider\.example|builder-model|credential/iu);
});

test('does not infer contextual build admission from transcript-only proposals', async () => {
  const rawRequest = request({ instruction: '好，开始吧' });
  let transportInput;
  const adapter = createBuilderGenerationHostAdapter(dependencies({
    buildGenerationContext: (raw) => contextFor(raw, {
      conversation_events: priorProposalEvents(raw),
    }),
    transport: async (...args) => {
      transportInput = args;
      return {
        transport_version: 'builder-openai-compatible-transport.v1',
        generated_text: JSON.stringify(providerOutput({
          title: 'Portfolio homepage',
          summary: 'Builds the discussed portfolio homepage.',
        })),
      };
    },
  }));

  const result = await adapter.generate(rawRequest);
  const userPrompt = JSON.parse(transportInput[0].messages[1].content);

  assert.equal(result.title, 'Portfolio homepage');
  assert.equal(userPrompt.instruction, '好，开始吧');
  assert.equal(userPrompt.conversation_brief.working_brief, null);
  assert.deepEqual(userPrompt.build_context_snapshot, {
    snapshot_version: 'builder-build-context-snapshot.v1',
    route: 'build',
    dispatch: 'build',
    confidence: 'high',
    matched_signals: ['clear_build'],
    execution_basis: 'explicit_instruction',
    workspace_basis: 'new_project_request',
    working_brief: {
      available: false,
      source: null,
      contextual_build_ready: false,
    },
    latest_plan: {
      available: false,
      state: 'none',
    },
    permissions: {
      write_project: 'route_required',
      command_execution: 'not_available',
      external_network: 'not_available',
    },
  });
  assert.match(transportInput[0].messages[0].content, /working_brief is requirements context/u);
  assert.match(transportInput[0].messages[1].content, /三维项目卡片/u);
  assert.doesNotMatch(
    transportInput[0].messages[1].content,
    /builder-working-brief|recent_chat_proposal|builder-(?:project|turn|run|message|conversation-event|command):|sha256:|request_digest|credential|provider|api[_-]?key|Bearer/iu,
  );
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

test('does not expose structured build JSON as user-visible output', async () => {
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
      return {
        transport_version: 'builder-openai-compatible-transport.v1',
        generated_text: JSON.stringify(providerOutput()),
      };
    },
  }));

  const result = await adapter.generate(rawRequest);

  assert.equal(result.request_id, rawRequest.request_digest);
  assert.deepEqual(controlKeys, ['signal']);
  assert.deepEqual(observed, []);
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

test('projects only the explanation string as incremental user-visible output', async () => {
  const rawRequest = request({ instruction: 'What does this project do?', existingProjectId: PROJECT_ID });
  const base = sourceTree([{ path: 'src/app.js', content: 'export const saved = true;\n' }]);
  const observed = [];
  const adapter = createBuilderGenerationHostAdapter(dependencies({
    buildExplanationContext: (raw) => explanationContextFor(raw, { base_source_tree: base }),
    onOutputDelta(event) {
      observed.push(event);
    },
    transport: async (_input, control) => {
      const chunks = [
        '{"kind":"builder_conversation_explanation","title":"Current project",',
        '"summary":"A bounded answer.","explanation":"This project ',
        'renders a quiet timer with \\u4e2d\\u6587 ',
        'support."}',
      ];
      for (const delta_text of chunks) await control.on_output_delta({ delta_text });
      return {
        transport_version: 'builder-openai-compatible-transport.v1',
        generated_text: JSON.stringify(providerExplanation()),
      };
    },
  }));

  await adapter.explain(rawRequest);

  assert.equal(observed.map((event) => event.delta_text).join(''), 'This project renders a quiet timer with 中文 support.');
  assert.equal(observed.every((event) => event.context.project_id === PROJECT_ID), true);
  assert.doesNotMatch(JSON.stringify(observed), /builder_conversation_explanation|"summary"|"kind"/u);
});

test('repairs a plan-shaped response in the read-only explanation route', async () => {
  const rawRequest = request({ instruction: '帮我写一个方案', existingProjectId: null });
  const transportInputs = [];
  const adapter = createBuilderGenerationHostAdapter(dependencies({
    buildExplanationContext: (raw) => explanationContextFor(raw),
    transport: async (...args) => {
      transportInputs.push(args);
      return {
        transport_version: 'builder-openai-compatible-transport.v1',
        generated_text: transportInputs.length === 1
          ? JSON.stringify(providerPlan())
          : JSON.stringify(providerExplanation({
            title: '方案',
            summary: '以聊天方式给出方案。',
            explanation: '可以先按目标、内容结构、视觉方向和实现步骤来整理方案。',
          })),
      };
    },
  }));

  const result = await adapter.explain(rawRequest);

  assert.equal(result.result_kind, 'explanation');
  assert.equal(result.title, '方案');
  assert.match(result.explanation, /目标|内容结构|视觉方向|实现步骤/u);
  assert.equal(transportInputs.length, 2);
  assert.equal(transportInputs[0][0].messages.length, 2);
  assert.equal(transportInputs[1][0].messages.length, 3);
  assert.match(transportInputs[1][0].messages[2].content, /previous answer response could not be verified/iu);
  assert.match(transportInputs[1][0].messages[2].content, /Preserve the language of the original end-user instruction/iu);
  assert.match(transportInputs[1][0].messages[2].content, /must not change the response language/iu);
  assert.match(transportInputs[1][0].messages[2].content, /Set kind to builder_conversation_explanation/u);
  assert.match(transportInputs[1][0].messages[2].content, /complete implementation blueprint/iu);
  assert.match(transportInputs[1][0].messages[2].content, /modules and files/iu);
  assert.match(transportInputs[1][0].messages[2].content, /risks and rollback/iu);
  assert.doesNotMatch(
    JSON.stringify({
      version: result.version,
      result_kind: result.result_kind,
      request_id: result.request_id,
      title: result.title,
      summary: result.summary,
      explanation: result.explanation,
      admissions: result.admissions,
    }),
    /builder_project_plan_proposal|builder_code_change_operations|"steps"|"operations"|credential_value|credential_secret|"secret_ref"|api[_-]?key|provider\.example/iu,
  );
});

test('retains an underspecified Agent plan without silently rewriting it', async () => {
  const rawRequest = request({ instruction: '为交互式 3D 足球博客制定完整实施计划', existingProjectId: PROJECT_ID });
  const transportInputs = [];
  const output = [];
  const validation = [];
  const incomplete = [];
  const planConversationEvents = events({ requestDigest: rawRequest.request_digest, route: 'plan' });
  assert.equal(projectBuilderExplanationResult({
    request: rawRequest,
    generated_text: JSON.stringify(providerExplanation({ explanation: completePlanMarkdown() })),
  }).explanation, completePlanMarkdown());
  const adapter = createBuilderGenerationHostAdapter(dependencies({
    onOutputDelta: ({ delta_text }) => output.push(delta_text),
    onOutputReset: () => output.push('RESET'),
    onPlanResponseValidation: (facts) => validation.push(facts),
    onIncompletePlan: (value) => incomplete.push(value),
    buildExplanationContext: (raw) => ({
      ...explanationContextFor(raw, {
        base_source_tree: sourceTree([{ path: 'README.md', content: '# Existing project\n' }]),
        conversation_events: planConversationEvents,
      }),
    }),
    transport: async (...args) => {
      transportInputs.push(args);
      await args[1].on_output_delta({
        delta_text: transportInputs.length === 1 ? '# Short outline' : completePlanMarkdown(),
      });
      return {
        transport_version: 'builder-openai-compatible-transport.v1',
        generated_text: '# 技术选择\n\n- 使用 React 和 Three.js。\n- 下一步可以开始搭建。',
      };
    },
  }));

  await assert.rejects(adapter.explain(rawRequest), { code: 'builder_generation_structured_response_invalid' });

  assert.equal(transportInputs.length, 1);
  assert.deepEqual(output, ['# Short outline']);
  assert.equal(incomplete.length, 1);
  assert.match(incomplete[0].explanation, /Incomplete plan[\s\S]*# Short outline/u);
  for (const input of transportInputs) {
    assert.equal(input[0].messages.length, 2);
    assert.match(input[0].messages[0].content, /raw Markdown only/iu);
    assert.equal(JSON.parse(input[0].messages[1].content).response_mode, 'plan');
    assert.equal(JSON.parse(input[0].messages[1].content).instruction, rawRequest.instruction);
  }
  assert.deepEqual(validation.map((facts) => facts.accepted), [0]);
  assert.deepEqual(Object.keys(validation[0]).sort(), ['accepted', 'code_points', 'headings', 'list_items', 'outer_whitespace', 'utf8_bytes']);
});

for (const streaming of [false, true]) {
  for (const complete of [false, true]) {
    test(`Agent plan uses a single request (observer=${streaming}, complete=${complete})`, async () => {
      const rawRequest = request({
        instruction: 'Plan a complete interactive football blog.', existingProjectId: PROJECT_ID,
      });
      const requests = [];
      const output = [];
      const incomplete = [];
      const shortPlan = '# Short outline';
      const adapter = createBuilderGenerationHostAdapter(dependencies({
        onIncompletePlan: (value) => incomplete.push(value),
        buildExplanationContext: (raw) => ({
          ...explanationContextFor(raw, {
            conversation_events: events({ requestDigest: raw.request_digest, route: 'plan' }),
          }),
        }),
        ...(streaming ? {
          onOutputDelta: ({ delta_text }) => output.push(delta_text),
          onOutputReset: () => output.push('RESET'),
        } : {}),
        transport: createBuilderOpenAICompatibleTransport({
          fetchImpl: async (_url, options) => {
            requests.push(JSON.parse(options.body));
            const content = complete ? completePlanMarkdown() : shortPlan;
            return JSON.parse(options.body).stream
              ? new Response([
                `data: ${JSON.stringify({ choices: [{ finish_reason: null, delta: { content } }] })}\n\n`,
                `data: ${JSON.stringify({ choices: [{ finish_reason: 'stop', delta: {} }] })}\n\n`,
                'data: [DONE]\n\n',
              ].join(''), { headers: { 'content-type': 'text/event-stream' } })
              : new Response(JSON.stringify({
                choices: [{ finish_reason: 'stop', message: { role: 'assistant', content } }],
              }), { headers: { 'content-type': 'application/json' } });
          },
        }),
      }));

      if (complete) {
        assert.equal((await adapter.explain(rawRequest)).explanation, completePlanMarkdown());
      } else {
        await assert.rejects(adapter.explain(rawRequest), { code: 'builder_generation_structured_response_invalid' });
      }
      assert.equal(requests.length, 1, 'plan validation must not automatically rewrite the answer');
      assert.deepEqual(requests.map((value) => value.messages.length), [2]);
      assert.equal(incomplete.length, complete ? 0 : 1);
      for (const value of requests) {
        assert.equal(value.stream, true, 'plan output is captured even without a UI observer');
        assert.match(value.messages[0].content, /raw Markdown only/iu);
        assert.equal(JSON.parse(value.messages[1].content).response_mode, 'plan');
        assert.equal(JSON.parse(value.messages[1].content).instruction, rawRequest.instruction);
      }
      if (streaming) {
        assert.deepEqual(output, [complete ? completePlanMarkdown() : shortPlan]);
      }
    });
  }
}

test('accepts a legacy JSON-wrapped Agent plan without exposing the wrapper', async () => {
  const rawRequest = request({
    instruction: 'Plan a complete interactive football blog.', existingProjectId: PROJECT_ID,
  });
  const output = [];
  const markdown = completePlanMarkdown();
  const wrapped = JSON.stringify(providerExplanation({ explanation: markdown }));
  const adapter = createBuilderGenerationHostAdapter(dependencies({
    onOutputDelta: ({ delta_text }) => output.push(delta_text),
    buildExplanationContext: (raw) => explanationContextFor(raw, {
      conversation_events: events({ requestDigest: raw.request_digest, route: 'plan' }),
    }),
    transport: async (_input, runtime) => {
      await runtime.on_output_delta({ delta_text: wrapped.slice(0, 97) });
      await runtime.on_output_delta({ delta_text: wrapped.slice(97) });
      return {
        transport_version: 'builder-openai-compatible-transport.v1',
        generated_text: wrapped,
      };
    },
  }));

  assert.equal((await adapter.explain(rawRequest)).explanation, markdown);
  assert.equal(output.join(''), markdown);
  assert.doesNotMatch(output.join(''), /builder_conversation_explanation|"explanation"/u);
});

test('accepts full Agent plans with bold sections and prose instead of Markdown heading/list quotas', async () => {
  const markdown = completePlanMarkdown().replace(/^#{1,6} (.+)$/gmu, '**$1**').replace(/^- /gmu, '');
  let attempts = 0;
  const adapter = createBuilderGenerationHostAdapter(dependencies({
    buildExplanationContext: (raw) => explanationContextFor(raw, {
      conversation_events: events({ requestDigest: raw.request_digest, route: 'plan' }),
    }),
    transport: async () => {
      attempts += 1;
      return { transport_version: 'builder-openai-compatible-transport.v1',
        generated_text: markdown };
    },
  }));
  const result = await adapter.explain(request({ existingProjectId: PROJECT_ID }));
  assert.equal(result.explanation, markdown);
  assert.equal(attempts, 1);
});

for (const unsafe of [false, true]) {
  test(`retains only safe plan text after a truncated stream (unsafe=${unsafe})`, async () => {
    const incomplete = [];
    let attempts = 0;
    const partial = unsafe ? 'Use C:\\Users\\private\\secret.txt in this plan.' : '# Draft\n\nThe timer must support pause and resume.';
    const adapter = createBuilderGenerationHostAdapter(dependencies({
      onIncompletePlan: (value) => incomplete.push(value),
      buildExplanationContext: (raw) => explanationContextFor(raw, {
        conversation_events: events({ requestDigest: raw.request_digest, route: 'plan' }),
      }),
      transport: async (_input, runtime) => {
        attempts += 1;
        await runtime.on_output_delta({ delta_text: partial });
        throw Object.assign(new Error('stream timeout'), { code: 'builder_provider_timeout' });
      },
    }));
    await assert.rejects(adapter.explain(request({ existingProjectId: PROJECT_ID })));
    assert.equal(attempts, 1);
    assert.equal(incomplete.length, unsafe ? 0 : 1);
    if (!unsafe) assert.ok(incomplete[0].explanation.endsWith(partial));
  });
}

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
  assert.equal(Object.hasOwn(transportInput[1], 'on_output_delta'), false);
  assert.deepEqual(stages, [
    { stage: 'context_ready', eventCount: 2 },
    { stage: 'provider_request_started', eventCount: 2 },
    { stage: 'provider_response_received', eventCount: 2 },
    { stage: 'result_preparing', eventCount: 2 },
  ]);
  assert.deepEqual(observed, []);
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
  assert.match(transportInputs[1][0].messages[2].content, /Preserve the language of the original end-user instruction/iu);
  assert.match(transportInputs[1][0].messages[2].content, /must not change the response language/iu);
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

test('rejects provider context prompt bridge material before explicit prompt wiring', async () => {
  const cases = [
    [
      'provider_context_projection',
      {
        projection_version: 'builder-provider-context-projection.v1',
        projection_status: 'ready',
        provider_context: {
          context_version: 'builder-provider-context.v1',
          source: 'context_assembler',
          purpose: 'contextual_build',
          segments: [{ kind: 'working_context_objective', text: 'Private task context.' }],
        },
      },
    ],
    [
      'provider_context_prompt_egress_gate',
      {
        gate_version: 'builder-provider-context-prompt-egress-gate.v1',
        gate_id: 'provider-context-prompt-egress-gate-test',
        projection_ref: {
          projection_id: 'provider-context-projection-test',
          projection_status: 'ready',
        },
        provider_prompt_context: {
          segments: [{ kind: 'working_context_objective', text: 'Private task context.' }],
        },
      },
    ],
    [
      'provider_context_prompt_bridge_descriptor',
      {
        result_version: 'builder-provider-context-prompt-bridge-descriptor.v1',
        descriptor_id: 'builder-provider-context-prompt-bridge-descriptor:test',
        prompt_descriptor: {
          user_instruction: 'Private task context.',
        },
      },
    ],
  ];

  for (const [key, payload] of cases) {
    let transportCalls = 0;
    const adapter = createBuilderGenerationHostAdapter(dependencies({
      buildGenerationContext: (raw) => ({
        ...contextFor(raw),
        [key]: payload,
      }),
      transport: async () => {
        transportCalls += 1;
        return {
          transport_version: 'builder-openai-compatible-transport.v1',
          generated_text: JSON.stringify(providerOutput()),
        };
      },
    }));

    await assert.rejects(adapter.generate(request()), (error) => {
      assert.equal(error.code, 'builder_generation_base_unavailable');
      assert.doesNotMatch(
        `${error.message}:${error.stack}`,
        /Private task context|provider-context|prompt-egress|provider_prompt_context/iu,
      );
      return true;
    });
    assert.equal(transportCalls, 0);
  }
});

test('maps timeout and provider failures without reflecting raw errors', async () => {
  for (const [transportCode, expected] of [
    ['builder_provider_request_invalid', 'builder_generation_request_invalid'],
    ['builder_provider_unavailable', 'builder_generation_provider_unavailable'],
    ['builder_provider_timeout', 'builder_generation_timeout'],
    ['builder_provider_http_error', 'builder_generation_provider_http_error'],
    ['builder_provider_transport_error', 'builder_generation_provider_transport_error'],
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
