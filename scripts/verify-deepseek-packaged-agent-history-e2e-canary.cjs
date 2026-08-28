'use strict';

const nodeCrypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance: nodePerformance } = require('node:perf_hooks');
const { _electron: electron } = require('playwright-core');

const {
  PACKAGED_CANARY_USER_DATA_PREFIX,
  SELECTORS,
  approveCurrentProjectWriteIfRequested,
  captureGuardedUserDataRoot,
  clickSaveVersionViaUi,
  copySavedProviderProfile,
  createCanaryProjectRoot,
  readSanitizedTaskStreamEvidence,
  readStdin,
  sanitizeLaunchEnvironment,
} = require('./verify-packaged-canary.cjs');
const {
  parseDeepSeekCanaryInput,
  sanitizeDeepSeekCanaryInput,
  toPackagedCanaryInput,
} = require('./verify-deepseek-packaged-canary.cjs');
const {
  readMainPerformanceTrace,
  readRendererPerformanceTrace,
} = require('./verify-packaged-harness-ui-canary.cjs');

const RESULT_VERSION = 'builder-deepseek-packaged-agent-history-e2e-canary-result.v3';
const DEFAULT_BUILDER_AGENT_ID = 'builder-agent:123e4567-e89b-42d3-a456-426614174002';
const BUILDER_PROFILE_DIRECTORY = /^builder-[a-z0-9-]+-v[0-9]+$/u;
const BUILDER_PROFILE_CLONE_EXCLUSIONS = new Set([
  'builder-check-workspaces-v1',
  'builder-git-runtime-v2',
  'builder-harness-execution-v1',
  'builder-harness-sessions-v1',
  'builder-provider-config-v1',
  'builder-provider-secrets-v1',
  'builder-structured-runtime-workspace-snapshots-v1',
]);
const AGENT_BUILD_IDEA = [
  '从空项目创建一个可验证的专注计时器。',
  '请写入 index.html、package.json 和 check.js。',
  'index.html 必须包含 h1 文本 "Agent History Flow" 和一句简短副标题。',
  'package.json 必须提供 npm test，check.js 必须验证 h1。',
  '只使用 Builder 文件工具；让 Builder 在生成后运行检查。',
].join(' ');
const CONTINUE_QUESTION = '继续说明这个项目现在怎么运行，基于当前文件用中文简短回答。';
const EXISTING_HISTORY_QUESTION = '请基于这个旧任务已有的会话和项目内容，用中文简短说明上次做到哪里、下一步适合做什么。';
const EXISTING_PROJECT_UPDATE = [
  '继续这个已有项目，只修改 index.html。',
  '保留 h1 文本 "Agent History Flow"，把副标题准确改成 "Second Agent Task"。',
  '不要修改 package.json 或 check.js；让 Builder 在修改后运行检查。',
].join(' ');

class DeepSeekPackagedAgentHistoryE2ECanaryError extends Error {
  constructor(code, diagnostic = undefined) {
    super('The real-provider Agent history end-to-end canary did not complete.');
    this.name = 'DeepSeekPackagedAgentHistoryE2ECanaryError';
    this.code = typeof code === 'string' && /^[a-z0-9_]{1,96}$/u.test(code)
      ? code
      : 'deepseek_agent_history_e2e_failed';
    this.diagnostic = diagnostic;
  }
}

function fail(code, diagnostic = undefined) {
  throw new DeepSeekPackagedAgentHistoryE2ECanaryError(code, diagnostic);
}

function performanceMetric(trace, name) {
  return trace.metrics.find((candidate) => candidate.name === name) ?? Object.freeze({
    count: 0,
    sample_count: 0,
    total: 0,
    median: 0,
    p95: 0,
    max: 0,
  });
}

function metricWindow(before, after, name) {
  const first = performanceMetric(before, name);
  const last = performanceMetric(after, name);
  return Object.freeze({
    count: Math.max(0, last.count - first.count),
    total_ms: Number(Math.max(0, last.total - first.total).toFixed(3)),
    max: last.max,
  });
}

function summarizeRendererPerformanceWindow(before, after) {
  return Object.freeze({
    activity_commits: metricWindow(before, after, 'renderer.activity.commit_count').count,
    builder_page_commits: metricWindow(
      before,
      after,
      'renderer.builder_page.commit_count',
    ).count,
    controller_publishes: metricWindow(
      before,
      after,
      'renderer.task_stream.controller_publish_count',
    ).count,
    cursor_reads: Object.freeze({
      full: metricWindow(before, after, 'renderer.task_stream.cursor.full_count').count,
      incremental: metricWindow(
        before,
        after,
        'renderer.task_stream.cursor.incremental_count',
      ).count,
      unchanged: metricWindow(
        before,
        after,
        'renderer.task_stream.cursor.unchanged_count',
      ).count,
    }),
    live_output: Object.freeze({
      dropped: metricWindow(before, after, 'renderer.live_output.dropped_count').count,
      flushes: metricWindow(before, after, 'renderer.live_output.flush_count').count,
      received: metricWindow(before, after, 'renderer.live_output.received_count').count,
    }),
    task_stream: Object.freeze({
      clone_freeze: metricWindow(
        before,
        after,
        'renderer.task_stream.clone_freeze.duration_ms',
      ),
      read: metricWindow(before, after, 'renderer.task_stream.read.duration_ms'),
      result_bytes_max: performanceMetric(
        after,
        'renderer.task_stream.read.result_bytes',
      ).max,
    }),
  });
}

