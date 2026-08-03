// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BuilderApp } from './BuilderApp';
import {
  BUILDER_DESKTOP_BRIDGE_VERSION,
  type BuilderDesktopBridgeRoot,
} from './builderDesktopBridgeRoot';
import {
  CONVERSATION_ID,
  PROJECT_ID,
  RUN_ID,
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
  createReadWire,
  createRejectedTaskStreamWire,
  createRestoredGenerationDraft,
  createSaveResult,
  createSourceTree,
  createTaskStreamWire,
  createTwoAnswerTaskStreamWire,
  digest,
} from '../test/builderV2Fixtures';
import { createBuilderGenerationRequest } from '../features/builder/application/builderGeneration';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mounted: Array<{ root: Root; container: HTMLDivElement }> = [];
const PENDING_TURN_ID = 'builder-turn:123e4567-e89b-42d3-a456-426614174001';
const PENDING_TASK_ID = 'builder-task:123e4567-e89b-42d3-a456-426614174001';
const PENDING_RUN_ID = 'builder-run:123e4567-e89b-42d3-a456-426614174001';

afterEach(() => {
  for (const entry of mounted.splice(0)) {
    act(() => entry.root.unmount());
    entry.container.remove();
  }
});

async function waitFor(assertion: () => void): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
  }
  throw lastError;
}

function createContextualBuildTaskStreamWire() {
  const wire = createAnswerTaskStreamWire();
  return {
    ...wire,
    conversation: {
      ...wire.conversation,
      head_sequence: 5,
      window: {
        ...wire.conversation.window,
        last_sequence: 5,
      },
      items: [
        {
          item_kind: 'user_message',
          sequence: 1,
          turn_id: TURN_ID,
          message: {
            message_id: 'builder-message:123e4567-e89b-42d3-a456-426614174000',
            text: '我想先聊一下这个作品集首页怎么做，目标是星空背景和项目列表。',
          },
          message_kind: 'submitted',
          mode: 'question',
          task: null,
        },
        {
          item_kind: 'run_started',
          sequence: 2,
          turn_id: TURN_ID,
          run_id: RUN_ID,
          task_id: null,
          attempt_number: 1,
          retry_of_run_id: null,
          recorded_state: 'started',
        },
        {
          item_kind: 'run_completed',
          sequence: 3,
          turn_id: TURN_ID,
          run_id: RUN_ID,
          terminal_status: 'succeeded',
          result_kind: 'explanation',
          failure_phase: 'not_applicable',
          assistant_message: {
            message_id: 'builder-message:223e4567-e89b-42d3-a456-426614174000',
            text: '方案是先做单页静态作品集，包含 hero、项目卡片和联系入口。',
          },
          candidate: null,
        },
        {
          item_kind: 'task_brief_updated',
          sequence: 4,
          turn_id: TURN_ID,
          run_id: RUN_ID,
          task: {
            task_id: PENDING_TASK_ID,
            title: 'Current project brief',
          },
          brief: {
            status: 'ready',
            summary: '我想先聊一下这个作品集首页怎么做，目标是星空背景和项目列表。 方案是先做单页静态作品集，包含 hero、项目卡片和联系入口。',
            contextual_build_ready: true,
          },
          recorded_state: 'updated',
        },
        {
          item_kind: 'turn_completed',
          sequence: 5,
          turn_id: TURN_ID,
          run_id: RUN_ID,
          outcome: 'answered',
        },
      ],
    },
  };
}

function createReadOnlyPageQuestionTaskStreamWire() {
  const wire = createAnswerTaskStreamWire();
  return {
    ...wire,
    conversation: {
      ...wire.conversation,
      items: [
        {
          item_kind: 'user_message',
          sequence: 1,
          turn_id: TURN_ID,
          message: {
            message_id: 'builder-message:123e4567-e89b-42d3-a456-426614174000',
            text: '为什么这个页面预览空白？',
          },
          message_kind: 'submitted',
          mode: 'question',
          task: null,
        },
        {
          item_kind: 'run_started',
          sequence: 2,
          turn_id: TURN_ID,
          run_id: RUN_ID,
          task_id: null,
          attempt_number: 1,
          retry_of_run_id: null,
          recorded_state: 'started',
        },
        {
          item_kind: 'run_completed',
          sequence: 3,
          turn_id: TURN_ID,
          run_id: RUN_ID,
          terminal_status: 'succeeded',
          result_kind: 'explanation',
          failure_phase: 'not_applicable',
          assistant_message: {
            message_id: 'builder-message:223e4567-e89b-42d3-a456-426614174000',
            text: '这个页面可能因为静态预览不运行 JavaScript 而空白，可以先查看预览限制和文件内容。',
          },
          candidate: null,
        },
        {
          item_kind: 'turn_completed',
          sequence: 4,
          turn_id: TURN_ID,
          run_id: RUN_ID,
          outcome: 'answered',
        },
      ],
    },
  };
}

