import { describe, expect, it, vi } from 'vitest';

import { createBuilderGenerationRequest } from '../application/builderGeneration';
import {
  BuilderDesktopCodeGeneratorPortError,
  createBuilderDesktopCodeGeneratorPort,
} from './builderDesktopCodeGeneratorPort';
import {
  CONVERSATION_ID,
  DRAFT_ID,
  PROJECT_ID,
  RUN_ID,
  TURN_ID,
  createGenerationAnswer,
  createGenerationDraft,
  createRestoredGenerationDraft,
} from '../../../test/builderV2Fixtures';

describe('createBuilderDesktopCodeGeneratorPort', () => {
  it('forwards one v2 request and unwraps a fresh success envelope', async () => {
    const request = await createBuilderGenerationRequest('Make a timer.');
    const draft = await createGenerationDraft(request);
    const generate = vi.fn(async (request: unknown) => {
      void request;
      return {
        version: 'builder-generation-ipc-result.v1',
        ok: true,
        result: draft,
      };
    });
    const port = createBuilderDesktopCodeGeneratorPort({
      submit: async () => null,
      generateApprovedPlan: async () => null,
      continueDraft: async (): Promise<unknown> => null,
      proposePlan: async () => null,
      preparePlanSourceReadApproval: async () => null,
      approvePlanSourceRead: async () => null,
      prepareCurrentProjectWriteApproval: async () => null,
      approveCurrentProjectWrite: async () => null,
      generate,
      retry: async () => null,
      answer: async () => null,
      answerDraft: async () => null,
      restoreDraft: async () => null,
      restoreRevisionAsDraft: async () => null,
      rejectDraft: async () => null,
      cancel: async () => null,
      steer: async () => null,
      queueFollowup: async () => null,
      availability: async () => null,
      subscribeStarted: () => () => undefined,
      subscribeOutput: () => () => undefined,
    });

    const result = await port.generate(request);
    expect(generate).toHaveBeenCalledOnce();
    expect(generate.mock.calls[0][0]).toEqual({ instruction: request.instruction });
    expect(generate.mock.calls[0][0]).not.toHaveProperty('existing_project_id');
    expect(generate.mock.calls[0][0]).not.toHaveProperty('request_digest');
    expect(result).toEqual(draft);
    expect(result).not.toBe(draft);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('forwards only the current instruction for semantic routing', async () => {
    const classifyIntent = vi.fn(async (request: { instruction: string }) => {
      void request;
      return {
        version: 'builder-generation-ipc-result.v1',
        ok: true,
        result: {
        result_version: 'builder-semantic-route-classification.v1',
        request_digest: `sha256:${'a'.repeat(64)}`,
        route: 'plan',
        confidence: 'high',
        needs_confirmation: false,
        reason_code: 'requests_plan_or_proposal',
        matched_signal: 'semantic_route',
        authority: {
          classifier: 'main_owned_provider_semantic_route_v1',
          context_scope: 'current_instruction_and_bounded_product_state',
          conversation_text: 'not_disclosed',
          working_brief_text: 'not_disclosed',
          source_read: 'not_performed',
          source_write: 'not_performed',
          tool_dispatch: false,
          command_execution: false,
          permission_grant: false,
          git_mutation: false,
          sqlite_write: false,
          save_admission: false,
        },
        },
      };
    });
    const port = createBuilderDesktopCodeGeneratorPort({
      classifyIntent,
      submit: async () => null,
      generateApprovedPlan: async () => null,
      continueDraft: async () => null,
      proposePlan: async () => null,
      preparePlanSourceReadApproval: async () => null,
      approvePlanSourceRead: async () => null,
      prepareCurrentProjectWriteApproval: async () => null,
      approveCurrentProjectWrite: async () => null,
      generate: async () => null,
      retry: async () => null,
      answer: async () => null,
      answerDraft: async () => null,
      restoreDraft: async () => null,
      restoreRevisionAsDraft: async () => null,
      rejectDraft: async () => null,
      cancel: async () => null,
      steer: async () => null,
      queueFollowup: async () => null,
      availability: async () => null,
      subscribeStarted: () => () => undefined,
      subscribeOutput: () => () => undefined,
    });

    const result = await port.classifyIntent?.({
      instruction: '帮我做一个静态技术博客实施计划',
    });

    expect(classifyIntent).toHaveBeenCalledExactlyOnceWith({
      instruction: '帮我做一个静态技术博客实施计划',
    });
    expect(classifyIntent.mock.calls[0][0]).not.toHaveProperty('source_tree');
    expect(classifyIntent.mock.calls[0][0]).not.toHaveProperty('conversation');
    expect(classifyIntent.mock.calls[0][0]).not.toHaveProperty('working_brief');
    expect(result?.route).toBe('plan');
    expect(Object.isFrozen(result)).toBe(true);

    const inconsistent = await classifyIntent({ instruction: 'test' });
    classifyIntent.mockResolvedValueOnce({
      ...inconsistent,
      result: {
        ...inconsistent.result,
        route: 'build',
      },
    } as never);
    await expect(port.classifyIntent?.({ instruction: 'test' })).rejects.toMatchObject({
      code: 'builder_generation_failed',
    });
  });

  it('forwards approved-plan generation without renderer-owned text or source authority', async () => {
    const hostRequest = await createBuilderGenerationRequest('Review the approved plan.', PROJECT_ID);
    const draft = await createGenerationDraft(hostRequest);
    const generateApprovedPlan = vi.fn(async (request: unknown) => {
      void request;
      return {
        version: 'builder-generation-ipc-result.v1',
        ok: true,
        result: draft,
      };
    });
    const port = createBuilderDesktopCodeGeneratorPort({
      submit: async () => null,
      generateApprovedPlan,
      continueDraft: async (): Promise<unknown> => null,
      proposePlan: async () => null,
      preparePlanSourceReadApproval: async () => null,
      approvePlanSourceRead: async () => null,
      prepareCurrentProjectWriteApproval: async () => null,
      approveCurrentProjectWrite: async () => null,
      generate: async () => null,
      retry: async () => null,
      answer: async () => null,
      answerDraft: async () => null,
      restoreDraft: async () => null,
      restoreRevisionAsDraft: async () => null,
      rejectDraft: async () => null,
      cancel: async () => null,
      steer: async () => null,
      queueFollowup: async () => null,
      availability: async () => null,
      subscribeStarted: () => () => undefined,
      subscribeOutput: () => () => undefined,
    });

    const result = await port.generateApprovedPlan({
      project_id: PROJECT_ID,
      conversation_id: CONVERSATION_ID,
      turn_id: TURN_ID,
      run_id: RUN_ID,
    });

    expect(generateApprovedPlan).toHaveBeenCalledExactlyOnceWith({
      project_id: PROJECT_ID,
      conversation_id: CONVERSATION_ID,
      turn_id: TURN_ID,
      run_id: RUN_ID,
    });
    expect(generateApprovedPlan.mock.calls[0][0]).not.toHaveProperty('instruction');
    expect(generateApprovedPlan.mock.calls[0][0]).not.toHaveProperty('request_digest');
    expect(generateApprovedPlan.mock.calls[0][0]).not.toHaveProperty('source_tree');
    expect(result).toEqual(draft);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('forwards pending draft continuation with only draft-id and instruction authority', async () => {
    const request = await createBuilderGenerationRequest('Make the draft responsive.', PROJECT_ID);
    const draft = await createGenerationDraft(request);
    const continueDraft = vi.fn(async (request: unknown) => {
      void request;
      return {
        version: 'builder-generation-ipc-result.v1',
        ok: true,
        result: draft,
      };
    });
    const port = createBuilderDesktopCodeGeneratorPort({
      submit: async () => null,
      generateApprovedPlan: async () => null,
      continueDraft,
      proposePlan: async () => null,
      preparePlanSourceReadApproval: async () => null,
      approvePlanSourceRead: async () => null,
      prepareCurrentProjectWriteApproval: async () => null,
      approveCurrentProjectWrite: async () => null,
      generate: async () => null,
      retry: async () => null,
      answer: async () => null,
      answerDraft: async () => null,
      restoreDraft: async () => null,
      restoreRevisionAsDraft: async () => null,
      rejectDraft: async () => null,
      cancel: async () => null,
      steer: async () => null,
      queueFollowup: async () => null,
      availability: async () => null,
      subscribeStarted: () => () => undefined,
      subscribeOutput: () => () => undefined,
    });

    const result = await port.continueDraft({
      draft_id: DRAFT_ID,
      instruction: request.instruction,
    });

    expect(continueDraft).toHaveBeenCalledExactlyOnceWith({
      draft_id: DRAFT_ID,
      instruction: request.instruction,
    });
    expect(continueDraft.mock.calls[0][0]).not.toHaveProperty('existing_project_id');
    expect(continueDraft.mock.calls[0][0]).not.toHaveProperty('request_digest');
    expect(continueDraft.mock.calls[0][0]).not.toHaveProperty('source_tree');
    expect(result).toEqual(draft);
    expect(Object.isFrozen(result)).toBe(true);
    const queuedFollowup = Object.freeze({
      turn_id: TURN_ID,
      run_id: RUN_ID,
      message_id: 'builder-message:123e4567-e89b-42d3-a456-426614174088',
    });
    await port.continueDraft({
      draft_id: DRAFT_ID,
      instruction: request.instruction,
      queued_followup: queuedFollowup,
    });
    expect(continueDraft).toHaveBeenLastCalledWith({
      draft_id: DRAFT_ID,
      instruction: request.instruction,
      queued_followup: queuedFollowup,
    });
    expect(() => port.continueDraft({
      draft_id: 'builder-generation-draft:not-a-draft-id',
      instruction: request.instruction,
    })).toThrow(BuilderDesktopCodeGeneratorPortError);
  });

  it('preserves static preview rejection diagnostics for pending draft continuation', async () => {
    const port = createBuilderDesktopCodeGeneratorPort({
      submit: async () => null,
      generateApprovedPlan: async () => null,
      continueDraft: async () => ({
        version: 'builder-generation-ipc-result.v1',
        ok: false,
        error: {
          code: 'builder_generation_static_preview_contract_rejected',
          retryable: true,
        },
      }),
      proposePlan: async () => null,
      preparePlanSourceReadApproval: async () => null,
      approvePlanSourceRead: async () => null,
      prepareCurrentProjectWriteApproval: async () => null,
      approveCurrentProjectWrite: async () => null,
      generate: async () => null,
      retry: async () => null,
      answer: async () => null,
      answerDraft: async () => null,
      restoreDraft: async () => null,
      restoreRevisionAsDraft: async () => null,
      rejectDraft: async () => null,
      cancel: async () => null,
      steer: async () => null,
      queueFollowup: async () => null,
      availability: async () => null,
      subscribeStarted: () => () => undefined,
      subscribeOutput: () => () => undefined,
    });

    await expect(port.continueDraft({
      draft_id: DRAFT_ID,
      instruction: '继续优化',
    })).rejects.toMatchObject({
      code: 'builder_generation_static_preview_contract_rejected',
      retryable: true,
      message: 'The generated project needs browser preview support.',
    });
  });

  it('forwards pending draft questions with only draft-id and instruction authority', async () => {
    const request = await createBuilderGenerationRequest('Why is the preview blank?', PROJECT_ID);
    const answerResult = await createGenerationAnswer(request);
    const answerDraft = vi.fn(async (request: unknown) => {
      void request;
      return {
        version: 'builder-generation-ipc-result.v1',
        ok: true,
        result: answerResult,
      };
    });
    const port = createBuilderDesktopCodeGeneratorPort({
      submit: async () => null,
      generateApprovedPlan: async () => null,
      continueDraft: async () => null,
      proposePlan: async () => null,
      preparePlanSourceReadApproval: async () => null,
      approvePlanSourceRead: async () => null,
      prepareCurrentProjectWriteApproval: async () => null,
      approveCurrentProjectWrite: async () => null,
      generate: async () => null,
      retry: async () => null,
      answer: async () => null,
      answerDraft,
      restoreDraft: async () => null,
      restoreRevisionAsDraft: async () => null,
      rejectDraft: async () => null,
      cancel: async () => null,
      steer: async () => null,
      queueFollowup: async () => null,
      availability: async () => null,
      subscribeStarted: () => () => undefined,
      subscribeOutput: () => () => undefined,
    });

    const result = await port.answerDraft({
      draft_id: DRAFT_ID,
      instruction: request.instruction,
    });

    expect(answerDraft).toHaveBeenCalledExactlyOnceWith({
      draft_id: DRAFT_ID,
      instruction: request.instruction,
    });
    expect(answerDraft.mock.calls[0][0]).not.toHaveProperty('existing_project_id');
    expect(answerDraft.mock.calls[0][0]).not.toHaveProperty('request_digest');
    expect(answerDraft.mock.calls[0][0]).not.toHaveProperty('source_tree');
    expect(result).toEqual(answerResult);
    expect(Object.isFrozen(result)).toBe(true);
    expect(() => port.answerDraft({
      draft_id: 'builder-generation-draft:not-a-draft-id',
      instruction: request.instruction,
    })).toThrow(BuilderDesktopCodeGeneratorPortError);
  });

  it('forwards one plan proposal request without renderer-owned authority', async () => {
    const request = await createBuilderGenerationRequest('Plan the saved project update.', PROJECT_ID);
    const proposedPlan = Object.freeze({
      version: 'builder-generation-result.v2',
      result_kind: 'plan',
      request_id: request.request_digest,
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
    });
    const proposePlan = vi.fn(async (request: unknown) => {
      void request;
      return {
        version: 'builder-generation-ipc-result.v1',
        ok: true,
        result: proposedPlan,
      };
    });
    const port = createBuilderDesktopCodeGeneratorPort({
      submit: async () => null,
      generateApprovedPlan: async () => null,
      continueDraft: async () => null,
      proposePlan,
      preparePlanSourceReadApproval: async () => null,
      approvePlanSourceRead: async () => null,
      prepareCurrentProjectWriteApproval: async () => null,
      approveCurrentProjectWrite: async () => null,
      generate: async () => null,
      retry: async () => null,
      answer: async () => null,
      answerDraft: async () => null,
      restoreDraft: async () => null,
      restoreRevisionAsDraft: async () => null,
      rejectDraft: async () => null,
      cancel: async () => null,
      steer: async () => null,
      queueFollowup: async () => null,
      availability: async () => null,
      subscribeStarted: () => () => undefined,
      subscribeOutput: () => () => undefined,
    });

    const result = await port.proposePlan(request);

    expect(proposePlan).toHaveBeenCalledExactlyOnceWith({ instruction: request.instruction });
    expect(proposePlan.mock.calls[0][0]).not.toHaveProperty('existing_project_id');
    expect(proposePlan.mock.calls[0][0]).not.toHaveProperty('request_digest');
    expect(proposePlan.mock.calls[0][0]).not.toHaveProperty('source_tree');
    expect(result).toEqual(proposedPlan);
    expect(result).not.toBe(proposedPlan);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('forwards plan source-read approval without renderer-owned resource or grant authority', async () => {
    const preparePlanSourceReadApproval = vi.fn(async (request: unknown) => ({
      version: 'builder-generation-ipc-result.v1',
      ok: true,
      result: {
        result_version: 'builder-plan-source-read-approval-status.v1',
        project_id: (request as { project_id: string }).project_id,
        state: 'approval_required',
        file_count: 1232,
        approval_scope: 'current_project_plan_source_read',
        authority: 'main_selected_project_bounded_filesystem_read_v1',
      },
    }));
    const approvePlanSourceRead = vi.fn(async (request: unknown) => ({
      version: 'builder-generation-ipc-result.v1',
      ok: true,
      result: {
        result_version: 'builder-plan-source-read-approval-result.v1',
        project_id: (request as { project_id: string }).project_id,
        operation: 'approval_recorded',
        file_count: 1232,
        approval_scope: 'current_project_plan_source_read',
        authority: 'main_selected_project_bounded_filesystem_read_v1',
      },
    }));
    const prepareCurrentProjectWriteApproval = vi.fn(async () => ({
      version: 'builder-generation-ipc-result.v1',
      ok: true,
      result: {
        result_version: 'builder-current-project-write-approval-status.v1',
        project_id: PROJECT_ID,
        state: 'ready',
        approval_scope: 'current_project_write',
        authority: 'main_selected_project_project_edit_v1',
      },
    }));
    const approveCurrentProjectWrite = vi.fn(async () => ({
      version: 'builder-generation-ipc-result.v1',
      ok: true,
      result: {
        result_version: 'builder-current-project-write-approval-result.v1',
        project_id: PROJECT_ID,
        operation: 'already_approved',
        approval_scope: 'current_project_write',
        authority: 'main_selected_project_project_edit_v1',
      },
    }));
    const port = createBuilderDesktopCodeGeneratorPort({
      submit: async () => null,
      generateApprovedPlan: async () => null,
      continueDraft: async () => null,
      proposePlan: async () => null,
      preparePlanSourceReadApproval,
      approvePlanSourceRead,
      prepareCurrentProjectWriteApproval,
      approveCurrentProjectWrite,
      generate: async () => null,
      retry: async () => null,
      answer: async () => null,
      answerDraft: async () => null,
      restoreDraft: async () => null,
      restoreRevisionAsDraft: async () => null,
      rejectDraft: async () => null,
      cancel: async () => null,
      steer: async () => null,
      queueFollowup: async () => null,
      availability: async () => null,
      subscribeStarted: () => () => undefined,
      subscribeOutput: () => () => undefined,
    });

    const status = await port.preparePlanSourceReadApproval({ project_id: PROJECT_ID });
    const approved = await port.approvePlanSourceRead({ project_id: PROJECT_ID });

    expect(preparePlanSourceReadApproval).toHaveBeenCalledExactlyOnceWith({ project_id: PROJECT_ID });
    expect(approvePlanSourceRead).toHaveBeenCalledExactlyOnceWith({ project_id: PROJECT_ID });
    expect(status.state).toBe('approval_required');
    expect(status.file_count).toBe(1232);
    expect(approved.operation).toBe('approval_recorded');
    expect(approved.file_count).toBe(1232);
    expect(JSON.stringify({ status, approved })).not.toMatch(/permission_id|resource_id|source_tree/iu);
    expect(Object.isFrozen(status)).toBe(true);
    expect(Object.isFrozen(approved)).toBe(true);
  });

  it('forwards current-project write approval without exposing permission grant authority', async () => {
    const prepareCurrentProjectWriteApproval = vi.fn(async (request: unknown) => ({
      version: 'builder-generation-ipc-result.v1',
      ok: true,
      result: {
        result_version: 'builder-current-project-write-approval-status.v1',
        project_id: (request as { project_id: string }).project_id,
        state: 'approval_required',
        approval_scope: 'current_project_write',
        authority: 'main_selected_project_project_edit_v1',
      },
    }));
    const approveCurrentProjectWrite = vi.fn(async (request: unknown) => ({
      version: 'builder-generation-ipc-result.v1',
      ok: true,
      result: {
        result_version: 'builder-current-project-write-approval-result.v1',
        project_id: (request as { project_id: string }).project_id,
        operation: 'approval_recorded',
        approval_scope: 'current_project_write',
        authority: 'main_selected_project_project_edit_v1',
      },
    }));
    const port = createBuilderDesktopCodeGeneratorPort({
      submit: async () => null,
      generateApprovedPlan: async () => null,
      continueDraft: async () => null,
      proposePlan: async () => null,
      preparePlanSourceReadApproval: async () => null,
      approvePlanSourceRead: async () => null,
      prepareCurrentProjectWriteApproval,
      approveCurrentProjectWrite,
      generate: async () => null,
      retry: async () => null,
      answer: async () => null,
      answerDraft: async () => null,
      restoreDraft: async () => null,
      restoreRevisionAsDraft: async () => null,
      rejectDraft: async () => null,
      cancel: async () => null,
      steer: async () => null,
      queueFollowup: async () => null,
      availability: async () => null,
      subscribeStarted: () => () => undefined,
      subscribeOutput: () => () => undefined,
    });

    const status = await port.prepareCurrentProjectWriteApproval({ project_id: PROJECT_ID });
    const approved = await port.approveCurrentProjectWrite({ project_id: PROJECT_ID });

    expect(prepareCurrentProjectWriteApproval).toHaveBeenCalledExactlyOnceWith({ project_id: PROJECT_ID });
    expect(approveCurrentProjectWrite).toHaveBeenCalledExactlyOnceWith({ project_id: PROJECT_ID });
    expect(status.state).toBe('approval_required');
    expect(approved.operation).toBe('approval_recorded');
    expect(JSON.stringify({ status, approved })).not.toMatch(/permission_id|resource_id|source_tree|grant/iu);
    expect(Object.isFrozen(status)).toBe(true);
    expect(Object.isFrozen(approved)).toBe(true);
  });

  it('forwards one submit request without renderer-owned authority', async () => {
    const request = await createBuilderGenerationRequest('Make a timer.');
    const draft = await createGenerationDraft(request);
    const submit = vi.fn(async (request: unknown) => {
      void request;
      return {
        version: 'builder-generation-ipc-result.v1',
        ok: true,
        result: draft,
      };
    });
    const port = createBuilderDesktopCodeGeneratorPort({
      submit,
      generateApprovedPlan: async () => null,
      continueDraft: async () => null,
      proposePlan: async () => null,
      preparePlanSourceReadApproval: async () => null,
      approvePlanSourceRead: async () => null,
      prepareCurrentProjectWriteApproval: async () => null,
      approveCurrentProjectWrite: async () => null,
      generate: async () => null,
      retry: async () => null,
      answer: async () => null,
      answerDraft: async () => null,
      restoreDraft: async () => null,
      restoreRevisionAsDraft: async () => null,
      rejectDraft: async () => null,
      cancel: async () => null,
      steer: async () => null,
      queueFollowup: async () => null,
      availability: async () => null,
      subscribeStarted: () => () => undefined,
      subscribeOutput: () => () => undefined,
    });

    const result = await port.submit(request);

    expect(submit).toHaveBeenCalledExactlyOnceWith({ instruction: request.instruction });
    expect(submit.mock.calls[0][0]).not.toHaveProperty('existing_project_id');
    expect(submit.mock.calls[0][0]).not.toHaveProperty('request_digest');
    expect(result).toEqual(draft);
    expect(result).not.toBe(draft);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('forwards queued follow-up references only as bounded submit receipts', async () => {
    const request = await createBuilderGenerationRequest('Create the improved page.', PROJECT_ID);
    const draft = await createGenerationDraft(request);
    const queuedFollowup = Object.freeze({
      turn_id: TURN_ID,
      run_id: RUN_ID,
      message_id: 'builder-message:123e4567-e89b-42d3-a456-426614174088',
    });
    const submit = vi.fn(async (payload: unknown) => {
      expect(payload).toBeDefined();
      return {
        version: 'builder-generation-ipc-result.v1',
        ok: true,
        result: draft,
      };
    });
    const port = createBuilderDesktopCodeGeneratorPort({
      submit,
      generateApprovedPlan: async () => null,
      continueDraft: async () => null,
      proposePlan: async () => null,
      preparePlanSourceReadApproval: async () => null,
      approvePlanSourceRead: async () => null,
      prepareCurrentProjectWriteApproval: async () => null,
      approveCurrentProjectWrite: async () => null,
      generate: async () => null,
      retry: async () => null,
      answer: async () => null,
      answerDraft: async () => null,
      restoreDraft: async () => null,
      restoreRevisionAsDraft: async () => null,
      rejectDraft: async () => null,
      cancel: async () => null,
      steer: async () => null,
      queueFollowup: async () => null,
      availability: async () => null,
      subscribeStarted: () => () => undefined,
      subscribeOutput: () => () => undefined,
    });

    await port.submit({ ...request, queued_followup: queuedFollowup });

    expect(submit).toHaveBeenCalledExactlyOnceWith({
      instruction: request.instruction,
      queued_followup: queuedFollowup,
    });
    expect(submit.mock.calls[0][0]).not.toHaveProperty('existing_project_id');
    expect(submit.mock.calls[0][0]).not.toHaveProperty('request_digest');
    expect(submit.mock.calls[0][0]).not.toHaveProperty('source_tree');
  });

  it('subscribes to started hints without accepting malformed renderer events', async () => {
    const request = await createBuilderGenerationRequest('Make a timer.');
    const listeners: Array<(event: unknown) => void> = [];
    const unsubscribeBridge = vi.fn();
    const port = createBuilderDesktopCodeGeneratorPort({
      submit: async () => null,
      generateApprovedPlan: async () => null,
      continueDraft: async () => null,
      proposePlan: async () => null,
      preparePlanSourceReadApproval: async () => null,
      approvePlanSourceRead: async () => null,
      prepareCurrentProjectWriteApproval: async () => null,
      approveCurrentProjectWrite: async () => null,
      generate: async () => null,
      retry: async () => null,
      answer: async () => null,
      answerDraft: async () => null,
      restoreDraft: async () => null,
      restoreRevisionAsDraft: async () => null,
      rejectDraft: async () => null,
      cancel: async () => null,
      steer: async () => null,
      queueFollowup: async () => null,
      availability: async () => null,
      subscribeStarted(listener: (event: unknown) => void) {
        listeners.push(listener);
        return unsubscribeBridge;
      },
      subscribeOutput: () => () => undefined,
    });
    const listener = vi.fn();
    const unsubscribe = port.subscribeStarted!(listener);

    expect(listeners).toHaveLength(1);
    listeners[0]!({
      event_version: 'builder-generation-started.v1',
      request_id: request.request_digest,
      project_id: PROJECT_ID,
    });
    listeners[0]!({
      event_version: 'builder-generation-started.v1',
      request_id: `sha256:${'9'.repeat(64)}`,
      project_id: 'builder-project:not-a-real-project',
      credential: 'private',
    });
    unsubscribe();
    listeners[0]!({
      event_version: 'builder-generation-started.v1',
      request_id: request.request_digest,
      project_id: PROJECT_ID,
    });

    expect(listener).toHaveBeenCalledExactlyOnceWith({
      event_version: 'builder-generation-started.v1',
      request_id: request.request_digest,
      project_id: PROJECT_ID,
    });
    expect(Object.isFrozen(listener.mock.calls[0]![0])).toBe(true);
    expect(unsubscribeBridge).toHaveBeenCalledOnce();
  });

  it('subscribes to display-safe output deltas without accepting malformed renderer events', async () => {
    const request = await createBuilderGenerationRequest('Make a timer.');
    const listeners: Array<(event: unknown) => void> = [];
    const unsubscribeBridge = vi.fn();
    const port = createBuilderDesktopCodeGeneratorPort({
      submit: async () => null,
      generateApprovedPlan: async () => null,
      continueDraft: async () => null,
      proposePlan: async () => null,
      preparePlanSourceReadApproval: async () => null,
      approvePlanSourceRead: async () => null,
      prepareCurrentProjectWriteApproval: async () => null,
      approveCurrentProjectWrite: async () => null,
      generate: async () => null,
      retry: async () => null,
      answer: async () => null,
      answerDraft: async () => null,
      restoreDraft: async () => null,
      restoreRevisionAsDraft: async () => null,
      rejectDraft: async () => null,
      cancel: async () => null,
      steer: async () => null,
      queueFollowup: async () => null,
      availability: async () => null,
      subscribeStarted: () => () => undefined,
      subscribeOutput(listener: (event: unknown) => void) {
        listeners.push(listener);
        return unsubscribeBridge;
      },
    });
    const listener = vi.fn();
    const unsubscribe = port.subscribeOutput!(listener);
    const conversationId = `builder-conversation:${PROJECT_ID.slice('builder-project:'.length)}`;

    expect(listeners).toHaveLength(1);
    listeners[0]!({
      event_version: 'builder-generation-output.v1',
      request_id: request.request_digest,
      project_id: PROJECT_ID,
      conversation_id: conversationId,
      turn_id: 'builder-turn:123e4567-e89b-42d3-a456-426614174001',
      task_id: null,
      run_id: 'builder-run:123e4567-e89b-42d3-a456-426614174003',
      display_delta_text: 'A quiet timer',
    });
    listeners[0]!({
      event_version: 'builder-generation-output.v1',
      request_id: request.request_digest,
      project_id: PROJECT_ID,
      conversation_id: conversationId,
      turn_id: 'builder-turn:123e4567-e89b-42d3-a456-426614174001',
      task_id: null,
      run_id: 'builder-run:123e4567-e89b-42d3-a456-426614174003',
      display_delta_text: '',
      provider: 'private',
    });
    unsubscribe();
    listeners[0]!({
      event_version: 'builder-generation-output.v1',
      request_id: request.request_digest,
      project_id: PROJECT_ID,
      conversation_id: conversationId,
      turn_id: 'builder-turn:123e4567-e89b-42d3-a456-426614174001',
      task_id: null,
      run_id: 'builder-run:123e4567-e89b-42d3-a456-426614174003',
      display_delta_text: ' after unsubscribe',
    });

    expect(listener).toHaveBeenCalledExactlyOnceWith({
      event_version: 'builder-generation-output.v1',
      request_id: request.request_digest,
      project_id: PROJECT_ID,
      conversation_id: conversationId,
      turn_id: 'builder-turn:123e4567-e89b-42d3-a456-426614174001',
      task_id: null,
      run_id: 'builder-run:123e4567-e89b-42d3-a456-426614174003',
      display_delta_text: 'A quiet timer',
    });
    expect(Object.isFrozen(listener.mock.calls[0]![0])).toBe(true);
    expect(unsubscribeBridge).toHaveBeenCalledOnce();
  });

  it('forwards one retry request without renderer-owned authority', async () => {
    const request = await createBuilderGenerationRequest('Make a timer.');
    const draft = await createGenerationDraft(request);
    const retry = vi.fn(async (request: unknown) => {
      void request;
      return {
        version: 'builder-generation-ipc-result.v1',
        ok: true,
        result: draft,
      };
    });
    const port = createBuilderDesktopCodeGeneratorPort({
      submit: async () => null,
      generateApprovedPlan: async () => null,
      continueDraft: async () => null,
      proposePlan: async () => null,
      preparePlanSourceReadApproval: async () => null,
      approvePlanSourceRead: async () => null,
      prepareCurrentProjectWriteApproval: async () => null,
      approveCurrentProjectWrite: async () => null,
      generate: async () => null,
      retry,
      answer: async () => null,
      answerDraft: async () => null,
      restoreDraft: async () => null,
      restoreRevisionAsDraft: async () => null,
      rejectDraft: async () => null,
      cancel: async () => null,
      steer: async () => null,
      queueFollowup: async () => null,
      availability: async () => null,
      subscribeStarted: () => () => undefined,
      subscribeOutput: () => () => undefined,
    });

    const result = await port.retry(request);

    expect(retry).toHaveBeenCalledExactlyOnceWith({ instruction: request.instruction });
    expect(retry.mock.calls[0][0]).not.toHaveProperty('existing_project_id');
    expect(retry.mock.calls[0][0]).not.toHaveProperty('request_digest');
    expect(result).toEqual(draft);
    expect(result).not.toBe(draft);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('maps fixed diagnostic envelopes without raw provider details', async () => {
    const request = await createBuilderGenerationRequest('Make a timer.');
    const port = createBuilderDesktopCodeGeneratorPort({
      submit: async () => ({
        version: 'builder-generation-ipc-result.v1',
        ok: false,
        error: {
          code: 'builder_generation_provider_transport_error',
          retryable: true,
        },
      }),
      generateApprovedPlan: async () => null,
      continueDraft: async () => null,
      proposePlan: async () => null,
      preparePlanSourceReadApproval: async () => null,
      approvePlanSourceRead: async () => null,
      prepareCurrentProjectWriteApproval: async () => null,
      approveCurrentProjectWrite: async () => null,
      generate: async () => ({
        version: 'builder-generation-ipc-result.v1',
        ok: false,
        error: {
          code: 'builder_generation_provider_transport_error',
          retryable: true,
        },
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
      availability: async () => null,
      subscribeStarted: () => () => undefined,
      subscribeOutput: () => () => undefined,
    });

    await expect(port.generate(request)).rejects.toMatchObject({
      code: 'builder_generation_provider_transport_error',
      retryable: true,
      message: 'The AI service could not be reached.',
    });
  });

  it.each([
    [
      'builder_generation_workspace_changed',
      true,
      'The project changed while AI was working. Review it and try again.',
    ],
    [
      'builder_generation_workspace_guard_denied',
      false,
      'The proposed file changes were blocked to protect this project.',
    ],
    [
      'builder_generation_workspace_guard_approval_required',
      false,
      'The proposed file changes need additional approval.',
    ],
  ] as const)('maps the fixed %s diagnostic envelope', async (code, retryable, message) => {
    const request = await createBuilderGenerationRequest('Update the project safely.');
    const port = createBuilderDesktopCodeGeneratorPort({
      submit: async () => null,
      generateApprovedPlan: async () => null,
      continueDraft: async () => null,
      proposePlan: async () => null,
      preparePlanSourceReadApproval: async () => null,
      approvePlanSourceRead: async () => null,
      prepareCurrentProjectWriteApproval: async () => null,
      approveCurrentProjectWrite: async () => null,
      generate: async () => ({
        version: 'builder-generation-ipc-result.v1',
        ok: false,
        error: { code, retryable },
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
      availability: async () => null,
      subscribeStarted: () => () => undefined,
      subscribeOutput: () => () => undefined,
    });

    await expect(port.generate(request)).rejects.toMatchObject({ code, retryable, message });
  });

  it('forwards one bounded answer request without renderer-owned authority', async () => {
    const request = await createBuilderGenerationRequest('What does this project do?');
    const explanation = Object.freeze({
      version: 'builder-generation-result.v2',
      result_kind: 'explanation',
      request_id: request.request_digest,
      project_id: null,
      existing_project_id: null,
      title: 'Current project',
      summary: 'Explains the current project.',
      explanation: 'This answer does not change files.',
      admissions: {
        conversation: 'sqlite_recorded',
        draft: 'not_created',
        save: 'not_performed',
        preview: 'not_applicable',
        execution: 'not_evaluated',
      },
    });
    const answer = vi.fn(async (request: unknown) => {
      void request;
      return {
        version: 'builder-generation-ipc-result.v1',
        ok: true,
        result: explanation,
      };
    });
    const port = createBuilderDesktopCodeGeneratorPort({
      submit: async () => null,
      generateApprovedPlan: async () => null,
      continueDraft: async () => null,
      proposePlan: async () => null,
      preparePlanSourceReadApproval: async () => null,
      approvePlanSourceRead: async () => null,
      prepareCurrentProjectWriteApproval: async () => null,
      approveCurrentProjectWrite: async () => null,
      generate: async () => null,
      retry: async () => null,
      answer,
      answerDraft: async () => null,
      restoreDraft: async () => null,
      restoreRevisionAsDraft: async () => null,
      rejectDraft: async () => null,
      cancel: async () => null,
      steer: async () => null,
      queueFollowup: async () => null,
      availability: async () => null,
      subscribeStarted: () => () => undefined,
      subscribeOutput: () => () => undefined,
    });

    const result = await port.answer(request);

    expect(answer).toHaveBeenCalledExactlyOnceWith({ instruction: request.instruction });
    expect(answer.mock.calls[0][0]).not.toHaveProperty('existing_project_id');
    expect(answer.mock.calls[0][0]).not.toHaveProperty('request_digest');
    expect(result).toEqual(explanation);
    expect(result).not.toBe(explanation);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('forwards only draft id when restoring a pending draft', async () => {
    const restoredDraft = await createRestoredGenerationDraft();
    const restoreDraft = vi.fn(async () => ({
      version: 'builder-generation-ipc-result.v1',
      ok: true,
      result: restoredDraft,
    }));
    const port = createBuilderDesktopCodeGeneratorPort({
      submit: async () => null,
      generateApprovedPlan: async () => null,
      continueDraft: async () => null,
      proposePlan: async () => null,
      preparePlanSourceReadApproval: async () => null,
      approvePlanSourceRead: async () => null,
      prepareCurrentProjectWriteApproval: async () => null,
      approveCurrentProjectWrite: async () => null,
      generate: async () => null,
      retry: async () => null,
      answer: async () => null,
      answerDraft: async () => null,
      restoreDraft,
      restoreRevisionAsDraft: async () => null,
      rejectDraft: async () => null,
      cancel: async () => null,
      steer: async () => null,
      queueFollowup: async () => null,
      availability: async () => null,
      subscribeStarted: () => () => undefined,
      subscribeOutput: () => () => undefined,
    });

    const result = await port.restoreDraft({ draft_id: restoredDraft.draft_id });

    expect(restoreDraft).toHaveBeenCalledExactlyOnceWith({ draft_id: restoredDraft.draft_id });
    expect(result).toEqual(restoredDraft);
    expect(result).not.toBe(restoredDraft);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('forwards only project id and revision receipt when restoring a saved version as a draft', async () => {
    const hostRequest = await createBuilderGenerationRequest('Restore an earlier saved version.', PROJECT_ID);
    const restoredDraft = await createGenerationDraft(hostRequest);
    const revisionReceiptDigest = `sha256:${'2'.repeat(64)}`;
    const restoreRevisionAsDraft = vi.fn(async (request: unknown) => {
      void request;
      return {
      version: 'builder-generation-ipc-result.v1',
      ok: true,
      result: restoredDraft,
      };
    });
    const port = createBuilderDesktopCodeGeneratorPort({
      submit: async () => null,
      generateApprovedPlan: async () => null,
      continueDraft: async () => null,
      proposePlan: async () => null,
      preparePlanSourceReadApproval: async () => null,
      approvePlanSourceRead: async () => null,
      prepareCurrentProjectWriteApproval: async () => null,
      approveCurrentProjectWrite: async () => null,
      generate: async () => null,
      retry: async () => null,
      answer: async () => null,
      answerDraft: async () => null,
      restoreDraft: async () => null,
      restoreRevisionAsDraft,
      rejectDraft: async () => null,
      cancel: async () => null,
      steer: async () => null,
      queueFollowup: async () => null,
      availability: async () => null,
      subscribeStarted: () => () => undefined,
      subscribeOutput: () => () => undefined,
    });

    const result = await port.restoreRevisionAsDraft({
      project_id: PROJECT_ID,
      revision_receipt_digest: revisionReceiptDigest,
    });

    expect(restoreRevisionAsDraft).toHaveBeenCalledExactlyOnceWith({
      project_id: PROJECT_ID,
      revision_receipt_digest: revisionReceiptDigest,
    });
    expect(restoreRevisionAsDraft.mock.calls[0][0]).not.toHaveProperty('instruction');
    expect(restoreRevisionAsDraft.mock.calls[0][0]).not.toHaveProperty('request_digest');
    expect(restoreRevisionAsDraft.mock.calls[0][0]).not.toHaveProperty('source_tree');
    expect(result).toEqual(restoredDraft);
    expect(result).not.toBe(restoredDraft);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('forwards only draft id when discarding a pending draft', async () => {
    const draftId = `builder-generation-draft:${'1'.repeat(64)}`;
    const rejectDraft = vi.fn(async () => ({
      version: 'builder-generation-ipc-result.v1',
      ok: true,
      result: {
        result_version: 'builder-generation-draft-rejection-result.v1',
        draft_id: draftId,
        project_id: `builder-project:123e4567-e89b-42d3-a456-426614174000`,
        rejected: true,
        pending_draft_released: true,
        conversation_event_admission: 'sqlite_recorded',
      },
    }));
    const port = createBuilderDesktopCodeGeneratorPort({
      submit: async () => null,
      generateApprovedPlan: async () => null,
      continueDraft: async () => null,
      proposePlan: async () => null,
      preparePlanSourceReadApproval: async () => null,
      approvePlanSourceRead: async () => null,
      prepareCurrentProjectWriteApproval: async () => null,
      approveCurrentProjectWrite: async () => null,
      generate: async () => null,
      retry: async () => null,
      answer: async () => null,
      answerDraft: async () => null,
      restoreDraft: async () => null,
      restoreRevisionAsDraft: async () => null,
      rejectDraft,
      cancel: async () => null,
      steer: async () => null,
      queueFollowup: async () => null,
      availability: async () => null,
      subscribeStarted: () => () => undefined,
      subscribeOutput: () => () => undefined,
    });

    const result = await port.rejectDraft({ draft_id: draftId });

    expect(rejectDraft).toHaveBeenCalledExactlyOnceWith({ draft_id: draftId });
    expect(JSON.stringify(result)).not.toMatch(/source_tree|candidate_digest|provider|credential/iu);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('forwards only request id when cancelling active AI work', async () => {
    const request = await createBuilderGenerationRequest('Make a timer.');
    const cancel = vi.fn(async (request: unknown) => ({
      request_id: (request as { request_id: string }).request_id,
      cancelled: true,
    }));
    const port = createBuilderDesktopCodeGeneratorPort({
      submit: async () => null,
      generateApprovedPlan: async () => null,
      continueDraft: async () => null,
      proposePlan: async () => null,
      preparePlanSourceReadApproval: async () => null,
      approvePlanSourceRead: async () => null,
      prepareCurrentProjectWriteApproval: async () => null,
      approveCurrentProjectWrite: async () => null,
      generate: async () => null,
      retry: async () => null,
      answer: async () => null,
      answerDraft: async () => null,
      restoreDraft: async () => null,
      restoreRevisionAsDraft: async () => null,
      rejectDraft: async () => null,
      cancel,
      steer: async () => null,
      queueFollowup: async () => null,
      availability: async () => null,
      subscribeStarted: () => () => undefined,
      subscribeOutput: () => () => undefined,
    });

    const result = await port.cancel({ request_id: request.request_digest });

    expect(cancel).toHaveBeenCalledExactlyOnceWith({ request_id: request.request_digest });
    expect(cancel.mock.calls[0][0]).not.toHaveProperty('instruction');
    expect(cancel.mock.calls[0][0]).not.toHaveProperty('source_tree');
    expect(result).toEqual({ request_id: request.request_digest, cancelled: true });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('forwards only request id and message when steering active AI work', async () => {
    const request = await createBuilderGenerationRequest('Make a timer.');
    const steer = vi.fn(async (request: unknown) => ({
      request_id: (request as { request_id: string }).request_id,
      steered: true,
    }));
    const port = createBuilderDesktopCodeGeneratorPort({
      submit: async () => null,
      generateApprovedPlan: async () => null,
      continueDraft: async () => null,
      proposePlan: async () => null,
      preparePlanSourceReadApproval: async () => null,
      approvePlanSourceRead: async () => null,
      prepareCurrentProjectWriteApproval: async () => null,
      approveCurrentProjectWrite: async () => null,
      generate: async () => null,
      retry: async () => null,
      answer: async () => null,
      answerDraft: async () => null,
      restoreDraft: async () => null,
      restoreRevisionAsDraft: async () => null,
      rejectDraft: async () => null,
      cancel: async () => null,
      steer,
      queueFollowup: async () => null,
      availability: async () => null,
      subscribeStarted: () => () => undefined,
      subscribeOutput: () => () => undefined,
    });

    const result = await port.steer({
      request_id: request.request_digest,
      message: 'Make it calmer while you continue.',
    });

    expect(steer).toHaveBeenCalledExactlyOnceWith({
      request_id: request.request_digest,
      message: 'Make it calmer while you continue.',
    });
    expect(steer.mock.calls[0][0]).not.toHaveProperty('instruction');
    expect(steer.mock.calls[0][0]).not.toHaveProperty('source_tree');
    expect(steer.mock.calls[0][0]).not.toHaveProperty('project_id');
    expect(result).toEqual({ request_id: request.request_digest, steered: true });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('forwards only request id and message when queueing an active follow-up', async () => {
    const request = await createBuilderGenerationRequest('Make a timer.');
    const queuedFollowup = Object.freeze({
      turn_id: TURN_ID,
      run_id: RUN_ID,
      message_id: 'builder-message:123e4567-e89b-42d3-a456-426614174088',
    });
    const queueFollowup = vi.fn(async (request: unknown) => ({
      request_id: (request as { request_id: string }).request_id,
      queued: true,
      queued_followup: queuedFollowup,
    }));
    const port = createBuilderDesktopCodeGeneratorPort({
      submit: async () => null,
      generateApprovedPlan: async () => null,
      continueDraft: async () => null,
      proposePlan: async () => null,
      preparePlanSourceReadApproval: async () => null,
      approvePlanSourceRead: async () => null,
      prepareCurrentProjectWriteApproval: async () => null,
      approveCurrentProjectWrite: async () => null,
      generate: async () => null,
      retry: async () => null,
      answer: async () => null,
      answerDraft: async () => null,
      restoreDraft: async () => null,
      restoreRevisionAsDraft: async () => null,
      rejectDraft: async () => null,
      cancel: async () => null,
      steer: async () => null,
      queueFollowup,
      availability: async () => null,
      subscribeStarted: () => () => undefined,
      subscribeOutput: () => () => undefined,
    });

    const result = await port.queueFollowup({
      request_id: request.request_digest,
      message: 'After this, make it responsive.',
    });

    expect(queueFollowup).toHaveBeenCalledExactlyOnceWith({
      request_id: request.request_digest,
      message: 'After this, make it responsive.',
    });
    expect(queueFollowup.mock.calls[0][0]).not.toHaveProperty('instruction');
    expect(queueFollowup.mock.calls[0][0]).not.toHaveProperty('source_tree');
    expect(queueFollowup.mock.calls[0][0]).not.toHaveProperty('project_id');
    expect(result).toEqual({
      request_id: request.request_digest,
      queued: true,
      queued_followup: queuedFollowup,
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('maps restored draft parent drift to a fixed diagnostic', async () => {
    const port = createBuilderDesktopCodeGeneratorPort({
      submit: async () => null,
      generateApprovedPlan: async () => null,
      continueDraft: async () => null,
      proposePlan: async () => null,
      preparePlanSourceReadApproval: async () => null,
      approvePlanSourceRead: async () => null,
      prepareCurrentProjectWriteApproval: async () => null,
      approveCurrentProjectWrite: async () => null,
      generate: async () => null,
      retry: async () => null,
      answer: async () => null,
      answerDraft: async () => null,
      restoreDraft: async () => ({
        version: 'builder-generation-ipc-result.v1',
        ok: false,
        error: {
          code: 'builder_generation_parent_unavailable',
          retryable: true,
        },
      }),
      restoreRevisionAsDraft: async () => null,
      rejectDraft: async () => null,
      cancel: async () => null,
      steer: async () => null,
      queueFollowup: async () => null,
      availability: async () => null,
      subscribeStarted: () => () => undefined,
      subscribeOutput: () => () => undefined,
    });

    await expect(port.restoreDraft({
      draft_id: `builder-generation-draft:${'1'.repeat(64)}`,
    })).rejects.toMatchObject({
      code: 'builder_generation_parent_unavailable',
      retryable: true,
      message: 'The current project version is unavailable.',
    });
  });

  it('maps source context unavailability to a fixed retryable diagnostic', async () => {
    const request = await createBuilderGenerationRequest('Plan the saved project change.', PROJECT_ID);
    const port = createBuilderDesktopCodeGeneratorPort({
      submit: async () => null,
      generateApprovedPlan: async () => null,
      continueDraft: async () => null,
      proposePlan: async () => ({
        version: 'builder-generation-ipc-result.v1',
        ok: false,
        error: {
          code: 'builder_generation_base_unavailable',
          retryable: true,
        },
      }),
      preparePlanSourceReadApproval: async () => null,
      approvePlanSourceRead: async () => null,
      prepareCurrentProjectWriteApproval: async () => null,
      approveCurrentProjectWrite: async () => null,
      generate: async () => null,
      retry: async () => null,
      answer: async () => null,
      answerDraft: async () => null,
      restoreDraft: async () => null,
      restoreRevisionAsDraft: async () => null,
      rejectDraft: async () => null,
      cancel: async () => null,
      steer: async () => null,
      queueFollowup: async () => null,
      availability: async () => null,
      subscribeStarted: () => () => undefined,
      subscribeOutput: () => () => undefined,
    });

    await expect(port.proposePlan(request)).rejects.toMatchObject({
      code: 'builder_generation_base_unavailable',
      retryable: true,
      message: 'The current project source is unavailable.',
    });
  });

  it.each([
    null,
    {},
    {
      generateApprovedPlan: async (): Promise<unknown> => null,
      continueDraft: async (): Promise<unknown> => null,
      proposePlan: async (): Promise<unknown> => null,
      preparePlanSourceReadApproval: async (): Promise<unknown> => null,
      approvePlanSourceRead: async (): Promise<unknown> => null,
      prepareCurrentProjectWriteApproval: async (): Promise<unknown> => null,
      approveCurrentProjectWrite: async (): Promise<unknown> => null,
      generate: async (): Promise<unknown> => null,
      submit: async (): Promise<unknown> => null,
      retry: async (): Promise<unknown> => null,
      answer: async (): Promise<unknown> => null,
      answerDraft: async (): Promise<unknown> => null,
      restoreDraft: async (): Promise<unknown> => null,
      restoreRevisionAsDraft: async (): Promise<unknown> => null,
      rejectDraft: async (): Promise<unknown> => null,
      cancel: async (): Promise<unknown> => null,
    },
    {
      generateApprovedPlan: async (): Promise<unknown> => null,
      continueDraft: async () => null,
      proposePlan: async (): Promise<unknown> => null,
      preparePlanSourceReadApproval: async (): Promise<unknown> => null,
      approvePlanSourceRead: async (): Promise<unknown> => null,
      prepareCurrentProjectWriteApproval: async (): Promise<unknown> => null,
      approveCurrentProjectWrite: async (): Promise<unknown> => null,
      generate: async (): Promise<unknown> => null,
      submit: async (): Promise<unknown> => null,
      retry: async (): Promise<unknown> => null,
      answer: async (): Promise<unknown> => null,
      answerDraft: async (): Promise<unknown> => null,
      restoreDraft: async (): Promise<unknown> => null,
      restoreRevisionAsDraft: async (): Promise<unknown> => null,
      rejectDraft: async (): Promise<unknown> => null,
      cancel: async (): Promise<unknown> => null,
      steer: async (): Promise<unknown> => null,
      queueFollowup: async (): Promise<unknown> => null,
      availability: async (): Promise<unknown> => null,
      subscribeStarted: () => () => undefined,
      subscribeOutput: () => () => undefined,
      provider: 'renderer-owned',
    },
  ])('rejects malformed bridge %j', (bridge) => {
    expect(() => createBuilderDesktopCodeGeneratorPort(bridge)).toThrow(
      BuilderDesktopCodeGeneratorPortError,
    );
  });

  it('rejects malformed success and forged retryability', async () => {
    const request = await createBuilderGenerationRequest('Make a timer.');
    for (const response of [
      { version: 'builder-generation-ipc-result.v1', ok: true },
      {
        version: 'builder-generation-ipc-result.v1',
        ok: false,
        error: { code: 'builder_generation_timeout', retryable: false },
      },
    ]) {
      const port = createBuilderDesktopCodeGeneratorPort({
        submit: async (): Promise<unknown> => response,
        generateApprovedPlan: async (): Promise<unknown> => response,
        continueDraft: async () => null,
        proposePlan: async (): Promise<unknown> => response,
        preparePlanSourceReadApproval: async (): Promise<unknown> => response,
        approvePlanSourceRead: async (): Promise<unknown> => response,
        prepareCurrentProjectWriteApproval: async (): Promise<unknown> => response,
        approveCurrentProjectWrite: async (): Promise<unknown> => response,
        generate: async (): Promise<unknown> => response,
        retry: async (): Promise<unknown> => response,
        answer: async (): Promise<unknown> => response,
        answerDraft: async (): Promise<unknown> => response,
        restoreDraft: async (): Promise<unknown> => null,
        restoreRevisionAsDraft: async (): Promise<unknown> => null,
        rejectDraft: async (): Promise<unknown> => null,
        cancel: async (): Promise<unknown> => null,
        steer: async (): Promise<unknown> => null,
        queueFollowup: async (): Promise<unknown> => null,
      availability: async (): Promise<unknown> => null,
        subscribeStarted: () => () => undefined,
        subscribeOutput: () => () => undefined,
      });
      await expect(port.generate(request)).rejects.toBeInstanceOf(
        BuilderDesktopCodeGeneratorPortError,
      );
    }
  });

  it('rejects malformed cancel results without exposing bridge details', async () => {
    const request = await createBuilderGenerationRequest('Make a timer.');
    const port = createBuilderDesktopCodeGeneratorPort({
      submit: async () => null,
      generateApprovedPlan: async () => null,
      continueDraft: async () => null,
      proposePlan: async () => null,
      preparePlanSourceReadApproval: async () => null,
      approvePlanSourceRead: async () => null,
      prepareCurrentProjectWriteApproval: async () => null,
      approveCurrentProjectWrite: async () => null,
      generate: async () => null,
      retry: async () => null,
      answer: async () => null,
      answerDraft: async () => null,
      restoreDraft: async () => null,
      restoreRevisionAsDraft: async () => null,
      rejectDraft: async () => null,
      cancel: async () => ({
        request_id: `sha256:${'9'.repeat(64)}`,
        cancelled: true,
        provider: 'private',
      }),
      steer: async () => null,
      queueFollowup: async () => null,
      availability: async () => null,
      subscribeStarted: () => () => undefined,
      subscribeOutput: () => () => undefined,
    });

    await expect(port.cancel({ request_id: request.request_digest })).rejects.toBeInstanceOf(
      BuilderDesktopCodeGeneratorPortError,
    );
  });

  it('rejects malformed steering results without exposing bridge details', async () => {
    const request = await createBuilderGenerationRequest('Make a timer.');
    const port = createBuilderDesktopCodeGeneratorPort({
      submit: async () => null,
      generateApprovedPlan: async () => null,
      continueDraft: async () => null,
      proposePlan: async () => null,
      preparePlanSourceReadApproval: async () => null,
      approvePlanSourceRead: async () => null,
      prepareCurrentProjectWriteApproval: async () => null,
      approveCurrentProjectWrite: async () => null,
      generate: async () => null,
      retry: async () => null,
      answer: async () => null,
      answerDraft: async () => null,
      restoreDraft: async () => null,
      restoreRevisionAsDraft: async () => null,
      rejectDraft: async () => null,
      cancel: async () => null,
      steer: async () => ({
        request_id: `sha256:${'9'.repeat(64)}`,
        steered: true,
        provider: 'private',
      }),
      queueFollowup: async () => null,
      availability: async () => null,
      subscribeStarted: () => () => undefined,
      subscribeOutput: () => () => undefined,
    });

    await expect(port.steer({
      request_id: request.request_digest,
      message: 'Keep going.',
    })).rejects.toBeInstanceOf(BuilderDesktopCodeGeneratorPortError);
  });

  it('rejects malformed queued follow-up results without exposing bridge details', async () => {
    const request = await createBuilderGenerationRequest('Make a timer.');
    const port = createBuilderDesktopCodeGeneratorPort({
      submit: async () => null,
      generateApprovedPlan: async () => null,
      continueDraft: async () => null,
      proposePlan: async () => null,
      preparePlanSourceReadApproval: async () => null,
      approvePlanSourceRead: async () => null,
      prepareCurrentProjectWriteApproval: async () => null,
      approveCurrentProjectWrite: async () => null,
      generate: async () => null,
      retry: async () => null,
      answer: async () => null,
      answerDraft: async () => null,
      restoreDraft: async () => null,
      restoreRevisionAsDraft: async () => null,
      rejectDraft: async () => null,
      cancel: async () => null,
      steer: async () => null,
      queueFollowup: async () => ({
        request_id: `sha256:${'9'.repeat(64)}`,
        queued: true,
        provider: 'private',
      }),
      availability: async () => null,
      subscribeStarted: () => () => undefined,
      subscribeOutput: () => () => undefined,
    });

    await expect(port.queueFollowup({
      request_id: request.request_digest,
      message: 'Queue this after the active run.',
    })).rejects.toBeInstanceOf(BuilderDesktopCodeGeneratorPortError);
  });
});