function summarizeMainPerformance(trace) {
  return Object.freeze({
    application_event_loop_delay_max_ms: trace.event_loop_delay?.max_ms ?? 0,
    conversation: Object.freeze({
      append: performanceMetric(trace, 'main.conversation.append.duration_ms'),
      context_replay: performanceMetric(
        trace,
        'main.conversation.context_replay.duration_ms',
      ),
      context_replay_cache_hits: performanceMetric(
        trace,
        'main.conversation.context_replay.cache_hit_count',
      ).count,
      load: performanceMetric(trace, 'main.conversation.load.duration_ms'),
      loaded_event_bytes_max: performanceMetric(
        trace,
        'main.conversation.load.event_bytes',
      ).max,
      loaded_event_count_max: performanceMetric(
        trace,
        'main.conversation.load.event_count',
      ).max,
    }),
    harness_runtime: Object.freeze({
      pending_batch_size_max: performanceMetric(
        trace,
        'main.harness_runtime.pending_batch_size',
      ).max,
      persist_event: performanceMetric(
        trace,
        'main.harness_runtime.persist_event.duration_ms',
      ),
      record_events: performanceMetric(
        trace,
        'main.harness_runtime.record_events.duration_ms',
      ),
    }),
    task_stream: Object.freeze({
      ipc: performanceMetric(trace, 'main.task_stream.ipc.duration_ms'),
      ipc_result_bytes_max: performanceMetric(trace, 'main.task_stream.ipc.result_bytes').max,
      projection: performanceMetric(trace, 'main.task_stream.projection.duration_ms'),
      projection_result_bytes_max: performanceMetric(
        trace,
        'main.task_stream.projection.result_bytes',
      ).max,
    }),
    workbench: Object.freeze({
      read: performanceMetric(trace, 'main.workbench.read.duration_ms'),
      task_sync: performanceMetric(trace, 'main.workbench.task_sync.duration_ms'),
      task_sync_task_count_max: performanceMetric(
        trace,
        'main.workbench.task_sync.task_count',
      ).max,
    }),
    tool_broker: Object.freeze({
      execute: performanceMetric(trace, 'main.harness_tool_broker.execute_tool.duration_ms'),
      read: performanceMetric(trace, 'main.harness_tool_broker.tool_read.duration_ms'),
      read_active_max: performanceMetric(
        trace,
        'main.harness_tool_broker.tool_read.active_count',
      ).max,
      read_queue_wait: performanceMetric(
        trace,
        'main.harness_tool_broker.tool_read.queue_wait.duration_ms',
      ),
      search: performanceMetric(trace, 'main.harness_tool_broker.tool_search.duration_ms'),
      search_active_max: performanceMetric(
        trace,
        'main.harness_tool_broker.tool_search.active_count',
      ).max,
      search_queue_wait: performanceMetric(
        trace,
        'main.harness_tool_broker.tool_search.queue_wait.duration_ms',
      ),
    }),
  });
}

async function optionalVisible(page, selector) {
  try { return await page.locator(selector).first().isVisible(); } catch { return false; }
}

async function optionalText(page, selector) {
  try { return (await page.locator(selector).first().textContent({ timeout: 500 })) ?? null; } catch { return null; }
}

function copySavedBuilderWorkspaceProfile(input, userDataRoot, fsModule = fs) {
  if (input.mode !== 'saved_profile') return Object.freeze({ copied_directory_count: 0 });
  const sourceRoot = path.resolve(input.source_user_data_path);
  const sourceStat = fsModule.lstatSync(sourceRoot);
  if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink()) {
    fail('deepseek_agent_history_profile_clone_failed');
  }
  const sourceRealPath = path.resolve(fsModule.realpathSync.native(sourceRoot));
  const targetRealPath = path.resolve(fsModule.realpathSync.native(userDataRoot.realPath));
  if (sourceRealPath === targetRealPath) fail('deepseek_agent_history_profile_clone_failed');
  let copiedDirectoryCount = 0;
  for (const entry of fsModule.readdirSync(sourceRealPath, { withFileTypes: true })) {
    if (
      !entry.isDirectory()
      || entry.isSymbolicLink()
      || !BUILDER_PROFILE_DIRECTORY.test(entry.name)
      || BUILDER_PROFILE_CLONE_EXCLUSIONS.has(entry.name)
    ) continue;
    const source = path.join(sourceRealPath, entry.name);
    const target = path.join(targetRealPath, entry.name);
    fsModule.cpSync(source, target, {
      dereference: false,
      errorOnExist: true,
      recursive: true,
    });
    copiedDirectoryCount += 1;
  }
  if (copiedDirectoryCount === 0) fail('deepseek_agent_history_profile_clone_failed');
  return Object.freeze({ copied_directory_count: copiedDirectoryCount });
}

