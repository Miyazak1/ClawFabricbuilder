import { describe, expect, it, vi } from 'vitest';

import {
  BuilderDesktopCheckRunPortError,
  createBuilderDesktopCheckRunPort,
} from './builderDesktopCheckRunPort';

const DRAFT_ID = `builder-generation-draft:${'a'.repeat(64)}`;
const PROJECT_ID = 'builder-project:123e4567-e89b-42d3-a456-426614174000';
const CANDIDATE_ID = `builder-code-change-candidate:${'b'.repeat(64)}`;
const PROFILE_ID = `builder-command-profile:${'c'.repeat(32)}`;

function authority() {
  return {
    projection_authority: 'main_owned_check_run_status_projection_v1',
    check_run_authority: 'verified_check_run_contract',
    renderer_authority: 'read_only_projection',
    ipc_authority: 'projection_only',
    raw_output: 'not_present',
    runtime_paths: 'not_present',
    provider_dispatch: false,
    command_execution: false,
    source_write: 'not_present',
    git_write: false,
    sqlite_write: false,
    save_authority: false,
  };
}

function available() {
  return {
    result_version: 'builder-check-run-current-draft-read-result.v1',
    service_version: 'builder-check-run-current-draft-service.v1',
    operation: 'current_draft_available_checks_read',
    status: 'ready',
    draft_id: DRAFT_ID,
    project_id: PROJECT_ID,
    candidate_id: CANDIDATE_ID,
    available_checks: [{
      command_profile_id: PROFILE_ID,
      command_kind: 'test',
      command_display: 'npm test',
      requires_user_approval: true,
    }],
  };
}

function completed() {
  return {
    result_version: 'builder-check-run-current-draft-run-result.v1',
    service_version: 'builder-check-run-current-draft-service.v1',
    operation: 'current_draft_approved_check_completed',
    draft_id: DRAFT_ID,
    project_id: PROJECT_ID,
    candidate_id: CANDIDATE_ID,
    check_run_status_projection: {
      projection_version: 'builder-check-run-status-projection.v1',
      project_id: PROJECT_ID,
      candidate_id: CANDIDATE_ID,
      check_run_id: `builder-check-run:${'d'.repeat(64)}`,
      command_kind: 'test',
      command_label: 'Tests',
      status: 'passed',
      label: 'Checked',
      summary: 'The project check completed successfully.',
      environment_reason: 'none',
      completed_at_ms: 20,
      result_digest: `sha256:${'e'.repeat(64)}`,
      authority: authority(),
    },
  };
}

function diagnosisAuthority() {
  return {
    diagnosis_authority: 'main_owned_read_only_environment_diagnosis_v1',
    readiness_authority: 'verified_builder_runtime_readiness_snapshot_v1',
    renderer_authority: 'redacted_projection_only',
    browser_preview_authority: 'readiness_context_only_no_install_decision',
    provider_dispatch: false,
    harness_dispatch: false,
    command_execution: false,
    dependency_preparation: false,
    project_workspace_write: false,
    check_workspace_write: false,
    git_write: false,
    sqlite_write: false,
    save_authority: false,
    path_disclosure: 'not_serialized',
    environment_variable_disclosure: false,
    raw_output: 'not_present',
    secret_access: 'not_present',
    network_access: false,
  };
}

