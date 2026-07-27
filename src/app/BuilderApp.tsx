import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Bell,
  Code2,
  Compass,
  Copy,
  FolderOpen,
  History,
  LayoutTemplate,
  MessageSquare,
  Minus,
  Rocket,
  Settings,
  Square,
  UsersRound,
  X,
  type LucideIcon,
} from 'lucide-react';

import {
  BuilderDesktopBridgeRootError,
  readBuilderDesktopBridgeRoot,
  sanitizeBuilderDesktopBridgeRoot,
  type BuilderDesktopBridgeRoot,
} from './builderDesktopBridgeRoot';
import type {
  BuilderCodeGeneratorPort,
  BuilderGenerationOutputEvent,
  BuilderGenerationStartedEvent,
  BuilderPlanReviewPort,
  BuilderPlanReviewRequest,
  BuilderTaskStreamChangedEvent,
  BuilderTaskStreamPort,
  BuilderProjectWorkspacePort,
} from '../features/builder/application/builderPorts';
import { BuilderDesktopCodeGeneratorPortError, createBuilderDesktopCodeGeneratorPort } from '../features/builder/infrastructure/builderDesktopCodeGeneratorPort';
import {
  BuilderDesktopProjectWorkspacePortError,
  createBuilderDesktopProjectWorkspacePort,
} from '../features/builder/infrastructure/builderDesktopProjectWorkspacePort';
import {
  BuilderDesktopTaskStreamPortError,
  createBuilderDesktopTaskStreamPort,
} from '../features/builder/infrastructure/builderDesktopTaskStreamPort';
import {
  BuilderDesktopPlanReviewPortError,
  createBuilderDesktopPlanReviewPort,
} from '../features/builder/infrastructure/builderDesktopPlanReviewPort';
import { useBuilderConversationController } from '../features/builder/hooks/useBuilderConversationController';
import { useBuilderProjectCatalogController } from '../features/builder/hooks/useBuilderProjectCatalogController';
import { useBuilderProjectController } from '../features/builder/hooks/useBuilderProjectController';
import { useBuilderProjectHistoryController } from '../features/builder/hooks/useBuilderProjectHistoryController';
import { BuilderPage, type BuilderFileName } from '../features/builder/presentation/BuilderPage';
import { BuilderProjectCatalog } from '../features/builder/presentation/BuilderProjectCatalog';
import { BuilderProviderSettingsRouteAdapter } from '../features/builder/presentation/BuilderProviderSettingsRouteAdapter';

export type BuilderAppProps = Readonly<{
  bridgeRoot?: unknown;
}>;

type BuilderAppView = 'project' | 'settings';
type BuilderRailArea =
  | 'projects'
  | 'runs'
  | 'templates'
  | 'community'
  | 'spaces'
  | 'activity'
  | 'publish'
  | 'contacts'
  | 'settings';
type BuilderRailItem = Readonly<{
  Icon: LucideIcon;
  enabled: boolean;
  id: BuilderRailArea;
  label: string;
  view: BuilderAppView | null;
}>;

const BUILDER_RAIL_ITEMS: readonly BuilderRailItem[] = Object.freeze([
  { Icon: FolderOpen, enabled: true, id: 'projects', label: 'Projects', view: 'project' },
  { Icon: History, enabled: false, id: 'runs', label: 'Runs', view: null },
  { Icon: LayoutTemplate, enabled: false, id: 'templates', label: 'Templates', view: null },
  { Icon: Compass, enabled: false, id: 'community', label: 'Explore', view: null },
  { Icon: UsersRound, enabled: false, id: 'spaces', label: 'Spaces', view: null },
  { Icon: Bell, enabled: false, id: 'activity', label: 'Activity', view: null },
  { Icon: Rocket, enabled: false, id: 'publish', label: 'Publish', view: null },
  { Icon: MessageSquare, enabled: false, id: 'contacts', label: 'Contacts', view: null },
  { Icon: Settings, enabled: true, id: 'settings', label: 'Settings', view: 'settings' },
]);
const MAX_LIVE_OUTPUT_TEXT_BYTES = 16 * 1024;
const LIVE_OUTPUT_ENCODER = new TextEncoder();

export type BuilderLiveOutputSnapshot = Readonly<{
  state: 'streaming';
  request_id: string;
  project_id: string;
  text: string;
  chunk_count: number;
}>;

