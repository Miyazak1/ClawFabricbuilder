'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  createBuilderSessionAddress,
  createBuilderTaskAddress,
} = require('../electron/builder-session-task-address.cjs');
const {
  BUILDER_WORK_CAPSULE_MANIFEST_SERVICE_VERSION,
  BuilderWorkCapsuleManifestServiceError,
  createBuilderWorkCapsuleManifestService,
} = require('../electron/builder-work-capsule-manifest-service.cjs');

const PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174300';
const OTHER_PROJECT_ID = 'builder-project:223e4567-e89b-42d3-a456-426614174300';
const SESSION_ID = 'builder-session:123e4567-e89b-42d3-a456-426614174301';
const TASK_ADDRESS_ID = 'builder-task-address:123e4567-e89b-42d3-a456-426614174302';
const CONVERSATION_ID = 'builder-conversation:123e4567-e89b-42d3-a456-426614174303';
const TASK_ID = 'builder-task:123e4567-e89b-42d3-a456-426614174304';
const RUN_ID = 'builder-run:123e4567-e89b-42d3-a456-426614174305';
const TURN_ID = 'builder-turn:123e4567-e89b-42d3-a456-426614174306';
const REQUEST_ID = 'builder-git-request:123e4567-e89b-42d3-a456-426614174307';
const REVIEW_ID = 'builder-review:123e4567-e89b-42d3-a456-426614174308';
const AGENT_ID = 'builder-agent:123e4567-e89b-42d3-a456-426614174309';
const CANDIDATE_ID = `builder-code-change-candidate:${'1'.repeat(64)}`;

function digest(char) {
  return `sha256:${char.repeat(64)}`;
}

function sessionAddress(overrides = {}) {
  return createBuilderSessionAddress({
    session_id: SESSION_ID,
    project_id: PROJECT_ID,
    display_id: 'S-CAPSVC1',
    title: 'Portfolio capsule line',
    status: 'active',
    root_conversation_id: CONVERSATION_ID,
    current_task_id: TASK_ADDRESS_ID,
    parent_session_id: null,
    forked_from_session_id: null,
    forked_from_revision_receipt_digest: null,
    created_by: 'local-user',
    created_at_ms: 1000,
    updated_at_ms: 1500,
    archived_at_ms: null,
    ...overrides,
  });
}

function taskAddress(overrides = {}) {
  return createBuilderTaskAddress({
    task_address_id: TASK_ADDRESS_ID,
    session_id: SESSION_ID,
    project_id: PROJECT_ID,
    agent_id: AGENT_ID,
    parent_task_address_id: null,
    conversation_id: CONVERSATION_ID,
    title: 'Finish portfolio landing page',
    goal: 'Create a reviewed portfolio landing page capsule.',
    status: 'completed',
    current_brief_id: digest('2'),
    current_plan_id: digest('3'),
    base_revision_receipt_digest: null,
    produced_revision_receipt_digest: digest('a'),
    created_by: 'local-user',
    created_at_ms: 1000,
    updated_at_ms: 1700,
    closed_at_ms: 1700,
    ...overrides,
  });
}

function projectRevision(overrides = {}) {
  return {
    project_id: PROJECT_ID,
    revision_receipt_digest: digest('a'),
    revision_number: 1,
    previous_revision_receipt_digest: null,
    title: 'Portfolio landing page',
    summary: 'A saved and reviewed portfolio landing page.',
    conversation_id: CONVERSATION_ID,
    turn_id: TURN_ID,
    request_id: REQUEST_ID,
    object_format: 'sha1',
    commit_oid: 'a'.repeat(40),
    tree_oid: 'b'.repeat(40),
    parent_oid: null,
    candidate_id: CANDIDATE_ID,
    candidate_digest: digest('b'),
    resulting_tree_digest: digest('c'),
    semantic_identity_digest: digest('d'),
    verification_receipt_digest: digest('e'),
    task_id: TASK_ID,
    run_id: RUN_ID,
    review_id: REVIEW_ID,
    selected_at_ms: 1600,
    ...overrides,
  };
}

function artifactRefs(overrides = {}) {
  return [{
    artifact_id: `builder-artifact:${'f'.repeat(64)}`,
    artifact_kind: 'static_preview',
    title: 'Preview',
    summary: 'Static preview of the saved landing page.',
    preview_digest: digest('f'),
    ...overrides,
  }];
}

