'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const test = require('node:test');

const {
  RESULT_VERSION,
  runBuilderDeepSeekPackagedE2EGate,
  runCli,
} = require('../scripts/verify-deepseek-packaged-e2e-gate.cjs');

const root = path.join(__dirname, '..');
const input = Object.freeze({
  executable_path: path.join(root, 'release', 'win-unpacked', 'ClawFabric Builder.exe'),
  mode: 'saved_profile',
  schema_version: 'builder-deepseek-packaged-canary-input.v2',
  source_user_data_path: path.join(root, 'saved-profile'),
});

function streamWith(value) {
  const stream = new PassThrough();
  stream.end(value);
  return stream;
}

test('DeepSeek packaged E2E gate requires explicit saved-profile execution', async () => {
  assert.equal(RESULT_VERSION, 'builder-deepseek-packaged-e2e-gate-result.v1');

  await assert.rejects(
    runCli({
      argv: [],
      stdin: streamWith(JSON.stringify(input)),
      stdout: new PassThrough(),
    }),
    (error) => error.code === 'builder_deepseek_packaged_e2e_gate_input_invalid',
  );
  await assert.rejects(
    runCli({
      argv: ['--execute'],
      stdin: streamWith(''),
      stdout: new PassThrough(),
    }),
    (error) => error.code === 'builder_deepseek_packaged_e2e_gate_input_invalid',
  );
  await assert.rejects(
    runBuilderDeepSeekPackagedE2EGate({
      credential: 'not-used',
      executable_path: input.executable_path,
      mode: 'first_config',
      model: 'deepseek-v4-flash',
      schema_version: input.schema_version,
    }, {}),
    (error) => error.code === 'deepseek_harness_acceptance_saved_profile_required',
  );
});

test('DeepSeek packaged E2E gate can print and execute from the saved-profile template', async () => {
  const printed = new PassThrough();
  const template = await runCli({
    argv: ['--print-saved-profile-input'],
    stdin: streamWith(''),
    stdout: printed,
    run: async () => {
      throw new Error('print mode must not execute');
    },
  });

  assert.equal(template.mode, 'saved_profile');
  assert.match(printed.read().toString('utf8'), /builder-deepseek-packaged-canary-input\.v2/u);

  let observedInput = null;
  const executed = new PassThrough();
  const result = await runCli({
    argv: ['--execute-saved-profile'],
    stdin: streamWith('not-json'),
    stdout: executed,
    async run(acceptedInput) {
      observedInput = acceptedInput;
      return {
        ok: true,
        result_version: RESULT_VERSION,
      };
    },
  });

  assert.equal(result.result_version, RESULT_VERSION);
  assert.equal(observedInput.mode, 'saved_profile');
  assert.match(executed.read().toString('utf8'), /builder-deepseek-packaged-e2e-gate-result\.v1/u);
});

test('DeepSeek packaged E2E gate keeps all release-candidate product paths in one explicit gate', async () => {
  const calls = [];
  const result = await runBuilderDeepSeekPackagedE2EGate(input, {
    async runFocused(acceptedInput) {
      calls.push(['focused', acceptedInput]);
      return { ok: true, result_version: 'focused' };
    },
    async runPlan(acceptedInput) {
      calls.push(['plan', acceptedInput]);
      return { ok: true, result_version: 'plan' };
    },
    async runDependencyPrepare() {
      calls.push(['dependency_prepare', null]);
      return { ok: true, result_version: 'dependency' };
    },
  });

  assert.equal(result.result_version, RESULT_VERSION);
  assert.equal(result.step_count, 3);
  assert.deepEqual(result.steps.map((step) => step.name), [
    'real_existing_project_harness',
    'real_empty_project_approved_plan',
    'packaged_dependency_prepare_once',
  ]);
  assert.deepEqual(calls.map((call) => call[0]), ['focused', 'plan', 'dependency_prepare']);
  assert.deepEqual(calls[0][1], input);
  assert.deepEqual(calls[1][1], input);
});

test('package scripts expose explicit saved-profile DeepSeek E2E entry points', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

  assert.equal(
    packageJson.scripts['verify:packaged-e2e:deepseek:input'],
    'node scripts/verify-deepseek-packaged-e2e-gate.cjs --print-saved-profile-input',
  );
  assert.equal(
    packageJson.scripts['verify:packaged-e2e:deepseek:saved-profile'],
    'node scripts/verify-deepseek-packaged-e2e-gate.cjs --execute-saved-profile',
  );
  assert.equal(
    packageJson.scripts['verify:packaged-e2e:deepseek'],
    'node scripts/verify-deepseek-packaged-e2e-gate.cjs --execute',
  );
  assert.doesNotMatch(packageJson.scripts['verify:release'], /deepseek/u);
});
