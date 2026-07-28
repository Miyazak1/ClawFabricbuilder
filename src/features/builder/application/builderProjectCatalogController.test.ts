import { describe, expect, it, vi } from 'vitest';

import {
  createBuilderProjectCatalogController,
  isTrustedBuilderProjectCatalogSnapshot,
} from './builderProjectCatalogController';
import { PROJECT_ID, createCatalogWire, createWorkspaceCatalogWire } from '../../../test/builderV2Fixtures';

describe('Builder project catalog controller v2', () => {
  it('loads the SQLite-selected project list exactly once', async () => {
    const listCurrent = vi.fn(async () => createCatalogWire());
    const listWorkspaces = vi.fn(async () => createWorkspaceCatalogWire());
    const controller = createBuilderProjectCatalogController({ listCurrent, listWorkspaces });
    const loaded = await controller.load();

    expect(listCurrent).toHaveBeenCalledOnce();
    expect(listWorkspaces).toHaveBeenCalledOnce();
    expect(loaded).toMatchObject({
      status: 'ready',
      busy: false,
      projects: [{ project_id: PROJECT_ID, revision_number: 1 }],
      workspaceProjects: [],
    });
    expect(isTrustedBuilderProjectCatalogSnapshot(loaded)).toBe(true);
    await controller.load();
    expect(listCurrent).toHaveBeenCalledOnce();
    expect(listWorkspaces).toHaveBeenCalledOnce();
  });

  it('requires explicit retry after initial failure', async () => {
    const listCurrent = vi.fn()
      .mockRejectedValueOnce(new Error('private'))
      .mockResolvedValueOnce(await createCatalogWire());
    const listWorkspaces = vi.fn(async () => createWorkspaceCatalogWire());
    const controller = createBuilderProjectCatalogController({ listCurrent, listWorkspaces });

    expect((await controller.load()).status).toBe('unavailable');
    expect((await controller.refresh()).status).toBe('ready');
    expect(listCurrent).toHaveBeenCalledTimes(2);
  });

  it('retains stale whole-snapshot data when refresh fails', async () => {
    const listCurrent = vi.fn()
      .mockResolvedValueOnce(await createCatalogWire())
      .mockRejectedValueOnce(new Error('private'));
    const listWorkspaces = vi.fn(async () => createWorkspaceCatalogWire([{
      project_id: 'builder-project:22222222-2222-4222-8222-222222222222',
      title: 'Unsaved dashboard',
      source_folders: [{ name: 'site-source', status: 'selected' }],
      bound_at_ms: 20,
      has_current_revision: false,
      current_revision_number: 0,
    }]));
    const controller = createBuilderProjectCatalogController({ listCurrent, listWorkspaces });
    await controller.load();
    const stale = await controller.refresh();

    expect(stale.status).toBe('stale');
    expect(stale.projects[0].project_id).toBe(PROJECT_ID);
    expect(stale.workspaceProjects[0].title).toBe('Unsaved dashboard');
  });

  it('deduplicates concurrent reads and ignores completion after dispose', async () => {
    let resolve!: (value: unknown) => void;
    const listCurrent = vi.fn(() => new Promise<unknown>((done) => {
      resolve = done;
    }));
    const listWorkspaces = vi.fn(async () => createWorkspaceCatalogWire());
    const controller = createBuilderProjectCatalogController({ listCurrent, listWorkspaces });
    const first = controller.load();
    const second = controller.refresh();
    expect(first).toBe(second);
    await Promise.resolve();
    controller.dispose();
    resolve(await createCatalogWire());
    await first;
    expect(listCurrent).toHaveBeenCalledOnce();
    expect(controller.getSnapshot().status).toBe('loading');
  });

  it('fails closed on old JSON catalog wire', async () => {
    const controller = createBuilderProjectCatalogController({
      listCurrent: async () => ({
        result_version: 'builder-project-catalog-result.v1',
        projects: [],
      }),
      listWorkspaces: async () => createWorkspaceCatalogWire(),
    });
    expect(await controller.load()).toMatchObject({
      status: 'unavailable',
      projects: [],
    });
  });
});