async function setup(options: Readonly<{
  answerActivity?: boolean;
  briefUpdateActivity?: boolean;
  contextualBuildActivity?: boolean;
  deferredAnswer?: boolean;
  deferredFailedFirstAnswer?: boolean;
  deferredFailedAnswerAfterFirst?: boolean;
  deferAnswerAfterFirst?: boolean;
  deferredApprovedPlanGenerate?: boolean;
  deferredGenerate?: boolean;
  failFirstAnswer?: boolean;
  failAnswerAfterFirst?: boolean;
  consecutiveAnswerActivity?: boolean;
  recordedFirstAnswerAfterFailedPublicResult?: boolean;
  recordedAnswerAfterFailedPublicResult?: boolean;
  failGenerate?: boolean;
  failApprovedPlanGenerateOnce?: boolean;
  failPlanReview?: boolean;
  failTaskStreamAfterPlanReview?: boolean;
  deferredPlanReview?: boolean;
  failSubmitOnce?: boolean;
  initiallySaved?: boolean;
  planSourceReadApprovalRequired?: boolean;
  failPlanSourceReadApproval?: boolean;
  currentProjectWriteApprovalRequired?: boolean;
  failCurrentProjectWriteApproval?: boolean;
  planAfterPropose?: boolean;
  pendingActivity?: boolean;
  pendingPlanActivity?: boolean;
  rejectedPlanActivity?: boolean;
  pendingAfterRevisionView?: boolean;
  acceptedPendingActivity?: boolean;
  rejectActivityAfterDiscard?: boolean;
  rejectedPendingActivity?: boolean;
  restoreAvailable?: boolean;
  runningActivity?: boolean;
  readOnlyPageQuestionActivity?: boolean;
  validHistoryPreview?: boolean;
  multipleWorkspaceOnlyCatalog?: boolean;
  workspaceOnlyCatalog?: boolean;
}> = {}) {
  const historicalWire = options.validHistoryPreview === true
    ? await createReadWire(await createSourceTree([
      { path: 'index.html', content: '<main>Earlier</main>\n' },
    ]))
    : null;
  const readWire = options.validHistoryPreview === true && historicalWire !== null
    ? await readWireAsRevision(
      await createReadWire(await createSourceTree([
        { path: 'index.html', content: '<main>Current</main>\n' },
      ])),
      2,
      historicalWire.product_revision_receipt.revision_receipt_digest,
    )
    : await createReadWire();
  const catalogWire = await createCatalogWire();
  let saved = options.initiallySaved === true;
  let selectedProjectId: string | null = null;
  let latestAnswerInstruction: string | null = null;
  const answerInstructions: string[] = [];
  let latestDraft = await createGenerationDraft();
  let restoredDraft = await createRestoredDraftForReadWire(readWire);
  let resolveAnswer: (() => Promise<void>) | null = null;
  let answerAttempts = 0;
  let resolveGenerate: (() => Promise<void>) | null = null;
  let resolvePlanReview: (() => Promise<void>) | null = null;
  let approvedPlanGenerateAttempts = 0;
  let currentProjectWriteAllowed = options.currentProjectWriteApprovalRequired !== true;
  let planReviewRecorded = false;
  async function createDraftForCurrentProject(
    hostRequest: Awaited<ReturnType<typeof createBuilderGenerationRequest>>,
    sourceTree = readWire.source_tree,
  ) {
    const draft = await createGenerationDraft(hostRequest, sourceTree);
    return saved ? draft : { ...draft, base_revision_evidence: null };
  }
  const generate = vi.fn(async (request: unknown) => {
    const instruction = (request as { instruction: string }).instruction;
    const hostRequest = await createBuilderGenerationRequest(instruction, selectedProjectId);
    if (options.failGenerate === true) {
      return {
        version: 'builder-generation-ipc-result.v1',
        ok: false,
        error: {
          code: 'builder_generation_provider_http_error',
          retryable: true,
        },
      };
    }
    if (options.deferredGenerate === true) {
      return new Promise<unknown>((resolve) => {
        resolveGenerate = async () => {
          latestDraft = await createDraftForCurrentProject(hostRequest);
          resolve({
            version: 'builder-generation-ipc-result.v1',
            ok: true,
            result: latestDraft,
          });
        };
      });
    }
    latestDraft = await createDraftForCurrentProject(hostRequest);
    return {
      version: 'builder-generation-ipc-result.v1',
      ok: true,
      result: latestDraft,
    };
  });
  const retry = vi.fn(async (request: unknown) => {
    const instruction = (request as { instruction: string }).instruction;
    const hostRequest = await createBuilderGenerationRequest(instruction, selectedProjectId);
    latestDraft = await createDraftForCurrentProject(hostRequest);
    return {
      version: 'builder-generation-ipc-result.v1',
      ok: true,
      result: latestDraft,
    };
  });
  const continueDraft = vi.fn(async (request: unknown) => {
    expect(request).toEqual({
      draft_id: latestDraft.draft_id,
      instruction: (request as { instruction: string }).instruction,
    });
    const instruction = (request as { instruction: string }).instruction;
    const hostRequest = await createBuilderGenerationRequest(instruction, selectedProjectId);
    latestDraft = await createDraftForCurrentProject(hostRequest);
    return {
      version: 'builder-generation-ipc-result.v1',
      ok: true,
      result: latestDraft,
    };
  });
  const answer = vi.fn(async (request: unknown) => {
    answerAttempts += 1;
    const instruction = (request as { instruction: string }).instruction;
    latestAnswerInstruction = instruction;
    answerInstructions.push(instruction);
    const hostRequest = await createBuilderGenerationRequest(instruction, selectedProjectId);
    const shouldFailAnswer = (options.failFirstAnswer === true && answerAttempts === 1)
      || (options.failAnswerAfterFirst === true && answerAttempts > 1);
    if (shouldFailAnswer) {
      if (
        (options.deferredFailedFirstAnswer === true && answerAttempts === 1)
        || (options.deferredFailedAnswerAfterFirst === true && answerAttempts > 1)
      ) {
        return new Promise<unknown>((resolve) => {
          resolveAnswer = async () => {
            resolve({
              version: 'builder-generation-ipc-result.v1',
              ok: false,
              error: {
                code: 'builder_generation_structured_response_invalid',
                retryable: true,
              },
            });
          };
        });
      }
      return {
        version: 'builder-generation-ipc-result.v1',
        ok: false,
        error: {
          code: 'builder_generation_structured_response_invalid',
          retryable: true,
        },
      };
    }
    if (options.deferredAnswer === true || (options.deferAnswerAfterFirst === true && answerAttempts > 1)) {
      return new Promise<unknown>((resolve) => {
        resolveAnswer = async () => {
          resolve({
            version: 'builder-generation-ipc-result.v1',
            ok: true,
            result: await createGenerationAnswer(hostRequest),
          });
        };
      });
    }
    return {
      version: 'builder-generation-ipc-result.v1',
      ok: true,
      result: await createGenerationAnswer(hostRequest),
    };
  });
  const answerDraft = vi.fn(async (request: unknown) => {
    expect(request).toEqual({
      draft_id: latestDraft.draft_id,
      instruction: (request as { instruction: string }).instruction,
    });
    const instruction = (request as { instruction: string }).instruction;
    const hostRequest = await createBuilderGenerationRequest(instruction, selectedProjectId);
    return {
      version: 'builder-generation-ipc-result.v1',
      ok: true,
      result: await createGenerationAnswer(hostRequest),
    };
  });
  let submitAttempts = 0;
  const submit = vi.fn(async (request: unknown) => {
    submitAttempts += 1;
    const instruction = (request as { instruction: string }).instruction;
    const hostRequest = await createBuilderGenerationRequest(instruction, selectedProjectId);
    if (options.briefUpdateActivity === true && /(?:我想|我要|我们要|希望|需要|保存这个方向|would like|want|save this|use this as)/iu.test(instruction)) {
      return {
        version: 'builder-generation-ipc-result.v1',
        ok: true,
        result: await createGenerationAnswer(hostRequest),
      };
    }
    if (/[?\uFF1F]\s*$/u.test(instruction)) {
      return {
        version: 'builder-generation-ipc-result.v1',
        ok: true,
        result: await createGenerationAnswer(hostRequest),
      };
    }
    if (options.failSubmitOnce === true && submitAttempts === 1) {
      return {
        version: 'builder-generation-ipc-result.v1',
        ok: false,
        error: {
          code: 'builder_generation_provider_http_error',
          retryable: true,
        },
      };
    }
    if (options.failGenerate === true) {
      return {
        version: 'builder-generation-ipc-result.v1',
        ok: false,
        error: {
          code: 'builder_generation_provider_http_error',
          retryable: true,
        },
      };
    }
    if (options.deferredGenerate === true) {
      return new Promise<unknown>((resolve) => {
        resolveGenerate = async () => {
          latestDraft = await createDraftForCurrentProject(hostRequest);
          resolve({
            version: 'builder-generation-ipc-result.v1',
            ok: true,
            result: latestDraft,
          });
        };
      });
    }
    latestDraft = await createDraftForCurrentProject(hostRequest);
    return {
      version: 'builder-generation-ipc-result.v1',
      ok: true,
      result: latestDraft,
    };
  });
  const saveDraft = vi.fn(async (request: unknown) => {
    expect(request).toEqual({ draft_id: latestDraft.draft_id });
    saved = true;
    return createSaveResult(latestDraft, readWire);
  });
  const restoreDraft = vi.fn(async (request: unknown) => {
    if (options.restoreAvailable !== true) {
      return {
        version: 'builder-generation-ipc-result.v1',
        ok: false,
        error: {
          code: 'builder_generation_parent_unavailable',
          retryable: true,
        },
      };
    }
    restoredDraft = options.workspaceOnlyCatalog === true && !saved
      ? await createRestoredDraftForUnsavedWorkspaceWire(readWire)
      : await createRestoredDraftForReadWire(readWire);
    expect(request).toEqual({ draft_id: restoredDraft.draft_id });
    return {
      version: 'builder-generation-ipc-result.v1',
      ok: true,
      result: restoredDraft,
    };
  });
  const restoreRevisionAsDraft = vi.fn(async (request: unknown) => {
    const revisionReceiptDigest = (request as { revision_receipt_digest: string }).revision_receipt_digest;
    expect((request as { project_id: string }).project_id).toBe(PROJECT_ID);
    const sourceTree = historicalWire !== null
      && revisionReceiptDigest === historicalWire.product_revision_receipt.revision_receipt_digest
      ? historicalWire.source_tree
      : readWire.source_tree;
    const hostRequest = await createBuilderGenerationRequest('Restore an earlier saved version.', PROJECT_ID);
    latestDraft = await createGenerationDraft(hostRequest, sourceTree);
    latestDraft = {
      ...latestDraft,
      base_revision_evidence: latestDraft.base_revision_evidence === null
        ? null
        : {
          ...latestDraft.base_revision_evidence,
          revision_receipt_digest: readWire.product_revision_receipt.revision_receipt_digest,
          commit_oid: readWire.product_revision_receipt.commit_oid,
          source_tree_digest: readWire.source_tree.source_tree_digest,
        },
    };
    return {
      version: 'builder-generation-ipc-result.v1',
      ok: true,
      result: latestDraft,
    };
  });
  const rejectDraft = vi.fn(async (request: unknown) => {
    expect(request).toEqual({ draft_id: latestDraft.draft_id });
    return {
      version: 'builder-generation-ipc-result.v1',
      ok: true,
      result: {
        result_version: 'builder-generation-draft-rejection-result.v1',
        draft_id: latestDraft.draft_id,
        project_id: PROJECT_ID,
        rejected: true,
        pending_draft_released: true,
        conversation_event_admission: 'sqlite_recorded',
      },
    };
  });
  const cancel = vi.fn(async (request: unknown) => ({
    request_id: (request as { request_id: string }).request_id,
    cancelled: true,
  }));
  const steer = vi.fn(async (request: unknown) => ({
    request_id: (request as { request_id: string }).request_id,
    steered: true,
  }));
  const reviewPlan = vi.fn(async (request: unknown) => {
    const result = {
      result_version: 'builder-conversation-plan-review-result.v1',
      ...(request as object),
      review_admission: 'sqlite_recorded_no_execution',
    };
    if (options.failPlanReview === true) throw new Error('plan review unavailable');
    if (options.deferredPlanReview === true) {
      return new Promise<unknown>((resolve) => {
        resolvePlanReview = async () => {
          planReviewRecorded = true;
          resolve(result);
        };
      });
    }
    planReviewRecorded = true;
    return result;
  });
  const generateApprovedPlan = vi.fn(async (request: unknown) => {
    expect(request).toEqual({
      project_id: PROJECT_ID,
      conversation_id: CONVERSATION_ID,
      turn_id: TURN_ID,
      run_id: RUN_ID,
    });
    approvedPlanGenerateAttempts += 1;
    if (options.failApprovedPlanGenerateOnce === true && approvedPlanGenerateAttempts === 1) {
      return {
        version: 'builder-generation-ipc-result.v1',
        ok: false,
        error: {
          code: 'builder_generation_provider_http_error',
          retryable: true,
        },
      };
    }
    const hostRequest = await createBuilderGenerationRequest('Review the approved plan.', PROJECT_ID);
    if (options.deferredApprovedPlanGenerate === true) {
      return new Promise<unknown>((resolve) => {
        resolveGenerate = async () => {
          latestDraft = await createDraftForCurrentProject(hostRequest);
          resolve({
            version: 'builder-generation-ipc-result.v1',
            ok: true,
            result: latestDraft,
          });
        };
      });
    }
    latestDraft = await createDraftForCurrentProject(hostRequest);
    return {
      version: 'builder-generation-ipc-result.v1',
      ok: true,
      result: latestDraft,
    };
  });
  const proposePlan = vi.fn(async (request: unknown) => {
    const instruction = (request as { instruction: string }).instruction;
    const hostRequest = await createBuilderGenerationRequest(instruction, PROJECT_ID);
    return {
      version: 'builder-generation-ipc-result.v1',
      ok: true,
      result: {
        version: 'builder-generation-result.v2',
        result_kind: 'plan',
        request_id: hostRequest.request_digest,
        project_id: PROJECT_ID,
        existing_project_id: PROJECT_ID,
        title: 'Project update plan',
        summary: 'Review the saved project before editing.',
        steps: [
          {
            title: 'Review current files',
            purpose: 'Understand the saved project before editing.',
            expected_change: 'No files change in this step.',
            status: 'proposed',
          },
        ],
        admissions: {
          conversation: 'sqlite_recorded',
          draft: 'not_created',
          save: 'not_performed',
          preview: 'not_applicable',
          execution: 'not_evaluated',
          revision: 'not_created',
          review: 'not_recorded',
        },
        conversation_head: {
          sequence: 3,
          event_id: `builder-conversation-event:${'1'.repeat(64)}`,
          event_digest: `sha256:${'2'.repeat(64)}`,
        },
      },
    };
  });
  const preparePlanSourceReadApproval = vi.fn(async (request: unknown) => ({
    version: 'builder-generation-ipc-result.v1',
    ok: true,
    result: {
      result_version: 'builder-plan-source-read-approval-status.v1',
      project_id: (request as { project_id: string }).project_id,
      state: options.planSourceReadApprovalRequired === true ? 'approval_required' : 'ready',
      file_count: 3,
      approval_scope: 'current_project_plan_source_read',
      authority: 'main_selected_project_bounded_filesystem_read_v1',
    },
  }));
  const approvePlanSourceRead = vi.fn(async (request: unknown) => {
    if (options.failPlanSourceReadApproval === true) throw new Error('approval unavailable');
    return {
      version: 'builder-generation-ipc-result.v1',
      ok: true,
      result: {
        result_version: 'builder-plan-source-read-approval-result.v1',
        project_id: (request as { project_id: string }).project_id,
        operation: 'approval_recorded',
        file_count: 3,
        approval_scope: 'current_project_plan_source_read',
        authority: 'main_selected_project_bounded_filesystem_read_v1',
      },
    };
  });
  const prepareCurrentProjectWriteApproval = vi.fn(async (request: unknown) => ({
    version: 'builder-generation-ipc-result.v1',
    ok: true,
    result: {
      result_version: 'builder-current-project-write-approval-status.v1',
      project_id: (request as { project_id: string }).project_id,
      state: currentProjectWriteAllowed ? 'ready' : 'approval_required',
      approval_scope: 'current_project_write',
      authority: 'main_selected_project_project_edit_v1',
    },
  }));
  const approveCurrentProjectWrite = vi.fn(async (request: unknown) => {
    if (options.failCurrentProjectWriteApproval === true) throw new Error('approval unavailable');
    currentProjectWriteAllowed = true;
    return {
      version: 'builder-generation-ipc-result.v1',
      ok: true,
      result: {
        result_version: 'builder-current-project-write-approval-result.v1',
        project_id: (request as { project_id: string }).project_id,
        operation: 'approval_recorded',
        approval_scope: 'current_project_write',
        authority: 'main_selected_project_project_edit_v1',
      },
    };
  });
  const loadCurrent = vi.fn(async () => readWire);
  let loadRevisionCalls = 0;
  const generationStartedListeners = new Set<(event: unknown) => void>();
  const generationOutputListeners = new Set<(event: unknown) => void>();
  const taskStreamChangedListeners = new Set<(event: unknown) => void>();
  const readTaskStream = vi.fn(async () => {
    if (options.failTaskStreamAfterPlanReview === true && planReviewRecorded) {
      throw new Error('activity unavailable');
    }
    return options.planAfterPropose === true && proposePlan.mock.calls.length > 0
      ? createPlanTaskStreamWire()
      : options.rejectedPlanActivity === true
        ? createPlanReviewTaskStreamWire('rejected')
      : options.pendingPlanActivity === true && planReviewRecorded
        ? createPlanReviewTaskStreamWire('approved')
        : options.pendingPlanActivity === true
          ? createPlanTaskStreamWire()
          : options.rejectActivityAfterDiscard === true && rejectDraft.mock.calls.length > 0
            ? createRejectedTaskStreamWire()
            : options.briefUpdateActivity === true && (
              submit.mock.calls.length > 0
              || (latestAnswerInstruction !== null
                && /(?:我想|我要|我们要|希望|需要|保存这个方向|would like|want|save this|use this as)/iu
                  .test(latestAnswerInstruction))
            )
              ? createContextualBuildTaskStreamWire()
            : options.consecutiveAnswerActivity === true
              && answerAttempts > 1
              && answerInstructions.length > 1
              ? createTwoAnswerTaskStreamWire({
                firstQuestionText: answerInstructions[0],
                secondAnswerText: 'This is the second read-only answer.',
                secondQuestionText: answerInstructions.at(-1) ?? 'What did I just ask?',
              })
            : options.consecutiveAnswerActivity === true
              && answerAttempts > 0
              && latestAnswerInstruction !== null
              ? createAnswerTaskStreamWire({
                questionText: latestAnswerInstruction,
              })
            : options.recordedAnswerAfterFailedPublicResult === true
              && options.failAnswerAfterFirst === true
              && answerAttempts > 1
              && latestAnswerInstruction !== null
              ? createTwoAnswerTaskStreamWire({
                firstQuestionText: 'hi',
                secondAnswerText: '我是由深度求索（DeepSeek）公司创造的 DeepSeek 模型。',
                secondQuestionText: latestAnswerInstruction,
              })
            : options.recordedFirstAnswerAfterFailedPublicResult === true
              && options.failFirstAnswer === true
              && answerAttempts > 0
              && latestAnswerInstruction !== null
              ? createAnswerTaskStreamWire({
                answerText: '我是DeepSeek最新版本模型，由深度求索公司创造。我可以回答问题、提供建议、协助创作等。',
                questionText: latestAnswerInstruction,
              })
            : options.answerActivity === true
              ? createAnswerTaskStreamWire()
              : options.readOnlyPageQuestionActivity === true
                ? createReadOnlyPageQuestionTaskStreamWire()
              : options.contextualBuildActivity === true
                ? createContextualBuildTaskStreamWire()
                : options.acceptedPendingActivity === true
                ? pendingCandidateTaskStreamWire('accepted')
                : options.rejectedPendingActivity === true
                  ? pendingCandidateTaskStreamWire('rejected')
                  : options.pendingAfterRevisionView === true && loadRevisionCalls > 0
                    ? pendingCandidateTaskStreamWire('proposed')
                    : options.runningActivity === true
                      ? runningTaskStreamWire()
                      : options.pendingActivity === true
                        ? pendingCandidateTaskStreamWire('proposed')
                        : createTaskStreamWire();
  });
  const open = vi.fn(async (request: { project_id: string | null }) => {
    selectedProjectId = request.project_id;
    if (request.project_id === null) {
      return {
        result_version: 'builder-project-selection-result.v1',
        operation: 'new_selected',
        project_id: null,
      };
    }
    if ((options.workspaceOnlyCatalog === true || options.multipleWorkspaceOnlyCatalog === true) && !saved) {
      return {
        result_version: 'builder-project-selection-result.v1',
        operation: 'local_project_bound',
        project_id: request.project_id,
        project_title: 'Unsaved dashboard',
        source_folders: [{
          name: 'site-source',
          status: 'selected',
        }],
      };
    }
    return readWire;
  });
  const createLocalProject = vi.fn(async (request: Readonly<{ project_id: string | null; project_title: string }>) => {
    const projectId = request.project_id ?? PROJECT_ID;
    selectedProjectId = projectId;
    return {
      result_version: 'builder-project-selection-result.v1',
      operation: 'local_project_bound',
      project_id: projectId,
      project_title: request.project_title,
      source_folders: [
        {
          name: 'focus-timer',
          status: 'selected',
        },
      ],
    };
  });
  const openLocation = vi.fn(async (request: Readonly<{ project_id: string }>) => ({
    result_version: 'builder-project-location-open-result.v1',
    project_id: request.project_id,
    opened: true,
  }));
  const listCurrent = vi.fn(async () => (
    saved ? catalogWire : { ...catalogWire, projects: [] }
  ));
  const listWorkspaces = vi.fn(async () => createWorkspaceCatalogWire(
    options.multipleWorkspaceOnlyCatalog === true
      ? [
        {
          project_id: PROJECT_ID,
          title: 'Unsaved dashboard',
          source_folders: [{ name: 'site-source', status: 'selected' }],
          bound_at_ms: 20,
          has_current_revision: false,
          current_revision_number: 0,
        },
        {
          project_id: 'builder-project:22222222-2222-4222-8222-222222222222',
          title: 'Second unsaved dashboard',
          source_folders: [{ name: 'second-source', status: 'selected' }],
          bound_at_ms: 10,
          has_current_revision: false,
          current_revision_number: 0,
        },
      ]
      : options.workspaceOnlyCatalog === true
      ? [{
        project_id: PROJECT_ID,
        title: 'Unsaved dashboard',
        source_folders: [{ name: 'site-source', status: 'selected' }],
        bound_at_ms: 20,
        has_current_revision: false,
        current_revision_number: 0,
      }]
      : [],
  ));
  const listHistory = vi.fn(async (request: unknown) => (
    options.validHistoryPreview === true && historicalWire !== null
      ? createValidHistoryWire((request as { project_id: string }).project_id, readWire, historicalWire)
      : createHistoryWire((request as { project_id: string }).project_id, 1)
  ));
  const loadRevision = vi.fn(async (request: unknown) => {
    loadRevisionCalls += 1;
    if (options.validHistoryPreview === true && historicalWire !== null) {
      const revisionReceiptDigest = (request as { revision_receipt_digest: string }).revision_receipt_digest;
      if (revisionReceiptDigest === historicalWire.product_revision_receipt.revision_receipt_digest) {
        return {
          ...historicalWire,
          operation: 'revision_loaded',
          current: readWire.current,
        };
      }
    }
    return {
      ...readWire,
      operation: 'revision_loaded',
      current: readWire.current,
    };
  });
  const bridge: BuilderDesktopBridgeRoot = {
    bridgeVersion: BUILDER_DESKTOP_BRIDGE_VERSION,
    codeGenerator: {
      submit,
      generate,
      continueDraft,
      generateApprovedPlan,
      proposePlan,
      preparePlanSourceReadApproval,
      approvePlanSourceRead,
      prepareCurrentProjectWriteApproval,
      approveCurrentProjectWrite,
      retry,
      answer,
      answerDraft,
      restoreDraft,
      restoreRevisionAsDraft,
      rejectDraft,
      cancel,
      steer,
      availability: async () => null,
      subscribeStarted(listener: (event: unknown) => void) {
        generationStartedListeners.add(listener);
        return () => {
          generationStartedListeners.delete(listener);
        };
      },
      subscribeOutput(listener: (event: unknown) => void) {
        generationOutputListeners.add(listener);
        return () => {
          generationOutputListeners.delete(listener);
        };
      },
    },
    projectWorkspace: {
      open,
      openLocation,
      createLocalProject,
      saveDraft,
      loadCurrent,
      loadRevision,
      listCurrent,
      listWorkspaces,
      listHistory,
    },
    providerSettings: {},
    permissions: {},
    planReview: {
      review: reviewPlan,
    },
    taskStream: {
      read: readTaskStream,
      subscribeChanged(listener: (event: unknown) => void) {
        taskStreamChangedListeners.add(listener);
        return () => {
          taskStreamChangedListeners.delete(listener);
        };
      },
    },
    windowControls: {
      close: async () => ({ result_version: 'builder-window-control-result.v1', ok: true }),
      minimize: async () => ({ result_version: 'builder-window-control-result.v1', ok: true }),
      readState: async () => ({ state_version: 'builder-window-state.v1', maximized: false }),
      toggleMaximize: async () => ({
        result_version: 'builder-window-control-result.v1',
        ok: true,
      }),
    },
  };
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  await act(async () => {
    root.render(<BuilderApp bridgeRoot={bridge} />);
  });
  return {
    container,
    answer,
    answerDraft,
    cancel,
    continueDraft,
    createLocalProject,
    openLocation,
    generate,
    generateApprovedPlan,
    resolveAnswer: async () => {
      for (let attempt = 0; resolveAnswer === null && attempt < 20; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      }
      if (resolveAnswer === null) throw new Error('answer was not deferred');
      await resolveAnswer();
    },
    resolvePlanReview: async () => {
      if (resolvePlanReview === null) throw new Error('plan review was not deferred');
      await resolvePlanReview();
    },
    proposePlan,
    preparePlanSourceReadApproval,
    approvePlanSourceRead,
    prepareCurrentProjectWriteApproval,
    approveCurrentProjectWrite,
    submit,
    retry,
    steer,
    listHistory,
    loadRevision,
    listCurrent,
    listWorkspaces,
    loadCurrent,
    open,
    readTaskStream,
    emitTaskStreamChanged(projectId = PROJECT_ID) {
      const listenerCount = taskStreamChangedListeners.size;
      act(() => {
        for (const listener of [...taskStreamChangedListeners]) {
          listener({
            event_version: 'builder-task-stream-changed.v1',
            project_id: projectId,
          });
        }
      });
      return listenerCount;
    },
    emitGenerationStarted(requestId: string, projectId = PROJECT_ID) {
      const listenerCount = generationStartedListeners.size;
      act(() => {
        for (const listener of [...generationStartedListeners]) {
          listener({
            event_version: 'builder-generation-started.v1',
            request_id: requestId,
            project_id: projectId,
          });
        }
      });
      return listenerCount;
    },
    emitGenerationStartedWithoutAct(requestId: string, projectId = PROJECT_ID) {
      const listenerCount = generationStartedListeners.size;
      for (const listener of [...generationStartedListeners]) {
        listener({
          event_version: 'builder-generation-started.v1',
          request_id: requestId,
          project_id: projectId,
        });
      }
      return listenerCount;
    },
    emitGenerationOutput(requestId: string, text: string, projectId = PROJECT_ID) {
      const listenerCount = generationOutputListeners.size;
      act(() => {
        for (const listener of [...generationOutputListeners]) {
          listener({
            event_version: 'builder-generation-output.v1',
            request_id: requestId,
            project_id: projectId,
            conversation_id: `builder-conversation:${projectId.slice('builder-project:'.length)}`,
            turn_id: 'builder-turn:123e4567-e89b-42d3-a456-426614174001',
            task_id: 'builder-task:123e4567-e89b-42d3-a456-426614174001',
            run_id: 'builder-run:123e4567-e89b-42d3-a456-426614174001',
            display_delta_text: text,
          });
        }
      });
      return listenerCount;
    },
    reviewPlan,
    rejectDraft,
    restoreDraft,
    restoreRevisionAsDraft,
    async resolveGenerate() {
      await resolveGenerate?.();
    },
    saveDraft,
  };
}

type ReadWire = Awaited<ReturnType<typeof createReadWire>>;

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

function historyRevision(wire: ReadWire, isCurrent: boolean, parentOid: string | null = wire.product_revision_receipt.parent_oid) {
  return {
    project_id: wire.product_revision_receipt.project_id,
    title: wire.product_revision_receipt.title,
    summary: wire.product_revision_receipt.summary,
    revision_number: wire.product_revision_receipt.revision_number,
    revision_receipt_digest: wire.product_revision_receipt.revision_receipt_digest,
    previous_revision_receipt_digest: wire.product_revision_receipt.previous_revision_receipt_digest,
    commit_oid: wire.product_revision_receipt.commit_oid,
    tree_oid: wire.product_revision_receipt.tree_oid,
    parent_oid: parentOid,
    selected_at_ms: wire.product_revision_receipt.selected_at_ms,
    is_current: isCurrent,
  };
}

function createValidHistoryWire(projectId: string, currentWire: ReadWire, historicalWire: ReadWire) {
  const currentParentOid = historicalWire.product_revision_receipt.commit_oid;
  return {
    result_version: 'builder-project-read-result.v1',
    operation: 'history_listed',
    project_id: projectId,
    current: {
      ...currentWire.current,
      parent_oid: currentParentOid,
    },
    revisions: [
      historyRevision(currentWire, true, currentParentOid),
      historyRevision(historicalWire, false),
    ],
    authority_evidence: {
      product_authority: 'sqlite_product_revision_receipt',
      code_authority: 'git_commit_tree',
      source_read_admission: 'verified',
      current_selection: 'sqlite_current_project_revision',
      history_selection: 'sqlite_project_revision_receipts',
    },
  };
}

function click(container: HTMLElement, label: string): void {
  const button = label.startsWith('[')
    ? container.querySelector<HTMLButtonElement>(label)
    : [...container.querySelectorAll<HTMLButtonElement>('button')]
      .find((candidate) => candidate.textContent?.includes(label));
  expect(button, label).not.toBeUndefined();
  act(() => button?.click());
}