function request(overrides = {}) {
  return {
    project_id: PROJECT_ID,
    revision_receipt_digest: digest('a'),
    session_id: SESSION_ID,
    task_address_id: TASK_ADDRESS_ID,
    artifact_refs: artifactRefs(),
    public_summary: {
      title: 'Portfolio landing page',
      description: 'A reviewed local portfolio landing page ready to continue.',
      what_changed: 'Created the landing layout, visual sections, and previewable artifact.',
      how_to_continue: 'Open the capsule, inspect the preview, then remix or continue from the saved revision.',
    },
    remix_metadata: {
      source_capsule_id: null,
      parent_revision_receipt_digest: null,
      compatibility_notes: 'Local Builder project revision.',
      license_intent: null,
    },
    created_at_ms: 1800,
    ...overrides,
  };
}

function metadataResult(receipt = projectRevision()) {
  return {
    result_version: 'builder-product-metadata-result.v4',
    operation: 'revision_loaded',
    receipt,
    current: {
      project_id: receipt.project_id,
      title: receipt.title,
      summary: receipt.summary,
      revision_receipt_digest: receipt.revision_receipt_digest,
      revision_number: receipt.revision_number,
      object_format: 'sha1',
      commit_oid: 'a'.repeat(40),
      tree_oid: 'b'.repeat(40),
      parent_oid: null,
    },
    metadata_evidence: {
      source_bytes_stored: false,
      credential_storage: 'not_present',
    },
  };
}

function sessionReadResult(value = sessionAddress()) {
  return {
    result_version: 'builder-session-task-address-store-read-result.v1',
    status: 'ready',
    session_address: { session_address: value },
    address_evidence: {},
  };
}

function taskReadResult(value = taskAddress()) {
  return {
    result_version: 'builder-session-task-address-store-read-result.v1',
    status: 'ready',
    task_address: { task_address: value },
    address_evidence: {},
  };
}

function services(overrides = {}) {
  const calls = [];
  return {
    calls,
    metadata_authority: {
      load_project_revision(input) {
        calls.push(['load_project_revision', input]);
        return overrides.loadedRevision ?? metadataResult();
      },
    },
    session_task_address_store: {
      read_session_address(input) {
        calls.push(['read_session_address', input]);
        return overrides.sessionRead ?? sessionReadResult();
      },
      read_task_address(input) {
        calls.push(['read_task_address', input]);
        return overrides.taskRead ?? taskReadResult();
      },
    },
  };
}

function assertServiceError(fn) {
  assert.throws(
    fn,
    (error) => {
      assert.ok(error instanceof BuilderWorkCapsuleManifestServiceError);
      assert.equal(error.code, 'builder_work_capsule_manifest_service_invalid');
      const text = JSON.stringify({
        name: error.name,
        code: error.code,
        message: error.message,
        stack: error.stack,
      });
      assert.doesNotMatch(
        text,
        /secret-value|credential|provider|source_tree|file_content|commit_oid|tree_oid|raw_prompt|publish|network/iu,
      );
      return true;
    },
  );
}