async function readExistingWorkspaceHistory(page) {
  const startedAt = nodePerformance.now();
  const snapshot = await page.evaluate(async (agentId) => {
    const root = globalThis.window?.clawfabricBuilder;
    const [tree, workbench] = await Promise.all([
      root?.agentProjectTree?.read?.({ agent_id: agentId }),
      root?.agentWorkbench?.read?.({ agent_id: agentId, after_cursor: null, limit: 80 }),
    ]);
    const projects = Array.isArray(tree?.projects) ? tree.projects : [];
    const task = projects
      .flatMap((project) => (Array.isArray(project?.tasks)
        ? project.tasks.map((candidate) => ({ project, task: candidate }))
        : []))
      .find((candidate) => (
        typeof candidate.project?.project_id === 'string'
        && typeof candidate.task?.task_address_id === 'string'
        && candidate.project?.source_boundary_label !== null
        && candidate.task?.status !== 'archived'
      )) ?? null;
    return {
      history_item_count: Array.isArray(workbench?.stream?.items) ? workbench.stream.items.length : null,
      project_count: projects.length,
      selected_project_id: task?.project?.project_id ?? null,
      selected_task_address_id: task?.task?.task_address_id ?? null,
      task_count: projects.reduce(
        (total, project) => total + (Array.isArray(project?.tasks) ? project.tasks.length : 0),
        0,
      ),
    };
  }, DEFAULT_BUILDER_AGENT_ID);
  if (
    !Number.isSafeInteger(snapshot?.project_count)
    || snapshot.project_count < 1
    || !Number.isSafeInteger(snapshot?.task_count)
    || snapshot.task_count < 1
    || !/^builder-project:[0-9a-f-]{36}$/u.test(snapshot.selected_project_id ?? '')
    || !/^builder-task-address:[0-9a-f-]{36}$/u.test(snapshot.selected_task_address_id ?? '')
  ) fail('deepseek_agent_history_existing_workspace_missing', snapshot);
  return Object.freeze({
    duration_ms: Math.round(nodePerformance.now() - startedAt),
    history_item_count: snapshot.history_item_count,
    project_count: snapshot.project_count,
    selected_project_id: snapshot.selected_project_id,
    selected_task_address_id: snapshot.selected_task_address_id,
    task_count: snapshot.task_count,
  });
}

async function openExistingTask(page, history) {
  const project = page.locator(`button[data-builder-project-id="${history.selected_project_id}"]`);
  await project.waitFor({ state: 'visible', timeout: 30_000 });
  const projectItem = project.locator('xpath=ancestor::li[1]');
  const task = projectItem.locator(
    `button[data-builder-task-address-id="${history.selected_task_address_id}"]`,
  );
  if (!await task.isVisible().catch(() => false)) {
    const toggle = projectItem.locator('.cf-builder-agent-project-toggle');
    if (await toggle.getAttribute('aria-expanded').catch(() => null) === 'false') await toggle.click();
  }
  await task.waitFor({ state: 'visible', timeout: 30_000 });
  await task.click();
  await page.locator(
    `button[data-builder-task-address-id="${history.selected_task_address_id}"][data-selected="true"]`,
  ).waitFor({ state: 'visible', timeout: 30_000 });
}

async function askExistingHistoryQuestion(page, projectId, taskContext) {
  const startedAt = nodePerformance.now();
  const before = await page.locator(SELECTORS.questionAnswer).count();
  await page.locator(SELECTORS.idea).fill(EXISTING_HISTORY_QUESTION);
  await page.locator(SELECTORS.submitTurn).click();
  const answer = page.locator(SELECTORS.questionAnswer).nth(before);
  await answer.waitFor({ state: 'visible', timeout: 180_000 });
  const text = ((await answer.textContent()) ?? '').trim();
  if (text.length < 20 || !/[\u3400-\u9fff]/u.test(text)) {
    fail('deepseek_agent_history_existing_task_continue_failed', Object.freeze({
      answer_length: text.length,
      contains_chinese: /[\u3400-\u9fff]/u.test(text),
    }));
  }
  const terminalDeadline = Date.now() + 60_000;
  let terminalDiagnostic = null;
  while (Date.now() < terminalDeadline) {
    terminalDiagnostic = await page.evaluate(async (request) => {
      const stream = await globalThis.window?.clawfabricBuilder?.taskStream?.read?.({
        project_id: request.projectId,
        task_address_id: request.taskAddressId,
      });
      const conversation = stream?.conversation ?? null;
      const submit = globalThis.document.querySelector('[data-builder-submit-turn="true"]');
      return {
        active_turn_id: conversation?.recorded_active_turn_id ?? null,
        item_count: conversation?.item_count ?? null,
        submit_title: submit?.getAttribute('title') ?? null,
      };
    }, {
      projectId,
      taskAddressId: taskContext.selectedTaskAddressId,
    }).catch(() => null);
    if (
      terminalDiagnostic?.active_turn_id === null
      && terminalDiagnostic?.submit_title === 'Send'
    ) break;
    await page.waitForTimeout(250);
  }
  if (
    terminalDiagnostic?.active_turn_id !== null
    || terminalDiagnostic?.submit_title !== 'Send'
  ) fail('deepseek_agent_history_existing_task_did_not_settle', terminalDiagnostic);
  return Object.freeze({
    answer_contains_chinese: true,
    answer_length: text.length,
    duration_ms: Math.round(nodePerformance.now() - startedAt),
  });
}

