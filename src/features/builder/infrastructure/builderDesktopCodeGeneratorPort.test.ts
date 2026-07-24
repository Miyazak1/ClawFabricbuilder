import { describe, expect, it, vi } from 'vitest';

import { createBuilderGenerationRequest } from '../application/builderGeneration';
import {
  BuilderDesktopCodeGeneratorPortError,
  createBuilderDesktopCodeGeneratorPort,
} from './builderDesktopCodeGeneratorPort';
import { createGenerationDraft, createRestoredGenerationDraft } from '../../../test/builderV2Fixtures';

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
      generate,
      answer: async () => null,
      restoreDraft: async () => null,
      rejectDraft: async () => null,
      cancel: async () => null,
      availability: async () => null,
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

  it('maps fixed diagnostic envelopes without raw provider details', async () => {
    const request = await createBuilderGenerationRequest('Make a timer.');
    const port = createBuilderDesktopCodeGeneratorPort({
      generate: async () => ({
        version: 'builder-generation-ipc-result.v1',
        ok: false,
        error: {
          code: 'builder_generation_provider_http_error',
          retryable: true,
        },
      }),
      answer: async () => null,
      restoreDraft: async () => null,
      rejectDraft: async () => null,
      cancel: async () => null,
      availability: async () => null,
    });

    await expect(port.generate(request)).rejects.toMatchObject({
      code: 'builder_generation_provider_http_error',
      retryable: true,
      message: 'The AI service could not make this project.',
    });
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
      generate: async () => null,
      answer,
      restoreDraft: async () => null,
      rejectDraft: async () => null,
      cancel: async () => null,
      availability: async () => null,
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
      generate: async () => null,
      answer: async () => null,
      restoreDraft,
      rejectDraft: async () => null,
      cancel: async () => null,
      availability: async () => null,
    });

    const result = await port.restoreDraft({ draft_id: restoredDraft.draft_id });

    expect(restoreDraft).toHaveBeenCalledExactlyOnceWith({ draft_id: restoredDraft.draft_id });
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
      generate: async () => null,
      answer: async () => null,
      restoreDraft: async () => null,
      rejectDraft,
      cancel: async () => null,
      availability: async () => null,
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
      generate: async () => null,
      answer: async () => null,
      restoreDraft: async () => null,
      rejectDraft: async () => null,
      cancel,
      availability: async () => null,
    });

    const result = await port.cancel({ request_id: request.request_digest });

    expect(cancel).toHaveBeenCalledExactlyOnceWith({ request_id: request.request_digest });
    expect(cancel.mock.calls[0][0]).not.toHaveProperty('instruction');
    expect(cancel.mock.calls[0][0]).not.toHaveProperty('source_tree');
    expect(result).toEqual({ request_id: request.request_digest, cancelled: true });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('maps restored draft parent drift to a fixed diagnostic', async () => {
    const port = createBuilderDesktopCodeGeneratorPort({
      generate: async () => null,
      answer: async () => null,
      restoreDraft: async () => ({
        version: 'builder-generation-ipc-result.v1',
        ok: false,
        error: {
          code: 'builder_generation_parent_unavailable',
          retryable: true,
        },
      }),
      rejectDraft: async () => null,
      cancel: async () => null,
      availability: async () => null,
    });

    await expect(port.restoreDraft({
      draft_id: `builder-generation-draft:${'1'.repeat(64)}`,
    })).rejects.toMatchObject({
      code: 'builder_generation_parent_unavailable',
      retryable: true,
      message: 'The current project version is unavailable.',
    });
  });

  it.each([
    null,
    {},
    {
      generate: async (): Promise<unknown> => null,
      answer: async (): Promise<unknown> => null,
      restoreDraft: async (): Promise<unknown> => null,
      rejectDraft: async (): Promise<unknown> => null,
      cancel: async (): Promise<unknown> => null,
    },
    {
      generate: async (): Promise<unknown> => null,
      answer: async (): Promise<unknown> => null,
      restoreDraft: async (): Promise<unknown> => null,
      rejectDraft: async (): Promise<unknown> => null,
      cancel: async (): Promise<unknown> => null,
      availability: async (): Promise<unknown> => null,
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
        generate: async (): Promise<unknown> => response,
        answer: async (): Promise<unknown> => response,
        restoreDraft: async (): Promise<unknown> => null,
        rejectDraft: async (): Promise<unknown> => null,
        cancel: async (): Promise<unknown> => null,
        availability: async (): Promise<unknown> => null,
      });
      await expect(port.generate(request)).rejects.toBeInstanceOf(
        BuilderDesktopCodeGeneratorPortError,
      );
    }
  });

  it('rejects malformed cancel results without exposing bridge details', async () => {
    const request = await createBuilderGenerationRequest('Make a timer.');
    const port = createBuilderDesktopCodeGeneratorPort({
      generate: async () => null,
      answer: async () => null,
      restoreDraft: async () => null,
      rejectDraft: async () => null,
      cancel: async () => ({
        request_id: `sha256:${'9'.repeat(64)}`,
        cancelled: true,
        provider: 'private',
      }),
      availability: async () => null,
    });

    await expect(port.cancel({ request_id: request.request_digest })).rejects.toBeInstanceOf(
      BuilderDesktopCodeGeneratorPortError,
    );
  });
});
