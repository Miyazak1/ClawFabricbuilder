// @vitest-environment jsdom
import { act, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createBuilderProjectController } from '../application/builderProjectController';
import { createBuilderConversationController } from '../application/builderConversationController';
import { createBuilderProjectHistoryController } from '../application/builderProjectHistoryController';
import { createBuilderProjectCatalogController } from '../application/builderProjectCatalogController';
import {
  BuilderGenerationDiagnosticError,
  type BuilderSideWorkspaceFileAuthority,
  type BuilderSideWorkspaceFileContentProjection,
  type BuilderSideWorkspaceFileRef,
  type BuilderSideWorkspaceFileTreeProjection,
} from '../application/builderPorts';
import { BuilderPage } from './BuilderPage';
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

const SIDE_WORKSPACE_SOURCE_TREE_DIGEST = `sha256:${'a'.repeat(64)}`;
const SIDE_WORKSPACE_APP_DIGEST = `sha256:${'b'.repeat(64)}`;
const SIDE_WORKSPACE_STYLE_DIGEST = `sha256:${'c'.repeat(64)}`;
const SIDE_WORKSPACE_ADD_DIGEST = `sha256:${'d'.repeat(64)}`;
const SIDE_WORKSPACE_TOOL_DIGEST = `sha256:${'e'.repeat(64)}`;

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

