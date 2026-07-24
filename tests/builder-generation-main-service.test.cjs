'use strict';

const assert = require('node:assert/strict');
const nodeCrypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  createBuilderGenerationMainService,
} = require('../electron/builder-generation-main-service.cjs');
const {
  createBuilderGitCandidateVerificationReceipt,
} = require('../electron/builder-git-receipt-contract.cjs');
const {
  CONVERSATION_AUTHORITY,
  CONVERSATION_EVENT_KIND,
  CONVERSATION_EVENT_VERSION,
  createBuilderConversationEvent,
} = require('../electron/builder-conversation-records.cjs');
const {
  createBuilderProviderConfig,
} = require('../electron/builder-provider-config.cjs');
const {
  createBuilderProviderConfigRepository,
} = require('../electron/builder-provider-config-repository.cjs');
const {
  createBuilderProviderSecretStore,
} = require('../electron/builder-provider-secret-store.cjs');
const {
  createBuilderProjectSourceTree,
} = require('../electron/builder-project-source-tree.cjs');

const UUIDS = Object.freeze([
  '123e4567-e89b-42d3-a456-426614174000',
  '123e4567-e89b-42d3-a456-426614174001',
  '123e4567-e89b-42d3-a456-426614174002',
  '123e4567-e89b-42d3-a456-426614174003',
  '123e4567-e89b-42d3-a456-426614174004',
  '123e4567-e89b-42d3-a456-426614174005',
  '123e4567-e89b-42d3-a456-426614174006',
  '123e4567-e89b-42d3-a456-426614174007',
  '123e4567-e89b-42d3-a456-426614174008',
  '123e4567-e89b-42d3-a456-426614174009',
]);
const PROJECT_ID = `builder-project:${UUIDS[0]}`;
const PRIVATE_MARKER = 'private-main-service-marker';

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

function createUuidFactory(seed = 0) {
  let index = seed;
  return () => {
    const value = UUIDS[index % UUIDS.length];
    index += 1;
    return value;
  };
}