const UNAVAILABLE_ROOT: BuilderDesktopBridgeRoot = Object.freeze({
  bridgeVersion: 'builder-preload.v0',
  codeGenerator: null,
  projectWorkspace: null,
  providerSettings: null,
  permissions: null,
  planReview: null,
  taskStream: null,
  windowControls: null,
});

type BuilderWindowControlsBridge = Readonly<{
  close(): Promise<unknown>;
  minimize(): Promise<unknown>;
  readState(): Promise<unknown>;
  toggleMaximize(): Promise<unknown>;
}>;

const WINDOW_CONTROL_KEYS = new Set(['close', 'minimize', 'readState', 'toggleMaximize']);
const WINDOW_CONTROL_RESULT_KEYS = new Set(['result_version', 'ok']);
const WINDOW_STATE_KEYS = new Set(['state_version', 'maximized']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function ownDataDescriptors(value: Record<string, unknown>, keys: Set<string>): PropertyDescriptorMap | null {
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== keys.size || ownKeys.some((key) => typeof key !== 'string' || !keys.has(key))) {
    return null;
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (
      !descriptor
      || !descriptor.enumerable
      || 'get' in descriptor
      || 'set' in descriptor
    ) return null;
  }
  return descriptors;
}

function safeWindowControls(value: unknown): BuilderWindowControlsBridge | null {
  if (!isPlainObject(value)) return null;
  const descriptors = ownDataDescriptors(value, WINDOW_CONTROL_KEYS);
  if (descriptors === null) return null;
  for (const key of WINDOW_CONTROL_KEYS) {
    if (typeof descriptors[key].value !== 'function') return null;
  }
  return Object.freeze({
    close: descriptors.close.value as BuilderWindowControlsBridge['close'],
    minimize: descriptors.minimize.value as BuilderWindowControlsBridge['minimize'],
    readState: descriptors.readState.value as BuilderWindowControlsBridge['readState'],
    toggleMaximize: descriptors.toggleMaximize.value as BuilderWindowControlsBridge['toggleMaximize'],
  });
}

function safeActionResult(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  const descriptors = ownDataDescriptors(value, WINDOW_CONTROL_RESULT_KEYS);
  return descriptors !== null
    && descriptors.result_version.value === 'builder-window-control-result.v1'
    && descriptors.ok.value === true;
}

function safeMaximizedState(value: unknown): boolean | null {
  if (!isPlainObject(value)) return null;
  const descriptors = ownDataDescriptors(value, WINDOW_STATE_KEYS);
  if (
    descriptors === null
    || descriptors.state_version.value !== 'builder-window-state.v1'
    || typeof descriptors.maximized.value !== 'boolean'
  ) return null;
  return descriptors.maximized.value as boolean;
}

const UNAVAILABLE_WORKSPACE: BuilderProjectWorkspacePort = Object.freeze({
  open(request: Parameters<BuilderProjectWorkspacePort['open']>[0]) {
    void request;
    return Promise.reject(new BuilderDesktopProjectWorkspacePortError());
  },
  saveDraft(request: Parameters<BuilderProjectWorkspacePort['saveDraft']>[0]) {
    void request;
    return Promise.reject(new BuilderDesktopProjectWorkspacePortError());
  },
  loadCurrent(request: Parameters<BuilderProjectWorkspacePort['loadCurrent']>[0]) {
    void request;
    return Promise.reject(new BuilderDesktopProjectWorkspacePortError());
  },
  loadRevision(request: Parameters<BuilderProjectWorkspacePort['loadRevision']>[0]) {
    void request;
    return Promise.reject(new BuilderDesktopProjectWorkspacePortError());
  },
  listCurrent() {
    return Promise.reject(new BuilderDesktopProjectWorkspacePortError());
  },
  listHistory(request: Parameters<BuilderProjectWorkspacePort['listHistory']>[0]) {
    void request;
    return Promise.reject(new BuilderDesktopProjectWorkspacePortError());
  },
});

