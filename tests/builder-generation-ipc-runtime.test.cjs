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
  ANSWER_PLAN_CHANNEL,
  ANSWER_DRAFT_CHANNEL,
  AVAILABILITY_CHANNEL,
  APPROVE_CURRENT_PROJECT_WRITE_CHANNEL,
  APPROVE_PLAN_SOURCE_READ_CHANNEL,
  CANCEL_CHANNEL,
  CLASSIFY_INTENT_CHANNEL,
  CONTINUE_DRAFT_CHANNEL,
  DECIDE_COMMAND_APPROVAL_CHANNEL,
  GENERATE_APPROVED_PLAN_CHANNEL,
  GENERATE_CHANNEL,
  GENERATE_RESULT_VERSION,
  GENERATION_OUTPUT_CHANNEL,
  GENERATION_STARTED_CHANNEL,
  PREPARE_CURRENT_PROJECT_WRITE_APPROVAL_CHANNEL,
  PREPARE_PLAN_SOURCE_READ_APPROVAL_CHANNEL,
  PROPOSE_PLAN_CHANNEL,
  QUEUE_FOLLOWUP_CHANNEL,
  REJECT_DRAFT_CHANNEL,
  RESTORE_DRAFT_CHANNEL,
  RESTORE_PREVIOUS_CHECKPOINT_AS_DRAFT_CHANNEL,
  RESTORE_REVISION_AS_DRAFT_CHANNEL,
  RETRY_GENERATE_CHANNEL,
  STEER_CHANNEL,
  SUBMIT_CHANNEL,
} = require('../electron/builder-generation-ipc-adapter.cjs');
const {
  CREATE_LOCAL_PROJECT_CHANNEL,
  OPEN_PROJECT_CHANNEL,
  OPEN_PROJECT_LOCATION_CHANNEL,
  SAVE_DRAFT_CHANNEL,
  LOAD_CURRENT_CHANNEL,
  LOAD_REVISION_CHANNEL,
  LIST_CURRENT_CHANNEL,
  LIST_WORKSPACES_CHANNEL,
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
  ARCHIVE_AGENT_PROJECT_CHANNEL,
  ARCHIVE_AGENT_TASK_CHANNEL,
  READ_AGENT_PROJECT_TREE_CHANNEL,
  RENAME_AGENT_PROJECT_CHANNEL,
  RENAME_AGENT_TASK_CHANNEL,
} = require('../electron/builder-agent-project-tree-ipc-adapter.cjs');
const {
  READ_AGENT_WORKBENCH_CHANNEL,
  UPDATE_WORKBENCH_MESSAGE_STATE_CHANNEL,
  CREATE_WORKBENCH_TASK_PROPOSAL_CHANNEL,
  DECIDE_WORKBENCH_TASK_PROPOSAL_CHANNEL,
  CONTROL_WORKBENCH_TASK_CHANNEL,
  WORKBENCH_CHANGED_CHANNEL,
} = require('../electron/builder-workbench-ipc-adapter.cjs');
const {
  BuilderGenerationIpcRuntimeError,
  bundledHarnessRuntimeRoot,
  createBuilderGenerationIpcRuntime,
  mainOwnedProgrammingRuntimeFeatureFlag,
  packagedCheckWorkerPath,
} = require('../electron/builder-generation-ipc-runtime.cjs');
const {
  BUILDER_PERMISSION_POLICY_VERSION,
} = require('../electron/builder-permission-authority-contract.cjs');
const {
  createBuilderProductMetadataDatabase,
} = require('../electron/builder-product-metadata-database.cjs');
const {
  DEFAULT_BUILDER_AGENT_ID,
} = require('../electron/builder-default-agent-bootstrap.cjs');

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
const TASK_ADDRESS_ID = 'builder-task-address:123e4567-e89b-42d3-a456-426614174001';
const SECOND_TASK_ADDRESS_ID = 'builder-task-address:223e4567-e89b-42d3-a456-426614174001';
const CONVERSATION_ID = 'builder-conversation:123e4567-e89b-42d3-a456-426614174000:123e4567-e89b-42d3-a456-426614174002';
const CANDIDATE_ID = `builder-code-change-candidate:${'a'.repeat(64)}`;

test('enables the bundled programming runtime by default with an explicit safe override', () => {
  assert.equal(mainOwnedProgrammingRuntimeFeatureFlag(undefined), 'enabled');
  assert.equal(mainOwnedProgrammingRuntimeFeatureFlag('enabled'), 'enabled');
  assert.equal(mainOwnedProgrammingRuntimeFeatureFlag('shadow'), 'shadow');
  assert.equal(mainOwnedProgrammingRuntimeFeatureFlag('disabled'), 'disabled');
  assert.equal(mainOwnedProgrammingRuntimeFeatureFlag('unexpected'), 'disabled');
  assert.equal(mainOwnedProgrammingRuntimeFeatureFlag(''), 'disabled');
});

test('resolves the packaged check worker from the physical ASAR unpack directory', () => {
  const resources = path.resolve('release', 'win-unpacked', 'resources');
  assert.equal(
    packagedCheckWorkerPath(path.join(resources, 'app.asar', 'electron')),
    path.join(
      resources,
      'app.asar.unpacked',
      'electron',
      'builder-packaged-check-script-worker.cjs',
    ),
  );
  assert.equal(
    packagedCheckWorkerPath(path.resolve('electron')),
    path.resolve('electron', 'builder-packaged-check-script-worker.cjs'),
  );
});

test('discovers only the packaged Harness ASAR in the supplied resources directory', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'builder-packaged-harness-root-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.equal(bundledHarnessRuntimeRoot(root), null);
  const archive = path.join(root, 'harness-runtime.asar');
  fs.writeFileSync(archive, 'fixture');
  assert.equal(bundledHarnessRuntimeRoot(root), archive);
  fs.rmSync(archive);
  fs.mkdirSync(archive);
  assert.equal(bundledHarnessRuntimeRoot(root), archive);
  assert.equal(bundledHarnessRuntimeRoot('relative'), null);
});

