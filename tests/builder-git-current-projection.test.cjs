'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  CONVERSATION_AUTHORITY,
  CONVERSATION_EVENT_KIND,
  CONVERSATION_EVENT_VERSION,
  createBuilderConversationEvent,
} = require('../electron/builder-conversation-records.cjs');
const {
  BUILDER_PROJECT_BASE_REVISION_EVIDENCE_VERSION,
  createBuilderCodeChangeCandidate,
} = require('../electron/builder-code-change-kernel.cjs');
const {
  createBuilderProjectSourceTree,
} = require('../electron/builder-project-source-tree.cjs');
const {
  createDefaultBuilderGitProjectRepository,
} = require('../electron/builder-git-project-repository.cjs');
const {
  createBuilderGitCandidateVerificationReceipt,
  sha256Canonical,
} = require('../electron/builder-git-receipt-contract.cjs');
const {
  BUILDER_GIT_CURRENT_PROJECTION_RESULT_VERSION,
  BUILDER_GIT_CURRENT_PROJECTION_VERSION,
  BuilderGitCurrentProjectionError,
  createBuilderGitCurrentProjection,
  createDefaultBuilderGitCurrentProjection,
} = require('../electron/builder-git-current-projection.cjs');
const {
  BuilderGitCommandRunnerError,
  createDefaultBuilderGitCommandRunner,
} = require('../electron/builder-git-command-runner.cjs');

const UUID = '123e4567-e89b-42d3-a456-426614174000';
const PROJECT_ID = `builder-project:${UUID}`;
const CONVERSATION_ID = `builder-conversation:${UUID}`;
const ZERO_DIGEST = `sha256:${'0'.repeat(64)}`;
const ONE_DIGEST = `sha256:${'1'.repeat(64)}`;
const TWO_DIGEST = `sha256:${'2'.repeat(64)}`;

