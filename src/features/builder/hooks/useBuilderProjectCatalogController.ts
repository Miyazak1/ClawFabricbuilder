import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react';

import {
  createBuilderProjectCatalogController,
  type BuilderProjectCatalogPort,
  type BuilderProjectCatalogSnapshot,
} from '../application/builderProjectCatalogController';

export type UseBuilderProjectCatalogControllerResult = Readonly<{
  snapshot: BuilderProjectCatalogSnapshot;
  refresh(): Promise<BuilderProjectCatalogSnapshot>;
}>;

export function useBuilderProjectCatalogController(
  port: BuilderProjectCatalogPort,
): UseBuilderProjectCatalogControllerResult {
  const listCurrent = port.listCurrent;
  const controller = useMemo(
    () => createBuilderProjectCatalogController({ listCurrent }),
    [listCurrent],
  );
  const activeController = useRef<typeof controller | null>(null);
  const lifecycleToken = useRef<object | null>(null);
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );

  useLayoutEffect(() => {
    if (activeController.current !== null && activeController.current !== controller) {
      activeController.current.dispose();
    }
    activeController.current = controller;
    const token = {};
    lifecycleToken.current = token;
    controller.activate();
    void controller.load();
    return () => {
      controller.retire();
      queueMicrotask(() => {
        if (activeController.current === controller && lifecycleToken.current === token) {
          activeController.current = null;
          lifecycleToken.current = null;
          controller.dispose();
        }
      });
    };
  }, [controller]);

  const refresh = useCallback(() => controller.refresh(), [controller]);
  return useMemo(() => Object.freeze({ snapshot, refresh }), [refresh, snapshot]);
}
