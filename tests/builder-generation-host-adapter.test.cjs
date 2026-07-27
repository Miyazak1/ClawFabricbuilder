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
    buildExplanationContext: (raw) => explanationContextFor(raw),
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