const UNAVAILABLE_GENERATOR: BuilderCodeGeneratorPort = Object.freeze({
  submit(request: Parameters<BuilderCodeGeneratorPort['submit']>[0]) {
    void request;
    return Promise.reject(new BuilderDesktopCodeGeneratorPortError());
  },
  generate(request: Parameters<BuilderCodeGeneratorPort['generate']>[0]) {
    void request;
    return Promise.reject(new BuilderDesktopCodeGeneratorPortError());
  },
  generateApprovedPlan(request: Parameters<BuilderCodeGeneratorPort['generateApprovedPlan']>[0]) {
    void request;
    return Promise.reject(new BuilderDesktopCodeGeneratorPortError());
  },
  retry(request: Parameters<BuilderCodeGeneratorPort['retry']>[0]) {
    void request;
    return Promise.reject(new BuilderDesktopCodeGeneratorPortError());
  },
  answer(request: Parameters<BuilderCodeGeneratorPort['answer']>[0]) {
    void request;
    return Promise.reject(new BuilderDesktopCodeGeneratorPortError());
  },
  restoreDraft(request: Parameters<BuilderCodeGeneratorPort['restoreDraft']>[0]) {
    void request;
    return Promise.reject(new BuilderDesktopCodeGeneratorPortError());
  },
  rejectDraft(request: Parameters<BuilderCodeGeneratorPort['rejectDraft']>[0]) {
    void request;
    return Promise.reject(new BuilderDesktopCodeGeneratorPortError());
  },
  cancel(request: Parameters<BuilderCodeGeneratorPort['cancel']>[0]) {
    void request;
    return Promise.reject(new BuilderDesktopCodeGeneratorPortError());
  },
  steer(request: Parameters<BuilderCodeGeneratorPort['steer']>[0]) {
    void request;
    return Promise.reject(new BuilderDesktopCodeGeneratorPortError());
  },
  subscribeStarted(listener: (event: BuilderGenerationStartedEvent) => void) {
    void listener;
    return () => undefined;
  },
  subscribeOutput(listener: (event: BuilderGenerationOutputEvent) => void) {
    void listener;
    return () => undefined;
  },
});

const UNAVAILABLE_TASK_STREAM: BuilderTaskStreamPort = Object.freeze({
  read(request: Parameters<BuilderTaskStreamPort['read']>[0]) {
    void request;
    return Promise.reject(new BuilderDesktopTaskStreamPortError());
  },
  subscribeChanged(listener: (event: BuilderTaskStreamChangedEvent) => void) {
    void listener;
    return () => undefined;
  },
});

const UNAVAILABLE_PLAN_REVIEW: BuilderPlanReviewPort = Object.freeze({
  review(request: BuilderPlanReviewRequest) {
    void request;
    return Promise.reject(new BuilderDesktopPlanReviewPortError());
  },
});

function safeRoot(value: unknown): BuilderDesktopBridgeRoot {
  try {
    return value === undefined
      ? readBuilderDesktopBridgeRoot()
      : sanitizeBuilderDesktopBridgeRoot(value);
  } catch {
    return UNAVAILABLE_ROOT;
  }
}

function safePorts(root: BuilderDesktopBridgeRoot) {
  let workspace = UNAVAILABLE_WORKSPACE;
  let generator = UNAVAILABLE_GENERATOR;
  let taskStream = UNAVAILABLE_TASK_STREAM;
  let planReview = UNAVAILABLE_PLAN_REVIEW;
  try {
    workspace = createBuilderDesktopProjectWorkspacePort(root.projectWorkspace);
  } catch {
    workspace = UNAVAILABLE_WORKSPACE;
  }
  try {
    generator = createBuilderDesktopCodeGeneratorPort(root.codeGenerator);
  } catch {
    generator = UNAVAILABLE_GENERATOR;
  }
  try {
    taskStream = createBuilderDesktopTaskStreamPort(root.taskStream);
  } catch {
    taskStream = UNAVAILABLE_TASK_STREAM;
  }
  try {
    planReview = createBuilderDesktopPlanReviewPort(root.planReview);
  } catch {
    planReview = UNAVAILABLE_PLAN_REVIEW;
  }
  return Object.freeze({ generator, planReview, taskStream, workspace });
}

function durableProjectId(snapshot: ReturnType<typeof useBuilderProjectController>['snapshot']): string | null {
  if (
    snapshot.savedProject !== null
    && (snapshot.status === 'ready' || snapshot.status === 'preview_unavailable')
  ) return snapshot.savedProject.target.project_id;
  return null;
}

function visibleConversationProjectId(
  snapshot: ReturnType<typeof useBuilderProjectController>['snapshot'],
): string | null {
  return snapshot.draft?.project_id
    ?? snapshot.savedProject?.target.project_id
    ?? snapshot.answer?.project_id
    ?? snapshot.workingProjectId
    ?? null;
}

