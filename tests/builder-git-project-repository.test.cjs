'use strict';

const assert = require('node:assert/strict');
const nodeCrypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
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
  BUILDER_GIT_CANDIDATE_RECEIPT_VERSION,
  BUILDER_GIT_CANDIDATE_VERIFICATION_VERSION,
  BUILDER_GIT_VERIFIED_CANDIDATE_READ_RESULT_VERSION,
  BuilderGitProjectRepositoryError,
  createBuilderGitProjectRepository,
  createDefaultBuilderGitProjectRepository,
} = require('../electron/builder-git-project-repository.cjs');
const {
  BuilderGitCommandRunnerError,
} = require('../electron/builder-git-command-runner.cjs');

const UUID = '123e4567-e89b-42d3-a456-426614174000';
const PROJECT_ID = `builder-project:${UUID}`;
const CONVERSATION_ID = `builder-conversation:${UUID}`;
const ZERO_DIGEST = `sha256:${'0'.repeat(64)}`;
const ONE_DIGEST = `sha256:${'1'.repeat(64)}`;
const BASE_COMMIT_OID = 'a'.repeat(40);
const OID_PATTERN = /^[0-9a-f]{40}$/u;

function uuid(index) {
  return `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;
}

function id(kind, index) {
  return `builder-${kind}:${uuid(index)}`;
}

function requestId(index) {
  return `builder-git-request:${uuid(index)}`;
}

function append(events, eventType, payload, commandIndex = events.length + 1) {
  const previous = events.at(-1) ?? null;
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
    payload,
    authority: { ...CONVERSATION_AUTHORITY },
  })];
}

function activeRunEvents(index, baseRevision = null, inputDigest = ZERO_DIGEST) {
  const turnId = id('turn', index);
  const taskId = id('task', index);
  const runId = id('run', index);
  let events = [];
  events = append(events, 'turn_submitted', {
    message: { message_id: id('message', index), text: 'Change this project.' },
    turn_id: turnId,
    mode: 'work',
    task: { task_id: taskId, title: 'Change project' },
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

function initialCandidate() {
  return candidate({
    index: 1,
    operations: [
      { operation: 'upsert', path: 'index.html', content: '<main>Hello</main>\n' },
      { operation: 'upsert', path: 'styles.css', content: 'main { color: green; }\n' },
      { operation: 'upsert', path: 'app.js', content: 'document.title = "Hello";\n' },
    ],
  });
}

function updateCandidate(base) {
  return candidate({
    index: 2,
    base,
    revisionReceiptDigest: ONE_DIGEST,
    baseCommitOid: BASE_COMMIT_OID,
    inputDigest: ONE_DIGEST,
    operations: [
      { operation: 'upsert', path: 'index.html', content: '<main>Updated</main>\n' },
      { operation: 'delete', path: 'styles.css', content: null },
      { operation: 'upsert', path: 'README.md', content: '# Updated\n' },
    ],
  });
}

function request(candidateValue, index, expectedBase = null) {
  return {
    request_id: requestId(index),
    expected_base_oid: expectedBase,
    candidate: candidateValue,
  };
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawfabric-builder-git-project-'));
  const projectsRoot = path.join(root, 'projects');
  const runtimeRoot = path.join(root, 'runtime');
  let now = 1_750_000_000;
  const repository = createDefaultBuilderGitProjectRepository({
    projects_root: projectsRoot,
    runtime_root: runtimeRoot,
    now_seconds: () => now++,
  });
  return {
    root,
    projectsRoot,
    runtimeRoot,
    repository,
    restart() {
      return createDefaultBuilderGitProjectRepository({
        projects_root: projectsRoot,
        runtime_root: runtimeRoot,
        now_seconds: () => now++,
      });
    },
  };
}

function expectCode(code, forbidden = []) {
  return (error) => {
    assert.ok(error instanceof BuilderGitProjectRepositoryError);
    assert.equal(error.code, code);
    const serialized = JSON.stringify({
      name: error.name,
      code: error.code,
      message: error.message,
      stack: error.stack,
    });
    for (const marker of forbidden) assert.doesNotMatch(serialized, new RegExp(marker, 'iu'));
    return true;
  };
}

function gitDir(projectsRoot) {
  return path.join(projectsRoot, UUID, '.git');
}

function sha256Hex(value) {
  return nodeCrypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function writeLooseObject(projectRoot, type, payload) {
  const body = Buffer.concat([
    Buffer.from(`${type} ${payload.length}\0`, 'utf8'),
    payload,
  ]);
  const oid = nodeCrypto.createHash('sha1').update(body).digest('hex');
  const objectDirectory = path.join(projectRoot, '.git', 'objects', oid.slice(0, 2));
  fs.mkdirSync(objectDirectory, { recursive: true });
  fs.writeFileSync(path.join(objectDirectory, oid.slice(2)), zlib.deflateSync(body));
  return oid;
}

function writeLooseCommit(projectRoot, source) {
  return writeLooseObject(projectRoot, 'commit', Buffer.from(source, 'utf8'));
}

function writeLooseBlob(projectRoot, source) {
  return writeLooseObject(projectRoot, 'blob', Buffer.from(source, 'utf8'));
}

function writeLooseTree(projectRoot, entries) {
  const chunks = [];
  for (const entry of entries) {
    chunks.push(Buffer.from(`${entry.mode} ${entry.path}\0`, 'utf8'));
    chunks.push(Buffer.from(entry.oid, 'hex'));
  }
  return writeLooseObject(projectRoot, 'tree', Buffer.concat(chunks));
}

function refPathForReceipt(projectRoot, receipt, kind) {
  const requestHash = sha256Hex(receipt.request_id);
  const semanticHash = receipt.semantic_identity_digest.slice('sha256:'.length);
  return path.join(
    projectRoot,
    '.git',
    'refs',
    'clawfabric',
    kind === 'candidate' ? 'candidates' : 'requests',
    kind === 'candidate' ? semanticHash : requestHash,
  );
}

test('prepare_change creates only Git candidate objects, diff, and pending refs', async () => {
  const value = fixture();
  try {
    const change = initialCandidate();
    const pending = await value.repository.prepare_change(request(change, 1));
    const projectRoot = path.join(value.projectsRoot, UUID);
    assert.equal(pending.state, 'pending_confirmation');
    assert.equal(pending.code_authority, 'not_committed');
    assert.equal(pending.product_revision_admission, 'not_recorded');
    assert.equal(pending.expected_base_oid, null);
    assert.match(pending.candidate_tree_oid, OID_PATTERN);
    assert.match(pending.semantic_identity_digest, /^sha256:[0-9a-f]{64}$/u);
    assert.deepEqual(pending.changes, {
      added: ['app.js', 'index.html', 'styles.css'],
      modified: [],
      deleted: [],
    });
    assert.equal(fs.statSync(path.join(projectRoot, '.git')).isDirectory(), true);
    assert.equal(fs.existsSync(path.join(projectRoot, 'index.html')), false);
    assert.equal(fs.existsSync(path.join(projectRoot, '.clawfabric')), false);
    assert.equal(fs.existsSync(path.join(gitDir(value.projectsRoot), 'refs', 'heads', 'main')), false);
    assert.equal(
      fs.readdirSync(path.join(gitDir(value.projectsRoot), 'refs', 'clawfabric', 'pending', 'candidates')).length,
      1,
    );
    assert.deepEqual(fs.readdirSync(path.join(gitDir(value.projectsRoot), 'clawfabric', 'indexes')), []);
  } finally {
    fs.rmSync(value.root, { recursive: true, force: true });
  }
});

test('retries safely when pending refs exist with a crash-partial worktree projection', async () => {
  const value = fixture();
  try {
    const raw = request(initialCandidate(), 1);
    const first = await value.repository.prepare_change(raw);
    const projectRoot = path.join(value.projectsRoot, UUID);
    fs.writeFileSync(path.join(projectRoot, 'index.html'), '<main>Half written before crash</main>\n');
    const replayed = await value.restart().prepare_change(raw);
    assert.equal(replayed.semantic_identity_digest, first.semantic_identity_digest);
    assert.equal(
      fs.readFileSync(path.join(projectRoot, 'index.html'), 'utf8'),
      '<main>Half written before crash</main>\n',
    );
    assert.equal(fs.existsSync(path.join(projectRoot, 'styles.css')), false);
  } finally {
    fs.rmSync(value.root, { recursive: true, force: true });
  }
});

test('persist_candidate_commit creates immutable candidate and request refs without moving main', async () => {
  const value = fixture();
  try {
    const change = initialCandidate();
    const raw = request(change, 1);
    const pending = await value.repository.prepare_change(raw);
    const receipt = await value.repository.persist_candidate_commit(raw);
    assert.equal(receipt.receipt_version, BUILDER_GIT_CANDIDATE_RECEIPT_VERSION);
    assert.deepEqual(Object.keys(receipt), [
      'receipt_version',
      'repository_version',
      'project_id',
      'conversation_id',
      'turn_id',
      'task_id',
      'run_id',
      'request_id',
      'candidate_id',
      'candidate_digest',
      'resulting_tree_digest',
      'semantic_identity_digest',
      'verification_receipt_digest',
      'object_format',
      'commit_oid',
      'tree_oid',
      'parent_oid',
      'expected_base_oid',
      'code_authority',
      'product_revision_admission',
      'replay',
    ]);
    assert.equal(receipt.code_authority, 'git_commit_candidate');
    assert.equal(receipt.product_revision_admission, 'not_recorded');
    assert.equal(receipt.replay, false);
    assert.equal(receipt.tree_oid, pending.candidate_tree_oid);
    assert.equal(receipt.parent_oid, null);
    assert.equal(receipt.expected_base_oid, null);
    assert.match(receipt.commit_oid, OID_PATTERN);
    assert.equal(fs.existsSync(path.join(gitDir(value.projectsRoot), 'refs', 'heads', 'main')), false);
    assert.equal(
      fs.readdirSync(path.join(gitDir(value.projectsRoot), 'refs', 'clawfabric', 'candidates')).length,
      1,
    );
    assert.equal(
      fs.readdirSync(path.join(gitDir(value.projectsRoot), 'refs', 'clawfabric', 'requests')).length,
      1,
    );
    assert.deepEqual(fs.readdirSync(path.join(gitDir(value.projectsRoot), 'clawfabric', 'indexes')), []);
    const verification = await value.repository.verify_candidate_receipt(receipt);
    assert.deepEqual(Object.keys(verification), [
      'receipt_version',
      'repository_version',
      'project_id',
      'conversation_id',
      'turn_id',
      'task_id',
      'run_id',
      'request_id',
      'candidate_id',
      'candidate_digest',
      'expected_base_oid',
      'commit_oid',
      'candidate_tree_oid',
      'resulting_tree_digest',
      'semantic_identity_digest',
      'object_format',
      'commit_ref_admission',
      'request_ref_admission',
      'commit_object_admission',
      'verification_admission',
    ]);
    assert.equal(verification.receipt_version, BUILDER_GIT_CANDIDATE_VERIFICATION_VERSION);
    assert.equal(verification.candidate_tree_oid, receipt.tree_oid);
    assert.equal(verification.verification_admission, 'accepted');

    const restarted = value.restart();
    const replay = await restarted.persist_candidate_commit(structuredClone(raw));
    assert.deepEqual(replay, { ...receipt, replay: true });
    assert.deepEqual(await restarted.verify_candidate_receipt(replay), verification);
  } finally {
    fs.rmSync(value.root, { recursive: true, force: true });
  }
});

test('read_verified_candidate returns a fresh verified Git tree for initial, update, and restart', async () => {
  const value = fixture();
  try {
    const firstChange = initialCandidate();
    const firstReceipt = await value.repository.persist_candidate_commit(request(firstChange, 1));
    const firstRead = await value.repository.read_verified_candidate(firstReceipt);
    assert.deepEqual(Object.keys(firstRead), [
      'result_version',
      'candidate_receipt',
      'verification_receipt',
      'source_tree',
      'code_authority',
      'read_admission',
    ]);
    assert.equal(firstRead.result_version, BUILDER_GIT_VERIFIED_CANDIDATE_READ_RESULT_VERSION);
    assert.equal(firstRead.code_authority, 'git_commit_tree');
    assert.equal(firstRead.read_admission, 'verified');
    assert.deepEqual(firstRead.candidate_receipt, firstReceipt);
    assert.notEqual(firstRead.candidate_receipt, firstReceipt);
    assert.equal(firstRead.verification_receipt.receipt_version, BUILDER_GIT_CANDIDATE_VERIFICATION_VERSION);
    assert.equal(firstRead.verification_receipt.commit_oid, firstReceipt.commit_oid);
    assert.deepEqual(firstRead.source_tree, firstChange.resulting_source_tree);
    assert.notEqual(firstRead.source_tree, firstChange.resulting_source_tree);
    assert.equal(Object.isFrozen(firstRead), true);
    assert.equal(Object.isFrozen(firstRead.candidate_receipt), true);
    assert.equal(Object.isFrozen(firstRead.verification_receipt), true);
    assert.equal(Object.isFrozen(firstRead.source_tree), true);

    const secondChange = updateCandidate(firstRead.source_tree);
    const secondReceipt = await value.repository.persist_candidate_commit(
      request(secondChange, 2, firstReceipt.commit_oid),
    );
    const restartedRead = await value.restart().read_verified_candidate(structuredClone(secondReceipt));
    assert.equal(restartedRead.candidate_receipt.commit_oid, secondReceipt.commit_oid);
    assert.equal(restartedRead.candidate_receipt.parent_oid, firstReceipt.commit_oid);
    assert.deepEqual(restartedRead.source_tree, secondChange.resulting_source_tree);
  } finally {
    fs.rmSync(value.root, { recursive: true, force: true });
  }
});

test('read and verification never recreate a missing project repository', async () => {
  const value = fixture();
  try {
    const receipt = await value.repository.persist_candidate_commit(request(initialCandidate(), 1));
    const projectRoot = path.join(value.projectsRoot, UUID);
    fs.rmSync(projectRoot, { recursive: true, force: true });

    await assert.rejects(
      value.repository.read_verified_candidate(receipt),
      expectCode('builder_git_project_integrity_failed'),
    );
    assert.equal(fs.existsSync(projectRoot), false);

    await assert.rejects(
      value.repository.verify_candidate_receipt(receipt),
      expectCode('builder_git_project_integrity_failed'),
    );
    assert.equal(fs.existsSync(projectRoot), false);
  } finally {
    fs.rmSync(value.root, { recursive: true, force: true });
  }
});

test('bounds Git tree entries and blob bytes before reading the complete tree', async (t) => {
  const value = fixture();
  try {
    const receipt = await value.repository.persist_candidate_commit(request(initialCandidate(), 1));
    const result = (stdout, found = true) => Object.freeze({
      runner_version: 'test-runner.v1',
      operation: 'test',
      found,
      stdout,
    });
    const entry = (index) => (
      `100644 blob ${index.toString(16).padStart(40, '0')}\tfile-${index}.txt\0`
    );

    await t.test('rejects too many entries before the first blob read', async () => {
      let blobReads = 0;
      const bounded = createBuilderGitProjectRepository({
        projects_root: value.projectsRoot,
        runtime_root: value.runtimeRoot,
        now_seconds: () => 1,
        git_runner: {
          async run(operation) {
            if (operation === 'read_object_format') return result('sha1\n');
            if (operation === 'read_candidate' || operation === 'read_request') {
              return result(`${receipt.commit_oid}\n`);
            }
            if (operation === 'list_tree') {
              return result(Array.from({ length: 513 }, (_, index) => entry(index + 1)).join(''));
            }
            if (operation === 'read_blob') blobReads += 1;
            throw new Error('unexpected operation');
          },
        },
      });
      await assert.rejects(
        bounded.read_verified_candidate(receipt),
        expectCode('builder_git_project_integrity_failed'),
      );
      assert.equal(blobReads, 0);
    });

    await t.test('rejects an oversized blob before reading the commit', async () => {
      let commitReads = 0;
      const bounded = createBuilderGitProjectRepository({
        projects_root: value.projectsRoot,
        runtime_root: value.runtimeRoot,
        now_seconds: () => 1,
        git_runner: {
          async run(operation) {
            if (operation === 'read_object_format') return result('sha1\n');
            if (operation === 'read_candidate' || operation === 'read_request') {
              return result(`${receipt.commit_oid}\n`);
            }
            if (operation === 'list_tree') return result(entry(1));
            if (operation === 'read_blob') return result('x'.repeat(512 * 1024 + 1));
            if (operation === 'read_commit') commitReads += 1;
            throw new Error('unexpected operation');
          },
        },
      });
      await assert.rejects(
        bounded.read_verified_candidate(receipt),
        expectCode('builder_git_project_integrity_failed'),
      );
      assert.equal(commitReads, 0);
    });

    await t.test('stops when cumulative source bytes exceed the tree budget', async () => {
      let blobReads = 0;
      const bounded = createBuilderGitProjectRepository({
        projects_root: value.projectsRoot,
        runtime_root: value.runtimeRoot,
        now_seconds: () => 1,
        git_runner: {
          async run(operation) {
            if (operation === 'read_object_format') return result('sha1\n');
            if (operation === 'read_candidate' || operation === 'read_request') {
              return result(`${receipt.commit_oid}\n`);
            }
            if (operation === 'list_tree') {
              return result(Array.from({ length: 9 }, (_, index) => entry(index + 1)).join(''));
            }
            if (operation === 'read_blob') {
              blobReads += 1;
              return result('x'.repeat(512 * 1024));
            }
            throw new Error('unexpected operation');
          },
        },
      });
      await assert.rejects(
        bounded.read_verified_candidate(receipt),
        expectCode('builder_git_project_integrity_failed'),
      );
      assert.equal(blobReads, 9);
    });
  } finally {
    fs.rmSync(value.root, { recursive: true, force: true });
  }
});

test('binds update candidate to expected base as the only commit parent', async () => {
  const value = fixture();
  try {
    const first = initialCandidate();
    const firstRequest = request(first, 1);
    const firstReceipt = await value.repository.persist_candidate_commit(firstRequest);
    const second = updateCandidate(first.resulting_source_tree);
    const secondRequest = request(second, 2, firstReceipt.commit_oid);
    const pending = await value.repository.prepare_change(secondRequest);
    assert.deepEqual(pending.changes, {
      added: ['README.md'],
      modified: ['index.html'],
      deleted: ['styles.css'],
    });
    const secondReceipt = await value.repository.persist_candidate_commit(secondRequest);
    assert.equal(secondReceipt.parent_oid, firstReceipt.commit_oid);
    assert.notEqual(secondReceipt.tree_oid, firstReceipt.tree_oid);
    const commitSource = await value.repository.persist_candidate_commit(structuredClone(secondRequest));
    assert.equal(commitSource.replay, true);
    assert.equal(fs.existsSync(path.join(value.projectsRoot, UUID, 'styles.css')), false);
  } finally {
    fs.rmSync(value.root, { recursive: true, force: true });
  }
});

test('rejects expected base commits whose tree does not match the candidate base tree', async () => {
  const value = fixture();
  try {
    const firstReceipt = await value.repository.persist_candidate_commit(request(initialCandidate(), 1));
    const wrongBase = createBuilderProjectSourceTree({
      files: [{ path: 'index.html', content: '<main>Wrong</main>\n' }],
    });
    const wrong = candidate({
      index: 2,
      base: wrongBase,
      revisionReceiptDigest: ONE_DIGEST,
      baseCommitOid: BASE_COMMIT_OID,
      inputDigest: ONE_DIGEST,
      operations: [{ operation: 'upsert', path: 'index.html', content: '<main>Updated</main>\n' }],
    });
    await assert.rejects(
      value.repository.prepare_change(request(wrong, 2, firstReceipt.commit_oid)),
      expectCode('builder_git_project_conflict'),
    );
  } finally {
    fs.rmSync(value.root, { recursive: true, force: true });
  }
});

test('rejects expected base commits that are not admitted by same-project candidate refs', async () => {
  const value = fixture();
  try {
    const first = initialCandidate();
    const firstReceipt = await value.repository.persist_candidate_commit(request(first, 1));
    const projectRoot = path.join(value.projectsRoot, UUID);
    fs.rmSync(refPathForReceipt(projectRoot, firstReceipt, 'candidate'));
    await assert.rejects(
      value.repository.prepare_change(
        request(updateCandidate(first.resulting_source_tree), 2, firstReceipt.commit_oid),
      ),
      expectCode('builder_git_project_conflict'),
    );
  } finally {
    fs.rmSync(value.root, { recursive: true, force: true });
  }
});

test('does not treat project files as candidate authority during prepare', async () => {
  const value = fixture();
  try {
    const first = initialCandidate();
    const firstReceipt = await value.repository.persist_candidate_commit(request(first, 1));
    fs.writeFileSync(path.join(value.projectsRoot, UUID, 'index.html'), '<main>Local edit</main>\n');
    const pending = await value.repository.prepare_change(
      request(updateCandidate(first.resulting_source_tree), 2, firstReceipt.commit_oid),
    );
    assert.equal(pending.state, 'pending_confirmation');
    assert.equal(fs.readFileSync(path.join(value.projectsRoot, UUID, 'index.html'), 'utf8'), '<main>Local edit</main>\n');
  } finally {
    fs.rmSync(value.root, { recursive: true, force: true });
  }
});

test('serializes per-project prepare requests without projecting either candidate to worktree', async () => {
  const value = fixture();
  try {
    const first = request(initialCandidate(), 1);
    const second = request(candidate({
      index: 2,
      operations: [{ operation: 'upsert', path: 'index.html', content: '<main>Second</main>\n' }],
    }), 2);
    const results = await Promise.allSettled([
      value.repository.prepare_change(first),
      value.repository.prepare_change(second),
    ]);
    assert.equal(results[0].status, 'fulfilled');
    assert.equal(results[1].status, 'fulfilled');
    assert.equal(fs.existsSync(path.join(value.projectsRoot, UUID, 'index.html')), false);
  } finally {
    fs.rmSync(value.root, { recursive: true, force: true });
  }
});

test('same request id with semantic drift conflicts instead of aliasing a candidate', async () => {
  const value = fixture();
  try {
    const raw = request(initialCandidate(), 1);
    await value.repository.persist_candidate_commit(raw);
    const drifted = request(candidate({
      index: 1,
      operations: [{ operation: 'upsert', path: 'index.html', content: '<main>Drift</main>\n' }],
    }), 1);
    await assert.rejects(
      value.repository.persist_candidate_commit(drifted),
      expectCode('builder_git_project_conflict'),
    );
  } finally {
    fs.rmSync(value.root, { recursive: true, force: true });
  }
});

test('replay rejects tampered commit tree, parent, and trailers', async () => {
  const value = fixture();
  try {
    const raw = request(initialCandidate(), 1);
    const originalReceipt = await value.repository.persist_candidate_commit(raw);
    const projectRoot = path.join(value.projectsRoot, UUID);
    fs.writeFileSync(path.join(projectRoot, 'other.txt'), 'tamper\n');
    assert.deepEqual(await value.repository.persist_candidate_commit(raw), { ...originalReceipt, replay: true });
    fs.rmSync(path.join(projectRoot, 'other.txt'));
    const requestRefs = fs.readdirSync(path.join(gitDir(value.projectsRoot), 'refs', 'clawfabric', 'requests'));
    assert.equal(requestRefs.length, 1);
    fs.writeFileSync(
      path.join(gitDir(value.projectsRoot), 'refs', 'clawfabric', 'requests', requestRefs[0]),
      `${'f'.repeat(40)}\n`,
    );
    await assert.rejects(
      value.repository.persist_candidate_commit(raw),
      expectCode('builder_git_project_conflict'),
    );
    await assert.rejects(
      value.repository.read_verified_candidate(originalReceipt),
      expectCode('builder_git_project_integrity_failed'),
    );
    fs.writeFileSync(refPathForReceipt(projectRoot, originalReceipt, 'request'), `${originalReceipt.commit_oid}\n`);
    const restoredReceipt = await value.restart().persist_candidate_commit(raw);
    const badCommitSource = [
      `tree ${restoredReceipt.tree_oid}`,
      'author ClawFabric Builder <builder@localhost> 1750000000 +0000',
      'committer ClawFabric Builder <builder@localhost> 1750000000 +0000',
      '',
      'ClawFabric Builder candidate',
      '',
      `Builder-Object-Format: ${restoredReceipt.object_format}`,
      `Builder-Project-Id: ${restoredReceipt.project_id}`,
      `Builder-Conversation-Id: ${restoredReceipt.conversation_id}`,
      `Builder-Turn-Id: ${restoredReceipt.turn_id}`,
      `Builder-Task-Id: ${restoredReceipt.task_id}`,
      `Builder-Run-Id: ${restoredReceipt.run_id}`,
      `Builder-Request-Id: ${restoredReceipt.request_id}`,
      `Builder-Semantic-Identity-Digest: ${restoredReceipt.semantic_identity_digest}`,
      `Builder-Candidate-Digest: ${restoredReceipt.candidate_digest}`,
      'Builder-Unexpected: accepted',
      `Builder-Expected-Base-Oid: ${restoredReceipt.expected_base_oid ?? 'none'}`,
      '',
    ].join('\n');
    const badOid = writeLooseCommit(projectRoot, badCommitSource);
    fs.writeFileSync(refPathForReceipt(projectRoot, restoredReceipt, 'candidate'), `${badOid}\n`);
    fs.writeFileSync(refPathForReceipt(projectRoot, restoredReceipt, 'request'), `${badOid}\n`);
    await assert.rejects(
      value.repository.verify_candidate_receipt({ ...restoredReceipt, commit_oid: badOid }),
      expectCode('builder_git_project_integrity_failed'),
    );
    await assert.rejects(
      value.repository.read_verified_candidate({ ...restoredReceipt, commit_oid: badOid }),
      expectCode('builder_git_project_integrity_failed'),
    );
  } finally {
    fs.rmSync(value.root, { recursive: true, force: true });
  }
});

test('verification rebuilds source tree bytes and rejects non-file Git tree entries', async () => {
  const value = fixture();
  try {
    const raw = request(initialCandidate(), 1);
    const receipt = await value.repository.persist_candidate_commit(raw);
    const projectRoot = path.join(value.projectsRoot, UUID);
    await assert.rejects(
      value.repository.verify_candidate_receipt({
        ...receipt,
        resulting_tree_digest: ZERO_DIGEST,
      }),
      expectCode('builder_git_project_integrity_failed'),
    );
    await assert.rejects(
      value.repository.read_verified_candidate({
        ...receipt,
        resulting_tree_digest: ZERO_DIGEST,
      }),
      expectCode('builder_git_project_integrity_failed'),
    );

    const wrongBlob = writeLooseBlob(projectRoot, '<main>Tampered</main>\n');
    const wrongBlobTree = writeLooseTree(projectRoot, [
      { mode: '100644', path: 'index.html', oid: wrongBlob },
    ]);
    const wrongBlobCommit = writeLooseCommit(projectRoot, [
      `tree ${wrongBlobTree}`,
      'author ClawFabric Builder <builder@localhost> 1750000000 +0000',
      'committer ClawFabric Builder <builder@localhost> 1750000000 +0000',
      '',
      'ClawFabric Builder candidate',
      '',
      `Builder-Object-Format: ${receipt.object_format}`,
      `Builder-Project-Id: ${receipt.project_id}`,
      `Builder-Conversation-Id: ${receipt.conversation_id}`,
      `Builder-Turn-Id: ${receipt.turn_id}`,
      `Builder-Task-Id: ${receipt.task_id}`,
      `Builder-Run-Id: ${receipt.run_id}`,
      `Builder-Request-Id: ${receipt.request_id}`,
      `Builder-Semantic-Identity-Digest: ${receipt.semantic_identity_digest}`,
      `Builder-Candidate-Digest: ${receipt.candidate_digest}`,
      'Builder-Expected-Base-Oid: none',
      '',
    ].join('\n'));
    fs.writeFileSync(refPathForReceipt(projectRoot, receipt, 'candidate'), `${wrongBlobCommit}\n`);
    fs.writeFileSync(refPathForReceipt(projectRoot, receipt, 'request'), `${wrongBlobCommit}\n`);
    await assert.rejects(
      value.repository.read_verified_candidate({
        ...receipt,
        commit_oid: wrongBlobCommit,
        tree_oid: wrongBlobTree,
      }),
      expectCode('builder_git_project_integrity_failed'),
    );

    const symlinkBlob = writeLooseBlob(projectRoot, 'index.html');
    const symlinkTree = writeLooseTree(projectRoot, [
      { mode: '120000', path: 'index.html', oid: symlinkBlob },
    ]);
    const badCommit = writeLooseCommit(projectRoot, [
      `tree ${symlinkTree}`,
      'author ClawFabric Builder <builder@localhost> 1750000000 +0000',
      'committer ClawFabric Builder <builder@localhost> 1750000000 +0000',
      '',
      'ClawFabric Builder candidate',
      '',
      `Builder-Object-Format: ${receipt.object_format}`,
      `Builder-Project-Id: ${receipt.project_id}`,
      `Builder-Conversation-Id: ${receipt.conversation_id}`,
      `Builder-Turn-Id: ${receipt.turn_id}`,
      `Builder-Task-Id: ${receipt.task_id}`,
      `Builder-Run-Id: ${receipt.run_id}`,
      `Builder-Request-Id: ${receipt.request_id}`,
      `Builder-Semantic-Identity-Digest: ${receipt.semantic_identity_digest}`,
      `Builder-Candidate-Digest: ${receipt.candidate_digest}`,
      'Builder-Expected-Base-Oid: none',
      '',
    ].join('\n'));
    fs.writeFileSync(refPathForReceipt(projectRoot, receipt, 'candidate'), `${badCommit}\n`);
    fs.writeFileSync(refPathForReceipt(projectRoot, receipt, 'request'), `${badCommit}\n`);
    await assert.rejects(
      value.repository.verify_candidate_receipt({
        ...receipt,
        commit_oid: badCommit,
        tree_oid: symlinkTree,
      }),
      expectCode('builder_git_project_integrity_failed'),
    );
    await assert.rejects(
      value.repository.read_verified_candidate({
        ...receipt,
        commit_oid: badCommit,
        tree_oid: symlinkTree,
      }),
      expectCode('builder_git_project_integrity_failed'),
    );
  } finally {
    fs.rmSync(value.root, { recursive: true, force: true });
  }
});

test('rejects protected source paths before refs and ignores unrelated worktree files', async () => {
  const value = fixture();
  try {
    for (const filePath of ['.git/config', '.clawfabric/project.json', '.gitmodules', '.gitattributes']) {
      const change = candidate({
        index: 1,
        operations: [{ operation: 'upsert', path: filePath, content: 'unsafe\n' }],
      });
      await assert.rejects(
        value.repository.prepare_change(request(change, 1)),
        expectCode('builder_git_project_invalid'),
      );
    }

    const raw = request(initialCandidate(), 1);
    await value.repository.prepare_change(raw);
    const projectRoot = path.join(value.projectsRoot, UUID);
    fs.writeFileSync(path.join(projectRoot, 'unexpected.txt'), 'not part of either tree\n');
    const replay = await value.repository.prepare_change(raw);
    assert.equal(replay.state, 'pending_confirmation');
    assert.equal(fs.readFileSync(path.join(projectRoot, 'unexpected.txt'), 'utf8'), 'not part of either tree\n');
    fs.symlinkSync(value.root, path.join(projectRoot, 'linked'), 'junction');
    assert.equal((await value.repository.prepare_change(raw)).state, 'pending_confirmation');
  } finally {
    fs.rmSync(value.root, { recursive: true, force: true });
  }
});

test('rejects project root symlinks and partial pending refs', async () => {
  const value = fixture();
  try {
    const external = path.join(value.root, 'external-project');
    fs.mkdirSync(external);
    fs.mkdirSync(value.projectsRoot, { recursive: true });
    fs.symlinkSync(external, path.join(value.projectsRoot, UUID), 'junction');
    await assert.rejects(
      value.repository.prepare_change(request(initialCandidate(), 1)),
      expectCode('builder_git_project_integrity_failed'),
    );
    fs.rmSync(path.join(value.projectsRoot, UUID), { recursive: true, force: true });

    const raw = request(initialCandidate(), 1);
    await value.repository.prepare_change(raw);
    const pendingRequests = path.join(gitDir(value.projectsRoot), 'refs', 'clawfabric', 'pending', 'requests');
    const [pendingRequest] = fs.readdirSync(pendingRequests);
    fs.rmSync(path.join(pendingRequests, pendingRequest));
    await assert.rejects(
      value.repository.prepare_change(raw),
      expectCode('builder_git_project_conflict'),
    );
  } finally {
    fs.rmSync(value.root, { recursive: true, force: true });
  }
});

test('forged candidates fail closed without leaking values and caller cannot inject verification', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawfabric-builder-git-project-'));
  const marker = 'private-git-project-marker';
  try {
    const repository = createDefaultBuilderGitProjectRepository({
      projects_root: path.join(root, 'projects'),
      runtime_root: path.join(root, 'runtime'),
      now_seconds: () => 1_750_000_000,
    });
    await assert.rejects(
      repository.verify_candidate_receipt({
        echo: marker,
      }),
      expectCode('builder_git_project_invalid', [marker]),
    );
    await assert.rejects(
      repository.read_verified_candidate({
        echo: marker,
      }),
      expectCode('builder_git_project_invalid', [marker]),
    );

    const forged = structuredClone(initialCandidate());
    forged.resulting_source_tree.files[0].content = marker;
    const good = createDefaultBuilderGitProjectRepository({
      projects_root: path.join(root, 'projects-good'),
      runtime_root: path.join(root, 'runtime-good'),
      now_seconds: () => 1_750_000_000,
    });
    await assert.rejects(
      good.prepare_change(request(forged, 1)),
      expectCode('builder_git_project_invalid', [marker]),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('normalizes hostile runner errors without invoking proxy traps or accessors', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawfabric-builder-git-project-'));
  const marker = 'private-runner-error-marker';
  let thrown;
  let traps = 0;
  const proxyError = new Proxy({}, {
    getPrototypeOf() {
      traps += 1;
      return BuilderGitCommandRunnerError.prototype;
    },
    getOwnPropertyDescriptor() {
      traps += 1;
      return { configurable: true, enumerable: true, value: 'builder_git_command_invalid' };
    },
  });
  const nestedPrototype = Object.create(BuilderGitCommandRunnerError.prototype);
  Object.defineProperty(nestedPrototype, 'code', {
    enumerable: true,
    get: () => { throw new Error(marker); },
  });
  try {
    const repository = createBuilderGitProjectRepository({
      projects_root: path.join(root, 'projects'),
      runtime_root: path.join(root, 'runtime'),
      git_runner: {
        run() {
          throw thrown;
        },
      },
      now_seconds: () => 1_750_000_000,
    });
    thrown = proxyError;
    await assert.rejects(
      repository.prepare_change(request(initialCandidate(), 1)),
      expectCode('builder_git_project_failed', [marker]),
    );
    assert.equal(traps, 0);
    thrown = nestedPrototype;
    await assert.rejects(
      repository.prepare_change(request(initialCandidate(), 1)),
      expectCode('builder_git_project_failed', [marker]),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('source boundary is main-only candidate Git authority with no current, IPC, SQLite, or network', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-git-project-repository.cjs'),
    'utf8',
  );
  assert.match(source, /sanitizeBuilderCodeChangeCandidate/u);
  assert.match(source, /sanitizeBuilderProjectSourceTree/u);
  assert.match(source, /prepare_change/u);
  assert.match(source, /persist_candidate_commit/u);
  assert.match(source, /read_verified_candidate/u);
  assert.match(source, /verify_candidate_receipt/u);
  assert.match(source, /code_authority:\s*'git_commit_tree'/u);
  assert.match(source, /read_admission:\s*'verified'/u);
  assert.match(source, /code_authority:\s*CODE_AUTHORITY/u);
  assert.match(source, /product_revision_admission:\s*PRODUCT_REVISION_ADMISSION/u);
  assert.match(source, /const scheduled = next\.catch\(\(\) => undefined\)\.finally/u);
  assert.match(source, /queues\.get\(key\) === scheduled/u);
  assert.doesNotMatch(source, /verification_receipt_digest:\s*`sha256:\$\{'0'\.repeat\(64\)\}`/u);
  assert.doesNotMatch(
    source,
    /builder-project-revision-repository|head\.json|read_current|load_current|verifyCandidate|['"]verify_candidate['"]|refs\/heads\/main|ipcMain|ipcRenderer|preload|BrowserWindow|sqlite|better-sqlite|fetch\s*\(|https?:|child_process|execFile|shell/iu,
  );
});
