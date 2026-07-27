'use strict';

const assert = require('node:assert/strict');
const nodeCrypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const {
  ANSWER_CHANNEL,
  AVAILABILITY_CHANNEL,
  CANCEL_CHANNEL,
  GENERATE_APPROVED_PLAN_CHANNEL,
  GENERATE_CHANNEL,
  GENERATION_OUTPUT_CHANNEL,
  GENERATION_STARTED_CHANNEL,
  REJECT_DRAFT_CHANNEL,
  RESTORE_DRAFT_CHANNEL,
  RETRY_GENERATE_CHANNEL,
  SUBMIT_CHANNEL,
} = require('../electron/builder-generation-ipc-adapter.cjs');
const {
  OPEN_PROJECT_CHANNEL,
  SAVE_DRAFT_CHANNEL,
  LOAD_CURRENT_CHANNEL,
  LOAD_REVISION_CHANNEL,
  LIST_CURRENT_CHANNEL,
  LIST_HISTORY_CHANNEL,
} = require('../electron/builder-project-workspace-ipc-adapter.cjs');
const {
  READ_TASK_STREAM_CHANNEL,
  TASK_STREAM_CHANGED_CHANNEL,
} = require('../electron/builder-task-stream-ipc-adapter.cjs');
const {
  REVIEW_PLAN_CHANNEL,
} = require('../electron/builder-plan-review-ipc-adapter.cjs');
const {
  BuilderGenerationIpcRuntimeError,
  createBuilderGenerationIpcRuntime,
} = require('../electron/builder-generation-ipc-runtime.cjs');

function temporaryUserData(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawfabric-builder-generation-runtime-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function digest(value) {
  return `sha256:${nodeCrypto.createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')}`;
}

const PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174000';

function hostRequestDigest(instruction = 'Make a timer.', existingProjectId = null) {
  return digest({
    version: 'builder-generation-request.v2',
    instruction,
    existing_project_id: existingProjectId,
  });
}

function activeWindow() {
  const webContents = {
    sent: [],
    isDestroyed: () => false,
    send(channel, payload) {
      webContents.sent.push({ channel, payload });
    },
  };
  return { webContents, isDestroyed: () => false };
}

async function unreachableFetch() {
  throw new Error('unexpected network request');
}

function fakeIpcMain(failOnChannel = null, failRemoveOnChannel = null) {
  const handlers = new Map();
  const removed = [];
  const authority = {
    handlers,
    removed,
    failRemoveOnChannel,
    handle(channel, handler) {
      if (channel === failOnChannel || handlers.has(channel)) throw new Error('private registration failure');
      handlers.set(channel, handler);
    },
    removeHandler(channel) {
      if (channel === authority.failRemoveOnChannel) throw new Error('private removal failure');
      removed.push(channel);
      handlers.delete(channel);
    },
  };
  return authority;
}

async function waitForProbe(predicate) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail('expected runtime probe was not observed');
}

