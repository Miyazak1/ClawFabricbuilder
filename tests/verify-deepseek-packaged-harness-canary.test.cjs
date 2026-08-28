'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const test = require('node:test');

const {
  BUILD_INSTRUCTION,
  DEFAULT_CODING_LOOP_TIMEOUT_MS,
  PROJECT_USAGE_QUESTION,
  RESULT_VERSION,
  assertMinimumRunDuration,
  isCodingLoopComplete,
  isCodingLoopTerminal,
  readGenerationDebug,
  readHarnessFailureEvidence,
  readHarnessSessionEvidence,
  seedCodingLoopFixture,
  validateAgentBrowserSurfaceEvidence,
  waitForAgentBrowserSurface,
} = require('../scripts/verify-deepseek-packaged-harness-canary.cjs');

test('recognizes a direct-pass terminal loop without waiting for a manufactured failed check', () => {
  assert.equal(isCodingLoopTerminal({
    run_started_count: 0,
    run_completed_count: 1,
    programming_runtime_check_passed_count: 1,
    programming_runtime_check_failed_count: 0,
    candidate_ready_count: 1,
  }), true);
});
const {
  CHECK_DELAY_MS,
  CODING_LOOP_TIMEOUT_MS,
  LONG_RUN_BUILD_INSTRUCTION,
  MINIMUM_RUN_DURATION_MS,
  REQUIRED_DRAFT_FILES,
  RESULT_VERSION: SOAK_RESULT_VERSION,
  isSoakCodingLoopComplete,
  runCli: runSoakCli,
} = require('../scripts/verify-deepseek-packaged-harness-soak.cjs');

const repositoryRoot = path.join(__dirname, '..');

test('real-provider Harness RC completes review instead of stopping at the unsaved draft gate', () => {
  const source = fs.readFileSync(
    path.join(repositoryRoot, 'scripts', 'verify-deepseek-packaged-harness-canary.cjs'),
    'utf8',
  );

  assert.match(source, /page\.locator\(SELECTORS\.saveVersion\)/u);
  assert.match(source, /page\.locator\(SELECTORS\.versionSavedActivity\)/u);
  assert.match(source, /save_version_completed:\s*true/u);
  assert.match(source, /save_version_required:\s*true/u);
});