function config(model = 'builder-model') {
  return createBuilderProviderConfig({
    base_url: 'https://provider.example/v1',
    model,
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

function providerOutput(overrides = {}) {
  return {
    kind: 'builder_code_change_operations',
    title: 'Focus timer',
    summary: 'A quiet timer for focused work.',
    operations: [
      { operation: 'upsert', path: 'index.html', content: '<main><h1>Focus</h1></main>\n' },
      { operation: 'upsert', path: 'src/app.js', content: 'console.log("ready");\n' },
    ],
    ...overrides,
  };
}

function eventHead(record) {
  return {
    sequence: record.sequence,
    event_id: record.event_id,
    event_digest: record.event_digest,
  };
}

function conversationService() {
  let generation = 0;
  const calls = {
    begin: [],
    candidate: [],
    failure: [],
    cancel: [],
    readCandidate: [],
  };
  const service = {
    calls,
    begin_work(input) {
      calls.begin.push(input);
      generation += 1;
      const suffix = UUIDS[(generation + 4) % UUIDS.length];
      const projectUuid = input.project_id.slice('builder-project:'.length);
      const conversationId = `builder-conversation:${projectUuid}`;
      const turnId = `builder-turn:${suffix}`;
      const taskId = `builder-task:${suffix}`;
      const runId = `builder-run:${suffix}`;
      const first = createBuilderConversationEvent({
        record_version: CONVERSATION_EVENT_VERSION,
        record_kind: CONVERSATION_EVENT_KIND,
        project_id: input.project_id,
        conversation_id: conversationId,
        sequence: 1,
        command_id: `builder-command:${UUIDS[(generation + 5) % UUIDS.length]}`,
        event_type: 'turn_submitted',
        previous_event: null,
        payload: {
          message: {
            message_id: `builder-message:${UUIDS[(generation + 6) % UUIDS.length]}`,
            text: input.instruction,
          },
          turn_id: turnId,
          mode: 'work',
          task: {
            task_id: taskId,
            title: input.base_revision === null
              ? 'Create Builder project'
              : 'Update Builder project',
          },
          base_revision: input.base_revision,
        },
        authority: { ...CONVERSATION_AUTHORITY },
      });
      const second = createBuilderConversationEvent({
        record_version: CONVERSATION_EVENT_VERSION,
        record_kind: CONVERSATION_EVENT_KIND,
        project_id: input.project_id,
        conversation_id: conversationId,
        sequence: 2,
        command_id: `builder-command:${UUIDS[(generation + 7) % UUIDS.length]}`,
        event_type: 'run_started',
        previous_event: eventHead(first),
        payload: {
          turn_id: turnId,
          run_id: runId,
          task_id: taskId,
          attempt_number: 1,
          retry_of_run_id: null,
          input_digest: input.request_digest,
        },
        authority: { ...CONVERSATION_AUTHORITY },
      });
      return {
        context_version: 'builder-conversation-run-context.v1',
        project: {
          project_id: input.project_id,
          created_at_ms: 1,
        },
        conversation: {
          project_id: input.project_id,
          conversation_id: conversationId,
          created_at_ms: 1,
        },
        request_digest: input.request_digest,
        start_head: eventHead(second),
        events: [first, second],
        ids: {
          turn_id: turnId,
          task_id: taskId,
          run_id: runId,
        },
      };
    },
    complete_candidate(input) {
      calls.candidate.push(input);
      return {
        head: {
          sequence: input.context.start_head.sequence + 2,
          event_id: `builder-conversation-event:${'a'.repeat(64)}`,
          event_digest: `sha256:${'b'.repeat(64)}`,
        },
      };
    },
    complete_failure(input) {
      calls.failure.push(input);
      return {
        head: {
          sequence: input.context.start_head.sequence + 2,
          event_id: `builder-conversation-event:${'c'.repeat(64)}`,
          event_digest: `sha256:${'d'.repeat(64)}`,
        },
      };
    },
    request_cancel(input) {
      calls.cancel.push(input);
      return {
        ...input.context,
        cancel_requested: true,
      };
    },
    read_candidate_draft(input) {
      calls.readCandidate.push(input);
      const error = new Error('missing private draft');
      error.code = 'builder_product_metadata_not_found';
      throw error;
    },
  };
  return service;
}

function gitAuthority() {
  const receipts = [];
  return {
    receipts,
    async persist_candidate_commit(input) {
      const provisional = {
        receipt_version: 'builder-git-candidate-receipt.v1',
        repository_version: 'builder-git-project-repository.v1',
        project_id: input.candidate.project_id,
        conversation_id: input.candidate.conversation_id,
        turn_id: input.candidate.turn_id,
        task_id: input.candidate.task_id,
        run_id: input.candidate.run_id,
        request_id: input.request_id,
        candidate_id: input.candidate.candidate_id,
        candidate_digest: input.candidate.candidate_digest,
        resulting_tree_digest: input.candidate.resulting_tree_digest,
        semantic_identity_digest: `sha256:${'e'.repeat(64)}`,
        verification_receipt_digest: `sha256:${'0'.repeat(64)}`,
        object_format: 'sha1',
        commit_oid: '1'.repeat(40),
        tree_oid: '2'.repeat(40),
        parent_oid: input.expected_base_oid,
        expected_base_oid: input.expected_base_oid,
        code_authority: 'git_commit_candidate',
        product_revision_admission: 'not_recorded',
        replay: false,
      };
      const verification = createBuilderGitCandidateVerificationReceipt(provisional);
      const receipt = {
        ...provisional,
        verification_receipt_digest: digest(verification),
      };
      receipts.push(receipt);
      return receipt;
    },
    async verify_candidate_receipt(receipt) {
      return createBuilderGitCandidateVerificationReceipt(receipt);
    },
    async read_verified_candidate() {
      throw new Error('unexpected private candidate read');
    },
  };
}

function readResult(sourceTree = createBuilderProjectSourceTree({
  files: [{ path: 'src/app.js', content: 'export const before = true;\n' }],
})) {
  return {
    result_version: 'builder-project-read-result.v1',
    operation: 'current_loaded',
    product_revision_receipt: {
      project_id: PROJECT_ID,
      revision_receipt_digest: `sha256:${'1'.repeat(64)}`,
      commit_oid: '2'.repeat(40),
      resulting_tree_digest: sourceTree.source_tree_digest,
    },
    current: {},
    source_tree: sourceTree,
    git_candidate_receipt: {},
    git_verification_receipt: {},
    authority_evidence: {},
  };
}

function repositories(overrides = {}) {
  let generation = 0;
  const providerConfigRepository = {
    bind_current_authority() {
      generation += 1;
      const boundConfig = config(`builder-model-${generation}`);
      const boundCredential = `credential-${generation}`;
      const state = new WeakMap();
      const authority = {
        readProviderConfig() { return state.get(this).config; },
        resolveSecret(secretRef) {
          return {
            resolution_version: 'builder-provider-secret-resolution.v1',
            secret_ref: secretRef,
            credential: state.get(this).credential,
          };
        },
      };
      state.set(authority, { config: boundConfig, credential: boundCredential });
      return authority;
    },
  };
  const projectReadAuthority = {
    load_current() { throw new Error('new project must not read current source'); },
  };
  return {
    providerConfigRepository,
    projectReadAuthority,
    conversationService: conversationService(),
    gitAuthority: gitAuthority(),
    createUuid: createUuidFactory(),
    ...overrides,
  };
}

test('binds provider snapshot and returns only a redacted unsaved draft packet', async () => {
  const transportInputs = [];
  const lifecycle = conversationService();
  const service = createBuilderGenerationMainService({
    ...repositories({ conversationService: lifecycle }),
    transport: async (input) => {
      transportInputs.push(input);
      return {
        transport_version: 'builder-openai-compatible-transport.v1',
        generated_text: JSON.stringify(providerOutput()),
      };
    },
  });

  assert.equal(service.service_version, 'builder-generation-main-service.v2');
  assert.deepEqual(service.availability(), {
    version: 'builder-generation-availability.v1',
    available: true,
    reason: 'ready',
    supports_cancel: true,
  });
  const result = await service.generate(request());
  assert.equal(result.version, 'builder-generation-result.v2');
  assert.match(result.draft_id, /^builder-generation-draft:[0-9a-f]{64}$/u);
  assert.equal(result.project_id, PROJECT_ID);
  assert.equal(result.existing_project_id, null);
  assert.equal(result.candidate.candidate_version, 'builder-code-change-candidate.v2');
  assert.equal(result.admissions.draft, 'candidate_not_saved');
  assert.equal(result.admissions.save, 'not_performed');
  assert.equal(result.admissions.conversation, 'sqlite_recorded');
  assert.equal(result.restart_restore, 'not_persisted');
  assert.equal(transportInputs.length, 1);
  assert.equal(transportInputs[0].model, 'builder-model-2');
  assert.equal(transportInputs[0].credential, 'credential-2');
  assert.equal(lifecycle.calls.begin.length, 1);
  assert.equal(lifecycle.calls.candidate.length, 1);
  assert.equal(lifecycle.calls.failure.length, 0);
  assert.doesNotMatch(JSON.stringify(result), /credential|provider\.example|builder-model|operations|conversation_events|git_request_id/iu);
  assert.deepEqual(await service.restore_draft({ draft_id: result.draft_id }), result);
  assert.deepEqual(service.authority, {
    provider_config_snapshot_bound: true,
    project_read_authority_verified_source: true,
    pending_draft_restart_restore: 'git_sqlite_verified',
    conversation_event_admission: 'sqlite_recorded',
    credential_exposed_to_renderer: false,
    electron_registration: false,
    preload_exposure: false,
  });
});

test('records a fixed terminal lifecycle outcome when provider generation fails', async () => {
  const lifecycle = conversationService();
  const service = createBuilderGenerationMainService({
    ...repositories({ conversationService: lifecycle }),
    transport: async () => {
      const error = new Error(PRIVATE_MARKER);
      error.code = 'builder_provider_timeout';
      throw error;
    },
  });

  await assert.rejects(
    service.generate(request()),
    (error) => error.code === 'builder_generation_timeout'
      && !`${error.message}:${error.stack}`.includes(PRIVATE_MARKER),
  );
  assert.equal(lifecycle.calls.begin.length, 1);
  assert.equal(lifecycle.calls.candidate.length, 0);
  assert.equal(lifecycle.calls.failure.length, 1);
  assert.equal(lifecycle.calls.failure[0].failure_code, 'builder_generation_timeout');
});

test('records cancellation intent before aborting provider work and fails closed if recording fails', async () => {
  const attemptedRequest = request();
  const failedLifecycle = conversationService();
  let failedSignal;
  let releaseFailedTransport;
  failedLifecycle.request_cancel = () => {
    failedLifecycle.calls.cancel.push('record_attempt');
    throw new Error(PRIVATE_MARKER);
  };
  const failedService = createBuilderGenerationMainService({
    ...repositories({ conversationService: failedLifecycle }),
    transport: async (_input, options) => {
      failedSignal = options.signal;
      return new Promise((resolve) => {
        releaseFailedTransport = () => resolve({
          transport_version: 'builder-openai-compatible-transport.v1',
          generated_text: JSON.stringify(providerOutput()),
        });
      });
    },
  });
  const failedGeneration = failedService.generate(attemptedRequest);
  while (failedSignal === undefined) await new Promise((resolve) => setImmediate(resolve));
  assert.throws(
    () => failedService.cancel({ request_id: attemptedRequest.request_digest }),
    (error) => error.code === 'builder_generation_service_unavailable'
      && !`${error.message}:${error.stack}`.includes(PRIVATE_MARKER),
  );
  assert.equal(failedSignal.aborted, false);
  releaseFailedTransport();
  await failedGeneration;

  const order = [];
  const lifecycle = conversationService();
  const originalRequestCancel = lifecycle.request_cancel;
  lifecycle.request_cancel = (input) => {
    order.push('intent_recorded');
    return originalRequestCancel(input);
  };
  let activeSignal;
  const service = createBuilderGenerationMainService({
    ...repositories({ conversationService: lifecycle }),
    transport: async (_input, options) => {
      activeSignal = options.signal;
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          order.push('provider_aborted');
          const error = new Error(PRIVATE_MARKER);
          error.code = 'builder_provider_cancelled';
          reject(error);
        }, { once: true });
      });
    },
  });
  const generation = service.generate(attemptedRequest);
  while (activeSignal === undefined) await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(service.cancel({ request_id: attemptedRequest.request_digest }), {
    request_id: attemptedRequest.request_digest,
    cancelled: true,
  });
  await assert.rejects(generation, { code: 'builder_generation_cancelled' });
  assert.deepEqual(order, ['intent_recorded', 'provider_aborted']);
  assert.equal(lifecycle.calls.cancel.length, 1);
  assert.equal(lifecycle.calls.failure.length, 1);
  assert.equal(lifecycle.calls.failure[0].context.cancel_requested, true);
});

