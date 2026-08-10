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
  createBuilderProjectUnderstandingStore,
} = require('../electron/builder-project-understanding-store.cjs');
const {
  BUILDER_PROJECT_UNDERSTANDING_SERVICE_RESULT_VERSION,
  BUILDER_PROJECT_UNDERSTANDING_SERVICE_VERSION,
  BuilderProjectUnderstandingServiceError,
  createBuilderProjectUnderstandingService,
} = require('../electron/builder-project-understanding-service.cjs');

const PROJECT_ID = 'builder-project:11111111-1111-4111-8111-111111111111';
const OTHER_PROJECT_ID = 'builder-project:22222222-2222-4222-8222-222222222222';
const REVISION_DIGEST = `sha256:${'3'.repeat(64)}`;
const COMMIT_OID = 'a'.repeat(40);

function temporaryStore(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawfabric-builder-project-understanding-service-'));
  const store = createBuilderProjectUnderstandingStore(path.join(root, 'understanding.sqlite'));
  t.after(() => {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  return store;
}

function sourceTree(files = [
  {
    path: 'package.json',
    content: `${JSON.stringify({
      scripts: {
        build: 'vite build',
        lint: 'eslint .',
        test: 'vitest run',
      },
      devDependencies: {
        vite: 'latest',
        typescript: 'latest',
      },
    })}\n`,
  },
  { path: 'package-lock.json', content: '{}\n' },
  { path: 'index.html', content: '<div id="root"></div>\n' },
  { path: 'src/main.tsx', content: 'console.log("ready");\n' },
]) {
  return createBuilderProjectSourceTree({ files });
}

function savedReadResult(tree = sourceTree(), projectId = PROJECT_ID) {
  return {
    result_version: 'builder-project-read-result.v1',
    operation: 'current_loaded',
    product_revision_receipt: {
      receipt_version: 'builder-product-revision-receipt.v1',
      project_id: projectId,
      revision_receipt_digest: REVISION_DIGEST,
      commit_oid: COMMIT_OID,
      resulting_tree_digest: tree.source_tree_digest,
    },
    current: { revision_number: 1 },
    source_tree: tree,
    git_candidate_receipt: { redacted: true },
    git_verification_receipt: { redacted: true },
    authority_evidence: { read_authority: 'main' },
  };
}

function localWorkspaceReadResult(tree = sourceTree([{ path: 'index.html', content: '<main>Hello</main>\n' }])) {
  return {
    result_version: 'builder-project-local-workspace-read-result.v1',
    operation: 'local_workspace_loaded',
    project_id: PROJECT_ID,
    source_tree: tree,
    authority_evidence: {
      workspace_authority: 'sqlite_bound_project_workspace',
      source_read_authority: 'main_selected_workspace_filesystem_read',
      current_revision: 'not_saved_yet',
    },
  };
}

function serviceWith({
  t,
  readResult = savedReadResult(),
  nowMs = 1_000,
  store = temporaryStore(t),
  reads = [],
} = {}) {
  const service = createBuilderProjectUnderstandingService({
    project_read_authority: {
      async load_current(input) {
        reads.push(input);
        return readResult;
      },
    },
    project_understanding_store: store,
    now_ms: () => nowMs,
  });
  return { service, store, reads };
}

function assertServiceError(fn, expectedCode = 'builder_project_understanding_service_invalid') {
  return assert.rejects(fn, (error) => {
    assert.ok(error instanceof BuilderProjectUnderstandingServiceError);
    assert.equal(error.code, expectedCode);
    assert.doesNotMatch(
      JSON.stringify({
        name: error.name,
        code: error.code,
        message: error.message,
        stack: error.stack,
      }),
      /package\.json|source_tree|credential|provider|api[_-]?key|C:\\|Bearer/iu,
    );
    return true;
  });
}

test('refreshes and stores a project understanding snapshot from current saved source', async (t) => {
  const reads = [];
  const { service, reads: capturedReads } = serviceWith({ t, reads });

  assert.equal(service.service_version, BUILDER_PROJECT_UNDERSTANDING_SERVICE_VERSION);
  const result = await service.refresh_project_understanding({ project_id: PROJECT_ID });

  assert.equal(result.result_version, BUILDER_PROJECT_UNDERSTANDING_SERVICE_RESULT_VERSION);
  assert.equal(result.operation, 'project_understanding_refreshed');
  assert.equal(result.status, 'ready');
  assert.deepEqual(capturedReads, [{ project_id: PROJECT_ID }]);
  assert.equal(result.project_understanding.project_understanding_snapshot.project_id, PROJECT_ID);
  assert.deepEqual(result.project_understanding.project_understanding_snapshot.detected_stack, ['node', 'frontend']);
  assert.deepEqual(
    result.project_understanding.project_understanding_snapshot.command_profiles
      .map((profile) => [profile.command_kind, profile.command_display]),
    [
      ['lint', 'npm run lint'],
      ['test', 'npm test'],
      ['build', 'npm run build'],
    ],
  );
  assert.equal(
    result.latest_project_understanding_read.project_understanding.snapshot_digest,
    result.project_understanding.snapshot_digest,
  );
  assert.equal(result.evidence.service_authority, 'main_owned_project_understanding_service');
  assert.equal(result.evidence.source_read, 'saved_project_revision');
  assert.equal(result.evidence.command_execution, false);
  assert.equal(result.evidence.provider_dispatch, false);
  assert.equal(result.evidence.source_write, 'not_present');
  assert.equal(Object.isFrozen(result), true);
});

test('refreshes project understanding from an unsaved selected local workspace source tree', async (t) => {
  const { service } = serviceWith({
    t,
    readResult: localWorkspaceReadResult(),
    nowMs: 2_000,
  });

  const result = await service.refresh_project_understanding({ project_id: PROJECT_ID });

  assert.equal(result.operation, 'project_understanding_refreshed');
  assert.equal(result.evidence.source_read, 'selected_local_workspace');
  assert.deepEqual(result.project_understanding.project_understanding_snapshot.detected_stack, ['static_html']);
  assert.equal(result.project_understanding.project_understanding_snapshot.package_manager, 'none');
  assert.deepEqual(result.project_understanding.project_understanding_snapshot.command_profiles, []);
});

test('replays the same understanding snapshot idempotently', async (t) => {
  const { service } = serviceWith({ t });

  const first = await service.refresh_project_understanding({ project_id: PROJECT_ID });
  const second = await service.refresh_project_understanding({ project_id: PROJECT_ID });

  assert.equal(first.operation, 'project_understanding_refreshed');
  assert.equal(second.operation, 'project_understanding_refresh_replayed');
  assert.deepEqual(second.project_understanding, first.project_understanding);
});

test('fails closed for malformed requests, drifted reads, and unavailable stores', async (t) => {
  const { service } = serviceWith({ t });
  await assertServiceError(() => service.refresh_project_understanding({ project_id: OTHER_PROJECT_ID }));

  const driftedTree = sourceTree();
  const drifted = savedReadResult(driftedTree);
  drifted.product_revision_receipt.resulting_tree_digest = `sha256:${'4'.repeat(64)}`;
  const { service: driftedService } = serviceWith({ t, readResult: drifted });
  await assertServiceError(() => driftedService.refresh_project_understanding({ project_id: PROJECT_ID }));

  const unavailable = createBuilderProjectUnderstandingService({
    project_read_authority: {
      load_current() {
        throw new Error('disk path should not leak');
      },
    },
    project_understanding_store: temporaryStore(t),
    now_ms: () => 1,
  });
  await assertServiceError(
    () => unavailable.refresh_project_understanding({ project_id: PROJECT_ID }),
    'builder_project_understanding_service_unavailable',
  );
});

test('source stays main-side and cannot dispatch providers, commands, IPC, or source writes', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-project-understanding-service.cjs'),
    'utf8',
  );

  assert.match(source, /main_owned_project_understanding_service/u);
  assert.match(source, /main_project_read_authority_load_current/u);
  assert.match(source, /command_execution:\s*false/u);
  assert.match(source, /provider_dispatch:\s*false/u);
  assert.match(source, /source_write:\s*'not_present'/u);
  assert.doesNotMatch(
    source,
    /ipcMain|ipcRenderer|contextBridge|BrowserWindow|safeStorage|builder-provider|builder-git|credential|secret_ref|Authorization|Bearer|child_process|spawn|execFile|exec\(|fetch\s*\(|require\(['"](?:node:fs|fs|node:http|node:https|http|https)['"]\)|writeFile|appendFile|rmSync|mkdir|shell:\s*true|localStorage|sessionStorage|indexedDB|eval\s*\(|new Function/iu,
  );
});
