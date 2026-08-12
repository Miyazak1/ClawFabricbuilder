'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  createBuilderProjectSourceTree,
} = require('../electron/builder-project-source-tree.cjs');
const {
  BUILDER_LIVE_PREVIEW_SOURCE_RESOLVER_VERSION,
  BUILDER_LIVE_PREVIEW_SOURCE_RESOLVER_RESULT_VERSION,
  BUILDER_LIVE_PREVIEW_SOURCE_SNAPSHOT_VERSION,
} = require('../electron/builder-live-preview-source-resolver.cjs');
const {
  createBuilderLivePreviewSourceAdmission,
} = require('../electron/builder-live-preview-source-admission.cjs');
const {
  BUILDER_LIVE_PREVIEW_DEV_SERVER_ADMISSION_VERSION,
  BUILDER_LIVE_PREVIEW_DEV_SERVER_COMMAND_PROFILE_VERSION,
  BuilderLivePreviewDevServerAdmissionError,
  createBuilderLivePreviewDevServerAdmission,
  createBuilderLivePreviewDevServerApproval,
  createBuilderLivePreviewDevServerCommandProfile,
  sanitizeBuilderLivePreviewDevServerAdmission,
} = require('../electron/builder-live-preview-dev-server-admission.cjs');

const PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174000';
const CONVERSATION_ID = 'builder-conversation:123e4567-e89b-42d3-a456-426614174001';
const CHECKPOINT_ID = `builder-draft-checkpoint:${'1'.repeat(64)}`;
const CANDIDATE_ID = `builder-code-change-candidate:${'3'.repeat(64)}`;
const CANDIDATE_DIGEST = `sha256:${'4'.repeat(64)}`;
const COMMIT_OID = '5'.repeat(40);
const TREE_OID = '6'.repeat(40);

function digest(char) {
  return `sha256:${char.repeat(64)}`;
}

function tree() {
  return createBuilderProjectSourceTree({
    files: [
      {
        path: 'package.json',
        content: `${JSON.stringify({
          scripts: { dev: 'vite --host 127.0.0.1' },
          dependencies: { vite: 'latest' },
        })}\n`,
      },
      { path: 'index.html', content: '<main id="root">Dev server preview</main>\n' },
      { path: 'src/main.js', content: 'document.body.dataset.ready = "true";\n' },
    ],
  });
}

function sourceResolverAuthority() {
  return {
    source_resolver_authority: 'main_owned_live_preview_source_resolver_v1',
    renderer_source_tree: 'not_accepted',
    renderer_path_or_url: 'not_accepted',
    git_read: 'existing_authority_verified_candidate_only',
    sqlite_read: 'existing_revision_or_checkpoint_authority_only',
    source_write: 'not_performed',
    git_write: 'not_performed',
    sqlite_write: 'not_performed',
    provider_dispatch: false,
    tool_dispatch: false,
    command_execution: false,
    electron_view_attachment: false,
    ipc_registration: false,
    revision_admission: false,
    save_admission: false,
    permission_grant: false,
  };
}

function sourceAdmission(overrides = {}) {
  const sourceTree = overrides.source_tree ?? tree();
  return createBuilderLivePreviewSourceAdmission({
    source_resolver_result: {
      result_version: BUILDER_LIVE_PREVIEW_SOURCE_RESOLVER_RESULT_VERSION,
      resolver_version: BUILDER_LIVE_PREVIEW_SOURCE_RESOLVER_VERSION,
      operation: 'current_draft_preview_source_resolved',
      source_kind: 'current_draft',
      status: 'ready',
      unavailable_reason: null,
      preview_source_snapshot: {
        snapshot_version: BUILDER_LIVE_PREVIEW_SOURCE_SNAPSHOT_VERSION,
        source_kind: 'current_draft',
        project_id: PROJECT_ID,
        conversation_id: CONVERSATION_ID,
        source_tree: sourceTree,
        source_tree_digest: sourceTree.source_tree_digest,
        source_ref: {
          source_ref_kind: 'current_draft_checkpoint_candidate',
          project_id: PROJECT_ID,
          conversation_id: CONVERSATION_ID,
          checkpoint_id: CHECKPOINT_ID,
          checkpoint_sequence: 2,
          candidate_id: CANDIDATE_ID,
          candidate_digest: CANDIDATE_DIGEST,
          resulting_tree_digest: sourceTree.source_tree_digest,
          commit_oid: COMMIT_OID,
          tree_oid: TREE_OID,
        },
        admission: {
          preview_source_admission: 'main_owned_verified_preview_source',
          source_tree_digest: sourceTree.source_tree_digest,
        },
        authority: sourceResolverAuthority(),
      },
    },
    selected_entry_path: 'index.html',
    preview_kind: 'live_static_web',
    admitted_at_ms: 1_000,
    expires_at_ms: 61_000,
    ...overrides.source_admission,
  });
}

