'use strict';

const { performance: nodePerformance } = require('node:perf_hooks');

const {
  parseDeepSeekCanaryInput,
} = require('./verify-deepseek-packaged-canary.cjs');
const {
  EMPTY_APPROVED_PLAN_SCENARIO,
  runDeepSeekPackagedPlanCanary,
} = require('./verify-deepseek-packaged-plan-canary.cjs');
const {
  runDeepSeekPackagedHarnessCanary,
} = require('./verify-deepseek-packaged-harness-canary.cjs');
const {
  savedProfileInputTemplate,
  validateSavedProfileInput,
} = require('./verify-deepseek-packaged-harness-acceptance.cjs');
const {
  runDependencyPreparationAllowScenario,
} = require('./verify-packaged-harness-failure-canary.cjs');

const RESULT_VERSION = 'builder-deepseek-packaged-e2e-gate-result.v1';

class BuilderDeepSeekPackagedE2EGateError extends Error {
  constructor(code, diagnostic = undefined) {
    super('The real-provider packaged end-to-end gate did not complete.');
    this.name = 'BuilderDeepSeekPackagedE2EGateError';
    this.code = typeof code === 'string' && /^[a-z0-9_]{1,96}$/u.test(code)
      ? code
      : 'builder_deepseek_packaged_e2e_gate_failed';
    this.diagnostic = diagnostic;
  }
}

function fail(code, diagnostic = undefined) {
  throw new BuilderDeepSeekPackagedE2EGateError(code, diagnostic);
}

async function readStdin(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

async function timedStep(name, run) {
  const startedAt = nodePerformance.now();
  try {
    const result = await run();
    return Object.freeze({
      duration_ms: Math.round(nodePerformance.now() - startedAt),
      name,
      ok: true,
      result,
    });
  } catch (error) {
    const diagnostic = Object.freeze({
      duration_ms: Math.round(nodePerformance.now() - startedAt),
      name,
      cause_code: typeof error?.code === 'string' ? error.code : null,
      cause_diagnostic: error?.diagnostic ?? null,
      cause_message: error instanceof Error ? error.message.slice(0, 500) : null,
    });
    fail(`${name}_failed`, diagnostic);
  }
}

async function runBuilderDeepSeekPackagedE2EGate(rawInput, options = {}) {
  const input = validateSavedProfileInput(parseDeepSeekCanaryInput(JSON.stringify(rawInput)));
  const steps = [];
  const runFocused = typeof options.runFocused === 'function'
    ? options.runFocused
    : runDeepSeekPackagedHarnessCanary;
  const runPlan = typeof options.runPlan === 'function'
    ? options.runPlan
    : runDeepSeekPackagedPlanCanary;
  const runDependencyPrepare = typeof options.runDependencyPrepare === 'function'
    ? options.runDependencyPrepare
    : runDependencyPreparationAllowScenario;

  steps.push(await timedStep('real_existing_project_harness', () => (
    runFocused(input, options)
  )));

  steps.push(await timedStep('real_empty_project_approved_plan', () => (
    runPlan(input, {
      ...options,
      scenario: EMPTY_APPROVED_PLAN_SCENARIO,
    })
  )));

  steps.push(await timedStep('packaged_dependency_prepare_once', () => (
    runDependencyPrepare()
  )));

  return Object.freeze({
    result_version: RESULT_VERSION,
    ok: true,
    step_count: steps.length,
    steps: Object.freeze(steps),
    total_duration_ms: steps.reduce((total, step) => total + step.duration_ms, 0),
  });
}

async function runCli({
  argv = process.argv.slice(2),
  stdin = process.stdin,
  stdout = process.stdout,
  run = runBuilderDeepSeekPackagedE2EGate,
} = {}) {
  if (Array.isArray(argv) && argv.length === 1 && argv[0] === '--print-saved-profile-input') {
    const result = savedProfileInputTemplate();
    stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result;
  }
  if (Array.isArray(argv) && argv.length === 1 && argv[0] === '--execute-saved-profile') {
    const result = await run(savedProfileInputTemplate());
    stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result;
  }
  if (!Array.isArray(argv) || argv.length !== 1 || argv[0] !== '--execute') {
    fail('builder_deepseek_packaged_e2e_gate_input_invalid');
  }
  let input;
  try {
    input = validateSavedProfileInput(parseDeepSeekCanaryInput(await readStdin(stdin)));
  } catch {
    fail('builder_deepseek_packaged_e2e_gate_input_invalid');
  }
  const result = await run(input);
  stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

module.exports = Object.freeze({
  BuilderDeepSeekPackagedE2EGateError,
  RESULT_VERSION,
  runBuilderDeepSeekPackagedE2EGate,
  runCli,
});

if (require.main === module) {
  runCli().catch((error) => {
    const fixed = error instanceof BuilderDeepSeekPackagedE2EGateError
      ? error
      : new BuilderDeepSeekPackagedE2EGateError(
        typeof error?.code === 'string' ? error.code : 'builder_deepseek_packaged_e2e_gate_failed',
        Object.freeze({
          cause_diagnostic: error?.diagnostic ?? null,
          cause_message: error instanceof Error ? error.message.slice(0, 500) : null,
        }),
      );
    process.stderr.write(`${JSON.stringify({
      ok: false,
      code: fixed.code,
      message: fixed.message,
      diagnostic: fixed.diagnostic,
    })}\n`);
    process.exitCode = 1;
  });
}
