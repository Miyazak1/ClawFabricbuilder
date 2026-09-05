'use strict';

const {
  DeepSeekPackagedHarnessCanaryError,
  runDeepSeekPackagedHarnessCanary,
} = require('./verify-deepseek-packaged-harness-canary.cjs');
const {
  parseDeepSeekCanaryInput,
} = require('./verify-deepseek-packaged-canary.cjs');
const {
  readStdin,
} = require('./verify-packaged-canary.cjs');

const RESULT_VERSION = 'builder-deepseek-packaged-harness-soak-result.v1';
const MINIMUM_RUN_DURATION_MS = 120_001;
const CHECK_DELAY_MS = 90_000;
const CODING_LOOP_TIMEOUT_MS = 600_000;
const REQUIRED_DRAFT_FILES = Object.freeze([
  'README.md',
  'styles/base.css',
  'styles/layout.css',
  'styles/components.css',
  'js/state/store.js',
  'js/utils/storage.js',
  'js/components/timer.js',
  'js/components/tasks.js',
  'js/components/filters.js',
  'js/components/stats.js',
  'js/app.js',
]);
const LONG_RUN_BUILD_INSTRUCTION = [
  '请在这个空项目中构建一个精致、可访问、响应式的专注规划应用。',
  '这是一次真实长运行 soak：必须在一次 Build 运行中完成完整实现，并在每组有意义的工具操作前用中文给出简短自然语言进度说明。',
  '创建 package.json，其中 npm test 命令必须准确为 "node check.js"，并且不要添加任何依赖。',
  '创建 check.js，使它先用 Atomics.wait 准确等待 90000 milliseconds，然后读取 index.html；如果必需标题、副标题和状态不存在，必须以非零状态失败。',
  '创建 index.html，其中 h1 必须准确为 <h1 id="focus-title">Focus Timer Ready</h1>，页面必须包含副标题 "A focused interval for careful work."，并且 main 元素必须包含 data-canary-state="complete"。',
  '准确创建这些额外的非空模块：README.md、styles/base.css、styles/layout.css、styles/components.css、js/state/store.js、js/utils/storage.js、js/components/timer.js、js/components/tasks.js、js/components/filters.js、js/components/stats.js 和 js/app.js。除 index.html、package.json、check.js 和这些模块外，不要创建任何其它文件。',
  '实现可用的计时器、任务列表、优先级过滤、进度统计、本地持久化、键盘友好控件、reduced-motion 支持、响应式布局和克制的视觉打磨；不要使用外部网络资源。',
  '把所有模块接入 index.html，并让实现保持简洁但功能完整；不要创建只有占位内容的文件。',
  '不要运行 shell 命令；完成文件后使用 browser_open_local_app 和 browser_reload_latest_source，通过有界 DOM/accessibility、截图、Console 和 Network 事实验证最新页面，Builder 会在本轮结束后通过 Main-owned check 运行 npm test。',
  '只使用 Builder 文件工具和 Agent Test 浏览器工具，并在结尾用中文简洁总结改动文件和实际观察到的验证。',
].join(' ');

function isSoakCodingLoopComplete(counts) {
  return counts !== null
    && typeof counts === 'object'
    && counts.run_started_count === 1
    && counts.run_completed_count === 1
    && counts.programming_runtime_check_passed_count === 1
    && counts.programming_runtime_assistant_message_count >= 2
    && counts.programming_runtime_tool_activity_count >= 4
    && counts.candidate_ready_count === 1;
}

async function runCli({
  argv = process.argv.slice(2),
  stdin = process.stdin,
  stdout = process.stdout,
  run = runDeepSeekPackagedHarnessCanary,
} = {}) {
  if (!Array.isArray(argv) || argv.length !== 1 || argv[0] !== '--execute') {
    throw new DeepSeekPackagedHarnessCanaryError('deepseek_harness_canary_input_invalid');
  }
  if (typeof run !== 'function') {
    throw new DeepSeekPackagedHarnessCanaryError('deepseek_harness_canary_input_invalid');
  }
  const input = parseDeepSeekCanaryInput(await readStdin(stdin));
  const result = await run(input, {
    argv,
    buildInstruction: LONG_RUN_BUILD_INSTRUCTION,
    checkDelayMs: CHECK_DELAY_MS,
    codingLoopTimeoutMs: CODING_LOOP_TIMEOUT_MS,
    completionPredicate: isSoakCodingLoopComplete,
    minimumRunDurationMs: MINIMUM_RUN_DURATION_MS,
    minimumSessionTurnCount: 1,
    requiredDraftFiles: REQUIRED_DRAFT_FILES,
    resultVersion: RESULT_VERSION,
  });
  stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

module.exports = Object.freeze({
  CHECK_DELAY_MS,
  CODING_LOOP_TIMEOUT_MS,
  LONG_RUN_BUILD_INSTRUCTION,
  MINIMUM_RUN_DURATION_MS,
  REQUIRED_DRAFT_FILES,
  RESULT_VERSION,
  isSoakCodingLoopComplete,
  runCli,
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