function environmentDiagnosis() {
  return {
    diagnosis_version: 'builder-environment-readiness-diagnosis.v1',
    diagnosis_id: `builder-environment-readiness-diagnosis:${'1'.repeat(64)}`,
    project_id: PROJECT_ID,
    candidate_id: CANDIDATE_ID,
    source_tree_digest: `sha256:${'2'.repeat(64)}`,
    command_profile_id: PROFILE_ID,
    command_kind: 'test',
    command_display: 'npm test',
    package_manager: 'npm',
    package_manifest: 'present',
    dependency_manifest: 'present',
    lockfile: 'package-lock.json',
    project_dependency_state: 'install_present',
    check_workspace_dependency_state: 'install_missing',
    host_toolchain_state: 'visible',
    host_node_version: 'v22.22.3',
    host_package_manager_version: '10.9.3',
    install_permission: 'not_requested',
    dependency_strategy: 'needs_prepared_dependency_workspace',
    readiness_state: 'dependencies_not_prepared',
    primary_action: 'prepare_once',
    safe_summary: 'The isolated check workspace has not prepared this draft\'s dependencies yet.',
    authority: diagnosisAuthority(),
    diagnosed_at_ms: 30,
    diagnosis_digest: `sha256:${'3'.repeat(64)}`,
  };
}

function diagnosisResult() {
  return {
    result_version: 'builder-check-run-current-draft-environment-diagnosis-result.v1',
    service_version: 'builder-check-run-current-draft-service.v1',
    operation: 'current_draft_check_environment_diagnosed',
    draft_id: DRAFT_ID,
    project_id: PROJECT_ID,
    candidate_id: CANDIDATE_ID,
    environment_diagnosis: environmentDiagnosis(),
  };
}

function projectDiagnosisAuthority() {
  return {
    diagnosis_authority: 'main_owned_read_only_project_environment_diagnosis_v1',
    source_authority: 'main_owned_current_project_source_tree',
    toolchain_probe_authority: 'main_owned_bounded_toolchain_version_probe_v1',
    renderer_authority: 'redacted_projection_only',
    browser_preview_authority: 'readiness_context_only_no_install_decision',
    provider_dispatch: false,
    harness_dispatch: false,
    command_execution: false,
    dependency_preparation: false,
    project_workspace_write: false,
    check_workspace_write: false,
    git_write: false,
    sqlite_write: false,
    save_authority: false,
    path_disclosure: 'not_serialized',
    environment_variable_disclosure: false,
    raw_output: 'not_present',
    secret_access: 'not_present',
    network_access: false,
  };
}

function projectDiagnosisResult() {
  return {
    result_version: 'builder-project-environment-diagnosis-result.v1',
    service_version: 'builder-project-environment-diagnosis-service.v1',
    operation: 'project_environment_diagnosed',
    project_id: PROJECT_ID,
    environment_diagnosis: {
      diagnosis_version: 'builder-project-environment-diagnosis.v1',
      diagnosis_id: `builder-project-environment-diagnosis:${'4'.repeat(64)}`,
      project_id: PROJECT_ID,
      source_tree_digest: `sha256:${'5'.repeat(64)}`,
      package_manager: 'npm',
      package_manifest: 'present',
      dependency_manifest: 'present',
      lockfile: 'package-lock.json',
      project_dependency_state: 'install_missing',
      toolchains: {
        node: { state: 'visible', version: 'v22.22.3' },
        npm: { state: 'visible', version: '10.9.3' },
        pnpm: { state: 'missing', version: null },
        yarn: { state: 'missing', version: null },
        git: { state: 'visible', version: '2.50.0' },
      },
      readiness_state: 'project_dependencies_missing',
      primary_action: 'show_project_dependency_setup',
      safe_summary: 'This project declares dependencies, but the project folder does not have installed dependencies.',
      authority: projectDiagnosisAuthority(),
      diagnosed_at_ms: 31,
      diagnosis_digest: `sha256:${'6'.repeat(64)}`,
    },
  };
}