test('does not abort provider work before a durable conversation context exists', async () => {
  let releaseProjectRead;
  const projectReadStarted = new Promise((resolve) => {
    releaseProjectRead = resolve;
  });
  let loadCurrent;
  const loadBlocked = new Promise((resolve) => {
    loadCurrent = resolve;
  });
  let transportCalled = false;
  const existingRequest = request({ existingProjectId: PROJECT_ID });
  const service = createBuilderGenerationMainService({
    ...repositories({
      projectReadAuthority: {
        async load_current() {
          releaseProjectRead();
          return loadBlocked;
        },
      },
    }),
    transport: async () => {
      transportCalled = true;
      return {
        transport_version: 'builder-openai-compatible-transport.v1',
        generated_text: JSON.stringify(providerOutput()),
      };
    },
  });
  const generation = service.generate(existingRequest);
  await projectReadStarted;
  assert.deepEqual(service.cancel({ request_id: existingRequest.request_digest }), {
    request_id: existingRequest.request_digest,
    cancelled: false,
  });
  assert.equal(transportCalled, false);
  loadCurrent(readResult());
  await generation;
  assert.equal(transportCalled, true);
});

test('uses read authority for existing projects and stores a main-only pending draft', async () => {
  const sourceTree = createBuilderProjectSourceTree({
    files: [{ path: 'src/app.js', content: 'export const before = true;\n' }],
  });
  const reads = [];
  const service = createBuilderGenerationMainService({
    ...repositories({
      createUuid: createUuidFactory(1),
      projectReadAuthority: {
        load_current(query) {
          reads.push(query);
          return readResult(sourceTree);
        },
      },
    }),
    transport: async () => ({
      transport_version: 'builder-openai-compatible-transport.v1',
      generated_text: JSON.stringify(providerOutput({
        operations: [{ operation: 'upsert', path: 'src/app.js', content: 'export const before = false;\n' }],
      })),
    }),
  });

  const result = await service.generate(request({ existingProjectId: PROJECT_ID }));
  assert.deepEqual(reads, [{ project_id: PROJECT_ID }]);
  assert.equal(result.project_id, PROJECT_ID);
  assert.equal(result.base_revision_evidence.revision_receipt_digest, `sha256:${'1'.repeat(64)}`);
  assert.equal(result.source_tree.source_tree_digest, result.candidate.resulting_tree_digest);
  assert.equal(Object.hasOwn(result.candidate, 'operations'), false);

  const pending = await service.read_pending_draft({ draft_id: result.draft_id });
  assert.equal(pending.result_version, 'builder-generation-pending-draft.v2');
  assert.equal(pending.draft_id, result.draft_id);
  assert.match(pending.git_request_id, /^builder-git-request:/u);
  assert.equal(pending.candidate_proof.candidate_digest, result.candidate.candidate_digest);
  assert.equal(pending.candidate_proof.resulting_tree_digest, result.candidate.resulting_tree_digest);
  assert.equal(pending.conversation_head.sequence, 4);
  assert.equal(pending.conversation_event_admission, 'sqlite_recorded');
  assert.equal(pending.restart_restore, 'not_persisted');

  assert.throws(
    () => service.release_pending_draft({
      draft_id: result.draft_id,
      candidate_digest: `sha256:${'f'.repeat(64)}`,
    }),
    (error) => error.code === 'builder_generation_draft_conflict'
      && !`${error.message}:${error.stack}`.includes(result.draft_id),
  );
  assert.equal((await service.read_pending_draft({ draft_id: result.draft_id })).draft_id, result.draft_id);
  assert.deepEqual(service.release_pending_draft({
    draft_id: result.draft_id,
    candidate_digest: result.candidate.candidate_digest,
  }), {
    result_version: 'builder-generation-pending-draft.v2',
    draft_id: result.draft_id,
    released: true,
    pending_draft_restart_restore: 'not_persisted',
    conversation_event_admission: 'sqlite_recorded',
  });
  await assert.rejects(
    service.read_pending_draft({ draft_id: result.draft_id }),
    (error) => error.code === 'builder_generation_service_unavailable',
  );
});