async function openAgentWorkbench(page) {
  const agent = page.locator(SELECTORS.agentRosterItem).first();
  await agent.waitFor({ state: 'visible', timeout: 30_000 });
  await agent.click();
  await page.locator(`${SELECTORS.agentRosterItem}[data-selected="true"]`)
    .waitFor({ state: 'visible', timeout: 30_000 });
  await page.locator('[data-builder-agent-workbench-stream="true"]')
    .waitFor({ state: 'visible', timeout: 30_000 });
}

async function installWriteApprovalObserver(page) {
  await page.evaluate(() => {
    globalThis.__builderAgentHistoryWriteApprovalObserver?.disconnect?.();
    const state = { observed: false };
    const inspect = () => {
      if (globalThis.document.querySelector('[data-builder-current-project-write-approval="true"]')) {
        state.observed = true;
      }
    };
    const observer = new globalThis.MutationObserver(inspect);
    observer.observe(globalThis.document.documentElement, { childList: true, subtree: true });
    inspect();
    Object.defineProperty(globalThis, '__builderAgentHistoryWriteApprovalObserver', {
      configurable: true,
      enumerable: false,
      value: Object.freeze({
        disconnect() { observer.disconnect(); },
        observed() { return state.observed; },
      }),
      writable: false,
    });
  });
}

async function writeApprovalWasObserved(page) {
  return await page.evaluate(() => (
    globalThis.__builderAgentHistoryWriteApprovalObserver?.observed?.() === true
  ));
}

async function waitForCurrentProjectId(page) {
  const deadline = Date.now() + 30_000;
  let last = null;
  while (Date.now() < deadline) {
    last = await page.evaluate(async (agentId) => {
      const root = globalThis.window?.clawfabricBuilder;
      const tree = await root?.agentProjectTree?.read?.({ agent_id: agentId });
      const projects = Array.isArray(tree?.projects) ? tree.projects : [];
      const latest = projects.find((project) => typeof project?.project_id === 'string') ?? null;
      return {
        latest_project_id: latest?.project_id ?? null,
        project_count: projects.length,
        task_count: projects.reduce(
          (total, project) => total + (Array.isArray(project?.tasks) ? project.tasks.length : 0),
          0,
        ),
      };
    }, DEFAULT_BUILDER_AGENT_ID).catch(() => null);
    if (/^builder-project:[0-9a-f-]{36}$/u.test(last?.latest_project_id ?? '')) {
      return Object.freeze({
        project_count: last.project_count,
        project_id: last.latest_project_id,
        task_count: last.task_count,
      });
    }
    await page.waitForTimeout(250);
  }
  fail('deepseek_agent_history_project_identity_failed', Object.freeze({ last }));
}