function projectDependencyPreparationResult() {
  return {
    result_version: 'builder-project-dependency-preparation-result.v1',
    service_version: 'builder-project-dependency-preparer.v1',
    operation: 'project_dependencies_prepared',
    project_id: PROJECT_ID,
    preparation_receipt: {
      receipt_version: 'builder-project-dependency-preparation-receipt.v1',
      project_id: PROJECT_ID,
      package_manager: 'npm',
      install_command: 'npm ci',
      status: 'prepared',
      exit_code: 0,
      started_at_ms: 41,
      completed_at_ms: 52,
      output_digest: `sha256:${'7'.repeat(64)}`,
      authority: { preparation_authority: 'main_owned_project_dependency_preparation_v1' },
      receipt_digest: `sha256:${'8'.repeat(64)}`,
    },
    environment_diagnosis: {
      ...projectDiagnosisResult().environment_diagnosis,
      project_dependency_state: 'install_present',
      readiness_state: 'ready',
      primary_action: 'none',
      safe_summary: 'The project environment appears ready.',
    },
  };
}

function bridge(overrides = {}) {
  return {
    readCurrentDraftAvailableChecks: vi.fn(async () => available()),
    diagnoseCurrentDraftCheckEnvironment: vi.fn(async () => diagnosisResult()),
    diagnoseProjectEnvironment: vi.fn(async () => projectDiagnosisResult()),
    prepareProjectDependencies: vi.fn(async () => projectDependencyPreparationResult()),
    approveAndRunCurrentDraftCheck: vi.fn(async () => completed()),
    decideCurrentDraftDependencyPreparation: vi.fn(async () => completed()),
    skipCurrentDraftCheck: vi.fn(async () => ({
      result_version: 'builder-check-skip-current-draft-public-result.v1',
      operation: 'current_draft_check_skipped',
      draft_id: DRAFT_ID,
      project_id: PROJECT_ID,
      candidate_id: CANDIDATE_ID,
      status: 'skipped',
    })),
    ...overrides,
  };
}

