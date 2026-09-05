'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  DeepSeekPackagedAgentHistoryE2ECanaryError,
  copySavedBuilderWorkspaceProfile,
  summarizeMainPerformance,
  summarizeRendererPerformanceWindow,
} = require('../scripts/verify-deepseek-packaged-agent-history-e2e-canary.cjs');

function trace(metrics, extra = {}) {
  return Object.freeze({
    metrics: Object.freeze(metrics.map(([name, count, total, max = total]) => Object.freeze({
      name,
      count,
      sample_count: count,
      total,
      median: count === 0 ? 0 : total / count,
      p95: max,
      max,
    }))),
    ...extra,
  });
}

function temporaryRoot(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `clawfabric-builder-${name}-`));
}

function removeTemporaryRoot(root) {
  const resolved = path.resolve(root);
  assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
  assert.match(path.basename(resolved), /^clawfabric-builder-[a-z-]+-/u);
  fs.rmSync(resolved, { force: true, recursive: true });
}

test('clones durable Builder workspace history while excluding providers and transient runtimes', () => {
  const source = temporaryRoot('profile-source');
  const target = temporaryRoot('profile-target');
  try {
    const durableDirectories = [
      'builder-agent-conversations-v1',
      'builder-agent-workbench-messages-v1',
      'builder-product-metadata-v6',
      'builder-session-task-addresses-v2',
    ];
    for (const directory of durableDirectories) {
      const current = path.join(source, directory);
      fs.mkdirSync(current);
      fs.writeFileSync(path.join(current, 'state.db'), directory, 'utf8');
    }
    for (const directory of [
      'builder-check-workspaces-v1',
      'builder-harness-sessions-v1',
      'builder-provider-config-v1',
      'builder-provider-secrets-v1',
    ]) {
      const current = path.join(source, directory);
      fs.mkdirSync(current);
      fs.writeFileSync(path.join(current, 'excluded'), directory, 'utf8');
    }
    fs.mkdirSync(path.join(source, 'Cache'));

    const result = copySavedBuilderWorkspaceProfile(
      { mode: 'saved_profile', source_user_data_path: source },
      { realPath: target },
    );

    assert.equal(result.copied_directory_count, durableDirectories.length);
    for (const directory of durableDirectories) {
      assert.equal(
        fs.readFileSync(path.join(target, directory, 'state.db'), 'utf8'),
        directory,
      );
    }
    assert.equal(fs.existsSync(path.join(target, 'builder-check-workspaces-v1')), false);
    assert.equal(fs.existsSync(path.join(target, 'builder-harness-sessions-v1')), false);
    assert.equal(fs.existsSync(path.join(target, 'builder-provider-config-v1')), false);
    assert.equal(fs.existsSync(path.join(target, 'builder-provider-secrets-v1')), false);
    assert.equal(fs.existsSync(path.join(target, 'Cache')), false);
  } finally {
    removeTemporaryRoot(source);
    removeTemporaryRoot(target);
  }
});

test('refuses to clone a saved Builder profile onto itself', () => {
  const source = temporaryRoot('profile-same');
  try {
    fs.mkdirSync(path.join(source, 'builder-product-metadata-v6'));
    assert.throws(
      () => copySavedBuilderWorkspaceProfile(
        { mode: 'saved_profile', source_user_data_path: source },
        { realPath: source },
      ),
      (error) => (
        error instanceof DeepSeekPackagedAgentHistoryE2ECanaryError
        && error.code === 'deepseek_agent_history_profile_clone_failed'
      ),
    );
  } finally {
    removeTemporaryRoot(source);
  }
});

test('summarizes renderer performance as bounded phase deltas', () => {
  const before = trace([
    ['renderer.activity.commit_count', 2, 2],
    ['renderer.task_stream.clone_freeze.duration_ms', 1, 4, 4],
    ['renderer.task_stream.read.result_bytes', 1, 2_048, 2_048],
  ]);
  const after = trace([
    ['renderer.activity.commit_count', 7, 7],
    ['renderer.task_stream.clone_freeze.duration_ms', 4, 16, 8],
    ['renderer.task_stream.read.result_bytes', 4, 12_288, 4_096],
    ['renderer.live_output.received_count', 9, 9],
  ]);

  const summary = summarizeRendererPerformanceWindow(before, after);

  assert.equal(summary.activity_commits, 5);
  assert.deepEqual(summary.task_stream.clone_freeze, {
    count: 3,
    total_ms: 12,
    max: 8,
  });
  assert.equal(summary.task_stream.result_bytes_max, 4_096);
  assert.equal(summary.live_output.received, 9);
});