function visibleHistoryProjectId(
  snapshot: ReturnType<typeof useBuilderProjectController>['snapshot'],
): string | null {
  return snapshot.savedProject?.target.project_id ?? null;
}

type BuilderVisibleProjectSnapshot = ReturnType<typeof useBuilderProjectController>['snapshot'];
type BuilderVisibleConversationSnapshot = ReturnType<typeof useBuilderConversationController>['snapshot'];

function latestRestorableDraft(
  conversationSnapshot: BuilderVisibleConversationSnapshot,
  projectSnapshot: BuilderVisibleProjectSnapshot,
): Readonly<{ draftId: string; restoreKey: string }> | null {
  if (
    projectSnapshot.busy
    || projectSnapshot.draft !== null
    || projectSnapshot.inspectedRevision !== null
    || projectSnapshot.savedProject === null
    || !['ready', 'generation_failed', 'preview_unavailable'].includes(projectSnapshot.status)
    || conversationSnapshot.status !== 'ready'
    || conversationSnapshot.conversation?.state !== 'ready'
    || conversationSnapshot.project_id !== projectSnapshot.savedProject.target.project_id
  ) return null;
  const items = conversationSnapshot.conversation.conversation.items;
  const savedTarget = projectSnapshot.savedProject.target;
  const reviewedDraftIds = new Set<string>();
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item.item_kind === 'candidate_reviewed') {
      reviewedDraftIds.add(item.draft_id);
      continue;
    }
    if (item.item_kind === 'run_completed' && item.candidate !== null) {
      if (reviewedDraftIds.has(item.candidate.draft_id)) continue;
      if (item.turn_id === savedTarget.turn_id && item.run_id === savedTarget.run_id) {
        return null;
      }
      return Object.freeze({
        draftId: item.candidate.draft_id,
        restoreKey: [
          conversationSnapshot.project_id,
          conversationSnapshot.conversation.conversation.head_sequence,
          savedTarget.revision_receipt_digest,
          item.candidate.draft_id,
        ].join(':'),
      });
    }
  }
  return null;
}

function shouldClearSubmittedIdea(snapshot: BuilderVisibleProjectSnapshot): boolean {
  return snapshot.draft !== null || (
    snapshot.answer !== null
    && snapshot.error === null
  );
}

function shouldReadChangedTaskStream(
  eventProjectId: string,
  snapshot: BuilderVisibleProjectSnapshot,
): boolean {
  const visibleProjectId = visibleConversationProjectId(snapshot);
  return visibleProjectId !== null && eventProjectId === visibleProjectId;
}

function appendLiveOutputText(current: string, delta: string): string | null {
  const next = `${current}${delta}`;
  if (LIVE_OUTPUT_ENCODER.encode(next).byteLength > MAX_LIVE_OUTPUT_TEXT_BYTES) return null;
  return next;
}

