'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  BuilderHarnessGenerationRunnerError,
  createBuilderHarnessGenerationRunner,
} = require('../electron/builder-harness-generation-runner.cjs');
const {
  BUILDER_HARNESS_RUNTIME_COMPOSITION_VERSION,
} = require('../electron/builder-harness-runtime-composition.cjs');
const {
  createBuilderProgrammingRuntimeDescriptor,
  createBuilderProgrammingRuntimeRunContract,
} = require('../electron/builder-programming-runtime-contract.cjs');
const {
  createBuilderProjectSourceTree,
} = require('../electron/builder-project-source-tree.cjs');
const {
  createBuilderProviderConfig,
} = require('../electron/builder-provider-config.cjs');
const {
  CONVERSATION_AUTHORITY,
  CONVERSATION_EVENT_KIND,
  CONVERSATION_EVENT_VERSION,
  createBuilderConversationEvent,
} = require('../electron/builder-conversation-records.cjs');

const UUID = '12345678-1234-4234-8234-123456789abc';
const ZERO_DIGEST = `sha256:${'0'.repeat(64)}`;

function conversationEvent(events, eventType, payload) {
  const previous = events.at(-1) ?? null;
  const sequence = events.length + 1;
  return [...events, createBuilderConversationEvent({
    record_version: CONVERSATION_EVENT_VERSION,
    record_kind: CONVERSATION_EVENT_KIND,
    project_id: `builder-project:${UUID}`,
    conversation_id: `builder-conversation:${UUID}`,
    sequence,
    command_id: `builder-command:00000000-0000-4000-8000-${sequence.toString(16).padStart(12, '0')}`,
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

function activeRunEvents() {
  const turnId = `builder-turn:${UUID}`;
  const taskId = `builder-task:${UUID}`;
  const runId = `builder-run:${UUID}`;
  const messageId = `builder-message:${UUID}`;
  let events = conversationEvent([], 'turn_submitted', {
    message: { message_id: messageId, text: 'Update index.html.' },
    turn_id: turnId,
    mode: 'work',
    task: { task_id: taskId, title: 'Update project' },
    base_revision: null,
    route_decision: {
      decision_id: `builder-route-decision:${UUID}`,
      decision_version: 'builder-composer-route-decision.v1',
      project_id: `builder-project:${UUID}`,
      message_id: messageId,
      task_id: taskId,
      route: 'build',
      confidence: 'high',
      matched_signals: ['clear_build'],
      downgraded_from: null,
      downgrade_reason: null,
      required_permissions: ['write_project'],
      permission_result: 'allowed',
      dispatch: 'build',
      decided_at_ms: 1,
    },
  });
  events = conversationEvent(events, 'run_started', {
    turn_id: turnId,
    run_id: runId,
    task_id: taskId,
    attempt_number: 1,
    retry_of_run_id: null,
    input_digest: ZERO_DIGEST,
  });
  return events;
}

function fixture(overrides = {}) {
  const descriptor = createBuilderProgrammingRuntimeDescriptor({
    runtime_kind: 'deepseek_harness.v1',
    implementation_version: '1.0.0',
    capabilities: {
      streaming_text: true,
      reasoning_status: 'none',
      native_tool_calls: true,
      steering: 'none',
      cancellation: 'process',
      session_resume: 'none',
      context_compaction: true,
      parallel_read_tools: false,
    },
  });
  let cancelCount = 0;
  const reconciliationStatuses = [];
  const composition = {
    composition_version: BUILDER_HARNESS_RUNTIME_COMPOSITION_VERSION,
    descriptor,
    async startRun(input) {
      return {
        run_id: `builder-run:${UUID}`,
        completion: Promise.resolve(Object.freeze(
          typeof overrides.completion === 'function'
            ? overrides.completion(input)
            : {
                status: 'failed',
                resulting_source_tree: null,
                runtime_code: 'builder_harness_programming_runtime_failed',
                runtime_cause_code: 'builder_harness_process_host_runtime_failed',
              },
        )),
      };
    },
    async repairRun() { throw new Error('not used'); },
    async reconcileRun(_handle, { checkpoint_status: checkpointStatus }) {
      reconciliationStatuses.push(checkpointStatus);
      return { status: 'completed' };
    },
    async cancelRun() { cancelCount += 1; return { cancellation_requested: true }; },
    pendingUserQuestion() { return null; },
    answerUserQuestion() { return false; },
    async dispose() {},
  };
  return {
    descriptor,
    runner: createBuilderHarnessGenerationRunner({
      runtime_composition: composition,
      read_conversation_events: () => overrides.conversation_events ?? [],
    }),
    getCancelCount: () => cancelCount,
    reconciliationStatuses,
  };
}

test('preserves fixed runtime diagnostics when a Harness run cannot produce a candidate', async () => {
  const { descriptor, runner, getCancelCount } = fixture();
  const sourceTree = createBuilderProjectSourceTree({ files: [
    { path: 'index.html', content: '<h1>Before</h1>\n' },
  ] });
  const providerConfig = createBuilderProviderConfig({
    base_url: 'https://api.deepseek.com',
    model: 'deepseek-v4-flash',
    timeout_ms: 30_000,
    temperature: null,
    max_tokens: 4_096,
    secret_ref: {
      ref_version: 'builder-provider-secret-ref.v1',
      provider_id: 'builder-default',
      secret_id: 'builder-provider-secret:default',
    },
  });
  const runContract = createBuilderProgrammingRuntimeRunContract({
    runtime_descriptor: descriptor,
    admission: {
      project_id: `builder-project:${UUID}`,
      conversation_id: `builder-conversation:${UUID}`,
      turn_id: `builder-turn:${UUID}`,
      task_id: `builder-task:${UUID}`,
      run_id: `builder-run:${UUID}`,
      mode: 'build',
      workspace_ref: {
        ref_version: 'builder-programming-workspace-ref.v1',
        workspace_id: `builder-programming-workspace:${'b'.repeat(64)}`,
        source_tree_digest: sourceTree.source_tree_digest,
        writable: true,
      },
      provider_config_digest: providerConfig.config_digest,
      allowed_tools: ['read', 'search', 'edit', 'write'],
      limits: {
        max_steps: 16,
        max_duration_ms: 30_000,
        max_model_tokens: 4_096,
        max_tool_output_bytes: 64 * 1_024,
      },
      admitted_at_ms: 10,
    },
    input: {
      message_id: `builder-message:${UUID}`,
      text: 'Update index.html.',
    },
  });

  await assert.rejects(
    runner.run({
      run_contract: runContract,
      source_tree: sourceTree,
      candidate_base_source_tree: sourceTree,
      base_revision_evidence: null,
      provider_config: providerConfig,
      credential: 'configured-test-credential',
      event_sink: { emit() {} },
    }),
    (error) => {
      assert.ok(error instanceof BuilderHarnessGenerationRunnerError);
      assert.equal(error.code, 'builder_harness_generation_runner_failed');
      assert.equal(error.runtime_code, 'builder_harness_programming_runtime_failed');
      assert.equal(error.runtime_cause_code, 'builder_harness_process_host_runtime_failed');
      return true;
    },
  );
  assert.equal(getCancelCount(), 1);
  await runner.dispose();
});

test('fails closed when a Build settles without changing the Harness source tree', async () => {
  const sourceTree = createBuilderProjectSourceTree({ files: [
    { path: 'index.html', content: '<h1>Before</h1>\n' },
  ] });
  const { descriptor, runner, getCancelCount, reconciliationStatuses } = fixture({
    completion: () => ({
      status: 'awaiting_reconciliation',
      resulting_source_tree: sourceTree,
      assistant_text: 'I inspected the project, but I need the target text before changing files.',
      verification_step_id: `builder-run-step:${UUID}`,
    }),
  });
  const providerConfig = createBuilderProviderConfig({
    base_url: 'https://api.deepseek.com',
    model: 'deepseek-v4-flash',
    timeout_ms: 30_000,
    temperature: null,
    max_tokens: 4_096,
    secret_ref: {
      ref_version: 'builder-provider-secret-ref.v1',
      provider_id: 'builder-default',
      secret_id: 'builder-provider-secret:default',
    },
  });
  const runContract = createBuilderProgrammingRuntimeRunContract({
    runtime_descriptor: descriptor,
    admission: {
      project_id: `builder-project:${UUID}`,
      conversation_id: `builder-conversation:${UUID}`,
      turn_id: `builder-turn:${UUID}`,
      task_id: `builder-task:${UUID}`,
      run_id: `builder-run:${UUID}`,
      mode: 'build',
      workspace_ref: {
        ref_version: 'builder-programming-workspace-ref.v1',
        workspace_id: `builder-programming-workspace:${'b'.repeat(64)}`,
        source_tree_digest: sourceTree.source_tree_digest,
        writable: true,
      },
      provider_config_digest: providerConfig.config_digest,
      allowed_tools: ['read', 'search', 'edit', 'write'],
      limits: {
        max_steps: 16,
        max_duration_ms: 30_000,
        max_model_tokens: 4_096,
        max_tool_output_bytes: 64 * 1_024,
      },
      admitted_at_ms: 10,
    },
    input: {
      message_id: `builder-message:${UUID}`,
      text: 'Inspect the project and make the requested change.',
      completion_requirement: 'source_change_required',
    },
  });

  await assert.rejects(runner.run({
    run_contract: runContract,
    source_tree: sourceTree,
    candidate_base_source_tree: sourceTree,
    base_revision_evidence: null,
    provider_config: providerConfig,
    credential: 'configured-test-credential',
    event_sink: { emit() {} },
  }), {
    code: 'builder_harness_generation_runner_failed',
    runtime_code: 'builder_harness_source_change_required',
    runtime_cause_code: 'builder_harness_source_change_required',
  });

  assert.deepEqual(reconciliationStatuses, []);
  assert.equal(getCancelCount(), 1);
  await runner.dispose();
});

test('allows explicit response-only Build runs to finish without changing the Harness source tree', async () => {
  const sourceTree = createBuilderProjectSourceTree({ files: [
    { path: 'index.html', content: '<h1>Before</h1>\n' },
  ] });
  const { descriptor, runner, getCancelCount, reconciliationStatuses } = fixture({
    completion: () => ({
      status: 'awaiting_reconciliation',
      resulting_source_tree: sourceTree,
      assistant_text: 'I inspected the project without changing files.',
      verification_step_id: `builder-run-step:${UUID}`,
    }),
  });
  const providerConfig = createBuilderProviderConfig({
    base_url: 'https://api.deepseek.com',
    model: 'deepseek-v4-flash',
    timeout_ms: 30_000,
    temperature: null,
    max_tokens: 4_096,
    secret_ref: {
      ref_version: 'builder-provider-secret-ref.v1',
      provider_id: 'builder-default',
      secret_id: 'builder-provider-secret:default',
    },
  });
  const runContract = createBuilderProgrammingRuntimeRunContract({
    runtime_descriptor: descriptor,
    admission: {
      project_id: `builder-project:${UUID}`,
      conversation_id: `builder-conversation:${UUID}`,
      turn_id: `builder-turn:${UUID}`,
      task_id: `builder-task:${UUID}`,
      run_id: `builder-run:${UUID}`,
      mode: 'build',
      workspace_ref: {
        ref_version: 'builder-programming-workspace-ref.v1',
        workspace_id: `builder-programming-workspace:${'b'.repeat(64)}`,
        source_tree_digest: sourceTree.source_tree_digest,
        writable: true,
      },
      provider_config_digest: providerConfig.config_digest,
      allowed_tools: ['read', 'search', 'edit', 'write'],
      limits: {
        max_steps: 16,
        max_duration_ms: 30_000,
        max_model_tokens: 4_096,
        max_tool_output_bytes: 64 * 1_024,
      },
      admitted_at_ms: 10,
    },
    input: {
      message_id: `builder-message:${UUID}`,
      text: 'Inspect the project. Do not change files.',
      completion_requirement: 'response_allowed',
    },
  });

  const result = await runner.run({
    run_contract: runContract,
    source_tree: sourceTree,
    candidate_base_source_tree: sourceTree,
    base_revision_evidence: null,
    provider_config: providerConfig,
    credential: 'configured-test-credential',
    event_sink: { emit() {} },
  });

  assert.equal(result.status, 'response_ready');
  assert.equal(result.assistant_text, 'I inspected the project without changing files.');
  assert.deepEqual(reconciliationStatuses, []);
  assert.equal(getCancelCount(), 0);
  await runner.dispose();
});

test('projects verified partial edits after a recoverable runtime interruption', async () => {
  const sourceTree = createBuilderProjectSourceTree({ files: [
    { path: 'index.html', content: '<h1>Before</h1>\n' },
  ] });
  const resultingSourceTree = createBuilderProjectSourceTree({ files: [
    { path: 'index.html', content: '<h1>After</h1>\n' },
  ] });
  const { descriptor, runner, getCancelCount } = fixture({
    conversation_events: activeRunEvents(),
    completion: () => ({
      status: 'failed',
      resulting_source_tree: resultingSourceTree,
      runtime_code: 'builder_harness_programming_runtime_idle_timeout',
      runtime_cause_code: 'builder_harness_programming_runtime_idle_timeout',
    }),
  });
  const providerConfig = createBuilderProviderConfig({
    base_url: 'https://api.deepseek.com',
    model: 'deepseek-v4-flash',
    timeout_ms: 30_000,
    temperature: null,
    max_tokens: 4_096,
    secret_ref: {
      ref_version: 'builder-provider-secret-ref.v1',
      provider_id: 'builder-default',
      secret_id: 'builder-provider-secret:default',
    },
  });
  const runContract = createBuilderProgrammingRuntimeRunContract({
    runtime_descriptor: descriptor,
    admission: {
      project_id: `builder-project:${UUID}`,
      conversation_id: `builder-conversation:${UUID}`,
      turn_id: `builder-turn:${UUID}`,
      task_id: `builder-task:${UUID}`,
      run_id: `builder-run:${UUID}`,
      mode: 'build',
      workspace_ref: {
        ref_version: 'builder-programming-workspace-ref.v1',
        workspace_id: `builder-programming-workspace:${'b'.repeat(64)}`,
        source_tree_digest: sourceTree.source_tree_digest,
        writable: true,
      },
      provider_config_digest: providerConfig.config_digest,
      allowed_tools: ['read', 'search', 'edit', 'write'],
      limits: {
        max_steps: 16,
        max_duration_ms: 30_000,
        max_model_tokens: 4_096,
        max_tool_output_bytes: 64 * 1_024,
      },
      admitted_at_ms: 10,
    },
    input: {
      message_id: `builder-message:${UUID}`,
      text: 'Update index.html.',
    },
  });

  const result = await runner.run({
    run_contract: runContract,
    source_tree: sourceTree,
    candidate_base_source_tree: sourceTree,
    base_revision_evidence: null,
    provider_config: providerConfig,
    credential: 'configured-test-credential',
    event_sink: { emit() {} },
  });

  assert.equal(result.status, 'interrupted_candidate_ready');
  assert.equal(result.candidate.resulting_tree_digest, resultingSourceTree.source_tree_digest);
  assert.deepEqual(result.candidate.operations.map(({ operation, path }) => ({ operation, path })), [
    { operation: 'upsert', path: 'index.html' },
  ]);
  assert.equal(
    result.interruption.runtime_code,
    'builder_harness_programming_runtime_idle_timeout',
  );
  assert.match(result.summary, /改动已保留/u);
  assert.match(result.summary, /[㐀-鿿]/u);
  assert.equal(getCancelCount(), 0);
  await runner.dispose();
});
