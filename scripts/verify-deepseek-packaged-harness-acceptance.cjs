'use strict';

const { PassThrough } = require('node:stream');
const path = require('node:path');

const {
  parseDeepSeekCanaryInput,
} = require('./verify-deepseek-packaged-canary.cjs');
const {
  DeepSeekPackagedHarnessCanaryError,
  RESULT_VERSION: FOCUSED_RESULT_VERSION,
  runDeepSeekPackagedHarnessCanary,
} = require('./verify-deepseek-packaged-harness-canary.cjs');
const {
  RESULT_VERSION: SOAK_RESULT_VERSION,
  runCli: runSoakCli,
} = require('./verify-deepseek-packaged-harness-soak.cjs');
const {
  readStdin,
} = require('./verify-packaged-canary.cjs');
const RESULT_VERSION = 'builder-deepseek-packaged-harness-acceptance-result.v1';
const TASK_RESUME_OUTPUT = path.resolve('release/deepseek-harness-acceptance-task-resume');
const DEEPSEEK_CANARY_INPUT_VERSION = 'builder-deepseek-packaged-canary-input.v2';

function acceptanceError(code, diagnostic) {
  return new DeepSeekPackagedHarnessCanaryError(code, diagnostic);
}

function validateSavedProfileInput(input) {
  if (input?.mode !== 'saved_profile') {
    throw acceptanceError('deepseek_harness_acceptance_saved_profile_required');
  }
  return input;
}

function validateFocusedEvidence(evidence) {
  if (evidence?.result_version !== FOCUSED_RESULT_VERSION) {
    throw acceptanceError('deepseek_harness_acceptance_focused_result_invalid');
  }
  const requiredTrue = [
    'automatic_check_passed',
    'agent_browser_opened_current_run_source',
    'agent_browser_reloaded_latest_run_source',
    'generated_project_contract_verified',
    'save_version_completed',
    'save_version_required',
    'app_restart_no_agent_test_surface',
    'app_restart_no_loopback_webcontents',
    'app_restart_user_web_requires_navigation',
  ];
  if (
    evidence.runtime_kind !== 'deepseek_harness.v1'
    || requiredTrue.some((key) => evidence[key] !== true)
    || evidence.bash_tool_hidden_from_harness !== true
    || evidence.project_usage_answer_grounded_in_current_draft !== true
    || evidence.generated_project_contract?.test_script !== 'node check.js'
    || evidence.generated_project_contract?.dependency_count !== 0
  ) {
    throw acceptanceError('deepseek_harness_acceptance_focused_evidence_invalid');
  }
  return Object.freeze({
    result_version: evidence.result_version,
    automatic_check_failed_then_passed: evidence.automatic_check_failed_then_passed,
    automatic_check_passed: evidence.automatic_check_passed,
    browser_verified: evidence.agent_browser_reloaded_latest_run_source,
    save_version_completed: evidence.save_version_completed,
  });
}

function validateSoakEvidence(evidence) {
  if (evidence?.result_version !== SOAK_RESULT_VERSION) {
    throw acceptanceError('deepseek_harness_acceptance_soak_result_invalid');
  }
  if (
    evidence.runtime_kind !== 'deepseek_harness.v1'
    || evidence.generated_project_contract_verified !== true
    || evidence.save_version_completed !== true
    || evidence.required_draft_file_count < 11
    || evidence.coding_loop_duration_ms < 120_001
    || evidence.generated_check_delay_ms !== 90_000
  ) {
    throw acceptanceError('deepseek_harness_acceptance_soak_evidence_invalid');
  }
  return Object.freeze({
    result_version: evidence.result_version,
    coding_loop_duration_ms: evidence.coding_loop_duration_ms,
    required_draft_file_count: evidence.required_draft_file_count,
    save_version_completed: evidence.save_version_completed,
  });
}

function validateTaskResumeEvidence(evidence) {
  if (
    evidence?.ok !== true
    || evidence.dependencies_installed !== false
    || evidence.closed_via_window_button !== true
    || evidence.resumed_via_ui !== true
    || evidence.saved_via_ui !== true
    || evidence.completed_task_followup_after_restart !== true
    || evidence.completed_task_followup_saved_via_ui !== true
    || evidence.original_profile_and_projects_untouched !== true
    || evidence.completed?.runs?.length !== 2
    || evidence.followup_completed?.runs?.length !== 3
  ) {
    throw acceptanceError('deepseek_harness_acceptance_resume_evidence_invalid');
  }
  return Object.freeze({
    result_version: 'builder-deepseek-packaged-task-resume-result.v1',
    completed_task_followup_after_restart: true,
    dependencies_installed: false,
    resumed_via_ui: true,
    saved_via_ui: true,
  });
}