function runtimeWithService(service, probes = {}) {
  const runtimePath = path.join(__dirname, '..', 'electron', 'builder-generation-ipc-runtime.cjs');
  const source = fs.readFileSync(runtimePath, 'utf8');
  const context = vm.createContext({
    __dirname: path.dirname(runtimePath),
    Buffer,
    exports: {},
    module: { exports: {} },
    process,
    require(specifier) {
      if (specifier.startsWith('node:')) return require(specifier);
      if (specifier === './builder-generation-ipc-adapter.cjs') {
        return {
          ANSWER_CHANNEL,
          GENERATE_CHANNEL,
          GENERATE_APPROVED_PLAN_CHANNEL,
          GENERATION_OUTPUT_CHANNEL,
          GENERATION_STARTED_CHANNEL,
          SUBMIT_CHANNEL,
          CANCEL_CHANNEL,
          AVAILABILITY_CHANNEL,
          RESTORE_DRAFT_CHANNEL,
          REJECT_DRAFT_CHANNEL,
          RETRY_GENERATE_CHANNEL,
          createBuilderGenerationIpcAdapter: (options) => ({
            channels: {
              generate: { invoke: (_event, body) => options.generate(body) },
              generateApprovedPlan: { invoke: (_event, body) => options.generateApprovedPlan(body) },
              submit: { invoke: (_event, body) => options.submit(body) },
              retry: { invoke: (_event, body) => options.retry(body) },
              answer: { invoke: (_event, body) => options.answer(body) },
              restoreDraft: { invoke: (_event, body) => options.restoreDraft(body) },
              rejectDraft: { invoke: (_event, body) => options.rejectDraft(body) },
              cancel: { invoke: (_event, body) => options.cancel(body) },
              availability: { invoke: () => options.availability() },
            },
          }),
        };
      }
      if (specifier === './builder-generation-main-service.cjs') {
        return {
          createBuilderGenerationMainService: (options) => {
            probes.serviceOptions = options;
            assert.equal(options.transport, context.__sentinelTransport);
            assert.equal(options.projectReadAuthority, context.__projectMainAuthority.project_read_authority);
            assert.equal(options.conversationService, context.__conversationService);
            assert.equal(options.gitAuthority, context.__projectMainAuthority.git_authority);
            assert.equal(typeof options.onGenerationStarted, 'function');
            assert.equal(typeof options.onProviderOutputDelta, 'function');
            return service;
          },
        };
      }
      if (specifier === './builder-conversation-main-service.cjs') {
        return {
          createBuilderConversationMainService: (options) => {
            probes.conversationOptions = options;
            assert.equal(
              options.metadataAuthority,
              context.__projectMainAuthority.metadata_authority,
            );
            assert.equal(typeof options.onTaskStreamChanged, 'function');
            context.__conversationService = {
              begin_work() {},
              complete_candidate() {},
              complete_failure() {},
              record_retryable_failure() {},
              record_run_progress() {},
              retry_after_failure() {},
              request_cancel() {},
              accept_candidate() {},
              reject_candidate() {},
              read_stream(body) {
                probes.readStreamRequests ??= [];
                probes.readStreamRequests.push({ project_id: body.project_id });
                return {
                  stream_version: 'builder-task-stream-read-result.v1',
                  project_id: body.project_id,
                  conversation: null,
                  authority: {
                    conversation: 'sqlite_canonical_event_replay_or_absent',
                    project_source: 'not_included',
                    candidate_source: 'not_loaded',
                    project_revision: 'not_inferred',
                  },
                };
              },
              review_plan(body) {
                probes.reviewPlanRequests ??= [];
                probes.reviewPlanRequests.push(body);
                return {
                  result_version: 'builder-conversation-plan-review-result.v1',
                  project_id: body.project_id,
                  conversation_id: body.conversation_id,
                  turn_id: body.turn_id,
                  run_id: body.run_id,
                  decision: body.decision,
                  review_admission: 'sqlite_recorded_no_execution',
                };
              },
              verify_candidate() {},
              read_candidate_draft() {},
            };
            return context.__conversationService;
          },
        };
      }
      if (specifier === './builder-project-save-authority.cjs') {
        return {
          createBuilderProjectSaveAuthority: (options) => {
            probes.saveOptions = options;
            assert.equal(options.currentProjection, context.__projectMainAuthority.git_current_projection);
            return {
              save: async (body) => {
                if (typeof probes.saveDraft === 'function') return probes.saveDraft(body);
                return { result_version: 'builder-project-save-result.v1' };
              },
            };
          },
        };
      }
      if (specifier === './builder-project-workspace-ipc-adapter.cjs') {
        return {
          OPEN_PROJECT_CHANNEL,
          SAVE_DRAFT_CHANNEL,
          LOAD_CURRENT_CHANNEL,
          LOAD_REVISION_CHANNEL,
          LIST_CURRENT_CHANNEL,
          LIST_HISTORY_CHANNEL,
          createBuilderProjectWorkspaceIpcAdapter: (options) => ({
            channels: {
              open: { invoke: (_event, body) => options.openProject(body) },
              saveDraft: { invoke: (_event, body) => options.saveDraft(body) },
              loadCurrent: { invoke: (_event, body) => options.loadCurrent(body) },
              loadRevision: { invoke: (_event, body) => options.loadRevision(body) },
              listCurrent: { invoke: () => options.listCurrent() },
              listHistory: { invoke: (_event, body) => options.listHistory(body) },
            },
          }),
        };
      }
      if (specifier === './builder-task-stream-ipc-adapter.cjs') {
        return {
          READ_TASK_STREAM_CHANNEL,
          TASK_STREAM_CHANGED_CHANNEL,
          createBuilderTaskStreamIpcAdapter: (options) => ({
            channels: {
              read: { invoke: (_event, body) => options.readStream(body) },
            },
          }),
        };
      }
      if (specifier === './builder-plan-review-ipc-adapter.cjs') {
        return {
          REVIEW_PLAN_CHANNEL,
          createBuilderPlanReviewIpcAdapter: (options) => ({
            channels: {
              review: { invoke: (_event, body) => options.reviewPlan(body) },
            },
          }),
        };
      }
      if (specifier === './builder-openai-compatible-transport.cjs') {
        return {
          createBuilderOpenAICompatibleTransport: (options) => {
            assert.equal(options.fetchImpl, context.__fetchImpl);
            return context.__sentinelTransport;
          },
        };
      }
      if (specifier === './builder-provider-config-repository.cjs') {
        return { createBuilderProviderConfigRepository: () => ({ bind_current_authority() {} }) };
      }
      if (specifier === './builder-generation-kernel.cjs') {
        const actual = require('../electron/builder-generation-kernel.cjs');
        return {
          ...actual,
          createBuilderGenerationRequest(body) {
            return actual.createBuilderGenerationRequest({
              instruction: body.instruction,
              existing_project_id: body.existing_project_id,
            });
          },
        };
      }
      if (specifier === './builder-project-main-authority.cjs') {
        return {
          PROJECT_REPOSITORY_DIRECTORY: 'builder-projects-v2',
          GIT_RUNTIME_DIRECTORY: 'builder-git-runtime-v2',
          METADATA_DIRECTORY: 'builder-product-metadata-v4',
          METADATA_DATABASE: 'builder.sqlite',
          createBuilderProjectMainAuthority(options) {
            probes.projectMainAuthorityOptions = options;
            context.__projectMainAuthority = {
              closed: false,
              git_authority: {
                persist_candidate_commit() {},
                verify_candidate_receipt() {},
                read_verified_candidate() {},
              },
              git_current_projection: {
                project_current() {},
              },
              metadata_authority: {
                append_conversation_events() {},
                load_conversation() {},
                load_conversation_candidate_by_draft() {},
                load_project_identity() {},
                record_project_revision_receipt() {},
              },
              project_read_authority: {
                load_current(body) {
                  probes.loadCurrentRequests ??= [];
                  probes.loadCurrentRequests.push({ project_id: body.project_id });
                  if (typeof probes.loadCurrent === 'function') return probes.loadCurrent(body);
                  context.__readProjectId = body.project_id;
                  return vm.runInContext(
                    '({ product_revision_receipt: { project_id: __readProjectId } })',
                    context,
                  );
                },
                load_revision(body) {
                  probes.loadRevisionRequests ??= [];
                  probes.loadRevisionRequests.push({
                    project_id: body.project_id,
                    revision_receipt_digest: body.revision_receipt_digest,
                  });
                  if (typeof probes.loadRevision === 'function') return probes.loadRevision(body);
                  context.__readProjectId = body.project_id;
                  context.__readRevisionDigest = body.revision_receipt_digest;
                  return vm.runInContext(
                    `({
                      operation: "revision_loaded",
                      product_revision_receipt: {
                        project_id: __readProjectId,
                        revision_receipt_digest: __readRevisionDigest
                      },
                      current: { project_id: __readProjectId }
                    })`,
                    context,
                  );
                },
                list_current() { return { projects: [] }; },
                list_history(body) {
                  probes.listHistoryRequests ??= [];
                  probes.listHistoryRequests.push({ project_id: body.project_id, limit: body.limit });
                  return {
                    result_version: 'builder-project-read-result.v1',
                    operation: 'history_listed',
                    project_id: body.project_id,
                    revisions: [],
                  };
                },
              },
              project_workspace_authority: {
                admit_project_workspace() {},
              },
              close() { this.closed = true; return true; },
            };
            return context.__projectMainAuthority;
          },
        };
      }
      if (specifier === './builder-project-revision-repository.cjs') {
        throw new Error('old revision repository must not be imported');
      }
      return require(path.join(path.dirname(runtimePath), specifier));
    },
  });
  vm.runInContext(source, context, { filename: runtimePath });
  return {
    context,
    createRuntime(options) {
      context.__ipcMain = options.ipcMain;
      context.__fetchImpl = options.fetchImpl;
      context.__sentinelTransport = async () => {
        throw new Error('unexpected transport request');
      };
      context.__mainWindow = options.mainWindow;
      context.__userDataPath = options.userDataPath;
      return vm.runInContext(`module.exports.createBuilderGenerationIpcRuntime({
        fetchImpl: __fetchImpl,
        ipcMain: __ipcMain,
        mainWindowRef: () => __mainWindow,
        userDataPath: __userDataPath,
      })`, context);
    },
  };
}

test('registers exactly the controlled generation channels and keeps provider storage lazy', async (t) => {
  const userDataPath = temporaryUserData(t);
  const mainWindow = activeWindow();
  const ipcMain = fakeIpcMain();
  const runtime = createBuilderGenerationIpcRuntime({
    fetchImpl: unreachableFetch,
    ipcMain,
    mainWindowRef: () => mainWindow,
    userDataPath,
  });

  assert.equal(runtime.runtime_version, 'builder-generation-ipc-runtime.v2');
  assert.deepEqual(runtime.channels, [
    GENERATE_CHANNEL,
    GENERATE_APPROVED_PLAN_CHANNEL,
    SUBMIT_CHANNEL,
    RETRY_GENERATE_CHANNEL,
    ANSWER_CHANNEL,
    RESTORE_DRAFT_CHANNEL,
    REJECT_DRAFT_CHANNEL,
    CANCEL_CHANNEL,
    AVAILABILITY_CHANNEL,
    OPEN_PROJECT_CHANNEL,
    SAVE_DRAFT_CHANNEL,
    LOAD_CURRENT_CHANNEL,
    LOAD_REVISION_CHANNEL,
    LIST_CURRENT_CHANNEL,
    LIST_HISTORY_CHANNEL,
    READ_TASK_STREAM_CHANNEL,
    REVIEW_PLAN_CHANNEL,
  ]);
  assert.equal(fs.existsSync(path.join(userDataPath, 'builder-project-revisions-v1')), false);
  assert.equal(fs.existsSync(path.join(userDataPath, 'builder-projects-v2')), true);
  assert.equal(fs.existsSync(path.join(userDataPath, 'builder-product-metadata-v4', 'builder.sqlite')), true);
  assert.equal(fs.existsSync(path.join(userDataPath, 'builder-provider-config-v1')), false);
  assert.equal(fs.existsSync(path.join(userDataPath, 'builder-provider-secrets-v1')), false);
  assert.equal(runtime.register(), true);
  assert.equal(runtime.register(), false);
  assert.deepEqual([...ipcMain.handlers.keys()], runtime.channels);

  const availability = await ipcMain.handlers.get(AVAILABILITY_CHANNEL)(
    { sender: mainWindow.webContents },
  );
  assert.deepEqual(availability, {
    version: 'builder-generation-availability.v1',
    available: false,
    reason: 'not_configured',
    supports_cancel: true,
  });
  assert.equal(runtime.dispose(), true);
  assert.equal(runtime.dispose(), false);
  assert.deepEqual([...ipcMain.handlers.keys()], []);
  assert.throws(() => runtime.register(), {
    code: 'builder_generation_ipc_runtime_unavailable',
  });
  runtime.dispose();
});

