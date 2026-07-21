'use strict';

const assert = require('node:assert/strict');
const nodeCrypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  digestBuilderProjectProposalRecord,
  digestBuilderProjectRevisionRecord,
  serializeBuilderProjectRevisionRecord,
} = require('../electron/builder-project-revision-record.cjs');
const {
  BuilderProjectRevisionRepositoryError,
  createBuilderProjectRevisionRepository,
} = require('../electron/builder-project-revision-repository.cjs');

const PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174000';
const OTHER_PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174001';
const REQUEST_DIGEST = `sha256:${'a'.repeat(64)}`;

function fixture(overrides = {}) {
  const revision = overrides.revision ?? 1;
  const parent = overrides.parent_revision ?? null;
  const projectId = overrides.project_id ?? PROJECT_ID;
  const candidate = {
    schema_version: 1,
    record_kind: 'builder_project_revision',
    project_id: projectId,
    revision,
    revision_digest: `sha256:${'0'.repeat(64)}`,
    parent_revision: parent,
    title: overrides.title ?? `Focus board ${revision}`,
    summary: overrides.summary ?? 'A small board for today\'s priorities.',
    files: overrides.files ?? {
      'index.html': `<main><h1>Revision ${revision}</h1><section class="board"></section></main>`,
      'styles.css': '.board { display: grid; gap: 1rem; }',
      'app.js': 'const board = document.querySelector(".board");\nvoid board;',
    },
    proposal_evidence: {
      authority: 'builder_code_project_generator',
      prompt_version: 'builder-code-project.v1',
      request_version: 'builder-generation-request.v1',
      result_version: 'builder-generation-result.v1',
      request_digest: REQUEST_DIGEST,
      proposal_digest: `sha256:${'0'.repeat(64)}`,
      project_id: projectId,
      target_revision: revision,
      parent_revision: parent,
    },
    execution_admission: 'not_evaluated',
    preview_script_admission: 'not_authorized',
  };
  candidate.proposal_evidence.proposal_digest = digestBuilderProjectProposalRecord(candidate);
  candidate.revision_digest = digestBuilderProjectRevisionRecord(candidate);
  return candidate;
}

function nextRevision(parent, overrides = {}) {
  return fixture({
    ...overrides,
    project_id: parent.project_id,
    revision: parent.revision + 1,
    parent_revision: { revision: parent.revision, revision_digest: parent.revision_digest },
  });
}

function expectedPrevious(record) {
  return record.parent_revision === null ? null : { ...record.parent_revision };
}

function temporaryRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawfabric-builder-projects-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function projectPaths(root, projectId = PROJECT_ID) {
  const hash = nodeCrypto.createHash('sha256')
    .update(`builder-project-repository/project\0${projectId}`, 'utf8')
    .digest('hex');
  const projectDirectory = path.join(root, 'builder-project-revisions', hash);
  return {
    projectDirectory,
    revisionsDirectory: path.join(projectDirectory, 'revisions'),
    headPath: path.join(projectDirectory, 'head.json'),
  };
}

