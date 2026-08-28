import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react';

import {
  createBuilderAgentWorkbenchController,
} from '../application/builderAgentWorkbenchController';
import type { BuilderAgentWorkbenchController } from '../application/builderAgentWorkbenchController';
import type { BuilderAgentWorkbenchPort } from '../application/builderPorts';
import { DEFAULT_BUILDER_AGENT_ID } from '../domain/builderAgentProjectTreeProjection';

export function useBuilderAgentWorkbenchController(port: BuilderAgentWorkbenchPort) {
  const controller = useMemo(
    () => createBuilderAgentWorkbenchController(port, DEFAULT_BUILDER_AGENT_ID),
    [port],
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
  const updateMessageState = useCallback<BuilderAgentWorkbenchController['updateMessageState']>(
    (messageId, operation) => controller.updateMessageState(messageId, operation),
    [controller],
  );
  const createTaskProposal = useCallback<BuilderAgentWorkbenchController['createTaskProposal']>(
    (request) => controller.createTaskProposal(request),
    [controller],
  );
  const decideTaskProposal = useCallback<BuilderAgentWorkbenchController['decideTaskProposal']>(
    (request) => controller.decideTaskProposal(request),
    [controller],
  );
  const controlTask = useCallback<BuilderAgentWorkbenchController['controlTask']>(
    (request) => controller.controlTask(request),
    [controller],
  );
  return useMemo(
    () => Object.freeze({
      snapshot,
      refresh,
      updateMessageState,
      createTaskProposal,
      decideTaskProposal,
      controlTask,
    }),
    [controlTask, createTaskProposal, decideTaskProposal, refresh, snapshot, updateMessageState],
  );
}
