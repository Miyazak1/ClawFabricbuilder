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
  createBuilderProviderConfig,
} = require('../electron/builder-provider-config.cjs');
const {
  digestBuilderProjectProposalRecord,
  digestBuilderProjectRevisionRecord,
} = require('../electron/builder-project-revision-record.cjs');

const PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174000';
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

function request(targetRevision = 1, parentRevision = null) {
  const unsigned = {
    version: 'builder-generation-request.v1',
    idea: targetRevision === 1 ? 'Make a focus timer.' : 'Add a pause button.',
    project_id: PROJECT_ID,
    target_revision: targetRevision,
    parent_revision: parentRevision,
  };
  return { ...unsigned, request_digest: digest(unsigned) };
}

function proposal(title = 'Focus timer') {
  return {
    kind: 'builder_code_project',
    title,
    summary: 'A quiet timer for focused work.',
    files: {
      'index.html': '<main><h1>Focus</h1><button>Start</button></main>',
      'styles.css': 'main { max-width: 30rem; margin: 2rem auto; }',
      'app.js': 'document.querySelector("button")?.addEventListener("click", () => {});',
    },
  };
}

function revisionRecord() {
  const source = proposal();
  const proposalDigest = digestBuilderProjectProposalRecord(source);
  const unsigned = {
    schema_version: 1,
    record_kind: 'builder_project_revision',
    project_id: PROJECT_ID,
    revision: 1,
    revision_digest: `sha256:${'0'.repeat(64)}`,
    parent_revision: null,
    title: source.title,
    summary: source.summary,
    files: source.files,
    proposal_evidence: {
      authority: 'builder_code_project_generator',
      prompt_version: 'builder-code-project.v1',
      request_version: 'builder-generation-request.v1',
      result_version: 'builder-generation-result.v1',
      request_digest: `sha256:${'1'.repeat(64)}`,
      proposal_digest: proposalDigest,
      project_id: PROJECT_ID,
      target_revision: 1,
      parent_revision: null,
    },
    execution_admission: 'not_evaluated',
    preview_script_admission: 'not_authorized',
  };
  unsigned.revision_digest = digestBuilderProjectRevisionRecord(unsigned);
  return unsigned;
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
    loadParentRevision: async () => {
      throw new Error('not expected');
    },
    transport: async () => ({
      transport_version: 'builder-openai-compatible-transport.v1',
      generated_text: JSON.stringify(proposal()),
    }),
    ...overrides,
  };
}

function revisionLoadedEnvelope(record) {
  return {
    result_version: 'builder-project-repository-result.v1',
    record,
    restart_restore: true,
    persistence_evidence: {
      evidence_version: 'builder-project-repository-result.v1',
      operation: 'revision_loaded',
      authority_scope: 'single_main_process_serialized_expected_head',
      cross_process_cas: 'not_proven',
      sudden_power_loss_durability: 'not_proven',
      revision_file_fsync: 'not_performed',
      immutable_revision_publish: 'not_performed',
      revision_parent_directory_fsync: 'not_performed',
      head_file_fsync: 'not_performed',
      head_publish: 'not_performed',
      head_parent_directory_fsync: 'not_performed',
      reopened_hash_verified: true,
    },
  };
}

test('generates revision one without reading repository parent authority', async () => {
  let parentReads = 0;
  let transportInput;
  const adapter = createBuilderGenerationHostAdapter(dependencies({
    loadParentRevision: async () => { parentReads += 1; },
    transport: async (...args) => {
      transportInput = args;
      return {
        transport_version: 'builder-openai-compatible-transport.v1',
        generated_text: JSON.stringify(proposal()),
      };
    },
  }));
  const rawRequest = request();
  const result = await adapter.generate(rawRequest);
  assert.equal(parentReads, 0);
  assert.equal(result.request_id, rawRequest.request_digest);
  assert.equal(result.proposal.title, 'Focus timer');
  assert.deepEqual(result.admissions, { execution: 'not_evaluated', preview_script: 'not_authorized' });
  assert.equal(transportInput[0].base_url, 'https://provider.example/v1');
  assert.equal(transportInput[0].credential, 'real-key-value');
  assert.equal(transportInput[1].signal instanceof AbortSignal, true);
  assert.doesNotMatch(JSON.stringify(result), /real-key|provider\.example|builder-model/iu);
});