test('summarizes Main performance without content or identifiers', () => {
  const summary = summarizeMainPerformance(trace([
    ['main.conversation.load.duration_ms', 3, 12, 6],
    ['main.conversation.load.event_bytes', 3, 9_000, 4_000],
    ['main.harness_runtime.empty_token_limit_recovery.count', 2, 2, 1],
    ['main.harness_tool_broker.tool_search.duration_ms', 2, 18, 12],
    ['main.harness_tool_broker.tool_search.active_count', 2, 2, 1],
    ['main.task_stream.projection.duration_ms', 4, 20, 8],
    ['main.workbench.read.duration_ms', 2, 6, 4],
    ['main.workbench.task_sync.duration_ms', 2, 10, 7],
    ['main.workbench.task_sync.task_count', 2, 2, 1],
  ], {
    event_loop_delay: Object.freeze({ max_ms: 24 }),
  }));

  assert.equal(summary.application_event_loop_delay_max_ms, 24);
  assert.equal(summary.conversation.load.total, 12);
  assert.equal(summary.conversation.loaded_event_bytes_max, 4_000);
  assert.equal(summary.harness_runtime.empty_token_limit_recovery_count, 2);
  assert.equal(summary.tool_broker.search.max, 12);
  assert.equal(summary.tool_broker.search_active_max, 1);
  assert.equal(summary.task_stream.projection.count, 4);
  assert.equal(summary.workbench.read.total, 6);
  assert.equal(summary.workbench.task_sync.total, 10);
  assert.equal(summary.workbench.task_sync_task_count_max, 1);
  assert.equal(JSON.stringify(summary).includes('project_id'), false);
});

test('Agent history canary settles from durable task facts without requiring Preview', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'scripts', 'verify-deepseek-packaged-agent-history-e2e-canary.cjs'),
    'utf8',
  );

  assert.doesNotMatch(source, /waitForGenerationTerminal/u);
  assert.match(source, /recorded_active_turn_id === null/u);
  assert.match(source, /counts\?\.run_completed_count >= 1/u);
  assert.match(source, /counts\?\.turn_completed_count >= 1/u);
  assert.match(source, /optionalVisible\(page, SELECTORS\.unsavedDraft\)/u);
});

test('Agent history canary creates its first task through the visible Agent Plan workflow', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'scripts', 'verify-deepseek-packaged-agent-history-e2e-canary.cjs'),
    'utf8',
  );

  assert.match(source, /createAgentPlanTaskViaUi\(page,/u);
  assert.match(source, /options\.onPlanReady\(currentPage, app\)/u);
  assert.match(source, /SELECTORS\.composerAddPlanMode/u);
  assert.match(source, /data-builder-agent-plan-decision/u);
  assert.match(source, /getByRole\('button', \{ name: 'Approve plan' \}\)\.click/u);
  assert.match(source, /dispatched\.actions\.length === 1/u);
  assert.match(source, /SELECTORS\.agentTaskProposalNewProject/u);
  assert.match(source, /agent_plan_dispatched_exactly_one_task: true/u);
  assert.match(source, /if \(!liveMarkdownObserved\) fail\('deepseek_agent_plan_live_markdown_missing'\)/u);
  assert.match(source, /SELECTORS\.cancelWork\)\.waitFor\(\{ state: 'hidden'/u);
  assert.match(source, /review_ready_without_followup: true/u);
  assert.match(source, /submission_attempts: submissionAttempts/u);
  assert.match(source, /both_agent_tasks_saved_via_ui: true/u);
  assert.match(source, /cancelled_revision_status_visible: cancelledNoticeId !== null/u);
  assert.match(source, /restart_preserved_cancelled_status: cancelledNoticeId !== null && restartVerified/u);
  assert.match(source, /deepseek_agent_cancel_notice_not_restored/u);
  assert.match(source, /deepseek_agent_plan_revision_not_implemented/u);
  assert.match(source, /currentPlan\.source_message_id/u);
  assert.doesNotMatch(
    source,
    /const firstAgentTaskAddressId = await createAgentTaskProposalViaBridge/u,
  );
});