test('keeps active-renderer and request validation inside the controlled adapter', async (t) => {
  const mainWindow = activeWindow();
  const ipcMain = fakeIpcMain();
  const runtime = createBuilderGenerationIpcRuntime({
    fetchImpl: unreachableFetch,
    ipcMain,
    mainWindowRef: () => mainWindow,
    userDataPath: temporaryUserData(t),
  });
  runtime.register();

  await assert.rejects(
    ipcMain.handlers.get(AVAILABILITY_CHANNEL)({ sender: {} }),
    (error) => error.code === 'builder_generation_forbidden'
      && error.stack === `${error.name}: ${error.message}`,
  );
  await assert.rejects(
    ipcMain.handlers.get(GENERATE_CHANNEL)({ sender: mainWindow.webContents }, { private: 'marker' }),
    (error) => error.code === 'builder_generation_request_invalid'
      && !`${error.message}:${error.stack}`.includes('marker'),
  );
  await assert.rejects(
    ipcMain.handlers.get(SUBMIT_CHANNEL)({ sender: {} }, { instruction: 'Continue.' }),
    (error) => error.code === 'builder_generation_forbidden'
      && error.stack === `${error.name}: ${error.message}`,
  );
  await assert.rejects(
    ipcMain.handlers.get(SUBMIT_CHANNEL)({ sender: mainWindow.webContents }, { private: 'marker' }),
    (error) => error.code === 'builder_generation_request_invalid'
      && !`${error.message}:${error.stack}`.includes('marker'),
  );
  await assert.rejects(
    ipcMain.handlers.get(RETRY_GENERATE_CHANNEL)({ sender: {} }, { instruction: 'Retry.' }),
    (error) => error.code === 'builder_generation_forbidden'
      && error.stack === `${error.name}: ${error.message}`,
  );
  await assert.rejects(
    ipcMain.handlers.get(RETRY_GENERATE_CHANNEL)({ sender: mainWindow.webContents }, { private: 'marker' }),
    (error) => error.code === 'builder_generation_request_invalid'
      && !`${error.message}:${error.stack}`.includes('marker'),
  );
  await assert.rejects(
    ipcMain.handlers.get(ANSWER_CHANNEL)({ sender: {} }, { instruction: 'Explain.' }),
    (error) => error.code === 'builder_generation_forbidden'
      && error.stack === `${error.name}: ${error.message}`,
  );
  await assert.rejects(
    ipcMain.handlers.get(ANSWER_CHANNEL)({ sender: mainWindow.webContents }, { private: 'marker' }),
    (error) => error.code === 'builder_generation_request_invalid'
      && !`${error.message}:${error.stack}`.includes('marker'),
  );
  await assert.rejects(
    ipcMain.handlers.get(RESTORE_DRAFT_CHANNEL)({ sender: mainWindow.webContents }),
    (error) => error.code === 'builder_generation_request_invalid',
  );
  await assert.rejects(
    ipcMain.handlers.get(REJECT_DRAFT_CHANNEL)({ sender: mainWindow.webContents }),
    (error) => error.code === 'builder_generation_request_invalid',
  );
  await assert.rejects(
    ipcMain.handlers.get(CANCEL_CHANNEL)({ sender: mainWindow.webContents }, { request_id: 'bad' }),
    (error) => error.code === 'builder_generation_request_invalid',
  );
  await assert.rejects(
    ipcMain.handlers.get(READ_TASK_STREAM_CHANNEL)({ sender: {} }, { project_id: PROJECT_ID }),
    (error) => error.code === 'builder_task_stream_forbidden'
      && error.stack === `${error.name}: ${error.message}`,
  );
  await assert.rejects(
    ipcMain.handlers.get(READ_TASK_STREAM_CHANNEL)({ sender: mainWindow.webContents }, { project_id: 'bad' }),
    (error) => error.code === 'builder_task_stream_invalid',
  );
  await assert.rejects(
    ipcMain.handlers.get(REVIEW_PLAN_CHANNEL)({ sender: {} }, {
      project_id: PROJECT_ID,
      conversation_id: `builder-conversation:${PROJECT_ID.slice('builder-project:'.length)}`,
      turn_id: 'builder-turn:123e4567-e89b-42d3-a456-426614174001',
      run_id: 'builder-run:123e4567-e89b-42d3-a456-426614174002',
      decision: 'approved',
    }),
    (error) => error.code === 'builder_plan_review_forbidden'
      && error.stack === `${error.name}: ${error.message}`,
  );
  await assert.rejects(
    ipcMain.handlers.get(REVIEW_PLAN_CHANNEL)({ sender: mainWindow.webContents }, {
      project_id: PROJECT_ID,
      conversation_id: `builder-conversation:${PROJECT_ID.slice('builder-project:'.length)}`,
      turn_id: 'builder-turn:123e4567-e89b-42d3-a456-426614174001',
      run_id: 'builder-run:123e4567-e89b-42d3-a456-426614174002',
      decision: 'accepted',
    }),
    (error) => error.code === 'builder_plan_review_invalid',
  );
  await assert.rejects(
    ipcMain.handlers.get(LIST_HISTORY_CHANNEL)({ sender: {} }, { project_id: PROJECT_ID, limit: 32 }),
    (error) => error.code === 'builder_project_workspace_forbidden'
      && error.stack === `${error.name}: ${error.message}`,
  );
  await assert.rejects(
    ipcMain.handlers.get(LIST_HISTORY_CHANNEL)({ sender: mainWindow.webContents }),
    (error) => error.code === 'builder_project_workspace_invalid',
  );
  await assert.rejects(
    ipcMain.handlers.get(LOAD_REVISION_CHANNEL)({ sender: {} }, {
      project_id: PROJECT_ID,
      revision_receipt_digest: `sha256:${'b'.repeat(64)}`,
    }),
    (error) => error.code === 'builder_project_workspace_forbidden'
      && error.stack === `${error.name}: ${error.message}`,
  );
  await assert.rejects(
    ipcMain.handlers.get(LOAD_REVISION_CHANNEL)({ sender: mainWindow.webContents }, {
      project_id: PROJECT_ID,
    }, {
      revision_receipt_digest: `sha256:${'b'.repeat(64)}`,
    }),
    (error) => error.code === 'builder_project_workspace_invalid',
  );
  runtime.dispose();
});

test('publishes project-id-only task stream change events to the active renderer', async (t) => {
  const mainWindow = activeWindow();
  const ipcMain = fakeIpcMain();
  const probes = {};
  const service = {
    generate() { throw new Error('unexpected generate'); },
    async submit() {
      probes.conversationOptions.onTaskStreamChanged(Object.assign(Object.create(null), {
        event_version: 'builder-task-stream-changed.v1',
        project_id: PROJECT_ID,
      }));
      return { ok: true };
    },
    retry_generate() { throw new Error('unexpected retry'); },
    answer() { throw new Error('unexpected answer'); },
    restore_draft() { throw new Error('unexpected restore'); },
    reject_draft() { throw new Error('unexpected reject'); },
    cancel() { return { request_id: hostRequestDigest(), cancelled: true }; },
    availability() {
      return {
        version: 'builder-generation-availability.v1',
        available: false,
        reason: 'not_configured',
        supports_cancel: true,
      };
    },
  };
  const harness = runtimeWithService(service, probes);
  const runtime = harness.createRuntime({
    fetchImpl: unreachableFetch,
    ipcMain,
    mainWindow,
    userDataPath: temporaryUserData(t),
  });
  runtime.register();

  await ipcMain.handlers.get(SUBMIT_CHANNEL)(
    { sender: mainWindow.webContents },
    vm.runInContext('({ instruction: "Make a timer." })', harness.context),
  );

  assert.equal(mainWindow.webContents.sent.length, 1);
  assert.equal(mainWindow.webContents.sent[0].channel, TASK_STREAM_CHANGED_CHANNEL);
  assert.deepEqual(Reflect.ownKeys(mainWindow.webContents.sent[0].payload), [
    'event_version',
    'project_id',
  ]);
  assert.equal(
    mainWindow.webContents.sent[0].payload.event_version,
    'builder-task-stream-changed.v1',
  );
  assert.equal(mainWindow.webContents.sent[0].payload.project_id, PROJECT_ID);
  runtime.dispose();
});

