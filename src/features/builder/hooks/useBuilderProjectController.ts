import {
  useCallback,
  useLayoutEffect,
  useMemo,
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
  retrySave: BuilderProjectController['retrySave'];
}>;

type ControllerAuthority = Readonly<{
  activate(): void;
  controller: BuilderProjectController;
  isActive(): boolean;
  projectId: string | undefined;
  retire(): void;
  run(
    command: 'generate' | 'retrySave',
    operation: () => Promise<BuilderProjectControllerSnapshot>,
  ): Promise<BuilderProjectControllerSnapshot>;
}>;

function createControllerAuthority(
  controller: BuilderProjectController,
  projectId: string | undefined,
): ControllerAuthority {
  let activationEpoch = 0;
  let activeEpoch: number | null = null;
  const commandFlights: Partial<Record<
    'generate' | 'retrySave',
    { epoch: number; promise: Promise<BuilderProjectControllerSnapshot> }
  >> = {};
  return Object.freeze({
    activate() {
      activationEpoch += 1;
      activeEpoch = activationEpoch;
    },
    controller,
    isActive() { return activeEpoch !== null; },
    projectId,
    retire() { activeEpoch = null; },
    run(command, operation) {
      const epoch = activeEpoch;
      if (epoch === null) return Promise.resolve(UNAVAILABLE_SNAPSHOT);
      const existing = commandFlights[command];
      if (existing?.epoch === epoch) return existing.promise;
      const running = Promise.resolve()
        .then(async () => {
          if (activeEpoch !== epoch) return UNAVAILABLE_SNAPSHOT;
          const result = await operation();
          return activeEpoch === epoch ? result : UNAVAILABLE_SNAPSHOT;
        })
        .catch(() => UNAVAILABLE_SNAPSHOT);
      const flight = { epoch, promise: running };
      commandFlights[command] = flight;
      void running.finally(() => {
        if (commandFlights[command] === flight) delete commandFlights[command];
      }).catch(() => undefined);
      return running;
    },
  });
}

const NEW_SNAPSHOT: BuilderProjectControllerSnapshot = Object.freeze({
  status: 'new',
  busy: false,
  savedRevision: null,
  preview: null,
  error: null,
});
const OPENING_SNAPSHOT: BuilderProjectControllerSnapshot = Object.freeze({
  status: 'opening',
  busy: true,
  savedRevision: null,
  preview: null,
  error: null,
});
const UNAVAILABLE_SNAPSHOT: BuilderProjectControllerSnapshot = Object.freeze({
  status: 'unavailable',
  busy: false,
  savedRevision: null,
  preview: null,
  error: 'unavailable',
});

export function useBuilderProjectController(
  options: UseBuilderProjectControllerOptions,
): UseBuilderProjectControllerResult {
  const {
    generator,
    repository,
    createProjectId,
    createPreview,
    projectId,
  } = options;
  const controller = useMemo(
    () => createBuilderProjectController({
      generator,
      repository,
      ...(createProjectId === undefined ? {} : { createProjectId }),
      ...(createPreview === undefined ? {} : { createPreview }),
    }),
    [generator, repository, createProjectId, createPreview],
  );
  const authority = useMemo<ControllerAuthority>(
    () => createControllerAuthority(controller, projectId),
    [controller, projectId],
  );

  const controllerSnapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );

  useLayoutEffect(() => {
    authority.activate();
    void controller.open(projectId).catch(() => undefined);
    return () => {
      authority.retire();
      void controller.open().catch(() => undefined);
    };
  }, [authority, controller, projectId]);

  const snapshot = useMemo<BuilderProjectControllerSnapshot>(() => {
    if (!authority.isActive()) return projectId === undefined ? NEW_SNAPSHOT : OPENING_SNAPSHOT;
    if (
      projectId !== undefined
      && controllerSnapshot.savedRevision !== null
      && controllerSnapshot.savedRevision.project_id !== projectId
    ) return OPENING_SNAPSHOT;
    return controllerSnapshot;
  }, [authority, controllerSnapshot, projectId]);

  const generate = useCallback<BuilderProjectController['generate']>(
    (idea) => authority.run('generate', () => controller.generate(idea)),
    [authority, controller],
  );
  const retrySave = useCallback<BuilderProjectController['retrySave']>(
    () => authority.run('retrySave', () => controller.retrySave()),
    [authority, controller],
  );

  return useMemo(
    () => Object.freeze({ snapshot, generate, retrySave }),
    [snapshot, generate, retrySave],
  );
}
