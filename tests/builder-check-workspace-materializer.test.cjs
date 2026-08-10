'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  createBuilderProjectSourceTree,
} = require('../electron/builder-project-source-tree.cjs');
const {
  createBuilderCheckRunAdmission,
  createBuilderCheckRunExecutionApproval,
} = require('../electron/builder-check-run-admission.cjs');
const {
  createBuilderGitCandidateVerificationReceipt,
  sha256Canonical,
} = require('../electron/builder-git-receipt-contract.cjs');
const {
  createBuilderProjectUnderstandingSnapshot,
} = require('../electron/builder-project-understanding.cjs');
const {
  checkRuntimeIdentity,
} = require('./helpers/builder-check-runtime-identity-fixture.cjs');
const {
  BUILDER_CHECK_WORKSPACE_MATERIALIZER_VERSION,
  BUILDER_CHECK_WORKSPACE_ADMISSION_VERSION,
  BuilderCheckWorkspaceMaterializerError,
  createBuilderCheckWorkspaceMaterializer,
} = require('../electron/builder-check-workspace-materializer.cjs');

const PROJECT_ID = 'builder-project:11111111-1111-4111-8111-111111111111';
const CANDIDATE_DIGEST = `sha256:${'2'.repeat(64)}`;
const CANDIDATE_ID = `builder-code-change-candidate:${'2'.repeat(64)}`;

function sourceTree(files = [
  { path: 'package.json', content: '{"scripts":{"test":"node --test"}}\n' },
  { path: 'src/index.js', content: 'export const answer = 42;\n' },
]) {
  return createBuilderProjectSourceTree({ files });
}

function fixture(t) {
  const outerRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cfb-check-workspace-'));
  const checksRoot = path.join(outerRoot, 'checks');
  fs.mkdirSync(checksRoot);
  t.after(() => fs.rmSync(outerRoot, { recursive: true, force: true }));
  return { outerRoot, checksRoot };
}

function checkRunAdmission(tree = sourceTree()) {
  const understanding = createBuilderProjectUnderstandingSnapshot({
    project_id: PROJECT_ID,
    root_digest: `sha256:${'1'.repeat(64)}`,
    source_tree: tree,
    previous_successful_check_runs: [],
    updated_at_ms: 90,
  });
  const seed = {
    receipt_version: 'builder-git-candidate-receipt.v1',
    repository_version: 'builder-git-project-repository.v1',
    project_id: PROJECT_ID,
    conversation_id: 'builder-conversation:11111111-1111-4111-8111-111111111111',
    turn_id: 'builder-turn:11111111-1111-4111-8111-111111111111',
    task_id: 'builder-task:11111111-1111-4111-8111-111111111111',
    run_id: 'builder-run:11111111-1111-4111-8111-111111111111',
    request_id: 'builder-git-request:11111111-1111-4111-8111-111111111111',
    candidate_id: CANDIDATE_ID,
    candidate_digest: CANDIDATE_DIGEST,
    resulting_tree_digest: tree.source_tree_digest,
    semantic_identity_digest: `sha256:${'3'.repeat(64)}`,
    verification_receipt_digest: `sha256:${'4'.repeat(64)}`,
    object_format: 'sha1',
    commit_oid: '5'.repeat(40),
    tree_oid: '6'.repeat(40),
    parent_oid: null,
    expected_base_oid: null,
    code_authority: 'git_commit_candidate',
    product_revision_admission: 'not_recorded',
    replay: false,
  };
  const candidate = {
    ...seed,
    verification_receipt_digest: sha256Canonical(
      createBuilderGitCandidateVerificationReceipt(seed),
    ),
  };
  const verification = createBuilderGitCandidateVerificationReceipt(candidate);
  const checkpoint = {
    checkpoint_id: `builder-draft-checkpoint:${'7'.repeat(64)}`,
    checkpoint_sequence: 1,
    candidate_id: candidate.candidate_id,
    candidate_digest: candidate.candidate_digest,
    resulting_tree_digest: candidate.resulting_tree_digest,
  };
  const approval = createBuilderCheckRunExecutionApproval({
    draft_id: `builder-generation-draft:${'d'.repeat(64)}`,
    draft_checkpoint_ref: checkpoint,
    git_candidate_receipt: candidate,
    git_verification_receipt: verification,
    project_understanding_snapshot: understanding,
    command_profile_id: understanding.command_profiles[0].command_profile_id,
    runtime_identity: checkRuntimeIdentity(),
    approved_at_ms: 100,
    expires_at_ms: 300_100,
  });
  return createBuilderCheckRunAdmission({
    execution_approval: approval,
    draft_checkpoint_ref: checkpoint,
    git_candidate_receipt: candidate,
    git_verification_receipt: verification,
    project_understanding_snapshot: understanding,
    runtime_identity: checkRuntimeIdentity(),
    admitted_at_ms: 101,
  });
}