export function BuilderApp({ bridgeRoot }: BuilderAppProps) {
  const root = useMemo(() => safeRoot(bridgeRoot), [bridgeRoot]);
  const ports = useMemo(() => safePorts(root), [root]);
  const windowControls = useMemo(() => safeWindowControls(root.windowControls), [root]);
  const catalog = useBuilderProjectCatalogController(ports.workspace);
  const [view, setView] = useState<BuilderAppView>('project');
  const [projectId, setProjectId] = useState<string | undefined>();
  const [workspaceEpoch, setWorkspaceEpoch] = useState(0);
  const [idea, setIdea] = useState('');
  const [activeFile, setActiveFile] = useState<BuilderFileName | null>(null);
  const [liveOutput, setLiveOutput] = useState<BuilderLiveOutputSnapshot | null>(null);
  const [windowMaximized, setWindowMaximized] = useState(false);
  const workspaceEpochRef = useRef(0);
  const windowMaximizedRef = useRef(false);
  const restoreAttemptKeysRef = useRef(new Set<string>());
  const submitInFlightRef = useRef(false);
  const workspacePorts = useMemo(() => {
    void workspaceEpoch;
    const generator: BuilderCodeGeneratorPort = Object.freeze({
      submit(request: Parameters<BuilderCodeGeneratorPort['submit']>[0]) {
        return ports.generator.submit(request);
      },
      generate(request: Parameters<BuilderCodeGeneratorPort['generate']>[0]) {
        return ports.generator.generate(request);
      },
      generateApprovedPlan(request: Parameters<BuilderCodeGeneratorPort['generateApprovedPlan']>[0]) {
        return ports.generator.generateApprovedPlan(request);
      },
      retry(request: Parameters<BuilderCodeGeneratorPort['retry']>[0]) {
        return ports.generator.retry(request);
      },
      answer(request: Parameters<BuilderCodeGeneratorPort['answer']>[0]) {
        return ports.generator.answer(request);
      },
      restoreDraft(request: Parameters<BuilderCodeGeneratorPort['restoreDraft']>[0]) {
        return ports.generator.restoreDraft(request);
      },
      rejectDraft(request: Parameters<BuilderCodeGeneratorPort['rejectDraft']>[0]) {
        return ports.generator.rejectDraft(request);
      },
      cancel(request: Parameters<BuilderCodeGeneratorPort['cancel']>[0]) {
        return ports.generator.cancel(request);
      },
      steer(request: Parameters<BuilderCodeGeneratorPort['steer']>[0]) {
        return ports.generator.steer(request);
      },
      subscribeStarted(listener: (event: BuilderGenerationStartedEvent) => void) {
        return ports.generator.subscribeStarted?.(listener) ?? (() => undefined);
      },
      subscribeOutput(listener: (event: BuilderGenerationOutputEvent) => void) {
        return ports.generator.subscribeOutput?.(listener) ?? (() => undefined);
      },
    });
    const workspace: BuilderProjectWorkspacePort = Object.freeze({
      open(request: Parameters<BuilderProjectWorkspacePort['open']>[0]) {
        return ports.workspace.open(request);
      },
      saveDraft(request: Parameters<BuilderProjectWorkspacePort['saveDraft']>[0]) {
        return ports.workspace.saveDraft(request);
      },
      loadCurrent(request: Parameters<BuilderProjectWorkspacePort['loadCurrent']>[0]) {
        return ports.workspace.loadCurrent(request);
      },
      loadRevision(request: Parameters<BuilderProjectWorkspacePort['loadRevision']>[0]) {
        return ports.workspace.loadRevision(request);
      },
      listCurrent() { return ports.workspace.listCurrent(); },
      listHistory(request: Parameters<BuilderProjectWorkspacePort['listHistory']>[0]) {
        return ports.workspace.listHistory(request);
      },
    });
    return Object.freeze({ generator, workspace });
  }, [ports, workspaceEpoch]);
  const project = useBuilderProjectController({
    generator: workspacePorts.generator,
    workspace: workspacePorts.workspace,
    projectId,
  });
  const conversation = useBuilderConversationController(
    ports.taskStream,
    visibleConversationProjectId(project.snapshot),
  );
  const history = useBuilderProjectHistoryController(
    ports.workspace,
    visibleHistoryProjectId(project.snapshot),
  );
  const projectSnapshotRef = useRef(project.snapshot);
  const conversationRef = useRef(conversation);

  useLayoutEffect(() => {
    projectSnapshotRef.current = project.snapshot;
  }, [project.snapshot]);

  useLayoutEffect(() => {
    conversationRef.current = conversation;
  }, [conversation]);

  useEffect(() => (
    ports.taskStream.subscribeChanged((event) => {
      const currentSnapshot = projectSnapshotRef.current;
      if (!shouldReadChangedTaskStream(event.project_id, currentSnapshot)) return;
      void conversationRef.current.load(event.project_id).catch(() => undefined);
    })
  ), [ports.taskStream]);

  useEffect(() => (
    ports.generator.subscribeStarted?.((event) => {
      const currentSnapshot = projectSnapshotRef.current;
      const visibleProjectId = visibleConversationProjectId(currentSnapshot);
      if (!currentSnapshot.busy) return;
      if (visibleProjectId !== null && visibleProjectId !== event.project_id) return;
      setLiveOutput(Object.freeze({
        state: 'streaming',
        request_id: event.request_id,
        project_id: event.project_id,
        text: '',
        chunk_count: 0,
      }));
    }) ?? (() => undefined)
  ), [ports.generator]);

  useEffect(() => (
    ports.generator.subscribeOutput?.((event) => {
      setLiveOutput((current) => {
        if (
          current === null
          || current.request_id !== event.request_id
          || current.project_id !== event.project_id
        ) return current;
        const text = appendLiveOutputText(current.text, event.display_delta_text);
        if (text === null) return current;
        return Object.freeze({
          ...current,
          text,
          chunk_count: current.chunk_count + 1,
        });
      });
    }) ?? (() => undefined)
  ), [ports.generator]);

  const resetWorkspace = useCallback((nextProjectId: string | undefined) => {
    workspaceEpochRef.current += 1;
    restoreAttemptKeysRef.current.clear();
    submitInFlightRef.current = false;
    setWorkspaceEpoch(workspaceEpochRef.current);
    setProjectId(nextProjectId);
    setIdea('');
    setActiveFile(null);
    setLiveOutput(null);
    setView('project');
  }, []);

  const openProject = useCallback((nextProjectId: string) => {
    resetWorkspace(nextProjectId);
  }, [resetWorkspace]);

  const newProject = useCallback(() => {
    resetWorkspace(undefined);
  }, [resetWorkspace]);

  const refreshCatalog = useCallback(() => {
    void catalog.refresh().catch(() => undefined);
  }, [catalog]);

  const readActivityAfterTerminal = useCallback(async (
    result: BuilderVisibleProjectSnapshot,
    commandEpoch: number,
    fallbackProjectId: string | null = null,
  ) => {
    if (workspaceEpochRef.current !== commandEpoch) return;
    const conversationProjectId = visibleConversationProjectId(result) ?? fallbackProjectId;
    if (conversationProjectId === null) return;
    await conversation.load(conversationProjectId).catch(() => undefined);
  }, [conversation]);

  useEffect(() => {
    const target = latestRestorableDraft(conversation.snapshot, project.snapshot);
    if (target === null) return;
    const commandEpoch = workspaceEpochRef.current;
    const attemptKey = `${commandEpoch}:${target.restoreKey}`;
    if (restoreAttemptKeysRef.current.has(attemptKey)) return;
    restoreAttemptKeysRef.current.add(attemptKey);
    window.setTimeout(() => {
      if (workspaceEpochRef.current !== commandEpoch) return;
      void project.restoreDraft(target.draftId).then(async (result) => {
        if (result.inspectedRevision !== null) {
          restoreAttemptKeysRef.current.delete(attemptKey);
          return;
        }
        if (
          workspaceEpochRef.current !== commandEpoch
          || result.draft?.draft_id !== target.draftId
        ) return;
        await readActivityAfterTerminal(result, commandEpoch);
      }).catch(() => undefined);
    });
  }, [conversation.snapshot, project, project.snapshot, readActivityAfterTerminal]);

  const submitInstruction = useCallback(async () => {
    if (submitInFlightRef.current || idea.trim().length === 0) return;
    const commandEpoch = workspaceEpochRef.current;
    const submittedIdea = idea;
    submitInFlightRef.current = true;
    setIdea('');
    setLiveOutput(null);
    try {
      const result = await project.submit(submittedIdea);
      if (workspaceEpochRef.current !== commandEpoch) return;
      if (!shouldClearSubmittedIdea(result)) setIdea(submittedIdea);
      await readActivityAfterTerminal(result, commandEpoch);
      setLiveOutput(null);
    } finally {
      if (workspaceEpochRef.current === commandEpoch) {
        submitInFlightRef.current = false;
      }
    }
  }, [idea, project, readActivityAfterTerminal]);

  const retryGenerate = useCallback(async () => {
    const commandEpoch = workspaceEpochRef.current;
    setLiveOutput(null);
    const result = await project.retryGenerate();
    if (workspaceEpochRef.current !== commandEpoch) return;
    if (shouldClearSubmittedIdea(result)) setIdea('');
    await readActivityAfterTerminal(result, commandEpoch);
    setLiveOutput(null);
  }, [project, readActivityAfterTerminal]);

  const cancel = useCallback(async () => {
    const commandEpoch = workspaceEpochRef.current;
    const result = await project.cancel();
    if (workspaceEpochRef.current !== commandEpoch) return;
    await readActivityAfterTerminal(result, commandEpoch);
    setLiveOutput(null);
  }, [project, readActivityAfterTerminal]);

  const rejectDraft = useCallback(async () => {
    const commandEpoch = workspaceEpochRef.current;
    const draftProjectId = project.snapshot.draft?.project_id ?? null;
    const result = await project.rejectDraft();
    if (workspaceEpochRef.current !== commandEpoch) return;
    await readActivityAfterTerminal(result, commandEpoch, draftProjectId);
    setLiveOutput(null);
  }, [project, readActivityAfterTerminal]);

  const save = useCallback(async () => {
    const commandEpoch = workspaceEpochRef.current;
    const result = await project.save();
    if (workspaceEpochRef.current !== commandEpoch) return;
    await readActivityAfterTerminal(result, commandEpoch);
    setLiveOutput(null);
    const savedProjectId = durableProjectId(result);
    if (savedProjectId !== null) {
      setProjectId(savedProjectId);
      await catalog.refresh().catch(() => undefined);
      if (history.snapshot.project_id === savedProjectId) {
        await history.reload().catch(() => undefined);
      } else {
        await history.load(savedProjectId).catch(() => undefined);
      }
    }
  }, [catalog, history, project, readActivityAfterTerminal]);
  const reviewPlan = useCallback(async (request: BuilderPlanReviewRequest) => {
    const commandEpoch = workspaceEpochRef.current;
    let reviewed = false;
    try {
      await ports.planReview.review(request);
      reviewed = true;
    } catch {
      reviewed = false;
    }
    if (workspaceEpochRef.current !== commandEpoch) return;
    await conversation.load(request.project_id).catch(() => undefined);
    if (!reviewed || request.decision !== 'approved') return;
    setLiveOutput(null);
    const result = await project.generateApprovedPlan({
      project_id: request.project_id,
      conversation_id: request.conversation_id,
      turn_id: request.turn_id,
      run_id: request.run_id,
    });
    if (workspaceEpochRef.current !== commandEpoch) return;
    await readActivityAfterTerminal(result, commandEpoch, request.project_id);
    setLiveOutput(null);
  }, [conversation, ports.planReview, project, readActivityAfterTerminal]);
  const inspectRevision = useCallback(async (targetProjectId: string, revisionReceiptDigest: string) => {
    setActiveFile(null);
    await project.inspectRevision(targetProjectId, revisionReceiptDigest);
  }, [project]);
  const showCurrentRevision = useCallback(async () => {
    const commandEpoch = workspaceEpochRef.current;
    setActiveFile(null);
    const result = await project.showCurrentRevision();
    if (workspaceEpochRef.current !== commandEpoch) return;
    await readActivityAfterTerminal(result, commandEpoch);
  }, [project, readActivityAfterTerminal]);
  const windowControlsAvailable = windowControls !== null;

  const publishWindowMaximized = useCallback((maximized: boolean) => {
    if (windowMaximizedRef.current === maximized) return;
    windowMaximizedRef.current = maximized;
    setWindowMaximized(maximized);
  }, []);

  const refreshWindowState = useCallback(async () => {
    if (windowControls === null) {
      publishWindowMaximized(false);
      return;
    }
    try {
      const maximized = safeMaximizedState(await windowControls.readState());
      if (maximized !== null) publishWindowMaximized(maximized);
    } catch {
      publishWindowMaximized(false);
    }
  }, [publishWindowMaximized, windowControls]);

  useEffect(() => {
    let active = true;
    const refresh = () => {
      void (async () => {
        if (windowControls === null) {
          if (active) publishWindowMaximized(false);
          return;
        }
        try {
          const maximized = safeMaximizedState(await windowControls.readState());
          if (active && maximized !== null) publishWindowMaximized(maximized);
        } catch {
          if (active) publishWindowMaximized(false);
        }
      })();
    };
    refresh();
    window.addEventListener('resize', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      active = false;
      window.removeEventListener('resize', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [publishWindowMaximized, windowControls]);

  const invokeWindowControl = useCallback(async (
    action: () => Promise<unknown>,
    options: { refresh?: boolean } = {},
  ) => {
    if (windowControls === null) return;
    try {
      if (safeActionResult(await action()) && options.refresh === true) {
        await refreshWindowState();
      }
    } catch {
      if (options.refresh === true) await refreshWindowState();
    }
  }, [refreshWindowState, windowControls]);

  return (
    <main className="cf-builder-workbench cf-builder-desktop-shell min-h-screen text-foreground" data-builder-workbench="true">
      <header className="cf-builder-app-chrome" aria-label="ClawFabric Builder window" data-builder-app-chrome="true">
        <div className="cf-builder-app-chrome-title min-w-0">
          <span className="cf-builder-brand-mark inline-flex size-7 items-center justify-center" aria-hidden="true">
            <Code2 className="size-4" />
          </span>
          <div className="min-w-0">
            <strong className="block truncate text-sm">ClawFabric Builder</strong>
          </div>
        </div>
        <div className="cf-builder-window-controls-slot" aria-label="Window controls">
          <button
            aria-label="Minimize window"
            className="cf-builder-window-control-button"
            disabled={!windowControlsAvailable}
            onClick={() => {
              void invokeWindowControl(() => windowControls?.minimize() ?? Promise.resolve(null));
            }}
            type="button"
          >
            <Minus aria-hidden="true" className="size-4" />
          </button>
          <button
            aria-label={windowMaximized ? 'Restore window' : 'Maximize window'}
            className="cf-builder-window-control-button"
            disabled={!windowControlsAvailable}
            onClick={() => {
              void invokeWindowControl(
                () => windowControls?.toggleMaximize() ?? Promise.resolve(null),
                { refresh: true },
              );
            }}
            type="button"
          >
            {windowMaximized ? (
              <Copy aria-hidden="true" className="size-4" />
            ) : (
              <Square aria-hidden="true" className="size-3.5" />
            )}
          </button>
          <button
            aria-label="Close window"
            className="cf-builder-window-control-button cf-builder-window-control-close"
            disabled={!windowControlsAvailable}
            onClick={() => {
              void invokeWindowControl(() => windowControls?.close() ?? Promise.resolve(null));
            }}
            type="button"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>
      </header>

      <div className="cf-builder-shell">
        <aside className="cf-builder-rail" aria-label="Builder primary navigation" data-builder-workbench-rail="true">
          <div className="cf-builder-rail-brand" aria-hidden="true">
            <span className="cf-builder-brand-mark inline-flex size-8 items-center justify-center">
              <Code2 aria-hidden="true" className="size-4" />
            </span>
          </div>
          <nav className="cf-builder-rail-nav" aria-label="Builder views">
            {BUILDER_RAIL_ITEMS.filter((item) => item.enabled).map(({ Icon, id, label, view: targetView }) => (
              <button
                aria-pressed={view === targetView}
                className="cf-builder-nav-button cf-builder-rail-button inline-flex items-center justify-center gap-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
                key={id}
                onClick={() => {
                  if (targetView !== null) setView(targetView);
                }}
                type="button"
              >
                <Icon aria-hidden="true" className="size-4" />
                {label}
              </button>
            ))}
          </nav>
        </aside>

        <aside className="cf-builder-context cf-builder-context-sidebar" aria-label="Builder navigation" data-builder-workbench-context="true">
          <div className="cf-builder-context-body">
            <BuilderProjectCatalog
              onCreateProject={newProject}
              onOpenProject={openProject}
              onRefresh={refreshCatalog}
              snapshot={catalog.snapshot}
            />
          </div>
        </aside>

        <section className="cf-builder-main-frame cf-builder-workbench-frame" aria-label="Builder workbench" data-builder-workbench-frame="true">
          {view === 'settings' ? (
            <div className="cf-builder-settings-surface bg-background text-foreground">
              <header className="cf-builder-surface-toolbar">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-muted-foreground">ClawFabric Builder</p>
                  <h1 className="truncate text-base font-semibold">AI provider settings</h1>
                </div>
                <button
                  className="cf-builder-secondary-button inline-flex min-h-9 shrink-0 items-center justify-center px-3 text-sm font-medium"
                  onClick={() => setView('project')}
                  type="button"
                >
                  Back to project
                </button>
              </header>
              <div className="cf-builder-settings-body">
                <BuilderProviderSettingsRouteAdapter providerSettingsBridge={root.providerSettings} />
              </div>
            </div>
          ) : (
            <BuilderPage
              activeFile={activeFile}
              instruction={idea}
              liveOutput={liveOutput}
              onSubmitInstruction={submitInstruction}
              onInstructionChange={setIdea}
              onInspectRevision={inspectRevision}
              onOpenSettings={() => setView('settings')}
              onRetryGenerate={retryGenerate}
              onCancel={cancel}
              onRejectDraft={rejectDraft}
              onSave={save}
              onSelectFile={setActiveFile}
              onRefreshConversation={conversation.refresh}
              onRefreshHistory={history.refresh}
              onReviewPlan={reviewPlan}
              onShowCurrentRevision={showCurrentRevision}
              conversationSnapshot={conversation.snapshot}
              historySnapshot={history.snapshot}
              snapshot={project.snapshot}
            />
          )}
        </section>
      </div>
    </main>
  );
}

export { BuilderDesktopBridgeRootError };