test('publishes generation started hints to bind live reads without exposing source or credentials', async (t) => {
  const mainWindow = activeWindow();
  const ipcMain = fakeIpcMain();
  const probes = {};
  const requestId = hostRequestDigest('Make a timer.', null);
  const service = {
    generate() { throw new Error('unexpected generate'); },
    async submit() {
      probes.serviceOptions.onGenerationStarted(Object.assign(Object.create(null), {
        event_version: 'builder-generation-started.v1',
        request_id: requestId,
        project_id: PROJECT_ID,
      }));
      return { ok: true };
    },
    retry_generate() { throw new Error('unexpected retry'); },
    answer() { throw new Error('unexpected answer'); },
    restore_draft() { throw new Error('unexpected restore'); },
    reject_draft() { throw new Error('unexpected reject'); },
    cancel() { return { request_id: requestId, cancelled: true }; },
    availability() {
      return {
        version: 'builder-generation-availability.v1',
        available: false,
        reason: 'not_configured',
        supports_cancel: true,
      };
    },
  };
  const harness = runtimeWithService(service, probes);
  const runtime = harness.createRuntime({
    fetchImpl: unreachableFetch,
    ipcMain,
    mainWindow,
    userDataPath: temporaryUserData(t),
  });
  runtime.register();

  await ipcMain.handlers.get(SUBMIT_CHANNEL)(
    { sender: mainWindow.webContents },
    vm.runInContext('({ instruction: "Make a timer." })', harness.context),
  );

  assert.equal(mainWindow.webContents.sent.length, 1);
  assert.equal(mainWindow.webContents.sent[0].channel, GENERATION_STARTED_CHANNEL);
  assert.deepEqual(Reflect.ownKeys(mainWindow.webContents.sent[0].payload), [
    'event_version',
    'request_id',
    'project_id',
  ]);
  assert.equal(mainWindow.webContents.sent[0].payload.event_version, 'builder-generation-started.v1');
  assert.equal(mainWindow.webContents.sent[0].payload.request_id, requestId);
  assert.equal(mainWindow.webContents.sent[0].payload.project_id, PROJECT_ID);
  assert.doesNotMatch(
    JSON.stringify(mainWindow.webContents.sent[0].payload),
    /credential|provider|source_tree|commit_oid|tree_oid|receipt/iu,
  );
  runtime.dispose();
});

test('publishes display-safe generation output deltas without exposing provider internals', async (t) => {
  const mainWindow = activeWindow();
  const ipcMain = fakeIpcMain();
  const probes = {};
  const requestId = hostRequestDigest('Make a timer.', null);
  const service = {
    generate() { throw new Error('unexpected generate'); },
    async submit() {
      probes.serviceOptions.onProviderOutputDelta(Object.assign(Object.create(null), {
        event_version: 'builder-generation-output.v1',
        request_id: requestId,
        project_id: PROJECT_ID,
        conversation_id: `builder-conversation:${PROJECT_ID.slice('builder-project:'.length)}`,
        turn_id: 'builder-turn:123e4567-e89b-42d3-a456-426614174001',
        task_id: 'builder-task:123e4567-e89b-42d3-a456-426614174002',
        run_id: 'builder-run:123e4567-e89b-42d3-a456-426614174003',
        display_delta_text: 'A quiet timer',
      }));
      return { ok: true };
    },
    retry_generate() { throw new Error('unexpected retry'); },
    answer() { throw new Error('unexpected answer'); },
    restore_draft() { throw new Error('unexpected restore'); },
    reject_draft() { throw new Error('unexpected reject'); },
    cancel() { return { request_id: requestId, cancelled: true }; },
    availability() {
      return {
        version: 'builder-generation-availability.v1',
        available: false,
        reason: 'not_configured',
        supports_cancel: true,
      };
    },
  };
  const harness = runtimeWithService(service, probes);
  const runtime = harness.createRuntime({
    fetchImpl: unreachableFetch,
    ipcMain,
    mainWindow,
    userDataPath: temporaryUserData(t),
  });
  runtime.register();

  await ipcMain.handlers.get(SUBMIT_CHANNEL)(
    { sender: mainWindow.webContents },
    vm.runInContext('({ instruction: "Make a timer." })', harness.context),
  );

  assert.equal(mainWindow.webContents.sent.length, 1);
  assert.equal(mainWindow.webContents.sent[0].channel, GENERATION_OUTPUT_CHANNEL);
  assert.deepEqual(Reflect.ownKeys(mainWindow.webContents.sent[0].payload), [
    'event_version',
    'request_id',
    'project_id',
    'conversation_id',
    'turn_id',
    'task_id',
    'run_id',
    'display_delta_text',
  ]);
  assert.equal(mainWindow.webContents.sent[0].payload.event_version, 'builder-generation-output.v1');
  assert.equal(mainWindow.webContents.sent[0].payload.display_delta_text, 'A quiet timer');
  assert.doesNotMatch(
    JSON.stringify(mainWindow.webContents.sent[0].payload),
    /credential|provider|source_tree|commit_oid|tree_oid|receipt|operations|index\.html/iu,
  );
  runtime.dispose();
});

test('rolls back partial registration and rejects malformed runtime authority', (t) => {
  const mainWindow = activeWindow();
  const ipcMain = fakeIpcMain(CANCEL_CHANNEL);
  const runtime = createBuilderGenerationIpcRuntime({
    fetchImpl: unreachableFetch,
    ipcMain,
    mainWindowRef: () => mainWindow,
    userDataPath: temporaryUserData(t),
  });
  assert.throws(() => runtime.register(), (error) => (
    error instanceof BuilderGenerationIpcRuntimeError
    && error.code === 'builder_generation_ipc_runtime_unavailable'
    && error.stack === `${error.name}: ${error.message}`
  ));
  assert.deepEqual([...ipcMain.handlers.keys()], []);
  assert.deepEqual(ipcMain.removed, [
    REJECT_DRAFT_CHANNEL,
    RESTORE_DRAFT_CHANNEL,
    ANSWER_CHANNEL,
    RETRY_GENERATE_CHANNEL,
    SUBMIT_CHANNEL,
    GENERATE_APPROVED_PLAN_CHANNEL,
    GENERATE_CHANNEL,
  ]);
  assert.equal(runtime.dispose(), false);

  const removalFailure = fakeIpcMain(CANCEL_CHANNEL, GENERATE_CHANNEL);
  const cleanupRuntime = createBuilderGenerationIpcRuntime({
    fetchImpl: unreachableFetch,
    ipcMain: removalFailure,
    mainWindowRef: () => mainWindow,
    userDataPath: temporaryUserData(t),
  });
  assert.throws(() => cleanupRuntime.register(), {
    code: 'builder_generation_ipc_runtime_unavailable',
  });
  assert.equal(removalFailure.handlers.has(GENERATE_CHANNEL), true);
  assert.equal(removalFailure.handlers.has(GENERATE_APPROVED_PLAN_CHANNEL), false);
  assert.equal(removalFailure.handlers.has(SUBMIT_CHANNEL), false);
  assert.equal(removalFailure.handlers.has(RETRY_GENERATE_CHANNEL), false);
  assert.equal(removalFailure.handlers.has(ANSWER_CHANNEL), false);
  assert.equal(removalFailure.handlers.has(RESTORE_DRAFT_CHANNEL), false);
  assert.equal(removalFailure.handlers.has(REJECT_DRAFT_CHANNEL), false);
  assert.throws(() => cleanupRuntime.dispose(), {
    code: 'builder_generation_ipc_runtime_unavailable',
  });
  removalFailure.failRemoveOnChannel = null;
  assert.equal(cleanupRuntime.dispose(), true);

  for (const invalid of [
    null,
    {},
    {
      fetchImpl: new Proxy(unreachableFetch, { apply() { throw new Error('private fetch trap'); } }),
      ipcMain,
      mainWindowRef: () => mainWindow,
      userDataPath: temporaryUserData(t),
    },
    { fetchImpl: unreachableFetch, ipcMain, mainWindowRef: () => mainWindow, userDataPath: 'relative' },
    {
      fetchImpl: unreachableFetch,
      ipcMain,
      mainWindowRef: () => mainWindow,
      userDataPath: temporaryUserData(t),
      extra: true,
    },
    new Proxy({}, { getPrototypeOf() { throw new Error('private trap'); } }),
  ]) {
    assert.throws(
      () => createBuilderGenerationIpcRuntime(invalid),
      (error) => error instanceof BuilderGenerationIpcRuntimeError
        && !`${error.message}:${error.stack}`.includes('private'),
    );
  }
});

