import { describe, expect, it, vi } from 'vitest';

import {
  createBuilderProjectCatalogController,
  isTrustedBuilderProjectCatalogSnapshot,
  type BuilderProjectCatalogPort,
} from './builderProjectCatalogController';

const PROJECT_ONE = 'builder-project:123e4567-e89b-42d3-a456-426614174000';
const PROJECT_TWO = 'builder-project:123e4567-e89b-42d3-a456-426614174001';

function catalog(projectId = PROJECT_ONE, title = 'Tiny timer') {
  return {
    result_version: 'builder-project-catalog-result.v1',
    projects: [{
      project_id: projectId,
      title,
      summary: 'A small focus timer.',
      revision: 1,
      revision_digest: `sha256:${'a'.repeat(64)}`,
    }],
    catalog_evidence: {
      source_authority: 'verified_project_head_and_revision_chain',
      ordering: 'project_id_ascending',
      recency: 'not_available',
      global_atomic_snapshot: 'not_proven',
      headless_orphans: 'excluded',
      write_activity: 'none',
      resource_bounds: { max_project_directories: 256, max_file_reads: 1024, max_bytes: 33554432 },
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('Builder project catalog controller', () => {
  it('loads once and publishes only a sanitized whole snapshot', async () => {
    const listCurrent = vi.fn(async () => catalog());
    const controller = createBuilderProjectCatalogController({ listCurrent });
    const statuses: string[] = [];
    controller.subscribe(() => statuses.push(controller.getSnapshot().status));

    const loaded = await controller.load();
    expect(listCurrent).toHaveBeenCalledTimes(1);
    expect(statuses).toEqual(['loading', 'ready']);
    expect(loaded.status).toBe('ready');
    expect(loaded.projects[0].project_id).toBe(PROJECT_ONE);
    expect(isTrustedBuilderProjectCatalogSnapshot(loaded)).toBe(true);
    expect(Object.isFrozen(loaded.projects)).toBe(true);
    await controller.load();
    expect(listCurrent).toHaveBeenCalledTimes(1);
  });

  it('requires an explicit retry after initial failure', async () => {
    const listCurrent = vi.fn()
      .mockRejectedValueOnce(new Error('private marker'))
      .mockResolvedValueOnce(catalog());
    const controller = createBuilderProjectCatalogController({ listCurrent });

    expect((await controller.load()).status).toBe('unavailable');
    expect(listCurrent).toHaveBeenCalledTimes(1);
    expect((await controller.refresh()).status).toBe('ready');
    expect(listCurrent).toHaveBeenCalledTimes(2);
  });

  it('retains a stale snapshot on refresh failure and replaces it whole after recovery', async () => {
    const listCurrent = vi.fn()
      .mockResolvedValueOnce(catalog())
      .mockRejectedValueOnce(new Error('private marker'))
      .mockResolvedValueOnce(catalog(PROJECT_TWO, 'Focus board'));
    const controller = createBuilderProjectCatalogController({ listCurrent });
    await controller.load();

    const failed = await controller.refresh();
    expect(failed.status).toBe('stale');
    expect(failed.projects[0].project_id).toBe(PROJECT_ONE);
    const recovered = await controller.refresh();
    expect(recovered.status).toBe('ready');
    expect(recovered.projects.map((project) => project.project_id)).toEqual([PROJECT_TWO]);
  });

  it('deduplicates concurrent load and refresh commands', async () => {
    const pending = deferred<unknown>();
    const listCurrent = vi.fn(() => pending.promise);
    const controller = createBuilderProjectCatalogController({ listCurrent });
    const first = controller.load();
    const second = controller.refresh();
    pending.resolve(catalog());

    expect(await first).toEqual(await second);
    expect(listCurrent).toHaveBeenCalledTimes(1);
  });

  it('marks even an empty verified list stale when its refresh fails', async () => {
    const empty = catalog();
    empty.projects = [];
    const listCurrent = vi.fn()
      .mockResolvedValueOnce(empty)
      .mockRejectedValueOnce(new Error('private marker'));
    const controller = createBuilderProjectCatalogController({ listCurrent });
    await controller.load();

    expect((await controller.refresh()).status).toBe('stale');
    expect(controller.getSnapshot().projects).toEqual([]);
  });

  it('fails closed on typed forged results and never exposes their details', async () => {
    const raw = catalog() as Record<string, unknown>;
    raw.secret = 'private-marker';
    const controller = createBuilderProjectCatalogController({
      listCurrent: vi.fn(async () => raw),
    });

    const loaded = await controller.load();
    expect(loaded.status).toBe('unavailable');
    expect(JSON.stringify(loaded)).not.toContain('private-marker');
  });

  it('invalidates pending authority on dispose without publishing stale completion', async () => {
    const pending = deferred<unknown>();
    const port: BuilderProjectCatalogPort = { listCurrent: () => pending.promise };
    const controller = createBuilderProjectCatalogController(port);
    const listener = vi.fn();
    controller.subscribe(listener);
    const running = controller.load();
    controller.dispose();
    let reads = 0;
    const retiredResult = { result_version: 'builder-project-catalog-result.v1' };
    Object.defineProperty(retiredResult, 'projects', {
      enumerable: true,
      get() { reads += 1; return []; },
    });
    pending.resolve(retiredResult);
    await running;

    expect(controller.getSnapshot().status).toBe('loading');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(reads).toBe(0);
  });
});
