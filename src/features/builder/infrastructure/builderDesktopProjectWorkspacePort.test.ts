import { describe, expect, it, vi } from 'vitest';

import {
  BuilderDesktopProjectWorkspacePortError,
  createBuilderDesktopProjectWorkspacePort,
} from './builderDesktopProjectWorkspacePort';

describe('createBuilderDesktopProjectWorkspacePort', () => {
  it('forwards only the seven v2 workspace methods with fresh plain data', async () => {
    const open = vi.fn(async (request: unknown) => ({ operation: 'project_opened', request }));
    const createLocalProject = vi.fn(async (request: unknown) => ({ operation: 'local_project_bound', request }));
    const saveDraft = vi.fn(async (request: unknown) => ({ operation: 'draft_saved', request }));
    const loadCurrent = vi.fn(async (request: unknown) => ({ operation: 'current_loaded', request }));
    const loadRevision = vi.fn(async (request: unknown) => ({ operation: 'revision_loaded', request }));
    const listCurrent = vi.fn(async () => ({ operation: 'current_listed', projects: [] }));
    const listHistory = vi.fn(async (request: unknown) => ({ operation: 'history_listed', request }));
    const port = createBuilderDesktopProjectWorkspacePort({
      open,
      createLocalProject,
      saveDraft,
      loadCurrent,
      loadRevision,
      listCurrent,
      listHistory,
    });

    const openRequest = {
      project_id: null,
      receipt: `sha256:${'f'.repeat(64)}`,
    } as unknown as Readonly<{ project_id: null }>;
    const openResult = await port.open(openRequest);
    const createRequest = {
      project_id: 'builder-project:123e4567-e89b-42d3-a456-426614174000',
      project_title: 'Focus timer',
      project_root_path: 'renderer-forged',
    } as unknown as Readonly<{ project_id: string; project_title: string }>;
    const createLocalProjectResult = await port.createLocalProject(createRequest);
    const saveRequest = {
      draft_id: `builder-generation-draft:${'1'.repeat(64)}`,
      source_tree: { files: [] },
    } as unknown as Readonly<{ draft_id: string }>;
    const saveResult = await port.saveDraft(saveRequest);
    const loadRequest = {
      project_id: 'builder-project:123e4567-e89b-42d3-a456-426614174000',
      authority: 'renderer-forged',
    } as unknown as Readonly<{ project_id: string }>;
    const loadResult = await port.loadCurrent(loadRequest);
    const revisionRequest = {
      project_id: 'builder-project:123e4567-e89b-42d3-a456-426614174000',
      revision_receipt_digest: `sha256:${'d'.repeat(64)}`,
      authority: 'renderer-forged',
      source_tree: { files: [] },
    } as unknown as Readonly<{ project_id: string; revision_receipt_digest: string }>;
    const revisionResult = await port.loadRevision(revisionRequest);
    const catalogResult = await port.listCurrent();
    const historyRequest = {
      project_id: 'builder-project:123e4567-e89b-42d3-a456-426614174000',
      limit: 32,
      receipt: `sha256:${'e'.repeat(64)}`,
      source_tree: { files: [] },
      authority: 'renderer-forged',
    } as unknown as Readonly<{ project_id: string; limit: number }>;
    const historyResult = await port.listHistory(historyRequest);

    expect(open).toHaveBeenCalledOnce();
    expect(open.mock.calls[0][0]).toEqual({ project_id: null });
    expect(open.mock.calls[0][0]).not.toBe(openRequest);
    expect(createLocalProject).toHaveBeenCalledExactlyOnceWith({
      project_id: 'builder-project:123e4567-e89b-42d3-a456-426614174000',
      project_title: 'Focus timer',
    });
    expect(createLocalProject.mock.calls[0][0]).not.toBe(createRequest);
    expect(saveDraft).toHaveBeenCalledOnce();
    expect(saveDraft.mock.calls[0][0]).toEqual({
      draft_id: `builder-generation-draft:${'1'.repeat(64)}`,
    });
    expect(saveDraft.mock.calls[0][0]).not.toBe(saveRequest);
    expect(loadCurrent).toHaveBeenCalledOnce();
    expect(loadCurrent.mock.calls[0][0]).toEqual({
      project_id: 'builder-project:123e4567-e89b-42d3-a456-426614174000',
    });
    expect(loadCurrent.mock.calls[0][0]).not.toBe(loadRequest);
    expect(loadRevision).toHaveBeenCalledOnce();
    expect(loadRevision.mock.calls[0][0]).toEqual({
      project_id: 'builder-project:123e4567-e89b-42d3-a456-426614174000',
      revision_receipt_digest: `sha256:${'d'.repeat(64)}`,
    });
    expect(loadRevision.mock.calls[0][0]).not.toBe(revisionRequest);
    expect(listCurrent).toHaveBeenCalledOnce();
    expect(listHistory).toHaveBeenCalledOnce();
    expect(listHistory.mock.calls[0][0]).toEqual({
      project_id: 'builder-project:123e4567-e89b-42d3-a456-426614174000',
      limit: 32,
    });
    expect(listHistory.mock.calls[0][0]).not.toBe(historyRequest);
    expect(Object.isFrozen(openResult)).toBe(true);
    expect(Object.isFrozen(createLocalProjectResult)).toBe(true);
    expect(Object.isFrozen(saveResult)).toBe(true);
    expect(Object.isFrozen(loadResult)).toBe(true);
    expect(Object.isFrozen(revisionResult)).toBe(true);
    expect(Object.isFrozen(catalogResult)).toBe(true);
    expect(Object.isFrozen(historyResult)).toBe(true);
  });

  it.each([
    null,
    {},
    {
      open: async (): Promise<unknown> => null,
      createLocalProject: async (): Promise<unknown> => null,
      saveDraft: async (): Promise<unknown> => null,
      loadCurrent: async (): Promise<unknown> => null,
      loadRevision: async (): Promise<unknown> => null,
      listCurrent: async (): Promise<unknown> => null,
    },
    {
      open: async (): Promise<unknown> => null,
      createLocalProject: async (): Promise<unknown> => null,
      saveDraft: async (): Promise<unknown> => null,
      loadCurrent: async (): Promise<unknown> => null,
      loadRevision: async (): Promise<unknown> => null,
      listCurrent: async (): Promise<unknown> => null,
      listHistory: async (): Promise<unknown> => null,
      commit: async (): Promise<unknown> => null,
    },
  ])('rejects malformed or legacy bridge %j', (bridge) => {
    expect(() => createBuilderDesktopProjectWorkspacePort(bridge)).toThrow(
      BuilderDesktopProjectWorkspacePortError,
    );
  });

  it('redacts hostile responses and does not evaluate accessors', async () => {
    let getterCalls = 0;
    const hostileRequest = {};
    Object.defineProperty(hostileRequest, 'project_id', {
      enumerable: true,
      get() {
        getterCalls += 1;
        return 'never';
      },
    });
    const port = createBuilderDesktopProjectWorkspacePort({
      open: async () => null,
      createLocalProject: async () => null,
      saveDraft: async () => Object.defineProperty({}, 'secret', {
        enumerable: true,
        get() {
          getterCalls += 1;
          return 'never';
        },
      }),
      loadCurrent: async () => null,
      loadRevision: async () => null,
      listCurrent: async () => null,
      listHistory: async () => null,
    });

    await expect(port.saveDraft({
      draft_id: `builder-generation-draft:${'1'.repeat(64)}`,
    })).rejects.toBeInstanceOf(BuilderDesktopProjectWorkspacePortError);
    expect(() => port.loadCurrent(
      hostileRequest as Readonly<{ project_id: string }>,
    )).toThrow(BuilderDesktopProjectWorkspacePortError);
    expect(getterCalls).toBe(0);
  });
});