test('closes project main authority when generation channel registration fails', (t) => {
  const harness = runtimeWithService({
    generate: async () => ({ ok: true }),
    cancel: () => ({ cancelled: false }),
    availability: () => ({ available: false }),
  });
  const ipcMain = fakeIpcMain(CANCEL_CHANNEL);
  const runtime = harness.createRuntime({
    fetchImpl: unreachableFetch,
    ipcMain,
    mainWindow: activeWindow(),
    userDataPath: temporaryUserData(t),
  });

  assert.equal(harness.context.__projectMainAuthority.closed, false);
  assert.throws(() => runtime.register(), {
    code: 'builder_generation_ipc_runtime_unavailable',
  });
  assert.deepEqual([...ipcMain.handlers.keys()], []);
  assert.equal(harness.context.__projectMainAuthority.closed, true);
  assert.equal(runtime.dispose(), false);
});

test('composes project main authority and closes it on dispose', (t) => {
  const probes = {};
  const service = {
    generate() { return Promise.reject(new Error('not used')); },
    cancel() { return { cancelled: false }; },
    availability() {
      return { version: 'builder-generation-availability.v1', available: true, reason: 'ready', supports_cancel: true };
    },
  };
  const runtimeModule = runtimeWithService(service, probes);
  const mainWindow = activeWindow();
  const ipcMain = fakeIpcMain();
  const userDataPath = temporaryUserData(t);
  const runtime = runtimeModule.createRuntime({
    fetchImpl: unreachableFetch,
    ipcMain,
    mainWindow,
    userDataPath,
  });

  assert.equal(probes.projectMainAuthorityOptions.userDataPath, userDataPath);
  assert.deepEqual(Object.keys(probes.projectMainAuthorityOptions), ['userDataPath']);
  assert.equal(probes.serviceOptions.projectReadAuthority,
    runtimeModule.context.__projectMainAuthority.project_read_authority);
  assert.equal(probes.serviceOptions.conversationService,
    runtimeModule.context.__conversationService);
  assert.equal(probes.serviceOptions.gitAuthority,
    runtimeModule.context.__projectMainAuthority.git_authority);
  assert.equal(probes.saveOptions.generationDrafts, service);
  assert.equal(probes.saveOptions.gitAuthority,
    runtimeModule.context.__projectMainAuthority.git_authority);
  assert.equal(probes.saveOptions.currentProjection,
    runtimeModule.context.__projectMainAuthority.git_current_projection);
  assert.equal(probes.saveOptions.metadataAuthority,
    runtimeModule.context.__projectMainAuthority.metadata_authority);
  assert.equal(probes.saveOptions.projectReadAuthority,
    runtimeModule.context.__projectMainAuthority.project_read_authority);
  assert.equal(probes.saveOptions.conversationService,
    runtimeModule.context.__conversationService);
  assert.equal(typeof runtimeModule.context.__conversationService.read_stream, 'function');
  assert.equal(runtime.dispose(), false);
  assert.equal(runtimeModule.context.__projectMainAuthority.closed, true);
});

test('registers a read-only task stream channel backed by the conversation service', async (t) => {
  const probes = {};
  const runtimeModule = runtimeWithService({
    generate() { return Promise.reject(new Error('not used')); },
    cancel() { return { cancelled: false }; },
    availability() {
      return { version: 'builder-generation-availability.v1', available: true, reason: 'ready', supports_cancel: true };
    },
  }, probes);
  const mainWindow = activeWindow();
  const ipcMain = fakeIpcMain();
  const runtime = runtimeModule.createRuntime({
    fetchImpl: unreachableFetch,
    ipcMain,
    mainWindow,
    userDataPath: temporaryUserData(t),
  });
  runtime.register();

  const stream = await ipcMain.handlers.get(READ_TASK_STREAM_CHANNEL)(
    { sender: mainWindow.webContents },
    vm.runInContext(`({ project_id: ${JSON.stringify(PROJECT_ID)} })`, runtimeModule.context),
  );
  assert.deepEqual(stream, {
    stream_version: 'builder-task-stream-read-result.v1',
    project_id: PROJECT_ID,
    conversation: null,
    authority: {
      conversation: 'sqlite_canonical_event_replay_or_absent',
      project_source: 'not_included',
      candidate_source: 'not_loaded',
      project_revision: 'not_inferred',
    },
  });
  assert.deepEqual(probes.readStreamRequests, [{ project_id: PROJECT_ID }]);
  runtime.dispose();
});

test('registers a plan review channel backed only by the conversation service', async (t) => {
  const probes = {};
  const runtimeModule = runtimeWithService({
    generate() { return Promise.reject(new Error('not used')); },
    cancel() { return { cancelled: false }; },
    availability() {
      return { version: 'builder-generation-availability.v1', available: true, reason: 'ready', supports_cancel: true };
    },
  }, probes);
  const mainWindow = activeWindow();
  const ipcMain = fakeIpcMain();
  const runtime = runtimeModule.createRuntime({
    fetchImpl: unreachableFetch,
    ipcMain,
    mainWindow,
    userDataPath: temporaryUserData(t),
  });
  runtime.register();

  const body = vm.runInContext(`({
    project_id: ${JSON.stringify(PROJECT_ID)},
    conversation_id: "builder-conversation:123e4567-e89b-42d3-a456-426614174000",
    turn_id: "builder-turn:123e4567-e89b-42d3-a456-426614174001",
    run_id: "builder-run:123e4567-e89b-42d3-a456-426614174002",
    decision: "approved"
  })`, runtimeModule.context);
  const reviewed = await ipcMain.handlers.get(REVIEW_PLAN_CHANNEL)(
    { sender: mainWindow.webContents },
    body,
  );
  assert.deepEqual(reviewed, {
    result_version: 'builder-conversation-plan-review-result.v1',
    project_id: PROJECT_ID,
    conversation_id: 'builder-conversation:123e4567-e89b-42d3-a456-426614174000',
    turn_id: 'builder-turn:123e4567-e89b-42d3-a456-426614174001',
    run_id: 'builder-run:123e4567-e89b-42d3-a456-426614174002',
    decision: 'approved',
    review_admission: 'sqlite_recorded_no_execution',
  });
  assert.deepEqual(probes.reviewPlanRequests, [body]);
  runtime.dispose();
});

test('registers a read-only project history channel backed by project read authority', async (t) => {
  const probes = {};
  const runtimeModule = runtimeWithService({
    generate() { return Promise.reject(new Error('not used')); },
    cancel() { return { cancelled: false }; },
    availability() {
      return { version: 'builder-generation-availability.v1', available: true, reason: 'ready', supports_cancel: true };
    },
  }, probes);
  const mainWindow = activeWindow();
  const ipcMain = fakeIpcMain();
  const runtime = runtimeModule.createRuntime({
    fetchImpl: unreachableFetch,
    ipcMain,
    mainWindow,
    userDataPath: temporaryUserData(t),
  });
  runtime.register();

  const history = await ipcMain.handlers.get(LIST_HISTORY_CHANNEL)(
    { sender: mainWindow.webContents },
    vm.runInContext(`({ project_id: ${JSON.stringify(PROJECT_ID)}, limit: 32 })`, runtimeModule.context),
  );
  assert.deepEqual(history, {
    result_version: 'builder-project-read-result.v1',
    operation: 'history_listed',
    project_id: PROJECT_ID,
    revisions: [],
  });
  assert.deepEqual(probes.listHistoryRequests, [{ project_id: PROJECT_ID, limit: 32 }]);
  runtime.dispose();
});

