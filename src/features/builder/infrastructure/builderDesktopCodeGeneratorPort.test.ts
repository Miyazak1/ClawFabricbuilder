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
    generate: vi.fn(async (value: unknown) => ({
      version: 'builder-generation-ipc-result.v1',
      ok: true,
      result: { value },
    })),
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

async function expectPortError(
  value: Promise<unknown>,
  code = 'builder_generation_failed',
): Promise<void> {
  await expect(value).rejects.toMatchObject({
    name: 'BuilderDesktopCodeGeneratorPortError',
    code,
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
        return {
          version: 'builder-generation-ipc-result.v1',
          ok: true,
          result: { receiver_preserved: typeof this.generate === 'function' },
        };
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
    const sparse = new Array(3) as unknown[];
    sparse[2] = 'safe';
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    let deep: unknown = { leaf: true };
    for (let index = 0; index < 70; index += 1) deep = { nested: deep };
    const nodeHeavy = Array.from({ length: 20_000 }, () => ({}));
    const entryHeavy: Record<string, unknown> = {};
    for (let index = 0; index < 20_001; index += 1) entryHeavy[`key_${index}`] = true;
    for (const invalid of [
      sparse,
      cyclic,
      deep,
      nodeHeavy,
      entryHeavy,
      { value: 'x'.repeat(1024 * 1024 + 1) },
    ]) {
      await expectPortError(port.generate(invalid as never));
    }
    expect(target.generate).not.toHaveBeenCalled();

    const oversizedResult = createBuilderDesktopCodeGeneratorPort(bridge({
      generate: vi.fn(async () => ({
        version: 'builder-generation-ipc-result.v1',
        ok: true,
        result: { value: 'x'.repeat(1024 * 1024 + 1) },
      })),
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

  it.each([
    ['builder_generation_provider_unavailable', false],
    ['builder_generation_timeout', true],
    ['builder_generation_provider_http_error', true],
    ['builder_generation_structured_response_invalid', true],
    ['builder_generation_static_preview_contract_rejected', true],
    ['builder_generation_failed', true],
  ] as const)('throws a fresh typed %s error from an exact failure envelope', async (code, retryable) => {
    const error = await createBuilderDesktopCodeGeneratorPort(bridge({
      generate: vi.fn(async () => ({
        version: 'builder-generation-ipc-result.v1',
        ok: false,
        error: { code, retryable },
      })),
    })).generate(request()).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(BuilderDesktopCodeGeneratorPortError);
    expect(error).toMatchObject({
      name: 'BuilderDesktopCodeGeneratorPortError',
      code,
      retryable,
    });
    expect(Object.isFrozen(error)).toBe(true);
    expect(String(error)).not.toMatch(/runtime|schema|IPC|provider\.example|private-provider-secret/iu);
  });

  it('rejects malformed, extra, hostile, and unknown failure envelopes as generic', async () => {
    const accessor = {
      version: 'builder-generation-ipc-result.v1',
      ok: false,
    } as Record<string, unknown>;
    Object.defineProperty(accessor, 'error', {
      enumerable: true,
      get() { throw new Error(PRIVATE_MARKER); },
    });
    for (const envelope of [
      { version: 'builder-generation-ipc-result.v1', ok: false, error: { code: 'unknown', retryable: true } },
      { version: 'builder-generation-ipc-result.v1', ok: false, error: { code: 'builder_generation_timeout', retryable: false } },
      { version: 'builder-generation-ipc-result.v1', ok: false, error: { code: 'builder_generation_timeout', retryable: true, raw: PRIVATE_MARKER } },
      { version: 'other.v1', ok: true, result: {} },
      new Proxy({ version: 'builder-generation-ipc-result.v1', ok: true, result: {} }, {}),
      accessor,
    ]) {
      const port = createBuilderDesktopCodeGeneratorPort(bridge({
        generate: vi.fn(async () => envelope),
      }));
      await expectPortError(port.generate(request()));
      await expect(port.generate(request())).rejects.not.toThrow(PRIVATE_MARKER);
    }
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