function stdinForInput(input) {
  const stream = new PassThrough();
  stream.end(JSON.stringify(input));
  return stream;
}

function savedProfileInputTemplate(env = process.env) {
  const appData = env.APPDATA;
  if (typeof appData !== 'string' || appData.length === 0) {
    throw acceptanceError('deepseek_harness_acceptance_saved_profile_unavailable');
  }
  return Object.freeze({
    executable_path: path.join(path.resolve(__dirname, '..'), 'release', 'win-unpacked', 'ClawFabric Builder.exe'),
    mode: 'saved_profile',
    schema_version: DEEPSEEK_CANARY_INPUT_VERSION,
    source_user_data_path: path.join(appData, 'clawfabric-builder'),
  });
}

async function runDeepSeekAcceptance(input, options = {}) {
  validateSavedProfileInput(input);
  const startedAt = Date.now();
  const runFocused = typeof options.runFocused === 'function'
    ? options.runFocused
    : runDeepSeekPackagedHarnessCanary;
  const runSoak = typeof options.runSoak === 'function'
    ? options.runSoak
    : async (acceptedInput) => runSoakCli({
      argv: ['--execute'],
      stdin: stdinForInput(acceptedInput),
      stdout: new PassThrough(),
    });
  const runTaskResume = typeof options.runTaskResume === 'function'
    ? options.runTaskResume
    : async (acceptedInput) => {
      const { run: runDeepSeekTaskResume } = require('./verify-deepseek-packaged-task-resume.cjs');
      return runDeepSeekTaskResume(TASK_RESUME_OUTPUT, false, {
        reportStage: () => {},
        sourceUserDataPath: acceptedInput.source_user_data_path,
        writeSummary: false,
      });
    };

  const focused = validateFocusedEvidence(await runFocused(input, {
    argv: ['--execute'],
  }));
  const soak = validateSoakEvidence(await runSoak(input));
  const taskResume = validateTaskResumeEvidence(await runTaskResume(input));
  return Object.freeze({
    result_version: RESULT_VERSION,
    runtime_kind: 'deepseek_harness.v1',
    provider_scope: 'real_deepseek_v4_saved_profile',
    explicit_execute_required: true,
    duration_ms: Date.now() - startedAt,
    focused,
    soak,
    task_resume: taskResume,
  });
}

async function runCli({
  argv = process.argv.slice(2),
  stdin = process.stdin,
  stdout = process.stdout,
  run = runDeepSeekAcceptance,
} = {}) {
  if (Array.isArray(argv) && argv.length === 1 && argv[0] === '--print-saved-profile-input') {
    const result = savedProfileInputTemplate();
    stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result;
  }
  if (!Array.isArray(argv) || argv.length !== 1 || argv[0] !== '--execute') {
    throw acceptanceError('deepseek_harness_acceptance_input_invalid');
  }
  let input;
  try {
    input = validateSavedProfileInput(parseDeepSeekCanaryInput(await readStdin(stdin)));
  } catch {
    throw acceptanceError('deepseek_harness_acceptance_input_invalid');
  }
  const result = await run(input);
  stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

module.exports = Object.freeze({
  RESULT_VERSION,
  TASK_RESUME_OUTPUT,
  runCli,
  runDeepSeekAcceptance,
  savedProfileInputTemplate,
  validateFocusedEvidence,
  validateSavedProfileInput,
  validateSoakEvidence,
  validateTaskResumeEvidence,
});

if (require.main === module) {
  runCli().catch((error) => {
    const fixed = error instanceof DeepSeekPackagedHarnessCanaryError
      ? error
      : acceptanceError('deepseek_harness_acceptance_failed');
    process.stderr.write(`${JSON.stringify({
      ok: false,
      code: fixed.code,
      message: fixed.message,
      diagnostic: fixed.diagnostic,
    })}\n`);
    process.exitCode = 1;
  });
}