async function createAgentTaskProposalViaBridge(page, objective) {
  await installWriteApprovalObserver(page);
  const requestId = `builder-workbench-request:${nodeCrypto.randomUUID()}`;
  const proposalIdentity = await page.evaluate(async (request) => {
    const root = globalThis.window?.clawfabricBuilder;
    const response = await root?.agentWorkbench?.createTaskProposal?.(request);
    const result = response?.ok === true ? response.result : response;
    return {
      message_id: result?.proposal?.message_id ?? null,
      proposal_id: result?.proposal?.proposal_id ?? null,
    };
  }, {
    agent_id: DEFAULT_BUILDER_AGENT_ID,
    execution_mode: 'foreground',
    objective,
    reason: 'I4 canary starts from Agent Workbench and materializes a foreground project task.',
    request_id: requestId,
    requested_outcome: 'build',
  });
  if (
    !/^builder-message:[0-9a-f-]{36}$/u.test(proposalIdentity?.message_id ?? '')
    || !/^builder-task-proposal:[0-9a-f-]{36}$/u.test(proposalIdentity?.proposal_id ?? '')
  ) fail('deepseek_agent_history_task_proposal_identity_failed');
  const proposal = page.locator(
    `[data-builder-workbench-message="${proposalIdentity.message_id}"]`,
  );
  await proposal.locator(SELECTORS.agentTaskProposalActions)
    .waitFor({ state: 'visible', timeout: 30_000 });
  await proposal.locator(SELECTORS.agentTaskProposalNewProject).click();
  const deadline = Date.now() + 30_000;
  let lastStatus = null;
  while (Date.now() < deadline) {
    lastStatus = await page.locator(SELECTORS.projectPage)
      .getAttribute('data-builder-project-status')
      .catch(() => null);
    if (['ready', 'submitting', 'answering', 'generating', 'draft_ready', 'checking', 'saving'].includes(lastStatus)) return;
    await page.waitForTimeout(250);
  }
  const projectionDiagnostic = await page.evaluate(async (request) => {
    const root = globalThis.window?.clawfabricBuilder;
    const [workbench, tree, catalog] = await Promise.all([
      root?.agentWorkbench?.read?.({ agent_id: request.agentId, after_cursor: null, limit: 80 }),
      root?.agentProjectTree?.read?.({ agent_id: request.agentId }),
      root?.projectWorkspace?.listWorkspaces?.(),
    ]);
    const items = Array.isArray(workbench?.stream?.items) ? workbench.stream.items : [];
    const action = items
      .flatMap((item) => Array.isArray(item?.actions) ? item.actions : [])
      .find((candidate) => candidate?.proposal_id === request.proposalId) ?? null;
    return {
      action,
      project_count: Array.isArray(tree?.projects) ? tree.projects.length : null,
      workspace_count: Array.isArray(catalog?.workspaces) ? catalog.workspaces.length : null,
    };
  }, {
    agentId: DEFAULT_BUILDER_AGENT_ID,
    proposalId: proposalIdentity.proposal_id,
  }).catch(() => null);
  fail('deepseek_agent_history_task_open_failed', Object.freeze({
    project_status: lastStatus,
    proposal_action: projectionDiagnostic?.action ?? null,
    projected_project_count: projectionDiagnostic?.project_count ?? null,
    workspace_count: projectionDiagnostic?.workspace_count ?? null,
    proposal_actions_visible: await proposal.locator(SELECTORS.agentTaskProposalActions)
      .isVisible().catch(() => null),
  }));
}

async function createExistingProjectTaskProposalViaBridge(page, projectId, objective) {
  const requestId = `builder-workbench-request:${nodeCrypto.randomUUID()}`;
  const proposalIdentity = await page.evaluate(async (request) => {
    const root = globalThis.window?.clawfabricBuilder;
    const response = await root?.agentWorkbench?.createTaskProposal?.(request);
    const result = response?.ok === true ? response.result : response;
    return {
      message_id: result?.proposal?.message_id ?? null,
      proposal_id: result?.proposal?.proposal_id ?? null,
    };
  }, {
    agent_id: DEFAULT_BUILDER_AGENT_ID,
    execution_mode: 'foreground',
    objective,
    reason: 'I5 canary continues a controlled existing project through Agent Workbench.',
    request_id: requestId,
    requested_outcome: 'build',
  });
  if (
    !/^builder-message:[0-9a-f-]{36}$/u.test(proposalIdentity?.message_id ?? '')
    || !/^builder-task-proposal:[0-9a-f-]{36}$/u.test(proposalIdentity?.proposal_id ?? '')
  ) fail('deepseek_agent_history_existing_task_proposal_identity_failed');
  const proposal = page.locator(
    `[data-builder-workbench-message="${proposalIdentity.message_id}"]`,
  );
  const actions = proposal.locator(SELECTORS.agentTaskProposalActions);
  await actions.waitFor({ state: 'visible', timeout: 30_000 });
  await actions.getByLabel('Project for task proposal').selectOption(projectId);
  await actions.locator('[data-builder-agent-task-proposal-create-task="true"]').click();
  const deadline = Date.now() + 30_000;
  let lastStatus = null;
  while (Date.now() < deadline) {
    lastStatus = await page.locator(SELECTORS.projectPage)
      .getAttribute('data-builder-project-status')
      .catch(() => null);
    if (['ready', 'submitting', 'answering', 'generating', 'draft_ready', 'checking', 'saving'].includes(lastStatus)) return;
    await page.waitForTimeout(250);
  }
  fail('deepseek_agent_history_existing_task_open_failed', Object.freeze({ project_status: lastStatus }));
}