test('creates a local Work Capsule manifest from main-owned revision and address reads', () => {
  const item = services();
  const service = createBuilderWorkCapsuleManifestService({
    metadata_authority: item.metadata_authority,
    session_task_address_store: item.session_task_address_store,
  });

  const result = service.create_local_manifest(request());

  assert.equal(service.service_version, BUILDER_WORK_CAPSULE_MANIFEST_SERVICE_VERSION);
  assert.equal(result.result_version, 'builder-work-capsule-manifest-service-result.v1');
  assert.equal(result.operation, 'local_work_capsule_manifest_created');
  assert.equal(result.status, 'ready');
  assert.equal(result.project_id, PROJECT_ID);
  assert.equal(result.session_id, SESSION_ID);
  assert.equal(result.task_address_id, TASK_ADDRESS_ID);
  assert.equal(result.revision_receipt_digest, digest('a'));
  assert.equal(result.manifest.review_decision_ref.review_id, REVIEW_ID);
  assert.equal(result.manifest.review_decision_ref.reviewed_at_ms, 1600);
  assert.equal(result.manifest.verification_summary.verification_receipt_digest, digest('e'));
  assert.equal(result.authority.metadata_read, 'project_revision_loaded');
  assert.equal(result.authority.session_address_read, 'session_address_ready_read');
  assert.equal(result.authority.task_address_read, 'task_address_ready_read');
  assert.equal(result.authority.sqlite_write, false);
  assert.equal(result.authority.git_write, false);
  assert.equal(result.authority.export_materialization, false);
  assert.equal(result.authority.publication, false);
  assert.equal(result.authority.autonomous_experiment, false);
  assert.deepEqual(item.calls, [
    ['load_project_revision', { project_id: PROJECT_ID, revision_receipt_digest: digest('a') }],
    ['read_session_address', { project_id: PROJECT_ID, session_id: SESSION_ID }],
    ['read_task_address', { project_id: PROJECT_ID, task_address_id: TASK_ADDRESS_ID }],
  ]);
  assert.equal(Object.isFrozen(result.manifest), true);
  assert.doesNotMatch(
    JSON.stringify(result),
    /commit_oid|tree_oid|source_tree|file_content|raw_prompt|provider_secret|credential|network_upload|public_url/iu,
  );
});

test('fails closed when revision or address facts do not bind to the requested capsule', () => {
  assertServiceError(() => createBuilderWorkCapsuleManifestService({
    metadata_authority: services({
      loadedRevision: metadataResult(projectRevision({ project_id: OTHER_PROJECT_ID })),
    }).metadata_authority,
    session_task_address_store: services().session_task_address_store,
  }).create_local_manifest(request()));

  assertServiceError(() => createBuilderWorkCapsuleManifestService({
    metadata_authority: services().metadata_authority,
    session_task_address_store: services({
      sessionRead: {
        result_version: 'builder-session-task-address-store-read-result.v1',
        status: 'absent',
        session_address: null,
        address_evidence: {},
      },
    }).session_task_address_store,
  }).create_local_manifest(request()));

  assertServiceError(() => createBuilderWorkCapsuleManifestService({
    metadata_authority: services().metadata_authority,
    session_task_address_store: services({
      taskRead: taskReadResult(taskAddress({
        produced_revision_receipt_digest: digest('9'),
      })),
    }).session_task_address_store,
  }).create_local_manifest(request()));
});

test('rejects malformed service requests without leaking hostile values', () => {
  const item = services();
  const service = createBuilderWorkCapsuleManifestService({
    metadata_authority: item.metadata_authority,
    session_task_address_store: item.session_task_address_store,
  });

  assertServiceError(() => service.create_local_manifest({
    ...request(),
    public_url: 'secret-value',
  }));

  const accessor = request();
  Object.defineProperty(accessor, 'project_id', {
    enumerable: true,
    get: () => { throw new Error('secret-value'); },
  });
  assertServiceError(() => service.create_local_manifest(accessor));

  let traps = 0;
  assertServiceError(() => service.create_local_manifest(new Proxy(request(), {
    ownKeys() {
      traps += 1;
      return [];
    },
  })));
  assert.equal(traps, 0);
});

test('source boundary stays a read-only main service with no runtime or publish authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-work-capsule-manifest-service.cjs'),
    'utf8',
  );

  assert.match(source, /main_owned_work_capsule_manifest_service/u);
  assert.match(source, /create_local_manifest/u);
  assert.match(source, /load_project_revision/u);
  assert.match(source, /read_session_address/u);
  assert.match(source, /read_task_address/u);
  assert.doesNotMatch(
    source,
    /require\(['"](?:electron|node:sqlite|node:http|node:https|http|https|node:fs|fs|node:child_process|child_process)['"]\)|ipcMain|ipcRenderer|contextBridge|BrowserWindow|safeStorage|builder-provider|dugite|fetch\s*\(|https?:|Authorization|Bearer|execFile|spawn\s*\(|writeFile|appendFile|mkdir|rm\(|unlink|rmdir|shell:\s*true|localStorage|sessionStorage|indexedDB|eval\s*\(|new Function|provider_secret|credential_secret|source_tree|file_content|stdout|stderr|publish|upload|public_url/iu,
  );
});
