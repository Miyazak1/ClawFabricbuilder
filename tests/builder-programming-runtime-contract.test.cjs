'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  BuilderProgrammingRuntimeContractError,
  createBuilderProgrammingRuntimeDescriptor,
  createBuilderProgrammingRuntimeRunContract,
  sanitizeBuilderProgrammingRuntimeDescriptor,
  sanitizeBuilderProgrammingRuntimeRunContract,
} = require('../electron/builder-programming-runtime-contract.cjs');

const UUID = '12345678-1234-4234-8234-123456789abc';
const RESUME_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const DIGEST = `sha256:${'a'.repeat(64)}`;

function capabilities(overrides = {}) {
  return {
    streaming_text: true,
    reasoning_status: 'bounded_status',
    native_tool_calls: true,
    steering: 'queued',
    cancellation: 'cooperative',
    session_resume: 'runtime_local',
    context_compaction: true,
    parallel_read_tools: true,
    ...overrides,
  };
}

function descriptor(overrides = {}) {
  return createBuilderProgrammingRuntimeDescriptor({
    runtime_kind: 'fake.multi_step',
    implementation_version: '0.1.0-test.1',
    capabilities: capabilities(),
    ...overrides,
  });
}

function runInput(mode = 'build', overrides = {}) {
  return {
    runtime_descriptor: descriptor(),
    admission: {
      project_id: `builder-project:${UUID}`,
      conversation_id: `builder-conversation:${UUID}`,
      turn_id: `builder-turn:${UUID}`,
      task_id: `builder-task:${UUID}`,
      run_id: `builder-run:${UUID}`,
      mode,
      workspace_ref: {
        ref_version: 'builder-programming-workspace-ref.v1',
        workspace_id: `builder-programming-workspace:${'b'.repeat(64)}`,
        source_tree_digest: DIGEST,
        writable: mode === 'build',
      },
      provider_config_digest: DIGEST,
      allowed_tools: mode === 'build'
        ? ['read', 'search', 'edit', 'write', 'command']
        : ['read', 'search'],
      limits: {
        max_steps: 16,
        max_duration_ms: 300_000,
        max_model_tokens: 32_768,
        max_tool_output_bytes: 256 * 1_024,
      },
      admitted_at_ms: 100,
    },
    input: {
      message_id: `builder-message:${UUID}`,
      text: 'Update the timer and run its checks.',
    },
    ...overrides,
  };
}

test('creates immutable runtime descriptors and run contracts with stable digests', () => {
  const runtimeDescriptor = descriptor();
  assert.equal(runtimeDescriptor.protocol_version, 'builder-programming-runtime.v1');
  assert.match(
    runtimeDescriptor.descriptor_id,
    /^builder-programming-runtime-descriptor:[0-9a-f]{64}$/u,
  );
  assert.deepEqual(
    sanitizeBuilderProgrammingRuntimeDescriptor(structuredClone(runtimeDescriptor)),
    runtimeDescriptor,
  );
  assert.ok(Object.isFrozen(runtimeDescriptor));
  assert.ok(Object.isFrozen(runtimeDescriptor.capabilities));

  const runContract = createBuilderProgrammingRuntimeRunContract(runInput());
  assert.equal(runContract.protocol_version, 'builder-programming-runtime.v1');
  assert.match(
    runContract.run_contract_id,
    /^builder-programming-runtime-run-contract:[0-9a-f]{64}$/u,
  );
  assert.deepEqual(
    sanitizeBuilderProgrammingRuntimeRunContract(structuredClone(runContract)),
    runContract,
  );
  assert.ok(Object.isFrozen(runContract));
  assert.ok(Object.isFrozen(runContract.admission.allowed_tools));
});

test('preserves complete approved plans larger than the user-message limit with bounded input', () => {
  const request = runInput();
  request.input.text = `<approved_plan>\n${'完整的实施计划。'.repeat(12000)}\n</approved_plan>`;
  request.input.completion_requirement = 'source_change_required';
  const contract = createBuilderProgrammingRuntimeRunContract(request);
  assert.equal(contract.input.text, request.input.text);
  assert.equal(contract.input.completion_requirement, 'source_change_required');
  assert.deepEqual(sanitizeBuilderProgrammingRuntimeRunContract(contract), contract);
  request.input.text = 'x'.repeat(144 * 1024 + 1);
  assert.throws(() => createBuilderProgrammingRuntimeRunContract(request), BuilderProgrammingRuntimeContractError);
  request.input.text = 'x\u0000y';
  assert.throws(() => createBuilderProgrammingRuntimeRunContract(request), BuilderProgrammingRuntimeContractError);
});

test('binds source-change completion requirements to writable Build tool authority', () => {
  const ask = runInput('ask');
  ask.input.completion_requirement = 'source_change_required';
  assert.throws(
    () => createBuilderProgrammingRuntimeRunContract(ask),
    BuilderProgrammingRuntimeContractError,
  );

  const buildWithoutMutationTools = runInput('build');
  buildWithoutMutationTools.admission.allowed_tools = ['read', 'search', 'command'];
  buildWithoutMutationTools.input.completion_requirement = 'source_change_required';
  assert.throws(
    () => createBuilderProgrammingRuntimeRunContract(buildWithoutMutationTools),
    BuilderProgrammingRuntimeContractError,
  );
});