async function waitForAutoStartedMaterializedAgentTask(
  page,
  projectId,
  objective,
  options = {},
) {
  const startedAt = nodePerformance.now();
  const minimumCandidateCount = options.minimumCandidateCount ?? 1;
  const minimumCheckPassedCount = options.minimumCheckPassedCount ?? 1;
  const autoStartDeadline = Date.now() + 60_000;
  let autoStartObserved = false;
  let submittedMessageMs = null;
  while (Date.now() < autoStartDeadline) {
    const stream = await readSanitizedTaskStreamEvidence(page, projectId).catch(() => null);
    const hasSubmittedIdea = stream?.conversation?.items?.some((item) => (
      item?.item_kind === 'user_message'
      && item?.message_kind === 'submitted'
      && item?.message?.text === objective
    )) === true;
    const counts = stream?.conversation?.item_facts?.counts ?? null;
    if (hasSubmittedIdea || counts?.submitted_message_count >= 1) {
      autoStartObserved = true;
      submittedMessageMs = Math.round(nodePerformance.now() - startedAt);
      break;
    }
    await page.waitForTimeout(500);
  }
  if (!autoStartObserved) {
    fail('deepseek_agent_history_auto_start_missing', await diagnostic(page, 'agent_auto_start_missing', projectId));
  }
  if (options.expectWriteApproval === true) {
    await page.locator(SELECTORS.currentProjectWriteApproval)
      .waitFor({ state: 'visible', timeout: 30_000 });
    await approveCurrentProjectWriteIfRequested(page);
  }
  const liveMarkdownObserved = await page.locator('[data-builder-live-output="true"] [data-builder-conversation-markdown="true"]')
    .first()
    .waitFor({ state: 'visible', timeout: 60_000 })
    .then(() => true)
    .catch(() => false);
  const firstLiveMarkdownMs = liveMarkdownObserved
    ? Math.round(nodePerformance.now() - startedAt)
    : null;
  const deadline = Date.now() + 180_000;
  let terminalMs = null;
  while (Date.now() < deadline) {
    const stream = await readSanitizedTaskStreamEvidence(page, projectId).catch(() => null);
    const counts = stream?.conversation?.item_facts?.counts ?? null;
    const terminal = stream?.conversation?.recorded_active_turn_id === null
      && counts?.run_completed_count >= 1
      && counts?.turn_completed_count >= 1;
    if (terminal && terminalMs === null) {
      terminalMs = Math.round(nodePerformance.now() - startedAt);
    }
    if (
      terminal
      && counts?.candidate_ready_count >= minimumCandidateCount
      && counts?.programming_runtime_tool_activity_count >= 1
      && counts?.programming_runtime_check_passed_count >= minimumCheckPassedCount
      && await optionalVisible(page, SELECTORS.unsavedDraft)
    ) return Object.freeze({
      counts,
      live_markdown_observed: liveMarkdownObserved,
      timing: Object.freeze({
        check_ready_ms: Math.round(nodePerformance.now() - startedAt),
        first_live_markdown_ms: firstLiveMarkdownMs,
        submitted_message_ms: submittedMessageMs,
        terminal_ms: terminalMs,
      }),
    });
    await page.waitForTimeout(500);
  }
  fail('deepseek_agent_history_check_timeout', await diagnostic(page, 'automatic_check_timeout', projectId));
}

async function askContinueQuestion(page, projectId) {
  const before = await page.locator(SELECTORS.questionAnswer).count();
  await page.locator(SELECTORS.idea).fill(CONTINUE_QUESTION);
  await page.locator(SELECTORS.submitTurn).click();
  const answer = page.locator(SELECTORS.questionAnswer).nth(before);
  await answer.waitFor({ state: 'visible', timeout: 180_000 });
  const text = ((await answer.textContent()) ?? '').trim();
  if (!/npm test|index\.html|check\.js/iu.test(text)) {
    fail('deepseek_agent_history_continue_answer_failed', Object.freeze({
      answer_length: text.length,
      contains_chinese: /[\u3400-\u9fff]/u.test(text),
    }));
  }
  const evidence = await readSanitizedTaskStreamEvidence(page, projectId);
  return Object.freeze({
    answer_contains_chinese: /[\u3400-\u9fff]/u.test(text),
    answer_grounded: true,
    item_count_after_continue: evidence.conversation?.item_count ?? null,
  });
}

function removeGuardedRoot(root) {
  const resolved = path.resolve(root.path);
  if (
    path.dirname(resolved) !== path.resolve(os.tmpdir())
    || !path.basename(resolved).startsWith(PACKAGED_CANARY_USER_DATA_PREFIX)
  ) fail('deepseek_agent_history_cleanup_failed');
  fs.rmSync(resolved, { recursive: true, force: true });
}

async function diagnostic(page, stage, projectId = null) {
  let counts = null;
  if (projectId !== null) {
    counts = (await readSanitizedTaskStreamEvidence(page, projectId).catch(() => null))
      ?.conversation?.item_facts?.counts ?? null;
  }
  return Object.freeze({
    stage,
    agent_visible: await optionalVisible(page, SELECTORS.agentRosterItem),
    composer_text: await page.locator(SELECTORS.idea).inputValue().catch(() => null),
    generation_failed_visible: await optionalVisible(page, SELECTORS.generationFailedNotice),
    generation_failed_text: await optionalText(page, SELECTORS.generationFailedNotice),
    project_status: await page.locator(SELECTORS.projectPage)
      .getAttribute('data-builder-project-status').catch(() => null),
    task_stream_counts: counts,
  });
}

