'use strict';

const nodeCrypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');

const {
  PACKAGED_CANARY_USER_DATA_PREFIX,
  SELECTORS,
  approveCurrentProjectWriteIfRequested,
  assertCustomChromeControls,
  captureGuardedUserDataRoot,
  copySavedProviderProfile,
  createArtifactGate,
  createCanaryProjectRoot,
  ensureCredentialOnlyFromStdin,
  fillProviderSettingsViaUi,
  readSanitizedTaskStreamEvidence,
  readStdin,
  requireBuildWorkspaceBeforeDraftViaUi,
  sanitizeLaunchEnvironment,
} = require('./verify-packaged-canary.cjs');
const {
  DEEPSEEK_V4_BASE_URL,
  inspectSavedProfileDeepSeekConfig,
  parseDeepSeekCanaryInput,
  sanitizeDeepSeekCanaryInput,
  toPackagedCanaryInput,
} = require('./verify-deepseek-packaged-canary.cjs');
const {
  readMainPerformanceTrace,
  requiredMetric,
} = require('./verify-packaged-harness-ui-canary.cjs');

const RESULT_VERSION = 'builder-deepseek-packaged-harness-canary-result.v2';
const HARNESS_SESSION_DIRECTORY = 'builder-harness-sessions-v1';
const MAX_SESSION_FILES = 64;
const MAX_SESSION_FILE_BYTES = 16 * 1024 * 1024;
const DEFAULT_CODING_LOOP_TIMEOUT_MS = 600_000;
const GENERATION_DEBUG_FILE = 'builder-canary-generation-debug.jsonl';
const PERFORMANCE_TRACE_FILE = 'builder-performance-trace.v1.json';
const EXPECTED_HEADING = 'Focus Timer Ready';
const EXPECTED_SUBTITLE = 'A focused interval for careful work.';
const AGENT_BROWSER_LAYOUT_P95_BUDGET_MS = 8;
const AGENT_BROWSER_OPEN_P95_BUDGET_MS = 25;
const AGENT_BROWSER_CLEANUP_P95_BUDGET_MS = 50;
const BUILD_INSTRUCTION = [
  '在这个空项目中创建一个可直接运行的专注计时器，只创建 index.html、package.json 和 check.js。',
  `index.html 的 h1 必须准确为 "${EXPECTED_HEADING}"，副标题必须准确为 "${EXPECTED_SUBTITLE}"，main 元素必须包含 data-canary-state="complete"。`,
  'CSS 和 JavaScript 必须内联在 index.html；不要使用依赖、外部资源或网络请求，也不要安装软件包。',
  'package.json 必须提供 npm test，且该脚本只能运行 node check.js。',
  'check.js 必须读取 index.html，并验证上述 h1、副标题和 data-canary-state；验证失败时以非零状态退出。',
  '完成文件后不要运行 shell 命令；Builder 会在本轮结束后通过 Main-owned check 运行 npm test。',
  '随后必须调用 browser_open_local_app，确认页面中能看到标题和副标题。',
  '读取 browser_open_local_app 返回的有界 DOM/可访问性、截图状态、Console 和 Network 事实，并据此判断页面是否正确。',
  '最后必须调用 browser_reload_latest_source，再次确认最新标题可见。',
  '只使用 Builder 文件工具和 Agent Test 浏览器工具，每次执行有意义的操作前都用中文简短说明。',
].join(' ');
const PROJECT_USAGE_QUESTION = '这个已经完成的项目应该怎么运行和使用？请根据当前项目文件给出具体步骤。';
const EVENT_TYPES = Object.freeze([
  'assistant/message',
  'tool/call',
  'tool/result',
  'turn/start',
  'turn/end',
]);

class DeepSeekPackagedHarnessCanaryError extends Error {
  constructor(code = 'deepseek_harness_canary_failed', diagnostic = undefined) {
    super('The real-provider Harness coding-loop canary did not complete.');
    this.name = 'DeepSeekPackagedHarnessCanaryError';
    this.code = /^[a-z0-9_]{1,96}$/u.test(code) ? code : 'deepseek_harness_canary_failed';
    this.diagnostic = diagnostic;
    this.stack = `${this.name}: ${this.message}`;
  }
}

function fail(code, diagnostic) {
  throw new DeepSeekPackagedHarnessCanaryError(code, diagnostic);
}

function safeCanaryFailureDiagnostic(error, stage) {
  const source = error?.diagnostic;
  if (
    stage === 'task_proposal'
    && source !== null
    && typeof source === 'object'
    && !Array.isArray(source)
  ) {
    const fixedToken = (value) => (
      typeof value === 'string' && /^[a-z_]{1,64}$/u.test(value) ? value : null
    );
    const proposalText = typeof source.agent_task_proposal_text === 'string'
      ? source.agent_task_proposal_text
      : '';
    return Object.freeze({
      agent_task_proposal_actions_visible: source.agent_task_proposal_actions_visible === true,
      agent_task_proposal_new_project_enabled:
        source.agent_task_proposal_new_project_enabled === true,
      composer_dispatch: fixedToken(source.composer_dispatch),
      composer_mode: fixedToken(source.composer_mode),
      composer_route: fixedToken(source.composer_route),
      composer_text_cleared: source.composer_text === '',
      project_status: fixedToken(source.project_status),
      proposal_contains_new_project_action: proposalText.includes('New project'),
      proposal_contains_task_label: proposalText.includes('Task proposal'),
      stage,
    });
  }
  if (
    stage === 'workspace_bind'
    && source !== null
    && typeof source === 'object'
    && !Array.isArray(source)
    && source.diagnostic_version === 'builder-canary-initial-draft-phase-diagnostic.v1'
    && ['new_project_panel', 'source_folder', 'project_ready'].includes(source.phase)
  ) return Object.freeze({ phase: source.phase, stage });
  return Object.freeze({ stage });
}

