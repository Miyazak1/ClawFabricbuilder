'use strict';

const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const {
  parseDeepSeekCanaryInput,
} = require('./verify-deepseek-packaged-canary.cjs');
const {
  DeepSeekPackagedHarnessCanaryError,
} = require('./verify-deepseek-packaged-harness-canary.cjs');
const {
  RESULT_VERSION,
  runDeepSeekAcceptance,
  savedProfileInputTemplate,
  validateSavedProfileInput,
} = require('./verify-deepseek-packaged-harness-acceptance.cjs');
const {
  readStdin,
} = require('./verify-packaged-canary.cjs');

const RELEASE_RESULT_VERSION = 'builder-deepseek-packaged-release-acceptance-result.v1';

function releaseAcceptanceError(code, diagnostic) {
  return new DeepSeekPackagedHarnessCanaryError(code, diagnostic);
}

function npmCliPath(env = process.env, execPath = process.execPath) {
  const candidates = [
    env.npm_execpath,
    path.join(path.dirname(execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ].filter((candidate) => typeof candidate === 'string' && candidate.length > 0);
  const selected = candidates.find((candidate) => fs.existsSync(candidate));
  if (selected === undefined) {
    throw releaseAcceptanceError('deepseek_release_acceptance_npm_cli_unavailable');
  }
  return selected;
}

function runOrdinaryRelease(spawnSync = childProcess.spawnSync, env = process.env) {
  const result = spawnSync(process.execPath, [npmCliPath(env), 'run', 'verify:release'], {
    env,
    input: '',
    shell: false,
    stdio: ['pipe', 'inherit', 'inherit'],
    windowsHide: true,
  });
  if (result.error !== undefined) throw result.error;
  if (result.signal !== null || result.status !== 0) {
    throw releaseAcceptanceError('deepseek_release_acceptance_ordinary_release_failed');
  }
}

async function runDeepSeekReleaseAcceptance(input, options = {}) {
  validateSavedProfileInput(input);
  const startedAt = Date.now();
  const runRelease = typeof options.runRelease === 'function'
    ? options.runRelease
    : () => runOrdinaryRelease(options.spawnSync, options.env);
  const runAcceptance = typeof options.runAcceptance === 'function'
    ? options.runAcceptance
    : runDeepSeekAcceptance;
  runRelease();
  const acceptance = await runAcceptance(input);
  if (acceptance?.result_version !== RESULT_VERSION) {
    throw releaseAcceptanceError('deepseek_release_acceptance_harness_result_invalid');
  }
  return Object.freeze({
    result_version: RELEASE_RESULT_VERSION,
    runtime_kind: 'deepseek_harness.v1',
    explicit_execute_required: true,
    ordinary_release_completed: true,
    duration_ms: Date.now() - startedAt,
    acceptance,
  });
}

async function runCli({
  argv = process.argv.slice(2),
  stdin = process.stdin,
  stdout = process.stdout,
  run = runDeepSeekReleaseAcceptance,
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
    throw releaseAcceptanceError('deepseek_release_acceptance_input_invalid');
  }
  let input;
  try {
    input = validateSavedProfileInput(parseDeepSeekCanaryInput(await readStdin(stdin)));
  } catch {
    throw releaseAcceptanceError('deepseek_release_acceptance_input_invalid');
  }
  const result = await run(input);
  stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

module.exports = Object.freeze({
  RELEASE_RESULT_VERSION,
  npmCliPath,
  runCli,
  runDeepSeekReleaseAcceptance,
  runOrdinaryRelease,
});

if (require.main === module) {
  runCli().catch((error) => {
    const fixed = error instanceof DeepSeekPackagedHarnessCanaryError
      ? error
      : releaseAcceptanceError('deepseek_release_acceptance_failed');
    process.stderr.write(`${JSON.stringify({
      ok: false,
      code: fixed.code,
      message: fixed.message,
      diagnostic: fixed.diagnostic,
    })}\n`);
    process.exitCode = 1;
  });
}
