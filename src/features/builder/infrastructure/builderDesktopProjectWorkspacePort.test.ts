import { describe, expect, it, vi } from 'vitest';

import {
  BuilderDesktopProjectWorkspacePortError,
  createBuilderDesktopProjectWorkspacePort,
} from './builderDesktopProjectWorkspacePort';

describe('createBuilderDesktopProjectWorkspacePort', () => {
  it('forwards only the four v2 workspace methods with fresh plain data', async () => {
    const open = vi.fn(async (request: unknown) => ({ operation: 'project_opened', request }));
    const saveDraft = vi.fn(async (request: unknown) => ({ operation: 'draft_saved', request }));
    const loadCurrent = vi.fn(async (request: unknown) => ({ operation: 'current_loaded', request }));
    const listCurrent = vi.fn(async () => ({ operation: 'current_listed', projects: [] }));
    const port = createBuilderDesktopProjectWorkspacePort({
      open,
      saveDraft,
      loadCurrent,
      listCurrent,
    });

    const openResult = await port.open({ project_id: null });
    const saveRequest = { draft_id: `builder-generation-draft:${'1'.repeat(64)}` };
    const saveResult = await port.saveDraft(saveRequest);
    const loadResult = await port.loadCurrent({
      project_id: 'builder-project:123e4567-e89b-42d3-a456-426614174000',
    });
    const catalogResult = await port.listCurrent();

    expect(open).toHaveBeenCalledOnce();
    expect(saveDraft).toHaveBeenCalledOnce();
    expect(saveDraft.mock.calls[0][0]).toEqual(saveRequest);
    expect(saveDraft.mock.calls[0][0]).not.toBe(saveRequest);
    expect(loadCurrent).toHaveBeenCalledOnce();
    expect(listCurrent).toHaveBeenCalledOnce();
    expect(Object.isFrozen(openResult)).toBe(true);
    expect(Object.isFrozen(saveResult)).toBe(true);
    expect(Object.isFrozen(loadResult)).toBe(true);
    expect(Object.isFrozen(catalogResult)).toBe(true);
  });

  it.each([
    null,
    {},
    {
      open: async (): Promise<unknown> => null,
      saveDraft: async (): Promise<unknown> => null,
      loadCurrent: async (): Promise<unknown> => null,
    },
    {
      open: async (): Promise<unknown> => null,
      saveDraft: async (): Promise<unknown> => null,
      loadCurrent: async (): Promise<unknown> => null,
      listCurrent: async (): Promise<unknown> => null,
      commit: async (): Promise<unknown> => null,
    },
  ])('rejects malformed or legacy bridge %j', (bridge) => {
    expect(() => createBuilderDesktopProjectWorkspacePort(bridge)).toThrow(
      BuilderDesktopProjectWorkspacePortError,
    );
  });

  it('redacts hostile responses and does not evaluate accessors', async () => {
    let getterCalls = 0;
    const port = createBuilderDesktopProjectWorkspacePort({
      open: async () => null,
      saveDraft: async () => Object.defineProperty({}, 'secret', {
        enumerable: true,
        get() {
          getterCalls += 1;
          return 'never';
        },
      }),
      loadCurrent: async () => null,
      listCurrent: async () => null,
    });

    await expect(port.saveDraft({
      draft_id: `builder-generation-draft:${'1'.repeat(64)}`,
    })).rejects.toBeInstanceOf(BuilderDesktopProjectWorkspacePortError);
    expect(getterCalls).toBe(0);
  });
});