test('binds native resume identity to an explicit continuation kind', () => {
  for (const resumeKind of ['task_continuation', 'interrupted_recovery']) {
    const request = runInput();
    request.input.resume_session_run_id = `builder-run:${RESUME_UUID}`;
    request.input.resume_kind = resumeKind;
    const contract = createBuilderProgrammingRuntimeRunContract(request);
    assert.equal(contract.input.resume_session_run_id, request.input.resume_session_run_id);
    assert.equal(contract.input.resume_kind, resumeKind);
  }

  const missingKind = runInput();
  missingKind.input.resume_session_run_id = `builder-run:${RESUME_UUID}`;
  assert.throws(
    () => createBuilderProgrammingRuntimeRunContract(missingKind),
    BuilderProgrammingRuntimeContractError,
  );

  const missingSession = runInput();
  missingSession.input.resume_kind = 'task_continuation';
  assert.throws(
    () => createBuilderProgrammingRuntimeRunContract(missingSession),
    BuilderProgrammingRuntimeContractError,
  );
});

test('admits read-only Ask and Plan runs without writable workspace authority', () => {
  for (const mode of ['ask', 'plan']) {
    const runContract = createBuilderProgrammingRuntimeRunContract(runInput(mode));
    assert.equal(runContract.admission.mode, mode);
    assert.equal(runContract.admission.workspace_ref.writable, false);
    assert.deepEqual(runContract.admission.allowed_tools, ['read', 'search']);
  }
});

test('fails closed when modes claim invalid tools or workspace authority', () => {
  const askWithWrite = runInput('ask');
  askWithWrite.admission.allowed_tools = ['read', 'edit'];
  assert.throws(
    () => createBuilderProgrammingRuntimeRunContract(askWithWrite),
    BuilderProgrammingRuntimeContractError,
  );

  const planWithWritableWorkspace = runInput('plan');
  planWithWritableWorkspace.admission.workspace_ref.writable = true;
  assert.throws(
    () => createBuilderProgrammingRuntimeRunContract(planWithWritableWorkspace),
    BuilderProgrammingRuntimeContractError,
  );

  const unorderedTools = runInput();
  unorderedTools.admission.allowed_tools = ['search', 'read', 'edit'];
  assert.throws(
    () => createBuilderProgrammingRuntimeRunContract(unorderedTools),
    BuilderProgrammingRuntimeContractError,
  );
});

test('fails closed when a runtime overclaims unsupported Build behavior', () => {
  const noTools = descriptor({
    capabilities: capabilities({ native_tool_calls: false }),
  });
  assert.throws(
    () => createBuilderProgrammingRuntimeRunContract(runInput('build', {
      runtime_descriptor: noTools,
    })),
    BuilderProgrammingRuntimeContractError,
  );

  const noCancel = descriptor({
    capabilities: capabilities({ cancellation: 'unsupported' }),
  });
  assert.throws(
    () => createBuilderProgrammingRuntimeRunContract(runInput('build', {
      runtime_descriptor: noCancel,
    })),
    BuilderProgrammingRuntimeContractError,
  );
});

test('admits a structured Build fallback without claiming native tool calls', () => {
  const structuredDescriptor = descriptor({
    runtime_kind: 'structured_operations.v1',
    capabilities: capabilities({ native_tool_calls: false }),
  });
  const input = runInput('build', { runtime_descriptor: structuredDescriptor });
  input.admission.allowed_tools = [];
  const runContract = createBuilderProgrammingRuntimeRunContract(input);

  assert.equal(runContract.admission.mode, 'build');
  assert.equal(runContract.runtime_descriptor.capabilities.native_tool_calls, false);
  assert.deepEqual(runContract.admission.allowed_tools, []);
  assert.equal(runContract.admission.workspace_ref.writable, true);
});

test('fails closed for forged digests, extra authority fields, and renderer paths', () => {
  const forged = structuredClone(createBuilderProgrammingRuntimeRunContract(runInput()));
  forged.admission.limits.max_steps = 17;
  assert.throws(
    () => sanitizeBuilderProgrammingRuntimeRunContract(forged),
    BuilderProgrammingRuntimeContractError,
  );

  const extra = runInput();
  extra.admission.source_tree = { 'index.html': '<h1>unsafe</h1>' };
  assert.throws(
    () => createBuilderProgrammingRuntimeRunContract(extra),
    BuilderProgrammingRuntimeContractError,
  );

  const pathAuthority = runInput();
  pathAuthority.admission.workspace_ref.path = 'C:\\Users\\someone\\project';
  assert.throws(
    () => createBuilderProgrammingRuntimeRunContract(pathAuthority),
    BuilderProgrammingRuntimeContractError,
  );
});

test('contract module remains pure and has no runtime, renderer, storage, or source authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-programming-runtime-contract.cjs'),
    'utf8',
  );

  assert.doesNotMatch(source, /\b(?:fetch|ipcMain|ipcRenderer|contextBridge|BrowserWindow)\b/u);
  assert.doesNotMatch(source, /\b(?:child_process|spawn|execFile|DatabaseSync|node:sqlite)\b/u);
  assert.doesNotMatch(source, /\b(?:readFile|writeFile|source_tree|base_source_tree|absolute_path)\b/u);
  assert.doesNotMatch(source, /api[_-]?key|Bearer|credential_value|secret_store/u);
});