test('restores a pending draft from conversation proof and verified Git source after memory loss', async () => {
  const baseSource = createBuilderProjectSourceTree({
    files: [{ path: 'src/app.js', content: 'export const before = true;\n' }],
  });
  const restoredBaseReads = [];
  const lifecycle = conversationService();
  const git = gitAuthority();
  const service = createBuilderGenerationMainService({
    ...repositories({
      conversationService: lifecycle,
      gitAuthority: git,
      projectReadAuthority: { load_current: () => readResult(baseSource) },
    }),
    transport: async () => ({
      transport_version: 'builder-openai-compatible-transport.v1',
      generated_text: JSON.stringify(providerOutput()),
    }),
  });
  const result = await service.generate(request({ existingProjectId: PROJECT_ID }));
  const recorded = lifecycle.calls.candidate[0].candidate_result;

  const restoredLifecycle = conversationService();
  restoredLifecycle.read_candidate_draft = (input) => {
    restoredLifecycle.calls.readCandidate.push(input);
    return {
      result_version: 'builder-conversation-candidate-draft-read-result.v1',
      draft_id: result.draft_id,
      project_id: recorded.git_candidate_receipt.project_id,
      conversation_id: recorded.git_candidate_receipt.conversation_id,
      turn_id: recorded.git_candidate_receipt.turn_id,
      task_id: recorded.git_candidate_receipt.task_id,
      run_id: recorded.git_candidate_receipt.run_id,
      candidate_digest: recorded.git_candidate_receipt.candidate_digest,
      base_revision: {
        revision_receipt_digest: result.base_revision_evidence.revision_receipt_digest,
        commit_oid: result.base_revision_evidence.commit_oid,
      },
      conversation_head: {
        sequence: 4,
        event_id: `builder-conversation-event:${'a'.repeat(64)}`,
        event_digest: `sha256:${'b'.repeat(64)}`,
      },
      candidate_result: recorded,
      verification_admission: 'sqlite_replay_verified',
    };
  };
  const restoredGit = gitAuthority();
  restoredGit.read_verified_candidate = async (receipt) => ({
    result_version: 'builder-git-verified-candidate-read-result.v1',
    candidate_receipt: receipt,
    verification_receipt: createBuilderGitCandidateVerificationReceipt(receipt),
    source_tree: result.source_tree,
    code_authority: 'git_commit_tree',
    read_admission: 'verified',
  });
  const restoredService = createBuilderGenerationMainService({
    ...repositories({
      conversationService: restoredLifecycle,
      gitAuthority: restoredGit,
      projectReadAuthority: {
        load_current(query) {
          restoredBaseReads.push(query);
          return readResult(baseSource);
        },
      },
    }),
    transport: async () => {
      throw new Error('provider must not be called for pending restore');
    },
  });

  const pending = await restoredService.read_pending_draft({ draft_id: result.draft_id });
  assert.equal(pending.result_version, 'builder-generation-pending-draft.v2');
  assert.equal(pending.restart_restore, 'git_sqlite_verified');
  assert.equal(pending.draft_id, result.draft_id);
  assert.equal(pending.git_request_id, recorded.git_candidate_receipt.request_id);
  assert.equal(pending.candidate_proof.candidate_digest, result.candidate.candidate_digest);
  assert.equal(pending.candidate_proof.request_digest, null);
  assert.deepEqual(restoredLifecycle.calls.readCandidate, [{ draft_id: result.draft_id }]);
  assert.doesNotMatch(JSON.stringify(pending), /source_tree|operations|provider|credential/iu);

  const restored = await restoredService.restore_draft({ draft_id: result.draft_id });
  assert.equal(restored.version, 'builder-generation-result.v2');
  assert.equal(restored.request_id, null);
  assert.equal(restored.draft_id, result.draft_id);
  assert.equal(restored.project_id, PROJECT_ID);
  assert.equal(restored.existing_project_id, PROJECT_ID);
  assert.equal(restored.restart_restore, 'git_sqlite_verified');
  assert.equal(restored.candidate.candidate_digest, result.candidate.candidate_digest);
  assert.equal(restored.source_tree.source_tree_digest, result.source_tree.source_tree_digest);
  assert.equal(
    restored.base_revision_evidence.source_tree_digest,
    baseSource.source_tree_digest,
  );
  assert.deepEqual(restoredBaseReads, [{ project_id: PROJECT_ID }]);
  assert.deepEqual(restoredLifecycle.calls.readCandidate, [{ draft_id: result.draft_id }]);
  assert.doesNotMatch(JSON.stringify(restored), /git_candidate_receipt|verification_receipt|provider|credential|operations/iu);
});

