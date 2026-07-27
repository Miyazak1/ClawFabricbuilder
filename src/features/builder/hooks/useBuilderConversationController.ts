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
  load: BuilderConversationController['load'];
  refresh(): Promise<BuilderConversationControllerSnapshot>;
}>;

export function useBuilderConversationController(
  port: BuilderTaskStreamPort,
  projectId?: string | null,
): UseBuilderConversationControllerResult {
  const read = port.read;
  const subscribeChanged = port.subscribeChanged;
  const controller = useMemo(
    () => createBuilderConversationController({ read, subscribeChanged }),
    [read, subscribeChanged],
  );
  const disposalTokens = useRef(new WeakMap<BuilderConversationController, object>());
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

  const load = useCallback<BuilderConversationController['load']>(
    (nextProjectId) => controller.load(nextProjectId).catch(() => controller.getSnapshot()),
    [controller],
  );
  const refresh = useCallback(() => controller.refresh(), [controller]);
  return useMemo(() => Object.freeze({ snapshot, load, refresh }), [load, refresh, snapshot]);
}