function request(tree = sourceTree(), overrides = {}) {
  return {
    check_run_admission: checkRunAdmission(tree),
    source_tree: tree,
    ...overrides,
  };
}

function assertMaterializerError(error, forbidden = []) {
  assert.equal(error instanceof BuilderCheckWorkspaceMaterializerError, true);
  assert.equal(error.code, 'builder_check_workspace_materializer_invalid');
  assert.equal(error.message, 'The candidate check workspace could not be prepared.');
  assert.equal(error.retryable, false);
  assert.equal(error.stack, `${error.name}: ${error.message}`);
  const serialized = JSON.stringify({
    name: error.name,
    code: error.code,
    message: error.message,
    stack: error.stack,
  });
  for (const marker of forbidden) assert.doesNotMatch(serialized, new RegExp(marker, 'iu'));
  assert.doesNotMatch(serialized, /source_tree|file_content|checks_root|candidate-[0-9a-f]|api[_-]?key|secret/iu);
  return true;
}

test('materializes a candidate into a unique trusted workspace and verifies persisted UTF-8', (t) => {
  const { checksRoot } = fixture(t);
  const tree = sourceTree();
  const materializer = createBuilderCheckWorkspaceMaterializer({ checks_root: checksRoot });
  const first = materializer.materialize_candidate(request(tree));
  const second = materializer.materialize_candidate(request(tree));
  const firstPath = materializer.read_workspace_path(first);
  const secondPath = materializer.read_workspace_path(second);

  assert.equal(materializer.materializer_version, BUILDER_CHECK_WORKSPACE_MATERIALIZER_VERSION);
  assert.equal(first.admission_version, BUILDER_CHECK_WORKSPACE_ADMISSION_VERSION);
  assert.equal(first.admission_kind, 'builder_check_workspace_admission');
  assert.equal(first.check_run_admission_id, request(tree).check_run_admission.admission_id);
  assert.equal(first.project_id, PROJECT_ID);
  assert.equal(first.candidate_id, CANDIDATE_ID);
  assert.equal(first.candidate_digest, CANDIDATE_DIGEST);
  assert.equal(first.resulting_tree_digest, tree.source_tree_digest);
  assert.equal(first.materialized_file_count, 2);
  assert.equal(first.authority.renderer_authority, 'not_present');
  assert.equal(first.authority.provider_dispatch, false);
  assert.equal(first.authority.command_execution, false);
  assert.equal(first.authority.git_authority, 'not_present');
  assert.equal(first.authority.sqlite_authority, 'not_present');
  assert.equal(Object.hasOwn(first, 'workspace_path'), false);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(path.relative(fs.realpathSync.native(checksRoot), firstPath).startsWith('..'), false);
  assert.notEqual(firstPath, secondPath);
  assert.equal(fs.readFileSync(path.join(firstPath, 'src', 'index.js'), 'utf8'), tree.files[1].content);
});

test('rejects forged admission, tree identity, protected Git, and exact-object drift', (t) => {
  const { checksRoot } = fixture(t);
  const tree = sourceTree();
  const materializer = createBuilderCheckWorkspaceMaterializer({ checks_root: checksRoot });

  assert.throws(
    () => materializer.materialize_candidate(request(tree, {
      check_run_admission: {
        ...checkRunAdmission(tree),
        candidate_id: `builder-code-change-candidate:${'b'.repeat(64)}`,
      },
    })),
    assertMaterializerError,
  );
  const driftedTree = structuredClone(tree);
  driftedTree.files[0].content = '{"scripts":{}}\n';
  assert.throws(
    () => materializer.materialize_candidate({
      check_run_admission: checkRunAdmission(tree),
      source_tree: driftedTree,
    }),
    assertMaterializerError,
  );
  assert.throws(
    () => materializer.materialize_candidate(request(tree, { renderer_authority: true })),
    assertMaterializerError,
  );
  const protectedTree = sourceTree([
    { path: 'package.json', content: '{"scripts":{"test":"node --test"}}\n' },
    { path: '.git/config', content: '[core]\n' },
  ]);
  assert.throws(
    () => materializer.materialize_candidate(request(protectedTree)),
    assertMaterializerError,
  );
  assert.throws(
    () => createBuilderProjectSourceTree({ files: [{ path: '../escape.js', content: 'x\n' }] }),
    /project source tree could not be verified/iu,
  );
});

test('uses exclusive file creation and removes a partial workspace when a target already exists', (t) => {
  const { checksRoot } = fixture(t);
  const materializer = createBuilderCheckWorkspaceMaterializer({ checks_root: checksRoot });
  const originalOpenSync = fs.openSync;
  let injected = false;
  fs.openSync = function openSyncWithExistingTarget(targetPath, flags, mode) {
    if (!injected && flags === 'wx' && targetPath.endsWith('package.json')) {
      injected = true;
      fs.closeSync(originalOpenSync(targetPath, 'w', mode));
    }
    return originalOpenSync(targetPath, flags, mode);
  };
  try {
    assert.throws(
      () => materializer.materialize_candidate(request()),
      assertMaterializerError,
    );
  } finally {
    fs.openSync = originalOpenSync;
  }
  assert.equal(injected, true);
  assert.deepEqual(fs.readdirSync(checksRoot), []);
});