function commandProfile(admission = sourceAdmission(), overrides = {}) {
  return createBuilderLivePreviewDevServerCommandProfile({
    project_id: admission.project_id,
    source_tree_digest: admission.source_tree_digest,
    package_manager: 'npm',
    script_name: 'dev',
    script_digest: digest('8'),
    discovered_at_ms: 1_200,
    ...overrides,
  });
}

function approval(admission = sourceAdmission(), profile = commandProfile(admission), overrides = {}) {
  return createBuilderLivePreviewDevServerApproval({
    source_admission: admission,
    command_profile: profile,
    approved_at_ms: 2_000,
    expires_at_ms: 302_000,
    ...overrides,
  });
}

function admissionInput(overrides = {}) {
  const source = overrides.source_admission ?? sourceAdmission();
  const profile = overrides.command_profile ?? commandProfile(source);
  const approved = overrides.approval ?? approval(source, profile);
  return {
    source_admission: source,
    command_profile: profile,
    approval: approved,
    admitted_at_ms: 2_100,
    expires_at_ms: 242_000,
    ...Object.fromEntries(
      Object.entries(overrides).filter(([key]) => ![
        'source_admission',
        'command_profile',
        'approval',
      ].includes(key)),
    ),
  };
}

function expectInvalid(fn, forbidden = []) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof BuilderLivePreviewDevServerAdmissionError);
    assert.equal(error.code, 'builder_live_preview_dev_server_admission_invalid');
    const serialized = JSON.stringify({
      name: error.name,
      code: error.code,
      message: error.message,
      stack: error.stack,
    });
    for (const marker of forbidden) assert.doesNotMatch(serialized, new RegExp(marker, 'iu'));
    assert.doesNotMatch(
      serialized,
      /vite --host|source_tree|file_content|secret|credential|Authorization|Bearer|C:\\Users/iu,
    );
    return true;
  });
}

test('admits an approved dev-server preview without starting a process', () => {
  const admitted = createBuilderLivePreviewDevServerAdmission(admissionInput());

  assert.equal(admitted.admission_version, BUILDER_LIVE_PREVIEW_DEV_SERVER_ADMISSION_VERSION);
  assert.match(admitted.admission_id, /^builder-live-preview-dev-server-admission:[0-9a-f]{64}$/u);
  assert.equal(admitted.project_id, PROJECT_ID);
  assert.equal(admitted.conversation_id, CONVERSATION_ID);
  assert.equal(admitted.preview_kind, 'live_dev_server_web');
  assert.equal(admitted.command_profile_ref.command_display, 'npm run dev');
  assert.equal(admitted.command_profile_ref.cwd, '.');
  assert.equal(admitted.port_policy.bind_host, '127.0.0.1');
  assert.equal(admitted.port_policy.port_authority, 'runtime_selected_not_renderer_supplied');
  assert.equal(admitted.process_policy.dependency_install, 'not_allowed');
  assert.equal(admitted.process_policy.log_projection, 'redacted_summary_only');
  assert.equal(admitted.network_policy.preview_navigation, 'owned_loopback_origin_only');
  assert.equal(admitted.network_policy.external_requests, 'blocked_by_default');
  assert.equal(admitted.lifecycle.command_execution, 'not_started');
  assert.equal(admitted.lifecycle.process_runtime, 'not_started');
  assert.equal(admitted.lifecycle.webcontents_view, 'not_attached');
  assert.equal(admitted.authority.renderer_command, 'not_accepted');
  assert.equal(admitted.authority.renderer_port, 'not_accepted');
  assert.equal(admitted.authority.process_spawn, 'not_started');
  assert.equal(admitted.authority.package_install, 'not_allowed');
  assert.deepEqual(sanitizeBuilderLivePreviewDevServerAdmission(structuredClone(admitted)), admitted);
  assert.equal(Object.isFrozen(admitted.port_policy), true);
});

test('creates dev-server command profiles from bounded package script facts', () => {
  const source = sourceAdmission();
  const pnpm = commandProfile(source, { package_manager: 'pnpm' });
  const yarn = commandProfile(source, { package_manager: 'yarn' });
  const bun = commandProfile(source, { package_manager: 'bun' });

  assert.equal(pnpm.command_profile_version, BUILDER_LIVE_PREVIEW_DEV_SERVER_COMMAND_PROFILE_VERSION);
  assert.equal(pnpm.command_display, 'pnpm run dev');
  assert.equal(yarn.command_display, 'yarn dev');
  assert.equal(bun.command_display, 'bun run dev');
  assert.match(pnpm.command_profile_id, /^builder-live-preview-dev-server-command-profile:[0-9a-f]{32}$/u);
  assert.equal(pnpm.requires_user_approval, true);
  assert.equal(pnpm.authority.command_execution, 'not_performed');
  assert.equal(pnpm.authority.renderer_command, 'not_accepted');
  assert.doesNotMatch(JSON.stringify(pnpm), /vite --host|localhost:5173|raw_source_tree|file_content/iu);
});

