'use strict';

const { performance } = require('node:perf_hooks');

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
  const startedAt = performance.now();
  try {
    const result = await run();
    return Object.freeze({
      duration_ms: Math.round(performance.now() - startedAt),
      name,
      ok: true,
      result,
    });
  } catch (error) {
    const diagnostic = Object.freeze({
      duration_ms: Math.round(performance.now() - startedAt),
      name,
      cause_code: typeof error?.code === 'string' ? error.code : null,
      cause_diagnostic: error?.diagnostic ?? null,
      cause_message: error instanceof Error ? error.message.slice(0, 500) : null,
    });
    fail(`${name}_failed`, diagnostic);
  }
}

async function runBuilderDeepSeekPackagedE2EGate(rawInput, options = {}) {
  const input = parseDeepSeekCanaryInput(JSON.stringify(rawInput));
  const steps = [];

  steps.push(await timedStep('real_existing_project_harness', () => (
    runDeepSeekPackagedHarnessCanary(input, options)
  )));

  steps.push(await timedStep('real_empty_project_approved_plan', () => (
    runDeepSeekPackagedPlanCanary(input, {
      ...options,
      scenario: EMPTY_APPROVED_PLAN_SCENARIO,
    })
  )));

  steps.push(await timedStep('packaged_dependency_prepare_once', () => (
    runDependencyPreparationAllowScenario()
  )));

  return Object.freeze({
    result_version: RESULT_VERSION,
    ok: true,
    step_count: steps.length,
    steps: Object.freeze(steps),
    total_duration_ms: steps.reduce((total, step) => total + step.duration_ms, 0),
  });
}

async function runCli({ stdin = process.stdin, stdout = process.stdout } = {}) {
  const input = parseDeepSeekCanaryInput(await readStdin(stdin));
  const result = await runBuilderDeepSeekPackagedE2EGate(input);
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