test('loads and binds the exact trusted parent for revision two', async () => {
  const parent = revisionRecord();
  const parentRef = { revision: 1, revision_digest: parent.revision_digest };
  const queries = [];
  let userPrompt = '';
  const adapter = createBuilderGenerationHostAdapter(dependencies({
    loadParentRevision: async (query) => {
      queries.push(query);
      return revisionLoadedEnvelope(parent);
    },
    transport: async (input) => {
      userPrompt = input.messages[1].content;
      return {
        transport_version: 'builder-openai-compatible-transport.v1',
        generated_text: JSON.stringify(proposal('Focus timer with pause')),
      };
    },
  }));
  const result = await adapter.generate(request(2, parentRef));
  assert.deepEqual(queries, [{ project_id: PROJECT_ID, revision: 1, revision_digest: parent.revision_digest }]);
  assert.match(userPrompt, /Add a pause button/u);
  assert.match(userPrompt, /Focus timer/u);
  assert.deepEqual(result.evidence.parent_revision, parentRef);
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
    generated_text: JSON.stringify(proposal()),
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
});

test('cancels a stalled parent lookup without invoking provider authority', async () => {
  const parent = revisionRecord();
  const parentRef = { revision: 1, revision_digest: parent.revision_digest };
  let providerReads = 0;
  const adapter = createBuilderGenerationHostAdapter(dependencies({
    readProviderConfig: () => { providerReads += 1; return providerConfig(); },
    loadParentRevision: async () => new Promise(() => {}),
  }));
  const raw = request(2, parentRef);
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
  for (const credential of ['\ud800', '😀'.repeat(4097)]) {
    const invalid = createBuilderGenerationHostAdapter(dependencies({
      resolveSecret: () => ({
        resolution_version: 'builder-provider-secret-resolution.v1',
        secret_ref: providerConfig().secret_ref,
        credential,
      }),
    }));
    assert.equal(invalid.availability().available, false);
  }
});

test('fails closed on parent, config, secret, transport, and generated response drift', async () => {
  const parent = revisionRecord();
  const parentRef = { revision: 1, revision_digest: parent.revision_digest };
  const cases = [
    [dependencies({ readProviderConfig: () => ({}) }), request(), 'builder_generation_provider_unavailable'],
    [dependencies({ resolveSecret: () => ({ credential: PRIVATE_MARKER }) }), request(), 'builder_generation_provider_unavailable'],
    [dependencies({ loadParentRevision: async () => ({ record: parent }) }), request(2, parentRef), 'builder_generation_parent_unavailable'],
    [dependencies({
      loadParentRevision: async () => ({
        ...revisionLoadedEnvelope(parent),
        persistence_evidence: {
          ...revisionLoadedEnvelope(parent).persistence_evidence,
          operation: 'current_loaded',
        },
      }),
    }), request(2, parentRef), 'builder_generation_parent_unavailable'],
    [dependencies({ transport: async () => ({ generated_text: '{}' }) }), request(), 'builder_generation_response_invalid'],
    [dependencies({ transport: async () => ({ transport_version: 'builder-openai-compatible-transport.v1', generated_text: '{}' }) }), request(), 'builder_generation_response_invalid'],
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
    ['builder_provider_response_too_large', 'builder_generation_response_invalid'],
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
  const accessorError = {};
  Object.defineProperty(accessorError, 'code', {
    get() { throw new Error(PRIVATE_MARKER); },
  });
  const adapter = createBuilderGenerationHostAdapter(dependencies({
    transport: async () => { throw accessorError; },
  }));
  await assert.rejects(adapter.generate(request()), (error) => {
    assert.equal(error.code, 'builder_generation_failed');
    assert.doesNotMatch(`${error.message}:${error.stack}`, /private/iu);
    return true;
  });
});

test('contains no IPC, renderer, legacy dispatcher, generic Chat, save, or execution authority', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'electron', 'builder-generation-host-adapter.cjs'), 'utf8');
  assert.doesNotMatch(
    source,
    /ipcMain|ipcRenderer|contextBridge|BrowserWindow|chat_planner|local-provider-executor|ChatCreatePage|Canvas|JobMeta|repository\.commit|safeStorage|child_process|worker_threads|\beval\s*\(|new Function/iu,
  );
});
