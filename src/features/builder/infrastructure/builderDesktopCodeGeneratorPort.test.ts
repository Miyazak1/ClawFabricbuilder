import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { BuilderGenerationRequest } from '../application/builderGeneration';
import {
  BuilderDesktopCodeGeneratorPortError,
  createBuilderDesktopCodeGeneratorPort,
} from './builderDesktopCodeGeneratorPort';

const REQUEST_ID = `sha256:${'a'.repeat(64)}`;
const PRIVATE_MARKER = 'private-provider-secret-marker';

function request(): BuilderGenerationRequest {
  return {
    version: 'builder-generation-request.v1',
    idea: 'Make a small timer',
    project_id: 'builder-project:123e4567-e89b-42d3-a456-426614174000',
    target_revision: 1,
    parent_revision: null,
    request_digest: REQUEST_ID,
  };
}

function bridge(overrides: Record<string, unknown> = {}) {
  return {
    generate: vi.fn(async (value: unknown) => ({ value })),
    cancel: vi.fn(async (value: { request_id: string }) => ({
      request_id: value.request_id,
      cancelled: true,
    })),
    availability: vi.fn(async () => ({
      version: 'builder-generation-availability.v1',
      available: true,
      reason: 'ready',
      supports_cancel: true,
    })),
    ...overrides,
  };
}

async function expectPortError(value: Promise<unknown>): Promise<void> {
  await expect(value).rejects.toMatchObject({
    name: 'BuilderDesktopCodeGeneratorPortError',
    code: 'builder_generation_unavailable',
    message: 'AI project generation is unavailable.',
  });
}

describe('Builder desktop code generator port', () => {
  it('forwards fresh bounded requests and returns fresh generated evidence', async () => {
    const target = bridge();
    const port = createBuilderDesktopCodeGeneratorPort(target);
    const input = request();
    const result = await port.generate(input) as { value: BuilderGenerationRequest };
    expect(target.generate).toHaveBeenCalledTimes(1);
    expect(target.generate.mock.calls[0][0]).toEqual(input);
    expect(target.generate.mock.calls[0][0]).not.toBe(input);
    expect(result).toEqual({ value: input });
    expect(result.value).not.toBe(input);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.value)).toBe(true);
  });

  it('returns only the application generate port and never invokes transport controls', async () => {
    const target = bridge();
    const port = createBuilderDesktopCodeGeneratorPort(target);
    expect(Reflect.ownKeys(port)).toEqual(['generate']);
    await port.generate(request());
    expect(target.generate).toHaveBeenCalledTimes(1);
    expect(target.cancel).not.toHaveBeenCalled();
    expect(target.availability).not.toHaveBeenCalled();
  });

  it('keeps bridge receiver semantics while snapshotting the approved methods', async () => {
    const target = {
      marker: 'bridge',
      async generate(this: { generate: unknown }) {
        return { receiver_preserved: typeof this.generate === 'function' };
      },
      async cancel() { throw new Error(PRIVATE_MARKER); },
      async availability() { throw new Error(PRIVATE_MARKER); },
    };
    const approved = {
      generate: target.generate,
      cancel: target.cancel,
      availability: target.availability,
    };
    const port = createBuilderDesktopCodeGeneratorPort(approved);
    await expect(port.generate(request())).resolves.toEqual({ receiver_preserved: true });
    expect(Reflect.ownKeys(port)).toEqual(['generate']);
  });

  it.each([
    ['missing method', { generate: vi.fn(), cancel: vi.fn() }],
    ['extra method', { ...bridge(), dispatch: vi.fn() }],
    ['non-function', { ...bridge(), availability: true }],
    ['array', []],
    ['null', null],
  ])('rejects %s bridge shapes', (_label, value) => {
    expect(() => createBuilderDesktopCodeGeneratorPort(value)).toThrow(BuilderDesktopCodeGeneratorPortError);
  });

  it('rejects hidden, symbolic, and accessor bridge authority', () => {
    const hidden = bridge();
    Object.defineProperty(hidden, 'dispatch', { enumerable: false, value: vi.fn() });
    expect(() => createBuilderDesktopCodeGeneratorPort(hidden)).toThrow(BuilderDesktopCodeGeneratorPortError);

    const symbolic = bridge() as Record<PropertyKey, unknown>;
    symbolic[Symbol('secret')] = PRIVATE_MARKER;
    expect(() => createBuilderDesktopCodeGeneratorPort(symbolic)).toThrow(BuilderDesktopCodeGeneratorPortError);

    const accessor = { generate: vi.fn(), cancel: vi.fn() } as Record<string, unknown>;
    Object.defineProperty(accessor, 'availability', {
      enumerable: true,
      get() { throw new Error(PRIVATE_MARKER); },
    });
    expect(() => createBuilderDesktopCodeGeneratorPort(accessor)).toThrow(BuilderDesktopCodeGeneratorPortError);
  });

  it('bounds request and result graphs before crossing the bridge', async () => {
    const target = bridge();
    const port = createBuilderDesktopCodeGeneratorPort(target);
    await expectPortError(port.generate({ value: 'x'.repeat(1024 * 1024 + 1) } as never));
    expect(target.generate).not.toHaveBeenCalled();

    const oversizedResult = createBuilderDesktopCodeGeneratorPort(bridge({
      generate: vi.fn(async () => ({ value: 'x'.repeat(1024 * 1024 + 1) })),
    }));
    await expectPortError(oversizedResult.generate(request()));
  });

  it('redacts hostile bridge failures and result material', async () => {
    const port = createBuilderDesktopCodeGeneratorPort(bridge({
      generate: vi.fn(async () => { throw new Error(PRIVATE_MARKER); }),
    }));
    await expectPortError(port.generate(request()));
    await expect(port.generate(request())).rejects.not.toThrow(PRIVATE_MARKER);
  });

  it('contains no global bridge lookup or legacy product authority', () => {
    const source = readFileSync(
      join(process.cwd(), 'src', 'features', 'builder', 'infrastructure', 'builderDesktopCodeGeneratorPort.ts'),
      'utf8',
    );
    expect(source).not.toMatch(
      /\bwindow\b|clawfabricDesktop|electron|ipcRenderer|fetch\(|localStorage|sessionStorage|indexedDB|ChatCreatePage|chat_planner|Canvas|\bJob\b|router|repository/i,
    );
    expect(source).toContain('BuilderCodeGeneratorPort');
    expect(source).not.toContain('BuilderGenerationRequest');
  });
});