test('rejects renderer supplied command, URL, port, source, and hostile fields', () => {
  expectInvalid(() => createBuilderLivePreviewDevServerAdmission({
    ...admissionInput(),
    command: 'npm run dev',
  }));
  expectInvalid(() => createBuilderLivePreviewDevServerAdmission({
    ...admissionInput(),
    port: 5173,
  }));
  expectInvalid(() => createBuilderLivePreviewDevServerAdmission({
    ...admissionInput(),
    url: 'http://127.0.0.1:5173',
  }));
  expectInvalid(() => createBuilderLivePreviewDevServerAdmission({
    ...admissionInput(),
    source_tree: tree(),
  }));
  expectInvalid(() => createBuilderLivePreviewDevServerCommandProfile({
    project_id: PROJECT_ID,
    source_tree_digest: sourceAdmission().source_tree_digest,
    package_manager: 'npm',
    script_name: 'start',
    script_digest: digest('8'),
    discovered_at_ms: 1_200,
  }));
  expectInvalid(() => createBuilderLivePreviewDevServerCommandProfile({
    project_id: PROJECT_ID,
    source_tree_digest: sourceAdmission().source_tree_digest,
    package_manager: 'npm',
    script_name: 'dev',
    script_digest: 'vite --host 0.0.0.0',
    discovered_at_ms: 1_200,
  }), ['vite --host']);
});

test('rejects source, command, approval, and timing drift', () => {
  const source = sourceAdmission();
  const profile = commandProfile(source);
  const approved = approval(source, profile);

  expectInvalid(() => createBuilderLivePreviewDevServerAdmission(admissionInput({
    command_profile: {
      ...profile,
      source_tree_digest: digest('9'),
    },
  })));
  expectInvalid(() => createBuilderLivePreviewDevServerAdmission(admissionInput({
    approval: {
      ...approved,
      revoked: true,
    },
  })));
  expectInvalid(() => createBuilderLivePreviewDevServerAdmission(admissionInput({
    approval: {
      ...approved,
      command_profile_id: `builder-live-preview-dev-server-command-profile:${'0'.repeat(32)}`,
    },
  })));
  expectInvalid(() => createBuilderLivePreviewDevServerAdmission(admissionInput({
    admitted_at_ms: 302_000,
  })));
  expectInvalid(() => createBuilderLivePreviewDevServerAdmission(admissionInput({
    expires_at_ms: 302_001,
  })));
});

test('rejects forged recorded admissions', () => {
  const admitted = createBuilderLivePreviewDevServerAdmission(admissionInput());

  expectInvalid(() => sanitizeBuilderLivePreviewDevServerAdmission({
    ...admitted,
    port_policy: {
      ...admitted.port_policy,
      bind_host: '0.0.0.0',
    },
  }));
  expectInvalid(() => sanitizeBuilderLivePreviewDevServerAdmission({
    ...admitted,
    process_policy: {
      ...admitted.process_policy,
      dependency_install: 'allowed',
    },
  }));
  expectInvalid(() => sanitizeBuilderLivePreviewDevServerAdmission({
    ...admitted,
    authority: {
      ...admitted.authority,
      process_spawn: 'started',
    },
  }));
  expectInvalid(() => sanitizeBuilderLivePreviewDevServerAdmission({
    ...admitted,
    admission_id: `builder-live-preview-dev-server-admission:${'f'.repeat(64)}`,
  }));
});

test('rejects proxies and accessors without leaking hostile values', () => {
  expectInvalid(() => createBuilderLivePreviewDevServerAdmission(new Proxy(admissionInput(), {})));
  const accessor = {};
  Object.defineProperty(accessor, 'source_admission', {
    enumerable: true,
    get() {
      throw new Error('secret-value');
    },
  });
  for (const key of ['command_profile', 'approval', 'admitted_at_ms', 'expires_at_ms']) {
    Object.defineProperty(accessor, key, { enumerable: true, value: admissionInput()[key] });
  }
  expectInvalid(() => createBuilderLivePreviewDevServerAdmission(accessor), ['secret-value']);
});

test('contract remains preview-only without Electron, IPC, spawn, install, provider, or mutation authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-live-preview-dev-server-admission.cjs'),
    'utf8',
  );

  assert.match(source, /main_live_preview_dev_server_admission_contract_v1/u);
  assert.match(source, /process_spawn:\s*'not_started'/u);
  assert.match(source, /package_install:\s*'not_allowed'/u);
  assert.match(source, /bind_host:\s*'127\.0\.0\.1'/u);
  assert.match(source, /renderer_command:\s*'not_accepted'/u);
  assert.doesNotMatch(
    source,
    /require\(['"]electron['"]\)|ipcMain|ipcRenderer|contextBridge|BrowserWindow|BrowserView|WebContentsView|session\.fromPartition|createServer|listen\s*\(|node:fs|node:http|node:https|child_process|spawn\s*\(|execFile|exec\(|npm install|pnpm install|yarn install|bun install|fetch\s*\(|builder-provider|builder-git-|safeStorage|credential|secret_ref/iu,
  );
});