function setComposerInstruction(container: HTMLElement, instruction: string): void {
  const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea');
  expect(textarea).not.toBeNull();
  act(() => {
    if (textarea === null) return;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      ?.call(textarea, instruction);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

async function waitForComposerSubmitReady(container: HTMLElement): Promise<void> {
  await waitFor(() => {
    expect(container.querySelector<HTMLButtonElement>('[data-builder-submit-turn="true"]')?.disabled)
      .toBe(false);
  });
}

function artifactPreviewSrcdoc(container: HTMLElement): string | null {
  return container
    .querySelector('[data-builder-artifact-sidebar="true"] [data-builder-result-flow="true"] iframe')
    ?.getAttribute('srcdoc') ?? null;
}

async function openSavedProject(container: HTMLElement): Promise<void> {
  await waitFor(() => {
    expect(container.querySelector(`[data-builder-project-id="${PROJECT_ID}"]`)).not.toBeNull();
  });
  click(container, 'Hello project');
  await waitFor(() => {
    expect(container.querySelector('[data-builder-current-version="true"]')?.textContent)
      .toContain('Version 1');
  });
}

async function createRestoredDraftForReadWire(
  readWire: Awaited<ReturnType<typeof createReadWire>>,
) {
  const draft = await createRestoredGenerationDraft(readWire.source_tree);
  if (draft.base_revision_evidence === null) return draft;
  return {
    ...draft,
    base_revision_evidence: {
      ...draft.base_revision_evidence,
      project_id: readWire.product_revision_receipt.project_id,
      revision_receipt_digest: readWire.product_revision_receipt.revision_receipt_digest,
      commit_oid: readWire.product_revision_receipt.commit_oid,
      source_tree_digest: readWire.source_tree.source_tree_digest,
    },
  };
}

async function createRestoredDraftForUnsavedWorkspaceWire(
  readWire: Awaited<ReturnType<typeof createReadWire>>,
) {
  const request = await createBuilderGenerationRequest('Add a local-project change.');
  const draft = await createGenerationDraft(request, readWire.source_tree);
  return {
    ...draft,
    request_id: null,
    restart_restore: 'git_sqlite_verified' as const,
  };
}

function pendingCandidateTaskStreamWire(state: 'accepted' | 'proposed' | 'rejected') {
  const wire = state === 'accepted'
    ? createAcceptedTaskStreamWire(1)
    : state === 'rejected'
      ? createRejectedTaskStreamWire()
      : createTaskStreamWire();
  return {
    ...wire,
    conversation: {
      ...wire.conversation,
      items: wire.conversation.items.map((item) => {
        if (item.item_kind === 'user_message') {
          return {
            ...item,
            turn_id: PENDING_TURN_ID,
            task: 'task' in item && item.task !== null
              ? { ...item.task, task_id: PENDING_TASK_ID }
              : null,
          };
        }
        if (item.item_kind === 'run_started') {
          return {
            ...item,
            turn_id: PENDING_TURN_ID,
            run_id: PENDING_RUN_ID,
            task_id: PENDING_TASK_ID,
          };
        }
        if (item.item_kind === 'run_completed') {
          return {
            ...item,
            turn_id: PENDING_TURN_ID,
            run_id: PENDING_RUN_ID,
          };
        }
        return {
          ...item,
          turn_id: PENDING_TURN_ID,
          run_id: PENDING_RUN_ID,
        };
      }),
    },
  };
}

function runningTaskStreamWire() {
  const wire = createTaskStreamWire();
  return {
    ...wire,
    conversation: {
      ...wire.conversation,
      head_sequence: 2,
      recorded_active_turn_id: TURN_ID,
      window: {
        ...wire.conversation.window,
        last_sequence: 2,
      },
      items: wire.conversation.items.slice(0, 2),
    },
  };
}

describe('BuilderApp v2', () => {
  it('renders one integrated desktop workbench with Projects and Settings only', async () => {
    const { container } = await setup();
    expect(container.querySelectorAll('main')).toHaveLength(1);
    expect(container.querySelector('[data-builder-workbench="true"]')).not.toBeNull();
    expect(container.textContent).toContain('Projects');
    expect(container.textContent).toContain('Settings');
    const railLabels = Array.from(container.querySelectorAll('.cf-builder-rail-button'))
      .map((button) => button.textContent);
    expect(railLabels).toEqual(['Projects', 'Settings']);
    expect(container.querySelector('[data-builder-workbench-rail="true"] .cf-builder-rail-brand')).toBeNull();
    expect(container.querySelector('[data-builder-rail-item="settings"]')?.textContent).toBe('Settings');
    expect(railLabels).not.toContain('Canvas');
    expect(railLabels).not.toContain('Chat');
  });

  it('opens the selected project location through the main-owned workspace port', async () => {
    const { container, openLocation } = await setup({ initiallySaved: true });
    await openSavedProject(container);

    click(container, '[data-builder-open-project-location="true"]');

    expect(openLocation).toHaveBeenCalledExactlyOnceWith({ project_id: PROJECT_ID });
  });

  it('routes the sidebar new-project command into source folder binding before work starts', async () => {
    const { container, createLocalProject, generate, submit } = await setup();

    click(container, '[data-builder-catalog-new-project="true"]');

    await waitFor(() => {
      expect(container.querySelector('[data-builder-new-project-panel="true"]')?.textContent)
        .toContain('Source folders');
    });
    expect(container.querySelector('[data-builder-new-project-panel="true"]')?.textContent)
      .toContain('No source folder selected.');
    expect(container.querySelector('[data-builder-workspace-picker="true"]')?.textContent)
      .not.toContain('Choose or create a project before I build.');
    expect(createLocalProject).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(container.querySelector('[data-builder-page="true"]')?.getAttribute('data-builder-project-status'))
        .toBe('new');
    });
    expect(container.querySelector<HTMLInputElement>('[data-builder-new-project-title="true"]')?.value)
      .toBe('New project');
    expect(container.querySelector<HTMLButtonElement>('[data-builder-add-source-folder="true"]')?.disabled)
      .toBe(false);

    click(container, '[data-builder-add-source-folder="true"]');
    await waitFor(() => {
      expect(createLocalProject).toHaveBeenCalledExactlyOnceWith({
        project_id: null,
        project_title: 'New project',
      });
    });

    expect(submit).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(container.querySelector('[data-builder-workspace-chip="true"]')?.textContent)
        .toContain('Source folder: focus-timer');
    });
  });

  it('keeps prior read-only chat visible while the next answer is running without a source folder', async () => {
    const { answer, container, readTaskStream, resolveAnswer } = await setup({
      answerActivity: true,
      deferAnswerAfterFirst: true,
    });

    setComposerInstruction(container, 'hi');
    await waitForComposerSubmitReady(container);
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(answer).toHaveBeenCalledExactlyOnceWith({ instruction: 'hi' });
      expect(container.textContent).toContain('This answer does not change files.');
    });
    expect(readTaskStream).toHaveBeenCalledWith({ project_id: PROJECT_ID });

    setComposerInstruction(container, '你是什么大模型');
    await waitForComposerSubmitReady(container);
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(answer).toHaveBeenCalledTimes(2);
      expect(container.querySelector('[data-builder-conversation-notice="answering"]')?.textContent)
        .toContain('Answering');
    });
    expect(container.querySelector('[data-builder-conversation-workspace="true"]')).not.toBeNull();
    expect(container.textContent).toContain('This answer does not change files.');
    expect(container.textContent).not.toContain('Activity is unavailable');

    await resolveAnswer();
  });

  it('keeps both consecutive read-only chat turns visible without a source folder', async () => {
    const { answer, container, generate, readTaskStream, saveDraft, submit } = await setup({
      consecutiveAnswerActivity: true,
    });

    setComposerInstruction(container, 'hi');
    await waitForComposerSubmitReady(container);
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(answer).toHaveBeenCalledExactlyOnceWith({ instruction: 'hi' });
      expect(container.textContent).toContain('hi');
      expect(container.textContent).toContain('This answer does not change files.');
    });

    setComposerInstruction(container, '你对当下的 LLM 有什么看法？');
    await waitForComposerSubmitReady(container);
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(answer).toHaveBeenCalledTimes(2);
      expect(container.textContent).toContain('hi');
      expect(container.textContent).toContain('This answer does not change files.');
      expect(container.textContent).toContain('你对当下的 LLM 有什么看法？');
      expect(container.textContent).toContain('This is the second read-only answer.');
    });

    expect(readTaskStream).toHaveBeenCalledWith({ project_id: PROJECT_ID });
    expect(submit).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-current-version="true"]')).toBeNull();
  });

  it('keeps both consecutive saved-project chat turns visible without creating a draft', async () => {
    const { answer, container, generate, readTaskStream, saveDraft, submit } = await setup({
      consecutiveAnswerActivity: true,
      initiallySaved: true,
    });
    await openSavedProject(container);
    readTaskStream.mockClear();

    setComposerInstruction(container, 'What should I consider before changing this project?');
    await waitForComposerSubmitReady(container);
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(answer).toHaveBeenCalledExactlyOnceWith({
        instruction: 'What should I consider before changing this project?',
      });
      expect(container.textContent).toContain('What should I consider before changing this project?');
      expect(container.textContent).toContain('This answer does not change files.');
    });

    setComposerInstruction(container, 'Can we discuss the audience more?');
    await waitForComposerSubmitReady(container);
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(answer).toHaveBeenCalledTimes(2);
      expect(container.textContent).toContain('What should I consider before changing this project?');
      expect(container.textContent).toContain('This answer does not change files.');
      expect(container.textContent).toContain('Can we discuss the audience more?');
      expect(container.textContent).toContain('This is the second read-only answer.');
    });

    expect(readTaskStream).toHaveBeenCalledWith({ project_id: PROJECT_ID });
    expect(submit).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
  });

  it('keeps prior read-only chat visible when the next answer fails without a source folder', async () => {
    const { answer, container, generate, readTaskStream, saveDraft, submit } = await setup({
      answerActivity: true,
      failAnswerAfterFirst: true,
    });

    setComposerInstruction(container, 'hi');
    await waitForComposerSubmitReady(container);
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(answer).toHaveBeenCalledExactlyOnceWith({ instruction: 'hi' });
      expect(container.textContent).toContain('This answer does not change files.');
    });
    expect(readTaskStream).toHaveBeenCalledWith({ project_id: PROJECT_ID });

    setComposerInstruction(container, '你是什么大模型');
    await waitForComposerSubmitReady(container);
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(answer).toHaveBeenCalledTimes(2);
      expect(container.textContent).toContain('The answer could not be prepared. Try again.');
    });
    expect(submit).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(container.querySelector('[data-builder-conversation-workspace="true"]')).not.toBeNull();
    expect(container.textContent).toContain('This answer does not change files.');
    expect(container.textContent).not.toContain('Activity is unavailable');
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
  });

  it('does not show answer failed notice when the same answer was recorded in the chat stream', async () => {
    const { answer, container, generate, saveDraft, submit } = await setup({
      answerActivity: true,
      failAnswerAfterFirst: true,
      recordedAnswerAfterFailedPublicResult: true,
    });

    setComposerInstruction(container, 'hi');
    await waitForComposerSubmitReady(container);
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(answer).toHaveBeenCalledExactlyOnceWith({ instruction: 'hi' });
      expect(container.textContent).toContain('This answer does not change files.');
    });

    setComposerInstruction(container, '你是什么大模型');
    await waitForComposerSubmitReady(container);
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(answer).toHaveBeenCalledTimes(2);
      expect(container.textContent).toContain('我是由深度求索（DeepSeek）公司创造的 DeepSeek 模型。');
    });
    expect(container.textContent).toContain('This answer does not change files.');
    expect(container.textContent).not.toContain('The answer could not be prepared. Try again.');
    expect(container.querySelector('[data-builder-conversation-notice="answer_failed"]')).toBeNull();
    expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value).toBe('');
    expect(submit).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
  });

  it('uses the started run project id when a first read-only answer was recorded before public failure', async () => {
    const {
      answer,
      container,
      emitGenerationStarted,
      generate,
      readTaskStream,
      resolveAnswer,
      saveDraft,
      submit,
    } = await setup({
      deferredFailedFirstAnswer: true,
      failFirstAnswer: true,
      recordedFirstAnswerAfterFailedPublicResult: true,
    });

    const question = '你是什么大模型';
    setComposerInstruction(container, question);
    await waitForComposerSubmitReady(container);
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(answer).toHaveBeenCalledExactlyOnceWith({ instruction: question });
    });
    const request = await createBuilderGenerationRequest(question, null);
    expect(emitGenerationStarted(request.request_digest, PROJECT_ID)).toBeGreaterThan(0);

    await act(async () => {
      await resolveAnswer();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(readTaskStream).toHaveBeenCalledWith({ project_id: PROJECT_ID });
      expect(container.textContent).toContain('我是DeepSeek最新版本模型，由深度求索公司创造。');
    });
    expect(container.textContent).not.toContain('The answer could not be prepared. Try again.');
    expect(container.querySelector('[data-builder-conversation-notice="answer_failed"]')).toBeNull();
    expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value).toBe('');
    expect(submit).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
  });

  it('uses the started project id before live output state commits for a first recorded answer failure', async () => {
    const {
      answer,
      container,
      emitGenerationStartedWithoutAct,
      generate,
      readTaskStream,
      resolveAnswer,
      saveDraft,
      submit,
    } = await setup({
      deferredFailedFirstAnswer: true,
      failFirstAnswer: true,
      recordedFirstAnswerAfterFailedPublicResult: true,
    });

    const question = '你是什么大模型';
    setComposerInstruction(container, question);
    await waitForComposerSubmitReady(container);
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(answer).toHaveBeenCalledExactlyOnceWith({ instruction: question });
    });
    const request = await createBuilderGenerationRequest(question, null);

    await act(async () => {
      expect(emitGenerationStartedWithoutAct(request.request_digest, PROJECT_ID)).toBeGreaterThan(0);
      await resolveAnswer();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(readTaskStream).toHaveBeenCalledWith({ project_id: PROJECT_ID });
      expect(container.textContent).toContain('我是DeepSeek最新版本模型，由深度求索公司创造。');
    });
    expect(container.querySelector('[data-builder-live-output="true"]')).toBeNull();
    expect(container.textContent).not.toContain('The answer could not be prepared. Try again.');
    expect(container.querySelector('[data-builder-conversation-notice="answer_failed"]')).toBeNull();
    expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value).toBe('');
    expect(submit).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
  });

  it('does not keep provisional live answer text as a durable answer after terminal failure', async () => {
    const {
      answer,
      container,
      emitGenerationOutput,
      emitGenerationStarted,
      generate,
      resolveAnswer,
      saveDraft,
      submit,
    } = await setup({
      answerActivity: true,
      deferredFailedAnswerAfterFirst: true,
      failAnswerAfterFirst: true,
    });

    setComposerInstruction(container, 'hi');
    await waitForComposerSubmitReady(container);
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(answer).toHaveBeenCalledExactlyOnceWith({ instruction: 'hi' });
      expect(container.textContent).toContain('This answer does not change files.');
    });

    const question = '你是什么大模型';
    setComposerInstruction(container, question);
    await waitForComposerSubmitReady(container);
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(answer).toHaveBeenCalledTimes(2);
    });
    const request = await createBuilderGenerationRequest(question, PROJECT_ID);
    expect(emitGenerationStarted(request.request_digest, PROJECT_ID)).toBeGreaterThan(0);
    expect(emitGenerationOutput(request.request_digest, '我是 DeepSeek 模型。', PROJECT_ID)).toBeGreaterThan(0);

    await waitFor(() => {
      expect(container.querySelector('[data-builder-live-output="true"]')?.textContent)
        .toContain('我是 DeepSeek 模型。');
    });

    await act(async () => {
      await resolveAnswer();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(container.querySelector('[data-builder-conversation-notice="answer_failed"]')?.textContent)
        .toContain('The answer could not be prepared. Try again.');
      expect(container.querySelector('[data-builder-live-output="true"]')).toBeNull();
    });
    expect(container.textContent).toContain('This answer does not change files.');
    expect(container.textContent).not.toContain('我是 DeepSeek 模型。');
    expect(submit).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
  });

  it('continues a gated build turn after the user binds a source folder', async () => {
    const { container, createLocalProject, generate, listCurrent, saveDraft, submit } = await setup();
    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea');
    expect(textarea).not.toBeNull();
    act(() => {
      if (textarea) {
        const setter = Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          'value',
        )?.set;
        setter?.call(textarea, 'Make a timer.');
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(container.querySelector('[data-builder-workspace-picker="true"]')?.textContent)
        .toContain('Choose or create a project before I build.');
    });
    expect(createLocalProject).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(listCurrent.mock.results.at(-1)?.value).toBeInstanceOf(Promise);
    expect(container.querySelector('[data-builder-current-version="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();
    expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value).toBe('Make a timer.');
    let composer = container.querySelector('[data-builder-composer="true"]');
    expect(composer?.getAttribute('data-builder-route')).toBe('build');
    expect(composer?.getAttribute('data-builder-route-dispatch')).toBe('ask_workspace');
    expect(composer?.getAttribute('data-builder-route-decision-id')).
      toBe('builder-composer-route-decision:local:1');
    expect(composer?.getAttribute('data-builder-route-message-id')).
      toBe('builder-composer-message:local:1');
    expect(composer?.getAttribute('data-builder-route-project-id')).toBeNull();

    click(container, '[data-builder-workspace-new-project="true"]');
    await waitFor(() => {
      expect(container.querySelector('[data-builder-new-project-panel="true"]')?.textContent)
        .toContain('Source folders');
    });
    expect(createLocalProject).not.toHaveBeenCalled();

    const title = container.querySelector<HTMLInputElement>('[data-builder-new-project-title="true"]');
    expect(title?.value).toBe('New project');
    click(container, '[data-builder-add-source-folder="true"]');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(createLocalProject).toHaveBeenCalledExactlyOnceWith({
      project_id: null,
      project_title: 'New project',
    });
    await waitFor(() => {
      expect(submit).toHaveBeenCalledExactlyOnceWith({ instruction: 'Make a timer.' });
    });
    composer = container.querySelector('[data-builder-composer="true"]');
    expect(composer?.getAttribute('data-builder-route')).toBe('build');
    expect(composer?.getAttribute('data-builder-route-dispatch')).toBe('build');
    expect(composer?.getAttribute('data-builder-route-decision-id')).
      toBe('builder-composer-route-decision:local:2');
    expect(composer?.getAttribute('data-builder-route-message-id')).
      toBe('builder-composer-message:local:1');
    expect(composer?.getAttribute('data-builder-route-project-id')).toBe(PROJECT_ID);
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value).toBe('');
    await waitFor(() => {
      expect(container.querySelector('[data-builder-save-version="true"]')).not.toBeNull();
    });
  });

  it('shows live AI output for the first build after a source folder is bound', async () => {
    const {
      container,
      createLocalProject,
      emitGenerationOutput,
      emitGenerationStarted,
      resolveGenerate,
      submit,
    } = await setup({ deferredGenerate: true });
    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea');
    expect(textarea).not.toBeNull();
    act(() => {
      if (textarea) {
        const setter = Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          'value',
        )?.set;
        setter?.call(textarea, 'Make a timer.');
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    click(container, '[data-builder-submit-turn="true"]');
    await waitFor(() => {
      expect(container.querySelector('[data-builder-workspace-picker="true"]')?.textContent)
        .toContain('Choose or create a project before I build.');
    });

    click(container, '[data-builder-workspace-new-project="true"]');
    await waitFor(() => {
      expect(container.querySelector('[data-builder-new-project-panel="true"]')?.textContent)
        .toContain('Source folders');
    });
    click(container, '[data-builder-add-source-folder="true"]');

    await waitFor(() => {
      expect(createLocalProject).toHaveBeenCalledExactlyOnceWith({
        project_id: null,
        project_title: 'New project',
      });
      expect(submit).toHaveBeenCalledExactlyOnceWith({ instruction: 'Make a timer.' });
    });
    const expected = await createBuilderGenerationRequest('Make a timer.', PROJECT_ID);
    expect(emitGenerationStarted(expected.request_digest, PROJECT_ID)).toBeGreaterThan(0);
    expect(emitGenerationOutput(expected.request_digest, 'Building the first project draft.', PROJECT_ID))
      .toBeGreaterThan(0);

    await waitFor(() => {
      expect(container.querySelector('[data-builder-live-output="true"]')?.textContent)
        .toContain('Building the first project draft.');
    });
    expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value).toBe('');
    expect(container.querySelector('[data-builder-live-output="true"]')?.textContent)
      .not.toMatch(/request_id|provider|credential|source_tree|commit_oid|tree_oid/iu);

    await act(async () => {
      await resolveGenerate();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(container.querySelector('[data-builder-live-output="true"]')).toBeNull();
      expect(container.querySelector('[data-builder-save-version="true"]')).not.toBeNull();
    });
  });

  it('continues an unsaved draft from the same composer without saving first', async () => {
    const { container, continueDraft, generate, saveDraft, submit } = await setup({ initiallySaved: true });
    await openSavedProject(container);
    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea');
    expect(textarea).not.toBeNull();
    act(() => {
      if (textarea) {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
          ?.call(textarea, 'Make a timer.');
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    click(container, '[data-builder-submit-turn="true"]');
    await waitFor(() => {
      expect(container.querySelector('[data-builder-save-version="true"]')).not.toBeNull();
    });
    expect(submit).toHaveBeenCalledExactlyOnceWith({ instruction: 'Make a timer.' });
    expect(continueDraft).not.toHaveBeenCalled();
    expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.placeholder)
      .toBe('Ask about this draft, or describe the next change...');

    const draftTextarea = container.querySelector<HTMLTextAreaElement>('#builder-idea');
    act(() => {
      if (draftTextarea) {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
          ?.call(draftTextarea, 'Make it responsive.');
        draftTextarea.dispatchEvent(new Event('input', { bubbles: true }));
        draftTextarea.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(continueDraft).toHaveBeenCalledExactlyOnceWith({
        draft_id: expect.stringMatching(/^builder-generation-draft:/u),
        instruction: 'Make it responsive.',
      });
    });
    expect(submit).toHaveBeenCalledOnce();
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value).toBe('');
    await waitFor(() => {
      expect(container.querySelector('[data-builder-save-version="true"]')).not.toBeNull();
    });
  });

  it('does not keep a gated build pending after the workspace picker is closed', async () => {
    const { container, createLocalProject, generate, saveDraft, submit } = await setup();
    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea');
    expect(textarea).not.toBeNull();
    act(() => {
      if (textarea) {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
          ?.call(textarea, 'Make a timer.');
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(container.querySelector('[data-builder-workspace-picker="true"]')?.textContent)
        .toContain('Choose or create a project before I build.');
    });
    click(container, '[data-builder-workspace-chip="true"]');
    await waitFor(() => {
      expect(container.querySelector('[data-builder-workspace-picker="true"]')).toBeNull();
    });

    click(container, '[data-builder-workspace-chip="true"]');
    await waitFor(() => {
      expect(container.querySelector('[data-builder-workspace-picker="true"]')).not.toBeNull();
    });
    click(container, '[data-builder-workspace-new-project="true"]');
    await waitFor(() => {
      expect(container.querySelector('[data-builder-new-project-panel="true"]')).not.toBeNull();
    });
    click(container, '[data-builder-add-source-folder="true"]');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(createLocalProject).toHaveBeenCalledExactlyOnceWith({
      project_id: null,
      project_title: 'New project',
    });
    expect(submit).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value).toBe('Make a timer.');
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
  });

  it('does not submit edited composer text from the source folder action', async () => {
    const { container, createLocalProject, generate, saveDraft, submit } = await setup();
    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea');
    expect(textarea).not.toBeNull();
    act(() => {
      if (textarea) {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
          ?.call(textarea, 'Make a timer.');
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(container.querySelector('[data-builder-workspace-picker="true"]')?.textContent)
        .toContain('Choose or create a project before I build.');
    });
    act(() => {
      if (textarea) {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
          ?.call(textarea, 'Make a clock.');
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    click(container, '[data-builder-workspace-new-project="true"]');
    await waitFor(() => {
      expect(container.querySelector('[data-builder-new-project-panel="true"]')).not.toBeNull();
    });
    click(container, '[data-builder-add-source-folder="true"]');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(createLocalProject).toHaveBeenCalledExactlyOnceWith({
      project_id: null,
      project_title: 'New project',
    });
    expect(submit).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value).toBe('Make a clock.');
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
  });

  it('auto-opens a single bound unsaved workspace after restart', async () => {
    const { container, createLocalProject, listCurrent, listWorkspaces, open, submit } = await setup({
      workspaceOnlyCatalog: true,
    });

    await waitFor(() => {
      expect(listCurrent).toHaveBeenCalled();
      expect(listWorkspaces).toHaveBeenCalled();
      expect(open).toHaveBeenCalledWith({ project_id: PROJECT_ID });
      expect(container.querySelector('[data-builder-workspace-chip="true"]')?.textContent)
        .toContain('Unsaved dashboard');
      expect(container.querySelector('[data-builder-workspace-chip="true"]')?.textContent)
        .toContain('site-source');
    });

    expect(createLocalProject).not.toHaveBeenCalled();
    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea');
    act(() => {
      if (textarea) {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
          ?.call(textarea, 'Make a timer.');
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(submit).toHaveBeenCalledOnce();
    });
  });

  it('restores a pending draft after auto-opening a single unsaved workspace', async () => {
    const { container, listCurrent, listWorkspaces, open, readTaskStream, restoreDraft, saveDraft } = await setup({
      pendingActivity: true,
      restoreAvailable: true,
      workspaceOnlyCatalog: true,
    });

    await waitFor(() => {
      expect(listCurrent).toHaveBeenCalled();
      expect(listWorkspaces).toHaveBeenCalled();
      expect(open).toHaveBeenCalledWith({ project_id: PROJECT_ID });
    });
    await waitFor(() => {
      expect(readTaskStream).toHaveBeenCalledWith({ project_id: PROJECT_ID });
      expect(restoreDraft).toHaveBeenCalledExactlyOnceWith({
        draft_id: expect.stringMatching(/^builder-generation-draft:/u),
      });
      expect(container.querySelector('[data-builder-unsaved-draft="true"]')).not.toBeNull();
    });
    expect(container.querySelector('[data-builder-current-version="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-workspace-chip="true"]')?.textContent)
      .toContain('Unsaved dashboard');
    expect(container.querySelector('[data-builder-save-version="true"]')).not.toBeNull();
    expect(saveDraft).not.toHaveBeenCalled();
  });

  it('opens an existing bound workspace from a gated build without auto-submit', async () => {
    const { container, createLocalProject, listCurrent, listWorkspaces, open, submit } = await setup({
      multipleWorkspaceOnlyCatalog: true,
    });

    await waitFor(() => {
      expect(listCurrent).toHaveBeenCalled();
      expect(listWorkspaces).toHaveBeenCalled();
    });
    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea');
    expect(textarea).not.toBeNull();
    act(() => {
      if (textarea) {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
          ?.call(textarea, 'Make a timer.');
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(container.querySelector('[data-builder-workspace-picker="true"]')?.textContent)
        .toContain('Choose or create a project before I build.');
      expect(container.querySelector('[data-builder-workspace-picker="true"]')?.textContent)
        .toContain('Unsaved dashboard');
    });
    click(container, `[data-builder-workspace-bound-project="${PROJECT_ID}"]`);

    await waitFor(() => {
      expect(open).toHaveBeenCalledWith({ project_id: PROJECT_ID });
      expect(container.querySelector('[data-builder-workspace-chip="true"]')?.textContent)
        .toContain('Unsaved dashboard');
    });
    expect(createLocalProject).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value).toBe('Make a timer.');
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
  });

  it('keeps chat-first project identity when a later build turn binds source folders', async () => {
    const { answer, container, createLocalProject, generate, saveDraft, submit } = await setup({
      answerActivity: true,
    });
    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea');
    expect(textarea).not.toBeNull();
    act(() => {
      if (textarea) {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
          ?.call(textarea, 'hi');
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(answer).toHaveBeenCalledExactlyOnceWith({ instruction: 'hi' });
    });
    expect(submit).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value).toBe('');
    await waitFor(() => {
      expect(container.querySelector<HTMLButtonElement>('[data-builder-submit-turn="true"]')).not.toBeNull();
    });

    const buildTextarea = container.querySelector<HTMLTextAreaElement>('#builder-idea');
    expect(buildTextarea).not.toBeNull();
    act(() => {
      if (buildTextarea) {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
          ?.call(buildTextarea, 'Make a timer.');
        buildTextarea.dispatchEvent(new Event('input', { bubbles: true }));
        buildTextarea.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    await waitFor(() => {
      expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value)
        .toBe('Make a timer.');
    });
    const send = container.querySelector<HTMLButtonElement>('[data-builder-submit-turn="true"]');
    expect(send?.disabled).toBe(false);
    act(() => send?.click());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(answer).toHaveBeenCalledOnce();
    expect(submit).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(container.querySelector('[data-builder-workspace-picker="true"]')?.textContent)
        .toContain('Choose or create a project before I build.');
    });
    expect(createLocalProject).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();

    click(container, '[data-builder-workspace-new-project="true"]');
    await waitFor(() => {
      expect(container.querySelector('[data-builder-new-project-panel="true"]')?.textContent)
        .toContain('Source folders');
    });
    click(container, '[data-builder-add-source-folder="true"]');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(createLocalProject).toHaveBeenCalledExactlyOnceWith({
      project_id: PROJECT_ID,
      project_title: 'New project',
    });
    await waitFor(() => {
      expect(submit).toHaveBeenCalledExactlyOnceWith({ instruction: 'Make a timer.' });
    });
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value).toBe('');
    await waitFor(() => {
      expect(container.querySelector('[data-builder-save-version="true"]')).not.toBeNull();
    });
  });

  it('routes clear Chinese edit turns to the project picker before any draft work', async () => {
    const { answer, container, createLocalProject, generate, saveDraft, submit } = await setup();
    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea');
    expect(textarea).not.toBeNull();
    act(() => {
      if (textarea) {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
          ?.call(textarea, '把按钮颜色改红');
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });

    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(container.querySelector('[data-builder-workspace-picker="true"]')?.textContent)
        .toContain('Choose or create a project before I build.');
    });
    expect(answer).not.toHaveBeenCalled();
    expect(createLocalProject).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
    expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value)
      .toBe('把按钮颜色改红');
  });

  it('routes clear Chinese 3D build turns to submit once a workspace is bound', async () => {
    const { answer, container, createLocalProject, generate, saveDraft, submit } = await setup({
      initiallySaved: true,
    });
    await openSavedProject(container);
    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea');
    expect(textarea).not.toBeNull();
    act(() => {
      if (textarea) {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
          ?.call(textarea, '帮我做一个网页3D');
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });

    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(submit).toHaveBeenCalledExactlyOnceWith({ instruction: '帮我做一个网页3D' });
    });
    expect(answer).not.toHaveBeenCalled();
    expect(createLocalProject).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(container.querySelector('[data-builder-workspace-picker="true"]')).toBeNull();
    expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value).toBe('');
    await waitFor(() => {
      expect(container.querySelector('[data-builder-save-version="true"]')).not.toBeNull();
    });
  });

  it('asks for current-project write approval before a selected workspace build can start', async () => {
    const {
      approveCurrentProjectWrite,
      container,
      generate,
      prepareCurrentProjectWriteApproval,
      saveDraft,
      submit,
    } = await setup({
      currentProjectWriteApprovalRequired: true,
      initiallySaved: true,
    });
    await openSavedProject(container);
    setComposerInstruction(container, 'Make a timer.');
    await waitForComposerSubmitReady(container);

    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(prepareCurrentProjectWriteApproval).toHaveBeenCalledExactlyOnceWith({
        project_id: PROJECT_ID,
      });
      expect(container.querySelector('[data-builder-current-project-write-approval="true"]')?.textContent)
        .toContain('Allow current project changes?');
    });
    expect(submit).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value).toBe('');
    const composer = container.querySelector('[data-builder-composer="true"]');
    expect(composer?.getAttribute('data-builder-route')).toBe('build');
    expect(composer?.getAttribute('data-builder-route-dispatch')).toBe('ask_permission');
    expect(composer?.getAttribute('data-builder-route-permission')).toBe('ask');

    click(container, 'Allow and continue');

    await waitFor(() => {
      expect(approveCurrentProjectWrite).toHaveBeenCalledExactlyOnceWith({ project_id: PROJECT_ID });
      expect(submit).toHaveBeenCalledExactlyOnceWith({ instruction: 'Make a timer.' });
      expect(container.querySelector('[data-builder-current-project-write-approval="true"]')).toBeNull();
      expect(container.querySelector('[data-builder-save-version="true"]')).not.toBeNull();
    });
    expect(JSON.stringify(approveCurrentProjectWrite.mock.calls)).not.toMatch(
      /resource_id|permission_id|source_tree|credential|provider/iu,
    );
  });

  it('continues a pending build when Allow current project is selected from the composer menu', async () => {
    const {
      approveCurrentProjectWrite,
      container,
      generate,
      prepareCurrentProjectWriteApproval,
      saveDraft,
      submit,
    } = await setup({
      currentProjectWriteApprovalRequired: true,
      initiallySaved: true,
    });
    await openSavedProject(container);
    setComposerInstruction(container, 'Make a timer.');
    await waitForComposerSubmitReady(container);

    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(container.querySelector('[data-builder-current-project-write-approval="true"]')?.textContent)
        .toContain('Allow current project changes?');
      expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value).toBe('');
    });

    click(container, '[data-builder-composer-add-menu-button="true"]');
    click(container, '[data-builder-composer-approval-mode-option="allow_current_project"]');

    await waitFor(() => {
      expect(approveCurrentProjectWrite).toHaveBeenCalledExactlyOnceWith({ project_id: PROJECT_ID });
      expect(submit).toHaveBeenCalledExactlyOnceWith({ instruction: 'Make a timer.' });
      expect(container.querySelector('[data-builder-current-project-write-approval="true"]')).toBeNull();
      expect(container.querySelector('[data-builder-approval-mode-chip="true"]')).toBeNull();
      expect(container.querySelector('[data-builder-save-version="true"]')).not.toBeNull();
    });
    expect(prepareCurrentProjectWriteApproval).toHaveBeenCalledTimes(2);
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
  });

  it('restores the build request to the composer when current-project write approval is dismissed', async () => {
    const {
      approveCurrentProjectWrite,
      container,
      generate,
      prepareCurrentProjectWriteApproval,
      saveDraft,
      submit,
    } = await setup({
      currentProjectWriteApprovalRequired: true,
      initiallySaved: true,
    });
    await openSavedProject(container);
    setComposerInstruction(container, 'Make a timer.');
    await waitForComposerSubmitReady(container);

    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(container.querySelector('[data-builder-current-project-write-approval="true"]')?.textContent)
        .toContain('Allow current project changes?');
      expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value).toBe('');
    });

    click(container, 'Not now');

    await waitFor(() => {
      expect(container.querySelector('[data-builder-current-project-write-approval="true"]')).toBeNull();
      expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value).toBe('Make a timer.');
    });
    expect(prepareCurrentProjectWriteApproval).toHaveBeenCalledExactlyOnceWith({
      project_id: PROJECT_ID,
    });
    expect(approveCurrentProjectWrite).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
  });

  it('keeps explicit build requests in chat while read-only approval mode is selected', async () => {
    const {
      answer,
      approveCurrentProjectWrite,
      container,
      generate,
      prepareCurrentProjectWriteApproval,
      saveDraft,
      submit,
    } = await setup({
      initiallySaved: true,
    });
    await openSavedProject(container);

    click(container, '[data-builder-composer-add-menu-button="true"]');
    click(container, '[data-builder-composer-approval-mode-option="read_only_chat"]');

    expect(container.querySelector('[data-builder-approval-mode-chip="true"]')).toBeNull();

    setComposerInstruction(container, 'Make a timer.');
    await waitForComposerSubmitReady(container);
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(answer).toHaveBeenCalledExactlyOnceWith({ instruction: 'Make a timer.' });
    });
    expect(submit).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(prepareCurrentProjectWriteApproval).not.toHaveBeenCalled();
    expect(approveCurrentProjectWrite).not.toHaveBeenCalled();
    expect(container.querySelector('[data-builder-current-project-write-approval="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
    const composer = container.querySelector('[data-builder-composer="true"]');
    expect(composer?.getAttribute('data-builder-route')).toBe('build');
    expect(composer?.getAttribute('data-builder-route-dispatch')).toBe('blocked');
    expect(composer?.getAttribute('data-builder-route-permission')).toBe('denied');
  });

  it('records allow-current-project mode through main approval before a build', async () => {
    const {
      answer,
      approveCurrentProjectWrite,
      container,
      generate,
      prepareCurrentProjectWriteApproval,
      saveDraft,
      submit,
    } = await setup({
      currentProjectWriteApprovalRequired: true,
      initiallySaved: true,
    });
    await openSavedProject(container);

    click(container, '[data-builder-composer-add-menu-button="true"]');
    click(container, '[data-builder-composer-approval-mode-option="allow_current_project"]');

    await waitFor(() => {
      expect(approveCurrentProjectWrite).toHaveBeenCalledExactlyOnceWith({ project_id: PROJECT_ID });
      expect(container.querySelector('[data-builder-approval-mode-chip="true"]')).toBeNull();
    });

    setComposerInstruction(container, 'Make a timer.');
    await waitForComposerSubmitReady(container);
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(prepareCurrentProjectWriteApproval).toHaveBeenCalledExactlyOnceWith({
        project_id: PROJECT_ID,
      });
      expect(submit).toHaveBeenCalledExactlyOnceWith({ instruction: 'Make a timer.' });
    });
    expect(answer).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(container.querySelector('[data-builder-current-project-write-approval="true"]')).toBeNull();
    const composer = container.querySelector('[data-builder-composer="true"]');
    expect(composer?.getAttribute('data-builder-route')).toBe('build');
    expect(composer?.getAttribute('data-builder-route-dispatch')).toBe('build');
    expect(composer?.getAttribute('data-builder-route-permission')).toBe('allowed');
    expect(JSON.stringify(approveCurrentProjectWrite.mock.calls)).not.toMatch(
      /resource_id|permission_id|source_tree|credential|provider/iu,
    );
  });

  it('keeps exploratory workspace turns in chat after a source folder is bound', async () => {
    const { answer, container, createLocalProject, generate, saveDraft, submit } = await setup({
      answerActivity: true,
      initiallySaved: true,
    });
    await openSavedProject(container);

    for (const instruction of [
      '我想先聊一下这个页面怎么做',
      '我们先确定风格',
      '我打算做一个周杰伦相关的网站，帮我出下方案',
      '我想创建一个登录页，你觉得怎么设计',
      '可以帮我做一个登录页吗？',
      'Can you build a login page?',
      'Should we create a dashboard first?',
      '这里字都重叠了',
      '右侧内容挤坏了',
    ]) {
      const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea');
      expect(textarea).not.toBeNull();
      act(() => {
        if (textarea) {
          Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
            ?.call(textarea, instruction);
          textarea.dispatchEvent(new Event('input', { bubbles: true }));
          textarea.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
      await waitFor(() => {
        expect(container.querySelector<HTMLButtonElement>('[data-builder-submit-turn="true"]')?.disabled)
          .toBe(false);
      });

      click(container, '[data-builder-submit-turn="true"]');

      await waitFor(() => {
        expect(answer).toHaveBeenCalledExactlyOnceWith({ instruction });
      });
      expect(submit).not.toHaveBeenCalled();
      expect(createLocalProject).not.toHaveBeenCalled();
      expect(generate).not.toHaveBeenCalled();
      expect(saveDraft).not.toHaveBeenCalled();
      expect(container.querySelector('[data-builder-workspace-picker="true"]')).toBeNull();
      expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();
      expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
      expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value).toBe('');
      answer.mockClear();
    }
  });

  it('keeps exploratory product intent in read-only chat after a workspace is selected', async () => {
    const { answer, container, createLocalProject, generate, saveDraft, submit } = await setup({
      briefUpdateActivity: true,
      initiallySaved: true,
    });
    await openSavedProject(container);

    setComposerInstruction(container, '我想做一个登录页');
    await waitForComposerSubmitReady(container);
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(answer).toHaveBeenCalledExactlyOnceWith({ instruction: '我想做一个登录页' });
    });
    expect(submit).not.toHaveBeenCalled();
    expect(createLocalProject).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(container.querySelector('[data-builder-current-project-write-approval="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-workspace-picker="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
    const composer = container.querySelector('[data-builder-composer="true"]');
    expect(composer?.getAttribute('data-builder-route')).toBe('update_brief');
    expect(composer?.getAttribute('data-builder-route-dispatch')).toBe('brief_update');
    expect(composer?.getAttribute('data-builder-route-task-id')).toBeNull();
    expect(container.querySelector('[data-builder-composer-brief="true"]')).toBeNull();
    expect(container.textContent).not.toContain('Current brief');
    expect(container.textContent).not.toContain('星空背景');
  });

  it('does not treat future Goal mode requests as current build or brief authority', async () => {
    const { answer, container, createLocalProject, generate, saveDraft, submit } = await setup({
      answerActivity: true,
      initiallySaved: true,
    });
    await openSavedProject(container);

    setComposerInstruction(container, '进入目标模式，一直帮我改到完成为止');
    await waitForComposerSubmitReady(container);
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(answer).toHaveBeenCalledExactlyOnceWith({
        instruction: '进入目标模式，一直帮我改到完成为止',
      });
    });
    expect(submit).not.toHaveBeenCalled();
    expect(createLocalProject).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(container.querySelector('[data-builder-current-project-write-approval="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-workspace-picker="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
    const composer = container.querySelector('[data-builder-composer="true"]');
    expect(composer?.getAttribute('data-builder-route')).toBe('clarify');
    expect(composer?.getAttribute('data-builder-route-dispatch')).toBe('reply');
    expect(composer?.getAttribute('data-builder-route-permission')).toBe('not_required');
    expect(composer?.getAttribute('data-builder-route-signals')).toBe('goal_mode_request');
  });

  it('keeps Brief menu updates on the read-only task capsule path', async () => {
    const { answer, container, createLocalProject, generate, saveDraft, submit } = await setup({
      briefUpdateActivity: true,
      initiallySaved: true,
    });
    await openSavedProject(container);

    setComposerInstruction(container, '目标用户是小团队，视觉要克制');
    click(container, '[data-builder-composer-add-menu-button="true"]');
    click(container, '[data-builder-composer-add-brief="true"]');

    const scaffolded = '保存这个方向，后面按这个来：目标用户是小团队，视觉要克制';
    expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value).toBe(scaffolded);
    await waitForComposerSubmitReady(container);
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(answer).toHaveBeenCalledExactlyOnceWith({ instruction: scaffolded });
    });
    expect(submit).not.toHaveBeenCalled();
    expect(createLocalProject).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(container.querySelector('[data-builder-current-project-write-approval="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
    const composer = container.querySelector('[data-builder-composer="true"]');
    expect(composer?.getAttribute('data-builder-route')).toBe('update_brief');
    expect(composer?.getAttribute('data-builder-route-dispatch')).toBe('brief_update');
    expect(composer?.getAttribute('data-builder-route-signals')).toBe('explicit_brief');
    expect(container.querySelector('[data-builder-composer-brief="true"]')).toBeNull();
    expect(container.textContent).not.toContain('Current brief');
  });

  it('projects the latest route decision for chat, brief update, and admitted build turns', async () => {
    const { answer, container, submit } = await setup({
      briefUpdateActivity: true,
      initiallySaved: true,
    });
    await openSavedProject(container);

    setComposerInstruction(container, 'hi');
    await waitForComposerSubmitReady(container);
    click(container, '[data-builder-submit-turn="true"]');
    await waitFor(() => {
      expect(answer).toHaveBeenCalledExactlyOnceWith({ instruction: 'hi' });
    });
    let composer = container.querySelector('[data-builder-composer="true"]');
    expect(composer?.getAttribute('data-builder-route')).toBe('answer');
    expect(composer?.getAttribute('data-builder-route-dispatch')).toBe('reply');
    expect(composer?.getAttribute('data-builder-route-permission')).toBe('not_required');
    expect(composer?.getAttribute('data-builder-route-signals')).toBe('read_only');
    expect(composer?.getAttribute('data-builder-route-decision-id')).
      toBe('builder-composer-route-decision:local:1');
    expect(composer?.getAttribute('data-builder-route-message-id')).
      toBe('builder-composer-message:local:1');
    expect(composer?.getAttribute('data-builder-route-project-id')).toBe(PROJECT_ID);
    expect(composer?.getAttribute('data-builder-route-task-id')).toBeNull();
    expect(composer?.getAttribute('data-builder-route-created-at')).
      toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u);

    answer.mockClear();
    setComposerInstruction(container, '我想做一个登录页');
    await waitForComposerSubmitReady(container);
    click(container, '[data-builder-submit-turn="true"]');
    await waitFor(() => {
      expect(answer).toHaveBeenCalledExactlyOnceWith({ instruction: '我想做一个登录页' });
    });
    expect(submit).not.toHaveBeenCalled();
    composer = container.querySelector('[data-builder-composer="true"]');
    expect(composer?.getAttribute('data-builder-route')).toBe('update_brief');
    expect(composer?.getAttribute('data-builder-route-dispatch')).toBe('brief_update');
    expect(composer?.getAttribute('data-builder-route-permission')).toBe('not_required');
    expect(composer?.getAttribute('data-builder-route-signals')).toBe('exploratory_work');
    expect(composer?.getAttribute('data-builder-route-decision-id')).
      toBe('builder-composer-route-decision:local:2');
    expect(composer?.getAttribute('data-builder-route-message-id')).
      toBe('builder-composer-message:local:2');
    expect(composer?.getAttribute('data-builder-route-project-id')).toBe(PROJECT_ID);
    expect(composer?.getAttribute('data-builder-route-task-id')).toBeNull();
    expect(container.querySelector('[data-builder-composer-brief="true"]')).toBeNull();
    answer.mockClear();

    setComposerInstruction(container, '把按钮颜色改红');
    await waitForComposerSubmitReady(container);
    click(container, '[data-builder-submit-turn="true"]');
    await waitFor(() => {
      expect(submit).toHaveBeenCalledExactlyOnceWith({ instruction: '把按钮颜色改红' });
    });
    composer = container.querySelector('[data-builder-composer="true"]');
    expect(composer?.getAttribute('data-builder-route')).toBe('build');
    expect(composer?.getAttribute('data-builder-route-dispatch')).toBe('build');
    expect(composer?.getAttribute('data-builder-route-permission')).toBe('allowed');
    expect(composer?.getAttribute('data-builder-route-signals')).toBe('clear_build');
    expect(composer?.getAttribute('data-builder-route-decision-id')).
      toBe('builder-composer-route-decision:local:3');
    expect(composer?.getAttribute('data-builder-route-message-id')).
      toBe('builder-composer-message:local:3');
    expect(composer?.getAttribute('data-builder-route-project-id')).toBe(PROJECT_ID);
    expect(composer?.getAttribute('data-builder-route-task-id')).toBe(PENDING_TASK_ID);
  });

  it('builds from a contextual execution phrase only after prior discussion creates work context', async () => {
    const { answer, container, createLocalProject, generate, saveDraft, submit } = await setup({
      contextualBuildActivity: true,
      initiallySaved: true,
    });
    await openSavedProject(container);
    await waitFor(() => {
      expect(container.textContent).toContain('作品集首页');
      expect(container.querySelector('[data-builder-composer-status="true"]')).toBeNull();
    });
    expect(container.textContent).not.toMatch(/working_brief|recent_chat_proposal|builder-conversation/iu);

    const discussionTextarea = container.querySelector<HTMLTextAreaElement>('#builder-idea');
    expect(discussionTextarea).not.toBeNull();
    act(() => {
      if (discussionTextarea) {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
          ?.call(discussionTextarea, '我想先聊一下这个页面怎么做');
        discussionTextarea.dispatchEvent(new Event('input', { bubbles: true }));
        discussionTextarea.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    await waitFor(() => {
      expect(container.querySelector<HTMLButtonElement>('[data-builder-submit-turn="true"]')?.disabled)
        .toBe(false);
    });
    click(container, '[data-builder-submit-turn="true"]');
    await waitFor(() => {
      expect(answer).toHaveBeenCalledExactlyOnceWith({ instruction: '我想先聊一下这个页面怎么做' });
    });
    expect(submit).not.toHaveBeenCalled();

    const executeTextarea = container.querySelector<HTMLTextAreaElement>('#builder-idea');
    expect(executeTextarea).not.toBeNull();
    act(() => {
      if (executeTextarea) {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
          ?.call(executeTextarea, '按刚才方案做');
        executeTextarea.dispatchEvent(new Event('input', { bubbles: true }));
        executeTextarea.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    await waitFor(() => {
      expect(container.querySelector<HTMLButtonElement>('[data-builder-submit-turn="true"]')?.disabled)
        .toBe(false);
    });
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(submit).toHaveBeenCalledExactlyOnceWith({ instruction: '按刚才方案做' });
    });
    expect(answer).toHaveBeenCalledOnce();
    expect(createLocalProject).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(container.querySelector('[data-builder-workspace-picker="true"]')).toBeNull();
    expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value).toBe('');
  });

  it('builds from natural Chinese rewrite shortcuts when current result context exists', async () => {
    const { answer, container, createLocalProject, generate, saveDraft, submit } = await setup({
      contextualBuildActivity: true,
      initiallySaved: true,
    });
    await openSavedProject(container);
    await waitFor(() => {
      expect(container.querySelector('[data-builder-composer-status="true"]')).toBeNull();
    });
    expect(container.querySelector('[data-builder-composer-brief="true"]')).toBeNull();

    setComposerInstruction(container, '那就写');
    await waitForComposerSubmitReady(container);
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(submit).toHaveBeenCalledExactlyOnceWith({ instruction: '那就写' });
    });
    expect(answer).not.toHaveBeenCalled();
    expect(createLocalProject).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    const composer = container.querySelector('[data-builder-composer="true"]');
    expect(composer?.getAttribute('data-builder-route')).toBe('build');
    expect(composer?.getAttribute('data-builder-route-dispatch')).toBe('build');
    expect(composer?.getAttribute('data-builder-route-signals')).toBe('contextual_build_phrase');
    expect(composer?.getAttribute('data-builder-route-task-id')).toBe(PENDING_TASK_ID);
  });

  it('keeps current brief memory hidden before contextual execution', async () => {
    const { answer, container, createLocalProject, generate, saveDraft, submit } = await setup({
      contextualBuildActivity: true,
      initiallySaved: true,
    });
    await openSavedProject(container);
    await waitFor(() => {
      expect(container.querySelector('[data-builder-composer-status="true"]')).toBeNull();
    });
    expect(container.querySelector('[data-builder-composer-brief="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-clear-composer-brief="true"]')).toBeNull();
    const composer = container.querySelector('[data-builder-composer="true"]');
    expect(composer?.textContent).not.toContain('Current brief');
    expect(composer?.textContent).not.toContain('星空背景');
    expect(composer?.textContent).not.toContain('项目卡片');
    expect(composer?.textContent)
      .not.toMatch(/working_brief|recent_chat_proposal|builder-conversation|sha256:|provider|credential|source_tree|receipt/iu);

    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea');
    expect(textarea).not.toBeNull();
    act(() => {
      if (textarea) {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
          ?.call(textarea, '按刚才方案做');
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(submit).toHaveBeenCalledExactlyOnceWith({ instruction: '按刚才方案做' });
    });
    expect(answer).not.toHaveBeenCalled();
    expect(createLocalProject).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
  });

  it('routes contextual execution phrases to the project picker before a workspace is bound', async () => {
    const { answer, container, createLocalProject, generate, saveDraft, submit } = await setup({
      contextualBuildActivity: true,
    });
    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea');
    expect(textarea).not.toBeNull();
    act(() => {
      if (textarea) {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
          ?.call(textarea, '这个方案是什么');
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(answer).toHaveBeenCalledExactlyOnceWith({ instruction: '这个方案是什么' });
      expect(container.textContent).toContain('作品集首页');
    });

    const executionTextarea = container.querySelector<HTMLTextAreaElement>('#builder-idea');
    expect(executionTextarea).not.toBeNull();
    act(() => {
      if (executionTextarea) {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
          ?.call(executionTextarea, '就这样做');
        executionTextarea.dispatchEvent(new Event('input', { bubbles: true }));
        executionTextarea.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(container.querySelector('[data-builder-workspace-picker="true"]')?.textContent)
        .toContain('Choose or create a project before I build.');
    });
    expect(answer).toHaveBeenCalledOnce();
    expect(createLocalProject).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
    expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value).toBe('就这样做');
  });

  it('keeps execution phrases in chat after explanatory page questions without a proposal', async () => {
    const { answer, container, createLocalProject, generate, saveDraft, submit } = await setup({
      initiallySaved: true,
      readOnlyPageQuestionActivity: true,
    });
    await openSavedProject(container);
    await waitFor(() => {
      expect(container.textContent).toContain('为什么这个页面预览空白？');
    });
    expect(container.querySelector('[data-builder-composer-status="true"]')).toBeNull();
    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea');
    expect(textarea).not.toBeNull();
    act(() => {
      if (textarea) {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
          ?.call(textarea, '开始吧');
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });

    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(answer).toHaveBeenCalledExactlyOnceWith({ instruction: '开始吧' });
    });
    expect(submit).not.toHaveBeenCalled();
    expect(createLocalProject).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(container.querySelector('[data-builder-workspace-picker="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
    expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value).toBe('');
  });

  it('routes natural approval phrases to submit once a workspace is bound', async () => {
    const { answer, container, createLocalProject, generate, saveDraft, submit } = await setup({
      contextualBuildActivity: true,
      initiallySaved: true,
    });
    await openSavedProject(container);
    await waitFor(() => {
      expect(container.textContent).toContain('作品集首页');
    });
    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea');
    expect(textarea).not.toBeNull();
    act(() => {
      if (textarea) {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
          ?.call(textarea, '好，开始吧');
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });

    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(submit).toHaveBeenCalledExactlyOnceWith({ instruction: '好，开始吧' });
    });
    expect(answer).not.toHaveBeenCalled();
    expect(createLocalProject).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(container.querySelector('[data-builder-workspace-picker="true"]')).toBeNull();
    expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value).toBe('');
    await waitFor(() => {
      expect(container.querySelector('[data-builder-save-version="true"]')).not.toBeNull();
    });
  });

  it('routes current result defect feedback to submit only when prior work context exists', async () => {
    const { answer, container, createLocalProject, generate, saveDraft, submit } = await setup({
      contextualBuildActivity: true,
      initiallySaved: true,
    });
    await openSavedProject(container);
    await waitFor(() => {
      expect(container.textContent).toContain('作品集首页');
      expect(container.querySelector('[data-builder-composer-status="true"]')).toBeNull();
    });
    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea');
    expect(textarea).not.toBeNull();
    act(() => {
      if (textarea) {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
          ?.call(textarea, '这里字都重叠了');
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });

    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(submit).toHaveBeenCalledExactlyOnceWith({ instruction: '这里字都重叠了' });
    });
    expect(answer).not.toHaveBeenCalled();
    expect(createLocalProject).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(container.querySelector('[data-builder-workspace-picker="true"]')).toBeNull();
    expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value).toBe('');
  });

  it('approves a pending plan from a contextual execution phrase through review authority', async () => {
    const {
      answer,
      container,
      createLocalProject,
      generate,
      generateApprovedPlan,
      reviewPlan,
      saveDraft,
      submit,
    } = await setup({
      initiallySaved: true,
      pendingPlanActivity: true,
    });
    await openSavedProject(container);
    await waitFor(() => {
      expect(container.querySelector('[data-builder-plan-review-actions="true"]')).not.toBeNull();
    });
    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea');
    expect(textarea).not.toBeNull();
    act(() => {
      if (textarea) {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
          ?.call(textarea, '按这个做');
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });

    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(reviewPlan).toHaveBeenCalledExactlyOnceWith({
        project_id: PROJECT_ID,
        conversation_id: `builder-conversation:${PROJECT_ID.slice('builder-project:'.length)}`,
        turn_id: 'builder-turn:123e4567-e89b-42d3-a456-426614174000',
        run_id: 'builder-run:123e4567-e89b-42d3-a456-426614174000',
        decision: 'approved',
      });
      expect(generateApprovedPlan).toHaveBeenCalledExactlyOnceWith({
        project_id: PROJECT_ID,
        conversation_id: `builder-conversation:${PROJECT_ID.slice('builder-project:'.length)}`,
        turn_id: 'builder-turn:123e4567-e89b-42d3-a456-426614174000',
        run_id: 'builder-run:123e4567-e89b-42d3-a456-426614174000',
      });
    });
    expect(answer).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    expect(createLocalProject).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(container.querySelector('[data-builder-workspace-picker="true"]')).toBeNull();
    await waitFor(() => {
      expect(container.querySelector('[data-builder-unsaved-draft="true"]')).not.toBeNull();
      expect(container.querySelector('[data-builder-save-version="true"]')).not.toBeNull();
    });
    expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value).toBe('');
  });

  it('does not revive a rejected plan with a contextual execution phrase', async () => {
    const { answer, container, createLocalProject, generate, reviewPlan, saveDraft, submit } = await setup({
      initiallySaved: true,
      rejectedPlanActivity: true,
    });
    await openSavedProject(container);
    await waitFor(() => {
      expect(container.querySelector('[data-builder-activity-card="Plan rejected"]')?.textContent)
        .toContain('The plan was rejected. The project has not changed.');
    });
    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea');
    expect(textarea).not.toBeNull();
    act(() => {
      if (textarea) {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
          ?.call(textarea, '按这个做');
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });

    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(answer).toHaveBeenCalledExactlyOnceWith({ instruction: '按这个做' });
    });
    expect(reviewPlan).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    expect(createLocalProject).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(container.querySelector('[data-builder-workspace-picker="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
  });

  it('keeps one composer turn editable and retryable after submit failure', async () => {
    const { container, generate, readTaskStream, retry, saveDraft, submit } = await setup({
      failSubmitOnce: true,
      initiallySaved: true,
    });
    await openSavedProject(container);
    await waitFor(() => {
      expect(readTaskStream).toHaveBeenCalledWith({ project_id: PROJECT_ID });
    });
    readTaskStream.mockClear();
    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
        ?.call(textarea, 'Make a timer.');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.dispatchEvent(new Event('change', { bubbles: true }));
    });
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(container.querySelector('[data-builder-conversation-notice="submit_failed"]')?.textContent)
        .toContain('The AI service could not complete this request.');
    });
    expect(container.querySelector('[data-builder-retry-draft="true"]')).not.toBeNull();
    expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value)
      .toBe('Make a timer.');

    click(container, '[data-builder-retry-draft="true"]');

    await waitFor(() => {
      expect(container.querySelector('[data-builder-unsaved-draft="true"]')).not.toBeNull();
    });
    expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value).toBe('');
    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit.mock.calls[0][0]).toEqual({ instruction: 'Make a timer.' });
    expect(submit.mock.calls[1][0]).toEqual({ instruction: 'Make a timer.' });
    expect(generate).not.toHaveBeenCalled();
    expect(retry).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(readTaskStream).toHaveBeenCalledWith({ project_id: PROJECT_ID });
  });

  it('starts a different composer turn after submit failure without using retry', async () => {
    const { container, generate, readTaskStream, retry, saveDraft, submit } = await setup({
      failSubmitOnce: true,
      initiallySaved: true,
    });
    await openSavedProject(container);
    await waitFor(() => {
      expect(readTaskStream).toHaveBeenCalledWith({ project_id: PROJECT_ID });
    });
    readTaskStream.mockClear();
    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
        ?.call(textarea, 'Make a timer.');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.dispatchEvent(new Event('change', { bubbles: true }));
    });
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(container.querySelector('[data-builder-retry-draft="true"]')).not.toBeNull();
    });
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
        ?.call(textarea, 'Make a different timer.');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.dispatchEvent(new Event('change', { bubbles: true }));
    });
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(container.querySelector('[data-builder-unsaved-draft="true"]')).not.toBeNull();
    });
    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit.mock.calls[0][0]).toEqual({ instruction: 'Make a timer.' });
    expect(submit.mock.calls[1][0]).toEqual({ instruction: 'Make a different timer.' });
    expect(generate).not.toHaveBeenCalled();
    expect(retry).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(readTaskStream).toHaveBeenCalledWith({ project_id: PROJECT_ID });
    expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value).toBe('');
    expect(container.textContent).not.toMatch(/request_digest|existing_project_id|provider|credential/iu);
  });

  it('cancels active draft generation through request-id-only control', async () => {
    const { cancel, container, generate, resolveGenerate, saveDraft, submit } = await setup({
      deferredGenerate: true,
      initiallySaved: true,
    });
    await openSavedProject(container);
    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
        ?.call(textarea, 'Make a timer.');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(submit).toHaveBeenCalledOnce();
      expect(container.querySelector('[data-builder-cancel-work="true"]')).not.toBeNull();
    });
    expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value).toBe('');
    expect(generate).not.toHaveBeenCalled();
    const expected = await createBuilderGenerationRequest('Make a timer.', PROJECT_ID);
    click(container, '[data-builder-cancel-work="true"]');

    await waitFor(() => {
      expect(cancel).toHaveBeenCalledExactlyOnceWith({ request_id: expected.request_digest });
      expect(container.querySelector('[data-builder-cancel-work="true"]')).toBeNull();
    });
    expect(cancel.mock.calls[0][0]).not.toHaveProperty('instruction');
    expect(cancel.mock.calls[0][0]).not.toHaveProperty('source_tree');
    expect(saveDraft).not.toHaveBeenCalled();

    await act(async () => {
      await resolveGenerate();
      await Promise.resolve();
    });
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();
    expect(saveDraft).not.toHaveBeenCalled();
  });

  it('does not restore submitted text when the send command is triggered again while work is pending', async () => {
    const { container, resolveGenerate, submit } = await setup({
      deferredGenerate: true,
      initiallySaved: true,
    });
    await openSavedProject(container);
    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
        ?.call(textarea, 'Make a timer.');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const send = container.querySelector<HTMLButtonElement>('[data-builder-submit-turn="true"]')!;

    act(() => {
      send.click();
      send.click();
    });

    await waitFor(() => {
      expect(submit).toHaveBeenCalledOnce();
      expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value).toBe('');
    });

    await act(async () => {
      await resolveGenerate();
      await Promise.resolve();
    });

    expect(submit).toHaveBeenCalledOnce();
    expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value).toBe('');
  });

  it('loads the visible project activity through the read-only task stream bridge', async () => {
    const { container, readTaskStream } = await setup({ initiallySaved: true });
    await openSavedProject(container);
    await waitFor(() => {
      expect(readTaskStream).toHaveBeenCalledWith({ project_id: PROJECT_ID });
    });
    readTaskStream.mockClear();
    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
        ?.call(textarea, 'Make a timer.');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(container.querySelector('[data-builder-unsaved-draft="true"]')).not.toBeNull();
      expect(container.querySelector('[data-builder-activity-card="Draft proposed"]')?.textContent)
        .toContain('I prepared a draft for review.');
    });
    await waitFor(() => {
      expect(readTaskStream).toHaveBeenCalledExactlyOnceWith({ project_id: PROJECT_ID });
    });
    expect(container.textContent).not.toContain('builder-generation-draft:');
    expect(container.textContent).not.toContain('sqlite');
  });

  it('loads live project activity after main binds a new submit to a working project id', async () => {
    const {
      container,
      emitGenerationStarted,
      emitTaskStreamChanged,
      readTaskStream,
      resolveGenerate,
      submit,
    } = await setup({ deferredGenerate: true, initiallySaved: true, runningActivity: true });
    await openSavedProject(container);
    await waitFor(() => {
      expect(readTaskStream).toHaveBeenCalledWith({ project_id: PROJECT_ID });
    });
    readTaskStream.mockClear();
    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
        ?.call(textarea, 'Make a timer.');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(submit).toHaveBeenCalledExactlyOnceWith({ instruction: 'Make a timer.' });
    });
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();
    const expected = await createBuilderGenerationRequest('Make a timer.', PROJECT_ID);
    expect(emitGenerationStarted(expected.request_digest, PROJECT_ID)).toBeGreaterThan(0);
    await waitFor(() => {
      expect(container.querySelector('[data-builder-work-status="true"]')).not.toBeNull();
    });
    expect(container.querySelector('[data-builder-live-output="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-conversation-notice="submitting"]')).toBeNull();
    expect(container.querySelector('[data-builder-conversation-notice="generating"]')).toBeNull();
    const startedWorkStatus = container.querySelector('[data-builder-work-status="true"]');
    expect(startedWorkStatus).not.toBeNull();
    expect(startedWorkStatus?.getAttribute('data-builder-work-status-stage')).toBe('started');
    expect(startedWorkStatus?.textContent).toContain('Preparing this request.');
    readTaskStream.mockClear();
    expect(emitTaskStreamChanged(PROJECT_ID)).toBe(1);
    await waitFor(() => {
      expect(readTaskStream).toHaveBeenCalledExactlyOnceWith({ project_id: PROJECT_ID });
    });
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();
    const workStatus = container.querySelector('[data-builder-work-status="true"]');
    expect(workStatus).not.toBeNull();
    expect(workStatus?.getAttribute('data-builder-work-status-stage')).toBe('started');
    expect(workStatus?.textContent).toContain('Preparing this request.');
    expect(container.textContent).not.toMatch(/request_id|provider|credential|commit_oid|tree_oid/iu);

    await act(async () => {
      await resolveGenerate();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(readTaskStream).toHaveBeenCalledTimes(2);
    });
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).not.toBeNull();
  });

  it('renders display-safe live AI output as an assistant message while work is active', async () => {
    const {
      container,
      emitGenerationOutput,
      emitGenerationStarted,
      resolveGenerate,
      submit,
    } = await setup({ deferredGenerate: true, initiallySaved: true });
    await openSavedProject(container);
    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
        ?.call(textarea, 'Make a timer.');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(submit).toHaveBeenCalledExactlyOnceWith({ instruction: 'Make a timer.' });
    });
    const expected = await createBuilderGenerationRequest('Make a timer.', PROJECT_ID);
    expect(emitGenerationStarted(expected.request_digest, PROJECT_ID)).toBeGreaterThan(0);
    expect(emitGenerationOutput(expected.request_digest, 'Planning a quiet timer UI.', PROJECT_ID)).toBeGreaterThan(0);
    expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value).toBe('');

    await waitFor(() => {
      expect(container.querySelector('[data-builder-live-output="true"]')?.textContent)
        .toContain('Planning a quiet timer UI.');
    });
    const liveOutput = container.querySelector('[data-builder-live-output="true"]');
    expect(liveOutput?.getAttribute('data-builder-activity-role')).toBe('assistant');
    expect(liveOutput?.querySelector('[data-builder-message-surface]')?.getAttribute('data-builder-message-surface'))
      .toBe('plain');
    expect(liveOutput?.textContent).not.toMatch(/provider|credential|source_tree|request_id|builder-run/iu);

    await act(async () => {
      await resolveGenerate();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(container.querySelector('[data-builder-live-output="true"]')).toBeNull();
      expect(container.querySelector('[data-builder-unsaved-draft="true"]')).not.toBeNull();
    });
  });

  it('adds desktop composer context to live work through request-id-only steering', async () => {
    const {
      container,
      emitGenerationStarted,
      readTaskStream,
      resolveGenerate,
      steer,
      submit,
    } = await setup({ deferredGenerate: true, initiallySaved: true, runningActivity: true });
    await openSavedProject(container);
    await waitFor(() => {
      expect(readTaskStream).toHaveBeenCalledWith({ project_id: PROJECT_ID });
    });
    readTaskStream.mockClear();
    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
        ?.call(textarea, 'Make a timer.');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.dispatchEvent(new Event('change', { bubbles: true }));
    });
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(submit).toHaveBeenCalledExactlyOnceWith({ instruction: 'Make a timer.' });
    });
    const expected = await createBuilderGenerationRequest('Make a timer.', PROJECT_ID);
    expect(emitGenerationStarted(expected.request_digest, PROJECT_ID)).toBeGreaterThan(0);
    await waitFor(() => {
      expect(container.querySelector('[data-builder-work-status="true"]')).not.toBeNull();
      expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.disabled).toBe(false);
      expect(container.querySelector('[data-builder-cancel-work="true"]')?.getAttribute('aria-label'))
        .toBe('Stop');
      expect(container.querySelector('[data-builder-submit-turn="true"]')).toBeNull();
    });
    expect(container.querySelector('[data-builder-live-output="true"]')).toBeNull();
    await act(async () => {
      await Promise.resolve();
    });
    readTaskStream.mockClear();
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
        ?.call(textarea, 'Make it blue.');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await waitFor(() => {
      expect(container.querySelector('[data-builder-submit-turn="true"]')?.getAttribute('aria-label'))
        .toBe('Add context');
      expect(container.querySelector('[data-builder-cancel-work="true"]')).toBeNull();
    });
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(steer).toHaveBeenCalledExactlyOnceWith({
        request_id: expected.request_digest,
        message: 'Make it blue.',
      });
    });
    expect(steer.mock.calls[0][0]).not.toHaveProperty('instruction');
    expect(steer.mock.calls[0][0]).not.toHaveProperty('source_tree');
    expect(steer.mock.calls[0][0]).not.toHaveProperty('project_id');
    expect(submit).toHaveBeenCalledOnce();
    expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value).toBe('');
    await waitFor(() => {
      expect(readTaskStream).toHaveBeenCalledExactlyOnceWith({ project_id: PROJECT_ID });
    });

    await act(async () => {
      await resolveGenerate();
      await Promise.resolve();
    });
  });

  it('queues a build command instead of steering while an answer is active', async () => {
    const {
      answer,
      container,
      emitGenerationStarted,
      resolveAnswer,
      steer,
      submit,
    } = await setup({ deferredAnswer: true, initiallySaved: true });
    await openSavedProject(container);
    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea')!;
    const question = 'What should I improve before changing files?';
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
        ?.call(textarea, question);
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.dispatchEvent(new Event('change', { bubbles: true }));
    });
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(answer).toHaveBeenCalledExactlyOnceWith({ instruction: question });
    });
    const expected = await createBuilderGenerationRequest(question, PROJECT_ID);
    expect(emitGenerationStarted(expected.request_digest, PROJECT_ID)).toBeGreaterThan(0);
    await waitFor(() => {
      expect(container.querySelector('[data-builder-live-output="true"]')).not.toBeNull();
      expect(container.querySelector('[data-builder-cancel-work="true"]')?.getAttribute('aria-label'))
        .toBe('Stop');
      expect(container.querySelector('[data-builder-submit-turn="true"]')).toBeNull();
    });

    const change = 'Change the main heading to My Notes.';
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
        ?.call(textarea, change);
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await waitFor(() => {
      expect(container.querySelector('[data-builder-submit-turn="true"]')?.getAttribute('aria-label'))
        .toBe('Add context');
      expect(container.querySelector('[data-builder-cancel-work="true"]')).toBeNull();
    });
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(container.querySelector('[data-builder-active-answer-build-blocked="true"]')?.textContent)
        .toContain('will start after the answer finishes');
      expect(container.querySelector('[data-builder-active-answer-build-queued="true"]')).not.toBeNull();
    });
    expect(steer).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value).toBe('');
    const composer = container.querySelector('[data-builder-composer="true"]');
    expect(composer?.getAttribute('data-builder-route')).toBe('build');
    expect(composer?.getAttribute('data-builder-route-signals')).toBe('clear_build');

    await act(async () => {
      await resolveAnswer();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(container.querySelector('[data-builder-active-answer-build-blocked="true"]')).toBeNull();
    });
    await waitFor(() => {
      expect(submit).toHaveBeenCalledExactlyOnceWith({ instruction: change });
    });
    expect(steer).not.toHaveBeenCalled();
  });

  it('queues Chinese contextual execution after internal brief readiness while an answer is active', async () => {
    const {
      answer,
      container,
      emitGenerationStarted,
      resolveAnswer,
      steer,
      submit,
    } = await setup({
      contextualBuildActivity: true,
      deferredAnswer: true,
      initiallySaved: true,
    });
    await openSavedProject(container);
    await waitFor(() => {
      expect(container.querySelector('[data-builder-composer-status="true"]')).toBeNull();
    });
    expect(container.querySelector('[data-builder-composer-brief="true"]')).toBeNull();

    const question = '这个方案还有什么风险？';
    setComposerInstruction(container, question);
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(answer).toHaveBeenCalledExactlyOnceWith({ instruction: question });
    });
    const expected = await createBuilderGenerationRequest(question, PROJECT_ID);
    expect(emitGenerationStarted(expected.request_digest, PROJECT_ID)).toBeGreaterThan(0);
    await waitFor(() => {
      expect(container.querySelector('[data-builder-live-output="true"]')).not.toBeNull();
    });

    const contextualExecution = '那就写';
    setComposerInstruction(container, contextualExecution);
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(container.querySelector('[data-builder-active-answer-build-queued="true"]')).not.toBeNull();
    });
    expect(steer).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    const composer = container.querySelector('[data-builder-composer="true"]');
    expect(composer?.getAttribute('data-builder-route')).toBe('build');
    expect(composer?.getAttribute('data-builder-route-dispatch')).toBe('build');
    expect(composer?.getAttribute('data-builder-route-signals')).toBe('contextual_build_phrase');
    expect(composer?.getAttribute('data-builder-route-task-id')).toBe(PENDING_TASK_ID);
    expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value).toBe('');

    await act(async () => {
      await resolveAnswer();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(container.querySelector('[data-builder-active-answer-build-queued="true"]')).toBeNull();
    });
    await waitFor(() => {
      expect(submit).toHaveBeenCalledExactlyOnceWith({ instruction: contextualExecution });
    });
    expect(steer).not.toHaveBeenCalled();
  });

  it('keeps queued active-answer builds behind current-project write approval', async () => {
    const {
      answer,
      container,
      emitGenerationStarted,
      prepareCurrentProjectWriteApproval,
      resolveAnswer,
      steer,
      submit,
    } = await setup({
      currentProjectWriteApprovalRequired: true,
      deferredAnswer: true,
      initiallySaved: true,
    });
    await openSavedProject(container);
    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea')!;
    const question = 'What should I improve before changing files?';
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
        ?.call(textarea, question);
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.dispatchEvent(new Event('change', { bubbles: true }));
    });
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(answer).toHaveBeenCalledExactlyOnceWith({ instruction: question });
    });
    const expected = await createBuilderGenerationRequest(question, PROJECT_ID);
    expect(emitGenerationStarted(expected.request_digest, PROJECT_ID)).toBeGreaterThan(0);
    await waitFor(() => {
      expect(container.querySelector('[data-builder-live-output="true"]')).not.toBeNull();
    });

    const change = 'Change the main heading to My Notes.';
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
        ?.call(textarea, change);
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.dispatchEvent(new Event('change', { bubbles: true }));
    });
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(container.querySelector('[data-builder-active-answer-build-queued="true"]')).not.toBeNull();
    });
    expect(steer).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();

    await act(async () => {
      await resolveAnswer();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(prepareCurrentProjectWriteApproval).toHaveBeenCalledWith({
        project_id: PROJECT_ID,
      });
      expect(container.querySelector('[data-builder-current-project-write-approval="true"]')).not.toBeNull();
    });
    expect(submit).not.toHaveBeenCalled();
    expect(steer).not.toHaveBeenCalled();
    expect(container.querySelector('[data-builder-current-project-write-approval="true"]')?.textContent)
      .toContain('Allow current project changes');
  });

  it('proposes a saved-project plan from the desktop composer without generating or saving', async () => {
    const {
      container,
      generate,
      preparePlanSourceReadApproval,
      proposePlan,
      readTaskStream,
      saveDraft,
      submit,
    } = await setup({
      initiallySaved: true,
      planAfterPropose: true,
    });
    await openSavedProject(container);
    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
        ?.call(textarea, 'Plan the next project update.');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await waitFor(() => {
      expect(container.querySelector('[data-builder-composer-add-menu-button="true"]')).not.toBeNull();
    });
    readTaskStream.mockClear();
    expect(container.querySelector('[data-builder-propose-plan="true"]')).toBeNull();
    click(container, '[data-builder-composer-add-menu-button="true"]');
    await waitFor(() => {
      expect(container.querySelector('[data-builder-composer-add-plan-mode="true"]')).not.toBeNull();
    });
    click(container, '[data-builder-composer-add-plan-mode="true"]');
    expect(proposePlan).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(container.querySelector('[data-builder-composer-mode-chip="plan"]')?.textContent)
        .toContain('Plan mode');
    });
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(proposePlan).toHaveBeenCalledOnce();
      expect(container.querySelector('[data-builder-plan-review-actions="true"]')).not.toBeNull();
    });
    expect(preparePlanSourceReadApproval).toHaveBeenCalledExactlyOnceWith({
      project_id: PROJECT_ID,
    });
    expect(proposePlan).toHaveBeenCalledExactlyOnceWith({
      instruction: 'Plan the next project update.',
    });
    expect(submit).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(textarea.value).toBe('');
    expect(readTaskStream).toHaveBeenCalledWith({ project_id: PROJECT_ID });
  });

  it('routes natural-language plan requests to plan proposal without submitting a draft', async () => {
    const {
      container,
      generate,
      preparePlanSourceReadApproval,
      proposePlan,
      saveDraft,
      submit,
    } = await setup({
      initiallySaved: true,
      planAfterPropose: true,
    });
    await openSavedProject(container);
    setComposerInstruction(container, '帮我先做下方案');
    await waitForComposerSubmitReady(container);
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(proposePlan).toHaveBeenCalledExactlyOnceWith({
        instruction: '帮我先做下方案',
      });
      expect(container.querySelector('[data-builder-plan-review-actions="true"]')).not.toBeNull();
    });
    expect(preparePlanSourceReadApproval).toHaveBeenCalledExactlyOnceWith({
      project_id: PROJECT_ID,
    });
    expect(submit).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    const composer = container.querySelector('[data-builder-composer="true"]');
    expect(composer?.getAttribute('data-builder-route')).toBe('plan');
    expect(composer?.getAttribute('data-builder-route-dispatch')).toBe('plan');
    expect(composer?.getAttribute('data-builder-route-permission')).toBe('not_required');
    expect(composer?.getAttribute('data-builder-route-signals')).toBe('explicit_plan');
    expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value).toBe('');
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
  });

  it('routes natural-language plan requests for an unsaved bound workspace without submitting a draft', async () => {
    const {
      container,
      generate,
      listWorkspaces,
      open,
      preparePlanSourceReadApproval,
      proposePlan,
      saveDraft,
      submit,
    } = await setup({
      planAfterPropose: true,
      workspaceOnlyCatalog: true,
    });
    await waitFor(() => {
      expect(listWorkspaces).toHaveBeenCalled();
      expect(open).toHaveBeenCalledWith({ project_id: PROJECT_ID });
      expect(container.querySelector('[data-builder-workspace-chip="true"]')?.textContent)
        .toContain('Unsaved dashboard');
    });
    setComposerInstruction(container, '帮我先做下方案');
    await waitForComposerSubmitReady(container);
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(proposePlan).toHaveBeenCalledExactlyOnceWith({
        instruction: '帮我先做下方案',
      });
      expect(container.querySelector('[data-builder-plan-review-actions="true"]')).not.toBeNull();
    });
    expect(preparePlanSourceReadApproval).toHaveBeenCalledExactlyOnceWith({
      project_id: PROJECT_ID,
    });
    expect(submit).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    const composer = container.querySelector('[data-builder-composer="true"]');
    expect(composer?.getAttribute('data-builder-route')).toBe('plan');
    expect(composer?.getAttribute('data-builder-route-dispatch')).toBe('plan');
    expect(composer?.getAttribute('data-builder-route-signals')).toBe('explicit_plan');
    expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value).toBe('');
    expect(container.querySelector('[data-builder-current-version="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
  });

  it('routes the add-menu Plan mode through plan evidence even for build-like wording', async () => {
    const {
      container,
      generate,
      preparePlanSourceReadApproval,
      proposePlan,
      saveDraft,
      submit,
    } = await setup({
      initiallySaved: true,
      planAfterPropose: true,
    });
    await openSavedProject(container);
    setComposerInstruction(container, 'Make a timer.');
    await waitForComposerSubmitReady(container);

    click(container, '[data-builder-composer-add-menu-button="true"]');
    click(container, '[data-builder-composer-add-plan-mode="true"]');
    expect(container.querySelector('[data-builder-composer-mode-chip="plan"]')?.textContent)
      .toContain('Plan mode');

    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(proposePlan).toHaveBeenCalledExactlyOnceWith({
        instruction: 'Make a timer.',
      });
    });
    expect(preparePlanSourceReadApproval).toHaveBeenCalledExactlyOnceWith({
      project_id: PROJECT_ID,
    });
    expect(submit).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    const composer = container.querySelector('[data-builder-composer="true"]');
    expect(composer?.getAttribute('data-builder-route')).toBe('plan');
    expect(composer?.getAttribute('data-builder-route-dispatch')).toBe('plan');
    expect(composer?.getAttribute('data-builder-route-permission')).toBe('not_required');
    expect(composer?.getAttribute('data-builder-route-signals')).toBe('composer_mode_plan');
    expect(composer?.getAttribute('data-builder-route-downgrade')).toBeNull();
    expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value).toBe('');
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
  });

  it('asks for visible project-read approval before a saved-project plan needs source context', async () => {
    const {
      approvePlanSourceRead,
      container,
      preparePlanSourceReadApproval,
      proposePlan,
      readTaskStream,
    } = await setup({
      initiallySaved: true,
      planAfterPropose: true,
      planSourceReadApprovalRequired: true,
    });
    await openSavedProject(container);
    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
        ?.call(textarea, 'Plan the next project update.');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await waitFor(() => {
      expect(container.querySelector('[data-builder-composer-add-menu-button="true"]')).not.toBeNull();
    });
    readTaskStream.mockClear();
    expect(container.querySelector('[data-builder-propose-plan="true"]')).toBeNull();
    click(container, '[data-builder-composer-add-menu-button="true"]');
    await waitFor(() => {
      expect(container.querySelector('[data-builder-composer-add-plan-mode="true"]')).not.toBeNull();
    });
    click(container, '[data-builder-composer-add-plan-mode="true"]');
    expect(proposePlan).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(container.querySelector('[data-builder-composer-mode-chip="plan"]')?.textContent)
        .toContain('Plan mode');
    });
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(preparePlanSourceReadApproval).toHaveBeenCalledExactlyOnceWith({
        project_id: PROJECT_ID,
      });
      expect(container.querySelector('[data-builder-plan-source-read-approval="true"]')?.textContent).
        toContain('Allow project reading?');
    });
    expect(proposePlan).not.toHaveBeenCalled();
    expect(textarea.value).toBe('');

    click(container, 'Allow and continue');

    await waitFor(() => {
      expect(approvePlanSourceRead).toHaveBeenCalledExactlyOnceWith({ project_id: PROJECT_ID });
      expect(proposePlan).toHaveBeenCalledExactlyOnceWith({
        instruction: 'Plan the next project update.',
      });
      expect(container.querySelector('[data-builder-plan-review-actions="true"]')).not.toBeNull();
    });
    expect(container.querySelector('[data-builder-plan-source-read-approval="true"]')).toBeNull();
    expect(JSON.stringify(approvePlanSourceRead.mock.calls)).not.toMatch(/resource_id|permission_id|source_tree/iu);
  });

  it('restores the plan request to the composer when project-read approval is dismissed', async () => {
    const {
      approvePlanSourceRead,
      container,
      generate,
      preparePlanSourceReadApproval,
      proposePlan,
      saveDraft,
      submit,
    } = await setup({
      initiallySaved: true,
      planAfterPropose: true,
      planSourceReadApprovalRequired: true,
    });
    await openSavedProject(container);
    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
        ?.call(textarea, 'Plan the next project update.');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await waitFor(() => {
      expect(container.querySelector('[data-builder-composer-add-menu-button="true"]')).not.toBeNull();
    });

    expect(container.querySelector('[data-builder-propose-plan="true"]')).toBeNull();
    click(container, '[data-builder-composer-add-menu-button="true"]');
    await waitFor(() => {
      expect(container.querySelector('[data-builder-composer-add-plan-mode="true"]')).not.toBeNull();
    });
    click(container, '[data-builder-composer-add-plan-mode="true"]');
    expect(proposePlan).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(container.querySelector('[data-builder-composer-mode-chip="plan"]')?.textContent)
        .toContain('Plan mode');
    });
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(container.querySelector('[data-builder-plan-source-read-approval="true"]')?.textContent)
        .toContain('Allow project reading?');
      expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value).toBe('');
    });

    click(container, 'Not now');

    await waitFor(() => {
      expect(container.querySelector('[data-builder-plan-source-read-approval="true"]')).toBeNull();
      expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value)
        .toBe('Plan the next project update.');
    });
    expect(preparePlanSourceReadApproval).toHaveBeenCalledExactlyOnceWith({
      project_id: PROJECT_ID,
    });
    expect(approvePlanSourceRead).not.toHaveBeenCalled();
    expect(proposePlan).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
  });

  it('records plan approval then continues into an unsaved draft without saving', async () => {
    const {
      container,
      emitGenerationOutput,
      emitGenerationStarted,
      generate,
      generateApprovedPlan,
      readTaskStream,
      reviewPlan,
      resolveGenerate,
      saveDraft,
    } = await setup({
      deferredApprovedPlanGenerate: true,
      initiallySaved: true,
      pendingPlanActivity: true,
    });
    await waitFor(() => {
      expect(container.querySelector(`[data-builder-project-id="${PROJECT_ID}"]`)).not.toBeNull();
    });
    click(container, 'Hello project');
    await waitFor(() => {
      expect(container.querySelector('[data-builder-plan-review-actions="true"]')).not.toBeNull();
    });
    readTaskStream.mockClear();
    click(container, 'Approve plan');

    await waitFor(() => {
      expect(reviewPlan).toHaveBeenCalledOnce();
      expect(container.querySelector('[data-builder-activity-card="Plan approved"]')?.textContent)
        .toContain('The plan was approved. The project has not changed yet.');
      expect(generateApprovedPlan).toHaveBeenCalledOnce();
    });
    expect(reviewPlan).toHaveBeenCalledExactlyOnceWith({
      project_id: PROJECT_ID,
      conversation_id: `builder-conversation:${PROJECT_ID.slice('builder-project:'.length)}`,
      turn_id: 'builder-turn:123e4567-e89b-42d3-a456-426614174000',
      run_id: 'builder-run:123e4567-e89b-42d3-a456-426614174000',
      decision: 'approved',
    });
    expect(generateApprovedPlan).toHaveBeenCalledExactlyOnceWith({
      project_id: PROJECT_ID,
      conversation_id: `builder-conversation:${PROJECT_ID.slice('builder-project:'.length)}`,
      turn_id: 'builder-turn:123e4567-e89b-42d3-a456-426614174000',
      run_id: 'builder-run:123e4567-e89b-42d3-a456-426614174000',
    });
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();
    const expected = await createBuilderGenerationRequest('Review the approved plan.', PROJECT_ID);
    expect(emitGenerationStarted(expected.request_digest, PROJECT_ID)).toBeGreaterThan(0);
    await waitFor(() => {
      expect(container.querySelector('[data-builder-live-output="true"]')?.textContent)
        .toContain('Applying the approved plan...');
    });
    expect(container.querySelector('[data-builder-live-output="true"]')?.getAttribute('data-builder-live-output-state'))
      .toBe('waiting');
    expect(emitGenerationOutput(expected.request_digest, 'Applying the approved plan.', PROJECT_ID))
      .toBeGreaterThan(0);
    await waitFor(() => {
      expect(container.querySelector('[data-builder-live-output="true"]')?.textContent)
        .toContain('Applying the approved plan.');
    });
    await act(async () => {
      await resolveGenerate();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(container.querySelector('[data-builder-live-output="true"]')).toBeNull();
      expect(container.querySelector('[data-builder-unsaved-draft="true"]')).not.toBeNull();
    });
    expect(readTaskStream).toHaveBeenCalledWith({ project_id: PROJECT_ID });
    expect(saveDraft).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(container.querySelector('[data-builder-save-version="true"]')).not.toBeNull();
    expect(container.textContent).not.toMatch(
      /plan_result_digest|review_id|reviewer_id|reviewed_at_ms|source_tree|commit_oid|tree_oid|provider|credential/iu,
    );
  });

  it('keeps approved plan continuation retryable when the draft is not created', async () => {
    const {
      container,
      generateApprovedPlan,
      readTaskStream,
      retry,
      reviewPlan,
      saveDraft,
    } = await setup({
      failApprovedPlanGenerateOnce: true,
      initiallySaved: true,
      pendingPlanActivity: true,
    });
    await waitFor(() => {
      expect(container.querySelector(`[data-builder-project-id="${PROJECT_ID}"]`)).not.toBeNull();
    });
    click(container, 'Hello project');
    await waitFor(() => {
      expect(container.querySelector('[data-builder-plan-review-actions="true"]')).not.toBeNull();
    });
    readTaskStream.mockClear();

    click(container, 'Approve plan');

    await waitFor(() => {
      expect(reviewPlan).toHaveBeenCalledOnce();
      expect(generateApprovedPlan).toHaveBeenCalledOnce();
      expect(container.querySelector('[data-builder-activity-card="Plan approved"]')?.textContent)
        .toContain('The plan was approved. The project has not changed yet.');
      expect(container.querySelector('[data-builder-conversation-notice="generation_failed"]')?.textContent)
        .toContain('The plan was approved, but the draft could not be created. Retry to continue from that plan.');
      expect(container.querySelector('[data-builder-retry-draft="true"]')).not.toBeNull();
    });
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();
    expect(readTaskStream).toHaveBeenCalledWith({ project_id: PROJECT_ID });
    expect(retry).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();

    click(container, '[data-builder-retry-draft="true"]');

    await waitFor(() => {
      expect(generateApprovedPlan).toHaveBeenCalledTimes(2);
      expect(container.querySelector('[data-builder-unsaved-draft="true"]')).not.toBeNull();
    });
    expect(retry).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(container.textContent).not.toMatch(
      /plan_result_digest|review_id|reviewer_id|reviewed_at_ms|source_tree|commit_oid|tree_oid|provider|credential|ipc|schema|receipt/iu,
    );
  });

  it('keeps plan approval single-shot while the review decision is recording', async () => {
    const {
      container,
      generateApprovedPlan,
      readTaskStream,
      resolvePlanReview,
      reviewPlan,
      saveDraft,
    } = await setup({
      deferredPlanReview: true,
      initiallySaved: true,
      pendingPlanActivity: true,
    });
    await waitFor(() => {
      expect(container.querySelector(`[data-builder-project-id="${PROJECT_ID}"]`)).not.toBeNull();
    });
    click(container, 'Hello project');
    await waitFor(() => {
      expect(container.querySelector('[data-builder-plan-review-actions="true"]')).not.toBeNull();
    });

    const approve = container.querySelector<HTMLButtonElement>('[data-builder-approve-plan="true"]');
    expect(approve).not.toBeNull();
    readTaskStream.mockClear();
    act(() => {
      approve?.click();
      approve?.click();
    });

    expect(reviewPlan).toHaveBeenCalledOnce();
    expect(generateApprovedPlan).not.toHaveBeenCalled();
    await waitFor(() => {
      const actions = container.querySelector('[data-builder-plan-review-actions="true"]');
      expect(actions?.getAttribute('data-builder-plan-review-state')).toBe('recording');
      expect(actions?.textContent).toContain('Recording your decision...');
      expect(container.querySelector<HTMLButtonElement>('[data-builder-approve-plan="true"]')?.disabled)
        .toBe(true);
      expect(container.querySelector<HTMLButtonElement>('[data-builder-reject-plan="true"]')?.disabled)
        .toBe(true);
    });

    await act(async () => {
      await resolvePlanReview();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(generateApprovedPlan).toHaveBeenCalledOnce();
      expect(container.querySelector('[data-builder-unsaved-draft="true"]')).not.toBeNull();
    });
    expect(reviewPlan).toHaveBeenCalledExactlyOnceWith({
      project_id: PROJECT_ID,
      conversation_id: `builder-conversation:${PROJECT_ID.slice('builder-project:'.length)}`,
      turn_id: 'builder-turn:123e4567-e89b-42d3-a456-426614174000',
      run_id: 'builder-run:123e4567-e89b-42d3-a456-426614174000',
      decision: 'approved',
    });
    expect(saveDraft).not.toHaveBeenCalled();
    expect(container.textContent).not.toMatch(
      /plan_result_digest|review_id|reviewer_id|reviewed_at_ms|source_tree|commit_oid|tree_oid|provider|credential/iu,
    );
  });

  it('keeps plan approval retryable when the review decision is not recorded', async () => {
    const {
      container,
      generateApprovedPlan,
      reviewPlan,
      saveDraft,
    } = await setup({
      failPlanReview: true,
      initiallySaved: true,
      pendingPlanActivity: true,
    });
    await waitFor(() => {
      expect(container.querySelector(`[data-builder-project-id="${PROJECT_ID}"]`)).not.toBeNull();
    });
    click(container, 'Hello project');
    await waitFor(() => {
      expect(container.querySelector('[data-builder-plan-review-actions="true"]')).not.toBeNull();
    });

    click(container, 'Approve plan');
    await waitFor(() => {
      expect(reviewPlan).toHaveBeenCalledOnce();
      const actions = container.querySelector('[data-builder-plan-review-actions="true"]');
      expect(actions?.getAttribute('data-builder-plan-review-state')).toBe('failed');
      expect(actions?.querySelector('[role="alert"]')?.textContent)
        .toContain('That decision could not be recorded. Try again.');
      expect(container.querySelector<HTMLButtonElement>('[data-builder-approve-plan="true"]')?.disabled)
        .toBe(false);
    });
    expect(generateApprovedPlan).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(container.querySelector('[data-builder-activity-card="Plan approved"]')).toBeNull();
    expect(container.textContent).not.toMatch(
      /plan_result_digest|review_id|reviewer_id|reviewed_at_ms|source_tree|commit_oid|tree_oid|provider|credential|ipc|schema|receipt/iu,
    );
  });

  it('keeps recorded plan decisions locked when activity refresh is stale', async () => {
    const {
      container,
      generateApprovedPlan,
      readTaskStream,
      reviewPlan,
      saveDraft,
    } = await setup({
      failTaskStreamAfterPlanReview: true,
      initiallySaved: true,
      pendingPlanActivity: true,
    });
    await waitFor(() => {
      expect(container.querySelector(`[data-builder-project-id="${PROJECT_ID}"]`)).not.toBeNull();
    });
    click(container, 'Hello project');
    await waitFor(() => {
      expect(container.querySelector('[data-builder-plan-review-actions="true"]')).not.toBeNull();
    });
    readTaskStream.mockClear();

    click(container, 'Reject');
    await waitFor(() => {
      expect(reviewPlan).toHaveBeenCalledOnce();
      expect(readTaskStream).toHaveBeenCalledWith({ project_id: PROJECT_ID });
      const actions = container.querySelector('[data-builder-plan-review-actions="true"]');
      expect(actions?.getAttribute('data-builder-plan-review-state')).toBe('recorded');
      expect(actions?.textContent).toContain('Decision recorded. Updating the conversation...');
      expect(container.querySelector<HTMLButtonElement>('[data-builder-approve-plan="true"]')?.disabled)
        .toBe(true);
      expect(container.querySelector<HTMLButtonElement>('[data-builder-reject-plan="true"]')?.disabled)
        .toBe(true);
    });
    click(container, '[data-builder-approve-plan="true"]');
    expect(reviewPlan).toHaveBeenCalledOnce();
    expect(generateApprovedPlan).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(container.querySelector('[data-builder-activity-card="Plan rejected"]')).toBeNull();
    expect(container.textContent).not.toMatch(
      /plan_result_digest|review_id|reviewer_id|reviewed_at_ms|source_tree|commit_oid|tree_oid|provider|credential|ipc|schema|receipt/iu,
    );
  });

  it('discards an unsaved draft through draft-id-only control and refreshes activity', async () => {
    const {
      cancel,
      container,
      loadCurrent,
      readTaskStream,
      rejectDraft,
      restoreDraft,
      saveDraft,
    } = await setup({ initiallySaved: true, rejectActivityAfterDiscard: true });
    await openSavedProject(container);
    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
        ?.call(textarea, 'Make a timer.');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    click(container, '[data-builder-submit-turn="true"]');
    await waitFor(() => {
      expect(container.querySelector('[data-builder-discard-draft="true"]')).not.toBeNull();
    });
    readTaskStream.mockClear();
    click(container, 'Discard draft');

    await waitFor(() => {
      expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();
      expect(container.querySelector('[data-builder-activity-card="Draft rejected"]')?.textContent)
        .toContain('The draft was discarded and is no longer available for review.');
    });
    expect(rejectDraft).toHaveBeenCalledExactlyOnceWith({
      draft_id: expect.stringMatching(/^builder-generation-draft:/u),
    });
    expect(rejectDraft.mock.calls[0][0]).not.toHaveProperty('instruction');
    expect(rejectDraft.mock.calls[0][0]).not.toHaveProperty('source_tree');
    expect(saveDraft).not.toHaveBeenCalled();
    expect(loadCurrent).not.toHaveBeenCalled();
    expect(restoreDraft).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(readTaskStream).toHaveBeenCalledExactlyOnceWith({ project_id: PROJECT_ID });
    });
    expect(container.textContent).not.toMatch(/builder-generation-draft:|sha256:|provider|credential/iu);
  });

  it('answers a question through the chat bridge without draft, save, or revision UI', async () => {
    const { answer, container, generate, readTaskStream, saveDraft, submit } = await setup({
      answerActivity: true,
    });
    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
        ?.call(textarea, 'What does this project do?');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(container.querySelector('[data-builder-activity-card="Assistant"]')?.textContent)
        .toContain('This answer does not change files.');
    });

    expect(answer).toHaveBeenCalledExactlyOnceWith({ instruction: 'What does this project do?' });
    expect(submit).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(readTaskStream).toHaveBeenCalledExactlyOnceWith({ project_id: PROJECT_ID });
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-current-version="true"]')).toBeNull();
    expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value).toBe('');
    expect(container.textContent).not.toContain('builder-generation-draft:');
    expect(container.textContent).not.toContain('request_id');
  });

  it('keeps casual composer turns in chat without starting draft generation', async () => {
    const { answer, container, generate, saveDraft, submit } = await setup({
      answerActivity: true,
    });
    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
        ?.call(textarea, 'hi');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(container.querySelector('[data-builder-activity-card="Assistant"]')?.textContent)
        .toContain('This answer does not change files.');
    });

    expect(answer).toHaveBeenCalledExactlyOnceWith({ instruction: 'hi' });
    expect(submit).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
    expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value).toBe('');
  });

  it('keeps exploratory brief updates as chat when no project workspace is selected', async () => {
    const { answer, container, createLocalProject, generate, saveDraft, submit } = await setup({
      answerActivity: true,
    });
    setComposerInstruction(container, '我想做一个登录页');
    await waitForComposerSubmitReady(container);

    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(answer).toHaveBeenCalledExactlyOnceWith({ instruction: '我想做一个登录页' });
    });
    expect(createLocalProject).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(container.querySelector('[data-builder-workspace-picker="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
    const composer = container.querySelector('[data-builder-composer="true"]');
    expect(composer?.getAttribute('data-builder-route')).toBe('update_brief');
    expect(composer?.getAttribute('data-builder-route-dispatch')).toBe('brief_update');
    expect(composer?.getAttribute('data-builder-route-task-id')).toBeNull();
  });

  it('keeps Chinese how-to questions in chat without opening the project picker', async () => {
    const { answer, container, createLocalProject, generate, saveDraft, submit } = await setup({
      answerActivity: true,
    });
    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
        ?.call(textarea, '怎么把按钮改红？');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });

    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(container.querySelector('[data-builder-activity-card="Assistant"]')?.textContent)
        .toContain('This answer does not change files.');
    });

    expect(answer).toHaveBeenCalledExactlyOnceWith({ instruction: '怎么把按钮改红？' });
    expect(createLocalProject).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(container.querySelector('[data-builder-workspace-picker="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
    expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value).toBe('');
  });

  it('keeps vague improvement requests in chat until the user gives a clear target', async () => {
    const { answer, container, createLocalProject, generate, saveDraft, submit } = await setup({
      answerActivity: true,
    });
    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
        ?.call(textarea, '帮我优化一下');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });

    click(container, '[data-builder-submit-turn="true"]');

    await waitFor(() => {
      expect(container.querySelector('[data-builder-activity-card="Assistant"]')?.textContent)
        .toContain('This answer does not change files.');
    });

    expect(answer).toHaveBeenCalledExactlyOnceWith({ instruction: '帮我优化一下' });
    expect(createLocalProject).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(container.querySelector('[data-builder-workspace-picker="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
    expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value).toBe('');
  });

  it('restores a pending draft from project activity after opening a saved project', async () => {
    const { container, open, readTaskStream, restoreDraft, saveDraft } = await setup({
      initiallySaved: true,
      pendingActivity: true,
      restoreAvailable: true,
    });
    await waitFor(() => {
      expect(container.querySelector(`[data-builder-project-id="${PROJECT_ID}"]`)).not.toBeNull();
    });
    click(container, 'Hello project');

    await waitFor(() => {
      expect(container.querySelector('[data-builder-unsaved-draft="true"]')).not.toBeNull();
    });

    expect(open).toHaveBeenCalledWith({ project_id: PROJECT_ID });
    expect(readTaskStream).toHaveBeenCalledWith({ project_id: PROJECT_ID });
    expect(restoreDraft).toHaveBeenCalledExactlyOnceWith({
      draft_id: expect.stringMatching(/^builder-generation-draft:/u),
    });
    expect(saveDraft).not.toHaveBeenCalled();
    expect(container.querySelector('[data-builder-current-version="true"]')?.textContent)
      .toContain('Version 1');
    expect(container.querySelector('[data-builder-save-version="true"]')).not.toBeNull();
  });

  it('does not restore a pending draft after project activity records rejection', async () => {
    const { container, open, readTaskStream, restoreDraft, saveDraft } = await setup({
      initiallySaved: true,
      rejectedPendingActivity: true,
      restoreAvailable: true,
    });
    await waitFor(() => {
      expect(container.querySelector(`[data-builder-project-id="${PROJECT_ID}"]`)).not.toBeNull();
    });
    click(container, 'Hello project');

    await waitFor(() => {
      expect(container.querySelector('[data-builder-activity-card="Draft rejected"]')?.textContent)
        .toContain('The draft was discarded and is no longer available for review.');
    });

    expect(open).toHaveBeenCalledWith({ project_id: PROJECT_ID });
    expect(readTaskStream).toHaveBeenCalledWith({ project_id: PROJECT_ID });
    expect(restoreDraft).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-current-version="true"]')?.textContent)
      .toContain('Version 1');
  });

  it('does not restore a pending draft after project activity records acceptance', async () => {
    const { container, open, readTaskStream, restoreDraft, saveDraft } = await setup({
      initiallySaved: true,
      acceptedPendingActivity: true,
      restoreAvailable: true,
    });
    await waitFor(() => {
      expect(container.querySelector(`[data-builder-project-id="${PROJECT_ID}"]`)).not.toBeNull();
    });
    click(container, 'Hello project');

    await waitFor(() => {
      expect(container.querySelector('[data-builder-activity-card="Version saved"]')?.textContent)
        .toContain('This draft was saved as Version 1.');
    });

    expect(open).toHaveBeenCalledWith({ project_id: PROJECT_ID });
    expect(readTaskStream).toHaveBeenCalledWith({ project_id: PROJECT_ID });
    expect(restoreDraft).not.toHaveBeenCalled();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-save-version="true"]')).toBeNull();
    expect(container.querySelector('[data-builder-current-version="true"]')?.textContent)
      .toContain('Version 1');
  });

  it('does not consume pending draft restore while viewing saved history', async () => {
    const { container, readTaskStream, restoreDraft } = await setup({
      initiallySaved: true,
      pendingAfterRevisionView: true,
      restoreAvailable: true,
      validHistoryPreview: true,
    });
    await waitFor(() => {
      expect(container.querySelector(`[data-builder-project-id="${PROJECT_ID}"]`)).not.toBeNull();
    });
    click(container, 'Hello project');
    await waitFor(() => {
      expect(container.querySelector('[data-builder-view-version="Version 1"]')).not.toBeNull();
    });
    act(() => {
      container.querySelector<HTMLButtonElement>('[data-builder-view-version="Version 1"]')?.click();
    });
    await waitFor(() => {
      expect(container.querySelector('[data-builder-history-preview="true"]')?.textContent)
        .toContain('Viewing Version 1');
    });
    readTaskStream.mockClear();
    const refreshActivity = container.querySelector<HTMLButtonElement>(
      '[data-builder-activity="true"] button[aria-label="Refresh conversation"]',
    );
    expect(refreshActivity).not.toBeNull();
    expect(refreshActivity?.disabled).toBe(false);
    act(() => {
      refreshActivity?.click();
    });
    await waitFor(() => {
      expect(readTaskStream).toHaveBeenCalledExactlyOnceWith({ project_id: PROJECT_ID });
    });
    await waitFor(() => {
      expect(container.querySelector('[data-builder-activity-card="Draft proposed"]')).not.toBeNull();
    });
    expect(restoreDraft).not.toHaveBeenCalled();

    click(container, 'Back to current');
    await waitFor(() => {
      expect(readTaskStream).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(restoreDraft).toHaveBeenCalledExactlyOnceWith({
        draft_id: expect.stringMatching(/^builder-generation-draft:/u),
      });
      expect(container.querySelector('[data-builder-unsaved-draft="true"]')).not.toBeNull();
    });
  });

  it('returns from saved history to the current desktop preview with one Back action', async () => {
    const { container, loadRevision } = await setup({
      initiallySaved: true,
      validHistoryPreview: true,
    });
    await waitFor(() => {
      expect(container.querySelector(`[data-builder-project-id="${PROJECT_ID}"]`)).not.toBeNull();
    });
    click(container, 'Hello project');
    await waitFor(() => {
      expect(container.querySelector('[data-builder-view-version="Version 1"]')).not.toBeNull();
      expect(container.querySelector('[data-builder-artifact-sidebar="true"]')?.getAttribute('data-builder-artifact-tab-active'))
        .toBe('versions');
    });

    act(() => {
      container.querySelector<HTMLButtonElement>('[data-builder-view-version="Version 1"]')?.click();
    });
    await waitFor(() => {
      expect(container.querySelector('[data-builder-history-preview="true"]')?.textContent)
        .toContain('Viewing Version 1');
      expect(artifactPreviewSrcdoc(container)).toContain('<main>Earlier</main>');
      expect(container.querySelector('[data-builder-artifact-sidebar="true"]')?.getAttribute('data-builder-artifact-tab-active'))
        .toBe('preview');
    });
    expect(loadRevision).toHaveBeenCalledOnce();
    expect(container.querySelectorAll('[data-builder-show-current-version="true"]')).toHaveLength(1);

    click(container, 'Back to current');
    await waitFor(() => {
      expect(container.querySelector('[data-builder-history-preview="true"]')).toBeNull();
      expect(artifactPreviewSrcdoc(container)).toContain('<main>Current</main>');
      expect(container.querySelector('[data-builder-artifact-sidebar="true"]')?.getAttribute('data-builder-artifact-tab-active'))
        .toBe('preview');
    });
  });

  it('restores a saved history item as an unsaved draft without saving immediately', async () => {
    const {
      container,
      readTaskStream,
      restoreDraft,
      restoreRevisionAsDraft,
      saveDraft,
    } = await setup({
      initiallySaved: true,
      validHistoryPreview: true,
    });
    await waitFor(() => {
      expect(container.querySelector(`[data-builder-project-id="${PROJECT_ID}"]`)).not.toBeNull();
    });
    click(container, 'Hello project');
    await waitFor(() => {
      expect(container.querySelector('[data-builder-restore-version="Version 1"]')).not.toBeNull();
    });
    readTaskStream.mockClear();

    act(() => {
      container.querySelector<HTMLButtonElement>('[data-builder-restore-version="Version 1"]')?.click();
    });

    await waitFor(() => {
      expect(restoreRevisionAsDraft).toHaveBeenCalledExactlyOnceWith({
        project_id: PROJECT_ID,
        revision_receipt_digest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
      });
      expect(container.querySelector('[data-builder-unsaved-draft="true"]')).not.toBeNull();
      expect(container.querySelector('[data-builder-save-version="true"]')).not.toBeNull();
    });
    expect(readTaskStream).toHaveBeenCalledWith({ project_id: PROJECT_ID });
    expect(saveDraft).not.toHaveBeenCalled();
    expect(restoreDraft).not.toHaveBeenCalled();
  });

  it('saves only after the explicit command, then shows the verified Git/SQLite version', async () => {
    const {
      container,
      listHistory,
      loadCurrent,
      readTaskStream,
      restoreDraft,
      saveDraft,
    } = await setup({ initiallySaved: true });
    await openSavedProject(container);
    await waitFor(() => {
      expect(readTaskStream).toHaveBeenCalledWith({ project_id: PROJECT_ID });
    });
    readTaskStream.mockClear();
    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
        ?.call(textarea, 'Make a timer.');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    click(container, '[data-builder-submit-turn="true"]');
    await waitFor(() => {
      expect(container.querySelector('[data-builder-save-version="true"]')).not.toBeNull();
    });
    await waitFor(() => {
      expect(readTaskStream).toHaveBeenCalledWith({ project_id: PROJECT_ID });
    });
    readTaskStream.mockClear();
    click(container, 'Save version');
    await waitFor(() => {
      expect(saveDraft).toHaveBeenCalledOnce();
    });
    await waitFor(() => {
      expect(loadCurrent).toHaveBeenCalledWith({ project_id: PROJECT_ID });
    });
    await waitFor(() => {
      expect(container.querySelector('[data-builder-current-version="true"]')?.textContent)
        .toContain('Version 1');
    });

    expect(saveDraft).toHaveBeenCalledOnce();
    expect(saveDraft.mock.calls[0][0]).toEqual({
      draft_id: expect.stringMatching(/^builder-generation-draft:/u),
    });
    expect(loadCurrent).toHaveBeenCalledWith({ project_id: PROJECT_ID });
    await waitFor(() => {
      expect(readTaskStream).toHaveBeenCalledExactlyOnceWith({ project_id: PROJECT_ID });
    });
    expect(listHistory).toHaveBeenCalledWith({
      project_id: PROJECT_ID,
      limit: 128,
    });
    expect(restoreDraft).not.toHaveBeenCalled();
    expect(container.querySelector('[data-builder-unsaved-draft="true"]')).toBeNull();
    await waitFor(() => {
      expect(container.querySelector('[data-builder-version-card="Version 1"]')?.textContent)
        .toContain('Current');
    });
    expect(container.textContent).not.toMatch(/sha256:|commit_oid|tree_oid|parent_oid|credential|provider/iu);
  });

  it('keeps project instruction state when visiting Settings and returning', async () => {
    const { container } = await setup();
    const textarea = container.querySelector<HTMLTextAreaElement>('#builder-idea')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
        ?.call(textarea, 'Keep this instruction.');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    click(container, 'Settings');
    expect(container.textContent).toContain('AI provider settings');
    click(container, 'Back to project');
    expect(container.querySelector<HTMLTextAreaElement>('#builder-idea')?.value)
      .toBe('Keep this instruction.');
  });
});