test('registers a read-only historical revision channel without changing selection', async (t) => {
  const projectB = 'builder-project:223e4567-e89b-42d3-a456-426614174000';
  const generated = [];
  const probes = {};
  const runtimeModule = runtimeWithService({
    generate(body) {
      generated.push(body);
      return Promise.resolve({ request_id: body.request_digest });
    },
    cancel() { return { cancelled: false }; },
    availability() {
      return { version: 'builder-generation-availability.v1', available: true, reason: 'ready', supports_cancel: true };
    },
  }, probes);
  const mainWindow = activeWindow();
  const ipcMain = fakeIpcMain();
  const runtime = runtimeModule.createRuntime({
    fetchImpl: unreachableFetch,
    ipcMain,
    mainWindow,
    userDataPath: temporaryUserData(t),
  });
  runtime.register();
  const invoke = (channel, body) => ipcMain.handlers.get(channel)({ sender: mainWindow.webContents }, body);
  const body = (source) => vm.runInContext(source, runtimeModule.context);

  await invoke(OPEN_PROJECT_CHANNEL, body(`({ project_id: ${JSON.stringify(projectB)} })`));
  const revisionDigest = `sha256:${'c'.repeat(64)}`;
  const revision = await invoke(
    LOAD_REVISION_CHANNEL,
    body(`({
      project_id: ${JSON.stringify(PROJECT_ID)},
      revision_receipt_digest: ${JSON.stringify(revisionDigest)}
    })`),
  );
  assert.equal(revision.operation, 'revision_loaded');
  assert.deepEqual(probes.loadRevisionRequests, [{
    project_id: PROJECT_ID,
    revision_receipt_digest: revisionDigest,
  }]);

  await invoke(GENERATE_CHANNEL, body('({ instruction: "Continue selected project." })'));
  assert.equal(generated.at(-1).existing_project_id, projectB);
  runtime.dispose();
});

test('registers a read-only draft restore channel backed by generation service', async (t) => {
  const restoreRequests = [];
  const runtimeModule = runtimeWithService({
    generate() { return Promise.reject(new Error('not used')); },
    restore_draft(body) {
      restoreRequests.push({ draft_id: body.draft_id });
      return {
        version: 'builder-generation-result.v2',
        draft_id: body.draft_id,
        restart_restore: 'git_sqlite_verified',
      };
    },
    cancel() { return { cancelled: false }; },
    availability() {
      return { version: 'builder-generation-availability.v1', available: true, reason: 'ready', supports_cancel: true };
    },
  });
  const mainWindow = activeWindow();
  const ipcMain = fakeIpcMain();
  const runtime = runtimeModule.createRuntime({
    fetchImpl: unreachableFetch,
    ipcMain,
    mainWindow,
    userDataPath: temporaryUserData(t),
  });
  runtime.register();

  const draftId = `builder-generation-draft:${'c'.repeat(64)}`;
  const restored = await ipcMain.handlers.get(RESTORE_DRAFT_CHANNEL)(
    { sender: mainWindow.webContents },
    vm.runInContext(`({ draft_id: ${JSON.stringify(draftId)} })`, runtimeModule.context),
  );
  assert.deepEqual(restored, {
    version: 'builder-generation-result.v2',
    draft_id: draftId,
    restart_restore: 'git_sqlite_verified',
  });
  assert.deepEqual(restoreRequests, [{ draft_id: draftId }]);
  runtime.dispose();
});

test('registers a draft rejection channel backed by generation service', async (t) => {
  const rejectRequests = [];
  const runtimeModule = runtimeWithService({
    generate() { return Promise.reject(new Error('not used')); },
    reject_draft(body) {
      rejectRequests.push({ ...body });
      return {
        result_version: 'builder-generation-draft-rejection-result.v1',
        draft_id: body.draft_id,
        project_id: PROJECT_ID,
        rejected: true,
      };
    },
    cancel() { return { cancelled: false }; },
    availability() {
      return { version: 'builder-generation-availability.v1', available: true, reason: 'ready', supports_cancel: true };
    },
  });
  const mainWindow = activeWindow();
  const ipcMain = fakeIpcMain();
  const runtime = runtimeModule.createRuntime({
    fetchImpl: unreachableFetch,
    ipcMain,
    mainWindow,
    userDataPath: temporaryUserData(t),
  });
  runtime.register();

  const draftId = `builder-generation-draft:${'d'.repeat(64)}`;
  const rejected = await ipcMain.handlers.get(REJECT_DRAFT_CHANNEL)(
    { sender: mainWindow.webContents },
    vm.runInContext(`({ draft_id: ${JSON.stringify(draftId)} })`, runtimeModule.context),
  );
  assert.deepEqual(rejected, {
    result_version: 'builder-generation-draft-rejection-result.v1',
    draft_id: draftId,
    project_id: PROJECT_ID,
    rejected: true,
  });
  assert.deepEqual(rejectRequests, [{ draft_id: draftId }]);
  assert.equal(Object.hasOwn(rejectRequests[0], 'instruction'), false);
  assert.equal(Object.hasOwn(rejectRequests[0], 'source_tree'), false);
  runtime.dispose();
});