test('rejects symlink and junction roots and detects a symlink introduced after admission', (t) => {
  const { outerRoot, checksRoot } = fixture(t);
  const linkedRoot = path.join(outerRoot, 'linked-checks');
  fs.symlinkSync(checksRoot, linkedRoot, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(
    () => createBuilderCheckWorkspaceMaterializer({ checks_root: linkedRoot }),
    assertMaterializerError,
  );

  const materializer = createBuilderCheckWorkspaceMaterializer({ checks_root: checksRoot });
  const admission = materializer.materialize_candidate(request());
  const workspacePath = materializer.read_workspace_path(admission);
  const outside = path.join(outerRoot, 'outside');
  fs.mkdirSync(outside);
  const linkedEntry = path.join(workspacePath, 'linked');
  fs.symlinkSync(outside, linkedEntry, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(
    () => materializer.read_workspace_path(admission),
    assertMaterializerError,
  );
  fs.unlinkSync(linkedEntry);
  assert.deepEqual(materializer.cleanup(admission), { cleaned: true, reason: 'removed' });
});

test('cleanup is admission-bound and idempotent', (t) => {
  const { checksRoot } = fixture(t);
  const materializer = createBuilderCheckWorkspaceMaterializer({ checks_root: checksRoot });
  const admission = materializer.materialize_candidate(request());
  const workspacePath = materializer.read_workspace_path(admission);
  const generatedDirectory = path.join(workspacePath, 'coverage');
  fs.mkdirSync(generatedDirectory);
  fs.writeFileSync(path.join(generatedDirectory, 'summary.json'), '{"passed":true}\n');

  assert.throws(
    () => materializer.cleanup({ ...admission }),
    assertMaterializerError,
  );
  assert.deepEqual(materializer.cleanup(admission), { cleaned: true, reason: 'removed' });
  assert.equal(fs.existsSync(workspacePath), false);
  assert.deepEqual(materializer.cleanup(admission), { cleaned: false, reason: 'already_cleaned' });
  assert.throws(
    () => materializer.read_workspace_path(admission),
    assertMaterializerError,
  );
});

test('rejects accessors and proxies without invoking hostile accessors or leaking their values', (t) => {
  const { checksRoot } = fixture(t);
  const materializer = createBuilderCheckWorkspaceMaterializer({ checks_root: checksRoot });
  let getterCalls = 0;
  const accessor = request();
  Object.defineProperty(accessor, 'project_id', {
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new Error('secret-value');
    },
  });
  assert.throws(
    () => materializer.materialize_candidate(accessor),
    (error) => assertMaterializerError(error, ['secret-value']),
  );
  assert.equal(getterCalls, 0);
  assert.throws(
    () => materializer.materialize_candidate(new Proxy(request(), {})),
    assertMaterializerError,
  );
  assert.throws(
    () => createBuilderCheckWorkspaceMaterializer(new Proxy({ checks_root: checksRoot }, {})),
    assertMaterializerError,
  );
});

test('source is main-only filesystem materialization without IPC, provider, Git, SQLite, or execution authority', () => {
  const sourcePath = path.join(
    __dirname,
    '..',
    'electron',
    'builder-check-workspace-materializer.cjs',
  );
  const source = fs.readFileSync(sourcePath, 'utf8');
  const imports = [...source.matchAll(/require\((['"])([^'"]+)\1\)/gu)].map((match) => match[2]);

  assert.deepEqual(imports, [
    'node:fs',
    'node:crypto',
    'node:path',
    'node:util',
    './builder-project-source-tree.cjs',
    './builder-check-run-admission.cjs',
  ]);
  assert.match(source, /sanitizeBuilderProjectSourceTree/u);
  assert.match(source, /sanitizeBuilderCheckRunAdmission/u);
  assert.match(source, /TRUSTED_ADMISSIONS = new WeakSet/u);
  assert.match(source, /ADMISSION_STATE = new WeakMap/u);
  assert.match(source, /openSync\(targetPath, 'wx'/u);
  assert.match(source, /isSymbolicLink\(\)/u);
  assert.match(source, /realpathSync\.native/u);
  assert.doesNotMatch(
    source,
    /require\(['"]electron['"]\)|ipcMain|ipcRenderer|contextBridge|BrowserWindow|WebContentsView|builder-provider|builder-product-metadata|node:sqlite|DatabaseSync|node:child_process|execFile|spawn\s*\(|fetch\s*\(|https?:\/\//iu,
  );
});
