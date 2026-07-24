import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react';

import {
  createBuilderProjectHistoryController,
  type BuilderProjectHistoryController,
  type BuilderProjectHistoryPort,
  type BuilderProjectHistorySnapshot,
} from '../application/builderProjectHistoryController';

export type UseBuilderProjectHistoryControllerResult = Readonly<{
  snapshot: BuilderProjectHistorySnapshot;
  load: BuilderProjectHistoryController['load'];
  refresh(): Promise<BuilderProjectHistorySnapshot>;
  reload(): Promise<BuilderProjectHistorySnapshot>;
}>;

export function useBuilderProjectHistoryController(
  port: BuilderProjectHistoryPort,
  projectId?: string | null,
): UseBuilderProjectHistoryControllerResult {
  const listHistory = port.listHistory;
  const controller = useMemo(
    () => createBuilderProjectHistoryController({ listHistory }),
    [listHistory],
  );
  const disposalTokens = useRef(new WeakMap<BuilderProjectHistoryController, object>());
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );

  useLayoutEffect(() => {
    const selectedProjectId = projectId ?? null;
    if (controller.getSnapshot().project_id === selectedProjectId) return;
    void controller.load(selectedProjectId).catch(() => undefined);
  }, [controller, projectId]);

  useLayoutEffect(() => {
    const token = {};
    const controllerDisposalTokens = disposalTokens.current;
    controllerDisposalTokens.set(controller, token);
    return () => {
      queueMicrotask(() => {
        if (controllerDisposalTokens.get(controller) !== token) return;
        controllerDisposalTokens.delete(controller);
        controller.dispose();
      });
    };
  }, [controller]);

  const load = useCallback<BuilderProjectHistoryController['load']>(
    (nextProjectId) => controller.load(nextProjectId).catch(() => controller.getSnapshot()),
    [controller],
  );
  const refresh = useCallback(() => controller.refresh(), [controller]);
  const reload = useCallback(() => controller.reload(), [controller]);
  return useMemo(
    () => Object.freeze({ snapshot, load, refresh, reload }),
    [load, refresh, reload, snapshot],
  );
}
