import { describe, expect, it, vi } from 'vitest';

import {
  createBuilderProjectCatalogController,
  isTrustedBuilderProjectCatalogSnapshot,
} from './builderProjectCatalogController';
import { PROJECT_ID, createCatalogWire } from '../../../test/builderV2Fixtures';

describe('Builder project catalog controller v2', () => {
  it('loads the SQLite-selected project list exactly once', async () => {
    const listCurrent = vi.fn(async () => createCatalogWire());
    const controller = createBuilderProjectCatalogController({ listCurrent });
    const loaded = await controller.load();

    expect(listCurrent).toHaveBeenCalledOnce();
    expect(loaded).toMatchObject({
      status: 'ready',
      busy: false,
      projects: [{ project_id: PROJECT_ID, revision_number: 1 }],
    });
    expect(isTrustedBuilderProjectCatalogSnapshot(loaded)).toBe(true);
    await controller.load();
    expect(listCurrent).toHaveBeenCalledOnce();
  });

  it('requires explicit retry after initial failure', async () => {
    const listCurrent = vi.fn()
      .mockRejectedValueOnce(new Error('private'))
      .mockResolvedValueOnce(await createCatalogWire());
    const controller = createBuilderProjectCatalogController({ listCurrent });

    expect((await controller.load()).status).toBe('unavailable');
    expect((await controller.refresh()).status).toBe('ready');
    expect(listCurrent).toHaveBeenCalledTimes(2);
  });

  it('retains stale whole-snapshot data when refresh fails', async () => {
    const listCurrent = vi.fn()
      .mockResolvedValueOnce(await createCatalogWire())
      .mockRejectedValueOnce(new Error('private'));
    const controller = createBuilderProjectCatalogController({ listCurrent });
    await controller.load();
    const stale = await controller.refresh();

    expect(stale.status).toBe('stale');
    expect(stale.projects[0].project_id).toBe(PROJECT_ID);
  });

  it('deduplicates concurrent reads and ignores completion after dispose', async () => {
    let resolve!: (value: unknown) => void;
    const listCurrent = vi.fn(() => new Promise<unknown>((done) => {
      resolve = done;
    }));
    const controller = createBuilderProjectCatalogController({ listCurrent });
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
    });
    expect(await controller.load()).toMatchObject({
      status: 'unavailable',
      projects: [],
    });
  });
});