function temporaryDirectory(t, prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function appendJsonl(filePath, records) {
  fs.writeFileSync(filePath, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`, 'utf8');
}

function passThroughWith(value) {
  const stream = new PassThrough();
  stream.end(value);
  return stream;
}

test('seeds a deterministic failed-check fixture whose repair target is discoverable', (t) => {
  const projectRoot = temporaryDirectory(t, 'builder-deepseek-harness-fixture-');
  const evidence = seedCodingLoopFixture(projectRoot);
  const index = fs.readFileSync(path.join(projectRoot, 'index.html'), 'utf8');
  const check = fs.readFileSync(path.join(projectRoot, 'check.js'), 'utf8');
  const packageSource = fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8');

  assert.match(index, /data-canary-state="initial"/u);
  assert.doesNotMatch(index, /Focus Timer Repaired/u);
  assert.match(check, /Focus Timer Repaired/u);
  assert.match(check, /data-canary-state="repaired"/u);
  assert.equal(JSON.parse(packageSource).scripts.test, 'node check.js');
  assert.match(evidence.check_digest, /^sha256:[0-9a-f]{64}$/u);
  assert.match(evidence.package_digest, /^sha256:[0-9a-f]{64}$/u);
  assert.match(BUILD_INSTRUCTION, /检查 check\.js，并且只修复 index\.html/u);
  assert.match(BUILD_INSTRUCTION, /用中文简短说明/u);
  assert.match(BUILD_INSTRUCTION, /DOM\/可访问性、截图状态、Console 和 Network/u);
  assert.equal(RESULT_VERSION, 'builder-deepseek-packaged-harness-canary-result.v2');
  assert.match(PROJECT_USAGE_QUESTION, /怎么运行和使用/u);
  assert.match(PROJECT_USAGE_QUESTION, /当前项目文件/u);
});

test('accepts only a visible Agent Test surface contained by the active Browser sidebar', () => {
  assert.deepEqual(validateAgentBrowserSurfaceEvidence({
    active_tab: 'browser_placeholder',
    sidebar_bounds: { x: 800, y: 100, width: 440, height: 700 },
    surface_bounds: { x: 820, y: 180, width: 400, height: 580 },
    surface_visible: true,
  }), {
    active_tab: 'browser_placeholder',
    sidebar_bounds: { x: 800, y: 100, width: 440, height: 700 },
    surface_bounds: { x: 820, y: 180, width: 400, height: 580 },
    surface_visible: true,
  });
  assert.throws(
    () => validateAgentBrowserSurfaceEvidence({
      active_tab: 'files',
      sidebar_bounds: { x: 800, y: 100, width: 440, height: 700 },
      surface_bounds: { x: 820, y: 180, width: 400, height: 580 },
      surface_visible: true,
    }),
    (error) => error.code === 'deepseek_harness_agent_browser_surface_invalid',
  );
  assert.throws(
    () => validateAgentBrowserSurfaceEvidence({
      active_tab: 'browser_placeholder',
      sidebar_bounds: { x: 800, y: 100, width: 440, height: 700 },
      surface_bounds: { x: 700, y: 180, width: 400, height: 580 },
      surface_visible: true,
    }),
    (error) => error.code === 'deepseek_harness_agent_browser_surface_outside_sidebar',
  );
});

test('waits for the live Agent Test surface and reads its active sidebar geometry', async () => {
  const calls = [];
  const sidebar = {
    async boundingBox() { calls.push('sidebar_bounds'); return { x: 800, y: 100, width: 440, height: 700 }; },
    async getAttribute(name) { calls.push(`attribute:${name}`); return 'browser_placeholder'; },
  };
  const surface = {
    async boundingBox() { calls.push('surface_bounds'); return { x: 820, y: 180, width: 400, height: 580 }; },
    async isVisible() { calls.push('surface_visible'); return true; },
    async waitFor(options) { calls.push(`wait:${options.state}:${options.timeout}`); },
  };
  const page = {
    locator(selector) {
      return {
        first() {
          return selector.includes('agent-test-browser-surface') ? surface : sidebar;
        },
      };
    },
  };

  assert.deepEqual(await waitForAgentBrowserSurface(page, 12_345), {
    active_tab: 'browser_placeholder',
    sidebar_bounds: { x: 800, y: 100, width: 440, height: 700 },
    surface_bounds: { x: 820, y: 180, width: 400, height: 580 },
    surface_visible: true,
  });
  assert.deepEqual(calls, [
    'wait:visible:12345',
    'attribute:data-builder-artifact-tab-active',
    'sidebar_bounds',
    'surface_bounds',
    'surface_visible',
  ]);
});

test('seeds a bounded capability-owned long check only when the soak requests it', (t) => {
  const projectRoot = temporaryDirectory(t, 'builder-deepseek-harness-long-check-');
  seedCodingLoopFixture(projectRoot, CHECK_DELAY_MS);
  const check = fs.readFileSync(path.join(projectRoot, 'check.js'), 'utf8');

  assert.match(check, /Atomics\.wait/u);
  assert.match(check, /90000/u);
  assert.throws(
    () => seedCodingLoopFixture(temporaryDirectory(t, 'builder-invalid-long-check-'), 120_001),
    (error) => error.code === 'deepseek_harness_fixture_invalid',
  );
});

test('accepts a completed direct Build loop without manufacturing Plan execution approval', () => {
  const counts = {
    candidate_ready_count: 1,
    programming_run_admitted_count: 0,
    programming_runtime_assistant_message_count: 6,
    programming_runtime_check_failed_count: 1,
    programming_runtime_check_passed_count: 1,
    programming_runtime_tool_activity_count: 18,
    run_completed_count: 1,
    run_started_count: 1,
  };

  assert.equal(isCodingLoopComplete(counts), true);
  assert.equal(isCodingLoopComplete({ ...counts, programming_runtime_check_failed_count: 2 }), true);
  assert.equal(isCodingLoopComplete({ ...counts, programming_runtime_check_failed_count: 3 }), true);
  assert.equal(isCodingLoopComplete({ ...counts, programming_runtime_check_failed_count: 0 }), false);
  assert.equal(isCodingLoopComplete({ ...counts, programming_runtime_check_failed_count: 4 }), false);
  assert.equal(isCodingLoopComplete({ ...counts, run_completed_count: 0 }), false);
  assert.equal(isCodingLoopComplete({ ...counts, candidate_ready_count: 0 }), false);
});

test('accepts balanced multi-turn Harness session evidence', (t) => {
  const sessionRoot = temporaryDirectory(t, 'builder-deepseek-harness-session-');
  appendJsonl(path.join(sessionRoot, 'events.jsonl'), [
    { type: 'turn/start' },
    { type: 'assistant/message' },
    { type: 'tool/call', data: { name: 'read' } },
    { type: 'tool/result' },
    { type: 'turn/end' },
    { type: 'turn/start' },
    { type: 'assistant/message' },
    { type: 'tool/call', data: { name: 'edit' } },
    { type: 'tool/result' },
    { type: 'turn/end' },
  ]);

  assert.deepEqual(readHarnessSessionEvidence(sessionRoot), {
    assistant_message_count: 2,
    file_count: 1,
    retained_event_count: 10,
    tool_call_names: { edit: 1, read: 1 },
    tool_call_count: 2,
    tool_result_count: 2,
    turn_count: 2,
  });
});

test('accepts one balanced Harness turn only for a direct-pass soak', (t) => {
  const sessionRoot = temporaryDirectory(t, 'builder-deepseek-harness-one-turn-');
  appendJsonl(path.join(sessionRoot, 'events.jsonl'), [
    { type: 'turn/start' },
    { type: 'assistant/message' },
    { type: 'assistant/message' },
    { type: 'tool/call', data: { name: 'read' } },
    { type: 'tool/result' },
    { type: 'tool/call', data: { name: 'edit' } },
    { type: 'tool/result' },
    { type: 'turn/end' },
  ]);

  assert.deepEqual(readHarnessSessionEvidence(sessionRoot, 1), {
    assistant_message_count: 2,
    file_count: 1,
    retained_event_count: 8,
    tool_call_names: { edit: 1, read: 1 },
    tool_call_count: 2,
    tool_result_count: 2,
    turn_count: 1,
  });
  assert.throws(
    () => readHarnessSessionEvidence(sessionRoot),
    (error) => error.code === 'deepseek_harness_session_evidence_failed',
  );
});

test('rejects Harness session evidence with a missing tool result', (t) => {
  const sessionRoot = temporaryDirectory(t, 'builder-deepseek-harness-session-');
  appendJsonl(path.join(sessionRoot, 'events.jsonl'), [
    { type: 'turn/start' },
    { type: 'assistant/message' },
    { type: 'tool/call' },
    { type: 'tool/result' },
    { type: 'turn/end' },
    { type: 'turn/start' },
    { type: 'assistant/message' },
    { type: 'tool/call' },
    { type: 'turn/end' },
  ]);

  assert.throws(
    () => readHarnessSessionEvidence(sessionRoot),
    (error) => error.code === 'deepseek_harness_session_evidence_failed',
  );
});

test('reads only fixed generation failure codes from the packaged diagnostic file', (t) => {
  const root = temporaryDirectory(t, 'builder-deepseek-harness-debug-');
  appendJsonl(path.join(root, 'builder-canary-generation-debug.jsonl'), [{
    code: 'builder_programming_runtime_failed',
    phase: 'execute_programming_runtime',
    runtime_cause_code: 'builder_harness_transport_failed',
    runtime_code: 'builder_harness_run_failed',
    unsafe_detail: 'must not be projected',
  }]);

  assert.deepEqual(readGenerationDebug({ path: root }), [{
    code: 'builder_programming_runtime_failed',
    phase: 'execute_programming_runtime',
    runtime_cause_code: 'builder_harness_transport_failed',
    runtime_code: 'builder_harness_run_failed',
  }]);
});

test('projects only event counts and fixed turn failure codes from Harness JSONL', (t) => {
  const sessionRoot = temporaryDirectory(t, 'builder-deepseek-harness-failure-');
  appendJsonl(path.join(sessionRoot, 'session.jsonl'), [
    { type: 'turn/start', data: { turn: 1 } },
    {
      type: 'assistant/chunk',
      data: {
        chunk: {
          type: 'block-end',
          index: 2,
          block: {
            type: 'tool-call',
            id: 'must-not-be-projected',
            arguments: { file_path: 'private/project/file.txt' },
          },
        },
      },
    },
    {
      type: 'turn/end',
      data: {
        turn: 1,
        reason: {
          kind: 'error',
          error: { code: 'HTTP_400', message: 'must not be projected' },
        },
      },
    },
  ]);

  assert.deepEqual(readHarnessFailureEvidence(sessionRoot), {
    assistant_chunk_shapes: [{
      block_type: 'tool-call',
      chunk_keys: ['block', 'index', 'type'],
      chunk_type: 'block-end',
      index: 2,
    }],
    event_counts: { 'assistant/chunk': 1, 'turn/end': 1, 'turn/start': 1 },
    turn_end_reasons: [{ code: 'HTTP_400', kind: 'error' }],
  });
});

test('release DeepSeek gate uses the focused real-provider Harness canary', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8'));
  assert.equal(
    packageJson.scripts['verify:packaged-harness:deepseek'],
    'node scripts/verify-deepseek-packaged-harness-canary.cjs',
  );
  assert.match(packageJson.scripts['verify:release:deepseek'], /verify:packaged-harness:deepseek/u);
  assert.doesNotMatch(packageJson.scripts['verify:release:deepseek'], /verify:packaged-canary:deepseek/u);
  assert.equal(DEFAULT_CODING_LOOP_TIMEOUT_MS, 600_000);
});

test('real-provider soak is explicit, exceeds the old timeout, and requires a multi-file coding task', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8'));

  assert.equal(
    packageJson.scripts['verify:packaged-harness:deepseek:soak'],
    'node scripts/verify-deepseek-packaged-harness-soak.cjs',
  );
  assert.equal(MINIMUM_RUN_DURATION_MS, 120_001);
  assert.equal(CHECK_DELAY_MS, 90_000);
  assert.equal(CODING_LOOP_TIMEOUT_MS, 600_000);
  assert.equal(SOAK_RESULT_VERSION, 'builder-deepseek-packaged-harness-soak-result.v1');
  assert.equal(REQUIRED_DRAFT_FILES.length, 11);
  assert.match(LONG_RUN_BUILD_INSTRUCTION, /one Build run/u);
  assert.match(LONG_RUN_BUILD_INSTRUCTION, /keep giving brief natural-language updates/u);
  assert.match(LONG_RUN_BUILD_INSTRUCTION, /preserve package\.json and check\.js exactly/u);
  assert.match(LONG_RUN_BUILD_INSTRUCTION, /no other files/u);
  assert.match(LONG_RUN_BUILD_INSTRUCTION, /repair only index\.html/u);
});

test('real-provider soak rejects the old 120 second boundary and accepts only a longer run', () => {
  assert.throws(
    () => assertMinimumRunDuration(120_000, MINIMUM_RUN_DURATION_MS),
    (error) => error.code === 'deepseek_harness_soak_duration_failed'
      && error.diagnostic.coding_loop_duration_ms === 120_000
      && error.diagnostic.minimum_run_duration_ms === 120_001,
  );
  assert.doesNotThrow(() => assertMinimumRunDuration(120_001, MINIMUM_RUN_DURATION_MS));
  assert.throws(
    () => assertMinimumRunDuration(Number.NaN, MINIMUM_RUN_DURATION_MS),
    (error) => error.code === 'deepseek_harness_soak_duration_invalid',
  );
});

test('real-provider soak accepts a passing check with or without a repair turn', () => {
  const completed = {
    candidate_ready_count: 1,
    programming_runtime_assistant_message_count: 4,
    programming_runtime_check_failed_count: 0,
    programming_runtime_check_passed_count: 1,
    programming_runtime_tool_activity_count: 20,
    run_completed_count: 1,
    run_started_count: 1,
  };

  assert.equal(isSoakCodingLoopComplete(completed), true);
  assert.equal(isSoakCodingLoopComplete({
    ...completed,
    programming_runtime_check_failed_count: 1,
  }), true);
  assert.equal(isSoakCodingLoopComplete({
    ...completed,
    programming_runtime_check_passed_count: 0,
  }), false);
  assert.equal(isCodingLoopComplete(completed), false);
});

test('real-provider soak CLI forwards only parsed saved-profile input and fixed soak policy', async () => {
  const executablePath = path.join(repositoryRoot, 'release', 'win-unpacked', 'ClawFabric Builder.exe');
  const sourceProfile = path.join(repositoryRoot, 'saved-profile');
  const stdin = passThroughWith(JSON.stringify({
    executable_path: executablePath,
    mode: 'saved_profile',
    schema_version: 'builder-deepseek-packaged-canary-input.v2',
    source_user_data_path: sourceProfile,
  }));
  const stdout = new PassThrough();
  let observed = null;
  const expected = Object.freeze({ result_version: SOAK_RESULT_VERSION, ok: true });

  const result = await runSoakCli({
    argv: ['--execute'],
    stdin,
    stdout,
    async run(input, options) {
      observed = { input, options };
      return expected;
    },
  });

  assert.equal(result, expected);
  assert.deepEqual(observed.input, {
    executable_path: executablePath,
    mode: 'saved_profile',
    schema_version: 'builder-deepseek-packaged-canary-input.v2',
    source_user_data_path: sourceProfile,
  });
  assert.equal(observed.options.minimumRunDurationMs, MINIMUM_RUN_DURATION_MS);
  assert.equal(observed.options.minimumSessionTurnCount, 1);
  assert.equal(observed.options.checkDelayMs, CHECK_DELAY_MS);
  assert.equal(observed.options.codingLoopTimeoutMs, CODING_LOOP_TIMEOUT_MS);
  assert.equal(observed.options.completionPredicate, isSoakCodingLoopComplete);
  assert.equal(observed.options.buildInstruction, LONG_RUN_BUILD_INSTRUCTION);
  assert.equal(observed.options.requiredDraftFiles, REQUIRED_DRAFT_FILES);
  assert.equal(observed.options.resultVersion, SOAK_RESULT_VERSION);
  assert.match(stdout.read().toString('utf8'), /builder-deepseek-packaged-harness-soak-result\.v1/u);
});