test('generates through persisted provider authority without exposing its credential', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawfabric-builder-main-service-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const safeStorage = {
    isEncryptionAvailable() { return true; },
    encryptString(value) { return Buffer.from(`encrypted:${value}`, 'utf8'); },
    decryptString(value) {
      const text = value.toString('utf8');
      if (!text.startsWith('encrypted:')) throw new Error(PRIVATE_MARKER);
      return text.slice('encrypted:'.length);
    },
  };
  const secretStore = createBuilderProviderSecretStore(root, { safeStorage });
  const providerConfigRepository = createBuilderProviderConfigRepository(root, { secretStore });
  providerConfigRepository.write_current({
    config: {
      base_url: 'https://provider.example/v1',
      model: 'persisted-builder-model',
      timeout_ms: 30000,
      temperature: 0,
      max_tokens: 8192,
      secret_ref: {
        ref_version: 'builder-provider-secret-ref.v1',
        provider_id: 'builder-default',
        secret_id: 'builder-provider-secret:default',
      },
    },
    credential: PRIVATE_MARKER,
  });
  const transportInputs = [];
  const service = createBuilderGenerationMainService({
    ...repositories({ providerConfigRepository }),
    transport: async (input) => {
      transportInputs.push(input);
      return {
        transport_version: 'builder-openai-compatible-transport.v1',
        generated_text: JSON.stringify(providerOutput()),
      };
    },
  });

  const result = await service.generate(request());
  assert.equal(transportInputs.length, 1);
  assert.equal(transportInputs[0].model, 'persisted-builder-model');
  assert.equal(transportInputs[0].credential, PRIVATE_MARKER);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(`${PRIVATE_MARKER}|provider\\.example|persisted-builder-model`, 'iu'));
});

