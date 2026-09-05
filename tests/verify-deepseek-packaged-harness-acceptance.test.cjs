'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const test = require('node:test');

const {
  RESULT_VERSION,
  runCli,
  runDeepSeekAcceptance,
  savedProfileInputTemplate,
  validateFocusedEvidence,
  validateSavedProfileInput,
  validateSoakEvidence,
  validateTaskResumeEvidence,
} = require('../scripts/verify-deepseek-packaged-harness-acceptance.cjs');
const {
  RELEASE_RESULT_VERSION,
  npmCliPath,
  runCli: runReleaseCli,
  runDeepSeekReleaseAcceptance,
  runOrdinaryRelease,
} = require('../scripts/verify-deepseek-packaged-release-acceptance.cjs');

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

function focusedEvidence() {
  return {
    result_version: 'builder-deepseek-packaged-harness-canary-result.v2',
    runtime_kind: 'deepseek_harness.v1',
    automatic_check_failed_then_passed: false,
    automatic_check_passed: true,
    agent_browser_opened_current_run_source: true,
    agent_browser_reloaded_latest_run_source: true,
    app_restart_no_agent_test_surface: true,
    app_restart_no_loopback_webcontents: true,
    app_restart_user_web_requires_navigation: true,
    bash_tool_hidden_from_harness: true,
    generated_project_contract: { dependency_count: 0, test_script: 'node check.js' },
    generated_project_contract_verified: true,
    project_usage_answer_grounded_in_current_draft: true,
    save_version_completed: true,
    save_version_required: true,
  };
}

function soakEvidence() {
  return {
    result_version: 'builder-deepseek-packaged-harness-soak-result.v1',
    runtime_kind: 'deepseek_harness.v1',
    coding_loop_duration_ms: 120_001,
    generated_check_delay_ms: 90_000,
    generated_project_contract_verified: true,
    required_draft_file_count: 11,
    save_version_completed: true,
  };
}

function taskResumeEvidence() {
  return {
    ok: true,
    closed_via_window_button: true,
    completed: { runs: ['initial', 'resumed'] },
    completed_task_followup_after_restart: true,
    completed_task_followup_saved_via_ui: true,
    dependencies_installed: false,
    followup_completed: { runs: ['initial', 'resumed', 'followup'] },
    original_profile_and_projects_untouched: true,
    resumed_via_ui: true,
    saved_via_ui: true,
  };
}

test('DeepSeek acceptance requires explicit saved-profile execution', async () => {
  assert.equal(RESULT_VERSION, 'builder-deepseek-packaged-harness-acceptance-result.v1');
  assert.throws(
    () => validateSavedProfileInput({
      credential: 'must-not-run',
      executable_path: input.executable_path,
      mode: 'first_config',
      model: 'deepseek-v4-flash',
      schema_version: input.schema_version,
    }),
    (error) => error.code === 'deepseek_harness_acceptance_saved_profile_required',
  );
  await assert.rejects(
    runCli({
      argv: [],
      stdin: streamWith(JSON.stringify(input)),
      stdout: new PassThrough(),
    }),
    (error) => error.code === 'deepseek_harness_acceptance_input_invalid',
  );
  await assert.rejects(
    runCli({
      argv: ['--execute'],
      stdin: streamWith(''),
      stdout: new PassThrough(),
    }),
    (error) => error.code === 'deepseek_harness_acceptance_input_invalid',
  );
});

test('DeepSeek acceptance can print a saved-profile stdin template without executing', async () => {
  const template = savedProfileInputTemplate({ APPDATA: path.join(root, 'AppData', 'Roaming') });
  assert.deepEqual(template, {
    executable_path: path.join(root, 'release', 'win-unpacked', 'ClawFabric Builder.exe'),
    mode: 'saved_profile',
    schema_version: 'builder-deepseek-packaged-canary-input.v2',
    source_user_data_path: path.join(root, 'AppData', 'Roaming', 'clawfabric-builder'),
  });
  assert.throws(
    () => savedProfileInputTemplate({}),
    (error) => error.code === 'deepseek_harness_acceptance_saved_profile_unavailable',
  );

  const stdout = new PassThrough();
  const result = await runCli({
    argv: ['--print-saved-profile-input'],
    stdin: streamWith(''),
    stdout,
    run: async () => {
      throw new Error('print mode must not execute acceptance');
    },
  });

  assert.equal(result.mode, 'saved_profile');
  assert.match(stdout.read().toString('utf8'), /builder-deepseek-packaged-canary-input\.v2/u);
});

test('DeepSeek acceptance aggregates focused, soak, and restart-follow-up evidence', async () => {
  const result = await runDeepSeekAcceptance(input, {
    runFocused: async (acceptedInput, options) => {
      assert.equal(acceptedInput, input);
      assert.deepEqual(options.argv, ['--execute']);
      return focusedEvidence();
    },
    runSoak: async (acceptedInput) => {
      assert.equal(acceptedInput, input);
      return soakEvidence();
    },
    runTaskResume: async (acceptedInput) => {
      assert.equal(acceptedInput, input);
      return taskResumeEvidence();
    },
  });

  assert.equal(result.result_version, RESULT_VERSION);
  assert.equal(result.provider_scope, 'real_deepseek_v4_saved_profile');
  assert.equal(result.explicit_execute_required, true);
  assert.equal(result.focused.save_version_completed, true);
  assert.equal(result.soak.required_draft_file_count, 11);
  assert.equal(result.task_resume.completed_task_followup_after_restart, true);
});