test('keeps selected project identity in main and accepts only instruction over generation IPC', async (t) => {
  const generated = [];
  const approvedPlanGenerated = [];
  const submitted = [];
  const retried = [];
  const answered = [];
  const probes = {};
  const service = {
    generate(body) {
      generated.push(body);
      return Promise.resolve({ request_id: body.request_digest });
    },
    generate_approved_plan(body) {
      approvedPlanGenerated.push(body);
      return Promise.resolve({ request_id: `sha256:${'d'.repeat(64)}` });
    },
    submit(body) {
      submitted.push(body);
      return Promise.resolve({ request_id: body.request_digest });
    },
    retry_generate(body) {
      retried.push(body);
      return Promise.resolve({
        version: 'builder-generation-result.v2',
        request_id: body.request_digest,
      });
    },
    answer(body) {
      answered.push(body);
      return Promise.resolve({
        version: 'builder-generation-result.v2',
        result_kind: 'explanation',
        request_id: body.request_digest,
      });
    },
    cancel() { return { cancelled: false }; },
    availability() {
      return { version: 'builder-generation-availability.v1', available: true, reason: 'ready', supports_cancel: true };
    },
  };
  const runtimeModule = runtimeWithService(service, probes);
  const mainWindow = activeWindow();
  const ipcMain = fakeIpcMain();
  const runtime = runtimeModule.createRuntime({
    fetchImpl: unreachableFetch,
    ipcMain,
    mainWindow,
    userDataPath: temporaryUserData(t),
  });
  runtime.register();

  const selected = vm.runInContext(
    `({ project_id: ${JSON.stringify(PROJECT_ID)} })`,
    runtimeModule.context,
  );
  await ipcMain.handlers.get(OPEN_PROJECT_CHANNEL)({ sender: mainWindow.webContents }, selected);
  await ipcMain.handlers.get(GENERATE_CHANNEL)(
    { sender: mainWindow.webContents },
    vm.runInContext('({ instruction: "Revise the timer." })', runtimeModule.context),
  );
  assert.equal(generated[0].existing_project_id, PROJECT_ID);
  assert.equal(generated[0].instruction, 'Revise the timer.');
  assert.equal(generated[0].request_digest, hostRequestDigest('Revise the timer.', PROJECT_ID));
  assert.deepEqual(probes.loadCurrentRequests, [{ project_id: PROJECT_ID }]);
  await ipcMain.handlers.get(SUBMIT_CHANNEL)(
    { sender: mainWindow.webContents },
    vm.runInContext('({ instruction: "Continue selected project." })', runtimeModule.context),
  );
  assert.equal(submitted[0].existing_project_id, PROJECT_ID);
  assert.equal(submitted[0].instruction, 'Continue selected project.');
  assert.equal(submitted[0].request_digest, hostRequestDigest('Continue selected project.', PROJECT_ID));
  await ipcMain.handlers.get(RETRY_GENERATE_CHANNEL)(
    { sender: mainWindow.webContents },
    vm.runInContext('({ instruction: "Revise the timer." })', runtimeModule.context),
  );
  assert.equal(retried[0].existing_project_id, PROJECT_ID);
  assert.equal(retried[0].instruction, 'Revise the timer.');
  assert.equal(retried[0].request_digest, hostRequestDigest('Revise the timer.', PROJECT_ID));
  await ipcMain.handlers.get(ANSWER_CHANNEL)(
    { sender: mainWindow.webContents },
    vm.runInContext('({ instruction: "What does this project do?" })', runtimeModule.context),
  );
  assert.equal(answered[0].existing_project_id, PROJECT_ID);
  assert.equal(answered[0].instruction, 'What does this project do?');
  assert.equal(answered[0].request_digest, hostRequestDigest('What does this project do?', PROJECT_ID));
  await ipcMain.handlers.get(GENERATE_APPROVED_PLAN_CHANNEL)(
    { sender: mainWindow.webContents },
    vm.runInContext(`({
      project_id: ${JSON.stringify(PROJECT_ID)},
      conversation_id: "builder-conversation:123e4567-e89b-42d3-a456-426614174000",
      turn_id: "builder-turn:123e4567-e89b-42d3-a456-426614174001",
      run_id: "builder-run:123e4567-e89b-42d3-a456-426614174002"
    })`, runtimeModule.context),
  );
  assert.equal(approvedPlanGenerated.length, 1);
  assert.equal(approvedPlanGenerated[0].project_id, PROJECT_ID);
  assert.equal(
    approvedPlanGenerated[0].conversation_id,
    'builder-conversation:123e4567-e89b-42d3-a456-426614174000',
  );
  assert.equal(
    approvedPlanGenerated[0].turn_id,
    'builder-turn:123e4567-e89b-42d3-a456-426614174001',
  );
  assert.equal(
    approvedPlanGenerated[0].run_id,
    'builder-run:123e4567-e89b-42d3-a456-426614174002',
  );
  assert.equal(Object.hasOwn(approvedPlanGenerated[0], 'instruction'), false);
  assert.equal(Object.hasOwn(approvedPlanGenerated[0], 'request_digest'), false);
  assert.equal(Object.hasOwn(approvedPlanGenerated[0], 'source_tree'), false);
  await ipcMain.handlers.get(OPEN_PROJECT_CHANNEL)(
    { sender: mainWindow.webContents },
    vm.runInContext('({ project_id: null })', runtimeModule.context),
  );
  await ipcMain.handlers.get(GENERATE_CHANNEL)(
    { sender: mainWindow.webContents },
    vm.runInContext('({ instruction: "Make a fresh timer." })', runtimeModule.context),
  );
  assert.equal(generated[1].existing_project_id, null);
  assert.equal(generated[1].request_digest, hostRequestDigest('Make a fresh timer.', null));
  await ipcMain.handlers.get(ANSWER_CHANNEL)(
    { sender: mainWindow.webContents },
    vm.runInContext('({ instruction: "Explain the fresh project." })', runtimeModule.context),
  );
  assert.equal(answered[1].existing_project_id, null);
  assert.equal(answered[1].request_digest, hostRequestDigest('Explain the fresh project.', null));
  await assert.rejects(
    async () => ipcMain.handlers.get(GENERATE_APPROVED_PLAN_CHANNEL)(
      { sender: mainWindow.webContents },
      vm.runInContext(`({
        project_id: ${JSON.stringify(PROJECT_ID)},
        conversation_id: "builder-conversation:123e4567-e89b-42d3-a456-426614174000",
        turn_id: "builder-turn:123e4567-e89b-42d3-a456-426614174001",
        run_id: "builder-run:123e4567-e89b-42d3-a456-426614174002"
      })`, runtimeModule.context),
    ),
    { code: 'builder_generation_ipc_runtime_unavailable' },
  );

  await assert.rejects(
    async () => ipcMain.handlers.get(GENERATE_CHANNEL)(
      { sender: mainWindow.webContents },
      vm.runInContext(`({
        instruction: "forged",
        existing_project_id: ${JSON.stringify(PROJECT_ID)}
      })`, runtimeModule.context),
    ),
    { code: 'builder_generation_request_invalid' },
  );
  await assert.rejects(
    async () => ipcMain.handlers.get(SUBMIT_CHANNEL)(
      { sender: mainWindow.webContents },
      vm.runInContext(`({
        instruction: "forged submit",
        existing_project_id: ${JSON.stringify(PROJECT_ID)}
      })`, runtimeModule.context),
    ),
    { code: 'builder_generation_request_invalid' },
  );
  await assert.rejects(
    async () => ipcMain.handlers.get(RETRY_GENERATE_CHANNEL)(
      { sender: mainWindow.webContents },
      vm.runInContext(`({
        instruction: "forged retry",
        existing_project_id: ${JSON.stringify(PROJECT_ID)}
      })`, runtimeModule.context),
    ),
    { code: 'builder_generation_request_invalid' },
  );
  await assert.rejects(
    async () => ipcMain.handlers.get(ANSWER_CHANNEL)(
      { sender: mainWindow.webContents },
      vm.runInContext(`({
        instruction: "forged answer",
        existing_project_id: ${JSON.stringify(PROJECT_ID)}
      })`, runtimeModule.context),
    ),
    { code: 'builder_generation_request_invalid' },
  );
  runtime.dispose();
});

test('ignores stale Open and Save completions when a newer project selection wins', async (t) => {
  const projectB = 'builder-project:223e4567-e89b-42d3-a456-426614174000';
  const generated = [];
  const reads = new Map();
  let resolveSave;
  const probes = {
    loadCurrent(body) {
      return new Promise((resolve) => {
        reads.set(body.project_id, resolve);
      });
    },
    saveDraft() {
      return new Promise((resolve) => {
        resolveSave = resolve;
      });
    },
  };
  const runtimeModule = runtimeWithService({
    generate(body) {
      generated.push(body);
      return Promise.resolve({ request_id: body.request_digest });
    },
    cancel() { return { cancelled: false }; },
    availability() {
      return { version: 'builder-generation-availability.v1', available: true, reason: 'ready', supports_cancel: true };
    },
  }, probes);
  const mainWindow = activeWindow();
  const ipcMain = fakeIpcMain();
  const runtime = runtimeModule.createRuntime({
    fetchImpl: unreachableFetch,
    ipcMain,
    mainWindow,
    userDataPath: temporaryUserData(t),
  });
  runtime.register();
  const invoke = (channel, body) => ipcMain.handlers.get(channel)({ sender: mainWindow.webContents }, body);
  const body = (source) => vm.runInContext(source, runtimeModule.context);

  const openA = invoke(OPEN_PROJECT_CHANNEL, body(`({ project_id: ${JSON.stringify(PROJECT_ID)} })`))
    .then((value) => ({ value }), (error) => ({ error }));
  const openB = invoke(OPEN_PROJECT_CHANNEL, body(`({ project_id: ${JSON.stringify(projectB)} })`))
    .then((value) => ({ value }), (error) => ({ error }));
  await waitForProbe(() => reads.has(PROJECT_ID) && reads.has(projectB));
  await assert.rejects(
    async () => invoke(
      GENERATE_CHANNEL,
      body('({ instruction: "Must not use the previous selection." })'),
    ),
    { code: 'builder_generation_ipc_runtime_unavailable' },
  );
  await assert.rejects(
    async () => invoke(
      SUBMIT_CHANNEL,
      body('({ instruction: "Must not submit with the previous selection." })'),
    ),
    { code: 'builder_generation_ipc_runtime_unavailable' },
  );
  await assert.rejects(
    async () => invoke(
      RETRY_GENERATE_CHANNEL,
      body('({ instruction: "Must not retry with the previous selection." })'),
    ),
    { code: 'builder_generation_ipc_runtime_unavailable' },
  );
  await assert.rejects(
    async () => invoke(
      SAVE_DRAFT_CHANNEL,
      body(`({ draft_id: "builder-generation-draft:${'f'.repeat(64)}" })`),
    ),
    { code: 'builder_generation_ipc_runtime_unavailable' },
  );
  assert.deepEqual(generated, []);
  assert.equal(resolveSave, undefined);
  runtimeModule.context.__projectB = projectB;
  reads.get(projectB)(vm.runInContext(
    '({ product_revision_receipt: { project_id: __projectB } })',
    runtimeModule.context,
  ));
  assert.equal((await openB).error, undefined);
  runtimeModule.context.__projectA = PROJECT_ID;
  reads.get(PROJECT_ID)(vm.runInContext(
    '({ product_revision_receipt: { project_id: __projectA } })',
    runtimeModule.context,
  ));
  assert.equal((await openA).error, undefined);
  await invoke(GENERATE_CHANNEL, body('({ instruction: "Continue B." })'));
  assert.equal(generated.at(-1).existing_project_id, projectB);

  const save = invoke(
    SAVE_DRAFT_CHANNEL,
    body(`({ draft_id: "builder-generation-draft:${'a'.repeat(64)}" })`),
  )
    .then((value) => ({ value }), (error) => ({ error }));
  await waitForProbe(() => typeof resolveSave === 'function');
  await invoke(OPEN_PROJECT_CHANNEL, body('({ project_id: null })'));
  resolveSave(vm.runInContext(`({
    result_version: "builder-project-save-result.v1",
    project_id: __projectB
  })`, runtimeModule.context));
  assert.equal((await save).error, undefined);
  await invoke(GENERATE_CHANNEL, body('({ instruction: "Make a fresh project." })'));
  assert.equal(generated.at(-1).existing_project_id, null);
  runtime.dispose();
});