function hostRequestDigest(instruction = 'Make a timer.', existingProjectId = null) {
  return digest({
    version: 'builder-generation-request.v3',
    instruction,
    existing_project_id: existingProjectId,
    task_address_id: null,
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

async function grantPermissionForExplicitApproval(request) {
  return {
    result_version: 'builder-permission-grant-result.v1',
    project_id: request.project_id,
    action: request.action,
    resource: {
      resource_kind: request.resource_kind,
      project_id: request.project_id,
      resource_id: request.resource_id,
    },
    operation: 'grant_recorded',
    ui_selection_authority: 'main_owned_explicit_user_approval_required',
  };
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
          ANSWER_DRAFT_CHANNEL,
          CONTINUE_DRAFT_CHANNEL,
          DECIDE_COMMAND_APPROVAL_CHANNEL,
          CLASSIFY_INTENT_CHANNEL,
          GENERATE_CHANNEL,
          GENERATE_APPROVED_PLAN_CHANNEL,
          PROPOSE_PLAN_CHANNEL,
          PREPARE_PLAN_SOURCE_READ_APPROVAL_CHANNEL,
          APPROVE_PLAN_SOURCE_READ_CHANNEL,
          PREPARE_CURRENT_PROJECT_WRITE_APPROVAL_CHANNEL,
          APPROVE_CURRENT_PROJECT_WRITE_CHANNEL,
          GENERATION_OUTPUT_CHANNEL,
          GENERATION_STARTED_CHANNEL,
          SUBMIT_CHANNEL,
          CANCEL_CHANNEL,
          STEER_CHANNEL,
          QUEUE_FOLLOWUP_CHANNEL,
          AVAILABILITY_CHANNEL,
          RESTORE_DRAFT_CHANNEL,
          RESTORE_PREVIOUS_CHECKPOINT_AS_DRAFT_CHANNEL,
          RESTORE_REVISION_AS_DRAFT_CHANNEL,
          REJECT_DRAFT_CHANNEL,
          RETRY_GENERATE_CHANNEL,
          createBuilderGenerationIpcAdapter: (options) => ({
            channels: {
              generate: { invoke: (_event, body) => options.generate(body) },
              continueDraft: { invoke: (_event, body) => options.continueDraft(body) },
              generateApprovedPlan: { invoke: (_event, body) => options.generateApprovedPlan(body) },
              proposePlan: { invoke: (_event, body) => options.proposePlan(body) },
              preparePlanSourceReadApproval: {
                invoke: (_event, body) => options.preparePlanSourceReadApproval(body),
              },
              approvePlanSourceRead: { invoke: (_event, body) => options.approvePlanSourceRead(body) },
              prepareCurrentProjectWriteApproval: {
                invoke: (_event, body) => options.prepareCurrentProjectWriteApproval(body),
              },
              approveCurrentProjectWrite: {
                invoke: (_event, body) => options.approveCurrentProjectWrite(body),
              },
              submit: { invoke: (_event, body) => options.submit(body) },
              classifyIntent: { invoke: (_event, body) => options.classifyIntent(body) },
              retry: { invoke: (_event, body) => options.retry(body) },
              answer: { invoke: (_event, body) => options.answer(body) },
              answerDraft: { invoke: (_event, body) => options.answerDraft(body) },
              restoreDraft: { invoke: (_event, body) => options.restoreDraft(body) },
              restoreRevisionAsDraft: { invoke: (_event, body) => options.restoreRevisionAsDraft(body) },
              restorePreviousCheckpointAsDraft: {
                invoke: (_event, body) => options.restorePreviousCheckpointAsDraft(body),
              },
              rejectDraft: { invoke: (_event, body) => options.rejectDraft(body) },
              cancel: { invoke: (_event, body) => options.cancel(body) },
              steer: { invoke: (_event, body) => options.steer(body) },
              queueFollowup: { invoke: (_event, body) => options.queueFollowup(body) },
              availability: { invoke: () => options.availability() },
              decideCommandApproval: {
                invoke: (_event, body) => options.decideCommandApproval(body),
              },
            },
          }),
        };
      }
      if (specifier === './builder-workbench-message-store.cjs') {
        return {
          createBuilderWorkbenchMessageStore: (databasePath) => {
            probes.workbenchMessageDatabasePath = databasePath;
            context.__workbenchMessageStore = {
              closed: false,
              update_message_state(request) {
                probes.workbenchMessageStateRequests ??= [];
                probes.workbenchMessageStateRequests.push(request);
                return { operation: 'message_state_updated' };
              },
              close() {
                this.closed = true;
                return true;
              },
            };
            return context.__workbenchMessageStore;
          },
        };
      }
      if (specifier === './builder-agent-conversation-workbench-recording-service.cjs') {
        return {
          createBuilderAgentConversationWorkbenchRecordingService: (options) => {
            probes.workbenchRecordingOptions = options;
            context.__workbenchRecordingService = {
              sync_agent_conversation_stream(stream) {
                probes.workbenchSynchronizedStreams ??= [];
                probes.workbenchSynchronizedStreams.push(stream);
                return { operation: 'conversation_synchronized', recorded_count: 0 };
              },
            };
            return context.__workbenchRecordingService;
          },
        };
      }
      if (specifier === './builder-workbench-task-monitor-projection.cjs') {
        return {
          createBuilderWorkbenchTaskMonitorProjection: (options) => {
            probes.workbenchTaskMonitorOptions = options;
            context.__workbenchTaskMonitorProjection = {
              invalidate_monitor(request) {
                probes.workbenchTaskMonitorInvalidations ??= [];
                probes.workbenchTaskMonitorInvalidations.push(request);
                return { operation: 'task_monitor_invalidated' };
              },
              read_monitor(request) {
                probes.workbenchTaskMonitorRequests ??= [];
                probes.workbenchTaskMonitorRequests.push(request);
                return {
                  projection_version: 'builder-workbench-task-monitor.v2',
                  agent_id: request.agent_id,
                  tasks: [],
                  counts: { active: 0, attention: 0, recent: 0 },
                  authority: {},
                };
              },
            };
            return context.__workbenchTaskMonitorProjection;
          },
        };
      }
      if (specifier === './builder-task-workbench-result-recording-service.cjs') {
        return {
          createBuilderTaskWorkbenchResultRecordingService: (options) => {
            probes.workbenchTaskResultRecordingOptions = options;
            context.__workbenchTaskResultRecordingService = {
              sync_task_monitor(monitor) {
                probes.workbenchSynchronizedTaskMonitors ??= [];
                probes.workbenchSynchronizedTaskMonitors.push(monitor);
                return { operation: 'task_results_synchronized', recorded_count: 0 };
              },
            };
            return context.__workbenchTaskResultRecordingService;
          },
        };
      }
      if (specifier === './builder-workbench-task-proposal-store.cjs') {
        return {
          createBuilderWorkbenchTaskProposalStore: (databasePath) => {
            probes.workbenchTaskProposalDatabasePath = databasePath;
            context.__workbenchTaskProposalStore = {
              close() { return true; },
            };
            return context.__workbenchTaskProposalStore;
          },
        };
      }
      if (specifier === './builder-task-attention-store.cjs') {
        return {
          createBuilderTaskAttentionStore: (databasePath) => {
            probes.taskAttentionDatabasePath = databasePath;
            const latest = new Map();
            context.__taskAttentionStore = {
              closed: false,
              records: [],
              record_task_attention(request) {
                probes.onRecordTaskAttention?.(request.attention);
                this.records.push(request.attention);
                latest.set(request.attention.task_address_id, request.attention);
                return { status: 'recorded', attention: request.attention };
              },
              read_task_attention(request) {
                const attention = latest.get(request.task_address_id) ?? null;
                return { status: attention === null ? 'absent' : 'ready', attention };
              },
              close() { this.closed = true; return true; },
            };
            return context.__taskAttentionStore;
          },
        };
      }
      if (specifier === './builder-project-task-lease-coordinator.cjs') {
        return {
          createBuilderProjectTaskLeaseCoordinator: () => {
            const leases = new Map();
            let leaseIndex = 0;
            return {
              acquire(request) {
                const current = leases.get(request.project_id) ?? null;
                if (current !== null) {
                  return {
                    status: 'busy',
                    project_id: request.project_id,
                    owner_task_address_id: current.task_address_id,
                    lease: null,
                  };
                }
                leaseIndex += 1;
                const lease = {
                  lease_id: `builder-project-task-lease:${String(leaseIndex).padStart(8, '0')}-0000-4000-8000-000000000001`,
                  project_id: request.project_id,
                  task_address_id: request.task_address_id,
                  request_id: request.request_id,
                };
                leases.set(request.project_id, lease);
                return { status: 'acquired', project_id: request.project_id, lease };
              },
              release(request) {
                const current = leases.get(request.project_id);
                assert.equal(current?.lease_id, request.lease_id);
                assert.equal(current?.request_id, request.request_id);
                leases.delete(request.project_id);
                return { status: 'released', project_id: request.project_id };
              },
            };
          },
        };
      }
      if (specifier === './builder-workbench-task-incubation-service.cjs') {
        return {
          createBuilderWorkbenchTaskIncubationService: (options) => {
            probes.workbenchTaskIncubationOptions = options;
            return {
              create_proposal(request) { return { operation: 'proposal_created', request }; },
              async decide_proposal(request) {
                return { operation: 'proposal_rejected', request, materialization: null };
              },
            };
          },
        };
      }
      if (specifier === './builder-workbench-timeline-projection.cjs') {
        return {
          createBuilderWorkbenchTimelineProjection: (options) => {
            probes.workbenchProjectionOptions = options;
            return {
              read_workbench(request) {
                probes.workbenchReadRequests ??= [];
                probes.workbenchReadRequests.push(request);
                return {
                  projection_version: 'builder-agent-workbench-projection.v2',
                  agent_id: request.agent_id,
                  stream: {
                    items: [],
                    after_cursor: request.after_cursor,
                    next_cursor: null,
                    has_more: false,
                  },
                  task_monitor: options.task_monitor_projection.read_monitor({
                    agent_id: request.agent_id,
                  }),
                  inbox: {
                    unread_count: 0,
                    action_required_count: 0,
                    mention_count: 0,
                    active_task_count: 0,
                  },
                  authority: {},
                };
              },
            };
          },
        };
      }
      if (specifier === './builder-workbench-ipc-adapter.cjs') {
        return {
          READ_AGENT_WORKBENCH_CHANNEL,
          UPDATE_WORKBENCH_MESSAGE_STATE_CHANNEL,
          CREATE_WORKBENCH_TASK_PROPOSAL_CHANNEL,
          DECIDE_WORKBENCH_TASK_PROPOSAL_CHANNEL,
          CONTROL_WORKBENCH_TASK_CHANNEL,
          WORKBENCH_CHANGED_CHANNEL,
          createBuilderWorkbenchIpcAdapter: (options) => ({
            channels: {
              read: { invoke: (_event, body) => options.readWorkbench(body) },
              updateMessageState: {
                invoke: (_event, body) => options.updateMessageState(body),
              },
              createTaskProposal: {
                invoke: (_event, body) => options.createTaskProposal(body),
              },
              decideTaskProposal: {
                invoke: (_event, body) => options.decideTaskProposal(body),
              },
              controlTask: {
                invoke: (_event, body) => options.controlTask(body),
              },
            },
          }),
        };
      }
      if (specifier === './builder-runtime-workspace-snapshot-store.cjs') {
        return {
          createBuilderRuntimeWorkspaceSnapshotStore: (options) => {
            probes.runtimeWorkspaceSnapshotOptions = options;
            context.__runtimeWorkspaceSnapshotStore = {
              record_source_tree(request) { probes.runtimeSourceTreeRecords ??= []; probes.runtimeSourceTreeRecords.push(request); },
              bind_tool_file(request) { probes.runtimeFileBindings ??= []; probes.runtimeFileBindings.push(request); },
              read_tool_file(request) {
                probes.runtimeToolReadRequests ??= [];
                probes.runtimeToolReadRequests.push(request);
                if (probes.runtimeToolRecord === undefined) throw new Error('runtime tool file absent');
                return probes.runtimeToolRecord;
              },
              read_source_tree(request) {
                probes.runtimeSourceReadRequests ??= [];
                probes.runtimeSourceReadRequests.push(request);
                if (probes.runtimeSourceRecord === undefined) throw new Error('runtime source tree absent');
                return probes.runtimeSourceRecord;
              },
            };
            return context.__runtimeWorkspaceSnapshotStore;
          },
        };
      }
      if (specifier === './builder-generation-main-service.cjs') {
        return {
          createBuilderGenerationMainService: (options) => {
            probes.serviceOptions = options;
            assert.equal(options.transport, context.__sentinelTransport);
            assert.notEqual(options.projectReadAuthority, context.__projectMainAuthority.project_read_authority);
            assert.equal(typeof options.projectReadAuthority.load_current, 'function');
            assert.equal(options.projectReadAuthority.load_revision, context.__projectMainAuthority.project_read_authority.load_revision);
            assert.equal(options.conversationService, context.__conversationService);
            assert.equal(options.gitAuthority, context.__projectMainAuthority.git_authority);
            assert.equal(
              options.currentProjection,
              context.__projectMainAuthority.git_current_projection,
            );
            assert.equal(options.sourceContextCollector.collector_version, 'builder-tool-source-context-collector.v1');
            assert.equal(options.taskCapsuleStore, context.__taskCapsuleStore);
            assert.equal(options.taskCapsuleRecordingService, context.__taskCapsuleRecordingService);
            assert.equal(options.projectUnderstandingService, context.__projectUnderstandingService);
            assert.equal(options.sessionTaskAddressRecordingService, context.__sessionTaskAddressRecordingService);
            assert.equal(options.automaticDraftCheckpointService, context.__automaticDraftCheckpointService);
            assert.equal(options.workingContextStateService, context.__workingContextStateService);
            assert.equal(
              options.providerContextDisclosureDecisionService,
              context.__providerContextDisclosureDecisionService,
            );
            assert.equal(
              options.providerContextDisclosureStatusService,
              context.__providerContextDisclosureStatusService,
            );
            assert.equal(typeof options.runtimeWorkspaceSnapshotService.recordRuntimeSourceTree, 'function');
            assert.equal(typeof options.runtimeWorkspaceSnapshotService.bindToolFile, 'function');
            assert.equal(typeof options.runtimeWorkspaceSnapshotService.readRuntimeToolFile, 'function');
            assert.equal(typeof options.runtimeWorkspaceSnapshotService.readRuntimeSourceTree, 'function');
            assert.equal(typeof options.onGenerationStarted, 'function');
            assert.equal(typeof options.onProviderOutputDelta, 'function');
            return service;
          },
        };
      }
      if (specifier === './builder-task-capsule-store.cjs') {
        return {
          createBuilderTaskCapsuleStore: (databasePath) => {
            probes.taskCapsuleDatabasePath = databasePath;
            context.__taskCapsuleStore = {
              closed: false,
              store_version: 'builder-task-capsule-store.v1',
              record_task_capsule_update() {},
              read_task_capsule_update() {},
              read_latest_task_capsule() {},
              close() {
                this.closed = true;
                return true;
              },
            };
            return context.__taskCapsuleStore;
          },
        };
      }
      if (specifier === './builder-task-capsule-recording-service.cjs') {
        return {
          createBuilderTaskCapsuleRecordingService: (options) => {
            probes.taskCapsuleRecordingOptions = options;
            assert.equal(options.task_capsule_store, context.__taskCapsuleStore);
            context.__taskCapsuleRecordingService = {
              service_version: 'builder-task-capsule-recording-service.v1',
              record_task_capsule_from_conversation() {},
            };
            return context.__taskCapsuleRecordingService;
          },
        };
      }
      if (specifier === './builder-project-understanding-store.cjs') {
        return {
          createBuilderProjectUnderstandingStore: (databasePath) => {
            probes.projectUnderstandingDatabasePath = databasePath;
            context.__projectUnderstandingStore = {
              closed: false,
              store_version: 'builder-project-understanding-store.v1',
              record_project_understanding_snapshot() {},
              read_project_understanding_snapshot() {},
              read_latest_project_understanding_snapshot() {},
              close() {
                this.closed = true;
                return true;
              },
            };
            return context.__projectUnderstandingStore;
          },
        };
      }
      if (specifier === './builder-project-understanding-service.cjs') {
        return {
          createBuilderProjectUnderstandingService: (options) => {
            probes.projectUnderstandingServiceOptions = options;
            assert.equal(options.project_understanding_store, context.__projectUnderstandingStore);
            assert.equal(typeof options.now_ms, 'function');
            context.__projectUnderstandingService = {
              service_version: 'builder-project-understanding-service.v1',
              refresh_project_understanding() {},
            };
            return context.__projectUnderstandingService;
          },
        };
      }
      if (specifier === './builder-working-context-state-service.cjs') {
        return {
          createBuilderWorkingContextStateService: (options) => {
            probes.workingContextStateOptions = options;
            assert.equal(options.task_capsule_store, context.__taskCapsuleStore);
            assert.equal(options.session_task_address_store, context.__sessionTaskAddressStore);
            assert.equal(options.context_compaction_summary_store, context.__contextCompactionSummaryStore);
            assert.equal(options.handoff_packet_store, context.__handoffPacketStore);
            context.__workingContextStateService = {
              service_version: 'builder-working-context-state-service.v1',
              read_current_working_context_state_for_conversation() {},
            };
            return context.__workingContextStateService;
          },
        };
      }
      if (specifier === './builder-context-compaction-summary-store.cjs') {
        return {
          createBuilderContextCompactionSummaryStore: (databasePath) => {
            probes.contextCompactionSummaryDatabasePath = databasePath;
            context.__contextCompactionSummaryStore = {
              closed: false,
              store_version: 'builder-context-compaction-summary-store.v1',
              record_context_compaction_summary() {},
              read_context_compaction_summary() {},
              read_latest_context_compaction_summary() {},
              close() {
                this.closed = true;
                return true;
              },
            };
            return context.__contextCompactionSummaryStore;
          },
        };
      }
      if (specifier === './builder-context-compaction-recording-service.cjs') {
        return {
          createBuilderContextCompactionRecordingService: (options) => {
            probes.contextCompactionRecordingOptions = options;
            assert.equal(options.context_compaction_summary_store, context.__contextCompactionSummaryStore);
            assert.equal(options.session_task_address_store, context.__sessionTaskAddressStore);
            assert.equal(typeof options.now_ms, 'function');
            context.__contextCompactionRecordingService = {
              service_version: 'builder-context-compaction-recording-service.v1',
              record_committed_conversation_compaction() {},
            };
            return context.__contextCompactionRecordingService;
          },
        };
      }
      if (specifier === './builder-handoff-packet-store.cjs') {
        return {
          createBuilderHandoffPacketStore: (databasePath) => {
            probes.handoffPacketDatabasePath = databasePath;
            context.__handoffPacketStore = {
              closed: false,
              store_version: 'builder-handoff-packet-store.v1',
              record_handoff_packet() {},
              read_handoff_packet() {},
              list_pending_handoff_packets() {},
              close() {
                this.closed = true;
                return true;
              },
            };
            return context.__handoffPacketStore;
          },
        };
      }
      if (specifier === './builder-session-task-address-store.cjs') {
        return {
          createBuilderSessionTaskAddressStore: (databasePath) => {
            probes.sessionTaskAddressDatabasePath = databasePath;
            context.__sessionTaskAddressStore = {
              closed: false,
              store_version: 'builder-session-task-address-store.v1',
              record_session_address() {},
              record_task_address() {},
              read_session_address() {},
              read_task_address(request) {
                probes.taskAddressReadRequests ??= [];
                probes.taskAddressReadRequests.push(request);
                const taskAddress = probes.taskAddresses?.get(request.task_address_id) ?? probes.taskAddress;
                return taskAddress === undefined
                  ? { status: 'absent', task_address: null }
                  : { status: 'ready', task_address: { task_address: taskAddress } };
              },
              read_current_session_task_for_conversation() {},
              list_task_addresses_for_agent() { return { status: 'ready', task_addresses: [] }; },
              close() {
                this.closed = true;
                return true;
              },
            };
            return context.__sessionTaskAddressStore;
          },
        };
      }
      if (specifier === './builder-agent-definition-store.cjs') {
        return {
          createBuilderAgentDefinitionStore: (databasePath) => {
            probes.agentDefinitionDatabasePath = databasePath;
            context.__agentDefinitionStore = {
              closed: false,
              store_version: 'builder-agent-definition-store.v1',
              record_definition() {},
              record_version() {},
              record_lifecycle() {},
              read_agent() {},
              close() { this.closed = true; return true; },
            };
            return context.__agentDefinitionStore;
          },
        };
      }
      if (specifier === './builder-default-agent-bootstrap.cjs') {
        return {
          DEFAULT_BUILDER_AGENT_ID: 'builder-agent:123e4567-e89b-42d3-a456-426614174002',
          createBuilderDefaultAgentBootstrap: (options) => {
            assert.equal(options.agent_store, context.__agentDefinitionStore);
            assert.equal(options.owner_id, 'builder-user:00000000-0000-4000-8000-000000000001');
            return { operation: 'default_agent_ready' };
          },
        };
      }
      if (specifier === './builder-agent-project-tree-projection.cjs') {
        return {
          createBuilderAgentProjectTreeProjection: (options) => {
            assert.equal(options.agent_store, context.__agentDefinitionStore);
            assert.equal(options.address_store, context.__sessionTaskAddressStore);
            assert.equal(typeof options.list_current_projects, 'function');
            assert.equal(typeof options.list_project_workspaces, 'function');
            return { read_tree: async () => ({ projection_version: 'agent-project-tree-projection.v1' }) };
          },
        };
      }
      if (specifier === './builder-agent-project-tree-ipc-adapter.cjs') {
        return {
          ARCHIVE_AGENT_PROJECT_CHANNEL,
          ARCHIVE_AGENT_TASK_CHANNEL,
          READ_AGENT_PROJECT_TREE_CHANNEL,
          RENAME_AGENT_PROJECT_CHANNEL,
          RENAME_AGENT_TASK_CHANNEL,
          createBuilderAgentProjectTreeIpcAdapter: (options) => ({
            invoke: (_event, body) => options.readTree(body),
            channels: {
              renameProject: {
                channel: RENAME_AGENT_PROJECT_CHANNEL,
                invoke: (_event, body) => options.renameProject(body),
              },
              archiveProject: {
                channel: ARCHIVE_AGENT_PROJECT_CHANNEL,
                invoke: (_event, body) => options.archiveProject(body),
              },
              renameTask: {
                channel: RENAME_AGENT_TASK_CHANNEL,
                invoke: (_event, body) => options.renameTask(body),
              },
              archiveTask: {
                channel: ARCHIVE_AGENT_TASK_CHANNEL,
                invoke: (_event, body) => options.archiveTask(body),
              },
            },
          }),
        };
      }
      if (specifier === './builder-session-task-address-binding-service.cjs') {
        return {
          createBuilderSessionTaskAddressBindingService: (options) => {
            probes.sessionTaskAddressBindingOptions = {
              address_store: options.address_store,
            };
            assert.equal(options.address_store, context.__sessionTaskAddressStore);
            context.__sessionTaskAddressBindingService = {
              service_version: 'builder-session-task-address-binding-service.v1',
              bind_queued_followup_work_to_current_task_address() {},
              bind_approved_plan_continuation_to_current_task_address() {},
              bind_draft_continuation_to_current_task_address() {},
            };
            return context.__sessionTaskAddressBindingService;
          },
        };
      }
      if (specifier === './builder-session-task-target-service.cjs') {
        return {
          createBuilderSessionTaskTargetService: (options) => {
            assert.equal(options.address_store, context.__sessionTaskAddressStore);
            assert.equal(typeof options.create_uuid, 'function');
            context.__sessionTaskTargetService = {
              service_version: 'builder-session-task-target-service.v1',
              resolve_target(request) {
                const projectUuid = request.project_id.slice('builder-project:'.length);
                return {
                  result_version: 'builder-session-task-target-result.v1',
                  operation: request.task_address_id === null
                    ? 'new_task_target_allocated'
                    : 'existing_task_target_resolved',
                  project_id: request.project_id,
                  task_address_id: request.task_address_id,
                  conversation_id: `builder-conversation:${projectUuid}`,
                  agent_id: options.agent_id,
                  should_record_task_address: request.task_address_id === null,
                  authority: 'main_owned_task_target_resolution',
                };
              },
            };
            return context.__sessionTaskTargetService;
          },
        };
      }
      if (specifier === './builder-session-task-address-recording-service.cjs') {
        return {
          createBuilderSessionTaskAddressRecordingService: (options) => {
            probes.sessionTaskAddressRecordingOptions = {
              address_store: options.address_store,
              created_by: options.created_by,
              agent_id: options.agent_id,
            };
            assert.equal(options.address_store, context.__sessionTaskAddressStore);
            assert.equal(typeof options.create_uuid, 'function');
            assert.equal(typeof options.now_ms, 'function');
            context.__sessionTaskAddressRecordingService = {
              service_version: 'builder-session-task-address-recording-service.v1',
              record_addresses_from_conversation_context() {},
            };
            return context.__sessionTaskAddressRecordingService;
          },
        };
      }
      if (specifier === './builder-draft-checkpoint-store.cjs') {
        return {
          createBuilderDraftCheckpointStore: (databasePath) => {
            probes.draftCheckpointDatabasePath = databasePath;
            context.__draftCheckpointStore = {
              closed: false,
              store_version: 'builder-draft-checkpoint-store.v1',
              record_draft_checkpoint() {},
              read_draft_checkpoint() {},
              read_latest_draft_checkpoint_for_task() {},
              list_draft_checkpoints_for_task() {},
              close() { this.closed = true; return true; },
            };
            return context.__draftCheckpointStore;
          },
        };
      }
      if (specifier === './builder-draft-checkpoint-recording-service.cjs') {
        return {
          createBuilderDraftCheckpointRecordingService: (options) => {
            assert.equal(options.draft_checkpoint_store, context.__draftCheckpointStore);
            context.__draftCheckpointRecordingService = {
              service_version: 'builder-draft-checkpoint-recording-service.v1',
              record_draft_checkpoint_from_candidate() {},
            };
            return context.__draftCheckpointRecordingService;
          },
        };
      }
      if (specifier === './builder-automatic-draft-checkpoint-service.cjs') {
        return {
          createBuilderAutomaticDraftCheckpointService: (options) => {
            assert.equal(options.address_store, context.__sessionTaskAddressStore);
            assert.equal(options.draft_checkpoint_store, context.__draftCheckpointStore);
            assert.equal(
              options.draft_checkpoint_recording_service,
              context.__draftCheckpointRecordingService,
            );
            assert.equal(typeof options.now_ms, 'function');
            context.__automaticDraftCheckpointService = {
              service_version: 'builder-automatic-draft-checkpoint-service.v1',
              record_verified_candidate_checkpoint() {},
              read_current_checkpoint_status() {},
              verify_current_candidate_checkpoint() {},
            };
            return context.__automaticDraftCheckpointService;
          },
        };
      }
      if (specifier === './builder-check-run-store.cjs') {
        return {
          createBuilderCheckRunStore: (databasePath) => {
            probes.checkRunDatabasePath = databasePath;
            context.__checkRunStore = {
              closed: false,
              store_version: 'builder-check-run-store.v1',
              read_latest_check_run() {},
              close() { this.closed = true; return true; },
            };
            return context.__checkRunStore;
          },
        };
      }
      if (specifier === './builder-check-run-status-service.cjs') {
        return {
          createBuilderCheckRunStatusService: (options) => {
            assert.equal(options.check_run_store, context.__checkRunStore);
            context.__checkRunStatusService = {
              service_version: 'builder-check-run-status-service.v1',
              read_current_check_run_status() {
                return { check_run_status_projection: null };
              },
            };
            return context.__checkRunStatusService;
          },
        };
      }
      if (specifier === './builder-check-run-activity-registry.cjs') {
        return {
          createBuilderCheckRunActivityRegistry: (options) => {
            probes.checkRunActivityRegistryOptions = options;
            assert.equal(typeof options.on_activity_changed, 'function');
            context.__checkRunActivityRegistry = {
              registry_version: 'builder-check-run-activity-registry.v1',
              acquire_candidate_save() {},
              release_candidate_save() {},
              read_candidate_activity() {
                return {
                  result_version: 'builder-check-run-candidate-activity-result.v1',
                  project_id: PROJECT_ID,
                  candidate_id: CANDIDATE_ID,
                  activity: null,
                };
              },
            };
            return context.__checkRunActivityRegistry;
          },
        };
      }
      if (specifier === './builder-check-run-save-gate.cjs') {
        return {
          createBuilderCheckRunSaveGate: (options) => {
            assert.equal(options.check_run_store, context.__checkRunStore);
            assert.equal(options.activity_registry, context.__checkRunActivityRegistry);
            if (probes.failCheckRunSaveGate) throw new Error('private check gate failure');
            context.__checkRunSaveGate = {
              gate_version: 'builder-check-run-save-gate.v1',
              with_current_candidate_save_gate() {},
            };
            return context.__checkRunSaveGate;
          },
        };
      }
      if (specifier === './builder-check-run-process-adapter.cjs') {
        return {
          createBuilderCheckRunProcessAdapter: (options) => {
            probes.checkRunProcessAdapterOptions = options;
            assert.equal(typeof options.spawn_process, 'function');
            assert.equal(options.platform, process.platform);
            assert.equal(
              options.windows_root === null,
              process.platform !== 'win32',
            );
            context.__checkRunProcessAdapter = {
              adapter_version: 'builder-check-run-process-adapter.v1',
              spawn_process() {},
              terminate_process_tree() {},
            };
            return context.__checkRunProcessAdapter;
          },
        };
      }
      if (specifier === './builder-check-run-runtime-composition.cjs') {
        return {
          createBuilderCheckRunRuntimeComposition: (options) => {
            probes.checkRunCompositionOptions = options;
            assert.equal(options.user_data_path, context.__userDataPath);
            assert.equal(options.launcher_path, process.execPath);
            assert.equal(
              options.worker_path,
              path.join(path.dirname(runtimePath), 'builder-packaged-check-script-worker.cjs'),
            );
            assert.equal(options.process_adapter, context.__checkRunProcessAdapter);
            assert.equal(typeof options.toolchain_probe_spawn_process, 'function');
            assert.equal(typeof options.dependency_prepare_spawn_process, 'function');
            assert.equal(
              options.project_workspace_path_service.service_version,
              'builder-project-workspace-path-service.v1',
            );
            assert.equal(options.conversation_service, context.__conversationService);
            assert.equal(options.git_authority, context.__projectMainAuthority.git_authority);
            assert.equal(
              options.automatic_draft_checkpoint_service,
              context.__automaticDraftCheckpointService,
            );
            assert.equal(options.check_run_store, context.__checkRunStore);
            assert.equal(options.check_run_status_service, context.__checkRunStatusService);
            assert.equal(options.activity_registry, context.__checkRunActivityRegistry);
            assert.equal(options.clock.clock_version, 'builder-clock.v1');
            assert.equal(typeof options.clock.now_ms, 'function');
            assert.equal(typeof options.clock.set_timeout, 'function');
            assert.equal(typeof options.clock.clear_timeout, 'function');
            context.__checkRunCurrentDraftService = {
              service_version: 'builder-check-run-current-draft-service.v1',
              list_available_checks() {},
              run_selected_check() {},
            };
            context.__checkRunSkipCurrentDraftService = {
              service_version: 'builder-check-skip-current-draft-service.v1',
              skip_current_draft_check() {},
            };
            return {
              composition_version: 'builder-check-run-runtime-composition.v1',
              current_draft_service: context.__checkRunCurrentDraftService,
              current_draft_skip_service: context.__checkRunSkipCurrentDraftService,
            };
          },
        };
      }
      if (specifier === './builder-project-environment-diagnosis.cjs') {
        return {
          createBuilderProjectEnvironmentDiagnosisService: (options) => {
            probes.projectEnvironmentDiagnosisOptions = options;
            assert.equal(options.project_workspace_path_service.service_version,
              'builder-project-workspace-path-service.v1');
            assert.equal(options.project_read_authority.authority_version,
              'builder-project-read-authority.v1');
            assert.equal(typeof options.spawn_process, 'function');
            assert.equal(typeof options.terminate_process_tree, 'function');
            assert.equal(options.clock.clock_version, 'builder-clock.v1');
            context.__projectEnvironmentDiagnosisService = {
              service_version: 'builder-project-environment-diagnosis-service.v1',
              diagnose_project_environment() {},
            };
            return context.__projectEnvironmentDiagnosisService;
          },
        };
      }
      if (specifier === './builder-conversation-transcript-archive.cjs') {
        return {
          createBuilderConversationTranscriptArchive: (options) => {
            probes.conversationTranscriptArchiveOptions = options;
            assert.equal(
              options.root_path,
              path.join(context.__userDataPath, 'builder-transcripts-v1'),
            );
            context.__conversationTranscriptArchive = {
              archive_version: 'builder-conversation-transcript-archive.v1',
              record_committed_conversation() {},
              repair_conversation() {},
              read_latest() {},
            };
            return context.__conversationTranscriptArchive;
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
            assert.equal(options.workingContextStateService, context.__workingContextStateService);
            assert.equal(
              options.providerContextDisclosureStatusService,
              context.__providerContextDisclosureStatusService,
            );
            assert.equal(options.automaticDraftCheckpointService, context.__automaticDraftCheckpointService);
            assert.equal(options.checkRunStatusService, context.__checkRunStatusService);
            assert.equal(options.checkRunActivityRegistry, context.__checkRunActivityRegistry);
            assert.equal(options.transcriptArchive, context.__conversationTranscriptArchive);
            assert.equal(
              options.contextCompactionRecordingService,
              context.__contextCompactionRecordingService,
            );
            context.__conversationService = {
              begin_work() {},
              begin_queued_followup_work() {},
              begin_queued_followup_question() {},
              complete_candidate() {},
              complete_failure() {},
              record_retryable_failure() {},
              record_run_progress() {},
              record_tool_call_request() {},
              select_tool_adapter() {},
              admit_tool_runtime_invocation() {},
              record_tool_result() {},
              retry_after_failure() {},
              request_cancel() {},
              record_steering() {},
              record_queued_followup() {},
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
            assert.equal(typeof options.workspaceReadAuthority.load_fresh_workspace, 'function');
            assert.equal(
              options.automaticDraftCheckpointService,
              context.__automaticDraftCheckpointService,
            );
            assert.equal(options.checkRunSaveGate, context.__checkRunSaveGate);
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
          CREATE_LOCAL_PROJECT_CHANNEL,
          OPEN_PROJECT_CHANNEL,
          OPEN_PROJECT_LOCATION_CHANNEL,
          SAVE_DRAFT_CHANNEL,
          LOAD_CURRENT_CHANNEL,
          LOAD_REVISION_CHANNEL,
          LIST_CURRENT_CHANNEL,
          LIST_WORKSPACES_CHANNEL,
          LIST_HISTORY_CHANNEL,
          createBuilderProjectWorkspaceIpcAdapter: (options) => ({
            channels: {
              open: { invoke: (_event, body) => options.openProject(body) },
              openLocation: { invoke: (_event, body) => options.openProjectLocation(body) },
              createLocalProject: { invoke: (_event, body) => options.createLocalProject(body) },
              saveDraft: { invoke: (_event, body) => options.saveDraft(body) },
              loadCurrent: { invoke: (_event, body) => options.loadCurrent(body) },
              loadRevision: { invoke: (_event, body) => options.loadRevision(body) },
              listCurrent: { invoke: () => options.listCurrent() },
              listWorkspaces: { invoke: () => options.listWorkspaces() },
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
      if (specifier === './builder-permission-authority-contract.cjs') {
        const actual = require('../electron/builder-permission-authority-contract.cjs');
        return {
          BUILDER_PERMISSION_POLICY_VERSION: actual.BUILDER_PERMISSION_POLICY_VERSION,
        };
      }
      if (specifier === './builder-permission-ipc-runtime.cjs') {
        return {
          LOCAL_BUILDER_USER_ACTOR_ID: 'builder-user:00000000-0000-4000-8000-000000000001',
          PERMISSION_DATABASE: 'permissions.sqlite',
          PERMISSION_DIRECTORY: 'builder-permissions-v1',
        };
      }
      if (specifier === './builder-permission-fact-store.cjs') {
        return {
          createBuilderPermissionFactStore: (databasePath) => {
            probes.permissionDatabasePath = databasePath;
            return {
              close() {
                probes.permissionStoreClosed = (probes.permissionStoreClosed ?? 0) + 1;
              },
              create_evaluator() {
                probes.permissionEvaluatorCreated = (probes.permissionEvaluatorCreated ?? 0) + 1;
                return {
                  evaluate(request) {
                    probes.permissionEvaluateRequests ??= [];
                    probes.permissionEvaluateRequests.push(request);
                    const decision = typeof probes.permissionDecision === 'function'
                      ? probes.permissionDecision(request)
                      : request.action === 'project.edit'
                        ? 'allowed'
                        : 'denied';
                    return {
                      decision_version: 'builder-permission-decision.v1',
                      policy_version: request.policy_version,
                      actor_id: request.actor_id,
                      action: request.action,
                      resource: request.resource,
                      evaluated_at_ms: request.now_ms,
                      decision,
                      reason: decision === 'allowed' ? 'matching_active_grant' : 'no_matching_active_grant',
                      permission_id: decision === 'allowed'
                        ? 'builder-permission:00000000-0000-4000-8000-000000000001'
                        : null,
                      permission_authority: 'builder_permission_facts_deny_by_default_v1',
                      ui_selection_authority: 'not_permission',
                    };
                  },
                };
              },
            };
          },
        };
      }
      if (specifier === './builder-tool-permission-admission.cjs') {
        return {
          createBuilderToolPermissionAdmission: (options) => {
            probes.permissionAdmissionOptions = options;
            return {
              admission_version: 'builder-tool-permission-admission.v1',
              admit(request) {
                probes.permissionAdmissionRequests ??= [];
                probes.permissionAdmissionRequests.push(request);
                return {
                  admission_version: 'builder-tool-permission-admission-record.v1',
                  permission_admission: 'denied',
                };
              },
            };
          },
        };
      }
      if (specifier === './builder-provider-context-disclosure-decision.cjs') {
        return {
          createBuilderProviderContextDisclosureDecisionService: (options) => {
            probes.providerContextDisclosureDecisionOptions = options;
            context.__providerContextDisclosureDecisionService = {
              service_version: 'builder-provider-context-disclosure-decision.v1',
              decide(request) {
                probes.providerContextDisclosureDecisionRequests ??= [];
                probes.providerContextDisclosureDecisionRequests.push(request);
                return {
                  result_version: 'builder-provider-context-disclosure-decision.v1',
                  disclosure_decision: {
                    decision: 'denied',
                  },
                };
              },
            };
            return context.__providerContextDisclosureDecisionService;
          },
        };
      }
      if (specifier === './builder-provider-context-disclosure-status-service.cjs') {
        return {
          createBuilderProviderContextDisclosureStatusService: () => {
            probes.providerContextDisclosureStatusCreated =
              (probes.providerContextDisclosureStatusCreated ?? 0) + 1;
            context.__providerContextDisclosureStatusService = {
              service_version: 'builder-provider-context-disclosure-status-service.v1',
              record_current_provider_context_disclosure_status() {},
              read_current_provider_context_disclosure_status_for_conversation() {},
              read_current_provider_context_disclosure_request_preparation_for_conversation() {},
              clear_current_provider_context_disclosure_status_for_conversation() {},
            };
            return context.__providerContextDisclosureStatusService;
          },
        };
      }
      if (specifier === './builder-tool-source-context-collector.cjs') {
        return {
          createBuilderToolSourceContextCollector: (options) => {
            probes.sourceContextCollectorOptions = options;
            return {
              collector_version: 'builder-tool-source-context-collector.v1',
              collect_project_source_context() {
                throw new Error('collector must stay behind generation service in runtime tests');
              },
            };
          },
        };
      }
      if (specifier === './builder-generation-kernel.cjs') {
        const actual = require('../electron/builder-generation-kernel.cjs');
        return {
          ...actual,
          createBuilderGenerationRequest(body) {
            return actual.createBuilderGenerationRequest({
              instruction: body.instruction,
              existing_project_id: body.existing_project_id,
              task_address_id: body.task_address_id,
            });
          },
        };
      }
      if (specifier === './builder-project-source-tree.cjs') {
        const actual = require('../electron/builder-project-source-tree.cjs');
        return {
          ...actual,
          createBuilderProjectSourceTree(value) {
            return actual.createBuilderProjectSourceTree(JSON.parse(JSON.stringify(value)));
          },
        };
      }
      if (specifier === './builder-local-workspace-source-tree.cjs') {
        return require('../electron/builder-local-workspace-source-tree.cjs');
      }
      if (specifier === './builder-project-main-authority.cjs') {
        return {
          PROJECT_REPOSITORY_DIRECTORY: 'builder-projects-v2',
          GIT_RUNTIME_DIRECTORY: 'builder-git-runtime-v2',
          METADATA_DIRECTORY: 'builder-product-metadata-v6',
          METADATA_DATABASE: 'builder.sqlite',
          createBuilderProjectMainAuthority(options) {
            probes.projectMainAuthorityOptions = options;
            context.__projectMainAuthority = {
              closed: false,
              git_authority: {
                persist_candidate_commit() {},
                verify_candidate_receipt() {},
                read_verified_candidate() {},
                read_candidate_workspace_base() {},
              },
              git_current_projection: {
                project_current() {},
              },
              metadata_authority: {
                append_conversation_events() {},
                load_conversation() {},
                load_conversation_candidate_by_draft() {},
                load_project_workspace(body) {
                  probes.loadProjectWorkspaceRequests ??= [];
                  probes.loadProjectWorkspaceRequests.push({ project_id: body.project_id });
                  if (typeof probes.loadProjectWorkspace === 'function') {
                    return probes.loadProjectWorkspace(body);
                  }
                  context.__workspaceProjectId = body.project_id;
                  return vm.runInContext(`({
                    result_version: "builder-product-metadata-result.v1",
                    operation: "project_workspace_bound",
                    workspace: {
                      project_id: __workspaceProjectId,
                      project_title: __workspaceTitle,
                      project_root_path: __workspaceRoot,
                      source_folders: [{ name: __workspaceFolder, status: "selected" }],
                      bound_at_ms: 1,
                      binding_status: "bound"
                    }
                  })`, context);
                },
                load_project_identity(body) {
                  probes.loadProjectIdentityRequests ??= [];
                  probes.loadProjectIdentityRequests.push({ project_id: body.project_id });
                  if (typeof probes.loadProjectIdentity === 'function') return probes.loadProjectIdentity(body);
                  context.__identityProjectId = body.project_id;
                  return vm.runInContext(`({
                    result_version: "builder-product-metadata-result.v1",
                    operation: "project_identity_loaded",
                    project: {
                      project_id: __identityProjectId,
                      created_at_ms: 1,
                      current_revision_receipt_digest: null,
                      current_revision_number: 0
                    }
                  })`, context);
                },
                bind_project_workspace(body) {
                  probes.bindProjectWorkspaceRequests ??= [];
                  probes.bindProjectWorkspaceRequests.push({
                    project_id: body.project_id,
                    project_title: body.project_title,
                    project_root_path: body.project_root_path,
                    source_folder_name: body.source_folder_name,
                  });
                  if (typeof probes.bindProjectWorkspace === 'function') return probes.bindProjectWorkspace(body);
                  context.__workspaceProjectId = body.project_id;
                  context.__workspaceTitle = body.project_title;
                  context.__workspaceRoot = body.project_root_path;
                  context.__workspaceFolder = body.source_folder_name;
                  return vm.runInContext(`({
                    result_version: "builder-product-metadata-result.v1",
                    operation: "project_workspace_bound",
                    workspace: {
                      project_id: __workspaceProjectId,
                      project_title: __workspaceTitle,
                      project_root_path: __workspaceRoot,
                      source_folders: [{ name: __workspaceFolder, status: "selected" }],
                      bound_at_ms: 1,
                      binding_status: "bound"
                    }
                  })`, context);
                },
                list_project_workspaces() {
                  probes.listProjectWorkspacesRequests ??= [];
                  probes.listProjectWorkspacesRequests.push({ limit: 256 });
                  return vm.runInContext(`({
                    result_version: "builder-product-metadata-result.v4",
                    operation: "project_workspaces_listed",
                    workspaces: [],
                    metadata_evidence: {
                      database_id: "builder-product-metadata-database.v3",
                      schema_fingerprint_digest: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
                      schema_version: "builder-product-metadata-schema.v6",
                      user_version: 6,
                      runtime_pragmas: {
                        foreign_keys: "on",
                        journal_mode: "wal",
                        synchronous: "full",
                        trusted_schema: "off"
                      },
                      transaction: "project_workspace_list_readback",
                      git_object_verification: "not_performed_by_metadata_database",
                      source_bytes_stored: false,
                      credential_storage: "not_present",
                      ui_state_storage: "not_present"
                    }
                  })`, context);
                },
                record_project_revision_receipt() {},
              },
              project_read_authority: {
                authority_version: 'builder-project-read-authority.v1',
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
      context.__openPath = options.openPath;
      context.__showOpenDialog = options.showOpenDialog;
      context.__grantPermissionForExplicitApproval = options.grantPermissionForExplicitApproval ?? (async () => ({
        result_version: 'builder-permission-grant-result.v1',
        project_id: 'builder-project:123e4567-e89b-42d3-a456-426614174000',
        action: 'filesystem.read',
        operation: 'grant_recorded',
        ui_selection_authority: 'main_owned_explicit_user_approval_required',
      }));
      return vm.runInContext(`module.exports.createBuilderGenerationIpcRuntime({
        fetchImpl: __fetchImpl,
        grantPermissionForExplicitApproval: __grantPermissionForExplicitApproval,
        ipcMain: __ipcMain,
        mainWindowRef: () => __mainWindow,
        ...(typeof __openPath === "function" ? { openPath: __openPath } : {}),
        ...(typeof __showOpenDialog === "function" ? { showOpenDialog: __showOpenDialog } : {}),
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
    grantPermissionForExplicitApproval,
    ipcMain,
    mainWindowRef: () => mainWindow,
    userDataPath,
  });

  assert.equal(runtime.runtime_version, 'builder-generation-ipc-runtime.v2');
  assert.deepEqual(runtime.channels, [
    GENERATE_CHANNEL,
    CONTINUE_DRAFT_CHANNEL,
    GENERATE_APPROVED_PLAN_CHANNEL,
    PROPOSE_PLAN_CHANNEL,
    PREPARE_PLAN_SOURCE_READ_APPROVAL_CHANNEL,
    APPROVE_PLAN_SOURCE_READ_CHANNEL,
    PREPARE_CURRENT_PROJECT_WRITE_APPROVAL_CHANNEL,
    APPROVE_CURRENT_PROJECT_WRITE_CHANNEL,
    SUBMIT_CHANNEL,
    CLASSIFY_INTENT_CHANNEL,
    RETRY_GENERATE_CHANNEL,
    ANSWER_CHANNEL,
    ANSWER_PLAN_CHANNEL,
    ANSWER_DRAFT_CHANNEL,
    RESTORE_DRAFT_CHANNEL,
    RESTORE_REVISION_AS_DRAFT_CHANNEL,
    RESTORE_PREVIOUS_CHECKPOINT_AS_DRAFT_CHANNEL,
    REJECT_DRAFT_CHANNEL,
    CANCEL_CHANNEL,
    STEER_CHANNEL,
    QUEUE_FOLLOWUP_CHANNEL,
    AVAILABILITY_CHANNEL,
    DECIDE_COMMAND_APPROVAL_CHANNEL,
    OPEN_PROJECT_CHANNEL,
    OPEN_PROJECT_LOCATION_CHANNEL,
    CREATE_LOCAL_PROJECT_CHANNEL,
    SAVE_DRAFT_CHANNEL,
    LOAD_CURRENT_CHANNEL,
    LOAD_REVISION_CHANNEL,
    LIST_CURRENT_CHANNEL,
    LIST_WORKSPACES_CHANNEL,
    LIST_HISTORY_CHANNEL,
    READ_TASK_STREAM_CHANNEL,
    READ_AGENT_PROJECT_TREE_CHANNEL,
    RENAME_AGENT_PROJECT_CHANNEL,
    ARCHIVE_AGENT_PROJECT_CHANNEL,
    RENAME_AGENT_TASK_CHANNEL,
    ARCHIVE_AGENT_TASK_CHANNEL,
    READ_AGENT_WORKBENCH_CHANNEL,
    UPDATE_WORKBENCH_MESSAGE_STATE_CHANNEL,
    CREATE_WORKBENCH_TASK_PROPOSAL_CHANNEL,
    DECIDE_WORKBENCH_TASK_PROPOSAL_CHANNEL,
    CONTROL_WORKBENCH_TASK_CHANNEL,
    REVIEW_PLAN_CHANNEL,
  ]);
  assert.equal(fs.existsSync(path.join(userDataPath, 'builder-project-revisions-v1')), false);
  assert.equal(fs.existsSync(path.join(userDataPath, 'builder-projects-v2')), true);
  assert.equal(fs.existsSync(path.join(userDataPath, 'builder-product-metadata-v6', 'builder.sqlite')), true);
  assert.equal(fs.existsSync(path.join(userDataPath, 'builder-provider-config-v1')), false);
  assert.equal(fs.existsSync(path.join(userDataPath, 'builder-provider-secrets-v1')), false);
  assert.equal(fs.existsSync(path.join(userDataPath, 'builder-permissions-v1', 'permissions.sqlite')), true);
  assert.equal(fs.existsSync(path.join(userDataPath, 'builder-task-capsules-v1', 'task-capsules.sqlite')), true);
  assert.equal(
    fs.existsSync(path.join(userDataPath, 'builder-session-task-addresses-v2', 'session-task-addresses.sqlite')),
    true,
  );
  assert.equal(
    fs.existsSync(path.join(userDataPath, 'builder-project-lifecycle-v1', 'project-lifecycle.sqlite')),
    true,
  );
  assert.equal(fs.existsSync(path.join(userDataPath, 'builder-session-task-addresses-v1')), false);
  assert.equal(
    fs.existsSync(path.join(userDataPath, 'builder-draft-checkpoints-v1', 'draft-checkpoints.sqlite')),
    true,
  );
  assert.equal(
    fs.existsSync(path.join(userDataPath, 'builder-check-runs-v1', 'check-runs.sqlite')),
    true,
  );
  assert.equal(
    fs.existsSync(path.join(userDataPath, 'builder-check-workspaces-v1')),
    true,
  );
  assert.equal(
    fs.existsSync(path.join(
      userDataPath,
      'builder-agent-workbench-messages-v1',
      'workbench-messages.sqlite',
    )),
    true,
  );
  assert.equal(
    runtime.readCheckRunCurrentDraftServiceForMainOnlyApprovalRuntime().service_version,
    'builder-check-run-current-draft-service.v1',
  );
  assert.equal(
    runtime.readProjectEnvironmentDiagnosisServiceForMainOnlyApprovalRuntime().service_version,
    'builder-project-environment-diagnosis-service.v1',
  );
  assert.equal(
    runtime.readProjectWorkspacePathServiceForMainOnlyRuntime().service_version,
    'builder-project-workspace-path-service.v1',
  );
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

test('exposes structured runtime workspace snapshots when Harness composition is unavailable', async (t) => {
  const runtimeToolRecord = { source: 'structured_tool_snapshot' };
  const runtimeSourceRecord = { source: 'structured_source_snapshot' };
  const probes = { runtimeToolRecord, runtimeSourceRecord };
  const runtimeModule = runtimeWithService({
    availability() {
      return { version: 'builder-generation-availability.v1', available: true, reason: 'ready', supports_cancel: true };
    },
  }, probes);
  const mainWindow = activeWindow();
  const runtime = runtimeModule.createRuntime({
    fetchImpl: unreachableFetch,
    grantPermissionForExplicitApproval,
    ipcMain: fakeIpcMain(),
    mainWindow,
    userDataPath: temporaryUserData(t),
  });
  runtime.register();
  const sourceService = runtime.readRuntimeWorkspaceSourceServiceForMainOnlyRuntime();
  const toolRequest = { selector: 'tool' };
  const sourceRequest = { selector: 'source' };

  assert.equal(await sourceService.resolve_runtime_tool_source(toolRequest), runtimeToolRecord);
  assert.equal(await sourceService.resolve_runtime_snapshot_source(sourceRequest), runtimeSourceRecord);
  assert.deepEqual(probes.runtimeToolReadRequests, [toolRequest]);
  assert.deepEqual(probes.runtimeSourceReadRequests, [sourceRequest]);
  assert.equal(runtime.dispose(), true);
});

test('persists projectless Agent chat without creating Project or Task Address fallback facts', async (t) => {
  const userDataPath = temporaryUserData(t);
  const mainWindow = activeWindow();
  const ipcMain = fakeIpcMain();
  const runtime = createBuilderGenerationIpcRuntime({
    fetchImpl: unreachableFetch,
    grantPermissionForExplicitApproval,
    ipcMain,
    mainWindowRef: () => mainWindow,
    userDataPath,
  });
  runtime.register();

  const answerEnvelope = await ipcMain.handlers.get(ANSWER_CHANNEL)(
    { sender: mainWindow.webContents },
    { instruction: 'hi', task_address_id: null },
  );
  assert.equal(answerEnvelope.ok, true);
  const answer = answerEnvelope.result;
  assert.equal(answer.result_kind, 'explanation');
  assert.equal(answer.project_id, null);
  assert.equal(answer.existing_project_id, null);

  const stream = await ipcMain.handlers.get(READ_TASK_STREAM_CHANNEL)(
    { sender: mainWindow.webContents },
    { agent_id: DEFAULT_BUILDER_AGENT_ID },
  );
  assert.equal(stream.project_id, null);
  assert.equal(stream.agent_id, DEFAULT_BUILDER_AGENT_ID);
  assert.match(stream.conversation.conversation_id, /^builder-agent-conversation:/u);
  assert.deepEqual(
    Array.from(stream.conversation.items, (item) => [item.role, item.message.text]),
    [
      ['user', 'hi'],
      ['assistant', answer.explanation],
    ],
  );
  const workbench = await ipcMain.handlers.get(READ_AGENT_WORKBENCH_CHANNEL)(
    { sender: mainWindow.webContents },
    { agent_id: DEFAULT_BUILDER_AGENT_ID, after_cursor: null, limit: 100 },
  );
  assert.deepEqual(
    Array.from(
      workbench.stream.items,
      (item) => [item.presentation.body_kind, item.presentation.body_text],
    ),
    [
      ['plain_text', 'hi'],
      ['markdown', answer.explanation],
    ],
  );
  assert.equal(workbench.authority.plugin_payload_exposure, 'not_exposed');
  assert.equal(
    mainWindow.webContents.sent.some(({ channel }) => channel === WORKBENCH_CHANGED_CHANNEL),
    true,
  );

  const tree = await ipcMain.handlers.get(READ_AGENT_PROJECT_TREE_CHANNEL)(
    { sender: mainWindow.webContents },
    { agent_id: DEFAULT_BUILDER_AGENT_ID },
  );
  assert.equal(tree.projects.length, 0);
  assert.equal(tree.orphaned_tasks.length, 0);
  runtime.dispose();

  const restartedWindow = activeWindow();
  const restartedIpcMain = fakeIpcMain();
  const restarted = createBuilderGenerationIpcRuntime({
    fetchImpl: unreachableFetch,
    grantPermissionForExplicitApproval,
    ipcMain: restartedIpcMain,
    mainWindowRef: () => restartedWindow,
    userDataPath,
  });
  restarted.register();
  const restored = await restartedIpcMain.handlers.get(READ_TASK_STREAM_CHANNEL)(
    { sender: restartedWindow.webContents },
    { agent_id: DEFAULT_BUILDER_AGENT_ID },
  );
  assert.deepEqual(restored, stream);
  const restoredWorkbench = await restartedIpcMain.handlers.get(READ_AGENT_WORKBENCH_CHANNEL)(
    { sender: restartedWindow.webContents },
    { agent_id: DEFAULT_BUILDER_AGENT_ID, after_cursor: null, limit: 100 },
  );
  assert.deepEqual(restoredWorkbench, workbench);
  restarted.dispose();
});

test('incubates an Agent task proposal, requires approval, and restores the materialized task', async (t) => {
  const userDataPath = temporaryUserData(t);
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'clawfabric-builder-incubated-project-'));
  const selectedProjectRootPath = fs.realpathSync.native(projectRoot);
  t.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));
  const mainWindow = activeWindow();
  const ipcMain = fakeIpcMain();
  const runtime = createBuilderGenerationIpcRuntime({
    fetchImpl: unreachableFetch,
    grantPermissionForExplicitApproval,
    ipcMain,
    mainWindowRef: () => mainWindow,
    userDataPath,
    showOpenDialog: async () => ({ canceled: false, filePaths: [selectedProjectRootPath] }),
  });
  runtime.register();
  const project = await ipcMain.handlers.get(CREATE_LOCAL_PROJECT_CHANNEL)(
    { sender: mainWindow.webContents },
    { project_id: null, project_title: 'Focus tools' },
  );
  const created = await ipcMain.handlers.get(CREATE_WORKBENCH_TASK_PROPOSAL_CHANNEL)(
    { sender: mainWindow.webContents },
    {
      request_id: 'builder-workbench-request:323e4567-e89b-42d3-a456-426614174000',
      agent_id: DEFAULT_BUILDER_AGENT_ID,
      objective: 'Build a compact focus timer.',
      requested_outcome: 'build',
      execution_mode: 'foreground',
      reason: 'Project scope is required.',
    },
  );
  assert.equal(created.operation, 'proposal_created');
  let workbench = await ipcMain.handlers.get(READ_AGENT_WORKBENCH_CHANNEL)(
    { sender: mainWindow.webContents },
    { agent_id: DEFAULT_BUILDER_AGENT_ID, after_cursor: null, limit: 100 },
  );
  let action = workbench.stream.items.flatMap((item) => item.actions)[0];
  assert.equal(action.status, 'pending');
  assert.equal(workbench.inbox.active_task_count, 0);

  const decided = await ipcMain.handlers.get(DECIDE_WORKBENCH_TASK_PROPOSAL_CHANNEL)(
    { sender: mainWindow.webContents },
    {
      agent_id: DEFAULT_BUILDER_AGENT_ID,
      proposal_id: created.proposal.proposal_id,
      operation: 'approve_existing_project',
      project_id: project.project_id,
    },
  );
  assert.equal(decided.operation, 'task_materialized');
  workbench = await ipcMain.handlers.get(READ_AGENT_WORKBENCH_CHANNEL)(
    { sender: mainWindow.webContents },
    { agent_id: DEFAULT_BUILDER_AGENT_ID, after_cursor: null, limit: 100 },
  );
  action = workbench.stream.items.flatMap((item) => item.actions)[0];
  assert.equal(action.status, 'materialized');
  assert.equal(action.task_address_id, decided.materialization.task_address_id);
  assert.equal(workbench.inbox.active_task_count, 1);
  runtime.dispose();

  const restartedWindow = activeWindow();
  const restartedIpcMain = fakeIpcMain();
  const restarted = createBuilderGenerationIpcRuntime({
    fetchImpl: unreachableFetch,
    grantPermissionForExplicitApproval,
    ipcMain: restartedIpcMain,
    mainWindowRef: () => restartedWindow,
    userDataPath,
  });
  restarted.register();
  const restoredTree = await restartedIpcMain.handlers.get(READ_AGENT_PROJECT_TREE_CHANNEL)(
    { sender: restartedWindow.webContents },
    { agent_id: DEFAULT_BUILDER_AGENT_ID },
  );
  assert.equal(restoredTree.projects[0].tasks[0].task_address_id, decided.materialization.task_address_id);
  const restoredWorkbench = await restartedIpcMain.handlers.get(READ_AGENT_WORKBENCH_CHANNEL)(
    { sender: restartedWindow.webContents },
    { agent_id: DEFAULT_BUILDER_AGENT_ID, after_cursor: null, limit: 100 },
  );
  assert.equal(
    restoredWorkbench.stream.items.flatMap((item) => item.actions)[0].status,
    'materialized',
  );
  restarted.dispose();
});

test('binds one selected empty folder as the main-owned local project workspace', async (t) => {
  const userDataPath = temporaryUserData(t);
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'clawfabric-builder-selected-project-'));
  const selectedProjectRootPath = fs.realpathSync.native(projectRoot);
  t.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));
  const mainWindow = activeWindow();
  const ipcMain = fakeIpcMain();
  const dialogCalls = [];
  const openPathCalls = [];
  const runtime = createBuilderGenerationIpcRuntime({
    fetchImpl: unreachableFetch,
    grantPermissionForExplicitApproval,
    ipcMain,
    mainWindowRef: () => mainWindow,
    openPath: async (targetPath) => {
      openPathCalls.push(targetPath);
      return '';
    },
    userDataPath,
    showOpenDialog: async (windowRef, dialogOptions) => {
      dialogCalls.push({ windowRef, dialogOptions });
      return { canceled: false, filePaths: [selectedProjectRootPath] };
    },
  });
  runtime.register();

  const selected = await ipcMain.handlers.get(CREATE_LOCAL_PROJECT_CHANNEL)(
    { sender: mainWindow.webContents },
    { project_id: null, project_title: 'Focus timer' },
  );
  assert.equal(selected.result_version, 'builder-project-selection-result.v1');
  assert.equal(selected.operation, 'local_project_bound');
  assert.match(selected.project_id, /^builder-project:/u);
  assert.equal(selected.project_title, 'Focus timer');
  assert.deepEqual(Array.from(selected.source_folders, (folder) => ({
    name: folder.name,
    status: folder.status,
  })), [{
    name: path.basename(selectedProjectRootPath),
    status: 'selected',
  }]);
  assert.equal(JSON.stringify(selected).includes(selectedProjectRootPath), false);
  assert.equal(dialogCalls.length, 1);
  assert.equal(dialogCalls[0].windowRef, mainWindow);
  assert.deepEqual(dialogCalls[0].dialogOptions.properties, ['openDirectory', 'createDirectory']);

  const listedWorkspaces = await ipcMain.handlers.get(LIST_WORKSPACES_CHANNEL)(
    { sender: mainWindow.webContents },
  );
  assert.equal(listedWorkspaces.operation, 'project_workspaces_listed');
  assert.deepEqual(Array.from(listedWorkspaces.workspaces, (workspace) => ({
    project_id: workspace.project_id,
    title: workspace.title,
    source_folders: Array.from(workspace.source_folders),
    has_current_revision: workspace.has_current_revision,
    current_revision_number: workspace.current_revision_number,
  })), [{
    project_id: selected.project_id,
    title: 'Focus timer',
    source_folders: [{
      name: path.basename(selectedProjectRootPath),
      status: 'selected',
    }],
    has_current_revision: false,
    current_revision_number: 0,
  }]);
  assert.equal(JSON.stringify(listedWorkspaces).includes(selectedProjectRootPath), false);

  const openedLocation = await ipcMain.handlers.get(OPEN_PROJECT_LOCATION_CHANNEL)(
    { sender: mainWindow.webContents },
    { project_id: selected.project_id },
  );
  assert.deepEqual(openedLocation, {
    result_version: 'builder-project-location-open-result.v1',
    project_id: selected.project_id,
    opened: true,
  });
  assert.deepEqual(openPathCalls, [selectedProjectRootPath]);
  assert.equal(JSON.stringify(openedLocation).includes(selectedProjectRootPath), false);
  await assert.rejects(
    ipcMain.handlers.get(OPEN_PROJECT_LOCATION_CHANNEL)(
      { sender: mainWindow.webContents },
      {
        project_id: selected.project_id,
        project_root_path: 'renderer-forged',
      },
    ),
  );
  assert.deepEqual(openPathCalls, [selectedProjectRootPath]);

  runtime.dispose();
  const metadata = createBuilderProductMetadataDatabase(
    path.join(userDataPath, 'builder-product-metadata-v6', 'builder.sqlite'),
  );
  const workspace = metadata.load_project_workspace({ project_id: selected.project_id });
  assert.deepEqual(workspace.workspace, {
    project_id: selected.project_id,
    project_title: 'Focus timer',
    project_root_path: selectedProjectRootPath,
    source_folders: [{
      name: path.basename(selectedProjectRootPath),
      status: 'selected',
    }],
    bound_at_ms: workspace.workspace.bound_at_ms,
    binding_status: 'bound',
  });
  const identity = metadata.load_project_identity({ project_id: selected.project_id });
  assert.equal(identity.project.current_revision_receipt_digest, null);
  assert.equal(identity.project.current_revision_number, 0);
  metadata.close();

  const restartedWindow = activeWindow();
  const restartedIpcMain = fakeIpcMain();
  const restarted = createBuilderGenerationIpcRuntime({
    fetchImpl: unreachableFetch,
    grantPermissionForExplicitApproval,
    ipcMain: restartedIpcMain,
    mainWindowRef: () => restartedWindow,
    userDataPath,
    showOpenDialog: async () => {
      throw new Error('restart open must not show a folder dialog');
    },
  });
  restarted.register();
  const reopened = await restartedIpcMain.handlers.get(OPEN_PROJECT_CHANNEL)(
    { sender: restartedWindow.webContents },
    { project_id: selected.project_id },
  );
  assert.deepEqual(reopened, {
    result_version: 'builder-project-selection-result.v1',
    operation: 'local_project_bound',
    project_id: selected.project_id,
    project_title: 'Focus timer',
    source_folders: [{
      name: path.basename(selectedProjectRootPath),
      status: 'selected',
    }],
  });
  assert.equal(JSON.stringify(reopened).includes(selectedProjectRootPath), false);
  restarted.dispose();
});

test('binds source folders to an existing logical project identity over workspace IPC', async (t) => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'clawfabric-existing-logical-project-'));
  const selectedProjectRootPath = fs.realpathSync.native(projectRoot);
  t.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));
  const probes = {};
  const runtimeModule = runtimeWithService({
    availability() {
      return { version: 'builder-generation-availability.v1', available: true, reason: 'ready', supports_cancel: true };
    },
  }, probes);
  const mainWindow = activeWindow();
  const ipcMain = fakeIpcMain();
  const dialogCalls = [];
  runtimeModule.context.__selectedProjectRootPath = selectedProjectRootPath;
  const runtime = runtimeModule.createRuntime({
    fetchImpl: unreachableFetch,
    grantPermissionForExplicitApproval,
    ipcMain,
    mainWindow,
    userDataPath: temporaryUserData(t),
    showOpenDialog: async (windowRef, dialogOptions) => {
      dialogCalls.push({ windowRef, dialogOptions });
      return vm.runInContext(
        '({ canceled: false, filePaths: [__selectedProjectRootPath] })',
        runtimeModule.context,
      );
    },
  });
  runtime.register();

  const selected = await ipcMain.handlers.get(CREATE_LOCAL_PROJECT_CHANNEL)(
    { sender: mainWindow.webContents },
    vm.runInContext(
      `({ project_id: ${JSON.stringify(PROJECT_ID)}, project_title: "Focus timer" })`,
      runtimeModule.context,
    ),
  );

  assert.equal(selected.result_version, 'builder-project-selection-result.v1');
  assert.equal(selected.operation, 'local_project_bound');
  assert.equal(selected.project_id, PROJECT_ID);
  assert.equal(selected.project_title, 'Focus timer');
  assert.deepEqual(Array.from(selected.source_folders, (folder) => ({
    name: folder.name,
    status: folder.status,
  })), [{
    name: path.basename(selectedProjectRootPath),
    status: 'selected',
  }]);
  assert.equal(JSON.stringify(selected).includes(selectedProjectRootPath), false);
  assert.deepEqual(probes.loadProjectIdentityRequests, [{ project_id: PROJECT_ID }]);
  assert.equal(probes.bindProjectWorkspaceRequests.length, 1);
  assert.deepEqual(probes.bindProjectWorkspaceRequests[0], {
    project_id: PROJECT_ID,
    project_title: 'Focus timer',
    project_root_path: selectedProjectRootPath,
    source_folder_name: path.basename(selectedProjectRootPath),
  });
  assert.equal(dialogCalls.length, 1);
  assert.deepEqual([...dialogCalls[0].dialogOptions.properties], ['openDirectory', 'createDirectory']);
  assert.equal(runtime.dispose(), true);
});

test('keeps active-renderer and request validation inside the controlled adapter', async (t) => {
  const mainWindow = activeWindow();
  const ipcMain = fakeIpcMain();
  const runtime = createBuilderGenerationIpcRuntime({
    fetchImpl: unreachableFetch,
    grantPermissionForExplicitApproval,
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
    ipcMain.handlers.get(CONTINUE_DRAFT_CHANNEL)({ sender: {} }, {
      draft_id: `builder-generation-draft:${'2'.repeat(64)}`,
      instruction: 'Keep refining.',
    }),
    (error) => error.code === 'builder_generation_forbidden'
      && error.stack === `${error.name}: ${error.message}`,
  );
  await assert.rejects(
    ipcMain.handlers.get(CONTINUE_DRAFT_CHANNEL)({ sender: mainWindow.webContents }, { private: 'marker' }),
    (error) => error.code === 'builder_generation_request_invalid'
      && !`${error.message}:${error.stack}`.includes('marker'),
  );
  await assert.rejects(
    ipcMain.handlers.get(PROPOSE_PLAN_CHANNEL)({ sender: {} }, { instruction: 'Plan this change.' }),
    (error) => error.code === 'builder_generation_forbidden'
      && error.stack === `${error.name}: ${error.message}`,
  );
  await assert.rejects(
    ipcMain.handlers.get(PROPOSE_PLAN_CHANNEL)({ sender: mainWindow.webContents }),
    (error) => error.code === 'builder_generation_request_invalid',
  );
  assert.deepEqual(
    await ipcMain.handlers.get(PROPOSE_PLAN_CHANNEL)(
      { sender: mainWindow.webContents },
      { instruction: 'Plan this change.' },
    ),
    {
      version: GENERATE_RESULT_VERSION,
      ok: false,
      error: {
        code: 'builder_generation_base_unavailable',
        retryable: true,
      },
    },
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
    ipcMain.handlers.get(ANSWER_DRAFT_CHANNEL)({ sender: {} }, {
      draft_id: `builder-generation-draft:${'a'.repeat(64)}`,
      instruction: 'Explain this draft.',
    }),
    (error) => error.code === 'builder_generation_forbidden'
      && error.stack === `${error.name}: ${error.message}`,
  );
  await assert.rejects(
    ipcMain.handlers.get(ANSWER_DRAFT_CHANNEL)({ sender: mainWindow.webContents }, { private: 'marker' }),
    (error) => error.code === 'builder_generation_request_invalid'
      && !`${error.message}:${error.stack}`.includes('marker'),
  );
  await assert.rejects(
    ipcMain.handlers.get(RESTORE_DRAFT_CHANNEL)({ sender: mainWindow.webContents }),
    (error) => error.code === 'builder_generation_request_invalid',
  );
  await assert.rejects(
    ipcMain.handlers.get(RESTORE_REVISION_AS_DRAFT_CHANNEL)({ sender: {} }, {
      project_id: PROJECT_ID,
      revision_receipt_digest: `sha256:${'b'.repeat(64)}`,
    }),
    (error) => error.code === 'builder_generation_forbidden'
      && error.stack === `${error.name}: ${error.message}`,
  );
  await assert.rejects(
    ipcMain.handlers.get(RESTORE_REVISION_AS_DRAFT_CHANNEL)({ sender: mainWindow.webContents }, {
      project_id: PROJECT_ID,
    }, {
      revision_receipt_digest: `sha256:${'b'.repeat(64)}`,
    }),
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
    ipcMain.handlers.get(STEER_CHANNEL)({ sender: {} }, {
      request_id: hostRequestDigest(),
      message: 'Continue with a calmer palette.',
    }),
    (error) => error.code === 'builder_generation_forbidden'
      && error.stack === `${error.name}: ${error.message}`,
  );
  await assert.rejects(
    ipcMain.handlers.get(STEER_CHANNEL)({ sender: mainWindow.webContents }, {
      request_id: 'bad',
      message: 'private marker',
    }),
    (error) => error.code === 'builder_generation_request_invalid'
      && !`${error.message}:${error.stack}`.includes('marker'),
  );
  await assert.rejects(
    ipcMain.handlers.get(STEER_CHANNEL)({ sender: mainWindow.webContents }, {
      request_id: hostRequestDigest(),
      message: 'Continue with a calmer palette.',
      source_tree: [{ path: 'index.html' }],
    }),
    (error) => error.code === 'builder_generation_request_invalid',
  );
  await assert.rejects(
    ipcMain.handlers.get(QUEUE_FOLLOWUP_CHANNEL)({ sender: {} }, {
      request_id: hostRequestDigest(),
      message: 'Run this next.',
    }),
    (error) => error.code === 'builder_generation_forbidden'
      && error.stack === `${error.name}: ${error.message}`,
  );
  await assert.rejects(
    ipcMain.handlers.get(QUEUE_FOLLOWUP_CHANNEL)({ sender: mainWindow.webContents }, {
      request_id: 'bad',
      message: 'private marker',
    }),
    (error) => error.code === 'builder_generation_request_invalid'
      && !`${error.message}:${error.stack}`.includes('marker'),
  );
  await assert.rejects(
    ipcMain.handlers.get(QUEUE_FOLLOWUP_CHANNEL)({ sender: mainWindow.webContents }, {
      request_id: hostRequestDigest(),
      message: 'Run this next.',
      source_tree: [{ path: 'index.html' }],
    }),
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
    ipcMain.handlers.get(LIST_WORKSPACES_CHANNEL)({ sender: mainWindow.webContents }, {}),
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

test('selects only currently supported plan context resources from the saved source tree', async (t) => {
  const mainWindow = activeWindow();
  const ipcMain = fakeIpcMain();
  const probes = {};
  const service = {
    generate() { throw new Error('unexpected generate'); },
    generate_approved_plan() { throw new Error('unexpected approved plan generate'); },
    async propose_plan(body) {
      probes.proposePlanBody = body;
      return { result_kind: 'plan' };
    },
    submit() { throw new Error('unexpected submit'); },
    retry_generate() { throw new Error('unexpected retry'); },
    answer() { throw new Error('unexpected answer'); },
    restore_draft() { throw new Error('unexpected restore'); },
    reject_draft() { throw new Error('unexpected reject'); },
    cancel() { return { request_id: hostRequestDigest(), cancelled: false }; },
    steer() { return { request_id: hostRequestDigest(), steered: false }; },
    queue_followup() { return { request_id: hostRequestDigest(), queued: false, queued_followup: null }; },
    availability() {
      return {
        version: 'builder-generation-availability.v1',
        available: true,
        reason: 'ready',
        supports_cancel: true,
      };
    },
  };
  const harness = runtimeWithService(service, probes);
  probes.loadCurrent = (body) => {
    harness.context.__readProjectId = body.project_id;
    return vm.runInContext(
      `({
        product_revision_receipt: { project_id: __readProjectId },
        source_tree: {
          files: [
            { path: "src/app.jsx" },
            { path: "index.html" },
            { path: "readme.md" },
            { path: "src/main.jsx" },
            { path: "package.json" }
          ]
        }
      })`,
      harness.context,
    );
  };
  const runtime = harness.createRuntime({
    fetchImpl: unreachableFetch,
    grantPermissionForExplicitApproval,
    ipcMain,
    mainWindow,
    userDataPath: temporaryUserData(t),
  });
  runtime.register();

  const openRequest = vm.runInContext(
    `({ project_id: "${PROJECT_ID}" })`,
    harness.context,
  );
  const planRequest = vm.runInContext(
    '({ instruction: "Plan a saved React project update." })',
    harness.context,
  );
  await ipcMain.handlers.get(OPEN_PROJECT_CHANNEL)({ sender: mainWindow.webContents }, openRequest);
  assert.deepEqual(
    await ipcMain.handlers.get(PROPOSE_PLAN_CHANNEL)(
      { sender: mainWindow.webContents },
      planRequest,
    ),
    { result_kind: 'plan' },
  );
  assert.deepEqual(Array.from(probes.proposePlanBody.resource_ids), [
    'project:/index.html',
    'project:/package.json',
    'project:/readme.md',
    'project:/src/app.jsx',
    'project:/src/main.jsx',
  ]);
  assert.equal(probes.proposePlanBody.request.existing_project_id, PROJECT_ID);
  assert.equal(
    probes.proposePlanBody.request.request_digest,
    hostRequestDigest('Plan a saved React project update.', PROJECT_ID),
  );
  runtime.dispose();
});

test('allows a first plan proposal for an empty selected source folder', async (t) => {
  const mainWindow = activeWindow();
  const ipcMain = fakeIpcMain();
  const probes = {};
  const service = {
    generate() { throw new Error('unexpected generate'); },
    generate_approved_plan() { throw new Error('unexpected approved plan generate'); },
    async propose_plan(body) {
      probes.proposePlanBody = body;
      return { result_kind: 'plan' };
    },
    submit() { throw new Error('unexpected submit'); },
    retry_generate() { throw new Error('unexpected retry'); },
    answer() { throw new Error('unexpected answer'); },
    restore_draft() { throw new Error('unexpected restore'); },
    reject_draft() { throw new Error('unexpected reject'); },
    cancel() { return { request_id: hostRequestDigest(), cancelled: false }; },
    steer() { return { request_id: hostRequestDigest(), steered: false }; },
    queue_followup() { return { request_id: hostRequestDigest(), queued: false, queued_followup: null }; },
    availability() {
      return {
        version: 'builder-generation-availability.v1',
        available: true,
        reason: 'ready',
        supports_cancel: true,
      };
    },
  };
  const harness = runtimeWithService(service, probes);
  probes.loadCurrent = (body) => {
    harness.context.__readProjectId = body.project_id;
    return vm.runInContext(
      `({
        product_revision_receipt: { project_id: __readProjectId },
        source_tree: { files: [] }
      })`,
      harness.context,
    );
  };
  const runtime = harness.createRuntime({
    fetchImpl: unreachableFetch,
    grantPermissionForExplicitApproval,
    ipcMain,
    mainWindow,
    userDataPath: temporaryUserData(t),
  });
  runtime.register();

  await ipcMain.handlers.get(OPEN_PROJECT_CHANNEL)(
    { sender: mainWindow.webContents },
    vm.runInContext(`({ project_id: "${PROJECT_ID}" })`, harness.context),
  );
  await ipcMain.handlers.get(PROPOSE_PLAN_CHANNEL)(
    { sender: mainWindow.webContents },
    vm.runInContext('({ instruction: "Plan my empty static blog project." })', harness.context),
  );

  assert.deepEqual(Array.from(probes.proposePlanBody.resource_ids), []);
  assert.equal(probes.proposePlanBody.request.existing_project_id, PROJECT_ID);
  runtime.dispose();
});

test('proposes a plan for a newly bound local workspace before the first saved revision', async (t) => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'clawfabric-builder-plan-workspace-'));
  const selectedProjectRootPath = fs.realpathSync.native(projectRoot);
  t.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));

  const mainWindow = activeWindow();
  const ipcMain = fakeIpcMain();
  const probes = {};
  const service = {
    generate() { throw new Error('unexpected generate'); },
    generate_approved_plan() { throw new Error('unexpected approved plan generate'); },
    async propose_plan(body) {
      probes.proposePlanBody = body;
      return { result_kind: 'plan' };
    },
    submit() { throw new Error('unexpected submit'); },
    retry_generate() { throw new Error('unexpected retry'); },
    answer() { throw new Error('unexpected answer'); },
    restore_draft() { throw new Error('unexpected restore'); },
    reject_draft() { throw new Error('unexpected reject'); },
    cancel() { return { request_id: hostRequestDigest(), cancelled: false }; },
    steer() { return { request_id: hostRequestDigest(), steered: false }; },
    queue_followup() { return { request_id: hostRequestDigest(), queued: false, queued_followup: null }; },
    availability() {
      return {
        version: 'builder-generation-availability.v1',
        available: true,
        reason: 'ready',
        supports_cancel: true,
      };
    },
  };
  const harness = runtimeWithService(service, probes);
  probes.loadCurrent = () => {
    const error = new Error('missing current revision');
    error.code = 'builder_project_read_not_found';
    throw error;
  };
  harness.context.__selectedProjectRootPath = selectedProjectRootPath;
  const runtime = harness.createRuntime({
    fetchImpl: unreachableFetch,
    grantPermissionForExplicitApproval,
    ipcMain,
    mainWindow,
    userDataPath: temporaryUserData(t),
    showOpenDialog: async () => vm.runInContext(
      '({ canceled: false, filePaths: [__selectedProjectRootPath] })',
      harness.context,
    ),
  });
  runtime.register();

  const selected = await ipcMain.handlers.get(CREATE_LOCAL_PROJECT_CHANNEL)(
    { sender: mainWindow.webContents },
    vm.runInContext('({ project_id: null, project_title: "New project" })', harness.context),
  );
  fs.writeFileSync(path.join(selectedProjectRootPath, 'index.html'), '<main>Local plan workspace</main>\n');
  let approvalStatus;
  try {
    approvalStatus = await ipcMain.handlers.get(PREPARE_PLAN_SOURCE_READ_APPROVAL_CHANNEL)(
      { sender: mainWindow.webContents },
      vm.runInContext(`({ project_id: ${JSON.stringify(selected.project_id)} })`, harness.context),
    );
  } catch (error) {
    assert.fail(`plan source-read approval failed: ${error.code ?? error.message}`);
  }
  let proposal;
  try {
    proposal = await ipcMain.handlers.get(PROPOSE_PLAN_CHANNEL)(
      { sender: mainWindow.webContents },
      vm.runInContext('({ instruction: "Plan a technical blog." })', harness.context),
    );
  } catch (error) {
    assert.fail(`plan proposal failed: ${error.code ?? error.message}`);
  }

  assert.deepEqual(JSON.parse(JSON.stringify(approvalStatus)), {
    result_version: 'builder-plan-source-read-approval-status.v1',
    project_id: selected.project_id,
    state: 'approval_required',
    file_count: 1,
    approval_scope: 'current_project_plan_source_read',
    authority: 'main_selected_project_bounded_filesystem_read_v1',
  });
  assert.deepEqual(JSON.parse(JSON.stringify(proposal)), { result_kind: 'plan' });
  assert.deepEqual(Array.from(probes.proposePlanBody.resource_ids), ['project:/index.html']);
  assert.equal(probes.proposePlanBody.request.existing_project_id, selected.project_id);
  assert.equal(JSON.stringify(approvalStatus).includes(selectedProjectRootPath), false);
  runtime.dispose();
});

test('prepares and records bounded plan source-read approval without renderer resource authority', async (t) => {
  const mainWindow = activeWindow();
  const ipcMain = fakeIpcMain();
  const probes = {};
  const service = {
    generate() { throw new Error('unexpected generate'); },
    generate_approved_plan() { throw new Error('unexpected approved plan generate'); },
    propose_plan() { throw new Error('unexpected plan before approval'); },
    submit() { throw new Error('unexpected submit'); },
    retry_generate() { throw new Error('unexpected retry'); },
    answer() { throw new Error('unexpected answer'); },
    restore_draft() { throw new Error('unexpected restore'); },
    reject_draft() { throw new Error('unexpected reject'); },
    cancel() { return { request_id: hostRequestDigest(), cancelled: false }; },
    steer() { return { request_id: hostRequestDigest(), steered: false }; },
    queue_followup() { return { request_id: hostRequestDigest(), queued: false, queued_followup: null }; },
    availability() {
      return {
        version: 'builder-generation-availability.v1',
        available: true,
        reason: 'ready',
        supports_cancel: true,
      };
    },
  };
  const grantCalls = [];
  const harness = runtimeWithService(service, probes);
  probes.loadCurrent = (body) => {
    harness.context.__readProjectId = body.project_id;
    return vm.runInContext(
      `({
        product_revision_receipt: { project_id: __readProjectId },
        source_tree: {
          files: [
            { path: "src/app.jsx" },
            { path: "index.html" },
            { path: "readme.md" }
          ]
        }
      })`,
      harness.context,
    );
  };
  const runtime = harness.createRuntime({
    fetchImpl: unreachableFetch,
    grantPermissionForExplicitApproval: async (body) => {
      grantCalls.push(body);
      harness.context.__grantProjectId = body.project_id;
      harness.context.__grantAction = body.action;
      harness.context.__grantResourceKind = body.resource_kind;
      harness.context.__grantResourceId = body.resource_id;
      return vm.runInContext(
        `({
          result_version: "builder-permission-grant-result.v1",
          project_id: __grantProjectId,
          action: __grantAction,
          resource: {
            resource_kind: __grantResourceKind,
            project_id: __grantProjectId,
            resource_id: __grantResourceId
          },
          operation: "grant_recorded",
          ui_selection_authority: "main_owned_explicit_user_approval_required"
        })`,
        harness.context,
      );
    },
    ipcMain,
    mainWindow,
    userDataPath: temporaryUserData(t),
  });
  runtime.register();

  await ipcMain.handlers.get(OPEN_PROJECT_CHANNEL)(
    { sender: mainWindow.webContents },
    vm.runInContext(`({ project_id: "${PROJECT_ID}" })`, harness.context),
  );
  const approvalRequest = vm.runInContext(`({ project_id: "${PROJECT_ID}" })`, harness.context);
  const status = await ipcMain.handlers.get(PREPARE_PLAN_SOURCE_READ_APPROVAL_CHANNEL)(
    { sender: mainWindow.webContents },
    approvalRequest,
  );
  assert.deepEqual(JSON.parse(JSON.stringify(status)), {
    result_version: 'builder-plan-source-read-approval-status.v1',
    project_id: PROJECT_ID,
    state: 'approval_required',
    file_count: 3,
    approval_scope: 'current_project_plan_source_read',
    authority: 'main_selected_project_bounded_filesystem_read_v1',
  });
  assert.deepEqual(probes.permissionEvaluateRequests.map((entry) => entry.resource.resource_id), [
    'project:/index.html',
    'project:/readme.md',
    'project:/src/app.jsx',
  ]);

  const approved = await ipcMain.handlers.get(APPROVE_PLAN_SOURCE_READ_CHANNEL)(
    { sender: mainWindow.webContents },
    approvalRequest,
  );

  assert.deepEqual(grantCalls.map((entry) => entry.resource_id), [
    'project:/index.html',
    'project:/readme.md',
    'project:/src/app.jsx',
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(approved)), {
    result_version: 'builder-plan-source-read-approval-result.v1',
    project_id: PROJECT_ID,
    operation: 'approval_recorded',
    file_count: 3,
    approval_scope: 'current_project_plan_source_read',
    authority: 'main_selected_project_bounded_filesystem_read_v1',
  });
  assert.doesNotMatch(JSON.stringify(approved), /permission_id|resource_id|source_tree|credential|provider/iu);
  runtime.dispose();
});

test('does not require plan source-read approval before planning an empty selected source folder', async (t) => {
  const mainWindow = activeWindow();
  const ipcMain = fakeIpcMain();
  const probes = {};
  const service = {
    generate() { throw new Error('unexpected generate'); },
    generate_approved_plan() { throw new Error('unexpected approved plan generate'); },
    propose_plan() { throw new Error('unexpected plan before approval'); },
    submit() { throw new Error('unexpected submit'); },
    retry_generate() { throw new Error('unexpected retry'); },
    answer() { throw new Error('unexpected answer'); },
    restore_draft() { throw new Error('unexpected restore'); },
    reject_draft() { throw new Error('unexpected reject'); },
    cancel() { return { request_id: hostRequestDigest(), cancelled: false }; },
    steer() { return { request_id: hostRequestDigest(), steered: false }; },
    queue_followup() { return { request_id: hostRequestDigest(), queued: false, queued_followup: null }; },
    availability() {
      return {
        version: 'builder-generation-availability.v1',
        available: true,
        reason: 'ready',
        supports_cancel: true,
      };
    },
  };
  const grantCalls = [];
  const harness = runtimeWithService(service, probes);
  probes.loadCurrent = (body) => {
    harness.context.__readProjectId = body.project_id;
    return vm.runInContext(
      `({
        product_revision_receipt: { project_id: __readProjectId },
        source_tree: { files: [] }
      })`,
      harness.context,
    );
  };
  const runtime = harness.createRuntime({
    fetchImpl: unreachableFetch,
    grantPermissionForExplicitApproval: async (body) => {
      grantCalls.push(body);
      return grantPermissionForExplicitApproval(body);
    },
    ipcMain,
    mainWindow,
    userDataPath: temporaryUserData(t),
  });
  runtime.register();

  await ipcMain.handlers.get(OPEN_PROJECT_CHANNEL)(
    { sender: mainWindow.webContents },
    vm.runInContext(`({ project_id: "${PROJECT_ID}" })`, harness.context),
  );
  const approvalRequest = vm.runInContext(`({ project_id: "${PROJECT_ID}" })`, harness.context);
  const status = await ipcMain.handlers.get(PREPARE_PLAN_SOURCE_READ_APPROVAL_CHANNEL)(
    { sender: mainWindow.webContents },
    approvalRequest,
  );
  const approved = await ipcMain.handlers.get(APPROVE_PLAN_SOURCE_READ_CHANNEL)(
    { sender: mainWindow.webContents },
    approvalRequest,
  );

  assert.deepEqual(JSON.parse(JSON.stringify(status)), {
    result_version: 'builder-plan-source-read-approval-status.v1',
    project_id: PROJECT_ID,
    state: 'ready',
    file_count: 0,
    approval_scope: 'current_project_plan_source_read',
    authority: 'main_selected_project_bounded_filesystem_read_v1',
  });
  assert.deepEqual(JSON.parse(JSON.stringify(approved)), {
    result_version: 'builder-plan-source-read-approval-result.v1',
    project_id: PROJECT_ID,
    operation: 'already_approved',
    file_count: 0,
    approval_scope: 'current_project_plan_source_read',
    authority: 'main_selected_project_bounded_filesystem_read_v1',
  });
  assert.deepEqual(probes.permissionEvaluateRequests ?? [], []);
  assert.deepEqual(grantCalls, []);
  runtime.dispose();
});

test('requires explicit current-project write approval before build-side generation', async (t) => {
  const mainWindow = activeWindow();
  const ipcMain = fakeIpcMain();
  const grantCalls = [];
  const submitted = [];
  let harness;
  const service = {
    submit(body) {
      submitted.push(body);
      return Promise.resolve({ request_id: body.request_digest });
    },
    cancel() { return { cancelled: false }; },
    availability() {
      return { version: 'builder-generation-availability.v1', available: true, reason: 'ready', supports_cancel: true };
    },
  };
  const probes = {
    taskAddress: {
      task_address_id: TASK_ADDRESS_ID,
      project_id: PROJECT_ID,
      conversation_id: CONVERSATION_ID,
    },
    permissionDecision(request) {
      if (request.action !== 'project.edit') return 'allowed';
      return grantCalls.length > 0 ? 'allowed' : 'denied';
    },
  };
  harness = runtimeWithService(service, probes);
  const runtime = harness.createRuntime({
    fetchImpl: unreachableFetch,
    grantPermissionForExplicitApproval: async (body) => {
      grantCalls.push(body);
      harness.context.__grantProjectId = body.project_id;
      harness.context.__grantAction = body.action;
      harness.context.__grantResourceKind = body.resource_kind;
      harness.context.__grantResourceId = body.resource_id;
      return vm.runInContext(
        `({
          result_version: "builder-permission-grant-result.v1",
          project_id: __grantProjectId,
          action: __grantAction,
          resource: {
            resource_kind: __grantResourceKind,
            project_id: __grantProjectId,
            resource_id: __grantResourceId
          },
          operation: "grant_recorded",
          ui_selection_authority: "main_owned_explicit_user_approval_required"
        })`,
        harness.context,
      );
    },
    ipcMain,
    mainWindow,
    userDataPath: temporaryUserData(t),
  });
  runtime.register();

  await ipcMain.handlers.get(OPEN_PROJECT_CHANNEL)(
    { sender: mainWindow.webContents },
    vm.runInContext(`({ project_id: "${PROJECT_ID}" })`, harness.context),
  );
  const approvalRequest = vm.runInContext(`({
    project_id: "${PROJECT_ID}",
    task_address_id: "${TASK_ADDRESS_ID}"
  })`, harness.context);
  const status = await ipcMain.handlers.get(PREPARE_CURRENT_PROJECT_WRITE_APPROVAL_CHANNEL)(
    { sender: mainWindow.webContents },
    approvalRequest,
  );
  assert.deepEqual(JSON.parse(JSON.stringify(status)), {
    result_version: 'builder-current-project-write-approval-status.v1',
    project_id: PROJECT_ID,
    state: 'approval_required',
    approval_scope: 'current_project_write',
    authority: 'main_selected_project_project_edit_v1',
  });
  assert.equal(harness.context.__taskAttentionStore.records.length, 1);
  assert.equal(harness.context.__taskAttentionStore.records[0].state, 'waiting_permission');
  assert.equal(harness.context.__taskAttentionStore.records[0].reason_code, 'current_project_write');
  assert.equal(harness.context.__taskAttentionStore.records[0].revision, 1);
  await assert.rejects(
    async () => ipcMain.handlers.get(SUBMIT_CHANNEL)(
      { sender: mainWindow.webContents },
      vm.runInContext('({ instruction: "Make a timer." })', harness.context),
    ),
    { code: 'builder_generation_project_write_permission_required' },
  );
  assert.deepEqual(submitted, []);

  const approved = await ipcMain.handlers.get(APPROVE_CURRENT_PROJECT_WRITE_CHANNEL)(
    { sender: mainWindow.webContents },
    approvalRequest,
  );
  assert.deepEqual(JSON.parse(JSON.stringify(grantCalls)), [{
    project_id: PROJECT_ID,
    action: 'project.edit',
    resource_kind: 'project',
    resource_id: 'project:self',
  }]);
  assert.deepEqual(JSON.parse(JSON.stringify(approved)), {
    result_version: 'builder-current-project-write-approval-result.v1',
    project_id: PROJECT_ID,
    operation: 'approval_recorded',
    approval_scope: 'current_project_write',
    authority: 'main_selected_project_project_edit_v1',
  });
  assert.equal(harness.context.__taskAttentionStore.records.length, 2);
  assert.equal(harness.context.__taskAttentionStore.records[1].state, 'ready');
  assert.equal(harness.context.__taskAttentionStore.records[1].reason_code, 'resolved');
  assert.equal(harness.context.__taskAttentionStore.records[1].revision, 2);
  assert.doesNotMatch(JSON.stringify(approved), /permission_id|source_tree|credential|provider/iu);

  await ipcMain.handlers.get(SUBMIT_CHANNEL)(
    { sender: mainWindow.webContents },
    vm.runInContext('({ instruction: "Make a timer." })', harness.context),
  );
  assert.equal(submitted.length, 1);
  assert.equal(submitted[0].existing_project_id, PROJECT_ID);
  runtime.dispose();
});

test('serializes same-project task writers and clears durable resource attention after retry', async (t) => {
  const mainWindow = activeWindow();
  const ipcMain = fakeIpcMain();
  const submitted = [];
  let releaseFirst;
  const firstCompletion = new Promise((resolve) => { releaseFirst = resolve; });
  const service = {
    submit(body) {
      submitted.push(body);
      return submitted.length === 1
        ? firstCompletion.then(() => ({ request_id: body.request_digest }))
        : Promise.resolve({ request_id: body.request_digest });
    },
    cancel() { return { cancelled: false }; },
    availability() {
      return { version: 'builder-generation-availability.v1', available: true, reason: 'ready', supports_cancel: true };
    },
  };
  const taskAddresses = new Map([
    [TASK_ADDRESS_ID, {
      task_address_id: TASK_ADDRESS_ID,
      project_id: PROJECT_ID,
      conversation_id: CONVERSATION_ID,
    }],
    [SECOND_TASK_ADDRESS_ID, {
      task_address_id: SECOND_TASK_ADDRESS_ID,
      project_id: PROJECT_ID,
      conversation_id: CONVERSATION_ID,
    }],
  ]);
  const harness = runtimeWithService(service, {
    taskAddresses,
    permissionDecision: () => 'allowed',
  });
  const runtime = harness.createRuntime({
    fetchImpl: unreachableFetch,
    grantPermissionForExplicitApproval,
    ipcMain,
    mainWindowRef: () => mainWindow,
    userDataPath: temporaryUserData(t),
  });
  runtime.register();
  await ipcMain.handlers.get(OPEN_PROJECT_CHANNEL)(
    { sender: mainWindow.webContents },
    vm.runInContext(`({ project_id: "${PROJECT_ID}" })`, harness.context),
  );

  const first = ipcMain.handlers.get(SUBMIT_CHANNEL)(
    { sender: mainWindow.webContents },
    vm.runInContext(`({ instruction: "First change", task_address_id: "${TASK_ADDRESS_ID}" })`, harness.context),
  );
  await waitForProbe(() => submitted.length === 1);
  await assert.rejects(
    () => ipcMain.handlers.get(SUBMIT_CHANNEL)(
      { sender: mainWindow.webContents },
      vm.runInContext(`({ instruction: "Second change", task_address_id: "${SECOND_TASK_ADDRESS_ID}" })`, harness.context),
    ),
    { code: 'builder_generation_project_busy', retryable: true },
  );
  assert.equal(submitted.length, 1);
  assert.equal(harness.context.__taskAttentionStore.records.at(-1).state, 'waiting_resource');
  assert.equal(harness.context.__taskAttentionStore.records.at(-1).reason_code, 'project_busy');

  releaseFirst();
  await first;
  await ipcMain.handlers.get(SUBMIT_CHANNEL)(
    { sender: mainWindow.webContents },
    vm.runInContext(`({ instruction: "Second change", task_address_id: "${SECOND_TASK_ADDRESS_ID}" })`, harness.context),
  );
  assert.equal(submitted.length, 2);
  assert.equal(harness.context.__taskAttentionStore.records.at(-1).state, 'ready');
  assert.equal(harness.context.__taskAttentionStore.records.at(-1).reason_code, 'resolved');
  runtime.dispose();
});

test('binds Workbench task cancellation to the Main-owned active request', async (t) => {
  const mainWindow = activeWindow();
  const ipcMain = fakeIpcMain();
  const submitted = [];
  const cancelled = [];
  let releaseRun;
  const completion = new Promise((resolve) => { releaseRun = resolve; });
  const service = {
    submit(body) {
      submitted.push(body);
      return completion.then(() => ({ request_id: body.request_digest }));
    },
    cancel(body) {
      cancelled.push(body);
      return { request_id: body.request_id, cancelled: cancelled.length > 1 };
    },
    availability() {
      return { version: 'builder-generation-availability.v1', available: true, reason: 'ready', supports_cancel: true };
    },
  };
  const probes = {
    taskAddress: {
      task_address_id: TASK_ADDRESS_ID,
      project_id: PROJECT_ID,
      conversation_id: CONVERSATION_ID,
      agent_id: DEFAULT_BUILDER_AGENT_ID,
    },
    permissionDecision: () => 'allowed',
  };
  const harness = runtimeWithService(service, probes);
  const runtime = harness.createRuntime({
    fetchImpl: unreachableFetch,
    grantPermissionForExplicitApproval,
    ipcMain,
    mainWindowRef: () => mainWindow,
    userDataPath: temporaryUserData(t),
  });
  runtime.register();
  await ipcMain.handlers.get(OPEN_PROJECT_CHANNEL)(
    { sender: mainWindow.webContents },
    vm.runInContext(`({ project_id: "${PROJECT_ID}" })`, harness.context),
  );

  const running = ipcMain.handlers.get(SUBMIT_CHANNEL)(
    { sender: mainWindow.webContents },
    vm.runInContext(`({ instruction: "Long change", task_address_id: "${TASK_ADDRESS_ID}" })`, harness.context),
  );
  await waitForProbe(() => submitted.length === 1);
  assert.deepEqual(
    JSON.parse(JSON.stringify(probes.workbenchTaskMonitorOptions.read_task_controls({
      project_id: PROJECT_ID,
      task_address_id: TASK_ADDRESS_ID,
    }))),
    ['cancel_task'],
  );
  assert.throws(
    () => ipcMain.handlers.get(ANSWER_CHANNEL)(
      { sender: mainWindow.webContents },
      vm.runInContext(`({ instruction: "Duplicate turn", task_address_id: "${TASK_ADDRESS_ID}" })`, harness.context),
    ),
    { code: 'builder_generation_project_busy', retryable: true },
  );
  assert.equal(harness.context.__taskAttentionStore.records.at(-1).reason_code, 'concurrency_limit');

  const rejected = await ipcMain.handlers.get(CONTROL_WORKBENCH_TASK_CHANNEL)(
    { sender: mainWindow.webContents },
    vm.runInContext(`({
      agent_id: "${DEFAULT_BUILDER_AGENT_ID}",
      project_id: "${PROJECT_ID}",
      task_address_id: "${TASK_ADDRESS_ID}",
      operation: "cancel_task"
    })`, harness.context),
  );
  assert.equal(rejected.operation, 'task_not_active');
  assert.deepEqual(
    JSON.parse(JSON.stringify(probes.workbenchTaskMonitorOptions.read_task_controls({
      project_id: PROJECT_ID,
      task_address_id: TASK_ADDRESS_ID,
    }))),
    ['cancel_task'],
  );

  const result = await ipcMain.handlers.get(CONTROL_WORKBENCH_TASK_CHANNEL)(
    { sender: mainWindow.webContents },
    vm.runInContext(`({
      agent_id: "${DEFAULT_BUILDER_AGENT_ID}",
      project_id: "${PROJECT_ID}",
      task_address_id: "${TASK_ADDRESS_ID}",
      operation: "cancel_task"
    })`, harness.context),
  );
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    result_version: 'builder-workbench-task-control-result.v1',
    operation: 'cancel_requested',
    project_id: PROJECT_ID,
    task_address_id: TASK_ADDRESS_ID,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(cancelled)), [
    { request_id: submitted[0].request_digest },
    { request_id: submitted[0].request_digest },
  ]);
  assert.deepEqual(
    JSON.parse(JSON.stringify(probes.workbenchTaskMonitorOptions.read_task_controls({
      project_id: PROJECT_ID,
      task_address_id: TASK_ADDRESS_ID,
    }))),
    [],
  );

  releaseRun();
  await running;
  runtime.dispose();
});

test('releases active task authority and the project lease when terminal attention projection fails', async (t) => {
  const mainWindow = activeWindow();
  const ipcMain = fakeIpcMain();
  const submitted = [];
  let failTerminalAttention = false;
  let releaseFirst;
  const firstCompletion = new Promise((resolve) => { releaseFirst = resolve; });
  const service = {
    submit(body) {
      submitted.push(body);
      return submitted.length === 1
        ? firstCompletion.then(() => ({ request_id: body.request_digest }))
        : Promise.resolve({ request_id: body.request_digest });
    },
    cancel() { return { cancelled: false }; },
    availability() {
      return { version: 'builder-generation-availability.v1', available: true, reason: 'ready', supports_cancel: true };
    },
  };
  const taskAddresses = new Map([
    [TASK_ADDRESS_ID, {
      task_address_id: TASK_ADDRESS_ID,
      project_id: PROJECT_ID,
      conversation_id: CONVERSATION_ID,
    }],
    [SECOND_TASK_ADDRESS_ID, {
      task_address_id: SECOND_TASK_ADDRESS_ID,
      project_id: PROJECT_ID,
      conversation_id: CONVERSATION_ID,
    }],
  ]);
  const probes = {
    permissionDecision: () => 'allowed',
    taskAddresses,
    onRecordTaskAttention(attention) {
      if (failTerminalAttention && attention.state === 'ready') {
        throw new Error('projection unavailable');
      }
    },
  };
  const harness = runtimeWithService(service, probes);
  const runtime = harness.createRuntime({
    fetchImpl: unreachableFetch,
    grantPermissionForExplicitApproval,
    ipcMain,
    mainWindowRef: () => mainWindow,
    userDataPath: temporaryUserData(t),
  });
  runtime.register();
  await ipcMain.handlers.get(OPEN_PROJECT_CHANNEL)(
    { sender: mainWindow.webContents },
    vm.runInContext(`({ project_id: "${PROJECT_ID}" })`, harness.context),
  );

  const first = ipcMain.handlers.get(SUBMIT_CHANNEL)(
    { sender: mainWindow.webContents },
    vm.runInContext(`({ instruction: "First change", task_address_id: "${TASK_ADDRESS_ID}" })`, harness.context),
  );
  await waitForProbe(() => submitted.length === 1);
  failTerminalAttention = true;
  releaseFirst();
  await first;

  assert.deepEqual(
    JSON.parse(JSON.stringify(probes.workbenchTaskMonitorOptions.read_task_controls({
      project_id: PROJECT_ID,
      task_address_id: TASK_ADDRESS_ID,
    }))),
    [],
  );

  failTerminalAttention = false;
  await ipcMain.handlers.get(SUBMIT_CHANNEL)(
    { sender: mainWindow.webContents },
    vm.runInContext(`({ instruction: "Second change", task_address_id: "${SECOND_TASK_ADDRESS_ID}" })`, harness.context),
  );
  assert.equal(submitted.length, 2);
  runtime.dispose();
});

test('carries queued follow-up references through selected-project submit IPC', async (t) => {
  const mainWindow = activeWindow();
  const ipcMain = fakeIpcMain();
  const queuedSubmits = [];
  const service = {
    submit() { throw new Error('unexpected plain submit'); },
    submit_queued_followup(body) {
      queuedSubmits.push(body);
      return Promise.resolve({ request_id: body.request.request_digest });
    },
    cancel() { return { cancelled: false }; },
    availability() {
      return { version: 'builder-generation-availability.v1', available: true, reason: 'ready', supports_cancel: true };
    },
  };
  const harness = runtimeWithService(service, {
    permissionDecision() { return 'allowed'; },
  });
  const runtime = harness.createRuntime({
    fetchImpl: unreachableFetch,
    grantPermissionForExplicitApproval,
    ipcMain,
    mainWindow,
    userDataPath: temporaryUserData(t),
  });
  runtime.register();

  await ipcMain.handlers.get(OPEN_PROJECT_CHANNEL)(
    { sender: mainWindow.webContents },
    vm.runInContext(`({ project_id: ${JSON.stringify(PROJECT_ID)} })`, harness.context),
  );
  await ipcMain.handlers.get(SUBMIT_CHANNEL)(
    { sender: mainWindow.webContents },
    vm.runInContext(`({
      instruction: "Create the improved page.",
      queued_followup: {
        turn_id: "builder-turn:123e4567-e89b-42d3-a456-426614174000",
        run_id: "builder-run:123e4567-e89b-42d3-a456-426614174002",
        message_id: "builder-message:123e4567-e89b-42d3-a456-426614174088"
      }
    })`, harness.context),
  );

  assert.equal(queuedSubmits.length, 1);
  assert.equal(queuedSubmits[0].request.instruction, 'Create the improved page.');
  assert.equal(queuedSubmits[0].request.existing_project_id, PROJECT_ID);
  assert.equal(queuedSubmits[0].queued_followup.message_id, 'builder-message:123e4567-e89b-42d3-a456-426614174088');
  assert.doesNotMatch(
    JSON.stringify(queuedSubmits[0]),
    /source_tree|credential|provider|git_candidate_receipt|tree_oid/iu,
  );
  runtime.dispose();
});

test('publishes typed durable task stream change events to the active renderer', async (t) => {
  const mainWindow = activeWindow();
  const ipcMain = fakeIpcMain();
  const probes = {};
  const service = {
    generate() { throw new Error('unexpected generate'); },
    async submit() {
      probes.conversationOptions.onTaskStreamChanged(Object.assign(Object.create(null), {
        event_version: 'builder-task-stream-changed.v2',
        project_id: PROJECT_ID,
        change_kind: 'live_only',
        cursor: 11,
      }));
      probes.conversationOptions.onTaskStreamChanged(Object.assign(Object.create(null), {
        event_version: 'builder-task-stream-changed.v2',
        project_id: PROJECT_ID,
        change_kind: 'runtime_append',
        cursor: 12,
      }));
      probes.conversationOptions.onTaskStreamChanged(Object.assign(Object.create(null), {
        event_version: 'builder-task-stream-changed.v2',
        project_id: PROJECT_ID,
        change_kind: 'durable_append',
        cursor: 13,
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
    grantPermissionForExplicitApproval,
    ipcMain,
    mainWindow,
    userDataPath: temporaryUserData(t),
  });
  runtime.register();

  await ipcMain.handlers.get(OPEN_PROJECT_CHANNEL)(
    { sender: mainWindow.webContents },
    vm.runInContext(`({ project_id: ${JSON.stringify(PROJECT_ID)} })`, harness.context),
  );
  await ipcMain.handlers.get(SUBMIT_CHANNEL)(
    { sender: mainWindow.webContents },
    vm.runInContext('({ instruction: "Make a timer." })', harness.context),
  );

  assert.equal(mainWindow.webContents.sent.length, 4);
  const taskStreamChangedEvents = mainWindow.webContents.sent.filter(
    (event) => event.channel === TASK_STREAM_CHANGED_CHANNEL,
  );
  assert.equal(taskStreamChangedEvents.length, 3);
  assert.equal(taskStreamChangedEvents[0].payload.change_kind, 'live_only');
  assert.equal(taskStreamChangedEvents[0].payload.cursor, 11);
  assert.equal(taskStreamChangedEvents[1].payload.change_kind, 'runtime_append');
  assert.equal(taskStreamChangedEvents[1].payload.cursor, 12);
  const taskStreamChanged = taskStreamChangedEvents[2];
  const workbenchChanged = mainWindow.webContents.sent.find(
    (event) => event.channel === WORKBENCH_CHANGED_CHANNEL,
  );
  assert.deepEqual(Reflect.ownKeys(taskStreamChanged.payload), [
    'event_version',
    'project_id',
    'change_kind',
    'cursor',
  ]);
  assert.equal(
    taskStreamChanged.payload.event_version,
    'builder-task-stream-changed.v2',
  );
  assert.equal(taskStreamChanged.payload.project_id, PROJECT_ID);
  assert.equal(taskStreamChanged.payload.change_kind, 'durable_append');
  assert.equal(taskStreamChanged.payload.cursor, 13);
  assert.deepEqual(Reflect.ownKeys(workbenchChanged.payload), ['event_version', 'agent_id']);
  assert.equal(workbenchChanged.payload.event_version, 'builder-agent-workbench-changed.v1');
  assert.equal(workbenchChanged.payload.agent_id, DEFAULT_BUILDER_AGENT_ID);
  assert.equal(
    mainWindow.webContents.sent.filter((event) => event.channel === WORKBENCH_CHANGED_CHANNEL).length,
    1,
  );
  assert.deepEqual({ ...probes.workbenchTaskMonitorRequests.at(-1) }, {
    agent_id: DEFAULT_BUILDER_AGENT_ID,
    project_id: PROJECT_ID,
  });
  assert.deepEqual({ ...probes.workbenchTaskMonitorInvalidations.at(-1) }, {
    agent_id: DEFAULT_BUILDER_AGENT_ID,
    project_id: PROJECT_ID,
  });
  runtime.dispose();
});

test('publishes generation started hints to bind live reads without exposing source or credentials', async (t) => {
  const mainWindow = activeWindow();
  const ipcMain = fakeIpcMain();
  const probes = {};
  const requestId = hostRequestDigest('Make a timer.', PROJECT_ID);
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
    grantPermissionForExplicitApproval,
    ipcMain,
    mainWindow,
    userDataPath: temporaryUserData(t),
  });
  runtime.register();

  await ipcMain.handlers.get(OPEN_PROJECT_CHANNEL)(
    { sender: mainWindow.webContents },
    vm.runInContext(`({ project_id: ${JSON.stringify(PROJECT_ID)} })`, harness.context),
  );
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
  const requestId = hostRequestDigest('Make a timer.', PROJECT_ID);
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
      probes.serviceOptions.onProviderOutputDelta(Object.assign(Object.create(null), {
        event_version: 'builder-generation-output-reset.v1',
        request_id: requestId,
        project_id: PROJECT_ID,
        conversation_id: `builder-conversation:${PROJECT_ID.slice('builder-project:'.length)}`,
        turn_id: 'builder-turn:123e4567-e89b-42d3-a456-426614174001',
        task_id: 'builder-task:123e4567-e89b-42d3-a456-426614174002',
        run_id: 'builder-run:123e4567-e89b-42d3-a456-426614174003',
        retain_text_bytes: 0,
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
    grantPermissionForExplicitApproval,
    ipcMain,
    mainWindow,
    userDataPath: temporaryUserData(t),
  });
  runtime.register();

  await ipcMain.handlers.get(OPEN_PROJECT_CHANNEL)(
    { sender: mainWindow.webContents },
    vm.runInContext(`({ project_id: ${JSON.stringify(PROJECT_ID)} })`, harness.context),
  );
  await ipcMain.handlers.get(SUBMIT_CHANNEL)(
    { sender: mainWindow.webContents },
    vm.runInContext('({ instruction: "Make a timer." })', harness.context),
  );

  assert.equal(mainWindow.webContents.sent.length, 2);
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
  assert.equal(mainWindow.webContents.sent[1].channel, GENERATION_OUTPUT_CHANNEL);
  assert.equal(
    mainWindow.webContents.sent[1].payload.event_version,
    'builder-generation-output-reset.v1',
  );
  assert.equal(mainWindow.webContents.sent[1].payload.request_id, requestId);
  assert.equal(mainWindow.webContents.sent[1].payload.project_id, PROJECT_ID);
  assert.equal(mainWindow.webContents.sent[1].payload.retain_text_bytes, 0);
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
    grantPermissionForExplicitApproval,
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
    RESTORE_PREVIOUS_CHECKPOINT_AS_DRAFT_CHANNEL,
    RESTORE_REVISION_AS_DRAFT_CHANNEL,
    RESTORE_DRAFT_CHANNEL,
    ANSWER_DRAFT_CHANNEL,
    ANSWER_CHANNEL,
    RETRY_GENERATE_CHANNEL,
    CLASSIFY_INTENT_CHANNEL,
    SUBMIT_CHANNEL,
    APPROVE_CURRENT_PROJECT_WRITE_CHANNEL,
    PREPARE_CURRENT_PROJECT_WRITE_APPROVAL_CHANNEL,
    APPROVE_PLAN_SOURCE_READ_CHANNEL,
    PREPARE_PLAN_SOURCE_READ_APPROVAL_CHANNEL,
    PROPOSE_PLAN_CHANNEL,
    GENERATE_APPROVED_PLAN_CHANNEL,
    CONTINUE_DRAFT_CHANNEL,
    GENERATE_CHANNEL,
  ]);
  assert.equal(runtime.dispose(), false);

  const removalFailure = fakeIpcMain(CANCEL_CHANNEL, GENERATE_CHANNEL);
  const cleanupRuntime = createBuilderGenerationIpcRuntime({
    fetchImpl: unreachableFetch,
    grantPermissionForExplicitApproval,
    ipcMain: removalFailure,
    mainWindowRef: () => mainWindow,
    userDataPath: temporaryUserData(t),
  });
  assert.throws(() => cleanupRuntime.register(), {
    code: 'builder_generation_ipc_runtime_unavailable',
  });
  assert.equal(removalFailure.handlers.has(GENERATE_CHANNEL), true);
  assert.equal(removalFailure.handlers.has(CONTINUE_DRAFT_CHANNEL), false);
  assert.equal(removalFailure.handlers.has(GENERATE_APPROVED_PLAN_CHANNEL), false);
  assert.equal(removalFailure.handlers.has(PREPARE_PLAN_SOURCE_READ_APPROVAL_CHANNEL), false);
  assert.equal(removalFailure.handlers.has(APPROVE_PLAN_SOURCE_READ_CHANNEL), false);
  assert.equal(removalFailure.handlers.has(PREPARE_CURRENT_PROJECT_WRITE_APPROVAL_CHANNEL), false);
  assert.equal(removalFailure.handlers.has(APPROVE_CURRENT_PROJECT_WRITE_CHANNEL), false);
  assert.equal(removalFailure.handlers.has(SUBMIT_CHANNEL), false);
  assert.equal(removalFailure.handlers.has(RETRY_GENERATE_CHANNEL), false);
  assert.equal(removalFailure.handlers.has(ANSWER_CHANNEL), false);
  assert.equal(removalFailure.handlers.has(ANSWER_DRAFT_CHANNEL), false);
  assert.equal(removalFailure.handlers.has(RESTORE_DRAFT_CHANNEL), false);
  assert.equal(removalFailure.handlers.has(RESTORE_REVISION_AS_DRAFT_CHANNEL), false);
  assert.equal(removalFailure.handlers.has(RESTORE_PREVIOUS_CHECKPOINT_AS_DRAFT_CHANNEL), false);
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
    { fetchImpl: unreachableFetch, grantPermissionForExplicitApproval, ipcMain, mainWindowRef: () => mainWindow, userDataPath: 'relative' },
    {
      fetchImpl: unreachableFetch,
    grantPermissionForExplicitApproval,
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

test('closes the CheckRun store when save-gate composition fails', (t) => {
  const harness = runtimeWithService({
    generate: async () => ({ ok: true }),
    cancel: () => ({ cancelled: false }),
    availability: () => ({ available: false }),
  }, { failCheckRunSaveGate: true });
  assert.throws(
    () => harness.createRuntime({
      fetchImpl: unreachableFetch,
      grantPermissionForExplicitApproval,
      ipcMain: fakeIpcMain(),
      mainWindow: activeWindow(),
      userDataPath: temporaryUserData(t),
    }),
    (error) => error.code === 'builder_generation_ipc_runtime_unavailable'
      && !`${error.message}:${error.stack}`.includes('private'),
  );
  assert.equal(harness.context.__checkRunStore.closed, true);
  assert.equal(harness.context.__draftCheckpointStore.closed, true);
  assert.equal(harness.context.__sessionTaskAddressStore.closed, true);
  assert.equal(harness.context.__projectUnderstandingStore.closed, true);
  assert.equal(harness.context.__taskCapsuleStore.closed, true);
  assert.equal(harness.context.__projectMainAuthority.closed, true);
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
    grantPermissionForExplicitApproval,
    ipcMain,
    mainWindow: activeWindow(),
    userDataPath: temporaryUserData(t),
  });

  assert.equal(harness.context.__projectMainAuthority.closed, false);
  assert.equal(harness.context.__taskCapsuleStore.closed, false);
  assert.equal(harness.context.__sessionTaskAddressStore.closed, false);
  assert.equal(harness.context.__draftCheckpointStore.closed, false);
  assert.equal(harness.context.__checkRunStore.closed, false);
  assert.equal(harness.context.__contextCompactionSummaryStore.closed, false);
  assert.equal(harness.context.__handoffPacketStore.closed, false);
  assert.throws(() => runtime.register(), {
    code: 'builder_generation_ipc_runtime_unavailable',
  });
  assert.deepEqual([...ipcMain.handlers.keys()], []);
  assert.equal(harness.context.__handoffPacketStore.closed, true);
  assert.equal(harness.context.__contextCompactionSummaryStore.closed, true);
  assert.equal(harness.context.__draftCheckpointStore.closed, true);
  assert.equal(harness.context.__checkRunStore.closed, true);
  assert.equal(harness.context.__sessionTaskAddressStore.closed, true);
  assert.equal(harness.context.__projectUnderstandingStore.closed, true);
  assert.equal(harness.context.__taskCapsuleStore.closed, true);
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
    grantPermissionForExplicitApproval,
    ipcMain,
    mainWindow,
    userDataPath,
  });

  assert.equal(probes.projectMainAuthorityOptions.userDataPath, userDataPath);
  assert.deepEqual(Object.keys(probes.projectMainAuthorityOptions), ['userDataPath']);
  assert.equal(probes.taskCapsuleDatabasePath,
    path.join(userDataPath, 'builder-task-capsules-v1', 'task-capsules.sqlite'));
  assert.equal(probes.projectUnderstandingDatabasePath,
    path.join(userDataPath, 'builder-project-understandings-v1', 'understanding.sqlite'));
  assert.equal(probes.sessionTaskAddressDatabasePath,
    path.join(userDataPath, 'builder-session-task-addresses-v2', 'session-task-addresses.sqlite'));
  assert.equal(probes.contextCompactionSummaryDatabasePath,
    path.join(userDataPath, 'builder-context-compaction-summaries-v1', 'context-compaction-summaries.sqlite'));
  assert.equal(probes.handoffPacketDatabasePath,
    path.join(userDataPath, 'builder-handoff-packets-v1', 'handoff-packets.sqlite'));
  assert.equal(probes.taskCapsuleRecordingOptions.task_capsule_store,
    runtimeModule.context.__taskCapsuleStore);
  assert.equal(probes.projectUnderstandingServiceOptions.project_read_authority,
    probes.serviceOptions.projectReadAuthority);
  assert.equal(probes.projectUnderstandingServiceOptions.project_understanding_store,
    runtimeModule.context.__projectUnderstandingStore);
  assert.equal(probes.workingContextStateOptions.task_capsule_store,
    runtimeModule.context.__taskCapsuleStore);
  assert.equal(probes.workingContextStateOptions.session_task_address_store,
    runtimeModule.context.__sessionTaskAddressStore);
  assert.equal(probes.workingContextStateOptions.context_compaction_summary_store,
    runtimeModule.context.__contextCompactionSummaryStore);
  assert.equal(probes.workingContextStateOptions.handoff_packet_store,
    runtimeModule.context.__handoffPacketStore);
  assert.equal(probes.contextCompactionRecordingOptions.context_compaction_summary_store,
    runtimeModule.context.__contextCompactionSummaryStore);
  assert.equal(probes.contextCompactionRecordingOptions.session_task_address_store,
    runtimeModule.context.__sessionTaskAddressStore);
  assert.notEqual(probes.serviceOptions.projectReadAuthority,
    runtimeModule.context.__projectMainAuthority.project_read_authority);
  assert.equal(typeof probes.serviceOptions.projectReadAuthority.load_current, 'function');
  assert.equal(probes.serviceOptions.projectReadAuthority.load_revision,
    runtimeModule.context.__projectMainAuthority.project_read_authority.load_revision);
  assert.equal(probes.serviceOptions.conversationService,
    runtimeModule.context.__conversationService);
  assert.equal(probes.serviceOptions.gitAuthority,
    runtimeModule.context.__projectMainAuthority.git_authority);
  assert.equal(probes.serviceOptions.taskCapsuleStore,
    runtimeModule.context.__taskCapsuleStore);
  assert.equal(probes.serviceOptions.taskCapsuleRecordingService,
    runtimeModule.context.__taskCapsuleRecordingService);
  assert.equal(probes.serviceOptions.projectUnderstandingService,
    runtimeModule.context.__projectUnderstandingService);
  assert.equal(probes.serviceOptions.workingContextStateService,
    runtimeModule.context.__workingContextStateService);
  assert.equal(probes.serviceOptions.providerContextDisclosureDecisionService,
    runtimeModule.context.__providerContextDisclosureDecisionService);
  assert.equal(probes.providerContextDisclosureStatusCreated, 1);
  assert.equal(probes.conversationOptions.providerContextDisclosureStatusService,
    runtimeModule.context.__providerContextDisclosureStatusService);
  assert.equal(probes.serviceOptions.providerContextDisclosureStatusService,
    runtimeModule.context.__providerContextDisclosureStatusService);
  assert.equal(
    runtime.readProviderContextDisclosureStatusServiceForMainOnlyApprovalRuntime(),
    runtimeModule.context.__providerContextDisclosureStatusService,
  );
  assert.equal(
    runtime.readCheckRunCurrentDraftServiceForMainOnlyApprovalRuntime(),
    runtimeModule.context.__checkRunCurrentDraftService,
  );
  assert.equal(
    runtime.readProjectEnvironmentDiagnosisServiceForMainOnlyApprovalRuntime(),
    runtimeModule.context.__projectEnvironmentDiagnosisService,
  );
  assert.equal(probes.projectEnvironmentDiagnosisOptions.project_read_authority.authority_version,
    'builder-project-read-authority.v1');
  assert.equal(probes.checkRunCompositionOptions.user_data_path, userDataPath);
  assert.equal(probes.checkRunCompositionOptions.conversation_service,
    runtimeModule.context.__conversationService);
  assert.equal(probes.checkRunCompositionOptions.git_authority,
    runtimeModule.context.__projectMainAuthority.git_authority);
  assert.equal(probes.checkRunCompositionOptions.check_run_store,
    runtimeModule.context.__checkRunStore);
  assert.equal(probes.checkRunCompositionOptions.check_run_status_service,
    runtimeModule.context.__checkRunStatusService);
  assert.equal(probes.checkRunCompositionOptions.activity_registry,
    runtimeModule.context.__checkRunActivityRegistry);
  assert.equal(typeof probes.checkRunActivityRegistryOptions.on_activity_changed, 'function');
  assert.equal(probes.providerContextDisclosureDecisionOptions.actor_id,
    'builder-user:00000000-0000-4000-8000-000000000001');
  assert.equal(typeof probes.providerContextDisclosureDecisionOptions.evaluate_permission, 'function');
  assert.equal(typeof probes.providerContextDisclosureDecisionOptions.now_ms, 'function');
  const disclosurePermissionDecision = probes.providerContextDisclosureDecisionOptions.evaluate_permission({
    action: 'context.disclose',
    resource: {
      resource_kind: 'provider',
      project_id: PROJECT_ID,
      resource_id: 'provider:configured/contextual_build',
    },
    now_ms: 12345,
  });
  assert.equal(disclosurePermissionDecision.decision, 'denied');
  const permissionEvaluateRequest = probes.permissionEvaluateRequests.at(-1);
  assert.equal(permissionEvaluateRequest.policy_version, BUILDER_PERMISSION_POLICY_VERSION);
  assert.equal(permissionEvaluateRequest.actor_id, 'builder-user:00000000-0000-4000-8000-000000000001');
  assert.equal(permissionEvaluateRequest.action, 'context.disclose');
  assert.equal(permissionEvaluateRequest.resource.resource_kind, 'provider');
  assert.equal(permissionEvaluateRequest.resource.project_id, PROJECT_ID);
  assert.equal(permissionEvaluateRequest.resource.resource_id, 'provider:configured/contextual_build');
  assert.equal(permissionEvaluateRequest.now_ms, 12345);
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
  assert.equal(probes.saveOptions.checkRunSaveGate,
    runtimeModule.context.__checkRunSaveGate);
  assert.equal(typeof runtimeModule.context.__conversationService.read_stream, 'function');
  assert.equal(runtime.dispose(), false);
  assert.throws(
    () => runtime.readCheckRunCurrentDraftServiceForMainOnlyApprovalRuntime(),
    { code: 'builder_generation_ipc_runtime_unavailable' },
  );
  assert.throws(
    () => runtime.readProjectEnvironmentDiagnosisServiceForMainOnlyApprovalRuntime(),
    { code: 'builder_generation_ipc_runtime_unavailable' },
  );
  assert.equal(runtimeModule.context.__handoffPacketStore.closed, true);
  assert.equal(runtimeModule.context.__contextCompactionSummaryStore.closed, true);
  assert.equal(runtimeModule.context.__draftCheckpointStore.closed, true);
  assert.equal(runtimeModule.context.__checkRunStore.closed, true);
  assert.equal(runtimeModule.context.__sessionTaskAddressStore.closed, true);
  assert.equal(runtimeModule.context.__projectUnderstandingStore.closed, true);
  assert.equal(runtimeModule.context.__taskCapsuleStore.closed, true);
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
    grantPermissionForExplicitApproval,
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
    grantPermissionForExplicitApproval,
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
    grantPermissionForExplicitApproval,
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
    grantPermissionForExplicitApproval,
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
    grantPermissionForExplicitApproval,
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

test('restores a saved revision as a draft only for the selected project workspace', async (t) => {
  const restoreRequests = [];
  const runtimeModule = runtimeWithService({
    generate() { throw new Error('unexpected generate'); },
    restore_revision_as_draft(body) {
      restoreRequests.push({ ...body });
      return {
        version: 'builder-generation-result.v2',
        project_id: body.project_id,
        existing_project_id: body.project_id,
        request_id: `sha256:${'e'.repeat(64)}`,
        draft_id: `builder-generation-draft:${'f'.repeat(64)}`,
        restart_restore: 'not_persisted',
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
    grantPermissionForExplicitApproval,
    ipcMain,
    mainWindow,
    userDataPath: temporaryUserData(t),
  });
  runtime.register();
  const revisionDigest = `sha256:${'d'.repeat(64)}`;
  const body = (source) => vm.runInContext(source, runtimeModule.context);

  await assert.rejects(
    async () => ipcMain.handlers.get(RESTORE_REVISION_AS_DRAFT_CHANNEL)(
      { sender: mainWindow.webContents },
      body(`({
        project_id: ${JSON.stringify(PROJECT_ID)},
        revision_receipt_digest: ${JSON.stringify(revisionDigest)}
      })`),
    ),
    { code: 'builder_generation_project_workspace_required' },
  );

  await ipcMain.handlers.get(OPEN_PROJECT_CHANNEL)(
    { sender: mainWindow.webContents },
    body(`({ project_id: ${JSON.stringify(PROJECT_ID)} })`),
  );
  const restored = await ipcMain.handlers.get(RESTORE_REVISION_AS_DRAFT_CHANNEL)(
    { sender: mainWindow.webContents },
    body(`({
      project_id: ${JSON.stringify(PROJECT_ID)},
      revision_receipt_digest: ${JSON.stringify(revisionDigest)}
    })`),
  );
  assert.deepEqual(restored, {
    version: 'builder-generation-result.v2',
    project_id: PROJECT_ID,
    existing_project_id: PROJECT_ID,
    request_id: `sha256:${'e'.repeat(64)}`,
    draft_id: `builder-generation-draft:${'f'.repeat(64)}`,
    restart_restore: 'not_persisted',
  });
  assert.deepEqual(restoreRequests, [{
    project_id: PROJECT_ID,
    revision_receipt_digest: revisionDigest,
  }]);
  assert.equal(Object.hasOwn(restoreRequests[0], 'instruction'), false);
  assert.equal(Object.hasOwn(restoreRequests[0], 'request_digest'), false);
  assert.equal(Object.hasOwn(restoreRequests[0], 'source_tree'), false);

  await assert.rejects(
    async () => ipcMain.handlers.get(RESTORE_REVISION_AS_DRAFT_CHANNEL)(
      { sender: mainWindow.webContents },
      body(`({
        project_id: "builder-project:223e4567-e89b-42d3-a456-426614174000",
        revision_receipt_digest: ${JSON.stringify(revisionDigest)}
      })`),
    ),
    { code: 'builder_generation_project_workspace_required' },
  );
  await assert.rejects(
    async () => ipcMain.handlers.get(RESTORE_REVISION_AS_DRAFT_CHANNEL)(
      { sender: mainWindow.webContents },
      body(`({
        project_id: ${JSON.stringify(PROJECT_ID)},
        revision_receipt_digest: ${JSON.stringify(revisionDigest)},
        source_tree: { files: [] }
      })`),
    ),
    { code: 'builder_generation_ipc_runtime_unavailable' },
  );
  assert.equal(restoreRequests.length, 1);
  runtime.dispose();
});

test('restores the previous checkpoint from a draft id while main supplies the selected project', async (t) => {
  const restoreRequests = [];
  const runtimeModule = runtimeWithService({
    generate() { throw new Error('unexpected generate'); },
    restore_previous_checkpoint_as_draft(body) {
      restoreRequests.push({ ...body });
      return {
        result_version: 'builder-generation-draft-undo-result.v1',
        operation: 'draft_baseline_restored',
        draft_id: body.draft_id,
        project_id: body.project_id,
        pending_draft_released: true,
        conversation_event_admission: 'sqlite_recorded',
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
    grantPermissionForExplicitApproval,
    ipcMain,
    mainWindow,
    userDataPath: temporaryUserData(t),
  });
  runtime.register();
  const draftId = `builder-generation-draft:${'c'.repeat(64)}`;
  const body = (source) => vm.runInContext(source, runtimeModule.context);

  await assert.rejects(
    async () => ipcMain.handlers.get(RESTORE_PREVIOUS_CHECKPOINT_AS_DRAFT_CHANNEL)(
      { sender: mainWindow.webContents },
      body(`({ draft_id: ${JSON.stringify(draftId)} })`),
    ),
    { code: 'builder_generation_project_workspace_required' },
  );
  await ipcMain.handlers.get(OPEN_PROJECT_CHANNEL)(
    { sender: mainWindow.webContents },
    body(`({ project_id: ${JSON.stringify(PROJECT_ID)} })`),
  );
  const restored = await ipcMain.handlers.get(RESTORE_PREVIOUS_CHECKPOINT_AS_DRAFT_CHANNEL)(
    { sender: mainWindow.webContents },
    body(`({ draft_id: ${JSON.stringify(draftId)} })`),
  );

  assert.equal(restored.operation, 'draft_baseline_restored');
  assert.deepEqual(restoreRequests, [{ draft_id: draftId, project_id: PROJECT_ID }]);
  assert.equal(Object.hasOwn(restoreRequests[0], 'source_tree'), false);
  assert.equal(Object.hasOwn(restoreRequests[0], 'checkpoint_id'), false);
  await assert.rejects(
    async () => ipcMain.handlers.get(RESTORE_PREVIOUS_CHECKPOINT_AS_DRAFT_CHANNEL)(
      { sender: mainWindow.webContents },
      body(`({ draft_id: ${JSON.stringify(draftId)}, project_id: ${JSON.stringify(PROJECT_ID)} })`),
    ),
    { code: 'builder_generation_request_invalid' },
  );
  assert.equal(restoreRequests.length, 1);
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
    grantPermissionForExplicitApproval,
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
  const continuedDrafts = [];
  const draftContinuationAdmissions = [];
  const approvedPlanGenerated = [];
  const submitted = [];
  const classified = [];
  const retried = [];
  const answered = [];
  const draftAnswers = [];
  const proposedPlans = [];
  const probes = {
    loadCurrent(body) {
      runtimeModule.context.__readProjectId = body.project_id;
      return vm.runInContext(
        `({
          product_revision_receipt: { project_id: __readProjectId },
          source_tree: {
            files: [
              { path: "src/app.ts" },
              { path: "index.html" },
              { path: "styles/main.css" }
            ]
          }
        })`,
        runtimeModule.context,
      );
    },
  };
  const service = {
    generate(body) {
      generated.push(body);
      return Promise.resolve({ request_id: body.request_digest });
    },
    generate_approved_plan(body) {
      approvedPlanGenerated.push(body);
      return Promise.resolve({ request_id: `sha256:${'d'.repeat(64)}` });
    },
    propose_plan(body) {
      proposedPlans.push(body);
      return Promise.resolve({ request_id: body.request.request_digest });
    },
    submit(body) {
      submitted.push(body);
      return Promise.resolve({ request_id: body.request_digest });
    },
    classify_intent(body) {
      classified.push(body);
      return Promise.resolve({ route: 'plan' });
    },
    prepare_draft_continuation(body) {
      draftContinuationAdmissions.push(body);
      runtimeModule.context.__draftContinuationProjectId = PROJECT_ID;
      return Promise.resolve(vm.runInContext(
        '({ project_id: __draftContinuationProjectId })',
        runtimeModule.context,
      ));
    },
    generate_draft_continuation(body) {
      continuedDrafts.push(body);
      return Promise.resolve({ request_id: hostRequestDigest(body.instruction, PROJECT_ID) });
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
      runtimeModule.context.__answerStartedRequestId = body.request_digest;
      runtimeModule.context.__answerStartedProjectId = body.existing_project_id ?? PROJECT_ID;
      probes.serviceOptions.onGenerationStarted(vm.runInContext(
        `({
          event_version: "builder-generation-started.v1",
          request_id: __answerStartedRequestId,
          project_id: __answerStartedProjectId
        })`,
        runtimeModule.context,
      ));
      return Promise.resolve({
        version: 'builder-generation-result.v2',
        result_kind: 'explanation',
        request_id: body.request_digest,
        project_id: body.existing_project_id ?? PROJECT_ID,
        existing_project_id: body.existing_project_id,
      });
    },
    answer_draft(body) {
      draftAnswers.push(body);
      return Promise.resolve({
        version: 'builder-generation-result.v2',
        result_kind: 'explanation',
        request_id: hostRequestDigest(body.instruction, body.project_id),
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
    grantPermissionForExplicitApproval,
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
  await ipcMain.handlers.get(CLASSIFY_INTENT_CHANNEL)(
    { sender: mainWindow.webContents },
    vm.runInContext('({ instruction: "帮我做一个静态技术博客实施计划" })', runtimeModule.context),
  );
  assert.equal(classified.length, 1);
  assert.equal(classified[0].instruction, '帮我做一个静态技术博客实施计划');
  assert.equal(classified[0].existing_project_id, PROJECT_ID);
  assert.equal(classified[0].task_address_id, null);
  assert.deepEqual(Object.keys(classified[0]).sort(), [
    'existing_project_id',
    'instruction',
    'task_address_id',
  ]);
  await assert.rejects(
    async () => ipcMain.handlers.get(CLASSIFY_INTENT_CHANNEL)(
      { sender: mainWindow.webContents },
      vm.runInContext('({ instruction: "Plan this", source_tree: {} })', runtimeModule.context),
    ),
    { code: 'builder_generation_request_invalid' },
  );
  await ipcMain.handlers.get(CONTINUE_DRAFT_CHANNEL)(
    { sender: mainWindow.webContents },
    vm.runInContext(`({
      draft_id: "builder-generation-draft:${'2'.repeat(64)}",
      instruction: "Keep refining the unsaved draft."
    })`, runtimeModule.context),
  );
  assert.equal(draftContinuationAdmissions.length, 1);
  assert.equal(draftContinuationAdmissions[0].draft_id, `builder-generation-draft:${'2'.repeat(64)}`);
  assert.equal(continuedDrafts.length, 1);
  assert.equal(continuedDrafts[0].draft_id, `builder-generation-draft:${'2'.repeat(64)}`);
  assert.equal(continuedDrafts[0].instruction, 'Keep refining the unsaved draft.');
  assert.equal(Object.hasOwn(continuedDrafts[0], 'existing_project_id'), false);
  assert.equal(Object.hasOwn(continuedDrafts[0], 'request_digest'), false);
  assert.equal(Object.hasOwn(continuedDrafts[0], 'source_tree'), false);
  await ipcMain.handlers.get(CONTINUE_DRAFT_CHANNEL)(
    { sender: mainWindow.webContents },
    vm.runInContext(`({
      draft_id: "builder-generation-draft:${'2'.repeat(64)}",
      instruction: "Run the queued draft follow-up.",
      queued_followup: {
        turn_id: "builder-turn:123e4567-e89b-42d3-a456-426614174000",
        run_id: "builder-run:123e4567-e89b-42d3-a456-426614174000",
        message_id: "builder-message:123e4567-e89b-42d3-a456-426614174088"
      }
    })`, runtimeModule.context),
  );
  assert.deepEqual(JSON.parse(JSON.stringify(continuedDrafts[1].queued_followup)), {
    turn_id: 'builder-turn:123e4567-e89b-42d3-a456-426614174000',
    run_id: 'builder-run:123e4567-e89b-42d3-a456-426614174000',
    message_id: 'builder-message:123e4567-e89b-42d3-a456-426614174088',
  });
  await ipcMain.handlers.get(PROPOSE_PLAN_CHANNEL)(
    { sender: mainWindow.webContents },
    vm.runInContext('({ instruction: "Plan this saved-project change." })', runtimeModule.context),
  );
  assert.equal(proposedPlans.length, 1);
  assert.equal(proposedPlans[0].request.existing_project_id, PROJECT_ID);
  assert.equal(proposedPlans[0].request.instruction, 'Plan this saved-project change.');
  assert.equal(
    proposedPlans[0].request.request_digest,
    hostRequestDigest('Plan this saved-project change.', PROJECT_ID),
  );
  assert.deepEqual([...proposedPlans[0].resource_ids], [
    'project:/index.html',
    'project:/src/app.ts',
    'project:/styles/main.css',
  ]);
  assert.equal(Object.hasOwn(proposedPlans[0].request, 'source_tree'), false);
  assert.equal(Object.hasOwn(proposedPlans[0], 'source_tree'), false);
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
  await ipcMain.handlers.get(ANSWER_DRAFT_CHANNEL)(
    { sender: mainWindow.webContents },
    vm.runInContext(`({
      draft_id: "builder-generation-draft:${'3'.repeat(64)}",
      instruction: "Why is this draft preview blank?"
    })`, runtimeModule.context),
  );
  assert.equal(draftAnswers.length, 1);
  assert.equal(draftAnswers[0].draft_id, `builder-generation-draft:${'3'.repeat(64)}`);
  assert.equal(draftAnswers[0].instruction, 'Why is this draft preview blank?');
  assert.equal(draftAnswers[0].project_id, PROJECT_ID);
  assert.equal(Object.hasOwn(draftAnswers[0], 'request_digest'), false);
  assert.equal(Object.hasOwn(draftAnswers[0], 'source_tree'), false);
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
  assert.deepEqual(Reflect.ownKeys(approvedPlanGenerated[0]).sort(), [
    'request',
    'write_permission_decision',
  ]);
  assert.equal(approvedPlanGenerated[0].request.project_id, PROJECT_ID);
  assert.equal(
    approvedPlanGenerated[0].request.conversation_id,
    'builder-conversation:123e4567-e89b-42d3-a456-426614174000',
  );
  assert.equal(
    approvedPlanGenerated[0].request.turn_id,
    'builder-turn:123e4567-e89b-42d3-a456-426614174001',
  );
  assert.equal(
    approvedPlanGenerated[0].request.run_id,
    'builder-run:123e4567-e89b-42d3-a456-426614174002',
  );
  assert.equal(approvedPlanGenerated[0].write_permission_decision.decision, 'allowed');
  assert.equal(approvedPlanGenerated[0].write_permission_decision.action, 'project.edit');
  assert.equal(approvedPlanGenerated[0].write_permission_decision.resource.project_id, PROJECT_ID);
  assert.equal(Object.hasOwn(approvedPlanGenerated[0].request, 'instruction'), false);
  assert.equal(Object.hasOwn(approvedPlanGenerated[0].request, 'request_digest'), false);
  assert.equal(Object.hasOwn(approvedPlanGenerated[0].request, 'source_tree'), false);
  await assert.rejects(
    async () => ipcMain.handlers.get(PROPOSE_PLAN_CHANNEL)(
      { sender: mainWindow.webContents },
      vm.runInContext(`({
        instruction: "forged plan",
        existing_project_id: ${JSON.stringify(PROJECT_ID)}
      })`, runtimeModule.context),
    ),
    { code: 'builder_generation_request_invalid' },
  );
  await ipcMain.handlers.get(OPEN_PROJECT_CHANNEL)(
    { sender: mainWindow.webContents },
    vm.runInContext('({ project_id: null })', runtimeModule.context),
  );
  await assert.rejects(
    async () => ipcMain.handlers.get(GENERATE_CHANNEL)(
      { sender: mainWindow.webContents },
      vm.runInContext('({ instruction: "Make a fresh timer." })', runtimeModule.context),
    ),
    { code: 'builder_generation_project_workspace_required' },
  );
  assert.equal(generated.length, 1);
  await assert.rejects(
    async () => ipcMain.handlers.get(ANSWER_DRAFT_CHANNEL)(
      { sender: mainWindow.webContents },
      vm.runInContext(`({
        draft_id: "builder-generation-draft:${'4'.repeat(64)}",
        instruction: "Explain this unsaved draft."
      })`, runtimeModule.context),
    ),
    { code: 'builder_generation_project_workspace_required' },
  );
  await ipcMain.handlers.get(ANSWER_CHANNEL)(
    { sender: mainWindow.webContents },
    vm.runInContext('({ instruction: "Explain the fresh project." })', runtimeModule.context),
  );
  assert.equal(answered[1].existing_project_id, null);
  assert.equal(answered[1].request_digest, hostRequestDigest('Explain the fresh project.', null));
  await ipcMain.handlers.get(ANSWER_CHANNEL)(
    { sender: mainWindow.webContents },
    vm.runInContext('({ instruction: "Keep discussing before choosing a folder." })', runtimeModule.context),
  );
  assert.equal(answered[2].existing_project_id, null);
  assert.equal(
    answered[2].request_digest,
    hostRequestDigest('Keep discussing before choosing a folder.', null),
  );
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
    async () => ipcMain.handlers.get(CONTINUE_DRAFT_CHANNEL)(
      { sender: mainWindow.webContents },
      vm.runInContext(`({
        draft_id: "builder-generation-draft:${'2'.repeat(64)}",
        instruction: "forged continuation",
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

test('rejects draft continuation admission for a different selected project before generation', async (t) => {
  const draftContinuationAdmissions = [];
  const continuedDrafts = [];
  let runtimeModule;
  const service = {
    prepare_draft_continuation(body) {
      draftContinuationAdmissions.push(body);
      runtimeModule.context.__draftContinuationProjectId =
        'builder-project:123e4567-e89b-42d3-a456-426614174999';
      return Promise.resolve(vm.runInContext(
        '({ project_id: __draftContinuationProjectId })',
        runtimeModule.context,
      ));
    },
    generate_draft_continuation(body) {
      continuedDrafts.push(body);
      return Promise.resolve({ request_id: hostRequestDigest(body.instruction, PROJECT_ID) });
    },
  };
  runtimeModule = runtimeWithService(service);
  const mainWindow = activeWindow();
  const ipcMain = fakeIpcMain();
  const runtime = runtimeModule.createRuntime({
    fetchImpl: unreachableFetch,
    grantPermissionForExplicitApproval,
    ipcMain,
    mainWindow,
    userDataPath: temporaryUserData(t),
  });
  runtime.register();

  await ipcMain.handlers.get(OPEN_PROJECT_CHANNEL)(
    { sender: mainWindow.webContents },
    vm.runInContext(
      `({ project_id: ${JSON.stringify(PROJECT_ID)} })`,
      runtimeModule.context,
    ),
  );
  await assert.rejects(
    async () => ipcMain.handlers.get(CONTINUE_DRAFT_CHANNEL)(
      { sender: mainWindow.webContents },
      vm.runInContext(`({
        draft_id: "builder-generation-draft:${'3'.repeat(64)}",
        instruction: "Reject a mismatched continuation admission."
      })`, runtimeModule.context),
    ),
    { code: 'builder_generation_workspace_changed' },
  );
  assert.equal(draftContinuationAdmissions.length, 1);
  assert.equal(draftContinuationAdmissions[0].draft_id, `builder-generation-draft:${'3'.repeat(64)}`);
  assert.deepEqual(continuedDrafts, []);
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
    grantPermissionForExplicitApproval,
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
  await assert.rejects(
    async () => invoke(GENERATE_CHANNEL, body('({ instruction: "Make a fresh project." })')),
    { code: 'builder_generation_project_workspace_required' },
  );
  assert.equal(generated.at(-1).existing_project_id, projectB);
  runtime.dispose();
});

test('cancels every accepted generation, submit, retry, or answer before removing its cancel channel', async (t) => {
  const projectIds = {
    generate: PROJECT_ID,
    submit: 'builder-project:123e4567-e89b-42d3-a456-426614174001',
    retry: 'builder-project:123e4567-e89b-42d3-a456-426614174002',
    answer: 'builder-project:123e4567-e89b-42d3-a456-426614174003',
  };
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
      if (body.request_id === hostRequestDigest('Make a timer.', projectIds.generate)) rejectGeneration(error);
      if (body.request_id === hostRequestDigest('Continue the timer.', projectIds.submit)) rejectSubmit(error);
      if (body.request_id === hostRequestDigest('Retry the timer.', projectIds.retry)) rejectRetry(error);
      if (body.request_id === hostRequestDigest('Explain the timer.', projectIds.answer)) rejectAnswer(error);
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
    grantPermissionForExplicitApproval,
    ipcMain,
    mainWindow,
    userDataPath: temporaryUserData(t),
  });
  runtime.register();
  const openProject = (projectId) => ipcMain.handlers.get(OPEN_PROJECT_CHANNEL)(
    { sender: mainWindow.webContents },
    vm.runInContext(`({ project_id: ${JSON.stringify(projectId)} })`, runtimeModule.context),
  );
  const generateBody = vm.runInContext('({ instruction: "Make a timer." })', runtimeModule.context);
  const submitBody = vm.runInContext('({ instruction: "Continue the timer." })', runtimeModule.context);
  const retryBody = vm.runInContext('({ instruction: "Retry the timer." })', runtimeModule.context);
  const answerBody = vm.runInContext('({ instruction: "Explain the timer." })', runtimeModule.context);
  await openProject(projectIds.generate);
  const generation = ipcMain.handlers.get(GENERATE_CHANNEL)({ sender: mainWindow.webContents }, generateBody);
  await waitForProbe(() => typeof rejectGeneration === 'function');
  await openProject(projectIds.submit);
  const submission = ipcMain.handlers.get(SUBMIT_CHANNEL)({ sender: mainWindow.webContents }, submitBody);
  await waitForProbe(() => typeof rejectSubmit === 'function');
  await openProject(projectIds.retry);
  const retry = ipcMain.handlers.get(RETRY_GENERATE_CHANNEL)({ sender: mainWindow.webContents }, retryBody);
  await waitForProbe(() => typeof rejectRetry === 'function');
  await openProject(projectIds.answer);
  const answer = ipcMain.handlers.get(ANSWER_CHANNEL)({ sender: mainWindow.webContents }, answerBody);
  await waitForProbe(() => typeof rejectAnswer === 'function');
  const cancelledGeneration = assert.rejects(generation, { code: 'builder_generation_cancelled' });
  const cancelledSubmission = assert.rejects(submission, { code: 'builder_generation_cancelled' });
  const cancelledRetry = assert.rejects(retry, { code: 'builder_generation_cancelled' });
  const cancelledAnswer = assert.rejects(answer, { code: 'builder_generation_cancelled' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runtime.dispose(), true);
  assert.deepEqual(cancelRequests.map((request) => request.request_id).sort(), [
    hostRequestDigest('Make a timer.', projectIds.generate),
    hostRequestDigest('Continue the timer.', projectIds.submit),
    hostRequestDigest('Retry the timer.', projectIds.retry),
    hostRequestDigest('Explain the timer.', projectIds.answer),
  ].sort());
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
    grantPermissionForExplicitApproval,
    ipcMain,
    mainWindow,
    userDataPath: temporaryUserData(t),
  });
  runtime.register();
  await ipcMain.handlers.get(OPEN_PROJECT_CHANNEL)(
    { sender: mainWindow.webContents },
    vm.runInContext(`({ project_id: ${JSON.stringify(PROJECT_ID)} })`, runtimeModule.context),
  );
  const body = vm.runInContext('({ instruction: "Make a timer." })', runtimeModule.context);
  const operation = ipcMain.handlers.get(GENERATE_CHANNEL)({ sender: mainWindow.webContents }, body);
  await new Promise((resolve) => setImmediate(resolve));

  assert.throws(() => runtime.dispose(), {
    code: 'builder_generation_ipc_runtime_unavailable',
  });
  assert.deepEqual([...ipcMain.handlers.keys()], []);
  resolveGeneration(vm.runInContext(`({
    version: "builder-generation-result.v2",
    request_id: "${hostRequestDigest('Make a timer.', PROJECT_ID)}"
  })`, runtimeModule.context));
  await operation;
  assert.equal(runtime.dispose(), true);
});

test('contains no preload, renderer, settings write, generic provider, or legacy revision authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-generation-ipc-runtime.cjs'),
    'utf8',
  );
  const sourceWithoutFixedMetadataAbsenceField = source.replace(/credential_storage/gu, '');
  for (const forbidden of [
    /ipcRenderer|contextBridge|BrowserWindow|require\(['"]electron['"]\)|\bnet\b/u,
    /write_current|credential|safeStorage|providerSettings/u,
    /builder-project-revision-repository|builder-project-revisions-v1|projectRevisionRepository/u,
    /local-provider-executor|chat_planner|ChatCreatePage|Canvas|JobMeta/u,
  ]) assert.doesNotMatch(sourceWithoutFixedMetadataAbsenceField, forbidden);
  assert.match(source, /createBuilderProjectMainAuthority/u);
  assert.doesNotMatch(source, /createDefaultBuilderGitProjectRepository/u);
  assert.doesNotMatch(source, /createBuilderProductMetadataDatabase/u);
  assert.doesNotMatch(source, /createBuilderProjectReadAuthority/u);
  assert.match(source, /createBuilderGenerationMainService/u);
  assert.match(source, /createBuilderProviderContextDisclosureDecisionService/u);
  assert.match(source, /createBuilderProviderContextDisclosureStatusService/u);
  assert.match(source, /providerContextDisclosureDecisionService/u);
  assert.match(source, /providerContextDisclosureStatusService/u);
  assert.match(source, /createBuilderTaskCapsuleStore/u);
  assert.match(source, /createBuilderTaskCapsuleRecordingService/u);
  assert.match(source, /createBuilderSessionTaskAddressStore/u);
  assert.match(source, /createBuilderSessionTaskAddressRecordingService/u);
  assert.match(source, /sessionTaskAddressRecordingService/u);
  assert.match(source, /LOCAL_BUILDER_AGENT_ID/u);
  assert.match(source, /createBuilderTaskStreamIpcAdapter/u);
  assert.match(source, /createBuilderPlanReviewIpcAdapter/u);
  assert.match(source, /channel:\s*READ_TASK_STREAM_CHANNEL/u);
  assert.match(source, /channel:\s*REVIEW_PLAN_CHANNEL/u);
  assert.match(source, /channel:\s*LOAD_REVISION_CHANNEL/u);
  assert.match(source, /createBuilderOpenAICompatibleTransport\(\{ fetchImpl: options\.fetchImpl \}\)/u);
  assert.doesNotMatch(source, /globalThis\.fetch/u);
});