test('DeepSeek acceptance rejects incomplete product evidence', () => {
  assert.throws(
    () => validateFocusedEvidence({ ...focusedEvidence(), save_version_completed: false }),
    (error) => error.code === 'deepseek_harness_acceptance_focused_evidence_invalid',
  );
  assert.throws(
    () => validateSoakEvidence({ ...soakEvidence(), coding_loop_duration_ms: 120_000 }),
    (error) => error.code === 'deepseek_harness_acceptance_soak_evidence_invalid',
  );
  assert.throws(
    () => validateTaskResumeEvidence({
      ...taskResumeEvidence(),
      completed_task_followup_after_restart: false,
    }),
    (error) => error.code === 'deepseek_harness_acceptance_resume_evidence_invalid',
  );
});

test('DeepSeek acceptance is explicit and stays out of the ordinary release gate', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const source = fs.readFileSync(
    path.join(root, 'scripts', 'verify-deepseek-packaged-harness-acceptance.cjs'),
    'utf8',
  );
  const taskResume = fs.readFileSync(
    path.join(root, 'scripts', 'verify-deepseek-packaged-task-resume.cjs'),
    'utf8',
  );

  assert.equal(
    manifest.scripts['verify:packaged-harness:deepseek:acceptance:input'],
    'node scripts/verify-deepseek-packaged-harness-acceptance.cjs --print-saved-profile-input',
  );
  assert.equal(
    manifest.scripts['verify:packaged-harness:deepseek:acceptance'],
    'node scripts/verify-deepseek-packaged-harness-acceptance.cjs',
  );
  assert.equal(
    manifest.scripts['verify:release:deepseek:input'],
    'node scripts/verify-deepseek-packaged-release-acceptance.cjs --print-saved-profile-input',
  );
  assert.equal(
    manifest.scripts['verify:release:deepseek:saved-profile'],
    'node scripts/verify-deepseek-packaged-release-acceptance.cjs --execute-saved-profile',
  );
  assert.equal(
    manifest.scripts['verify:release:deepseek'],
    'node scripts/verify-deepseek-packaged-release-acceptance.cjs --execute',
  );
  assert.doesNotMatch(manifest.scripts['verify:release'], /deepseek/u);
  assert.match(source, /--execute/u);
  assert.match(source, /--print-saved-profile-input/u);
  assert.match(source, /validateSavedProfileInput/u);
  assert.match(source, /runDeepSeekPackagedHarnessCanary/u);
  assert.match(source, /runSoakCli/u);
  assert.match(source, /runDeepSeekTaskResume/u);
  assert.match(taskResume, /sourceUserDataPath/u);
  assert.match(taskResume, /writeSummary/u);
});

test('DeepSeek release acceptance reads stdin once before running ordinary release', async () => {
  let releaseRan = false;
  let acceptanceInput = null;
  const result = await runDeepSeekReleaseAcceptance(input, {
    runRelease: () => {
      releaseRan = true;
    },
    runAcceptance: async (acceptedInput) => {
      acceptanceInput = acceptedInput;
      return {
        result_version: RESULT_VERSION,
        runtime_kind: 'deepseek_harness.v1',
      };
    },
  });

  assert.equal(result.result_version, RELEASE_RESULT_VERSION);
  assert.equal(result.ordinary_release_completed, true);
  assert.equal(releaseRan, true);
  assert.equal(acceptanceInput, input);
});

test('DeepSeek release CLI rejects missing stdin before ordinary release can run', async () => {
  let ran = false;
  await assert.rejects(
    runReleaseCli({
      argv: ['--execute'],
      stdin: streamWith(''),
      stdout: new PassThrough(),
      run: async () => {
        ran = true;
      },
    }),
    (error) => error.code === 'deepseek_release_acceptance_input_invalid',
  );
  assert.equal(ran, false);
});

test('DeepSeek release CLI can execute from the saved-profile template without stdin', async () => {
  const stdout = new PassThrough();
  let observedInput = null;
  const result = await runReleaseCli({
    argv: ['--execute-saved-profile'],
    stdin: streamWith('not-json'),
    stdout,
    run: async (acceptedInput) => {
      observedInput = acceptedInput;
      return {
        acceptance: { result_version: RESULT_VERSION },
        explicit_execute_required: true,
        ordinary_release_completed: true,
        result_version: RELEASE_RESULT_VERSION,
      };
    },
  });

  assert.equal(result.result_version, RELEASE_RESULT_VERSION);
  assert.equal(observedInput.mode, 'saved_profile');
  assert.match(stdout.read().toString('utf8'), /builder-deepseek-packaged-release-acceptance-result\.v1/u);
});

test('ordinary release runner uses npm without a shell and closes stdin without forwarding canary input', () => {
  const calls = [];
  runOrdinaryRelease((file, args, options) => {
    calls.push({ file, args, options });
    return { error: undefined, signal: null, status: 0 };
  }, { PATH: 'test-path', npm_execpath: __filename });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].file, process.execPath);
  assert.deepEqual(calls[0].args, [npmCliPath({ npm_execpath: __filename }), 'run', 'verify:release']);
  assert.equal(calls[0].options.input, '');
  assert.deepEqual(calls[0].options.stdio, ['pipe', 'inherit', 'inherit']);
  assert.equal(calls[0].options.shell, false);
});
