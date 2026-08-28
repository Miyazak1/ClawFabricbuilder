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
  BuilderProjectControllerDependencies & {
    preserveSelectionWhenProjectIdUndefined?: boolean;
    projectId?: string;
    taskAddressId?: string | null;
  }
>;

export type UseBuilderProjectControllerResult = Readonly<{
  snapshot: BuilderProjectControllerSnapshot;
  retainConversationProject: BuilderProjectController['retainConversationProject'];
  clearWorkspaceSelection: BuilderProjectController['clearWorkspaceSelection'];
  createLocalProject: BuilderProjectController['createLocalProject'];
  createNewLocalProject: BuilderProjectController['createNewLocalProject'];
  submit: BuilderProjectController['submit'];
  answer: BuilderProjectController['answer'];
  proposePlan: BuilderProjectController['proposePlan'];
  generate: BuilderProjectController['generate'];
  generateApprovedPlan: BuilderProjectController['generateApprovedPlan'];
  retryGenerate: BuilderProjectController['retryGenerate'];
  restoreDraft: BuilderProjectController['restoreDraft'];
  restoreRevisionAsDraft: BuilderProjectController['restoreRevisionAsDraft'];
  restorePreviousCheckpointAsDraft: BuilderProjectController['restorePreviousCheckpointAsDraft'];
  inspectRevision: BuilderProjectController['inspectRevision'];
  showCurrentRevision: BuilderProjectController['showCurrentRevision'];
  rejectDraft: BuilderProjectController['rejectDraft'];
  cancel: BuilderProjectController['cancel'];
  steer: BuilderProjectController['steer'];
  queueFollowup: BuilderProjectController['queueFollowup'];
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
  conversationProjectId: null,
  workingProjectId: null,
  workingProject: null,
});

