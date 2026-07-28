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
  createLocalProject: BuilderProjectController['createLocalProject'];
  submit: BuilderProjectController['submit'];
  answer: BuilderProjectController['answer'];
  proposePlan: BuilderProjectController['proposePlan'];
  generate: BuilderProjectController['generate'];
  generateApprovedPlan: BuilderProjectController['generateApprovedPlan'];
  retryGenerate: BuilderProjectController['retryGenerate'];
  restoreDraft: BuilderProjectController['restoreDraft'];
  restoreRevisionAsDraft: BuilderProjectController['restoreRevisionAsDraft'];
  inspectRevision: BuilderProjectController['inspectRevision'];
  showCurrentRevision: BuilderProjectController['showCurrentRevision'];
  rejectDraft: BuilderProjectController['rejectDraft'];
  cancel: BuilderProjectController['cancel'];
  steer: BuilderProjectController['steer'];
  save: BuilderProjectController['save'];
}>;

const UNAVAILABLE_SNAPSHOT: BuilderProjectControllerSnapshot = Object.freeze({
  status: 'unavailable',
  busy: false,
  savedProject: null,
  draft: null,
  inspectedRevision: null,
  answer: null,
  preview: null,
  error: 'unavailable',
  retryableGeneration: false,
  workingProjectId: null,
  workingProject: null,
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
    const current = controller.getSnapshot();
    const selectedProjectId = current.savedProject?.target.project_id ?? current.workingProjectId;
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
  const createLocalProject = useCallback<BuilderProjectController['createLocalProject']>(
    (projectTitle) => controller.createLocalProject(projectTitle).catch(() => controller.getSnapshot()),
    [controller],
  );
  const submit = useCallback<BuilderProjectController['submit']>(
    (instruction) => controller.submit(instruction).catch(() => UNAVAILABLE_SNAPSHOT),
    [controller],
  );
  const answer = useCallback<BuilderProjectController['answer']>(
    (instruction) => controller.answer(instruction).catch(() => UNAVAILABLE_SNAPSHOT),
    [controller],
  );
  const proposePlan = useCallback<BuilderProjectController['proposePlan']>(
    (instruction) => controller.proposePlan(instruction).catch(() => UNAVAILABLE_SNAPSHOT),
    [controller],
  );
  const generateApprovedPlan = useCallback<BuilderProjectController['generateApprovedPlan']>(
    (request) => controller.generateApprovedPlan(request).catch(() => UNAVAILABLE_SNAPSHOT),
    [controller],
  );
  const retryGenerate = useCallback<BuilderProjectController['retryGenerate']>(
    () => controller.retryGenerate().catch(() => UNAVAILABLE_SNAPSHOT),
    [controller],
  );
  const save = useCallback<BuilderProjectController['save']>(
    () => controller.save().catch(() => UNAVAILABLE_SNAPSHOT),
    [controller],
  );
  const restoreDraft = useCallback<BuilderProjectController['restoreDraft']>(
    (draftId) => controller.restoreDraft(draftId).catch(() => controller.getSnapshot()),
    [controller],
  );
  const restoreRevisionAsDraft = useCallback<BuilderProjectController['restoreRevisionAsDraft']>(
    (projectId, revisionReceiptDigest) => (
      controller.restoreRevisionAsDraft(projectId, revisionReceiptDigest).catch(() => controller.getSnapshot())
    ),
    [controller],
  );
  const inspectRevision = useCallback<BuilderProjectController['inspectRevision']>(
    (projectId, revisionReceiptDigest) => (
      controller.inspectRevision(projectId, revisionReceiptDigest).catch(() => controller.getSnapshot())
    ),
    [controller],
  );
  const showCurrentRevision = useCallback<BuilderProjectController['showCurrentRevision']>(
    () => controller.showCurrentRevision().catch(() => controller.getSnapshot()),
    [controller],
  );
  const rejectDraft = useCallback<BuilderProjectController['rejectDraft']>(
    () => controller.rejectDraft().catch(() => controller.getSnapshot()),
    [controller],
  );
  const cancel = useCallback<BuilderProjectController['cancel']>(
    () => controller.cancel().catch(() => controller.getSnapshot()),
    [controller],
  );
  const steer = useCallback<BuilderProjectController['steer']>(
    (message) => controller.steer(message).catch(() => false),
    [controller],
  );
  return useMemo(
    () => Object.freeze({
      snapshot,
      createLocalProject,
      submit,
      answer,
      proposePlan,
      generate,
      generateApprovedPlan,
      retryGenerate,
      restoreDraft,
      restoreRevisionAsDraft,
      inspectRevision,
      showCurrentRevision,
      rejectDraft,
      cancel,
      steer,
      save,
    }),
    [
      snapshot,
      createLocalProject,
      submit,
      answer,
      proposePlan,
      generate,
      generateApprovedPlan,
      retryGenerate,
      restoreDraft,
      restoreRevisionAsDraft,
      inspectRevision,
      showCurrentRevision,
      rejectDraft,
      cancel,
      steer,
      save,
    ],
  );
}