function uuid(index) {
  return `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;
}

function id(kind, index) {
  return `builder-${kind}:${uuid(index)}`;
}

function requestId(index) {
  return `builder-git-request:${uuid(index)}`;
}

function routeDecision(payload) {
  const route = payload.mode === 'work' ? 'build' : 'answer';
  return {
    decision_id: `builder-route-decision:${payload.message.message_id.slice('builder-message:'.length)}`,
    decision_version: 'builder-composer-route-decision.v1',
    project_id: PROJECT_ID,
    message_id: payload.message.message_id,
    task_id: payload.task === null ? null : payload.task.task_id,
    route,
    confidence: 'high',
    matched_signals: [payload.mode === 'work' ? 'test_work_turn' : 'test_question_turn'],
    downgraded_from: null,
    downgrade_reason: null,
    required_permissions: route === 'build' ? ['write_project'] : [],
    permission_result: route === 'build' ? 'allowed' : 'not_required',
    dispatch: route === 'build' ? 'build' : 'reply',
    decided_at_ms: 1,
  };
}

function append(events, eventType, payload, commandIndex = events.length + 1) {
  const previous = events.at(-1) ?? null;
  const normalizedPayload = eventType === 'turn_submitted'
    ? {
      ...payload,
      route_decision: Object.hasOwn(payload, 'route_decision')
        ? payload.route_decision
        : routeDecision(payload),
    }
    : payload;
  return [...events, createBuilderConversationEvent({
    record_version: CONVERSATION_EVENT_VERSION,
    record_kind: CONVERSATION_EVENT_KIND,
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    sequence: events.length + 1,
    command_id: id('command', commandIndex),
    event_type: eventType,
    previous_event: previous === null ? null : {
      sequence: previous.sequence,
      event_id: previous.event_id,
      event_digest: previous.event_digest,
    },
    payload: normalizedPayload,
    authority: { ...CONVERSATION_AUTHORITY },
  })];
}

function activeRunEvents(index, baseRevision = null, inputDigest = ZERO_DIGEST) {
  const turnId = id('turn', index);
  const taskId = id('task', index);
  const runId = id('run', index);
  let events = [];
  events = append(events, 'turn_submitted', {
    message: { message_id: id('message', index), text: 'Project this change.' },
    turn_id: turnId,
    mode: 'work',
    task: { task_id: taskId, title: 'Project change' },
    base_revision: baseRevision,
  }, index * 2 - 1);
  events = append(events, 'run_started', {
    turn_id: turnId,
    run_id: runId,
    task_id: taskId,
    attempt_number: 1,
    retry_of_run_id: null,
    input_digest: inputDigest,
  }, index * 2);
  return { events, turnId, runId };
}

function candidate({
  index,
  base = createBuilderProjectSourceTree({ files: [] }),
  operations,
  revisionReceiptDigest = null,
  baseCommitOid = null,
  inputDigest = ZERO_DIGEST,
}) {
  const active = activeRunEvents(
    index,
    revisionReceiptDigest === null ? null : {
      revision_receipt_digest: revisionReceiptDigest,
      commit_oid: baseCommitOid,
    },
    inputDigest,
  );
  return createBuilderCodeChangeCandidate({
    conversation_events: active.events,
    turn_id: active.turnId,
    run_id: active.runId,
    base_revision_evidence: revisionReceiptDigest === null ? null : {
      evidence_version: BUILDER_PROJECT_BASE_REVISION_EVIDENCE_VERSION,
      project_id: PROJECT_ID,
      revision_receipt_digest: revisionReceiptDigest,
      commit_oid: baseCommitOid,
      source_tree_digest: base.source_tree_digest,
      verification_admission: 'git_sqlite_read_authority_verified',
    },
    base_source_tree: base,
    operations,
  });
}

function request(candidateValue, index, expectedBase = null) {
  return {
    request_id: requestId(index),
    expected_base_oid: expectedBase,
    candidate: candidateValue,
  };
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawfabric-builder-current-projection-'));
  const projectsRoot = path.join(root, 'projects');
  const runtimeRoot = path.join(root, 'runtime');
  let now = 1_750_000_000;
  const repository = createDefaultBuilderGitProjectRepository({
    projects_root: projectsRoot,
    runtime_root: runtimeRoot,
    now_seconds: () => now++,
  });
  const projection = createDefaultBuilderGitCurrentProjection({
    projects_root: projectsRoot,
    runtime_root: runtimeRoot,
    git_repository: repository,
  });
  const runner = createDefaultBuilderGitCommandRunner({ runtime_root: runtimeRoot });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return {
    root,
    projectsRoot,
    runtimeRoot,
    repository,
    projection,
    runner,
    projectRoot: path.join(projectsRoot, UUID),
  };
}

function expectProjectionError(code, forbidden = []) {
  return (error) => {
    assert.ok(error instanceof BuilderGitCurrentProjectionError);
    assert.equal(error.code, code);
    const serialized = JSON.stringify({
      name: error.name,
      code: error.code,
      message: error.message,
      stack: error.stack,
    });
    assert.doesNotMatch(serialized, /credential|api\.deepseek|source_tree|private marker/iu);
    for (const marker of forbidden) assert.doesNotMatch(serialized, new RegExp(marker, 'iu'));
    return true;
  };
}

function receiptForSourceTree(sourceTree) {
  const provisional = {
    receipt_version: 'builder-git-candidate-receipt.v1',
    repository_version: 'builder-git-project-repository.v1',
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    turn_id: id('turn', 9),
    task_id: id('task', 9),
    run_id: id('run', 9),
    request_id: requestId(9),
    candidate_id: `builder-code-change-candidate:${'9'.repeat(64)}`,
    candidate_digest: `sha256:${'8'.repeat(64)}`,
    resulting_tree_digest: sourceTree.source_tree_digest,
    semantic_identity_digest: `sha256:${'7'.repeat(64)}`,
    verification_receipt_digest: `sha256:${'0'.repeat(64)}`,
    object_format: 'sha1',
    commit_oid: 'a'.repeat(40),
    tree_oid: 'b'.repeat(40),
    parent_oid: null,
    expected_base_oid: null,
    code_authority: 'git_commit_candidate',
    product_revision_admission: 'not_recorded',
    replay: false,
  };
  const verification = createBuilderGitCandidateVerificationReceipt(provisional);
  return {
    ...provisional,
    verification_receipt_digest: sha256Canonical(verification),
  };
}

test('projects a verified candidate to Git main and repairs the materialized worktree', async (t) => {
  const value = fixture(t);
  const first = candidate({
    index: 1,
    operations: [
      { operation: 'upsert', path: 'index.html', content: '<main>Hello</main>\n' },
      { operation: 'upsert', path: 'styles.css', content: 'main { color: green; }\n' },
      { operation: 'upsert', path: 'src/app.js', content: 'document.title = "Hello";\n' },
    ],
  });
  const receipt = await value.repository.persist_candidate_commit(request(first, 1));
  fs.writeFileSync(path.join(value.projectRoot, 'scratch.txt'), 'local drift\n');
  fs.mkdirSync(path.join(value.projectRoot, '.clawfabric'), { recursive: true });
  fs.writeFileSync(path.join(value.projectRoot, '.clawfabric', 'identity.json'), '{}\n');

  const projected = await value.projection.project_current({
    candidate_receipt: receipt,
    projection_mode: 'base_cas',
  });
  assert.equal(projected.result_version, BUILDER_GIT_CURRENT_PROJECTION_RESULT_VERSION);
  assert.equal(projected.project_id, PROJECT_ID);
  assert.equal(projected.commit_oid, receipt.commit_oid);
  assert.equal(projected.tree_oid, receipt.tree_oid);
  assert.equal(projected.expected_base_oid, null);
  assert.equal(projected.previous_main_oid, null);
  assert.equal(projected.main_ref, 'updated');
  assert.equal(projected.worktree, 'materialized');
  assert.equal(projected.worktree_file_count, 3);
  assert.equal(projected.projection_authority, 'git_main_ref_and_materialized_worktree');
  assert.equal(projected.source_admission, 'git_verified_candidate');
  assert.doesNotMatch(JSON.stringify(projected), /<main>|document\.title|credential|receipt_digest/u);

  const main = await value.runner.run('read_main_ref', value.projectRoot, { object_format: 'sha1' });
  assert.equal(main.stdout.trim(), receipt.commit_oid);
  assert.equal(fs.readFileSync(path.join(value.projectRoot, 'index.html'), 'utf8'), '<main>Hello</main>\n');
  assert.equal(fs.readFileSync(path.join(value.projectRoot, 'src', 'app.js'), 'utf8'), 'document.title = "Hello";\n');
  assert.equal(fs.existsSync(path.join(value.projectRoot, 'scratch.txt')), false);
  assert.equal(fs.readFileSync(path.join(value.projectRoot, '.clawfabric', 'identity.json'), 'utf8'), '{}\n');

  fs.writeFileSync(path.join(value.projectRoot, 'index.html'), '<main>drift</main>\n');
  fs.writeFileSync(path.join(value.projectRoot, 'scratch-again.txt'), 'drift\n');
  const replay = await value.projection.project_current({
    candidate_receipt: structuredClone(receipt),
    projection_mode: 'base_cas',
  });
  assert.equal(replay.main_ref, 'already_current');
  assert.equal(replay.previous_main_oid, receipt.commit_oid);
  assert.equal(fs.readFileSync(path.join(value.projectRoot, 'index.html'), 'utf8'), '<main>Hello</main>\n');
  assert.equal(fs.existsSync(path.join(value.projectRoot, 'scratch-again.txt')), false);
});

test('projects a verified candidate into the selected source folder from project identity', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawfabric-builder-current-projection-selected-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const projectsRoot = path.join(root, 'projects');
  const runtimeRoot = path.join(root, 'runtime');
  const selectedRoot = path.join(root, 'selected-source');
  fs.mkdirSync(selectedRoot, { recursive: true });
  assert.equal(path.relative(projectsRoot, selectedRoot).startsWith('..'), true);
  const resolverCalls = [];
  let now = 1_750_000_000;
  const resolveProjectRoot = (projectId) => {
    resolverCalls.push(projectId);
    assert.equal(projectId, PROJECT_ID);
    return selectedRoot;
  };
  const repository = createDefaultBuilderGitProjectRepository({
    projects_root: projectsRoot,
    runtime_root: runtimeRoot,
    now_seconds: () => now++,
    resolve_project_root: resolveProjectRoot,
  });
  const projection = createDefaultBuilderGitCurrentProjection({
    projects_root: projectsRoot,
    runtime_root: runtimeRoot,
    git_repository: repository,
    resolve_project_root: resolveProjectRoot,
  });
  const runner = createDefaultBuilderGitCommandRunner({ runtime_root: runtimeRoot });
  const first = candidate({
    index: 1,
    operations: [
      { operation: 'upsert', path: 'index.html', content: '<main>Selected source</main>\n' },
      { operation: 'upsert', path: 'src/app.js', content: 'document.title = "Selected";\n' },
    ],
  });
  const receipt = await repository.persist_candidate_commit(request(first, 1));
  const internalProjectRoot = path.join(projectsRoot, UUID);
  assert.equal(fs.existsSync(internalProjectRoot), false);
  assert.equal(fs.existsSync(path.join(selectedRoot, 'index.html')), false);
  fs.writeFileSync(path.join(selectedRoot, 'scratch.txt'), 'local drift\n');

  const projected = await projection.project_current({
    candidate_receipt: receipt,
    projection_mode: 'base_cas',
  });

  assert.equal(projected.result_version, BUILDER_GIT_CURRENT_PROJECTION_RESULT_VERSION);
  assert.equal(projected.project_id, PROJECT_ID);
  assert.equal(projected.commit_oid, receipt.commit_oid);
  assert.equal(projected.main_ref, 'updated');
  assert.equal(projected.worktree, 'materialized');
  assert.equal(projected.worktree_file_count, 2);
  assert.equal(fs.existsSync(internalProjectRoot), false);
  assert.equal(fs.readFileSync(path.join(selectedRoot, 'index.html'), 'utf8'), '<main>Selected source</main>\n');
  assert.equal(fs.readFileSync(path.join(selectedRoot, 'src', 'app.js'), 'utf8'), 'document.title = "Selected";\n');
  assert.equal(fs.existsSync(path.join(selectedRoot, 'scratch.txt')), false);
  const main = await runner.run('read_main_ref', selectedRoot, { object_format: 'sha1' });
  assert.equal(main.stdout.trim(), receipt.commit_oid);
  assert.equal(resolverCalls.every((projectId) => projectId === PROJECT_ID), true);
  assert.equal(JSON.stringify(projected).includes(selectedRoot), false);
});

test('fails closed on main CAS conflict without releasing a false projection', async (t) => {
  const value = fixture(t);
  const first = candidate({
    index: 1,
    operations: [{ operation: 'upsert', path: 'index.html', content: '<main>Base</main>\n' }],
  });
  const firstReceipt = await value.repository.persist_candidate_commit(request(first, 1));
  await value.projection.project_current({
    candidate_receipt: firstReceipt,
    projection_mode: 'base_cas',
  });
  const base = (await value.repository.read_verified_candidate(firstReceipt)).source_tree;

  const selected = candidate({
    index: 2,
    base,
    revisionReceiptDigest: ONE_DIGEST,
    baseCommitOid: firstReceipt.commit_oid,
    inputDigest: ONE_DIGEST,
    operations: [{ operation: 'upsert', path: 'index.html', content: '<main>Selected</main>\n' }],
  });
  const conflicting = candidate({
    index: 3,
    base,
    revisionReceiptDigest: TWO_DIGEST,
    baseCommitOid: firstReceipt.commit_oid,
    inputDigest: TWO_DIGEST,
    operations: [{ operation: 'upsert', path: 'index.html', content: '<main>Conflict</main>\n' }],
  });
  const selectedReceipt = await value.repository.persist_candidate_commit(
    request(selected, 2, firstReceipt.commit_oid),
  );
  const conflictingReceipt = await value.repository.persist_candidate_commit(
    request(conflicting, 3, firstReceipt.commit_oid),
  );
  await value.projection.project_current({
    candidate_receipt: conflictingReceipt,
    projection_mode: 'sqlite_current_repair',
  });

  await assert.rejects(
    value.projection.project_current({
      candidate_receipt: selectedReceipt,
      projection_mode: 'base_cas',
    }),
    expectProjectionError('builder_git_current_projection_conflict'),
  );
  const repaired = await value.projection.project_current({
    candidate_receipt: selectedReceipt,
    projection_mode: 'sqlite_current_repair',
  });
  assert.equal(repaired.main_ref, 'repaired');
  const repairedMain = await value.runner.run('read_main_ref', value.projectRoot, { object_format: 'sha1' });
  assert.equal(repairedMain.stdout.trim(), selectedReceipt.commit_oid);
  assert.equal(fs.readFileSync(path.join(value.projectRoot, 'index.html'), 'utf8'), '<main>Selected</main>\n');
});

test('rejects protected source paths before touching main', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawfabric-builder-current-projection-invalid-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const projectsRoot = path.join(root, 'projects');
  const projectRoot = path.join(projectsRoot, UUID);
  fs.mkdirSync(path.join(projectRoot, '.git'), { recursive: true });
  const calls = [];

  for (const unsafePath of [
    '.git/config',
    '.GIT/config',
    '.Git',
    '.clawfabric/config.json',
    '.CLAWFABRIC/config.json',
    'src/.Git/config',
    '.GitModules',
    'src/.GITATTRIBUTES',
  ]) {
    const sourceTree = createBuilderProjectSourceTree({
      files: [{ path: unsafePath, content: 'protected path drift\n' }],
    });
    const receipt = receiptForSourceTree(sourceTree);
    const verification = createBuilderGitCandidateVerificationReceipt(receipt);
    const projection = createBuilderGitCurrentProjection({
      projects_root: projectsRoot,
      git_runner: {
        run(operation) {
          calls.push(operation);
          throw new Error('private marker must not run');
        },
      },
      read_verified_candidate() {
        return {
          result_version: 'builder-git-verified-candidate-read-result.v1',
          candidate_receipt: receipt,
          verification_receipt: verification,
          source_tree: sourceTree,
          code_authority: 'git_commit_tree',
          read_admission: 'verified',
        };
      },
    });

    assert.equal(projection.authority_version, BUILDER_GIT_CURRENT_PROJECTION_VERSION);
    await assert.rejects(
      projection.project_current({
        candidate_receipt: receipt,
        projection_mode: 'base_cas',
      }),
      expectProjectionError('builder_git_current_projection_invalid', ['private marker']),
    );
  }
  assert.deepEqual(calls, []);
});

test('rejects case-drifted local config roots before updating main', async (t) => {
  const value = fixture(t);
  const first = candidate({
    index: 1,
    operations: [{ operation: 'upsert', path: 'index.html', content: '<main>Hello</main>\n' }],
  });
  const receipt = await value.repository.persist_candidate_commit(request(first, 1));
  fs.writeFileSync(path.join(value.projectRoot, '.CLAWFABRIC'), 'local config drift\n');

  await assert.rejects(
    value.projection.project_current({
      candidate_receipt: receipt,
      projection_mode: 'base_cas',
    }),
    expectProjectionError('builder_git_current_projection_unavailable'),
  );
  const main = await value.runner.run('read_main_ref', value.projectRoot, { object_format: 'sha1' });
  assert.equal(main.found, false);
});

test('maps update-ref failures to unavailable when main has not changed', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawfabric-builder-current-projection-update-fail-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const projectsRoot = path.join(root, 'projects');
  const projectRoot = path.join(projectsRoot, UUID);
  fs.mkdirSync(path.join(projectRoot, '.git'), { recursive: true });
  const sourceTree = createBuilderProjectSourceTree({
    files: [{ path: 'index.html', content: '<main>Hello</main>\n' }],
  });
  const receipt = receiptForSourceTree(sourceTree);
  const verification = createBuilderGitCandidateVerificationReceipt(receipt);
  const operations = [];
  const projection = createBuilderGitCurrentProjection({
    projects_root: projectsRoot,
    git_runner: {
      run(operation) {
        operations.push(operation);
        if (operation === 'read_main_ref') {
          return { found: false, stdout: '' };
        }
        if (operation === 'update_main_ref') {
          throw new BuilderGitCommandRunnerError('builder_git_command_failed');
        }
        throw new Error('private unexpected operation');
      },
    },
    read_verified_candidate() {
      return {
        result_version: 'builder-git-verified-candidate-read-result.v1',
        candidate_receipt: receipt,
        verification_receipt: verification,
        source_tree: sourceTree,
        code_authority: 'git_commit_tree',
        read_admission: 'verified',
      };
    },
  });

  await assert.rejects(
    projection.project_current({
      candidate_receipt: receipt,
      projection_mode: 'base_cas',
    }),
    expectProjectionError('builder_git_current_projection_unavailable'),
  );
  assert.deepEqual(operations, ['read_main_ref', 'update_main_ref', 'read_main_ref']);
  assert.equal(fs.existsSync(path.join(projectRoot, 'index.html')), false);
});

test('source boundary remains main-only and free of renderer, provider, SQLite, or network authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-git-current-projection.cjs'),
    'utf8',
  );
  assert.match(source, /git_main_ref_and_materialized_worktree/u);
  assert.match(source, /project_current/u);
  assert.doesNotMatch(
    source,
    /require\(['"]electron['"]\)|ipcMain|ipcRenderer|contextBridge|BrowserWindow|safeStorage|fetch\s*\(|https?:|Authorization|Bearer|provider|credential|node:sqlite|better-sqlite|refs\/clawfabric|shell:\s*true/iu,
  );
});
