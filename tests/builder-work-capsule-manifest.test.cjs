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
  BUILDER_WORK_CAPSULE_MANIFEST_VERSION,
  BuilderWorkCapsuleManifestError,
  createBuilderWorkCapsuleManifest,
} = require('../electron/builder-work-capsule-manifest.cjs');

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
    display_id: 'S-CAPS01',
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

function capsuleInput(overrides = {}) {
  return {
    project_revision: projectRevision(overrides.project_revision ?? {}),
    artifact_refs: overrides.artifact_refs ?? artifactRefs(),
    review_decision: {
      review_id: REVIEW_ID,
      decision: 'accepted',
      reviewed_at_ms: 1650,
      decision_summary: 'Owner accepted this saved result.',
      ...(overrides.review_decision ?? {}),
    },
    verification_summary: {
      verification_receipt_digest: digest('e'),
      status: 'verified',
      summary: 'Static preview and saved revision checks passed.',
      ...(overrides.verification_summary ?? {}),
    },
    public_summary: {
      title: 'Portfolio landing page',
      description: 'A reviewed local portfolio landing page ready to continue.',
      what_changed: 'Created the landing layout, visual sections, and previewable artifact.',
      how_to_continue: 'Open the capsule, inspect the preview, then remix or continue from the saved revision.',
      ...(overrides.public_summary ?? {}),
    },
    remix_metadata: {
      source_capsule_id: null,
      parent_revision_receipt_digest: null,
      compatibility_notes: 'Local Builder project revision.',
      license_intent: null,
      ...(overrides.remix_metadata ?? {}),
    },
    session_address: overrides.session_address ?? sessionAddress(),
    task_address: overrides.task_address ?? taskAddress(),
    created_at_ms: overrides.created_at_ms ?? 1800,
  };
}

function assertManifestError(fn) {
  assert.throws(
    fn,
    (error) => {
      assert.ok(error instanceof BuilderWorkCapsuleManifestError);
      assert.equal(error.code, 'builder_work_capsule_manifest_invalid');
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

test('creates a deterministic local Work Capsule manifest from reviewed saved work', () => {
  const first = createBuilderWorkCapsuleManifest(capsuleInput());
  const second = createBuilderWorkCapsuleManifest(structuredClone(capsuleInput()));

  assert.deepEqual(second, first);
  assert.equal(first.manifest_version, BUILDER_WORK_CAPSULE_MANIFEST_VERSION);
  assert.match(first.capsule_id, /^builder-work-capsule:[0-9a-f]{64}$/u);
  assert.equal(first.capsule_kind, 'local_work_capsule_manifest');
  assert.equal(first.project_id, PROJECT_ID);
  assert.equal(first.session_id, SESSION_ID);
  assert.equal(first.task_address_id, TASK_ADDRESS_ID);
  assert.equal(first.revision_receipt_digest, digest('a'));
  assert.equal(first.review_decision_ref.decision, 'accepted');
  assert.equal(first.verification_summary.status, 'verified');
  assert.equal(first.lifecycle.export_materialization, 'not_performed');
  assert.equal(first.lifecycle.renderer_authority, 'not_present');
  assert.equal(first.lifecycle.provider_dispatch, 'not_performed');
  assert.equal(first.lifecycle.git_write, 'not_performed');
  assert.equal(first.lifecycle.source_mutation, 'not_performed');
  assert.equal(first.lifecycle.network_access, 'not_present');
  assert.equal(first.lifecycle.publication, 'not_performed');
  assert.equal(first.lifecycle.autonomous_experiment, 'not_performed');
  assert.equal(Object.isFrozen(first), true);
  assert.doesNotMatch(
    JSON.stringify(first),
    /commit_oid|tree_oid|source_tree|file_content|raw_prompt|provider_secret|credential|network_upload|public_url/iu,
  );
});

test('fails closed for rejected, stale, cross-project, and unreviewed work', () => {
  assertManifestError(() => createBuilderWorkCapsuleManifest(capsuleInput({
    review_decision: { decision: 'rejected' },
  })));
  assertManifestError(() => createBuilderWorkCapsuleManifest(capsuleInput({
    project_revision: { verification_receipt_digest: digest('9') },
  })));
  assertManifestError(() => createBuilderWorkCapsuleManifest(capsuleInput({
    project_revision: { project_id: OTHER_PROJECT_ID },
  })));
  assertManifestError(() => createBuilderWorkCapsuleManifest(capsuleInput({
    task_address: taskAddress({
      status: 'review_needed',
      produced_revision_receipt_digest: digest('a'),
      closed_at_ms: null,
    }),
  })));
  assertManifestError(() => createBuilderWorkCapsuleManifest(capsuleInput({
    task_address: taskAddress({ produced_revision_receipt_digest: digest('9') }),
  })));
  assertManifestError(() => createBuilderWorkCapsuleManifest(capsuleInput({
    created_at_ms: 1500,
  })));
});

test('rejects extras, accessors, sparse arrays, duplicate artifacts, and publication fields', () => {
  assertManifestError(() => createBuilderWorkCapsuleManifest({
    ...capsuleInput(),
    public_url: 'secret-value',
  }));

  const accessor = capsuleInput();
  Object.defineProperty(accessor.public_summary, 'title', {
    enumerable: true,
    get: () => { throw new Error('secret-value'); },
  });
  assertManifestError(() => createBuilderWorkCapsuleManifest(accessor));

  let traps = 0;
  assertManifestError(() => createBuilderWorkCapsuleManifest(new Proxy(capsuleInput(), {
    ownKeys() {
      traps += 1;
      return [];
    },
  })));
  assert.equal(traps, 0);

  const sparseArtifacts = artifactRefs();
  sparseArtifacts.length = 2;
  assertManifestError(() => createBuilderWorkCapsuleManifest(capsuleInput({
    artifact_refs: sparseArtifacts,
  })));

  const duplicateArtifact = artifactRefs();
  duplicateArtifact.push(structuredClone(duplicateArtifact[0]));
  assertManifestError(() => createBuilderWorkCapsuleManifest(capsuleInput({
    artifact_refs: duplicateArtifact,
  })));
});

test('source boundary stays pure main-side manifest assembly with no runtime authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-work-capsule-manifest.cjs'),
    'utf8',
  );

  assert.doesNotMatch(
    source,
    /require\(['"]electron['"]\)|ipcMain|ipcRenderer|contextBridge|BrowserWindow|safeStorage|fetch\s*\(|https?:|Authorization|Bearer|provider_secret|credential_value|secret_ref|child_process|execFile|spawn\s*\(|writeFile|appendFile|mkdir|rm\(|unlink|rmdir|record_project_revision|record_grant|publish|upload|localStorage|sessionStorage|indexedDB|eval\s*\(|new Function/iu,
  );
  assert.match(source, /local_work_capsule_manifest/u);
  assert.match(source, /publication: 'not_performed'/u);
  assert.match(source, /autonomous_experiment: 'not_performed'/u);
});