async function runDeepSeekPackagedAgentHistoryE2ECanary(rawInput, options = {}) {
  const input = sanitizeDeepSeekCanaryInput(rawInput);
  const packagedInput = toPackagedCanaryInput(input);
  const rawUserDataPath = options.userDataPath
    ?? fs.mkdtempSync(path.join(os.tmpdir(), PACKAGED_CANARY_USER_DATA_PREFIX));
  let app = null;
  let root = null;
  let result = null;
  let primaryError = null;
  let stage = 'setup';
  let projectId = null;
  let profileClone = null;
  let rendererPerformance = null;
  const startedAt = nodePerformance.now();
  try {
    root = captureGuardedUserDataRoot(rawUserDataPath, fs, os);
    const projectRoot = createCanaryProjectRoot(root, fs, os);
    profileClone = copySavedBuilderWorkspaceProfile(packagedInput, root, fs);
    copySavedProviderProfile(packagedInput, root, fs);
    stage = 'launch';
    const launchEnvironment = Object.freeze({
      ...sanitizeLaunchEnvironment(options.env ?? process.env, root.path, projectRoot),
      BUILDER_PERF_TRACE: '1',
    });
    app = await (options.electron ?? electron).launch({
      args: [],
      executablePath: packagedInput.executable_path,
      env: launchEnvironment,
    });
    const page = await app.firstWindow();
    await page.locator(SELECTORS.agentRosterItem).waitFor({ state: 'visible', timeout: 30_000 });
    const rendererBaseline = await readRendererPerformanceTrace(page);
    stage = 'existing_history_read';
    const existingHistory = await readExistingWorkspaceHistory(page);
    stage = 'existing_task_open';
    await openExistingTask(page, existingHistory);
    stage = 'existing_task_continue';
    const existingTaskContinuation = await askExistingHistoryQuestion(
      page,
      existingHistory.selected_project_id,
      Object.freeze({
        selectedTaskAddressId: existingHistory.selected_task_address_id,
      }),
    );
    const rendererAfterExistingTask = await readRendererPerformanceTrace(page);
    stage = 'agent_open';
    await openAgentWorkbench(page);
    stage = 'agent_task_proposal';
    await createAgentTaskProposalViaBridge(page, AGENT_BUILD_IDEA);
    stage = 'project_identity';
    const projectIdentity = await waitForCurrentProjectId(page);
    projectId = projectIdentity.project_id;
    stage = 'agent_full_flow';
    const build = await waitForAutoStartedMaterializedAgentTask(
      page,
      projectId,
      AGENT_BUILD_IDEA,
    );
    if (await writeApprovalWasObserved(page)) {
      fail('deepseek_agent_history_new_project_reprompted_for_write');
    }
    const counts = build.counts;
    stage = 'continue_existing_task';
    const continuation = await askContinueQuestion(page, projectId);
    stage = 'save_first_agent_task';
    await clickSaveVersionViaUi(page);
    await page.locator(SELECTORS.versionSavedActivity)
      .waitFor({ state: 'visible', timeout: 30_000 });
    await page.locator(SELECTORS.unsavedDraft)
      .waitFor({ state: 'hidden', timeout: 30_000 });
    const rendererAfterFirstAgentTask = await readRendererPerformanceTrace(page);
    stage = 'agent_existing_project_open';
    await openAgentWorkbench(page);
    stage = 'agent_existing_project_task_proposal';
    await installWriteApprovalObserver(page);
    await createExistingProjectTaskProposalViaBridge(page, projectId, EXISTING_PROJECT_UPDATE);
    stage = 'agent_existing_project_full_flow';
    const existingProjectBuild = await waitForAutoStartedMaterializedAgentTask(
      page,
      projectId,
      EXISTING_PROJECT_UPDATE,
    );
    if (await writeApprovalWasObserved(page)) {
      fail('deepseek_agent_history_existing_project_reprompted_for_write');
    }
    const updatedIndex = fs.readFileSync(path.join(projectRoot, 'index.html'), 'utf8');
    if (!updatedIndex.includes('Second Agent Task') || !updatedIndex.includes('Agent History Flow')) {
      fail('deepseek_agent_history_existing_project_update_failed');
    }
    const rendererAfterSecondAgentTask = await readRendererPerformanceTrace(page);
    rendererPerformance = Object.freeze({
      existing_task_continuation: summarizeRendererPerformanceWindow(
        rendererBaseline,
        rendererAfterExistingTask,
      ),
      first_agent_task: summarizeRendererPerformanceWindow(
        rendererAfterExistingTask,
        rendererAfterFirstAgentTask,
      ),
      second_agent_task: summarizeRendererPerformanceWindow(
        rendererAfterFirstAgentTask,
        rendererAfterSecondAgentTask,
      ),
    });
    const finalTree = await page.evaluate(async (agentId) => {
      const tree = await globalThis.window?.clawfabricBuilder?.agentProjectTree?.read?.({
        agent_id: agentId,
      });
      const projects = Array.isArray(tree?.projects) ? tree.projects : [];
      return {
        project_count: projects.length,
        task_count: projects.reduce(
          (total, project) => total + (Array.isArray(project?.tasks) ? project.tasks.length : 0),
          0,
        ),
      };
    }, DEFAULT_BUILDER_AGENT_ID);
    if (
      finalTree.project_count < existingHistory.project_count + 1
      || finalTree.task_count < existingHistory.task_count + 2
    ) fail('deepseek_agent_history_final_tree_failed', finalTree);
    result = Object.freeze({
      result_version: RESULT_VERSION,
      agent_entry_used: true,
      agent_history_cloned_from_saved_profile: true,
      composer_reenabled_after_completion: true,
      continue_existing_task_answer_grounded: continuation.answer_grounded,
      continue_existing_task_answer_is_chinese: continuation.answer_contains_chinese,
      existing_history: Object.freeze({
        duration_ms: existingHistory.duration_ms,
        history_item_count: existingHistory.history_item_count,
        project_count: existingHistory.project_count,
        task_count: existingHistory.task_count,
      }),
      existing_task_continuation: existingTaskContinuation,
      final_project_count: finalTree.project_count,
      final_task_count: finalTree.task_count,
      first_agent_task_timing: build.timing,
      cloned_builder_directory_count: profileClone.copied_directory_count,
      project_identity: projectIdentity,
      project_id: projectId,
      performance: Object.freeze({
        renderer: rendererPerformance,
      }),
      live_markdown_observed: build.live_markdown_observed,
      new_project_write_reprompt_observed: false,
      real_coding_tool_activity_observed: true,
      second_agent_task_live_markdown_observed: existingProjectBuild.live_markdown_observed,
      second_agent_task_timing: existingProjectBuild.timing,
      second_agent_task_write_reprompt_observed: false,
      task_stream_counts: counts,
      total_duration_ms: Math.round(nodePerformance.now() - startedAt),
      workspace_gate: Object.freeze({
        agent_task_proposal_visible: true,
        build_auto_started_after_task_materialized: true,
        existing_project_task_reused_project_write_approval: true,
        existing_saved_task_continued: true,
        real_saved_history_loaded: true,
        source_folder_required: true,
      }),
    });
  } catch (error) {
    primaryError = error instanceof DeepSeekPackagedAgentHistoryE2ECanaryError
      ? error
      : new DeepSeekPackagedAgentHistoryE2ECanaryError(
        typeof error?.code === 'string' ? error.code : 'deepseek_agent_history_e2e_failed',
        await (async () => {
          try {
            const pages = app === null ? [] : app.windows();
            const current = pages.length === 0 ? Object.freeze({ stage }) : await diagnostic(pages[0], stage, projectId);
            return Object.freeze({
              ...current,
              cause_diagnostic: error?.diagnostic ?? null,
              cause_message: error instanceof Error ? error.message.slice(0, 500) : null,
            });
          } catch {
            return Object.freeze({
              stage,
              cause_diagnostic: error?.diagnostic ?? null,
              cause_message: error instanceof Error ? error.message.slice(0, 500) : null,
            });
          }
        })(),
      );
  }
  try { if (app !== null) await app.close(); } catch {
    if (primaryError === null) primaryError = new DeepSeekPackagedAgentHistoryE2ECanaryError('deepseek_agent_history_cleanup_failed');
  }
  if (primaryError === null && result !== null && root !== null) {
    try {
      result = Object.freeze({
        ...result,
        performance: Object.freeze({
          ...result.performance,
          main: summarizeMainPerformance(readMainPerformanceTrace(root.path)),
        }),
      });
    } catch {
      primaryError = new DeepSeekPackagedAgentHistoryE2ECanaryError(
        'deepseek_agent_history_performance_trace_failed',
      );
    }
  }
  try { if (root !== null) removeGuardedRoot(root); } catch {
    if (primaryError === null) primaryError = new DeepSeekPackagedAgentHistoryE2ECanaryError('deepseek_agent_history_cleanup_failed');
  }
  if (primaryError !== null) throw primaryError;
  return result;
}

