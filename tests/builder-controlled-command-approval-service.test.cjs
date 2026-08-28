'use strict';

const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const test = require('node:test');

const {
  BuilderControlledCommandApprovalServiceError,
  createBuilderControlledCommandApprovalService,
} = require('../electron/builder-controlled-command-approval-service.cjs');
const {
  createBuilderProgrammingRuntimeDescriptor,
  createBuilderProgrammingRuntimeRunContract,
} = require('../electron/builder-programming-runtime-contract.cjs');
const {
  createBuilderProjectSourceTree,
} = require('../electron/builder-project-source-tree.cjs');

function id(prefix) { return `${prefix}:${randomUUID()}`; }

function fixture(mode = 'build', script = 'node check.js') {
  const projectId = id('builder-project');
  const sourceTree = createBuilderProjectSourceTree({ files: [
    { path: 'package.json', content: JSON.stringify({ scripts: { test: script } }) },
    { path: 'check.js', content: 'process.stdout.write("ok\\n");\n' },
  ] });
  const runtimeDescriptor = createBuilderProgrammingRuntimeDescriptor({
    runtime_kind: 'deepseek_harness',
    implementation_version: '1.0.0',
    capabilities: {
      streaming_text: true,
      reasoning_status: 'bounded_status',
      native_tool_calls: true,
      steering: 'queued',
      cancellation: 'cooperative',
      session_resume: 'runtime_local',
      context_compaction: true,
      parallel_read_tools: true,
    },
  });
  const runContract = createBuilderProgrammingRuntimeRunContract({
    runtime_descriptor: runtimeDescriptor,
    admission: {
      project_id: projectId,
      conversation_id: `builder-conversation:${projectId.slice('builder-project:'.length)}:${randomUUID()}`,
      turn_id: id('builder-turn'),
      task_id: id('builder-task'),
      run_id: id('builder-run'),
      mode,
      workspace_ref: {
        ref_version: 'builder-programming-workspace-ref.v1',
        workspace_id: `builder-programming-workspace:${'2'.repeat(64)}`,
        source_tree_digest: sourceTree.source_tree_digest,
        writable: mode === 'build',
      },
      provider_config_digest: `sha256:${'1'.repeat(64)}`,
      allowed_tools: mode === 'build'
        ? ['read', 'search', 'edit', 'write', 'command', 'question']
        : ['read', 'search', 'question'],
      limits: {
        max_steps: 20,
        max_duration_ms: 120_000,
        max_model_tokens: 100_000,
        max_tool_output_bytes: 64 * 1_024,
      },
      admitted_at_ms: 1_000,
    },
    input: { message_id: id('builder-message'), text: 'Run the project check.' },
  });
  return { runContract, sourceTree };
}

function service(clock, requests) {
  return createBuilderControlledCommandApprovalService({
    now_ms: () => clock.value,
    on_approval_requested: (request) => { requests.push(request); },
  });
}

test('requires a structured allow-once decision and lets the executor consume it once', async () => {
  const clock = { value: 2_000 };
  const requests = [];
  const approvalService = service(clock, requests);
  const { runContract, sourceTree } = fixture();
  const pending = approvalService.request_approval({
    run_contract: runContract,
    source_tree: sourceTree,
    command: 'npm test',
    description: '验证当前项目',
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requests.length, 1);
  assert.equal(requests[0].command_display, 'npm test');
  assert.equal(requests[0].risk_notice, 'This project script may modify files or use the network.');
  assert.equal(approvalService.decide({
    run_id: runContract.admission.run_id,
    approval_request_id: requests[0].approval_request_id,
    decision: 'allow_once',
  }), true);
  const approval = await pending;
  assert.throws(() => approvalService.consume({
    execution_approval: approval,
    run_contract: runContract,
    source_tree: sourceTree,
    command_profile_id: `builder-command-profile:${'1'.repeat(32)}`,
  }), (error) => error instanceof BuilderControlledCommandApprovalServiceError
    && error.code === 'builder_controlled_command_approval_expired');
  const profile = approvalService.consume({
    execution_approval: approval,
    run_contract: runContract,
    source_tree: sourceTree,
    command_profile_id: approval.command_profile_id,
  });
  assert.equal(profile.command_display, 'npm test');
  assert.throws(() => approvalService.consume({
    execution_approval: approval,
    run_contract: runContract,
    source_tree: sourceTree,
    command_profile_id: approval.command_profile_id,
  }), (error) => error instanceof BuilderControlledCommandApprovalServiceError
    && error.code === 'builder_controlled_command_approval_consumed');
});

test('rejects Ask mode, unknown commands, renderer forgeries, denial, expiry, and source drift', async () => {
  const clock = { value: 2_000 };
  const requests = [];
  const approvalService = service(clock, requests);
  const ask = fixture('ask');
  await assert.rejects(approvalService.request_approval({
    run_contract: ask.runContract,
    source_tree: ask.sourceTree,
    command: 'npm test',
    description: '验证当前项目',
  }), /not available/u);

  const first = fixture();
  await assert.rejects(approvalService.request_approval({
    run_contract: first.runContract,
    source_tree: first.sourceTree,
    command: 'npm install',
    description: '安装依赖',
  }), /not available/u);
  assert.throws(() => approvalService.consume({
    execution_approval: { approval_version: 'builder-controlled-command-execution-approval.v1' },
    run_contract: first.runContract,
    source_tree: first.sourceTree,
    command_profile_id: `builder-command-profile:${'1'.repeat(32)}`,
  }), /could not be verified/u);

  const deniedPromise = approvalService.request_approval({
    run_contract: first.runContract,
    source_tree: first.sourceTree,
    command: 'npm test',
    description: '验证当前项目',
  });
  await new Promise((resolve) => setImmediate(resolve));
  approvalService.decide({
    run_id: first.runContract.admission.run_id,
    approval_request_id: requests.at(-1).approval_request_id,
    decision: 'deny',
  });
  await assert.rejects(deniedPromise, /denied/u);

  const expiring = fixture();
  const expiredPromise = approvalService.request_approval({
    run_contract: expiring.runContract,
    source_tree: expiring.sourceTree,
    command: 'npm test',
    description: '验证当前项目',
  });
  await new Promise((resolve) => setImmediate(resolve));
  clock.value += 5 * 60 * 1_000;
  approvalService.decide({
    run_id: expiring.runContract.admission.run_id,
    approval_request_id: requests.at(-1).approval_request_id,
    decision: 'allow_once',
  });
  await assert.rejects(expiredPromise, /expired/u);

  clock.value = 3_000;
  const drifting = fixture();
  const driftPromise = approvalService.request_approval({
    run_contract: drifting.runContract,
    source_tree: drifting.sourceTree,
    command: 'npm test',
    description: '验证当前项目',
  });
  await new Promise((resolve) => setImmediate(resolve));
  approvalService.decide({
    run_id: drifting.runContract.admission.run_id,
    approval_request_id: requests.at(-1).approval_request_id,
    decision: 'allow_once',
  });
  const approval = await driftPromise;
  const changedTree = createBuilderProjectSourceTree({ files: [
    { path: 'package.json', content: JSON.stringify({ scripts: { test: 'node changed.js' } }) },
  ] });
  assert.throws(() => approvalService.consume({
    execution_approval: approval,
    run_contract: drifting.runContract,
    source_tree: changedTree,
    command_profile_id: approval.command_profile_id,
  }), /expired/u);
});
