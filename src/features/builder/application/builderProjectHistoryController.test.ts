import { describe, expect, it, vi } from 'vitest';

import {
  createBuilderProjectHistoryController,
  isTrustedBuilderProjectHistorySnapshot,
} from './builderProjectHistoryController';
import { BUILDER_PROJECT_HISTORY_LIMIT } from '../domain/builderProjectHistory';
import { PROJECT_ID, createHistoryWire } from '../../../test/builderV2Fixtures';

const OTHER_PROJECT_ID = 'builder-project:223e4567-e89b-42d3-a456-426614174000';

describe('Builder project history controller', () => {
  it('loads verified project history with the fixed public window limit', async () => {
    const listHistory = vi.fn(async () => createHistoryWire());
    const controller = createBuilderProjectHistoryController({ listHistory });
    const loaded = await controller.load(PROJECT_ID);

    expect(listHistory).toHaveBeenCalledExactlyOnceWith({
      project_id: PROJECT_ID,
      limit: BUILDER_PROJECT_HISTORY_LIMIT,
    });
    expect(loaded).toMatchObject({
      status: 'ready',
      project_id: PROJECT_ID,
      busy: false,
      history: {
        current: { revision_number: 2 },
        revisions: [{ is_current: true }, { is_current: false }],
      },
    });
    expect(isTrustedBuilderProjectHistorySnapshot(loaded)).toBe(true);

    await controller.load(PROJECT_ID);
    expect(listHistory).toHaveBeenCalledOnce();
  });

  it('retains stale verified history when refresh fails', async () => {
    const listHistory = vi.fn()
      .mockResolvedValueOnce(await createHistoryWire())
      .mockRejectedValueOnce(new Error(`private ${PROJECT_ID}`));
    const controller = createBuilderProjectHistoryController({ listHistory });
    await controller.load(PROJECT_ID);

    const refresh = controller.refresh();
    expect(controller.getSnapshot()).toMatchObject({
      status: 'refreshing',
      project_id: PROJECT_ID,
      history: { project_id: PROJECT_ID },
    });
    const stale = await refresh;

    expect(stale.status).toBe('stale');
    expect(stale.error).toBe('unavailable');
    expect(stale.history?.project_id).toBe(PROJECT_ID);
    expect(JSON.stringify(stale)).not.toContain('private');
  });

  it('ignores stale completion after switching projects', async () => {
    let resolveFirst!: (value: unknown) => void;
    const first = new Promise<unknown>((resolve) => {
      resolveFirst = resolve;
    });
    const listHistory = vi.fn(async (request: Readonly<{ project_id: string }>) => (
      request.project_id === PROJECT_ID ? first : createHistoryWire(OTHER_PROJECT_ID)
    ));
    const controller = createBuilderProjectHistoryController({ listHistory });
    const firstLoad = controller.load(PROJECT_ID);
    const second = await controller.load(OTHER_PROJECT_ID);
    resolveFirst(await createHistoryWire(PROJECT_ID));
    await firstLoad;

    expect(second.project_id).toBe(OTHER_PROJECT_ID);
    expect(controller.getSnapshot().project_id).toBe(OTHER_PROJECT_ID);
    expect(controller.getSnapshot().history?.project_id).toBe(OTHER_PROJECT_ID);
  });

  it('fails closed for invalid project identity and clears when no project is selected', async () => {
    const listHistory = vi.fn(async () => createHistoryWire());
    const controller = createBuilderProjectHistoryController({ listHistory });

    expect(await controller.load('bad-project-id')).toMatchObject({
      status: 'unavailable',
      project_id: null,
      history: null,
      error: 'unavailable',
    });
    expect(listHistory).not.toHaveBeenCalled();

    expect(await controller.load(null)).toMatchObject({
      status: 'idle',
      project_id: null,
      history: null,
      error: null,
    });
  });

  it('deduplicates concurrent reads and ignores completion after dispose', async () => {
    let resolve!: (value: unknown) => void;
    const pending = new Promise<unknown>((done) => {
      resolve = done;
    });
    const listHistory = vi.fn(async () => pending);
    const controller = createBuilderProjectHistoryController({ listHistory });
    const first = controller.load(PROJECT_ID);
    const second = controller.refresh();

    expect(first).toBe(second);
    await Promise.resolve();
    controller.dispose();
    resolve(await createHistoryWire());
    await first;

    expect(listHistory).toHaveBeenCalledOnce();
    expect(controller.getSnapshot().status).toBe('loading');
  });
});