async function runCli({ argv = process.argv.slice(2), stdin = process.stdin, stdout = process.stdout } = {}) {
  if (!Array.isArray(argv) || argv.length !== 1 || argv[0] !== '--execute') {
    fail('deepseek_agent_history_input_invalid');
  }
  const result = await runDeepSeekPackagedAgentHistoryE2ECanary(
    parseDeepSeekCanaryInput(await readStdin(stdin)),
  );
  stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

module.exports = Object.freeze({
  AGENT_BUILD_IDEA,
  CONTINUE_QUESTION,
  EXISTING_HISTORY_QUESTION,
  EXISTING_PROJECT_UPDATE,
  DeepSeekPackagedAgentHistoryE2ECanaryError,
  RESULT_VERSION,
  copySavedBuilderWorkspaceProfile,
  metricWindow,
  runCli,
  runDeepSeekPackagedAgentHistoryE2ECanary,
  summarizeMainPerformance,
  summarizeRendererPerformanceWindow,
});

if (require.main === module) {
  runCli().catch((error) => {
    const fixed = error instanceof DeepSeekPackagedAgentHistoryE2ECanaryError
      ? error
      : new DeepSeekPackagedAgentHistoryE2ECanaryError('deepseek_agent_history_e2e_failed');
    process.stderr.write(`${JSON.stringify({
      ok: false,
      code: fixed.code,
      message: fixed.message,
      diagnostic: fixed.diagnostic,
    })}\n`);
    process.exitCode = 1;
  });
}
