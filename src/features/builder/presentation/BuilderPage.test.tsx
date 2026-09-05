// @vitest-environment jsdom
import { act, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createBuilderProjectController } from '../application/builderProjectController';
import { createBuilderConversationController } from '../application/builderConversationController';
import { createBuilderProjectHistoryController } from '../application/builderProjectHistoryController';
import { createBuilderProjectCatalogController } from '../application/builderProjectCatalogController';
import {
  createBuilderLiveOutputStore,
  type BuilderLiveOutputFrameScheduler,
} from '../application/builderLiveOutputStore';
import {
  BuilderGenerationDiagnosticError,
  type BuilderSideWorkspaceFileAuthority,
  type BuilderSideWorkspaceFileContentProjection,
  type BuilderSideWorkspaceFileRef,
  type BuilderSideWorkspaceFileTreeProjection,
} from '../application/builderPorts';
import { canStopBuilderAgentTask } from '../domain/builderAgentTaskMonitorProjection';
import { BuilderPage, type BuilderFileName } from './BuilderPage';
import {
  CONVERSATION_ID,
  DRAFT_ID,
  PROJECT_ID,
  RUN_ID,
  TASK_ID,
  TURN_ID,
  createAcceptedTaskStreamWire,
  createAnswerTaskStreamWire,
  createCatalogWire,
  createWorkspaceCatalogWire,
  createGenerationAnswer,
  createGenerationDraft,
  createHistoryWire,
  createPlanTaskStreamWire,
  createPlanReviewTaskStreamWire,
  createProgressTaskStreamWire,
  createReadWire,
  createRejectedTaskStreamWire,
  createRestoredGenerationDraft,
  createSaveResult,
  createSourceTree,
  createTaskStreamWire,
  digest,
} from '../../../test/builderV2Fixtures';
import { createBuilderGenerationRequest } from '../application/builderGeneration';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mounted: Array<{ container: HTMLDivElement; root: Root }> = [];

const PLAN_SOURCE_READ_READY = Object.freeze({
  result_version: 'builder-plan-source-read-approval-status.v1',
  project_id: PROJECT_ID,
  state: 'ready',
  file_count: 1,
  approval_scope: 'current_project_plan_source_read',
  authority: 'main_selected_project_bounded_filesystem_read_v1',
} as const);

const PLAN_SOURCE_READ_APPROVED = Object.freeze({
  result_version: 'builder-plan-source-read-approval-result.v1',
  project_id: PROJECT_ID,
  operation: 'approval_recorded',
  file_count: 1,
  approval_scope: 'current_project_plan_source_read',
  authority: 'main_selected_project_bounded_filesystem_read_v1',
} as const);
const TASK_ADDRESS_ID = 'builder-task-address:123e4567-e89b-42d3-a456-426614174001';

const SIDE_WORKSPACE_SOURCE_TREE_DIGEST = `sha256:${'a'.repeat(64)}`;
const SIDE_WORKSPACE_APP_DIGEST = `sha256:${'b'.repeat(64)}`;
const SIDE_WORKSPACE_STYLE_DIGEST = `sha256:${'c'.repeat(64)}`;
const SIDE_WORKSPACE_ADD_DIGEST = `sha256:${'d'.repeat(64)}`;
const SIDE_WORKSPACE_TOOL_DIGEST = `sha256:${'e'.repeat(64)}`;
const LIVE_PREVIEW_CONVERSATION_ID =
  'builder-conversation:123e4567-e89b-42d3-a456-426614174000';

function projectDependencyMissingDiagnosis() {
  return {
    project_id: PROJECT_ID,
    status: 'ready' as const,
    diagnosis: {
      diagnosis_version: 'builder-project-environment-diagnosis.v1' as const,
      diagnosis_id: `builder-project-environment-diagnosis:${'7'.repeat(64)}`,
      project_id: PROJECT_ID,
      source_tree_digest: `sha256:${'8'.repeat(64)}`,
      package_manager: 'npm' as const,
      package_manifest: 'present' as const,
      dependency_manifest: 'present' as const,
      lockfile: 'none' as const,
      project_dependency_state: 'install_missing' as const,
      toolchains: {
        node: { state: 'visible' as const, version: '22.17.0' },
        npm: { state: 'visible' as const, version: '10.9.2' },
        pnpm: { state: 'missing' as const, version: null },
        yarn: { state: 'missing' as const, version: null },
        git: { state: 'visible' as const, version: '2.50.0' },
      },
      readiness_state: 'project_dependencies_missing' as const,
      primary_action: 'show_project_dependency_setup' as const,
      safe_summary: 'This project declares dependencies, but the project folder does not have installed dependencies.',
      diagnosed_at_ms: 1234,
      diagnosis_digest: `sha256:${'9'.repeat(64)}`,
    },
  };
}

function livePreviewRuntimeLaunchProjection(
  overrides: {
    preview_kind?: 'live_static_web' | 'live_dev_server_web';
    command_profile?: 'none' | 'main_owned_dev_server_profile';
    user_approval?: 'not_required' | 'required' | 'approved_once' | 'denied_or_expired';
    command_execution?: 'not_applicable' | 'approval_required' | 'started' | 'stopped' | 'failed';
    sandbox_policy?: 'static_preview_no_command_execution' | 'dev_server_only_no_dependency_install';
  } = {},
) {
  return {
    ...livePreviewRuntimeLaunchProjectionBase(),
    ...overrides,
  };
}

function livePreviewRuntimeLaunchProjectionBase() {
  return {
    projection_version: 'builder-project-runtime-launch-projection.v1' as const,
    project_id: PROJECT_ID,
    conversation_id: LIVE_PREVIEW_CONVERSATION_ID,
    preview_kind: 'live_static_web' as const,
    source_status: 'main_owned_verified' as const,
    command_profile: 'none' as const,
    user_approval: 'not_required' as const,
    command_execution: 'not_applicable' as const,
    dependency_preparation: 'not_allowed' as const,
    package_install: 'not_allowed' as const,
    sandbox_policy: 'static_preview_no_command_execution' as const,
    provider_dispatch: false as const,
    tool_dispatch: false as const,
    project_workspace_write: 'not_granted_by_preview' as const,
    authority: {
      projection_authority: 'main_owned_project_runtime_launch_projection_v1' as const,
      renderer_authority: 'status_projection_only' as const,
      path_disclosure: 'not_serialized' as const,
    },
  };
}

type SideWorkspaceFileFixture = Readonly<{
  contentDigest: string;
  path: string;
}>;

function sideWorkspaceFileAuthority(): BuilderSideWorkspaceFileAuthority {
  return Object.freeze({
    file_projection_authority: 'main_owned_side_workspace_file_projection_v1',
    renderer_source_tree: 'not_accepted',
    renderer_path_authority: 'main_issued_file_ref_only',
    source_read: 'main_owned_verified_source_tree_only',
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
  });
}

function sideWorkspaceFileRef(
  path: string,
  contentDigest: string,
  sourceKind: BuilderSideWorkspaceFileRef['source_kind'] = 'current_draft',
): BuilderSideWorkspaceFileRef {
  return Object.freeze({
    file_ref_version: 'builder-side-workspace-file-ref.v1',
    source_kind: sourceKind,
    source_tree_digest: SIDE_WORKSPACE_SOURCE_TREE_DIGEST,
    path,
    content_digest: contentDigest,
  });
}

function sideWorkspaceFileTree(
  files: readonly SideWorkspaceFileFixture[] = Object.freeze([
    Object.freeze({ path: 'src/App.tsx', contentDigest: SIDE_WORKSPACE_APP_DIGEST }),
    Object.freeze({ path: 'src/styles.css', contentDigest: SIDE_WORKSPACE_STYLE_DIGEST }),
  ]),
  sourceKind: BuilderSideWorkspaceFileRef['source_kind'] = 'current_draft',
): BuilderSideWorkspaceFileTreeProjection {
  const hasSrcDirectory = files.some((file) => file.path.startsWith('src/'));
  const entries = [
    ...(hasSrcDirectory ? [
      Object.freeze({
        entry_kind: 'directory' as const,
        path: 'src',
        name: 'src',
        parent_path: null,
        depth: 0,
        child_count: files.filter((file) => file.path.startsWith('src/')).length,
      }),
    ] : []),
    ...files.map((file) => Object.freeze({
      entry_kind: 'text_file' as const,
      path: file.path,
      name: file.path.split('/').at(-1) ?? file.path,
      parent_path: file.path.includes('/') ? file.path.split('/').slice(0, -1).join('/') : null,
      depth: file.path.includes('/') ? 1 : 0,
      content_digest: file.contentDigest,
      file_ref: sideWorkspaceFileRef(file.path, file.contentDigest, sourceKind),
    })),
  ];
  return Object.freeze({
    projection_version: 'builder-side-workspace-file-tree.v1',
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    source_kind: sourceKind,
    root_label: sourceKind === 'runtime_snapshot' ? 'Run files' : 'Current draft',
    source_tree_digest: SIDE_WORKSPACE_SOURCE_TREE_DIGEST,
    entries: Object.freeze(entries),
    selected_file_ref: files[0] === undefined
      ? null
      : sideWorkspaceFileRef(files[0].path, files[0].contentDigest, sourceKind),
    source_ref: Object.freeze({
      source_ref_kind: sourceKind === 'runtime_snapshot'
        ? 'runtime_workspace_snapshot'
        : 'current_draft_checkpoint_candidate',
    }),
    authority: sideWorkspaceFileAuthority(),
  });
}

function sideWorkspaceFileContent(
  file: SideWorkspaceFileFixture = Object.freeze({
    path: 'src/App.tsx',
    contentDigest: SIDE_WORKSPACE_APP_DIGEST,
  }),
  textPreview = 'export function App() { return <main />; }\n',
  languageHint: BuilderSideWorkspaceFileContentProjection['language_hint'] = 'typescript',
  sourceKind: BuilderSideWorkspaceFileRef['source_kind'] = 'current_draft',
): BuilderSideWorkspaceFileContentProjection {
  return Object.freeze({
    projection_version: 'builder-side-workspace-file-content.v1',
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    source_kind: sourceKind,
    source_tree_digest: SIDE_WORKSPACE_SOURCE_TREE_DIGEST,
    file_ref: sideWorkspaceFileRef(file.path, file.contentDigest, sourceKind),
    path: file.path,
    language_hint: languageHint,
    content_status: 'ready',
    text_preview: textPreview,
    binary_summary: null,
    authority: sideWorkspaceFileAuthority(),
  });
}

function providerContextDisclosureStatusProjection() {
  return Object.freeze({
    projection_version: 'builder-provider-context-disclosure-status-projection.v1',
    label: 'Allow AI to use current context',
    tone: 'warning',
    next_action_hint: 'Review this before Builder shares the current task context.',
    needs_user_approval: true,
    can_use_provider_context: false,
    blocked_reason: 'context_disclosure_not_approved',
    request_available: true,
    inspection: Object.freeze({
      title: 'Share current task context with the configured AI provider',
      summary: 'Allow Builder to build with current context using a bounded local context summary.',
      details: 'This request does not include source files, secrets, ids, digests, or raw context text.',
      purpose: 'contextual_build',
      provider_scope: 'configured_provider',
      context_surface: Object.freeze({
        working_context_state_status: 'approved_plan_ready',
        segment_count: 3,
        segment_kinds: Object.freeze(['latest_user_message', 'working_context_objective', 'approved_plan'] as const),
        omitted_ref_count: 0,
        budget: Object.freeze({
          used_prompt_bytes: 512,
          max_prompt_bytes: 4096,
          reserved_response_bytes: 1024,
        }),
        permission_gate: Object.freeze({
          workspace_state: 'bound',
          write_permission: 'ask',
          side_effect_ready: false,
        }),
      }),
    }),
    authority: Object.freeze({
      projection_authority: 'main_owned_provider_context_disclosure_status_projection_v1',
      disclosure_request_preparation: 'verified_safe_inspection_only',
      renderer_authority: 'not_present',
      provider_context_body: 'not_present',
      provider_dispatch: false,
      tool_dispatch: false,
      source_read: 'not_present',
      source_write: 'not_present',
      git_mutation: false,
      sqlite_write: false,
      permission_grant: false,
      revision_admission: 'not_created',
      secret_access: 'not_present',
    }),
  } as const);
}

afterEach(() => {
  for (const entry of mounted.splice(0)) {
    act(() => entry.root.unmount());
    entry.container.remove();
  }
});

function render(element: ReactNode): HTMLDivElement {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  mounted.push({ container, root });
  act(() => root.render(element));
  return container;
}

async function createLocalProjectSelectionCancelled(request: Readonly<{ project_id: string | null; project_title: string }>) {
  void request;
  return {
    result_version: 'builder-project-selection-result.v1',
    operation: 'new_selected',
    project_id: null,
  };
}

async function createLocalProjectSelection(request: Readonly<{ project_id: string | null; project_title: string }>) {
  return {
    result_version: 'builder-project-selection-result.v1',
    operation: 'local_project_bound',
    project_id: request.project_id ?? PROJECT_ID,
    project_title: request.project_title,
    source_folders: [
      {
        name: 'site-source',
        status: 'selected',
      },
    ],
  };
}

async function openProjectLocationSelection(request: Readonly<{ project_id: string }>) {
  return {
    result_version: 'builder-project-location-open-result.v1',
    project_id: request.project_id,
    opened: true,
  };
}

async function snapshots() {
  const readWire = await createReadWire();
  let draft = await createGenerationDraft();
  const controller = createBuilderProjectController({
    generator: {
      async submit(request) {
        draft = await createGenerationDraft(request, readWire.source_tree);
        return draft;
      },
      async generate(request) {
        draft = await createGenerationDraft(request, readWire.source_tree);
        return draft;
      },
      async continueDraft(request) {
        draft = await createGenerationDraft(
          await createBuilderGenerationRequest(request.instruction, PROJECT_ID),
          readWire.source_tree,
        );
        return draft;
      },
      async generateApprovedPlan() {
        return draft;
      },
      async proposePlan() {
        return null;
      },
      async preparePlanSourceReadApproval() {
        return PLAN_SOURCE_READ_READY;
      },
      async approvePlanSourceRead() {
        return PLAN_SOURCE_READ_APPROVED;
      },
      async prepareCurrentProjectWriteApproval() {
        return {
          result_version: 'builder-current-project-write-approval-status.v1',
          project_id: PROJECT_ID,
          state: 'ready',
          approval_scope: 'current_project_write',
          authority: 'main_selected_project_project_edit_v1',
        };
      },
      async approveCurrentProjectWrite() {
        return {
          result_version: 'builder-current-project-write-approval-result.v1',
          project_id: PROJECT_ID,
          operation: 'already_approved',
          approval_scope: 'current_project_write',
          authority: 'main_selected_project_project_edit_v1',
        };
      },
      async retry(request) {
        draft = await createGenerationDraft(request, readWire.source_tree);
        return draft;
      },
      async answer(request) {
        return createGenerationAnswer(request);
      },
      async answerDraft(request) {
        return createGenerationAnswer(
          await createBuilderGenerationRequest(request.instruction, PROJECT_ID),
        );
      },
      async restoreDraft() {
        return draft;
      },
      async restoreRevisionAsDraft() {
        return draft;
      },
      async rejectDraft(request) {
        return {
          result_version: 'builder-generation-draft-rejection-result.v1',
          draft_id: request.draft_id,
          project_id: PROJECT_ID,
          rejected: true,
          pending_draft_released: true,
          conversation_event_admission: 'sqlite_recorded',
        };
      },
      async cancel(request) {
        return { request_id: request.request_id, cancelled: true };
      },
      async steer(request) {
        return { request_id: request.request_id, steered: true };
      },
      async queueFollowup(request) {
        return {
          request_id: request.request_id,
          queued: true,
          queued_followup: {
            turn_id: 'builder-turn:123e4567-e89b-42d3-a456-426614174000',
            run_id: 'builder-run:123e4567-e89b-42d3-a456-426614174002',
            message_id: 'builder-message:123e4567-e89b-42d3-a456-426614174088',
          },
        };
      },
    },
    workspace: {
      async open(request) {
        return request.project_id === null
          ? {
            result_version: 'builder-project-selection-result.v1',
            operation: 'new_selected',
            project_id: null,
          }
          : readWire;
      },
      openLocation: openProjectLocationSelection,
      createLocalProject: createLocalProjectSelectionCancelled,
      async saveDraft() {
        return createSaveResult(draft, readWire);
      },
      async loadCurrent() {
        return readWire;
      },
      async loadRevision() {
        return { ...readWire, operation: 'revision_loaded' };
      },
      async listCurrent() {
        return { projects: [] };
      },
      async listWorkspaces() {
        return { workspaces: [] };
      },
      async listHistory() {
        return { revisions: [] };
      },
    },
  });
  const fresh = controller.getSnapshot();
  const saved = await controller.open(PROJECT_ID);
  const draftReady = await controller.generate('Add a timer.');
  return { controller, draftReady, fresh, saved };
}

async function workingProjectSnapshot(withDraft = false) {
  const readWire = await createReadWire();
  let draft = await createGenerationDraft();
  const createUnsavedWorkspaceDraft = async (
    request: NonNullable<Parameters<typeof createGenerationDraft>[0]>,
  ) => Object.freeze({
    ...await createGenerationDraft(request),
    base_revision_evidence: null,
  });
  const controller = createBuilderProjectController({
    generator: {
      async submit(request) {
        draft = await createUnsavedWorkspaceDraft(request);
        return draft;
      },
      async generate(request) {
        draft = await createUnsavedWorkspaceDraft(request);
        return draft;
      },
      async continueDraft(request) {
        draft = await createUnsavedWorkspaceDraft(
          await createBuilderGenerationRequest(request.instruction, PROJECT_ID),
        );
        return draft;
      },
      async generateApprovedPlan() {
        return draft;
      },
      async proposePlan() {
        return null;
      },
      async preparePlanSourceReadApproval() {
        return PLAN_SOURCE_READ_READY;
      },
      async approvePlanSourceRead() {
        return PLAN_SOURCE_READ_APPROVED;
      },
      async prepareCurrentProjectWriteApproval() {
        return {
          result_version: 'builder-current-project-write-approval-status.v1',
          project_id: PROJECT_ID,
          state: 'ready',
          approval_scope: 'current_project_write',
          authority: 'main_selected_project_project_edit_v1',
        };
      },
      async approveCurrentProjectWrite() {
        return {
          result_version: 'builder-current-project-write-approval-result.v1',
          project_id: PROJECT_ID,
          operation: 'already_approved',
          approval_scope: 'current_project_write',
          authority: 'main_selected_project_project_edit_v1',
        };
      },
      async retry(request) {
        draft = await createUnsavedWorkspaceDraft(request);
        return draft;
      },
      async answer(request) {
        return createGenerationAnswer(request);
      },
      async answerDraft(request) {
        return createGenerationAnswer(
          await createBuilderGenerationRequest(request.instruction, PROJECT_ID),
        );
      },
      async restoreDraft() {
        return draft;
      },
      async restoreRevisionAsDraft() {
        return draft;
      },
      async rejectDraft(request) {
        return {
          result_version: 'builder-generation-draft-rejection-result.v1',
          draft_id: request.draft_id,
          project_id: PROJECT_ID,
          rejected: true,
          pending_draft_released: true,
          conversation_event_admission: 'sqlite_recorded',
        };
      },
      async cancel(request) {
        return { request_id: request.request_id, cancelled: true };
      },
      async steer(request) {
        return { request_id: request.request_id, steered: true };
      },
      async queueFollowup(request) {
        return {
          request_id: request.request_id,
          queued: true,
          queued_followup: {
            turn_id: 'builder-turn:123e4567-e89b-42d3-a456-426614174000',
            run_id: 'builder-run:123e4567-e89b-42d3-a456-426614174002',
            message_id: 'builder-message:123e4567-e89b-42d3-a456-426614174088',
          },
        };
      },
    },
    workspace: {
      async open(request) {
        return request.project_id === null
          ? {
            result_version: 'builder-project-selection-result.v1',
            operation: 'new_selected',
            project_id: null,
          }
          : readWire;
      },
      openLocation: openProjectLocationSelection,
      createLocalProject: createLocalProjectSelection,
      async saveDraft() {
        return createSaveResult(draft, readWire);
      },
      async loadCurrent() {
        return readWire;
      },
      async loadRevision() {
        return { ...readWire, operation: 'revision_loaded' };
      },
      async listCurrent() {
        return { projects: [] };
      },
      async listWorkspaces() {
        return { workspaces: [] };
      },
      async listHistory() {
        return { revisions: [] };
      },
    },
  });
  const working = await controller.createLocalProject('Unsaved dashboard');
  return withDraft ? controller.generate('Add a timer.') : working;
}

function taskStreamPort(read: Parameters<typeof createBuilderConversationController>[0]['read']) {
  return {
    read,
    subscribeChanged: () => () => undefined,
  };
}

function readyReviewStateProjection(changedFileCount = 2) {
  return {
    projection_version: 'builder-review-state-projection.v1',
    draft_id: DRAFT_ID,
    status: 'ready',
    label: 'Ready to review',
    summary: 'You chose to save this recoverable draft without running a project check.',
    checkpoint_status: 'ready',
    preview_status: 'not_recorded',
    check_status: 'skipped',
    changed_file_count: changedFileCount,
    can_save: true,
    can_discard: true,
    blocking_reasons: [],
    authority: {
      projection_authority: 'main_owned_review_state_projection_v1',
      candidate_evidence: 'sqlite_conversation_replay_current_unreviewed_candidate',
      checkpoint_evidence: 'verified_latest_candidate_checkpoint',
      check_evidence: 'verified_explicit_skip_decision',
      renderer_authority: 'not_present',
      ipc_authority: 'projection_only',
      provider_dispatch: false,
      tool_dispatch: false,
      source_read: 'not_present',
      source_write: 'not_present',
      git_write: false,
      sqlite_write: false,
      permission_grant: false,
      revision_admission: 'not_created',
      save_authority: false,
      publication: false,
    },
  } as const;
}

function blockedReviewStateProjection() {
  return {
    ...readyReviewStateProjection(),
    status: 'blocked',
    label: 'Review not ready',
    summary: 'Waiting for a verified draft checkpoint before saving.',
    checkpoint_status: 'missing',
    changed_file_count: null,
    can_save: false,
    blocking_reasons: ['checkpoint_missing'],
    authority: {
      ...readyReviewStateProjection().authority,
      checkpoint_evidence: 'missing_or_unverified',
      check_evidence: 'verified_explicit_skip_decision',
    },
  } as const;
}

function failedCheckReviewStateProjection() {
  return {
    ...readyReviewStateProjection(),
    status: 'blocked',
    label: 'Review not ready',
    summary: 'The latest project check failed. Review it before saving.',
    check_status: 'failed',
    can_save: false,
    blocking_reasons: ['check_failed'],
    authority: {
      ...readyReviewStateProjection().authority,
      check_evidence: 'verified_current_candidate_check_projection',
    },
  } as const;
}

async function candidateActivity(rejected = false) {
  const controller = createBuilderConversationController(taskStreamPort(
    async () => (rejected ? createRejectedTaskStreamWire() : {
      ...createTaskStreamWire(),
      review_state_projection: readyReviewStateProjection(),
    }),
  ));
  return controller.load(PROJECT_ID, TASK_ADDRESS_ID);
}

async function candidateCheckpointActivity() {
  const wire = createTaskStreamWire();
  const controller = createBuilderConversationController(taskStreamPort(async () => ({
    ...wire,
    conversation: {
      ...wire.conversation,
      head_sequence: 6,
      window: { ...wire.conversation.window, last_sequence: 6 },
      items: [
        wire.conversation.items[0],
        wire.conversation.items[1],
        {
          item_kind: 'run_context_snapshot_recorded',
          sequence: 3,
          turn_id: TURN_ID,
          run_id: RUN_ID,
          task_id: TASK_ID,
          context: {
            recorded_state: 'recorded',
            route: 'build',
            dispatch: 'build',
            downgraded_from: null,
            downgrade_reason: null,
            brief: 'not_available',
            base: 'new_project_or_unsaved',
            permission_result: 'allowed',
            command_execution: 'not_included',
            network_access: 'not_included',
          },
        },
        {
          item_kind: 'checkpoint_recorded',
          sequence: 4,
          turn_id: TURN_ID,
          run_id: RUN_ID,
          status: 'updated',
          changed_file_count: 2,
          verification_status: 'candidate_verified',
        },
        { ...wire.conversation.items[2], sequence: 5 },
        { ...wire.conversation.items[3], sequence: 6 },
      ],
    },
    draft_checkpoint_status_projection: {
      projection_version: 'builder-draft-checkpoint-status-projection.v1',
      status: 'ready',
      label: 'Checkpoint saved',
      tone: 'success',
      next_action_hint: 'You can compare, restore, continue, or save a version.',
      can_compare: true,
      can_restore: true,
      can_save_version: true,
      changed_file_count: 2,
      verification_status: 'candidate_verified',
      authority: {
        projection_authority: 'main_owned_draft_checkpoint_status_projection_v1',
        checkpoint_store_read: 'verified_latest_read_result',
        checkpoint_fact: 'verified_not_exposed',
        renderer_authority: 'not_present',
        ipc_authority: 'not_present',
        provider_dispatch: false,
        tool_dispatch: false,
        source_read: 'not_present',
        source_write: 'not_present',
        git_read: 'not_present',
        git_write: false,
        sqlite_write: false,
        permission_grant: false,
        revision_admission: 'not_created',
        save_authority: false,
        publication: false,
      },
    },
    draft_checkpoint_timeline_projection: {
      projection_version: 'builder-draft-checkpoint-timeline-projection.v1',
      status: 'ready',
      entries: [
        {
          checkpoint_sequence: 3,
          created_at_ms: 30_000,
          label: 'Automatic checkpoint',
          changed_file_count: 2,
          verification_status: 'candidate_verified',
          is_current: true,
        },
        {
          checkpoint_sequence: 2,
          created_at_ms: 20_000,
          label: 'Automatic checkpoint',
          changed_file_count: 1,
          verification_status: 'candidate_verified_with_warnings',
          is_current: false,
        },
        {
          checkpoint_sequence: 1,
          created_at_ms: 10_000,
          label: 'Automatic checkpoint',
          changed_file_count: 1,
          verification_status: 'candidate_verified',
          is_current: false,
        },
      ],
      truncated: false,
      authority: {
        projection_authority: 'main_owned_draft_checkpoint_timeline_projection_v1',
        checkpoint_store_read: 'verified_task_checkpoint_list',
        checkpoint_facts: 'bounded_safe_projection',
        renderer_authority: 'not_present',
        ipc_authority: 'not_present',
        provider_dispatch: false,
        tool_dispatch: false,
        source_read: 'not_present',
        source_write: 'not_present',
        git_read: 'not_present',
        git_write: false,
        sqlite_write: false,
        restore_authority: false,
        revision_admission: 'not_created',
        save_authority: false,
        publication: false,
      },
    },
    review_state_projection: readyReviewStateProjection(),
  })));
  return controller.load(PROJECT_ID, TASK_ADDRESS_ID);
}

async function candidateBlockedReviewActivity() {
  const controller = createBuilderConversationController(taskStreamPort(async () => ({
    ...createTaskStreamWire(),
    review_state_projection: blockedReviewStateProjection(),
  })));
  return controller.load(PROJECT_ID, TASK_ADDRESS_ID);
}

async function candidateFailedCheckActivity() {
  const controller = createBuilderConversationController(taskStreamPort(async () => ({
    ...createTaskStreamWire(),
    review_state_projection: failedCheckReviewStateProjection(),
  })));
  return controller.load(PROJECT_ID, TASK_ADDRESS_ID);
}

async function candidateRunningCheckActivity() {
  const wire = createTaskStreamWire();
  const controller = createBuilderConversationController(taskStreamPort(async () => ({
    ...wire,
    review_state_projection: readyReviewStateProjection(),
    agent_activity_projection: {
      projection_version: 'builder-agent-activity-projection.v1',
      project_id: PROJECT_ID,
      conversation_id: CONVERSATION_ID,
      head_sequence: wire.conversation.head_sequence,
      current: {
        phase: 'running_checks',
        status: 'active',
        label: 'Running checks',
        summary: 'Checking the current draft before it is saved.',
        turn_id: TURN_ID,
        run_id: RUN_ID,
      },
      authority: {
        projection_authority: 'main_owned_agent_activity_projection_v1',
        fact_source: 'recorded_activity_and_review',
        consumer_role: 'read_only',
        side_effect_authority: 'none',
      },
    },
  })));
  return controller.load(PROJECT_ID, TASK_ADDRESS_ID);
}

async function absentActivity() {
  const controller = createBuilderConversationController(taskStreamPort(
    async () => ({
      stream_version: 'builder-task-stream-read-result.v1',
      project_id: PROJECT_ID,
      conversation: null,
      authority: {
        conversation: 'sqlite_canonical_event_replay_or_absent',
        project_source: 'not_included',
        candidate_source: 'not_loaded',
        project_revision: 'not_inferred',
      },
    }),
  ));
  return controller.load(PROJECT_ID, TASK_ADDRESS_ID);
}

function loadingActivity() {
  const controller = createBuilderConversationController(taskStreamPort(
    async () => new Promise(() => undefined),
  ));
  void controller.load(PROJECT_ID, TASK_ADDRESS_ID);
  return controller.getSnapshot();
}

async function unavailableActivity() {
  const controller = createBuilderConversationController(taskStreamPort(
    async () => {
      throw new Error('private');
    },
  ));
  return controller.load(PROJECT_ID, TASK_ADDRESS_ID);
}

async function staleActivity() {
  let fail = false;
  const controller = createBuilderConversationController(taskStreamPort(
    async () => {
      if (fail) throw new Error('private');
      return {
        stream_version: 'builder-task-stream-read-result.v1',
        project_id: PROJECT_ID,
        conversation: null,
        authority: {
          conversation: 'sqlite_canonical_event_replay_or_absent',
          project_source: 'not_included',
          candidate_source: 'not_loaded',
          project_revision: 'not_inferred',
        },
      };
    },
  ));
  await controller.load(PROJECT_ID, TASK_ADDRESS_ID);
  fail = true;
  return controller.refresh();
}

async function answerActivity() {
  const controller = createBuilderConversationController(taskStreamPort(async () => createAnswerTaskStreamWire()));
  return controller.load(PROJECT_ID, TASK_ADDRESS_ID);
}

async function transcriptRestoredActivity() {
  const controller = createBuilderConversationController(taskStreamPort(async () => ({
    stream_version: 'builder-task-stream-read-result.v1',
    project_id: PROJECT_ID,
    conversation: {
      conversation_id: CONVERSATION_ID,
      created_at_ms: 1_234,
      head_sequence: 2,
      recorded_active_turn_id: null,
      source: 'sqlite_derived_public_transcript',
      recovery: {
        recovery_kind: 'transcript_restored',
        latest_source_sequence: 4,
        authority: 'sqlite_derived_non_authoritative_transcript',
      },
      window: {
        first_sequence: 1,
        last_sequence: 2,
        has_earlier: false,
      },
      items: [
        {
          item_kind: 'transcript_message',
          sequence: 1,
          turn_id: TURN_ID,
          message: {
            message_id: 'builder-message:123e4567-e89b-42d3-a456-426614174010',
            text: 'What did we change?',
          },
          role: 'user',
          message_kind: 'submitted',
          recovery_admission: 'sqlite_derived_public_transcript_only',
        },
        {
          item_kind: 'transcript_message',
          sequence: 2,
          turn_id: TURN_ID,
          message: {
            message_id: 'builder-message:123e4567-e89b-42d3-a456-426614174011',
            text: 'We restored public chat history.',
          },
          role: 'assistant',
          message_kind: 'run_result',
          recovery_admission: 'sqlite_derived_public_transcript_only',
        },
      ],
    },
    authority: {
      conversation: 'sqlite_derived_public_transcript_restore',
      project_source: 'not_included',
      candidate_source: 'not_loaded',
      project_revision: 'not_inferred',
    },
  })));
  return controller.load(PROJECT_ID, TASK_ADDRESS_ID);
}

async function briefActivity() {
  const wire = createAnswerTaskStreamWire();
  const controller = createBuilderConversationController(taskStreamPort(async () => ({
    ...wire,
    conversation: {
      ...wire.conversation,
      head_sequence: 5,
      window: {
        ...wire.conversation.window,
        last_sequence: 5,
      },
      items: [
        wire.conversation.items[0],
        wire.conversation.items[1],
        wire.conversation.items[2],
        {
          item_kind: 'task_brief_updated',
          sequence: 4,
          turn_id: TURN_ID,
          run_id: RUN_ID,
          task: {
            task_id: TASK_ID,
            title: 'Current project brief',
          },
          brief: {
            status: 'ready',
            summary: 'Use a starfield hero, compact project cards, and a calm tool-like layout.',
            contextual_build_ready: true,
          },
          recorded_state: 'updated',
        },
        {
          ...wire.conversation.items[3],
          sequence: 5,
        },
      ],
    },
  })));
  return controller.load(PROJECT_ID, TASK_ADDRESS_ID);
}

async function progressActivity() {
  const wire = createProgressTaskStreamWire();
  const controller = createBuilderConversationController(taskStreamPort(async () => ({
    ...wire,
    agent_activity_projection: {
      projection_version: 'builder-agent-activity-projection.v1',
      project_id: PROJECT_ID,
      conversation_id: CONVERSATION_ID,
      head_sequence: wire.conversation.head_sequence,
      current: {
        phase: 'preparing_review',
        status: 'active',
        label: 'Preparing review',
        summary: 'Checking and organizing the result for review.',
        turn_id: TURN_ID,
        run_id: RUN_ID,
      },
      authority: {
        projection_authority: 'main_owned_agent_activity_projection_v1',
        fact_source: 'recorded_activity',
        consumer_role: 'read_only',
        side_effect_authority: 'none',
      },
    },
  })));
  return controller.load(PROJECT_ID, TASK_ADDRESS_ID);
}

async function queuedFollowupActivity() {
  const wire = createProgressTaskStreamWire();
  const controller = createBuilderConversationController(taskStreamPort(async () => ({
    ...wire,
    conversation: {
      ...wire.conversation,
      head_sequence: 7,
      window: {
        ...wire.conversation.window,
        last_sequence: 7,
      },
      items: [
        ...wire.conversation.items,
        {
          item_kind: 'user_message',
          sequence: 7,
          turn_id: TURN_ID,
          message: {
            message_id: 'builder-message:123e4567-e89b-42d3-a456-426614174088',
            text: 'After this, make the summary shorter.',
          },
          message_kind: 'queued_followup',
          mode: null,
          task: null,
        },
      ],
    },
  })));
  return controller.load(PROJECT_ID, TASK_ADDRESS_ID);
}

async function consumedQueuedFollowupActivity() {
  const wire = createTaskStreamWire();
  const queuedMessageId = 'builder-message:123e4567-e89b-42d3-a456-426614174088';
  const consumingTurnId = 'builder-turn:123e4567-e89b-42d3-a456-426614174089';
  const consumingMessageId = 'builder-message:123e4567-e89b-42d3-a456-426614174090';
  const controller = createBuilderConversationController(taskStreamPort(async () => ({
    ...wire,
    conversation: {
      ...wire.conversation,
      head_sequence: 7,
      recorded_active_turn_id: consumingTurnId,
      window: {
        ...wire.conversation.window,
        last_sequence: 7,
      },
      items: [
        wire.conversation.items[0],
        wire.conversation.items[1],
        {
          item_kind: 'user_message',
          sequence: 3,
          turn_id: TURN_ID,
          message: {
            message_id: queuedMessageId,
            text: 'After this, make the summary shorter.',
          },
          message_kind: 'queued_followup',
          mode: null,
          task: null,
        },
        {
          ...wire.conversation.items[2],
          sequence: 4,
        },
        {
          ...wire.conversation.items[3],
          sequence: 5,
        },
        {
          item_kind: 'user_message',
          sequence: 6,
          turn_id: consumingTurnId,
          message: {
            message_id: consumingMessageId,
            text: 'After this, make the summary shorter.',
          },
          message_kind: 'submitted',
          mode: 'work',
          task: {
            task_id: 'builder-task:123e4567-e89b-42d3-a456-426614174091',
            title: 'Shorten summary',
          },
        },
        {
          item_kind: 'queued_followup_consumed',
          sequence: 7,
          turn_id: TURN_ID,
          run_id: RUN_ID,
          message_id: queuedMessageId,
          consumed_by: {
            turn_id: consumingTurnId,
            message_id: consumingMessageId,
          },
          recorded_state: 'consumed',
        },
      ],
    },
  })));
  return controller.load(PROJECT_ID, TASK_ADDRESS_ID);
}

async function agentStepProgressActivity() {
  const wire = createTaskStreamWire();
  const controller = createBuilderConversationController(taskStreamPort(async () => ({
    ...wire,
    conversation: {
      ...wire.conversation,
      head_sequence: 6,
      window: {
        ...wire.conversation.window,
        last_sequence: 6,
      },
      items: [
        wire.conversation.items[0],
        wire.conversation.items[1],
        {
          item_kind: 'agent_step_progress_recorded' as const,
          sequence: 3,
          turn_id: TURN_ID,
          run_id: RUN_ID,
          task_id: TASK_ID,
          step_id: 'builder-run-step:123e4567-e89b-42d3-a456-426614174030',
          step_index: 30,
          recorded_state: 'start_recorded' as const,
          result: null,
          summary: {
            status: 'started' as const,
            display_summary: 'Agent step start was recorded.',
          },
          lifecycle: {
            conversation_admission: 'verified_public_progress' as const,
            raw_output_admission: 'not_included' as const,
            revision_admission: 'not_created' as const,
          },
        },
        {
          item_kind: 'agent_step_progress_recorded' as const,
          sequence: 4,
          turn_id: TURN_ID,
          run_id: RUN_ID,
          task_id: TASK_ID,
          step_id: 'builder-run-step:123e4567-e89b-42d3-a456-426614174030',
          step_index: 30,
          recorded_state: 'result_recorded' as const,
          result: {
            status: 'succeeded' as const,
            summary_code: 'agent_step_completed_without_raw_output' as const,
            display_summary: 'Agent step completed. Details were not kept.',
          },
          summary: {
            status: 'succeeded' as const,
            display_summary: 'Agent step completed. Details were not kept.',
          },
          lifecycle: {
            conversation_admission: 'verified_public_progress' as const,
            raw_output_admission: 'not_included' as const,
            revision_admission: 'not_created' as const,
          },
        },
        {
          ...wire.conversation.items[2],
          sequence: 5,
        },
        {
          ...wire.conversation.items[3],
          sequence: 6,
        },
      ],
    },
  })));
  return controller.load(PROJECT_ID, TASK_ADDRESS_ID);
}

async function candidateProgressActivity() {
  const wire = createTaskStreamWire();
  const progressStages = [
    'context_ready',
    'provider_request_started',
    'provider_response_received',
    'result_preparing',
  ] as const;
  const controller = createBuilderConversationController(taskStreamPort(async () => ({
    ...wire,
    review_state_projection: readyReviewStateProjection(),
    conversation: {
      ...wire.conversation,
      head_sequence: 8,
      window: {
        ...wire.conversation.window,
        last_sequence: 8,
      },
      items: [
        wire.conversation.items[0],
        wire.conversation.items[1],
        ...progressStages.map((stage, index) => ({
          item_kind: 'run_progress_recorded' as const,
          sequence: index + 3,
          turn_id: TURN_ID,
          run_id: RUN_ID,
          stage,
          recorded_state: 'recorded' as const,
        })),
        {
          ...wire.conversation.items[2],
          sequence: 7,
        },
        {
          ...wire.conversation.items[3],
          sequence: 8,
        },
      ],
    },
  })));
  return controller.load(PROJECT_ID, TASK_ADDRESS_ID);
}

async function failedRunActivity(terminalStatus: 'failed' | 'interrupted' = 'failed') {
  const progressStages = [
    'context_ready',
    'provider_request_started',
    'provider_response_received',
  ] as const;
  const controller = createBuilderConversationController(taskStreamPort(async () => ({
    stream_version: 'builder-task-stream-read-result.v1',
    project_id: PROJECT_ID,
    conversation: {
      conversation_id: CONVERSATION_ID,
      created_at_ms: 1234,
      head_sequence: terminalStatus === 'interrupted' ? 8 : 7,
      recorded_active_turn_id: null,
      window: {
        first_sequence: 1,
        last_sequence: terminalStatus === 'interrupted' ? 8 : 7,
        has_earlier: false,
      },
      items: [
        {
          item_kind: 'user_message',
          sequence: 1,
          turn_id: TURN_ID,
          message: {
            message_id: 'builder-message:123e4567-e89b-42d3-a456-426614174000',
            text: 'Build a static blog page.',
          },
          message_kind: 'submitted',
          mode: 'work',
          task: {
            task_id: TASK_ID,
            title: 'Build static blog',
          },
        },
        {
          item_kind: 'run_started',
          sequence: 2,
          turn_id: TURN_ID,
          run_id: RUN_ID,
          task_id: TASK_ID,
          attempt_number: 1,
          retry_of_run_id: null,
          recorded_state: 'started',
        },
        ...progressStages.map((stage, index) => ({
          item_kind: 'run_progress_recorded' as const,
          sequence: index + 3,
          turn_id: TURN_ID,
          run_id: RUN_ID,
          stage,
          recorded_state: 'recorded' as const,
        })),
        ...(terminalStatus === 'interrupted' ? [{
          item_kind: 'run_control_requested', sequence: 6, turn_id: TURN_ID,
          run_id: RUN_ID, action: 'interrupt',
        }] : []),
        {
          item_kind: 'run_completed',
          sequence: terminalStatus === 'interrupted' ? 7 : 6,
          turn_id: TURN_ID,
          run_id: RUN_ID,
          terminal_status: terminalStatus,
          result_kind: 'failure',
          failure_phase: terminalStatus === 'interrupted' ? 'not_applicable' : 'provider_response_received',
          assistant_message: terminalStatus === 'interrupted' ? null : {
            message_id: 'builder-message:223e4567-e89b-42d3-a456-426614174000',
            text: 'The draft could not be prepared for review.',
          },
          candidate: null,
        },
        {
          item_kind: 'turn_completed',
          sequence: terminalStatus === 'interrupted' ? 8 : 7,
          turn_id: TURN_ID,
          run_id: RUN_ID,
          outcome: terminalStatus,
        },
      ],
    },
    authority: {
      conversation: 'sqlite_canonical_event_replay_or_absent',
      project_source: 'not_included',
      candidate_source: 'not_loaded',
      project_revision: 'not_inferred',
    },
  })));
  return controller.load(PROJECT_ID, TASK_ADDRESS_ID);
}

async function refreshingActivityWithVisibleEntries() {
  let resolveRefresh!: (value: unknown) => void;
  let reads = 0;
  const controller = createBuilderConversationController(taskStreamPort(async () => {
    reads += 1;
    if (reads === 1) return createTaskStreamWire();
    return new Promise<unknown>((resolve) => {
      resolveRefresh = resolve;
    });
  }));
  await controller.load(PROJECT_ID, TASK_ADDRESS_ID);
  void controller.refresh();
  await Promise.resolve();
  const snapshot = controller.getSnapshot();
  resolveRefresh(createTaskStreamWire());
  return snapshot;
}

async function toolActivity(
  result: Readonly<{
    status: 'succeeded' | 'failed' | 'cancelled';
    summary_code: string;
    display_summary: string;
  }> = {
    status: 'succeeded',
    summary_code: 'completed_without_raw_output',
    display_summary: 'This step completed. Details were not kept.',
  },
  options: Readonly<{
    action?: 'filesystem.read' | 'project.read';
    completed?: boolean;
    context?: Readonly<Partial<{
      route: 'answer' | 'clarify' | 'update_brief' | 'plan' | 'build';
      dispatch: 'reply' | 'brief_update' | 'plan' | 'build' | 'ask_workspace' | 'ask_permission' | 'blocked';
      downgraded_from: 'answer' | 'clarify' | 'update_brief' | 'plan' | 'build' | null;
      downgrade_reason: 'ambiguous_build_intent' | 'missing_prior_build_context' | 'workspace_required' | null;
      brief: 'available' | 'not_available';
      base: 'new_project_or_unsaved' | 'project_revision';
      permission_result: 'not_required' | 'allowed' | 'ask' | 'denied';
    }>>;
    resourceKind?: 'filesystem' | 'project';
    toolLabel?: string;
  }> = {},
) {
  const action = options.action ?? 'project.read';
  const resourceKind = options.resourceKind ?? 'project';
  const toolLabel = options.toolLabel ?? 'Read project context';
  const completed = options.completed ?? true;
  const controller = createBuilderConversationController(taskStreamPort(async () => ({
    stream_version: 'builder-task-stream-read-result.v1',
    project_id: PROJECT_ID,
    conversation: {
      conversation_id: CONVERSATION_ID,
      created_at_ms: 1234,
      head_sequence: completed ? 7 : 5,
      recorded_active_turn_id: completed ? null : TURN_ID,
      window: {
        first_sequence: 1,
        last_sequence: completed ? 7 : 5,
        has_earlier: false,
      },
      items: [
        {
          item_kind: 'user_message',
          sequence: 1,
          turn_id: TURN_ID,
          message: {
            message_id: 'builder-message:323e4567-e89b-42d3-a456-426614174000',
            text: 'Read the current project before planning a change.',
          },
          message_kind: 'submitted',
          mode: 'work',
          task: {
            task_id: TASK_ID,
            title: 'Read project context',
          },
        },
        {
          item_kind: 'run_started',
          sequence: 2,
          turn_id: TURN_ID,
          run_id: RUN_ID,
          task_id: TASK_ID,
          attempt_number: 1,
          retry_of_run_id: null,
          recorded_state: 'started',
        },
        {
          item_kind: 'run_context_snapshot_recorded',
          sequence: 3,
          turn_id: TURN_ID,
          run_id: RUN_ID,
          task_id: TASK_ID,
          context: {
            recorded_state: 'recorded',
            route: 'build',
            dispatch: 'build',
            downgraded_from: null,
            downgrade_reason: null,
            brief: 'available',
            base: 'project_revision',
            permission_result: 'allowed',
            command_execution: 'not_included',
            network_access: 'not_included',
            ...options.context,
          },
        },
        {
          item_kind: 'tool_call_requested',
          sequence: 4,
          turn_id: TURN_ID,
          run_id: RUN_ID,
          step_id: 'builder-run-step:123e4567-e89b-42d3-a456-426614174000',
          tool_call_id: 'builder-tool-call:123e4567-e89b-42d3-a456-426614174000',
          tool_label: toolLabel,
          action,
          resource: {
            resource_kind: resourceKind,
          },
          lifecycle: {
            permission_admission: 'verified_allowed',
            dispatch_admission: 'not_started',
            execution_admission: 'not_performed',
            result_admission: 'not_recorded',
          },
          recorded_state: 'requested',
        },
        {
          item_kind: 'tool_call_result_recorded',
          sequence: 5,
          turn_id: TURN_ID,
          run_id: RUN_ID,
          step_id: 'builder-run-step:123e4567-e89b-42d3-a456-426614174000',
          tool_call_id: 'builder-tool-call:123e4567-e89b-42d3-a456-426614174000',
          tool_label: toolLabel,
          action,
          resource: {
            resource_kind: resourceKind,
          },
          result: {
            status: result.status,
            summary_code: result.summary_code,
            display_summary: result.display_summary,
          },
          lifecycle: {
            result_admission: 'fixed_summary_code_recorded',
            raw_output_admission: 'not_included',
            revision_admission: 'not_created',
          },
          recorded_state: 'recorded',
        },
        ...(completed ? [{
          item_kind: 'run_completed',
          sequence: 6,
          turn_id: TURN_ID,
          run_id: RUN_ID,
          terminal_status: 'succeeded',
          result_kind: 'candidate',
          failure_phase: 'not_applicable',
          assistant_message: {
            message_id: 'builder-message:423e4567-e89b-42d3-a456-426614174000',
            text: 'I prepared a draft after reading the project context.',
          },
          candidate: {
            draft_id: DRAFT_ID,
            title: 'Context-aware draft',
            summary: 'The draft uses the current project context.',
            candidate_state: 'proposed',
            source_availability: 'not_loaded',
            workspace_materialization: { status: 'materialized' },
          },
        } as const,
        {
          item_kind: 'turn_completed',
          sequence: 7,
          turn_id: TURN_ID,
          run_id: RUN_ID,
          outcome: 'candidate_ready',
        } as const] : []),
      ],
    },
    authority: {
      conversation: 'sqlite_canonical_event_replay_or_absent',
      project_source: 'not_included',
      candidate_source: 'not_loaded',
      project_revision: 'not_inferred',
    },
  })));
  return controller.load(PROJECT_ID, TASK_ADDRESS_ID);
}

async function pendingToolActivity(options: Readonly<{ reviewReady?: boolean }> = {}) {
  const controller = createBuilderConversationController(taskStreamPort(async () => ({
    stream_version: 'builder-task-stream-read-result.v1',
    project_id: PROJECT_ID,
    ...(options.reviewReady === true
      ? { review_state_projection: readyReviewStateProjection() }
      : {}),
    conversation: {
      conversation_id: CONVERSATION_ID,
      created_at_ms: 1234,
      head_sequence: 3,
      recorded_active_turn_id: TURN_ID,
      window: {
        first_sequence: 1,
        last_sequence: 3,
        has_earlier: false,
      },
      items: [
        {
          item_kind: 'user_message',
          sequence: 1,
          turn_id: TURN_ID,
          message: {
            message_id: 'builder-message:323e4567-e89b-42d3-a456-426614174000',
            text: 'Read the current project before planning a change.',
          },
          message_kind: 'submitted',
          mode: 'work',
          task: {
            task_id: TASK_ID,
            title: 'Read project context',
          },
        },
        {
          item_kind: 'run_started',
          sequence: 2,
          turn_id: TURN_ID,
          run_id: RUN_ID,
          task_id: TASK_ID,
          attempt_number: 1,
          retry_of_run_id: null,
          recorded_state: 'started',
        },
        {
          item_kind: 'tool_call_requested',
          sequence: 3,
          turn_id: TURN_ID,
          run_id: RUN_ID,
          step_id: 'builder-run-step:123e4567-e89b-42d3-a456-426614174000',
          tool_call_id: 'builder-tool-call:123e4567-e89b-42d3-a456-426614174000',
          tool_label: 'Read project context',
          action: 'project.read',
          resource: {
            resource_kind: 'project',
          },
          lifecycle: {
            permission_admission: 'verified_allowed',
            dispatch_admission: 'not_started',
            execution_admission: 'not_performed',
            result_admission: 'not_recorded',
          },
          recorded_state: 'requested',
        },
      ],
    },
    authority: {
      conversation: 'sqlite_canonical_event_replay_or_absent',
      project_source: 'not_included',
      candidate_source: 'not_loaded',
      project_revision: 'not_inferred',
    },
  })));
  return controller.load(PROJECT_ID, TASK_ADDRESS_ID);
}

async function acceptedCandidateActivity() {
  const controller = createBuilderConversationController(taskStreamPort(async () => createAcceptedTaskStreamWire(1)));
  return controller.load(PROJECT_ID, TASK_ADDRESS_ID);
}

async function planReviewActivity(decision: 'approved' | 'rejected' = 'approved') {
  const controller = createBuilderConversationController(taskStreamPort(
    async () => createPlanReviewTaskStreamWire(decision),
  ));
  return controller.load(PROJECT_ID, TASK_ADDRESS_ID);
}

async function pendingPlanActivity() {
  const controller = createBuilderConversationController(taskStreamPort(async () => createPlanTaskStreamWire()));
  return controller.load(PROJECT_ID, TASK_ADDRESS_ID);
}

async function savedHistory() {
  const controller = createBuilderProjectHistoryController({
    listHistory: async () => createHistoryWire(PROJECT_ID, 1),
  });
  return controller.load(PROJECT_ID);
}

type ReadWire = Awaited<ReturnType<typeof createReadWire>>;
type SourceTree = Awaited<ReturnType<typeof createSourceTree>>;

async function readWireAsRevision(
  wire: ReadWire,
  revisionNumber: number,
  previousRevisionReceiptDigest: string | null,
): Promise<ReadWire> {
  const unsignedReceipt = {
    ...wire.product_revision_receipt,
    revision_number: revisionNumber,
    previous_revision_receipt_digest: previousRevisionReceiptDigest,
  };
  const receiptBody = { ...unsignedReceipt };
  delete (receiptBody as { revision_receipt_digest?: string }).revision_receipt_digest;
  const revisionReceiptDigest = await digest(receiptBody);
  return {
    ...wire,
    product_revision_receipt: {
      ...unsignedReceipt,
      revision_receipt_digest: revisionReceiptDigest,
    },
    current: {
      ...wire.current,
      revision_number: revisionNumber,
      revision_receipt_digest: revisionReceiptDigest,
    },
  } as unknown as ReadWire;
}

async function changedDraftSnapshot() {
  const baseTree = await createSourceTree([
    { path: 'index.html', content: '<main>Old</main>\n' },
    { path: 'styles.css', content: 'main { color: black; }\n' },
    { path: 'src/remove.ts', content: 'const removed = true;\n' },
  ]);
  const draftTree = await createSourceTree([
    { path: 'index.html', content: '<main>New</main>\n<section>Detail</section>\n' },
    { path: 'styles.css', content: 'main { color: black; }\n' },
    { path: 'src/add.ts', content: 'const added = true;\n' },
  ]);
  return draftSnapshotFromSourceTrees(baseTree, draftTree);
}

async function trustedCatalogSnapshot(
  projects: 'empty' | 'saved' = 'saved',
  workspaceProjects: readonly unknown[] = [],
) {
  const wire = await createCatalogWire();
  const catalog = createBuilderProjectCatalogController({
    listCurrent: async () => ({
      ...wire,
      projects: projects === 'empty'
        ? []
        : wire.projects.map((project) => ({
          ...project,
          title: 'Saved dashboard',
          summary: 'A local project dashboard.',
          revision_number: 2,
        })),
    }),
    listWorkspaces: async () => createWorkspaceCatalogWire(workspaceProjects),
  });
  return catalog.load();
}

async function draftSnapshotFromSourceTrees(baseTree: SourceTree, draftTree: SourceTree) {
  const readWire = await createReadWire(baseTree);
  const request = await createBuilderGenerationRequest('Update the saved project.', PROJECT_ID);
  const rawDraft = await createGenerationDraft(request, draftTree);
  const draft = {
    ...rawDraft,
    base_revision_evidence: {
      ...rawDraft.base_revision_evidence!,
      revision_receipt_digest: readWire.product_revision_receipt.revision_receipt_digest,
      commit_oid: readWire.product_revision_receipt.commit_oid,
      source_tree_digest: baseTree.source_tree_digest,
    },
  };
  const controller = createBuilderProjectController({
    generator: {
      async submit() {
        return draft;
      },
      async generate() {
        return draft;
      },
      async continueDraft() {
        return draft;
      },
      async generateApprovedPlan() {
        return draft;
      },
      async proposePlan() {
        return null;
      },
      async preparePlanSourceReadApproval() {
        return PLAN_SOURCE_READ_READY;
      },
      async approvePlanSourceRead() {
        return PLAN_SOURCE_READ_APPROVED;
      },
      async prepareCurrentProjectWriteApproval() {
        return {
          result_version: 'builder-current-project-write-approval-status.v1',
          project_id: PROJECT_ID,
          state: 'ready',
          approval_scope: 'current_project_write',
          authority: 'main_selected_project_project_edit_v1',
        };
      },
      async approveCurrentProjectWrite() {
        return {
          result_version: 'builder-current-project-write-approval-result.v1',
          project_id: PROJECT_ID,
          operation: 'already_approved',
          approval_scope: 'current_project_write',
          authority: 'main_selected_project_project_edit_v1',
        };
      },
      async retry() {
        return draft;
      },
      async answer() {
        return createGenerationAnswer(request);
      },
      async answerDraft() {
        return createGenerationAnswer(request);
      },
      async restoreDraft() {
        return draft;
      },
      async restoreRevisionAsDraft() {
        return draft;
      },
      async rejectDraft(request) {
        return {
          result_version: 'builder-generation-draft-rejection-result.v1',
          draft_id: request.draft_id,
          project_id: PROJECT_ID,
          rejected: true,
          pending_draft_released: true,
          conversation_event_admission: 'sqlite_recorded',
        };
      },
      async cancel(cancelRequest) {
        return { request_id: cancelRequest.request_id, cancelled: true };
      },
      async steer(steerRequest) {
        return { request_id: steerRequest.request_id, steered: true };
      },
      async queueFollowup(queueRequest) {
        return {
          request_id: queueRequest.request_id,
          queued: true,
          queued_followup: {
            turn_id: 'builder-turn:123e4567-e89b-42d3-a456-426614174000',
            run_id: 'builder-run:123e4567-e89b-42d3-a456-426614174002',
            message_id: 'builder-message:123e4567-e89b-42d3-a456-426614174088',
          },
        };
      },
    },
    workspace: {
      async open() {
        return readWire;
      },
      openLocation: openProjectLocationSelection,
      createLocalProject: createLocalProjectSelectionCancelled,
      async saveDraft() {
        return createSaveResult(draft, readWire);
      },
      async loadCurrent() {
        return readWire;
      },
      async loadRevision() {
        return { ...readWire, operation: 'revision_loaded' };
      },
      async listCurrent() {
        return { projects: [] };
      },
      async listWorkspaces() {
        return { workspaces: [] };
      },
      async listHistory() {
        return { revisions: [] };
      },
    },
  });
  await controller.open(PROJECT_ID);
  return controller.generate('Update the saved project.');
}

async function inspectedHistorySnapshot() {
  const currentTree = await createSourceTree([
    { path: 'index.html', content: '<main>Current</main>\n' },
  ]);
  const historicalTree = await createSourceTree([
    { path: 'index.html', content: '<main>Earlier</main>\n' },
  ]);
  const historicalWire = await createReadWire(historicalTree, 1);
  const currentWire = await readWireAsRevision(
    await createReadWire(currentTree, 1),
    2,
    historicalWire.product_revision_receipt.revision_receipt_digest,
  );
  const controller = createBuilderProjectController({
    generator: {
      async submit(request) {
        return createGenerationDraft(request, currentTree);
      },
      async generate(request) {
        return createGenerationDraft(request, currentTree);
      },
      async continueDraft(request) {
        return createGenerationDraft(
          await createBuilderGenerationRequest(request.instruction, PROJECT_ID),
          currentTree,
        );
      },
      async generateApprovedPlan() {
        return createGenerationDraft(
          await createBuilderGenerationRequest('Continue approved plan.', PROJECT_ID),
          currentTree,
        );
      },
      async proposePlan() {
        return null;
      },
      async preparePlanSourceReadApproval() {
        return PLAN_SOURCE_READ_READY;
      },
      async approvePlanSourceRead() {
        return PLAN_SOURCE_READ_APPROVED;
      },
      async prepareCurrentProjectWriteApproval() {
        return {
          result_version: 'builder-current-project-write-approval-status.v1',
          project_id: PROJECT_ID,
          state: 'ready',
          approval_scope: 'current_project_write',
          authority: 'main_selected_project_project_edit_v1',
        };
      },
      async approveCurrentProjectWrite() {
        return {
          result_version: 'builder-current-project-write-approval-result.v1',
          project_id: PROJECT_ID,
          operation: 'already_approved',
          approval_scope: 'current_project_write',
          authority: 'main_selected_project_project_edit_v1',
        };
      },
      async retry(request) {
        return createGenerationDraft(request, currentTree);
      },
      async answer(request) {
        return createGenerationAnswer(request);
      },
      async answerDraft(request) {
        return createGenerationAnswer(
          await createBuilderGenerationRequest(request.instruction, PROJECT_ID),
        );
      },
      async restoreDraft() {
        return createGenerationDraft(
          await createBuilderGenerationRequest('Restore.', PROJECT_ID),
          currentTree,
        );
      },
      async restoreRevisionAsDraft() {
        return createGenerationDraft(
          await createBuilderGenerationRequest('Restore a saved version.', PROJECT_ID),
          historicalTree,
        );
      },
      async rejectDraft(request) {
        return {
          result_version: 'builder-generation-draft-rejection-result.v1',
          draft_id: request.draft_id,
          project_id: PROJECT_ID,
          rejected: true,
          pending_draft_released: true,
          conversation_event_admission: 'sqlite_recorded',
        };
      },
      async cancel(request) {
        return { request_id: request.request_id, cancelled: true };
      },
      async steer(request) {
        return { request_id: request.request_id, steered: true };
      },
      async queueFollowup(request) {
        return {
          request_id: request.request_id,
          queued: true,
          queued_followup: {
            turn_id: 'builder-turn:123e4567-e89b-42d3-a456-426614174000',
            run_id: 'builder-run:123e4567-e89b-42d3-a456-426614174002',
            message_id: 'builder-message:123e4567-e89b-42d3-a456-426614174088',
          },
        };
      },
    },
    workspace: {
      async open() {
        return currentWire;
      },
      openLocation: openProjectLocationSelection,
      createLocalProject: createLocalProjectSelectionCancelled,
      async saveDraft() {
        throw new Error('not used');
      },
      async loadCurrent() {
        return currentWire;
      },
      async loadRevision() {
        return {
          ...historicalWire,
          current: currentWire.current,
          operation: 'revision_loaded',
        };
      },
      async listCurrent() {
        return { projects: [] };
      },
      async listWorkspaces() {
        return { workspaces: [] };
      },
      async listHistory() {
        return { revisions: [] };
      },
    },
  });
  await controller.open(PROJECT_ID);
  return controller.inspectRevision(
    PROJECT_ID,
    historicalWire.product_revision_receipt.revision_receipt_digest,
  );
}

function click(container: HTMLElement, selector: string): void {
  const button = container.querySelector<HTMLButtonElement>(selector);
  expect(button).not.toBeNull();
  act(() => button?.click());
}

async function respondingActivity() {
  const wire = createProgressTaskStreamWire();
  const controller = createBuilderConversationController(taskStreamPort(async () => ({
    ...wire,
    agent_activity_projection: {
      projection_version: 'builder-agent-activity-projection.v1',
      project_id: PROJECT_ID,
      conversation_id: CONVERSATION_ID,
      head_sequence: wire.conversation.head_sequence,
      current: {
        phase: 'responding',
        status: 'active',
        label: 'Writing response',
        summary: 'Preparing a response from the current project context.',
        turn_id: TURN_ID,
        run_id: RUN_ID,
      },
      authority: {
        projection_authority: 'main_owned_agent_activity_projection_v1',
        fact_source: 'recorded_activity',
        consumer_role: 'read_only',
        side_effect_authority: 'none',
      },
    },
  })));
  return controller.load(PROJECT_ID, TASK_ADDRESS_ID);
}

async function runtimeToolActivity(
  completed = false,
  fileTargets: readonly string[] = ['src/file-1.ts', 'src/file-2.ts'],
  statusOnly = false,
  includeCommand = true,
  statusKind: 'reasoning' | 'activity' = 'reasoning',
) {
  const stepId = 'builder-run-step:123e4567-e89b-42d3-a456-426614174000';
  const runtimeNarration = (sequence: number, index: number, text: string) => ({
    item_kind: 'programming_runtime_assistant_message',
    sequence,
    turn_id: TURN_ID,
    run_id: RUN_ID,
    step_id: stepId,
    message: {
      message_id: `builder-message:00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      text,
    },
  } as const);
  const runtimeTool = (
    sequence: number,
    index: number,
    kind: 'edit' | 'command',
    state: 'running' | 'completed',
  ) => {
    const target = kind === 'command' ? 'npm test' : fileTargets[index - 1] ?? `src/file-${index}.ts`;
    return {
      item_kind: 'programming_runtime_tool_activity',
      sequence,
      turn_id: TURN_ID,
      run_id: RUN_ID,
      step_id: stepId,
      tool_call_id: `builder-tool-call:00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      tool_kind: kind,
      state,
      active_label: kind === 'command' ? `Running ${target}` : `Editing ${target}`,
      completed_label: kind === 'command' ? `Ran ${target}` : `Edited ${target}`,
      target_label: target,
      presentation: kind === 'command' ? 'terminal' : 'changes',
      status_label: null,
      duration_ms: state === 'completed' ? 12 : null,
      summary: state === 'completed'
        ? kind === 'command' ? 'The project check completed successfully.' : `Edited ${target}.`
        : null,
      failure_class: null,
      result_ref: state === 'completed'
        ? `builder-runtime-tool-result:${String(index).repeat(64).slice(0, 64)}`
        : null,
      presentation_detail: kind === 'edit' && state === 'completed' ? {
        detail_kind: 'diff',
        path: target,
        added_lines: index + 1,
        deleted_lines: index,
      } : null,
      file_change: kind === 'edit' && state === 'completed' ? {
        change_ref: `builder-runtime-file-change:${String(index + 3).repeat(64).slice(0, 64)}`,
        change_kind: 'edited',
        added_lines: index + 1,
        deleted_lines: index,
      } : null,
      check_result: kind === 'command' && state === 'completed' ? {
        command_ref: `builder-runtime-command-result:${String(index + 6).repeat(64).slice(0, 64)}`,
        status: 'passed',
        duration_ms: 12,
        summary: 'The project check completed successfully.',
      } : null,
    } as const;
  };
  const runtimeStatus = {
    item_kind: 'programming_runtime_status',
    sequence: 3,
    turn_id: TURN_ID,
    run_id: RUN_ID,
    step_id: stepId,
    status_kind: statusKind,
    activity_kind: statusKind === 'activity' ? 'generation_finishing' : null,
    attention_class: null,
    failure_class: null,
    status: statusKind === 'activity' ? '正在准备工具调用' : '正在思考',
  } as const;
  const completedActions = [
    runtimeNarration(3, 1, 'I found the relevant files and will update them now.'),
    runtimeTool(4, 1, 'edit', 'running'),
    runtimeTool(5, 1, 'edit', 'completed'),
    runtimeTool(6, 2, 'edit', 'running'),
    runtimeTool(7, 2, 'edit', 'completed'),
    runtimeNarration(8, 2, 'The edits are complete. I will run the project check next.'),
    runtimeTool(9, 3, 'command', 'running'),
    runtimeTool(10, 3, 'command', 'completed'),
    runtimeNarration(11, 3, 'Implemented the requested changes and checked the project.'),
  ].filter((item) => (
    includeCommand
    || item.item_kind !== 'programming_runtime_tool_activity'
    || item.tool_kind !== 'command'
  ));
  const actions = statusOnly
    ? [runtimeStatus]
    : completed
    ? completedActions
    : [
      runtimeStatus,
      runtimeNarration(4, 1, 'I found the relevant file and will update it now.'),
      runtimeTool(5, 1, 'edit', 'running'),
    ];
  const finalItems = completed ? [
    {
      item_kind: 'run_completed',
      sequence: 12,
      turn_id: TURN_ID,
      run_id: RUN_ID,
      terminal_status: 'succeeded',
      result_kind: 'candidate',
      failure_phase: 'not_applicable',
      assistant_message: {
        message_id: 'builder-message:423e4567-e89b-42d3-a456-426614174000',
        text: 'Implemented the requested changes and checked the project.',
      },
      candidate: {
        draft_id: DRAFT_ID,
        title: 'Checked update',
        summary: 'The requested update is ready.',
        candidate_state: 'proposed',
        source_availability: 'not_loaded',
        workspace_materialization: { status: 'materialized' },
      },
    },
    {
      item_kind: 'turn_completed',
      sequence: 13,
      turn_id: TURN_ID,
      run_id: RUN_ID,
      outcome: 'candidate_ready',
    },
  ] : [];
  const controller = createBuilderConversationController(taskStreamPort(async () => ({
    stream_version: 'builder-task-stream-read-result.v1',
    project_id: PROJECT_ID,
    conversation: {
      conversation_id: CONVERSATION_ID,
      created_at_ms: 1234,
      head_sequence: completed ? 13 : statusOnly ? 3 : 5,
      recorded_active_turn_id: completed ? null : TURN_ID,
      window: {
        first_sequence: 1,
        last_sequence: completed ? 13 : statusOnly ? 3 : 5,
        has_earlier: false,
      },
      items: [
        {
          item_kind: 'user_message',
          sequence: 1,
          turn_id: TURN_ID,
          message: {
            message_id: 'builder-message:323e4567-e89b-42d3-a456-426614174000',
            text: 'Update the project and run its checks.',
          },
          message_kind: 'submitted',
          mode: 'work',
          task: { task_id: TASK_ID, title: 'Update project' },
        },
        {
          item_kind: 'run_started',
          sequence: 2,
          turn_id: TURN_ID,
          run_id: RUN_ID,
          task_id: TASK_ID,
          attempt_number: 1,
          retry_of_run_id: null,
          recorded_state: 'started',
        },
        ...actions,
        ...finalItems,
      ],
    },
    authority: {
      conversation: 'sqlite_canonical_event_replay_or_absent',
      project_source: 'not_included',
      candidate_source: 'not_loaded',
      project_revision: 'not_inferred',
    },
  })));
  return controller.load(PROJECT_ID, TASK_ADDRESS_ID);
}

async function agentTestBrowserActivity() {
  const wire = createTaskStreamWire();
  const controller = createBuilderConversationController(taskStreamPort(async () => ({
    ...wire,
    conversation: {
      ...wire.conversation,
      head_sequence: 3,
      recorded_active_turn_id: TURN_ID,
      window: {
        first_sequence: 1,
        last_sequence: 3,
        has_earlier: false,
      },
      items: [wire.conversation.items[0], wire.conversation.items[1], {
        item_kind: 'programming_runtime_tool_activity',
        sequence: 3,
        turn_id: TURN_ID,
        run_id: RUN_ID,
        step_id: 'builder-run-step:123e4567-e89b-42d3-a456-426614174000',
        tool_call_id: 'builder-tool-call:00000000-0000-4000-8000-000000000009',
        tool_kind: 'browser',
        state: 'running',
        active_label: 'Opening Agent Test browser',
        completed_label: 'Opened Agent Test browser',
        target_label: 'Agent Test browser',
        presentation: 'browser',
        status_label: null,
        duration_ms: null,
        summary: null,
        failure_class: null,
        result_ref: null,
        presentation_detail: null,
        file_change: null,
        check_result: null,
      }],
    },
  })));
  return controller.load(PROJECT_ID, TASK_ADDRESS_ID);
}

function openWorkspaceChanges(container: HTMLElement): void {
  click(container, '[data-builder-workspace-menu-button="true"]');
  click(container, '[data-builder-workspace-control-tab="changes"]');
}

function changeInput(container: HTMLElement, selector: string, value: string): void {
  const input = container.querySelector<HTMLInputElement>(selector);
  expect(input).not.toBeNull();
  act(() => {
    if (input) {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
        ?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
}

function keyDown(
  container: HTMLElement,
  selector: string,
  init: KeyboardEventInit,
): KeyboardEvent {
  const target = container.querySelector<HTMLElement>(selector);
  expect(target).not.toBeNull();
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  act(() => {
    target?.dispatchEvent(event);
  });
  return event;
}

function installScrollIntoViewSpy() {
  const prototype = HTMLElement.prototype as HTMLElement & {
    scrollIntoView?: HTMLElement['scrollIntoView'];
  };
  const hadOwnProperty = Object.hasOwn(prototype, 'scrollIntoView');
  const original = prototype.scrollIntoView;
  const spy = vi.fn();
  Object.defineProperty(prototype, 'scrollIntoView', {
    configurable: true,
    value: spy,
  });
  return {
    spy,
    restore() {
      if (hadOwnProperty) {
        Object.defineProperty(prototype, 'scrollIntoView', {
          configurable: true,
          value: original,
        });
        return;
      }
      Reflect.deleteProperty(prototype, 'scrollIntoView');
    },
  };
}

function setScrollMetrics(
  element: HTMLElement,
  metrics: Readonly<{ clientHeight: number; scrollHeight: number; scrollTop: number }>,
): void {
  Object.defineProperty(element, 'clientHeight', {
    configurable: true,
    value: metrics.clientHeight,
  });
  Object.defineProperty(element, 'scrollHeight', {
    configurable: true,
    value: metrics.scrollHeight,
  });
  Object.defineProperty(element, 'scrollTop', {
    configurable: true,
    value: metrics.scrollTop,
    writable: true,
  });
}

describe('BuilderPage v2', () => {
  it('does not expose Stop for a terminal task with stale cancellation controls', () => {
    const baseTask = {
      task_address_id: TASK_ADDRESS_ID,
      project_id: PROJECT_ID,
      conversation_id: CONVERSATION_ID,
      title: 'Task',
      goal: 'Finish the task.',
      group: 'attention' as const,
      status_label: 'Could not finish',
      latest_activity_at_ms: 1,
      latest_result: null,
      attention: null,
      operations: ['open_task', 'cancel_task'] as const,
    };

    expect(canStopBuilderAgentTask({ ...baseTask, state: 'failed' })).toBe(false);
    expect(canStopBuilderAgentTask({ ...baseTask, state: 'interrupted' })).toBe(false);
    expect(canStopBuilderAgentTask({ ...baseTask, state: 'working' })).toBe(true);
    expect(canStopBuilderAgentTask({ ...baseTask, state: 'waiting_permission' })).toBe(true);
  });

  it.each(['fresh', 'draftReady'] as const)('renders projectless Agent chat and planning with retained %s state', async (selection) => {
    const projectSnapshots = await snapshots();
    const agentId = 'builder-agent:123e4567-e89b-42d3-a456-426614174000';
    const agentController = createBuilderConversationController(taskStreamPort(async () => ({
      stream_version: 'builder-task-stream-read-result.v1',
      scope_kind: 'agent_conversation',
      agent_id: agentId,
      project_id: null,
      conversation: null,
      authority: {
        conversation: 'sqlite_canonical_agent_conversation',
        project_source: 'not_included',
        candidate_source: 'not_loaded',
        project_revision: 'not_inferred',
      },
    })));
    const conversationSnapshot = await agentController.load(null, null, agentId);
    const onUpdateMessageState = vi.fn();
    const onDecideTaskProposal = vi.fn();
    const onDecideAgentPlan = vi.fn();
    const onCreateProjectForTaskProposal = vi.fn();
    const onOpenTaskProposal = vi.fn();
    const onControlAgentTask = vi.fn();
    const onArchiveAgentTask = vi.fn();
    const onRenameAgentTask = vi.fn();
    const onSelectComposerMode = vi.fn();
    const onSelectPlanMode = vi.fn();
    const container = render(
      <BuilderPage
        activeFile={null}
        agentWorkbenchSnapshot={{
          status: 'ready',
          busy: false,
          projection: {
            projection_version: 'builder-agent-workbench-projection.v2',
            agent_id: agentId,
            stream: {
              items: [
                {
                  message_id: 'builder-message:123e4567-e89b-42d3-a456-426614174001',
                  thread_id: 'builder-workbench-thread:123e4567-e89b-42d3-a456-426614174000',
                  presentation_family: 'conversation',
                  content_type: 'builder.chat.user_message.v1',
                  source_label: 'You',
                  fallback_text: 'Can we discuss the release?',
                  presentation: {
                    presentation_version: 'builder-workbench-declarative-presentation.v1',
                    body_kind: 'plain_text',
                    body_text: 'Can we discuss the release?',
                    metadata: [],
                  },
                  attention: 'normal',
                  trust_label: 'local',
                  state: { unread: false, acknowledged: false, archived: false },
                  actions: [],
                  task_ref: null,
                  created_at_ms: 1,
                },
                {
                  message_id: 'builder-message:123e4567-e89b-42d3-a456-426614174006',
                  thread_id: 'builder-workbench-thread:123e4567-e89b-42d3-a456-426614174000',
                  presentation_family: 'conversation',
                  content_type: 'builder.chat.turn_status.v1',
                  source_label: 'Agent',
                  fallback_text: '已停止，本次请求未完成。',
                  presentation: {
                    presentation_version: 'builder-workbench-declarative-presentation.v1',
                    body_kind: 'plain_text', body_text: '已停止，本次请求未完成。', metadata: [],
                  },
                  attention: 'normal', trust_label: 'local',
                  state: { unread: false, acknowledged: false, archived: false },
                  actions: [], task_ref: null, created_at_ms: 2,
                },
                {
                  message_id: 'builder-message:123e4567-e89b-42d3-a456-426614174007',
                  thread_id: 'builder-workbench-thread:123e4567-e89b-42d3-a456-426614174000',
                  presentation_family: 'conversation',
                  content_type: 'builder.chat.user_message.v1',
                  source_label: 'You', fallback_text: 'Try again.',
                  presentation: {
                    presentation_version: 'builder-workbench-declarative-presentation.v1',
                    body_kind: 'plain_text', body_text: 'Try again.', metadata: [],
                  },
                  attention: 'normal', trust_label: 'local',
                  state: { unread: false, acknowledged: false, archived: false },
                  actions: [], task_ref: null, created_at_ms: 3,
                },
                {
                  message_id: 'builder-message:123e4567-e89b-42d3-a456-426614174002',
                  thread_id: 'builder-workbench-thread:123e4567-e89b-42d3-a456-426614174000',
                  presentation_family: 'conversation',
                  content_type: 'builder.chat.agent_message.v1',
                  source_label: 'Agent',
                  fallback_text: 'Yes. Review the [release notes](https://example.com).',
                  presentation: {
                    presentation_version: 'builder-workbench-declarative-presentation.v1',
                    body_kind: 'markdown',
                    body_text: 'Yes. Review the [release notes](https://example.com).',
                    metadata: [],
                  },
                  attention: 'normal',
                  trust_label: 'local',
                  state: { unread: true, acknowledged: false, archived: false },
                  actions: [],
                  task_ref: null,
                  created_at_ms: 2,
                },
                {
                  message_id: 'builder-message:123e4567-e89b-42d3-a456-426614174003',
                  thread_id: null,
                  presentation_family: 'proposal',
                  content_type: 'builder.task.proposal.v1',
                  source_label: 'Agent',
                  fallback_text: 'Build a compact focus timer.',
                  presentation: {
                    presentation_version: 'builder-workbench-declarative-presentation.v1',
                    body_kind: 'markdown',
                    body_text: '### Task proposal\n\nBuild a compact focus timer.',
                    metadata: [],
                  },
                  attention: 'action_required',
                  trust_label: 'local',
                  state: { unread: true, acknowledged: false, archived: false },
                  actions: [{
                    action_version: 'builder-workbench-task-proposal-action.v1',
                    action_id: `builder-workbench-action:${'a'.repeat(64)}`,
                    proposal_id: 'builder-task-proposal:323e4567-e89b-42d3-a456-426614174000',
                    status: 'pending',
                    objective: 'Build a compact focus timer.',
                    requested_outcome: 'build',
                    execution_mode: 'foreground',
                    project_id: null,
                    task_address_id: null,
                    conversation_id: null,
                    operations: ['approve_existing_project', 'reject'],
                  }],
                  task_ref: null,
                  created_at_ms: 3,
                },
                {
                  message_id: 'builder-message:123e4567-e89b-42d3-a456-426614174004',
                  thread_id: null,
                  presentation_family: 'result',
                  content_type: 'builder.task.result.v1',
                  source_label: 'Builder',
                  fallback_text: 'Release changes are ready for review.',
                  presentation: {
                    presentation_version: 'builder-workbench-declarative-presentation.v1',
                    body_kind: 'markdown',
                    body_text: 'Release changes are ready for review.',
                    metadata: [],
                  },
                  attention: 'normal',
                  trust_label: 'local',
                  state: { unread: true, acknowledged: false, archived: false },
                  actions: [],
                  task_ref: {
                    project_id: PROJECT_ID,
                    task_address_id: 'builder-task-address:123e4567-e89b-42d3-a456-426614174010',
                    operation: 'open_task',
                  },
                  created_at_ms: 4,
                },
              ],
              after_cursor: null,
              next_cursor: 'builder-workbench-cursor:2',
              has_more: false,
            },
            task_monitor: {
              projection_version: 'builder-workbench-task-monitor.v2',
              agent_id: agentId,
              tasks: [{
                task_address_id: 'builder-task-address:123e4567-e89b-42d3-a456-426614174010',
                project_id: PROJECT_ID,
                conversation_id: 'builder-conversation:123e4567-e89b-42d3-a456-426614174001:123e4567-e89b-42d3-a456-426614174010',
                title: 'Release checks',
                goal: 'Verify the release.',
                group: 'attention',
                state: 'waiting_permission',
                status_label: 'Permission required',
                latest_activity_at_ms: 10,
                latest_result: {
                  result_version: 'builder-workbench-task-result-summary.v1',
                  result_id: `builder-task-result:${'c'.repeat(64)}`,
                  run_id: 'builder-run:123e4567-e89b-42d3-a456-426614174020',
                  sequence: 8,
                  completed_at_ms: 10,
                  terminal_status: 'succeeded',
                  result_kind: 'candidate',
                  summary: 'Release changes are ready for review.',
                  review_state: 'pending',
                },
                attention: {
                  attention_version: 'builder-workbench-task-attention-summary.v1',
                  state: 'waiting_permission',
                  label: 'Permission required',
                  detail: 'This task needs your permission before it can continue.',
                  action_label: 'Review permission',
                },
                operations: ['open_task', 'cancel_task'],
              }],
              counts: { active: 0, attention: 1, recent: 0 },
              authority: {
                task_identity: 'main_owned_session_task_address_store',
                task_state: 'sqlite_canonical_event_replay_plus_task_attention',
                renderer_authority: 'selection_only',
                provider_dispatch: false,
                permission_grant: false,
                source_read: false,
                source_write: false,
              },
            },
            agent_plan: {
              status: 'ready',
              artifact: {
                artifact_version: 'builder-agent-plan-artifact.v1',
                content_digest: `sha256:${'d'.repeat(64)}`,
                agent_plan_id: 'builder-agent-plan:123e4567-e89b-42d3-a456-426614174030',
                agent_id: agentId,
                source_conversation_id: 'builder-agent-conversation:123e4567-e89b-42d3-a456-426614174000',
                source_turn_id: 'builder-turn:123e4567-e89b-42d3-a456-426614174031',
                source_run_id: 'builder-run:123e4567-e89b-42d3-a456-426614174032',
                source_message_id: 'builder-message:123e4567-e89b-42d3-a456-426614174002',
                version: 1,
                markdown: '# Full plan',
                state: 'proposed',
                created_at_ms: 5,
              },
              decision: null,
            },
            inbox: {
              unread_count: 1,
              action_required_count: 0,
              mention_count: 0,
              active_task_count: 0,
            },
            authority: {
              canonical_messages: 'main_owned_workbench_message_store',
              user_state: 'main_owned_workbench_message_state_store',
              task_state: 'sqlite_canonical_event_replay_plus_task_attention',
              renderer_authority: 'selection_and_bounded_state_requests_only',
              plugin_payload_exposure: 'not_exposed',
              permission_grant: false,
              provider_dispatch: false,
              source_read: false,
              source_write: false,
            },
          },
        }}
        conversationSnapshot={conversationSnapshot}
        instruction=""
        onCreateProjectForAgentTaskProposal={onCreateProjectForTaskProposal}
        onArchiveAgentTask={onArchiveAgentTask}
        onControlAgentTask={onControlAgentTask}
        onDecideAgentTaskProposal={onDecideTaskProposal}
        onDecideAgentPlan={onDecideAgentPlan}
        onOpenAgentTaskProposal={onOpenTaskProposal}
        onRenameAgentTask={onRenameAgentTask}
        onSelectComposerMode={onSelectComposerMode}
        onSelectPlanMode={onSelectPlanMode}
        onUpdateAgentWorkbenchMessageState={onUpdateMessageState}
        projectCatalogSnapshot={{
          status: 'ready',
          busy: false,
          projects: [{
            project_id: PROJECT_ID,
            title: 'Focus tools',
            summary: 'Utilities',
            revision_number: 1,
            revision_receipt_digest: `sha256:${'b'.repeat(64)}`,
            commit_oid: 'a'.repeat(40),
            tree_oid: 'b'.repeat(40),
            selected_at_ms: 1,
          }],
          workspaceProjects: [],
        }}
        snapshot={projectSnapshots[selection]}
        surfaceKind="workbench"
      />,
    );

    expect(container.querySelector('[data-builder-agent-workbench-stream="true"]')).not.toBeNull();
    expect(container.querySelector('[data-builder-agent-plan-decision="true"]')?.textContent)
      .toContain('Plan version 1');
    const planReview = container.querySelector('[data-builder-agent-plan-decision="true"]')!;
    const planMessage = container.querySelector('[data-builder-workbench-message="builder-message:123e4567-e89b-42d3-a456-426614174002"]');
    expect(planMessage?.contains(planReview)).toBe(true);
    const planBody = planMessage?.querySelector('.cf-builder-agent-workbench-message-body');
    expect(planBody).not.toBeNull();
    expect(planBody!.compareDocumentPosition(planReview) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    const approvePlan = [...container.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === 'Approve plan');
    act(() => approvePlan?.click());
    expect(onDecideAgentPlan).toHaveBeenCalledWith(
      'builder-agent-plan:123e4567-e89b-42d3-a456-426614174030',
      `sha256:${'d'.repeat(64)}`,
      'approved',
    );
    const revisePlan = [...container.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === 'Revise');
    act(() => revisePlan?.click());
    expect(onSelectPlanMode).toHaveBeenCalledOnce();
    expect(container.textContent).not.toContain('# Full plan');
    expect(container.querySelector('[data-builder-workspace-chip="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-composer-approval-menu-button="true"]')).toBeNull();
    click(container, '[data-builder-composer-add-menu-button="true"]');
    const agentPlanMode = container.querySelector<HTMLButtonElement>(
      '[data-builder-composer-add-plan-mode="true"]',
    );
    expect(agentPlanMode?.disabled).toBe(false);
    act(() => agentPlanMode?.click());
    expect(onSelectComposerMode).toHaveBeenCalledWith('plan');
    expect(container.querySelector('[data-builder-task-monitor="true"]')).not.toBeNull();
    expect(container.textContent).toContain('Needs attention');
    expect(container.textContent).toContain('This task needs your permission before it can continue.');
    expect(container.textContent).toContain('Release changes are ready for review.');
    expect(container.textContent).toContain('Agent');
    expect(container.textContent).toContain('Builder');
    expect(container.textContent).toContain('Can we discuss the release?');
    expect(container.querySelector('a[href="https://example.com"]')?.getAttribute('target')).toBe('_blank');
    const notice = container.querySelector('[data-builder-workbench-content-type="builder.chat.turn_status.v1"]');
    expect(notice?.querySelector('[role="note"]')?.textContent).toBe('已停止，本次请求未完成。');
    expect(notice?.previousElementSibling?.textContent).toContain('Can we discuss the release?');
    expect(notice?.nextElementSibling?.textContent).toContain('Try again.');
    click(container, '[data-builder-agent-workbench-filter="conversation"]');
    expect(container.querySelectorAll('[data-builder-workbench-content-type="builder.chat.turn_status.v1"]')).toHaveLength(1);
    expect(container.textContent).toContain('已停止，本次请求未完成。');
    expect(container.textContent).toContain('Can we discuss the release?');
    expect(container.textContent).toContain('Yes. Review the release notes.');
    expect(container.textContent).not.toContain('Build a compact focus timer.');
    expect(container.textContent).not.toContain('Release changes are ready for review.');
    expect(container.querySelector('[data-builder-agent-workbench-hidden-attention="true"]')?.textContent)
      .toContain('2 hidden');
    click(container, '[data-builder-agent-workbench-filter="result"]');
    expect(container.textContent).toContain('Can we discuss the release?');
    expect(container.textContent).toContain('Release changes are ready for review.');
    expect(container.textContent).not.toContain('Build a compact focus timer.');
    click(container, '[data-builder-agent-workbench-filter="all"]');
    expect(container.textContent).toContain('Build a compact focus timer.');
    expect(container.textContent).toContain('Release changes are ready for review.');
    const markRead = container.querySelector<HTMLButtonElement>('[aria-label="Mark message as read"]');
    act(() => markRead?.click());
    expect(onUpdateMessageState).toHaveBeenCalledWith(
      'builder-message:123e4567-e89b-42d3-a456-426614174002',
      'mark_read',
    );
    const createTask = [...container.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.includes('Create task'));
    act(() => createTask?.click());
    expect(onDecideTaskProposal).toHaveBeenCalledWith(
      'builder-task-proposal:323e4567-e89b-42d3-a456-426614174000',
      'approve_existing_project',
      PROJECT_ID,
    );
    const newProject = [...container.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.includes('New project'));
    act(() => newProject?.click());
    expect(onCreateProjectForTaskProposal).toHaveBeenCalledWith(
      'builder-task-proposal:323e4567-e89b-42d3-a456-426614174000',
      'Build a compact focus timer.',
    );
    const openTask = [...container.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.includes('Open task'));
    expect(openTask?.getAttribute('data-builder-agent-result-open-task')).toBe('true');
    expect(openTask?.getAttribute('data-builder-task-address-id')).toBe(
      'builder-task-address:123e4567-e89b-42d3-a456-426614174010',
    );
    act(() => openTask?.click());
    expect(onOpenTaskProposal).toHaveBeenCalledWith(
      PROJECT_ID,
      'builder-task-address:123e4567-e89b-42d3-a456-426614174010',
      {
        task_address_id: 'builder-task-address:123e4567-e89b-42d3-a456-426614174010',
        conversation_id: 'builder-conversation:123e4567-e89b-42d3-a456-426614174001:123e4567-e89b-42d3-a456-426614174010',
        goal: 'Verify the release.',
        waiting_to_start: false,
      },
    );
    const acknowledgeResult = container.querySelector<HTMLButtonElement>(
      '[data-builder-agent-result-acknowledge="true"]',
    );
    act(() => acknowledgeResult?.click());
    expect(onUpdateMessageState).toHaveBeenCalledWith(
      'builder-message:123e4567-e89b-42d3-a456-426614174004',
      'acknowledge',
    );
    const archiveResult = container.querySelector<HTMLButtonElement>(
      '[data-builder-agent-result-archive="true"]',
    );
    act(() => archiveResult?.click());
    expect(onUpdateMessageState).toHaveBeenCalledWith(
      'builder-message:123e4567-e89b-42d3-a456-426614174004',
      'archive',
    );
    const reviewPermission = container.querySelector<HTMLButtonElement>(
      '[data-builder-task-monitor-open-task="true"]',
    );
    expect(reviewPermission?.textContent).toContain('Review permission');
    act(() => reviewPermission?.click());
    expect(onOpenTaskProposal).toHaveBeenLastCalledWith(
      PROJECT_ID,
      'builder-task-address:123e4567-e89b-42d3-a456-426614174010',
      {
        task_address_id: 'builder-task-address:123e4567-e89b-42d3-a456-426614174010',
        conversation_id: 'builder-conversation:123e4567-e89b-42d3-a456-426614174001:123e4567-e89b-42d3-a456-426614174010',
        goal: 'Verify the release.',
        waiting_to_start: false,
      },
    );
    const stopTask = container.querySelector<HTMLButtonElement>(
      '[data-builder-task-monitor-cancel-task="true"]',
    );
    act(() => stopTask?.click());
    expect(onControlAgentTask).toHaveBeenCalledWith(
      PROJECT_ID,
      'builder-task-address:123e4567-e89b-42d3-a456-426614174010',
      'cancel_task',
    );
    click(container, '[data-builder-task-monitor-task-actions="true"]');
    expect(container.querySelector('[data-builder-task-monitor-action-menu="true"]')).not.toBeNull();
    click(container, '[data-builder-task-monitor-rename-task="true"]');
    changeInput(container, '[data-builder-task-monitor-rename-input="true"]', 'Renamed release task');
    click(container, '[data-builder-task-monitor-rename-save="true"]');
    expect(onRenameAgentTask).toHaveBeenCalledExactlyOnceWith(
      PROJECT_ID,
      'builder-task-address:123e4567-e89b-42d3-a456-426614174010',
      'Renamed release task',
    );
    click(container, '[data-builder-task-monitor-task-actions="true"]');
    click(container, '[data-builder-task-monitor-archive-task="true"]');
    expect(onArchiveAgentTask).toHaveBeenCalledExactlyOnceWith(
      PROJECT_ID,
      'builder-task-address:123e4567-e89b-42d3-a456-426614174010',
    );
    click(container, '[data-builder-composer-add-menu-button="true"]');
    expect(container.querySelector('[data-builder-composer-add-build-mode="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-composer-add-files="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-composer-add-plan-mode="true"]')).not.toBeNull();
  });

  it('renders a continuous composer without pretending a new project is saved', async () => {
    const { fresh } = await snapshots();
    const activity = await absentActivity();
    const onSubmitInstruction = vi.fn();
    const onInstructionChange = vi.fn();
    const container = render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={activity}
        instruction="Make a timer."
        onInstructionChange={onInstructionChange}
        onSubmitInstruction={onSubmitInstruction}
        snapshot={fresh}
      />,
    );

    const composerTextarea = container.querySelector<HTMLTextAreaElement>('#builder-idea');
    expect(container.querySelector('[data-builder-composer="true"]')).not.toBeNull();
    expect(composerTextarea?.getAttribute('aria-label'))
      .toBe('Ask a question, or describe what to build or change');
    expect(composerTextarea?.placeholder)
      .toBe('Ask a question, or describe what to build or change...');
    expect(container.querySelector('[data-builder-starter-card="true"]')).toBeNull();
    expect(container.textContent).not.toContain('What would you like to do today?');
    expect(container.textContent).not.toContain('What are we building today?');
    expect(container.querySelector('[data-builder-activity-card="Assistant"]')).toBeNull();
    expect(container.querySelector('[data-builder-message-surface="plain"]')).toBeNull();
    expect(container.querySelector('[data-builder-current-version="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-page="true"]')?.getAttribute('data-builder-project-status'))
      .toBe('new');
    const workspace = container.querySelector('[data-builder-chat-workspace="true"]');
    expect(workspace?.getAttribute('data-builder-artifact-sidebar-visible'))
      .toBe('false');
    expect(workspace?.classList.contains('border')).toBe(false);
    expect(container.querySelector('[data-builder-draft-landing="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-artifact-sidebar="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-changes-panel="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-version-history="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-activity="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-result-flow="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-composer-status="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-workspace-chip="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-composer-context-bar="true"]')).toBeNull();
    expect(container.textContent).not.toContain('Start from an idea');
    expect(container.textContent).not.toContain('Select a project to see activity.');
    expect(container.textContent).not.toContain('No activity yet.');
    expect(container.textContent).not.toContain('Your result will appear here.');
    expect(container.textContent).not.toContain('Preview is isolated');
    expect(container.textContent).not.toContain('No unsaved changes to review.');
    expect(container.textContent).not.toContain('Make a draft to compare it with the current version.');
    expect(container.textContent).not.toContain('Save a version to see history.');
    expect(container.querySelector('[data-builder-ask-question="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-make-draft="true"]')).toBeNull();
    click(container, '[data-builder-submit-turn="true"]');
    expect(onSubmitInstruction).toHaveBeenCalledOnce();
  });

  it('keeps project selection out of the composer surface', async () => {
    const { fresh } = await snapshots();
    const container = render(
      <BuilderPage
        activeFile={null}
        instruction="Make a timer."
        projectCatalogSnapshot={await trustedCatalogSnapshot()}
        snapshot={fresh}
      />,
    );

    expect(container.querySelector('[data-builder-workspace-chip="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-composer-context-bar="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-workspace-picker="true"]')).toBeNull();
    expect(container.textContent).not.toContain('Chat only until you choose a folder');
  });

  it('keeps workspace clearing out of the composer surface', async () => {
    const { saved } = await snapshots();
    const container = render(
      <BuilderPage
        activeFile={null}
        instruction="Keep discussing."
        snapshot={saved}
      />,
    );

    const clear = container.querySelector('[data-builder-clear-workspace-selection="true"]');
    expect(clear).toBeNull();
    expect(container.querySelector('[data-builder-composer-context-bar="true"]')).toBeNull();
  });

  it('keeps the current source folder visible outside the composer before first save', async () => {
    const working = await workingProjectSnapshot();
    const container = render(
      <BuilderPage
        activeFile={null}
        instruction="Make a timer."
        projectCatalogSnapshot={await trustedCatalogSnapshot('empty')}
        snapshot={working}
      />,
    );

    expect(container.querySelector('[data-builder-workspace-chip="true"]')).toBeNull();
    const workspace = container.querySelector('[data-builder-chat-workspace="true"]');
    expect(workspace?.getAttribute('data-builder-artifact-sidebar-visible')).toBe('false');
    expect(container.querySelector('[data-builder-artifact-sidebar="true"]')).toBeNull();

    click(container, '[data-builder-workspace-menu-button="true"]');
    expect(container.querySelector('[data-builder-workspace-control-tab="browser_placeholder"]')).not.toBeNull();
    expect(container.querySelector('[data-builder-workspace-control-tab="permissions"]')).not.toBeNull();
    expect(container.querySelector('[data-builder-artifact-permissions="true"]')).toBeNull();
    click(container, '[data-builder-workspace-control-tab="browser_placeholder"]');
    const browserPlaceholder = container.querySelector('[data-builder-side-workspace-browser-placeholder="true"]');
    expect(browserPlaceholder?.textContent).toContain('Browser');
    expect(browserPlaceholder?.querySelector('[data-builder-side-workspace-placeholder-note="browser"]')?.classList.contains('cf-builder-visually-hidden'))
      .toBe(true);
    click(container, '[data-builder-workspace-menu-button="true"]');
    click(container, '[data-builder-workspace-control-tab="permissions"]');
    expect(container.querySelector('[data-builder-artifact-sidebar="true"]')?.getAttribute('data-builder-artifact-tab-active'))
      .toBe('permissions');
    expect(container.querySelector('[data-builder-artifact-permissions="true"]')?.textContent)
      .toContain('Unsaved dashboard');
    expect(workspace?.getAttribute('data-builder-artifact-sidebar-visible')).toBe('true');

    expect(container.querySelector('[data-builder-workspace-picker="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-artifact-permissions="true"]')?.textContent)
      .toContain('Unsaved dashboard');
  });

  it('keeps restart-restored bound workspaces out of the composer picker surface', async () => {
    const { fresh } = await snapshots();
    const workspaceOnlyProjectId = 'builder-project:22222222-2222-4222-8222-222222222222';
    const container = render(
      <BuilderPage
        activeFile={null}
        instruction="Make a timer."
        projectCatalogSnapshot={await trustedCatalogSnapshot('empty', [{
          project_id: workspaceOnlyProjectId,
          title: 'Unsaved dashboard',
          source_folders: [{ name: 'site-source', status: 'selected' }],
          bound_at_ms: 20,
          has_current_revision: false,
          current_revision_number: 0,
        }])}
        snapshot={fresh}
      />,
    );

    expect(container.querySelector('[data-builder-workspace-chip="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-workspace-picker="true"]')).toBeNull();
    expect(container.textContent).not.toContain('Draft workspace - Source folder: site-source');
  });

  it('does not expose project search or creation from the composer', async () => {
    const { fresh } = await snapshots();
    const container = render(
      <BuilderPage
        activeFile={null}
        instruction="Make a timer."
        projectCatalogSnapshot={await trustedCatalogSnapshot()}
        snapshot={fresh}
      />,
    );

    expect(container.querySelector('[data-builder-workspace-chip="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-workspace-search="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-workspace-new-project="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-new-project-panel="true"]')).toBeNull();
  });

  it('keeps workspace gating out of the composer UI', async () => {
    const { fresh } = await snapshots();
    const container = render(
      <BuilderPage
        activeFile={null}
        instruction="Make a timer."
        projectCatalogSnapshot={await trustedCatalogSnapshot('empty')}
        snapshot={fresh}
      />,
    );

    const picker = container.querySelector('[data-builder-workspace-picker="true"]');
    expect(picker).toBeNull();
    expect(container.querySelector('[data-builder-workspace-new-project="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-new-project-panel="true"]')).toBeNull();
  });

  it('does not project an external project command into the composer', async () => {
    const { fresh } = await snapshots();
    const container = render(
      <BuilderPage
        activeFile={null}
        instruction=""
        projectCatalogSnapshot={await trustedCatalogSnapshot('empty')}
        snapshot={fresh}
      />,
    );

    const panel = container.querySelector('[data-builder-new-project-panel="true"]');
    expect(panel).toBeNull();
    expect(container.querySelector('[data-builder-workspace-picker="true"]')).toBeNull();
  });

  it('keeps gated build text editable without mounting a workspace picker', async () => {
    const { fresh } = await snapshots();
    const onInstructionChange = vi.fn();
    const container = render(
      <BuilderPage
        activeFile={null}
        instruction="Make a timer."
        onInstructionChange={onInstructionChange}
        projectCatalogSnapshot={await trustedCatalogSnapshot('empty')}
        snapshot={fresh}
      />,
    );

    expect(container.querySelector('[data-builder-workspace-picker="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-workspace-chip="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-workspace-dismissed-build-note="true"]')).toBeNull();

    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea');
    expect(textarea).not.toBeNull();
    act(() => {
      if (textarea) {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
          ?.call(textarea, 'Make a clock.');
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });

    expect(onInstructionChange).toHaveBeenCalledWith('Make a clock.');
    expect(container.querySelector('[data-builder-workspace-dismissed-build-note="true"]')).toBeNull();
  });

  it('does not open an existing project from the gated composer surface', async () => {
    const { fresh } = await snapshots();
    const container = render(
      <BuilderPage
        activeFile={null}
        instruction="Make a timer."
        projectCatalogSnapshot={await trustedCatalogSnapshot()}
        snapshot={fresh}
      />,
    );

    expect(container.querySelector('[data-builder-workspace-picker="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-workspace-dismissed-build-note="true"]')).toBeNull();
  });

  it('keeps explicit activity loading and failure states visible without empty placeholders', async () => {
    const { fresh } = await snapshots();
    const loading = render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={loadingActivity()}
        instruction="Make a timer."
        snapshot={fresh}
      />,
    );
    expect(loading.querySelector('[data-builder-activity="true"]')).not.toBeNull();
    expect(loading.textContent).toContain('Loading activity...');
    expect(loading.textContent).not.toContain('No activity yet.');

    const unavailable = render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={await unavailableActivity()}
        instruction="Make a timer."
        snapshot={fresh}
      />,
    );
    expect(unavailable.querySelector('[data-builder-activity="true"]')).toBeNull();
    expect(unavailable.textContent).not.toContain('Activity is unavailable.');
    expect(unavailable.textContent).not.toContain('No activity yet.');

    const { saved } = await snapshots();
    const absent = render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={await absentActivity()}
        instruction="Make a timer."
        snapshot={saved}
      />,
    );
    expect(absent.querySelector('[data-builder-activity="true"]')).not.toBeNull();
    expect(absent.querySelector('[data-builder-activity-status="absent"]')).not.toBeNull();
    expect(absent.textContent).toContain('No recorded activity for this project yet. History is available.');
    expect(absent.textContent).not.toContain('Loading activity...');
    expect(absent.textContent).not.toContain('No activity yet.');

    const onRefresh = vi.fn();
    const stale = render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={await staleActivity()}
        instruction="Make a timer."
        onRefreshConversation={onRefresh}
        snapshot={fresh}
      />,
    );
    expect(stale.querySelector('[data-builder-activity="true"]')).not.toBeNull();
    expect(stale.textContent).toContain('Activity could not be refreshed.');
    expect(stale.textContent).not.toContain('No activity yet.');
    expect(stale.querySelector('[data-builder-refresh-activity="true"]')).not.toBeNull();
    click(stale, '[data-builder-refresh-activity="true"]');
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it('submits explicit User Web navigation from the Browser address bar', async () => {
    const working = await workingProjectSnapshot();
    const onNavigateUserWeb = vi.fn();
    const onGoBackUserWeb = vi.fn();
    const onGoForwardUserWeb = vi.fn();
    const onReloadUserWeb = vi.fn();
    const onStopUserWeb = vi.fn();
    const container = render(
      <BuilderPage
        activeFile={null}
        instruction=""
        onGoBackUserWeb={onGoBackUserWeb}
        onGoForwardUserWeb={onGoForwardUserWeb}
        onNavigateUserWeb={onNavigateUserWeb}
        onReloadUserWeb={onReloadUserWeb}
        onStopUserWeb={onStopUserWeb}
        snapshot={working}
        userWebStatus={{
          status_version: 'builder-user-web-status.v1',
          status: 'ready',
          current_url: 'https://example.com/',
          can_go_back: true,
          can_go_forward: true,
          can_reload: true,
          can_stop: true,
          navigation_block_count: 0,
          permission_block_count: 0,
          download_block_count: 0,
          window_open_block_count: 0,
          message: 'Page ready.',
          updated_at_ms: 10,
          authority: {
            user_web_authority: 'builder_main_user_web_v1',
            renderer_authority: 'explicit_navigation_and_layout_only',
            provider_authority: 'none',
            provider_observation: false,
            command_execution: false,
            dependency_installation: false,
            project_write: false,
            downloads: 'blocked_pending_separate_admission',
            permissions: 'denied',
            popup_windows: 'blocked',
            partition_visibility: 'main_private',
          },
        }}
      />,
    );

    click(container, '[data-builder-workspace-menu-button="true"]');
    click(container, '[data-builder-workspace-control-tab="browser_placeholder"]');
    changeInput(container, '[data-builder-side-workspace-browser-address="true"] input', 'openai.com/docs');
    keyDown(container, '[data-builder-side-workspace-browser-address="true"] input', { key: 'Enter' });
    expect(onNavigateUserWeb).toHaveBeenCalledExactlyOnceWith('openai.com/docs');

    click(container, '[aria-label="Back"]');
    click(container, '[aria-label="Forward"]');
    click(container, '[aria-label="Reload page"]');
    click(container, '[aria-label="Close page"]');
    expect(onGoBackUserWeb).toHaveBeenCalledOnce();
    expect(onGoForwardUserWeb).toHaveBeenCalledOnce();
    expect(onReloadUserWeb).toHaveBeenCalledOnce();
    expect(onStopUserWeb).toHaveBeenCalledOnce();
  });

  it('labels transcript-restored activity as read-only without enabling review actions', async () => {
    const { saved } = await snapshots();
    const container = render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={await transcriptRestoredActivity()}
        instruction=""
        snapshot={saved}
      />,
    );

    expect(container.querySelector('[data-builder-transcript-recovery-status="true"]')?.textContent)
      .toBe('Showing saved transcript. Live activity is unavailable.');
    expect(container.textContent).toContain('What did we change?');
    expect(container.textContent).toContain('We restored public chat history.');
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-plan-review-actions="true"]')).toBeNull();
    expect(container.textContent).not.toMatch(/sha256:|sqlite_derived|recovery_admission|credential|source_tree/iu);
  });

  it('submits the primary composer command with Enter through the single submit action', async () => {
    const { fresh } = await snapshots();
    const onSubmitInstruction = vi.fn();
    const container = render(
      <BuilderPage
        activeFile={null}
        instruction="Make a timer."
        onSubmitInstruction={onSubmitInstruction}
        snapshot={fresh}
      />,
    );

    const event = keyDown(container, '#builder-idea', { key: 'Enter' });

    expect(event.defaultPrevented).toBe(true);
    expect(container.querySelector('#builder-idea')?.getAttribute('aria-keyshortcuts'))
      .toBe('Enter');
    expect(onSubmitInstruction).toHaveBeenCalledOnce();
  });

  it('keeps Shift+Enter available for multiline composer input', async () => {
    const { fresh } = await snapshots();
    const onSubmitInstruction = vi.fn();
    const container = render(
      <BuilderPage
        activeFile={null}
        instruction="Make a timer."
        onSubmitInstruction={onSubmitInstruction}
        snapshot={fresh}
      />,
    );

    const event = keyDown(container, '#builder-idea', { key: 'Enter', shiftKey: true });

    expect(event.defaultPrevented).toBe(false);
    expect(onSubmitInstruction).not.toHaveBeenCalled();
  });

  it('does not submit while IME composition is active', async () => {
    const { fresh } = await snapshots();
    const onSubmitInstruction = vi.fn();
    const onRejectDraft = vi.fn();
    const onSave = vi.fn();
    const container = render(
      <BuilderPage
        activeFile={null}
        instruction="做一个计时器。"
        onRejectDraft={onRejectDraft}
        onSave={onSave}
        onSubmitInstruction={onSubmitInstruction}
        snapshot={fresh}
      />,
    );

    const event = keyDown(container, '#builder-idea', { key: 'Enter', isComposing: true });

    expect(event.defaultPrevented).toBe(false);
    expect(onSubmitInstruction).not.toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
    expect(onRejectDraft).not.toHaveBeenCalled();
  });

  it('offers Plan mode from the composer add menu without adding a second send button', async () => {
    const { draftReady, saved } = await snapshots();
    const working = await workingProjectSnapshot();
    const onSelectPlanMode = vi.fn();
    const onSubmitInstruction = vi.fn();
    const savedContainer = render(
      <BuilderPage
        activeFile={null}
        instruction=""
        onSelectPlanMode={onSelectPlanMode}
        onSubmitInstruction={onSubmitInstruction}
        snapshot={saved}
      />,
    );

    expect(savedContainer.querySelectorAll('[data-builder-submit-turn="true"]')).toHaveLength(1);
    expect(savedContainer.querySelector('[data-builder-propose-plan="true"]')).toBeNull();
    click(savedContainer, '[data-builder-composer-add-menu-button="true"]');
    const planMode = savedContainer.querySelector<HTMLButtonElement>(
      '[data-builder-composer-add-plan-mode="true"]',
    );
    expect(planMode).not.toBeNull();
    expect(planMode?.disabled).toBe(false);
    expect(planMode?.closest('[data-builder-composer="true"]')).not.toBeNull();
    click(savedContainer, '[data-builder-composer-add-plan-mode="true"]');
    expect(onSelectPlanMode).toHaveBeenCalledOnce();
    expect(onSubmitInstruction).not.toHaveBeenCalled();

    const workingContainer = render(
      <BuilderPage
        activeFile={null}
        instruction=""
        onSelectPlanMode={onSelectPlanMode}
        onSubmitInstruction={onSubmitInstruction}
        snapshot={working}
      />,
    );
    click(workingContainer, '[data-builder-composer-add-menu-button="true"]');
    const workingPlanMode = workingContainer.querySelector<HTMLButtonElement>(
      '[data-builder-composer-add-plan-mode="true"]',
    );
    expect(workingContainer.querySelector('[data-builder-workspace-chip="true"]')).toBeNull();
    expect(workingPlanMode).not.toBeNull();
    expect(workingPlanMode?.disabled).toBe(false);
    click(workingContainer, '[data-builder-composer-add-plan-mode="true"]');
    expect(onSelectPlanMode).toHaveBeenCalledTimes(2);
    expect(onSubmitInstruction).not.toHaveBeenCalled();

    const draftContainer = render(
      <BuilderPage
        activeFile={null}
        instruction="Plan while draft exists."
        onSelectPlanMode={onSelectPlanMode}
        onSubmitInstruction={onSubmitInstruction}
        snapshot={draftReady}
      />,
    );
    expect(draftContainer.querySelector('[data-builder-propose-plan="true"]')).toBeNull();
  });

  it('offers persistent Ask and Build modes and lets the chip return to Auto', async () => {
    const { saved } = await snapshots();
    const onSelectComposerMode = vi.fn();
    const onClearComposerMode = vi.fn();
    const container = render(
      <BuilderPage
        activeFile={null}
        composerMode="ask"
        instruction=""
        onClearComposerMode={onClearComposerMode}
        onSelectComposerMode={onSelectComposerMode}
        snapshot={saved}
      />,
    );

    expect(container.querySelector('[data-builder-composer-mode-chip="ask"]')?.textContent)
      .toContain('Ask mode');
    click(container, '[data-builder-composer-add-menu-button="true"]');
    click(container, '[data-builder-composer-add-build-mode="true"]');
    expect(onSelectComposerMode).toHaveBeenCalledExactlyOnceWith('build');

    click(container, '[data-builder-clear-composer-mode="true"]');
    expect(onClearComposerMode).toHaveBeenCalledOnce();
  });

  it('offers one submit command for questions and project changes', async () => {
    const { fresh } = await snapshots();
    const onSubmitInstruction = vi.fn();
    const container = render(
      <BuilderPage
        activeFile={null}
        instruction="What does this project do?"
        onSubmitInstruction={onSubmitInstruction}
        snapshot={fresh}
      />,
    );

    expect(container.querySelector('[data-builder-ask-question="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-make-draft="true"]')).toBeNull();
    click(container, '[data-builder-submit-turn="true"]');

    expect(onSubmitInstruction).toHaveBeenCalledOnce();
  });

  it('offers Retry for a retryable draft failure without submitting a new turn', async () => {
    const readWire = await createReadWire();
    const controller = createBuilderProjectController({
      generator: {
        submit: async () => {
          throw new BuilderGenerationDiagnosticError('builder_generation_provider_http_error');
        },
        generate: async () => {
          throw new BuilderGenerationDiagnosticError('builder_generation_provider_http_error');
        },
        continueDraft: async () => {
          throw new BuilderGenerationDiagnosticError('builder_generation_provider_http_error');
        },
        generateApprovedPlan: async () => null,
        proposePlan: async () => null,
        preparePlanSourceReadApproval: async () => PLAN_SOURCE_READ_READY,
        approvePlanSourceRead: async () => PLAN_SOURCE_READ_APPROVED,
        prepareCurrentProjectWriteApproval: async () => ({
          result_version: 'builder-current-project-write-approval-status.v1',
          project_id: PROJECT_ID,
          state: 'ready',
          approval_scope: 'current_project_write',
          authority: 'main_selected_project_project_edit_v1',
        }),
        approveCurrentProjectWrite: async () => ({
          result_version: 'builder-current-project-write-approval-result.v1',
          project_id: PROJECT_ID,
          operation: 'already_approved',
          approval_scope: 'current_project_write',
          authority: 'main_selected_project_project_edit_v1',
        }),
        retry: async (request) => createGenerationDraft(request),
        answer: async () => null,
        answerDraft: async () => null,
        restoreDraft: async () => null,
        restoreRevisionAsDraft: async () => null,
        rejectDraft: async () => null,
        cancel: async () => null,
        steer: async () => null,
        queueFollowup: async () => null,
      },
      workspace: {
        open: async (request) => (request.project_id === null ? null : readWire),
        openLocation: openProjectLocationSelection,
        createLocalProject: createLocalProjectSelectionCancelled,
        saveDraft: async () => null,
        loadCurrent: async () => null,
        loadRevision: async () => null,
        listCurrent: async () => ({ projects: [] }),
        listWorkspaces: async () => ({ workspaces: [] }),
        listHistory: async () => ({ revisions: [] }),
      },
    });
    await controller.open(PROJECT_ID);
    const failed = await controller.generate('Make a timer.');
    const onSubmitInstruction = vi.fn();
    const onRetryGenerate = vi.fn();
    const container = render(
      <BuilderPage
        activeFile={null}
        instruction="Make a different timer."
        onRetryGenerate={onRetryGenerate}
        onSubmitInstruction={onSubmitInstruction}
        snapshot={failed}
      />,
    );

    const notice = container.querySelector('[data-builder-conversation-notice="generation_failed"]');
    expect(notice).not.toBeNull();
    expect(notice?.closest('[data-builder-chat-main="true"]')).not.toBeNull();
    expect(notice?.closest('[data-builder-composer="true"]')).toBeNull();
    click(container, '[data-builder-retry-draft="true"]');

    expect(onRetryGenerate).toHaveBeenCalledOnce();
    expect(onSubmitInstruction).not.toHaveBeenCalled();
  });

  it('does not show a generic generation failure notice when a recoverable draft is present', async () => {
    const { draftReady } = await snapshots();
    const recoverable = {
      ...draftReady,
      status: 'generation_failed' as const,
      error: 'builder_generation_failed' as const,
      retryableGeneration: true,
    };
    const container = render(
      <BuilderPage
        activeFile={null}
        instruction=""
        snapshot={recoverable}
      />,
    );

    expect(container.querySelector('[data-builder-conversation-notice="generation_failed"]')).toBeNull();
    expect(container.querySelector('[data-builder-retry-draft="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-composer-stack="true"]')).not.toBeNull();
  });

  it('shows Stop only while AI work is active', async () => {
    const { fresh } = await snapshots();
    const readWire = await createReadWire();
    const controller = createBuilderProjectController({
      generator: {
        submit: async () => null,
        generate: async () => new Promise(() => undefined),
        continueDraft: async () => null,
        generateApprovedPlan: async () => null,
        proposePlan: async () => null,
        preparePlanSourceReadApproval: async () => PLAN_SOURCE_READ_READY,
        approvePlanSourceRead: async () => PLAN_SOURCE_READ_APPROVED,
        prepareCurrentProjectWriteApproval: async () => ({
          result_version: 'builder-current-project-write-approval-status.v1',
          project_id: PROJECT_ID,
          state: 'ready',
          approval_scope: 'current_project_write',
          authority: 'main_selected_project_project_edit_v1',
        }),
        approveCurrentProjectWrite: async () => ({
          result_version: 'builder-current-project-write-approval-result.v1',
          project_id: PROJECT_ID,
          operation: 'already_approved',
          approval_scope: 'current_project_write',
          authority: 'main_selected_project_project_edit_v1',
        }),
        retry: async () => null,
        answer: async () => null,
        answerDraft: async () => null,
        restoreDraft: async () => null,
        restoreRevisionAsDraft: async () => null,
        rejectDraft: async () => null,
        cancel: async (request) => ({ request_id: request.request_id, cancelled: true }),
        steer: async () => null,
        queueFollowup: async () => null,
      },
      workspace: {
        open: async (request) => (request.project_id === null ? null : readWire),
        openLocation: openProjectLocationSelection,
        createLocalProject: createLocalProjectSelectionCancelled,
        saveDraft: async () => null,
        loadCurrent: async () => null,
        loadRevision: async () => null,
        listCurrent: async () => ({ projects: [] }),
        listWorkspaces: async () => ({ workspaces: [] }),
        listHistory: async () => ({ revisions: [] }),
      },
    });
    await controller.open(PROJECT_ID);
    void controller.generate('Make a timer.');
    const onCancel = vi.fn();
    const container = render(
      <BuilderPage
        activeFile={null}
        instruction="Make a timer."
        onCancel={onCancel}
        snapshot={controller.getSnapshot()}
      />,
    );

    const notice = container.querySelector('[data-builder-conversation-notice="generating"]');
    const composer = container.querySelector('[data-builder-composer="true"]');
    expect(notice?.textContent).toContain('Making your draft...');
    expect(notice?.closest('[data-builder-chat-main="true"]')).not.toBeNull();
    expect(notice?.closest('[data-builder-composer="true"]')).toBeNull();
    expect(notice?.querySelector('[data-builder-cancel-work="true"]')).toBeNull();
    expect(composer?.querySelector('[data-builder-cancel-work="true"]')).not.toBeNull();
    expect(composer?.querySelector('[data-builder-submit-turn="true"]')).toBeNull();
    expect(composer?.querySelector('[data-builder-ask-question="true"]')).toBeNull();
    expect(composer?.querySelector('[data-builder-make-draft="true"]')).toBeNull();
    expect(composer?.querySelector('[data-builder-cancel-work="true"]')?.getAttribute('title'))
      .toBe('Stop');
    click(container, '[data-builder-cancel-work="true"]');
    expect(onCancel).toHaveBeenCalledOnce();

    const browserCancel = vi.fn();
    const browserActive = render(
      <BuilderPage
        activeAgentTestBrowserRunId="sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        activeFile={null}
        instruction=""
        onCancel={browserCancel}
        snapshot={fresh}
      />,
    );
    expect(browserActive.querySelector('[data-builder-cancel-work="true"]')).not.toBeNull();
    click(browserActive, '[data-builder-cancel-work="true"]');
    expect(browserCancel).toHaveBeenCalledOnce();

    const answerController = createBuilderProjectController({
      generator: {
        submit: async () => null,
        generate: async () => null,
        continueDraft: async () => null,
        generateApprovedPlan: async () => null,
        proposePlan: async () => null,
        preparePlanSourceReadApproval: async () => PLAN_SOURCE_READ_READY,
        approvePlanSourceRead: async () => PLAN_SOURCE_READ_APPROVED,
        prepareCurrentProjectWriteApproval: async () => ({
          result_version: 'builder-current-project-write-approval-status.v1',
          project_id: PROJECT_ID,
          state: 'ready',
          approval_scope: 'current_project_write',
          authority: 'main_selected_project_project_edit_v1',
        }),
        approveCurrentProjectWrite: async () => ({
          result_version: 'builder-current-project-write-approval-result.v1',
          project_id: PROJECT_ID,
          operation: 'already_approved',
          approval_scope: 'current_project_write',
          authority: 'main_selected_project_project_edit_v1',
        }),
        retry: async () => null,
        answer: async () => new Promise(() => undefined),
        answerDraft: async () => new Promise(() => undefined),
        restoreDraft: async () => null,
        restoreRevisionAsDraft: async () => null,
        rejectDraft: async () => null,
        cancel: async (request) => ({ request_id: request.request_id, cancelled: true }),
        steer: async () => null,
        queueFollowup: async () => null,
      },
      workspace: {
        open: async () => null,
        openLocation: openProjectLocationSelection,
        createLocalProject: createLocalProjectSelectionCancelled,
        saveDraft: async () => null,
        loadCurrent: async () => null,
        loadRevision: async () => null,
        listCurrent: async () => ({ projects: [] }),
        listWorkspaces: async () => ({ workspaces: [] }),
        listHistory: async () => ({ revisions: [] }),
      },
    });
    void answerController.answer('What does this project do?');
    const onCancelAnswer = vi.fn();
    const answering = render(
      <BuilderPage
        activeFile={null}
        instruction="What does this project do?"
        onCancel={onCancelAnswer}
        snapshot={answerController.getSnapshot()}
      />,
    );
    const answeringNotice = answering.querySelector('[data-builder-conversation-notice="answering"]');
    const answeringComposer = answering.querySelector('[data-builder-composer="true"]');
    expect(answeringNotice?.textContent).toContain('Answering...');
    expect(answeringNotice?.closest('[data-builder-chat-main="true"]')).not.toBeNull();
    expect(answeringNotice?.querySelector('[data-builder-cancel-work="true"]')).toBeNull();
    expect(answeringComposer?.querySelector('[data-builder-cancel-work="true"]')).not.toBeNull();
    expect(answeringComposer?.querySelector('[data-builder-submit-turn="true"]')).toBeNull();
    expect(answeringComposer?.querySelector('[data-builder-ask-question="true"]')).toBeNull();
    expect(answeringComposer?.querySelector('[data-builder-make-draft="true"]')).toBeNull();
    expect(answeringComposer?.querySelector('[data-builder-cancel-work="true"]')?.getAttribute('title'))
      .toBe('Stop');
    click(answering, '[data-builder-cancel-work="true"]');
    expect(onCancelAnswer).toHaveBeenCalledOnce();

    const idle = render(
      <BuilderPage
        activeFile={null}
        instruction="Make a timer."
        onCancel={onCancel}
        snapshot={fresh}
      />,
    );
    expect(idle.querySelector('[data-builder-cancel-work="true"]')).toBeNull();
  });

  it('lets the live assistant output replace the desktop busy notice', async () => {
    const controller = createBuilderProjectController({
      generator: {
        submit: async () => null,
        generate: async () => new Promise(() => undefined),
        continueDraft: async () => null,
        generateApprovedPlan: async () => null,
        proposePlan: async () => null,
        preparePlanSourceReadApproval: async () => PLAN_SOURCE_READ_READY,
        approvePlanSourceRead: async () => PLAN_SOURCE_READ_APPROVED,
        prepareCurrentProjectWriteApproval: async () => ({
          result_version: 'builder-current-project-write-approval-status.v1',
          project_id: PROJECT_ID,
          state: 'ready',
          approval_scope: 'current_project_write',
          authority: 'main_selected_project_project_edit_v1',
        }),
        approveCurrentProjectWrite: async () => ({
          result_version: 'builder-current-project-write-approval-result.v1',
          project_id: PROJECT_ID,
          operation: 'already_approved',
          approval_scope: 'current_project_write',
          authority: 'main_selected_project_project_edit_v1',
        }),
        retry: async () => null,
        answer: async () => null,
        answerDraft: async () => null,
        restoreDraft: async () => null,
        restoreRevisionAsDraft: async () => null,
        rejectDraft: async () => null,
        cancel: async () => null,
        steer: async () => null,
        queueFollowup: async () => null,
      },
      workspace: {
        open: async () => null,
        openLocation: openProjectLocationSelection,
        createLocalProject: createLocalProjectSelectionCancelled,
        saveDraft: async () => null,
        loadCurrent: async () => null,
        loadRevision: async () => null,
        listCurrent: async () => ({ projects: [] }),
        listWorkspaces: async () => ({ workspaces: [] }),
        listHistory: async () => ({ revisions: [] }),
      },
    });
    void controller.generate('Make a timer.');
    const container = render(
      <BuilderPage
        activeFile={null}
        instruction=""
        liveOutput={{
          state: 'streaming',
          request_id: 'builder-git-request:123e4567-e89b-42d3-a456-426614174000',
          project_id: PROJECT_ID,
          text: 'Planning the draft.',
          chunk_count: 1,
        }}
        snapshot={controller.getSnapshot()}
      />,
    );

    expect(container.querySelector('[data-builder-live-output="true"]')?.textContent)
      .toContain('Planning the draft.');
    expect(container.querySelector('[data-builder-conversation-notice="generating"]')).toBeNull();
    expect(container.textContent).not.toContain('Making your draft...');
  });

  it('uses the same desktop composer send command to add context while work is active', async () => {
    const readWire = await createReadWire();
    const controller = createBuilderProjectController({
      generator: {
        submit: async () => null,
        generate: async () => new Promise(() => undefined),
        continueDraft: async () => null,
        generateApprovedPlan: async () => null,
        proposePlan: async () => null,
        preparePlanSourceReadApproval: async () => PLAN_SOURCE_READ_READY,
        approvePlanSourceRead: async () => PLAN_SOURCE_READ_APPROVED,
        prepareCurrentProjectWriteApproval: async () => ({
          result_version: 'builder-current-project-write-approval-status.v1',
          project_id: PROJECT_ID,
          state: 'ready',
          approval_scope: 'current_project_write',
          authority: 'main_selected_project_project_edit_v1',
        }),
        approveCurrentProjectWrite: async () => ({
          result_version: 'builder-current-project-write-approval-result.v1',
          project_id: PROJECT_ID,
          operation: 'already_approved',
          approval_scope: 'current_project_write',
          authority: 'main_selected_project_project_edit_v1',
        }),
        retry: async () => null,
        answer: async () => null,
        answerDraft: async () => null,
        restoreDraft: async () => null,
        restoreRevisionAsDraft: async () => null,
        rejectDraft: async () => null,
        cancel: async (request) => ({ request_id: request.request_id, cancelled: true }),
        steer: async (request) => ({ request_id: request.request_id, steered: true }),
        queueFollowup: async () => null,
      },
      workspace: {
        open: async (request) => (request.project_id === null ? null : readWire),
        openLocation: openProjectLocationSelection,
        createLocalProject: createLocalProjectSelectionCancelled,
        saveDraft: async () => null,
        loadCurrent: async () => null,
        loadRevision: async () => null,
        listCurrent: async () => ({ projects: [] }),
        listWorkspaces: async () => ({ workspaces: [] }),
        listHistory: async () => ({ revisions: [] }),
      },
    });
    await controller.open(PROJECT_ID);
    void controller.generate('Make a timer.');
    const onCancel = vi.fn();
    const onSubmitInstruction = vi.fn();
    const container = render(
      <BuilderPage
        activeFile={null}
        instruction="Make it blue."
        liveOutput={{
          state: 'streaming',
          request_id: 'builder-git-request:123e4567-e89b-42d3-a456-426614174000',
          project_id: PROJECT_ID,
          text: 'Making the draft.',
          chunk_count: 1,
        }}
        onCancel={onCancel}
        onInstructionChange={vi.fn()}
        onSubmitInstruction={onSubmitInstruction}
        snapshot={controller.getSnapshot()}
      />,
    );

    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea');
    expect(textarea?.disabled).toBe(false);
    expect(textarea?.readOnly).toBe(false);
    expect(textarea?.getAttribute('aria-keyshortcuts')).toBe('Enter');
    expect(container.querySelector('[data-builder-cancel-work="true"]')).toBeNull();
    expect(container.querySelectorAll('[data-builder-composer-primary-action="true"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-builder-submit-turn="true"]')).toHaveLength(1);
    expect(container.querySelector('[data-builder-submit-turn="true"]')?.getAttribute('aria-label'))
      .toBe('Add context');
    expect(container.querySelector('[data-builder-composer="true"]')?.textContent)
      .not.toContain('Add context');

    const event = keyDown(container, '#builder-idea', { key: 'Enter' });
    expect(event.defaultPrevented).toBe(true);
    expect(onSubmitInstruction).toHaveBeenCalledOnce();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('shows draft recovery as a visible restoring state without save or stop actions', async () => {
    const readWire = await createReadWire();
    const restored = await createRestoredGenerationDraft(readWire.source_tree);
    let resolveRestore: (value: unknown) => void = () => {
      throw new Error('restore promise was not initialized');
    };
    const controller = createBuilderProjectController({
      generator: {
        submit: async (request) => createGenerationDraft(request),
        generate: async (request) => createGenerationDraft(request),
        continueDraft: async (request) => createGenerationDraft(
          await createBuilderGenerationRequest(request.instruction, PROJECT_ID),
        ),
        generateApprovedPlan: async () => null,
        proposePlan: async () => null,
        preparePlanSourceReadApproval: async () => PLAN_SOURCE_READ_READY,
        approvePlanSourceRead: async () => PLAN_SOURCE_READ_APPROVED,
        prepareCurrentProjectWriteApproval: async () => ({
          result_version: 'builder-current-project-write-approval-status.v1',
          project_id: PROJECT_ID,
          state: 'ready',
          approval_scope: 'current_project_write',
          authority: 'main_selected_project_project_edit_v1',
        }),
        approveCurrentProjectWrite: async () => ({
          result_version: 'builder-current-project-write-approval-result.v1',
          project_id: PROJECT_ID,
          operation: 'already_approved',
          approval_scope: 'current_project_write',
          authority: 'main_selected_project_project_edit_v1',
        }),
        retry: async (request) => createGenerationDraft(request),
        answer: async () => null,
        answerDraft: async () => null,
        restoreDraft: async () => new Promise((resolve) => {
          resolveRestore = resolve;
        }),
        restoreRevisionAsDraft: async () => null,
        rejectDraft: async () => null,
        cancel: async () => null,
        steer: async () => null,
        queueFollowup: async () => null,
      },
      workspace: {
        open: async () => readWire,
        openLocation: openProjectLocationSelection,
        createLocalProject: createLocalProjectSelectionCancelled,
        saveDraft: async () => null,
        loadCurrent: async () => null,
        loadRevision: async () => null,
        listCurrent: async () => ({ projects: [] }),
        listWorkspaces: async () => ({ workspaces: [] }),
        listHistory: async () => ({ revisions: [] }),
      },
    });
    await controller.open(PROJECT_ID);
    const restoring = controller.restoreDraft(DRAFT_ID);
    const container = render(
      <BuilderPage
        activeFile={null}
        instruction=""
        onSubmitInstruction={vi.fn()}
        snapshot={controller.getSnapshot()}
      />,
    );

    const notice = container.querySelector('[data-builder-conversation-notice="restoring"]');
    const composer = container.querySelector('[data-builder-composer="true"]');
    expect(notice?.textContent).toContain('Restoring draft for review...');
    expect(notice?.closest('[data-builder-chat-main="true"]')).not.toBeNull();
    expect(notice?.closest('[data-builder-composer="true"]')).toBeNull();
    expect(composer?.querySelector('[data-builder-busy-work="true"]')?.getAttribute('title'))
      .toBe('Restoring draft...');
    expect(composer?.querySelector('[data-builder-cancel-work="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-discard-draft="true"]')).toBeNull();

    resolveRestore(restored);
    await restoring;
  });

  it('shows an unsaved draft with a composer version decision card', async () => {
    const { draftReady } = await snapshots();
    const activity = await candidateProgressActivity();
    const onSave = vi.fn();
    const onRejectDraft = vi.fn();
    const onUndoDraft = vi.fn();
    const container = render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={activity}
        instruction="Add a timer."
        onRejectDraft={onRejectDraft}
        onSave={onSave}
        onUndoDraft={onUndoDraft}
        snapshot={draftReady}
      />,
    );

    expect(container.querySelector('[data-builder-unsaved-draft="true"]')?.textContent)
      .toContain('Unsaved draft');
    expect(container.querySelector('[data-builder-current-version="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-composer-review-gate="true"]')).toBeNull();
    const proposal = container.querySelector('[data-builder-activity-card="Draft proposed"]');
    expect(proposal?.querySelector('[data-builder-completion-summary="true"]')).toBeNull();
    expect(proposal?.querySelector('[data-builder-completed-actions="true"]')).toBeNull();
    expect(proposal?.textContent).not.toContain('Work details');
    expect(proposal?.textContent).not.toContain('The review workspace is ready before saving this version.');
    expect(proposal?.textContent).not.toContain('What happened');
    expect(proposal?.textContent).not.toContain('A small project.');
    expect(container.querySelector('[data-builder-workspace-materialization="materialized"]')?.textContent)
      .toContain('Project folder updated');
    expect(container.querySelector('[data-builder-review-checkpoint="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-artifact-summary="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-composer="true"]')?.getAttribute('data-builder-composer-state'))
      .toBe('draft-ready');
    expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value).toBe('Add a timer.');
    expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.placeholder)
      .toBe('Ask about this draft, or describe the next change...');
    expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.readOnly).toBe(true);
    expect(container.querySelector('[data-builder-composer-review-focus="true"]')).toBeNull();
    expect(container.querySelector<HTMLButtonElement>('[data-builder-submit-turn="true"]')?.disabled)
      .toBe(true);
    expect(container.querySelector('[data-builder-check-run-status="passed"]')).toBeNull();
    const decision = container.querySelector('[data-builder-composer-version-decision="true"]');
    expect(decision).not.toBeNull();
    expect(decision?.closest('[data-builder-chat-main="true"]')).not.toBeNull();
    expect(decision?.closest('[data-builder-workspace-controls="true"]')).toBeNull();
    expect(decision?.textContent).toContain('Draft ready for review');
    expect(container.querySelector('[data-builder-undo-draft="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-review-more="true"]')).toBeNull();
    expect(decision?.querySelector('[data-builder-save-version="true"]')?.textContent)
      .toContain('Save version');
    expect(decision?.querySelector('[data-builder-discard-draft="true"]')?.textContent)
      .toContain('Discard draft');
    click(container, '[data-builder-save-version="true"]');
    click(container, '[data-builder-discard-draft="true"]');
    expect(onRejectDraft).toHaveBeenCalledOnce();
    expect(onSave).toHaveBeenCalledOnce();
    expect(onUndoDraft).not.toHaveBeenCalled();
  });

  it('hides draft decisions while a cancelled run is still finishing', async () => {
    const { draftReady } = await snapshots();
    const activity = await pendingToolActivity({ reviewReady: true });
    expect(activity.status).toBe('ready');
    const onSave = vi.fn();
    const onRejectDraft = vi.fn();
    const container = render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={activity}
        instruction=""
        onRejectDraft={onRejectDraft}
        onSave={onSave}
        snapshot={draftReady}
      />,
    );

    expect(container.querySelector('[data-builder-composer-version-decision="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-discard-draft="true"]')).toBeNull();
    expect(onSave).not.toHaveBeenCalled();
    expect(onRejectDraft).not.toHaveBeenCalled();
  });

  it('shows concrete changed files and check commands that open their inspectors', async () => {
    const draftReady = await changedDraftSnapshot();
    const draftId = draftReady.draft?.draft_id;
    expect(draftId).toBeDefined();
    const wire = createTaskStreamWire();
    const controller = createBuilderConversationController(taskStreamPort(async () => ({
      ...wire,
      review_state_projection: readyReviewStateProjection(),
      conversation: {
        ...wire.conversation,
        items: wire.conversation.items.map((item) => (
          item.item_kind === 'run_completed' && item.candidate !== null
            ? { ...item, candidate: { ...item.candidate, draft_id: draftId as string } }
            : item
        )),
      },
    })));
    const activity = await controller.load(PROJECT_ID, TASK_ADDRESS_ID);
    const onSelectFile = vi.fn();
    const container = render(
      <BuilderPage
        activeFile={null}
        checkRunProfiles={[{
          command_profile_id: `builder-command-profile:${'1'.repeat(32)}`,
          command_kind: 'test',
          command_display: 'npm test',
          requires_user_approval: true,
        }]}
        checkRunStatus={{
          projection_version: 'builder-check-run-status-projection.v1',
          project_id: PROJECT_ID,
          candidate_id: `builder-code-change-candidate:${'2'.repeat(64)}`,
          check_run_id: `builder-check-run:${'3'.repeat(32)}`,
          command_kind: 'test',
          command_label: 'Tests',
          status: 'passed',
          label: 'Checked',
          summary: 'Tests passed.',
          environment_reason: 'none',
          completed_at_ms: 1234,
          result_digest: `sha256:${'4'.repeat(64)}`,
        }}
        conversationSnapshot={activity}
        instruction=""
        onSelectFile={onSelectFile}
        snapshot={draftReady}
      />,
    );

    const fileGroup = container.querySelector('[data-builder-completed-action-group="file"]');
    const fileActions = fileGroup?.querySelector<HTMLDetailsElement>('[data-builder-completed-actions="file"]');
    const commandGroup = container.querySelector('[data-builder-completed-action-group="command"]');
    const proposal = container.querySelector('[data-builder-activity-card="Draft proposed"]');
    const turnTail = proposal?.querySelector('[data-builder-turn-tail="true"]');
    expect(fileGroup).not.toBeNull();
    expect(turnTail?.getAttribute('data-builder-turn-tail-result')).toBe('candidate');
    expect(turnTail?.querySelector('[data-builder-message-actions="true"]')).not.toBeNull();
    expect(turnTail?.querySelector('[data-builder-turn-tail-meta="true"]')?.textContent).toContain('Draft proposed');
    expect(fileGroup?.closest('[data-builder-turn-tail="true"]')).toBe(turnTail);
    expect(commandGroup?.closest('[data-builder-turn-tail="true"]')).toBe(turnTail);
    expect(fileActions?.open).toBe(true);
    expect(fileActions?.textContent).toContain('Edited 3 files');
    expect(commandGroup?.textContent).toContain('Ran npm test');
    expect(commandGroup?.querySelector('details')).toBeNull();
    expect(proposal?.querySelector('[data-builder-completed-actions="true"]')).toBeNull();
    expect((proposal?.compareDocumentPosition(fileGroup as Node) ?? 0) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect((fileGroup?.compareDocumentPosition(commandGroup as Node) ?? 0) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    const fileAction = container.querySelector<HTMLButtonElement>(
      '[data-builder-completion-candidate-change] button',
    );
    expect(fileAction?.textContent).toMatch(/(?:Added|Edited|Deleted) .+\+\d+ -\d+/u);
    click(container, '[data-builder-completion-candidate-change] button');
    expect(onSelectFile).toHaveBeenCalled();
    expect(container.querySelector('[data-builder-artifact-sidebar="true"]')?.getAttribute('data-builder-artifact-tab-active'))
      .toBe('source');

    const commandAction = container.querySelector<HTMLButtonElement>(
      '[data-builder-completion-command="npm test"] button',
    );
    expect(commandAction?.textContent).toContain('Ran npm test');
    click(container, '[data-builder-completion-command="npm test"] button');
    expect(container.querySelector('[data-builder-command-inspector="true"]')).not.toBeNull();
    expect(container.querySelector('[data-builder-command-display="true"]')?.textContent).toBe('npm test');
    expect(container.querySelector('[data-builder-command-result="passed"]')?.textContent).toBe('Tests passed.');
  });

  it('copies a completed assistant response from the turn tail', async () => {
    const { draftReady } = await snapshots();
    const activity = await candidateActivity();
    const writeText = vi.fn(() => Promise.resolve());
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const container = render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={activity}
        instruction=""
        snapshot={draftReady}
      />,
    );

    try {
      const completion = container.querySelector('[data-builder-activity-card="Draft proposed"]');
      expect(completion?.querySelector('[data-builder-turn-tail="true"]')).not.toBeNull();
      click(container, '[data-builder-copy-run-message="true"]');
      await act(async () => { await Promise.resolve(); });
      expect(writeText).toHaveBeenCalledExactlyOnceWith('I prepared a draft for review.');
      expect(completion?.querySelector('[data-builder-copy-run-message="true"]')?.textContent)
        .toContain('Copied');
    } finally {
      if (clipboardDescriptor === undefined) {
        Reflect.deleteProperty(navigator, 'clipboard');
      } else {
        Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
      }
    }
  });

  it('projects an explicit Save version command as activity while saving', async () => {
    const { controller } = await snapshots();
    const activity = await candidateProgressActivity();
    const save = controller.save();
    const saving = controller.getSnapshot();
    const container = render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={activity}
        instruction=""
        onSave={vi.fn()}
        snapshot={saving}
      />,
    );

    expect(saving.status).toBe('saving');
    const savingActivity = container.querySelector('[data-builder-agent-current-activity="saving_version"]');
    expect(savingActivity?.getAttribute('data-builder-activity-role')).toBe('status');
    expect(savingActivity?.textContent).toContain('Saving version');
    expect(savingActivity?.textContent).toContain('Recording this draft as a saved project version.');
    expect(container.querySelector('[data-builder-conversation-notice="saving"]')).toBeNull();
    expect(container.querySelector('[data-builder-review-more="true"]')).toBeNull();
    const decision = container.querySelector('[data-builder-composer-version-decision="true"]');
    expect(decision).toBeNull();
    await save;
  });

  it('keeps the automatic checkpoint as a quiet fact in the conversation', async () => {
    const { draftReady } = await snapshots();
    const activity = await candidateCheckpointActivity();
    const onUndoDraft = vi.fn();
    const container = render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={activity}
        instruction="Add a timer."
        onUndoDraft={onUndoDraft}
        snapshot={draftReady}
      />,
    );

    const checkpoint = container.querySelector('[data-builder-draft-checkpoint-status="ready"]');
    expect(checkpoint?.textContent).toContain('检查点已更新');
    expect(checkpoint?.textContent).toContain('2 个文件已受到保护');
    expect(checkpoint?.classList.contains('cf-builder-checkpoint-event-row')).toBe(true);
    expect(checkpoint?.getAttribute('data-builder-conversation-node')).toBe('checkpoint_event');
    expect(checkpoint?.getAttribute('data-builder-checkpoint-turn-event')).toBe('updated');
    expect(checkpoint?.getAttribute('data-builder-checkpoint-animation')).toBe('settle');
    expect(checkpoint?.getAttribute('data-builder-recovery-action')).toBe('checkpoint_updated');
    expect(checkpoint?.getAttribute('data-builder-recovery-tone')).toBe('success');
    const recoveryActions = checkpoint?.querySelector('[data-builder-recovery-actions="checkpoint"]');
    expect(recoveryActions).not.toBeNull();
    expect(recoveryActions?.querySelector('[data-builder-recovery-action-command="undo_checkpoint"]')).not.toBeNull();
    expect(recoveryActions?.querySelector('[data-builder-recovery-action-command="open_history"]')).not.toBeNull();
    expect(checkpoint?.querySelector<HTMLButtonElement>('[data-builder-chat-undo-checkpoint="true"]')?.disabled)
      .toBe(false);
    expect(checkpoint?.closest('[data-builder-conversation-workspace="true"]')).not.toBeNull();
    expect(checkpoint?.closest('header')).toBeNull();
    expect(checkpoint?.getAttribute('title')).toBeNull();
    click(container, '[data-builder-chat-undo-checkpoint="true"]');
    expect(onUndoDraft).toHaveBeenCalledOnce();
    click(container, '[data-builder-chat-open-history="true"]');
    expect(container.querySelector('[data-builder-project-history="true"]')).not.toBeNull();
    expect(checkpoint?.textContent).not.toMatch(/sha256:|checkpoint_store|receipt|sqlite|credential|provider/iu);
  });

  it('keeps checkpoint history available while disabling undo without a current draft', async () => {
    const { saved } = await snapshots();
    const activity = await candidateCheckpointActivity();
    const onUndoDraft = vi.fn();
    const container = render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={activity}
        instruction=""
        onUndoDraft={onUndoDraft}
        snapshot={saved}
      />,
    );

    const checkpoint = container.querySelector('[data-builder-checkpoint-turn-event="updated"]');
    const undo = checkpoint?.querySelector<HTMLButtonElement>('[data-builder-chat-undo-checkpoint="true"]');
    expect(checkpoint?.getAttribute('data-builder-conversation-node')).toBe('checkpoint_event');
    expect(undo?.disabled).toBe(true);
    click(container, '[data-builder-chat-open-history="true"]');
    expect(container.querySelector('[data-builder-project-history="true"]')).not.toBeNull();
    expect(onUndoDraft).not.toHaveBeenCalled();
  });

  it('shows a bounded run-control request as a recovery action row', async () => {
    const wire = createTaskStreamWire();
    const controller = createBuilderConversationController(taskStreamPort(async () => ({
      ...wire,
      conversation: {
        ...wire.conversation,
        head_sequence: 3,
        recorded_active_turn_id: TURN_ID,
        window: {
          first_sequence: 1,
          last_sequence: 3,
          has_earlier: false,
        },
        items: [
          wire.conversation.items[0],
          wire.conversation.items[1],
          {
            item_kind: 'run_control_requested',
            sequence: 3,
            turn_id: TURN_ID,
            run_id: RUN_ID,
            action: 'cancel',
          },
        ],
      },
    })));
    const activity = await controller.load(PROJECT_ID, TASK_ADDRESS_ID);
    expect(activity.status).toBe('ready');
    const { saved } = await snapshots();
    const container = render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={activity}
        instruction=""
        snapshot={saved}
      />,
    );

    const control = container.querySelector('[data-builder-recovery-action="cancel_requested"]');
    expect(control?.textContent).toContain('Stop requested');
    expect(control?.textContent).toContain('You asked to stop the current work.');
    expect(control?.getAttribute('data-builder-recovery-tone')).toBe('pending');
    expect(container.textContent).not.toMatch(/cancel-request|request_id|sha256:/iu);
  });

  it('updates a recovery action row in place as the restore completes', async () => {
    const wire = createTaskStreamWire();
    const controller = createBuilderConversationController(taskStreamPort(async () => ({
      ...wire,
      conversation: {
        ...wire.conversation,
        head_sequence: 5,
        recorded_active_turn_id: TURN_ID,
        window: {
          first_sequence: 1,
          last_sequence: 5,
          has_earlier: false,
        },
        items: [wire.conversation.items[0], wire.conversation.items[1], {
          item_kind: 'run_context_snapshot_recorded',
          sequence: 3,
          turn_id: TURN_ID,
          run_id: RUN_ID,
          task_id: TASK_ID,
          context: {
            recorded_state: 'recorded',
            route: 'build',
            dispatch: 'build',
            downgraded_from: null,
            downgrade_reason: null,
            brief: 'not_available',
            base: 'new_project_or_unsaved',
            permission_result: 'allowed',
            command_execution: 'not_included',
            network_access: 'not_included',
          },
        }, {
          item_kind: 'recovery_action_recorded',
          sequence: 4,
          turn_id: TURN_ID,
          run_id: RUN_ID,
          action: 'restore_checkpoint',
          phase: 'requested',
        }, {
          item_kind: 'recovery_action_recorded',
          sequence: 5,
          turn_id: TURN_ID,
          run_id: RUN_ID,
          action: 'restore_checkpoint',
          phase: 'completed',
        }],
      },
    })));
    const activity = await controller.load(PROJECT_ID, TASK_ADDRESS_ID);
    expect(activity.status).toBe('ready');
    const { saved } = await snapshots();
    const container = render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={activity}
        instruction=""
        snapshot={saved}
      />,
    );

    const rows = container.querySelectorAll('[data-builder-recovery-action^="restore_checkpoint_"]');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.getAttribute('data-builder-recovery-action')).toBe('restore_checkpoint_completed');
    expect(rows[0]?.getAttribute('data-builder-recovery-tone')).toBe('success');
    expect(rows[0]?.textContent).toContain('已恢复上个检查点');
    expect(rows[0]?.textContent).toContain('恢复结果已写入当前项目');
  });

  it('blocks draft decisions when Review State has no verified checkpoint', async () => {
    const { draftReady } = await snapshots();
    const activity = await candidateBlockedReviewActivity();
    const onSave = vi.fn();
    const onRejectDraft = vi.fn();
    const container = render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={activity}
        instruction="Add a timer."
        onRejectDraft={onRejectDraft}
        onSave={onSave}
        snapshot={draftReady}
      />,
    );

    const decision = container.querySelector('[data-builder-composer-version-decision="true"]');
    expect(decision).toBeNull();
    expect(container.textContent).not.toContain('Checking draft');
    expect(container.textContent).not.toContain('Finishing checks');
    expect(container.textContent).not.toContain('Save this draft?');
    expect(container.textContent).not.toContain('verified draft checkpoint');
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-discard-draft="true"]')).toBeNull();
    expect(onSave).not.toHaveBeenCalled();
    expect(onRejectDraft).not.toHaveBeenCalled();
  });

  it('blocks Save and explains the current candidate check failure', async () => {
    const { draftReady } = await snapshots();
    const activity = await candidateFailedCheckActivity();
    const onSave = vi.fn();
    const container = render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={activity}
        instruction="Add a timer."
        onSave={onSave}
        snapshot={draftReady}
      />,
    );

    const decision = container.querySelector('[data-builder-composer-version-decision="true"]');
    expect(decision).toBeNull();
    expect(container.textContent).not.toContain('Finishing checks');
    expect(container.textContent).not.toContain('Save this draft?');
    expect(container.textContent).not.toContain('project check failed');
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('shows a main-owned running check after generation work has completed', async () => {
    const { draftReady } = await snapshots();
    const activity = await candidateRunningCheckActivity();
    const container = render(
      <BuilderPage
        activeFile={null}
        checkRunOperation="running"
        conversationSnapshot={activity}
        instruction="Add a timer."
        snapshot={draftReady}
      />,
    );

    const status = container.querySelector('[data-builder-agent-current-activity="running_checks"]');
    const checkStatus = container.querySelector('[data-builder-check-run-operation="running"]');
    expect(status).toBeNull();
    expect(checkStatus?.getAttribute('data-builder-check-run-presentation')).toBe('compact');
    expect(checkStatus?.closest('[data-builder-workspace-controls="true"]')).not.toBeNull();
    expect(checkStatus?.querySelector('span')?.classList.contains('cf-builder-visually-hidden')).toBe(true);
    expect(container.textContent).not.toContain('Save this draft?');
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
    expect(container.textContent).not.toContain('Checking the current draft before it is saved.');
    expect(container.textContent).not.toMatch(/sha256|candidate_id|credential/iu);
  });

  it('keeps duplicate review shortcuts out of the draft composer', async () => {
    const { draftReady } = await snapshots();
    const activity = await candidateActivity();
    const onInstructionChange = vi.fn();
    const onSubmitInstruction = vi.fn();
    const onSave = vi.fn();
    const onRejectDraft = vi.fn();
    const onUndoDraft = vi.fn();
    const container = render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={activity}
        instruction="Add a timer."
        onInstructionChange={onInstructionChange}
        onRejectDraft={onRejectDraft}
        onSave={onSave}
        onUndoDraft={onUndoDraft}
        onSubmitInstruction={onSubmitInstruction}
        snapshot={draftReady}
      />,
    );

    expect(container.querySelector('[data-builder-composer-review-gate="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-composer-review-focus="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-review-checkpoint="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-artifact-summary="true"]')).toBeNull();
    expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value).toBe('Add a timer.');
    expect(onSubmitInstruction).not.toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
    expect(onRejectDraft).not.toHaveBeenCalled();
  });

  it('binds Enter to continuing an unsaved draft without saving or discarding', async () => {
    const { draftReady } = await snapshots();
    const activity = await candidateActivity();
    const onSubmitInstruction = vi.fn();
    const onSave = vi.fn();
    const onRejectDraft = vi.fn();
    const container = render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={activity}
        instruction="Add a timer."
        onRejectDraft={onRejectDraft}
        onSave={onSave}
        onSubmitInstruction={onSubmitInstruction}
        snapshot={draftReady}
      />,
    );

    const event = keyDown(container, '#builder-idea', { key: 'Enter' });

    expect(event.defaultPrevented).toBe(true);
    expect(container.querySelector('#builder-idea')?.getAttribute('aria-keyshortcuts'))
      .toBe('Enter');
    expect(onSubmitInstruction).toHaveBeenCalledOnce();
    expect(onSave).not.toHaveBeenCalled();
    expect(onRejectDraft).not.toHaveBeenCalled();
  });

  it('keeps the composer and review in chat while opening preview and changes in the artifact sidebar', async () => {
    const { draftReady } = await snapshots();
    const activity = await candidateActivity();
    const history = await savedHistory();
    const onSubmitInstruction = vi.fn();
    const onRefreshConversation = vi.fn();
    const onOpenProjectLocation = vi.fn();
    const onRejectDraft = vi.fn();
    const onSave = vi.fn();
    const container = render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={activity}
        historySnapshot={history}
        instruction="Add a timer."
        onRefreshConversation={onRefreshConversation}
        onOpenProjectLocation={onOpenProjectLocation}
        onRejectDraft={onRejectDraft}
        onSave={onSave}
        onSubmitInstruction={onSubmitInstruction}
        snapshot={draftReady}
      />,
    );

    expect(container.querySelector('[data-builder-chat-workspace="true"]')
      ?.getAttribute('data-builder-artifact-sidebar-visible')).toBe('false');
    expect(container.querySelector('[data-builder-artifact-sidebar="true"]')).toBeNull();
    click(container, '[data-builder-workspace-menu-button="true"]');
    click(container, '[data-builder-workspace-control-tab="preview"]');

    const chatMain = container.querySelector('[data-builder-chat-main="true"]');
    const workspace = container.querySelector('[data-builder-chat-workspace="true"]');
    const conversation = container.querySelector('[data-builder-conversation-workspace="true"]');
    const composer = container.querySelector('[data-builder-composer="true"]');
    const artifactSidebar = container.querySelector('[data-builder-artifact-sidebar="true"]');
    const workspaceControls = container.querySelector('[data-builder-workspace-controls="true"]');
    const preview = container.querySelector('[data-builder-preview-flow="true"]');
    const code = container.querySelector('[data-builder-code-flow="true"]');
    const source = container.querySelector('[data-builder-source-flow="true"]');
    const versionDecision = container.querySelector('[data-builder-composer-version-decision="true"]');
    expect(chatMain).not.toBeNull();
    expect(workspace?.getAttribute('data-builder-artifact-sidebar-visible')).toBe('true');
    expect(artifactSidebar).not.toBeNull();
    expect(artifactSidebar?.getAttribute('data-builder-artifact-tab-active')).toBe('preview');
    const sideWorkspaceTabs = artifactSidebar?.querySelector('[data-builder-side-workspace-tabs="true"]');
    expect(sideWorkspaceTabs).not.toBeNull();
    expect(sideWorkspaceTabs?.querySelector('[role="tablist"]')).not.toBeNull();
    expect(sideWorkspaceTabs?.querySelector('[data-builder-side-workspace-tool="preview"]')?.getAttribute('aria-selected'))
      .toBe('true');
    expect(sideWorkspaceTabs?.querySelector('[data-builder-side-workspace-tool="preview"] [data-builder-side-workspace-tab-label="active"]')?.textContent)
      .toBe('Preview');
    expect(sideWorkspaceTabs?.querySelector('[data-builder-side-workspace-tool="preview"]')
      ?.getAttribute('data-builder-side-workspace-tab-kind'))
      .toBe('browser');
    expect(artifactSidebar?.querySelector('[data-builder-side-workspace-browser-toolbar="true"]'))
      .not.toBeNull();
    expect(artifactSidebar?.querySelector<HTMLInputElement>('[data-builder-side-workspace-browser-address="true"] input')?.value)
      .toBe('Project preview');
    expect(artifactSidebar?.querySelector('[data-builder-live-preview-panel="true"]')
      ?.getAttribute('data-builder-live-preview-status'))
      .toBe('unknown');
    expect(artifactSidebar?.querySelector('[data-builder-result-placement="artifact"] .cf-builder-result-toolbar'))
      .toBeNull();
    expect(artifactSidebar?.querySelector('[data-builder-live-preview-start="true"]'))
      .not.toBeNull();
    expect(artifactSidebar?.querySelector('[data-builder-live-preview-reload="true"]'))
      .not.toBeNull();
    expect(artifactSidebar?.querySelector('[data-builder-live-preview-stop="true"]'))
      .not.toBeNull();
    expect(artifactSidebar?.querySelector('[data-builder-live-preview-blocked-count="true"]'))
      .toBeNull();
    expect(sideWorkspaceTabs?.querySelector('[data-builder-side-workspace-tool="changes"]')).toBeNull();
    expect(sideWorkspaceTabs?.querySelector('[data-builder-side-workspace-tool="permissions"]')).toBeNull();
    expect(sideWorkspaceTabs?.textContent).toContain('Preview');
    expect(sideWorkspaceTabs?.textContent).not.toContain('Changes');
    const artifactResizeHandle = artifactSidebar?.querySelector('[data-builder-artifact-resize-handle="true"]');
    expect(artifactResizeHandle).not.toBeNull();
    expect(artifactResizeHandle?.getAttribute('role')).toBe('separator');
    expect(artifactResizeHandle?.getAttribute('aria-label')).toBe('Resize artifact panel');
    expect(artifactResizeHandle?.getAttribute('aria-orientation')).toBe('vertical');
    expect(artifactResizeHandle?.getAttribute('aria-valuemin')).toBe('320');
    expect(artifactResizeHandle?.getAttribute('aria-valuenow')).toBe('400');
    expect(artifactResizeHandle?.getAttribute('data-builder-artifact-resizing')).toBeNull();
    expect(workspaceControls).not.toBeNull();
    expect(workspaceControls?.getAttribute('data-builder-workspace-drawer-visible')).toBe('true');
    expect(workspaceControls?.textContent).not.toContain('Terminal');
    expect(workspaceControls?.textContent).not.toContain('Open location');
    expect(workspaceControls?.textContent).not.toContain('Preview');
    expect(container.querySelector('[data-builder-open-project-location="true"]')?.getAttribute('aria-label'))
      .toBe('Open project folder');
    expect(container.querySelector('[data-builder-workspace-menu-button="true"]')?.getAttribute('aria-label'))
      .toBe('Workspace menu');
    expect(container.querySelector('[data-builder-artifact-view-button="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-artifact-view-menu="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-workspace-menu-button="true"]')?.getAttribute('aria-expanded'))
      .toBe('false');
    expect(container.querySelector('[data-builder-workspace-menu="true"]')).toBeNull();
    click(container, '[data-builder-workspace-menu-button="true"]');
    const workspaceMenu = container.querySelector('[data-builder-workspace-menu="true"]');
    expect(workspaceMenu).not.toBeNull();
    expect(workspaceMenu?.textContent).toContain('Preview');
    expect(workspaceMenu?.textContent).toContain('Changes');
    expect(workspaceMenu?.textContent).toContain('History');
    expect(workspaceMenu?.textContent).toContain('Permissions');
    expect(workspaceMenu?.textContent).toContain('Terminal');
    expect(container.querySelector('[data-builder-workspace-control-tab="preview"]')?.getAttribute('aria-pressed'))
      .toBeNull();
    expect(container.querySelector('[data-builder-workspace-control-tab="preview"]')?.getAttribute('aria-checked'))
      .toBe('true');
    expect(container.querySelector('[data-builder-workspace-control-tab="changes"]')).not.toBeNull();
    expect(container.querySelector('[data-builder-workspace-control-tab="versions"]')).not.toBeNull();
    expect(container.querySelector('[data-builder-workspace-control-tab="permissions"]')).not.toBeNull();
    expect(container.querySelector('[data-builder-workspace-control-tab="source"]')?.textContent).toContain('Files');
    click(container, '[data-builder-side-workspace-new-tab-button="true"]');
    const newTabMenu = container.querySelector('[data-builder-side-workspace-new-tab-menu="true"]');
    expect(newTabMenu).not.toBeNull();
    expect(newTabMenu?.textContent).toContain('File');
    expect(newTabMenu?.textContent).toContain('Side Chat');
    expect(newTabMenu?.textContent).toContain('Browser');
    expect(newTabMenu?.textContent).toContain('Terminal');
    expect(newTabMenu?.textContent).toContain('Review');
    expect(newTabMenu?.querySelector('[data-builder-side-workspace-new-tab-kind="browser"]')?.textContent)
      .toContain('Open');
    expect(newTabMenu?.querySelector('[data-builder-side-workspace-new-tab-kind="file"]')?.textContent)
      .toContain('Add');
    expect(newTabMenu?.querySelector('[data-builder-side-workspace-new-tab-kind="review"]')?.textContent)
      .toContain('Add');
    expect(newTabMenu?.querySelector('[data-builder-side-workspace-new-tab-kind="side_chat"]')?.textContent)
      .toContain('Add');
    expect(newTabMenu?.querySelector('[data-builder-side-workspace-new-tab-kind="terminal"]')
      ?.getAttribute('aria-disabled'))
      .toBe('false');
    const stablePreview = container.querySelector('[data-builder-static-preview="true"]');
    expect(stablePreview).not.toBeNull();
    stablePreview?.setAttribute('data-test-stable-preview', 'true');
    click(container, '[data-builder-side-workspace-new-tab-kind="terminal"]');
    const retainedPreview = container.querySelector('[data-test-stable-preview="true"]');
    expect(retainedPreview).toBe(stablePreview);
    expect(retainedPreview?.closest('[data-builder-live-preview-panel="true"]')?.hasAttribute('hidden'))
      .toBe(true);
    click(container, '[data-builder-side-workspace-tool="preview"]');
    expect(container.querySelector('[data-test-stable-preview="true"]')).toBe(stablePreview);
    expect(stablePreview?.closest('[data-builder-live-preview-panel="true"]')?.hasAttribute('hidden'))
      .toBe(false);
    click(container, '[data-builder-workspace-control-tab="preview"]');
    expect(container.querySelector('[data-builder-workspace-menu="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-minimize-artifact="true"]')?.getAttribute('aria-label'))
      .toBe('Minimize artifact panel');
    expect(container.querySelector('[data-builder-toggle-artifact="true"]')?.getAttribute('aria-label'))
      .toBe('Hide artifact panel');
    expect(container.querySelector('[data-builder-close-artifact-sidebar="true"]')).toBeNull();
    expect(conversation).not.toBeNull();
    expect(container.querySelector('[data-builder-draft-landing="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-review-checkpoint="true"]')).toBeNull();
    expect(composer).not.toBeNull();
    expect(container.querySelector('[data-builder-artifact-summary="true"]')).toBeNull();
    expect(preview).not.toBeNull();
    expect(code).toBeNull();
    expect(source).toBeNull();
    expect(versionDecision).not.toBeNull();
    expect(versionDecision?.closest('[data-builder-workspace-controls="true"]')).toBeNull();
    expect(versionDecision?.closest('[data-builder-chat-main="true"]')).toBe(chatMain);
    expect(conversation?.closest('[data-builder-chat-main="true"]')).toBe(chatMain);
    expect(preview?.closest('[data-builder-chat-main="true"]')).toBeNull();
    expect(preview?.closest('[data-builder-artifact-sidebar="true"]')).toBe(artifactSidebar);
    expect(preview?.closest('[data-builder-draft-landing="true"]')).toBeNull();
    expect(conversation?.classList.contains('cf-builder-chat-flow-surface')).toBe(true);
    expect(preview?.classList.contains('cf-builder-chat-flow-surface')).toBe(false);
    expect(preview?.getAttribute('aria-label')).toBe('Project result');
    expect(preview?.querySelector('.cf-builder-result-toolbar')).toBeNull();
    expect(preview?.textContent).not.toContain('Preview is isolated');
    expect(composer?.closest('[data-builder-chat-main="true"]')).toBe(chatMain);
    expect(composer?.closest('[data-builder-artifact-sidebar="true"]')).toBeNull();
    expect(composer?.querySelector('.cf-builder-alert')).toBeNull();
    expect(container.querySelector('[data-builder-changes-panel="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-changes-disclosure="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-version-history="true"]')).toBeNull();
    expect(conversation?.querySelector('.cf-builder-side-header')).toBeNull();
    expect(conversation?.textContent).not.toContain('Work stream');
    expect(conversation?.querySelector('[data-builder-activity-toolbar="true"]')).toBeNull();
    expect(conversation?.querySelector('[data-builder-refresh-activity="true"]')).toBeNull();
    expect(Boolean(conversation!.compareDocumentPosition(composer!) & Node.DOCUMENT_POSITION_FOLLOWING))
      .toBe(true);
    expect(container.querySelector('[data-builder-workspace-draft-actions="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-review-more="true"]')).toBeNull();
    expect(versionDecision?.closest('[data-builder-review-checkpoint="true"]')).toBeNull();
    expect(versionDecision?.querySelector('[data-builder-save-version="true"]')).not.toBeNull();
    expect(versionDecision?.querySelector('[data-builder-discard-draft="true"]')).not.toBeNull();
    let workspaceWidth = 920;
    Object.defineProperty(workspace, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        bottom: 720,
        height: 640,
        left: 0,
        right: workspaceWidth,
        top: 80,
        width: workspaceWidth,
      }),
    });
    Object.defineProperty(artifactSidebar, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ bottom: 720, height: 640, left: 440, right: 920, top: 80, width: 480 }),
    });
    const previousBodyCursor = document.body.style.cursor;
    const previousBodyUserSelect = document.body.style.userSelect;
    workspaceWidth = 640;
    act(() => { window.dispatchEvent(new Event('resize')); });
    expect((workspace as HTMLElement).style.getPropertyValue('--cf-builder-artifact-width'))
      .toBe('320px');
    workspaceWidth = 920;
    act(() => { window.dispatchEvent(new Event('resize')); });
    expect((workspace as HTMLElement).style.getPropertyValue('--cf-builder-artifact-width'))
      .toBe('400px');
    act(() => {
      artifactResizeHandle?.dispatchEvent(new MouseEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        clientX: 900,
      }));
    });
    expect(container.querySelector('[data-builder-artifact-resize-handle="true"]')
      ?.getAttribute('data-builder-artifact-resizing')).toBe('true');
    expect(document.body.style.cursor).toBe('col-resize');
    expect(document.body.style.userSelect).toBe('none');
    act(() => {
      window.dispatchEvent(new MouseEvent('pointermove', {
        bubbles: true,
        clientX: 500,
      }));
      window.dispatchEvent(new MouseEvent('pointerup', {
        bubbles: true,
      }));
    });
    expect((workspace as HTMLElement).style.getPropertyValue('--cf-builder-artifact-width'))
      .toBe('500px');
    const resizedHandle = container.querySelector('[data-builder-artifact-resize-handle="true"]');
    expect(resizedHandle?.getAttribute('aria-valuenow')).toBe('500');
    expect(resizedHandle?.getAttribute('aria-valuemax')).toBe('500');
    expect(resizedHandle?.getAttribute('data-builder-artifact-resizing')).toBeNull();
    expect(document.body.style.cursor).toBe(previousBodyCursor);
    expect(document.body.style.userSelect).toBe(previousBodyUserSelect);
    const shrinkEvent = keyDown(container, '[data-builder-artifact-resize-handle="true"]', { key: 'ArrowRight' });
    expect(shrinkEvent.defaultPrevented).toBe(true);
    expect((workspace as HTMLElement).style.getPropertyValue('--cf-builder-artifact-width'))
      .toBe('476px');
    const minEvent = keyDown(container, '[data-builder-artifact-resize-handle="true"]', { key: 'Home' });
    expect(minEvent.defaultPrevented).toBe(true);
    expect((workspace as HTMLElement).style.getPropertyValue('--cf-builder-artifact-width'))
      .toBe('320px');
    const maxEvent = keyDown(container, '[data-builder-artifact-resize-handle="true"]', { key: 'End' });
    expect(maxEvent.defaultPrevented).toBe(true);
    expect((workspace as HTMLElement).style.getPropertyValue('--cf-builder-artifact-width'))
      .toBe('500px');
    click(container, '[data-builder-minimize-artifact="true"]');
    expect((workspace as HTMLElement).style.getPropertyValue('--cf-builder-artifact-width'))
      .toBe('320px');
    click(container, '[data-builder-toggle-artifact="true"]');
    expect(container.querySelector('[data-builder-artifact-sidebar="true"]')).toBeNull();
    expect(workspace?.getAttribute('data-builder-artifact-sidebar-visible')).toBe('false');
    expect(container.querySelector('[data-builder-workspace-controls="true"]')?.getAttribute('data-builder-workspace-drawer-visible'))
      .toBe('false');
    expect(container.querySelector('[data-builder-toggle-artifact="true"]')?.getAttribute('aria-label'))
      .toBe('Show artifact panel');
    expect(container.querySelector('[data-builder-composer="true"]')?.closest('[data-builder-chat-main="true"]'))
      .toBe(chatMain);
    click(container, '[data-builder-workspace-menu-button="true"]');
    click(container, '[data-builder-workspace-control-tab="changes"]');
    expect(container.querySelector('[data-builder-artifact-sidebar="true"]')?.getAttribute('data-builder-artifact-tab-active'))
      .toBe('changes');
    expect(container.querySelector('[data-builder-workspace-controls="true"]')?.getAttribute('data-builder-workspace-drawer-visible'))
      .toBe('true');
    expect(container.querySelector('[data-builder-workspace-menu-button="true"]')?.getAttribute('aria-label'))
      .toBe('Workspace menu');
    click(container, '[data-builder-workspace-menu-button="true"]');
    expect(container.querySelector('[data-builder-workspace-control-tab="changes"]')?.getAttribute('aria-checked'))
      .toBe('true');
    click(container, '[data-builder-workspace-control-tab="preview"]');
    expect(container.querySelector('[data-builder-artifact-sidebar="true"]')?.getAttribute('data-builder-artifact-tab-active'))
      .toBe('preview');
    click(container, '[data-builder-expand-preview="true"]');
    const expandedPreview = container.querySelector('[data-builder-expanded-preview="true"]');
    const expandedResult = expandedPreview?.querySelector('[data-builder-result-placement="expanded"]');
    expect(expandedPreview).not.toBeNull();
    expect(expandedPreview?.getAttribute('role')).toBe('dialog');
    expect(expandedPreview?.getAttribute('aria-modal')).toBe('true');
    expect(expandedResult).not.toBeNull();
    expect(expandedResult?.closest('[data-builder-chat-main="true"]')).toBeNull();
    expect(expandedResult?.closest('[data-builder-artifact-sidebar="true"]')).toBeNull();
    click(container, '[data-builder-close-expanded-preview="true"]');
    expect(container.querySelector('[data-builder-expanded-preview="true"]')).toBeNull();
    openWorkspaceChanges(container);
    const updatedArtifactSidebar = container.querySelector('[data-builder-artifact-sidebar="true"]');
    const changesFlow = container.querySelector('[data-builder-changes-flow="true"]');
    const changes = container.querySelector('[data-builder-changes-panel="true"]');
    const changesDisclosure = container.querySelector<HTMLDetailsElement>('[data-builder-changes-disclosure="true"]');
    const versions = container.querySelector('[data-builder-version-history="true"]');
    expect(updatedArtifactSidebar).not.toBeNull();
    expect(updatedArtifactSidebar?.getAttribute('data-builder-artifact-tab-active')).toBe('changes');
    expect(changesFlow).not.toBeNull();
    expect(changes).not.toBeNull();
    expect(changes?.closest('[data-builder-chat-main="true"]')).toBeNull();
    expect(changes?.closest('[data-builder-artifact-sidebar="true"]')).toBe(updatedArtifactSidebar);
    expect(changes?.closest('[data-builder-changes-flow="true"]')).toBe(changesFlow);
    expect(changes?.getAttribute('data-builder-changes-placement')).toBe('artifact');
    expect(changesDisclosure).not.toBeNull();
    expect(changesDisclosure?.open).toBe(true);
    expect(changesDisclosure?.querySelector('.cf-builder-changes-title')).toBeNull();
    expect(updatedArtifactSidebar?.querySelector('[data-builder-side-workspace-tool="changes"] [data-builder-side-workspace-tab-label="active"]')?.textContent)
      .toContain('Changes');
    expect(updatedArtifactSidebar?.querySelector('[data-builder-side-workspace-tool="preview"] [data-builder-side-workspace-tab-label="collapsed"]'))
      .not.toBeNull();
    expect(updatedArtifactSidebar?.querySelector('[data-builder-side-workspace-tool="preview"] [data-builder-side-workspace-tab-label="collapsed"]')?.classList.contains('cf-builder-visually-hidden'))
      .toBe(true);
    expect(changesDisclosure?.querySelector('[data-builder-changes-summary="true"]')?.textContent)
      .toContain('file');
    expect(versions).toBeNull();
    expect(workspace?.getAttribute('data-builder-artifact-sidebar-visible')).toBe('true');
    expect(container.querySelector('[data-builder-workspace-menu-button="true"]')?.getAttribute('aria-label'))
      .toBe('Workspace menu');
    expect(container.querySelector('[data-builder-open-artifact-preview="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-open-artifact-changes="true"]')).toBeNull();
    expect(container.querySelectorAll('[data-builder-save-version="true"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-builder-discard-draft="true"]')).toHaveLength(1);
    expect(container.querySelector('[data-builder-composer-version-decision="true"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-builder-review-more="true"]')).toHaveLength(0);
    expect(container.querySelector('#builder-tool-tab-preview')).toBeNull();
    expect(container.querySelector('#builder-tool-tab-code')).toBeNull();
    expect(container.querySelector('[data-builder-activity-card="You"]')?.getAttribute('data-builder-activity-role'))
      .toBe('user');
    expect(container.querySelector('[data-builder-activity-card="Started"]')).toBeNull();
    expect(container.querySelector('[data-builder-activity-card="Assistant working"]')).toBeNull();
    expect(container.querySelector('[data-builder-activity-card="Draft ready"]')).toBeNull();
    expect(container.querySelector('[data-builder-activity-card="Draft proposed"]')?.getAttribute('data-builder-activity-role'))
      .toBe('assistant');
    expect(container.querySelector('[data-builder-activity-card="Draft proposed"]')?.textContent)
      .not.toContain('The review workspace is ready before saving this version.');
    expect(onSubmitInstruction).not.toHaveBeenCalled();
    expect(onRejectDraft).not.toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
    click(container, '[data-builder-open-project-location="true"]');
    expect(onOpenProjectLocation).toHaveBeenCalledExactlyOnceWith(PROJECT_ID);
    expect(container.textContent).not.toMatch(
      /builder-generation-draft:|review_id|reviewer_id|reviewed_at_ms|sha256:|commit_oid|tree_oid|provider|credential/iu,
    );
  });

  it('keeps the Browser workspace host mounted while the preview projection updates', async () => {
    const first = await changedDraftSnapshot();
    const second = await draftSnapshotFromSourceTrees(
      await createSourceTree([
        { path: 'index.html', content: '<main>Old</main>\n' },
        { path: 'styles.css', content: 'main { color: black; }\n' },
      ]),
      await createSourceTree([
        { path: 'index.html', content: '<main>Newer preview</main>\n' },
        { path: 'styles.css', content: 'main { color: teal; }\n' },
      ]),
    );
    const activity = await candidateActivity();
    let setSnapshot!: (value: typeof first) => void;

    function PreviewHostPage() {
      const [snapshot, updateSnapshot] = useState(first);
      setSnapshot = updateSnapshot;
      return (
        <BuilderPage
          activeFile={null}
          conversationSnapshot={activity}
          instruction=""
          snapshot={snapshot}
        />
      );
    }

    const container = render(<PreviewHostPage />);
    click(container, '[data-builder-workspace-menu-button="true"]');
    click(container, '[data-builder-workspace-control-tab="preview"]');
    const browserHost = container.querySelector('[data-builder-side-workspace-browser="true"]');
    expect(browserHost).not.toBeNull();
    browserHost?.setAttribute('data-test-stable-preview-host', 'true');

    act(() => setSnapshot(second));

    const retainedHost = container.querySelector('[data-test-stable-preview-host="true"]');
    expect(retainedHost).toBe(browserHost);
    expect(retainedHost?.closest('[data-builder-artifact-sidebar="true"]')).not.toBeNull();
    expect(retainedHost?.hasAttribute('hidden')).toBe(false);
    expect(container.querySelector<HTMLIFrameElement>('[data-builder-static-preview="true"] iframe')?.srcdoc)
      .toContain('Newer preview');
  });

  it('runs the saved project from the workspace toolbar and opens its preview', async () => {
    const { saved } = await snapshots();
    const onRequestLivePreview = vi.fn();
    const onStopLivePreview = vi.fn();
    const container = render(
      <BuilderPage
        activeFile={null}
        instruction=""
        livePreviewStatus={{
          status_version: 'builder-live-preview-status-projection.v1',
          project_id: PROJECT_ID,
          conversation_id: 'builder-conversation:123e4567-e89b-42d3-a456-426614174000',
          preview_kind: 'live_static_web',
          entry_url: null,
          status: 'idle',
          can_start: true,
          can_reload: false,
          can_stop: false,
          blocked_request_count: 4,
          navigation_block_count: 0,
          network_block_count: 0,
          permission_block_count: 0,
          download_block_count: 0,
          window_open_block_count: 0,
          message: 'Live preview is ready to start.',
          unavailable_reason: null,
          dev_server_approval: null,
          runtime_launch_projection: livePreviewRuntimeLaunchProjection(),
          updated_at_ms: 10,
          authority: {
            live_preview_authority: 'main_owned_live_preview_ipc_adapter_v1',
            renderer_authority: 'current_project_conversation_only',
            active_renderer_required: true,
            source_tree_from_renderer: 'not_accepted',
            source_read: 'main_owned_preview_source_resolver_or_not_performed',
            source_write: 'not_performed',
            provider_dispatch: false,
            tool_dispatch: false,
            command_execution: false,
            git_mutation: false,
            sqlite_write: false,
            permission_grant: false,
            revision_admission: false,
            save_admission: false,
            electron_view_attachment: 'main_only_not_exposed_to_renderer',
            preview_content_ipc: false,
            node_integration: false,
            preload: false,
          },
        }}
        onRequestLivePreview={onRequestLivePreview}
        onStopLivePreview={onStopLivePreview}
        snapshot={saved}
      />,
    );

    const runProject = container.querySelector<HTMLButtonElement>('[data-builder-run-project="true"]');
    const stopProject = container.querySelector<HTMLButtonElement>('[data-builder-stop-project="true"]');
    expect(runProject?.disabled).toBe(false);
    expect(runProject?.getAttribute('data-builder-control-presentation')).toBe('compact');
    expect(runProject?.getAttribute('aria-label')).toBe('Run project');
    expect(runProject?.querySelector('span')?.classList.contains('cf-builder-visually-hidden')).toBe(true);
    expect(stopProject?.disabled).toBe(true);
    expect(container.querySelector('[data-builder-artifact-sidebar="true"]')).toBeNull();

    click(container, '[data-builder-run-project="true"]');

    expect(onRequestLivePreview).toHaveBeenCalledOnce();
    expect(onStopLivePreview).not.toHaveBeenCalled();
    const safetyNotice = container.querySelector('[data-builder-live-preview-blocked-count="true"]');
    expect(safetyNotice?.getAttribute('aria-label')).toBe('Blocked 4 unsafe preview requests');
    expect(safetyNotice?.getAttribute('title')).toBe('Blocked 4 unsafe preview requests');
    expect(safetyNotice?.querySelector('svg')).not.toBeNull();
    expect(safetyNotice?.textContent).toBe('');
    expect(container.querySelector('[data-builder-artifact-sidebar="true"]')
      ?.getAttribute('data-builder-artifact-tab-active')).toBe('preview');
  });

  it('shows the exact development server command and records one-time approval explicitly', async () => {
    const { saved } = await snapshots();
    const onDecide = vi.fn();
    const approvalRequestId =
      'builder-live-preview-dev-server-approval-request:123e4567-e89b-42d3-a456-426614174099';
    const container = render(
      <BuilderPage
        activeFile={null}
        instruction=""
        livePreviewStatus={{
          status_version: 'builder-live-preview-status-projection.v1',
          project_id: PROJECT_ID,
          conversation_id: 'builder-conversation:123e4567-e89b-42d3-a456-426614174000',
          preview_kind: 'live_dev_server_web',
          entry_url: null,
          status: 'approval_required',
          can_start: false,
          can_reload: false,
          can_stop: false,
          blocked_request_count: 0,
          navigation_block_count: 0,
          network_block_count: 0,
          permission_block_count: 0,
          download_block_count: 0,
          window_open_block_count: 0,
          message: 'Allow this project development server to start?',
          unavailable_reason: null,
          dev_server_approval: {
            request_version: 'builder-live-preview-dev-server-approval-request.v1',
            approval_request_id: approvalRequestId,
            project_id: PROJECT_ID,
            conversation_id: 'builder-conversation:123e4567-e89b-42d3-a456-426614174000',
            command_display: 'npm run dev -- --host 127.0.0.1 --port 5174 --strictPort',
            source_tree_digest: `sha256:${'a'.repeat(64)}`,
            risk_notice: 'This project script may modify files or use the network.',
            requested_at_ms: 10,
            expires_at_ms: 300_010,
            decisions: ['allow_once', 'deny'],
          },
          runtime_launch_projection: livePreviewRuntimeLaunchProjection({
            preview_kind: 'live_dev_server_web',
            command_profile: 'main_owned_dev_server_profile',
            user_approval: 'required',
            command_execution: 'approval_required',
            sandbox_policy: 'dev_server_only_no_dependency_install',
          }),
          updated_at_ms: 10,
          authority: {
            live_preview_authority: 'main_owned_live_preview_ipc_adapter_v1',
            renderer_authority: 'current_project_conversation_only',
            active_renderer_required: true,
            source_tree_from_renderer: 'not_accepted',
            source_read: 'main_owned_preview_source_resolver_or_not_performed',
            source_write: 'not_performed',
            provider_dispatch: false,
            tool_dispatch: false,
            command_execution: false,
            git_mutation: false,
            sqlite_write: false,
            permission_grant: false,
            revision_admission: false,
            save_admission: false,
            electron_view_attachment: 'main_only_not_exposed_to_renderer',
            preview_content_ipc: false,
            node_integration: false,
            preload: false,
          },
        }}
        onDecideLivePreviewDevServerApproval={onDecide}
        snapshot={saved}
      />,
    );

    click(container, '[data-builder-workspace-menu-button="true"]');
    click(container, '[data-builder-workspace-control-tab="preview"]');
    expect(container.querySelector(
      `[data-builder-live-preview-dev-server-approval="${approvalRequestId}"]`,
    )?.textContent).toContain('npm run dev -- --host 127.0.0.1 --port 5174 --strictPort');
    expect(container.textContent).toContain('此项目脚本可能修改文件或访问网络');

    click(container, '[data-builder-allow-live-preview-dev-server-once="true"]');
    expect(onDecide).toHaveBeenCalledExactlyOnceWith('allow_once');
  });

  it('reports the measured Browser content bounds and hides the native view after changing tabs', async () => {
    const { draftReady } = await snapshots();
    const originalRect = HTMLElement.prototype.getBoundingClientRect;
    const requestFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    const cancelFrame = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function mockedRect(
      this: HTMLElement,
    ) {
      if (this.matches('[data-builder-result-placement="artifact"]')) {
        return {
          bottom: 700,
          height: 520,
          left: 820,
          right: 1240,
          top: 180,
          width: 420,
          x: 820,
          y: 180,
          toJSON: () => ({}),
        } as DOMRect;
      }
      if (this.matches('[data-builder-expanded-preview-content="true"]')) {
        return {
          bottom: 760,
          height: 660,
          left: 24,
          right: 1256,
          top: 100,
          width: 1232,
          x: 24,
          y: 100,
          toJSON: () => ({}),
        } as DOMRect;
      }
      return originalRect.call(this);
    });
    const onLivePreviewLayoutChange = vi.fn();

    try {
      const container = render(
        <BuilderPage
          activeFile={null}
          instruction=""
          onLivePreviewLayoutChange={onLivePreviewLayoutChange}
          snapshot={draftReady}
        />,
      );
      expect(onLivePreviewLayoutChange).toHaveBeenLastCalledWith(null);
      onLivePreviewLayoutChange.mockClear();
      click(container, '[data-builder-workspace-menu-button="true"]');
      click(container, '[data-builder-workspace-control-tab="preview"]');
      expect(onLivePreviewLayoutChange).toHaveBeenCalledWith({
        x: 820,
        y: 180,
        width: 420,
        height: 520,
      });

      onLivePreviewLayoutChange.mockClear();
      click(container, '[data-builder-expand-preview="true"]');
      expect(onLivePreviewLayoutChange).not.toHaveBeenCalledWith(null);
      expect(onLivePreviewLayoutChange).toHaveBeenLastCalledWith({
        x: 24,
        y: 100,
        width: 1232,
        height: 660,
      });

      onLivePreviewLayoutChange.mockClear();
      click(container, '[data-builder-close-expanded-preview="true"]');
      expect(onLivePreviewLayoutChange).not.toHaveBeenCalledWith(null);
      expect(onLivePreviewLayoutChange).toHaveBeenLastCalledWith({
        x: 820,
        y: 180,
        width: 420,
        height: 520,
      });

      openWorkspaceChanges(container);
      expect(onLivePreviewLayoutChange).toHaveBeenLastCalledWith(null);
    } finally {
      requestFrame.mockRestore();
      cancelFrame.mockRestore();
      vi.restoreAllMocks();
    }
  });

  it('re-publishes unchanged Browser bounds when the request-bound layout callback changes', async () => {
    const { draftReady } = await snapshots();
    const originalRect = HTMLElement.prototype.getBoundingClientRect;
    const requestFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    const cancelFrame = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function mockedRect(
      this: HTMLElement,
    ) {
      if (this.matches('[data-builder-result-placement="artifact"]')) {
        return {
          bottom: 700,
          height: 520,
          left: 820,
          right: 1240,
          top: 180,
          width: 420,
          x: 820,
          y: 180,
          toJSON: () => ({}),
        } as DOMRect;
      }
      return originalRect.call(this);
    });
    const initialLayoutChange = vi.fn();
    const admittedLayoutChange = vi.fn();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    try {
      act(() => root.render(
        <BuilderPage
          activeFile={null}
          instruction=""
          onLivePreviewLayoutChange={initialLayoutChange}
          snapshot={draftReady}
        />,
      ));
      expect(initialLayoutChange).toHaveBeenLastCalledWith(null);
      initialLayoutChange.mockClear();
      click(container, '[data-builder-workspace-menu-button="true"]');
      click(container, '[data-builder-workspace-control-tab="preview"]');
      expect(initialLayoutChange).toHaveBeenCalledWith({
        x: 820,
        y: 180,
        width: 420,
        height: 520,
      });

      act(() => root.render(
        <BuilderPage
          activeFile={null}
          instruction=""
          onLivePreviewLayoutChange={admittedLayoutChange}
          snapshot={draftReady}
        />,
      ));
      expect(admittedLayoutChange).toHaveBeenCalledWith({
        x: 820,
        y: 180,
        width: 420,
        height: 520,
      });
    } finally {
      act(() => root.unmount());
      container.remove();
      requestFrame.mockRestore();
      cancelFrame.mockRestore();
      vi.restoreAllMocks();
    }
  });

  it('opens current draft files from the side workspace using main-issued file refs', async () => {
    const { draftReady } = await snapshots();
    const activity = await candidateActivity();
    const onRequestSideWorkspaceFiles = vi.fn();
    const onSelectSideWorkspaceFile = vi.fn();
    const container = render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={activity}
        instruction="Inspect the files."
        onRequestSideWorkspaceFiles={onRequestSideWorkspaceFiles}
        onSelectSideWorkspaceFile={onSelectSideWorkspaceFile}
        sideWorkspaceFileContent={sideWorkspaceFileContent()}
        sideWorkspaceFileContentStatus="ready"
        sideWorkspaceFileTree={sideWorkspaceFileTree()}
        sideWorkspaceFileTreeStatus="ready"
        snapshot={draftReady}
      />,
    );

    click(container, '[data-builder-workspace-menu-button="true"]');
    click(container, '[data-builder-workspace-control-tab="source"]');

    const filesPanel = container.querySelector('[data-builder-side-workspace-files="true"]');
    expect(filesPanel).not.toBeNull();
    expect(filesPanel?.textContent).toContain('Files');
    expect(filesPanel?.textContent).toContain('Current draft · 2');
    expect(filesPanel?.textContent).toContain('App.tsx');
    expect(filesPanel?.textContent).toContain('styles.css');
    expect(filesPanel?.textContent).toContain('export function App()');
    expect(filesPanel?.querySelector('[data-builder-side-workspace-code-viewer="true"]')).not.toBeNull();
    expect(filesPanel?.querySelector('[data-builder-side-workspace-code-line="1"]')?.textContent)
      .toContain('export function App()');
    expect(filesPanel?.querySelector('[data-builder-side-workspace-file-path="true"]')?.textContent)
      .toBe('/src/App.tsx');
    expect(filesPanel?.querySelector('[data-builder-side-workspace-file-kind="directory"]')?.textContent)
      .toContain('src');
    expect(onRequestSideWorkspaceFiles).toHaveBeenCalled();

    click(container, '[data-builder-side-workspace-file-entry="src/styles.css"]');

    expect(onSelectSideWorkspaceFile).toHaveBeenCalledExactlyOnceWith(
      sideWorkspaceFileRef('src/styles.css', SIDE_WORKSPACE_STYLE_DIGEST),
    );
    expect(Object.keys(onSelectSideWorkspaceFile.mock.calls[0]?.[0] ?? {})).toStrictEqual([
      'file_ref_version',
      'source_kind',
      'source_tree_digest',
      'path',
      'content_digest',
    ]);
    expect(JSON.stringify(onSelectSideWorkspaceFile.mock.calls)).not.toContain('text_preview');
    expect(JSON.stringify(onSelectSideWorkspaceFile.mock.calls)).not.toContain('entries');
  });

  it('keeps the file viewer stable while a newly selected file is loading', async () => {
    const { draftReady } = await snapshots();
    const activity = await candidateActivity();

    function LoadingFilesPage() {
      const [activeFile, setActiveFile] = useState<BuilderFileName | null>('src/App.tsx');
      return (
        <BuilderPage
          activeFile={activeFile}
          conversationSnapshot={activity}
          instruction="Inspect the files."
          onSelectFile={setActiveFile}
          onSelectSideWorkspaceFile={() => undefined}
          sideWorkspaceFileContent={sideWorkspaceFileContent()}
          sideWorkspaceFileContentStatus="ready"
          sideWorkspaceFileTree={sideWorkspaceFileTree()}
          sideWorkspaceFileTreeStatus="ready"
          snapshot={draftReady}
        />
      );
    }

    const container = render(<LoadingFilesPage />);
    click(container, '[data-builder-workspace-menu-button="true"]');
    click(container, '[data-builder-workspace-control-tab="source"]');
    click(container, '[data-builder-side-workspace-file-entry="src/styles.css"]');

    const viewer = container.querySelector('[data-builder-side-workspace-file-content-status="loading"]');
    expect(viewer?.getAttribute('aria-busy')).toBe('true');
    expect(viewer?.querySelector('[data-builder-side-workspace-file-path="true"]')?.textContent)
      .toBe('/src/styles.css');
    expect(viewer?.querySelectorAll('.cf-builder-artifact-file-loading-line')).toHaveLength(9);
    expect(viewer?.querySelector('[data-builder-side-workspace-code-viewer="true"]')).toBeNull();
    expect(container.querySelectorAll('[data-builder-side-workspace-file-path="true"]')).toHaveLength(1);
    expect(container.querySelector('.cf-builder-artifact-files-toolbar')).toBeNull();
    expect(container.querySelector('[data-builder-side-workspace-file-entry="src/styles.css"]')?.getAttribute('data-active'))
      .toBe('true');
  });

  it('keeps long source previews inside dedicated side-workspace scroll regions', async () => {
    const { draftReady } = await snapshots();
    const activity = await candidateActivity();
    const markdownFile = Object.freeze({ path: 'docs/static-blog-plan.md', contentDigest: SIDE_WORKSPACE_APP_DIGEST });
    const longMarkdown = Array.from(
      { length: 80 },
      (_, index) => `## ${index + 1}. Static blog implementation detail`,
    ).join('\n');
    const container = render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={activity}
        instruction="Inspect the plan."
        sideWorkspaceFileContent={sideWorkspaceFileContent(markdownFile, longMarkdown, 'markdown')}
        sideWorkspaceFileContentStatus="ready"
        sideWorkspaceFileTree={sideWorkspaceFileTree([markdownFile])}
        sideWorkspaceFileTreeStatus="ready"
        snapshot={draftReady}
      />,
    );

    click(container, '[data-builder-workspace-menu-button="true"]');
    click(container, '[data-builder-workspace-control-tab="source"]');

    const sourcePanel = container.querySelector('[data-builder-side-workspace-files="true"]');
    const contentScroll = sourcePanel?.querySelector('[data-builder-side-workspace-scroll-region="file-content"]');
    const treeScroll = sourcePanel?.querySelector('[data-builder-side-workspace-scroll-region="file-tree"]');
    expect(sourcePanel?.closest('[data-builder-artifact-sidebar="true"]')).not.toBeNull();
    expect(sourcePanel?.closest('[data-builder-chat-main="true"]')).toBeNull();
    expect(contentScroll).not.toBeNull();
    expect(treeScroll).not.toBeNull();
    expect(contentScroll?.closest('[data-builder-side-workspace-file-content="docs/static-blog-plan.md"]'))
      .not.toBeNull();
    expect(contentScroll?.querySelectorAll('[data-builder-side-workspace-code-line]')).toHaveLength(80);
    expect(contentScroll?.textContent).toContain('Static blog implementation detail');
  });

  it('keeps the verified project shell mounted and inert while another project opens', async () => {
    const { controller, saved } = await snapshots();
    const openingOperation = controller.open(PROJECT_ID);
    const opening = controller.getSnapshot();
    expect(opening.status).toBe('opening');
    expect(opening.savedProject).toBe(saved.savedProject);

    const container = render(
      <BuilderPage
        activeFile={null}
        instruction=""
        snapshot={opening}
      />,
    );

    expect(container.querySelector('[data-builder-page="true"]')?.getAttribute('aria-busy')).toBe('true');
    expect(container.querySelector('[data-builder-project-opening="true"]')?.textContent)
      .toBe('Opening project...');
    expect(container.querySelector('[data-builder-chat-workspace="true"]')?.hasAttribute('inert')).toBe(true);
    expect(container.querySelector('[data-builder-current-version="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-workspace-controls="true"]')).not.toBeNull();

    await openingOperation;
  });

  it('lets side workspace tabs close and reopen by tool type', async () => {
    const { draftReady } = await snapshots();
    const activity = await candidateActivity();
    const container = render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={activity}
        instruction="Review the workspace."
        snapshot={draftReady}
      />,
    );

    click(container, '[data-builder-workspace-menu-button="true"]');
    click(container, '[data-builder-workspace-control-tab="changes"]');
    expect(container.querySelector('[data-builder-side-workspace-tool="changes"]')).not.toBeNull();
    expect(container.querySelector('[data-builder-artifact-sidebar="true"]')?.getAttribute('data-builder-artifact-tab-active'))
      .toBe('changes');

    click(container, '[data-builder-side-workspace-close-tab="changes"]');

    expect(container.querySelector('[data-builder-side-workspace-tool="changes"]')).toBeNull();
    expect(container.querySelector('[data-builder-artifact-sidebar="true"]')).toBeNull();
    click(container, '[data-builder-workspace-menu-button="true"]');
    click(container, '[data-builder-workspace-control-tab="preview"]');
    expect(container.querySelector('[data-builder-side-workspace-tool="preview"]')).not.toBeNull();
    expect(container.querySelector('[data-builder-artifact-sidebar="true"]')?.getAttribute('data-builder-artifact-tab-active'))
      .toBe('preview');

    click(container, '[data-builder-side-workspace-new-tab-button="true"]');
    expect(container.querySelector('[data-builder-side-workspace-new-tab-kind="review"]')?.textContent)
      .toContain('Add');
    click(container, '[data-builder-side-workspace-new-tab-kind="review"]');

    expect(container.querySelector('[data-builder-side-workspace-tool="changes"]')).not.toBeNull();
    click(container, '[data-builder-side-workspace-new-tab-button="true"]');
    expect(container.querySelector('[data-builder-side-workspace-new-tab-kind="review"]')?.textContent)
      .toContain('Open');
    expect(container.querySelector('[data-builder-artifact-sidebar="true"]')?.getAttribute('data-builder-artifact-tab-active'))
      .toBe('changes');

    click(container, '[data-builder-side-workspace-new-tab-kind="terminal"]');
    expect(container.querySelector('[data-builder-side-workspace-tool="terminal_placeholder"]')).not.toBeNull();
    const terminalPlaceholder = container.querySelector('[data-builder-side-workspace-terminal-placeholder="true"]');
    expect(terminalPlaceholder?.querySelector('[data-builder-side-workspace-terminal-idle="true"]')?.textContent)
      .toContain('PS Project>');
    expect(terminalPlaceholder?.querySelector('[data-builder-side-workspace-placeholder-note="terminal"]')?.classList.contains('cf-builder-visually-hidden'))
      .toBe(true);
    expect(terminalPlaceholder?.textContent).not.toContain('Copyright');
    click(container, '[data-builder-side-workspace-close-tab="terminal_placeholder"]');
    expect(container.querySelector('[data-builder-side-workspace-tool="terminal_placeholder"]')).toBeNull();

    click(container, '[data-builder-side-workspace-new-tab-button="true"]');
    click(container, '[data-builder-side-workspace-new-tab-kind="side_chat"]');
    expect(container.querySelector('[data-builder-side-workspace-tool="side_chat_placeholder"]')).not.toBeNull();
    const sideChatPlaceholder = container.querySelector('[data-builder-side-workspace-chat-placeholder="true"]');
    expect(sideChatPlaceholder?.textContent)
      .toContain('Side chat');
    expect(sideChatPlaceholder?.querySelector('[data-builder-side-workspace-placeholder-note="side_chat"]')?.classList.contains('cf-builder-visually-hidden'))
      .toBe(true);
  });

  it('opens a read-only permissions artifact tab without exposing authority internals', async () => {
    const { draftReady } = await snapshots();
    const activity = await candidateActivity();
    const container = render(
      <BuilderPage
        activeFile={null}
        approvalMode="ask_before_write"
        conversationSnapshot={activity}
        currentProjectWriteApproval={null}
        instruction="Add a timer."
        planSourceReadApproval={null}
        snapshot={draftReady}
      />,
    );

    click(container, '[data-builder-workspace-menu-button="true"]');
    click(container, '[data-builder-workspace-control-tab="permissions"]');

    const sidebar = container.querySelector('[data-builder-artifact-sidebar="true"]');
    const permissionsPanel = container.querySelector('[data-builder-artifact-permissions="true"]');
    expect(sidebar?.getAttribute('data-builder-artifact-tab-active')).toBe('permissions');
    expect(container.querySelector('[data-builder-workspace-menu-button="true"]')?.getAttribute('aria-label'))
      .toBe('Workspace menu');
    expect(container.querySelector('[data-builder-artifact-view-button="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-artifact-tab="permissions"]')).toBeNull();
    expect(permissionsPanel).not.toBeNull();
    expect(permissionsPanel?.textContent).toContain('Project boundary');
    expect(permissionsPanel?.textContent).toContain('Saved project');
    expect(permissionsPanel?.textContent).toContain('Ask before write');
    expect(permissionsPanel?.textContent).toContain('Builder will ask before preparing a draft that changes files.');
    expect(permissionsPanel?.textContent).toContain('Project context');
    expect(permissionsPanel?.textContent)
      .toContain('Chat stays read-only unless a plan or tool path asks for project context.');
    expect(permissionsPanel?.textContent).toContain('AI context');
    expect(permissionsPanel?.textContent).toContain('Not active');
    expect(permissionsPanel?.textContent)
      .toContain('Builder has not requested current task context for an AI call in this view.');
    expect(permissionsPanel?.querySelector('[data-builder-permission-row="ai-context"]')
      ?.getAttribute('data-builder-ai-context-status')).toBe('absent');
    expect(permissionsPanel?.textContent)
      .toContain('Terminal, network, external folders, publish, and delegation are separate future approvals.');
    expect(permissionsPanel?.textContent).not.toMatch(
      /builder-project:|main_selected_project|approval_scope|authority|receipt|digest|credential|provider/iu,
    );
  });

  it('shows the current AI context status in the permissions artifact tab without raw request details', async () => {
    const { draftReady } = await snapshots();
    const activity = await candidateActivity();
    const container = render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={activity}
        instruction="Add a timer."
        providerContextDisclosureStatus={providerContextDisclosureStatusProjection()}
        snapshot={draftReady}
      />,
    );

    click(container, '[data-builder-workspace-menu-button="true"]');
    click(container, '[data-builder-workspace-control-tab="permissions"]');

    const row = container.querySelector('[data-builder-permission-row="ai-context"]');
    expect(row).not.toBeNull();
    expect(row?.getAttribute('data-builder-ai-context-status')).toBe('needs_approval');
    expect(row?.textContent).toContain('AI context');
    expect(row?.textContent).toContain('Allow AI to use current context');
    expect(row?.textContent)
      .toContain('Builder needs your approval before sharing current task context with the AI service.');
    expect(row?.querySelector('[data-builder-provider-context-disclosure-inspection="true"]')?.textContent)
      .toContain('Build with current context for the configured AI service');
    expect(row?.textContent).toContain('Includes: latest message, current goal, approved plan.');
    expect(row?.textContent)
      .toContain('This request does not include source files, secrets, ids, digests, or raw context text.');
    expect(row?.querySelector('[data-builder-approve-provider-context-disclosure="true"]')?.textContent)
      .toContain('Allow AI context');
    expect(row?.textContent).not.toMatch(
      /builder-provider-context|builder-context|sha256:|request_id|assembly_id|context_digest|authority|provider_context|source_tree|credential/iu,
    );
  });

  it('keeps the latest conversation content visible while following the chat bottom', async () => {
    const { saved } = await snapshots();
    const initialActivity = await candidateActivity();
    const nextActivity = await answerActivity();
    let setActivity!: (value: typeof initialActivity) => void;

    function ChatFollowBuilderPage() {
      const [conversationSnapshot, updateActivity] = useState(initialActivity);
      setActivity = updateActivity;
      return (
        <BuilderPage
          activeFile={null}
          conversationSnapshot={conversationSnapshot}
          instruction=""
          snapshot={saved}
        />
      );
    }

    const container = render(<ChatFollowBuilderPage />);
    const scroll = container.querySelector<HTMLElement>('[data-builder-chat-scroll="true"]');
    expect(scroll).not.toBeNull();
    expect(container.querySelector('[data-builder-chat-tail="true"]')).not.toBeNull();
    setScrollMetrics(scroll!, { clientHeight: 400, scrollHeight: 960, scrollTop: 560 });

    act(() => setActivity(nextActivity));

    expect(scroll?.scrollTop).toBe(960);
  });

  it('pauses follow before an upward wheel scroll can race a new output frame', async () => {
    const { saved } = await snapshots();
    const initial = await candidateActivity();
    const next = await answerActivity();
    let update!: (value: typeof initial) => void;
    function Page() {
      const [activity, setActivity] = useState(initial);
      update = setActivity;
      return <BuilderPage activeFile={null} conversationSnapshot={activity} instruction="" snapshot={saved} />;
    }
    const container = render(<Page />);
    const scroll = container.querySelector<HTMLElement>('[data-builder-chat-scroll="true"]')!;
    setScrollMetrics(scroll, { clientHeight: 400, scrollHeight: 1200, scrollTop: 800 });
    act(() => { scroll.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -30 })); });
    act(() => update(next));
    expect(scroll.scrollTop).toBe(800);
    scroll.scrollTop = 770;
    act(() => { scroll.dispatchEvent(new Event('scroll')); });
    act(() => update(initial));
    expect(scroll.scrollTop).toBe(770);
  });

  it('keeps background activity refresh out of the visible chat when entries remain', async () => {
    const { saved } = await snapshots();
    const activity = await refreshingActivityWithVisibleEntries();
    const container = render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={activity}
        instruction=""
        snapshot={saved}
      />,
    );

    expect(container.querySelector('[data-builder-activity="true"]')?.getAttribute('data-builder-activity-status'))
      .toBe('refreshing');
    expect(container.querySelector('[data-builder-activity-card="You"]')).not.toBeNull();
    expect(container.querySelector('[data-builder-activity-card="Draft proposed"]')).not.toBeNull();
    expect(container.textContent).not.toContain('Refreshing activity...');
    expect(container.textContent).not.toMatch(
      /builder-generation-draft:|request_id|provider|credential|source_tree|commit_oid|tree_oid|receipt/iu,
    );
  });

  it('does not pull the chat back down while the user is reading older content', async () => {
    const { saved } = await snapshots();
    const initialActivity = await candidateActivity();
    const nextActivity = await answerActivity();
    const acceptedActivity = await acceptedCandidateActivity();
    let setActivity!: (value: typeof initialActivity) => void;

    function ChatFollowBuilderPage() {
      const [conversationSnapshot, updateActivity] = useState(initialActivity);
      setActivity = updateActivity;
      return (
        <BuilderPage
          activeFile={null}
          conversationSnapshot={conversationSnapshot}
          instruction=""
          snapshot={saved}
        />
      );
    }

    const container = render(<ChatFollowBuilderPage />);
    const scroll = container.querySelector<HTMLElement>('[data-builder-chat-scroll="true"]');
    expect(scroll).not.toBeNull();

    setScrollMetrics(scroll!, { clientHeight: 400, scrollHeight: 1200, scrollTop: 120 });
    act(() => {
      scroll?.dispatchEvent(new WheelEvent('wheel', { deltaY: -120 }));
      scroll?.dispatchEvent(new Event('scroll'));
    });
    act(() => setActivity(nextActivity));
    expect(scroll?.scrollTop).toBe(120);

    setScrollMetrics(scroll!, { clientHeight: 400, scrollHeight: 1200, scrollTop: 720 });
    act(() => {
      scroll?.dispatchEvent(new WheelEvent('wheel', { deltaY: 120 }));
      scroll?.dispatchEvent(new Event('scroll'));
    });
    act(() => setActivity(acceptedActivity));
    expect(scroll?.scrollTop).toBe(1200);
  });

  it('keeps draft completion in the conversation without mounting review landing cards', async () => {
    const { saved } = await snapshots();
    const draftReady = await changedDraftSnapshot();
    const activity = await candidateActivity();
    let setSnapshot!: (value: typeof saved) => void;

    function DraftLandingBuilderPage() {
      const [snapshot, updateSnapshot] = useState(saved);
      setSnapshot = updateSnapshot;
      return (
        <BuilderPage
          activeFile={null}
          conversationSnapshot={activity}
          instruction=""
          snapshot={snapshot}
        />
      );
    }

    const container = render(<DraftLandingBuilderPage />);
    const scroll = container.querySelector<HTMLElement>('[data-builder-chat-scroll="true"]');
    setScrollMetrics(scroll!, { clientHeight: 500, scrollHeight: 1200, scrollTop: 700 });
    act(() => setSnapshot(draftReady));

      const result = container.querySelector('[data-builder-result-flow="true"]');
      expect(result).toBeNull();
      expect(container.querySelector('[data-builder-draft-landing="true"]')).toBeNull();
      expect(container.querySelector('[data-builder-review-checkpoint="true"]')).toBeNull();
      expect(container.querySelector('[data-builder-artifact-summary="true"]')).toBeNull();
      expect(scroll?.scrollTop).toBe(1200);
      expect(container.querySelector('[data-builder-review-more="true"]')).toBeNull();
      expect(container.querySelector('[data-builder-discard-draft="true"]')).toBeNull();
      expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
      expect(container.querySelector('[data-builder-artifact-sidebar="true"]')).toBeNull();

      openWorkspaceChanges(container);
      const changes = container.querySelector('[data-builder-changes-flow="true"]');
      const changesDisclosure = container.querySelector<HTMLDetailsElement>('[data-builder-changes-disclosure="true"]');
      expect(changes).not.toBeNull();
      expect(changesDisclosure).not.toBeNull();
      expect(changesDisclosure?.open).toBe(true);
      expect(container.querySelector('[data-builder-workspace-menu-button="true"]')?.getAttribute('aria-label'))
        .toBe('Workspace menu');
      expect(changes?.closest('[data-builder-artifact-sidebar="true"]')).not.toBeNull();
  });

  it('keeps the completed draft activity at the composer edge without a duplicate review card', async () => {
    const { saved } = await snapshots();
    const draftReady = await changedDraftSnapshot();
    const activity = await candidateActivity();
    const originalRect = HTMLElement.prototype.getBoundingClientRect;
    const requestFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
    const cancelFrame = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    let setSnapshot!: (value: typeof saved) => void;

    function rect(top: number, height: number): DOMRect {
      return {
        bottom: top + height,
        height,
        left: 0,
        right: 860,
        top,
        width: 860,
        x: 0,
        y: top,
        toJSON: () => ({}),
      } as DOMRect;
    }

    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function mockedRect(
      this: HTMLElement,
    ) {
      if (this.matches('[data-builder-chat-scroll="true"]')) return rect(100, 500);
      if (this.matches('[data-builder-review-checkpoint="true"]')) return rect(60, 130);
      return originalRect.call(this);
    });

    function DraftLandingBuilderPage() {
      const [snapshot, updateSnapshot] = useState(saved);
      setSnapshot = updateSnapshot;
      return (
        <BuilderPage
          activeFile={null}
          conversationSnapshot={activity}
          instruction=""
          snapshot={snapshot}
        />
      );
    }

    try {
      const container = render(<DraftLandingBuilderPage />);
      const scroll = container.querySelector<HTMLElement>('[data-builder-chat-scroll="true"]');
      expect(scroll).not.toBeNull();
      setScrollMetrics(scroll!, { clientHeight: 500, scrollHeight: 1200, scrollTop: 220 });

      act(() => setSnapshot(draftReady));

      expect(scroll?.scrollTop).toBe(1200);
      expect(requestFrame).not.toHaveBeenCalled();
    } finally {
      requestFrame.mockRestore();
      cancelFrame.mockRestore();
      vi.restoreAllMocks();
    }
  });

  it('does not create a draft result-summary scroll target', async () => {
    const { saved } = await snapshots();
    const draftReady = await changedDraftSnapshot();
    const activity = await candidateActivity();
    const originalRect = HTMLElement.prototype.getBoundingClientRect;
    const requestFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
    const cancelFrame = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    let setSnapshot!: (value: typeof saved) => void;

    function rect(top: number, height: number): DOMRect {
      return {
        bottom: top + height,
        height,
        left: 0,
        right: 860,
        top,
        width: 860,
        x: 0,
        y: top,
        toJSON: () => ({}),
      } as DOMRect;
    }

    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function mockedRect(
      this: HTMLElement,
    ) {
      if (this.matches('[data-builder-chat-scroll="true"]')) return rect(100, 500);
      if (this.matches('[data-builder-review-checkpoint="true"]')) return rect(120, 130);
      if (this.matches('[data-builder-draft-landing="true"]')) return rect(120, 480);
      return originalRect.call(this);
    });

    function DraftLandingBuilderPage() {
      const [snapshot, updateSnapshot] = useState(saved);
      setSnapshot = updateSnapshot;
      return (
        <BuilderPage
          activeFile={null}
          conversationSnapshot={activity}
          instruction=""
          snapshot={snapshot}
        />
      );
    }

    try {
      const container = render(<DraftLandingBuilderPage />);
      const scroll = container.querySelector<HTMLElement>('[data-builder-chat-scroll="true"]');
      expect(scroll).not.toBeNull();
      setScrollMetrics(scroll!, { clientHeight: 500, scrollHeight: 1200, scrollTop: 220 });

      act(() => setSnapshot(draftReady));

      expect(scroll?.scrollTop).toBe(1200);
      expect(container.querySelector('[data-builder-draft-landing="true"]')).toBeNull();
      expect(container.querySelector('[data-builder-artifact-summary="true"]')).toBeNull();
      expect(requestFrame).not.toHaveBeenCalled();
    } finally {
      requestFrame.mockRestore();
      cancelFrame.mockRestore();
      vi.restoreAllMocks();
    }
  });

  it('renders questions and AI answers as chat messages while keeping run events as status', async () => {
    const { saved } = await snapshots();
    const activity = await answerActivity();
    const container = render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={activity}
        instruction=""
        snapshot={saved}
      />,
    );

    const userMessage = container.querySelector('[data-builder-activity-card="You"]');
    const started = container.querySelector('[data-builder-activity-card="Started"]');
    const working = container.querySelector('[data-builder-activity-card="Assistant working"]');
    const assistant = container.querySelector('[data-builder-activity-card="Assistant"]');
    const answered = container.querySelector('[data-builder-activity-card="Answered"]');
    expect(userMessage?.getAttribute('data-builder-activity-role')).toBe('user');
    expect(
      userMessage?.querySelector('[data-builder-message-surface]')
        ?.getAttribute('data-builder-message-surface'),
    ).toBe('bubble');
    expect(userMessage?.textContent).toContain('What does this project do?');
    expect(assistant?.getAttribute('data-builder-activity-role')).toBe('assistant');
    expect(
      assistant?.querySelector('[data-builder-message-surface]')
        ?.getAttribute('data-builder-message-surface'),
    ).toBe('plain');
    expect(assistant?.textContent).toContain('This answer does not change files.');
    expect(assistant?.querySelector('[data-builder-completion-summary="true"]')).toBeNull();
    expect(assistant?.textContent).not.toContain('What happened');
    expect(assistant?.textContent).not.toContain('The assistant answered.');
    expect(assistant?.textContent).not.toContain('No files were changed.');
    expect(started).toBeNull();
    expect(working).toBeNull();
    expect(answered).toBeNull();
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();
    expect(container.textContent).not.toMatch(
      /builder-generation-draft:|review_id|reviewer_id|reviewed_at_ms|sha256:|commit_oid|tree_oid|provider|credential/iu,
    );
  });

  it('renders durable AI work progress as lightweight status rows in the chat flow', async () => {
    const { saved } = await snapshots();
    const activity = await progressActivity();
    const container = render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={activity}
        instruction=""
        snapshot={saved}
      />,
    );

    const workStatus = container.querySelector('[data-builder-work-status="true"]');
    const contextReady = container.querySelector('[data-builder-activity-card="Context ready"]');
    const responseStarted = container.querySelector('[data-builder-activity-card="AI response started"]');
    const responseReceived = container.querySelector('[data-builder-activity-card="AI response received"]');
    const resultPreparing = container.querySelector('[data-builder-activity-card="Preparing result"]');
    const started = container.querySelector('[data-builder-activity-card="Started"]');
    expect(container.querySelectorAll('[data-builder-work-status="true"]')).toHaveLength(0);
    expect(workStatus).toBeNull();
    expect(started).toBeNull();
    expect(contextReady).toBeNull();
    expect(responseStarted).toBeNull();
    expect(responseReceived).toBeNull();
    expect(resultPreparing).toBeNull();
    expect(container.textContent).not.toContain('Preparing review');
    expect(container.textContent).not.toContain('Checking and organizing the result for review.');
    expect(container.textContent).not.toMatch(
      /provider_request_started|provider_response_received|result_preparing|context_ready|builder-run:|sha256:|provider|credential|source_tree|receipt/iu,
    );
  });

  it('hides generic Agent lifecycle steps instead of presenting them as completed actions', async () => {
    const { saved } = await snapshots();
    const activity = await agentStepProgressActivity();
    const container = render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={activity}
        instruction=""
        snapshot={saved}
      />,
    );

    const chat = container.querySelector('[data-builder-chat-main="true"]');
    expect(chat?.querySelector('[data-builder-completed-actions="true"]')).toBeNull();
    expect(chat?.textContent).not.toContain('Step completed');
    expect(chat?.textContent).not.toContain('This step completed.');
    expect(chat?.querySelector('[data-builder-agent-step-progress="start_recorded"]')).toBeNull();
    expect(container.querySelector('[data-builder-workspace-control-tab="logs"]')).toBeNull();
    expect(container.textContent).not.toMatch(
      /agent_step_progress_recorded|progress_admission|admission_digest|read_service|step_start_count|step_result_count|builder-run-step|provider|credential|source_tree|stdout|stderr|commit_oid|tree_oid|receipt/iu,
    );
  });

  it('reopens interrupted work paused without historical progress animation or automatic resume', async () => {
    const { saved } = await snapshots();
    const activity = await failedRunActivity('interrupted');
    const onResumeInterruptedRun = vi.fn();
    const container = render(<BuilderPage activeFile={null} conversationSnapshot={activity}
      instruction="" snapshot={saved} onResumeInterruptedRun={onResumeInterruptedRun} onInstructionChange={vi.fn()} />);
    expect(container.querySelector('[data-builder-composer-state="paused"]')).not.toBeNull();
    expect(container.querySelector('.animate-spin, .cf-builder-activity-spinner')).toBeNull();
    expect(container.textContent).not.toContain('You asked to steer');
    expect(onResumeInterruptedRun).not.toHaveBeenCalled();
    act(() => container.querySelector<HTMLButtonElement>('[data-builder-resume-interrupted-run="true"]')?.click());
    expect(onResumeInterruptedRun).toHaveBeenCalledOnce();
  });

  it('explains failed work once without internal phases or a duplicate completion table', async () => {
    const { saved } = await snapshots();
    const activity = await failedRunActivity();
    const container = render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={activity}
        instruction=""
        snapshot={saved}
      />,
    );

    const failed = container.querySelector('[data-builder-activity-card="Could not finish"]');
    const workStatus = container.querySelector('[data-builder-work-status="true"]');
    expect(failed).not.toBeNull();
    expect(failed?.getAttribute('data-builder-activity-role')).toBe('assistant');
    expect(
      failed?.querySelector('[data-builder-message-surface]')
        ?.getAttribute('data-builder-message-surface'),
    ).toBe('plain');
    expect(workStatus).toBeNull();
    expect(failed?.textContent).toContain('The draft could not be prepared for review.');
    expect(failed?.querySelector('[data-builder-completion-summary="true"]')).toBeNull();
    expect(failed?.textContent).not.toContain('What happened');
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();
    expect(container.textContent).not.toMatch(
      /provider_response_received|provider_request_started|context_ready|result_preparing|builder-run:|sha256:|provider|credential|source_tree|receipt/iu,
    );
  });

  it('does not turn completed provider lifecycle phases into user-visible actions', async () => {
    const { saved } = await snapshots();
    const activity = await failedRunActivity();
    const container = render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={activity}
        instruction=""
        snapshot={saved}
      />,
    );

    expect(container.querySelector('[data-builder-work-status="true"]')).toBeNull();
    const failed = container.querySelector('[data-builder-activity-card="Could not finish"]');
    expect(failed?.querySelector('[data-builder-completion-summary="true"]')).toBeNull();
    expect(failed?.querySelector('[data-builder-completed-actions="true"]')).toBeNull();
    expect(failed?.textContent).not.toMatch(
      /provider_response_received|provider_request_started|context_ready|result_preparing|builder-run:|sha256:|provider|credential|source_tree|receipt/iu,
    );
  });

  it('shows the streaming assistant reply without a duplicate fixed work status', async () => {
    const { saved } = await snapshots();
    const activity = await progressActivity();
    const container = render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={activity}
        instruction=""
        liveOutput={{
          state: 'streaming',
          request_id: 'builder-git-request:123e4567-e89b-42d3-a456-426614174000',
          project_id: PROJECT_ID,
          text: 'Planning a quiet timer UI.',
          chunk_count: 1,
        }}
        snapshot={saved}
      />,
    );

    const liveOutput = container.querySelector('[data-builder-live-output="true"]');
    expect(liveOutput).not.toBeNull();
    expect(liveOutput?.getAttribute('data-builder-activity-role')).toBe('assistant');
    expect(
      liveOutput?.querySelector('[data-builder-message-surface]')
        ?.getAttribute('data-builder-message-surface'),
    ).toBe('plain');
    expect(liveOutput?.textContent).toContain('Planning a quiet timer UI.');
    const workStatus = container.querySelector('[data-builder-work-status="true"]');
    expect(workStatus).toBeNull();
    expect(container.querySelector('[data-builder-activity-card="Context ready"]')).toBeNull();
    expect(container.querySelector('[data-builder-activity-card="AI response started"]')).toBeNull();
    expect(container.querySelector('[data-builder-activity-card="AI response received"]')).toBeNull();
    expect(container.querySelector('[data-builder-activity-card="Preparing result"]')).toBeNull();
    expect(container.textContent).not.toMatch(
      /provider_request_started|provider_response_received|result_preparing|context_ready|request_id|builder-run:|sha256:|provider|credential|source_tree|receipt/iu,
    );
  });

  it('streams an answer directly without a redundant writing-response status row', async () => {
    const { saved } = await snapshots();
    const activity = await respondingActivity();
    const container = render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={activity}
        instruction=""
        liveOutput={{
          state: 'streaming',
          request_id: 'builder-git-request:123e4567-e89b-42d3-a456-426614174000',
          project_id: PROJECT_ID,
          text: 'This answer appears directly in the conversation.',
          chunk_count: 1,
        }}
        snapshot={saved}
      />,
    );

    expect(container.querySelector('[data-builder-live-output="true"]')?.textContent)
      .toContain('This answer appears directly in the conversation.');
    expect(container.querySelector('[data-builder-work-status="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-agent-current-activity="responding"]')).toBeNull();
    expect(container.textContent).not.toContain('Writing response');
    expect(container.textContent).not.toContain('Preparing a response from the current project context.');
  });

  it('moves completed runtime narration into history and shows only the uncommitted live suffix', async () => {
    const { saved } = await snapshots();
    const activity = await runtimeToolActivity(false);
    const committed = 'I found the relevant file and will update it now.';
    const container = render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={activity}
        instruction=""
        liveOutput={{
          state: 'streaming',
          request_id: 'builder-git-request:123e4567-e89b-42d3-a456-426614174000',
          project_id: PROJECT_ID,
          text: `${committed}I will verify the result after this edit.`,
          chunk_count: 2,
        }}
        snapshot={saved}
      />,
    );

    const durable = container.querySelector('[data-builder-runtime-assistant-message]');
    const live = container.querySelector('[data-builder-live-output="true"]');
    expect(durable?.textContent).toContain(committed);
    expect(live?.querySelector('.cf-builder-live-output-text')?.textContent)
      .toBe('I will verify the result after this edit.');
    expect(live?.querySelector('[data-builder-live-activity="true"]')?.textContent)
      .toBe('正在处理当前任务');
    expect(live?.textContent).not.toContain(committed);
    expect(container.querySelector('[data-builder-work-status="true"]')).toBeNull();
  });

  it('keeps the current thinking status after all live narration is committed to history', async () => {
    const { saved } = await snapshots();
    const activity = await runtimeToolActivity(false);
    const committed = 'I found the relevant file and will update it now.';
    const container = render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={activity}
        instruction=""
        liveOutput={{
          state: 'streaming',
          request_id: 'builder-git-request:123e4567-e89b-42d3-a456-426614174000',
          project_id: PROJECT_ID,
          text: committed,
          chunk_count: 2,
          waiting_text: '正在思考',
        }}
        snapshot={saved}
      />,
    );
    const live = container.querySelector('[data-builder-live-output="true"]');
    expect(live?.getAttribute('data-builder-live-output-state')).toBe('waiting');
    expect(live?.querySelector('[data-builder-live-activity="true"]')?.textContent).toBe('正在思考');
    expect(live?.querySelector('.cf-builder-live-output-text')?.textContent).toBe('');
    expect(container.querySelector('[data-builder-runtime-assistant-message]')?.textContent).toContain(committed);
    expect(container.querySelectorAll('[data-builder-live-activity="true"]')).toHaveLength(1);
  });

  it('does not refollow chat for live text updates within the same output chunk', async () => {
    const { saved } = await snapshots();
    const activity = await progressActivity();
    const { restore, spy } = installScrollIntoViewSpy();
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    mounted.push({ container, root });
    const liveOutput = (text: string) => ({
      state: 'streaming' as const,
      request_id: 'builder-git-request:123e4567-e89b-42d3-a456-426614174000',
      project_id: PROJECT_ID,
      text,
      chunk_count: 1,
    });

    try {
      act(() => {
        root.render(
          <BuilderPage
            activeFile={null}
            conversationSnapshot={activity}
            instruction=""
            liveOutput={liveOutput('Planning a quiet timer UI.')}
            snapshot={saved}
          />,
        );
      });
      expect(container.querySelector('[data-builder-live-output="true"]')?.textContent)
        .toContain('Planning a quiet timer UI.');
      act(() => {
        root.render(
          <BuilderPage
            activeFile={null}
            conversationSnapshot={activity}
            instruction=""
            liveOutput={liveOutput('Planning a quiet timer UI with calmer spacing.')}
            snapshot={saved}
          />,
        );
      });

      expect(container.querySelector('[data-builder-live-output="true"]')?.textContent)
        .toContain('calmer spacing');
      expect(spy).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it('keeps one live message node while frame-batching deltas and respects user scroll position', async () => {
    const { saved } = await snapshots();
    const activity = await progressActivity();
    let frameCallback: (() => void) | null = null;
    const scheduler: BuilderLiveOutputFrameScheduler = Object.freeze({
      request(callback) {
        frameCallback = callback;
        return 1;
      },
      cancel() {
        frameCallback = null;
      },
    });
    const store = createBuilderLiveOutputStore(scheduler);
    const initial = Object.freeze({
      state: 'streaming' as const,
      request_id: 'builder-git-request:123e4567-e89b-42d3-a456-426614174000',
      project_id: PROJECT_ID,
      text: 'A',
      chunk_count: 1,
    });
    store.start(initial);
    const animationFrames: FrameRequestCallback[] = [];
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      animationFrames.push(callback);
      return animationFrames.length;
    });
    const container = render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={activity}
        instruction=""
        liveOutput={initial}
        liveOutputStore={store}
        snapshot={saved}
      />,
    );
    const scroll = container.querySelector<HTMLElement>('[data-builder-chat-scroll="true"]')!;
    Object.defineProperties(scroll, {
      clientHeight: { configurable: true, value: 300 },
      scrollHeight: { configurable: true, value: 1000 },
    });
    animationFrames.shift()?.(0);
    raf.mockClear();
    scroll.scrollTop = 700;
    const liveNode = container.querySelector('[data-builder-live-output="true"]');
    expect(liveNode).not.toBeNull();

    act(() => {
      for (let index = 0; index < 100; index += 1) {
        store.append(Object.freeze({
          event_version: 'builder-generation-output.v1',
          request_id: initial.request_id,
          project_id: PROJECT_ID,
          conversation_id: CONVERSATION_ID,
          turn_id: TURN_ID,
          task_id: TASK_ID,
          run_id: RUN_ID,
          display_delta_text: 'x',
        }));
      }
      frameCallback?.();
    });
    animationFrames.shift()?.(16);

    expect(container.querySelector('[data-builder-live-output="true"]')).toBe(liveNode);
    expect(liveNode?.textContent).toContain(`A${'x'.repeat(100)}`);
    expect(raf).toHaveBeenCalledTimes(1);
    expect(scroll.scrollTop).toBe(1000);

    scroll.scrollTop = 100;
    act(() => {
      scroll.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -120 }));
      scroll.dispatchEvent(new Event('scroll', { bubbles: true }));
    });
    act(() => {
      store.append(Object.freeze({
        event_version: 'builder-generation-output.v1',
        request_id: initial.request_id,
        project_id: PROJECT_ID,
        conversation_id: CONVERSATION_ID,
        turn_id: TURN_ID,
        task_id: TASK_ID,
        run_id: RUN_ID,
        display_delta_text: 'after-scroll',
      }));
      frameCallback?.();
    });
    expect(scroll.scrollTop).toBe(100);
    expect(raf).toHaveBeenCalledTimes(1);
    store.dispose();
  });

  it('keeps the live message mounted when durable chat entries arrive before it', async () => {
    const { saved } = await snapshots();
    const activity = await progressActivity();
    const liveOutput = Object.freeze({
      state: 'streaming' as const,
      request_id: 'builder-git-request:123e4567-e89b-42d3-a456-426614174000',
      project_id: PROJECT_ID,
      text: 'Reading the current project.',
      chunk_count: 1,
    });
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    mounted.push({ container, root });

    act(() => {
      root.render(
        <BuilderPage
          activeFile={null}
          instruction=""
          liveOutput={liveOutput}
          snapshot={saved}
        />,
      );
    });
    const initialNode = container.querySelector('[data-builder-live-output="true"]');
    expect(initialNode).not.toBeNull();

    act(() => {
      root.render(
        <BuilderPage
          activeFile={null}
          conversationSnapshot={activity}
          instruction=""
          liveOutput={liveOutput}
          snapshot={saved}
        />,
      );
    });

    expect(container.querySelector('[data-builder-live-output="true"]')).toBe(initialNode);
    expect(container.querySelector('[data-builder-work-status="true"]')).toBeNull();
  });

  it('does not mount an empty generic reply before readable output arrives', async () => {
    const { saved } = await snapshots();
    const container = render(
      <BuilderPage
        activeFile={null}
        instruction=""
        liveOutput={{
          state: 'streaming',
          request_id: 'builder-git-request:123e4567-e89b-42d3-a456-426614174000',
          project_id: PROJECT_ID,
          text: '',
          chunk_count: 0,
        }}
        snapshot={saved}
      />,
    );

    expect(container.querySelector('[data-builder-live-output="true"]')).toBeNull();
    expect(container.textContent).not.toContain("I'm working on this...");
  });

  it('renders queued active-run follow-ups as a distinct user message', async () => {
    const { saved } = await snapshots();
    const activity = await queuedFollowupActivity();
    const container = render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={activity}
        instruction=""
        snapshot={saved}
      />,
    );

    const queued = container.querySelector('[data-builder-activity-card="You queued a follow-up"]');
    expect(queued).not.toBeNull();
    expect(queued?.getAttribute('data-builder-activity-role')).toBe('user');
    expect(queued?.textContent).toContain('After this, make the summary shorter.');
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
    expect(container.textContent).not.toMatch(
      /builder-run:|builder-message:|sha256:|provider|credential|source_tree|receipt|running|live/iu,
    );
  });

  it('renders a pending local user message before durable activity catches up', async () => {
    const { saved } = await snapshots();
    const activity = await progressActivity();
    const container = render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={activity}
        instruction=""
        pendingUserMessages={[{
          client_id: 'builder-pending-user-message:test',
          message_kind: 'submitted',
          text: 'Write a plan for the first screen.',
        }]}
        snapshot={saved}
      />,
    );

    const pending = container.querySelector('[data-builder-activity-pending="true"]');
    expect(pending).not.toBeNull();
    expect(pending?.getAttribute('data-builder-activity-card')).toBe('You');
    expect(pending?.getAttribute('data-builder-activity-role')).toBe('user');
    expect(pending?.textContent).toContain('Write a plan for the first screen.');
  });

  it('deduplicates a pending local user message after durable activity includes it', async () => {
    const { saved } = await snapshots();
    const activity = await queuedFollowupActivity();
    const container = render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={activity}
        instruction=""
        pendingUserMessages={[{
          client_id: 'builder-pending-user-message:test',
          message_kind: 'queued_followup',
          minimum_sequence: 5,
          text: 'After this, make the summary shorter.',
        }]}
        snapshot={saved}
      />,
    );

    expect(container.querySelector('[data-builder-activity-pending="true"]')).toBeNull();
    expect(container.querySelectorAll('[data-builder-activity-card="You queued a follow-up"]')).toHaveLength(1);
    expect(container.textContent).toContain('After this, make the summary shorter.');
  });

  it('keeps a repeated pending user message visible when only an older durable message matches its text', async () => {
    const { saved } = await snapshots();
    const activity = await queuedFollowupActivity();
    const container = render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={activity}
        instruction=""
        pendingUserMessages={[{
          client_id: 'builder-pending-user-message:test',
          message_kind: 'queued_followup',
          minimum_sequence: activity.conversation?.state === 'ready'
            ? activity.conversation.conversation.head_sequence
            : 7,
          text: 'After this, make the summary shorter.',
        }]}
        snapshot={saved}
      />,
    );

    expect(container.querySelector('[data-builder-activity-pending="true"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-builder-activity-card="You queued a follow-up"]')).toHaveLength(2);
  });

  it('renders consumed queued follow-ups as a compact handoff receipt', async () => {
    const { saved } = await snapshots();
    const activity = await consumedQueuedFollowupActivity();
    const container = render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={activity}
        instruction=""
        snapshot={saved}
      />,
    );

    const consumed = container.querySelector('[data-builder-activity-card="Follow-up picked up"]');
    expect(consumed).not.toBeNull();
    expect(consumed?.textContent).toContain('The queued follow-up moved into the next request.');
    expect(container.textContent).not.toMatch(
      /turn_followup_consumed|builder-run:|builder-message:|sha256:|provider|credential|source_tree|receipt/iu,
    );
  });

  it('does not invent a fixed reply before Harness provides display-safe text', async () => {
    const { saved } = await snapshots();
    const activity = await progressActivity();
    const container = render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={activity}
        instruction=""
        liveOutput={{
          state: 'streaming',
          request_id: 'builder-git-request:123e4567-e89b-42d3-a456-426614174000',
          project_id: PROJECT_ID,
          text: '',
          chunk_count: 0,
        }}
        snapshot={saved}
      />,
    );

    expect(container.querySelector('[data-builder-live-output="true"]')).toBeNull();
    const workStatus = container.querySelector('[data-builder-work-status="true"]');
    expect(workStatus).toBeNull();
    expect(container.textContent).not.toContain("I'm working on this...");
    expect(container.querySelector('[data-builder-activity-card="Context ready"]')).toBeNull();
    expect(container.querySelector('[data-builder-activity-card="AI response started"]')).toBeNull();
    expect(container.querySelector('[data-builder-activity-card="AI response received"]')).toBeNull();
    expect(container.querySelector('[data-builder-activity-card="Preparing result"]')).toBeNull();
    expect(container.textContent).not.toMatch(
      /provider_request_started|provider_response_received|result_preparing|context_ready|request_id|builder-run:|sha256:|provider|credential|source_tree|receipt/iu,
    );
  });

  it('can label approved-plan continuation waiting output without changing the message surface', async () => {
    const { saved } = await snapshots();
    const container = render(
      <BuilderPage
        activeFile={null}
        instruction=""
        liveOutput={{
          state: 'streaming',
          request_id: 'builder-git-request:123e4567-e89b-42d3-a456-426614174000',
          project_id: PROJECT_ID,
          text: '',
          chunk_count: 0,
          waiting_text: 'Applying the approved plan...',
        }}
        snapshot={saved}
      />,
    );

    const liveOutput = container.querySelector('[data-builder-live-output="true"]');
    expect(liveOutput).not.toBeNull();
    expect(liveOutput?.getAttribute('data-builder-live-output-state')).toBe('waiting');
    expect(liveOutput?.getAttribute('data-builder-activity-role')).toBe('assistant');
    expect(
      liveOutput?.querySelector('[data-builder-message-surface]')
        ?.getAttribute('data-builder-message-surface'),
    ).toBe('plain');
    expect(liveOutput?.textContent).toContain('Applying the approved plan...');
    expect(liveOutput?.textContent).not.toContain("I'm working on this...");
    expect(container.textContent).not.toMatch(
      /request_id|builder-run:|sha256:|provider|credential|source_tree|receipt/iu,
    );
  });

  it('shows one replaceable Chinese Harness activity status above live assistant text', async () => {
    const { saved } = await snapshots();
    const container = render(
      <BuilderPage
        activeFile={null}
        instruction=""
        liveOutput={{
          state: 'streaming',
          request_id: 'builder-git-request:123e4567-e89b-42d3-a456-426614174000',
          project_id: PROJECT_ID,
          text: '我正在检查项目。',
          chunk_count: 3,
          waiting_text: '正在思考',
        }}
        snapshot={saved}
      />,
    );

    const liveOutput = container.querySelector('[data-builder-live-output="true"]');
    expect(liveOutput?.getAttribute('data-builder-live-output-state')).toBe('text');
    expect(liveOutput?.querySelectorAll('[data-builder-live-activity="true"]')).toHaveLength(1);
    expect(liveOutput?.querySelector('[data-builder-live-activity="true"]')?.textContent)
      .toBe('正在思考');
    expect(liveOutput?.querySelector('.cf-builder-live-output-text')?.textContent)
      .toBe('我正在检查项目。');
  });

  it('follows the first waiting frame above the composer for an unsaved draft', async () => {
    const { draftReady } = await snapshots();
    const activity = await candidateActivity();
    const frames: FrameRequestCallback[] = [];
    const requestFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    const cancelFrame = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);

    try {
      const container = render(
        <BuilderPage
          activeFile={null}
          conversationSnapshot={activity}
          instruction=""
          liveOutput={{
            state: 'streaming',
            request_id: 'builder-git-request:123e4567-e89b-42d3-a456-426614174000',
            project_id: PROJECT_ID,
            text: '',
            chunk_count: 0,
            waiting_text: 'Applying the next change...',
          }}
          onRejectDraft={vi.fn()}
          onSave={vi.fn()}
          snapshot={draftReady}
        />,
      );
      const scroll = container.querySelector<HTMLElement>('[data-builder-chat-scroll="true"]');
      expect(scroll).not.toBeNull();
      expect(frames).toHaveLength(1);
      setScrollMetrics(scroll!, { clientHeight: 400, scrollHeight: 960, scrollTop: 120 });

      act(() => frames.shift()?.(0));

      expect(scroll?.scrollTop).toBe(960);
      expect(container.querySelector('[data-builder-chat-tail="true"]')).not.toBeNull();
      expect(container.querySelector('[data-builder-live-output-state="waiting"]')?.textContent)
        .toContain('Applying the next change...');
    } finally {
      requestFrame.mockRestore();
      cancelFrame.mockRestore();
    }
  });

  it('keeps the decision card in the composer dock without an overlay spacer', async () => {
    const { draftReady, saved } = await snapshots();
    const activity = await candidateActivity();

    const props = {
      activeFile: null,
      conversationSnapshot: activity,
      instruction: '',
      onRejectDraft: vi.fn(),
      onSave: vi.fn(),
    } as const;
    const container = render(<BuilderPage {...props} snapshot={saved} />);
    const mountedEntry = mounted.find((entry) => entry.container === container);

    act(() => mountedEntry?.root.render(<BuilderPage {...props} snapshot={draftReady} />));

    const stack = container.querySelector('[data-builder-composer-stack="true"]');
    const decision = container.querySelector('[data-builder-composer-version-decision="true"]');
    const composer = container.querySelector('[data-builder-composer="true"]');
    expect(decision?.parentElement).toBe(stack);
    expect(decision?.nextElementSibling).toBe(composer);

    act(() => mountedEntry?.root.render(<BuilderPage {...props} snapshot={saved} />));

    expect(container.querySelector('[data-builder-composer-version-decision="true"]')).toBeNull();
  });

  it('refollows later activity growth after sidebar work until the user scrolls away', async () => {
    const { draftReady } = await snapshots();
    const activity = await candidateActivity();
    const observers: Array<{
      callback: ResizeObserverCallback;
      observer: ResizeObserver;
      targets: Set<Element>;
    }> = [];
    const originalResizeObserver = globalThis.ResizeObserver;

    class TestResizeObserver implements ResizeObserver {
      readonly record: (typeof observers)[number];

      constructor(callback: ResizeObserverCallback) {
        this.record = { callback, observer: this, targets: new Set() };
        observers.push(this.record);
      }

      disconnect(): void { this.record.targets.clear(); }

      observe(target: Element): void { this.record.targets.add(target); }

      unobserve(target: Element): void { this.record.targets.delete(target); }
    }

    Object.defineProperty(globalThis, 'ResizeObserver', {
      configurable: true,
      value: TestResizeObserver,
      writable: true,
    });

    try {
      const container = render(
        <BuilderPage
          activeFile={null}
          conversationSnapshot={activity}
          instruction=""
          onRejectDraft={vi.fn()}
          onSave={vi.fn()}
          snapshot={draftReady}
        />,
      );
      const scroll = container.querySelector<HTMLElement>('[data-builder-chat-scroll="true"]');
      const column = container.querySelector<HTMLElement>('[data-builder-chat-flow-column="true"]');
      expect(scroll).not.toBeNull();
      expect(column).not.toBeNull();
      const flowObserver = observers.find((entry) => entry.targets.has(column!));
      expect(flowObserver).toBeDefined();

      setScrollMetrics(scroll!, { clientHeight: 400, scrollHeight: 1320, scrollTop: 600 });
      act(() => flowObserver?.callback([], flowObserver.observer));
      expect(scroll?.scrollTop).toBe(1320);

      openWorkspaceChanges(container);
      setScrollMetrics(scroll!, { clientHeight: 400, scrollHeight: 1440, scrollTop: 720 });
      act(() => flowObserver?.callback([], flowObserver.observer));
      expect(scroll?.scrollTop).toBe(1440);

      setScrollMetrics(scroll!, { clientHeight: 400, scrollHeight: 1500, scrollTop: 120 });
      act(() => {
        scroll?.dispatchEvent(new WheelEvent('wheel', { deltaY: -120 }));
        scroll?.dispatchEvent(new Event('scroll'));
      });
      act(() => flowObserver?.callback([], flowObserver.observer));
      expect(scroll?.scrollTop).toBe(120);
    } finally {
      Object.defineProperty(globalThis, 'ResizeObserver', {
        configurable: true,
        value: originalResizeObserver,
        writable: true,
      });
    }
  });

  it('keeps targetless legacy tool lifecycle requests out of the chat flow', async () => {
    const { saved } = await snapshots();
    const activity = await pendingToolActivity();
    const container = render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={activity}
        instruction=""
        snapshot={saved}
      />,
    );

    const chat = container.querySelector('[data-builder-chat-main="true"]');
    expect(chat?.querySelector('[data-builder-work-status="true"]')).toBeNull();
    expect(chat?.querySelector('[data-builder-tool-activity="requested"]')).toBeNull();
    expect(chat?.textContent).not.toContain('Looking over the project');
    expect(chat?.textContent).not.toContain('checking the current project context');
    expect(container.textContent).not.toMatch(
      /builder-tool-call:|builder-run-step:|builder-run:|permission_admission|dispatch_admission|execution_admission|result_admission|raw_output_admission|revision_admission|summary_code|tool_call_id|step_id|sha256:|provider|credential|source_tree|receipt/iu,
    );
  });

  it('opens the Agent Test browser sidebar for the current run browser activity', async () => {
    const { saved } = await snapshots();
    const activity = await agentTestBrowserActivity();
    const originalRect = HTMLElement.prototype.getBoundingClientRect;
    const requestFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    const cancelFrame = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function mockedRect(
      this: HTMLElement,
    ) {
      if (this.matches('[data-builder-agent-test-browser-surface="true"]')) {
        return {
          bottom: 700,
          height: 520,
          left: 820,
          right: 1240,
          top: 180,
          width: 420,
          x: 820,
          y: 180,
          toJSON: () => ({}),
        } as DOMRect;
      }
      return originalRect.call(this);
    });
    const onAgentTestBrowserLayoutChange = vi.fn();
    try {
      const container = render(
        <BuilderPage
          activeFile={null}
          conversationSnapshot={activity}
          instruction=""
          onAgentTestBrowserLayoutChange={onAgentTestBrowserLayoutChange}
          snapshot={saved}
        />,
      );
      await act(async () => { await Promise.resolve(); });

      const sidebar = container.querySelector('[data-builder-artifact-sidebar="true"]');
      expect(sidebar?.getAttribute('data-builder-artifact-tab-active')).toBe('browser_placeholder');
      expect(sidebar?.querySelector('[data-builder-side-workspace-tab-label="active"]')?.textContent)
        .toBe('Agent Test');
      expect(sidebar?.querySelector('[data-builder-agent-test-browser-surface="true"]')).not.toBeNull();
      expect(onAgentTestBrowserLayoutChange).toHaveBeenCalledWith(RUN_ID, {
        x: 820,
        y: 180,
        width: 420,
        height: 520,
      });

      onAgentTestBrowserLayoutChange.mockClear();
      click(container, '[data-builder-side-workspace-close-tab="browser_placeholder"]');
      expect(onAgentTestBrowserLayoutChange).toHaveBeenCalledWith(RUN_ID, null);
    } finally {
      requestFrame.mockRestore();
      cancelFrame.mockRestore();
      vi.restoreAllMocks();
    }
  });

  it('opens the Agent Test sidebar from the Main lifecycle even before task stream activity arrives', async () => {
    const { saved } = await snapshots();
    const activity = await failedRunActivity();
    const container = render(
      <BuilderPage
        activeAgentTestBrowserRunId={RUN_ID}
        activeFile={null}
        conversationSnapshot={activity}
        instruction=""
        onAgentTestBrowserLayoutChange={vi.fn()}
        snapshot={saved}
      />,
    );
    await act(async () => { await Promise.resolve(); });
    const sidebar = container.querySelector('[data-builder-artifact-sidebar="true"]');
    expect(sidebar?.getAttribute('data-builder-artifact-tab-active')).toBe('browser_placeholder');
    expect(sidebar?.querySelector('[data-builder-agent-test-browser-surface="true"]')).not.toBeNull();
  });

  it('hands the completed Agent Test tab to project preview without starting a server', async () => {
    const { saved } = await snapshots();
    const activity = await failedRunActivity();
    const onRequestLivePreview = vi.fn();
    const page = (runId: string | null) => <BuilderPage activeFile={null} instruction=""
      activeAgentTestBrowserRunId={runId} conversationSnapshot={activity} snapshot={saved}
      onRequestLivePreview={onRequestLivePreview} />;
    const container = render(page(RUN_ID));
    expect(container.querySelector('[data-builder-artifact-tab-active="browser_placeholder"]')).not.toBeNull();
    act(() => mounted.at(-1)!.root.render(page(null)));
    expect(container.querySelector('[data-builder-artifact-tab-active="preview"]')).not.toBeNull();
    expect(container.querySelector('[data-builder-agent-test-browser-surface="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-side-workspace-tab="browser_placeholder"]')).toBeNull();
    expect(onRequestLivePreview).not.toHaveBeenCalled();
  });

  it('does not reopen a temporary browser tab the user already closed', async () => {
    const { saved } = await snapshots();
    const activity = await failedRunActivity();
    const page = (runId: string | null) => <BuilderPage activeFile={null} instruction=""
      activeAgentTestBrowserRunId={runId} conversationSnapshot={activity} snapshot={saved} />;
    const container = render(page(RUN_ID));
    click(container, '[data-builder-side-workspace-close-tab="browser_placeholder"]');
    act(() => mounted.at(-1)!.root.render(page(null)));
    expect(container.querySelector('[data-builder-artifact-sidebar="true"]')).toBeNull();
  });

  it('replaces generic work status with the concrete active runtime action', async () => {
    const { saved } = await snapshots();
    const activity = await runtimeToolActivity(false);
    const container = render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={activity}
        instruction=""
        snapshot={saved}
      />,
    );

    const chat = container.querySelector('[data-builder-chat-main="true"]');
    const editing = chat?.querySelector('[data-builder-tool-activity="running"]');
    expect(editing).not.toBeNull();
    expect(editing?.getAttribute('data-builder-conversation-node')).toBe('tool_evidence');
    expect(editing?.classList.contains('cf-builder-tool-evidence-row')).toBe(true);
    expect(editing?.querySelector('.cf-builder-tool-evidence-title')?.textContent)
      .toContain('Editing src/file-1.ts');
    expect(editing?.textContent).toContain('Editing src/file-1.ts');
    expect(editing?.querySelector('.cf-builder-activity-spinner')).not.toBeNull();
    expect(chat?.querySelector('[data-builder-work-status="true"]')).toBeNull();
    expect(chat?.textContent).not.toContain('Preparing this request');
  });

  it('shows the latest bounded Harness reasoning status without exposing reasoning text', async () => {
    const { saved } = await snapshots();
    const activity = await runtimeToolActivity(false, ['index.html'], true);
    const container = render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={activity}
        instruction=""
        snapshot={saved}
      />,
    );

    const status = container.querySelector('[data-builder-runtime-status="reasoning"]');
    expect(status?.getAttribute('data-builder-conversation-node')).toBe('reasoning');
    expect(status?.getAttribute('data-builder-reasoning-row')).toBe('true');
    expect(status?.getAttribute('data-builder-activity-card')).toBe('Think');
    expect(status?.querySelector('.cf-builder-activity-title')?.textContent).toContain('Think');
    expect(status?.textContent).toContain('正在思考');
    expect(status?.querySelector('.cf-builder-activity-spinner')).not.toBeNull();
    expect(status?.textContent).not.toMatch(/private reasoning|chain of thought/iu);
    expect(container.querySelector('[data-builder-work-status="true"]')).toBeNull();
  });

  it('keeps only the inline live status once streaming output is present', async () => {
    const { saved } = await snapshots();
    const activity = await runtimeToolActivity(false, ['index.html'], true);
    const container = render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={activity}
        instruction=""
        liveOutput={{
          state: 'streaming',
          request_id: 'builder-git-request:123e4567-e89b-42d3-a456-426614174000',
          project_id: PROJECT_ID,
          text: '我将创建项目文件。',
          chunk_count: 2,
          waiting_text: '正在思考',
        }}
        snapshot={saved}
      />,
    );

    expect(container.querySelector('[data-builder-runtime-status="reasoning"]')).toBeNull();
    expect(container.querySelectorAll('[data-builder-live-activity="true"]')).toHaveLength(1);
    expect(container.querySelector('[data-builder-live-activity="true"]')?.textContent)
      .toBe('正在思考');
  });

  it('keeps an active runtime activity only in the inline live status', async () => {
    const { saved } = await snapshots();
    const activity = await runtimeToolActivity(false, ['index.html'], true, true, 'activity');
    const container = render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={activity}
        instruction=""
        liveOutput={{
          state: 'streaming',
          request_id: 'builder-git-request:123e4567-e89b-42d3-a456-426614174000',
          project_id: PROJECT_ID,
          text: '',
          chunk_count: 0,
          waiting_text: '正在准备工具调用',
        }}
        snapshot={saved}
      />,
    );

    expect(container.querySelector('[data-builder-runtime-status="activity"]')).toBeNull();
    expect(container.querySelectorAll('[data-builder-live-activity="true"]')).toHaveLength(1);
    expect(container.querySelector('[data-builder-live-activity="true"]')?.textContent)
      .toBe('正在准备工具调用');
  });

  it('animates context compaction inline and settles when compaction completes', async () => {
    const { saved } = await snapshots();
    const activity = await runtimeToolActivity(false, ['index.html'], true, true, 'activity');
    const compacting = render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={activity}
        instruction=""
        liveOutput={{
          state: 'streaming',
          request_id: 'builder-git-request:123e4567-e89b-42d3-a456-426614174000',
          project_id: PROJECT_ID,
          text: '',
          chunk_count: 0,
          activity_kind: 'context_compacting',
          waiting_text: '上下文较长，正在整理',
        }}
        snapshot={saved}
      />,
    );

    const compactingStatus = compacting.querySelector('[data-builder-live-activity="true"]');
    expect(compactingStatus?.getAttribute('data-builder-live-activity-kind')).toBe('context_compacting');
    expect(compactingStatus?.textContent).toBe('上下文较长，正在整理');
    expect(compactingStatus?.querySelector('[data-builder-context-compaction-animation="true"]'))
      .not.toBeNull();
    expect(compactingStatus?.querySelector('.cf-builder-activity-spinner')).toBeNull();

    const compacted = render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={activity}
        instruction=""
        liveOutput={{
          state: 'streaming',
          request_id: 'builder-git-request:123e4567-e89b-42d3-a456-426614174000',
          project_id: PROJECT_ID,
          text: '',
          chunk_count: 0,
          activity_kind: 'context_compacted',
          waiting_text: '上下文整理完成，继续处理',
        }}
        snapshot={saved}
      />,
    );
    const compactedStatus = compacted.querySelector('[data-builder-live-activity="true"]');
    expect(compactedStatus?.getAttribute('data-builder-live-activity-kind')).toBe('context_compacted');
    expect(compactedStatus?.textContent).toBe('上下文整理完成，继续处理');
    expect(compactedStatus?.querySelector('[data-builder-context-compacted="true"]')).not.toBeNull();
  });

  it('groups completed runtime file facts while keeping command facts separate', async () => {
    const { saved } = await snapshots();
    const activity = await runtimeToolActivity(true);
    const container = render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={activity}
        instruction=""
        snapshot={saved}
      />,
    );

    const chat = container.querySelector('[data-builder-chat-main="true"]');
    const history = chat?.querySelector('[data-builder-run-history="true"]');
    const fileGroup = chat?.querySelector('[data-builder-runtime-tool-group="file"]');
    const fileGroupDetails = chat?.querySelector('[data-builder-runtime-history-details="file"]');
    const commandGroup = chat?.querySelector('[data-builder-runtime-history-details="command"]');
    const tools = chat?.querySelectorAll('[data-builder-runtime-tool-kind]');
    const fileTools = chat?.querySelectorAll('[data-builder-runtime-tool-kind="edit"]');
    const command = chat?.querySelector('[data-builder-runtime-tool-kind="command"]');
    expect(history).not.toBeNull();
    expect(fileGroup).not.toBeNull();
    expect(fileGroup?.textContent).toContain('Edited 2 files');
    expect(fileGroupDetails).not.toBeNull();
    expect(commandGroup).toBeNull();
    expect(tools).toHaveLength(3);
    expect(fileTools).toHaveLength(2);
    expect(fileTools?.[0]?.textContent).toContain('Edited src/file-1.ts');
    expect(fileTools?.[1]?.textContent).toContain('Edited src/file-2.ts');
    expect(command?.textContent).toContain('Ran npm test');
    expect(command?.textContent).toContain('project check completed successfully');
    expect(command?.getAttribute('data-builder-conversation-node')).toBe('tool_evidence');
    expect(command?.classList.contains('cf-builder-tool-evidence-row')).toBe(true);
    expect(command?.querySelector<HTMLDetailsElement>('[data-builder-tool-evidence-details="terminal"]')).not.toBeNull();
    expect(command?.querySelector<HTMLDetailsElement>('[data-builder-tool-evidence-details="terminal"]')?.open)
      .toBe(false);
    expect(command?.querySelector('.cf-builder-tool-evidence-title')?.textContent)
      .toContain('Ran npm test');
    expect(command?.querySelector('.cf-builder-tool-evidence-detail')?.textContent)
      .toContain('project check completed successfully');
    expect(fileTools?.[0]?.querySelector('[data-builder-tool-detail="diff"]')?.textContent)
      .toContain('src/file-1.ts');
    expect(fileTools?.[0]?.querySelector('[data-builder-tool-detail="diff"]')?.textContent)
      .toContain('+2');
    expect(chat?.querySelector('[data-builder-runtime-history-details="command"]')).toBeNull();
    expect(chat?.textContent).not.toContain('Completed work');
    const narration = chat?.querySelectorAll('[data-builder-runtime-assistant-message]') ?? [];
    expect(narration).toHaveLength(3);
    expect(chat?.textContent).toContain('I found the relevant files and will update them now.');
    expect(chat?.textContent).toContain('The edits are complete. I will run the project check next.');
    expect(chat?.textContent?.match(/Implemented the requested changes and checked the project\./gu))
      .toHaveLength(2);
    const completion = chat?.querySelector('[data-builder-activity-card="Draft proposed"]');
    expect(completion?.getAttribute('data-builder-run-completion-message')).toBeTruthy();
    expect(completion?.textContent)
      .toContain('Implemented the requested changes and checked the project.');
    expect((command?.compareDocumentPosition(completion as Node) ?? 0) & Node.DOCUMENT_POSITION_FOLLOWING)
      .not.toBe(0);
    expect(chat?.textContent).not.toContain('Preparing this request');
  });

  it('keeps a main-owned check result in chat when runtime history only has file facts', async () => {
    const { draftReady } = await snapshots();
    const activity = await runtimeToolActivity(true, ['src/file-1.ts', 'src/file-2.ts'], false, false);
    const container = render(
      <BuilderPage
        activeFile={null}
        checkRunProfiles={[{
          command_profile_id: `builder-command-profile:${'1'.repeat(32)}`,
          command_kind: 'test',
          command_display: 'npm test',
          requires_user_approval: true,
        }]}
        checkRunStatus={{
          projection_version: 'builder-check-run-status-projection.v1',
          project_id: PROJECT_ID,
          candidate_id: `builder-code-change-candidate:${'2'.repeat(64)}`,
          check_run_id: `builder-check-run:${'3'.repeat(32)}`,
          command_kind: 'test',
          command_label: 'Tests',
          status: 'passed',
          label: 'Checked',
          summary: 'The project check completed successfully.',
          environment_reason: 'none',
          completed_at_ms: 1234,
          result_digest: `sha256:${'4'.repeat(64)}`,
        }}
        conversationSnapshot={activity}
        instruction=""
        snapshot={draftReady}
      />,
    );

    const chat = container.querySelector('[data-builder-chat-main="true"]');
    const files = chat?.querySelectorAll('[data-builder-runtime-tool-kind="edit"]');
    const command = chat?.querySelector('[data-builder-runtime-tool-kind="command"]');
    expect(files).toHaveLength(2);
    expect(files?.[0]?.textContent).toContain('Edited src/file-1.ts');
    expect(files?.[1]?.textContent).toContain('Edited src/file-2.ts');
    expect(command?.textContent).toContain('Ran npm test');
    expect(command?.textContent).toContain('The project check completed successfully.');
    click(container, '[data-builder-runtime-tool-open="terminal"]');
    expect(container.querySelector('[data-builder-command-inspector="true"]')).not.toBeNull();
    expect(container.querySelector('[data-builder-command-display="true"]')?.textContent).toBe('npm test');
    expect(container.querySelector('[data-builder-command-result="passed"]')?.textContent)
      .toBe('The project check completed successfully.');
    expect(chat?.textContent).not.toContain('Completed work');
  });

  it('surfaces saved project dependency setup when the project folder is not launch ready', async () => {
    const { draftReady, saved } = await snapshots();
    const onOpenSettings = vi.fn();
    const onPrepareProjectDependencies = vi.fn();
    const savedContainer = render(
      <BuilderPage
        activeFile={null}
        instruction=""
        onOpenSettings={onOpenSettings}
        onPrepareProjectDependencies={onPrepareProjectDependencies}
        projectEnvironmentDiagnosis={projectDependencyMissingDiagnosis()}
        snapshot={saved}
      />,
    );

    const setupCard = savedContainer.querySelector('[data-builder-project-environment-setup="true"]');
    expect(setupCard?.textContent).toContain('Saved project dependencies needed');
    expect(setupCard?.textContent).toContain('project folder does not have an install yet');
    expect(setupCard?.textContent).toContain('Prepare once runs npm install in the saved project folder for local launch');
    expect(setupCard?.textContent).toContain('Current-draft checks still use their isolated workspace.');
    click(savedContainer, '[data-builder-prepare-project-dependencies="true"]');
    expect(onPrepareProjectDependencies).toHaveBeenCalledExactlyOnceWith(
      projectDependencyMissingDiagnosis().project_id,
    );
    click(savedContainer, '[data-builder-open-project-environment-diagnostics="true"]');
    expect(onOpenSettings).toHaveBeenCalledOnce();

    const draftContainer = render(
      <BuilderPage
        activeFile={null}
        instruction=""
        projectEnvironmentDiagnosis={projectDependencyMissingDiagnosis()}
        snapshot={draftReady}
      />,
    );
    expect(draftContainer.querySelector('[data-builder-project-environment-setup="true"]')).toBeNull();
  });

  it('offers a one-shot dependency preparation action above the composer when a check is blocked by missing dependencies', async () => {
    const { draftReady } = await snapshots();
    const activity = await candidateActivity();
    const profile = {
      command_profile_id: `builder-command-profile:${'1'.repeat(32)}`,
      command_kind: 'test' as const,
      command_display: 'npm test',
      requires_user_approval: true as const,
    };
    const onDecideCheckDependencyPreparation = vi.fn();
    const onDiagnoseCheckEnvironment = vi.fn();
    const container = render(
      <BuilderPage
        activeFile={null}
        checkEnvironmentDiagnosis={{
          command_profile_id: profile.command_profile_id,
          status: 'ready',
          diagnosis: {
            diagnosis_version: 'builder-environment-readiness-diagnosis.v1',
            diagnosis_id: `builder-environment-readiness-diagnosis:${'5'.repeat(64)}`,
            project_id: PROJECT_ID,
            candidate_id: `builder-code-change-candidate:${'2'.repeat(64)}`,
            source_tree_digest: `sha256:${'6'.repeat(64)}`,
            command_profile_id: profile.command_profile_id,
            command_kind: 'test',
            command_display: 'npm test',
            package_manager: 'npm',
            package_manifest: 'present',
            dependency_manifest: 'present',
            lockfile: 'package-lock.json',
            project_dependency_state: 'install_missing',
            check_workspace_dependency_state: 'install_missing',
            host_toolchain_state: 'visible',
            host_node_version: '22.17.0',
            host_package_manager_version: '10.9.2',
            install_permission: 'required',
            dependency_strategy: 'needs_prepared_dependency_workspace',
            readiness_state: 'dependencies_not_prepared',
            primary_action: 'prepare_once',
            safe_summary: 'The isolated check workspace has not prepared this draft\'s dependencies yet.',
            diagnosed_at_ms: 1234,
            diagnosis_digest: `sha256:${'7'.repeat(64)}`,
          },
        }}
        checkRunProfiles={[profile]}
        checkRunStatus={{
          projection_version: 'builder-check-run-status-projection.v1',
          project_id: PROJECT_ID,
          candidate_id: `builder-code-change-candidate:${'2'.repeat(64)}`,
          check_run_id: `builder-check-run:${'3'.repeat(64)}`,
          command_kind: 'test',
          command_label: 'Tests',
          status: 'incomplete',
          label: 'Check unavailable',
          summary: 'This draft declares project dependencies, but the isolated check workspace has not prepared them yet.',
          environment_reason: 'dependency_workspace_missing',
          completed_at_ms: 1234,
          result_digest: `sha256:${'4'.repeat(64)}`,
        }}
        conversationSnapshot={activity}
        instruction=""
        onDecideCheckDependencyPreparation={onDecideCheckDependencyPreparation}
        onDiagnoseCheckEnvironment={onDiagnoseCheckEnvironment}
        snapshot={draftReady}
      />,
    );

    const card = container.querySelector('[data-builder-dependency-preparation="true"]');
    const composer = container.querySelector('[data-builder-composer-stack="true"]');
    expect(card?.textContent).toContain('Prepare check dependencies?');
    expect(card?.textContent).toContain('npm test');
    expect(card?.querySelector(
      '[data-builder-dependency-preparation-status="needs_approval"]',
    )?.textContent).toContain('Project folderNot changed by Prepare once');
    expect(card?.querySelector(
      '[data-builder-dependency-preparation-fact="check_workspace"]',
    )?.textContent).toContain('Dependencies not prepared yet');
    expect(card?.querySelector(
      '[data-builder-dependency-preparation-fact="after_prepare"]',
    )?.textContent).toContain('Builder will rerun npm test and enable Save if it passes.');
    expect(card?.textContent).toContain('Readiness: The isolated check workspace has not prepared this draft\'s dependencies yet.');
    expect(card?.textContent).toContain('Toolchain: visible');
    expect(card?.textContent).toContain('Check workspace: install_missing');
    expect(card?.textContent).toContain('Package manager: npm');
    expect(composer?.compareDocumentPosition(card as Node) ?? 0)
      .toBe(Node.DOCUMENT_POSITION_PRECEDING);
    click(container, '[data-builder-diagnose-check-environment="true"]');
    expect(onDiagnoseCheckEnvironment).toHaveBeenCalledExactlyOnceWith(profile);
    expect(onDecideCheckDependencyPreparation).not.toHaveBeenCalled();
    click(container, '[data-builder-allow-dependency-preparation="true"]');
    expect(onDecideCheckDependencyPreparation).toHaveBeenCalledExactlyOnceWith('allow_once', profile);
  });

  it('keeps dependency preparation focused without a generic generation failure notice', async () => {
    const { draftReady } = await snapshots();
    const activity = await candidateActivity();
    const profile = {
      command_profile_id: `builder-command-profile:${'1'.repeat(32)}`,
      command_kind: 'test' as const,
      command_display: 'npm test',
      requires_user_approval: true as const,
    };
    const onDecideCheckDependencyPreparation = vi.fn();
    const container = render(
      <BuilderPage
        activeFile={null}
        checkRunProfiles={[profile]}
        checkRunStatus={{
          projection_version: 'builder-check-run-status-projection.v1',
          project_id: PROJECT_ID,
          candidate_id: `builder-code-change-candidate:${'2'.repeat(64)}`,
          check_run_id: `builder-check-run:${'3'.repeat(64)}`,
          command_kind: 'test',
          command_label: 'Tests',
          status: 'incomplete',
          label: 'Check unavailable',
          summary: 'This draft declares project dependencies, but the isolated check workspace has not prepared them yet.',
          environment_reason: 'dependency_workspace_missing',
          completed_at_ms: 1234,
          result_digest: `sha256:${'4'.repeat(64)}`,
        }}
        conversationSnapshot={activity}
        instruction=""
        onDecideCheckDependencyPreparation={onDecideCheckDependencyPreparation}
        snapshot={draftReady}
      />,
    );

    const card = container.querySelector('[data-builder-dependency-preparation="true"]');
    const composer = container.querySelector('[data-builder-composer-stack="true"]');
    expect(container.querySelector('[data-builder-conversation-notice="generation_failed"]')).toBeNull();
    expect(container.querySelector('[data-builder-retry-draft="true"]')).toBeNull();
    expect(card?.textContent).toContain('Prepare check dependencies?');
    expect(composer?.compareDocumentPosition(card as Node) ?? 0)
      .toBe(Node.DOCUMENT_POSITION_PRECEDING);
  });

  it('keeps dependency preparation visible while the preparation request is in flight', async () => {
    const { draftReady } = await snapshots();
    const activity = await candidateRunningCheckActivity();
    const profile = {
      command_profile_id: `builder-command-profile:${'1'.repeat(32)}`,
      command_kind: 'test' as const,
      command_display: 'npm test',
      requires_user_approval: true as const,
    };
    const onDecideCheckDependencyPreparation = vi.fn();
    const container = render(
      <BuilderPage
        activeFile={null}
        checkRunOperation="preparing_dependencies"
        checkRunProfiles={[profile]}
        checkRunStatus={{
          projection_version: 'builder-check-run-status-projection.v1',
          project_id: PROJECT_ID,
          candidate_id: `builder-code-change-candidate:${'2'.repeat(64)}`,
          check_run_id: `builder-check-run:${'3'.repeat(64)}`,
          command_kind: 'test',
          command_label: 'Tests',
          status: 'incomplete',
          label: 'Check unavailable',
          summary: 'This draft declares project dependencies, but the isolated check workspace has not prepared them yet.',
          environment_reason: 'dependency_workspace_missing',
          completed_at_ms: 1234,
          result_digest: `sha256:${'4'.repeat(64)}`,
        }}
        conversationSnapshot={activity}
        instruction=""
        onDecideCheckDependencyPreparation={onDecideCheckDependencyPreparation}
        snapshot={draftReady}
      />,
    );

    const card = container.querySelector('[data-builder-dependency-preparation="true"]');
    const composer = container.querySelector('[data-builder-composer-stack="true"]');
    expect(card?.textContent).toContain('Prepare check dependencies?');
    expect(card?.textContent).toContain('Preparing...');
    expect(card?.querySelector(
      '[data-builder-dependency-preparation-status="preparing"]',
    )?.textContent).toContain('Preparing dependencies now');
    expect(card?.querySelector(
      '[data-builder-dependency-preparation-fact="after_prepare"]',
    )?.textContent).toContain('Builder will rerun npm test automatically.');
    expect(container.querySelector<HTMLButtonElement>('[data-builder-allow-dependency-preparation="true"]')?.disabled)
      .toBe(true);
    expect(container.querySelector<HTMLButtonElement>('[data-builder-deny-dependency-preparation="true"]')?.disabled)
      .toBe(true);
    expect(composer?.compareDocumentPosition(card as Node) ?? 0)
      .toBe(Node.DOCUMENT_POSITION_PRECEDING);
  });

  it('keeps dependency preparation failures visible as retryable state above the composer', async () => {
    const { draftReady } = await snapshots();
    const activity = await candidateActivity();
    const profile = {
      command_profile_id: `builder-command-profile:${'1'.repeat(32)}`,
      command_kind: 'test' as const,
      command_display: 'npm test',
      requires_user_approval: true as const,
    };
    const onDecideCheckDependencyPreparation = vi.fn();
    const container = render(
      <BuilderPage
        activeFile={null}
        checkRunProfiles={[profile]}
        checkRunStatus={{
          projection_version: 'builder-check-run-status-projection.v1',
          project_id: PROJECT_ID,
          candidate_id: `builder-code-change-candidate:${'2'.repeat(64)}`,
          check_run_id: `builder-check-run:${'3'.repeat(64)}`,
          command_kind: 'test',
          command_label: 'Tests',
          status: 'incomplete',
          label: 'Check unavailable',
          summary: 'Dependency preparation failed in the isolated check workspace. You can retry preparation for this check.',
          environment_reason: 'dependency_preparation_failed',
          completed_at_ms: 1234,
          result_digest: `sha256:${'4'.repeat(64)}`,
        }}
        conversationSnapshot={activity}
        instruction=""
        onDecideCheckDependencyPreparation={onDecideCheckDependencyPreparation}
        snapshot={draftReady}
      />,
    );

    const card = container.querySelector('[data-builder-dependency-preparation="true"]');
    const composer = container.querySelector('[data-builder-composer-stack="true"]');
    expect(card?.getAttribute('data-builder-dependency-preparation-failed')).toBe('true');
    expect(card?.textContent).toContain('Check dependency preparation failed');
    expect(card?.textContent).toContain('Dependency preparation failed in the isolated check workspace.');
    expect(card?.textContent).toContain('You can retry this check preparation.');
    expect(card?.querySelector(
      '[data-builder-dependency-preparation-status="retryable"]',
    )?.textContent).toContain('Needs another preparation attempt');
    expect(composer?.compareDocumentPosition(card as Node) ?? 0)
      .toBe(Node.DOCUMENT_POSITION_PRECEDING);
    click(container, '[data-builder-allow-dependency-preparation="true"]');
    expect(onDecideCheckDependencyPreparation).toHaveBeenCalledExactlyOnceWith('allow_once', profile);
  });

  it('routes local toolchain blocks to diagnosis instead of dependency preparation', async () => {
    const { draftReady } = await snapshots();
    const activity = await candidateActivity();
    const profile = {
      command_profile_id: `builder-command-profile:${'1'.repeat(32)}`,
      command_kind: 'build' as const,
      command_display: 'npm run build',
      requires_user_approval: true as const,
    };
    const onDecideCheckDependencyPreparation = vi.fn();
    const onDiagnoseCheckEnvironment = vi.fn();
    const container = render(
      <BuilderPage
        activeFile={null}
        checkRunProfiles={[profile]}
        checkRunStatus={{
          projection_version: 'builder-check-run-status-projection.v1',
          project_id: PROJECT_ID,
          candidate_id: `builder-code-change-candidate:${'2'.repeat(64)}`,
          check_run_id: `builder-check-run:${'3'.repeat(64)}`,
          command_kind: 'build',
          command_label: 'Build',
          status: 'incomplete',
          label: 'Check unavailable',
          summary: 'Builder cannot see the local Node/package-manager toolchain required for this check.',
          environment_reason: 'host_toolchain_missing',
          completed_at_ms: 1234,
          result_digest: `sha256:${'4'.repeat(64)}`,
        }}
        conversationSnapshot={activity}
        instruction=""
        onDecideCheckDependencyPreparation={onDecideCheckDependencyPreparation}
        onDiagnoseCheckEnvironment={onDiagnoseCheckEnvironment}
        snapshot={draftReady}
      />,
    );

    const card = container.querySelector('[data-builder-dependency-preparation="true"]');
    expect(card?.textContent).toContain('Local toolchain unavailable');
    expect(card?.querySelector(
      '[data-builder-dependency-preparation-status="toolchain_unavailable"]',
    )?.textContent).toContain('Waiting for local toolchain');
    expect(card?.querySelector(
      '[data-builder-dependency-preparation-fact="after_prepare"]',
    )?.textContent).toContain('Diagnose local tools before preparing dependencies.');
    expect(container.querySelector('[data-builder-allow-dependency-preparation="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-deny-dependency-preparation="true"]')).toBeNull();
    click(container, '[data-builder-diagnose-check-environment="true"]');
    expect(onDiagnoseCheckEnvironment).toHaveBeenCalledExactlyOnceWith(profile);
    expect(onDecideCheckDependencyPreparation).not.toHaveBeenCalled();
  });

  it('explains dependency preparation decision failures without hiding the retry action', async () => {
    const { draftReady } = await snapshots();
    const activity = await candidateActivity();
    const profile = {
      command_profile_id: `builder-command-profile:${'1'.repeat(32)}`,
      command_kind: 'test' as const,
      command_display: 'npm test',
      requires_user_approval: true as const,
    };
    const onDecideCheckDependencyPreparation = vi.fn();
    const container = render(
      <BuilderPage
        activeFile={null}
        checkRunOperation="failed"
        checkRunOperationFailureCode="busy"
        checkRunProfiles={[profile]}
        checkRunStatus={{
          projection_version: 'builder-check-run-status-projection.v1',
          project_id: PROJECT_ID,
          candidate_id: `builder-code-change-candidate:${'2'.repeat(64)}`,
          check_run_id: `builder-check-run:${'3'.repeat(64)}`,
          command_kind: 'test',
          command_label: 'Tests',
          status: 'incomplete',
          label: 'Check unavailable',
          summary: 'This draft declares project dependencies, but the isolated check workspace has not prepared them yet.',
          environment_reason: 'dependency_workspace_missing',
          completed_at_ms: 1234,
          result_digest: `sha256:${'4'.repeat(64)}`,
        }}
        conversationSnapshot={activity}
        instruction=""
        onDecideCheckDependencyPreparation={onDecideCheckDependencyPreparation}
        snapshot={draftReady}
      />,
    );

    const card = container.querySelector('[data-builder-dependency-preparation="true"]');
    const composer = container.querySelector('[data-builder-composer-stack="true"]');
    expect(card?.textContent).toContain('A project check is already running. Try again when it finishes.');
    expect(card?.textContent).toContain('Prepare once');
    expect(composer?.compareDocumentPosition(card as Node) ?? 0)
      .toBe(Node.DOCUMENT_POSITION_PRECEDING);
    click(container, '[data-builder-allow-dependency-preparation="true"]');
    expect(onDecideCheckDependencyPreparation).toHaveBeenCalledExactlyOnceWith('allow_once', profile);
  });

  it('opens runtime file and command facts without rendering duplicate completion actions', async () => {
    const draftReady = await changedDraftSnapshot();
    const activity = await runtimeToolActivity(true, ['index.html', 'src/add.ts']);
    const onSelectFile = vi.fn();
    const container = render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={activity}
        instruction=""
        onSelectFile={onSelectFile}
        snapshot={draftReady}
      />,
    );

    expect(container.querySelector('[data-builder-completed-action-group]')).toBeNull();
    click(container, '[data-builder-runtime-tool-open="changes"]');
    await act(async () => { await Promise.resolve(); });
    expect(onSelectFile).toHaveBeenCalledExactlyOnceWith('index.html');
    click(container, '[data-builder-runtime-tool-open="terminal"]');
    expect(container.querySelector('[data-builder-side-workspace-tool="terminal_placeholder"]'))
      .not.toBeNull();
    expect(container.querySelector('[data-builder-command-inspector="true"]')?.textContent)
      .toContain('npm test');
    expect(container.querySelector('[data-builder-command-inspector="true"]')?.textContent)
      .toContain('The project check completed successfully.');
  });

  it('opens an active runtime file through its main-issued tool identity without a draft candidate', async () => {
    const { fresh } = await snapshots();
    const activity = await runtimeToolActivity(false, ['index.html']);
    const runtimeFile = Object.freeze({
      path: 'index.html',
      contentDigest: SIDE_WORKSPACE_APP_DIGEST,
    });
    const runtimeTree = sideWorkspaceFileTree([runtimeFile], 'runtime_snapshot');
    const runtimeContent = sideWorkspaceFileContent(
      runtimeFile,
      '<main>Runtime result</main>\n',
      'html',
      'runtime_snapshot',
    );
    const onOpenRuntimeToolFile = vi.fn();

    function RuntimeFilePage() {
      const [opened, setOpened] = useState(false);
      return (
        <BuilderPage
          activeFile={opened ? 'index.html' : null}
          conversationSnapshot={activity}
          instruction=""
          onOpenRuntimeToolFile={async (request) => {
            onOpenRuntimeToolFile(request);
            setOpened(true);
            return true;
          }}
          sideWorkspaceFileContent={opened ? runtimeContent : null}
          sideWorkspaceFileContentStatus={opened ? 'ready' : 'idle'}
          sideWorkspaceFileTree={opened ? runtimeTree : null}
          sideWorkspaceFileTreeStatus={opened ? 'ready' : 'idle'}
          snapshot={fresh}
        />
      );
    }
    const container = render(
      <RuntimeFilePage />,
    );

    const activeTool = container.querySelector('[data-builder-tool-activity="running"]');
    expect(activeTool?.getAttribute('data-builder-conversation-node')).toBe('tool_evidence');
    expect(activeTool?.querySelector<HTMLDetailsElement>('[data-builder-tool-evidence-details="changes"]')).not.toBeNull();
    expect(activeTool?.querySelector('[data-builder-runtime-tool-open="changes"]')?.textContent)
      .toContain('Open');
    click(container, '[data-builder-runtime-tool-open="changes"]');
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onOpenRuntimeToolFile).toHaveBeenCalledExactlyOnceWith({
      run_id: RUN_ID,
      tool_call_id: 'builder-tool-call:00000000-0000-4000-8000-000000000001',
    });
    expect(container.querySelector('[data-builder-artifact-sidebar="true"]')).not.toBeNull();
    expect(container.textContent).toContain('Runtime result');
  });

  it('returns from a runtime snapshot to current draft files through the Workspace menu', async () => {
    const { draftReady } = await snapshots();
    const runtimeFile = Object.freeze({
      path: 'index.html',
      contentDigest: SIDE_WORKSPACE_APP_DIGEST,
    });
    const onRequestSideWorkspaceFiles = vi.fn();
    const container = render(
      <BuilderPage
        activeFile="index.html"
        instruction=""
        onRequestSideWorkspaceFiles={onRequestSideWorkspaceFiles}
        sideWorkspaceFileContent={sideWorkspaceFileContent(
          runtimeFile,
          '<main>Runtime result</main>\n',
          'html',
          'runtime_snapshot',
        )}
        sideWorkspaceFileContentStatus="ready"
        sideWorkspaceFileTree={sideWorkspaceFileTree([runtimeFile], 'runtime_snapshot')}
        sideWorkspaceFileTreeStatus="ready"
        snapshot={draftReady}
      />,
    );

    click(container, '[data-builder-workspace-menu-button="true"]');
    click(container, '[data-builder-workspace-control-tab="source"]');

    expect(onRequestSideWorkspaceFiles).toHaveBeenCalledOnce();
  });

  it('loads the replacement draft after a runtime file snapshot was opened', async () => {
    const { draftReady } = await snapshots();
    const activity = await runtimeToolActivity(false, ['index.html']);
    const runtimeFile = Object.freeze({
      path: 'index.html',
      contentDigest: SIDE_WORKSPACE_APP_DIGEST,
    });
    const runtimeTree = sideWorkspaceFileTree([runtimeFile], 'runtime_snapshot');
    const runtimeContent = sideWorkspaceFileContent(
      runtimeFile,
      '<main>Runtime result</main>\n',
      'html',
      'runtime_snapshot',
    );
    const onRequestSideWorkspaceFiles = vi.fn();

    function RuntimeThenReplacementDraftPage() {
      const [runtimeOpened, setRuntimeOpened] = useState(false);
      const [replacementReady, setReplacementReady] = useState(false);
      return (
        <div>
          <button
            data-builder-test-show-replacement-draft="true"
            onClick={() => setReplacementReady(true)}
            type="button"
          >
            Show replacement draft
          </button>
          <BuilderPage
            activeFile={runtimeOpened ? 'index.html' : null}
            conversationSnapshot={activity}
            instruction=""
            onOpenRuntimeToolFile={async () => {
              setRuntimeOpened(true);
              return true;
            }}
            onRequestSideWorkspaceFiles={onRequestSideWorkspaceFiles}
            sideWorkspaceFileContent={runtimeOpened && !replacementReady ? runtimeContent : null}
            sideWorkspaceFileContentStatus={runtimeOpened && !replacementReady ? 'ready' : 'idle'}
            sideWorkspaceFileTree={runtimeOpened && !replacementReady ? runtimeTree : null}
            sideWorkspaceFileTreeStatus={runtimeOpened && !replacementReady ? 'ready' : 'idle'}
            snapshot={draftReady}
          />
        </div>
      );
    }
    const container = render(<RuntimeThenReplacementDraftPage />);

    click(container, '[data-builder-runtime-tool-open="changes"]');
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.textContent).toContain('Runtime result');
    expect(onRequestSideWorkspaceFiles).not.toHaveBeenCalled();

    click(container, '[data-builder-test-show-replacement-draft="true"]');
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onRequestSideWorkspaceFiles).toHaveBeenCalledOnce();
  });

  it('does not retain targetless project context lifecycle rows after completion', async () => {
    const { saved } = await snapshots();
    const activity = await toolActivity();
    const container = render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={activity}
        instruction=""
        snapshot={saved}
      />,
    );

    const chat = container.querySelector('[data-builder-chat-main="true"]');
    const completion = chat?.querySelector('[data-builder-activity-card="Draft proposed"]');
    expect(completion?.textContent)
      .toContain('I prepared a draft after reading the project context.');
    expect(completion?.querySelector('[data-builder-run-history="true"]')).toBeNull();
    expect(chat?.querySelector('[data-builder-run-history="true"]')).toBeNull();
    expect(chat?.textContent).not.toContain('Project context ready');
    expect(chat?.textContent).not.toContain('I checked the project context needed for this request.');
    expect(container.textContent).not.toMatch(
      /builder-tool-call:|builder-run-step:|builder-run:|permission_admission|dispatch_admission|execution_admission|result_admission|raw_output_admission|revision_admission|summary_code|tool_call_id|step_id|sha256:|provider|credential|source_tree|receipt/iu,
    );
  });

  it('keeps work progress in chat without exposing Logs as a workspace destination', async () => {
    const { fresh } = await snapshots();
    const activity = await toolActivity();
    const container = render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={activity}
        instruction=""
        snapshot={fresh}
      />,
    );

    const chatMain = container.querySelector('[data-builder-chat-main="true"]');
    const workspace = container.querySelector('[data-builder-chat-workspace="true"]');
    const sidebar = container.querySelector('[data-builder-artifact-sidebar="true"]');
    expect(chatMain).not.toBeNull();
    expect(workspace?.getAttribute('data-builder-artifact-sidebar-visible')).toBe('false');
    expect(sidebar).toBeNull();
    expect(chatMain?.querySelector('[data-builder-run-history="true"]')).toBeNull();
    expect(chatMain?.textContent).not.toContain('Why this ran');
    expect(container.querySelector('[data-builder-artifact-logs="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-workspace-control-tab="logs"]')).toBeNull();
    expect(chatMain?.textContent).not.toMatch(
      /builder-tool-call:|builder-run-step:|builder-run:|permission_admission|dispatch_admission|execution_admission|result_admission|raw_output_admission|revision_admission|summary_code|tool_call_id|step_id|sha256:|provider|credential|source_tree|receipt/iu,
    );
    expect(container.querySelector('[data-builder-activity="true"]')?.closest('[data-builder-chat-main="true"]'))
      .toBe(chatMain);
  });

  it('keeps route diagnostics out of the user-facing chat flow', async () => {
    const { saved } = await snapshots();
    const activity = await toolActivity(undefined, {
      context: {
        route: 'clarify',
        dispatch: 'reply',
        downgraded_from: 'build',
        downgrade_reason: 'missing_prior_build_context',
        brief: 'not_available',
        base: 'new_project_or_unsaved',
        permission_result: 'not_required',
      },
    });
    const container = render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={activity}
        instruction=""
        snapshot={saved}
      />,
    );

    const chatMain = container.querySelector('[data-builder-chat-main="true"]');
    expect(chatMain?.textContent).not.toContain('not have enough confirmed direction');
    expect(chatMain?.textContent).not.toContain('Builder kept this as a clarification step.');
    expect(container.querySelector('[data-builder-artifact-logs="true"]')).toBeNull();
    expect(container.textContent).not.toMatch(
      /downgrade_reason|downgraded_from|builder-route-decision|required_permissions|confidence|provider|credential|source_tree|receipt/iu,
    );
  });

  it('keeps internal task-brief memory out of the user-facing workspace', async () => {
    const { saved } = await snapshots();
    const activity = await briefActivity();
    const container = render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={activity}
        instruction=""
        snapshot={saved}
      />,
    );

    const chatMain = container.querySelector('[data-builder-chat-main="true"]');
    expect(container.querySelector('[data-builder-current-direction="true"]')).toBeNull();
    expect(chatMain?.textContent).not.toContain('Current direction');
    expect(container.querySelector('[data-builder-workspace-control-tab="logs"]')).toBeNull();
    expect(container.textContent).not.toMatch(
      /Current project brief|builder-task:|builder-run:|builder-message:|builder-route-decision|working_brief|sha256:|provider|credential|source_tree|receipt/iu,
    );
  });

  it('does not retain targetless project file read rows after completion', async () => {
    const { saved } = await snapshots();
    const activity = await toolActivity(undefined, {
      action: 'filesystem.read',
      resourceKind: 'filesystem',
      toolLabel: 'Read project file',
    });
    const container = render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={activity}
        instruction=""
        snapshot={saved}
      />,
    );

    const chat = container.querySelector('[data-builder-chat-main="true"]');
    expect(chat?.querySelector('[data-builder-run-history="true"]')).toBeNull();
    expect(chat?.textContent).not.toContain('Project files reviewed');
    expect(chat?.textContent).not.toContain('I checked the project files needed for this request.');
    expect(chat?.textContent).not.toMatch(
      /tool|adapter|output|admission|summary_code|resource_kind|builder-tool-call:|source_tree|receipt/iu,
    );
  });

  it('does not surface targetless legacy tool lifecycle rows while they update', async () => {
    const { saved } = await snapshots();
    const pending = await pendingToolActivity();
    const completed = await toolActivity(undefined, { completed: false });
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    mounted.push({ container, root });

    act(() => root.render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={pending}
        instruction=""
        snapshot={saved}
      />,
    ));
    expect(container.querySelector('[data-builder-tool-activity="requested"]')).toBeNull();

    act(() => root.render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={completed}
        instruction=""
        snapshot={saved}
      />,
    ));
    expect(container.querySelector('[data-builder-tool-activity="succeeded"]')).toBeNull();
    expect(container.querySelectorAll('[data-builder-tool-activity]')).toHaveLength(0);
    expect(container.textContent).not.toContain('Project context ready');
  });

  it('keeps a tool failure visible until the run records its final result', async () => {
    const { saved } = await snapshots();
    const activity = await toolActivity({
      status: 'failed',
      summary_code: 'output_rejected',
      display_summary: 'The tool output was not accepted.',
    }, { completed: false });
    const container = render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={activity}
        instruction=""
        snapshot={saved}
      />,
    );

    const completed = container.querySelector('[data-builder-tool-activity="failed"]');
    expect(completed).not.toBeNull();
    expect(completed?.getAttribute('data-builder-activity-role')).toBe('status');
    expect(completed?.textContent).toContain('Project context needs attention');
    expect(completed?.textContent).toContain('could not safely use the information from this step');
    expect(completed?.textContent).not.toMatch(/tool|adapter|output|admission|summary_code|resource_kind|builder-tool-call:/iu);
  });

  it('keeps a completed tool failure in the canonical activity stream', async () => {
    const { saved } = await snapshots();
    const activity = await toolActivity({
      status: 'failed',
      summary_code: 'output_rejected',
      display_summary: 'The tool output was not accepted.',
    });
    const container = render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={activity}
        instruction=""
        snapshot={saved}
      />,
    );

    const chat = container.querySelector('[data-builder-chat-main="true"]');
    expect(chat?.querySelector('[data-builder-activity-card="Draft proposed"]')).not.toBeNull();
    const history = chat?.querySelector<HTMLDetailsElement>('[data-builder-run-history="true"]');
    const loggedFailure = chat?.querySelector('[data-builder-tool-activity="failed"]');
    expect(history).toBeNull();
    expect(loggedFailure?.textContent).toContain('Project context needs attention');
    expect(loggedFailure?.textContent).toContain('could not safely use the information from this step');
  });

  it('maps unavailable tool results to safe text in the canonical activity stream', async () => {
    const { saved } = await snapshots();
    const activity = await toolActivity({
      status: 'failed',
      summary_code: 'adapter_unavailable',
      display_summary: 'The tool was unavailable.',
    });
    const container = render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={activity}
        instruction=""
        snapshot={saved}
      />,
    );

    const history = container.querySelector<HTMLDetailsElement>(
      '[data-builder-chat-main="true"] [data-builder-run-history="true"]',
    );
    const completed = container.querySelector(
      '[data-builder-chat-main="true"] [data-builder-tool-activity="failed"]',
    );
    expect(history).toBeNull();
    expect(completed).not.toBeNull();
    expect(completed?.textContent).toContain('Project context needs attention');
    expect(completed?.textContent).toContain('This project step is not available yet.');
    expect(completed?.textContent).not.toMatch(/tool|adapter|output|admission|summary_code|resource_kind|builder-tool-call:/iu);
  });

  it('shows draft file changes before Save without exposing source or Git evidence', async () => {
    const draftReady = await changedDraftSnapshot();
    const onSelectFile = vi.fn();
    const container = render(
      <BuilderPage
        activeFile={null}
        instruction="Update the saved project."
        onSelectFile={onSelectFile}
        snapshot={draftReady}
      />,
    );

    expect(container.querySelector('[data-builder-review-checkpoint="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-draft-landing="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-artifact-summary="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-artifact-sidebar="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-changes-panel="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-changes-disclosure="true"]')).toBeNull();
    openWorkspaceChanges(container);
    const changesPanel = container.querySelector('[data-builder-changes-panel="true"]');
    const changesFlow = container.querySelector('[data-builder-changes-flow="true"]');
    const changesDisclosure = container.querySelector<HTMLDetailsElement>('[data-builder-changes-disclosure="true"]');
    expect(changesPanel).not.toBeNull();
    expect(changesFlow).not.toBeNull();
    expect(changesPanel?.closest('[data-builder-chat-main="true"]')).toBeNull();
    expect(changesPanel?.closest('[data-builder-artifact-sidebar="true"]')).not.toBeNull();
    expect(changesPanel?.closest('[data-builder-changes-flow="true"]')).toBe(changesFlow);
    expect(changesPanel?.getAttribute('data-builder-changes-placement')).toBe('artifact');
    expect(changesDisclosure).not.toBeNull();
    expect(changesDisclosure?.open).toBe(true);
    expect(changesDisclosure?.querySelector('.cf-builder-changes-title')).toBeNull();
    expect(container.querySelector('[data-builder-workspace-menu-button="true"]')?.getAttribute('aria-label'))
      .toBe('Workspace menu');
    expect(container.querySelector('[data-builder-changes-summary="true"]')?.textContent)
      .toContain('3 file changes: 1 added, 1 changed, 1 removed.');
    expect(container.querySelector('[data-builder-change-card="Changed index.html"]')?.textContent)
      .toContain('1 line to 2 lines');
    expect(container.querySelector('[data-builder-change-card="Added src/add.ts"]')?.textContent)
      .toContain('1 line added');
    expect(container.querySelector('[data-builder-change-card="Removed src/remove.ts"]')?.textContent)
      .toContain('1 line removed');
    expect(container.querySelector('[data-builder-change-diff="index.html"]')?.textContent)
      .toContain('<main>Old</main>');
    expect(container.querySelector('[data-builder-change-diff="index.html"]')?.textContent)
      .toContain('<main>New</main>');
    expect(container.querySelector('[data-builder-change-diff="src/add.ts"]')?.textContent)
      .toContain('const added = true;');
    expect(container.querySelector('[data-builder-change-diff="src/remove.ts"]')?.textContent)
      .toContain('const removed = true;');
    expect(container.querySelector('[data-builder-change-diff="index.html"] [data-builder-change-diff-line-kind="removed"]'))
      .not.toBeNull();
    expect(container.querySelector('[data-builder-change-diff="index.html"] [data-builder-change-diff-line-kind="added"]'))
      .not.toBeNull();
    expect(changesPanel?.textContent).not.toMatch(
      /sha256:|commit_oid|tree_oid|receipt|review_id|provider|credential/iu,
    );

    onSelectFile.mockClear();
    click(container, '[data-builder-change-card="Added src/add.ts"] button');
    expect(onSelectFile).toHaveBeenCalledExactlyOnceWith('src/add.ts');
  });

  it('explains runtime-only 3D drafts when the static preview may look blank', async () => {
    const baseTree = await createSourceTree([
      { path: 'index.html', content: '<main>Old scene</main>\n' },
      { path: 'styles.css', content: 'main { color: black; }\n' },
    ]);
    const draftTree = await createSourceTree([
      { path: 'index.html', content: '<main><canvas id="stage"></canvas><script type="module" src="./src/scene.js"></script></main>\n' },
      { path: 'styles.css', content: 'canvas { inline-size: 100%; block-size: 420px; }\n' },
      { path: 'src/scene.js', content: 'import * as THREE from "three";\nfetch("https://example.com/model.glb");\nrequestAnimationFrame(() => undefined);\n' },
    ]);
    const draftReady = await draftSnapshotFromSourceTrees(baseTree, draftTree);
    const container = render(
      <BuilderPage
        activeFile={null}
        instruction="Make a 3D page."
        snapshot={draftReady}
      />,
    );

    expect(container.querySelector('[data-builder-artifact-sidebar="true"]')).toBeNull();
    click(container, '[data-builder-workspace-menu-button="true"]');
    click(container, '[data-builder-workspace-control-tab="preview"]');

    const limitation = container.querySelector('[data-builder-preview-limitation="true"]');
    const blocked = container.querySelector('[data-builder-preview-runtime-blocked="true"]');
    expect(container.querySelector('[data-builder-review-checkpoint="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-artifact-summary="true"]')).toBeNull();
    expect(blocked).not.toBeNull();
    expect(limitation?.textContent).toContain('Preview unavailable here');
    expect(limitation?.textContent).toContain('needs live preview support');
    expect(limitation?.textContent).toContain('JavaScript modules');
    expect(limitation?.textContent).toContain('Three.js or WebGL');
    expect(limitation?.textContent).toContain('canvas or animation');
    expect(limitation?.textContent).toContain('external assets or requests');
    expect(container.querySelector('[data-builder-static-preview="true"] iframe')).toBeNull();
    expect(container.textContent).not.toContain('model.glb');
    expect(container.textContent).not.toContain('src/scene.js');
    expect(container.textContent).not.toMatch(/sha256:|commit_oid|tree_oid|receipt/iu);
  });

  it('keeps compact check state in the toolbar and draft decisions in the composer', async () => {
    const draftReady = await changedDraftSnapshot();
    const activity = await candidateCheckpointActivity();
    const onRejectDraft = vi.fn();
    const onUndoDraft = vi.fn();
    const onSave = vi.fn();
    const container = render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={activity}
        instruction="Update the saved project."
        onRejectDraft={onRejectDraft}
        onSave={onSave}
        onUndoDraft={onUndoDraft}
        snapshot={draftReady}
      />,
    );

    const checks = container.querySelector('[data-builder-check-run-status]');
    const workspaceActions = container.querySelector('[data-builder-workspace-draft-actions="true"]');
    const decision = container.querySelector('[data-builder-composer-version-decision="true"]');
    expect(container.querySelector('[data-builder-review-checkpoint="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-artifact-summary="true"]')).toBeNull();
    expect(checks).toBeNull();
    expect(workspaceActions).toBeNull();
    expect(container.querySelector('[data-builder-review-more="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-undo-draft="true"]')).toBeNull();
    expect(decision).not.toBeNull();
    expect(decision?.closest('[data-builder-chat-main="true"]')).not.toBeNull();
    expect(decision?.closest('[data-builder-workspace-controls="true"]')).toBeNull();
    click(container, '[data-builder-save-version="true"]');
    click(container, '[data-builder-discard-draft="true"]');
    expect(onRejectDraft).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onUndoDraft).not.toHaveBeenCalled();
    expect(container.textContent).not.toMatch(
      /sha256:|commit_oid|tree_oid|receipt|review_id|provider|credential|ipc|schema/iu,
    );
  });

  it('opens and focuses source in the artifact sidebar after choosing a changed file', async () => {
    const draftReady = await changedDraftSnapshot();
    const onSelectFile = vi.fn();
    const addFile = Object.freeze({ path: 'src/add.ts', contentDigest: SIDE_WORKSPACE_ADD_DIGEST });

    function ControlledBuilderPage() {
      const [activeFile, setActiveFile] = useState<string | null>(null);
      return (
        <BuilderPage
          activeFile={activeFile}
          instruction="Update the saved project."
          onSelectFile={(file) => {
            onSelectFile(file);
            setActiveFile(file);
          }}
          sideWorkspaceFileContent={sideWorkspaceFileContent(addFile, 'const added = true;\n')}
          sideWorkspaceFileContentStatus="ready"
          sideWorkspaceFileTree={sideWorkspaceFileTree([addFile])}
          sideWorkspaceFileTreeStatus="ready"
          snapshot={draftReady}
        />
      );
    }

    const container = render(<ControlledBuilderPage />);
    expect(container.querySelector('[data-builder-source-flow="true"]')).toBeNull();

    openWorkspaceChanges(container);
    click(container, '[data-builder-change-card="Added src/add.ts"] button');

    const source = container.querySelector('[data-builder-side-workspace-files="true"]');
    expect(onSelectFile).toHaveBeenCalledExactlyOnceWith('src/add.ts');
    expect(source).not.toBeNull();
    expect(source?.closest('[data-builder-chat-main="true"]')).toBeNull();
    expect(source?.closest('[data-builder-artifact-sidebar="true"]')).not.toBeNull();
    expect(container.querySelector('[data-builder-artifact-sidebar="true"]')?.getAttribute('data-builder-artifact-tab-active'))
      .toBe('source');
    expect(container.querySelector('[data-builder-side-workspace-file-content="src/add.ts"] code')?.textContent)
      .toContain('const added = true;');
  });

  it('shows truncated diff lines with a single omission marker', async () => {
    const longBefore = 'before-'.repeat(50);
    const longAfter = 'after-'.repeat(50);
    const draftReady = await draftSnapshotFromSourceTrees(
      await createSourceTree([{ path: 'index.html', content: `${longBefore}\n` }]),
      await createSourceTree([{ path: 'index.html', content: `${longAfter}\n` }]),
    );
    const container = render(
      <BuilderPage
        activeFile={null}
        instruction="Update the saved project."
        snapshot={draftReady}
      />,
    );

    openWorkspaceChanges(container);
    const diffTexts = [...container.querySelectorAll(
      '[data-builder-change-diff="index.html"] .cf-builder-change-diff-text',
    )].map((node) => node.textContent ?? '');
    expect(diffTexts).toEqual([
      `${longBefore.slice(0, 240)}...`,
      `${longAfter.slice(0, 240)}...`,
    ]);
    expect(diffTexts.join('\n')).not.toContain('... ...');
  });

  it('keeps saved-version history out of the current-state toolbar', async () => {
    const { saved } = await snapshots();
    const container = render(
      <BuilderPage activeFile={null} instruction="" snapshot={saved} />,
    );
    expect(container.querySelector('[data-builder-current-version="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-draft-landing="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-result-flow="true"]')?.closest('[data-builder-draft-landing="true"]') ?? null)
      .toBeNull();
  });

  it('keeps saved versions available from Workspace while a draft is active', async () => {
    const { draftReady } = await snapshots();
    const history = await savedHistory();
    const container = render(
      <BuilderPage
        activeFile={null}
        historySnapshot={history}
        instruction=""
        snapshot={draftReady}
      />,
    );

    expect(container.querySelector('[data-builder-current-version="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).not.toBeNull();
    expect(container.querySelector('[data-builder-artifact-sidebar="true"]')).toBeNull();

    click(container, '[data-builder-workspace-menu-button="true"]');
    expect(container.querySelector('[data-builder-workspace-control-tab="versions"]')).not.toBeNull();
    click(container, '[data-builder-workspace-control-tab="versions"]');

    expect(container.querySelector('[data-builder-version-history="true"]')).not.toBeNull();
    expect(container.querySelector('[data-builder-version-card="Version 1"]')).not.toBeNull();
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).not.toBeNull();
    expect(container.querySelector('[data-builder-version-history-scope="true"]')?.textContent)
      .toBe('Current work is protected automatically. Versions are optional milestones.');
    expect(container.textContent).not.toMatch(
      /sha256:|commit_oid|tree_oid|parent_oid|sqlite|credential|provider|receipt/iu,
    );
  });

  it('shows actionable current-work recovery beside milestone versions without exposing Git evidence', async () => {
    const { draftReady } = await snapshots();
    const history = await savedHistory();
    const activity = await candidateCheckpointActivity();
    const onUndoDraft = vi.fn();
    const container = render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={activity}
        historySnapshot={history}
        instruction=""
        onUndoDraft={onUndoDraft}
        snapshot={draftReady}
      />,
    );

    click(container, '[data-builder-workspace-menu-button="true"]');
    click(container, '[data-builder-workspace-control-tab="versions"]');

    const recovery = container.querySelector('[data-builder-draft-recovery-card="true"]');
    expect(recovery?.textContent).toContain('Automatic recovery');
    expect(recovery?.textContent).toContain('Checkpoint saved. 2 files protected.');
    expect(recovery?.getAttribute('title')).toBeNull();
    const timeline = container.querySelector('[data-builder-checkpoint-timeline="true"]');
    expect(timeline?.textContent).toContain('Checkpoint 2');
    expect(timeline?.textContent).toContain('1 file protected with warnings.');
    expect(timeline?.textContent).toContain('Checkpoint 1');
    expect(timeline?.textContent).not.toContain('Checkpoint 3');
    expect(container.querySelectorAll('[data-builder-checkpoint-sequence]')).toHaveLength(2);
    click(container, '[data-builder-history-undo="true"]');
    expect(onUndoDraft).toHaveBeenCalledOnce();
    expect(container.querySelector('[data-builder-version-card="Version 1"]')).not.toBeNull();
    expect(container.textContent).not.toMatch(
      /sha256:|commit_oid|tree_oid|parent_oid|sqlite|credential|provider|receipt/iu,
    );
  });

  it('exposes automatic recovery in History before the first milestone version is saved', async () => {
    const draftReady = await workingProjectSnapshot(true);
    const activity = await candidateCheckpointActivity();
    const onUndoDraft = vi.fn();
    const container = render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={activity}
        instruction=""
        onUndoDraft={onUndoDraft}
        snapshot={draftReady}
      />,
    );

    click(container, '[data-builder-workspace-menu-button="true"]');
    const historyMenuItem = container.querySelector(
      '[data-builder-workspace-control-tab="versions"]',
    );
    expect(historyMenuItem?.textContent).toContain('History');
    click(container, '[data-builder-workspace-control-tab="versions"]');

    expect(container.querySelector('[data-builder-project-history="true"]')).not.toBeNull();
    expect(container.querySelector('[data-builder-draft-recovery-card="true"]')?.textContent)
      .toContain('Checkpoint saved. 2 files protected.');
    expect(container.textContent).toContain('No milestone versions yet.');
    expect(container.querySelectorAll('[data-builder-version-card]')).toHaveLength(0);
    click(container, '[data-builder-history-undo="true"]');
    expect(onUndoDraft).toHaveBeenCalledOnce();
    expect(container.textContent).not.toMatch(
      /sha256:|commit_oid|tree_oid|parent_oid|sqlite|credential|provider|receipt/iu,
    );
  });

  it('shows read-only saved version history without exposing receipt or Git evidence', async () => {
    const { saved } = await snapshots();
    const history = await savedHistory();
    const onRefreshHistory = vi.fn();
    const container = render(
      <BuilderPage
        activeFile={null}
        historySnapshot={history}
        instruction=""
        onRefreshHistory={onRefreshHistory}
        snapshot={saved}
      />,
    );

    expect(container.querySelector('[data-builder-version-history="true"]')).toBeNull();
    click(container, '[data-builder-workspace-menu-button="true"]');
    click(container, '[data-builder-workspace-control-tab="versions"]');
    expect(container.querySelector('[data-builder-version-history="true"]')).not.toBeNull();
    expect(container.querySelector('[data-builder-version-card="Version 1"]')?.textContent)
      .toContain('Current');
    expect(container.querySelector('[data-builder-version-card="Version 1"]')?.textContent)
      .toContain('Version one');
    expect(container.querySelector('[data-builder-version-history-scope="true"]')?.textContent)
      .toBe('Versions are optional milestones.');
    expect(container.querySelector('[data-builder-version-card="Version 1"] button'))
      .toBeNull();
    expect(container.querySelector('[data-builder-version-card="Version 1"] [data-builder-show-current-version="true"]'))
      .toBeNull();
    click(container, 'button[aria-label="Refresh history"]');
    expect(onRefreshHistory).toHaveBeenCalledOnce();
    expect(container.textContent).not.toMatch(
      /sha256:|commit_oid|tree_oid|parent_oid|sqlite|credential|provider/iu,
    );
  });

  it('opens a saved version as a read-only view and can return to current', async () => {
    const { saved } = await snapshots();
    const inspected = await inspectedHistorySnapshot();
    const historyController = createBuilderProjectHistoryController({
      listHistory: async () => createHistoryWire(PROJECT_ID, 2),
    });
    const history = await historyController.load(PROJECT_ID);
    const onInspectRevision = vi.fn();
    const onRestoreRevisionAsDraft = vi.fn();
    const onShowCurrentRevision = vi.fn();
    const savedContainer = render(
      <BuilderPage
        activeFile={null}
        historySnapshot={history}
        instruction=""
        onInspectRevision={onInspectRevision}
        onRestoreRevisionAsDraft={onRestoreRevisionAsDraft}
        onShowCurrentRevision={onShowCurrentRevision}
        snapshot={saved}
      />,
    );

    click(savedContainer, '[data-builder-workspace-menu-button="true"]');
    click(savedContainer, '[data-builder-workspace-control-tab="versions"]');
    click(savedContainer, '[data-builder-restore-version="Version 1"]');
    expect(onRestoreRevisionAsDraft).toHaveBeenCalledExactlyOnceWith(
      PROJECT_ID,
      history.history?.revisions.find((revision) => revision.revision_number === 1)?.revision_receipt_digest,
    );
    expect(onInspectRevision).not.toHaveBeenCalled();

    click(savedContainer, '[data-builder-view-version="Version 1"]');
    expect(onInspectRevision).toHaveBeenCalledExactlyOnceWith(
      PROJECT_ID,
      history.history?.revisions.find((revision) => revision.revision_number === 1)?.revision_receipt_digest,
    );
    expect(onShowCurrentRevision).not.toHaveBeenCalled();

    const inspectedContainer = render(
      <BuilderPage
        activeFile={null}
        composerContextStatus="ready_to_execute"
        historySnapshot={history}
        instruction="Change it."
        onInspectRevision={onInspectRevision}
        onRestoreRevisionAsDraft={onRestoreRevisionAsDraft}
        onSubmitInstruction={vi.fn()}
        onShowCurrentRevision={onShowCurrentRevision}
        snapshot={inspected}
      />,
    );
    expect(inspectedContainer.querySelector('[data-builder-history-preview="true"]')?.textContent)
      .toContain('Viewing Version 1');
    expect(inspectedContainer.querySelector('[data-builder-composer-status="true"]')).toBeNull();
    expect(inspectedContainer.querySelector<HTMLButtonElement>('[data-builder-submit-turn="true"]')?.disabled)
      .toBe(true);
    expect(inspected.preview?.src_doc).toContain('<main>Earlier</main>');
    expect(inspectedContainer.querySelector('iframe')).toBeNull();
    click(inspectedContainer, '[data-builder-workspace-menu-button="true"]');
    click(inspectedContainer, '[data-builder-workspace-control-tab="preview"]');
    const previewFrame = inspectedContainer.querySelector('iframe');
    expect(previewFrame).not.toBeNull();
    expect(previewFrame?.getAttribute('srcdoc')).toContain('<main>Earlier</main>');
    expect(inspectedContainer.querySelector('[data-builder-artifact-sidebar="true"]')?.getAttribute('data-builder-artifact-tab-active'))
      .toBe('preview');
    click(inspectedContainer, '[data-builder-workspace-menu-button="true"]');
    click(inspectedContainer, '[data-builder-workspace-control-tab="versions"]');
    expect(inspectedContainer.querySelector('[data-builder-version-card="Version 2"]')?.textContent)
      .toContain('Current');
    expect(inspectedContainer.querySelector('[data-builder-version-card="Version 2"] [data-builder-show-current-version="true"]'))
      .toBeNull();
    expect(inspectedContainer.querySelectorAll('[data-builder-show-current-version="true"]'))
      .toHaveLength(1);
    click(inspectedContainer, 'header [data-builder-show-current-version="true"]');
    expect(onShowCurrentRevision).toHaveBeenCalledOnce();
    expect(inspectedContainer.textContent).not.toMatch(
      /sha256:|commit_oid|tree_oid|parent_oid|sqlite|credential|provider/iu,
    );
  });

  it('does not treat a restored activity candidate as an available unsaved draft', async () => {
    const { saved } = await snapshots();
    const activity = await candidateActivity();
    const container = render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={activity}
        instruction=""
        snapshot={saved}
      />,
    );

    const proposal = container.querySelector('[data-builder-activity-card="Draft proposed"]');
    expect(proposal?.textContent).toContain('This older draft is no longer available in Review.');
    expect(proposal?.textContent).not.toContain('A small project.');
    expect(proposal?.querySelector('[data-builder-completion-summary="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-current-version="true"]')).toBeNull();
    expect(container.textContent).not.toContain(DRAFT_ID);
  });

  it('shows rejected draft activity without restoring or exposing internal review data', async () => {
    const { saved } = await snapshots();
    const activity = await candidateActivity(true);
    const container = render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={activity}
        instruction=""
        snapshot={saved}
      />,
    );

    expect(container.querySelector('[data-builder-activity-card="Draft rejected"]')?.textContent)
      .toContain('The draft was discarded and is no longer available for review.');
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
    expect(container.textContent).not.toMatch(
      /builder-generation-draft:|review_id|reviewer_id|reviewed_at_ms|sha256:|commit_oid|tree_oid|provider|credential/iu,
    );
  });

  it('shows saved version activity without restoring or exposing internal review data', async () => {
    const { saved } = await snapshots();
    const activity = await acceptedCandidateActivity();
    const container = render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={activity}
        instruction=""
        snapshot={saved}
      />,
    );

    expect(container.querySelector('[data-builder-activity-card="Version saved"]')?.textContent)
      .toContain('This draft was saved as Version 1.');
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
    expect(container.textContent).not.toMatch(
      /builder-generation-draft:|review_id|reviewer_id|reviewed_at_ms|revision_receipt|sha256:|commit_oid|tree_oid|provider|credential/iu,
    );
  });

  it('shows plan review activity without implying files changed', async () => {
    const { saved } = await snapshots();
    const activity = await planReviewActivity('approved');
    const container = render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={activity}
        instruction=""
        snapshot={saved}
      />,
    );

    const plan = container.querySelector('[data-builder-plan-markdown="true"]');
    expect(plan?.querySelector('[data-builder-plan-review-result="approved"]')?.textContent)
      .toContain('Plan approved');
    expect(plan?.textContent).toContain('Continuing with the approved plan.');
    expect(container.querySelector('[data-builder-activity-card="Plan approved"]')).toBeNull();
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
    expect(container.textContent).not.toMatch(
      /plan_result_digest|review_id|reviewer_id|reviewed_at_ms|builder-generation-draft:|sha256:|commit_oid|tree_oid|provider|credential/iu,
    );
  });

  it('offers plan approval without exposing edit, save, or internal evidence', async () => {
    const { saved } = await snapshots();
    const activity = await pendingPlanActivity();
    const onReviewPlan = vi.fn();
    const container = render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={activity}
        instruction=""
        onReviewPlan={onReviewPlan}
        snapshot={saved}
      />,
    );

    const planCard = container.querySelector('[data-builder-activity-card="Plan proposed"]');
    const planReady = container.querySelector('[data-builder-activity-card="Plan ready"]');
    const planActions = container.querySelector('[data-builder-plan-review-actions="true"]');
    expect(planCard?.getAttribute('data-builder-activity-role')).toBe('assistant');
    expect(
      planCard?.querySelector('[data-builder-message-surface]')
        ?.getAttribute('data-builder-message-surface'),
    ).toBe('plain');
    expect(planCard?.textContent).toContain('Review the proposed plan before files change');
    expect(planCard?.getAttribute('data-builder-plan-markdown')).toBe('true');
    expect(planCard?.querySelector('[data-builder-markdown-variant="plan"] h2')?.textContent)
      .toBe('Review the proposed plan before files change');
    expect(planCard?.querySelectorAll('[data-builder-markdown-variant="plan"] ol > li'))
      .toHaveLength(2);
    expect(planCard?.textContent).toContain('Expected change: The implementation scope is explicit before editing.');
    expect(planCard?.querySelector('[data-builder-completion-summary="true"]')).toBeNull();
    expect(planCard?.textContent).not.toContain('A plan is ready for review.');
    expect(planCard?.textContent).not.toContain('Approve this plan to let the assistant continue.');
    expect(planReady).toBeNull();
    expect(planActions).not.toBeNull();
    expect(planActions?.closest('[data-builder-activity-card="Plan proposed"]')).toBe(planCard);
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
    click(container, '[data-builder-approve-plan="true"]');
    expect(onReviewPlan).toHaveBeenCalledExactlyOnceWith({
      project_id: PROJECT_ID,
      conversation_id: CONVERSATION_ID,
      turn_id: 'builder-turn:123e4567-e89b-42d3-a456-426614174000',
      run_id: 'builder-run:123e4567-e89b-42d3-a456-426614174000',
      decision: 'approved',
    });
    expect(container.textContent).not.toMatch(
      /plan_result_digest|review_id|reviewer_id|reviewed_at_ms|source_tree|commit_oid|tree_oid|provider|credential/iu,
    );
  });

  it('shows project-read approval before plan source context without leaking grant details', async () => {
    const { saved } = await snapshots();
    const onApprovePlanSourceRead = vi.fn();
    const onDismissPlanSourceReadApproval = vi.fn();
    const container = render(
      <BuilderPage
        activeFile={null}
        instruction=""
        onApprovePlanSourceRead={onApprovePlanSourceRead}
        onDismissPlanSourceReadApproval={onDismissPlanSourceReadApproval}
        planSourceReadApproval={{
          project_id: PROJECT_ID,
          instruction: 'Plan the next project update.',
          file_count: 3,
          state: 'pending',
        }}
        snapshot={saved}
      />,
    );

    const approval = container.querySelector('[data-builder-plan-source-read-approval="true"]');
    expect(approval?.textContent).toContain('Allow project reading?');
    expect(approval?.textContent).toContain('3 project files');
    expect(approval?.closest('[data-builder-composer="true"]')).toBeNull();
    click(container, '[data-builder-approve-plan-source-read="true"]');
    expect(onApprovePlanSourceRead).toHaveBeenCalledOnce();
    click(container, '[data-builder-dismiss-plan-source-read="true"]');
    expect(onDismissPlanSourceReadApproval).toHaveBeenCalledOnce();
    expect(container.textContent).not.toMatch(
      /permission_id|resource_id|project:\/|source_tree|commit_oid|tree_oid|provider|credential/iu,
    );
  });

  it('keeps plan review actions single-shot while the decision is recording', async () => {
    const { saved } = await snapshots();
    const activity = await pendingPlanActivity();
    const onReviewPlan = vi.fn();
    const container = render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={activity}
        instruction=""
        onReviewPlan={onReviewPlan}
        planReviewInFlight={{
          project_id: PROJECT_ID,
          conversation_id: CONVERSATION_ID,
          turn_id: TURN_ID,
          run_id: RUN_ID,
        }}
        snapshot={saved}
      />,
    );

    const actions = container.querySelector('[data-builder-plan-review-actions="true"]');
    const approve = container.querySelector<HTMLButtonElement>('[data-builder-approve-plan="true"]');
    const reject = container.querySelector<HTMLButtonElement>('[data-builder-reject-plan="true"]');
    expect(actions?.getAttribute('data-builder-plan-review-state')).toBe('recording');
    expect(actions?.textContent).toContain('Recording your decision...');
    expect(approve?.disabled).toBe(true);
    expect(reject?.disabled).toBe(true);
    click(container, '[data-builder-approve-plan="true"]');
    click(container, '[data-builder-reject-plan="true"]');
    expect(onReviewPlan).not.toHaveBeenCalled();
    expect(container.textContent).not.toMatch(
      /plan_result_digest|review_id|reviewer_id|reviewed_at_ms|source_tree|commit_oid|tree_oid|provider|credential/iu,
    );
  });

  it('keeps plan review retry visible after a decision could not be recorded', async () => {
    const { saved } = await snapshots();
    const activity = await pendingPlanActivity();
    const onReviewPlan = vi.fn();
    const container = render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={activity}
        instruction=""
        onReviewPlan={onReviewPlan}
        planReviewFailure={{
          project_id: PROJECT_ID,
          conversation_id: CONVERSATION_ID,
          turn_id: TURN_ID,
          run_id: RUN_ID,
        }}
        snapshot={saved}
      />,
    );

    const actions = container.querySelector('[data-builder-plan-review-actions="true"]');
    expect(actions?.getAttribute('data-builder-plan-review-state')).toBe('failed');
    expect(actions?.querySelector('[role="alert"]')?.textContent)
      .toContain('That decision could not be recorded. Try again.');
    expect(container.querySelector<HTMLButtonElement>('[data-builder-approve-plan="true"]')?.disabled)
      .toBe(false);
    expect(container.querySelector<HTMLButtonElement>('[data-builder-reject-plan="true"]')?.disabled)
      .toBe(false);
    click(container, '[data-builder-approve-plan="true"]');
    expect(onReviewPlan).toHaveBeenCalledExactlyOnceWith({
      project_id: PROJECT_ID,
      conversation_id: CONVERSATION_ID,
      turn_id: TURN_ID,
      run_id: RUN_ID,
      decision: 'approved',
    });
    expect(container.textContent).not.toMatch(
      /plan_result_digest|review_id|reviewer_id|reviewed_at_ms|source_tree|commit_oid|tree_oid|provider|credential|ipc|schema|receipt/iu,
    );
  });

  it('keeps plan review actions locked after a decision was recorded locally', async () => {
    const { saved } = await snapshots();
    const activity = await pendingPlanActivity();
    const onReviewPlan = vi.fn();
    const container = render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={activity}
        instruction=""
        onReviewPlan={onReviewPlan}
        planReviewRecorded={{
          project_id: PROJECT_ID,
          conversation_id: CONVERSATION_ID,
          turn_id: TURN_ID,
          run_id: RUN_ID,
        }}
        snapshot={saved}
      />,
    );

    const actions = container.querySelector('[data-builder-plan-review-actions="true"]');
    expect(actions?.getAttribute('data-builder-plan-review-state')).toBe('recorded');
    expect(actions?.textContent).toContain('Decision recorded. Updating the conversation...');
    expect(container.querySelector<HTMLButtonElement>('[data-builder-approve-plan="true"]')?.disabled)
      .toBe(true);
    expect(container.querySelector<HTMLButtonElement>('[data-builder-reject-plan="true"]')?.disabled)
      .toBe(true);
    click(container, '[data-builder-approve-plan="true"]');
    click(container, '[data-builder-reject-plan="true"]');
    expect(onReviewPlan).not.toHaveBeenCalled();
    expect(container.textContent).not.toMatch(
      /plan_result_digest|review_id|reviewer_id|reviewed_at_ms|source_tree|commit_oid|tree_oid|provider|credential|ipc|schema|receipt/iu,
    );
  });

  it('shows a selected source file in the artifact sidebar', async () => {
    const { draftReady } = await snapshots();
    const onSelectFile = vi.fn();
    const toolFile = Object.freeze({ path: 'src/tool.py', contentDigest: SIDE_WORKSPACE_TOOL_DIGEST });
    const container = render(
      <BuilderPage
        activeFile="src/tool.py"
        instruction=""
        onSelectFile={onSelectFile}
        sideWorkspaceFileContent={sideWorkspaceFileContent(toolFile, 'print("hello")\nprint("bye")\n', 'python')}
        sideWorkspaceFileContentStatus="ready"
        sideWorkspaceFileTree={sideWorkspaceFileTree([toolFile])}
        sideWorkspaceFileTreeStatus="ready"
        snapshot={draftReady}
      />,
    );
    expect(container.querySelector('[data-builder-artifact-sidebar="true"]')).toBeNull();
    click(container, '[data-builder-workspace-menu-button="true"]');
    click(container, '[data-builder-workspace-control-tab="source"]');
    expect(container.textContent).toContain('src/tool.py');
    expect(container.querySelector('#builder-tool-tab-code')).toBeNull();
    expect(container.querySelector('[data-builder-code-flow="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-source-flow="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-side-workspace-files="true"]')).not.toBeNull();
    expect(container.querySelector('[data-builder-side-workspace-files="true"]')?.closest('[data-builder-chat-main="true"]'))
      .toBeNull();
    expect(container.querySelector('[data-builder-side-workspace-files="true"]')?.closest('[data-builder-artifact-sidebar="true"]'))
      .not.toBeNull();
    expect(container.querySelector('[data-builder-artifact-sidebar="true"]')?.getAttribute('data-builder-artifact-tab-active'))
      .toBe('source');
    expect(container.querySelector('[data-builder-side-workspace-file-entry="src/tool.py"]')?.getAttribute('data-active'))
      .toBe('true');
    expect(container.querySelector('[data-builder-side-workspace-file-path="true"]')?.textContent)
      .toBe('/src/tool.py');
    expect(container.querySelector('[data-builder-side-workspace-code-viewer="true"]')).not.toBeNull();
    expect(container.querySelector('[data-builder-side-workspace-code-line="1"]')?.textContent)
      .toContain('print("hello")');
    expect(container.querySelector('[data-builder-side-workspace-code-line="2"]')?.textContent)
      .toContain('print("bye")');
    expect(container.querySelector('[data-builder-side-workspace-file-content="src/tool.py"] code')?.textContent)
      .toContain('print("hello")');
    expect(container.textContent).not.toContain('app.js');
  });

  it('shows a bounded command approval and forwards only explicit one-shot decisions', async () => {
    const { saved } = await snapshots();
    const commandSourceDigest = await digest('command-source');
    const onDecideCommandApproval = vi.fn();
    const container = render(
      <BuilderPage
        activeFile={null}
        commandApproval={{
          request: {
            request_version: 'builder-controlled-command-approval-request.v1',
            approval_request_id:
              'builder-controlled-command-approval-request:123e4567-e89b-42d3-a456-426614174000',
            project_id: PROJECT_ID,
            conversation_id: CONVERSATION_ID,
            turn_id: TURN_ID,
            task_id: TASK_ID,
            run_id: RUN_ID,
            command_profile_id: `builder-command-profile:${'a'.repeat(32)}`,
            command_kind: 'test',
            command_display: 'npm test',
            description: 'Verify the current project before finishing.',
            source_tree_digest: commandSourceDigest,
            requested_at_ms: 1_000,
            expires_at_ms: 301_000,
            risk_notice: 'This project script may modify files or use the network.',
            decisions: ['allow_once', 'deny'],
          },
          state: 'pending',
        }}
        instruction=""
        onDecideCommandApproval={onDecideCommandApproval}
        snapshot={saved}
      />,
    );

    const approval = container.querySelector('[data-builder-command-approval="true"]');
    expect(approval?.textContent).toContain('允许运行这条命令？');
    expect(approval?.textContent).toContain('npm test');
    expect(approval?.textContent).toContain('此项目脚本可能修改文件或访问网络');
    expect(approval?.textContent).toContain('授权仅对本次命令有效');
    expect(approval?.closest('[data-builder-composer="true"]')).toBeNull();
    click(container, '[data-builder-deny-command="true"]');
    click(container, '[data-builder-allow-command-once="true"]');
    expect(onDecideCommandApproval).toHaveBeenNthCalledWith(1, 'deny');
    expect(onDecideCommandApproval).toHaveBeenNthCalledWith(2, 'allow_once');
    expect(container.textContent).not.toContain('source_tree_digest');
    expect(container.textContent).not.toContain('approval_request_id');
  });

  it('keeps approved-plan continuation instructions out of the visible user timeline', async () => {
    const { saved } = await snapshots();
    const wire = createPlanReviewTaskStreamWire('approved');
    const continuationTurnId = 'builder-turn:123e4567-e89b-42d3-a456-426614174110';
    const continuationRunId = 'builder-run:123e4567-e89b-42d3-a456-426614174111';
    const continuationTaskId = 'builder-task:123e4567-e89b-42d3-a456-426614174112';
    const controller = createBuilderConversationController(taskStreamPort(async () => ({
      ...wire,
      conversation: {
        ...wire.conversation,
        head_sequence: 9,
        recorded_active_turn_id: continuationTurnId,
        window: {
          ...wire.conversation.window,
          last_sequence: 9,
        },
        items: [
          ...wire.conversation.items,
          {
            item_kind: 'user_message' as const,
            sequence: 6,
            turn_id: continuationTurnId,
            message: {
              message_id: 'builder-message:123e4567-e89b-42d3-a456-426614174113',
              text: 'Implement the approved plan.',
            },
            message_kind: 'submitted' as const,
            mode: 'work' as const,
            task: {
              task_id: continuationTaskId,
              title: 'Apply approved plan',
            },
          },
          {
            item_kind: 'run_started' as const,
            sequence: 7,
            turn_id: continuationTurnId,
            run_id: continuationRunId,
            task_id: continuationTaskId,
            attempt_number: 1,
            retry_of_run_id: null,
            recorded_state: 'started' as const,
          },
          {
            item_kind: 'run_context_snapshot_recorded' as const,
            sequence: 8,
            turn_id: continuationTurnId,
            run_id: continuationRunId,
            task_id: continuationTaskId,
            context: {
              recorded_state: 'recorded' as const,
              route: 'build' as const,
              dispatch: 'build' as const,
              downgraded_from: null,
              downgrade_reason: null,
              brief: 'available' as const,
              base: 'project_revision' as const,
              permission_result: 'allowed' as const,
              command_execution: 'not_included' as const,
              network_access: 'not_included' as const,
            },
          },
          {
            item_kind: 'programming_run_admitted' as const,
            sequence: 9,
            turn_id: continuationTurnId,
            run_id: continuationRunId,
            task_id: continuationTaskId,
            recorded_state: 'admitted' as const,
          },
        ],
      },
    })));
    const activity = await controller.load(PROJECT_ID, TASK_ADDRESS_ID);
    const container = render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={activity}
        instruction=""
        snapshot={saved}
      />,
    );

    expect(activity.status).toBe('ready');
    expect(container.textContent).not.toContain('Implement the approved plan.');
    expect(container.querySelectorAll('[data-builder-activity-role="user"]')).toHaveLength(1);
  });

  it('keeps source files accessible from the artifact sidebar when a project has no static preview', async () => {
    const toolFile = Object.freeze({ path: 'src/tool.py', contentDigest: SIDE_WORKSPACE_TOOL_DIGEST });
    const draftReady = await draftSnapshotFromSourceTrees(
      await createSourceTree([{ path: 'src/tool.py', content: 'print("old")\n' }]),
      await createSourceTree([{ path: 'src/tool.py', content: 'print("new")\n' }]),
    );
    const container = render(
      <BuilderPage
        activeFile={null}
        instruction="Update the script."
        sideWorkspaceFileContent={sideWorkspaceFileContent(toolFile, 'print("new")\n', 'python')}
        sideWorkspaceFileContentStatus="ready"
        sideWorkspaceFileTree={sideWorkspaceFileTree([toolFile])}
        sideWorkspaceFileTreeStatus="ready"
        snapshot={draftReady}
      />,
    );

    expect(container.querySelector('[data-builder-artifact-sidebar="true"]')).toBeNull();
    click(container, '[data-builder-workspace-menu-button="true"]');
    click(container, '[data-builder-workspace-control-tab="preview"]');
    expect(container.querySelector('[data-builder-code-flow="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-result-flow="true"]')).not.toBeNull();
    expect(container.querySelector('[data-builder-preview-unavailable="true"]')?.textContent)
      .toContain('Preview unavailable');
    expect(container.querySelector('[data-builder-preview-unavailable="true"]')?.textContent)
      .toContain('files were generated');
    expect(container.querySelector('[data-builder-preview-unavailable="true"]')?.textContent)
      .toContain('live preview support');
    expect(container.querySelector('[data-builder-review-checkpoint="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-artifact-summary="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-artifact-sidebar="true"]')?.getAttribute('data-builder-artifact-tab-active'))
      .toBe('preview');
    expect(container.querySelector('details[data-builder-source-flow="true"]')).toBeNull();
    click(container, '[data-builder-workspace-menu-button="true"]');
    click(container, '[data-builder-workspace-control-tab="source"]');
    const source = container.querySelector<HTMLElement>('[data-builder-side-workspace-files="true"]');
    expect(source).not.toBeNull();
    expect(source?.closest('[data-builder-chat-main="true"]')).toBeNull();
    expect(source?.closest('[data-builder-artifact-sidebar="true"]')).not.toBeNull();
    expect(source?.textContent).toContain('Current draft · 1');
    expect(source?.textContent).toContain('src/tool.py');
    expect(container.querySelector('[data-builder-side-workspace-code-viewer="true"]')).not.toBeNull();
    expect(container.querySelector('[data-builder-side-workspace-file-content="src/tool.py"] code')?.textContent)
      .toContain('print("new")');
    expect(source?.textContent).not.toContain('Preview unavailable');
    expect(source?.textContent).not.toContain('Three.js');
    expect(source?.textContent).not.toContain('This project has files, but no visual preview.');
    expect(container.querySelector('[data-builder-live-preview-panel="true"]')?.hasAttribute('hidden'))
      .toBe(true);

    expect(container.querySelector('[data-builder-artifact-sidebar="true"]')?.getAttribute('data-builder-artifact-tab-active'))
      .toBe('source');
  });

  it('keeps the provider-settings recovery action limited to configuration failures', async () => {
    const { fresh } = await snapshots();
    const controller = createBuilderProjectController({
      generator: {
        submit: async () => {
          const error = Object.assign(new Error(), {
            code: 'builder_generation_provider_unavailable',
          });
          throw error;
        },
        generate: async () => {
          const error = Object.assign(new Error(), {
            code: 'builder_generation_provider_unavailable',
          });
          throw error;
        },
        continueDraft: async () => {
          const error = Object.assign(new Error(), {
            code: 'builder_generation_provider_unavailable',
          });
          throw error;
        },
        generateApprovedPlan: async () => null,
        proposePlan: async () => null,
        preparePlanSourceReadApproval: async () => PLAN_SOURCE_READ_READY,
        approvePlanSourceRead: async () => PLAN_SOURCE_READ_APPROVED,
        prepareCurrentProjectWriteApproval: async () => ({
          result_version: 'builder-current-project-write-approval-status.v1',
          project_id: PROJECT_ID,
          state: 'ready',
          approval_scope: 'current_project_write',
          authority: 'main_selected_project_project_edit_v1',
        }),
        approveCurrentProjectWrite: async () => ({
          result_version: 'builder-current-project-write-approval-result.v1',
          project_id: PROJECT_ID,
          operation: 'already_approved',
          approval_scope: 'current_project_write',
          authority: 'main_selected_project_project_edit_v1',
        }),
        retry: async () => null,
        answer: async () => null,
        answerDraft: async () => null,
        restoreDraft: async () => null,
        restoreRevisionAsDraft: async () => null,
        rejectDraft: async () => null,
        cancel: async () => null,
        steer: async () => null,
        queueFollowup: async () => null,
      },
      workspace: {
        open: async () => null,
        openLocation: openProjectLocationSelection,
        createLocalProject: createLocalProjectSelectionCancelled,
        saveDraft: async () => null,
        loadCurrent: async () => null,
        loadRevision: async () => null,
        listCurrent: async () => null,
        listWorkspaces: async () => null,
        listHistory: async () => null,
      },
    });
    void fresh;
    const failed = await controller.generate('Make a timer.');
    const container = render(
      <BuilderPage
        activeFile={null}
        instruction="Make a timer."
        onOpenSettings={vi.fn()}
        snapshot={failed}
      />,
    );
    expect(container.textContent).not.toContain('Check AI settings');
    expect(JSON.stringify(failed)).not.toContain(DRAFT_ID);
  });

  it('labels an unknown Save outcome without claiming the draft is lost', async () => {
    const readWire = await createReadWire();
    let initialOpen = true;
    const controller = createBuilderProjectController({
      generator: {
        submit: async (request) => createGenerationDraft(request),
        generate: async (request) => createGenerationDraft(request),
        continueDraft: async (request) => createGenerationDraft(
          await createBuilderGenerationRequest(request.instruction, PROJECT_ID),
        ),
        generateApprovedPlan: async () => null,
        proposePlan: async () => null,
        preparePlanSourceReadApproval: async () => PLAN_SOURCE_READ_READY,
        approvePlanSourceRead: async () => PLAN_SOURCE_READ_APPROVED,
        prepareCurrentProjectWriteApproval: async () => ({
          result_version: 'builder-current-project-write-approval-status.v1',
          project_id: PROJECT_ID,
          state: 'ready',
          approval_scope: 'current_project_write',
          authority: 'main_selected_project_project_edit_v1',
        }),
        approveCurrentProjectWrite: async () => ({
          result_version: 'builder-current-project-write-approval-result.v1',
          project_id: PROJECT_ID,
          operation: 'already_approved',
          approval_scope: 'current_project_write',
          authority: 'main_selected_project_project_edit_v1',
        }),
        retry: async (request) => createGenerationDraft(request),
        answer: async () => null,
        answerDraft: async () => null,
        restoreDraft: async () => null,
        restoreRevisionAsDraft: async () => null,
        rejectDraft: async () => null,
        cancel: async () => null,
        steer: async () => null,
        queueFollowup: async () => null,
      },
      workspace: {
        open: async (request) => {
          if (request.project_id === PROJECT_ID && initialOpen) {
            initialOpen = false;
            return readWire;
          }
          if (request.project_id === null) return null;
          throw new Error('unavailable');
        },
        openLocation: openProjectLocationSelection,
        createLocalProject: createLocalProjectSelectionCancelled,
        saveDraft: async () => {
          throw new Error('response lost');
        },
        loadCurrent: async () => {
          throw new Error('unavailable');
        },
        loadRevision: async () => null,
        listCurrent: async () => ({ projects: [] }),
        listWorkspaces: async () => ({ workspaces: [] }),
        listHistory: async () => ({ revisions: [] }),
      },
    });
    await controller.open(PROJECT_ID);
    await controller.generate('Make a timer.');
    const unknown = await controller.save();
    const container = render(
      <BuilderPage
        activeFile={null}
        instruction=""
        onSave={vi.fn()}
        snapshot={unknown}
      />,
    );
    expect(container.textContent).toContain('The save result could not be confirmed.');
    const decision = container.querySelector('[data-builder-composer-version-decision="true"]');
    expect(decision?.textContent).toContain('Try Save again');
    const notice = container.querySelector('[data-builder-conversation-notice="save_unknown"]');
    expect(notice).not.toBeNull();
    expect(notice?.closest('[data-builder-chat-main="true"]')).not.toBeNull();
    expect(notice?.closest('[data-builder-composer="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).not.toBeNull();
  });
});
