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
  'Build a polished, accessible, responsive focus-planning application in this existing static project.',
  'This is a real long-run soak: complete the whole implementation in one Build run and keep giving brief natural-language updates before meaningful groups of tool actions.',
  'First inspect the existing project and preserve package.json and check.js exactly.',
  'For the initial implementation, update index.html so its h1 text is exactly "Focus Timer First Pass", add the subtitle "A focused interval for careful work.", and preserve data-canary-state="initial" exactly.',
  'Create exactly these non-empty modules and no other files: README.md, styles/base.css, styles/layout.css, styles/components.css, js/state/store.js, js/utils/storage.js, js/components/timer.js, js/components/tasks.js, js/components/filters.js, js/components/stats.js, and js/app.js.',
  'Implement a usable timer, task list, priority filters, progress statistics, local persistence, keyboard-friendly controls, reduced-motion support, responsive layout, and restrained visual polish without external network assets.',
  'Wire every module into index.html and keep the implementation concise but functional; do not create placeholder-only files.',
  'After the initial implementation Builder will run the project check.',
  'When Builder reports that check failed, inspect check.js and repair only index.html to satisfy it; do not modify package.json or check.js.',
  'Use Builder file and command tools only, and finish with a concise summary of files changed and checks run.',
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