export function useBuilderProjectController(
  options: UseBuilderProjectControllerOptions,
): UseBuilderProjectControllerResult {
  const {
    generator,
    workspace,
    createPreview,
    preserveSelectionWhenProjectIdUndefined = false,
    projectId,
    taskAddressId,
  } = options;
  const controller = useMemo(
    () => createBuilderProjectController({
      generator,
      workspace,
      ...(createPreview === undefined ? {} : { createPreview }),
    }),
    [generator, workspace, createPreview],
  );
  const disposalTokens = useRef(new WeakMap<BuilderProjectController, object>());
  const requestedProjectSelection = useRef<Readonly<{
    controller: BuilderProjectController;
    projectId: string | undefined;
    taskAddressId: string | null;
  }> | null>(null);
  const retainedWorkbenchDraftSelection = useRef<Readonly<{
    projectId: string;
    taskAddressId: string | null;
  }> | null>(null);
  const hiddenProjectClearRequested = useRef(false);
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );

  useLayoutEffect(() => {
    controller.selectTaskAddress(taskAddressId ?? null);
  }, [controller, taskAddressId]);

  useLayoutEffect(() => {
    const previousRequest = requestedProjectSelection.current;
    const selectionChanged = (
      previousRequest === null
      || previousRequest.controller !== controller
      || previousRequest.projectId !== projectId
    );
    requestedProjectSelection.current = { controller, projectId, taskAddressId: taskAddressId ?? null };
    if (!selectionChanged) return;
    const current = controller.getSnapshot();
    const selectedProjectId = current.savedProject?.target.project_id ?? current.workingProjectId;
    const conversationProjectId = current.conversationProjectId ?? current.answer?.project_id;
    if (projectId === undefined && preserveSelectionWhenProjectIdUndefined) {
      hiddenProjectClearRequested.current = false;
      if (selectedProjectId !== null) {
        retainedWorkbenchDraftSelection.current = Object.freeze({
          projectId: selectedProjectId,
          taskAddressId: previousRequest?.taskAddressId ?? null,
        });
      }
      return;
    }
    if (projectId === undefined && current.draft !== null && selectedProjectId !== null) {
      hiddenProjectClearRequested.current = false;
      retainedWorkbenchDraftSelection.current = Object.freeze({
        projectId: selectedProjectId,
        taskAddressId: previousRequest?.taskAddressId ?? null,
      });
      return;
    }
    const retainedDraftSelection = retainedWorkbenchDraftSelection.current;
    if (projectId !== undefined && current.draft?.project_id === projectId) {
      const returningFromWorkbench = retainedDraftSelection !== null;
      const returningToRetainedTask = (
        retainedDraftSelection?.projectId === projectId
        && retainedDraftSelection.taskAddressId === (taskAddressId ?? null)
      );
      if (!returningFromWorkbench || returningToRetainedTask) {
        hiddenProjectClearRequested.current = false;
        retainedWorkbenchDraftSelection.current = null;
        return;
      }
    }
    retainedWorkbenchDraftSelection.current = null;
    if (projectId === undefined && selectedProjectId === null && conversationProjectId !== null) {
      hiddenProjectClearRequested.current = false;
      return;
    }
    if (projectId === undefined) {
      hiddenProjectClearRequested.current = selectedProjectId !== null;
      void controller.open(projectId).catch(() => undefined);
      return;
    }
    const mustReopenAfterHiddenClear = hiddenProjectClearRequested.current;
    hiddenProjectClearRequested.current = false;
    if (!mustReopenAfterHiddenClear && selectedProjectId === projectId) return;
    void controller.open(projectId).catch(() => undefined);
  }, [controller, preserveSelectionWhenProjectIdUndefined, projectId, taskAddressId]);

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
  const createNewLocalProject = useCallback<BuilderProjectController['createNewLocalProject']>(
    (projectTitle) => controller.createNewLocalProject(projectTitle).catch(() => controller.getSnapshot()),
    [controller],
  );
  const retainConversationProject = useCallback<BuilderProjectController['retainConversationProject']>(
    (projectId) => controller.retainConversationProject(projectId),
    [controller],
  );
  const clearWorkspaceSelection = useCallback<BuilderProjectController['clearWorkspaceSelection']>(
    () => controller.clearWorkspaceSelection(),
    [controller],
  );
  const submit = useCallback<BuilderProjectController['submit']>(
    (instruction, queuedFollowup) => controller.submit(instruction, queuedFollowup).catch(() => UNAVAILABLE_SNAPSHOT),
    [controller],
  );
  const answer = useCallback<BuilderProjectController['answer']>(
    (instruction, queuedFollowup, responseMode) => controller
      .answer(instruction, queuedFollowup, responseMode)
      .catch(() => UNAVAILABLE_SNAPSHOT),
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
  const restorePreviousCheckpointAsDraft = useCallback<
    BuilderProjectController['restorePreviousCheckpointAsDraft']
  >(
    () => controller.restorePreviousCheckpointAsDraft().catch(() => controller.getSnapshot()),
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
  const queueFollowup = useCallback<BuilderProjectController['queueFollowup']>(
    (message) => controller.queueFollowup(message).catch(() => null),
    [controller],
  );
  return useMemo(
    () => Object.freeze({
      snapshot,
      retainConversationProject,
      clearWorkspaceSelection,
      createLocalProject,
      createNewLocalProject,
      submit,
      answer,
      proposePlan,
      generate,
      generateApprovedPlan,
      retryGenerate,
      restoreDraft,
      restoreRevisionAsDraft,
      restorePreviousCheckpointAsDraft,
      inspectRevision,
      showCurrentRevision,
      rejectDraft,
      cancel,
      steer,
      queueFollowup,
      save,
    }),
    [
      snapshot,
      retainConversationProject,
      clearWorkspaceSelection,
      createLocalProject,
      createNewLocalProject,
      submit,
      answer,
      proposePlan,
      generate,
      generateApprovedPlan,
      retryGenerate,
      restoreDraft,
      restoreRevisionAsDraft,
      restorePreviousCheckpointAsDraft,
      inspectRevision,
      showCurrentRevision,
      rejectDraft,
      cancel,
      steer,
      queueFollowup,
      save,
    ],
  );
}
