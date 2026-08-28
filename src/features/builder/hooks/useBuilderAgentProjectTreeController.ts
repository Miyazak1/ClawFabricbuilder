import { useCallback, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { createBuilderAgentProjectTreeController } from '../application/builderAgentProjectTreeController';
import type { BuilderAgentProjectTreePort } from '../application/builderPorts';
import { DEFAULT_BUILDER_AGENT_ID } from '../domain/builderAgentProjectTreeProjection';

export function useBuilderAgentProjectTreeController(port: BuilderAgentProjectTreePort) {
  const controller = useMemo(() => createBuilderAgentProjectTreeController(port, DEFAULT_BUILDER_AGENT_ID), [port]);
  const activeController = useRef<typeof controller | null>(null);
  const lifecycleToken = useRef<object | null>(null);
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useLayoutEffect(() => {
    if (activeController.current !== null && activeController.current !== controller) {
      activeController.current.dispose();
    }
    activeController.current = controller;
    const token = {};
    lifecycleToken.current = token;
    void controller.load();
    return () => {
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
