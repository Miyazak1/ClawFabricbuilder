'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  BUILDER_TOOL_PROJECT_WORKSPACE_ADMISSION_VERSION,
  BUILDER_TOOL_PROJECT_WORKSPACE_AUTHORITY_VERSION,
  WORKSPACE_ADMISSION_KIND,
  BuilderToolProjectWorkspaceAdmissionError,
  createBuilderToolProjectWorkspaceAuthority,
  sanitizeBuilderToolProjectWorkspaceAdmission,
} = require('../electron/builder-tool-project-workspace-admission.cjs');

const PROJECT_UUID = '123e4567-e89b-42d3-a456-426614174000';
const PROJECT_ID = `builder-project:${PROJECT_UUID}`;

function fixture(t) {
  const projectsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cfb-workspace-admission-'));
  const projectRoot = path.join(projectsRoot, PROJECT_UUID);
  fs.mkdirSync(projectRoot, { recursive: true });
  t.after(() => fs.rmSync(projectsRoot, { recursive: true, force: true }));
  return { projectsRoot, projectRoot };
}

function assertWorkspaceError(error) {
  assert.equal(error instanceof BuilderToolProjectWorkspaceAdmissionError, true);
  assert.equal(error.code, 'builder_tool_project_workspace_admission_invalid');
  assert.equal(error.message, 'The project workspace root could not be verified.');
  assert.equal(error.retryable, false);
  assert.equal(error.stack, `${error.name}: ${error.message}`);
  return true;
}

test('creates a branded main-only workspace admission derived from projects root and project id', (t) => {
  const { projectsRoot, projectRoot } = fixture(t);
  const authority = createBuilderToolProjectWorkspaceAuthority({ projects_root: projectsRoot });
  const admission = authority.admit_project_workspace({
    project_id: PROJECT_ID,
    admitted_at_ms: 61,
  });
  const sanitized = sanitizeBuilderToolProjectWorkspaceAdmission(admission);

  assert.equal(authority.authority_version, BUILDER_TOOL_PROJECT_WORKSPACE_AUTHORITY_VERSION);
  assert.equal(sanitized.admission_version, BUILDER_TOOL_PROJECT_WORKSPACE_ADMISSION_VERSION);
  assert.equal(sanitized.admission_kind, WORKSPACE_ADMISSION_KIND);
  assert.equal(sanitized.project_id, PROJECT_ID);
  assert.equal(sanitized.project_uuid, PROJECT_UUID);
  assert.equal(sanitized.projects_root_real_path, fs.realpathSync.native(projectsRoot));
  assert.equal(sanitized.project_root_real_path, fs.realpathSync.native(projectRoot));
  assert.equal(sanitized.authority.project_root_authority, 'main_project_workspace_root_contract_v1');
  assert.equal(sanitized.authority.path_derivation, 'projects_root_plus_project_id_uuid');
  assert.equal(sanitized.authority.renderer_authority, 'not_present');
  assert.equal(sanitized.authority.provider_dispatch, false);
  assert.equal(sanitized.authority.filesystem_read, 'not_performed');
  assert.match(sanitized.admission_digest, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(Object.isFrozen(sanitized), true);
});

test('rejects cloned, drifted, missing-directory, malformed, and hostile workspace admissions', (t) => {
  const { projectsRoot } = fixture(t);
  const authority = createBuilderToolProjectWorkspaceAuthority({ projects_root: projectsRoot });
  const admission = authority.admit_project_workspace({
    project_id: PROJECT_ID,
    admitted_at_ms: 61,
  });

  assert.throws(
    () => sanitizeBuilderToolProjectWorkspaceAdmission({ ...admission }),
    assertWorkspaceError,
  );
  assert.throws(
    () => sanitizeBuilderToolProjectWorkspaceAdmission({
      ...admission,
      admission_digest: `sha256:${'0'.repeat(64)}`,
    }),
    assertWorkspaceError,
  );
  assert.throws(
    () => createBuilderToolProjectWorkspaceAuthority({ projects_root: path.join(projectsRoot, 'missing') }),
    assertWorkspaceError,
  );
  assert.throws(
    () => authority.admit_project_workspace({
      project_id: 'builder-project:123e4567-e89b-42d3-a456-426614174999',
      admitted_at_ms: 61,
    }),
    assertWorkspaceError,
  );

  let getterCalls = 0;
  const accessorInput = { admitted_at_ms: 61 };
  Object.defineProperty(accessorInput, 'project_id', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return PROJECT_ID;
    },
  });
  assert.throws(() => authority.admit_project_workspace(accessorInput), assertWorkspaceError);
  assert.throws(
    () => createBuilderToolProjectWorkspaceAuthority(new Proxy({ projects_root: projectsRoot }, {})),
    assertWorkspaceError,
  );
  assert.equal(getterCalls, 0);
});

test('source remains a main-only workspace root contract with no renderer, provider, Git, or read authority', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'builder-tool-project-workspace-admission.cjs'),
    'utf8',
  );
  assert.match(source, /builder-tool-project-workspace-admission\.v1/u);
  assert.match(source, /builder-tool-project-workspace-authority\.v1/u);
  assert.match(source, /main_project_workspace_root_contract_v1/u);
  assert.match(source, /projects_root_plus_project_id_uuid/u);
  assert.match(source, /TRUSTED_WORKSPACE_ADMISSIONS = new WeakSet/u);
  assert.match(source, /fs\.realpathSync\.native/u);
  assert.match(source, /isSymbolicLink\(\)/u);
  assert.doesNotMatch(
    source,
    /require\(['"]electron['"]\)|ipcMain|ipcRenderer|contextBridge|BrowserWindow|safeStorage|builder-provider|builder-git|builder-conversation|builder-project-main-authority|fetch\s*\(|https?:|Authorization|Bearer|child_process|execFile|spawn\s*\(|readFile|createReadStream|readdir|openSync|open\s*\(|writeFile|appendFile|createWriteStream|unlink|rmSync|rm\s*\(|mkdir|eval\s*\(|new Function|shell:\s*true|persist_candidate_commit|write_current|commit_oid|tree_oid|source_tree|provider_secret|credential_secret|credential_value|secret_ref|local-provider-executor|chat_planner|ChatCreatePage|Canvas|JobMeta/iu,
  );
});
