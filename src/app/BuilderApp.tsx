import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Bell,
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
  BuilderCurrentProjectWriteApprovalStatus,
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
import {
  type BuilderConversationControllerSnapshot,
} from '../features/builder/application/builderConversationController';
import {
  createBuilderComposerRouteDecisionEvidence,
  decideBuilderComposerIntent,
  isBuilderComposerContextualBuildIntent,
  isBuilderComposerExplicitBriefIntent,
  type BuilderComposerApprovalMode,
  type BuilderComposerRouteDecision,
  type BuilderComposerRouteDecisionEvidence,
} from '../features/builder/application/builderComposerIntent';
import { useBuilderConversationController } from '../features/builder/hooks/useBuilderConversationController';
import { useBuilderProjectCatalogController } from '../features/builder/hooks/useBuilderProjectCatalogController';
import { useBuilderProjectController } from '../features/builder/hooks/useBuilderProjectController';
import { useBuilderProjectHistoryController } from '../features/builder/hooks/useBuilderProjectHistoryController';
import {
  BuilderPage,
  type BuilderFileName,
  type BuilderPlanReviewInFlight,
  type BuilderPlanSourceReadApprovalPrompt,
} from '../features/builder/presentation/BuilderPage';
import type { BuilderComposerMode, BuilderComposerWorkingBrief } from '../features/builder/presentation/BuilderComposer';
import { BuilderProjectCatalog } from '../features/builder/presentation/BuilderProjectCatalog';
import { BuilderProviderSettingsRouteAdapter } from '../features/builder/presentation/BuilderProviderSettingsRouteAdapter';

const BUILDER_APP_ICON_SRC = 'app-icon.ico';
const COMPOSER_BRIEF_SCAFFOLD = '保存这个方向，后面按这个来：';

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
const APPROVED_PLAN_WAITING_TEXT = 'Applying the approved plan...';