function sideWorkspaceFileRef(path: string, contentDigest: string): BuilderSideWorkspaceFileRef {
  return Object.freeze({
    file_ref_version: 'builder-side-workspace-file-ref.v1',
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
      file_ref: sideWorkspaceFileRef(file.path, file.contentDigest),
    })),
  ];
  return Object.freeze({
    projection_version: 'builder-side-workspace-file-tree.v1',
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    source_kind: 'current_draft',
    root_label: 'Current draft',
    source_tree_digest: SIDE_WORKSPACE_SOURCE_TREE_DIGEST,
    entries: Object.freeze(entries),
    selected_file_ref: files[0] === undefined ? null : sideWorkspaceFileRef(files[0].path, files[0].contentDigest),
    source_ref: Object.freeze({ source_ref_kind: 'current_draft_checkpoint_candidate' }),
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
): BuilderSideWorkspaceFileContentProjection {
  return Object.freeze({
    projection_version: 'builder-side-workspace-file-content.v1',
    project_id: PROJECT_ID,
    conversation_id: CONVERSATION_ID,
    source_kind: 'current_draft',
    source_tree_digest: SIDE_WORKSPACE_SOURCE_TREE_DIGEST,
    file_ref: sideWorkspaceFileRef(file.path, file.contentDigest),
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

async function workingProjectSnapshot() {
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
  return controller.createLocalProject('Unsaved dashboard');
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
  return controller.load(PROJECT_ID);
}

async function candidateCheckpointActivity() {
  const wire = createTaskStreamWire();
  const controller = createBuilderConversationController(taskStreamPort(async () => ({
    ...wire,
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
    review_state_projection: readyReviewStateProjection(),
  })));
  return controller.load(PROJECT_ID);
}

async function candidateBlockedReviewActivity() {
  const controller = createBuilderConversationController(taskStreamPort(async () => ({
    ...createTaskStreamWire(),
    review_state_projection: blockedReviewStateProjection(),
  })));
  return controller.load(PROJECT_ID);
}

async function candidateFailedCheckActivity() {
  const controller = createBuilderConversationController(taskStreamPort(async () => ({
    ...createTaskStreamWire(),
    review_state_projection: failedCheckReviewStateProjection(),
  })));
  return controller.load(PROJECT_ID);
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
  return controller.load(PROJECT_ID);
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
  return controller.load(PROJECT_ID);
}

function loadingActivity() {
  const controller = createBuilderConversationController(taskStreamPort(
    async () => new Promise(() => undefined),
  ));
  void controller.load(PROJECT_ID);
  return controller.getSnapshot();
}

async function unavailableActivity() {
  const controller = createBuilderConversationController(taskStreamPort(
    async () => {
      throw new Error('private');
    },
  ));
  return controller.load(PROJECT_ID);
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
  await controller.load(PROJECT_ID);
  fail = true;
  return controller.refresh();
}

async function answerActivity() {
  const controller = createBuilderConversationController(taskStreamPort(async () => createAnswerTaskStreamWire()));
  return controller.load(PROJECT_ID);
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
  return controller.load(PROJECT_ID);
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
  return controller.load(PROJECT_ID);
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
  return controller.load(PROJECT_ID);
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
  return controller.load(PROJECT_ID);
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
  return controller.load(PROJECT_ID);
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
  return controller.load(PROJECT_ID);
}

async function failedRunActivity() {
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
      head_sequence: 7,
      recorded_active_turn_id: null,
      window: {
        first_sequence: 1,
        last_sequence: 7,
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
        {
          item_kind: 'run_completed',
          sequence: 6,
          turn_id: TURN_ID,
          run_id: RUN_ID,
          terminal_status: 'failed',
          result_kind: 'failure',
          failure_phase: 'provider_response_received',
          assistant_message: {
            message_id: 'builder-message:223e4567-e89b-42d3-a456-426614174000',
            text: 'The draft could not be prepared for review.',
          },
          candidate: null,
        },
        {
          item_kind: 'turn_completed',
          sequence: 7,
          turn_id: TURN_ID,
          run_id: RUN_ID,
          outcome: 'failed',
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
  return controller.load(PROJECT_ID);
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
  await controller.load(PROJECT_ID);
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
  const controller = createBuilderConversationController(taskStreamPort(async () => ({
    stream_version: 'builder-task-stream-read-result.v1',
    project_id: PROJECT_ID,
    conversation: {
      conversation_id: CONVERSATION_ID,
      created_at_ms: 1234,
      head_sequence: 7,
      recorded_active_turn_id: null,
      window: {
        first_sequence: 1,
        last_sequence: 7,
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
        {
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
          },
        },
        {
          item_kind: 'turn_completed',
          sequence: 7,
          turn_id: TURN_ID,
          run_id: RUN_ID,
          outcome: 'candidate_ready',
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
  return controller.load(PROJECT_ID);
}

async function pendingToolActivity() {
  const controller = createBuilderConversationController(taskStreamPort(async () => ({
    stream_version: 'builder-task-stream-read-result.v1',
    project_id: PROJECT_ID,
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
  return controller.load(PROJECT_ID);
}

async function acceptedCandidateActivity() {
  const controller = createBuilderConversationController(taskStreamPort(async () => createAcceptedTaskStreamWire(1)));
  return controller.load(PROJECT_ID);
}

async function planReviewActivity(decision: 'approved' | 'rejected' = 'approved') {
  const controller = createBuilderConversationController(taskStreamPort(
    async () => createPlanReviewTaskStreamWire(decision),
  ));
  return controller.load(PROJECT_ID);
}

async function pendingPlanActivity() {
  const controller = createBuilderConversationController(taskStreamPort(async () => createPlanTaskStreamWire()));
  return controller.load(PROJECT_ID);
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
    expect(container.querySelector('[data-builder-workspace-chip="true"]')?.closest('[data-builder-composer-context-bar="true"]'))
      .not.toBeNull();
    expect(container.querySelector('[data-builder-workspace-chip="true"]')?.closest('.cf-builder-composer-footer'))
      .toBeNull();
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

  it('shows a composer project picker with saved projects and New project', async () => {
    const { fresh } = await snapshots();
    const onCreateProject = vi.fn();
    const onOpenProject = vi.fn();
    const container = render(
      <BuilderPage
        activeFile={null}
        instruction="Make a timer."
        onCreateProject={onCreateProject}
        onOpenProject={onOpenProject}
        projectCatalogSnapshot={await trustedCatalogSnapshot()}
        snapshot={fresh}
      />,
    );

    expect(container.querySelector('[data-builder-workspace-chip="true"]')?.textContent)
      .toContain('Choose project');
    expect(container.querySelector('[data-builder-workspace-chip="true"]')?.textContent)
      .toContain('Chat only until you choose a folder');
    expect(container.querySelector('[data-builder-workspace-chip="true"]')?.closest('[data-builder-composer-context-bar="true"]'))
      .not.toBeNull();
    expect(container.querySelector('[data-builder-workspace-picker="true"]')).toBeNull();

    click(container, '[data-builder-workspace-chip="true"]');

    const picker = container.querySelector('[data-builder-workspace-picker="true"]');
    expect(picker).not.toBeNull();
    expect(picker?.querySelector('[data-builder-workspace-section="saved"]')?.textContent)
      .toContain('Saved projects');
    expect(picker?.textContent).toContain('Saved dashboard');
    expect(picker?.textContent).toContain('New project');
    expect(picker?.querySelector('[data-builder-workspace-search="true"]')).not.toBeNull();

    click(container, `[data-builder-workspace-project="${PROJECT_ID}"]`);

    expect(onOpenProject).toHaveBeenCalledExactlyOnceWith(PROJECT_ID);
    expect(onCreateProject).not.toHaveBeenCalled();
    expect(container.querySelector('[data-builder-workspace-picker="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-workspace-dismissed-build-note="true"]')).toBeNull();
  });

  it('passes current workspace clearing through the composer context bar', async () => {
    const { saved } = await snapshots();
    const onClearWorkspaceSelection = vi.fn();
    const container = render(
      <BuilderPage
        activeFile={null}
        instruction="Keep discussing."
        onClearWorkspaceSelection={onClearWorkspaceSelection}
        snapshot={saved}
      />,
    );

    const clear = container.querySelector('[data-builder-clear-workspace-selection="true"]');
    expect(clear).not.toBeNull();
    expect(clear?.closest('[data-builder-composer-context-bar="true"]')).not.toBeNull();

    click(container, '[data-builder-clear-workspace-selection="true"]');

    expect(onClearWorkspaceSelection).toHaveBeenCalledOnce();
  });

  it('keeps the current source folder visible in the project picker before first save', async () => {
    const working = await workingProjectSnapshot();
    const onCreateProject = vi.fn();
    const onOpenProject = vi.fn();
    const container = render(
      <BuilderPage
        activeFile={null}
        instruction="Make a timer."
        onCreateProject={onCreateProject}
        onOpenProject={onOpenProject}
        projectCatalogSnapshot={await trustedCatalogSnapshot('empty')}
        snapshot={working}
      />,
    );

    expect(container.querySelector('[data-builder-workspace-chip="true"]')?.textContent)
      .toContain('Unsaved dashboard');
    expect(container.querySelector('[data-builder-workspace-chip="true"]')?.textContent)
      .toContain('site-source');
    const workspace = container.querySelector('[data-builder-chat-workspace="true"]');
    expect(workspace?.getAttribute('data-builder-artifact-sidebar-visible')).toBe('false');
    expect(container.querySelector('[data-builder-artifact-sidebar="true"]')).toBeNull();

    click(container, '[data-builder-workspace-menu-button="true"]');
    expect(container.querySelector('[data-builder-workspace-control-tab="permissions"]')).not.toBeNull();
    expect(container.querySelector('[data-builder-artifact-permissions="true"]')).toBeNull();
    click(container, '[data-builder-workspace-control-tab="permissions"]');
    expect(container.querySelector('[data-builder-artifact-sidebar="true"]')?.getAttribute('data-builder-artifact-tab-active'))
      .toBe('permissions');
    expect(container.querySelector('[data-builder-artifact-permissions="true"]')?.textContent)
      .toContain('Unsaved dashboard');
    expect(workspace?.getAttribute('data-builder-artifact-sidebar-visible')).toBe('true');

    click(container, '[data-builder-workspace-chip="true"]');

    const picker = container.querySelector('[data-builder-workspace-picker="true"]');
    expect(picker).not.toBeNull();
    expect(picker?.querySelector('[data-builder-workspace-section="current"]')?.textContent)
      .toContain('Current project');
    expect(picker?.querySelector('[data-builder-workspace-current-project="true"]')?.textContent)
      .toContain('Draft workspace - Source folder: site-source');
    expect(picker?.textContent).not.toContain('No saved projects yet.');
    expect(picker?.textContent).toContain('New project');
    expect(onOpenProject).not.toHaveBeenCalled();
    expect(onCreateProject).not.toHaveBeenCalled();
  });

  it('shows restart-restored bound workspaces in the composer project picker before first save', async () => {
    const { fresh } = await snapshots();
    const onCreateProject = vi.fn();
    const onOpenProject = vi.fn();
    const workspaceOnlyProjectId = 'builder-project:22222222-2222-4222-8222-222222222222';
    const container = render(
      <BuilderPage
        activeFile={null}
        instruction="Make a timer."
        onCreateProject={onCreateProject}
        onOpenProject={onOpenProject}
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

    click(container, '[data-builder-workspace-chip="true"]');

    const picker = container.querySelector('[data-builder-workspace-picker="true"]');
    expect(picker?.querySelector('[data-builder-workspace-section="in-progress"]')?.textContent)
      .toContain('In progress');
    expect(picker?.textContent).toContain('Unsaved dashboard');
    expect(picker?.textContent).toContain('Draft workspace - Source folder: site-source');
    expect(picker?.textContent).not.toContain('No projects yet.');

    click(container, `[data-builder-workspace-bound-project="${workspaceOnlyProjectId}"]`);

    expect(onOpenProject).toHaveBeenCalledExactlyOnceWith(workspaceOnlyProjectId);
    expect(onCreateProject).not.toHaveBeenCalled();
  });

  it('keeps New project available when search has no matching project', async () => {
    const { fresh } = await snapshots();
    const onCreateProject = vi.fn();
    const container = render(
      <BuilderPage
        activeFile={null}
        instruction="Make a timer."
        onCreateProject={onCreateProject}
        projectCatalogSnapshot={await trustedCatalogSnapshot()}
        snapshot={fresh}
      />,
    );

    click(container, '[data-builder-workspace-chip="true"]');
    changeInput(container, '[data-builder-workspace-search="true"]', 'no matching project');

    const picker = container.querySelector('[data-builder-workspace-picker="true"]');
    expect(picker?.textContent).toContain('No matching projects.');
    expect(picker?.textContent).toContain('New project');
    expect(picker?.textContent).not.toContain('Saved dashboard');

    click(container, '[data-builder-workspace-new-project="true"]');

    expect(container.querySelector('[data-builder-new-project-panel="true"]')).not.toBeNull();
    expect(onCreateProject).not.toHaveBeenCalled();
  });

  it('opens the composer project picker when build needs a workspace', async () => {
    const { fresh } = await snapshots();
    const onCreateProject = vi.fn();
    const container = render(
      <BuilderPage
        activeFile={null}
        instruction="Make a timer."
        onCreateProject={onCreateProject}
        projectCatalogSnapshot={await trustedCatalogSnapshot('empty')}
        snapshot={fresh}
        workspacePickerRequest={1}
      />,
    );

    const picker = container.querySelector('[data-builder-workspace-picker="true"]');
    expect(picker).not.toBeNull();
    expect(picker?.textContent).toContain('Choose or create a project before I build.');
    expect(picker?.textContent).toContain('Add a source folder so Builder knows where it can work.');
    expect(picker?.textContent).toContain('No projects yet.');

    click(container, '[data-builder-workspace-new-project="true"]');

    const newProjectPanel = container.querySelector('[data-builder-new-project-panel="true"]');
    expect(newProjectPanel).not.toBeNull();
    expect(newProjectPanel?.textContent).toContain('Project name');
    expect(newProjectPanel?.textContent).toContain('Source folders');
    expect(newProjectPanel?.textContent).toContain('No source folder selected.');
    expect(newProjectPanel?.textContent)
      .toContain('Choose an empty local folder that Builder can read and edit for this project.');
    const title = container.querySelector<HTMLInputElement>('[data-builder-new-project-title="true"]');
    expect(title?.value).toBe('New project');

    click(container, '[data-builder-add-source-folder="true"]');

    expect(onCreateProject).toHaveBeenCalledExactlyOnceWith('New project');
    expect(container.querySelector('[data-builder-workspace-picker="true"]')).toBeNull();
  });

  it('opens the source-folder new project panel from an external project command', async () => {
    const { fresh } = await snapshots();
    const onCreateProject = vi.fn();
    const container = render(
      <BuilderPage
        activeFile={null}
        instruction=""
        onCreateProject={onCreateProject}
        projectCatalogSnapshot={await trustedCatalogSnapshot('empty')}
        snapshot={fresh}
        workspaceNewProjectRequest={1}
      />,
    );

    const panel = container.querySelector('[data-builder-new-project-panel="true"]');
    expect(panel).not.toBeNull();
    expect(panel?.textContent).toContain('Project name');
    expect(panel?.textContent).toContain('Source folders');
    expect(panel?.textContent).not.toContain('Choose or create a project before I build.');
    expect(onCreateProject).not.toHaveBeenCalled();

    click(container, '[data-builder-add-source-folder="true"]');

    expect(onCreateProject).toHaveBeenCalledExactlyOnceWith('New project');
  });

  it('explains a dismissed build workspace picker without sending work', async () => {
    const { fresh } = await snapshots();
    const onCreateProject = vi.fn();
    const onDismissWorkspacePicker = vi.fn();
    const onInstructionChange = vi.fn();
    const container = render(
      <BuilderPage
        activeFile={null}
        instruction="Make a timer."
        onCreateProject={onCreateProject}
        onDismissWorkspacePicker={onDismissWorkspacePicker}
        onInstructionChange={onInstructionChange}
        projectCatalogSnapshot={await trustedCatalogSnapshot('empty')}
        snapshot={fresh}
        workspacePickerRequest={1}
      />,
    );

    expect(container.querySelector('[data-builder-workspace-picker="true"]')).not.toBeNull();
    click(container, '[data-builder-workspace-chip="true"]');

    expect(container.querySelector('[data-builder-workspace-picker="true"]')).toBeNull();
    const note = container.querySelector('[data-builder-workspace-dismissed-build-note="true"]');
    expect(note?.textContent).toContain("Choose a project folder when you're ready to build.");
    expect(note?.textContent).toContain('Your text is still here.');
    expect(onDismissWorkspacePicker).toHaveBeenCalledOnce();
    expect(onCreateProject).not.toHaveBeenCalled();

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

  it('does not show the dismissed build note after choosing an existing project', async () => {
    const { fresh } = await snapshots();
    const onDismissWorkspacePicker = vi.fn();
    const onOpenProject = vi.fn();
    const container = render(
      <BuilderPage
        activeFile={null}
        instruction="Make a timer."
        onDismissWorkspacePicker={onDismissWorkspacePicker}
        onOpenProject={onOpenProject}
        projectCatalogSnapshot={await trustedCatalogSnapshot()}
        snapshot={fresh}
        workspacePickerRequest={1}
      />,
    );

    expect(container.querySelector('[data-builder-workspace-picker="true"]')?.textContent)
      .toContain('Choose or create a project before I build.');
    click(container, `[data-builder-workspace-project="${PROJECT_ID}"]`);

    expect(onOpenProject).toHaveBeenCalledExactlyOnceWith(PROJECT_ID);
    expect(onDismissWorkspacePicker).toHaveBeenCalledOnce();
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
    expect(workingContainer.querySelector('[data-builder-workspace-chip="true"]')?.textContent)
      .toContain('Source folder:');
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

  it('shows an unsaved draft and requires the explicit Save version command', async () => {
    const { draftReady } = await snapshots();
    const activity = await candidateProgressActivity();
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

    expect(container.querySelector('[data-builder-unsaved-draft="true"]')?.textContent)
      .toContain('Unsaved draft');
    expect(container.querySelector('[data-builder-current-version="true"]')?.textContent)
      .toContain('Version 1');
    expect(container.querySelector('[data-builder-composer-review-gate="true"]')?.textContent)
      .toContain('Keep revising here');
    expect(container.textContent).toContain('The review workspace is ready before saving this version.');
    const completion = container.querySelector('[data-builder-completion-summary="true"]');
    expect(completion?.getAttribute('data-builder-completion-result')).toBe('candidate');
    expect(completion?.textContent).toContain('A draft is ready for review.');
    expect(completion?.textContent).toContain('A small project.');
    expect(completion?.textContent).toContain('Review the workspace, then save a version if it looks right.');
    const completionSteps = completion?.querySelector('[data-builder-completion-steps="true"]');
    expect(completionSteps?.textContent).toContain('Recorded steps');
    expect(completionSteps?.textContent).toContain('Read the current project context.');
    expect(completionSteps?.textContent).toContain('Wrote the response.');
    expect(completionSteps?.textContent).toContain('Checked the response.');
    expect(completionSteps?.textContent).toContain('Prepared the result for review.');
    expect(completion?.textContent).not.toMatch(/saved|version saved|verified|test passed/iu);
    expect(completion?.textContent).not.toMatch(/provider_request_started|provider_response_received|result_preparing|context_ready/iu);
    expect(container.querySelector('[data-builder-review-checkpoint="true"]')?.textContent)
      .toContain('Static preview is ready');
    expect(container.querySelector('[data-builder-review-checkpoint="true"]')?.textContent)
      .toContain('HTML and CSS are shown here');
    expect(container.querySelector('[data-builder-composer="true"]')?.getAttribute('data-builder-composer-state'))
      .toBe('draft-ready');
    expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value).toBe('Add a timer.');
    expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.placeholder)
      .toBe('Ask about this draft, or describe the next change...');
    expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.readOnly).toBe(true);
    expect(container.querySelector('[data-builder-composer-review-gate="true"]')?.textContent)
      .toContain('Keep revising here, or review and save this version when ready.');
    expect(container.querySelector('[data-builder-composer-review-focus="true"]')?.textContent)
      .toContain('Review draft');
    expect(container.querySelector<HTMLButtonElement>('[data-builder-submit-turn="true"]')?.disabled)
      .toBe(true);
    expect(container.querySelector('[data-builder-save-version="true"]')?.closest('[data-builder-review-checkpoint="true"]'))
      .not.toBeNull();
    expect(container.querySelector('[data-builder-review-more="true"]')?.closest('[data-builder-review-checkpoint="true"]'))
      .not.toBeNull();
    expect(container.querySelector('[data-builder-save-version="true"]')?.closest('[data-builder-composer="true"]'))
      .toBeNull();
    expect(container.querySelector('[data-builder-discard-draft="true"]')).toBeNull();
    click(container, '[data-builder-review-more="true"]');
    expect(container.querySelector('[data-builder-discard-draft="true"]')?.textContent)
      .toContain('Discard draft');
    click(container, '[data-builder-discard-draft="true"]');
    expect(onRejectDraft).toHaveBeenCalledOnce();
    expect(onSave).not.toHaveBeenCalled();
    click(container, '[data-builder-save-version="true"]');
    expect(onSave).toHaveBeenCalledOnce();
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
    expect(container.querySelector<HTMLButtonElement>('[data-builder-save-version="true"]')?.disabled)
      .toBe(true);
    await save;
  });

  it('shows the main-owned automatic checkpoint beside the current unsaved draft', async () => {
    const { draftReady } = await snapshots();
    const activity = await candidateCheckpointActivity();
    const container = render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={activity}
        instruction="Add a timer."
        snapshot={draftReady}
      />,
    );

    const checkpoint = container.querySelector('[data-builder-draft-checkpoint-status="ready"]');
    expect(checkpoint?.textContent).toContain('Checkpoint saved');
    expect(checkpoint?.textContent).toContain('2 files');
    expect(checkpoint?.getAttribute('title'))
      .toBe('You can compare, restore, continue, or save a version.');
  });

  it('blocks Save but keeps Discard available when Review State has no verified checkpoint', async () => {
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

    expect(container.querySelector('[data-builder-review-state="blocked"]')?.textContent)
      .toContain('verified draft checkpoint');
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
    click(container, '[data-builder-review-more="true"]');
    expect(container.querySelector<HTMLButtonElement>('[data-builder-discard-draft="true"]')?.disabled)
      .toBe(false);
    click(container, '[data-builder-discard-draft="true"]');
    expect(onSave).not.toHaveBeenCalled();
    expect(onRejectDraft).toHaveBeenCalledOnce();
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

    expect(container.querySelector('[data-builder-review-state="blocked"]')?.textContent)
      .toContain('project check failed');
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('shows a main-owned running check after generation work has completed', async () => {
    const { draftReady } = await snapshots();
    const activity = await candidateRunningCheckActivity();
    const container = render(
      <BuilderPage
        activeFile={null}
        conversationSnapshot={activity}
        instruction="Add a timer."
        snapshot={draftReady}
      />,
    );

    const status = container.querySelector('[data-builder-agent-current-activity="running_checks"]');
    expect(status?.getAttribute('data-builder-activity-role')).toBe('status');
    expect(status?.textContent).toContain('Running checks');
    expect(status?.textContent).toContain('Checking the current draft before it is saved.');
    expect(status?.textContent).not.toMatch(/command|output|path|sha256|candidate_id|credential/iu);
  });

  it('uses the draft composer review shortcut without sending or saving', async () => {
    const { draftReady } = await snapshots();
    const activity = await candidateActivity();
    const onInstructionChange = vi.fn();
    const onSubmitInstruction = vi.fn();
    const onSave = vi.fn();
    const onRejectDraft = vi.fn();
    const { restore, spy } = installScrollIntoViewSpy();
    try {
      const container = render(
        <BuilderPage
          activeFile={null}
          conversationSnapshot={activity}
          instruction="Add a timer."
          onInstructionChange={onInstructionChange}
          onRejectDraft={onRejectDraft}
          onSave={onSave}
          onSubmitInstruction={onSubmitInstruction}
          snapshot={draftReady}
        />,
      );

      const review = container.querySelector<HTMLElement>('[data-builder-review-checkpoint="true"]');
      const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea');
      expect(review).not.toBeNull();
      expect(review?.tabIndex).toBe(-1);
      expect(textarea?.value).toBe('Add a timer.');
      expect(textarea?.readOnly).toBe(false);

      click(container, '[data-builder-composer-review-focus="true"]');

      expect(spy).toHaveBeenCalledWith({ block: 'start' });
      expect(document.activeElement).toBe(review);
      expect(onSubmitInstruction).not.toHaveBeenCalled();
      expect(onSave).not.toHaveBeenCalled();
      expect(onRejectDraft).not.toHaveBeenCalled();
    } finally {
      restore();
    }
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

    const chatMain = container.querySelector('[data-builder-chat-main="true"]');
    const workspace = container.querySelector('[data-builder-chat-workspace="true"]');
    const conversation = container.querySelector('[data-builder-conversation-workspace="true"]');
    const draftLanding = container.querySelector('[data-builder-draft-landing="true"]');
    const review = container.querySelector('[data-builder-review-checkpoint="true"]');
    const composer = container.querySelector('[data-builder-composer="true"]');
    const artifactSidebar = container.querySelector('[data-builder-artifact-sidebar="true"]');
    const artifactSummary = container.querySelector('[data-builder-artifact-summary="true"]');
    const workspaceControls = container.querySelector('[data-builder-workspace-controls="true"]');
    const preview = container.querySelector('[data-builder-preview-flow="true"]');
    const code = container.querySelector('[data-builder-code-flow="true"]');
    const source = container.querySelector('[data-builder-source-flow="true"]');
    const draftActions = container.querySelector('[data-builder-draft-review-actions="true"]');
    expect(chatMain).not.toBeNull();
    expect(workspace?.getAttribute('data-builder-artifact-sidebar-visible')).toBe('true');
    expect(artifactSidebar).not.toBeNull();
    expect(artifactSidebar?.getAttribute('data-builder-artifact-tab-active')).toBe('preview');
    const sideWorkspaceTabs = artifactSidebar?.querySelector('[data-builder-side-workspace-tabs="true"]');
    expect(sideWorkspaceTabs).not.toBeNull();
    expect(sideWorkspaceTabs?.querySelector('[role="tablist"]')).not.toBeNull();
    expect(sideWorkspaceTabs?.querySelector('[data-builder-side-workspace-tool="preview"]')?.getAttribute('aria-selected'))
      .toBe('true');
    expect(sideWorkspaceTabs?.querySelector('[data-builder-side-workspace-tool="preview"]')
      ?.getAttribute('data-builder-side-workspace-tab-kind'))
      .toBe('browser');
    expect(sideWorkspaceTabs?.querySelector('[data-builder-side-workspace-tool="changes"]')).toBeNull();
    expect(sideWorkspaceTabs?.querySelector('[data-builder-side-workspace-tool="permissions"]')).toBeNull();
    expect(sideWorkspaceTabs?.textContent).toContain('Preview');
    expect(sideWorkspaceTabs?.textContent).not.toContain('Changes');
    const artifactResizeHandle = artifactSidebar?.querySelector('[data-builder-artifact-resize-handle="true"]');
    expect(artifactResizeHandle).not.toBeNull();
    expect(artifactResizeHandle?.getAttribute('role')).toBe('separator');
    expect(artifactResizeHandle?.getAttribute('aria-label')).toBe('Resize artifact panel');
    expect(artifactResizeHandle?.getAttribute('aria-orientation')).toBe('vertical');
    expect(artifactResizeHandle?.getAttribute('aria-valuemin')).toBe('360');
    expect(artifactResizeHandle?.getAttribute('aria-valuenow')).toBe('480');
    expect(artifactResizeHandle?.getAttribute('data-builder-artifact-resizing')).toBeNull();
    expect(workspaceControls).not.toBeNull();
    expect(workspaceControls?.getAttribute('data-builder-workspace-drawer-visible')).toBe('true');
    expect(workspaceControls?.textContent).not.toContain('Terminal');
    expect(workspaceControls?.textContent).toContain('Open location');
    expect(workspaceControls?.textContent).toContain('Preview');
    expect(container.querySelector('[data-builder-open-project-location="true"]')?.getAttribute('aria-label'))
      .toBe('Open location');
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
    expect(workspaceMenu?.textContent).toContain('Permissions');
    expect(workspaceMenu?.textContent).not.toContain('Terminal');
    expect(container.querySelector('[data-builder-workspace-control-tab="preview"]')?.getAttribute('aria-pressed'))
      .toBeNull();
    expect(container.querySelector('[data-builder-workspace-control-tab="preview"]')?.getAttribute('aria-checked'))
      .toBe('true');
    expect(container.querySelector('[data-builder-workspace-control-tab="changes"]')).not.toBeNull();
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
      .toContain('Later');
    expect(newTabMenu?.querySelector('[data-builder-side-workspace-new-tab-kind="terminal"]')
      ?.getAttribute('aria-disabled'))
      .toBe('true');
    click(container, '[data-builder-workspace-control-tab="preview"]');
    expect(container.querySelector('[data-builder-workspace-menu="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-minimize-artifact="true"]')?.getAttribute('aria-label'))
      .toBe('Minimize artifact panel');
    expect(container.querySelector('[data-builder-toggle-artifact="true"]')?.getAttribute('aria-label'))
      .toBe('Hide artifact panel');
    expect(container.querySelector('[data-builder-close-artifact-sidebar="true"]')).toBeNull();
    expect(conversation).not.toBeNull();
    expect(draftLanding).not.toBeNull();
    expect(review).not.toBeNull();
    expect(review?.getAttribute('data-builder-review-layout')).toBe('compact-decision-actions');
    expect(composer).not.toBeNull();
    expect(artifactSummary).not.toBeNull();
    expect(preview).not.toBeNull();
    expect(code).toBeNull();
    expect(source).toBeNull();
    expect(draftActions).not.toBeNull();
    expect(conversation?.closest('[data-builder-chat-main="true"]')).toBe(chatMain);
    expect(draftLanding?.closest('[data-builder-chat-main="true"]')).toBe(chatMain);
    expect(review?.closest('[data-builder-chat-main="true"]')).toBe(chatMain);
    expect(artifactSummary?.closest('[data-builder-chat-main="true"]')).toBe(chatMain);
    expect(preview?.closest('[data-builder-chat-main="true"]')).toBeNull();
    expect(preview?.closest('[data-builder-artifact-sidebar="true"]')).toBe(artifactSidebar);
    expect(review?.closest('[data-builder-draft-landing="true"]')).toBe(draftLanding);
    expect(artifactSummary?.closest('[data-builder-draft-landing="true"]')).toBe(draftLanding);
    expect(preview?.closest('[data-builder-draft-landing="true"]')).toBeNull();
    expect(conversation?.classList.contains('cf-builder-chat-flow-surface')).toBe(true);
    expect(review?.classList.contains('cf-builder-chat-flow-surface')).toBe(true);
    expect(artifactSummary?.classList.contains('cf-builder-chat-flow-surface')).toBe(true);
    expect(preview?.classList.contains('cf-builder-chat-flow-surface')).toBe(false);
    expect(preview?.getAttribute('aria-label')).toBe('Project result');
    expect(preview?.textContent).toContain('Result');
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
    expect(Boolean(conversation!.compareDocumentPosition(review!) & Node.DOCUMENT_POSITION_FOLLOWING))
      .toBe(true);
    expect(Boolean(review!.compareDocumentPosition(artifactSummary!) & Node.DOCUMENT_POSITION_FOLLOWING))
      .toBe(true);
    expect(Boolean(artifactSummary!.compareDocumentPosition(composer!) & Node.DOCUMENT_POSITION_FOLLOWING))
      .toBe(true);
    expect(composer?.querySelector('[data-builder-save-version="true"]')).toBeNull();
    expect(composer?.querySelector('[data-builder-discard-draft="true"]')).toBeNull();
    expect(draftActions?.closest('[data-builder-review-checkpoint="true"]')).toBe(review);
    expect(draftActions?.querySelector('[data-builder-save-version="true"]')).not.toBeNull();
    expect(draftActions?.querySelector('[data-builder-review-more="true"]')).not.toBeNull();
    expect(draftActions?.querySelector('[data-builder-discard-draft="true"]')).toBeNull();
    Object.defineProperty(workspace, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ bottom: 720, height: 640, left: 0, right: 920, top: 80, width: 920 }),
    });
    Object.defineProperty(artifactSidebar, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ bottom: 720, height: 640, left: 440, right: 920, top: 80, width: 480 }),
    });
    const previousBodyCursor = document.body.style.cursor;
    const previousBodyUserSelect = document.body.style.userSelect;
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
      .toBe('560px');
    const resizedHandle = container.querySelector('[data-builder-artifact-resize-handle="true"]');
    expect(resizedHandle?.getAttribute('aria-valuenow')).toBe('560');
    expect(resizedHandle?.getAttribute('aria-valuemax')).toBe('560');
    expect(resizedHandle?.getAttribute('data-builder-artifact-resizing')).toBeNull();
    expect(document.body.style.cursor).toBe(previousBodyCursor);
    expect(document.body.style.userSelect).toBe(previousBodyUserSelect);
    const shrinkEvent = keyDown(container, '[data-builder-artifact-resize-handle="true"]', { key: 'ArrowRight' });
    expect(shrinkEvent.defaultPrevented).toBe(true);
    expect((workspace as HTMLElement).style.getPropertyValue('--cf-builder-artifact-width'))
      .toBe('536px');
    const minEvent = keyDown(container, '[data-builder-artifact-resize-handle="true"]', { key: 'Home' });
    expect(minEvent.defaultPrevented).toBe(true);
    expect((workspace as HTMLElement).style.getPropertyValue('--cf-builder-artifact-width'))
      .toBe('360px');
    const maxEvent = keyDown(container, '[data-builder-artifact-resize-handle="true"]', { key: 'End' });
    expect(maxEvent.defaultPrevented).toBe(true);
    expect((workspace as HTMLElement).style.getPropertyValue('--cf-builder-artifact-width'))
      .toBe('560px');
    click(container, '[data-builder-minimize-artifact="true"]');
    expect((workspace as HTMLElement).style.getPropertyValue('--cf-builder-artifact-width'))
      .toBe('360px');
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
    expect(container.querySelector('[data-builder-workspace-menu-button="true"]')?.textContent)
      .toContain('Changes');
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
    expect(changesDisclosure).not.toBeNull();
    expect(changesDisclosure?.open).toBe(true);
    expect(changesDisclosure?.textContent).toContain('Changes');
    expect(changesDisclosure?.querySelector('[data-builder-changes-summary="true"]')?.textContent)
      .toContain('file');
    expect(versions).toBeNull();
    expect(workspace?.getAttribute('data-builder-artifact-sidebar-visible')).toBe('true');
    expect(container.querySelector('[data-builder-workspace-menu-button="true"]')?.textContent)
      .toContain('Changes');
    expect(container.querySelector('[data-builder-open-artifact-preview="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-open-artifact-changes="true"]')).toBeNull();
    expect(container.querySelectorAll('[data-builder-save-version="true"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-builder-discard-draft="true"]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-builder-review-more="true"]')).toHaveLength(1);
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
      .toContain('The review workspace is ready before saving this version.');
    expect(onSubmitInstruction).not.toHaveBeenCalled();
    expect(onRejectDraft).not.toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
    click(container, '[data-builder-open-project-location="true"]');
    expect(onOpenProjectLocation).toHaveBeenCalledExactlyOnceWith(PROJECT_ID);
    expect(container.textContent).not.toMatch(
      /builder-generation-draft:|review_id|reviewer_id|reviewed_at_ms|sha256:|commit_oid|tree_oid|provider|credential/iu,
    );
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
    expect(filesPanel?.textContent).toContain('2 files from Current draft');
    expect(filesPanel?.textContent).toContain('App.tsx');
    expect(filesPanel?.textContent).toContain('styles.css');
    expect(filesPanel?.textContent).toContain('export function App()');
    expect(filesPanel?.querySelector('[data-builder-side-workspace-file-kind="directory"]')?.textContent)
      .toContain('src');
    expect(onRequestSideWorkspaceFiles).toHaveBeenCalled();

    click(container, '[data-builder-side-workspace-file-entry="src/styles.css"]');

    expect(onSelectSideWorkspaceFile).toHaveBeenCalledExactlyOnceWith(
      sideWorkspaceFileRef('src/styles.css', SIDE_WORKSPACE_STYLE_DIGEST),
    );
    expect(Object.keys(onSelectSideWorkspaceFile.mock.calls[0]?.[0] ?? {})).toStrictEqual([
      'file_ref_version',
      'source_tree_digest',
      'path',
      'content_digest',
    ]);
    expect(JSON.stringify(onSelectSideWorkspaceFile.mock.calls)).not.toContain('text_preview');
    expect(JSON.stringify(onSelectSideWorkspaceFile.mock.calls)).not.toContain('entries');
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
    expect(container.querySelector('[data-builder-workspace-menu-button="true"]')?.textContent)
      .toContain('Permissions');
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
    const { restore, spy } = installScrollIntoViewSpy();
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

    try {
      const container = render(<ChatFollowBuilderPage />);
      expect(container.querySelector('[data-builder-chat-scroll="true"]')).not.toBeNull();
      expect(container.querySelector('[data-builder-chat-tail="true"]')).not.toBeNull();
      expect(spy).toHaveBeenCalledExactlyOnceWith({ block: 'end' });

      act(() => setActivity(nextActivity));

      expect(spy).toHaveBeenCalledTimes(2);
      expect(spy).toHaveBeenLastCalledWith({ block: 'end' });
    } finally {
      restore();
    }
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
    const { restore, spy } = installScrollIntoViewSpy();
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

    try {
      const container = render(<ChatFollowBuilderPage />);
      const scroll = container.querySelector<HTMLElement>('[data-builder-chat-scroll="true"]');
      expect(scroll).not.toBeNull();
      expect(spy).toHaveBeenCalledTimes(1);
      const initialCallCount = spy.mock.calls.length;

      setScrollMetrics(scroll!, { clientHeight: 400, scrollHeight: 1200, scrollTop: 120 });
      act(() => {
        scroll?.dispatchEvent(new Event('scroll'));
      });
      act(() => setActivity(nextActivity));
      expect(spy).toHaveBeenCalledTimes(initialCallCount);

      setScrollMetrics(scroll!, { clientHeight: 400, scrollHeight: 1200, scrollTop: 720 });
      act(() => {
        scroll?.dispatchEvent(new Event('scroll'));
      });
      act(() => setActivity(acceptedActivity));
      expect(spy).toHaveBeenCalledTimes(initialCallCount + 1);
    } finally {
      restore();
    }
  });

  it('lands on the draft review actions when generation finishes', async () => {
    const { saved } = await snapshots();
    const draftReady = await changedDraftSnapshot();
    const activity = await candidateActivity();
    const { restore, spy } = installScrollIntoViewSpy();
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

    try {
      const container = render(<DraftLandingBuilderPage />);
      spy.mockClear();
      act(() => setSnapshot(draftReady));

      const result = container.querySelector('[data-builder-result-flow="true"]');
      const landing = container.querySelector('[data-builder-draft-landing="true"]');
      const review = container.querySelector('[data-builder-review-checkpoint="true"]');
      expect(result).not.toBeNull();
      expect(landing).not.toBeNull();
      expect(review).not.toBeNull();
      expect(spy).toHaveBeenCalled();
      expect(spy.mock.contexts.at(-1)).toBe(review);
      expect(spy).toHaveBeenLastCalledWith({ block: 'start' });
      expect(container.querySelector('[data-builder-review-more="true"]')).toBeNull();
      expect(container.querySelector('[data-builder-discard-draft="true"]')).toBeNull();
      expect(container.querySelector('[data-builder-save-version="true"]')).not.toBeNull();
      expect(review?.closest('[data-builder-draft-landing="true"]')).toBe(landing);
      expect(result?.closest('[data-builder-draft-landing="true"]')).toBeNull();
      expect(result?.closest('[data-builder-artifact-sidebar="true"]')).not.toBeNull();

      spy.mockClear();
      openWorkspaceChanges(container);
      const changes = container.querySelector('[data-builder-changes-flow="true"]');
      const changesDisclosure = container.querySelector<HTMLDetailsElement>('[data-builder-changes-disclosure="true"]');
      expect(changes).not.toBeNull();
      expect(changesDisclosure).not.toBeNull();
      expect(changesDisclosure?.open).toBe(true);
      expect(container.querySelector('[data-builder-workspace-menu-button="true"]')?.textContent)
        .toContain('Changes');
      expect(spy).not.toHaveBeenCalled();
      expect(changes?.closest('[data-builder-artifact-sidebar="true"]')).not.toBeNull();
    } finally {
      restore();
    }
  });

  it('keeps the completed draft review inside the chat scroll viewport', async () => {
    const { saved } = await snapshots();
    const draftReady = await changedDraftSnapshot();
    const activity = await candidateActivity();
    const { restore, spy } = installScrollIntoViewSpy();
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
      spy.mockClear();

      act(() => setSnapshot(draftReady));

      expect(scroll?.scrollTop).toBe(168);
      expect(spy).not.toHaveBeenCalledWith({ block: 'start' });
      expect(requestFrame).toHaveBeenCalledOnce();
    } finally {
      requestFrame.mockRestore();
      cancelFrame.mockRestore();
      vi.restoreAllMocks();
      restore();
    }
  });

  it('keeps the draft result summary inside the chat scroll viewport with the review', async () => {
    const { saved } = await snapshots();
    const draftReady = await changedDraftSnapshot();
    const activity = await candidateActivity();
    const { restore } = installScrollIntoViewSpy();
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

      expect(scroll?.scrollTop).toBe(232);
      expect(requestFrame).toHaveBeenCalledOnce();
    } finally {
      requestFrame.mockRestore();
      cancelFrame.mockRestore();
      vi.restoreAllMocks();
      restore();
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
    expect(container.querySelectorAll('[data-builder-work-status="true"]')).toHaveLength(1);
    expect(workStatus?.getAttribute('data-builder-activity-role')).toBe('status');
    expect(workStatus?.getAttribute('data-builder-work-status-stage')).toBe('result_preparing');
    expect(workStatus?.getAttribute('data-builder-work-phase')).toBe('preparing_review');
    expect(
      workStatus?.querySelector('[data-builder-message-surface]')
        ?.getAttribute('data-builder-message-surface'),
    ).toBe('status');
    expect(workStatus?.textContent).toContain('Preparing review');
    expect(workStatus?.textContent).toContain('Checking and organizing the result for review.');
    expect(started).toBeNull();
    expect(contextReady).toBeNull();
    expect(responseStarted).toBeNull();
    expect(responseReceived).toBeNull();
    expect(resultPreparing).toBeNull();
    expect(container.textContent).not.toMatch(
      /provider_request_started|provider_response_received|result_preparing|context_ready|builder-run:|sha256:|provider|credential|source_tree|receipt/iu,
    );
  });

  it('renders fact-backed Agent step progress without admission details', async () => {
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

    const completedStep = container.querySelector('[data-builder-agent-step-progress="result_recorded"]');
    expect(completedStep).not.toBeNull();
    expect(completedStep?.getAttribute('data-builder-activity-role')).toBe('status');
    expect(completedStep?.textContent).toContain('Step completed');
    expect(completedStep?.textContent).toContain('This step completed.');
    expect(container.querySelector('[data-builder-agent-step-progress="start_recorded"]')).toBeNull();
    expect(container.textContent).not.toMatch(
      /agent_step_progress_recorded|progress_admission|admission_digest|read_service|step_start_count|step_result_count|builder-run-step|provider|credential|source_tree|stdout|stderr|commit_oid|tree_oid|receipt/iu,
    );
  });

  it('explains failed work with a completion summary instead of internal phases', async () => {
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
    const summary = failed?.querySelector('[data-builder-completion-summary="true"]');
    expect(summary?.getAttribute('data-builder-completion-result')).toBe('failed');
    expect(summary?.textContent).toContain('The AI response arrived but could not be prepared for review.');
    expect(summary?.textContent).toContain('No version was saved by this result.');
    expect(summary?.textContent).toContain('Try again with a smaller request or continue with a clearer follow-up.');
    const completionSteps = summary?.querySelector('[data-builder-completion-steps="true"]');
    expect(completionSteps?.textContent).toContain('Recorded steps');
    expect(completionSteps?.textContent).toContain('Read the current project context.');
    expect(completionSteps?.textContent).toContain('Wrote the response.');
    expect(completionSteps?.textContent).toContain('Checked the response.');
    expect(completionSteps?.textContent).not.toContain('Prepared the result for review.');
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();
    expect(container.textContent).not.toMatch(
      /provider_response_received|provider_request_started|context_ready|result_preparing|builder-run:|sha256:|provider|credential|source_tree|receipt/iu,
    );
  });

  it('keeps completed run progress available in on-demand work logs', async () => {
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
    expect(failed?.querySelector('[data-builder-completion-summary="true"]')).not.toBeNull();

    click(container, '[data-builder-workspace-menu-button="true"]');
    click(container, '[data-builder-workspace-control-tab="logs"]');

    const logs = container.querySelector('[data-builder-artifact-logs="true"]');
    const logStatuses = logs?.querySelectorAll('[data-builder-work-status="true"]');
    expect(logs).not.toBeNull();
    expect(logStatuses).toHaveLength(4);
    expect(logs?.textContent).toContain('Preparing this request.');
    expect(logs?.textContent).toContain('Reading the current project context.');
    expect(logs?.textContent).toContain('Writing the response.');
    expect(logs?.textContent).toContain('Checking the response.');
    expect(logs?.textContent).toContain('Could not finish');
    expect(logs?.textContent).not.toMatch(
      /provider_response_received|provider_request_started|context_ready|result_preparing|builder-run:|sha256:|provider|credential|source_tree|receipt/iu,
    );
  });

  it('keeps active work status visible beside the streaming assistant reply', async () => {
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
    expect(workStatus).not.toBeNull();
    expect(workStatus?.getAttribute('data-builder-work-status-stage')).toBe('result_preparing');
    expect(workStatus?.textContent).toContain('Checking and organizing the result for review.');
    expect(container.querySelector('[data-builder-activity-card="Context ready"]')).toBeNull();
    expect(container.querySelector('[data-builder-activity-card="AI response started"]')).toBeNull();
    expect(container.querySelector('[data-builder-activity-card="AI response received"]')).toBeNull();
    expect(container.querySelector('[data-builder-activity-card="Preparing result"]')).toBeNull();
    expect(container.textContent).not.toMatch(
      /provider_request_started|provider_response_received|result_preparing|context_ready|request_id|builder-run:|sha256:|provider|credential|source_tree|receipt/iu,
    );
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
      spy.mockClear();

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

  it('uses fact-backed work status instead of a duplicate waiting reply before display-safe text arrives', async () => {
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
    expect(workStatus).not.toBeNull();
    expect(workStatus?.getAttribute('data-builder-work-status-stage')).toBe('result_preparing');
    expect(workStatus?.textContent).toContain('Checking and organizing the result for review.');
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

  it('keeps pending tool requests visible without exposing internal evidence', async () => {
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

    const requested = container.querySelector('[data-builder-tool-activity="requested"]');
    expect(requested).not.toBeNull();
    expect(requested?.getAttribute('data-builder-activity-role')).toBe('status');
    expect(requested?.textContent).toContain('Looking over the project');
    expect(requested?.textContent).toContain('checking the current project context');
    expect(requested?.textContent).not.toContain('Read project context');
    expect(container.textContent).not.toMatch(
      /builder-tool-call:|builder-run-step:|builder-run:|permission_admission|dispatch_admission|execution_admission|result_admission|raw_output_admission|revision_admission|summary_code|tool_call_id|step_id|sha256:|provider|credential|source_tree|receipt/iu,
    );
  });

  it('folds completed project context checks into one visible status without exposing internal evidence', async () => {
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

    const requested = container.querySelector('[data-builder-tool-activity="requested"]');
    const completed = container.querySelector('[data-builder-tool-activity="succeeded"]');
    expect(requested).toBeNull();
    expect(completed).not.toBeNull();
    expect(completed?.getAttribute('data-builder-activity-role')).toBe('status');
    expect(completed?.textContent).toContain('Project context ready');
    expect(completed?.textContent).toContain('I checked the project context needed for this request.');
    expect(completed?.textContent).not.toContain('Read project context');
    expect(container.querySelector('[data-builder-activity-card="Draft proposed"]')?.textContent)
      .toContain('I prepared a draft after reading the project context.');
    expect(container.textContent).not.toMatch(
      /builder-tool-call:|builder-run-step:|builder-run:|permission_admission|dispatch_admission|execution_admission|result_admission|raw_output_admission|revision_admission|summary_code|tool_call_id|step_id|sha256:|provider|credential|source_tree|receipt/iu,
    );
  });

  it('opens sanitized work logs in the artifact sidebar without turning chat into a log pane', async () => {
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
    expect(container.querySelector('[data-builder-workspace-menu-button="true"]')?.textContent)
      .toContain('Workspace');
    expect(container.querySelector('[data-builder-workspace-control-tab="logs"]')).toBeNull();
    click(container, '[data-builder-workspace-menu-button="true"]');
    const logsControl = container.querySelector<HTMLButtonElement>('[data-builder-workspace-control-tab="logs"]');
    expect(logsControl).not.toBeNull();
    expect(container.querySelector('[data-builder-artifact-logs="true"]')).toBeNull();

    click(container, '[data-builder-workspace-control-tab="logs"]');

    const updatedSidebar = container.querySelector('[data-builder-artifact-sidebar="true"]');
    const logs = container.querySelector('[data-builder-artifact-logs="true"]');
    expect(updatedSidebar?.getAttribute('data-builder-artifact-tab-active')).toBe('logs');
    expect(logs).not.toBeNull();
    expect(logs?.closest('[data-builder-artifact-sidebar="true"]')).toBe(updatedSidebar);
    expect(logs?.closest('[data-builder-chat-main="true"]')).toBeNull();
    expect(logs?.textContent).toContain('Work logs');
    expect(chatMain?.textContent).not.toContain('Why this ran');
    expect(logs?.textContent).toContain('Why this ran');
    expect(logs?.textContent).toContain('Builder treated this as a change request.');
    expect(logs?.textContent).toContain('The current brief was attached.');
    expect(logs?.textContent).toContain('It used the current project version.');
    expect(logs?.textContent).toContain('Builder was allowed to write in the selected project.');
    expect(logs?.textContent).toContain('No terminal commands or network access were used.');
    expect(logs?.textContent).toContain('Project context ready');
    expect(logs?.textContent).toContain('I checked the project context needed for this request.');
    expect(logs?.textContent).toContain('Draft proposed');
    expect(logs?.textContent).not.toContain('Read project context');
    expect(logs?.textContent).not.toContain('Make a timer.');
    expect(logs?.textContent).not.toMatch(
      /builder-tool-call:|builder-run-step:|builder-run:|permission_admission|dispatch_admission|execution_admission|result_admission|raw_output_admission|revision_admission|summary_code|tool_call_id|step_id|sha256:|provider|credential|source_tree|receipt/iu,
    );
    expect(container.querySelector('[data-builder-activity="true"]')?.closest('[data-builder-chat-main="true"]'))
      .toBe(chatMain);
  });

  it('explains safe route downgrades only inside work logs', async () => {
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
    click(container, '[data-builder-workspace-menu-button="true"]');
    click(container, '[data-builder-workspace-control-tab="logs"]');

    const logs = container.querySelector('[data-builder-artifact-logs="true"]');
    expect(chatMain?.textContent).not.toContain('not have enough confirmed direction');
    expect(logs?.textContent).toContain('Builder kept this as a clarification step.');
    expect(logs?.textContent).toContain('It did not have enough confirmed direction to start changing files.');
    expect(logs?.textContent).not.toMatch(
      /downgrade_reason|downgraded_from|builder-route-decision|required_permissions|confidence|provider|credential|source_tree|receipt/iu,
    );
  });

  it('shows the current direction on demand from task brief facts without exposing internal memory', async () => {
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

    click(container, '[data-builder-workspace-menu-button="true"]');
    click(container, '[data-builder-workspace-control-tab="logs"]');

    const logs = container.querySelector('[data-builder-artifact-logs="true"]');
    const currentDirection = container.querySelector('[data-builder-current-direction="true"]');
    expect(currentDirection).not.toBeNull();
    expect(currentDirection?.closest('[data-builder-artifact-logs="true"]')).toBe(logs);
    expect(currentDirection?.closest('[data-builder-chat-main="true"]')).toBeNull();
    expect(currentDirection?.textContent).toContain('Current direction');
    expect(currentDirection?.textContent).toContain('Ready for later build');
    expect(currentDirection?.textContent).toContain('Use a starfield hero, compact project cards');
    expect(currentDirection?.textContent).toContain('Used only after you ask Builder to start building');
    expect(logs?.textContent).toContain('Direction updated');
    expect(currentDirection?.textContent).not.toMatch(
      /Current project brief|builder-task:|builder-run:|builder-message:|builder-route-decision|working_brief|sha256:|provider|credential|source_tree|receipt/iu,
    );
  });

  it('shows completed project file reads as ordinary assistant work status', async () => {
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

    const requested = container.querySelector('[data-builder-tool-activity="requested"]');
    const completed = container.querySelector('[data-builder-tool-activity="succeeded"]');
    expect(requested).toBeNull();
    expect(completed).not.toBeNull();
    expect(completed?.textContent).toContain('Project files reviewed');
    expect(completed?.textContent).toContain('I checked the project files needed for this request.');
    expect(completed?.textContent).not.toContain('Read project file');
    expect(completed?.textContent).not.toMatch(
      /tool|adapter|output|admission|summary_code|resource_kind|builder-tool-call:|source_tree|receipt/iu,
    );
  });

  it('maps tool result failures to ordinary status text', async () => {
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

    const completed = container.querySelector('[data-builder-tool-activity="failed"]');
    expect(completed).not.toBeNull();
    expect(completed?.getAttribute('data-builder-activity-role')).toBe('status');
    expect(completed?.textContent).toContain('Project context needs attention');
    expect(completed?.textContent).toContain('could not safely use the information from this step');
    expect(completed?.textContent).not.toMatch(/tool|adapter|output|admission|summary_code|resource_kind|builder-tool-call:/iu);
  });

  it('maps unavailable tool results without exposing adapter language', async () => {
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

    const completed = container.querySelector('[data-builder-tool-activity="failed"]');
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

    const reviewStrip = container.querySelector('[data-builder-review-checkpoint="true"]');
    const landing = container.querySelector('[data-builder-draft-landing="true"]');
    expect(reviewStrip).not.toBeNull();
    expect(landing).not.toBeNull();
    expect(reviewStrip?.closest('[data-builder-chat-main="true"]')).not.toBeNull();
    expect(reviewStrip?.closest('[data-builder-draft-landing="true"]')).toBe(landing);
    expect(reviewStrip?.getAttribute('data-builder-review-layout')).toBe('compact-decision-actions');
    expect(reviewStrip?.textContent).toContain('Review before saving');
    expect(reviewStrip?.textContent).toContain('3 file changes: 1 added, 1 changed, 1 removed.');
    expect(reviewStrip?.textContent).toContain('Static preview is ready');
    expect(reviewStrip?.textContent).toContain('JavaScript is disabled in this preview');
    expect(reviewStrip?.textContent).not.toContain('Preview may be unavailable here');
    expect(reviewStrip?.textContent).not.toMatch(
      /<main>Old|<main>New|const added|const removed|review_id|sha256:|commit_oid|tree_oid|receipt/iu,
    );
    expect(container.querySelector('[data-builder-artifact-sidebar="true"]')).not.toBeNull();
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
    expect(changesDisclosure).not.toBeNull();
    expect(changesDisclosure?.open).toBe(true);
    expect(container.querySelector('[data-builder-workspace-menu-button="true"]')?.textContent)
      .toContain('Changes');
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

    const review = container.querySelector('[data-builder-review-checkpoint="true"]');
    const limitation = container.querySelector('[data-builder-preview-limitation="true"]');
    const blocked = container.querySelector('[data-builder-preview-runtime-blocked="true"]');
    expect(review?.textContent).toContain('Preview may need live support here');
    expect(review?.textContent).toContain('Three.js/WebGL');
    expect(review?.textContent).toContain('canvas animation');
    expect(review?.textContent).toContain('ready for review');
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

  it('keeps draft review actions on a separate desktop row so summary text is not squeezed', async () => {
    const draftReady = await changedDraftSnapshot();
    const container = render(
      <BuilderPage
        activeFile={null}
        instruction="Update the saved project."
        snapshot={draftReady}
      />,
    );

    const review = container.querySelector('[data-builder-review-checkpoint="true"]');
    const copy = review?.querySelector('.cf-builder-review-copy');
    const checks = review?.querySelector('[data-builder-review-checks="true"]');
    const actions = review?.querySelector('[data-builder-draft-review-actions="true"]');
    expect(review?.getAttribute('data-builder-review-layout')).toBe('compact-decision-actions');
    expect(copy).not.toBeNull();
    expect(checks).not.toBeNull();
    expect(actions).not.toBeNull();
    expect(checks?.previousElementSibling).toBe(copy);
    expect(actions?.previousElementSibling).toBe(checks);
    expect(copy?.textContent).toContain('Review before saving');
    expect(copy?.textContent).toContain('file changes');
    expect(actions?.textContent).not.toContain('Changes');
    expect(actions?.textContent).not.toContain('Preview');
    expect(actions?.textContent).not.toContain('Discard draft');
    expect(actions?.querySelector('[data-builder-review-more="true"]')).toBeNull();
    expect(actions?.textContent).toContain('Save version');
    expect(review?.textContent).not.toMatch(
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

  it('shows Git/SQLite revision number only for a verified saved snapshot', async () => {
    const { saved } = await snapshots();
    const container = render(
      <BuilderPage activeFile={null} instruction="" snapshot={saved} />,
    );
    expect(container.querySelector('[data-builder-current-version="true"]')?.textContent)
      .toContain('Version 1');
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-draft-landing="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-result-flow="true"]')?.closest('[data-builder-draft-landing="true"]') ?? null)
      .toBeNull();
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

    expect(container.querySelector('[data-builder-version-history="true"]')).not.toBeNull();
    expect(container.querySelector('[data-builder-version-card="Version 1"]')?.textContent)
      .toContain('Current');
    expect(container.querySelector('[data-builder-version-card="Version 1"]')?.textContent)
      .toContain('Version one');
    expect(container.querySelector('[data-builder-version-card="Version 1"] button'))
      .toBeNull();
    expect(container.querySelector('[data-builder-version-card="Version 1"] [data-builder-show-current-version="true"]'))
      .toBeNull();
    click(container, 'button[aria-label="Refresh versions"]');
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

    expect(container.querySelector('[data-builder-activity-card="Draft proposed"]')?.textContent)
      .toContain('Activity shows this draft summary only. Review appears only after Builder verifies and restores the files.');
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-current-version="true"]')?.textContent)
      .toContain('Version 1');
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

    expect(container.querySelector('[data-builder-activity-card="Plan approved"]')?.textContent)
      .toContain('The plan was approved. The project has not changed yet.');
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
    expect(planCard?.textContent).toContain('Review the proposed plan before files change.');
    const summary = planCard?.querySelector('[data-builder-completion-summary="true"]');
    expect(summary?.getAttribute('data-builder-completion-result')).toBe('plan');
    expect(summary?.textContent).toContain('A plan is ready for review.');
    expect(summary?.textContent).toContain('The project files have not changed.');
    expect(summary?.textContent).toContain('Approve the plan to continue, or reject it to keep discussing.');
    expect(planCard?.textContent).toContain('Approve this plan to let the assistant continue.');
    expect(planReady).toBeNull();
    expect(planActions).not.toBeNull();
    expect(planActions?.closest('[data-builder-activity-card="Plan proposed"]')).toBe(planCard);
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
    click(container, '[data-builder-approve-plan="true"]');
    expect(onReviewPlan).toHaveBeenCalledExactlyOnceWith({
      project_id: PROJECT_ID,
      conversation_id: `builder-conversation:${PROJECT_ID.slice('builder-project:'.length)}`,
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
        sideWorkspaceFileContent={sideWorkspaceFileContent(toolFile, 'print("hello")\n', 'python')}
        sideWorkspaceFileContentStatus="ready"
        sideWorkspaceFileTree={sideWorkspaceFileTree([toolFile])}
        sideWorkspaceFileTreeStatus="ready"
        snapshot={draftReady}
      />,
    );
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
    expect(container.querySelector('[data-builder-side-workspace-file-content="src/tool.py"] code')?.textContent)
      .toContain('print("hello")');
    expect(container.textContent).not.toContain('app.js');
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

    expect(container.querySelector('[data-builder-code-flow="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-result-flow="true"]')).not.toBeNull();
    expect(container.querySelector('[data-builder-preview-unavailable="true"]')?.textContent)
      .toContain('Preview unavailable');
    expect(container.querySelector('[data-builder-preview-unavailable="true"]')?.textContent)
      .toContain('files were generated');
    expect(container.querySelector('[data-builder-preview-unavailable="true"]')?.textContent)
      .toContain('live preview support');
    expect(container.querySelector('[data-builder-review-checkpoint="true"]')?.textContent)
      .toContain('Preview unavailable');
    expect(container.querySelector('[data-builder-review-checkpoint="true"]')?.textContent)
      .toContain('need live preview support');
    expect(container.querySelector('[data-builder-artifact-sidebar="true"]')?.getAttribute('data-builder-artifact-tab-active'))
      .toBe('preview');
    expect(container.querySelector('details[data-builder-source-flow="true"]')).toBeNull();
    click(container, '[data-builder-workspace-menu-button="true"]');
    click(container, '[data-builder-workspace-control-tab="source"]');
    const source = container.querySelector<HTMLElement>('[data-builder-side-workspace-files="true"]');
    expect(source).not.toBeNull();
    expect(source?.closest('[data-builder-chat-main="true"]')).toBeNull();
    expect(source?.closest('[data-builder-artifact-sidebar="true"]')).not.toBeNull();
    expect(source?.textContent).toContain('1 file from Current draft');
    expect(source?.textContent).toContain('src/tool.py');
    expect(container.querySelector('[data-builder-side-workspace-file-content="src/tool.py"] code')?.textContent)
      .toContain('print("new")');
    expect(container.textContent).toContain('Preview unavailable');
    expect(container.textContent).toContain('Three.js');
    expect(container.textContent).not.toContain('This project has files, but no visual preview.');

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
    expect(container.textContent).toContain('Try Save again');
    const notice = container.querySelector('[data-builder-conversation-notice="save_unknown"]');
    expect(notice).not.toBeNull();
    expect(notice?.closest('[data-builder-chat-main="true"]')).not.toBeNull();
    expect(notice?.closest('[data-builder-composer="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).not.toBeNull();
  });
});