function numberedProjectId(index) {
  return `builder-project:00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;
}

function revisionPath(root, record) {
  return path.join(
    projectPaths(root, record.project_id).revisionsDirectory,
    `${record.revision}-${record.revision_digest.slice(7)}.json`,
  );
}

function assertRepositoryError(code) {
  return (error) => error instanceof BuilderProjectRevisionRepositoryError
    && error.code === code
    && !error.message.includes(PROJECT_ID)
    && !error.message.includes(os.tmpdir());
}

test('commits immutable revision one before publishing and reopening the project head', async (t) => {
  const root = temporaryRoot(t);
  const repository = createBuilderProjectRevisionRepository(root);
  const revision = fixture();

  const result = await repository.commit({ revision, expected_previous: null });

  assert.equal(result.result_version, 'builder-project-repository-result.v1');
  assert.deepEqual(result.record, revision);
  assert.equal(result.head.project_id, PROJECT_ID);
  assert.equal(result.head.revision, 1);
  assert.equal(result.head.revision_digest, revision.revision_digest);
  assert.equal(result.idempotent_replay, false);
  assert.deepEqual(result.persistence_evidence, {
    evidence_version: 'builder-project-repository-result.v1',
    operation: 'committed',
    authority_scope: 'single_main_process_serialized_expected_head',
    cross_process_cas: 'not_proven',
    sudden_power_loss_durability: 'not_proven',
    revision_file_fsync: 'proven',
    immutable_revision_publish: 'no_clobber_completed',
    revision_parent_directory_fsync: result.persistence_evidence.revision_parent_directory_fsync,
    head_file_fsync: 'proven',
    head_publish: 'same_directory_replace_reopened',
    head_parent_directory_fsync: result.persistence_evidence.head_parent_directory_fsync,
    reopened_hash_verified: true,
  });
  assert.match(result.persistence_evidence.revision_parent_directory_fsync, /^(?:proven|not_proven)$/u);
  assert.match(result.persistence_evidence.head_parent_directory_fsync, /^(?:proven|not_proven)$/u);
  assert.equal(fs.readFileSync(revisionPath(root, revision), 'utf8'),
    serializeBuilderProjectRevisionRecord(revision));
  assert.equal(fs.existsSync(projectPaths(root).headPath), true);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.record.files), true);
});

test('replays the exact current revision without rewriting and restores it in a new repository instance', async (t) => {
  const root = temporaryRoot(t);
  const revision = fixture();
  const firstRepository = createBuilderProjectRevisionRepository(root);
  await firstRepository.commit({ revision, expected_previous: null });
  const paths = projectPaths(root);
  const headBefore = fs.readFileSync(paths.headPath);
  const revisionBefore = fs.readFileSync(revisionPath(root, revision));

  const replay = await firstRepository.commit({ revision: structuredClone(revision), expected_previous: null });
  assert.equal(replay.idempotent_replay, true);
  assert.equal(replay.persistence_evidence.operation, 'replayed');
  assert.equal(replay.persistence_evidence.head_publish, 'not_performed');
  assert.deepEqual(fs.readFileSync(paths.headPath), headBefore);
  assert.deepEqual(fs.readFileSync(revisionPath(root, revision)), revisionBefore);

  const restarted = createBuilderProjectRevisionRepository(root);
  const loaded = await restarted.load_current({ project_id: PROJECT_ID });
  assert.deepEqual(loaded.record, revision);
  assert.equal(loaded.restart_restore, true);
  assert.equal(loaded.persistence_evidence.operation, 'current_loaded');
  assert.deepEqual(fs.readFileSync(paths.headPath), headBefore);
});

test('advances only from the exact expected previous head and preserves historical revisions', async (t) => {
  const root = temporaryRoot(t);
  const repository = createBuilderProjectRevisionRepository(root);
  const revisionOne = fixture();
  const revisionTwo = nextRevision(revisionOne);
  await repository.commit({ revision: revisionOne, expected_previous: null });

  const committed = await repository.commit({
    revision: revisionTwo,
    expected_previous: expectedPrevious(revisionTwo),
  });
  assert.equal(committed.head.revision, 2);

  const historical = await repository.load_revision({
    project_id: PROJECT_ID,
    revision: revisionOne.revision,
    revision_digest: revisionOne.revision_digest,
  });
  assert.deepEqual(historical.record, revisionOne);
  assert.deepEqual((await repository.load_current({ project_id: PROJECT_ID })).record, revisionTwo);
  assert.equal(fs.existsSync(revisionPath(root, revisionOne)), true);
  assert.equal(fs.existsSync(revisionPath(root, revisionTwo)), true);
});

test('rejects stale, missing, regressing, and same-revision competing heads without claiming CAS', async (t) => {
  const root = temporaryRoot(t);
  const repository = createBuilderProjectRevisionRepository(root);
  const revisionOne = fixture();
  const revisionTwo = nextRevision(revisionOne);
  await repository.commit({ revision: revisionOne, expected_previous: null });
  await repository.commit({ revision: revisionTwo, expected_previous: expectedPrevious(revisionTwo) });

  const competingTwo = nextRevision(revisionOne, { title: 'Competing revision two' });
  await assert.rejects(
    repository.commit({ revision: competingTwo, expected_previous: expectedPrevious(competingTwo) }),
    assertRepositoryError('builder_project_repository_conflict'),
  );
  await assert.rejects(
    repository.commit({ revision: revisionOne, expected_previous: null }),
    assertRepositoryError('builder_project_repository_conflict'),
  );

  const unrelated = fixture({ project_id: OTHER_PROJECT_ID, revision: 2, parent_revision: {
    revision: 1, revision_digest: revisionOne.revision_digest,
  } });
  await assert.rejects(
    repository.commit({ revision: unrelated, expected_previous: unrelated.parent_revision }),
    assertRepositoryError('builder_project_repository_conflict'),
  );
});

test('serializes competing same-project writers across repository instances', async (t) => {
  const root = temporaryRoot(t);
  const first = createBuilderProjectRevisionRepository(root);
  const second = createBuilderProjectRevisionRepository(root);
  const revisionOne = fixture();
  await first.commit({ revision: revisionOne, expected_previous: null });
  const left = nextRevision(revisionOne, { title: 'Left candidate' });
  const right = nextRevision(revisionOne, { title: 'Right candidate' });

  const outcomes = await Promise.allSettled([
    first.commit({ revision: left, expected_previous: expectedPrevious(left) }),
    second.commit({ revision: right, expected_previous: expectedPrevious(right) }),
  ]);

  assert.equal(outcomes.filter((outcome) => outcome.status === 'fulfilled').length, 1);
  assert.equal(outcomes.filter((outcome) => outcome.status === 'rejected').length, 1);
  const rejected = outcomes.find((outcome) => outcome.status === 'rejected');
  assert.equal(rejected.reason.code, 'builder_project_repository_conflict');
  const current = await first.load_current({ project_id: PROJECT_ID });
  assert.ok([left.revision_digest, right.revision_digest].includes(current.record.revision_digest));
});

test('recovers an exact orphan immutable revision by publishing only the missing head update', async (t) => {
  const root = temporaryRoot(t);
  const repository = createBuilderProjectRevisionRepository(root);
  const revisionOne = fixture();
  const revisionTwo = nextRevision(revisionOne);
  await repository.commit({ revision: revisionOne, expected_previous: null });
  fs.writeFileSync(revisionPath(root, revisionTwo), serializeBuilderProjectRevisionRecord(revisionTwo), {
    encoding: 'utf8', flag: 'wx',
  });

  await assert.rejects(
    repository.load_revision({
      project_id: PROJECT_ID,
      revision: revisionTwo.revision,
      revision_digest: revisionTwo.revision_digest,
    }),
    assertRepositoryError('builder_project_repository_not_found'),
  );

  const result = await repository.commit({
    revision: revisionTwo,
    expected_previous: expectedPrevious(revisionTwo),
  });
  assert.equal(result.idempotent_replay, false);
  assert.equal(result.persistence_evidence.revision_file_fsync, 'not_performed_existing_exact');
  assert.equal(result.persistence_evidence.immutable_revision_publish, 'existing_exact');
  assert.equal(result.head.revision_digest, revisionTwo.revision_digest);
});

test('lists verified current project summaries in stable identity order after restart', async (t) => {
  const root = temporaryRoot(t);
  const repository = createBuilderProjectRevisionRepository(root);
  const first = fixture();
  const second = nextRevision(first, {
    title: 'Focus board revised',
    summary: 'The current saved revision.',
  });
  const other = fixture({
    project_id: OTHER_PROJECT_ID,
    title: 'Timer',
    summary: 'A small focus timer.',
  });
  await repository.commit({ revision: other, expected_previous: null });
  await repository.commit({ revision: first, expected_previous: null });
  await repository.commit({ revision: second, expected_previous: expectedPrevious(second) });

  const restarted = createBuilderProjectRevisionRepository(root);
  const listed = await restarted.list_current();

  assert.deepEqual(listed, {
    result_version: 'builder-project-catalog-result.v1',
    projects: [
      {
        project_id: PROJECT_ID,
        title: second.title,
        summary: second.summary,
        revision: second.revision,
        revision_digest: second.revision_digest,
      },
      {
        project_id: OTHER_PROJECT_ID,
        title: other.title,
        summary: other.summary,
        revision: other.revision,
        revision_digest: other.revision_digest,
      },
    ],
    catalog_evidence: {
      source_authority: 'verified_project_head_and_revision_chain',
      ordering: 'project_id_ascending',
      recency: 'not_available',
      global_atomic_snapshot: 'not_proven',
      headless_orphans: 'excluded',
      write_activity: 'none',
      resource_bounds: {
        max_project_directories: 256,
        max_file_reads: 1_024,
        max_bytes: 32 * 1024 * 1024,
      },
    },
  });
  assert.equal(Object.isFrozen(listed), true);
  assert.equal(Object.isFrozen(listed.projects), true);
  assert.equal(Object.isFrozen(listed.projects[0]), true);
  assert.equal(Object.hasOwn(listed.projects[0], 'files'), false);
  assert.equal(Object.hasOwn(listed.projects[0], 'parent_revision'), false);
  assert.equal(Object.hasOwn(listed.projects[0], 'proposal_evidence'), false);

  const secondRead = await restarted.list_current();
  assert.deepEqual(secondRead, listed);
  assert.notEqual(secondRead, listed);
  assert.notEqual(secondRead.projects, listed.projects);
  assert.notEqual(secondRead.projects[0], listed.projects[0]);
});

test('returns an empty verified catalog and excludes a headless orphan without writing or cleaning', async (t) => {
  const root = temporaryRoot(t);
  const repository = createBuilderProjectRevisionRepository(root);
  const empty = await repository.list_current();
  assert.deepEqual(empty.projects, []);

  const committed = fixture();
  await repository.commit({ revision: committed, expected_previous: null });
  const orphan = fixture({ project_id: OTHER_PROJECT_ID });
  const orphanPaths = projectPaths(root, OTHER_PROJECT_ID);
  fs.mkdirSync(orphanPaths.projectDirectory);
  fs.mkdirSync(orphanPaths.revisionsDirectory);
  fs.writeFileSync(revisionPath(root, orphan), serializeBuilderProjectRevisionRecord(orphan), 'utf8');
  const interruptedPaths = projectPaths(root, numberedProjectId(2));
  fs.mkdirSync(interruptedPaths.projectDirectory);
  const committedHeadBefore = fs.readFileSync(projectPaths(root).headPath);
  const orphanBefore = fs.readFileSync(revisionPath(root, orphan));
  const forbiddenWrites = [];
  const originalMethods = new Map();
  for (const method of ['mkdirSync', 'writeFileSync', 'fsyncSync', 'linkSync', 'unlinkSync', 'renameSync']) {
    originalMethods.set(method, fs[method]);
    fs[method] = () => {
      forbiddenWrites.push(method);
      throw new Error(`unexpected ${method}`);
    };
  }
  let listed;
  try {
    listed = await repository.list_current();
  } finally {
    for (const [method, implementation] of originalMethods) fs[method] = implementation;
  }

  assert.deepEqual(listed.projects.map((project) => project.project_id), [PROJECT_ID]);
  assert.deepEqual(forbiddenWrites, []);
  assert.deepEqual(fs.readFileSync(projectPaths(root).headPath), committedHeadBefore);
  assert.deepEqual(fs.readFileSync(revisionPath(root, orphan)), orphanBefore);
  assert.equal(fs.existsSync(orphanPaths.headPath), false);
  assert.equal(fs.existsSync(interruptedPaths.headPath), false);
  assert.equal(fs.existsSync(interruptedPaths.revisionsDirectory), false);
  assert.equal(fs.existsSync(path.join(root, 'builder-project-index.json')), false);
});

test('rejects a project directory replacement after bounded enumeration', async (t) => {
  const root = temporaryRoot(t);
  const alternateRoot = temporaryRoot(t);
  const repository = createBuilderProjectRevisionRepository(root);
  const alternateRepository = createBuilderProjectRevisionRepository(alternateRoot);
  await repository.commit({ revision: fixture(), expected_previous: null });
  await alternateRepository.commit({
    revision: fixture({ title: 'Replacement project' }),
    expected_previous: null,
  });
  const originalOpendirSync = fs.opendirSync;
  const originalDirectory = projectPaths(root).projectDirectory;
  const alternateDirectory = projectPaths(alternateRoot).projectDirectory;
  const displacedDirectory = path.join(root, 'displaced-project');
  let replaced = false;
  fs.opendirSync = (directoryPath) => {
    const directory = originalOpendirSync(directoryPath);
    return {
      readSync() {
        const entry = directory.readSync();
        if (entry === null && !replaced) {
          fs.renameSync(originalDirectory, displacedDirectory);
          fs.renameSync(alternateDirectory, originalDirectory);
          replaced = true;
        }
        return entry;
      },
      closeSync() {
        directory.closeSync();
      },
    };
  };
  try {
    await assert.rejects(
      repository.list_current(),
      assertRepositoryError('builder_project_repository_integrity_failed'),
    );
  } finally {
    fs.opendirSync = originalOpendirSync;
  }
  assert.equal(replaced, true);
});

test('fails the complete catalog on directory hash, head, or ancestor drift', async (t) => {
  const hashRoot = temporaryRoot(t);
  const hashRepository = createBuilderProjectRevisionRepository(hashRoot);
  const hashRevision = fixture();
  await hashRepository.commit({ revision: hashRevision, expected_previous: null });
  const mismatchedDirectory = projectPaths(hashRoot, OTHER_PROJECT_ID).projectDirectory;
  fs.renameSync(projectPaths(hashRoot).projectDirectory, mismatchedDirectory);
  await assert.rejects(
    hashRepository.list_current(),
    assertRepositoryError('builder_project_repository_integrity_failed'),
  );

  const headRoot = temporaryRoot(t);
  const headRepository = createBuilderProjectRevisionRepository(headRoot);
  await headRepository.commit({ revision: fixture(), expected_previous: null });
  fs.writeFileSync(projectPaths(headRoot).headPath, '{"record_kind":"wrong"}\n', 'utf8');
  await assert.rejects(
    headRepository.list_current(),
    assertRepositoryError('builder_project_repository_integrity_failed'),
  );

  const chainRoot = temporaryRoot(t);
  const chainRepository = createBuilderProjectRevisionRepository(chainRoot);
  const chainOne = fixture();
  const chainTwo = nextRevision(chainOne);
  await chainRepository.commit({ revision: chainOne, expected_previous: null });
  await chainRepository.commit({ revision: chainTwo, expected_previous: expectedPrevious(chainTwo) });
  const drift = structuredClone(chainOne);
  drift.summary = 'Drifted ancestor';
  fs.writeFileSync(revisionPath(chainRoot, chainOne), `${JSON.stringify(drift)}\n`, 'utf8');
  await assert.rejects(
    chainRepository.list_current(),
    assertRepositoryError('builder_project_repository_integrity_failed'),
  );
});

test('bounds catalog enumeration and rejects unexpected entries or request arguments', async (t) => {
  const unexpectedRoot = temporaryRoot(t);
  const unexpectedRepository = createBuilderProjectRevisionRepository(unexpectedRoot);
  fs.writeFileSync(path.join(unexpectedRoot, 'builder-project-revisions', 'unexpected'), 'value', 'utf8');
  await assert.rejects(
    unexpectedRepository.list_current(),
    assertRepositoryError('builder_project_repository_integrity_failed'),
  );

  const boundedRoot = temporaryRoot(t);
  const boundedRepository = createBuilderProjectRevisionRepository(boundedRoot);
  const projectsDirectory = path.join(boundedRoot, 'builder-project-revisions');
  for (let index = 0; index <= 256; index += 1) {
    const projectDirectory = path.join(projectsDirectory, index.toString(16).padStart(64, '0'));
    fs.mkdirSync(projectDirectory);
    fs.mkdirSync(path.join(projectDirectory, 'revisions'));
  }
  await assert.rejects(
    boundedRepository.list_current(),
    assertRepositoryError('builder_project_repository_resource_exceeded'),
  );

  const argumentRoot = temporaryRoot(t);
  const argumentRepository = createBuilderProjectRevisionRepository(argumentRoot);
  await assert.rejects(
    argumentRepository.list_current({}),
    assertRepositoryError('builder_project_repository_invalid'),
  );
  assert.deepEqual(fs.readdirSync(path.join(argumentRoot, 'builder-project-revisions')), []);
});

test('fails closed before aggregate catalog revision bytes exceed the global read budget', async (t) => {
  const root = temporaryRoot(t);
  const repository = createBuilderProjectRevisionRepository(root);
  const largeHtml = `<main>${'x'.repeat(250 * 1024)}</main>`;
  for (let index = 0; index < 132; index += 1) {
    const revision = fixture({
      project_id: numberedProjectId(index + 100),
      title: `Large project ${index}`,
      files: {
        'index.html': largeHtml,
        'styles.css': '.project { display: block; }',
        'app.js': '',
      },
    });
    await repository.commit({ revision, expected_previous: null });
  }

  await assert.rejects(
    repository.list_current(),
    assertRepositoryError('builder_project_repository_resource_exceeded'),
  );
});

test('keeps revision reads bounded when a file grows after its validated stat', async (t) => {
  const root = temporaryRoot(t);
  const repository = createBuilderProjectRevisionRepository(root);
  const record = fixture();
  await repository.commit({ revision: record, expected_previous: null });
  const recordPath = revisionPath(root, record);
  const recordBytes = fs.statSync(recordPath).size;
  const originalReadSync = fs.readSync;
  let boundedReadLength = null;
  let mutationApplied = false;
  fs.readSync = function boundedGrowthProbe(descriptor, buffer, offset, length, position) {
    if (!mutationApplied && length === recordBytes + 1) {
      mutationApplied = true;
      boundedReadLength = length;
      fs.appendFileSync(recordPath, Buffer.alloc(2 * 1024 * 1024, 0x61));
    }
    return originalReadSync.call(fs, descriptor, buffer, offset, length, position);
  };
  t.after(() => { fs.readSync = originalReadSync; });

  await assert.rejects(
    repository.list_current(),
    assertRepositoryError('builder_project_repository_integrity_failed'),
  );
  assert.equal(mutationApplied, true);
  assert.equal(boundedReadLength, recordBytes + 1);
});

test('does not advance head when a persisted candidate cannot prove its complete ancestor chain', async (t) => {
  const root = temporaryRoot(t);
  const repository = createBuilderProjectRevisionRepository(root);
  const revisionOne = fixture();
  const revisionTwo = nextRevision(revisionOne);
  const revisionThree = nextRevision(revisionTwo);
  await repository.commit({ revision: revisionOne, expected_previous: null });
  await repository.commit({ revision: revisionTwo, expected_previous: expectedPrevious(revisionTwo) });
  const headBefore = fs.readFileSync(projectPaths(root).headPath);
  const tamperedOne = structuredClone(revisionOne);
  tamperedOne.summary = 'Tampered ancestor';
  fs.writeFileSync(revisionPath(root, revisionOne), `${JSON.stringify(tamperedOne)}\n`, 'utf8');

  await assert.rejects(
    repository.commit({
      revision: revisionThree,
      expected_previous: expectedPrevious(revisionThree),
    }),
    assertRepositoryError('builder_project_repository_integrity_failed'),
  );
  assert.deepEqual(fs.readFileSync(projectPaths(root).headPath), headBefore);
  assert.equal(fs.existsSync(revisionPath(root, revisionThree)), true);
});

test('rejects repository directory replacement instead of following a junction outside its captured authority', async (t) => {
  const root = temporaryRoot(t);
  const repository = createBuilderProjectRevisionRepository(root);
  const revision = fixture();
  await repository.commit({ revision, expected_previous: null });
  const projectsDirectory = path.join(root, 'builder-project-revisions');
  const movedDirectory = path.join(root, 'builder-project-revisions-moved');
  fs.renameSync(projectsDirectory, movedDirectory);
  fs.symlinkSync(movedDirectory, projectsDirectory, process.platform === 'win32' ? 'junction' : 'dir');

  await assert.rejects(
    repository.load_current({ project_id: PROJECT_ID }),
    assertRepositoryError('builder_project_repository_integrity_failed'),
  );
});

test('fails closed on corrupt head, missing referenced revision, and canonical digest drift', async (t) => {
  const corruptHeadRoot = temporaryRoot(t);
  const corruptHeadRepository = createBuilderProjectRevisionRepository(corruptHeadRoot);
  const first = fixture();
  await corruptHeadRepository.commit({ revision: first, expected_previous: null });
  fs.writeFileSync(projectPaths(corruptHeadRoot).headPath, '{"record_kind":"wrong"}\n', 'utf8');
  await assert.rejects(
    corruptHeadRepository.load_current({ project_id: PROJECT_ID }),
    assertRepositoryError('builder_project_repository_integrity_failed'),
  );

  const missingRoot = temporaryRoot(t);
  const missingRepository = createBuilderProjectRevisionRepository(missingRoot);
  const second = fixture();
  await missingRepository.commit({ revision: second, expected_previous: null });
  fs.unlinkSync(revisionPath(missingRoot, second));
  await assert.rejects(
    missingRepository.load_current({ project_id: PROJECT_ID }),
    assertRepositoryError('builder_project_repository_integrity_failed'),
  );

  const driftRoot = temporaryRoot(t);
  const driftRepository = createBuilderProjectRevisionRepository(driftRoot);
  const third = fixture();
  await driftRepository.commit({ revision: third, expected_previous: null });
  const drift = structuredClone(third);
  drift.summary = 'Tampered after commit';
  fs.writeFileSync(revisionPath(driftRoot, third), `${JSON.stringify(drift)}\n`, 'utf8');
  await assert.rejects(
    driftRepository.load_current({ project_id: PROJECT_ID }),
    assertRepositoryError('builder_project_repository_integrity_failed'),
  );
});

test('fails safely on malformed requests, absent projects, and authority-forging surfaces', async (t) => {
  const root = temporaryRoot(t);
  const repository = createBuilderProjectRevisionRepository(root);
  const revision = fixture();

  await assert.rejects(
    repository.commit({ revision }),
    assertRepositoryError('builder_project_repository_invalid'),
  );
  await assert.rejects(
    repository.load_current({ project_id: PROJECT_ID, extra: true }),
    assertRepositoryError('builder_project_repository_invalid'),
  );
  await assert.rejects(
    repository.load_current({ project_id: PROJECT_ID }),
    assertRepositoryError('builder_project_repository_not_found'),
  );
  await assert.rejects(
    repository.commit(new Proxy({ revision, expected_previous: null }, {})),
    assertRepositoryError('builder_project_repository_invalid'),
  );
  const accessor = { revision };
  Object.defineProperty(accessor, 'expected_previous', {
    enumerable: true,
    get: () => { throw new Error('secret-marker'); },
  });
  await assert.rejects(
    repository.commit(accessor),
    assertRepositoryError('builder_project_repository_invalid'),
  );
});

test('repository source is isolated from generic draft, IPC, provider, UI, and runtime authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-project-revision-repository.cjs'),
    'utf8',
  );
  assert.doesNotMatch(source, /getDraft|saveDraft|clearDrafts|localStorage|sessionStorage|indexedDB/u);
  assert.doesNotMatch(source, /ipcMain|ipcRenderer|preload|electron|main\.cjs/u);
  assert.doesNotMatch(source, /provider|chat_planner|ChatCreatePage|Canvas|JobMeta|dispatch/iu);
  assert.doesNotMatch(source, /eval\s*\(|new Function|child_process|worker_threads/u);
  assert.doesNotMatch(source, /cross_process_cas:\s*'(?:proven|true)'/u);
  assert.doesNotMatch(source, /(?:mtime|birthtime|atime|index\.json|project[_-]?index)/iu);
  assert.match(source, /global_atomic_snapshot:\s*'not_proven'/u);
  assert.match(source, /recency:\s*'not_available'/u);
});