test('cancels every accepted generation, submit, retry, or answer before removing its cancel channel', async (t) => {
  let rejectGeneration;
  let rejectSubmit;
  let rejectRetry;
  let rejectAnswer;
  const cancelRequests = [];
  const service = {
    generate() {
      return new Promise((_resolve, reject) => { rejectGeneration = reject; });
    },
    submit() {
      return new Promise((_resolve, reject) => { rejectSubmit = reject; });
    },
    retry_generate() {
      return new Promise((_resolve, reject) => { rejectRetry = reject; });
    },
    answer() {
      return new Promise((_resolve, reject) => { rejectAnswer = reject; });
    },
    cancel(body) {
      cancelRequests.push(body);
      const error = new Error('private provider request');
      error.code = 'builder_generation_cancelled';
      if (body.request_id === hostRequestDigest('Make a timer.')) rejectGeneration(error);
      if (body.request_id === hostRequestDigest('Continue the timer.')) rejectSubmit(error);
      if (body.request_id === hostRequestDigest('Retry the timer.')) rejectRetry(error);
      if (body.request_id === hostRequestDigest('Explain the timer.')) rejectAnswer(error);
      return { request_id: body.request_id, cancelled: true };
    },
    availability() {
      return { version: 'builder-generation-availability.v1', available: true, reason: 'ready', supports_cancel: true };
    },
  };
  const runtimeModule = runtimeWithService(service);
  const mainWindow = activeWindow();
  const ipcMain = fakeIpcMain();
  const runtime = runtimeModule.createRuntime({
    fetchImpl: unreachableFetch,
    ipcMain,
    mainWindow,
    userDataPath: temporaryUserData(t),
  });
  runtime.register();
  const generateBody = vm.runInContext('({ instruction: "Make a timer." })', runtimeModule.context);
  const submitBody = vm.runInContext('({ instruction: "Continue the timer." })', runtimeModule.context);
  const retryBody = vm.runInContext('({ instruction: "Retry the timer." })', runtimeModule.context);
  const answerBody = vm.runInContext('({ instruction: "Explain the timer." })', runtimeModule.context);
  const generation = ipcMain.handlers.get(GENERATE_CHANNEL)({ sender: mainWindow.webContents }, generateBody);
  const submission = ipcMain.handlers.get(SUBMIT_CHANNEL)({ sender: mainWindow.webContents }, submitBody);
  const retry = ipcMain.handlers.get(RETRY_GENERATE_CHANNEL)({ sender: mainWindow.webContents }, retryBody);
  const answer = ipcMain.handlers.get(ANSWER_CHANNEL)({ sender: mainWindow.webContents }, answerBody);
  const cancelledGeneration = assert.rejects(generation, { code: 'builder_generation_cancelled' });
  const cancelledSubmission = assert.rejects(submission, { code: 'builder_generation_cancelled' });
  const cancelledRetry = assert.rejects(retry, { code: 'builder_generation_cancelled' });
  const cancelledAnswer = assert.rejects(answer, { code: 'builder_generation_cancelled' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runtime.dispose(), true);
  assert.deepEqual(cancelRequests.map((request) => request.request_id), [
    hostRequestDigest('Make a timer.'),
    hostRequestDigest('Continue the timer.'),
    hostRequestDigest('Retry the timer.'),
    hostRequestDigest('Explain the timer.'),
  ]);
  await cancelledGeneration;
  await cancelledSubmission;
  await cancelledRetry;
  await cancelledAnswer;
  assert.deepEqual([...ipcMain.handlers.keys()], []);
});

test('does not close project authority when an active generation lacks durable cancellation', async (t) => {
  let resolveGeneration;
  const service = {
    generate() {
      return new Promise((resolve) => { resolveGeneration = resolve; });
    },
    cancel(body) {
      return { request_id: body.request_id, cancelled: false };
    },
    availability() {
      return { version: 'builder-generation-availability.v1', available: true, reason: 'ready', supports_cancel: true };
    },
  };
  const runtimeModule = runtimeWithService(service);
  const mainWindow = activeWindow();
  const ipcMain = fakeIpcMain();
  const runtime = runtimeModule.createRuntime({
    fetchImpl: unreachableFetch,
    ipcMain,
    mainWindow,
    userDataPath: temporaryUserData(t),
  });
  runtime.register();
  const body = vm.runInContext('({ instruction: "Make a timer." })', runtimeModule.context);
  const operation = ipcMain.handlers.get(GENERATE_CHANNEL)({ sender: mainWindow.webContents }, body);
  await new Promise((resolve) => setImmediate(resolve));

  assert.throws(() => runtime.dispose(), {
    code: 'builder_generation_ipc_runtime_unavailable',
  });
  assert.deepEqual([...ipcMain.handlers.keys()], []);
  resolveGeneration(vm.runInContext(`({
    version: "builder-generation-result.v2",
    request_id: "${hostRequestDigest()}"
  })`, runtimeModule.context));
  await operation;
  assert.equal(runtime.dispose(), true);
});

test('contains no preload, renderer, settings write, generic provider, or legacy revision authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-generation-ipc-runtime.cjs'),
    'utf8',
  );
  for (const forbidden of [
    /ipcRenderer|contextBridge|BrowserWindow|require\(['"]electron['"]\)|\bnet\b/u,
    /write_current|credential|safeStorage|providerSettings/u,
    /builder-project-revision-repository|builder-project-revisions-v1|projectRevisionRepository/u,
    /local-provider-executor|chat_planner|ChatCreatePage|Canvas|JobMeta/u,
  ]) assert.doesNotMatch(source, forbidden);
  assert.match(source, /createBuilderProjectMainAuthority/u);
  assert.doesNotMatch(source, /createDefaultBuilderGitProjectRepository/u);
  assert.doesNotMatch(source, /createBuilderProductMetadataDatabase/u);
  assert.doesNotMatch(source, /createBuilderProjectReadAuthority/u);
  assert.match(source, /createBuilderGenerationMainService/u);
  assert.match(source, /createBuilderTaskStreamIpcAdapter/u);
  assert.match(source, /createBuilderPlanReviewIpcAdapter/u);
  assert.match(source, /channel:\s*READ_TASK_STREAM_CHANNEL/u);
  assert.match(source, /channel:\s*REVIEW_PLAN_CHANNEL/u);
  assert.match(source, /channel:\s*LOAD_REVISION_CHANNEL/u);
  assert.match(source, /createBuilderOpenAICompatibleTransport\(\{ fetchImpl: options\.fetchImpl \}\)/u);
  assert.doesNotMatch(source, /globalThis\.fetch/u);
});
