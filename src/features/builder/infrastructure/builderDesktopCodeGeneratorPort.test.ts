import { describe, expect, it, vi } from 'vitest';

import { createBuilderGenerationRequest } from '../application/builderGeneration';
import {
  BuilderDesktopCodeGeneratorPortError,
  createBuilderDesktopCodeGeneratorPort,
} from './builderDesktopCodeGeneratorPort';
import { createGenerationDraft } from '../../../test/builderV2Fixtures';

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
      cancel: async () => null,
      availability: async () => null,
    });

    await expect(port.generate(request)).rejects.toMatchObject({
      code: 'builder_generation_provider_http_error',
      retryable: true,
      message: 'The AI service could not make this project.',
    });
  });

  it.each([
    null,
    {},
    {
      generate: async (): Promise<unknown> => null,
      cancel: async (): Promise<unknown> => null,
    },
    {
      generate: async (): Promise<unknown> => null,
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
        cancel: async (): Promise<unknown> => null,
        availability: async (): Promise<unknown> => null,
      });
      await expect(port.generate(request)).rejects.toBeInstanceOf(
        BuilderDesktopCodeGeneratorPortError,
      );
    }
  });
});
