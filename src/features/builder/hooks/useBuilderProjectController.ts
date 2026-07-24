import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react';

import {
  createBuilderProjectController,
  type BuilderProjectController,
  type BuilderProjectControllerDependencies,
  type BuilderProjectControllerSnapshot,
} from '../application/builderProjectController';

export type UseBuilderProjectControllerOptions = Readonly<
  BuilderProjectControllerDependencies & { projectId?: string }
>;

export type UseBuilderProjectControllerResult = Readonly<{
  snapshot: BuilderProjectControllerSnapshot;
  generate: BuilderProjectController['generate'];
  save: BuilderProjectController['save'];
}>;

const UNAVAILABLE_SNAPSHOT: BuilderProjectControllerSnapshot = Object.freeze({
  status: 'unavailable',
  busy: false,
  savedProject: null,
  draft: null,
  preview: null,
  error: 'unavailable',
});

export function useBuilderProjectController(
  options: UseBuilderProjectControllerOptions,
): UseBuilderProjectControllerResult {
  const { generator, workspace, createPreview, projectId } = options;
  const controller = useMemo(
    () => createBuilderProjectController({
      generator,
      workspace,
      ...(createPreview === undefined ? {} : { createPreview }),
    }),
    [generator, workspace, createPreview],
  );
  const disposalTokens = useRef(new WeakMap<BuilderProjectController, object>());
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );

  useLayoutEffect(() => {
    const selectedProjectId = controller.getSnapshot().savedProject?.target.project_id;
    if (projectId !== undefined && selectedProjectId === projectId) return;
    void controller.open(projectId).catch(() => undefined);
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

  const generate = useCallback<BuilderProjectController['generate']>(
    (instruction) => controller.generate(instruction).catch(() => UNAVAILABLE_SNAPSHOT),
    [controller],
  );
  const save = useCallback<BuilderProjectController['save']>(
    () => controller.save().catch(() => UNAVAILABLE_SNAPSHOT),
    [controller],
  );
  return useMemo(
    () => Object.freeze({ snapshot, generate, save }),
    [snapshot, generate, save],
  );
}