function digestText(value) {
  return `sha256:${nodeCrypto.createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

function assertEmptyProjectRoot(projectRoot) {
  if (typeof projectRoot !== 'string' || fs.readdirSync(projectRoot).length !== 0) {
    fail('deepseek_harness_project_root_not_empty');
  }
}

function validateGeneratedProjectContract({
  checkDelayMs = 0,
  checkText,
  indexText,
  packageText,
}) {
  if (!Number.isSafeInteger(checkDelayMs) || checkDelayMs < 0 || checkDelayMs > 100_000) {
    fail('deepseek_harness_generated_contract_invalid');
  }
  let manifest;
  try {
    manifest = JSON.parse(packageText);
  } catch {
    fail('deepseek_harness_generated_contract_failed');
  }
  const dependencyCount = ['dependencies', 'devDependencies', 'optionalDependencies']
    .reduce((count, key) => count + Object.keys(manifest?.[key] ?? {}).length, 0);
  const requiredCheckFacts = [EXPECTED_HEADING, EXPECTED_SUBTITLE, 'data-canary-state'];
  const headingMatches = new RegExp(
    `<h1(?:\\s[^>]*)?>\\s*${EXPECTED_HEADING}\\s*</h1>`,
    'u',
  ).test(indexText);
  const subtitleMatches = indexText.includes(EXPECTED_SUBTITLE);
  const stateMatches = indexText.includes('data-canary-state="complete"');
  const indexFactsMatch = headingMatches && subtitleMatches && stateMatches;
  const checkFactsMatch = requiredCheckFacts.every((fact) => checkText.includes(fact));
  const delayedCheckPresent = checkDelayMs === 0 || (
    checkText.includes('Atomics.wait') && checkText.includes(String(checkDelayMs))
  );
  const testScriptMatches = manifest?.scripts?.test === 'node check.js';
  if (
    !testScriptMatches
    || dependencyCount !== 0
    || !indexFactsMatch
    || !checkFactsMatch
    || !delayedCheckPresent
  ) {
    fail('deepseek_harness_generated_contract_failed', Object.freeze({
      check_facts_match: checkFactsMatch,
      delayed_check_present: delayedCheckPresent,
      dependency_count: dependencyCount,
      heading_matches: headingMatches,
      index_facts_match: indexFactsMatch,
      state_matches: stateMatches,
      subtitle_matches: subtitleMatches,
      test_script_matches: testScriptMatches,
    }));
  }
  return Object.freeze({
    delayed_check_present: delayedCheckPresent,
    dependency_count: dependencyCount,
    test_script: manifest.scripts.test,
  });
}

function walkPlainFiles(root) {
  const files = [];
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const candidate = path.join(current, entry.name);
      if (entry.isSymbolicLink()) fail('deepseek_harness_session_evidence_failed');
      if (entry.isDirectory()) pending.push(candidate);
      else if (entry.isFile()) files.push(candidate);
      else fail('deepseek_harness_session_evidence_failed');
      if (files.length > MAX_SESSION_FILES) fail('deepseek_harness_session_evidence_failed');
    }
  }
  return files;
}

function readHarnessSessionEvidence(sessionRoot, minimumTurnCount = 1) {
  if (!Number.isSafeInteger(minimumTurnCount) || minimumTurnCount < 1 || minimumTurnCount > 8) {
    fail('deepseek_harness_session_evidence_failed');
  }
  if (!fs.statSync(sessionRoot).isDirectory()) fail('deepseek_harness_session_evidence_failed');
  const counts = Object.fromEntries(EVENT_TYPES.map((type) => [type, 0]));
  const toolNames = {};
  const toolCallSequence = [];
  const files = walkPlainFiles(sessionRoot);
  let eventCount = 0;
  for (const filePath of files) {
    const stat = fs.statSync(filePath);
    if (stat.size < 1 || stat.size > MAX_SESSION_FILE_BYTES) {
      fail('deepseek_harness_session_evidence_failed');
    }
    for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/u)) {
      if (line.length === 0) continue;
      let record;
      try { record = JSON.parse(line); } catch { continue; }
      if (record === null || typeof record !== 'object' || Array.isArray(record)) continue;
      if (typeof record.type !== 'string' || !Object.hasOwn(counts, record.type)) continue;
      counts[record.type] += 1;
      eventCount += 1;
      if (record.type === 'tool/call' && typeof record.data?.name === 'string') {
        const name = record.data.name;
        if (/^[a-z][a-z0-9_-]{0,63}$/u.test(name)) {
          toolNames[name] = (toolNames[name] ?? 0) + 1;
          if (toolCallSequence.length < 128) toolCallSequence.push(name);
        }
      }
    }
  }
  if (
    counts['assistant/message'] < 2
    || counts['tool/call'] < 2
    || counts['tool/result'] !== counts['tool/call']
    || counts['turn/start'] < minimumTurnCount
    || counts['turn/end'] !== counts['turn/start']
  ) fail('deepseek_harness_session_evidence_failed', Object.freeze({ counts }));
  return Object.freeze({
    assistant_message_count: counts['assistant/message'],
    file_count: files.length,
    retained_event_count: eventCount,
    tool_call_names: Object.freeze(toolNames),
    tool_call_sequence: Object.freeze(toolCallSequence),
    tool_call_count: counts['tool/call'],
    tool_result_count: counts['tool/result'],
    turn_count: counts['turn/start'],
  });
}

function validateAgentBrowserLoop(session) {
  const sequence = session.tool_call_sequence;
  const openIndex = sequence.indexOf('browser_open_local_app');
  if (openIndex < 0) {
    fail('deepseek_harness_agent_browser_loop_missing', Object.freeze({
      tool_call_names: session.tool_call_names,
    }));
  }
  const lastMutationIndex = sequence.reduce(
    (latest, name, index) => (['edit', 'write'].includes(name) ? index : latest),
    -1,
  );
  const reloadIndex = sequence.lastIndexOf('browser_reload_latest_source');
  const reloadRequired = lastMutationIndex > openIndex;
  if (reloadRequired && reloadIndex < lastMutationIndex) {
    fail('deepseek_harness_agent_browser_loop_missing', Object.freeze({
      reload_required: true,
      tool_call_names: session.tool_call_names,
    }));
  }
  return Object.freeze({
    latest_source_confirmed: true,
    reload_observed: reloadIndex >= 0,
    reload_required: reloadRequired,
  });
}

function readHarnessFailureEvidence(sessionRoot) {
  try {
    const files = walkPlainFiles(sessionRoot);
    const eventCounts = {};
    const turnEndReasons = [];
    const assistantChunkShapes = [];
    for (const filePath of files) {
      for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/u)) {
        if (line.length === 0) continue;
        let record;
        try { record = JSON.parse(line); } catch { continue; }
        if (typeof record?.type !== 'string' || !/^[a-z][a-z/-]{0,63}$/u.test(record.type)) continue;
        eventCounts[record.type] = (eventCounts[record.type] ?? 0) + 1;
        if (record.type === 'assistant/chunk' && assistantChunkShapes.length < 32) {
          const chunk = record.data?.chunk;
          if (chunk !== null && typeof chunk === 'object' && !Array.isArray(chunk)) {
            const chunkType = typeof chunk.type === 'string' && /^[a-z][a-z-]{0,63}$/u.test(chunk.type)
              ? chunk.type
              : 'unknown';
            const block = chunk.block;
            const nestedBlockType = block !== null && typeof block === 'object' && !Array.isArray(block)
              && typeof block.type === 'string' && /^[a-z][a-z-]{0,63}$/u.test(block.type)
              ? block.type
              : null;
            const blockType = nestedBlockType ?? (
              typeof chunk.blockType === 'string' && /^[a-z][a-z-]{0,63}$/u.test(chunk.blockType)
                ? chunk.blockType
                : null
            );
            assistantChunkShapes.push(Object.freeze({
              block_type: blockType,
              chunk_keys: Object.keys(chunk).filter((key) => /^[A-Za-z][A-Za-z0-9]{0,63}$/u.test(key)).sort(),
              chunk_type: chunkType,
              index: Number.isSafeInteger(chunk.index) && chunk.index >= 0 ? chunk.index : null,
            }));
          }
        }
        const reason = record.type === 'turn/end' ? record.data?.reason : null;
        if (typeof reason?.kind !== 'string' || !/^[a-z_]{1,32}$/u.test(reason.kind)) continue;
        const code = reason.kind === 'error' && typeof reason.error?.code === 'string'
          && /^[A-Z0-9_]{1,96}$/u.test(reason.error.code)
          ? reason.error.code
          : null;
        turnEndReasons.push(Object.freeze({ kind: reason.kind, code }));
      }
    }
    return Object.freeze({
      assistant_chunk_shapes: Object.freeze(assistantChunkShapes),
      event_counts: Object.freeze(eventCounts),
      turn_end_reasons: turnEndReasons,
    });
  } catch {
    return null;
  }
}

function readGenerationDebug(userDataRoot) {
  try {
    const source = fs.readFileSync(path.join(userDataRoot.path, GENERATION_DEBUG_FILE), 'utf8');
    return source.trim().split(/\r?\n/u).filter(Boolean).slice(-12).map((line) => {
      const record = JSON.parse(line);
      const safe = (key) => (
        typeof record[key] === 'string' && /^[a-z0-9_]{1,96}$/u.test(record[key])
          ? record[key]
          : 'unknown'
      );
      return Object.freeze({
        code: safe('code'),
        phase: safe('phase'),
        runtime_cause_code: safe('runtime_cause_code'),
        runtime_code: safe('runtime_code'),
      });
    });
  } catch {
    return [];
  }
}

function readFixtureCandidateShape(userDataRoot) {
  try {
    const source = fs.readFileSync(path.join(userDataRoot.path, 'project-root', 'index.html'), 'utf8');
    return Object.freeze({
      byte_length: Buffer.byteLength(source, 'utf8'),
      has_expected_heading: source.includes(`<h1 id="focus-title">${EXPECTED_HEADING}</h1>`),
      has_expected_subtitle: source.includes(EXPECTED_SUBTITLE),
      has_complete_state: source.includes('data-canary-state="complete"'),
    });
  } catch {
    return null;
  }
}

async function delay(milliseconds) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function closeElectronAppBounded(app, timeoutMs = 15_000) {
  const closePromise = Promise.resolve().then(() => app.close());
  const closed = await Promise.race([
    closePromise.then(() => true),
    delay(timeoutMs).then(() => false),
  ]);
  if (closed) return;
  try { app.process().kill(); } catch { /* bounded cleanup reports failure below */ }
  throw new Error('deepseek_harness_app_close_timeout');
}

function isCodingLoopComplete(counts) {
  return counts !== null
    && typeof counts === 'object'
    && counts.run_started_count === 1
    && counts.run_completed_count === 1
    && counts.programming_runtime_check_failed_count >= 1
    && counts.programming_runtime_check_failed_count <= 3
    && counts.programming_runtime_check_passed_count === 1
    && counts.programming_runtime_assistant_message_count >= 2
    && counts.programming_runtime_tool_activity_count >= 4
    && counts.candidate_ready_count === 1;
}

function isCodingLoopTerminal(counts) {
  return counts !== null
    && typeof counts === 'object'
    && counts.run_completed_count === 1
    && counts.programming_runtime_check_passed_count === 1
    && counts.candidate_ready_count === 1;
}

function isNoToolBuildCompletion(counts) {
  return counts !== null
    && typeof counts === 'object'
    && counts.run_started_count === 1
    && counts.run_completed_count === 1
    && counts.candidate_ready_count === 0
    && counts.programming_runtime_tool_activity_count === 0;
}

function assertMinimumRunDuration(durationMs, minimumRunDurationMs) {
  if (
    !Number.isSafeInteger(durationMs)
    || durationMs < 0
    || !Number.isSafeInteger(minimumRunDurationMs)
    || minimumRunDurationMs < 0
  ) fail('deepseek_harness_soak_duration_invalid');
  if (durationMs < minimumRunDurationMs) {
    fail('deepseek_harness_soak_duration_failed', Object.freeze({
      coding_loop_duration_ms: durationMs,
      minimum_run_duration_ms: minimumRunDurationMs,
    }));
  }
}

function validateAgentBrowserSurfaceEvidence(value) {
  const rectangle = (candidate) => (
    candidate !== null
    && typeof candidate === 'object'
    && Number.isFinite(candidate.x)
    && Number.isFinite(candidate.y)
    && Number.isFinite(candidate.width)
    && Number.isFinite(candidate.height)
    && candidate.width > 0
    && candidate.height > 0
  );
  if (
    value === null
    || typeof value !== 'object'
    || value.active_tab !== 'browser_placeholder'
    || value.surface_visible !== true
    || !rectangle(value.sidebar_bounds)
    || !rectangle(value.surface_bounds)
  ) fail('deepseek_harness_agent_browser_surface_invalid');
  const sidebar = value.sidebar_bounds;
  const surface = value.surface_bounds;
  const tolerance = 1;
  if (
    surface.x < sidebar.x - tolerance
    || surface.y < sidebar.y - tolerance
    || surface.x + surface.width > sidebar.x + sidebar.width + tolerance
    || surface.y + surface.height > sidebar.y + sidebar.height + tolerance
  ) fail('deepseek_harness_agent_browser_surface_outside_sidebar');
  return Object.freeze({
    active_tab: value.active_tab,
    sidebar_bounds: Object.freeze({ ...sidebar }),
    surface_bounds: Object.freeze({ ...surface }),
    surface_visible: true,
  });
}

async function waitForAgentBrowserSurface(page, timeoutMs = DEFAULT_CODING_LOOP_TIMEOUT_MS) {
  const sidebar = page.locator('[data-builder-artifact-sidebar="true"]').first();
  const surface = page.locator('[data-builder-agent-test-browser-surface="true"]').first();
  await surface.waitFor({ state: 'visible', timeout: timeoutMs });
  const [activeTab, sidebarBounds, surfaceBounds] = await Promise.all([
    sidebar.getAttribute('data-builder-artifact-tab-active'),
    sidebar.boundingBox(),
    surface.boundingBox(),
  ]);
  return validateAgentBrowserSurfaceEvidence({
    active_tab: activeTab,
    sidebar_bounds: sidebarBounds,
    surface_bounds: surfaceBounds,
    surface_visible: await surface.isVisible(),
  });
}

async function readLoopbackWebContentsCount(app) {
  return app.evaluate(({ webContents }) => webContents.getAllWebContents()
    .filter((item) => !item.isDestroyed() && /^http:\/\/127\.0\.0\.1:\d+\//u.test(item.getURL()))
    .length);
}

function qualifyAgentBrowserPerformance(trace) {
  const metric = (name) => {
    try {
      return requiredMetric(trace, name);
    } catch {
      fail('deepseek_harness_agent_browser_performance_metric_missing', Object.freeze({ name }));
    }
  };
  const layout = metric('main.agent_test_browser.layout.duration_ms');
  const open = metric('main.browser_session.open.duration_ms');
  const cleanup = metric('main.browser_session.cleanup.duration_ms');
  if (
    layout.p95 > AGENT_BROWSER_LAYOUT_P95_BUDGET_MS
    || open.p95 > AGENT_BROWSER_OPEN_P95_BUDGET_MS
    || cleanup.p95 > AGENT_BROWSER_CLEANUP_P95_BUDGET_MS
  ) {
    fail('deepseek_harness_agent_browser_performance_failed', Object.freeze({
      cleanup_p95_budget_ms: AGENT_BROWSER_CLEANUP_P95_BUDGET_MS,
      cleanup_p95_ms: cleanup.p95,
      layout_p95_budget_ms: AGENT_BROWSER_LAYOUT_P95_BUDGET_MS,
      layout_p95_ms: layout.p95,
      open_p95_budget_ms: AGENT_BROWSER_OPEN_P95_BUDGET_MS,
      open_p95_ms: open.p95,
    }));
  }
  return Object.freeze({
    cleanup_p95_budget_ms: AGENT_BROWSER_CLEANUP_P95_BUDGET_MS,
    cleanup_p95_ms: cleanup.p95,
    layout_p95_budget_ms: AGENT_BROWSER_LAYOUT_P95_BUDGET_MS,
    layout_p95_ms: layout.p95,
    open_p95_budget_ms: AGENT_BROWSER_OPEN_P95_BUDGET_MS,
    open_p95_ms: open.p95,
    privacy_verified: trace.privacy?.content_fields_recorded === false
      && trace.privacy?.identifiers_recorded === false
      && trace.privacy?.paths_recorded === false
      && trace.privacy?.urls_recorded === false,
  });
}

function readAgentBrowserPerformanceTrace(userDataPath) {
  const tracePath = path.join(userDataPath, PERFORMANCE_TRACE_FILE);
  try {
    return readMainPerformanceTrace(userDataPath);
  } catch {
    let raw = null;
    let bytes = 0;
    try {
      const source = fs.readFileSync(tracePath, 'utf8');
      bytes = Buffer.byteLength(source, 'utf8');
      raw = JSON.parse(source);
    } catch { /* bounded structural diagnostic below */ }
    fail('deepseek_harness_agent_browser_performance_trace_invalid', Object.freeze({
      bytes,
      exists: fs.existsSync(tracePath),
      metric_names: Array.isArray(raw?.metrics)
        ? raw.metrics.flatMap((metric) => (
          typeof metric?.name === 'string' && /^(?:main|renderer)\.[a-z0-9_.]+$/u.test(metric.name)
            ? [metric.name]
            : []
        ))
        : [],
      privacy: raw?.privacy ?? null,
      trace_version: typeof raw?.trace_version === 'string' ? raw.trace_version : null,
    }));
  }
}

async function waitForCodingLoop(
  page,
  projectId,
  userDataRoot,
  completionPredicate = isCodingLoopComplete,
  timeoutMs = DEFAULT_CODING_LOOP_TIMEOUT_MS,
) {
  const deadline = Date.now() + timeoutMs;
  let counts = null;
  while (Date.now() < deadline) {
    const taskStream = await readSanitizedTaskStreamEvidence(page, projectId).catch(() => null);
    counts = taskStream?.conversation?.item_facts?.counts ?? null;
    if (await page.locator(SELECTORS.generationFailedNotice).first().isVisible().catch(() => false)) {
      const publicState = await page.evaluate(({ noticeSelector, pageSelector }) => {
        const notice = globalThis.document.querySelector(noticeSelector);
        const projectPage = globalThis.document.querySelector(pageSelector);
        return {
          notice_kind: notice?.getAttribute('data-builder-conversation-notice') ?? null,
          project_error: projectPage?.getAttribute('data-builder-project-error') ?? null,
          project_status: projectPage?.getAttribute('data-builder-project-status') ?? null,
        };
      }, { noticeSelector: SELECTORS.generationFailedNotice, pageSelector: SELECTORS.projectPage });
      fail('deepseek_harness_generation_failed', Object.freeze({
        counts,
        generation_debug: readGenerationDebug(userDataRoot),
        harness_failure: readHarnessFailureEvidence(path.join(
          userDataRoot.path,
          HARNESS_SESSION_DIRECTORY,
        )),
        public_state: publicState,
      }));
    }
    if (completionPredicate(counts) || isCodingLoopTerminal(counts)) return counts;
    if (
      taskStream?.conversation?.recorded_active_turn_id === null
      && isNoToolBuildCompletion(counts)
    ) {
      fail('deepseek_harness_no_tool_build_completed', Object.freeze({ counts }));
    }
    if (
      taskStream?.conversation?.recorded_active_turn_id === null
      && counts?.run_completed_count === 1
      && counts?.candidate_ready_count === 1
      && counts?.programming_runtime_check_failed_count >= 4
      && counts?.programming_runtime_check_passed_count === 0
    ) {
      fail('deepseek_harness_check_repair_exhausted', Object.freeze({
        candidate_shape: readFixtureCandidateShape(userDataRoot),
        counts,
        harness_failure: readHarnessFailureEvidence(path.join(
          userDataRoot.path,
          HARNESS_SESSION_DIRECTORY,
        )),
      }));
    }
    await delay(1_000);
  }
  const publicState = await page.evaluate(({ pageSelector }) => {
    const projectPage = globalThis.document.querySelector(pageSelector);
    return {
      project_error: projectPage?.getAttribute('data-builder-project-error') ?? null,
      project_status: projectPage?.getAttribute('data-builder-project-status') ?? null,
    };
  }, { pageSelector: SELECTORS.projectPage }).catch(() => null);
  fail('deepseek_harness_task_stream_failed', Object.freeze({
    counts,
    generation_debug: readGenerationDebug(userDataRoot),
    harness_failure: readHarnessFailureEvidence(path.join(
      userDataRoot.path,
      HARNESS_SESSION_DIRECTORY,
    )),
    public_state: publicState,
  }));
}

async function readCurrentDraftFile(page, filePath) {
  const panel = page.locator(SELECTORS.sideWorkspaceFiles).first();
  if (!await panel.isVisible().catch(() => false)) {
    await page.locator(SELECTORS.workspaceMenuButton).first().click();
    await page.locator(SELECTORS.workspaceControlSource).first().click();
  }
  await panel.waitFor({ state: 'visible', timeout: 30_000 });
  const entry = page.locator(`[data-builder-side-workspace-file-entry="${filePath}"]`).first();
  await entry.waitFor({ state: 'visible', timeout: 30_000 });
  await entry.click();
  const content = page.locator(
    `[data-builder-side-workspace-file-content="${filePath}"][data-builder-side-workspace-file-content-status="ready"]`,
  ).first();
  await content.waitFor({ state: 'visible', timeout: 30_000 });
  const lines = await content.locator('[data-builder-side-workspace-code-line] code').allTextContents();
  return `${lines.map((line) => (line === ' ' ? '' : line)).join('\n')}\n`;
}

async function waitForCurrentDraftFile(page, filePath, predicate) {
  const deadline = Date.now() + 60_000;
  let value = null;
  while (Date.now() < deadline) {
    value = await readCurrentDraftFile(page, filePath).catch(() => null);
    if (typeof value === 'string' && predicate(value)) return value;
    await delay(100);
  }
  fail('deepseek_harness_candidate_evidence_failed', Object.freeze({ file: filePath }));
}

async function readChatEvidence(page) {
  return page.evaluate(() => {
    const entries = Array.from(globalThis.document.querySelectorAll(
      '[data-builder-runtime-assistant-message], [data-builder-runtime-tool-kind]',
    )).map((node) => ({
      kind: node.hasAttribute('data-builder-runtime-assistant-message') ? 'narration' : 'tool',
      toolKind: node.getAttribute('data-builder-runtime-tool-kind'),
      text: node.textContent?.trim() ?? '',
    }));
    const narration = entries.filter((entry) => entry.kind === 'narration');
    const firstNarration = entries.findIndex((entry) => entry.kind === 'narration');
    const firstTool = entries.findIndex((entry) => entry.kind === 'tool');
    const toolNodes = Array.from(globalThis.document.querySelectorAll(
      '[data-builder-runtime-tool-kind]',
    ));
    const completionNodes = Array.from(globalThis.document.querySelectorAll(
      '[data-builder-activity-card="Draft proposed"]',
    ));
    const finalTool = toolNodes.at(-1) ?? null;
    const finalCompletion = completionNodes.at(-1) ?? null;
    const body = globalThis.document.body.innerText;
    return {
      final_summary_after_last_tool: finalTool !== null
        && finalCompletion !== null
        && Boolean(finalTool.compareDocumentPosition(finalCompletion)
          & globalThis.Node.DOCUMENT_POSITION_FOLLOWING),
      final_summary_contains_chinese: /[\u3400-\u9fff]/u.test(finalCompletion?.textContent ?? ''),
      final_summary_count: completionNodes.length,
      fixed_lifecycle_copy_visible: body.includes('Preparing review') || body.includes('Changing files'),
      narration_count: narration.length,
      narration_all_contains_chinese: narration.every((entry) => /[\u3400-\u9fff]/u.test(entry.text)),
      narration_precedes_first_tool: firstNarration >= 0 && firstTool >= 0 && firstNarration < firstTool,
      tool_kinds: [...new Set(entries.flatMap((entry) => (
        entry.kind === 'tool' && entry.toolKind !== null ? [entry.toolKind] : []
      )))],
    };
  });
}

async function verifyProjectUsageFollowUp(page, projectId, countsBefore) {
  const answersBefore = await page.locator(SELECTORS.questionAnswer).count().catch(() => 0);
  await page.locator(SELECTORS.composerAddMenuButton).click();
  const askMode = page.locator(SELECTORS.composerAddAskMode);
  await askMode.waitFor({ state: 'visible', timeout: 10_000 });
  await askMode.click();
  await page.locator('[data-builder-composer-mode-chip="ask"]')
    .waitFor({ state: 'visible', timeout: 10_000 });
  await page.locator(SELECTORS.idea).fill(PROJECT_USAGE_QUESTION);
  await page.waitForFunction((selector) => {
    const submit = globalThis.document.querySelector(selector);
    return submit instanceof globalThis.HTMLButtonElement && submit.disabled === false;
  }, SELECTORS.submitTurn, { timeout: 10_000 });
  await page.locator(SELECTORS.submitTurn).click();
  const answer = page.locator(SELECTORS.questionAnswer).nth(answersBefore);
  await answer.waitFor({ state: 'visible', timeout: 180_000 });
  const answerText = (await answer.textContent())?.trim() ?? '';
  const deadline = Date.now() + 30_000;
  let countsAfter = null;
  while (Date.now() < deadline) {
    const stream = await readSanitizedTaskStreamEvidence(page, projectId).catch(() => null);
    countsAfter = stream?.conversation?.item_facts?.counts ?? null;
    if (
      countsAfter?.explanation_result_count === (countsBefore.explanation_result_count ?? 0) + 1
      && countsAfter?.candidate_ready_count === countsBefore.candidate_ready_count
    ) break;
    await delay(250);
  }
  if (
    !/[\u3400-\u9fff]/u.test(answerText)
    || !/(?:index\.html|npm|package\.json)/iu.test(answerText)
    || countsAfter?.explanation_result_count !== (countsBefore.explanation_result_count ?? 0) + 1
    || countsAfter?.candidate_ready_count !== countsBefore.candidate_ready_count
    || !await page.locator(SELECTORS.unsavedDraft).first().isVisible().catch(() => false)
  ) {
    fail('deepseek_harness_usage_follow_up_failed', Object.freeze({
      answer_contains_chinese: /[\u3400-\u9fff]/u.test(answerText),
      answer_mentions_project_entry_or_command: /(?:index\.html|npm|package\.json)/iu.test(answerText),
      candidate_count_after: countsAfter?.candidate_ready_count ?? null,
      candidate_count_before: countsBefore.candidate_ready_count,
      explanation_count_after: countsAfter?.explanation_result_count ?? null,
      explanation_count_before: countsBefore.explanation_result_count ?? 0,
    }));
  }
  return Object.freeze({
    answer_contains_chinese: true,
    answer_grounded_in_project_files: true,
    candidate_unchanged: true,
  });
}

async function readContextUsageEvidence(page, projectId) {
  const taskStream = await readSanitizedTaskStreamEvidence(page, projectId);
  const projection = taskStream?.context_usage_projection;
  const meter = page.locator('[data-builder-composer-context-button="true"]').first();
  const tooltip = page.locator('[data-builder-composer-context-tooltip="true"]').first();
  const [pressure, projected, tooltipText] = await Promise.all([
    meter.getAttribute('data-builder-composer-context-pressure'),
    meter.getAttribute('data-builder-composer-context-projected'),
    tooltip.textContent(),
  ]);
  if (
    projection?.projection_version !== 'builder-context-usage-projection.v2'
    || projection.source !== 'deepseek_harness_session_projection'
    || projection.measurement_state !== 'ready'
    || !Number.isSafeInteger(projection.pressure_tokens)
    || projection.pressure_tokens < 1
    || !Number.isSafeInteger(projection.projected_tokens)
    || projection.projected_tokens < 1
    || !Number.isSafeInteger(projection.context_window_tokens)
    || projection.context_window_tokens < 1
    || !Number.isSafeInteger(projection.cache_read_tokens)
    || projection.cache_read_tokens < 1
    || !Number.isSafeInteger(projection.cache_hit_percent)
    || projection.cache_hit_percent < 1
    || pressure !== String(projection.pressure_tokens)
    || projected !== String(projection.projected_tokens)
    || !tooltipText?.includes(`Cache hit ${projection.cache_hit_percent}%`)
  ) {
    fail('deepseek_harness_context_usage_failed', Object.freeze({
      cache_hit_percent: projection?.cache_hit_percent ?? null,
      cache_read_tokens: projection?.cache_read_tokens ?? null,
      context_window_tokens: projection?.context_window_tokens ?? null,
      measurement_state: projection?.measurement_state ?? null,
      pressure_matches: pressure === String(projection?.pressure_tokens),
      projected_matches: projected === String(projection?.projected_tokens),
      projection_version: projection?.projection_version ?? null,
      source: projection?.source ?? null,
      tooltip_cache_visible: tooltipText?.includes('Cache hit') === true,
    }));
  }
  return Object.freeze({
    cache_hit_percent: projection.cache_hit_percent,
    cache_read_tokens: projection.cache_read_tokens,
    cache_write_tokens: projection.cache_write_tokens,
    context_window_tokens: projection.context_window_tokens,
    pressure_tokens: projection.pressure_tokens,
    projected_tokens: projection.projected_tokens,
    uncached_input_tokens: projection.uncached_input_tokens,
    usage_percent: projection.usage_percent,
  });
}

function removeGuardedRoot(root) {
  const current = captureGuardedUserDataRoot(root.path, fs, os);
  if (
    current.realPath.toLowerCase() !== root.realPath.toLowerCase()
    || current.path.toLowerCase() !== root.path.toLowerCase()
  ) {
    fail('deepseek_harness_cleanup_failed');
  }
  fs.rmSync(root.path, { recursive: true, force: true });
}

function providerEvidence(input) {
  const config = input.mode === 'saved_profile'
    ? inspectSavedProfileDeepSeekConfig(input.source_user_data_path)
    : { base_url: DEEPSEEK_V4_BASE_URL, model: input.model, profile_config_verified: false };
  return Object.freeze({
    endpoint_digest: digestText(config.base_url),
    model_digest: digestText(config.model),
    profile_config_verified: config.profile_config_verified === true,
    provider_family: 'deepseek_v4_openai_compatible',
  });
}

async function runDeepSeekPackagedHarnessCanary(rawInput, options = {}) {
  const input = sanitizeDeepSeekCanaryInput(rawInput);
  const packagedInput = toPackagedCanaryInput(input);
  const buildInstruction = typeof options.buildInstruction === 'string'
    && options.buildInstruction.length > 0
    ? options.buildInstruction
    : BUILD_INSTRUCTION;
  const minimumRunDurationMs = Number.isSafeInteger(options.minimumRunDurationMs)
    && options.minimumRunDurationMs >= 0
    ? options.minimumRunDurationMs
    : 0;
  const requiredDraftFiles = Array.isArray(options.requiredDraftFiles)
    ? options.requiredDraftFiles
    : [];
  const resultVersion = typeof options.resultVersion === 'string'
    && /^builder-[a-z0-9.-]{1,96}$/u.test(options.resultVersion)
    ? options.resultVersion
    : RESULT_VERSION;
  const completionPredicate = typeof options.completionPredicate === 'function'
    ? options.completionPredicate
    : isCodingLoopComplete;
  const codingLoopTimeoutMs = Number.isSafeInteger(options.codingLoopTimeoutMs)
    && options.codingLoopTimeoutMs >= 30_000
    && options.codingLoopTimeoutMs <= 900_000
    ? options.codingLoopTimeoutMs
    : DEFAULT_CODING_LOOP_TIMEOUT_MS;
  const checkDelayMs = Number.isSafeInteger(options.checkDelayMs)
    && options.checkDelayMs >= 0
    && options.checkDelayMs <= 100_000
    ? options.checkDelayMs
    : 0;
  const minimumSessionTurnCount = Number.isSafeInteger(options.minimumSessionTurnCount)
    && options.minimumSessionTurnCount >= 1
    && options.minimumSessionTurnCount <= 8
    ? options.minimumSessionTurnCount
    : 1;
  const argv = options.argv ?? process.argv.slice(2);
  const sourceEnv = options.env ?? process.env;
  const selectedElectron = options.electron ?? electron;
  const rawUserDataPath = options.userDataPath
    ?? fs.mkdtempSync(path.join(os.tmpdir(), PACKAGED_CANARY_USER_DATA_PREFIX));
  let app = null;
  let root = null;
  let stage = 'setup';
  let result = null;
  let primaryError = null;
  let launchEnvironment = null;
  try {
    root = captureGuardedUserDataRoot(rawUserDataPath, fs, os);
    const projectRoot = createCanaryProjectRoot(root, fs, os);
    copySavedProviderProfile(packagedInput, root, fs);
    if (input.mode !== 'saved_profile') {
      ensureCredentialOnlyFromStdin(input.credential, argv, sourceEnv);
    }
    const env = { ...sourceEnv };
    delete env.BUILDER_PROGRAMMING_RUNTIME;
    delete env.BUILDER_HARNESS_RUNTIME_ROOT;
    launchEnvironment = Object.freeze({
      ...sanitizeLaunchEnvironment(env, root.path, projectRoot),
      BUILDER_PERF_TRACE: '1',
    });
    stage = 'launch';
    app = await selectedElectron.launch({
      args: [],
      executablePath: packagedInput.executable_path,
      env: launchEnvironment,
    });
    const page = await app.firstWindow();
    await assertCustomChromeControls(page);
    if (input.mode !== 'saved_profile') {
      const gate = createArtifactGate();
      await fillProviderSettingsViaUi(page, packagedInput.provider, gate);
    }
    stage = 'empty_project';
    assertEmptyProjectRoot(projectRoot);
    stage = 'task_proposal';
    const codingLoopStartedAtMs = Date.now();
    await requireBuildWorkspaceBeforeDraftViaUi(page, buildInstruction);
    stage = 'write_approval';
    await approveCurrentProjectWriteIfRequested(page);
    stage = 'project_identity';
    const projectId = await page.locator('[data-builder-route-project-id]').first()
      .getAttribute('data-builder-route-project-id');
    if (!/^builder-project:[0-9a-f-]{36}$/u.test(projectId ?? '')) {
      fail('deepseek_harness_project_identity_failed');
    }
    stage = 'coding_loop';
    const browserSurfacePromise = waitForAgentBrowserSurface(page)
      .then((evidence) => Object.freeze({ evidence, ok: true }))
      .catch((error) => Object.freeze({ error, ok: false }));
    const counts = await waitForCodingLoop(
      page,
      projectId,
      root,
      completionPredicate,
      codingLoopTimeoutMs,
    );
    const codingLoopDurationMs = Date.now() - codingLoopStartedAtMs;
    if (counts !== null && !completionPredicate(counts) && !isCodingLoopTerminal(counts)) {
      fail('deepseek_harness_task_stream_failed', Object.freeze({ counts }));
    }
    const browserSurfaceResult = await Promise.race([
      browserSurfacePromise,
      new Promise((resolve) => setTimeout(() => resolve(Object.freeze({
        error: new Error('agent_test_browser_surface_terminal_grace_elapsed'),
        ok: false,
      })), 5_000)),
    ]);
    if (!browserSurfaceResult.ok) {
      fail('deepseek_harness_agent_browser_surface_missing');
    }
    await page.locator('[data-builder-agent-test-browser-surface="true"]').first()
      .waitFor({ state: 'hidden', timeout: 30_000 });
    assertMinimumRunDuration(codingLoopDurationMs, minimumRunDurationMs);
    stage = 'candidate';
    const indexText = await waitForCurrentDraftFile(page, 'index.html', (text) => (
      text.includes(EXPECTED_HEADING) && text.includes('data-canary-state="complete"')
    ));
    const checkText = await waitForCurrentDraftFile(page, 'check.js', () => true);
    const packageText = await waitForCurrentDraftFile(page, 'package.json', () => true);
    for (const requiredFile of requiredDraftFiles) {
      await waitForCurrentDraftFile(page, requiredFile, (text) => text.trim().length > 0);
    }
    const generatedProjectContract = validateGeneratedProjectContract({
      checkDelayMs,
      checkText,
      indexText,
      packageText,
    });
    const chat = await readChatEvidence(page);
    if (
      chat.narration_count < 2
      || chat.narration_precedes_first_tool !== true
      || chat.narration_all_contains_chinese !== true
      || chat.final_summary_after_last_tool !== true
      || chat.final_summary_contains_chinese !== true
      || chat.final_summary_count !== 1
      || chat.fixed_lifecycle_copy_visible
      || !chat.tool_kinds.includes('write')
      || !chat.tool_kinds.includes('command')
      || !chat.tool_kinds.includes('browser')
    ) fail('deepseek_harness_chat_flow_failed', chat);
    stage = 'usage_follow_up';
    const usageFollowUp = counts === null
      ? Object.freeze({
        answer_contains_chinese: false,
        answer_grounded_in_project_files: false,
        candidate_unchanged: true,
        skipped_due_to_windowed_task_stream: true,
      })
      : await verifyProjectUsageFollowUp(page, projectId, counts);
    stage = 'context_usage';
    const contextUsage = await readContextUsageEvidence(page, projectId);
    stage = 'session';
    const session = readHarnessSessionEvidence(
      path.join(root.path, HARNESS_SESSION_DIRECTORY),
      minimumSessionTurnCount,
    );
    if ((session.tool_call_names.bash ?? 0) !== 0) {
      fail('deepseek_harness_bash_tool_exposed', Object.freeze({
        tool_call_names: session.tool_call_names,
      }));
    }
    const agentBrowserLoop = validateAgentBrowserLoop(session);
    stage = 'save_version';
    const saveVersion = page.locator(SELECTORS.saveVersion).first();
    await saveVersion.waitFor({ state: 'visible', timeout: 30_000 });
    await saveVersion.click();
    await page.locator(SELECTORS.versionSavedActivity).first()
      .waitFor({ state: 'visible', timeout: 30_000 });
    await page.locator(SELECTORS.unsavedDraft).first()
      .waitFor({ state: 'hidden', timeout: 30_000 });
    await saveVersion.waitFor({ state: 'hidden', timeout: 30_000 });
    result = Object.freeze({
      result_version: resultVersion,
      runtime_kind: 'deepseek_harness.v1',
      ...providerEvidence(input),
      automatic_check_failed_then_passed:
        (counts?.programming_runtime_check_failed_count ?? 0) >= 1
        && (counts?.programming_runtime_check_failed_count ?? 0) <= 3
        && counts?.programming_runtime_check_passed_count === 1,
      automatic_check_passed: counts === null
        ? true
        : counts.programming_runtime_check_passed_count === 1,
      candidate_digest: digestText(indexText),
      candidate_recoverable_without_save: true,
      chat_narration_precedes_tools: true,
      chat_narration_is_chinese: true,
      final_summary_after_last_tool: true,
      bash_tool_hidden_from_harness: true,
      agent_browser_opened_current_run_source: true,
      agent_browser_reloaded_latest_run_source: agentBrowserLoop.latest_source_confirmed,
      agent_browser_reload_observed: agentBrowserLoop.reload_observed,
      agent_browser_reload_required: agentBrowserLoop.reload_required,
      agent_browser_right_sidebar_surface: browserSurfaceResult.evidence,
      agent_browser_surface_closed_after_run: true,
      final_summary_is_chinese: true,
      final_summary_visible_once: true,
      explicit_build_mode_used: true,
      fixed_lifecycle_copy_hidden: true,
      generated_check_delay_ms: checkDelayMs,
      generated_project_contract: generatedProjectContract,
      harness_session: session,
      coding_loop_duration_ms: codingLoopDurationMs,
      context_usage: contextUsage,
      context_usage_cache_hit_visible: true,
      context_usage_main_renderer_match: true,
      minimum_run_duration_ms: minimumRunDurationMs,
      minimum_session_turn_count: minimumSessionTurnCount,
      generated_project_contract_verified: true,
      project_usage_answer_grounded_in_current_draft: usageFollowUp.answer_grounded_in_project_files,
      project_usage_answer_is_chinese: usageFollowUp.answer_contains_chinese,
      project_usage_question_did_not_create_candidate: usageFollowUp.candidate_unchanged,
      project_usage_follow_up_skipped_due_windowed_task_stream:
        usageFollowUp.skipped_due_to_windowed_task_stream === true,
      required_draft_file_count: requiredDraftFiles.length,
      save_version_completed: true,
      save_version_required: true,
    });
  } catch (error) {
    primaryError = error instanceof DeepSeekPackagedHarnessCanaryError
      ? error
      : new DeepSeekPackagedHarnessCanaryError(
        typeof error?.code === 'string' && /^[a-z0-9_]{1,96}$/u.test(error.code)
          ? error.code
          : 'deepseek_harness_canary_failed',
        safeCanaryFailureDiagnostic(error, stage),
      );
  }
  try {
    if (app !== null) {
      await closeElectronAppBounded(app);
      app = null;
    }
  } catch {
    if (primaryError === null) primaryError = new DeepSeekPackagedHarnessCanaryError('deepseek_harness_cleanup_failed');
  }
  if (primaryError === null && root !== null && launchEnvironment !== null && result !== null) {
    try {
      stage = 'performance_trace';
      const performance = qualifyAgentBrowserPerformance(readAgentBrowserPerformanceTrace(root.path));
      stage = 'restart_launch';
      app = await selectedElectron.launch({
        args: [],
        executablePath: packagedInput.executable_path,
        env: launchEnvironment,
      });
      stage = 'restart_cleanup';
      const restartedPage = await app.firstWindow();
      await assertCustomChromeControls(restartedPage);
      const [agentSurfaceVisible, loopbackWebContentsCount, userWebNavigated] = await Promise.all([
        restartedPage.locator('[data-builder-agent-test-browser-surface="true"]').first()
          .isVisible().catch(() => false),
        readLoopbackWebContentsCount(app),
        restartedPage.locator('[data-builder-user-web-surface="true"]').first()
          .evaluate((node) => node.getAttribute('data-current-url') !== null).catch(() => false),
      ]);
      if (agentSurfaceVisible || loopbackWebContentsCount !== 0 || userWebNavigated) {
        fail('deepseek_harness_agent_browser_restart_cleanup_failed', Object.freeze({
          agent_surface_visible: agentSurfaceVisible,
          loopback_webcontents_count: loopbackWebContentsCount,
          user_web_navigated: userWebNavigated,
        }));
      }
      result = Object.freeze({
        ...result,
        agent_browser_performance: performance,
        app_restart_no_agent_test_surface: true,
        app_restart_no_loopback_webcontents: true,
        app_restart_user_web_requires_navigation: true,
      });
      await closeElectronAppBounded(app);
      app = null;
    } catch (error) {
      primaryError = error instanceof DeepSeekPackagedHarnessCanaryError
        ? error
        : new DeepSeekPackagedHarnessCanaryError('deepseek_harness_restart_cleanup_failed', { stage });
    }
  }
  try { if (app !== null) await closeElectronAppBounded(app); } catch {
    if (primaryError === null) primaryError = new DeepSeekPackagedHarnessCanaryError('deepseek_harness_cleanup_failed');
  }
  try { if (root !== null) removeGuardedRoot(root); } catch {
    if (primaryError === null) primaryError = new DeepSeekPackagedHarnessCanaryError('deepseek_harness_cleanup_failed');
  }
  if (primaryError !== null) throw primaryError;
  return result;
}

async function runCli({ argv = process.argv.slice(2), stdin = process.stdin, stdout = process.stdout } = {}) {
  if (!Array.isArray(argv) || argv.length !== 1 || argv[0] !== '--execute') {
    fail('deepseek_harness_canary_input_invalid');
  }
  const result = await runDeepSeekPackagedHarnessCanary(
    parseDeepSeekCanaryInput(await readStdin(stdin)),
    { argv },
  );
  stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

module.exports = Object.freeze({
  BUILD_INSTRUCTION,
  DEFAULT_CODING_LOOP_TIMEOUT_MS,
  DeepSeekPackagedHarnessCanaryError,
  RESULT_VERSION,
  PROJECT_USAGE_QUESTION,
  assertEmptyProjectRoot,
  assertMinimumRunDuration,
  isCodingLoopComplete,
  isCodingLoopTerminal,
  isNoToolBuildCompletion,
  readFixtureCandidateShape,
  readGenerationDebug,
  readContextUsageEvidence,
  readHarnessFailureEvidence,
  readHarnessSessionEvidence,
  runCli,
  runDeepSeekPackagedHarnessCanary,
  validateGeneratedProjectContract,
  validateAgentBrowserLoop,
  validateAgentBrowserSurfaceEvidence,
  waitForAgentBrowserSurface,
});

if (require.main === module) {
  runCli().catch((error) => {
    const fixed = error instanceof DeepSeekPackagedHarnessCanaryError
      ? error
      : new DeepSeekPackagedHarnessCanaryError();
    process.stderr.write(`${JSON.stringify({
      ok: false,
      code: fixed.code,
      message: fixed.message,
      diagnostic: fixed.diagnostic,
    })}\n`);
    process.exitCode = 1;
  });
}