describe('createBuilderDesktopCheckRunPort', () => {
  it('forwards only draft and displayed profile identity then projects safe results', async () => {
    const source = bridge();
    const port = createBuilderDesktopCheckRunPort(source);
    const read = await port.readCurrentDraftAvailableChecks({ draft_id: DRAFT_ID });
    const diagnosed = await port.diagnoseCurrentDraftCheckEnvironment({
      draft_id: DRAFT_ID,
      command_profile_id: PROFILE_ID,
    });
    const projectDiagnosed = await port.diagnoseProjectEnvironment({
      project_id: PROJECT_ID,
    });
    const projectPrepared = await port.prepareProjectDependencies({
      project_id: PROJECT_ID,
    });
    const run = await port.approveAndRunCurrentDraftCheck({
      draft_id: DRAFT_ID,
      command_profile_id: PROFILE_ID,
    });
    const prepared = await port.decideCurrentDraftDependencyPreparation({
      draft_id: DRAFT_ID,
      command_profile_id: PROFILE_ID,
      decision: 'allow_once',
    });
    const skipped = await port.skipCurrentDraftCheck({ draft_id: DRAFT_ID });
    expect(source.readCurrentDraftAvailableChecks).toHaveBeenCalledExactlyOnceWith({ draft_id: DRAFT_ID });
    expect(source.diagnoseCurrentDraftCheckEnvironment).toHaveBeenCalledExactlyOnceWith({
      draft_id: DRAFT_ID,
      command_profile_id: PROFILE_ID,
    });
    expect(source.diagnoseProjectEnvironment).toHaveBeenCalledExactlyOnceWith({
      project_id: PROJECT_ID,
    });
    expect(source.prepareProjectDependencies).toHaveBeenCalledExactlyOnceWith({
      project_id: PROJECT_ID,
    });
    expect(source.approveAndRunCurrentDraftCheck).toHaveBeenCalledExactlyOnceWith({
      draft_id: DRAFT_ID,
      command_profile_id: PROFILE_ID,
    });
    expect(source.decideCurrentDraftDependencyPreparation).toHaveBeenCalledExactlyOnceWith({
      draft_id: DRAFT_ID,
      command_profile_id: PROFILE_ID,
      decision: 'allow_once',
    });
    expect(source.skipCurrentDraftCheck).toHaveBeenCalledExactlyOnceWith({ draft_id: DRAFT_ID });
    expect(read.available_checks[0]?.command_display).toBe('npm test');
    expect(diagnosed.environment_diagnosis.readiness_state).toBe('dependencies_not_prepared');
    expect(diagnosed.environment_diagnosis.primary_action).toBe('prepare_once');
    expect(diagnosed.environment_diagnosis).not.toHaveProperty('authority');
    expect(projectDiagnosed.environment_diagnosis.readiness_state).toBe('project_dependencies_missing');
    expect(projectDiagnosed.environment_diagnosis.primary_action).toBe('show_project_dependency_setup');
    expect(projectDiagnosed.environment_diagnosis.toolchains.node.state).toBe('visible');
    expect(projectDiagnosed.environment_diagnosis).not.toHaveProperty('authority');
    expect(projectPrepared.environment_diagnosis.readiness_state).toBe('ready');
    expect(projectPrepared.preparation_receipt.status).toBe('prepared');
    expect(projectPrepared.preparation_receipt).not.toHaveProperty('authority');
    expect(run.check_run_status_projection.status).toBe('passed');
    expect(prepared.check_run_status_projection.status).toBe('passed');
    expect(run.check_run_status_projection).not.toHaveProperty('authority');
    expect(skipped.status).toBe('skipped');
    expect(Object.isFrozen(read)).toBe(true);
    expect(Object.isFrozen(diagnosed)).toBe(true);
    expect(Object.isFrozen(run)).toBe(true);
    expect(Object.isFrozen(skipped)).toBe(true);
  });

  it('rejects unsafe environment diagnosis authority and identity drift', async () => {
    const unsafeAuthority = {
      ...diagnosisResult(),
      environment_diagnosis: {
        ...environmentDiagnosis(),
        authority: {
          ...diagnosisAuthority(),
          dependency_preparation: true,
        },
      },
    };
    const drift = {
      ...diagnosisResult(),
      environment_diagnosis: {
        ...environmentDiagnosis(),
        command_profile_id: `builder-command-profile:${'f'.repeat(32)}`,
      },
    };

    for (const leaked of [
      { ...diagnosisResult(), source_tree: {} },
      unsafeAuthority,
      drift,
      {
        ...diagnosisResult(),
        environment_diagnosis: {
          ...environmentDiagnosis(),
          raw_output: 'private',
        },
      },
    ]) {
      const port = createBuilderDesktopCheckRunPort(bridge({
        diagnoseCurrentDraftCheckEnvironment: async () => leaked,
      }));
      await expect(port.diagnoseCurrentDraftCheckEnvironment({
        draft_id: DRAFT_ID,
        command_profile_id: PROFILE_ID,
      })).rejects.toBeInstanceOf(BuilderDesktopCheckRunPortError);
    }
  });

  it('rejects unsafe project environment diagnosis authority and request drift', async () => {
    const unsafeAuthority = {
      ...projectDiagnosisResult(),
      environment_diagnosis: {
        ...projectDiagnosisResult().environment_diagnosis,
        authority: {
          ...projectDiagnosisAuthority(),
          browser_preview_authority: 'can_install',
        },
      },
    };
    const source = bridge({
      diagnoseProjectEnvironment: async () => unsafeAuthority,
    });
    const port = createBuilderDesktopCheckRunPort(source);

    await expect(port.diagnoseProjectEnvironment({ project_id: PROJECT_ID }))
      .rejects.toBeInstanceOf(BuilderDesktopCheckRunPortError);
    await expect(port.diagnoseProjectEnvironment({
      project_id: PROJECT_ID,
      source_tree: {},
    } as never)).rejects.toBeInstanceOf(BuilderDesktopCheckRunPortError);
  });

  it('preserves redacted environment readiness details in check results', async () => {
    const source = bridge({
      approveAndRunCurrentDraftCheck: vi.fn(async () => ({
        ...completed(),
        check_run_status_projection: {
          ...completed().check_run_status_projection,
          status: 'incomplete',
          label: 'Check unavailable',
          summary:
            'This draft declares project dependencies, but the isolated check workspace has not prepared them yet.',
          environment_reason: 'dependency_workspace_missing',
        },
      })),
    });
    const port = createBuilderDesktopCheckRunPort(source);

    const run = await port.approveAndRunCurrentDraftCheck({
      draft_id: DRAFT_ID,
      command_profile_id: PROFILE_ID,
    });

    expect(run.check_run_status_projection.status).toBe('incomplete');
    expect(run.check_run_status_projection.label).toBe('Check unavailable');
    expect(run.check_run_status_projection.environment_reason).toBe('dependency_workspace_missing');
    expect(run.check_run_status_projection.summary).toBe(
      'This draft declares project dependencies, but the isolated check workspace has not prepared them yet.',
    );
  });

  it('preserves dependency preparation failure details in check results', async () => {
    const source = bridge({
      approveAndRunCurrentDraftCheck: vi.fn(async () => ({
        ...completed(),
        check_run_status_projection: {
          ...completed().check_run_status_projection,
          status: 'incomplete',
          label: 'Check unavailable',
          summary:
            'Dependency preparation failed in the isolated check workspace. You can retry preparation for this check.',
          environment_reason: 'dependency_preparation_failed',
        },
      })),
    });
    const port = createBuilderDesktopCheckRunPort(source);

    const run = await port.approveAndRunCurrentDraftCheck({
      draft_id: DRAFT_ID,
      command_profile_id: PROFILE_ID,
    });

    expect(run.check_run_status_projection.status).toBe('incomplete');
    expect(run.check_run_status_projection.environment_reason).toBe('dependency_preparation_failed');
    expect(run.check_run_status_projection.summary).toBe(
      'Dependency preparation failed in the isolated check workspace. You can retry preparation for this check.',
    );
  });

  it('rejects malformed requests before bridge invocation', async () => {
    const source = bridge();
    const port = createBuilderDesktopCheckRunPort(source);
    await expect(port.readCurrentDraftAvailableChecks({
      draft_id: 'bad',
      source_tree: {},
    } as never)).rejects.toBeInstanceOf(BuilderDesktopCheckRunPortError);
    await expect(port.approveAndRunCurrentDraftCheck({
      draft_id: DRAFT_ID,
      command_profile_id: PROFILE_ID,
      command: 'npm test',
    } as never)).rejects.toBeInstanceOf(BuilderDesktopCheckRunPortError);
    await expect(port.decideCurrentDraftDependencyPreparation({
      draft_id: DRAFT_ID,
      command_profile_id: PROFILE_ID,
      decision: 'allow_once',
      cwd: 'C:\\private',
    } as never)).rejects.toBeInstanceOf(BuilderDesktopCheckRunPortError);
    await expect(port.decideCurrentDraftDependencyPreparation({
      draft_id: DRAFT_ID,
      command_profile_id: PROFILE_ID,
      decision: 'always',
    } as never)).rejects.toBeInstanceOf(BuilderDesktopCheckRunPortError);
    await expect(port.diagnoseCurrentDraftCheckEnvironment({
      draft_id: DRAFT_ID,
      command_profile_id: PROFILE_ID,
      cwd: 'C:\\private',
    } as never)).rejects.toBeInstanceOf(BuilderDesktopCheckRunPortError);
    expect(source.readCurrentDraftAvailableChecks).not.toHaveBeenCalled();
    expect(source.diagnoseCurrentDraftCheckEnvironment).not.toHaveBeenCalled();
    expect(source.approveAndRunCurrentDraftCheck).not.toHaveBeenCalled();
    expect(source.decideCurrentDraftDependencyPreparation).not.toHaveBeenCalled();
  });

  it('rejects script, raw output, runtime path, and identity drift in results', async () => {
    for (const leaked of [
      { ...available(), source_tree: {} },
      { ...available(), available_checks: [{ ...available().available_checks[0], script_body: 'secret' }] },
      { ...completed(), raw_output: 'private' },
      {
        ...completed(),
        check_run_status_projection: {
          ...completed().check_run_status_projection,
          candidate_id: `builder-code-change-candidate:${'f'.repeat(64)}`,
        },
      },
    ]) {
      const port = createBuilderDesktopCheckRunPort(bridge({
        readCurrentDraftAvailableChecks: async () => leaked,
        approveAndRunCurrentDraftCheck: async () => leaked,
        decideCurrentDraftDependencyPreparation: async () => leaked,
      }));
      await expect(port.readCurrentDraftAvailableChecks({ draft_id: DRAFT_ID }))
        .rejects.toBeInstanceOf(BuilderDesktopCheckRunPortError);
      await expect(port.approveAndRunCurrentDraftCheck({
        draft_id: DRAFT_ID,
        command_profile_id: PROFILE_ID,
      })).rejects.toBeInstanceOf(BuilderDesktopCheckRunPortError);
      await expect(port.decideCurrentDraftDependencyPreparation({
        draft_id: DRAFT_ID,
        command_profile_id: PROFILE_ID,
        decision: 'deny',
      })).rejects.toBeInstanceOf(BuilderDesktopCheckRunPortError);
    }
  });

  it('preserves only safe check-decision error codes from the bridge', async () => {
    const busyError = Object.assign(new Error('private busy path'), {
      code: 'builder_check_run_approval_busy',
    });
    const staleError = Object.assign(new Error('private draft path'), {
      code: 'builder_check_run_current_draft_failed',
    });
    const privateError = Object.assign(new Error('C:\\private\\sqlite'), {
      code: 'private_sqlite_failure',
    });

    await expect(createBuilderDesktopCheckRunPort(bridge({
      decideCurrentDraftDependencyPreparation: vi.fn(async () => {
        throw busyError;
      }),
    })).decideCurrentDraftDependencyPreparation({
      draft_id: DRAFT_ID,
      command_profile_id: PROFILE_ID,
      decision: 'allow_once',
    })).rejects.toMatchObject({
      code: 'builder_check_run_approval_busy',
      message: 'A project check is already in progress.',
    });

    await expect(createBuilderDesktopCheckRunPort(bridge({
      decideCurrentDraftDependencyPreparation: vi.fn(async () => {
        throw staleError;
      }),
    })).decideCurrentDraftDependencyPreparation({
      draft_id: DRAFT_ID,
      command_profile_id: PROFILE_ID,
      decision: 'allow_once',
    })).rejects.toMatchObject({
      code: 'builder_check_run_current_draft_failed',
      message: 'The draft changed before the project check could start.',
    });

    await expect(createBuilderDesktopCheckRunPort(bridge({
      decideCurrentDraftDependencyPreparation: vi.fn(async () => {
        throw privateError;
      }),
    })).decideCurrentDraftDependencyPreparation({
      draft_id: DRAFT_ID,
      command_profile_id: PROFILE_ID,
      decision: 'allow_once',
    })).rejects.toMatchObject({
      code: 'builder_check_run_unavailable',
      message: 'Project checks are unavailable.',
    });
  });

  it('rejects malformed bridges and hostile accessors without invoking them', async () => {
    expect(() => createBuilderDesktopCheckRunPort({})).toThrow(BuilderDesktopCheckRunPortError);
    let getterCalls = 0;
    const port = createBuilderDesktopCheckRunPort(bridge({
      readCurrentDraftAvailableChecks: async () => Object.defineProperty({}, 'result_version', {
        enumerable: true,
        get() { getterCalls += 1; return 'never'; },
      }),
    }));
    await expect(port.readCurrentDraftAvailableChecks({ draft_id: DRAFT_ID }))
      .rejects.toBeInstanceOf(BuilderDesktopCheckRunPortError);
    expect(getterCalls).toBe(0);
  });
});
