import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react';

import {
  createBuilderConversationController,
  type BuilderConversationController,
  type BuilderConversationControllerSnapshot,
} from '../application/builderConversationController';
import type { BuilderTaskStreamPort } from '../application/builderPorts';

export type UseBuilderConversationControllerResult = Readonly<{
  snapshot: BuilderConversationControllerSnapshot;
  refresh(): Promise<BuilderConversationControllerSnapshot>;
}>;

export function useBuilderConversationController(
  port: BuilderTaskStreamPort,
  projectId?: string | null,
): UseBuilderConversationControllerResult {
  const read = port.read;
  const controller = useMemo(
    () => createBuilderConversationController({ read }),
    [read],
  );
  const disposalTokens = useRef(new WeakMap<BuilderConversationController, object>());
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );

  useLayoutEffect(() => {
    void controller.load(projectId ?? null).catch(() => undefined);
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

  const refresh = useCallback(() => controller.refresh(), [controller]);
  return useMemo(() => Object.freeze({ snapshot, refresh }), [refresh, snapshot]);
}