export type BuilderLiveOutputSnapshot = Readonly<{
  state: 'streaming';
  request_id: string;
  project_id: string;
  text: string;
  chunk_count: number;
  waiting_text?: string;
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
const COMPOSER_BRIEF_MAX_TEXT_LENGTH = 260;
const COMPOSER_BRIEF_INTERNAL_TEXT_PATTERN =
  /builder-(?:project|conversation|turn|task|run|message|conversation-event|generation-draft):|sha256:|request_digest|provider|credential|api[_-]?key|source_tree|commit_oid|tree_oid|receipt/iu;

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
  openLocation(request: Parameters<BuilderProjectWorkspacePort['openLocation']>[0]) {
    void request;
    return Promise.reject(new BuilderDesktopProjectWorkspacePortError());
  },
  createLocalProject(request: Parameters<BuilderProjectWorkspacePort['createLocalProject']>[0]) {
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
  listWorkspaces() {
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
  continueDraft(request: Parameters<BuilderCodeGeneratorPort['continueDraft']>[0]) {
    void request;
    return Promise.reject(new BuilderDesktopCodeGeneratorPortError());
  },
  proposePlan(request: Parameters<BuilderCodeGeneratorPort['proposePlan']>[0]) {
    void request;
    return Promise.reject(new BuilderDesktopCodeGeneratorPortError());
  },
  preparePlanSourceReadApproval(
    request: Parameters<BuilderCodeGeneratorPort['preparePlanSourceReadApproval']>[0],
  ) {
    void request;
    return Promise.reject(new BuilderDesktopCodeGeneratorPortError());
  },
  approvePlanSourceRead(request: Parameters<BuilderCodeGeneratorPort['approvePlanSourceRead']>[0]) {
    void request;
    return Promise.reject(new BuilderDesktopCodeGeneratorPortError());
  },
  prepareCurrentProjectWriteApproval(
    request: Parameters<BuilderCodeGeneratorPort['prepareCurrentProjectWriteApproval']>[0],
  ) {
    void request;
    return Promise.reject(new BuilderDesktopCodeGeneratorPortError());
  },
  approveCurrentProjectWrite(request: Parameters<BuilderCodeGeneratorPort['approveCurrentProjectWrite']>[0]) {
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
  answerDraft(request: Parameters<BuilderCodeGeneratorPort['answerDraft']>[0]) {
    void request;
    return Promise.reject(new BuilderDesktopCodeGeneratorPortError());
  },
  restoreDraft(request: Parameters<BuilderCodeGeneratorPort['restoreDraft']>[0]) {
    void request;
    return Promise.reject(new BuilderDesktopCodeGeneratorPortError());
  },
  restoreRevisionAsDraft(request: Parameters<BuilderCodeGeneratorPort['restoreRevisionAsDraft']>[0]) {
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

function hasBuildWorkspace(snapshot: ReturnType<typeof useBuilderProjectController>['snapshot']): boolean {
  return snapshot.savedProject !== null || snapshot.workingProjectId !== null;
}

function visibleHistoryProjectId(
  snapshot: ReturnType<typeof useBuilderProjectController>['snapshot'],
): string | null {
  return snapshot.savedProject?.target.project_id ?? null;
}

type BuilderVisibleProjectSnapshot = ReturnType<typeof useBuilderProjectController>['snapshot'];
type BuilderVisibleConversationSnapshot = ReturnType<typeof useBuilderConversationController>['snapshot'];
type PendingBuildAfterWorkspace = Readonly<{
  epoch: number;
  instruction: string;
  messageId: string;
}>;

type QueuedActiveAnswerBuild = Readonly<{
  epoch: number;
  instruction: string;
  messageId: string;
}>;

type SubmitInstructionTextOptions = Readonly<{
  existingMessageId?: string | null;
}>;

type SubmitInstructionText = (
  submittedIdea: string,
  options?: SubmitInstructionTextOptions,
) => Promise<void>;

type BuilderCurrentProjectWriteApprovalPrompt = Readonly<{
  project_id: string;
  instruction: string;
  message_id: string;
  state: 'pending' | 'approving' | 'failed';
}>;

function latestRestorableDraft(
  conversationSnapshot: BuilderVisibleConversationSnapshot,
  projectSnapshot: BuilderVisibleProjectSnapshot,
): Readonly<{ draftId: string; restoreKey: string }> | null {
  const visibleProjectId = projectSnapshot.savedProject?.target.project_id
    ?? projectSnapshot.workingProjectId
    ?? null;
  if (
    projectSnapshot.busy
    || projectSnapshot.draft !== null
    || projectSnapshot.inspectedRevision !== null
    || visibleProjectId === null
    || !['ready', 'generation_failed', 'preview_unavailable'].includes(projectSnapshot.status)
    || conversationSnapshot.status !== 'ready'
    || conversationSnapshot.conversation?.state !== 'ready'
    || conversationSnapshot.project_id !== visibleProjectId
  ) return null;
  const items = conversationSnapshot.conversation.conversation.items;
  const savedTarget = projectSnapshot.savedProject?.target ?? null;
  const reviewedDraftIds = new Set<string>();
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item.item_kind === 'candidate_reviewed') {
      reviewedDraftIds.add(item.draft_id);
      continue;
    }
    if (item.item_kind === 'run_completed' && item.candidate !== null) {
      if (reviewedDraftIds.has(item.candidate.draft_id)) continue;
      if (savedTarget !== null && item.turn_id === savedTarget.turn_id && item.run_id === savedTarget.run_id) {
        return null;
      }
      return Object.freeze({
        draftId: item.candidate.draft_id,
        restoreKey: [
          conversationSnapshot.project_id,
          conversationSnapshot.conversation.conversation.head_sequence,
          savedTarget?.revision_receipt_digest ?? 'working-project',
          item.candidate.draft_id,
        ].join(':'),
      });
    }
  }
  return null;
}

function planReviewKey(turnId: string, runId: string): string {
  return `${turnId}:${runId}`;
}

function pendingPlanReviewRequest(
  conversationSnapshot: BuilderVisibleConversationSnapshot,
  projectSnapshot: BuilderVisibleProjectSnapshot,
): BuilderPlanReviewRequest | null {
  const visibleProjectId = visibleConversationProjectId(projectSnapshot);
  if (
    visibleProjectId === null
    || conversationSnapshot.status !== 'ready'
    || conversationSnapshot.conversation?.state !== 'ready'
    || conversationSnapshot.project_id !== visibleProjectId
  ) return null;
  const planRuns = new Set<string>();
  const pending = new Map<string, BuilderPlanReviewRequest>();
  const conversation = conversationSnapshot.conversation.conversation;
  for (const item of conversation.items) {
    if (
      item.item_kind === 'run_completed'
      && item.terminal_status === 'succeeded'
      && item.result_kind === 'plan'
    ) {
      planRuns.add(planReviewKey(item.turn_id, item.run_id));
      continue;
    }
    if (
      item.item_kind === 'turn_completed'
      && item.outcome === 'plan_proposed'
      && item.run_id !== null
      && planRuns.has(planReviewKey(item.turn_id, item.run_id))
    ) {
      pending.set(planReviewKey(item.turn_id, item.run_id), Object.freeze({
        project_id: visibleProjectId,
        conversation_id: conversation.conversation_id,
        turn_id: item.turn_id,
        run_id: item.run_id,
        decision: 'approved',
      }));
      continue;
    }
    if (item.item_kind === 'plan_reviewed') {
      pending.delete(planReviewKey(item.turn_id, item.run_id));
    }
  }
  return [...pending.values()].at(-1) ?? null;
}

function hasPriorBuildContext(
  conversationSnapshot: BuilderVisibleConversationSnapshot,
  projectSnapshot: BuilderVisibleProjectSnapshot,
): boolean {
  const visibleProjectId = visibleConversationProjectId(projectSnapshot);
  if (
    visibleProjectId === null
    || conversationSnapshot.status !== 'ready'
    || conversationSnapshot.conversation?.state !== 'ready'
    || conversationSnapshot.project_id !== visibleProjectId
  ) return false;

  let hasContext = false;
  for (const item of conversationSnapshot.conversation.conversation.items) {
    if (item.item_kind === 'task_brief_updated') {
      hasContext = item.brief.contextual_build_ready;
      continue;
    }
    if (item.item_kind === 'plan_reviewed') {
      hasContext = item.plan_state === 'approved';
      continue;
    }
    if (item.item_kind !== 'run_completed' || item.terminal_status !== 'succeeded') continue;
    if (item.result_kind === 'plan') {
      hasContext = false;
      continue;
    }
    if (item.result_kind === 'candidate') {
      hasContext = true;
      continue;
    }
  }
  return hasContext;
}

function compactComposerBriefText(value: string): string | null {
  const normalized = value
    .trim()
    .normalize('NFKC')
    .replace(/\s+/gu, ' ');
  if (normalized.length === 0 || COMPOSER_BRIEF_INTERNAL_TEXT_PATTERN.test(normalized)) return null;
  if (normalized.length <= COMPOSER_BRIEF_MAX_TEXT_LENGTH) return normalized;
  return `${normalized.slice(0, COMPOSER_BRIEF_MAX_TEXT_LENGTH - 3).trimEnd()}...`;
}

function composerBriefScaffold(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) return COMPOSER_BRIEF_SCAFFOLD;
  if (isBuilderComposerExplicitBriefIntent(trimmed)) return value;
  return `${COMPOSER_BRIEF_SCAFFOLD}${trimmed}`;
}

function taskStreamRunKey(item: Readonly<{ turn_id: string; run_id: string }>): string {
  return `${item.turn_id}:${item.run_id}`;
}

function composerWorkingBrief(
  conversationSnapshot: BuilderVisibleConversationSnapshot,
  projectSnapshot: BuilderVisibleProjectSnapshot,
): BuilderComposerWorkingBrief | null {
  const visibleProjectId = visibleConversationProjectId(projectSnapshot);
  if (
    visibleProjectId === null
    || conversationSnapshot.status !== 'ready'
    || conversationSnapshot.conversation?.state !== 'ready'
    || conversationSnapshot.project_id !== visibleProjectId
  ) return null;

  const planTextsByRun = new Map<string, Readonly<{
    sequence: number;
    taskId: string | null;
    text: string;
  }>>();
  const taskIdsByRun = new Map<string, string>();
  let latestPlan: Readonly<{
    sequence: number;
    state: 'approved' | 'proposed' | 'rejected';
    taskId: string | null;
    text: string;
  }> | null = null;
  let latestCandidate: Readonly<{ sequence: number; taskId: string | null; text: string }> | null = null;
  let latestTaskBrief: Readonly<{ sequence: number; taskId: string; text: string }> | null = null;

  for (const item of conversationSnapshot.conversation.conversation.items) {
    if (item.item_kind === 'run_started') {
      if (item.task_id !== null) taskIdsByRun.set(taskStreamRunKey(item), item.task_id);
      continue;
    }
    if (item.item_kind === 'task_brief_updated') {
      if (item.brief.contextual_build_ready) {
        latestTaskBrief = Object.freeze({
          sequence: item.sequence,
          taskId: item.task.task_id,
          text: item.brief.summary,
        });
      }
      continue;
    }
    if (item.item_kind === 'run_completed') {
      const taskId = taskIdsByRun.get(taskStreamRunKey(item)) ?? null;
      const text = item.assistant_message === null ? null : compactComposerBriefText(item.assistant_message.text);
      if (item.result_kind === 'candidate' && item.candidate !== null) {
        const candidateText = compactComposerBriefText(item.candidate.summary)
          ?? compactComposerBriefText(item.candidate.title);
        if (candidateText !== null) {
          latestCandidate = Object.freeze({ sequence: item.sequence, taskId, text: candidateText });
        }
        continue;
      }
      if (item.result_kind === 'plan' && text !== null) {
        const runKey = taskStreamRunKey(item);
        planTextsByRun.set(runKey, Object.freeze({ sequence: item.sequence, taskId, text }));
        latestPlan = Object.freeze({ sequence: item.sequence, state: 'proposed', taskId, text });
      }
      continue;
    }
    if (item.item_kind === 'plan_reviewed') {
      const plan = planTextsByRun.get(taskStreamRunKey(item));
      if (plan !== undefined) {
        latestPlan = Object.freeze({
          sequence: item.sequence,
          state: item.plan_state,
          taskId: plan.taskId,
          text: plan.text,
        });
      }
    }
  }

  const candidates: BuilderComposerWorkingBrief[] = [];
  const candidateSequences = new Map<string, number>();
  if (latestPlan?.state === 'approved') {
    const key = `${visibleProjectId}:approved-plan:${latestPlan.sequence}`;
    candidates.push(Object.freeze({
      key,
      label: 'Approved plan',
      summary: latestPlan.text,
      taskId: latestPlan.taskId,
    }));
    candidateSequences.set(key, latestPlan.sequence);
  }
  if (latestCandidate !== null) {
    const key = `${visibleProjectId}:current-result:${latestCandidate.sequence}`;
    candidates.push(Object.freeze({
      key,
      label: 'Current result',
      summary: latestCandidate.text,
      taskId: latestCandidate.taskId,
    }));
    candidateSequences.set(key, latestCandidate.sequence);
  }
  if (latestTaskBrief !== null) {
    const key = `${visibleProjectId}:task-brief:${latestTaskBrief.sequence}`;
    candidates.push(Object.freeze({
      key,
      label: 'Current brief',
      summary: latestTaskBrief.text,
      taskId: latestTaskBrief.taskId,
    }));
    candidateSequences.set(key, latestTaskBrief.sequence);
  }
  if (candidates.length === 0) return null;
  return candidates.reduce((latest, candidate) => (
    (candidateSequences.get(candidate.key) ?? 0) > (candidateSequences.get(latest.key) ?? 0)
      ? candidate
      : latest
  ));
}

function composerIntentContext(
  conversationSnapshot: BuilderVisibleConversationSnapshot,
  projectSnapshot: BuilderVisibleProjectSnapshot,
  composerMode: BuilderComposerMode | null = null,
  currentProjectWriteApproval:
    Readonly<{ project_id: string; state: BuilderCurrentProjectWriteApprovalStatus['state'] }> | null = null,
  approvalMode: BuilderComposerApprovalMode = 'ask_before_write',
) {
  const currentWorkingBrief = composerWorkingBrief(conversationSnapshot, projectSnapshot);
  const visibleProjectId = visibleConversationProjectId(projectSnapshot);
  const hasWritePermission = visibleProjectId !== null
    && currentProjectWriteApproval?.project_id === visibleProjectId
    ? currentProjectWriteApproval.state === 'ready'
    : undefined;
  return Object.freeze({
    approvalMode,
    composerMode,
    hasPriorBuildContext: projectSnapshot.draft !== null
      || (
        hasPriorBuildContext(conversationSnapshot, projectSnapshot)
        && currentWorkingBrief !== null
      ),
    hasWorkspace: hasBuildWorkspace(projectSnapshot),
    hasWritePermission,
  });
}

function effectiveApprovalMode(
  mode: BuilderComposerApprovalMode,
  projectSnapshot: BuilderVisibleProjectSnapshot,
  currentProjectWriteApproval:
    Readonly<{ project_id: string; state: BuilderCurrentProjectWriteApprovalStatus['state'] }> | null,
): BuilderComposerApprovalMode {
  if (mode !== 'allow_current_project') return mode;
  const visibleProjectId = visibleConversationProjectId(projectSnapshot);
  if (
    visibleProjectId !== null
    && currentProjectWriteApproval?.project_id === visibleProjectId
    && currentProjectWriteApproval.state === 'ready'
  ) {
    return 'allow_current_project';
  }
  return 'ask_before_write';
}

function shouldClearSubmittedIdea(snapshot: BuilderVisibleProjectSnapshot): boolean {
  return snapshot.draft !== null || (
    snapshot.answer !== null
    && snapshot.error === null
  );
}

function appendLiveOutputText(current: string, delta: string): string | null {
  const next = `${current}${delta}`;
  if (LIVE_OUTPUT_ENCODER.encode(next).byteLength > MAX_LIVE_OUTPUT_TEXT_BYTES) return null;
  return next;
}

function liveOutputProjectId(value: BuilderLiveOutputSnapshot | null): string | null {
  return value?.project_id ?? null;
}

function hasRecordedSuccessfulAnswerAfterHead(
  snapshot: BuilderConversationControllerSnapshot | null,
  instruction: string,
  afterHeadSequence: number,
): boolean {
  const stream = snapshot?.conversation ?? null;
  if (stream === null || stream.state !== 'ready') return false;
  const expectedInstruction = instruction.trim();
  if (expectedInstruction.length === 0) return false;
  const items = stream.conversation.items;
  let matchedTurnId: string | null = null;
  let matchedUserSequence = 0;
  for (const item of items) {
    if (
      item.item_kind === 'user_message'
      && item.sequence > afterHeadSequence
      && item.message_kind === 'submitted'
      && item.mode === 'question'
      && item.message.text.trim() === expectedInstruction
    ) {
      matchedTurnId = item.turn_id;
      matchedUserSequence = item.sequence;
    }
  }
  if (matchedTurnId === null) return false;
  return items.some((item) => (
    item.item_kind === 'run_completed'
    && item.sequence > matchedUserSequence
    && item.turn_id === matchedTurnId
    && item.terminal_status === 'succeeded'
    && item.result_kind === 'explanation'
    && item.assistant_message !== null
    && item.assistant_message.text.trim().length > 0
  ));
}

function planReviewInFlightKey(value: BuilderPlanReviewInFlight): string {
  return [
    value.project_id,
    value.conversation_id,
    value.turn_id,
    value.run_id,
  ].join(':');
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
  const [composerMode, setComposerMode] = useState<BuilderComposerMode | null>(null);
  const [approvalMode, setApprovalMode] = useState<BuilderComposerApprovalMode>('ask_before_write');
  const [composerRouteDecision, setComposerRouteDecision] =
    useState<BuilderComposerRouteDecisionEvidence | null>(null);
  const [queuedActiveAnswerBuild, setQueuedActiveAnswerBuild] =
    useState<QueuedActiveAnswerBuild | null>(null);
  const [liveOutput, setLiveOutput] = useState<BuilderLiveOutputSnapshot | null>(null);
  const [answerFailureRecordedSuccess, setAnswerFailureRecordedSuccess] = useState(false);
  const [planReviewFailure, setPlanReviewFailure] = useState<BuilderPlanReviewInFlight | null>(null);
  const [planReviewInFlight, setPlanReviewInFlight] = useState<BuilderPlanReviewInFlight | null>(null);
  const [planReviewRecorded, setPlanReviewRecorded] = useState<BuilderPlanReviewInFlight | null>(null);
  const [approvedPlanContinuationFailure, setApprovedPlanContinuationFailure] =
    useState<BuilderPlanReviewInFlight | null>(null);
  const [catalogNewProjectPending, setCatalogNewProjectPending] = useState(false);
  const [workspacePickerRequest, setWorkspacePickerRequest] = useState(0);
  const [workspaceNewProjectRequest, setWorkspaceNewProjectRequest] = useState(0);
  const [planSourceReadApproval, setPlanSourceReadApproval] =
    useState<BuilderPlanSourceReadApprovalPrompt | null>(null);
  const [currentProjectWriteApproval, setCurrentProjectWriteApproval] =
    useState<BuilderCurrentProjectWriteApprovalPrompt | null>(null);
  const [currentProjectWriteApprovalStatus, setCurrentProjectWriteApprovalStatus] =
    useState<Readonly<{ project_id: string; state: BuilderCurrentProjectWriteApprovalStatus['state'] }> | null>(null);
  const [windowMaximized, setWindowMaximized] = useState(false);
  const workspaceEpochRef = useRef(0);
  const initialWorkspaceAutoOpenRef = useRef(false);
  const windowMaximizedRef = useRef(false);
  const liveOutputRef = useRef<BuilderLiveOutputSnapshot | null>(null);
  const composerModeRef = useRef<BuilderComposerMode | null>(null);
  const approvalModeRef = useRef<BuilderComposerApprovalMode>('ask_before_write');
  const composerRouteDecisionSequenceRef = useRef(0);
  const approvedPlanWaitingProjectRef = useRef<string | null>(null);
  const planReviewInFlightRef = useRef<BuilderPlanReviewInFlight | null>(null);
  const planSourceReadApprovalRef = useRef<BuilderPlanSourceReadApprovalPrompt | null>(null);
  const currentProjectWriteApprovalRef = useRef<BuilderCurrentProjectWriteApprovalPrompt | null>(null);
  const currentProjectWriteApprovalStatusRef =
    useRef<Readonly<{ project_id: string; state: BuilderCurrentProjectWriteApprovalStatus['state'] }> | null>(null);
  const pendingBuildAfterWorkspaceRef = useRef<PendingBuildAfterWorkspace | null>(null);
  const queuedActiveAnswerBuildRef = useRef<QueuedActiveAnswerBuild | null>(null);
  const submitInstructionTextRef = useRef<SubmitInstructionText | null>(null);
  const restoreAttemptKeysRef = useRef(new Set<string>());
  const submitInFlightRef = useRef(false);
  const publishQueuedActiveAnswerBuild = useCallback((queued: QueuedActiveAnswerBuild | null) => {
    queuedActiveAnswerBuildRef.current = queued;
    setQueuedActiveAnswerBuild(queued);
  }, []);
  const createComposerRouteEvidence = useCallback((
    decision: BuilderComposerRouteDecision,
    projectSnapshot: BuilderVisibleProjectSnapshot,
    existingMessageId: string | null = null,
    taskId: string | null = null,
  ) => {
    const sequence = composerRouteDecisionSequenceRef.current + 1;
    composerRouteDecisionSequenceRef.current = sequence;
    const messageId = existingMessageId ?? `builder-composer-message:local:${sequence}`;
    return createBuilderComposerRouteDecisionEvidence(decision, {
      decisionId: `builder-composer-route-decision:local:${sequence}`,
      messageId,
      projectId: visibleConversationProjectId(projectSnapshot),
      taskId,
      createdAt: new Date().toISOString(),
    });
  }, []);
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
      continueDraft(request: Parameters<BuilderCodeGeneratorPort['continueDraft']>[0]) {
        return ports.generator.continueDraft(request);
      },
      proposePlan(request: Parameters<BuilderCodeGeneratorPort['proposePlan']>[0]) {
        return ports.generator.proposePlan(request);
      },
      preparePlanSourceReadApproval(
        request: Parameters<BuilderCodeGeneratorPort['preparePlanSourceReadApproval']>[0],
      ) {
        return ports.generator.preparePlanSourceReadApproval(request);
      },
      approvePlanSourceRead(request: Parameters<BuilderCodeGeneratorPort['approvePlanSourceRead']>[0]) {
        return ports.generator.approvePlanSourceRead(request);
      },
      prepareCurrentProjectWriteApproval(
        request: Parameters<BuilderCodeGeneratorPort['prepareCurrentProjectWriteApproval']>[0],
      ) {
        return ports.generator.prepareCurrentProjectWriteApproval(request);
      },
      approveCurrentProjectWrite(request: Parameters<BuilderCodeGeneratorPort['approveCurrentProjectWrite']>[0]) {
        return ports.generator.approveCurrentProjectWrite(request);
      },
      retry(request: Parameters<BuilderCodeGeneratorPort['retry']>[0]) {
        return ports.generator.retry(request);
      },
      answer(request: Parameters<BuilderCodeGeneratorPort['answer']>[0]) {
        return ports.generator.answer(request);
      },
      answerDraft(request: Parameters<BuilderCodeGeneratorPort['answerDraft']>[0]) {
        return ports.generator.answerDraft(request);
      },
      restoreDraft(request: Parameters<BuilderCodeGeneratorPort['restoreDraft']>[0]) {
        return ports.generator.restoreDraft(request);
      },
      restoreRevisionAsDraft(request: Parameters<BuilderCodeGeneratorPort['restoreRevisionAsDraft']>[0]) {
        return ports.generator.restoreRevisionAsDraft(request);
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
      openLocation(request: Parameters<BuilderProjectWorkspacePort['openLocation']>[0]) {
        return ports.workspace.openLocation(request);
      },
      createLocalProject(request: Parameters<BuilderProjectWorkspacePort['createLocalProject']>[0]) {
        return ports.workspace.createLocalProject(request);
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
      listWorkspaces() { return ports.workspace.listWorkspaces(); },
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
  const currentComposerIntentContext = composerIntentContext(
    conversation.snapshot,
    project.snapshot,
    composerMode,
    currentProjectWriteApprovalStatus,
    effectiveApprovalMode(approvalMode, project.snapshot, currentProjectWriteApprovalStatus),
  );
  const composerContextStatus = currentComposerIntentContext.hasPriorBuildContext
    ? 'ready_to_build'
    : null;
  const projectSnapshotRef = useRef(project.snapshot);
  const conversationSnapshotRef = useRef(conversation.snapshot);

  useLayoutEffect(() => {
    projectSnapshotRef.current = project.snapshot;
  }, [project.snapshot]);

  useLayoutEffect(() => {
    conversationSnapshotRef.current = conversation.snapshot;
  }, [conversation.snapshot]);

  useEffect(() => {
    if (queuedActiveAnswerBuild === null) return undefined;
    const dispatchQueuedBuild = () => {
      const queued = queuedActiveAnswerBuildRef.current;
      if (queued === null) return;
      if (workspaceEpochRef.current !== queued.epoch) {
        publishQueuedActiveAnswerBuild(null);
        return;
      }
      if (projectSnapshotRef.current.busy || submitInFlightRef.current) return;
      publishQueuedActiveAnswerBuild(null);
      void submitInstructionTextRef.current?.(queued.instruction, {
        existingMessageId: queued.messageId,
      });
    };
    const initialHandle = window.setTimeout(dispatchQueuedBuild, 0);
    const intervalHandle = window.setInterval(dispatchQueuedBuild, 50);
    return () => {
      window.clearTimeout(initialHandle);
      window.clearInterval(intervalHandle);
    };
  }, [publishQueuedActiveAnswerBuild, queuedActiveAnswerBuild]);

  useEffect(() => {
    if (!catalogNewProjectPending) return;
    if (project.snapshot.busy || project.snapshot.status !== 'new') return;
    const handle = window.setTimeout(() => {
      setCatalogNewProjectPending(false);
      setWorkspaceNewProjectRequest((request) => request + 1);
    });
    return () => window.clearTimeout(handle);
  }, [catalogNewProjectPending, project.snapshot]);

  useLayoutEffect(() => {
    liveOutputRef.current = liveOutput;
  }, [liveOutput]);

  useLayoutEffect(() => {
    composerModeRef.current = composerMode;
  }, [composerMode]);

  useLayoutEffect(() => {
    approvalModeRef.current = approvalMode;
  }, [approvalMode]);

  useLayoutEffect(() => {
    planSourceReadApprovalRef.current = planSourceReadApproval;
  }, [planSourceReadApproval]);

  useLayoutEffect(() => {
    currentProjectWriteApprovalRef.current = currentProjectWriteApproval;
  }, [currentProjectWriteApproval]);

  useLayoutEffect(() => {
    currentProjectWriteApprovalStatusRef.current = currentProjectWriteApprovalStatus;
  }, [currentProjectWriteApprovalStatus]);

  const publishPlanReviewInFlight = useCallback((value: BuilderPlanReviewInFlight | null) => {
    planReviewInFlightRef.current = value;
    setPlanReviewInFlight(value);
  }, []);

  useEffect(() => (
    ports.generator.subscribeStarted?.((event) => {
      const currentSnapshot = projectSnapshotRef.current;
      const visibleProjectId = visibleConversationProjectId(currentSnapshot);
      if (!currentSnapshot.busy) return;
      if (visibleProjectId !== null && visibleProjectId !== event.project_id) return;
      const nextLiveOutput = Object.freeze({
        state: 'streaming',
        request_id: event.request_id,
        project_id: event.project_id,
        text: '',
        chunk_count: 0,
        waiting_text: approvedPlanWaitingProjectRef.current === event.project_id
          ? APPROVED_PLAN_WAITING_TEXT
          : undefined,
      });
      liveOutputRef.current = nextLiveOutput;
      setLiveOutput(nextLiveOutput);
    }) ?? (() => undefined)
  ), [ports.generator]);

  useEffect(() => (
    ports.generator.subscribeOutput?.((event) => {
      setLiveOutput((current) => {
        const active = current !== null
          && current.request_id === event.request_id
          && current.project_id === event.project_id
          ? current
          : liveOutputRef.current !== null
            && liveOutputRef.current.request_id === event.request_id
            && liveOutputRef.current.project_id === event.project_id
            ? liveOutputRef.current
            : null;
        if (active === null) return current;
        const text = appendLiveOutputText(active.text, event.display_delta_text);
        if (text === null) return current;
        const nextLiveOutput = Object.freeze({
          ...active,
          text,
          chunk_count: active.chunk_count + 1,
        });
        liveOutputRef.current = nextLiveOutput;
        return nextLiveOutput;
      });
    }) ?? (() => undefined)
  ), [ports.generator]);

  const resetWorkspace = useCallback((
    nextProjectId: string | undefined,
    options: Readonly<{ preserveIdea?: boolean }> = Object.freeze({}),
  ) => {
    const nextEpoch = workspaceEpochRef.current + 1;
    workspaceEpochRef.current = nextEpoch;
    pendingBuildAfterWorkspaceRef.current = null;
    approvedPlanWaitingProjectRef.current = null;
    planSourceReadApprovalRef.current = null;
    currentProjectWriteApprovalRef.current = null;
    currentProjectWriteApprovalStatusRef.current = null;
    publishQueuedActiveAnswerBuild(null);
    setPlanReviewFailure(null);
    setPlanReviewRecorded(null);
    setApprovedPlanContinuationFailure(null);
    setAnswerFailureRecordedSuccess(false);
    setPlanSourceReadApproval(null);
    setCurrentProjectWriteApproval(null);
    setCurrentProjectWriteApprovalStatus(null);
    publishPlanReviewInFlight(null);
    restoreAttemptKeysRef.current.clear();
    submitInFlightRef.current = false;
    setWorkspaceEpoch(workspaceEpochRef.current);
    setProjectId(nextProjectId);
    if (options.preserveIdea !== true) setIdea('');
    setActiveFile(null);
    setLiveOutput(null);
    setView('project');
  }, [publishPlanReviewInFlight, publishQueuedActiveAnswerBuild]);

  const openProject = useCallback((nextProjectId: string) => {
    resetWorkspace(nextProjectId);
  }, [resetWorkspace]);

  const openProjectFromComposer = useCallback((nextProjectId: string) => {
    resetWorkspace(nextProjectId, { preserveIdea: true });
  }, [resetWorkspace]);

  const startNewProjectFromCatalog = useCallback(() => {
    resetWorkspace(undefined);
    setCatalogNewProjectPending(true);
  }, [resetWorkspace]);

  useEffect(() => {
    if (initialWorkspaceAutoOpenRef.current || catalog.snapshot.busy) return;
    if (projectId !== undefined || projectSnapshotRef.current.status !== 'new') return;
    if (catalog.snapshot.status !== 'ready' && catalog.snapshot.status !== 'stale') return;
    initialWorkspaceAutoOpenRef.current = true;
    const savedProjectIds = new Set(catalog.snapshot.projects.map((candidate) => candidate.project_id));
    const workspaceOnlyProjects = catalog.snapshot.workspaceProjects
      .filter((candidate) => !savedProjectIds.has(candidate.project_id));
    if (catalog.snapshot.projects.length !== 0 || workspaceOnlyProjects.length !== 1) return;
    const workspaceProjectId = workspaceOnlyProjects[0].project_id;
    window.setTimeout(() => {
      if (projectSnapshotRef.current.status !== 'new') return;
      openProject(workspaceProjectId);
    });
  }, [catalog.snapshot, openProject, projectId]);

  const dismissWorkspacePicker = useCallback(() => {
    pendingBuildAfterWorkspaceRef.current = null;
  }, []);

  const refreshCatalog = useCallback(() => {
    void catalog.refresh().catch(() => undefined);
  }, [catalog]);

  const openProjectLocation = useCallback(async (targetProjectId: string) => {
    await ports.workspace.openLocation({ project_id: targetProjectId }).catch(() => undefined);
  }, [ports.workspace]);

  const readActivityAfterTerminal = useCallback(async (
    result: BuilderVisibleProjectSnapshot,
    commandEpoch: number,
    fallbackProjectId: string | null = null,
  ): Promise<BuilderConversationControllerSnapshot | null> => {
    if (workspaceEpochRef.current !== commandEpoch) return null;
    const conversationProjectId = visibleConversationProjectId(result) ?? fallbackProjectId;
    if (conversationProjectId === null) return null;
    if (conversation.snapshot.project_id === conversationProjectId) {
      return await conversation.refresh().catch(() => null);
    } else {
      return await conversation.load(conversationProjectId).catch(() => null);
    }
  }, [conversation]);

  const createWorkspaceProject = useCallback(async (projectTitle: string) => {
    if (projectTitle.trim().length === 0) return;
    if (submitInFlightRef.current) return;
    const commandEpoch = workspaceEpochRef.current;
    submitInFlightRef.current = true;
    try {
      setView('project');
      const result = await project.createLocalProject(projectTitle);
      if (workspaceEpochRef.current !== commandEpoch) return;
      const workspaceReady = result.workingProjectId !== null || result.savedProject !== null;
      if (workspaceReady) {
        setActiveFile(null);
        setLiveOutput(null);
        await catalog.refresh().catch(() => undefined);
      }
      const pendingBuild = pendingBuildAfterWorkspaceRef.current;
      if (pendingBuild === null || pendingBuild.epoch !== commandEpoch) return;
      if (!workspaceReady) {
        pendingBuildAfterWorkspaceRef.current = null;
        return;
      }
      if (idea !== pendingBuild.instruction) {
        pendingBuildAfterWorkspaceRef.current = null;
        return;
      }
      const submittedIdea = pendingBuild.instruction;
      let decision = decideBuilderComposerIntent(
        submittedIdea,
        composerIntentContext(
          conversationSnapshotRef.current,
          result,
          composerModeRef.current,
          currentProjectWriteApprovalStatusRef.current,
          effectiveApprovalMode(
            approvalModeRef.current,
            result,
            currentProjectWriteApprovalStatusRef.current,
          ),
        ),
      );
      if (
        decision.route !== 'build'
        || decision.dispatch !== 'build'
        || !hasBuildWorkspace(result)
        || result.busy
        || result.draft !== null
        || result.inspectedRevision !== null
      ) {
        const routeEvidence = createComposerRouteEvidence(decision, result, pendingBuild.messageId);
        setComposerRouteDecision(routeEvidence);
        pendingBuildAfterWorkspaceRef.current = null;
        return;
      }
      pendingBuildAfterWorkspaceRef.current = null;
      const visibleProjectId = visibleConversationProjectId(result);
      if (visibleProjectId === null) return;
      let approval: BuilderCurrentProjectWriteApprovalStatus;
      try {
        approval = await ports.generator.prepareCurrentProjectWriteApproval({
          project_id: visibleProjectId,
        });
      } catch {
        approval = Object.freeze({
          result_version: 'builder-current-project-write-approval-status.v1',
          project_id: visibleProjectId,
          state: 'approval_required' as const,
          approval_scope: 'current_project_write' as const,
          authority: 'main_selected_project_project_edit_v1' as const,
        });
      }
      if (workspaceEpochRef.current !== commandEpoch) return;
      const nextPermissionStatus = Object.freeze({
        project_id: visibleProjectId,
        state: approval.state,
      });
      currentProjectWriteApprovalStatusRef.current = nextPermissionStatus;
      setCurrentProjectWriteApprovalStatus(nextPermissionStatus);
      if (approval.state === 'approval_required') {
        decision = decideBuilderComposerIntent(
          submittedIdea,
          composerIntentContext(
            conversationSnapshotRef.current,
            result,
            composerModeRef.current,
            nextPermissionStatus,
            effectiveApprovalMode(approvalModeRef.current, result, nextPermissionStatus),
          ),
        );
        const routeEvidence = createComposerRouteEvidence(decision, result, pendingBuild.messageId);
        setComposerRouteDecision(routeEvidence);
        const prompt = Object.freeze({
          project_id: visibleProjectId,
          instruction: submittedIdea,
          message_id: routeEvidence.messageId,
          state: 'pending' as const,
        });
        currentProjectWriteApprovalRef.current = prompt;
        setCurrentProjectWriteApproval(prompt);
        setIdea('');
        return;
      }
      currentProjectWriteApprovalRef.current = null;
      setCurrentProjectWriteApproval(null);
      decision = decideBuilderComposerIntent(
        submittedIdea,
        composerIntentContext(
          conversationSnapshotRef.current,
          result,
          composerModeRef.current,
          nextPermissionStatus,
          effectiveApprovalMode(approvalModeRef.current, result, nextPermissionStatus),
        ),
      );
      const routeEvidence = createComposerRouteEvidence(decision, result, pendingBuild.messageId);
      setComposerRouteDecision(routeEvidence);
      setIdea('');
      setLiveOutput(null);
      const buildResult = await project.submit(submittedIdea);
      if (workspaceEpochRef.current !== commandEpoch) return;
      if (!shouldClearSubmittedIdea(buildResult)) setIdea(submittedIdea);
      await readActivityAfterTerminal(buildResult, commandEpoch);
      setLiveOutput(null);
    } finally {
      if (workspaceEpochRef.current === commandEpoch) {
        submitInFlightRef.current = false;
      }
    }
  }, [
    catalog,
    createComposerRouteEvidence,
    idea,
    ports.generator,
    project,
    readActivityAfterTerminal,
  ]);

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

  const steerInstruction = useCallback(async () => {
    if (idea.trim().length === 0) return;
    const live = liveOutputRef.current;
    if (live === null || !projectSnapshotRef.current.busy) return;
    const commandEpoch = workspaceEpochRef.current;
    const submittedIdea = idea;
    setIdea('');
    const steered = await project.steer(submittedIdea);
    if (workspaceEpochRef.current !== commandEpoch) return;
    if (!steered) {
      setIdea(submittedIdea);
      return;
    }
    const projectId = visibleConversationProjectId(projectSnapshotRef.current) ?? live.project_id;
    if (conversation.snapshot.project_id === projectId) {
      await conversation.refresh().catch(() => undefined);
    } else {
      await conversation.load(projectId).catch(() => undefined);
    }
  }, [conversation, idea, project]);

  const reviewPlan = useCallback(async (request: BuilderPlanReviewRequest) => {
    if (planReviewInFlightRef.current !== null) return;
    const inFlight = Object.freeze({
      project_id: request.project_id,
      conversation_id: request.conversation_id,
      turn_id: request.turn_id,
      run_id: request.run_id,
    });
    const inFlightKey = planReviewInFlightKey(inFlight);
    setPlanReviewFailure(null);
    setPlanReviewRecorded(null);
    setApprovedPlanContinuationFailure(null);
    publishPlanReviewInFlight(inFlight);
    const commandEpoch = workspaceEpochRef.current;
    let reviewed = false;
    let reviewFailed = false;
    try {
      await ports.planReview.review(request);
      reviewed = true;
      setPlanReviewRecorded(inFlight);
    } catch {
      reviewFailed = true;
      reviewed = false;
    } finally {
      if (
        !reviewed
        && planReviewInFlightRef.current !== null
        && planReviewInFlightKey(planReviewInFlightRef.current) === inFlightKey
      ) {
        publishPlanReviewInFlight(null);
      }
    }
    if (workspaceEpochRef.current !== commandEpoch) return;
    await conversation.load(request.project_id).catch(() => undefined);
    if (!reviewed || request.decision !== 'approved') {
      setPlanReviewFailure(reviewFailed ? inFlight : null);
      if (
        planReviewInFlightRef.current !== null
        && planReviewInFlightKey(planReviewInFlightRef.current) === inFlightKey
      ) {
        publishPlanReviewInFlight(null);
      }
      return;
    }
    setLiveOutput(null);
    approvedPlanWaitingProjectRef.current = request.project_id;
    let result: Awaited<ReturnType<typeof project.generateApprovedPlan>>;
    try {
      result = await project.generateApprovedPlan({
        project_id: request.project_id,
        conversation_id: request.conversation_id,
        turn_id: request.turn_id,
        run_id: request.run_id,
      });
    } finally {
      if (approvedPlanWaitingProjectRef.current === request.project_id) {
        approvedPlanWaitingProjectRef.current = null;
      }
      if (
        planReviewInFlightRef.current !== null
        && planReviewInFlightKey(planReviewInFlightRef.current) === inFlightKey
      ) {
        publishPlanReviewInFlight(null);
      }
    }
    if (workspaceEpochRef.current !== commandEpoch) return;
    setApprovedPlanContinuationFailure(result.status === 'generation_failed' ? inFlight : null);
    await readActivityAfterTerminal(result, commandEpoch, request.project_id);
    setLiveOutput(null);
  }, [conversation, ports.planReview, project, publishPlanReviewInFlight, readActivityAfterTerminal]);

  const runPlanProposal = useCallback(async (
    submittedIdea: string,
    commandEpoch: number,
    fallbackProjectId: string,
  ) => {
    const result = await project.proposePlan(submittedIdea);
    if (workspaceEpochRef.current !== commandEpoch) return;
    if (result.status === 'submit_failed' || result.status === 'unavailable') {
      setIdea(submittedIdea);
    }
    await readActivityAfterTerminal(result, commandEpoch, fallbackProjectId);
    setLiveOutput(null);
  }, [project, readActivityAfterTerminal]);

  const submitPlanInstruction = useCallback(async (
    submittedIdea: string,
    commandEpoch: number,
    currentSnapshot: BuilderVisibleProjectSnapshot,
  ): Promise<boolean> => {
    const fallbackProjectId = visibleConversationProjectId(currentSnapshot);
    if (
      currentSnapshot.busy
      || currentSnapshot.draft !== null
      || currentSnapshot.inspectedRevision !== null
      || fallbackProjectId === null
      || !['ready', 'preview_unavailable'].includes(currentSnapshot.status)
      || submittedIdea.trim().length === 0
    ) return false;
    setApprovedPlanContinuationFailure(null);
    setLiveOutput(null);
    try {
      const approval = await ports.generator.preparePlanSourceReadApproval({
        project_id: fallbackProjectId,
      });
      if (workspaceEpochRef.current !== commandEpoch) return true;
      if (approval.state === 'approval_required') {
        const prompt = Object.freeze({
          project_id: fallbackProjectId,
          instruction: submittedIdea,
          file_count: approval.file_count,
          state: 'pending' as const,
        });
        planSourceReadApprovalRef.current = prompt;
        setPlanSourceReadApproval(prompt);
        composerModeRef.current = null;
        setComposerMode(null);
        setIdea('');
        return true;
      }
      planSourceReadApprovalRef.current = null;
      setPlanSourceReadApproval(null);
      composerModeRef.current = null;
      setComposerMode(null);
      setIdea('');
      await runPlanProposal(submittedIdea, commandEpoch, fallbackProjectId);
      return true;
    } catch {
      if (workspaceEpochRef.current === commandEpoch) setIdea(submittedIdea);
      return true;
    }
  }, [ports.generator, runPlanProposal]);

  const submitInstructionText = useCallback<SubmitInstructionText>(async (
    submittedIdea,
    options = Object.freeze({}),
  ) => {
    if (submitInFlightRef.current || submittedIdea.trim().length === 0) return;
    publishQueuedActiveAnswerBuild(null);
    setAnswerFailureRecordedSuccess(false);
    let decision = decideBuilderComposerIntent(
      submittedIdea,
      composerIntentContext(
        conversationSnapshotRef.current,
        projectSnapshotRef.current,
        composerModeRef.current,
        currentProjectWriteApprovalStatusRef.current,
        effectiveApprovalMode(
          approvalModeRef.current,
          projectSnapshotRef.current,
          currentProjectWriteApprovalStatusRef.current,
        ),
      ),
    );
    const routeWorkingBrief = composerWorkingBrief(
      conversationSnapshotRef.current,
      projectSnapshotRef.current,
    );
    const answerStartHeadSequence = conversationSnapshotRef.current.conversation?.state === 'ready'
      ? conversationSnapshotRef.current.conversation.conversation.head_sequence
      : 0;
    const routeTaskId = routeWorkingBrief !== null
      && decision.route === 'build'
      ? routeWorkingBrief.taskId
      : null;
    const publishRouteDecision = (
      nextDecision: BuilderComposerRouteDecision,
      existingMessageId: string | null = options.existingMessageId ?? null,
      nextTaskId: string | null = routeTaskId,
    ): BuilderComposerRouteDecisionEvidence => {
      const evidence = createComposerRouteEvidence(
        nextDecision,
        projectSnapshotRef.current,
        existingMessageId,
        nextTaskId,
      );
      setComposerRouteDecision(evidence);
      return evidence;
    };
    setApprovedPlanContinuationFailure(null);
    pendingBuildAfterWorkspaceRef.current = null;
    const pendingPlan = pendingPlanReviewRequest(
      conversationSnapshotRef.current,
      projectSnapshotRef.current,
    );
    if (pendingPlan !== null && isBuilderComposerContextualBuildIntent(submittedIdea)) {
      publishRouteDecision(decision);
      submitInFlightRef.current = true;
      setIdea('');
      setLiveOutput(null);
      try {
        await reviewPlan(pendingPlan);
      } finally {
        submitInFlightRef.current = false;
      }
      return;
    }
    if (decision.dispatch === 'ask_workspace') {
      const routeEvidence = publishRouteDecision(decision);
      pendingBuildAfterWorkspaceRef.current = Object.freeze({
        epoch: workspaceEpochRef.current,
        instruction: submittedIdea,
        messageId: routeEvidence.messageId,
      });
      setWorkspacePickerRequest((request) => request + 1);
      return;
    }
    if (decision.dispatch === 'ask_permission') {
      const routeEvidence = publishRouteDecision(decision);
      const projectId = visibleConversationProjectId(projectSnapshotRef.current);
      if (projectId !== null) {
        const prompt = Object.freeze({
          project_id: projectId,
          instruction: submittedIdea,
          message_id: routeEvidence.messageId,
          state: 'pending' as const,
        });
        currentProjectWriteApprovalRef.current = prompt;
        setCurrentProjectWriteApproval(prompt);
        setIdea('');
      }
      return;
    }
    const commandEpoch = workspaceEpochRef.current;
    submitInFlightRef.current = true;
    try {
      if (composerModeRef.current === 'plan' || decision.dispatch === 'plan') {
        publishRouteDecision(decision);
        const planned = await submitPlanInstruction(
          submittedIdea,
          commandEpoch,
          projectSnapshotRef.current,
        );
        if (planned || composerModeRef.current === 'plan') return;
      }
      if (decision.dispatch === 'build') {
        const projectId = visibleConversationProjectId(projectSnapshotRef.current);
        if (projectId === null) return;
        let approval: BuilderCurrentProjectWriteApprovalStatus;
        try {
          approval = await ports.generator.prepareCurrentProjectWriteApproval({
            project_id: projectId,
          });
        } catch {
          approval = Object.freeze({
            result_version: 'builder-current-project-write-approval-status.v1',
            project_id: projectId,
            state: 'approval_required' as const,
            approval_scope: 'current_project_write' as const,
            authority: 'main_selected_project_project_edit_v1' as const,
          });
        }
        if (workspaceEpochRef.current !== commandEpoch) return;
        const nextPermissionStatus = Object.freeze({
          project_id: projectId,
          state: approval.state,
        });
        currentProjectWriteApprovalStatusRef.current = nextPermissionStatus;
        setCurrentProjectWriteApprovalStatus(nextPermissionStatus);
        if (approval.state === 'approval_required') {
          decision = decideBuilderComposerIntent(
            submittedIdea,
            composerIntentContext(
              conversationSnapshotRef.current,
              projectSnapshotRef.current,
              composerModeRef.current,
              nextPermissionStatus,
              effectiveApprovalMode(approvalModeRef.current, projectSnapshotRef.current, nextPermissionStatus),
            ),
          );
          const routeEvidence = publishRouteDecision(
            decision,
            null,
            routeTaskId,
          );
          const prompt = Object.freeze({
            project_id: projectId,
            instruction: submittedIdea,
            message_id: routeEvidence.messageId,
            state: 'pending' as const,
          });
          currentProjectWriteApprovalRef.current = prompt;
          setCurrentProjectWriteApproval(prompt);
          setIdea('');
          return;
        }
        currentProjectWriteApprovalRef.current = null;
        setCurrentProjectWriteApproval(null);
        decision = decideBuilderComposerIntent(
          submittedIdea,
          composerIntentContext(
            conversationSnapshotRef.current,
            projectSnapshotRef.current,
            composerModeRef.current,
            nextPermissionStatus,
            effectiveApprovalMode(approvalModeRef.current, projectSnapshotRef.current, nextPermissionStatus),
          ),
        );
        publishRouteDecision(
          decision,
          null,
          routeTaskId,
        );
      }
      if (decision.dispatch !== 'build') {
        publishRouteDecision(decision);
      }
      setIdea('');
      liveOutputRef.current = null;
      setLiveOutput(null);
      const shouldSubmitToConversationWorkPath = decision.dispatch === 'build';
      const result = shouldSubmitToConversationWorkPath
        ? await project.submit(submittedIdea)
        : await project.answer(submittedIdea);
      if (workspaceEpochRef.current !== commandEpoch) return;
      const answerTerminalProjectId = shouldSubmitToConversationWorkPath
        ? null
        : liveOutputProjectId(liveOutputRef.current) ?? conversationSnapshotRef.current.project_id;
      const terminalConversation = await readActivityAfterTerminal(result, commandEpoch, answerTerminalProjectId);
      const recordedAnswerSuccess = !shouldSubmitToConversationWorkPath
        && result.status === 'answer_failed'
        && hasRecordedSuccessfulAnswerAfterHead(
          terminalConversation,
          submittedIdea,
          answerStartHeadSequence,
        );
      setAnswerFailureRecordedSuccess(recordedAnswerSuccess);
      if (!recordedAnswerSuccess && !shouldClearSubmittedIdea(result)) setIdea(submittedIdea);
      setLiveOutput(null);
    } finally {
      if (workspaceEpochRef.current === commandEpoch) {
        submitInFlightRef.current = false;
      }
    }
  }, [
    project,
    ports.generator,
    createComposerRouteEvidence,
    publishQueuedActiveAnswerBuild,
    readActivityAfterTerminal,
    reviewPlan,
    submitPlanInstruction,
  ]);

  useLayoutEffect(() => {
    submitInstructionTextRef.current = submitInstructionText;
  }, [submitInstructionText]);

  const submitInstruction = useCallback(async () => {
    if (projectSnapshotRef.current.busy) {
      const currentSnapshot = projectSnapshotRef.current;
      const submittedIdea = idea;
      if (currentSnapshot.status === 'answering' && submittedIdea.trim().length > 0) {
        const decision = decideBuilderComposerIntent(
          submittedIdea,
          composerIntentContext(
            conversationSnapshotRef.current,
            currentSnapshot,
            composerModeRef.current,
            currentProjectWriteApprovalStatusRef.current,
            effectiveApprovalMode(
              approvalModeRef.current,
              currentSnapshot,
              currentProjectWriteApprovalStatusRef.current,
            ),
          ),
        );
        if (decision.route === 'build') {
          const routeWorkingBrief = composerWorkingBrief(
            conversationSnapshotRef.current,
            currentSnapshot,
          );
          const routeTaskId = routeWorkingBrief !== null
            ? routeWorkingBrief.taskId
            : null;
          const routeEvidence = createComposerRouteEvidence(
            decision,
            currentSnapshot,
            null,
            routeTaskId,
          );
          setComposerRouteDecision(routeEvidence);
          publishQueuedActiveAnswerBuild(Object.freeze({
            epoch: workspaceEpochRef.current,
            instruction: submittedIdea,
            messageId: routeEvidence.messageId,
          }));
          setIdea('');
          return;
        }
      }
      await steerInstruction();
      return;
    }
    await submitInstructionText(idea);
  }, [
    idea,
    createComposerRouteEvidence,
    publishQueuedActiveAnswerBuild,
    steerInstruction,
    submitInstructionText,
  ]);

  const changeComposerInstruction = useCallback((value: string) => {
    setIdea(value);
  }, []);

  const selectPlanMode = useCallback(() => {
    composerModeRef.current = 'plan';
    setComposerMode('plan');
  }, []);

  const selectBriefMode = useCallback(() => {
    composerModeRef.current = null;
    setComposerMode(null);
    setIdea((current) => composerBriefScaffold(current));
  }, []);

  const selectApprovalMode = useCallback(async (mode: BuilderComposerApprovalMode) => {
    if (mode !== 'allow_current_project') {
      approvalModeRef.current = mode;
      setApprovalMode(mode);
      if (mode === 'read_only_chat') {
        const prompt = currentProjectWriteApprovalRef.current;
        currentProjectWriteApprovalRef.current = null;
        setCurrentProjectWriteApproval(null);
        if (prompt !== null) {
          setIdea((current) => (current.trim().length === 0 ? prompt.instruction : current));
        }
      }
      return;
    }
    const projectId = visibleConversationProjectId(projectSnapshotRef.current);
    if (projectId === null) return;
    try {
      await ports.generator.approveCurrentProjectWrite({ project_id: projectId });
      const allowed = Object.freeze({
        project_id: projectId,
        state: 'ready' as const,
      });
      currentProjectWriteApprovalStatusRef.current = allowed;
      setCurrentProjectWriteApprovalStatus(allowed);
      const prompt = currentProjectWriteApprovalRef.current;
      if (prompt !== null && prompt.project_id === projectId) {
        currentProjectWriteApprovalRef.current = null;
        setCurrentProjectWriteApproval(null);
      }
      approvalModeRef.current = 'allow_current_project';
      setApprovalMode('allow_current_project');
      if (prompt !== null && prompt.project_id === projectId) {
        setIdea('');
        void submitInstructionTextRef.current?.(prompt.instruction, {
          existingMessageId: prompt.message_id,
        });
      }
    } catch {
      approvalModeRef.current = 'ask_before_write';
      setApprovalMode('ask_before_write');
    }
  }, [ports.generator]);

  const clearComposerMode = useCallback(() => {
    composerModeRef.current = null;
    setComposerMode(null);
  }, []);

  const approvePlanSourceRead = useCallback(async () => {
    const prompt = planSourceReadApprovalRef.current;
    if (prompt === null || submitInFlightRef.current || prompt.state === 'approving') return;
    const commandEpoch = workspaceEpochRef.current;
    submitInFlightRef.current = true;
    const approving = Object.freeze({ ...prompt, state: 'approving' as const });
    planSourceReadApprovalRef.current = approving;
    setPlanSourceReadApproval(approving);
    setLiveOutput(null);
    try {
      await ports.generator.approvePlanSourceRead({ project_id: prompt.project_id });
      if (workspaceEpochRef.current !== commandEpoch) return;
      planSourceReadApprovalRef.current = null;
      setPlanSourceReadApproval(null);
      await runPlanProposal(prompt.instruction, commandEpoch, prompt.project_id);
    } catch {
      if (workspaceEpochRef.current === commandEpoch) {
        const failed = Object.freeze({ ...prompt, state: 'failed' as const });
        planSourceReadApprovalRef.current = failed;
        setPlanSourceReadApproval(failed);
      }
    } finally {
      if (workspaceEpochRef.current === commandEpoch) {
        submitInFlightRef.current = false;
      }
    }
  }, [ports.generator, runPlanProposal]);

  const approveCurrentProjectWrite = useCallback(async () => {
    const prompt = currentProjectWriteApprovalRef.current;
    if (prompt === null || submitInFlightRef.current || prompt.state === 'approving') return;
    const commandEpoch = workspaceEpochRef.current;
    submitInFlightRef.current = true;
    const approving = Object.freeze({ ...prompt, state: 'approving' as const });
    currentProjectWriteApprovalRef.current = approving;
    setCurrentProjectWriteApproval(approving);
    setLiveOutput(null);
    try {
      await ports.generator.approveCurrentProjectWrite({ project_id: prompt.project_id });
      if (workspaceEpochRef.current !== commandEpoch) return;
      const allowed = Object.freeze({
        project_id: prompt.project_id,
        state: 'ready' as const,
      });
      currentProjectWriteApprovalStatusRef.current = allowed;
      setCurrentProjectWriteApprovalStatus(allowed);
      currentProjectWriteApprovalRef.current = null;
      setCurrentProjectWriteApproval(null);
      const decision = decideBuilderComposerIntent(
        prompt.instruction,
        composerIntentContext(
          conversationSnapshotRef.current,
          projectSnapshotRef.current,
          composerModeRef.current,
          allowed,
          effectiveApprovalMode(approvalModeRef.current, projectSnapshotRef.current, allowed),
        ),
      );
      const routeWorkingBrief = composerWorkingBrief(
        conversationSnapshotRef.current,
        projectSnapshotRef.current,
      );
      const routeTaskId = routeWorkingBrief !== null
        && decision.route === 'build'
        ? routeWorkingBrief.taskId
        : null;
      setComposerRouteDecision(createComposerRouteEvidence(
        decision,
        projectSnapshotRef.current,
        prompt.message_id,
        routeTaskId,
      ));
      setIdea('');
      const result = await project.submit(prompt.instruction);
      if (workspaceEpochRef.current !== commandEpoch) return;
      if (!shouldClearSubmittedIdea(result)) setIdea(prompt.instruction);
      await readActivityAfterTerminal(result, commandEpoch);
      setLiveOutput(null);
    } catch {
      if (workspaceEpochRef.current === commandEpoch) {
        const failed = Object.freeze({ ...prompt, state: 'failed' as const });
        currentProjectWriteApprovalRef.current = failed;
        setCurrentProjectWriteApproval(failed);
      }
    } finally {
      if (workspaceEpochRef.current === commandEpoch) {
        submitInFlightRef.current = false;
      }
    }
  }, [
    createComposerRouteEvidence,
    ports.generator,
    project,
    readActivityAfterTerminal,
  ]);

  const dismissPlanSourceReadApproval = useCallback(() => {
    const prompt = planSourceReadApprovalRef.current;
    if (prompt === null || prompt.state === 'approving') return;
    planSourceReadApprovalRef.current = null;
    setPlanSourceReadApproval(null);
    setIdea((current) => (current.trim().length === 0 ? prompt.instruction : current));
  }, []);

  const dismissCurrentProjectWriteApproval = useCallback(() => {
    const prompt = currentProjectWriteApprovalRef.current;
    if (prompt === null || prompt.state === 'approving') return;
    currentProjectWriteApprovalRef.current = null;
    setCurrentProjectWriteApproval(null);
    setIdea((current) => (current.trim().length === 0 ? prompt.instruction : current));
  }, []);

  const retryGenerate = useCallback(async () => {
    const commandEpoch = workspaceEpochRef.current;
    setLiveOutput(null);
    const result = await project.retryGenerate();
    if (workspaceEpochRef.current !== commandEpoch) return;
    if (result.status !== 'generation_failed') {
      setApprovedPlanContinuationFailure(null);
    }
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
  const inspectRevision = useCallback(async (targetProjectId: string, revisionReceiptDigest: string) => {
    setActiveFile(null);
    await project.inspectRevision(targetProjectId, revisionReceiptDigest);
  }, [project]);
  const restoreRevisionAsDraft = useCallback(async (targetProjectId: string, revisionReceiptDigest: string) => {
    const commandEpoch = workspaceEpochRef.current;
    setActiveFile(null);
    setLiveOutput(null);
    const result = await project.restoreRevisionAsDraft(targetProjectId, revisionReceiptDigest);
    if (workspaceEpochRef.current !== commandEpoch) return;
    await readActivityAfterTerminal(result, commandEpoch, targetProjectId);
    setLiveOutput(null);
  }, [project, readActivityAfterTerminal]);
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

  const visibleApprovalMode = effectiveApprovalMode(
    approvalMode,
    project.snapshot,
    currentProjectWriteApprovalStatus,
  );

  return (
    <main className="cf-builder-workbench cf-builder-desktop-shell min-h-screen text-foreground" data-builder-workbench="true">
      <header className="cf-builder-app-chrome" aria-label="ClawFabric Builder window" data-builder-app-chrome="true">
        <div className="cf-builder-app-chrome-title min-w-0">
          <span
            className="cf-builder-brand-mark cf-builder-brand-mark--icon inline-flex size-7 items-center justify-center"
            aria-hidden="true"
          >
            <img alt="" className="cf-builder-brand-icon" src={BUILDER_APP_ICON_SRC} />
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
          <nav className="cf-builder-rail-nav" aria-label="Builder views">
            {BUILDER_RAIL_ITEMS.filter((item) => item.enabled).map(({ Icon, id, label, view: targetView }) => (
              <button
                aria-pressed={view === targetView}
                className="cf-builder-nav-button cf-builder-rail-button inline-flex items-center justify-center gap-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
                data-builder-rail-item={id}
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
              onCreateProject={startNewProjectFromCatalog}
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
              activeAnswerBuildBlocked={queuedActiveAnswerBuild !== null
                && project.snapshot.busy
                && project.snapshot.status === 'answering'}
              activeFile={activeFile}
              answerFailureRecordedSuccess={answerFailureRecordedSuccess}
              approvalMode={visibleApprovalMode}
              approvedPlanContinuationFailure={approvedPlanContinuationFailure}
              composerContextStatus={composerContextStatus}
              composerMode={composerMode}
              composerRouteDecision={composerRouteDecision}
              currentProjectWriteApproval={currentProjectWriteApproval}
              instruction={idea}
              liveOutput={liveOutput}
              planReviewFailure={planReviewFailure}
              planReviewInFlight={planReviewInFlight}
              planReviewRecorded={planReviewRecorded}
              planSourceReadApproval={planSourceReadApproval}
              workspaceNewProjectRequest={workspaceNewProjectRequest}
              workspacePickerRequest={workspacePickerRequest}
              onApproveCurrentProjectWrite={approveCurrentProjectWrite}
              onApprovePlanSourceRead={approvePlanSourceRead}
              onCreateProject={createWorkspaceProject}
              onClearComposerMode={clearComposerMode}
              onDismissWorkspacePicker={dismissWorkspacePicker}
              onDismissCurrentProjectWriteApproval={dismissCurrentProjectWriteApproval}
              onDismissPlanSourceReadApproval={dismissPlanSourceReadApproval}
              onSelectApprovalMode={selectApprovalMode}
              onSelectBriefMode={selectBriefMode}
              onSelectPlanMode={selectPlanMode}
              onSubmitInstruction={submitInstruction}
              onInstructionChange={changeComposerInstruction}
              onInspectRevision={inspectRevision}
              onOpenProject={openProjectFromComposer}
              onOpenProjectLocation={openProjectLocation}
              onOpenSettings={() => setView('settings')}
              onRestoreRevisionAsDraft={restoreRevisionAsDraft}
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
              projectCatalogSnapshot={catalog.snapshot}
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