test('fails closed for malformed repositories, read authority, authority pairs, and accessor options', async () => {
  const cases = [
    null,
    {},
    { providerConfigRepository: {}, projectReadAuthority: {} },
    new Proxy({}, { getPrototypeOf() { throw new Error(PRIVATE_MARKER); } }),
  ];
  for (const value of cases) {
    assert.throws(() => createBuilderGenerationMainService(value), (error) => {
      assert.equal(error.code, 'builder_generation_service_unavailable');
      assert.doesNotMatch(`${error.message}:${error.stack}`, new RegExp(PRIVATE_MARKER, 'u'));
      return true;
    });
  }

  const options = repositories();
  Object.defineProperty(options, 'transport', {
    enumerable: true,
    get() { throw new Error(PRIVATE_MARKER); },
  });
  assert.throws(() => createBuilderGenerationMainService(options), {
    code: 'builder_generation_service_unavailable',
  });

  const invalidAuthority = createBuilderGenerationMainService({
    ...repositories({
      providerConfigRepository: { bind_current_authority: () => ({}) },
    }),
    transport: async () => ({ transport_version: 'builder-openai-compatible-transport.v1', generated_text: '{}' }),
  });
  assert.equal(invalidAuthority.availability().available, false);

  const malformedRead = createBuilderGenerationMainService({
    ...repositories({
      projectReadAuthority: {
        load_current() { return {}; },
      },
    }),
    transport: async () => ({ transport_version: 'builder-openai-compatible-transport.v1', generated_text: JSON.stringify(providerOutput()) }),
  });
  await assert.rejects(
    malformedRead.generate(request({ existingProjectId: PROJECT_ID })),
    { code: 'builder_generation_base_unavailable' },
  );
});

test('does not register Electron, save, old revision, or expose provider credential authority', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'electron', 'builder-generation-main-service.cjs'), 'utf8');
  for (const forbidden of [
    /require\(['"]electron['"]\)/u,
    /ipcMain|ipcRenderer|contextBridge|BrowserWindow/u,
    /safeStorage|write_current|publish\(/u,
    /builder-project-revision|projectRevisionRepository|load_revision|revision_digest/u,
    /local-provider-executor|chat_planner|ChatCreatePage|Canvas|JobMeta/u,
  ]) assert.doesNotMatch(source, forbidden);
});
