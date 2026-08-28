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
  probe: BuilderConversationController['probe'];
}>;

export function useBuilderConversationController(
  port: BuilderTaskStreamPort,
  projectId?: string | null,
  taskAddressId?: string | null,
  agentId?: string | null,
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
    const selectedTaskAddressId = taskAddressId ?? null;
    const selectedAgentId = selectedProjectId === null ? (agentId ?? null) : null;
    const current = controller.getSnapshot();
    if (
      current.agent_id === selectedAgentId
      &&
      current.project_id === selectedProjectId
      && current.task_address_id === selectedTaskAddressId
    ) return;
    void controller.load(
      selectedProjectId,
      selectedTaskAddressId,
      selectedAgentId,
    ).catch(() => undefined);
  }, [agentId, controller, projectId, taskAddressId]);

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
    (nextProjectId, nextTaskAddressId, nextAgentId) => (
      controller.load(nextProjectId, nextTaskAddressId, nextAgentId)
        .catch(() => controller.getSnapshot())
    ),
    [controller],
  );
  const refresh = useCallback(() => controller.refresh(), [controller]);
  const probe = useCallback<BuilderConversationController['probe']>(
    (nextProjectId, nextTaskAddressId) => controller.probe(nextProjectId, nextTaskAddressId),
    [controller],
  );
  return useMemo(() => Object.freeze({ snapshot, load, probe, refresh }), [load, probe, refresh, snapshot]);
}
